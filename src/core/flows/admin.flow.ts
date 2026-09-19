import { randomUUID } from 'node:crypto';
import { isAdmin } from '../../admin/access.js';
import { MDG_SHORT } from '../texts.js';
import { ADMIN_CB, CANCEL_MENU, adminMenu, isCancel } from '../../admin/menu.js';
import { localDate } from '../../broadcast/schedule.js';
import { formatDayRanges } from '../dayRanges.js';
import { b, code, esc, i } from '../html.js';
import { formatPhone } from '../phone.js';
import { participants, toParticipants } from '../plural.js';
import type { AdminDialog } from '../../db/repos/adminSessions.repo.js';
import type { UserRow } from '../../db/repos/users.repo.js';
import type { Deps } from '../../deps.js';
import type { Button, PlatformName, UpdateCtx } from '../platform.js';

/**
 * Справка. Примеры команд обёрнуты в code(): он экранирует угловые скобки.
 * Сырой «<номер заявки>» в HTML-сообщении Telegram отвергает целиком
 * («can't parse entities»), поэтому подстановки пишем только через code().
 */
/** Заглушка: подставляется адресом дашборда из настроек в момент ответа. */
const DASHBOARD_HINT = '__DASHBOARD__';

const HELP = [
  b('Кнопки'),
  '',
  '📦 Выдать набор — по номеру регистрации или ФИО; по QR быстрее',
  '📣 Объявление — разослать текст всем участникам',
  '✏️ Загрузить день — материал дня кампании',
  '',
  b('Команды'),
  '',
  `${code('/broadcast <текст>')} — объявление всем участникам`,
  `${code('/setday <день> <текст>')} — загрузить материал дня`,
  `${code('/getday <день>')} — показать материал дня`,
  `${code('/sendday <день>')} — отправить материал дня прямо сейчас`,
  `${code('/days')} — какие дни уже загружены`,
  `${code('/kit <номер или ФИО>')} — выдать набор участнику`,
  `${code('/export')} — выгрузка участников в CSV`,
  `${code('/admins')} — кто видит клавиатуру служителя`,
  `${code('/whoami')} — свой числовой id для ADMIN_IDS`,
  '',
  b('Остальное — в дашборде'),
  'Статистика кампании, заявки, домашние группы и ведущие: заводятся и ведутся там.',
  DASHBOARD_HINT,
].join('\n');

const PLATFORM_LABEL = { telegram: 'Telegram', max: 'MAX' } as const;

const CONFIRM_BUTTONS: Button[][] = [
  [
    { kind: 'callback', text: '✅ Отправить', data: `${ADMIN_CB}confirm` },
    { kind: 'callback', text: '✖️ Отмена', data: `${ADMIN_CB}cancel` },
  ],
];

const YES = ['да', 'отправить', 'отправляй', 'ок'];

/**
 * Команды и мини-диалоги служителей. Работают только у тех, кто указан в ADMIN_IDS_*.
 *
 * Команды с данными доступны двумя путями: одной строкой («/setday 3 текст»)
 * и по шагам через кнопку («Загрузить день» → «Какой день?» → …).
 * Шаг диалога хранится в admin_sessions, отдельно от анкеты участника,
 * потому что служитель обычно и сам участник кампании.
 *
 * Логика здесь заведомо со сторонними эффектами (БД, отправка файлов и рассылки),
 * поэтому проверяется интеграционными тестами, а не юнит-тестами.
 */
const TZ = process.env.TIMEZONE ?? 'Europe/Moscow';

function moscowDateTime(d: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/** Короткая карточка участника: показывается служителю при выдаче набора и после регистрации. */
function participantCard(u: UserRow): string {
  const lines = [
    `🎫 ${b(`№${u.registration_no}`)} ${esc(u.full_name ?? 'без имени')}`,
    `📞 ${esc(formatPhone(u.phone)) || 'телефон не указан'}`,
  ];
  if (u.church) lines.push(`⛪️ ${esc(u.church)}`);
  if (u.mdg_status) lines.push(`👥 ${esc(MDG_SHORT[u.mdg_status])}`);
  if (u.location) lines.push(`📍 ${esc(u.location)}`);
  if (u.age) lines.push(`🎂 ${u.age}`);
  if (!u.complete) lines.push('⚠️ анкета заполнена не до конца');
  if (u.admin_comment) lines.push(`📝 ${esc(u.admin_comment)}`);
  return lines.join('\n');
}

export class AdminFlow {
  constructor(private readonly deps: Deps) {}

  /**
   * Меню и команды служителя — только в Telegram. Раньше работали и в MAX
   * (через инлайн-кнопки, см. ADMIN_CB), но по правкам церкви это убрали:
   * администрирование ведётся из Telegram и дашборда.
   */
  isAdmin(platform: PlatformName, userId: string): boolean {
    if (platform !== 'telegram') return false;
    return isAdmin(this.deps.admins.get(platform) ?? [], userId);
  }

  /** Показывает клавиатуру служителя: вызывается при /start и после шага с телефоном. */
  async showMenu(ctx: UpdateCtx, text = 'Меню служителя — кнопки снизу.'): Promise<void> {
    await this.reply(ctx, text);
  }

  /**
   * Служитель нажал кнопку, которой больше нет. Reply-клавиатура живёт в клиенте,
   * поэтому старые подписи будут приходить ещё какое-то время.
   */
  async explainRetired(ctx: UpdateCtx): Promise<void> {
    await this.reply(
      ctx,
      `Эта кнопка убрана: статистика, заявки, группы и ведущие теперь в дашборде.\n${this.deps.dashboardUrl}\n\n` +
        'В боте остались рассылки и выдача наборов — командами, см. /help.',
    );
  }

  async resetDialog(userId: number): Promise<void> {
    await this.deps.adminSessions.reset(userId);
  }

  /** Команда или нажатие кнопки клавиатуры. Возвращает true, если команда распознана. */
  async handleCommand(cmd: string, args: string, ctx: UpdateCtx, userId: number): Promise<boolean> {
    // Любая команда прерывает незаконченный диалог: иначе служитель в нём застрянет.
    const dialog = await this.deps.adminSessions.get(userId);
    if (dialog.state !== 'idle') await this.resetDialog(userId);

    switch (cmd) {
      case '/cancel':
        await this.reply(ctx, dialog.state === 'idle' ? 'Нечего отменять.' : 'Отменено.');
        return true;
      case '/help':
        await this.reply(ctx, HELP.replace(DASHBOARD_HINT, this.deps.dashboardUrl));
        return true;
      case '/export':
        await this.export(ctx);
        return true;
      case '/days':
        await this.listDays(ctx);
        return true;

      case '/setday':
        if (args) return this.saveDay(ctx, args);
        await this.ask(ctx, userId, 'setday:day', 'Какой день кампании загружаем? Напишите номер.');
        return true;

      case '/getday':
        if (args) return this.showDay(ctx, args);
        await this.ask(ctx, userId, 'getday:day', 'Материал какого дня показать? Напишите номер.');
        return true;

      case '/sendday':
        if (args) return this.prepareSendDay(ctx, userId, args);
        await this.ask(ctx, userId, 'sendday:day', 'Материал какого дня отправить участникам? Напишите номер.');
        return true;

      case '/broadcast':
        if (args) return this.prepareBroadcast(ctx, userId, args);
        await this.ask(ctx, userId, 'broadcast:text', 'Напишите текст объявления одним сообщением.');
        return true;

      case '/kit':
        if (args) return this.issueKitByQuery(args, ctx);
        await this.ask(ctx, userId, 'kit:query', 'Номер регистрации или ФИО участника?');
        return true;

      case '/admins':
        await this.listAdmins(ctx);
        return true;

      case '/reset':
        await this.askDbReset(ctx, userId);
        return true;

      default:
        return false;
    }
  }

  /** Ответ на вопрос мини-диалога. Возвращает true, если служитель был в диалоге. */
  async handleDialogStep(text: string, ctx: UpdateCtx, userId: number): Promise<boolean> {
    const dialog = await this.deps.adminSessions.get(userId);
    if (dialog.state === 'idle') return false;

    if (isCancel(text)) {
      await this.resetDialog(userId);
      await this.reply(ctx, 'Отменено.');
      return true;
    }

    switch (dialog.state) {
      case 'setday:day': {
        const day = this.parseDay(text);
        if (!day) {
          await this.ask(ctx, userId, 'setday:day', `Нужен номер дня от 1 до ${this.deps.schedule.totalDays}.`);
          return true;
        }
        await this.ask(ctx, userId, 'setday:text', `День ${day}. Пришлите текст материала одним сообщением.`, { day });
        return true;
      }

      case 'setday:text': {
        const day = dialog.data.day!;
        await this.deps.campaign.setDay(day, text.trim());
        await this.resetDialog(userId);
        await this.reply(ctx, `Материал дня ${day} сохранён.`);
        return true;
      }

      case 'getday:day': {
        const day = this.parseDay(text);
        if (!day) {
          await this.ask(ctx, userId, 'getday:day', `Нужен номер дня от 1 до ${this.deps.schedule.totalDays}.`);
          return true;
        }
        await this.resetDialog(userId);
        await this.showDay(ctx, String(day));
        return true;
      }

      case 'sendday:day': {
        const day = this.parseDay(text);
        if (!day) {
          await this.ask(ctx, userId, 'sendday:day', `Нужен номер дня от 1 до ${this.deps.schedule.totalDays}.`);
          return true;
        }
        await this.prepareSendDay(ctx, userId, String(day));
        return true;
      }

      case 'broadcast:text':
        await this.prepareBroadcast(ctx, userId, text);
        return true;

      case 'kit:query':
        await this.resetDialog(userId);
        await this.issueKitByQuery(text, ctx);
        return true;

      // Очистку подтверждают только своей кнопкой: словами такое не подтверждают.
      case 'reset:confirm':
        await this.reply(ctx, 'Подтвердите очистку кнопкой в сообщении выше или нажмите «Отмена».');
        return true;

      // Шаги, где ждём нажатие кнопки: текст просто просим заменить кнопкой.
      case 'sendday:confirm':
      case 'broadcast:confirm': {
        if (YES.includes(text.trim().toLowerCase())) {
          await this.runConfirmed(ctx, userId, dialog);
          return true;
        }
        await this.reply(ctx, 'Нажмите «Отправить» или «Отмена».', CONFIRM_BUTTONS);
        return true;
      }
    }
  }

  /** Нажатие инлайн-кнопки служителя: подтверждение рассылки или меню в MAX. */
  async handleCallback(data: string, ctx: UpdateCtx, userId: number): Promise<boolean> {
    const action = data.slice(ADMIN_CB.length);

    if (action === 'cancel') {
      await this.resetDialog(userId);
      await this.reply(ctx, 'Отменено.');
      return true;
    }

    // Очистка базы подтверждается отдельным действием: кнопка «Отправить» от рассылки
    // не должна случайно снести данные.
    if (action === 'reset_confirm') {
      await this.confirmDbReset(ctx, userId);
      return true;
    }

    if (action === 'confirm') {
      const dialog = await this.deps.adminSessions.get(userId);
      if (dialog.state !== 'broadcast:confirm' && dialog.state !== 'sendday:confirm') {
        await this.reply(ctx, 'Подтверждать нечего: рассылка уже отправлена или отменена.');
        return true;
      }
      await this.runConfirmed(ctx, userId, dialog);
      return true;
    }

    // В MAX кнопки меню приходят как callback, а не текстом.
    return this.handleCommand(action.startsWith('/') ? action : `/${action}`, '', ctx, userId);
  }

  // ── шаги и действия ───────────────────────────────────────────────────────

  private async ask(
    ctx: UpdateCtx,
    userId: number,
    state: AdminDialog['state'],
    text: string,
    data: AdminDialog['data'] = {},
  ): Promise<void> {
    await this.deps.adminSessions.set(userId, state, data);
    await this.deps.platforms
      .get(ctx.platform)
      ?.sendMessage(ctx.chatId, { text, actionMenu: CANCEL_MENU, format: 'html' });
  }

  /** Выдача набора по QR-коду участника: payload диплинка уже разобран роутером. */
  async issueKit(registrationNo: number, ctx: UpdateCtx): Promise<void> {
    const user = await this.deps.users.findByRegistrationNo(registrationNo);
    if (!user) {
      await this.reply(ctx, `Регистрация №${registrationNo} не найдена.`);
      return;
    }

    if (user.kit_issued_at) {
      await this.reply(
        ctx,
        `${participantCard(user)}\n\n⚠️ Набор уже выдан ${moscowDateTime(user.kit_issued_at)}.`,
      );
      return;
    }

    await this.deps.users.markKitIssued(user.id, ctx.platformUserId);
    await this.reply(ctx, `${participantCard(user)}\n\n✅ Набор выдан.`);
  }

  /** Номер регистрации или ФИО: служитель может не знать номера. */
  private async issueKitByQuery(query: string, ctx: UpdateCtx): Promise<boolean> {
    const trimmed = query.trim();

    if (/^\d+$/.test(trimmed)) {
      await this.issueKit(Number.parseInt(trimmed, 10), ctx);
      return true;
    }

    const found = await this.deps.users.searchByName(trimmed);
    if (found.length === 0) {
      await this.reply(ctx, `Участник «${esc(trimmed)}» не найден. Попробуйте номер регистрации.`);
      return true;
    }
    if (found.length === 1) {
      await this.issueKit(found[0]!.registration_no!, ctx);
      return true;
    }

    // Несколько совпадений: выдавать наугад нельзя, показываем список.
    const lines = found.map((u) => `${b(`№${u.registration_no}`)} ${esc(u.full_name)}`);
    await this.reply(ctx, [b('Нашлось несколько участников:'), '', ...lines, '', 'Повторите с номером.'].join('\n'));
    return true;
  }

  /**
   * Кто сейчас видит клавиатуру служителя.
   *
   * Отдельно помечаем тех, кто ещё не писал боту: права у них есть, но уведомления
   * о заявках им не дойдут, потому что Telegram не даёт боту начать разговор первым.
   */
  private async listAdmins(ctx: UpdateCtx): Promise<void> {
    const lines = [b('🔑 Клавиатуру служителя видят')];

    for (const platform of this.deps.platforms.keys()) {
      const ids = this.deps.admins.get(platform) ?? [];
      if (this.deps.platforms.size > 1) lines.push('', i(PLATFORM_LABEL[platform]));

      if (ids.length === 0) {
        lines.push('', 'никто: список ADMIN_IDS пуст');
        continue;
      }

      // Имя берём из базы, но доступность спрашиваем у платформы:
      // очистка базы прав не отменяет, а запись о человеке при этом исчезает.
      const known = await this.deps.users.findByPlatformIds(platform, ids);
      const byId = new Map(known.map((u) => [u.platform_user_id, u]));
      const client = this.deps.platforms.get(platform);

      for (const id of ids) {
        const user = byId.get(id);
        const nick = user?.username ? ` @${esc(user.username)}` : '';
        const self = id === ctx.platformUserId ? ' · это вы' : '';
        // Спрашиваем про чат, а не про человека: в MAX это разные id, и про id человека
        // платформа честно отвечает «чат не найден» — доступность выходила ложно плохой.
        const reachable = client ? await client.canReach(user?.chat_id || id) : false;

        lines.push('', `${code(id)}${self}`);
        if (user?.full_name || nick) lines.push(`${esc(user?.full_name ?? '')}${nick}`.trim());
        lines.push(
          reachable
            ? '✅ бот может ему писать, уведомления дойдут'
            : '⚠️ бот не может ему писать: пусть откроет бота и нажмёт «Начать»',
        );
      }
    }

    lines.push('', `Список задаётся в .env: ${code('ADMIN_IDS_TELEGRAM')}, ${code('ADMIN_IDS_MAX')}.`);
    lines.push('Очистка базы права служителей не затрагивает.');
    lines.push(`Свой id человек узнаёт командой ${code('/whoami')}.`);

    await this.reply(ctx, lines.join('\n'));
  }

  /** Предупреждение перед очисткой: показываем, что именно исчезнет. */
  private async askDbReset(ctx: UpdateCtx, userId: number): Promise<void> {
    if (!this.deps.allowDbReset) {
      await this.reply(
        ctx,
        `Очистка базы выключена. Чтобы включить на время тестов, задайте ${code('ALLOW_DB_RESET=true')} в .env.`,
      );
      return;
    }

    const counts = await this.deps.maintenance.counts();
    const lines = counts.filter((c) => c.rows > 0).map((c) => `${c.table}: ${c.rows}`);

    await this.deps.adminSessions.set(userId, 'reset:confirm', {});
    await this.reply(
      ctx,
      [
        `🧹 ${b('Очистить базу полностью?')}`,
        '',
        lines.length ? 'Будет удалено:' : 'База уже пуста.',
        ...lines,
        '',
        `Это удалит ${b(participants(counts.find((c) => c.table === 'users')?.rows ?? 0))}, ` +
          'все заявки, материалы дней и журнал рассылок. Восстановить будет нельзя.',
        'Настройки и схема базы не тронутся.',
      ].join('\n'),
      [
        [
          { kind: 'callback', text: '🧹 Да, удалить всё', data: `${ADMIN_CB}reset_confirm` },
          { kind: 'callback', text: '✖️ Отмена', data: `${ADMIN_CB}cancel` },
        ],
      ],
    );
  }

  private async confirmDbReset(ctx: UpdateCtx, userId: number): Promise<void> {
    if (!this.deps.allowDbReset) {
      await this.reply(ctx, 'Очистка базы выключена настройками.');
      return;
    }

    const dialog = await this.deps.adminSessions.get(userId);
    if (dialog.state !== 'reset:confirm') {
      await this.reply(ctx, 'Подтверждать нечего: очистка уже выполнена или отменена.');
      return;
    }

    await this.deps.maintenance.resetAll();
    this.deps.logger.warn({ admin: ctx.platformUserId }, 'база кампании очищена служителем');
    await this.reply(
      ctx,
      [
        `🧹 ${b('База очищена.')}`,
        '',
        'Участники, заявки, материалы дней и журнал рассылок удалены.',
        'Номера регистрации снова начнутся с единицы.',
      ].join('\n'),
    );
  }

  private async reply(ctx: UpdateCtx, text: string, buttons?: Button[][]): Promise<void> {
    await this.deps.platforms.get(ctx.platform)?.sendMessage(ctx.chatId, {
      text,
      buttons,
      // Клавиатуру возвращаем вместе с ответом. Если у сообщения есть инлайн-кнопки,
      // Telegram не умеет показать обе клавиатуры сразу, поэтому меню остаётся прежним.
      actionMenu: buttons ? undefined : adminMenu(this.deps.allowDbReset),
      format: 'html',
    });
  }

  private parseDay(raw: string): number | null {
    const day = Number.parseInt(raw.replace(/\D/g, ''), 10);
    if (!Number.isFinite(day) || day < 1 || day > this.deps.schedule.totalDays) return null;
    return day;
  }

  private async saveDay(ctx: UpdateCtx, args: string): Promise<boolean> {
    const match = args.match(/^(\d+)\s+([\s\S]+)$/);
    if (!match) {
      await this.reply(ctx, `Формат: ${code('/setday <день> <текст материала>')}`);
      return true;
    }
    const day = this.parseDay(match[1]!);
    if (!day) {
      await this.reply(ctx, `День должен быть от 1 до ${this.deps.schedule.totalDays}.`);
      return true;
    }
    await this.deps.campaign.setDay(day, match[2]!.trim());
    await this.reply(ctx, `Материал дня ${day} сохранён.`);
    return true;
  }

  private async showDay(ctx: UpdateCtx, args: string): Promise<boolean> {
    const day = this.parseDay(args);
    if (!day) {
      await this.reply(ctx, `Нужен номер дня от 1 до ${this.deps.schedule.totalDays}.`);
      return true;
    }
    const content = await this.deps.campaign.getDay(day);
    await this.reply(
      ctx,
      content ? `📖 ${b(`День ${day}`)}\n\n${esc(content.content)}` : `Материал дня ${day} не загружен.`,
    );
    return true;
  }

  private async prepareSendDay(ctx: UpdateCtx, userId: number, args: string): Promise<boolean> {
    const day = this.parseDay(args);
    if (!day) {
      await this.ask(ctx, userId, 'sendday:day', `Нужен номер дня от 1 до ${this.deps.schedule.totalDays}.`);
      return true;
    }
    const content = await this.deps.campaign.getDay(day);
    if (!content) {
      await this.ask(ctx, userId, 'sendday:day', `Материал дня ${day} не загружен. Напишите другой номер.`);
      return true;
    }

    await this.deps.adminSessions.set(userId, 'sendday:confirm', { day });
    const count = await this.recipientCount();
    await this.reply(
      ctx,
      `🚀 Отправить материал дня ${b(day)} — ${b(toParticipants(count))}?\n\n${esc(content.content.slice(0, 300))}`,
      CONFIRM_BUTTONS,
    );
    return true;
  }

  private async prepareBroadcast(ctx: UpdateCtx, userId: number, body: string): Promise<boolean> {
    const text = body.trim();
    if (!text) {
      await this.ask(ctx, userId, 'broadcast:text', 'Текст объявления не может быть пустым.');
      return true;
    }

    await this.deps.adminSessions.set(userId, 'broadcast:confirm', { body: text });
    const count = await this.recipientCount();
    await this.reply(ctx, `📣 Отправить объявление ${b(toParticipants(count))}?\n\n${esc(text)}`, CONFIRM_BUTTONS);
    return true;
  }

  /** Массовая отправка выполняется только после подтверждения: случайное нажатие уходит всем. */
  private async runConfirmed(ctx: UpdateCtx, userId: number, dialog: AdminDialog): Promise<void> {
    await this.resetDialog(userId);

    if (dialog.state === 'broadcast:confirm') {
      await this.runBroadcast(ctx, `adhoc:${randomUUID()}`, dialog.data.body ?? '', 'Объявление', userId);
      return;
    }

    const day = dialog.data.day!;
    const content = await this.deps.campaign.getDay(day);
    if (!content) {
      await this.reply(ctx, `Материал дня ${day} не загружен, отправлять нечего.`);
      return;
    }
    await this.runBroadcast(ctx, `day:${day}`, content.content, `Материал дня ${day}`, userId);
  }

  private async recipientCount(): Promise<number> {
    let total = 0;
    for (const platform of this.deps.platforms.keys()) {
      total += (await this.deps.users.recipients(platform)).length;
    }
    return total;
  }

  /** Заявка обработана: служитель уже позвонил человеку по телефону из уведомления. */
  private async export(ctx: UpdateCtx): Promise<void> {
    const rows = await this.deps.users.exportRows();
    if (rows.length === 0) {
      await this.reply(ctx, 'Пока нет ни одной завершённой анкеты.');
      return;
    }

    const { usersToCsv } = await import('../csv.js');
    const csv = usersToCsv(rows);
    const date = localDate(new Date(), this.deps.schedule.timezone);
    await this.deps.platforms.get(ctx.platform)?.sendFile(
      ctx.chatId,
      {
        name: `church40-participants-${date}.csv`,
        content: Buffer.from(csv, 'utf8'),
        mime: 'text/csv',
      },
      `Участники кампании: ${rows.length}`,
    );
  }

  private async listDays(ctx: UpdateCtx): Promise<void> {
    const days = await this.deps.campaign.listDays();
    const total = this.deps.schedule.totalDays;

    if (days.length === 0) {
      await this.reply(ctx, `📅 Ни один день пока не загружен.\n\nЗагрузить: ${code('/setday <день> <текст>')}`);
      return;
    }

    const loaded = days.map((d) => d.day);
    const missing: number[] = [];
    for (let d = 1; d <= total; d += 1) if (!loaded.includes(d)) missing.push(d);

    const lines = [
      `📅 ${b('Материалы кампании')}`,
      '',
      `Загружено: ${b(`${days.length} из ${total}`)}`,
      `✅ ${formatDayRanges(loaded)}`,
    ];
    if (missing.length) lines.push(`⬜ не хватает: ${formatDayRanges(missing)}`);
    lines.push('', `Посмотреть материал: ${code('/getday <день>')}`);

    await this.reply(ctx, lines.join('\n'));
  }

  private async runBroadcast(
    ctx: UpdateCtx,
    key: string,
    body: string,
    title: string,
    adminUserId?: number,
  ): Promise<void> {
    const platforms = [...this.deps.platforms.keys()];
    const { created, queued } = await this.deps.deliveries.open(key, body, platforms);

    if (!created && queued === 0) {
      const summary = await this.deps.deliveries.summary(key);
      await this.reply(ctx, `${title} уже отправляли. Итог: ${JSON.stringify(summary)}`);
      return;
    }

    const result = await this.deps.sender.run(key);
    const lines = [
      `✅ ${b(`${title} отправлено`)}`,
      '',
      `Доставлено: ${b(result.sent)}`,
      `Ошибок: ${b(result.failed)}`,
      `Заблокировали бота: ${b(result.blocked)}`,
    ];

    // Служитель обычно и сам участник кампании, поэтому получает рассылку наравне со всеми.
    // Без этой строчки его собственная копия выглядит как повтор превью из подтверждения.
    if (adminUserId !== undefined && (await this.deps.deliveries.wasDelivered(key, adminUserId))) {
      lines.push('', 'Вы тоже в списке участников, поэтому копия пришла вам сообщением выше.');
    }

    await this.reply(ctx, lines.join('\n'));
  }
}

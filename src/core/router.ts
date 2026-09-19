import { ADMIN_CB, adminMenu, commandByLabel, retiredLabel } from '../admin/menu.js';
import { AdminNotifier } from '../admin/notify.js';
import type { Deps } from '../deps.js';
import { campaignIsActive } from '../broadcast/schedule.js';
import { AdminFlow } from './flows/admin.flow.js';
import { handleUpdate, profileRows, type Draft, type OutAction, type Participant } from './fsm.js';
import { kitPayload, parseKitPayload, qrPng } from './qr.js';
import { SendError, type IncomingUpdate, type Platform, type UpdateCtx } from './platform.js';
import { CB, KIT_DATE, T, menuKeyboard } from './texts.js';
import type { RequestWithUser } from '../db/repos/requests.repo.js';

const USER_HELP = [
  'Я бот регистрации на кампанию.',
  '',
  '/start — начать или открыть меню',
  '/menu — меню участника',
  '/help — эта справка',
].join('\n');

/**
 * Апдейты, которые значат то же, что «/start»: открыть меню или начать анкету.
 *
 * «▶️ Старт» на клавиатуре служителя — не его команда, а вход в анкету, и разбор
 * админских кнопок про неё не знает. Подпись приходит текстом в Telegram, callback'ом
 * в MAX; без этой подмены нажатие в MAX молчало вовсе, а в Telegram посреди анкеты
 * уходило ответом на вопрос — «▶️ Старт» успешно проходило проверку ФИО.
 */
function isStart(u: IncomingUpdate): boolean {
  if (u.kind === 'text') return /^\/menu\b/i.test(u.text.trim()) || commandByLabel(u.text) === '/start';
  return u.kind === 'callback' && u.data === `${ADMIN_CB}/start`;
}

/**
 * Связывает платформы, диалог и базу.
 * Здесь и только здесь исполняются эффекты, которые вернул FSM.
 */
export class Router {
  private readonly admin: AdminFlow;
  private readonly notifier: AdminNotifier;

  constructor(private readonly deps: Deps) {
    this.admin = new AdminFlow(deps);
    this.notifier = new AdminNotifier(deps);
  }

  async handle(incoming: IncomingUpdate): Promise<void> {
    const platform = this.deps.platforms.get(incoming.ctx.platform);
    if (!platform) return;

    // На уровне debug видно, какая именно кнопка нажата: нужно при разборе жалоб «нажал не то».
    this.deps.logger.debug(
      {
        kind: incoming.kind,
        user: incoming.ctx.platformUserId,
        data: incoming.kind === 'callback' ? incoming.data : undefined,
      },
      'входящий апдейт',
    );

    // Подтверждаем нажатие сразу: иначе у человека «крутится» кнопка.
    if (incoming.kind === 'callback') {
      try {
        await platform.ackCallback(incoming.callbackId);
      } catch (err) {
        this.deps.logger.warn({ err }, 'не удалось подтвердить нажатие кнопки');
      }
    }

    // «/menu» это то же, что «/start»: открыть меню или начать анкету.
    const update: IncomingUpdate = isStart(incoming) ? { kind: 'start', ctx: incoming.ctx } : incoming;

    const user = await this.deps.users.ensure({
      platform: update.ctx.platform,
      platformUserId: update.ctx.platformUserId,
      chatId: update.ctx.chatId,
      username: update.ctx.username,
    });

    const admin = this.admin.isAdmin(update.ctx.platform, update.ctx.platformUserId);

    // QR-код выдачи набора это ссылка вида t.me/bot?start=kit_42.
    // Служитель наводит камеру, бот отмечает выдачу; обычному участнику payload не нужен.
    if (update.kind === 'start' && update.payload) {
      const registrationNo = parseKitPayload(update.payload);
      if (registrationNo !== null && admin) {
        await this.admin.issueKit(registrationNo, update.ctx);
        return;
      }
    }

    if (admin) {
      // Кнопки клавиатуры служителя: в Telegram приходят текстом, в MAX callback'ом.
      if (update.kind === 'callback' && update.data.startsWith(ADMIN_CB)) {
        await this.admin.handleCallback(update.data, update.ctx, user.id);
        return;
      }
      if (update.kind === 'text') {
        const byButton = commandByLabel(update.text);
        if (byButton && (await this.admin.handleCommand(byButton, '', update.ctx, user.id))) return;
        // Reply-клавиатура живёт в клиенте: у служителя она останется старой, пока бот
        // не пришлёт новую. Без этой ветки подпись снятой кнопки ушла бы в анкету.
        if (retiredLabel(update.text)) {
          await this.admin.explainRetired(update.ctx);
          return;
        }
      }
      // /start начинает всё заново, поэтому недоделанный админский диалог сбрасываем.
      if (update.kind === 'start') await this.admin.resetDialog(user.id);
    }

    if (update.kind === 'text' && update.text.trimStart().startsWith('/')) {
      if (await this.handleCommand(update.text.trim(), update.ctx, user.id)) return;
    }

    // Служитель отвечает на вопрос мини-диалога: этот текст не должен попасть в анкету.
    if (admin && update.kind === 'text' && (await this.admin.handleDialogStep(update.text, update.ctx, user.id))) {
      return;
    }

    const session = await this.deps.sessions.get(user.id);
    // Регистрация считается состоявшейся с момента присвоения номера.
    const registered = user.registration_no !== null;
    // Открытые заявки нужны диалогу, чтобы не плодить повторные по одной и той же кнопке.
    const openRequests = registered ? await this.deps.requests.openTypes(user.id) : [];
    // Считаем только вопросы: у заявок на группу запрет на повтор, а вопросов
    // может быть несколько, там ограничение по числу неотвеченных.
    const openQuestions = openRequests.includes('question')
      ? await this.deps.requests.openCount(user.id, 'question')
      : 0;
    /*
     * Сверка телефона перед заявкой на открытие группы.
     *
     * Запрет на повтор по user.id не спасает: users у нас отдельные на каждую
     * платформу, и один человек мог подать заявку и из Telegram, и из MAX. Считаем
     * только там, где заявка вообще может появиться — кнопка меню и подтверждение
     * анкеты, — и только если своей открытой заявки ещё нет: она важнее сверки.
     */
    // Точки, где может появиться заявка на открытие группы: выбор в анкете, кнопка
    // меню и подтверждение анкеты. Гонять два запроса на каждое сообщение незачем.
    const LEAD_POINTS: readonly string[] = [CB.mdgOpen, CB.mdgHome, CB.menuLead, CB.confirm];
    const mayLead = update.kind === 'callback' && LEAD_POINTS.includes(update.data);
    const leadPhoneTaken = mayLead && user.phone && !openRequests.includes('lead_group')
      ? await this.leadPhoneTaken(user.phone)
      : undefined;

    const participant: Participant | undefined = registered
      ? {
          complete: user.complete,
          registrationNo: user.registration_no,
          mdgStatus: user.mdg_status,
          kitIssued: user.kit_issued_at !== null,
        }
      : undefined;

    const result = handleUpdate({
      state: session.state,
      draft: session.draft,
      update,
      registered,
      participant,
      openRequests,
      openQuestions,
      leadPhoneTaken,
    });

    const created: RequestWithUser[] = [];
    /** Номер регистрации, присвоенный на этом шаге: по нему отправляем карточку с QR. */
    let assignedNo: number | null = null;

    /*
     * Каждый эффект — свой try/catch. Раньше падение одного (например,
     * finishRegistration) обрывало цикл до конца, и заявку из того же хода
     * терять: единственным следом был общий лог bot.catch() без адреса и
     * контекста. Эффекты пишут в разные таблицы независимо друг от друга,
     * поэтому падение соседнего не должно стоить человеку заявки — самого
     * важного из того, что тут происходит.
     */
    for (const effect of result.effects) {
      try {
        switch (effect.kind) {
          case 'consent':
            await this.deps.users.saveConsent(user.id);
            break;
          case 'save':
            await this.deps.users.savePatch(user.id, effect.patch);
            break;
          case 'finish': {
            const no = await this.deps.users.finishRegistration(user.id, effect.complete);
            // Карточку с номером и QR отправляем только при первом присвоении.
            if (user.registration_no === null) assignedNo = no;
            // «40 дней»: анкету спрашивает телефон задолго до этого шага, поэтому
            // user.phone (загружен в начале хода) уже актуален.
            if (effect.complete && user.phone) await this.deps.groups.markCampaignRegisteredByPhone(user.phone);
            break;
          }
          case 'create_request': {
            const request = await this.deps.requests.create(user.id, effect.type, effect.text);
            created.push(request);
            this.deps.logger.info(
              { userId: user.id, effectKind: effect.kind, effectType: effect.type, requestId: request.id },
              'заявка заведена в базу',
            );
            break;
          }
        }
      } catch (err) {
        const effectType = effect.kind === 'create_request' ? effect.type : undefined;
        this.deps.logger.error(
          { err, userId: user.id, effectKind: effect.kind, effectType },
          'эффект диалога не выполнен',
        );
      }
    }

    await this.deps.sessions.set(user.id, result.state, result.draft);

    /*
     * На шаге, где регистрация завершилась, карточка с номером и QR идёт первой,
     * а итог ветки («Спасибо за ваше желание открыть свой дом…») — сразу за ней.
     * Иначе человек сначала читал благодарность и только потом узнавал номер.
     * На всех остальных шагах assignedNo пустой, и порядок обычный.
     */
    if (assignedNo !== null) {
      await this.sendRegistrationCard(platform, update.ctx.chatId, assignedNo, result.draft);
    }

    for (const action of result.actions) {
      await this.send(platform, update.ctx, user.id, action, admin);
    }

    // Клавиатуру служителя показываем при /start: в остальных случаях она уже стоит в чате.
    // Но не поверх запроса контакта: в Telegram reply-клавиатура одна на чат, и меню
    // забрало бы кнопку «поделиться номером» с собой. После присланного номера
    // клавиатура вернётся сама (см. clear_contact_ui в send).
    const asksContact = result.actions.some((a) => a.kind === 'request_contact');
    if (admin && update.kind === 'start' && !asksContact) await this.admin.showMenu(update.ctx);

    for (const request of created) {
      await this.notifier.notifyRequest(request);
    }
  }

  /**
   * Сверка только по действующей группе реестра, не по открытой заявке: заявка
   * могла остаться «В работе» в дашборде и после того, как саму группу закрыли
   * (закрытие группы не закрывает её заявку автоматически) — из-за этого бот
   * отказывал в повторной регистрации по номеру, хотя по дашборду человека
   * «как будто и нет в ведущих». Раньше здесь была ещё проверка по заявке —
   * её убрали по правкам церкви.
   *
   * На время кампании (день 1..CAMPAIGN_DAYS) проверку снимаем: ведущий
   * действующей группы может на время кампании открыть ещё одну.
   */
  private async leadPhoneTaken(phone: string): Promise<'group' | undefined> {
    if (campaignIsActive(new Date(), this.deps.schedule)) return undefined;
    if (await this.deps.groups.activeLeaderByPhone(phone)) return 'group';
    return undefined;
  }

  /**
   * Номер регистрации, QR-код и все заполненные данные — одним сообщением: его
   * можно целиком переслать или распечатать, а номер виден сразу под фото, а не
   * только в отдельном сообщении текстом выше.
   *
   * В QR кладём ссылку, открывающую бота у служителя; если платформа диплинки не умеет,
   * в код попадает сам номер, и служитель вводит его руками.
   */
  private async sendRegistrationCard(
    platform: Platform,
    chatId: string,
    registrationNo: number,
    draft: Draft,
  ): Promise<void> {
    try {
      const caption = [
        T.registeredTitle,
        '',
        T.registrationNo(registrationNo),
        '',
        ...profileRows(draft),
        '',
        T.kitByQr(KIT_DATE),
      ].join('\n');

      const link = platform.deepLink(kitPayload(registrationNo));
      const png = await qrPng(link ?? `Регистрация №${registrationNo}`);
      await platform.sendPhoto(
        chatId,
        { name: `registration-${registrationNo}.png`, content: png, mime: 'image/png' },
        caption,
      );
    } catch (err) {
      // Регистрация уже сохранена, поэтому сбой картинки не должен ломать диалог.
      // Но номер после объединения в одно сообщение шёл бы только в этой карточке —
      // если она не отправилась, человек не узнал бы его вовсе. Подстраховываемся
      // текстом.
      this.deps.logger.error({ err, registrationNo }, 'не удалось отправить карточку регистрации');
      try {
        await platform.sendMessage(chatId, {
          text: `${T.registeredTitle}\n\n${T.registrationNo(registrationNo)}`,
        });
      } catch (fallbackErr) {
        this.deps.logger.error({ err: fallbackErr, registrationNo }, 'не удалось отправить даже номер регистрации');
      }
    }
  }

  /** Возвращает true, если команда обработана и запускать диалог не нужно. */
  private async handleCommand(text: string, ctx: UpdateCtx, userId: number): Promise<boolean> {
    const [head = ''] = text.split(/\s+/);
    // В группах Telegram команды приходят как «/export@ChurchBot».
    const cmd = head.replace(/@.*$/, '').toLowerCase();
    const args = text.slice(head.length).trim();

    if (cmd === '/start') return false;

    if (cmd === '/whoami') {
      await this.deps.platforms
        .get(ctx.platform)
        ?.sendMessage(ctx.chatId, {
          text: `Платформа: ${ctx.platform}\nВаш id: ${ctx.platformUserId}\n\nЭтот id нужен для ADMIN_IDS.`,
        });
      return true;
    }

    if (this.admin.isAdmin(ctx.platform, ctx.platformUserId)) {
      if (await this.admin.handleCommand(cmd, args, ctx, userId)) return true;
    }

    if (cmd === '/help') {
      await this.deps.platforms.get(ctx.platform)?.sendMessage(ctx.chatId, { text: USER_HELP });
      return true;
    }

    // Неизвестная команда: подсказываем меню, но не считаем её ответом на вопрос анкеты.
    await this.deps.platforms
      .get(ctx.platform)
      ?.sendMessage(ctx.chatId, { text: `Не знаю такую команду.\n\n${T.menuHint}`, buttons: menuKeyboard() });
    return true;
  }

  private async send(
    platform: Platform,
    ctx: UpdateCtx,
    userId: number,
    action: OutAction,
    admin = false,
  ): Promise<void> {
    /*
     * Что именно бот ответил — видно только здесь: сообщения участнику уходят
     * через эту воронку. Пишем на уровне debug, чтобы в обычной работе тексты
     * людей в журнал не попадали: включается через LOG_LEVEL=debug на время разбора.
     */
    this.deps.logger.debug(
      { platform: ctx.platform, chatId: ctx.chatId, kind: action.kind, text: action.text,
        buttons: action.buttons?.flat().map((b) => b.text) },
      'бот отвечает',
    );

    try {
      switch (action.kind) {
        case 'request_contact':
          await platform.requestContact(ctx.chatId, action.text);
          return;
        case 'clear_contact_ui':
          // Служителю новая клавиатура заменяет кнопку телефона: убирать её отдельно не нужно.
          if (admin) {
            await platform.sendMessage(ctx.chatId, { text: action.text, actionMenu: adminMenu(this.deps.allowDbReset) });
            return;
          }
          await platform.clearContactUi(ctx.chatId, action.text);
          return;
        default:
          await platform.sendMessage(ctx.chatId, { text: action.text, buttons: action.buttons });
          return;
      }
    } catch (err) {
      if (err instanceof SendError && (err.kind === 'blocked' || err.kind === 'not_found')) {
        await this.deps.users.markBlocked(userId);
        this.deps.logger.info({ userId }, 'участник заблокировал бота');
        return;
      }
      this.deps.logger.error({ err, userId }, 'не удалось отправить сообщение участнику');
    }
  }
}

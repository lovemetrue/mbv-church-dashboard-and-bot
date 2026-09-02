import { ADMIN_CB, adminMenu, commandByLabel, retiredLabel } from '../admin/menu.js';
import { AdminNotifier } from '../admin/notify.js';
import type { Deps } from '../deps.js';
import { AdminFlow } from './flows/admin.flow.js';
import { handleUpdate, type OutAction, type Participant } from './fsm.js';
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
    const update: IncomingUpdate =
      incoming.kind === 'text' && /^\/menu\b/i.test(incoming.text.trim())
        ? { kind: 'start', ctx: incoming.ctx }
        : incoming;

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
    const mayLead = update.kind === 'callback'
      && (update.data === CB.menuLead || update.data === CB.confirm);
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

    for (const effect of result.effects) {
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
          break;
        }
        case 'create_request':
          created.push(await this.deps.requests.create(user.id, effect.type, effect.text));
          break;
      }
    }

    await this.deps.sessions.set(user.id, result.state, result.draft);

    for (const action of result.actions) {
      await this.send(platform, update.ctx, user.id, action, admin);
    }

    // Клавиатуру служителя показываем при /start: в остальных случаях она уже стоит в чате.
    // Но не поверх запроса контакта: в Telegram reply-клавиатура одна на чат, и меню
    // забрало бы кнопку «поделиться номером» с собой. После присланного номера
    // клавиатура вернётся сама (см. clear_contact_ui в send).
    const asksContact = result.actions.some((a) => a.kind === 'request_contact');
    if (admin && update.kind === 'start' && !asksContact) await this.admin.showMenu(update.ctx);

    if (assignedNo !== null) {
      await this.sendRegistrationCard(platform, update.ctx.chatId, assignedNo);
    }

    for (const request of created) {
      await this.notifier.notifyRequest(request);
    }
  }

  /**
   * Что нашла сверка номера: открытая заявка на открытие группы или действующая группа.
   *
   * Порядок важен — от него зависит, что человек прочтёт. Про уже принятую заявку
   * говорим «служитель свяжется», про действующую группу — «идите к координатору».
   */
  private async leadPhoneTaken(phone: string): Promise<'request' | 'group' | undefined> {
    if (await this.deps.requests.openLeadByPhone(phone)) return 'request';
    if (await this.deps.groups.activeLeaderByPhone(phone)) return 'group';
    return undefined;
  }

  /**
   * Номер регистрации и QR-код: по ТЗ по нему выдают набор участника.
   * В QR кладём ссылку, открывающую бота у служителя; если платформа диплинки не умеет,
   * в код попадает сам номер, и служитель вводит его руками.
   */
  private async sendRegistrationCard(platform: Platform, chatId: string, registrationNo: number): Promise<void> {
    try {
      await platform.sendMessage(chatId, {
        text: `${T.registeredTitle}\n\n${T.registrationNo(registrationNo)}`,
      });

      const link = platform.deepLink(kitPayload(registrationNo));
      const png = await qrPng(link ?? `Регистрация №${registrationNo}`);
      await platform.sendPhoto(
        chatId,
        { name: `registration-${registrationNo}.png`, content: png, mime: 'image/png' },
        T.kitByQr(KIT_DATE),
      );
    } catch (err) {
      // Регистрация уже сохранена, поэтому сбой картинки не должен ломать диалог.
      this.deps.logger.error({ err, registrationNo }, 'не удалось отправить карточку регистрации');
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

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Bot, Keyboard } from '@maxhub/max-bot-api';
import type { AttachmentRequest } from '@maxhub/max-bot-api/types';
import type {
  ActionButton,
  Button,
  IncomingUpdate,
  OutFile,
  OutMessage,
  Platform,
  UpdateCtx,
} from '../core/platform.js';
import { ADMIN_CB } from '../admin/menu.js';
import { normalizePhone } from '../core/phone.js';
import { splitLongText } from '../core/split.js';
import { BTN } from '../core/texts.js';
import { parseVcfPhone } from '../core/vcf.js';
import { supervisePolling } from './polling.js';
import { logger as defaultLogger, type Logger } from '../logger.js';
import { maxSendError } from './max.errors.js';

/** Лимит текста в MAX не документирован жёстко, режем консервативно. */
const MAX_LEN = 3800;

/** В MAX клавиатура это вложение к сообщению, а не отдельное поле. */
function keyboardAttachment(buttons?: Button[][]): AttachmentRequest[] | undefined {
  if (!buttons?.length) return undefined;
  const rows = buttons.map((row) =>
    row.map((b) =>
      b.kind === 'callback' ? Keyboard.button.callback(b.text, b.data) : Keyboard.button.link(b.text, b.url),
    ),
  );
  return [Keyboard.inlineKeyboard(rows)];
}

/** Меню служителя в MAX: те же действия, но callback-кнопками. */
function actionMenuButtons(menu?: ActionButton[][]): Button[][] | undefined {
  if (!menu?.length) return undefined;
  return menu.map((row) => row.map((b) => ({ kind: 'callback' as const, text: b.label, data: ADMIN_CB + b.command })));
}

export class MaxAdapter implements Platform {
  readonly name = 'max' as const;
  private readonly bot: Bot;
  private handler?: (update: IncomingUpdate) => Promise<void>;
  /** Штатная остановка: надзор за опросом по ней прекращает перезапуски. */
  private stopped = false;

  /**
   * @param apiUrl адрес API MAX. По умолчанию SDK берёт platform-api2.max.ru,
   *   но этот хост не отвечает: TLS проходит, запрос уходит, а ответ обрывается —
   *   проверено и с локальной машины, и с сервера. Пока так, работаем через
   *   platform-api.max.ru; когда MAX починит v2, достаточно поменять MAX_API_URL.
   */
  constructor(
    token: string,
    private readonly log: Logger = defaultLogger,
    apiUrl = 'https://platform-api.max.ru',
  ) {
    this.bot = new Bot(token, { clientOptions: { baseUrl: apiUrl } });
    this.wire();
  }

  private ctxOf(userId: number | undefined, chatId: number | undefined, username?: string | null): UpdateCtx {
    return {
      platform: 'max',
      platformUserId: String(userId ?? chatId ?? ''),
      chatId: String(chatId ?? userId ?? ''),
      username: username ?? undefined,
    };
  }

  private wire(): void {
    this.bot.catch((err) => {
      this.log.error({ err: err instanceof Error ? err.message : err }, 'ошибка обработки апдейта MAX');
    });

    // Нажатие «Начать» в MAX приходит отдельным типом апдейта, а не текстом «/start».
    this.bot.on('bot_started', async (ctx) => {
      const payload = ctx.startPayload?.trim();
      await this.emit({
        kind: 'start',
        ctx: this.ctxOf(ctx.user?.user_id, ctx.chatId, ctx.user?.username),
        ...(payload ? { payload } : {}),
      });
    });

    this.bot.on('message_created', async (ctx) => {
      const message = ctx.message;
      if (!message) return;
      const sender = message.sender;
      const chatId = message.recipient.chat_id ?? ctx.chatId;
      const updateCtx = this.ctxOf(sender?.user_id, chatId ?? undefined, sender?.username);

      const contact = message.body.attachments?.find((a) => a.type === 'contact');
      if (contact) {
        const phone = this.extractPhone(ctx.contactInfo?.tel, contact);
        if (phone) {
          await this.emit({
            kind: 'contact',
            ctx: updateCtx,
            phone,
            firstName: ctx.contactInfo?.fullName,
            // Кнопка запроса контакта присылает только собственный номер.
            isOwn: true,
          });
          return;
        }
      }

      const text = message.body.text?.trim();
      if (!text) return;

      const startMatch = text.match(/^\/start(?:\s+(.+))?$/i);
      if (startMatch) {
        const payload = startMatch[1]?.trim();
        await this.emit({ kind: 'start', ctx: updateCtx, ...(payload ? { payload } : {}) });
        return;
      }

      await this.emit({ kind: 'text', ctx: updateCtx, text });
    });

    this.bot.on('message_callback', async (ctx) => {
      const callback = ctx.callback;
      const chatId = ctx.chatId ?? ctx.message?.recipient.chat_id;
      await this.emit({
        kind: 'callback',
        ctx: this.ctxOf(callback.user?.user_id, chatId ?? undefined, callback.user?.username),
        data: callback.payload ?? '',
        callbackId: callback.callback_id,
      });
    });
  }

  /** Номер приходит внутри VCF, поэтому берём его из разобранного контакта или из самой карточки. */
  private extractPhone(tel: string | undefined, contact: { payload?: { vcf_info?: string | null } }): string | null {
    if (tel) return normalizePhone(tel);
    return parseVcfPhone(contact.payload?.vcf_info ?? '');
  }

  private async emit(update: IncomingUpdate): Promise<void> {
    if (!this.handler) return;
    await this.handler(update);
  }

  onUpdate(handler: (update: IncomingUpdate) => Promise<void>): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    // Проверка токена и адреса API до запуска polling: при ошибке видно сразу, а не «бот молчит».
    const info = await this.bot.api.getMyInfo();
    this.log.info({ bot: info.username ?? info.name, id: info.user_id }, 'MAX: бот подключён');

    /*
     * Опрос не ждём — он завершается только вместе с ботом, — но и не отпускаем
     * без присмотра. Библиотека завершает `Polling.loop` на любой ошибке: сетевую
     * и 5xx «повторяет» через return из while, остальное бросает наружу. Раньше
     * здесь стоял `.catch(log)`, и после первого сбоя MAX замолкал насовсем: процесс
     * жив, Telegram работает, docker считает контейнер здоровым. Так и вышло 29.08 —
     * шлюз MAX отдал HTML вместо JSON, и бот молчал двое суток.
     */
    void supervisePolling({
      poll: () => this.bot.start(),
      // Обязательный сброс: после смерти цикла флаг pollingIsStarted остаётся
      // поднятым, и повторный bot.start() молча вышел бы, ничего не запустив.
      reset: () => { this.bot.stop(); },
      stopped: () => this.stopped,
      log: this.log.child({ platform: 'max' }),
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.bot.stop();
  }

  async sendMessage(chatId: string, msg: OutMessage): Promise<void> {
    const parts = splitLongText(msg.text, MAX_LEN);
    // Reply-клавиатур в MAX нет, поэтому меню служителя показываем инлайн-кнопками.
    const buttons = msg.buttons?.length ? msg.buttons : actionMenuButtons(msg.actionMenu);
    try {
      for (const [i, part] of parts.entries()) {
        const last = i === parts.length - 1;
        await this.bot.api.sendMessageToChat(Number(chatId), part, {
          attachments: last ? keyboardAttachment(buttons) : undefined,
          format: msg.format === 'html' ? 'html' : undefined,
          disable_link_preview: true,
        });
      }
    } catch (err) {
      throw maxSendError(err);
    }
  }

  async requestContact(chatId: string, text: string): Promise<void> {
    try {
      await this.bot.api.sendMessageToChat(Number(chatId), text, {
        attachments: [Keyboard.inlineKeyboard([[Keyboard.button.requestContact(BTN.sharePhone)]])],
      });
    } catch (err) {
      throw maxSendError(err);
    }
  }

  async clearContactUi(chatId: string, followupText: string): Promise<void> {
    // В MAX кнопка живёт внутри старого сообщения и ничего убирать не нужно.
    await this.sendMessage(chatId, { text: followupText });
  }

  async sendFile(chatId: string, file: OutFile, caption?: string): Promise<void> {
    // Из Buffer SDK назвал бы файл случайным UUID без расширения,
    // поэтому пишем во временный файл с нужным именем и отдаём путь.
    const dir = await mkdtemp(path.join(tmpdir(), 'church40-'));
    const filePath = path.join(dir, file.name);
    try {
      await writeFile(filePath, file.content);
      const attachment = await this.bot.api.uploadFile({ source: filePath });
      await this.bot.api.sendMessageToChat(Number(chatId), caption ?? file.name, {
        attachments: [attachment.toJson()],
      });
    } catch (err) {
      throw maxSendError(err);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async sendPhoto(chatId: string, photo: OutFile, caption?: string): Promise<void> {
    /*
     * Картинку отдаём Buffer'ом, а не путём к файлу, — иначе она не доходит.
     *
     * Для картинок MAX не выдаёт токен загрузки, поэтому библиотека грузит их
     * multipart-запросом, а там в FormData кладётся утиный объект вместо Blob:
     *
     *   body.append('data', { [Symbol.toStringTag]: 'File', name, stream: () => …, size })
     *
     * Node приводит его к строке, и на сервер уходит «[object File]» вместо PNG.
     * Ответ приходит без photos, attachment получается с пустым payload, и MAX
     * отвечает «400: No photos, url or token provided» — так 27.08 не дошла карточка
     * регистрации №2. Ветка для Buffer в той же библиотеке сделана правильно
     * (`formData.append('data', new Blob([buffer]), fileName)`), её и используем.
     *
     * Имя файла при этом теряется, но для картинки оно и не видно: получателю
     * приходит изображение, а не вложение с подписью. Для документов (выгрузка CSV)
     * имя важно — там остаётся временный файл, и там путь с токеном работает.
     */
    try {
      const attachment = await this.bot.api.uploadImage({ source: photo.content });
      await this.bot.api.sendMessageToChat(Number(chatId), caption ?? '', {
        attachments: [attachment.toJson()],
      });
    } catch (err) {
      throw maxSendError(err);
    }
  }

  /** Формат диплинков MAX не подтверждён документацией, поэтому QR несёт номер текстом. */
  deepLink(): string | null {
    return null;
  }

  async canReach(chatId: string): Promise<boolean> {
    try {
      await this.bot.api.getChat(Number(chatId));
      return true;
    } catch {
      return false;
    }
  }

  async ackCallback(callbackId: string, toast?: string): Promise<void> {
    try {
      await this.bot.api.answerOnCallback(callbackId, toast ? { notification: toast } : {});
    } catch (err) {
      this.log.debug({ err: (err as Error).message }, 'MAX: не удалось подтвердить нажатие');
    }
  }
}

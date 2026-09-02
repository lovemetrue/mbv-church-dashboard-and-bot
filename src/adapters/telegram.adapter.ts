import { Bot, InlineKeyboard, InputFile, Keyboard } from 'grammy';
import type {
  ActionButton,
  Button,
  IncomingUpdate,
  OutFile,
  OutMessage,
  Platform,
  UpdateCtx,
} from '../core/platform.js';
import { splitLongText } from '../core/split.js';
import { BTN } from '../core/texts.js';
import { logger as defaultLogger, type Logger } from '../logger.js';
import { telegramSendError } from './telegram.errors.js';

/** Лимит одного сообщения в Telegram 4096 символов, берём с запасом. */
const MAX_LEN = 4000;

function keyboard(buttons?: Button[][]): InlineKeyboard | undefined {
  if (!buttons?.length) return undefined;
  const kb = new InlineKeyboard();
  for (const row of buttons) {
    for (const b of row) {
      if (b.kind === 'callback') kb.text(b.text, b.data);
      else kb.url(b.text, b.url);
    }
    kb.row();
  }
  return kb;
}

/** Постоянная клавиатура служителя: кнопки отправляют свои подписи текстом. */
function replyKeyboard(menu?: ActionButton[][]): Keyboard | undefined {
  if (!menu?.length) return undefined;
  const kb = new Keyboard();
  for (const row of menu) {
    for (const b of row) kb.text(b.label);
    kb.row();
  }
  return kb.resized().persistent();
}

export interface TelegramOptions {
  /** Адрес Bot API. Нужен для своего сервера Bot API и для тестов. */
  apiRoot?: string;
}

export class TelegramAdapter implements Platform {
  readonly name = 'telegram' as const;
  private readonly bot: Bot;
  private handler?: (update: IncomingUpdate) => Promise<void>;

  constructor(
    token: string,
    private readonly log: Logger = defaultLogger,
    options: TelegramOptions = {},
  ) {
    this.bot = new Bot(token, options.apiRoot ? { client: { apiRoot: options.apiRoot } } : undefined);
    this.wire();
  }

  private ctxOf(from: { id: number; username?: string }, chatId: number | undefined): UpdateCtx {
    return {
      platform: 'telegram',
      platformUserId: String(from.id),
      chatId: String(chatId ?? from.id),
      username: from.username,
    };
  }

  private wire(): void {
    this.bot.catch((err) => {
      this.log.error({ err: err.message, update: err.ctx?.update?.update_id }, 'ошибка обработки апдейта Telegram');
    });

    // Порядок важен: первый подошедший обработчик забирает апдейт себе.
    this.bot.command('start', async (ctx) => {
      // ctx.match — то, что после «/start»: так приходит payload из диплинка QR-кода.
      const payload = ctx.match?.trim();
      await this.emit({
        kind: 'start',
        ctx: this.ctxOf(ctx.from!, ctx.chat.id),
        ...(payload ? { payload } : {}),
      });
    });

    this.bot.on('message:contact', async (ctx) => {
      const c = ctx.message.contact;
      await this.emit({
        kind: 'contact',
        ctx: this.ctxOf(ctx.from, ctx.chat.id),
        phone: c.phone_number,
        firstName: c.first_name,
        lastName: c.last_name,
        // Telegram позволяет переслать чужой контакт: сверяем владельца.
        isOwn: c.user_id === undefined || c.user_id === ctx.from.id,
      });
    });

    this.bot.on('message:text', async (ctx) => {
      await this.emit({ kind: 'text', ctx: this.ctxOf(ctx.from, ctx.chat.id), text: ctx.message.text });
    });

    this.bot.on('callback_query:data', async (ctx) => {
      await this.emit({
        kind: 'callback',
        ctx: this.ctxOf(ctx.from, ctx.chat?.id),
        data: ctx.callbackQuery.data,
        callbackId: ctx.callbackQuery.id,
      });
    });
  }

  private async emit(update: IncomingUpdate): Promise<void> {
    if (!this.handler) return;
    await this.handler(update);
  }

  onUpdate(handler: (update: IncomingUpdate) => Promise<void>): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    await this.bot.init();
    this.log.info({ bot: this.bot.botInfo.username }, 'Telegram: бот подключён');
    // bot.start() завершается только при остановке polling, поэтому не ждём его здесь.
    void this.bot.start({ allowed_updates: ['message', 'callback_query'] }).catch((err) => {
      this.log.error({ err }, 'Telegram: polling остановлен с ошибкой');
    });
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }

  async sendMessage(chatId: string, msg: OutMessage): Promise<void> {
    const parts = splitLongText(msg.text, MAX_LEN);
    // Одно сообщение несёт либо инлайн-кнопки, либо reply-клавиатуру: reply_markup один.
    const markup = msg.buttons?.length ? keyboard(msg.buttons) : replyKeyboard(msg.actionMenu);
    try {
      for (const [i, part] of parts.entries()) {
        const last = i === parts.length - 1;
        await this.bot.api.sendMessage(chatId, part, {
          // Кнопки прикрепляем только к последнему куску длинного текста.
          reply_markup: last ? markup : undefined,
          parse_mode: msg.format === 'html' ? 'HTML' : undefined,
          link_preview_options: { is_disabled: true },
        });
      }
    } catch (err) {
      throw telegramSendError(err);
    }
  }

  async requestContact(chatId: string, text: string): Promise<void> {
    try {
      await this.bot.api.sendMessage(chatId, text, {
        reply_markup: {
          keyboard: [[{ text: BTN.sharePhone, request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      });
    } catch (err) {
      throw telegramSendError(err);
    }
  }

  async clearContactUi(chatId: string, followupText: string): Promise<void> {
    try {
      // Без remove_keyboard кнопка запроса телефона висит у человека до конца кампании.
      await this.bot.api.sendMessage(chatId, followupText, { reply_markup: { remove_keyboard: true } });
    } catch (err) {
      throw telegramSendError(err);
    }
  }

  async sendFile(chatId: string, file: OutFile, caption?: string): Promise<void> {
    try {
      await this.bot.api.sendDocument(chatId, new InputFile(file.content, file.name), { caption });
    } catch (err) {
      throw telegramSendError(err);
    }
  }

  async sendPhoto(chatId: string, photo: OutFile, caption?: string): Promise<void> {
    try {
      await this.bot.api.sendPhoto(chatId, new InputFile(photo.content, photo.name), { caption });
    } catch (err) {
      throw telegramSendError(err);
    }
  }

  deepLink(payload: string): string | null {
    const username = this.bot.botInfo?.username;
    return username ? `https://t.me/${username}?start=${payload}` : null;
  }

  async canReach(chatId: string): Promise<boolean> {
    try {
      // getChat отвечает ошибкой «chat not found», если человек не открывал бота.
      await this.bot.api.getChat(chatId);
      return true;
    } catch {
      return false;
    }
  }

  async ackCallback(callbackId: string, toast?: string): Promise<void> {
    try {
      await this.bot.api.answerCallbackQuery(callbackId, toast ? { text: toast } : undefined);
    } catch (err) {
      // Просроченный callback это не повод ронять обработку.
      this.log.debug({ err: (err as Error).message }, 'Telegram: не удалось подтвердить нажатие');
    }
  }
}

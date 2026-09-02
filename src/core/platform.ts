/**
 * Контракт, который реализуют оба адаптера (Telegram и MAX).
 * Ядро бота знает только этот файл и ничего не знает про grammY и @maxhub/max-bot-api.
 */

export type PlatformName = 'telegram' | 'max';

export interface UpdateCtx {
  platform: PlatformName;
  /** Идентификатор пользователя внутри платформы. Всегда строка: у Telegram и MAX это числа разной природы. */
  platformUserId: string;
  /** Куда отвечать. В личке обычно совпадает с пользователем, но у MAX это отдельный chat_id диалога. */
  chatId: string;
  username?: string;
}

export type IncomingUpdate =
  /** payload приходит из диплинка вида t.me/bot?start=kit_42 — по нему выдаётся набор. */
  | { kind: 'start'; ctx: UpdateCtx; payload?: string }
  | { kind: 'text'; ctx: UpdateCtx; text: string }
  | {
      kind: 'contact';
      ctx: UpdateCtx;
      phone: string;
      firstName?: string;
      lastName?: string;
      /** false, если человек переслал чужой контакт вместо своего. */
      isOwn: boolean;
    }
  | { kind: 'callback'; ctx: UpdateCtx; data: string; callbackId: string };

/** Инлайн-кнопка — единственный вид клавиатуры, доступный обеим платформам. */
export type Button =
  | { kind: 'callback'; text: string; data: string }
  | { kind: 'url'; text: string; url: string };

/**
 * Кнопка постоянного меню действий (клавиатура служителя).
 * В Telegram при нажатии уходит подпись текстом, в MAX callback с командой,
 * поэтому кнопка несёт и то, и другое.
 */
export interface ActionButton {
  label: string;
  command: string;
}

export interface OutMessage {
  text: string;
  buttons?: Button[][];
  /**
   * Постоянное меню действий: reply-клавиатура в Telegram, инлайн-кнопки в MAX.
   * Если у сообщения есть и buttons, и actionMenu, платформа показывает buttons:
   * в Telegram одно сообщение не умеет нести обе клавиатуры сразу.
   */
  actionMenu?: ActionButton[][];
  /**
   * Разметка текста. Обе платформы понимают ограниченный набор HTML-тегов
   * (Telegram parse_mode=HTML, MAX format=html).
   * Текст с разметкой обязан быть экранирован — см. core/html.ts.
   */
  format?: 'html';
}

export interface OutFile {
  name: string;
  content: Buffer;
  mime: string;
}

export type SendErrorKind = 'blocked' | 'rate_limited' | 'not_found' | 'other';

/** Единая классификация ошибок отправки: рассылка по ней решает, ретраить или списывать получателя. */
export class SendError extends Error {
  constructor(
    readonly kind: SendErrorKind,
    message: string,
    readonly retryAfterMs?: number,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SendError';
  }
}

export interface Platform {
  readonly name: PlatformName;
  /** Запускает long polling. */
  start(): Promise<void>;
  /** Останавливает polling для graceful shutdown. */
  stop(): Promise<void>;
  onUpdate(handler: (update: IncomingUpdate) => Promise<void>): void;
  sendMessage(chatId: string, msg: OutMessage): Promise<void>;
  /** Показывает платформо-специфичный UI запроса номера телефона. */
  requestContact(chatId: string, text: string): Promise<void>;
  /**
   * Отправляет сообщение и убирает UI запроса контакта.
   * В Telegram без этого reply-клавиатура с кнопкой телефона висит у пользователя навсегда.
   */
  clearContactUi(chatId: string, followupText: string): Promise<void>;
  sendFile(chatId: string, file: OutFile, caption?: string): Promise<void>;
  /** Картинкой, а не файлом: QR-код участник показывает служителю прямо в переписке. */
  sendPhoto(chatId: string, photo: OutFile, caption?: string): Promise<void>;
  /**
   * Ссылка, открывающая бота с параметром. Нужна QR-коду выдачи набора.
   * null, если платформа так не умеет: тогда в QR попадёт просто номер регистрации.
   */
  deepLink(payload: string): string | null;
  /**
   * Может ли бот написать в этот чат. Проверяется без отправки сообщения:
   * платформа отвечает ошибкой, если человек ни разу не открывал бота.
   * Нужно команде /admins — по своей базе судить нельзя, её очистка права не отменяет.
   */
  canReach(chatId: string): Promise<boolean>;
  /** Подтверждение нажатия кнопки: без него у пользователя «крутится» кнопка. */
  ackCallback(callbackId: string, toast?: string): Promise<void>;
}

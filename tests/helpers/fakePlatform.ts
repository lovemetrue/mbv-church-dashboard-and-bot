import {
  SendError,
  type IncomingUpdate,
  type OutFile,
  type OutMessage,
  type Platform,
  type PlatformName,
} from '../../src/core/platform.js';

/**
 * Платформа-дублёр для тестов: записывает отправленное и умеет падать по сценарию.
 * Позволяет проверить поведение рассылки при 429 и при блокировке бота,
 * не обращаясь к настоящим Telegram и MAX.
 */
export class FakePlatform implements Platform {
  readonly sent: { chatId: string; text: string }[] = [];
  readonly files: { chatId: string; name: string; size: number }[] = [];
  readonly photos: { chatId: string; name: string; size: number; caption?: string }[] = [];
  readonly acked: string[] = [];
  readonly actionMenus: { chatId: string; commands: string[] }[] = [];
  readonly contactRequests: string[] = [];
  private readonly script = new Map<string, (SendError | null)[]>();
  // Своя очередь для фото: у sendMessage и sendPhoto разное число вызовов на
  // один и тот же chatId за ход диалога, и общая очередь сбивала бы позицию.
  private readonly photoScript = new Map<string, (SendError | null)[]>();
  private handler?: (u: IncomingUpdate) => Promise<void>;

  constructor(readonly name: PlatformName = 'telegram') {}

  /** Задаёт исходы последовательных текстовых отправок в этот чат: null это успех. */
  program(chatId: string, ...outcomes: (SendError | null)[]): void {
    this.script.set(chatId, [...outcomes]);
  }

  /** То же самое, но для sendPhoto — отдельно от текстовых сообщений. */
  programPhoto(chatId: string, ...outcomes: (SendError | null)[]): void {
    this.photoScript.set(chatId, [...outcomes]);
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  onUpdate(handler: (u: IncomingUpdate) => Promise<void>): void {
    this.handler = handler;
  }

  /** Имитирует входящий апдейт от пользователя. */
  async receive(update: IncomingUpdate): Promise<void> {
    if (!this.handler) throw new Error('обработчик апдейтов не подключён');
    await this.handler(update);
  }

  async sendMessage(chatId: string, msg: OutMessage): Promise<void> {
    const planned = this.script.get(chatId)?.shift() ?? null;
    if (planned) throw planned;
    this.sent.push({ chatId, text: msg.text });
    if (msg.actionMenu && !msg.buttons) {
      this.actionMenus.push({ chatId, commands: msg.actionMenu.flat().map((b) => b.command) });
    }
  }

  async requestContact(chatId: string, text: string): Promise<void> {
    this.contactRequests.push(chatId);
    this.sent.push({ chatId, text });
  }

  async clearContactUi(chatId: string, followupText: string): Promise<void> {
    this.sent.push({ chatId, text: followupText });
  }

  async sendFile(chatId: string, file: OutFile): Promise<void> {
    this.files.push({ chatId, name: file.name, size: file.content.length });
  }

  async sendPhoto(chatId: string, photo: OutFile, caption?: string): Promise<void> {
    const planned = this.photoScript.get(chatId)?.shift() ?? null;
    if (planned) throw planned;
    this.photos.push({ chatId, name: photo.name, size: photo.content.length, caption });
  }

  /** Чаты, недоступные боту: имитируем человека, который не открывал бота. */
  readonly unreachable = new Set<string>();

  async canReach(chatId: string): Promise<boolean> {
    return !this.unreachable.has(chatId);
  }

  deepLink(payload: string): string | null {
    return `https://t.me/church40_test_bot?start=${payload}`;
  }

  async ackCallback(callbackId: string): Promise<void> {
    this.acked.push(callbackId);
  }

  textsTo(chatId: string): string[] {
    return this.sent.filter((m) => m.chatId === chatId).map((m) => m.text);
  }
}

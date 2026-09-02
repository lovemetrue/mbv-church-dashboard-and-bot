import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ApiCall {
  method: string;
  body: Record<string, unknown>;
}

export interface FakeTelegram {
  apiRoot: string;
  calls: ApiCall[];
  /** Кладёт апдейты в очередь: следующий getUpdates отдаст их боту. */
  push(...updates: unknown[]): void;
  callsOf(method: string): Record<string, unknown>[];
  close(): Promise<void>;
}

const readJson = (req: http.IncomingMessage): Promise<Record<string, unknown>> =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });

/**
 * Подставной Bot API Telegram на localhost.
 * Нужен, чтобы прогнать настоящий стек grammY (polling, разбор апдейтов, отправка)
 * без обращения к серверам Telegram.
 */
export async function startFakeTelegram(): Promise<FakeTelegram> {
  const calls: ApiCall[] = [];
  const queue: unknown[] = [];
  let messageId = 100;

  const server = http.createServer(async (req, res) => {
    const method = req.url?.split('/').pop() ?? '';
    const body = await readJson(req);
    calls.push({ method, body });

    const reply = (result: unknown): void => {
      if (res.writableEnded) return;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result }));
    };

    switch (method) {
      case 'getMe':
        reply({ id: 777, is_bot: true, first_name: 'Church40', username: 'church40_test_bot' });
        return;

      case 'getUpdates': {
        if (queue.length > 0) {
          reply(queue.splice(0, queue.length));
          return;
        }
        // Пустой ответ с небольшой задержкой: имитируем long polling без busy loop.
        const timer = setTimeout(() => reply([]), 30);
        res.on('close', () => clearTimeout(timer));
        return;
      }

      case 'sendMessage':
      case 'sendDocument':
        reply({
          message_id: (messageId += 1),
          date: Math.floor(Date.UTC(2026, 8, 1) / 1000),
          chat: { id: body['chat_id'], type: 'private' },
          text: body['text'] ?? '',
        });
        return;

      default:
        reply(true);
        return;
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    apiRoot: `http://127.0.0.1:${port}`,
    calls,
    push: (...updates) => queue.push(...updates),
    callsOf: (method) => calls.filter((c) => c.method === method).map((c) => c.body),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Заготовки настоящих апдейтов Telegram. */
export const tgUpdate = {
  command(id: number, userId: number, text: string) {
    return {
      update_id: id,
      message: {
        message_id: id,
        date: 1_800_000_000,
        chat: { id: userId, type: 'private' },
        from: { id: userId, is_bot: false, first_name: 'Иван', username: 'ivan' },
        text,
        entities: text.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]!.length }] : [],
      },
    };
  },

  contact(id: number, userId: number, phone: string, ownerId = userId) {
    return {
      update_id: id,
      message: {
        message_id: id,
        date: 1_800_000_000,
        chat: { id: userId, type: 'private' },
        from: { id: userId, is_bot: false, first_name: 'Иван' },
        contact: { phone_number: phone, first_name: 'Иван', last_name: 'Иванов', user_id: ownerId },
      },
    };
  },

  callback(id: number, userId: number, data: string, callbackId = `cb-${id}`) {
    return {
      update_id: id,
      callback_query: {
        id: callbackId,
        from: { id: userId, is_bot: false, first_name: 'Иван' },
        chat_instance: 'ci',
        data,
        message: {
          message_id: id,
          date: 1_800_000_000,
          chat: { id: userId, type: 'private' },
          from: { id: 777, is_bot: true, first_name: 'Church40' },
          text: 'вопрос',
        },
      },
    };
  },
};

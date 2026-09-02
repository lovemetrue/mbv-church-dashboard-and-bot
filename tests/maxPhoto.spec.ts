import { createServer, type Server } from 'node:http';
import { afterEach, expect, test } from 'vitest';
import { MaxAdapter } from '../src/adapters/max.adapter.js';
import type { Logger } from '../src/logger.js';

/**
 * Отправка QR-кода в MAX.
 *
 * 27.08 карточка регистрации №2 в MAX не дошла: `400: No 'photos', 'url' or 'token'
 * provided`. Причина в библиотеке: загрузку из файла она делает через FormData, куда
 * кладёт утиный объект вместо Blob —
 *
 *   body.append('data', { [Symbol.toStringTag]: 'File', name, stream: () => ..., size })
 *
 * — и Node приводит его к строке «[object File]». На сервер уходит эта строка вместо
 * PNG, ответ приходит без photos, и следующий запрос падает. Путь через Buffer в той
 * же библиотеке сделан правильно: `formData.append('data', new Blob([buffer]), name)`.
 *
 * Здесь поднят сервер, который ведёт себя как MAX: отдаёт адрес загрузки, принимает
 * multipart и отвечает photos только если реально получил PNG, а на сообщение без
 * photos/url/token отвечает тем же 400.
 */
let server: Server | undefined;
const silent = { error: () => {}, warn: () => {}, info: () => {}, child: () => silent } as unknown as Logger;

// Минимальный настоящий PNG: 1×1 пиксель.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

afterEach(async () => {
  await new Promise<void>((r) => { server ? server.close(() => r()) : r(); });
  server = undefined;
});

test('QR уходит в MAX: на сервер приходит PNG, в сообщение — photos', async () => {
  const uploaded: Buffer[] = [];
  const messages: unknown[] = [];

  const body = (req: import('node:http').IncomingMessage) =>
    new Promise<Buffer>((resolve) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
    });

  server = createServer(async (req, res) => {
    const json = (code: number, payload: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    if (req.url?.startsWith('/uploads')) {
      const { port } = server!.address() as { port: number };
      // Для картинок MAX не даёт токен: файл завершается ответом на multipart.
      return json(200, { url: `http://127.0.0.1:${port}/upload-here` });
    }

    if (req.url?.startsWith('/upload-here')) {
      const raw = await body(req);
      uploaded.push(raw);
      // Сервер MAX отдаёт photos только когда получил настоящую картинку.
      if (!raw.includes(PNG.subarray(0, 8))) return json(200, {});
      return json(200, { photos: { qr: { token: 'photo-token' } } });
    }

    if (req.url?.startsWith('/messages')) {
      const payload = JSON.parse((await body(req)).toString()) as {
        attachments?: { payload?: Record<string, unknown> }[];
      };
      const p = payload.attachments?.[0]?.payload ?? {};
      if (!('photos' in p) && !('url' in p) && !('token' in p)) {
        return json(400, { code: 'attachment.not.ready', message: "No `photos`, `url` or `token` provided. Check payload." });
      }
      messages.push(payload);
      return json(200, { message: { body: { mid: 'm1' } } });
    }

    return json(404, {});
  });

  const port = await new Promise<number>((resolve) => {
    server!.listen(0, '127.0.0.1', () => resolve((server!.address() as { port: number }).port));
  });

  const adapter = new MaxAdapter('test-token', silent, `http://127.0.0.1:${port}`);
  await adapter.sendPhoto('42', { name: 'qr-2.png', content: PNG }, 'Ваш номер: 2');

  // На сервер ушёл настоящий PNG, а не строка «[object File]».
  expect(uploaded).toHaveLength(1);
  expect(uploaded[0]!.includes('[object File]')).toBe(false);
  expect(uploaded[0]!.includes(PNG.subarray(0, 8))).toBe(true);

  // И в сообщении есть чем показать картинку.
  expect(messages).toHaveLength(1);
  expect((messages[0] as { attachments: { payload: object }[] }).attachments[0]!.payload)
    .toEqual({ photos: { qr: { token: 'photo-token' } } });
}, 30_000);

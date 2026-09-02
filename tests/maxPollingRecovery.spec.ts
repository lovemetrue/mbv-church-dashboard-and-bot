import { createServer, type Server } from 'node:http';
import { afterEach, expect, test, vi } from 'vitest';
import { MaxAdapter } from '../src/adapters/max.adapter.js';
import type { Logger } from '../src/logger.js';

/**
 * Восстановление опроса MAX против настоящей библиотеки.
 *
 * Ровно этот сбой случился 29.08: шлюз MAX ответил на /updates страницей HTML, разбор
 * JSON упал с SyntaxError, `Polling.loop` бросил ошибку наружу и бот замолчал на двое
 * суток. Заглушки в pollingSupervisor.spec проверяют логику надзора, а здесь настоящая
 * @maxhub/max-bot-api ходит по HTTP и получает тот же самый HTML — так проверяется,
 * что перезапуск действительно пробивает флаг pollingIsStarted внутри библиотеки.
 */
let server: Server | undefined;
let adapter: MaxAdapter | undefined;

afterEach(async () => {
  await adapter?.stop();
  await new Promise<void>((r) => { server ? server.close(() => r()) : r(); });
  server = undefined;
  adapter = undefined;
});

const silent = { error: () => {}, warn: () => {}, info: () => {}, child: () => silent } as unknown as Logger;

test('после HTML вместо JSON опрос перезапускается сам', async () => {
  let updateCalls = 0;

  server = createServer((req, res) => {
    if (req.url?.startsWith('/me')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ user_id: 1, name: 'Тест', username: 'test_bot' }));
      return;
    }
    if (req.url?.startsWith('/updates')) {
      updateCalls += 1;
      // Именно так ответил шлюз MAX 29.08: 200, но тело — страница ошибки.
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n</html>');
      return;
    }
    res.writeHead(404).end();
  });

  const port = await new Promise<number>((resolve) => {
    server!.listen(0, '127.0.0.1', () => {
      resolve((server!.address() as { port: number }).port);
    });
  });

  adapter = new MaxAdapter('test-token', silent, `http://127.0.0.1:${port}`);
  await adapter.start();

  // Первый заход падает сразу, второй — после первой задержки надзора (5 секунд).
  await vi.waitFor(() => expect(updateCalls).toBeGreaterThanOrEqual(2), {
    timeout: 12_000,
    interval: 250,
  });

  // Штатная остановка прекращает перезапуски: после stop() новых запросов нет.
  await adapter.stop();
  const afterStop = updateCalls;
  await new Promise((r) => setTimeout(r, 7_000));
  expect(updateCalls).toBe(afterStop);
}, 30_000);

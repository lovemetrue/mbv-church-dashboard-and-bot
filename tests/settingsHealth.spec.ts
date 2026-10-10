import { describe, expect, test } from 'vitest';
import { collectHealth, formatBytes, type HealthSources } from '../src/platform/settings/health.js';

const GB = 1024 ** 3;

function sources(over: Partial<HealthSources> = {}): HealthSources {
  return {
    loadAverage1m: () => 0.5,
    cpuCount: () => 4,
    memory: async () => ({ totalBytes: 8 * GB, availableBytes: 4 * GB }),
    disk: async () => ({ totalBytes: 100 * GB, freeBytes: 60 * GB }),
    database: async () => ({ pingMs: 3, sizeBytes: 50 * 1024 ** 2, connections: 5, maxConnections: 100 }),
    sessionStore: async () => ({ pingMs: 1 }),
    uptimeSeconds: () => 3 * 86400 + 4 * 3600,
    now: () => new Date('2026-10-10T10:00:00Z'),
    ...over,
  };
}
const metric = async (key: string, over: Partial<HealthSources>) =>
  (await collectHealth(sources(over))).metrics.find((m) => m.key === key)!;

describe('состояние сервера', () => {
  test('когда всё в норме, общий статус «ok» и шесть метрик', async () => {
    const v = await collectHealth(sources());
    expect(v.overall).toBe('ok');
    expect(v.metrics.map((m) => m.key)).toEqual(['cpu', 'memory', 'disk', 'database', 'sessions', 'service']);
    expect(v.generatedAt).toBe('2026-10-10T10:00:00.000Z');
  });

  test.each([
    [0.5, 'ok'], [2.7, 'ok'], [2.8, 'warn'], [3.9, 'warn'], [4, 'crit'], [9, 'crit'],
  ])('нагрузка %f при 4 ядрах — %s', async (load, status) => {
    expect((await metric('cpu', { loadAverage1m: () => load })).status).toBe(status);
  });

  test.each([
    [50, 'ok'], [20, 'ok'], [19, 'warn'], [10, 'warn'], [9, 'crit'], [1, 'crit'],
  ])('свободной памяти %i%% — %s', async (free, status) => {
    const m = await metric('memory', { memory: async () => ({ totalBytes: 100, availableBytes: free }) });
    expect(m.status).toBe(status);
  });

  test.each([
    [50, 'ok'], [79, 'ok'], [80, 'warn'], [91, 'warn'], [92, 'crit'], [99, 'crit'],
  ])('диск занят на %i%% — %s', async (used, status) => {
    const m = await metric('disk', { disk: async () => ({ totalBytes: 100, freeBytes: 100 - used }) });
    expect(m.status).toBe(status);
    expect(m.percent).toBe(used);
  });

  test('много подключений к базе или медленный ответ — тревога, почти все подключения — критично', async () => {
    const db = (connections: number, pingMs = 3) => async () => ({ pingMs, sizeBytes: 1, connections, maxConnections: 100 });
    expect((await metric('database', { database: db(69) })).status).toBe('ok');
    expect((await metric('database', { database: db(70) })).status).toBe('warn');
    expect((await metric('database', { database: db(5, 600) })).status).toBe('warn');
    expect((await metric('database', { database: db(90) })).status).toBe('crit');
  });

  test('база не отвечает: красная строка вместо падения, остальные метрики на месте', async () => {
    const v = await collectHealth(sources({ database: async () => { throw new Error('ECONNREFUSED'); } }));
    const db = v.metrics.find((m) => m.key === 'database')!;
    expect(db).toMatchObject({ status: 'crit', value: 'Не отвечает' });
    expect(v.metrics).toHaveLength(6);
    expect(v.overall).toBe('crit');
  });

  test('хранилище входов не отвечает — критично', async () => {
    const m = await metric('sessions', { sessionStore: async () => { throw new Error('down'); } });
    expect(m.status).toBe('crit');
  });

  test('общий статус — худший из метрик', async () => {
    const v = await collectHealth(sources({ loadAverage1m: () => 3 }));
    expect(v.overall).toBe('warn');
  });

  test('значения написаны по-русски: запятая в числах, ядра, «работает 3 д 4 ч»', async () => {
    const v = await collectHealth(sources());
    expect(v.metrics.find((m) => m.key === 'memory')!.value).toBe('4,0 ГБ свободно из 8,0 ГБ');
    expect(v.metrics.find((m) => m.key === 'cpu')!.value).toBe('Нагрузка 0,50 при 4 ядрах');
    expect(v.metrics.find((m) => m.key === 'service')!.value).toBe('Работает 3 д 4 ч');
    expect((await metric('cpu', { cpuCount: () => 1 })).value).toContain('при 1 ядре');
  });

  test('число ядер ноль не даёт деления на ноль', async () => {
    const m = await metric('cpu', { cpuCount: () => 0, loadAverage1m: () => 0.2 });
    expect(Number.isFinite(m.percent)).toBe(true);
  });

  test.each([[0, '0 Б'], [1023, '1023 Б'], [1024, '1,0 КБ'], [1536, '1,5 КБ'], [5 * 1024 ** 3, '5,0 ГБ'], [250 * 1024 ** 2, '250 МБ']])(
    'размер %i байт пишется как %s', (bytes, text) => { expect(formatBytes(bytes)).toBe(text); },
  );
});

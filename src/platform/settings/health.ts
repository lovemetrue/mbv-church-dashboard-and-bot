import { readFile, statfs } from 'node:fs/promises';
import os from 'node:os';
import type { Pool } from 'pg';
import type { HealthMetric, HealthStatus, SettingsHealthView } from '../../home-groups/contracts.js';

/**
 * Состояние сервера для раздела «Настройки». Источники внедряются: тесты подставляют свои числа,
 * в бою — `realHealthSources`. Каждая метрика считается отдельно: сбой одной (база не отвечает) не
 * прячет остальные, а сам становится красной строкой.
 */
export interface HealthSources {
  loadAverage1m: () => number;
  cpuCount: () => number;
  memory: () => Promise<{ totalBytes: number; availableBytes: number }>;
  disk: () => Promise<{ totalBytes: number; freeBytes: number }>;
  database: () => Promise<{ pingMs: number; sizeBytes: number; connections: number; maxConnections: number }>;
  /** Хранилище сессий: время ответа; бросает, если не отвечает. */
  sessionStore: () => Promise<{ pingMs: number }>;
  uptimeSeconds: () => number;
  now: () => Date;
}

const ORDER: Record<HealthStatus, number> = { ok: 0, warn: 1, crit: 2 };

/** «2,1 ГБ»: десятичная запятая и русские единицы. */
export function formatBytes(bytes: number): string {
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  const rounded = i === 0 ? String(Math.round(v)) : v.toFixed(v >= 100 ? 0 : 1).replace('.', ',');
  return `${rounded} ${units[i]}`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} д ${h} ч`;
  if (h > 0) return `${h} ч ${m} мин`;
  return `${m} мин`;
}

const pct = (part: number, whole: number): number => (whole > 0 ? Math.min(100, Math.max(0, Math.round((part / whole) * 100))) : 0);

async function safe(key: HealthMetric['key'], label: string, make: () => Promise<HealthMetric>): Promise<HealthMetric> {
  try {
    return await make();
  } catch {
    return {
      key, label, status: 'crit', value: 'Не отвечает',
      hint: 'Не удалось получить данные. Если это база или хранилище сессий — проверьте контейнеры на сервере.', percent: null,
    };
  }
}

export async function collectHealth(src: HealthSources): Promise<SettingsHealthView> {
  const metrics = await Promise.all([
    safe('cpu', 'Процессор', async () => {
      const cores = Math.max(1, src.cpuCount());
      const load = src.loadAverage1m();
      const ratio = load / cores;
      const status: HealthStatus = ratio >= 1 ? 'crit' : ratio >= 0.7 ? 'warn' : 'ok';
      return {
        key: 'cpu', label: 'Процессор', status,
        value: `Нагрузка ${load.toFixed(2).replace('.', ',')} при ${cores} ${cores === 1 ? 'ядре' : 'ядрах'}`,
        hint: 'Норма — ниже 70% от числа ядер. Выше 100% значит, что сервер не успевает.',
        percent: Math.min(100, Math.round(ratio * 100)),
      };
    }),
    safe('memory', 'Память', async () => {
      const { totalBytes, availableBytes } = await src.memory();
      const free = pct(availableBytes, totalBytes);
      const status: HealthStatus = free < 10 ? 'crit' : free < 20 ? 'warn' : 'ok';
      return {
        key: 'memory', label: 'Память', status,
        value: `${formatBytes(availableBytes)} свободно из ${formatBytes(totalBytes)}`,
        hint: 'Тревога, когда свободно меньше 20%, критично — меньше 10%.',
        percent: 100 - free,
      };
    }),
    safe('disk', 'Диск', async () => {
      const { totalBytes, freeBytes } = await src.disk();
      const used = pct(totalBytes - freeBytes, totalBytes);
      const status: HealthStatus = used >= 92 ? 'crit' : used >= 80 ? 'warn' : 'ok';
      return {
        key: 'disk', label: 'Диск', status,
        value: `${formatBytes(freeBytes)} свободно из ${formatBytes(totalBytes)}`,
        hint: 'Тревога от 80% занятого, критично от 92%: на заполненном диске база перестаёт писать.',
        percent: used,
      };
    }),
    safe('database', 'База данных', async () => {
      const db = await src.database();
      const used = pct(db.connections, db.maxConnections);
      const status: HealthStatus = used >= 90 ? 'crit' : used >= 70 || db.pingMs > 500 ? 'warn' : 'ok';
      return {
        key: 'database', label: 'База данных', status,
        value: `Отвечает за ${Math.round(db.pingMs)} мс, размер ${formatBytes(db.sizeBytes)}`,
        hint: `Подключений ${db.connections} из ${db.maxConnections}. Тревога, если подключений больше 70% или ответ дольше полусекунды.`,
        percent: used,
      };
    }),
    safe('sessions', 'Хранилище входов', async () => {
      const s = await src.sessionStore();
      const status: HealthStatus = s.pingMs > 200 ? 'warn' : 'ok';
      return {
        key: 'sessions', label: 'Хранилище входов', status,
        value: `Отвечает за ${Math.round(s.pingMs)} мс`,
        hint: 'Здесь держатся входы в интерфейс. Если не отвечает, войти никто не сможет.',
        percent: null,
      };
    }),
    safe('service', 'Сервис «Домашние группы»', async () => ({
      key: 'service', label: 'Сервис «Домашние группы»', status: 'ok',
      value: `Работает ${formatUptime(src.uptimeSeconds())}`,
      hint: 'Время с последнего перезапуска контейнера.', percent: null,
    })),
  ]);

  const overall = metrics.reduce<HealthStatus>((worst, m) => (ORDER[m.status] > ORDER[worst] ? m.status : worst), 'ok');
  return { generatedAt: src.now().toISOString(), overall, metrics };
}

/**
 * Настоящие источники. Контейнер видит память и нагрузку всего сервера (/proc не изолирован),
 * а диск — тот, на котором лежит корень контейнера, то есть где лежат и данные Docker.
 */
export function realHealthSources(db: Pool, pingSessions: () => Promise<void>): HealthSources {
  const timed = async (work: () => Promise<unknown>): Promise<number> => {
    const t = process.hrtime.bigint();
    await work();
    return Number(process.hrtime.bigint() - t) / 1e6;
  };
  return {
    loadAverage1m: () => os.loadavg()[0] ?? 0,
    cpuCount: () => os.cpus().length,
    memory: async () => {
      try {
        const text = await readFile('/proc/meminfo', 'utf8');
        const kb = (name: string): number => Number(new RegExp(`^${name}:\\s+(\\d+)`, 'm').exec(text)?.[1]);
        const total = kb('MemTotal');
        const available = kb('MemAvailable');
        if (Number.isFinite(total) && Number.isFinite(available)) return { totalBytes: total * 1024, availableBytes: available * 1024 };
      } catch { /* не Linux — берём то, что отдаёт Node */ }
      return { totalBytes: os.totalmem(), availableBytes: os.freemem() };
    },
    disk: async () => {
      const s = await statfs('/');
      return { totalBytes: s.blocks * s.bsize, freeBytes: s.bavail * s.bsize };
    },
    database: async () => {
      const pingMs = await timed(() => db.query('SELECT 1'));
      const { rows } = await db.query<{ size: string; connections: string; max: string }>(
        `SELECT pg_database_size(current_database())::text AS size,
                (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database())::text AS connections,
                current_setting('max_connections') AS max`,
      );
      const r = rows[0]!;
      return { pingMs, sizeBytes: Number(r.size), connections: Number(r.connections), maxConnections: Number(r.max) };
    },
    sessionStore: async () => ({ pingMs: await timed(pingSessions) }),
    uptimeSeconds: () => process.uptime(),
    now: () => new Date(),
  };
}

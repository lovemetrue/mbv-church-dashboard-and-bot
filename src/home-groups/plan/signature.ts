import { createHash } from 'node:crypto';
import type { PlanRequest } from './types.js';

/**
 * Отпечаток данных заявки, от которых зависит подбор: район, возраст, дни, время суток и улица.
 * Закреплённое предложение хранит его: изменился отпечаток — данные новые, группу надо пересчитать.
 * Имя, телефон и прочее на подбор не влияют и в отпечаток не входят.
 */
export function inputSignature(r: Pick<PlanRequest, 'district' | 'ageRange' | 'days' | 'slot' | 'street'>): string {
  const canonical = JSON.stringify([r.district, r.ageRange, [...r.days].sort(), r.slot, (r.street ?? '').trim().toLowerCase() || null]);
  return createHash('sha1').update(canonical).digest('hex').slice(0, 16);
}

/**
 * Снимок тех же данных в виде, готовом к показу человеку. Хранится у предложения: когда отпечаток данных меняется,
 * по снимку видно, что именно новое (человек прислал улицу, координатор поправил район), а не только «данные изменились».
 */
export interface InputSnapshot {
  district: string | null;
  age: string | null;
  days: string | null;
  slot: string | null;
  street: string | null;
}

const DAY_ORDER = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export const SNAPSHOT_LABELS: Record<keyof InputSnapshot, string> = {
  district: 'Район', age: 'Возраст', days: 'Дни', slot: 'Время суток', street: 'Улица',
};
const SNAPSHOT_KEYS = Object.keys(SNAPSHOT_LABELS) as (keyof InputSnapshot)[];

export function inputSnapshot(r: Pick<PlanRequest, 'district' | 'ageRange' | 'days' | 'slot' | 'street'>): InputSnapshot {
  const days = [...r.days].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  return {
    district: r.district,
    age: r.ageRange ? (r.ageRange[0] === r.ageRange[1] ? String(r.ageRange[0]) : `${r.ageRange[0]}–${r.ageRange[1]}`) : null,
    days: days.length > 0 ? days.join(', ') : null,
    slot: r.slot,
    street: (r.street ?? '').trim() || null,
  };
}

export interface SnapshotChange { field: string; before: string | null; after: string | null }

/** Что изменилось между двумя снимками; улица сравнивается без учёта регистра и пробелов — так же, как в отпечатке. */
export function diffSnapshots(before: InputSnapshot, after: InputSnapshot): SnapshotChange[] {
  const norm = (key: keyof InputSnapshot, v: string | null): string | null => (key === 'street' && v ? v.trim().toLowerCase() : v);
  return SNAPSHOT_KEYS.filter((k) => norm(k, before[k]) !== norm(k, after[k]))
    .map((k) => ({ field: SNAPSHOT_LABELS[k], before: before[k], after: after[k] }));
}

/** Снимок из базы (jsonb): неполный или чужой вид — null, чтобы кривая запись не роняла экран. */
export function parseSnapshot(raw: unknown): InputSnapshot | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out: Partial<InputSnapshot> = {};
  for (const k of SNAPSHOT_KEYS) {
    const v = o[k];
    if (v !== null && typeof v !== 'string') return null;
    if (!(k in o)) return null;
    out[k] = v;
  }
  return out as InputSnapshot;
}

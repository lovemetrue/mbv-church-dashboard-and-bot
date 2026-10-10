import type { RequestItem } from '@contracts';
import type { BucketFilter } from '../../entities/buckets';
import { phoneDigits } from '../../entities/format';

/**
 * Поиск по заявкам: ФИО и место ищем как подстроку без учёта регистра; телефон — по цифрам,
 * чтобы «9114» находил «+7 (911) 4…» в любой записи номера. Цифры сравниваем, только если в
 * запросе их хотя бы три: иначе «1» нашёл бы половину очереди.
 */
export function matchesSearch(r: RequestItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (`${r.fio} ${r.place ?? ''}`.toLowerCase().includes(q)) return true;
  const digits = phoneDigits(q);
  return digits.length >= 3 && phoneDigits(r.phone).includes(digits);
}

export function searchRequests(items: readonly RequestItem[], query: string): RequestItem[] {
  return items.filter((r) => matchesSearch(r, query));
}

export interface BucketCounts {
  all: number;
  ready: number;
  callback: number;
  human: number;
  done: number;
}

/** Счётчики на чипах считаются по найденному, а не по всему: так видно, сколько попало в поиск. */
export function countBuckets(items: readonly RequestItem[]): BucketCounts {
  const c: BucketCounts = { all: 0, ready: 0, callback: 0, human: 0, done: 0 };
  for (const r of items) {
    if (r.bucket === 'cancelled') continue;
    c.all++;
    c[r.bucket]++;
  }
  return c;
}

export function filterByBucket(items: readonly RequestItem[], bucket: BucketFilter): RequestItem[] {
  return items.filter((r) => r.bucket !== 'cancelled' && (bucket === 'all' || r.bucket === bucket));
}

/** Сколько параметров подбора известно у человека (из четырёх). */
export function knownParams(r: RequestItem): number {
  return r.dataFill.filter(Boolean).length;
}

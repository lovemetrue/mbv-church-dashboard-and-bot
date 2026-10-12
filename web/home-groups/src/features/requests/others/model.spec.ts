import { describe, expect, test } from 'vitest';
import { buildOthers } from '../../../fixtures/others';
import type { OtherItem } from '@contracts';
import {
  countOthers,
  countReconcile,
  filterByReconcile,
  filterOthers,
  matchesOtherSearch,
  openOthersCount,
  READY_BULK_LIMIT,
  readyToReconcile,
  reconcileGroupOf,
} from './model';

const items = buildOthers();

describe('«Другие обращения»: чистые функции', () => {
  test('число открытых не включает закрытые', () => {
    expect(openOthersCount(items)).toBe(items.filter((o) => o.state === 'open').length);
    expect(openOthersCount(items)).toBeLessThan(items.length);
  });

  test('счётчики по состояниям складываются во «Все»', () => {
    const c = countOthers(items);
    expect(c.open + c.done + c.cancelled).toBe(c.all);
    expect(c.cancelled).toBe(1);
  });

  test('отбор по состоянию и «Все» сохраняют порядок сервера', () => {
    expect(filterOthers(items, 'all').map((o) => o.id)).toEqual(items.map((o) => o.id));
    expect(filterOthers(items, 'done').every((o) => o.state === 'done')).toBe(true);
    expect(filterOthers(items, 'open').map((o) => o.id)).toEqual(items.filter((o) => o.state === 'open').map((o) => o.id));
  });

  test('поиск: по ФИО, месту, телефону по цифрам и по типу обращения', () => {
    const find = (q: string) => items.filter((o) => matchesOtherSearch(o, q)).map((o) => o.fio);
    expect(find('СЕДОВ')).toEqual(['Игорь Седов']);
    expect(find('лесная')).toEqual(['Юлия Громова']);
    expect(find('921 555 01 02')).toEqual(['Юлия Громова']);
    expect(find('вопрос')).toEqual(['Игорь Седов']);
    expect(find('  ')).toHaveLength(items.length);
  });

  test('обращение без телефона и ответственного ищется и не падает', () => {
    const lone = items.find((o) => o.phone === null)!;
    expect(matchesOtherSearch(lone, 'орлова')).toBe(true);
    expect(matchesOtherSearch(lone, 'null')).toBe(false);
  });
});

const withReconcile = (o: OtherItem, status: NonNullable<OtherItem['reconcile']>['status'] | null): OtherItem => ({
  ...o,
  reconcile: status === null ? null : { kind: 'member', status, text: 'текст', candidates: [] },
});

describe('«Другие обращения»: суть и разбор', () => {
  test('поиск находит по сути обращения', () => {
    const find = (q: string) => items.filter((o) => matchesOtherSearch(o, q)).map((o) => o.id);
    expect(find('с детьми')).toEqual([201]);
    expect(find('ПО СРЕДАМ')).toEqual([208]);
    expect(find('васильевском острове')).toEqual([209]);
  });

  test('группа разбора: ready, choose, «не найдена» (none и noleader), «остальные» (nouser и без разбора)', () => {
    const base = items[0]!;
    expect(reconcileGroupOf(withReconcile(base, 'ready'))).toBe('ready');
    expect(reconcileGroupOf(withReconcile(base, 'choose'))).toBe('choose');
    expect(reconcileGroupOf(withReconcile(base, 'none'))).toBe('missing');
    expect(reconcileGroupOf(withReconcile(base, 'noleader'))).toBe('missing');
    expect(reconcileGroupOf(withReconcile(base, 'nouser'))).toBe('rest');
    expect(reconcileGroupOf(withReconcile(base, null))).toBe('rest');
  });

  test('счётчики разбора считают только открытые: закрытые в них не входят', () => {
    const c = countReconcile(items);
    expect(c).toEqual({ all: openOthersCount(items), ready: 2, choose: 2, missing: 2, rest: 3 });
    expect(c.ready + c.choose + c.missing + c.rest).toBe(c.all);
  });

  test('отбор по разбору оставляет нужную группу и порядок сервера', () => {
    const open = filterOthers(items, 'open');
    expect(filterByReconcile(open, 'ready').map((o) => o.id)).toEqual([206, 210]);
    expect(filterByReconcile(open, 'choose').map((o) => o.id)).toEqual([207, 208]);
    expect(filterByReconcile(open, 'missing').map((o) => o.id)).toEqual([203, 209]);
    expect(filterByReconcile(open, 'rest').map((o) => o.id)).toEqual([201, 202, 211]);
    expect(filterByReconcile(open, 'all').map((o) => o.id)).toEqual(open.map((o) => o.id));
  });

  test('к массовому разбору идут только открытые «готовые» из переданного списка', () => {
    const r = readyToReconcile(items);
    expect(r).toEqual({ ids: [206, 210], total: 2, capped: false });
    expect(readyToReconcile(items.filter((o) => o.id !== 206)).ids).toEqual([210]);
    const closed = items.map((o) => (o.id === 210 ? { ...o, state: 'done' as const } : o));
    expect(readyToReconcile(closed).ids).toEqual([206]);
  });

  test('больше предела берутся первые 500, и это видно по флагу', () => {
    const base = withReconcile(items[0]!, 'ready');
    const many = Array.from({ length: READY_BULK_LIMIT + 7 }, (_, i) => ({ ...base, id: 1000 + i }));
    const r = readyToReconcile(many);
    expect(r.ids).toHaveLength(READY_BULK_LIMIT);
    expect(r.ids[0]).toBe(1000);
    expect(r.total).toBe(READY_BULK_LIMIT + 7);
    expect(r.capped).toBe(true);
    expect(READY_BULK_LIMIT).toBe(500);
  });
});

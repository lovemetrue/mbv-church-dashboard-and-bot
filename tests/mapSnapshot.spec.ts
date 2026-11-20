import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { MapSnapshotRepo } from '../src/db/repos/mapSnapshots.repo.js';
import type { GroupItem } from '../src/home-groups/contracts.js';
import { createMapSnapshots, STATIC_MAX_MARKS } from '../src/home-groups/mapSnapshot.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const KEY = ['static', 'key', '0000EFGH'].join('-');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

/** Группа ровно с теми полями, что смотрит снимок: остальное ему не нужно. */
const group = (id: number, patch: Partial<GroupItem> = {}): GroupItem =>
  ({ id, code: `Г-${id}`, status: 'Функционирует', chamber: false, doNotRefer: false, coords: { lat: 59.9 + id / 1000, lon: 30.3 + id / 1000 }, ...patch }) as GroupItem;

function make(opts: { key?: string | null; fail?: boolean; now?: Date } = {}) {
  const urls: string[] = [];
  const snapshots = createMapSnapshots({
    repo: new MapSnapshotRepo(db),
    staticKey: async () => (opts.key === undefined ? KEY : opts.key),
    fetchImage: async (url) => {
      urls.push(url);
      if (opts.fail) throw new Error('Яндекс не ответил');
      return PNG;
    },
    now: () => opts.now ?? new Date('2026-11-20T09:00:00Z'),
  });
  return { snapshots, urls };
}
const body = (groupIds: number[], patch: Record<string, unknown> = {}) => ({ center: { lat: 59.93, lon: 30.31 }, zoom: 11, groupIds, ...patch });

describe('снимок карты (Static API)', () => {
  test('снимок строится по центру, масштабу и меткам видимых групп; камерные, закрытые и без координат на него не попадают', async () => {
    const { snapshots, urls } = make();
    const groups = [
      group(1),
      group(2, { status: 'Потенциальная' }),
      group(3, { doNotRefer: true }),
      group(4, { chamber: true }),
      group(5, { status: 'Закрыта' }),
      group(6, { coords: null }),
    ];
    const out = await snapshots.take('admin', body([1, 2, 3, 4, 5, 6, 99]), groups);
    expect(out).toMatchObject({ ok: true, snapshot: { takenAt: '2026-11-20T09:00:00.000Z', marks: 3, skipped: 0 } });
    expect(urls).toHaveLength(1);
    const url = new URL(urls[0]!);
    expect(url.origin + url.pathname).toBe('https://static-maps.yandex.ru/v1');
    expect(url.searchParams.get('apikey')).toBe(KEY);
    // У Яндекса порядок «долгота,широта».
    expect(url.searchParams.get('ll')).toBe('30.31,59.93');
    expect(url.searchParams.get('z')).toBe('11');
    // Цвета как на живой карте: действующая — синяя, потенциальная — оранжевая, «не направлять» — серая.
    expect(url.searchParams.get('pt')).toBe('30.301,59.901,pm2blm~30.302,59.902,pm2orm~30.303,59.903,pm2grm');
    expect(await snapshots.png('admin')).toEqual(PNG);
    expect(await snapshots.meta('admin')).toMatchObject({ takenAt: '2026-11-20T09:00:00.000Z', marks: 3 });
  });

  test('тот же вид и те же метки — Яндекс второй раз не спрашиваем, снимок и его дата прежние', async () => {
    const first = make();
    await first.snapshots.take('admin', body([1, 2]), [group(1), group(2)]);
    const later = make({ now: new Date('2026-11-20T10:00:00Z') });
    expect(await later.snapshots.take('admin', body([2, 1]), [group(1), group(2)])).toMatchObject({ ok: true, snapshot: { takenAt: '2026-11-20T09:00:00.000Z' } });
    expect(later.urls).toHaveLength(0);
    // Сдвинули карту — новый снимок.
    expect(await later.snapshots.take('admin', body([1, 2], { zoom: 12 }), [group(1), group(2)])).toMatchObject({ ok: true, snapshot: { takenAt: '2026-11-20T10:00:00.000Z' } });
    expect(later.urls).toHaveLength(1);
  });

  test('снимок у каждого входа свой: чужой вид и чужие метки не видны', async () => {
    const { snapshots } = make();
    await snapshots.take('ivanov', body([1]), [group(1)]);
    expect(await snapshots.meta('petrov')).toBeNull();
    expect(await snapshots.png('petrov')).toBeNull();
  });

  test('меток больше, чем берёт Static API, — на снимке первые, остальные посчитаны', async () => {
    const { snapshots, urls } = make();
    const groups = Array.from({ length: STATIC_MAX_MARKS + 5 }, (_, i) => group(i + 1));
    const out = await snapshots.take('admin', body(groups.map((g) => g.id)), groups);
    expect(out).toMatchObject({ ok: true, snapshot: { marks: STATIC_MAX_MARKS, skipped: 5 } });
    expect(new URL(urls[0]!).searchParams.get('pt')!.split('~')).toHaveLength(STATIC_MAX_MARKS);
  });

  test('без ключа Static API снимка нет и в Яндекс ничего не уходит', async () => {
    const { snapshots, urls } = make({ key: null });
    expect(await snapshots.take('admin', body([1]), [group(1)])).toMatchObject({ ok: false, error: 'unavailable' });
    expect(urls).toHaveLength(0);
  });

  test('Яндекс не ответил — ошибка, а прежний снимок остаётся', async () => {
    await make().snapshots.take('admin', body([1]), [group(1)]);
    const broken = make({ fail: true });
    expect(await broken.snapshots.take('admin', body([1], { zoom: 14 }), [group(1)])).toMatchObject({ ok: false, error: 'unavailable' });
    expect(await broken.snapshots.png('admin')).toEqual(PNG);
  });

  test('кривой вид отклоняется до запроса к Яндексу', async () => {
    const { snapshots, urls } = make();
    for (const bad of [null, {}, body([1], { zoom: 40 }), body([1], { center: { lat: 200, lon: 30 } }), body([1], { groupIds: 'все' }), body(['1'])]) {
      expect(await snapshots.take('admin', bad, [group(1)])).toMatchObject({ ok: false, error: 'bad_request' });
    }
    expect(urls).toHaveLength(0);
  });
});

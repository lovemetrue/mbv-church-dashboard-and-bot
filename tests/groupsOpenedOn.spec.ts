import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { GroupsRepo } from '../src/db/repos/groups.repo.js';
import { addMonthsIso } from '../src/home-groups/api/dates.js';
import { parseGroupForm } from '../src/dashboard/forms.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
let repo: GroupsRepo;
beforeAll(async () => { db = await setupTestDb(); repo = new GroupsRepo(db); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const today = async () => (await db.query<{ d: string }>('SELECT current_date::text AS d')).rows[0]!.d;
const opened = async (id: number) => (await db.query<{ o: string | null }>('SELECT opened_on::text AS o FROM groups WHERE id = $1', [id])).rows[0]!.o;
const base = { leader: 'Иван', district: 'Приморский', format: 'Основная церковь' as const };

describe('дата открытия группы ставится базой', () => {
  test('группа заведена действующей из формы или бота — открыта сегодня; из выгрузки таблицы даты нет', async () => {
    const fromUi = await repo.create({ ...base, status: 'Функционирует' }, 'ui');
    const fromSheet = await repo.create({ ...base, status: 'Функционирует' }, 'таблица');
    expect(await opened(fromUi.id)).toBe(await today());
    expect(await opened(fromSheet.id)).toBeNull();
  });

  test('дату ставит только «Функционирует»: заведённая на паузе или в кампании она не получает, а возобновление с паузы новым открытием не считается', async () => {
    const paused = await repo.create({ ...base, status: 'На паузе' }, 'ui');
    const campaign = await repo.create({ ...base, status: 'Кампания' }, 'ui');
    expect(await opened(paused.id)).toBeNull();
    expect(await opened(campaign.id)).toBeNull();
    await repo.update(paused.id, { ...base, status: 'Функционирует' });
    expect(await opened(paused.id)).toBeNull();
  });

  test('потенциальная даты не имеет, а при переводе в «Функционирует» получает сегодняшнюю', async () => {
    const g = await repo.create({ ...base, status: 'Потенциальная' }, 'ui');
    expect(await opened(g.id)).toBeNull();
    await repo.update(g.id, { ...base, status: 'Функционирует' });
    expect(await opened(g.id)).toBe(await today());
  });

  test('старая группа из таблицы при правке статуса новой не становится: дата открытия ей неизвестна', async () => {
    const g = await repo.create({ ...base, status: 'На паузе' }, 'таблица');
    await repo.update(g.id, { ...base, status: 'Функционирует' });
    expect(await opened(g.id)).toBeNull();
  });

  test('заданную вручную дату, в том числе прошлую, база не перезаписывает', async () => {
    const g = await repo.create({ ...base, status: 'Функционирует', openedOn: '2026-01-15' }, 'ui');
    expect(await opened(g.id)).toBe('2026-01-15');
    const p = await repo.create({ ...base, status: 'Потенциальная' }, 'ui');
    await repo.update(p.id, { ...base, status: 'Функционирует', openedOn: '2026-05-20' });
    expect(await opened(p.id)).toBe('2026-05-20');
  });

  test('форма принимает дату открытия и отклоняет неверную', () => {
    const ok = parseGroupForm(new URLSearchParams({ leader: 'Иван', district: 'Приморский', format: 'Основная церковь', status: 'Функционирует', openedOn: '2026-09-01' }));
    expect(ok).toMatchObject({ ok: true, value: { openedOn: '2026-09-01' } });
    const bad = parseGroupForm(new URLSearchParams({ leader: 'Иван', district: 'Приморский', format: 'Основная церковь', status: 'Функционирует', openedOn: '01.09.2026' }));
    expect(bad).toMatchObject({ ok: false });
  });

  test('миграция 040 не ставит дату уже лежащим в базе группам', async () => {
    const g = await repo.create({ ...base, status: 'Функционирует' }, 'ui');
    await db.query('ALTER TABLE groups DROP COLUMN opened_on CASCADE');
    await db.query('DROP FUNCTION IF EXISTS groups_set_opened_on() CASCADE');
    await db.query(readFileSync(new URL('../migrations/040_groups_opened_on.sql', import.meta.url), 'utf8'));
    expect(await opened(g.id)).toBeNull();
  });
});

describe('миграция 041', () => {
  test('перезапись триггера применяется к уже существующей базе без ошибок и сохраняет правило', async () => {
    await db.query(readFileSync(new URL('../migrations/041_opened_on_only_functioning.sql', import.meta.url), 'utf8'));
    const g = await repo.create({ ...base, status: 'Потенциальная' }, 'ui');
    await repo.update(g.id, { ...base, status: 'Функционирует' });
    expect(await opened(g.id)).toBe(await today());
  });
});

describe('addMonthsIso', () => {
  test.each([
    ['2026-06-11', 4, '2026-10-11'],
    ['2026-10-31', 4, '2027-02-28'],
    ['2026-09-30', 4, '2027-01-30'],
    ['2024-10-31', 4, '2025-02-28'],
    ['2026-01-31', 1, '2026-02-28'],
  ])('%s + %i мес. = %s', (iso, n, expected) => {
    expect(addMonthsIso(iso, n)).toBe(expected);
  });
  test('не дата — null', () => {
    expect(addMonthsIso('вчера', 4)).toBeNull();
    expect(addMonthsIso('2026-02-31', 4)).toBeNull();
  });
});

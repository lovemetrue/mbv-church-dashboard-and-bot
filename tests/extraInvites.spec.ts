import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { createExtraInvites } from '../src/core/extraInvites.js';
import { createDeps, type Deps } from '../src/deps.js';
import { T } from '../src/core/texts.js';
import type { Platform, PlatformName } from '../src/core/platform.js';
import { FakePlatform } from './helpers/fakePlatform.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
let tg: FakePlatform;
let deps: Deps;

beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });

function build(extraQuestions: string, platforms: PlatformName[] = ['telegram']): void {
  tg = new FakePlatform('telegram');
  const map = new Map<PlatformName, Platform>(platforms.map((p) => [p, p === 'telegram' ? tg : new FakePlatform(p)]));
  deps = createDeps({
    db,
    platforms: map,
    admins: new Map(),
    schedule: { startDate: '2026-09-01', broadcastTime: '07:00', totalDays: 40, timezone: 'Europe/Moscow' },
    broadcastRate: 1000,
    extraQuestions,
  });
}

beforeEach(async () => {
  await truncateAll(db);
  build('all');
});

const sentTo = (id: string) => tg.sent.filter((m) => m.chatId === id);

describe('досылка новых вопросов', () => {
  test('считает ищущих группу и готовых открыть отдельно, остальных не трогает', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'join' });
    await seedUser(db, { id: '2', mdgStatus: 'join' });
    await seedUser(db, { id: '3', mdgStatus: 'open' });
    await seedUser(db, { id: '4', mdgStatus: 'home' });
    await seedUser(db, { id: '5', mdgStatus: 'member' });

    expect(await createExtraInvites(deps).preview()).toEqual({ join: 2, lead: 2, total: 4, setting: 'all', off: false });
  });

  test('при выключенных вопросах получателей нет и это видно отдельным признаком', async () => {
    build('off');
    await seedUser(db, { id: '1', mdgStatus: 'join' });
    expect(await createExtraInvites(deps).preview()).toMatchObject({ total: 0, off: true });
  });

  test('в режиме «только этим людям» получает только перечисленный', async () => {
    build('2');
    await seedUser(db, { id: '1', mdgStatus: 'join' });
    await seedUser(db, { id: '2', mdgStatus: 'join' });
    const invites = createExtraInvites(deps);
    expect(await invites.preview()).toMatchObject({ join: 1, total: 1 });
    await invites.send();
    expect(sentTo('1')).toEqual([]);
    expect(sentTo('2')).toHaveLength(1);
  });

  test('отправка шлёт каждому свой текст с кнопками и возвращает итог доставки', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'join' });
    await seedUser(db, { id: '3', mdgStatus: 'open' });
    const result = await createExtraInvites(deps).send();
    expect(result).toEqual({ status: 'sent', sent: 2, failed: 0, blocked: 0 });
    expect(sentTo('1').map((m) => m.text)).toEqual([T.followUpInviteJoin]);
    expect(sentTo('3').map((m) => m.text)).toEqual([T.followUpInviteLead]);
    expect(sentTo('1')[0]!.buttons).toBeDefined();
  });

  test('повторная отправка никому не пишет второй раз', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'join' });
    const invites = createExtraInvites(deps);
    await invites.send();
    expect(await invites.send()).toEqual({ status: 'none' });
    expect(sentTo('1')).toHaveLength(1);
  });

  test('если число получателей изменилось с момента показа, ничего не уходит', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'join' });
    await seedUser(db, { id: '2', mdgStatus: 'join' });
    const result = await createExtraInvites(deps).send(1);
    expect(result).toEqual({ status: 'changed', actual: 2 });
    expect(tg.sent).toEqual([]);
    expect((await deps.users.followUpCandidates(['telegram'])).length).toBe(2);
  });

  test('подтверждённое число совпало — отправка идёт', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'join' });
    expect(await createExtraInvites(deps).send(1)).toMatchObject({ status: 'sent', sent: 1 });
  });

  test('людям платформы, которая в сервисе не подключена, не пишем и не считаем', async () => {
    await seedUser(db, { id: '10', mdgStatus: 'join', platform: 'max' });
    expect(await createExtraInvites(deps).preview()).toMatchObject({ total: 0 });
  });
});

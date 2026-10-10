import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { Pool } from 'pg';
import { BroadcastSender } from '../src/broadcast/sender.js';
import { RateLimiter } from '../src/broadcast/throttle.js';
import { followUpKeyboard } from '../src/core/texts.js';
import type { Platform, PlatformName } from '../src/core/platform.js';
import { DeliveriesRepo } from '../src/db/repos/deliveries.repo.js';
import { UsersRepo } from '../src/db/repos/users.repo.js';
import { FakePlatform } from './helpers/fakePlatform.js';
import { seedUser, setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
let users: UsersRepo;
let deliveries: DeliveriesRepo;

beforeAll(async () => {
  db = await setupTestDb();
  users = new UsersRepo(db);
  deliveries = new DeliveriesRepo(db);
});
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const TG: PlatformName[] = ['telegram'];
const ids = async (platforms: PlatformName[] = TG) => (await users.followUpCandidates(platforms)).map((c) => c.platform_user_id).sort();

describe('кому досылать вопросы', () => {
  test('тем, у кого заявка «хочу в группу», «готов открыть» и «дам дом»', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'join' });
    await seedUser(db, { id: '2', mdgStatus: 'open' });
    await seedUser(db, { id: '3', mdgStatus: 'home' });
    expect(await ids()).toEqual(['1', '2', '3']);
  });

  test('состоящим в группе, ведущим и без ответа про группу — нет: подбор им не нужен', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'member' });
    await seedUser(db, { id: '2', mdgStatus: 'leader' });
    await seedUser(db, { id: '3', mdgStatus: null });
    expect(await ids()).toEqual([]);
  });

  test('не зарегистрированным и заблокировавшим бота — нет', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'join', registered: false });
    await seedUser(db, { id: '2', mdgStatus: 'join', blocked: true });
    expect(await ids()).toEqual([]);
  });

  test('тем, кто уже ответил на любой из двух вопросов, — нет', async () => {
    const a = await seedUser(db, { id: '1', mdgStatus: 'join' });
    const b = await seedUser(db, { id: '2', mdgStatus: 'join' });
    await db.query('UPDATE users SET schedule_raw = $2 WHERE id = $1', [a, 'вечером']);
    await db.query('UPDATE users SET address_raw = $2 WHERE id = $1', [b, 'ул Рылеева 32']);
    expect(await ids()).toEqual([]);
  });

  test('тем, кому приглашение уже отправляли, — нет: напоминаний не будет', async () => {
    const a = await seedUser(db, { id: '1', mdgStatus: 'join' });
    await seedUser(db, { id: '2', mdgStatus: 'join' });
    await db.query('UPDATE users SET extra_invited_at = now() WHERE id = $1', [a]);
    expect(await ids()).toEqual(['2']);
  });

  test('тем, у кого нет чата с ботом (завели служители в дашборде), — нет: писать некуда', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'join', chatId: '' });
    expect(await ids()).toEqual([]);
  });

  test('только включённые платформы', async () => {
    await seedUser(db, { id: '1', mdgStatus: 'join', platform: 'telegram' });
    await seedUser(db, { id: '2', mdgStatus: 'join', platform: 'max' });
    expect(await ids(['telegram'])).toEqual(['1']);
    expect(await ids(['telegram', 'max'])).toEqual(['1', '2']);
  });
});

describe('очередь приглашений', () => {
  test('в очередь попадают только названные люди, и им ставится отметка «приглашён»', async () => {
    const a = await seedUser(db, { id: '1', mdgStatus: 'join' });
    await seedUser(db, { id: '2', mdgStatus: 'join' });

    const { created, queued } = await deliveries.openFor('extra:t1', 'Приглашение', followUpKeyboard(), [a]);

    expect(created).toBe(true);
    expect(queued).toBe(1);
    expect(await ids()).toEqual(['2']);
  });

  test('рассылка хранит кнопки вместе с текстом', async () => {
    const a = await seedUser(db, { id: '1', mdgStatus: 'join' });
    await deliveries.openFor('extra:t1', 'Приглашение', followUpKeyboard(), [a]);
    expect(await deliveries.message('extra:t1')).toEqual({ body: 'Приглашение', buttons: followUpKeyboard() });
  });

  test('у обычной рассылки кнопок нет', async () => {
    await seedUser(db, { id: '1' });
    await deliveries.open('day:1', 'Слово дня', TG);
    expect(await deliveries.message('day:1')).toEqual({ body: 'Слово дня', buttons: null });
  });

  test('приглашение уходит с кнопками, обычное объявление — без них', async () => {
    const tg = new FakePlatform('telegram');
    const platforms = new Map<PlatformName, Platform>([['telegram', tg]]);
    const sender = new BroadcastSender({
      deliveries, users, platforms, limiters: new Map([['telegram', new RateLimiter(1000)]]), maxAttempts: 3,
    });
    const a = await seedUser(db, { id: '1', mdgStatus: 'join' });
    await deliveries.openFor('extra:t1', 'Приглашение', followUpKeyboard(), [a]);
    await deliveries.open('day:1', 'Слово дня', TG);

    await sender.run('extra:t1');
    await sender.run('day:1');

    expect(tg.sent.find((m) => m.text === 'Приглашение')?.buttons).toEqual(followUpKeyboard());
    expect(tg.sent.find((m) => m.text === 'Слово дня')?.buttons).toBeUndefined();
  });
});

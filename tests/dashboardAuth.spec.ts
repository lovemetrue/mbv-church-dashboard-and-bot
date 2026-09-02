import { describe, expect, test, beforeEach } from 'vitest';
import { SessionService, type SessionStore } from '../src/dashboard/sessions.js';

/** Хранилище в памяти вместо Redis: те же операции, без внешней зависимости. */
function fakeStore(): SessionStore & { data: Map<string, { value: string; ttl: number }> } {
  const data = new Map<string, { value: string; ttl: number }>();
  return {
    data,
    async set(key, value, ttlSeconds) {
      data.set(key, { value, ttl: ttlSeconds });
    },
    async get(key) {
      return data.get(key)?.value ?? null;
    },
    async del(key) {
      data.delete(key);
    },
    async incr(key, ttlSeconds) {
      const n = Number(data.get(key)?.value ?? 0) + 1;
      data.set(key, { value: String(n), ttl: ttlSeconds });
      return n;
    },
  };
}

let store: ReturnType<typeof fakeStore>;
let auth: SessionService;

beforeEach(() => {
  store = fakeStore();
  auth = new SessionService(store, { password: 'верный-пароль', ttlSeconds: 3600, maxAttempts: 5 });
});

describe('вход по паролю', () => {
  test('верный пароль создаёт сессию', async () => {
    const r = await auth.login('верный-пароль', '1.2.3.4');
    expect(r.ok).toBe(true);
    expect(r.sid).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  });

  test('неверный пароль сессию не создаёт', async () => {
    const r = await auth.login('другой', '1.2.3.4');
    expect(r.ok).toBe(false);
    expect(r.sid).toBeUndefined();
  });

  test('пустой пароль не проходит', async () => {
    expect((await auth.login('', '1.2.3.4')).ok).toBe(false);
  });

  test('идентификаторы сессий не повторяются', async () => {
    const a = await auth.login('верный-пароль', '1.2.3.4');
    const b = await auth.login('верный-пароль', '1.2.3.4');
    expect(a.sid).not.toBe(b.sid);
  });
});

describe('проверка сессии', () => {
  test('свежая сессия признаётся действительной', async () => {
    const { sid } = await auth.login('верный-пароль', '1.2.3.4');
    expect(await auth.verify(sid!)).toBe(true);
  });

  test('выдуманный идентификатор не проходит', async () => {
    expect(await auth.verify('поддельный-идентификатор')).toBe(false);
  });

  test('пустая кука не проходит', async () => {
    expect(await auth.verify(undefined)).toBe(false);
    expect(await auth.verify('')).toBe(false);
  });

  test('после выхода сессия перестаёт работать', async () => {
    const { sid } = await auth.login('верный-пароль', '1.2.3.4');
    await auth.logout(sid!);
    expect(await auth.verify(sid!)).toBe(false);
  });

  test('обращение продлевает срок жизни сессии', async () => {
    const { sid } = await auth.login('верный-пароль', '1.2.3.4');
    const key = [...store.data.keys()].find((k) => k.includes('sess'))!;
    store.data.set(key, { value: store.data.get(key)!.value, ttl: 10 });

    await auth.verify(sid!);

    expect(store.data.get(key)!.ttl).toBe(3600);
  });
});

describe('защита от перебора пароля', () => {
  test('после серии ошибок вход блокируется даже с верным паролем', async () => {
    for (let i = 0; i < 5; i += 1) await auth.login('мимо', '9.9.9.9');

    const r = await auth.login('верный-пароль', '9.9.9.9');
    expect(r.ok).toBe(false);
    expect(r.lockedOut).toBe(true);
  });

  test('блокировка привязана к адресу и других не задевает', async () => {
    for (let i = 0; i < 5; i += 1) await auth.login('мимо', '9.9.9.9');

    expect((await auth.login('верный-пароль', '1.1.1.1')).ok).toBe(true);
  });

  test('удачный вход обнуляет счётчик ошибок', async () => {
    await auth.login('мимо', '5.5.5.5');
    await auth.login('мимо', '5.5.5.5');
    await auth.login('верный-пароль', '5.5.5.5');

    for (let i = 0; i < 4; i += 1) await auth.login('мимо', '5.5.5.5');
    // Счётчик начался заново, значит четыре ошибки ещё не блокируют.
    expect((await auth.login('верный-пароль', '5.5.5.5')).ok).toBe(true);
  });
});

describe('разбор куки', () => {
  test('находит нужное значение среди других кук', () => {
    expect(SessionService.readCookie('theme=dark; hg_sid=abc123; other=1', 'hg_sid')).toBe('abc123');
  });

  test('без нужной куки возвращает undefined', () => {
    expect(SessionService.readCookie('theme=dark', 'hg_sid')).toBeUndefined();
  });

  test('пустой заголовок не ломает разбор', () => {
    expect(SessionService.readCookie(undefined, 'hg_sid')).toBeUndefined();
  });

  test('не путает куку с похожим именем', () => {
    expect(SessionService.readCookie('xhg_sid=нет; hg_sid=да', 'hg_sid')).toBe('да');
  });
});

import { afterEach, describe, expect, test, vi } from 'vitest';
import { API_BASE, LOGIN_URL } from './base';
import { ApiError, apiGet, apiPost, setLoginRedirect } from './client';

afterEach(() => {
  vi.unstubAllGlobals();
  setLoginRedirect(null);
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('клиент API', () => {
  test('адрес строится от единой константы базового адреса', async () => {
    const fetchMock = vi.fn(async () => json({ ok: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    await apiGet('today');
    expect(API_BASE).toBe('/api/v1/');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/today', expect.objectContaining({ credentials: 'same-origin' }));
  });

  test('ответ 401 уводит на страницу входа и всё равно считается ошибкой', async () => {
    const redirect = vi.fn();
    setLoginRedirect(redirect);
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 401)));
    await expect(apiGet('today')).rejects.toMatchObject({ status: 401 });
    expect(redirect).toHaveBeenCalledWith(LOGIN_URL);
    expect(LOGIN_URL).toBe('/login');
  });

  test('ответ 403 — ошибка «нет доступа», на вход не уводит', async () => {
    const redirect = vi.fn();
    setLoginRedirect(redirect);
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 403)));
    await expect(apiGet('requests')).rejects.toMatchObject({ status: 403, message: 'Нет доступа' });
    expect(redirect).not.toHaveBeenCalled();
  });

  test('ответ 500 превращается в ApiError с кодом', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 500)));
    await expect(apiGet('groups')).rejects.toBeInstanceOf(ApiError);
    await expect(apiGet('groups')).rejects.toMatchObject({ status: 500 });
  });

  test('обрыв сети превращается в ApiError с кодом 0', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(apiGet('people')).rejects.toMatchObject({ status: 0 });
  });

  test('ответ, не являющийся JSON, не роняет страницу необработанной ошибкой', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })));
    await expect(apiGet('people')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('клиент API: действия (POST)', () => {
  test('POST шлёт JSON с Content-Type и телом, адрес строится от базы', async () => {
    const fetchMock = vi.fn(async () => json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiPost('requests/5/approve', { groupId: 3 })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/requests/5/approve',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: '{"groupId":3}',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  test('код ошибки действия из тела ответа попадает в ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'group_full', message: 'мест нет' }, 409)));
    await expect(apiPost('requests/5/approve', {})).rejects.toMatchObject({ status: 409, code: 'group_full' });
  });

  test('код conflict (логин или почта заняты) попадает в ApiError вместе с текстом сервера', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'conflict', message: 'логин занят' }, 409)));
    await expect(apiPost('settings/staff/create', {})).rejects.toMatchObject({
      status: 409,
      code: 'conflict',
      message: 'логин занят',
    });
  });

  test('неизвестный код и тело не в JSON не ломают разбор: остаётся статус', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'что-то_новое', message: '' }, 409)));
    await expect(apiPost('x', {})).rejects.toMatchObject({ status: 409, code: null });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 502 })));
    await expect(apiPost('x', {})).rejects.toMatchObject({ status: 502, code: null });
  });

  test('обрыв сети — ApiError с кодом 0, а 401 уводит на вход', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(apiPost('x', {})).rejects.toMatchObject({ status: 0 });
    const redirect = vi.fn();
    setLoginRedirect(redirect);
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 401)));
    await expect(apiPost('x', {})).rejects.toMatchObject({ status: 401 });
    expect(redirect).toHaveBeenCalledWith(LOGIN_URL);
  });
});

import { afterEach, describe, expect, test, vi } from 'vitest';
import { API_BASE, LOGIN_URL } from './base';
import { ApiError, apiGet, setLoginRedirect } from './client';

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

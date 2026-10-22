import type { KitPerson, KitsView, Me } from '@contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { renderAt, stubFetchWithFixtures } from '../../test/render';
import { getsOf, json, posts } from '../../test/calls';

// Распознавание подменяется: в jsdom нет ни камеры, ни холста с пикселями. Проверяем, что экран делает с текстом кода.
const decode = vi.hoisted(() => ({ photo: vi.fn<(file: Blob) => Promise<string | null>>(), frame: vi.fn<() => string | null>() }));
vi.mock('./decode', () => ({
  LIVE_SIDES: [640, 400],
  frameOf: () => ({}),
  decodeFrame: () => decode.frame(),
  decodePhoto: (file: Blob) => decode.photo(file),
}));

const person = (patch: Partial<KitPerson> = {}): KitPerson => ({
  userId: 12, registrationNo: 1042, fio: 'Иван Петров', phone: '+7 911 000-11-22', issuedAt: null, issuedBy: null, ...patch,
});
const view = (patch: Partial<KitsView> = {}): KitsView => ({
  generatedAt: '2026-10-22T09:00:00Z', registered: 87, issued: 43, issuedToday: 9,
  recent: [person({ userId: 7, registrationNo: 7, fio: 'Анна Смирнова', issuedAt: '2026-10-22T08:30:00Z', issuedBy: 'p_ivanova' })],
  ...patch,
});

/** Камера доступна, как на https; по умолчанию в jsdom — как по http. */
function secureContext(on: boolean) {
  vi.stubGlobal('isSecureContext', on);
}

function open(opts: { role?: Me['role']; find?: () => Response; issue?: () => Response; undo?: () => Response } = {}) {
  const fetchMock = stubFetchWithFixtures({
    me: () => json({ role: opts.role ?? 'admin' }),
    kits: () => json(view()),
    'kits/find': opts.find ?? (() => json({ ok: true, person: person() })),
    'kits/issue': opts.issue ?? (() => json({ ok: true, person: person({ issuedAt: '2026-10-22T09:05:00Z', issuedBy: 'p_ivanova' }), changed: true })),
    'kits/undo': opts.undo ?? (() => json({ ok: true, person: person(), changed: true })),
  });
  renderAt(<App />, '/?tab=kits');
  return fetchMock;
}

async function findByNumber(user: ReturnType<typeof userEvent.setup>, no: string) {
  await user.type(await screen.findByLabelText('Номер регистрации'), no);
  await user.click(screen.getByRole('button', { name: 'Найти' }));
}

beforeEach(() => {
  decode.photo.mockReset();
  decode.frame.mockReset();
  secureContext(false);
});
afterEach(() => vi.unstubAllGlobals());

describe('«Наборы»: вкладка и счётчики', () => {
  test('вкладка видна обычному входу и показывает выдано сегодня, всего из скольких и сколько осталось', async () => {
    open({ role: 'admin' });
    expect(screen.getByRole('tab', { name: 'Наборы' })).toHaveAttribute('aria-selected', 'true');
    const tiles = await screen.findByLabelText('Выдача наборов');
    const value = (label: string) => within(tiles).getByText(label).nextElementSibling!.textContent;
    expect(value('Выдано сегодня')).toBe('9');
    expect(value('Выдано всего')).toBe('43 / 87');
    expect(value('Ещё не выдано')).toBe('44');
  });

  test('последние выдачи: имя, номер и кто выдал; по нажатию открывается карточка этого участника', async () => {
    const fetchMock = open();
    const user = userEvent.setup();
    const recent = await screen.findByRole('region', { name: 'Последние выдачи' });
    expect(within(recent).getByText(/№7 · .* · p_ivanova/)).toBeInTheDocument();
    await user.click(within(recent).getByRole('button', { name: 'Открыть: Анна Смирнова' }));
    await waitFor(() => expect(posts(fetchMock)).toEqual([{ path: 'kits/find', body: { code: '7' } }]));
  });
});

describe('«Наборы»: выдача', () => {
  test('номер руками → карточка с именем и телефоном → «Выдать набор» отмечает выдачу и обновляет счётчики', async () => {
    const fetchMock = open();
    const user = userEvent.setup();
    await findByNumber(user, '1042');
    const card = await screen.findByRole('region', { name: 'Участник' });
    expect(within(card).getByText('Иван Петров')).toBeInTheDocument();
    expect(within(card).getByText('Регистрация №1042')).toBeInTheDocument();
    expect(within(card).getByText('+7 911 000-11-22')).toBeInTheDocument();
    expect(within(card).getByText('Набор ещё не выдан')).toBeInTheDocument();
    // Сразу после поиска ничего не отмечено: только карточка и кнопка.
    expect(posts(fetchMock).map((p) => p.path)).toEqual(['kits/find']);

    const before = getsOf(fetchMock, 'kits');
    await user.click(within(card).getByRole('button', { name: 'Выдать набор' }));
    expect(await within(card).findByText('✓ Набор выдан')).toBeInTheDocument();
    expect(within(card).getByText(/^Набор выдан .* · p_ivanova$/)).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Выдать набор' })).not.toBeInTheDocument();
    expect(posts(fetchMock).at(-1)).toEqual({ path: 'kits/issue', body: { userId: 12 } });
    await waitFor(() => expect(getsOf(fetchMock, 'kits')).toBeGreaterThan(before));
  });

  test('уже выданный: предупреждение и без кнопки «Выдать»; ошибочную выдачу можно отменить', async () => {
    const fetchMock = open({ find: () => json({ ok: true, person: person({ issuedAt: '2026-10-21T15:00:00Z', issuedBy: 'бот' }) }) });
    const user = userEvent.setup();
    await findByNumber(user, '1042');
    const card = await screen.findByRole('region', { name: 'Участник' });
    expect(within(card).getByText('Этому участнику набор уже выдан — второй не нужен.')).toBeInTheDocument();
    expect(within(card).getByText(/· бот$/)).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Выдать набор' })).not.toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: 'Отменить выдачу' }));
    expect(await within(card).findByText('Выдача отменена')).toBeInTheDocument();
    expect(posts(fetchMock).at(-1)).toEqual({ path: 'kits/undo', body: { userId: 12 } });
    expect(within(card).getByRole('button', { name: 'Выдать набор' })).toBeInTheDocument();
  });

  test('«Следующий участник» убирает карточку и очищает поле номера', async () => {
    open();
    const user = userEvent.setup();
    await findByNumber(user, '1042');
    const card = await screen.findByRole('region', { name: 'Участник' });
    await user.click(within(card).getByRole('button', { name: 'Следующий участник' }));
    expect(screen.queryByRole('region', { name: 'Участник' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Номер регистрации')).toHaveValue('');
  });

  test('неизвестный номер: показывается ответ сервера', async () => {
    open({ find: () => json({ error: 'not_found', message: 'Регистрации №5 нет.' }, 404) });
    const user = userEvent.setup();
    await findByNumber(user, '5');
    expect(await screen.findByRole('alert')).toHaveTextContent('Регистрации №5 нет.');
  });
});

describe('«Наборы»: камера и снимок', () => {
  test('по http живой камеры нет: объяснение и кнопка «Сфотографировать QR»', async () => {
    open();
    expect(await screen.findByText(/работает только на защищённом адресе \(https\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Включить камеру' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сфотографировать QR' })).toBeInTheDocument();
  });

  test('снимок с QR: текст кода уходит на сервер как есть', async () => {
    decode.photo.mockResolvedValue('https://t.me/church40bot?start=kit_1042');
    const fetchMock = open();
    const user = userEvent.setup();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input).toHaveAttribute('capture', 'environment');
    await user.upload(input, new File(['x'], 'qr.jpg', { type: 'image/jpeg' }));
    await screen.findByRole('region', { name: 'Участник' });
    expect(posts(fetchMock)).toEqual([{ path: 'kits/find', body: { code: 'https://t.me/church40bot?start=kit_1042' } }]);
  });

  test('на снимке QR не нашёлся: подсказка, на сервер ничего не уходит', async () => {
    decode.photo.mockResolvedValue(null);
    const fetchMock = open();
    const user = userEvent.setup();
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!, new File(['x'], 'qr.jpg', { type: 'image/jpeg' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/На снимке QR не нашёлся/);
    expect(posts(fetchMock)).toEqual([]);
  });

  describe('на https', () => {
    const stop = vi.fn();
    beforeEach(() => {
      secureContext(true);
      stop.mockReset();
      vi.stubGlobal('navigator', Object.assign(Object.create(navigator), {
        mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) },
        vibrate: vi.fn(),
      }));
      // В jsdom видео не играет и кадров не бывает: делаем вид, что кадр есть.
      vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
      vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4);
    });
    afterEach(() => vi.restoreAllMocks());

    test('камера читает код, открывает карточку и больше не шлёт запросов, пока карточка на экране', async () => {
      decode.frame.mockReturnValue('Регистрация №1042');
      const fetchMock = open();
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Включить камеру' }));
      await screen.findByRole('region', { name: 'Участник' });
      // Код всё ещё в кадре: за полсекунды распознавание шло бы трижды, но карточка его останавливает.
      await new Promise((r) => setTimeout(r, 500));
      expect(posts(fetchMock)).toEqual([{ path: 'kits/find', body: { code: 'Регистрация №1042' } }]);
    });

    test('«Выключить камеру» гасит поток: индикатор камеры на телефоне не горит', async () => {
      decode.frame.mockReturnValue(null);
      open();
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Включить камеру' }));
      expect(screen.getByLabelText('Камера для QR')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Выключить камеру' }));
      expect(stop).toHaveBeenCalled();
      expect(screen.queryByLabelText('Камера для QR')).not.toBeInTheDocument();
    });

    test('доступ к камере не дали: понятное объяснение, остаётся снимок', async () => {
      (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValue(new DOMException('нет', 'NotAllowedError'));
      open();
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Включить камеру' }));
      expect(await screen.findByRole('alert')).toHaveTextContent(/Браузер не дал доступ к камере/);
      expect(screen.queryByLabelText('Камера для QR')).not.toBeInTheDocument();
    });
  });
});

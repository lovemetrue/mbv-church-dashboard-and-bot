import type { KitMatch, KitPerson, KitsView, Me } from '@contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { renderAt, stubFetchWithFixtures } from '../../test/render';
import { getsOf, json, posts } from '../../test/calls';

const person = (patch: Partial<KitPerson> = {}): KitPerson => ({
  userId: 12, registrationNo: 1042, fio: 'Иван Петров', phone: '+7 911 000-11-22', issuedAt: null, issuedBy: null, ...patch,
});
const match = (patch: Partial<KitMatch> = {}): KitMatch => ({
  userId: 12, registrationNo: 1042, fio: 'Иван Петров', phoneTail: '1122', issuedAt: null, ...patch,
});
const view = (patch: Partial<KitsView> = {}): KitsView => ({
  generatedAt: '2026-10-22T09:00:00Z', registered: 87, issued: 43, issuedToday: 9,
  recent: [person({ userId: 7, registrationNo: 7, fio: 'Анна Смирнова', issuedAt: '2026-10-22T08:30:00Z', issuedBy: 'p_ivanova' })],
  ...patch,
});

function open(opts: { role?: Me['role']; find?: () => Response; search?: () => Response; issue?: () => Response; undo?: () => Response } = {}) {
  const fetchMock = stubFetchWithFixtures({
    me: () => json({ role: opts.role ?? 'admin' }),
    kits: () => json(view()),
    'kits/find': opts.find ?? (() => json({ ok: true, person: person() })),
    'kits/search': opts.search ?? (() => json({ ok: true, items: [match()], more: false })),
    'kits/issue': opts.issue ?? (() => json({ ok: true, person: person({ issuedAt: '2026-10-22T09:05:00Z', issuedBy: 'p_ivanova' }), changed: true })),
    'kits/undo': opts.undo ?? (() => json({ ok: true, person: person(), changed: true })),
  });
  renderAt(<App />, '/?tab=kits');
  return fetchMock;
}

async function search(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(await screen.findByLabelText('Номер или ФИО'), text);
  await user.click(screen.getByRole('button', { name: 'Найти' }));
}

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

  test('на узком экране выбранная вкладка «Наборы» прокручивается в видимую часть строки вкладок', async () => {
    const scrolled: string[] = [];
    const spy = vi.fn(function (this: Element) { scrolled.push(this.textContent ?? ''); });
    Element.prototype.scrollIntoView = spy;
    try {
      open();
      await screen.findByLabelText('Номер или ФИО');
      expect(scrolled).toContain('Наборы');
      expect(spy).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  test('найденный участник прокручивается в видимую часть экрана: на телефоне он ниже края', async () => {
    const scrolled: { el: Element; opts: unknown }[] = [];
    Element.prototype.scrollIntoView = function (this: Element, opts?: unknown) { scrolled.push({ el: this, opts }); };
    try {
      open();
      const user = userEvent.setup();
      await search(user, '1042');
      const card = await screen.findByRole('region', { name: 'Участник' });
      await waitFor(() => expect(scrolled.some((s) => s.el.contains(card))).toBe(true));
      expect(scrolled.find((s) => s.el.contains(card))!.opts).toEqual({ block: 'start', behavior: 'smooth' });
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  test('сканера на экране нет: камере нужен https, а интерфейс открывают по http', async () => {
    open();
    await screen.findByLabelText('Номер или ФИО');
    expect(screen.queryByRole('button', { name: /камер|QR/i })).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"], video')).toBeNull();
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

describe('«Наборы»: поиск', () => {
  test('номер (с «№» или без) открывает карточку сразу, без списка', async () => {
    const fetchMock = open();
    const user = userEvent.setup();
    await search(user, '№ 1042');
    await screen.findByRole('region', { name: 'Участник' });
    expect(posts(fetchMock)).toEqual([{ path: 'kits/find', body: { code: '1042' } }]);
  });

  test('ФИО — список совпадений с номером и хвостом телефона; нажатие открывает карточку', async () => {
    const fetchMock = open({
      search: () => json({ ok: true, more: false, items: [
        match(),
        match({ userId: 13, registrationNo: 1077, phoneTail: null, issuedAt: '2026-10-21T10:00:00Z' }),
      ] }),
    });
    const user = userEvent.setup();
    await search(user, 'Петров');
    expect(posts(fetchMock)).toEqual([{ path: 'kits/search', body: { query: 'Петров' } }]);
    const list = await screen.findByRole('region', { name: 'Найденные участники' });
    expect(within(list).getByText('Если тёзок несколько, спросите последние цифры телефона.')).toBeInTheDocument();
    const rows = within(list).getAllByRole('button', { name: 'Открыть: Иван Петров' });
    expect(rows[0]).toHaveTextContent('№1042 · тел. …1122');
    expect(rows[1]).toHaveTextContent('№1077 · без телефона');
    expect(rows[1]).toHaveTextContent('набор выдан');
    expect(rows[0]).not.toHaveTextContent('набор выдан');

    await user.click(rows[1]!);
    await screen.findByRole('region', { name: 'Участник' });
    expect(posts(fetchMock).at(-1)).toEqual({ path: 'kits/find', body: { code: '1077' } });
    expect(screen.queryByRole('region', { name: 'Найденные участники' })).not.toBeInTheDocument();
  });

  test('никого не нашли и «уточните» при лишних совпадениях', async () => {
    open({ search: () => json({ ok: true, items: [], more: false }) });
    const user = userEvent.setup();
    await search(user, 'Зиновьев');
    expect(await screen.findByText(/Никого не нашли/)).toBeInTheDocument();
  });

  test('совпадений больше десяти — подсказка добавить имя', async () => {
    open({ search: () => json({ ok: true, items: [match()], more: true }) });
    const user = userEvent.setup();
    await search(user, 'Иванов');
    expect(await screen.findByText('Показаны первые 10 — добавьте имя, чтобы сузить поиск.')).toBeInTheDocument();
  });

  test('короткий запрос: показывается ответ сервера', async () => {
    open({ search: () => json({ error: 'bad_request', message: 'Введите хотя бы 3 буквы имени или фамилии.' }, 400) });
    const user = userEvent.setup();
    await search(user, 'Ив');
    expect(await screen.findByRole('alert')).toHaveTextContent('Введите хотя бы 3 буквы имени или фамилии.');
  });

  test('неизвестный номер: показывается ответ сервера', async () => {
    open({ find: () => json({ error: 'not_found', message: 'Регистрации №5 нет.' }, 404) });
    const user = userEvent.setup();
    await search(user, '5');
    expect(await screen.findByRole('alert')).toHaveTextContent('Регистрации №5 нет.');
  });
});

describe('«Наборы»: выдача', () => {
  test('карточка с именем и телефоном → «Выдать набор» отмечает выдачу и обновляет счётчики', async () => {
    const fetchMock = open();
    const user = userEvent.setup();
    await search(user, '1042');
    const card = await screen.findByRole('region', { name: 'Участник' });
    expect(within(card).getByText('Иван Петров')).toBeInTheDocument();
    expect(within(card).getByText('Регистрация №1042')).toBeInTheDocument();
    expect(within(card).getByText('+7 911 000 11 22')).toBeInTheDocument();
    expect(within(card).getByText('Набор ещё не выдан')).toBeInTheDocument();
    // Найти — ещё не выдать: только карточка и кнопка.
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
    await search(user, '1042');
    const card = await screen.findByRole('region', { name: 'Участник' });
    expect(within(card).getByText('Этому участнику набор уже выдан — второй не нужен.')).toBeInTheDocument();
    expect(within(card).getByText(/· бот$/)).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'Выдать набор' })).not.toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: 'Отменить выдачу' }));
    expect(await within(card).findByText('Выдача отменена')).toBeInTheDocument();
    expect(posts(fetchMock).at(-1)).toEqual({ path: 'kits/undo', body: { userId: 12 } });
    expect(within(card).getByRole('button', { name: 'Выдать набор' })).toBeInTheDocument();
  });

  test('«Следующий участник» убирает карточку и очищает поле', async () => {
    open();
    const user = userEvent.setup();
    await search(user, '1042');
    const card = await screen.findByRole('region', { name: 'Участник' });
    await user.click(within(card).getByRole('button', { name: 'Следующий участник' }));
    expect(screen.queryByRole('region', { name: 'Участник' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Номер или ФИО')).toHaveValue('');
  });
});

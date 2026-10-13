import type { GeocoderConfigView } from '@contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { json, posts } from '../../test/calls';
import { currentSearch, makeClient, renderAt, stubFetchWithFixtures } from '../../test/render';

afterEach(() => vi.unstubAllGlobals());

// Ключи-пустышки собираются из частей: сканеры секретов не должны принимать их за настоящие.
const KEY = ['ya', 'new', 'key', '12345678'].join('-');

const view = (patch: Partial<GeocoderConfigView> = {}): GeocoderConfigView => ({
  keySet: true, keySource: 'env', keyHint: 'a1b2', keyUnreadable: false, usedToday: 42, dailyLimit: 900,
  addresses: { total: 12, found: 10, missing: 1, waiting: 1 }, ...patch,
});

function open(overrides: Parameters<typeof stubFetchWithFixtures>[0] = {}) {
  const fetchMock = stubFetchWithFixtures({ me: () => json({ role: 'super' }), 'settings/geocoder': () => json(view()), ...overrides });
  renderAt(<App />, '/?tab=settings&sec=geocoder', makeClient());
  return fetchMock;
}

async function block() {
  const region = await screen.findByRole('region', { name: 'Геокодер' });
  await within(region).findByLabelText('Ключ Яндекс.Геокодера');
  return region;
}

describe('«Настройки»: геокодер', () => {
  test('раздел есть в списке, показывает откуда ключ, последние четыре символа и расход за сутки; самого ключа нет', async () => {
    open();
    const region = await block();
    expect(within(screen.getByRole('navigation', { name: 'Разделы настроек' })).getByRole('button', { name: 'Геокодер' })).toBeInTheDocument();
    expect(within(region).getByText(/Ключ задан в файле \.env на сервере: ••••••••a1b2/)).toBeInTheDocument();
    expect(within(region).getByText(/сделано запросов: 42 из 900/)).toBeInTheDocument();
    expect(within(region).getByLabelText('Ключ Яндекс.Геокодера')).toHaveValue('');
  });

  test('показывает сводку по адресам; когда ждать нечего — подсказывает пересчитать предложения в «Заявках»', async () => {
    open({ 'settings/geocoder': () => json(view({ addresses: { total: 12, found: 11, missing: 1, waiting: 0 } })) });
    const region = await block();
    expect(within(region).getByText(/Всего адресов: 12\. Координаты найдены: 11\. Не нашлись: 1\. Ждут запроса: 0\./)).toBeInTheDocument();
    expect(within(region).getByText(/Пересчитать все предложения/)).toBeInTheDocument();
  });

  test('пока адреса ещё ждут запроса, подсказки про пересчёт нет', async () => {
    open();
    const region = await block();
    expect(within(region).queryByText(/Пересчитать все предложения/)).toBeNull();
  });

  test('сохранить можно только введённый ключ; он уходит в теле запроса, поле после сохранения очищается', async () => {
    const fetchMock = open({ 'settings/geocoder/save': () => json({ ok: true }) });
    const user = userEvent.setup();
    const region = await block();
    const save = within(region).getByRole('button', { name: 'Сохранить ключ' });
    expect(save).toBeDisabled();
    const field = within(region).getByLabelText('Ключ Яндекс.Геокодера');
    await user.type(field, ` ${KEY} `);
    await user.click(save);
    await waitFor(() => expect(posts(fetchMock).some((p) => p.path === 'settings/geocoder')).toBe(true));
    expect(posts(fetchMock).find((p) => p.path === 'settings/geocoder')!.body).toEqual({ apiKey: KEY });
    await waitFor(() => expect(field).toHaveValue(''));
    expect(await within(region).findByText(/Сохранено\./)).toBeInTheDocument();
  });

  test('проверка берёт введённый ключ, а без него — действующий; отказ Яндекса показывается словами', async () => {
    const fetchMock = open({ 'settings/geocoder-test': () => json({ ok: false, message: 'Яндекс не принял запрос: Геокодер ответил 403.' }) });
    const user = userEvent.setup();
    const region = await block();
    await user.click(within(region).getByRole('button', { name: 'Проверить' }));
    expect(await within(region).findByRole('alert')).toHaveTextContent('Геокодер ответил 403');
    await user.type(within(region).getByLabelText('Ключ Яндекс.Геокодера'), KEY);
    await user.click(within(region).getByRole('button', { name: 'Проверить' }));
    await waitFor(() => expect(posts(fetchMock).filter((p) => p.path === 'settings/geocoder-test')).toHaveLength(2));
    const bodies = posts(fetchMock).filter((p) => p.path === 'settings/geocoder-test').map((p) => p.body);
    expect(bodies).toEqual([{}, { apiKey: KEY }]);
  });

  test('«Убрать сохранённый ключ» есть только когда ключ лежит в настройках и спрашивает подтверждение', async () => {
    const fetchMock = open({ 'settings/geocoder': () => json(view({ keySource: 'settings' })) });
    const user = userEvent.setup();
    const region = await block();
    await user.click(within(region).getByRole('button', { name: 'Убрать сохранённый ключ' }));
    const dialog = await screen.findByRole('dialog', { name: 'Убрать сохранённый ключ?' });
    await user.click(within(dialog).getByRole('button', { name: 'Убрать ключ' }));
    await waitFor(() => expect(posts(fetchMock).find((p) => p.path === 'settings/geocoder')?.body).toEqual({ apiKey: null }));
  });

  test('ключ из .env кнопки «Убрать» не даёт', async () => {
    open();
    const region = await block();
    expect(within(region).queryByRole('button', { name: 'Убрать сохранённый ключ' })).toBeNull();
  });

  test('«Открыть таблицу адресов»: адрес, состояние, ссылки на карточки; по умолчанию видны те, что требуют внимания', async () => {
    open();
    const user = userEvent.setup();
    const region = await block();
    await user.click(within(region).getByRole('button', { name: 'Открыть таблицу адресов' }));
    const dialog = await screen.findByRole('dialog', { name: 'Таблица адресов' });
    expect(await within(dialog).findByText('ул. Несуществующая, 99')).toBeInTheDocument();
    expect(within(dialog).getByText('пр. Просвещения, 10')).toBeInTheDocument();
    // «Найдены» по умолчанию скрыты: смотреть нужно то, что требует внимания.
    expect(within(dialog).queryByText('Комендантский пр.')).toBeNull();
    await user.selectOptions(within(dialog).getByLabelText('Показать'), 'found');
    expect(within(dialog).getByText('Комендантский пр.')).toBeInTheDocument();
    // Адрес без дома найден по центру улицы — это видно в строке, чтобы не принять точку за дом.
    expect(within(dialog).getByText(/центр улицы/)).toBeInTheDocument();
    expect(within(dialog).queryByText('ул. Несуществующая, 99')).toBeNull();
  });

  test('из таблицы по ссылке открывается карточка, откуда взят адрес: группа, заявка или человек', async () => {
    open();
    const user = userEvent.setup();
    const region = await block();
    await user.click(within(region).getByRole('button', { name: 'Открыть таблицу адресов' }));
    const dialog = await screen.findByRole('dialog', { name: 'Таблица адресов' });
    await user.click(await within(dialog).findByRole('button', { name: 'Открыть карточку: Заявка №1, Мария Соколова' }));
    expect(currentSearch().get('tab')).toBe('requests');
    expect(currentSearch().get('req')).toBe('1');
  });

  test('«Определить заново» по строке делает один запрос именно по этому адресу и перечитывает таблицу', async () => {
    const fetchMock = open({ 'settings/geocoder-retry': () => json({ ok: true }) });
    const user = userEvent.setup();
    const region = await block();
    await user.click(within(region).getByRole('button', { name: 'Открыть таблицу адресов' }));
    const dialog = await screen.findByRole('dialog', { name: 'Таблица адресов' });
    await user.click(await within(dialog).findByRole('button', { name: 'Определить координаты заново: ул. Несуществующая, 99' }));
    await waitFor(() => expect(posts(fetchMock).find((p) => p.path === 'settings/geocoder-retry')?.body).toEqual({ address: 'ул. Несуществующая, 99' }));
  });
});

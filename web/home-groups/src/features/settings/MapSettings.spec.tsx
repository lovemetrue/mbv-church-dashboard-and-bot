import type { MapConfigView } from '@contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { json, posts } from '../../test/calls';
import { makeClient, renderAt, stubFetchWithFixtures } from '../../test/render';

afterEach(() => vi.unstubAllGlobals());

// Ключ-пустышка из частей: сканеры секретов не должны принимать его за настоящий.
const KEY = ['map', 'key', '12345678'].join('-');
const view = (patch: Partial<MapConfigView> = {}): MapConfigView => ({ keySet: true, keyHint: 'c3d4', keyUnreadable: false, loadsThisMonth: 7, monthlyLimit: 100, ...patch });

function open(overrides: Parameters<typeof stubFetchWithFixtures>[0] = {}) {
  const fetchMock = stubFetchWithFixtures({ me: () => json({ role: 'super' }), 'settings/map': () => json(view()), ...overrides });
  renderAt(<App />, '/?tab=settings&sec=map', makeClient());
  return fetchMock;
}
async function block() {
  const region = await screen.findByRole('region', { name: 'Карта' });
  await within(region).findByLabelText('Ключ Яндекс.Карт (JS API)');
  return region;
}

describe('«Настройки»: карта', () => {
  test('раздел есть в списке; показывает, что ключ сохранён, и расход открытий за месяц; самого ключа нет', async () => {
    open();
    const region = await block();
    expect(within(screen.getByRole('navigation', { name: 'Разделы настроек' })).getByRole('button', { name: 'Карта' })).toBeInTheDocument();
    expect(within(region).getByText(/Ключ сохранён: ••••••••c3d4/)).toBeInTheDocument();
    expect(within(region).getByText(/Карта открывалась в этом месяце: 7 из 100/)).toBeInTheDocument();
    expect(within(region).getByLabelText('Ключ Яндекс.Карт (JS API)')).toHaveValue('');
  });

  test('ключ уходит в теле запроса, поле после сохранения очищается', async () => {
    const fetchMock = open();
    const user = userEvent.setup();
    const region = await block();
    const field = within(region).getByLabelText('Ключ Яндекс.Карт (JS API)');
    const save = within(region).getByRole('button', { name: 'Сохранить ключ' });
    expect(save).toBeDisabled();
    await user.type(field, ` ${KEY} `);
    await user.click(save);
    await waitFor(() => expect(posts(fetchMock).find((p) => p.path === 'settings/map')?.body).toEqual({ apiKey: KEY }));
    await waitFor(() => expect(field).toHaveValue(''));
    expect(await within(region).findByText(/Сохранено\./)).toBeInTheDocument();
  });

  test('«Убрать сохранённый ключ» спрашивает подтверждение и отправляет null', async () => {
    const fetchMock = open();
    const user = userEvent.setup();
    const region = await block();
    await user.click(within(region).getByRole('button', { name: 'Убрать сохранённый ключ' }));
    const dialog = await screen.findByRole('dialog', { name: 'Убрать ключ карты?' });
    await user.click(within(dialog).getByRole('button', { name: 'Убрать ключ' }));
    await waitFor(() => expect(posts(fetchMock).find((p) => p.path === 'settings/map')?.body).toEqual({ apiKey: null }));
  });

  test('ключа нет — подсказка, а кнопки «Убрать» нет', async () => {
    open({ 'settings/map': () => json(view({ keySet: false, keyHint: null })) });
    const region = await block();
    expect(within(region).getByText(/Ключ не задан/)).toBeInTheDocument();
    expect(within(region).queryByRole('button', { name: 'Убрать сохранённый ключ' })).toBeNull();
  });
});

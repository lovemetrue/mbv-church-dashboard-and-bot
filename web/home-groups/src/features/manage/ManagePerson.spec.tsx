import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildCampaign } from '../../fixtures/campaign';
import { buildTeam } from '../../fixtures/team';
import { getsOf, json, posts } from '../../test/calls';
import { makeClient, renderAt, stubFetchWithFixtures } from '../../test/render';
import { CAMPAIGN_KEY } from '../campaign/useCampaign';

afterEach(() => vi.unstubAllGlobals());

const asAdmin = { me: () => json({ role: 'admin' }) };
const DELETE_TEXT = 'Регистрация будет стёрта вместе с заявками и рассылками. Это нельзя отменить.';

/** Карточка человека по адресу: u1 — участник с номером регистрации, u3 — участник без номера, r1 — заявка без участника. */
async function personCard(key: string, client = makeClient()) {
  renderAt(<App />, `/?tab=reference&ent=people&rec=${key}`, client);
  return screen.findByRole('dialog', { name: /Карточка человека/ });
}

describe('справочник «Люди»: удаление регистрации', () => {
  test('обычному входу кнопки «Удалить регистрацию» нет, хотя карточка и ссылки есть', async () => {
    stubFetchWithFixtures(asAdmin);
    const card = await personCard('u1');
    expect(within(card).getByRole('link', { name: /Карточка регистрации/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: /Удалить регистрацию/ })).not.toBeInTheDocument());
  });

  test('у обычного входа в карточке не остаётся пустого раздела на месте кнопки', async () => {
    const fetchMock = stubFetchWithFixtures(asAdmin);
    const card = await personCard('u1');
    await waitFor(() => expect(getsOf(fetchMock, 'me')).toBeGreaterThan(0));
    await act(async () => {});
    const empty = Array.from(card.querySelectorAll('section')).filter((section) => (section.textContent ?? '').trim() === '');
    expect(empty).toHaveLength(0);
  });

  test('пока роль неизвестна, кнопки тоже нет', async () => {
    stubFetchWithFixtures({ me: () => new Promise<Response>(() => {}) });
    const card = await personCard('u1');
    expect(within(card).getByRole('link', { name: /Карточка регистрации/ })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /Удалить регистрацию/ })).not.toBeInTheDocument();
  });

  test('полному входу кнопка видна у участника, в том числе без номера регистрации', async () => {
    stubFetchWithFixtures();
    const card = await personCard('u3');
    expect(await within(card).findByRole('button', { name: 'Удалить регистрацию: Софья Титова' })).toBeInTheDocument();
  });

  test('у заявки из таблицы без участника кнопки нет: стирать нечего', async () => {
    const fetchMock = stubFetchWithFixtures();
    const card = await personCard('r1');
    // Роль приходит отдельным запросом: ждём, пока кнопка могла бы появиться.
    await waitFor(() => expect(getsOf(fetchMock, 'me')).toBeGreaterThan(0));
    expect(within(card).queryByRole('button', { name: /Удалить регистрацию/ })).not.toBeInTheDocument();
  });

  test('нажатие просит подтверждение с предупреждением и до него ничего не отправляет', async () => {
    const fetchMock = stubFetchWithFixtures();
    const user = userEvent.setup();
    const card = await personCard('u1');
    await user.click(await within(card).findByRole('button', { name: 'Удалить регистрацию: Дарья Ефимова' }));
    const dialog = await screen.findByRole('dialog', { name: 'Удалить регистрацию: Дарья Ефимова?' });
    expect(within(dialog).getByText(DELETE_TEXT)).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog', { name: /^Удалить регистрацию/ })).not.toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  test('подтверждение шлёт пустое тело на people/:id/delete с id участника и закрывает карточку', async () => {
    const fetchMock = stubFetchWithFixtures({ 'people/1/delete': () => json({ ok: true }) });
    const user = userEvent.setup();
    const card = await personCard('u1');
    await user.click(await within(card).findByRole('button', { name: 'Удалить регистрацию: Дарья Ефимова' }));
    const dialog = await screen.findByRole('dialog', { name: /^Удалить регистрацию/ });
    await user.click(within(dialog).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(posts(fetchMock)).toEqual([{ path: 'people/1/delete', body: {} }]));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Карточка человека/ })).not.toBeInTheDocument());
  });

  test('после удаления перечитываются люди, заявки, «Сегодня», группы, «Команда» и «Кампания»', async () => {
    const client = makeClient();
    // Экранов «Команды» и «Кампании» сейчас нет на странице: кладём в кэш их данные и смотрим, помечены ли они устаревшими.
    client.setQueryData(['team'], buildTeam());
    client.setQueryData(CAMPAIGN_KEY, buildCampaign());
    const fetchMock = stubFetchWithFixtures({ 'people/1/delete': () => json({ ok: true }) });
    const user = userEvent.setup();
    const card = await personCard('u1', client);
    await screen.findByText(/Распределено/);
    const before = {
      people: getsOf(fetchMock, 'people'),
      requests: getsOf(fetchMock, 'requests'),
      today: getsOf(fetchMock, 'today'),
      groups: getsOf(fetchMock, 'groups'),
    };
    await user.click(await within(card).findByRole('button', { name: 'Удалить регистрацию: Дарья Ефимова' }));
    await user.click(within(await screen.findByRole('dialog', { name: /^Удалить регистрацию/ })).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Карточка человека/ })).not.toBeInTheDocument());
    await waitFor(() => {
      expect(getsOf(fetchMock, 'people')).toBeGreaterThan(before.people);
      expect(getsOf(fetchMock, 'requests')).toBeGreaterThan(before.requests);
      expect(getsOf(fetchMock, 'today')).toBeGreaterThan(before.today);
      expect(getsOf(fetchMock, 'groups')).toBeGreaterThan(before.groups);
    });
    expect(client.getQueryState(['team'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(CAMPAIGN_KEY)?.isInvalidated).toBe(true);
  });

  test('отказ сервера показывается в окне, карточка остаётся', async () => {
    stubFetchWithFixtures({ 'people/1/delete': () => json({ error: 'forbidden', message: 'служебный текст' }, 403) });
    const user = userEvent.setup();
    const card = await personCard('u1');
    await user.click(await within(card).findByRole('button', { name: 'Удалить регистрацию: Дарья Ефимова' }));
    const dialog = await screen.findByRole('dialog', { name: /^Удалить регистрацию/ });
    await user.click(within(dialog).getByRole('button', { name: 'Удалить' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Нет прав на это действие с этого входа.');
    expect(screen.getByRole('dialog', { name: /Карточка человека/ })).toBeInTheDocument();
  });
});

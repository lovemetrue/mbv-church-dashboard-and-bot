import type { Me } from '@contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../test/render';
import { App } from './App';


afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const READER: Me = { role: 'readonly', person: { login: 'chitatel', name: 'Читатель', teamRole: null, teamKinds: [] } };
const DISTRIBUTOR: Me = { role: 'admin', person: { login: 'raspred', name: 'Родионов Давид', teamRole: 'Распределитель', teamKinds: ['distributor'] } };

type FetchMock = ReturnType<typeof stubFetchWithFixtures>;
const paths = (fetchMock: FetchMock) =>
  (fetchMock.mock.calls as unknown as [RequestInfo | URL][]).map(([url]) => String(url).replace(/^.*\/api\/v1\//, ''));

function openAs(me: Me, at: string) {
  const fetchMock = stubFetchWithFixtures({ me: () => json(me) });
  renderAt(<App />, at);
  return fetchMock;
}

describe('вход «Только чтение»', () => {
  test('вкладки — только для чтения: «Наборы» есть, «Команды» и «Настроек» нет; меню «+ Создать» нет', async () => {
    openAs(READER, '/');
    // Список вкладок берём заново на каждой попытке: до ответа `/me` оболочка рисуется для обычного входа.
    await waitFor(() =>
      expect(within(screen.getByRole('tablist', { name: 'Разделы' })).getAllByRole('tab').map((t) => t.textContent?.replace(/\d+$/, '').trim())).toEqual(['Сегодня', 'Заявки', 'Группы', 'Наборы', 'Справочник']),
    );
    expect(screen.queryByRole('button', { name: '+ Создать' })).not.toBeInTheDocument();
  });

  test('адрес «Команды», набранный вручную, уводит на «Сегодня», и сводку команды не запрашивает', async () => {
    const fetchMock = openAs(READER, '/?tab=team');
    await waitFor(() => expect(currentSearch().get('tab')).toBeNull());
    expect(paths(fetchMock)).not.toContain('team');
  });

  test('в «Заявках» нет запуска подбора и флажков выбора; в карточке заявки нет решения и рабочего блока', async () => {
    openAs(READER, '/?tab=requests&req=1');
    const card = await screen.findByRole('dialog', { name: /Карточка заявки/ });
    expect(screen.queryByRole('button', { name: 'Предложить группы новым заявкам' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /^Выбрать заявку/ })).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /^Утвердить/ })).not.toBeInTheDocument();
    expect(within(card).queryByText('Работа с заявкой')).not.toBeInTheDocument();
    // Сама заявка видна: человек, предложение, журнал.
    expect(within(card).getByText(/Контакты/)).toBeInTheDocument();
  });

  test('в «Справочнике» у группы нет карандаша и «Добавить в состав»', async () => {
    openAs(READER, '/?tab=reference&rec=1');
    const card = await screen.findByRole('dialog', { name: /Карточка группы/ });
    expect(within(card).queryByRole('button', { name: /^Править группу/ })).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /Добавить/ })).not.toBeInTheDocument();
  });

  test('«Координаторов» видно, но без «+ Добавить координатора» и без правки в карточке', async () => {
    openAs(READER, '/?tab=reference&ent=coordinators&rec=1');
    const card = await screen.findByRole('dialog', { name: /Карточка координатора/ });
    expect(screen.getByRole('button', { name: /^Координаторы/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Добавить координатора/ })).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /^Изменить|^Править/ })).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /Удалить/ })).not.toBeInTheDocument();
  });

});

describe('распределитель', () => {
  test('у карточки группы нет карандаша правки, а решение по заявке есть', async () => {
    openAs(DISTRIBUTOR, '/?tab=reference&rec=1');
    const group = await screen.findByRole('dialog', { name: /Карточка группы/ });
    await waitFor(() => expect(within(group).queryByRole('button', { name: /^Править группу/ })).not.toBeInTheDocument());
  });

  test('обычный вход без ролей команды группу правит, как и раньше', async () => {
    openAs({ role: 'admin' }, '/?tab=reference&rec=1');
    const group = await screen.findByRole('dialog', { name: /Карточка группы/ });
    expect(await within(group).findByRole('button', { name: /^Править группу/ })).toBeInTheDocument();
  });

  test('решение по заявке распределителю доступно', async () => {
    openAs(DISTRIBUTOR, '/?tab=requests&req=1');
    const card = await screen.findByRole('dialog', { name: /Карточка заявки/ });
    expect((await within(card).findAllByRole('button', { name: /^Утвердить/ })).length).toBeGreaterThan(0);
  });
});

import type { SettingsStaffView, TeamAccountItem } from '@contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { buildSettingsStaff, SAMPLE_ISSUED } from '../../fixtures/settings';
import { posts } from '../../test/calls';
import { makeClient, renderAt, stubFetchWithFixtures } from '../../test/render';
import { UsersSection } from './UsersSection';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const member = (over: Partial<TeamAccountItem>): TeamAccountItem => ({
  coordinatorId: 7,
  name: 'Родионов Давид',
  teamRole: 'Распределитель',
  staffId: null,
  login: null,
  hasPassword: false,
  active: true,
  lastLoginAt: null,
  ...over,
});

const view = (team: TeamAccountItem[], enabled = true): SettingsStaffView => ({
  ...buildSettingsStaff(),
  personal: { ...buildSettingsStaff().personal, enabled },
  team,
});

function open(data: SettingsStaffView, generate: () => Response = () => json({ ok: true, login: 'd_rodionov', password: SAMPLE_ISSUED })) {
  const fetchMock = stubFetchWithFixtures({ 'settings/staff': () => json(data), 'settings/staff/generate-password': generate });
  renderAt(<UsersSection />, '/?tab=settings&sec=users', makeClient());
  return fetchMock;
}

const block = () => screen.findByRole('region', { name: 'Пароли для команды' });
const rowOf = async (name: string) => within(await block()).findByRole('row', { name: new RegExp(name) });

describe('«Пароли для команды»: список', () => {
  test('вся команда из справочника: имя, роль, логин, есть ли пароль и кнопка у каждого', async () => {
    open(view([member({}), member({ coordinatorId: 8, name: 'Клименко Марина', teamRole: 'Координатор', staffId: 3, login: 'm_klimenko', hasPassword: true })]));
    const david = await rowOf('Родионов Давид');
    expect(david).toHaveTextContent('Распределитель');
    expect(david).toHaveTextContent('появится с первым паролем');
    expect(david).toHaveTextContent('Пароля нет');
    expect(within(david).getByRole('button', { name: 'Сгенерировать пароль: Родионов Давид' })).toBeEnabled();
    const marina = await rowOf('Клименко Марина');
    expect(marina).toHaveTextContent('m_klimenko');
    expect(marina).toHaveTextContent('Пароль выдан');
    expect(within(marina).getByRole('button', { name: 'Новый пароль: Клименко Марина' })).toBeEnabled();
  });

  test('пока личные входы выключены, сказано, что пароли заработают после включения', async () => {
    open(view([member({})], false));
    expect(await block()).toHaveTextContent('Выданные пароли заработают, когда вы включите личные входы');
  });

  test('отключённому пользователю пароль не выдать: кнопка неактивна, рядом пояснение', async () => {
    open(view([member({ staffId: 3, login: 'd_rodionov', active: false })]));
    const row = await rowOf('Родионов Давид');
    expect(within(row).getByRole('button', { name: /Родионов Давид/ })).toBeDisabled();
    expect(row).toHaveTextContent('Вход отключён');
  });

  test('пустой справочник команды — подсказка, где его заполнить', async () => {
    open(view([]));
    expect(await block()).toHaveTextContent('В справочнике команды пока никого нет');
  });
});

describe('«Пароли для команды»: генерация', () => {
  test('новый пароль скрыт точками; «глазик» показывает и прячет его, «Скопировать» кладёт пароль в буфер', async () => {
    const fetchMock = open(view([member({})]));
    const user = userEvent.setup();
    const row = await rowOf('Родионов Давид');
    await user.click(within(row).getByRole('button', { name: 'Сгенерировать пароль: Родионов Давид' }));
    await waitFor(() => expect(posts(fetchMock)).toEqual([{ path: 'settings/staff/generate-password', body: { coordinatorId: 7 } }]));
    const fresh = await rowOf('Родионов Давид');
    const secret = within(fresh).getByTestId('team-password');
    expect(secret).toHaveTextContent('••••••••••••••');
    expect(fresh).not.toHaveTextContent(SAMPLE_ISSUED);
    expect(fresh).toHaveTextContent('d_rodionov');
    await user.click(within(fresh).getByRole('button', { name: 'Показать пароль: Родионов Давид' }));
    expect(secret).toHaveTextContent(SAMPLE_ISSUED);
    await user.click(within(fresh).getByRole('button', { name: 'Скрыть пароль: Родионов Давид' }));
    expect(secret).toHaveTextContent('••••••••••••••');
    await user.click(within(fresh).getByRole('button', { name: 'Скопировать пароль: Родионов Давид' }));
    // userEvent подменяет буфер обмена своим: читаем из него.
    expect(await navigator.clipboard.readText()).toBe(SAMPLE_ISSUED);
    expect(await within(fresh).findByText('Скопировано')).toBeInTheDocument();
  });

  test('новый пароль тому, у кого он уже есть, — только после подтверждения: старый перестанет работать', async () => {
    const fetchMock = open(view([member({ staffId: 3, login: 'd_rodionov', hasPassword: true })]));
    const user = userEvent.setup();
    const row = await rowOf('Родионов Давид');
    await user.click(within(row).getByRole('button', { name: 'Новый пароль: Родионов Давид' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новый пароль для Родионов Давид' });
    expect(dialog).toHaveTextContent('Прежний пароль перестанет работать');
    expect(posts(fetchMock)).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Сгенерировать' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(await within(await rowOf('Родионов Давид')).findByTestId('team-password')).toBeInTheDocument();
  });

  test('отказ сервера виден словами, пароля на экране нет', async () => {
    open(view([member({})]), () => json({ ok: false, error: 'bad_request', message: 'Не удалось подобрать логин: в справочнике у человека должны быть фамилия и имя.' }, 400));
    const user = userEvent.setup();
    const row = await rowOf('Родионов Давид');
    await user.click(within(row).getByRole('button', { name: 'Сгенерировать пароль: Родионов Давид' }));
    expect(await within(await block()).findByRole('alert')).toHaveTextContent('Не удалось подобрать логин');
    expect(within(await rowOf('Родионов Давид')).queryByTestId('team-password')).not.toBeInTheDocument();
  });
});

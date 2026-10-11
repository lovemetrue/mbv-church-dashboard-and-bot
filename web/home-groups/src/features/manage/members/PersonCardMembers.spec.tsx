import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../../app/App';
import { getsOf, json, posts } from '../../../test/calls';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../../test/render';

afterEach(() => vi.unstubAllGlobals());

const asAdmin = { me: () => json({ role: 'admin' }) };

async function personCard(key: string) {
  renderAt(<App />, `/?tab=reference&ent=people&rec=${key}`);
  return screen.findByRole('dialog', { name: /Карточка человека/ });
}

describe('карточка человека: группы', () => {
  test('«Состоит в группах»: каждый код — кнопка, которая открывает группу', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const card = await personCard('u1');
    expect(within(card).getByRole('heading', { name: 'Состоит в группах' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Открыть группу ДГ-0008' })).toBeInTheDocument();
    await user.click(await within(card).findByRole('button', { name: 'Открыть группу ДГ-0012' }));
    expect(currentSearch().get('rec')).toBe('1');
    expect(currentSearch().has('ent')).toBe(false);
    expect(await screen.findByRole('dialog', { name: /Карточка группы №12/ })).toBeInTheDocument();
  });

  test('если человек нигде не состоит, так и сказано', async () => {
    stubFetchWithFixtures();
    const card = await personCard('u3');
    expect(within(card).getByText('Пока не состоит ни в одной группе.')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /Открыть группу/ })).not.toBeInTheDocument();
  });
});

describe('карточка человека: правка и удаление карточки, внесённой вручную', () => {
  test.each([['u1'], ['r1']])('у %s правки нет, вместо неё подсказка, где менять данные', async (key) => {
    stubFetchWithFixtures();
    const card = await personCard(key);
    expect(within(card).getByText('Данные правятся в регистрации или в заявке.')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /Править карточку/ })).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /Удалить карточку/ })).not.toBeInTheDocument();
  });

  test('у карточки «Внесён вручную» есть «Править» и нет подсказки про регистрацию', async () => {
    stubFetchWithFixtures();
    const card = await personCard('p1');
    expect(within(card).getByRole('button', { name: 'Править карточку: Нина Воронцова' })).toBeInTheDocument();
    expect(within(card).queryByText('Данные правятся в регистрации или в заявке.')).not.toBeInTheDocument();
    expect(within(card).getByText('Внесён вручную')).toBeInTheDocument();
  });

  test('форма заполнена текущими значениями, а сохранить нечего, пока не изменили', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const card = await personCard('p1');
    await user.click(within(card).getByRole('button', { name: 'Править карточку: Нина Воронцова' }));
    const dialog = await screen.findByRole('dialog', { name: 'Правка карточки: Нина Воронцова' });
    expect(within(dialog).getByRole('textbox', { name: /^ФИО/ })).toHaveValue('Нина Воронцова');
    expect(within(dialog).getByRole('textbox', { name: 'Телефон' })).toHaveValue('+7 911 000 55 11');
    expect(within(dialog).getByRole('textbox', { name: 'Возраст' })).toHaveValue('46+');
    expect(within(dialog).getByRole('textbox', { name: 'Район или место' })).toHaveValue('Приморский');
    expect(within(dialog).getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });

  test('уходят только изменённые поля, а потом перечитываются группы и люди', async () => {
    const fetchMock = stubFetchWithFixtures({ 'persons/1/update': () => json({ ok: true }) });
    const user = userEvent.setup();
    const card = await personCard('p1');
    await waitFor(() => expect(getsOf(fetchMock, 'groups')).toBeGreaterThan(0));
    const before = { groups: getsOf(fetchMock, 'groups'), people: getsOf(fetchMock, 'people') };
    await user.click(within(card).getByRole('button', { name: 'Править карточку: Нина Воронцова' }));
    const dialog = await screen.findByRole('dialog', { name: /^Правка карточки/ });
    const phone = within(dialog).getByRole('textbox', { name: 'Телефон' });
    await user.clear(phone);
    await user.type(phone, '+7 911 000 55 99');
    await user.type(within(dialog).getByRole('textbox', { name: 'Заметка' }), 'Звонить после шести');
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(posts(fetchMock)).toEqual([{ path: 'persons/1/update', body: { fields: { phone: '+7 911 000 55 99', note: 'Звонить после шести' } } }]),
    );
    await waitFor(() => {
      expect(getsOf(fetchMock, 'groups')).toBeGreaterThan(before.groups);
      expect(getsOf(fetchMock, 'people')).toBeGreaterThan(before.people);
    });
    expect(screen.getByRole('dialog', { name: /Карточка человека/ })).toBeInTheDocument();
  });

  test('ФИО нельзя опустошить: «Сохранить» гаснет', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const card = await personCard('p1');
    await user.click(within(card).getByRole('button', { name: 'Править карточку: Нина Воронцова' }));
    const dialog = await screen.findByRole('dialog', { name: /^Правка карточки/ });
    await user.clear(within(dialog).getByRole('textbox', { name: /^ФИО/ }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Возраст' }), '7');
    expect(within(dialog).getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });

  test('«Удалить карточку» видит только полный вход', async () => {
    stubFetchWithFixtures(asAdmin);
    const card = await personCard('p1');
    await within(card).findByRole('button', { name: 'Править карточку: Нина Воронцова' });
    await waitFor(() => expect(screen.queryByRole('button', { name: /Удалить карточку/ })).not.toBeInTheDocument());
  });

  test('полный вход: подтверждение, пустое тело на persons/:id/delete и закрытие карточки', async () => {
    const fetchMock = stubFetchWithFixtures({ 'persons/1/delete': () => json({ ok: true }) });
    const user = userEvent.setup();
    const card = await personCard('p1');
    await user.click(await within(card).findByRole('button', { name: 'Удалить карточку: Нина Воронцова' }));
    const dialog = await screen.findByRole('dialog', { name: 'Удалить карточку: Нина Воронцова?' });
    expect(posts(fetchMock)).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Удалить' }));
    await waitFor(() => expect(posts(fetchMock)).toEqual([{ path: 'persons/1/delete', body: {} }]));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Карточка человека/ })).not.toBeInTheDocument());
  });

  test('«Удалить регистрацию» у карточки без регистрации не появляется', async () => {
    stubFetchWithFixtures();
    const card = await personCard('p1');
    await within(card).findByRole('button', { name: 'Удалить карточку: Нина Воронцова' });
    expect(within(card).queryByRole('button', { name: /Удалить регистрацию/ })).not.toBeInTheDocument();
  });
});

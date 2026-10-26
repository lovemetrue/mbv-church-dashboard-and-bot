import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../../app/App';
import { getsOf, json, posts } from '../../../test/calls';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../../test/render';
import { buildPeople } from '../../../fixtures/build';
import { groupsWith } from '../../requests/requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

const asAdmin = { me: () => json({ role: 'admin' }) };

async function personCard(key: string) {
  renderAt(<App />, `/?tab=reference&ent=people&rec=${key}`);
  return screen.findByRole('dialog', { name: /Карточка человека/ });
}

describe('карточка человека: группы', () => {
  test('«Группы»: где участник, каждый код — кнопка, которая открывает группу', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const card = await personCard('u1');
    expect(within(card).getByRole('heading', { name: 'Группы' })).toBeInTheDocument();
    expect(within(card).getByText('Участник')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Открыть группу ДГ-0008' })).toBeInTheDocument();
    await user.click(await within(card).findByRole('button', { name: 'Открыть группу ДГ-0012' }));
    expect(currentSearch().get('rec')).toBe('1');
    expect(currentSearch().has('ent')).toBe(false);
    expect(await screen.findByRole('dialog', { name: /Карточка группы ДГ-0012/ })).toBeInTheDocument();
  });

  test('видно, где человек ведущий: группа ссылается на него', async () => {
    stubFetchWithFixtures();
    // Михаил Громов (u2) — ведущий ДГ-0027 в демо-данных.
    const card = await personCard('u2');
    const row = within(card).getByText('Ведущий').parentElement!;
    expect(within(row).getByRole('button', { name: 'Открыть группу ДГ-0027' })).toBeInTheDocument();
  });

  test('если человек нигде не состоит и ничего не ведёт, так и сказано', async () => {
    stubFetchWithFixtures();
    const card = await personCard('u3');
    expect(within(card).getByText('Пока ни в одной группе.')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /Открыть группу/ })).not.toBeInTheDocument();
  });
});

describe('карточка человека: «Добавить в группу»', () => {
  async function openAdd(key: string) {
    const user = userEvent.setup();
    const card = await personCard(key);
    await user.click(within(card).getByRole('button', { name: /^Добавить в группу:/ }));
    const dialog = await screen.findByRole('dialog', { name: /^Добавить в группу:/ });
    return { user, dialog };
  }

  test('участником: уходит в состав группы по ключу человека', async () => {
    const fetchMock = stubFetchWithFixtures({ 'groups/3/members/create': () => json({ ok: true, id: 9, personKey: 'u3' }) });
    const { user, dialog } = await openAdd('u3');
    await user.type(within(dialog).getByRole('searchbox'), 'ДГ-0031');
    await user.click(within(within(dialog).getByRole('list', { name: 'Подходящие группы' })).getByRole('button', { name: /ДГ-0031/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(posts(fetchMock)).toEqual([{ path: 'groups/3/members/create', body: { personKey: 'u3' } }]));
    expect(await screen.findByText('Готово: участником в ДГ-0031.')).toBeInTheDocument();
  });

  test('ведущим: правка группы с leaderKey; если позиция занята — сказано, кто сейчас, и кнопка «Заменить и добавить»', async () => {
    const fetchMock = stubFetchWithFixtures({ 'groups/3/update': () => json({ ok: true }) });
    const { user, dialog } = await openAdd('u3');
    await user.click(within(dialog).getByRole('radio', { name: 'Ведущим' }));
    await user.type(within(dialog).getByRole('searchbox'), 'ДГ-0031');
    await user.click(within(within(dialog).getByRole('list', { name: 'Подходящие группы' })).getByRole('button', { name: /ДГ-0031/ }));
    // У ДГ-0031 ведущая Марина Л. записана только текстом — её место займёт выбранный человек.
    expect(dialog).toHaveTextContent('Сейчас ведущий этой группы — Марина Л.');
    await user.click(within(dialog).getByRole('button', { name: 'Заменить и добавить' }));
    await waitFor(() => expect(posts(fetchMock)).toEqual([{ path: 'groups/3/update', body: { fields: { leaderKey: 'u3' } } }]));
  });

  test('туда, где человек уже есть, добавить нельзя: отметка «уже здесь», кнопка выключена', async () => {
    const fetchMock = stubFetchWithFixtures();
    const { user, dialog } = await openAdd('u2');
    await user.click(within(dialog).getByRole('radio', { name: 'Ведущим' }));
    await user.type(within(dialog).getByRole('searchbox'), 'ДГ-0027');
    const option = within(within(dialog).getByRole('list', { name: 'Подходящие группы' })).getByRole('button', { name: /ДГ-0027/ });
    expect(option).toHaveTextContent('уже здесь');
    await user.click(option);
    expect(within(dialog).getByRole('button', { name: 'Добавить' })).toBeDisabled();
    expect(posts(fetchMock)).toHaveLength(0);
  });
});

describe('карточка человека: «Сменить» группу', () => {
  const pick = async (user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, q: string, code: RegExp) => {
    await user.type(within(dialog).getByRole('searchbox'), q);
    await user.click(within(within(dialog).getByRole('list', { name: 'Подходящие группы' })).getByRole('button', { name: code }));
  };

  test('участник, внесённый вручную: встаёт в новую группу (поиск по номеру), из прежней строка состава убирается', async () => {
    const fetchMock = stubFetchWithFixtures({
      'groups/3/members/create': () => json({ ok: true, id: 99, personKey: 'u1' }),
      'members/1/delete': () => json({ ok: true }),
    });
    const user = userEvent.setup();
    // Дарья Ефимова (u1) внесена вручную в ДГ-0012 (строка состава 1).
    const card = await personCard('u1');
    await user.click(within(card).getByRole('button', { name: 'Сменить группу ДГ-0012' }));
    const dialog = await screen.findByRole('dialog', { name: 'Сменить группу: Дарья Ефимова' });
    expect(dialog).toHaveTextContent('Сейчас: участник в ДГ-0012');
    expect(within(dialog).queryByRole('radio')).not.toBeInTheDocument();
    await pick(user, dialog, '31', /ДГ-0031/);
    await user.click(within(dialog).getByRole('button', { name: 'Перевести' }));
    await waitFor(() =>
      expect(posts(fetchMock)).toEqual([
        { path: 'groups/3/members/create', body: { personKey: 'u1' } },
        { path: 'members/1/delete', body: {} },
      ]),
    );
    expect(await screen.findByText('Готово: перевели из ДГ-0012 в ДГ-0031 (участник).')).toBeInTheDocument();
  });

  test('соведущий: ставится соведущим в новую группу и отвязывается от прежней', async () => {
    const fetchMock = stubFetchWithFixtures({
      groups: () => json(groupsWith(1, { coLeader: 'Нина Воронцова', coLeaderKey: 'p1' })),
      // Сервер отдаёт и обратную сторону ссылки: в «Людях» у Нины Воронцовой соведущая ДГ-0012.
      people: () => {
        const view = buildPeople();
        return json({ ...view, items: view.items.map((x) => (x.key === 'p1' ? { ...x, leads: [{ groupId: 1, code: 'ДГ-0012', role: 'coLeader' as const }] } : x)) });
      },
      'groups/3/update': () => json({ ok: true }),
      'groups/1/update': () => json({ ok: true }),
    });
    const user = userEvent.setup();
    const card = await personCard('p1');
    const row = within(card).getByText('Соведущий').parentElement!;
    await user.click(within(row).getByRole('button', { name: 'Сменить группу ДГ-0012' }));
    const dialog = await screen.findByRole('dialog', { name: /^Сменить группу:/ });
    await pick(user, dialog, 'ДГ-0031', /ДГ-0031/);
    await user.click(within(dialog).getByRole('button', { name: 'Перевести' }));
    await waitFor(() =>
      expect(posts(fetchMock)).toEqual([
        { path: 'groups/3/update', body: { fields: { coLeaderKey: 'p1' } } },
        { path: 'groups/1/update', body: { fields: { coLeaderKey: '' } } },
      ]),
    );
  });

  test('направленного через сервис меняют в заявке: кнопка ведёт в неё', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    // Артём Лебедев (r10) утверждён в ДГ-0012 заявкой №10.
    const card = await personCard('r10');
    await user.click(within(card).getByRole('button', { name: 'Сменить группу ДГ-0012 через заявку' }));
    await waitFor(() => expect(currentSearch().get('req')).toBe('10'));
  });

  test('ведущего не переводят: у группы должен остаться ведущий — так и сказано', async () => {
    stubFetchWithFixtures();
    const card = await personCard('u2');
    const row = within(card).getByText('Ведущий').parentElement!;
    expect(within(row).queryByRole('button', { name: /^Сменить группу/ })).not.toBeInTheDocument();
    expect(row).toHaveTextContent('Ведущего группы не переводят');
  });
});

describe('карточка человека: значки в шапке', () => {
  test('карандаш, звонок, письмо и копирование номера — в шапке, отдельной кнопки «Править» внизу нет', async () => {
    stubFetchWithFixtures();
    const card = await personCard('u1');
    const header = within(card).getByRole('banner');
    expect(within(header).getByRole('button', { name: 'Править карточку: Дарья Ефимова' })).toBeInTheDocument();
    expect(within(header).getByRole('link', { name: /^Позвонить/ })).toBeInTheDocument();
    expect(within(card).getAllByRole('button', { name: /Править карточку/ })).toHaveLength(1);
  });
});

describe('карточка человека: правка и удаление карточки, внесённой вручную', () => {
  test.each([['u1'], ['r1']])('у %s есть «Править», но нет «Удалить»: регистрацию и заявку не стирают', async (key) => {
    stubFetchWithFixtures();
    const card = await personCard(key);
    expect(await within(card).findByRole('button', { name: /Править карточку/ })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /Удалить карточку/ })).not.toBeInTheDocument();
  });

  test('регистрация: в форме те же поля, что у заявки, на сервер уходит только изменённое', async () => {
    const fetchMock = stubFetchWithFixtures({ 'people/u1/update': () => json({ ok: true }) });
    const user = userEvent.setup();
    const card = await personCard('u1');
    await user.click(await within(card).findByRole('button', { name: 'Править карточку: Дарья Ефимова' }));
    const dialog = await screen.findByRole('dialog', { name: /^Правка карточки/ });
    expect(within(dialog).queryByRole('textbox', { name: 'Заметка' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Комментарий' })).toBeInTheDocument();
    expect(within(dialog).getByText(/сохранятся и в регистрации, и во всех заявках/)).toBeInTheDocument();
    await user.type(within(dialog).getByRole('textbox', { name: 'Улица и дом' }), 'Коллонтай 5');
    await user.type(within(dialog).getByRole('textbox', { name: 'Удобные день и время' }), 'среда вечером');
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() =>
      expect(posts(fetchMock)).toEqual([{ path: 'people/u1/update', body: { fields: { address: 'Коллонтай 5', schedule: 'среда вечером' } } }]),
    );
  });

  test('после правки человека перечитываются и заявки', async () => {
    const fetchMock = stubFetchWithFixtures({ 'people/r1/update': () => json({ ok: true }) });
    const user = userEvent.setup();
    const card = await personCard('r1');
    await user.click(await within(card).findByRole('button', { name: /Править карточку/ }));
    const dialog = await screen.findByRole('dialog', { name: /^Правка карточки/ });
    const before = getsOf(fetchMock, 'requests');
    await user.type(within(dialog).getByRole('textbox', { name: 'Возраст' }), '7');
    await user.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(getsOf(fetchMock, 'requests')).toBeGreaterThan(before));
  });

  test('у карточки «Внесён вручную» есть «Править» и тот же набор полей, что у заявки и регистрации', async () => {
    stubFetchWithFixtures();
    const card = await personCard('p1');
    expect(within(card).getByRole('button', { name: 'Править карточку: Нина Воронцова' })).toBeInTheDocument();
    expect(within(card).getByText('Внесён вручную')).toBeInTheDocument();
  });

  test.each([['u1'], ['r1'], ['p1']])('форма человека %s: те же десять полей в том же порядке, что в заявке', async (key) => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const card = await personCard(key);
    await user.click(await within(card).findByRole('button', { name: /Править карточку/ }));
    const dialog = await screen.findByRole('dialog', { name: /^Правка карточки/ });
    const names = within(dialog).getAllByRole('textbox').map((e) => document.querySelector(`label[for="${e.id}"]`)?.textContent?.replace(/\s*\*$/, ''));
    expect(names).toEqual(['ФИО', 'Телефон', 'Возраст', 'Район, метро, ориентир', 'Улица и дом', 'Удобные день и время', 'Хобби', 'Профессия', 'Семейное положение', 'Комментарий']);
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
    expect(within(dialog).getByRole('textbox', { name: 'Район, метро, ориентир' })).toHaveValue('Приморский');
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
    await user.type(within(dialog).getByRole('textbox', { name: 'Комментарий' }), 'Звонить после шести');
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

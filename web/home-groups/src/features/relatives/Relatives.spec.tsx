import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Me, PeopleView, PersonItem } from '@contracts';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildPeople } from '../../fixtures/build';
import { json, posts } from '../../test/calls';
import { renderAt, stubFetchWithFixtures } from '../../test/render';
import { openCard, viewWith } from '../requests/requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

const ok = () => json({ ok: true });
const READER: Me = { role: 'readonly', person: { login: 'chitatel', name: 'Читатель', teamRole: null, teamKinds: [] } } as Me;

/** «Люди» из фикстур, у кого-то из них — свои родственники и подсказки. */
function peopleWith(patch: Record<string, Partial<PersonItem>>): PeopleView {
  const view = buildPeople();
  return { ...view, items: view.items.map((p) => (patch[p.key] ? { ...p, ...patch[p.key] } : p)) };
}

async function personCard(key: string) {
  renderAt(<App />, `/?tab=reference&ent=people&rec=${key}`);
  return screen.findByRole('dialog', { name: /Карточка человека/ });
}

describe('родственники в карточке человека', () => {
  test('список: кем приходится и ссылка на карточку; пусто — «не указаны»', async () => {
    stubFetchWithFixtures({
      people: () => json(peopleWith({ u1: { relatives: [{ id: 3, key: 'u2', fio: 'Михаил Громов', kind: 'spouse' }] } })),
    });
    const user = userEvent.setup();
    const card = await personCard('u1');
    const section = within(card).getByRole('list', { name: 'Родственники' });
    expect(within(section).getByText('Михаил Громов')).toBeInTheDocument();
    expect(within(section).getByText('супруг(а)')).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'Открыть карточку: Михаил Громов' }));
    expect(await screen.findByRole('dialog', { name: 'Карточка человека: Михаил Громов' })).toBeInTheDocument();
  });

  test('«+ добавить»: поиск человека, степень родства, «Связать» уходит с ключами обоих', async () => {
    const fetchMock = stubFetchWithFixtures({ 'people/relatives': ok });
    const user = userEvent.setup();
    const card = await personCard('u1');
    expect(within(card).getByText('Родственники не указаны.')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: '+ добавить' }));
    const save = within(card).getByRole('button', { name: 'Связать' });
    expect(save).toBeDisabled();
    await user.type(within(card).getByRole('searchbox', { name: 'Родственник' }), 'Громов');
    await user.click(await within(card).findByRole('button', { name: /Михаил Громов/ }));
    await user.selectOptions(within(card).getByRole('combobox', { name: 'Кем приходится' }), 'child');
    await user.click(save);
    await waitFor(() => expect(posts(fetchMock).some((c) => c.path === 'people/relatives')).toBe(true));
    expect(posts(fetchMock).find((c) => c.path === 'people/relatives')!.body).toEqual({ key: 'u1', otherKey: 'u2', kind: 'child' });
  });

  test('подсказка «возможно, родственник»: видно совпадение, «Связать» открывает форму с этим человеком', async () => {
    const fetchMock = stubFetchWithFixtures({
      people: () => json(peopleWith({ u1: { relativeHints: [{ key: 'p1', fio: 'Нина Воронцова', samePhone: '+7 911 000-40-02', sameAddress: null }] } })),
      'people/relatives': ok,
    });
    const user = userEvent.setup();
    const card = await personCard('u1');
    const hints = within(card).getByRole('group', { name: 'Возможно, родственники' });
    expect(within(hints).getByText('тот же телефон +7 911 000-40-02')).toBeInTheDocument();
    await user.click(within(hints).getByRole('button', { name: 'Связать с Нина Воронцова' }));
    expect(within(card).getByText('Выбран: Нина Воронцова')).toBeInTheDocument();
    await user.selectOptions(within(card).getByRole('combobox', { name: 'Кем приходится' }), 'parent');
    await user.click(within(card).getByRole('button', { name: 'Связать' }));
    await waitFor(() => expect(posts(fetchMock).find((c) => c.path === 'people/relatives')?.body).toEqual({ key: 'u1', otherKey: 'p1', kind: 'parent' }));
  });

  test('«Убрать связь» уходит номером связи; повторная связь пары — понятная ошибка', async () => {
    const fetchMock = stubFetchWithFixtures({
      people: () => json(peopleWith({ u1: { relatives: [{ id: 3, key: 'u2', fio: 'Михаил Громов', kind: 'spouse' }] } })),
      'people/relatives/delete': ok,
    });
    const user = userEvent.setup();
    const card = await personCard('u1');
    await user.click(within(card).getByRole('button', { name: 'Убрать связь с Михаил Громов' }));
    await waitFor(() => expect(posts(fetchMock).find((c) => c.path === 'people/relatives/delete')?.body).toEqual({ id: 3 }));
  });

  test('вход «Только чтение» видит родственников без кнопок и без подсказок', async () => {
    stubFetchWithFixtures({
      me: () => json(READER),
      people: () => json(peopleWith({
        u1: {
          relatives: [{ id: 3, key: 'u2', fio: 'Михаил Громов', kind: 'spouse' }],
          relativeHints: [{ key: 'p1', fio: 'Нина Воронцова', samePhone: '+7 911 000-40-02', sameAddress: null }],
        },
      })),
    });
    const card = await personCard('u1');
    await waitFor(() => expect(within(card).queryByRole('button', { name: '+ добавить' })).not.toBeInTheDocument());
    expect(within(card).getByText('Михаил Громов')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /Убрать связь/ })).not.toBeInTheDocument();
    expect(within(card).queryByRole('group', { name: 'Возможно, родственники' })).not.toBeInTheDocument();
  });
});

describe('семейное положение в карточке человека', () => {
  test('вариант по полу и рядом — как написал человек', async () => {
    stubFetchWithFixtures({
      people: () => json(peopleWith({ u1: { gender: { value: 'ж', by: 'fio' }, familyKind: 'married', family: 'замужем, двое детей' } })),
    });
    const card = await personCard('u1');
    expect(within(card).getByText('Замужем')).toBeInTheDocument();
    expect(within(card).getByText(/как написано: «замужем, двое детей»/)).toBeInTheDocument();
  });
});

describe('родственники в карточке заявки', () => {
  test('короткий список со ссылкой на карточку; нет родственников — блока нет', async () => {
    stubFetchWithFixtures({
      requests: () => json(viewWith(5, { relatives: [{ id: 9, key: 'u2', fio: 'Михаил Громов', kind: 'sibling' }] })),
    });
    const card = await openCard(5);
    const block = await within(card).findByRole('list', { name: 'Родственники человека' });
    expect(within(block).getByText('брат / сестра')).toBeInTheDocument();
    expect(within(block).getByRole('button', { name: 'Открыть карточку: Михаил Громов' })).toBeInTheDocument();
  });

  test('без родственников блока нет', async () => {
    stubFetchWithFixtures();
    const card = await openCard(5);
    await within(card).findByRole('heading', { name: 'Работа с заявкой' });
    expect(within(card).queryByRole('list', { name: 'Родственники человека' })).not.toBeInTheDocument();
  });
});

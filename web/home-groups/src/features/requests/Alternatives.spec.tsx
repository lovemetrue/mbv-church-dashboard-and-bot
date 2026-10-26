import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { buildGroups } from '../../fixtures/build';
import { stubFetchWithFixtures } from '../../test/render';
import { fail, fixtureItem, getsOf, groupsWith, json, ok, openCard, posts, viewWith } from './requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

/** Заявка 1: главная ДГ-0012, запасная ДГ-0019 (id 8, ведущий Дмитрий В.). */
const ALT = { id: 8, code: 'ДГ-0019', leader: 'Дмитрий В.' };

/** Заявка 1, у которой запасной вариант заменён на группу с нужными признаками. */
function withAlternative(patch: Record<string, unknown>) {
  const base = fixtureItem(1);
  const alt = base.proposal!.alternatives[0]!;
  return viewWith(1, {
    proposal: { ...base.proposal!, alternatives: [{ ...alt, group: { ...alt.group, ...patch } }] },
  });
}

describe('«Заявки»: запасные варианты можно утвердить', () => {
  test('у запасного варианта есть «Утвердить эту группу»: после подтверждения уходит approve с id именно этой группы', async () => {
    let approved = false;
    const fetchMock = stubFetchWithFixtures({
      'requests/1/approve': () => {
        approved = true;
        return ok();
      },
      requests: () =>
        json(approved ? viewWith(1, { bucket: 'done', proposal: null, finalGroup: fixtureItem(1).proposal!.alternatives[0]!.group }) : viewWith(1, {})),
    });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: `Утвердить эту группу ${ALT.code}` }));

    const confirm = await screen.findByRole('dialog', { name: 'Утвердить в эту группу?' });
    expect(within(confirm).getByText(`Утвердить Мария Соколова в группу ${ALT.code}, ${ALT.leader}?`)).toBeInTheDocument();
    // пока человек не подтвердил, ничего не отправлено
    expect(posts(fetchMock)).toHaveLength(0);

    await user.click(within(confirm).getByRole('button', { name: 'Да, утвердить' }));
    expect(await within(card).findByText(`Утверждено: ${ALT.code}`)).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(1);
    expect(posts(fetchMock)[0]).toMatchObject({ path: 'requests/1/approve', body: { groupId: ALT.id } });
    expect(screen.queryByRole('dialog', { name: 'Утвердить в эту группу?' })).not.toBeInTheDocument();
    await waitFor(() => expect(getsOf(fetchMock, 'requests')).toBe(2));
  });

  test('у запасного варианта — уверенность в той же шкале, что у главной группы, а не «совпадение»', async () => {
    stubFetchWithFixtures({ requests: () => json(withAlternative({})) });
    const card = await openCard(1);
    const alt = within(card).getByRole('button', { name: `Утвердить эту группу ${ALT.code}` }).closest('article')!;
    const { confidence } = fixtureItem(1).proposal!.alternatives[0]!;
    expect(confidence).not.toBeNull();
    expect(alt).toHaveTextContent(`${confidence}уверенность`);
    expect(alt).not.toHaveTextContent('совпадение');
  });

  test('отказ в подтверждении ничего не отправляет', async () => {
    const fetchMock = stubFetchWithFixtures();
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: `Утвердить эту группу ${ALT.code}` }));
    const confirm = await screen.findByRole('dialog', { name: 'Утвердить в эту группу?' });
    await user.click(within(confirm).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog', { name: 'Утвердить в эту группу?' })).not.toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  test('главная кнопка «Утвердить» у предложения остаётся и утверждает сразу, без вопроса', async () => {
    const main = fixtureItem(1).proposal!.main.group;
    const fetchMock = stubFetchWithFixtures({ 'requests/1/approve': ok });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: `Утвердить в группу ${main.code}` }));
    await within(card).findByText(`Утверждено: ${main.code}`);
    expect(posts(fetchMock)[0]!.body).toEqual({ groupId: main.id });
  });

  test('у группы с отметкой «Не направлять» кнопка отключена, и причина сказана словами', async () => {
    stubFetchWithFixtures({ requests: () => json(withAlternative({ id: 12, code: 'ДГ-0112' })) });
    const card = await openCard(1);
    const btn = await within(card).findByRole('button', { name: 'Утвердить эту группу ДГ-0112' });
    await waitFor(() => expect(btn).toBeDisabled());
    expect(btn).toHaveAccessibleDescription(/не направляют/);
    expect(within(card).getByText(/В эту группу сейчас не направляют/)).toBeInTheDocument();
  });

  test('у закрытой для приёма группы кнопка отключена с причиной', async () => {
    stubFetchWithFixtures({ requests: () => json(withAlternative({ id: 10, code: 'ДГ-0003' })) });
    const card = await openCard(1);
    const btn = await within(card).findByRole('button', { name: 'Утвердить эту группу ДГ-0003' });
    await waitFor(() => expect(btn).toBeDisabled());
    expect(within(card).getByText('Группа закрыта для приёма.')).toBeInTheDocument();
  });

  test('у группы без свободных мест кнопка отключена с причиной', async () => {
    stubFetchWithFixtures({ requests: () => json(withAlternative({ free: 0 })) });
    const card = await openCard(1);
    const btn = await within(card).findByRole('button', { name: `Утвердить эту группу ${ALT.code}` });
    expect(btn).toBeDisabled();
    expect(within(card).getByText('В группе нет свободных мест.')).toBeInTheDocument();
  });

  test('«group_full» на запасном варианте спрашивает подтверждение и повторяет запрос с force', async () => {
    let calls = 0;
    const fetchMock = stubFetchWithFixtures({
      'requests/1/approve': () => (++calls === 1 ? json({ error: 'group_full', message: 'мест нет' }, 409) : ok()),
    });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: `Утвердить эту группу ${ALT.code}` }));
    const confirm = await screen.findByRole('dialog', { name: 'Утвердить в эту группу?' });
    await user.click(within(confirm).getByRole('button', { name: 'Да, утвердить' }));

    const full = await screen.findByRole('dialog', { name: 'Нет мест в группе' });
    expect(within(full).getByText('В группе нет мест. Утвердить всё равно?')).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(1);
    await user.click(within(full).getByRole('button', { name: 'Утвердить всё равно' }));
    await within(card).findByText(`Утверждено: ${ALT.code}`);
    expect(posts(fetchMock).map((p) => p.body)).toEqual([{ groupId: ALT.id }, { groupId: ALT.id, force: true }]);
  });

  test('другая ошибка при утверждении запасного варианта показывается в окне подтверждения', async () => {
    stubFetchWithFixtures({ 'requests/1/approve': fail(409, 'group_unavailable') });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: `Утвердить эту группу ${ALT.code}` }));
    const confirm = await screen.findByRole('dialog', { name: 'Утвердить в эту группу?' });
    await user.click(within(confirm).getByRole('button', { name: 'Да, утвердить' }));
    expect(await within(confirm).findByRole('alert')).toHaveTextContent('Группа сейчас не принимает людей');
  });

  test('группа, место в которой отдано другим, тоже есть среди вариантов и её можно утвердить', async () => {
    const displaced = fixtureItem(17).proposal!.displaced!;
    const fetchMock = stubFetchWithFixtures({ 'requests/17/approve': ok });
    const user = userEvent.setup();
    const card = await openCard(17);
    const variants = within(card).getByRole('heading', { name: 'Другие варианты' }).parentElement!;
    expect(within(variants).getByText(/Место отдано другой заявке: Руслан Агеев/)).toBeInTheDocument();
    await user.click(within(variants).getByRole('button', { name: `Утвердить эту группу ${displaced.group.code}` }));
    const confirm = await screen.findByRole('dialog', { name: 'Утвердить в эту группу?' });
    await user.click(within(confirm).getByRole('button', { name: 'Да, утвердить' }));
    await within(card).findByText(`Утверждено: ${displaced.group.code}`);
    expect(posts(fetchMock)[0]).toMatchObject({ path: 'requests/17/approve', body: { groupId: displaced.group.id } });
  });

  test('у новой группы в вариантах стоит значок «Новая группа», у остальных его нет', async () => {
    stubFetchWithFixtures({ requests: () => json(withAlternative({ isNew: true })) });
    const card = await openCard(1);
    const variants = (await within(card).findByRole('heading', { name: 'Другие варианты' })).parentElement!;
    expect(within(variants).getByRole('img', { name: 'Новая группа' })).toBeInTheDocument();
  });
});

describe('«Заявки»: окно «Другая группа», явная кнопка у каждой строки', () => {
  test('«Выбрать и утвердить» у строки сразу утверждает именно эту группу', async () => {
    const fetchMock = stubFetchWithFixtures({ 'requests/1/approve': ok });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: 'Выбрать другую группу из списка' }));
    const picker = await screen.findByRole('dialog', { name: 'Другая группа' });
    await user.click(await within(picker).findByRole('button', { name: 'Выбрать и утвердить ДГ-0035' }));
    await within(card).findByText('Утверждено: ДГ-0035');
    expect(posts(fetchMock)).toHaveLength(1);
    expect(posts(fetchMock)[0]).toMatchObject({ path: 'requests/1/approve', body: { groupId: 9 } });
  });

  test('у группы «Не направлять» кнопка в строке отключена', async () => {
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: 'Выбрать другую группу из списка' }));
    const picker = await screen.findByRole('dialog', { name: 'Другая группа' });
    expect(await within(picker).findByRole('button', { name: 'Выбрать и утвердить ДГ-0112' })).toBeDisabled();
  });

  test('«group_full» после кнопки в строке спрашивает подтверждение', async () => {
    let calls = 0;
    const fetchMock = stubFetchWithFixtures({
      'requests/1/approve': () => (++calls === 1 ? json({ error: 'group_full', message: 'мест нет' }, 409) : ok()),
    });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: 'Выбрать другую группу из списка' }));
    const picker = await screen.findByRole('dialog', { name: 'Другая группа' });
    await user.click(await within(picker).findByRole('button', { name: 'Выбрать и утвердить ДГ-0019' }));
    const full = await screen.findByRole('dialog', { name: 'Нет мест в группе' });
    await user.click(within(full).getByRole('button', { name: 'Утвердить всё равно' }));
    await within(card).findByText('Утверждено: ДГ-0019');
    expect(posts(fetchMock).map((p) => p.body)).toEqual([{ groupId: 8 }, { groupId: 8, force: true }]);
  });

  test('старый путь работает: отметить строку и нажать «Утвердить» внизу окна', async () => {
    const fetchMock = stubFetchWithFixtures({ 'requests/1/approve': ok });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: 'Выбрать другую группу из списка' }));
    const picker = await screen.findByRole('dialog', { name: 'Другая группа' });
    await user.click(await within(picker).findByRole('radio', { name: /ДГ-0035/ }));
    await user.click(within(picker).getByRole('button', { name: 'Утвердить в ДГ-0035' }));
    await within(card).findByText('Утверждено: ДГ-0035');
    expect(posts(fetchMock)[0]!.body).toEqual({ groupId: 9 });
  });

  test('у новой группы в списке выбора стоит значок «Новая группа»', async () => {
    // В реестре новой помечена только группа 9: остальные явно «не новые», как бы ни менялись фикстуры.
    const view = buildGroups();
    stubFetchWithFixtures({
      groups: () => json({ ...view, items: view.items.map((g) => ({ ...g, isNew: g.id === 9 })) }),
    });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: 'Выбрать другую группу из списка' }));
    const picker = await screen.findByRole('dialog', { name: 'Другая группа' });
    const radio = await within(picker).findByRole('radio', { name: /ДГ-0035/ });
    expect(within(radio.closest('li')!).getByRole('img', { name: 'Новая группа' })).toBeInTheDocument();
    // у остальных групп из реестра значка нет
    const other = await within(picker).findByRole('radio', { name: /ДГ-0015/ });
    expect(within(other.closest('li')!).queryByRole('img', { name: 'Новая группа' })).not.toBeInTheDocument();
  });
});

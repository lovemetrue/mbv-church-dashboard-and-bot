import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { StrangeMark } from '@contracts';
import { App } from '../../app/App';
import { buildRequests } from '../../fixtures/build';
import { resetDemoStrange } from '../../fixtures/strange';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../test/render';
import { fixtureItem, json, ok, openCard, posts, viewWith } from './requestsTestKit';

afterEach(() => {
  vi.unstubAllGlobals();
  resetDemoStrange();
});

const MARK: StrangeMark = { by: 'Анна', at: '2026-10-09T12:00:00.000Z', note: 'Говорит о слежке.' };
const MARK_TEXT = 'Странный человек. Отметка: Анна, 09.10.2026. Говорит о слежке.';
const REASON = 'Отмечен как «странный человек»: нужна отдельная группа, подберите её вручную';

/** Заявка 1 («Мария Соколова», готова к утверждению), которой сервер поставил метку: бывает и с предложением в устаревшем кэше. */
const markedView = (patch = {}) => viewWith(1, { strange: MARK, ...patch });
/** То, что присылает сервер: метка, корзина «Нужна помощь», причина «странный» и нет предложения. */
const heldPatch = { bucket: 'human' as const, proposal: null, noPlan: { code: 'strange' as const, reason: REASON } };

const list = () => screen.getByRole('list', { name: 'Список заявок' });
const rowOf = (name: string) => within(list()).getByRole('button', { name }).closest('li')!;

describe('Заявки: красный значок «!» в списке', () => {
  test('значок стоит только у отмеченных людей и называет метку словами', async () => {
    stubFetchWithFixtures({ requests: () => json(markedView(heldPatch)) });
    renderAt(<App />, '/?tab=requests');
    await screen.findByRole('list', { name: 'Список заявок' });
    expect(within(rowOf('Мария Соколова')).getByRole('img', { name: MARK_TEXT })).toBeInTheDocument();
    // у строки есть и другие картинки (квадратики данных), поэтому ищем именно значок метки
    expect(within(rowOf('Алексей Орлов')).queryByRole('img', { name: /^Странный человек/ })).not.toBeInTheDocument();
  });

  test('подсказка со строкой «Отметка: кто, когда» появляется при наведении', async () => {
    stubFetchWithFixtures({ requests: () => json(markedView(heldPatch)) });
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests');
    await screen.findByRole('list', { name: 'Список заявок' });
    await user.hover(within(rowOf('Мария Соколова')).getByRole('img', { name: /Странный человек/ }));
    expect(screen.getByRole('tooltip')).toHaveTextContent(MARK_TEXT);
  });

  test('в демо-данных отмечены две заявки, и значков в списке ровно два', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests');
    await screen.findByRole('list', { name: 'Список заявок' });
    const marked = buildRequests().items.filter((r) => r.strange);
    expect(marked).toHaveLength(2);
    expect(within(list()).getAllByRole('img', { name: /^Странный человек/ })).toHaveLength(2);
  });

  test('вместо предложения группы в строке стоит причина сервера', async () => {
    stubFetchWithFixtures({ requests: () => json(markedView(heldPatch)) });
    renderAt(<App />, '/?tab=requests');
    await screen.findByRole('list', { name: 'Список заявок' });
    expect(within(rowOf('Мария Соколова')).getByText(REASON)).toBeInTheDocument();
  });

  test('если вместе с причиной «странный» пришло и предложение, группа в строке не показывается', async () => {
    const withProposal = fixtureItem(1).proposal!;
    stubFetchWithFixtures({
      requests: () => json(markedView({ bucket: 'human', noPlan: heldPatch.noPlan })),
    });
    renderAt(<App />, '/?tab=requests');
    await screen.findByRole('list', { name: 'Список заявок' });
    expect(within(rowOf('Мария Соколова')).queryByText(new RegExp(withProposal.main.group.leader))).not.toBeInTheDocument();
    expect(within(rowOf('Мария Соколова')).getByText(REASON)).toBeInTheDocument();
  });
});

describe('Заявки: карточка отмеченного человека', () => {
  test('в шапке карточки стоит значок', async () => {
    stubFetchWithFixtures({ requests: () => json(markedView(heldPatch)) });
    const card = await openCard(1);
    const heading = within(card).getByRole('heading', { level: 2 });
    expect(within(heading).getByRole('img', { name: MARK_TEXT })).toBeInTheDocument();
  });

  test('сверху красная плашка: кто поставил, когда и что заметили', async () => {
    stubFetchWithFixtures({ requests: () => json(markedView(heldPatch)) });
    const card = await openCard(1);
    const banner = within(card).getByRole('note', { name: 'Странный человек' });
    expect(banner).toHaveTextContent('Отметка: Анна, 09.10.2026.');
    expect(banner).toHaveTextContent('Говорит о слежке.');
  });

  test('без метки в карточке нет ни значка, ни плашки', async () => {
    stubFetchWithFixtures();
    const card = await openCard(2);
    expect(within(card).queryByRole('note', { name: 'Странный человек' })).not.toBeInTheDocument();
    expect(within(within(card).getByRole('heading', { level: 2 })).queryByRole('img')).not.toBeInTheDocument();
  });

  test('вместо «Предложения группы» показана причина сервера, а кнопки «Утвердить» нет', async () => {
    stubFetchWithFixtures({ requests: () => json(markedView(heldPatch)) });
    const card = await openCard(1);
    expect(within(card).getByText(REASON, { exact: false })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /Утвердить в группу|Всё равно утвердить/ })).not.toBeInTheDocument();
    expect(within(card).queryByText('Другие варианты')).not.toBeInTheDocument();
  });

  test('«Другая группа» остаётся: вручную подобрать отдельную группу можно', async () => {
    stubFetchWithFixtures({ requests: () => json(markedView(heldPatch)) });
    const card = await openCard(1);
    expect(within(card).getByRole('button', { name: 'Выбрать другую группу из списка' })).toBeEnabled();
  });

  test('даже если вместе с причиной «странный» пришло предложение, его группа не предлагается', async () => {
    const group = fixtureItem(1).proposal!.main.group;
    stubFetchWithFixtures({ requests: () => json(markedView({ bucket: 'human', noPlan: heldPatch.noPlan })) });
    const card = await openCard(1);
    expect(within(card).queryByRole('button', { name: new RegExp(`утвердить в группу ${group.code}`, 'i') })).not.toBeInTheDocument();
    expect(within(card).queryByText('Другие варианты')).not.toBeInTheDocument();
    expect(within(card).getByText(REASON, { exact: false })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Выбрать другую группу из списка' })).toBeInTheDocument();
  });
});

describe('Заявки: подтверждение при утверждении «странного человека»', () => {
  async function chooseOtherGroup(user: ReturnType<typeof userEvent.setup>, card: HTMLElement) {
    await user.click(within(card).getByRole('button', { name: 'Выбрать другую группу из списка' }));
    const picker = await screen.findByRole('dialog', { name: 'Другая группа' });
    const choose = (await within(picker).findAllByRole('button', { name: /^Выбрать и утвердить/ })).find((b) => !(b as HTMLButtonElement).disabled)!;
    await user.click(choose);
    return choose.getAttribute('aria-label')!.replace('Выбрать и утвердить ', '');
  }

  test('перед утверждением в любую группу спрашиваем ещё раз, и без ответа запроса нет', async () => {
    const fetchMock = stubFetchWithFixtures({ requests: () => json(markedView(heldPatch)), 'requests/1/approve': ok });
    const user = userEvent.setup();
    const card = await openCard(1);
    await chooseOtherGroup(user, card);
    const dialog = await screen.findByRole('dialog', { name: 'Странный человек' });
    expect(dialog).toHaveTextContent('Человек отмечен как «странный»: для него нужна отдельная группа. Всё равно направить в эту группу?');
    expect(posts(fetchMock)).toHaveLength(0);
  });

  test('«Отмена» закрывает вопрос и ничего не отправляет', async () => {
    const fetchMock = stubFetchWithFixtures({ requests: () => json(markedView(heldPatch)), 'requests/1/approve': ok });
    const user = userEvent.setup();
    const card = await openCard(1);
    await chooseOtherGroup(user, card);
    const dialog = await screen.findByRole('dialog', { name: 'Странный человек' });
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Странный человек' })).not.toBeInTheDocument());
    expect(posts(fetchMock)).toHaveLength(0);
  });

  test('«Да, направить» утверждает в выбранную группу', async () => {
    const fetchMock = stubFetchWithFixtures({ requests: () => json(markedView(heldPatch)), 'requests/1/approve': ok });
    const user = userEvent.setup();
    const card = await openCard(1);
    const code = await chooseOtherGroup(user, card);
    const dialog = await screen.findByRole('dialog', { name: 'Странный человек' });
    expect(dialog).toHaveTextContent(code);
    await user.click(within(dialog).getByRole('button', { name: 'Да, направить' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]).toMatchObject({ path: 'requests/1/approve' });
    expect(posts(fetchMock)[0]!.body).toHaveProperty('groupId');
  });

  test('у человека без метки вопроса нет: заявка утверждается сразу', async () => {
    const fetchMock = stubFetchWithFixtures({ 'requests/1/approve': ok });
    const user = userEvent.setup();
    const card = await openCard(1);
    const group = fixtureItem(1).proposal!.main.group;
    await user.click(within(card).getByRole('button', { name: `Утвердить в группу ${group.code}` }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(screen.queryByRole('dialog', { name: 'Странный человек' })).not.toBeInTheDocument();
  });
});

describe('Заявки: чип «Странные»', () => {
  const chips = () => screen.getByRole('group', { name: 'Фильтр по состоянию заявки' });
  const chip = () => within(chips()).getByRole('button', { name: /^Странные/ });

  test('рядом с чипами корзин стоит «Странные» с числом отмеченных в текущем списке', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests');
    await screen.findByRole('list', { name: 'Список заявок' });
    expect(chip()).toHaveTextContent('Странные2');
    expect(chip()).toHaveAttribute('aria-pressed', 'false');
  });

  test('число следует за поиском: считаются только найденные', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests&q=Кулик');
    await screen.findByRole('list', { name: 'Список заявок' });
    expect(chip()).toHaveTextContent('Странные1');
  });

  test('нажатие записывает bucket=strange в адрес и оставляет в списке только отмеченных', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests');
    await screen.findByRole('list', { name: 'Список заявок' });
    await user.click(chip());
    expect(currentSearch().get('bucket')).toBe('strange');
    expect(chip()).toHaveAttribute('aria-pressed', 'true');
    const names = within(list()).getAllByRole('listitem').map((li) => within(li).getAllByRole('button')[0]!.textContent);
    expect(names).toEqual(expect.arrayContaining(['Лариса Кулик', 'Георгий Шмелёв']));
    expect(names).toHaveLength(2);
  });

  test('ссылка с bucket=strange сразу открывает отбор', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests&bucket=strange');
    await screen.findByRole('list', { name: 'Список заявок' });
    expect(chip()).toHaveAttribute('aria-pressed', 'true');
    expect(within(list()).getAllByRole('listitem')).toHaveLength(2);
  });

  test('в «Все» остальные чипы и их числа не затронуты', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests');
    await screen.findByRole('list', { name: 'Список заявок' });
    const all = within(chips()).getByRole('button', { name: /^Все/ });
    expect(all).toHaveTextContent(`Все${buildRequests().items.filter((r) => r.bucket !== 'cancelled').length}`);
  });
});

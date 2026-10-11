import type { Proposal } from '@contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildRequests } from '../../fixtures/build';
import { renderAt, stubFetchWithFixtures } from '../../test/render';
import { fail, fixtureItem, getsOf, json, ok, openCard, posts, viewWith } from './requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

const REMATCH = 'Подобрать заново';

/** Заявка 2 в фикстурах закреплена и помечена «данные изменились»; у заявки 1 предложение свежее. */
const changedProposal = (id: number, dataChanged: boolean): Proposal => ({ ...fixtureItem(id).proposal!, saved: true, dataChanged });

describe('«Заявки»: подобрать заново', () => {
  test('кнопка шлёт rematch именно для этой заявки с пустым телом и перечитывает заявки, «Сегодня» и группы', async () => {
    const fetchMock = stubFetchWithFixtures({ 'requests/1/rematch': ok });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: REMATCH }));

    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]).toMatchObject({ path: 'requests/1/rematch', body: {} });
    await waitFor(() => expect(getsOf(fetchMock, 'requests')).toBe(2));
    expect(getsOf(fetchMock, 'today')).toBeGreaterThanOrEqual(1);
    // «Группы» на этой вкладке не открыты, но места в них изменились: данные надо пометить устаревшими
    await waitFor(() => expect(getsOf(fetchMock, 'groups')).toBeGreaterThanOrEqual(1));
  });

  test('после успеха пишет «Подобрано заново» и называет группу, которую предложили теперь', async () => {
    const before = fixtureItem(1).proposal!;
    const other = fixtureItem(1).proposal!.alternatives[0]!;
    expect(other.group.code).not.toBe(before.main.group.code);
    let done = false;
    stubFetchWithFixtures({
      'requests/1/rematch': () => {
        done = true;
        return ok();
      },
      requests: () => json(done ? viewWith(1, { proposal: { ...before, saved: true, main: other } }) : buildRequests()),
    });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: REMATCH }));
    const notice = await within(card).findByRole('status');
    expect(notice).toHaveTextContent(`Подобрано заново: ${other.group.code}`);
  });

  test('если после пересчёта группы не нашлось, говорит об этом общим подтверждением, а не выдуманной группой', async () => {
    let done = false;
    stubFetchWithFixtures({
      'requests/1/rematch': () => {
        done = true;
        return ok();
      },
      requests: () =>
        json(done ? viewWith(1, { bucket: 'human', proposal: null, noPlan: { code: 'taken', reason: 'Места разобраны' } }) : buildRequests()),
    });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: REMATCH }));
    const notice = await within(card).findByText(/^Подобрано заново/);
    expect(notice).toHaveTextContent('Подобрано заново: группа пересчитана по текущим данным заявки.');
  });

  test('у кнопки есть подсказка: пересчитает по текущим данным, отклонённые группы не вернутся', async () => {
    const card = await openCard(1);
    const btn = within(card).getByRole('button', { name: REMATCH });
    const hint = 'Пересчитает группу по текущим данным заявки. Отклонённые вами группы не вернутся';
    expect(within(card).getByText(hint)).toBeInTheDocument();
    expect(btn).toHaveAccessibleDescription(hint);
  });

  test('у заявки без предложения («нужна помощь», плана нет) кнопка тоже есть', async () => {
    expect(fixtureItem(11).proposal).toBeNull();
    const card = await openCard(11, '&bucket=human');
    expect(within(card).getByRole('button', { name: REMATCH })).toBeEnabled();
  });

  test('у утверждённой заявки кнопки нет: подбирать заново уже нечего', async () => {
    const card = await openCard(10);
    expect(within(card).queryByRole('button', { name: REMATCH })).not.toBeInTheDocument();
  });

  test('после «Утвердить» кнопка пропадает вместе с остальными действиями', async () => {
    const group = fixtureItem(1).proposal!.main.group;
    let approved = false;
    stubFetchWithFixtures({
      'requests/1/approve': () => {
        approved = true;
        return ok();
      },
      requests: () => json(approved ? viewWith(1, { bucket: 'done', proposal: null, finalGroup: group }) : buildRequests()),
    });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: `Утвердить в группу ${group.code}` }));
    await within(card).findByText(`Утверждено: ${group.code}`);
    expect(within(card).queryByRole('button', { name: REMATCH })).not.toBeInTheDocument();
  });

  test('двойное нажатие шлёт один запрос, а кнопка на время запроса отключена и подписана «Подбираем…»', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchMock = stubFetchWithFixtures({
      'requests/1/rematch': async () => {
        await gate;
        return ok();
      },
    });
    const user = userEvent.setup();
    const card = await openCard(1);
    const btn = within(card).getByRole('button', { name: REMATCH });
    await user.dblClick(btn);
    expect(posts(fetchMock)).toHaveLength(1);
    expect(within(card).getByRole('button', { name: 'Подбираем…' })).toBeDisabled();
    release();
    await within(card).findByText(/^Подобрано заново/);
    expect(posts(fetchMock)).toHaveLength(1);
    await waitFor(() => expect(within(card).getByRole('button', { name: REMATCH })).toBeEnabled());
  });

  test('два нажатия до перерисовки тоже дают один запрос: кнопка ещё не успела отключиться', async () => {
    const fetchMock = stubFetchWithFixtures({ 'requests/1/rematch': ok });
    const card = await openCard(1);
    const btn = within(card).getByRole('button', { name: REMATCH });
    act(() => {
      btn.click();
      btn.click();
    });
    await within(card).findByText(/^Подобрано заново/);
    expect(posts(fetchMock)).toHaveLength(1);
  });

  test('ошибка показывается текстом без слов сервера, а кнопка снова доступна', async () => {
    stubFetchWithFixtures({ 'requests/1/rematch': fail(500, 'internal') });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: REMATCH }));
    const alert = await within(card).findByRole('alert');
    expect(alert).toHaveTextContent('Не получилось выполнить действие');
    expect(alert).not.toHaveTextContent('служебный текст сервера');
    expect(within(card).getByRole('button', { name: REMATCH })).toBeEnabled();
  });

  test('если заявку уже утвердили без нас (409), говорит об этом и перечитывает список', async () => {
    const fetchMock = stubFetchWithFixtures({ 'requests/1/rematch': fail(409, 'already_closed') });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: REMATCH }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('Заявку уже обработали');
    await waitFor(() => expect(getsOf(fetchMock, 'requests')).toBe(2));
  });

  test('обрыв связи показывается отдельным текстом', async () => {
    stubFetchWithFixtures({
      'requests/1/rematch': () => {
        throw new TypeError('network');
      },
    });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: REMATCH }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('Нет связи с сервером');
  });
});

describe('«Заявки»: данные изменились после закрепления', () => {
  test('в фикстурах у двух закреплённых заявок данные изменились, у остальных нет', () => {
    const changed = buildRequests().items.filter((r) => r.proposal?.dataChanged);
    expect(changed.length).toBeGreaterThanOrEqual(1);
    expect(changed.length).toBeLessThanOrEqual(2);
    expect(changed.every((r) => r.proposal!.saved)).toBe(true);
  });

  test('в карточке есть метка «Данные изменились» с пояснением, а «Закреплено» не показывается: оно устарело', async () => {
    stubFetchWithFixtures({ requests: () => json(viewWith(1, { proposal: changedProposal(1, true) })) });
    const card = await openCard(1);
    expect(await within(card).findByText('Данные изменились')).toBeInTheDocument();
    expect(
      within(card).getByText(
        'Район, возраст, время или улица изменились после закрепления. Нажмите «Подобрать заново» — или запустите «Закрепить подбор», он обновит такие заявки сам',
      ),
    ).toBeInTheDocument();
    expect(within(card).queryByText('Закреплено')).not.toBeInTheDocument();
    expect(within(card).queryByText('Расчёт, не закреплено')).not.toBeInTheDocument();
  });

  test('метка окрашена цветом предупреждения и подписана словами, а не только цветом', async () => {
    stubFetchWithFixtures({ requests: () => json(viewWith(1, { proposal: changedProposal(1, true) })) });
    const card = await openCard(1);
    const tag = await within(card).findByText('Данные изменились');
    expect(tag.className).toMatch(/changedTag/);
  });

  test('при изменившихся данных «Подобрать заново» становится главной кнопкой, а «Утвердить» — обычной', async () => {
    const group = fixtureItem(1).proposal!.main.group;
    stubFetchWithFixtures({ requests: () => json(viewWith(1, { proposal: changedProposal(1, true) })) });
    const card = await openCard(1);
    await within(card).findByText('Данные изменились');
    expect(within(card).getByRole('button', { name: REMATCH }).className).toMatch(/primary/);
    expect(within(card).getByRole('button', { name: `Утвердить в группу ${group.code}` }).className).not.toMatch(/primary/);
  });

  test('без изменившихся данных главной остаётся «Утвердить», а пояснения и метки «Данные изменились» нет', async () => {
    const group = fixtureItem(1).proposal!.main.group;
    stubFetchWithFixtures({ requests: () => json(viewWith(1, { proposal: changedProposal(1, false) })) });
    const card = await openCard(1);
    await within(card).findByText('Закреплено');
    expect(within(card).queryByText('Данные изменились')).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: REMATCH }).className).not.toMatch(/primary/);
    expect(within(card).getByRole('button', { name: `Утвердить в группу ${group.code}` }).className).toMatch(/primary/);
  });

  test('в списке у такой заявки вместо «Закреплено» стоит «Данные изменились»', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests');
    const list = await screen.findByRole('list', { name: 'Список заявок' });
    const items = buildRequests().items.filter((r) => r.proposal && r.bucket !== 'done');
    const changed = items.filter((r) => r.proposal!.dataChanged).length;
    const saved = items.filter((r) => r.proposal!.saved && !r.proposal!.dataChanged).length;
    expect(changed).toBeGreaterThan(0);
    expect(within(list).getAllByText('Данные изменились')).toHaveLength(changed);
    expect(within(list).getAllByText('Закреплено')).toHaveLength(saved);
  });
});

describe('«Заявки»: после правки времени или улицы', () => {
  test('сохранение улицы подсказывает, когда пересчитается группа', async () => {
    stubFetchWithFixtures({ 'requests/2/params': ok });
    const user = userEvent.setup();
    const card = await openCard(2);
    await user.click(within(card).getByRole('button', { name: 'Изменить улицу и дом' }));
    await user.type(within(card).getByRole('textbox', { name: 'Улица, дом' }), 'ул. Рылеева 32');
    await user.click(within(card).getByRole('button', { name: 'Сохранить' }));
    expect(await within(card).findByText('Сохранено: улица и дом.')).toBeInTheDocument();
    expect(
      within(card).getByText(
        'Параметры изменились — группа пересчитается при следующем закреплении подбора или по кнопке «Подобрать заново»',
      ),
    ).toBeInTheDocument();
  });

  test('сохранение времени подсказывает то же самое', async () => {
    stubFetchWithFixtures({ 'requests/2/params': ok });
    const user = userEvent.setup();
    const card = await openCard(2);
    await user.click(within(card).getByRole('button', { name: 'Изменить удобные день и время' }));
    await user.type(within(card).getByRole('textbox', { name: 'Удобные день и время' }), 'пн вечером');
    await user.click(within(card).getByRole('button', { name: 'Сохранить' }));
    await within(card).findByText('Сохранено: удобные день и время.');
    expect(within(card).getByText(/Параметры изменились — группа пересчитается/)).toBeInTheDocument();
  });

  test('при ошибке сохранения подсказки про пересчёт нет: параметры не менялись', async () => {
    stubFetchWithFixtures({ 'requests/2/params': fail(400, 'bad_request') });
    const user = userEvent.setup();
    const card = await openCard(2);
    await user.click(within(card).getByRole('button', { name: 'Изменить улицу и дом' }));
    await user.type(within(card).getByRole('textbox', { name: 'Улица, дом' }), 'ул. Рылеева 32');
    await user.click(within(card).getByRole('button', { name: 'Сохранить' }));
    await within(card).findByRole('alert');
    expect(within(card).queryByText(/Параметры изменились/)).not.toBeInTheDocument();
  });
});

import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildPeople } from '../../fixtures/build';
import { resetDemoStrange } from '../../fixtures/strange';
import { buildTeam } from '../../fixtures/team';
import { queryKeys } from '../../shared/api/queries';
import { makeClient, renderAt, stubFetchWithFixtures } from '../../test/render';
import { fail, getsOf, json, ok, openCard, posts } from '../requests/requestsTestKit';

afterEach(() => {
  vi.unstubAllGlobals();
  resetDemoStrange();
});

type Overrides = Record<string, () => Response | Promise<Response>>;

/** Блок «Странный человек» в карточке заявки: заявка 1 без метки, 14 — с меткой, 10 — закрыта. */
async function openRequestBlock(id: number, overrides: Overrides = {}) {
  const fetchMock = stubFetchWithFixtures(overrides);
  const card = await openCard(id);
  const section = await within(card).findByRole('region', { name: 'Странный человек' });
  return { fetchMock, card, section };
}

const flag = (section: HTMLElement) => within(section).getByRole('checkbox', { name: 'Странный человек' });
const noteField = (section: HTMLElement) => within(section).getByRole('textbox', { name: /Что заметили/ });

describe('Карточка заявки: флажок «Странный человек»', () => {
  test('блок стоит в «Работе с заявкой» сразу после «Итога звонка»', async () => {
    const { card, section } = await openRequestBlock(1);
    const call = within(card).getByRole('region', { name: 'Итог звонка' });
    expect(call.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const work = within(card).getByRole('heading', { name: 'Работа с заявкой' }).closest('section')!;
    expect(work).toContainElement(section);
    expect(work).toContainElement(call);
  });

  test('под флажком сказано, что человек не попадёт в обычный подбор', async () => {
    const { section } = await openRequestBlock(1);
    expect(flag(section)).toHaveAccessibleDescription(
      'Такой человек не попадёт в автоматический подбор обычных групп: для него нужна отдельная группа. Подберите её вручную.',
    );
  });

  test('поле заметки появляется после того, как флажок поставили, и ограничено 300 знаками', async () => {
    const user = userEvent.setup();
    const { section } = await openRequestBlock(1);
    expect(within(section).queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(flag(section));
    expect(noteField(section)).toHaveAttribute('maxlength', '300');
    expect(within(section).getByText('Что заметили (для коллег, до 300 знаков)')).toBeInTheDocument();
  });

  test('пока нечего записывать, кнопка отключена', async () => {
    const user = userEvent.setup();
    const { section } = await openRequestBlock(1);
    expect(within(section).getByRole('button', { name: 'Сохранить отметку' })).toBeDisabled();
    await user.click(flag(section));
    expect(within(section).getByRole('button', { name: 'Сохранить отметку' })).toBeEnabled();
  });

  test('«Сохранить отметку» шлёт value=true и заметку без пробелов по краям, подтверждает словами', async () => {
    const user = userEvent.setup();
    const { fetchMock, section } = await openRequestBlock(1, { 'requests/1/strange': ok });
    await user.click(flag(section));
    await user.type(noteField(section), '  Говорит о слежке  ');
    await user.click(within(section).getByRole('button', { name: 'Сохранить отметку' }));
    expect(await within(section).findByRole('status')).toHaveTextContent('Отметка поставлена.');
    expect(posts(fetchMock)).toHaveLength(1);
    expect(posts(fetchMock)[0]).toMatchObject({ path: 'requests/1/strange' });
    expect(posts(fetchMock)[0]!.body).toEqual({ value: true, note: 'Говорит о слежке' });
  });

  test('пустая заметка не отправляется: ни пустой строкой, ни пробелами', async () => {
    const user = userEvent.setup();
    const { fetchMock, section } = await openRequestBlock(1, { 'requests/1/strange': ok });
    await user.click(flag(section));
    await user.type(noteField(section), '   ');
    await user.click(within(section).getByRole('button', { name: 'Сохранить отметку' }));
    await within(section).findByRole('status');
    expect(posts(fetchMock)[0]!.body).toEqual({ value: true });
    expect(posts(fetchMock)[0]!.body).not.toHaveProperty('note');
  });

  test('у отмеченного флажок стоит, заметка на месте; «Снять отметку» шлёт value=false без заметки', async () => {
    const user = userEvent.setup();
    const { fetchMock, section } = await openRequestBlock(14, { 'requests/14/strange': ok });
    expect(flag(section)).toBeChecked();
    expect(noteField(section)).toHaveValue('По телефону говорила, что за ней следят; просит группу без детей.');
    expect(within(section).getByRole('button', { name: 'Сохранить отметку' })).toBeDisabled();
    await user.click(flag(section));
    await user.click(within(section).getByRole('button', { name: 'Снять отметку' }));
    expect(await within(section).findByRole('status')).toHaveTextContent('Отметка снята.');
    expect(posts(fetchMock)[0]!.body).toEqual({ value: false });
  });

  test('у отмеченного можно поправить только заметку: метка остаётся, заметка уходит новая', async () => {
    const user = userEvent.setup();
    const { fetchMock, section } = await openRequestBlock(14, { 'requests/14/strange': ok });
    await user.clear(noteField(section));
    await user.type(noteField(section), 'Уже спокойнее');
    await user.click(within(section).getByRole('button', { name: 'Сохранить отметку' }));
    await within(section).findByRole('status');
    expect(posts(fetchMock)[0]!.body).toEqual({ value: true, note: 'Уже спокойнее' });
  });

  test('на закрытой заявке отметку тоже можно поставить: метка про человека, а не про заявку', async () => {
    const user = userEvent.setup();
    const { fetchMock, card, section } = await openRequestBlock(10, { 'requests/10/strange': ok });
    expect(within(card).queryByRole('region', { name: 'Итог звонка' })).not.toBeInTheDocument();
    await user.click(flag(section));
    await user.click(within(section).getByRole('button', { name: 'Сохранить отметку' }));
    await within(section).findByRole('status');
    expect(posts(fetchMock)[0]).toMatchObject({ path: 'requests/10/strange', body: { value: true } });
  });

  test('после успеха перечитываются заявки, «Сегодня», группы, люди и «Команда»', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    // «Люди» и «Команда» на экране заявок не открыты, поэтому их читать некому; важно, что они помечены устаревшими
    // и будут прочитаны заново при открытии. Кладём в кэш готовые данные, чтобы это было видно.
    client.setQueryData(queryKeys.people, buildPeople());
    client.setQueryData(queryKeys.team, buildTeam());
    const fetchMock = stubFetchWithFixtures({ 'requests/1/strange': ok });
    renderAt(<App />, '/?tab=requests&req=1', client);
    const card = await screen.findByRole('dialog', { name: /Карточка заявки/ });
    const section = await within(card).findByRole('region', { name: 'Странный человек' });
    await user.click(flag(section));
    await user.click(within(section).getByRole('button', { name: 'Сохранить отметку' }));
    await within(section).findByRole('status');
    await waitFor(() => expect(getsOf(fetchMock, 'requests')).toBe(2));
    // «Сегодня» и «Группы» читались и при открытии карточки, поэтому ждём второе чтение
    await waitFor(() => expect(getsOf(fetchMock, 'today')).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(getsOf(fetchMock, 'groups')).toBeGreaterThanOrEqual(2));
    expect(client.getQueryState(queryKeys.people)?.isInvalidated).toBe(true);
    expect(client.getQueryState(queryKeys.team)?.isInvalidated).toBe(true);
  });

  test('пока запрос идёт, флажок, заметка и кнопка заблокированы', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { section } = await openRequestBlock(1, {
      'requests/1/strange': async () => {
        await gate;
        return ok();
      },
    });
    await user.click(flag(section));
    await user.click(within(section).getByRole('button', { name: 'Сохранить отметку' }));
    await waitFor(() => expect(within(section).getByRole('button', { name: 'Сохраняем…' })).toBeDisabled());
    expect(flag(section)).toBeDisabled();
    expect(noteField(section)).toBeDisabled();
    release();
    await within(section).findByRole('status');
  });

  test('два нажатия до перерисовки дают один POST', async () => {
    const user = userEvent.setup();
    const { fetchMock, section } = await openRequestBlock(1, { 'requests/1/strange': ok });
    await user.click(flag(section));
    const button = within(section).getByRole('button', { name: 'Сохранить отметку' });
    act(() => {
      button.click();
      button.click();
    });
    await within(section).findByRole('status');
    expect(posts(fetchMock)).toHaveLength(1);
  });

  test('ошибка сервера показана его словами, заметка не теряется, подтверждения нет', async () => {
    const user = userEvent.setup();
    const { section } = await openRequestBlock(1, {
      'requests/1/strange': () => json({ error: 'bad_request', message: 'Заметка не длиннее 300 знаков.' }, 400),
    });
    await user.click(flag(section));
    await user.type(noteField(section), 'не успел сохранить');
    await user.click(within(section).getByRole('button', { name: 'Сохранить отметку' }));
    expect(await within(section).findByRole('alert')).toHaveTextContent('Заметка не длиннее 300 знаков.');
    expect(noteField(section)).toHaveValue('не успел сохранить');
    expect(within(section).queryByRole('status')).not.toBeInTheDocument();
  });

  test('общий текст «Ошибка 400» человеку не показывается: вместо него понятная подсказка', async () => {
    const user = userEvent.setup();
    const { section } = await openRequestBlock(1, { 'requests/1/strange': () => json({ error: 'bad_request', message: 'Ошибка 400' }, 400) });
    await user.click(flag(section));
    await user.click(within(section).getByRole('button', { name: 'Сохранить отметку' }));
    expect(await within(section).findByRole('alert')).toHaveTextContent('Не получилось сохранить отметку: проверьте текст заметки');
  });

  test('обрыв сети: честно сказано, что неизвестно, сохранилась ли отметка', async () => {
    const user = userEvent.setup();
    const { section } = await openRequestBlock(1, {
      'requests/1/strange': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await user.click(flag(section));
    await user.click(within(section).getByRole('button', { name: 'Сохранить отметку' }));
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'Нет связи с сервером. Неизвестно, сохранилась ли отметка: обновите страницу.',
    );
  });

  test('403 и 404 объяснены словами, служебный текст сервера не показывается', async () => {
    const user = userEvent.setup();
    const { section } = await openRequestBlock(1, { 'requests/1/strange': fail(404, 'not_found') });
    await user.click(flag(section));
    await user.click(within(section).getByRole('button', { name: 'Сохранить отметку' }));
    const alert = await within(section).findByRole('alert');
    expect(alert).toHaveTextContent('Заявка не найдена');
    expect(alert).not.toHaveTextContent('служебный текст сервера');
  });

  test('когда список перечитан и метка пришла с сервера, форма показывает её, а не черновик', async () => {
    const user = userEvent.setup();
    let marked = false;
    const { section } = await openRequestBlock(1, {
      'requests/1/strange': () => {
        marked = true;
        return ok();
      },
      requests: async () => {
        const { buildRequests } = await import('../../fixtures/build');
        const view = buildRequests();
        const at = '2026-10-12T09:00:00.000Z';
        return json(
          marked ? { ...view, items: view.items.map((r) => (r.id === 1 ? { ...r, strange: { by: 'Анна', at, note: 'Записано сервером' } } : r)) } : view,
        );
      },
    });
    await user.click(flag(section));
    await user.type(noteField(section), 'черновик');
    await user.click(within(section).getByRole('button', { name: 'Сохранить отметку' }));
    await waitFor(() => expect(noteField(section)).toHaveValue('Записано сервером'));
    expect(flag(section)).toBeChecked();
  });
});

describe('Карточка «другого обращения»: флажок «Странный человек»', () => {
  test('метка ставится через тот же адрес requests/:id/strange, обращение — это тоже строка заявок', async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetchWithFixtures({ 'requests/202/strange': ok });
    renderAt(<App />, '/?tab=requests&view=others&req=202');
    const card = await screen.findByRole('dialog', { name: /Карточка обращения/ });
    const section = await within(card).findByRole('region', { name: 'Странный человек' });
    await user.click(flag(section));
    await user.type(noteField(section), 'Путает имена');
    await user.click(within(section).getByRole('button', { name: 'Сохранить отметку' }));
    await within(section).findByRole('status');
    expect(posts(fetchMock)[0]).toMatchObject({ path: 'requests/202/strange', body: { value: true, note: 'Путает имена' } });
  });
});

describe('Справочник → Люди: флажок «Странный человек»', () => {
  async function openPerson(key: string, overrides: Overrides = {}) {
    const fetchMock = stubFetchWithFixtures(overrides);
    renderAt(<App />, `/?tab=reference&ent=people&rec=${key}`);
    const card = await screen.findByRole('dialog', { name: /Карточка человека/ });
    return { fetchMock, card, section: await within(card).findByRole('region', { name: 'Странный человек' }) };
  }

  test('метка ставится по ключу человека: people/strange с key, value и заметкой', async () => {
    const user = userEvent.setup();
    const { fetchMock, section } = await openPerson('u1', { 'people/strange': ok });
    await user.click(flag(section));
    await user.type(noteField(section), 'Агрессивен в чате');
    await user.click(within(section).getByRole('button', { name: 'Сохранить отметку' }));
    await within(section).findByRole('status');
    expect(posts(fetchMock)).toHaveLength(1);
    expect(posts(fetchMock)[0]).toMatchObject({ path: 'people/strange', body: { key: 'u1', value: true, note: 'Агрессивен в чате' } });
  });

  test('у отмеченного человека метку можно снять: key и value=false, без заметки', async () => {
    const user = userEvent.setup();
    const { fetchMock, section } = await openPerson('u2', { 'people/strange': ok });
    expect(flag(section)).toBeChecked();
    await user.click(flag(section));
    await user.click(within(section).getByRole('button', { name: 'Снять отметку' }));
    await within(section).findByRole('status');
    expect(posts(fetchMock)[0]!.body).toEqual({ key: 'u2', value: false });
  });

  test('после успеха перечитываются и люди, и группы (метка видна в составе)', async () => {
    const user = userEvent.setup();
    const { fetchMock, section } = await openPerson('u1', { 'people/strange': ok });
    await user.click(flag(section));
    await user.click(within(section).getByRole('button', { name: 'Сохранить отметку' }));
    await within(section).findByRole('status');
    await waitFor(() => expect(getsOf(fetchMock, 'people')).toBe(2));
    await waitFor(() => expect(getsOf(fetchMock, 'groups')).toBeGreaterThanOrEqual(2));
  });

  test('два нажатия до перерисовки дают один POST', async () => {
    const user = userEvent.setup();
    const { fetchMock, section } = await openPerson('u1', { 'people/strange': ok });
    await user.click(flag(section));
    const button = within(section).getByRole('button', { name: 'Сохранить отметку' });
    act(() => {
      button.click();
      button.click();
    });
    await within(section).findByRole('status');
    expect(posts(fetchMock)).toHaveLength(1);
  });

  test('ошибка показана словами', async () => {
    const user = userEvent.setup();
    const { section } = await openPerson('u1', { 'people/strange': fail(403, 'forbidden') });
    await user.click(flag(section));
    await user.click(within(section).getByRole('button', { name: 'Сохранить отметку' }));
    expect(await within(section).findByRole('alert')).toHaveTextContent('Нет доступа к этому действию.');
  });
});

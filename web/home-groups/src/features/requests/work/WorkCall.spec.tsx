import { act, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { stubFetchWithFixtures } from '../../../test/render';
import { fail, getsOf, json, ok, openCard, posts } from '../requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

async function openCall(id = 1, overrides: Record<string, () => Response | Promise<Response>> = {}) {
  const fetchMock = stubFetchWithFixtures({ [`requests/${id}/call`]: ok, ...overrides });
  const card = await openCard(id);
  const section = await within(card).findByRole('region', { name: 'Итог звонка' });
  return { fetchMock, card, section };
}

const BUTTONS = ['Дозвонился', 'Не дозвонился', 'Просил перезвонить позже', 'Отказался'];

describe('Карточка заявки: итог звонка', () => {
  test('у открытой заявки четыре кнопки итога и подсказка про «Перезвонить»', async () => {
    const { section } = await openCall();
    for (const name of BUTTONS) expect(within(section).getByRole('button', { name })).toBeEnabled();
    expect(
      within(section).getByText(/«Не дозвонился» и «Просил перезвонить позже» оставляют заявку в «Перезвонить», остальные итоги снимают отметку/),
    ).toBeInTheDocument();
  });

  test('у закрытой заявки блока нет: звонить по ней уже незачем', async () => {
    stubFetchWithFixtures();
    const card = await openCard(10);
    await within(card).findByRole('heading', { name: 'Работа с заявкой' });
    expect(within(card).queryByRole('region', { name: 'Итог звонка' })).not.toBeInTheDocument();
  });

  test.each([
    ['Дозвонился', 'reached', 'Записано: дозвонился.'],
    ['Не дозвонился', 'no_answer', 'Записано: не дозвонился.'],
    ['Просил перезвонить позже', 'later', 'Записано: просил перезвонить позже.'],
    ['Отказался', 'refused', 'Записано: отказался.'],
  ])('кнопка «%s» шлёт result=%s и подтверждает «%s»', async (label, result, confirm) => {
    const user = userEvent.setup();
    const { fetchMock, section } = await openCall();
    await user.click(within(section).getByRole('button', { name: label }));
    expect(await within(section).findByText(confirm)).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(1);
    expect(posts(fetchMock)[0]).toMatchObject({ path: 'requests/1/call' });
    // без комментария поле comment вообще не отправляется
    expect(posts(fetchMock)[0]!.body).toEqual({ result });
  });

  test('комментарий уходит вместе с итогом, обрезанный по краям, а после успеха поле очищается', async () => {
    const user = userEvent.setup();
    const { fetchMock, section } = await openCall();
    const comment = within(section).getByRole('textbox', { name: /Комментарий к звонку/ });
    await user.type(comment, '  Просила набрать вечером  ');
    await user.click(within(section).getByRole('button', { name: 'Просил перезвонить позже' }));
    await within(section).findByText('Записано: просил перезвонить позже.');
    expect(posts(fetchMock)[0]!.body).toEqual({ result: 'later', comment: 'Просила набрать вечером' });
    expect(comment).toHaveValue('');
  });

  test('комментарий ограничен 500 знаками', async () => {
    const { section } = await openCall();
    expect(within(section).getByRole('textbox', { name: /Комментарий к звонку/ })).toHaveAttribute('maxlength', '500');
    expect(within(section).getByText('До 500 знаков.')).toBeInTheDocument();
  });

  test('после успеха заявки, «Сегодня» и группы перечитываются', async () => {
    const user = userEvent.setup();
    const { fetchMock, section } = await openCall();
    await user.click(within(section).getByRole('button', { name: 'Дозвонился' }));
    await within(section).findByText('Записано: дозвонился.');
    await waitFor(() => expect(getsOf(fetchMock, 'requests')).toBe(2));
    // и то и другое читалось при открытии карточки, поэтому ждём второе чтение, а не первое
    await waitFor(() => expect(getsOf(fetchMock, 'today')).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(getsOf(fetchMock, 'groups')).toBeGreaterThanOrEqual(2));
  });

  test('пока запрос идёт, все кнопки итога заблокированы и второй POST не уходит', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { fetchMock, section } = await openCall(1, {
      'requests/1/call': async () => {
        await gate;
        return ok();
      },
    });
    await user.click(within(section).getByRole('button', { name: 'Дозвонился' }));
    await waitFor(() => expect(within(section).getByRole('button', { name: 'Отказался' })).toBeDisabled());
    for (const name of BUTTONS) expect(within(section).getByRole('button', { name })).toBeDisabled();
    expect(posts(fetchMock)).toHaveLength(1);
    release();
    await waitFor(() => expect(within(section).getByRole('button', { name: 'Дозвонился' })).toBeEnabled());
  });

  test('два нажатия до перерисовки дают один POST: звонок не записывается дважды', async () => {
    const { fetchMock, section } = await openCall();
    const button = within(section).getByRole('button', { name: 'Дозвонился' });
    act(() => {
      button.click();
      button.click();
    });
    await within(section).findByText('Записано: дозвонился.');
    expect(posts(fetchMock)).toHaveLength(1);
  });

  test('при ошибке комментарий не теряется, ошибка показана текстом', async () => {
    const user = userEvent.setup();
    const { section } = await openCall(1, { 'requests/1/call': fail(409, 'already_closed') });
    const comment = within(section).getByRole('textbox', { name: /Комментарий к звонку/ });
    await user.type(comment, 'не успел сохранить');
    await user.click(within(section).getByRole('button', { name: 'Отказался' }));
    expect(await within(section).findByRole('alert')).toHaveTextContent('Заявку уже обработали');
    expect(comment).toHaveValue('не успел сохранить');
    expect(within(section).queryByText(/Записано/)).not.toBeInTheDocument();
  });

  test('bad_request от сервера показывается его текстом', async () => {
    const user = userEvent.setup();
    const { section } = await openCall(1, {
      'requests/1/call': () => json({ error: 'bad_request', message: 'Комментарий не длиннее 500 знаков.' }, 400),
    });
    await user.click(within(section).getByRole('button', { name: 'Дозвонился' }));
    expect(await within(section).findByRole('alert')).toHaveTextContent('Комментарий не длиннее 500 знаков.');
  });
});

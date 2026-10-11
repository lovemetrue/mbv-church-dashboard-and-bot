import { QueryClient } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../../app/App';
import { queryKeys } from '../../../shared/api/queries';
import { currentSearch, makeClient, renderAt, stubFetchWithFixtures } from '../../../test/render';
import { fail, getsOf, json, ok, openCard, posts } from '../requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

type Overrides = Record<string, () => Response | Promise<Response>>;

/** Заявка 1 (Мария Соколова) открыта, заявка 10 (Артём Лебедев) уже утверждена. */
async function openClose(id = 1, overrides: Overrides = {}) {
  const fetchMock = stubFetchWithFixtures(overrides);
  const card = await openCard(id);
  return { fetchMock, card, user: userEvent.setup() };
}

async function openDialog(id = 1, overrides: Overrides = {}) {
  const ctx = await openClose(id, overrides);
  await ctx.user.click(within(ctx.card).getByRole('button', { name: 'Закрыть заявку…' }));
  const dialog = await screen.findByRole('dialog', { name: 'Закрыть заявку' });
  return { ...ctx, dialog };
}

const submitBtn = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: 'Закрыть заявку' });

describe('Карточка заявки: закрытие', () => {
  test('у открытой заявки одна кнопка «Закрыть заявку…», «Вернуть в работу» нет', async () => {
    const { card } = await openClose();
    const work = within(card).getByRole('heading', { name: 'Работа с заявкой' }).closest('section')!;
    expect(within(work).getAllByRole('button', { name: 'Закрыть заявку…' })).toHaveLength(1);
    expect(within(work).queryByRole('button', { name: 'Вернуть в работу' })).not.toBeInTheDocument();
  });

  test('кнопка открывает окно с выбором «Обработано» или «Аннулировать»; пока не выбрано, «Закрыть» отключена', async () => {
    const { dialog, fetchMock } = await openDialog();
    expect(within(dialog).getByRole('radio', { name: 'Обработано' })).not.toBeChecked();
    expect(within(dialog).getByRole('radio', { name: 'Аннулировать' })).not.toBeChecked();
    expect(submitBtn(dialog)).toBeDisabled();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  test('«Обработано» без комментария шлёт close с одним полем outcome', async () => {
    const { dialog, fetchMock, user } = await openDialog(1, { 'requests/1/close': ok });
    await user.click(within(dialog).getByRole('radio', { name: 'Обработано' }));
    await user.click(submitBtn(dialog));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]).toMatchObject({ path: 'requests/1/close', body: { outcome: 'done' } });
    expect(posts(fetchMock)[0]!.body).toEqual({ outcome: 'done' });
  });

  test('комментарий уходит без краевых пробелов; поле ограничено 500 знаками', async () => {
    const { dialog, fetchMock, user } = await openDialog(1, { 'requests/1/close': ok });
    await user.click(within(dialog).getByRole('radio', { name: 'Обработано' }));
    const comment = within(dialog).getByRole('textbox', { name: 'Комментарий (необязательно)' });
    expect(comment).toHaveAttribute('maxlength', '500');
    await user.type(comment, '  Группа не нужна  ');
    await user.click(submitBtn(dialog));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]!.body).toEqual({ outcome: 'done', comment: 'Группа не нужна' });
  });

  test('«Аннулировать» показывает пять причин в заданном порядке', async () => {
    const { dialog, user } = await openDialog();
    expect(within(dialog).queryByRole('radio', { name: 'Отказались' })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: 'Аннулировать' }));
    const reasons = within(dialog).getByRole('group', { name: 'Причина' });
    expect(within(reasons).getAllByRole('radio').map((r) => r.closest('label')!.textContent)).toEqual([
      'Отказались',
      'Не отвечают',
      'Дубль заявки',
      'Нашли группу сами',
      'Другое',
    ]);
  });

  test('при аннулировании «Закрыть» отключена, пока причина не выбрана', async () => {
    const { dialog, user } = await openDialog();
    await user.click(within(dialog).getByRole('radio', { name: 'Аннулировать' }));
    expect(submitBtn(dialog)).toBeDisabled();
    await user.click(within(dialog).getByRole('radio', { name: 'Не отвечают' }));
    expect(submitBtn(dialog)).toBeEnabled();
  });

  test('аннулирование с причиной шлёт outcome, reason и не шлёт пустой комментарий', async () => {
    const { dialog, fetchMock, user } = await openDialog(1, { 'requests/1/close': ok });
    await user.click(within(dialog).getByRole('radio', { name: 'Аннулировать' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Не отвечают' }));
    await user.click(submitBtn(dialog));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]!.body).toEqual({ outcome: 'cancel', reason: 'no_answer' });
  });

  test('«Другое» без комментария не уходит: подсказка вместо запроса, в том числе при одних пробелах', async () => {
    const { dialog, fetchMock, user } = await openDialog(1, { 'requests/1/close': ok });
    await user.click(within(dialog).getByRole('radio', { name: 'Аннулировать' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Другое' }));
    expect(within(dialog).getByRole('textbox', { name: 'Комментарий (обязательно)' })).toBeInTheDocument();
    await user.click(submitBtn(dialog));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Для причины «Другое» напишите комментарий.');
    await user.type(within(dialog).getByRole('textbox', { name: 'Комментарий (обязательно)' }), '   ');
    await user.click(submitBtn(dialog));
    expect(posts(fetchMock)).toHaveLength(0);
    expect(within(dialog).getByRole('alert')).toBeInTheDocument();
  });

  test('«Другое» с комментарием уходит вместе с ним; подсказка исчезает, когда комментарий написан', async () => {
    const { dialog, fetchMock, user } = await openDialog(1, { 'requests/1/close': ok });
    await user.click(within(dialog).getByRole('radio', { name: 'Аннулировать' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Другое' }));
    await user.click(submitBtn(dialog));
    await within(dialog).findByRole('alert');
    await user.type(within(dialog).getByRole('textbox', { name: 'Комментарий (обязательно)' }), 'Переехали в другой город');
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    await user.click(submitBtn(dialog));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]!.body).toEqual({ outcome: 'cancel', reason: 'other', comment: 'Переехали в другой город' });
  });

  test('если после выбора причины передумали и выбрали «Обработано», причина не уходит', async () => {
    const { dialog, fetchMock, user } = await openDialog(1, { 'requests/1/close': ok });
    await user.click(within(dialog).getByRole('radio', { name: 'Аннулировать' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Дубль заявки' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Обработано' }));
    await user.click(submitBtn(dialog));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]!.body).toEqual({ outcome: 'done' });
  });

  test('двойное нажатие «Закрыть» шлёт один запрос', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { dialog, fetchMock, user } = await openDialog(1, {
      'requests/1/close': async () => {
        await gate;
        return ok();
      },
    });
    await user.click(within(dialog).getByRole('radio', { name: 'Обработано' }));
    await user.dblClick(submitBtn(dialog));
    expect(posts(fetchMock)).toHaveLength(1);
    await waitFor(() => expect(submitBtn(dialog)).toBeDisabled());
    release();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Закрыть заявку' })).not.toBeInTheDocument());
    expect(posts(fetchMock)).toHaveLength(1);
  });

  test('ошибка сервера показывается его текстом в окне; введённое остаётся, окно открыто', async () => {
    const { dialog, user } = await openDialog(1, {
      'requests/1/close': () => json({ error: 'bad_request', message: 'Комментарий слишком длинный (до 500 знаков).' }, 400),
    });
    await user.click(within(dialog).getByRole('radio', { name: 'Обработано' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Комментарий (необязательно)' }), 'текст');
    await user.click(submitBtn(dialog));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Комментарий слишком длинный (до 500 знаков).');
    expect(within(dialog).getByRole('textbox', { name: 'Комментарий (необязательно)' })).toHaveValue('текст');
    expect(within(dialog).getByRole('radio', { name: 'Обработано' })).toBeChecked();
    expect(submitBtn(dialog)).toBeEnabled();
  });

  test('«уже закрыта»: понятное сообщение и перечитывание списка', async () => {
    const { dialog, fetchMock, user } = await openDialog(1, { 'requests/1/close': fail(409, 'already_closed') });
    await user.click(within(dialog).getByRole('radio', { name: 'Обработано' }));
    await user.click(submitBtn(dialog));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Заявку уже обработали');
    await waitFor(() => expect(getsOf(fetchMock, 'requests')).toBe(2));
  });

  test('«Отмена» и Escape закрывают окно без запроса', async () => {
    const { dialog, fetchMock, user } = await openDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(screen.queryByRole('dialog', { name: 'Закрыть заявку' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Закрыть заявку…' }));
    await screen.findByRole('dialog', { name: 'Закрыть заявку' });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Закрыть заявку' })).not.toBeInTheDocument();
    // карточка под окном осталась на месте
    expect(screen.getByRole('dialog', { name: /Карточка заявки/ })).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  test('успех: заявки, «Сегодня» и «Команда» перечитываются, карточка закрывается, итог остаётся на экране', async () => {
    const client: QueryClient = makeClient();
    client.setQueryData(queryKeys.team, { stub: true });
    const fetchMock = stubFetchWithFixtures({ 'requests/1/close': ok });
    const user = userEvent.setup();
    renderAt(createElement(App), '/?tab=requests&req=1', client);
    const card = await screen.findByRole('dialog', { name: /Карточка заявки/ });
    await user.click(within(card).getByRole('button', { name: 'Закрыть заявку…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Закрыть заявку' });
    await user.click(within(dialog).getByRole('radio', { name: 'Аннулировать' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Не отвечают' }));
    await user.click(submitBtn(dialog));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Карточка заявки/ })).not.toBeInTheDocument());
    expect(screen.queryByRole('dialog', { name: 'Закрыть заявку' })).not.toBeInTheDocument();
    expect(currentSearch().has('req')).toBe(false);
    expect(screen.getByText('Заявка закрыта: Мария Соколова, аннулирована (не отвечают).')).toBeInTheDocument();
    await waitFor(() => expect(getsOf(fetchMock, 'requests')).toBe(2));
    await waitFor(() => expect(getsOf(fetchMock, 'today')).toBeGreaterThanOrEqual(2));
    expect(client.getQueryState(queryKeys.team)?.isInvalidated).toBe(true);
  });

  test('итог «Обработано» назван в сообщении, а «Другое» не пересказывает комментарий', async () => {
    const { dialog, user } = await openDialog(1, { 'requests/1/close': ok });
    await user.click(within(dialog).getByRole('radio', { name: 'Обработано' }));
    await user.click(submitBtn(dialog));
    expect(await screen.findByText('Заявка закрыта: Мария Соколова, обработана.')).toBeInTheDocument();
  });

  test('сообщение об итоге можно скрыть', async () => {
    const { dialog, user } = await openDialog(1, { 'requests/1/close': ok });
    await user.click(within(dialog).getByRole('radio', { name: 'Аннулировать' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Другое' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Комментарий (обязательно)' }), 'личное: номер 8-900');
    await user.click(submitBtn(dialog));
    const note = await screen.findByText('Заявка закрыта: Мария Соколова, аннулирована (другое).');
    expect(note).not.toHaveTextContent('8-900');
    await user.click(within(note.parentElement!).getByRole('button', { name: 'Скрыть' }));
    expect(screen.queryByText(/Заявка закрыта:/)).not.toBeInTheDocument();
  });
});

describe('Карточка заявки: возврат в работу', () => {
  async function openReopen(overrides: Overrides = {}) {
    const ctx = await openClose(10, overrides);
    const btn = within(ctx.card).getByRole('button', { name: 'Вернуть в работу' });
    return { ...ctx, btn };
  }

  test('у утверждённой заявки вместо «Закрыть» кнопка «Вернуть в работу»', async () => {
    const { card } = await openReopen();
    expect(within(card).queryByRole('button', { name: 'Закрыть заявку…' })).not.toBeInTheDocument();
  });

  test('без подтверждения запрос не уходит: окно говорит, что группа будет снята', async () => {
    const { btn, fetchMock, user } = await openReopen({ 'requests/10/reopen': ok });
    await user.click(btn);
    const dialog = await screen.findByRole('dialog', { name: 'Вернуть в работу?' });
    expect(within(dialog).getByText('Группа будет снята, заявка снова попадёт в подбор.')).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }));
    expect(posts(fetchMock)).toHaveLength(0);
  });

  test('подтверждение шлёт reopen с пустым телом и перечитывает списки', async () => {
    const { btn, fetchMock, user } = await openReopen({ 'requests/10/reopen': ok });
    await user.click(btn);
    const dialog = await screen.findByRole('dialog', { name: 'Вернуть в работу?' });
    await user.click(within(dialog).getByRole('button', { name: 'Вернуть в работу' }));
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1));
    expect(posts(fetchMock)[0]).toMatchObject({ path: 'requests/10/reopen', body: {} });
    await waitFor(() => expect(getsOf(fetchMock, 'requests')).toBe(2));
    await waitFor(() => expect(getsOf(fetchMock, 'today')).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Вернуть в работу?' })).not.toBeInTheDocument());
    expect(await screen.findByText('Заявка возвращена в работу.')).toBeInTheDocument();
  });

  test('двойное нажатие подтверждения шлёт один запрос', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { btn, fetchMock, user } = await openReopen({
      'requests/10/reopen': async () => {
        await gate;
        return ok();
      },
    });
    await user.click(btn);
    const dialog = await screen.findByRole('dialog', { name: 'Вернуть в работу?' });
    await user.dblClick(within(dialog).getByRole('button', { name: 'Вернуть в работу' }));
    expect(posts(fetchMock)).toHaveLength(1);
    release();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Вернуть в работу?' })).not.toBeInTheDocument());
    expect(posts(fetchMock)).toHaveLength(1);
  });

  test('ошибка сервера показывается его текстом в окне, окно остаётся', async () => {
    const { btn, user } = await openReopen({
      'requests/10/reopen': () => json({ error: 'bad_request', message: 'Заявка и так в работе.' }, 400),
    });
    await user.click(btn);
    const dialog = await screen.findByRole('dialog', { name: 'Вернуть в работу?' });
    await user.click(within(dialog).getByRole('button', { name: 'Вернуть в работу' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Заявка и так в работе.');
  });
});

import { act, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { stubFetchWithFixtures } from '../../test/render';
import { fail, fixtureItem, getsOf, json, ok, openCard, posts, viewWith } from './requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

const TIME = 'Изменить удобные день и время';
const STREET = 'Изменить улицу и дом';

/** Заявка 1 (бот): время «вт, чт вечером» из анкеты, улица тоже из анкеты. */
describe('«Заявки»: параметры подбора, карандаш', () => {
  test('фразы «Менять параметры можно будет на следующем этапе» больше нет', async () => {
    const card = await openCard(1);
    expect(within(card).queryByText(/на следующем этапе/)).not.toBeInTheDocument();
  });

  test('у времени и улицы есть карандаш, у района и возраста — нет', async () => {
    const card = await openCard(1);
    expect(within(card).getByRole('button', { name: TIME })).toBeEnabled();
    expect(within(card).getByRole('button', { name: STREET })).toBeEnabled();
    expect(within(card).queryByRole('button', { name: /Изменить район/ })).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /Изменить возраст/ })).not.toBeInTheDocument();
  });

  test('у утверждённой заявки карандашей нет: менять уже нечего', async () => {
    const card = await openCard(10);
    expect(within(card).queryByRole('button', { name: TIME })).not.toBeInTheDocument();
  });

  test('карандаш превращает строку в поле ввода с подсказкой и ограничением в 200 знаков', async () => {
    const user = userEvent.setup();
    const card = await openCard(2);
    await user.click(within(card).getByRole('button', { name: TIME }));
    const input = within(card).getByRole('textbox', { name: 'Удобные день и время' });
    expect(input).toHaveAttribute('placeholder', 'например: пн, ср вечером');
    expect(input).toHaveAttribute('maxlength', '200');
    expect(input).toHaveFocus();
    await user.click(within(card).getByRole('button', { name: 'Отмена' }));
    await user.click(within(card).getByRole('button', { name: STREET }));
    expect(within(card).getByRole('textbox', { name: 'Улица, дом' })).toHaveAttribute('placeholder', 'например: ул. Рылеева 32');
  });

  test('«Сохранить» шлёт POST только с улицей, когда менялась улица', async () => {
    const fetchMock = stubFetchWithFixtures({ 'requests/2/params': ok });
    const user = userEvent.setup();
    const card = await openCard(2);
    await user.click(within(card).getByRole('button', { name: STREET }));
    await user.type(within(card).getByRole('textbox', { name: 'Улица, дом' }), '  ул. Рылеева 32 ');
    await user.click(within(card).getByRole('button', { name: 'Сохранить' }));
    expect(await within(card).findByText('Сохранено: улица и дом.')).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(1);
    expect(posts(fetchMock)[0]).toMatchObject({ path: 'requests/2/params', body: { street: 'ул. Рылеева 32' } });
    expect(Object.keys(posts(fetchMock)[0]!.body)).toEqual(['street']);
    // поле закрыто, список перечитан
    expect(within(card).queryByRole('textbox', { name: 'Улица, дом' })).not.toBeInTheDocument();
    await waitFor(() => expect(getsOf(fetchMock, 'requests')).toBe(2));
    expect(getsOf(fetchMock, 'today')).toBeGreaterThanOrEqual(1);
  });

  test('«Сохранить» шлёт POST только с временем, когда менялось время', async () => {
    const fetchMock = stubFetchWithFixtures({ 'requests/2/params': ok });
    const user = userEvent.setup();
    const card = await openCard(2);
    await user.click(within(card).getByRole('button', { name: TIME }));
    await user.type(within(card).getByRole('textbox', { name: 'Удобные день и время' }), 'пн, ср вечером');
    await user.click(within(card).getByRole('button', { name: 'Сохранить' }));
    expect(await within(card).findByText('Сохранено: удобные день и время.')).toBeInTheDocument();
    expect(posts(fetchMock)[0]).toMatchObject({ path: 'requests/2/params', body: { schedule: 'пн, ср вечером' } });
    expect(Object.keys(posts(fetchMock)[0]!.body)).toEqual(['schedule']);
  });

  test('пока текст не изменён или пуст, «Сохранить» отключена', async () => {
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: TIME }));
    const save = within(card).getByRole('button', { name: 'Сохранить' });
    // в поле подставлен текущий ответ человека
    expect(within(card).getByRole('textbox', { name: 'Удобные день и время' })).toHaveValue('вт, чт вечером');
    expect(save).toBeDisabled();
    await user.clear(within(card).getByRole('textbox', { name: 'Удобные день и время' }));
    expect(save).toBeDisabled();
  });

  test('«Отмена» закрывает поле и ничего не отправляет', async () => {
    const fetchMock = stubFetchWithFixtures();
    const user = userEvent.setup();
    const card = await openCard(2);
    await user.click(within(card).getByRole('button', { name: TIME }));
    await user.type(within(card).getByRole('textbox', { name: 'Удобные день и время' }), 'вс');
    await user.click(within(card).getByRole('button', { name: 'Отмена' }));
    expect(within(card).queryByRole('textbox', { name: 'Удобные день и время' })).not.toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  test('«Убрать мою правку» шлёт null и есть только там, где значение поправил координатор', async () => {
    const base = fixtureItem(2);
    const fetchMock = stubFetchWithFixtures({
      'requests/2/params': ok,
      requests: () => json(viewWith(2, { scheduleInfo: { text: 'сб утром', source: 'manual' }, streetInfo: base.streetInfo })),
    });
    const user = userEvent.setup();
    const card = await openCard(2);
    await user.click(await within(card).findByRole('button', { name: TIME }));
    await user.click(within(card).getByRole('button', { name: 'Убрать мою правку' }));
    expect(await within(card).findByText('Правка убрана: удобные день и время.')).toBeInTheDocument();
    expect(posts(fetchMock)[0]).toMatchObject({ path: 'requests/2/params', body: { schedule: null } });
    expect(Object.keys(posts(fetchMock)[0]!.body)).toEqual(['schedule']);

    // у улицы правки координатора нет: кнопки «Убрать» там не будет
    await user.click(within(card).getByRole('button', { name: STREET }));
    expect(within(card).queryByRole('button', { name: 'Убрать мою правку' })).not.toBeInTheDocument();
  });

  test('двойное нажатие «Сохранить» отправляет один запрос, пока первый не завершён', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchMock = stubFetchWithFixtures({
      'requests/2/params': async () => {
        await gate;
        return ok();
      },
    });
    const user = userEvent.setup();
    const card = await openCard(2);
    await user.click(within(card).getByRole('button', { name: STREET }));
    await user.type(within(card).getByRole('textbox', { name: 'Улица, дом' }), 'ул. Рылеева 32');
    const save = within(card).getByRole('button', { name: 'Сохранить' });
    await user.dblClick(save);
    expect(posts(fetchMock)).toHaveLength(1);
    expect(within(card).getByRole('button', { name: 'Сохраняем…' })).toBeDisabled();
    expect(within(card).getByRole('button', { name: 'Отмена' })).toBeDisabled();
    release();
    await within(card).findByText('Сохранено: улица и дом.');
    expect(posts(fetchMock)).toHaveLength(1);
  });

  test('два нажатия «Сохранить» до перерисовки тоже дают один запрос: кнопка ещё не успела отключиться', async () => {
    const fetchMock = stubFetchWithFixtures({ 'requests/2/params': ok });
    const user = userEvent.setup();
    const card = await openCard(2);
    await user.click(within(card).getByRole('button', { name: STREET }));
    await user.type(within(card).getByRole('textbox', { name: 'Улица, дом' }), 'ул. Рылеева 32');
    const save = within(card).getByRole('button', { name: 'Сохранить' });
    act(() => {
      save.click();
      save.click();
    });
    await within(card).findByText('Сохранено: улица и дом.');
    expect(posts(fetchMock)).toHaveLength(1);
  });

  test('ошибка сохранения показана понятным текстом, введённое не пропадает', async () => {
    stubFetchWithFixtures({ 'requests/2/params': fail(400, 'bad_request') });
    const user = userEvent.setup();
    const card = await openCard(2);
    await user.click(within(card).getByRole('button', { name: STREET }));
    await user.type(within(card).getByRole('textbox', { name: 'Улица, дом' }), 'ул. Рылеева 32');
    await user.click(within(card).getByRole('button', { name: 'Сохранить' }));
    const alert = await within(card).findByRole('alert');
    expect(alert).toHaveTextContent('не длиннее 200 знаков');
    expect(alert).not.toHaveTextContent('служебный текст сервера');
    expect(within(card).getByRole('textbox', { name: 'Улица, дом' })).toHaveValue('ул. Рылеева 32');
    expect(within(card).getByRole('button', { name: 'Сохранить' })).toBeEnabled();
  });

  test('«заявку уже обработали» и обрыв сети объясняются своими словами', async () => {
    stubFetchWithFixtures({ 'requests/2/params': fail(409, 'already_closed') });
    const user = userEvent.setup();
    const card = await openCard(2);
    await user.click(within(card).getByRole('button', { name: TIME }));
    await user.type(within(card).getByRole('textbox', { name: 'Удобные день и время' }), 'вс');
    await user.click(within(card).getByRole('button', { name: 'Сохранить' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('Заявку уже обработали');
  });
});

describe('«Заявки»: откуда значение и как его поняла система', () => {
  test('время из анкеты: слова человека, источник и «Понято как: Вт, Чт · вечер»', async () => {
    const card = await openCard(1);
    expect(within(card).getByText('вт, чт вечером')).toBeInTheDocument();
    expect(within(card).getAllByText('со слов человека (анкета)').length).toBeGreaterThanOrEqual(1);
    expect(within(card).getByText('Понято как: Вт, Чт · вечер')).toBeInTheDocument();
  });

  test('правка координатора подписана «поправил координатор»', async () => {
    stubFetchWithFixtures({
      requests: () => json(viewWith(1, { streetInfo: { text: 'ул. Рылеева 32', source: 'manual' }, street: 'ул. Рылеева 32' })),
    });
    const card = await openCard(1);
    expect(await within(card).findByText('ул. Рылеева 32')).toBeInTheDocument();
    expect(within(card).getByText('поправил координатор')).toBeInTheDocument();
  });

  test('если система не разобрала слова человека, об этом сказано и дан пример, как записать', async () => {
    const card = await openCard(8);
    expect(within(card).getByText('как получится, лучше ближе к выходным')).toBeInTheDocument();
    expect(
      within(card).getByText('Система не смогла разобрать — запишите дни и время проще, например «пн, ср вечером»'),
    ).toBeInTheDocument();
    expect(within(card).queryByText(/Понято как/)).not.toBeInTheDocument();
  });

  test('если времени нет вовсе, ни источника, ни «Понято как» не показано', async () => {
    const card = await openCard(2);
    expect(within(card).queryByText(/Понято как/)).not.toBeInTheDocument();
    expect(within(card).queryByText('со слов человека (анкета)')).not.toBeInTheDocument();
  });
});

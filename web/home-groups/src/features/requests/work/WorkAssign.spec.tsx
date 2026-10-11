import { waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { stubFetchWithFixtures } from '../../../test/render';
import { fail, getsOf, json, ok, openCard, posts, viewWith } from '../requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

async function openAssign(id = 1, overrides: Record<string, () => Response | Promise<Response>> = {}, responsible: string | null = 'Трофимова С.') {
  const fetchMock = stubFetchWithFixtures({ requests: () => json(viewWith(id, { responsible })), ...overrides });
  const card = await openCard(id);
  const section = await within(card).findByRole('region', { name: 'В работе у' });
  // Список координаторов приходит отдельным запросом: ждём, пока он появится
  await within(section).findByRole('option', { name: 'Петров Г.' });
  return { fetchMock, card, section, select: within(section).getByRole('combobox', { name: 'В работе у' }) };
}

describe('Карточка заявки: «В работе у»', () => {
  test('показывает текущего координатора и пункт «Никто» среди справочника', async () => {
    const { select, section } = await openAssign();
    expect(select).toHaveValue('Трофимова С.');
    const names = within(section).getAllByRole('option').map((o) => o.textContent);
    expect(names).toEqual(['Никто', 'Трофимова С.', 'Петров Г.', 'Лебедева А.', 'Морозов Д.']);
  });

  test('текущий, которого нет в справочнике, всё равно виден как значение', async () => {
    const { select, section } = await openAssign(1, {}, 'Бывший Служитель К.');
    expect(select).toHaveValue('Бывший Служитель К.');
    expect(within(section).getByRole('option', { name: 'Бывший Служитель К.' })).toBeInTheDocument();
  });

  test('если никто не назначен, выбран «Никто»', async () => {
    const { select } = await openAssign(1, {}, null);
    expect(select).toHaveValue('');
  });

  test('выбор координатора сразу шлёт POST assign с его именем и перечитывает списки', async () => {
    const user = userEvent.setup();
    const { fetchMock, section, select } = await openAssign(1, { 'requests/1/assign': ok });
    await user.selectOptions(select, 'Петров Г.');
    expect(await within(section).findByText('В работе у: Петров Г.')).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(1);
    expect(posts(fetchMock)[0]).toMatchObject({ path: 'requests/1/assign', body: { responsible: 'Петров Г.' } });
    await waitFor(() => expect(getsOf(fetchMock, 'requests')).toBe(2));
    // и то и другое читалось при открытии карточки, поэтому ждём второе чтение, а не первое
    await waitFor(() => expect(getsOf(fetchMock, 'today')).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(getsOf(fetchMock, 'groups')).toBeGreaterThanOrEqual(2));
  });

  test('«Никто» снимает назначение: responsible равен null', async () => {
    const user = userEvent.setup();
    const { fetchMock, section, select } = await openAssign(1, { 'requests/1/assign': ok });
    await user.selectOptions(select, 'Никто');
    expect(await within(section).findByText('Заявка ни у кого не в работе.')).toBeInTheDocument();
    expect(posts(fetchMock)[0]!.body).toEqual({ responsible: null });
  });

  test('пока запрос идёт, выбор заблокирован', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { select, fetchMock } = await openAssign(1, {
      'requests/1/assign': async () => {
        await gate;
        return ok();
      },
    });
    await user.selectOptions(select, 'Петров Г.');
    await waitFor(() => expect(select).toBeDisabled());
    expect(posts(fetchMock)).toHaveLength(1);
    release();
    await waitFor(() => expect(select).toBeEnabled());
  });

  test('ошибка bad_request показывается текстом сервера, а выбор возвращается к прежнему', async () => {
    const user = userEvent.setup();
    const { section, select } = await openAssign(1, {
      'requests/1/assign': () => json({ error: 'bad_request', message: 'Имя координатора слишком длинное.' }, 400),
    });
    await user.selectOptions(select, 'Петров Г.');
    expect(await within(section).findByRole('alert')).toHaveTextContent('Имя координатора слишком длинное.');
    expect(select).toHaveValue('Трофимова С.');
  });

  test('сбой сети объясняется словами, служебный текст не показывается', async () => {
    const user = userEvent.setup();
    const { section, select } = await openAssign(1, { 'requests/1/assign': fail(500, 'bad_request_x') });
    await user.selectOptions(select, 'Петров Г.');
    const alert = await within(section).findByRole('alert');
    expect(alert).not.toHaveTextContent('служебный текст сервера');
    expect(alert).toHaveTextContent('Не получилось сохранить');
  });

  test('если справочник не загрузился, об этом сказано и есть «Повторить»', async () => {
    stubFetchWithFixtures({ 'form-meta': fail(500, 'x') });
    const card = await openCard(1);
    const section = await within(card).findByRole('region', { name: 'В работе у' }, { timeout: 4000 });
    expect(await within(section).findByText('Не удалось загрузить список координаторов.', undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });
});

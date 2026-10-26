import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { renderAt, stubFetchWithFixtures } from '../../test/render';
import { json, posts } from '../../test/calls';

afterEach(() => vi.unstubAllGlobals());

const rowOf = async (fio: string) => {
  const list = await screen.findByRole('list', { name: 'Список заявок' });
  return within(list).getAllByRole('listitem').find((li) => li.textContent?.includes(fio))!;
};

describe('пол человека', () => {
  test('в списке заявок у человека без пола — пометка «Пол не указан», у остальных её нет', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests');
    expect(within(await rowOf('Станислав Ким')).getByText('Пол не указан')).toBeInTheDocument();
    expect(within(await rowOf('Мария Соколова')).queryByText('Пол не указан')).not.toBeInTheDocument();
  });

  test('в карточке заявки пустой пол подсвечен; «М» отправляет пол по ключу человека заявки', async () => {
    const fetchMock = stubFetchWithFixtures({ 'people/gender': () => json({ ok: true }) });
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests&req=8');
    const card = await screen.findByRole('dialog', { name: /Станислав Ким/ });
    expect(within(card).getByText(/Пол не указан: по ФИО не понять/)).toBeInTheDocument();
    const gender = within(card).getByRole('group', { name: 'Пол' });
    expect(within(gender).getByRole('button', { name: 'М' })).toHaveAttribute('aria-pressed', 'false');
    // Пол «из ФИО» вернуть нечего: кнопки «Брать из ФИО» у пустого нет.
    expect(within(card).queryByRole('button', { name: 'Брать из ФИО' })).not.toBeInTheDocument();
    await user.click(within(gender).getByRole('button', { name: 'М' }));
    await waitFor(() => expect(posts(fetchMock)).toContainEqual({ path: 'people/gender', body: { key: 'r8', gender: 'м' } }));
  });

  test('пол из ФИО отмечен нажатой кнопкой и подписан, подсветки нет', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests&req=1');
    const card = await screen.findByRole('dialog', { name: /Мария Соколова/ });
    expect(within(within(card).getByRole('group', { name: 'Пол' })).getByRole('button', { name: 'Ж' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(card).getByText('Определён по ФИО')).toBeInTheDocument();
    expect(within(card).queryByText(/Пол не указан/)).not.toBeInTheDocument();
  });

  test('в карточке человека видно, откуда пол; поставленный помощником можно вернуть к ФИО', async () => {
    const fetchMock = stubFetchWithFixtures({ 'people/gender': () => json({ ok: true }) });
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference&ent=people&rec=u1');
    const card = await screen.findByRole('dialog', { name: /Дарья Ефимова/ });
    expect(within(card).getByText('Подсказка помощника — проверьте')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Брать из ФИО' }));
    await waitFor(() => expect(posts(fetchMock)).toContainEqual({ path: 'people/gender', body: { key: 'u1', gender: null } }));
  });

  test('«Подсказать пол помощником» — только полному входу; итог показывается', async () => {
    stubFetchWithFixtures({ me: () => json({ role: 'admin' }) });
    renderAt(<App />, '/?tab=reference&ent=people');
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: /Подсказать пол помощником/ })).not.toBeInTheDocument();
  });

  test('полный вход запускает прогон и видит, сколько заполнено', async () => {
    const fetchMock = stubFetchWithFixtures({
      me: () => json({ role: 'super' }),
      'people/gender-ai': () => json({ ok: true, unknownBefore: 1, filled: 1, left: 0 }),
    });
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference&ent=people');
    await user.click(await screen.findByRole('button', { name: /Подсказать пол помощником \(1\)/ }));
    expect(await screen.findByText(/Помощник заполнил пол: 1\. Без пола никого не осталось/)).toBeInTheDocument();
    expect(posts(fetchMock).map((p) => p.path)).toContain('people/gender-ai');
  });
});

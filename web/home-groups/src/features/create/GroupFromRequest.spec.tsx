import type { GroupDraftView } from '@contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../test/render';
import { json, posts } from '../../test/calls';

afterEach(() => vi.unstubAllGlobals());

/** Обращение 208 в демо — «Уже ведёт группу»: человек, который потом решил открыть свою. */
const LEADER = 208;
const draft = (patch: Partial<GroupDraftView> = {}): GroupDraftView => ({
  requestId: LEADER,
  fio: 'Олег Кравцов',
  ownGroup: null,
  fields: {
    leader: 'Олег Кравцов', phone: '+7 921 000 22 33', status: 'Потенциальная', format: 'Основная церковь',
    district: 'Приморский', age: '25-40', address: 'Савушкина 5', day: 'Ср', comment: 'Заведена по заявке №208 («Уже ведёт группу»).',
  },
  ...patch,
});

async function openCard(url = `/?tab=requests&view=others&req=${LEADER}`) {
  renderAt(<App />, url);
  return screen.findByRole('dialog', { name: /Карточка обращения|Обращение/ });
}

describe('«Создать группу по заявке»', () => {
  test('в карточке обращения кнопка открывает «Новую группу», заполненную по заявке; уходит и номер заявки', async () => {
    const fetchMock = stubFetchWithFixtures({
      [`requests/${LEADER}/group-draft`]: () => json(draft()),
      'groups/create': () => json({ ok: true, id: 57 }),
    });
    const user = userEvent.setup();
    const card = await openCard();
    const section = within(card).getByRole('heading', { name: 'Группа по заявке' }).closest('section')!;
    await user.click(within(section).getByRole('button', { name: 'Создать группу по заявке' }));

    const dialog = await screen.findByRole('dialog', { name: 'Новая группа по заявке: Олег Кравцов' });
    expect(await within(dialog).findByRole('textbox', { name: 'ФИО ведущего' })).toHaveValue('Олег Кравцов');
    expect(within(dialog).getByRole('combobox', { name: 'Район' })).toHaveValue('Приморский');
    expect(within(dialog).getByRole('combobox', { name: 'Статус' })).toHaveValue('Потенциальная');
    expect(within(dialog).getByRole('combobox', { name: 'День' })).toHaveValue('Ср');
    // Ведущий уже известен — это человек из заявки, выбирать из зарегистрированных незачем.
    expect(within(dialog).queryByRole('combobox', { name: /Подобрать из зарегистрированных/ })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Создать группу' }));
    await waitFor(() => expect(posts(fetchMock).map((p) => p.path)).toEqual(['groups/create']));
    expect(posts(fetchMock)[0]!.body.fields).toMatchObject({
      sourceRequestId: String(LEADER), leader: 'Олег Кравцов', district: 'Приморский', status: 'Потенциальная', day: 'Ср', address: 'Савушкина 5',
    });
    expect(await within(section).findByText('Группа ДГ-0057 заведена.')).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'Открыть группу ДГ-0057' }));
    // Открывается карточка новой группы (как у остальных ссылок на группу в интерфейсе).
    expect(currentSearch().get('rec')).toBe('57');
  });

  test('по «хочу открыть» группа уже заведена сама: вместо кнопки — ссылка на неё', async () => {
    stubFetchWithFixtures();
    const card = await openCard('/?tab=requests&view=leads&req=213');
    const section = within(card).getByRole('heading', { name: 'Группа по заявке' }).closest('section')!;
    expect(within(section).getByText('По этой заявке заведена группа ДГ-0112.')).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: 'Открыть группу ДГ-0112' })).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'Создать группу по заявке' })).not.toBeInTheDocument();
  });

  test('если по заявке группу уже завели, сервер отказывает, и его слова видны в форме', async () => {
    stubFetchWithFixtures({
      [`requests/${LEADER}/group-draft`]: () => json(draft()),
      'groups/create': () => json({ error: 'conflict', message: 'По этой заявке группа уже заведена: ДГ-0057.' }, 409),
    });
    const user = userEvent.setup();
    const card = await openCard();
    await user.click(within(card).getByRole('button', { name: 'Создать группу по заявке' }));
    const dialog = await screen.findByRole('dialog', { name: 'Новая группа по заявке: Олег Кравцов' });
    await within(dialog).findByRole('textbox', { name: 'ФИО ведущего' });
    await user.click(within(dialog).getByRole('button', { name: 'Создать группу' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('По этой заявке группа уже заведена: ДГ-0057.');
  });

  test('кнопка есть и в карточке заявки «хочу в группу»', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests&req=1');
    const card = await screen.findByRole('dialog', { name: /Карточка заявки/ });
    expect(await within(card).findByRole('button', { name: 'Создать группу по заявке' })).toBeInTheDocument();
  });
});

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { renderAt, stubFetchWithFixtures } from '../../test/render';
import { json } from '../../test/calls';
import { groupsWith, openCard, viewWith } from '../requests/requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

/**
 * Сервер скрыл контакты (запись не своя): вместо номера — последние цифры, позвонить по ним нельзя, а рядом сказано,
 * как номер открыть. Полей с контактами в формах правки нет — маска не должна затереть настоящий номер.
 */
describe('скрытые контакты заявки', () => {
  const hidden = { contactsHidden: true, phone: '… 22-33', street: null, hobby: null, profession: null, family: null };

  test('в карточке — последние цифры и подсказка «возьмите себе»; ссылок «позвонить» и «написать» нет', async () => {
    stubFetchWithFixtures({ requests: () => json(viewWith(1, hidden)) });
    const card = await openCard(1);
    expect(card).toHaveTextContent('… 22-33 · номер откроется, когда возьмёте заявку себе («В работе у»)');
    expect(within(card).queryByRole('link', { name: /^Позвонить/ })).not.toBeInTheDocument();
    expect(within(card).queryByRole('link', { name: /^Написать/ })).not.toBeInTheDocument();
  });

  test('в «Править данные» нет телефона, адреса, хобби и профессии, а под полями сказано почему', async () => {
    stubFetchWithFixtures({ requests: () => json(viewWith(1, hidden)) });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: /^Править данные/ }));
    const dialog = await screen.findByRole('dialog', { name: /Правка данных|Править/ });
    expect(within(dialog).getByRole('textbox', { name: 'ФИО' })).toBeInTheDocument();
    for (const name of ['Телефон', 'Улица и дом', 'Хобби', 'Профессия']) expect(within(dialog).queryByRole('textbox', { name })).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent('видны тому, у кого заявка «в работе»');
  });

  test('своя заявка — как раньше: номер целиком и ссылка «позвонить»', async () => {
    stubFetchWithFixtures();
    const card = await openCard(1);
    expect(within(card).getByRole('link', { name: /^Позвонить/ })).toHaveAttribute('href', expect.stringMatching(/^tel:\+7/));
  });
});

describe('скрытые телефоны чужой группы', () => {
  test('в карточке — последние цифры с пояснением; в форме правки нет телефонов, а адрес есть', async () => {
    stubFetchWithFixtures({ groups: () => json(groupsWith(1, { contactsHidden: true, phone: '… 31-45', coLeaderPhone: null })) });
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=reference&rec=1');
    const card = await screen.findByRole('dialog', { name: /Карточка группы/ });
    expect(card).toHaveTextContent('… 31-45 · телефоны видны координатору группы и тому, кто утвердил в неё человека');
    expect(card).toHaveTextContent('Телефоны ведущих и состава этой группы скрыты');
    await user.click(within(card).getByRole('button', { name: /^Править группу/ }));
    const dialog = await screen.findByRole('dialog', { name: /^Правка группы/ });
    await within(dialog).findByRole('combobox', { name: 'Район' });
    expect(within(dialog).queryByRole('textbox', { name: 'Телефон' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: 'Телефон соведущего' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Адрес' })).toBeInTheDocument();
  });
});

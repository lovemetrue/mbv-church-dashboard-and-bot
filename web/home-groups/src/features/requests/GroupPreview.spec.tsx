import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { currentSearch, stubFetchWithFixtures } from '../../test/render';
import { openCard, posts } from './requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

/** Заявка 1: главная ДГ-0012 (Ольга К.), запасная ДГ-0019 (Дмитрий В.). */
describe('«Заявки»: карточка предложенной группы — поверх заявки, только для просмотра', () => {
  test('у главного и запасного варианта есть «Карточка группы»: окно с данными группы, вкладка и заявка не меняются', async () => {
    const fetchMock = stubFetchWithFixtures();
    const user = userEvent.setup();
    const card = await openCard(1);
    const before = currentSearch().toString();
    await user.click(within(card).getByRole('button', { name: 'Карточка группы ДГ-0019' }));
    const preview = await screen.findByRole('dialog', { name: 'Группа ДГ-0019' });
    expect(preview).toHaveTextContent('Дмитрий В.');
    expect(within(preview).getByText('Когда', { selector: 'dt' })).toBeInTheDocument();
    expect(within(preview).getByText('Места', { selector: 'dt' })).toBeInTheDocument();
    expect(preview).toHaveTextContent('Только просмотр');
    // Ни правки, ни удаления, ни переходов: только чтение.
    expect(within(preview).queryByRole('button', { name: /^Править/ })).not.toBeInTheDocument();
    expect(within(preview).queryByRole('button', { name: /Удалить/ })).not.toBeInTheDocument();
    expect(within(preview).queryByRole('button', { name: /Добавить человека/ })).not.toBeInTheDocument();
    expect(currentSearch().toString()).toBe(before);
    expect(posts(fetchMock)).toEqual([]);

    await user.click(within(preview).getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog', { name: 'Группа ДГ-0019' })).not.toBeInTheDocument();
    expect(card).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Карточка группы ДГ-0012' })).toBeInTheDocument();
  });

  test('Esc закрывает только окно группы, карточка заявки остаётся открытой', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: 'Карточка группы ДГ-0012' }));
    await screen.findByRole('dialog', { name: 'Группа ДГ-0012' });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Группа ДГ-0012' })).not.toBeInTheDocument();
    expect(card).toBeInTheDocument();
    expect(currentSearch().get('req')).toBe('1');
  });

  test('в окне «Выбрать другую группу» у каждой группы есть «Карточка группы»; Esc закрывает только её, выбор не сбрасывается', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: 'Выбрать другую группу из списка' }));
    const picker = await screen.findByRole('dialog', { name: 'Другая группа' });
    const radios = await within(picker).findAllByRole('radio');
    const enabled = radios.find((r) => !(r as HTMLInputElement).disabled)!;
    await user.click(enabled);
    const previewButtons = within(picker).getAllByRole('button', { name: /^Карточка группы ДГ-/ });
    expect(previewButtons.length).toBeGreaterThan(1);
    await user.click(previewButtons[0]!);
    const code = previewButtons[0]!.getAttribute('aria-label')!.replace('Карточка группы ', '');
    await screen.findByRole('dialog', { name: `Группа ${code}` });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: `Группа ${code}` })).not.toBeInTheDocument();
    expect(picker).toBeInTheDocument();
    expect(enabled).toBeChecked();
  });
});

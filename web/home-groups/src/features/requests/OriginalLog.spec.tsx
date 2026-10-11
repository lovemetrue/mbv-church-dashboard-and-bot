import { within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { stubFetchWithFixtures } from '../../test/render';
import { json, openCard, viewWith } from './requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

describe('«Заявки»: журнал, запись «Заявка создана»', () => {
  test('по клику раскрывается: что заполнил человек и как система это поняла, рядом, без догадок', async () => {
    const user = userEvent.setup();
    const card = await openCard(1);
    const toggle = within(card).getByRole('button', { name: /Заявка создана ботом/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(card).queryByText('Что заполнил человек')).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const filledTitle = within(card).getByText('Что заполнил человек');
    const filled = filledTitle.nextElementSibling as HTMLElement;
    expect(within(filled).getByText('Удобные день и время')).toBeInTheDocument();
    expect(within(filled).getByText('вт, чт вечером')).toBeInTheDocument();
    expect(within(filled).getByText('Где удобно')).toBeInTheDocument();

    const understood = within(card).getByText('Как система это поняла').nextElementSibling as HTMLElement;
    expect(within(understood).getByText('Приморский')).toBeInTheDocument();
    expect(within(understood).getByText('18–25')).toBeInTheDocument();
    expect(within(understood).getByText('Вт, Чт · вечер')).toBeInTheDocument();
    expect(within(understood).getByText('Комендантский пр.')).toBeInTheDocument();
  });

  test('повторный клик сворачивает запись', async () => {
    const user = userEvent.setup();
    const card = await openCard(1);
    const toggle = within(card).getByRole('button', { name: /Заявка создана ботом/ });
    await user.click(toggle);
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(card).queryByText('Как система это поняла')).not.toBeInTheDocument();
  });

  test('если анкеты нет, показано пояснение, а «как поняла система» всё равно есть', async () => {
    const user = userEvent.setup();
    const card = await openCard(5);
    await user.click(within(card).getByRole('button', { name: /Заявка перенесена из таблицы?/ }));
    expect(within(card).getByText('Данных из анкеты нет: заявка заведена вручную или из таблицы.')).toBeInTheDocument();
    expect(within(card).getByText('Как система это поняла')).toBeInTheDocument();
  });

  test('что система не определила, названо прямо: район, дни и время, улица', async () => {
    const user = userEvent.setup();
    const card = await openCard(8);
    await user.click(within(card).getByRole('button', { name: /Заявка создана ботом/ }));
    const understood = within(card).getByText('Как система это поняла').nextElementSibling as HTMLElement;
    expect(within(understood).getByText('не определён')).toBeInTheDocument();
    expect(within(understood).getByText('не указано')).toBeInTheDocument();
    expect(within(understood).getByText('не указана')).toBeInTheDocument();
    // слова человека о времени рядом, чтобы он сам сверил
    const filled = within(card).getByText('Что заполнил человек').nextElementSibling as HTMLElement;
    expect(within(filled).getByText('как получится, лучше ближе к выходным')).toBeInTheDocument();
  });

  test('остальные записи журнала раскрыть нельзя: у них нет кнопки', async () => {
    const card = await openCard(3);
    const buttons = within(card).getAllByRole('button', { name: /Заявка|Служитель/ });
    expect(buttons).toHaveLength(1);
    expect(within(card).getByText('Служитель просмотрел заявку')).toBeInTheDocument();
  });

  test('раскрытая запись остаётся открытой, когда список заявок перечитался', async () => {
    stubFetchWithFixtures({ requests: () => json(viewWith(1, {})) });
    const user = userEvent.setup();
    const card = await openCard(1);
    await user.click(within(card).getByRole('button', { name: /Заявка создана ботом/ }));
    expect(within(card).getByText('Что заполнил человек')).toBeInTheDocument();
  });
});

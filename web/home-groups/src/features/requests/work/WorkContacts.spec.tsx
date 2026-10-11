import { waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { stubFetchWithFixtures } from '../../../test/render';
import { json, openCard, viewWith } from '../requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

const PHONE = '+7 921 555-00-11';

/** Заявка 1 с телефоном в том виде, в каком его отдаёт сервер. */
async function openWithPhone(id = 1, phone: string | null = PHONE) {
  stubFetchWithFixtures({ requests: () => json(viewWith(id, { phone })) });
  const card = await openCard(id);
  const section = await within(card).findByRole('region', { name: 'Связаться' });
  return { card, section };
}

describe('Карточка заявки: связь с человеком', () => {
  test('«Позвонить» — ссылка tel: только с плюсом и цифрами', async () => {
    const { section } = await openWithPhone();
    expect(within(section).getByRole('link', { name: 'Позвонить' })).toHaveAttribute('href', 'tel:+79215550011');
  });

  test('«Написать» — ссылка sms: с тем же номером', async () => {
    const { section } = await openWithPhone();
    expect(within(section).getByRole('link', { name: 'Написать' })).toHaveAttribute('href', 'sms:+79215550011');
  });

  test('номер с восьмёрки в ссылке приводится к +7', async () => {
    const { section } = await openWithPhone(1, '89215550011');
    expect(within(section).getByRole('link', { name: 'Позвонить' })).toHaveAttribute('href', 'tel:+79215550011');
  });

  test('«Скопировать номер» кладёт номер в буфер и подтверждает через живую область', async () => {
    const user = userEvent.setup();
    const { section } = await openWithPhone();
    const status = section.querySelector('[aria-live="polite"]')!;
    expect(status).toHaveTextContent('');
    await user.click(within(section).getByRole('button', { name: 'Скопировать номер' }));
    await waitFor(() => expect(status).toHaveTextContent('Скопировано'));
    expect(await navigator.clipboard.readText()).toBe('+79215550011');
  });

  test('если скопировать нельзя, карточка не падает и говорит об этом словами', async () => {
    const user = userEvent.setup();
    const { section } = await openWithPhone();
    // user-event подставляет буфер при setup(): убираем его и запасной способ тоже
    vi.stubGlobal('navigator', {});
    Object.defineProperty(document, 'execCommand', { value: undefined, configurable: true });
    await user.click(within(section).getByRole('button', { name: 'Скопировать номер' }));
    await waitFor(() => expect(section.querySelector('[aria-live="polite"]')).toHaveTextContent(/Не удалось скопировать/));
    expect(within(section).getByRole('link', { name: 'Позвонить' })).toBeInTheDocument();
  });

  test('без телефона вместо кнопок — подсказка, куда его добавить', async () => {
    const { section } = await openWithPhone(1, null);
    expect(within(section).getByText('Телефона нет — добавьте его через «Править данные»')).toBeInTheDocument();
    expect(within(section).queryByRole('link', { name: 'Позвонить' })).not.toBeInTheDocument();
    expect(within(section).queryByRole('link', { name: 'Написать' })).not.toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'Скопировать номер' })).not.toBeInTheDocument();
  });

  test('у закрытой заявки без телефона подсказка не зовёт править данные: править уже нельзя', async () => {
    const { section } = await openWithPhone(10, null);
    expect(within(section).getByText('Телефона нет.')).toBeInTheDocument();
    expect(within(section).queryByText(/Править данные/)).not.toBeInTheDocument();
  });

  test('у закрытой заявки с телефоном связаться по-прежнему можно', async () => {
    const { section } = await openWithPhone(10);
    expect(within(section).getByRole('link', { name: 'Позвонить' })).toHaveAttribute('href', 'tel:+79215550011');
  });
});

import type { RequestItem } from '@contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildRequests } from '../../fixtures/build';
import { currentSearch, renderAt, stubFetchWithFixtures } from '../../test/render';
import { countBuckets, filterByBucket } from './model';
import { fixtureItem, json, ok, viewWith } from './requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

const rowNames = () =>
  within(screen.getByRole('list', { name: 'Список заявок' }))
    .getAllByRole('listitem')
    .map((li) => within(li).getAllByRole('button')[0]!.textContent);

/** Заявки, где вторая в очереди просит перезвонить: callback обязан встать первой. */
const withCallback = (id: number) => viewWith(id, { callback: true, bucket: 'callback' });

describe('«Заявки»: очередь обзвона (чистые функции)', () => {
  const { items } = buildRequests();

  test('«К обзвону» — это готовые к утверждению и «перезвонить», сначала перезвонить', () => {
    const list: RequestItem[] = items.map((r) => (r.id === 3 ? { ...r, bucket: 'callback' as const, callback: true } : r));
    const queue = filterByBucket(list, 'queue');
    expect(queue.every((r) => r.bucket === 'ready' || r.bucket === 'callback')).toBe(true);
    expect(queue[0]!.id).toBe(3);
    expect(queue).toHaveLength(countBuckets(list).queue);
    expect(queue.some((r) => r.bucket === 'human' || r.bucket === 'done')).toBe(false);
  });
});

describe('«Заявки»: очередь обзвона (экран)', () => {
  test('чип «К обзвону N» показывает только заявки к обзвону и пишет отбор в адрес', async () => {
    stubFetchWithFixtures({ requests: () => json(withCallback(7)) });
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests');
    await screen.findByRole('list', { name: 'Список заявок' });
    const chip = screen.getByRole('button', { name: /^К обзвону/ });
    const counts = countBuckets(withCallback(7).items);
    expect(chip).toHaveTextContent(`К обзвону${counts.queue}`);
    await user.click(chip);
    expect(currentSearch().get('bucket')).toBe('queue');
    expect(rowNames()).toHaveLength(counts.queue);
    // перезвонить — сверху
    expect(rowNames()[0]).toBe(fixtureItem(7).fio);
  });

  test('при открытии очереди в панели сразу открыта первая заявка', async () => {
    stubFetchWithFixtures({ requests: () => json(withCallback(7)) });
    renderAt(<App />, '/?tab=requests&bucket=queue');
    const card = await screen.findByRole('dialog', { name: /Карточка заявки/ });
    expect(card).toHaveAccessibleName(`Карточка заявки: ${fixtureItem(7).fio}`);
    expect(currentSearch().get('req')).toBe('7');
  });

  test('после закрытия панели очередь заново её не открывает', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests&bucket=queue');
    await screen.findByRole('dialog', { name: /Карточка заявки/ });
    await user.click(screen.getByRole('button', { name: 'Закрыть карточку' }));
    expect(screen.queryByRole('dialog', { name: /Карточка заявки/ })).not.toBeInTheDocument();
    expect(currentSearch().has('req')).toBe(false);
  });

  test('«Следующая →» и «← Предыдущая» идут по списку, подпись «3 из N», на краях кнопки отключены', async () => {
    stubFetchWithFixtures();
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests&bucket=queue');
    const card = await screen.findByRole('dialog', { name: /Карточка заявки/ });
    const total = countBuckets(buildRequests().items).queue;
    const nav = within(card).getByRole('navigation', { name: 'Переход между заявками' });
    expect(within(nav).getByText(`1 из ${total}`)).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: '← Предыдущая' })).toBeDisabled();

    const names = rowNames();
    await user.click(within(nav).getByRole('button', { name: 'Следующая →' }));
    expect(await screen.findByRole('dialog', { name: `Карточка заявки: ${names[1]}` })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Переход между заявками' })).getByText(`2 из ${total}`)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '← Предыдущая' }));
    expect(await screen.findByRole('dialog', { name: `Карточка заявки: ${names[0]}` })).toBeInTheDocument();
  });

  test('на последней заявке «Следующая →» отключена', async () => {
    stubFetchWithFixtures();
    const total = countBuckets(buildRequests().items).queue;
    const last = filterByBucket(buildRequests().items, 'queue').at(-1)!;
    renderAt(<App />, `/?tab=requests&bucket=queue&req=${last.id}`);
    const card = await screen.findByRole('dialog', { name: /Карточка заявки/ });
    const nav = within(card).getByRole('navigation', { name: 'Переход между заявками' });
    expect(within(nav).getByText(`${total} из ${total}`)).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Следующая →' })).toBeDisabled();
  });

  test('после «Утвердить» заявка уходит из очереди, но «Следующая заявка →» остаётся и ведёт дальше', async () => {
    const first = filterByBucket(buildRequests().items, 'queue')[0]!;
    const second = filterByBucket(buildRequests().items, 'queue')[1]!;
    let approved = false;
    stubFetchWithFixtures({
      [`requests/${first.id}/approve`]: () => {
        approved = true;
        return ok();
      },
      requests: () => json(approved ? viewWith(first.id, { bucket: 'done', proposal: null, finalGroup: first.proposal!.main.group }) : buildRequests()),
    });
    const user = userEvent.setup();
    renderAt(<App />, '/?tab=requests&bucket=queue');
    const card = await screen.findByRole('dialog', { name: `Карточка заявки: ${first.fio}` });
    await user.click(within(card).getByRole('button', { name: `Утвердить в группу ${first.proposal!.main.group.code}` }));
    await within(card).findByText(`Утверждено: ${first.proposal!.main.group.code}`);
    await waitFor(() => expect(rowNames()).not.toContain(first.fio));
    await user.click(within(card).getByRole('button', { name: 'Следующая заявка →' }));
    expect(await screen.findByRole('dialog', { name: `Карточка заявки: ${second.fio}` })).toBeInTheDocument();
  });
});

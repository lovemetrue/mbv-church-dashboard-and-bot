import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildRequests } from '../../fixtures/build';
import { renderAt, stubFetchWithFixtures } from '../../test/render';
import { fixtureItem, json, openCard, viewWith } from './requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

describe('«Заявки»: закреплено или свежий расчёт', () => {
  test('закреплённое предложение подписано «Закреплено» с подсказкой, что само не изменится', async () => {
    const base = fixtureItem(1);
    stubFetchWithFixtures({ requests: () => json(viewWith(1, { proposal: { ...base.proposal!, saved: true } })) });
    const card = await openCard(1);
    const tag = await within(card).findByText('Закреплено');
    expect(tag).toHaveAttribute('title', 'Не изменится само, пока группа подходит');
    expect(within(card).queryByText('Расчёт, не закреплено')).not.toBeInTheDocument();
  });

  test('свежий расчёт подписан «Расчёт, не закреплено»', async () => {
    const base = fixtureItem(1);
    stubFetchWithFixtures({ requests: () => json(viewWith(1, { proposal: { ...base.proposal!, saved: false } })) });
    const card = await openCard(1);
    expect(await within(card).findByText('Расчёт, не закреплено')).toBeInTheDocument();
    expect(within(card).queryByText('Закреплено')).not.toBeInTheDocument();
  });

  test('в списке у каждого предложения своя метка, и закреплённых в фикстурах часть', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests');
    const list = await screen.findByRole('list', { name: 'Список заявок' });
    const withPlan = buildRequests().items.filter((r) => r.proposal && r.bucket !== 'done');
    const savedCount = withPlan.filter((r) => r.proposal!.saved).length;
    expect(savedCount).toBeGreaterThan(0);
    expect(savedCount).toBeLessThan(withPlan.length);
    expect(within(list).getAllByText('Закреплено')).toHaveLength(savedCount);
    expect(within(list).getAllByText('Расчёт, не закреплено')).toHaveLength(withPlan.length - savedCount);
  });

  test('у утверждённой заявки метки нет', async () => {
    const card = await openCard(10);
    expect(within(card).queryByText('Закреплено')).not.toBeInTheDocument();
    expect(within(card).queryByText('Расчёт, не закреплено')).not.toBeInTheDocument();
  });
});

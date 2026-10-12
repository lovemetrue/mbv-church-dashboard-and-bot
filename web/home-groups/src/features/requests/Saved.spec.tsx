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
    const tag = await within(card).findByText('Предложена автоматически');
    expect(tag).toHaveAttribute('title', 'Не изменится само, пока группа подходит');
    expect(within(card).queryByText('Предварительный расчёт')).not.toBeInTheDocument();
  });

  test('свежий расчёт подписан «Расчёт, не закреплено»', async () => {
    const base = fixtureItem(1);
    stubFetchWithFixtures({ requests: () => json(viewWith(1, { proposal: { ...base.proposal!, saved: false } })) });
    const card = await openCard(1);
    expect(await within(card).findByText('Предварительный расчёт')).toBeInTheDocument();
    expect(within(card).queryByText('Предложена автоматически')).not.toBeInTheDocument();
  });

  test('в списке у каждого предложения своя метка, и закреплённых в фикстурах часть', async () => {
    stubFetchWithFixtures();
    renderAt(<App />, '/?tab=requests');
    const list = await screen.findByRole('list', { name: 'Список заявок' });
    const withPlan = buildRequests().items.filter((r) => r.proposal && r.bucket !== 'done');
    // у закреплённых с изменившимися данными вместо «Закреплено» стоит «Данные изменились»
    const savedCount = withPlan.filter((r) => r.proposal!.saved && !r.proposal!.dataChanged).length;
    const unsavedCount = withPlan.filter((r) => !r.proposal!.saved).length;
    expect(savedCount).toBeGreaterThan(0);
    expect(unsavedCount).toBeGreaterThan(0);
    expect(within(list).getAllByText('Предложена автоматически')).toHaveLength(savedCount);
    expect(within(list).getAllByText('Предварительный расчёт')).toHaveLength(unsavedCount);
  });

  test('у утверждённой заявки метки нет', async () => {
    const card = await openCard(10);
    expect(within(card).queryByText('Предложена автоматически')).not.toBeInTheDocument();
    expect(within(card).queryByText('Предварительный расчёт')).not.toBeInTheDocument();
  });
});

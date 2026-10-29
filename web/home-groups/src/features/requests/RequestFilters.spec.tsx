import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildRequests } from '../../fixtures/build';
import { renderAt, stubFetchWithFixtures } from '../../test/render';
import { filterRequests, parseRequestFilters, requestRow } from './filters';
import { json } from './requestsTestKit';

afterEach(() => vi.unstubAllGlobals());

const items = buildRequests().items;

describe('отборы заявок: движок справочников', () => {
  test('по полу, району и дню: «День» проверяет вхождение, а не весь список', () => {
    const someone = items.find((r) => r.days.length > 1)!;
    const day = someone.days[1]!;
    const byDay = filterRequests(items, [{ field: 'День', op: 'eq', value: day }]);
    expect(byDay).toContain(someone);
    expect(byDay.every((r) => r.days.includes(day))).toBe(true);

    const women = filterRequests(items, [{ field: 'Пол', op: 'eq', value: 'Женский' }]);
    expect(women.every((r) => r.gender.value === 'ж')).toBe(true);

    const district = items.find((r) => r.district)!.district!;
    const both = filterRequests(items, [{ field: 'Район', op: 'eq', value: district }, { field: 'Пол', op: 'empty', value: '' }]);
    expect(both.every((r) => r.district === district && r.gender.value === null)).toBe(true);
  });

  test('в строке для отбора нет телефона: поиск по условиям не раскрывает контакты', () => {
    expect(Object.values(requestRow(items[0]!))).not.toContain(items[0]!.phone);
  });

  test('мусор и чужие поля в адресе отбрасываются', () => {
    expect(parseRequestFilters(['Пол:eq:Женский', 'Телефон:eq:1', 'хлам'])).toEqual([{ field: 'Пол', op: 'eq', value: 'Женский' }]);
  });
});

describe('«Заявки»: фильтры на экране', () => {
  test('условие из адреса сужает список, чип с крестиком его снимает', async () => {
    const [a, b] = items;
    stubFetchWithFixtures({
      requests: () =>
        json({
          ...buildRequests(),
          items: [
            { ...a!, fio: 'Анна Женская', gender: { value: 'ж', by: 'fio' } },
            { ...b!, fio: 'Борис Мужской', gender: { value: 'м', by: 'fio' } },
          ],
        }),
    });
    const user = userEvent.setup();
    renderAt(createElement(App), `/?tab=requests&f=${encodeURIComponent('Пол:eq:Женский')}`);
    const list = await screen.findByRole('list', { name: 'Список заявок' });
    expect(within(list).getByText('Анна Женская')).toBeInTheDocument();
    expect(within(list).queryByText('Борис Мужской')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Убрать отбор: Пол/ }));
    expect(await within(list).findByText('Борис Мужской')).toBeInTheDocument();
  });
});

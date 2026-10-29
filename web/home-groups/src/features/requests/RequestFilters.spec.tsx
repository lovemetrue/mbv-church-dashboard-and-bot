import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { App } from '../../app/App';
import { buildRequests } from '../../fixtures/build';
import { renderAt, stubFetchWithFixtures } from '../../test/render';
import { ageCategory, filterRequests, parseRequestFilters, requestRow } from './filters';
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

  test('возраст в отборе — всегда категория: точное число и диапазон из таблицы раскладываются по категориям', () => {
    expect(ageCategory('25-40')).toBe('25-40');
    expect(ageCategory('42')).toBe('40-55');
    expect(ageCategory('61')).toBe('55-65');
    expect(ageCategory('16')).toBe('подростки (до 18 лет)');
    expect(ageCategory('25')).toBe('18-25');
    expect(ageCategory('35-45 лет')).toBe('25-40');
    expect(ageCategory('70')).toBe('65+');
    expect(ageCategory('подростки (до 18 лет)')).toBe('подростки (до 18 лет)');
    expect(ageCategory(null)).toBeNull();
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

describe('«Заявки»: возраст можно отметить несколькими значениями', () => {
  test('в окне «Фильтры» отмечаем две категории — остаются заявки обеих, точный возраст — в своей категории', async () => {
    const [a, b, c] = items;
    stubFetchWithFixtures({
      requests: () =>
        json({
          ...buildRequests(),
          items: [
            { ...a!, fio: 'Молодая Анна', ageLabel: '18-25' },
            { ...b!, fio: 'Средний Борис', ageLabel: '42' },
            { ...c!, fio: 'Старший Виктор', ageLabel: '65+' },
          ],
        }),
    });
    const user = userEvent.setup();
    renderAt(createElement(App), '/?tab=requests');
    const list = await screen.findByRole('list', { name: 'Список заявок' });
    await user.click(screen.getByRole('button', { name: /^Фильтры/ }));
    await user.selectOptions(screen.getByLabelText('Поле'), 'Возраст');
    const box = screen.getByRole('group', { name: 'Значение' });
    expect(within(box).queryByLabelText('42')).not.toBeInTheDocument();
    await user.click(within(box).getByLabelText('18-25'));
    await user.click(within(box).getByLabelText('40-55'));
    await user.click(screen.getByRole('button', { name: 'Добавить' }));

    expect(await screen.findByRole('button', { name: 'Убрать отбор: Возраст = 18-25 или 40-55' })).toBeInTheDocument();
    expect(within(list).getByText('Молодая Анна')).toBeInTheDocument();
    expect(within(list).getByText('Средний Борис')).toBeInTheDocument();
    expect(within(list).queryByText('Старший Виктор')).not.toBeInTheDocument();
  });
});

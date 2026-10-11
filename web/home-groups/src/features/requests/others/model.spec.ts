import { describe, expect, test } from 'vitest';
import { buildOthers } from '../../../fixtures/others';
import { countOthers, filterOthers, matchesOtherSearch, openOthersCount } from './model';

const items = buildOthers();

describe('«Другие обращения»: чистые функции', () => {
  test('число открытых не включает закрытые', () => {
    expect(openOthersCount(items)).toBe(items.filter((o) => o.state === 'open').length);
    expect(openOthersCount(items)).toBeLessThan(items.length);
  });

  test('счётчики по состояниям складываются во «Все»', () => {
    const c = countOthers(items);
    expect(c.open + c.done + c.cancelled).toBe(c.all);
    expect(c.cancelled).toBe(1);
  });

  test('отбор по состоянию и «Все» сохраняют порядок сервера', () => {
    expect(filterOthers(items, 'all').map((o) => o.id)).toEqual(items.map((o) => o.id));
    expect(filterOthers(items, 'done').every((o) => o.state === 'done')).toBe(true);
    expect(filterOthers(items, 'open').map((o) => o.id)).toEqual(items.filter((o) => o.state === 'open').map((o) => o.id));
  });

  test('поиск: по ФИО, месту, телефону по цифрам и по типу обращения', () => {
    const find = (q: string) => items.filter((o) => matchesOtherSearch(o, q)).map((o) => o.fio);
    expect(find('СЕДОВ')).toEqual(['Игорь Седов']);
    expect(find('лесная')).toEqual(['Юлия Громова']);
    expect(find('921 555 01 02')).toEqual(['Юлия Громова']);
    expect(find('вопрос')).toEqual(['Игорь Седов']);
    expect(find('  ')).toHaveLength(items.length);
  });

  test('обращение без телефона и ответственного ищется и не падает', () => {
    const lone = items.find((o) => o.phone === null)!;
    expect(matchesOtherSearch(lone, 'орлова')).toBe(true);
    expect(matchesOtherSearch(lone, 'null')).toBe(false);
  });
});

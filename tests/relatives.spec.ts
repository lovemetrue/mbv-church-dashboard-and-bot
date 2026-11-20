import { describe, expect, test } from 'vitest';
import {
  addressKey, inverseKind, parseRelativeAdd, relativeHints, relativesByPerson, storedRelation, surnameKey,
} from '../src/home-groups/relatives.js';

describe('фамилия с учётом рода', () => {
  test('мужская и женская формы — одна фамилия', () => {
    expect(surnameKey('Иванов Пётр Сергеевич')).toBe(surnameKey('Иванова Мария Петровна'));
    expect(surnameKey('Сорокин Иван')).toBe(surnameKey('Сорокина Анна'));
    expect(surnameKey('Вишневский Олег')).toBe(surnameKey('Вишневская Ольга'));
    expect(surnameKey('Толстой Лев')).toBe(surnameKey('Толстая Софья'));
    expect(surnameKey('Королёв Сергей')).toBe(surnameKey('Королева Нина'));
    expect(surnameKey('Шевченко Тарас')).toBe(surnameKey('Шевченко Мария'));
  });

  test('разные фамилии — разные ключи; пустое ФИО — без ключа', () => {
    expect(surnameKey('Иванов Пётр')).not.toBe(surnameKey('Петров Иван'));
    expect(surnameKey('Иванов Пётр')).not.toBe(surnameKey('Иванченко Мария'));
    expect(surnameKey('')).toBeNull();
    expect(surnameKey('Без имени')).toBeNull();
  });
});

describe('адрес для сравнения', () => {
  test('регистр, точки, «ул.», «д.» и «кв.» не важны; номер квартиры важен', () => {
    expect(addressKey('ул. Савушкина, д. 5, кв. 12')).toBe(addressKey('савушкина 5 12'));
    expect(addressKey('Савушкина 5-12')).toBe(addressKey('Савушкина, 5, кв 12'));
    expect(addressKey('Савушкина 5, кв. 12')).not.toBe(addressKey('Савушкина 5, кв. 13'));
    expect(addressKey('  ')).toBeNull();
  });
});

describe('степень родства', () => {
  test('обратная: родитель ↔ ребёнок, остальные сами себе', () => {
    expect(inverseKind('parent')).toBe('child');
    expect(inverseKind('child')).toBe('parent');
    expect(inverseKind('spouse')).toBe('spouse');
    expect(inverseKind('sibling')).toBe('sibling');
    expect(inverseKind('other')).toBe('other');
  });

  test('«ребёнок» хранится как «родитель» с другой стороны', () => {
    expect(storedRelation('u1', 'p2', 'child')).toEqual({ aKey: 'p2', bKey: 'u1', kind: 'parent' });
    expect(storedRelation('u1', 'p2', 'parent')).toEqual({ aKey: 'u1', bKey: 'p2', kind: 'parent' });
    expect(storedRelation('u1', 'p2', 'spouse')).toEqual({ aKey: 'u1', bKey: 'p2', kind: 'spouse' });
  });

  test('связь видна с обеих сторон, с обратной степенью; связи с несуществующими людьми не показываются', () => {
    const rows = [
      { id: 1, a_key: 'u1', b_key: 'p2', kind: 'parent' as const },
      { id: 2, a_key: 'u1', b_key: 'p9', kind: 'spouse' as const },
    ];
    const names = new Map([['u1', 'Иванов Сын'], ['p2', 'Иванов Отец']]);
    const by = relativesByPerson(rows, names);
    expect(by.get('u1')).toEqual([{ id: 1, key: 'p2', fio: 'Иванов Отец', kind: 'parent' }]);
    expect(by.get('p2')).toEqual([{ id: 1, key: 'u1', fio: 'Иванов Сын', kind: 'child' }]);
    expect(by.get('p9')).toBeUndefined();
  });

  test('разбор тела: ключи людей, разные люди, степень из списка', () => {
    expect(parseRelativeAdd({ key: 'u1', otherKey: 'p2', kind: 'child' })).toEqual({ key: 'u1', otherKey: 'p2', kind: 'child' });
    expect(parseRelativeAdd({ key: 'u1', otherKey: 'u1', kind: 'spouse' })).toMatch(/с самим собой/);
    expect(parseRelativeAdd({ key: 'x1', otherKey: 'p2', kind: 'spouse' })).toMatch(/человека/);
    expect(parseRelativeAdd({ key: 'u1', otherKey: 'p2', kind: 'кум' })).toMatch(/Степень/);
    expect(parseRelativeAdd(null)).toMatch(/человека/);
  });
});

describe('подсказки «возможно, родственник»', () => {
  const person = (key: string, fio: string, phone: string | null, address: string | null) => ({ key, fio, phone, address });

  test('та же фамилия и тот же телефон или адрес — подсказка обеим сторонам', () => {
    const hints = relativeHints([
      person('u1', 'Иванов Пётр', '+7 911 000-11-22', null),
      person('p2', 'Иванова Мария', '8 (911) 000-11-22', 'Юкки, 3'),
      person('p3', 'Иванов Олег', null, 'юкки 3'),
    ], new Set());
    expect(hints.get('u1')).toEqual([{ key: 'p2', fio: 'Иванова Мария', samePhone: '+7 911 000-11-22', sameAddress: null }]);
    expect(hints.get('p2')).toEqual([
      { key: 'u1', fio: 'Иванов Пётр', samePhone: '8 (911) 000-11-22', sameAddress: null },
      { key: 'p3', fio: 'Иванов Олег', samePhone: null, sameAddress: 'Юкки, 3' },
    ]);
  });

  test('одной фамилии мало, одного адреса мало; уже связанных и самого себя не подсказываем', () => {
    const hints = relativeHints([
      person('u1', 'Иванов Пётр', '+79110001122', 'Юкки 3'),
      person('u2', 'Иванов Павел', '+79990000000', 'Невский 1'),
      person('u3', 'Петров Иван', '+79110001122', 'Юкки 3'),
      person('u4', 'Иванова Анна', '+79110001122', null),
    ], new Set(['u1|u4']));
    expect(hints.get('u1') ?? []).toEqual([]);
    expect(hints.get('u2') ?? []).toEqual([]);
  });
});

import { describe, expect, test } from 'vitest';
import { isAdmin, splitAdminIds } from '../src/admin/access.js';

describe('права служителя', () => {
  test('числовой id из списка даёт права', () => {
    expect(isAdmin(['1763357182'], '1763357182')).toBe(true);
  });

  test('посторонний участник прав не получает', () => {
    expect(isAdmin(['1763357182'], '999')).toBe(false);
  });

  test('пустой список не пускает никого', () => {
    expect(isAdmin([], '1763357182')).toBe(false);
  });

  test('username прав не даёт: по нему всё равно нельзя отправить уведомление', () => {
    expect(isAdmin(['@David_Rodionov'], '1124093101')).toBe(false);
  });
});

describe('splitAdminIds', () => {
  test('оставляет числовые id и собирает мусор отдельно', () => {
    expect(splitAdminIds(['1763357182', '@David_Rodionov', ' 1124093101 '])).toEqual({
      ids: ['1763357182', '1124093101'],
      invalid: ['@David_Rodionov'],
    });
  });

  test('пустые элементы просто отбрасываются', () => {
    expect(splitAdminIds(['', '  ', '42'])).toEqual({ ids: ['42'], invalid: [] });
  });

  test('на пустом списке ничего не выдумывает', () => {
    expect(splitAdminIds([])).toEqual({ ids: [], invalid: [] });
  });
});

import { describe, expect, test } from 'vitest';
import type { GroupBrief } from '@contracts';
import { matches } from './OtherGroupPicker';

const g = { id: 1, code: '№12', leader: 'Коновалов Дмитрий', district: 'Невский', metro: 'Ладожская' } as GroupBrief;

describe('поиск группы в «Другие группы…»', () => {
  test('слова запроса можно писать в любом порядке и частью слова', () => {
    expect(matches(g, 'Дмитрий Коновалов')).toBe(true);
    expect(matches(g, 'коновал')).toBe(true);
    expect(matches(g, 'Коновалова')).toBe(true);
    expect(matches(g, '')).toBe(true);
  });

  test('чужого ведущего не находит', () => {
    expect(matches(g, 'Петров')).toBe(false);
    expect(matches(g, 'Коновалов Олег')).toBe(false);
  });
});

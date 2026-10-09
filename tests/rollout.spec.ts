import { describe, expect, test } from 'vitest';
import { extraQuestionsEnabled } from '../src/core/rollout.js';

describe('кому показывать новые вопросы анкеты (настройка EXTRA_QUESTIONS)', () => {
  test('«all» — всем', () => {
    expect(extraQuestionsEnabled('all', 'telegram', '1')).toBe(true);
    expect(extraQuestionsEnabled('all', 'max', '2')).toBe(true);
  });

  test('«off» и пусто — никому', () => {
    expect(extraQuestionsEnabled('off', 'telegram', '1')).toBe(false);
    expect(extraQuestionsEnabled('', 'telegram', '1')).toBe(false);
    expect(extraQuestionsEnabled('  ', 'max', '1')).toBe(false);
  });

  test('список id — только тем, кто в списке, на любой платформе', () => {
    expect(extraQuestionsEnabled('27637540,1763357182', 'max', '27637540')).toBe(true);
    expect(extraQuestionsEnabled('27637540,1763357182', 'telegram', '1763357182')).toBe(true);
    expect(extraQuestionsEnabled('27637540,1763357182', 'max', '555')).toBe(false);
  });

  test('с приставкой платформы — только на этой платформе', () => {
    expect(extraQuestionsEnabled('max:27637540', 'max', '27637540')).toBe(true);
    expect(extraQuestionsEnabled('max:27637540', 'telegram', '27637540')).toBe(false);
    expect(extraQuestionsEnabled('telegram:5', 'telegram', '5')).toBe(true);
  });

  test('пробелы и регистр не мешают', () => {
    expect(extraQuestionsEnabled(' ALL ', 'max', '1')).toBe(true);
    expect(extraQuestionsEnabled(' MAX:7 , telegram:8 ', 'max', '7')).toBe(true);
  });

  test('id целиком, а не по кусочку: 27 не совпадает с 276', () => {
    expect(extraQuestionsEnabled('276', 'max', '27')).toBe(false);
  });

  test('мусор в списке не включает функцию всем', () => {
    expect(extraQuestionsEnabled('почти все', 'max', '1')).toBe(false);
  });
});

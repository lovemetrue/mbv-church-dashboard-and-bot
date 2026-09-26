import { describe, expect, test } from 'vitest';
import {
  NO_CHURCH, OTHER_CHURCH, OTHER_CHURCH_ELSE, allChurchOptions, churchOptions, otherChurchOptions,
} from '../src/core/churches.js';

/**
 * У бота выбор церкви — два экрана меню (сначала общий список, потом «Другая
 * церковь»). В дашборде для формы регистрации нет двухуровневого меню, поэтому
 * allChurchOptions() кладёт оба экрана в один список — важно, что никакое
 * значение, которое мог бы прислать бот, при этом не теряется и не дублируется.
 */
describe('allChurchOptions — церкви одним списком для выпадающего списка в дашборде', () => {
  test('включает все церкви первого экрана бота, кроме служебной «Другая церковь»', () => {
    const flat = allChurchOptions();
    for (const c of churchOptions()) {
      if (c === OTHER_CHURCH) continue;
      expect(flat, `не хватает «${c}»`).toContain(c);
    }
    expect(flat).not.toContain(OTHER_CHURCH);
  });

  test('включает все церкви второго экрана («Другая церковь»), включая «Другая»', () => {
    const flat = allChurchOptions();
    for (const c of otherChurchOptions()) {
      expect(flat, `не хватает «${c}»`).toContain(c);
    }
    expect(flat).toContain(OTHER_CHURCH_ELSE);
  });

  test('«Не посещаю церковь» встречается ровно один раз, а не дважды из-за двух списков', () => {
    const flat = allChurchOptions();
    expect(flat.filter((c) => c === NO_CHURCH)).toHaveLength(1);
  });

  test('порядок: церкви МБВ, затем конкретные другие церкви и «Другая», «Не посещаю церковь» — последней', () => {
    const flat = allChurchOptions();
    expect(flat[flat.length - 1]).toBe(NO_CHURCH);
    expect(flat[0]).toBe(churchOptions()[0]);
  });
});

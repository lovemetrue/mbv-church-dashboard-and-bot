import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

// Vitest не отдаёт содержимое .css через import (даже ?raw), поэтому читаем файл с диска.
const css = readFileSync(join(__dirname, 'base.css'), 'utf8');

/** Все объявления из блоков, у которых в списке селекторов есть `body`. */
function bodyRules(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectors = m[1]!.replace(/\/\*[\s\S]*?\*\//g, '').split(',').map((s) => s.trim());
    if (!selectors.includes('body')) continue;
    for (const d of m[2]!.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) out[d[1]!] = d[2]!.trim();
  }
  return out;
}

describe('страница не шире экрана телефона', () => {
  test('body обрезает вылезающее вбок и служит точкой отсчёта для абсолютных подписей скринридера', () => {
    // Без position: relative подпись .visually-hidden из правого столбца таблицы растягивала страницу, и на телефоне
    // карточка группы уезжала за край экрана.
    expect(bodyRules()).toMatchObject({ 'overflow-x': 'clip', position: 'relative' });
  });
});

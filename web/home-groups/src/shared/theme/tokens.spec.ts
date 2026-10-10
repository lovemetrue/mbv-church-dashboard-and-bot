import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

// Vitest не отдаёт содержимое .css через import (даже ?raw), поэтому читаем файл с диска.
const css = readFileSync(join(__dirname, 'tokens.css'), 'utf8');

/** Тело блока `selector { … }` (для вложенного в @media достаточно уникального селектора). */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`нет блока ${selector}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  const out: Record<string, string> = {};
  for (const m of css.slice(open + 1, close).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const light = block(':root {');
const darkMedia = block(":root:not([data-theme='light']):not([data-theme='gray'])");
const darkExplicit = block(":root[data-theme='dark']");
const gray = block(":root[data-theme='gray']");

const themes = {
  светлая: light,
  тёмная: { ...light, ...darkExplicit },
  серая: { ...light, ...gray },
};

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** Пары «цвет текста на цвете фона», которые реально встречаются в интерфейсе. */
const PAIRS: [string, string][] = [
  ['--ink', '--bg'],
  ['--ink', '--surface'],
  ['--ink', '--surface-2'],
  ['--ink', '--accent-soft'],
  ['--muted', '--bg'],
  ['--muted', '--surface'],
  ['--muted', '--surface-2'],
  ['--muted', '--line-soft'],
  ['--accent', '--bg'],
  ['--accent', '--surface'],
  ['--accent', '--accent-soft'],
  ['--accent-ink', '--accent'],
  ['--ok', '--surface'],
  ['--ok', '--ok-soft'],
  ['--warn', '--surface'],
  ['--warn', '--warn-soft'],
  ['--crit', '--surface'],
  ['--crit', '--crit-soft'],
];

describe('дизайн-токены', () => {
  test.each(Object.entries(themes))('контраст текста не ниже 4.5:1 в теме «%s»', (_name, t) => {
    const bad = PAIRS.filter(([fg, bg]) => contrast(t[fg]!, t[bg]!) < 4.5).map(
      ([fg, bg]) => `${fg} на ${bg}: ${contrast(t[fg]!, t[bg]!).toFixed(2)}`,
    );
    expect(bad).toEqual([]);
  });

  test('тёмные значения для «авто» (по системной теме) и для явного выбора совпадают', () => {
    expect(darkMedia).toEqual(darkExplicit);
  });

  test('серая тема задаёт все те же токены, что и светлая', () => {
    const colorTokens = Object.keys(light).filter((k) => /^--(bg|surface|ink|muted|line|accent|ok|warn|crit)/.test(k));
    expect(colorTokens.filter((k) => !(k in gray))).toEqual([]);
    expect(colorTokens.filter((k) => !(k in darkExplicit))).toEqual([]);
  });

  test('серая тема лежит между светлой и тёмной по яркости фона', () => {
    const l = luminance(light['--bg']!);
    const g = luminance(gray['--bg']!);
    const d = luminance(darkExplicit['--bg']!);
    expect(g).toBeLessThan(l);
    expect(g).toBeGreaterThan(d);
  });
});

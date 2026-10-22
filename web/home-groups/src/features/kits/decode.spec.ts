import QRCode from 'qrcode';
import { describe, expect, test } from 'vitest';
import { decodeFrame } from './decode';

/**
 * Настоящее распознавание (без подмены): кадр строится из матрицы того же QR, что рисует бот (`core/qr.ts`,
 * уровень коррекции M), с полями в два модуля, как на карточке. Так видно, что библиотека читает оба вида кода.
 */
function frameOf(text: string, opts: { px: number; invert?: boolean; noise?: number }): ImageData {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const quiet = 2;
  const side = (modules.size + quiet * 2) * opts.px;
  const data = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const mx = Math.floor(x / opts.px) - quiet;
      const my = Math.floor(y / opts.px) - quiet;
      const dark = mx >= 0 && my >= 0 && mx < modules.size && my < modules.size && modules.get(mx, my) === 1;
      // Экран — не идеальные белый и чёрный.
      let v = dark !== Boolean(opts.invert) ? 40 : 215;
      v += ((x * 7919 + y * 104729) % 11 - 5) * (opts.noise ?? 0);
      const i = (y * side + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: side, height: side, colorSpace: 'srgb' } as ImageData;
}

describe('распознавание QR карточки регистрации', () => {
  test('читается диплинк из карточки бота в Telegram', () => {
    expect(decodeFrame(frameOf('https://t.me/church40_mbv_bot?start=kit_1042', { px: 6 }), false)).toBe('https://t.me/church40_mbv_bot?start=kit_1042');
  });

  test('читается текст с кириллицей из карточки MAX и ручной регистрации', () => {
    expect(decodeFrame(frameOf('Регистрация №1042', { px: 6, noise: 1 }), false)).toBe('Регистрация №1042');
  });

  test('светлый код на тёмном (тёмная тема) читается только со снимка, где пробуем инверсию', () => {
    const frame = frameOf('Регистрация №1042', { px: 6, invert: true });
    expect(decodeFrame(frame, false)).toBeNull();
    expect(decodeFrame(frame, true)).toBe('Регистрация №1042');
  });

  test('кадр без QR — null, а не ошибка', () => {
    const blank = { data: new Uint8ClampedArray(200 * 200 * 4).fill(200), width: 200, height: 200, colorSpace: 'srgb' } as ImageData;
    expect(decodeFrame(blank, true)).toBeNull();
  });
});

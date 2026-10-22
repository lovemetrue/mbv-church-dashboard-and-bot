import jsQR from 'jsqr';

/**
 * Распознавание QR на кадре или снимке. Встроенного распознавателя (BarcodeDetector) нет в Safari на iPhone,
 * поэтому всегда работает одна библиотека: так телефоны координаторов ведут себя одинаково.
 */

/**
 * Стороны кадра камеры для распознавания, по очереди. Библиотека чувствительна к шуму сенсора на ровном белом
 * (в тусклом зале его много), а уменьшение кадра шум усредняет: крупный код в кадре надёжнее читается с 400 px,
 * мелкий (телефон держат далеко) — с 640. Проверено на карточках бота и MAX с шумом и поворотом.
 */
export const LIVE_SIDES = [640, 400] as const;
/** Снимок с камеры телефона — десяток мегапикселей: читаем уменьшенным (меньше шума), а если не нашлось — крупнее. */
const PHOTO_SIDES = [800, 1400, 2400] as const;

/** Кадр, уменьшенный так, чтобы длинная сторона была не больше `maxSide`. */
export function frameOf(source: CanvasImageSource, width: number, height: number, maxSide: number, canvas: HTMLCanvasElement): ImageData | null {
  if (!width || !height) return null;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  canvas.width = w;
  canvas.height = h;
  // willReadFrequently: кадры читаются постоянно, без него браузер гоняет их через видеокарту и обратно.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/**
 * Текст QR или null. В живом кадре инверсию не пробуем — это вдвое дольше; на снимке пробуем: тёмная тема
 * мессенджера иногда рисует светлый код на тёмном фоне.
 */
export function decodeFrame(frame: ImageData, tryInverted: boolean): string | null {
  const code = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: tryInverted ? 'attemptBoth' : 'dontInvert' });
  return code?.data ? code.data : null;
}

/** QR со снимка (кнопка «Сфотографировать QR» — работает и без https, в отличие от живой камеры). */
export async function decodePhoto(file: Blob): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    for (const side of PHOTO_SIDES) {
      const frame = frameOf(bitmap, bitmap.width, bitmap.height, side, canvas);
      const text = frame && decodeFrame(frame, true);
      if (text) return text;
      if (Math.max(bitmap.width, bitmap.height) <= side) break;
    }
    return null;
  } finally {
    bitmap.close();
  }
}

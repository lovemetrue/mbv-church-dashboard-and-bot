import { afterEach, describe, expect, test, vi } from 'vitest';
import { copyText } from './clipboard';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('копирование в буфер обмена', () => {
  test('при наличии Clipboard API пишет текст через него', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('+79215550011')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('+79215550011');
  });

  test('если Clipboard API отказал, пробует запасной способ и не падает', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    expect(await copyText('+79215550011')).toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    // временное поле убрано из страницы
    expect(document.querySelector('textarea')).toBeNull();
  });

  test('без Clipboard API работает запасной способ', async () => {
    vi.stubGlobal('navigator', {});
    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    expect(await copyText('x')).toBe(true);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  test('если не получилось ничего, возвращает false, а не бросает ошибку', async () => {
    vi.stubGlobal('navigator', {});
    Object.defineProperty(document, 'execCommand', {
      value: () => {
        throw new Error('нельзя');
      },
      configurable: true,
    });
    expect(await copyText('x')).toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
  });
});

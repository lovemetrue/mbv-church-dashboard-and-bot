import { describe, expect, test } from 'vitest';
import { ApiError } from './client';
import { serverText } from './serverText';

const texts = { network: 'Нет связи', fallback: 'Не получилось' };

describe('serverText: текст ошибки для человека', () => {
  test('слова сервера показываются как есть', () => {
    expect(serverText(new ApiError(503, 'Помощник выключен', 'unavailable'), texts)).toBe('Помощник выключен');
  });

  test('«Ошибка 500» без тела людям не показывается: вместо неё запасной текст', () => {
    expect(serverText(new ApiError(500, 'Ошибка 500'), texts)).toBe('Не получилось');
  });

  test('не дошли до сервера (статус 0) — текст про связь', () => {
    expect(serverText(new ApiError(0, 'Нет связи с сервером'), texts)).toBe('Нет связи');
  });

  test('чужая ошибка (не ApiError) — запасной текст', () => {
    expect(serverText(new Error('boom'), texts)).toBe('Не получилось');
  });
});

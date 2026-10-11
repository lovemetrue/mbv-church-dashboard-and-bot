import { ApiError } from './client';

/** Сообщение клиента при ответе без тела: «Ошибка 500». Людям его показывать незачем. */
const GENERIC_MESSAGE = /^Ошибка \d+$/;

/**
 * Текст ошибки действия для человека. Сервер пишет отказы по-русски и для людей («Помощник выключен…»,
 * «Разбор уже идёт…»), поэтому его слова показываем как есть: по коду ошибки не угадать, что именно случилось.
 * Если тела не было, остаётся запасной текст; если не дошли до сервера — текст про связь.
 */
export function serverText(error: unknown, texts: { network: string; fallback: string }): string {
  if (!(error instanceof ApiError)) return texts.fallback;
  if (error.status === 0) return texts.network;
  return error.message && !GENERIC_MESSAGE.test(error.message) ? error.message : texts.fallback;
}

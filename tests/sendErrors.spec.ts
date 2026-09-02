import { describe, expect, test } from 'vitest';
import { GrammyError, HttpError } from 'grammy';
import { MaxError } from '@maxhub/max-bot-api';
import { telegramSendError } from '../src/adapters/telegram.errors.js';
import { maxSendError } from '../src/adapters/max.errors.js';

const grammyError = (code: number, description: string, retryAfter?: number) =>
  new GrammyError(
    `Call to 'sendMessage' failed! (${code}: ${description})`,
    { ok: false, error_code: code, description, parameters: retryAfter ? { retry_after: retryAfter } : {} },
    'sendMessage',
    {},
  );

describe('классификация ошибок Telegram', () => {
  test('403 значит, что человек заблокировал бота', () => {
    expect(telegramSendError(grammyError(403, 'Forbidden: bot was blocked by the user')).kind).toBe('blocked');
  });

  test('429 значит «слишком часто» и несёт время ожидания', () => {
    const err = telegramSendError(grammyError(429, 'Too Many Requests', 12));
    expect(err.kind).toBe('rate_limited');
    expect(err.retryAfterMs).toBe(12_000);
  });

  test('429 без retry_after получает паузу по умолчанию', () => {
    expect(telegramSendError(grammyError(429, 'Too Many Requests')).retryAfterMs).toBe(5_000);
  });

  test('пропавший чат отличается от блокировки', () => {
    expect(telegramSendError(grammyError(400, 'Bad Request: chat not found')).kind).toBe('not_found');
  });

  test('удалённый аккаунт тоже считается пропавшим', () => {
    expect(telegramSendError(grammyError(400, 'Bad Request: user is deactivated')).kind).toBe('not_found');
  });

  test('прочие ошибки Telegram не приводят к отписке участника', () => {
    expect(telegramSendError(grammyError(400, 'Bad Request: message text is empty')).kind).toBe('other');
  });

  test('сетевая ошибка это временная проблема', () => {
    expect(telegramSendError(new HttpError('сеть недоступна', new Error('ECONNRESET'))).kind).toBe('other');
  });

  test('неизвестное исключение не роняет отправку', () => {
    expect(telegramSendError(new Error('что-то пошло не так')).kind).toBe('other');
  });
});

describe('классификация ошибок MAX', () => {
  test('403 значит, что бот заблокирован', () => {
    expect(maxSendError(new MaxError(403, { code: 'forbidden', message: 'access denied' })).kind).toBe('blocked');
  });

  test('404 значит, что диалога больше нет', () => {
    expect(maxSendError(new MaxError(404, { code: 'not.found', message: 'chat not found' })).kind).toBe('not_found');
  });

  test('429 значит «слишком часто»', () => {
    const err = maxSendError(new MaxError(429, { code: 'too.many.requests', message: 'slow down' }));
    expect(err.kind).toBe('rate_limited');
    expect(err.retryAfterMs).toBeGreaterThan(0);
  });

  test('серверная ошибка платформы это временная проблема', () => {
    expect(maxSendError(new MaxError(500, { code: 'internal', message: 'oops' })).kind).toBe('other');
  });

  test('сообщение ошибки сохраняется для журнала доставки', () => {
    expect(maxSendError(new MaxError(500, { code: 'internal', message: 'oops' })).message).toContain('oops');
  });
});

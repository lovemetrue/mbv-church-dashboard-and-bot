import { MaxError } from '@maxhub/max-bot-api';
import { SendError } from '../core/platform.js';

/** MAX не отдаёт retry-after, поэтому при 429 ждём фиксированную паузу. */
const DEFAULT_RETRY_MS = 5_000;

/** Приводит ошибки MAX к общей классификации (см. telegram.errors.ts). */
export function maxSendError(err: unknown): SendError {
  if (err instanceof MaxError) {
    const description = `${err.status}: ${err.description || err.code}`;
    if (err.status === 429) return new SendError('rate_limited', description, DEFAULT_RETRY_MS, err);
    if (err.status === 403) return new SendError('blocked', description, undefined, err);
    if (err.status === 404) return new SendError('not_found', description, undefined, err);
    return new SendError('other', description, undefined, err);
  }
  return new SendError('other', (err as Error).message, undefined, err);
}

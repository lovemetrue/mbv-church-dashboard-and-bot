import { GrammyError, HttpError } from 'grammy';
import { SendError } from '../core/platform.js';

const DEFAULT_RETRY_MS = 5_000;

/**
 * Приводит ошибки Telegram к общей классификации.
 * От неё зависит, пометить участника заблокировавшим бота или просто повторить попытку,
 * поэтому классификация проверяется тестами отдельно от адаптера.
 */
export function telegramSendError(err: unknown): SendError {
  if (err instanceof GrammyError) {
    const { error_code: code, description } = err;

    if (code === 429) {
      const retryAfter = err.parameters?.retry_after;
      return new SendError('rate_limited', description, (retryAfter ?? DEFAULT_RETRY_MS / 1000) * 1000, err);
    }
    if (code === 403) return new SendError('blocked', description, undefined, err);
    if (code === 400 && /chat not found|user is deactivated|peer_id_invalid/i.test(description)) {
      return new SendError('not_found', description, undefined, err);
    }
    return new SendError('other', description, undefined, err);
  }

  if (err instanceof HttpError) return new SendError('other', `сеть: ${err.message}`, undefined, err);
  return new SendError('other', (err as Error).message, undefined, err);
}

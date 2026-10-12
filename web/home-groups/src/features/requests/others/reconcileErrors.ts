import { ApiError } from '../../../shared/api/client';
import { ru } from '../../../shared/i18n/ru';

const r = ru.requests.others.reconcile;

/** Сервер без своего текста отвечает общим «Ошибка 400»: человеку его показывать нечего. */
const GENERIC_SERVER_TEXT = /^Ошибка \d+$/;

/** Слова сервера, если они есть: он единственный знает, что не так с группой или обращением. */
const serverText = (e: ApiError, fallback: string): string =>
  e.message && !GENERIC_SERVER_TEXT.test(e.message) ? e.message : fallback;

/**
 * Ошибка разбора одного обращения. Обрыв связи (status 0) сказан отдельно и без совета повторить: запрос мог
 * дойти, и тогда повтор внёс бы человека дважды. Конфликт объясняем сами (сервер скажет только «конфликт»),
 * а про недоступную группу, закрытое обращение и неверный запрос показываем слова сервера.
 */
export function reconcileErrorText(e: unknown): string {
  if (!(e instanceof ApiError)) return r.errorOther;
  if (e.status === 0) return r.errorNetwork;
  if (e.status === 403) return ru.requests.work.errorForbidden;
  switch (e.code) {
    case 'conflict':
      return r.errorConflict;
    case 'group_unavailable':
      return serverText(e, r.errorGroup);
    case 'already_closed':
      return serverText(e, r.errorClosed);
    case 'bad_request':
      return serverText(e, r.errorOther);
    default:
      return r.errorOther;
  }
}

/** Ошибка массового разбора: сеть — без совета повторить, остальное — слова сервера («не больше 500»). */
export function reconcileReadyErrorText(e: unknown): string {
  if (!(e instanceof ApiError)) return ru.requests.others.ready.errorOther;
  if (e.status === 0) return ru.requests.others.ready.errorNetwork;
  if (e.status === 403) return ru.requests.work.errorForbidden;
  return serverText(e, ru.requests.others.ready.errorOther);
}

import { useRef, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { PersonStrangeBody, StrangeBody } from '@contracts';
import { ApiError, apiPost } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';

const t = ru.strange;

/** Чья метка: человек заявки (в том числе «другого обращения») или человек справочника по ключу («u12», «r345», «p7»). */
export type StrangeTarget = { kind: 'request'; id: number } | { kind: 'person'; key: string };

export interface StrangeNotice {
  kind: 'ok' | 'error';
  text: string;
}

/** Сервер без своего текста отвечает общим «Ошибка 400»: его человеку показывать нечего. */
const GENERIC_SERVER_TEXT = /^Ошибка \d+$/;

/** Ошибка словами. Сеть отдельно: при обрыве неизвестно, дошла ли отметка до сервера. */
export function strangeErrorText(error: unknown): string {
  if (!(error instanceof ApiError)) return t.errorOther;
  if (error.status === 0) return t.errorNetwork;
  if (error.status === 403) return t.errorForbidden;
  switch (error.code) {
    case 'bad_request':
      return GENERIC_SERVER_TEXT.test(error.message) ? t.errorBadRequest : error.message;
    case 'not_found':
      return t.errorNotFound;
    default:
      return t.errorOther;
  }
}

/**
 * Что перечитать после метки: заявки, «Сегодня», группы, люди и «Команда» — те же ключи, что у остальных действий над
 * заявкой (`useRequestWork`, разбор обращений). Метка видна и в списках заявок, и в «Людях», и в составе групп.
 */
export function refreshAfterStrange(client: QueryClient): Promise<unknown> {
  return Promise.all(
    [queryKeys.requests, queryKeys.today, queryKeys.groups, queryKeys.people, queryKeys.team].map((queryKey) =>
      client.invalidateQueries({ queryKey }),
    ),
  );
}

/**
 * Поставить или снять метку «Странный человек». Метка про человека, а не про заявку, поэтому закрытая заявка не мешает.
 * Два нажатия подряд могут прийти до перерисовки, поэтому кроме `pending` есть флаг в `ref`: он меняется сразу.
 * Пустую заметку не отправляем вовсе.
 */
export function useStrangeMark(target: StrangeTarget) {
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<StrangeNotice | null>(null);

  /** Возвращает true, если сервер принял отметку. */
  async function save(value: boolean, note: string): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPending(true);
    setNotice(null);
    try {
      const text = note.trim();
      const body: StrangeBody = value && text ? { value, note: text } : { value };
      if (target.kind === 'request') await apiPost(`requests/${target.id}/strange`, body);
      else await apiPost('people/strange', { key: target.key, ...body } satisfies PersonStrangeBody);
      setNotice({ kind: 'ok', text: value ? t.saved : t.removed });
      // Ждём перечитывания: пока экран показывает старое, повторная отметка шла бы вслепую.
      await refreshAfterStrange(queryClient);
      return true;
    } catch (e) {
      setNotice({ kind: 'error', text: strangeErrorText(e) });
      return false;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return { pending, notice, save, clearNotice: () => setNotice(null) };
}

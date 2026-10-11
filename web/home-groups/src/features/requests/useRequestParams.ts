import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RequestParamsBody } from '@contracts';
import { ApiError, apiPost } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';

const p = ru.requests.params;

/** Какое поле правим: ключи совпадают с телом запроса `RequestParamsBody`. */
export type ParamField = 'schedule' | 'street';

export interface ParamsNotice {
  kind: 'ok' | 'error';
  text: string;
}

/** Текст ошибки по коду контракта. Текст сервера не показываем: он для разработчика. */
export function paramsErrorText(error: unknown): string {
  if (!(error instanceof ApiError)) return p.errorOther;
  if (error.status === 0) return p.errorNetwork;
  if (error.status === 403) return p.errorForbidden;
  switch (error.code) {
    case 'bad_request':
      return p.errorBadRequest;
    case 'already_closed':
      return p.errorClosed;
    case 'not_found':
      return p.errorNotFound;
    default:
      return p.errorOther;
  }
}

/**
 * Правка удобного времени и улицы у одной заявки.
 *
 * Шлём только то поле, которое меняли: так правка улицы не затрёт время, а сервер не примет
 * за «убрать правку» поле, которого мы не трогали. Пока запрос идёт, кнопки заблокированы;
 * одного `pending` мало (два нажатия могут прийти до перерисовки), поэтому флаг ещё и в `ref`.
 */
export function useRequestParams(requestId: number) {
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<ParamsNotice | null>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.requests }),
      queryClient.invalidateQueries({ queryKey: queryKeys.today }),
      queryClient.invalidateQueries({ queryKey: queryKeys.groups }),
    ]);

  /** value: строка — задать правку; null — убрать её. Возвращает true, если сохранилось. */
  async function save(field: ParamField, value: string | null): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPending(true);
    setNotice(null);
    const body: RequestParamsBody = field === 'schedule' ? { schedule: value } : { street: value };
    try {
      await apiPost(`requests/${requestId}/params`, body);
      const text =
        field === 'schedule'
          ? value === null ? p.removedTime : p.savedTime
          : value === null ? p.removedStreet : p.savedStreet;
      setNotice({ kind: 'ok', text });
      // Ждём перечитывания: пока список старый, «Понято как…» показало бы прежний разбор.
      await refresh();
      return true;
    } catch (e) {
      setNotice({ kind: 'error', text: paramsErrorText(e) });
      if (e instanceof ApiError && e.code === 'already_closed') await refresh();
      return false;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return { pending, notice, save, clearNotice: () => setNotice(null) };
}

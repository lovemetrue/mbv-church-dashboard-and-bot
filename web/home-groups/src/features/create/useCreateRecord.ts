import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CreateRecordBody, CreateRecordOk, CreateRegistrationOk } from '@contracts';
import { ApiError, apiPost } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';

export type CreatePath = 'requests/create' | 'groups/create' | 'people/create';

/** `registrationNo` приходит только от регистрации участника: у заявки и группы номера регистрации нет. */
export type CreateResult = { ok: true; id: number; registrationNo?: number } | { ok: false; message: string };

/**
 * Текст ошибки для человека. Отказ проверки (`bad_request`) сервер пишет по-русски и именно для
 * людей, поэтому показываем его как есть; остальное объясняем сами, не пересказывая служебные тексты.
 */
export function createErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'bad_request' && e.message) return e.message;
    if (e.code === 'forbidden' || e.status === 403) return ru.create.errors.forbidden;
    if (e.status === 0) return ru.create.errors.network;
  }
  return ru.create.errors.other;
}

/**
 * Отправка формы создания. Запрос не идемпотентен (два нажатия — две заявки), поэтому повторную
 * отправку, пока первая не закончилась, отсекает флажок в ref: состояние `busy` обновляется после
 * отрисовки, и два быстрых события успели бы проскочить оба.
 * После успеха списки, в которые попадёт новая запись, перечитываются в фоне: окно закрывается
 * сразу, а не ждёт пять ответов. Регистрация участника тоже перечитывает заявки и «Сегодня»:
 * ответ «хочет в группу» сервер превращает в заявку сам.
 */
export function useCreateRecord(path: CreatePath) {
  const client = useQueryClient();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);

  /** null — отправка уже идёт, это повторное нажатие. */
  const submit = async (fields: Record<string, string>): Promise<CreateResult | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setBusy(true);
    try {
      const body: CreateRecordBody = { fields };
      const res = await apiPost<CreateRecordOk | CreateRegistrationOk>(path, body);
      for (const key of [queryKeys.requests, queryKeys.today, queryKeys.groups, queryKeys.people, queryKeys.coordinators]) {
        void client.invalidateQueries({ queryKey: key });
      }
      return 'registrationNo' in res ? { ok: true, id: res.id, registrationNo: res.registrationNo } : { ok: true, id: res.id };
    } catch (e) {
      return { ok: false, message: createErrorMessage(e) };
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return { submit, busy };
}

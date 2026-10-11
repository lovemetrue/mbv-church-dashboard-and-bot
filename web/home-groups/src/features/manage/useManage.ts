import { useRef, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ApiError, apiPost } from '../../shared/api/client';
import { queryKeys, useMe } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { FORM_META_KEY } from '../create/useFormMeta';

/**
 * Удалять может только полный вход. Пока роль не пришла, считаем, что нельзя: кнопка не должна
 * мигнуть обычному входу. Настоящая защита всё равно на сервере (403).
 */
export function useCanDelete(): boolean {
  return useMe().data?.role === 'super';
}

/**
 * Перечитывает всё, что правка или удаление могли задеть: заявки и «Сегодня» (имя координатора и
 * закреплённые группы живут и там), группы, людей, координаторов и справочники форм (в них имена
 * координаторов). Справочники форм сейчас никто не показывает, поэтому они лишь помечаются
 * устаревшими и читаются заново при следующем открытии формы.
 */
export function refreshAfterManage(client: QueryClient): Promise<unknown> {
  const keys = [queryKeys.requests, queryKeys.today, queryKeys.groups, queryKeys.people, queryKeys.coordinators, FORM_META_KEY];
  return Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })));
}

/**
 * Текст ошибки для человека. Отказ проверки (`bad_request`) сервер пишет по-русски и именно для
 * людей, поэтому показываем его как есть, если это не общее «Ошибка 400»; остальное объясняем сами.
 */
export function manageErrorMessage(e: unknown): string {
  const t = ru.manage.errors;
  if (!(e instanceof ApiError)) return t.other;
  if (e.status === 0) return t.network;
  if (e.status === 403 || e.code === 'forbidden') return t.forbidden;
  if (e.status === 404 || e.code === 'not_found') return t.notFound;
  if (e.code === 'bad_request' && e.message && !/^Ошибка \d+$/.test(e.message)) return e.message;
  return t.other;
}

export type ManageResult = { ok: true } | { ok: false; message: string };

/**
 * Одно действие над записью справочника: правка или удаление. Действие не идемпотентно с точки
 * зрения человека, поэтому повторное нажатие, пока первое не закончилось, отсекает флажок в `ref`:
 * состояние `busy` обновляется после отрисовки, и два быстрых нажатия успели бы проскочить оба.
 *
 * После успеха ждём перечитывания списков: окно закрывается, когда карточка уже показывает новое,
 * иначе повторная правка заполнилась бы устаревшими значениями и отправила их как «изменённые».
 * Если записи уже нет (`not_found`), список тоже устарел и перечитывается.
 */
export function useManageAction() {
  const client = useQueryClient();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);

  /** null — отправка уже идёт, это повторное нажатие. */
  const run = async (path: string, body: unknown): Promise<ManageResult | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setBusy(true);
    try {
      await apiPost(path, body);
      await refreshAfterManage(client);
      return { ok: true };
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.code === 'not_found')) void refreshAfterManage(client);
      return { ok: false, message: manageErrorMessage(e) };
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return { run, busy };
}

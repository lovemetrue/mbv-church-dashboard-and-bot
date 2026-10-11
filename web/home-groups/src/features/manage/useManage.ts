import { useRef, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ApiError, apiPost } from '../../shared/api/client';
import { queryKeys, useMe } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { CAMPAIGN_KEY } from '../campaign/useCampaign';
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
 * закреплённые группы живут и там), группы, людей, координаторов, «Команду» и «Кампанию» (их числа считаются
 * из заявок и регистраций, а удаление регистрации стирает и то и другое) и справочники форм (в них имена
 * координаторов). Справочники форм сейчас никто не показывает, поэтому они лишь помечаются
 * устаревшими и читаются заново при следующем открытии формы.
 */
export function refreshAfterManage(client: QueryClient): Promise<unknown> {
  const keys = [
    queryKeys.requests,
    queryKeys.today,
    queryKeys.groups,
    queryKeys.people,
    queryKeys.coordinators,
    queryKeys.team,
    CAMPAIGN_KEY,
    FORM_META_KEY,
  ];
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

/** `data` — ответ сервера на успешное действие (нужен там, где в нём есть что-то кроме `ok`, например ключ новой записи). */
export type ManageResult = { ok: true; data: unknown } | { ok: false; message: string };

/**
 * Одно действие над записью справочника: правка или удаление. Действие не идемпотентно с точки
 * зрения человека, поэтому повторное нажатие, пока первое не закончилось, отсекает флажок в `ref`:
 * состояние `busy` обновляется после отрисовки, и два быстрых нажатия успели бы проскочить оба.
 *
 * После успеха ждём перечитывания списков: окно закрывается, когда карточка уже показывает новое,
 * иначе повторная правка заполнилась бы устаревшими значениями и отправила их как «изменённые».
 * Если записи уже нет (`not_found`), список тоже устарел и перечитывается.
 * Что именно перечитывать, решает `refresh`: по умолчанию всё, что могла задеть правка записи справочника,
 * а состав группы, например, обновляет только группы и людей.
 */
export function useManageAction(
  refresh: (client: QueryClient) => Promise<unknown> = refreshAfterManage,
  /** Свой текст для ошибки, которую общий разбор объяснил бы неточно; null — оставить общий. */
  explain?: (e: unknown) => string | null,
) {
  const client = useQueryClient();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);

  /** null — отправка уже идёт, это повторное нажатие. */
  const run = async (path: string, body: unknown): Promise<ManageResult | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setBusy(true);
    try {
      const data = await apiPost<unknown>(path, body);
      await refresh(client);
      return { ok: true, data };
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.code === 'not_found')) void refresh(client);
      return { ok: false, message: explain?.(e) ?? manageErrorMessage(e) };
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return { run, busy };
}

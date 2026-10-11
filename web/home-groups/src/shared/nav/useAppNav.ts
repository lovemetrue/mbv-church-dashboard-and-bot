import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { BucketFilter } from '../../entities/buckets';
import type { OtherFilter, RequestsView } from '../../entities/others';
import {
  parseBucket,
  parseEntity,
  parseId,
  parseOtherFilter,
  parseTab,
  parseView,
  patchParams,
  RESP_NOBODY,
  tabParams,
  type EntityId,
  type ParamPatch,
  type TabId,
} from './params';

/**
 * Единственная точка чтения и записи состояния экрана в адресе. Фичи ходят друг к другу только
 * через неё (например, «Уточнить» на «Сегодня» открывает заявку), а не импортируют друг друга.
 */
export function useAppNav() {
  const [params, setParams] = useSearchParams();

  /** replace — для правок, которые не должны засорять историю «назад» (ввод в поиск, отборы). */
  const update = useCallback(
    (patch: ParamPatch, opts?: { replace?: boolean }) => {
      setParams((prev) => patchParams(prev, patch), { replace: opts?.replace ?? false });
    },
    [setParams],
  );

  const goTab = useCallback(
    // replace — когда вкладку выбрали не руками, а оболочка (уход с закрытой вкладки): запись
    // с запретным адресом в истории вернула бы человека обратно на неё по кнопке «назад».
    (tab: TabId, opts?: { replace?: boolean }) =>
      setParams((prev) => tabParams(prev, tab), { replace: opts?.replace ?? false }),
    [setParams],
  );

  const api = useMemo(
    () => ({
      params,
      tab: parseTab(params.get('tab')),
      search: params.get('q') ?? '',
      bucket: parseBucket(params.get('bucket')),
      /** Режим списка «Заявок»: 'wait' — хотят в группу, 'others' — другие обращения. */
      view: parseView(params.get('view')),
      /** Чип списка обращений; 'open' по умолчанию. */
      otherFilter: parseOtherFilter(params.get('ostate')),
      /** «В работе у»: '' — все, RESP_NOBODY — никто не взял, иначе имя. */
      responsible: params.get('resp') ?? '',
      requestId: parseId(params.get('req')),
      entity: parseEntity(params.get('ent')),
      recordKey: params.get('rec'),
      /** Раздел «Настроек» как в адресе; разбирает его сам раздел. */
      section: params.get('sec'),
    }),
    [params],
  );

  return {
    ...api,
    update,
    goTab,
    setSearch: (q: string) => {
      // Ввод в поиск с другой вкладки переносит на «Заявки»: шапочный поиск ищет именно заявки.
      if (q && api.tab !== 'requests') {
        setParams(
          (prev) => {
            const next = tabParams(prev, 'requests');
            next.set('q', q);
            return next;
          },
          { replace: true },
        );
      } else {
        update({ q: q || null }, { replace: true });
      }
    },
    selectRequest: (id: number) => update({ req: String(id) }),
    // Сменился список — открытая заявка могла из него выпасть, поэтому req сбрасываем, как у чипов.
    setResponsible: (who: string) => update({ resp: who || null, req: null }),
    setBucket: (b: BucketFilter) => update({ bucket: b === 'all' ? null : b, req: null }),
    // Режим списка: открытая карточка и отборы чипов принадлежат прежнему списку и сбрасываются.
    // Поиск и «В работе у» общие для обоих режимов и сохраняются.
    setView: (v: RequestsView) => update({ view: v === 'others' ? 'others' : null, req: null, bucket: null, ostate: null }),
    setOtherFilter: (f: OtherFilter) => update({ ostate: f === 'open' ? null : f, req: null }),
    openRequest: (id: number) => setParams((prev) => {
      const next = tabParams(prev, 'requests');
      next.set('req', String(id));
      return next;
    }),
    closeRequest: () => update({ req: null }),
    /**
     * «Заявки» с отбором «В работе у» (из «Команды»): who === null — заявки, которые никто не взял.
     * Поиск шапки не переносим: он спрятал бы часть заявок, и число в строке «Нагрузки» разошлось бы со списком.
     */
    goResponsible: (who: string | null) => setParams(() => new URLSearchParams({ tab: 'requests', resp: who ?? RESP_NOBODY })),
    /** «Других обращений открыто» в «Команде»: «Заявки» в режиме «Другие обращения». Поиск шапки не переносим, как и у goResponsible. */
    goOthers: () => setParams(() => new URLSearchParams({ tab: 'requests', view: 'others' })),
    goBucket: (b: BucketFilter) => setParams((prev) => {
      const next = tabParams(prev, 'requests');
      if (b !== 'all') next.set('bucket', b);
      return next;
    }),
    /**
     * «Начать обзвон»: вкладка «Заявки» с отбором «К обзвону». firstId — первая заявка очереди,
     * если вызывающий её знает: она сразу открывается в боковой панели.
     */
    goQueue: (firstId?: number) => setParams((prev) => {
      const next = tabParams(prev, 'requests');
      next.set('bucket', 'queue');
      if (firstId !== undefined) next.set('req', String(firstId));
      return next;
    }),
    /** «Настройки» сразу на нужном разделе (из подсказки «Включить: Настройки → Помощник»). */
    goSettingsSection: (sec: string) => setParams(() => new URLSearchParams({ tab: 'settings', sec })),
    setEntity: (e: EntityId) =>
      setParams((prev) => {
        const next = tabParams(prev, 'reference');
        if (e !== 'groups') next.set('ent', e);
        return next;
      }),
    openRecord: (key: string) => update({ rec: key }),
    closeRecord: () => update({ rec: null }),
  };
}

export type AppNav = ReturnType<typeof useAppNav>;

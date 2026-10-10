import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { BucketFilter } from '../../entities/buckets';
import {
  parseBucket,
  parseEntity,
  parseId,
  parseTab,
  patchParams,
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
    (tab: TabId) => setParams((prev) => tabParams(prev, tab)),
    [setParams],
  );

  const api = useMemo(
    () => ({
      params,
      tab: parseTab(params.get('tab')),
      search: params.get('q') ?? '',
      bucket: parseBucket(params.get('bucket')),
      requestId: parseId(params.get('req')),
      entity: parseEntity(params.get('ent')),
      recordKey: params.get('rec'),
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
    setBucket: (b: BucketFilter) => update({ bucket: b === 'all' ? null : b, req: null }),
    openRequest: (id: number) => setParams((prev) => {
      const next = tabParams(prev, 'requests');
      next.set('req', String(id));
      return next;
    }),
    closeRequest: () => update({ req: null }),
    goBucket: (b: BucketFilter) => setParams((prev) => {
      const next = tabParams(prev, 'requests');
      if (b !== 'all') next.set('bucket', b);
      return next;
    }),
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

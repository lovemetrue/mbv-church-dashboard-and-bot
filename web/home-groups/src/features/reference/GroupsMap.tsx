import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { GroupItem, MapBootstrap } from '@contracts';
import { apiGet, apiPost } from '../../shared/api/client';
import { useMe } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import { Button } from '../../shared/ui';
import { loadYandexMaps, type YMap, type YMaps, type YPlacemark } from '../../shared/yandexMaps';
import styles from './Reference.module.css';

const t = ru.reference.map;
const MAP_KEY = ['map', 'config'] as const;
/** Центр и масштаб, пока меток нет: Санкт-Петербург с пригородами. */
const CENTER: [number, number] = [59.93, 30.31];

type Kind = 'active' | 'potential';
/** «Закрыта» на карту не идёт; «Потенциальная» — отдельный переключатель, всё остальное (в том числе «Кампания» и «Недвижимость») — «Действующие». */
const kindOf = (g: GroupItem): Kind | null => (g.status === 'Закрыта' ? null : g.status === 'Потенциальная' ? 'potential' : 'active');
const label = (g: GroupItem): string => `${g.no !== null ? `№${g.no}` : g.code}, ${g.leader}`;

/**
 * Карта групп под таблицей «Справочника → Группы». Яндекс.Карты грузятся только по кнопке: у бесплатного ключа лимит открытий
 * в месяц, поэтому скрипт не тянется при каждом заходе на страницу, а открытия считаются на сервере и показаны на кнопке.
 * Метки берутся из координат адресов групп, которые уже лежат в базе (запросов к Яндексу ради меток нет); клик по метке
 * открывает карточку группы. Переключатели «Действующие» / «Потенциальные» меняют метки без перезагрузки карты.
 */
export function GroupsMap({ groups }: { groups: readonly GroupItem[] }) {
  const nav = useAppNav();
  const me = useMe();
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: MAP_KEY, queryFn: ({ signal }) => apiGet<MapBootstrap>('map/config', signal), staleTime: 60_000 });
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [kinds, setKinds] = useState<Record<Kind, boolean>>({ active: true, potential: true });
  const [ymaps, setYmaps] = useState<YMaps | null>(null);
  const [map, setMap] = useState<YMap | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const placemarks = useRef<YPlacemark[]>([]);
  const openRef = useRef(nav.openGroup);
  openRef.current = nav.openGroup;

  const visible = useMemo(() => groups.filter((g) => { const k = kindOf(g); return k !== null && kinds[k]; }), [groups, kinds]);
  const withCoords = useMemo(() => visible.filter((g) => g.coords !== null), [visible]);

  // Карта создаётся, когда скрипт загружен и контейнер уже на странице; при скрытии уничтожается.
  useEffect(() => {
    if (!ymaps || !container.current) return;
    const created = new ymaps.Map(container.current, { center: CENTER, zoom: 9, controls: ['zoomControl', 'fullscreenControl'] });
    setMap(created);
    return () => {
      placemarks.current = [];
      created.destroy();
      setMap(null);
    };
  }, [ymaps]);

  // Метки пересобираются при смене групп или переключателей: карта и скрипт остаются прежними.
  useEffect(() => {
    if (!map || !ymaps) return;
    for (const p of placemarks.current) map.geoObjects.remove(p);
    placemarks.current = withCoords.map((g) => {
      const p = new ymaps.Placemark([g.coords!.lat, g.coords!.lon], { hintContent: label(g) }, {
        preset: kindOf(g) === 'potential' ? 'islands#orangeCircleDotIcon' : 'islands#blueCircleDotIcon',
      });
      p.events.add('click', () => openRef.current(g.id));
      map.geoObjects.add(p);
      return p;
    });
    if (withCoords.length > 0) {
      const lats = withCoords.map((g) => g.coords!.lat);
      const lons = withCoords.map((g) => g.coords!.lon);
      map.setBounds([[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]], { checkZoomRange: true, zoomMargin: 40 });
    }
  }, [map, ymaps, withCoords]);

  async function show() {
    setState('loading');
    try {
      // Открытие считается до загрузки скрипта (его запрос и расходует лимит); если скрипт на странице уже есть, лимит не тратим.
      const boot = window.ymaps ? config.data : await apiPost<MapBootstrap>('map/loaded', {});
      if (boot) queryClient.setQueryData(MAP_KEY, boot);
      if (!boot?.apiKey) { setState('idle'); return; }
      setYmaps(await loadYandexMaps(boot.apiKey));
      setState('ready');
    } catch {
      setState('error');
    }
  }

  function hide() {
    setYmaps(null);
    setState('idle');
  }

  const boot = config.data;
  const noKey = boot !== undefined && boot.apiKey === null;
  const spent = boot !== undefined && boot.loadsThisMonth >= boot.monthlyLimit;
  const noCoords = visible.length - withCoords.length;

  return (
    <section className={styles.mapBox} aria-labelledby="groups-map-title">
      <div className={styles.mapHead}>
        <h3 id="groups-map-title" className={styles.mapTitle}>
          {t.title}
        </h3>
        <div role="group" aria-label={t.filtersLabel} className={styles.mapKinds}>
          <label>
            <input type="checkbox" checked={kinds.active} onChange={(e) => setKinds({ ...kinds, active: e.target.checked })} /> {t.active}
          </label>
          <label>
            <input type="checkbox" checked={kinds.potential} onChange={(e) => setKinds({ ...kinds, potential: e.target.checked })} /> {t.potential}
          </label>
        </div>
        {state === 'ready' ? (
          <Button size="sm" onClick={hide}>
            {t.hide}
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={() => void show()} disabled={state === 'loading' || noKey || boot === undefined}>
            {state === 'loading' ? t.loading : boot ? t.showLeft(boot.loadsThisMonth, boot.monthlyLimit) : t.show}
          </Button>
        )}
      </div>
      {noKey && (
        <p className={styles.mapNote} role="note">
          {t.noKey}{' '}
          {me.data?.role === 'super' && (
            <button type="button" className={styles.mapLink} onClick={() => nav.goSettingsSection('map')}>
              {t.noKeyFix}
            </button>
          )}
        </p>
      )}
      {spent && <p className={styles.mapNote} role="note">{t.limitReached}</p>}
      {state === 'error' && (
        <p className={styles.mapError} role="alert">
          {t.loadError}
        </p>
      )}
      {ymaps && <div ref={container} className={styles.mapCanvas} role="region" aria-label={t.mapLabel} />}
      <p className={styles.mapNote}>{t.count(withCoords.length, noCoords)}</p>
      <p className={styles.mapNote}>{t.hint}</p>
    </section>
  );
}

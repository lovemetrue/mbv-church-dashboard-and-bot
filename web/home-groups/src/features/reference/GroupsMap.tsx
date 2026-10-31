import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { GroupItem, MapBootstrap } from '@contracts';
import { apiGet, apiPost } from '../../shared/api/client';
import { useMe } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { applyFilters, deleteView, EMPTY_TABLE_STATE, loadViews, type SavedView, type TableState } from '../../shared/filters';
import { useAppNav } from '../../shared/nav';
import { Button, Popover } from '../../shared/ui';
import { groupsConfig, myGroupsPreset } from './config';
import { FilterPanel, filterChipLabel } from './FilterPanel';
import { loadYandexMaps, type YMap, type YMaps, type YPlacemark } from '../../shared/yandexMaps';
import styles from './Reference.module.css';

const t = ru.reference.map;
const MAP_KEY = ['map', 'config'] as const;
/** Центр и масштаб, пока меток нет: Санкт-Петербург с пригородами. */
const CENTER: [number, number] = [59.93, 30.31];

type Kind = 'active' | 'potential';
/** «Закрыта» на карту не идёт; «Потенциальная» — отдельный переключатель, всё остальное (в том числе «Кампания» и «Недвижимость») — «Действующие». */
/** Закрытой и аннулированной группе на карте не место: туда не направляют. */
const OFF_MAP: ReadonlySet<string> = new Set(['Закрыта', 'Аннулирована']);
const kindOf = (g: GroupItem): Kind | null => (OFF_MAP.has(g.status) ? null : g.status === 'Потенциальная' ? 'potential' : 'active');
const label = (g: GroupItem): string => `${g.code}, ${g.leader}`;
/** Онлайн-группа помечена районом «Онлайн» (как в подборе, `plan/engine.ts`): своего поля «формат» у группы нет. */
export const ONLINE_DISTRICT = 'Онлайн';
const isOnline = (g: GroupItem): boolean => g.district === ONLINE_DISTRICT;

/**
 * Карта групп под таблицей «Справочника → Группы». Яндекс.Карты грузятся только по кнопке: у бесплатного ключа лимит открытий
 * в месяц, поэтому скрипт не тянется при каждом заходе на страницу, а открытия считаются на сервере и показаны на кнопке.
 * Метки берутся из координат адресов групп, которые уже лежат в базе (запросов к Яндексу ради меток нет); клик по метке
 * открывает карточку группы. Переключатели «Действующие» / «Потенциальные» (они же цвет метки) и окно «Фильтры» с теми же
 * полями и быстрыми отборами, что у таблицы групп (возраст, состав, день, район…), меняют метки без перезагрузки карты.
 */
export function GroupsMap({ groups }: { groups: readonly GroupItem[] }) {
  const nav = useAppNav();
  const me = useMe();
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: MAP_KEY, queryFn: ({ signal }) => apiGet<MapBootstrap>('map/config', signal), staleTime: 60_000 });
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [kinds, setKinds] = useState<Record<Kind, boolean>>({ active: true, potential: true });
  // Карта нужна, чтобы смотреть, где группы есть физически: онлайн-группу (у неё бывает адрес ведущего) по умолчанию прячем.
  const [noOnline, setNoOnline] = useState(true);
  // Отбор карты — свой, не таблицы «Справочника»: по умолчанию на карте все группы, а не только «Принимает новых».
  // Сохранённые виды общие с таблицей групп (их только применяют здесь), поэтому настроенный там вид годится и для карты.
  const [filter, setFilter] = useState<TableState>(EMPTY_TABLE_STATE);
  const [views, setViews] = useState<SavedView[]>(() => loadViews(groupsConfig.id));
  const myName = me.data?.person?.name ?? null;
  const filterConfig = useMemo(
    () => (myName ? { ...groupsConfig, presets: [myGroupsPreset(myName), ...groupsConfig.presets] } : groupsConfig),
    [myName],
  );
  const [ymaps, setYmaps] = useState<YMaps | null>(null);
  const [map, setMap] = useState<YMap | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const placemarks = useRef<YPlacemark[]>([]);
  const openRef = useRef(nav.openGroup);
  openRef.current = nav.openGroup;

  const onMap = useMemo(() => groups.filter((g) => kindOf(g) !== null), [groups]);
  // Строки те же, что в таблице групп: значит, и поля, и значения в окне «Фильтры» совпадают со справочником.
  const rows = useMemo(() => onMap.map(groupsConfig.toRow), [onMap]);
  const visible = useMemo(() => {
    const keep = new Set(applyFilters(rows, filter.filters, groupsConfig.fields).map((r) => r._key));
    return onMap.filter((g) => keep.has(String(g.id)) && kinds[kindOf(g)!] && !(noOnline && isOnline(g)));
  }, [onMap, rows, filter.filters, kinds, noOnline]);
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
          <label>
            <input type="checkbox" checked={noOnline} onChange={(e) => setNoOnline(e.target.checked)} /> {t.noOnline}
          </label>
        </div>
        <Popover label={ru.reference.filters} badge={filter.filters.length || undefined} title={ru.reference.filters}>
          <FilterPanel
            config={filterConfig}
            rows={rows}
            state={filter}
            views={views}
            onChange={setFilter}
            onDeleteView={(name) => setViews(deleteView(groupsConfig.id, name))}
          />
        </Popover>
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
      {filter.filters.length > 0 && (
        <ul className={styles.fchips} aria-label={ru.reference.currentFilter}>
          {filter.filters.map((fl, i) => (
            <li key={`${fl.field}-${fl.op}-${fl.value}-${i}`} className={styles.fchip}>
              {filterChipLabel(fl)}
              <button
                type="button"
                aria-label={`${ru.reference.removeFilter}: ${filterChipLabel(fl)}`}
                onClick={() => setFilter({ ...filter, filters: filter.filters.filter((_, j) => j !== i) })}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
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

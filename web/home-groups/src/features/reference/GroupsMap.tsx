import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { GroupItem, MapBootstrap, MapSnapshotBody, MapSnapshotOk } from '@contracts';
import { apiGet, apiPost } from '../../shared/api/client';
import { mapSnapshotUrl } from '../../shared/api/base';
import { useGroups, useMe } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { applyFilters, deleteView, EMPTY_TABLE_STATE, loadViews, type SavedView, type TableState } from '../../shared/filters';
import { useAppNav } from '../../shared/nav';
import { Button, Popover } from '../../shared/ui';
import { groupsConfig, myGroupsPreset } from './config';
import { FilterPanel, filterChipLabel } from './FilterPanel';
import { mapSession, mapTiming, readMapView, writeMapView, type MapView } from './mapSession';
import { loadYandexMaps, type YMap, type YMaps, type YPlacemark } from '../../shared/yandexMaps';
import styles from './Reference.module.css';

const t = ru.reference.map;
const MAP_KEY = ['map', 'config'] as const;
/** Центр и масштаб, пока вид не выбирали: Санкт-Петербург с пригородами. */
const CENTER: [number, number] = [59.93, 30.31];
const ZOOM = 9;

type Kind = 'active' | 'potential';
/** Закрытой и аннулированной группе на карте не место: туда не направляют. «Потенциальная» — свой переключатель, остальное — «Действующие». */
const OFF_MAP: ReadonlySet<string> = new Set(['Закрыта', 'Аннулирована']);
const kindOf = (g: GroupItem): Kind | null => (OFF_MAP.has(g.status) ? null : g.status === 'Потенциальная' ? 'potential' : 'active');
const label = (g: GroupItem): string => `${g.code}, ${g.leader}`;
/** Онлайн-группа помечена районом «Онлайн» (как в подборе, `plan/engine.ts`): своего поля «формат» у группы нет. */
export const ONLINE_DISTRICT = 'Онлайн';
const isOnline = (g: GroupItem): boolean => g.district === ONLINE_DISTRICT;
/** Цвет метки: «не направлять» — серая, потенциальная — оранжевая, остальные — синие. Те же цвета на снимке (`mapSnapshot.ts`). */
const presetOf = (g: GroupItem): string =>
  g.doNotRefer ? 'islands#grayCircleDotIcon' : kindOf(g) === 'potential' ? 'islands#orangeCircleDotIcon' : 'islands#blueCircleDotIcon';

const shotTime = (iso: string): string =>
  new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Карта групп — одна на «Сегодня» и в «Заявках». Видна всегда, но живой (JS API Яндекса) становится не сразу: у ключа
 * 100 открытий в сутки.
 *
 * - После загрузки страницы (F5, новая вкладка браузера) — снимок из Static API: картинка с метками для последних центра,
 *   масштаба и фильтров, рядом дата. Снимок делает и хранит сервер. «Обновить» включает живую карту (одно открытие в
 *   счётчике) и берёт свежие данные. Без снимка (нет ключа Static API или ещё не снимали) — та же кнопка, «Показать карту».
 * - Когда скрипт уже на странице, карта живая сразу, без кнопки: переходы между вкладками интерфейса лимит не тратят.
 * - Метки (данные групп) фиксируются на момент «Обновить»: между нажатиями картина не меняется, даже если список групп в
 *   фоне обновился. `freshOnOpen` — блок в «Заявках»: раскрыли — данные берутся заново.
 * - Центр, масштаб, переключатели и фильтры помнит браузер (`mapSession.ts`); живая карта шлёт серверу вид для снимка.
 *
 * Камерных групп на карте нет никогда. Группы «Не направлять» скрыты, галочка показывает их серой меткой.
 */
export function GroupsMap({ freshOnOpen = false }: { freshOnOpen?: boolean }) {
  const nav = useAppNav();
  const me = useMe();
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: MAP_KEY, queryFn: ({ signal }) => apiGet<MapBootstrap>('map/config', signal), staleTime: 60_000 });
  const groupsQuery = useGroups();
  const [data, setData] = useState<readonly GroupItem[] | null>(freshOnOpen ? null : mapSession.frozen);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>(mapSession.live ? 'loading' : 'idle');
  const [view, setViewState] = useState<MapView>(readMapView);
  const setView = useCallback((patch: Partial<MapView>) => {
    setViewState((v) => {
      const next = { ...v, ...patch };
      writeMapView(next);
      return next;
    });
  }, []);
  // Отбор карты — свой, не таблицы «Справочника»: по умолчанию на карте все группы, а не только «Принимает новых».
  // Сохранённые виды общие с таблицей групп (их только применяют здесь), поэтому настроенный там вид годится и для карты.
  const filter: TableState = useMemo(() => ({ ...EMPTY_TABLE_STATE, filters: view.filters }), [view.filters]);
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
  // Вид не выбирали — живая карта один раз охватит все метки; выбранный вид не сбиваем.
  const autoFit = useRef(view.center === null);
  // Раскрыли блок в «Заявках» — снимок обновляется от свежих данных, даже если человек ничего не трогал.
  const forcePush = useRef(freshOnOpen);

  const freeze = useCallback((items: readonly GroupItem[]) => {
    mapSession.frozen = items;
    setData(items);
  }, []);

  // Первые данные фиксируются, дальше — только по «Обновить» (или при раскрытии блока в «Заявках»).
  useEffect(() => {
    if (data === null && !freshOnOpen && groupsQuery.data) freeze(groupsQuery.data.items);
  }, [data, freshOnOpen, groupsQuery.data, freeze]);
  useEffect(() => {
    if (!freshOnOpen) return;
    void groupsQuery.refetch().then((r) => { if (r.data) freeze(r.data.items); });
    // Только при раскрытии: дальше данные меняются по «Обновить».
  }, []);

  const base = useMemo(() => (data ?? []).filter((g) => kindOf(g) !== null && !g.chamber), [data]);
  // Строки те же, что в таблице групп: значит, и поля, и значения в окне «Фильтры» совпадают со справочником.
  const rows = useMemo(() => base.map(groupsConfig.toRow), [base]);
  const visible = useMemo(() => {
    const keep = new Set(applyFilters(rows, view.filters, groupsConfig.fields).map((r) => r._key));
    return base.filter((g) => keep.has(String(g.id)) && view.kinds[kindOf(g)!] && !(view.noOnline && isOnline(g)) && (view.noRefer || !g.doNotRefer));
  }, [base, rows, view.filters, view.kinds, view.noOnline, view.noRefer]);
  const withCoords = useMemo(() => visible.filter((g) => g.coords !== null), [visible]);

  const startLive = useCallback(async (count: boolean, refetch: boolean) => {
    setState('loading');
    try {
      // Открытие считается до загрузки скрипта (его запрос и расходует лимит); если скрипт на странице уже есть, лимит не тратим.
      const present = mapSession.live || window.ymaps !== undefined;
      const boot = count && !present ? await apiPost<MapBootstrap>('map/loaded', {}) : queryClient.getQueryData<MapBootstrap>(MAP_KEY);
      if (boot) queryClient.setQueryData(MAP_KEY, boot);
      if (refetch) {
        const fresh = await groupsQuery.refetch();
        if (fresh.data) freeze(fresh.data.items);
      }
      if (!boot?.apiKey) { setState('idle'); return; }
      setYmaps(await loadYandexMaps(boot.apiKey));
      mapSession.live = true;
      setState('ready');
    } catch {
      setState('error');
    }
  }, [queryClient, groupsQuery, freeze]);

  // Скрипт уже загружен на этой странице — карта живая сразу, без кнопки.
  const apiKey = config.data?.apiKey ?? null;
  useEffect(() => {
    if (mapSession.live && apiKey && !ymaps) void startLive(false, false);
  }, [apiKey, ymaps, startLive]);

  // Карта создаётся, когда скрипт загружен и контейнер уже на странице; при уходе со страницы уничтожается.
  useEffect(() => {
    if (!ymaps || !container.current) return;
    const saved = readMapView();
    const created = new ymaps.Map(container.current, { center: saved.center ?? CENTER, zoom: saved.zoom ?? ZOOM, controls: ['zoomControl', 'fullscreenControl'] });
    created.events.add('boundschange', () => setView({ center: created.getCenter(), zoom: created.getZoom() }));
    setMap(created);
    return () => {
      placemarks.current = [];
      created.destroy();
      setMap(null);
    };
  }, [ymaps, setView]);

  // Метки пересобираются при смене данных или переключателей: карта и скрипт остаются прежними.
  useEffect(() => {
    if (!map || !ymaps) return;
    for (const p of placemarks.current) map.geoObjects.remove(p);
    placemarks.current = withCoords.map((g) => {
      const p = new ymaps.Placemark([g.coords!.lat, g.coords!.lon], { hintContent: label(g) }, { preset: presetOf(g) });
      p.events.add('click', () => openRef.current(g.id));
      map.geoObjects.add(p);
      return p;
    });
    if (autoFit.current && withCoords.length > 0) {
      autoFit.current = false;
      const lats = withCoords.map((g) => g.coords!.lat);
      const lons = withCoords.map((g) => g.coords!.lon);
      map.setBounds([[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]], { checkZoomRange: true, zoomMargin: 40 });
      setView({ center: map.getCenter(), zoom: map.getZoom() });
    }
  }, [map, ymaps, withCoords, setView]);

  // Снимок для следующей загрузки страницы: вид и номера групп с метками. Сервер сам берёт координаты и не ходит в
  // Яндекс, если вид и метки те же. После перезагрузки (снимок на экране) первый вид — точка отсчёта, а не повод снимать.
  const boot = config.data;
  const ids = useMemo(() => withCoords.map((g) => g.id).sort((a, b) => a - b), [withCoords]);
  const signature = view.center && view.zoom !== null && data !== null ? JSON.stringify([view.center, view.zoom, ids]) : null;
  useEffect(() => {
    if (!boot?.staticReady || signature === null || !view.center || view.zoom === null) return;
    if (!forcePush.current) {
      if (mapSession.pushed === null && !mapSession.live) { mapSession.pushed = signature; return; }
      if (mapSession.pushed === signature) return;
    }
    const body: MapSnapshotBody = { center: { lat: view.center[0], lon: view.center[1] }, zoom: view.zoom, groupIds: ids };
    const timer = window.setTimeout(() => {
      forcePush.current = false;
      mapSession.pushed = signature;
      apiPost<MapSnapshotOk>('map/snapshot', body)
        .then((r) => queryClient.setQueryData<MapBootstrap>(MAP_KEY, (b) => (b ? { ...b, snapshot: r.snapshot } : b)))
        .catch(() => { /* снимок не обновился — остаётся прежний, живая карта от этого не зависит */ });
    }, mapTiming.snapshotDelayMs);
    return () => window.clearTimeout(timer);
  }, [boot?.staticReady, signature, ids, view.center, view.zoom, queryClient]);

  const noKey = boot !== undefined && boot.apiKey === null;
  const spent = boot !== undefined && boot.loadsToday >= boot.dailyLimit;
  const noCoords = visible.length - withCoords.length;
  const live = ymaps !== null;
  const snapshot = !live && state !== 'loading' ? (boot?.snapshot ?? null) : null;
  const buttonText = state === 'loading'
    ? t.loading
    : live || mapSession.live
      ? t.refresh
      : boot
        ? (boot.snapshot ? t.refreshLeft : t.showLeft)(boot.loadsToday, boot.dailyLimit)
        : t.show;

  return (
    <section className={styles.mapBox} aria-labelledby="groups-map-title">
      <div className={styles.mapHead}>
        <h3 id="groups-map-title" className={styles.mapTitle}>
          {t.title}
        </h3>
        <div role="group" aria-label={t.filtersLabel} className={styles.mapKinds}>
          <label>
            <input type="checkbox" checked={view.kinds.active} onChange={(e) => setView({ kinds: { ...view.kinds, active: e.target.checked } })} /> {t.active}
          </label>
          <label>
            <input type="checkbox" checked={view.kinds.potential} onChange={(e) => setView({ kinds: { ...view.kinds, potential: e.target.checked } })} /> {t.potential}
          </label>
          <label>
            <input type="checkbox" checked={view.noOnline} onChange={(e) => setView({ noOnline: e.target.checked })} /> {t.noOnline}
          </label>
          <label>
            <input type="checkbox" checked={view.noRefer} onChange={(e) => setView({ noRefer: e.target.checked })} /> {t.noRefer}
          </label>
        </div>
        <Popover label={ru.reference.filters} badge={view.filters.length || undefined} title={ru.reference.filters}>
          <FilterPanel
            config={filterConfig}
            rows={rows}
            state={filter}
            views={views}
            onChange={(next) => setView({ filters: next.filters })}
            onDeleteView={(name) => setViews(deleteView(groupsConfig.id, name))}
          />
        </Popover>
        <Button size="sm" variant="primary" onClick={() => void startLive(true, true)} disabled={state === 'loading' || noKey || boot === undefined}>
          {buttonText}
        </Button>
      </div>
      {view.filters.length > 0 && (
        <ul className={styles.fchips} aria-label={ru.reference.currentFilter}>
          {view.filters.map((fl, i) => (
            <li key={`${fl.field}-${fl.op}-${fl.value}-${i}`} className={styles.fchip}>
              {filterChipLabel(fl)}
              <button
                type="button"
                aria-label={`${ru.reference.removeFilter}: ${filterChipLabel(fl)}`}
                onClick={() => setView({ filters: view.filters.filter((_, j) => j !== i) })}
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
      {spent && !live && <p className={styles.mapNote} role="note">{t.limitReached}</p>}
      {state === 'error' && (
        <p className={styles.mapError} role="alert">
          {t.loadError}
        </p>
      )}
      {live && <div ref={container} className={styles.mapCanvas} role="region" aria-label={t.mapLabel} />}
      {snapshot && (
        <>
          <img className={styles.mapShot} src={mapSnapshotUrl(snapshot.takenAt)} alt={t.snapshotAlt} width={650} height={450} />
          <p className={styles.mapNote}>{t.snapshotAt(shotTime(snapshot.takenAt), snapshot.skipped)}</p>
        </>
      )}
      <p className={styles.mapNote}>{t.count(withCoords.length, noCoords)}</p>
      <p className={styles.mapNote}>{t.hint}</p>
    </section>
  );
}

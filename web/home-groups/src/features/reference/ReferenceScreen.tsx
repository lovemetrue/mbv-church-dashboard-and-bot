import { useCanChange } from '../../shared/access';
import { GenderAiButton } from '../gender/GenderAiButton';
import { useMemo, useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useCoordinators, useGroups, useMe, usePeople } from '../../shared/api/queries';
import {
  applyFilters,
  deleteView,
  filterLabel,
  groupRows,
  loadViews,
  saveView,
  searchRows,
  sortRows,
  type Filter,
  type Row,
  type SavedView,
  type TableState,
} from '../../shared/filters';
import { downloadCsv, toCsv } from '../../shared/csv';
import { ru } from '../../shared/i18n/ru';
import { ENTITY_IDS, useAppNav, type EntityId } from '../../shared/nav';
import { CoordinatorDialog } from '../create/CreateDialog';
import { Button, Chip, ErrorState, LoadingState, Popover } from '../../shared/ui';
import { CoordinatorCard, GroupCard, PersonCard } from './Cards';
import { coordinatorsConfig, groupsConfig, myGroupsPreset, peopleConfig, type EntityConfig } from './config';
import { FilterPanel, OP_SYMBOL } from './FilterPanel';
import { ReferenceTable } from './ReferenceTable';
import { useTableState } from './useTableState';
import { ViewPanel } from './ViewPanel';
import styles from './Reference.module.css';

const LABELS: Record<EntityId, string> = {
  groups: ru.reference.groups,
  people: ru.reference.people,
  coordinators: ru.reference.coordinators,
};

/** Подпись чипа отбора. «≠» читается как «не», потому что «Статус ≠ Закрыта» человеку труднее, чем «Статус: не «Закрыта»». */
const chipLabel = (fl: Filter): string =>
  fl.op === 'ne' ? ru.reference.notEqualChip(fl.field, fl.value) : filterLabel(fl, OP_SYMBOL);

export function ReferenceScreen() {
  const nav = useAppNav();
  const groups = useGroups();
  const people = usePeople();
  // «Координаторов» вход «Только чтение» смотрит, но не добавляет: кнопки «+ Добавить координатора» у него нет.
  const canChange = useCanChange();
  const coordinators = useCoordinators();
  const counts: Record<EntityId, number | undefined> = {
    groups: groups.data?.items.length,
    people: people.data?.items.length,
    coordinators: coordinators.data?.items.length,
  };

  return (
    <div>
      <div className={styles.ents} role="group" aria-label={ru.reference.entitiesLabel}>
        {ENTITY_IDS.map((id) => (
          <Chip key={id} shape="block" pressed={nav.entity === id} count={counts[id]} onClick={() => nav.setEntity(id)}>
            {LABELS[id]}
          </Chip>
        ))}
      </div>
      {nav.entity === 'groups' && (
        <GroupsWorkplace />
      )}
      {nav.entity === 'people' && (
        <EntityView
          key="people"
          config={peopleConfig}
          query={people}
          items={people.data?.items}
          renderCard={(p, close) => <PersonCard p={p} onClose={close} />}
          actions={<GenderAiButton items={people.data?.items} />}
        />
      )}
      {nav.entity === 'coordinators' && (
        <EntityView
          key="coordinators"
          config={coordinatorsConfig}
          query={coordinators}
          items={coordinators.data?.items}
          renderCard={(c, close) => <CoordinatorCard c={c} onClose={close} />}
          actions={canChange ? <AddCoordinator /> : undefined}
        />
      )}
    </div>
  );
}

/**
 * «+ Добавить координатора» прямо над списком координаторов: нового человека команды заводят там, где его ищут, а не
 * через меню «+ Создать» в шапке. После сохранения открывается его карточка — сразу видно, что он в списке.
 */
function AddCoordinator() {
  const nav = useAppNav();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
        {ru.reference.addCoordinator}
      </Button>
      {open && (
        <CoordinatorDialog
          onClose={() => setOpen(false)}
          onCreated={(id) => {
            setOpen(false);
            nav.openRecord(String(id));
          }}
        />
      )}
    </>
  );
}

/**
 * Таблица групп: одна и та же в «Справочнике → Группы» и на вкладке «Группы». Отборы, столбцы, сортировка и сохранённые
 * виды общие (хранятся по имени справочника `groups`), поэтому настроенное в одном месте видно и в другом.
 */
export function GroupsWorkplace() {
  const groups = useGroups();
  const person = useMe().data?.person;
  const myName = person?.name ?? null;
  // Старший координатор и катализатор смотрят за всеми группами, даже если они ещё и координаторы своих.
  const kinds = person?.teamKinds ?? [];
  const coordinator = kinds.includes('coordinator') && !kinds.includes('senior') && !kinds.includes('catalyst');
  // При личном входе первым быстрым отбором — «Мои группы». Координатору он ещё и стоит по умолчанию вместо «Принимает
  // новых» (чипы снимаются): ему по работе нужны все свои группы, включая «Не направлять», а чужие — нет.
  const config = useMemo(() => {
    if (!myName) return groupsConfig;
    const mine = myGroupsPreset(myName);
    return { ...groupsConfig, presets: [mine, ...groupsConfig.presets], ...(coordinator ? { defaultFilters: mine.filters } : {}) };
  }, [myName, coordinator]);
  return (
    <EntityView
      key="groups"
      config={config}
      query={groups}
      items={groups.data?.items}
      renderCard={(g, close) => <GroupCard g={g} onClose={close} />}
    />
  );
}

interface EntityViewProps<T> {
  config: EntityConfig<T>;
  query: UseQueryResult<unknown>;
  items: readonly T[] | undefined;
  renderCard: (item: T, close: () => void) => React.ReactNode;
  /** Блок под таблицей (у групп — карта). */
  extra?: React.ReactNode;
  /** Кнопки справа в строке инструментов (у координаторов — «Добавить координатора»). */
  actions?: React.ReactNode;
}

function EntityView<T>({ config, query, items, renderCard, extra, actions }: EntityViewProps<T>) {
  const nav = useAppNav();
  const { state, setState, columns } = useTableState(config);
  const [views, setViews] = useState<SavedView[]>(() => loadViews(config.id));

  const allRows = useMemo<Row[]>(() => (items ?? []).map(config.toRow), [items, config]);
  const groups = useMemo(() => {
    const filtered = searchRows(applyFilters(allRows, state.filters, config.fields), state.text);
    const sorted = sortRows(filtered, state.sort, config.fields);
    return groupRows(sorted, state.group);
  }, [allRows, state.filters, state.text, state.sort, state.group, config.fields]);
  const shown = groups.reduce((n, g) => n + g.rows.length, 0);

  if (query.isPending) return <LoadingState lines={6} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const selected = nav.recordKey ? (items ?? []).find((i) => config.keyOf(i) === nav.recordKey) : undefined;
  const titleOf = (key: string): string => {
    const item = (items ?? []).find((i) => config.keyOf(i) === key);
    return item ? config.titleOf(item) : key;
  };

  const sortBy = (column: string) => {
    const cur = state.sort;
    const next: TableState['sort'] =
      cur?.field !== column ? { field: column, dir: 'asc' } : cur.dir === 'asc' ? { field: column, dir: 'desc' } : null;
    setState({ ...state, sort: next });
  };

  // Выгружаем то, что человек видит: после отборов, поиска и сортировки, в порядке и составе столбцов таблицы.
  const exportCsv = () => {
    const cols = config.columns.filter((c) => columns.includes(c));
    const date = new Date().toLocaleDateString('sv-SE');
    downloadCsv(
      `${config.id}-${date}.csv`,
      toCsv(cols, groups.flatMap((g) => g.rows).map((r) => cols.map((c) => r[c] ?? null))),
    );
  };

  return (
    <>
      <div className={styles.toolbar}>
        <Popover label={ru.reference.filters} badge={state.filters.length || undefined} title={ru.reference.filters}>
          <FilterPanel
            config={config}
            rows={allRows}
            state={state}
            views={views}
            onChange={setState}
            onSaveView={(name) =>
              setViews(saveView(config.id, { name, filters: state.filters, columns: state.columns ?? undefined, group: state.group, sort: state.sort }))
            }
            onDeleteView={(name) => setViews(deleteView(config.id, name))}
          />
        </Popover>
        <Popover label={ru.reference.viewOfTable} title={ru.reference.viewOfTable}>
          <ViewPanel config={config} state={state} columns={columns} onChange={setState} />
        </Popover>
        <label className="visually-hidden" htmlFor="ref-search">
          {ru.reference.searchLabel}
        </label>
        <input
          id="ref-search"
          className={styles.search}
          type="search"
          placeholder={ru.reference.searchPlaceholder}
          value={state.text}
          onChange={(e) => setState({ ...state, text: e.target.value })}
        />
        <span className={styles.spacer} />
        <span className={`${styles.shown} num`} role="status">
          {ru.reference.shown(shown, allRows.length)}
        </span>
        <Button size="sm" onClick={exportCsv} disabled={shown === 0}>
          {ru.reference.exportCsv}
        </Button>
        {actions}
      </div>

      {state.filters.length > 0 && (
        <ul className={styles.fchips} aria-label={ru.reference.currentFilter}>
          {state.filters.map((fl, i) => (
            <li key={`${fl.field}-${fl.op}-${fl.value}-${i}`} className={styles.fchip}>
              {chipLabel(fl)}
              <button
                type="button"
                aria-label={`${ru.reference.removeFilter}: ${chipLabel(fl)}`}
                onClick={() => setState({ ...state, filters: state.filters.filter((_, j) => j !== i) })}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <ReferenceTable
        label={config.label}
        columns={config.columns.filter((c) => columns.includes(c))}
        groups={groups}
        grouped={state.group !== null}
        total={allRows.length}
        sort={state.sort}
        selectedKey={nav.recordKey}
        titleOf={titleOf}
        onSort={sortBy}
        onSelect={nav.openRecord}
      />
      {extra}
      {selected && renderCard(selected, nav.closeRecord)}
    </>
  );
}

import { useMemo, useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useCoordinators, useGroups, usePeople } from '../../shared/api/queries';
import {
  applyFilters,
  deleteView,
  filterLabel,
  groupRows,
  loadViews,
  saveView,
  searchRows,
  sortRows,
  type Row,
  type SavedView,
  type TableState,
} from '../../shared/filters';
import { ru } from '../../shared/i18n/ru';
import { ENTITY_IDS, useAppNav, type EntityId } from '../../shared/nav';
import { Button, Chip, ErrorState, LoadingState, Popover } from '../../shared/ui';
import { CoordinatorCard, GroupCard, PersonCard } from './Cards';
import { coordinatorsConfig, groupsConfig, peopleConfig, type EntityConfig } from './config';
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

export function ReferenceScreen() {
  const nav = useAppNav();
  const groups = useGroups();
  const people = usePeople();
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
          <Chip key={id} pressed={nav.entity === id} count={counts[id]} onClick={() => nav.setEntity(id)}>
            {LABELS[id]}
          </Chip>
        ))}
      </div>
      {nav.entity === 'groups' && (
        <EntityView
          key="groups"
          config={groupsConfig}
          query={groups}
          items={groups.data?.items}
          renderCard={(g, close) => <GroupCard g={g} onClose={close} />}
        />
      )}
      {nav.entity === 'people' && (
        <EntityView
          key="people"
          config={peopleConfig}
          query={people}
          items={people.data?.items}
          renderCard={(p, close) => <PersonCard p={p} onClose={close} />}
        />
      )}
      {nav.entity === 'coordinators' && (
        <EntityView
          key="coordinators"
          config={coordinatorsConfig}
          query={coordinators}
          items={coordinators.data?.items}
          renderCard={(c, close) => <CoordinatorCard c={c} onClose={close} />}
        />
      )}
    </div>
  );
}

interface EntityViewProps<T> {
  config: EntityConfig<T>;
  query: UseQueryResult<unknown>;
  items: readonly T[] | undefined;
  renderCard: (item: T, close: () => void) => React.ReactNode;
}

function EntityView<T>({ config, query, items, renderCard }: EntityViewProps<T>) {
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
        <Button size="sm" soon>
          {ru.reference.exportCsv}
        </Button>
      </div>

      {state.filters.length > 0 && (
        <ul className={styles.fchips} aria-label={ru.reference.currentFilter}>
          {state.filters.map((fl, i) => (
            <li key={`${fl.field}-${fl.op}-${fl.value}-${i}`} className={styles.fchip}>
              {filterLabel(fl, OP_SYMBOL)}
              <button
                type="button"
                aria-label={`${ru.reference.removeFilter}: ${filterLabel(fl, OP_SYMBOL)}`}
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
      {selected && renderCard(selected, nav.closeRecord)}
    </>
  );
}

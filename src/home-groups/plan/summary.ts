import type { CellLevel, Cluster, MatrixCell, MatrixRow, Single } from '../contracts.js';
import { needsHuman } from './engine.js';
import { AGE_COLUMNS, ageColumnOf, ageColumnsOverlapping } from './parse.js';
import type { Day, PlanGroup, SummaryInput, TodaySummary } from './types.js';

/**
 * Агрегаты экрана «Сегодня»: матрица «район × возраст», кластеры «не хватает группы» и
 * одиночные ситуации, где сервис не справился. Чистые функции от плана и данных.
 */

const ACCEPTING_STATUSES = new Set(['Функционирует', 'Кампания']);
const DAY_ORDER: readonly Day[] = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
/** Группа без района — не строка матрицы: непонятно, кому из районов её места засчитывать. */
const NO_DISTRICT = 'Не указан';
/** Меньше двух человек — уже не «не хватает группы», а одиночный случай. */
const CLUSTER_MIN = 2;

/** Группа, которая реально принимает новых людей прямо сейчас. */
function isAccepting(g: PlanGroup): boolean {
  return ACCEPTING_STATUSES.has(g.status) && g.acceptsNew && !g.doNotRefer;
}

function levelOf(demand: number, supply: number): CellLevel {
  if (demand > 0 && supply === 0) return 'crit';
  if (supply - demand < 0) return 'warn';
  if (supply === 0 && demand === 0) return 'zero';
  return 'ok';
}

/**
 * Матрица «район × возраст». Спрос — открытые заявки с известными районом и возрастом. Предложение —
 * свободные места групп, которые принимают новых. Группа с несколькими возрастными колонками считается
 * во всех, которые она задевает; группа с неизвестным возрастом — во всех колонках, потому что по
 * возрасту её не отсеять. Поэтому сумма по строке может быть больше числа мест: места «общие» для колонок.
 * Район показывается, только если в нём есть спрос или места: пустые строки экран засоряют.
 */
function buildMatrix(input: SummaryInput): MatrixRow[] {
  const demand = new Map<string, Map<string, number>>();
  const supply = new Map<string, Map<string, number>>();
  const bump = (table: Map<string, Map<string, number>>, district: string, column: string, by: number): void => {
    const row = table.get(district) ?? new Map<string, number>();
    row.set(column, (row.get(column) ?? 0) + by);
    table.set(district, row);
  };

  for (const r of input.requests) {
    const column = ageColumnOf(r.ageRange);
    if (r.district !== null && column !== null) bump(demand, r.district, column, 1);
  }
  for (const g of input.groups) {
    if (!isAccepting(g) || g.district === NO_DISTRICT) continue;
    const free = g.capacity - (g.people ?? 0);
    if (free <= 0) continue;
    for (const column of ageColumnsOverlapping(g.ageRange)) bump(supply, g.district, column, free);
  }

  const totalDemand = (district: string): number => [...(demand.get(district)?.values() ?? [])].reduce((a, b) => a + b, 0);
  const districts = new Set([...demand.keys(), ...supply.keys()]);
  return [...districts]
    .sort((a, b) => totalDemand(b) - totalDemand(a) || a.localeCompare(b, 'ru'))
    .map((district): MatrixRow => ({
      district,
      cells: AGE_COLUMNS.map((age): MatrixCell => {
        const d = demand.get(district)?.get(age) ?? 0;
        const s = supply.get(district)?.get(age) ?? 0;
        return { age, demand: d, supply: s, net: s - d, level: levelOf(d, s) };
      }),
    }));
}

/**
 * Имя для подписи. ФИО в таблице церкви записано «Фамилия Имя Отчество», поэтому имя — второе слово;
 * из одного слова берём его же: лучше показать фамилию, чем пустое место.
 */
function firstNameOf(fio: string): string {
  const words = fio.trim().split(/\s+/).filter(Boolean);
  return words.length >= 2 ? words[1]! : (words[0] ?? '');
}

function buildClusters(input: SummaryInput): Cluster[] {
  const byDistrict = new Map<string, SummaryInput['requests']>();
  for (const r of input.requests) {
    const entry = input.entries.get(r.id);
    if (entry?.kind !== 'none' || entry.code !== 'nogroup' || r.district === null) continue;
    byDistrict.set(r.district, [...(byDistrict.get(r.district) ?? []), r]);
  }

  const clusters: Cluster[] = [];
  for (const [district, members] of byDistrict) {
    if (members.length < CLUSTER_MIN) continue;
    const sorted = [...members].sort((a, b) => a.id - b.id);

    const columns = new Set(sorted.map((r) => ageColumnOf(r.ageRange)).filter((c): c is string => c !== null));
    const dayCounts = new Map<Day, number>();
    for (const r of sorted) for (const day of new Set(r.days)) dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);

    clusters.push({
      district,
      requestIds: sorted.map((r) => r.id),
      firstNames: sorted.map((r) => firstNameOf(r.fio)),
      ages: AGE_COLUMNS.filter((c) => columns.has(c)),
      days: [...dayCounts]
        .sort(([a, na], [b, nb]) => nb - na || DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b))
        .slice(0, 2)
        .map(([day]) => day),
    });
  }
  return clusters.sort((a, b) => b.requestIds.length - a.requestIds.length || a.district.localeCompare(b.district, 'ru'));
}

function buildSingles(input: SummaryInput, clustered: ReadonlySet<number>): Single[] {
  const singles: Single[] = [];
  for (const r of [...input.requests].sort((a, b) => a.id - b.id)) {
    if (clustered.has(r.id)) continue;
    const entry = input.entries.get(r.id);
    if (!needsHuman(entry, input.settings)) continue;
    const reason =
      entry?.kind === 'none'
        ? entry.reason
        : entry?.kind === 'proposal'
          ? `Уверенность плана низкая (${entry.confidence})`
          : 'План не составлен';
    singles.push({ requestId: r.id, fio: r.fio, place: r.place, reason });
  }
  return singles;
}

export function buildTodaySummary(input: SummaryInput): TodaySummary {
  const clusters = buildClusters(input);
  const clustered = new Set(clusters.flatMap((c) => c.requestIds));
  return {
    ageColumns: [...AGE_COLUMNS],
    matrix: buildMatrix(input),
    clusters,
    singles: buildSingles(input, clustered),
  };
}

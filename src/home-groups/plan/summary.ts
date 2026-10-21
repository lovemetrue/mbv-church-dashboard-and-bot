import type { CellLevel, Cluster, MatrixCell, MatrixRow, Single } from '../contracts.js';
import { needsHuman } from './engine.js';
import { AGE_COLUMNS, ageColumnOf, ageColumnsOverlapping } from './parse.js';
import type { Day, PlanGroup, SummaryInput, TodaySummary } from './types.js';

/**
 * Агрегаты экрана «Сегодня»: матрица «район × возраст», кластеры «не хватает группы» и
 * одиночные ситуации, где сервис не справился. Чистые функции от плана и данных.
 */

const ACCEPTING_STATUSES = new Set(['Функционирует']);
const DAY_ORDER: readonly Day[] = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
/** Группа без района — не строка матрицы: непонятно, кому из районов её места засчитывать. */
const NO_DISTRICT = 'Не указан';
/** Особая строка и колонка матрицы для заявок без района и без возраста (названия видит человек). */
export const NO_DISTRICT_ROW = 'Район не определён';
export const NO_AGE_COLUMN = 'Возраст не указан';
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
  type Slot = { demand: number; supply: number; requestIds: number[]; groupIds: number[] };
  const table = new Map<string, Map<string, Slot>>();
  const slot = (district: string, column: string): Slot => {
    const row = table.get(district) ?? new Map<string, Slot>();
    const cell = row.get(column) ?? { demand: 0, supply: 0, requestIds: [], groupIds: [] };
    row.set(column, cell);
    table.set(district, row);
    return cell;
  };

  // Спрос — все открытые заявки: без района они идут в особую строку, без возраста — в особую колонку.
  // Прятать их нельзя: именно это «пульт» и должен показывать как проблему.
  for (const r of input.requests) {
    const cell = slot(r.district ?? NO_DISTRICT_ROW, ageColumnOf(r.ageRange) ?? NO_AGE_COLUMN);
    cell.demand += 1;
    cell.requestIds.push(r.id);
  }
  for (const g of input.groups) {
    if (!isAccepting(g) || g.district === NO_DISTRICT) continue;
    const free = g.capacity - (g.people ?? 0);
    if (free <= 0) continue;
    for (const column of ageColumnsOverlapping(g.ageRange)) {
      const cell = slot(g.district, column);
      cell.supply += free;
      cell.groupIds.push(g.id);
    }
  }

  // Места района без двойного счёта: каждая группа один раз.
  const freeByDistrict = new Map<string, number>();
  for (const g of input.groups) {
    if (!isAccepting(g) || g.district === NO_DISTRICT) continue;
    const free = g.capacity - (g.people ?? 0);
    if (free > 0) freeByDistrict.set(g.district, (freeByDistrict.get(g.district) ?? 0) + free);
  }

  const totalDemand = (district: string): number => [...(table.get(district)?.values() ?? [])].reduce((sum, c) => sum + c.demand, 0);
  const columns = [...AGE_COLUMNS, NO_AGE_COLUMN];
  return [...table.keys()]
    .sort((a, b) => totalDemand(b) - totalDemand(a) || a.localeCompare(b, 'ru'))
    .map((district): MatrixRow => ({
      district,
      supplyTotal: freeByDistrict.get(district) ?? 0,
      cells: columns.map((age): MatrixCell => {
        const c = table.get(district)?.get(age) ?? { demand: 0, supply: 0, requestIds: [], groupIds: [] };
        return { age, demand: c.demand, supply: c.supply, net: c.supply - c.demand, level: levelOf(c.demand, c.supply), requestIds: c.requestIds, groupIds: c.groupIds };
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
    ageColumns: [...AGE_COLUMNS, NO_AGE_COLUMN],
    matrix: buildMatrix(input),
    clusters,
    singles: buildSingles(input, clustered),
  };
}

import type { MatrixCell, MatrixRow, TodayView } from '@contracts';
import { FORMS, plural, pluralForm } from '../../entities/plural';
import { ru } from '../../shared/i18n/ru';

/**
 * Особые строка и колонка матрицы приходят с сервера как строковые литералы (в контракте для них нет
 * констант), поэтому сравниваем по тексту. В них есть только спрос: групп для таких заявок не подбирают.
 */
export const UNKNOWN_DISTRICT = 'Район не определён';
export const UNKNOWN_AGE = 'Возраст не указан';

export const isUnknownDistrict = (district: string): boolean => district === UNKNOWN_DISTRICT;
export const isUnknownAge = (age: string): boolean => age === UNKNOWN_AGE;

/** Режим показа клетки: что писать крупно. */
export type MatrixMode = 'balance' | 'waiting' | 'places';
export const MATRIX_MODES: readonly MatrixMode[] = ['balance', 'waiting', 'places'];
/** shortage — сначала районы, где хуже всего; alpha — по алфавиту. */
export type MatrixSort = 'shortage' | 'alpha';
export const MATRIX_SORTS: readonly MatrixSort[] = ['shortage', 'alpha'];

export interface MatrixPrefs {
  mode: MatrixMode;
  hideEmpty: boolean;
  sort: MatrixSort;
}

export const DEFAULT_PREFS: MatrixPrefs = { mode: 'balance', hideEmpty: true, sort: 'shortage' };

// Формы слов. «Не хватает 1 места / 2 мест» — родительный падеж, «свободно 1 место / 2 места» — именительный:
// после «не хватает» и после «свободно» слово стоит в разных падежах, одной формой не обойтись.
const PLACE_NOM = ['место', 'места', 'мест'] as const;
const PLACE_GEN = ['места', 'мест', 'мест'] as const;
const GROUP_LOC = ['группе', 'группах', 'группах'] as const;

export const placeWord = (n: number): string => pluralForm(n, PLACE_NOM);

/** «Выборгский район»; у «Ленинградская область» и «Онлайн» слова «район» не добавляем. */
export function districtName(district: string): string {
  if (isUnknownDistrict(district)) return district;
  return /(ий|ый|ой)$/.test(district) ? `${district} район` : district;
}

/** «26–35 лет», «46+ лет», «возраст не указан». */
export function ageName(age: string): string {
  return isUnknownAge(age) ? 'возраст не указан' : `${age} лет`;
}

/** Заголовок панели: «Выборгский · 26–35». */
export const cellTitle = (district: string, age: string): string => `${district} · ${age}`;

/**
 * Фраза-итог клетки, по ней же подсказка при наведении:
 * «Выборгский район, 26–35 лет: ждут 1 человек, свободно 10 мест в 2 группах. Мест хватает с запасом 9.»
 */
export function cellSummary(district: string, age: string, cell: MatrixCell): string {
  const head = `${districtName(district)}, ${ageName(age)}`;
  const special = isUnknownDistrict(district) || isUnknownAge(age);
  if (special) {
    const what = isUnknownDistrict(district) && isUnknownAge(age) ? 'района и возраста' : isUnknownDistrict(district) ? 'района' : 'возраста';
    if (cell.demand === 0) return `${head}: заявок нет.`;
    return `${head}: ждут ${plural(cell.demand, FORMS.person)}. Для заявок без ${what} группы не подбираются.`;
  }
  if (cell.demand === 0 && cell.supply === 0) return `${head}: нет ни желающих, ни мест.`;
  const wait = cell.demand > 0 ? `ждут ${plural(cell.demand, FORMS.person)}` : 'желающих нет';
  const seats =
    cell.supply > 0
      ? `свободно ${cell.supply} ${placeWord(cell.supply)} в ${cell.groupIds.length} ${pluralForm(cell.groupIds.length, GROUP_LOC)}`
      : 'свободных мест нет';
  let verdict: string;
  if (cell.net > 0) verdict = `Мест хватает с запасом ${cell.net}.`;
  else if (cell.net < 0) verdict = `Не хватает ${Math.abs(cell.net)} ${pluralForm(Math.abs(cell.net), PLACE_GEN)}.`;
  else verdict = 'Мест ровно столько, сколько желающих.';
  return `${head}: ${wait}, ${seats}. ${verdict}`;
}

/** Подпись клетки словами: крупное, пояснение и мелкая строка. */
export interface CellLabel {
  big: string;
  word: string;
  small: string | null;
}

/** «+3», «−2», «0»: знак всегда виден, минус настоящий, а не дефис. */
export function netText(net: number): string {
  if (net > 0) return `+${net}`;
  if (net < 0) return `−${Math.abs(net)}`;
  return '0';
}

export function cellLabel(cell: MatrixCell, mode: MatrixMode, special: boolean): CellLabel {
  const empty = cell.demand === 0 && cell.supply === 0;
  if (special) {
    // Мест здесь нет по определению: «баланс» и «места» не имеют смысла, показываем только ожидающих.
    if (mode === 'places') return { big: '—', word: 'не подбираются', small: null };
    if (cell.demand === 0) return { big: '—', word: 'пусто', small: null };
    return { big: String(cell.demand), word: pluralForm(cell.demand, FORMS.person), small: 'группы не подбираются' };
  }
  if (mode === 'waiting') {
    return cell.demand > 0
      ? { big: String(cell.demand), word: pluralForm(cell.demand, FORMS.person), small: null }
      : { big: '0', word: 'никого', small: null };
  }
  if (mode === 'places') {
    return cell.supply > 0
      ? {
          big: String(cell.supply),
          word: placeWord(cell.supply),
          small: `в ${cell.groupIds.length} ${pluralForm(cell.groupIds.length, GROUP_LOC)}`,
        }
      : { big: '0', word: 'мест нет', small: null };
  }
  const small = `ждут ${cell.demand} · мест ${cell.supply}`;
  // У пустой клетки «ждут 0 · мест 0» — шум: их десятки, и они глушат те, где что-то есть.
  if (empty) return { big: '—', word: 'пусто', small: null };
  if (cell.net > 0) return { big: netText(cell.net), word: 'хватает', small };
  if (cell.net < 0) return { big: netText(cell.net), word: 'не хватает', small };
  return { big: '0', word: 'впритык', small };
}

/** «Скрыто: 2 пустых района, 1 пустой возраст.» — чтобы было понятно, куда делись строки; пусто, если ничего не скрыто. */
export function hiddenNote(rows: number, ages: number): string {
  const parts = [
    rows > 0 ? `${rows} ${pluralForm(rows, ['пустой район', 'пустых района', 'пустых районов'])}` : '',
    ages > 0 ? `${ages} ${pluralForm(ages, ['пустой возраст', 'пустых возраста', 'пустых возрастов'])}` : '',
  ].filter(Boolean);
  return parts.length ? `${ru.today.hidden} ${parts.join(', ')}.` : '';
}

// ── видимая часть и итоги ───────────────────────────────────────────────────

export interface Totals {
  demand: number;
  supply: number;
}

const sumCells = (cells: readonly MatrixCell[]): Totals =>
  cells.reduce((t, c) => ({ demand: t.demand + c.demand, supply: t.supply + c.supply }), { demand: 0, supply: 0 });

/** Места в итоге района берём с сервера: по ячейкам группа с несколькими возрастами посчиталась бы дважды. */
export const rowTotals = (row: MatrixRow): Totals => ({ demand: sumCells(row.cells).demand, supply: row.supplyTotal });
export const colTotals = (rows: readonly MatrixRow[], age: string): Totals =>
  sumCells(rows.flatMap((r) => r.cells.filter((c) => c.age === age)));
export const grandTotals = (rows: readonly MatrixRow[]): Totals => ({
  demand: sumCells(rows.flatMap((r) => r.cells)).demand,
  supply: rows.reduce((s, r) => s + r.supplyTotal, 0),
});

const isEmptyTotals = (t: Totals): boolean => t.demand === 0 && t.supply === 0;

/** Насколько району не хватает мест: сумма нехватки по возрастам. Чем больше, тем он выше. */
export function shortageOf(row: MatrixRow): number {
  return row.cells.reduce((s, c) => s + Math.max(0, -c.net), 0);
}

export interface MatrixView {
  rows: MatrixRow[];
  ages: string[];
  hiddenRows: number;
  hiddenAges: number;
}

/**
 * Что показывать. Пустые (ни спроса, ни мест во всей строке или колонке) прячутся — так таблица
 * помещается на экран. Особые строка и колонка всегда стоят последними и не участвуют в сортировке:
 * это не район и не возраст, а «сюда попало то, что не разобрали».
 */
export function buildView(data: TodayView, prefs: Pick<MatrixPrefs, 'hideEmpty' | 'sort'>): MatrixView {
  const emptyAges = new Set(
    data.ageColumns.filter((age) => isEmptyTotals(colTotals(data.matrix, age))),
  );
  const emptyRows = new Set(data.matrix.filter((r) => isEmptyTotals(rowTotals(r))).map((r) => r.district));
  const dropRows = prefs.hideEmpty ? emptyRows : new Set<string>();
  const dropAges = prefs.hideEmpty ? emptyAges : new Set<string>();

  const ages = [...data.ageColumns.filter((a) => !dropAges.has(a) && !isUnknownAge(a)), ...data.ageColumns.filter((a) => isUnknownAge(a) && !dropAges.has(a))];
  const keep = (r: MatrixRow) => !dropRows.has(r.district);
  const regular = data.matrix.filter((r) => keep(r) && !isUnknownDistrict(r.district));
  const special = data.matrix.filter((r) => keep(r) && isUnknownDistrict(r.district));

  if (prefs.sort === 'alpha') regular.sort((a, b) => a.district.localeCompare(b.district, 'ru'));
  else
    regular.sort(
      (a, b) =>
        shortageOf(b) - shortageOf(a) ||
        rowTotals(b).demand - rowTotals(a).demand ||
        a.district.localeCompare(b.district, 'ru'),
    );

  return {
    rows: [...regular, ...special],
    ages,
    hiddenRows: dropRows.size,
    hiddenAges: dropAges.size,
  };
}

// ── запоминание состояния ───────────────────────────────────────────────────

export const PREFS_KEY = 'hg.today.matrix';

/** Читает сохранённое; всё непонятное заменяется значением по умолчанию. */
export function parsePrefs(raw: string | null): MatrixPrefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const v = JSON.parse(raw) as Partial<MatrixPrefs>;
    return {
      mode: MATRIX_MODES.includes(v.mode as MatrixMode) ? (v.mode as MatrixMode) : DEFAULT_PREFS.mode,
      hideEmpty: typeof v.hideEmpty === 'boolean' ? v.hideEmpty : DEFAULT_PREFS.hideEmpty,
      sort: MATRIX_SORTS.includes(v.sort as MatrixSort) ? (v.sort as MatrixSort) : DEFAULT_PREFS.sort,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Район, где спрос не покрыт: ждут больше человек, чем свободных мест. */
export interface UrgentDistrict {
  district: string;
  /** Открытых заявок в районе (все возрасты, включая «возраст не указан»). */
  demand: number;
  /** Свободных мест в принимающих группах района (без двойного счёта: см. `MatrixRow.supplyTotal`). */
  supply: number;
  /** Сколько человек остаётся без места: спрос минус места. Всегда больше нуля. */
  deficit: number;
}

/**
 * Где группа нужна срочнее всего. По строкам таблицы «Сегодня»: спрос (открытые заявки) минус свободные места района; остаются
 * только районы, где человек больше, чем мест. Первыми — где не хватает больше всего, при равенстве — где больше ждущих.
 * Строка «Район не определён» не в счёте: группу в «никаком районе» не откроешь, а такие заявки сначала нужно разобрать.
 */
export function urgentDistricts(matrix: readonly MatrixRow[]): UrgentDistrict[] {
  return matrix
    .filter((row) => !isUnknownDistrict(row.district))
    .map((row) => {
      const demand = row.cells.reduce((sum, c) => sum + c.demand, 0);
      return { district: row.district, demand, supply: row.supplyTotal, deficit: demand - row.supplyTotal };
    })
    .filter((d) => d.deficit > 0)
    .sort((a, b) => b.deficit - a.deficit || b.demand - a.demand || a.district.localeCompare(b.district, 'ru'));
}

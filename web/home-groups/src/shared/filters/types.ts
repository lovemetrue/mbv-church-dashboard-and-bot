/** Значение ячейки таблицы справочника. null и '' считаются «пусто». */
export type Cell = string | number | null;

/** Строка таблицы: ключ — название поля. Служебные данные (id записи) лежат отдельно, не в ячейках. */
export type Row = Record<string, Cell>;

export type FieldKind = 'text' | 'number' | 'date';

export interface FieldDef {
  /** Ключ совпадает с подписью столбца: так он читаем и в адресе страницы. */
  key: string;
  kind?: FieldKind;
  /** Значение — список через запятую («18–25, 26–35»): «=» проверяет вхождение, а не равенство целиком. */
  multi?: boolean;
  /** Можно ли группировать по этому полю. */
  groupable?: boolean;
}

export type Op = 'eq' | 'ne' | 'ge' | 'le' | 'empty' | 'filled';

export interface Filter {
  field: string;
  op: Op;
  /** Для «пусто»/«заполнено» значение не нужно и хранится пустым. */
  value: string;
}

export interface SortState {
  field: string;
  dir: 'asc' | 'desc';
}

export interface Preset {
  name: string;
  filters: Filter[];
}

/** Сохранённый вид: отбор вместе с тем, как показана таблица. */
export interface SavedView extends Preset {
  columns?: string[];
  group?: string | null;
  sort?: SortState | null;
}

export interface TableState {
  filters: Filter[];
  /** Быстрый поиск по тексту всех ячеек. */
  text: string;
  /** null — столбцы по умолчанию. */
  columns: string[] | null;
  sort: SortState | null;
  group: string | null;
}

export const EMPTY_TABLE_STATE: TableState = { filters: [], text: '', columns: null, sort: null, group: null };

export const NO_VALUE_OPS: readonly Op[] = ['empty', 'filled'];

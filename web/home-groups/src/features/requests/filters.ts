import type { RequestItem } from '@contracts';
import { applyFilters, parseFilter, serializeFilter, type FieldDef, type Filter, type Preset, type Row } from '../../shared/filters';
import { ru } from '../../shared/i18n/ru';
import { proposalOf } from './model';

/**
 * Отборы списка «Хотят в группу» — тем же движком, что в справочниках (`shared/filters`): поле, условие, значение;
 * условия хранятся в адресе (`f=Пол:eq:Женский`), поэтому переживают перезагрузку и попадают в «Мои виды».
 * Ключ поля — его подпись: так она читаема и в адресе.
 */
const t = ru.requests.filters;

export const REQUEST_FIELDS: FieldDef[] = [
  { key: t.fields.age, groupable: true },
  { key: t.fields.gender, groupable: true },
  { key: t.fields.district, groupable: true },
  { key: t.fields.place },
  // Дней у человека бывает несколько: «=» проверяет вхождение, а не равенство всего списка.
  { key: t.fields.days, multi: true },
  { key: t.fields.slot, groupable: true },
  { key: t.fields.waiting, kind: 'number' },
  { key: t.fields.callback, groupable: true },
  { key: t.fields.group, groupable: true },
  { key: t.fields.responsible, groupable: true },
  { key: t.fields.source, groupable: true },
];

/** Порядок полей в списке окна «Фильтры». */
export const REQUEST_FILTER_COLUMNS: string[] = REQUEST_FIELDS.map((f) => f.key);

export const REQUEST_PRESETS: Preset[] = [
  { name: t.presets.noGender, filters: [{ field: t.fields.gender, op: 'empty', value: '' }] },
  { name: t.presets.noDistrict, filters: [{ field: t.fields.district, op: 'empty', value: '' }] },
  { name: t.presets.noDays, filters: [{ field: t.fields.days, op: 'empty', value: '' }] },
  { name: t.presets.longWait, filters: [{ field: t.fields.waiting, op: 'ge', value: '7' }] },
];

const GENDER: Record<'м' | 'ж', string> = { м: t.male, ж: t.female };

/**
 * Возрастные категории анкеты бота — те же, что `AGE_GROUPS` в `src/core/texts.ts` (интерфейс код бота не импортирует,
 * поэтому список продублирован: меняя один, меняйте оба). Порядок — по возрасту, для границ.
 */
const AGE_CATEGORIES: readonly { label: string; upTo: number }[] = [
  { label: 'подростки (до 18 лет)', upTo: 17 },
  { label: '18-25', upTo: 25 },
  { label: '25-40', upTo: 40 },
  { label: '40-55', upTo: 55 },
  { label: '55-65', upTo: 65 },
  { label: '65+', upTo: Number.POSITIVE_INFINITY },
];

/**
 * Возраст для отбора — всегда категория. В заявках он записан по-разному: кнопкой анкеты («25-40»), точным числом
 * («42» — так бывает у ручной регистрации и старых анкет) или диапазоном из таблицы («35-45 лет»). Число кладём в его
 * категорию (на границе — в младшую: 25 → «18-25»), диапазон — по середине; иначе в списке были бы «42» и «61».
 * Непонятное («взрослый») остаётся как записано.
 */
export function ageCategory(label: string | null): string | null {
  const text = label?.trim();
  if (!text) return null;
  const known = AGE_CATEGORIES.find((c) => c.label === text);
  if (known) return known.label;
  const nums = (text.match(/\d+/g) ?? []).map(Number);
  if (nums.length === 0) return text;
  const age = nums.length >= 2 ? (nums[0]! + nums[1]!) / 2 : nums[0]!;
  return AGE_CATEGORIES.find((c) => age <= c.upTo)!.label;
}

/** Строка для движка отборов: только то, по чему отбирают, без телефонов. */
export function requestRow(r: RequestItem): Row {
  const group = r.bucket === 'done' ? r.finalGroup?.code : proposalOf(r)?.main.group.code;
  return {
    [t.fields.age]: ageCategory(r.ageLabel),
    [t.fields.gender]: r.gender.value ? GENDER[r.gender.value] : null,
    [t.fields.district]: r.district,
    [t.fields.place]: r.place,
    [t.fields.days]: r.days.join(', ') || null,
    [t.fields.slot]: r.slot,
    [t.fields.waiting]: r.waitingDays,
    [t.fields.callback]: r.callback ? ru.reference.yes : ru.reference.no,
    [t.fields.group]: group ?? null,
    [t.fields.responsible]: r.responsible,
    [t.fields.source]: r.source,
  };
}

/** Условия из адреса; мусор и поля, которых у заявок нет, отбрасываются (как в справочниках). */
export const parseRequestFilters = (raw: readonly string[]): Filter[] =>
  raw.map((x) => parseFilter(x, REQUEST_FIELDS)).filter((f): f is Filter => f !== null);

export const serializeRequestFilters = (filters: readonly Filter[]): string[] => filters.map(serializeFilter);

export function filterRequests(items: readonly RequestItem[], filters: readonly Filter[]): RequestItem[] {
  if (filters.length === 0) return [...items];
  const rows = items.map((r) => ({ r, row: requestRow(r) }));
  const passed = new Set(applyFilters(rows.map((x) => x.row), filters, REQUEST_FIELDS));
  return rows.filter((x) => passed.has(x.row)).map((x) => x.r);
}

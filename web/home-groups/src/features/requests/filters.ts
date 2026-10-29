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

/** Строка для движка отборов: только то, по чему отбирают, без телефонов. */
export function requestRow(r: RequestItem): Row {
  const group = r.bucket === 'done' ? r.finalGroup?.code : proposalOf(r)?.main.group.code;
  return {
    [t.fields.age]: r.ageLabel,
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

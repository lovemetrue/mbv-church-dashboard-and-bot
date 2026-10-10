import type { AuditEntry, ErrorEntry } from '@contracts';
import { ApiError } from '../../shared/api/client';
import { ru } from '../../shared/i18n/ru';

const t = ru.settings;

// ── время ───────────────────────────────────────────────────────────────────

/**
 * «9 октября, 12:30»; для прошлых лет добавляется год. Часовой пояс — браузера служителя,
 * как и в остальном интерфейсе. Нечитаемая дата — пустая строка, а не «Invalid Date».
 */
export function formatWhen(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' as const }),
  });
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

// ── фильтры журналов (на клиенте: записей не больше 200) ────────────────────

export const distinct = (values: readonly string[]): string[] => [...new Set(values)].sort((a, b) => a.localeCompare(b, 'ru'));

export interface ErrorFilter {
  service: string;
  query: string;
}

export function filterErrors(items: readonly ErrorEntry[], f: ErrorFilter): ErrorEntry[] {
  const q = f.query.trim().toLowerCase();
  return items.filter((e) => {
    if (f.service && e.service !== f.service) return false;
    if (!q) return true;
    return [e.service, e.message, e.context ?? ''].some((s) => s.toLowerCase().includes(q));
  });
}

export interface AuditFilter {
  /** Машинное имя действия (`request.approve`); пусто — любое. */
  action: string;
  actor: string;
  /** Номер заявки как ввёл человек: «12», «#12». */
  entityNo: string;
}

export const emptyAuditFilter: AuditFilter = { action: '', actor: '', entityNo: '' };

export const isAuditFilterEmpty = (f: AuditFilter): boolean => !f.action && !f.actor && !f.entityNo.trim();

/**
 * Номер сравниваем целиком, а не как подстроку: «1» не должен находить заявки 12 и 31.
 * Тип объекта не проверяем: в контракте нет списка типов, а в подписи строки он виден.
 */
export function filterAudit(items: readonly AuditEntry[], f: AuditFilter): AuditEntry[] {
  const no = f.entityNo.replace(/\D/g, '');
  return items.filter((e) => {
    if (f.action && e.action !== f.action) return false;
    if (f.actor && e.actor !== f.actor) return false;
    if (no && String(e.entityId) !== String(Number(no))) return false;
    return true;
  });
}

/** «заявка №12»; без номера — просто название объекта. Незнакомый тип показываем как пришёл. */
export function entityLabel(e: Pick<AuditEntry, 'entityType' | 'entityId'>): string {
  const name = t.audit.entities[e.entityType] ?? e.entityType;
  return e.entityId === null ? name : `${name} №${e.entityId}`;
}

// ── «было → стало» ──────────────────────────────────────────────────────────

export interface ValuePair {
  key: string;
  text: string;
}

export type DescribedValue = { kind: 'none' } | { kind: 'text'; text: string } | { kind: 'pairs'; pairs: ValuePair[] };

const MAX_DEPTH = 3;

/** Значение одной строкой. Вложенное разворачивается в «поле: значение», но не глубже трёх уровней. */
function inline(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return t.noValue;
  if (typeof value === 'string') return value === '' ? t.audit.valueEmpty : value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? t.audit.yes : t.audit.no;
  if (depth >= MAX_DEPTH) return '…';
  if (Array.isArray(value)) return value.length ? value.map((v) => inline(v, depth + 1)).join(', ') : t.audit.valueEmpty;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.length ? entries.map(([k, v]) => `${k}: ${inline(v, depth + 1)}`).join(', ') : t.audit.valueEmpty;
  }
  return String(value);
}

/**
 * Что показать на месте «было» или «стало». Объект превращается в пары «поле: значение»,
 * а не в сырой JSON: служитель читает журнал, а не отлаживает сервер. Названия полей
 * показываем как записаны: переводов полей в контракте нет.
 */
export function describeValue(value: unknown): DescribedValue {
  if (value === null || value === undefined) return { kind: 'none' };
  if (typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return { kind: 'none' };
    return { kind: 'pairs', pairs: entries.map(([key, v]) => ({ key, text: inline(v, 1) })) };
  }
  return { kind: 'text', text: inline(value) };
}

export const hasChange = (e: Pick<AuditEntry, 'before' | 'after'>): boolean =>
  describeValue(e.before).kind !== 'none' || describeValue(e.after).kind !== 'none';

// ── ошибки действий ─────────────────────────────────────────────────────────

/** Текст ошибки сохранения или отката по коду контракта. Текст сервера не показываем: он для разработчика. */
export function promptErrorText(error: unknown): string {
  const e = t.prompts.errors;
  if (!(error instanceof ApiError)) return e.other;
  if (error.status === 0) return e.network;
  if (error.status === 403) return e.forbidden;
  switch (error.code) {
    case 'bad_request':
      return e.badRequest;
    case 'not_found':
      return e.notFound;
    case 'forbidden':
      return e.forbidden;
    default:
      return e.other;
  }
}

// ── пользователи и личные входы ─────────────────────────────────────────────

/** Простая проверка формы адреса: точнее неё всё равно скажет только письмо. */
export const isValidEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/**
 * Полная ссылка из пути, который прислал сервер. Адрес берём из того места, где открыт
 * интерфейс: сервер не знает, под каким именем его видит администратор.
 */
export function buildLinkUrl(path: string, origin: string = window.location.origin): string {
  return `${origin}${path.startsWith('/') ? '' : '/'}${path}`;
}

/** Сообщение клиента при ответе без тела: «Ошибка 400». Людям его показывать незачем. */
const GENERIC_MESSAGE = /^Ошибка \d+$/;

/**
 * Текст ошибки действия над пользователями по коду контракта. Для `bad_request` показываем
 * сообщение сервера: оно написано для людей и безопасно. Для остальных кодов текст сервера
 * (например, про дубликат ключа) человеку ничего не скажет, поэтому у нас свои слова.
 */
export function staffErrorText(error: unknown): string {
  const e = t.users.errors;
  if (!(error instanceof ApiError)) return e.other;
  if (error.status === 0) return e.network;
  if (error.status === 403 || error.code === 'forbidden') return e.forbidden;
  switch (error.code) {
    case 'conflict':
      return e.conflict;
    case 'bad_request':
      return error.message && !GENERIC_MESSAGE.test(error.message) ? error.message : e.badRequest;
    case 'not_found':
      return e.notFound;
    default:
      return e.other;
  }
}

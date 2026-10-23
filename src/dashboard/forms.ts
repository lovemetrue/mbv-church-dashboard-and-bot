import {
  ALL_DISTRICTS,
  COMPOSITIONS,
  ALL_GROUP_STATUSES,
  type GroupStatus,
} from '../core/groups.js';
import { normalizePhone } from '../core/phone.js';
import { REQUEST_STATUSES, type RequestInput, type RequestStatus } from '../db/repos/requests.repo.js';
import type { GroupInput } from '../db/repos/groups.repo.js';
import type { CoordinatorInput } from '../db/repos/coordinators.repo.js';
import type { ManualRegistrationInput } from '../db/repos/users.repo.js';
import type { MdgStatus, RequestType } from '../core/fsm.js';

const MDG_STATUSES: readonly MdgStatus[] = ['open', 'home', 'join', 'member', 'leader'];

/**
 * Разбор форм дашборда.
 *
 * Чистые функции без обращения к сети и базе: так проверки покрываются тестами
 * без поднятия сервера, а маршрут остаётся тонким.
 */
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const REQUEST_TYPES: readonly RequestType[] = [
  'join_group', 'lead_group', 'question', 'already_member', 'already_leader',
];

/** Пустое поле формы — это «не заполнено», в базе ему соответствует NULL. */
function text(form: URLSearchParams, name: string): string | null {
  const v = form.get(name)?.trim();
  return v ? v : null;
}

/** Дата только в виде 2026-08-27: форма отдаёт именно его, всё прочее — ошибка ввода. */
function date(form: URLSearchParams, name: string): string | null | 'invalid' {
  const v = text(form, name);
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'invalid';
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? 'invalid' : v;
}

/**
 * Телефон. Если номер разбирается — кладём его и в текст, и в список для ссылки
 * «позвонить». Если нет — сохраняем как написано: в таблице церкви встречается
 * и «спросить у Марины», и терять это нельзя.
 */
function phone(form: URLSearchParams): { phone: string | null; phones: string[] } {
  const raw = text(form, 'phone');
  if (!raw) return { phone: null, phones: [] };
  const normalized = normalizePhone(raw);
  return normalized ? { phone: normalized, phones: [normalized] } : { phone: raw, phones: [] };
}

/** Телефон соведущего: разбирается — кладём в виде +7…, нет — как написано. */
function phoneText(form: URLSearchParams, name: string): string | null {
  const raw = text(form, name);
  return raw ? (normalizePhone(raw) ?? raw) : null;
}

/**
 * «Формат группы»: отмеченные галочками значения из списка, в порядке списка, через запятую.
 * Старый дашборд шлёт каждую галочку отдельным полем, новый интерфейс — одной строкой «Мужская, Семейная»
 * (его тело — объект строк, повторить поле там нельзя); принимаем оба вида.
 */
function composition(form: URLSearchParams): string | null {
  const picked = new Set(form.getAll('composition').flatMap((v) => v.split(',')).map((v) => v.trim()));
  const kept = COMPOSITIONS.filter((c) => picked.has(c));
  return kept.length > 0 ? kept.join(', ') : null;
}

function oneOf<T extends string>(form: URLSearchParams, name: string, allowed: readonly T[]): T | null {
  const v = form.get(name)?.trim();
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

/** Число или пусто: пустой выбор в списке групп значит «не назначена». */
function optionalId(form: URLSearchParams, name: string): number | null | 'invalid' {
  const raw = text(form, name);
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) return 'invalid';
  return Number(raw);
}

export function parseGroupForm(form: URLSearchParams): Parsed<GroupInput> {
  const leader = text(form, 'leader');
  if (!leader) return { ok: false, error: 'Укажите ФИО ведущего.' };

  const district = oneOf(form, 'district', ALL_DISTRICTS);
  if (!district) return { ok: false, error: 'Выберите район из списка.' };

  // Направление словами: новый интерфейс шлёт `direction`, старый дашборд — прежнее поле `format`. Есть ли такое в
  // справочнике, проверяет сервис (справочник в базе); здесь — только что оно указано.
  const direction = text(form, 'direction') ?? text(form, 'format');
  if (!direction) return { ok: false, error: 'Выберите направление группы из списка.' };

  const status = oneOf(form, 'status', ALL_GROUP_STATUSES);
  if (!status) return { ok: false, error: 'Выберите статус группы из списка.' };

  const rawPeople = text(form, 'people');
  let people: number | null = null;
  if (rawPeople !== null) {
    const n = Number(rawPeople);
    if (!/^\d+$/.test(rawPeople) || !Number.isSafeInteger(n) || n < 1 || n > 200) {
      return { ok: false, error: 'Число человек — целое от 1 до 200 или пусто.' };
    }
    people = n;
  }

  // Нет поля — «не менять»: старый дашборд и бот его не знают и иначе обнуляли бы вместимость при каждой правке.
  // Пусто — общая вместимость по умолчанию (HG_DEFAULT_CAPACITY).
  let capacity: number | null | undefined;
  if (form.has('capacity')) {
    const raw = text(form, 'capacity');
    if (raw === null) capacity = null;
    else {
      const n = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n < 1 || n > 200) {
        return { ok: false, error: 'Мест в группе — целое от 1 до 200 или пусто.' };
      }
      capacity = n;
    }
  }

  const rawNo = text(form, 'no');
  let no: number | null = null;
  if (rawNo !== null) {
    if (!/^\d+$/.test(rawNo) || Number(rawNo) < 1) {
      return { ok: false, error: 'Номер в реестре — целое число или пусто.' };
    }
    no = Number(rawNo);
  }

  const feedbackAt = date(form, 'feedbackAt');
  if (feedbackAt === 'invalid') return { ok: false, error: 'Дата обратной связи — в виде 2026-08-27.' };
  const openedOn = date(form, 'openedOn');
  if (openedOn === 'invalid') return { ok: false, error: 'Дата открытия — в виде 2026-08-27.' };

  return {
    ok: true,
    value: {
      leader,
      district,
      direction,
      status: status as GroupStatus,
      no,
      openToNew: text(form, 'openToNew'),
      ...phone(form),
      age: text(form, 'age'),
      metro: text(form, 'metro'),
      address: text(form, 'address'),
      composition: composition(form),
      day: text(form, 'day'),
      time: text(form, 'time'),
      people,
      ...(capacity === undefined ? {} : { capacity }),
      coordinator: text(form, 'coordinator'),
      coLeader: text(form, 'coLeader'),
      coLeaderPhone: phoneText(form, 'coLeaderPhone'),
      feedbackAt,
      openedOn,
      comment: text(form, 'comment'),
      training: text(form, 'training'),
      // Чекбокс приходит только когда отмечен; пустое поле здесь значит «нет».
      checked: form.get('checked') !== null,
      campaignRegistered: form.get('campaignRegistered') !== null,
      campaignOnly: form.get('campaignOnly') !== null,
    },
  };
}

/** Дни для «Удобные дни»: коды — как их пишут люди и как их понимает разбор времени подбора (`parseHumanSchedule`). */
export const SCHEDULE_DAYS = [
  { value: 'пн', label: 'Пн' }, { value: 'вт', label: 'Вт' }, { value: 'ср', label: 'Ср' }, { value: 'чт', label: 'Чт' },
  { value: 'пт', label: 'Пт' }, { value: 'сб', label: 'Сб' }, { value: 'вс', label: 'Вс' },
] as const;
/** Время суток — те же три части, на которые подбор делит время групп (утро до 12, день до 17, вечер). */
export const SCHEDULE_TIMES = [
  { value: 'утро', label: 'Утро', phrase: 'утром' },
  { value: 'день', label: 'День', phrase: 'днём' },
  { value: 'вечер', label: 'Вечер', phrase: 'вечером' },
] as const;

/**
 * Удобное время из формы. Новый интерфейс присылает галочки дней (`days`: «пн,ср») и время суток (`time`), из них
 * собирается та же фраза, что человек пишет боту («пн, ср вечером»): подбор и карточки читают одно поле. Готовый
 * текст (`schedule`: старый дашборд, правка) берётся как есть.
 */
function schedule(form: URLSearchParams): Parsed<string | null> {
  const written = text(form, 'schedule');
  if (written) return { ok: true, value: written };
  const days = (text(form, 'days') ?? '').split(',').map((d) => d.trim()).filter(Boolean);
  const known = SCHEDULE_DAYS.map((d) => d.value as string);
  if (days.some((d) => !known.includes(d))) return { ok: false, error: 'Удобные дни выбираются из списка.' };
  const timeValue = text(form, 'time');
  const time = SCHEDULE_TIMES.find((t) => t.value === timeValue);
  if (timeValue && !time) return { ok: false, error: 'Удобное время выбирается из списка.' };
  // Порядок дней — недельный, как бы их ни отметили.
  const ordered = known.filter((d) => days.includes(d));
  const phrase = [ordered.join(', '), time?.phrase ?? ''].filter(Boolean).join(' ');
  return { ok: true, value: phrase || null };
}

export function parseRequestForm(form: URLSearchParams): Parsed<RequestInput> {
  const fio = text(form, 'fio');
  if (!fio) return { ok: false, error: 'Укажите ФИО: заявка должна быть о конкретном человеке.' };

  const type = oneOf(form, 'type', REQUEST_TYPES);
  if (!type) return { ok: false, error: 'Выберите, о чём заявка.' };

  const status = oneOf<RequestStatus>(form, 'status', REQUEST_STATUSES);
  if (!status) return { ok: false, error: 'Выберите статус заявки из списка.' };

  const recommendedAt = date(form, 'recommendedAt');
  if (recommendedAt === 'invalid') return { ok: false, error: 'Дата рекомендации — в виде 2026-08-27.' };

  const requestedAt = date(form, 'requestedAt');
  if (requestedAt === 'invalid') return { ok: false, error: 'Дата заявки — в виде 2026-08-27.' };

  const groupId = optionalId(form, 'groupId');
  if (groupId === 'invalid') return { ok: false, error: 'Домашняя группа выбирается из списка.' };

  const when = schedule(form);
  if (!when.ok) return when;

  return {
    ok: true,
    value: {
      fio,
      type,
      status,
      groupId,
      street: text(form, 'address'),
      schedule: when.value,
      hobby: text(form, 'hobby'),
      profession: text(form, 'profession'),
      family: text(form, 'family'),
      ...phone(form),
      age: text(form, 'age'),
      place: text(form, 'place'),
      responsible: text(form, 'responsible'),
      source: text(form, 'source'),
      ministry: text(form, 'ministry'),
      note: text(form, 'note'),
      extra: text(form, 'extra'),
      recommended: text(form, 'recommended'),
      recommendedAt,
      finalGroup: text(form, 'finalGroup'),
      cancelReason: text(form, 'cancelReason'),
      attendance: text(form, 'attendance'),
      requestedAt,
    },
  };
}

/** Номер записи из формы правки или удаления. */
export function parseId(form: URLSearchParams, what = 'записи'): Parsed<number> {
  const raw = form.get('id')?.trim() ?? '';
  const id = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(id) || id <= 0) {
    return { ok: false, error: `Неверный номер ${what}.` };
  }
  return { ok: true, value: id };
}

/** Правка группы: те же поля, что при заведении, плюс номер записи. */
export function parseGroupUpdate(form: URLSearchParams): Parsed<{ id: number; input: GroupInput }> {
  const id = parseId(form, 'группы');
  if (!id.ok) return id;
  const parsed = parseGroupForm(form);
  if (!parsed.ok) return parsed;
  return { ok: true, value: { id: id.value, input: parsed.value } };
}

/** Быстрая смена статуса: только номер, статус и, если указали, ответственный. */
export function parseRequestStatus(
  form: URLSearchParams,
): Parsed<{ id: number; status: RequestStatus; responsible: string | null; groupId: number | null }> {
  const id = parseId(form, 'заявки');
  if (!id.ok) return id;
  const status = oneOf<RequestStatus>(form, 'status', REQUEST_STATUSES);
  if (!status) return { ok: false, error: 'Выберите статус заявки из списка.' };
  const groupId = optionalId(form, 'groupId');
  if (groupId === 'invalid') return { ok: false, error: 'Домашняя группа выбирается из списка.' };
  return { ok: true, value: { id: id.value, status, responsible: text(form, 'responsible'), groupId } };
}

/** Правка заявки: любое поле, включая статус. */
export function parseRequestUpdate(form: URLSearchParams): Parsed<{ id: number; input: RequestInput }> {
  const id = parseId(form, 'заявки');
  if (!id.ok) return id;
  const parsed = parseRequestForm(form);
  if (!parsed.ok) return parsed;
  return { ok: true, value: { id: id.value, input: parsed.value } };
}

/**
 * Координатор — один и тот же человек может стоять и «Координатором» у группы,
 * и «Ответственным» у заявки, поэтому список общий, а не два разных справочника.
 */
export function parseCoordinatorForm(form: URLSearchParams): Parsed<CoordinatorInput> {
  const name = text(form, 'name');
  if (!name) return { ok: false, error: 'Укажите ФИО.' };
  // Новый интерфейс отмечает роли из справочника галочками (roleIds: «1, 3»), старый дашборд пишет одну роль словами (role).
  const rawIds = text(form, 'roleIds');
  if (rawIds) {
    const ids = rawIds.split(',').map((v) => v.trim()).filter(Boolean);
    if (ids.some((v) => !/^\d{1,15}$/.test(v))) return { ok: false, error: 'Роли выбираются из списка.' };
    return { ok: true, value: { name, roles: [...new Set(ids.map(Number))].map((id) => ({ id })) } };
  }
  const role = text(form, 'role');
  if (!role) return { ok: false, error: 'Отметьте хотя бы одну роль.' };
  return { ok: true, value: { name, roles: [{ name: role }] } };
}

export function parseCoordinatorUpdate(form: URLSearchParams): Parsed<{ id: number; input: CoordinatorInput }> {
  const id = parseId(form, 'участника');
  if (!id.ok) return id;
  const parsed = parseCoordinatorForm(form);
  if (!parsed.ok) return parsed;
  return { ok: true, value: { id: id.value, input: parsed.value } };
}

/**
 * Регистрация участника кампании из дашборда — для тех, кто заполнил анкету
 * на бумаге и своего чата с ботом не имеет. Телефон обязателен: это то, по чему
 * служитель узнает человека при выдаче набора, если QR потерян.
 */
export function parseRegistrationForm(form: URLSearchParams): Parsed<ManualRegistrationInput> {
  const fio = text(form, 'fio');
  if (!fio) return { ok: false, error: 'Укажите ФИО.' };

  const parsedPhone = phone(form).phone;
  if (!parsedPhone) return { ok: false, error: 'Укажите телефон.' };

  const mdgStatusRaw = form.get('mdgStatus')?.trim();
  const mdgStatus = mdgStatusRaw ? oneOf(form, 'mdgStatus', MDG_STATUSES) : undefined;
  if (mdgStatusRaw && !mdgStatus) return { ok: false, error: 'Малая группа выбирается из списка.' };

  const when = schedule(form);
  if (!when.ok) return when;

  return {
    ok: true,
    value: {
      fio,
      phone: parsedPhone,
      church: text(form, 'church') ?? undefined,
      mdgStatus: mdgStatus ?? undefined,
      leaderName: text(form, 'leaderName') ?? undefined,
      location: text(form, 'location') ?? undefined,
      age: text(form, 'age') ?? undefined,
      preferredContact: text(form, 'preferredContact') ?? undefined,
      comment: text(form, 'comment') ?? undefined,
      schedule: when.value ?? undefined,
      address: text(form, 'address') ?? undefined,
      hobby: text(form, 'hobby') ?? undefined,
      profession: text(form, 'profession') ?? undefined,
      family: text(form, 'family') ?? undefined,
    },
  };
}

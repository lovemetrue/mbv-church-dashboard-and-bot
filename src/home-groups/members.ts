import { normalizePhone } from '../core/phone.js';
import type { AuditRepo } from '../db/repos/audit.repo.js';
import { parsePersonKey, type MembersRepo, type PersonInput } from '../db/repos/members.repo.js';
import type { ActionError } from './contracts.js';

/**
 * Состав группы и карточки людей, внесённые вручную.
 *
 * Состав ссылается на справочник людей: человека выбирают по ключу (участник, человек из заявки или карточка), либо
 * заводят нового «по плюсу» — тогда его карточка сразу появляется в справочнике. Имя и телефон в составе не хранятся,
 * поэтому правка карточки меняет их везде. Убрать человека из состава может любой вход (это обычная работа),
 * запись только скрывается. В журнал идут номера и названия полей, без имён и телефонов.
 */
type Fail = { ok: false; error: ActionError['error']; message: string };
type Outcome = { ok: true } | Fail;
const bad = (message: string): Fail => ({ ok: false, error: 'bad_request', message });
const notFound = (message: string): Fail => ({ ok: false, error: 'not_found', message });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Дата вида 2026-09-01, существующая в календаре, не из будущего. */
function validDate(v: string, today: Date): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && d.getTime() <= today.getTime() + 86_400_000;
}

const clean = (v: unknown): string | null | undefined => (v === undefined ? undefined : typeof v === 'string' ? (v.trim().replace(/\s+/g, ' ') || null) : null);

/** Дата и заметка строки состава; undefined — «не менять». */
function parseRow(src: Record<string, unknown>, today: Date): { joinedOn?: string | null; note?: string | null } | string {
  const out: { joinedOn?: string | null; note?: string | null } = {};
  if ('joinedOn' in src) {
    if (src['joinedOn'] !== null && typeof src['joinedOn'] !== 'string') return 'Дата вступления должна быть текстом.';
    const v = clean(src['joinedOn']);
    if (v && !validDate(v, today)) return 'Дата вступления — в виде 2026-09-01, не из будущего.';
    out.joinedOn = v ?? null;
  }
  if ('note' in src) {
    if (src['note'] !== null && typeof src['note'] !== 'string') return 'Заметка должна быть текстом.';
    const v = clean(src['note']);
    if ((v ?? '').length > 300) return 'Заметка слишком длинная (до 300 знаков).';
    out.note = v ?? null;
  }
  return out;
}

/** Карточка человека: ФИО обязательно; телефон, который не разбирается, сохраняется как написан («спросить у Марины»). */
function parsePerson(src: Record<string, unknown>, base: PersonInput | null): PersonInput | string {
  const out: PersonInput = base ? { ...base } : { fio: '', phone: null, age: null, place: null, note: null };
  const TEXT = ['fio', 'phone', 'age', 'place', 'note', 'address', 'schedule', 'hobby', 'profession', 'family'] as const;
  for (const k of Object.keys(src)) if (!(TEXT as readonly string[]).includes(k)) return `Поле «${k.slice(0, 40)}» здесь менять нельзя.`;
  for (const k of TEXT) {
    if (!(k in src)) continue;
    if (src[k] !== null && typeof src[k] !== 'string') return 'Значения должны быть текстом.';
    const v = clean(src[k]) ?? null;
    if (k === 'fio') out.fio = v ?? '';
    else if (k === 'phone') out.phone = v === null ? null : (normalizePhone(v) ?? v);
    else out[k] = v;
  }
  if (out.fio === '') return 'Укажите ФИО.';
  if (out.fio.length > 200) return 'ФИО слишком длинное (до 200 знаков).';
  if ((out.phone ?? '').length > 40) return 'Телефон слишком длинный (до 40 знаков).';
  if ((out.age ?? '').length > 60) return 'Возраст слишком длинный (до 60 знаков).';
  if ((out.place ?? '').length > 200) return 'Место слишком длинное (до 200 знаков).';
  if ((out.note ?? '').length > 300) return 'Заметка слишком длинная (до 300 знаков).';
  for (const k of ['address', 'schedule', 'hobby', 'profession', 'family'] as const) {
    if ((out[k] ?? '').length > 200) return 'Слишком длинный текст (до 200 знаков).';
  }
  return out;
}

export function createMembers(deps: {
  members: Pick<MembersRepo, 'add' | 'addNewPerson' | 'findActive' | 'update' | 'archive' | 'findPerson' | 'createPerson' | 'updatePerson' | 'archivePerson'>;
  audit: Pick<AuditRepo, 'write'>;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());
  return {
    /** Добавить в состав: `personKey` (человек из справочника) или `newPerson` (новая карточка «по плюсу»). */
    async add(groupId: number, body: unknown, actor: string): Promise<{ ok: true; id: number; personKey: string } | Fail> {
      if (!isRecord(body)) return bad('Нужно выбрать человека или внести нового.');
      const row = parseRow(body, now());
      if (typeof row === 'string') return bad(row);
      const input = { joinedOn: row.joinedOn ?? null, note: row.note ?? null };
      const hasKey = body['personKey'] !== undefined;
      const hasNew = body['newPerson'] !== undefined;
      if (hasKey === hasNew) return bad('Нужно выбрать человека из справочника или внести нового (одно из двух).');

      let result;
      if (hasKey) {
        const ref = parsePersonKey(body['personKey']);
        if (!ref) return bad('Не удалось определить человека.');
        result = await deps.members.add(groupId, ref, input, actor);
      } else {
        if (!isRecord(body['newPerson'])) return bad('Данные нового человека должны быть объектом.');
        const person = parsePerson(body['newPerson'], null);
        if (typeof person === 'string') return bad(person);
        result = await deps.members.addNewPerson(groupId, person, input, actor);
      }
      if (!result.ok) {
        if (result.reason === 'no_group') return notFound('Группа не найдена.');
        if (result.reason === 'no_person') return notFound('Человек не найден в справочнике.');
        return { ok: false, error: 'conflict', message: 'Этот человек уже в составе группы.' };
      }
      await deps.audit.write(actor, 'group.member.add', 'group', groupId, { memberId: result.id, person: hasNew ? 'new' : 'existing' });
      return result;
    },

    /** Править строку состава: только дата вступления и заметка. Имя и телефон правятся в карточке человека. */
    async update(id: number, body: unknown, actor: string): Promise<Outcome> {
      const fields = isRecord(body) && isRecord(body['fields']) ? body['fields'] : null;
      if (!fields || Object.keys(fields).length === 0) return bad('Нечего менять.');
      for (const k of Object.keys(fields)) if (k !== 'joinedOn' && k !== 'note') return bad(`Поле «${k.slice(0, 40)}» здесь менять нельзя: имя и телефон правятся в карточке человека.`);
      const current = await deps.members.findActive(id);
      if (!current) return notFound('Человек в составе не найден.');
      const row = parseRow(fields, now());
      if (typeof row === 'string') return bad(row);
      const merged = { joinedOn: row.joinedOn !== undefined ? row.joinedOn : current.joined_on, note: row.note !== undefined ? row.note : current.note };
      if (!(await deps.members.update(id, merged))) return notFound('Человек в составе не найден.');
      await deps.audit.write(actor, 'group.member.update', 'group', current.group_id, { memberId: id, fields: Object.keys(fields) });
      return { ok: true };
    },

    async remove(id: number, actor: string): Promise<Outcome> {
      const current = await deps.members.findActive(id);
      if (!current || !(await deps.members.archive(id))) return notFound('Человек в составе не найден.');
      await deps.audit.write(actor, 'group.member.remove', 'group', current.group_id, { memberId: id });
      return { ok: true };
    },

    /** Правка карточки, внесённой вручную (участников из бота и людей из заявок правят там, откуда они пришли). */
    async updatePerson(id: number, body: unknown, actor: string): Promise<Outcome> {
      const fields = isRecord(body) && isRecord(body['fields']) ? body['fields'] : null;
      if (!fields || Object.keys(fields).length === 0) return bad('Нечего менять.');
      const current = await deps.members.findPerson(id);
      if (!current) return notFound('Карточка не найдена.');
      const person = parsePerson(fields, { fio: current.full_name, phone: current.phone, age: current.age, place: current.place, note: current.note, address: current.address, schedule: current.schedule, hobby: current.hobby, profession: current.profession, family: current.family });
      if (typeof person === 'string') return bad(person);
      if (!(await deps.members.updatePerson(id, person))) return notFound('Карточка не найдена.');
      await deps.audit.write(actor, 'person.update', 'person', id, { fields: Object.keys(fields) });
      return { ok: true };
    },

    async deletePerson(id: number, actor: string): Promise<Outcome> {
      if (!(await deps.members.archivePerson(id))) return notFound('Карточка не найдена.');
      await deps.audit.write(actor, 'person.delete', 'person', id, {});
      return { ok: true };
    },
  };
}

export type Members = ReturnType<typeof createMembers>;

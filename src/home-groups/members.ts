import { normalizePhone } from '../core/phone.js';
import type { AuditRepo } from '../db/repos/audit.repo.js';
import type { MemberInput, MembersRepo } from '../db/repos/members.repo.js';
import type { ActionError } from './contracts.js';
import { fieldsToForm } from './create.js';

/**
 * Состав группы вручную: добавить человека, поправить строку, убрать из состава. Правка частичная (интерфейс
 * присылает только изменённые поля). Убрать из состава может любой вход: это обычная работа (человек вышел из группы),
 * а запись скрывается, а не стирается. В журнал идут номер группы и названия полей, без имён и телефонов.
 */
type Outcome = { ok: true } | { ok: false; error: ActionError['error']; message: string };
type Created = { ok: true; id: number } | Extract<Outcome, { ok: false }>;
const bad = (message: string): Extract<Outcome, { ok: false }> => ({ ok: false, error: 'bad_request', message });
const notFound = (message: string): Extract<Outcome, { ok: false }> => ({ ok: false, error: 'not_found', message });

const FIELDS = ['fio', 'phone', 'joinedOn', 'note'] as const;

/** Дата вида 2026-09-01, существующая в календаре, не из будущего. */
function validDate(v: string, today: Date): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v && d.getTime() <= today.getTime() + 86_400_000;
}

function parse(fields: URLSearchParams, base: MemberInput | null, today: Date): MemberInput | string {
  const out: MemberInput = base ? { ...base } : { fio: '', phone: null, joinedOn: null, note: null };
  for (const k of fields.keys()) if (!(FIELDS as readonly string[]).includes(k)) return `Поле «${k.slice(0, 40)}» здесь менять нельзя.`;
  if (fields.has('fio')) out.fio = fields.get('fio')!.trim().replace(/\s+/g, ' ');
  if (fields.has('phone')) {
    const raw = fields.get('phone')!.trim();
    // Телефон, который не разбирается, сохраняем как написан («спросить у Марины»): терять его хуже, чем не нормализовать.
    out.phone = raw === '' ? null : (normalizePhone(raw) ?? raw);
  }
  if (fields.has('joinedOn')) {
    const raw = fields.get('joinedOn')!.trim();
    if (raw !== '' && !validDate(raw, today)) return 'Дата вступления — в виде 2026-09-01, не из будущего.';
    out.joinedOn = raw === '' ? null : raw;
  }
  if (fields.has('note')) out.note = fields.get('note')!.trim() || null;
  if (out.fio === '') return 'Укажите ФИО.';
  if (out.fio.length > 200) return 'ФИО слишком длинное (до 200 знаков).';
  if ((out.phone ?? '').length > 40) return 'Телефон слишком длинный (до 40 знаков).';
  if ((out.note ?? '').length > 300) return 'Заметка слишком длинная (до 300 знаков).';
  return out;
}

export function createMembers(deps: {
  members: Pick<MembersRepo, 'add' | 'findActive' | 'update' | 'archive'>;
  audit: Pick<AuditRepo, 'write'>;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());
  return {
    async add(groupId: number, body: unknown, actor: string): Promise<Created> {
      const form = fieldsToForm(body);
      if (typeof form === 'string') return bad(form);
      const input = parse(form, null, now());
      if (typeof input === 'string') return bad(input);
      const id = await deps.members.add(groupId, input, actor);
      if (id === null) return notFound('Группа не найдена.');
      await deps.audit.write(actor, 'group.member.add', 'group', groupId, { memberId: id });
      return { ok: true, id };
    },

    async update(id: number, body: unknown, actor: string): Promise<Outcome> {
      const form = fieldsToForm(body);
      if (typeof form === 'string') return bad(form);
      if (form.size === 0) return bad('Нечего менять.');
      const current = await deps.members.findActive(id);
      if (!current) return notFound('Человек в составе не найден.');
      const input = parse(form, { fio: current.full_name, phone: current.phone, joinedOn: current.joined_on, note: current.note }, now());
      if (typeof input === 'string') return bad(input);
      if (!(await deps.members.update(id, input))) return notFound('Человек в составе не найден.');
      await deps.audit.write(actor, 'group.member.update', 'group', current.group_id, { memberId: id, fields: [...form.keys()] });
      return { ok: true };
    },

    async remove(id: number, actor: string): Promise<Outcome> {
      const current = await deps.members.findActive(id);
      if (!current || !(await deps.members.archive(id))) return notFound('Человек в составе не найден.');
      await deps.audit.write(actor, 'group.member.remove', 'group', current.group_id, { memberId: id });
      return { ok: true };
    },
  };
}

export type Members = ReturnType<typeof createMembers>;

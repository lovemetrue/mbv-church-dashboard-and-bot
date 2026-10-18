import { parseCoordinatorForm, parseGroupForm } from '../dashboard/forms.js';
import type { AuditRepo } from '../db/repos/audit.repo.js';
import type { CoordinatorsRepo } from '../db/repos/coordinators.repo.js';
import type { GroupRow, GroupsRepo } from '../db/repos/groups.repo.js';
import type { RequestsRepo } from '../db/repos/requests.repo.js';
import type { UsersRepo } from '../db/repos/users.repo.js';
import type { ActionOutcome } from '../db/repos/placement.repo.js';
import { fieldsToForm } from './create.js';

/**
 * Правка и удаление записей справочника из нового интерфейса: группы, координаторы, заявки.
 *
 * Проверки — те же функции, что у форм старого дашборда. Отличие одно: правка частичная. Интерфейс присылает
 * только изменённые поля, остальное берётся из базы. Поэтому телефоны ведущих, которые новый интерфейс нарочно
 * не показывает, не пропадают при сохранении и не уходят в браузер.
 * Удаление мягкое (запись скрывается, остаётся в базе); решает, кому оно доступно, сервер (`server.ts`).
 */
const fail = (error: 'bad_request' | 'not_found', message: string): ActionOutcome => ({ ok: false, error, message });

/**
 * Поля группы, которые можно менять отсюда. Телефоны ведущих сервер принимает, но обратно не отдаёт:
 * интерфейс их не показывает, а заполняет поле тот, кому есть что записать (новый номер). Адрес виден и правится как обычное поле.
 */
const GROUP_EDITABLE = [
  'leader', 'district', 'format', 'status', 'people', 'day', 'time', 'composition', 'coordinator', 'coLeader',
  'feedbackAt', 'openedOn', 'comment', 'age', 'metro', 'openToNew', 'training', 'no', 'checked', 'doNotRefer',
  'phone', 'address', 'coLeaderPhone', 'campaignRegistered',
] as const;
const GROUP_FLAGS = ['checked', 'doNotRefer', 'campaignRegistered'] as const;

/** Состав хранится строкой «Смешанная, Семейная», а форма ждёт отдельные значения: иначе правка любого поля обнулила бы состав. */
const splitComposition = (v: string | null | undefined): string[] => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);

/** Группа → поля формы, чтобы непосланные поля прошли ту же проверку, что и посланные. */
function groupToFields(g: GroupRow): URLSearchParams {
  const f = new URLSearchParams();
  const put = (k: string, v: string | number | null | undefined) => { if (v !== null && v !== undefined && String(v) !== '') f.set(k, String(v)); };
  put('leader', g.leader); put('district', g.district); put('format', g.format); put('status', g.status);
  put('people', g.people); put('day', g.day); put('time', g.time); for (const c of splitComposition(g.composition)) f.append('composition', c);
  put('coordinator', g.coordinator); put('coLeader', g.co_leader); put('feedbackAt', g.feedback_at); put('openedOn', g.opened_on);
  put('comment', g.comment); put('age', g.age); put('metro', g.metro); put('openToNew', g.open_to_new);
  put('training', g.training); put('no', g.no);
  if (g.checked) f.set('checked', '1');
  if (g.campaign_registered) f.set('campaignRegistered', '1');
  return f;
}

export function createManager(deps: {
  groups: Pick<GroupsRepo, 'findActive' | 'update' | 'archive'>;
  coordinators: Pick<CoordinatorsRepo, 'create' | 'findActive' | 'rename' | 'archive'>;
  requests: Pick<RequestsRepo, 'archive'>;
  users: Pick<UsersRepo, 'findById' | 'delete'>;
  audit: Pick<AuditRepo, 'write'>;
}) {
  return {
    async updateGroup(id: number, body: unknown, actor: string): Promise<ActionOutcome> {
      const given = fieldsToForm(body);
      if (typeof given === 'string') return fail('bad_request', given);
      const unknown = [...given.keys()].filter((k) => !(GROUP_EDITABLE as readonly string[]).includes(k));
      if (unknown.length > 0) return fail('bad_request', `Поле «${unknown[0]!.slice(0, 40)}» здесь менять нельзя.`);
      if (given.size === 0) return fail('bad_request', 'Нечего менять.');

      const current = await deps.groups.findActive(id);
      if (!current) return fail('not_found', 'Группа не найдена.');

      const merged = groupToFields(current);
      for (const [k, v] of given) {
        if (k === 'composition') { merged.delete(k); for (const c of splitComposition(v)) merged.append(k, c); continue; }
        if ((GROUP_FLAGS as readonly string[]).includes(k)) { if (v === '1' || v === 'true') merged.set(k, '1'); else merged.delete(k); continue; }
        if (v.trim() === '') merged.delete(k); else merged.set(k, v);
      }
      const parsed = parseGroupForm(merged);
      if (!parsed.ok) return fail('bad_request', parsed.error);
      // Закрытое остаётся как в базе: форма его не видела и затереть не должна.
      const input = {
        ...parsed.value,
        // Телефон и телефон соведущего меняются только если их прислали; адрес — тоже (пустая строка его очищает); иначе остаются как в базе.
        ...(given.has('phone') ? {} : { phone: current.phone, phones: current.phones }),
        ...(given.has('address') ? {} : { address: current.address }),
        ...(given.has('coLeaderPhone') ? {} : { coLeaderPhone: current.co_leader_phone }),
        doNotRefer: given.has('doNotRefer') ? merged.has('doNotRefer') : current.do_not_refer,
      };
      const updated = await deps.groups.update(id, input);
      if (!updated) return fail('not_found', 'Группа не найдена.');
      await deps.audit.write(actor, 'group.update', 'group', id, { fields: [...given.keys()] });
      return { ok: true };
    },

    async deleteGroup(id: number, actor: string): Promise<ActionOutcome> {
      const removed = await deps.groups.archive(id);
      if (!removed) return fail('not_found', 'Группа не найдена.');
      await deps.audit.write(actor, 'group.delete', 'group', id, {});
      return { ok: true };
    },

    async createCoordinator(body: unknown, actor: string): Promise<{ ok: true; id: number } | Extract<ActionOutcome, { ok: false }>> {
      const form = fieldsToForm(body);
      if (typeof form === 'string') return fail('bad_request', form) as Extract<ActionOutcome, { ok: false }>;
      const parsed = parseCoordinatorForm(form);
      if (!parsed.ok) return fail('bad_request', parsed.error) as Extract<ActionOutcome, { ok: false }>;
      const created = await deps.coordinators.create(parsed.value, 'ui');
      await deps.audit.write(actor, 'coordinator.create', 'coordinator', created.id, { role: parsed.value.role });
      return { ok: true, id: created.id };
    },

    async updateCoordinator(id: number, body: unknown, actor: string): Promise<ActionOutcome> {
      const given = fieldsToForm(body);
      if (typeof given === 'string') return fail('bad_request', given);
      if (given.size === 0) return fail('bad_request', 'Нечего менять.');
      const current = await deps.coordinators.findActive(id);
      if (!current) return fail('not_found', 'Участник команды не найден.');
      const merged = new URLSearchParams({ name: current.name, role: current.role });
      for (const [k, v] of given) if (k === 'name' || k === 'role') merged.set(k, v);
      const parsed = parseCoordinatorForm(merged);
      if (!parsed.ok) return fail('bad_request', parsed.error);
      const updated = await deps.coordinators.rename(id, parsed.value);
      if (!updated) return fail('not_found', 'Участник команды не найден.');
      await deps.audit.write(actor, 'coordinator.update', 'coordinator', id, { fields: [...given.keys()].filter((k) => k === 'name' || k === 'role') });
      return { ok: true };
    },

    async deleteCoordinator(id: number, actor: string): Promise<ActionOutcome> {
      if (!(await deps.coordinators.archive(id))) return fail('not_found', 'Участник команды не найден.');
      await deps.audit.write(actor, 'coordinator.delete', 'coordinator', id, {});
      return { ok: true };
    },

    /**
     * Стереть регистрацию (заведена по ошибке, дубль, человек попросил). В отличие от остального удаление жёсткое,
     * как в старом дашборде: вместе с регистрацией уходят её заявки и рассылки. В журнале только номер регистрации.
     */
    async deletePerson(id: number, actor: string): Promise<ActionOutcome> {
      const user = await deps.users.findById(id);
      if (!user) return fail('not_found', 'Регистрация не найдена.');
      if (!(await deps.users.delete(id))) return fail('not_found', 'Регистрация не найдена.');
      await deps.audit.write(actor, 'registration.delete', 'user', id, { registrationNo: user.registration_no });
      return { ok: true };
    },

    async deleteRequest(id: number, actor: string): Promise<ActionOutcome> {
      if (!(await deps.requests.archive(id))) return fail('not_found', 'Заявка не найдена.');
      await deps.audit.write(actor, 'request.delete', 'request', id, {});
      return { ok: true };
    },
  };
}

export type Manager = ReturnType<typeof createManager>;

import { parseCoordinatorForm, parseGroupForm } from '../dashboard/forms.js';
import type { AuditRepo } from '../db/repos/audit.repo.js';
import type { CoordinatorsRepo, RoleRef } from '../db/repos/coordinators.repo.js';
import type { TeamRolesRepo } from '../db/repos/teamRoles.repo.js';
import type { GroupDirectionsRepo } from '../db/repos/groupDirections.repo.js';
import type { GroupRow, GroupsRepo } from '../db/repos/groups.repo.js';
import type { RequestsRepo } from '../db/repos/requests.repo.js';
import type { UsersRepo } from '../db/repos/users.repo.js';
import type { ActionOutcome } from '../db/repos/placement.repo.js';
import { UNKNOWN_DIRECTION, fieldsToForm, knownDirection } from './create.js';

/**
 * Правка и удаление записей справочника из нового интерфейса: группы, координаторы, заявки.
 *
 * Проверки — те же функции, что у форм старого дашборда. Отличие одно: правка частичная. Интерфейс присылает
 * только изменённые поля, остальное берётся из базы. Поэтому чужая правка, пришедшая между открытием формы и
 * «Сохранить», не затирается старыми значениями из формы.
 * Удаление мягкое (запись скрывается, остаётся в базе); решает, кому оно доступно, сервер (`server.ts`).
 */
const fail = (error: 'bad_request' | 'not_found', message: string): ActionOutcome => ({ ok: false, error, message });

/** Поля группы, которые можно менять отсюда. Телефоны и адрес видны в форме и правятся как обычные поля. */
/** Что в строке справочника команды правится: ФИО и роли (галочками из справочника или, в старом дашборде, одной ролью словами). */
const COORDINATOR_EDITABLE: readonly string[] = ['name', 'roleIds', 'role'];

const GROUP_EDITABLE = [
  'leader', 'district', 'direction', 'status', 'people', 'day', 'time', 'composition', 'coordinator', 'coLeader',
  'feedbackAt', 'openedOn', 'comment', 'age', 'metro', 'openToNew', 'training', 'no', 'checked', 'doNotRefer', 'chamber',
  'phone', 'address', 'coLeaderPhone', 'campaignRegistered', 'capacity', 'campaignOnly',
] as const;
const GROUP_FLAGS = ['checked', 'doNotRefer', 'chamber', 'campaignRegistered', 'campaignOnly'] as const;

/** Состав хранится строкой «Смешанная, Семейная», а форма ждёт отдельные значения: иначе правка любого поля обнулила бы состав. */
const splitComposition = (v: string | null | undefined): string[] => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);

/** Группа → поля формы, чтобы непосланные поля прошли ту же проверку, что и посланные. */
function groupToFields(g: GroupRow): URLSearchParams {
  const f = new URLSearchParams();
  const put = (k: string, v: string | number | null | undefined) => { if (v !== null && v !== undefined && String(v) !== '') f.set(k, String(v)); };
  put('leader', g.leader); put('district', g.district); put('direction', g.direction); put('status', g.status);
  put('people', g.people); put('day', g.day); put('time', g.time); for (const c of splitComposition(g.composition)) f.append('composition', c);
  put('coordinator', g.coordinator); put('coLeader', g.co_leader); put('feedbackAt', g.feedback_at); put('openedOn', g.opened_on);
  put('comment', g.comment); put('age', g.age); put('metro', g.metro); put('openToNew', g.open_to_new);
  put('training', g.training); put('no', g.no);
  // Вместимость передаём всегда, даже пустую: так непосланная остаётся как в базе, а посланная пустой — очищается.
  f.set('capacity', g.capacity === null ? '' : String(g.capacity));
  if (g.checked) f.set('checked', '1');
  if (g.campaign_registered) f.set('campaignRegistered', '1');
  if (g.campaign_only) f.set('campaignOnly', '1');
  return f;
}

export function createManager(deps: {
  groups: Pick<GroupsRepo, 'findActive' | 'update' | 'archive'>;
  coordinators: Pick<CoordinatorsRepo, 'create' | 'findActive' | 'rename' | 'archive'>;
  teamRoles: Pick<TeamRolesRepo, 'existing'>;
  directions: Pick<GroupDirectionsRepo, 'list'>;
  requests: Pick<RequestsRepo, 'archive'>;
  users: Pick<UsersRepo, 'findById' | 'delete'>;
  audit: Pick<AuditRepo, 'write'>;
}) {
  /** Роли из списка должны быть в справочнике: иначе база откажет ссылкой, а человек увидит «ошибку сервера». */
  const checkRoles = async (roles: readonly RoleRef[]): Promise<Extract<ActionOutcome, { ok: false }> | null> => {
    const ids = roles.flatMap((r) => ('id' in r ? [r.id] : []));
    if (ids.length === 0) return null;
    const known = new Set(await deps.teamRoles.existing(ids));
    return ids.every((id) => known.has(id))
      ? null
      : (fail('bad_request', 'Такой роли нет в справочнике: обновите страницу и выберите роли снова.') as Extract<ActionOutcome, { ok: false }>);
  };

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
        // У вместимости пустое значение — «вернуть общее», а не «нет поля» (нет поля значит «не менять», см. parseGroupForm).
        if (k === 'capacity') { merged.set(k, v.trim()); continue; }
        if (v.trim() === '') merged.delete(k); else merged.set(k, v);
      }
      const parsed = parseGroupForm(merged);
      if (!parsed.ok) return fail('bad_request', parsed.error);
      // Направление проверяем, только если его меняли: прежнее уже в справочнике, а переименованное — под новым названием.
      const direction = given.has('direction') ? await knownDirection(deps.directions, parsed.value.direction) : current.direction;
      if (!direction) return fail('bad_request', UNKNOWN_DIRECTION);
      // Закрытое остаётся как в базе: форма его не видела и затереть не должна.
      const input = {
        ...parsed.value,
        direction,
        // Телефон и телефон соведущего меняются только если их прислали; адрес — тоже (пустая строка его очищает); иначе остаются как в базе.
        ...(given.has('phone') ? {} : { phone: current.phone, phones: current.phones }),
        ...(given.has('address') ? {} : { address: current.address }),
        ...(given.has('coLeaderPhone') ? {} : { coLeaderPhone: current.co_leader_phone }),
        doNotRefer: given.has('doNotRefer') ? merged.has('doNotRefer') : current.do_not_refer,
        chamber: given.has('chamber') ? merged.has('chamber') : current.chamber,
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
      const roleError = await checkRoles(parsed.value.roles);
      if (roleError) return roleError;
      const created = await deps.coordinators.create(parsed.value, 'ui');
      await deps.audit.write(actor, 'coordinator.create', 'coordinator', created.id, { role: created.role });
      return { ok: true, id: created.id };
    },

    async updateCoordinator(id: number, body: unknown, actor: string): Promise<ActionOutcome> {
      const given = fieldsToForm(body);
      if (typeof given === 'string') return fail('bad_request', given);
      if (given.size === 0) return fail('bad_request', 'Нечего менять.');
      const current = await deps.coordinators.findActive(id);
      if (!current) return fail('not_found', 'Участник команды не найден.');
      const merged = new URLSearchParams({ name: current.name, roleIds: current.role_ids.join(', ') });
      for (const [k, v] of given) if (COORDINATOR_EDITABLE.includes(k)) merged.set(k, v);
      // Роль словами (так пишет только старый дашборд) заменяет роли целиком: иначе остались бы прежние.
      if (given.has('role') && !given.has('roleIds')) merged.delete('roleIds');
      const parsed = parseCoordinatorForm(merged);
      if (!parsed.ok) return fail('bad_request', parsed.error);
      const roleError = await checkRoles(parsed.value.roles);
      if (roleError) return roleError;
      const updated = await deps.coordinators.rename(id, parsed.value);
      if (!updated) return fail('not_found', 'Участник команды не найден.');
      await deps.audit.write(actor, 'coordinator.update', 'coordinator', id, { fields: [...given.keys()].filter((k) => COORDINATOR_EDITABLE.includes(k)) });
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

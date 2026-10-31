import { parseCoordinatorForm, parseGroupForm } from '../dashboard/forms.js';
import type { AuditRepo } from '../db/repos/audit.repo.js';
import { CoordinatorTakenError, type CoordinatorPersonRef, type CoordinatorsRepo, type RoleRef } from '../db/repos/coordinators.repo.js';
import type { TeamRolesRepo } from '../db/repos/teamRoles.repo.js';
import type { GroupDirectionsRepo } from '../db/repos/groupDirections.repo.js';
import type { GroupRow, GroupsRepo, PersonRef } from '../db/repos/groups.repo.js';
import type { RequestsRepo } from '../db/repos/requests.repo.js';
import type { UsersRepo } from '../db/repos/users.repo.js';
import type { ActionOutcome } from '../db/repos/placement.repo.js';
import { UNKNOWN_DIRECTION, fieldsToForm, knownDirection } from './create.js';
import { autoPlace, type Locate } from './locate.js';

/**
 * Правка и удаление записей справочника из нового интерфейса: группы, координаторы, заявки.
 *
 * Проверки — те же функции, что у форм старого дашборда. Отличие одно: правка частичная. Интерфейс присылает
 * только изменённые поля, остальное берётся из базы. Поэтому чужая правка, пришедшая между открытием формы и
 * «Сохранить», не затирается старыми значениями из формы.
 * Удаление мягкое (запись скрывается, остаётся в базе); решает, кому оно доступно, сервер (`server.ts`).
 */
const fail = (error: 'bad_request' | 'not_found', message: string): ActionOutcome => ({ ok: false, error, message });

/**
 * Что в строке справочника команды правится: человек из «Людей» (`personKey`, его ФИО и становится именем) и роли
 * (галочками из справочника или, в старом дашборде, одной ролью словами). `name` словами пишет только старый дашборд.
 */
const COORDINATOR_EDITABLE: readonly string[] = ['personKey', 'name', 'roleIds', 'role'];

const TAKEN = 'Этот человек уже есть в команде: откройте его строку в «Координаторах».';
export const PERSON_GONE = 'Этого человека уже нет в справочнике «Люди»: обновите страницу и выберите снова.';

/**
 * ФИО ведущего и соведущего текстом здесь не правится: ведущий — человек из «Людей» (`leaderKey`, `coLeaderKey`), и его
 * ФИО правят в карточке человека. Свободный ввод имени — только при создании группы (там же заводится карточка).
 */
const GROUP_EDITABLE = [
  'district', 'direction', 'status', 'people', 'day', 'time', 'composition', 'coordinator',
  'feedbackAt', 'openedOn', 'comment', 'age', 'metro', 'openToNew', 'training', 'no', 'checked', 'doNotRefer', 'chamber',
  'phone', 'address', 'coLeaderPhone', 'campaignRegistered', 'capacity', 'campaignOnly',
  // Человек из «Людей» на позиции ведущего и соведущего: ключ справочника («u12», «p7», «r345»); у соведущего пустая
  // строка — отвязать. Ведущего только меняют на другого человека: без ведущего группы не бывает.
  'leaderKey', 'coLeaderKey',
] as const;

const refOfRow = (userId: number | null | undefined, personId: number | null | undefined): PersonRef | null =>
  userId ? { kind: 'user', id: Number(userId) } : personId ? { kind: 'person', id: Number(personId) } : null;

/** Ссылки на людей в форму группы не входят: проверяются отдельно (`personRefOf`), а пишутся вместе с правкой. */
const GROUP_LINKS = ['leaderKey', 'coLeaderKey'] as const;

/** Старый ключ «r» (человек заявки): ссылаемся на человека, на которого указывает заявка (`personFromRequest`). */
export type LinkRef = PersonRef | { kind: 'request'; id: number };

/**
 * Ключ справочника «Люди» → ссылка: регистрация («u»), карточка, внесённая вручную («p»), или человек из заявки без
 * регистрации («r») — ему при привязке заводится карточка. null — отвязать.
 */
export function personRefOf(key: string): LinkRef | null | 'bad' {
  const v = key.trim();
  if (v === '') return null;
  const m = /^([upr])([1-9]\d{0,15})$/.exec(v);
  if (!m) return 'bad';
  return { kind: m[1] === 'u' ? 'user' : m[1] === 'p' ? 'person' : 'request', id: Number(m[2]) };
}

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
  groups: Pick<GroupsRepo, 'findActive' | 'update' | 'archive' | 'personName' | 'personFromRequest' | 'personPhone'>;
  coordinators: Pick<CoordinatorsRepo, 'create' | 'findActive' | 'rename' | 'archive'>;
  teamRoles: Pick<TeamRolesRepo, 'existing'>;
  directions: Pick<GroupDirectionsRepo, 'list'>;
  requests: Pick<RequestsRepo, 'archive'>;
  users: Pick<UsersRepo, 'findById' | 'delete'>;
  audit: Pick<AuditRepo, 'write'>;
  /** Район и метро по новому адресу (`locate.ts`); без ключа геокодера их просто не будет. */
  locate?: Locate;
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

  /**
   * Человек для участника команды по ключу «Людей». Человеку из заявки без регистрации заводится карточка (как ведущему):
   * ссылаться можно только на запись о человеке. `check` — только проверить, ничего не заводя.
   */
  async function teamPerson(key: string, actor: string, check: boolean): Promise<{ person: CoordinatorPersonRef; name: string } | 'checked' | Extract<ActionOutcome, { ok: false }>> {
    const ref = personRefOf(key);
    if (ref === null || ref === 'bad') return fail('bad_request', 'Участника команды выбирают из справочника «Люди».') as Extract<ActionOutcome, { ok: false }>;
    if (ref.kind !== 'request' && (await deps.groups.personName(ref)) === null) return fail('bad_request', PERSON_GONE) as Extract<ActionOutcome, { ok: false }>;
    if (check) return 'checked';
    let own: PersonRef = ref as PersonRef;
    if (ref.kind === 'request') {
      const human = await deps.groups.personFromRequest(ref.id, actor);
      if (human === null) return fail('bad_request', PERSON_GONE) as Extract<ActionOutcome, { ok: false }>;
      own = human;
    }
    const name = await deps.groups.personName(own);
    if (!name) return fail('bad_request', PERSON_GONE) as Extract<ActionOutcome, { ok: false }>;
    return { person: own.kind === 'user' ? { userId: own.id } : { personId: own.id }, name };
  }

  /**
   * Телефон группы при смене ведущего. Другой человек вместо связанного — номер целиком его (из карточки; нет номера —
   * пусто: прежний принадлежит прежнему ведущему). Первая привязка группы из таблицы — это обычно тот же человек:
   * записанный номер остаётся, а номер из карточки добавляется в `phones`. Тот же человек или ведущий не менялся — ничего.
   */
  async function phonesForLeader(
    current: { leader_user_id: number | null; leader_person_id?: number | null; phone: string | null; phones: string[] },
    next: PersonRef | null | undefined,
  ): Promise<{ phone?: string | null; phones?: string[] }> {
    if (!next) return {};
    const was = refOfRow(current.leader_user_id, current.leader_person_id);
    if (was && was.kind === next.kind && was.id === next.id) return {};
    const own = await deps.groups.personPhone(next);
    if (was) return { phone: own, phones: own ? [own] : [] };
    return { phone: current.phone ?? own, phones: own && !current.phones.includes(own) ? [...current.phones, own] : current.phones };
  }

  const taken = (): Extract<ActionOutcome, { ok: false }> => ({ ok: false, error: 'conflict', message: TAKEN });

  return {
    async updateGroup(id: number, body: unknown, actor: string): Promise<ActionOutcome> {
      const given = fieldsToForm(body);
      if (typeof given === 'string') return fail('bad_request', given);
      const unknown = [...given.keys()].filter((k) => !(GROUP_EDITABLE as readonly string[]).includes(k));
      if (unknown.length > 0) return fail('bad_request', `Поле «${unknown[0]!.slice(0, 40)}» здесь менять нельзя.`);
      if (given.size === 0) return fail('bad_request', 'Нечего менять.');

      const links: { leader?: LinkRef | null; coLeader?: LinkRef | null } = {};
      for (const k of GROUP_LINKS) {
        if (!given.has(k)) continue;
        const ref = personRefOf(given.get(k)!);
        if (ref === 'bad') return fail('bad_request', 'Ведущего и соведущего выбирают из справочника «Люди».');
        if (ref === null && k === 'leaderKey') return fail('bad_request', 'Без ведущего группы не бывает: ведущего можно только сменить на другого человека.');
        if (ref !== null && ref.kind !== 'request' && (await deps.groups.personName(ref)) === null) {
          return fail('bad_request', 'Этого человека уже нет в справочнике «Люди»: обновите страницу и выберите снова.');
        }
        links[k === 'leaderKey' ? 'leader' : 'coLeader'] = ref;
      }

      const current = await deps.groups.findActive(id);
      if (!current) return fail('not_found', 'Группа не найдена.');
      // Один человек на обеих позициях — опечатка выбора: телефон и карточка у «двух ведущих» были бы одни.
      const same = (a: LinkRef | null, b: LinkRef | null) => !!a && !!b && a.kind === b.kind && a.id === b.id;
      const leaderNow = links.leader !== undefined ? links.leader : refOfRow(current.leader_user_id, current.leader_person_id);
      const coLeaderNow = links.coLeader !== undefined ? links.coLeader : refOfRow(current.co_leader_user_id, current.co_leader_person_id);
      if (same(leaderNow, coLeaderNow)) return fail('bad_request', 'Ведущий и соведущий — один и тот же человек: выберите разных.');

      const merged = groupToFields(current);
      for (const [k, v] of given) {
        if ((GROUP_LINKS as readonly string[]).includes(k)) continue;
        if (k === 'composition') { merged.delete(k); for (const c of splitComposition(v)) merged.append(k, c); continue; }
        if ((GROUP_FLAGS as readonly string[]).includes(k)) { if (v === '1' || v === 'true') merged.set(k, '1'); else merged.delete(k); continue; }
        // У вместимости пустое значение — «вернуть общее», а не «нет поля» (нет поля значит «не менять», см. parseGroupForm).
        if (k === 'capacity') { merged.set(k, v.trim()); continue; }
        if (v.trim() === '') merged.delete(k); else merged.set(k, v);
      }
      const parsed = parseGroupForm(merged);
      if (!parsed.ok) return fail('bad_request', parsed.error);
      // Человеку из заявки заводим карточку только теперь, когда правка прошла проверки: иначе отказ оставил бы лишнюю карточку.
      const resolved: { leaderRef?: PersonRef | null; coLeaderRef?: PersonRef | null } = {};
      const names: { leader?: string | null; coLeader?: string | null } = {};
      for (const pos of ['leader', 'coLeader'] as const) {
        const link = links[pos];
        if (link === undefined) continue;
        let ref: PersonRef | null = null;
        if (link?.kind === 'request') {
          const human = await deps.groups.personFromRequest(link.id, actor);
          if (human === null) return fail('bad_request', 'Этого человека уже нет в справочнике «Люди»: обновите страницу и выберите снова.');
          ref = human;
        } else {
          ref = link;
        }
        resolved[pos === 'leader' ? 'leaderRef' : 'coLeaderRef'] = ref;
        // Имя в группе — ФИО из карточки: по нему группу ищут и сверяют обращения «уже веду группу».
        if (ref) names[pos] = (await deps.groups.personName(ref)) ?? undefined;
        else names[pos] = null;
      }
      // Телефоны группы следуют за ведущим: по `phones` бот узнаёт, что человек уже ведёт группу, и ставит «40 дней».
      const leaderPhones = await phonesForLeader(current, resolved.leaderRef);
      // Направление проверяем, только если его меняли: прежнее уже в справочнике, а переименованное — под новым названием.
      const direction = given.has('direction') ? await knownDirection(deps.directions, parsed.value.direction) : current.direction;
      if (!direction) return fail('bad_request', UNKNOWN_DIRECTION);
      // Закрытое остаётся как в базе: форма его не видела и затереть не должна.
      const input = {
        ...parsed.value,
        direction,
        // Телефон и телефон соведущего меняются только если их прислали; адрес — тоже (пустая строка его очищает); иначе остаются как в базе.
        ...(given.has('phone') ? {} : { phone: current.phone, phones: current.phones, ...leaderPhones }),
        ...(given.has('address') ? {} : { address: current.address }),
        ...(given.has('coLeaderPhone') ? {} : { coLeaderPhone: current.co_leader_phone }),
        doNotRefer: given.has('doNotRefer') ? merged.has('doNotRefer') : current.do_not_refer,
        chamber: given.has('chamber') ? merged.has('chamber') : current.chamber,
        ...resolved,
        ...(names.leader ? { leader: names.leader } : {}),
        // Отвязанный соведущий уходит целиком — с именем и телефоном, записанными в группе.
        ...(names.coLeader === null ? { coLeader: null, coLeaderPhone: null } : names.coLeader ? { coLeader: names.coLeader } : {}),
      };
      // Район и метро ищем, только когда адрес поменяли: правку района или метро руками при прежнем адресе не перетираем.
      const addressChanged = given.has('address') && (input.address ?? '') !== (current.address ?? '');
      const auto = addressChanged ? await autoPlace(deps.locate, input.address, input.district) : {};
      const updated = await deps.groups.update(id, { ...input, ...auto });
      if (!updated) return fail('not_found', 'Группа не найдена.');
      await deps.audit.write(actor, 'group.update', 'group', id, { fields: [...given.keys()], ...(Object.keys(auto).length ? { auto: Object.keys(auto) } : {}) });
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
      const key = form.get('personKey');
      // Имя — ФИО выбранного человека: форма проверяется с ним, а карточка человеку из заявки заводится только после проверок.
      if (key !== null) {
        const checked = await teamPerson(key, actor, true);
        if (checked !== 'checked' && !('person' in checked)) return checked;
        form.set('name', '—'); // заглушка для проверки формы: настоящее имя — ФИО человека ниже
      }
      const parsed = parseCoordinatorForm(form);
      if (!parsed.ok) return fail('bad_request', parsed.error) as Extract<ActionOutcome, { ok: false }>;
      const roleError = await checkRoles(parsed.value.roles);
      if (roleError) return roleError;
      let input = parsed.value;
      if (key !== null) {
        const person = await teamPerson(key, actor, false);
        if (person === 'checked' || !('person' in person)) return person === 'checked' ? fail('bad_request', PERSON_GONE) as Extract<ActionOutcome, { ok: false }> : person;
        input = { ...input, name: person.name, person: person.person };
      }
      let created;
      try {
        created = await deps.coordinators.create(input, 'ui');
      } catch (err) {
        if (err instanceof CoordinatorTakenError) return taken();
        throw err;
      }
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
      for (const [k, v] of given) if (COORDINATOR_EDITABLE.includes(k) && k !== 'personKey') merged.set(k, v);
      // Роль словами (так пишет только старый дашборд) заменяет роли целиком: иначе остались бы прежние.
      if (given.has('role') && !given.has('roleIds')) merged.delete('roleIds');
      const key = given.get('personKey');
      if (key !== null && key !== undefined) {
        const checked = await teamPerson(key, actor, true);
        if (checked !== 'checked' && !('person' in checked)) return checked;
      }
      const parsed = parseCoordinatorForm(merged);
      if (!parsed.ok) return fail('bad_request', parsed.error);
      const roleError = await checkRoles(parsed.value.roles);
      if (roleError) return roleError;
      let input = parsed.value;
      // Сменили человека — имя становится его ФИО и вместе с ним переписывается в заявках и группах (rename).
      if (key !== null && key !== undefined) {
        const person = await teamPerson(key, actor, false);
        if (person === 'checked' || !('person' in person)) return person === 'checked' ? fail('bad_request', PERSON_GONE) : person;
        input = { ...input, name: person.name, person: person.person };
      }
      let updated;
      try {
        updated = await deps.coordinators.rename(id, input);
      } catch (err) {
        if (err instanceof CoordinatorTakenError) return taken();
        throw err;
      }
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

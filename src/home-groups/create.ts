import { SCHEDULE_DAYS, SCHEDULE_TIMES, parseGroupForm, parseRequestForm } from '../dashboard/forms.js';
import { ALL_DISTRICTS, ALL_GROUP_STATUSES, COMPOSITIONS, groupCode } from '../core/groups.js';
import { allChurchOptions } from '../core/churches.js';
import { AGE_GROUPS } from '../core/texts.js';
import type { AuditRepo } from '../db/repos/audit.repo.js';
import type { CoordinatorsRepo } from '../db/repos/coordinators.repo.js';
import type { TeamRolesRepo } from '../db/repos/teamRoles.repo.js';
import type { GroupDirectionsRepo } from '../db/repos/groupDirections.repo.js';
import type { GroupInput, GroupsRepo, PersonRef } from '../db/repos/groups.repo.js';
import type { MembersRepo, PersonInput } from '../db/repos/members.repo.js';
import { REQUEST_STATUSES, type RequestsRepo, type RequestWithUser } from '../db/repos/requests.repo.js';
import type { LeaderCandidate, UsersRepo } from '../db/repos/users.repo.js';
import type { ActionError, FormMeta } from './contracts.js';

/**
 * Создание заявки и группы из «+ Создать». Проверки — те же функции, что у форм старого дашборда
 * (`src/dashboard/forms.ts`): правила ввода одни на оба интерфейса, а сообщения об ошибках уже по-русски.
 */
export type CreateOutcome = { ok: true; id: number } | { ok: false; error: ActionError['error']; message: string };

const bad = (message: string): CreateOutcome => ({ ok: false, error: 'bad_request', message });

/**
 * Направление из формы — одно из справочника (без учёта регистра); вернёт его название как в справочнике. Без проверки
 * незнакомое слово молча легло бы на основное направление (так `group_direction_id` принимает слова старого дашборда).
 */
export async function knownDirection(directions: Pick<GroupDirectionsRepo, 'list'>, name: string): Promise<string | null> {
  const key = name.trim().toLowerCase();
  return (await directions.list()).find((d) => d.name.trim().toLowerCase() === key)?.name ?? null;
}

export const UNKNOWN_DIRECTION = 'Такого направления нет в справочнике: обновите страницу и выберите направление снова.';

/** Отметка формы: «1» или «true» — да. */
export const flag = (form: URLSearchParams, name: string): boolean => ['1', 'true'].includes(form.get(name) ?? '');

/** Тело запроса → поля формы: объект строк, не слишком большой. */
export function fieldsToForm(body: unknown): URLSearchParams | string {
  if (typeof body !== 'object' || body === null) return 'Нужны поля формы.';
  const fields = (body as Record<string, unknown>)['fields'];
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) return 'Нужны поля формы.';
  const entries = Object.entries(fields as Record<string, unknown>);
  if (entries.length > 60) return 'Слишком много полей.';
  const form = new URLSearchParams();
  for (const [key, value] of entries) {
    if (typeof value !== 'string') return `Поле «${key.slice(0, 40)}» должно быть текстом.`;
    // Комментарии бывают длинными, но не бесконечными.
    if (value.length > 4000) return `Слишком длинный текст в поле «${key.slice(0, 40)}».`;
    form.set(key, value);
  }
  return form;
}

/** Карточка человека из ФИО и телефона, вписанных в форму группы. */
const cardOf = (fio: string, phone: string | null | undefined): PersonInput => ({ fio, phone: phone ?? null, age: null, place: null, note: null });

export function createRecordCreator(deps: {
  requests: Pick<RequestsRepo, 'createFromDashboard' | 'findById'>;
  groups: Pick<GroupsRepo, 'create' | 'requestLinkState' | 'linkToRequest' | 'archive' | 'personName' | 'setLinksIfEmpty' | 'hasLeaderLink'>;
  /** Карточки в «Людях» для ведущего и соведущего, вписанных в форму от руки. */
  persons: Pick<MembersRepo, 'createPerson'>;
  directions: Pick<GroupDirectionsRepo, 'list'>;
  audit: Pick<AuditRepo, 'write'>;
  /** Уведомление служителю о новой заявке; не должно бросать (см. `notifierFromEnv`). */
  notify?: (request: RequestWithUser) => Promise<void>;
}) {
  /**
   * Ведущий и соведущий новой группы — люди из «Людей», как и при правке. Выбранный «из зарегистрированных»
   * (`leaderCandidate`) — ссылка на его регистрацию; вписанный от руки — новая карточка с этим ФИО и телефоном. Ведущий
   * из заявки («Создать группу по заявке») уже связан `linkToRequest`, его не трогаем.
   */
  async function linkLeaders(groupId: number, value: GroupInput, form: URLSearchParams, actor: string): Promise<void> {
    let leader: PersonRef | undefined;
    if (!(await deps.groups.hasLeaderLink(groupId))) {
      const candidate = form.get('leaderCandidate')?.trim() ?? '';
      const user: PersonRef | null = /^\d{1,15}$/.test(candidate) ? { kind: 'user', id: Number(candidate) } : null;
      leader = user && (await deps.groups.personName(user)) !== null
        ? user
        : { kind: 'person', id: await deps.persons.createPerson(cardOf(value.leader, value.phone), actor) };
    }
    const coName = value.coLeader?.trim();
    const coLeader: PersonRef | undefined = coName
      ? { kind: 'person', id: await deps.persons.createPerson(cardOf(coName, value.coLeaderPhone), actor) }
      : undefined;
    await deps.groups.setLinksIfEmpty(groupId, leader, coLeader);
  }

  return {
    async request(body: unknown, actor: string): Promise<CreateOutcome> {
      const form = fieldsToForm(body);
      if (typeof form === 'string') return bad(form);
      const parsed = parseRequestForm(form);
      if (!parsed.ok) return bad(parsed.error);
      const id = await deps.requests.createFromDashboard(parsed.value);
      await deps.audit.write(actor, 'request.create', 'request', id, { type: parsed.value.type, status: parsed.value.status });
      // Заявка, заведённая в интерфейсе, — тот же повод уведомить служителя, что и заявка из чата с ботом.
      const created = deps.notify ? await deps.requests.findById(id) : null;
      if (created) await deps.notify!(created);
      return { ok: true, id };
    },

    /**
     * Новая группа; с `sourceRequestId` — «Создать группу по заявке»: группа связывается с заявкой (`source_request_id`)
     * и с регистрацией человека как ведущего. По одной заявке — одна действующая группа.
     */
    async group(body: unknown, actor: string): Promise<CreateOutcome> {
      const form = fieldsToForm(body);
      if (typeof form === 'string') return bad(form);
      const parsed = parseGroupForm(form);
      if (!parsed.ok) return bad(parsed.error);
      const direction = await knownDirection(deps.directions, parsed.value.direction);
      if (!direction) return bad(UNKNOWN_DIRECTION);
      const rawRequest = form.get('sourceRequestId')?.trim() ?? '';
      if (rawRequest && !/^\d{1,15}$/.test(rawRequest)) return bad('Неверный номер заявки.');
      const requestId = rawRequest ? Number(rawRequest) : null;
      if (requestId !== null) {
        const state = await deps.groups.requestLinkState(requestId);
        if (state === 'missing') return { ok: false, error: 'not_found', message: 'Заявка не найдена: возможно, её удалили.' };
        if (state !== 'free') return { ok: false, error: 'conflict', message: `По этой заявке группа уже заведена: ${groupCode(state)}.` };
      }
      // source='ui': видно, откуда запись, и повторный перенос таблицы её не затирает.
      const created = await deps.groups.create(
        { ...parsed.value, direction, doNotRefer: flag(form, 'doNotRefer'), chamber: flag(form, 'chamber') }, 'ui',
      );
      if (requestId !== null && !(await deps.groups.linkToRequest(created.id, requestId))) {
        // Пока заполняли форму, по той же заявке завели другую группу: эту убираем, чтобы не было двух.
        await deps.groups.archive(created.id);
        return { ok: false, error: 'conflict', message: 'По этой заявке только что завели другую группу: обновите страницу.' };
      }
      await linkLeaders(created.id, parsed.value, form, actor);
      await deps.audit.write(actor, 'group.create', 'group', created.id, {
        status: parsed.value.status, district: parsed.value.district, ...(requestId !== null ? { fromRequest: requestId } : {}),
      });
      // И в ленту заявки: по ней видно, что группа заведена, кем и когда.
      if (requestId !== null) await deps.audit.write(actor, 'request.group_created', 'request', requestId, { groupId: created.id });
      return { ok: true, id: created.id };
    },
  };
}

export type RecordCreator = ReturnType<typeof createRecordCreator>;

/** Ответ про малую группу в регистрации — подписи в третьем лице: форму заполняет служитель за человека. */
const MDG_STATUSES: FormMeta['mdgStatuses'] = [
  { value: 'open', label: 'хочет открыть Малую группу' },
  { value: 'home', label: 'может предоставить свой дом для Малой группы' },
  { value: 'join', label: 'хочет присоединиться к Малой группе' },
  { value: 'member', label: 'уже состоит в Малой группе' },
  { value: 'leader', label: 'ведёт Малую группу' },
];

const REQUEST_TYPES: FormMeta['requestTypes'] = [
  { value: 'join_group', label: 'Хочет в домашнюю группу' },
  { value: 'lead_group', label: 'Хочет открыть группу' },
  { value: 'question', label: 'Вопрос служителю' },
  { value: 'already_member', label: 'Уже состоит в группе' },
  { value: 'already_leader', label: 'Уже ведёт группу' },
];

/** Значения «Приём новых» — те же, что в таблице церкви и в форме старого дашборда. */
const OPEN_TO_NEW: FormMeta['openToNew'] = [
  { value: 'ДА', label: 'Да' },
  { value: 'НЕТ', label: 'Нет' },
  { value: 'По требованию', label: 'По требованию' },
];

const MDG_CANDIDATE_LABEL: Record<string, string> = { open: 'готов открыть Малую группу', home: 'готов предоставить свой дом' };

/** Подпись кандидата в ведущие: весь профиль, который человек заполнил в боте, — как в старом дашборде. */
function candidateLabel(c: LeaderCandidate): string {
  return [c.full_name, c.phone, c.church, c.mdg_status ? MDG_CANDIDATE_LABEL[c.mdg_status] ?? c.mdg_status : null, c.location, c.age]
    .filter(Boolean).join(' · ');
}

/** Справочники форм: серверные списки, чтобы интерфейс не держал свою копию (в старом дашборде они дублировались). */
export function createFormMeta(deps: {
  defaultCapacity: number;
  coordinators: Pick<CoordinatorsRepo, 'listActive'>;
  teamRoles: Pick<TeamRolesRepo, 'list'>;
  directions: Pick<GroupDirectionsRepo, 'list'>;
  groups: Pick<GroupsRepo, 'forDashboard'>;
  users: Pick<UsersRepo, 'leaderCandidates'>;
}): () => Promise<FormMeta> {
  return async () => ({
    districts: [...ALL_DISTRICTS],
    groupDirections: (await deps.directions.list()).map((d) => d.name),
    groupStatuses: [...ALL_GROUP_STATUSES],
    compositions: [...COMPOSITIONS],
    requestStatuses: [...REQUEST_STATUSES],
    requestTypes: REQUEST_TYPES,
    ageGroups: [...AGE_GROUPS],
    coordinators: (await deps.coordinators.listActive()).map((c) => c.name),
    teamRoles: (await deps.teamRoles.list()).map((r) => ({ id: r.id, name: r.name })),
    scheduleDays: SCHEDULE_DAYS.map(({ value, label }) => ({ value, label })),
    scheduleTimes: SCHEDULE_TIMES.map(({ value, label }) => ({ value, label })),
    churches: allChurchOptions(),
    mdgStatuses: MDG_STATUSES,
    openToNew: OPEN_TO_NEW,
    defaultCapacity: deps.defaultCapacity,
    groups: (await deps.groups.forDashboard()).map((g) => ({ id: g.id, code: groupCode(g.id), leader: g.leader })),
    leaderCandidates: (await deps.users.leaderCandidates())
      .filter((c) => c.full_name)
      .map((c) => ({ id: c.id, fullName: c.full_name!, phone: c.phone, label: candidateLabel(c) })),
  });
}

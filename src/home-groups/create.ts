import { parseGroupForm, parseRequestForm } from '../dashboard/forms.js';
import { ALL_DISTRICTS, ALL_GROUP_STATUSES, COMPOSITIONS, FORMATS } from '../core/groups.js';
import { allChurchOptions } from '../core/churches.js';
import { AGE_GROUPS } from '../core/texts.js';
import type { AuditRepo } from '../db/repos/audit.repo.js';
import type { CoordinatorsRepo } from '../db/repos/coordinators.repo.js';
import type { GroupsRepo } from '../db/repos/groups.repo.js';
import { REQUEST_STATUSES, type RequestsRepo, type RequestWithUser } from '../db/repos/requests.repo.js';
import type { ActionError, FormMeta } from './contracts.js';

/**
 * Создание заявки и группы из «+ Создать». Проверки — те же функции, что у форм старого дашборда
 * (`src/dashboard/forms.ts`): правила ввода одни на оба интерфейса, а сообщения об ошибках уже по-русски.
 */
export type CreateOutcome = { ok: true; id: number } | { ok: false; error: ActionError['error']; message: string };

const bad = (message: string): CreateOutcome => ({ ok: false, error: 'bad_request', message });

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

export function createRecordCreator(deps: {
  requests: Pick<RequestsRepo, 'createFromDashboard' | 'findById'>;
  groups: Pick<GroupsRepo, 'create'>;
  audit: Pick<AuditRepo, 'write'>;
  /** Уведомление служителю о новой заявке; не должно бросать (см. `notifierFromEnv`). */
  notify?: (request: RequestWithUser) => Promise<void>;
}) {
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

    async group(body: unknown, actor: string): Promise<CreateOutcome> {
      const form = fieldsToForm(body);
      if (typeof form === 'string') return bad(form);
      const parsed = parseGroupForm(form);
      if (!parsed.ok) return bad(parsed.error);
      // source='ui': видно, откуда запись, и повторный перенос таблицы её не затирает.
      const created = await deps.groups.create(parsed.value as never, 'ui');
      await deps.audit.write(actor, 'group.create', 'group', created.id, { status: parsed.value.status, district: parsed.value.district });
      return { ok: true, id: created.id };
    },
  };
}

export type RecordCreator = ReturnType<typeof createRecordCreator>;

/** Ответ про малую группу в регистрации — подписи в третьем лице: форму заполняет служитель за человека. */
const MDG_STATUSES: FormMeta['mdgStatuses'] = [
  { value: 'open', label: 'готов открыть Малую группу' },
  { value: 'home', label: 'готов предоставить свой дом для Малой группы' },
  { value: 'join', label: 'хочет присоединиться к Малой группе' },
  { value: 'member', label: 'уже состоит в Малой группе' },
  { value: 'leader', label: 'ведёт Малую группу' },
];

const REQUEST_TYPES: FormMeta['requestTypes'] = [
  { value: 'join_group', label: 'Хочет в домашнюю группу' },
  { value: 'lead_group', label: 'Готов открыть группу' },
  { value: 'question', label: 'Вопрос служителю' },
  { value: 'already_member', label: 'Уже состоит в группе' },
  { value: 'already_leader', label: 'Уже ведёт группу' },
];

/** Справочники форм: серверные списки, чтобы интерфейс не держал свою копию (в старом дашборде они дублировались). */
export function createFormMeta(coordinators: Pick<CoordinatorsRepo, 'listActive'>): () => Promise<FormMeta> {
  return async () => ({
    districts: [...ALL_DISTRICTS],
    groupFormats: [...FORMATS],
    groupStatuses: [...ALL_GROUP_STATUSES],
    compositions: [...COMPOSITIONS],
    requestStatuses: [...REQUEST_STATUSES],
    requestTypes: REQUEST_TYPES,
    ageGroups: [...AGE_GROUPS],
    coordinators: (await coordinators.listActive()).map((c) => c.name),
    churches: allChurchOptions(),
    mdgStatuses: MDG_STATUSES,
  });
}

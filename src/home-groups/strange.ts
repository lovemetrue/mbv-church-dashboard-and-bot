import { parsePersonKey } from '../db/repos/members.repo.js';
import type { ActionOutcome } from '../db/repos/placement.repo.js';
import type { StrangeRepo, StrangeTarget } from '../db/repos/strange.repo.js';

const bad = (message: string): ActionOutcome => ({ ok: false, error: 'bad_request', message });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Разбор тела запроса «поставить/снять метку»: то, что пришло из сети, проверяется до обращения к базе. */
function parse(body: unknown): { value: boolean; note: string | null } | ActionOutcome {
  if (!isRecord(body) || typeof body['value'] !== 'boolean') return bad('Нужно указать: поставить метку или снять.');
  const note = body['note'];
  if (note !== undefined && note !== null && typeof note !== 'string') return bad('Заметка должна быть текстом.');
  return { value: body['value'], note: typeof note === 'string' ? note : null };
}

export function createStrange(deps: { repo: Pick<StrangeRepo, 'set'> }) {
  return {
    /** Метка со страницы заявки: ляжет на человека заявки (регистрацию или саму заявку). */
    async forRequest(requestId: number, body: unknown, actor: string): Promise<ActionOutcome> {
      const p = parse(body);
      if ('ok' in p) return p;
      return deps.repo.set({ kind: 'request', id: requestId }, p.value, p.note, actor);
    },

    /** Метка по ключу человека из справочника: u12, r345, p7. */
    async forPerson(body: unknown, actor: string): Promise<ActionOutcome> {
      if (!isRecord(body)) return bad('Нужно указать человека.');
      const ref = parsePersonKey(body['key']);
      if (!ref) return bad('Не удалось определить человека.');
      const p = parse(body);
      if ('ok' in p) return p;
      const target: StrangeTarget = { kind: ref.kind === 'u' ? 'user' : ref.kind === 'r' ? 'request' : 'person', id: ref.id };
      return deps.repo.set(target, p.value, p.note, actor);
    },
  };
}

export type Strange = ReturnType<typeof createStrange>;

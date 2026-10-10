import type { AuditRepo } from '../../db/repos/audit.repo.js';
import type { ErrorsRepo } from '../../db/repos/errors.repo.js';
import type { PromptsRepo } from '../../db/repos/prompts.repo.js';
import type {
  ActionError, AuditEntry, ErrorEntry, PromptBlock, SettingsAuditView, SettingsErrorsView, SettingsHealthView,
  SettingsPromptsView,
} from '../../home-groups/contracts.js';
import { AGENTS, findBlock, MAX_NOTE_LENGTH, MAX_PROMPT_LENGTH } from './defaults.js';

/**
 * Раздел «Настройки»: чтение журналов, состояние сервера и инструкции агентов с версиями.
 * Он не знает про сервис «Домашние группы» (только про общие таблицы платформы), чтобы потом
 * переехать в витрину как есть.
 */

export type SettingsOutcome = { ok: true } | { ok: false; error: ActionError['error']; message: string };
const bad = (message: string): SettingsOutcome => ({ ok: false, error: 'bad_request', message });

const AUDIT_LABELS: Record<string, string> = {
  'request.approve': 'Утверждение заявки',
  'request.reject': 'Отказ от предложенной группы',
  'request.need_call': 'Отметка «нужен звонок»',
  'request.need_call_off': 'Снята отметка «нужен звонок»',
  'matching.run': 'Подбор для новых заявок',
  'prompt.save': 'Правка инструкции агента',
  'prompt.activate': 'Откат версии инструкции агента',
};

export interface SettingsDeps {
  audit: Pick<AuditRepo, 'recent'>;
  errors: Pick<ErrorsRepo, 'recent'>;
  prompts: Pick<PromptsRepo, 'all' | 'save' | 'activate'>;
  health: () => Promise<SettingsHealthView>;
  now?: () => Date;
}

export function createSettings(deps: SettingsDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    health: deps.health,

    async errors(): Promise<SettingsErrorsView> {
      const rows = await deps.errors.recent(200);
      const items: ErrorEntry[] = rows.map((r) => ({
        id: r.id, at: r.at.toISOString(), service: r.service, message: r.message, context: r.context,
      }));
      return { generatedAt: now().toISOString(), items };
    },

    async audit(): Promise<SettingsAuditView> {
      const rows = await deps.audit.recent(200);
      const items: AuditEntry[] = rows.map((r) => ({
        id: r.id, at: r.at.toISOString(), actor: r.actor, service: r.service, action: r.action,
        actionLabel: AUDIT_LABELS[r.action] ?? r.action,
        entityType: r.entity_type, entityId: r.entity_id, before: r.before, after: r.after, note: r.note,
      }));
      return { generatedAt: now().toISOString(), items };
    },

    async prompts(): Promise<SettingsPromptsView> {
      const rows = await deps.prompts.all();
      const agents = AGENTS.map((agent) => ({
        key: agent.key,
        title: agent.title,
        model: agent.model,
        blocks: agent.blocks.map((block): PromptBlock => {
          const versions = rows.filter((r) => r.agent_key === agent.key && r.block_key === block.key);
          const active = versions.find((v) => v.active);
          return {
            key: block.key, title: block.title, purpose: block.purpose, editable: block.editable,
            text: active?.text ?? block.text,
            // Версии есть, но действующей нет, быть не может (уникальный индекс и откат это исключают),
            // однако «по умолчанию» — это именно отсутствие действующей версии, а не отсутствие версий.
            isDefault: !active,
            versions: versions.map((v) => ({
              version: v.version, at: v.created_at.toISOString(), by: v.created_by, note: v.note, active: v.active,
            })),
          };
        }),
      }));
      return { generatedAt: now().toISOString(), agents };
    },

    async savePrompt(body: unknown, actor: string): Promise<SettingsOutcome> {
      if (typeof body !== 'object' || body === null) return bad('Нужно указать блок и текст.');
      const { agent, block, text, note } = body as Record<string, unknown>;
      if (typeof agent !== 'string' || typeof block !== 'string') return bad('Нужно указать агента и блок.');
      const found = findBlock(agent, block);
      if (!found) return bad('Такого блока нет.');
      if (!found.block.editable) return bad('Этот блок задаётся кодом и здесь не меняется.');
      if (typeof text !== 'string') return bad('Нужен текст.');
      // Пустой текст запрещён: пустой блок «Примеры» — это его состояние по умолчанию, а не версия.
      if (text.trim().length === 0) return bad('Текст не может быть пустым.');
      if (text.length > MAX_PROMPT_LENGTH) return bad(`Текст слишком длинный (до ${MAX_PROMPT_LENGTH} знаков).`);
      if (note !== undefined && note !== null && typeof note !== 'string') return bad('Комментарий должен быть текстом.');
      if (typeof note === 'string' && note.length > MAX_NOTE_LENGTH) return bad(`Комментарий слишком длинный (до ${MAX_NOTE_LENGTH} знаков).`);
      await deps.prompts.save(agent, block, text, typeof note === 'string' && note.trim() ? note.trim() : null, actor);
      return { ok: true };
    },

    async activatePrompt(body: unknown, actor: string): Promise<SettingsOutcome> {
      if (typeof body !== 'object' || body === null) return bad('Нужно указать блок и версию.');
      const { agent, block, version } = body as Record<string, unknown>;
      if (typeof agent !== 'string' || typeof block !== 'string' || !findBlock(agent, block)?.block.editable) return bad('Такого блока нет.');
      if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return bad('Нужен номер версии.');
      const done = await deps.prompts.activate(agent, block, version, actor);
      return done ? { ok: true } : { ok: false, error: 'not_found', message: 'Такой версии нет.' };
    },
  };
}

export type Settings = ReturnType<typeof createSettings>;

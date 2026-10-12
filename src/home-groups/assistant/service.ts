import { ALL_DISTRICTS } from '../../core/groups.js';
import { AGE_GROUPS } from '../../core/texts.js';
import type { AuditRepo } from '../../db/repos/audit.repo.js';
import type { HintsRepo } from '../../db/repos/hints.repo.js';
import type { PromptsRepo } from '../../db/repos/prompts.repo.js';
import type { SettingsRepo } from '../../db/repos/settings.repo.js';
import { LlmError, resolveLlm, type LlmClient, type LlmSource } from '../../platform/llm/deepseek.js';
import { buildViewsWithPlan, type ViewsInput, type ViewsOptions } from '../api/views.js';
import type { ActionError, AssistantRunOk, MatchingRunOk, SettingsAssistantView } from '../contracts.js';
import type { PlanEngineApi } from '../plan/types.js';
import { baseHash } from './brief.js';
import { parseReply } from './parse.js';
import { buildSystemPrompt, buildUserMessage } from './prompt.js';

export const ASSISTANT_ENABLED_KEY = 'assistant.enabled';
export const ASSISTANT_LAST_RUN_KEY = 'assistant.last_run';

type Failure = { ok: false; error: ActionError['error']; message: string };
type Outcome = AssistantRunOk | Failure;
const fail = (error: ActionError['error'], message: string): Failure => ({ ok: false, error, message });

/** Записей в одном запросе к модели и за один запуск: ограничивают и расход, и объём данных, уходящих наружу. */
const BATCH = 20;
const MAX_PER_RUN = 40;

/**
 * Помощник по разбору заявок. Читает записи, которые скрипт не понял, просит модель определить район, возраст и
 * время, перепроверяет ответ по справочникам и сохраняет разбор. Группу он не выбирает: после разбора запускается
 * обычный подбор, и тот же расчёт, что и для остальных, решает, какую группу предложить.
 *
 * Без ключа (`llm = null`) или при выключенном переключателе запуск отказывает понятным текстом, остальное работает.
 */
export function createAssistant(deps: {
  load: () => Promise<ViewsInput>;
  engine: PlanEngineApi;
  viewOptions: ViewsOptions;
  /** Готовый клиент (тесты) или источник, который читает подключение при каждом обращении (бой). */
  llm: LlmClient | LlmSource | null;
  hints: Pick<HintsRepo, 'upsertMany'>;
  prompts: Pick<PromptsRepo, 'all'>;
  settings: Pick<SettingsRepo, 'get' | 'set'>;
  audit: Pick<AuditRepo, 'write'>;
  matching: { run(actor: string): Promise<MatchingRunOk> };
  invalidate: () => void;
  reportError: (source: string, err: unknown, context: string) => void;
  /** Готова ли в базе роль только для чтения (нужна чату). */
  roleReady?: () => Promise<boolean>;
}) {
  let running = false;
  const ages = AGE_GROUPS.filter((a) => deps.engine.parseAgeRange(a) !== null);
  const districts = ALL_DISTRICTS.filter((d) => d !== 'Не указан');

  return {
    available: async (): Promise<boolean> => (await resolveLlm(deps.llm)) !== null,

    /** Для кнопки «✦ Помощник»: показывать её, только когда всё готово. */
    async status(): Promise<{ available: boolean; enabled: boolean; chat: boolean }> {
      const enabled = (await deps.settings.get<boolean>(ASSISTANT_ENABLED_KEY)) === true;
      const available = (await resolveLlm(deps.llm)) !== null;
      const chat = available && enabled && (await (deps.roleReady?.() ?? Promise.resolve(false)));
      return { available, enabled, chat };
    },
    isEnabled: async (): Promise<boolean> => (await deps.settings.get<boolean>(ASSISTANT_ENABLED_KEY)) === true,

    async setEnabled(enabled: boolean, actor: string): Promise<void> {
      await deps.settings.set(ASSISTANT_ENABLED_KEY, enabled, actor);
      await deps.audit.write(actor, 'settings.assistant', 'settings', null, { enabled });
    },

    /** Без `llm`: подключение (провайдер, модель, ключ) в обзор добавляет `createLlmConfig`. */
    async view(): Promise<Omit<SettingsAssistantView, 'llm'>> {
      const last = await deps.settings.get<NonNullable<SettingsAssistantView['lastRun']>>(ASSISTANT_LAST_RUN_KEY);
      const llm = await resolveLlm(deps.llm);
      return {
        generatedAt: new Date().toISOString(),
        available: llm !== null,
        enabled: (await deps.settings.get<boolean>(ASSISTANT_ENABLED_KEY)) === true,
        model: llm?.model ?? null,
        lastRun: last ?? null,
      };
    },

    async run(actor: string): Promise<Outcome> {
      const llm = await resolveLlm(deps.llm);
      if (!llm) return fail('unavailable', 'Помощник не подключён: не задан ключ. Подробности — в «Настройки → Помощник».');
      if ((await deps.settings.get<boolean>(ASSISTANT_ENABLED_KEY)) !== true) {
        return fail('unavailable', 'Помощник выключен. Включить его можно в «Настройки → Помощник».');
      }
      if (running) return fail('conflict', 'Разбор уже идёт. Подождите минуту.');
      running = true;
      try {
        const { assistantCandidates } = buildViewsWithPlan(await deps.load(), deps.engine, new Date(), deps.viewOptions);
        const picked = assistantCandidates.slice(0, MAX_PER_RUN);
        if (picked.length === 0) return { ok: true, asked: 0, filled: 0, withQuestions: 0, proposals: 0 };

        const system = await buildSystemPrompt(deps.prompts);
        let filled = 0;
        let withQuestions = 0;
        for (let i = 0; i < picked.length; i += BATCH) {
          const batch = picked.slice(i, i + BATCH).map((c, j) => ({ ...c, ref: `r${i + j + 1}` }));
          const reply = await llm.complete({
            system,
            user: buildUserMessage(batch, { districts, ages }),
          });
          const parsed = parseReply(reply.text, { refs: new Set(batch.map((b) => b.ref)), districts, ages });
          const byRef = new Map(parsed.map((p) => [p.ref, p]));
          // Заявка без ответа тоже получает пустой разбор: иначе каждый запуск спрашивал бы про неё снова и тратил деньги.
          await deps.hints.upsertMany(batch.map((b) => {
            const p = byRef.get(b.ref);
            return {
              requestId: b.id, district: p?.district ?? null, age: p?.age ?? null, days: p?.days ?? [], slot: p?.slot ?? null,
              questions: p?.questions ?? [], baseHash: baseHash(b.brief), model: llm.model,
            };
          }));
          for (const p of parsed) {
            if (p.district || p.age || p.days.length > 0 || p.slot) filled += 1;
            if (p.questions.length > 0) withQuestions += 1;
          }
        }
        deps.invalidate();
        // Разбор подставился в данные заявок: теперь обычный подбор может найти им группы.
        const matching = await deps.matching.run(actor);
        const result: AssistantRunOk = { ok: true, asked: picked.length, filled, withQuestions, proposals: matching.created };
        const record = { at: new Date().toISOString(), actor, asked: result.asked, filled, withQuestions, proposals: matching.created };
        await deps.settings.set(ASSISTANT_LAST_RUN_KEY, record, actor);
        // В журнал — только числа и модель: ни записей людей, ни ответов модели.
        await deps.audit.write(actor, 'assistant.run', 'assistant', null, { ...result, model: llm.model });
        return result;
      } catch (err) {
        if (err instanceof LlmError) {
          deps.reportError('помощник', err, `разбор заявок: ${err.code}`);
          return fail('unavailable', err.message);
        }
        throw err;
      } finally {
        running = false;
      }
    },
  };
}

export type Assistant = ReturnType<typeof createAssistant>;

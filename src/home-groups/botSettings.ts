import type { AuditRepo } from '../db/repos/audit.repo.js';
import type { SettingsRepo } from '../db/repos/settings.repo.js';
import { EXTRA_QUESTIONS_KEY } from '../core/rollout.js';
import type { ActionError, SettingsBotView } from './contracts.js';

/**
 * Настройка бота из интерфейса: кому задавать новые вопросы анкеты (время и адрес).
 *
 * Раньше это было только значением `EXTRA_QUESTIONS` в `.env` на сервере, и руководителю приходилось просить
 * об изменении того, кто с сервером работает. Теперь значение лежит в `app_settings`, бот читает его раз в
 * несколько секунд, а `.env` остаётся значением по умолчанию — пока здесь ничего не сохранили.
 */
type Outcome = { ok: true } | { ok: false; error: ActionError['error']; message: string };
const bad = (message: string): Outcome => ({ ok: false, error: 'bad_request', message });

/** Формат записи id такой же, как разбирает `extraQuestionsEnabled`: «111» или «max:111». */
const ID = /^(?:(?:telegram|max):)?\d{3,20}$/;

function modeOf(value: string): { mode: 'off' | 'all' | 'list'; ids: string } {
  const v = value.trim().toLowerCase();
  if (v === '' || v === 'off') return { mode: 'off', ids: '' };
  if (v === 'all') return { mode: 'all', ids: '' };
  return { mode: 'list', ids: v.split(',').map((x) => x.trim()).filter(Boolean).join(',') };
}

export function createBotSettings(deps: { settings: Pick<SettingsRepo, 'get' | 'set'>; audit: Pick<AuditRepo, 'write'>; envValue: string }) {
  return {
    async view(): Promise<SettingsBotView> {
      const stored = await deps.settings.get<unknown>(EXTRA_QUESTIONS_KEY);
      const fromSettings = typeof stored === 'string';
      return {
        generatedAt: new Date().toISOString(),
        extraQuestions: { ...modeOf(fromSettings ? stored : deps.envValue), source: fromSettings ? 'settings' : 'env', envValue: deps.envValue },
      };
    },

    async setExtraQuestions(body: unknown, actor: string): Promise<Outcome> {
      if (typeof body !== 'object' || body === null || Array.isArray(body)) return bad('Нужно выбрать режим.');
      const { mode, ids } = body as Record<string, unknown>;
      if (mode !== 'off' && mode !== 'all' && mode !== 'list') return bad('Нужно выбрать режим: выключены, всем или только этим людям.');
      if (ids !== undefined && typeof ids !== 'string') return bad('Список должен быть текстом.');
      let value: string = mode;
      let count = 0;
      if (mode === 'list') {
        const parts = (ids ?? '').split(',').map((x) => x.trim().toLowerCase());
        if (parts.length === 0 || parts.some((x) => !ID.test(x))) {
          return bad('Укажите номера через запятую, например 27637540 или max:27637540. Свой номер показывает команда /whoami в боте.');
        }
        const unique = [...new Set(parts)];
        count = unique.length;
        value = unique.join(',');
      }
      await deps.settings.set(EXTRA_QUESTIONS_KEY, value, actor);
      // В журнале режим и сколько человек в списке; сами номера — это идентификаторы людей, их туда не кладём.
      await deps.audit.write(actor, 'settings.extra_questions', 'settings', null, mode === 'list' ? { mode, count } : { mode });
      return { ok: true };
    },
  };
}

export type BotSettings = ReturnType<typeof createBotSettings>;

import type { AuditRepo } from '../db/repos/audit.repo.js';
import type { SettingsRepo } from '../db/repos/settings.repo.js';
import { EXTRA_QUESTIONS_KEY } from '../core/rollout.js';
import { EXTRA_INVITE_TEXTS, type ExtraInvites } from '../core/extraInvites.js';
import type { ActionError, CoordinatorContactsView, SettingsBotView } from './contracts.js';
import type { CoordinatorContacts } from '../core/coordinatorContacts.js';

/**
 * Настройка бота из интерфейса: кому задавать новые вопросы анкеты (время и адрес).
 *
 * Раньше это было только значением `EXTRA_QUESTIONS` в `.env` на сервере, и руководителю приходилось просить
 * об изменении того, кто с сервером работает. Теперь значение лежит в `app_settings`, бот читает его раз в
 * несколько секунд, а `.env` остаётся значением по умолчанию — пока здесь ничего не сохранили.
 */
type Outcome = { ok: true } | { ok: false; error: ActionError['error']; message: string };
const bad = (message: string): Outcome => ({ ok: false, error: 'bad_request', message });
const refuse = (message: string): { ok: false; error: 'bad_request'; message: string } => ({ ok: false, error: 'bad_request', message });

/** Формат записи id такой же, как разбирает `extraQuestionsEnabled`: «111» или «max:111». */
const ID = /^(?:(?:telegram|max):)?\d{3,20}$/;

function modeOf(value: string): { mode: 'off' | 'all' | 'list'; ids: string } {
  const v = value.trim().toLowerCase();
  if (v === '' || v === 'off') return { mode: 'off', ids: '' };
  if (v === 'all') return { mode: 'all', ids: '' };
  return { mode: 'list', ids: v.split(',').map((x) => x.trim()).filter(Boolean).join(',') };
}

type SendOutcome = { ok: true; sent: number; failed: number; blocked: number } | { ok: false; error: ActionError['error']; message: string };

export function createBotSettings(deps: {
  settings: Pick<SettingsRepo, 'get' | 'set'>;
  audit: Pick<AuditRepo, 'write'>;
  envValue: string;
  /** Досылка приглашений. Нет её (платформы в сервисе не подключены) — кнопка в интерфейсе недоступна. */
  invites?: ExtraInvites;
  /** Рассылка ведущим контакта координатора; нет — тоже нечем слать. */
  coordinatorContacts?: CoordinatorContacts;
}) {
  async function contactsView(): Promise<CoordinatorContactsView> {
    if (!deps.coordinatorContacts) return { available: false, total: 0, noChat: [], noCoordinator: [], noPhone: [] };
    return { available: true, ...(await deps.coordinatorContacts.preview()) };
  }

  async function invitesView(): Promise<SettingsBotView['invites']> {
    const texts = { textJoin: EXTRA_INVITE_TEXTS.join, textLead: EXTRA_INVITE_TEXTS.lead, textLeader: EXTRA_INVITE_TEXTS.leader };
    if (!deps.invites) return { available: false, join: 0, lead: 0, leaders: 0, total: 0, off: false, ...texts };
    const p = await deps.invites.preview();
    return { available: true, join: p.join, lead: p.lead, leaders: p.leaders, total: p.total, off: p.off, ...texts };
  }

  return {
    async view(): Promise<SettingsBotView> {
      const stored = await deps.settings.get<unknown>(EXTRA_QUESTIONS_KEY);
      const fromSettings = typeof stored === 'string';
      return {
        generatedAt: new Date().toISOString(),
        extraQuestions: { ...modeOf(fromSettings ? stored : deps.envValue), source: fromSettings ? 'settings' : 'env', envValue: deps.envValue },
        invites: await invitesView(),
        coordinatorContacts: await contactsView(),
      };
    },

    /** Разослать ведущим контакт координатора; как и приглашения — только подтверждённому числу получателей. */
    async sendCoordinatorContacts(body: unknown, actor: string): Promise<SendOutcome> {
      if (!deps.coordinatorContacts) return { ok: false, error: 'unavailable', message: 'В сервисе не подключён ни один бот: отправить нечем.' };
      const expected = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['expectedTotal'] : undefined;
      if (typeof expected !== 'number' || !Number.isInteger(expected) || expected < 0) return refuse('Нужно подтвердить число получателей.');
      const result = await deps.coordinatorContacts.send(expected);
      if (result.status === 'changed') {
        return { ok: false, error: 'conflict', message: `Список изменился: теперь ведущих ${result.actual}, а вы подтверждали ${expected}. Обновите и подтвердите ещё раз.` };
      }
      if (result.status === 'none') return refuse('Некому отправлять: ни у одной группы нет и координатора с телефоном, и ведущего в боте.');
      // В журнале числа; кому ушло — это люди, их в журнал не кладём.
      await deps.audit.write(actor, 'settings.coordinator_contacts', 'settings', null, { sent: result.sent, failed: result.failed, blocked: result.blocked });
      return { ok: true, sent: result.sent, failed: result.failed, blocked: result.blocked };
    },

    /**
     * Дослать двум новым вопросам тех, кто уже зарегистрирован. `expectedTotal` — число, которое человек видел на
     * экране: рассылка уходит живым людям, поэтому подтверждается конкретное число, а не «как получится».
     */
    async sendExtraInvites(body: unknown, actor: string): Promise<SendOutcome> {
      if (!deps.invites) return { ok: false, error: 'unavailable', message: 'В сервисе не подключён ни один бот: отправить приглашения нечем.' };
      const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
      const expected = fields['expectedTotal'];
      if (typeof expected !== 'number' || !Number.isInteger(expected) || expected < 0) return refuse('Нужно подтвердить число получателей.');
      // Кому в этот раз: по умолчанию — ищущим группу и будущим ведущим (как раньше), «leaders» — тем, кто уже ведёт.
      const audience = fields['audience'] ?? 'seekers';
      if (audience !== 'seekers' && audience !== 'leaders') return refuse('Выберите, кому отправить: ищущим группу или ведущим.');
      const before = await deps.invites.preview(audience);
      if (before.off) return refuse('Новые вопросы выключены: выберите «Всем» или «Только этим людям» и сохраните.');
      if (before.total === 0) return refuse('Некому отправлять: все, кому можно написать, уже получили приглашение или ответили.');
      const result = await deps.invites.send(expected, audience);
      if (result.status === 'changed') {
        return { ok: false, error: 'conflict', message: `Список изменился: теперь получателей ${result.actual}, а вы подтверждали ${expected}. Обновите и подтвердите ещё раз.` };
      }
      if (result.status === 'none') return refuse('Некому отправлять: приглашения уже разосланы или все ответили.');
      // В журнале числа; кому ушло — это люди, их в журнал не кладём.
      await deps.audit.write(actor, 'settings.extra_invites', 'settings', null, {
        audience, join: before.join, lead: before.lead, leaders: before.leaders, sent: result.sent, failed: result.failed, blocked: result.blocked,
      });
      return { ok: true, sent: result.sent, failed: result.failed, blocked: result.blocked };
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

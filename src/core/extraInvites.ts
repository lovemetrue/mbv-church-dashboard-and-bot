import { randomUUID } from 'node:crypto';
import type { Deps } from '../deps.js';
import { T, followUpKeyboard } from './texts.js';
import { extraQuestionsEnabled } from './rollout.js';

/**
 * Досылка двух новых вопросов анкеты (удобное время и адрес) тем, кто уже зарегистрирован.
 *
 * Общая для бота («📝 Дослать вопросы» у служителя) и для кнопки в «Настройках» нового интерфейса: кому и что
 * писать решается в одном месте, иначе две кнопки рано или поздно разошлись бы в правилах.
 */
export interface ExtraInvitePreview {
  /** Хотят в группу (получат текст для ищущих группу). */
  join: number;
  /** Готовы открыть группу или дать дом (получат текст для будущих ведущих). */
  lead: number;
  total: number;
  /** Действующее значение настройки «новые вопросы анкеты»: all · off · список id. */
  setting: string;
  /** Вопросы выключены: слать некому по определению. */
  off: boolean;
}

export type ExtraInviteResult =
  | { status: 'sent'; sent: number; failed: number; blocked: number }
  | { status: 'none' }
  /** Список изменился между показом и подтверждением: человек подтверждал другое число. */
  | { status: 'changed'; actual: number };

export const EXTRA_INVITE_TEXTS = { join: T.followUpInviteJoin, lead: T.followUpInviteLead } as const;

type InviteDeps = Pick<Deps, 'users' | 'platforms' | 'extraQuestionsNow' | 'deliveries' | 'sender'>;

export function createExtraInvites(deps: InviteDeps) {
  /**
   * Зарегистрированные с заявкой на посещение или открытие группы, кто ещё не отвечал и не получал приглашение,
   * — и только те, кому вопросы включены настройкой. Так сначала приглашение уходит одному-двум людям на проверку.
   */
  async function recipients(): Promise<{ join: number[]; lead: number[]; setting: string }> {
    const found = await deps.users.followUpCandidates([...deps.platforms.keys()]);
    const setting = await deps.extraQuestionsNow();
    const allowed = found.filter((c) => extraQuestionsEnabled(setting, c.platform, c.platform_user_id));
    return {
      join: allowed.filter((c) => c.mdg_status === 'join').map((c) => c.id),
      lead: allowed.filter((c) => c.mdg_status !== 'join').map((c) => c.id),
      setting,
    };
  }

  return {
    async preview(): Promise<ExtraInvitePreview> {
      const r = await recipients();
      return {
        join: r.join.length,
        lead: r.lead.length,
        total: r.join.length + r.lead.length,
        setting: r.setting,
        off: ['', 'off'].includes(r.setting.trim().toLowerCase()),
      };
    },

    /**
     * Рассылает приглашения. `expectedTotal` — число, которое человек видел и подтвердил: если за это время
     * список изменился (кто-то ответил сам или настройку поменяли), ничего не уходит. Список считаем заново в любом
     * случае — между вопросом и подтверждением люди отвечают сами.
     */
    async send(expectedTotal?: number): Promise<ExtraInviteResult> {
      const { join, lead } = await recipients();
      const total = join.length + lead.length;
      if (expectedTotal !== undefined && expectedTotal !== total) return { status: 'changed', actual: total };
      if (total === 0) return { status: 'none' };

      const base = `extra:${randomUUID()}`;
      const totals = { sent: 0, failed: 0, blocked: 0 };
      for (const [suffix, text, ids] of [
        ['join', EXTRA_INVITE_TEXTS.join, join],
        ['lead', EXTRA_INVITE_TEXTS.lead, lead],
      ] as const) {
        if (ids.length === 0) continue;
        const key = `${base}:${suffix}`;
        await deps.deliveries.openFor(key, text, followUpKeyboard(), ids);
        const result = await deps.sender.run(key);
        totals.sent += result.sent;
        totals.failed += result.failed;
        totals.blocked += result.blocked;
      }
      return { status: 'sent', ...totals };
    },
  };
}

export type ExtraInvites = ReturnType<typeof createExtraInvites>;

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
  /** Уже ведут группу (ответили боту «веду»): отдельная досылка про время и место их группы. */
  leaders: number;
  /** Сколько получит приглашение выбранная аудитория: ищущие — join + lead, ведущие — leaders. */
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

export const EXTRA_INVITE_TEXTS = { join: T.followUpInviteJoin, lead: T.followUpInviteLead, leader: T.followUpInviteLeader } as const;

/** Кому шлём в этот раз: ищущим группу и будущим ведущим (по умолчанию, как было) или тем, кто уже ведёт группу. */
export type InviteAudience = 'seekers' | 'leaders';

type InviteDeps = Pick<Deps, 'users' | 'platforms' | 'extraQuestionsNow' | 'deliveries' | 'sender'>;

export function createExtraInvites(deps: InviteDeps) {
  /**
   * Зарегистрированные с заявкой на посещение или открытие группы, кто ещё не отвечал и не получал приглашение,
   * — и только те, кому вопросы включены настройкой. Так сначала приглашение уходит одному-двум людям на проверку.
   */
  async function recipients(): Promise<{ join: number[]; lead: number[]; leaders: number[]; setting: string }> {
    const platforms = [...deps.platforms.keys()];
    const [seekers, leaders] = await Promise.all([
      deps.users.followUpCandidates(platforms, 'seekers'),
      deps.users.followUpCandidates(platforms, 'leaders'),
    ]);
    const setting = await deps.extraQuestionsNow();
    const allowed = (list: typeof seekers) => list.filter((c) => extraQuestionsEnabled(setting, c.platform, c.platform_user_id));
    const s = allowed(seekers);
    return {
      join: s.filter((c) => c.mdg_status === 'join').map((c) => c.id),
      lead: s.filter((c) => c.mdg_status !== 'join').map((c) => c.id),
      leaders: allowed(leaders).map((c) => c.id),
      setting,
    };
  }

  const totalOf = (r: { join: number[]; lead: number[]; leaders: number[] }, audience: InviteAudience): number =>
    audience === 'leaders' ? r.leaders.length : r.join.length + r.lead.length;

  return {
    async preview(audience: InviteAudience = 'seekers'): Promise<ExtraInvitePreview> {
      const r = await recipients();
      return {
        join: r.join.length,
        lead: r.lead.length,
        leaders: r.leaders.length,
        total: totalOf(r, audience),
        setting: r.setting,
        off: ['', 'off'].includes(r.setting.trim().toLowerCase()),
      };
    },

    /**
     * Рассылает приглашения. `expectedTotal` — число, которое человек видел и подтвердил: если за это время
     * список изменился (кто-то ответил сам или настройку поменяли), ничего не уходит. Список считаем заново в любом
     * случае — между вопросом и подтверждением люди отвечают сами.
     */
    async send(expectedTotal?: number, audience: InviteAudience = 'seekers'): Promise<ExtraInviteResult> {
      const r = await recipients();
      const total = totalOf(r, audience);
      if (expectedTotal !== undefined && expectedTotal !== total) return { status: 'changed', actual: total };
      if (total === 0) return { status: 'none' };

      const base = `extra:${randomUUID()}`;
      const totals = { sent: 0, failed: 0, blocked: 0 };
      const batches = audience === 'leaders'
        ? ([['leader', EXTRA_INVITE_TEXTS.leader, r.leaders]] as const)
        : ([['join', EXTRA_INVITE_TEXTS.join, r.join], ['lead', EXTRA_INVITE_TEXTS.lead, r.lead]] as const);
      for (const [suffix, text, ids] of batches) {
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

import { randomUUID } from 'node:crypto';
import type { Deps } from '../deps.js';
import { sentKey, type CoordinatorContactsRepo, type CoordinatorContactTarget } from '../db/repos/coordinatorContacts.repo.js';

/**
 * «Сообщение ведущим» из «Настройки → Бот»: свой текст всем ведущим действующих групп (статус «Функционирует») — например,
 * ссылка на видеоурок перед встречей. Кому писать, ищем так же, как для контакта координатора (прямая ссылка на
 * регистрацию или тот же телефон); рассыльщик и учёт доставки — те же (`deliveries`).
 */

/** Только действующие: на паузе и потенциальным материалы к встрече ни к чему. */
export const LEADER_MESSAGE_STATUSES = ['Функционирует'] as const;
/** Лимит сообщения в MAX — 4000 знаков; в Telegram 4096. Берём меньший, чтобы не делить текст. */
export const LEADER_MESSAGE_MAX = 4000;

export interface LeaderMessagePreview {
  /** Скольким ведущим (людям, а не группам) можно написать: ведёт две группы — одно сообщение. */
  total: number;
  /** Коды действующих групп, ведущего которых нет в боте: им не уйдёт. */
  noChat: string[];
}

export type LeaderMessageResult =
  | { status: 'sent'; sent: number; failed: number; blocked: number; alreadySent: number }
  | { status: 'none'; alreadySent: number }
  | { status: 'changed'; actual: number };

type MessageDeps = Pick<Deps, 'platforms' | 'deliveries' | 'sender'> & { contacts: Pick<CoordinatorContactsRepo, 'targets' | 'alreadySent'> };

export function createLeaderMessage(deps: MessageDeps) {
  async function split() {
    const all = await deps.contacts.targets([...deps.platforms.keys()], LEADER_MESSAGE_STATUSES);
    const users = [...new Set(all.map((t) => t.leaderUserId).filter((x): x is number => x !== null))];
    const noChat = all.filter((t: CoordinatorContactTarget) => t.leaderUserId === null).map((t) => t.groupCode);
    return { users, noChat };
  }

  return {
    async preview(): Promise<LeaderMessagePreview> {
      const s = await split();
      return { total: s.users.length, noChat: s.noChat };
    },

    /**
     * Рассылает `text`. `expectedTotal` — число ведущих, которое человек видел и подтвердил: изменилось — ничего не уходит.
     * Кому этот же текст уже доставлен, второй раз не уходит: случайное двойное нажатие или повтор после обрыва связи
     * не засыплет ведущих одинаковыми сообщениями, а повтор дошлёт только тем, кому в прошлый раз не дошло.
     */
    async send(text: string, expectedTotal: number): Promise<LeaderMessageResult> {
      const s = await split();
      if (s.users.length !== expectedTotal) return { status: 'changed', actual: s.users.length };
      const sent = await deps.contacts.alreadySent('leaders');
      const todo = s.users.filter((u) => !sent.has(sentKey(u, text)));
      const alreadySent = s.users.length - todo.length;
      if (todo.length === 0) return { status: 'none', alreadySent };
      const key = `leaders:${randomUUID()}`;
      await deps.deliveries.openFor(key, text, [], todo, { markInvited: false });
      const r = await deps.sender.run(key);
      return { status: 'sent', sent: r.sent, failed: r.failed, blocked: r.blocked, alreadySent };
    },
  };
}

export type LeaderMessage = ReturnType<typeof createLeaderMessage>;

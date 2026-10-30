import { randomUUID } from 'node:crypto';
import type { Deps } from '../deps.js';
import { sentKey, type CoordinatorContactsRepo, type CoordinatorContactTarget } from '../db/repos/coordinatorContacts.repo.js';
import { formatPhone } from './phone.js';

/**
 * Рассылка ведущим «кто ваш координатор и как с ним связаться» — по кнопке в «Настройки → Бот». Без неё ведущему,
 * к которому направляют людей, вообще не с кем связаться. Каждому — своё сообщение (своя группа и свой координатор),
 * отправка — тем же рассыльщиком с учётом доставки (`deliveries`), что и досылка новых вопросов.
 */

/** Имя ведущего для обращения: в ФИО первым идёт фамилия — «Иванова Марина» → «Марина». */
const firstName = (fio: string): string => {
  const parts = fio.trim().split(/\s+/).filter(Boolean);
  return parts.length >= 2 ? parts[1]! : (parts[0] ?? '');
};

/** Текст ведущему. Без разметки: рассыльщик шлёт обычным текстом. */
export function coordinatorContactText(t: Pick<CoordinatorContactTarget, 'leader' | 'groupCode' | 'coordinator' | 'coordinatorPhone'>): string {
  const name = firstName(t.leader);
  return [
    `${name ? `${name}, здравствуйте!` : 'Здравствуйте!'} Это бот МБВ.`,
    '',
    `Ваш координатор по группе ${t.groupCode} — ${t.coordinator ?? ''}, телефон ${formatPhone(t.coordinatorPhone)}.`,
    '',
    'По вопросам о группе и о людях, которых к Вам направляют, звоните координатору.',
  ].join('\n');
}

export interface CoordinatorContactsPreview {
  /** Скольким ведущим уйдёт. */
  total: number;
  /** Скольким это же сообщение уже доставлено: повторно не уйдёт. */
  alreadySent: number;
  /** Коды групп, где сообщение не уйдёт, и почему: ведущего нет в боте, координатор не закреплён, у координатора нет телефона. */
  noChat: string[];
  noCoordinator: string[];
  noPhone: string[];
}

export type CoordinatorContactsResult =
  | { status: 'sent'; sent: number; failed: number; blocked: number }
  | { status: 'none' }
  | { status: 'changed'; actual: number };

type ContactDeps = Pick<Deps, 'platforms' | 'deliveries' | 'sender'> & { contacts: Pick<CoordinatorContactsRepo, 'targets' | 'alreadySent'> };

export function createCoordinatorContacts(deps: ContactDeps) {
  async function split() {
    const [all, sent] = await Promise.all([deps.contacts.targets([...deps.platforms.keys()]), deps.contacts.alreadySent()]);
    const noCoordinator = all.filter((t) => t.coordinator === null);
    const noPhone = all.filter((t) => t.coordinator !== null && !t.coordinatorPhone);
    const reachable = all.filter((t) => t.coordinator !== null && t.coordinatorPhone);
    const inBot = reachable.filter((t) => t.leaderUserId !== null);
    const done = (t: CoordinatorContactTarget) => sent.has(sentKey(t.leaderUserId!, coordinatorContactText(t)));
    return {
      ready: inBot.filter((t) => !done(t)),
      alreadySent: inBot.filter(done),
      noChat: reachable.filter((t) => t.leaderUserId === null),
      noCoordinator,
      noPhone,
    };
  }
  const codes = (list: CoordinatorContactTarget[]) => list.map((t) => t.groupCode);

  return {
    async preview(): Promise<CoordinatorContactsPreview> {
      const s = await split();
      return {
        total: s.ready.length, alreadySent: s.alreadySent.length,
        noChat: codes(s.noChat), noCoordinator: codes(s.noCoordinator), noPhone: codes(s.noPhone),
      };
    },

    /**
     * Рассылает. `expectedTotal` — число, которое человек видел и подтвердил: изменилось (закрепили координатора, ведущий
     * написал боту) — ничего не уходит, пусть посмотрит ещё раз. Кому это же сообщение уже доставлено, второй раз не уходит:
     * повтор только тем, у кого сменился координатор или его телефон, и тем, кому в прошлый раз не дошло.
     */
    async send(expectedTotal: number): Promise<CoordinatorContactsResult> {
      const s = await split();
      if (s.ready.length !== expectedTotal) return { status: 'changed', actual: s.ready.length };
      if (s.ready.length === 0) return { status: 'none' };
      const base = `coordinator:${randomUUID()}`;
      const totals = { sent: 0, failed: 0, blocked: 0 };
      for (const t of s.ready) {
        const key = `${base}:${t.groupId}`;
        await deps.deliveries.openFor(key, coordinatorContactText(t), [], [t.leaderUserId!], { markInvited: false });
        const r = await deps.sender.run(key);
        totals.sent += r.sent;
        totals.failed += r.failed;
        totals.blocked += r.blocked;
      }
      return { status: 'sent', ...totals };
    },
  };
}

export type CoordinatorContacts = ReturnType<typeof createCoordinatorContacts>;

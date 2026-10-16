import type { ActivityRow } from '../../db/repos/audit.repo.js';
import type { OtherItem, RequestItem, TeamActivity, TeamView, TeamWorkload } from '../contracts.js';

/** Заявка «застряла», если ждёт дольше недели: в этот срок координатор должен был хотя бы позвонить. */
const STUCK_DAYS = 7;
const STUCK_LIMIT = 20;

const AGING: { label: string; test: (days: number) => boolean }[] = [
  { label: '0–2 дня', test: (d) => d <= 2 },
  { label: '3–7 дней', test: (d) => d >= 3 && d <= 7 },
  { label: '8–14 дней', test: (d) => d >= 8 && d <= 14 },
  { label: '15 дней и больше', test: (d) => d >= 15 },
];

const isOpen = (r: RequestItem): boolean => r.bucket !== 'done' && r.bucket !== 'cancelled';

/**
 * Сводка для руководителя координаторов: сколько заявок ждёт, у кого, как давно и кто что делал за неделю.
 * Считается из уже готового списка заявок и журнала, ничего не читает из базы сама — поэтому проверяется
 * без базы. Персональных данных заявителей здесь только ФИО в списке «без движения» (чтобы найти заявку).
 */
export function buildTeam(
  requests: readonly RequestItem[], activityRows: readonly ActivityRow[], generatedAt: string, others: readonly OtherItem[] = [],
): TeamView {
  const open = requests.filter(isOpen);

  const aging = AGING.map((a) => ({ label: a.label, count: open.filter((r) => r.waitingDays !== null && a.test(r.waitingDays)).length }));
  aging.push({ label: 'Дата неизвестна', count: open.filter((r) => r.waitingDays === null).length });

  const byName = new Map<string | null, RequestItem[]>();
  for (const r of open) {
    const key = r.responsible?.trim() || null;
    byName.set(key, [...(byName.get(key) ?? []), r]);
  }
  const workload: TeamWorkload[] = [...byName.entries()].map(([name, items]) => {
    const days = items.map((r) => r.waitingDays).filter((d): d is number => d !== null);
    return {
      name,
      open: items.length,
      callback: items.filter((r) => r.bucket === 'callback').length,
      over7: items.filter((r) => (r.waitingDays ?? 0) > STUCK_DAYS).length,
      oldestDays: days.length ? Math.max(...days) : null,
    };
  });
  // Больше заявок — выше; при равенстве «никто не взял» первым, дальше по алфавиту.
  workload.sort((a, b) => b.open - a.open || (a.name === null ? -1 : b.name === null ? 1 : a.name.localeCompare(b.name, 'ru')));

  const stuck = open
    .filter((r): r is RequestItem & { waitingDays: number } => r.waitingDays !== null && r.waitingDays > STUCK_DAYS)
    .sort((a, b) => b.waitingDays - a.waitingDays || a.id - b.id)
    .slice(0, STUCK_LIMIT)
    .map((r) => ({ id: r.id, fio: r.fio, waitingDays: r.waitingDays, responsible: r.responsible, bucket: r.bucket }));

  const people = new Map<string, TeamActivity>();
  for (const row of activityRows) {
    const a = people.get(row.actor) ?? { actor: row.actor, calls: 0, approved: 0, rejected: 0, edits: 0, assigned: 0 };
    if (row.action === 'request.call') a.calls += row.n;
    else if (row.action === 'request.approve') a.approved += row.n;
    else if (row.action === 'request.reject') a.rejected += row.n;
    else if (row.action === 'request.edit') a.edits += row.n;
    else if (row.action === 'request.assign') a.assigned += row.n;
    people.set(row.actor, a);
  }
  const activity = [...people.values()].sort((a, b) => a.actor.localeCompare(b.actor, 'ru'));

  return {
    generatedAt,
    totals: {
      open: open.length,
      all: requests.length,
      done: requests.filter((r) => r.bucket === 'done').length,
      unassigned: open.filter((r) => !r.responsible?.trim()).length,
      callback: open.filter((r) => r.bucket === 'callback').length,
      over7: open.filter((r) => (r.waitingDays ?? 0) > STUCK_DAYS).length,
      approvedWeek: activity.reduce((sum, a) => sum + a.approved, 0),
      otherOpen: others.filter((o) => o.state === 'open').length,
    },
    aging,
    workload,
    stuck,
    activity,
  };
}

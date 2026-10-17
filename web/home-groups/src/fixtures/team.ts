import type { RequestItem, TeamActivity, TeamView, TeamWorkload } from '@contracts';
import { buildRequests } from './build';
import { buildOthers } from './others';

/** Заявка ждёт «дольше недели» — как на сервере (`api/team.ts`): с восьмого дня. */
const STUCK_DAYS = 7;

const AGING: { label: string; test: (days: number) => boolean }[] = [
  { label: '0–2 дня', test: (d) => d <= 2 },
  { label: '3–7 дней', test: (d) => d >= 3 && d <= 7 },
  { label: '8–14 дней', test: (d) => d >= 8 && d <= 14 },
  { label: '15 дней и больше', test: (d) => d >= 15 },
];

const isOpen = (r: RequestItem): boolean => r.bucket !== 'done' && r.bucket !== 'cancelled';

/**
 * Сводка «Команды» в демо. Считается из тех же демо-заявок, что и вкладка «Заявки», поэтому числа
 * в плитках и таблице нагрузки сходятся со списком. Действия за неделю — выдуманные: журнала в демо нет.
 */
export function buildTeam(): TeamView {
  const { items, generatedAt } = buildRequests();
  const open = items.filter(isOpen);

  const aging = AGING.map((a) => ({ label: a.label, count: open.filter((r) => r.waitingDays !== null && a.test(r.waitingDays)).length }));
  aging.push({ label: 'Дата неизвестна', count: open.filter((r) => r.waitingDays === null).length });

  const byName = new Map<string | null, RequestItem[]>();
  for (const r of open) {
    const key = r.responsible?.trim() || null;
    byName.set(key, [...(byName.get(key) ?? []), r]);
  }
  const workload: TeamWorkload[] = [...byName.entries()].map(([name, list]) => {
    const days = list.map((r) => r.waitingDays).filter((d): d is number => d !== null);
    return {
      name,
      open: list.length,
      callback: list.filter((r) => r.bucket === 'callback').length,
      over7: list.filter((r) => (r.waitingDays ?? 0) > STUCK_DAYS).length,
      oldestDays: days.length ? Math.max(...days) : null,
    };
  });
  workload.sort((a, b) => b.open - a.open || (a.name === null ? -1 : b.name === null ? 1 : a.name.localeCompare(b.name, 'ru')));

  const stuck = open
    .filter((r): r is RequestItem & { waitingDays: number } => r.waitingDays !== null && r.waitingDays > STUCK_DAYS)
    .sort((a, b) => b.waitingDays - a.waitingDays || a.id - b.id)
    .slice(0, 20)
    .map((r) => ({ id: r.id, fio: r.fio, waitingDays: r.waitingDays, responsible: r.responsible, bucket: r.bucket }));

  const activity: TeamActivity[] = [{ actor: 'mbv_admin', calls: 14, approved: 6, rejected: 1, edits: 9, assigned: 11 }];

  return {
    generatedAt,
    totals: {
      open: open.length,
      unassigned: open.filter((r) => !r.responsible?.trim()).length,
      callback: open.filter((r) => r.bucket === 'callback').length,
      over7: open.filter((r) => (r.waitingDays ?? 0) > STUCK_DAYS).length,
      approvedWeek: activity.reduce((sum, a) => sum + a.approved, 0),
      otherOpen: buildOthers().filter((o) => o.state === 'open').length,
    },
    aging,
    workload,
    stuck,
    activity,
  };
}

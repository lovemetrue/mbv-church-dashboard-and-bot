import { groupCode } from '../../core/groups.js';
import type { DashboardGroup } from '../../db/repos/groups.repo.js';
import type { DashboardRequest } from '../../db/repos/requests.repo.js';
import type { OtherReconcile, ReconcileCandidate } from '../contracts.js';
import { planReconcile, type LeaderGroup, type ReconcilePlan } from './match.js';

/**
 * Разбор «другого обращения» по справочникам: что найдено и что с этим делать.
 *
 * «Уже состою в группе» ищет группу по имени ведущего, которое человек назвал в боте; «уже веду группу» — по самому
 * человеку (его имя и телефон против ведущих групп). Решение записывает человек (или «разобрать всё готовое»):
 * здесь только расчёт, в базу этот модуль не пишет.
 */
export const RECONCILE_TYPES = { already_member: 'member', already_leader: 'leader' } as const;

export function reconcileKindOf(type: string): 'member' | 'leader' | null {
  return Object.hasOwn(RECONCILE_TYPES, type) ? RECONCILE_TYPES[type as keyof typeof RECONCILE_TYPES] : null;
}

const leadersOf = (groups: readonly DashboardGroup[]): LeaderGroup[] =>
  groups.map((g) => ({
    id: g.id,
    leader: g.leader,
    coLeader: g.co_leader,
    // Телефоны ведущего и второго ведущего: человек мог назвать любого из них.
    phones: [g.phone, ...g.phones, g.co_leader_phone].filter((p): p is string => typeof p === 'string' && p.trim() !== ''),
  }));

function planOf(r: DashboardRequest, kind: 'member' | 'leader', groups: readonly DashboardGroup[]): ReconcilePlan {
  const subject = kind === 'member'
    // Про группу человек сообщил только имя ведущего: телефона ведущего у нас нет.
    ? { name: r.leader_name, phones: [] as string[] }
    : { name: r.fio, phones: [...r.phones, ...(r.phone ? [r.phone] : [])] };
  return planReconcile(subject, leadersOf(groups));
}

/**
 * Единственная группа, которую можно подтвердить без выбора: ровно одно точное совпадение.
 * null — выбирает человек (две группы у одного ведущего, только вероятное совпадение, ничего не найдено).
 */
export function readyGroupOf(r: DashboardRequest, groups: readonly DashboardGroup[]): number | null {
  const kind = reconcileKindOf(r.type);
  if (!kind || r.user_id === null) return null;
  const plan = planOf(r, kind, groups);
  return plan.status === 'ready' ? (plan.candidates.find((c) => c.tier === 'exact')?.groupId ?? null) : null;
}

export function reconcileOf(r: DashboardRequest, groups: readonly DashboardGroup[]): OtherReconcile | null {
  const base = reconcileBase(r, groups);
  return base && { ...base, leaderName: base.kind === 'member' ? (r.leader_name?.trim() || null) : null };
}

function reconcileBase(r: DashboardRequest, groups: readonly DashboardGroup[]): OtherReconcile | null {
  const kind = reconcileKindOf(r.type);
  if (!kind) return null;
  if (r.user_id === null) {
    return { kind, status: 'nouser', candidates: [], text: 'У обращения нет регистрации в боте или в форме: внесите человека в справочник вручную.' };
  }
  const plan = planOf(r, kind, groups);
  const byId = new Map(groups.map((g) => [g.id, g]));
  const candidates: ReconcileCandidate[] = plan.candidates.flatMap((c) => {
    const g = byId.get(c.groupId);
    return g ? [{ groupId: g.id, code: groupCode(g.id), leader: g.leader, district: g.district, tier: c.tier, by: c.by }] : [];
  });
  const first = candidates[0];
  const act = kind === 'member' ? 'внести человека в состав группы' : 'связать группу с этим ведущим';
  switch (plan.status) {
    case 'ready': {
      const how = first!.by === 'phone' ? 'по телефону' : 'по имени ведущего';
      return { kind, status: 'ready', candidates, text: `Найдена группа ${first!.code}, ведущий ${first!.leader} (${how}). Подтвердите: ${act} и закрыть обращение.` };
    }
    case 'choose': {
      const exact = candidates.filter((c) => c.tier === 'exact');
      const why = exact.length > 1
        ? `У этого ведущего несколько групп (${exact.map((c) => c.code).join(', ')}): выберите, ${kind === 'member' ? 'в какую ходит человек' : 'какую он ведёт'}.`
        : `Похожие ведущие: ${candidates.map((c) => `${c.code} ${c.leader}`).join('; ')}. Проверьте и выберите группу.`;
      return { kind, status: 'choose', candidates, text: why };
    }
    case 'none':
      return { kind, status: 'none', candidates, text: kind === 'member'
        ? `Ведущего «${r.leader_name ?? ''}» нет в справочнике групп. Проверьте написание или выберите группу вручную; если группы нет в справочнике, заведите её в «+ Создать».`
        : 'Группы с таким ведущим нет в справочнике. Выберите группу вручную или заведите её в «+ Создать».' };
    default:
      return { kind, status: 'noleader', candidates, text: kind === 'member'
        ? 'Человек не назвал ведущего: уточните у него или выберите группу вручную.'
        : 'Группа по имени и телефону не нашлась. Выберите её вручную.' };
  }
}

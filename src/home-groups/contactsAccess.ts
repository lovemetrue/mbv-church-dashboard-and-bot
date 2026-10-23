import type { GroupItem, GroupsView, Role, TeamRoleKind } from './contracts.js';

/** Кто смотрит: роль входа и, при личном входе, человек из справочника команды. */
export interface Viewer {
  role: Role;
  person: { name: string; teamKinds: readonly TeamRoleKind[] } | null;
}

/** Лидеры: им видны контакты всех камерных групп. Решает смысл роли из справочника, а не её название. */
const LEADER_KINDS: ReadonlySet<TeamRoleKind> = new Set(['catalyst', 'senior']);

const sameName = (a: string | null, b: string | null): boolean =>
  a !== null && b !== null && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Видит ли вошедший адрес и телефоны камерной группы. Полный вход видит всё. Общий вход без человека (`mbv_admin`)
 * пока видит всё, как и раньше: его отключат, оставив только личные входы. При личном входе — лидеры (катализатор,
 * старший координатор) и координатор, ответственный за эту группу (так он записан в поле «Координатор»).
 */
export function seesChamberContacts(viewer: Viewer, coordinator: string | null): boolean {
  if (viewer.role === 'super' || viewer.person === null) return true;
  if (viewer.person.teamKinds.some((k) => LEADER_KINDS.has(k))) return true;
  return sameName(viewer.person.name, coordinator);
}

/** Группа без адреса и телефонов: камерная, а вошедшему они не положены. Имя ведущего остаётся. */
function withoutContacts(g: GroupItem): GroupItem {
  return {
    ...g,
    phone: null,
    coLeaderPhone: null,
    address: null,
    addressGeo: null,
    coords: null,
    leaderAnswer: g.leaderAnswer ? { ...g.leaderAnswer, address: null } : null,
    contactsHidden: true,
  };
}

/**
 * Список групп для вошедшего. Снимок представлений один на всех (кэшируется), поэтому скрытие — здесь, на выходе,
 * а не при сборке: иначе первый вошедший решал бы, что увидят остальные.
 */
export function groupsFor(view: GroupsView, viewer: Viewer): GroupsView {
  if (!view.items.some((g) => g.chamber)) return view;
  return {
    ...view,
    items: view.items.map((g) => (g.chamber && !seesChamberContacts(viewer, g.coordinator) ? withoutContacts(g) : g)),
  };
}

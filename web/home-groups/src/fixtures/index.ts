import {
  buildSettingsAudit,
  buildSettingsErrors,
  buildSettingsHealth,
  buildSettingsPrompts,
  buildSettingsStaff,
  fixtureStaffDelivery,
  fixtureSuggestLogin,
} from './settings';
import { buildCoordinators, buildGroups, buildPeople, buildRequests, buildToday } from './build';

/** Ответ «сервера» в режиме фикстур. Путь — как в apiGet: «today», «requests»… */
export function fixtureResponse(path: string): unknown {
  switch (path.replace(/^\/+/, '').replace(/\/+$/, '')) {
    case 'me':
      // В демо вход полный, иначе вкладки «Настройки» не видно.
      return { role: 'super' };
    case 'today':
      return buildToday();
    case 'requests':
      return buildRequests();
    case 'groups':
      return buildGroups();
    case 'people':
      return buildPeople();
    case 'coordinators':
      return buildCoordinators();
    case 'settings/health':
      return buildSettingsHealth();
    case 'settings/errors':
      return buildSettingsErrors();
    case 'settings/audit':
      return buildSettingsAudit();
    case 'settings/prompts':
      return buildSettingsPrompts();
    case 'settings/staff':
      return buildSettingsStaff();
    default:
      throw new Error(`В фикстурах нет маршрута: ${path}`);
  }
}

/**
 * Ответ на POST в режиме фикстур. Сервера нет, данные не меняются, поэтому действие «получается»
 * и ничего не меняет; подбор отвечает тремя числами, чтобы итог «Готово: …» было что показать.
 */
export function fixtureActionResponse(path: string, body?: unknown): unknown {
  const clean = path.replace(/^\/+/, '').replace(/\/+$/, '');
  if (clean === 'matching/run') {
    return { ok: true, created: 0, replaced: 0, unchanged: buildRequests().matching.waiting };
  }
  const input = (body ?? {}) as { fullName?: string; email?: string; id?: number };
  switch (clean) {
    case 'settings/staff/suggest':
      return { ok: true, login: fixtureSuggestLogin(input.fullName ?? '') };
    case 'settings/staff/create':
      return { ...fixtureStaffDelivery(input.email ?? ''), login: fixtureSuggestLogin(input.fullName ?? '') };
    case 'settings/staff/invite':
    case 'settings/staff/reset': {
      const person = buildSettingsStaff().items.find((i) => i.id === input.id);
      return fixtureStaffDelivery(person?.email ?? '', input.id);
    }
    default:
      return { ok: true };
  }
}

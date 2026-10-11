import {
  buildSettingsAudit,
  buildSettingsBot,
  buildSettingsErrors,
  buildSettingsHealth,
  buildSettingsPrompts,
  buildSettingsStaff,
  fixtureStaffDelivery,
  fixtureSuggestLogin,
} from './settings';
import { buildFormMeta } from './formMeta';
import { buildCoordinators, buildGroups, buildPeople, buildRequests, buildToday } from './build';
import { buildCampaign } from './campaign';
import { buildTeam } from './team';

/** Ответ «сервера» в режиме фикстур. Путь — как в apiGet: «today», «requests»… */
export function fixtureResponse(path: string): unknown {
  switch (path.replace(/^\/+/, '').replace(/\/+$/, '')) {
    case 'me':
      // В демо вход полный, иначе вкладки «Настройки» не видно.
      return { role: 'super' };
    case 'form-meta':
      return buildFormMeta();
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
    case 'team':
      return buildTeam();
    case 'campaign':
      return buildCampaign();
    case 'settings/bot':
      return buildSettingsBot();
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
  // Пересчёт всех предложений: в демо сервера нет, поэтому «заменено» нулевое, а изменившиеся данные считаем обновлёнными.
  if (clean === 'matching/rerun-all') {
    const open = buildRequests().items.filter((r) => r.proposal && r.bucket !== 'done');
    const changed = open.filter((r) => r.proposal!.dataChanged).length;
    return { ok: true, created: 0, replaced: changed, unchanged: open.length - changed };
  }
  // Рабочее место координатора: правка данных, «в работе у», итог звонка, закрытие и возврат в работу. В демо данные не меняются, действие просто «получается».
  if (/^requests\/\d+\/(edit|assign|call|close|reopen)$/.test(clean)) return { ok: true };
  // Правка и удаление записей справочника и заявок: в демо данные не меняются, действие просто «получается».
  if (/^(groups|coordinators|requests)\/\d+\/(update|delete)$/.test(clean)) return { ok: true };
  // Удаление регистрации и настройка бота: в демо ничего не меняется, действие просто «получается».
  if (/^people\/\d+\/delete$/.test(clean) || clean === 'settings/bot/extra-questions') return { ok: true };
  // Массовое действие: в демо все выбранные «обработаны», ничего не пропущено.
  if (clean === 'requests/bulk') return { ok: true, done: ((body ?? {}) as { ids?: number[] }).ids?.length ?? 0, skipped: 0 };
  const input = (body ?? {}) as { fullName?: string; email?: string; id?: number };
  switch (clean) {
    // Номер новой записи в демо один и тот же: данные не меняются, важно лишь показать подтверждение.
    case 'requests/create':
      return { ok: true, id: 101 };
    case 'groups/create':
      return { ok: true, id: 13 };
    // В фикстурах четыре координатора, поэтому новый в демо — пятый.
    case 'coordinators/create':
      return { ok: true, id: 5 };
    // Номера регистрации в фикстурах людей — 1, 2 и 4, поэтому новый в демо — 5 (id участника берём тем же).
    case 'people/create':
      return { ok: true, id: 5, registrationNo: 5 };
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

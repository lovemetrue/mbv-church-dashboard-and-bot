import {
  buildSettingsAssistant,
  buildSettingsAudit,
  buildSettingsBot,
  buildSettingsErrors,
  buildSettingsHealth,
  buildSettingsPrompts,
  buildSettingsStaff,
  fixtureStaffDelivery,
  fixtureSuggestLogin,
  sendDemoInvites,
} from './settings';
import { buildFormMeta } from './formMeta';
import { buildCoordinators, buildGroups, buildPeople, buildRequests, buildToday } from './build';
import { RAW_REQUESTS } from './raw';
import { setDemoStrange, strangeKey } from './strange';
import { buildCampaign } from './campaign';
import { fixtureChatClear, fixtureChatHistory, fixtureChatReply } from './chat';
import { buildOthers, reconcileDemoOther, reconcileDemoReady } from './others';
import { buildTeam } from './team';

/** Ответ «сервера» в режиме фикстур. Путь — как в apiGet: «today», «requests»… */
export function fixtureResponse(path: string): unknown {
  switch (path.replace(/^\/+/, '').replace(/\/+$/, '')) {
    case 'me':
      // В демо вход полный, иначе вкладки «Настройки» не видно.
      // Кнопка «Помощник» в демо видна: ключ задан, помощник включён, база готова.
      return { role: 'super', assistant: { available: true, enabled: true, chat: true } };
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
    // История чата «Помощник»: в демо уже есть пара реплик (fixtures/chat.ts).
    case 'assistant/chat/history':
      return fixtureChatHistory();
    case 'settings/bot':
      return buildSettingsBot();
    case 'settings/assistant':
      return buildSettingsAssistant();
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
  // Чат «Помощник»: ответ зависит от последнего вопроса (fixtures/chat.ts), сами данные не меняются.
  if (clean === 'assistant/chat') return fixtureChatReply(body);
  if (clean === 'assistant/chat/clear') return fixtureChatClear();
  // Помощник: в демо он «разобрал» все три заявки, которые ждали разбора; данные при этом не меняются.
  if (clean === 'assistant/run') return { ok: true, asked: 3, filled: 2, withQuestions: 2, proposals: 1 };
  // Пересчёт всех предложений: в демо сервера нет, поэтому «заменено» нулевое, а изменившиеся данные считаем обновлёнными.
  if (clean === 'matching/rerun-all') {
    const open = buildRequests().items.filter((r) => r.proposal && r.bucket !== 'done');
    const changed = open.filter((r) => r.proposal!.dataChanged).length;
    return { ok: true, created: 0, replaced: changed, unchanged: open.length - changed };
  }
  // Рабочее место координатора: правка данных, «в работе у», итог звонка, закрытие и возврат в работу. В демо данные не меняются, действие просто «получается».
  if (/^requests\/\d+\/(edit|assign|call|close|reopen)$/.test(clean)) return { ok: true };
  // Метка «Странный человек»: в демо она ставится и снимается, и видна везде, где виден человек (fixtures/strange.ts).
  if (/^requests\/\d+\/strange$/.test(clean)) {
    const id = Number(clean.split('/')[1]);
    const input = (body ?? {}) as { value?: boolean; note?: string | null };
    const request = RAW_REQUESTS.find((r) => r.id === id);
    const other = request ? undefined : buildOthers().find((o) => o.id === id);
    setDemoStrange(request ? strangeKey(request.phone, `r${id}`) : strangeKey(other?.phone, `o${id}`), input.value === true, input.note);
    return { ok: true };
  }
  if (clean === 'people/strange') {
    const input = (body ?? {}) as { key?: string; value?: boolean; note?: string | null };
    const person = buildPeople().items.find((p) => p.key === input.key);
    setDemoStrange(strangeKey(person?.phone, input.key ?? ''), input.value === true, input.note);
    return { ok: true };
  }
  // Разбор «других обращений»: в демо обращение уходит в закрытые (fixtures/others.ts), а повторный разбор отвечает «уже было так».
  if (/^requests\/\d+\/reconcile$/.test(clean)) {
    const id = Number(clean.split('/')[1]);
    return { ok: true, already: !reconcileDemoOther(id) };
  }
  if (clean === 'requests/reconcile-ready') {
    const ids = ((body ?? {}) as { ids?: number[] }).ids ?? [];
    return { ok: true, ...reconcileDemoReady(ids) };
  }
  // Правка и удаление записей справочника и заявок: в демо данные не меняются, действие просто «получается».
  if (/^(groups|coordinators|requests)\/\d+\/(update|delete)$/.test(clean)) return { ok: true };
  // Состав группы: «Добавить человека» отвечает номером строки и ключом (у нового человека это карточка p…), остальное «получается».
  if (/^groups\/\d+\/members\/create$/.test(clean)) {
    const input = (body ?? {}) as { personKey?: string };
    return { ok: true, id: 101, personKey: input.personKey ?? 'p2' };
  }
  if (/^(members|persons)\/\d+\/(update|delete)$/.test(clean)) return { ok: true };
  // Удаление регистрации и настройка бота: в демо ничего не меняется, действие просто «получается».
  if (/^people\/\d+\/delete$/.test(clean) || clean === 'settings/bot/extra-questions') return { ok: true };
  // Рассылка доп. вопросов: в демо она «уходит» всем текущим получателям, после чего их не остаётся.
  if (clean === 'settings/bot/send-extra-questions') return { ok: true, sent: sendDemoInvites(), failed: 0, blocked: 0 };
  // Переключатель помощника: в демо ничего не меняется, действие просто «получается».
  if (clean === 'settings/assistant/enabled') return { ok: true };
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

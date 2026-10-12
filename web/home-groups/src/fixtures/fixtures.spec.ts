import { afterEach, describe, expect, test } from 'vitest';
import { buildCoordinators, buildGroups, buildPeople, buildRequests, buildToday } from './build';
import { buildFormMeta } from './formMeta';
import { fixtureActionResponse, fixtureResponse } from './index';
import { buildOthers, resetDemoReconciled } from './others';
import { DEMO_BAD_KEY, resetDemoInvites, resetDemoLlm } from './settings';

afterEach(() => {
  resetDemoInvites();
  resetDemoLlm();
  resetDemoReconciled();
});

describe('фикстуры', () => {
  test('счётчики сходятся со списком заявок, отказы в список не попадают', () => {
    const r = buildRequests();
    const byBucket = (b: string) => r.items.filter((i) => i.bucket === b).length;
    expect(r.counters.ready).toBe(byBucket('ready'));
    expect(r.counters.human).toBe(byBucket('human'));
    expect(r.counters.done).toBe(byBucket('done'));
    expect(r.items.some((i) => i.bucket === 'cancelled')).toBe(false);
    expect(r.counters.cancelled).toBeGreaterThan(0);
  });

  test('«Распределено X из Y» считается как в контракте: готово, перезвонить и утверждено из всех, кроме отказов', () => {
    const t = buildToday();
    expect(t.assigned).toBe(t.counters.ready + t.counters.callback + t.counters.done);
    expect(t.total).toBe(t.counters.ready + t.counters.callback + t.counters.human + t.counters.done);
  });

  test('поля действий в контракте заполнены: отметки звонка нет, а предложения даёт расчёт', () => {
    const { items } = buildRequests();
    expect(items.every((i) => i.callback === false)).toBe(true);
    const withProposal = items.filter((i) => i.proposal);
    expect(withProposal.length).toBeGreaterThan(0);
    expect(withProposal.every((i) => i.proposal!.source === 'script')).toBe(true);
  });

  test('в этапе A корзины «перезвонить» нет: флага на сервере ещё нет', () => {
    expect(buildToday().counters.callback).toBe(0);
  });

  test('данных достаточно для всех экранов и в них есть редкие случаи', () => {
    const r = buildRequests();
    expect(r.items.length).toBeGreaterThanOrEqual(15);
    expect(buildGroups().items.length).toBeGreaterThanOrEqual(12);
    expect(buildPeople().items.length).toBeGreaterThanOrEqual(20);
    expect(buildCoordinators().items).toHaveLength(4);
    expect(r.items.some((i) => i.proposal?.displaced)).toBe(true);
    expect(r.items.some((i) => i.noPlan?.code === 'place')).toBe(true);
    expect(r.items.some((i) => i.noPlan?.code === 'taken')).toBe(true);
    expect(r.items.some((i) => i.noPlan?.code === 'nogroup')).toBe(true);
    expect(r.items.some((i) => i.bucket === 'human' && i.proposal)).toBe(true);
    expect(r.items.some((i) => i.dataFill.includes(false))).toBe(true);
  });

  test('место в группе не отдаётся двум заявкам сверх свободных', () => {
    const groups = buildGroups().items;
    for (const g of groups) expect(g.plannedRequests.length).toBeLessThanOrEqual(g.free);
  });

  test('у каждой клетки матрицы уровень согласован со спросом и местами', () => {
    for (const row of buildToday().matrix)
      for (const c of row.cells) {
        expect(c.net).toBe(c.supply - c.demand);
        if (c.demand > 0 && c.supply === 0) expect(c.level).toBe('crit');
      }
  });

  test('матрица содержит особую строку «Район не определён» и колонку «Возраст не указан», только со спросом', () => {
    const t = buildToday();
    expect(t.ageColumns.at(-1)).toBe('Возраст не указан');
    const unknownRow = t.matrix.find((r) => r.district === 'Район не определён')!;
    expect(unknownRow.cells.some((c) => c.demand > 0)).toBe(true);
    const unknownAge = t.matrix.flatMap((r) => r.cells).filter((c) => c.age === 'Возраст не указан');
    expect(unknownAge.some((c) => c.demand > 0)).toBe(true);
    for (const c of [...unknownRow.cells, ...unknownAge]) {
      expect(c.supply).toBe(0);
      expect(c.groupIds).toEqual([]);
    }
  });

  test('requestIds и groupIds клетки сходятся с её спросом и местами', () => {
    const t = buildToday();
    const groups = new Map(buildGroups().items.map((g) => [g.id, g]));
    for (const row of t.matrix)
      for (const c of row.cells) {
        expect(c.requestIds).toHaveLength(c.demand);
        expect(c.groupIds.reduce((s, id) => s + groups.get(id)!.free, 0)).toBe(c.supply);
      }
  });

  test('часть групп новые, часть обычные', () => {
    const items = buildGroups().items;
    expect(items.some((g) => g.isNew)).toBe(true);
    expect(items.some((g) => !g.isNew)).toBe(true);
  });

  test('у части людей есть номер регистрации и участник, у остальных нет: видны оба случая карточки', () => {
    const items = buildPeople().items;
    expect(items.some((p) => p.registrationNo !== null && p.userId !== null)).toBe(true);
    expect(items.some((p) => p.registrationNo === null)).toBe(true);
    // Номер без участника не бывает: карточка и QR строятся по id участника.
    expect(items.every((p) => p.registrationNo === null || p.userId !== null)).toBe(true);
    const numbers = items.map((p) => p.registrationNo).filter((n) => n !== null);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  test('справочники формы содержат церкви и ответы про малую группу с кодами ветвления анкеты', () => {
    const meta = buildFormMeta();
    expect(meta.churches.length).toBeGreaterThan(0);
    expect(meta.mdgStatuses.map((s) => s.value)).toEqual(['open', 'home', 'join', 'member', 'leader']);
  });

  test('регистрация в режиме фикстур отвечает id и номером, которых нет у существующих людей', () => {
    const res = fixtureActionResponse('people/create', { fields: { fio: 'Анна', phone: '9110001122' } }) as {
      ok: true;
      id: number;
      registrationNo: number;
    };
    expect(res.ok).toBe(true);
    expect(buildPeople().items.map((p) => p.registrationNo)).not.toContain(res.registrationNo);
    expect(buildPeople().items.map((p) => p.userId)).not.toContain(res.id);
  });

  test('кампания и настройка бота отдаются демо-маршрутами, а удаление регистрации и сохранение настройки «получаются»', () => {
    const campaign = fixtureResponse('campaign') as { days: { total: number; list: unknown[] } };
    expect(campaign.days.list).toHaveLength(campaign.days.total);
    const bot = fixtureResponse('settings/bot') as { extraQuestions: { mode: string; source: string } };
    expect(['off', 'all', 'list']).toContain(bot.extraQuestions.mode);
    expect(['settings', 'env']).toContain(bot.extraQuestions.source);
    expect(fixtureActionResponse('people/1/delete', {})).toEqual({ ok: true });
    expect(fixtureActionResponse('settings/bot/extra-questions', { mode: 'all' })).toEqual({ ok: true });
  });

  test('в демо есть кому дослать вопросы, а отправка «доставляет» всем и обнуляет получателей', () => {
    const before = fixtureResponse('settings/bot') as { invites: { available: boolean; join: number; lead: number; total: number; off: boolean; textJoin: string; textLead: string } };
    expect(before.invites).toMatchObject({ available: true, join: 4, lead: 2, total: 6, off: false });
    expect(before.invites.textJoin).not.toBe('');
    expect(before.invites.textLead).not.toBe('');
    expect(fixtureActionResponse('settings/bot/send-extra-questions', { expectedTotal: 6 })).toEqual({ ok: true, sent: 6, failed: 0, blocked: 0 });
    const after = fixtureResponse('settings/bot') as { invites: { join: number; lead: number; total: number } };
    expect(after.invites).toMatchObject({ join: 0, lead: 0, total: 0 });
  });

  test('в демо помощник подключён и включён, а разбор есть у двух заявок: с определёнными полями и только с вопросами', () => {
    const view = buildRequests();
    expect(view.assistant).toEqual({ available: true, enabled: true, pending: 3 });
    const noted = view.items.filter((i) => i.assistant);
    expect(noted).toHaveLength(2);
    expect(noted.map((i) => i.assistant!.filled.length).sort()).toEqual([0, 2]);
    expect(noted.find((i) => i.assistant!.filled.length === 0)!.assistant!.questions).toHaveLength(3);
    expect(noted.find((i) => i.assistant!.filled.length === 2)!.assistant!.questions).toHaveLength(2);
    expect(view.items.filter((i) => !i.assistant).every((i) => i.assistant === null)).toBe(true);
  });

  test('демо-маршруты помощника: настройка без ключа, запуск разбора и переключатель «получаются»', () => {
    const settings = fixtureResponse('settings/assistant') as Record<string, unknown>;
    expect(settings).toMatchObject({ available: true, enabled: true, model: 'deepseek-chat' });
    // Самого ключа в данных быть не должно: есть лишь признак и последние четыре символа.
    expect(JSON.stringify(settings)).not.toMatch(/sk-|apiKey/);
    expect(settings.llm).toMatchObject({ provider: 'deepseek', model: 'deepseek-chat', keySet: true, keySource: 'settings', keyHint: 'ABCD', keyUnreadable: false });
    expect(fixtureActionResponse('assistant/run', {})).toMatchObject({ ok: true, asked: 3 });
    expect(fixtureActionResponse('settings/assistant/enabled', { enabled: false })).toEqual({ ok: true });
  });
});

describe('фикстуры: разбор «других обращений»', () => {
  const open = () => buildOthers().filter((o) => o.state === 'open');

  test('у каждого обращения есть суть, а все пять состояний разбора и «без разбора» представлены', () => {
    const all = buildOthers();
    expect(all.every((o) => o.gist.trim().length > 0)).toBe(true);
    const statuses = new Set(open().map((o) => o.reconcile?.status ?? null));
    expect(statuses).toEqual(new Set(['ready', 'choose', 'none', 'noleader', 'nouser', null]));
  });

  test('закрытые обращения разбора не несут, ready ведёт ровно к одной точной группе, а nouser и none — ни к одной', () => {
    for (const o of buildOthers()) {
      if (o.state !== 'open') expect(o.reconcile).toBeNull();
      const r = o.reconcile;
      if (!r) continue;
      if (r.status === 'ready') expect(r.candidates.filter((c) => c.tier === 'exact')).toHaveLength(1);
      if (r.status === 'nouser' || r.status === 'none' || r.status === 'noleader') expect(r.candidates).toEqual([]);
    }
  });

  test('группы кандидатов есть в справочнике групп, и код с ведущим сходятся', () => {
    const groups = new Map(buildGroups().items.map((g) => [g.id, g]));
    for (const o of buildOthers())
      for (const c of o.reconcile?.candidates ?? []) {
        const g = groups.get(c.groupId)!;
        expect(g).toBeDefined();
        expect(c.code).toBe(g.code);
        expect(c.leader).toBe(g.leader);
        expect(c.district).toBe(g.district);
      }
  });

  test('одна группа связана с регистрацией ведущего, остальные нет', () => {
    const linked = buildGroups().items.filter((g) => g.leaderKey !== null);
    expect(linked.map((g) => g.leaderKey)).toEqual(['u2']);
  });

  test('POST requests/:id/reconcile: обращение уходит в закрытые, разбор снят, повтор отвечает «уже было так»', () => {
    const before = open().length;
    expect(fixtureActionResponse('requests/206/reconcile', { groupId: 1 })).toEqual({ ok: true, already: false });
    const item = buildOthers().find((o) => o.id === 206)!;
    expect(item.state).toBe('done');
    expect(item.reconcile).toBeNull();
    expect(open()).toHaveLength(before - 1);
    expect(buildOthers().findIndex((o) => o.id === 206)).toBe(before - 1);
    expect(fixtureActionResponse('requests/206/reconcile', { groupId: 1 })).toEqual({ ok: true, already: true });
  });

  test('POST requests/reconcile-ready: разбирает готовые, остальные и чужие номера пропускает', () => {
    const res = fixtureActionResponse('requests/reconcile-ready', { ids: [206, 210, 207, 999] });
    expect(res).toEqual({ ok: true, applied: 2, skipped: 2 });
    expect(open().filter((o) => o.reconcile?.status === 'ready')).toHaveLength(0);
    expect(open().some((o) => o.id === 207)).toBe(true);
    expect(fixtureActionResponse('requests/reconcile-ready', { ids: [206, 210] })).toEqual({ ok: true, applied: 0, skipped: 2 });
  });
});

describe('фикстуры: подключение помощника', () => {
  const llmOf = () => (fixtureResponse('settings/assistant') as { llm: { provider: string; model: string; baseUrl: string | null; keySource: string | null; keyHint: string | null; providers: { id: string; baseUrl: string | null; models: string[]; defaultModel: string | null }[] } }).llm;

  test('провайдеров четыре, как на сервере: у «другого» нет ни адреса, ни моделей', () => {
    const providers = llmOf().providers;
    expect(providers.map((p) => p.id)).toEqual(['deepseek', 'openai', 'openrouter', 'custom']);
    expect(providers.map((p) => p.baseUrl)).toEqual(['https://api.deepseek.com', 'https://api.openai.com/v1', 'https://openrouter.ai/api/v1', null]);
    expect(providers[1]!.models).toEqual(['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini']);
    expect(providers[3]).toMatchObject({ models: [], defaultModel: null });
  });

  test('сохранение подключения меняет демо-состояние, а ключ запоминается только последними четырьмя символами', () => {
    expect(fixtureActionResponse('settings/assistant/llm', { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-секрет-WXYZ' })).toEqual({ ok: true });
    expect(llmOf()).toMatchObject({ provider: 'openai', model: 'gpt-4o', keySource: 'settings', keyHint: 'WXYZ' });
    expect(JSON.stringify(fixtureResponse('settings/assistant'))).not.toContain('секрет');
  });

  test('без поля apiKey прежний ключ остаётся, а null возвращает ключ из файла .env', () => {
    fixtureActionResponse('settings/assistant/llm', { provider: 'deepseek', model: 'deepseek-chat' });
    expect(llmOf()).toMatchObject({ keySource: 'settings', keyHint: 'ABCD' });
    fixtureActionResponse('settings/assistant/llm', { provider: 'deepseek', model: 'deepseek-chat', apiKey: null });
    expect(llmOf().keySource).toBe('env');
  });

  test('проверка подключения успешна и ничего не меняет, а ключ-образец даёт отказ с кодом и пояснением', () => {
    expect(fixtureActionResponse('settings/assistant/llm-test', { provider: 'openai', model: 'gpt-4o' })).toMatchObject({ ok: true, provider: 'openai', model: 'gpt-4o' });
    expect(llmOf().provider).toBe('deepseek');
    expect(fixtureActionResponse('settings/assistant/llm-test', { provider: 'deepseek', model: 'deepseek-chat', apiKey: DEMO_BAD_KEY })).toMatchObject({
      ok: false,
      code: 'auth',
      status: 401,
      detail: 'Authentication Fails',
      message: expect.stringContaining('Провайдер не принял ключ (код 401)'),
    });
  });
});

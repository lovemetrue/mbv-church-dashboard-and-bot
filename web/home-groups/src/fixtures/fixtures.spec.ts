import { describe, expect, test } from 'vitest';
import { buildCoordinators, buildGroups, buildPeople, buildRequests, buildToday } from './build';
import { buildFormMeta } from './formMeta';
import { fixtureActionResponse, fixtureResponse } from './index';

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
    // Самого ключа в данных быть не должно ни под каким именем.
    expect(JSON.stringify(settings)).not.toMatch(/sk-|key/i);
    expect(fixtureActionResponse('assistant/run', {})).toMatchObject({ ok: true, asked: 3 });
    expect(fixtureActionResponse('settings/assistant/enabled', { enabled: false })).toEqual({ ok: true });
  });
});

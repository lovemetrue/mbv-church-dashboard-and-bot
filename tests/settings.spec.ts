import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { AuditRepo } from '../src/db/repos/audit.repo.js';
import { ErrorsRepo } from '../src/db/repos/errors.repo.js';
import { PromptsRepo } from '../src/db/repos/prompts.repo.js';
import { AGENTS, MAX_PROMPT_LENGTH } from '../src/platform/settings/defaults.js';
import { HIDDEN, redactPersonal } from '../src/platform/settings/redact.js';
import { createSettings } from '../src/platform/settings/service.js';
import { setupTestDb, truncateAll } from './helpers/testDb.js';

let db: Pool;
beforeAll(async () => { db = await setupTestDb(); });
afterAll(async () => { await db.end(); });
beforeEach(async () => { await truncateAll(db); });

const settings = () => createSettings({
  audit: new AuditRepo(db), errors: new ErrorsRepo(db), prompts: new PromptsRepo(db),
  health: async () => ({ generatedAt: 'x', overall: 'ok', metrics: [] }),
});

describe('вырезание личных данных из журнала ошибок', () => {
  test.each([
    ['+7 (999) 123-45-67', HIDDEN],
    ['89991234567', HIDDEN],
    ['+79991234567', HIDDEN],
    ['телефон 8 999 123 45 67, ок', `телефон ${HIDDEN}, ок`],
    ['пишите ivan.petrov@mail.ru срочно', `пишите ${HIDDEN} срочно`],
    ['почта иван@почта.рф', `почта ${HIDDEN}`],
  ])('«%s» → «%s»', (input, expected) => { expect(redactPersonal(input)).toBe(expected); });

  test.each(['заявка 12 группа 345', 'ошибка 500 на /api/v1/requests/12/approve', 'версия 2026-10-10', 'тайм-аут 30000 мс'])(
    'обычный текст с числами «%s» не трогается', (text) => { expect(redactPersonal(text)).toBe(text); },
  );
});

describe('журнал ошибок', () => {
  test('запись сохраняется, читается новыми сверху и не содержит телефонов и почт', async () => {
    const e = new ErrorsRepo(db);
    await e.record('домашние группы', 'не найден участник +7 999 123-45-67');
    await e.record('подбор', 'сбой для ivan@mail.ru', 'POST /api/v1/matching/run');
    const rows = await e.recent();
    expect(rows.map((r) => r.service)).toEqual(['подбор', 'домашние группы']);
    expect(rows[0]!.message).toBe(`сбой для ${HIDDEN}`);
    expect(rows[1]!.message).toBe(`не найден участник ${HIDDEN}`);
    expect(rows[0]!.context).toBe('POST /api/v1/matching/run');
  });

  test('длинное сообщение обрезается', async () => {
    const e = new ErrorsRepo(db);
    await e.record('s', 'я'.repeat(2000));
    expect((await e.recent())[0]!.message.length).toBeLessThanOrEqual(500);
  });

  test('сбой самой записи (базы нет) не бросает исключения', async () => {
    const broken = new ErrorsRepo({ query: async () => { throw new Error('база недоступна'); } } as unknown as Pool);
    await expect(broken.record('s', 'm')).resolves.toBeUndefined();
  });

  test('читается не больше заданного числа записей', async () => {
    const e = new ErrorsRepo(db);
    for (let i = 0; i < 5; i += 1) await e.record('s', `m${i}`);
    expect(await e.recent(3)).toHaveLength(3);
  });
});

describe('инструкции агентов', () => {
  const coordinator = async (s = settings()) => (await s.prompts()).agents[0]!;
  const block = async (key: string, s = settings()) => (await coordinator(s)).blocks.find((b) => b.key === key)!;

  test('пока ничего не правили, действует текст по умолчанию из кода, версий нет', async () => {
    const a = await coordinator();
    expect(a.key).toBe('coordinator');
    expect(a.blocks.map((b) => b.key)).toEqual(['role', 'principles', 'steps', 'examples', 'service']);
    const role = await block('role');
    expect(role).toMatchObject({ isDefault: true, versions: [], editable: true });
    expect(role.text).toBe(AGENTS[0]!.blocks[0]!.text);
  });

  test('служебный блок только для чтения', async () => {
    expect(await block('service')).toMatchObject({ editable: false, isDefault: true });
  });

  test('сохранение создаёт версию 1, она действует и пишется в журнал без текста', async () => {
    const s = settings();
    expect(await s.savePrompt({ agent: 'coordinator', block: 'role', text: 'Новая роль', note: ' уточнили тон ' }, 'super_mbv_admin')).toEqual({ ok: true });
    const role = await block('role', s);
    expect(role).toMatchObject({ text: 'Новая роль', isDefault: false });
    expect(role.versions).toMatchObject([{ version: 1, by: 'super_mbv_admin', note: 'уточнили тон', active: true }]);
    const entry = (await db.query(`SELECT * FROM audit_log WHERE action = 'prompt.save'`)).rows[0];
    expect(entry).toMatchObject({ actor: 'super_mbv_admin', entity_type: 'prompt', after: { agent: 'coordinator', block: 'role', version: 1, length: 10 } });
    expect(JSON.stringify(entry)).not.toContain('Новая роль');
  });

  test('каждое сохранение — новая версия, действует последняя, старые остаются', async () => {
    const s = settings();
    await s.savePrompt({ agent: 'coordinator', block: 'steps', text: 'v1' }, 'a');
    await s.savePrompt({ agent: 'coordinator', block: 'steps', text: 'v2' }, 'a');
    const steps = await block('steps', s);
    expect(steps.text).toBe('v2');
    expect(steps.versions.map((v) => [v.version, v.active])).toEqual([[2, true], [1, false]]);
  });

  test('откат делает действующей прежнюю версию и пишется в журнал', async () => {
    const s = settings();
    await s.savePrompt({ agent: 'coordinator', block: 'steps', text: 'v1' }, 'a');
    await s.savePrompt({ agent: 'coordinator', block: 'steps', text: 'v2' }, 'a');
    expect(await s.activatePrompt({ agent: 'coordinator', block: 'steps', version: 1 }, 'super_mbv_admin')).toEqual({ ok: true });
    const steps = await block('steps', s);
    expect(steps.text).toBe('v1');
    expect(steps.versions.map((v) => [v.version, v.active])).toEqual([[2, false], [1, true]]);
    expect((await db.query(`SELECT 1 FROM audit_log WHERE action = 'prompt.activate'`)).rowCount).toBe(1);
  });

  test('откат на несуществующую версию — not_found, действующая не меняется', async () => {
    const s = settings();
    await s.savePrompt({ agent: 'coordinator', block: 'steps', text: 'v1' }, 'a');
    expect(await s.activatePrompt({ agent: 'coordinator', block: 'steps', version: 7 }, 'a')).toMatchObject({ ok: false, error: 'not_found' });
    expect((await block('steps', s)).text).toBe('v1');
  });

  test('одновременные сохранения получают разные номера версий и одна действует', async () => {
    const s = settings();
    await Promise.all([1, 2, 3].map((n) => s.savePrompt({ agent: 'coordinator', block: 'role', text: `t${n}` }, 'a')));
    const role = await block('role', s);
    expect(role.versions.map((v) => v.version).sort()).toEqual([1, 2, 3]);
    expect(role.versions.filter((v) => v.active)).toHaveLength(1);
  });

  test.each([
    [{ agent: 'coordinator', block: 'service', text: 'взлом' }, 'задаётся кодом'],
    [{ agent: 'coordinator', block: 'нет', text: 'x' }, 'нет'],
    [{ agent: 'другой', block: 'role', text: 'x' }, 'нет'],
    [{ agent: 'coordinator', block: 'role', text: '   ' }, 'пустым'],
    [{ agent: 'coordinator', block: 'role', text: 'я'.repeat(MAX_PROMPT_LENGTH + 1) }, 'длинный'],
    [{ agent: 'coordinator', block: 'role', text: 5 }, 'текст'],
    [{ agent: 'coordinator', block: 'role', text: 'x', note: 'я'.repeat(201) }, 'длинный'],
    [{ agent: 'coordinator', block: 'role', text: 'x', note: 5 }, 'текстом'],
    [null, 'блок'],
  ])('сохранение %j отклоняется (%s) и ничего не пишет', async (body, fragment) => {
    const s = settings();
    const r = await s.savePrompt(body, 'a');
    expect(r).toMatchObject({ ok: false, error: 'bad_request' });
    expect((r as { message: string }).message).toContain(fragment);
    expect((await db.query('SELECT 1 FROM agent_prompts')).rowCount).toBe(0);
  });

  test('откат служебного блока и неверной версии отклоняется', async () => {
    const s = settings();
    expect(await s.activatePrompt({ agent: 'coordinator', block: 'service', version: 1 }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    for (const version of [0, -1, 1.5, '1', null]) {
      expect(await s.activatePrompt({ agent: 'coordinator', block: 'role', version }, 'a')).toMatchObject({ ok: false, error: 'bad_request' });
    }
  });
});

describe('журнал регистрации в настройках', () => {
  test('записи читаются новыми сверху, с русской подписью действия; неизвестное действие — как есть', async () => {
    await db.query(`INSERT INTO audit_log (actor, service, action, entity_type, entity_id, before, after, note, at) VALUES
      ('mbv_admin', 'home-groups', 'request.approve', 'request', 5, '{"status":"Новая"}', '{"status":"Исполнена"}', NULL, '2026-10-01T10:00:00Z'),
      ('авто', 'home-groups', 'что.то.новое', 'x', NULL, NULL, NULL, 'пометка', '2026-10-02T10:00:00Z')`);
    const v = await settings().audit();
    expect(v.items.map((i) => i.action)).toEqual(['что.то.новое', 'request.approve']);
    expect(v.items[1]).toMatchObject({ actionLabel: 'Утверждение заявки', actor: 'mbv_admin', entityType: 'request', entityId: 5, before: { status: 'Новая' }, after: { status: 'Исполнена' } });
    expect(v.items[0]).toMatchObject({ actionLabel: 'что.то.новое', entityId: null, note: 'пометка' });
  });

  test('не больше двухсот записей', async () => {
    await db.query(`INSERT INTO audit_log (actor, service, action, entity_type) SELECT 'a', 's', 'x', 'y' FROM generate_series(1, 230)`);
    expect((await settings().audit()).items).toHaveLength(200);
  });
});

describe('журнал ошибок в настройках', () => {
  test('записи отдаются с ISO-временем', async () => {
    await new ErrorsRepo(db).record('сервис', 'сломалось', 'POST /x');
    const v = await settings().errors();
    expect(v.items[0]).toMatchObject({ service: 'сервис', message: 'сломалось', context: 'POST /x' });
    expect(v.items[0]!.at).toMatch(/^\d{4}-\d\d-\d\dT/);
  });
});

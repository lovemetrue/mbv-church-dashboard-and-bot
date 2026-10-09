import { describe, expect, test } from 'vitest';
import ExcelJS from 'exceljs';
import { buildMatchingReport, matchingWorkbook } from '../src/dashboard/matchingReport.js';
import type { DashboardGroup } from '../src/db/repos/groups.repo.js';
import type { DashboardRequest } from '../src/db/repos/requests.repo.js';

let gid = 1;
const group = (patch: Partial<DashboardGroup> = {}): DashboardGroup => ({
  id: gid++, no: null, leader: 'Иванова Мария', phone: null, phones: [], open_to_new: 'ДА', age: '25-40',
  district: 'Приморский', metro: 'Пионерская', address: null, composition: null, day: null, time: null,
  people: 8, coordinator: null, co_leader: null, co_leader_phone: null, feedback_at: null, comment: null,
  training: null, format: 'Основная церковь', status: 'Функционирует', checked: true, source: 'ui',
  campaign_registered: false, do_not_refer: false, ...patch,
});

let rid = 1;
const request = (patch: Partial<DashboardRequest> = {}): DashboardRequest => ({
  id: rid++, group_id: null, fio: 'Петров Пётр', responsible: null, status: 'Новая', date: '2026-10-01',
  phone: '+79001234567', phones: ['+79001234567'], age: '25-40', place: 'Приморский, м. Пионерская',
  source: null, ministry: null, note: null, extra: null, recommended: null, recommended_at: null,
  final_group: null, cancel_reason: null, attendance: null, type: 'join_group', text: null, origin: 'бот',
  church: null, mdg_status: 'join', leader_name: null, schedule: null, address: null, ...patch,
});

const IDLE = { campaignActive: false };
const build = (requests: DashboardRequest[], groups: DashboardGroup[]) =>
  buildMatchingReport({ requests, groups, ...IDLE });

describe('кого распределяем', () => {
  test('открытые заявки «хочу в группу» попадают в распределение, закрытые и чужих видов — нет', () => {
    const r = build([
      request({ fio: 'Открытая' }),
      request({ fio: 'Исполнена', status: 'Исполнена' }),
      request({ fio: 'Аннулирована', status: 'Аннулирована' }),
      request({ fio: 'Вопрос', type: 'question' }),
      request({ fio: 'Уже состоит', type: 'already_member' }),
    ], [group()]);
    expect(r.rows.map((x) => x.fio)).toEqual(['Открытая']);
  });

  test('кому группа уже назначена в дашборде или указана итоговая, того не трогаем, но считаем', () => {
    const g = group();
    const r = build([
      request({ fio: 'Назначена', group_id: g.id }),
      request({ fio: 'Ходит', final_group: 'Иванова' }),
      request({ fio: 'Свободна' }),
    ], [g]);
    expect(r.rows.map((x) => x.fio)).toEqual(['Свободна']);
    expect(r.meta.alreadyPlaced).toBe(2);
  });

  test('самые давние заявки идут первыми: им место нужнее', () => {
    const r = build([
      request({ fio: 'Новая', date: '2026-10-05' }),
      request({ fio: 'Старая', date: '2026-08-01' }),
    ], [group()]);
    expect(r.rows.map((x) => x.fio)).toEqual(['Старая', 'Новая']);
  });
});

describe('строка распределения', () => {
  test('назначенная группа, принцип, альтернативы и признак проверки', () => {
    const best = group({ leader: 'Лучшая', district: 'Приморский', metro: 'Пионерская' });
    const other = group({ leader: 'Запасная', district: 'Невский', metro: null });
    const [row] = build([request()], [other, best]).rows;
    expect(row).toMatchObject({ group: 'Лучшая', kind: 'действующая', geo: 'район и метро', check: '' });
    expect(row!.principle).toContain('тот же район');
    expect(row!.alternatives).toContain('Запасная');
  });

  test('без совпадения по месту — «нужна проверка» и об этом сказано в принципе', () => {
    const [row] = build([request({ place: 'Купчино' })], [group()]).rows;
    expect(row!.check).toBe('да');
    expect(row!.geo).toBe('нет');
    expect(row!.principle).toContain('нужна проверка');
  });

  test('когда подходящей группы нет, строка остаётся и объясняет, почему', () => {
    const [row] = build([request()], [group({ status: 'Закрыта' })]).rows;
    expect(row!.group).toBe('');
    expect(row!.principle).toContain('Подходящей группы нет');
  });

  test('время и адрес из анкеты бота видны рядом', () => {
    const [row] = build([request({ schedule: 'пн, ср вечером', address: 'ул Рылеева 32' })], [group()]).rows;
    expect(row).toMatchObject({ schedule: 'пн, ср вечером', address: 'ул Рылеева 32' });
  });
});

describe('группы с отметкой «Не направлять»', () => {
  test('в подбор не попадают и перечислены в итоге с комментарием', () => {
    const hidden = group({ leader: 'Скрытая', do_not_refer: true, comment: 'просили не направлять' });
    const open = group({ leader: 'Открытая' });
    const r = build([request()], [hidden, open]);
    expect(r.rows[0]!.group).toBe('Открытая');
    expect(r.meta.noReferGroups).toEqual([{ leader: 'Скрытая', status: 'Функционирует', comment: 'просили не направлять' }]);
    expect(r.groupRows.find((g) => g.leader === 'Скрытая')).toMatchObject({ inPool: 'нет', why: 'не направлять' });
  });
});

describe('те, кто хочет открыть группу', () => {
  const owner = (patch: Partial<DashboardRequest> = {}) =>
    request({ fio: 'Сидорова Анна', type: 'lead_group', mdg_status: 'open', place: 'Приморский, Пионерская', ...patch });

  test('их будущая группа идёт первой, и по ним видно, кому они достались', () => {
    const existing = group({ leader: 'Действующая' });
    const r = build([request({ fio: 'Желающий' }), owner()], [existing]);
    expect(r.rows[0]).toMatchObject({ group: 'Новая группа: Сидорова Анна', kind: 'новая' });
    expect(r.ownerRows).toEqual([
      expect.objectContaining({ fio: 'Сидорова Анна', assigned: 1, people: 'Желающий' }),
    ]);
  });

  test('закрытая заявка владельца не считается, а без места группу не назначить', () => {
    const r = build([
      request(),
      owner({ status: 'Исполнена' }),
      owner({ fio: 'Без места', place: null }),
    ], [group({ leader: 'Действующая' })]);
    expect(r.rows[0]!.group).toBe('Действующая');
    expect(r.ownerRows.map((o) => o.fio)).toEqual(['Без места']);
    expect(r.ownerRows[0]!.assigned).toBe(0);
  });
});

describe('нагрузка групп', () => {
  test('видно, сколько было, сколько назначено и сколько станет', () => {
    const g = group({ people: 8 });
    const r = build([request(), request()], [g]);
    expect(r.groupRows[0]).toMatchObject({ before: 8, added: 2, after: 10 });
  });
});

describe('файл Excel', () => {
  const load = async (requests: DashboardRequest[], groups: DashboardGroup[]) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await matchingWorkbook(build(requests, groups), new Date('2026-10-09T09:00:00Z')));
    return wb;
  };

  test('четыре листа, в том числе «Как считали» первым', async () => {
    const wb = await load([request()], [group()]);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Как считали', 'Распределение', 'Хотят открыть', 'Группы после распределения',
    ]);
  });

  test('на листе распределения есть все нужные колонки, в том числе комментарий и альтернативы', async () => {
    const wb = await load([request()], [group()]);
    const header = (wb.getWorksheet('Распределение')!.getRow(1).values as string[]).slice(1);
    expect(header).toEqual(expect.arrayContaining([
      'ФИО', 'Назначенная группа (ведущий)', 'Принцип распределения (комментарий)', 'Альтернативные группы', 'Нужна проверка',
    ]));
  });

  test('данные человека и назначенная группа попадают в строку, телефон читаемый', async () => {
    const wb = await load([request({ fio: 'Петров Пётр' })], [group({ leader: 'Иванова Мария' })]);
    const ws = wb.getWorksheet('Распределение')!;
    const cells = (ws.getRow(2).values as unknown[]).map(String);
    expect(cells).toEqual(expect.arrayContaining(['Петров Пётр', 'Иванова Мария', '+7 900 123-45-67']));
  });

  test('лист «Хотят открыть» без владельцев не пустой: объясняет, почему', async () => {
    const wb = await load([request()], [group()]);
    expect(String(wb.getWorksheet('Хотят открыть')!.getRow(2).getCell(1).value)).toContain('нет');
  });

  test('на листе «Как считали» перечислены группы «Не направлять»', async () => {
    const wb = await load([request()], [group({ leader: 'Скрытая', do_not_refer: true })]);
    const text = (wb.getWorksheet('Как считали')!.getColumn(1).values as unknown[]).map(String).join('\n');
    expect(text).toContain('Скрытая');
  });
});

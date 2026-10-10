import { describe, expect, test } from 'vitest';
import type { DashboardGroup } from '../src/db/repos/groups.repo.js';
import type { DashboardRequest } from '../src/db/repos/requests.repo.js';
import type { RegisteredParticipant } from '../src/db/repos/users.repo.js';
import type { CoordinatorRow } from '../src/db/repos/coordinators.repo.js';
import type { PlanEntry } from '../src/home-groups/plan/types.js';
import { buildViews, type ViewsInput } from '../src/home-groups/api/views.js';
import { createFakeEngine, type FakeEngineOptions } from './helpers/fakePlanEngine.js';

/**
 * Слой представлений: чистая функция без базы и сети, движок подставлен поддельный.
 * Проверяем именно правила отображения этапа A: что уходит в движок, как раскладывается
 * его ответ и какие поля попадают к человеку.
 */

// «Сейчас» — полдень по Москве, чтобы разница в днях не зависела от пояса машины.
const NOW = new Date('2026-10-10T09:00:00Z');

function group(over: Partial<DashboardGroup> & { id: number }): DashboardGroup {
  return {
    no: over.id, leader: `Ведущий ${over.id}`, phone: null, phones: [], open_to_new: null, age: null,
    district: 'Приморский', metro: null, address: null, composition: null, day: null, time: null, people: null,
    coordinator: null, co_leader: null, co_leader_phone: null, feedback_at: null, comment: null, training: null,
    format: 'Молодежная', status: 'Функционирует', checked: null, source: 'таблица', campaign_registered: false,
    do_not_refer: false,
    ...over,
  };
}

function request(over: Partial<DashboardRequest> & { id: number }): DashboardRequest {
  return {
    user_id: null, group_id: null, fio: `Человек ${over.id}`, responsible: null, status: 'Новая', date: '2026-10-05',
    phone: null, phones: [], age: null, place: null, source: null, ministry: null, note: null, extra: null,
    recommended: null, recommended_at: null, final_group: null, cancel_reason: null, attendance: null,
    type: 'join_group', text: null, origin: 'таблица', church: null, mdg_status: null, leader_name: null,
    schedule: null, address: null, callback: false,
    ...over,
  };
}

function participant(over: Partial<RegisteredParticipant> & { id: number }): RegisteredParticipant {
  return {
    registration_no: over.id, full_name: `Участник ${over.id}`, phone: null, church: null, mdg_status: null,
    registered_at: new Date('2026-10-01T10:00:00Z'), has_chat: true, kit_issued_at: null, age: null, location: null,
    platform: 'telegram',
    ...over,
  };
}

const coordinator = (over: Partial<CoordinatorRow> & { id: number }): CoordinatorRow =>
  ({ name: `Координатор ${over.id}`, role: 'Координатор', source: 'ui', ...over });

const empty: ViewsInput = { groups: [], requests: [], participants: [], coordinators: [] };

function build(input: Partial<ViewsInput>, engineOptions: FakeEngineOptions = {}, options = {}) {
  const fake = createFakeEngine(engineOptions);
  const views = buildViews({ ...empty, ...input }, fake.engine, NOW, options);
  return { views, ...fake };
}

describe('какие заявки уходят в движок и на экран', () => {
  const mixed = [
    request({ id: 1, status: 'Новая' }),
    request({ id: 2, status: 'В работе' }),
    request({ id: 3, status: 'Исполнена' }),
    request({ id: 4, status: 'Аннулирована' }),
    request({ id: 5, status: 'Новая', type: 'lead_group' }),
    request({ id: 6, status: 'На контроле' }),
  ];

  test('в план идут только открытые заявки на посещение группы', () => {
    const { calls } = build({ requests: mixed });
    expect(calls.plan).toHaveLength(1);
    expect(calls.plan[0]!.requests.map((r) => r.id).sort()).toEqual([1, 2, 6]);
  });

  test('на экране заявки открытые и исполненные, а отказы только в счётчике', () => {
    const { views } = build({ requests: mixed });
    expect(views.requests.items.map((i) => i.id).sort()).toEqual([1, 2, 3, 6]);
    expect(views.requests.counters.cancelled).toBe(1);
    expect(views.requests.counters.done).toBe(1);
  });

  test('заявки не на посещение группы (хочу открыть свою) на экран не попадают', () => {
    const { views } = build({ requests: mixed });
    expect(views.requests.items.some((i) => i.id === 5)).toBe(false);
  });

  test('все группы справочника уходят в движок, в том числе закрытые', () => {
    const groups = [group({ id: 1 }), group({ id: 2, status: 'Закрыта' }), group({ id: 3, status: 'Недвижимость' })];
    const { calls, views } = build({ groups, requests: [request({ id: 1 })] });
    expect(calls.plan[0]!.groups.map((g) => g.id)).toEqual([1, 2, 3]);
    expect(views.groups.items.map((g) => g.id)).toEqual([1, 2, 3]);
  });

  test('порядок: перезвонить, готово, нужна помощь, утверждено', () => {
    const callbackEntry: PlanEntry = {
      kind: 'proposal', main: { groupId: 1, score: 90, reasons: [] }, confidence: 90, knownParams: 3,
      alternatives: [], displaced: null,
    };
    const { views } = build(
      {
        groups: [group({ id: 1 })],
        requests: [
          request({ id: 1, status: 'Исполнена', place: 'Приморский' }),
          request({ id: 2, place: null }),
          request({ id: 3, place: 'Приморский' }),
          request({ id: 4, place: 'Приморский' }),
        ],
      },
      { entries: { 4: callbackEntry }, bucketByEntry: new Map([[callbackEntry, 'callback']]) },
    );
    expect(views.requests.items.map((i) => [i.id, i.bucket])).toEqual([
      [4, 'callback'], [3, 'ready'], [2, 'human'], [1, 'done'],
    ]);
  });

  test('внутри корзины тот, кто ждёт дольше, выше', () => {
    const { views } = build({
      requests: [
        request({ id: 1, date: '2026-10-09' }),
        request({ id: 2, date: '2026-09-20' }),
        request({ id: 3, date: '2026-10-05' }),
        request({ id: 4, date: null }),
      ],
    });
    expect(views.requests.items.map((i) => i.id)).toEqual([2, 3, 1, 4]);
  });
});

describe('заявка превращается в запрос к движку', () => {
  test('район берётся у движка по месту и индексу метро, построенному из групп', () => {
    const groups = [group({ id: 1, district: 'Невский', metro: 'Ломоносовская' })];
    const { views, calls } = build({ groups, requests: [request({ id: 1, place: 'Ломоносовская' })] });

    expect(calls.resolve.find((c) => c.place === 'Ломоносовская')?.metroIndex?.get('ломоносовская')).toBe('Невский');
    expect(views.requests.items[0]!.district).toBe('Невский');
    expect(calls.plan[0]!.requests[0]!.district).toBe('Невский');
  });

  test('возраст разбирается движком, а дни, время, улица, отказы и закрепление пусты', () => {
    const { calls } = build({ requests: [request({ id: 1, age: '26-35', place: 'Приморский' })] });
    expect(calls.plan[0]!.requests[0]).toMatchObject({
      id: 1, ageRange: [26, 35], district: 'Приморский', place: 'Приморский',
      days: [], slot: null, street: null, rejectedGroupIds: [], avoidDays: [], avoidSlots: [], pinnedGroupId: null,
    });
  });

  test('флаг «перезвонить» в этапе A всегда выключен', () => {
    const { calls } = build({ requests: [request({ id: 1 })] });
    expect(calls.bucket.every((b) => b.callback === false)).toBe(true);
  });

  test('движку передаются настройки по умолчанию с вместимостью из параметра', () => {
    const { calls } = build({ requests: [request({ id: 1 })] }, {}, { defaultCapacity: 7 });
    expect(calls.plan[0]!.settings.defaultCapacity).toBe(7);
    expect(calls.plan[0]!.settings.humanThreshold).toBe(60);
  });

  test('дни ожидания считаются от даты заявки до сегодняшней даты по Москве', () => {
    const { calls, views } = build({
      requests: [request({ id: 1, date: '2026-10-05' }), request({ id: 2, date: null }), request({ id: 3, date: '2026-10-12' })],
    });
    const byId = new Map(calls.plan[0]!.requests.map((r) => [r.id, r.waitingDays]));
    expect(byId.get(1)).toBe(5);
    expect(byId.get(2)).toBeNull();
    // Дата из будущего (опечатка в таблице) не должна давать отрицательное ожидание.
    expect(byId.get(3)).toBe(0);
    expect(views.requests.items.find((i) => i.id === 1)!.waitingDays).toBe(5);
  });

  test('после полуночи по Москве, но до полуночи по UTC «сегодня» уже новое', () => {
    const lateEvening = new Date('2026-10-10T22:30:00Z'); // 11 октября 01:30 по Москве
    const fake = createFakeEngine();
    buildViews({ ...empty, requests: [request({ id: 1, date: '2026-10-10' })] }, fake.engine, lateEvening);
    expect(fake.calls.plan[0]!.requests[0]!.waitingDays).toBe(1);
  });

  test('пустое имя заменяется, чтобы движок и экран не получили null', () => {
    const { views } = build({ requests: [request({ id: 1, fio: null })] });
    expect(views.requests.items[0]!.fio).toBe('Без имени');
  });
});

describe('карточка заявки', () => {
  test('заполненность: район, возраст, день и время, улица', () => {
    const { views } = build({
      requests: [
        request({ id: 1, place: 'Приморский', age: '26-35' }),
        request({ id: 2, place: null, age: null }),
        request({ id: 3, place: 'Приморский', age: 'любой' }),
      ],
    });
    const fill = (id: number) => views.requests.items.find((i) => i.id === id)!.dataFill;
    expect(fill(1)).toEqual([true, true, false, false]);
    expect(fill(2)).toEqual([false, false, false, false]);
    expect(fill(3)).toEqual([true, false, false, false]);
  });

  test('дни, время и улица в этапе A пусты', () => {
    const { views } = build({ requests: [request({ id: 1 })] });
    expect(views.requests.items[0]).toMatchObject({ days: [], slot: null, street: null });
  });

  test('источник: происхождение записи и, если не дубль, откуда именно', () => {
    const { views } = build({
      requests: [
        request({ id: 1, origin: 'бот' }),
        request({ id: 2, origin: 'таблица', source: 'Таблица' }),
        request({ id: 3, origin: 'ui', source: 'Инстаграм' }),
        request({ id: 4, origin: 'бот', source: 'Telegram' }),
        request({ id: 5, origin: 'таблица', source: '  ' }),
      ],
    });
    const source = (id: number) => views.requests.items.find((i) => i.id === id)!.source;
    expect(source(1)).toBe('Бот');
    expect(source(2)).toBe('Таблица');
    expect(source(3)).toBe('Дашборд · Инстаграм');
    expect(source(4)).toBe('Бот · Telegram');
    expect(source(5)).toBe('Таблица');
  });

  test('телефон: первый из списка номеров форматируется, иначе берётся как записан', () => {
    const { views } = build({
      requests: [
        request({ id: 1, phones: ['+79111234567', '+79990000000'], phone: 'старый' }),
        request({ id: 2, phones: [], phone: '8 (905) 263-73-89; Раиса' }),
        request({ id: 3, phones: [], phone: null }),
        request({ id: 4, phones: [], phone: '   ' }),
      ],
    });
    const phone = (id: number) => views.requests.items.find((i) => i.id === id)!.phone;
    expect(phone(1)).toBe('+7 911 123-45-67');
    expect(phone(2)).toBe('8 (905) 263-73-89; Раиса');
    expect(phone(3)).toBeNull();
    expect(phone(4)).toBeNull();
  });

  test('заметка склеивает примечание и дополнение через « | »', () => {
    const { views } = build({
      requests: [
        request({ id: 1, note: 'Просит вечер', extra: 'Есть коляска' }),
        request({ id: 2, note: null, extra: 'Только допполе' }),
        request({ id: 3, note: 'Только примечание', extra: ' ' }),
        request({ id: 4, note: null, extra: null }),
      ],
    });
    const note = (id: number) => views.requests.items.find((i) => i.id === id)!.note;
    expect(note(1)).toBe('Просит вечер | Есть коляска');
    expect(note(2)).toBe('Только допполе');
    expect(note(3)).toBe('Только примечание');
    expect(note(4)).toBeNull();
  });

  test('журнал: создание, рекомендация, утверждение, причина отказа, контроль посещения', () => {
    const { views } = build({
      groups: [group({ id: 7, leader: 'Мария' })],
      requests: [
        request({
          id: 1, status: 'Исполнена', origin: 'бот', date: '2026-10-01', recommended: 'Группа Марии',
          recommended_at: '2026-10-02', final_group: 'Группа Марии (Пн)', cancel_reason: 'передумал',
          attendance: 'пришёл дважды',
        }),
      ],
    });
    expect(views.requests.items[0]!.log).toEqual([
      { at: '2026-10-01', text: 'Заявка создана (Бот)' },
      { at: '2026-10-02', text: 'Рекомендована группа: Группа Марии' },
      { at: null, text: 'Утверждена: Группа Марии (Пн)' },
      { at: null, text: 'Причина аннулирования: передумал' },
      { at: null, text: 'Контроль посещения: пришёл дважды' },
    ]);
  });

  test('журнал без лишнего: у новой заявки одна строка, а дата без формата не выдумывается', () => {
    const { views } = build({ requests: [request({ id: 1, date: null, origin: 'ui' })] });
    expect(views.requests.items[0]!.log).toEqual([{ at: null, text: 'Заявка создана (Дашборд)' }]);
  });

  test('утверждённая заявка без текста группы берёт её из справочника по group_id', () => {
    const { views } = build({
      groups: [group({ id: 7, leader: 'Мария' })],
      requests: [request({ id: 1, status: 'Исполнена', group_id: 7 })],
    });
    expect(views.requests.items[0]!.log.map((l) => l.text)).toContain('Утверждена: ДГ-0007, Мария');
  });

  test('утверждённая заявка: группа по group_id, а текст остаётся пустым', () => {
    const { views } = build({
      groups: [group({ id: 12, no: 12, leader: 'Мария', district: 'Невский', people: 4, day: 'Вторник', time: '19:00' })],
      requests: [request({ id: 1, status: 'Исполнена', group_id: 12, final_group: 'Мария Иванова' })],
    });
    const item = views.requests.items[0]!;
    expect(item.bucket).toBe('done');
    expect(item.finalGroup).toMatchObject({
      id: 12, no: 12, code: 'ДГ-0012', leader: 'Мария', district: 'Невский', people: 4, capacity: 10, free: 6,
      whenText: 'Вт, вечер',
    });
    expect(item.finalGroupText).toBeNull();
  });

  test('утверждённая заявка без группы в справочнике показывает название текстом', () => {
    const { views } = build({
      groups: [group({ id: 1 })],
      requests: [
        request({ id: 1, status: 'Исполнена', group_id: null, final_group: 'Группа на Беговой' }),
        request({ id: 2, status: 'Исполнена', group_id: 999, final_group: 'Исчезнувшая группа' }),
      ],
    });
    const item = (id: number) => views.requests.items.find((i) => i.id === id)!;
    expect(item(1)).toMatchObject({ finalGroup: null, finalGroupText: 'Группа на Беговой' });
    expect(item(2)).toMatchObject({ finalGroup: null, finalGroupText: 'Исчезнувшая группа' });
  });

  test('у открытой заявки финальной группы нет, даже если колонка заполнена', () => {
    const { views } = build({
      groups: [group({ id: 1 })],
      requests: [request({ id: 1, status: 'В работе', group_id: 1, final_group: 'Что-то' })],
    });
    expect(views.requests.items[0]).toMatchObject({ finalGroup: null, finalGroupText: null });
  });

  test('ответственный и статус отдаются как в базе', () => {
    const { views } = build({ requests: [request({ id: 1, status: 'На контроле', responsible: 'Анна' })] });
    expect(views.requests.items[0]).toMatchObject({ status: 'На контроле', responsible: 'Анна' });
  });
});

describe('предложение плана', () => {
  const groups = [
    group({ id: 1, district: 'Приморский', metro: 'Беговая' }),
    group({ id: 2, district: 'Приморский' }),
    group({ id: 3, district: 'Приморский' }),
  ];

  test('основная группа несёт уверенность, запасные — нет, вытесненная объясняется', () => {
    const entry: PlanEntry = {
      kind: 'proposal',
      main: { groupId: 1, score: 88, reasons: [{ tone: 'good', text: 'тот же район' }] },
      confidence: 71,
      knownParams: 3,
      alternatives: [{ groupId: 2, score: 60, reasons: [{ tone: 'neutral', text: 'возраст рядом' }] }],
      displaced: { groupId: 3, takenBy: ['Иван Петров'] },
    };
    const { views } = build({ groups, requests: [request({ id: 5, place: 'Приморский' })] }, { entries: { 5: entry } });
    const proposal = views.requests.items[0]!.proposal!;

    expect(views.requests.items[0]!.noPlan).toBeNull();
    expect(proposal.knownParams).toBe(3);
    expect(proposal.main).toMatchObject({ score: 88, confidence: 71, reasons: [{ tone: 'good', text: 'тот же район' }] });
    expect(proposal.main.group).toMatchObject({ id: 1, code: 'ДГ-0001' });
    expect(proposal.alternatives).toHaveLength(1);
    expect(proposal.alternatives[0]).toMatchObject({ score: 60, confidence: null });
    expect(proposal.alternatives[0]!.group.id).toBe(2);
    expect(proposal.displaced).toMatchObject({ takenBy: ['Иван Петров'] });
    expect(proposal.displaced!.group.id).toBe(3);
  });

  test('когда плана нет, причина передаётся как есть', () => {
    const { views } = build({ groups, requests: [request({ id: 1, place: null })] });
    expect(views.requests.items[0]).toMatchObject({
      proposal: null, noPlan: { code: 'place', reason: 'Район не определён' },
    });
  });

  test('движок назвал группу, которой нет в справочнике: плана нет, а не полуплан', () => {
    const entry: PlanEntry = {
      kind: 'proposal', main: { groupId: 404, score: 80, reasons: [] }, confidence: 80, knownParams: 2,
      alternatives: [], displaced: null,
    };
    const { views } = build({ groups, requests: [request({ id: 1, place: 'Приморский' })] }, { entries: { 1: entry } });
    expect(views.requests.items[0]!.proposal).toBeNull();
    expect(views.requests.items[0]!.noPlan?.code).toBe('nogroup');
  });

  test('у закрытой заявки плана и причины нет', () => {
    const { views } = build({ groups, requests: [request({ id: 1, status: 'Исполнена' })] });
    expect(views.requests.items[0]).toMatchObject({ proposal: null, noPlan: null });
  });
});

describe('экран «Сегодня»', () => {
  const requests = [
    request({ id: 1, place: 'Приморский' }),
    request({ id: 2, place: 'Приморский' }),
    request({ id: 3, place: null }),
    request({ id: 4, status: 'Исполнена' }),
    request({ id: 5, status: 'Аннулирована' }),
    request({ id: 6, status: 'Исполнена' }),
    request({ id: 7, type: 'question' }),
  ];
  const groups = [group({ id: 1 })];

  test('счётчики по корзинам; «распределено» — готово, перезвонить и утверждено из всех, кроме отказов', () => {
    const { views } = build({ groups, requests });
    expect(views.today.counters).toEqual({ ready: 2, callback: 0, human: 1, done: 2, cancelled: 1 });
    expect(views.today.assigned).toBe(4);
    expect(views.today.total).toBe(5);
  });

  test('«перезвонить» входит в распределённых', () => {
    const entry: PlanEntry = {
      kind: 'proposal', main: { groupId: 1, score: 90, reasons: [] }, confidence: 90, knownParams: 3,
      alternatives: [], displaced: null,
    };
    const { views } = build(
      { groups, requests: [request({ id: 1, place: 'Приморский' })] },
      { entries: { 1: entry }, bucketByEntry: new Map([[entry, 'callback']]) },
    );
    expect(views.today.counters.callback).toBe(1);
    expect(views.today.assigned).toBe(1);
    expect(views.today.total).toBe(1);
  });

  test('сводка считается по открытым заявкам, их плану и всем группам', () => {
    const { calls, views } = build({ groups, requests });
    const input = calls.summary[0]!;
    expect(input.requests.map((r) => r.id).sort()).toEqual([1, 2, 3]);
    expect([...input.entries.keys()].sort()).toEqual([1, 2, 3]);
    expect(input.groups.map((g) => g.id)).toEqual([1]);
    expect(views.today.ageColumns).toEqual(['18–25', '26–35']);
  });

  test('время формирования — ISO момент расчёта, одинаковое во всех представлениях', () => {
    const { views } = build({});
    expect(views.today.generatedAt).toBe(NOW.toISOString());
    expect(views.requests.generatedAt).toBe(NOW.toISOString());
    expect(views.groups.generatedAt).toBe(NOW.toISOString());
    expect(views.people.generatedAt).toBe(NOW.toISOString());
    expect(views.coordinators.generatedAt).toBe(NOW.toISOString());
  });
});

describe('группы справочника', () => {
  test('для движка: возраст и «когда» разобраны, улицы нет, вместимость по умолчанию', () => {
    const { calls } = build({
      groups: [group({ id: 1, age: '25-40', day: 'Вторник', time: '19:00', people: 6, metro: ' Беговая ', address: 'ул. Закрытая, 5' })],
    });
    expect(calls.plan[0]!.groups[0]).toMatchObject({
      id: 1, ageRange: [25, 40], day: 'Вт', slot: 'вечер', street: null, people: 6, capacity: 10, metro: 'Беговая',
      status: 'Функционирует', doNotRefer: false,
    });
  });

  test('«приём новых»: пусто и всё, кроме «Нет», принимает; «Нет» в любом регистре — нет', () => {
    const { calls } = build({
      groups: [
        group({ id: 1, open_to_new: null }),
        group({ id: 2, open_to_new: '' }),
        group({ id: 3, open_to_new: 'Да' }),
        group({ id: 4, open_to_new: 'нет' }),
        group({ id: 5, open_to_new: ' НЕТ ' }),
        group({ id: 6, open_to_new: 'Нет' }),
      ],
    });
    expect(calls.plan[0]!.groups.map((g) => g.acceptsNew)).toEqual([true, true, true, false, false, false]);
  });

  test('«не направлять» доходит и до движка, и до справочника', () => {
    const { calls, views } = build({ groups: [group({ id: 1, do_not_refer: true })] });
    expect(calls.plan[0]!.groups[0]!.doNotRefer).toBe(true);
    expect(views.groups.items[0]!.doNotRefer).toBe(true);
  });

  test('обратная связь: сколько дней прошло с отметки', () => {
    const { calls, views } = build({
      groups: [
        group({ id: 1, feedback_at: '2026-10-10' }),
        group({ id: 2, feedback_at: '2026-09-10' }),
        group({ id: 3, feedback_at: null }),
        group({ id: 4, feedback_at: 'вчера' }),
      ],
    });
    expect(calls.plan[0]!.groups.map((g) => g.verifiedDaysAgo)).toEqual([0, 30, null, null]);
    expect(views.groups.items.map((g) => g.verifiedDaysAgo)).toEqual([0, 30, null, null]);
  });

  test('несуществующая дата (31 февраля) не считается: обратной связи как будто не было', () => {
    const { views } = build({
      groups: [group({ id: 1, feedback_at: '2026-02-31' })],
      requests: [request({ id: 1, date: '2026-02-31' })],
    });
    expect(views.groups.items[0]!.verifiedDaysAgo).toBeNull();
    expect(views.requests.items[0]!.waitingDays).toBeNull();
  });

  test('краткая карточка: код из четырёх цифр, места не уходят ниже нуля', () => {
    const { views } = build({
      groups: [
        group({ id: 12, people: 4 }),
        group({ id: 2, people: 15 }),
        group({ id: 3, people: null }),
      ],
    });
    const item = (id: number) => views.groups.items.find((g) => g.id === id)!;
    expect(item(12)).toMatchObject({ code: 'ДГ-0012', capacity: 10, free: 6, people: 4 });
    expect(item(2)).toMatchObject({ code: 'ДГ-0002', free: 0 });
    // Число участников неизвестно — считаем, что места есть.
    expect(item(3)).toMatchObject({ people: null, free: 10 });
  });

  test('вместимость по умолчанию — параметр', () => {
    const { views } = build({ groups: [group({ id: 1, people: 3 })] }, {}, { defaultCapacity: 5 });
    expect(views.groups.items[0]).toMatchObject({ capacity: 5, free: 2 });
  });

  test('поля справочника: день и время разобраны, телефон отформатирован', () => {
    const { views } = build({
      groups: [group({
        id: 1, leader: 'Мария', co_leader: 'Пётр', phones: ['+79111234567'], phone: '8 911 123-45-67; Мария',
        age: '25-40', day: 'Четверг', time: '19:00', composition: 'Семейная', coordinator: 'Анна', comment: 'Тихо',
        format: 'Молодежная', status: 'Функционирует', metro: 'Беговая',
      })],
    });
    expect(views.groups.items[0]).toMatchObject({
      leader: 'Мария', coLeader: 'Пётр', phone: '+7 911 123-45-67', ageText: '25-40', day: 'Чт', slot: 'вечер',
      status: 'Функционирует', composition: 'Семейная', coordinator: 'Анна', comment: 'Тихо', format: 'Молодежная',
      whenText: 'Чт, вечер', metro: 'Беговая',
    });
  });

  test('кого план направляет в группу: ФИО, возраст, место и уверенность', () => {
    const { views } = build({
      groups: [group({ id: 1 })],
      requests: [request({ id: 5, fio: 'Иван Петров', age: '26-35', place: 'Приморский' }), request({ id: 6, place: null })],
    });
    expect(views.groups.items[0]!.plannedRequests).toEqual([
      { id: 5, fio: 'Иван Петров', ageLabel: '26-35', place: 'Приморский', confidence: 70 },
    ]);
  });

  test('закрытый адрес и телефон второго ведущего в ответ не попадают', () => {
    const { views } = build({
      groups: [group({ id: 1, address: 'ул. Секретная, 1, кв. 5', co_leader_phone: '+79990001122' })],
      requests: [request({ id: 1, address: 'ул. Анкетная, 2', schedule: 'по вечерам' })],
      participants: [participant({ id: 1 })],
    });
    const json = JSON.stringify(views);
    expect(json).not.toContain('Секретная');
    expect(json).not.toContain('79990001122');
    expect(json).not.toContain('Анкетная');
    expect(json).not.toContain('"address"');
  });
});

describe('здоровье группы', () => {
  const fullGroup = group({
    id: 1, leader: 'Мария', phones: ['+79111234567'], day: 'Вторник', time: '19:00', district: 'Приморский',
    metro: 'Беговая', feedback_at: '2026-10-01', people: 5,
  });

  test('полностью заполненная группа набирает сто', () => {
    const { views } = build({ groups: [fullGroup] });
    expect(views.groups.items[0]!.health.score).toBe(100);
    expect(views.groups.items[0]!.health.items).toEqual([
      { ok: true, label: 'Ведущий указан', points: 10 },
      { ok: true, label: 'Телефон ведущего', points: 15 },
      { ok: true, label: 'День и время', points: 20 },
      { ok: true, label: 'Район и метро', points: 15 },
      { ok: true, label: 'Обратная связь за 30 дней', points: 30 },
      { ok: true, label: 'Число участников указано', points: 10 },
    ]);
  });

  test('баллы всех пунктов дают ровно сто', () => {
    const { views } = build({ groups: [fullGroup] });
    expect(views.groups.items[0]!.health.items.reduce((s, i) => s + i.points, 0)).toBe(100);
  });

  test.each([
    ['ведущий не указан', { leader: '  ' }, 'Ведущий указан', 90],
    ['нет телефона', { phones: [], phone: null }, 'Телефон ведущего', 85],
    ['нет дня', { day: null }, 'День и время', 80],
    ['нет времени', { time: null }, 'День и время', 80],
    ['район не указан', { district: 'Не указан' }, 'Район и метро', 85],
    ['нет метро', { metro: null }, 'Район и метро', 85],
    ['обратная связь старше тридцати дней', { feedback_at: '2026-09-09' }, 'Обратная связь за 30 дней', 70],
    ['обратной связи не было', { feedback_at: null }, 'Обратная связь за 30 дней', 70],
    ['участников не указано', { people: null }, 'Число участников указано', 90],
  ] as [string, Partial<DashboardGroup>, string, number][])('%s: пункт «%s» снимает баллы', (_name, over, label, score) => {
    const { views } = build({ groups: [{ ...fullGroup, ...over }] });
    const health = views.groups.items[0]!.health;
    expect(health.items.find((i) => i.label === label)!.ok).toBe(false);
    expect(health.score).toBe(score);
  });

  test('ровно тридцать дней назад ещё свежая обратная связь', () => {
    const { views } = build({ groups: [{ ...fullGroup, feedback_at: '2026-09-10' }] });
    expect(views.groups.items[0]!.health.items.find((i) => i.label.startsWith('Обратная связь'))!.ok).toBe(true);
  });
});

describe('люди', () => {
  test('участник бота: ключ, подпись платформы, ответ про малую группу, район, дата и ссылка на заявку', () => {
    const { views } = build({
      groups: [group({ id: 1, district: 'Невский', metro: 'Ломоносовская' })],
      participants: [
        participant({
          id: 12, full_name: 'Дарья Ефимова', phone: '+79111234567', age: '26-35', location: 'Ломоносовская',
          mdg_status: 'join', platform: 'max', registered_at: new Date('2026-09-12T10:00:00Z'),
        }),
      ],
      requests: [request({ id: 40, user_id: 12, place: 'Ломоносовская' })],
    });
    expect(views.people.items).toEqual([{
      key: 'u12', fio: 'Дарья Ефимова', phone: '+7 911 123-45-67', ageLabel: '26-35', district: 'Невский',
      from: 'Бот · MAX', mdgLabel: 'Хочет в группу', date: '2026-09-12', requestId: 40,
    }]);
  });

  test('подписи ответов про малую группу', () => {
    const statuses = ['open', 'home', 'join', 'member', 'leader', null] as const;
    const { views } = build({ participants: statuses.map((s, i) => participant({ id: i + 1, mdg_status: s })) });
    const label = (key: string) => views.people.items.find((p) => p.key === key)!.mdgLabel;
    expect([1, 2, 3, 4, 5, 6].map((i) => label(`u${i}`))).toEqual([
      'Откроет свою группу', 'Даст дом для группы', 'Хочет в группу', 'Уже в группе', 'Ведёт группу', 'Не ответил',
    ]);
  });

  test('откуда: Telegram, MAX, а заведённого вручную подписываем формой регистрации', () => {
    const { views } = build({
      participants: [
        participant({ id: 1, platform: 'telegram' }),
        participant({ id: 2, platform: 'max' }),
        participant({ id: 3, platform: 'telegram', has_chat: false }),
      ],
    });
    const from = (key: string) => views.people.items.find((p) => p.key === key)!.from;
    expect(from('u1')).toBe('Бот · Telegram');
    expect(from('u2')).toBe('Бот · MAX');
    expect(from('u3')).toBe('Форма регистрации');
  });

  test('заявка без участника тоже человек: ключ r, источник, «Заявка: корзина»', () => {
    const { views } = build({
      groups: [group({ id: 1 })],
      requests: [
        request({ id: 7, fio: 'Станислав Ким', phones: ['+79041234567'], age: '26-35', place: 'Приморский', origin: 'таблица', date: '2026-10-02' }),
        request({ id: 8, place: null, origin: 'ui', source: 'Звонок', date: '2026-10-03' }),
        request({ id: 9, status: 'Исполнена', date: '2026-10-04' }),
        request({ id: 10, status: 'Аннулирована', date: '2026-10-01' }),
      ],
    });
    const person = (key: string) => views.people.items.find((p) => p.key === key)!;
    expect(person('r7')).toEqual({
      key: 'r7', fio: 'Станислав Ким', phone: '+7 904 123-45-67', ageLabel: '26-35', district: 'Приморский',
      from: 'Таблица', mdgLabel: 'Заявка: готово к утверждению', date: '2026-10-02', requestId: 7,
    });
    expect(person('r8')).toMatchObject({ from: 'Дашборд · Звонок', mdgLabel: 'Заявка: нужна помощь в сопоставлении', district: null });
    expect(person('r9').mdgLabel).toBe('Заявка: утверждено');
    expect(person('r10').mdgLabel).toBe('Заявка: отказ');
  });

  test('заявка участника бота отдельной строкой не дублируется, а чужие виды заявок в людях не нужны', () => {
    const { views } = build({
      participants: [participant({ id: 1 })],
      requests: [request({ id: 1, user_id: 1 }), request({ id: 2, user_id: null, type: 'question' })],
    });
    expect(views.people.items.map((p) => p.key)).toEqual(['u1']);
  });

  test('если заявок у участника несколько, ссылка ведёт на самую свежую', () => {
    const { views } = build({
      participants: [participant({ id: 1 })],
      requests: [request({ id: 3, user_id: 1 }), request({ id: 9, user_id: 1 }), request({ id: 5, user_id: 1, type: 'question' })],
    });
    expect(views.people.items[0]!.requestId).toBe(9);
  });

  test('у участника без заявки на группу ссылки нет', () => {
    const { views } = build({
      participants: [participant({ id: 1 })],
      requests: [request({ id: 5, user_id: 1, type: 'lead_group' })],
    });
    expect(views.people.items[0]!.requestId).toBeNull();
  });

  test('свежие сверху: участники и заявки в одном списке по дате', () => {
    const { views } = build({
      participants: [participant({ id: 1, registered_at: new Date('2026-09-01T10:00:00Z') })],
      requests: [request({ id: 2, date: '2026-10-02' }), request({ id: 3, date: null })],
    });
    expect(views.people.items.map((p) => p.key)).toEqual(['r2', 'u1', 'r3']);
  });
});

describe('координаторы', () => {
  test('группы, участники и группы со свежей обратной связью по совпадению имени', () => {
    const { views } = build({
      coordinators: [coordinator({ id: 1, name: 'Анна Смирнова', role: 'Координатор' }), coordinator({ id: 2, name: 'Борис' })],
      groups: [
        group({ id: 1, coordinator: 'Анна Смирнова', people: 5, feedback_at: '2026-10-01' }),
        group({ id: 2, coordinator: ' анна смирнова ', people: 7, feedback_at: '2026-06-01' }),
        group({ id: 3, coordinator: 'Анна Смирнова', people: null, feedback_at: null }),
        group({ id: 4, coordinator: 'Кто-то другой', people: 9 }),
        group({ id: 5, coordinator: null, people: 9 }),
      ],
    });
    expect(views.coordinators.items).toEqual([
      { id: 1, name: 'Анна Смирнова', role: 'Координатор', groups: 3, people: 12, verified30: 1 },
      { id: 2, name: 'Борис', role: 'Координатор', groups: 0, people: 0, verified30: 0 },
    ]);
  });
});

describe('координаторы: граница свежести', () => {
  test('обратная связь ровно тридцать дней назад свежая, на день старше — нет', () => {
    const { views } = build({
      coordinators: [coordinator({ id: 1, name: 'Анна' })],
      groups: [
        group({ id: 1, coordinator: 'Анна', feedback_at: '2026-09-10' }),
        group({ id: 2, coordinator: 'Анна', feedback_at: '2026-09-09' }),
      ],
    });
    expect(views.coordinators.items[0]).toMatchObject({ groups: 2, verified30: 1 });
  });
});

describe('пустая база', () => {
  test('все представления собираются без падений', () => {
    const { views } = build({});
    expect(views.requests.items).toEqual([]);
    expect(views.groups.items).toEqual([]);
    expect(views.people.items).toEqual([]);
    expect(views.coordinators.items).toEqual([]);
    expect(views.today).toMatchObject({
      counters: { ready: 0, callback: 0, human: 0, done: 0, cancelled: 0 }, assigned: 0, total: 0,
    });
  });
});


describe('решения координатора', () => {
  test('отметка «нужен звонок» уходит в движок и выносит заявку в «перезвонить»', () => {
    const { views, calls } = build({
      groups: [group({ id: 1 })],
      requests: [request({ id: 1, place: 'Приморский', callback: true })],
    });
    expect(calls.bucket.find((b) => b.status === 'Новая')?.callback).toBe(true);
    expect(views.requests.items[0]).toMatchObject({ callback: true });
  });

  test('без отметки заявка не помечается звонком', () => {
    const { views } = build({ groups: [group({ id: 1 })], requests: [request({ id: 1, place: 'Приморский' })] });
    expect(views.requests.items[0]!.callback).toBe(false);
  });

  test('отклонённые координатором группы передаются движку, чтобы не предлагать их снова', () => {
    const { calls } = build({
      groups: [group({ id: 1 }), group({ id: 2 })],
      requests: [request({ id: 7, place: 'Приморский' })],
      rejectedGroups: new Map([[7, [1]]]),
    });
    expect(calls.plan[0]!.requests.find((r) => r.id === 7)!.rejectedGroupIds).toEqual([1]);
  });

  test('предложение помечено источником «расчёт»: пока человек не утвердил, это только предложение', () => {
    const { views } = build({ groups: [group({ id: 1 })], requests: [request({ id: 1, place: 'Приморский' })] });
    expect(views.requests.items[0]!.proposal?.source).toBe('script');
  });

  test('действия координатора попадают в ленту заявки с датой и автором', () => {
    const at = new Date('2026-10-09T10:00:00Z');
    const { views } = build({
      groups: [group({ id: 1 }), group({ id: 2 })],
      requests: [request({ id: 1, place: 'Приморский' })],
      audit: [
        { entity_id: 1, at, actor: 'mbv_admin', action: 'request.reject', after: { rejected_group_id: 1, reason: 'time' }, note: null },
        { entity_id: 1, at, actor: 'mbv_admin', action: 'request.need_call', after: { callback: true }, note: null },
        { entity_id: 2, at, actor: 'mbv_admin', action: 'request.need_call', after: { callback: true }, note: null },
      ],
    });
    const log = views.requests.items[0]!.log;
    expect(log.map((l) => l.text)).toContain('Отклонена группа ДГ-0001: не подошло время · mbv_admin');
    expect(log.map((l) => l.text)).toContain('Отмечено «нужен звонок» · mbv_admin');
    expect(log.filter((l) => l.at === '2026-10-09')).toHaveLength(2);
    expect(log).toHaveLength(3);
  });

  test('при утверждении лента не дублирует строку «Утверждена» из самой заявки', () => {
    const at = new Date('2026-10-09T10:00:00Z');
    const { views } = build({
      groups: [group({ id: 1 })],
      requests: [request({ id: 1, status: 'Исполнена', group_id: 1, final_group: 'ДГ-0001, Ведущий 1' })],
      audit: [{ entity_id: 1, at, actor: 'mbv_admin', action: 'request.approve', after: { final_group: 'ДГ-0001, Ведущий 1' }, note: null }],
    });
    const texts = views.requests.items[0]!.log.map((l) => l.text);
    expect(texts.filter((t) => t.startsWith('Утвержд'))).toEqual(['Утверждено: ДГ-0001, Ведущий 1 · mbv_admin']);
  });

  test('комментарий к отказу показывается в ленте', () => {
    const at = new Date('2026-10-09T10:00:00Z');
    const { views } = build({
      groups: [group({ id: 1 })],
      requests: [request({ id: 1, place: 'Приморский' })],
      audit: [{ entity_id: 1, at, actor: 'mbv_admin', action: 'request.reject', after: { rejected_group_id: 1, reason: 'other' }, note: 'просит группу без детей' }],
    });
    expect(views.requests.items[0]!.log.map((l) => l.text)).toContain('Отклонена группа ДГ-0001: другое («просит группу без детей») · mbv_admin');
  });
});

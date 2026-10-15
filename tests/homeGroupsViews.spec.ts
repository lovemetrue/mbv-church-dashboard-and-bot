import { addressKey } from '../src/home-groups/geocode.js';
import { describe, expect, test } from 'vitest';
import type { DashboardGroup } from '../src/db/repos/groups.repo.js';
import type { DashboardRequest } from '../src/db/repos/requests.repo.js';
import type { RegisteredParticipant } from '../src/db/repos/users.repo.js';
import type { CoordinatorRow } from '../src/db/repos/coordinators.repo.js';
import type { PlanEntry } from '../src/home-groups/plan/types.js';
import { buildViews, buildViewsWithPlan, type ViewsInput } from '../src/home-groups/api/views.js';
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
    coordinator: null, co_leader: null, co_leader_phone: null, feedback_at: null, opened_on: null, comment: null, training: null,
    format: 'Молодежная', status: 'Функционирует', checked: null, source: 'таблица', campaign_registered: false,
    do_not_refer: false, leader_user_id: null,
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
  const { views, signatures, snapshots } = buildViewsWithPlan({ ...empty, ...input }, fake.engine, NOW, options);
  return { views, signatures, snapshots, ...fake };
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
  test('координаты из кэша геокодера уходят в подбор у группы и у заявки; нет в кэше — null', () => {
    const geo = new Map([
      [addressKey('ул. Рылеева, 32')!, { lat: 59.94, lon: 30.35 }],
      [addressKey('ул. Анкетная, 2')!, { lat: 59.95, lon: 30.36 }],
      [addressKey('ул. Потерянная, 9')!, null],
    ]);
    const { calls, views } = build({
      groups: [group({ id: 1, address: 'ул. Рылеева, 32' }), group({ id: 2, address: 'ул. Потерянная, 9' }), group({ id: 3, address: null })],
      requests: [request({ id: 1, address: 'ул. Анкетная, 2', place: 'Приморский' })],
      geo,
    });
    expect(views.groups.items.map((g) => g.addressGeo)).toEqual(['found', 'missing', null]);
    // Для карты: у группы с найденным адресом точка, у остальных null.
    expect(views.groups.items.map((g) => g.coords)).toEqual([{ lat: 59.94, lon: 30.35 }, null, null]);
    expect(views.requests.items[0]!.streetGeo).toBe('found');
    // У людей то же: заявка без регистрации и регистрация с адресом показывают состояние координат.
    expect(views.people.items.find((p) => p.key === 'r1')!.addressGeo).toBe('found');
    expect(calls.plan[0]!.groups.map((g) => g.coords ?? null)).toEqual([{ lat: 59.94, lon: 30.35 }, null, null]);
    expect(calls.plan[0]!.requests[0]!.coords).toEqual({ lat: 59.95, lon: 30.36 });
  });

  test('для движка: возраст и «когда» разобраны, улица из адреса, вместимость по умолчанию', () => {
    const { calls } = build({
      groups: [group({ id: 1, age: '25-40', day: 'Вторник', time: '19:00', people: 6, metro: ' Беговая ', address: 'ул. Закрытая, 5' })],
    });
    expect(calls.plan[0]!.groups[0]).toMatchObject({
      id: 1, ageRange: [25, 40], day: 'Вт', slot: 'вечер', street: 'закрытая', people: 6, capacity: 10, metro: 'Беговая',
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

  test('адрес группы в ответе есть, а телефон второго ведущего не попадает', () => {
    const { views } = build({
      groups: [group({ id: 1, address: 'ул. Секретная, 1, кв. 5', co_leader_phone: '+79990001122' })],
      requests: [request({ id: 1, address: 'ул. Анкетная, 2', schedule: 'по вечерам' })],
      participants: [participant({ id: 1 })],
    });
    const json = JSON.stringify(views);
    expect(views.groups.items[0]!.address).toBe('ул. Секретная, 1, кв. 5');
    expect(json).not.toContain('79990001122');
  });

  test('адрес из анкеты виден в заявке и в карточке человека (адрес и место как написал), но не уходит в группы и «сегодня»', () => {
    const { views } = build({
      groups: [group({ id: 1 })],
      requests: [request({ id: 1, address: 'ул. Анкетная, 2', place: 'Приморский', schedule: 'по вечерам' })],
      participants: [participant({ id: 1, address: 'пр. Участников, 7', location: 'Беговая' })],
    });
    const { requests, people, ...rest } = views;
    expect(JSON.stringify(rest)).not.toContain('Анкетная');
    expect(JSON.stringify(rest)).not.toContain('Участников');
    const item = requests.items[0]!;
    expect(item.streetInfo).toEqual({ text: 'ул. Анкетная, 2', source: 'anketa' });
    expect(item.original).toContainEqual({ label: 'Улица и дом', value: 'ул. Анкетная, 2' });
    expect(people.items.find((p) => p.key === 'u1')).toMatchObject({ address: 'пр. Участников, 7', place: 'Беговая' });
    expect(people.items.find((p) => p.key === 'r1')).toMatchObject({ address: 'ул. Анкетная, 2', place: 'Приморский' });
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
      key: 'u12', strange: null, personId: null, groups: [], fio: 'Дарья Ефимова', phone: '+7 911 123-45-67', ageLabel: '26-35', district: 'Невский',
      place: 'Ломоносовская', address: null, schedule: null, hobby: null, profession: null, family: null, note: null, addressGeo: null, from: 'Бот · MAX', mdgLabel: 'Хочет в группу', date: '2026-09-12', requestId: 40, userId: 12, registrationNo: 12,
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
      key: 'r7', strange: null, personId: null, groups: [], fio: 'Станислав Ким', phone: '+7 904 123-45-67', ageLabel: '26-35', district: 'Приморский',
      place: 'Приморский', address: null, schedule: null, hobby: null, profession: null, family: null, note: null, addressGeo: null, from: 'Таблица', mdgLabel: 'Заявка: готово к утверждению', date: '2026-10-02', requestId: 7, userId: null, registrationNo: null,
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


describe('накопленные предложения и счётчик участников', () => {
  test('сохранённое предложение закрепляется за заявкой: движок получает его группу как выбор', () => {
    const { calls } = build({
      groups: [group({ id: 1 }), group({ id: 2 })],
      requests: [request({ id: 7, place: 'Приморский' })],
      activeProposals: new Map([[7, { groupId: 2, source: 'script' }]]),
    });
    expect(calls.plan[0]!.requests.find((r) => r.id === 7)!.pinnedGroupId).toBe(2);
  });

  test('источник предложения берётся из сохранённого, если показана та же группа', () => {
    const { views } = build({
      groups: [group({ id: 1 })],
      requests: [request({ id: 7, place: 'Приморский' })],
      activeProposals: new Map([[7, { groupId: 1, source: 'agent' }]]),
    });
    expect(views.requests.items[0]!.proposal?.source).toBe('agent');
  });

  test('если показана другая группа, чем сохранённая, источник — расчёт', () => {
    const { views } = build({
      groups: [group({ id: 1 })],
      requests: [request({ id: 7, place: 'Приморский' })],
      activeProposals: new Map([[7, { groupId: 99, source: 'agent' }]]),
    });
    expect(views.requests.items[0]!.proposal?.source).toBe('script');
  });

  test('утверждённые сервисом после обратной связи добавляются к числу участников группы', () => {
    const { views, calls } = build({
      groups: [group({ id: 1, people: 5 }), group({ id: 2, people: 3 }), group({ id: 3, people: null })],
      requests: [],
      placedNew: new Map([[1, 2], [3, 1]]),
    });
    const items = new Map(views.groups.items.map((g) => [g.id, g]));
    expect(items.get(1)).toMatchObject({ people: 7, placedNew: 2, free: 3 });
    expect(items.get(2)).toMatchObject({ people: 3, placedNew: 0 });
    // Число неизвестно, но один человек сервисом точно утверждён: известно «не меньше одного».
    expect(items.get(3)).toMatchObject({ people: 1, placedNew: 1 });
    expect(calls.plan[0]!.groups.find((g) => g.id === 1)!.people).toBe(7);
  });

  test('здоровье группы по-прежнему считает число участников указанным только если его указал ведущий', () => {
    const { views } = build({
      groups: [group({ id: 3, people: null })],
      placedNew: new Map([[3, 1]]),
    });
    const health = views.groups.items[0]!.health.items.find((i) => i.label === 'Число участников указано')!;
    expect(health.ok).toBe(false);
  });

  test('«ждут подбора» — открытые заявки с предложением, которого ещё нет в сохранённых', () => {
    const { views } = build({
      groups: [group({ id: 1 })],
      requests: [
        request({ id: 1, place: 'Приморский' }),
        request({ id: 2, place: 'Приморский' }),
        request({ id: 3, place: 'Приморский' }),
        request({ id: 4, place: 'Приморский', status: 'Исполнена', group_id: 1 }),
      ],
      activeProposals: new Map([[1, { groupId: 1, source: 'script' }]]),
    });
    // Заявка 1 уже сохранена; 2 и 3 — нет; закрытая 4 не считается.
    expect(views.requests.matching.waiting).toBeLessThanOrEqual(2);
    expect(views.requests.matching.waiting).toBeGreaterThanOrEqual(1);
  });

  test('сведения о подборе (автоматический ли, последний запуск) приходят из настроек', () => {
    const lastRun = { at: '2026-10-10T08:00:00.000Z', created: 3, replaced: 1, actor: 'mbv_admin' };
    const { views } = build({ matching: { auto: true, lastRun } });
    expect(views.requests.matching).toMatchObject({ auto: true, lastRun });
  });

  test('без настроек подбор выключен и запусков не было', () => {
    const { views } = build({});
    expect(views.requests.matching).toEqual({ auto: false, lastRun: null, waiting: 0, saved: 0 });
  });
});


describe('удобное время, улица и «заявка как пришла»', () => {
  test('удобное время из анкеты разбирается на дни и время суток, улица берётся из анкеты', () => {
    const { views } = build({
      groups: [group({ id: 1 })],
      requests: [request({ id: 1, place: 'Приморский', schedule: 'пн, ср - с 17 до 22 часов', address: 'ул. Рылеева 32' })],
    });
    const item = views.requests.items[0]!;
    expect(item).toMatchObject({ days: ['Пн', 'Ср'], slot: 'вечер', street: 'ул. Рылеева 32' });
    expect(item.scheduleInfo).toEqual({ text: 'пн, ср - с 17 до 22 часов', source: 'anketa' });
    expect(item.dataFill).toEqual([true, false, true, true]);
  });

  test('правка координатора важнее анкеты и помечена как ручная', () => {
    const { views, calls } = build({
      groups: [group({ id: 1 })],
      requests: [request({ id: 1, place: 'Приморский', schedule: 'вечером', manual_schedule: 'вторник утром', address: 'ул. Анкетная', manual_street: 'пр. Ручной 5' })],
    });
    const item = views.requests.items[0]!;
    expect(item.scheduleInfo).toEqual({ text: 'вторник утром', source: 'manual' });
    expect(item.streetInfo).toEqual({ text: 'пр. Ручной 5', source: 'manual' });
    expect(item).toMatchObject({ days: ['Вт'], slot: 'утро', street: 'пр. Ручной 5' });
    expect(calls.plan[0]!.requests[0]).toMatchObject({ days: ['Вт'], slot: 'утро', street: 'пр. Ручной 5' });
  });

  test('пустая правка не перекрывает анкету; нет ни того ни другого — источник не указан', () => {
    const { views } = build({
      requests: [
        request({ id: 1, schedule: 'вечером', manual_schedule: '   ' }),
        request({ id: 2 }),
      ],
    });
    const byId = new Map(views.requests.items.map((i) => [i.id, i]));
    expect(byId.get(1)!.scheduleInfo).toEqual({ text: 'вечером', source: 'anketa' });
    expect(byId.get(2)!.scheduleInfo).toEqual({ text: null, source: null });
    expect(byId.get(2)!.streetInfo).toEqual({ text: null, source: null });
  });

  test('неразобранное время остаётся «не знаю», а текст сохраняется для показа', () => {
    const { views } = build({ requests: [request({ id: 1, schedule: 'как получится' })] });
    expect(views.requests.items[0]).toMatchObject({ days: [], slot: null });
    expect(views.requests.items[0]!.scheduleInfo.text).toBe('как получится');
  });

  test('«как пришла»: только то, что заполнил человек, без заметок служителей, пустое не показывается', () => {
    const { views } = build({
      requests: [request({
        id: 1, fio: 'Мария Иванова', phone: '+79991112233', phones: ['+79991112233'], age: '26-35', place: 'Приморский, м. Пионерская',
        church: 'Основная', mdg_status: 'join', leader_name: null, schedule: 'вечером', address: null, text: null,
        note: 'внутренняя заметка служителя', extra: 'ещё заметка',
      })],
    });
    const labels = views.requests.items[0]!.original.map((f) => f.label);
    expect(labels).toEqual(['ФИО', 'Телефон', 'Возраст', 'Район и метро (как написал)', 'Церковь', 'Ответ про малую группу', 'Удобные дни и время']);
    expect(JSON.stringify(views.requests.items[0]!.original)).not.toContain('заметка');
    expect(views.requests.items[0]!.original.find((f) => f.label === 'Ответ про малую группу')!.value).toBe('Хочет в группу');
  });

  test('заявка без данных анкеты (из таблицы) — original содержит только ФИО', () => {
    const { views } = build({ requests: [request({ id: 1, fio: 'Из Таблицы' })] });
    expect(views.requests.items[0]!.original).toEqual([{ label: 'ФИО', value: 'Из Таблицы' }]);
  });

  test('уточнение параметров попадает в ленту заявки без текста улицы', () => {
    const at = new Date('2026-10-09T10:00:00Z');
    const { views } = build({
      requests: [request({ id: 1 })],
      audit: [{ entity_id: 1, at, actor: 'mbv_admin', action: 'request.params', after: { street: true, schedule: true }, note: null }],
    });
    expect(views.requests.items[0]!.log.map((l) => l.text)).toContain('Уточнено вручную: улица, удобное время · mbv_admin');
  });

  test('новой считается только действующая группа с недавней датой открытия: «Кампания» без даты и обычная старая — нет', () => {
    const { views } = build({ groups: [group({ id: 1, status: 'Кампания' }), group({ id: 2 }), group({ id: 3, opened_on: '2026-10-01' })] });
    const byId = new Map(views.groups.items.map((g) => [g.id, g]));
    expect(byId.get(1)!.isNew).toBe(false);
    expect(byId.get(2)!.isNew).toBe(false);
    expect(byId.get(3)!.isNew).toBe(true);
  });
});

describe('закрепление и «утверждено сегодня»', () => {
  test('предложение помечено закреплённым, только если сохранено именно на показанную группу; счётчики сходятся', () => {
    const { views } = build({
      groups: [group({ id: 1 }), group({ id: 2 })],
      requests: [request({ id: 1, place: 'Приморский' }), request({ id: 2, place: 'Приморский' }), request({ id: 3, place: 'Приморский' })],
      activeProposals: new Map([[1, { groupId: 1, source: 'script' }], [2, { groupId: 99, source: 'script' }]]),
    });
    const byId = new Map(views.requests.items.map((i) => [i.id, i]));
    expect(byId.get(1)!.proposal!.saved).toBe(true);
    expect(byId.get(2)!.proposal!.saved).toBe(false);
    expect(byId.get(3)!.proposal!.saved).toBe(false);
    expect(views.requests.matching.saved).toBe(1);
    expect(views.requests.matching.waiting).toBe(2);
  });

  test('«утверждено сегодня» считает утверждения этого дня по поясу сервиса, а не вчерашние и не другие действия', () => {
    const approve = (iso: string, id: number) => ({ entity_id: id, at: new Date(iso), actor: 'a', action: 'request.approve', after: null, note: null });
    const { views } = build({
      requests: [request({ id: 1 }), request({ id: 2 }), request({ id: 3 }), request({ id: 4 })],
      audit: [
        approve('2026-10-10T07:00:00Z', 1),
        approve('2026-10-10T08:30:00Z', 2),
        approve('2026-10-09T20:59:00Z', 3),
        { entity_id: 4, at: new Date('2026-10-10T08:00:00Z'), actor: 'a', action: 'request.reject', after: null, note: null },
      ],
    });
    // «Сейчас» в тестах — 12:00 по Москве 10 октября; 09.10 в 23:59 по Москве — уже вчера.
    expect(views.today.approvedToday).toBe(2);
  });
});


describe('закрепление и изменившиеся данные', () => {
  test('данные заявки изменились после закрепления: предложение не закреплено, помечено «данные изменились», группа не удерживается', () => {
    const { views, calls } = build({
      groups: [group({ id: 1 }), group({ id: 2 })],
      requests: [request({ id: 7, place: 'Приморский' })],
      activeProposals: new Map([[7, { groupId: 2, source: 'script', inputHash: 'старый-отпечаток' }]]),
    });
    const item = views.requests.items[0]!;
    expect(item.proposal).toMatchObject({ saved: false, dataChanged: true });
    expect(calls.plan[0]!.requests[0]!.pinnedGroupId).toBeNull();
    expect(views.requests.matching).toMatchObject({ saved: 0, waiting: 1 });
  });

  test('отпечаток совпал: предложение закреплено и удерживается, без пометки об изменении', () => {
    const first = build({ groups: [group({ id: 1 })], requests: [request({ id: 7, place: 'Приморский' })] });
    const signature = [...first.signatures.values()][0]!;
    const { views, calls } = build({
      groups: [group({ id: 1 }), group({ id: 2 })],
      requests: [request({ id: 7, place: 'Приморский' })],
      activeProposals: new Map([[7, { groupId: 1, source: 'script', inputHash: signature }]]),
    });
    expect(views.requests.items[0]!.proposal).toMatchObject({ saved: true, dataChanged: false });
    expect(calls.plan[0]!.requests[0]!.pinnedGroupId).toBe(1);
  });

  test('у предложения без отпечатка (закреплено до этой версии) данные считаются неизменными', () => {
    const { views } = build({
      groups: [group({ id: 1 })],
      requests: [request({ id: 7, place: 'Приморский' })],
      activeProposals: new Map([[7, { groupId: 1, source: 'script', inputHash: null }]]),
    });
    expect(views.requests.items[0]!.proposal).toMatchObject({ saved: true, dataChanged: false });
  });

  test('заявка без закрепления: dataChanged = false', () => {
    const { views } = build({ groups: [group({ id: 1 })], requests: [request({ id: 7, place: 'Приморский' })] });
    expect(views.requests.items[0]!.proposal).toMatchObject({ saved: false, dataChanged: false });
  });

  test('что изменилось: по снимку у предложения видно «было → стало» для каждого изменившегося поля', () => {
    const first = build({ groups: [group({ id: 1 })], requests: [request({ id: 7, place: 'Приморский' })] });
    const before = first.snapshots.get(7)!;
    const { views } = build({
      groups: [group({ id: 1 })],
      requests: [request({ id: 7, place: 'Приморский', age: '40-55', schedule: null })],
      // Снимок у предложения: район тот же, а возраст в заявке тогда не был известен — стал известен после правки.
      activeProposals: new Map([[7, { groupId: 1, source: 'script', inputHash: 'устарел', inputSnapshot: { ...before, street: 'ул. Старая 1' } }]]),
    });
    const changes = views.requests.items[0]!.proposal!.changes!;
    expect(changes.map((c) => [c.field, c.before])).toEqual(expect.arrayContaining([['Улица', 'ул. Старая 1']]));
    expect(changes.every((c) => c.before !== c.after)).toBe(true);
  });

  test('если снимка нет (предложение сохранено раньше) или данные не менялись, список изменений — null', () => {
    const noSnapshot = build({
      groups: [group({ id: 1 })], requests: [request({ id: 7, place: 'Приморский' })],
      activeProposals: new Map([[7, { groupId: 1, source: 'script', inputHash: 'устарел', inputSnapshot: null }]]),
    });
    expect(noSnapshot.views.requests.items[0]!.proposal).toMatchObject({ dataChanged: true, changes: null });
    const same = build({ groups: [group({ id: 1 })], requests: [request({ id: 7, place: 'Приморский' })] });
    expect(same.views.requests.items[0]!.proposal).toMatchObject({ dataChanged: false, changes: null });
  });

  test('участник отдаёт id и номер регистрации; строка из заявки — только id участника', () => {
    const { views } = build({
      participants: [participant({ id: 3, registration_no: 41 })],
      requests: [request({ id: 9, user_id: null })],
    });
    expect(views.people.items.find((p) => p.key === 'u3')).toMatchObject({ userId: 3, registrationNo: 41 });
    expect(views.people.items.find((p) => p.key === 'r9')).toMatchObject({ userId: null, registrationNo: null });
  });
});

describe('сводка команды в представлениях', () => {
  test('сводка строится из тех же заявок и действий за неделю, что пришли в загрузку', () => {
    const { views } = build({
      requests: [request({ id: 1, responsible: 'Анна' }), request({ id: 2 })],
      activity: [{ actor: 'anna', action: 'request.call', n: 2 }],
    });
    expect(views.team.totals).toMatchObject({ open: 2, unassigned: 1 });
    expect(views.team.activity).toEqual([{ actor: 'anna', calls: 2, approved: 0, rejected: 0, edits: 0, assigned: 0 }]);
  });
});

describe('метка «Странный человек»', () => {
  const mark = (by = 'anna', note: string | null = null) => ({ by, at: new Date('2026-10-12T08:00:00Z'), note });
  const withMarks = (entries: [string, ReturnType<typeof mark>][]) => ({ strange: new Map(entries) });

  test('метка регистрации видна на заявке, в «Людях» и в составе группы', () => {
    const { views } = build({
      groups: [group({ id: 5 })],
      participants: [participant({ id: 9, full_name: 'Отмеченный' })],
      requests: [request({ id: 1, user_id: 9, status: 'Исполнена', group_id: 5 })],
      ...withMarks([['u9', mark('anna', 'говорит сам с собой')]]),
    });
    const expected = { by: 'anna', at: '2026-10-12T08:00:00.000Z', note: 'говорит сам с собой' };
    expect(views.requests.items.find((i) => i.id === 1)!.strange).toEqual(expected);
    expect(views.people.items.find((p) => p.key === 'u9')!.strange).toEqual(expected);
    expect(views.groups.items.find((g) => g.id === 5)!.members[0]!.strange).toEqual(expected);
  });

  test('у заявки без регистрации метка лежит на самой заявке (ключ r<номер>), «Другие обращения» её тоже видят', () => {
    const { views } = build({
      requests: [request({ id: 3 }), request({ id: 4, type: 'question' })],
      ...withMarks([['r3', mark()], ['r4', mark()]]),
    });
    expect(views.requests.items.find((i) => i.id === 3)!.strange).toMatchObject({ by: 'anna' });
    expect(views.people.items.find((p) => p.key === 'r3')!.strange).toMatchObject({ by: 'anna' });
    expect(views.requests.others.find((o) => o.id === 4)!.strange).toMatchObject({ by: 'anna' });
  });

  test('без метки поле пустое', () => {
    const { views } = build({ requests: [request({ id: 1 })], participants: [participant({ id: 9 })] });
    expect(views.requests.items[0]!.strange).toBeNull();
    expect(views.people.items.find((p) => p.key === 'u9')!.strange).toBeNull();
  });

  test('метка действует и на тот же телефон в другой записи: человек один, а записей у него несколько', () => {
    const { views } = build({
      participants: [participant({ id: 9, phone: '+79111234567' })],
      requests: [request({ id: 1, phone: '+7 911 123-45-67', phones: ['+7 911 123-45-67'] })],
      ...withMarks([['u9', mark('boris')]]),
    });
    expect(views.requests.items.find((i) => i.id === 1)!.strange).toMatchObject({ by: 'boris' });
  });

  test('заявка с меткой не попадает в расчёт групп и не занимает места, ей показано «нужна отдельная группа»', () => {
    const { views, calls } = build({
      groups: [group({ id: 5, district: 'Приморский' })],
      requests: [request({ id: 1, place: 'Приморский' }), request({ id: 2, place: 'Приморский' })],
      ...withMarks([['r1', mark()]]),
    });
    expect(calls.plan[0]!.requests.map((r) => r.id)).toEqual([2]);
    const marked = views.requests.items.find((i) => i.id === 1)!;
    expect(marked.proposal).toBeNull();
    expect(marked.noPlan).toMatchObject({ code: 'strange' });
    expect(marked.noPlan!.reason).toMatch(/отдельная группа/);
    expect(marked.bucket).toBe('human');
    expect(views.requests.items.find((i) => i.id === 2)!.proposal).not.toBeNull();
    // В сводку спроса по обычным группам тоже не попадает.
    expect(calls.summary[0]!.requests.map((r) => r.id)).toEqual([2]);
  });

  test('закрытая заявка с меткой остаётся закрытой: метка не возвращает её в «нужна помощь»', () => {
    const { views } = build({
      requests: [request({ id: 1, status: 'Исполнена' })],
      ...withMarks([['r1', mark()]]),
    });
    expect(views.requests.items.find((i) => i.id === 1)!.bucket).toBe('done');
  });

  test('в ленте заявки видно, кто и когда поставил или снял метку', () => {
    const { views } = build({
      requests: [request({ id: 1 })],
      audit: [
        { id: 1, actor: 'anna', action: 'request.strange', entity_type: 'request', entity_id: 1, at: new Date('2026-10-12T08:00:00Z'), before: null, after: { value: true }, note: null },
        { id: 2, actor: 'boris', action: 'request.strange', entity_type: 'request', entity_id: 1, at: new Date('2026-10-12T09:00:00Z'), before: null, after: { value: false }, note: null },
      ] as never,
    });
    const log = views.requests.items.find((i) => i.id === 1)!.log.map((l) => l.text);
    expect(log).toContain('Отмечено «странный человек» · anna');
    expect(log).toContain('Метка «странный человек» снята · boris');
  });
});

describe('остальные обращения: суть и разбор по справочникам', () => {
  const groups = [group({ id: 5, leader: 'Малявин Павел' }), group({ id: 6, leader: 'Родионов Давид' }), group({ id: 7, leader: 'Родионов Давид' })];

  test('у каждого обращения есть суть одной фразой', () => {
    const { views } = build({ requests: [request({ id: 1, type: 'already_member', user_id: 9, leader_name: 'Малявин Павел', church: 'МБВ Колизей' })], groups });
    expect(views.requests.others[0]!.gist).toBe('Говорит, что уже состоит в Малой группе. Ведущий: Малявин Павел. Церковь: МБВ Колизей.');
  });

  test('«уже состоит»: группа по ведущему найдена, у ведущего с двумя группами нужен выбор, чужого ведущего нет', () => {
    const { views } = build({
      groups,
      requests: [
        request({ id: 1, type: 'already_member', user_id: 9, leader_name: 'Павел Малявин' }),
        request({ id: 2, type: 'already_member', user_id: 10, leader_name: 'Родионов Давид' }),
        request({ id: 3, type: 'already_member', user_id: 11, leader_name: 'Никто Неизвестный' }),
        request({ id: 4, type: 'already_member', user_id: 12 }),
      ],
    });
    const by = (id: number) => views.requests.others.find((o) => o.id === id)!.reconcile!;
    expect(by(1)).toMatchObject({ kind: 'member', status: 'ready', candidates: [{ groupId: 5, code: 'ДГ-0005' }] });
    expect(by(2)).toMatchObject({ status: 'choose', candidates: [{ groupId: 6 }, { groupId: 7 }] });
    expect(by(3).status).toBe('none');
    expect(by(4).status).toBe('noleader');
  });

  test('разбора нет у вопросов и «хочет открыть», у закрытых и у людей без регистрации он «нет регистрации»', () => {
    const { views } = build({
      groups,
      requests: [
        request({ id: 1, type: 'question' }),
        request({ id: 2, type: 'lead_group', user_id: 3 }),
        request({ id: 3, type: 'already_member', user_id: 9, leader_name: 'Павел Малявин', status: 'Исполнена' }),
        request({ id: 4, type: 'already_member', user_id: null, leader_name: 'Павел Малявин' }),
      ],
    });
    const by = (id: number) => views.requests.others.find((o) => o.id === id)!.reconcile;
    expect(by(1)).toBeNull();
    expect(by(2)).toBeNull();
    expect(by(3)).toBeNull();
    expect(by(4)!.status).toBe('nouser');
  });

  test('в карточке группы виден ведущий как ссылка на человека', () => {
    const { views } = build({ groups: [group({ id: 5, leader_user_id: 12 }), group({ id: 6 })] });
    expect(views.groups.items.find((g) => g.id === 5)!.leaderKey).toBe('u12');
    expect(views.groups.items.find((g) => g.id === 6)!.leaderKey).toBeNull();
  });
});

describe('остальные обращения', () => {
  test('«готов открыть» и вопросы не идут в подбор, а попадают в отдельный список с подписью вида', () => {
    const { views } = build({
      requests: [
        request({ id: 1 }),
        request({ id: 2, type: 'lead_group', fio: 'Хочет открыть' }),
        request({ id: 3, type: 'question', fio: 'С вопросом' }),
      ],
    });
    expect(views.requests.items.map((i) => i.id)).toEqual([1]);
    expect(views.requests.others.map((o) => [o.id, o.typeLabel, o.state])).toEqual([
      [2, 'Хочет открыть группу или дать дом', 'open'], [3, 'Вопрос служителю', 'open'],
    ]);
    expect(views.team.totals.otherOpen).toBe(2);
  });

  test('аннулированная заявка «хочу в группу» остаётся доступной в списке остальных, чтобы вернуть её в работу', () => {
    const { views } = build({ requests: [request({ id: 1, status: 'Аннулирована', cancel_reason: 'Дубль заявки' })] });
    expect(views.requests.items).toEqual([]);
    expect(views.requests.others).toMatchObject([{ id: 1, state: 'cancelled', cancelReason: 'Дубль заявки' }]);
  });

  test('открытые идут первыми: сначала те, кому надо перезвонить, потом давно ждущие; закрытых не больше двухсот', () => {
    const closed = Array.from({ length: 250 }, (_, i) => request({ id: 1000 + i, type: 'question', status: 'Исполнена' }));
    const { views } = build({
      requests: [
        request({ id: 1, type: 'question', date: '2026-10-09' }),
        request({ id: 2, type: 'question', date: '2026-09-01' }),
        request({ id: 3, type: 'question', date: '2026-10-09', callback: true }),
        ...closed,
      ],
    });
    expect(views.requests.others.slice(0, 3).map((o) => o.id)).toEqual([3, 2, 1]);
    expect(views.requests.others).toHaveLength(3 + 200);
    expect(views.requests.others.at(3)!.id).toBe(1249);
  });

  test('закрытие и возврат в работу попадают в ленту текстом', () => {
    const at = new Date('2026-10-09T10:00:00Z');
    const { views } = build({
      requests: [request({ id: 1 })],
      audit: [
        { entity_id: 1, at, actor: 'anna', action: 'request.close', after: { outcome: 'cancel', reason: 'no_answer' }, note: 'трубку не берут' },
        { entity_id: 1, at, actor: 'anna', action: 'request.close', after: { outcome: 'done' }, note: null },
        { entity_id: 1, at, actor: 'boris', action: 'request.reopen', after: { status: 'В работе' }, note: null },
      ],
    });
    expect(views.requests.items[0]!.log.map((l) => l.text)).toEqual(expect.arrayContaining([
      'Аннулирована: не отвечают («трубку не берут») · anna', 'Отмечена обработанной · anna', 'Возвращена в работу · boris',
    ]));
  });
});

describe('разбор помощника в представлениях', () => {
  const hint = (over: Partial<import('../src/db/repos/hints.repo.js').StoredHint> = {}) => ({
    district: 'Приморский', age: null, days: [], slot: null, questions: [], baseHash: '', ...over,
  });
  const hashOf = async (place: string | null, age: string | null, schedule: string | null) =>
    (await import('../src/home-groups/assistant/brief.js')).baseHash({ place, age, schedule });

  test('район, который не понял скрипт, подставляется из разбора, а карточка помечает «определил помощник»', async () => {
    const place = 'где-то у чёрной речки';
    const { views } = build({
      groups: [group({ id: 1, district: 'Приморский' })],
      requests: [request({ id: 1, place, age: '30' })],
      hints: new Map([[1, hint({ baseHash: await hashOf(place, '30', null), questions: ['Какой район вам ближе?'] })]]),
    });
    const item = views.requests.items[0]!;
    expect(item.district).toBe('Приморский');
    expect(item.assistant).toEqual({ filled: ['район'], questions: ['Какой район вам ближе?'] });
    expect(item.proposal?.main.group.id).toBe(1);
  });

  test('разбор не перекрывает то, что скрипт понял сам', async () => {
    const place = 'Приморский район';
    const { views } = build({
      groups: [group({ id: 1, district: 'Приморский' })],
      requests: [request({ id: 1, place })],
      hints: new Map([[1, hint({ district: 'Невский', baseHash: await hashOf(place, null, null), questions: ['Вопрос про время есть?'] })]]),
    });
    const item = views.requests.items[0]!;
    expect(item.district).toBe('Приморский');
    expect(item.assistant).toEqual({ filled: [], questions: ['Вопрос про время есть?'] });
  });

  test('если запись изменили после разбора, разбор не применяется', async () => {
    const { views } = build({
      groups: [group({ id: 1, district: 'Приморский' })],
      requests: [request({ id: 1, place: 'новое непонятное место' })],
      hints: new Map([[1, hint({ baseHash: await hashOf('старое место', null, null) })]]),
    });
    expect(views.requests.items[0]!.district).toBeNull();
    expect(views.requests.items[0]!.assistant).toBeNull();
    expect(views.requests.assistant.pending).toBe(1);
  });

  test('«может разобрать»: только открытые заявки с непонятным текстом и без разбора', async () => {
    const place = 'у чёрной речки';
    const { views } = build({
      requests: [
        request({ id: 1, place }),
        request({ id: 2, place: 'Приморский район' }),
        request({ id: 3, place: null }),
        request({ id: 4, place, status: 'Исполнена' }),
        request({ id: 5, place }),
      ],
      hints: new Map([[5, hint({ baseHash: await hashOf(place, null, null) })]]),
      assistant: { available: true, enabled: true },
    });
    expect(views.requests.assistant).toEqual({ available: true, enabled: true, pending: 1 });
  });

  test('время из разбора подставляется, только когда скрипт его не понял', async () => {
    const schedule = 'как получится, по настроению';
    const { views } = build({
      requests: [request({ id: 1, place: 'Приморский район', schedule })],
      hints: new Map([[1, hint({ district: null, days: ['Пн', 'Вт', 'Чт', 'Пт'], slot: 'вечер', baseHash: await hashOf('Приморский район', null, schedule) })]]),
    });
    const item = views.requests.items[0]!;
    expect(item.assistant?.filled).toEqual(['время']);
    expect(item.days).toEqual(['Пн', 'Вт', 'Чт', 'Пт']);
    expect(item.slot).toBe('вечер');
  });
});

describe('состав групп', () => {
  const manual = (id: number, groupId: number, personKey: string, fio: string, phone: string | null = null, joined: string | null = null) =>
    ({ id, group_id: groupId, personKey, full_name: fio, phone, joined_on: joined, note: null });

  test('утверждённые в группу появляются в её составе сами, внесённые вручную идут следом', () => {
    const at = new Date('2026-10-09T10:00:00Z');
    const { views } = build({
      groups: [group({ id: 1 })],
      requests: [request({ id: 1, status: 'Исполнена', group_id: 1, fio: 'Анна Утверждённая', phone: '+79215550011' })],
      audit: [{ entity_id: 1, at, actor: 'a', action: 'request.approve', after: { group_id: 1 }, note: null }],
      members: [manual(7, 1, 'u5', 'Борис Вручную', null, '2026-09-01')],
    });
    expect(views.groups.items[0]!.members).toEqual([
      { kind: 'placed', id: 1, personKey: 'r1', fio: 'Анна Утверждённая', phone: '+7 921 555-00-11', date: '2026-10-09', note: null, alsoIn: [], strange: null },
      { kind: 'manual', id: 7, personKey: 'u5', fio: 'Борис Вручную', phone: null, date: '2026-09-01', note: null, alsoIn: [], strange: null },
    ]);
  });

  test('заявки не в статусе «Исполнена» и без группы в состав не попадают', () => {
    const { views } = build({
      groups: [group({ id: 1 })],
      requests: [request({ id: 1, status: 'Новая', group_id: 1 }), request({ id: 2, status: 'Исполнена', group_id: null }), request({ id: 3, status: 'Аннулирована', group_id: 1 })],
    });
    expect(views.groups.items[0]!.members).toEqual([]);
  });

  test('человек и утверждён, и внесён вручную в одну группу — в составе одна строка, ручная', () => {
    const { views } = build({
      groups: [group({ id: 1 })],
      requests: [request({ id: 1, user_id: 5, status: 'Исполнена', group_id: 1, fio: 'Мария' })],
      members: [manual(7, 1, 'u5', 'Мария', null, '2026-09-01')],
    });
    expect(views.groups.items[0]!.members.map((m) => m.kind)).toEqual(['manual']);
  });

  test('человек в нескольких группах помечается: по телефону, а без телефона — по ключу справочника', () => {
    const { views } = build({
      groups: [group({ id: 1 }), group({ id: 2 }), group({ id: 3 })],
      requests: [request({ id: 1, status: 'Исполнена', group_id: 1, fio: 'Анна Смирнова', phone: '+79215550011' })],
      members: [
        manual(1, 2, 'p1', 'А. Смирнова', '8 921 555-00-11'),
        manual(2, 3, 'u9', 'Другая Анна'),
        manual(3, 2, 'u7', 'Пётр Один'),
        manual(4, 3, 'u7', 'Пётр Один'),
      ],
    });
    const byGroup = (id: number) => views.groups.items.find((g) => g.id === id)!.members.map((m) => [m.fio, m.alsoIn]);
    expect(byGroup(1)).toEqual([['Анна Смирнова', ['ДГ-0002']]]);
    expect(byGroup(2)).toEqual([['А. Смирнова', ['ДГ-0001']], ['Пётр Один', ['ДГ-0003']]]);
    expect(byGroup(3)).toEqual([['Другая Анна', []], ['Пётр Один', ['ДГ-0002']]]);
  });

  test('карточки людей, внесённые вручную, попадают в справочник «Люди» с группами, где они состоят', () => {
    const { views } = build({
      groups: [group({ id: 1 })],
      members: [manual(1, 1, 'p3', 'Анна Новая', '+79215550011')],
      persons: [{ id: 3, full_name: 'Анна Новая', phone: '+79215550011', age: '35', place: 'Приморский', note: null, created_at: new Date('2026-10-01T10:00:00Z') }],
    });
    expect(views.people.items.find((p) => p.key === 'p3')).toMatchObject({
      personId: 3, fio: 'Анна Новая', phone: '+7 921 555-00-11', ageLabel: '35', district: 'Приморский', from: 'Внесён вручную', groups: ['ДГ-0001'],
    });
  });
});

describe('день недели, время и улица: что уходит в подбор', () => {
  test('«по средам вечером» из анкеты становится днём и временем суток заявки', () => {
    const { calls } = build({ requests: [request({ id: 1, place: 'Приморский', schedule: 'по средам вечером' })] });
    expect(calls.plan[0]!.requests[0]).toMatchObject({ days: ['Ср'], slot: 'вечер', avoidDays: [], avoidSlots: [] });
  });

  test('«кроме воскресенья» уходит в подбор как неподходящий день, а не как удобный', () => {
    const { calls, signatures } = build({ requests: [request({ id: 1, place: 'Приморский', schedule: 'кроме воскресенья, вечером' })] });
    expect(calls.plan[0]!.requests[0]).toMatchObject({ days: [], slot: 'вечер', avoidDays: ['Вс'] });
    const without = build({ requests: [request({ id: 1, place: 'Приморский', schedule: 'вечером' })] });
    // Неподходящий день входит в отпечаток: заявка с другим «не подходит» пересчитывается.
    expect(signatures.get(1)).not.toBe(without.signatures.get(1));
  });

  test('понятое скриптом («кроме воскресенья») помощнику не отдаётся: ему остаётся только непонятное', () => {
    const fake = createFakeEngine();
    const withAvoid = buildViewsWithPlan({ ...empty, requests: [request({ id: 1, schedule: 'кроме воскресенья' })] }, fake.engine, NOW);
    expect(withAvoid.assistantCandidates).toEqual([]);
    const unclear = buildViewsWithPlan({ ...empty, requests: [request({ id: 2, schedule: 'как получится, по настроению' })] }, fake.engine, NOW);
    expect(unclear.assistantCandidates.map((c) => c.id)).toEqual([2]);
  });

  test('адрес группы идёт в подбор названием улицы без дома и виден в справочнике', () => {
    const input = { groups: [group({ id: 1, address: 'ул. Рылеева, д. 32, кв. 5' })], requests: [request({ id: 1, place: 'Приморский', address: 'Рылеева 30' })] };
    const out = build(input);
    expect(out.calls.plan[0]!.groups[0]!.street).toBe('рылеева');
    expect(out.views.groups.items[0]!.address).toBe('ул. Рылеева, д. 32, кв. 5');
  });

});

describe('значки групп: зелёный и оранжевый росток', () => {
  const items = (groups: DashboardGroup[]) => new Map(build({ groups }).views.groups.items.map((g) => [g.id, g]));
  // «Сегодня» 2026-10-10: открытая 11 июня ещё в первых четырёх месяцах (они кончатся 11 октября), открытая 10 июня — уже нет.

  test('росток только у «Функционирует»: потенциальная, на паузе, кампания и закрытая его не получают, даже со свежей датой', () => {
    const m = items(['Потенциальная', 'На паузе', 'Кампания', 'Закрыта', 'Недвижимость', 'Функционирует'].map((status, i) => group({ id: i + 1, status, opened_on: '2026-09-01', people: 0 })));
    expect([...m.values()].map((g) => [g.status, g.isNew, g.empty])).toEqual([
      ['Потенциальная', false, false],
      ['На паузе', false, false],
      ['Кампания', false, false],
      ['Закрыта', false, false],
      ['Недвижимость', false, false],
      ['Функционирует', true, false],
    ]);
  });

  test('первые четыре месяца после открытия росток у всех, сколько бы ни было людей, оранжевого нет даже без людей', () => {
    const m = items([
      group({ id: 1, opened_on: '2026-06-11', people: 8 }),
      group({ id: 2, opened_on: '2026-09-01', people: 0 }),
      group({ id: 3, opened_on: '2026-06-11', people: 1 }),
    ]);
    for (const id of [1, 2, 3]) expect(m.get(id)).toMatchObject({ isNew: true, empty: false });
  });

  test('через четыре месяца: набралось три человека — отметки нет, не набралось — оранжевый росток', () => {
    const m = items([
      group({ id: 1, opened_on: '2026-06-10', people: 8 }),
      group({ id: 2, opened_on: '2026-06-10', people: 3 }),
      group({ id: 3, opened_on: '2026-06-10', people: 2 }),
      group({ id: 4, opened_on: '2026-06-10', people: 0 }),
    ]);
    expect(m.get(1)).toMatchObject({ isNew: false, empty: false });
    expect(m.get(2)).toMatchObject({ isNew: false, empty: false });
    expect(m.get(3)).toMatchObject({ isNew: false, empty: true });
    expect(m.get(4)).toMatchObject({ isNew: false, empty: true });
  });

  test('у старой группы без даты открытия: без людей — оранжевый, с одним-двумя людьми отметки нет', () => {
    const m = items([
      group({ id: 1, opened_on: null, people: 0 }),
      group({ id: 2, opened_on: null, people: null }),
      group({ id: 3, opened_on: null, people: 2 }),
      group({ id: 4, opened_on: null, people: 8 }),
    ]);
    expect(m.get(1)).toMatchObject({ isNew: false, empty: true });
    expect(m.get(2)).toMatchObject({ isNew: false, empty: true });
    expect(m.get(3)).toMatchObject({ isNew: false, empty: false });
    expect(m.get(4)).toMatchObject({ isNew: false, empty: false });
  });

  test('оранжевого нет у групп на паузе и закрытых, даже если людей нет', () => {
    const m = items([group({ id: 1, status: 'На паузе', people: 0 }), group({ id: 2, status: 'Закрыта', people: 0 })]);
    expect(m.get(1)).toMatchObject({ isNew: false, empty: false });
    expect(m.get(2)).toMatchObject({ isNew: false, empty: false });
  });

  test('людей для порога считают и по ручному составу, и по утверждённым заявкам', () => {
    const { views } = build({
      groups: [group({ id: 5, opened_on: '2026-06-10', people: 1 }), group({ id: 6, opened_on: null, people: 0 }), group({ id: 7, opened_on: null, people: 0 })],
      members: [
        { id: 1, group_id: 5, personKey: 'p1', full_name: 'Нина', phone: null, joined_on: null, note: null },
        { id: 2, group_id: 5, personKey: 'p2', full_name: 'Анна', phone: null, joined_on: null, note: null },
        { id: 3, group_id: 5, personKey: 'p3', full_name: 'Вера', phone: null, joined_on: null, note: null },
        { id: 4, group_id: 6, personKey: 'p4', full_name: 'Зоя', phone: null, joined_on: null, note: null },
      ],
      requests: [request({ id: 10, status: 'Исполнена', group_id: 7 })],
    });
    const m = new Map(views.groups.items.map((g) => [g.id, g]));
    expect(m.get(5)).toMatchObject({ isNew: false, empty: false });
    expect(m.get(6)!.empty).toBe(false);
    expect(m.get(7)!.empty).toBe(false);
  });
});

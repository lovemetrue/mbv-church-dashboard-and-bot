import { describe, expect, test } from 'vitest';
import type { GroupItem, GroupsView, OtherItem, PeopleView, PersonItem, RequestItem, RequestsView, TeamRoleKind } from '../src/home-groups/contracts.js';
import { draftFor, formMetaFor, groupsFor, kitPersonFor, maskPhone, peopleFor, requestsFor, type Viewer } from '../src/home-groups/contactsAccess.js';

/**
 * Кто какие контакты видит: решает сервер на выходе, снимок представлений один на всех. Правило — персональные данные
 * видит тот, кто взял человека или группу на себя; лидеры, старший распределитель и полный вход видят всё.
 */
const person = (name: string, ...teamKinds: TeamRoleKind[]): Viewer => ({ role: 'admin', person: { name, teamKinds } });
const SHARED: Viewer = { role: 'admin', person: null };
const SUPER: Viewer = { role: 'super', person: { name: 'Кто-то', teamKinds: [] } };

const group = (over: Partial<GroupItem>): GroupItem => ({
  id: 1, code: 'ДГ-0001', leader: 'Иван', chamber: false, contactsHidden: false, coordinator: 'Анна Л.',
  phone: '+7 911 000-11-22', coLeaderPhone: '+7 921 000-33-44', address: 'ул. Тайная, 2', addressGeo: 'found',
  coords: { lat: 59.9, lon: 30.3 }, leaderAnswer: { schedule: 'ср вечером', address: 'ул. Тайная, 2' },
  members: [{ kind: 'manual', personKey: 'p1', id: 1, fio: 'Мария', phone: '+7 999 123-45-67' }],
  ...over,
} as GroupItem);
const groupsView = (...items: GroupItem[]): GroupsView => ({ generatedAt: 'g', items } as GroupsView);

const request = (over: Partial<RequestItem>): RequestItem => ({
  id: 10, fio: 'Пётр Ищущий', phone: '+7 911 555-00-11', district: 'Приморский', place: 'м. Беговая', responsible: null,
  street: 'Савушкина 5', streetInfo: { text: 'Савушкина 5', source: 'анкета' }, streetGeo: 'found',
  hobby: 'бег', profession: 'повар', family: 'женат', contactsHidden: false, finalGroup: null,
  original: [{ label: 'ФИО', value: 'Пётр Ищущий' }, { label: 'Телефон', value: '+7 911 555-00-11' }, { label: 'Улица и дом', value: 'Савушкина 5' }],
  ...over,
} as RequestItem);
const other = (over: Partial<OtherItem>): OtherItem => ({
  id: 20, fio: 'Ольга Ведущая', phone: '+7 921 777-88-99', address: 'Невский 1', hobby: null, profession: null, family: null,
  responsible: null, original: [], contactsHidden: false, ownGroup: null, ...over,
} as OtherItem);
const requestsView = (items: RequestItem[], others: OtherItem[] = []): RequestsView => ({ items, others } as RequestsView);

describe('маска телефона', () => {
  test('видны последние четыре цифры; позвонить по ней нельзя', () => {
    expect(maskPhone('+7 911 555-00-11')).toBe('… 00-11');
    expect(maskPhone('12')).toBeNull();
    expect(maskPhone(null)).toBeNull();
  });
});

describe('заявки', () => {
  const MINE = request({ id: 1, responsible: 'Галя' });
  const NOBODYS = request({ id: 2, responsible: null });
  const ALIEN = request({ id: 3, responsible: 'Вера' });

  test('своя заявка — со всеми контактами; ничья и чужая — ФИО, район и последние цифры телефона', () => {
    const [mine, nobodys, alien] = requestsFor(requestsView([MINE, NOBODYS, ALIEN]), person('галя ', 'distributor')).items;
    expect(mine).toEqual(MINE);
    for (const r of [nobodys!, alien!]) {
      expect(r).toMatchObject({
        fio: 'Пётр Ищущий', district: 'Приморский', place: 'м. Беговая', phone: '… 00-11', street: null, streetGeo: null,
        hobby: null, profession: null, family: null, contactsHidden: true, streetInfo: { text: null },
      });
      // «Как пришла» тоже без улицы, а телефон в ней замаскирован.
      expect(r.original).toEqual([{ label: 'ФИО', value: 'Пётр Ищущий' }, { label: 'Телефон', value: '… 00-11' }]);
    }
  });

  test('«другие обращения» — по тому же правилу', () => {
    const view = requestsView([], [other({ responsible: 'Галя' }), other({ id: 21, responsible: null })]);
    const [mine, nobodys] = requestsFor(view, person('Галя', 'coordinator')).others;
    expect(mine!.contactsHidden).toBe(false);
    expect(nobodys).toMatchObject({ phone: '… 88-99', address: null, contactsHidden: true });
  });

  test('лидеры, старший распределитель, полный и общий вход видят всё', () => {
    const view = requestsView([ALIEN]);
    for (const viewer of [person('Давид', 'catalyst'), person('Лена', 'senior'), person('Вера2', 'senior_distributor'), SUPER, SHARED]) {
      expect(requestsFor(view, viewer)).toBe(view);
    }
  });
});

describe('группы', () => {
  const OWN = group({ id: 1, coordinator: 'Анна Л.' });
  const ALIEN = group({ id: 2, coordinator: 'Пётр Г.' });

  test('своя группа (координатор) — с телефонами; чужая — адрес виден, телефоны и состав — последние цифры', () => {
    const [own, alien] = groupsFor(groupsView(OWN, ALIEN), person('Анна Л.', 'coordinator'), requestsView([])).items;
    expect(own).toEqual(OWN);
    expect(alien).toMatchObject({ address: 'ул. Тайная, 2', phone: '… 11-22', coLeaderPhone: '… 33-44', contactsHidden: true });
    expect(alien!.members[0]!.phone).toBe('… 45-67');
  });

  test('распределителю телефоны группы открываются, когда он утвердил в неё человека', () => {
    const viewer = person('Галя', 'distributor');
    const before = requestsView([request({ responsible: 'Галя', finalGroup: null })]);
    expect(groupsFor(groupsView(ALIEN), viewer, before).items[0]!.contactsHidden).toBe(true);
    const after = requestsView([request({ responsible: 'Галя', finalGroup: { id: 2 } as RequestItem['finalGroup'] })]);
    expect(groupsFor(groupsView(ALIEN), viewer, after).items[0]).toEqual(ALIEN);
  });

  test('«хочу открыть группу», взятое себе, открывает заведённую по нему группу', () => {
    const view = requestsView([], [other({ responsible: 'Галя', ownGroup: { id: 2, code: 'ДГ-0002' } })]);
    expect(groupsFor(groupsView(ALIEN), person('Галя', 'coordinator'), view).items[0]).toEqual(ALIEN);
  });

  describe('камерная группа', () => {
    const CHAMBER = group({ id: 7, chamber: true, coordinator: 'Анна Л.' });

    test('чужому координатору — без адреса и телефонов; имя ведущего видно', () => {
      expect(groupsFor(groupsView(CHAMBER), person('Пётр Г.', 'coordinator'), requestsView([])).items[0]).toMatchObject({
        leader: 'Иван', contactsHidden: true, phone: null, coLeaderPhone: null, address: null, addressGeo: null, coords: null,
        leaderAnswer: { schedule: 'ср вечером', address: null },
      });
    });

    test('её координатор, лидеры, полный и общий вход видят; старший распределитель и распределитель — нет', () => {
      const none = requestsView([]);
      expect(groupsFor(groupsView(CHAMBER), person(' анна л. ', 'coordinator'), none).items[0]).toEqual(CHAMBER);
      expect(groupsFor(groupsView(CHAMBER), person('Давид', 'catalyst'), none).items[0]).toEqual(CHAMBER);
      expect(groupsFor(groupsView(CHAMBER), person('Лена', 'senior', 'distributor'), none).items[0]).toEqual(CHAMBER);
      expect(groupsFor(groupsView(CHAMBER), SUPER, none).items[0]).toEqual(CHAMBER);
      expect(groupsFor(groupsView(CHAMBER), SHARED, none).items[0]).toEqual(CHAMBER);
      expect(groupsFor(groupsView(CHAMBER), person('Вера', 'senior_distributor'), none).items[0]!.address).toBeNull();
      expect(groupsFor(groupsView(CHAMBER), person('Галя', 'distributor'), none).items[0]!.address).toBeNull();
    });
  });
});

describe('люди', () => {
  const p = (over: Partial<PersonItem>): PersonItem => ({
    key: 'u1', fio: 'Мария', phone: '+7 999 123-45-67', address: 'Юкки', addressGeo: 'found', hobby: 'бег', profession: 'врач',
    family: null, groups: [], requestId: null, contactsHidden: false, ...over,
  } as PersonItem);
  const people = (...items: PersonItem[]): PeopleView => ({ generatedAt: 'g', items });

  test('открыты люди из своих заявок и из состава своих групп; остальные — без адреса, телефон замаскирован', () => {
    const fromMyRequest = p({ key: 'u1', requestId: 1 });
    const inMyGroup = p({ key: 'u2', groups: ['ДГ-0001'] });
    const stranger = p({ key: 'u3', requestId: 3, groups: ['ДГ-0002'] });
    const out = peopleFor(
      people(fromMyRequest, inMyGroup, stranger), person('Анна Л.', 'coordinator'),
      groupsView(group({ id: 1, code: 'ДГ-0001', coordinator: 'Анна Л.' }), group({ id: 2, code: 'ДГ-0002', coordinator: 'Пётр Г.' })),
      requestsView([request({ id: 1, responsible: 'Анна Л.' }), request({ id: 3, responsible: 'Вера' })]),
    ).items;
    expect(out[0]).toEqual(fromMyRequest);
    expect(out[1]).toEqual(inMyGroup);
    expect(out[2]).toMatchObject({ fio: 'Мария', phone: '… 45-67', address: null, addressGeo: null, hobby: null, profession: null, contactsHidden: true });
  });
});

describe('черновик группы, списки форм, наборы', () => {
  test('черновик группы по чужой заявке — без телефона человека', () => {
    const draft = { requestId: 1, fio: 'Пётр', ownGroup: null, fields: { leader: 'Пётр', phone: '+79110001122' } };
    expect(draftFor(draft, person('Галя', 'coordinator'), requestsView([request({ id: 1, responsible: 'Вера' })])).fields).toEqual({ leader: 'Пётр' });
    expect(draftFor(draft, person('Галя', 'coordinator'), requestsView([request({ id: 1, responsible: 'Галя' })]))).toEqual(draft);
  });

  test('«Подобрать из зарегистрированных» при ограниченном входе подставляет только ФИО', () => {
    const meta = { leaderCandidates: [{ id: 1, fullName: 'Пётр', phone: '+79110001122', label: 'Пётр' }] } as Parameters<typeof formMetaFor>[0];
    expect(formMetaFor(meta, person('Галя', 'coordinator')).leaderCandidates[0]!.phone).toBeNull();
    expect(formMetaFor(meta, SUPER)).toBe(meta);
  });

  test('на «Наборах» при ограниченном входе — последние цифры телефона', () => {
    const kit = { userId: 1, registrationNo: 5, fio: 'Пётр', phone: '+79110001122', issuedAt: null };
    expect(kitPersonFor(kit, person('Галя', 'coordinator')).phone).toBe('… 11-22');
    expect(kitPersonFor(kit, SHARED)).toEqual(kit);
  });
});

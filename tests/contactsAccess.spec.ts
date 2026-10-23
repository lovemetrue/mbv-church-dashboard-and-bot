import { describe, expect, test } from 'vitest';
import type { GroupItem, GroupsView, TeamRoleKind } from '../src/home-groups/contracts.js';
import { groupsFor, type Viewer } from '../src/home-groups/contactsAccess.js';

/** Кто видит адрес и телефоны камерной группы: решает сервер на выходе, снимок представлений один на всех. */
const group = (over: Partial<GroupItem>): GroupItem => ({
  id: 1, code: 'ДГ-0001', leader: 'Иван', chamber: false, contactsHidden: false, coordinator: 'Анна Л.',
  phone: '+7 911 000-11-22', coLeaderPhone: '+7 921 000-33-44', address: 'ул. Тайная, 2', addressGeo: 'found',
  coords: { lat: 59.9, lon: 30.3 }, leaderAnswer: { schedule: 'ср вечером', address: 'ул. Тайная, 2' },
  ...over,
} as GroupItem);
const view = (...items: GroupItem[]): GroupsView => ({ generatedAt: 'g', items } as GroupsView);
const person = (name: string, ...teamKinds: TeamRoleKind[]): Viewer => ({ role: 'admin', person: { name, teamKinds } });

const CHAMBER = group({ id: 7, chamber: true, coordinator: 'Анна Л.' });
const OPEN = group({ id: 8, chamber: false, coordinator: 'Пётр Г.' });

describe('контакты камерных групп', () => {
  test('обычный координатор не видит адрес и телефоны чужой камерной группы; имя ведущего и обычные группы — видит', () => {
    const [chamber, open] = groupsFor(view(CHAMBER, OPEN), person('Пётр Г.', 'coordinator')).items;
    expect(chamber).toMatchObject({
      leader: 'Иван', contactsHidden: true, phone: null, coLeaderPhone: null, address: null, addressGeo: null, coords: null,
      leaderAnswer: { schedule: 'ср вечером', address: null },
    });
    expect(open).toEqual(OPEN);
  });

  test('ответственный координатор (записан в поле «Координатор») видит контакты своей камерной группы', () => {
    expect(groupsFor(view(CHAMBER), person(' анна л. ', 'coordinator')).items[0]).toEqual(CHAMBER);
  });

  test('лидеры — катализатор и старший координатор — видят все камерные группы; распределители — нет', () => {
    expect(groupsFor(view(CHAMBER), person('Давид', 'catalyst')).items[0]).toEqual(CHAMBER);
    expect(groupsFor(view(CHAMBER), person('Лена', 'senior', 'distributor')).items[0]).toEqual(CHAMBER);
    expect(groupsFor(view(CHAMBER), person('Вера', 'senior_distributor')).items[0]!.contactsHidden).toBe(true);
    expect(groupsFor(view(CHAMBER), person('Галя', 'distributor')).items[0]!.contactsHidden).toBe(true);
  });

  test('полный вход видит всё; общий вход без человека — пока тоже, как и раньше', () => {
    expect(groupsFor(view(CHAMBER), { role: 'super', person: { name: 'Кто-то', teamKinds: [] } }).items[0]).toEqual(CHAMBER);
    expect(groupsFor(view(CHAMBER), { role: 'admin', person: null }).items[0]).toEqual(CHAMBER);
  });
});

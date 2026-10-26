import { describe, expect, test } from 'vitest';
import { buildGroups, buildPeople } from './build';
import { fixtureActionResponse } from './index';

describe('фикстуры: составы групп', () => {
  const groups = buildGroups().items;
  const people = buildPeople().items;

  test('у групп есть и направленные через сервис, и внесённые вручную, а у одной состав пуст', () => {
    const all = groups.flatMap((g) => g.members);
    expect(all.some((m) => m.kind === 'placed')).toBe(true);
    expect(all.some((m) => m.kind === 'manual')).toBe(true);
    expect(groups.some((g) => g.members.length === 0)).toBe(true);
  });

  test('направленные идут раньше внесённых вручную', () => {
    for (const g of groups) {
      const kinds = g.members.map((m) => m.kind);
      expect(kinds).toEqual([...kinds].sort((a, b) => (a === b ? 0 : a === 'placed' ? -1 : 1)));
    }
  });

  test('один человек состоит в двух группах, и в каждой есть пометка о другой', () => {
    const twice = groups.flatMap((g) => g.members.filter((m) => m.alsoIn.length > 0).map((m) => ({ code: g.code, m })));
    expect(twice.length).toBeGreaterThanOrEqual(2);
    for (const { code, m } of twice) {
      for (const other of m.alsoIn) {
        const there = groups.find((g) => g.code === other)!;
        expect(there.members.find((x) => x.personKey === m.personKey)?.alsoIn).toContain(code);
      }
    }
  });

  test('каждый человек из состава есть в справочнике, и его имя и телефон взяты оттуда', () => {
    for (const m of groups.flatMap((g) => g.members)) {
      const person = people.find((p) => p.key === m.personKey);
      expect(person, m.personKey).toBeDefined();
      expect(m.fio).toBe(person!.fio);
      expect(m.phone).toBe(person!.phone);
    }
  });

  test('у людей поле groups совпадает с составами групп в обе стороны', () => {
    for (const p of people) {
      const expected = groups.filter((g) => g.members.some((m) => m.personKey === p.key)).map((g) => g.code);
      expect(p.groups, p.key).toEqual(expected);
    }
    expect(people.some((p) => p.groups.length === 2)).toBe(true);
  });

  test('карточка, внесённая вручную, одна: у неё есть personId и источник «Внесён вручную»', () => {
    // Карточки участников команды («Команда») — отдельные: у каждого координатора своя (миграция 056).
    const manual = people.filter((p) => p.personId !== null && p.team === null);
    expect(manual).toHaveLength(1);
    expect(manual[0]).toMatchObject({ key: 'p1', from: 'Внесён вручную', userId: null });
    expect(people.filter((p) => p.personId === null).every((p) => !p.key.startsWith('p'))).toBe(true);
  });
});

describe('фикстуры: действия над составом', () => {
  test('добавление отвечает номером строки и ключом: выбранный человек тот же, новый получает карточку p…', () => {
    expect(fixtureActionResponse('groups/1/members/create', { personKey: 'u3' })).toEqual({ ok: true, id: 101, personKey: 'u3' });
    expect(fixtureActionResponse('groups/1/members/create', { newPerson: { fio: 'Анна' } })).toMatchObject({ ok: true, personKey: expect.stringMatching(/^p\d+$/) });
  });

  test('правка и удаление состава и карточек «получаются»', () => {
    for (const path of ['members/1/update', 'members/1/delete', 'persons/1/update', 'persons/1/delete']) {
      expect(fixtureActionResponse(path, {})).toEqual({ ok: true });
    }
  });
});

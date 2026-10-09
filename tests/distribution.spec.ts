import { describe, expect, test } from 'vitest';
import { distribute, explainNoMatch, type Seeker } from '../src/core/distribution.js';
import type { MatchGroup } from '../src/core/matching.js';

let nextId = 1;
const group = (patch: Partial<MatchGroup> = {}): MatchGroup => ({
  id: nextId++, status: 'Функционирует', open_to_new: 'ДА', age: '25-40', district: 'Невский',
  metro: null, people: null, do_not_refer: false, ...patch,
});
let nextSeeker = 1;
const seeker = (patch: Partial<Seeker> = {}): Seeker => ({ id: nextSeeker++, place: null, age: '25-40', ...patch });
const IDLE = { campaignActive: false };

describe('распределение желающих по группам', () => {
  test('каждому назначается лучшая группа, остальные подходящие идут в альтернативы', () => {
    const best = group({ district: 'Приморский', metro: 'Пионерская' });
    const second = group({ district: 'Приморский' });
    const far = group({ district: 'Невский' });
    const { assignments } = distribute([seeker({ place: 'Приморский, м. Пионерская' })], [far, second, best], [], IDLE);
    const [a] = assignments;
    expect(a!.groupId).toBe(best.id);
    expect(a!.alternatives.map((s) => s.groupId)).toEqual([second.id, far.id]);
  });

  test('альтернатив не больше трёх', () => {
    const groups = Array.from({ length: 8 }, () => group());
    expect(distribute([seeker()], groups, [], IDLE).assignments[0]!.alternatives).toHaveLength(3);
  });

  test('люди распределяются по очереди и не складываются в одну группу: «меньше участников» работает', () => {
    // Две группы одного района с одинаковым числом участников; без пересчёта все пошли бы в первую.
    const a = group({ district: 'Приморский', people: 8 });
    const b = group({ district: 'Приморский', people: 8 });
    const seekers = Array.from({ length: 4 }, () => seeker({ place: 'Приморский' }));
    const { assignments, load } = distribute(seekers, [a, b], [], IDLE);
    expect(assignments.map((x) => x.groupId).filter((id) => id === a.id)).toHaveLength(2);
    expect(assignments.map((x) => x.groupId).filter((id) => id === b.id)).toHaveLength(2);
    expect(load.get(a.id)).toEqual({ before: 8, added: 2 });
  });

  test('число участников у группы без данных остаётся неизвестным, но назначения считаются', () => {
    const g = group({ people: null });
    const { load } = distribute([seeker(), seeker()], [g], [], IDLE);
    expect(load.get(g.id)).toEqual({ before: null, added: 2 });
  });

  test('жёсткие условия те же, что в подборе: закрытая и «Не направлять» не назначаются', () => {
    const closed = group({ status: 'Закрыта' });
    const hidden = group({ do_not_refer: true });
    const noNew = group({ open_to_new: 'НЕТ' });
    const wrongAge = group({ age: '55-65' });
    const { assignments } = distribute([seeker()], [closed, hidden, noNew, wrongAge], [], IDLE);
    expect(assignments[0]!.groupId).toBeNull();
  });

  test('если подходящей группы нет, объясняем, на каком условии отсеялись группы', () => {
    const groups = [group({ status: 'Закрыта' }), group({ open_to_new: 'НЕТ' }), group({ age: '55-65' }), group({ do_not_refer: true })];
    const text = explainNoMatch(seeker(), groups);
    expect(text).toContain('не действуют: 1');
    expect(text).toContain('приём новых закрыт: 1');
    expect(text).toContain('не подходят по возрасту: 1');
    expect(text).toContain('«Не направлять»: 1');
  });

  test('принцип распределения записан словами: очки и причины', () => {
    const g = group({ district: 'Приморский', metro: 'Пионерская' });
    const [a] = distribute([seeker({ place: 'Приморский, м. Пионерская' })], [g], [], IDLE).assignments;
    expect(a!.principle).toContain('тот же район');
    expect(a!.principle).toContain('5');
  });

  test('если ни район, ни метро не совпали, это сказано прямо и назначение помечено на проверку', () => {
    const [a] = distribute([seeker({ place: 'Купчино' })], [group({ district: 'Приморский' })], [], IDLE).assignments;
    expect(a!.groupId).not.toBeNull();
    expect(a!.needsCheck).toBe(true);
    expect(a!.principle).toContain('нет совпадения по району и метро');
  });

  test('если человек не указал место, это тоже сказано', () => {
    const [a] = distribute([seeker({ place: null })], [group()], [], IDLE).assignments;
    expect(a!.needsCheck).toBe(true);
    expect(a!.principle).toContain('не указал');
  });

  test('совпадение по району или метро проверки не требует', () => {
    const [a] = distribute([seeker({ place: 'Невский' })], [group({ district: 'Невский' })], [], IDLE).assignments;
    expect(a!.needsCheck).toBe(false);
  });
});

describe('те, кто хочет открыть группу, — это будущие новые группы', () => {
  const owner = (patch = {}) => ({ id: 'o1', name: 'Петрова Анна', place: 'Приморский, Пионерская', age: '25-40', ...patch });

  test('новая группа владельца идёт раньше существующей, как и положено правилу «новые первыми»', () => {
    const existing = group({ district: 'Приморский', metro: 'Пионерская' });
    const { assignments } = distribute([seeker({ place: 'Приморский, Пионерская' })], [existing], [owner()], IDLE);
    expect(assignments[0]!.groupId).toBeLessThan(0);
    expect(assignments[0]!.ownerId).toBe('o1');
    expect(assignments[0]!.principle).toContain('новая группа');
  });

  test('район будущей группы определяется из того, что написал владелец', () => {
    const { assignments } = distribute([seeker({ place: 'Приморский' })], [], [owner({ place: 'Приморский район' })], IDLE);
    expect(assignments[0]!.sameDistrict).toBe(true);
  });

  test('название района владельца не считается его «метро»: иначе район засчитывался бы дважды', () => {
    const { assignments } = distribute(
      [seeker({ place: 'Приморский' })], [], [owner({ place: 'Приморский, Пионерская' })], IDLE,
    );
    expect(assignments[0]!.sameDistrict).toBe(true);
    expect(assignments[0]!.sameMetro).toBe(false);
    expect(assignments[0]!.score).toBe(3);
  });

  test('владелец в другом районе людей не получает: «новые первыми» не повод везти человека через город', () => {
    const near = group({ district: 'Невский', metro: 'Дыбенко' });
    const { assignments, ownerLoad } = distribute(
      [seeker({ place: 'Невский, Дыбенко' })],
      [near],
      [owner({ place: 'Приморский, Пионерская' })],
      IDLE,
    );
    expect(assignments[0]!.groupId).toBe(near.id);
    expect(ownerLoad.get('o1')).toBe(0);
  });

  test('если человек не назвал место, группы владельцев ему не предлагаются', () => {
    const existing = group();
    const { assignments } = distribute([seeker({ place: null })], [existing], [owner()], IDLE);
    expect(assignments[0]!.groupId).toBe(existing.id);
  });

  test('владелец, не указавший место, группу не получает: непонятно, где она будет', () => {
    const { assignments } = distribute([seeker({ place: 'Приморский' })], [], [owner({ place: null })], IDLE);
    expect(assignments[0]!.groupId).toBeNull();
  });

  test('новые группы набираются поровну, а не все люди идут к первому владельцу', () => {
    const owners = [owner({ id: 'a' }), owner({ id: 'b' })];
    const seekers = Array.from({ length: 4 }, () => seeker({ place: 'Приморский, Пионерская' }));
    const { assignments } = distribute(seekers, [], owners, IDLE);
    const count = (id: string) => assignments.filter((a) => a.ownerId === id).length;
    expect([count('a'), count('b')]).toEqual([2, 2]);
  });

  test('по каждому владельцу видно, сколько человек ему назначено', () => {
    const { ownerLoad } = distribute([seeker({ place: 'Приморский' }), seeker({ place: 'Приморский' })], [], [owner()], IDLE);
    expect(ownerLoad.get('o1')).toBe(2);
  });
});

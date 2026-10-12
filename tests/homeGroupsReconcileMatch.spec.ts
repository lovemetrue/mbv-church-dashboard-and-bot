import { describe, expect, test } from 'vitest';
import { findGroups, nameTokens, planReconcile, sameToken, type LeaderGroup } from '../src/home-groups/reconcile/match.js';

const g = (id: number, leader: string, phones: string[] = [], coLeader: string | null = null): LeaderGroup => ({ id, leader, coLeader, phones });

// Имена и телефоны — в том виде, как они записаны в таблице церкви.
const GROUPS: LeaderGroup[] = [
  g(1, 'Воротникова Раиса', ['8 (905) 263-73-89; Раиса; 8 (981) 803-47-05; Светлана Сереброва']),
  g(5, 'Артёмкин Константин (и Людмила)', ['89819743655']),
  g(6, 'Артёмкин Константин (и Людмила)', ['89819743655']),
  g(7, 'Дубовицкая Алена', ['79533668053']),
  g(19, 'Пановы Дмитрий и Александра', ['89944178986']),
  g(20, 'Родионов Давид', ['89112398191']),
  g(21, 'Родионов Давид', ['89112398191']),
  g(30, 'Малявин Павел', ['89001112233']),
  g(31, 'Малявин Андрей', []),
  g(40, 'Клименко Павел', ['89609163578'], 'Клименко Марина'),
];

describe('разбор имён', () => {
  test('регистр, ё/е, й/и, скобки и союзы не мешают; порядок слов не важен', () => {
    expect(nameTokens('Артёмкин Константин (и Людмила)').sort()).toEqual(['артемкин', 'константин', 'людмила']);
    expect(nameTokens('  КОНСТАНТИН   артемкин ').sort()).toEqual(['артемкин', 'константин']);
    expect(nameTokens('Пановы Дмитрий и Александра').sort()).toEqual(['александра', 'дмитрии', 'пановы']);
  });

  test('пустое и мусор дают пустой набор', () => {
    expect(nameTokens(null)).toEqual([]);
    expect(nameTokens('  ')).toEqual([]);
    expect(nameTokens('???')).toEqual([]);
  });

  test('один человек в разных падежах и числах — то же слово, разные люди — разные', () => {
    expect(sameToken('панов', 'пановы')).toBe(true);
    expect(sameToken('малявин', 'малявина')).toBe(true);
    expect(sameToken('дубовицкая', 'дубовицкий')).toBe(true);
    expect(sameToken('иван', 'ивана')).toBe(true);
    expect(sameToken('павел', 'пётр')).toBe(false);
    expect(sameToken('марина', 'мария')).toBe(false);
    // Короткие слова сравниваются целиком: «Ира» и «Ирина» — разные записи, их решает человек.
    expect(sameToken('ира', 'ирина')).toBe(false);
  });
});

describe('поиск группы по ведущему', () => {
  test('имя совпало полностью: найдена группа, порядок слов любой', () => {
    expect(findGroups({ name: 'Малявин Павел', phones: [] }, GROUPS)).toEqual([{ groupId: 30, tier: 'exact', by: 'name', role: 'leader' }]);
    expect(findGroups({ name: 'Павел Малявин', phones: [] }, GROUPS)).toEqual([{ groupId: 30, tier: 'exact', by: 'name', role: 'leader' }]);
  });

  test('однофамильцы с другим именем не считаются совпадением', () => {
    const found = findGroups({ name: 'Малявин Павел', phones: [] }, GROUPS).map((c) => c.groupId);
    expect(found).not.toContain(31);
  });

  test('жена или муж из скобок и «второй ведущий» находят ту же группу', () => {
    expect(findGroups({ name: 'Людмила Артемкина', phones: [] }, GROUPS).map((c) => c.groupId)).toEqual([5, 6]);
    expect(findGroups({ name: 'Марина Клименко', phones: [] }, GROUPS)).toEqual([{ groupId: 40, tier: 'exact', by: 'name', role: 'coLeader' }]);
  });

  test('фамилия во множественном числе («Пановы») находит группу по «Дмитрий Панов»', () => {
    expect(findGroups({ name: 'Дмитрий Панов', phones: [] }, GROUPS).map((c) => c.groupId)).toEqual([19]);
  });

  test('телефон точнее имени: совпал номер в любом формате и среди нескольких номеров в одной ячейке', () => {
    expect(findGroups({ name: 'Совсем Другое', phones: ['+7 981 803-47-05'] }, GROUPS)).toEqual([{ groupId: 1, tier: 'exact', by: 'phone', role: 'leader' }]);
    expect(findGroups({ name: null, phones: ['89112398191'] }, GROUPS).map((c) => c.groupId)).toEqual([20, 21]);
  });

  test('номер из семи цифр или короче ничего не находит: так совпадения случайны', () => {
    expect(findGroups({ name: null, phones: ['2637389'] }, GROUPS)).toEqual([]);
  });

  test('фамилия и инициал — вероятное совпадение, не точное', () => {
    expect(findGroups({ name: 'Малявин П.', phones: [] }, GROUPS)).toEqual([{ groupId: 30, tier: 'likely', by: 'name', role: 'leader' }]);
  });

  test('одно имя без фамилии ничего не находит: «Павел» ведут многие', () => {
    expect(findGroups({ name: 'Павел', phones: [] }, GROUPS)).toEqual([]);
  });

  test('точные идут перед вероятными, группа в результате один раз, даже если совпали и имя, и телефон', () => {
    const found = findGroups({ name: 'Малявин Павел', phones: ['89001112233'] }, GROUPS);
    expect(found.map((c) => c.groupId)).toEqual([30]);
    expect(found[0]!.tier).toBe('exact');
  });
});

describe('что делать с обращением', () => {
  test('одна группа точно — «готово к разбору»', () => {
    expect(planReconcile({ name: 'Малявин Павел', phones: [] }, GROUPS)).toEqual({
      status: 'ready', candidates: [{ groupId: 30, tier: 'exact', by: 'name', role: 'leader' }],
    });
  });

  test('ведущий ведёт две группы — человек выбирает, в какую ходит', () => {
    const r = planReconcile({ name: 'Родионов Давид', phones: [] }, GROUPS);
    expect(r.status).toBe('choose');
    expect(r.candidates.map((c) => c.groupId)).toEqual([20, 21]);
  });

  test('только вероятное совпадение — тоже выбор человека', () => {
    expect(planReconcile({ name: 'Малявин П.', phones: [] }, GROUPS).status).toBe('choose');
  });

  test('ведущего в справочнике групп нет — «группа не найдена»', () => {
    expect(planReconcile({ name: 'Иванов Иван', phones: [] }, GROUPS)).toEqual({ status: 'none', candidates: [] });
  });

  test('имя не указано и телефон ничего не нашёл — «ведущий не указан»', () => {
    expect(planReconcile({ name: null, phones: ['89990000000'] }, GROUPS)).toEqual({ status: 'noleader', candidates: [] });
    expect(planReconcile({ name: '  ', phones: [] }, GROUPS).status).toBe('noleader');
  });
});

import { describe, expect, test } from 'vitest';
import { closeToken, findGroups, looksLikeSurname, nameTokens, planReconcile, sameToken, type LeaderGroup } from '../src/home-groups/reconcile/match.js';

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

  test('имя не склеивается с фамилией от того же корня: «Иван» — не «Иванов», «Пётр» — не «Петров»', () => {
    expect(sameToken('иван', 'иванов')).toBe(false);
    expect(sameToken('петр', 'петров')).toBe(false);
    expect(sameToken('олег', 'олегович')).toBe(false);
    expect(sameToken('александр', 'александров')).toBe(false);
    // а окончание в одну букву по-прежнему не мешает
    expect(sameToken('иванов', 'иванова')).toBe(true);
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
    expect(findGroups({ name: 'Раиса Иванова', phones: ['+7 981 803-47-05'] }, GROUPS)).toEqual([{ groupId: 1, tier: 'exact', by: 'phone', role: 'leader' }]);
    expect(findGroups({ name: null, phones: ['89112398191'] }, GROUPS).map((c) => c.groupId)).toEqual([20, 21]);
  });

  test('номер совпал, а имя с ведущим не имеет ничего общего (общий телефон семьи) — только «похоже»', () => {
    expect(findGroups({ name: 'Совсем Другое', phones: ['+7 981 803-47-05'] }, GROUPS)).toEqual([{ groupId: 1, tier: 'likely', by: 'phone', role: 'leader' }]);
    expect(planReconcile({ name: 'Совсем Другое', phones: ['+7 981 803-47-05'] }, GROUPS).status).toBe('choose');
  });

  test('номер совпал, а в имени есть слово ведущего (жена с телефоном мужа): точно', () => {
    expect(findGroups({ name: 'Малявина Мария', phones: ['89001112233'] }, GROUPS)).toEqual([{ groupId: 30, tier: 'exact', by: 'phone', role: 'leader' }]);
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

describe('ведущий записан не так, как назвал человек', () => {
  const REF: LeaderGroup[] = [
    g(50, 'Ишмуратова Л.'),
    g(51, 'Коновалов Дмитрий'),
    g(52, 'Ишмуратова Лилия'),
    g(53, 'Мария Сидорова'),
    g(54, 'Петров Олег'),
  ];

  test('в справочнике инициал, человек назвал полное имя: фамилия и первая буква сошлись — точно', () => {
    const found = findGroups({ name: 'Ишмуратова Лилия', phones: [] }, [REF[0]!]);
    expect(found).toEqual([{ groupId: 50, tier: 'exact', by: 'name', role: 'leader' }]);
    // Другая первая буква — не она.
    expect(findGroups({ name: 'Ишмуратова Анна', phones: [] }, [REF[0]!])).toEqual([]);
  });

  test('назвали двух супругов, в справочнике один из них: вероятное совпадение по фамилии, решает человек', () => {
    expect(findGroups({ name: 'Коновалов и Маруфов', phones: [] }, REF)).toEqual([{ groupId: 51, tier: 'likely', by: 'name', role: 'leader' }]);
    expect(planReconcile({ name: 'Коновалов и Маруфов', phones: [] }, REF).status).toBe('choose');
  });

  test('назвали только фамилию: вероятное совпадение с каждой группой этого ведущего', () => {
    const plan = planReconcile({ name: 'Ишмуратова', phones: [] }, REF);
    expect(plan.status).toBe('choose');
    expect(plan.candidates.map((c) => c.groupId)).toEqual([50, 52]);
  });

  test('опечатка в длинной фамилии («Измуратова») — вероятное совпадение', () => {
    expect(findGroups({ name: 'Измуратова Лилия', phones: [] }, [REF[2]!])).toEqual([{ groupId: 52, tier: 'likely', by: 'name', role: 'leader' }]);
  });

  test('одинаковое имя без общей фамилии не подходит: «Мария Петрова» — не группа Марии Сидоровой', () => {
    expect(findGroups({ name: 'Мария Петрова', phones: [] }, REF)).toEqual([]);
    expect(planReconcile({ name: 'Мария Петрова', phones: [] }, REF).status).toBe('none');
  });

  test('однофамилец с другим именем не подходит, а назвавший только инициал не цепляет чужого ведущего', () => {
    expect(findGroups({ name: 'Петров Иван', phones: [] }, REF)).toEqual([]);
    expect(findGroups({ name: 'Петров И.', phones: [] }, REF)).toEqual([]);
  });

  test('похожее на фамилию слово: -ов, -ин, -ский — да; женские имена на -ина и «Константин» — нет', () => {
    for (const t of ['коновалов', 'кузьмина', 'ишмуратова', 'дубовицка', 'клименко']) expect(looksLikeSurname(t)).toBe(true);
    for (const t of ['марина', 'константин', 'екатерина', 'лилия', 'павел']) expect(looksLikeSurname(t)).toBe(false);
  });

  test('одна буква разницы у длинных слов — опечатка, у коротких — другое слово', () => {
    expect(closeToken('ишмуратова', 'измуратова')).toBe(true);
    expect(closeToken('ишмуратова', 'ишмуратов')).toBe(true);
    expect(closeToken('ишмуратова', 'ишмуратовы')).toBe(true);
    expect(closeToken('павлов', 'павлова')).toBe(false);
    expect(closeToken('ишмуратова', 'ишмурадова')).toBe(true);
    expect(closeToken('ишмуратова', 'иванова')).toBe(false);
  });
});

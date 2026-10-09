import { describe, expect, test } from 'vitest';
import {
  MAX_SUGGESTIONS,
  NEW_ENOUGH,
  ageRange,
  matchesDistrict,
  matchesMetro,
  suggestGroups,
  type MatchGroup,
  type MatchPerson,
} from '../src/core/matching.js';

let nextId = 1;
/** Группа, подходящая под все жёсткие условия; тесты портят по одному условию. */
const group = (patch: Partial<MatchGroup> = {}): MatchGroup => ({
  id: nextId++,
  status: 'Функционирует',
  open_to_new: 'ДА',
  age: '25-40',
  district: 'Невский',
  metro: null,
  people: null,
  do_not_refer: false,
  ...patch,
});

const person = (patch: Partial<MatchPerson> = {}): MatchPerson => ({ age: '25-40', place: null, ...patch });
const IDLE = { campaignActive: false };
const ids = (list: { groupId: number }[]) => list.map((s) => s.groupId);

describe('возраст', () => {
  test.each([
    ['18-25', [18, 25]],
    ['35-45 лет', [35, 45]],
    ['35–45', [35, 45]],
    ['65+', [65, 120]],
    ['40.0', [40, 40]],
    ['37 лет', [37, 37]],
    ['подростки (до 18 лет)', [12, 17]],
  ])('«%s» разбирается в диапазон', (raw, range) => {
    expect(ageRange(raw)).toEqual(range);
  });

  test.each(['', null, undefined, 'любой', 'Любой', 'не указан', 'ерунда'])(
    '«%s» — возраст неизвестен, а не нулевой',
    (raw) => {
      expect(ageRange(raw as string | null)).toBeNull();
    },
  );
});

describe('район и метро человека', () => {
  test.each([
    ['Приморский, м. Пионерская', 'Приморский'],
    ['живу в Приморском районе', 'Приморский'],
    ['центральный район', 'Центральный'],
    ['Красногвардейском р-не', 'Красногвардейский'],
    ['ЛО, Ленинградская область', 'Ленинградская область'],
  ])('«%s» — район %s', (place, district) => {
    expect(matchesDistrict(place, district)).toBe(true);
  });

  test('станция метро с таким же корнем не считается районом', () => {
    // «Пушкинская» и «Московская» — станции в Центральном и Московском районах;
    // по ним нельзя записать человека в Пушкинский район.
    expect(matchesDistrict('м. Пушкинская', 'Пушкинский')).toBe(false);
    expect(matchesDistrict('рядом с Московской', 'Московский')).toBe(false);
  });

  test('другой район и пустой текст не совпадают', () => {
    expect(matchesDistrict('Невский', 'Приморский')).toBe(false);
    expect(matchesDistrict('', 'Приморский')).toBe(false);
    expect(matchesDistrict('Приморский', 'Не указан')).toBe(false);
  });

  test.each([
    ['м. Пионерская', 'Пионерская'],
    ['рядом с Пионерской', 'Пионерская'],
    ['Комендантская', 'Комендантский проспект'],
    ['Площадь Восстания', 'Площадь Восстания, Маяковская'],
    ['маяковская', 'Площадь Восстания, Маяковская'],
    ['Старой Деревни', 'Старая Деревня'],
  ])('«%s» совпадает с метро группы «%s»', (place, metro) => {
    expect(matchesMetro(place, metro)).toBe(true);
  });

  test('общее слово «проспект» станцией не считается', () => {
    expect(matchesMetro('Невский проспект', 'Комендантский проспект')).toBe(false);
    expect(matchesMetro('Проспект Ветеранов', 'Проспект Просвещения')).toBe(false);
  });

  test('у группы нет метро или человек его не назвал — совпадения нет', () => {
    expect(matchesMetro('Пионерская', null)).toBe(false);
    expect(matchesMetro('', 'Пионерская')).toBe(false);
  });
});

describe('жёсткие условия: группа отсекается, если не выполнено хоть одно', () => {
  test('подходящая группа попадает в подбор', () => {
    const g = group();
    expect(ids(suggestGroups(person(), [g], IDLE))).toEqual([g.id]);
  });

  test.each(['Закрыта', 'На паузе', 'Потенциальная', 'Недвижимость'])('статус «%s» не подходит', (status) => {
    expect(suggestGroups(person(), [group({ status })], IDLE)).toEqual([]);
  });

  test('«Кампания» подходит так же, как «Функционирует»', () => {
    const g = group({ status: 'Кампания' });
    expect(ids(suggestGroups(person(), [g], IDLE))).toEqual([g.id]);
  });

  test.each(['НЕТ', 'нет', ' Нет '])('приём новых «%s» отсекает группу', (open) => {
    expect(suggestGroups(person(), [group({ open_to_new: open })], IDLE)).toEqual([]);
  });

  test.each(['ДА', 'По требованию', null, ''])('приём новых «%s» не отсекает: не «Нет»', (open) => {
    expect(suggestGroups(person(), [group({ open_to_new: open })], IDLE)).toHaveLength(1);
  });

  test('возрасты не пересекаются — группа отсекается', () => {
    expect(suggestGroups(person({ age: '18-25' }), [group({ age: '40-55' })], IDLE)).toEqual([]);
  });

  test('возрасты пересекаются частично — группа остаётся', () => {
    expect(suggestGroups(person({ age: '25-40' }), [group({ age: '35-50' })], IDLE)).toHaveLength(1);
  });

  test('граница считается пересечением: 18-25 и 25-35', () => {
    expect(suggestGroups(person({ age: '18-25' }), [group({ age: '25-35' })], IDLE)).toHaveLength(1);
  });

  test('подросток не попадает в группу 40-55, но попадает в 16-25', () => {
    const p = person({ age: 'подростки (до 18 лет)' });
    expect(suggestGroups(p, [group({ age: '40-55' })], IDLE)).toEqual([]);
    expect(suggestGroups(p, [group({ age: '16-25' })], IDLE)).toHaveLength(1);
  });

  test('«любой» или пустой возраст группы возраст человека не отсекает', () => {
    for (const age of ['любой', 'Любой', '', null]) {
      expect(suggestGroups(person({ age: '65+' }), [group({ age })], IDLE)).toHaveLength(1);
    }
  });

  test('возраст человека неизвестен — по возрасту не отсекаем', () => {
    expect(suggestGroups(person({ age: null }), [group({ age: '65+' })], IDLE)).toHaveLength(1);
  });

  test('«Не направлять» скрывает группу из подбора, даже если всё остальное подходит', () => {
    const p = person({ place: 'Невский' });
    expect(suggestGroups(p, [group({ do_not_refer: true, status: 'Кампания' })], { campaignActive: true })).toEqual([]);
  });
});

describe('мягкие условия: очки', () => {
  test('тот же район даёт 3', () => {
    const [s] = suggestGroups(person({ place: 'Невский район' }), [group()], IDLE);
    expect(s?.score).toBe(3);
  });

  test('то же метро даёт 2', () => {
    const [s] = suggestGroups(person({ place: 'м. Пионерская' }), [group({ metro: 'Пионерская', district: 'Приморский' })], IDLE);
    expect(s?.score).toBe(2);
  });

  test('район и метро складываются', () => {
    const [s] = suggestGroups(
      person({ place: 'Приморский, м. Пионерская' }),
      [group({ metro: 'Пионерская', district: 'Приморский' })],
      IDLE,
    );
    expect(s?.score).toBe(5);
  });

  test('«Кампания» в период кампании даёт 2, вне периода — ничего', () => {
    const g = group({ status: 'Кампания' });
    expect(suggestGroups(person(), [g], { campaignActive: true })[0]?.score).toBe(2);
    expect(suggestGroups(person(), [g], { campaignActive: false })[0]?.score).toBe(0);
  });

  test('«Функционирует» очков за кампанию не получает', () => {
    expect(suggestGroups(person(), [group()], { campaignActive: true })[0]?.score).toBe(0);
  });

  test('меньше участников, чем в соседних группах района, даёт 1', () => {
    const small = group({ people: 6 });
    const big1 = group({ people: 10 });
    const big2 = group({ people: 12 });
    const found = suggestGroups(person(), [small, big1, big2], IDLE);
    expect(found.find((s) => s.groupId === small.id)?.score).toBe(1);
    expect(found.find((s) => s.groupId === big1.id)?.score).toBe(0);
  });

  test('поровну с соседями — очка нет: «меньше» значит строго меньше', () => {
    const a = group({ people: 10 });
    const b = group({ people: 10 });
    expect(suggestGroups(person(), [a, b], IDLE).map((s) => s.score)).toEqual([0, 0]);
  });

  test('соседи — группы того же района: другой район в среднее не входит', () => {
    const mine = group({ people: 6, district: 'Невский' });
    const other = group({ people: 20, district: 'Приморский' });
    expect(suggestGroups(person(), [mine, other], IDLE).find((s) => s.groupId === mine.id)?.score).toBe(0);
  });

  test('число участников неизвестно или сравнивать не с кем — очка нет', () => {
    const lone = group({ people: 5 });
    expect(suggestGroups(person(), [lone], IDLE)[0]?.score).toBe(0);
    const a = group({ people: null });
    const b = group({ people: 10 });
    expect(suggestGroups(person(), [a, b], IDLE).find((s) => s.groupId === a.id)?.score).toBe(0);
  });

  test('закрытые и приостановленные группы в «соседях» не участвуют', () => {
    const mine = group({ people: 6 });
    const closed = group({ people: 2, status: 'Закрыта' });
    expect(suggestGroups(person(), [mine, closed], IDLE)[0]?.score).toBe(0);
  });

  test('группа, куда направлять нельзя, соседей тоже не считает', () => {
    // Её состав по-прежнему реальный, но она скрыта из подбора, и сравнивать с ней — путать.
    const mine = group({ people: 12 });
    const hidden = group({ people: 20, do_not_refer: true });
    expect(suggestGroups(person(), [mine, hidden], IDLE)[0]?.score).toBe(0);
  });
});

describe('совпадение по месту отдельным признаком', () => {
  test('видно, совпали ли район и метро, независимо от очков', () => {
    const g = group({ district: 'Приморский', metro: 'Пионерская' });
    const both = suggestGroups(person({ place: 'Приморский, м. Пионерская' }), [g], IDLE)[0]!;
    expect([both.sameDistrict, both.sameMetro]).toEqual([true, true]);
    const onlyMetro = suggestGroups(person({ place: 'Пионерская' }), [g], IDLE)[0]!;
    expect([onlyMetro.sameDistrict, onlyMetro.sameMetro]).toEqual([false, true]);
    const none = suggestGroups(person({ place: 'Купчино' }), [g], IDLE)[0]!;
    expect([none.sameDistrict, none.sameMetro]).toEqual([false, false]);
  });
});

describe('причины: почему группа предложена', () => {
  test('каждое начисленное очко объяснено', () => {
    const small = group({ status: 'Кампания', district: 'Приморский', metro: 'Пионерская', people: 6 });
    const other = group({ district: 'Приморский', people: 12 });
    const found = suggestGroups(person({ place: 'Приморский, м. Пионерская' }), [small, other], { campaignActive: true });
    const reasons = found.find((s) => s.groupId === small.id)!.reasons.join(' | ');
    expect(reasons).toContain('тот же район');
    expect(reasons).toContain('Пионерская');
    expect(reasons).toContain('кампани');
    expect(reasons).toContain('6');
  });

  test('у группы без совпадений причина всё равно есть: возраст подходит', () => {
    const [s] = suggestGroups(person({ age: '25-40' }), [group({ age: '35-50' })], IDLE);
    expect(s?.reasons.length).toBeGreaterThan(0);
    expect(s?.reasons.join(' ')).toContain('возраст');
  });
});

describe('новые группы в первую очередь', () => {
  const fresh = (patch: Partial<MatchGroup> = {}) => group({ status: 'Кампания', ...patch });

  test('новая группа идёт раньше существующей, даже если у той очков больше', () => {
    const existing = group({ district: 'Приморский' });
    const created = fresh({ district: 'Невский' });
    const found = suggestGroups(person({ place: 'Приморский' }), [existing, created], IDLE);
    expect(found[0]?.groupId).toBe(created.id);
  });

  test('существующих не показываем, пока хватает новых', () => {
    const news = Array.from({ length: NEW_ENOUGH }, () => fresh());
    const existing = group();
    const found = suggestGroups(person(), [existing, ...news], IDLE);
    expect(ids(found)).toEqual(news.map((n) => n.id));
    expect(found.some((s) => s.groupId === existing.id)).toBe(false);
  });

  test('если новых не хватило, добавляем существующие', () => {
    const news = Array.from({ length: NEW_ENOUGH - 1 }, () => fresh());
    const existing = group();
    const found = suggestGroups(person(), [existing, ...news], IDLE);
    expect(found.some((s) => s.groupId === existing.id)).toBe(true);
    expect(found.slice(0, news.length).every((s) => news.some((n) => n.id === s.groupId))).toBe(true);
  });

  test('новых нет совсем — подбираем из существующих', () => {
    const g = group();
    expect(ids(suggestGroups(person(), [g], IDLE))).toEqual([g.id]);
  });

  test('у предложения есть признак «новая»', () => {
    const created = fresh();
    const existing = group();
    const found = suggestGroups(person(), [created, existing], IDLE);
    expect(found.find((s) => s.groupId === created.id)?.fresh).toBe(true);
    expect(found.find((s) => s.groupId === existing.id)?.fresh).toBe(false);
  });
});

describe('порядок и предел', () => {
  test('внутри уровня выше та, у кого больше очков', () => {
    const near = group({ district: 'Приморский' });
    const far = group({ district: 'Невский' });
    const found = suggestGroups(person({ place: 'Приморский' }), [far, near], IDLE);
    expect(ids(found)).toEqual([near.id, far.id]);
  });

  test('при равных очках выше группа поменьше: людей надо расселять равномерно', () => {
    // Районы разные, чтобы «меньше соседей» очков не добавляло: проверяем именно порядок при ничьей.
    const big = group({ people: 12, district: 'Невский' });
    const small = group({ people: 8, district: 'Выборгский' });
    const unknown = group({ people: null, district: 'Кировский' });
    const found = suggestGroups(person(), [big, unknown, small], IDLE);
    expect(ids(found)).toEqual([small.id, big.id, unknown.id]);
  });

  test('больше предела не возвращаем', () => {
    const many = Array.from({ length: MAX_SUGGESTIONS + 4 }, () => group());
    expect(suggestGroups(person(), many, IDLE)).toHaveLength(MAX_SUGGESTIONS);
  });

  test('нет ни одной подходящей группы — пустой список, а не ошибка', () => {
    expect(suggestGroups(person(), [], IDLE)).toEqual([]);
  });
});

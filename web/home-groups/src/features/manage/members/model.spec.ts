import type { PersonItem } from '@contracts';
import { describe, expect, test } from 'vitest';
import { buildAddBody, formatDayMonth, formatDayMonthYear, isFutureDate, normalizeText, searchPeople, todayIso } from './model';

const NO_PERSON = { fio: '', phone: '', age: '', place: '', address: '', schedule: '', hobby: '', profession: '', family: '', note: '' };

const person = (over: Partial<PersonItem>): PersonItem => ({
  strange: null,
  contactsHidden: false,
  key: 'u1',
  personId: null,
  place: null,
  address: null,
  schedule: null,
  hobby: null,
  profession: null,
  family: null,
  note: null,
  church: null,
  leaderName: null,
  preferredContact: null,
  addressGeo: null,
  groups: [],
  fio: 'Дарья Ефимова',
  phone: '79110004002',
  ageLabel: null,
  district: null,
  from: 'Форма регистрации',
  userId: null,
  registrationNo: null,
  mdgLabel: '',
  date: null,
  requestId: null,
  kitIssuedOn: null,
  ...over,
});

describe('поиск человека для состава', () => {
  const people = [
    person({ key: 'u1' }),
    person({ key: 'u2', fio: 'Пётр Семёнов', phone: '79217770011' }),
    person({ key: 'u3', fio: 'Елена Иванова', phone: null }),
  ];
  const keys = (q: string) => searchPeople(people, q).items.map((p) => p.key);

  test('нормализация: регистр, «ё» как «е», лишние пробелы', () => {
    expect(normalizeText('  ПЁТР   Семёнов ')).toBe('петр семенов');
  });

  test('ищет по ФИО без учёта регистра и «ё»', () => {
    expect(keys('ПЕТР')).toEqual(['u2']);
    expect(keys('семенов')).toEqual(['u2']);
  });

  test('слова можно вводить в любом порядке', () => {
    expect(keys('ефимова дарья')).toEqual(['u1']);
  });

  test('ищет по телефону по цифрам, от трёх, в любой записи номера', () => {
    expect(keys('777')).toEqual(['u2']);
    expect(keys('+7 (921) 777')).toEqual(['u2']);
    expect(keys('8 921 777')).toEqual(['u2']);
  });

  test('меньше трёх цифр по телефону не ищут', () => {
    expect(keys('77')).toEqual([]);
  });

  test('человек без телефона находится по имени и не падает на поиске по цифрам', () => {
    expect(keys('Иванова')).toEqual(['u3']);
    expect(keys('555')).toEqual([]);
  });

  test('пустой запрос показывает всех, а результат обрезается до лимита с признаком «есть ещё»', () => {
    expect(keys('   ')).toEqual(['u1', 'u2', 'u3']);
    const many = Array.from({ length: 120 }, (_, i) => person({ key: `r${i}`, fio: `Человек ${i}` }));
    const found = searchPeople(many, '', 50);
    expect(found.items).toHaveLength(50);
    expect(found.total).toBe(120);
  });
});

describe('тело запроса «добавить человека»', () => {
  test('из справочника уходит только personKey, без newPerson', () => {
    expect(buildAddBody({ mode: 'directory', personKey: 'u12', joinedOn: '2026-09-01', note: ' ходит с лета ' })).toEqual({
      personKey: 'u12',
      joinedOn: '2026-09-01',
      note: 'ходит с лета',
    });
  });

  test('пустые дата и заметка в тело не попадают', () => {
    expect(buildAddBody({ mode: 'directory', personKey: 'u12', joinedOn: '', note: '  ' })).toEqual({ personKey: 'u12' });
  });

  test('новый человек уходит как newPerson без personKey, а пустые поля отбрасываются', () => {
    const body = buildAddBody({ mode: 'new', person: { ...NO_PERSON, fio: ' Анна Лебедева ', age: '34', place: ' Купчино ', hobby: ' бег ', family: 'замужем' }, joinedOn: '2026-09-02', note: '' });
    expect(body).toEqual({ newPerson: { fio: 'Анна Лебедева', age: '34', place: 'Купчино', hobby: 'бег', family: 'замужем' }, joinedOn: '2026-09-02' });
    expect(body).not.toHaveProperty('personKey');
  });

  test('без выбранного человека и без ФИО тела нет', () => {
    expect(buildAddBody({ mode: 'directory', personKey: null, joinedOn: '', note: '' })).toBeNull();
    expect(buildAddBody({ mode: 'new', person: { ...NO_PERSON, fio: '  ' }, joinedOn: '', note: '' })).toBeNull();
  });
});

describe('даты', () => {
  test('сегодня берётся по местному времени, а не по UTC', () => {
    expect(todayIso(new Date(2026, 9, 11, 0, 30))).toBe('2026-10-11');
    expect(todayIso(new Date(2026, 9, 11, 23, 59))).toBe('2026-10-11');
  });

  test('дата из будущего не допускается, сегодняшняя и прошлая допускаются', () => {
    expect(isFutureDate('2026-10-12', '2026-10-11')).toBe(true);
    expect(isFutureDate('2026-10-11', '2026-10-11')).toBe(false);
    expect(isFutureDate('2026-09-01', '2026-10-11')).toBe(false);
    expect(isFutureDate('', '2026-10-11')).toBe(false);
  });

  test('«9 октября» и «1 сентября 2026» разбираются строкой, без сдвига по часовому поясу', () => {
    expect(formatDayMonth('2026-10-09')).toBe('9 октября');
    expect(formatDayMonth('2026-10-09T23:30:00+03:00')).toBe('9 октября');
    expect(formatDayMonthYear('2026-09-01')).toBe('1 сентября 2026');
    expect(formatDayMonth(null)).toBe('');
    expect(formatDayMonthYear('мусор')).toBe('');
  });
});

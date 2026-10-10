/**
 * Исходные данные для режима фикстур. Вымышленные: имена, номера и адреса придуманы.
 * Основа — пример из прототипа, но поля подогнаны под типы контракта (`@contracts`).
 * Представления (предложения, матрица, корзины) считает build.ts, чтобы цифры не расходились.
 */

export type Slot = 'утро' | 'день' | 'вечер';

export interface RawGroup {
  id: number;
  no: number | null;
  leader: string;
  coLeader: string | null;
  phone: string | null;
  district: string;
  metro: string | null;
  /** Улица для подбора. В контракте у группы её пока нет (см. отчёт), в фикстурах нужна для подбора. */
  street: string | null;
  ages: string[];
  day: string | null;
  slot: Slot | null;
  status: string;
  acceptsNew: boolean;
  doNotRefer: boolean;
  people: number | null;
  capacity: number | null;
  verifiedDaysAgo: number | null;
  format: string | null;
  composition: string | null;
  coordinator: string | null;
  comment: string | null;
}

export interface RawRequest {
  id: number;
  fio: string;
  phone: string | null;
  age: string;
  ageLabel: string;
  district: string | null;
  place: string | null;
  days: string[];
  slot: Slot | null;
  street: string | null;
  source: string;
  status: string;
  waitingDays: number | null;
  callback: boolean;
  cancelled: boolean;
  finalGroupId: number | null;
  finalGroupText: string | null;
  note: string | null;
  log: { at: string | null; text: string }[];
}

export const TODAY_ISO = '2026-10-09';
export const GENERATED_AT = '2026-10-09T09:30:00+03:00';

export const AGE_COLUMNS = ['18–25', '26–35', '36–45', '46+'];
export const DISTRICTS = [
  'Приморский',
  'Выборгский',
  'Центральный',
  'Калининский',
  'Невский',
  'Красногвардейский',
  'Фрунзенский',
];
/** Справочник «район → соседние районы»; на сервере он тоже в данных, а не в коде. */
export const NEIGHBORS: Record<string, string[]> = {
  Приморский: ['Выборгский'],
  Выборгский: ['Приморский', 'Калининский'],
  Калининский: ['Выборгский', 'Красногвардейский', 'Центральный'],
  Красногвардейский: ['Калининский', 'Невский', 'Центральный'],
  Невский: ['Красногвардейский', 'Центральный'],
  Центральный: ['Калининский', 'Красногвардейский', 'Невский'],
  Фрунзенский: [],
};

const g = (x: Partial<RawGroup> & Pick<RawGroup, 'id' | 'leader' | 'district' | 'ages'>): RawGroup => ({
  no: null,
  coLeader: null,
  phone: null,
  metro: null,
  street: null,
  day: null,
  slot: null,
  status: 'Функционирует',
  acceptsNew: true,
  doNotRefer: false,
  people: null,
  capacity: 12,
  verifiedDaysAgo: null,
  format: null,
  composition: null,
  coordinator: null,
  comment: null,
  ...x,
});

export const RAW_GROUPS: RawGroup[] = [
  g({ id: 1, no: 12, leader: 'Ольга К.', phone: '79112003145', district: 'Приморский', metro: 'Комендантский пр.', street: 'Комендантский пр.', ages: ['18–25', '26–35'], day: 'Вт', slot: 'вечер', people: 8, capacity: 12, verifiedDaysAgo: 6, format: 'Смешанная', composition: 'Студенты и молодые специалисты', coordinator: 'Трофимова С.' }),
  g({ id: 2, no: 27, leader: 'Андрей М.', coLeader: 'Наталья М.', phone: '79212004477', district: 'Приморский', metro: 'Беговая', street: 'ул. Шаврова', ages: ['26–35', '36–45'], day: 'Чт', slot: 'вечер', people: 11, capacity: 12, verifiedDaysAgo: 14, format: 'Семейная', composition: 'Семьи с детьми', coordinator: 'Петров Г.' }),
  g({ id: 3, no: 31, leader: 'Марина Л.', phone: '79052006612', district: 'Выборгский', metro: 'Озерки', street: 'пр. Просвещения', ages: ['36–45', '46+'], day: 'Пн', slot: 'день', people: 6, capacity: 14, verifiedDaysAgo: 41, format: 'Женская', composition: 'Женщины', coordinator: 'Трофимова С.', comment: 'Просила не присылать новых до конца месяца, но места есть.' }),
  g({ id: 4, no: 8, leader: 'Игорь Т.', phone: '79312003390', district: 'Центральный', metro: 'Лиговский пр.', street: 'Лиговский пр.', ages: ['18–25'], day: 'Ср', slot: 'вечер', people: 9, capacity: 10, verifiedDaysAgo: 3, format: 'Молодёжная', composition: 'Молодёжь', coordinator: 'Лебедева А.' }),
  g({ id: 5, no: 15, leader: 'Светлана Р.', phone: '79112008851', district: 'Калининский', metro: 'Академическая', street: 'Гражданский пр.', ages: ['26–35', '36–45'], day: 'Сб', slot: 'утро', people: 5, capacity: 12, verifiedDaysAgo: 9, format: 'Смешанная', coordinator: 'Морозов Д.' }),
  g({ id: 6, no: 40, leader: 'Павел Д.', phone: '79992005502', district: 'Невский', metro: 'Ломоносовская', street: 'пр. Большевиков', ages: ['26–35'], day: 'Пт', slot: 'вечер', people: 12, capacity: 12, verifiedDaysAgo: 5, format: 'Мужская', composition: 'Мужчины', coordinator: 'Лебедева А.' }),
  g({ id: 7, no: 22, leader: 'Елена и Сергей Н.', phone: '79212007704', district: 'Красногвардейский', metro: 'Ладожская', street: 'Индустриальный пр.', ages: ['36–45', '46+'], people: 7, capacity: 12, verifiedDaysAgo: 63, format: 'Семейная', coordinator: 'Трофимова С.', comment: 'День и время уточнить: переносили встречи.' }),
  g({ id: 8, no: 19, leader: 'Дмитрий В.', district: 'Приморский', metro: 'Старая Деревня', ages: ['18–25', '26–35'], people: 4, capacity: 12, verifiedDaysAgo: 28, format: 'Смешанная', coordinator: 'Петров Г.' }),
  g({ id: 9, no: 35, leader: 'Анна С.', phone: '79052009930', district: 'Калининский', metro: 'Политехническая', ages: ['46+'], day: 'Вт', slot: 'день', people: 10, capacity: 14, verifiedDaysAgo: 11, format: 'Женская', coordinator: 'Лебедева А.' }),
  g({ id: 10, no: 3, leader: 'Виктор П.', phone: '79312001128', district: 'Выборгский', metro: 'Лесная', street: 'ул. Харченко', ages: ['26–35', '36–45'], day: 'Ср', slot: 'вечер', status: 'На паузе', acceptsNew: false, people: 5, capacity: 12, verifiedDaysAgo: 22, format: 'Смешанная', coordinator: 'Трофимова С.' }),
  g({ id: 11, no: 44, leader: 'Ксения Б.', phone: '79112006643', district: 'Центральный', metro: 'Владимирская', street: 'ул. Марата', ages: ['26–35'], day: 'Чт', slot: 'вечер', people: 6, capacity: 12, verifiedDaysAgo: 7, format: 'Смешанная', coordinator: 'Морозов Д.' }),
  g({ id: 12, no: null, leader: 'Татьяна Ф.', phone: '79212005519', district: 'Невский', metro: 'Новочеркасская', street: 'ул. Седова', ages: ['36–45', '46+'], day: 'Пн', slot: 'вечер', people: null, capacity: null, verifiedDaysAgo: null, format: 'Женская', coordinator: 'Морозов Д.', doNotRefer: true, comment: 'Новая группа без номера в реестре; пока никого не направлять.' }),
];

const r = (
  x: Partial<RawRequest> & Pick<RawRequest, 'id' | 'fio' | 'age' | 'district' | 'place' | 'source'>,
): RawRequest => ({
  phone: null,
  ageLabel: x.age,
  days: [],
  slot: null,
  street: null,
  status: 'Новая',
  waitingDays: 0,
  callback: false,
  cancelled: false,
  finalGroupId: null,
  finalGroupText: null,
  note: null,
  log: [],
  ...x,
});

const created = (src: string, days: number): { at: string; text: string } => ({
  at: dayMinus(days),
  text: src.startsWith('Бот') ? `Заявка создана ботом (${src.replace('Бот · ', '')})` : `Заявка перенесена из ${src.toLowerCase()}`,
});

function dayMinus(days: number): string {
  const d = new Date(Date.UTC(2026, 9, 9 - days));
  return d.toISOString().slice(0, 10);
}

export const RAW_REQUESTS: RawRequest[] = [
  r({ id: 1, fio: 'Мария Соколова', phone: '79111242418', age: '18–25', district: 'Приморский', place: 'м. Комендантский пр.', days: ['Вт', 'Чт'], slot: 'вечер', street: 'Комендантский пр.', source: 'Бот · Telegram', waitingDays: 0, log: [created('Бот · Telegram', 0)] }),
  r({ id: 2, fio: 'Алексей Орлов', phone: '79217000555', age: '26–35', ageLabel: '26-35', district: 'Приморский', place: 'Беговая', source: 'Бот · MAX', waitingDays: 2, log: [created('Бот · MAX', 2)] }),
  r({ id: 3, fio: 'Ирина Жукова', phone: '79051114208', age: '36–45', ageLabel: '35-45 лет', district: 'Выборгский', place: 'Озерки', days: ['Пн'], slot: 'день', source: 'Бот · Telegram', waitingDays: 3, log: [created('Бот · Telegram', 3), { at: dayMinus(1), text: 'Служитель просмотрел заявку' }] }),
  r({ id: 4, fio: 'Денис Громов', phone: '79310086377', age: '26–35', district: 'Невский', place: 'Ломоносовская', days: ['Чт', 'Пт'], slot: 'вечер', source: 'Бот · Telegram', waitingDays: 1, log: [created('Бот · Telegram', 1)] }),
  r({ id: 5, fio: 'Наталья Белова', phone: '79115520014', age: '46+', ageLabel: '46 и старше', district: 'Красногвардейский', place: 'Ладожская', source: 'Таблица', waitingDays: 9, note: 'Просила звонить после 18:00.', log: [created('Таблица', 9)] }),
  r({ id: 6, fio: 'Кирилл Фомин', phone: '79990313377', age: '18–25', district: 'Центральный', place: 'Лиговский пр.', days: ['Ср', 'Пт'], slot: 'вечер', street: 'Лиговский пр.', source: 'Бот · Telegram', waitingDays: 0, log: [created('Бот · Telegram', 0)] }),
  r({ id: 7, fio: 'Ольга Рябова', phone: '79509001499', age: '36–45', district: 'Калининский', place: 'Академическая', days: ['Сб'], slot: 'утро', source: 'Бот · MAX', waitingDays: 6, log: [created('Бот · MAX', 6)] }),
  r({ id: 8, fio: 'Станислав Ким', phone: '79046200038', age: '26–35', district: null, place: 'где-то у Пионерской', source: 'Бот · Telegram', waitingDays: 1, log: [created('Бот · Telegram', 1), { at: dayMinus(1), text: 'Район не определён по тексту «где-то у Пионерской»' }] }),
  r({ id: 9, fio: 'Галина Мартынова', phone: '79114772942', age: '46+', district: 'Выборгский', place: 'Проспект Просвещения', days: ['Пн', 'Ср'], slot: 'день', street: 'пр. Просвещения', source: 'Бот · Telegram', waitingDays: 2, log: [created('Бот · Telegram', 2)] }),
  r({ id: 10, fio: 'Артём Лебедев', phone: '79810035600', age: '26–35', district: 'Приморский', place: 'Старая Деревня', source: 'Бот · Telegram', status: 'Исполнена', waitingDays: 12, finalGroupId: 1, log: [created('Бот · Telegram', 12), { at: dayMinus(3), text: 'Утверждена: группа №12' }] }),
  r({ id: 11, fio: 'Вера Назарова', phone: '79218889100', age: '36–45', district: 'Фрунзенский', place: 'Купчино', source: 'Бот · MAX', waitingDays: 3, log: [created('Бот · MAX', 3)] }),
  r({ id: 12, fio: 'Георгий Шмелёв', phone: '79162274000', age: '26–35', district: 'Центральный', place: 'Маяковская', days: ['Чт'], slot: 'вечер', source: 'Таблица', waitingDays: 4, log: [created('Таблица', 4)] }),
  r({ id: 13, fio: 'Руслан Агеев', phone: '79521149000', age: '36–45', district: 'Приморский', place: 'Беговая', days: ['Чт'], slot: 'вечер', street: 'ул. Шаврова', source: 'Бот · Telegram', waitingDays: 0, log: [created('Бот · Telegram', 0)] }),
  r({ id: 14, fio: 'Лариса Кулик', phone: '79095503100', age: '36–45', district: 'Фрунзенский', place: 'Купчино', days: ['Пт'], source: 'Бот · Telegram', waitingDays: 2, log: [created('Бот · Telegram', 2)] }),
  r({ id: 15, fio: 'Игорь Пестов', phone: '79650081200', age: '26–35', district: 'Фрунзенский', place: 'Бухарестская', days: ['Пт', 'Сб'], slot: 'вечер', source: 'Бот · MAX', waitingDays: 1, log: [created('Бот · MAX', 1)] }),
  // Эльвире место в №27 отдано Руслану (последнее), поэтому ей предложена №31: пример «вытесненного» варианта.
  r({ id: 17, fio: 'Эльвира Волкова', phone: '79215550117', age: '36–45', district: 'Выборгский', place: 'Лесная', days: ['Чт'], slot: 'вечер', street: 'ул. Харченко', source: 'Бот · Telegram', waitingDays: 1, log: [created('Бот · Telegram', 1)] }),
  // Единственная подходящая группа №8 забирает Кирилл Фомин: пример «места разобраны».
  r({ id: 18, fio: 'Софья Крылова', phone: '79319990118', age: '18–25', district: 'Красногвардейский', place: 'Новочеркасская', days: ['Ср'], slot: 'вечер', source: 'Таблица', waitingDays: 5, log: [created('Таблица', 5)] }),
  // Слабый план: ближайшая группа в соседнем районе и в другое время.
  r({ id: 19, fio: 'Виталий Егоров', phone: '79810010119', age: '26–35', district: 'Невский', place: 'Рыбацкое', days: ['Пн'], slot: 'утро', source: 'Бот · MAX', waitingDays: 2, log: [created('Бот · MAX', 2)] }),
  // Отказ: в список заявок не попадает, но уменьшает «Всего» в плашке «Распределено X из Y».
  r({ id: 16, fio: 'Тимур Ахметов', phone: '79120004411', age: '26–35', district: 'Невский', place: 'Рыбацкое', source: 'Бот · Telegram', status: 'Аннулирована', cancelled: true, waitingDays: 20, log: [created('Бот · Telegram', 20), { at: dayMinus(15), text: 'Отказ: нашёл группу сам' }] }),
];

export const SERVANTS = ['Анна Л.', 'Пётр Г.'];

export interface RawPerson {
  key: string;
  fio: string;
  phone: string | null;
  ageLabel: string | null;
  district: string | null;
  from: string;
  mdgLabel: string;
  date: string | null;
}

/** Участники, у которых нет заявки: прошли анкету, но группу не ищут. */
export const RAW_EXTRA_PEOPLE: RawPerson[] = [
  { key: 'u1', fio: 'Дарья Ефимова', phone: '79110004002', ageLabel: '26–35', district: 'Приморский', from: 'Бот · Telegram', mdgLabel: 'Уже в группе', date: '2026-09-12' },
  { key: 'u2', fio: 'Михаил Громов', phone: '79210001755', ageLabel: '36–45', district: 'Калининский', from: 'Бот · MAX', mdgLabel: 'Ведёт группу', date: '2026-09-03' },
  { key: 'u3', fio: 'Софья Титова', phone: '79310002280', ageLabel: '18–25', district: 'Центральный', from: 'Бот · Telegram', mdgLabel: 'Не интересно', date: '2026-09-28' },
  { key: 'u4', fio: 'Юлия Орлова', phone: '79990003047', ageLabel: '26–35', district: 'Выборгский', from: 'Бот · Telegram', mdgLabel: 'Откроет свою группу', date: '2026-10-05' },
];

export const COORDINATOR_ROLES: Record<string, string> = {
  'Трофимова С.': 'Координатор',
  'Петров Г.': 'Координатор',
  'Лебедева А.': 'Старший координатор',
  'Морозов Д.': 'Координатор',
};

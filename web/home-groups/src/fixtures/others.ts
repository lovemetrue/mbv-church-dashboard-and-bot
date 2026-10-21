/**
 * Остальные обращения для режима фикстур: то, что не идёт в подбор группы, и аннулированная заявка
 * «хочу в группу», которую можно вернуть в работу. Вымышленные данные.
 * Порядок как у сервера: открытые сверху (сначала «перезвонить», потом давно ждущие), затем закрытые.
 */
import type { OtherItem, RequestTableFields } from '@contracts';
import { demoStrangeOf } from './strange';

/** Обращение без метки: метка накладывается при сборке (`buildOthers`), потому что её можно поставить в демо. */
type BaseOther = Omit<OtherItem, 'strange'>;
type RawOther = Omit<BaseOther, 'address' | 'schedule' | 'hobby' | 'profession' | 'family' | 'table'>;

/** Поля из таблицы церкви у демо-заявок пусты: их заполняют вручную. */
export function emptyTable(note: string | null): RequestTableFields {
  return { note, source: null, ministry: null, extra: null, recommended: null, recommendedAt: null, finalGroup: null, attendance: null };
}

/** Анкетные поля у большинства демо-обращений пусты: подставляем их здесь, чтобы не повторять в каждой записи. */
function baseOthers(): BaseOther[] {
  return rawOthers().map((o) => ({ address: null, schedule: null, hobby: null, profession: null, family: null, table: emptyTable(o.note), ...o }));
}

function rawOthers(): RawOther[] {
  return [
    {
      id: 201,
      type: 'question',
      typeLabel: 'Вопрос служителю',
      gist: 'Спрашивает, можно ли прийти на встречу группы с детьми.',
      reconcile: null,
      state: 'open',
      fio: 'Игорь Седов',
      phone: '79215550101',
      ageLabel: '36–45',
      place: 'Калининский, м. Гражданский пр.',
      status: 'Новая',
      source: 'Бот · Telegram',
      waitingDays: 6,
      callback: true,
      responsible: null,
      note: 'Спрашивает, можно ли привести детей на встречу.',
      cancelReason: null,
      original: [
        { label: 'Имя', value: 'Игорь Седов' },
        { label: 'Телефон', value: '+7 921 555-01-01' },
        { label: 'Возраст', value: '36–45' },
        { label: 'Где удобно', value: 'Калининский, м. Гражданский пр.' },
        { label: 'Вопрос', value: 'Можно ли прийти в группу с детьми?' },
      ],
      log: [
        { at: '2026-10-03', text: 'Заявка создана: вопрос служителю.' },
        { at: '2026-10-08', text: 'Отмечено «нужен звонок».' },
      ],
    },
    {
      id: 202,
      type: 'lead_group',
      typeLabel: 'Хочет открыть группу или дать дом',
      gist: 'Хочет открыть свою группу в Выборгском районе.',
      reconcile: null,
      state: 'open',
      fio: 'Юлия Громова',
      phone: '79215550102',
      ageLabel: '26–35',
      place: 'Выборгский, м. Лесная',
      status: 'Новая',
      source: 'Бот · MAX',
      waitingDays: 4,
      callback: false,
      responsible: 'Пётр Г.',
      note: null,
      cancelReason: null,
      // Кого можно направить в её будущую группу: двое ищущих из Выборгского, одному подбор уже предложил ДГ-0031.
      prospects: {
        futureGroup: null,
        unknownPlace: false,
        total: 2,
        items: [
          {
            requestId: 3, fio: 'Ирина Жукова', ageLabel: '35-45 лет', place: 'Озерки', score: 86, proposed: 'ДГ-0031',
            reasons: [{ tone: 'good', text: 'тот же район' }, { tone: 'good', text: 'возраст подходит' }],
          },
          {
            requestId: 9, fio: 'Галина Мартынова', ageLabel: '46+', place: 'Проспект Просвещения', score: 64, proposed: null,
            reasons: [{ tone: 'good', text: 'тот же район' }, { tone: 'neutral', text: 'день не совпал' }],
          },
        ],
      },
      original: [
        { label: 'Имя', value: 'Юлия Громова' },
        { label: 'Телефон', value: '+7 921 555-01-02' },
        { label: 'Возраст', value: '26–35' },
        { label: 'Где удобно', value: 'Выборгский, м. Лесная' },
        { label: 'Малая группа', value: 'Хочет открыть свою группу' },
      ],
      log: [
        { at: '2026-10-05', text: 'Заявка создана: хочет открыть группу.' },
        { at: '2026-10-07', text: 'В работе у: Пётр Г.' },
      ],
    },
    {
      // Ведущая ДГ-0112 (координатор Морозов Д.): на ней снята инструкция координатора.
      id: 213,
      type: 'lead_group',
      typeLabel: 'Хочет открыть группу или дать дом',
      gist: 'Хочет открыть женскую группу у себя дома на Новочеркасской.',
      reconcile: null,
      state: 'open',
      fio: 'Татьяна Фёдорова',
      phone: '79212005519',
      ageLabel: '46+',
      place: 'Невский, м. Новочеркасская',
      status: 'В работе',
      source: 'Бот · Telegram',
      waitingDays: 6,
      callback: false,
      responsible: 'Морозов Д.',
      note: null,
      cancelReason: null,
      prospects: {
        futureGroup: { id: 12, code: 'ДГ-0112' },
        unknownPlace: false,
        total: 3,
        items: [
          {
            requestId: 4, fio: 'Денис Громов', ageLabel: '26–35', place: 'Ломоносовская', score: 74, proposed: null,
            reasons: [{ tone: 'good', text: 'тот же район' }, { tone: 'neutral', text: 'возраст рядом' }],
          },
          {
            requestId: 19, fio: 'Виталий Егоров', ageLabel: '26–35', place: 'Рыбацкое', score: 68, proposed: null,
            reasons: [{ tone: 'good', text: 'тот же район' }, { tone: 'neutral', text: 'день не совпал' }],
          },
          {
            requestId: 18, fio: 'Софья Крылова', ageLabel: '18–25', place: 'Новочеркасская', score: 55, proposed: 'ДГ-0007',
            reasons: [{ tone: 'neutral', text: 'соседний район' }, { tone: 'good', text: 'рядом с метро' }],
          },
        ],
      },
      original: [
        { label: 'Имя', value: 'Татьяна Фёдорова' },
        { label: 'Малая группа', value: 'Хочет открыть свою группу' },
      ],
      log: [{ at: '2026-10-03', text: 'Заявка создана: хочет открыть группу.' }],
    },
    {
      id: 203,
      type: 'already_member',
      typeLabel: 'Уже состоит в группе',
      gist: 'Сообщает, что уже состоит в группе, но ведущего не назвали.',
      reconcile: {
        kind: 'member',
        status: 'noleader',
        text: 'В обращении не назван ведущий, поэтому группу по справочнику найти нельзя. Выберите группу вручную.',
        candidates: [],
      },
      state: 'open',
      fio: 'Анастасия Орлова',
      phone: null,
      ageLabel: '18–25',
      place: 'Центральный',
      status: 'Новая',
      source: 'Бот · Telegram',
      waitingDays: 2,
      callback: false,
      responsible: 'Анна Л.',
      note: null,
      cancelReason: null,
      original: [
        { label: 'Имя', value: 'Анастасия Орлова' },
        { label: 'Возраст', value: '18–25' },
        { label: 'Малая группа', value: 'Уже состою в группе' },
      ],
      log: [{ at: '2026-10-07', text: 'Заявка создана: уже состоит в группе.' }],
    },
    // Разбор по справочникам: по одному обращению на каждое состояние (ready, choose, none, nouser) и ещё одно готовое,
    // чтобы у «Разобрать все готовые» было больше одного. Ответственные заполнены у всех, чтобы «Никто не взял» оставалось за 201.
    {
      id: 206,
      type: 'already_member',
      typeLabel: 'Уже состоит в группе',
      gist: 'Состоит в группе, ведущая Ольга К., Приморский район.',
      reconcile: {
        kind: 'member',
        status: 'ready',
        text: 'Найдена одна группа: ДГ-0012, ведущая Ольга К. Достаточно подтвердить, и человек будет внесён в её состав.',
        candidates: [{ groupId: 1, code: 'ДГ-0012', leader: 'Ольга К.', district: 'Приморский', tier: 'exact', by: 'name' }],
      },
      state: 'open',
      fio: 'Мария Кузнецова',
      phone: '79215550106',
      ageLabel: '26–35',
      place: 'Приморский',
      status: 'Новая',
      source: 'Бот · Telegram',
      waitingDays: 3,
      callback: false,
      responsible: 'Анна Л.',
      note: null,
      cancelReason: null,
      original: [
        { label: 'Имя', value: 'Мария Кузнецова' },
        { label: 'Малая группа', value: 'Уже состою в группе' },
        { label: 'Ведущий', value: 'Ольга К.' },
      ],
      log: [{ at: '2026-10-09', text: 'Заявка создана: уже состоит в группе.' }],
    },
    {
      id: 207,
      type: 'already_member',
      typeLabel: 'Уже состоит в группе',
      gist: 'Состоит в группе, ведущий Павел Дмитриев, Невский район.',
      reconcile: {
        kind: 'member',
        status: 'choose',
        text: 'Точного совпадения нет, но есть похожая группа: ДГ-0040, ведущий Павел Д. Проверьте и выберите её или другую.',
        candidates: [{ groupId: 6, code: 'ДГ-0040', leader: 'Павел Д.', district: 'Невский', tier: 'likely', by: 'name' }],
      },
      state: 'open',
      fio: 'Сергей Волков',
      phone: '79215550107',
      ageLabel: '36–45',
      place: 'Невский',
      status: 'Новая',
      source: 'Бот · MAX',
      waitingDays: 3,
      callback: false,
      responsible: 'Анна Л.',
      note: null,
      cancelReason: null,
      original: [
        { label: 'Имя', value: 'Сергей Волков' },
        { label: 'Малая группа', value: 'Уже состою в группе' },
        { label: 'Ведущий', value: 'Павел Дмитриев' },
      ],
      log: [{ at: '2026-10-09', text: 'Заявка создана: уже состоит в группе.' }],
    },
    {
      id: 208,
      type: 'already_leader',
      typeLabel: 'Уже ведёт группу',
      gist: 'Ведёт группу в Приморском районе, встречи по средам.',
      reconcile: {
        kind: 'leader',
        status: 'choose',
        text: 'Нашли две группы с похожими ведущими. Выберите ту, которую ведёт этот человек.',
        candidates: [
          { groupId: 8, code: 'ДГ-0019', leader: 'Дмитрий В.', district: 'Приморский', tier: 'exact', by: 'phone' },
          { groupId: 2, code: 'ДГ-0027', leader: 'Андрей М.', district: 'Приморский', tier: 'likely', by: 'name' },
        ],
      },
      state: 'open',
      fio: 'Дмитрий Воронин',
      phone: '79215550108',
      ageLabel: '36–45',
      place: 'Приморский',
      status: 'Новая',
      source: 'Бот · Telegram',
      waitingDays: 2,
      callback: false,
      responsible: 'Анна Л.',
      note: null,
      cancelReason: null,
      original: [
        { label: 'Имя', value: 'Дмитрий Воронин' },
        { label: 'Малая группа', value: 'Уже веду группу' },
      ],
      log: [{ at: '2026-10-10', text: 'Заявка создана: уже ведёт группу.' }],
    },
    {
      id: 209,
      type: 'already_leader',
      typeLabel: 'Уже ведёт группу',
      gist: 'Ведёт группу на Васильевском острове, встречи по субботам.',
      reconcile: {
        kind: 'leader',
        status: 'none',
        text: 'Ведущего «Роман Белов» нет в справочнике групп. Выберите группу вручную или сначала заведите её в «Справочнике».',
        candidates: [],
      },
      state: 'open',
      fio: 'Роман Белов',
      phone: '79215550109',
      ageLabel: '26–35',
      place: 'Василеостровский',
      status: 'Новая',
      source: 'Бот · Telegram',
      waitingDays: 2,
      callback: false,
      responsible: 'Анна Л.',
      note: null,
      cancelReason: null,
      original: [
        { label: 'Имя', value: 'Роман Белов' },
        { label: 'Малая группа', value: 'Уже веду группу' },
      ],
      log: [{ at: '2026-10-10', text: 'Заявка создана: уже ведёт группу.' }],
    },
    {
      id: 210,
      type: 'already_leader',
      typeLabel: 'Уже ведёт группу',
      gist: 'Ведёт группу в Невском районе, встречи по понедельникам.',
      reconcile: {
        kind: 'leader',
        status: 'ready',
        text: 'Найдена одна группа: ДГ-0112, ведущая Татьяна Ф. Достаточно подтвердить, и группа будет связана с этим ведущим.',
        candidates: [{ groupId: 12, code: 'ДГ-0112', leader: 'Татьяна Ф.', district: 'Невский', tier: 'exact', by: 'phone' }],
      },
      state: 'open',
      fio: 'Татьяна Фёдорова',
      phone: '79212005519',
      ageLabel: '36–45',
      place: 'Невский',
      status: 'Новая',
      source: 'Форма регистрации',
      waitingDays: 1,
      callback: false,
      responsible: 'Анна Л.',
      note: null,
      cancelReason: null,
      original: [
        { label: 'Имя', value: 'Татьяна Фёдорова' },
        { label: 'Малая группа', value: 'Уже веду группу' },
      ],
      log: [{ at: '2026-10-11', text: 'Заявка создана: уже ведёт группу.' }],
    },
    {
      id: 211,
      type: 'already_member',
      typeLabel: 'Уже состоит в группе',
      gist: 'Состоит в группе у Ольги К.; обращение заведено вручную.',
      reconcile: {
        kind: 'member',
        status: 'nouser',
        text: 'У обращения нет регистрации человека: оно заведено вручную. Состав группы в таком случае пополняется только руками, в «Справочнике → Группы».',
        candidates: [],
      },
      state: 'open',
      fio: 'Олег Фомин',
      phone: null,
      ageLabel: null,
      place: null,
      status: 'Новая',
      source: 'Вручную',
      waitingDays: 1,
      callback: false,
      responsible: 'Анна Л.',
      note: null,
      cancelReason: null,
      original: [],
      log: [{ at: '2026-10-11', text: 'Заявка заведена вручную: уже состоит в группе.' }],
    },
    {
      id: 204,
      type: 'lead_group',
      typeLabel: 'Хочет открыть группу или дать дом',
      gist: 'Хочет открыть группу, предлагает помещение.',
      reconcile: null,
      state: 'done',
      fio: 'Виктор Лебедев',
      phone: '79215550104',
      ageLabel: '46+',
      place: 'Московский',
      status: 'Исполнена',
      source: 'Таблица',
      waitingDays: 19,
      callback: false,
      responsible: 'Анна Л.',
      note: 'Встретились, обсудили помещение.',
      cancelReason: null,
      original: [],
      log: [
        { at: '2026-09-22', text: 'Заявка перенесена из таблицы.' },
        { at: '2026-10-02', text: 'Закрыта: обработана.' },
      ],
    },
    {
      id: 212,
      type: 'already_leader',
      typeLabel: 'Уже ведёт группу',
      gist: 'Уже ведёт группу, просила внести её в справочник.',
      reconcile: null,
      state: 'done',
      fio: 'Нина Кравец',
      phone: '79215550112',
      ageLabel: '46+',
      place: 'Фрунзенский',
      status: 'Исполнена',
      source: 'Бот',
      waitingDays: 6,
      callback: false,
      responsible: 'Анна Л.',
      note: 'Группу внесли в справочник.',
      cancelReason: null,
      original: [],
      log: [{ at: '2026-10-12', text: 'Закрыта: обработана.' }],
    },
    {
      id: 205,
      type: 'join_group',
      typeLabel: 'Хочет в домашнюю группу',
      gist: 'Заявка на вступление в группу: позже группа нашлась сама.',
      reconcile: null,
      state: 'cancelled',
      fio: 'Тимур Ахметов',
      phone: '79215550105',
      ageLabel: '26–35',
      place: 'Приморский, м. Беговая',
      status: 'Аннулирована',
      source: 'Бот · Telegram',
      waitingDays: 12,
      callback: false,
      responsible: null,
      note: null,
      cancelReason: 'Нашли группу сами',
      original: [
        { label: 'Имя', value: 'Тимур Ахметов' },
        { label: 'Телефон', value: '+7 921 555-01-05' },
        { label: 'Возраст', value: '26–35' },
        { label: 'Где удобно', value: 'Приморский, м. Беговая' },
        { label: 'Малая группа', value: 'Хочу вступить в группу' },
      ],
      log: [
        { at: '2026-09-29', text: 'Заявка создана: хочет в группу.' },
        { at: '2026-10-06', text: 'Аннулирована: нашли группу сами.' },
      ],
    },
  ];
}

/**
 * Демо-состояние: какие обращения «разобрали» в режиме фикстур. Сервера нет, поэтому без этого кнопка «Внести в состав
 * и закрыть» ничего бы не меняла и список выглядел бы сломанным. Живёт в модуле, как «отправленные» доп. вопросы.
 */
const reconciledDemo = new Set<number>();

/** Для тестов: вернуть демо в состояние «ничего не разбирали». */
export function resetDemoReconciled(): void {
  reconciledDemo.clear();
}

/** Обращение, которое сервер разобрал бы по одной группе точно, как `reconcile-ready`. */
const isReadyExactly = (o: BaseOther): boolean =>
  o.state === 'open' && o.reconcile?.status === 'ready' && o.reconcile.candidates.filter((c) => c.tier === 'exact').length === 1;

/** Разобрать одно обращение: оно уходит в закрытые. Возвращает false, если оно уже закрыто или не найдено. */
export function reconcileDemoOther(id: number): boolean {
  const item = baseOthers().find((o) => o.id === id);
  if (!item || item.state !== 'open' || reconciledDemo.has(id)) return false;
  reconciledDemo.add(id);
  return true;
}

/** Разобрать сразу все готовые из списка: чужие номера, закрытые и не «готовые» пропускаются. */
export function reconcileDemoReady(ids: readonly number[]): { applied: number; skipped: number } {
  let applied = 0;
  for (const id of new Set(ids)) {
    const item = baseOthers().find((o) => o.id === id);
    if (item && !reconciledDemo.has(id) && isReadyExactly(item)) {
      reconciledDemo.add(id);
      applied++;
    }
  }
  return { applied, skipped: new Set(ids).size - applied };
}

/**
 * Обращения для демо: открытые сверху, как у сервера; разобранные в этой сессии стоят первыми среди закрытых
 * («свежие первыми»), и разбор у них уже снят.
 */
export function buildOthers(): OtherItem[] {
  const all = baseOthers().map<OtherItem>((base) => {
    const o: OtherItem = { ...base, strange: demoStrangeOf(base.phone, `o${base.id}`) };
    return reconciledDemo.has(o.id)
      ? {
          ...o,
          state: 'done',
          status: 'Исполнена',
          reconcile: null,
          log: [...o.log, { at: '2026-10-12', text: 'Закрыта: обработана (разобрано по справочникам).' }],
        }
      : o;
  });
  const open = all.filter((o) => o.state === 'open');
  const justDone = all.filter((o) => o.state !== 'open' && reconciledDemo.has(o.id));
  const rest = all.filter((o) => o.state !== 'open' && !reconciledDemo.has(o.id));
  return [...open, ...justDone, ...rest];
}

import { describe, expect, test } from 'vitest';
import { handleUpdate, type Draft, type FsmResult, type FsmState } from '../src/core/fsm.js';
import { CB, T } from '../src/core/texts.js';
import type { IncomingUpdate, UpdateCtx } from '../src/core/platform.js';

const ctx: UpdateCtx = { platform: 'telegram', platformUserId: '42', chatId: '42' };

const start = (): IncomingUpdate => ({ kind: 'start', ctx });
const text = (t: string): IncomingUpdate => ({ kind: 'text', ctx, text: t });
const tap = (data: string): IncomingUpdate => ({ kind: 'callback', ctx, data, callbackId: 'cb1' });
const contact = (phone: string, isOwn = true): IncomingUpdate => ({ kind: 'contact', ctx, phone, isOwn });

const run = (state: FsmState, draft: Draft, update: IncomingUpdate, extra: Partial<Parameters<typeof handleUpdate>[0]> = {}) =>
  handleUpdate({ state, draft, update, registered: false, ...extra });

const said = (r: FsmResult) => r.actions.map((a) => a.text).join('\n');
const buttons = (r: FsmResult) =>
  r.actions.at(-1)?.buttons?.flat().map((b) => (b.kind === 'callback' ? b.data : b.url)) ?? [];

/** Обязательные ответы: с них начинаются все ветки. */
const REQUIRED: Draft = {
  consent: true,
  fio: 'Иванов Иван Иванович',
  phone: '+79001234567',
  church: 'МБВ Колизей',
};

describe('согласие на обработку данных', () => {
  test('/start показывает, какие данные собираем, и ссылки на документы', () => {
    const r = run('idle', {}, start());
    expect(r.state).toBe('await_consent');
    expect(said(r)).toContain('mbv.spb.ru');
    expect(buttons(r)).toEqual(expect.arrayContaining([CB.consentYes, CB.consentNo]));
  });

  test('отказ прекращает регистрацию и ничего не сохраняет', () => {
    const r = run('await_consent', {}, tap(CB.consentNo));
    expect(r.effects).toEqual([]);
    expect(r.state).toBe('idle');
    expect(said(r)).toContain('/start');
  });

  test('согласие фиксируется отдельным эффектом и сразу спрашивают ФИО', () => {
    const r = run('await_consent', {}, tap(CB.consentYes));
    expect(r.effects).toEqual([{ kind: 'consent' }]);
    expect(r.state).toBe('await_fio');
    expect(said(r)).toContain('ФИО');
  });

  test('на кнопке согласия нет галочки: она выглядела бы уже нажатой', () => {
    const r = run('await_consent', {}, start());
    expect(said(r)).toContain('Кампанию');
    expect(r.actions.at(-1)?.buttons?.flat().map((b) => b.text)).toEqual(['Согласен', 'Не согласен']);
  });

  test('до согласия анкета не начинается', () => {
    const r = run('await_consent', {}, text('Иванов Иван Иванович'));
    expect(r.state).toBe('await_consent');
    expect(r.draft.fio).toBeUndefined();
  });
});

describe('обязательные вопросы', () => {
  test('ФИО из трёх слов сохраняется целиком', () => {
    const r = run('await_fio', { consent: true }, text('Иванов Иван Иванович'));
    expect(r.state).toBe('await_phone');
    expect(r.draft.fio).toBe('Иванов Иван Иванович');
    expect(r.effects).toEqual([{ kind: 'save', patch: { fio: 'Иванов Иван Иванович' } }]);
  });

  test('одно слово вместо ФИО просят уточнить', () => {
    const r = run('await_fio', { consent: true }, text('Иван'));
    expect(r.state).toBe('await_fio');
    expect(r.draft.fio).toBeUndefined();
  });

  // Настоящий случай из журнала: «hjlbjyjd lfdbl» — это «Родионов Давид», набранное
  // при английской раскладке. Проверка на слова и цифры такое пропускала.
  test.each([
    ['латиница', 'Ivanov Ivan'],
    ['английская раскладка', 'hjlbjyjd lfdbl'],
    ['латиница вперемешку с русским', 'Иванов Ivan'],
    ['одни знаки', '-- --'],
  ])('ФИО не русскими буквами не принимаем: %s', (_case, input) => {
    const r = run('await_fio', { consent: true }, text(input));
    expect(r.state).toBe('await_fio');
    expect(r.draft.fio).toBeUndefined();
    expect(said(r)).toContain('русскими буквами');
  });

  test.each([
    ['двойная фамилия через дефис', 'Кузнецова-Иванова Анна-Мария'],
    ['ё на месте', 'Алёшин Пётр'],
    ['украинские буквы', 'Петренко Олексій'],
  ])('русское ФИО проходит: %s', (_case, input) => {
    const r = run('await_fio', { consent: true }, text(input));
    expect(r.state).toBe('await_phone');
    expect(r.draft.fio).toBe(input);
  });

  test('имя ведущего латиницей тоже не принимаем', () => {
    const r = run('await_leader_name', { ...REQUIRED, mdgStatus: 'member' }, text('Ivan Petrov'));
    expect(r.state).toBe('await_leader_name');
    expect(r.draft.leaderName).toBeUndefined();
    expect(said(r)).toContain('русскими буквами');
  });

  test('телефон из контакта нормализуется и сохраняется', () => {
    const r = run('await_phone', { consent: true, fio: 'Иванов Иван' }, contact('89001234567'));
    expect(r.state).toBe('await_church');
    expect(r.draft.phone).toBe('+79001234567');
    expect(r.effects).toEqual([{ kind: 'save', patch: { phone: '+79001234567' } }]);
  });

  test('чужой контакт не принимается', () => {
    const r = run('await_phone', { consent: true }, contact('79007654321', false));
    expect(r.state).toBe('await_phone');
    expect(r.draft.phone).toBeUndefined();
  });

  test('телефон текстом не принимается — только кнопкой «поделиться», иначе можно вписать чужой', () => {
    const r = run('await_phone', { consent: true }, text('+7 900 123-45-67'));
    expect(r.state).toBe('await_phone');
    expect(r.draft.phone).toBeUndefined();
    expect(said(r)).toContain('кнопк');
  });

  test('вопрос про церковь показывает пять вариантов', () => {
    const r = run('await_phone', { consent: true }, contact('79001234567'));
    expect(said(r)).toContain(T.askChurch);
    expect(buttons(r).length).toBe(5);
  });

  test('выбор церкви МБВ ведёт к вопросу про малую группу', () => {
    const r = run('await_church', { consent: true, fio: 'Иванов Иван', phone: '+79001234567' }, tap('church:0'));
    expect(r.state).toBe('await_mdg');
    expect(r.draft.church).toBe('МБВ Колизей');
  });
});

describe('человек не из МБВ', () => {
  const draft = { consent: true, fio: 'Иванов Иван', phone: '+79001234567' };

  test('«другая церковь» открывает второй экран со списком церквей', () => {
    // Индекс «другой церкви» — предпоследний в списке вариантов.
    const r = run('await_church', draft, tap('church:3'));
    expect(r.state).toBe('await_other_church');
    // Сама «Другая церковь» ответом не считается: это переход, а не выбор.
    expect(r.draft.church).toBeUndefined();
  });

  test('конкретная церковь из второго экрана сохраняется и ведёт к вопросу про группу', () => {
    const r = run('await_other_church', draft, tap('church2:0'));
    expect(r.draft.church).toContain('Кингисепп');
    expect(r.state).toBe('await_mdg');
  });

  test('«не посещаю церковь» тоже ведёт к вопросу про малую группу', () => {
    const r = run('await_church', draft, tap('church:4'));
    expect(r.draft.church).toBe('Не посещаю церковь');
    expect(r.state).toBe('await_mdg');
  });

  test('не из МБВ предлагают только узнать про группы и присоединиться', () => {
    // Звать вести или открывать группу человека из другой церкви преждевременно.
    const r = run('await_church', draft, tap('church:4'));
    expect(buttons(r)).toEqual([CB.mdgAbout, CB.mdgJoin]);
  });

  test('справка про малую группу не закрывает вопрос', () => {
    const r = run('await_mdg', { ...draft, church: 'Не посещаю церковь' }, tap(CB.mdgAbout));
    expect(r.state).toBe('await_mdg');
    expect(r.draft.mdgStatus).toBeUndefined();
    expect(buttons(r)).toEqual([CB.mdgAbout, CB.mdgJoin]);
  });

  test('подтверждение завершает регистрацию человека не из МБВ', () => {
    const r = run('summary', { ...draft, church: 'Другая церковь' }, tap(CB.confirm));
    expect(r.state).toBe('menu');
    expect(r.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'finish', complete: true })]),
    );
  });
});

describe('ветка «готов открыть группу»', () => {
  test('спрашивает район, затем возрастную категорию, затем сводку', () => {
    const chosen = run('await_mdg', REQUIRED, tap(CB.mdgOpen));
    expect(chosen.state).toBe('await_location');
    expect(chosen.draft.mdgStatus).toBe('open');
    expect(said(chosen)).toContain('станции метро');

    const located = run('await_location', chosen.draft, text('Приморский, м. Пионерская'));
    expect(located.state).toBe('await_age');
    expect(located.draft.location).toBe('Приморский, м. Пионерская');

    // Возраст выбирают кнопкой, а не пишут числом: быстрее и без ошибок ввода.
    const aged = run('await_age', located.draft, tap('age:2'));
    expect(aged.state).toBe('summary');
    expect(aged.draft.age).toBe('25-40');
  });

  test('возраст числом не принимается: ждём кнопку', () => {
    const draft: Draft = { ...REQUIRED, mdgStatus: 'open', location: 'ул. Ленина 5' };
    const r = run('await_age', draft, text('34'));
    expect(r.state).toBe('await_age');
    expect(r.draft.age).toBeUndefined();
  });

  test('«готов предоставить дом» идёт тем же путём, но записывается отдельно', () => {
    // Координатору разница важна: одному нужен ведущий, другому — место.
    const r = run('await_mdg', REQUIRED, tap(CB.mdgHome));
    expect(r.state).toBe('await_location');
    expect(r.draft.mdgStatus).toBe('home');
  });

  test('в подтверждении благодарят за готовность открыть дом', () => {
    const draft: Draft = { ...REQUIRED, mdgStatus: 'open', location: 'ул. Ленина 5', age: '25-40' };
    const r = run('summary', draft, tap(CB.confirm));
    expect(said(r)).toContain('координатор служения');
  });
});

describe('у кого уже есть действующая группа', () => {
  // Раньше отказывали сразу на выборе, чтобы не гонять человека по анкете
  // впустую. Теперь заявка уходит служителю в любом случае — пусть сверяет
  // сам, — так что впустую заполнять уже нечего: анкета идёт обычным путём.
  test('«готов открыть» не блокируется выбором', () => {
    const r = run('await_mdg', REQUIRED, tap(CB.mdgOpen), { leadPhoneTaken: 'group' });
    expect(r.state).toBe('await_location');
    expect(r.draft.mdgStatus).toBe('open');
  });

  test('«готов предоставить дом» тоже не блокируется', () => {
    const r = run('await_mdg', REQUIRED, tap(CB.mdgHome), { leadPhoneTaken: 'group' });
    expect(r.state).toBe('await_location');
    expect(r.draft.mdgStatus).toBe('home');
  });

  test('остальные варианты сверка и раньше не трогала', () => {
    // Человек с группой вполне может выбрать «я ведущий» — это как раз его случай.
    const r = run('await_mdg', REQUIRED, tap(CB.mdgLeader), { leadPhoneTaken: 'group' });
    expect(r.state).toBe('summary');
    expect(r.draft.mdgStatus).toBe('leader');
  });

  test('на подтверждении сообщают про действующую группу, но заявку всё равно заводят', () => {
    const draft: Draft = { ...REQUIRED, mdgStatus: 'open', location: 'ул. Ленина 5', age: '25-40' };
    const r = run('summary', draft, tap(CB.confirm), { leadPhoneTaken: 'group' });
    expect(said(r)).toContain('уже записана действующая');
    expect(r.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'create_request', type: 'lead_group' })]),
    );
  });
});

describe('ветка «хочу присоединиться к группе»', () => {
  test('после района сразу возраст, а потом сводка: про компанию не спрашивают', () => {
    const draft: Draft = { ...REQUIRED, mdgStatus: 'join' };
    const located = run('await_location', draft, text('Приморский'));
    expect(located.state).toBe('await_age');

    const aged = run('await_age', located.draft, tap('age:1'));
    expect(aged.state).toBe('summary');
    expect(aged.draft.age).toBe('18-25');
  });

  test('ищущему группу формулировка вопроса своя', () => {
    const r = run('await_mdg', REQUIRED, tap(CB.mdgJoin));
    expect(said(r)).toContain('удобно');
  });

  test('заявка служителю создаётся при подтверждении', () => {
    const draft: Draft = { ...REQUIRED, mdgStatus: 'join', location: 'ул. Ленина 5', age: '25-40' };
    const r = run('summary', draft, tap(CB.confirm));
    expect(r.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'create_request', type: 'join_group' })]),
    );
    expect(said(r)).toContain('Миссия Благая Весть');
  });
});

describe('ветка «уже состою в МДГ»', () => {
  test('спрашивает ведущего и на этом заканчивает: возраст здесь не нужен', () => {
    const chosen = run('await_mdg', REQUIRED, tap(CB.mdgMember));
    expect(chosen.state).toBe('await_leader_name');

    const named = run('await_leader_name', chosen.draft, text('Петров Пётр'));
    expect(named.state).toBe('summary');
    expect(named.draft.leaderName).toBe('Петров Пётр');
    expect(named.draft.age).toBeUndefined();
  });

  test('без имени ведущего дальше не пускают: вопрос обязательный', () => {
    const r = run('await_leader_name', { ...REQUIRED, mdgStatus: 'member' }, text('П'));
    expect(r.state).toBe('await_leader_name');
    expect(r.draft.leaderName).toBeUndefined();
  });

  test('локацию у состоящего в группе не спрашивают', () => {
    const chosen = run('await_mdg', REQUIRED, tap(CB.mdgMember));
    expect(said(chosen)).not.toContain(T.askLocationJoin);
  });

  test('при подтверждении тоже заводится заявка — служителю есть, что сверить', () => {
    const draft: Draft = { ...REQUIRED, mdgStatus: 'member', leaderName: 'Петров Пётр' };
    const r = run('summary', draft, tap(CB.confirm));
    expect(r.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'create_request', type: 'already_member' })]),
    );
  });
});

describe('ветка «я веду МДГ»', () => {
  test('уточняющих вопросов нет, сразу сводка', () => {
    const r = run('await_mdg', REQUIRED, tap(CB.mdgLeader));
    expect(r.state).toBe('summary');
    expect(r.draft.mdgStatus).toBe('leader');
  });

  test('при подтверждении тоже заводится заявка — служителю есть, что сверить', () => {
    const draft: Draft = { ...REQUIRED, mdgStatus: 'leader' };
    const r = run('summary', draft, tap(CB.confirm));
    expect(r.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'create_request', type: 'already_leader' })]),
    );
  });
});

describe('кнопка «вернуться»', () => {
  test('есть на уточняющих вопросах', () => {
    const r = run('await_mdg', REQUIRED, tap(CB.mdgOpen));
    expect(buttons(r)).toContain(CB.back);
  });

  test('на сводке кнопки уже нет: там уже могли пройти район и возраст, и «вернуться» стирало бы их незаметно', () => {
    const r = run('await_mdg', REQUIRED, tap(CB.mdgLeader));
    expect(r.state).toBe('summary');
    expect(buttons(r)).not.toContain(CB.back);
  });

  test('если данные всё же придут (старая кнопка), обработчик по-прежнему возвращает к выбору', () => {
    const draft: Draft = { ...REQUIRED, mdgStatus: 'leader' };
    const r = run('summary', draft, tap(CB.back));
    expect(r.state).toBe('await_mdg');
    expect(r.draft.mdgStatus).toBeUndefined();
    expect(r.draft.fio).toBe(REQUIRED.fio);
  });

  test('возвращает к выбору про малую группу и стирает ответы отменённой ветки', () => {
    const draft: Draft = { ...REQUIRED, mdgStatus: 'open', location: 'ул. Ленина 5' };
    const r = run('await_age', draft, tap(CB.back));
    expect(r.state).toBe('await_mdg');
    expect(r.draft.mdgStatus).toBeUndefined();
    expect(r.draft.location).toBeUndefined();
    // Обязательные ответы при этом остаются: заполнять анкету заново не нужно.
    expect(r.draft.fio).toBe(REQUIRED.fio);
    expect(r.draft.church).toBe(REQUIRED.church);
  });

  test('досрочно завершить регистрацию больше нельзя', () => {
    const r = run('await_location', { ...REQUIRED, mdgStatus: 'join' }, tap('reg:finish'));
    expect(r.state).toBe('await_location');
    expect(r.effects).toEqual([]);
  });
});

describe('сводка и подтверждение', () => {
  const draft: Draft = {
    ...REQUIRED,
    mdgStatus: 'join',
    location: 'ул. Ленина 5',
    age: 34,
    companions: 'с женой',
  };

  test('показывает всё, что человек сообщил, и ссылку на политику', () => {
    const r = run('await_age', { ...draft, age: undefined }, tap('age:2'));
    const shown = said(r);
    expect(shown).toContain('Иванов Иван Иванович');
    expect(shown).toContain('+7 900 123-45-67');
    expect(shown).toContain('МБВ Колизей');
    expect(shown).toContain('25-40');
    expect(shown).toContain('mbv.spb.ru');
  });

  test('на кнопке подтверждения нет галочки', () => {
    const r = run('await_age', { ...draft, age: undefined }, tap('age:2'));
    expect(r.actions.at(-1)?.buttons?.flat()[0]?.text).toBe('Всё верно, зарегистрировать');
  });

  test('подтверждение завершает регистрацию полностью', () => {
    const r = run('summary', draft, tap(CB.confirm));
    expect(r.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'finish', complete: true })]),
    );
    expect(r.state).toBe('menu');
  });

  test('«заполнить заново» начинает с ФИО, согласие переспрашивать не нужно', () => {
    const r = run('summary', draft, tap(CB.redo));
    expect(r.state).toBe('await_fio');
    expect(r.draft.consent).toBe(true);
    expect(r.draft.fio).toBeUndefined();
  });
});

describe('меню и статус', () => {
  const registered = (patch: Partial<NonNullable<Parameters<typeof handleUpdate>[0]['participant']>> = {}) => ({
    registered: true,
    participant: {
      complete: true,
      registrationNo: 7,
      mdgStatus: 'member' as const,
      kitIssued: false,
      ...patch,
    },
  });

  test('статус состоящего в группе говорит, когда получить набор', () => {
    const r = run('menu', REQUIRED, tap(CB.menuStatus), registered());
    expect(said(r)).toContain('можете получить набор');
  });

  test('статус ждущего направления говорит про координатора', () => {
    const r = run('menu', REQUIRED, tap(CB.menuStatus), registered({ mdgStatus: 'join' }));
    expect(said(r)).toContain('ждёте направления');
  });

  test('статус показывает номер регистрации', () => {
    const r = run('menu', REQUIRED, tap(CB.menuStatus), registered());
    expect(said(r)).toContain('7');
  });

  test('если набор уже выдан, статус это показывает', () => {
    const r = run('menu', REQUIRED, tap(CB.menuStatus), registered({ kitIssued: true }));
    expect(said(r)).toContain('уже получили');
  });

  test('кнопки «дозаполнить анкету» в меню больше нет', () => {
    // Досрочного завершения нет, значит и незаполненной анкеты не бывает.
    const r = run('menu', REQUIRED, tap(CB.menuStatus), registered({ complete: false }));
    expect(buttons(r)).not.toContain('menu:resume');
  });

  test('на свободный текст бот объясняет, что переписки в боте нет', () => {
    const r = run('menu', REQUIRED, text('а можно вопрос?'), registered());
    expect(r.state).toBe('menu');
    expect(r.effects).toEqual([]);
    expect(said(r)).toContain('не читает сообщения');
  });

  test('кнопки «задать вопрос» в меню больше нет', () => {
    const r = run('menu', REQUIRED, start(), registered());
    expect(buttons(r)).not.toContain('menu:question');
  });

  test('«открыть свою МДГ» создаёт заявку координатору', () => {
    const r = run('menu', REQUIRED, tap(CB.menuLead), registered());
    expect(r.effects).toEqual([expect.objectContaining({ kind: 'create_request', type: 'lead_group' })]);
  });

  test('повторное нажатие «открыть свою МДГ» заявку не дублирует', () => {
    const r = run('menu', REQUIRED, tap(CB.menuLead), { ...registered(), openRequests: ['lead_group'] });
    expect(r.effects).toEqual([]);
  });

  test('ведущему действующей группы объясняем про координатора, но заявку заводим — пусть сверит', () => {
    const r = run('menu', REQUIRED, tap(CB.menuLead), { ...registered(), leadPhoneTaken: 'group' });
    expect(r.effects).toEqual([expect.objectContaining({ kind: 'create_request', type: 'lead_group' })]);
    expect(said(r)).toContain(T.leadPhoneIsLeader);
  });

  test('анкета со «хочу открыть» по занятому телефону заявку тоже заводит', () => {
    // Вторая точка, где рождается заявка: подтверждение анкеты. Регистрация,
    // заявка и предупреждение про действующую группу — всё сразу.
    const draft: Draft = { ...REQUIRED, mdgStatus: 'open', location: 'ул. Ленина 5', age: 34 };
    const r = run('summary', draft, tap(CB.confirm), { leadPhoneTaken: 'group' });

    expect(r.effects).toEqual([
      expect.objectContaining({ kind: 'save' }),
      expect.objectContaining({ kind: 'finish' }),
      expect.objectContaining({ kind: 'create_request', type: 'lead_group' }),
    ]);
    expect(said(r)).toContain(T.leadPhoneIsLeader);
  });

  test('анкета со «хочу открыть» по свободному телефону заявку создаёт', () => {
    const draft: Draft = { ...REQUIRED, mdgStatus: 'open', location: 'ул. Ленина 5', age: 34 };
    const r = run('summary', draft, tap(CB.confirm));

    expect(r.effects).toEqual([
      expect.objectContaining({ kind: 'save' }),
      expect.objectContaining({ kind: 'finish' }),
      expect.objectContaining({ kind: 'create_request', type: 'lead_group' }),
    ]);
  });

  test('/start у зарегистрированного открывает меню, не сбрасывая анкету', () => {
    const r = run('menu', REQUIRED, start(), registered());
    expect(r.state).toBe('menu');
    expect(r.effects).toEqual([]);
  });
});

describe('кнопка «Задать вопрос»', () => {
  const REGISTERED = { registered: true, participant: { complete: true, registrationNo: 7 } } as const;

  test('кнопки в меню больше нет: задать вопрос некому — переписки с участником в боте нет', () => {
    const r = run('menu', REQUIRED, tap(CB.menuStatus), REGISTERED);
    expect(buttons(r)).not.toContain(CB.menuAsk);
  });

  test('нажатие просит написать вопрос и ждёт текст', () => {
    const r = run('menu', REQUIRED, tap(CB.menuAsk), REGISTERED);
    expect(r.state).toBe('await_question');
    expect(said(r)).toContain('вопрос');
    // Должна быть возможность передумать.
    expect(buttons(r)).toContain(CB.cancelQuestion);
    expect(r.effects).toEqual([]);
  });

  test('текст вопроса создаёт заявку и возвращает в меню', () => {
    const r = run('await_question', REQUIRED, text('А можно прийти с ребёнком?'), REGISTERED);
    expect(r.state).toBe('menu');
    expect(r.effects).toEqual([
      { kind: 'create_request', type: 'question', text: 'А можно прийти с ребёнком?' },
    ]);
    expect(said(r)).toContain(T.questionAccepted);
  });

  test('слишком короткий вопрос переспрашивает, а не заводит пустую заявку', () => {
    const r = run('await_question', REQUIRED, text('?'), REGISTERED);
    expect(r.state).toBe('await_question');
    expect(r.effects).toEqual([]);
    expect(said(r)).toContain('подробнее');
  });

  test('«Отмена» возвращает в меню без заявки', () => {
    const r = run('await_question', REQUIRED, tap(CB.cancelQuestion), REGISTERED);
    expect(r.state).toBe('menu');
    expect(r.effects).toEqual([]);
  });

  test('несколько вопросов подряд разрешены: у человека их может быть много', () => {
    const r = run('menu', REQUIRED, tap(CB.menuAsk), {
      ...REGISTERED,
      openRequests: ['question'],
      openQuestions: 1,
    });
    expect(r.state).toBe('await_question');
  });

  test('но больше трёх открытых не принимаем, чтобы не завалить служителей', () => {
    const r = run('menu', REQUIRED, tap(CB.menuAsk), {
      ...REGISTERED,
      openRequests: ['question'],
      openQuestions: 3,
    });
    expect(r.state).toBe('menu');
    expect(r.effects).toEqual([]);
    expect(said(r)).toContain(T.questionTooMany);
  });

  test('незарегистрированный к вопросам не попадает: сначала анкета', () => {
    const r = run('menu', {}, tap(CB.menuAsk), { registered: false });
    expect(r.state).not.toBe('await_question');
    expect(r.effects.some((e) => e.kind === 'create_request')).toBe(false);
  });
});

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
  church: 'МБВ (Колизей)',
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

  test('согласие фиксируется отдельным эффектом и бот предупреждает про уточняющие вопросы', () => {
    const r = run('await_consent', {}, tap(CB.consentYes));
    expect(r.effects).toEqual([{ kind: 'consent' }]);
    expect(r.state).toBe('await_fio');
    expect(said(r)).toMatch(/2–3 уточняющих|Завершить регистрацию/);
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

  test('вопрос про церковь показывает варианты филиалов', () => {
    const r = run('await_phone', { consent: true }, contact('79001234567'));
    expect(said(r)).toContain(T.askChurch);
    expect(buttons(r).length).toBeGreaterThanOrEqual(6);
  });

  test('выбор филиала ведёт к вопросу про малую группу', () => {
    const r = run('await_church', { consent: true, fio: 'Иванов Иван', phone: '+79001234567' }, tap('church:0'));
    expect(r.state).toBe('await_mdg');
    expect(r.draft.church).toBe('МБВ (Колизей)');
  });
});

describe('человек не из МБВ', () => {
  const draft = { consent: true, fio: 'Иванов Иван', phone: '+79001234567' };

  test('«другая церковь» ведёт сразу к сводке, минуя вопросы про МДГ', () => {
    // Индекс «другой церкви» — предпоследний в списке вариантов.
    const r = run('await_church', draft, tap('church:4'));
    expect(r.draft.church).toBe('Другая церковь');
    expect(r.state).toBe('summary');
    expect(r.draft.mdgStatus).toBeUndefined();
  });

  test('«не посещаю церковь» тоже ведёт к сводке', () => {
    const r = run('await_church', draft, tap('church:5'));
    expect(r.draft.church).toBe('Не посещаю церковь');
    expect(r.state).toBe('summary');
  });

  test('подтверждение завершает регистрацию человека не из МБВ', () => {
    const r = run('summary', { ...draft, church: 'Другая церковь' }, tap(CB.confirm));
    expect(r.state).toBe('menu');
    expect(r.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'finish', complete: true })]),
    );
  });
});

describe('ветка «хочу открыть МДГ»', () => {
  test('спрашивает локацию, затем возраст, затем сводку', () => {
    const chosen = run('await_mdg', REQUIRED, tap(CB.mdgOpen));
    expect(chosen.state).toBe('await_location');
    expect(chosen.draft.mdgStatus).toBe('open');

    const located = run('await_location', chosen.draft, text('улица Ленина, 5'));
    expect(located.state).toBe('await_age');
    expect(located.draft.location).toBe('улица Ленина, 5');

    const aged = run('await_age', located.draft, text('34'));
    expect(aged.state).toBe('summary');
    expect(aged.draft.age).toBe(34);
  });

  test('в подтверждении сказано, что свяжется координатор МДГ', () => {
    const draft: Draft = { ...REQUIRED, mdgStatus: 'open', location: 'ул. Ленина 5', age: 34 };
    const r = run('summary', draft, tap(CB.confirm));
    expect(said(r)).toContain('координатор');
  });
});

describe('ветка «хочу присоединиться к МДГ»', () => {
  test('после возраста спрашивает, с кем человек будет ходить', () => {
    const draft: Draft = { ...REQUIRED, mdgStatus: 'join', location: 'ул. Ленина 5' };
    const r = run('await_age', draft, text('34'));
    expect(r.state).toBe('await_companions');
  });

  test('ответ про компанию сохраняется и ведёт к сводке', () => {
    const draft: Draft = { ...REQUIRED, mdgStatus: 'join', location: 'ул. Ленина 5', age: 34 };
    const r = run('await_companions', draft, text('с женой'));
    expect(r.state).toBe('summary');
    expect(r.draft.companions).toBe('с женой');
  });

  test('вопрос про компанию можно пропустить', () => {
    const draft: Draft = { ...REQUIRED, mdgStatus: 'join', location: 'ул. Ленина 5', age: 34 };
    const r = run('await_companions', draft, tap(CB.skip));
    expect(r.state).toBe('summary');
    expect(r.draft.companions).toBeUndefined();
  });

  test('заявка служителю создаётся при подтверждении', () => {
    const draft: Draft = { ...REQUIRED, mdgStatus: 'join', location: 'ул. Ленина 5', age: 34 };
    const r = run('summary', draft, tap(CB.confirm));
    expect(r.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'create_request', type: 'join_group' })]),
    );
    expect(said(r)).toContain('координатор');
  });
});

describe('ветка «уже состою в МДГ»', () => {
  test('спрашивает ФИО ведущего, затем возраст', () => {
    const chosen = run('await_mdg', REQUIRED, tap(CB.mdgMember));
    expect(chosen.state).toBe('await_leader_name');

    const named = run('await_leader_name', chosen.draft, text('Петров Пётр'));
    expect(named.state).toBe('await_age');
    expect(named.draft.leaderName).toBe('Петров Пётр');

    const aged = run('await_age', named.draft, text('34'));
    expect(aged.state).toBe('summary');
  });

  test('локацию у состоящего в группе не спрашивают', () => {
    const chosen = run('await_mdg', REQUIRED, tap(CB.mdgMember));
    expect(said(chosen)).not.toContain(T.askLocation);
  });
});

describe('ветка «я веду МДГ»', () => {
  test('уточняющих вопросов нет, сразу сводка', () => {
    const r = run('await_mdg', REQUIRED, tap(CB.mdgLeader));
    expect(r.state).toBe('summary');
    expect(r.draft.mdgStatus).toBe('leader');
  });
});

describe('досрочное завершение', () => {
  test('кнопка есть на уточняющих вопросах', () => {
    const r = run('await_mdg', REQUIRED, tap(CB.mdgOpen));
    expect(buttons(r)).toContain(CB.finishEarly);
  });

  test('досрочное завершение регистрирует, но помечает анкету неполной', () => {
    const draft: Draft = { ...REQUIRED, mdgStatus: 'join' };
    const r = run('await_location', draft, tap(CB.finishEarly));
    expect(r.state).toBe('menu');
    expect(r.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'finish', complete: false })]),
    );
    expect(said(r)).toContain('не хватает');
  });

  test('на обязательных вопросах кнопки завершения нет', () => {
    const r = run('await_consent', {}, tap(CB.consentYes));
    expect(buttons(r)).not.toContain(CB.finishEarly);
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

  test('возраст показывается со словом: 34 года, а не просто 34', () => {
    const r = run('await_companions', { ...draft, companions: undefined }, text('с женой'));
    expect(said(r)).toContain('34 года');
  });

  test('показывает всё, что человек сообщил, и ссылку на политику', () => {
    const r = run('await_companions', { ...draft, companions: undefined }, text('с женой'));
    const shown = said(r);
    expect(shown).toContain('Иванов Иван Иванович');
    expect(shown).toContain('+7 900 123-45-67');
    expect(shown).toContain('МБВ (Колизей)');
    expect(shown).toContain('с женой');
    expect(shown).toContain('mbv.spb.ru');
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

  test('неполная анкета видна в статусе и в меню появляется «дозаполнить»', () => {
    const r = run('menu', REQUIRED, tap(CB.menuStatus), registered({ complete: false }));
    expect(said(r)).toContain('не завершена');
    expect(buttons(r)).toContain(CB.menuResume);
  });

  test('«дозаполнить» возвращает на первый недостающий вопрос', () => {
    const draft: Draft = { ...REQUIRED, mdgStatus: 'join' };
    const r = run('menu', draft, tap(CB.menuResume), registered({ complete: false, mdgStatus: 'join' }));
    expect(r.state).toBe('await_location');
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

  test('сверка по телефону тоже не даёт подать заявку из меню', () => {
    // Тот же человек из другой платформы: user другой, телефон тот же.
    const r = run('menu', REQUIRED, tap(CB.menuLead), { ...registered(), leadPhoneTaken: 'request' });
    expect(r.effects).toEqual([]);
    expect(said(r)).toContain(T.leadPhoneHasRequest);
  });

  test('ведущему действующей группы объясняем про координатора, а не «мы передали»', () => {
    const r = run('menu', REQUIRED, tap(CB.menuLead), { ...registered(), leadPhoneTaken: 'group' });
    expect(r.effects).toEqual([]);
    expect(said(r)).toContain(T.leadPhoneIsLeader);
  });

  test('анкета со «хочу открыть» заявку по занятому телефону не создаёт', () => {
    // Вторая точка, где рождается заявка: подтверждение анкеты. Профиль сохраняем,
    // регистрацию завершаем — не создаём только заявку.
    const draft: Draft = { ...REQUIRED, mdgStatus: 'open', location: 'ул. Ленина 5', age: 34 };
    const r = run('summary', draft, tap(CB.confirm), { leadPhoneTaken: 'group' });

    expect(r.effects.map((e) => e.kind)).toEqual(['save', 'finish']);
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

  test('кнопка есть в меню зарегистрированного', () => {
    const r = run('menu', REQUIRED, tap(CB.menuStatus), REGISTERED);
    expect(buttons(r)).toContain(CB.menuAsk);
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
    expect(buttons(r)).toContain(CB.menuAsk);
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
    expect(buttons(r)).toContain(CB.menuAsk);
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

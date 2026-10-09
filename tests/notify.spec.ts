import { describe, expect, test } from 'vitest';
import { formatRequest } from '../src/admin/notify.js';
import type { RequestWithUser } from '../src/db/repos/requests.repo.js';

const request = (patch: Partial<RequestWithUser> = {}): RequestWithUser => ({
  id: 7,
  type: 'join_group',
  text: null,
  status: 'Новая',
  created_at: new Date('2026-08-24T11:10:39Z'),
  user_id: 1,
  platform: 'telegram',
  chat_id: '555',
  phone: '+79001234567',
  full_name: 'Панов Дмитрий',
  username: 'SimplicityOfTheGospel',
  location: 'Лесная',
  age: 34,
  church: 'МБВ (Колизей)',
  mdg_status: 'join',
  companions: null,
  leader_name: null,
  registration_no: 12,
  preferred_contact: null,
  schedule: null,
  address: null,
  ...patch,
});

const DASHBOARD_URL = 'http://5.23.48.25:8090/groups';
const lines = (r: RequestWithUser) => formatRequest(r, DASHBOARD_URL).split('\n');

describe('сообщение служителю о заявке', () => {
  test('район и возраст идут отдельными строками', () => {
    expect(lines(request()).some((l) => l.includes('Район') && l.includes('Лесная'))).toBe(true);
    expect(lines(request()).some((l) => l.includes('Возраст') && l.includes('34'))).toBe(true);
  });

  test('незаполненные район и возраст всё равно занимают свои строки', () => {
    const l = lines(request({ location: null, age: null }));
    expect(l.filter((x) => x.includes('не указан'))).toHaveLength(2);
  });

  test('возраст показан категорией: анкета спрашивает её, а не число', () => {
    expect(formatRequest(request({ age: '25-40' }), DASHBOARD_URL)).toContain('25-40');
    expect(formatRequest(request({ age: null }), DASHBOARD_URL)).toContain('не указан');
  });

  test('телефон показан в читаемом виде', () => {
    expect(formatRequest(request(), DASHBOARD_URL)).toContain('+7 900 123-45-67');
  });

  test('заявки «уже состою» и «уже веду группу» подписаны понятно', () => {
    expect(formatRequest(request({ type: 'already_member', mdg_status: 'member' }), DASHBOARD_URL))
      .toContain('уже состоит в домашней группе');
    expect(formatRequest(request({ type: 'already_leader', mdg_status: 'leader' }), DASHBOARD_URL))
      .toContain('уже ведёт домашнюю группу');
  });

  test('разметка жирным на месте, а текст участника экранирован', () => {
    const text = formatRequest(request({ type: 'question', text: 'а если <b>так</b> & вот так?' }), DASHBOARD_URL);
    expect(text).toContain('<b>');
    expect(text).toContain('&lt;b&gt;так&lt;/b&gt; &amp; вот так?');
  });

  test('имя участника тоже экранируется', () => {
    const text = formatRequest(request({ full_name: '<script> Иван' }), DASHBOARD_URL);
    expect(text).toContain('&lt;script&gt;');
    expect(text).not.toContain('<script>');
  });

  test('текст участника подписан словом «Сообщение»', () => {
    const text = formatRequest(request({ type: 'question', text: 'Когда выдают материалы?' }), DASHBOARD_URL);
    expect(text).toContain('Сообщение');
    expect(text).toContain('Когда выдают материалы?');
    expect(text).not.toContain('Текст:');
  });

  test('заявка без текста не показывает пустое сообщение', () => {
    expect(formatRequest(request(), DASHBOARD_URL)).not.toContain('Сообщение:');
  });

  test('в заявке есть имя, телефон и подсказка, как её закрыть', () => {
    const text = formatRequest(request(), DASHBOARD_URL);
    expect(text).toContain('Панов Дмитрий');
    expect(text).toContain('+7 900 123-45-67');
    // Закрывают заявку в дашборде: команды /close в боте больше нет.
    expect(text).toContain('дашборде');
    expect(text).toContain('№7');
  });

  test('видно, из какого мессенджера пришла заявка', () => {
    expect(formatRequest(request(), DASHBOARD_URL)).toContain('Telegram');
    expect(formatRequest(request({ platform: 'max', username: null }), DASHBOARD_URL)).toContain('MAX');
  });

  /**
   * У заявки без участника в боте (заведена кнопкой «Заявка» в дашборде, а не
   * через регистрацию) LEFT JOIN в RequestsRepo не находит пользователя, и
   * platform приходит null, хотя тип этого не допускает — без явного разбора
   * сообщение тихо показало бы «💬 undefined».
   */
  test('заявка без участника в боте не показывает «undefined» вместо мессенджера', () => {
    // Тип platform не допускает null, но LEFT JOIN в RequestsRepo его всё же отдаёт —
    // приводим явно, как это фактически приходит из базы для заявки без участника.
    const noUser = { ...request(), platform: null, user_id: null, username: null } as unknown as RequestWithUser;
    const text = formatRequest(noUser, DASHBOARD_URL);
    expect(text).not.toContain('undefined');
    expect(text).toContain('дашборд');
  });

  test('есть ссылка на эту заявку в дашборде — по номеру, который совпадает с колонкой «№»', () => {
    const text = formatRequest(request(), DASHBOARD_URL);
    expect(text).toContain(`href="${DASHBOARD_URL}?request=7"`);
    expect(text).toContain('Открыть заявку в дашборде');
  });

  test('удобное время и адрес показаны, если человек их указал', () => {
    const text = formatRequest(request({ schedule: 'пн, ср - с 17 до 22', address: 'ул Рылеева 32' }), DASHBOARD_URL);
    expect(text).toContain('Удобное время: <b>пн, ср - с 17 до 22</b>');
    expect(text).toContain('Адрес: <b>ул Рылеева 32</b>');
  });

  test('если время и адрес пропущены, лишних строк «не указан» нет: вопросы необязательные', () => {
    const text = formatRequest(request(), DASHBOARD_URL);
    expect(text).not.toContain('Удобное время');
    expect(text).not.toContain('Адрес');
  });

  test('время и адрес экранированы: это текст человека', () => {
    const text = formatRequest(request({ address: '<script>x</script>' }), DASHBOARD_URL);
    expect(text).not.toContain('<script>');
  });
});

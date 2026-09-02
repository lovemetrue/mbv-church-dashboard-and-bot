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
  ...patch,
});

const lines = (r: RequestWithUser) => formatRequest(r).split('\n');

describe('сообщение служителю о заявке', () => {
  test('район и возраст идут отдельными строками', () => {
    expect(lines(request()).some((l) => l.includes('Район') && l.includes('Лесная'))).toBe(true);
    expect(lines(request()).some((l) => l.includes('Возраст') && l.includes('34'))).toBe(true);
  });

  test('незаполненные район и возраст всё равно занимают свои строки', () => {
    const l = lines(request({ location: null, age: null }));
    expect(l.filter((x) => x.includes('не указан'))).toHaveLength(2);
  });

  test('возраст согласован с числом', () => {
    expect(formatRequest(request({ age: 34 }))).toContain('34 года');
    expect(formatRequest(request({ age: 47 }))).toContain('47 лет');
    expect(formatRequest(request({ age: 21 }))).toContain('21 год');
  });

  test('телефон показан в читаемом виде', () => {
    expect(formatRequest(request())).toContain('+7 900 123-45-67');
  });

  test('разметка жирным на месте, а текст участника экранирован', () => {
    const text = formatRequest(request({ type: 'question', text: 'а если <b>так</b> & вот так?' }));
    expect(text).toContain('<b>');
    expect(text).toContain('&lt;b&gt;так&lt;/b&gt; &amp; вот так?');
  });

  test('имя участника тоже экранируется', () => {
    const text = formatRequest(request({ full_name: '<script> Иван' }));
    expect(text).toContain('&lt;script&gt;');
    expect(text).not.toContain('<script>');
  });

  test('текст участника подписан словом «Сообщение»', () => {
    const text = formatRequest(request({ type: 'question', text: 'Когда выдают материалы?' }));
    expect(text).toContain('Сообщение');
    expect(text).toContain('Когда выдают материалы?');
    expect(text).not.toContain('Текст:');
  });

  test('заявка без текста не показывает пустое сообщение', () => {
    expect(formatRequest(request())).not.toContain('Сообщение:');
  });

  test('в заявке есть имя, телефон и подсказка, как её закрыть', () => {
    const text = formatRequest(request());
    expect(text).toContain('Панов Дмитрий');
    expect(text).toContain('+7 900 123-45-67');
    // Закрывают заявку в дашборде: команды /close в боте больше нет.
    expect(text).toContain('дашборде');
    expect(text).toContain('№7');
  });

  test('видно, из какого мессенджера пришла заявка', () => {
    expect(formatRequest(request())).toContain('Telegram');
    expect(formatRequest(request({ platform: 'max', username: null }))).toContain('MAX');
  });
});

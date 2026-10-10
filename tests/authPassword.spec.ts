import { describe, expect, test } from 'vitest';
import { baseLogin, freeLogin, LOGIN_PATTERN, transliterate } from '../src/platform/auth/loginName.js';
import { hashPassword, hashToken, MAX_PASSWORD, newToken, passwordProblem, verifyPassword } from '../src/platform/auth/password.js';

describe('хеш пароля', () => {
  test('верный пароль проходит, неверный — нет', async () => {
    const h = await hashPassword('правильный-пароль-1');
    expect(await verifyPassword('правильный-пароль-1', h)).toBe(true);
    expect(await verifyPassword('правильный-пароль-2', h)).toBe(false);
    expect(await verifyPassword('', h)).toBe(false);
  });

  test('одинаковые пароли дают разные хеши (у каждого своя соль), а сам пароль в хеше не виден', async () => {
    const [a, b] = await Promise.all([hashPassword('один-и-тот-же-пароль'), hashPassword('один-и-тот-же-пароль')]);
    expect(a).not.toBe(b);
    expect(a).not.toContain('один-и-тот-же');
    expect(a.startsWith('scrypt$')).toBe(true);
  });

  test('разные написания одного юникодного пароля считаются одним', async () => {
    const h = await hashPassword('Пароль̆-1234567');
    expect(await verifyPassword('Пароль̆-1234567'.normalize('NFC'), h)).toBe(true);
  });

  test.each(['', 'scrypt', 'scrypt$1$2$3', 'bcrypt$x$y$z$q$w', 'мусор'])('испорченный хеш «%s» не пропускает никого и не бросает', async (stored) => {
    expect(await verifyPassword('любой-пароль-123', stored)).toBe(false);
  });
});

describe('требования к паролю', () => {
  const ctx = { login: 'p_ivanova', email: 'polina@church.example' };
  test.each([
    ['короткий1', 'короткий'],
    ['1234567890123', 'только из цифр'],
    ['aaaaaaaaaaaa', 'одного повторяющегося'],
    ['Password1', 'короткий'],
    ['qwerty1234', 'распространён'],
    ['P_IVANOVA', 'короткий'],
    ['я'.repeat(MAX_PASSWORD + 1), 'длинный'],
  ])('«%s» отклоняется (%s)', (password, fragment) => {
    expect(passwordProblem(password, ctx)).toContain(fragment);
  });

  test('пароль, равный логину или почте (даже в другом регистре), отклоняется', () => {
    expect(passwordProblem('POLINA@church.example', ctx)).toContain('логином или почтой');
    expect(passwordProblem('p_ivanova', { login: 'p_ivanova', email: 'x' })).toContain('короткий');
    expect(passwordProblem('long_login_name_1', { login: 'LONG_LOGIN_NAME_1', email: 'e@e.ee' })).toContain('логином');
  });

  test('нормальные пароли принимаются, в том числе длинная фраза и кириллица', () => {
    expect(passwordProblem('сиреневый-туман-42', ctx)).toBeNull();
    expect(passwordProblem('correct horse battery staple', ctx)).toBeNull();
  });
});

describe('токены ссылок', () => {
  test('токен длинный и случайный, а хеш одного токена всегда одинаков и на него не похож', () => {
    const a = newToken();
    const b = newToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(hashToken(b));
    expect(hashToken(a)).not.toContain(a);
  });
});

describe('логин по ФИО', () => {
  test.each([
    ['Полина Иванова', 'p_ivanova'],
    ['Даниил Петров-Водкин', 'd_petrovvodkin'],
    ['Юрий Щукин', 'y_shchukin'],
    ['Ёлкина Алёна Сергеевна', 'e_sergeevna'],
    ['  Иван   Сидоров  ', 'i_sidorov'],
    ['John Smith', 'j_smith'],
  ])('«%s» → %s', (name, login) => { expect(baseLogin(name)).toBe(login); });

  test.each(['', 'Полина', '   ', 'Ь Ъ'])('из «%s» логин не получается', (name) => { expect(baseLogin(name)).toBeNull(); });

  test('занятый логин получает цифру, регистр занятых не важен', () => {
    expect(freeLogin('p_ivanova', new Set())).toBe('p_ivanova');
    expect(freeLogin('p_ivanova', new Set(['p_ivanova']))).toBe('p_ivanova2');
    expect(freeLogin('p_ivanova', new Set(['P_IVANOVA', 'p_ivanova2']))).toBe('p_ivanova3');
  });

  test('каждый подобранный логин проходит проверку формата', () => {
    for (const name of ['Полина Иванова', 'Юрий Щукин']) expect(LOGIN_PATTERN.test(baseLogin(name)!)).toBe(true);
    expect(transliterate('Щ-ё')).toBe('shche');
  });

  test.each(['ab', 'P_Ivanova', 'p ivanova', '_ivanova', 'я_иванова', 'a'.repeat(41)])('логин «%s» не проходит формат', (login) => {
    expect(LOGIN_PATTERN.test(login)).toBe(false);
  });
});

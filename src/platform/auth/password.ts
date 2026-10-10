import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

/**
 * Хеш пароля: scrypt из стандартной библиотеки Node, без новых зависимостей. Параметры записаны в
 * самом хеше, поэтому их можно усилить позже, не ломая старые пароли.
 */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/**
 * Хеш, с которым сверяем пароль, когда такого логина нет: время ответа не должно подсказывать,
 * существует ли логин.
 */
let dummy: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(12).toString('hex'));
  return dummy;
}

export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 128;

/** Самые частые пароли, которые подбирают первыми. Список короткий: он закрывает худшее, а не всё. */
const COMMON = new Set([
  'password', 'password1', '1234567890', '0123456789', 'qwertyuiop', 'qwerty123', 'qwerty1234', '1q2w3e4r5t',
  'йцукенгшщз', 'qazwsxedc', '11111111111', '1234512345', 'iloveyou12', 'admin12345', 'administrator',
]);

/** null — пароль подходит, иначе причина простым языком. */
export function passwordProblem(password: string, context: { login: string; email: string }): string | null {
  if (password.length < MIN_PASSWORD) return `Пароль слишком короткий: нужно не меньше ${MIN_PASSWORD} знаков.`;
  if (password.length > MAX_PASSWORD) return `Пароль слишком длинный: не больше ${MAX_PASSWORD} знаков.`;
  if (/^\d+$/.test(password)) return 'Пароль не должен состоять только из цифр.';
  if (/^(.)\1+$/u.test(password)) return 'Пароль не должен состоять из одного повторяющегося знака.';
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'Этот пароль слишком распространён. Придумайте другой.';
  if (lower === context.login.toLowerCase() || lower === context.email.toLowerCase()) {
    return 'Пароль не должен совпадать с логином или почтой.';
  }
  return null;
}

/** Токен для ссылки: 32 случайных байта; наружу уходит сам токен, в базе лежит только его хеш. */
export const newToken = (): string => randomBytes(32).toString('base64url');
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

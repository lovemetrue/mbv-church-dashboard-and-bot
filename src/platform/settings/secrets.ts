import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Ключи доступа (например, ключ языковой модели), которые вводят в интерфейсе, лежат в базе только зашифрованными:
 * резервная копия базы или выгрузка таблицы настроек ключа не раскрывает. Шифр — AES-256-GCM (с проверкой подлинности:
 * подмена значения в базе распознаётся), ключ шифрования получается из секрета сервера, который в базе не хранится.
 *
 * Если секрет сервера сменили, прежнее значение не прочитать: `decryptSecret` вернёт null, и ключ нужно ввести заново.
 * Это лучше, чем отдавать мусор или падать.
 */
const VERSION = 'v1';
// Соль фиксированная и публичная: она нужна лишь затем, чтобы ключ шифрования не совпадал с самим секретом.
const SALT = 'church40bot:settings-secrets:v1';

const deriveKey = (secret: string): Buffer => scryptSync(secret, SALT, 32);

export function encryptSecret(plain: string, secret: string): string {
  if (secret.trim() === '') throw new Error('Секрет для шифрования не задан');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join(':');
}

export function decryptSecret(sealed: unknown, secret: string): string | null {
  if (typeof sealed !== 'string' || secret.trim() === '') return null;
  const [version, iv, tag, body] = sealed.split(':');
  if (version !== VERSION || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Последние четыре символа ключа: по ним видно, какой именно ключ задан, но восстановить его нельзя. */
export function keyHint(key: string): string | null {
  const t = key.trim();
  return t.length >= 8 ? t.slice(-4) : null;
}

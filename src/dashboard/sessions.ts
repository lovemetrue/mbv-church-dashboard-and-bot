import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Хранилище сессий. Отдельный интерфейс, чтобы логика входа проверялась тестами
 * без запущенного Redis, а в бою за ним стоял он же.
 */
export interface SessionStore {
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<void>;
  /** Увеличивает счётчик и возвращает новое значение. Нужен для защиты от перебора. */
  incr(key: string, ttlSeconds: number): Promise<number>;
}

export interface SessionOptions {
  password: string;
  /** Сколько живёт сессия без обращений. */
  ttlSeconds: number;
  /** Сколько неудачных попыток подряд с одного адреса до блокировки. */
  maxAttempts: number;
  /** На сколько блокируется адрес после перебора. */
  lockoutSeconds?: number;
}

export interface LoginResult {
  ok: boolean;
  sid?: string;
  lockedOut?: boolean;
}

const SESSION_PREFIX = 'hg:sess:';
const ATTEMPTS_PREFIX = 'hg:fail:';

/** Сравнение постоянного времени: обычное «===» подсказывает подбирающему длину совпадения. */
function sameSecret(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Всё равно тратим время на сравнение, чтобы длина не утекала через тайминг.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export class SessionService {
  private readonly lockoutSeconds: number;

  constructor(
    private readonly store: SessionStore,
    private readonly opts: SessionOptions,
  ) {
    this.lockoutSeconds = opts.lockoutSeconds ?? 900;
  }

  async login(password: string, ip: string): Promise<LoginResult> {
    const failKey = ATTEMPTS_PREFIX + ip;
    const failed = Number((await this.store.get(failKey)) ?? 0);
    if (failed >= this.opts.maxAttempts) return { ok: false, lockedOut: true };

    if (!password || !sameSecret(password, this.opts.password)) {
      await this.store.incr(failKey, this.lockoutSeconds);
      return { ok: false };
    }

    await this.store.del(failKey);
    const sid = randomBytes(32).toString('base64url');
    await this.store.set(SESSION_PREFIX + sid, String(Date.now()), this.opts.ttlSeconds);
    return { ok: true, sid };
  }

  /** Проверяет сессию и продлевает её: активный человек не должен вылетать по таймеру. */
  async verify(sid: string | undefined): Promise<boolean> {
    if (!sid) return false;
    const key = SESSION_PREFIX + sid;
    const found = await this.store.get(key);
    if (found === null) return false;
    await this.store.set(key, found, this.opts.ttlSeconds);
    return true;
  }

  async logout(sid: string | undefined): Promise<void> {
    if (sid) await this.store.del(SESSION_PREFIX + sid);
  }

  /** Читает одну куку из заголовка Cookie. */
  static readCookie(header: string | undefined, name: string): string | undefined {
    if (!header) return undefined;
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
    }
    return undefined;
  }
}

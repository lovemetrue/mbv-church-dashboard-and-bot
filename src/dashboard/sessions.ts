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

export type Role = 'admin' | 'super';

export interface SessionOptions {
  /** Пароль обычного входа (логин `login`): всё, кроме удаления. */
  password: string;
  /** Логин обычного входа. */
  login?: string;
  /** Пароль и логин полного входа: только он может удалять. Не заданы — удалять не может никто, кроме единственного входа в одиночном режиме (см. ниже). */
  superPassword?: string;
  superLogin?: string;
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
  role?: Role;
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

  /**
   * Какую роль даёт пара «логин, пароль». `username` не передан — проверяем только пароль
   * (так входили до появления логинов); передан, даже пустой, — он должен совпасть.
   * Если полный вход не настроен, единственный пароль даёт все права, как раньше.
   */
  private roleFor(password: string, username: string | undefined): Role | null {
    const { password: regular, login = 'mbv_admin', superPassword, superLogin = 'super_mbv_admin' } = this.opts;
    const nameOk = (expected: string) => username === undefined || sameSecret(username, expected);
    // Оба сравнения выполняем всегда: по времени ответа нельзя понять, какой из аккаунтов угадан.
    const isSuper = Boolean(superPassword) && sameSecret(password, superPassword!) && nameOk(superLogin);
    const isRegular = sameSecret(password, regular) && nameOk(login);
    if (isSuper) return 'super';
    if (isRegular) return superPassword ? 'admin' : 'super';
    return null;
  }

  async login(password: string, ip: string, username?: string): Promise<LoginResult> {
    const failKey = ATTEMPTS_PREFIX + ip;
    const failed = Number((await this.store.get(failKey)) ?? 0);
    if (failed >= this.opts.maxAttempts) return { ok: false, lockedOut: true };

    const role = password ? this.roleFor(password, username) : null;
    if (!role) {
      await this.store.incr(failKey, this.lockoutSeconds);
      return { ok: false };
    }

    await this.store.del(failKey);
    const sid = randomBytes(32).toString('base64url');
    await this.store.set(SESSION_PREFIX + sid, JSON.stringify({ role, at: Date.now() }), this.opts.ttlSeconds);
    return { ok: true, sid, role };
  }

  /**
   * Открыть сессию без проверки пароля: проверку уже сделал вызывающий (личный вход). `extra`
   * хранится вместе с сессией — например, кто именно вошёл. Общие входы этим методом не пользуются.
   */
  async startSession(role: Role, extra: Record<string, unknown> = {}): Promise<string> {
    const sid = randomBytes(32).toString('base64url');
    await this.store.set(SESSION_PREFIX + sid, JSON.stringify({ ...extra, role, at: Date.now() }), this.opts.ttlSeconds);
    return sid;
  }

  /** Запись сессии как есть (без продления); null — сессии нет или она испорчена. */
  async read(sid: string | undefined): Promise<Record<string, unknown> | null> {
    if (!sid) return null;
    const found = await this.store.get(SESSION_PREFIX + sid);
    if (found === null) return null;
    try {
      const parsed: unknown = JSON.parse(found);
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  /** Роль сессии. Сессии, выданные до появления ролей, — обычные: удалять с них нельзя. */
  async roleOf(sid: string | undefined): Promise<Role | null> {
    if (!sid) return null;
    const found = await this.store.get(SESSION_PREFIX + sid);
    if (found === null) return null;
    try {
      return (JSON.parse(found) as { role?: Role }).role === 'super' ? 'super' : 'admin';
    } catch {
      return 'admin';
    }
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

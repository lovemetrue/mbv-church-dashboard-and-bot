import type { LoginResult, Role, SessionService, SessionStore } from '../../dashboard/sessions.js';
import type { SettingsRepo } from '../../db/repos/settings.repo.js';
import type { StaffRepo, StaffRow } from '../../db/repos/staff.repo.js';
import { dummyHash, verifyPassword } from './password.js';
import { PERSONAL_SETTING } from './staffService.js';

/**
 * Что нужно серверу от входа. Её реализует и старый `SessionService` (общие логины), и
 * `PersonalAuth` (общие плюс личные), поэтому сервер не знает, какой режим включён.
 */
export interface AuthPort {
  login(password: string, ip: string, username?: string): Promise<LoginResult>;
  verify(sid: string | undefined): Promise<boolean>;
  roleOf(sid: string | undefined): Promise<Role | null>;
  logout(sid: string | undefined): Promise<void>;
  /** Кто вошёл, для журнала: логин личного входа; null — общий вход (автор берётся по роли). */
  identityOf?(sid: string | undefined): Promise<{ login: string } | null>;
}

export interface PersonalAuthOptions {
  /** Общий логин обычного уровня: при включённых личных входах перестаёт работать. */
  sharedLogin: string;
  /** Общий полный логин: остаётся запасным входом, чтобы никто не остался без доступа. */
  sharedSuperLogin: string;
  /** Сколько неудач подряд с одного адреса или на один логин до блокировки. */
  maxAttempts?: number;
  lockoutSeconds?: number;
  /** Как долго помнить состояние человека и режима: ответ на каждый запрос не должен ходить в базу. */
  cacheMs?: number;
  now?: () => number;
}

const FAIL_IP = 'hg:pfail:ip:';
const FAIL_LOGIN = 'hg:pfail:u:';

/**
 * Вход по личному логину поверх общих.
 *  • Режим выключен — всё как прежде (общие логины); личные входы пока не принимаются.
 *  • Режим включён — вход только личный; общий `mbv_admin` отклоняется, а общий полный остаётся запасным.
 * Роль и состояние человека каждый раз берутся из базы (с коротким кэшем), а не из сессии: отключили
 * человека или сменили роль — это действует сразу, а не когда сессия истечёт.
 */
export class PersonalAuth implements AuthPort {
  private readonly maxAttempts: number;
  private readonly lockout: number;
  private readonly cacheMs: number;
  private readonly now: () => number;
  private mode: { value: boolean; at: number } | null = null;
  private people = new Map<number, { row: StaffRow | null; at: number }>();

  constructor(
    private readonly session: SessionService,
    private readonly store: SessionStore,
    private readonly staff: StaffRepo,
    private readonly settings: Pick<SettingsRepo, 'get'>,
    private readonly opts: PersonalAuthOptions,
  ) {
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.lockout = opts.lockoutSeconds ?? 900;
    this.cacheMs = opts.cacheMs ?? 5000;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Сбросить кэш: после изменения режима или человека в этом же процессе действие видно сразу. */
  invalidate(): void {
    this.mode = null;
    this.people.clear();
  }

  private async personalOn(): Promise<boolean> {
    if (this.mode && this.now() - this.mode.at < this.cacheMs) return this.mode.value;
    const value = (await this.settings.get<boolean>(PERSONAL_SETTING)) === true;
    this.mode = { value, at: this.now() };
    return value;
  }

  private async person(id: number): Promise<StaffRow | null> {
    const hit = this.people.get(id);
    if (hit && this.now() - hit.at < this.cacheMs) return hit.row;
    const row = await this.staff.byId(id);
    this.people.set(id, { row, at: this.now() });
    return row;
  }

  async login(password: string, ip: string, username?: string): Promise<LoginResult> {
    if (!(await this.personalOn())) return this.session.login(password, ip, username);

    const name = (username ?? '').trim().toLowerCase();
    // Запасной полный вход идёт прежним путём со своей защитой от перебора.
    if (name === this.opts.sharedSuperLogin.toLowerCase()) return this.session.login(password, ip, username);

    const ipKey = FAIL_IP + ip;
    const loginKey = FAIL_LOGIN + name;
    const [ipFails, loginFails] = await Promise.all([this.store.get(ipKey), this.store.get(loginKey)]);
    if (Number(ipFails ?? 0) >= this.maxAttempts || Number(loginFails ?? 0) >= this.maxAttempts) return { ok: false, lockedOut: true };

    // Общий обычный логин в личном режиме не пускает; пароль всё равно сверяем с «пустышкой», чтобы время ответа не выдало причину.
    const row = name && name !== this.opts.sharedLogin.toLowerCase() ? await this.staff.byLogin(name) : null;
    const hash = row?.password_hash ?? (await dummyHash());
    const passwordOk = password !== '' && (await verifyPassword(password, hash));

    if (!row || !row.active || !row.password_hash || !passwordOk) {
      await Promise.all([this.store.incr(ipKey, this.lockout), name ? this.store.incr(loginKey, this.lockout) : Promise.resolve(0)]);
      return { ok: false };
    }
    await Promise.all([this.store.del(ipKey), this.store.del(loginKey)]);
    const sid = await this.session.startSession(row.role, { staffId: row.id, v: row.session_version, login: row.login });
    await this.staff.recordLogin(row.id);
    return { ok: true, sid, role: row.role };
  }

  /** Сессия годна, если её хозяин ещё вправе входить: личная — человек действует и версия совпала; общая — только полная. */
  private async permitted(sid: string | undefined): Promise<{ role: Role; login: string | null } | null> {
    const rec = await this.session.read(sid);
    if (!rec) return null;
    const staffId = typeof rec['staffId'] === 'number' ? rec['staffId'] : null;
    if (staffId !== null) {
      if (!(await this.personalOn())) return null;
      const row = await this.person(staffId);
      if (!row || !row.active || row.session_version !== rec['v']) return null;
      return { role: row.role, login: row.login };
    }
    const role: Role = rec['role'] === 'super' ? 'super' : 'admin';
    // Общий обычный вход в личном режиме закрыт, в том числе для уже выданных сессий.
    if (await this.personalOn() && role !== 'super') return null;
    return { role, login: null };
  }

  async verify(sid: string | undefined): Promise<boolean> {
    if (!(await this.permitted(sid))) return false;
    return this.session.verify(sid);
  }

  async roleOf(sid: string | undefined): Promise<Role | null> {
    return (await this.permitted(sid))?.role ?? null;
  }

  async identityOf(sid: string | undefined): Promise<{ login: string } | null> {
    const p = await this.permitted(sid);
    return p?.login ? { login: p.login } : null;
  }

  logout(sid: string | undefined): Promise<void> {
    return this.session.logout(sid);
  }
}

import type { StaffRepo, StaffRow } from '../../db/repos/staff.repo.js';
import { StaffConflict } from '../../db/repos/staff.repo.js';
import type { SettingsRepo } from '../../db/repos/settings.repo.js';
import type { SessionStore } from '../../dashboard/sessions.js';
import type {
  ActionError, DeliveryOk, PersonalLoginsState, SettingsStaffView, StaffItem, StaffStatus, SuggestLoginOk,
} from '../../home-groups/contracts.js';
import { logger } from '../../logger.js';
import type { Mailer } from '../mail/mailer.js';
import { inviteMail, resetMail } from '../mail/templates.js';
import { baseLogin, freeLogin, LOGIN_PATTERN } from './loginName.js';
import { hashPassword, hashToken, newToken, passwordProblem } from './password.js';

/**
 * Личные входы: заведение людей, ссылки на пароль, сброс, включение режима.
 *
 * Ссылка на пароль — главное, что нужно беречь: токен существует в открытом виде только в письме
 * (или на экране администратора), в базе лежит его хеш; ссылка одноразовая, живёт недолго, а новая
 * ссылка гасит прежние.
 */

export const PERSONAL_SETTING = 'auth.personal';
export const INVITE_TTL_SECONDS = 7 * 86400;
export const RESET_TTL_SECONDS = 2 * 3600;
/** Сколько раз за час человек (или кто-то от его имени) может запросить сброс. */
export const RESET_PER_HOUR = 3;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type StaffOutcome<T = object> = ({ ok: true } & T) | { ok: false; error: ActionError['error']; message: string };
const bad = (message: string, error: ActionError['error'] = 'bad_request'): { ok: false; error: ActionError['error']; message: string } => ({ ok: false, error, message });

export interface StaffServiceDeps {
  staff: StaffRepo;
  settings: Pick<SettingsRepo, 'get' | 'set'>;
  mailer: Mailer;
  /** Для рейтлимита запросов сброса по адресу клиента. */
  store: SessionStore;
  /**
   * Публичный адрес сервиса (`HG_PUBLIC_URL`) для ссылок в письмах. Адрес берётся только из настройки, а не из
   * заголовка Host запроса: иначе ссылку в чужом письме можно было бы подменить на адрес злоумышленника.
   */
  publicUrl: string | null;
  now?: () => Date;
  /** Вызывается после изменений, которые должны подействовать на вход сразу (кэш входа сбрасывается). */
  onChange?: () => void;
  /** Сообщить об ошибке отправки в журнал ошибок. */
  reportError?: (source: string, err: unknown, context: string) => void;
}

const statusOf = (s: { active: boolean; password_hash: string | null }): StaffStatus =>
  !s.active ? 'disabled' : s.password_hash ? 'active' : 'invited';

export function createStaffService(deps: StaffServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const base = deps.publicUrl?.replace(/\/+$/, '') ?? null;

  const itemOf = (r: StaffRow & { has_pending_link: boolean }): StaffItem => ({
    id: r.id, login: r.login, fullName: r.full_name, email: r.email, role: r.role, status: statusOf(r),
    lastLoginAt: r.last_login_at ? r.last_login_at.toISOString() : null, hasPendingLink: r.has_pending_link,
  });

  async function personalState(): Promise<PersonalLoginsState> {
    const [enabled, count] = await Promise.all([deps.settings.get<boolean>(PERSONAL_SETTING), deps.staff.activeWithPassword()]);
    return { enabled: enabled === true, canEnable: count > 0, activeWithPassword: count, mailConfigured: deps.mailer.configured && base !== null };
  }

  /**
   * Выдать ссылку и доставить: письмом, если почта и публичный адрес настроены и письмо ушло, иначе
   * вернуть путь, который администратор передаст сам. Сбой почты не должен терять ссылку.
   */
  async function deliver(staff: StaffRow, purpose: 'invite' | 'reset', actor: string): Promise<DeliveryOk> {
    const token = newToken();
    const ttl = purpose === 'invite' ? INVITE_TTL_SECONDS : RESET_TTL_SECONDS;
    await deps.staff.issueToken(staff.id, purpose, hashToken(token), ttl, actor);
    const path = `/set-password?token=${token}`;

    if (deps.mailer.configured && base) {
      const link = `${base}${path}`;
      const message = purpose === 'invite'
        ? inviteMail(staff.email, staff.full_name, staff.login, link, Math.round(ttl / 86400))
        : resetMail(staff.email, staff.full_name, staff.login, link, Math.round(ttl / 3600));
      try {
        await deps.mailer.send(message);
        return { ok: true, delivery: 'sent', email: staff.email };
      } catch (err) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'личные входы: письмо не отправлено');
        deps.reportError?.('почта', err, `ссылка на пароль (${purpose})`);
      }
    }
    return { ok: true, delivery: 'link', email: staff.email, path };
  }

  async function usedLoginOrNew(fullName: string, requested: string | undefined): Promise<{ login: string } | { error: string }> {
    const taken = await deps.staff.logins();
    if (requested !== undefined && requested.trim() !== '') {
      const login = requested.trim().toLowerCase();
      if (!LOGIN_PATTERN.test(login)) return { error: 'Логин: латиница, цифры, «_», «.», «-», от 3 до 40 знаков, начинается с буквы или цифры.' };
      return { login };
    }
    const b = baseLogin(fullName);
    if (!b) return { error: 'Не удалось подобрать логин: укажите имя и фамилию через пробел или введите логин вручную.' };
    return { login: freeLogin(b, taken) };
  }

  return {
    personalState,

    async view(): Promise<SettingsStaffView> {
      const [rows, personal] = await Promise.all([deps.staff.list(), personalState()]);
      return { generatedAt: now().toISOString(), items: rows.map(itemOf), personal };
    },

    async suggestLogin(body: unknown): Promise<StaffOutcome<Pick<SuggestLoginOk, 'login'>>> {
      const fullName = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['fullName'] : undefined;
      if (typeof fullName !== 'string') return bad('Нужно указать ФИО.');
      const b = baseLogin(fullName);
      if (!b) return bad('Укажите имя и фамилию через пробел.');
      return { ok: true, login: freeLogin(b, await deps.staff.logins()) };
    },

    async create(body: unknown, actor: string): Promise<StaffOutcome<Omit<DeliveryOk, 'ok'>>> {
      if (typeof body !== 'object' || body === null) return bad('Нужны ФИО, почта и роль.');
      const { fullName, email, role, login } = body as Record<string, unknown>;
      if (typeof fullName !== 'string' || fullName.trim().length < 2 || fullName.trim().length > 120) return bad('Укажите ФИО (до 120 знаков).');
      if (typeof email !== 'string' || email.length > 254 || !EMAIL.test(email.trim())) return bad('Укажите корректную почту.');
      if (role !== 'admin' && role !== 'super') return bad('Роль: «admin» (обычный) или «super» (полный).');
      if (login !== undefined && login !== null && typeof login !== 'string') return bad('Логин должен быть текстом.');

      const chosen = await usedLoginOrNew(fullName.trim(), typeof login === 'string' ? login : undefined);
      if ('error' in chosen) return bad(chosen.error);
      let created: StaffRow;
      try {
        created = await deps.staff.create({ login: chosen.login, fullName: fullName.trim(), email: email.trim(), role }, actor);
      } catch (err) {
        if (err instanceof StaffConflict) return bad(err.field === 'email' ? 'Пользователь с такой почтой уже есть.' : 'Такой логин уже занят.', 'conflict');
        throw err;
      }
      const delivery = await deliver(created, 'invite', actor);
      return { ...delivery, login: created.login, id: created.id };
    },

    async update(body: unknown, actor: string): Promise<StaffOutcome> {
      if (typeof body !== 'object' || body === null) return bad('Нужно указать пользователя.');
      const { id, fullName, email, role, active } = body as Record<string, unknown>;
      if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) return bad('Нужно указать пользователя.');
      if (fullName !== undefined && (typeof fullName !== 'string' || fullName.trim().length < 2 || fullName.trim().length > 120)) return bad('Укажите ФИО (до 120 знаков).');
      if (email !== undefined && (typeof email !== 'string' || email.length > 254 || !EMAIL.test(email.trim()))) return bad('Укажите корректную почту.');
      if (role !== undefined && role !== 'admin' && role !== 'super') return bad('Неизвестная роль.');
      if (active !== undefined && typeof active !== 'boolean') return bad('Некорректное значение.');

      const current = await deps.staff.byId(id);
      if (!current) return bad('Пользователь не найден.', 'not_found');
      // Сам себя отключить или понизить нельзя: останешься без доступа посреди работы.
      const self = current.login.toLowerCase() === actor.toLowerCase();
      if (self && (active === false || (role !== undefined && role !== current.role))) {
        return bad('Нельзя отключить или понизить самого себя. Попросите другого пользователя с полным доступом.');
      }
      // При включённых личных входах нельзя оставить систему без единого действующего пользователя.
      if (active === false && current.active && current.password_hash && (await personalState()).enabled && (await deps.staff.activeWithPassword()) <= 1) {
        return bad('Это последний действующий пользователь, а личные входы включены. Сначала выключите личные входы или заведите другого.');
      }
      try {
        await deps.staff.update(id, {
          ...(typeof fullName === 'string' ? { fullName: fullName.trim() } : {}),
          ...(typeof email === 'string' ? { email: email.trim() } : {}),
          ...(role === 'admin' || role === 'super' ? { role } : {}),
          ...(typeof active === 'boolean' ? { active } : {}),
        }, actor);
      } catch (err) {
        if (err instanceof StaffConflict) return bad('Пользователь с такой почтой уже есть.', 'conflict');
        throw err;
      }
      deps.onChange?.();
      return { ok: true };
    },

    /** Повторное приглашение тому, кто ещё не задал пароль. */
    async invite(body: unknown, actor: string): Promise<StaffOutcome<Omit<DeliveryOk, 'ok'>>> {
      const staff = await staffFromBody(body);
      if ('error' in staff) return staff.error;
      if (!staff.row.active) return bad('Пользователь отключён. Сначала включите его.');
      if (staff.row.password_hash) return bad('Пароль уже задан. Чтобы дать новый, нажмите «Сбросить пароль».');
      return deliver(staff.row, 'invite', actor);
    },

    /** Сброс пароля администратором: прежний пароль продолжает работать, пока человек не задаст новый. */
    async reset(body: unknown, actor: string): Promise<StaffOutcome<Omit<DeliveryOk, 'ok'>>> {
      const staff = await staffFromBody(body);
      if ('error' in staff) return staff.error;
      if (!staff.row.active) return bad('Пользователь отключён. Сначала включите его.');
      return deliver(staff.row, staff.row.password_hash ? 'reset' : 'invite', actor);
    },

    async setPersonalMode(body: unknown, actor: string): Promise<StaffOutcome> {
      const enabled = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['enabled'] : undefined;
      if (typeof enabled !== 'boolean') return bad('Нужно указать enabled: true или false.');
      if (enabled && (await deps.staff.activeWithPassword()) === 0) {
        return bad('Нельзя включить: ни один действующий пользователь ещё не задал пароль.');
      }
      await deps.settings.set(PERSONAL_SETTING, enabled, actor);
      await deps.staff.auditEvent(actor, enabled ? 'auth.personal_on' : 'auth.personal_off', {});
      deps.onChange?.();
      return { ok: true };
    },

    /**
     * «Забыли пароль»: ответ всегда одинаковый, существует ли такой логин, не раскрывается. Ссылка уходит
     * только на почту из карточки и только если почта настроена; частота ограничена по человеку и по адресу клиента.
     */
    async requestReset(identifier: string, ip: string): Promise<void> {
      const key = `hg:reset:${ip}`;
      if ((await deps.store.incr(key, 3600)) > 10) return;
      const id = identifier.trim();
      if (id === '' || id.length > 254) return;
      const staff = await deps.staff.byLoginOrEmail(id);
      if (!staff || !staff.active) return;
      if ((await deps.staff.recentTokens(staff.id, 3600)) >= RESET_PER_HOUR) return;
      // Почта не настроена — выслать нечего; администратор увидит просьбу в журнале и даст ссылку сам.
      if (!(deps.mailer.configured && base)) {
        await deps.staff.auditEvent(staff.login, 'staff.reset_requested_no_mail', { staff_id: staff.id });
        return;
      }
      await deliver(staff, staff.password_hash ? 'reset' : 'invite', staff.login);
    },

    /** Что показать на странице по ссылке: имя и логин, если ссылка годна. */
    async tokenInfo(token: string): Promise<{ fullName: string; login: string } | null> {
      if (!token || token.length > 200) return null;
      const s = await deps.staff.staffByToken(hashToken(token));
      return s ? { fullName: s.full_name, login: s.login } : null;
    },

    async completePassword(token: string, password: string, repeat: string, ip: string): Promise<StaffOutcome> {
      // Перебор токена бессмыслен (256 бит), но лишние попытки с одного адреса всё равно режем.
      if ((await deps.store.incr(`hg:setpw:${ip}`, 900)) > 30) return bad('Слишком много попыток. Подождите 15 минут.');
      if (!token || token.length > 200) return bad('Ссылка недействительна или устарела.');
      const s = await deps.staff.staffByToken(hashToken(token));
      if (!s) return bad('Ссылка недействительна или устарела. Попросите администратора выслать новую.');
      if (password !== repeat) return bad('Пароли не совпадают.');
      const problem = passwordProblem(password, { login: s.login, email: s.email });
      if (problem) return bad(problem);
      const done = await deps.staff.setPasswordByToken(hashToken(token), await hashPassword(password));
      deps.onChange?.();
      return done ? { ok: true } : bad('Ссылка недействительна или устарела. Попросите администратора выслать новую.');
    },
  };

  async function staffFromBody(body: unknown): Promise<{ row: StaffRow } | { error: ReturnType<typeof bad> }> {
    const id = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['id'] : undefined;
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) return { error: bad('Нужно указать пользователя.') };
    const row = await deps.staff.byId(id);
    return row ? { row } : { error: bad('Пользователь не найден.', 'not_found') };
  }
}

export type StaffService = ReturnType<typeof createStaffService>;

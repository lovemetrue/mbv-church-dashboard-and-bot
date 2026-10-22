import { formatPhone } from '../core/phone.js';
import type { AuditRepo } from '../db/repos/audit.repo.js';
import type { KitRow, UsersRepo } from '../db/repos/users.repo.js';
import type { ActionError, KitFindOk, KitIssueOk, KitMatch, KitPerson, KitSearchOk, KitsView } from './contracts.js';

type Failure = { ok: false; error: ActionError['error']; message: string };
const bad = (message: string): Failure => ({ ok: false, error: 'bad_request', message });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Длиннее девяти цифр номеров регистрации не бывает: дальше — не номер, а мусор из чужого QR. */
const NO = '(\\d{1,9})';
const KIT_CODES: readonly RegExp[] = [
  // Карточка из Telegram: диплинк `https://t.me/<бот>?start=kit_1042` (см. `kitPayload` в core/qr.ts).
  new RegExp(`[?&]start=kit_${NO}(?:&|$)`),
  new RegExp(`^kit_${NO}$`),
  // Карточка из MAX и из ручной регистрации: диплинков там нет, в QR только «Регистрация №1042».
  new RegExp(`^Регистрация\\s*№\\s*${NO}$`, 'i'),
  // Номер, введённый руками с подписи карточки.
  new RegExp(`^№?\\s*${NO}$`),
];

/**
 * Номер регистрации из того, что прочитал сканер, или null. Разбирает сервер, а не страница: так виды QR
 * (бот, MAX, ручная регистрация) знает одно место, а интерфейс шлёт текст как есть.
 */
export function parseKitCode(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  const value = text.trim();
  for (const re of KIT_CODES) {
    const match = re.exec(value);
    if (match) {
      const no = Number(match[1]);
      return no > 0 ? no : null;
    }
  }
  return null;
}

/** Короче трёх букв запрос находит пол-списка: «Ан» — это и Анна, и Иванов. */
export const KIT_SEARCH_MIN = 3;
/** Сколько совпадений показывать: больше на экране телефона уже не просмотреть, проще уточнить. */
const KIT_SEARCH_LIMIT = 10;

/**
 * Слова запроса для поиска по ФИО: в нижнем регистре, «ё» как «е», без спецсимволов LIKE. Пустой список —
 * запрос слишком короткий (меньше трёх букв без пробелов).
 */
export function kitSearchWords(query: unknown): string[] {
  if (typeof query !== 'string') return [];
  const words = query.toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean)
    .map((w) => w.replace(/[\\%_]/g, (c) => `\\${c}`));
  return words.join('').replace(/\\/g, '').length >= KIT_SEARCH_MIN ? words : [];
}

const phoneTail = (phone: string | null): string | null => {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
};

/**
 * Кто выдал. Бот пишет id служителя в Telegram (цифры), интерфейс — логин входа. Цифры человеку ничего
 * не скажут, поэтому показываем просто «бот».
 */
const issuedByLabel = (by: string | null): string | null => (by === null ? null : /^\d+$/.test(by) ? 'бот' : by);

function toPerson(row: KitRow): KitPerson {
  const phone = row.phone?.trim() ? formatPhone(row.phone.trim()) : '';
  return {
    userId: row.id,
    registrationNo: row.registration_no,
    fio: row.full_name?.trim() || 'Без имени',
    phone: phone || null,
    issuedAt: row.kit_issued_at ? new Date(row.kit_issued_at).toISOString() : null,
    issuedBy: row.kit_issued_at ? issuedByLabel(row.kit_issued_by) : null,
  };
}

/** Сколько последних выдач показывать: хватает, чтобы заметить и отменить ошибку, но список не разрастается. */
const RECENT = 15;

/**
 * Выдача наборов участникам кампании «40 дней» со сканера на телефоне координатора. Та же отметка
 * `users.kit_issued_at`, что ставит бот, когда служитель сканирует QR камерой Telegram: выдача через бота
 * и через интерфейс видна в обоих местах, а повторно выдать не даст условие в базе.
 */
export function createKits(deps: {
  users: Pick<UsersRepo, 'kitByRegistrationNo' | 'kitById' | 'markKitIssued' | 'unmarkKitIssued' | 'kitStats' | 'recentKits' | 'searchKits'>;
  audit: Pick<AuditRepo, 'write'>;
  timeZone: string;
}) {
  const userIdOf = (body: unknown): number | null => {
    const id = isRecord(body) ? body['userId'] : undefined;
    return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null;
  };

  return {
    async view(): Promise<KitsView> {
      const [stats, recent] = await Promise.all([deps.users.kitStats(deps.timeZone), deps.users.recentKits(RECENT)]);
      return {
        generatedAt: new Date().toISOString(),
        registered: stats.registered,
        issued: stats.issued,
        issuedToday: stats.issued_today,
        recent: recent.map(toPerson),
      };
    },

    async find(body: unknown): Promise<KitFindOk | Failure> {
      const code = isRecord(body) ? body['code'] : undefined;
      const no = parseKitCode(code);
      if (no === null) return bad('Это не QR регистрации. Наведите камеру на карточку участника или введите номер.');
      const row = await deps.users.kitByRegistrationNo(no);
      if (!row) return { ok: false, error: 'not_found', message: `Регистрации №${no} нет.` };
      return { ok: true, person: toPerson(row) };
    },

    /** Поиск по ФИО, когда QR нет под рукой. Ничего не меняет и в журнал не пишется. */
    async search(body: unknown): Promise<KitSearchOk | Failure> {
      const words = kitSearchWords(isRecord(body) ? body['query'] : undefined);
      if (words.length === 0) return bad(`Введите хотя бы ${KIT_SEARCH_MIN} буквы имени или фамилии.`);
      // На одну строку больше лимита: так видно, что совпадений больше, без отдельного подсчёта.
      const rows = await deps.users.searchKits(words, KIT_SEARCH_LIMIT + 1);
      const items: KitMatch[] = rows.slice(0, KIT_SEARCH_LIMIT).map((row) => ({
        userId: row.id,
        registrationNo: row.registration_no,
        fio: row.full_name?.trim() || 'Без имени',
        phoneTail: phoneTail(row.phone),
        issuedAt: row.kit_issued_at ? new Date(row.kit_issued_at).toISOString() : null,
      }));
      return { ok: true, items, more: rows.length > KIT_SEARCH_LIMIT };
    },

    async issue(body: unknown, actor: string): Promise<KitIssueOk | Failure> {
      const id = userIdOf(body);
      if (id === null) return bad('Не указан участник.');
      const before = await deps.users.kitById(id);
      if (!before) return { ok: false, error: 'not_found', message: 'Регистрация не найдена.' };
      const changed = await deps.users.markKitIssued(id, actor);
      // Без имени и телефона: в журнале только номер регистрации.
      if (changed) await deps.audit.write(actor, 'kit.issue', 'user', id, { registrationNo: before.registration_no });
      const after = await deps.users.kitById(id);
      return { ok: true, person: toPerson(after ?? before), changed };
    },

    async undo(body: unknown, actor: string): Promise<KitIssueOk | Failure> {
      const id = userIdOf(body);
      if (id === null) return bad('Не указан участник.');
      const before = await deps.users.kitById(id);
      if (!before) return { ok: false, error: 'not_found', message: 'Регистрация не найдена.' };
      const changed = await deps.users.unmarkKitIssued(id);
      if (changed) await deps.audit.write(actor, 'kit.undo', 'user', id, { registrationNo: before.registration_no });
      const after = await deps.users.kitById(id);
      return { ok: true, person: toPerson(after ?? before), changed };
    },
  };
}

export type Kits = ReturnType<typeof createKits>;

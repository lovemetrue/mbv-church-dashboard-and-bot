import { normalizePhone } from '../core/phone.js';
import { CONTACT_FIELDS, type ContactPatch, type ContactsRepo } from '../db/repos/contacts.repo.js';
import type { ActionError } from './contracts.js';

/**
 * Правка человека в справочнике «Люди» (регистрация `u<id>` и человек из заявки `r<id>`).
 * Поля те же, что в «Править данные» заявки, и пишутся в обе стороны (см. `ContactsRepo`).
 */
type Fail = { ok: false; error: ActionError['error']; message: string };
export type ContactOutcome = { ok: true } | Fail;
const bad = (message: string): Fail => ({ ok: false, error: 'bad_request', message });

const LIMITS: Record<(typeof CONTACT_FIELDS)[number], number> = { fio: 200, phone: 40, age: 60, place: 200, address: 200, schedule: 200 };
const KEY = /^([ur])(\d{1,15})$/;

/** Тело `{fields: {…}}` → правка; текст — понятная ошибка. Пустая строка очищает поле (кроме ФИО). */
export function parseContactPatch(body: unknown): ContactPatch | string {
  const src = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>)['fields'] : null;
  if (typeof src !== 'object' || src === null || Array.isArray(src)) return 'Нечего менять.';
  const fields = src as Record<string, unknown>;
  const out: ContactPatch = {};
  for (const k of Object.keys(fields)) {
    if (!(CONTACT_FIELDS as readonly string[]).includes(k)) return `Поле «${k.slice(0, 40)}» здесь менять нельзя.`;
  }
  for (const k of CONTACT_FIELDS) {
    const v = fields[k];
    if (v === undefined) continue;
    if (v !== null && typeof v !== 'string') return 'Значения должны быть текстом.';
    const t = (v ?? '').trim().replace(/\s+/g, ' ');
    if (t.length > LIMITS[k]) return `Слишком длинный текст (до ${LIMITS[k]} знаков).`;
    if (k === 'fio') {
      if (t === '') return 'ФИО не может быть пустым.';
      out.fio = t;
    } else if (k === 'phone' && t !== '') {
      const phone = normalizePhone(t);
      if (!phone) return 'Не похоже на номер телефона. Пример: +7 911 123-45-67.';
      out.phone = phone;
    } else {
      out[k] = t === '' ? null : t;
    }
  }
  if (Object.keys(out).length === 0) return 'Нечего менять.';
  return out;
}

export function createContacts(deps: { contacts: Pick<ContactsRepo, 'update'> }) {
  return {
    async update(key: string, body: unknown, actor: string): Promise<ContactOutcome> {
      const m = KEY.exec(key);
      if (!m) return bad('Здесь можно править регистрацию или человека из заявки.');
      const patch = parseContactPatch(body);
      if (typeof patch === 'string') return bad(patch);
      const done = await deps.contacts.update(m[1] as 'u' | 'r', Number(m[2]), patch, actor);
      return done.ok ? done : { ok: false, error: done.error, message: done.message };
    },
  };
}
export type Contacts = ReturnType<typeof createContacts>;

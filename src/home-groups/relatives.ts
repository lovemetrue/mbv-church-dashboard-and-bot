import type { RelativesRepo, RelativeRow } from '../db/repos/relatives.repo.js';
import { parsePersonKey } from '../db/repos/members.repo.js';
import type { ActionError, PersonRelative, RelativeHint, RelativeKind } from './contracts.js';

/**
 * Родственники в «Людях» (миграция 071): связь между двумя людьми, видная с обеих сторон, и подсказки «возможно,
 * родственник». Здесь — чистые правила (обратная степень, фамилия с учётом рода, сравнение адресов) и разбор тел
 * запросов; SQL — в `RelativesRepo`.
 */

export const RELATIVE_KINDS: readonly RelativeKind[] = ['spouse', 'parent', 'child', 'sibling', 'other'];
type StoredKind = Exclude<RelativeKind, 'child'>;

/** Кем приходится владелец карточки тому, кто приходится ему `kind`: родитель ↔ ребёнок, остальные сами себе. */
export function inverseKind(kind: RelativeKind): RelativeKind {
  return kind === 'parent' ? 'child' : kind === 'child' ? 'parent' : kind;
}

/**
 * Как записать «`otherKey` приходится `key`: `kind`». «Ребёнок» хранится как «родитель» с другой стороны: у пары
 * одна строка, и противоречивых «оба — родители друг друга» не бывает.
 */
export function storedRelation(key: string, otherKey: string, kind: RelativeKind): { aKey: string; bKey: string; kind: StoredKind } {
  return kind === 'child' ? { aKey: otherKey, bKey: key, kind: 'parent' } : { aKey: key, bKey: otherKey, kind };
}

/** Ключ пары без порядка: по нему узнаём уже связанных. */
export const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Связи по людям: каждая строка — обеим сторонам, со степенью «кем он приходится владельцу карточки». Связь с тем, кого
 * в «Людях» нет (удалённая карточка, регистрация), не показывается: `names` — люди справочника.
 */
export function relativesByPerson(rows: readonly RelativeRow[], names: ReadonlyMap<string, string>): Map<string, PersonRelative[]> {
  const out = new Map<string, PersonRelative[]>();
  const push = (owner: string, r: PersonRelative) => out.set(owner, [...(out.get(owner) ?? []), r]);
  for (const r of rows) {
    const a = names.get(r.a_key);
    const b = names.get(r.b_key);
    if (a === undefined || b === undefined) continue;
    push(r.a_key, { id: r.id, key: r.b_key, fio: b, kind: r.kind });
    push(r.b_key, { id: r.id, key: r.a_key, fio: a, kind: inverseKind(r.kind) });
  }
  return out;
}

const norm = (s: string): string => s.toLowerCase().replace(/ё/g, 'е');

/**
 * Фамилия для сравнения — первое слово ФИО, приведённое к одной форме для обоих родов: Иванов/Иванова, Сорокин/Сорокина,
 * Вишневский/Вишневская, Толстой/Толстая. Несклоняемые (Шевченко, Ким) — как есть. null — сравнивать не по чему.
 */
export function surnameKey(fio: string | null | undefined): string | null {
  const t = norm((fio ?? '').trim());
  if (t === '' || t === 'без имени') return null;
  let w = t.split(/\s+/)[0]!.replace(/[^а-яa-z-]/g, '');
  if (/(ов|ев|ин|ын)а$/.test(w)) w = w.slice(0, -1);
  else if (/(ая|ий|ый|ой)$/.test(w)) w = w.slice(0, -2);
  return w.length >= 2 ? w : null;
}

/** Слова адреса, которые его не различают: «ул.», «д.», «кв.», город. */
const ADDRESS_NOISE = new Set(['ул', 'улица', 'д', 'дом', 'кв', 'квартира', 'г', 'город', 'спб', 'санкт', 'петербург', 'пр', 'пр-т', 'проспект', 'пер', 'переулок']);

/** Адрес для сравнения: регистр, знаки и служебные слова не важны, номера дома и квартиры — важны. null — пусто. */
export function addressKey(address: string | null | undefined): string | null {
  const words = norm(address ?? '').split(/[^а-яa-z0-9]+/).filter((w) => w !== '' && !ADDRESS_NOISE.has(w));
  return words.length > 0 ? words.join(' ') : null;
}

/** Последние десять цифр номера — как склейка людей по телефону (миграция 057); короче — не номер. */
const phoneKey = (phone: string | null | undefined): string | null => {
  const d = (phone ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : null;
};

/** Подсказок на одного человека не больше: длинный список никто не разберёт. */
const HINTS_PER_PERSON = 5;
/** Однофамильцев в одной кучке сравниваем попарно; очень частую фамилию без адреса и телефона не перебираем. */
const MAX_SAME_SURNAME = 300;

/**
 * Возможные родственники: та же фамилия (с учётом рода) И тот же телефон или адрес. Только подсказка — связывает
 * служитель кнопкой «Связать». Показанные телефон и адрес — самого владельца карточки (совпавшие с родственником),
 * чтобы подсказка не открывала чужих контактов. Уже связанные (`related`, ключи `pairKey`) не подсказываются.
 */
export function relativeHints(
  people: readonly { key: string; fio: string; phone: string | null; address: string | null }[],
  related: ReadonlySet<string>,
): Map<string, RelativeHint[]> {
  const bySurname = new Map<string, typeof people[number][]>();
  for (const p of people) {
    const s = surnameKey(p.fio);
    if (s === null || (phoneKey(p.phone) === null && addressKey(p.address) === null)) continue;
    bySurname.set(s, [...(bySurname.get(s) ?? []), p]);
  }
  const out = new Map<string, RelativeHint[]>();
  const push = (owner: string, h: RelativeHint) => {
    const list = out.get(owner) ?? [];
    if (list.length < HINTS_PER_PERSON) out.set(owner, [...list, h]);
  };
  for (const same of bySurname.values()) {
    if (same.length < 2 || same.length > MAX_SAME_SURNAME) continue;
    for (let i = 0; i < same.length; i += 1) {
      for (let j = i + 1; j < same.length; j += 1) {
        const a = same[i]!;
        const b = same[j]!;
        if (a.key === b.key || related.has(pairKey(a.key, b.key))) continue;
        const phone = phoneKey(a.phone) !== null && phoneKey(a.phone) === phoneKey(b.phone);
        const address = addressKey(a.address) !== null && addressKey(a.address) === addressKey(b.address);
        if (!phone && !address) continue;
        push(a.key, { key: b.key, fio: b.fio, samePhone: phone ? a.phone : null, sameAddress: address ? a.address : null });
        push(b.key, { key: a.key, fio: a.fio, samePhone: phone ? b.phone : null, sameAddress: address ? b.address : null });
      }
    }
  }
  return out;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Тело «+ добавить»: `otherKey` приходится `key` степенью `kind`. Текст — понятная ошибка. */
export function parseRelativeAdd(body: unknown): { key: string; otherKey: string; kind: RelativeKind } | string {
  if (!isRecord(body)) return 'Нужно указать человека и родственника.';
  const key = body['key'];
  const otherKey = body['otherKey'];
  if (!parsePersonKey(key) || !parsePersonKey(otherKey)) return 'Не удалось определить человека.';
  if (key === otherKey) return 'Нельзя связать человека с самим собой.';
  const kind = body['kind'];
  if (typeof kind !== 'string' || !(RELATIVE_KINDS as readonly string[]).includes(kind)) return 'Степень родства — из списка.';
  return { key: key as string, otherKey: otherKey as string, kind: kind as RelativeKind };
}

type Failure = { ok: false; error: ActionError['error']; message: string };
export type RelativeOutcome = { ok: true } | Failure;
const bad = (message: string): Failure => ({ ok: false, error: 'bad_request', message });

export function createRelatives(deps: { repo: Pick<RelativesRepo, 'add' | 'remove'> }) {
  return {
    async add(body: unknown, actor: string): Promise<RelativeOutcome> {
      const parsed = parseRelativeAdd(body);
      if (typeof parsed === 'string') return bad(parsed);
      const s = storedRelation(parsed.key, parsed.otherKey, parsed.kind);
      return deps.repo.add(s.aKey, s.bKey, s.kind, actor);
    },
    async remove(body: unknown, actor: string): Promise<RelativeOutcome> {
      const id = isRecord(body) ? body['id'] : null;
      if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return bad('Не удалось определить связь.');
      return deps.repo.remove(id, actor);
    },
  };
}
export type Relatives = ReturnType<typeof createRelatives>;

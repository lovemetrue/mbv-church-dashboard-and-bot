import { scrub, type Needs } from './brief.js';

export interface ParseContext {
  refs: ReadonlySet<string>;
  districts: readonly string[];
  ages: readonly string[];
  /**
   * Что у какой записи заказывали модели (`needs`). Остальное скрипт уже определил сам, и ответом модели оно не
   * переопределяется: день недели весит в подборе как район, и «ср» разбирает код, а не догадка. Нет списка — принимается всё.
   */
  needs?: ReadonlyMap<string, Needs>;
}

export interface ParsedHint {
  ref: string;
  district: string | null;
  age: string | null;
  days: string[];
  slot: string | null;
  questions: string[];
  /** Пояснение для служителя: почему что-то осталось неопределённым. Очищено от контактов, до 200 знаков. */
  note: string | null;
}

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const SLOTS = ['утро', 'день', 'вечер'];
const MAX_QUESTIONS = 3;
const MAX_NOTE = 200;

/** Достаёт JSON из ответа модели, даже если он обёрнут в ```json или окружён пояснениями. */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const candidates = [trimmed, trimmed.replace(/^```(?:json)?\s*|\s*```$/g, '')];
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c) as unknown;
    } catch {
      /* пробуем следующий вид */
    }
  }
  return null;
}

/**
 * Ответ модели — это текст, а не данные: каждое поле перепроверяется по справочникам. Что не из списка (выдуманный район,
 * возраст «около тридцати», день «завтра»), отбрасывается; вопросы очищаются от контактов. Мусорный ответ даёт пустой результат.
 */
export function parseReply(text: string, ctx: ParseContext): ParsedHint[] {
  const root = extractJson(text);
  const items = typeof root === 'object' && root !== null ? (root as { items?: unknown }).items : null;
  if (!Array.isArray(items)) return [];

  const districts = new Map(ctx.districts.map((d) => [d.trim().toLowerCase(), d]));
  const seen = new Set<string>();
  const out: ParsedHint[] = [];
  for (const raw of items) {
    if (typeof raw !== 'object' || raw === null) continue;
    const it = raw as Record<string, unknown>;
    const ref = typeof it['ref'] === 'string' ? it['ref'] : '';
    if (!ctx.refs.has(ref) || seen.has(ref)) continue;
    seen.add(ref);

    const asked = ctx.needs?.get(ref);
    const district = typeof it['district'] === 'string' && (asked?.district ?? true)
      ? (districts.get(it['district'].trim().toLowerCase()) ?? null)
      : null;
    const age = typeof it['age'] === 'string' && (asked?.age ?? true) && ctx.ages.includes(it['age'].trim()) ? it['age'].trim() : null;
    const days = Array.isArray(it['days']) && (asked?.time ?? true)
      ? DAYS.filter((d) => (it['days'] as unknown[]).includes(d))
      : [];
    const slot = typeof it['slot'] === 'string' && (asked?.time ?? true) && SLOTS.includes(it['slot']) ? it['slot'] : null;
    const questions: string[] = [];
    if (Array.isArray(it['questions'])) {
      for (const q of it['questions']) {
        if (typeof q !== 'string') continue;
        const clean = scrub(q);
        if (clean === null || clean.length < 8 || q.length > 160) continue;
        questions.push(clean);
        if (questions.length === MAX_QUESTIONS) break;
      }
    }
    // Длинное пояснение обрезаем, а не выбрасываем: без него служитель не узнает, почему поле пустое.
    const note = typeof it['comment'] === 'string' ? scrub(it['comment'], MAX_NOTE) : null;
    out.push({ ref, district, age, days, slot, questions, note });
  }
  return out;
}

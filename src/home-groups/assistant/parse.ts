import { scrub } from './brief.js';

export interface ParseContext {
  refs: ReadonlySet<string>;
  districts: readonly string[];
  ages: readonly string[];
}

export interface ParsedHint {
  ref: string;
  district: string | null;
  age: string | null;
  days: string[];
  slot: string | null;
  questions: string[];
}

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const SLOTS = ['утро', 'день', 'вечер'];
const MAX_QUESTIONS = 3;

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

    const district = typeof it['district'] === 'string' ? (districts.get(it['district'].trim().toLowerCase()) ?? null) : null;
    const age = typeof it['age'] === 'string' && ctx.ages.includes(it['age'].trim()) ? it['age'].trim() : null;
    const days = Array.isArray(it['days'])
      ? DAYS.filter((d) => (it['days'] as unknown[]).includes(d))
      : [];
    const slot = typeof it['slot'] === 'string' && SLOTS.includes(it['slot']) ? it['slot'] : null;
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
    out.push({ ref, district, age, days, slot, questions });
  }
  return out;
}

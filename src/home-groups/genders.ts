import { genderWithHints, unresolvedNameWords, type Gender } from '../core/gender.js';
import { parsePersonKey } from '../db/repos/members.repo.js';
import type { GendersRepo } from '../db/repos/genders.repo.js';
import type { ActionOutcome } from '../db/repos/placement.repo.js';
import type { StrangeTarget } from '../db/repos/strange.repo.js';
import { resolveLlm, type LlmClient, type LlmSource } from '../platform/llm/deepseek.js';
import type { ActionError, GenderAiOk } from './contracts.js';

const bad = (message: string): ActionOutcome => ({ ok: false, error: 'bad_request', message });
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
type Failure = { ok: false; error: ActionError['error']; message: string };

/** Слов в одном запросе к модели и за один прогон: ограничивают расход. */
const BATCH = 150;
const MAX_WORDS = 1500;

const SYSTEM = `Ты определяешь пол по одному слову — имени человека (русскому или другому, полному или домашнему).
Ответь одним JSON-объектом {"words": {"<слово>": "м" | "ж" | "?"}} для каждого слова из списка.
"м" — слово почти всегда мужское имя, "ж" — почти всегда женское. "?" — если это не имя (например, фамилия без
явного окончания), имя бывает и мужским, и женским (Саша, Женя, Валя), или ты не уверен. Лучше "?", чем ошибка.`;

/** Человек, которому прогон моделью может подсказать пол: ключ и ФИО. */
export interface GenderCandidate {
  key: string;
  fio: string | null;
}

/**
 * Пол человека: служитель ставит его вручную, а модель помогает заполнить тех, у кого пол из ФИО не понятен.
 * Модели уходят только отдельные слова («Саша», «Ким») — без связи между ними и без ФИО целиком (см.
 * `unresolvedNameWords`): имена людей наружу не уходят, как и у помощника.
 */
export function createGenders(deps: {
  repo: Pick<GendersRepo, 'set' | 'fillFromAi'>;
  llm: LlmClient | LlmSource | null;
  /** Люди без пола (ни поставленного, ни понятного из ФИО) — из того же снимка, что видят служители. */
  unknown: () => Promise<GenderCandidate[]>;
}) {
  let running = false;
  return {
    /** Поставить пол по ключу человека; null — снять поставленное (пол снова из ФИО). */
    async set(body: unknown, actor: string): Promise<ActionOutcome> {
      if (!isRecord(body)) return bad('Нужно указать человека.');
      const ref = parsePersonKey(body['key']);
      if (!ref) return bad('Не удалось определить человека.');
      const g = body['gender'];
      if (g !== null && g !== 'м' && g !== 'ж') return bad('Пол — «м», «ж» или пусто.');
      const target: StrangeTarget = { kind: ref.kind === 'u' ? 'user' : ref.kind === 'r' ? 'request' : 'person', id: ref.id };
      return deps.repo.set(target, g, actor);
    },

    /** Спросить модель про слова из ФИО, по которым пол не понять, и заполнить пол там, где все слова согласны. */
    async fillWithAi(): Promise<GenderAiOk | Failure> {
      const llm = await resolveLlm(deps.llm);
      if (!llm) return { ok: false, error: 'unavailable', message: 'Помощник не подключён: добавьте ключ в «Настройки → Помощник».' };
      if (running) return { ok: false, error: 'conflict', message: 'Разбор уже идёт — дождитесь его окончания.' };
      running = true;
      try {
        const people = await deps.unknown();
        const words = unresolvedNameWords(people.map((p) => p.fio)).slice(0, MAX_WORDS);
        const hints = new Map<string, Gender>();
        for (let i = 0; i < words.length; i += BATCH) {
          const batch = words.slice(i, i + BATCH);
          const reply = await llm.complete({ system: SYSTEM, user: JSON.stringify({ words: batch }), maxTokens: 4000 });
          for (const [w, g] of parseWords(reply.text, new Set(batch))) hints.set(w.toLowerCase().replace(/ё/g, 'е'), g);
        }
        const entries = people.flatMap((p) => {
          const g = genderWithHints(p.fio, hints);
          return g ? [{ key: p.key, gender: g }] : [];
        });
        const filled = await deps.repo.fillFromAi(entries);
        return { ok: true, unknownBefore: people.length, filled, left: people.length - filled };
      } finally {
        running = false;
      }
    },
  };
}

/** Ответ модели: только слова из запроса и только «м»/«ж»; остальное (и непрочитанный ответ) отбрасывается. */
export function parseWords(text: string, asked: ReadonlySet<string>): [string, Gender][] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const words = isRecord(data) && isRecord(data['words']) ? data['words'] : null;
  if (!words) return [];
  return Object.entries(words).flatMap(([w, g]) => (asked.has(w) && (g === 'м' || g === 'ж') ? [[w, g] as [string, Gender]] : []));
}

export type Genders = ReturnType<typeof createGenders>;

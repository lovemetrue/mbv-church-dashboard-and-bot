import type {
  AgeRange, Day, PlanEngineApi, PlanEntry, PlanGroup, PlanInput, PlanOutput, PlanSettings, Slot, SummaryInput,
} from '../../src/home-groups/plan/types.js';

/**
 * Поддельный движок для тестов сервиса «Домашние группы».
 *
 * Настоящий движок (`src/home-groups/plan/`) проверяется своими тестами; здесь важно другое:
 * что именно слой представлений ему передал и как разложил ответ. Поэтому все вызовы
 * записываются, а решения детерминированы и просты: заявке предлагается первая группа её района.
 */

export const FAKE_SETTINGS: PlanSettings = {
  weights: { district: 40, age: 25, time: 20, street: 15 },
  defaultCapacity: 10,
  humanThreshold: 60,
  staleDays: 30,
  stalePenalty: 5,
  lastSeatPenalty: 3,
  confidenceFloor: 0.55,
  confidenceSpan: 0.45,
  neighbors: {},
};

const DISTRICT_WORDS: Record<string, string> = { приморск: 'Приморский', невск: 'Невский', выборг: 'Выборгский' };
const DAYS: Record<string, Day> = {
  пон: 'Пн', вто: 'Вт', сре: 'Ср', чет: 'Чт', пят: 'Пт', суб: 'Сб', вос: 'Вс',
};

export interface FakeEngineCalls {
  plan: PlanInput[];
  summary: SummaryInput[];
  bucket: Parameters<PlanEngineApi['bucketOf']>[0][];
  resolve: { place: string | null; metroIndex: ReadonlyMap<string, string> | undefined }[];
}

export interface FakeEngineOptions {
  /** Принудительная корзина для записи плана (например, callback, которого в этапе A не бывает). */
  bucketByEntry?: Map<PlanEntry, 'ready' | 'callback' | 'human'>;
  /** Заранее заданный план для заявки: подменяет простое решение «первая группа района». */
  entries?: Record<number, PlanEntry>;
  /** Что вернёт `takenBy`. */
  takenBy?: Record<number, number[]>;
}

export function createFakeEngine(options: FakeEngineOptions = {}): { engine: PlanEngineApi; calls: FakeEngineCalls } {
  const calls: FakeEngineCalls = { plan: [], summary: [], bucket: [], resolve: [] };

  const engine: PlanEngineApi = {
    DEFAULT_SETTINGS: FAKE_SETTINGS,

    buildPlan(input) {
      calls.plan.push(input);
      const entries = new Map<number, PlanEntry>();
      const takenBy = new Map<number, number[]>();
      for (const r of input.requests) {
        const preset = options.entries?.[r.id];
        if (preset) { entries.set(r.id, preset); continue; }
        if (r.district === null) {
          entries.set(r.id, { kind: 'none', code: 'place', reason: 'Район не определён' });
          continue;
        }
        const g: PlanGroup | undefined = input.groups.find((x) => x.district === r.district && x.status === 'Функционирует');
        if (!g) { entries.set(r.id, { kind: 'none', code: 'nogroup', reason: `В районе ${r.district} нет групп` }); continue; }
        entries.set(r.id, {
          kind: 'proposal',
          main: { groupId: g.id, score: 80, reasons: [{ tone: 'good', text: 'тот же район' }] },
          confidence: 70,
          knownParams: 2,
          alternatives: [],
          displaced: null,
        });
        takenBy.set(g.id, [...(takenBy.get(g.id) ?? []), r.id]);
      }
      for (const [g, ids] of Object.entries(options.takenBy ?? {})) takenBy.set(Number(g), ids);
      const out: PlanOutput = { entries, takenBy };
      return out;
    },

    bucketOf(args) {
      calls.bucket.push(args);
      if (args.status === 'Исполнена') return 'done';
      if (args.status === 'Аннулирована') return 'cancelled';
      const entry = args.entry;
      // id заявки в аргументах нет, поэтому принудительную корзину привязываем к самой записи плана.
      const forced = entry ? options.bucketByEntry?.get(entry) : undefined;
      if (forced) return forced;
      if (!entry || entry.kind === 'none' || entry.confidence < args.settings.humanThreshold) return 'human';
      return args.callback ? 'callback' : 'ready';
    },

    buildTodaySummary(input) {
      calls.summary.push(input);
      return { ageColumns: ['18–25', '26–35'], matrix: [], clusters: [], singles: [] };
    },

    resolveDistrict(place, metroIndex) {
      calls.resolve.push({ place, metroIndex });
      if (!place) return null;
      const lower = place.toLowerCase();
      for (const [word, district] of Object.entries(DISTRICT_WORDS)) if (lower.includes(word)) return district;
      for (const word of lower.split(/[\s,.]+/)) {
        const hit = metroIndex?.get(word);
        if (hit) return hit;
      }
      return null;
    },

    buildMetroIndex(groups) {
      const index = new Map<string, string>();
      for (const g of groups) if (g.metro && g.district !== 'Не указан') index.set(g.metro.toLowerCase(), g.district);
      return index;
    },

    parseAgeRange(text): AgeRange {
      const m = text?.match(/(\d+)\D+(\d+)/);
      return m ? [Number(m[1]), Number(m[2])] : null;
    },

    parseGroupWhen(day, time) {
      const d = day ? DAYS[day.trim().toLowerCase().slice(0, 3)] ?? null : null;
      let slot: Slot | null = null;
      const hour = time?.match(/^(\d{1,2}):/);
      if (hour) slot = Number(hour[1]) >= 17 ? 'вечер' : Number(hour[1]) >= 12 ? 'день' : 'утро';
      return { day: d, slot };
    },

    formatWhen(day, slot) {
      const parts = [day, slot].filter(Boolean);
      return parts.length ? parts.join(', ') : null;
    },

    ageColumnOf() { return null; },
  };

  return { engine, calls };
}

import { bucketOf, buildPlan } from './engine.js';
import { buildMetroIndex, resolveDistrict } from './geo.js';
import { ageColumnOf, formatWhen, parseAgeRange, parseGroupWhen } from './parse.js';
import { DEFAULT_SETTINGS } from './settings.js';
import { buildTodaySummary } from './summary.js';
import type { PlanEngineApi } from './types.js';

export { bucketOf, buildPlan, exclusionReason, knownParamsOf, match, needsHuman } from './engine.js';
export type { KnownParams, MatchResult } from './engine.js';
export { METRO_DISTRICT, NEIGHBORS, buildMetroIndex, normalizeStation, resolveDistrict } from './geo.js';
export {
  AGE_COLUMNS,
  AGE_COLUMN_RANGES,
  ageColumnOf,
  ageColumnsOverlapping,
  formatWhen,
  parseAgeRange,
  parseGroupWhen,
} from './parse.js';
export { DEFAULT_SETTINGS } from './settings.js';
export { buildTodaySummary } from './summary.js';
export type * from './types.js';

/**
 * Движок целиком — то, что сервер получает через внедрение зависимости (в тестах сервера
 * подставляется поддельный). `satisfies` ловит расхождение с `PlanEngineApi` при компиляции.
 */
export const engine = {
  DEFAULT_SETTINGS,
  buildPlan,
  bucketOf,
  buildTodaySummary,
  resolveDistrict,
  buildMetroIndex,
  parseAgeRange,
  parseGroupWhen,
  formatWhen,
  ageColumnOf,
} satisfies PlanEngineApi;

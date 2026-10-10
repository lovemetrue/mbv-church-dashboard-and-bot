import type { Pool } from 'pg';
import { CoordinatorsRepo } from '../db/repos/coordinators.repo.js';
import { GroupsRepo } from '../db/repos/groups.repo.js';
import { RequestsRepo } from '../db/repos/requests.repo.js';
import { UsersRepo } from '../db/repos/users.repo.js';
import { createViewsSource } from './api/snapshot.js';
import type { Views } from './api/views.js';
import { createLoader } from './loader.js';
import type { PlanEngineApi } from './plan/types.js';

/**
 * Склейка сервиса: настоящая база + движок = готовые представления.
 *
 * Движок приходит параметром, а не импортируется внутри: тесты подставляют поддельный.
 */
export function composeViews(
  db: Pool,
  engine: PlanEngineApi,
  opts: { defaultCapacity: number; ttlMs: number; timeZone?: string },
): () => Promise<Views> {
  return createViewsSource({
    load: createLoader({
      groups: new GroupsRepo(db),
      requests: new RequestsRepo(db),
      users: new UsersRepo(db),
      coordinators: new CoordinatorsRepo(db),
    }),
    engine,
    ttlMs: opts.ttlMs,
    views: { defaultCapacity: opts.defaultCapacity, ...(opts.timeZone ? { timeZone: opts.timeZone } : {}) },
  });
}

/** Настоящий движок плана: в бою он внедряется в сервис, в тестах сервера вместо него поддельный. */
export { engine } from './plan/index.js';

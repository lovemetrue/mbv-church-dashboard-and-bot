import type { Pool } from 'pg';
import { AuditRepo } from '../db/repos/audit.repo.js';
import { CoordinatorsRepo } from '../db/repos/coordinators.repo.js';
import { GroupsRepo } from '../db/repos/groups.repo.js';
import { PlacementRepo } from '../db/repos/placement.repo.js';
import { RequestsRepo } from '../db/repos/requests.repo.js';
import { UsersRepo } from '../db/repos/users.repo.js';
import { createViewsSource, type ViewsSource } from './api/snapshot.js';
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
): ViewsSource {
  return createViewsSource({
    load: createLoader({
      groups: new GroupsRepo(db),
      requests: new RequestsRepo(db),
      users: new UsersRepo(db),
      coordinators: new CoordinatorsRepo(db),
      placement: new PlacementRepo(db),
      audit: new AuditRepo(db),
    }),
    engine,
    ttlMs: opts.ttlMs,
    views: { defaultCapacity: opts.defaultCapacity, ...(opts.timeZone ? { timeZone: opts.timeZone } : {}) },
  });
}

/** Настоящий движок плана: в бою он внедряется в сервис, в тестах сервера вместо него поддельный. */
export { engine } from './plan/index.js';

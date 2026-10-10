import type { Pool } from 'pg';
import { AuditRepo } from '../db/repos/audit.repo.js';
import { CoordinatorsRepo } from '../db/repos/coordinators.repo.js';
import { GroupsRepo } from '../db/repos/groups.repo.js';
import { PlacementRepo } from '../db/repos/placement.repo.js';
import { SettingsRepo } from '../db/repos/settings.repo.js';
import { RequestsRepo } from '../db/repos/requests.repo.js';
import { UsersRepo } from '../db/repos/users.repo.js';
import { createViewsSource, type ViewsSource } from './api/snapshot.js';
import { createLoader } from './loader.js';
import { createMatching } from './matching/run.js';
import type { PlanEngineApi } from './plan/types.js';

export interface ComposeOptions { defaultCapacity: number; ttlMs: number; timeZone?: string }

/**
 * Склейка сервиса: настоящая база + движок = готовые представления и подбор для новых заявок.
 * Читают они одним загрузчиком, поэтому подбор видит ровно то, что и список.
 *
 * Движок приходит параметром, а не импортируется внутри: тесты подставляют поддельный.
 */
export function composeService(db: Pool, engine: PlanEngineApi, opts: ComposeOptions) {
  const placement = new PlacementRepo(db);
  const settings = new SettingsRepo(db);
  const load = createLoader({
    groups: new GroupsRepo(db),
    requests: new RequestsRepo(db),
    users: new UsersRepo(db),
    coordinators: new CoordinatorsRepo(db),
    placement,
    audit: new AuditRepo(db),
    settings,
  }, opts.timeZone ? { timeZone: opts.timeZone } : {});
  const viewOptions = { defaultCapacity: opts.defaultCapacity, ...(opts.timeZone ? { timeZone: opts.timeZone } : {}) };

  const views = createViewsSource({ load, engine, ttlMs: opts.ttlMs, views: viewOptions });
  const matching = createMatching({
    load, engine, placement, settings, options: viewOptions, invalidate: () => views.invalidate(),
  });
  return { views, matching, placement };
}

export function composeViews(db: Pool, engine: PlanEngineApi, opts: ComposeOptions): ViewsSource {
  return composeService(db, engine, opts).views;
}

/** Настоящий движок плана: в бою он внедряется в сервис, в тестах сервера вместо него поддельный. */
export { engine } from './plan/index.js';

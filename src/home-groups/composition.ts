import type { Pool } from 'pg';
import { AuditRepo } from '../db/repos/audit.repo.js';
import { CoordinatorsRepo } from '../db/repos/coordinators.repo.js';
import { GroupsRepo } from '../db/repos/groups.repo.js';
import { ErrorsRepo } from '../db/repos/errors.repo.js';
import { PromptsRepo } from '../db/repos/prompts.repo.js';
import { PlacementRepo } from '../db/repos/placement.repo.js';
import { SettingsRepo } from '../db/repos/settings.repo.js';
import { RequestsRepo } from '../db/repos/requests.repo.js';
import { UsersRepo } from '../db/repos/users.repo.js';
import { createViewsSource, type ViewsSource } from './api/snapshot.js';
import { createSettings } from '../platform/settings/service.js';
import { realHealthSources, collectHealth } from '../platform/settings/health.js';
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
export function composeService(db: Pool, engine: PlanEngineApi, opts: ComposeOptions & { pingSessions?: () => Promise<void> }) {
  const placement = new PlacementRepo(db);
  const appSettings = new SettingsRepo(db);
  const load = createLoader({
    groups: new GroupsRepo(db),
    requests: new RequestsRepo(db),
    users: new UsersRepo(db),
    coordinators: new CoordinatorsRepo(db),
    placement,
    audit: new AuditRepo(db),
    settings: appSettings,
  }, opts.timeZone ? { timeZone: opts.timeZone } : {});
  const viewOptions = { defaultCapacity: opts.defaultCapacity, ...(opts.timeZone ? { timeZone: opts.timeZone } : {}) };

  const views = createViewsSource({ load, engine, ttlMs: opts.ttlMs, views: viewOptions });
  const matching = createMatching({
    load, engine, placement, settings: appSettings, options: viewOptions, invalidate: () => views.invalidate(),
  });
  const errors = new ErrorsRepo(db);
  const settings = createSettings({
    audit: new AuditRepo(db),
    errors,
    prompts: new PromptsRepo(db),
    health: () => collectHealth(realHealthSources(db, opts.pingSessions ?? (async () => undefined))),
  });
  return { views, matching, placement, settings, errors };
}

export function composeViews(db: Pool, engine: PlanEngineApi, opts: ComposeOptions): ViewsSource {
  return composeService(db, engine, opts).views;
}

/** Настоящий движок плана: в бою он внедряется в сервис, в тестах сервера вместо него поддельный. */
export { engine } from './plan/index.js';

import type { AuditRepo } from '../db/repos/audit.repo.js';
import type { CoordinatorsRepo } from '../db/repos/coordinators.repo.js';
import type { GroupsRepo } from '../db/repos/groups.repo.js';
import type { PlacementRepo } from '../db/repos/placement.repo.js';
import type { SettingsRepo } from '../db/repos/settings.repo.js';
import type { RequestsRepo } from '../db/repos/requests.repo.js';
import type { UsersRepo } from '../db/repos/users.repo.js';
import type { ViewsInput } from './api/views.js';

export interface LoaderRepos {
  groups: Pick<GroupsRepo, 'forDashboard'>;
  requests: Pick<RequestsRepo, 'forDashboard'>;
  users: Pick<UsersRepo, 'listRegistered'>;
  coordinators: Pick<CoordinatorsRepo, 'listActive'>;
  placement: Pick<PlacementRepo, 'rejectedGroups' | 'activeProposals' | 'placedSinceFeedback'>;
  settings: Pick<SettingsRepo, 'get'>;
  audit: Pick<AuditRepo, 'requestEntries'>;
}

/**
 * Читает всё нужное сервису одним заходом. SQL здесь нет: только существующие репозитории
 * (тот же слой, что у старого дашборда), поэтому архивные записи и закрытые поля отсекаются там же.
 */
export function createLoader(repos: LoaderRepos, opts: { timeZone?: string } = {}): () => Promise<ViewsInput> {
  return async () => {
    const [groups, requests, participants, coordinators, rejectedGroups, audit, activeProposals, placedNew, auto, lastRun] = await Promise.all([
      repos.groups.forDashboard(),
      repos.requests.forDashboard(),
      repos.users.listRegistered(),
      repos.coordinators.listActive(),
      repos.placement.rejectedGroups(),
      repos.audit.requestEntries(),
      repos.placement.activeProposals(),
      repos.placement.placedSinceFeedback(opts.timeZone),
      repos.settings.get<boolean>('matching.auto'),
      repos.settings.get<NonNullable<ViewsInput['matching']>['lastRun']>('matching.last_run'),
    ]);
    return {
      groups, requests, participants, coordinators, rejectedGroups, audit, activeProposals, placedNew,
      matching: { auto: auto === true, lastRun: lastRun ?? null },
    };
  };
}

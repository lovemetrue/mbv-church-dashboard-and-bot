import type { CoordinatorsRepo } from '../db/repos/coordinators.repo.js';
import type { GroupsRepo } from '../db/repos/groups.repo.js';
import type { RequestsRepo } from '../db/repos/requests.repo.js';
import type { UsersRepo } from '../db/repos/users.repo.js';
import type { ViewsInput } from './api/views.js';

export interface LoaderRepos {
  groups: Pick<GroupsRepo, 'forDashboard'>;
  requests: Pick<RequestsRepo, 'forDashboard'>;
  users: Pick<UsersRepo, 'listRegistered'>;
  coordinators: Pick<CoordinatorsRepo, 'listActive'>;
}

/**
 * Читает всё нужное сервису одним заходом. SQL здесь нет: только существующие репозитории
 * (тот же слой, что у старого дашборда), поэтому архивные записи и закрытые поля отсекаются там же.
 */
export function createLoader(repos: LoaderRepos): () => Promise<ViewsInput> {
  return async () => {
    const [groups, requests, participants, coordinators] = await Promise.all([
      repos.groups.forDashboard(),
      repos.requests.forDashboard(),
      repos.users.listRegistered(),
      repos.coordinators.listActive(),
    ]);
    return { groups, requests, participants, coordinators };
  };
}

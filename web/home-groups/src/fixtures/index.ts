import { buildCoordinators, buildGroups, buildPeople, buildRequests, buildToday } from './build';

/** Ответ «сервера» в режиме фикстур. Путь — как в apiGet: «today», «requests»… */
export function fixtureResponse(path: string): unknown {
  switch (path.replace(/^\/+/, '').replace(/\/+$/, '')) {
    case 'me':
      return { role: 'admin' };
    case 'today':
      return buildToday();
    case 'requests':
      return buildRequests();
    case 'groups':
      return buildGroups();
    case 'people':
      return buildPeople();
    case 'coordinators':
      return buildCoordinators();
    default:
      throw new Error(`В фикстурах нет маршрута: ${path}`);
  }
}

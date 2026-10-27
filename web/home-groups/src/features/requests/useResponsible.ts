import { isLeadView, type RequestsView } from '../../entities/others';
import { useMe } from '../../shared/api/queries';
import { RESP_ALL, RESP_MINE, useAppNav } from '../../shared/nav';

/**
 * Отбор «В работе у» с учётом того, кто вошёл. Пока в адресе пусто, действует отбор по умолчанию для роли (см.
 * `teamKinds` из справочника ролей, их бывает несколько): распределителю в «Хотят в группу» и прочих обращениях — свои и ничьи, координатору в «Хотят открыть
 * группу» и «Дают дом» — только свои. Сброс на «Все» пишется в адрес явно (RESP_ALL), иначе умолчание вернулось бы.
 */
export function useResponsible(view: RequestsView): { value: string; myName: string | null; set: (who: string) => void } {
  const nav = useAppNav();
  const person = useMe().data?.person;
  const myName = person?.name ?? null;
  const kinds = person?.teamKinds ?? [];
  // Ролей бывает несколько: распределитель и координатор сразу получает умолчание каждой роли в её списке. Старшие и
  // катализатор смотрят за всеми, поэтому их роль снимает умолчания остальных.
  const senior = kinds.some((k) => k === 'senior' || k === 'senior_distributor' || k === 'catalyst');
  const byDefault = !myName || senior ? ''
    : kinds.includes('distributor') && !isLeadView(view) ? RESP_MINE
    : kinds.includes('coordinator') && isLeadView(view) ? myName
    : '';
  // Поиск ищет по всем: распределитель набирает фамилию человека, которого взял другой, и умолчание «мои» прятало
  // его без следа. Выбранное в «В работе у» явно поиск по-прежнему уважает.
  const fallback = nav.search.trim() ? '' : byDefault;
  const value = nav.responsible || fallback;
  const set = (who: string) => nav.setResponsible(who === fallback ? '' : who === '' && fallback ? RESP_ALL : who);
  return { value, myName, set };
}

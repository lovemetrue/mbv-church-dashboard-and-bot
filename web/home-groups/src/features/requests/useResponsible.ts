import type { RequestsView } from '../../entities/others';
import { useMe } from '../../shared/api/queries';
import { RESP_ALL, RESP_MINE, useAppNav } from '../../shared/nav';

/**
 * Отбор «В работе у» с учётом того, кто вошёл. Пока в адресе пусто, действует отбор по умолчанию для роли (см.
 * `teamKinds` из справочника ролей, их бывает несколько): распределителю в «Хотят в группу» и «Других обращениях» — свои и ничьи, координатору в «Хотят открыть
 * группу» — только свои. Сброс на «Все» пишется в адрес явно (RESP_ALL), иначе умолчание вернулось бы.
 */
export function useResponsible(view: RequestsView): { value: string; myName: string | null; set: (who: string) => void } {
  const nav = useAppNav();
  const person = useMe().data?.person;
  const myName = person?.name ?? null;
  const kinds = person?.teamKinds ?? [];
  // Ролей бывает несколько: распределитель и координатор сразу получает умолчание каждой роли в её списке. Старший
  // координатор смотрит за всеми, поэтому его роль снимает умолчания остальных.
  const senior = kinds.includes('senior');
  const byDefault = !myName || senior ? ''
    : kinds.includes('distributor') && view !== 'leads' ? RESP_MINE
    : kinds.includes('coordinator') && view === 'leads' ? myName
    : '';
  const value = nav.responsible || byDefault;
  const set = (who: string) => nav.setResponsible(who === byDefault ? '' : who === '' && byDefault ? RESP_ALL : who);
  return { value, myName, set };
}

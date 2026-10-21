import { useMe } from '../../shared/api/queries';
import { RESP_ALL, RESP_MINE, useAppNav } from '../../shared/nav';

/**
 * Отбор «В работе у» с учётом того, кто вошёл. При личном входе по умолчанию (в адресе пусто) — свои заявки и те,
 * что никто не взял: координатору не нужно настраивать отбор самому. «Все» тогда пишется в адрес явно (RESP_ALL),
 * иначе снова встали бы «мои». При общем входе всё как раньше: пусто — все.
 */
export function useResponsible(): { value: string; myName: string | null; set: (who: string) => void } {
  const nav = useAppNav();
  const myName = useMe().data?.person?.name ?? null;
  const value = nav.responsible || (myName ? RESP_MINE : '');
  const set = (who: string) => nav.setResponsible(who === '' && myName ? RESP_ALL : who === RESP_MINE ? '' : who);
  return { value, myName, set };
}

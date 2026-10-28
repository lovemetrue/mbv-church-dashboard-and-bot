import type { Me } from '@contracts';
import { useMe } from './api/queries';

/**
 * Что можно делать этим входом — для того, чтобы не показывать кнопок, на которые сервер всё равно ответит 403.
 * Настоящая защита — на сервере (`readonlyAllows`, `mayEditGroups` в server.ts); здесь только удобство.
 *
 * Пока `/me` не пришёл, считаем, что можно: иначе у всех остальных кнопки появлялись бы с задержкой, а лишнее нажатие
 * входа «Только чтение» всё равно упрётся в отказ сервера.
 */
export function canChange(me: Me | undefined): boolean {
  return me?.role !== 'readonly';
}

/**
 * Правит ли вход карточки групп. У кого в команде только роль распределителя, тот направляет людей по заявкам, а поля
 * группы меняют координаторы. Смысл роли — `teamKinds`, а не её название.
 */
export function canEditGroups(me: Me | undefined): boolean {
  if (!canChange(me)) return false;
  const kinds = me?.person?.teamKinds ?? [];
  return !(kinds.length > 0 && kinds.every((k) => k === 'distributor'));
}

export const useCanChange = (): boolean => canChange(useMe().data);
export const useCanEditGroups = (): boolean => canEditGroups(useMe().data);

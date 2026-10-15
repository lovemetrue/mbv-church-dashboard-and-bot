import { NewGroupIcon } from './NewGroupIcon';
import { WiltedLeafIcon } from './WiltedLeafIcon';

/**
 * Значки группы: зелёный росток — новая группа (потенциальная или открытая меньше четырёх месяцев назад), увядший
 * листочек — в группе никого нет. Могут быть оба сразу: новая группа без людей. Одно место на всех экранах, чтобы значки
 * ставились и пропадали одинаково.
 */
export function GroupMarks({ g, size = 16 }: { g: { isNew: boolean; empty: boolean }; size?: number }) {
  return (
    <>
      {g.isNew && <NewGroupIcon size={size} />}
      {g.empty && <WiltedLeafIcon size={size} />}
    </>
  );
}

import { GroupsWorkplace } from '../reference/ReferenceScreen';

/**
 * Вкладка «Группы»: рабочее место координатора. Это та же таблица групп, что в «Справочнике → Группы» (с теми же отборами,
 * столбцами и сохранёнными видами), только вынесенная на верхний уровень, чтобы её не искать в справочнике.
 */
export function GroupsScreen() {
  return <GroupsWorkplace />;
}

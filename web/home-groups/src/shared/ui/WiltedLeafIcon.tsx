import { Sprout } from './Sprout';

/**
 * Значок «группа не набрала людей»: тот же росток, но ярко-оранжевый. Название файла прежнее, пока на него ссылаются тесты и
 * импорты: «увядший листочек» из первой версии заменён оранжевым ростком.
 */
export function WiltedLeafIcon({ size = 16, label = 'Группа не набрала людей' }: { size?: number; label?: string }) {
  return <Sprout tone="wilted" size={size} label={label} />;
}

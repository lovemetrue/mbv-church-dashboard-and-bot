import { Sprout } from './Sprout';

/** Значок «новая группа»: зелёный росток (первые четыре месяца после открытия действующей группы). */
export function NewGroupIcon({ size = 16, label = 'Новая группа' }: { size?: number; label?: string }) {
  return <Sprout tone="new" size={size} label={label} />;
}

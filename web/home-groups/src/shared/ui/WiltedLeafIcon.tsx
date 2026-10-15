/**
 * Значок «в группе никого нет»: увядший листочек, повисший на черешке. Рисуется по сетке 16×16 линией в `currentColor`,
 * цвет по умолчанию — приглушённо-жёлтый из палитры (предупреждение, а не ошибка). Подпись и подсказка — в самом значке.
 */
export function WiltedLeafIcon({ size = 16, label = 'В группе пока никого нет' }: { size?: number; label?: string }) {
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: 'var(--warn)', flex: 'none', verticalAlign: '-0.2em' }}
    >
      <title>{label}</title>
      <path d="M3 2.5C5.4 2.6 7 3.4 8 4.8c.9 1.3 1.1 2.8.7 4.4" />
      <path d="M8.7 9.2C8.2 11 7.2 12.4 5.6 13.4c-1.6-.7-2.4-2.2-2.2-4.2.1-1.7 1.1-3.3 3.1-4.5" />
      <path d="M8.7 9.2c1.1 1 1.7 2 2.3 3.6" />
      <path d="M10.4 13.2c.5.3.9.7 1.2 1.3" />
    </svg>
  );
}

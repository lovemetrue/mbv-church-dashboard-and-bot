/**
 * Значок «новая группа» (заведена под кампанию): росток с двумя листьями. Рисуется по сетке 16×16 линией в
 * цвет текста (`currentColor`), поэтому подстраивается под тему; цвет по умолчанию — зелёный из палитры.
 * Подпись для скринридера и подсказка при наведении — в самом значке: рядом отдельного текста нет.
 */
export function NewGroupIcon({ size = 16, label = 'Новая группа' }: { size?: number; label?: string }) {
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
      style={{ color: 'var(--ok)', flex: 'none', verticalAlign: '-0.2em' }}
    >
      <title>{label}</title>
      <path d="M8 14V8.2" />
      <path d="M8 8.4C8 5.9 6.2 4.2 3.2 4.2c0 2.6 1.7 4.2 4.8 4.2Z" />
      <path d="M8 6.6c0-2.4 1.6-4 4.6-4 0 2.5-1.6 4-4.6 4Z" />
    </svg>
  );
}

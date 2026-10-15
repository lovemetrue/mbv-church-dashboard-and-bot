/**
 * Росток: стебелёк и два сочных листа с прожилками, залитые цветом. Один рисунок на два значка, различаются цветом:
 * зелёный — новая группа, оранжевый — группа не набрала людей. Сетка 16×16, цвет задаёт токен темы (`--sprout`,
 * `--sprout-wilted`), поэтому значок яркий и в светлой, и в тёмной, и в серой теме. Подпись и подсказка — в самом значке.
 */
export function Sprout({ tone, size = 16, label }: { tone: 'new' | 'wilted'; size?: number; label: string }) {
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-tone={tone}
      style={{ color: tone === 'new' ? 'var(--sprout)' : 'var(--sprout-wilted)', flex: 'none', verticalAlign: '-0.2em' }}
    >
      <title>{label}</title>
      {/* Стебель и земля. */}
      <path d="M8 14V8.4" stroke="currentColor" strokeWidth="1.7" />
      <path d="M5.2 14.4h5.6" stroke="currentColor" strokeWidth="1.5" opacity="0.55" />
      {/* Листья: заливка цветом, обводка того же цвета делает контур мягким. */}
      <path d="M8 9.4C8 6.4 6 4.4 2.4 4.4c0 3.1 2 5 5.6 5Z" fill="currentColor" stroke="currentColor" strokeWidth="0.9" />
      <path d="M8 7.6c0-3.3 1.9-5.4 5.8-5.4 0 3.3-2 5.4-5.8 5.4Z" fill="currentColor" stroke="currentColor" strokeWidth="0.9" />
      {/* Прожилки светлой линией. */}
      <path d="M7.4 8.7C6 7.2 4.6 6.4 3.2 5.9" stroke="var(--surface)" strokeWidth="0.8" opacity="0.7" />
      <path d="M8.6 6.9c1.3-1.2 2.7-2.1 4.4-2.6" stroke="var(--surface)" strokeWidth="0.8" opacity="0.7" />
    </svg>
  );
}

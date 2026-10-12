import type { StrangeMark } from '@contracts';
import { strangeMetaText, strangeText } from '../../entities/strange';
import { ru } from '../i18n/ru';
import styles from './StrangeBadge.module.css';
import { Tip } from './Tip';

/**
 * Круг с восклицательным знаком. Круг рисуется цветом `currentColor` (переменная опасности темы задаётся классом),
 * знак — цветом поверхности, поэтому значок читается и в светлой, и в тёмной, и в серой теме.
 */
function BangIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="7.5" fill="currentColor" />
      <path d="M8 4v4.6" stroke="var(--surface)" strokeWidth="1.8" strokeLinecap="round" fill="none" />
      <circle cx="8" cy="11.6" r="1.05" fill="var(--surface)" />
    </svg>
  );
}

/**
 * Красный значок «!» у человека с меткой «Странный человек». Без метки ничего не рисует.
 * Смысл не держится на цвете: у значка есть подпись для скринридера, а подсказка («кто и когда отметил, что заметили»)
 * появляется при наведении и при фокусе с клавиатуры.
 *
 * `interactive={false}` — для значка внутри кнопки (строка «Сегодня»): вложенный в кнопку фокусируемый элемент
 * недопустим, поэтому там подсказка — обычный `title`.
 */
export function StrangeBadge({
  mark,
  size = 16,
  interactive = true,
}: {
  mark: StrangeMark | null | undefined;
  size?: number;
  interactive?: boolean;
}) {
  if (!mark) return null;
  const text = strangeText(mark);
  if (!interactive) {
    return (
      <span role="img" aria-label={text} title={text} className={styles.badge}>
        <BangIcon size={size} />
      </span>
    );
  }
  return (
    <Tip text={text} inline>
      {() => (
        <span role="img" aria-label={text} tabIndex={0} className={styles.badge}>
          <BangIcon size={size} />
        </span>
      )}
    </Tip>
  );
}

/** Красная полоса сверху карточки: метка словами, кто и когда поставил, и заметка для коллег. */
export function StrangeBanner({ mark }: { mark: StrangeMark | null | undefined }) {
  if (!mark) return null;
  const note = mark.note?.trim();
  return (
    <div role="note" aria-label={ru.strange.title} className={styles.banner}>
      <span className={styles.bannerIcon}>
        <BangIcon size={20} />
      </span>
      <div className={styles.bannerBody}>
        <p className={styles.bannerTitle}>{ru.strange.title}</p>
        <p className={styles.bannerMeta}>{strangeMetaText(mark)}</p>
        {note && <p className={styles.bannerNote}>{note}</p>}
      </div>
    </div>
  );
}

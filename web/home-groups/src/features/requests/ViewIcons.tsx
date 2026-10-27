import type { RequestsView } from '../../entities/others';

/**
 * Значки вкладок над списком заявок — в том же стиле, что значки в шапке карточки (`ContactTools`): линия 1.8 на сетке
 * 24, цвет текста. Подписи на телефоне не помещались; полное название — в подсказке и для скринридера.
 */
const ICON = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false } as const;

export const VIEW_ICONS: Record<RequestsView, () => JSX.Element> = {
  // Хотят в группу: человек с плюсом.
  wait: () => (
    <svg {...ICON}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20a6 6 0 0112 0" />
      <path d="M19 8v6M16 11h6" />
    </svg>
  ),
  // Хотят открыть группу: флажок — начало новой группы.
  leads: () => (
    <svg {...ICON}>
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 4 2 4H5" />
    </svg>
  ),
  // Дают дом: дом.
  homes: () => (
    <svg {...ICON}>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v10h14V10" />
      <path d="M10 20v-5h4v5" />
    </svg>
  ),
  // Вопросы: знак вопроса в круге.
  questions: () => (
    <svg {...ICON}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 114 2c-1 .6-1.5 1.2-1.5 2.3" />
      <path d="M12 17h.01" />
    </svg>
  ),
  // Уже состоят: двое людей.
  members: () => (
    <svg {...ICON}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20a6 6 0 0112 0" />
      <path d="M16 4.5a3.5 3.5 0 010 7" />
      <path d="M18 14.5a6 6 0 013 5.5" />
    </svg>
  ),
  // Уже ведут: звезда.
  leaders: () => (
    <svg {...ICON}>
      <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />
    </svg>
  ),
  // Аннулированные заявки: перечёркнутый круг.
  cancelled: () => (
    <svg {...ICON}>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </svg>
  ),
};

import type { RequestTableFields } from '@contracts';
import { formatDateFull } from '../../entities/format';
import { ru } from '../../shared/i18n/ru';
import type { KvRow } from '../../shared/ui';

const t = ru.create.requestFields;

/**
 * Поля заявки из таблицы церкви для карточки: то, что вводят при создании и правке, должно быть видно и потом.
 * Пустое не показываем. Заметка и «Дополнительно» — отдельными строками, как в форме правки.
 * «Ходит в группу» — текст из таблицы; у утверждённой заявки группу уже показывает карточка, повторять её не нужно.
 */
export function tableRows(table: RequestTableFields, opts: { finalGroup: boolean }): KvRow[] {
  const recommended = [table.recommended, table.recommendedAt ? formatDateFull(table.recommendedAt) : null].filter(Boolean).join(' · ');
  return [
    ...(table.ministry ? [{ label: t.ministry, value: table.ministry }] : []),
    ...(recommended ? [{ label: t.recommended, value: recommended }] : []),
    ...(opts.finalGroup && table.finalGroup ? [{ label: t.finalGroup, value: table.finalGroup }] : []),
    ...(table.attendance ? [{ label: t.attendance, value: table.attendance }] : []),
    ...(table.note ? [{ label: ru.requests.note, value: table.note }] : []),
    ...(table.extra ? [{ label: t.extra, value: table.extra }] : []),
  ];
}

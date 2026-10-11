import type { ChatBody, ChatOk } from '@contracts';
import { ApiError } from '../shared/api/client';

/**
 * Ответы чата «Помощник» в режиме фикстур. Модели нет, поэтому ответ зависит только от последнего вопроса:
 * «перебор» даёт таблицу групп по районам, «ошибка» — отказ сервиса (для снимков ошибки), остальное — общий ответ.
 */
export function fixtureChatReply(body: unknown): ChatOk {
  const turns = (body as Partial<ChatBody> | undefined)?.messages ?? [];
  const question = [...turns].reverse().find((t) => t.role === 'user')?.content ?? '';

  if (/ошибка/i.test(question)) {
    throw new ApiError(503, 'Служба модели сейчас недоступна. Попробуйте через минуту.', 'unavailable');
  }

  if (/перебор/i.test(question)) {
    return {
      ok: true,
      answer: 'Больше всего групп в Приморском районе: 3 группы на 23 человека, и две из них почти заполнены. В остальных районах групп меньше.',
      queries: [
        {
          sql: 'select district, count(*) as groups, sum(people) as people from groups where archived_at is null group by district order by groups desc',
          ok: true,
          rows: 4,
        },
      ],
      tables: [
        {
          columns: ['Район', 'Групп', 'Человек', 'Мест всего'],
          rows: [
            ['Приморский', 3, 23, 36],
            ['Калининский', 2, 15, 26],
            ['Выборгский', 1, 6, 14],
            ['Невский', 1, 12, 12],
          ],
          truncated: false,
        },
      ],
    };
  }

  return {
    ok: true,
    answer: 'Нашлось пять групп, где свободных мест больше, чем людей. Это демонстрационный ответ: в рабочей версии он строится по запросам к базе.',
    queries: [
      { sql: 'select no, district, capacity - people as free from groups where capacity - people > people order by free desc limit 5', ok: true, rows: 3 },
    ],
    tables: [
      {
        columns: ['Группа', 'Район', 'Свободно мест'],
        rows: [
          [31, 'Выборгский', 8],
          [15, 'Калининский', 7],
          [19, 'Приморский', 8],
        ],
        truncated: false,
      },
    ],
  };
}

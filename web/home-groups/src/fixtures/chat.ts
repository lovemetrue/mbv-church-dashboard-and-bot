import type { ChatHistoryView, ChatOk, ChatTurn } from '@contracts';
import { ApiError } from '../shared/api/client';

/** Сколько сообщений сервер отдаёт при открытии чата. */
const VIEW_MESSAGES = 40;

/** Разговор, с которого начинается демо: чтобы в окне с первого раза была видна история с сервера. */
const START: readonly ChatTurn[] = [
  { role: 'user', content: 'Сколько в Приморском районе групп и людей в них?' },
  { role: 'assistant', content: 'В Приморском районе три группы, в них 23 человека. Две группы почти заполнены, в третьей есть свободные места.' },
];

/** Разговор демо-входа. Живёт, пока открыта страница: так «очистить» и новые вопросы видны при следующем открытии окна. */
let demoChat: ChatTurn[] = START.map((t) => ({ ...t }));

/** Для тестов: вернуть демо-разговор к исходному. */
export function resetDemoChat(): void {
  demoChat = START.map((t) => ({ ...t }));
}

/** `GET assistant/chat/history`: копия, чтобы правка ответа не меняла демо-разговор. */
export function fixtureChatHistory(): ChatHistoryView {
  return { messages: demoChat.map((t) => ({ ...t })) };
}

/** `POST assistant/chat/clear`: разговор пустеет. */
export function fixtureChatClear(): { ok: true } {
  demoChat = [];
  return { ok: true };
}

/**
 * Ответы чата «Помощник» в режиме фикстур. Модели нет, поэтому ответ зависит только от последнего вопроса:
 * «перебор» даёт таблицу групп по районам, «ошибка» — отказ сервиса (для снимков ошибки), остальное — общий ответ.
 * Как и сервер, успешный ответ дописывает вопрос и ответ в историю; отказ в историю не попадает.
 */
export function fixtureChatReply(body: unknown): ChatOk {
  const sent = body as { message?: string; messages?: { role: string; content: string }[] } | undefined;
  const question = sent?.message ?? [...(sent?.messages ?? [])].reverse().find((t) => t.role === 'user')?.content ?? '';
  const out = answerTo(question);
  const added: ChatTurn[] = [{ role: 'user', content: question }, { role: 'assistant', content: out.answer }];
  demoChat = [...demoChat, ...added].slice(-VIEW_MESSAGES);
  return out;
}

function answerTo(question: string): ChatOk {

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

import { esc } from './html.js';
import { formatPhone } from './phone.js';
import type { OutMessage } from './platform.js';

/**
 * Сообщения после «Утвердить» в «Домашних группах»: человеку — какую группу ему подобрали, ведущему — кого направили.
 * Чистые функции: текст и кнопки проверяются без базы и без платформы, а очередь (`placement_notices`) — отдельно.
 */

export type NoticeRecipient = 'person' | 'leader';
export type NoticeAnswer = 'will_call' | 'no_time' | 'waiting' | 'not_fit';

/** Какие ответы у кого: кнопку ведущего человек нажать не может, и наоборот — так проверяет и база. */
export const ANSWERS_OF: Readonly<Record<NoticeRecipient, readonly NoticeAnswer[]>> = {
  leader: ['will_call', 'no_time'],
  person: ['waiting', 'not_fit'],
};

const BUTTON_TEXT: Readonly<Record<NoticeAnswer, string>> = {
  will_call: 'Позвоню в течение 24 часов',
  no_time: 'Нет времени',
  waiting: 'Жду звонка',
  not_fit: 'Группа не подходит',
};

/** Ответ бота на нажатие. На «не подходит» и «нет времени» обещаем только то, что сделает координатор. */
export const ANSWER_REPLY: Readonly<Record<NoticeAnswer, string>> = {
  will_call: 'Спасибо! Отметили, что Вы позвоните.',
  no_time: 'Поняли, передали координатору. Спасибо, что ответили.',
  waiting: 'Спасибо! Ведущий скоро позвонит.',
  not_fit: 'Поняли, передали координатору: с Вами свяжутся и подберут другую группу.',
};

export const STALE_BUTTON = 'Эта кнопка уже не действует.';

/** Всплывающая подсказка на само нажатие: в MAX без текста подтверждение и не принимается. */
export const NOTICE_ACK = 'Ответ принят ✓';

/** Префикс данных кнопки. Короткий: у платформ лимит на длину payload. */
export const NOTICE_CB = 'pn';

export const noticeButtonData = (noticeId: number, answer: NoticeAnswer): string => `${NOTICE_CB}:${noticeId}:${answer}`;

/** Разбор нажатия. Чужое или испорченное — null: такой callback дальше идёт обычным путём. */
export function parseNoticeButton(data: string): { noticeId: number; answer: NoticeAnswer } | null {
  const m = /^pn:(\d{1,15}):(will_call|no_time|waiting|not_fit)$/.exec(data);
  return m ? { noticeId: Number(m[1]), answer: m[2] as NoticeAnswer } : null;
}

/** Данные для текста. Адреса здесь нет намеренно: его скажет ведущий по телефону. */
export interface NoticeData {
  id: number;
  recipient: NoticeRecipient;
  groupCode: string;
  leader: string;
  leaderPhone: string | null;
  /** День и время встреч как записаны в справочнике групп. */
  day: string | null;
  time: string | null;
  fio: string | null;
  personPhone: string | null;
  /** Удобные человеку день и время, как он их назвал (или как поправил координатор); null — не заполнено. */
  personSchedule: string | null;
}

const line = (label: string, value: string | null): string | null => (value ? `${label}: ${esc(value)}` : null);
const firstName = (fio: string | null): string | null => {
  // В ФИО первым идёт фамилия: «Иванова Мария Петровна» → «Мария». Одно слово — это и есть имя.
  const parts = (fio ?? '').trim().split(/\s+/).filter(Boolean);
  return parts.length >= 2 ? parts[1]! : (parts[0] ?? null);
};

export function noticeMessage(d: NoticeData): OutMessage {
  const when = [d.day, d.time].map((s) => s?.trim()).filter(Boolean).join(', ') || null;
  const buttons = ANSWERS_OF[d.recipient].map((a) => [{ kind: 'callback' as const, text: BUTTON_TEXT[a], data: noticeButtonData(d.id, a) }]);
  if (d.recipient === 'person') {
    const name = firstName(d.fio);
    const text = [
      `${name ? `${esc(name)}, здравствуйте!` : 'Здравствуйте!'} Мы подобрали для Вас домашнюю группу.`,
      '',
      line('Ведущий', d.leader),
      line('Телефон ведущего', formatPhone(d.leaderPhone) || null),
      line('Время встреч', when),
      '',
      'Ведущий позвонит Вам в ближайшие дни и расскажет, где проходит встреча.',
    ].filter((s) => s !== null).join('\n');
    return { text, format: 'html', buttons };
  }
  const text = [
    `${esc(firstName(d.leader) ?? d.leader)}, здравствуйте! В Вашу группу ${esc(d.groupCode)} направлен человек.`,
    '',
    line('Имя', d.fio),
    line('Телефон', formatPhone(d.personPhone) || null),
    line('Удобное время', d.personSchedule?.trim() || null),
    '',
    'Пожалуйста, позвоните в течение 24 часов и расскажите, где проходит встреча.',
  ].filter((s) => s !== null).join('\n');
  return { text, format: 'html', buttons };
}

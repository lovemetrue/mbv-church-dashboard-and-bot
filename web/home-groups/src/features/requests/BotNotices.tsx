import type { BotNotice } from '@contracts';
import { formatDateShort } from '../../entities/format';
import { ru } from '../../shared/i18n/ru';
import { noticeNeedsAttention } from './model';
import styles from './Requests.module.css';

const b = ru.requests.bot;

/**
 * Дошли ли сообщения в MAX после «Утвердить» и что нажали. Требующее внимания — красным. Один и тот же блок — в карточке
 * заявки и у заявки в карточке человека («Люди»): отметки ищут и там, и там. В заголовке — группа, о которой было
 * сообщение: у заявки, которую человек вернул кнопкой «Группа не подходит», группы в самой заявке уже нет.
 */
export function BotNotices({ notices, compact = false }: { notices: readonly BotNotice[]; compact?: boolean }) {
  const code = notices.find((n) => n.groupCode)?.groupCode;
  return (
    <div className={styles.botNotices}>
      {!compact && <h4 className={styles.h4}>{code ? b.titleFor(code) : b.title}</h4>}
      <ul>
        {notices.map((n) => {
          const status = n.status === 'failed' && n.error && b.error[n.error] ? `${b.status.failed} (${b.error[n.error]})` : b.status[n.status];
          const answer = n.status === 'sent' ? (n.answer ? b.answer[n.answer] : b.noAnswer) : null;
          return (
            <li key={n.recipient} className={noticeNeedsAttention(n) ? styles.botAttention : undefined}>
              <b>{compact && code ? `MAX ${b.whoShort[n.recipient]} (${code})` : b.who[n.recipient]}:</b> {status}
              {answer && ` · ${answer}`}
              {n.answeredAt && <span className={styles.note}> · {formatDateShort(n.answeredAt)}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

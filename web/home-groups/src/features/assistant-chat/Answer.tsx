import { useEffect, useRef, useState } from 'react';
import type { ChatQuery, ChatTable } from '@contracts';
import { plural } from '../../entities/plural';
import { ru } from '../../shared/i18n/ru';
import { Button, TableScroll } from '../../shared/ui';
import { copyText } from '../requests/work/clipboard';
import { answerCopyText, cellText } from './model';
import styles from './Chat.module.css';

const t = ru.chat;

function AnswerTable({ table, label }: { table: ChatTable; label: string }) {
  return (
    <div className={styles.tableBox}>
      <TableScroll label={label}>
        <table className={styles.table}>
          <thead>
            <tr>
              {table.columns.map((c, i) => (
                <th key={i} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.length === 0 ? (
              <tr>
                <td colSpan={Math.max(table.columns.length, 1)} className={styles.empty}>
                  {t.noRows}
                </td>
              </tr>
            ) : (
              table.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>{cellText(cell)}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </TableScroll>
      {table.truncated && <p className={styles.note}>{t.truncated}</p>}
    </div>
  );
}

function QueryItem({ q }: { q: ChatQuery }) {
  return (
    <li className={q.ok ? styles.query : `${styles.query} ${styles.queryFailed}`}>
      <code className={styles.sql}>{q.sql}</code>
      <span className={styles.queryResult}>
        {q.ok ? plural(q.rows, t.queryRowForms) : q.error ? t.queryFailed(q.error) : t.queryFailedNoText}
      </span>
    </li>
  );
}

/** «Скопировать ответ»: подтверждение живёт две секунды, потом кнопка прежняя. Таймер гасим при уходе, чтобы не трогать снятый компонент. */
function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function copy() {
    const ok = await copyText(text);
    setState(ok ? 'done' : 'failed');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2000);
  }

  return (
    <span aria-live="polite">
      <Button size="sm" variant="ghost" onClick={() => void copy()}>
        {state === 'done' ? t.copied : state === 'failed' ? t.copyFailed : t.copy}
      </Button>
    </span>
  );
}

/**
 * Ответ помощника: текст модели, под ним точные строки из базы (цифры можно перепроверить, а не верить пересказу),
 * свёрнутое «Как посмотрел» и копирование. Имена здесь настоящие: подставил сервер, модель их не видела.
 */
export function Answer({ answer, queries, tables }: { answer: string; queries: ChatQuery[]; tables: ChatTable[] }) {
  return (
    <>
      <p className={styles.text}>{answer}</p>
      {tables.map((table, i) => (
        <AnswerTable key={i} table={table} label={t.tableLabel(i + 1, tables.length)} />
      ))}
      {queries.length > 0 && (
        <details className={styles.how}>
          <summary>{t.howTitle}</summary>
          <ol className={styles.queries}>
            {queries.map((q, i) => (
              <QueryItem key={i} q={q} />
            ))}
          </ol>
        </details>
      )}
      <div className={styles.answerActions}>
        <CopyButton text={answerCopyText(answer, tables)} />
      </div>
    </>
  );
}

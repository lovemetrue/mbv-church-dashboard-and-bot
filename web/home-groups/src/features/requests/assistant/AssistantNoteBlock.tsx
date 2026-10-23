import { useEffect, useId, useRef, useState } from 'react';
import type { AssistantNote } from '@contracts';
import { ru } from '../../../shared/i18n/ru';
import { Button, DrawerSection } from '../../../shared/ui';
import styles from '../Requests.module.css';
import { copyText } from '../work/clipboard';

const a = ru.requests.assistant;

/** Через сколько убрать «Скопировано»: подтверждение нужно на мгновение. */
const COPIED_MS = 4000;

/** Есть ли что показать в карточке: определённые поля, вопросы или пояснение. Пустой разбор блока не заслуживает. */
export const hasAssistantNote = (note: AssistantNote | null): note is AssistantNote =>
  note !== null && (note.filled.length > 0 || note.questions.length > 0 || note.note !== null);

/**
 * Блок «Помощник» в карточке заявки: что он определил вместо скрипта (с обязательным «проверьте» — это догадка модели,
 * а не слова человека) и вопросы, которые стоит задать в разговоре. Группу помощник не выбирает, поэтому её здесь нет.
 */
export function AssistantNoteBlock({ note }: { note: AssistantNote | null }) {
  const headId = useId();
  const listId = useId();
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  if (!hasAssistantNote(note)) return null;

  const copy = async () => {
    const done = await copyText(note.questions.join('\n'));
    setMessage(done ? a.copied : a.copyFailed);
    if (timer.current) clearTimeout(timer.current);
    // Неудачу не убираем сама: её надо прочитать и сделать руками.
    timer.current = done ? setTimeout(() => setMessage(''), COPIED_MS) : null;
  };

  return (
    <DrawerSection title={<span id={headId}>{a.title}</span>}>
      <div role="region" aria-labelledby={headId} className={styles.assistantBlock}>
        {note.filled.length > 0 && (
          <p className={styles.assistantFilled}>
            {a.filledPrefix}
            {note.filled.join(', ')} — <b className={styles.assistantCheck}>{a.check}</b>
          </p>
        )}
        {/* Пояснение помощника: почему он чего-то не определил. Без него пустой разбор выглядел бы как поломка. */}
        {note.note && <p className={styles.assistantNoteText}>{note.note}</p>}
        {note.questions.length > 0 && (
          <>
            <h4 id={listId} className={styles.h4}>
              {a.questionsTitle}
            </h4>
            <ul aria-labelledby={listId} className={styles.assistantQuestions}>
              {note.questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
            <div className={styles.assistantCopy}>
              <Button onClick={() => void copy()}>{a.copy}</Button>
              {/* Живая область есть всегда: скринридер объявляет только текст, появившийся в уже существующей области. */}
              <span aria-live="polite" className={styles.note}>
                {message}
              </span>
            </div>
          </>
        )}
      </div>
    </DrawerSection>
  );
}

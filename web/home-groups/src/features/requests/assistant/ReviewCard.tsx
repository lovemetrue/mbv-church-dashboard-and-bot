import { useId, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AssistantReviewItem, FormMeta, RequestEditBody } from '@contracts';
import { ApiError, apiPost } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queries';
import { serverText } from '../../../shared/api/serverText';
import { ru } from '../../../shared/i18n/ru';
import { Button } from '../../../shared/ui';
import { useFormMeta } from '../../create/useFormMeta';
import { copyText } from '../work/clipboard';
import styles from './Review.module.css';

const a = ru.requests.assistant;

/** Что человек написал по каждому параметру: показываем рядом с тем, чего помощник не понял. */
const wroteOf = (item: AssistantReviewItem, field: AssistantReviewItem['missing'][number]): string | null =>
  field === 'район' ? item.place : field === 'возраст' ? item.age : item.schedule;

/**
 * Заявка, где помощнику не хватило данных: чего он не понял, его пояснение почему, слова человека, вопросы для
 * разговора и короткая форма «узнали ответ — впишите в заявку». Форма пишет туда же, куда правка заявки в карточке,
 * поэтому после записи подбор и разбор пересчитываются сами, а заявка уходит из этого списка.
 */
export function ReviewCard({ item, onSaved, onOpen }: {
  item: AssistantReviewItem;
  onSaved: (fio: string) => void;
  onOpen: (id: number) => void;
}) {
  const titleId = useId();
  const [copied, setCopied] = useState('');
  return (
    <article className={styles.card} aria-labelledby={titleId}>
      <h4 id={titleId} className={styles.cardTitle}>
        <button type="button" className={styles.fio} aria-label={a.openRequest(item.fio)} onClick={() => onOpen(item.requestId)}>
          {item.fio}
        </button>
      </h4>
      <p className={styles.missing}>{a.missing(item.missing)}</p>
      <ul className={styles.wrote}>
        {item.missing.map((f) => {
          const text = wroteOf(item, f);
          return text ? (
            <li key={f}>
              {a.wrote[f]}: «{text}»
            </li>
          ) : null;
        })}
      </ul>
      <p className={item.note ? styles.note : styles.noNote}>{item.note ?? a.noNote}</p>
      {item.filled.length > 0 && (
        <p className={styles.filled}>
          {ru.requests.assistant.filledPrefix}
          {item.filled.join(', ')} — <b>{ru.requests.assistant.check}</b>
        </p>
      )}
      {item.questions.length > 0 && (
        <div className={styles.questions}>
          <p className={styles.label}>{a.questionsTitle}</p>
          <ul>
            {item.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
          <div className={styles.row}>
            <Button
              size="sm"
              onClick={() => void copyText(item.questions.join('\n')).then((ok) => setCopied(ok ? a.copied : a.copyFailed))}
            >
              {a.copy}
            </Button>
            <span aria-live="polite" className={styles.hint}>
              {copied}
            </span>
          </div>
        </div>
      )}
      <AnswerForm item={item} onSaved={onSaved} />
    </article>
  );
}

/** «Узнали ответ — впишите в заявку»: поля только для того, чего не хватает. Справочники — те же, что у форм «Создать». */
function AnswerForm({ item, onSaved }: { item: AssistantReviewItem; onSaved: (fio: string) => void }) {
  const meta = useFormMeta();
  const queryClient = useQueryClient();
  const [district, setDistrict] = useState('');
  const [age, setAge] = useState('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { district: useId(), age: useId(), time: useId(), error: useId() };
  const need = (f: AssistantReviewItem['missing'][number]) => item.missing.includes(f);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    const body = editBody(item, { district, age, time });
    if (!body) {
      setError(a.answerEmpty);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`requests/${item.requestId}/edit`, body);
      onSaved(item.fio);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.requests }),
        queryClient.invalidateQueries({ queryKey: queryKeys.today }),
      ]);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 0 ? a.answerNetwork : serverText(err, { network: a.answerNetwork, fallback: a.answerFailed }));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const lists: FormMeta | undefined = meta.data;
  return (
    <form className={styles.answer} onSubmit={(e) => void submit(e)} aria-describedby={error ? ids.error : undefined}>
      <p className={styles.label}>{a.answerTitle}</p>
      {need('район') && (
        <label className={styles.field} htmlFor={ids.district}>
          <span>{a.answerDistrict}</span>
          <select id={ids.district} value={district} onChange={(e) => setDistrict(e.target.value)} disabled={busy || !lists}>
            <option value="">{a.answerChoose}</option>
            {(lists?.districts ?? []).filter((d) => d !== 'Не указан').map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
      )}
      {need('возраст') && (
        <label className={styles.field} htmlFor={ids.age}>
          <span>{a.answerAge}</span>
          <select id={ids.age} value={age} onChange={(e) => setAge(e.target.value)} disabled={busy || !lists}>
            <option value="">{a.answerChoose}</option>
            {(lists?.ageGroups ?? []).map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </label>
      )}
      {need('время') && (
        <label className={styles.field} htmlFor={ids.time}>
          <span>{a.answerTime}</span>
          <input
            id={ids.time}
            value={time}
            maxLength={200}
            placeholder={a.answerTimePlaceholder}
            onChange={(e) => setTime(e.target.value)}
            disabled={busy}
          />
        </label>
      )}
      {error && (
        <p id={ids.error} role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.row}>
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? a.answerSaving : a.answerSave}
        </Button>
      </div>
    </form>
  );
}

/**
 * Правка заявки по ответу человека. Район ставится в начало места, а слова человека сохраняются в скобках: по
 * ним координатор потом поймёт, откуда район, а скрипт подбора находит район по названию в начале.
 */
export function editBody(item: AssistantReviewItem, answer: { district: string; age: string; time: string }): RequestEditBody | null {
  const body: RequestEditBody = {};
  if (answer.district) body.place = item.place ? `${answer.district} (${item.place})` : answer.district;
  if (answer.age) body.age = answer.age;
  if (answer.time.trim()) body.schedule = answer.time.trim();
  return Object.keys(body).length > 0 ? body : null;
}

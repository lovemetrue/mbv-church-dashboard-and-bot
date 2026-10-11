import { useEffect, useId, useRef, useState } from 'react';
import { ru } from '../../../shared/i18n/ru';
import { Button } from '../../../shared/ui';
import { copyText } from './clipboard';
import { dialNumber } from './phone';
import type { WorkSubject } from './subject';
import styles from './work.module.css';

const w = ru.requests.work;

/** Через сколько убрать «Скопировано»: подтверждение нужно на мгновение, а не навсегда. */
const COPIED_MS = 4000;

/**
 * «Позвонить», «Написать», «Скопировать номер». Ссылки `tel:` и `sms:` открывают приложение
 * телефона на мобильном и ничего не делают на компьютере, поэтому рядом всегда есть копирование.
 * Номер нигде не записывается и в адресную строку не попадает.
 */
export function ContactLinks({ r, editable }: { r: WorkSubject; editable: boolean }) {
  const headId = useId();
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dial = dialNumber(r.phone);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    if (!dial) return;
    const done = await copyText(dial);
    setMessage(done ? w.copied : w.copyFailed);
    if (timer.current) clearTimeout(timer.current);
    // Неудачу не убираем сама: её надо прочитать и сделать руками.
    timer.current = done ? setTimeout(() => setMessage(''), COPIED_MS) : null;
  };

  return (
    <section className={styles.block} aria-labelledby={headId}>
      <h4 id={headId} className={styles.h4}>
        {w.contactTitle}
      </h4>
      {dial ? (
        <div className={styles.row}>
          <a className={styles.linkBtn} href={`tel:${dial}`}>
            {w.call}
          </a>
          <a className={styles.linkBtn} href={`sms:${dial}`}>
            {w.sms}
          </a>
          <Button onClick={() => void copy()}>{w.copy}</Button>
        </div>
      ) : (
        <p className={styles.hint}>{editable ? w.noPhone : w.noPhoneClosed}</p>
      )}
      {/* Живая область есть всегда: скринридер объявляет только текст, появившийся в уже существующей области.
          Роль status не ставим: пустая область мешала бы находить настоящие статусы карточки. */}
      <p className={message === w.copied ? styles.copied : styles.copyFailed} aria-live="polite" aria-atomic="true">
        {message}
      </p>
    </section>
  );
}

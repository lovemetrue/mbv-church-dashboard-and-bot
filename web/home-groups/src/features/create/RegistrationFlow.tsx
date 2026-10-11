import { useMemo, useState, type ReactNode } from 'react';
import type { FormMeta } from '@contracts';
import { registrationCardUrl, registrationQrUrl } from '../../shared/api/base';
import { ru } from '../../shared/i18n/ru';
import { Button } from '../../shared/ui';
import styles from './Create.module.css';
import { LinkButton } from './LinkButton';
import { RecordForm, type CreatedRecord } from './RecordForm';
import { registrationSpec } from './specs';

interface Registered {
  id: number;
  registrationNo: number;
}

/**
 * Регистрация участника: форма, затем номер с QR и «Зарегистрировать ещё». Одна и та же в окне приложения и на
 * отдельной странице `/registration`, поэтому лежит отдельно от обоих. `onClose` есть только у окна: на
 * странице нет ни «Отмены», ни «Готово», человек просто берёт следующего.
 */
export function RegistrationFlow({
  meta,
  onClose,
  onBusyChange,
  footnote,
}: {
  meta: FormMeta;
  onClose?: () => void;
  onBusyChange?: (busy: boolean) => void;
  /** Строка внизу и формы, и результата. */
  footnote?: ReactNode;
}) {
  const spec = useMemo(() => registrationSpec(meta), [meta]);
  const [done, setDone] = useState<Registered | null>(null);
  // Новый ключ пересоздаёт форму целиком: проще и надёжнее, чем обнулять каждое поле и ошибки.
  const [round, setRound] = useState(0);

  const registered = (c: CreatedRecord) => {
    // Номер приходит всегда; без него карточку нечем подписать, поэтому такой ответ считаем сбоем сервера.
    if (c.registrationNo === undefined) return;
    setDone({ id: c.id, registrationNo: c.registrationNo });
  };

  if (done) {
    return (
      <RegistrationDone
        done={done}
        onAnother={() => {
          setDone(null);
          setRound((r) => r + 1);
        }}
        onClose={onClose}
        footnote={footnote}
      />
    );
  }
  return (
    <RecordForm
      key={round}
      spec={spec}
      path="people/create"
      submitLabel={ru.create.registration.submit}
      busyLabel={ru.create.registration.submitting}
      onClose={onClose}
      onCreated={registered}
      onBusyChange={onBusyChange}
      footnote={footnote}
    />
  );
}

function RegistrationDone({
  done,
  onAnother,
  onClose,
  footnote,
}: {
  done: Registered;
  onAnother: () => void;
  onClose?: () => void;
  footnote?: ReactNode;
}) {
  const r = ru.create.registration;
  const [qrFailed, setQrFailed] = useState(false);
  return (
    <div className={styles.done}>
      <p className={styles.doneText} role="status">
        <span className={styles.doneTitle}>{r.doneTitle}</span> <span>{r.doneNumber(done.registrationNo)}</span>
      </p>
      {qrFailed ? (
        <p className={styles.hint}>{r.qrFailed}</p>
      ) : (
        <img
          className={styles.qr}
          src={registrationQrUrl(done.id)}
          alt={r.qrAlt(done.registrationNo)}
          width={200}
          height={200}
          onError={() => setQrFailed(true)}
        />
      )}
      <div className={styles.doneActions}>
        <LinkButton href={registrationCardUrl(done.id)} variant="primary">
          {r.printCard}
        </LinkButton>
        <Button onClick={onAnother}>{r.another}</Button>
        {onClose && <Button onClick={onClose}>{r.done}</Button>}
      </div>
      {footnote}
    </div>
  );
}

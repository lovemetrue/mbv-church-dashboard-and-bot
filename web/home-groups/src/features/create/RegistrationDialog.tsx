import { useMemo, useRef, useState } from 'react';
import type { FormMeta } from '@contracts';
import { registrationCardUrl, registrationQrUrl } from '../../shared/api/base';
import { ru } from '../../shared/i18n/ru';
import { Button } from '../../shared/ui';
import styles from './Create.module.css';
import { FormMetaGate } from './FormMetaGate';
import { LinkButton } from './LinkButton';
import { RecordForm, type CreatedRecord } from './RecordForm';
import { registrationSpec } from './specs';

interface Registered {
  id: number;
  registrationNo: number;
}

/**
 * Окно «Регистрация участника». Успех не закрывает окно: служителю сразу нужны номер, QR и печать
 * карточки, а за следующим участником он вернётся к чистой форме («Зарегистрировать ещё»).
 *
 * Пока запрос идёт, окно не закрывается (Esc, ✕, клик мимо): ответ пришёл бы в уже убранное окно, и номер
 * зарегистрированного человека остался бы неизвестным, а повторная регистрация создала бы дубль.
 */
export function RegistrationDialog({ onClose }: { onClose: () => void }) {
  const busy = useRef(false);
  const close = () => {
    if (!busy.current) onClose();
  };
  return (
    <FormMetaGate title={ru.create.registration.title} onClose={close}>
      {(meta) => <RegistrationBody meta={meta} onClose={close} onBusyChange={(b) => (busy.current = b)} />}
    </FormMetaGate>
  );
}

function RegistrationBody({ meta, onClose, onBusyChange }: { meta: FormMeta; onClose: () => void; onBusyChange: (busy: boolean) => void }) {
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
    />
  );
}

function RegistrationDone({ done, onAnother, onClose }: { done: Registered; onAnother: () => void; onClose: () => void }) {
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
        <Button onClick={onClose}>{r.done}</Button>
      </div>
    </div>
  );
}

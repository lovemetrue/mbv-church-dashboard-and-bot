import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ContactEditDialog } from '../../contact';
import { ru } from '../../../shared/i18n/ru';
import { useAppNav } from '../../../shared/nav';
import { copyText } from './clipboard';
import { dialNumber } from './phone';
import { isOpenSubject } from './WorkPlace';
import type { WorkSubject } from './subject';
import styles from './work.module.css';

const w = ru.requests.work;
const c = ru.contact;

/** Через сколько убрать «Скопировано»: подтверждение нужно на мгновение, а не навсегда. */
const COPIED_MS = 4000;

const ICON = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
const Pencil = () => (
  <svg {...ICON}>
    <path d="M4 20l4.2-1 10-10a2.1 2.1 0 00-3-3l-10 10L4 20z" />
    <path d="M13.5 7.5l3 3" />
  </svg>
);
const Phone = () => (
  <svg {...ICON}>
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" />
  </svg>
);
const Letter = () => (
  <svg {...ICON}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 7l9 6 9-6" />
  </svg>
);
const Copy = () => (
  <svg {...ICON}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" />
  </svg>
);
const ArrowOut = () => (
  <svg {...ICON}>
    <path d="M14 4h6v6" />
    <path d="M20 4l-9 9" />
    <path d="M18 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h4" />
  </svg>
);

function IconLink({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return (
    <a className={styles.iconBtn} href={href} aria-label={label} title={label}>
      {children}
    </a>
  );
}
function IconButton({ label, onClick, children, disabled }: { label: string; onClick?: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" className={styles.iconBtn} aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * Значки в шапке карточки заявки: правка данных (карандаш), звонок, письмо, копирование номера и переход в выбранную
 * группу. Ссылки `tel:` и `sms:` открывают приложение, которое на устройстве назначено для звонков и сообщений (у
 * координаторов это MAX); на компьютере, где такого приложения нет, выручает копирование номера. Номер нигде не
 * записывается и в адресную строку не попадает.
 */
export function HeaderTools({ subject, group }: { subject: WorkSubject; group?: { id: number; code: string } | null }) {
  const nav = useAppNav();
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dial = dialNumber(subject.phone);

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
    <>
      {isOpenSubject(subject) && (
        <IconButton label={c.editAria(subject.fio)} onClick={() => setEditing(true)}>
          <Pencil />
        </IconButton>
      )}
      {dial ? (
        <>
          <IconLink href={`tel:${dial}`} label={c.callAria(subject.fio)}>
            <Phone />
          </IconLink>
          <IconLink href={`sms:${dial}`} label={c.writeAria(subject.fio)}>
            <Letter />
          </IconLink>
          <IconButton label={c.copyAria} onClick={() => void copy()}>
            <Copy />
          </IconButton>
        </>
      ) : (
        <span className={styles.noPhone}>{isOpenSubject(subject) ? w.noPhone : w.noPhoneClosed}</span>
      )}
      {group && (
        <IconButton label={c.openGroup(group.code)} onClick={() => nav.openGroup(group.id)}>
          <ArrowOut />
        </IconButton>
      )}
      {/* Живая область есть всегда: скринридер объявляет только текст, появившийся в уже существующей области. */}
      <span className={message === w.copied ? styles.copied : styles.copyFailed} aria-live="polite" aria-atomic="true">
        {message}
      </span>
      {editing && (
        <ContactEditDialog
          title={c.editTitle(subject.fio)}
          values={subject}
          path={`requests/${subject.id}/edit`}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      )}
    </>
  );
}

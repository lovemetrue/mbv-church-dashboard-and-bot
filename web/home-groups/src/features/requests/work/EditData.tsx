import { useId, useState, type FormEvent } from 'react';
import type { RequestEditBody } from '@contracts';
import { ru } from '../../../shared/i18n/ru';
import { Button } from '../../../shared/ui';
import type { WorkSubject } from './subject';
import styles from './work.module.css';
import { WorkNoticeLine } from './WorkNotice';
import type { RequestWorkState } from './useRequestWork';

const w = ru.requests.work;

type Key = 'fio' | 'phone' | 'age' | 'place' | 'address' | 'schedule' | 'note';
type Values = Record<Key, string>;

const FIELD_NAME: Record<Key, string> = {
  fio: w.fieldFio,
  phone: w.fieldPhone,
  age: w.fieldAge,
  place: w.fieldPlace,
  address: w.fieldAddress,
  schedule: w.fieldSchedule,
  note: w.fieldNote,
};
const ORDER: Key[] = ['fio', 'phone', 'age', 'place', 'address', 'schedule', 'note'];

/** Что подставляем в поля. Сравниваем с тем же: показанное и есть исходное, иначе непротронутое поле считалось бы изменённым. */
function initialValues(r: WorkSubject): Values {
  return {
    fio: r.fio,
    phone: r.phone ?? '',
    age: r.ageLabel ?? '',
    place: r.place ?? '',
    address: r.address ?? '',
    schedule: r.schedule ?? '',
    note: r.note ?? '',
  };
}

function EditForm({ r, work, onClose }: { r: WorkSubject; work: RequestWorkState; onClose: () => void }) {
  const base = useId();
  const [initial] = useState(() => initialValues(r));
  const [values, setValues] = useState<Values>(initial);
  const trimmed = (k: Key) => values[k].trim();
  const changed = ORDER.filter((k) => trimmed(k) !== initial[k].trim());
  const fioEmpty = trimmed('fio') === '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (changed.length === 0 || fioEmpty) return;
    // Только изменённое: незатронутое поле сервер не трогает. Очищенное необязательное — null.
    const body: RequestEditBody = {};
    for (const k of changed) {
      if (k === 'fio') body.fio = trimmed(k);
      else body[k] = trimmed(k) || null;
    }
    if (await work.edit(body, changed.map((k) => FIELD_NAME[k]))) onClose();
  };

  const set = (k: Key, v: string) => setValues((cur) => ({ ...cur, [k]: v }));
  const field = (k: Key, label: string, extra: { placeholder?: string; type?: string; inputMode?: 'tel' } = {}) => (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={`${base}-${k}`}>
        {label}
      </label>
      <input
        id={`${base}-${k}`}
        className={styles.input}
        type={extra.type ?? 'text'}
        inputMode={extra.inputMode}
        autoComplete="off"
        placeholder={extra.placeholder}
        value={values[k]}
        disabled={work.pending}
        autoFocus={k === 'fio'}
        onChange={(e) => set(k, e.target.value)}
      />
    </div>
  );

  return (
    <form className={styles.form} aria-label={w.editFormLabel} onSubmit={(e) => void submit(e)} noValidate>
      {field('fio', w.editFio)}
      {fioEmpty && <p className={styles.hintError}>{w.editFioEmpty}</p>}
      {field('phone', w.editPhone, { type: 'tel', inputMode: 'tel', placeholder: w.editPhonePlaceholder })}
      {field('age', w.editAge, { placeholder: w.editAgePlaceholder })}
      {field('place', w.editPlace, { placeholder: w.editPlacePlaceholder })}
      {field('address', w.editAddress, { placeholder: w.editAddressPlaceholder })}
      {field('schedule', w.editSchedule, { placeholder: w.editSchedulePlaceholder })}
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${base}-note`}>
          {w.editNote}
        </label>
        <textarea
          id={`${base}-note`}
          className={styles.textarea}
          rows={3}
          value={values.note}
          disabled={work.pending}
          onChange={(e) => set('note', e.target.value)}
        />
      </div>
      <p className={styles.hint}>{w.editHint}</p>
      <WorkNoticeLine notice={work.notice} block="edit" />
      <div className={styles.row}>
        <Button type="submit" variant="primary" disabled={work.pending || changed.length === 0 || fioEmpty}>
          {work.pending ? w.editSaving : w.editSave}
        </Button>
        <Button disabled={work.pending} onClick={onClose}>
          {w.editCancel}
        </Button>
      </div>
    </form>
  );
}

/** «Править данные»: форма открывается по кнопке и каждый раз заполняется свежими данными заявки. */
export function EditData({ r, work }: { r: WorkSubject; work: RequestWorkState }) {
  const headId = useId();
  const [open, setOpen] = useState(false);
  return (
    <section className={styles.block} aria-labelledby={headId}>
      <h4 id={headId} className={styles.h4}>
        {w.editTitle}
      </h4>
      {open ? (
        <EditForm
          r={r}
          work={work}
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : (
        <>
          <Button
            aria-expanded={false}
            onClick={() => {
              work.clearNotice();
              setOpen(true);
            }}
          >
            {w.editOpen}
          </Button>
          <WorkNoticeLine notice={work.notice} block="edit" />
        </>
      )}
    </section>
  );
}

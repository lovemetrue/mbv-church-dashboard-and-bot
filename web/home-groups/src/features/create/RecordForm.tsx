import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ru } from '../../shared/i18n/ru';
import { splitList, toggleInList } from '../../shared/multiValue';
import { Button } from '../../shared/ui';
import styles from './Create.module.css';
import type { FieldSpec, FormSpec } from './specs';
import { useCreateRecord, type CreatePath } from './useCreateRecord';

/** Что вернул сервер: у регистрации участника есть ещё номер регистрации. */
export interface CreatedRecord {
  id: number;
  registrationNo?: number;
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

interface RecordFormProps {
  spec: FormSpec;
  path: CreatePath;
  submitLabel: string;
  /** Подпись кнопки, пока идёт запрос; по умолчанию «Создаём…». */
  busyLabel?: string;
  /** Закрыть окно с формой. Без него (форма на отдельной странице) кнопки «Отмена» нет: закрывать нечего. */
  onClose?: () => void;
  /** Запись создана: тот, кто открыл окно, закрывает его и показывает подтверждение. */
  onCreated: (created: CreatedRecord) => void;
  /** Идёт ли отправка: окно с формой по этому признаку не даёт себя закрыть, не дождавшись ответа. */
  onBusyChange?: (busy: boolean) => void;
  /** Строка над кнопками (например, адрес отдельной страницы регистрации). */
  footnote?: ReactNode;
}

/**
 * Форма создания записи: одна на заявку, группу и регистрацию участника, различаются описанием полей.
 * Поле с `showWhen` рисуется, проверяется и отправляется, только пока оно видно.
 * На месте проверяется лишь то, что обязательное поле не пусто; всё остальное решает сервер, и его
 * отказ показывается над кнопками, не стирая набранного.
 * Пустые поля не отправляются: сервер читает «нет поля» и «пусто» одинаково, а тело остаётся короче.
 */
export function RecordForm({ spec, path, submitLabel, busyLabel, onClose, onCreated, onBusyChange, footnote }: RecordFormProps) {
  const uid = useId();
  const { submit, busy } = useCreateRecord(path);
  const [values, setValues] = useState<Record<string, string>>(spec.initial);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const refs = useRef<Record<string, Control | null>>({});

  // Видимые поля пересчитываются от введённого: ветвление (`showWhen`) зависит от соседних полей.
  const isShown = (f: FieldSpec) => !f.showWhen || f.showWhen(values);
  const shownFields = spec.fields.filter(isShown);
  const all = [...shownFields, ...(spec.address ? [spec.address] : [])];

  const busyChange = useRef(onBusyChange);
  busyChange.current = onBusyChange;
  useEffect(() => {
    busyChange.current?.(busy);
  }, [busy]);

  const change = (name: string, value: string, fills?: Record<string, string>) => {
    setValues((v) => ({ ...v, ...fills, [name]: value }));
    setServerError(null);
    setProblems((p) => (p[name] ? { ...p, [name]: '' } : p));
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next: Record<string, string> = {};
    for (const f of all) {
      if (f.required && !(values[f.name] ?? '').trim()) {
        next[f.name] = f.kind === 'select' ? ru.create.requiredChoose(f.label) : ru.create.required(f.label);
      }
    }
    setProblems(next);
    const first = all.find((f) => next[f.name]);
    if (first) {
      refs.current[first.name]?.focus();
      return;
    }
    const fields: Record<string, string> = {};
    for (const f of all) {
      // Поле-подсказка только заполняет соседние: серверу его значение ни к чему.
      if (f.fills) continue;
      const v = (values[f.name] ?? '').trim();
      if (v) fields[f.name] = v;
    }
    setServerError(null);
    const result = await submit(fields);
    // Окно могли закрыть, пока шёл запрос: запись всё равно создана, подтверждение показывает родитель.
    if (result === null) return;
    if (result.ok) onCreated({ id: result.id, registrationNo: result.registrationNo });
    else setServerError(result.message);
  }

  const renderField = (f: FieldSpec, hintId?: string) => {
    const id = `${uid}-${f.name}`;
    const errId = `${id}-err`;
    const problem = problems[f.name];
    const common = {
      id,
      className: `${styles.control} ${problem ? styles.invalid : ''}`,
      value: values[f.name] ?? '',
      'aria-required': f.required ? (true as const) : undefined,
      'aria-invalid': problem ? (true as const) : undefined,
      'aria-describedby': [problem ? errId : null, hintId ?? null].filter(Boolean).join(' ') || undefined,
    };
    const setRef = (el: Control | null) => {
      refs.current[f.name] = el;
    };

    if (f.kind === 'checkbox') {
      return (
        <div key={f.name} className={styles.fieldWide}>
          <label className={styles.check} htmlFor={id}>
            <input
              id={id}
              ref={setRef}
              type="checkbox"
              checked={Boolean(values[f.name])}
              onChange={(e) => change(f.name, e.target.checked ? '1' : '')}
            />
            <span>{f.label}</span>
          </label>
        </div>
      );
    }

    if (f.kind === 'multi') {
      const value = values[f.name] ?? '';
      const picked = new Set(splitList(value));
      const options = (f.options ?? []).map((o) => o.value);
      return (
        <fieldset key={f.name} className={`${f.wide ? styles.fieldWide : styles.field} ${styles.multi}`}>
          <legend>{f.label}</legend>
          <div className={styles.multiList}>
            {(f.options ?? []).map((o) => (
              <label key={o.value} className={styles.check}>
                <input
                  type="checkbox"
                  checked={picked.has(o.value)}
                  onChange={(e) => change(f.name, toggleInList(value, o.value, e.target.checked, options))}
                />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      );
    }

    return (
      <div key={f.name} className={f.wide ? styles.fieldWide : styles.field}>
        <label htmlFor={id} className={f.required ? styles.required : undefined}>
          {f.label}
        </label>
        {f.kind === 'select' ? (
          <select {...common} ref={setRef} onChange={(e) => change(f.name, e.target.value, f.fills?.(e.target.value))}>
            <option value="">{f.emptyLabel ?? (f.required ? ru.create.choose : ru.create.notChosen)}</option>
            {(f.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : f.kind === 'textarea' ? (
          <textarea {...common} ref={setRef} rows={3} onChange={(e) => change(f.name, e.target.value)} />
        ) : (
          <input
            {...common}
            ref={setRef}
            type={f.kind === 'date' ? 'date' : 'text'}
            inputMode={f.inputMode}
            placeholder={f.placeholder}
            autoComplete={f.autoComplete}
            onChange={(e) => change(f.name, e.target.value)}
          />
        )}
        {problem && (
          <p id={errId} className={styles.fieldError}>
            {problem}
          </p>
        )}
      </div>
    );
  };

  const addressHint = `${uid}-address-hint`;
  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate>
      {spec.intro && <p className={styles.intro}>{spec.intro}</p>}
      <div className={styles.grid}>{shownFields.map((f) => renderField(f))}</div>

      {spec.address && (
        <fieldset className={styles.addressBlock}>
          <legend>{ru.create.addressBlock}</legend>
          {renderField(spec.address, addressHint)}
          <p id={addressHint} className={styles.hint}>
            {ru.create.addressHint}
          </p>
        </fieldset>
      )}

      <p className={styles.hint}>{ru.create.requiredNote}</p>
      {serverError && (
        <p className={styles.formError} role="alert">
          {serverError}
        </p>
      )}
      {footnote}
      <div className={styles.foot}>
        {onClose && (
          <Button onClick={onClose} disabled={busy}>
            {ru.create.cancel}
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? (busyLabel ?? ru.create.submitting) : submitLabel}
        </Button>
      </div>
    </form>
  );
}

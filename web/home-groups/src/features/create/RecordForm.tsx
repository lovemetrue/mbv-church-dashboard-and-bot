import { useId, useRef, useState, type FormEvent } from 'react';
import { ru } from '../../shared/i18n/ru';
import { Button } from '../../shared/ui';
import styles from './Create.module.css';
import type { FieldSpec, FormSpec } from './specs';
import { useCreateRecord, type CreatePath } from './useCreateRecord';

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

interface RecordFormProps {
  spec: FormSpec;
  path: CreatePath;
  submitLabel: string;
  onClose: () => void;
  /** Запись создана: тот, кто открыл окно, закрывает его и показывает подтверждение. */
  onCreated: (id: number) => void;
}

/**
 * Форма создания записи: одна на заявку и на группу, различаются только описанием полей.
 * На месте проверяется лишь то, что обязательное поле не пусто; всё остальное решает сервер, и его
 * отказ показывается над кнопками, не стирая набранного.
 * Пустые поля не отправляются: сервер читает «нет поля» и «пусто» одинаково, а тело остаётся короче.
 */
export function RecordForm({ spec, path, submitLabel, onClose, onCreated }: RecordFormProps) {
  const uid = useId();
  const { submit, busy } = useCreateRecord(path);
  const [values, setValues] = useState<Record<string, string>>(spec.initial);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const refs = useRef<Record<string, Control | null>>({});

  const all = [...spec.fields, ...(spec.address ? [spec.address] : [])];

  const change = (name: string, value: string) => {
    setValues((v) => ({ ...v, [name]: value }));
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
      const v = (values[f.name] ?? '').trim();
      if (v) fields[f.name] = v;
    }
    setServerError(null);
    const result = await submit(fields);
    // Окно могли закрыть, пока шёл запрос: запись всё равно создана, подтверждение показывает родитель.
    if (result === null) return;
    if (result.ok) onCreated(result.id);
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
    return (
      <div key={f.name} className={f.wide ? styles.fieldWide : styles.field}>
        <label htmlFor={id} className={f.required ? styles.required : undefined}>
          {f.label}
        </label>
        {f.kind === 'select' ? (
          <select {...common} ref={setRef} onChange={(e) => change(f.name, e.target.value)}>
            <option value="">{f.required ? ru.create.choose : ru.create.notChosen}</option>
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
      <div className={styles.grid}>{spec.fields.map((f) => renderField(f))}</div>

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
      <div className={styles.foot}>
        <Button onClick={onClose} disabled={busy}>
          {ru.create.cancel}
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? ru.create.submitting : submitLabel}
        </Button>
      </div>
    </form>
  );
}

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { ru } from '../../shared/i18n/ru';
import { useAppNav } from '../../shared/nav';
import { splitList, toggleInList } from '../../shared/multiValue';
import { Button } from '../../shared/ui';
import { blankRequired, changedFields, type EditField, type EditSpec } from './editSpec';
import styles from './Manage.module.css';
import { PersonField } from './PersonField';
import { useManageAction } from './useManage';

interface EditFormProps {
  spec: EditSpec;
  /** Адрес действия относительно /api/v1/, например `groups/12/update`. */
  path: string;
  onClose: () => void;
  /** Сервер принял правку и списки перечитаны. */
  onSaved: () => void;
  /** Идёт ли отправка: окно с формой по этому признаку не даёт себя закрыть, не дождавшись ответа. */
  onBusyChange?: (busy: boolean) => void;
  /** Что перечитать после успеха; по умолчанию всё, что задевает правка записи справочника (см. `useManageAction`). */
  refresh?: (client: QueryClient) => Promise<unknown>;
}

/**
 * Форма правки записи справочника: одна на группу и координатора, различаются описанием полей.
 * Поля заполнены текущими значениями, а на сервер уходят только те, что изменили (см. `changedFields`).
 * «Сохранить» включается, когда есть что сохранять и ни одно обязательное поле не опустошено;
 * остальное проверяет сервер, и его отказ показывается над кнопками, не стирая набранного.
 */
export function EditForm({ spec: given, path, onClose, onSaved, onBusyChange, refresh }: EditFormProps) {
  const uid = useId();
  // Описание берём один раз при открытии: карточка под окном перечитывается раз в минуту, и новые
  // «исходные» значения посреди правки превратили бы набранное в «не изменённое» или наоборот.
  const [spec] = useState(given);
  const { run, busy } = useManageAction(refresh);
  const [values, setValues] = useState<Record<string, string>>(spec.initial);
  const [error, setError] = useState<string | null>(null);
  // Ключ человека, к которому просятся перейти, пока в форме есть несохранённое: сначала спросить, что с ним делать.
  const [leaving, setLeaving] = useState<{ field: string; key: string } | null>(null);
  const nav = useAppNav();
  // Вопрос появляется под нажатой кнопкой; фокус переводим на него, чтобы с клавиатуры не искать его по форме.
  const leaveRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!leaving) return;
    leaveRef.current?.scrollIntoView?.({ block: 'nearest' });
    leaveRef.current?.querySelector('button')?.focus();
  }, [leaving]);

  const busyChange = useRef(onBusyChange);
  busyChange.current = onBusyChange;
  useEffect(() => {
    busyChange.current?.(busy);
  }, [busy]);

  const changes = changedFields(spec, values);
  const blank = blankRequired(spec, values);
  const canSave = Object.keys(changes).length > 0 && blank.length === 0;

  const change = (name: string, value: string) => {
    setValues((v) => ({ ...v, [name]: value }));
    setError(null);
  };

  /**
   * Переход к карточке человека из формы. Форма — окно поверх карточки группы: переход его закрывает, поэтому
   * несохранённое молча пропало бы. Без правок идём сразу, с правками — спрашиваем прямо под кнопкой (`leaveBlock`).
   */
  const openPerson = (field: string, key: string) => {
    if (Object.keys(changes).length === 0) {
      onClose();
      nav.openPerson(key);
    } else {
      setLeaving({ field, key });
    }
  };

  const leaveBlock = (key: string) => (
    <div ref={leaveRef} role="group" aria-label={ru.manage.personPicker.leaveTitle} className={styles.leave}>
      <p>
        <b>{ru.manage.personPicker.leaveTitle}.</b> {canSave ? ru.manage.personPicker.leaveText : ru.manage.personPicker.leaveCantSave}
      </p>
      <div className={styles.personTools}>
        {canSave && (
          <Button variant="primary" size="sm" disabled={busy} onClick={() => void saveAndLeave(key)}>
            {ru.manage.personPicker.leaveSave}
          </Button>
        )}
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            onClose();
            nav.openPerson(key);
          }}
        >
          {ru.manage.personPicker.leaveDiscard}
        </Button>
        <Button size="sm" disabled={busy} onClick={() => setLeaving(null)}>
          {ru.manage.personPicker.leaveStay}
        </Button>
      </div>
    </div>
  );

  async function saveAndLeave(key: string) {
    setError(null);
    const result = await run(path, { fields: changes });
    if (result === null) return;
    if (!result.ok) {
      // Отказ сервера показываем над кнопками, как при обычном «Сохранить»; набранное остаётся.
      setLeaving(null);
      setError(result.message);
      return;
    }
    onSaved();
    nav.openPerson(key);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setError(null);
    const result = await run(path, { fields: changes });
    // null — повторное нажатие, пока первый запрос не закончился: ответит первый.
    if (result === null) return;
    if (result.ok) onSaved();
    else setError(result.message);
  }

  const renderField = (f: EditField) => {
    const id = `${uid}-${f.name}`;
    const problem = blank.includes(f.name) ? (f.kind === 'select' ? ru.manage.requiredChoose(f.label) : ru.manage.required(f.label)) : null;
    const describedBy = [problem ? `${id}-err` : null, f.hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;
    const hint = f.hint && (
      <p id={`${id}-hint`} className={styles.hint}>
        {f.hint}
      </p>
    );

    if (f.kind === 'checkbox') {
      return (
        <div key={f.name} className={styles.fieldWide}>
          <label className={styles.check} htmlFor={id}>
            <input
              id={id}
              type="checkbox"
              checked={Boolean(values[f.name])}
              disabled={busy}
              aria-describedby={describedBy}
              onChange={(e) => change(f.name, e.target.checked ? '1' : '')}
            />
            <span>{f.label}</span>
          </label>
          {hint}
        </div>
      );
    }

    if (f.kind === 'multi') {
      const value = values[f.name] ?? '';
      const picked = new Set(splitList(value));
      const options = f.options ?? [];
      return (
        <fieldset key={f.name} className={`${f.wide ? styles.fieldWide : styles.field} ${styles.multi}`} aria-describedby={describedBy}>
          <legend className={f.required ? styles.required : undefined}>{f.label}</legend>
          <div className={styles.multiList}>
            {options.map((o) => (
              <label key={o} className={styles.check}>
                <input
                  type="checkbox"
                  checked={picked.has(o)}
                  disabled={busy}
                  onChange={(e) => change(f.name, toggleInList(value, o, e.target.checked, options))}
                />
                <span>{f.labels?.[o] ?? o}</span>
              </label>
            ))}
          </div>
          {hint}
        </fieldset>
      );
    }

    if (f.kind === 'person') {
      return (
        <div key={f.name} className={f.wide ? styles.fieldWide : styles.field}>
          <label htmlFor={id}>{f.label}</label>
          <PersonField
            id={id}
            label={f.label}
            value={values[f.name] ?? ''}
            taken={f.other ? (values[f.other] ?? '') : ''}
            disabled={busy}
            describedBy={describedBy}
            allowUnlink={f.allowUnlink}
            legacyName={f.legacyName}
            onOpen={(key) => openPerson(f.name, key)}
            onPick={(p) => change(f.name, p?.key ?? '')}
          />
          {leaving?.field === f.name && leaveBlock(leaving.key)}
          {hint}
        </div>
      );
    }

    const common = {
      id,
      className: `${styles.control} ${problem ? styles.invalid : ''}`,
      value: values[f.name] ?? '',
      disabled: busy,
      'aria-required': f.required ? (true as const) : undefined,
      'aria-invalid': problem ? (true as const) : undefined,
      'aria-describedby': describedBy,
    };
    return (
      <div key={f.name} className={f.wide ? styles.fieldWide : styles.field}>
        <label htmlFor={id} className={f.required ? styles.required : undefined}>
          {f.label}
        </label>
        {f.kind === 'select' ? (
          <select {...common} onChange={(e) => change(f.name, e.target.value)}>
            <option value="">{ru.manage.notChosen}</option>
            {(f.options ?? []).map((o) => (
              <option key={o} value={o}>
                {f.labels?.[o] ?? o}
              </option>
            ))}
          </select>
        ) : f.kind === 'textarea' ? (
          <textarea {...common} rows={3} onChange={(e) => change(f.name, e.target.value)} />
        ) : (
          <input
            {...common}
            type={f.kind === 'date' ? 'date' : 'text'}
            max={f.kind === 'date' ? f.max : undefined}
            inputMode={f.inputMode}
            placeholder={f.placeholder}
            autoComplete="off"
            onChange={(e) => change(f.name, e.target.value)}
          />
        )}
        {problem && (
          <p id={`${id}-err`} className={styles.fieldError}>
            {problem}
          </p>
        )}
        {hint}
      </div>
    );
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <div className={styles.grid}>{spec.fields.map(renderField)}</div>
      {spec.note && <p className={styles.note}>{spec.note}</p>}
      {error && (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      )}
      <div className={styles.foot}>
        <Button onClick={onClose} disabled={busy}>
          {ru.manage.cancel}
        </Button>
        <Button type="submit" variant="primary" disabled={busy || !canSave}>
          {busy ? ru.manage.saving : ru.manage.save}
        </Button>
      </div>
    </form>
  );
}

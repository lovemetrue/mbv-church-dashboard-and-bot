import { useCanChange } from '../../shared/access';
import { useId, useState } from 'react';
import type { StrangeMark } from '@contracts';
import { STRANGE_NOTE_MAX } from '../../entities/strange';
import { ru } from '../../shared/i18n/ru';
import { Button } from '../../shared/ui';
import styles from './Strange.module.css';
import { useStrangeMark, type StrangeTarget } from './useStrangeMark';

const t = ru.strange;

/**
 * Флажок «Странный человек» с необязательной заметкой для коллег. Один блок на заявку, обращение и карточку человека.
 * Флажок — желаемое состояние, кнопка его записывает: «Сохранить отметку», если метка нужна, и «Снять отметку», если её сняли.
 * Пока запрос идёт, всё заблокировано; при ошибке введённая заметка остаётся.
 */
export function StrangeSection({ target, mark }: { target: StrangeTarget; mark: StrangeMark | null }) {
  // Метку видно и без формы — значком и плашкой в карточке; ставит и снимает её не «Только чтение».
  return useCanChange() ? <StrangeForm target={target} mark={mark} /> : null;
}

function StrangeForm({ target, mark }: { target: StrangeTarget; mark: StrangeMark | null }) {
  const headId = useId();
  const checkId = useId();
  const hintId = useId();
  const noteId = useId();
  const strange = useStrangeMark(target);
  const [checked, setChecked] = useState(mark !== null);
  const [note, setNote] = useState(mark?.note ?? '');
  // Данные пришли новые (перечитали список, метку поставил коллега): форма показывает то, что на сервере.
  // Сравниваем по отметке времени, а не по ссылке: список перечитывается каждую минуту и ссылки меняются без причины.
  const [seen, setSeen] = useState(mark?.at ?? null);
  if ((mark?.at ?? null) !== seen) {
    setSeen(mark?.at ?? null);
    setChecked(mark !== null);
    setNote(mark?.note ?? '');
  }

  const marked = mark !== null;
  const noteChanged = note.trim() !== (mark?.note ?? '').trim();
  // Нечего записывать: флажок стоит как на сервере и заметка не менялась.
  const nothingToSave = checked === marked && (!checked || !noteChanged);

  const submit = () => void strange.save(checked, note);

  return (
    <section className={styles.block} aria-labelledby={headId}>
      <h4 id={headId} className={styles.h4}>
        {t.sectionTitle}
      </h4>
      <label className={styles.check} htmlFor={checkId}>
        <input
          id={checkId}
          type="checkbox"
          checked={checked}
          disabled={strange.pending}
          aria-describedby={hintId}
          onChange={(e) => setChecked(e.target.checked)}
        />
        <span>{t.checkbox}</span>
      </label>
      <p id={hintId} className={styles.hint}>
        {t.hint}
      </p>
      {checked && (
        <>
          <label className={styles.label} htmlFor={noteId}>
            {t.noteLabel}
          </label>
          <textarea
            id={noteId}
            className={styles.textarea}
            rows={2}
            maxLength={STRANGE_NOTE_MAX}
            value={note}
            disabled={strange.pending}
            onChange={(e) => setNote(e.target.value)}
          />
        </>
      )}
      <div className={styles.row}>
        <Button disabled={strange.pending || nothingToSave} onClick={submit}>
          {strange.pending ? t.saving : !checked && marked ? t.remove : t.save}
        </Button>
      </div>
      {strange.notice &&
        (strange.notice.kind === 'error' ? (
          <p className={styles.noticeError} role="alert">
            {strange.notice.text}
          </p>
        ) : (
          <p className={styles.noticeOk} role="status">
            {strange.notice.text}
          </p>
        ))}
    </section>
  );
}

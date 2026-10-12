import { useId, useState, type FormEvent } from 'react';
import type { GroupBrief, OtherItem, OtherReconcile } from '@contracts';
import { ru } from '../../../shared/i18n/ru';
import { Button, DrawerSection, Pill } from '../../../shared/ui';
import { OtherGroupPicker } from './OtherGroupPicker';
import styles from './Others.module.css';
import { useReconcile } from './useReconcile';

const r = ru.requests.others.reconcile;

/** Что выбрано в радиогруппе: найденная группа, «Другая группа…» или ещё ничего. */
type Choice = { kind: 'candidate'; id: number } | { kind: 'other' } | null;

/**
 * Начальный выбор. Предвыбрана только единственная найденная группа при `ready`: достаточно подтвердить. При
 * `choose` не выбрано ничего, пока человек не решит сам: «похоже» не повод делать за него. Если искать среди
 * найденных нечего (`none`, `noleader`), открывается «Другая группа…»: других вариантов всё равно нет.
 */
function initialChoice(rec: OtherReconcile): Choice {
  if (rec.status === 'ready' && rec.candidates.length === 1) return { kind: 'candidate', id: rec.candidates[0]!.groupId };
  if (rec.candidates.length === 0 && rec.status !== 'nouser') return { kind: 'other' };
  return null;
}

/**
 * Блок «Разбор» в карточке обращения «уже состою» и «уже веду»: что сервер нашёл в справочнике групп и кнопка,
 * которая вносит человека в состав или связывает группу с ведущим и закрывает обращение. Подтверждения перед
 * отправкой нет намеренно: действие обратимо («Вернуть в работу» и правка состава), зато кнопка названа точно.
 * Для `nouser` выбора нет вовсе: у обращения нет регистрации человека, справочники пополняются только руками.
 */
export function ReconcileBlock({
  item,
  rec,
  onClosed,
}: {
  item: Pick<OtherItem, 'id'>;
  rec: OtherReconcile;
  onClosed: (text: string) => void;
}) {
  const work = useReconcile(item, rec.kind);
  const [choice, setChoice] = useState<Choice>(() => initialChoice(rec));
  const [other, setOther] = useState<GroupBrief | null>(null);
  const name = useId();

  // Выбранный номер должен быть среди найденных сейчас: список мог обновиться, и «предвыбранная» группа пропасть.
  const picked = choice?.kind === 'candidate' ? rec.candidates.find((c) => c.groupId === choice.id) : undefined;
  const group: { id: number; code: string } | null =
    choice?.kind === 'candidate' ? (picked ? { id: picked.groupId, code: picked.code } : null) : choice?.kind === 'other' && other ? other : null;
  const canChoose = rec.status !== 'nouser';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!group || work.pending) return;
    const text = await work.submit(group);
    if (text !== null) onClosed(text);
  };

  return (
    <DrawerSection title={r.title}>
      <p className={styles.recText}>{rec.text}</p>
      {canChoose && (
        <form onSubmit={(e) => void submit(e)} noValidate>
          {/* role=radiogroup у fieldset: читалка называет группу по легенде и знает, что внутри выбор из списка. */}
          <fieldset className={styles.fieldset} role="radiogroup" disabled={work.pending}>
            <legend className={styles.legend}>{rec.kind === 'member' ? r.legendMember : r.legendLeader}</legend>
            {rec.candidates.map((c) => (
              <label key={c.groupId} className={styles.choice}>
                <input
                  type="radio"
                  name={name}
                  checked={choice?.kind === 'candidate' && choice.id === c.groupId}
                  onChange={() => setChoice({ kind: 'candidate', id: c.groupId })}
                />
                <span className={styles.choiceBody}>
                  {r.candidate(c.code, c.leader, c.district)}{' '}
                  <Pill tone={c.tier === 'exact' ? 'ok' : 'warn'}>{c.tier === 'exact' ? r.tierExact : r.tierLikely}</Pill>
                </span>
              </label>
            ))}
            <label className={styles.choice}>
              <input type="radio" name={name} checked={choice?.kind === 'other'} onChange={() => setChoice({ kind: 'other' })} />
              <span className={styles.choiceBody}>{r.otherGroup}</span>
            </label>
          </fieldset>
          {choice?.kind === 'other' && <OtherGroupPicker value={other} onChange={setOther} />}
          {work.error && (
            <p className={styles.recError} role="alert">
              {work.error}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={!group || work.pending}>
            {work.pending ? r.submitting : rec.kind === 'member' ? r.submitMember : r.submitLeader}
          </Button>
          <p className={styles.note}>{r.hint}</p>
        </form>
      )}
    </DrawerSection>
  );
}

import { useState, type FormEvent } from 'react';
import type { GroupBrief, OtherItem, OtherReconcile } from '@contracts';
import { ru } from '../../../shared/i18n/ru';
import { Button, DrawerSection, Pill } from '../../../shared/ui';
import { OtherGroupPicker } from './OtherGroupPicker';
import styles from './Others.module.css';
import { useReconcile } from './useReconcile';

const r = ru.requests.others.reconcile;

/**
 * Начальный выбор. Предвыбрана только единственная найденная группа при `ready`: достаточно подтвердить. При
 * `choose` не выбрано ничего, пока человек не решит сам: «похоже» не повод делать за него (даже когда у ведущего
 * две группы — ведёт он обе или одну, знает человек). Если искать среди найденных нечего (`none`, `noleader`),
 * открыто «Другие группы…»: других вариантов всё равно нет.
 */
function initialPicked(rec: OtherReconcile): Set<number> {
  return rec.status === 'ready' && rec.candidates.length === 1 ? new Set([rec.candidates[0]!.groupId]) : new Set();
}
const initialOtherOpen = (rec: OtherReconcile): boolean => rec.candidates.length === 0 && rec.status !== 'nouser';

/**
 * Блок «Разбор» в карточке обращения «уже состою» и «уже веду»: что сервер нашёл в справочнике групп и кнопка,
 * которая вносит человека в состав или связывает группы с ведущим и закрывает обращение. Групп можно отметить
 * несколько (человек ходит в две группы или ведёт две): найденные — галочками, остальные — через «Другие группы…».
 * Подтверждения перед отправкой нет намеренно: действие обратимо («Вернуть в работу» и правка состава), зато кнопка
 * названа точно. Для `nouser` выбора нет вовсе: у обращения нет регистрации человека, справочники пополняются
 * только руками.
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
  const [picked, setPicked] = useState<Set<number>>(() => initialPicked(rec));
  const [otherOpen, setOtherOpen] = useState(() => initialOtherOpen(rec));
  const [extras, setExtras] = useState<GroupBrief[]>([]);

  // Отмеченные номера должны быть среди найденных сейчас: список мог обновиться, и «предвыбранная» группа пропасть.
  const fromCandidates = rec.candidates.filter((c) => picked.has(c.groupId)).map((c) => ({ id: c.groupId, code: c.code }));
  const fromOther = otherOpen ? extras.filter((g) => !fromCandidates.some((c) => c.id === g.id)).map((g) => ({ id: g.id, code: g.code })) : [];
  const groups = [...fromCandidates, ...fromOther];
  const canChoose = rec.status !== 'nouser';

  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Группа из справочника, которая уже есть среди найденных, просто отмечается там: дважды в списке ей делать нечего.
  const addOther = (g: GroupBrief) => {
    if (rec.candidates.some((c) => c.groupId === g.id)) setPicked((prev) => new Set(prev).add(g.id));
    else setExtras((prev) => (prev.some((x) => x.id === g.id) ? prev : [...prev, g]));
  };

  const submitLabel =
    work.pending ? r.submitting
    : groups.length > 1 ? (rec.kind === 'member' ? r.submitMemberMany(groups.length) : r.submitLeaderMany(groups.length))
    : rec.kind === 'member' ? r.submitMember : r.submitLeader;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (groups.length === 0 || work.pending) return;
    const text = await work.submit(groups);
    if (text !== null) onClosed(text);
  };

  return (
    <DrawerSection title={r.title}>
      <p className={styles.recText}>{rec.text}</p>
      {canChoose && (
        <form onSubmit={(e) => void submit(e)} noValidate>
          {/* role=group у fieldset: читалка называет группу по легенде и знает, что внутри выбор из списка (можно несколько). */}
          <fieldset className={styles.fieldset} role="group" disabled={work.pending}>
            <legend className={styles.legend}>{rec.kind === 'member' ? r.legendMember : r.legendLeader}</legend>
            {rec.candidates.map((c) => (
              <label key={c.groupId} className={styles.choice}>
                <input type="checkbox" checked={picked.has(c.groupId)} onChange={() => toggle(c.groupId)} />
                <span className={styles.choiceBody}>
                  {r.candidate(c.code, c.leader, c.district)}{' '}
                  <Pill tone={c.tier === 'exact' ? 'ok' : 'warn'}>{c.tier === 'exact' ? r.tierExact : r.tierLikely}</Pill>
                </span>
              </label>
            ))}
            <label className={styles.choice}>
              <input type="checkbox" checked={otherOpen} onChange={() => setOtherOpen((v) => !v)} />
              <span className={styles.choiceBody}>{r.otherGroup}</span>
            </label>
          </fieldset>
          {otherOpen && (
            <OtherGroupPicker
              chosen={extras}
              onAdd={addOther}
              onRemove={(id) => setExtras((prev) => prev.filter((g) => g.id !== id))}
            />
          )}
          {work.error && (
            <p className={styles.recError} role="alert">
              {work.error}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={groups.length === 0 || work.pending}>
            {submitLabel}
          </Button>
          <p className={styles.note}>{r.hint}</p>
        </form>
      )}
    </DrawerSection>
  );
}

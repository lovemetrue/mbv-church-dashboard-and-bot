import { useCanChange } from '../../shared/access';
import { useId } from 'react';
import type { RequestItem } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import { Button, Modal } from '../../shared/ui';
import { GroupPicker } from './GroupPicker';
import { proposalOf } from './model';
import { RejectForm } from './RejectForm';
import styles from './Requests.module.css';
import type { ActionNotice, RequestActionsState } from './useRequestActions';

const a = ru.requests.act;

/** Открыта ли заявка для действий: у утверждённых и аннулированных кнопок нет. */
export const isActionable = (r: RequestItem): boolean => r.bucket !== 'done' && r.bucket !== 'cancelled';

/** Подтверждение или ошибка последнего действия. Ошибка — alert, чтобы скринридер прочитал сразу. */
export function ActionNoticeLine({ notice }: { notice: ActionNotice | null }) {
  if (!notice) return null;
  return notice.kind === 'error' ? (
    <p className={styles.noticeError} role="alert">
      {notice.text}
    </p>
  ) : (
    <p className={styles.noticeOk} role="status">
      {notice.text}
    </p>
  );
}

/**
 * Кнопки решения. Предложение — только предложение: человек считается распределённым после
 * нажатия «Утвердить» на этой заявке, поэтому «утвердить всё» здесь нет и не будет.
 * Без плана (нужна помощь) остаются «Другая группа» и «Нужен звонок».
 */
export function RequestActions({ r, act }: { r: RequestItem; act: RequestActionsState }) {
  const hintId = useId();
  const canChange = useCanChange();
  if (!isActionable(r) || !canChange) return null;
  const proposal = proposalOf(r);
  const group = proposal?.main.group;
  const weak = r.bucket === 'human';
  // Данные изменились после закрепления: группа считалась по старым, поэтому «Утвердить» —
  // не главное действие, пока предложение не пересчитано.
  const stale = proposal?.dataChanged === true;
  const rematch = (
    <Button
      variant={stale ? 'primary' : 'default'}
      disabled={act.pending}
      aria-describedby={hintId}
      onClick={() => void act.rematch()}
    >
      {act.pending && act.pendingKind === 'rematch' ? ru.requests.rematch.running : ru.requests.rematch.button}
    </Button>
  );
  return (
    <>
      <div className={styles.actions} role="group" aria-label={a.groupsLabel} aria-busy={act.pending}>
        {stale && rematch}
        {group && (
          <Button
            variant={stale ? 'default' : 'primary'}
            disabled={act.pending}
            aria-label={weak ? a.approveAnywayAria(group.code) : a.approveAria(group.code)}
            onClick={() => void act.approve(group)}
          >
            {weak ? ru.requests.approveAnyway : ru.requests.approve}
          </Button>
        )}
        <Button
          disabled={act.pending}
          aria-label={a.otherGroupAria}
          onClick={() => act.open({ requestId: r.id, kind: 'pick' })}
        >
          {a.otherGroup}
        </Button>
        {group && (
          <Button
            disabled={act.pending}
            aria-label={a.rejectAria(group.code)}
            onClick={() => act.open({ requestId: r.id, kind: 'reject', group })}
          >
            {a.reject}
          </Button>
        )}
        {!stale && rematch}
        <Button
          disabled={act.pending}
          aria-label={r.callback ? a.noCallAria : a.needCallAria}
          onClick={() => void act.setNeedCall(!r.callback)}
        >
          {r.callback ? a.noCall : a.needCall}
        </Button>
      </div>
      <p id={hintId} className={styles.rematchHint}>
        {ru.requests.rematch.hint}
      </p>
    </>
  );
}

/** Окна поверх карточки: выбор группы, причина отказа, вопрос «нет мест». */
export function ActionDialogs({ r, act }: { r: RequestItem; act: RequestActionsState }) {
  const { dialog } = act;
  if (!dialog) return null;
  // Ошибка запроса показывается в окне, пока оно открыто: так не теряется введённое.
  const notice = <ActionNoticeLine notice={act.notice} />;

  if (dialog.kind === 'pick') {
    return (
      <Modal title={a.pickTitle} onClose={act.close}>
        <GroupPicker r={r} pending={act.pending} notice={notice} onSubmit={(g) => void act.approve(g)} onCancel={act.close} />
      </Modal>
    );
  }
  if (dialog.kind === 'reject') {
    return (
      <Modal title={a.rejectTitle(dialog.group.code)} onClose={act.close}>
        <RejectForm
          pending={act.pending}
          notice={notice}
          onSubmit={(reason, comment) => void act.reject(dialog.group, reason, comment)}
          onCancel={act.close}
        />
      </Modal>
    );
  }
  if (dialog.kind === 'confirm') {
    const { group } = dialog;
    return (
      <Modal title={ru.requests.alt.confirmTitle} onClose={act.close}>
        <p>{ru.requests.alt.confirmQuestion(r.fio, group.code, group.leader)}</p>
        {notice}
        <div className={styles.dialogFoot}>
          <Button onClick={act.close}>{a.cancel}</Button>
          <Button variant="primary" disabled={act.pending} onClick={() => void act.approve(group)}>
            {ru.requests.alt.confirmYes}
          </Button>
        </div>
      </Modal>
    );
  }
  if (dialog.kind === 'strange') {
    const { group, force } = dialog;
    return (
      <Modal title={ru.strange.confirmTitle} onClose={act.close}>
        <p>{ru.strange.confirmText}</p>
        <p className={styles.note}>{ru.strange.confirmGroup(r.fio, group.code, group.leader)}</p>
        {notice}
        <div className={styles.dialogFoot}>
          <Button onClick={act.close}>{ru.strange.confirmCancel}</Button>
          <Button variant="primary" disabled={act.pending} onClick={() => void act.approve(group, force, true)}>
            {ru.strange.confirmYes}
          </Button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title={a.fullTitle} onClose={act.close}>
      <p>{a.fullQuestion}</p>
      {notice}
      <div className={styles.dialogFoot}>
        <Button onClick={act.close}>{a.cancel}</Button>
        {/* Про «странного человека» уже спросили: повторять вопрос из-за мест незачем. */}
        <Button variant="primary" disabled={act.pending} onClick={() => void act.approve(dialog.group, true, true)}>
          {a.fullConfirm}
        </Button>
      </div>
    </Modal>
  );
}

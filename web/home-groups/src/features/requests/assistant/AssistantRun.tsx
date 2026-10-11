import { useId, useState } from 'react';
import type { AssistantStatus } from '@contracts';
import { useMe } from '../../../shared/api/queries';
import { ru } from '../../../shared/i18n/ru';
import { useAppNav } from '../../../shared/nav';
import { Button, Modal } from '../../../shared/ui';
import styles from '../Requests.module.css';
import type { useAssistantRun } from './useAssistantRun';

const a = ru.requests.assistant;

/**
 * Кнопка помощника в блоке подбора, подсказка о его состоянии и окно подтверждения.
 * Состояние запуска приходит снаружи: панель подбора гасит свои кнопки, пока работает помощник, и наоборот.
 *
 * Что видит кто. Полный вход: при незаданном ключе и при выключенном помощнике — одна строка-подсказка.
 * Обычный вход: при выключенном — строка без ссылки на «Настройки» (туда ему нельзя); при незаданном ключе
 * блока нет совсем, ему с этим ничего не сделать. Пока роль неизвестна, подсказок нет: чтобы они не мигали.
 */
export function AssistantRun({
  status,
  run,
  locked,
}: {
  status: AssistantStatus;
  run: ReturnType<typeof useAssistantRun>;
  /** Занята другая кнопка блока (подбор или пересчёт): помощника в это время не запускаем. */
  locked: boolean;
}) {
  const me = useMe();
  const nav = useAppNav();
  const [confirming, setConfirming] = useState(false);
  const hintId = useId();
  const role = me.data?.role;
  const isSuper = role === 'super';

  if (!status.available) {
    return isSuper ? <p className={styles.assistantHint}>{a.notConnected}</p> : null;
  }
  if (!status.enabled) {
    if (!role) return null;
    return isSuper ? (
      <p className={styles.assistantHint}>
        {a.offPrefix}
        <button type="button" className={styles.linkBtn} aria-label={a.offLinkAria} onClick={() => nav.goSettingsSection('assistant')}>
          {a.offLink}
        </button>
        {a.offSuffix}
      </p>
    ) : (
      <p className={styles.assistantHint}>{a.offAdmin}</p>
    );
  }

  const empty = status.pending <= 0;
  return (
    <div className={styles.assistantRow}>
      <Button
        disabled={empty || locked || run.pending}
        aria-describedby={empty ? hintId : undefined}
        onClick={() => setConfirming(true)}
      >
        {run.pending ? a.running : a.run(status.pending)}
      </Button>
      {empty && (
        <span id={hintId} className={styles.assistantHint}>
          {a.nothing}
        </span>
      )}
      {confirming && (
        <Modal title={a.confirmTitle} onClose={() => setConfirming(false)}>
          <p>{a.confirmQuestion(status.pending)}</p>
          <div className={styles.dialogFoot}>
            <Button onClick={() => setConfirming(false)}>{ru.requests.act.cancel}</Button>
            <Button
              variant="primary"
              disabled={run.pending}
              onClick={() => {
                // Окно закрываем сразу: ход и итог видны в панели, а не под окном.
                setConfirming(false);
                void run.run();
              }}
            >
              {a.confirm}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

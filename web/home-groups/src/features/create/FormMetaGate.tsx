import type { ReactNode } from 'react';
import type { FormMeta } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import { Button, LoadingState, Modal } from '../../shared/ui';
import styles from './Create.module.css';
import { useFormMeta } from './useFormMeta';

/**
 * Окно формы. Форму рисуем только когда списки загружены: поля со списками и значения по
 * умолчанию строятся из них, а пустой список дал бы форму, которую сервер всё равно отклонит.
 * Пока списки грузятся или не пришли, вместо формы — загрузка или «Повторить».
 */
export function FormMetaGate({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: (meta: FormMeta) => ReactNode;
}) {
  const meta = useFormMeta();
  return (
    <Modal title={title} onClose={onClose}>
      {meta.data ? (
        children(meta.data)
      ) : meta.isError ? (
        <div className={styles.metaError} role="alert">
          <p>{ru.create.metaFailed}</p>
          <div className={styles.foot}>
            <Button onClick={onClose}>{ru.create.cancel}</Button>
            <Button variant="primary" onClick={() => void meta.refetch()}>
              {ru.states.retry}
            </Button>
          </div>
        </div>
      ) : (
        <LoadingState lines={4} />
      )}
    </Modal>
  );
}

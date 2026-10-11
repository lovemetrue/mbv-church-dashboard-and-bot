import type { ReactNode } from 'react';
import type { FormMeta } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import { Button, LoadingState, Modal } from '../../shared/ui';
import styles from './Create.module.css';
import { useFormMeta } from './useFormMeta';

/**
 * Форму рисуем только когда списки загружены: поля со списками и значения по умолчанию строятся из них,
 * а пустой список дал бы форму, которую сервер всё равно отклонит. Пока списки грузятся или не пришли,
 * вместо формы — загрузка или «Повторить». Без окна, чтобы им пользовалась и отдельная страница
 * регистрации; `onCancel` нужен окну, а странице закрывать нечего, и «Отмены» у неё нет.
 */
export function FormMetaContent({
  onCancel,
  children,
}: {
  onCancel?: () => void;
  children: (meta: FormMeta) => ReactNode;
}) {
  const meta = useFormMeta();
  if (meta.data) return <>{children(meta.data)}</>;
  if (meta.isError) {
    return (
      <div className={styles.metaError} role="alert">
        <p>{ru.create.metaFailed}</p>
        <div className={styles.foot}>
          {onCancel && <Button onClick={onCancel}>{ru.create.cancel}</Button>}
          <Button variant="primary" onClick={() => void meta.refetch()}>
            {ru.states.retry}
          </Button>
        </div>
      </div>
    );
  }
  return <LoadingState lines={4} />;
}

/** Окно формы со справочниками сервера (см. `FormMetaContent`). */
export function FormMetaGate({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: (meta: FormMeta) => ReactNode;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <FormMetaContent onCancel={onClose}>{children}</FormMetaContent>
    </Modal>
  );
}

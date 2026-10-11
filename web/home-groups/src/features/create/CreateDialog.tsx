import { useMemo } from 'react';
import { ru } from '../../shared/i18n/ru';
import { Button, LoadingState, Modal } from '../../shared/ui';
import styles from './Create.module.css';
import { RecordForm } from './RecordForm';
import { groupSpec, requestSpec } from './specs';
import { useFormMeta } from './useFormMeta';

export type CreateKind = 'request' | 'group';

/**
 * Окно «Новая заявка» / «Новая группа». Форму рисуем только когда списки загружены: поля со
 * списками и значения по умолчанию строятся из них, а пустой список дал бы форму, которую
 * сервер всё равно отклонит.
 */
export function CreateDialog({
  kind,
  onClose,
  onCreated,
}: {
  kind: CreateKind;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const meta = useFormMeta();
  const isRequest = kind === 'request';
  // Дату «сегодня» берём один раз при открытии: повторная отрисовка не должна менять набранное.
  const spec = useMemo(
    () => (meta.data ? (isRequest ? requestSpec(meta.data) : groupSpec(meta.data)) : null),
    [meta.data, isRequest],
  );

  return (
    <Modal title={isRequest ? ru.create.requestTitle : ru.create.groupTitle} onClose={onClose}>
      {spec ? (
        <RecordForm
          spec={spec}
          path={isRequest ? 'requests/create' : 'groups/create'}
          submitLabel={isRequest ? ru.create.submitRequest : ru.create.submitGroup}
          onClose={onClose}
          onCreated={onCreated}
        />
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

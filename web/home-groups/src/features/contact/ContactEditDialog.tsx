import { Modal } from '../../shared/ui';
import { useGuardedClose } from '../manage/EditDialogs';
import { EditForm } from '../manage/EditForm';
import { refreshAfterContact } from '../manage/members/refresh';
import { contactEditSpec, type ContactValues } from './contactSpec';

/**
 * Окно правки человека: одно и то же для карточки в «Людях» и для заявки. Отличается только адрес сохранения
 * (`people/u12/update`, `persons/3/update`, `requests/5/edit`); сервер доносит правку и до регистрации, и до заявок.
 */
export function ContactEditDialog({
  title, values, path, onClose, onSaved,
}: {
  title: string;
  values: ContactValues;
  path: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const guard = useGuardedClose(onClose);
  return (
    <Modal title={title} onClose={guard.close}>
      <EditForm
        spec={contactEditSpec(values)}
        path={path}
        onClose={guard.close}
        onSaved={onSaved}
        onBusyChange={guard.setBusy}
        refresh={refreshAfterContact}
      />
    </Modal>
  );
}

import { useMemo } from 'react';
import type { FormMeta } from '@contracts';
import { ru } from '../../shared/i18n/ru';
import { FormMetaGate } from './FormMetaGate';
import { RecordForm } from './RecordForm';
import { RegistrationDialog } from './RegistrationDialog';
import { groupSpec, requestSpec } from './specs';

/** Что создаёт окно с записью: заявку или группу. Подтверждение «создана» показывает меню. */
export type CreateKind = 'request' | 'group';
/** Окно меню «Создать»: к записям добавляется регистрация участника, у неё свой результат внутри окна. */
export type DialogKind = CreateKind | 'member';

/** Окно «Новая заявка» / «Новая группа» / «Регистрация участника». */
export function CreateDialog({
  kind,
  onClose,
  onCreated,
}: {
  kind: DialogKind;
  onClose: () => void;
  onCreated: (kind: CreateKind, id: number) => void;
}) {
  if (kind === 'member') return <RegistrationDialog onClose={onClose} />;
  return <RecordDialog kind={kind} onClose={onClose} onCreated={(id) => onCreated(kind, id)} />;
}

function RecordDialog({ kind, onClose, onCreated }: { kind: CreateKind; onClose: () => void; onCreated: (id: number) => void }) {
  const isRequest = kind === 'request';
  return (
    <FormMetaGate title={isRequest ? ru.create.requestTitle : ru.create.groupTitle} onClose={onClose}>
      {(meta) => <RecordDialogForm meta={meta} isRequest={isRequest} onClose={onClose} onCreated={onCreated} />}
    </FormMetaGate>
  );
}

function RecordDialogForm({
  meta,
  isRequest,
  onClose,
  onCreated,
}: {
  meta: FormMeta;
  isRequest: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  // Дату «сегодня» берём один раз при открытии: повторная отрисовка не должна менять набранное.
  const spec = useMemo(() => (isRequest ? requestSpec(meta) : groupSpec(meta)), [meta, isRequest]);
  return (
    <RecordForm
      spec={spec}
      path={isRequest ? 'requests/create' : 'groups/create'}
      submitLabel={isRequest ? ru.create.submitRequest : ru.create.submitGroup}
      onClose={onClose}
      onCreated={(c) => onCreated(c.id)}
    />
  );
}

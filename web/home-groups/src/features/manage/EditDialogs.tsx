import { useRef } from 'react';
import type { CoordinatorItem, GroupItem } from '@contracts';
import { groupLabel } from '../../entities/format';
import { ru } from '../../shared/i18n/ru';
import { Modal } from '../../shared/ui';
import { FormMetaGate } from '../create/FormMetaGate';
import { EditForm } from './EditForm';
import { coordinatorEditSpec, groupEditSpec } from './editSpec';

/**
 * Окно закрывается кнопкой, Esc или щелчком по фону. Пока идёт отправка, закрывать его нельзя:
 * правка всё равно дойдёт до сервера, а человек не узнал бы, чем кончилось.
 */
export function useGuardedClose(onClose: () => void) {
  const busy = useRef(false);
  return {
    close: () => {
      if (!busy.current) onClose();
    },
    setBusy: (b: boolean) => {
      busy.current = b;
    },
  };
}

/** «Правка группы №12»: форма с предзаполнением из карточки. Списки формы (районы, статусы…) грузятся при открытии. */
export function GroupEditDialog({ g, onClose, onSaved }: { g: GroupItem; onClose: () => void; onSaved: () => void }) {
  const guard = useGuardedClose(onClose);
  return (
    <FormMetaGate title={ru.manage.group.editTitle(groupLabel(g))} onClose={guard.close}>
      {(meta) => (
        <EditForm
          spec={groupEditSpec(g, meta)}
          path={`groups/${g.id}/update`}
          onClose={guard.close}
          onSaved={onSaved}
          onBusyChange={guard.setBusy}
        />
      )}
    </FormMetaGate>
  );
}

export function CoordinatorEditDialog({ c, onClose, onSaved }: { c: CoordinatorItem; onClose: () => void; onSaved: () => void }) {
  const guard = useGuardedClose(onClose);
  return (
    <FormMetaGate title={ru.manage.coordinator.editTitle(c.name)} onClose={guard.close}>
      {(meta) => (
        <EditForm
          spec={coordinatorEditSpec(c, meta)}
          path={`coordinators/${c.id}/update`}
          onClose={guard.close}
          onSaved={onSaved}
          onBusyChange={guard.setBusy}
        />
      )}
    </FormMetaGate>
  );
}

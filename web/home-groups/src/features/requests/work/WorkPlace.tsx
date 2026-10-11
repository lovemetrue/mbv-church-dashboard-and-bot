import type { RequestItem } from '@contracts';
import { ru } from '../../../shared/i18n/ru';
import { DrawerSection } from '../../../shared/ui';
import { AssignSelect } from './AssignSelect';
import { CallOutcome } from './CallOutcome';
import { ContactLinks } from './ContactLinks';
import { EditData } from './EditData';
import { useRequestWork } from './useRequestWork';
import styles from './work.module.css';

/** Заявка ещё в работе: звонить по закрытой и править её данные уже не нужно (сервер ответил бы «уже закрыта»). */
export function isOpenRequest(r: RequestItem): boolean {
  return r.bucket !== 'done' && r.bucket !== 'cancelled';
}

/**
 * Рабочее место координатора в карточке заявки. Состояние запросов одно на все блоки
 * (`useRequestWork`), а сам блок привязан к заявке ключом: при смене заявки черновики не переезжают.
 */
export function WorkPlace({ r }: { r: RequestItem }) {
  const work = useRequestWork(r.id);
  const open = isOpenRequest(r);
  return (
    <DrawerSection title={ru.requests.work.title}>
      <div className={styles.work}>
        <ContactLinks r={r} editable={open} />
        <AssignSelect r={r} work={work} />
        {open && <CallOutcome work={work} />}
        {open && <EditData r={r} work={work} />}
      </div>
    </DrawerSection>
  );
}

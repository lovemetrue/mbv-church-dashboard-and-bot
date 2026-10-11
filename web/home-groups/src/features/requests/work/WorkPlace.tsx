import { ru } from '../../../shared/i18n/ru';
import { DrawerSection } from '../../../shared/ui';
import { AssignSelect } from './AssignSelect';
import { CallOutcome } from './CallOutcome';
import { CloseRequest } from './CloseRequest';
import { ContactLinks } from './ContactLinks';
import { EditData } from './EditData';
import type { WorkSubject } from './subject';
import { useRequestWork } from './useRequestWork';
import styles from './work.module.css';

/** Запись ещё в работе: звонить по закрытой и править её данные уже не нужно (сервер ответил бы «уже закрыта»). */
export const isOpenSubject = (r: Pick<WorkSubject, 'state'>): boolean => r.state === 'open';

/**
 * Рабочее место координатора в карточке заявки или обращения. Состояние запросов одно на все блоки
 * (`useRequestWork`), а сам блок привязан к записи ключом: при смене записи черновики не переезжают.
 * Блок знает только минимум полей (`WorkSubject`): подбор и утверждение живут в карточке заявки, не здесь.
 */
export function WorkPlace({ subject, onClosed }: { subject: WorkSubject; onClosed: (text: string) => void }) {
  const work = useRequestWork(subject.id);
  const open = isOpenSubject(subject);
  return (
    <DrawerSection title={ru.requests.work.title}>
      <div className={styles.work}>
        <ContactLinks r={subject} editable={open} />
        <AssignSelect r={subject} work={work} />
        {open && <CallOutcome work={work} />}
        {open && <EditData r={subject} work={work} />}
        <CloseRequest subject={subject} work={work} onClosed={onClosed} />
      </div>
    </DrawerSection>
  );
}

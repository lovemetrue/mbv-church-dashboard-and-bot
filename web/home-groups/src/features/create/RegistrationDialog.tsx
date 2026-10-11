import { useRef } from 'react';
import { ru } from '../../shared/i18n/ru';
import { FormMetaGate } from './FormMetaGate';
import { RegistrationFlow } from './RegistrationFlow';
import { RegistrationLink } from './RegistrationLink';

/**
 * Окно «Регистрация участника». Успех не закрывает окно: служителю сразу нужны номер, QR и печать
 * карточки, а за следующим участником он вернётся к чистой форме («Зарегистрировать ещё»).
 *
 * Пока запрос идёт, окно не закрывается (Esc, ✕, клик мимо): ответ пришёл бы в уже убранное окно, и номер
 * зарегистрированного человека остался бы неизвестным, а повторная регистрация создала бы дубль.
 */
export function RegistrationDialog({ onClose }: { onClose: () => void }) {
  const busy = useRef(false);
  const close = () => {
    if (!busy.current) onClose();
  };
  return (
    <FormMetaGate title={ru.create.registration.title} onClose={close}>
      {(meta) => (
        <RegistrationFlow meta={meta} onClose={close} onBusyChange={(b) => (busy.current = b)} footnote={<RegistrationLink />} />
      )}
    </FormMetaGate>
  );
}

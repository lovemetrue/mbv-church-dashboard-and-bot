import { useState } from 'react';
import { BASE_URL } from '../../shared/api/base';
import { ru } from '../../shared/i18n/ru';
import { Button } from '../../shared/ui';
import { copyText } from '../requests/work/clipboard';
import styles from './Create.module.css';

/** Полный адрес отдельной страницы регистрации. Основание берём из настроек сборки, а не пишем «/registration» руками. */
export const registrationPageUrl = (origin: string = window.location.origin): string => `${origin}${BASE_URL}registration`;

/**
 * Строка внизу окна регистрации: адрес страницы, которую можно открыть на телефоне волонтёра на месте,
 * и кнопка «Скопировать ссылку». Если буфер обмена недоступен, об этом сказано словами, а ссылку можно выделить.
 */
export function RegistrationLink() {
  const r = ru.create.registration;
  const url = registrationPageUrl();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <div className={styles.pageLink}>
      <p className={styles.pageLinkText}>
        {r.standaloneLine} <span className={styles.pageLinkUrl}>{url}</span>
      </p>
      <Button
        onClick={() => {
          void copyText(url).then((ok) => setState(ok ? 'copied' : 'failed'));
        }}
      >
        {r.copyLink}
      </Button>
      {state !== 'idle' && (
        <p className={state === 'copied' ? styles.pageLinkOk : styles.fieldError} role="status">
          {state === 'copied' ? r.linkCopied : r.copyFailed}
        </p>
      )}
    </div>
  );
}

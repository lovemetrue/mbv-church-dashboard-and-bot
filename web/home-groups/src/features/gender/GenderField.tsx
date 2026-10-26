import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { GenderInfo, PersonGenderBody } from '@contracts';
import { ApiError, apiPost } from '../../shared/api/client';
import { ru } from '../../shared/i18n/ru';
import { refreshAfterStrange } from '../strange/useStrangeMark';
import styles from './Gender.module.css';

const t = ru.gender;

/**
 * Пол человека: «М» и «Ж» — кнопки-переключатели, рядом откуда он взялся (из ФИО, подсказка модели, поставлен вручную).
 * Пустой подсвечивается: без пола мужские и женские группы человеку не подбираются. Поставленный вручную или моделью
 * можно снять — пол снова возьмётся из ФИО. Перечитывается то же, что после метки «Странный человек»: пол виден в
 * заявках, «Людях» и подборе.
 */
export function GenderField({ personKey, gender }: { personKey: string; gender: GenderInfo }) {
  const client = useQueryClient();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(value: 'м' | 'ж' | null) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await apiPost('people/gender', { key: personKey, gender: value } satisfies PersonGenderBody);
      await refreshAfterStrange(client);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 0 ? t.errorNetwork : e instanceof ApiError && e.code === 'bad_request' ? e.message : t.errorOther);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  const unknown = gender.value === null;
  return (
    <div className={unknown ? `${styles.field} ${styles.missing}` : styles.field}>
      <div className={styles.row} role="group" aria-label={t.label}>
        {(['м', 'ж'] as const).map((g) => (
          <button
            key={g}
            type="button"
            className={styles.choice}
            aria-pressed={gender.value === g}
            disabled={pending}
            onClick={() => void save(g)}
          >
            {t.option[g]}
          </button>
        ))}
        {(gender.by === 'manual' || gender.by === 'ai') && (
          <button type="button" className={styles.reset} disabled={pending} onClick={() => void save(null)}>
            {t.reset}
          </button>
        )}
      </div>
      <p className={styles.source}>{unknown ? t.missing : t.by[gender.by ?? 'fio']}</p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

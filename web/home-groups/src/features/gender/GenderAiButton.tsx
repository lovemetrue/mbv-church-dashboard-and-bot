import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { GenderAiOk, PersonItem } from '@contracts';
import { ApiError, apiPost } from '../../shared/api/client';
import { useMe } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';
import { Button } from '../../shared/ui';
import { refreshAfterStrange } from '../strange/useStrangeMark';
import styles from './Gender.module.css';

const t = ru.gender;

/**
 * «Подсказать пол помощником» над списком «Людей». Видна только полному входу (наружу уходят слова из ФИО, как и у
 * подключения помощника) и только пока есть люди без пола. Итог — сколько заполнено и сколько осталось вручную.
 */
export function GenderAiButton({ items }: { items: readonly PersonItem[] | undefined }) {
  const role = useMe().data?.role;
  const client = useQueryClient();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const unknown = (items ?? []).filter((p) => p.gender.value === null).length;
  if (role !== 'super' || (unknown === 0 && result === null)) return null;

  async function run() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setResult(null);
    try {
      const done = await apiPost<GenderAiOk>('people/gender-ai', {});
      setResult(t.aiDone(done.filled, done.left));
      await refreshAfterStrange(client);
    } catch (e) {
      setResult(e instanceof ApiError && e.message && !/^Ошибка \d+$/.test(e.message) ? e.message : t.aiFailed);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <div className={styles.ai}>
      {unknown > 0 && (
        <Button size="sm" disabled={pending} title={t.aiHint} onClick={() => void run()}>
          {pending ? t.aiRunning : `${t.aiButton} (${unknown})`}
        </Button>
      )}
      {result && (
        <span role="status" className={styles.source}>
          {result}
        </span>
      )}
    </div>
  );
}

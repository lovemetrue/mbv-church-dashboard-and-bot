import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AssistantRunOk } from '@contracts';
import { apiPost } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queries';
import { serverText } from '../../../shared/api/serverText';
import { ru } from '../../../shared/i18n/ru';

const a = ru.requests.assistant;

/**
 * Запуск разбора заявок помощником. Один флаг в `ref`: два подтверждения подряд могут прийти до перерисовки,
 * а разбор платный (запрос к языковой модели) и занимает около минуты, второй запуск рядом бессмыслен.
 *
 * Ошибку показываем словами сервера («Помощник выключен…», «Разбор уже идёт…», «ответил не в том виде…»): по коду
 * не угадать, что случилось. Итог не опережает список: после разбора у заявок появились пояснения и предложения,
 * поэтому его показываем после перечитывания.
 */
export function useAssistantRun() {
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<AssistantRunOk | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setResult(null);
    setError(null);
    try {
      const out = await apiPost<AssistantRunOk>('assistant/run', {});
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.requests }),
        queryClient.invalidateQueries({ queryKey: queryKeys.today }),
        queryClient.invalidateQueries({ queryKey: queryKeys.team }),
      ]);
      setResult(out);
    } catch (e) {
      setError(serverText(e, { network: a.errorNetwork, fallback: a.errorOther }));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return { pending, result, error, run };
}

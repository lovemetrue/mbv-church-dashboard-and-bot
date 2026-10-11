import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AssistantRunOk } from '@contracts';
import { apiPost } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queries';
import { serverText } from '../../../shared/api/serverText';
import { ru } from '../../../shared/i18n/ru';

export interface AssistantNotice {
  kind: 'ok' | 'error';
  text: string;
}

const a = ru.requests.assistant;

/**
 * Запуск разбора заявок помощником. Один флаг в `ref`: два подтверждения подряд могут прийти до перерисовки,
 * а разбор платный (запрос к языковой модели) и занимает около минуты, второй запуск рядом бессмыслен.
 *
 * Ошибку показываем словами сервера («Помощник выключен…», «Разбор уже идёт…»): по коду не угадать, что случилось.
 * Итог «Готово» не опережает список: после разбора у заявок появились пометки и предложения, ждём перечитывания.
 */
export function useAssistantRun() {
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<AssistantNotice | null>(null);

  async function run() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setNotice(null);
    try {
      const out = await apiPost<AssistantRunOk>('assistant/run', {});
      setNotice({ kind: 'ok', text: a.done(out.asked, out.filled, out.withQuestions, out.proposals) });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.requests }),
        queryClient.invalidateQueries({ queryKey: queryKeys.today }),
        queryClient.invalidateQueries({ queryKey: queryKeys.team }),
      ]);
    } catch (e) {
      setNotice({ kind: 'error', text: serverText(e, { network: a.errorNetwork, fallback: a.errorOther }) });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return { pending, notice, run };
}

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { MatchingAutoBody, MatchingRunOk, ResendFioOk } from '@contracts';
import { ApiError, apiPost } from '../../shared/api/client';
import { queryKeys, useMe } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';

export interface MatchingNotice {
  kind: 'ok' | 'error';
  text: string;
}

const m = ru.requests.matching;

/** Текст ошибки подбора по коду контракта. Текст сервера не показываем: он для разработчика. */
function errorText(error: unknown, fallback: string, forbidden: string): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return m.errorNetwork;
    if (error.status === 403) return forbidden;
  }
  return fallback;
}

/**
 * Запуск подбора и переключатель автоподбора.
 *
 * Роль берём из `/me`, но решает всё равно сервер: пока ответа нет, считаем, что переключать
 * нельзя, а 403 всё равно показываем понятным текстом. Один флаг в `ref` на оба действия:
 * два нажатия подряд могут прийти до перерисовки, а запуск подбора не идемпотентен с точки
 * зрения человека, который смотрит на итоговые числа.
 */
export function useMatching() {
  const queryClient = useQueryClient();
  const me = useMe();
  const inFlight = useRef(false);
  const [pending, setPending] = useState<'run' | 'auto' | 'notify' | 'resend' | 'rerun' | null>(null);
  const [notice, setNotice] = useState<MatchingNotice | null>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.requests }),
      queryClient.invalidateQueries({ queryKey: queryKeys.today }),
      queryClient.invalidateQueries({ queryKey: queryKeys.groups }),
    ]);

  async function guarded(kind: 'run' | 'auto' | 'notify' | 'resend' | 'rerun', work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(kind);
    setNotice(null);
    try {
      await work();
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  const run = () =>
    guarded('run', async () => {
      try {
        const out = await apiPost<MatchingRunOk>('matching/run', {});
        setNotice({ kind: 'ok', text: m.done(out.created, out.replaced, out.unchanged) });
        // Ждём перечитывания: пока список показывает старые предложения, итог «Готово» врал бы.
        await refresh();
      } catch (e) {
        setNotice({ kind: 'error', text: errorText(e, m.errorRun, ru.requests.act.errorForbidden) });
      }
    });

  /** Пересчитать закреплённые предложения всех открытых заявок. Окно подтверждения — в панели. */
  const rerunAll = () =>
    guarded('rerun', async () => {
      try {
        const out = await apiPost<MatchingRunOk>('matching/rerun-all', {});
        setNotice({ kind: 'ok', text: m.rerunDone(out.created, out.replaced, out.unchanged) });
        // Как и после обычного запуска: итог не должен опережать список, в котором предложения уже другие.
        await refresh();
      } catch (e) {
        setNotice({ kind: 'error', text: errorText(e, m.errorRerun, ru.requests.act.errorForbidden) });
      }
    });

  const setAuto = (enabled: boolean) =>
    guarded('auto', async () => {
      try {
        const body: MatchingAutoBody = { enabled };
        await apiPost('matching/auto', body);
        // Состояние переключателя берём из ответа сервера, а не угадываем: оно придёт с заявками.
        await queryClient.invalidateQueries({ queryKey: queryKeys.requests });
      } catch (e) {
        setNotice({ kind: 'error', text: errorText(e, m.errorAuto, m.superOnly) });
      }
    });

  /** «Писать в MAX при утверждении»: как и автоподбор, включает только полный вход, состояние — из ответа сервера. */
  const setNotify = (enabled: boolean) =>
    guarded('notify', async () => {
      try {
        const body: MatchingAutoBody = { enabled };
        await apiPost('matching/notify', body);
        await queryClient.invalidateQueries({ queryKey: queryKeys.requests });
      } catch (e) {
        setNotice({ kind: 'error', text: errorText(e, m.errorNotify, m.superOnly) });
      }
    });

  /** Повтор ведущим, которым сообщение ушло без ФИО (до исправления). Итог — сколько поставлено в очередь бота. */
  const resendFio = () =>
    guarded('resend', async () => {
      try {
        const out = await apiPost<ResendFioOk>('matching/resend-fio', {});
        setNotice({ kind: 'ok', text: m.resendDone(out.queued) });
        await queryClient.invalidateQueries({ queryKey: queryKeys.requests });
      } catch (e) {
        setNotice({ kind: 'error', text: errorText(e, m.errorResend, m.superOnly) });
      }
    });

  return { pending, notice, canToggle: me.data?.role === 'super', run, rerunAll, setAuto, setNotify, resendFio };
}

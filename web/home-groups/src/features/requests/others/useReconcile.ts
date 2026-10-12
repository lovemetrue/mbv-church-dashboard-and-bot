import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { OtherItem, ReconcileBody, ReconcileOk, ReconcileReadyBody, ReconcileReadyOk } from '@contracts';
import { ApiError, apiPost } from '../../../shared/api/client';
import { ru } from '../../../shared/i18n/ru';
import { refreshAfterReconcile } from './refresh';
import { reconcileErrorText, reconcileReadyErrorText } from './reconcileErrors';

const r = ru.requests.others.reconcile;

/**
 * Разбор одного обращения: `POST requests/:id/reconcile {groupId}`. Возвращает текст итога, если сервер принял,
 * и null, если нет (ошибка остаётся в `error`). Запрос в каждый момент один: два нажатия приходят раньше
 * перерисовки, поэтому одного `pending` мало, флаг ещё и в `ref` (как в `useRequestWork`).
 * Повторов нет намеренно: после обрыва связи неизвестно, записалось ли, и слепой повтор внёс бы человека дважды.
 */
export function useReconcile(item: Pick<OtherItem, 'id'>, kind: 'member' | 'leader') {
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(group: { id: number; code: string }): Promise<string | null> {
    if (inFlight.current) return null;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const body: ReconcileBody = { groupId: group.id };
      const out = await apiPost<ReconcileOk>(`requests/${item.id}/reconcile`, body);
      // Ждём перечитывания: пока список показывает старое, карточка закрылась бы над устаревшим.
      await refreshAfterReconcile(queryClient);
      return kind === 'member' ? r.doneMember(group.code, out.already) : r.doneLeader(group.code, out.already);
    } catch (e) {
      setError(reconcileErrorText(e));
      // Обращение закрыли без нас: список устарел, показываем актуальный.
      if (e instanceof ApiError && e.code === 'already_closed') await refreshAfterReconcile(queryClient);
      return null;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return { pending, error, submit };
}

/** Состояние окна «Разобрать все готовые». */
export interface ReadyBulkState {
  /** Номера, которые человек подтверждает; null — окно закрыто. Фиксируются в момент нажатия кнопки. */
  asked: number[] | null;
  running: boolean;
  error: string | null;
  ask: (ids: number[]) => void;
  cancel: () => void;
  confirm: () => Promise<string | null>;
}

/**
 * Массовый разбор: `POST requests/reconcile-ready {ids}`. Номера замораживаются при нажатии кнопки: то, что
 * подтвердили в окне, и то, что отправили, не должно разойтись, если список за это время обновился.
 */
export function useReconcileReady(): ReadyBulkState {
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const [asked, setAsked] = useState<number[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm(): Promise<string | null> {
    if (!asked || asked.length === 0 || inFlight.current) return null;
    inFlight.current = true;
    setRunning(true);
    setError(null);
    try {
      const body: ReconcileReadyBody = { ids: asked };
      const out = await apiPost<ReconcileReadyOk>('requests/reconcile-ready', body);
      await refreshAfterReconcile(queryClient);
      return ru.requests.others.ready.done(out.applied, out.skipped);
    } catch (e) {
      setError(reconcileReadyErrorText(e));
      return null;
    } finally {
      inFlight.current = false;
      setRunning(false);
      setAsked(null);
    }
  }

  return {
    asked,
    running,
    error,
    ask: (ids) => {
      setError(null);
      setAsked(ids);
    },
    cancel: () => {
      if (!inFlight.current) setAsked(null);
    },
    confirm,
  };
}

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ApproveBody, GroupBrief, NeedCallBody, RejectBody, RejectReason, RequestItem, RequestsView } from '@contracts';
import { ApiError, apiPost } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queries';
import { ru } from '../../shared/i18n/ru';

/** Что открыто поверх карточки. Окно привязано к заявке: при смене заявки оно не показывается. */
export type ActionDialog =
  | { requestId: number; kind: 'pick' }
  | { requestId: number; kind: 'reject'; group: GroupBrief }
  | { requestId: number; kind: 'full'; group: GroupBrief }
  /** Подтверждение для запасного варианта: он не главный, и случайный клик по нему не должен распределять человека. */
  | { requestId: number; kind: 'confirm'; group: GroupBrief };

export interface ActionNotice {
  requestId: number;
  kind: 'ok' | 'error';
  text: string;
}

interface Outcome {
  ok: boolean;
  code: ApiError['code'];
}

/** Текст ошибки действия по коду контракта. Текст сервера не показываем: он для разработчика. */
export function actionErrorText(error: unknown): string {
  const a = ru.requests.act;
  if (!(error instanceof ApiError)) return a.errorOther;
  if (error.status === 0) return a.errorNetwork;
  if (error.status === 403) return a.errorForbidden;
  switch (error.code) {
    case 'already_closed':
      return `${a.errorClosed}. ${a.errorClosedHint}`;
    case 'group_unavailable':
      return a.errorUnavailable;
    case 'not_found':
      return a.errorNotFound;
    case 'bad_request':
      return a.errorBadRequest;
    default:
      return a.errorOther;
  }
}

/**
 * Действия координатора над одной заявкой: утвердить, отклонить, отметить «нужен звонок».
 *
 * Состояние живёт в карточке, а не в кнопках: после «Утвердить» заявка становится
 * утверждённой, кнопки исчезают, а подтверждение «Утверждено: ДГ-0012» должно остаться.
 *
 * Пока идёт запрос, все кнопки заблокированы. Одного `pending` для этого мало: два нажатия
 * подряд могут прийти до перерисовки, поэтому ещё и флаг в `ref`, который меняется сразу.
 */
export function useRequestActions(r: RequestItem) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  // Какое действие идёт: кнопка «Подобрать заново» меняет подпись только у себя.
  const [pendingKind, setPendingKind] = useState<string | null>(null);
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<ActionNotice | null>(null);
  const [dialog, setDialog] = useState<ActionDialog | null>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.requests }),
      queryClient.invalidateQueries({ queryKey: queryKeys.today }),
      queryClient.invalidateQueries({ queryKey: queryKeys.groups }),
    ]);

  /**
   * `okText` — строка или функция: функция вызывается после перечитывания списка. Нужна для
   * «Подобрать заново», где в подтверждении называется группа, которой ещё нет в старых данных.
   */
  async function run(
    action: 'approve' | 'reject' | 'need-call' | 'rematch',
    body: ApproveBody | RejectBody | NeedCallBody | Record<string, never>,
    okText: string | (() => string),
  ): Promise<Outcome> {
    if (inFlight.current) return { ok: false, code: null };
    inFlight.current = true;
    setPending(true);
    setPendingKind(action);
    setNotice(null);
    try {
      await apiPost(`requests/${r.id}/${action}`, body);
      if (typeof okText === 'string') setNotice({ requestId: r.id, kind: 'ok', text: okText });
      // Ждём перечитывания списка: пока карточка показывает старое состояние, повторное
      // действие по ней было бы действием вслепую.
      await refresh();
      if (typeof okText === 'function') setNotice({ requestId: r.id, kind: 'ok', text: okText() });
      return { ok: true, code: null };
    } catch (e) {
      const code = e instanceof ApiError ? e.code : null;
      // «Нет мест» — не ошибка, а вопрос: его задаёт отдельное окно.
      if (code !== 'group_full') setNotice({ requestId: r.id, kind: 'error', text: actionErrorText(e) });
      // Заявку закрыли без нас: список устарел, показываем актуальный.
      if (code === 'already_closed') await refresh();
      return { ok: false, code };
    } finally {
      inFlight.current = false;
      setPending(false);
      setPendingKind(null);
    }
  }

  const open = (next: ActionDialog | null) => {
    setNotice(null);
    setDialog(next);
  };

  /** Утвердить заявку в группу; `force` — после подтверждения «мест нет». */
  async function approve(group: GroupBrief, force = false) {
    const body: ApproveBody = force ? { groupId: group.id, force: true } : { groupId: group.id };
    const out = await run('approve', body, ru.requests.act.approved(group.code));
    if (out.ok || out.code === 'already_closed') setDialog(null);
    else if (out.code === 'group_full') setDialog({ requestId: r.id, kind: 'full', group });
  }

  async function reject(group: GroupBrief, reason: RejectReason, comment: string) {
    const text = comment.trim();
    const body: RejectBody = text ? { groupId: group.id, reason, comment: text } : { groupId: group.id, reason };
    const out = await run('reject', body, ru.requests.act.rejected(group.code));
    if (out.ok || out.code === 'already_closed') setDialog(null);
  }

  async function setNeedCall(value: boolean) {
    const body: NeedCallBody = { value };
    await run('need-call', body, value ? ru.requests.act.callSet : ru.requests.act.callCleared);
  }

  /** Какую группу предлагают заявке в перечитанных данных; null — предложения нет или данных нет. */
  const proposedNow = (): string | null => {
    const view = queryClient.getQueryData<RequestsView>(queryKeys.requests);
    return view?.items.find((x) => x.id === r.id)?.proposal?.main.group.code ?? null;
  };

  /** Пересчитать группу по текущим данным заявки; прежнее закреплённое предложение сервер снимает сам. */
  async function rematch() {
    await run('rematch', {}, () => {
      const code = proposedNow();
      return code ? ru.requests.rematch.done(code) : ru.requests.rematch.doneGeneral;
    });
  }

  return {
    pending,
    pendingKind,
    notice: notice?.requestId === r.id ? notice : null,
    dialog: dialog?.requestId === r.id ? dialog : null,
    open,
    close: () => setDialog(null),
    approve,
    reject,
    setNeedCall,
    rematch,
  };
}

export type RequestActionsState = ReturnType<typeof useRequestActions>;

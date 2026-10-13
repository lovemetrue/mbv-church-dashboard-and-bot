import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AssignBody, CallBody, CallResult, CloseBody, RequestEditBody } from '@contracts';
import { ApiError, apiPost } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queries';
import { ru } from '../../../shared/i18n/ru';

const w = ru.requests.work;

/** Блок карточки, рядом с которым показывается результат: сообщение стоит там, где человек нажимал. */
export type WorkBlock = 'assign' | 'call' | 'edit' | 'close';

export interface WorkNotice {
  block: WorkBlock;
  kind: 'ok' | 'error';
  text: string;
}

/** Сервер без своего текста отвечает общим «Ошибка 400»: его человеку показывать нечего. */
const GENERIC_SERVER_TEXT = /^Ошибка \d+$/;

/**
 * Текст ошибки. Для `bad_request` показываем слова сервера: он единственный знает, что не так
 * (телефон не похож на номер, имя слишком длинное), и пишет об этом по-русски. Остальные
 * случаи объясняем по коду — служебные тексты 404/409/5xx человеку ничего не говорят.
 */
export function workErrorText(error: unknown): string {
  if (!(error instanceof ApiError)) return w.errorOther;
  if (error.status === 0) return w.errorNetwork;
  if (error.status === 403) return w.errorForbidden;
  switch (error.code) {
    case 'bad_request':
      return GENERIC_SERVER_TEXT.test(error.message) ? w.errorBadRequest : error.message;
    case 'already_closed':
      return w.errorClosed;
    case 'not_found':
      return w.errorNotFound;
    default:
      return w.errorOther;
  }
}

const CALL_DONE: Record<CallResult, string> = {
  reached: w.callDoneReached,
  no_answer: w.callDoneNoAnswer,
  later: w.callDoneLater,
  refused: w.callDoneRefused,
};

/**
 * Рабочее место координатора над одной заявкой: «в работе у», итог звонка, правка данных, закрытие.
 *
 * Запрос в каждый момент один: пока он идёт, блокируются все блоки, иначе правка и итог
 * звонка, отправленные подряд, могли бы прийти на сервер в другом порядке. Одного `pending`
 * мало (два нажатия приходят до перерисовки), поэтому флаг ещё и в `ref`.
 */
export function useRequestWork(requestId: number) {
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<WorkNotice | null>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.requests }),
      queryClient.invalidateQueries({ queryKey: queryKeys.today }),
      queryClient.invalidateQueries({ queryKey: queryKeys.groups }),
      // Правка данных заявки доходит до карточки человека (и наоборот).
      queryClient.invalidateQueries({ queryKey: queryKeys.people }),
      // «Команда» считает открытые заявки и обращения: после закрытия и возврата её числа устаревают.
      queryClient.invalidateQueries({ queryKey: queryKeys.team }),
    ]);

  /** Возвращает true, если сервер принял действие. */
  async function run(block: WorkBlock, action: string, body: unknown, okText: string): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPending(true);
    setNotice(null);
    try {
      await apiPost(`requests/${requestId}/${action}`, body);
      setNotice({ block, kind: 'ok', text: okText });
      // Ждём перечитывания: пока карточка показывает старое, повторное действие шло бы вслепую.
      await refresh();
      return true;
    } catch (e) {
      setNotice({ block, kind: 'error', text: workErrorText(e) });
      // Заявку закрыли без нас: список устарел, показываем актуальный.
      if (e instanceof ApiError && e.code === 'already_closed') await refresh();
      return false;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return {
    pending,
    notice,
    clearNotice: () => setNotice(null),
    /** «В работе у»: имя координатора или null — снять. */
    assign: (name: string | null) => {
      const body: AssignBody = { responsible: name };
      return run('assign', 'assign', body, name ? w.assignedTo(name) : w.assignedNobody);
    },
    /** Итог звонка; пустой комментарий не отправляем вовсе. */
    logCall: (result: CallResult, comment: string) => {
      const text = comment.trim();
      const body: CallBody = text ? { result, comment: text } : { result };
      return run('call', 'call', body, w.callRecorded(CALL_DONE[result]));
    },
    /** `fields` — названия изменённых полей для подтверждения (без значений). */
    edit: (body: RequestEditBody, fields: string[]) => run('edit', 'edit', body, w.editSaved(fields)),
    /** Закрыть заявку: `okText` показывается, если окно закрытия ещё на экране; обычно карточка закрывается сама. */
    close: (body: CloseBody, okText: string) => run('close', 'close', body, okText),
    /** Вернуть закрытую заявку в работу; тело пустое, как требует контракт. */
    reopen: () => run('close', 'reopen', {}, ru.requests.close.reopened),
  };
}

export type RequestWorkState = ReturnType<typeof useRequestWork>;

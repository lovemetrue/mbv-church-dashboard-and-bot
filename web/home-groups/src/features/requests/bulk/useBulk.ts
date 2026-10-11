import { useRef, useState } from 'react';
import type { BulkBody, RequestItem } from '@contracts';
import { ApiError } from '../../../shared/api/client';
import { useBulkRequests } from '../../../shared/api/queries';
import { ru } from '../../../shared/i18n/ru';
import { BULK_LIMIT, pickFirst } from './selection';

/** Что человек просит сделать; выполняется только после подтверждения в окне. */
export type BulkRequest =
  | { kind: 'assign'; who: string | null }
  | { kind: 'need-call'; value: boolean };

export interface BulkNotice {
  kind: 'ok' | 'error';
  text: string;
}

const b = ru.requests.bulk;

/**
 * Выбор заявок и массовые действия над ними.
 *
 * Выбор живёт в памяти экрана, а не в адресе: ссылка с сотней номеров никому не нужна, а
 * случайно пересланная — опасна. Он принадлежит текущему списку, поэтому `resetKey` (чип, поиск,
 * «В работе у») его сбрасывает; смена вкладки сбрасывает сама, экран размонтируется. Кроме того
 * выбранным считается только то, что сейчас видно: заявку могли утвердить в другой вкладке, и
 * действие «вслепую» по ушедшей из списка заявке было бы сюрпризом.
 */
export function useBulk(visible: readonly RequestItem[], resetKey: string) {
  const mutation = useBulkRequests();
  const [chosen, setChosen] = useState<ReadonlySet<number>>(new Set());
  const [capped, setCapped] = useState(false);
  const [notice, setNotice] = useState<BulkNotice | null>(null);
  const [asked, setAsked] = useState<BulkRequest | null>(null);
  const [running, setRunning] = useState(false);
  // Два нажатия подряд приходят раньше перерисовки, поэтому одного `running` мало.
  const inFlight = useRef(false);

  const [prevKey, setPrevKey] = useState(resetKey);
  if (prevKey !== resetKey) {
    // Сброс при смене списка делаем прямо при отрисовке, а не в эффекте: иначе один кадр
    // показал бы панель «Выбрано N» уже над чужим списком.
    setPrevKey(resetKey);
    setChosen(new Set());
    setCapped(false);
    setNotice(null);
    setAsked(null);
  }

  const ids = visible.filter((r) => chosen.has(r.id)).map((r) => r.id);
  const firstBatch = pickFirst(visible.map((r) => r.id)).ids;
  const allSelected = firstBatch.length > 0 && firstBatch.every((id) => chosen.has(id));
  const limitReached = ids.length >= BULK_LIMIT;

  const toggle = (id: number) => {
    setNotice(null);
    setCapped(false);
    setChosen((prev) => {
      const next = new Set(prev);
      // Предел держит сам флажок (при достижении он отключён), поэтому лишней проверки здесь нет.
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setNotice(null);
    if (allSelected) {
      setChosen(new Set());
      setCapped(false);
      return;
    }
    const picked = pickFirst(visible.map((r) => r.id));
    setChosen(new Set(picked.ids));
    setCapped(picked.capped);
  };

  const clear = () => {
    setChosen(new Set());
    setCapped(false);
  };

  async function confirm() {
    if (!asked || inFlight.current || ids.length === 0) return;
    inFlight.current = true;
    setRunning(true);
    const body: BulkBody =
      asked.kind === 'assign'
        ? { ids, action: 'assign', responsible: asked.who }
        : { ids, action: 'need-call', value: asked.value };
    try {
      // Ждём перечитывания списков (оно в мутации): итог «Готово» не должен опережать то, что видно на экране.
      const out = await mutation.mutateAsync(body);
      setNotice({ kind: 'ok', text: b.done(out.done, out.skipped) });
      clear();
    } catch (e) {
      // Текст сервера показываем как есть: только он знает, что не так («не больше 100 заявок»).
      setNotice({ kind: 'error', text: e instanceof ApiError && e.message ? e.message : b.errorOther });
    } finally {
      inFlight.current = false;
      setRunning(false);
      setAsked(null);
    }
  }

  return {
    ids,
    isPicked: (id: number) => chosen.has(id),
    allSelected,
    partlySelected: ids.length > 0 && !allSelected,
    capped: capped && ids.length > 0,
    limitReached,
    notice,
    asked,
    running,
    toggle,
    toggleAll,
    clear,
    ask: (request: BulkRequest) => {
      setNotice(null);
      setAsked(request);
    },
    cancel: () => {
      if (!inFlight.current) setAsked(null);
    },
    confirm,
  };
}

export type BulkState = ReturnType<typeof useBulk>;

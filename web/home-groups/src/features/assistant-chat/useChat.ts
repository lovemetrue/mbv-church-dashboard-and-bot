import { useCallback, useRef, useState } from 'react';
import type { ChatBody, ChatHistoryView, ChatOk } from '@contracts';
import { ApiError, apiGet, apiPost } from '../../shared/api/client';
import { serverText } from '../../shared/api/serverText';
import { ru } from '../../shared/i18n/ru';
import { entriesFromHistory, type Entry } from './model';

const t = ru.chat;

/** Сервер пишет «Помощник выключен…» словами; кода для этого в контракте нет, поэтому узнаём по тексту. */
const isSwitchedOff = (e: unknown): boolean => e instanceof ApiError && e.status === 503 && /выключен/i.test(e.message);

/** Прошлый разговор: ещё не просили, грузится, показан (или его не было) и не удалось прочитать. */
export type HistoryState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Разговор с помощником. Историю хранит сервер (по логину), поэтому вопрос уходит один: прошлые сообщения сервер
 * добавит сам. На экране разговор живёт в памяти страницы: в вопросах и ответах настоящие имена, поэтому ни в
 * `localStorage`, ни в адрес они не пишутся.
 *
 * Флаги вместо одного состояния. `inFlight` (ref) нужен потому, что Enter и клик могут прийти до перерисовки:
 * `pending` из состояния ещё ложен, а запрос платный. `generation` — чтобы ни ответ, ни история, пришедшие после
 * «Очистить разговор», не появились в уже пустом разговоре.
 */
export function useChat() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [pending, setPending] = useState(false);
  const [history, setHistory] = useState<HistoryState>('idle');
  const [clearing, setClearing] = useState(false);
  /** Почему не получилось очистить разговор; экран при этом не тронут. */
  const [clearError, setClearError] = useState<string | null>(null);
  // Зеркало состояния: отправка читает актуальный разговор синхронно, без устаревшего замыкания.
  const current = useRef<Entry[]>([]);
  const inFlight = useRef(false);
  const clearingRef = useRef(false);
  const historyRef = useRef<HistoryState>('idle');
  const generation = useRef(0);
  const nextId = useRef(1);

  const commit = useCallback((next: Entry[]) => {
    current.current = next;
    setEntries(next);
  }, []);

  const markHistory = useCallback((state: HistoryState) => {
    historyRef.current = state;
    setHistory(state);
  }, []);

  /**
   * Прошлый разговор с сервера. Читается один раз за сеанс страницы, а не при каждом открытии окна: иначе экран
   * подменился бы текстом без таблиц, а таблицы только что полученных ответов пропали бы. После ошибки можно позвать снова.
   *
   * Если человек успел задать вопрос или очистить разговор, пока история шла, она опоздала: старое поверх нового
   * показывать нельзя (вопрос задвоился бы), поэтому её просто отбрасываем.
   */
  const loadHistory = useCallback(async () => {
    if (historyRef.current === 'loading' || historyRef.current === 'ready') return;
    const mine = generation.current;
    markHistory('loading');
    try {
      const view = await apiGet<ChatHistoryView>('assistant/chat/history');
      if (mine !== generation.current || current.current.length > 0) {
        markHistory('ready');
        return;
      }
      const old = entriesFromHistory(view.messages, nextId.current);
      nextId.current += old.length;
      commit(old);
      markHistory('ready');
    } catch {
      markHistory('error');
    }
  }, [commit, markHistory]);

  const request = useCallback(
    async (message: string) => {
      const mine = generation.current;
      inFlight.current = true;
      setPending(true);
      let reaction: Entry;
      try {
        const body: ChatBody = { message };
        const out = await apiPost<ChatOk>('assistant/chat', body);
        reaction = { id: nextId.current++, kind: 'answer', answer: out.answer, queries: out.queries, tables: out.tables };
      } catch (e) {
        reaction = {
          id: nextId.current++,
          kind: 'error',
          text: serverText(e, { network: t.errors.network, fallback: t.errors.other }),
          hint: isSwitchedOff(e) ? 'settings' : null,
        };
      }
      // Разговор очистили, пока шёл запрос: ответ уже никому не нужен, а флаги сброшены очисткой.
      if (mine !== generation.current) return;
      commit([...current.current, reaction]);
      inFlight.current = false;
      setPending(false);
    },
    [commit],
  );

  /** true — вопрос принят (поле можно очистить). Пустой и второй подряд вопрос не принимаются. */
  const send = useCallback(
    (raw: string): boolean => {
      const text = raw.trim();
      if (!text || inFlight.current) return false;
      commit([...current.current, { id: nextId.current++, kind: 'user', text }]);
      void request(text);
      return true;
    },
    [commit, request],
  );

  /** «Повторить»: убираем ошибку и шлём тот же вопрос, не добавляя его в разговор второй раз. */
  const retry = useCallback(() => {
    if (inFlight.current) return;
    const last = current.current[current.current.length - 1];
    if (last?.kind !== 'error') return;
    const next = current.current.slice(0, -1);
    const question = next[next.length - 1];
    if (question?.kind !== 'user') return;
    commit(next);
    void request(question.text);
  }, [commit, request]);

  /**
   * «Очистить разговор»: сначала стираем историю на сервере и только потом экран. Иначе при сбое экран был бы пуст,
   * а сервер продолжал бы помнить прошлое и подмешивать его в ответы: человек не знал бы, что помощник «помнит».
   */
  const clear = useCallback(async () => {
    if (clearingRef.current) return;
    clearingRef.current = true;
    setClearing(true);
    setClearError(null);
    try {
      await apiPost<{ ok: true }>('assistant/chat/clear', {});
    } catch (e) {
      // Слова сервера здесь не показываем: для очистки он ничего человеческого не говорит, а важно одно — разговор остался.
      setClearError(e instanceof ApiError && e.status === 0 ? t.errors.clearNetwork : t.errors.clear);
      clearingRef.current = false;
      setClearing(false);
      return;
    }
    generation.current += 1;
    inFlight.current = false;
    setPending(false);
    commit([]);
    // Очищено — значит, показывать нечего: история считается прочитанной, повторно её не просим.
    markHistory('ready');
    clearingRef.current = false;
    setClearing(false);
  }, [commit, markHistory]);

  return { entries, pending, history, clearing, clearError, loadHistory, send, retry, clear };
}

export type Chat = ReturnType<typeof useChat>;

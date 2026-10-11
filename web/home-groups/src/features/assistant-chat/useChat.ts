import { useCallback, useRef, useState } from 'react';
import type { ChatBody, ChatOk } from '@contracts';
import { ApiError, apiPost } from '../../shared/api/client';
import { serverText } from '../../shared/api/serverText';
import { ru } from '../../shared/i18n/ru';
import { toTurns, type Entry } from './model';

const t = ru.chat;

/** Сервер пишет «Помощник выключен…» словами; кода для этого в контракте нет, поэтому узнаём по тексту. */
const isSwitchedOff = (e: unknown): boolean => e instanceof ApiError && e.status === 503 && /выключен/i.test(e.message);

/**
 * Разговор с помощником. Живёт только в памяти страницы: в вопросах и ответах настоящие имена, поэтому ни в
 * `localStorage`, ни в адрес они не пишутся. Сервер историю не хранит, и каждый запрос несёт последние ходы целиком.
 *
 * Два флага вместо одного состояния. `inFlight` (ref) нужен потому, что Enter и клик могут прийти до перерисовки:
 * `pending` из состояния ещё ложен, а запрос платный. `generation` — чтобы ответ, пришедший после «Очистить
 * разговор», не появился в уже пустом разговоре.
 */
export function useChat() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [pending, setPending] = useState(false);
  // Зеркало состояния: отправка читает актуальный разговор синхронно, без устаревшего замыкания.
  const current = useRef<Entry[]>([]);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const nextId = useRef(1);

  const commit = useCallback((next: Entry[]) => {
    current.current = next;
    setEntries(next);
  }, []);

  const request = useCallback(
    async (history: Entry[]) => {
      const mine = generation.current;
      inFlight.current = true;
      setPending(true);
      let reaction: Entry;
      try {
        const body: ChatBody = { messages: toTurns(history) };
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
      const next: Entry[] = [...current.current, { id: nextId.current++, kind: 'user', text }];
      commit(next);
      void request(next);
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
    commit(next);
    void request(next);
  }, [commit, request]);

  const clear = useCallback(() => {
    generation.current += 1;
    inFlight.current = false;
    setPending(false);
    commit([]);
  }, [commit]);

  return { entries, pending, send, retry, clear };
}

export type Chat = ReturnType<typeof useChat>;

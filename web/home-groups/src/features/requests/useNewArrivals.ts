import { useCallback, useEffect, useRef, useState } from 'react';
import type { RequestItem } from '@contracts';

/** Сколько строка «Пришло новых заявок» висит сама, если её не скрыли. */
export const ARRIVALS_TTL_MS = 30_000;

const isOpen = (r: RequestItem): boolean => r.bucket !== 'done' && r.bucket !== 'cancelled';

/**
 * Заявки, появившиеся в списке после первой загрузки (бот принимает их постоянно, список
 * обновляется сам раз в минуту).
 *
 * Новыми считаем номера, которых раньше не было, а не разницу в числе: если одну заявку утвердили,
 * а другая пришла в том же обновлении, разница равна нулю, и новая заявка осталась бы незамеченной.
 * Числа копятся, пока строку не скрыли, а таймер каждый раз заводится заново.
 * Состояние выбора и открытой карточки здесь не трогаем: хук только считает.
 */
export function useNewArrivals(items: readonly RequestItem[]): { count: number; dismiss: () => void } {
  const known = useRef<Set<number> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [count, setCount] = useState(0);

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setCount(0);
  }, []);

  useEffect(() => {
    const before = known.current;
    known.current = new Set(items.map((r) => r.id));
    // Первая загрузка: всё, что уже есть, не новое.
    if (!before) return;
    const arrived = items.filter((r) => isOpen(r) && !before.has(r.id)).length;
    if (arrived === 0) return;
    setCount((c) => c + arrived);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setCount(0);
    }, ARRIVALS_TTL_MS);
  }, [items]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { count, dismiss };
}

import type { PlanEngineApi } from '../plan/types.js';
import { buildViews, type Views, type ViewsInput, type ViewsOptions } from './views.js';

export interface SnapshotOptions {
  /** Читает строки из базы. Вызывается не чаще, чем нужно (см. `ttlMs`). */
  load: () => Promise<ViewsInput>;
  engine: PlanEngineApi;
  /** Сколько миллисекунд готовый снимок считается свежим. В тестах 0 — снимок всегда пересчитывается. */
  ttlMs: number;
  views?: ViewsOptions;
  /** Часы для времени в ответах и для возраста кэша; подменяются в тестах. */
  now?: () => Date;
}

/**
 * Общий снимок на все ручки API.
 *
 * Экран открывает сразу несколько ручек (`/today`, `/requests`, `/groups`...), а план строится на
 * всю очередь разом и стоит дороже запроса к базе. Поэтому данные читаются и план считается один
 * раз, а остальные ручки берут готовое. Одновременные запросы ждут один «летящий» расчёт, а не
 * запускают каждый свой: иначе обновление страницы у нескольких служителей разом умножало бы нагрузку.
 *
 * Неудача расчёта не кэшируется: следующий запрос попробует снова.
 */
export type ViewsSource = (() => Promise<Views>) & {
  /**
   * Сбросить готовый снимок. Нужен после действия координатора: иначе он нажал «Утвердить», а
   * список ещё десять секунд показывал бы заявку как открытую.
   */
  invalidate(): void;
};

export function createViewsSource(opts: SnapshotOptions): ViewsSource {
  const now = opts.now ?? (() => new Date());
  let cached: { views: Views; startedAt: number } | null = null;
  let inflight: Promise<Views> | null = null;
  // Номер поколения: расчёт, начатый до сброса, не должен вернуть в кэш устаревший снимок.
  let generation = 0;

  const compute = async (): Promise<Views> => {
    const startedAt = now().getTime();
    const myGeneration = generation;
    const input = await opts.load();
    // Время в ответе — момент начала чтения: данные не новее него.
    const views = buildViews(input, opts.engine, new Date(startedAt), opts.views);
    if (myGeneration === generation) cached = { views, startedAt };
    return views;
  };

  const source = async (): Promise<Views> => {
    if (cached && now().getTime() - cached.startedAt < opts.ttlMs) return cached.views;
    if (inflight) return inflight;
    const mine = compute().finally(() => { if (inflight === mine) inflight = null; });
    inflight = mine;
    return mine;
  };
  return Object.assign(source, {
    invalidate: () => {
      generation += 1;
      cached = null;
      // Расчёт, который уже летит, начался до действия и мог не увидеть его: новый запрос его не ждёт.
      inflight = null;
    },
  });
}

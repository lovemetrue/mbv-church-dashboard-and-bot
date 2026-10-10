import type { Bucket, Counters } from '@contracts';

/** Подписи корзин заявок: одни и те же в чипах, плашках, подсказках. */
export const BUCKET_LABEL: Record<Bucket, string> = {
  ready: 'Готово к утверждению',
  callback: 'Перезвонить',
  human: 'Нужна помощь в сопоставлении',
  done: 'Утверждено',
  cancelled: 'Отказ',
};

/** Чипы над списком заявок: «Все» и четыре рабочие корзины. Отказы в список не приходят. */
export const LIST_BUCKETS = ['ready', 'callback', 'human', 'done'] as const satisfies readonly Bucket[];
export type ListBucket = (typeof LIST_BUCKETS)[number];

export type BucketFilter = 'all' | ListBucket;

export function isBucketFilter(v: string | null | undefined): v is BucketFilter {
  return v === 'all' || (LIST_BUCKETS as readonly string[]).includes(v ?? '');
}

/** «Открытые» — те, с которыми ещё есть что делать: счётчик на вкладке «Заявки». */
export function openCount(c: Counters): number {
  return c.ready + c.callback + c.human;
}

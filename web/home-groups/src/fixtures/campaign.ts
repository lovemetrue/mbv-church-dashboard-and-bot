/**
 * Демо-данные кампании «40 дней». Числа связаны между собой так же, как на сервере (зарегистрированных
 * поровну разложено по мессенджерам и по ответам про Малую группу), чтобы сумма в плитках не расходилась
 * с разрезами на соседних блоках.
 */
import type { CampaignView } from '@contracts';

const TOTAL = 40;
/** Дни, для которых в демо «загружен материал»: сплошной отрезок и ещё два отдельных. */
const LOADED = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16]);

export function buildCampaign(): CampaignView {
  const list = Array.from({ length: TOTAL }, (_, i) => {
    const day = i + 1;
    return { day, loaded: LOADED.has(day), length: LOADED.has(day) ? 1200 + day * 37 : 0 };
  });
  return {
    participants: { registered: 86, complete: 61, incomplete: 25, kitsIssued: 43, blocked: 4, unfinished: 17 },
    mdg: { open: 9, home: 6, join: 31, member: 22, leader: 11 },
    byPlatform: [
      { platform: 'telegram', registered: 58, complete: 42, incomplete: 16, kitsIssued: 30, blocked: 3, unfinished: 11 },
      { platform: 'max', registered: 28, complete: 19, incomplete: 9, kitsIssued: 13, blocked: 1, unfinished: 6 },
    ],
    newRequests: 14,
    days: { loaded: LOADED.size, total: TOTAL, ranges: '1–12, 15–16', list },
    day: { state: 'идёт', number: 13, total: TOTAL, startDate: '2026-09-28' },
    broadcasts: [
      { key: 'day:12', createdAt: '2026-10-10', finished: true, sent: 71, pending: 0, failed: 2, blocked: 3 },
      { key: 'day:11', createdAt: '2026-10-09', finished: true, sent: 69, pending: 0, failed: 1, blocked: 3 },
      { key: 'day:10', createdAt: '2026-10-08', finished: false, sent: 40, pending: 28, failed: 0, blocked: 2 },
    ],
  };
}

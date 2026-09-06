import { campaignDay } from '../broadcast/schedule.js';
import type { ScheduleOptions } from '../broadcast/schedule.js';
import { formatDayRanges } from '../core/dayRanges.js';
import type { PlatformName } from '../core/platform.js';
import type { CampaignRepo } from '../db/repos/campaign.repo.js';
import type { DeliveriesRepo } from '../db/repos/deliveries.repo.js';
import type { RequestsRepo } from '../db/repos/requests.repo.js';
import type { UsersRepo } from '../db/repos/users.repo.js';

/**
 * Всё, что раньше показывала команда /stats в боте, — теперь для раздела
 * «40-дневная кампания» в дашборде. Источники те же самые репозитории,
 * поэтому цифры не могут разойтись с ботом.
 */
export interface CampaignStats {
  participants: {
    registered: number;
    complete: number;
    incomplete: number;
    kitsIssued: number;
    blocked: number;
    unfinished: number;
  };
  /** Что у людей с домашней группой. */
  mdg: { open: number; home: number; join: number; member: number; leader: number };
  /** Разрез по платформам: пусто, если ещё никто не зарегистрировался. */
  byPlatform: {
    platform: PlatformName;
    registered: number;
    complete: number;
    incomplete: number;
    kitsIssued: number;
    blocked: number;
    unfinished: number;
  }[];
  newRequests: number;
  days: {
    loaded: number;
    total: number;
    /** Загруженные дни диапазонами: «1-3, 7» вместо длинного перечисления. */
    ranges: string;
    list: { day: number; loaded: boolean; length: number }[];
  };
  day: {
    state: 'до старта' | 'идёт' | 'завершена';
    number: number;
    total: number;
    startDate: string;
  };
  broadcasts: {
    key: string;
    createdAt: string;
    finished: boolean;
    sent: number;
    pending: number;
    failed: number;
    blocked: number;
  }[];
}

export interface CampaignStatsDeps {
  users: UsersRepo;
  requests: RequestsRepo;
  campaign: CampaignRepo;
  deliveries: DeliveriesRepo;
}

export async function campaignStats(
  deps: CampaignStatsDeps,
  schedule: ScheduleOptions,
  now = new Date(),
): Promise<CampaignStats> {
  const rows = await deps.users.stats();
  const newRequests = await deps.requests.countNew();
  const loadedDays = await deps.campaign.listDays();
  const recent = await deps.deliveries.recent(10);

  const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + pick(r), 0);

  const day = campaignDay(now, schedule);
  const total = schedule.totalDays;
  const state = day < 1 ? 'до старта' : day > total ? 'завершена' : 'идёт';

  const loaded = new Map(loadedDays.map((d) => [d.day, d.length]));

  return {
    participants: {
      registered: sum((r) => r.registered),
      complete: sum((r) => r.complete),
      incomplete: sum((r) => r.incomplete),
      kitsIssued: sum((r) => r.kits_issued),
      blocked: sum((r) => r.blocked),
      unfinished: sum((r) => r.unfinished),
    },
    mdg: {
      open: sum((r) => r.mdg_open),
      home: sum((r) => r.mdg_home),
      join: sum((r) => r.mdg_join),
      member: sum((r) => r.mdg_member),
      leader: sum((r) => r.mdg_leader),
    },
    byPlatform: rows.map((r) => ({
      platform: r.platform,
      registered: r.registered,
      complete: r.complete,
      incomplete: r.incomplete,
      kitsIssued: r.kits_issued,
      blocked: r.blocked,
      unfinished: r.unfinished,
    })),
    newRequests,
    days: {
      loaded: loadedDays.length,
      total,
      ranges: formatDayRanges(loadedDays.map((d) => d.day)),
      // Все сорок дней, чтобы было видно и пропуски, а не только загруженное.
      list: Array.from({ length: total }, (_, i) => ({
        day: i + 1,
        loaded: loaded.has(i + 1),
        length: loaded.get(i + 1) ?? 0,
      })),
    },
    day: { state, number: day, total, startDate: schedule.startDate },
    broadcasts: recent.map((b) => ({
      key: b.key,
      createdAt: b.created_at.toISOString().slice(0, 10),
      finished: b.finished,
      sent: b.sent,
      pending: b.pending,
      failed: b.failed,
      blocked: b.blocked,
    })),
  };
}

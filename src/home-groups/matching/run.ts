import { SETTING_NOTIFY } from '../../db/repos/placementNotices.repo.js';
import type { ActionOutcome, PlacementRepo } from '../../db/repos/placement.repo.js';
import type { SettingsRepo } from '../../db/repos/settings.repo.js';
import { buildViewsWithPlan, type ViewsInput, type ViewsOptions } from '../api/views.js';
import type { MatchingRunOk, MatchingStatus } from '../contracts.js';
import type { PlanEngineApi } from '../plan/types.js';

export const SETTING_AUTO = 'matching.auto';
export const SETTING_LAST_RUN = 'matching.last_run';

export interface MatchingDeps {
  /** Читает всё, что нужно расчёту, включая уже накопленные предложения (они закрепляют выбор). */
  load: () => Promise<ViewsInput>;
  engine: PlanEngineApi;
  placement: Pick<PlacementRepo, 'syncProposals' | 'resetProposals'>;
  settings: Pick<SettingsRepo, 'get' | 'set'>;
  options?: ViewsOptions;
  now?: () => Date;
  /** Сбросить общий снимок: после запуска список должен показать новые предложения сразу. */
  invalidate: () => void;
}

/**
 * Подбор для новых заявок: считает план и сохраняет его в «предварительно». Сохранённое не
 * переписывается, пока группа доступна: новые заявки подбираются вокруг уже предложенных
 * (движок обрабатывает закреплённые первыми). Заявку это не меняет — утверждает человек.
 */
export function createMatching(deps: MatchingDeps) {
  const now = deps.now ?? (() => new Date());

  return {
    /** `scope` — только эти заявки («подобрать заново» одной): остальные закреплённые предложения не трогаются. */
    async run(actor: string, scope?: ReadonlySet<number>): Promise<MatchingRunOk> {
      const input = await deps.load();
      const { plan, openRequestIds, signatures, snapshots, openGroupIds } = buildViewsWithPlan(input, deps.engine, now(), deps.options);

      const desired = [];
      for (const requestId of openRequestIds) {
        if (scope && !scope.has(requestId)) continue;
        const entry = plan.entries.get(requestId);
        if (entry?.kind !== 'proposal') continue;
        desired.push({
          requestId,
          groupId: entry.main.groupId,
          confidence: entry.confidence,
          rationale: entry.main.reasons,
          inputHash: signatures.get(requestId)!,
          inputSnapshot: snapshots.get(requestId)!,
        });
      }

      const result = await deps.placement.syncProposals(desired, actor, scope, { openGroupIds, signatures });
      const lastRun: NonNullable<MatchingStatus['lastRun']> = {
        at: now().toISOString(), created: result.created, replaced: result.replaced, actor,
      };
      await deps.settings.set(SETTING_LAST_RUN, lastRun, actor);
      deps.invalidate();
      return { ok: true, ...result };
    },

    /** «Подобрать заново» одной заявки: прежнее закреплённое предложение снимается, группа считается по текущим данным. */
    async rematch(requestId: number, actor: string): Promise<ActionOutcome> {
      const reset = await deps.placement.resetProposals(requestId, actor);
      if (!reset.ok) return reset;
      await this.run(actor, new Set([requestId]));
      return { ok: true };
    },

    /** Пересчитать все закреплённые предложения открытых заявок с нуля. Утверждённые не меняются. */
    async rerunAll(actor: string): Promise<MatchingRunOk> {
      await deps.placement.resetProposals(null, actor);
      return this.run(actor);
    },

    async setAuto(enabled: boolean, actor: string): Promise<void> {
      await deps.settings.set(SETTING_AUTO, enabled, actor);
      deps.invalidate();
    },

    /** «Писать в MAX при утверждении»: читает само утверждение (`enqueuePlacementNotices`), здесь только переключатель. */
    async setNotify(enabled: boolean, actor: string): Promise<void> {
      await deps.settings.set(SETTING_NOTIFY, enabled, actor);
      deps.invalidate();
    },

    async isAuto(): Promise<boolean> {
      return (await deps.settings.get<boolean>(SETTING_AUTO)) === true;
    },
  };
}

export type Matching = ReturnType<typeof createMatching>;

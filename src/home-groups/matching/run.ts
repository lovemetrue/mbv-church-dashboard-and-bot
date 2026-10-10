import type { PlacementRepo } from '../../db/repos/placement.repo.js';
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
  placement: Pick<PlacementRepo, 'syncProposals'>;
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
    async run(actor: string): Promise<MatchingRunOk> {
      const input = await deps.load();
      const { plan, openRequestIds } = buildViewsWithPlan(input, deps.engine, now(), deps.options);

      const desired = [];
      for (const requestId of openRequestIds) {
        const entry = plan.entries.get(requestId);
        if (entry?.kind !== 'proposal') continue;
        desired.push({
          requestId,
          groupId: entry.main.groupId,
          confidence: entry.confidence,
          rationale: entry.main.reasons,
        });
      }

      const result = await deps.placement.syncProposals(desired, actor);
      const lastRun: NonNullable<MatchingStatus['lastRun']> = {
        at: now().toISOString(), created: result.created, replaced: result.replaced, actor,
      };
      await deps.settings.set(SETTING_LAST_RUN, lastRun, actor);
      deps.invalidate();
      return { ok: true, ...result };
    },

    async setAuto(enabled: boolean, actor: string): Promise<void> {
      await deps.settings.set(SETTING_AUTO, enabled, actor);
      deps.invalidate();
    },

    async isAuto(): Promise<boolean> {
      return (await deps.settings.get<boolean>(SETTING_AUTO)) === true;
    },
  };
}

export type Matching = ReturnType<typeof createMatching>;

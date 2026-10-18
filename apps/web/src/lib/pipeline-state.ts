import type { AnalysisTask, Model, ModelStage } from '@analyzr/client';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { analysesQuery } from './queries';

/**
 * Where the models stand in the analysis pipeline (UX1's „Als Nächstes“ and
 * the status lines of „Relationen › Zu prüfen“, UX5): the models waiting for
 * an agent, those whose analysis failed, those whose reservation expired
 * (nothing runs on a timer: until an agent asks for work again, an expired
 * reservation still says „Agent arbeitet“), and how many run. The claimed and
 * failed tasks load only when a model is in that stage.
 */
export interface PipelineState {
  waiting: string[];
  failed: string[];
  expired: string[];
  /** Models in `agent_working` with a running reservation. */
  working: number;
  /** The claimed or failed task of a model, for its holder and reservation. */
  taskOf: ReadonlyMap<string, AnalysisTask>;
}

export function usePipelineState(
  project: string,
  models: readonly Pick<Model, 'key' | 'stage'>[],
): PipelineState {
  const working = models.some((m) => m.stage === 'agent_working');
  const failing = models.some((m) => m.stage === 'agent_failed');
  const claimed = useQuery({ ...analysesQuery(project, 'claimed'), enabled: working });
  const failed = useQuery({ ...analysesQuery(project, 'failed'), enabled: failing });
  return useMemo(() => {
    const taskOf = new Map<string, AnalysisTask>();
    for (const t of [...(claimed.data ?? []), ...(failed.data ?? [])])
      if (t.modelKey !== null && !taskOf.has(t.modelKey)) taskOf.set(t.modelKey, t);
    const expired = new Set<string>();
    for (const t of claimed.data ?? [])
      if (
        t.modelKey !== null &&
        t.leaseUntil !== null &&
        Date.parse(t.leaseUntil) < claimed.dataUpdatedAt
      )
        expired.add(t.modelKey);
    const keysIn = (s: ModelStage) => models.filter((m) => m.stage === s).map((m) => m.key);
    const agentWorking = keysIn('agent_working');
    return {
      waiting: keysIn('waiting_for_agent'),
      failed: keysIn('agent_failed'),
      expired: agentWorking.filter((k) => expired.has(k)),
      working: agentWorking.filter((k) => !expired.has(k)).length,
      taskOf,
    };
  }, [models, claimed.data, claimed.dataUpdatedAt, failed.data]);
}

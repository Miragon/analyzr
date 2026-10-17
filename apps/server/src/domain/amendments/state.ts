/**
 * The state of model amendments (M6 §4.8 c "Revisions"): a live amendment's
 * state is its outcome in its model's head plan (`source.amendments`), an
 * ended one's its withdrawal reason; `modelDeleted` marks those of a deleted
 * model. Loaders read the head plans in the caller's transaction.
 */
import type {
  AmendmentConflictReason,
  AmendmentPlanEntry,
  AmendmentState,
  ModelAmendment,
  ModelId,
  ProjectId,
} from '@analyzr/contracts';

import type { ModelAmendments } from '../open-questions/model.ts';
import type { StoredModelAmendment, Tx } from '../ports.ts';
import { planOf, uploadedOf } from './derive.ts';
import { liveAmendments } from './plan.ts';

const iso = (d: Date): string => d.toISOString();

/** The plan entries of a head by amendment id. */
export type HeadPlan = ReadonlyMap<string, AmendmentPlanEntry>;

/** An amendment's state and, for a conflict, its reason. */
export function amendmentState(
  a: StoredModelAmendment,
  plan: HeadPlan | undefined,
): { state: AmendmentState; conflict: AmendmentConflictReason | null } {
  if (a.withdrawal) return { state: a.withdrawal.reason, conflict: null };
  const entry = plan?.get(a.id);
  // Every derivation lists every live amendment; a missing entry is not applied anyway.
  if (!entry) return { state: 'conflict', conflict: 'element-missing' };
  return { state: entry.outcome, conflict: entry.reason ?? null };
}

/** An amendment as the API shows it. */
export function toModelAmendment(
  a: StoredModelAmendment,
  plan: HeadPlan | undefined,
): ModelAmendment {
  const { state, conflict } = amendmentState(a, plan);
  return {
    id: a.id,
    modelId: a.modelId,
    modelKey: a.modelKey,
    elementId: a.elementId,
    viaElementId: a.viaElementId,
    op: a.op,
    before: a.before,
    after: a.after,
    baseRevisionId: a.baseRevisionId,
    supersedesId: a.supersedesId,
    by: a.handle,
    sourceKind: 'human',
    seq: a.seq,
    at: iso(a.createdAt),
    state,
    conflict,
    modelDeleted: a.modelDeletedSeq !== null,
    withdrawal: a.withdrawal
      ? {
          reason: a.withdrawal.reason,
          by: a.withdrawal.handle,
          seq: a.withdrawal.seq,
          at: iso(a.withdrawal.createdAt),
        }
      : null,
  };
}

/**
 * The head plans of these models (a deleted model's last head included), by
 * model id.
 */
export async function headPlans(
  tx: Tx,
  projectId: ProjectId,
  modelIds: Iterable<ModelId>,
): Promise<Map<ModelId, HeadPlan>> {
  const out = new Map<ModelId, HeadPlan>();
  for (const id of new Set(modelIds)) {
    const model = await tx.models.findIncludingDeleted(projectId, id);
    if (!model?.headRevisionId) continue;
    const head = await tx.revisions.findInProject(projectId, id, model.headRevisionId);
    out.set(id, new Map(planOf(head).map((e) => [e.id as string, e])));
  }
  return out;
}

/** Every amendment as the API shows it, oldest first. */
export async function amendmentViews(
  tx: Tx,
  projectId: ProjectId,
  stored: readonly StoredModelAmendment[],
): Promise<ModelAmendment[]> {
  const plans = await headPlans(
    tx,
    projectId,
    stored.map((a) => a.modelId),
  );
  return stored.map((a) => toModelAmendment(a, plans.get(a.modelId)));
}

/**
 * The live models with live amendments, as the open-questions read model
 * reads them, by model key: the uploaded revision the head is computed
 * from, the head's plan and the live amendments in seq order.
 */
export async function readModelAmendments(
  tx: Tx,
  projectId: ProjectId,
): Promise<Map<string, ModelAmendments>> {
  const byModel = new Map<ModelId, StoredModelAmendment[]>();
  for (const a of await tx.amendments.list(projectId)) {
    if (a.modelDeletedSeq !== null) continue;
    const list = byModel.get(a.modelId) ?? [];
    list.push(a);
    byModel.set(a.modelId, list);
  }
  const out = new Map<string, ModelAmendments>();
  for (const [modelId, stored] of byModel) {
    const live = liveAmendments(stored);
    if (live.length === 0) continue;
    const model = await tx.models.findInProject(projectId, modelId);
    if (!model?.headRevisionId) continue;
    const head = await tx.revisions.findInProject(projectId, modelId, model.headRevisionId);
    if (!head) continue;
    out.set(model.key, {
      uploadedRevisionId: uploadedOf(head).revisionId,
      plan: planOf(head),
      live: live.map(({ seq: _seq, ...a }) => a),
    });
  }
  return out;
}

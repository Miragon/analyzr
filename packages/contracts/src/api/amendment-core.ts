/**
 * The core of model amendments (M6 §4.8 c, decision 25, slice S5c-2): the
 * operations, the plan a head carries and the counts of the import and PUT
 * results. A leaf module, so `models.ts` (the revision's `source`) and
 * `open-questions.ts` (the `amend` action) import it, and `amendments.ts`
 * (the routes' views, bodies and results) imports all three.
 */
import { z } from 'zod';

import { ModelAmendmentId, RevisionId } from '../ids.ts';
import { Sha256Hex } from './common.ts';

/**
 * The v1 operations of a model amendment: only the fields open questions
 * name (decision 25.1):
 * - `call-target`: the target of a call activity (the field `Extraction.call`
 *   reads: C7 `calledElement`, C8 `zeebe:calledElement processId`);
 * - `message-name`: the name of the `bpmn:message` or `bpmn:signal` an
 *   endpoint references (every endpoint referencing it changes with it), or,
 *   for an endpoint without a reference, a new message or signal it then
 *   references;
 * - `event-name`: the name of a start or end event;
 * - `process-documentation`: the documentation of a process that has none.
 */
export const AmendmentOp = z
  .enum(['call-target', 'message-name', 'event-name', 'process-documentation'])
  .meta({ id: 'AmendmentOp', description: 'Operation of a model amendment.' });
export type AmendmentOp = z.infer<typeof AmendmentOp>;

/** Most amendments one request records (and an `amend` action's targets). */
export const MAX_AMENDMENT_ITEMS = 20;

/**
 * Where a live amendment stands against the uploaded revision its head is
 * computed from (M6 §4.8 c "Re-import"): `applied` (spliced into the
 * amended head), `in-source` (the source tool took the value over:
 * „im Quellsystem übernommen“; nothing to splice) or `conflict` (not
 * applied, stays live: „Ergänzung nicht mehr anwendbar“).
 */
export const AmendmentOutcome = z
  .enum(['applied', 'in-source', 'conflict'])
  .meta({ id: 'AmendmentOutcome', description: 'Where a live amendment stands on the head.' });
export type AmendmentOutcome = z.infer<typeof AmendmentOutcome>;

/**
 * Why a live amendment is in conflict: the element is gone, is no longer
 * of the op's kind or can no longer be written (`element-missing`), the
 * source tool now writes an expression there (`expression`; only the
 * withdrawal is offered), or the source tool changed the value
 * (`value-changed`: never overwritten, asked about).
 */
export const AmendmentConflictReason = z
  .enum(['element-missing', 'value-changed', 'expression'])
  .meta({ id: 'AmendmentConflictReason', description: 'Why a live amendment is in conflict.' });
export type AmendmentConflictReason = z.infer<typeof AmendmentConflictReason>;

/**
 * One live amendment as the head's `source.amendments` lists it: ids and
 * the outcome, never values (values are model content, they stay in the
 * amendment rows and the revision's bytes).
 */
export const AmendmentPlanEntry = z
  .object({
    id: ModelAmendmentId,
    /** The element whose field is written (for `message-name` the message or signal). */
    elementId: z.string(),
    op: AmendmentOp,
    outcome: AmendmentOutcome,
    /** Set for `conflict`. */
    reason: AmendmentConflictReason.optional(),
  })
  .meta({ id: 'AmendmentPlanEntry', description: 'A live amendment and its outcome on the head.' });
export type AmendmentPlanEntry = z.infer<typeof AmendmentPlanEntry>;

/** The uploaded revision an amended revision is computed from (`source.upstream`). */
export const RevisionUpstream = z
  .object({
    revisionId: RevisionId,
    rev: z.number().int().min(1),
    contentHash: Sha256Hex,
  })
  .meta({
    id: 'RevisionUpstream',
    description: 'The uploaded revision an amended revision is computed from.',
  });
export type RevisionUpstream = z.infer<typeof RevisionUpstream>;

/** Most amendment ids an import or PUT result lists per outcome. */
export const MAX_RESULT_AMENDMENT_IDS = 20;

const amendmentGroup = z.object({
  count: z.number().int().min(0),
  /** The first {@link MAX_RESULT_AMENDMENT_IDS}, in seq order. */
  ids: z.array(ModelAmendmentId).max(MAX_RESULT_AMENDMENT_IDS),
});

/**
 * What became of a model's live amendments at an upload (M6 §4.8 c
 * "Re-import"): applied to the incoming bytes, taken over by the source tool
 * (`inSource`) or in conflict. Present in an import or PUT result only for a
 * model with live amendments, so results of models without any keep their
 * shape.
 */
export const AmendmentCounts = z
  .object({
    applied: amendmentGroup,
    inSource: amendmentGroup,
    conflicts: amendmentGroup,
  })
  .meta({ id: 'AmendmentCounts', description: "What became of a model's live amendments." });
export type AmendmentCounts = z.infer<typeof AmendmentCounts>;

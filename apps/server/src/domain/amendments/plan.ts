/**
 * Where live model amendments stand against an uploaded revision (M6 §4.8 c
 * "Re-import"), pure: `planAmendments` compares each live amendment with
 * what `readAmendable` reads from the uploaded bytes, values in the
 * extractor's sanitized form. Every derivation of a head (an amendment, a
 * withdrawal, a re-import, a revival) plans against the uploaded revision
 * and splices exactly the amendments the plan marks `applied`.
 */
import {
  MAX_RESULT_AMENDMENT_IDS,
  type AmendmentConflictReason,
  type AmendmentCounts,
  type AmendmentOp,
  type AmendmentOutcome,
  type AmendmentPlanEntry,
  type ModelAmendmentId,
} from '@analyzr/contracts';

import type { AmendableDocument, StoredModelAmendment } from '../ports.ts';

/** A live amendment as planning and splicing need it. */
export interface LiveAmendment {
  id: ModelAmendmentId;
  elementId: string;
  viaElementId: string | null;
  op: AmendmentOp;
  before: string | null;
  after: string;
  seq: number;
}

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The live amendments (no withdrawal row) among `stored`, in seq order. */
export function liveAmendments(stored: readonly StoredModelAmendment[]): LiveAmendment[] {
  return stored
    .filter((a) => a.withdrawal === null)
    .sort((a, b) => a.seq - b.seq || byCodePoint(a.id, b.id))
    .map((a) => ({
      id: a.id,
      elementId: a.elementId,
      viaElementId: a.viaElementId,
      op: a.op,
      before: a.before,
      after: a.after,
      seq: a.seq,
    }));
}

/**
 * The concurrency token of a model's amendment set (M6 §4.8 c
 * "Concurrency"): the sorted live ids and the highest amendment or
 * withdrawal seq. Ingest plans outside its transaction and plans again
 * inside it when the token changed.
 */
export function amendmentToken(stored: readonly StoredModelAmendment[]): string {
  const live = stored
    .filter((a) => a.withdrawal === null)
    .map((a) => a.id)
    .sort(byCodePoint);
  let seq = 0;
  for (const a of stored) seq = Math.max(seq, a.seq, a.withdrawal?.seq ?? 0);
  return `${live.join(',')}|${seq}`;
}

/** Values compare as facts read them: no call target (`''`) and no name (`null`) are both empty. */
export function sameValue(a: string | null, b: string | null): boolean {
  return (a ?? '') === (b ?? '');
}

const fieldKey = (op: AmendmentOp, elementId: string): string => `${op}\u0000${elementId}`;

function entry(
  a: LiveAmendment,
  outcome: AmendmentOutcome,
  reason?: AmendmentConflictReason,
): AmendmentPlanEntry {
  return {
    id: a.id,
    elementId: a.elementId,
    op: a.op,
    outcome,
    ...(reason === undefined ? {} : { reason }),
  };
}

/**
 * Plans each live amendment (in seq order) against an uploaded revision:
 * - the element is missing, no longer of the op's kind, or can no longer be
 *   written (the field is blocked for another reason than an expression):
 *   conflict `element-missing`; a name keyed by an endpoint that now
 *   references a message or signal compares that name (`in-source`,
 *   `expression`, `value-changed`, else `element-missing`);
 * - a call target or name that is now an expression: conflict `expression`;
 * - `process-documentation`: the process has any documentation: `in-source`
 *   (the op never replaces the tool's text, so it never conflicts);
 * - the value equals `after`: `in-source` („im Quellsystem übernommen“);
 * - the value equals `before`: `applied`;
 * - any other value: conflict `value-changed` (never overwritten).
 */
export function planAmendments(
  live: readonly LiveAmendment[],
  doc: AmendableDocument,
): AmendmentPlanEntry[] {
  const fields = new Map(doc.fields.map((f) => [fieldKey(f.op, f.elementId), f]));
  const endpoints = new Map(doc.endpoints.map((e) => [e.elementId, e]));
  return live.map((a) => {
    const field = fields.get(fieldKey(a.op, a.elementId));
    if (field === undefined) {
      // A name keyed by an endpoint that now references a message or signal: the tool
      // took the name over, or changed it; the old splice no longer fits either way.
      const ep = a.op === 'message-name' ? endpoints.get(a.elementId) : undefined;
      if (ep === undefined) return entry(a, 'conflict', 'element-missing');
      if (ep.expression) return entry(a, 'conflict', 'expression');
      if (sameValue(ep.name, a.after)) return entry(a, 'in-source');
      return entry(
        a,
        'conflict',
        sameValue(ep.name, a.before) ? 'element-missing' : 'value-changed',
      );
    }
    if ((a.op === 'call-target' || a.op === 'message-name') && field.expression) {
      return entry(a, 'conflict', 'expression');
    }
    if (a.op === 'process-documentation') {
      if (field.value !== null) return entry(a, 'in-source');
      return field.blocked === null ? entry(a, 'applied') : entry(a, 'conflict', 'element-missing');
    }
    if (sameValue(field.value, a.after)) return entry(a, 'in-source');
    if (field.blocked !== null) {
      return entry(
        a,
        'conflict',
        field.blocked.reason === 'expression' ? 'expression' : 'element-missing',
      );
    }
    if (sameValue(field.value, a.before)) return entry(a, 'applied');
    return entry(a, 'conflict', 'value-changed');
  });
}

/** The import and PUT results' counts of a plan (at most 20 ids per outcome, in seq order). */
export function planCounts(plan: readonly AmendmentPlanEntry[]): AmendmentCounts {
  const group = (outcome: AmendmentOutcome) => {
    const ids = plan.filter((e) => e.outcome === outcome).map((e) => e.id);
    return { count: ids.length, ids: ids.slice(0, MAX_RESULT_AMENDMENT_IDS) };
  };
  return { applied: group('applied'), inSource: group('in-source'), conflicts: group('conflict') };
}

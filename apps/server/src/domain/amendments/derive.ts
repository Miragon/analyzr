/**
 * Deriving a model's head from its uploaded revision (M6 §4.8 c
 * "Revisions"): plan every live amendment against the uploaded bytes, splice
 * exactly the ones the plan marks `applied` (byte-preserving, through
 * `AnalysisPort.amend`), and extract the result. An amended revision is
 * always computed from the uploaded revision, never from the previous head:
 * a withdrawal is a derivation without it, a re-import re-applies the same
 * list, and an amendment in conflict is never forced onto bytes it no longer
 * fits. Pure but for the port.
 */
import type { AmendmentPlanEntry, ModelAmendmentId, RevisionUpstream } from '@analyzr/contracts';

import type {
  AmendableDocument,
  AnalysisPort,
  Extracted,
  LibraryAmendmentOutcome,
  RevisionRecord,
} from '../ports.ts';
import { planAmendments, type LiveAmendment } from './plan.ts';

/** Why the library refused an amendment the plan marked `applied`. */
export type LibraryRefusal = Extract<LibraryAmendmentOutcome, { status: 'refused' }>;

/** A head derived from an uploaded revision. */
export interface Derivation {
  /** Every live amendment with its outcome, in seq order (the head's `source.amendments`). */
  plan: AmendmentPlanEntry[];
  /**
   * Amendments the plan marked `applied` that the library refused (their
   * check failed): conflicts `element-missing` in the plan, with the reason.
   */
  refusals: ReadonlyMap<ModelAmendmentId, LibraryRefusal>;
  /** The derived bytes: the uploaded bytes when nothing applies. */
  xml: Uint8Array;
  extracted: Extracted;
  /** How many amendments were spliced. */
  applied: number;
  /** What `readAmendable` read from the uploaded bytes. */
  uploaded: AmendableDocument;
}

/** An internal error: bytes that were extracted before are refused now (a bug). */
function unreadable(what: string, modelKey: string, message: string): Error {
  return new Error(`${what} of ${modelKey} failed on stored bytes: ${message}`);
}

/**
 * Derives the head of a model from its uploaded revision's bytes with the
 * live amendments (in seq order). `extracted` (the uploaded bytes' facts)
 * saves an extraction when nothing applies.
 *
 * @throws {Error} when bytes that passed extraction are refused now (a bug)
 */
export async function deriveHead(
  analysis: Pick<AnalysisPort, 'readAmendable' | 'amend' | 'extract'>,
  bytes: Uint8Array,
  modelKey: string,
  live: readonly LiveAmendment[],
  extracted?: Extracted,
): Promise<Derivation> {
  const doc = await analysis.readAmendable(bytes, modelKey);
  if (!doc.ok) throw unreadable('readAmendable', modelKey, doc.error.message);
  const planned = planAmendments(live, doc.value);
  const toApply = live.filter((_, i) => planned[i]?.outcome === 'applied');
  if (toApply.length === 0) {
    const facts = extracted ?? (await extractOrThrow(analysis, bytes, modelKey));
    return {
      plan: planned,
      refusals: new Map(),
      xml: bytes,
      extracted: facts,
      applied: 0,
      uploaded: doc.value,
    };
  }
  const amended = await analysis.amend(
    bytes,
    toApply.map((a) => ({ id: a.id, elementId: a.elementId, op: a.op, after: a.after })),
    modelKey,
  );
  if (!amended.ok) throw unreadable('amend', modelKey, amended.error.message);
  const refusals = new Map<ModelAmendmentId, LibraryRefusal>();
  for (const o of amended.value.outcomes) {
    if (o.status === 'refused') refusals.set(o.id as ModelAmendmentId, o);
  }
  const plan = planned.map((e): AmendmentPlanEntry =>
    refusals.has(e.id) ? { ...e, outcome: 'conflict', reason: 'element-missing' } : e,
  );
  return {
    plan,
    refusals,
    xml: amended.value.xml,
    extracted: amended.value.extracted,
    applied: toApply.length - refusals.size,
    uploaded: doc.value,
  };
}

async function extractOrThrow(
  analysis: Pick<AnalysisPort, 'extract'>,
  bytes: Uint8Array,
  modelKey: string,
): Promise<Extracted> {
  const out = await analysis.extract(bytes, modelKey);
  if (!out.ok) throw unreadable('extract', modelKey, out.error.message);
  return out.value;
}

/**
 * The uploaded revision a head is computed from: `source.upstream` of an
 * amended head, else the head itself.
 */
export function uploadedOf(head: RevisionRecord): RevisionUpstream {
  const upstream = head.source.upstream;
  return upstream ?? { revisionId: head.id, rev: head.rev, contentHash: head.contentHash };
}

/** The plan a head carries (`source.amendments`), empty without one. */
export function planOf(head: Pick<RevisionRecord, 'source'> | null): AmendmentPlanEntry[] {
  return [...(head?.source?.amendments ?? [])];
}

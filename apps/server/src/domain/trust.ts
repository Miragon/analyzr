/**
 * The trust rule (M6 S2c, owner decisions 24.2, 25.2 and 28), pure: every
 * uploaded revision gets a trust class at ingest ({@link trustOf}), stored
 * by the server as `source.trust`; a model reads its uploaded revision's
 * ({@link modelTrust}: an amended head's `upstream`, a revision stored before
 * S2c none, which counts as modelled, decision 24.2 (a)); and the rule tier's
 * acceptance of a unique static call stands only for a modelled caller
 * ({@link applyTrust}): from a derived one it becomes a rule proposal, tier
 * `key`, {@link DERIVED_CALL_CONFIDENCE}, marked `attrs.match`
 * `derived-caller`, with a German rationale. A call element whose
 * call-target amendment is applied, or taken over by the source tool
 * (`in-source`, decision 28 Q2), counts as modelled whatever the class
 * (decision 25.2). Only the caller's class counts.
 */
import {
  DERIVED_CALL_CONFIDENCE,
  DERIVED_CALLER_MATCH,
  TRUST_REASON_LABELS,
  parseRef,
  type AmendmentPlanEntry,
  type DerivedKind,
  type DerivedRelation,
  type Engine,
  type ImportWarning,
  type ModelTrustSummary,
  type RevisionSource,
  type RevisionTrust,
  type TrustReason,
} from '@analyzr/contracts';

import type { HeadTrustRow, RelationRecord, RuleOutput } from './ports.ts';

/**
 * The trust class of an uploaded revision (decision 24.2): `modelled` when
 * the file targets Camunda 7 or 8, a human uploaded it and its manifest
 * declares no derivation or `export`; `derived` otherwise, with its reasons
 * in {@link TrustReason}'s order. A missing `uploader` counts as an agent's
 * (it can only lower trust; every revision since S2a has one).
 */
export function trustOf(
  engine: Engine | null,
  source: Pick<RevisionSource, 'uploader' | 'derived'>,
): RevisionTrust {
  const reasons: TrustReason[] = [];
  if (engine === null) reasons.push('no-engine');
  if (source.uploader !== 'human') reasons.push('agent-upload');
  const kind = source.derived?.kind;
  if (kind === 'converted' || kind === 'reconstructed' || kind === 'as-told') reasons.push(kind);
  return { class: reasons.length === 0 ? 'modelled' : 'derived', reasons };
}

/** A class in English for a warning: `modelled`, `derived (no-engine, agent-upload)`. */
function classText(trust: RevisionTrust): string {
  return trust.class === 'derived' ? `derived (${trust.reasons.join(', ')})` : trust.class;
}

/**
 * `trust-kept` (M6 S2c) for an unchanged file: analyzr keeps the class of
 * the model's uploaded revision (`stored`; `null` stored before S2c, which
 * counts as modelled), while this request would give the file another
 * class (`incoming`); `null` when the classes agree.
 */
export function trustKeptWarning(
  stored: RevisionTrust | null,
  incoming: RevisionTrust,
): ImportWarning | null {
  const kept = stored ?? { class: 'modelled', reasons: [] };
  if (kept.class === incoming.class) return null;
  const legacy = stored === null ? ' (stored before the trust rule)' : '';
  return {
    code: 'trust-kept',
    message:
      `unchanged, so analyzr keeps the model's trust class ${classText(kept)}${legacy}; ` +
      `this request would make it ${classText(incoming)}; a reclassification needs changed bytes`,
  };
}

/** What the trust rule knows of a live model. */
export interface ModelTrust {
  /** The uploaded revision's class; `null` stored before S2c (counts as modelled). */
  trust: RevisionTrust | null;
  /** Call elements whose call-target amendment is `applied` or `in-source` (decisions 25.2, 28). */
  modelledCalls: ReadonlySet<string>;
  /** Call elements whose call-target amendment is in `conflict`. */
  conflictedCalls: ReadonlySet<string>;
  /** `derived.kind` of the uploaded revision; `null` when none is declared. */
  derivedKind: DerivedKind | null;
  /** `derived.converter` of the uploaded revision; `null` when none is declared. */
  converter: string | null;
  /** The uploaded revision's engine (a legacy signal for revisions stored before S2c). */
  engine: Engine | null;
  /** Who uploaded it: `source.uploader`, else by the principal's kind (stored before S2a). */
  uploader: 'human' | 'agent';
}

/** A model's call elements by the outcome of their call-target amendments in a plan. */
export function callTargets(plan: readonly AmendmentPlanEntry[]): {
  modelledCalls: Set<string>;
  conflictedCalls: Set<string>;
} {
  const modelledCalls = new Set<string>();
  const conflictedCalls = new Set<string>();
  for (const e of plan) {
    if (e.op !== 'call-target') continue;
    if (e.outcome === 'applied' || e.outcome === 'in-source') modelledCalls.add(e.elementId);
    else if (e.outcome === 'conflict') conflictedCalls.add(e.elementId);
  }
  return { modelledCalls, conflictedCalls };
}

/** The source of a model's uploaded revision: an amended head's `upstream`, else the head. */
function uploadedSourceOf(head: RevisionSource, upstream: RevisionSource | null) {
  return head.kind === 'amendment' ? upstream : head;
}

/**
 * The trust of a live model ({@link ModelTrust}): its uploaded revision's
 * class (an amended head's own uploader never counts), the call elements of
 * its head's plan, the declared derivation and the legacy signals.
 */
export function modelTrust(row: HeadTrustRow): ModelTrust {
  const uploaded = uploadedSourceOf(row.head, row.upstream);
  return {
    trust: uploaded?.trust ?? null,
    ...callTargets(row.head.amendments ?? []),
    derivedKind: uploaded?.derived?.kind ?? null,
    converter: uploaded?.derived?.converter ?? null,
    engine: row.engine,
    uploader: uploaded?.uploader ?? (row.uploaderPrincipalKind === 'service' ? 'agent' : 'human'),
  };
}

/** The trust of every live model by key, from `RevisionRepo.headTrustRows`. */
export function trustByModel(rows: readonly HeadTrustRow[]): Map<string, ModelTrust> {
  return new Map(rows.map((r) => [r.key, modelTrust(r)]));
}

/** `Model.trust` (M6 S2c): the uploaded revision's class with its derivation; `null` before S2c. */
export function trustSummary(
  head: RevisionSource,
  upstream: RevisionSource | null,
): ModelTrustSummary | null {
  const uploaded = uploadedSourceOf(head, upstream);
  if (!uploaded?.trust) return null;
  return {
    class: uploaded.trust.class,
    reasons: uploaded.trust.reasons,
    derivedKind: uploaded.derived?.kind ?? null,
    converter: uploaded.derived?.converter ?? null,
  };
}

/** The reasons as one German phrase: „ohne Camunda-Engine; über ein Agenten-Token hochgeladen“. */
export function trustReasonsText(reasons: readonly TrustReason[]): string {
  return reasons.map((r) => TRUST_REASON_LABELS[r]).join('; ');
}

/**
 * The rationale of the rule tier's proposal of a unique call from a derived
 * model: deterministic, without converter names or ids (it is part of the
 * stance the recompute compares).
 */
export function trustRationale(reasons: readonly TrustReason[]): string {
  return (
    'Vertrauensregel: Der Aufruf nennt genau einen Prozess, aber das aufrufende Modell gilt als ' +
    `abgeleitet (${trustReasonsText(reasons)}). Darum nur vorgeschlagen.`
  );
}

/** A relation of the rule tier as the server records it: with its rationale and the trust flag. */
export type RuleRelation = DerivedRelation & {
  /** The rule assertion's rationale; `null` but for a derived caller's call. */
  rationale: string | null;
  /** A unique call the trust rule turned into a proposal. */
  derivedCaller: boolean;
};

/** The rule tier's output with the trust rule applied ({@link applyTrust}). */
export interface TrustedRuleOutput extends Omit<RuleOutput, 'relations'> {
  relations: RuleRelation[];
}

/**
 * The rule tier's output under the trust rule: every accepted rule-tier
 * call whose caller model is derived, unless its element's call target was
 * set in analyzr (`modelledCalls`), becomes a proposal, tier `key`,
 * {@link DERIVED_CALL_CONFIDENCE}, its attributes with `calledElement` and
 * `match: 'derived-caller'`, and {@link trustRationale}. Everything else and
 * the findings pass through unchanged. The single place trust is applied.
 *
 * @throws {Error} when a caller model is missing from `trust` (a bug)
 */
export function applyTrust(
  rules: RuleOutput,
  trust: ReadonlyMap<string, ModelTrust>,
): TrustedRuleOutput {
  return {
    findings: rules.findings,
    relations: rules.relations.map((d): RuleRelation => {
      if (d.type !== 'call' || d.status !== 'accepted' || d.tier !== 'rule') {
        return { ...d, rationale: null, derivedCaller: false };
      }
      const { modelKey, elementId } = parseRef(d.from);
      const t = trust.get(modelKey);
      if (!t) throw new Error(`trust rule: no trust for the caller model ${modelKey}`);
      if (t.trust?.class !== 'derived' || t.modelledCalls.has(elementId)) {
        return { ...d, rationale: null, derivedCaller: false };
      }
      return {
        ...d,
        status: 'proposed',
        tier: 'key',
        confidence: DERIVED_CALL_CONFIDENCE,
        // A unique call names its target's process id exactly.
        attrs: { ...d.attrs, calledElement: parseRef(d.to).elementId, match: DERIVED_CALLER_MATCH },
        rationale: trustRationale(t.trust.reasons),
        derivedCaller: true,
      };
    }),
  };
}

/**
 * An open unique call from a derived model: a call relation the rule tier
 * only proposed (status `proposed`, tier `key`, marked `attrs.match`
 * `derived-caller`), the web's `isDerivedCall` (apps/web/src/lib/review.ts).
 * The system rule's `proposed` counts those of them a bulk accept takes as
 * they stand (`isBulkDerivedCall` over their views: no agent's question, no
 * no-link), so the card's number equals the selection its link opens (M6
 * S2c-2); this test on the stored rows picks the few to build views for.
 */
export function isOpenDerivedCall(
  relation: Pick<RelationRecord, 'type' | 'status' | 'tier' | 'attrs'>,
): boolean {
  return (
    relation.type === 'call' &&
    relation.status === 'proposed' &&
    relation.tier === 'key' &&
    relation.attrs['match'] === DERIVED_CALLER_MATCH
  );
}

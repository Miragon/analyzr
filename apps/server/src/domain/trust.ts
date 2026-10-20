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
 *
 * Revisions stored before S2c (M6 S2c-4, decision 28 (3)): the owner may
 * review them once; a review is stored apart (`revision_trust_review`) and
 * read where the revision carries no class ({@link storedTrust}: `derived`
 * with the reasons {@link legacyTrust} computes from what the revision
 * carries, or `modelled`). {@link preTrustAcceptances} lists the rule tier's
 * acceptances such a review concerns.
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
  type ModelId,
  type ModelTrustSummary,
  type RevisionId,
  type RevisionSource,
  type RevisionTrust,
  type TrustClass,
  type TrustReason,
} from '@analyzr/contracts';

import type { HeadTrustRow, PrincipalKind, RelationRecord, RuleOutput } from './ports.ts';
import { decisionsInForce, type StanceView } from './status.ts';

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

/** The trust reasons a declared derivation gives. */
const DERIVATION_REASONS: ReadonlySet<TrustReason> = new Set([
  'converted',
  'reconstructed',
  'as-told',
]);

/**
 * Whether `trust-kept` names the derivation (M6 S2b follow-up step 5): it
 * is raised ({@link trustKeptWarning}) and the kept class's reasons and the
 * request's differ in a derivation (`converted`, `reconstructed`,
 * `as-told`), so its message says the declared derivation is not taken
 * either; not when only the credential differs (`agent-upload`), which
 * says nothing of the derivation.
 */
export function trustKeptNamesDerivation(
  stored: RevisionTrust | null,
  incoming: RevisionTrust,
): boolean {
  if (trustKeptWarning(stored, incoming) === null) return false;
  const derivations = (t: RevisionTrust | null) =>
    (t?.reasons ?? [])
      .filter((r) => DERIVATION_REASONS.has(r))
      .sort(byCodePoint)
      .join();
  return derivations(stored) !== derivations(incoming);
}

/** What the trust rule knows of a live model. */
export interface ModelTrust {
  /**
   * The uploaded revision's class ({@link storedTrust}: `source.trust`, else
   * the owner's review); `null` stored before S2c and not reviewed (counts as
   * modelled).
   */
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

/** Who uploaded a revision: `source.uploader`, else (stored before S2a) by the principal's kind. */
function uploaderOf(
  source: RevisionSource | null,
  principalKind: PrincipalKind,
): ModelTrust['uploader'] {
  return source?.uploader ?? (principalKind === 'service' ? 'agent' : 'human');
}

/**
 * The class a revision stored before S2c would get today from what it
 * carries (decision 28 (3)): {@link trustOf} over its engine, its uploader
 * (for one stored before S2a, a service principal counts as an agent) and
 * its declared derived kind.
 */
export function legacyTrust(
  signals: Pick<ModelTrust, 'engine' | 'uploader' | 'derivedKind'>,
): RevisionTrust {
  return trustOf(signals.engine, {
    uploader: signals.uploader,
    ...(signals.derivedKind ? { derived: { kind: signals.derivedKind } } : {}),
  });
}

/** What the trust rule reads of an uploaded revision (M6 S2c-4). */
export interface UploadedTrustInput {
  /** The uploaded revision's source; `null` when an amended head's upstream is missing. */
  source: RevisionSource | null;
  engine: Engine | null;
  /** Kind of the principal that stored it. */
  uploaderPrincipalKind: PrincipalKind;
  /** The owner's review of it (`revision_trust_review`); `null` when none is recorded. */
  review: TrustClass | null;
}

/**
 * An uploaded revision's class: `source.trust`, set by the server since
 * S2c; else the owner's review (M6 S2c-4), `derived` with the reasons the
 * revision carries ({@link legacyTrust}) or `modelled`; else `null` (stored
 * before S2c, counts as modelled). A review never overrules a stored class.
 */
export function storedTrust(input: UploadedTrustInput): RevisionTrust | null {
  if (input.source?.trust) return input.source.trust;
  if (input.review === 'modelled') return { class: 'modelled', reasons: [] };
  if (input.review === 'derived') {
    const legacy = legacyTrust({
      engine: input.engine,
      uploader: uploaderOf(input.source, input.uploaderPrincipalKind),
      derivedKind: input.source?.derived?.kind ?? null,
    });
    // Only a revision that would be derived is ever reviewed `derived` (the use case lists them).
    return { class: 'derived', reasons: legacy.reasons };
  }
  return null;
}

/**
 * The trust of a live model ({@link ModelTrust}): its uploaded revision's
 * class (an amended head's own uploader never counts; a review where it
 * carries none), the call elements of its head's plan, the declared
 * derivation and the legacy signals.
 */
export function modelTrust(row: HeadTrustRow): ModelTrust {
  const uploaded = uploadedSourceOf(row.head, row.upstream);
  return {
    trust: storedTrust({
      source: uploaded,
      engine: row.engine,
      uploaderPrincipalKind: row.uploaderPrincipalKind,
      review: row.review,
    }),
    ...callTargets(row.head.amendments ?? []),
    derivedKind: uploaded?.derived?.kind ?? null,
    converter: uploaded?.derived?.converter ?? null,
    engine: row.engine,
    uploader: uploaderOf(uploaded, row.uploaderPrincipalKind),
  };
}

/** The trust of every live model by key, from `RevisionRepo.headTrustRows`. */
export function trustByModel(rows: readonly HeadTrustRow[]): Map<string, ModelTrust> {
  return new Map(rows.map((r) => [r.key, modelTrust(r)]));
}

/**
 * `Model.trust` (M6 S2c): the uploaded revision's class ({@link
 * storedTrust}, a review included) with its derivation; `null` before S2c
 * and not reviewed.
 */
export function trustSummary(
  row: Pick<HeadTrustRow, 'head' | 'upstream' | 'engine' | 'uploaderPrincipalKind' | 'review'>,
): ModelTrustSummary | null {
  const uploaded = uploadedSourceOf(row.head, row.upstream);
  const trust = storedTrust({
    source: uploaded,
    engine: row.engine,
    uploaderPrincipalKind: row.uploaderPrincipalKind,
    review: row.review,
  });
  if (!trust) return null;
  return {
    class: trust.class,
    reasons: trust.reasons,
    derivedKind: uploaded?.derived?.kind ?? null,
    converter: uploaded?.derived?.converter ?? null,
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

/** A model of „Vor der Vertrauensregel angenommen“ (M6 S2c-4) with its listed calls. */
export interface PreTrustGroup {
  modelId: ModelId;
  modelKey: string;
  modelName: string | null;
  /** The uploaded revision a review names. */
  revisionId: RevisionId;
  rev: number;
  /** Why it would be derived today ({@link legacyTrust}; at least one). */
  reasons: TrustReason[];
  derivedKind: DerivedKind | null;
  converter: string | null;
  /** By natural key. */
  calls: Pick<RelationRecord, 'id' | 'fromRef' | 'toRef'>[];
}

/**
 * „Vor der Vertrauensregel angenommen“ (M6 S2c-4, decisions 24.2 (a) and
 * 28 (3)), pure: the call relations the rule tier accepted from revisions
 * stored before the trust rule that would be derived today, by model (key
 * order), each call when
 * - it is accepted, its endpoints present, resting on the rule tier's
 *   decision alone (no other decision in force, an auto-accept rule's
 *   included);
 * - its caller's uploaded revision carries no class and has no review
 *   ({@link ModelTrust.trust} `null`);
 * - its element's call target was not set in analyzr (`modelledCalls`, 25.2);
 * - what the revision carries makes it derived ({@link legacyTrust}).
 * A model without such a call is not listed.
 */
export function preTrustAcceptances(
  rows: readonly HeadTrustRow[],
  relations: readonly Pick<
    RelationRecord,
    'id' | 'type' | 'fromRef' | 'toRef' | 'status' | 'endpointState'
  >[],
  histories: ReadonlyMap<string, readonly StanceView[]>,
): PreTrustGroup[] {
  const candidates = new Map<
    string,
    { group: PreTrustGroup; modelledCalls: ReadonlySet<string> }
  >();
  for (const row of rows) {
    const t = modelTrust(row);
    if (t.trust !== null) continue;
    const legacy = legacyTrust(t);
    if (legacy.class !== 'derived') continue;
    candidates.set(row.key, {
      modelledCalls: t.modelledCalls,
      group: {
        modelId: row.modelId,
        modelKey: row.key,
        modelName: row.name,
        revisionId: row.revisionId,
        rev: row.rev,
        reasons: legacy.reasons,
        derivedKind: t.derivedKind,
        converter: t.converter,
        calls: [],
      },
    });
  }
  if (candidates.size === 0) return [];
  for (const r of relations) {
    if (r.type !== 'call' || r.status !== 'accepted' || r.endpointState === 'missing') continue;
    const { modelKey, elementId } = parseRef(r.fromRef);
    const c = candidates.get(modelKey);
    if (!c || c.modelledCalls.has(elementId)) continue;
    const inForce = decisionsInForce(histories.get(r.id) ?? []);
    if (inForce.length === 0 || inForce.some((d) => d.sourceKind !== 'rule')) continue;
    c.group.calls.push({ id: r.id, fromRef: r.fromRef, toRef: r.toRef });
  }
  return [...candidates.values()]
    .map((c) => c.group)
    .filter((g) => g.calls.length > 0)
    .map((g) => ({
      ...g,
      calls: g.calls.sort(
        (a, b) => byCodePoint(a.fromRef, b.fromRef) || byCodePoint(a.toRef, b.toRef),
      ),
    }))
    .sort((a, b) => byCodePoint(a.modelKey, b.modelKey));
}

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

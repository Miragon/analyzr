/**
 * Auto-accept rules (owner decision 19), pure part: whether an owner's rule
 * accepts an agent proposal, and the safeguards that keep it from doing so.
 * The write paths (`apply.ts`), "apply to open proposals", the preview and
 * its history replay all go through these functions.
 *
 * A rule matches a proposal when it is enabled, its author still is an
 * owner, kind and tier are equal, the confidence reaches the minimum
 * (inclusive), and type, agent, model and the ad-hoc switch fit. The first
 * matching rule in creation order is the one recorded. The safeguards are
 * conservative and checked in the order of `AUTO_ACCEPT_BLOCK_REASONS`; the
 * first that fails is the reason.
 *
 * Whose proposal triggers which rule (M6 S2c-3, decision 24.2's extension
 * of decision 19, owner decision 28 (1)): an agent rule (`proposedBy:
 * 'agent'`, every rule before) only agent proposals, so no existing rule
 * starts accepting the rule tier's proposals; a rule for derived calls
 * (`proposedBy: 'rule'`) only the rule tier's proposal of a unique call from
 * a derived model ({@link DerivedCallView}) whose caller declares the
 * rule's derived kind (and, for `converted`, its converter exactly), never
 * one of a call element whose call target set in analyzr is in conflict
 * (`amendment-conflict`). No rule, an agent rule neither, accepts a call
 * whose caller's revision was uploaded with an agent token (`agent-upload`,
 * {@link TriggerView.agentUploadedCaller}): otherwise an agent could upload
 * a model and have its own proposal of the model's calls accepted without
 * any person seeing them.
 */
import {
  DERIVED_CALL_CONFIDENCE,
  parseRef,
  type AssertionKind,
  type AutoAcceptBlockReason,
  type AutoAcceptDerivedKind,
  type AutoAcceptKind,
  type AutoAcceptProposer,
  type AutoAcceptRelationType,
  type AutoAcceptRuleId,
  type AutoAcceptTier,
  type DerivedKind,
  type EndpointState,
  type PrincipalId,
  type RelationStatus,
  type SourceKind,
  type Tier,
} from '@analyzr/contracts';

import { currentStances, type StanceView } from '../status.ts';
import { OUTSIDE } from '../value-chain/steps.ts';

/** A rule (its head revision) as the evaluator applies it. */
export interface AutoAcceptRuleRev {
  ruleId: AutoAcceptRuleId;
  revision: number;
  kind: AutoAcceptKind;
  name: string;
  enabled: boolean;
  tier: AutoAcceptTier;
  minConfidence: number;
  relationType: AutoAcceptRelationType | null;
  agentPrincipalId: PrincipalId | null;
  llmModel: string | null;
  includeAdHoc: boolean;
  /** Whose proposals (M6 S2c-3); `agent` for every rule before. */
  proposedBy: AutoAcceptProposer;
  /** A rule for derived calls: the caller's declared derivation it names. */
  derivedKind: AutoAcceptDerivedKind | null;
  /** A rule for converted calls: the converter it names, exactly. */
  converter: string | null;
  /** The revision's author: the acceptance is recorded under this owner. */
  authorId: PrincipalId;
  /** The client the author wrote the revision on; the acceptance carries it. */
  authorClientId: string | null;
  /** The author still has the owner role (else the rule matches nothing). */
  authorIsOwner: boolean;
  /** The rule's creation order (the seq of its creation). */
  order: number;
}

/**
 * What a rule for derived calls reads of the rule tier's proposal of a
 * unique call from a derived model (M6 S2c-3): its caller's declared
 * derivation and converter (the uploaded revision's), whether that revision
 * was uploaded with an agent token, and whether the call element's call
 * target set in analyzr is in conflict.
 */
export interface DerivedCallView {
  /** `derived.kind` of the caller's uploaded revision; `null` when none is declared. */
  derivedKind: DerivedKind | null;
  converter: string | null;
  /** The caller's uploaded revision was uploaded with an agent token (`agent-upload`). */
  agentUpload: boolean;
  /** The call element's call-target amendment is in `conflict`. */
  amendmentConflict: boolean;
}

/** What {@link derivedCallView} reads of a model's trust (`trust.ts` `ModelTrust`). */
export interface CallerTrust {
  trust: { class: string; reasons: readonly string[] } | null;
  derivedKind: DerivedKind | null;
  converter: string | null;
  conflictedCalls: ReadonlySet<string>;
}

/**
 * Whether an assertion is the rule tier's proposal of a unique call from a
 * derived model (M6 S2c, `trust.ts` `applyTrust`): a rule proposal at tier
 * `key` and {@link DERIVED_CALL_CONFIDENCE} on a call relation with the
 * trust rule's rationale (no rule assertion before S2c had one; the web's
 * `isTrustRuleProposal` reads it the same way).
 */
export function isDerivedCallProposal(
  relation: { type: string },
  a: {
    sourceKind: SourceKind;
    kind: AssertionKind;
    tier: Tier | null;
    confidence: number | null;
    rationale?: string | null;
  },
): boolean {
  return (
    relation.type === 'call' &&
    a.sourceKind === 'rule' &&
    a.kind === 'proposal' &&
    a.tier === 'key' &&
    a.confidence === DERIVED_CALL_CONFIDENCE &&
    (a.rationale ?? null) !== null
  );
}

/**
 * The {@link DerivedCallView} of a call from `fromRef`, by its caller's trust
 * (`null` when the caller is not live or not derived, also one stored before
 * S2c, which counts as modelled). The write path reads
 * the trust of the head the write left; "apply", the preview and its replay
 * read the caller's current head (an approximation for proposals made under
 * an earlier head).
 */
export function derivedCallView(
  fromRef: string,
  trust: ReadonlyMap<string, CallerTrust>,
): DerivedCallView | null {
  const { modelKey, elementId } = parseRef(fromRef);
  const t = trust.get(modelKey);
  if (t?.trust?.class !== 'derived') return null;
  return {
    derivedKind: t.derivedKind,
    converter: t.converter,
    agentUpload: t.trust.reasons.includes('agent-upload'),
    amendmentConflict: t.conflictedCalls.has(elementId),
  };
}

/**
 * Whether a relation is a call whose caller's head revision was uploaded
 * with an agent token (owner decision 28 (1)), by the caller's trust; an
 * amended head reads its upstream's (`trustByModel`).
 */
export function agentUploadedCaller(
  relation: { type: string; fromRef: string },
  trust: ReadonlyMap<string, CallerTrust>,
): boolean {
  return (
    relation.type === 'call' && (derivedCallView(relation.fromRef, trust)?.agentUpload ?? false)
  );
}

/** The proposal a rule is evaluated against. */
export interface TriggerView {
  id: string;
  principalId: PrincipalId;
  sourceKind: SourceKind;
  kind: AssertionKind;
  tier: Tier | null;
  confidence: number | null;
  question: string | null;
  llmModel: string | null;
  /** A pipeline proposal (from a submission, with a claim basis); else ad hoc. */
  pipeline: boolean;
  /** Its basis is current (an ad-hoc proposal, recorded under the lock, always is). */
  current: boolean;
  /**
   * The rule tier's proposal of a unique call from a derived model (M6
   * S2c-3), with what a rule for derived calls reads of it; `null` for every
   * other proposal.
   */
  derivedCall: DerivedCallView | null;
  /**
   * Any proposal on a `call` relation whose caller's head revision was
   * uploaded with an agent token (owner decision 28 (1): no rule accepts
   * it, `agent-upload`; {@link agentUploadedCaller}).
   */
  agentUploadedCaller: boolean;
}

export type AutoAcceptVerdict =
  { accept: true; rule: AutoAcceptRuleRev } | { accept: false; reason: AutoAcceptBlockReason };

/** What the safeguards read of an assertion of a history. */
export interface HistoryView extends StanceView {
  question: string | null;
}

/** The subject of a proposal, for the rule match. */
export interface RuleSubject {
  kind: AutoAcceptKind;
  /** Relations: the relation's type. */
  relationType?: string;
}

/** Whether a trigger is a proposal some rule may accept: an agent's, or a derived call's (M6 S2c-3). */
function isTriggerProposal(trigger: TriggerView): boolean {
  if (trigger.kind !== 'proposal') return false;
  return (
    trigger.sourceKind === 'agent' ||
    (trigger.sourceKind === 'rule' && trigger.derivedCall !== null)
  );
}

/**
 * Whether the rule's criteria accept the proposal (the safeguards aside).
 * An agent rule requires an agent's proposal, so an existing rule (say
 * „Gleicher Name ab 90 %“ for any type) never accepts the rule tier's
 * proposal of a derived call; a rule for derived calls requires that
 * proposal ({@link TriggerView.derivedCall}) with the rule's derived kind
 * (`none`: none declared) and, for `converted`, its converter; agent, model,
 * pipeline and ad hoc do not apply to it.
 */
export function ruleMatches(
  rule: AutoAcceptRuleRev,
  trigger: TriggerView,
  subject: RuleSubject,
): boolean {
  const common =
    rule.enabled &&
    rule.authorIsOwner &&
    rule.kind === subject.kind &&
    trigger.kind === 'proposal' &&
    trigger.tier === rule.tier &&
    trigger.confidence !== null &&
    trigger.confidence >= rule.minConfidence &&
    (rule.relationType === null || rule.relationType === subject.relationType);
  if (!common) return false;
  if (rule.proposedBy === 'rule') {
    const d = trigger.derivedCall;
    return (
      trigger.sourceKind === 'rule' &&
      d !== null &&
      (d.derivedKind ?? 'none') === rule.derivedKind &&
      (rule.derivedKind !== 'converted' || d.converter === rule.converter)
    );
  }
  return (
    trigger.sourceKind === 'agent' &&
    (rule.agentPrincipalId === null || rule.agentPrincipalId === trigger.principalId) &&
    (rule.llmModel === null || rule.llmModel === trigger.llmModel) &&
    (trigger.pipeline || rule.includeAdHoc)
  );
}

/** The first rule in creation order whose criteria accept the proposal. */
export function matchRule(
  rules: readonly AutoAcceptRuleRev[],
  trigger: TriggerView,
  subject: RuleSubject,
): AutoAcceptRuleRev | null {
  return (
    [...rules]
      .sort((a, b) => a.order - b.order)
      .find((rule) => ruleMatches(rule, trigger, subject)) ?? null
  );
}

const blocked = (reason: AutoAcceptBlockReason): AutoAcceptVerdict => ({ accept: false, reason });

/** The checks every kind shares, up to the subject's own state. */
function commonChecks(
  trigger: TriggerView,
  rules: readonly AutoAcceptRuleRev[],
  subject: RuleSubject,
  state: { status: RelationStatus; endpointState: EndpointState },
): AutoAcceptVerdict {
  if (!isTriggerProposal(trigger)) return blocked('not-agent');
  const rule = matchRule(rules, trigger, subject);
  if (!rule) return blocked('no-matching-rule');
  // Owner decision 28 (1): no rule (an agent rule neither) accepts a call of a revision an
  // agent token uploaded.
  if (trigger.agentUploadedCaller || trigger.derivedCall?.agentUpload) {
    return blocked('agent-upload');
  }
  if (trigger.derivedCall?.amendmentConflict) return blocked('amendment-conflict');
  if (!trigger.current) return blocked('stale-proposal');
  if (state.status !== 'proposed') return blocked('not-open');
  if (state.endpointState !== 'ok') return blocked('endpoint-not-ok');
  return { accept: true, rule };
}

/** Statuses of a call relation that leave no room for another target of the same call element. */
export const CALL_TAKEN: ReadonlySet<string> = new Set(['proposed', 'held', 'accepted']);

/**
 * Statuses of a `manual` relation leaving a call element that leave no room
 * for another target either (M6 S5c-1: a human's link from „Offene Fragen“
 * is often a manual relation; a call has one target, never over a human
 * decision).
 */
export const MANUAL_CALL_TAKEN: ReadonlySet<string> = new Set(['held', 'accepted']);

/**
 * Whether `other` competes with the call relation `call` for its call
 * element (`competing-call`, owner decision 19): another proposed, held or
 * accepted `call` relation from the same element, or an accepted or held
 * `manual` relation from it to another target (M6 S5c-1).
 */
export function competesWithCall(
  call: { id: string; fromRef: string; toRef: string },
  other: { id: string; type: string; fromRef: string; toRef: string; status: string },
): boolean {
  if (other.id === call.id || other.fromRef !== call.fromRef) return false;
  if (other.type === 'call') return CALL_TAKEN.has(other.status);
  return (
    other.type === 'manual' && other.toRef !== call.toRef && MANUAL_CALL_TAKEN.has(other.status)
  );
}

const asks = (a: HistoryView): boolean => a.question !== null && a.question.trim() !== '';

/** Live agent proposals of a history. */
function liveAgentProposals<T extends HistoryView>(history: readonly T[]): T[] {
  return currentStances(history).filter((a) => a.kind === 'proposal' && a.sourceKind === 'agent');
}

/**
 * Whether a rule accepts an agent's relation proposal. Safeguards after the
 * common ones: `competing-call` (another proposed, held or accepted call
 * leaves the same call element, or an accepted or held manual relation to
 * another target, M6 S5c-1: a call has one target), `human-involved`
 * (any human assertion on the relation), `agent-question` (a live agent
 * proposal asks a question, the trigger's included) and `no-link` (a live
 * no-link of any agent on the typed pair, current or stale).
 */
export function evaluateRelationAutoAccept(src: {
  relation: { status: RelationStatus; endpointState: EndpointState; type: string };
  history: readonly HistoryView[];
  trigger: TriggerView;
  /** Live no-links on the typed pair (any principal, current or stale). */
  liveNoLinks: number;
  /**
   * Another proposed, held or accepted call relation leaves the same call
   * element, or an accepted or held manual relation to another target.
   */
  competingCall: boolean;
  rules: readonly AutoAcceptRuleRev[];
}): AutoAcceptVerdict {
  const verdict = commonChecks(
    src.trigger,
    src.rules,
    { kind: 'relation', relationType: src.relation.type },
    src.relation,
  );
  if (!verdict.accept) return verdict;
  if (src.relation.type === 'call' && src.competingCall) return blocked('competing-call');
  if (src.history.some((a) => a.sourceKind === 'human')) return blocked('human-involved');
  if (liveAgentProposals(src.history).some(asks)) return blocked('agent-question');
  if (src.liveNoLinks > 0) return blocked('no-link');
  return verdict;
}

/** A placement as the placement safeguards see it. */
export interface PlacementSubjectView {
  id: string;
  status: RelationStatus;
  endpointState: EndpointState;
  elementId: string;
  generation: number;
}

/**
 * Whether a rule accepts an agent's placement proposal. Safeguards after the
 * common ones, at the level of the process (all its placements on the
 * chain): `outside` (never `@outside`), `step-removed`, `has-home-step` (any
 * placement of the process is accepted or held, on any generation: owner
 * decision 18), `competing-step` (a live proposal of any principal, the rule
 * tier included, on another step generation; this also covers an agent's
 * own second step and "more than one step meets the rule"),
 * `human-involved`, `agent-question` and `agent-unsure` (another agent's
 * `unsure` verdict on the process's current input, before this write).
 */
export function evaluatePlacementAutoAccept(src: {
  placement: PlacementSubjectView;
  /** The placement's step generation is live. */
  stepLive: boolean;
  /** Every placement of the process on the chain (this one included) with its history. */
  processPlacements: readonly {
    placement: PlacementSubjectView;
    history: readonly HistoryView[];
  }[];
  trigger: TriggerView;
  /** The process's `placement_input` row before this write; `current`: its hash is the current one. */
  priorVerdict: { principalId: PrincipalId; outcome: string; current: boolean } | null;
  rules: readonly AutoAcceptRuleRev[];
}): AutoAcceptVerdict {
  const verdict = commonChecks(src.trigger, src.rules, { kind: 'placement' }, src.placement);
  if (!verdict.accept) return verdict;
  const { placement } = src;
  if (placement.elementId === OUTSIDE) return blocked('outside');
  if (!src.stepLive) return blocked('step-removed');
  const others = src.processPlacements.filter((p) => p.placement.id !== placement.id);
  if (others.some((p) => p.placement.status === 'accepted' || p.placement.status === 'held')) {
    return blocked('has-home-step');
  }
  const elsewhere = others.filter(
    (p) =>
      p.placement.elementId !== placement.elementId ||
      p.placement.generation !== placement.generation,
  );
  if (elsewhere.some((p) => currentStances(p.history).some((a) => a.kind === 'proposal'))) {
    return blocked('competing-step');
  }
  const histories = src.processPlacements.map((p) => p.history);
  if (histories.some((h) => h.some((a) => a.sourceKind === 'human'))) {
    return blocked('human-involved');
  }
  if (histories.some((h) => liveAgentProposals(h).some(asks))) return blocked('agent-question');
  const prior = src.priorVerdict;
  if (
    prior?.outcome === 'unsure' &&
    prior.current &&
    prior.principalId !== src.trigger.principalId
  ) {
    return blocked('agent-unsure');
  }
  return verdict;
}

/**
 * The trigger view of a stored proposal; `derivedCall` for the rule tier's
 * proposal of a unique call from a derived model (M6 S2c-3), else `null`;
 * `agentUploaded` for any proposal on a call whose caller an agent token
 * uploaded ({@link agentUploadedCaller}; a derived call's view says so too).
 */
export function triggerOf(
  a: {
    id: string;
    principalId: PrincipalId;
    sourceKind: SourceKind;
    kind: AssertionKind;
    tier: Tier | null;
    confidence: number | null;
    question: string | null;
    submissionId: string | null;
    declared: { llmModel: string | null } | null;
  },
  current: boolean,
  derivedCall: DerivedCallView | null = null,
  agentUploaded = false,
): TriggerView {
  return {
    id: a.id,
    principalId: a.principalId,
    sourceKind: a.sourceKind,
    kind: a.kind,
    tier: a.tier,
    confidence: a.confidence,
    question: a.question,
    llmModel: a.declared?.llmModel ?? null,
    pipeline: a.submissionId !== null,
    current,
    derivedCall,
    agentUploadedCaller: agentUploaded || (derivedCall?.agentUpload ?? false),
  };
}

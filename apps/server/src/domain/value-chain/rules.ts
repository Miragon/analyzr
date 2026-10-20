/**
 * Key-tier rule proposals of placements (M4 §2 "Tiers", S2): a step whose
 * `link` is `analyzr:process/<ref>` of a head process, or whose non-empty
 * normalized name equals the normalized name of a head process (the process
 * fact's label: process name, else pool name), yields a proposal of that
 * process on the step, recorded under the rule tier's system principal
 * `analyzr-rules` (`source_kind = 'rule'`, no client, tier `key`, confidence
 * 1.0). Rule proposals follow the rules: they are derived again after every
 * chain save (create, revive, revise) and every model ingest or deletion, and
 * a rule proposal that is no longer derived is withdrawn. A pasted step keeps
 * its link, so a duplicated link yields one proposal per step. Nothing is
 * auto-accepted; a human decision on the same fingerprints suppresses the
 * proposal (`classifyPlacementProposal`), and supersession and token
 * revocation, which end agent proposals, never touch rule proposals.
 */
import {
  ANALYZR_PROCESS_LINK_PREFIX,
  type PlacementId,
  type PrincipalId,
  type Ref,
  type ValueChainId,
} from '@analyzr/contracts';
import { derivePlacementRules, quoteDe } from '@analyzr/relations';

import type { Actor } from '../actor.ts';
import type { HeadFact, PlacementAssertionRecord, PlacementRecord, Tx } from '../ports.ts';
import { currentStances } from '../status.ts';
import type { ChainState } from './chain-state.ts';
import {
  byPlacement,
  classifyPlacementProposal,
  placementKey,
  type ClassifiedPlacementAssertion,
  type PlacementEndpoints,
} from './placement-state.ts';
import {
  applyPlacementProposal,
  withdrawPlacementStance,
  type PlacementContext,
} from './placements.ts';
import type { ChainStep } from './structure.ts';

/** Confidence of a rule proposal. */
export const RULE_CONFIDENCE = 1;

/** The rationale of a withdrawn rule proposal (German, like the review UI). */
export const RULE_WITHDRAWAL =
  'Nicht mehr abgeleitet: Weder der Link noch der Name des Schritts nennt den Prozess.';

/** A placement the rule tier proposes. */
export interface DerivedRulePlacement {
  elementId: string;
  processRef: Ref;
  /** The step's `link` is `analyzr:process/<processRef>`. */
  byLink: boolean;
  /** The step's normalized name equals the process's. */
  byName: boolean;
  /** Names the link or the equal (normalized) name; stable while the fingerprints are. */
  rationale: string;
  /** `[processRef, step:<elementId>]`. */
  evidence: string[];
}

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The German rationale of a rule proposal: the link (ref verbatim) and/or the
 * normalized name in „…“. Stable while the fingerprints are, so a case-only
 * rename records nothing.
 */
function ruleRationale(processRef: Ref, nameNorm: string, byLink: boolean, byName: boolean) {
  const parts: string[] = [];
  if (byLink) {
    parts.push(
      `der Link des Schritts nennt diesen Prozess (${ANALYZR_PROCESS_LINK_PREFIX}${processRef})`,
    );
  }
  if (byName) {
    parts.push(
      `der Name des Schritts entspricht dem Prozessnamen (normalisiert: ${quoteDe(nameNorm)})`,
    );
  }
  return `Schlüsselregel: ${parts.join('; ')}.`;
}

/**
 * The rule tier's placements of a chain revision, in code point order of
 * step id, then process ref: `derivePlacementRules` of `@analyzr/relations`
 * (the derivation `eval:placements` gates on the golden chains), plus the
 * rationale and the evidence. Pure.
 *
 * @param steps the head's steps (`ChainStructure.steps`)
 * @param processFacts the head's `process` facts
 */
export function derivedRulePlacements(
  steps: readonly Pick<ChainStep, 'elementId' | 'nameNorm' | 'link'>[],
  processFacts: readonly Pick<HeadFact, 'kind' | 'ref' | 'label'>[],
): DerivedRulePlacement[] {
  const matches = derivePlacementRules(
    steps.map((s) => ({ id: s.elementId, nameNorm: s.nameNorm, link: s.link })),
    processFacts.filter((f) => f.kind === 'process').map((f) => ({ ref: f.ref, label: f.label })),
  );
  return matches.map((m) => ({
    elementId: m.stepId,
    processRef: m.processRef as Ref,
    byLink: m.byLink,
    byName: m.byName,
    rationale: ruleRationale(m.processRef as Ref, m.nameNorm, m.byLink, m.byName),
    evidence: [m.processRef, `step:${m.stepId}`],
  }));
}

/** The rule tier as an actor (rule proposals are recorded under its principal, no client). */
export function rulesActor(principalId: PrincipalId): Actor {
  return {
    principalId,
    kind: 'service',
    handle: 'analyzr-rules',
    clientId: null,
    interactive: false,
    scopes: [],
    binding: null,
  };
}

/** The natural key of a placement within its chain. */
type PlacementSpot = Pick<PlacementRecord, 'id' | 'elementId' | 'generation' | 'processRef'>;

/** Natural key order (element id, generation, process ref), so events come in a stable order. */
function byNaturalKey(a: PlacementSpot, b: PlacementSpot): number {
  return (
    byCodePoint(a.elementId, b.elementId) ||
    a.generation - b.generation ||
    byCodePoint(a.processRef, b.processRef)
  );
}

/** A proposal the rule tier makes ({@link planRulePlacements}). */
export interface PlannedRuleProposal<P> {
  derived: DerivedRulePlacement;
  /** The step's live generation. */
  generation: number;
  /** The placement it goes to, `null` for a new one. */
  existing: P | null;
  /** Its anchor: the step's and the process's head fingerprints. */
  stepFp: string | null;
  processFp: string | null;
  /**
   * Whether `applyPlacementProposal` records it (`applied` or `reopened`,
   * `classifyPlacementProposal`): not a `duplicate` of the rule tier's live
   * proposal, not `suppressed` by a human decision on the same fingerprints.
   */
  records: boolean;
}

/** What the rule tier records on a chain ({@link planRulePlacements}). */
export interface RulePlacementPlan<P, A> {
  /** Every derived placement on a live step generation, in derivation order. */
  proposals: PlannedRuleProposal<P>[];
  /** The rule tier's live proposals the rules no longer derive, in natural key order. */
  withdrawals: { placement: P; stance: A }[];
}

/**
 * What {@link recomputeRulePlacements} records, pure: the rule tier's
 * placements of the chain's head ({@link derivedRulePlacements}) on live
 * step generations, each classified against its placement's history as
 * `applyPlacementProposal` does, and the rule principal's live proposals
 * that are no longer derived (withdrawn). A dry run (S2b follow-up) plans
 * over the would-be head processes, so it sees what the write records,
 * also where a stance the history changed since the last run (an
 * auto-acceptance revoked) no longer suppresses a proposal.
 *
 * @param input.endpoints the head's endpoints (`ChainState.endpoints`)
 * @param input.histories the stored assertions per placement, in seq order
 */
export function planRulePlacements<
  P extends PlacementSpot,
  A extends ClassifiedPlacementAssertion,
>(input: {
  valueChainId: ValueChainId;
  steps: readonly Pick<ChainStep, 'elementId' | 'nameNorm' | 'link'>[];
  processFacts: readonly Pick<HeadFact, 'kind' | 'ref' | 'label'>[];
  live: ReadonlyMap<string, number>;
  endpoints: PlacementEndpoints;
  placements: readonly P[];
  histories: ReadonlyMap<PlacementId, readonly A[]>;
  rulesPrincipalId: PrincipalId;
}): RulePlacementPlan<P, A> {
  const keyOf = (p: Pick<PlacementRecord, 'elementId' | 'generation' | 'processRef'>) =>
    placementKey(input.valueChainId, p.elementId, p.generation, p.processRef);
  const byKey = new Map(input.placements.map((p) => [keyOf(p), p]));
  const wanted = new Set<string>();
  const proposals: PlannedRuleProposal<P>[] = [];
  for (const d of derivedRulePlacements(input.steps, input.processFacts)) {
    const generation = input.live.get(d.elementId);
    if (generation === undefined) continue;
    const key = keyOf({ elementId: d.elementId, generation, processRef: d.processRef });
    wanted.add(key);
    const existing = byKey.get(key) ?? null;
    const stepFp = input.endpoints.step(d.elementId, generation);
    const processFp = input.endpoints.process(d.processRef) ?? null;
    // `applyPlacementProposal` refuses a step without a head fingerprint (a derived step has one).
    const records =
      stepFp !== undefined &&
      classifyPlacementProposal(existing ? (input.histories.get(existing.id) ?? []) : [], {
        principalId: input.rulesPrincipalId,
        tier: 'key',
        confidence: RULE_CONFIDENCE,
        rationale: d.rationale,
        question: null,
        stepFp,
        processFp,
      }).record;
    proposals.push({
      derived: d,
      generation,
      existing,
      stepFp: stepFp ?? null,
      processFp,
      records,
    });
  }
  const withdrawals: RulePlacementPlan<P, A>['withdrawals'] = [];
  for (const placement of input.placements
    .filter((p) => !wanted.has(keyOf(p)))
    .sort(byNaturalKey)) {
    const stance = currentStances(input.histories.get(placement.id) ?? []).find(
      (a) => a.principalId === input.rulesPrincipalId && a.kind === 'proposal',
    );
    if (stance) withdrawals.push({ placement, stance });
  }
  return { proposals, withdrawals };
}

export interface RuleRecompute {
  /** Rule proposals recorded (`applied` or `reopened`). */
  proposed: number;
  /** Rule proposals withdrawn because the rules no longer derive them. */
  withdrawn: number;
}

/**
 * Derives the rule tier's placements for the chain's head and records them
 * with `applyPlacementProposal` (`proposer` = the rule tier, tier `key`,
 * confidence 1.0, evidence `[process ref, step:<id>]`): a proposal the rule
 * principal already holds on the same fingerprints is a `duplicate` and a
 * human decision on them suppresses it, so a run without changes writes
 * nothing. Then it withdraws every live rule proposal the rules no longer
 * derive (a renamed or re-linked step, a deleted process). Proposals and
 * withdrawals are recorded under `analyzr-rules` without a client. Reads,
 * plans ({@link planRulePlacements}), then writes. Callers run
 * it before `refreshPlacements` (after a model change in `sync.ts`, inside a
 * chain save before S1's refresh), so a re-asserted proposal keeps `ok` and a
 * withdrawn one turns obsolete without an `endpoint_changed`. The caller holds
 * the project lock.
 *
 * @param state the chain's state after the change (head, generations, head processes)
 * @param options.endpointCause whom an `endpoint_changed` of these writes
 *   names (a chain save: the saving human); default `analyzr-rules`
 */
export async function recomputeRulePlacements(
  tx: Tx,
  state: ChainState,
  rulesPrincipalId: PrincipalId,
  options: { endpointCause?: { principalId: PrincipalId; clientId: string | null } } = {},
): Promise<RuleRecompute> {
  const { chain } = state;
  const projectId = chain.projectId;
  const placements = await tx.placements.forChain(projectId, chain.id);
  const histories = byPlacement<PlacementAssertionRecord>(
    await tx.placementAssertions.listForChain(projectId, chain.id),
  );
  const plan = planRulePlacements({
    valueChainId: chain.id,
    steps: state.structure.steps,
    processFacts: state.processFacts,
    live: state.live,
    endpoints: state.endpoints,
    placements,
    histories,
    rulesPrincipalId,
  });
  const ctx: PlacementContext = {
    tx,
    projectId,
    actor: rulesActor(rulesPrincipalId),
    valueChainId: chain.id,
    endpoints: state.endpoints,
    placements: new Map(
      placements.map((p) => [placementKey(chain.id, p.elementId, p.generation, p.processRef), p]),
    ),
    histories,
    declared: null,
    submissionId: null,
    proposer: { sourceKind: 'rule', principalId: rulesPrincipalId },
    ...(options.endpointCause ? { endpointCause: options.endpointCause } : {}),
  };

  const result: RuleRecompute = { proposed: 0, withdrawn: 0 };
  for (const { derived: d, generation } of plan.proposals) {
    const { effect } = await applyPlacementProposal(ctx, {
      elementId: d.elementId,
      generation,
      processRef: d.processRef,
      tier: 'key',
      confidence: RULE_CONFIDENCE,
      rationale: d.rationale,
      evidence: d.evidence,
      question: null,
    });
    if (effect === 'applied' || effect === 'reopened') result.proposed++;
  }
  // The proposals touched only derived placements: a stale one is as read.
  for (const { placement, stance } of plan.withdrawals) {
    await withdrawPlacementStance(ctx, placement, stance, RULE_WITHDRAWAL);
    result.withdrawn++;
  }
  return result;
}

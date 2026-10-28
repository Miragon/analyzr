/**
 * Auto-accept rules (owner decision 19): the step that runs at the end of
 * every write path recording agent proposals (relations submit, placement
 * submit, `proposeRelation`, placements `propose`), inside its transaction,
 * under the project lock, after the write's result was computed (results
 * report the state before the rules ran). It evaluates only the proposals
 * this write recorded, never older ones (rules are not retroactive), and is a
 * no-op after one query when the project has no enabled rule of the kind.
 *
 * The fifth write path (M6 S2c-3, decision 24.2's extension): after every
 * head change's recompute (ingest, amendment writes and withdrawals) and a
 * model's deletion by a human, {@link autoAcceptDerivedCalls} evaluates the
 * rule tier's proposals of unique calls from derived models that recompute
 * recorded against the owner's enabled rules for derived calls.
 *
 * In every path no owner's rule accepts anything with an endpoint in a model
 * whose uploaded revision declares `reconstructed` or `as-told` (owner
 * decision 30 (2), `reconstructed-endpoint`), read from the head the write
 * sees; the system rule (decision 9) is not among them.
 */
import type {
  AutoAcceptKind,
  DeclaredProcedure,
  PrincipalId,
  ProjectId,
  Role,
} from '@analyzr/contracts';

import { sourceKindOf, type Actor } from '../actor.ts';
import { headFingerprints } from '../fingerprints.ts';
import { isCurrent } from '../judgements.ts';
import type {
  AssertionRecord,
  AutoAcceptRuleHead,
  PlacementAssertionRecord,
  PlacementRecord,
  RelationRecord,
  StoredAutoAcceptRuleRevision,
  Tx,
} from '../ports.ts';
import type { ProposalContext } from '../proposals.ts';
import type { DerivedProposal } from '../recompute.ts';
import { byRelation, naturalKey } from '../relation-state.ts';
import { currentStances, sameProcedure } from '../status.ts';
import { placementKey } from '../value-chain/placement-state.ts';
import type { PlacementContext } from '../value-chain/placements.ts';
import { trustByModel } from '../trust.ts';
import {
  agentUploadedCaller,
  competesWithCall,
  derivedCallView,
  evaluatePlacementAutoAccept,
  evaluateRelationAutoAccept,
  hasReconstructedEndpoint,
  isDerivedCallProposal,
  triggerOf,
  type AutoAcceptRuleRev,
} from './evaluate.ts';
import { recordPlacementAutoAccept, recordRelationAutoAccept, type Cause } from './record.ts';

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A rule revision as the evaluator applies it. */
export function toRuleRev(
  r: StoredAutoAcceptRuleRevision,
  order: number,
  authorIsOwner: boolean,
): AutoAcceptRuleRev {
  return {
    ruleId: r.ruleId,
    revision: r.revision,
    kind: r.kind,
    name: r.name,
    enabled: r.enabled,
    tier: r.tier,
    minConfidence: r.minConfidence,
    relationType: r.relationType,
    agentPrincipalId: r.agentPrincipalId,
    llmModel: r.llmModel,
    includeAdHoc: r.includeAdHoc,
    proposedBy: r.proposedBy,
    derivedKind: r.derivedKind,
    converter: r.converter,
    authorId: r.principalId,
    authorClientId: r.clientId,
    authorIsOwner,
    order,
  };
}

/** Whether each principal currently has the owner role in the project. */
export async function ownersAmong(
  tx: Tx,
  projectId: ProjectId,
  principals: Iterable<PrincipalId>,
): Promise<Map<PrincipalId, boolean>> {
  const out = new Map<PrincipalId, boolean>();
  for (const id of principals) {
    if (out.has(id)) continue;
    const role: Role | null = await tx.memberships.roleOf(projectId, id);
    out.set(id, role === 'owner');
  }
  return out;
}

/** Rule heads as the evaluator applies them, with whether their author is still an owner. */
export async function ruleRevs(
  tx: Tx,
  projectId: ProjectId,
  heads: readonly AutoAcceptRuleHead[],
): Promise<AutoAcceptRuleRev[]> {
  const owners = await ownersAmong(
    tx,
    projectId,
    heads.map((h) => h.principalId),
  );
  return heads.map((h) => toRuleRev(h, h.ruleSeq, owners.get(h.principalId) ?? false));
}

/** The enabled rules of a kind (one query; none in a project without rules). */
export async function enabledRules(
  tx: Tx,
  projectId: ProjectId,
  kind: AutoAcceptKind,
): Promise<AutoAcceptRuleRev[]> {
  const heads = await tx.autoAcceptRules.heads(projectId, { kind, enabledOnly: true });
  if (heads.length === 0) return [];
  return ruleRevs(tx, projectId, heads);
}

/**
 * The enabled rules for derived calls (M6 S2c-3): one query; none in a
 * project without such a rule (the authors' roles are read only then).
 */
export async function enabledDerivedCallRules(
  tx: Tx,
  projectId: ProjectId,
): Promise<AutoAcceptRuleRev[]> {
  const heads = (
    await tx.autoAcceptRules.heads(projectId, { kind: 'relation', enabledOnly: true })
  ).filter((h) => h.proposedBy === 'rule');
  if (heads.length === 0) return [];
  return ruleRevs(tx, projectId, heads);
}

/** A derived call an owner's rule accepted in the fifth write path, with that rule. */
export interface AutoAcceptedCall {
  relation: RelationRecord;
  rule: AutoAcceptRuleRev;
}

/** A relation proposal this write recorded. */
export interface RelationTrigger {
  relation: RelationRecord;
  assertion: AssertionRecord;
}

const isAgentProposal = (a: { sourceKind: string; kind: string }) =>
  a.sourceKind === 'agent' && a.kind === 'proposal';

const byNaturalKey = (a: RelationRecord, b: RelationRecord): number =>
  byCodePoint(a.type, b.type) || byCodePoint(a.fromRef, b.fromRef) || byCodePoint(a.toRef, b.toRef);

/**
 * The fifth write path (M6 S2c-3, decision 24.2's extension of decision 19,
 * owner decision 28 (1)): evaluates the rule tier's proposals of unique
 * calls from derived models that the write's recompute recorded
 * (`derivedProposals`, never older ones: rules stay non-retroactive)
 * against the project's enabled rules for derived calls, and records the
 * acceptances under each rule's author, caused by the request's `actor`, in
 * natural key order. The caller holds the project lock; it runs in the
 * caller's transaction right after the recompute. No query without such
 * proposals, one without an enabled rule for derived calls. A caller
 * uploaded with an agent token is never accepted (`agent-upload`), and a
 * write by an agent token accepts nothing (decision 28 (1)'s spirit: the
 * rule trusts a source a human imports; an agent's upload of a callee or
 * its deletion of a duplicate must not decide which call is accepted). Nor
 * is a call into a callee declared `reconstructed` or `as-told`
 * (`reconstructed-endpoint`, owner decision 30 (2); such a caller's calls
 * match no rule anyway). A proposal the rule tier asserts again on a relation it already proposed
 * (an endpoint's fingerprint or the reasons changed) is a new proposal, as
 * an agent's re-proposal after a model change is for agent rules.
 *
 * @param procedure the procedure relations claims name (live no-links)
 * @returns the relations accepted, each with the rule that accepted it
 */
export async function autoAcceptDerivedCalls(
  tx: Tx,
  actor: Actor,
  projectId: ProjectId,
  derivedProposals: readonly DerivedProposal[],
  procedure: DeclaredProcedure,
): Promise<AutoAcceptedCall[]> {
  if (derivedProposals.length === 0 || sourceKindOf(actor) !== 'human') return [];
  const rules = await enabledDerivedCallRules(tx, projectId);
  if (rules.length === 0) return [];
  const records = await tx.relations.all(projectId);
  const byId = new Map(records.map((r) => [r.id as string, r]));
  const histories = byRelation<AssertionRecord>(await tx.assertions.listForProject(projectId));
  const trust = trustByModel(await tx.revisions.headTrustRows(projectId));
  const ctx: ProposalContext = {
    tx,
    projectId,
    actor,
    fps: headFingerprints(await tx.facts.headProjectFacts(projectId)),
    relations: new Map(records.map((r) => [naturalKey(r.type, r.fromRef, r.toRef), r])),
    histories,
    declared: null,
    submissionId: null,
  };
  const triggers = derivedProposals.flatMap((p) => {
    const relation = byId.get(p.relationId);
    return relation ? [{ relation, assertionId: p.assertionId }] : [];
  });
  const noLinks = new Map<string, number>();
  const pairs = triggers.map((t) => ({
    type: 'call' as const,
    from: t.relation.fromRef,
    to: t.relation.toRef,
  }));
  for (const n of await tx.noLinks.listLive(projectId, { pairs }, procedure)) {
    const key = naturalKey(n.type, n.fromRef, n.toRef);
    noLinks.set(key, (noLinks.get(key) ?? 0) + 1);
  }

  const accepted: AutoAcceptedCall[] = [];
  for (const t of [...triggers].sort((a, b) => byNaturalKey(a.relation, b.relation))) {
    const key = naturalKey(t.relation.type, t.relation.fromRef, t.relation.toRef);
    const relation = ctx.relations.get(key) ?? t.relation;
    const history = ctx.histories.get(relation.id) ?? [];
    const a = history.find((x) => x.id === t.assertionId);
    if (!a || !isDerivedCallProposal(relation, a)) continue;
    const live = currentStances(history).some((x) => x.id === a.id);
    const verdict = evaluateRelationAutoAccept({
      relation,
      history,
      trigger: triggerOf(a, live, derivedCallView(relation.fromRef, trust)),
      liveNoLinks: noLinks.get(key) ?? 0,
      competingCall: [...ctx.relations.values()].some((r) => competesWithCall(relation, r)),
      reconstructedEndpoint: hasReconstructedEndpoint([relation.fromRef, relation.toRef], trust),
      rules,
    });
    if (!verdict.accept) continue;
    accepted.push({
      relation: await recordRelationAutoAccept(ctx, relation, a.id, verdict.rule),
      rule: verdict.rule,
    });
  }
  return accepted;
}

/**
 * Evaluates the relation proposals this write recorded against the
 * project's enabled relation rules and records the acceptances, in natural
 * key order (deterministic events). A call whose caller an agent token
 * uploaded is never accepted (`agent-upload`, owner decision 28 (1)), nor a
 * relation with an end in a model declared `reconstructed` or `as-told`
 * (`reconstructed-endpoint`, owner decision 30 (2)): one more query, only
 * when a rule is enabled.
 *
 * @param opts.procedure the procedure relations claims name (a pipeline proposal's currency)
 * @param opts.heads the head `facts_hash` per model key, if loaded
 * @param opts.by the causer (default: the context's actor)
 * @returns the relations accepted
 */
export async function autoAcceptRelations(
  ctx: ProposalContext,
  triggers: readonly RelationTrigger[],
  opts: { procedure: DeclaredProcedure; heads?: ReadonlyMap<string, string>; by?: Cause },
): Promise<RelationRecord[]> {
  const agentTriggers = triggers.filter(
    (t) => t.relation.type !== 'manual' && isAgentProposal(t.assertion),
  );
  if (agentTriggers.length === 0) return [];
  const rules = await enabledRules(ctx.tx, ctx.projectId, 'relation');
  if (rules.length === 0) return [];
  const heads = opts.heads ?? (await ctx.tx.revisions.headHashes(ctx.projectId));
  const trust = trustByModel(await ctx.tx.revisions.headTrustRows(ctx.projectId));
  const pairs = agentTriggers.map((t) => ({
    type: t.relation.type as 'call' | 'message' | 'signal' | 'trigger',
    from: t.relation.fromRef,
    to: t.relation.toRef,
  }));
  const noLinks = new Map<string, number>();
  for (const n of await ctx.tx.noLinks.listLive(ctx.projectId, { pairs }, opts.procedure)) {
    const key = naturalKey(n.type, n.fromRef, n.toRef);
    noLinks.set(key, (noLinks.get(key) ?? 0) + 1);
  }
  // Calls need every call and manual relation of the project (an ad-hoc context holds
  // only its own): a manual relation from the call element competes too (M6 S5c-1).
  let calls: Map<string, RelationRecord> | null = null;
  const competing = async (self: RelationRecord): Promise<boolean> => {
    if (!calls) {
      calls = new Map();
      for (const r of await ctx.tx.relations.all(ctx.projectId)) {
        if (r.type === 'call' || r.type === 'manual') calls.set(r.id, r);
      }
    }
    for (const r of ctx.relations.values()) {
      if (r.type === 'call' || r.type === 'manual') calls.set(r.id, r);
    }
    return [...calls.values()].some((r) => competesWithCall(self, r));
  };

  const accepted: RelationRecord[] = [];
  const ordered = [...agentTriggers].sort(
    (a, b) =>
      byCodePoint(a.relation.type, b.relation.type) ||
      byCodePoint(a.relation.fromRef, b.relation.fromRef) ||
      byCodePoint(a.relation.toRef, b.relation.toRef),
  );
  for (const t of ordered) {
    const key = naturalKey(t.relation.type, t.relation.fromRef, t.relation.toRef);
    const relation = ctx.relations.get(key) ?? t.relation;
    const history = ctx.histories.get(relation.id) ?? [];
    const live = currentStances(history).some((a) => a.id === t.assertion.id);
    const a = t.assertion;
    const current =
      live &&
      (a.submissionId === null ||
        isCurrent(
          { from: relation.fromRef, to: relation.toRef, fromHash: a.fromHash, toHash: a.toHash },
          a.declared?.procedure ?? null,
          heads,
          opts.procedure,
        ));
    const verdict = evaluateRelationAutoAccept({
      relation,
      history,
      trigger: triggerOf(a, current, null, agentUploadedCaller(relation, trust)),
      liveNoLinks: noLinks.get(key) ?? 0,
      competingCall: relation.type === 'call' && (await competing(relation)),
      reconstructedEndpoint: hasReconstructedEndpoint([relation.fromRef, relation.toRef], trust),
      rules,
    });
    if (!verdict.accept) continue;
    accepted.push(await recordRelationAutoAccept(ctx, relation, a.id, verdict.rule, opts.by));
  }
  return accepted;
}

/** A placement proposal this write recorded. */
export interface PlacementTrigger {
  placement: PlacementRecord;
  assertion: PlacementAssertionRecord;
}

/** What the placement safeguards need of the chain, as loaded under the lock before the write. */
export interface PlacementAutoAcceptInputs {
  /** The procedure placement claims name (a pipeline proposal's currency). */
  procedure: DeclaredProcedure;
  /** `chainInputDigest` of the head (a pipeline proposal's `step_hash` basis). */
  chainDigest: string;
  /** `processInputDigest` per head process (the `process_hash` basis). */
  processDigests: ReadonlyMap<string, string>;
  /** The current input hash of a process. */
  hashOf(processRef: string): string;
  /** The `placement_input` rows before this write, by process. */
  priorRows: ReadonlyMap<string, { principalId: PrincipalId; outcome: string; inputHash: string }>;
  /** The live generation of each step element. */
  live: ReadonlyMap<string, number>;
  /** The causer (default: the context's actor). */
  by?: Cause;
}

/**
 * Evaluates the placement proposals this write recorded against the
 * project's enabled placement rules and records the acceptances, in natural
 * key order. The context must hold every placement of the chain with its
 * history (the safeguards look at the whole process). A process in a model
 * declared `reconstructed` or `as-told` is never accepted
 * (`reconstructed-endpoint`, owner decision 30 (2)): one more query, only
 * when a rule is enabled.
 *
 * @returns the placements accepted
 */
export async function autoAcceptPlacements(
  ctx: PlacementContext,
  triggers: readonly PlacementTrigger[],
  inputs: PlacementAutoAcceptInputs,
): Promise<PlacementRecord[]> {
  const agentTriggers = triggers.filter((t) => isAgentProposal(t.assertion));
  if (agentTriggers.length === 0) return [];
  const rules = await enabledRules(ctx.tx, ctx.projectId, 'placement');
  if (rules.length === 0) return [];
  const trust = trustByModel(await ctx.tx.revisions.headTrustRows(ctx.projectId));
  const accepted: PlacementRecord[] = [];
  const ordered = [...agentTriggers].sort(
    (a, b) =>
      byCodePoint(a.placement.elementId, b.placement.elementId) ||
      a.placement.generation - b.placement.generation ||
      byCodePoint(a.placement.processRef, b.placement.processRef),
  );
  for (const t of ordered) {
    const key = placementKey(
      t.placement.valueChainId,
      t.placement.elementId,
      t.placement.generation,
      t.placement.processRef,
    );
    const placement = ctx.placements.get(key) ?? t.placement;
    const history = ctx.histories.get(placement.id) ?? [];
    const a = t.assertion;
    const live = currentStances(history).some((s) => s.id === a.id);
    const current =
      live &&
      (a.submissionId === null ||
        (a.stepHash === inputs.chainDigest &&
          a.processHash === inputs.processDigests.get(placement.processRef) &&
          sameProcedure(a.declared?.procedure ?? null, inputs.procedure)));
    const processPlacements = [...ctx.placements.values()]
      .filter((p) => p.processRef === placement.processRef)
      .map((p) => ({ placement: p, history: ctx.histories.get(p.id) ?? [] }));
    const prior = inputs.priorRows.get(placement.processRef);
    const verdict = evaluatePlacementAutoAccept({
      placement,
      stepLive: inputs.live.get(placement.elementId) === placement.generation,
      processPlacements,
      trigger: triggerOf(a, current),
      priorVerdict: prior
        ? {
            principalId: prior.principalId,
            outcome: prior.outcome,
            current: prior.inputHash === inputs.hashOf(placement.processRef),
          }
        : null,
      reconstructedEndpoint: hasReconstructedEndpoint([placement.processRef], trust),
      rules,
    });
    if (!verdict.accept) continue;
    accepted.push(await recordPlacementAutoAccept(ctx, placement, a.id, verdict.rule, inputs.by));
  }
  return accepted;
}

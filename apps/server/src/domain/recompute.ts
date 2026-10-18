/**
 * Project-wide recomputation after an ingest or a delete (CONCEPT §2, §3):
 * run the rule tier over the head facts, record the rule's assertions,
 * recompute every relation's status and endpoint state, and replace the
 * findings. Since M6 S2b (§3.5) in two parts: the pure {@link planRecompute}
 * over the head facts, the relations and their histories, and
 * {@link writeRecompute}, which performs the plan inside the writing
 * transaction in the order the recompute always wrote. The import's dry run
 * plans over the would-be head facts and writes nothing.
 */
import { isDeepStrictEqual } from 'node:util';

import {
  newId,
  type Finding,
  type PrincipalId,
  type ProjectFacts,
  type ProjectId,
  type RelationId,
  type RelationType,
} from '@analyzr/contracts';

import { headFingerprints } from './fingerprints.ts';
import type { AnalysisPort, AssertionRecord, RelationRecord, RuleOutput, Tx } from './ports.ts';
import {
  byRelation,
  derivedState,
  naturalKey,
  prepareAssertion,
  refreshPatch,
  writeRefresh,
  type AssertionInput,
  type DerivedState,
} from './relation-state.ts';
import { currentStances, decisionsInForce, type AssertionView } from './status.ts';

export interface RecomputeContext {
  tx: Tx;
  projectId: ProjectId;
  /** The system principal `analyzr-rules` that rule assertions are recorded under. */
  rulesPrincipalId: PrincipalId;
  analysis: Pick<AnalysisPort, 'runRules'>;
}

export interface RecomputeSummary {
  /** New rule assertions (proposals and decisions). */
  asserted: number;
  withdrawn: number;
  endpointChanges: number;
  findings: number;
}

interface DesiredAssertion {
  kind: 'proposal' | 'decision';
  verdict: 'accept' | null;
  tier: AssertionView['tier'];
  confidence: number | null;
  fromFp: string | null;
  toFp: string | null;
}

function matches(stance: AssertionView, desired: DesiredAssertion): boolean {
  return (
    stance.kind === desired.kind &&
    stance.verdict === desired.verdict &&
    stance.tier === desired.tier &&
    stance.confidence === desired.confidence &&
    stance.fromFp === desired.fromFp &&
    stance.toFp === desired.toFp
  );
}

/** What a recompute reads: the head facts with the rule tier's result, the relations, their histories. */
export interface RecomputeInput {
  projectId: ProjectId;
  rulesPrincipalId: PrincipalId;
  projectFacts: ProjectFacts;
  /** The rule tier over `projectFacts` (`AnalysisPort.runRules`). */
  rules: RuleOutput;
  relations: readonly RelationRecord[];
  /** Every assertion of the project's relations, in seq order. */
  history: readonly (AssertionView & { relationId: RelationId })[];
}

type RelationTarget = Pick<RelationRecord, 'id' | 'type' | 'fromRef' | 'toRef'>;

/** One write of a recompute, in the order {@link writeRecompute} performs them. */
export type RecomputeStep =
  /**
   * A relation the rules derive: its rule assertion when the stance changes,
   * the row of a new relation (its state with that assertion), or the
   * relation's changed attributes.
   */
  | {
      kind: 'derive';
      target: RelationTarget;
      assertion: AssertionInput | null;
      insert: { state: DerivedState; attrs: RelationRecord['attrs'] } | null;
      attrs: RelationRecord['attrs'] | null;
      /** The relation before the run; `null` for a new one. */
      before: RelationRecord | null;
    }
  /** A rule stance the rules no longer derive, withdrawn. */
  | { kind: 'withdraw'; relation: RelationRecord; assertion: AssertionInput }
  /** A relation's derived state, written because it changed or got a new assertion. */
  | { kind: 'refresh'; relation: RelationRecord; patch: DerivedState; endpointChanged: boolean };

export interface RecomputePlan {
  steps: RecomputeStep[];
  findings: Finding[];
  summary: RecomputeSummary;
}

/**
 * Rule assertions follow the rules: on every run the rule tier re-derives its
 * relations. For each derived relation the rule principal holds exactly one
 * live stance, re-asserted when tier, confidence or endpoint fingerprints
 * change:
 * - an unambiguous `call` is a rule decision `accept` (the only decision the
 *   rule tier may make), unless a human has decided the relation; then the
 *   rule only proposes, so a human rejection stays until the endpoints change;
 * - everything else (key-tier messages and signals, ambiguous calls) is a
 *   rule proposal.
 * A rule stance the rules no longer derive is withdrawn, except an
 * acceptance whose endpoint is missing (deleted model or element): it stays
 * accepted with `endpoint_state = missing`, an open item.
 *
 * Pure: the new assertions get provisional seqs after every stored one, in
 * the order they will be written, so the states computed here are the ones
 * the writer stores (status reads only the order of a relation's history).
 * A new relation has a placeholder id (`rel_planned…`) until the writer
 * inserts it.
 */
export function planRecompute(input: RecomputeInput): RecomputePlan {
  const { projectId, rulesPrincipalId, projectFacts, rules } = input;
  const summary: RecomputeSummary = { asserted: 0, withdrawn: 0, endpointChanges: 0, findings: 0 };
  const steps: RecomputeStep[] = [];

  const fps = headFingerprints(projectFacts);
  /** Head fingerprints of both endpoints, by the fact kinds of the relation type. */
  const endpointsOf = (r: { type: RelationType; fromRef: string; toRef: string }) => ({
    from: fps.get(r.type, 'from', r.fromRef),
    to: fps.get(r.type, 'to', r.toRef),
  });

  const relations = new Map<string, RelationRecord>();
  for (const r of input.relations) relations.set(naturalKey(r.type, r.fromRef, r.toRef), r);
  const history = byRelation<AssertionView & { relationId: RelationId }>(input.history);
  let seq = input.history.reduce((m, a) => Math.max(m, a.seq), 0);
  let planCount = 0;
  /** The view of a planned assertion in its relation's history. */
  const planned = (relationId: RelationId, a: AssertionInput) =>
    ({
      ...a,
      id: newId('assertion'),
      projectId,
      relationId,
      seq: ++seq,
    }) satisfies AssertionRecord;
  /** Relations with a new assertion in this run (their version moves). */
  const touched = new Set<string>();

  const ruleInput = (
    a: Pick<AssertionRecord, 'kind' | 'verdict' | 'tier' | 'confidence' | 'fromFp' | 'toFp'>,
  ): AssertionInput => ({
    ...a,
    sourceKind: 'rule' as const,
    principalId: rulesPrincipalId,
    clientId: null,
    declared: null,
    submissionId: null,
    rationale: null,
    evidence: null,
    question: null,
    label: null,
    linkedRelationId: null,
    fromHash: null,
    toHash: null,
  });

  // 1. Derived relations: create, re-assert or leave as they are.
  const derived = new Set<string>();
  for (const d of rules.relations) {
    const key = naturalKey(d.type, d.from, d.to);
    if (derived.has(key)) continue;
    derived.add(key);

    const existing = relations.get(key);
    // A new relation's id comes from the writer, right before its event, as it always did:
    // ids of one millisecond do not sort by creation, and some readers list by id.
    const id = existing?.id ?? (`rel_planned${String(++planCount)}` as RelationId);
    const hist = history.get(id) ?? [];
    const stances = currentStances(hist);
    const ruleStance = stances.find((s) => s.principalId === rulesPrincipalId);
    const humanDecided = decisionsInForce(hist).some((s) => s.principalId !== rulesPrincipalId);
    // The policy limits rule decisions to `call` relations (CONCEPT §2).
    const decide = d.status === 'accepted' && d.type === 'call' && !humanDecided;
    const target = { id, type: d.type, fromRef: d.from, toRef: d.to };
    const current = endpointsOf(target);
    const desired: DesiredAssertion = {
      kind: decide ? 'decision' : 'proposal',
      verdict: decide ? 'accept' : null,
      tier: d.tier,
      confidence: d.confidence,
      fromFp: current.from ?? null,
      toFp: current.to ?? null,
    };

    const assertion = ruleStance && matches(ruleStance, desired) ? null : ruleInput(desired);
    if (assertion) {
      hist.push(planned(id, assertion));
      history.set(id, hist);
      touched.add(id);
      summary.asserted++;
    }

    let insert: { state: DerivedState; attrs: RelationRecord['attrs'] } | null = null;
    let attrs: RelationRecord['attrs'] | null = null;
    if (!existing) {
      const state = derivedState({ tier: d.tier }, hist, current);
      insert = { state, attrs: d.attrs };
      // Not in `relations`: steps 2 and 3 skip a new relation (its row holds the final state).
    } else if (!isDeepStrictEqual(existing.attrs, d.attrs)) {
      attrs = d.attrs;
      relations.set(key, { ...existing, attrs: d.attrs });
    }
    if (assertion || insert || attrs) {
      steps.push({ kind: 'derive', target, assertion, insert, attrs, before: existing ?? null });
    }
  }

  // 2. Rule stances the rules no longer derive.
  for (const [key, relation] of relations) {
    if (derived.has(key)) continue;
    const hist = history.get(relation.id) ?? [];
    const ruleStance = currentStances(hist).find((s) => s.principalId === rulesPrincipalId);
    if (!ruleStance) continue;
    const current = endpointsOf(relation);
    const missing = current.from === undefined || current.to === undefined;
    if (ruleStance.kind === 'decision' && missing) continue;
    const withdrawal = ruleInput({
      kind: 'withdrawal',
      verdict: null,
      tier: null,
      confidence: null,
      fromFp: current.from ?? null,
      toFp: current.to ?? null,
    });
    steps.push({ kind: 'withdraw', relation, assertion: withdrawal });
    hist.push(planned(relation.id, withdrawal));
    history.set(relation.id, hist);
    touched.add(relation.id);
    summary.withdrawn++;
  }

  // 3. Status, tier and endpoint state of every relation.
  for (const relation of relations.values()) {
    const { patch, changed, endpointChanged } = refreshPatch(
      relation,
      history.get(relation.id) ?? [],
      endpointsOf(relation),
    );
    if (!changed && !touched.has(relation.id)) continue;
    steps.push({ kind: 'refresh', relation, patch, endpointChanged });
    if (endpointChanged) summary.endpointChanges++;
  }

  summary.findings = rules.findings.length;
  return { steps, findings: rules.findings, summary };
}

/**
 * Performs a plan inside the writing transaction, in the recompute's order:
 * the derived relations (each assertion's event before its relation row,
 * the assertion after it), the withdrawals, the refreshes (each with its
 * `relation.endpoint_changed`), then the findings.
 */
export async function writeRecompute(
  tx: Pick<Tx, 'events' | 'relations' | 'assertions' | 'findings'>,
  projectId: ProjectId,
  plan: RecomputePlan,
  rulesPrincipalId: PrincipalId,
): Promise<void> {
  for (const step of plan.steps) {
    switch (step.kind) {
      case 'derive': {
        const target = step.before ? step.target : { ...step.target, id: newId('relation') };
        const assertion = step.assertion
          ? await prepareAssertion(tx, projectId, target, step.assertion)
          : null;
        if (step.insert) {
          await tx.relations.insert({
            ...target,
            projectId,
            ...step.insert.state,
            version: 1,
            attrs: step.insert.attrs,
          });
        } else if (step.attrs) {
          await tx.relations.update(projectId, target.id, { attrs: step.attrs });
        }
        if (assertion) await tx.assertions.insert(assertion);
        break;
      }
      case 'withdraw':
        await tx.assertions.insert(
          await prepareAssertion(tx, projectId, step.relation, step.assertion),
        );
        break;
      case 'refresh':
        await writeRefresh(tx, projectId, step.relation, step.patch, step.endpointChanged, {
          principalId: rulesPrincipalId,
          clientId: null,
        });
        break;
    }
  }
  await tx.findings.replace(projectId, plan.findings);
}

/** {@link planRecompute} over the stored head, then {@link writeRecompute}. */
export async function recomputeProject(ctx: RecomputeContext): Promise<RecomputeSummary> {
  const { tx, projectId, rulesPrincipalId } = ctx;
  const projectFacts = await tx.facts.headProjectFacts(projectId);
  const plan = planRecompute({
    projectId,
    rulesPrincipalId,
    projectFacts,
    rules: ctx.analysis.runRules(projectFacts),
    relations: await tx.relations.all(projectId),
    history: await tx.assertions.listForProject(projectId),
  });
  await writeRecompute(tx, projectId, plan, rulesPrincipalId);
  return plan.summary;
}

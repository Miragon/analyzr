/**
 * What an import or a model's deletion would change (M6 §3.5, slice S2b),
 * pure: the recompute planned over the would-be head facts
 * (`planRecompute`), read as the transitions it would make, the findings
 * before and after, the files' heads, and the live keys of the manifest's
 * system the import does not name. The dry runs and the deletion impact
 * call it; nothing is written. For an owner (M6 S2c-3) it also evaluates
 * the derived call proposals the plan records against their rules for
 * derived calls, as the write's `autoAcceptDerivedCalls` does.
 */
import {
  MAX_IMPACT_ITEMS,
  TrustReason,
  parseRef,
  type AutoAcceptRuleId,
  type Finding,
  type ImpactAutoAcceptedCall,
  type ImpactAutoAcceptedCalls,
  type ImpactEndpoint,
  type ImpactFile,
  type ImpactProposedCall,
  type ImpactProposedCalls,
  type ImpactRelation,
  type ImportImpact,
  type ProcessInfo,
  type RelationStatus,
  type RevisionSource,
  type RevisionTrust,
} from '@analyzr/contracts';

import {
  agentUploadedCaller,
  competesWithCall,
  derivedCallView,
  evaluateRelationAutoAccept,
  type AutoAcceptRuleRev,
} from './auto-accept/evaluate.ts';
import type { RelationRecord } from './ports.ts';
import { planRecompute, type RecomputeInput, type RecomputePlan } from './recompute.ts';
import { naturalKey } from './relation-state.ts';

/** The first {@link MAX_IMPACT_ITEMS} with their count. */
function capped<T>(items: readonly T[]): { count: number; items: T[] } {
  return { count: items.length, items: items.slice(0, MAX_IMPACT_ITEMS) };
}

const relationOf = (r: Pick<RelationRecord, 'type' | 'fromRef' | 'toRef'>): ImpactRelation => ({
  type: r.type,
  from: r.fromRef,
  to: r.toRef,
});

/** A finding's identity: its kind and refs (the detail is prose). */
const findingKey = (f: Finding): string => `${f.kind}\u0000${f.refs.join('\u0000')}`;

/**
 * What the dry run needs to tell which derived call proposals the owner's
 * rules would accept (M6 S2c-3): only for an owner, nobody else.
 */
export interface DerivedCallRules {
  /** The enabled rules for derived calls, in creation order (`enabledDerivedCallRules`). */
  rules: readonly AutoAcceptRuleRev[];
  /** Live no-links (current or stale) per natural key. */
  liveNoLinks: ReadonlyMap<string, number>;
}

type RelationAfter = Pick<
  RelationRecord,
  'id' | 'type' | 'fromRef' | 'toRef' | 'status' | 'endpointState'
>;

/**
 * The unique calls from derived models the owner's rules would accept in
 * the write (M6 S2c-3): the rule tier's proposals the plan records, each
 * evaluated as `autoAcceptDerivedCalls` evaluates it after the recompute
 * (natural key order, the relations as the plan leaves them, an acceptance
 * taking its call element), with `byRule` over all of them and how many of
 * them are among `proposed` (the natural keys `callsProposed` counts).
 */
function autoAcceptedCalls(
  input: RecomputeInput,
  plan: RecomputePlan,
  auto: DerivedCallRules,
  proposed: ReadonlySet<string>,
): ImpactAutoAcceptedCalls {
  const after = new Map<string, RelationAfter>();
  for (const r of input.relations) after.set(naturalKey(r.type, r.fromRef, r.toRef), r);
  for (const step of plan.steps) {
    if (step.kind === 'derive' && step.insert) {
      const t = step.target;
      after.set(naturalKey(t.type, t.fromRef, t.toRef), { ...t, ...step.insert.state });
    } else if (step.kind === 'refresh') {
      const r = step.relation;
      after.set(naturalKey(r.type, r.fromRef, r.toRef), { ...r, ...step.patch });
    }
  }
  const proposals = plan.steps
    .flatMap((step) =>
      step.kind === 'derive' && step.derivedCaller && step.assertion?.kind === 'proposal'
        ? [step.target]
        : [],
    )
    .sort(
      (a, b) =>
        byCodePoint(a.type, b.type) ||
        byCodePoint(a.fromRef, b.fromRef) ||
        byCodePoint(a.toRef, b.toRef),
    );
  const accepted: ImpactAutoAcceptedCall[] = [];
  const byRule = new Map<AutoAcceptRuleId, { ruleName: string; count: number; order: number }>();
  for (const target of proposals) {
    const key = naturalKey(target.type, target.fromRef, target.toRef);
    const relation = after.get(key);
    const history = (plan.histories.get(target.id) ?? []).map((a) => ({
      ...a,
      question: a.question ?? null,
    }));
    const proposal = history.findLast((a) => a.sourceKind === 'rule' && a.kind === 'proposal');
    if (!relation || !proposal) continue;
    const verdict = evaluateRelationAutoAccept({
      relation,
      history,
      trigger: {
        id: `planned-${key}`,
        principalId: proposal.principalId,
        sourceKind: proposal.sourceKind,
        kind: proposal.kind,
        tier: proposal.tier,
        confidence: proposal.confidence,
        question: null,
        llmModel: null,
        pipeline: false,
        current: true,
        derivedCall: derivedCallView(target.fromRef, input.trust),
        agentUploadedCaller: agentUploadedCaller(target, input.trust),
      },
      liveNoLinks: auto.liveNoLinks.get(key) ?? 0,
      competingCall: [...after.values()].some((r) => competesWithCall(relation, r)),
      rules: auto.rules,
    });
    if (!verdict.accept) continue;
    after.set(key, { ...relation, status: 'accepted' });
    const { rule } = verdict;
    accepted.push({ ...relationOf(target), ruleId: rule.ruleId, ruleName: rule.name });
    const counted = byRule.get(rule.ruleId) ?? { ruleName: rule.name, count: 0, order: rule.order };
    counted.count++;
    byRule.set(rule.ruleId, counted);
  }
  return {
    ...capped(accepted),
    ofProposed: accepted.filter((c) => proposed.has(naturalKey(c.type, c.from, c.to))).length,
    byRule: [...byRule]
      .sort(([, a], [, b]) => a.order - b.order)
      .map(([ruleId, { ruleName, count }]) => ({ ruleId, ruleName, count })),
  };
}

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The relations' part of an impact: the transitions a recompute over the
 * would-be head makes; with `auto` (an owner's dry run, M6 S2c-3) also the
 * derived calls their rules would accept. `ofProposed` says what
 * `autoAcceptedCalls.ofProposed` counts them among: every call
 * `callsProposed` counts (the import), or only those accepted before
 * (`was-accepted`: a trust review's `toProposed`, M6 S2c-4).
 */
export function relationImpact(
  input: RecomputeInput,
  findingsBefore: readonly Finding[],
  auto?: DerivedCallRules,
  ofProposed: 'proposed' | 'was-accepted' = 'proposed',
): Omit<ImportImpact, 'files' | 'absentKeys'> {
  const plan = planRecompute(input);
  const accepted: ImpactRelation[] = [];
  const callsProposed: ImpactProposedCall[] = [];
  const added: ImpactRelation[] = [];
  const withdrawn: ImpactRelation[] = [];
  const endpoints: ImpactEndpoint[] = [];
  /** A relation's status after the plan, where it moves. */
  const after = new Map<
    string,
    { before: RelationStatus | null; now: RelationStatus; r: ImpactRelation }
  >();
  for (const step of plan.steps) {
    switch (step.kind) {
      case 'derive':
        if (step.insert) {
          after.set(step.target.id, {
            before: null,
            now: step.insert.state.status,
            r: relationOf(step.target),
          });
        }
        break;
      case 'withdraw':
        withdrawn.push(relationOf(step.relation));
        break;
      case 'refresh': {
        const { relation, patch } = step;
        after.set(relation.id, {
          before: relation.status,
          now: patch.status,
          r: relationOf(relation),
        });
        if (
          relation.status === 'accepted' &&
          patch.status === 'accepted' &&
          patch.endpointState !== relation.endpointState &&
          (patch.endpointState === 'changed' || patch.endpointState === 'missing')
        ) {
          endpoints.push({ ...relationOf(relation), endpointState: patch.endpointState });
        }
        break;
      }
    }
  }
  for (const { before, now, r } of after.values()) {
    if (now === before) continue;
    // Only the rule tier writes here: an acceptance is a rule-tier call of a modelled caller
    // (decision 9 as amended by 24.2); a unique call of a derived caller only becomes a proposal.
    if (now === 'accepted') accepted.push(r);
    else if (now === 'proposed') {
      if (plan.derivedCalls.has(naturalKey(r.type, r.from, r.to))) {
        callsProposed.push({ ...r, wasAccepted: before === 'accepted' });
      } else added.push(r);
    }
  }
  const was = new Set(findingsBefore.map(findingKey));
  const will = new Set(plan.findings.map(findingKey));
  return {
    acceptedCalls: capped(accepted),
    callsProposed: proposedCalls(callsProposed, input.trust),
    ...(auto
      ? {
          autoAcceptedCalls: autoAcceptedCalls(
            input,
            plan,
            auto,
            new Set(
              callsProposed
                .filter((c) => ofProposed === 'proposed' || c.wasAccepted)
                .map((c) => naturalKey(c.type, c.from, c.to)),
            ),
          ),
        }
      : {}),
    proposalsAdded: capped(added),
    proposalsWithdrawn: capped(withdrawn),
    endpointsChanged: capped(endpoints),
    findingsAdded: capped(plan.findings.filter((f) => !was.has(findingKey(f)))),
    findingsResolved: capped(findingsBefore.filter((f) => !will.has(findingKey(f)))),
  };
}

/**
 * `ImportImpact.callsProposed` (M6 S2c): the capped list with its totals over
 * every call, each counted under its caller's first trust reason.
 */
function proposedCalls(
  calls: readonly ImpactProposedCall[],
  trust: RecomputeInput['trust'],
): ImpactProposedCalls {
  const byReason = new Map<TrustReason, number>();
  for (const c of calls) {
    // A derived caller has at least one reason (trustOf).
    const reason = trust.get(parseRef(c.from).modelKey)?.trust?.reasons[0];
    if (reason !== undefined) byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  }
  return {
    ...capped(calls),
    wasAccepted: calls.filter((c) => c.wasAccepted).length,
    byReason: TrustReason.options
      .filter((reason) => byReason.has(reason))
      .map((reason) => ({ reason, count: byReason.get(reason) ?? 0 })),
  };
}

/** A created or revised file: its key, the facts hashes before and after, the processes, its trust. */
export interface FileHeads {
  modelKey: string;
  previousFactsHash: string | null;
  factsHash: string;
  previousProcesses: readonly Pick<ProcessInfo, 'ref'>[];
  processes: readonly Pick<ProcessInfo, 'ref'>[];
  /** The trust class the uploaded revision would get (M6 S2c). */
  trust: RevisionTrust;
}

/** How each changed file would change its model (`ImportImpact.files`). */
export function fileImpact(files: readonly FileHeads[]): ImpactFile[] {
  return files.map((f) => {
    const refs = (ps: readonly Pick<ProcessInfo, 'ref'>[]) => new Set(ps.map((p) => p.ref));
    const before = refs(f.previousProcesses);
    const now = refs(f.processes);
    return {
      modelKey: f.modelKey,
      factsChanged: f.previousFactsHash !== f.factsHash,
      processesAdded: [...now].filter((r) => !before.has(r)).sort(),
      processesRemoved: [...before].filter((r) => !now.has(r)).sort(),
      trust: f.trust,
    };
  });
}

/** True if a tool folder lies in a scope (the folder itself or below one of its folders). */
function inScope(path: string | undefined, scope: readonly string[] | undefined): boolean {
  if (scope === undefined) return true;
  if (path === undefined) return false;
  return scope.some((folder) => path === folder || path.startsWith(`${folder}/`));
}

/**
 * The live keys of the manifest's source system an import does not name
 * (M6 §3.5): only those whose declared tool folder lies in the manifest's
 * `source.scope` (the whole system without one), so a partial export does
 * not list every other area. Information only (decision 7). `sources` are
 * the live models' uploaded sources by key (`uploadedSources`).
 */
export function absentKeys(
  sources: ReadonlyMap<string, RevisionSource>,
  manifest: { system: string; scope?: readonly string[] | undefined } | null,
  imported: ReadonlySet<string>,
): string[] {
  if (manifest === null) return [];
  return [...sources]
    .filter(
      ([key, source]) =>
        !imported.has(key) &&
        source.system === manifest.system &&
        inScope(source.externalPath, manifest.scope),
    )
    .map(([key]) => key)
    .sort();
}

/** The whole impact (`ImportImpact`), from its parts; `auto` only for an owner (M6 S2c-3). */
export function importImpact(
  input: RecomputeInput,
  findingsBefore: readonly Finding[],
  files: readonly FileHeads[],
  absent: readonly string[],
  auto?: DerivedCallRules,
): ImportImpact {
  return {
    files: fileImpact(files),
    ...relationImpact(input, findingsBefore, auto),
    absentKeys: capped(absent),
  };
}

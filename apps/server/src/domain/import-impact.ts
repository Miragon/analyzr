/**
 * What an import or a model's deletion would change (M6 §3.5, slice S2b),
 * pure: the recompute planned over the would-be head facts
 * (`planRecompute`), read as the transitions it would make, the findings
 * before and after, the files' heads, and the live keys of the manifest's
 * system the import does not name. The dry runs and the deletion impact
 * call it; nothing is written. For an owner (M6 S2c-3) it also evaluates
 * the derived call proposals the plan records against their rules for
 * derived calls, as the write's `autoAcceptDerivedCalls` does. Since the
 * S2b follow-up it also plans the relations tasks the write queues and
 * cancels (`planQueue`, as `queueAnalysis` does) and the pairs agents judge
 * around the queued models (`pairsToJudge`), with the judgements the write
 * makes non-current (`judgementShift`), and for a project with a live value
 * chain the accepted placements whose process changes and the placement
 * task (`placementImpact`, over the relations the write leaves).
 */
import {
  MAX_IMPACT_ITEMS,
  TrustReason,
  parseRef,
  type AutoAcceptRuleId,
  type Candidate,
  type DeclaredProcedure,
  type Finding,
  type ImpactAutoAcceptedCall,
  type ImpactAutoAcceptedCalls,
  type ImpactCancelledTask,
  type ImpactEndpoint,
  type ImpactFile,
  type ImpactProposedCall,
  type ImpactProposedCalls,
  type ImpactRelation,
  type ImpactRelationsTasks,
  type ImportImpact,
  type ProcessInfo,
  type ProjectFacts,
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
import { currentPairs, judgementShift, pairsToJudge, type JudgementBasis } from './judgements.ts';
import type { ModelTaskDetail, RelationRecord } from './ports.ts';
import { planQueue } from './queue-plan.ts';
import { planRecompute, type RecomputeInput, type RecomputePlan } from './recompute.ts';
import { naturalKey } from './relation-state.ts';
import { placementImpact, type ChainRead } from './value-chain/model-impact.ts';

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

/** A relation as a plan leaves it ({@link relationsAfter}). */
export type RelationAfter = Pick<
  RelationRecord,
  'id' | 'type' | 'fromRef' | 'toRef' | 'status' | 'endpointState'
>;

/**
 * Every relation as the plan leaves it, by natural key: the stored ones
 * with their refreshed state, and the new ones the rules derive (by their
 * placeholder id). For an owner, {@link autoAcceptedCalls} then marks the
 * derived calls their rules accept, so the map is what the claims after the
 * write read.
 */
export function relationsAfter(
  input: Pick<RecomputeInput, 'relations'>,
  plan: Pick<RecomputePlan, 'steps'>,
): Map<string, RelationAfter> {
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
  return after;
}

/**
 * The unique calls from derived models the owner's rules would accept in
 * the write (M6 S2c-3): the rule tier's proposals the plan records, each
 * evaluated as `autoAcceptDerivedCalls` evaluates it after the recompute
 * (natural key order, the relations as the plan leaves them, an acceptance
 * taking its call element), with `byRule` over all of them and how many of
 * them are among `proposed` (the natural keys `callsProposed` counts).
 * Marks each accepted call in `after` ({@link relationsAfter}).
 */
function autoAcceptedCalls(
  input: RecomputeInput,
  plan: RecomputePlan,
  auto: DerivedCallRules,
  proposed: ReadonlySet<string>,
  after: Map<string, RelationAfter>,
): ImpactAutoAcceptedCalls {
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

/**
 * Every relation as a write over `input` leaves it, by natural key (what the
 * claims after it read; the amendment cost, S2b follow-up): the plan's
 * ({@link relationsAfter}) and, with `auto` (an owner, M6 S2c-3), the
 * derived calls their rules accept.
 */
export function plannedRelations(
  input: RecomputeInput,
  auto?: DerivedCallRules,
): Map<string, RelationAfter> {
  const plan = planRecompute(input);
  const after = relationsAfter(input, plan);
  if (auto) autoAcceptedCalls(input, plan, auto, new Set(), after);
  return after;
}

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The relations' part of an impact ({@link relationImpact}). */
type RelationImpact = Omit<ImportImpact, 'files' | 'absentKeys' | 'relationsTasks'>;

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
): RelationImpact {
  const plan = planRecompute(input);
  return plannedRelationImpact(
    input,
    plan,
    relationsAfter(input, plan),
    findingsBefore,
    auto,
    ofProposed,
  );
}

/** {@link relationImpact} over a plan; `relations` gets the calls an owner’s rules accept. */
function plannedRelationImpact(
  input: RecomputeInput,
  plan: RecomputePlan,
  relations: Map<string, RelationAfter>,
  findingsBefore: readonly Finding[],
  auto: DerivedCallRules | undefined,
  ofProposed: 'proposed' | 'was-accepted',
): RelationImpact {
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
            relations,
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
 * the live models' identities by key (`uploadedSources`: system and tool
 * folder from each model's newest identity row, M6 S2b follow-up step 5).
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

/** An open relations task as the dry run reads it: its facts, and who holds it with what. */
export type OpenRelationsTask = Pick<
  ModelTaskDetail,
  'state' | 'factsHash' | 'claimedByHandle' | 'assignment'
>;

/**
 * What the relations tasks of a dry run read (M6 S2b follow-up), in the
 * dry run's snapshot.
 */
export interface TaskInput {
  /** Every live agent judgement (pipeline proposals and no-links) with its basis. */
  judgements: readonly JudgementBasis[];
  /** The head `facts_hash` of every live model now (`headHashes`). */
  before: ReadonlyMap<string, string>;
  /** The procedure relations claims name. */
  procedure: DeclaredProcedure;
  /** The open (queued or claimed) relations task of each model, by key. */
  open: ReadonlyMap<string, OpenRelationsTask>;
  /**
   * The `facts_hash` of a model's latest done task, where the plan needs it
   * (no open task and possibly a layout-only change); `null` otherwise.
   */
  doneFactsHash: (modelKey: string) => string | null;
  /** A model's candidates over the would-be head facts (`AnalysisPort.candidates`). */
  candidatesOf: (modelKey: string) => readonly Candidate[];
  /** The deleted model's key (the deletion impact): its task is cancelled, nothing queued. */
  deleted?: string;
}

/** An open task as the impact names it when the write cancels it. */
function cancelledTask(modelKey: string, task: OpenRelationsTask): ImpactCancelledTask {
  const claimed = task.state === 'claimed';
  return {
    modelKey,
    state: claimed ? 'claimed' : 'queued',
    claimedBy: claimed ? task.claimedByHandle : null,
    assigned: claimed ? (task.assignment?.length ?? null) : null,
  };
}

/**
 * The relations tasks the write queues and cancels (`planQueue` per created
 * or revised file, as `queueAnalysis` plans it; a deletion cancels the
 * model's open task and queues nothing), the pairs agents judge around the
 * queued models (`pairsToJudge` over the would-be candidates and the
 * relations after the plan, without the judgements current after the
 * write; an upper bound of what the queued tasks' claims are assigned) and
 * those of them whose current judgement the write makes non-current
 * (`judgementShift`).
 */
function relationsTasks(
  files: readonly FileHeads[],
  tasks: TaskInput,
  relations: ReadonlyMap<string, RelationAfter>,
): ImpactRelationsTasks {
  const after = new Map(tasks.before);
  for (const f of files) after.set(f.modelKey, f.factsHash);
  if (tasks.deleted !== undefined) after.delete(tasks.deleted);
  const queued: string[] = [];
  const cancelled: ImpactCancelledTask[] = [];
  for (const f of files) {
    const open = tasks.open.get(f.modelKey) ?? null;
    const plan = planQueue({
      previousFactsHash: f.previousFactsHash,
      factsHash: f.factsHash,
      open,
      doneFactsHash: tasks.doneFactsHash(f.modelKey),
    });
    if (plan.queue) queued.push(f.modelKey);
    if (plan.cancel) cancelled.push(cancelledTask(f.modelKey, plan.cancel));
  }
  const gone = tasks.deleted === undefined ? undefined : tasks.open.get(tasks.deleted);
  if (tasks.deleted !== undefined && gone) cancelled.push(cancelledTask(tasks.deleted, gone));
  const pairs = pairsToJudge({
    models: queued,
    candidatesOf: tasks.candidatesOf,
    relations: relations.values(),
    judged: currentPairs(tasks.judgements, after, tasks.procedure),
  });
  const lost = judgementShift({
    judgements: tasks.judgements,
    before: tasks.before,
    after,
    procedure: tasks.procedure,
  });
  const rejudged = [...pairs]
    .filter(([key]) => lost.has(key))
    .map(([, p]) => p)
    .sort(
      (a, b) =>
        byCodePoint(a.type, b.type) || byCodePoint(a.from, b.from) || byCodePoint(a.to, b.to),
    );
  return {
    queued: capped(queued.sort(byCodePoint)),
    cancelled: capped(
      cancelled.sort(
        (a, b) =>
          Number(b.state === 'claimed') - Number(a.state === 'claimed') ||
          byCodePoint(a.modelKey, b.modelKey),
      ),
    ),
    claimed: cancelled.filter((t) => t.state === 'claimed').length,
    pairs: pairs.size,
    rejudged: capped(rejudged),
  };
}

/**
 * What the value chain's part of an impact reads (S2b follow-up): the live
 * chain, the stored head facts, whether the write changes a model's head
 * (and so syncs the chain: a created or revised file, a deletion), and
 * whether it queues the placement task (a created or revised file with
 * other facts; never a deletion).
 */
export interface ChainInput extends ChainRead {
  headFacts: Pick<ProjectFacts, 'models'>;
  headChange: boolean;
  triggered: boolean;
}

/**
 * The whole impact (`ImportImpact`), from its parts, planning the recompute
 * once; `auto` only for an owner (M6 S2c-3); `chain` only for a project with
 * a live value chain (its fields are absent otherwise).
 */
export function importImpact(
  input: RecomputeInput,
  findingsBefore: readonly Finding[],
  files: readonly FileHeads[],
  absent: readonly string[],
  auto: DerivedCallRules | undefined,
  tasks: TaskInput,
  chain?: ChainInput,
): ImportImpact {
  const plan = planRecompute(input);
  const relations = relationsAfter(input, plan);
  // Marks the calls an owner's rules accept in `relations`, which the tasks and the chain read.
  const relationPart = plannedRelationImpact(
    input,
    plan,
    relations,
    findingsBefore,
    auto,
    'proposed',
  );
  return {
    files: fileImpact(files),
    ...relationPart,
    absentKeys: capped(absent),
    relationsTasks: relationsTasks(files, tasks, relations),
    ...(chain
      ? placementImpact({
          ...chain,
          before: { projectFacts: chain.headFacts, relations: input.relations },
          after: { projectFacts: input.projectFacts, relations: [...relations.values()] },
        })
      : {}),
  };
}

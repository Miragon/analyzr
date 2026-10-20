/**
 * The value chain's part of what an import or a model's deletion would
 * change (M6 S2b follow-up), pure: the accepted placements whose process the
 * write changes or removes, and the chain's placement task after it. The
 * dry runs (`previewIngest`, `deletionImpact`) call it through
 * `importImpact`; nothing is written.
 *
 * The rule tier: every head change (a created or revised file, a
 * layout-only one included, a deletion) runs `syncValueChainAfterModels`,
 * whose rule tier proposes and withdraws over the would-be head processes.
 * The dry run plans the same writes ({@link planRulePlacements}) and appends
 * them to the stored histories with seqs after every stored one: a process
 * the rule tier records on gets a new non-agent seq in its input hash
 * (`lastNonAgentSeqs`), as in the write. That is not only a new or renamed
 * process: a proposal a human decision suppressed at the last run is
 * recorded once that decision is gone (an auto-acceptance revoked since).
 *
 * The placements: an accepted placement keeps its decision's anchor
 * (`recomputeStatusOf`), so the would-be process fingerprints turn it
 * `changed` or `missing` exactly where the write's refreshes record
 * `placement.endpoint_changed` (`refreshPlacement`); held ones are not
 * named, as `endpointsChanged` names accepted relations only.
 *
 * The task: as `afterHeadChange` and `queuePlacementTask` decide it. Only a
 * created or revised file with other facts triggers it (a layout-only
 * upload or a deletion never queues, M4 §3.2); an open task is left alone
 * (`open`) or, while an agent holds it, gets `requeue_after` (`deferred`);
 * else a task is queued when an open process is due. Due-ness comes from
 * {@link pipelineInputs} over the head and over the would-be head (its
 * facts, the relations the write leaves, the placements and histories after
 * the rule tier, the agent's verdicts as stored). While an agent holds the
 * task, the processes its claim shows count as judged on the input the
 * claim showed (its submission records those verdicts): `due` is what its
 * follow-up then offers, and a process the write changes under the claim is
 * newly due and placed again. The integration tests compare each dry run
 * with the write (`value-chain-ingest`, `placement-pipeline`).
 */
import {
  MAX_IMPACT_ITEMS,
  type DeclaredProcedure,
  type Fact,
  type ImpactPlacement,
  type ImpactPlacementTask,
  type ImportImpact,
  type PlacementId,
  type PrincipalId,
  type ProjectFacts,
  type ValueChainId,
} from '@analyzr/contracts';

import { compareStoredFacts } from '../fact-order.ts';
import type {
  ChainTaskRecord,
  PlacementRecord,
  RelationRecord,
  StoredPlacementAssertion,
  StoredPlacementInput,
} from '../ports.ts';
import {
  derivedPlacementState,
  endpointsOf,
  placementEndpoints,
  processFingerprints,
  recomputePlacementStatus,
  type PlacementAssertionView,
  type PlacementEndpoints,
} from './placement-state.ts';
import { pipelineInputs } from './queue.ts';
import { RULE_CONFIDENCE, planRulePlacements } from './rules.ts';
import { OUTSIDE } from './steps.ts';
import type { ChainStructure } from './structure.ts';

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** What a dry run reads of the project's live chain (`readChain` in `ingest.ts`). */
export interface ChainRead {
  valueChainId: ValueChainId;
  /** The structure of the chain's head. */
  structure: ChainStructure;
  /** The live generation of each element id, `@outside` included. */
  live: ReadonlyMap<string, number>;
  /** Every placement of the chain, obsolete ones included. */
  placements: readonly PlacementRecord[];
  /** The assertions per placement, in seq order. */
  histories: ReadonlyMap<PlacementId, readonly StoredPlacementAssertion[]>;
  /** The agent's last verdict per process (`placement_input`). */
  rows: ReadonlyMap<string, Pick<StoredPlacementInput, 'inputHash'>>;
  /** The chain's open (queued or claimed) placement task. */
  openTask: Pick<ChainTaskRecord, 'state'> | null;
  /** While an agent holds the task: the input hash of each process its claim shows. */
  claimed: ReadonlyMap<string, Pick<StoredPlacementInput, 'inputHash'>>;
  /** The procedure placement claims name. */
  procedure: DeclaredProcedure;
  /** The rule tier's principal, as the histories name it (a dry run never creates it). */
  rulesPrincipalId: PrincipalId;
}

/** A head as the pipeline sees it: its facts and its relations. */
export interface ChainSide {
  projectFacts: Pick<ProjectFacts, 'models'>;
  relations: readonly Pick<RelationRecord, 'status' | 'fromRef' | 'toRef'>[];
}

export interface PlacementImpactInput extends ChainRead {
  /** The stored head and its relations. */
  before: ChainSide;
  /** The would-be head and the relations the write leaves (an owner's rule acceptances included). */
  after: ChainSide;
  /**
   * Whether the write changes a model's head (a created or revised file, a
   * layout-only one included, or a deletion): only then does it run the
   * chain's sync (the rule tier, the endpoint refresh).
   */
  headChange: boolean;
  /** Whether the write queues the placement task (a created or revised file with other facts). */
  triggered: boolean;
}

/**
 * Every fact of a head in the order `facts.head` lists it
 * (`compareStoredFacts`: by model key, then kind and element id in code
 * point order). An extracted model lists its kinds in the enum's order
 * instead, and a process's first start and end labels (`processOwnFields`)
 * follow the order.
 */
export function headFactOrder(projectFacts: Pick<ProjectFacts, 'models'>): Fact[] {
  return projectFacts.models.flatMap((m) => m.facts).sort(compareStoredFacts);
}

/** A placement as the pipeline reads it. */
type PipelinePlacement = Pick<
  PlacementRecord,
  'id' | 'elementId' | 'generation' | 'processRef' | 'status'
>;

/** The chain's placements and their histories on one side of the write. */
interface ChainHistory {
  placements: readonly PipelinePlacement[];
  histories: ReadonlyMap<PlacementId, readonly PlacementAssertionView[]>;
}

/** The open and due processes of one side ({@link pipelineInputs}). */
function dueOf(
  input: ChainRead,
  side: ChainSide,
  chain: ChainHistory,
  verdicts: ChainRead['rows'],
) {
  const facts = headFactOrder(side.projectFacts);
  return pipelineInputs(
    {
      structure: input.structure,
      live: input.live,
      processFacts: facts.filter((f) => f.kind === 'process'),
    },
    chain.placements,
    chain.histories,
    facts,
    side.relations,
    verdicts,
    input.procedure,
  );
}

/**
 * The placements and histories after the write's rule tier
 * ({@link planRulePlacements} over the would-be head processes): each
 * proposal it records and each withdrawal appended with a seq after every
 * stored one, a new placement for a proposal on a new spot, and the status
 * of each placement it touches recomputed from its new history.
 */
function afterRuleTier(
  input: ChainRead,
  processFacts: readonly Fact[],
  endpoints: PlacementEndpoints,
): ChainHistory {
  const plan = planRulePlacements({
    valueChainId: input.valueChainId,
    steps: input.structure.steps,
    processFacts,
    live: input.live,
    endpoints,
    placements: input.placements,
    histories: input.histories,
    rulesPrincipalId: input.rulesPrincipalId,
  });
  let seq = 0;
  for (const history of input.histories.values()) {
    for (const a of history) seq = Math.max(seq, a.seq);
  }
  const placements = new Map<PlacementId, PipelinePlacement>(
    input.placements.map((p) => [p.id, p]),
  );
  const histories = new Map<PlacementId, readonly PlacementAssertionView[]>(input.histories);
  const append = (p: PipelinePlacement, a: Omit<PlacementAssertionView, 'seq'>) => {
    seq++;
    const history = [...(histories.get(p.id) ?? []), { ...a, seq }];
    histories.set(p.id, history);
    placements.set(p.id, { ...p, status: recomputePlacementStatus(history).status });
  };
  for (const p of plan.proposals) {
    if (!p.records) continue;
    const { elementId, processRef } = p.derived;
    append(
      p.existing ?? {
        id: `plc_dry-run:${elementId}:${p.generation}:${processRef}` as PlacementId,
        elementId,
        generation: p.generation,
        processRef,
        status: 'proposed',
      },
      {
        kind: 'proposal',
        verdict: null,
        sourceKind: 'rule',
        principalId: input.rulesPrincipalId,
        tier: 'key',
        confidence: RULE_CONFIDENCE,
        stepFp: p.stepFp,
        processFp: p.processFp,
      },
    );
  }
  for (const { placement, stance } of plan.withdrawals) {
    const current = endpointsOf(endpoints, placement);
    append(placement, {
      kind: 'withdrawal',
      verdict: null,
      sourceKind: stance.sourceKind,
      principalId: stance.principalId,
      tier: null,
      confidence: null,
      stepFp: current.step ?? null,
      processFp: current.process ?? null,
    });
  }
  return { placements: [...placements.values()], histories };
}

/** The accepted placements whose process the write turns `changed` or `missing`, by process, then step. */
function changedPlacements(
  input: ChainRead,
  endpoints: PlacementEndpoints,
  histories: ChainHistory['histories'],
): ImpactPlacement[] {
  const out: ImpactPlacement[] = [];
  for (const p of input.placements) {
    if (p.status !== 'accepted') continue;
    const next = derivedPlacementState(p, histories.get(p.id) ?? [], endpointsOf(endpoints, p));
    // `refreshPlacement` records `endpoint_changed` for these (an accepted placement stays so).
    if (next.status !== 'accepted' || next.endpointState === p.endpointState) continue;
    if (next.endpointState === 'ok') continue;
    out.push({
      step: p.elementId,
      stepName:
        p.elementId === OUTSIDE ? null : (input.structure.byId.get(p.elementId)?.name ?? null),
      process: p.processRef,
      endpointState: next.endpointState,
    });
  }
  return out.sort((a, b) => byCodePoint(a.process, b.process) || byCodePoint(a.step, b.step));
}

/**
 * The value chain's part of an impact (`ImportImpact.placementsChanged`,
 * `placementTask`): the accepted placements whose process the write changes
 * or removes, and the placement task's outcome with the processes due after
 * the write, those newly due, and those of them an agent had judged.
 */
export function placementImpact(
  input: PlacementImpactInput,
): Required<Pick<ImportImpact, 'placementsChanged' | 'placementTask'>> {
  const processFacts = headFactOrder(input.after.projectFacts).filter((f) => f.kind === 'process');
  const endpoints = placementEndpoints(
    input.live,
    input.structure.stepFingerprints,
    processFingerprints(processFacts),
  );
  const stored: ChainHistory = { placements: input.placements, histories: input.histories };
  const chainAfter = input.headChange ? afterRuleTier(input, processFacts, endpoints) : stored;
  // A held claim's verdicts land with its submission, on the input the claim showed.
  const verdicts = input.claimed.size > 0 ? new Map([...input.rows, ...input.claimed]) : input.rows;
  const before = dueOf(input, input.before, stored, verdicts);
  const after = dueOf(input, input.after, chainAfter, verdicts);
  const dueBefore = new Set(before.due.map((d) => d.process));
  const openBefore = new Set(before.open);
  const newlyDue = after.due.filter((d) => !dueBefore.has(d.process));
  // Open and not due before: an agent's verdict (or the held claim) matched its input then.
  const again = newlyDue.filter((d) => openBefore.has(d.process));
  const changed = changedPlacements(input, endpoints, chainAfter.histories);
  return {
    placementsChanged: { count: changed.length, items: changed.slice(0, MAX_IMPACT_ITEMS) },
    placementTask: {
      outcome: taskOutcome(input.triggered, input.openTask, after.due.length),
      due: after.due.length,
      newlyDue: newlyDue.length,
      again: again.length,
    },
  };
}

/** The outcome `queuePlacementTask` gives after a model change ('models changed' defers). */
function taskOutcome(
  triggered: boolean,
  open: Pick<ChainTaskRecord, 'state'> | null,
  due: number,
): ImpactPlacementTask['outcome'] {
  if (!triggered) return 'not-triggered';
  if (open?.state === 'queued') return 'open';
  if (open) return 'deferred';
  return due > 0 ? 'queued' : 'nothing-due';
}

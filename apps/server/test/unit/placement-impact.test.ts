/**
 * The value chain's part of a dry run's impact (M6 S2b follow-up), pure
 * (`placementImpact`): the accepted placements whose process the write turns
 * `changed` (a rename) or `missing` (a removed process, a deleted model),
 * never one on a removed step (already missing) or a held one; `@outside`
 * included. Due-ness over the head and the would-be head: a new process, an
 * own-field change (not its sibling), a newly accepted call (both ends), a
 * step link that resolves (every open process), with `again` for the
 * processes an agent had judged; the rule tier the write runs (a proposal
 * a revoked auto-acceptance no longer suppresses, one on a new spot, a
 * withdrawal; never a duplicate or a suppressed one, nothing without a head
 * change); a held claim's processes judged on the input it showed; the
 * outcome as `queuePlacementTask` decides it; the would-be facts in the
 * head's order, so more than five start events of mixed kinds keep their
 * digest. Synthetic data only.
 */
import { createHash } from 'node:crypto';

import { compareFacts, normalizeKey } from '@analyzr/bpmn-facts';
import type {
  DeclaredProcedure,
  Fact,
  FactKind,
  ModelFacts,
  PrincipalId,
  ProjectFacts,
  Ref,
  RelationStatus,
} from '@analyzr/contracts';
import { describe, expect, it } from 'vitest';

import type { PlacementRecord, StoredPlacementAssertion } from '../../src/domain/ports.ts';
import { prepareRevision } from '../../src/domain/value-chain/document.ts';
import {
  headFactOrder,
  placementImpact,
  type ChainRead,
  type ChainSide,
} from '../../src/domain/value-chain/model-impact.ts';
import { pipelineInputs } from '../../src/domain/value-chain/queue.ts';
import { derivedRulePlacements } from '../../src/domain/value-chain/rules.ts';
import { OUTSIDE, OUTSIDE_FINGERPRINT } from '../../src/domain/value-chain/steps.ts';
import type { ChainStructure } from '../../src/domain/value-chain/structure.ts';
import { factsByProcess, processOwnFields } from '../../src/domain/value-chain/unplaced.ts';
import { chain, type StepSpec } from '../support/value-chain.ts';

const PROC: DeclaredProcedure = { id: 'analyzr-placements', version: '0.1.0' };
const HUMAN = 'prn_HUMAN' as PrincipalId;
const RULES = 'prn_RULES' as PrincipalId;
const P1 = 'm/eins#P_Eins' as Ref;
const P2 = 'm/eins#P_Zwei' as Ref;
const Q = 'm/zwei#P_Q' as Ref;
const N = 'm/drei#P_Neu' as Ref;

const STEPS: StepSpec[] = [
  { id: 'step-a', name: 'Antrag' },
  { id: 'step-b', name: 'Bescheid' },
];
const structureOf = (steps: StepSpec[] = STEPS): ChainStructure =>
  prepareRevision(chain({ steps })).structure;
const liveOf = (s: ChainStructure) =>
  new Map<string, number>([...s.steps.map((x) => [x.elementId, 1] as const), [OUTSIDE, 1]]);

const fp = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 12);

function fact(modelKey: string, f: Pick<Fact, 'kind' | 'elementId'> & Partial<Fact>): Fact {
  const label = f.label ?? '';
  return {
    modelKey,
    ref: `${modelKey}#${f.elementId}`,
    processId: null,
    scope: 'process',
    eventDef: null,
    label,
    keyRaw: label,
    keyNorm: normalizeKey(label),
    fingerprint: fp(`${f.kind}|${normalizeKey(label)}`),
    attrs: {},
    ...f,
  };
}

interface ProcessSpec {
  id: string;
  name: string;
  doc?: string;
  starts?: { kind: Extract<FactKind, 'evt_start' | 'msg_catch'>; id: string; label: string }[];
  /** A call activity in the process. */
  call?: string;
  task?: string;
}

/** A model's facts in the extractor's order (kinds in the enum's order). */
function model(modelKey: string, processes: ProcessSpec[]): ModelFacts {
  const facts: Fact[] = [];
  for (const p of processes) {
    facts.push(
      fact(modelKey, {
        kind: 'process',
        elementId: p.id,
        processId: p.id,
        label: p.name,
        attrs: { elementType: 'bpmn:Process', ...(p.doc ? { documentation: p.doc } : {}) },
      }),
    );
    for (const s of p.starts ?? []) {
      facts.push(
        fact(modelKey, {
          kind: s.kind,
          elementId: s.id,
          processId: p.id,
          label: s.label,
          attrs: { elementType: 'bpmn:StartEvent' },
        }),
      );
    }
    if (p.call) {
      facts.push(
        fact(modelKey, {
          kind: 'call',
          elementId: p.call,
          processId: p.id,
          label: 'Aufruf',
          attrs: { elementType: 'bpmn:CallActivity' },
        }),
      );
    }
    if (p.task) {
      facts.push(
        fact(modelKey, { kind: 'task', elementId: `${p.id}_T`, processId: p.id, label: p.task }),
      );
    }
  }
  return {
    modelKey,
    factsVersion: 'test',
    processes: processes.map((p) => ({
      ref: `${modelKey}#${p.id}`,
      processId: p.id,
      name: p.name,
      participantName: null,
      isExecutable: false,
    })),
    facts: facts.sort(compareFacts),
    messageFlows: [],
  };
}

const EINS = (over: Partial<Record<'eins' | 'zwei', Partial<ProcessSpec>>> = {}) =>
  model('m/eins', [
    { id: 'P_Eins', name: 'Erfassung', call: 'Call_Q', ...over.eins },
    { id: 'P_Zwei', name: 'Versand', ...over.zwei },
  ]);
const ZWEI = (name = 'Prüfung') => model('m/zwei', [{ id: 'P_Q', name }]);
const DREI = () => model('m/drei', [{ id: 'P_Neu', name: 'Neuer Vorgang' }]);
const head = (...models: ModelFacts[]): ProjectFacts => ({
  models: [...models].sort((a, b) => (a.modelKey < b.modelKey ? -1 : 1)),
});

const processFp = (pf: ProjectFacts, ref: Ref) =>
  pf.models.flatMap((m) => m.facts).find((f) => f.kind === 'process' && f.ref === ref)
    ?.fingerprint ?? null;

let ids = 0;
function placement(
  s: ChainStructure,
  pf: ProjectFacts,
  elementId: string,
  processRef: Ref,
  status: RelationStatus,
  generation = 1,
): { placement: PlacementRecord; history: StoredPlacementAssertion[] } {
  ids++;
  const stepFp =
    elementId === OUTSIDE ? OUTSIDE_FINGERPRINT : (s.stepFingerprints.get(elementId) ?? 'gone');
  const record: PlacementRecord = {
    id: `plc_${String(ids).padStart(26, '0')}`,
    projectId: 'prj_X',
    valueChainId: 'vch_X',
    elementId,
    generation,
    processRef,
    status,
    endpointState: 'ok',
    tier: 'manual',
    confidence: null,
    version: 1,
    stepFp,
    processFp: processFp(pf, processRef),
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
  const verdict = status === 'accepted' ? 'accept' : status === 'held' ? 'hold' : 'reject';
  const history: StoredPlacementAssertion[] = [
    {
      id: `pas_${ids}` as StoredPlacementAssertion['id'],
      projectId: record.projectId,
      placementId: record.id,
      seq: ids,
      kind: 'decision',
      verdict,
      sourceKind: 'human',
      principalId: HUMAN,
      clientId: 'web',
      declared: null,
      submissionId: null,
      tier: 'manual',
      confidence: null,
      rationale: null,
      evidence: null,
      question: null,
      label: null,
      linkedPlacementId: null,
      stepFp: record.stepFp,
      processFp: record.processFp,
      stepHash: null,
      processHash: null,
      handle: 'owner',
      createdAt: new Date(ids * 1000),
    },
  ];
  return { placement: record, history };
}

type Placed = ReturnType<typeof placement>;

/** A relation between two refs (only status and ends count). */
const rel = (fromRef: string, toRef: string, status: RelationStatus) => ({
  status,
  fromRef: fromRef as Ref,
  toRef: toRef as Ref,
});

function chainRead(
  s: ChainStructure,
  placed: Placed[] = [],
  extra: Partial<Omit<ChainRead, 'valueChainId' | 'rulesPrincipalId'>> = {},
): ChainRead {
  return {
    valueChainId: 'vch_X',
    structure: s,
    live: liveOf(s),
    placements: placed.map((p) => p.placement),
    histories: new Map(placed.map((p) => [p.placement.id, p.history])),
    rows: new Map(),
    openTask: null,
    claimed: new Map(),
    procedure: PROC,
    rulesPrincipalId: RULES,
    ...extra,
  };
}

/** Every open process judged on its current input (a verdict per process). */
function judged(read: ChainRead, before: ChainSide): ChainRead {
  const facts = headFactOrder(before.projectFacts);
  const inputs = pipelineInputs(
    {
      structure: read.structure,
      live: read.live,
      processFacts: facts.filter((f) => f.kind === 'process'),
    },
    read.placements,
    read.histories,
    facts,
    before.relations,
    read.rows,
    read.procedure,
  );
  return {
    ...read,
    rows: new Map(inputs.open.map((ref) => [ref, { inputHash: inputs.hashOf(ref) }])),
  };
}

const side = (projectFacts: ProjectFacts, relations: ChainSide['relations'] = []): ChainSide => ({
  projectFacts,
  relations,
});

describe('placementsChanged', () => {
  const s = structureOf();
  const pf = head(EINS(), ZWEI());

  it('names an accepted placement whose process is renamed as changed', () => {
    const a = placement(s, pf, 'step-a', P1, 'accepted');
    const impact = placementImpact({
      ...chainRead(s, [a]),
      before: side(pf),
      after: side(head(EINS({ eins: { name: 'Erfassung neu' } }), ZWEI())),
      headChange: true,
      triggered: true,
    });
    expect(impact.placementsChanged).toEqual({
      count: 1,
      items: [{ step: 'step-a', stepName: 'Antrag', process: P1, endpointState: 'changed' }],
    });
  });

  it('names it missing when its process or its whole model leaves the head', () => {
    const a = placement(s, pf, 'step-a', P1, 'accepted');
    const b = placement(s, pf, 'step-b', Q, 'accepted');
    const removed = placementImpact({
      ...chainRead(s, [a, b]),
      before: side(pf),
      after: side(head(model('m/eins', [{ id: 'P_Zwei', name: 'Versand' }]), ZWEI())),
      headChange: true,
      triggered: true,
    });
    expect(removed.placementsChanged.items).toEqual([
      { step: 'step-a', stepName: 'Antrag', process: P1, endpointState: 'missing' },
    ]);
    const deleted = placementImpact({
      ...chainRead(s, [a, b]),
      before: side(pf),
      after: side(head(EINS())),
      headChange: true,
      triggered: false,
    });
    expect(deleted.placementsChanged.items).toEqual([
      { step: 'step-b', stepName: 'Bescheid', process: Q, endpointState: 'missing' },
    ]);
  });

  it('names none on a removed step (already missing), no held one, and @outside without a step name', () => {
    const gone = placement(s, pf, 'step-weg', P1, 'accepted');
    gone.placement.endpointState = 'missing';
    const held = placement(s, pf, 'step-b', P1, 'held');
    const outside = placement(s, pf, OUTSIDE, P1, 'accepted');
    const impact = placementImpact({
      ...chainRead(s, [gone, held, outside]),
      before: side(pf),
      after: side(head(EINS({ eins: { name: 'Umbenannt' } }), ZWEI())),
      headChange: true,
      triggered: true,
    });
    expect(impact.placementsChanged).toEqual({
      count: 1,
      items: [{ step: OUTSIDE, stepName: null, process: P1, endpointState: 'changed' }],
    });
  });

  it('names nothing when the process comes back as it was (ok again) or nothing changes', () => {
    const a = placement(s, pf, 'step-a', P1, 'accepted');
    a.placement.endpointState = 'changed';
    const back = placementImpact({
      ...chainRead(s, [a]),
      before: side(pf),
      after: side(pf),
      headChange: true,
      triggered: true,
    });
    expect(back.placementsChanged).toEqual({ count: 0, items: [] });
  });

  it('sorts by process, then step', () => {
    const placed = [
      placement(s, pf, 'step-b', Q, 'accepted'),
      placement(s, pf, 'step-b', P1, 'accepted'),
      placement(s, pf, 'step-a', P1, 'accepted'),
    ];
    const impact = placementImpact({
      ...chainRead(s, placed),
      before: side(pf),
      after: side(head(model('m/eins', []), model('m/zwei', []))),
      headChange: true,
      triggered: true,
    });
    expect(impact.placementsChanged.items.map((i) => [i.process, i.step])).toEqual([
      [P1, 'step-a'],
      [P1, 'step-b'],
      [Q, 'step-b'],
    ]);
  });
});

describe('placementTask: due-ness', () => {
  const s = structureOf();
  const before = side(head(EINS(), ZWEI()));

  it('is nothing to do on an unchanged head', () => {
    const read = judged(chainRead(s), before);
    expect(
      placementImpact({ ...read, before, after: before, headChange: false, triggered: false }),
    ).toEqual({
      placementsChanged: { count: 0, items: [] },
      placementTask: { outcome: 'not-triggered', due: 0, newlyDue: 0, again: 0 },
    });
  });

  it('makes a new process due, not placed again', () => {
    const read = judged(chainRead(s), before);
    const impact = placementImpact({
      ...read,
      before,
      after: side(head(EINS(), ZWEI(), DREI())),
      headChange: true,
      triggered: true,
    });
    expect(impact.placementTask).toEqual({ outcome: 'queued', due: 1, newlyDue: 1, again: 0 });
  });

  it('makes a process due whose own fields change, not its sibling in the same model', () => {
    const read = judged(chainRead(s), before);
    const after = side(head(EINS({ eins: { doc: 'Neu dokumentiert.' } }), ZWEI()));
    expect(
      placementImpact({ ...read, before, after, headChange: true, triggered: true }).placementTask,
    ).toEqual({
      outcome: 'queued',
      due: 1,
      newlyDue: 1,
      again: 1,
    });
    // A task label is nothing a claim shows.
    const task = side(head(EINS({ zwei: { task: 'Versenden' } }), ZWEI()));
    expect(
      placementImpact({ ...read, before, after: task, headChange: true, triggered: true })
        .placementTask,
    ).toEqual({ outcome: 'nothing-due', due: 0, newlyDue: 0, again: 0 });
  });

  it('makes both ends of a newly accepted call due (their neighbours), not the others', () => {
    const call = (status: RelationStatus) => [rel('m/eins#Call_Q', Q, status)];
    const proposed = side(head(EINS(), ZWEI()), call('proposed'));
    const read = judged(chainRead(s), proposed);
    const impact = placementImpact({
      ...read,
      before: proposed,
      after: side(head(EINS(), ZWEI()), call('accepted')),
      headChange: true,
      triggered: true,
    });
    expect(impact.placementTask).toEqual({ outcome: 'queued', due: 2, newlyDue: 2, again: 2 });
  });

  it('makes every open process due when a step link resolves, homed ones aside', () => {
    const linked = structureOf([
      ...STEPS,
      { id: 'step-link', name: 'Verknüpft', link: `analyzr:process/${N}` },
    ]);
    const homed = placement(linked, before.projectFacts, 'step-a', P2, 'accepted');
    const read = judged(chainRead(linked, [homed]), before);
    const impact = placementImpact({
      ...read,
      before,
      after: side(head(EINS(), ZWEI(), DREI())),
      headChange: true,
      triggered: true,
    });
    // P1 and Q judged before and due again; the new process N; P2 is homed.
    expect(impact.placementTask).toEqual({ outcome: 'queued', due: 3, newlyDue: 3, again: 2 });
  });

  it('counts a process due before (no verdict) as due, not newly due', () => {
    const read = chainRead(s);
    const after = side(head(EINS({ eins: { doc: 'Neu.' } }), ZWEI()));
    expect(
      placementImpact({ ...read, before, after, headChange: true, triggered: true }).placementTask,
    ).toEqual({
      outcome: 'queued',
      due: 3,
      newlyDue: 0,
      again: 0,
    });
  });

  it('keeps the digest of a process with more than five start events of mixed kinds', () => {
    const starts: ProcessSpec['starts'] = [
      { kind: 'msg_catch', id: 'Start_M1', label: 'Nachricht 1' },
      { kind: 'msg_catch', id: 'Start_M2', label: 'Nachricht 2' },
      { kind: 'msg_catch', id: 'Start_M3', label: 'Nachricht 3' },
      { kind: 'evt_start', id: 'Start_S1', label: 'Start 1' },
      { kind: 'evt_start', id: 'Start_S2', label: 'Start 2' },
      { kind: 'evt_start', id: 'Start_S3', label: 'Start 3' },
    ];
    const extracted = (task: string) =>
      model('m/eins', [{ id: 'P_Eins', name: 'Erfassung', starts, task }]);
    // The head lists the facts by kind in code point order (evt_start before msg_catch), the
    // extractor in the enum's order (msg_catch first): the five labels a claim shows differ.
    const stored: ProjectFacts = {
      models: [{ ...extracted('Prüfen'), facts: headFactOrder(head(extracted('Prüfen'))) }],
    };
    const process = stored.models[0]?.facts.find((f) => f.kind === 'process');
    if (!process) throw new Error('no process fact');
    const own = (facts: readonly Fact[]) =>
      processOwnFields(process, factsByProcess(facts).get(P1) ?? []).starts;
    expect(own(stored.models[0]?.facts ?? [])).toEqual([
      'Start 1',
      'Start 2',
      'Start 3',
      'Nachricht 1',
      'Nachricht 2',
    ]);
    expect(own(extracted('Prüfen').facts)).not.toEqual(own(stored.models[0]?.facts ?? []));
    // A task label changes the model's facts, nothing a claim shows: nothing is due.
    const read = judged(chainRead(s), side(stored));
    expect(
      placementImpact({
        ...read,
        before: side(stored),
        after: side(head(extracted('Versenden'))),
        headChange: true,
        triggered: true,
      }).placementTask,
    ).toEqual({ outcome: 'nothing-due', due: 0, newlyDue: 0, again: 0 });
  });
});

describe('placementTask: the outcome, as queuePlacementTask decides it', () => {
  const s = structureOf();
  const before = side(head(EINS(), ZWEI()));
  const after = side(head(EINS(), ZWEI(), DREI()));
  const outcome = (triggered: boolean, openTask: ChainRead['openTask'], judge = true) => {
    const read = chainRead(s, [], { openTask });
    return placementImpact({
      ...(judge ? judged(read, before) : read),
      before,
      after,
      headChange: true,
      triggered,
    }).placementTask.outcome;
  };

  it('is not-triggered without a fact change or for a deletion, whatever is due', () => {
    expect(outcome(false, null)).toBe('not-triggered');
    expect(outcome(false, { state: 'claimed' })).toBe('not-triggered');
  });

  it('leaves an open task: a queued one is open, a claimed one deferred', () => {
    expect(outcome(true, { state: 'queued' })).toBe('open');
    expect(outcome(true, { state: 'claimed' })).toBe('deferred');
  });

  it('queues when a process is due, else nothing is due', () => {
    expect(outcome(true, null)).toBe('queued');
    const read = judged(chainRead(s), before);
    expect(
      placementImpact({ ...read, before, after: before, headChange: true, triggered: true })
        .placementTask,
    ).toEqual({
      outcome: 'nothing-due',
      due: 0,
      newlyDue: 0,
      again: 0,
    });
  });
});

/** One assertion of a placement's history (synthetic: what status and the pipeline read). */
function assertion(
  p: PlacementRecord,
  a: Pick<StoredPlacementAssertion, 'kind' | 'sourceKind' | 'principalId'> &
    Partial<StoredPlacementAssertion>,
): StoredPlacementAssertion {
  ids++;
  return {
    id: `pas_${ids}` as StoredPlacementAssertion['id'],
    projectId: p.projectId,
    placementId: p.id,
    seq: ids,
    verdict: null,
    clientId: null,
    declared: null,
    submissionId: null,
    tier: null,
    confidence: null,
    rationale: null,
    evidence: null,
    question: null,
    label: null,
    linkedPlacementId: null,
    stepFp: p.stepFp,
    processFp: p.processFp,
    stepHash: null,
    processHash: null,
    handle: 'x',
    createdAt: new Date(ids * 1000),
    ...a,
  };
}

describe('placementTask: the rule tier the write runs', () => {
  const AGENT = 'prn_AGENT' as PrincipalId;
  const linked = structureOf([
    ...STEPS,
    { id: 'step-link', name: 'Verknüpft', link: `analyzr:process/${P1}` },
  ]);
  const pf = head(EINS(), ZWEI());
  const before = side(pf);
  // A task label: nothing of any process's own fields.
  const after = side(head(EINS({ zwei: { task: 'Versenden' } }), ZWEI()));
  /** The rule tier's proposal as it recorded it (one the head no longer derives: its old rationale). */
  const ruleProposal = (p: PlacementRecord) => {
    const [d] = derivedRulePlacements(
      linked.steps,
      pf.models.flatMap((m) => m.facts),
    ).filter((x) => x.elementId === p.elementId && x.processRef === p.processRef);
    return assertion(p, {
      kind: 'proposal',
      sourceKind: 'rule',
      principalId: RULES,
      tier: 'key',
      confidence: 1,
      rationale: d?.rationale ?? 'Schlüsselregel: früher abgeleitet.',
    });
  };

  it('counts the proposal a revoked auto-acceptance no longer suppresses, as the write records it', () => {
    const { placement: p } = placement(linked, pf, 'step-link', P1, 'proposed');
    const history = [
      assertion(p, {
        kind: 'proposal',
        sourceKind: 'agent',
        principalId: AGENT,
        tier: 'semantic',
        confidence: 0.95,
        rationale: 'Passt.',
      }),
      assertion(p, {
        kind: 'decision',
        verdict: 'accept',
        sourceKind: 'human',
        principalId: HUMAN,
        tier: 'manual',
        autoAcceptRuleId: 'aar_1',
      }),
      assertion(p, {
        kind: 'withdrawal',
        sourceKind: 'human',
        principalId: HUMAN,
        autoAcceptRuleId: 'aar_1',
      }),
    ];
    const read = judged(chainRead(linked, [{ placement: p, history }]), before);
    expect(
      placementImpact({ ...read, before, after, headChange: true, triggered: true }).placementTask,
    ).toEqual({ outcome: 'queued', due: 1, newlyDue: 1, again: 1 });
    // A layout-only upload runs the rule tier too (nothing triggers the task).
    expect(
      placementImpact({ ...read, before, after: before, headChange: true, triggered: false })
        .placementTask,
    ).toEqual({ outcome: 'not-triggered', due: 1, newlyDue: 1, again: 1 });
    // An unchanged import runs nothing.
    expect(
      placementImpact({ ...read, before, after: before, headChange: false, triggered: false })
        .placementTask,
    ).toEqual({ outcome: 'not-triggered', due: 0, newlyDue: 0, again: 0 });
  });

  it('records nothing where its proposal is live (duplicate) or a human decided (suppressed)', () => {
    const { placement: live } = placement(linked, pf, 'step-link', P1, 'proposed');
    const read = judged(
      chainRead(linked, [{ placement: live, history: [ruleProposal(live)] }]),
      before,
    );
    expect(
      placementImpact({ ...read, before, after, headChange: true, triggered: true }).placementTask,
    ).toEqual({ outcome: 'nothing-due', due: 0, newlyDue: 0, again: 0 });
    const rejected = placement(linked, pf, 'step-link', P1, 'rejected');
    const decided = judged(chainRead(linked, [rejected]), before);
    expect(
      placementImpact({ ...decided, before, after, headChange: true, triggered: true })
        .placementTask,
    ).toEqual({ outcome: 'nothing-due', due: 0, newlyDue: 0, again: 0 });
  });

  it('counts a proposal on a new spot and a withdrawal, each a new non-agent seq', () => {
    // Without a placement on the linked step yet: the write proposes (a new placement).
    const fresh = judged(chainRead(linked), before);
    expect(
      placementImpact({ ...fresh, before, after, headChange: true, triggered: true }).placementTask,
    ).toEqual({ outcome: 'queued', due: 1, newlyDue: 1, again: 1 });
    // A live rule proposal on a step that no longer derives it: withdrawn.
    const s = structureOf();
    const { placement: stale } = placement(s, pf, 'step-a', P2, 'proposed');
    const read = judged(
      chainRead(s, [{ placement: stale, history: [ruleProposal(stale)] }]),
      before,
    );
    expect(
      placementImpact({ ...read, before, after, headChange: true, triggered: true }).placementTask,
    ).toEqual({ outcome: 'queued', due: 1, newlyDue: 1, again: 1 });
  });
});

describe('placementTask: while an agent holds the task', () => {
  const s = structureOf();
  const before = side(head(EINS(), ZWEI()));
  const renamed = side(head(EINS({ eins: { name: 'Erfassung neu' } }), ZWEI()));
  const claimedRead = () => {
    const read = chainRead(s, [], { openTask: { state: 'claimed' } });
    // The claim showed every open process on its current input; no verdict is in yet.
    return { ...read, claimed: judged(read, before).rows };
  };

  it('counts the claimed processes as judged on the input the claim showed', () => {
    expect(
      placementImpact({
        ...claimedRead(),
        before,
        after: renamed,
        headChange: true,
        triggered: true,
      }).placementTask,
    ).toEqual({ outcome: 'deferred', due: 1, newlyDue: 1, again: 1 });
    expect(
      placementImpact({
        ...claimedRead(),
        before,
        after: before,
        headChange: true,
        triggered: false,
      }).placementTask,
    ).toEqual({ outcome: 'not-triggered', due: 0, newlyDue: 0, again: 0 });
  });

  it('without the claim’s hashes counts every open process due before and after', () => {
    const read = chainRead(s, [], { openTask: { state: 'claimed' } });
    expect(
      placementImpact({ ...read, before, after: renamed, headChange: true, triggered: true })
        .placementTask,
    ).toEqual({ outcome: 'deferred', due: 3, newlyDue: 0, again: 0 });
  });
});

describe('headFactOrder', () => {
  it('lists the facts as the head does: by model key, then kind and element id in code point order', () => {
    const facts = headFactOrder(
      head(ZWEI(), model('m/eins', [{ id: 'P_Eins', name: 'E', call: 'C_1', task: 'T' }])),
    );
    expect(facts.map((f) => `${f.modelKey} ${f.kind} ${f.elementId}`)).toEqual([
      'm/eins call C_1',
      'm/eins process P_Eins',
      'm/eins task P_Eins_T',
      'm/zwei process P_Q',
    ]);
  });
});

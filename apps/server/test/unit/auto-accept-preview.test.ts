/**
 * Auto-accept rules (owner decision 19), pure part: the preview's history
 * replay (where a rule would have fired, the outcomes, no ground truth from
 * rule decisions, no-link liveness by seq, competing calls and steps as of
 * the proposal), the open-now evaluation that "apply" shares, the curve, the
 * ledger and its statistics, and a benchmark against quadratic blow-ups;
 * rules for derived calls (M6 S2c-3): open now, the replay at the rule
 * tier's proposals, the safeguards, `derivedGroups` and the ledger's
 * `proposedBy`. Synthetic data only.
 */
import type {
  AutoAcceptRuleId,
  DeclaredProcedure,
  PlacementId,
  PrincipalId,
  Ref,
  RelationId,
  RelationStatus,
} from '@analyzr/contracts';
import { describe, expect, it } from 'vitest';

import type { AutoAcceptRuleRev } from '../../src/domain/auto-accept/evaluate.ts';
import { ledgerItems, ruleStats, type LedgerSubject } from '../../src/domain/auto-accept/ledger.ts';
import {
  derivedGroups,
  openPlacementCandidates,
  openRelationCandidates,
  relationItem,
  replayHistory,
  type PlacementSide,
  type RelationSide,
} from '../../src/domain/auto-accept/preview.ts';
import type {
  NoLinkHistoryRecord,
  PlacementRecord,
  StoredAssertion,
  StoredPlacementAssertion,
} from '../../src/domain/ports.ts';
import { recomputeStatus } from '../../src/domain/status.ts';
import { recomputePlacementStatus } from '../../src/domain/value-chain/placement-state.ts';

const OWNER = 'prn_00000000000000000000OWNER' as PrincipalId;
const AGENT = 'prn_000000000000000000000AGENT' as PrincipalId;
const OTHER = 'prn_000000000000000000000OTHER' as PrincipalId;
const PROC: DeclaredProcedure = { id: 'analyzr-relations', version: '0.2.0' };
const PPROC: DeclaredProcedure = { id: 'analyzr-placements', version: '0.1.0' };
const RULE_ID = 'aar_01J9Z3N4X5Q6R7S8T9V0W1X2Y1' as AutoAcceptRuleId;

function rule(extra: Partial<AutoAcceptRuleRev> = {}): AutoAcceptRuleRev {
  return {
    ruleId: RULE_ID,
    revision: 1,
    kind: 'relation',
    name: 'Schlüssel',
    enabled: true,
    tier: 'key',
    minConfidence: 0.9,
    relationType: null,
    agentPrincipalId: null,
    llmModel: null,
    includeAdHoc: false,
    proposedBy: 'agent',
    derivedKind: null,
    converter: null,
    authorId: OWNER,
    authorClientId: 'analyzr-web',
    authorIsOwner: true,
    order: 1,
    ...extra,
  };
}

let seq = 0;
function ra(
  relationId: string,
  principalId: PrincipalId,
  kind: StoredAssertion['kind'],
  over: Partial<StoredAssertion> = {},
): StoredAssertion {
  seq++;
  const human = principalId === OWNER;
  return {
    id: `asr_${seq}` as StoredAssertion['id'],
    projectId: 'prj_1',
    relationId: relationId as RelationId,
    seq,
    kind,
    verdict: kind === 'decision' ? 'accept' : null,
    sourceKind: human ? 'human' : 'agent',
    principalId,
    clientId: null,
    declared: human ? null : { procedure: PROC, llmModel: 'sim-1' },
    submissionId: kind === 'proposal' && !human ? 'sbm_1' : null,
    tier: kind === 'proposal' ? 'key' : null,
    confidence: kind === 'proposal' ? 0.95 : null,
    rationale: null,
    evidence: null,
    question: null,
    label: null,
    linkedRelationId: null,
    fromFp: 'f',
    toFp: 't',
    fromHash: 'h-a',
    toHash: 'h-b',
    handle: human ? 'owner' : principalId === AGENT ? 'agent:a' : 'agent:b',
    createdAt: new Date(seq * 1000),
    ...over,
  };
}

function relationSide(
  rels: {
    id: string;
    type?: 'call' | 'message' | 'manual';
    from?: string;
    to?: string;
    history: StoredAssertion[];
  }[],
  noLinks: NoLinkHistoryRecord[] = [],
  trust: RelationSide['trust'] = new Map(),
): RelationSide {
  return {
    relations: rels.map((r) => ({
      id: r.id as RelationId,
      type: r.type ?? 'message',
      fromRef: (r.from ?? `a#${r.id}`) as Ref,
      toRef: (r.to ?? `b#${r.id}`) as Ref,
      status: recomputeStatus(r.history).status,
      endpointState: 'ok',
    })),
    histories: new Map(rels.map((r) => [r.id, r.history])),
    noLinks,
    heads: new Map([
      ['a', 'h-a'],
      ['b', 'h-b'],
    ]),
    procedure: PROC,
    trust,
  };
}

describe('history replay (relations)', () => {
  it('fires at a matching agent proposal before the human decision and maps outcomes', () => {
    const side = relationSide([
      { id: 'r1', history: [ra('r1', AGENT, 'proposal'), ra('r1', OWNER, 'decision')] },
      {
        id: 'r2',
        history: [ra('r2', AGENT, 'proposal'), ra('r2', OWNER, 'decision', { verdict: 'reject' })],
      },
      {
        id: 'r3',
        history: [
          ra('r3', AGENT, 'proposal'),
          ra('r3', OWNER, 'decision', {
            verdict: 'reject',
            linkedRelationId: 'rel_x',
          }),
        ],
      },
      {
        id: 'r4',
        history: [ra('r4', AGENT, 'proposal'), ra('r4', OWNER, 'decision', { verdict: 'hold' })],
      },
      // Too low: never fires (but a human decided it: in the denominator).
      {
        id: 'r5',
        history: [ra('r5', AGENT, 'proposal', { confidence: 0.6 }), ra('r5', OWNER, 'decision')],
      },
      // Undecided.
      { id: 'r6', history: [ra('r6', AGENT, 'proposal')] },
    ]);
    const { history } = replayHistory({ kind: 'relation', relations: side }, rule());
    expect(history).toEqual({
      decided: 5,
      wouldAccept: 4,
      accepted: 1,
      rejected: 1,
      corrected: 1,
      held: 1,
      autoUnreviewed: 0,
      undecided: 1,
      precision: 1 / 3,
    });
  });

  it('counts acceptances a rule recorded apart, never as ground truth', () => {
    const p = ra('r1', AGENT, 'proposal');
    const d = ra('r1', OWNER, 'decision', {
      autoAcceptRuleId: RULE_ID,
      autoAcceptRuleRevision: 1,
      autoAcceptTriggerId: p.id,
    });
    const reviewed = ra('r2', AGENT, 'proposal');
    const side = relationSide([
      { id: 'r1', history: [p, d] },
      {
        id: 'r2',
        history: [
          reviewed,
          ra('r2', OWNER, 'decision', { autoAcceptRuleId: RULE_ID, autoAcceptRuleRevision: 1 }),
          ra('r2', OWNER, 'decision', { verdict: 'reject' }),
        ],
      },
    ]);
    const { history } = replayHistory({ kind: 'relation', relations: side }, rule());
    expect(history).toMatchObject({ autoUnreviewed: 1, rejected: 1, accepted: 0, precision: 0 });
  });

  it('ignores proposals after the first human assertion, and blocked ones', () => {
    const side = relationSide([
      {
        id: 'r1',
        history: [
          ra('r1', OWNER, 'note'),
          ra('r1', AGENT, 'proposal'),
          ra('r1', OWNER, 'decision'),
        ],
      },
      {
        id: 'r2',
        history: [
          ra('r2', AGENT, 'proposal', { question: 'Welcher?' }),
          ra('r2', OWNER, 'decision'),
        ],
      },
      // A later, question-free proposal of another agent still counts.
      {
        id: 'r3',
        history: [
          ra('r3', AGENT, 'proposal', { question: 'Welcher?' }),
          ra('r3', AGENT, 'withdrawal'),
          ra('r3', OTHER, 'proposal'),
          ra('r3', OWNER, 'decision'),
        ],
      },
    ]);
    expect(replayHistory({ kind: 'relation', relations: side }, rule()).history).toMatchObject({
      decided: 3,
      wouldAccept: 1,
      accepted: 1,
    });
  });

  it('checks no-link liveness by seq', () => {
    const p = ra('r1', AGENT, 'proposal');
    const decision = ra('r1', OWNER, 'decision');
    const noLink = (s: number, w: number | null): NoLinkHistoryRecord => ({
      type: 'message',
      fromRef: 'a#r1',
      toRef: 'b#r1',
      principalId: OTHER,
      seq: s,
      withdrawnSeq: w,
    });
    const fired = (noLinks: NoLinkHistoryRecord[]) =>
      replayHistory(
        {
          kind: 'relation',
          relations: relationSide([{ id: 'r1', history: [p, decision] }], noLinks),
        },
        rule(),
      ).history.wouldAccept;
    expect(fired([])).toBe(1);
    expect(fired([noLink(p.seq - 1, null)])).toBe(0);
    expect(fired([noLink(p.seq - 1, p.seq + 1)])).toBe(0);
    expect(fired([noLink(p.seq - 2, p.seq - 1)])).toBe(1);
    expect(fired([noLink(p.seq + 1, null)])).toBe(1);
  });

  it('checks competing calls as of the proposal', () => {
    const c1 = ra('c1', AGENT, 'proposal');
    const c2 = ra('c2', AGENT, 'proposal');
    const side = relationSide([
      {
        id: 'c1',
        type: 'call',
        from: 'a#Call',
        to: 'b#P1',
        history: [c1, ra('c1', OWNER, 'decision')],
      },
      {
        id: 'c2',
        type: 'call',
        from: 'a#Call',
        to: 'b#P2',
        history: [c2, ra('c2', OWNER, 'decision', { verdict: 'reject' })],
      },
    ]);
    // c1 was proposed alone at first; c2 came while c1 was proposed.
    expect(replayHistory({ kind: 'relation', relations: side }, rule()).history).toMatchObject({
      wouldAccept: 1,
      accepted: 1,
      rejected: 0,
    });
  });

  it('applies what its own earlier firing blocks: a later call from the same element', () => {
    // The agent proposes X→A, withdraws it, proposes X→B; a human accepts X→B.
    const pA = ra('xa', AGENT, 'proposal');
    const wA = ra('xa', AGENT, 'withdrawal');
    const pB = ra('xb', AGENT, 'proposal');
    const dB = ra('xb', OWNER, 'decision');
    const side = relationSide([
      { id: 'xa', type: 'call', from: 'a#X', to: 'b#A', history: [pA, wA] },
      { id: 'xb', type: 'call', from: 'a#X', to: 'b#B', history: [pB, dB] },
    ]);
    // The rule would have accepted X→A at once (the acceptance outlives the withdrawal), so X→B
    // competes with it and never fires; X→A counts as corrected (the human chose X→B).
    const { history, curve } = replayHistory({ kind: 'relation', relations: side }, rule());
    expect(history).toMatchObject({
      decided: 2,
      wouldAccept: 1,
      accepted: 0,
      corrected: 1,
      precision: 0,
    });
    // Below X→A's confidence only X→B is proposed alone when it comes: it fires.
    const later = replayHistory(
      {
        kind: 'relation',
        relations: relationSide([
          {
            id: 'xa',
            type: 'call',
            from: 'a#X',
            to: 'b#A',
            history: [{ ...pA, confidence: 0.8 }, wA],
          },
          { id: 'xb', type: 'call', from: 'a#X', to: 'b#B', history: [pB, dB] },
        ]),
      },
      rule(),
    );
    expect(later.history).toMatchObject({ wouldAccept: 1, accepted: 1, corrected: 0 });
    expect(curve.find((c) => c.minConfidence === 0.95)).toMatchObject({ wouldAccept: 1 });
  });

  it('gives a curve that never grows with the minimum confidence', () => {
    const rels = Array.from({ length: 30 }, (_, i) => {
      const id = `r${i}`;
      return {
        id,
        history: [
          ra(id, AGENT, 'proposal', { confidence: 0.5 + (i % 11) * 0.05 }),
          ra(id, OWNER, 'decision', { verdict: i % 4 === 0 ? 'reject' : 'accept' }),
        ],
      };
    });
    const { curve } = replayHistory({ kind: 'relation', relations: relationSide(rels) }, rule());
    expect(curve.map((c) => c.minConfidence)).toEqual([
      0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1,
    ]);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]?.wouldAccept).toBeLessThanOrEqual(curve[i - 1]?.wouldAccept ?? 0);
    }
    expect(curve[0]?.wouldAccept).toBe(30);
  });
});

describe('a human manual link from the call element competes (M6 S5c-1)', () => {
  it('blocks an agent call to another target now and as of its proposal; the same target passes', () => {
    // The human linked a#Call → b#P (a manual relation, accepted), then an agent proposed
    // the call a#Call → b#Q.
    const manual = ra('m1', OWNER, 'decision', { tier: 'manual' });
    const other = relationSide([
      { id: 'm1', type: 'manual', from: 'a#Call', to: 'b#P', history: [manual] },
      { id: 'cq', type: 'call', from: 'a#Call', to: 'b#Q', history: [ra('cq', AGENT, 'proposal')] },
    ]);
    const open = openRelationCandidates(other, rule());
    // The history counts items a human decided after the proposal: here the human rejects cq.
    const decidedLater = (r: RelationSide): RelationSide => ({
      ...r,
      histories: new Map(
        [...r.histories].map(([id, h]) =>
          id === 'cq' ? [id, [...h, ra('cq', OWNER, 'decision', { verdict: 'reject' })]] : [id, h],
        ),
      ),
    });
    expect(open.accept).toEqual([]);
    expect(Object.fromEntries(open.blocked)).toEqual({ 'competing-call': 1 });
    // As of its proposal the manual link stood: the rule would never have fired.
    expect(
      replayHistory({ kind: 'relation', relations: decidedLater(other) }, rule()).history,
    ).toMatchObject({ decided: 1, wouldAccept: 0 });
    // The agent's call to the human's own target agrees with the human: no competition.
    const same = relationSide([
      { id: 'm1', type: 'manual', from: 'a#Call', to: 'b#P', history: [manual] },
      { id: 'cp', type: 'call', from: 'a#Call', to: 'b#P', history: [ra('cp', AGENT, 'proposal')] },
    ]);
    expect(openRelationCandidates(same, rule()).accept.map((o) => o.relation.id)).toEqual(['cp']);
    // A manual link rejected („Rückgängig“) before the proposal competes no more.
    const undone = relationSide([
      {
        id: 'm1',
        type: 'manual',
        from: 'a#Call',
        to: 'b#P',
        history: [manual, ra('m1', OWNER, 'decision', { verdict: 'reject' })],
      },
      { id: 'cq', type: 'call', from: 'a#Call', to: 'b#Q', history: [ra('cq', AGENT, 'proposal')] },
    ]);
    expect(openRelationCandidates(undone, rule()).accept.map((o) => o.relation.id)).toEqual(['cq']);
    expect(
      replayHistory({ kind: 'relation', relations: decidedLater(undone) }, rule()).history,
    ).toMatchObject({ decided: 1, wouldAccept: 1, rejected: 1 });
  });
});

describe('open now (relations)', () => {
  it('picks the current, most confident matching proposal and counts blocked ones', () => {
    const stale = ra('r1', AGENT, 'proposal', { confidence: 0.99, fromHash: 'old' });
    const current = ra('r1', OTHER, 'proposal', { confidence: 0.91 });
    const side = relationSide([
      { id: 'r1', history: [stale, current] },
      { id: 'r2', history: [ra('r2', AGENT, 'proposal', { question: '?' })] },
      { id: 'r3', history: [ra('r3', AGENT, 'proposal', { confidence: 0.5 })] },
      { id: 'r4', history: [ra('r4', AGENT, 'proposal', { fromHash: 'old' })] },
    ]);
    const open = openRelationCandidates(side, rule());
    expect(open.accept.map((o) => o.trigger.id)).toEqual([current.id]);
    expect(Object.fromEntries(open.blocked)).toEqual({
      'agent-question': 1,
      'stale-proposal': 1,
    });
  });
});

function placementRecord(
  id: string,
  elementId: string,
  processRef: string,
  status: RelationStatus,
): PlacementRecord {
  return {
    id: id as PlacementId,
    projectId: 'prj_1',
    valueChainId: 'vch_1',
    elementId,
    generation: 1,
    processRef: processRef as Ref,
    status,
    endpointState: 'ok',
    tier: 'lexical',
    confidence: 0.95,
    version: 1,
    stepFp: null,
    processFp: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function pa(
  placementId: string,
  principalId: PrincipalId,
  kind: StoredPlacementAssertion['kind'],
  over: Partial<StoredPlacementAssertion> = {},
): StoredPlacementAssertion {
  seq++;
  const human = principalId === OWNER;
  return {
    id: `pas_${seq}` as StoredPlacementAssertion['id'],
    projectId: 'prj_1',
    placementId: placementId as PlacementId,
    seq,
    kind,
    verdict: kind === 'decision' ? 'accept' : null,
    sourceKind: human ? 'human' : 'agent',
    principalId,
    clientId: null,
    declared: human ? null : { procedure: PPROC, llmModel: 'sim-1' },
    submissionId: kind === 'proposal' && !human ? 'sbm_1' : null,
    tier: kind === 'proposal' ? 'lexical' : null,
    confidence: kind === 'proposal' ? 0.95 : null,
    rationale: null,
    evidence: null,
    question: null,
    label: null,
    linkedPlacementId: null,
    stepFp: 's',
    processFp: 'p',
    stepHash: kind === 'proposal' && !human ? 'chain' : null,
    processHash: kind === 'proposal' && !human ? 'proc' : null,
    handle: human ? 'owner' : 'agent:a',
    createdAt: new Date(seq * 1000),
    ...over,
  };
}

function placementSide(
  items: { id: string; step: string; process: string; history: StoredPlacementAssertion[] }[],
  extra: Partial<PlacementSide> = {},
): PlacementSide {
  const placements = items.map((i) =>
    placementRecord(i.id, i.step, i.process, recomputePlacementStatus(i.history).status),
  );
  return {
    valueChainKey: 'main',
    placements,
    histories: new Map(items.map((i) => [i.id, i.history])),
    steps: [
      { elementId: 'step-a', generation: 1, deletedSeq: null },
      { elementId: 'step-b', generation: 1, deletedSeq: null },
      { elementId: '@outside', generation: 1, deletedSeq: null },
    ],
    live: new Map([
      ['step-a', 1],
      ['step-b', 1],
      ['@outside', 1],
    ]),
    rows: new Map(),
    hashOf: () => 'input',
    chainDigest: 'chain',
    processDigests: new Map(items.map((i) => [i.process, 'proc'])),
    procedure: PPROC,
    trust: new Map(),
    ...extra,
  };
}

describe('placements', () => {
  const placementRule = rule({ kind: 'placement', tier: 'lexical' });

  it('opens one placement per process, refuses ambiguous and @outside ones', () => {
    const side = placementSide([
      { id: 'p1', step: 'step-a', process: 'm#P1', history: [pa('p1', AGENT, 'proposal')] },
      { id: 'p2', step: 'step-a', process: 'm#P2', history: [pa('p2', AGENT, 'proposal')] },
      { id: 'p3', step: 'step-b', process: 'm#P2', history: [pa('p3', OTHER, 'proposal')] },
      { id: 'p4', step: '@outside', process: 'm#P3', history: [pa('p4', AGENT, 'proposal')] },
    ]);
    const open = openPlacementCandidates(side, placementRule);
    expect(open.accept.map((o) => o.placement.id)).toEqual(['p1']);
    expect(Object.fromEntries(open.blocked)).toEqual({ outside: 1, 'competing-step': 2 });
  });

  it('refuses another agent’s current unsure verdict', () => {
    const items = [
      { id: 'p1', step: 'step-a', process: 'm#P1', history: [pa('p1', AGENT, 'proposal')] },
    ];
    const unsure = { principalId: OTHER, outcome: 'unsure', inputHash: 'input' };
    expect(
      openPlacementCandidates(
        placementSide(items, { rows: new Map([['m#P1', unsure]]) }),
        placementRule,
      ).accept,
    ).toHaveLength(0);
    expect(
      openPlacementCandidates(
        placementSide(items, { rows: new Map([['m#P1', { ...unsure, inputHash: 'older' }]]) }),
        placementRule,
      ).accept,
    ).toHaveLength(1);
  });

  it('replays the history per placement with the process-level safeguards', () => {
    const p1 = [pa('p1', AGENT, 'proposal'), pa('p1', OWNER, 'decision')];
    // P2 already had another step proposed when the agent proposed step-a: ambiguous.
    const p3 = [pa('p3', OTHER, 'proposal')];
    const p2 = [pa('p2', AGENT, 'proposal'), pa('p2', OWNER, 'decision', { verdict: 'reject' })];
    // P4's second step came only after its first: the first would have fired.
    const p4 = [pa('p4', AGENT, 'proposal')];
    const p5 = [pa('p5', OTHER, 'proposal')];
    p4.push(pa('p4', OWNER, 'decision', { verdict: 'reject' }));
    const side = placementSide([
      { id: 'p1', step: 'step-a', process: 'm#P1', history: p1 },
      { id: 'p2', step: 'step-a', process: 'm#P2', history: p2 },
      { id: 'p3', step: 'step-b', process: 'm#P2', history: p3 },
      { id: 'p4', step: 'step-a', process: 'm#P4', history: p4 },
      { id: 'p5', step: 'step-b', process: 'm#P4', history: p5 },
    ]);
    const { history } = replayHistory({ kind: 'placement', placements: [side] }, placementRule);
    expect(history).toMatchObject({ decided: 3, wouldAccept: 2, accepted: 1, rejected: 1 });
  });

  it('applies what its own earlier firing blocks: a re-judged process keeps the first home step', () => {
    // The agent proposes P→S1 (0.95), re-judges to P→S2 (withdrawing S1); a human accepts S2.
    const p1 = pa('s1', AGENT, 'proposal');
    const w1 = pa('s1', AGENT, 'withdrawal');
    const p2 = pa('s2', AGENT, 'proposal', { confidence: 0.97 });
    const d2 = pa('s2', OWNER, 'decision');
    const items = (first: number) => [
      { id: 's1', step: 'step-a', process: 'm#P', history: [{ ...p1, confidence: first }, w1] },
      { id: 's2', step: 'step-b', process: 'm#P', history: [p2, d2] },
    ];
    // The rule fires on S1 at once (the process then has a home step): S2 never fires, and S1
    // counts as corrected, since the human chose another step.
    const fired = replayHistory(
      { kind: 'placement', placements: [placementSide(items(0.95))] },
      placementRule,
    );
    expect(fired.history).toMatchObject({
      decided: 2,
      wouldAccept: 1,
      accepted: 0,
      corrected: 1,
      precision: 0,
    });
    // At 0.96 S1 does not reach the minimum: S2 is the first that does and fires.
    const curve = fired.curve;
    expect(curve.find((c) => c.minConfidence === 0.95)).toMatchObject({
      wouldAccept: 1,
      corrected: 1,
    });
    const higher = replayHistory(
      { kind: 'placement', placements: [placementSide(items(0.95))] },
      { ...placementRule, minConfidence: 0.96 },
    );
    expect(higher.history).toMatchObject({ wouldAccept: 1, accepted: 1, corrected: 0 });
  });
});

describe('ledger', () => {
  const subject = (id: string, history: StoredAssertion[]): LedgerSubject => ({
    kind: 'relation',
    id,
    status: recomputeStatus(history).status,
    endpointState: 'ok',
    type: 'message',
    from: 'a#x',
    to: 'b#y',
    valueChainKey: null,
    step: null,
    process: null,
    history: history.map((a) => ({
      ...a,
      linked: a.linkedRelationId,
      llmModel: a.declared?.llmModel ?? null,
    })),
  });
  const marker = (triggerId: string) => ({
    autoAcceptRuleId: RULE_ID,
    autoAcceptRuleRevision: 2,
    autoAcceptTriggerId: triggerId as StoredAssertion['id'],
  });

  it('tells in force, revoked and human-decided apart, with statistics', () => {
    const t1 = ra('r1', AGENT, 'proposal', { confidence: 0.93 });
    const t2 = ra('r2', AGENT, 'proposal');
    const t3 = ra('r3', AGENT, 'proposal');
    const t4 = ra('r4', AGENT, 'proposal');
    const subjects = [
      subject('r1', [t1, ra('r1', OWNER, 'decision', marker(t1.id))]),
      subject('r2', [
        t2,
        ra('r2', OWNER, 'decision', marker(t2.id)),
        ra('r2', OWNER, 'withdrawal', { autoAcceptRuleId: RULE_ID, autoAcceptRuleRevision: 2 }),
      ]),
      subject('r3', [
        t3,
        ra('r3', OWNER, 'decision', marker(t3.id)),
        ra('r3', OWNER, 'decision', { verdict: 'reject', linkedRelationId: 'rel_m' }),
      ]),
      subject('r4', [t4, ra('r4', OWNER, 'decision', marker(t4.id)), ra('r4', OWNER, 'decision')]),
    ];
    const items = ledgerItems(subjects, (id, rev) => `${id}@${rev}`);
    expect(items.map((i) => [i.entry.id, i.entry.state, i.entry.laterVerdict])).toEqual([
      ['r1', 'in-force', null],
      ['r2', 'revoked', null],
      ['r3', 'human-decided', 'correct'],
      ['r4', 'human-decided', 'accept'],
    ]);
    expect(items[0]?.entry).toMatchObject({
      ruleName: `${RULE_ID}@2`,
      revision: 2,
      triggerId: t1.id,
      agent: { principalId: AGENT, handle: 'agent:a' },
      decidedBy: { principalId: OWNER, handle: 'owner' },
      confidence: 0.93,
      tier: 'key',
      llmModel: 'sim-1',
    });
    expect(items[1]?.entry.revocationId).not.toBeNull();
    expect(ruleStats(items).get(RULE_ID)).toMatchObject({
      inForce: 1,
      revoked: 1,
      confirmed: 1,
      overruled: 1,
    });
  });
});

describe('rules for derived calls (M6 S2c-3)', () => {
  const RULES = 'prn_0000000000000000000000RULE' as PrincipalId;
  /** The rule tier's proposal of a unique call from a derived model (key, 0.9, the rationale). */
  const rp = (relationId: string) =>
    ra(relationId, RULES, 'proposal', {
      sourceKind: 'rule',
      confidence: 0.9,
      rationale: 'Vertrauensregel: Der Aufruf nennt genau einen Prozess …',
      submissionId: null,
      declared: null,
      fromHash: null,
      toHash: null,
      handle: 'analyzr-rules',
    });
  const caller = (
    derivedKind: 'export' | 'converted' | 'reconstructed' | null,
    extra: { converter?: string; agentUpload?: boolean; conflicted?: string[] } = {},
  ) => ({
    trust: {
      class: 'derived',
      reasons: extra.agentUpload ? ['no-engine', 'agent-upload'] : ['no-engine'],
    },
    derivedKind,
    converter: extra.converter ?? null,
    conflictedCalls: new Set(extra.conflicted ?? []),
  });
  const derivedRule = rule({
    proposedBy: 'rule',
    relationType: 'call',
    minConfidence: 0.9,
    derivedKind: 'export',
  });
  const calls = [
    { id: 'c1', type: 'call' as const, from: 'a#C1', to: 'b#P1', history: [rp('c1')] },
    {
      id: 'c2',
      type: 'call' as const,
      from: 'a#C2',
      to: 'b#P2',
      history: [rp('c2'), ra('c2', OWNER, 'decision')],
    },
    {
      id: 'c3',
      type: 'call' as const,
      from: 'a#C3',
      to: 'b#P3',
      history: [rp('c3'), ra('c3', OWNER, 'decision', { verdict: 'reject' })],
    },
    { id: 'm1', history: [ra('m1', AGENT, 'proposal')] },
  ];

  it('fires at the rule tier’s proposal from the named source; an agent rule never does', () => {
    const side = relationSide(calls, [], new Map([['a', caller('export')]]));
    const open = openRelationCandidates(side, derivedRule);
    expect(open.accept.map((o) => o.relation.id)).toEqual(['c1']);
    expect(relationItem(open.accept[0]!)).toMatchObject({
      proposedBy: 'rule',
      agent: { principalId: RULES, handle: 'analyzr-rules' },
      tier: 'key',
      confidence: 0.9,
    });
    // An agent rule of any type down to 0.5 takes the agent's proposal only.
    expect(
      openRelationCandidates(side, rule({ minConfidence: 0.5 })).accept.map((o) => o.relation.id),
    ).toEqual(['m1']);
    expect(
      openRelationCandidates(side, rule({ minConfidence: 0.5, relationType: 'call' })).accept,
    ).toEqual([]);
    // The replay: the bulk accept and the rejection are the humans' verdicts on such calls.
    expect(replayHistory({ kind: 'relation', relations: side }, derivedRule).history).toMatchObject(
      { decided: 2, wouldAccept: 2, accepted: 1, rejected: 1, undecided: 1, precision: 0.5 },
    );
    expect(
      replayHistory({ kind: 'relation', relations: side }, rule({ minConfidence: 0.5 })).history,
    ).toMatchObject({ decided: 0, wouldAccept: 0, undecided: 1 });
    // Another source, or a converter of another version, fires nowhere.
    for (const other of [
      rule({ ...derivedRule, derivedKind: 'none' }),
      rule({ ...derivedRule, derivedKind: 'converted', converter: 'normalize-bpmn@0.1.0' }),
    ]) {
      expect(openRelationCandidates(side, other).accept).toEqual([]);
      expect(replayHistory({ kind: 'relation', relations: side }, other).history.wouldAccept).toBe(
        0,
      );
    }
  });

  it('never fires at a caller uploaded with an agent token or a conflicted call target', () => {
    const uploaded = relationSide(
      calls,
      [],
      new Map([['a', caller('export', { agentUpload: true })]]),
    );
    expect(openRelationCandidates(uploaded, derivedRule).accept).toEqual([]);
    expect(Object.fromEntries(openRelationCandidates(uploaded, derivedRule).blocked)).toEqual({
      'agent-upload': 1,
    });
    expect(
      replayHistory({ kind: 'relation', relations: uploaded }, derivedRule).history.wouldAccept,
    ).toBe(0);
    const conflicted = relationSide(
      calls,
      [],
      new Map([['a', caller('export', { conflicted: ['C1'] })]]),
    );
    expect(Object.fromEntries(openRelationCandidates(conflicted, derivedRule).blocked)).toEqual({
      'amendment-conflict': 1,
    });
  });

  it('no agent rule takes an agent’s call proposal from a caller an agent token uploaded', () => {
    const agentCall = { id: 'c4', type: 'call' as const, from: 'a#C4', to: 'b#P4' };
    const side = (agentUpload: boolean) =>
      relationSide(
        [{ ...agentCall, history: [ra('c4', AGENT, 'proposal')] }, calls[3]!],
        [],
        new Map([['a', caller('export', { agentUpload })]]),
      );
    const agentRule = rule({ minConfidence: 0.9 });
    expect(openRelationCandidates(side(false), agentRule).accept.map((o) => o.relation.id)).toEqual(
      ['c4', 'm1'],
    );
    // the call is blocked (decision 28 (1)); the caller's message is not a call
    const uploaded = openRelationCandidates(side(true), agentRule);
    expect(uploaded.accept.map((o) => o.relation.id)).toEqual(['m1']);
    expect(Object.fromEntries(uploaded.blocked)).toEqual({ 'agent-upload': 1 });
    const decided = (agentUpload: boolean) =>
      relationSide(
        [{ ...agentCall, history: [ra('c4', AGENT, 'proposal'), ra('c4', OWNER, 'decision')] }],
        [],
        new Map([['a', caller('export', { agentUpload })]]),
      );
    expect(
      replayHistory({ kind: 'relation', relations: decided(false) }, agentRule).history,
    ).toMatchObject({ wouldAccept: 1, accepted: 1 });
    expect(
      replayHistory({ kind: 'relation', relations: decided(true) }, agentRule).history,
    ).toMatchObject({ decided: 1, wouldAccept: 0 });
  });

  it('counts the derived calls per source a rule can name (derivedGroups)', () => {
    const side = relationSide(
      [
        ...calls,
        { id: 'k1', type: 'call', from: 'k#C1', to: 'b#Q1', history: [rp('k1')] },
        {
          id: 'k2',
          type: 'call',
          from: 'k#C2',
          to: 'b#Q2',
          history: [
            rp('k2'),
            ra('k2', OWNER, 'decision', {
              verdict: 'reject',
              linkedRelationId: 'rel_x',
            }),
          ],
        },
        { id: 'y1', type: 'call', from: 'y#C1', to: 'b#Y1', history: [rp('y1')] },
        {
          id: 'n1',
          type: 'call',
          from: 'n#C1',
          to: 'b#N1',
          history: [rp('n1'), ra('n1', AGENT, 'proposal', { question: 'Wirklich?' })],
        },
        { id: 'r1', type: 'call', from: 'r#C1', to: 'b#R1', history: [rp('r1')] },
        { id: 'v1', type: 'call', from: 'v#C1', to: 'b#V1', history: [rp('v1')] },
      ],
      [],
      new Map([
        ['a', caller('export')],
        ['k', caller('converted', { converter: 'normalize-bpmn@0.1.0' })],
        ['y', caller('converted', { converter: 'normalize-bpmn@0.2.0', agentUpload: true })],
        ['n', caller(null)],
        ['r', caller('reconstructed')],
        // a conversion without converter: no rule can name it
        ['v', caller('converted')],
      ]),
    );
    expect(derivedGroups(side)).toEqual([
      { derivedKind: 'export', converter: null, open: 1, blocked: 0, accepted: 1, rejected: 1 },
      {
        derivedKind: 'converted',
        converter: 'normalize-bpmn@0.1.0',
        open: 1,
        blocked: 0,
        accepted: 0,
        rejected: 1,
      },
      {
        derivedKind: 'converted',
        converter: 'normalize-bpmn@0.2.0',
        open: 0,
        blocked: 1,
        accepted: 0,
        rejected: 0,
      },
      { derivedKind: 'none', converter: null, open: 0, blocked: 1, accepted: 0, rejected: 0 },
    ]);
    // A project whose callers are modelled now has none.
    expect(derivedGroups(relationSide(calls))).toEqual([]);
  });

  it('marks the ledger entry of an acceptance a derived call triggered', () => {
    const trigger = rp('c9');
    const decision = ra('c9', OWNER, 'decision', {
      autoAcceptRuleId: RULE_ID,
      autoAcceptRuleRevision: 1,
      autoAcceptTriggerId: trigger.id,
    });
    const [item] = ledgerItems(
      [
        {
          kind: 'relation',
          id: 'c9',
          status: 'accepted',
          endpointState: 'ok',
          type: 'call',
          from: 'a#C9',
          to: 'b#P9',
          valueChainKey: null,
          step: null,
          process: null,
          history: [trigger, decision].map((a) => ({ ...a, linked: null, llmModel: null })),
        },
      ],
      () => 'Aufrufe: Export ohne Engine',
    );
    expect(item?.entry).toMatchObject({
      proposedBy: 'rule',
      agent: { principalId: RULES, handle: 'analyzr-rules' },
      tier: 'key',
      confidence: 0.9,
    });
  });
});

describe('models no person has seen in a tool (owner decision 30 (2))', () => {
  const RULES = 'prn_0000000000000000000000RULE' as PrincipalId;
  const declared = (derivedKind: 'export' | 'reconstructed' | 'as-told' | null) => ({
    trust: derivedKind === null ? null : { class: 'derived', reasons: ['no-engine'] },
    derivedKind,
    converter: null,
    conflictedCalls: new Set<string>(),
  });
  /** `a` an export, `b` a plain Camunda model, `r` read from a picture, `t` drawn from interviews. */
  const trust = new Map([
    ['a', declared('export')],
    ['b', declared(null)],
    ['r', declared('reconstructed')],
    ['t', declared('as-told')],
  ]);

  it('opens nothing with an end in such a model and counts it blocked, at every minimum', () => {
    // Ad-hoc proposals (always current), so only the declaration tells them apart.
    const adHoc = (id: string, confidence = 0.95) =>
      ra(id, AGENT, 'proposal', { submissionId: null, confidence });
    const rels = [
      { id: 'm1', from: 'a#E1', to: 'b#S1', history: [adHoc('m1')] },
      { id: 'm2', from: 'r#E2', to: 'b#S2', history: [adHoc('m2')] },
      { id: 'm3', from: 'a#E3', to: 'r#S3', history: [adHoc('m3')] },
      { id: 'm4', from: 't#E4', to: 'b#S4', history: [adHoc('m4', 0.85)] },
    ];
    const adHocRule = (minConfidence: number) => rule({ minConfidence, includeAdHoc: true });
    const side = relationSide(rels, [], trust);
    const open = openRelationCandidates(side, adHocRule(0.9));
    expect(open.accept.map((o) => o.relation.id)).toEqual(['m1']);
    expect(Object.fromEntries(open.blocked)).toEqual({ 'reconstructed-endpoint': 2 });
    const low = openRelationCandidates(side, adHocRule(0.8));
    expect(low.accept.map((o) => o.relation.id)).toEqual(['m1']);
    expect(Object.fromEntries(low.blocked)).toEqual({ 'reconstructed-endpoint': 3 });
    // Without the declaration all four meet the rule at 0.8.
    expect(openRelationCandidates(relationSide(rels), adHocRule(0.8)).accept).toHaveLength(4);
    // A stale pipeline proposal on such a model reports the declaration first.
    const stale = relationSide(
      [{ id: 'm6', from: 'r#E6', to: 'b#S6', history: [ra('m6', AGENT, 'proposal')] }],
      [],
      trust,
    );
    expect(Object.fromEntries(openRelationCandidates(stale, rule()).blocked)).toEqual({
      'reconstructed-endpoint': 1,
    });
  });

  it('never fires in the replay, and the subjects still count as decided', () => {
    const decided = (id: string, from: string, to: string) => ({
      id,
      from,
      to,
      history: [ra(id, AGENT, 'proposal'), ra(id, OWNER, 'decision')],
    });
    const rels = [
      decided('m1', 'a#E1', 'b#S1'),
      decided('m2', 'r#E2', 'b#S2'),
      decided('m3', 'b#E3', 't#S3'),
    ];
    const replay = replayHistory(
      { kind: 'relation', relations: relationSide(rels, [], trust) },
      rule(),
    );
    expect(replay.history).toMatchObject({ decided: 3, wouldAccept: 1, accepted: 1 });
    expect(replay.curve.find((c) => c.minConfidence === 0.9)).toMatchObject({ wouldAccept: 1 });
    // An acceptance a rule made on such a model before is no longer counted as unreviewed.
    const auto = {
      id: 'm5',
      from: 'r#E5',
      to: 'b#S5',
      history: [
        ra('m5', AGENT, 'proposal'),
        ra('m5', OWNER, 'decision', { autoAcceptRuleId: RULE_ID, autoAcceptRuleRevision: 1 }),
      ],
    };
    expect(
      replayHistory({ kind: 'relation', relations: relationSide([auto], [], trust) }, rule())
        .history,
    ).toMatchObject({ wouldAccept: 0, autoUnreviewed: 0 });
    expect(
      replayHistory({ kind: 'relation', relations: relationSide([auto]) }, rule()).history,
    ).toMatchObject({ autoUnreviewed: 1 });
  });

  it('blocks a rule for derived calls on a call into such a callee (derivedGroups too)', () => {
    const rp = (relationId: string) =>
      ra(relationId, RULES, 'proposal', {
        sourceKind: 'rule',
        confidence: 0.9,
        rationale: 'Vertrauensregel: Der Aufruf nennt genau einen Prozess …',
        submissionId: null,
        declared: null,
        fromHash: null,
        toHash: null,
        handle: 'analyzr-rules',
      });
    const derivedRule = rule({
      proposedBy: 'rule',
      relationType: 'call',
      minConfidence: 0.9,
      derivedKind: 'export',
    });
    const side = relationSide(
      [
        { id: 'c1', type: 'call', from: 'a#C1', to: 'b#P1', history: [rp('c1')] },
        { id: 'c2', type: 'call', from: 'a#C2', to: 'r#P2', history: [rp('c2')] },
        {
          id: 'c3',
          type: 'call',
          from: 'a#C3',
          to: 'r#P3',
          history: [rp('c3'), ra('c3', OWNER, 'decision')],
        },
      ],
      [],
      trust,
    );
    const open = openRelationCandidates(side, derivedRule);
    expect(open.accept.map((o) => o.relation.id)).toEqual(['c1']);
    expect(Object.fromEntries(open.blocked)).toEqual({ 'reconstructed-endpoint': 1 });
    expect(replayHistory({ kind: 'relation', relations: side }, derivedRule).history).toMatchObject(
      { decided: 1, wouldAccept: 0 },
    );
    expect(derivedGroups(side)).toEqual([
      { derivedKind: 'export', converter: null, open: 1, blocked: 1, accepted: 1, rejected: 0 },
    ]);
  });

  it('places no process of such a model, now or in the replay', () => {
    const placementRule = rule({ kind: 'placement', tier: 'lexical' });
    const items = [
      { id: 'p1', step: 'step-a', process: 'a#P1', history: [pa('p1', AGENT, 'proposal')] },
      { id: 'p2', step: 'step-a', process: 'r#P2', history: [pa('p2', AGENT, 'proposal')] },
      { id: 'p3', step: '@outside', process: 't#P3', history: [pa('p3', AGENT, 'proposal')] },
    ];
    const open = openPlacementCandidates(placementSide(items, { trust }), placementRule);
    expect(open.accept.map((o) => o.placement.id)).toEqual(['p1']);
    expect(Object.fromEntries(open.blocked)).toEqual({ 'reconstructed-endpoint': 2 });
    const decided = items.map((i) => ({
      ...i,
      history: [...i.history, pa(i.id, OWNER, 'decision')],
    }));
    const replay = replayHistory(
      { kind: 'placement', placements: [placementSide(decided, { trust })] },
      placementRule,
    );
    expect(replay.history).toMatchObject({ decided: 3, wouldAccept: 1, accepted: 1 });
    expect(
      replayHistory({ kind: 'placement', placements: [placementSide(decided)] }, placementRule)
        .history,
    ).toMatchObject({ decided: 3, wouldAccept: 2 });
  });
});

describe('performance', () => {
  it('replays 5,000 relations with 30,000 assertions within 2 s', () => {
    const rels: { id: string; history: StoredAssertion[] }[] = [];
    for (let i = 0; i < 5000; i++) {
      const id = `r${i}`;
      const history = [
        ra(id, AGENT, 'proposal', { confidence: 0.85 + (i % 3) * 0.05 }),
        ra(id, OTHER, 'proposal'),
        ra(id, AGENT, 'withdrawal'),
        ra(id, AGENT, 'proposal'),
        ra(id, OTHER, 'withdrawal'),
        ra(id, OWNER, 'decision', { verdict: i % 5 === 0 ? 'reject' : 'accept' }),
      ];
      rels.push({ id, history });
    }
    const side = relationSide(rels);
    const started = performance.now();
    const preview = replayHistory({ kind: 'relation', relations: side }, rule());
    openRelationCandidates(side, rule());
    const elapsed = performance.now() - started;
    expect(preview.history.decided).toBe(5000);
    expect(elapsed).toBeLessThan(2000);
  });
});

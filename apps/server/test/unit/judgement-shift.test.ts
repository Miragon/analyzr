/**
 * The cost of a head change, the pure parts (M6 S2b follow-up; the amendment
 * cost, M6 §4.8 c): the pairs a change leaves without a current agent
 * judgement (`judgementShift`), and the pairs agents judge around the
 * queued models (`pairsToJudge`, as `planClaim` assigns them before its
 * partner rules: an upper bound when other models' open tasks take pairs).
 */
import type { Candidate, DeclaredProcedure, Ref } from '@analyzr/contracts';
import { describe, expect, it } from 'vitest';

import {
  currentPairs,
  judgementShift,
  pairKey,
  pairsToJudge,
  planClaim,
  type JudgementBasis,
  type RelationState,
} from '../../src/domain/judgements.ts';

const V1: DeclaredProcedure = { id: 'analyzr-relations', version: '0.2.0' };
const V0: DeclaredProcedure = { id: 'analyzr-relations', version: '0.1.0' };
const BEFORE = new Map([
  ['a', 'ha1'],
  ['b', 'hb1'],
  ['c', 'hc1'],
]);

/** A judgement on a typed pair, made on these hashes. */
const judgement = (
  from: string,
  to: string,
  fromHash: string,
  toHash: string,
  procedure: DeclaredProcedure = V1,
  type: JudgementBasis['type'] = 'message',
): JudgementBasis => ({
  type,
  from: from as Ref,
  to: to as Ref,
  fromHash,
  toHash,
  procedure,
});

const shift = (judgements: JudgementBasis[], after: Map<string, string>) =>
  [...judgementShift({ judgements, before: BEFORE, after, procedure: V1 })].sort();

const key = (from: string, to: string, type = 'message') => pairKey({ type, from, to });

describe('judgementShift', () => {
  it('counts a pair whose judgement a changed hash makes stale', () => {
    const j = judgement('a#E', 'b#S', 'ha1', 'hb1');
    expect(shift([j], new Map(BEFORE).set('a', 'ha2'))).toEqual([key('a#E', 'b#S')]);
    // the other model's change, or none: nothing lost
    expect(shift([j], new Map(BEFORE).set('c', 'hc2'))).toEqual([]);
    expect(shift([j], BEFORE)).toEqual([]);
  });

  it('counts an intra-model pair and a pair between two changed models once', () => {
    const after = new Map(BEFORE).set('a', 'ha2').set('b', 'hb2');
    expect(
      shift(
        [
          judgement('a#E', 'a#S', 'ha1', 'ha1'),
          judgement('a#E', 'b#S', 'ha1', 'hb1'),
          // the same pair judged by a second agent
          judgement('a#E', 'b#S', 'ha1', 'hb1'),
        ],
        after,
      ),
    ).toEqual([key('a#E', 'a#S'), key('a#E', 'b#S')].sort());
  });

  it('counts a link and a no-link on one pair as one pair', () => {
    // linkJudgements and noLinkJudgement give the same shape: a basis on a typed pair
    const link = judgement('a#E', 'b#S', 'ha1', 'hb1');
    const noLink = { ...judgement('a#E', 'b#S', 'ha1', 'hb1') };
    expect(shift([link, noLink], new Map(BEFORE).set('b', 'hb2'))).toEqual([key('a#E', 'b#S')]);
  });

  it('never counts a judgement under another procedure: never current, never lost', () => {
    const old = judgement('a#E', 'b#S', 'ha1', 'hb1', V0);
    expect(shift([old], new Map(BEFORE).set('a', 'ha2'))).toEqual([]);
  });

  it('counts the pairs of a deleted model (its key leaves the heads)', () => {
    const after = new Map(BEFORE);
    after.delete('b');
    expect(
      shift([judgement('a#E', 'b#S', 'ha1', 'hb1'), judgement('a#E', 'c#S', 'ha1', 'hc1')], after),
    ).toEqual([key('a#E', 'b#S')]);
  });

  it('loses nothing on a revert that makes a stale judgement current again', () => {
    const now = judgement('a#E', 'b#S', 'ha1', 'hb1');
    const earlier = judgement('a#E', 'b#S', 'ha0', 'hb1');
    const back = new Map(BEFORE).set('a', 'ha0');
    // the pair keeps a current judgement: the earlier one
    expect(shift([now, earlier], back)).toEqual([]);
    // a stale judgement made current is no loss on a pair without another
    expect(shift([earlier], back)).toEqual([]);
    expect(currentPairs([earlier], back, V1)).toEqual(new Set([key('a#E', 'b#S')]));
  });
});

describe('pairsToJudge', () => {
  const candidate = (
    from: string,
    to: string,
    basis: Candidate['basis'],
    type: Candidate['type'] = 'message',
  ): Candidate => ({ type, from: from as Ref, to: to as Ref, basis, score: 0.5, signals: {} });
  const relation = (
    from: string,
    to: string,
    status: RelationState['status'],
    endpointState: RelationState['endpointState'] = 'ok',
    type: RelationState['type'] = 'message',
  ): RelationState => ({
    type,
    fromRef: from as Ref,
    toRef: to as Ref,
    status,
    endpointState,
  });
  const candidates: Record<string, Candidate[]> = {
    a: [
      candidate('a#E', 'b#S1', 'key'),
      candidate('a#E', 'b#S2', 'lexical'),
      candidate('a#E', 'b#S3', 'compatible'),
      candidate('a#E', 'c#S', 'lexical'),
      candidate('a#E', 'c#S2', 'lexical'),
      candidate('a#C', 'b#P', 'rule', 'call'),
    ],
    b: [candidate('a#E', 'b#S1', 'key'), candidate('b#E', 'c#S', 'lexical')],
  };
  const relations = [
    // settled: accepted, or rejected with unchanged endpoints
    relation('a#C', 'b#P', 'accepted', 'ok', 'call'),
    relation('a#E', 'c#S2', 'rejected'),
    // assigned like a candidate, whatever its basis: a held or proposed relation
    relation('a#E', 'b#S3', 'held'),
    relation('b#E', 'd#S', 'proposed'),
    // a rejection whose end changed is judged again; a missing end is nobody's
    relation('a#E', 'd#S', 'rejected', 'changed'),
    relation('a#E', 'e#S', 'proposed', 'missing'),
    // not touching a queued model
    relation('c#E', 'd#S', 'proposed'),
    // humans' and obsolete ones are no pairs
    relation('a#E', 'd#S2', 'accepted', 'ok', 'manual'),
    relation('a#E', 'd#S3', 'obsolete'),
  ];

  it('unions the assigned candidates and relations of the queued models without current judgements and settled pairs', () => {
    const judged = new Set([key('a#E', 'c#S')]);
    const pairs = pairsToJudge({
      models: ['b', 'a'],
      candidatesOf: (m) => candidates[m] ?? [],
      relations,
      judged,
    });
    expect([...pairs.keys()].sort()).toEqual(
      [
        key('a#E', 'b#S1'),
        key('a#E', 'b#S2'),
        key('a#E', 'b#S3'),
        key('a#E', 'd#S'),
        key('b#E', 'c#S'),
        key('b#E', 'd#S'),
      ].sort(),
    );
    expect(pairs.get(key('a#E', 'b#S1'))).toEqual({ type: 'message', from: 'a#E', to: 'b#S1' });
    // nothing queued, nothing to judge
    expect(pairsToJudge({ models: [], candidatesOf: () => [], relations, judged }).size).toBe(0);
  });

  it('equals the union of what planClaim assigns the queued models (no partner tasks)', () => {
    const models = ['a', 'b'];
    const judged = new Set([key('a#E', 'c#S')]);
    const settled = new Set([key('a#C', 'b#P', 'call'), key('a#E', 'c#S2')]);
    const assigned = new Set<string>();
    for (const m of models) {
      const plan = planClaim({
        modelKey: m,
        candidates: candidates[m] ?? [],
        relations: relations
          .filter(
            (r) =>
              r.type !== 'manual' &&
              ['proposed', 'held'].includes(r.status) &&
              r.endpointState !== 'missing',
          )
          .concat(relations.filter((r) => r.status === 'rejected' && r.endpointState !== 'ok'))
          .filter((r) => r.fromRef.startsWith(`${m}#`) || r.toRef.startsWith(`${m}#`))
          .map((r) => ({ type: r.type as 'message', from: r.fromRef, to: r.toRef })),
        judgements: [],
        settled,
        partners: new Map(),
        partnerCandidates: () => new Set(),
      });
      for (const p of plan.assignment) {
        if (!judged.has(pairKey(p))) assigned.add(pairKey(p));
      }
    }
    const pairs = pairsToJudge({
      models,
      candidatesOf: (m) => candidates[m] ?? [],
      relations,
      judged,
    });
    expect([...pairs.keys()].sort()).toEqual([...assigned].sort());
  });

  it('is an upper bound when an open task of a model outside the queued ones takes a pair', () => {
    // `a` waits with a queued task and sorts first: judge each pair once gives it the pair
    // both share, which `b`'s claim skips; the count keeps it (`a` would judge it anyway).
    const shared = key('a#E', 'b#S1');
    const plan = planClaim({
      modelKey: 'b',
      candidates: candidates['b'] ?? [],
      relations: [],
      judgements: [],
      settled: new Set(),
      partners: new Map([
        ['a', { state: 'queued' as const, live: false, assignment: new Set(), sawClaimant: false }],
      ]),
      partnerCandidates: () => new Set([shared]),
    });
    expect(plan.assignment.map(pairKey)).toEqual([key('b#E', 'c#S')]);
    expect(plan.skip.map(pairKey)).toEqual([shared]);
    const pairs = pairsToJudge({
      models: ['b'],
      candidatesOf: (m) => candidates[m] ?? [],
      relations: [],
      judged: new Set(),
    });
    expect([...pairs.keys()].sort()).toEqual([shared, key('b#E', 'c#S')].sort());
  });
});

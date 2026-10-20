/**
 * The size of the agents' next run, the pure parts (`ProjectSummary.pairsToJudge`,
 * M6 S2b follow-up step 3b): `pairsToJudge` over every claimable model's own
 * candidates as the whole-project pass gives them (`projectCandidates`'s
 * `byFocus`, what the summary reads) equals `pairsToJudge` over each model's
 * own `generateCandidates` call (on `_sample` and `nordwind-handel` with the
 * real libraries, for several sets of models), and counts a pair between two
 * of them once; `heldPairs` is `planClaim`'s rule 1 for them.
 */
import type { Candidate, Ref, TypedPair } from '@analyzr/contracts';
import { generateCandidates, projectCandidates } from '@analyzr/relations';
import { describe, expect, it } from 'vitest';

import {
  heldPairs,
  isAssigned,
  modelOf,
  pairKey,
  pairsToJudge,
  planClaim,
  settles,
  type RelationState,
} from '../../src/domain/judgements.ts';
import { corpusFiles, libraryView } from '../support/corpus.ts';

const candidate = (from: string, to: string, basis: Candidate['basis']): Candidate => ({
  type: 'message',
  from: from as Ref,
  to: to as Ref,
  basis,
  score: 0.5,
  signals: {},
});

const key = (from: string, to: string, type = 'message') => pairKey({ type, from, to });
const pair = (from: string, to: string): TypedPair => ({
  type: 'message',
  from: from as Ref,
  to: to as Ref,
});

describe('pairsToJudge over the whole-project pass', () => {
  it('counts a pair between two claimable models once, though both claims have it among their candidates', () => {
    const own = new Map([
      ['a', [candidate('a#E', 'b#S', 'key'), candidate('a#E', 'a#S', 'lexical')]],
      ['b', [candidate('a#E', 'b#S', 'key'), candidate('b#E', 'c#S', 'lexical')]],
    ]);
    const pairs = pairsToJudge({
      models: ['b', 'a'],
      candidatesOf: (m) => own.get(m) ?? [],
      relations: [],
      judged: new Set([key('b#E', 'c#S')]),
    });
    expect([...pairs.values()]).toEqual([pair('a#E', 'b#S'), pair('a#E', 'a#S')]);
  });

  it('equals pairsToJudge over each model’s own candidates, on the real libraries', async () => {
    for (const landscape of ['_sample', 'nordwind-handel']) {
      const { projectFacts, rules } = await libraryView(await corpusFiles(landscape));
      const keys = projectFacts.models.map((m) => m.modelKey);
      const pass = projectCandidates(projectFacts);
      const ownOf = new Map(keys.map((k) => [k, generateCandidates(projectFacts, k)]));
      const relations = rules.relations.map((r, i): RelationState => ({
        type: r.type,
        fromRef: r.from,
        toRef: r.to,
        // some settled by a decision, the others assigned
        status: i % 4 === 0 ? 'rejected' : r.status,
        endpointState: 'ok',
      }));
      // A few current judgements: every third assigned pair of the whole project.
      const judged = new Set(
        pass.candidates
          .filter(isAssigned)
          .map(pairKey)
          .filter((_, i) => i % 3 === 0),
      );
      const settled = new Set(
        relations.filter(settles).map((r) => key(r.fromRef, r.toRef, r.type)),
      );
      let fewer = false;
      for (const models of [
        keys,
        keys.slice(0, Math.ceil(keys.length / 2)),
        keys.filter((_, i) => i % 3 === 1),
        keys.slice(-1),
      ]) {
        const exact = pairsToJudge({
          models,
          candidatesOf: (m) => ownOf.get(m) ?? [],
          relations,
          judged,
        });
        const read = pairsToJudge({
          models,
          candidatesOf: (m) => pass.byFocus.get(m) ?? [],
          relations,
          judged,
        });
        expect([...read.keys()], `${landscape}: ${models.length} models`).toEqual([
          ...exact.keys(),
        ]);
        // The whole project's open assigned pairs touching one of them would count more: there a
        // pair has the best basis of both ends' perspectives.
        const set = new Set(models);
        const touching = pass.candidates.filter(
          (c) =>
            isAssigned(c) &&
            !judged.has(pairKey(c)) &&
            !settled.has(pairKey(c)) &&
            (set.has(modelOf(c.from)) || set.has(modelOf(c.to))),
        );
        if (touching.some((c) => !exact.has(pairKey(c)))) fewer = true;
      }
      if (landscape === 'nordwind-handel') expect(fewer).toBe(true);
    }
  });
});

describe('heldPairs', () => {
  const claimed = [
    {
      id: 't1',
      modelKey: 'b',
      assignment: [pair('a#E', 'b#S'), pair('b#E', 'c#S'), pair('b#E', 'b#S')],
    },
    { id: 't2', modelKey: 'd', assignment: null },
  ];

  it('holds the pairs of a claim’s assignment with a waiting model its claim saw as it is now', () => {
    const waiting = new Set(['a', 'c']);
    expect([...heldPairs(claimed, waiting, () => true)].sort()).toEqual(
      [key('a#E', 'b#S'), key('b#E', 'c#S')].sort(),
    );
    // c changed since b's claim: c's claim judges the pair again
    expect([...heldPairs(claimed, waiting, (_, m) => m !== 'c')]).toEqual([key('a#E', 'b#S')]);
    // a model that does not wait holds nothing for anyone; nor does a claim without assignment
    expect([...heldPairs(claimed, new Set(['d']), () => true)]).toEqual([]);
  });

  it('is what planClaim skips for the waiting model (rule 1)', () => {
    const held = heldPairs(claimed, new Set(['a']), () => true);
    const plan = planClaim({
      modelKey: 'a',
      candidates: [candidate('a#E', 'b#S', 'key'), candidate('a#E', 'c#S', 'key')],
      relations: [],
      judgements: [],
      settled: new Set(),
      partners: new Map([
        [
          'b',
          {
            state: 'claimed' as const,
            live: true,
            assignment: new Set((claimed[0]?.assignment ?? []).map(pairKey)),
            sawClaimant: true,
          },
        ],
      ]),
      partnerCandidates: () => new Set(),
    });
    expect(plan.skip.map(pairKey)).toEqual([...held]);
    expect(plan.assignment.map(pairKey)).toEqual([key('a#E', 'c#S')]);
  });
});

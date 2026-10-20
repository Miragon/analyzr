/**
 * The pure parts of the import impact (M6 §3.5, S2b): the absent keys
 * within a manifest's scope, and how a file changes its model's processes.
 * The relations' part runs end to end in `integration/import-dry-run.test.ts`.
 * The S2b follow-up's relations tasks: the impact plans the recompute once
 * (the relations' part as `relationImpact` gives it), the relations after
 * the plan, the tasks queued and cancelled (the claimed ones first, past the
 * cap), and the pairs agents judge around the queued models, as
 * `planClaim` assigns them, with the judgements the write makes non-current.
 */
import { extractFacts, factsHash } from '@analyzr/bpmn-facts';
import {
  MAX_IMPACT_ITEMS,
  type DeclaredProcedure,
  type ProjectFacts,
  type Ref,
  type RevisionSource,
} from '@analyzr/contracts';
import { generateCandidates, runRules } from '@analyzr/relations';
import { describe, expect, it } from 'vitest';

import {
  absentKeys,
  fileImpact,
  importImpact,
  relationImpact,
  relationsAfter,
  type FileHeads,
  type OpenRelationsTask,
  type TaskInput,
} from '../../src/domain/import-impact.ts';
import {
  isAssignedRelation,
  pairKey,
  planClaim,
  settles,
  type JudgementBasis,
} from '../../src/domain/judgements.ts';
import { planRecompute, type RecomputeInput } from '../../src/domain/recompute.ts';
import { naturalKey } from '../../src/domain/relation-state.ts';
import {
  AUFTRAG_KEY,
  RECHNUNG_KEY,
  VERSAND_KEY,
  auftrag,
  rechnung,
  versand,
} from '../support/amend-fixtures.ts';
import { PROJECT, RULES } from '../support/open-questions.ts';
import { MODELLED, NO_ENGINE, trustOfModels } from '../support/trust.ts';

const source = (system: string, externalPath?: string): RevisionSource => ({
  kind: 'import',
  system,
  ...(externalPath ? { externalPath } : {}),
});

describe('import impact', () => {
  const sources = new Map<string, RevisionSource>([
    ['finanzen/a', source('signavio', 'Finanzen/A')],
    ['finanzen/b', source('signavio', 'Finanzen/B')],
    ['finanzen2/x', source('signavio', 'Finanzen2/X')],
    ['lager/c', source('signavio', 'Lager/C')],
    ['aris/d', source('aris', 'Finanzen/D')],
    ['ohne/pfad', source('signavio')],
  ]);

  it('lists the live keys of the system the bundle does not name, within its scope', () => {
    const named = new Set(['finanzen/a']);
    expect(absentKeys(sources, { system: 'signavio', scope: ['Finanzen'] }, named)).toEqual([
      'finanzen/b',
    ]);
    // a folder's name is no prefix of another's („Finanzen2“), a model without a folder is outside
    expect(absentKeys(sources, { system: 'signavio' }, named)).toEqual([
      'finanzen/b',
      'finanzen2/x',
      'lager/c',
      'ohne/pfad',
    ]);
    expect(absentKeys(sources, null, named)).toEqual([]);
    expect(absentKeys(sources, { system: 'aris', scope: [] }, named)).toEqual([]);
  });

  it('says whether a file changes its facts and which processes it adds or removes', () => {
    expect(
      fileImpact([
        {
          modelKey: 'm',
          previousFactsHash: 'a',
          factsHash: 'b',
          previousProcesses: [{ ref: 'm#P1' }, { ref: 'm#P2' }],
          processes: [{ ref: 'm#P2' }, { ref: 'm#P3' }],
          trust: MODELLED,
        },
        {
          modelKey: 'n',
          previousFactsHash: null,
          factsHash: 'c',
          previousProcesses: [],
          processes: [],
          trust: NO_ENGINE,
        },
        {
          modelKey: 'o',
          previousFactsHash: 'd',
          factsHash: 'd',
          previousProcesses: [],
          processes: [],
          trust: MODELLED,
        },
      ]),
    ).toEqual([
      {
        modelKey: 'm',
        factsChanged: true,
        processesAdded: ['m#P3'],
        processesRemoved: ['m#P1'],
        trust: MODELLED,
      },
      {
        modelKey: 'n',
        factsChanged: true,
        processesAdded: [],
        processesRemoved: [],
        trust: NO_ENGINE,
      },
      {
        modelKey: 'o',
        factsChanged: false,
        processesAdded: [],
        processesRemoved: [],
        trust: MODELLED,
      },
    ]);
  });
});

const PROCEDURE: DeclaredProcedure = { id: 'analyzr-relations', version: '0.2.0' };

/** The head facts of the files, in key order, with their facts hashes. */
async function extracted(
  files: { key: string; xml: string }[],
): Promise<{ facts: ProjectFacts; hashes: Map<string, string> }> {
  const models: ProjectFacts['models'] = [];
  const hashes = new Map<string, string>();
  for (const f of [...files].sort((a, b) => (a.key < b.key ? -1 : 1))) {
    const r = await extractFacts(f.xml, { modelKey: f.key });
    models.push({
      modelKey: f.key,
      factsVersion: r.factsVersion,
      processes: r.processes,
      facts: r.facts,
      messageFlows: r.messageFlows,
    });
    hashes.set(f.key, factsHash(r.facts));
  }
  return { facts: { models }, hashes };
}

/** A first import of the facts: no relations, no history. */
const firstInput = (facts: ProjectFacts): RecomputeInput => ({
  projectId: PROJECT,
  rulesPrincipalId: RULES,
  projectFacts: facts,
  rules: runRules(facts),
  trust: trustOfModels(facts),
  relations: [],
  history: [],
});

const heads = (modelKey: string, previousFactsHash: string | null, hash: string): FileHeads => ({
  modelKey,
  previousFactsHash,
  factsHash: hash,
  previousProcesses: [],
  processes: [],
  trust: MODELLED,
});

const tasksOf = (facts: ProjectFacts, extra: Partial<TaskInput> = {}): TaskInput => ({
  judgements: [],
  before: new Map(),
  procedure: PROCEDURE,
  open: new Map(),
  doneFactsHash: () => null,
  candidatesOf: (key) => generateCandidates(facts, key),
  ...extra,
});

const landscape = () =>
  extracted([
    { key: AUFTRAG_KEY, xml: auftrag({ callRechnung: 'Process_Rechnung' }) },
    { key: RECHNUNG_KEY, xml: rechnung() },
    { key: VERSAND_KEY, xml: versand() },
  ]);

describe('the relations tasks of an impact (S2b follow-up)', () => {
  it('plans the recompute once: the relations’ part is what relationImpact gives', async () => {
    const { facts, hashes } = await landscape();
    const input = firstInput(facts);
    const files = [...hashes].map(([key, hash]) => heads(key, null, hash));
    const {
      files: _files,
      absentKeys: _absent,
      relationsTasks,
      ...relations
    } = importImpact(input, [], files, [], undefined, tasksOf(facts));
    expect(relations).toEqual(relationImpact(input, []));
    // a first import queues every model; nothing was judged, nothing is judged again
    expect(relationsTasks.queued).toEqual({ count: 3, items: [...hashes.keys()].sort() });
    expect(relationsTasks.cancelled).toEqual({ count: 0, items: [] });
    expect(relationsTasks.rejudged).toEqual({ count: 0, items: [] });
    expect(relationsTasks.pairs).toBeGreaterThan(0);
  });

  it('reads the relations after the plan: new ones by their placeholder id, the refreshed ones patched', async () => {
    const { facts } = await landscape();
    const input = firstInput(facts);
    const plan = planRecompute(input);
    const after = relationsAfter(input, plan);
    const inserts = plan.steps.flatMap((s) => (s.kind === 'derive' && s.insert ? [s] : []));
    expect(inserts.length).toBeGreaterThan(0);
    expect(after.size).toBe(inserts.length);
    for (const s of inserts) {
      expect(after.get(naturalKey(s.target.type, s.target.fromRef, s.target.toRef))).toMatchObject({
        id: s.target.id,
        status: s.insert?.state.status,
        endpointState: s.insert?.state.endpointState,
      });
    }
    // the call of a modelled caller is accepted (decision 9): settled after the plan
    const call = after.get(
      naturalKey('call', `${AUFTRAG_KEY}#Call_Rechnung`, `${RECHNUNG_KEY}#Process_Rechnung`),
    );
    expect(call?.status).toBe('accepted');

    // stored relations come back with the plan's refresh: a relation whose callee is gone
    const stored = [...after.values()].map((r, i) => ({
      ...r,
      id: `rel_${String(i).padStart(26, '0')}` as never,
      projectId: PROJECT,
      tier: 'rule' as const,
      confidence: 1,
      attrs: {},
      fromFp: null,
      toFp: null,
      version: 1,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }));
    const without = {
      models: facts.models.filter((m) => m.modelKey !== RECHNUNG_KEY),
    };
    const next = { ...firstInput(without), relations: stored };
    const refreshPlan = planRecompute(next);
    const refreshed = relationsAfter(next, refreshPlan);
    const refreshes = refreshPlan.steps.flatMap((s) => (s.kind === 'refresh' ? [s] : []));
    expect(refreshes.length).toBeGreaterThan(0);
    for (const s of refreshes) {
      const r = s.relation;
      expect(refreshed.get(naturalKey(r.type, r.fromRef, r.toRef))).toMatchObject({
        id: r.id,
        status: s.patch.status,
        endpointState: s.patch.endpointState,
      });
    }
  });

  it('counts the pairs agents judge around the queued models, and those judged again', async () => {
    const { facts, hashes } = await landscape();
    const input = firstInput(facts);
    // the stored heads before: the caller changes its facts, the others stay
    const before = new Map(hashes).set(AUFTRAG_KEY, 'h-auftrag-before');
    const candidates = generateCandidates(facts, AUFTRAG_KEY);
    const assigned = candidates.filter((c) => c.basis === 'key' || c.basis === 'lexical');
    const compatible = candidates.find((c) => c.basis === 'compatible');
    const [first, second] = assigned;
    if (!first || !second || !compatible) throw new Error('the fixture needs assigned candidates');
    const judgement = (
      c: { type: string; from: string; to: string },
      side: 'before' | 'after',
    ): JudgementBasis => ({
      type: c.type as JudgementBasis['type'],
      from: c.from as Ref,
      to: c.to as Ref,
      fromHash: (side === 'before' ? before : hashes).get(c.from.split('#')[0] ?? '') ?? null,
      toHash: (side === 'before' ? before : hashes).get(c.to.split('#')[0] ?? '') ?? null,
      procedure: PROCEDURE,
    });
    const call = {
      type: 'call',
      from: `${AUFTRAG_KEY}#Call_Rechnung`,
      to: `${RECHNUNG_KEY}#Process_Rechnung`,
    };
    const judgements = [
      // judged on the head now: stale after the import, judged again
      judgement(first, 'before'),
      // judged on the would-be head (a revert): current after, not to judge
      judgement(second, 'after'),
      // a compatible pair is nobody's assignment, even when judged before
      judgement(compatible, 'before'),
      // the accepted call is settled after the plan
      judgement(call, 'before'),
    ];
    const impact = importImpact(
      input,
      [],
      [heads(AUFTRAG_KEY, 'h-auftrag-before', hashes.get(AUFTRAG_KEY) ?? '')],
      [],
      undefined,
      tasksOf(facts, { judgements, before }),
    );
    // what planClaim assigns the caller's claim over the relations after the plan
    const plan = planRecompute(input);
    const after = [...relationsAfter(input, plan).values()];
    const claim = planClaim({
      modelKey: AUFTRAG_KEY,
      candidates,
      relations: after
        .filter(isAssignedRelation)
        .filter(
          (r) => r.fromRef.startsWith(`${AUFTRAG_KEY}#`) || r.toRef.startsWith(`${AUFTRAG_KEY}#`),
        )
        .map((r) => ({ type: r.type as 'message', from: r.fromRef, to: r.toRef })),
      judgements: [{ ...judgement(second, 'after'), current: true }] as never,
      settled: new Set(after.filter(settles).map((r) => naturalKey(r.type, r.fromRef, r.toRef))),
      partners: new Map(),
      partnerCandidates: () => new Set(),
    });
    const { relationsTasks } = impact;
    expect(relationsTasks.queued.items).toEqual([AUFTRAG_KEY]);
    expect(relationsTasks.pairs).toBe(claim.assignment.length);
    expect(claim.assignment.map(pairKey)).not.toContain(pairKey(second));
    expect(relationsTasks.rejudged).toEqual({
      count: 1,
      items: [{ type: first.type, from: first.from, to: first.to }],
    });
    // the pairs judged again are among the pairs
    expect(claim.assignment.map(pairKey)).toContain(pairKey(first));
  });

  it('names the cancelled tasks, the claimed ones first and counted past the cap', () => {
    const facts: ProjectFacts = { models: [] };
    const files = Array.from({ length: MAX_IMPACT_ITEMS + 1 }, (_, i) =>
      heads(`m/${String(i).padStart(3, '0')}`, 'h0', 'h1'),
    );
    const open = new Map<string, OpenRelationsTask>(
      files.map((f, i) => [
        f.modelKey,
        i === files.length - 1
          ? {
              state: 'claimed' as const,
              factsHash: 'h0',
              claimedByHandle: 'agent:claude',
              assignment: [],
            }
          : { state: 'queued' as const, factsHash: 'h0', claimedByHandle: null, assignment: null },
      ]),
    );
    // one more file without a change of facts keeps its open task
    open.set('z/same', {
      state: 'claimed',
      factsHash: 'h1',
      claimedByHandle: 'agent:other',
      assignment: null,
    });
    const { relationsTasks } = importImpact(
      firstInput(facts),
      [],
      [...files, heads('z/same', 'h1', 'h1')],
      [],
      undefined,
      tasksOf(facts, { open, candidatesOf: () => [] }),
    );
    expect(relationsTasks.cancelled.count).toBe(MAX_IMPACT_ITEMS + 1);
    expect(relationsTasks.cancelled.items).toHaveLength(MAX_IMPACT_ITEMS);
    expect(relationsTasks.cancelled.items[0]).toEqual({
      modelKey: 'm/100',
      state: 'claimed',
      claimedBy: 'agent:claude',
      assigned: 0,
    });
    expect(relationsTasks.cancelled.items[1]).toEqual({
      modelKey: 'm/000',
      state: 'queued',
      claimedBy: null,
      assigned: null,
    });
    expect(relationsTasks.claimed).toBe(1);
    expect(relationsTasks.queued.count).toBe(MAX_IMPACT_ITEMS + 1);
    expect(relationsTasks.queued.items[0]).toBe('m/000');
    expect(relationsTasks.queued.items).not.toContain('z/same');
  });

  it('cancels a deleted model’s open task and queues nothing', async () => {
    const { facts, hashes } = await landscape();
    const without = { models: facts.models.filter((m) => m.modelKey !== VERSAND_KEY) };
    const { relationsTasks } = importImpact(
      firstInput(without),
      [],
      [],
      [],
      undefined,
      tasksOf(without, {
        before: hashes,
        deleted: VERSAND_KEY,
        open: new Map([
          [
            VERSAND_KEY,
            { state: 'claimed', factsHash: 'h', claimedByHandle: 'agent:a', assignment: [] },
          ],
        ]),
      }),
    );
    expect(relationsTasks).toEqual({
      queued: { count: 0, items: [] },
      cancelled: {
        count: 1,
        items: [{ modelKey: VERSAND_KEY, state: 'claimed', claimedBy: 'agent:a', assigned: 0 }],
      },
      claimed: 1,
      pairs: 0,
      rejudged: { count: 0, items: [] },
    });
  });
});

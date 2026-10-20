/**
 * The recompute under the trust rule (M6 S2c, decision 24.2), pure: plans of
 * `planRecompute` over the real rule tier, written by the real
 * `writeRecompute` into memory, so each plan runs over the state the
 * previous one left. A derived caller's unique call is a rule proposal with
 * its rationale; a rule decision on it ends when the caller turns derived;
 * human decisions stay; a modelled landscape plans exactly as before. The
 * dry run names the derived calls an owner's rule for derived calls would
 * accept in the write (M6 S2c-3), only the proposals the write records.
 */
import { extractFacts } from '@analyzr/bpmn-facts';
import {
  DERIVED_CALL_CONFIDENCE,
  MAX_IMPACT_ITEMS,
  type AutoAcceptRuleId,
  type Finding,
  type PrincipalId,
  type ProjectFacts,
  type RelationId,
} from '@analyzr/contracts';
import { runRules } from '@analyzr/relations';
import { describe, expect, it } from 'vitest';

import type { AutoAcceptRuleRev } from '../../src/domain/auto-accept/evaluate.ts';
import { headFingerprints } from '../../src/domain/fingerprints.ts';
import { relationImpact } from '../../src/domain/import-impact.ts';
import type { AssertionRecord, RelationRecord, Tx } from '../../src/domain/ports.ts';
import { planRecompute, writeRecompute, type RecomputeInput } from '../../src/domain/recompute.ts';
import { naturalKey } from '../../src/domain/relation-state.ts';
import { trustRationale, type ModelTrust } from '../../src/domain/trust.ts';
import { AUFTRAG_KEY, RECHNUNG_KEY, auftrag, rechnung } from '../support/amend-fixtures.ts';
import { AT, PROJECT, RULES, assertionId } from '../support/open-questions.ts';
import { NO_ENGINE, trustOfModels } from '../support/trust.ts';

const HUMAN = `prn_${'0'.repeat(21)}HUMAN` as PrincipalId;
const AGENT = `prn_${'0'.repeat(21)}AGENT` as PrincipalId;
const CALL = {
  type: 'call' as const,
  from: `${AUFTRAG_KEY}#Call_Rechnung`,
  to: `${RECHNUNG_KEY}#Process_Rechnung`,
};
const CALL_KEY = naturalKey(CALL.type, CALL.from, CALL.to);

async function landscape(
  engineless: boolean,
  callRechnung = 'Process_Rechnung',
): Promise<ProjectFacts> {
  return extracted([
    { key: AUFTRAG_KEY, xml: auftrag({ callRechnung, engineless }) },
    { key: RECHNUNG_KEY, xml: rechnung() },
  ]);
}

/** The head facts of the files, in key order. */
async function extracted(files: { key: string; xml: string }[]): Promise<ProjectFacts> {
  const models: ProjectFacts['models'] = [];
  for (const f of [...files].sort((a, b) => (a.key < b.key ? -1 : 1))) {
    const r = await extractFacts(f.xml, { modelKey: f.key });
    models.push({
      modelKey: f.key,
      factsVersion: r.factsVersion,
      processes: r.processes,
      facts: r.facts,
      messageFlows: r.messageFlows,
    });
  }
  return { models };
}

/** A project in memory: the plans' writes land here, and the next plan reads them. */
function memory() {
  let seq = 0;
  let ids = 0;
  const relations = new Map<RelationId, RelationRecord>();
  const assertions: AssertionRecord[] = [];
  let findings: Finding[] = [];
  const tx = {
    events: { append: () => Promise.resolve(++seq) },
    relations: {
      insert: (r: Omit<RelationRecord, 'createdAt' | 'updatedAt'>) => {
        const stored = { ...r, createdAt: AT, updatedAt: AT };
        relations.set(r.id, stored);
        return Promise.resolve(stored);
      },
      update: (_p: unknown, id: RelationId, patch: Partial<RelationRecord>) => {
        const r = relations.get(id);
        if (!r) throw new Error(`no relation ${id}`);
        const stored = { ...r, ...patch, version: r.version + 1 };
        relations.set(id, stored);
        return Promise.resolve(stored);
      },
    },
    assertions: {
      insert: (a: AssertionRecord) => {
        assertions.push(a);
        return Promise.resolve();
      },
    },
    findings: {
      replace: (_p: unknown, f: readonly Finding[]) => {
        findings = [...f];
        return Promise.resolve();
      },
    },
  } as unknown as Pick<Tx, 'events' | 'relations' | 'assertions' | 'findings'>;
  const input = (
    projectFacts: ProjectFacts,
    trust: ReadonlyMap<string, ModelTrust>,
  ): RecomputeInput => ({
    projectId: PROJECT,
    rulesPrincipalId: RULES,
    projectFacts,
    rules: runRules(projectFacts),
    trust,
    relations: [...relations.values()],
    history: [...assertions].sort((a, b) => a.seq - b.seq),
  });
  return {
    input,
    async run(projectFacts: ProjectFacts, trust: ReadonlyMap<string, ModelTrust>) {
      const plan = planRecompute(input(projectFacts, trust));
      const derivedProposals = await writeRecompute(tx, PROJECT, plan, RULES);
      return { plan, derivedProposals };
    },
    relation: () =>
      [...relations.values()].find((r) => naturalKey(r.type, r.fromRef, r.toRef) === CALL_KEY),
    ruleStance: () =>
      assertions
        .filter((a) => a.principalId === RULES && a.relationId === memoryCallId())
        .sort((a, b) => a.seq - b.seq)
        .at(-1),
    /** An agent's proposal on the call (a claim assigned it), anchored to the head's fingerprints. */
    propose(projectFacts: ProjectFacts) {
      const fps = headFingerprints(projectFacts);
      assertions.push({
        id: assertionId(++ids),
        projectId: PROJECT,
        relationId: memoryRelation().id,
        seq: ++seq,
        kind: 'proposal',
        verdict: null,
        sourceKind: 'agent',
        principalId: AGENT,
        clientId: null,
        declared: null,
        submissionId: null,
        tier: 'semantic',
        confidence: 0.8,
        rationale: 'Agent',
        evidence: null,
        question: null,
        label: null,
        linkedRelationId: null,
        fromFp: fps.get('call', 'from', CALL.from) ?? null,
        toFp: fps.get('call', 'to', CALL.to) ?? null,
        fromHash: null,
        toHash: null,
      });
    },
    /** A human decision on the call, anchored to the head's fingerprints. */
    decide(projectFacts: ProjectFacts, verdict: 'accept' | 'reject' | 'hold') {
      const r = memoryRelation();
      const fps = headFingerprints(projectFacts);
      assertions.push({
        id: assertionId(++ids),
        projectId: PROJECT,
        relationId: r.id,
        seq: ++seq,
        kind: 'decision',
        verdict,
        sourceKind: 'human',
        principalId: HUMAN,
        clientId: 'analyzr-web',
        declared: null,
        submissionId: null,
        tier: null,
        confidence: null,
        rationale: verdict === 'accept' ? null : 'Mensch',
        evidence: null,
        question: null,
        label: null,
        linkedRelationId: null,
        fromFp: fps.get('call', 'from', CALL.from) ?? null,
        toFp: fps.get('call', 'to', CALL.to) ?? null,
        fromHash: null,
        toHash: null,
      });
    },
    findings: () => findings,
  };
  function memoryRelation(): RelationRecord {
    const r = [...relations.values()].find(
      (x) => naturalKey(x.type, x.fromRef, x.toRef) === CALL_KEY,
    );
    if (!r) throw new Error('the call is not stored');
    return r;
  }
  function memoryCallId(): RelationId {
    return memoryRelation().id;
  }
}

const derivedTrust = (facts: ProjectFacts) =>
  trustOfModels(facts, { [AUFTRAG_KEY]: { trust: NO_ENGINE } });

describe('the recompute under the trust rule', () => {
  it('inserts a derived caller’s unique call with a rule proposal that carries the rationale', async () => {
    const facts = await landscape(true);
    const m = memory();
    const { plan, derivedProposals } = await m.run(facts, derivedTrust(facts));
    expect(plan.derivedCalls).toEqual(new Set([CALL_KEY]));
    const step = plan.steps.find((s) => s.kind === 'derive' && s.target.fromRef === CALL.from);
    expect(step).toMatchObject({
      kind: 'derive',
      derivedCaller: true,
      assertion: {
        kind: 'proposal',
        verdict: null,
        sourceKind: 'rule',
        tier: 'key',
        confidence: DERIVED_CALL_CONFIDENCE,
        rationale: trustRationale(['no-engine']),
      },
    });
    expect(m.relation()).toMatchObject({
      status: 'proposed',
      tier: 'key',
      confidence: DERIVED_CALL_CONFIDENCE,
      attrs: { calledElement: 'Process_Rechnung', match: 'derived-caller' },
    });
    expect(derivedProposals).toEqual([
      { relationId: m.relation()?.id, assertionId: m.ruleStance()?.id },
    ]);
    // A second plan over the written state has nothing to do.
    const again = await m.run(facts, derivedTrust(facts));
    expect(again.plan.steps).toEqual([]);
    expect(again.derivedProposals).toEqual([]);
  });

  it('replaces the rule decision when the caller turns derived, and accepts again when it turns modelled', async () => {
    const facts = await landscape(true);
    const m = memory();
    await m.run(facts, trustOfModels(facts));
    expect(m.relation()).toMatchObject({ status: 'accepted', tier: 'rule' });
    const accepted = m.relation();

    // The dry run lists the call as proposed instead, with its acceptance until now.
    const impact = relationImpact(m.input(facts, derivedTrust(facts)), m.findings());
    expect(impact.callsProposed).toEqual({
      count: 1,
      items: [{ ...CALL, wasAccepted: true }],
      wasAccepted: 1,
      byReason: [{ reason: 'no-engine', count: 1 }],
    });
    expect(impact.proposalsAdded.count).toBe(0);
    expect(impact.acceptedCalls.count).toBe(0);

    const demoted = await m.run(facts, derivedTrust(facts));
    expect(demoted.derivedProposals).toHaveLength(1);
    expect(m.relation()).toMatchObject({ status: 'proposed', tier: 'key' });
    expect(m.relation()?.version).toBeGreaterThan(accepted?.version ?? 0);

    // Modelled again (a re-import): the proposal turns back into the rule's acceptance.
    const back = relationImpact(m.input(facts, trustOfModels(facts)), m.findings());
    expect(back.acceptedCalls).toEqual({ count: 1, items: [CALL] });
    expect(back.callsProposed.count).toBe(0);
    await m.run(facts, trustOfModels(facts));
    expect(m.relation()).toMatchObject({ status: 'accepted', tier: 'rule' });
    expect(m.ruleStance()).toMatchObject({ kind: 'decision', verdict: 'accept', rationale: null });
  });

  it('lists a new derived call as proposed, not as an added proposal', async () => {
    const facts = await landscape(true);
    const m = memory();
    const impact = relationImpact(m.input(facts, derivedTrust(facts)), []);
    expect(impact.callsProposed).toEqual({
      count: 1,
      items: [{ ...CALL, wasAccepted: false }],
      wasAccepted: 0,
      byReason: [{ reason: 'no-engine', count: 1 }],
    });
    expect(impact.proposalsAdded.items).not.toContainEqual(CALL);
  });

  it('keeps a human acceptance, the rule proposing behind it', async () => {
    const facts = await landscape(true);
    const m = memory();
    await m.run(facts, trustOfModels(facts));
    m.decide(facts, 'accept');
    await m.run(facts, derivedTrust(facts));
    expect(m.relation()?.status).toBe('accepted');
    expect(m.ruleStance()).toMatchObject({
      kind: 'proposal',
      tier: 'key',
      confidence: DERIVED_CALL_CONFIDENCE,
    });
  });

  it('keeps a human rejection with the same fingerprints, and a hold', async () => {
    for (const verdict of ['reject', 'hold'] as const) {
      const facts = await landscape(true);
      const m = memory();
      await m.run(facts, derivedTrust(facts));
      m.decide(facts, verdict);
      const { plan } = await m.run(facts, derivedTrust(facts));
      expect(m.relation()?.status).toBe(verdict === 'reject' ? 'rejected' : 'held');
      // The rule's proposal stands as it was: nothing to assert.
      expect(plan.steps.filter((s) => s.kind === 'derive' && s.assertion)).toEqual([]);
    }
  });

  it('drops the marker with the rule’s proposal when the rules no longer derive the call', async () => {
    const facts = await landscape(true);
    const m = memory();
    await m.run(facts, derivedTrust(facts));
    m.propose(facts);
    // The caller names another process now: the rule withdraws, the agent's proposal stays.
    const moved = await landscape(true, 'Process_Gibts_Nicht');
    const { plan } = await m.run(moved, derivedTrust(moved));
    expect(plan.steps.find((s) => s.kind === 'withdraw')).toMatchObject({ attrs: {} });
    expect(m.ruleStance()).toMatchObject({ kind: 'withdrawal' });
    expect(m.relation()).toMatchObject({ status: 'proposed', attrs: {} });
    expect(m.relation()?.attrs).not.toHaveProperty('match');
    expect(m.relation()?.attrs).not.toHaveProperty('calledElement');
    // Nothing left to do on the next run.
    expect((await m.run(moved, derivedTrust(moved))).plan.steps).toEqual([]);
  });

  it('drops the marker when the callee is deleted', async () => {
    const facts = await landscape(true);
    const m = memory();
    await m.run(facts, derivedTrust(facts));
    m.propose(facts);
    const callerOnly = { models: facts.models.filter((x) => x.modelKey === AUFTRAG_KEY) };
    await m.run(callerOnly, derivedTrust(callerOnly));
    expect(m.ruleStance()).toMatchObject({ kind: 'withdrawal' });
    expect(m.relation()?.status).toBe('proposed');
    expect(m.relation()?.attrs).not.toHaveProperty('match');
  });

  it('totals the calls only proposed past the cap, each under its caller’s first reason', async () => {
    /** A caller without the camunda namespace whose `n` call activities name the invoice process. */
    const caller = (process: string, n: number) =>
      `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://example.org/bpmn" id="Defs_${process}">
  <bpmn:process id="${process}" isExecutable="false">
${Array.from({ length: n }, (_, i) => `    <bpmn:callActivity id="Call_${String(i)}" calledElement="Process_Rechnung" />`).join('\n')}
  </bpmn:process>
</bpmn:definitions>`;
    const facts = await extracted([
      { key: 'a/viele', xml: caller('Process_Viele', MAX_IMPACT_ITEMS + 1) },
      { key: 'b/token', xml: caller('Process_Token', 2) },
      { key: RECHNUNG_KEY, xml: rechnung() },
    ]);
    const m = memory();
    // Accepted while modelled, then both callers turn derived.
    await m.run(facts, trustOfModels(facts));
    const derived = trustOfModels(facts, {
      'a/viele': { trust: { class: 'derived', reasons: ['no-engine', 'agent-upload'] } },
      'b/token': { trust: { class: 'derived', reasons: ['agent-upload'] } },
    });
    const { callsProposed } = relationImpact(m.input(facts, derived), m.findings());
    expect(callsProposed.count).toBe(MAX_IMPACT_ITEMS + 3);
    expect(callsProposed.items).toHaveLength(MAX_IMPACT_ITEMS);
    expect(callsProposed.wasAccepted).toBe(MAX_IMPACT_ITEMS + 3);
    expect(callsProposed.byReason).toEqual([
      { reason: 'no-engine', count: MAX_IMPACT_ITEMS + 1 },
      { reason: 'agent-upload', count: 2 },
    ]);
  });

  it('plans a modelled landscape exactly as before the trust rule', async () => {
    const facts = await landscape(false);
    const m = memory();
    const legacy = new Map([...trustOfModels(facts)].map(([k, t]) => [k, { ...t, trust: null }]));
    const modelled = planRecompute(m.input(facts, trustOfModels(facts)));
    // The planned histories (M6 S2c-3) carry provisional assertion ids of their own.
    const { histories: _legacyHistories, ...legacyPlan } = planRecompute(m.input(facts, legacy));
    const { histories: _histories, ...modelledPlan } = modelled;
    expect(legacyPlan).toEqual(modelledPlan);
    expect(modelled.derivedCalls.size).toBe(0);
    const step = modelled.steps.find((s) => s.kind === 'derive' && s.target.fromRef === CALL.from);
    expect(step).toMatchObject({
      derivedCaller: false,
      assertion: {
        kind: 'decision',
        verdict: 'accept',
        tier: 'rule',
        confidence: 1,
        rationale: null,
      },
    });
  });
});

describe('the dry run’s acceptances by an owner’s rule for derived calls (M6 S2c-3)', () => {
  const RULE_ID = 'aar_01J9Z3N4X5Q6R7S8T9V0W1X2Y1' as AutoAcceptRuleId;
  const NAME = 'Aufrufe: Export ohne Engine';
  const rule = (extra: Partial<AutoAcceptRuleRev> = {}): AutoAcceptRuleRev => ({
    ruleId: RULE_ID,
    revision: 1,
    kind: 'relation',
    name: NAME,
    enabled: true,
    tier: 'key',
    minConfidence: DERIVED_CALL_CONFIDENCE,
    relationType: 'call',
    agentPrincipalId: null,
    llmModel: null,
    includeAdHoc: false,
    proposedBy: 'rule',
    derivedKind: 'export',
    converter: null,
    authorId: HUMAN,
    authorClientId: 'analyzr-web',
    authorIsOwner: true,
    order: 1,
    ...extra,
  });
  const exported = (facts: ProjectFacts, extra: Partial<ModelTrust> = {}) =>
    trustOfModels(facts, { [AUFTRAG_KEY]: { trust: NO_ENGINE, derivedKind: 'export', ...extra } });
  const none = new Map<string, number>();

  it('names the calls the rule would accept, by rule; nothing without the owner’s rules', async () => {
    const facts = await landscape(true);
    const m = memory();
    const impact = relationImpact(m.input(facts, exported(facts)), [], {
      rules: [rule()],
      liveNoLinks: none,
    });
    expect(impact.callsProposed.count).toBe(1);
    expect(impact.autoAcceptedCalls).toEqual({
      count: 1,
      items: [{ ...CALL, ruleId: RULE_ID, ruleName: NAME }],
      ofProposed: 1,
      byRule: [{ ruleId: RULE_ID, ruleName: NAME, count: 1 }],
    });
    // Not an owner's dry run: absent.
    expect(relationImpact(m.input(facts, exported(facts)), []).autoAcceptedCalls).toBeUndefined();
    // An owner without such rules: none.
    expect(
      relationImpact(m.input(facts, exported(facts)), [], { rules: [], liveNoLinks: none })
        .autoAcceptedCalls,
    ).toEqual({ count: 0, items: [], ofProposed: 0, byRule: [] });
  });

  it('accepts nothing from another source, an agent upload, a conflicted target or with a no-link', async () => {
    const facts = await landscape(true);
    const m = memory();
    const cases: [ReadonlyMap<string, ModelTrust>, ReadonlyMap<string, number>][] = [
      [exported(facts, { derivedKind: 'converted', converter: 'normalize-bpmn@0.1.0' }), none],
      [
        exported(facts, { trust: { class: 'derived', reasons: ['no-engine', 'agent-upload'] } }),
        none,
      ],
      [exported(facts, { conflictedCalls: new Set(['Call_Rechnung']) }), none],
      [exported(facts), new Map([[CALL_KEY, 1]])],
      [trustOfModels(facts), none],
    ];
    for (const [trust, liveNoLinks] of cases) {
      expect(
        relationImpact(m.input(facts, trust), [], { rules: [rule()], liveNoLinks })
          .autoAcceptedCalls?.count,
      ).toBe(0);
    }
  });

  it('counts a proposal the rule tier asserts again apart from callsProposed (ofProposed)', async () => {
    const facts = await landscape(true);
    const m = memory();
    // First uploaded with an agent token: proposed, never accepted by a rule.
    await m.run(
      facts,
      exported(facts, { trust: { class: 'derived', reasons: ['no-engine', 'agent-upload'] } }),
    );
    expect(m.relation()).toMatchObject({ status: 'proposed', tier: 'key' });
    // A human uploads it again: the reasons change, so the proposal is asserted again.
    const impact = relationImpact(m.input(facts, exported(facts)), m.findings(), {
      rules: [rule()],
      liveNoLinks: none,
    });
    expect(impact.callsProposed.count).toBe(0);
    expect(impact.autoAcceptedCalls).toMatchObject({ count: 1, ofProposed: 0 });
  });

  it('is not retroactive: a proposal written before is not recorded again', async () => {
    const facts = await landscape(true);
    const m = memory();
    await m.run(facts, exported(facts));
    expect(m.relation()).toMatchObject({ status: 'proposed', tier: 'key' });
    expect(
      relationImpact(m.input(facts, exported(facts)), m.findings(), {
        rules: [rule()],
        liveNoLinks: none,
      }).autoAcceptedCalls?.count,
    ).toBe(0);
  });
});

/**
 * The trust rule (M6 S2c, owner decisions 24.2, 25.2 and 28), the pure
 * parts: the class of an uploaded revision, a model's trust from its head,
 * the rule tier's output under the trust rule over the real `runRules`, the
 * German rationale and the `trust-kept` warning.
 */
import { extractFacts } from '@analyzr/bpmn-facts';
import {
  DERIVED_CALL_CONFIDENCE,
  TRUST_REASON_LABELS,
  TrustReason,
  type AmendmentPlanEntry,
  type DerivedRelation,
  type Engine,
  type ProjectFacts,
  type RevisionSource,
} from '@analyzr/contracts';
import { runRules } from '@analyzr/relations';
import { describe, expect, it } from 'vitest';

import type { HeadTrustRow } from '../../src/domain/ports.ts';
import {
  applyTrust,
  modelTrust,
  trustKeptWarning,
  trustOf,
  trustRationale,
  trustSummary,
  type RuleRelation,
} from '../../src/domain/trust.ts';
import {
  AUFTRAG_KEY,
  RECHNUNG_KEY,
  VERSAND_KEY,
  auftrag,
  rechnung,
  versand,
} from '../support/amend-fixtures.ts';
import { MODELLED, NO_ENGINE, modelTrustOf, trustOfModels } from '../support/trust.ts';

async function projectFacts(files: readonly { key: string; xml: string }[]): Promise<ProjectFacts> {
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

/** The process `Process_Versand_Alt`, which `auftrag`'s second call names. */
const VERSAND_ALT_KEY = 'versand/alt';
const versandAlt = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" targetNamespace="http://example.org/bpmn" id="Defs_Alt">
  <bpmn:process id="Process_Versand_Alt" name="Alter Versand" isExecutable="true">
    <bpmn:startEvent id="Start_Alt" name="Versand beauftragt" />
  </bpmn:process>
</bpmn:definitions>
`;

/** Two unique calls (`Call_Rechnung`, `Call_Versand`) from `auftrag`. */
const twoCalls = () =>
  projectFacts([
    { key: AUFTRAG_KEY, xml: auftrag({ callRechnung: 'Process_Rechnung', engineless: true }) },
    { key: RECHNUNG_KEY, xml: rechnung() },
    { key: VERSAND_ALT_KEY, xml: versandAlt },
  ]);

/** A relation of `applyTrust` as `runRules` gives one: without the server's fields. */
const plain = (r: RuleRelation): DerivedRelation => ({
  type: r.type,
  from: r.from,
  to: r.to,
  status: r.status,
  tier: r.tier,
  confidence: r.confidence,
  attrs: r.attrs,
});

const RECHNUNG_CALL = `${AUFTRAG_KEY}#Call_Rechnung`;
const VERSAND_CALL = `${AUFTRAG_KEY}#Call_Versand`;

describe('the trust class of an uploaded revision', () => {
  const engines: (Engine | null)[] = ['c7', 'c8', null];
  const uploaders: ('human' | 'agent' | undefined)[] = ['human', 'agent', undefined];
  const kinds = [undefined, 'export', 'converted', 'reconstructed', 'as-told'] as const;

  it('is modelled only for Camunda 7 or 8, a human upload and no derivation or export', () => {
    for (const engine of engines) {
      for (const uploader of uploaders) {
        for (const kind of kinds) {
          const source: RevisionSource = {
            kind: 'import',
            ...(uploader === undefined ? {} : { uploader }),
            ...(kind === undefined ? {} : { derived: { kind } }),
          };
          const expected: TrustReason[] = [
            ...(engine === null ? (['no-engine'] as const) : []),
            ...(uploader === 'human' ? [] : (['agent-upload'] as const)),
            ...(kind === undefined || kind === 'export' ? [] : [kind]),
          ];
          expect(trustOf(engine, source), JSON.stringify({ engine, uploader, kind })).toEqual({
            class: expected.length === 0 ? 'modelled' : 'derived',
            reasons: expected,
          });
        }
      }
    }
  });

  it('lists the reasons in a fixed order', () => {
    expect(trustOf(null, { uploader: 'agent', derived: { kind: 'as-told' } }).reasons).toEqual([
      'no-engine',
      'agent-upload',
      'as-told',
    ]);
    expect(TrustReason.options).toEqual([
      'no-engine',
      'agent-upload',
      'converted',
      'reconstructed',
      'as-told',
    ]);
  });
});

describe('a model’s trust', () => {
  const row = (over: Partial<HeadTrustRow>): HeadTrustRow => ({
    key: AUFTRAG_KEY,
    head: { kind: 'import', uploader: 'human', trust: MODELLED },
    upstream: null,
    engine: 'c7',
    uploaderPrincipalKind: 'user',
    ...over,
  });
  const plan = (entries: Partial<AmendmentPlanEntry>[]): AmendmentPlanEntry[] =>
    entries.map((e, i) => ({
      id: `mam_${String(i).padStart(26, '0')}`,
      elementId: 'Call_Rechnung',
      op: 'call-target',
      outcome: 'applied',
      ...e,
    }));

  it('reads an amended head’s upstream; the amended head’s own uploader never counts', () => {
    const t = modelTrust(
      row({
        head: {
          kind: 'amendment',
          uploader: 'human',
          upstream: { revisionId: `rev_${'0'.repeat(26)}`, rev: 1, contentHash: 'a'.repeat(64) },
          amendments: plan([{}]),
        },
        upstream: {
          kind: 'import',
          uploader: 'agent',
          derived: { kind: 'converted', converter: 'normalize-bpmn@0.1.0' },
          trust: { class: 'derived', reasons: ['no-engine', 'agent-upload', 'converted'] },
        },
        engine: null,
      }),
    );
    expect(t.trust).toEqual({
      class: 'derived',
      reasons: ['no-engine', 'agent-upload', 'converted'],
    });
    expect(t.uploader).toBe('agent');
    expect(t.derivedKind).toBe('converted');
    expect(t.converter).toBe('normalize-bpmn@0.1.0');
    expect([...t.modelledCalls]).toEqual(['Call_Rechnung']);
  });

  it('is null for a revision stored before S2c, with the legacy signals', () => {
    const t = modelTrust(
      row({ head: { kind: 'upload' }, engine: null, uploaderPrincipalKind: 'service' }),
    );
    expect(t.trust).toBeNull();
    expect(t.engine).toBeNull();
    // Stored before S2a: the principal's kind decides.
    expect(t.uploader).toBe('agent');
    expect(modelTrust(row({ head: { kind: 'upload' } })).uploader).toBe('human');
  });

  it('counts applied and in-source call targets as modelled, conflicts apart', () => {
    const t = modelTrust(
      row({
        head: {
          kind: 'import',
          uploader: 'human',
          trust: NO_ENGINE,
          amendments: plan([
            { elementId: 'Call_A', outcome: 'applied' },
            { elementId: 'Call_B', outcome: 'in-source' },
            { elementId: 'Call_C', outcome: 'conflict', reason: 'element-missing' },
            { elementId: 'Event_D', op: 'event-name', outcome: 'applied' },
          ]),
        },
      }),
    );
    expect([...t.modelledCalls]).toEqual(['Call_A', 'Call_B']);
    expect([...t.conflictedCalls]).toEqual(['Call_C']);
  });

  it('summarizes the class for the model view, null before S2c', () => {
    expect(
      trustSummary(
        {
          kind: 'import',
          derived: { kind: 'export' },
          trust: NO_ENGINE,
        },
        null,
      ),
    ).toEqual({ class: 'derived', reasons: ['no-engine'], derivedKind: 'export', converter: null });
    expect(trustSummary({ kind: 'upload' }, null)).toBeNull();
  });
});

describe('the rule tier under the trust rule', () => {
  it('proposes a derived caller’s unique call: tier key, 0.9, the marker and the rationale', async () => {
    const facts = await twoCalls();
    const rules = runRules(facts);
    const out = applyTrust(rules, trustOfModels(facts, { [AUFTRAG_KEY]: { trust: NO_ENGINE } }));
    const call = out.relations.find((r) => r.from === RECHNUNG_CALL);
    const before = rules.relations.find((r) => r.from === RECHNUNG_CALL);
    expect(before).toMatchObject({ status: 'accepted', tier: 'rule', confidence: 1 });
    expect(call).toEqual({
      type: 'call',
      from: RECHNUNG_CALL,
      to: `${RECHNUNG_KEY}#Process_Rechnung`,
      status: 'proposed',
      tier: 'key',
      confidence: DERIVED_CALL_CONFIDENCE,
      attrs: { ...before?.attrs, calledElement: 'Process_Rechnung', match: 'derived-caller' },
      rationale: trustRationale(['no-engine']),
      derivedCaller: true,
    });
  });

  it('leaves the output of a modelled or a legacy caller as runRules gives it', async () => {
    const facts = await twoCalls();
    const rules = runRules(facts);
    for (const trust of [MODELLED, null]) {
      const out = applyTrust(rules, trustOfModels(facts, { [AUFTRAG_KEY]: { trust } }));
      expect(out.findings).toEqual(rules.findings);
      expect(out.relations.map(plain)).toEqual(rules.relations);
      expect(out.relations.every((r) => r.rationale === null && !r.derivedCaller)).toBe(true);
    }
  });

  it('keeps a call whose target was set in analyzr accepted, the model’s other calls proposed', async () => {
    const facts = await twoCalls();
    const out = applyTrust(
      runRules(facts),
      trustOfModels(facts, {
        [AUFTRAG_KEY]: { trust: NO_ENGINE, modelledCalls: new Set(['Call_Rechnung']) },
      }),
    );
    expect(out.relations.find((r) => r.from === RECHNUNG_CALL)).toMatchObject({
      status: 'accepted',
      tier: 'rule',
      derivedCaller: false,
    });
    expect(out.relations.find((r) => r.from === VERSAND_CALL)).toMatchObject({
      status: 'proposed',
      tier: 'key',
      derivedCaller: true,
    });
  });

  it('changes no other branch and no finding', async () => {
    // An unresolved call (with a file-stem proposal), a message pair and their findings.
    const facts = await projectFacts([
      { key: AUFTRAG_KEY, xml: auftrag({ engineless: true }) },
      { key: RECHNUNG_KEY, xml: rechnung() },
      { key: VERSAND_KEY, xml: versand() },
    ]);
    const rules = runRules(facts);
    expect(rules.relations.some((r) => r.status === 'accepted')).toBe(false);
    const out = applyTrust(
      rules,
      trustOfModels(facts, {
        [AUFTRAG_KEY]: { trust: NO_ENGINE },
        [RECHNUNG_KEY]: { trust: NO_ENGINE },
        [VERSAND_KEY]: { trust: NO_ENGINE },
      }),
    );
    expect(out.findings).toEqual(rules.findings);
    expect(out.relations.map(plain)).toEqual(rules.relations);
  });

  it('passes the other branches of a derived caller through: ambiguous, by name, dynamic, recursive', async () => {
    const definitions = (id: string, body: string) =>
      `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://example.org/bpmn" id="Defs_${id}">
${body}
</bpmn:definitions>`;
    const callee = (id: string, process: string, name: string) =>
      definitions(
        id,
        `  <bpmn:process id="${process}" name="${name}" isExecutable="false">
    <bpmn:startEvent id="Start_${id}" name="Los" />
  </bpmn:process>`,
      );
    // An engine-less caller: a process id two models define, a process only by its name, an
    // expression and itself.
    const caller = definitions(
      'Caller',
      `  <bpmn:process id="Process_Caller" name="Aufrufer" isExecutable="false">
    <bpmn:startEvent id="Start_Caller" name="Los" />
    <bpmn:callActivity id="Call_Dup" calledElement="Process_Dup" />
    <bpmn:callActivity id="Call_Name" calledElement="Mahnwesen" />
    <bpmn:callActivity id="Call_Dyn" calledElement="\${prozessId}" />
    <bpmn:callActivity id="Call_Self" calledElement="Process_Caller" />
  </bpmn:process>`,
    );
    const facts = await projectFacts([
      { key: 'branch/caller', xml: caller },
      { key: 'branch/dup-a', xml: callee('DupA', 'Process_Dup', 'Doppelt A') },
      { key: 'branch/dup-b', xml: callee('DupB', 'Process_Dup', 'Doppelt B') },
      { key: 'branch/mahnung-alt', xml: callee('Mahn', 'Process_Mahnung', 'Mahnwesen') },
    ]);
    const rules = runRules(facts);
    // Every branch occurs; none of them accepts.
    expect(rules.relations.map((r) => [r.from, r.attrs['match']]).sort()).toEqual([
      ['branch/caller#Call_Dup', 'duplicate-process-id'],
      ['branch/caller#Call_Dup', 'duplicate-process-id'],
      ['branch/caller#Call_Name', 'process-name'],
    ]);
    expect(rules.findings.map((f) => f.kind).sort()).toEqual(
      expect.arrayContaining(['duplicate-process-id', 'dynamic-call', 'unresolved-call']),
    );
    const derived = {
      class: 'derived' as const,
      reasons: ['no-engine', 'agent-upload'] as TrustReason[],
    };
    const out = applyTrust(
      rules,
      new Map(facts.models.map((m) => [m.modelKey, modelTrustOf({ trust: derived })])),
    );
    expect(out.findings).toEqual(rules.findings);
    expect(out.relations.map(plain)).toEqual(rules.relations);
    expect(out.relations.every((r) => r.rationale === null && !r.derivedCaller)).toBe(true);
  });

  it('throws for a caller model without trust (a bug)', async () => {
    const facts = await twoCalls();
    const trust = trustOfModels(facts);
    trust.delete(AUFTRAG_KEY);
    expect(() => applyTrust(runRules(facts), trust)).toThrow(/no trust for the caller model/);
  });
});

describe('the German texts', () => {
  it('pins the rationale and the reason labels', () => {
    expect(trustRationale(['no-engine', 'agent-upload'])).toBe(
      'Vertrauensregel: Der Aufruf nennt genau einen Prozess, aber das aufrufende Modell gilt als ' +
        'abgeleitet (ohne Camunda-Engine; über ein Agenten-Token hochgeladen). Darum nur vorgeschlagen.',
    );
    expect(TRUST_REASON_LABELS).toEqual({
      'no-engine': 'ohne Camunda-Engine',
      'agent-upload': 'über ein Agenten-Token hochgeladen',
      converted: 'als konvertiert angegeben',
      reconstructed: 'als KI-rekonstruiert angegeben',
      'as-told': 'als aus einem Interview angegeben',
    });
  });
});

describe('trust-kept', () => {
  it('warns when unchanged bytes keep another class than the request would give', () => {
    expect(trustKeptWarning(MODELLED, MODELLED)).toBeNull();
    // Only the class counts; other reasons of the same class change nothing.
    expect(
      trustKeptWarning(NO_ENGINE, { class: 'derived', reasons: ['no-engine', 'agent-upload'] }),
    ).toBeNull();
    expect(trustKeptWarning(null, MODELLED)).toBeNull();
    expect(trustKeptWarning(MODELLED, { class: 'derived', reasons: ['agent-upload'] })).toEqual({
      code: 'trust-kept',
      message:
        "unchanged, so analyzr keeps the model's trust class modelled; this request would make it " +
        'derived (agent-upload); a reclassification needs changed bytes',
    });
    expect(trustKeptWarning(null, NO_ENGINE)?.message).toContain(
      'modelled (stored before the trust rule)',
    );
    expect(trustKeptWarning(NO_ENGINE, MODELLED)?.message).toContain(
      'trust class derived (no-engine); this request would make it modelled',
    );
  });
});

/**
 * The trust rule (M6 S2c, owner decisions 24.2, 25.2 and 28), the pure
 * parts: the class of an uploaded revision, a model's trust from its head,
 * the rule tier's output under the trust rule over the real `runRules`, the
 * German rationale, the `trust-kept` warning and the system rule's count of
 * open derived calls; for revisions stored before S2c (M6 S2c-4) the class
 * an owner's review gives and the list „Vor der Vertrauensregel
 * angenommen“.
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
import type { StanceView } from '../../src/domain/status.ts';
import {
  applyTrust,
  isOpenDerivedCall,
  legacyTrust,
  modelTrust,
  preTrustAcceptances,
  storedTrust,
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

/** A live model's trust row: a human's Camunda 7 import classified modelled, unless overridden. */
function trustRow(over: Partial<HeadTrustRow> = {}): HeadTrustRow {
  return {
    key: AUFTRAG_KEY,
    modelId: 'mdl_01J9Z3N4X5Q6R7S8T9V0W1X2A1',
    name: 'Auftragsabwicklung',
    head: { kind: 'import', uploader: 'human', trust: MODELLED },
    upstream: null,
    revisionId: 'rev_01J9Z3N4X5Q6R7S8T9V0W1X2A1',
    rev: 1,
    engine: 'c7',
    uploaderPrincipalKind: 'user',
    review: null,
    ...over,
  };
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
  const row = (over: Partial<HeadTrustRow>): HeadTrustRow => trustRow(over);
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
        row({ head: { kind: 'import', derived: { kind: 'export' }, trust: NO_ENGINE } }),
      ),
    ).toEqual({ class: 'derived', reasons: ['no-engine'], derivedKind: 'export', converter: null });
    expect(trustSummary(row({ head: { kind: 'upload' } }))).toBeNull();
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

describe('isOpenDerivedCall (the rows behind the system rule card’s count, M6 S2c-2)', () => {
  const open = {
    type: 'call',
    status: 'proposed',
    tier: 'key',
    attrs: { calledElement: 'Process_Rechnung', match: 'derived-caller' },
  } as const;

  it('counts an open rule proposal of a unique call from a derived model, as the web does', () => {
    expect(isOpenDerivedCall(open)).toBe(true);
  });

  it('counts nothing the bulk dialog’s group would not hold', () => {
    expect(isOpenDerivedCall({ ...open, status: 'accepted' })).toBe(false);
    expect(isOpenDerivedCall({ ...open, status: 'held' })).toBe(false);
    // the bulk dialog lists the key tier only
    expect(isOpenDerivedCall({ ...open, tier: 'manual' })).toBe(false);
    expect(isOpenDerivedCall({ ...open, attrs: { match: 'duplicate-process-id' } })).toBe(false);
    expect(isOpenDerivedCall({ ...open, type: 'message' })).toBe(false);
  });
});

describe('a revision stored before S2c, reviewed by the owner (M6 S2c-4)', () => {
  const legacy = (over: Partial<HeadTrustRow> = {}): HeadTrustRow =>
    trustRow({ head: { kind: 'upload', uploader: 'human' }, engine: null, ...over });

  it('computes the class it would get today from what it carries (decision 28 (3))', () => {
    expect(legacyTrust({ engine: null, uploader: 'human', derivedKind: null })).toEqual(NO_ENGINE);
    expect(legacyTrust({ engine: 'c7', uploader: 'human', derivedKind: 'export' })).toEqual(
      MODELLED,
    );
    expect(legacyTrust({ engine: 'c8', uploader: 'agent', derivedKind: 'converted' })).toEqual({
      class: 'derived',
      reasons: ['agent-upload', 'converted'],
    });
  });

  it('reads a review where the revision carries no class: derived with its reasons, or modelled', () => {
    expect(modelTrust(legacy()).trust).toBeNull();
    expect(modelTrust(legacy({ review: 'derived' })).trust).toEqual(NO_ENGINE);
    expect(modelTrust(legacy({ review: 'modelled' })).trust).toEqual(MODELLED);
    // Stored before S2a: a service principal counts as an agent's upload.
    expect(
      modelTrust(
        legacy({
          head: { kind: 'upload', derived: { kind: 'converted', converter: 'x@1' } },
          engine: 'c7',
          uploaderPrincipalKind: 'service',
          review: 'derived',
        }),
      ).trust,
    ).toEqual({ class: 'derived', reasons: ['agent-upload', 'converted'] });
    expect(trustSummary(legacy({ review: 'derived' }))).toEqual({
      class: 'derived',
      reasons: ['no-engine'],
      derivedKind: null,
      converter: null,
    });
  });

  it('never lets a review overrule the class the server stored', () => {
    const classified = { kind: 'import', uploader: 'human', trust: NO_ENGINE } as const;
    expect(
      storedTrust({
        source: classified,
        engine: null,
        uploaderPrincipalKind: 'user',
        review: 'modelled',
      }),
    ).toEqual(NO_ENGINE);
    expect(modelTrust(legacy({ head: classified, review: 'modelled' })).trust).toEqual(NO_ENGINE);
  });

  it('reads the review of an amended head’s uploaded revision', () => {
    const t = modelTrust(
      legacy({
        head: {
          kind: 'amendment',
          uploader: 'human',
          upstream: { revisionId: `rev_${'1'.repeat(26)}`, rev: 1, contentHash: 'a'.repeat(64) },
        },
        upstream: { kind: 'upload' },
        review: 'derived',
      }),
    );
    expect(t.trust).toEqual(NO_ENGINE);
  });
});

describe('„Vor der Vertrauensregel angenommen“ (preTrustAcceptances, M6 S2c-4)', () => {
  const RULES = 'prn_01J9Z3N4X5Q6R7S8T9V0W1RULE' as StanceView['principalId'];
  const OWNER = 'prn_01J9Z3N4X5Q6R7S8T9V0W1OWNR' as StanceView['principalId'];
  const ruleDecision: StanceView = {
    seq: 1,
    kind: 'decision',
    verdict: 'accept',
    sourceKind: 'rule',
    principalId: RULES,
    tier: 'rule',
    confidence: 1,
  };
  const humanDecision: StanceView = {
    seq: 2,
    kind: 'decision',
    verdict: 'accept',
    sourceKind: 'human',
    principalId: OWNER,
    tier: null,
    confidence: null,
  };
  const CALL = `${AUFTRAG_KEY}#Call_Rechnung`;
  const CALL_VERSAND = `${AUFTRAG_KEY}#Call_Versand`;
  type Row = Parameters<typeof preTrustAcceptances>[1][number];
  const call = (id: string, from: string, over: Partial<Row> = {}): Row => ({
    id: id as Row['id'],
    type: 'call',
    fromRef: from as Row['fromRef'],
    toRef: `${RECHNUNG_KEY}#Process_Rechnung`,
    status: 'accepted',
    endpointState: 'ok',
    ...over,
  });
  /** Legacy, engine-less, a human's upload: would be derived (no-engine). */
  const legacy = (over: Partial<HeadTrustRow> = {}): HeadTrustRow =>
    trustRow({ head: { kind: 'upload', uploader: 'human' }, engine: null, ...over });
  const list = (
    rows: HeadTrustRow[],
    relations: Row[] = [call('rel_1', CALL)],
    histories: Record<string, StanceView[]> = { rel_1: [ruleDecision] },
  ) => preTrustAcceptances(rows, relations, new Map(Object.entries(histories)));

  it('lists a rule acceptance whose legacy caller would be derived, grouped by model', () => {
    const rows = [legacy(), trustRow({ key: RECHNUNG_KEY })];
    expect(list(rows)).toEqual([
      {
        modelId: 'mdl_01J9Z3N4X5Q6R7S8T9V0W1X2A1',
        modelKey: AUFTRAG_KEY,
        modelName: 'Auftragsabwicklung',
        revisionId: 'rev_01J9Z3N4X5Q6R7S8T9V0W1X2A1',
        rev: 1,
        reasons: ['no-engine'],
        derivedKind: null,
        converter: null,
        calls: [{ id: 'rel_1', fromRef: CALL, toRef: `${RECHNUNG_KEY}#Process_Rechnung` }],
      },
    ]);
  });

  it('lists nothing for a Camunda model a human uploaded (modelled by engine)', () => {
    expect(list([legacy({ engine: 'c7' })])).toEqual([]);
    expect(
      list([legacy({ engine: 'c8', head: { kind: 'import', derived: { kind: 'export' } } })]),
    ).toEqual([]);
  });

  it('tells a human’s upload from an agent’s; before S2a by the principal’s kind', () => {
    expect(
      list([legacy({ engine: 'c7', head: { kind: 'upload', uploader: 'agent' } })])[0]?.reasons,
    ).toEqual(['agent-upload']);
    // No `uploader` (stored before S2a): a service principal is an agent, a user a human.
    const preS2a = { kind: 'upload' } as const;
    expect(
      list([legacy({ engine: 'c7', head: preS2a, uploaderPrincipalKind: 'service' })])[0]?.reasons,
    ).toEqual(['agent-upload']);
    expect(list([legacy({ engine: 'c7', head: preS2a, uploaderPrincipalKind: 'user' })])).toEqual(
      [],
    );
    expect(list([legacy({ engine: 'c7', head: preS2a, uploaderPrincipalKind: 'system' })])).toEqual(
      [],
    );
  });

  it('follows the declared kind: export is no reason, every other kind is', () => {
    const declared = (kind: 'export' | 'converted' | 'reconstructed' | 'as-told') =>
      list([
        legacy({
          engine: 'c7',
          head: {
            kind: 'import',
            uploader: 'human',
            derived:
              kind === 'converted'
                ? { kind, converter: 'normalize-bpmn@0.1.0' }
                : kind === 'reconstructed'
                  ? { kind, llmModel: 'm' }
                  : { kind },
          },
        }),
      ])[0];
    expect(declared('export')).toBeUndefined();
    expect(declared('converted')).toMatchObject({
      reasons: ['converted'],
      derivedKind: 'converted',
      converter: 'normalize-bpmn@0.1.0',
    });
    expect(declared('reconstructed')?.reasons).toEqual(['reconstructed']);
    expect(declared('as-told')?.reasons).toEqual(['as-told']);
  });

  it('leaves out a call whose target was set in analyzr (25.2), the model’s other call stays', () => {
    const rows = [
      legacy({
        head: {
          kind: 'upload',
          uploader: 'human',
          amendments: [
            { id: 'mam_1', elementId: 'Call_Rechnung', op: 'call-target', outcome: 'in-source' },
          ],
        },
      }),
    ];
    const groups = list(rows, [call('rel_1', CALL), call('rel_2', CALL_VERSAND)], {
      rel_1: [ruleDecision],
      rel_2: [ruleDecision],
    });
    expect(groups.map((g) => g.calls.map((c) => c.id))).toEqual([['rel_2']]);
  });

  it('leaves out a call a human decided, or an owner’s rule accepted, and one not resting on a decision', () => {
    const marked: StanceView = { ...humanDecision, autoAcceptRuleId: 'aar_1' };
    expect(
      list([legacy()], [call('rel_1', CALL)], { rel_1: [ruleDecision, humanDecision] }),
    ).toEqual([]);
    expect(list([legacy()], [call('rel_1', CALL)], { rel_1: [ruleDecision, marked] })).toEqual([]);
    expect(list([legacy()], [call('rel_1', CALL)], { rel_1: [] })).toEqual([]);
  });

  it('leaves out what is not an accepted call with both endpoints', () => {
    const rows = [legacy()];
    for (const over of [
      { status: 'proposed' },
      { endpointState: 'missing' },
      { type: 'message' },
    ] as const) {
      expect(list(rows, [call('rel_1', CALL, over)])).toEqual([]);
    }
  });

  it('lists a revision once: reviewed either way, or classified since S2c, it is gone', () => {
    expect(list([legacy({ review: 'derived' })])).toEqual([]);
    expect(list([legacy({ review: 'modelled' })])).toEqual([]);
    expect(
      list([legacy({ head: { kind: 'upload', uploader: 'human', trust: NO_ENGINE } })]),
    ).toEqual([]);
  });

  it('names an amended head’s uploaded revision and sorts models and calls by key', () => {
    const upstreamId = 'rev_01J9Z3N4X5Q6R7S8T9V0W1X2U1';
    const rows = [
      legacy({
        key: 'z/last',
        modelId: 'mdl_01J9Z3N4X5Q6R7S8T9V0W1X2Z1',
        revisionId: 'rev_01J9Z3N4X5Q6R7S8T9V0W1X2Z1',
      }),
      legacy({
        head: {
          kind: 'amendment',
          uploader: 'human',
          upstream: { revisionId: upstreamId, rev: 1, contentHash: 'a'.repeat(64) },
        },
        upstream: { kind: 'upload', uploader: 'human' },
        revisionId: upstreamId,
      }),
    ];
    const groups = list(
      rows,
      [call('rel_3', 'z/last#Call_B'), call('rel_2', CALL_VERSAND), call('rel_1', CALL)],
      { rel_1: [ruleDecision], rel_2: [ruleDecision], rel_3: [ruleDecision] },
    );
    expect(groups.map((g) => [g.modelKey, g.revisionId, g.calls.map((c) => c.id)])).toEqual([
      [AUFTRAG_KEY, upstreamId, ['rel_1', 'rel_2']],
      ['z/last', 'rev_01J9Z3N4X5Q6R7S8T9V0W1X2Z1', ['rel_3']],
    ]);
  });
});

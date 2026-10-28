/**
 * No owner rule accepts anything on a model no person has seen in a tool
 * (owner decision 30 (2), `reconstructed-endpoint`) end to end, with the real
 * libraries and a real PostgreSQL. Models are imported as the CLI and the
 * web send them, with a manifest part that declares one model
 * `reconstructed` (or `as-told`):
 * - an agent rule leaves an agent's message proposal with either end in such
 *   a model proposed, in a relations submission and ad hoc; the ledger stays
 *   empty, "apply"'s dry run and the preview name the block; a pair between
 *   two other models is accepted in the same write;
 * - a placement rule leaves such a model's process unplaced, from the
 *   placement pipeline and ad hoc; another process is placed;
 * - an amended head follows its upstream's declaration; a re-import of the
 *   same bytes keeps it, changed bytes without the declaration lift it (the
 *   older proposals then need "apply"); an acceptance made before stays in
 *   force;
 * - a rule for derived calls accepts no call into such a callee, at ingest
 *   (the owner's dry run agrees), after a deletion makes it unique, or in
 *   "apply"; the preview's `derivedGroups` counts it blocked;
 * - an agent rule for calls never accepts an agent's proposal of such a
 *   caller's call; an agent token's upload of such a caller reports
 *   `agent-upload` first.
 */
import {
  ImportResult,
  type ApplyAutoAcceptResult,
  type AutoAcceptLedger,
  type AutoAcceptPreview,
  type AutoAcceptRuleDetail,
  type ImportImpact,
  type Model,
  type ModelPage,
  type Placement,
  type PlacementPage,
  type Relation,
  type RelationPage,
  type SaveAutoAcceptRuleResult,
  type SaveValueChainResult,
} from '@analyzr/contracts';
import { newId } from '@analyzr/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { libraryAnalysis } from '../../src/analysis.ts';
import type { Actor } from '../../src/domain/actor.ts';
import { AUFTRAG_KEY, RECHNUNG_KEY, auftrag, rechnung } from '../support/amend-fixtures.ts';
import { startTestApp, type TestApp } from '../support/app.ts';
import { createTestDatabase, type TestDatabase } from '../support/db.ts';
import {
  asAgent,
  claim,
  claimPlacement,
  item,
  placementSubmission,
  post,
  submission,
  submit,
  submitPlacement,
  type Caller,
} from '../support/pipeline.ts';
import { chain, chainPath } from '../support/value-chain.ts';

let database: TestDatabase;
let t: TestApp;

beforeAll(async () => {
  database = await createTestDatabase();
  t = startTestApp(database, { analysis: libraryAnalysis });
});

afterAll(async () => {
  await database.drop();
});

async function json<T>(res: Response, status = 200): Promise<T> {
  const text = await res.text();
  expect(res.status, text.slice(0, 800)).toBe(status);
  return JSON.parse(text) as T;
}

const send = (path: string, body: unknown, method = 'POST') =>
  t.asOwner(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

// ------------------------------------------------------------------ models

const DEFS =
  'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" targetNamespace="http://example.org/bpmn"';

const SENDER_KEY = 'einkauf/bestellung';
/** Declared `reconstructed` (or `as-told`) by the tests that say so. */
const PICTURE_KEY = 'bild/lager';
const EXPORT_KEY = 'finanzen/buchhaltung';

/** A Camunda 7 process that sends two messages: to the picture model and to the export. */
const sender = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${DEFS} id="Defs_Bestellung">
  <bpmn:process id="Process_Bestellung" name="Bestellung" isExecutable="true">
    <bpmn:startEvent id="Start_Bestellung" name="Bedarf gemeldet" />
    <bpmn:intermediateThrowEvent id="Event_Einlagern" name="Ware einlagern">
      <bpmn:messageEventDefinition id="MED_Einlagern" messageRef="Message_Einlagern" />
    </bpmn:intermediateThrowEvent>
    <bpmn:endEvent id="End_Buchen" name="Rechnung buchen">
      <bpmn:messageEventDefinition id="MED_Buchen" messageRef="Message_Buchen" />
    </bpmn:endEvent>
  </bpmn:process>
  <bpmn:message id="Message_Einlagern" name="Ware einlagern" />
  <bpmn:message id="Message_Buchen" name="Rechnung buchen" />
</bpmn:definitions>
`;

/** A Camunda 7 process started by the message `message`; `task` changes bytes elsewhere. */
function receiver(id: string, name: string, message: string, task = 'Prüfen'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${DEFS} id="Defs_${id}">
  <bpmn:process id="Process_${id}" name="${name}" isExecutable="true">
    <bpmn:startEvent id="Start_${id}" name="${message}">
      <bpmn:messageEventDefinition id="MED_${id}" messageRef="Message_${id}" />
    </bpmn:startEvent>
    <bpmn:task id="Task_${id}" name="${task}" />
  </bpmn:process>
  <bpmn:message id="Message_${id}" name="${message}" />
</bpmn:definitions>
`;
}

const files = (lagerTask?: string) => [
  { path: `${SENDER_KEY}.bpmn`, bytes: sender },
  {
    path: `${PICTURE_KEY}.bpmn`,
    bytes: receiver('Lager', 'Einlagerung', 'Ware einlagern', lagerTask),
  },
  { path: `${EXPORT_KEY}.bpmn`, bytes: receiver('Buchhaltung', 'Buchhaltung', 'Rechnung buchen') },
];

const PICTURE_PAIR: [string, string] = [
  `${SENDER_KEY}#Event_Einlagern`,
  `${PICTURE_KEY}#Start_Lager`,
];
const EXPORT_PAIR: [string, string] = [
  `${SENDER_KEY}#End_Buchen`,
  `${EXPORT_KEY}#Start_Buchhaltung`,
];
const PICTURE_PROCESS = `${PICTURE_KEY}#Process_Lager`;
const EXPORT_PROCESS = `${EXPORT_KEY}#Process_Buchhaltung`;

const RECONSTRUCTED = { kind: 'reconstructed', llmModel: 'claude-x' };
const AS_TOLD = { kind: 'as-told', from: ['src-1'] };

/** A manifest declaring `derived` per file path (the other files declare nothing). */
const manifestOf = (derived: Record<string, Record<string, unknown>>) => ({
  format: 'analyzr-import/1',
  source: { system: 'signavio' },
  files: Object.entries(derived).map(([p, d]) => ({
    path: p,
    key: p.replace(/\.bpmn$/, ''),
    derived: d,
  })),
});
const pictureDeclared = (derived: Record<string, unknown> = RECONSTRUCTED) =>
  manifestOf({ [`${PICTURE_KEY}.bpmn`]: derived });

async function importAs(
  p: string,
  fs: readonly { path: string; bytes: string }[],
  manifest?: unknown,
  opts: { dryRun?: boolean; token?: string } = {},
): Promise<ImportResult> {
  const form = new FormData();
  for (const f of fs) form.append('files', new Blob([f.bytes]), f.path);
  if (manifest !== undefined) form.append('manifest', JSON.stringify(manifest));
  const path = `/api/v1/projects/${p}/imports${opts.dryRun ? '?dryRun=true' : ''}`;
  const init = { method: 'POST', body: form };
  const res = opts.token ? await t.asToken(opts.token, path, init) : await t.asOwner(path, init);
  return ImportResult.parse(await json<unknown>(res));
}

// ------------------------------------------------------------------ reads

const relations = async (p: string): Promise<Relation[]> =>
  (await json<RelationPage>(await t.asOwner(`/api/v1/projects/${p}/relations?limit=200`))).items;
const relationOf = async (p: string, type: string, [from, to]: [string, string]) =>
  (await relations(p)).find((r) => r.type === type && r.from === from && r.to === to);
const ledger = async (p: string) =>
  (await json<AutoAcceptLedger>(await t.asOwner(`/api/v1/projects/${p}/auto-accepted`))).items;
const models = async (p: string): Promise<Model[]> =>
  (await json<ModelPage>(await t.asOwner(`/api/v1/projects/${p}/models?limit=200`))).items;
const applyDry = async (p: string, ruleId: string) =>
  json<ApplyAutoAcceptResult>(
    await send(`/api/v1/projects/${p}/auto-accept-rules/${ruleId}/apply?dryRun=true`, {}),
  );

async function rule(p: string, draft: Record<string, unknown>): Promise<AutoAcceptRuleDetail> {
  return (
    await json<SaveAutoAcceptRuleResult>(
      await send(`/api/v1/projects/${p}/auto-accept-rules`, {
        kind: 'relation',
        tier: 'key',
        minConfidence: 0.9,
        enabled: true,
        ...draft,
      }),
      201,
    )
  ).rule;
}

/** „Nachricht ab 90 %“, pipeline and ad hoc. */
const messageRule = (p: string) =>
  rule(p, { name: 'Nachricht ab 90 %', relationType: 'message', includeAdHoc: true });

async function agentOf(p: string): Promise<Caller> {
  const token = await t.createToken(p, ['analyzr:read', 'analyzr:propose']);
  return asAgent(t, token.secret);
}

const proposeAdHoc = async (
  agent: Caller,
  p: string,
  pair: [string, string],
  confidence: number,
  type = 'message',
) => {
  const res = await post(agent, `/api/v1/projects/${p}/relations`, {
    ...item(type, pair[0], pair[1], { confidence }),
  });
  expect(res.status, await res.clone().text()).toBeLessThan(300);
};

/** A member of the project with `role` on the web (R1 server mode, inserted directly). */
async function member(projectId: string, role: 'owner' | 'editor'): Promise<Actor> {
  const principalId = newId('principal');
  const handle = `user:${role}-${principalId.slice(-6).toLowerCase()}`;
  await database.db.execute(
    sql`insert into principal (id, kind, iss, subject, handle) values (${principalId}, 'user', 'urn:analyzr:test', ${principalId}, ${handle})`,
  );
  await database.db.execute(
    sql`insert into membership (project_id, principal_id, role) values (${projectId}, ${principalId}, ${role})`,
  );
  return {
    principalId,
    kind: 'user',
    handle,
    clientId: 'analyzr-web',
    interactive: true,
    scopes: ['analyzr:read', 'analyzr:propose', 'analyzr:write', 'analyzr:review'],
    binding: null,
  };
}

// ------------------------------------------------------------- relations

describe('an agent rule on a relation with an end in a reconstructed model', () => {
  it('leaves the pipeline proposal proposed and accepts the other pair in the same write', async () => {
    const P = 'rr-pipeline';
    await t.createProject(P);
    await importAs(P, files(), pictureDeclared());
    expect((await models(P)).find((m) => m.key === PICTURE_KEY)).toMatchObject({
      source: { derived: 'reconstructed' },
      trust: { class: 'derived', reasons: ['reconstructed'], derivedKind: 'reconstructed' },
    });
    const r = await messageRule(P);
    const agent = await agentOf(P);
    const [claimed] = await claim(agent, { projectId: P, modelKey: SENDER_KEY });
    if (!claimed) throw new Error('no task');
    const result = await submit(
      agent,
      claimed.taskId,
      submission(claimed, [
        item('message', ...PICTURE_PAIR, { confidence: 0.97 }),
        item('message', ...EXPORT_PAIR, { confidence: 0.96 }),
      ]),
    );
    expect(result.items.map((i) => i.result)).toEqual(['applied', 'applied']);
    expect(await relationOf(P, 'message', PICTURE_PAIR)).toMatchObject({
      status: 'proposed',
      tier: 'key',
    });
    expect(await relationOf(P, 'message', EXPORT_PAIR)).toMatchObject({ status: 'accepted' });
    expect((await ledger(P)).map((e) => e.to)).toEqual([EXPORT_PAIR[1]]);
    // "apply" and the preview name the block; the preview's open count is the dry run's.
    const dry = await applyDry(P, r.id);
    expect(dry).toMatchObject({
      count: 0,
      blocked: [{ reason: 'reconstructed-endpoint', count: 1 }],
    });
    const preview = await json<AutoAcceptPreview>(
      await send(`/api/v1/projects/${P}/auto-accept-rules/preview`, {
        kind: 'relation',
        tier: 'key',
        minConfidence: 0.9,
        relationType: 'message',
        includeAdHoc: true,
      }),
    );
    expect(preview.open).toMatchObject({
      count: dry.count,
      blocked: [{ reason: 'reconstructed-endpoint', count: 1 }],
    });
    // The real apply accepts nothing.
    expect(
      await json<ApplyAutoAcceptResult>(
        await send(`/api/v1/projects/${P}/auto-accept-rules/${r.id}/apply`, {
          revision: r.revision,
          expectedCount: 0,
        }),
      ),
    ).toMatchObject({ count: 0 });
    expect(await relationOf(P, 'message', PICTURE_PAIR)).toMatchObject({ status: 'proposed' });
  });

  for (const [label, derived] of [
    ['reconstructed', RECONSTRUCTED],
    ['as-told', AS_TOLD],
  ] as const) {
    it(`leaves an ad-hoc proposal into a model declared ${label} proposed`, async () => {
      const P = `rr-adhoc-${label}`;
      await t.createProject(P);
      await importAs(P, files(), pictureDeclared(derived));
      const r = await messageRule(P);
      const agent = await agentOf(P);
      await proposeAdHoc(agent, P, PICTURE_PAIR, 0.97);
      await proposeAdHoc(agent, P, EXPORT_PAIR, 0.96);
      expect(await relationOf(P, 'message', PICTURE_PAIR)).toMatchObject({ status: 'proposed' });
      expect(await relationOf(P, 'message', EXPORT_PAIR)).toMatchObject({ status: 'accepted' });
      expect(await applyDry(P, r.id)).toMatchObject({
        count: 0,
        blocked: [{ reason: 'reconstructed-endpoint', count: 1 }],
      });
    });
  }

  it('blocks the sending end too: a message from a reconstructed model', async () => {
    const P = 'rr-sender';
    await t.createProject(P);
    await importAs(P, files(), manifestOf({ [`${SENDER_KEY}.bpmn`]: RECONSTRUCTED }));
    const r = await messageRule(P);
    const agent = await agentOf(P);
    await proposeAdHoc(agent, P, PICTURE_PAIR, 0.97);
    await proposeAdHoc(agent, P, EXPORT_PAIR, 0.96);
    expect((await relations(P)).filter((x) => x.type === 'message').map((x) => x.status)).toEqual([
      'proposed',
      'proposed',
    ]);
    expect(await ledger(P)).toEqual([]);
    expect(await applyDry(P, r.id)).toMatchObject({
      count: 0,
      blocked: [{ reason: 'reconstructed-endpoint', count: 2 }],
    });
  });

  it('follows an amended head’s upstream: an amendment never lifts it', async () => {
    const P = 'rr-amended';
    await t.createProject(P);
    // A caller without a call target (an open question) read from a picture, and its callee.
    const caller = { path: `${AUFTRAG_KEY}.bpmn`, bytes: auftrag() };
    await importAs(
      P,
      [caller, { path: `${RECHNUNG_KEY}.bpmn`, bytes: rechnung() }],
      manifestOf({ [caller.path]: RECONSTRUCTED }),
    );
    const model = (await models(P)).find((m) => m.key === AUFTRAG_KEY)!;
    const amended = await t.asOwner(`/api/v1/projects/${P}/models/${model.id}/amendments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'if-match': `"r${model.headRev}"` },
      body: JSON.stringify({
        items: [
          {
            elementId: 'Call_Rechnung',
            op: 'call-target',
            target: `${RECHNUNG_KEY}#Process_Rechnung`,
          },
        ],
      }),
    });
    expect(amended.status, await amended.clone().text()).toBe(201);
    const head = (await models(P)).find((m) => m.key === AUFTRAG_KEY);
    expect(head?.headRev).toBe(model.headRev + 1);
    expect(head?.source).toMatchObject({ derived: 'reconstructed' });
    // An agent's proposal of a message the amended model sends, at every agent tier.
    const rules = await Promise.all(
      (['key', 'lexical', 'semantic'] as const).map((tier) =>
        rule(P, { name: `Nachricht ${tier}`, tier, minConfidence: 0.5, includeAdHoc: true }),
      ),
    );
    const pair: [string, string] = [
      `${AUFTRAG_KEY}#Event_Bestaetigung`,
      `${RECHNUNG_KEY}#Task_Bestaetigung`,
    ];
    await proposeAdHoc(await agentOf(P), P, pair, 0.97);
    const proposed = await relationOf(P, 'message', pair);
    expect(proposed).toMatchObject({ status: 'proposed' });
    expect(await ledger(P)).toEqual([]);
    const matching = rules.find((x) => x.tier === proposed?.tier)!;
    expect(await applyDry(P, matching.id)).toMatchObject({
      count: 0,
      blocked: [{ reason: 'reconstructed-endpoint', count: 1 }],
    });
  });

  it('a re-import keeps it with the same bytes and lifts it with changed ones; earlier acceptances stay', async () => {
    const P = 'rr-reimport';
    await t.createProject(P);
    await importAs(P, files(), pictureDeclared());
    const r = await messageRule(P);
    const agent = await agentOf(P);
    await proposeAdHoc(agent, P, PICTURE_PAIR, 0.95);
    expect(await relationOf(P, 'message', PICTURE_PAIR)).toMatchObject({ status: 'proposed' });

    // The same bytes, now declared an export: unchanged, the declaration stays.
    const same = await importAs(P, files(), pictureDeclared({ kind: 'export' }));
    expect(same.files.find((f) => f.modelKey === PICTURE_KEY)?.outcome).toBe('unchanged');
    expect(await applyDry(P, r.id)).toMatchObject({
      count: 0,
      blocked: [{ reason: 'reconstructed-endpoint', count: 1 }],
    });
    await proposeAdHoc(agent, P, PICTURE_PAIR, 0.96);
    expect(await relationOf(P, 'message', PICTURE_PAIR)).toMatchObject({ status: 'proposed' });

    // Changed bytes (elsewhere in the model) declared an export: a person re-exported it.
    const changed = await importAs(P, files('Ware prüfen'), pictureDeclared({ kind: 'export' }));
    expect(changed.files.find((f) => f.modelKey === PICTURE_KEY)?.outcome).toBe('revised');
    // The older proposal waits for "apply" (rules are never retroactive) …
    expect(await relationOf(P, 'message', PICTURE_PAIR)).toMatchObject({ status: 'proposed' });
    expect(await applyDry(P, r.id)).toMatchObject({ count: 1, blocked: [] });
    // … and the agent's next proposal is accepted.
    await proposeAdHoc(agent, P, PICTURE_PAIR, 0.97);
    expect(await relationOf(P, 'message', PICTURE_PAIR)).toMatchObject({ status: 'accepted' });
    expect(await ledger(P)).toMatchObject([{ ruleId: r.id, state: 'in-force' }]);

    // Read from a picture again (changed bytes): what a rule accepted before stays in force.
    await importAs(P, files('Ware erneut prüfen'), pictureDeclared());
    expect((await models(P)).find((m) => m.key === PICTURE_KEY)?.source).toMatchObject({
      derived: 'reconstructed',
    });
    expect(await relationOf(P, 'message', PICTURE_PAIR)).toMatchObject({ status: 'accepted' });
    expect(await ledger(P)).toMatchObject([{ ruleId: r.id, state: 'in-force' }]);
  });
});

// ------------------------------------------------------------ placements

const STEPS = [
  { id: 'step-lager', name: 'Einlagerung', x: 0 },
  { id: 'step-buchhaltung', name: 'Buchhaltung', x: 200 },
];

async function placementProject(P: string) {
  await t.createProject(P);
  await importAs(P, files(), pictureDeclared());
  await json<SaveValueChainResult>(
    await send(`/api/v1/projects/${P}/value-chains`, {
      key: 'main',
      content: chain({ steps: STEPS }),
    }),
    201,
  );
  // Both agent tiers, so whatever tier a proposal gets, a rule matches.
  const rules = await Promise.all(
    (['lexical', 'semantic'] as const).map((tier) =>
      rule(P, { name: `Platzierung ${tier}`, kind: 'placement', tier, includeAdHoc: true }),
    ),
  );
  const token = await t.createToken(P, ['analyzr:read', 'analyzr:propose']);
  return { rules, agent: asAgent(t, token.secret) };
}

const place = (step: string, process: string, confidence: number) => ({
  step,
  process,
  confidence,
  rationale: `Platzierung von ${process}`,
});

async function placementOf(P: string, process: string): Promise<Placement | undefined> {
  const page = await json<PlacementPage>(await t.asOwner(chainPath(P, '/placements?limit=200')));
  return page.items.find((p) => p.process === process);
}

describe('a placement rule on a process of a reconstructed model', () => {
  it('leaves the pipeline’s placement proposed and places the other process', async () => {
    const P = 'rr-plc-pipeline';
    const { rules, agent } = await placementProject(P);
    const [claimed] = await claimPlacement(agent, { projectId: P });
    if (!claimed) throw new Error('no placement task');
    await submitPlacement(
      agent,
      claimed.taskId,
      placementSubmission(claimed, [
        place('step-lager', PICTURE_PROCESS, 0.97),
        place('step-buchhaltung', EXPORT_PROCESS, 0.96),
      ]),
    );
    expect(await placementOf(P, PICTURE_PROCESS)).toMatchObject({ status: 'proposed' });
    expect(await placementOf(P, EXPORT_PROCESS)).toMatchObject({ status: 'accepted' });
    // The rule of the agent proposal's tier names the block; the other matches nothing.
    const dries = await Promise.all(rules.map((x) => applyDry(P, x.id)));
    expect(dries.map((d) => d.count)).toEqual([0, 0]);
    expect(dries.flatMap((d) => d.blocked)).toEqual([
      { reason: 'reconstructed-endpoint', count: 1 },
    ]);
  });

  it('leaves an ad-hoc placement proposed', async () => {
    const P = 'rr-plc-adhoc';
    const { agent } = await placementProject(P);
    for (const [step, process] of [
      ['step-lager', PICTURE_PROCESS],
      ['step-buchhaltung', EXPORT_PROCESS],
    ] as const) {
      const res = await post(agent, chainPath(P, '/placements'), {
        kind: 'propose',
        placements: [place(step, process, 0.97)],
      });
      expect(res.status, await res.clone().text()).toBeLessThan(300);
    }
    expect(await placementOf(P, PICTURE_PROCESS)).toMatchObject({ status: 'proposed' });
    expect(await placementOf(P, EXPORT_PROCESS)).toMatchObject({ status: 'accepted' });
  });
});

// ----------------------------------------------------- rules for derived calls

const CALL: [string, string] = [`${AUFTRAG_KEY}#Call_Rechnung`, `${RECHNUNG_KEY}#Process_Rechnung`];
/** An engine-less caller (derived), whose unique call the rule tier only proposes. */
const caller = {
  path: `${AUFTRAG_KEY}.bpmn`,
  bytes: auftrag({ callRechnung: 'Process_Rechnung', engineless: true }),
};
const callee = { path: `${RECHNUNG_KEY}.bpmn`, bytes: rechnung() };

describe('a rule for derived calls on a call into a reconstructed callee', () => {
  it('accepts nothing at ingest; the owner’s dry run, "apply" and derivedGroups agree', async () => {
    const P = 'rr-calls';
    await t.createProject(P);
    const r = await rule(P, {
      name: 'Aufrufe: Export ohne Engine',
      relationType: 'call',
      proposedBy: 'rule',
      derivedKind: 'export',
      converter: null,
    });
    const manifest = manifestOf({
      [caller.path]: { kind: 'export' },
      [callee.path]: RECONSTRUCTED,
    });
    const dry = await importAs(P, [caller, callee], manifest, { dryRun: true });
    expect(dry.impact?.callsProposed.count).toBe(1);
    expect(dry.impact?.autoAcceptedCalls).toEqual({
      count: 0,
      items: [],
      ofProposed: 0,
      byRule: [],
    });
    await importAs(P, [caller, callee], manifest);
    expect(await relationOf(P, 'call', CALL)).toMatchObject({
      status: 'proposed',
      attrs: { match: 'derived-caller' },
    });
    expect(await ledger(P)).toEqual([]);
    expect(await applyDry(P, r.id)).toMatchObject({
      count: 0,
      blocked: [{ reason: 'reconstructed-endpoint', count: 1 }],
    });
    const preview = await json<AutoAcceptPreview>(
      await send(`/api/v1/projects/${P}/auto-accept-rules/preview`, {
        kind: 'relation',
        tier: 'key',
        minConfidence: 0.9,
        relationType: 'call',
        proposedBy: 'rule',
        derivedKind: 'export',
      }),
    );
    expect(preview.derivedGroups).toEqual([
      { derivedKind: 'export', converter: null, open: 0, blocked: 1, accepted: 0, rejected: 0 },
    ]);
    // The control: the callee re-exported by a person (its process renamed, so the rule tier
    // proposes the call again) is accepted in the import's write, as its dry run says.
    const exported = {
      path: callee.path,
      bytes: rechnung().replace('name="Rechnungsstellung"', 'name="Rechnungsstellung neu"'),
    };
    const lifted = manifestOf({
      [caller.path]: { kind: 'export' },
      [callee.path]: { kind: 'export' },
    });
    expect(
      (await importAs(P, [caller, exported], lifted, { dryRun: true })).impact?.autoAcceptedCalls
        ?.count,
    ).toBe(1);
    await importAs(P, [caller, exported], lifted);
    expect(await relationOf(P, 'call', CALL)).toMatchObject({ status: 'accepted' });
    expect(await ledger(P)).toMatchObject([{ ruleId: r.id, proposedBy: 'rule' }]);
  });

  it('accepts nothing when a deletion makes such a call unique', async () => {
    const P = 'rr-calls-delete';
    const projectId = (await t.createProject(P)).id;
    await rule(P, {
      name: 'Aufrufe: ohne Angabe',
      relationType: 'call',
      proposedBy: 'rule',
      derivedKind: 'none',
      converter: null,
    });
    const copy = {
      path: 'finanzen/rechnung-alt.bpmn',
      bytes: rechnung({ taskName: 'Alt buchen' }),
    };
    await importAs(P, [caller, callee, copy], manifestOf({ [callee.path]: RECONSTRUCTED }));
    // Ambiguous: two models define Process_Rechnung.
    expect(await relationOf(P, 'call', CALL)).toMatchObject({
      status: 'proposed',
      confidence: 0.5,
    });
    const dup = (await models(P)).find((m) => m.key === 'finanzen/rechnung-alt')!;
    const impact = await json<ImportImpact>(
      await t.asOwner(`/api/v1/projects/${P}/models/${dup.id}/deletion-impact`),
    );
    expect(impact.autoAcceptedCalls).toMatchObject({ count: 0 });
    await t.useCases.deleteModel(await member(projectId, 'owner'), P, dup.id);
    expect(await relationOf(P, 'call', CALL)).toMatchObject({
      status: 'proposed',
      confidence: 0.9,
    });
    expect(await ledger(P)).toEqual([]);
  });

  it('an agent rule for calls never accepts an agent’s call proposal from a reconstructed caller', async () => {
    const P = 'rr-calls-agent-rule';
    await t.createProject(P);
    const r = await rule(P, { name: 'Aufrufe ab 90 %', relationType: 'call', includeAdHoc: true });
    // A human imports a Camunda 7 caller read from a picture: the rule tier only proposes its
    // unique call, so an agent's proposal of it meets the agent rule; only the safeguard holds.
    await importAs(
      P,
      [{ path: caller.path, bytes: auftrag({ callRechnung: 'Process_Rechnung' }) }, callee],
      manifestOf({ [caller.path]: RECONSTRUCTED }),
    );
    expect((await models(P)).find((m) => m.key === AUFTRAG_KEY)?.trust).toMatchObject({
      reasons: ['reconstructed'],
    });
    await proposeAdHoc(await agentOf(P), P, CALL, 0.95, 'call');
    expect(await relationOf(P, 'call', CALL)).toMatchObject({ status: 'proposed', tier: 'key' });
    expect(await ledger(P)).toEqual([]);
    expect(await applyDry(P, r.id)).toMatchObject({
      count: 0,
      blocked: [{ reason: 'reconstructed-endpoint', count: 1 }],
    });
  });

  it('reports agent-upload first for a reconstructed caller an agent token uploaded', async () => {
    const P = 'rr-calls-agent';
    await t.createProject(P);
    const r = await rule(P, { name: 'Aufrufe ab 90 %', relationType: 'call', includeAdHoc: true });
    const token = await t.createToken(P, ['analyzr:read', 'analyzr:write', 'analyzr:propose']);
    await importAs(
      P,
      [{ path: caller.path, bytes: auftrag({ callRechnung: 'Process_Rechnung' }) }, callee],
      manifestOf({ [caller.path]: RECONSTRUCTED }),
      { token: token.secret },
    );
    expect((await models(P)).find((m) => m.key === AUFTRAG_KEY)?.trust).toMatchObject({
      reasons: ['agent-upload', 'reconstructed'],
    });
    const res = await post(asAgent(t, token.secret), `/api/v1/projects/${P}/relations`, {
      ...item('call', ...CALL, { confidence: 0.95 }),
    });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    expect(await relationOf(P, 'call', CALL)).toMatchObject({ status: 'proposed' });
    expect(await applyDry(P, r.id)).toMatchObject({
      count: 0,
      blocked: [{ reason: 'agent-upload', count: 1 }],
    });
  });
});

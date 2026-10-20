/**
 * Rules for derived calls end to end (M6 S2c-3, decision 24.2's extension
 * of decision 19, owner decision 28 (1)) with the real libraries and a real
 * PostgreSQL:
 * - an owner's rule for derived calls accepts the rule tier's proposal of a
 *   unique call from a derived model in the import's own write: marked,
 *   decided by the rule's author, caused by the importer; an owner's dry run
 *   names it (`autoAcceptedCalls`), an editor's, a read-only token's and an
 *   agent token's never do, and after the import the accepted calls equal
 *   `acceptedCalls` ∪ `autoAcceptedCalls`;
 * - the narrowing: converter X leaves converter Y alone; no rule accepts a
 *   call of a revision uploaded with an agent token (`agent-upload`), an
 *   agent rule neither (the agent's own proposal of that call stays a
 *   proposal), nor one whose call target set in analyzr is in conflict
 *   (`amendment-conflict`); an existing agent rule never accepts a derived
 *   call;
 * - rules stay non-retroactive (an unrelated or unchanged import accepts
 *   nothing older; "apply" does, after its dry run); a write by an agent
 *   token (a callee's upload, a deletion) accepts nothing; a human's import
 *   that makes the rule tier propose the call again (the callee renamed) is
 *   a new proposal the rule accepts; revoking returns the call to the rule
 *   tier's proposal and queues nothing, and a revoked call is never accepted
 *   again, also when the rule tier proposes it again; a deletion that makes
 *   a duplicate process id unique lets the rule accept; without such rules,
 *   or without derived proposals, the events are those of before.
 */
import {
  ImportResult,
  type ApplyAutoAcceptResult,
  type AutoAcceptLedger,
  type AutoAcceptRevocationResult,
  type AutoAcceptRuleDetail,
  type ImportImpact,
  type Me,
  type Model,
  type ModelPage,
  type Relation,
  type RelationPage,
  type SaveAutoAcceptRuleResult,
} from '@analyzr/contracts';
import { newId } from '@analyzr/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { libraryAnalysis } from '../../src/analysis.ts';
import { generateOwnerKey } from '../../src/auth/owner-key.ts';
import { createStore } from '../../src/db/store.ts';
import type { Actor } from '../../src/domain/actor.ts';
import {
  AUFTRAG_KEY,
  LAGER_KEY,
  RECHNUNG_KEY,
  auftrag,
  lager,
  rechnung,
} from '../support/amend-fixtures.ts';
import { startTestApp, type TestApp } from '../support/app.ts';
import { createTestDatabase, type TestDatabase } from '../support/db.ts';
import { asAgent, claim, item, submission, submit } from '../support/pipeline.ts';

const CALL = `${AUFTRAG_KEY}#Call_Rechnung`;
const PROCESS_RECHNUNG = `${RECHNUNG_KEY}#Process_Rechnung`;
const VERSAND_ALT_KEY = 'versand/alt';
const PROCESS_VERSAND_ALT = `${VERSAND_ALT_KEY}#Process_Versand_Alt`;
const CONVERTER = 'normalize-bpmn@0.1.0';

/** The process `auftrag`'s second call names (and a target for a changed first call). */
const versandAlt = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" targetNamespace="http://example.org/bpmn" id="Defs_Alt">
  <bpmn:process id="Process_Versand_Alt" name="Alter Versand" isExecutable="true">
    <bpmn:startEvent id="Start_Alt" name="Versand beauftragt" />
  </bpmn:process>
</bpmn:definitions>
`;

let database: TestDatabase;
let t: TestApp;
let me: Me;
const ownerKey = generateOwnerKey();

beforeAll(async () => {
  database = await createTestDatabase();
  t = startTestApp(database, { analysis: libraryAnalysis, ownerKey });
  me = (await (await t.asOwner('/api/v1/me')).json()) as Me;
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

/** A rule for derived calls of `derivedKind` (and `converter`), on unless `enabled: false`. */
async function callsRule(
  p: string,
  derivedKind: 'export' | 'converted' | 'none',
  extra: Record<string, unknown> = {},
): Promise<AutoAcceptRuleDetail> {
  const saved = await json<SaveAutoAcceptRuleResult>(
    await send(`/api/v1/projects/${p}/auto-accept-rules`, {
      name: `Aufrufe: ${derivedKind}${typeof extra['converter'] === 'string' ? ` ${extra['converter']}` : ''}`,
      kind: 'relation',
      tier: 'key',
      minConfidence: 0.9,
      relationType: 'call',
      proposedBy: 'rule',
      derivedKind,
      converter: null,
      enabled: true,
      ...extra,
    }),
    201,
  );
  return saved.rule;
}

type As = 'web' | 'owner-key' | { token: string };

function call(as: As, path: string, init?: RequestInit): Promise<Response> {
  if (as === 'web') return t.asOwner(path, init);
  return t.asToken(as === 'owner-key' ? ownerKey : as.token, path, init);
}

const manifestOf = (files: Record<string, unknown>[]) => ({
  format: 'analyzr-import/1',
  source: { system: 'signavio' },
  files,
});

async function importAs(
  p: string,
  as: As,
  files: readonly { path: string; bytes: string }[],
  manifest?: unknown,
  dryRun = false,
): Promise<ImportResult> {
  const form = new FormData();
  for (const f of files) form.append('files', new Blob([f.bytes]), f.path);
  if (manifest !== undefined) form.append('manifest', JSON.stringify(manifest));
  const res = await call(as, `/api/v1/projects/${p}/imports${dryRun ? '?dryRun=true' : ''}`, {
    method: 'POST',
    body: form,
  });
  return ImportResult.parse(await json<unknown>(res));
}

const caller = (variant: Parameters<typeof auftrag>[0] = {}) => ({
  path: `${AUFTRAG_KEY}.bpmn`,
  bytes: auftrag({ callRechnung: 'Process_Rechnung', engineless: true, ...variant }),
});
const callee = { path: `${RECHNUNG_KEY}.bpmn`, bytes: rechnung() };
/** The caller declared `derived` in the manifest. */
const declaring = (derived: Record<string, unknown>) =>
  manifestOf([{ path: caller().path, key: AUFTRAG_KEY, derived }]);

const relations = async (p: string): Promise<Relation[]> =>
  (await json<RelationPage>(await t.asOwner(`/api/v1/projects/${p}/relations?limit=200`))).items;
const relationOf = async (p: string, from: string, to: string) =>
  (await relations(p)).find((r) => r.type === 'call' && r.from === from && r.to === to);
const ledger = async (p: string) =>
  (await json<AutoAcceptLedger>(await t.asOwner(`/api/v1/projects/${p}/auto-accepted`))).items;
const models = async (p: string): Promise<Model[]> =>
  (await json<ModelPage>(await t.asOwner(`/api/v1/projects/${p}/models?limit=200`))).items;

async function events(projectId: string, after = 0) {
  return createStore(database.db).read((tx) =>
    tx.events.list(projectId as never, { afterSeq: after, limit: 10_000 }),
  );
}

const lastSeq = async (projectId: string) => (await events(projectId)).at(-1)?.seq ?? 0;

/** The rule tier's proposals on a relation so far (live or not). */
async function ruleProposals(projectId: string, relationId: string): Promise<number> {
  const all = await createStore(database.db).read((tx) =>
    tx.assertions.listForProject(projectId as never),
  );
  return all.filter(
    (a) => a.relationId === relationId && a.sourceKind === 'rule' && a.kind === 'proposal',
  ).length;
}

/** The callee with its process renamed: the process's fingerprint changes, the call is proposed again. */
const renamedCallee = (name: string) => ({
  path: `${RECHNUNG_KEY}.bpmn`,
  bytes: rechnung().replace('name="Rechnungsstellung"', `name="${name}"`),
});

function applyDry(p: string, ruleId: string) {
  return send(`/api/v1/projects/${p}/auto-accept-rules/${ruleId}/apply?dryRun=true`, {});
}

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

const keyOf = (r: { type: string; from: string; to: string }) => `${r.type} ${r.from} ${r.to}`;

describe('a rule for derived calls at ingest', () => {
  const P = 'dc-export';
  let projectId = '';
  let rule: AutoAcceptRuleDetail;

  beforeAll(async () => {
    projectId = (await t.createProject(P)).id;
    rule = await callsRule(P, 'export');
  });

  it('is named in an owner’s dry run only (web or owner key), never for others', async () => {
    const files = [caller(), callee];
    const manifest = declaring({ kind: 'export' });
    const owner = await importAs(P, 'web', files, manifest, true);
    expect(owner.impact?.callsProposed.count).toBe(1);
    expect(owner.impact?.autoAcceptedCalls).toEqual({
      count: 1,
      items: [
        { type: 'call', from: CALL, to: PROCESS_RECHNUNG, ruleId: rule.id, ruleName: rule.name },
      ],
      ofProposed: 1,
      byRule: [{ ruleId: rule.id, ruleName: rule.name, count: 1 }],
    });
    expect((await importAs(P, 'owner-key', files, manifest, true)).impact).toEqual(owner.impact);
    // A read-only and an agent token: the agent upload is never accepted, and no rule data.
    for (const scopes of [['analyzr:read'], ['analyzr:read', 'analyzr:write']] as const) {
      const token = (await t.createToken(P, [...scopes])).secret;
      const dry = await importAs(P, { token }, files, manifest, true);
      expect(dry.impact?.callsProposed.count, scopes.join()).toBe(1);
      expect(dry.impact && 'autoAcceptedCalls' in dry.impact, scopes.join()).toBe(false);
      expect(JSON.stringify(dry)).not.toContain(rule.name);
    }
    // An editor: no rule data either.
    const editor = await member(projectId, 'editor');
    const preview = await t.useCases.importFiles(
      editor,
      P,
      files.map((f) => ({ path: f.path, bytes: new TextEncoder().encode(f.bytes) })),
      { manifest: new TextEncoder().encode(JSON.stringify(manifest)), dryRun: true },
    );
    expect(preview.impact?.callsProposed.count).toBe(1);
    expect(preview.impact && 'autoAcceptedCalls' in preview.impact).toBe(false);
  });

  it('accepts it in the import’s write: marked, the author’s decision, the importer the causer', async () => {
    const files = [caller(), callee];
    const manifest = declaring({ kind: 'export' });
    const dry = await importAs(P, 'web', files, manifest, true);
    const before = await lastSeq(projectId);
    const was = new Map((await relations(P)).map((r) => [keyOf(r), r.status]));
    const editor = await member(projectId, 'editor');
    await t.useCases.importFiles(
      editor,
      P,
      files.map((f) => ({ path: f.path, bytes: new TextEncoder().encode(f.bytes) })),
      { manifest: new TextEncoder().encode(JSON.stringify(manifest)) },
    );
    // The property: the calls accepted now are acceptedCalls ∪ autoAcceptedCalls.
    const impact = dry.impact as ImportImpact;
    const newlyAccepted = (await relations(P))
      .filter(
        (r) => r.type === 'call' && r.status === 'accepted' && was.get(keyOf(r)) !== 'accepted',
      )
      .map(keyOf)
      .sort();
    expect(newlyAccepted).toEqual(
      [...impact.acceptedCalls.items, ...(impact.autoAcceptedCalls?.items ?? [])].map(keyOf).sort(),
    );

    const accepted = await relationOf(P, CALL, PROCESS_RECHNUNG);
    expect(accepted).toMatchObject({
      status: 'accepted',
      attrs: { match: 'derived-caller' },
      provenance: {
        kind: 'decision',
        verdict: 'accept',
        sourceKind: 'human',
        principalId: me.principalId,
      },
    });
    const entries = await ledger(P);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: accepted?.id,
      proposedBy: 'rule',
      ruleId: rule.id,
      revision: 1,
      ruleName: rule.name,
      state: 'in-force',
      decidedBy: { principalId: me.principalId },
      agent: { handle: 'analyzr-rules' },
      tier: 'key',
      confidence: 0.9,
      llmModel: null,
    });
    const decided = (await events(projectId, before)).filter(
      (e) => e.type === 'relation.decided' && e.subjectRef === accepted?.id,
    );
    expect(decided).toHaveLength(1);
    expect(decided[0]).toMatchObject({ principalId: editor.principalId, clientId: 'analyzr-web' });
    expect(decided[0]?.payload).toMatchObject({
      sourceKind: 'human',
      principalId: me.principalId,
      verdict: 'accept',
      autoAccept: { ruleId: rule.id, revision: 1, triggerId: entries[0]?.triggerId },
    });
    // The same write: the decision follows the model's revision without another request.
    const kinds = (await events(projectId, before)).map((e) => e.type);
    expect(kinds.indexOf('relation.decided')).toBeGreaterThan(kinds.indexOf('model.revised'));
    expect(
      (
        await json<{ system: { proposed: number } }>(
          await t.asOwner(`/api/v1/projects/${P}/auto-accept-rules`),
        )
      ).system.proposed,
    ).toBe(0);
  });
});

describe('the narrowing', () => {
  it('a rule for converter X leaves converter Y alone', async () => {
    const P = 'dc-converter';
    await t.createProject(P);
    const rule = await callsRule(P, 'converted', { converter: CONVERTER });
    await importAs(
      P,
      'owner-key',
      [caller(), callee],
      declaring({ kind: 'converted', converter: 'normalize-bpmn@0.2.0' }),
    );
    expect(await relationOf(P, CALL, PROCESS_RECHNUNG)).toMatchObject({
      status: 'proposed',
      tier: 'key',
    });
    const dry = await json<ApplyAutoAcceptResult>(await applyDry(P, rule.id));
    expect(dry).toMatchObject({ count: 0, blocked: [] });
    // Re-imported as converter X: the rule tier's proposal stands as it was, so no new
    // proposal is recorded and the rule stays non-retroactive; "apply" would take it now.
    await importAs(
      P,
      'owner-key',
      [caller({ taskName: 'Auftrag genau prüfen' })],
      declaring({ kind: 'converted', converter: CONVERTER }),
    );
    expect((await relationOf(P, CALL, PROCESS_RECHNUNG))?.status).toBe('proposed');
    expect((await json<ApplyAutoAcceptResult>(await applyDry(P, rule.id))).count).toBe(1);
    // A landscape of converter X from the start: accepted in the import's write.
    const X = 'dc-converter-x';
    await t.createProject(X);
    const ruleX = await callsRule(X, 'converted', { converter: CONVERTER });
    await importAs(
      X,
      'owner-key',
      [caller(), callee],
      declaring({ kind: 'converted', converter: CONVERTER }),
    );
    expect((await relationOf(X, CALL, PROCESS_RECHNUNG))?.status).toBe('accepted');
    expect((await ledger(X)).map((e) => e.ruleId)).toEqual([ruleX.id]);
  });

  it('never accepts a call of a revision uploaded with an agent token (agent-upload)', async () => {
    const P = 'dc-agent-upload';
    await t.createProject(P);
    const rule = await callsRule(P, 'none');
    const token = (await t.createToken(P, ['analyzr:read', 'analyzr:write'])).secret;
    // A Camunda 7 file, but an agent token uploaded it: derived (agent-upload), no kind declared.
    await importAs(P, { token }, [caller({ engineless: false }), callee]);
    expect((await models(P)).find((m) => m.key === AUFTRAG_KEY)?.trust).toMatchObject({
      class: 'derived',
      reasons: ['agent-upload'],
      derivedKind: null,
    });
    expect(await relationOf(P, CALL, PROCESS_RECHNUNG)).toMatchObject({ status: 'proposed' });
    expect(await ledger(P)).toEqual([]);
    expect(await json<ApplyAutoAcceptResult>(await applyDry(P, rule.id))).toMatchObject({
      count: 0,
      blocked: [{ reason: 'agent-upload', count: 1 }],
    });
  });

  it('an agent rule never accepts an agent’s proposal of a call whose caller an agent token uploaded', async () => {
    const P = 'dc-agent-rule-upload';
    await t.createProject(P);
    const { rule } = await json<SaveAutoAcceptRuleResult>(
      await send(`/api/v1/projects/${P}/auto-accept-rules`, {
        name: 'Gleicher Name ab 90 %',
        kind: 'relation',
        tier: 'key',
        minConfidence: 0.9,
        enabled: true,
      }),
      201,
    );
    const token = await t.createToken(P, ['analyzr:read', 'analyzr:write', 'analyzr:propose']);
    await importAs(P, { token: token.secret }, [caller({ engineless: false }), callee]);
    expect((await models(P)).find((m) => m.key === AUFTRAG_KEY)?.trust).toMatchObject({
      class: 'derived',
      reasons: ['agent-upload'],
    });
    // The same agent judges the pair the rule tier names and proposes it (key, 95 %).
    const agent = asAgent(t, token.secret);
    const [claimed] = await claim(agent, { projectId: P, modelKey: AUFTRAG_KEY });
    if (!claimed) throw new Error('no task');
    const res = await submit(
      agent,
      claimed.taskId,
      submission(claimed, [item('call', CALL, PROCESS_RECHNUNG, { confidence: 0.95 })]),
    );
    expect(res.items[0]?.result).toBe('applied');
    // Owner decision 28 (1): no rule ever accepts it; it waits for a person.
    expect(await relationOf(P, CALL, PROCESS_RECHNUNG)).toMatchObject({ status: 'proposed' });
    expect(await ledger(P)).toEqual([]);
    expect(await json<ApplyAutoAcceptResult>(await applyDry(P, rule.id))).toMatchObject({
      count: 0,
      blocked: [{ reason: 'agent-upload', count: 1 }],
    });
  });

  it('an existing agent rule never accepts a derived call', async () => {
    const P = 'dc-agent-rule';
    await t.createProject(P);
    const agentRules = await Promise.all(
      [
        { name: 'Gleicher Name ab 90 %', minConfidence: 0.9 },
        {
          name: 'Aufruf: Gleicher Name ab 50 %',
          minConfidence: 0.5,
          relationType: 'call',
          includeAdHoc: true,
        },
      ].map(
        async (r) =>
          (
            await json<SaveAutoAcceptRuleResult>(
              await send(`/api/v1/projects/${P}/auto-accept-rules`, {
                kind: 'relation',
                tier: 'key',
                enabled: true,
                ...r,
              }),
              201,
            )
          ).rule,
      ),
    );
    await importAs(P, 'web', [caller(), callee]);
    expect(await relationOf(P, CALL, PROCESS_RECHNUNG)).toMatchObject({ status: 'proposed' });
    expect(await ledger(P)).toEqual([]);
    for (const r of agentRules) {
      expect((await json<ApplyAutoAcceptResult>(await applyDry(P, r.id))).count).toBe(0);
    }
  });

  it('blocks a call whose call target set in analyzr is in conflict (amendment-conflict)', async () => {
    const P = 'dc-conflict';
    const API = `/api/v1/projects/${P}`;
    await t.createProject(P);
    const rule = await callsRule(P, 'none');
    // An engine-less caller without a target for Call_Rechnung; the human sets it in analyzr.
    const put = async (key: string, xml: string) => {
      const res = await t.putModel(P, key, xml);
      expect(res.status, await res.clone().text()).toBeLessThan(300);
      return (await res.json()) as { model: Model };
    };
    const { model } = await put(AUFTRAG_KEY, auftrag({ engineless: true }));
    await put(RECHNUNG_KEY, rechnung());
    await put(VERSAND_ALT_KEY, versandAlt);
    const amended = await t.asOwner(`${API}/models/${model.id}/amendments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'if-match': `"r${(await models(P)).find((m) => m.key === AUFTRAG_KEY)?.headRev}"`,
      },
      body: JSON.stringify({
        items: [{ elementId: 'Call_Rechnung', op: 'call-target', target: PROCESS_RECHNUNG }],
      }),
    });
    expect(amended.status, await amended.clone().text()).toBe(201);
    expect((await relationOf(P, CALL, PROCESS_RECHNUNG))?.status).toBe('accepted');
    // The source tool now names another target: „Ergänzung nicht mehr anwendbar“.
    await put(AUFTRAG_KEY, auftrag({ engineless: true, callRechnung: 'Process_Versand_Alt' }));
    expect(await relationOf(P, CALL, PROCESS_VERSAND_ALT)).toMatchObject({
      status: 'proposed',
      tier: 'key',
      attrs: { match: 'derived-caller' },
    });
    // Only the model's other call (Call_Versand, no amendment) was accepted, at its upload.
    expect((await ledger(P)).map((e) => e.from)).toEqual([`${AUFTRAG_KEY}#Call_Versand`]);
    expect(await json<ApplyAutoAcceptResult>(await applyDry(P, rule.id))).toMatchObject({
      count: 0,
      blocked: [{ reason: 'amendment-conflict', count: 1 }],
    });
  });
});

describe('whose proposals a rule accepts', () => {
  it('never changes: an edit into an agent rule is refused (kind-changed); unchanged writes nothing', async () => {
    const P = 'dc-proposer';
    await t.createProject(P);
    const rule = await callsRule(P, 'converted', { converter: CONVERTER, enabled: false });
    const put = (body: Record<string, unknown>) =>
      t.asOwner(`/api/v1/projects/${P}/auto-accept-rules/${rule.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'if-match': `"r${rule.revision}"` },
        body: JSON.stringify(body),
      });
    const draft = {
      name: rule.name,
      enabled: rule.enabled,
      note: rule.note,
      kind: rule.kind,
      tier: rule.tier,
      minConfidence: rule.minConfidence,
      relationType: rule.relationType,
      agentPrincipalId: null,
      llmModel: null,
      includeAdHoc: false,
      proposedBy: rule.proposedBy,
      derivedKind: rule.derivedKind,
      converter: rule.converter,
    };
    expect(await json<SaveAutoAcceptRuleResult>(await put(draft))).toMatchObject({
      outcome: 'unchanged',
    });
    const refused = await put({
      ...draft,
      proposedBy: 'agent',
      derivedKind: null,
      converter: null,
      relationType: null,
    });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ reason: 'kind-changed' });
    // A converter of another version is a new revision of the same rule.
    expect(
      await json<SaveAutoAcceptRuleResult>(
        await put({ ...draft, converter: 'normalize-bpmn@0.2.0' }),
      ),
    ).toMatchObject({
      outcome: 'revised',
      rule: { converter: 'normalize-bpmn@0.2.0', revision: 2 },
    });
  });
});

describe('never retroactive, revocable', () => {
  const P = 'dc-apply';
  let projectId = '';
  let rule: AutoAcceptRuleDetail;

  it('leaves older proposals to "apply"; an unrelated or unchanged import accepts nothing', async () => {
    projectId = (await t.createProject(P)).id;
    await importAs(P, 'web', [caller(), callee]);
    expect((await relationOf(P, CALL, PROCESS_RECHNUNG))?.status).toBe('proposed');
    rule = await callsRule(P, 'none');
    await importAs(P, 'web', [{ path: `${LAGER_KEY}.bpmn`, bytes: lager() }]);
    await importAs(P, 'web', [caller(), callee]);
    expect((await relationOf(P, CALL, PROCESS_RECHNUNG))?.status).toBe('proposed');
    expect(await ledger(P)).toEqual([]);

    const dry = await json<ApplyAutoAcceptResult>(await applyDry(P, rule.id));
    expect(dry).toMatchObject({ count: 1, blocked: [] });
    expect(dry.items[0]).toMatchObject({
      from: CALL,
      to: PROCESS_RECHNUNG,
      proposedBy: 'rule',
      agent: { handle: 'analyzr-rules' },
      tier: 'key',
      confidence: 0.9,
    });
    const done = await json<ApplyAutoAcceptResult>(
      await send(`/api/v1/projects/${P}/auto-accept-rules/${rule.id}/apply`, {
        revision: dry.revision,
        expectedCount: dry.count,
      }),
    );
    expect(done.count).toBe(1);
    expect((await relationOf(P, CALL, PROCESS_RECHNUNG))?.status).toBe('accepted');
    expect((await ledger(P))[0]).toMatchObject({ proposedBy: 'rule', state: 'in-force' });
  });

  it('a revocation returns the call to the rule tier’s proposal and queues nothing', async () => {
    const before = await lastSeq(projectId);
    const body = { ruleId: rule.id };
    const dry = await json<AutoAcceptRevocationResult>(
      await send(`/api/v1/projects/${P}/auto-accept-revocations?dryRun=true`, body),
    );
    expect(dry).toMatchObject({ count: 1, toProposed: 1, toObsolete: 0 });
    const done = await json<AutoAcceptRevocationResult>(
      await send(`/api/v1/projects/${P}/auto-accept-revocations`, {
        ...body,
        expectedCount: dry.count,
      }),
    );
    expect(done).toMatchObject({ count: 1, toProposed: 1 });
    expect(await relationOf(P, CALL, PROCESS_RECHNUNG)).toMatchObject({
      status: 'proposed',
      tier: 'key',
    });
    expect((await events(projectId, before)).filter((e) => e.type === 'analysis.queued')).toEqual(
      [],
    );
    // A revoked acceptance is never auto-accepted again (human-involved), also when the rule
    // tier proposes the call again (the callee renamed: a new proposal of this write).
    const rel = await relationOf(P, CALL, PROCESS_RECHNUNG);
    const proposals = await ruleProposals(projectId, rel!.id);
    await importAs(P, 'web', [renamedCallee('Rechnungsstellung neu')]);
    expect(await ruleProposals(projectId, rel!.id)).toBe(proposals + 1);
    expect((await relationOf(P, CALL, PROCESS_RECHNUNG))?.status).toBe('proposed');
    expect((await ledger(P)).map((e) => e.state)).toEqual(['revoked']);
  });

  it('a write by an agent token accepts nothing; a human’s import that proposes the call again does', async () => {
    const C = 'dc-callee';
    const id = (await t.createProject(C)).id;
    await importAs(C, 'web', [caller(), callee]);
    const rule = await callsRule(C, 'none');
    const rel = await relationOf(C, CALL, PROCESS_RECHNUNG);
    expect(rel?.status).toBe('proposed');
    // An agent token uploads the callee renamed: the rule tier proposes the call again, but
    // an agent's write never lets a rule accept (whatever it changes on the callee's side).
    const token = (await t.createToken(C, ['analyzr:read', 'analyzr:write'])).secret;
    const proposals = await ruleProposals(id, rel!.id);
    await importAs(C, { token }, [renamedCallee('Rechnungsstellung neu')]);
    expect(await ruleProposals(id, rel!.id)).toBe(proposals + 1);
    expect((await relationOf(C, CALL, PROCESS_RECHNUNG))?.status).toBe('proposed');
    expect(await ledger(C)).toEqual([]);
    // The human imports the callee again (renamed once more): a new proposal of this write,
    // which the rule accepts, caused by the human (as an agent's re-proposal after a change
    // meets an agent rule).
    const before = await lastSeq(id);
    await importAs(C, 'web', [renamedCallee('Rechnungsstellung 2026')]);
    expect(await ruleProposals(id, rel!.id)).toBe(proposals + 2);
    expect((await relationOf(C, CALL, PROCESS_RECHNUNG))?.status).toBe('accepted');
    expect(await ledger(C)).toMatchObject([{ ruleId: rule.id, proposedBy: 'rule' }]);
    const decided = (await events(id, before)).filter((e) => e.type === 'relation.decided');
    expect(decided.map((e) => e.principalId)).toEqual([me.principalId]);
  });
});

describe('a deletion and the events', () => {
  it('a deletion that makes a duplicate process id unique lets the rule accept', async () => {
    const P = 'dc-delete';
    const projectId = (await t.createProject(P)).id;
    const rule = await callsRule(P, 'none');
    await importAs(P, 'web', [
      caller(),
      callee,
      { path: 'finanzen/rechnung-alt.bpmn', bytes: rechnung({ taskName: 'Alt buchen' }) },
    ]);
    // Ambiguous: two models define Process_Rechnung, so the rule tier proposes both at 1/2.
    expect(await relationOf(P, CALL, PROCESS_RECHNUNG)).toMatchObject({
      status: 'proposed',
      confidence: 0.5,
    });
    expect(await ledger(P)).toEqual([]);
    const copy = (await models(P)).find((m) => m.key === 'finanzen/rechnung-alt');
    // The deletion's dry run says so to an owner.
    const impact = await json<ImportImpact>(
      await t.asOwner(`/api/v1/projects/${P}/models/${copy!.id}/deletion-impact`),
    );
    expect(impact.autoAcceptedCalls).toMatchObject({
      count: 1,
      byRule: [{ ruleId: rule.id, count: 1 }],
    });
    const before = await lastSeq(projectId);
    const owner = await member(projectId, 'owner');
    await t.useCases.deleteModel(owner, P, copy!.id);
    expect(await relationOf(P, CALL, PROCESS_RECHNUNG)).toMatchObject({ status: 'accepted' });
    expect(await ledger(P)).toMatchObject([{ ruleId: rule.id, proposedBy: 'rule' }]);
    const decided = (await events(projectId, before)).filter((e) => e.type === 'relation.decided');
    expect(decided.map((e) => e.principalId)).toEqual([owner.principalId]);
  });

  it('a deletion with an agent token accepts nothing', async () => {
    const P = 'dc-delete-agent';
    await t.createProject(P);
    await callsRule(P, 'none');
    await importAs(P, 'web', [
      caller(),
      callee,
      { path: 'finanzen/rechnung-alt.bpmn', bytes: rechnung({ taskName: 'Alt buchen' }) },
    ]);
    const copy = (await models(P)).find((m) => m.key === 'finanzen/rechnung-alt');
    const token = (await t.createToken(P, ['analyzr:read', 'analyzr:write'])).secret;
    const res = await t.asToken(token, `/api/v1/projects/${P}/models/${copy!.id}`, {
      method: 'DELETE',
    });
    expect(res.status, await res.clone().text()).toBeLessThan(300);
    // The call is unique now and proposed again, but no rule accepts it in an agent's write.
    expect(await relationOf(P, CALL, PROCESS_RECHNUNG)).toMatchObject({
      status: 'proposed',
      confidence: 0.9,
    });
    expect(await ledger(P)).toEqual([]);
  });

  it('without such a rule, or without derived proposals, the events are those of before', async () => {
    const shape = async (projectId: string, after: number) =>
      (await events(projectId, after)).map((e) => e.type);
    const run = async (
      p: string,
      rules: 'none' | 'calls' | 'agent',
      files: { path: string; bytes: string }[],
    ) => {
      const projectId = (await t.createProject(p)).id;
      if (rules === 'calls') await callsRule(p, 'none');
      if (rules === 'agent') {
        await json(
          await send(`/api/v1/projects/${p}/auto-accept-rules`, {
            name: 'Gleicher Name ab 50 %',
            kind: 'relation',
            tier: 'key',
            minConfidence: 0.5,
            enabled: true,
          }),
          201,
        );
      }
      const before = await lastSeq(projectId);
      await importAs(p, 'web', files);
      return shape(projectId, before);
    };
    // A Camunda landscape a human imports: no derived proposal, with or without the rule.
    const modelled = [caller({ engineless: false }), callee];
    expect(await run('dc-ev-rule', 'calls', modelled)).toEqual(
      await run('dc-ev-plain', 'none', modelled),
    );
    // A derived landscape with an agent rule only: no rule for derived calls.
    const derived = [caller(), callee];
    expect(await run('dc-ev-agent', 'agent', derived)).toEqual(
      await run('dc-ev-none', 'none', derived),
    );
  });
});

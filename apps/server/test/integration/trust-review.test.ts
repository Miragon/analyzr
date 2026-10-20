/**
 * „Vor der Vertrauensregel angenommen“ end to end (M6 S2c-4, owner decisions
 * 24.2 (a) and 28 (3)) with the real libraries and a real PostgreSQL. A
 * revision stored before S2c is simulated by removing `source.trust` (as the
 * legacy test of `trust.test.ts` does); the next ingest's recompute accepts
 * its unique calls as before the trust rule:
 * - the list holds exactly the rule acceptances whose caller's revision would
 *   be derived today (an engine-less caller, not a Camunda 7 caller a human
 *   uploaded), and the system rule counts them (`preTrust`);
 * - „Zurück in die Prüfung“: the dry run equals the write, the calls become
 *   the rule tier's proposals (tier key, 0.9, the rationale) and stay so
 *   through later ingests, `Model.trust` reads the review, one
 *   `revision.trust_reviewed` event, and the revision is never listed again;
 *   an enabled rule for derived calls accepts them again in the same write,
 *   and the dry run says so;
 * - „Behalten“: the calls stay accepted through later ingests, never listed
 *   again; unchanged bytes keep the reviewed class;
 * - refusals: no `expectedCount` (422), a changed count or a revision not
 *   listed now (409, the dry run too, also for one never listable), an
 *   unknown id, a classified or amended revision
 *   (422, and the database's guard); owners only (editors, viewers, agent and
 *   read-only tokens get 403); the reviews are append-only.
 */
import {
  type AutoAcceptLedger,
  type AutoAcceptRuleList,
  type Model,
  type ModelPage,
  type PreTrustList,
  type PreTrustReviewResult,
  type Relation,
  type RelationAssertionList,
  type RelationPage,
  type SaveAutoAcceptRuleResult,
  ImportResult,
  newId,
} from '@analyzr/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { libraryAnalysis } from '../../src/analysis.ts';
import { generateOwnerKey } from '../../src/auth/owner-key.ts';
import { createStore } from '../../src/db/store.ts';
import type { Actor } from '../../src/domain/actor.ts';
import { trustRationale } from '../../src/domain/trust.ts';
import { AUFTRAG_KEY, RECHNUNG_KEY, auftrag, rechnung } from '../support/amend-fixtures.ts';
import { startTestApp, type TestApp } from '../support/app.ts';
import { createTestDatabase, type TestDatabase } from '../support/db.ts';

const CALL = `${AUFTRAG_KEY}#Call_Rechnung`;
const CALL_VERSAND = `${AUFTRAG_KEY}#Call_Versand`;
const PROCESS_RECHNUNG = `${RECHNUNG_KEY}#Process_Rechnung`;
const VERSAND_ALT_KEY = 'versand/alt';
const PROCESS_VERSAND_ALT = `${VERSAND_ALT_KEY}#Process_Versand_Alt`;
const MAHNUNG_KEY = 'finanzen/mahnung';
const CALL_MAHNUNG = `${MAHNUNG_KEY}#Call_Rechnung_Mahnung`;

/** The process `auftrag`'s second call names. */
const versandAlt = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" targetNamespace="http://example.org/bpmn" id="Defs_Alt">
  <bpmn:process id="Process_Versand_Alt" name="Alter Versand" isExecutable="true">
    <bpmn:startEvent id="Start_Alt" name="Versand beauftragt" />
  </bpmn:process>
</bpmn:definitions>
`;

/** A Camunda 7 caller of `Process_Rechnung`: modelled, never listed. */
const mahnung = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" targetNamespace="http://example.org/bpmn" id="Defs_Mahnung">
  <bpmn:process id="Process_Mahnung" name="Mahnwesen" isExecutable="true">
    <bpmn:callActivity id="Call_Rechnung_Mahnung" name="Rechnung erneut stellen" calledElement="Process_Rechnung" />
  </bpmn:process>
</bpmn:definitions>
`;

/** An unrelated model: its import recomputes the project. */
const unrelated = (n: number) => ({
  path: `lager/u${n}.bpmn`,
  bytes: versandAlt
    .replaceAll('Process_Versand_Alt', `Process_U${n}`)
    .replaceAll('Defs_Alt', `Defs_U${n}`),
});

let database: TestDatabase;
let t: TestApp;
const ownerKey = generateOwnerKey();

beforeAll(async () => {
  database = await createTestDatabase();
  t = startTestApp(database, { analysis: libraryAnalysis, ownerKey });
});

afterAll(async () => {
  await database.drop();
});

async function json<T>(res: Response, status = 200): Promise<T> {
  const text = await res.text();
  expect(res.status, text.slice(0, 800)).toBe(status);
  return JSON.parse(text) as T;
}

const send = (path: string, body: unknown) =>
  t.asOwner(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

async function importWeb(
  p: string,
  files: readonly { path: string; bytes: string }[],
): Promise<ImportResult> {
  const form = new FormData();
  for (const f of files) form.append('files', new Blob([f.bytes]), f.path);
  const res = await t.asOwner(`/api/v1/projects/${p}/imports`, { method: 'POST', body: form });
  return ImportResult.parse(await json<unknown>(res));
}

const relations = async (p: string): Promise<Relation[]> =>
  (await json<RelationPage>(await t.asOwner(`/api/v1/projects/${p}/relations?limit=200`))).items;
const relationOf = async (p: string, from: string, to: string) =>
  (await relations(p)).find((r) => r.type === 'call' && r.from === from && r.to === to);
const models = async (p: string): Promise<Model[]> =>
  (await json<ModelPage>(await t.asOwner(`/api/v1/projects/${p}/models?limit=200`))).items;
const listOf = async (p: string): Promise<PreTrustList> =>
  json<PreTrustList>(await t.asOwner(`/api/v1/projects/${p}/pre-trust-calls`));
const systemOf = async (p: string) =>
  (await json<AutoAcceptRuleList>(await t.asOwner(`/api/v1/projects/${p}/auto-accept-rules`)))
    .system;
const review = (p: string, body: Record<string, unknown>, dryRun: boolean) =>
  send(`/api/v1/projects/${p}/pre-trust-calls/review${dryRun ? '?dryRun=true' : ''}`, body);

async function events(projectId: string, after = 0) {
  return createStore(database.db).read((tx) =>
    tx.events.list(projectId as never, { afterSeq: after, limit: 10_000 }),
  );
}

/** The rule's latest stance on a relation, from its timeline. */
async function ruleStance(p: string, relation: Relation) {
  const list = await json<RelationAssertionList>(
    await t.asOwner(`/api/v1/projects/${p}/relations/${relation.id}/assertions`),
  );
  return list.items.filter((a) => a.sourceKind === 'rule').at(-1);
}

/**
 * A project as imported before S2c: an engine-less caller (two unique calls),
 * its callees and a Camunda 7 caller, uploaded on the web; the class removed
 * from every revision, then an unrelated import recomputes, so the rule tier
 * accepts every unique call as it did before the trust rule.
 */
async function legacyProject(p: string): Promise<{ id: string; revisionId: string }> {
  const project = await t.createProject(p);
  await importWeb(p, [
    {
      path: `${AUFTRAG_KEY}.bpmn`,
      bytes: auftrag({ callRechnung: 'Process_Rechnung', engineless: true }),
    },
    { path: `${RECHNUNG_KEY}.bpmn`, bytes: rechnung() },
    { path: `${VERSAND_ALT_KEY}.bpmn`, bytes: versandAlt },
    { path: `${MAHNUNG_KEY}.bpmn`, bytes: mahnung },
  ]);
  expect((await relationOf(p, CALL, PROCESS_RECHNUNG))?.status).toBe('proposed');
  await database.db.execute(
    sql`UPDATE model_revision SET source = source - 'trust' WHERE project_id = ${project.id}`,
  );
  await importWeb(p, [unrelated(1)]);
  for (const [from, to] of [
    [CALL, PROCESS_RECHNUNG],
    [CALL_VERSAND, PROCESS_VERSAND_ALT],
    [CALL_MAHNUNG, PROCESS_RECHNUNG],
  ] as const) {
    expect(await relationOf(p, from, to), from).toMatchObject({ status: 'accepted', tier: 'rule' });
  }
  const auftragModel = (await models(p)).find((m) => m.key === AUFTRAG_KEY);
  if (!auftragModel) throw new Error('no auftrag');
  return { id: project.id, revisionId: auftragModel.headRevisionId };
}

/** The Postgres error message of a failed statement (Drizzle wraps it in `cause`). */
async function failure(statement: ReturnType<typeof sql>): Promise<string> {
  try {
    await database.db.execute(statement);
  } catch (err) {
    const cause = (err as { cause?: { message?: string } }).cause;
    return cause?.message ?? String(err);
  }
  throw new Error('statement succeeded');
}

/** A user on the web who is a member of the project with `role` (inserted directly). */
async function member(projectId: string, role: 'owner' | 'editor' | 'viewer'): Promise<Actor> {
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

describe('the list „Vor der Vertrauensregel angenommen“', () => {
  it('holds the rule acceptances whose caller would be derived today, and the system rule counts them', async () => {
    const P = 'pt-list';
    const { revisionId } = await legacyProject(P);
    const list = await listOf(P);
    expect(list).toEqual({
      count: 2,
      models: [
        {
          modelId: expect.any(String) as unknown,
          modelKey: AUFTRAG_KEY,
          modelName: 'Auftragsabwicklung',
          revisionId,
          rev: 1,
          reasons: ['no-engine'],
          derivedKind: null,
          converter: null,
          count: 2,
          calls: [
            { relationId: expect.any(String) as unknown, from: CALL, to: PROCESS_RECHNUNG },
            {
              relationId: expect.any(String) as unknown,
              from: CALL_VERSAND,
              to: PROCESS_VERSAND_ALT,
            },
          ],
        },
      ],
    });
    // The Camunda 7 caller a human uploaded is modelled by what it carries: not listed.
    expect(await systemOf(P)).toMatchObject({ accepted: 3, proposed: 0, preTrust: 2 });
    // Before the review the models stored "before S2c" read so (the unrelated one is new).
    expect((await models(P)).filter((m) => m.trust === null).map((m) => m.key)).toEqual(
      [MAHNUNG_KEY, RECHNUNG_KEY, AUFTRAG_KEY, VERSAND_ALT_KEY].sort(),
    );
  });

  it('lists nothing in a project imported since the trust rule', async () => {
    const P = 'pt-new';
    await t.createProject(P);
    await importWeb(P, [
      {
        path: `${AUFTRAG_KEY}.bpmn`,
        bytes: auftrag({ callRechnung: 'Process_Rechnung', engineless: true }),
      },
      { path: `${RECHNUNG_KEY}.bpmn`, bytes: rechnung() },
      { path: `${MAHNUNG_KEY}.bpmn`, bytes: mahnung },
    ]);
    expect(await listOf(P)).toEqual({ count: 0, models: [] });
    expect((await systemOf(P)).preTrust).toBe(0);
  });
});

describe('an amended head (decision 25.2)', () => {
  it('lists the uploaded revision without the call whose target was set in analyzr; reviewing it keeps that call', async () => {
    const P = 'pt-amended';
    const API = `/api/v1/projects/${P}`;
    const project = await t.createProject(P);
    // An engine-less caller without a target for Call_Rechnung, and a unique Call_Versand.
    await importWeb(P, [
      { path: `${AUFTRAG_KEY}.bpmn`, bytes: auftrag({ engineless: true }) },
      { path: `${RECHNUNG_KEY}.bpmn`, bytes: rechnung() },
      { path: `${VERSAND_ALT_KEY}.bpmn`, bytes: versandAlt },
    ]);
    const uploaded = (await models(P)).find((m) => m.key === AUFTRAG_KEY);
    if (!uploaded) throw new Error('no auftrag');
    const amended = await t.asOwner(`${API}/models/${uploaded.id}/amendments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'if-match': `"r${uploaded.headRev}"` },
      body: JSON.stringify({
        items: [{ elementId: 'Call_Rechnung', op: 'call-target', target: PROCESS_RECHNUNG }],
      }),
    });
    expect(amended.status, await amended.clone().text()).toBe(201);
    await database.db.execute(
      sql`UPDATE model_revision SET source = source - 'trust' WHERE project_id = ${project.id}`,
    );
    await importWeb(P, [unrelated(1)]);
    expect((await relationOf(P, CALL_VERSAND, PROCESS_VERSAND_ALT))?.status).toBe('accepted');
    expect((await relationOf(P, CALL, PROCESS_RECHNUNG))?.status).toBe('accepted');

    const head = (await models(P)).find((m) => m.key === AUFTRAG_KEY);
    expect(head?.headRevisionId).not.toBe(uploaded.headRevisionId);
    const list = await listOf(P);
    // The uploaded revision (the amended head's upstream), only the call not set in analyzr.
    expect(list.models.map((m) => [m.revisionId, m.calls.map((c) => c.from)])).toEqual([
      [uploaded.headRevisionId, [CALL_VERSAND]],
    ]);
    // The amended head itself is never reviewed.
    const own = await review(P, { verdict: 'derived', revisionIds: [head?.headRevisionId] }, true);
    expect(own.status).toBe(422);
    expect(await own.json()).toMatchObject({ reason: 'revision-classified' });

    const body = { verdict: 'derived', revisionIds: [uploaded.headRevisionId] };
    const dry = await json<PreTrustReviewResult>(await review(P, body, true));
    expect(dry).toMatchObject({ count: 1, toProposed: 1 });
    const done = await json<PreTrustReviewResult>(
      await review(P, { ...body, expectedCount: 1 }, false),
    );
    expect({ ...done, dryRun: true }).toEqual(dry);
    expect((await relationOf(P, CALL_VERSAND, PROCESS_VERSAND_ALT))?.status).toBe('proposed');
    expect((await relationOf(P, CALL, PROCESS_RECHNUNG))?.status).toBe('accepted');
    expect((await models(P)).find((m) => m.key === AUFTRAG_KEY)?.trust).toMatchObject({
      class: 'derived',
      reasons: ['no-engine'],
    });
  });
});

describe('„Zurück in die Prüfung“', () => {
  it('turns the calls into proposals; the dry run equals the write; one event; never listed again', async () => {
    const P = 'pt-revoke';
    const { id, revisionId } = await legacyProject(P);
    const body = { verdict: 'derived', revisionIds: [revisionId] };
    const dry = await json<PreTrustReviewResult>(await review(P, body, true));
    expect(dry).toEqual({
      dryRun: true,
      verdict: 'derived',
      revisions: 1,
      count: 2,
      toProposed: 2,
      autoAcceptedCalls: { count: 0, items: [], ofProposed: 0, byRule: [] },
    });
    // The dry run wrote nothing.
    expect((await relationOf(P, CALL, PROCESS_RECHNUNG))?.status).toBe('accepted');
    const seq = (await events(id)).at(-1)?.seq ?? 0;

    const done = await json<PreTrustReviewResult>(
      await review(P, { ...body, expectedCount: dry.count }, false),
    );
    expect({ ...done, dryRun: true }).toEqual(dry);
    for (const [from, to] of [
      [CALL, PROCESS_RECHNUNG],
      [CALL_VERSAND, PROCESS_VERSAND_ALT],
    ] as const) {
      const r = await relationOf(P, from, to);
      expect(r, from).toMatchObject({
        status: 'proposed',
        tier: 'key',
        confidence: 0.9,
        attrs: { match: 'derived-caller' },
      });
      expect(await ruleStance(P, r!)).toMatchObject({
        kind: 'proposal',
        rationale: trustRationale(['no-engine']),
      });
    }
    // The modelled caller keeps its acceptance.
    expect((await relationOf(P, CALL_MAHNUNG, PROCESS_RECHNUNG))?.status).toBe('accepted');
    expect((await models(P)).find((m) => m.key === AUFTRAG_KEY)?.trust).toEqual({
      class: 'derived',
      reasons: ['no-engine'],
      derivedKind: null,
      converter: null,
    });
    const written = (await events(id, seq)).filter((e) => e.type === 'revision.trust_reviewed');
    expect(written.map((e) => e.payload)).toEqual([
      { revisionIds: [revisionId], class: 'derived', count: 2 },
    ]);
    expect(await listOf(P)).toEqual({ count: 0, models: [] });
    // The card: no longer „vor der Vertrauensregel“, now open for „Gesammelt annehmen“.
    expect(await systemOf(P)).toMatchObject({ accepted: 1, proposed: 2, preTrust: 0 });

    // Later ingests keep them proposed; a second review finds nothing listed.
    await importWeb(P, [unrelated(2)]);
    expect((await relationOf(P, CALL, PROCESS_RECHNUNG))?.status).toBe('proposed');
    const again = await review(P, { ...body, expectedCount: 2 }, false);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: 'conflict', reason: 'not-listed', count: 0 });
    // The dry run refuses it the same way, so a client that follows the refusal lists again.
    const againDry = await review(P, body, true);
    expect(againDry.status).toBe(409);
    expect(await againDry.json()).toMatchObject({
      code: 'conflict',
      reason: 'not-listed',
      count: 0,
    });
  });

  it('lets an enabled rule for derived calls accept them again in the same write, as the dry run says', async () => {
    const P = 'pt-rule';
    const { revisionId } = await legacyProject(P);
    const rule = await json<SaveAutoAcceptRuleResult>(
      await send(`/api/v1/projects/${P}/auto-accept-rules`, {
        name: 'Aufrufe: ohne Angabe',
        kind: 'relation',
        tier: 'key',
        minConfidence: 0.9,
        relationType: 'call',
        proposedBy: 'rule',
        derivedKind: 'none',
        converter: null,
        enabled: true,
      }),
      201,
    );
    const body = { verdict: 'derived', revisionIds: [revisionId] };
    const dry = await json<PreTrustReviewResult>(await review(P, body, true));
    expect(dry).toMatchObject({
      count: 2,
      toProposed: 2,
      autoAcceptedCalls: {
        count: 2,
        ofProposed: 2,
        byRule: [{ ruleId: rule.rule.id, ruleName: 'Aufrufe: ohne Angabe', count: 2 }],
      },
    });
    const done = await json<PreTrustReviewResult>(
      await review(P, { ...body, expectedCount: 2 }, false),
    );
    expect({ ...done, dryRun: true }).toEqual(dry);
    // Accepted again by the owner's rule: marked, revocable, the rule tier's proposal behind it.
    expect((await relationOf(P, CALL, PROCESS_RECHNUNG))?.status).toBe('accepted');
    const ledger = (
      await json<AutoAcceptLedger>(await t.asOwner(`/api/v1/projects/${P}/auto-accepted`))
    ).items;
    expect(ledger.map((e) => [e.from, e.ruleId, e.proposedBy, e.state]).sort()).toEqual([
      [CALL, rule.rule.id, 'rule', 'in-force'],
      [CALL_VERSAND, rule.rule.id, 'rule', 'in-force'],
    ]);
    expect(await listOf(P)).toEqual({ count: 0, models: [] });
  });
});

describe('„Behalten“', () => {
  it('keeps the calls accepted; the revision is never listed again, also with unchanged bytes', async () => {
    const P = 'pt-keep';
    const { id, revisionId } = await legacyProject(P);
    const body = { verdict: 'modelled', revisionIds: [revisionId] };
    const dry = await json<PreTrustReviewResult>(await review(P, body, true));
    expect(dry).toEqual({
      dryRun: true,
      verdict: 'modelled',
      revisions: 1,
      count: 2,
      toProposed: 0,
      autoAcceptedCalls: { count: 0, items: [], ofProposed: 0, byRule: [] },
    });
    const seq = (await events(id)).at(-1)?.seq ?? 0;
    const done = await json<PreTrustReviewResult>(
      await review(P, { ...body, expectedCount: 2 }, false),
    );
    expect({ ...done, dryRun: true }).toEqual(dry);
    // Only the review's event: nothing recomputed, nothing changed.
    expect((await events(id, seq)).map((e) => e.type)).toEqual(['revision.trust_reviewed']);
    expect((await relationOf(P, CALL, PROCESS_RECHNUNG))?.status).toBe('accepted');
    expect((await models(P)).find((m) => m.key === AUFTRAG_KEY)?.trust).toMatchObject({
      class: 'modelled',
      reasons: [],
    });
    expect(await listOf(P)).toEqual({ count: 0, models: [] });
    await importWeb(P, [unrelated(2)]);
    expect((await relationOf(P, CALL, PROCESS_RECHNUNG))?.status).toBe('accepted');
    expect(await listOf(P)).toEqual({ count: 0, models: [] });
    // Unchanged bytes keep the reviewed class (modelled), which this request would make derived.
    const same = await importWeb(P, [
      {
        path: `${AUFTRAG_KEY}.bpmn`,
        bytes: auftrag({ callRechnung: 'Process_Rechnung', engineless: true }),
      },
    ]);
    expect(same.files[0]?.outcome).toBe('unchanged');
    expect(same.files[0]?.trust).toBeUndefined();
    expect(same.files[0]?.importWarnings?.[0]?.message).toContain(
      "keeps the model's trust class modelled; this request would make it derived (no-engine)",
    );
  });

  it('reports a „Zurück in die Prüfung“ revision’s class for unchanged bytes', async () => {
    const P = 'pt-kept-derived';
    const { revisionId } = await legacyProject(P);
    await json(
      await review(P, { verdict: 'derived', revisionIds: [revisionId], expectedCount: 2 }, false),
    );
    const same = await importWeb(P, [
      {
        path: `${AUFTRAG_KEY}.bpmn`,
        bytes: auftrag({ callRechnung: 'Process_Rechnung', engineless: true }),
      },
    ]);
    expect(same.files[0]).toMatchObject({
      outcome: 'unchanged',
      trust: { class: 'derived', reasons: ['no-engine'] },
    });
    // The same class as this request would give: no warning.
    expect(same.files[0]?.importWarnings).toBeUndefined();
  });
});

describe('refusals', () => {
  it('needs the count; a changed count is 409; an unknown id 422', async () => {
    const P = 'pt-count';
    const { revisionId } = await legacyProject(P);
    const body = { verdict: 'derived', revisionIds: [revisionId] };
    const missing = await review(P, body, false);
    expect(missing.status).toBe(422);
    expect(await missing.json()).toMatchObject({ reason: 'expected-count-required' });
    const stale = await review(P, { ...body, expectedCount: 3 }, false);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      code: 'conflict',
      reason: 'count-changed',
      count: 2,
    });
    const unknown = await review(P, { ...body, revisionIds: [newId('revision')] }, true);
    expect(unknown.status).toBe(422);
    expect(await unknown.json()).toMatchObject({ reason: 'unknown-revision' });
    const twice = await review(P, { ...body, revisionIds: [revisionId, revisionId] }, true);
    expect(twice.status).toBe(422);
    // Nothing was written.
    expect((await relationOf(P, CALL, PROCESS_RECHNUNG))?.status).toBe('accepted');
    expect((await listOf(P)).count).toBe(2);
  });

  it('refuses a revision with nothing to review in the dry run as in the write (409 not-listed)', async () => {
    const P = 'pt-not-listable';
    const { id } = await legacyProject(P);
    // A Camunda 7 head a human uploaded, stored before the trust rule: never listed.
    const mahnungModel = (await models(P)).find((m) => m.key === MAHNUNG_KEY);
    if (!mahnungModel) throw new Error('no mahnung');
    const seq = (await events(id)).at(-1)?.seq ?? 0;
    for (const verdict of ['derived', 'modelled']) {
      const body = { verdict, revisionIds: [mahnungModel.headRevisionId] };
      for (const [dryRun, sent] of [
        [true, body],
        [false, { ...body, expectedCount: 0 }],
      ] as const) {
        const res = await review(P, sent, dryRun);
        expect(res.status, `${verdict} dryRun=${dryRun}`).toBe(409);
        expect(await res.json()).toMatchObject({
          code: 'conflict',
          reason: 'not-listed',
          count: 0,
          detail: expect.stringContaining('list them again') as unknown,
        });
      }
    }
    // Named with a listed one, the whole review is refused.
    const listed = (await listOf(P)).models.map((m) => m.revisionId);
    const mixed = await review(
      P,
      { verdict: 'derived', revisionIds: [...listed, mahnungModel.headRevisionId] },
      true,
    );
    expect(mixed.status).toBe(409);
    expect(await mixed.json()).toMatchObject({ reason: 'not-listed', count: 2 });
    // Nothing was written.
    expect(await events(id, seq)).toEqual([]);
    expect((await relationOf(P, CALL_MAHNUNG, PROCESS_RECHNUNG))?.status).toBe('accepted');
    expect((await listOf(P)).count).toBe(2);
  });

  it('never reviews a revision the trust rule classified, nor an amended one; the database guards it too', async () => {
    const P = 'pt-classified';
    const project = await t.createProject(P);
    await importWeb(P, [
      {
        path: `${AUFTRAG_KEY}.bpmn`,
        bytes: auftrag({ callRechnung: 'Process_Rechnung', engineless: true }),
      },
      { path: `${RECHNUNG_KEY}.bpmn`, bytes: rechnung() },
    ]);
    const model = (await models(P)).find((m) => m.key === AUFTRAG_KEY);
    if (!model) throw new Error('no auftrag');
    for (const verdict of ['derived', 'modelled']) {
      const res = await review(P, { verdict, revisionIds: [model.headRevisionId] }, true);
      expect(res.status, verdict).toBe(422);
      expect(await res.json()).toMatchObject({ reason: 'revision-classified' });
    }
    const me = await json<{ principalId: string }>(await t.asOwner('/api/v1/me'));
    expect(
      await failure(
        sql`INSERT INTO revision_trust_review (project_id, revision_id, model_id, class, principal_id, source_kind, seq)
            VALUES (${project.id}, ${model.headRevisionId}, ${model.id}, 'modelled', ${me.principalId}, 'human', 1)`,
      ),
    ).toMatch(/carries a trust class or is amended/);
  });

  it('is the owners’: editors, viewers, agent and read-only tokens get 403; the reviews are append-only', async () => {
    const P = 'pt-owners';
    const { id, revisionId } = await legacyProject(P);
    const body = { verdict: 'derived' as const, revisionIds: [revisionId as `rev_${string}`] };
    for (const role of ['editor', 'viewer'] as const) {
      const actor = await member(id, role);
      await expect(t.useCases.listPreTrustCalls(actor, P), role).rejects.toMatchObject({
        code: 'forbidden',
      });
      await expect(
        t.useCases.reviewPreTrustCalls(actor, P, { ...body, expectedCount: 2 }, { dryRun: false }),
        role,
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
    for (const scopes of [
      ['analyzr:read', 'analyzr:propose', 'analyzr:write'],
      ['analyzr:read'],
    ] as const) {
      const token = (await t.createToken(P, [...scopes])).secret;
      const list = await t.asToken(token, `/api/v1/projects/${P}/pre-trust-calls`);
      expect(list.status, scopes.join(' ')).toBe(403);
      const write = await t.asToken(token, `/api/v1/projects/${P}/pre-trust-calls/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, expectedCount: 2 }),
      });
      expect(write.status, scopes.join(' ')).toBe(403);
    }
    // The owner key (the CLI) may.
    const cli = await t.asToken(ownerKey, `/api/v1/projects/${P}/pre-trust-calls`);
    expect((await json<PreTrustList>(cli)).count).toBe(2);
    expect((await relationOf(P, CALL, PROCESS_RECHNUNG))?.status).toBe('accepted');

    await json(await review(P, { ...body, expectedCount: 2 }, false));
    for (const [statement, pattern] of [
      ['UPDATE revision_trust_review SET class = class', /append-only: UPDATE/],
      ['DELETE FROM revision_trust_review', /append-only: DELETE/],
      ['TRUNCATE revision_trust_review', /append-only: TRUNCATE/],
    ] as const) {
      expect(await failure(sql.raw(statement)), statement).toMatch(pattern);
    }
  });
});

/**
 * The trust rule end to end (M6 S2c, owner decisions 24.2, 25.2 and 28) with
 * the real libraries and a real PostgreSQL:
 * - the class an upload gets: a Camunda 7 file uploaded by the web or the
 *   owner key is modelled and its unique call accepted; the same bytes with
 *   an agent token, without an engine, or declared converted or
 *   reconstructed are derived and the call only proposed (tier key, 0.9,
 *   the marker and the rationale); a Camunda 8 export is modelled; a
 *   declared `trust` never reaches the revision; the findings are the same
 *   whatever the class; unchanged bytes keep their class and warn
 *   `trust-kept`; the Signavio golden bundle is derived and „Rechnung
 *   stellen“ is proposed;
 * - a call target set in analyzr counts as modelled (25.2): on an
 *   engine-less caller that call is accepted while the model's other call
 *   stays proposed, the manual link is retired, the effect's dry run equals
 *   the write, a re-import keeps it (also when the source tool took the
 *   value over, `in-source`, decision 28 Q2), and withdrawing it brings the
 *   proposal back;
 * - revisions stored before S2c count as modelled (24.2 (a)): their
 *   acceptances stay through unrelated ingests.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AmendModelResult,
  ImportResult,
  PutModelResult,
  WithdrawAmendmentsResult,
  type FindingList,
  type ImportManifest,
  type Model,
  type ModelPage,
  type Relation,
  type RelationAssertionList,
  type RelationPage,
  type Revision,
  type RevisionPage,
} from '@analyzr/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { libraryAnalysis } from '../../src/analysis.ts';
import { generateOwnerKey } from '../../src/auth/owner-key.ts';
import { trustRationale } from '../../src/domain/trust.ts';
import { AUFTRAG_KEY, RECHNUNG_KEY, auftrag, rechnung } from '../support/amend-fixtures.ts';
import { startTestApp, type TestApp } from '../support/app.ts';
import { createTestDatabase, type TestDatabase } from '../support/db.ts';
import { post } from '../support/pipeline.ts';
import { MODELLED, NO_ENGINE } from '../support/trust.ts';

const BUNDLE = fileURLToPath(
  new URL('../../../../tools/integrate/test/fixtures/signavio/bundle/', import.meta.url),
);

const CALL = `${AUFTRAG_KEY}#Call_Rechnung`;
const CALL_VERSAND = `${AUFTRAG_KEY}#Call_Versand`;
const PROCESS_RECHNUNG = `${RECHNUNG_KEY}#Process_Rechnung`;
const VERSAND_ALT_KEY = 'versand/alt';
const PROCESS_VERSAND_ALT = `${VERSAND_ALT_KEY}#Process_Versand_Alt`;

/** The process `auftrag`'s second call names. */
const versandAlt = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" targetNamespace="http://example.org/bpmn" id="Defs_Alt">
  <bpmn:process id="Process_Versand_Alt" name="Alter Versand" isExecutable="true">
    <bpmn:startEvent id="Start_Alt" name="Versand beauftragt" />
  </bpmn:process>
</bpmn:definitions>
`;

/** A Camunda 8 caller of `Process_Rechnung`. */
const c8Caller = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" targetNamespace="http://example.org/bpmn" id="Defs_C8">
  <bpmn:process id="Process_Auftrag" name="Auftragsabwicklung" isExecutable="true">
    <bpmn:callActivity id="Call_Rechnung" name="Rechnung stellen">
      <bpmn:extensionElements>
        <zeebe:calledElement processId="Process_Rechnung" />
      </bpmn:extensionElements>
    </bpmn:callActivity>
  </bpmn:process>
</bpmn:definitions>
`;

let database: TestDatabase;
let t: TestApp;
const ownerKey = generateOwnerKey();
/** An agent token with `analyzr:write` per project. */
const writers = new Map<string, string>();

beforeAll(async () => {
  database = await createTestDatabase();
  t = startTestApp(database, { analysis: libraryAnalysis, ownerKey });
});

afterAll(async () => {
  await database.drop();
});

type As = 'web' | 'owner-key' | 'agent';

async function project(key: string): Promise<void> {
  await t.createProject(key);
  writers.set(key, (await t.createToken(key, ['analyzr:read', 'analyzr:write'])).secret);
}

function call(p: string, as: As, path: string, init?: RequestInit): Promise<Response> {
  if (as === 'web') return t.asOwner(path, init);
  const secret = as === 'owner-key' ? ownerKey : writers.get(p);
  if (!secret) throw new Error(`no writer for ${p}`);
  return t.asToken(secret, path, init);
}

async function getJson<T>(path: string): Promise<T> {
  const res = await t.asOwner(path);
  const text = await res.text();
  expect(res.status, `${path}: ${text.slice(0, 600)}`).toBe(200);
  return JSON.parse(text) as T;
}

async function importAs(
  p: string,
  as: As,
  files: readonly { path: string; bytes: Uint8Array | string }[],
  manifest?: unknown,
  dryRun = false,
): Promise<ImportResult> {
  const form = new FormData();
  for (const f of files) form.append('files', new Blob([f.bytes]), f.path);
  if (manifest !== undefined) form.append('manifest', JSON.stringify(manifest));
  const res = await call(p, as, `/api/v1/projects/${p}/imports${dryRun ? '?dryRun=true' : ''}`, {
    method: 'POST',
    body: form,
  });
  const text = await res.text();
  expect(res.status, text.slice(0, 800)).toBe(200);
  return ImportResult.parse(JSON.parse(text));
}

const models = async (p: string): Promise<Model[]> =>
  (await getJson<ModelPage>(`/api/v1/projects/${p}/models?limit=200`)).items;
const relations = async (p: string): Promise<Relation[]> =>
  (await getJson<RelationPage>(`/api/v1/projects/${p}/relations?limit=200`)).items;
const findings = async (p: string) =>
  (await getJson<FindingList>(`/api/v1/projects/${p}/findings`)).items.map(
    (f) => `${f.kind} ${f.refs.join(',')}`,
  );

async function relationOf(p: string, from: string, to: string): Promise<Relation | undefined> {
  return (await relations(p)).find((r) => r.type === 'call' && r.from === from && r.to === to);
}

async function revisions(p: string, key: string): Promise<Revision[]> {
  const m = (await models(p)).find((x) => x.key === key);
  if (!m) throw new Error(`no model ${key} in ${p}`);
  return (await getJson<RevisionPage>(`/api/v1/projects/${p}/models/${m.id}/revisions?limit=200`))
    .items;
}

/** The rule's latest stance on a relation, from its timeline. */
async function ruleStance(p: string, relation: Relation) {
  const list = await getJson<RelationAssertionList>(
    `/api/v1/projects/${p}/relations/${relation.id}/assertions`,
  );
  return list.items.filter((a) => a.sourceKind === 'rule').at(-1);
}

const caller = (engineless = false) => ({
  path: `${AUFTRAG_KEY}.bpmn`,
  bytes: auftrag({ callRechnung: 'Process_Rechnung', engineless }),
});
const callee = { path: `${RECHNUNG_KEY}.bpmn`, bytes: rechnung() };

const manifestOf = (
  files: ImportManifest['files'] | Record<string, unknown>[],
): Record<string, unknown> => ({
  format: 'analyzr-import/1',
  source: { system: 'signavio' },
  files,
});

describe('the trust class at ingest', () => {
  const variants: {
    p: string;
    as: As;
    engineless?: boolean;
    derived?: Record<string, unknown>;
    trust: { class: string; reasons: string[] };
  }[] = [
    { p: 'web', as: 'web', trust: MODELLED },
    { p: 'cli', as: 'owner-key', trust: MODELLED },
    { p: 'agent', as: 'agent', trust: { class: 'derived', reasons: ['agent-upload'] } },
    { p: 'noengine', as: 'owner-key', engineless: true, trust: NO_ENGINE },
    {
      p: 'converted',
      as: 'owner-key',
      derived: { kind: 'converted', converter: 'normalize-bpmn@0.1.0' },
      trust: { class: 'derived', reasons: ['converted'] },
    },
    {
      p: 'reconstructed',
      as: 'web',
      derived: { kind: 'reconstructed', llmModel: 'some-model' },
      trust: { class: 'derived', reasons: ['reconstructed'] },
    },
    { p: 'export', as: 'web', derived: { kind: 'export' }, trust: MODELLED },
  ];

  it('stores the class on the uploaded revision and accepts or proposes the unique call', async () => {
    for (const v of variants) {
      await project(v.p);
      const file = caller(v.engineless);
      const manifest = v.derived
        ? manifestOf([{ path: file.path, key: AUFTRAG_KEY, derived: v.derived }])
        : undefined;
      const result = await importAs(v.p, v.as, [file, callee], manifest);
      const [own] = result.files;
      // Present only for a derived file, so other results keep their shape.
      expect(own?.trust, v.p).toEqual(v.trust.class === 'derived' ? v.trust : undefined);
      const [rev] = await revisions(v.p, AUFTRAG_KEY);
      expect(rev?.source.trust, v.p).toEqual(v.trust);
      const model = (await models(v.p)).find((m) => m.key === AUFTRAG_KEY);
      expect(model?.trust, v.p).toEqual({
        ...v.trust,
        derivedKind: (v.derived?.['kind'] as string | undefined) ?? null,
        converter: (v.derived?.['converter'] as string | undefined) ?? null,
      });
      const r = await relationOf(v.p, CALL, PROCESS_RECHNUNG);
      if (v.trust.class === 'modelled') {
        expect(r, v.p).toMatchObject({ status: 'accepted', tier: 'rule', confidence: 1 });
        expect(r?.attrs['match'], v.p).toBeUndefined();
        expect(await ruleStance(v.p, r!)).toMatchObject({ kind: 'decision', rationale: null });
      } else {
        expect(r, v.p).toMatchObject({
          status: 'proposed',
          tier: 'key',
          confidence: 0.9,
          attrs: { calledElement: 'Process_Rechnung', match: 'derived-caller' },
        });
        expect(await ruleStance(v.p, r!), v.p).toMatchObject({
          kind: 'proposal',
          tier: 'key',
          confidence: 0.9,
          rationale: trustRationale(v.trust.reasons as never),
        });
      }
    }
  });

  it('finds the same whatever the class', async () => {
    const reference = await findings('web');
    expect(reference.length).toBeGreaterThan(0);
    for (const v of variants) expect(await findings(v.p), v.p).toEqual(reference);
  });

  it('counts the derived proposals on the system rule', async () => {
    const list = await getJson<{ system: { accepted: number; proposed: number } }>(
      '/api/v1/projects/agent/auto-accept-rules',
    );
    expect(list.system).toMatchObject({ accepted: 0, proposed: 1 });
    const web = await getJson<{ system: { accepted: number; proposed: number } }>(
      '/api/v1/projects/web/auto-accept-rules',
    );
    expect(web.system).toMatchObject({ accepted: 1, proposed: 0 });
  });

  it('classifies a Camunda 8 export as modelled', async () => {
    await project('c8');
    const path = `${AUFTRAG_KEY}.bpmn`;
    await importAs(
      'c8',
      'web',
      [{ path, bytes: c8Caller }, callee],
      manifestOf([{ path, key: AUFTRAG_KEY, derived: { kind: 'export' } }]),
    );
    expect((await revisions('c8', AUFTRAG_KEY))[0]?.source.trust).toEqual(MODELLED);
    expect(await relationOf('c8', CALL, PROCESS_RECHNUNG)).toMatchObject({ status: 'accepted' });
  });

  it('never stores a declared trust', async () => {
    await project('declared');
    const file = caller(true);
    const result = await importAs(
      'declared',
      'web',
      [file, callee],
      manifestOf([{ path: file.path, key: AUFTRAG_KEY, trust: MODELLED }]),
    );
    expect(result.files[0]?.trust).toEqual(NO_ENGINE);
    expect((await revisions('declared', AUFTRAG_KEY))[0]?.source.trust).toEqual(NO_ENGINE);
  });

  it('keeps the class of unchanged bytes and warns trust-kept', async () => {
    // A modelled model: the same bytes with an agent token stay modelled.
    const byAgent = await importAs('web', 'agent', [caller()]);
    expect(byAgent.files[0]).toMatchObject({ outcome: 'unchanged' });
    expect(byAgent.files[0]?.trust).toBeUndefined();
    expect(byAgent.files[0]?.importWarnings).toEqual([
      {
        code: 'trust-kept',
        message:
          "unchanged, so analyzr keeps the model's trust class modelled; this request would make " +
          'it derived (agent-upload); a reclassification needs changed bytes',
      },
    ]);
    expect((await relationOf('web', CALL, PROCESS_RECHNUNG))?.status).toBe('accepted');
    // A derived model: the owner's import of the same bytes keeps it derived.
    const byOwner = await importAs('agent', 'web', [caller()]);
    expect(byOwner.files[0]).toMatchObject({
      outcome: 'unchanged',
      trust: { class: 'derived', reasons: ['agent-upload'] },
      importWarnings: [expect.objectContaining({ code: 'trust-kept' })],
    });
    // The same credential warns nothing.
    expect((await importAs('agent', 'agent', [caller()])).files[0]?.importWarnings).toBeUndefined();
    // The PUT says it too.
    const put = await call(
      'web',
      'agent',
      `/api/v1/projects/web/models/by-key/${encodeURIComponent(AUFTRAG_KEY)}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/xml' },
        body: caller().bytes,
      },
    );
    expect(put.status).toBe(200);
    const putResult = PutModelResult.parse(await put.json());
    expect(putResult.importWarnings?.map((w) => w.code)).toEqual(['trust-kept']);
    expect(putResult.model.trust).toMatchObject(MODELLED);
  });

  it('classifies the Signavio golden bundle as derived and proposes „Rechnung stellen“', async () => {
    await project('signavio');
    const text = await readFile(join(BUNDLE, 'analyzr-import.json'), 'utf8');
    const manifest = JSON.parse(text) as ImportManifest;
    const files = await Promise.all(
      manifest.files.map(async (f) => ({
        path: f.path,
        bytes: new Uint8Array(await readFile(join(BUNDLE, f.path))),
      })),
    );
    const dry = await importAs('signavio', 'web', files, manifest, true);
    const result = await importAs('signavio', 'web', files, manifest);
    expect(dry.files).toEqual(result.files);
    expect(result.files.every((f) => f.trust?.class === 'derived')).toBe(true);
    const rechnungStellen = (await relations('signavio')).filter(
      (r) => r.type === 'call' && r.attrs['match'] === 'derived-caller',
    );
    expect(rechnungStellen).toHaveLength(1);
    expect(rechnungStellen[0]).toMatchObject({
      from: expect.stringMatching(/^vertrieb\/auftragsabwicklung#/) as unknown,
      status: 'proposed',
      tier: 'key',
      confidence: 0.9,
    });
    expect(dry.impact?.callsProposed.items).toEqual([
      {
        type: 'call',
        from: rechnungStellen[0]?.from,
        to: rechnungStellen[0]?.to,
        wasAccepted: false,
      },
    ]);
    expect(dry.impact?.acceptedCalls.count).toBe(0);
    expect(dry.impact?.files.map((f) => f.trust.reasons.includes('no-engine')).every(Boolean)).toBe(
      true,
    );
  });
});

describe('a call target set in analyzr (decision 25.2)', () => {
  const P = 'amend';
  const API = `/api/v1/projects/${P}`;
  let modelId = '';

  const headRev = async () =>
    (await getJson<{ headRev: number }>(`${API}/models/${modelId}`)).headRev;

  async function amend(dryRun: boolean): Promise<AmendModelResult> {
    const res = await t.asOwner(
      `${API}/models/${modelId}/amendments${dryRun ? '?dryRun=true' : ''}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'if-match': `"r${await headRev()}"` },
        body: JSON.stringify({
          items: [{ elementId: 'Call_Rechnung', op: 'call-target', target: PROCESS_RECHNUNG }],
        }),
      },
    );
    const text = await res.text();
    expect(res.status, text.slice(0, 800)).toBe(dryRun ? 200 : 201);
    return AmendModelResult.parse(JSON.parse(text));
  }

  async function put(xml: string): Promise<PutModelResult> {
    const res = await t.putModel(P, AUFTRAG_KEY, xml);
    const text = await res.text();
    expect(res.status, text.slice(0, 800)).toBeLessThan(300);
    return PutModelResult.parse(JSON.parse(text));
  }

  beforeAll(async () => {
    await t.createProject(P);
    // An engine-less caller without a target for Call_Rechnung and a unique Call_Versand.
    modelId = (await put(auftrag({ engineless: true }))).model.id;
    for (const [key, xml] of [
      [RECHNUNG_KEY, rechnung()],
      [VERSAND_ALT_KEY, versandAlt],
    ] as const) {
      expect((await t.putModel(P, key, xml)).status).toBe(201);
    }
  });

  it('accepts that call, keeps the model’s other call proposed and retires the manual link', async () => {
    expect(await relationOf(P, CALL_VERSAND, PROCESS_VERSAND_ALT)).toMatchObject({
      status: 'proposed',
      tier: 'key',
    });
    // A human linked the call first.
    const questions = await getJson<{ items: { id: string; subject: { id: string } }[] }>(
      `${API}/open-questions?limit=200`,
    );
    const question = questions.items.find((q) => q.subject.id === CALL);
    const linked = await post(
      (path, init) => t.asOwner(path, init),
      `${API}/open-questions/${question?.id}/actions`,
      {
        type: 'link',
        targets: [PROCESS_RECHNUNG],
      },
    );
    expect(linked.status, await linked.clone().text()).toBe(201);

    const dry = await amend(true);
    const before = await relations(P);
    const written = await amend(false);
    const after = await relations(P);
    expect(dry.effect).toEqual(written.effect);
    expect(written.effect.accepted).toEqual([
      { relation: null, type: 'call', from: CALL, to: PROCESS_RECHNUNG },
    ]);
    expect(written.effect.retired.map((r) => r.from)).toEqual([CALL]);
    // The effect, computed before writing, predicts what the recompute then wrote: the
    // relations that became accepted (not the caller's other call), the new rule proposals,
    // and no other change of status than those, the retired links and the withdrawn stances.
    const key = (r: { type: string; from: string; to: string }) => `${r.type} ${r.from} ${r.to}`;
    const was = new Map(before.map((r) => [key(r), r.status]));
    const keys = (list: readonly { type: string; from: string; to: string }[]) =>
      list.map(key).sort();
    expect(
      keys(after.filter((r) => r.status === 'accepted' && was.get(key(r)) !== 'accepted')),
    ).toEqual(keys(written.effect.accepted));
    expect(keys(after.filter((r) => !was.has(key(r)) && r.status === 'proposed'))).toEqual(
      keys(written.effect.proposed),
    );
    const { accepted, proposed, retired, withdrawn } = written.effect;
    const explained = new Set(keys([...accepted, ...proposed, ...retired, ...withdrawn]));
    expect(
      after.filter((r) => was.get(key(r)) !== r.status && !explained.has(key(r))).map(key),
    ).toEqual([]);
    expect(await relationOf(P, CALL, PROCESS_RECHNUNG)).toMatchObject({
      status: 'accepted',
      tier: 'rule',
    });
    expect(await relationOf(P, CALL_VERSAND, PROCESS_VERSAND_ALT)).toMatchObject({
      status: 'proposed',
      tier: 'key',
    });
    const manual = (await relations(P)).find((r) => r.type === 'manual' && r.from === CALL);
    expect(manual?.status).toBe('rejected');
    // The amended head reads its upstream's class.
    expect(written.model.trust).toMatchObject(NO_ENGINE);
    expect(written.revision?.source.trust).toBeUndefined();
  });

  it('keeps it accepted through a re-import, also once the source tool has the value (in-source)', async () => {
    const changed = await put(auftrag({ engineless: true, taskName: 'Auftrag genau prüfen' }));
    expect(changed.amendments?.applied.count).toBe(1);
    expect((await relationOf(P, CALL, PROCESS_RECHNUNG))?.status).toBe('accepted');

    const taken = await put(
      auftrag({
        engineless: true,
        taskName: 'Auftrag sehr genau prüfen',
        callRechnung: 'Process_Rechnung',
      }),
    );
    expect(taken.amendments?.inSource.count).toBe(1);
    // The uploaded revision is the head again, derived, its plan naming the call in-source.
    expect(taken.revision.source).toMatchObject({ kind: 'upload', trust: NO_ENGINE });
    expect((await relationOf(P, CALL, PROCESS_RECHNUNG))?.status).toBe('accepted');
    expect((await relationOf(P, CALL_VERSAND, PROCESS_VERSAND_ALT))?.status).toBe('proposed');
  });

  it('brings the proposal back when the amendment is withdrawn', async () => {
    const list = await getJson<{ items: { id: string; state: string }[] }>(`${API}/amendments`);
    const live = list.items.filter((a) => a.state !== 'withdrawn');
    expect(live).toHaveLength(1);
    const res = await post(
      (path, init) => t.asOwner(path, init),
      `${API}/amendments/${live[0]?.id}/withdrawal`,
      {},
    );
    expect(res.status, await res.clone().text()).toBe(201);
    WithdrawAmendmentsResult.parse(await res.json());
    expect(await relationOf(P, CALL, PROCESS_RECHNUNG)).toMatchObject({
      status: 'proposed',
      tier: 'key',
      confidence: 0.9,
    });
  });
});

describe('revisions stored before the trust rule (decision 24.2 (a))', () => {
  const P = 'legacy';

  it('count as modelled: their acceptances stay through unrelated ingests', async () => {
    await project(P);
    await importAs(P, 'web', [caller(true), callee]);
    expect((await relationOf(P, CALL, PROCESS_RECHNUNG))?.status).toBe('proposed');
    // As stored before S2c: no class on the revision.
    await database.db.execute(
      sql`UPDATE model_revision SET source = source - 'trust'
          WHERE project_id = (SELECT id FROM project WHERE key = ${P})`,
    );
    expect((await models(P)).every((m) => m.trust === null)).toBe(true);
    // The next ingest recomputes: the legacy caller counts as modelled.
    await importAs(P, 'web', [{ path: 'lager/a.bpmn', bytes: versandAlt }]);
    const accepted = await relationOf(P, CALL, PROCESS_RECHNUNG);
    expect(accepted).toMatchObject({ status: 'accepted', tier: 'rule' });
    await importAs(P, 'agent', [
      { path: 'lager/b.bpmn', bytes: versandAlt.replaceAll('Alt', 'B') },
    ]);
    expect(await relationOf(P, CALL, PROCESS_RECHNUNG)).toMatchObject({
      status: 'accepted',
      version: accepted?.version,
    });
  });
});

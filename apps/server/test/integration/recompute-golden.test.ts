/**
 * The project recompute keeps its behaviour across its split into a pure
 * planner and its writer (M6 §3.5, slice S2b): a seeded history through the
 * real server and the real libraries (the `nordwind-handel` corpus imported,
 * human decisions, a changed call target, a model deleted and revived, an
 * unchanged re-import) leaves the same relations, assertions, events and
 * findings as before the split. The digest was computed on the code before
 * it; ids and timestamps are normalized (ids by first appearance), so only
 * behaviour counts. `GOLDEN_DUMP=<file>` writes the normalized end state, to
 * compare two runs. Since M6 S2c every uploaded revision carries its trust
 * class in `source.trust`, which the `model.revised` events repeat: it is
 * taken out before hashing and checked on its own (the corpus is Camunda,
 * imported by the owner, so every revision is modelled and the recompute
 * behaves as before).
 */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type { Model, ModelPage, Relation, RelationPage } from '@analyzr/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { libraryAnalysis } from '../../src/analysis.ts';
import { startTestApp, type TestApp } from '../support/app.ts';
import { corpusFiles, importAll } from '../support/corpus.ts';
import { createTestDatabase, type TestDatabase } from '../support/db.ts';

/** The digest of the seeded history's end state on the code before the split. */
const GOLDEN = 'a83c10ba06fdda59821bbda646cced5448c01f60ccf009c7a70928fdf6c1795d';

let database: TestDatabase;
let t: TestApp;
const P = 'golden';

beforeAll(async () => {
  database = await createTestDatabase();
  t = startTestApp(database, { analysis: libraryAnalysis });
  await t.createProject(P);
});

afterAll(async () => {
  await database.drop();
});

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await t.asOwner(path, init);
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const relations = async (): Promise<Relation[]> =>
  (await json<RelationPage>(`/api/v1/projects/${P}/relations?limit=200`)).items;
const models = async (): Promise<Model[]> =>
  (await json<ModelPage>(`/api/v1/projects/${P}/models?limit=200`)).items;

function decide(relation: Relation, body: Record<string, unknown>) {
  return json(`/api/v1/projects/${P}/relations/${relation.id}/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function put(key: string, bytes: Uint8Array | string) {
  return t.asOwner(`/api/v1/projects/${P}/models/by-key/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/xml' },
    body: bytes,
  });
}

const ULID = /^[a-z]{3}_[0-9A-HJKMNP-TV-Z]{26}$/;
const VOLATILE = /(^at$|_at$|At$)/;

/** Ids replaced by their first appearance, timestamps dropped, keys sorted. */
function normalizer() {
  const ids = new Map<string, string>();
  const norm = (value: unknown): unknown => {
    if (typeof value === 'string') {
      if (!ULID.test(value)) return value;
      let id = ids.get(value);
      if (id === undefined) {
        id = `${value.slice(0, 3)}#${ids.size}`;
        ids.set(value, id);
      }
      return id;
    }
    if (Array.isArray(value)) return value.map(norm);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([k]) => !VOLATILE.test(k))
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([k, v]) => [k, norm(v)]),
      );
    }
    return value;
  };
  return norm;
}

async function rows(query: ReturnType<typeof sql>): Promise<unknown[]> {
  return (await database.db.execute<{ r: unknown }>(query)).rows.map((x) => x.r);
}

/** `payload.source.trust` of a `model.revised` event, taken out of the event (M6 S2c). */
function withoutTrust(event: unknown, trusts: unknown[]): unknown {
  const e = event as { type?: string; payload?: { source?: Record<string, unknown> } };
  if (e.type !== 'model.revised' || !e.payload?.source) return event;
  const { trust, ...source } = e.payload.source;
  trusts.push(trust);
  return { ...e, payload: { ...e.payload, source } };
}

/** The project's relations, assertions, events and findings, normalized; the revisions' trust apart. */
async function endState(): Promise<{ state: unknown; trusts: unknown[] }> {
  const project = sql`(select id from project where key = ${P})`;
  const norm = normalizer();
  const trusts: unknown[] = [];
  // Events first: their order gives every id its placeholder.
  const events = (
    await rows(
      sql`select row_to_json(e) as r from event e where e.project_id = ${project} order by e.seq`,
    )
  ).map((e) => withoutTrust(e, trusts));
  const assertions = await rows(
    sql`select row_to_json(a) as r from relation_assertion a where a.project_id = ${project} order by a.seq`,
  );
  const rels = await rows(
    sql`select row_to_json(x) as r from relation x where x.project_id = ${project} order by x.type, x.from_ref, x.to_ref`,
  );
  const findings = await rows(
    sql`select row_to_json(f) as r from finding f where f.project_id = ${project} order by f.kind, f.refs::text`,
  );
  return { state: norm({ events, assertions, relations: rels, findings }), trusts };
}

describe('recompute over a seeded history (golden digest)', () => {
  it('leaves the same relations, assertions, events and findings', async () => {
    const files = await corpusFiles('nordwind-handel');
    const imported = await importAll((path, init) => t.asOwner(path, init), P, files);
    expect(imported.every((f) => f.outcome === 'created')).toBe(true);

    // Human decisions: reject a rule-accepted call, accept and hold key-tier proposals.
    const first = await relations();
    const call = first.find((r) => r.type === 'call' && r.status === 'accepted');
    const proposals = first.filter((r) => r.status === 'proposed');
    if (!call || proposals.length < 2) throw new Error('the corpus lacks a call or proposals');
    await decide(call, { verdict: 'reject', reason: 'Gehört nicht zusammen.' });
    await decide(proposals[0]!, { verdict: 'accept' });
    await decide(proposals[1]!, { verdict: 'hold', note: 'Fachbereich fragen.' });

    // A changed call target: the rule withdraws one relation and derives another.
    const caller = files.find((f) => f.key === 'finanzen/forderungsmanagement');
    if (!caller) throw new Error('finanzen/forderungsmanagement missing');
    const changed = new TextDecoder()
      .decode(caller.bytes)
      .replace(/calledElement="[^"]+"/, 'calledElement="Process_Gibt_Es_Nicht"');
    expect((await put(caller.key, changed)).status).toBe(200);

    // A model deleted and revived; an unchanged re-import changes nothing.
    const shipping = (await models()).find((m) => m.key === 'logistik/shipping');
    if (!shipping) throw new Error('logistik/shipping missing');
    expect(
      (await t.asOwner(`/api/v1/projects/${P}/models/${shipping.id}`, { method: 'DELETE' })).status,
    ).toBe(204);
    const revived = files.find((f) => f.key === 'logistik/shipping');
    if (!revived) throw new Error('logistik/shipping missing in the corpus');
    expect((await put(revived.key, revived.bytes)).status).toBe(201);
    await importAll((path, init) => t.asOwner(path, init), P, files.slice(0, 5));

    const end = await endState();
    // Every revision of the history is an owner's upload of a Camunda file: modelled.
    expect(end.trusts.length).toBeGreaterThan(0);
    expect(end.trusts.every((x) => isDeepStrictEqual(x, { class: 'modelled', reasons: [] }))).toBe(
      true,
    );
    const state = JSON.stringify(end.state, null, 1);
    if (process.env['GOLDEN_DUMP'])
      (await import('node:fs')).writeFileSync(process.env['GOLDEN_DUMP'], state);
    const digest = createHash('sha256').update(state).digest('hex');
    expect(digest).toBe(GOLDEN);
  });
});

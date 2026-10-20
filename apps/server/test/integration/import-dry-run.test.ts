/**
 * The dry runs of an import (M6 §3.5, slice S2b) with the real libraries and
 * a real PostgreSQL: `POST …/imports?dryRun=true` answers the outcomes the
 * import gives and an impact that names what it then does (rule-tier calls
 * accepted, rule proposals added, findings added; on a changed call target
 * the stance withdrawn; nothing again for an unchanged re-import), and
 * writes nothing (no event, no model); a read-only token may run it, not
 * the import. `PUT …?dryRun=true` answers the would-be outcome. The
 * deletion impact names the accepted calls a deletion turns `missing` and
 * the rule stances it withdraws, and deletes nothing. The absent keys of a
 * bundle respect its `source.scope`. With derived files (M6 S2c, the trust
 * rule) the impact names the unique calls that become proposals instead
 * (`callsProposed`, with the acceptances they end) and each file's class,
 * as the import then stores them; a read-only token's preview classifies by
 * its credential. The relations tasks (S2b follow-up): the dry run names the
 * tasks the import queues and cancels (a claimed one with its holder and
 * assignment) as the import's events then do, the pairs the queued tasks'
 * claims are then assigned (the other models' tasks done) and those judged
 * again; a layout-only re-import
 * queues nothing; the PUT dry run counts as the import's; the deletion
 * impact names the task `DELETE` cancels.
 */
import type {
  AnalysisTaskPage,
  ClaimedRelationsAnalysis,
  CreatedAgentToken,
  FindingList,
  ImportImpact,
  ImportResult,
  ModelPage,
  NoLinkList,
  Project,
  PutModelDryRunResult,
  Relation,
  RelationPage,
} from '@analyzr/contracts';
import { sql } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { libraryAnalysis } from '../../src/analysis.ts';
import { startTestApp, type TestApp } from '../support/app.ts';
import { corpusFiles, importForm, type CorpusFile } from '../support/corpus.ts';
import { createTestDatabase, type TestDatabase } from '../support/db.ts';
import { asAgent, claim, problemOf, submission, submit, submitRaw } from '../support/pipeline.ts';

let database: TestDatabase;
let t: TestApp;
let files: CorpusFile[];
const P = 'preview';

beforeAll(async () => {
  database = await createTestDatabase();
  t = startTestApp(database, { analysis: libraryAnalysis });
  await t.createProject(P);
  await t.createProject('scope');
  files = await corpusFiles('nordwind-handel');
});

afterAll(async () => {
  await database.drop();
});

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await t.asOwner(path, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text.slice(0, 400)}`);
  return JSON.parse(text) as T;
}

const lastSeq = async (p: string) => (await json<Project>(`/api/v1/projects/${p}`)).lastSeq;
const relations = async (p: string): Promise<Relation[]> =>
  (await json<RelationPage>(`/api/v1/projects/${p}/relations?limit=200`)).items;
const line = (r: { type: string; from: string; to: string }) => `${r.type} ${r.from} ${r.to}`;

function importFiles(p: string, batch: readonly CorpusFile[], dryRun: boolean, manifest?: unknown) {
  const form = importForm(batch);
  if (manifest !== undefined) form.append('manifest', JSON.stringify(manifest));
  return json<ImportResult>(`/api/v1/projects/${p}/imports${dryRun ? '?dryRun=true' : ''}`, {
    method: 'POST',
    body: form,
  });
}

const noTasks = (impact: ImportImpact) =>
  isDeepStrictEqual(impact.relationsTasks, {
    queued: { count: 0, items: [] },
    cancelled: { count: 0, items: [] },
    claimed: 0,
    pairs: 0,
    rejudged: { count: 0, items: [] },
  });

const empty = (impact: ImportImpact) =>
  [
    impact.acceptedCalls,
    impact.callsProposed,
    impact.proposalsAdded,
    impact.proposalsWithdrawn,
    impact.endpointsChanged,
    impact.findingsAdded,
    impact.findingsResolved,
  ].every((l) => l.count === 0) && noTasks(impact);

describe('POST …/imports?dryRun=true', () => {
  it('answers the outcomes and what the import then does, and writes nothing', async () => {
    const seq = await lastSeq(P);
    const preview = await importFiles(P, files, true);
    expect(await lastSeq(P)).toBe(seq);
    expect((await json<ModelPage>(`/api/v1/projects/${P}/models`)).items).toEqual([]);
    if (!preview.impact) throw new Error('no impact on a dry run');
    expect(preview.impact.files.map((f) => f.modelKey).sort()).toEqual(
      files.map((f) => f.key).sort(),
    );
    expect(preview.impact.files.every((f) => f.factsChanged)).toBe(true);

    const real = await importFiles(P, files, false);
    expect(real.impact).toBeUndefined();
    // the same outcome per file, warnings included
    expect(preview.files).toEqual(real.files);
    // what the import did is what the impact said
    const after = await relations(P);
    expect(preview.impact.acceptedCalls.items.map(line).sort()).toEqual(
      after
        .filter((r) => r.status === 'accepted')
        .map(line)
        .sort(),
    );
    expect(preview.impact.proposalsAdded.items.map(line).sort()).toEqual(
      after
        .filter((r) => r.status === 'proposed')
        .map(line)
        .sort(),
    );
    const { items: findings } = await json<FindingList>(`/api/v1/projects/${P}/findings`);
    expect(preview.impact.findingsAdded.count).toBe(findings.length);
    expect(preview.impact.findingsResolved.count).toBe(0);
  });

  it('answers nothing to do for the same files again', async () => {
    const preview = await importFiles(P, files, true);
    expect(preview.files.every((f) => f.outcome === 'unchanged')).toBe(true);
    if (!preview.impact) throw new Error('no impact');
    expect(preview.impact.files).toEqual([]);
    expect(empty(preview.impact)).toBe(true);
  });

  it('names a changed call target: the rule stance withdrawn, the finding added', async () => {
    const caller = files.find((f) => f.key === 'finanzen/forderungsmanagement');
    if (!caller) throw new Error('finanzen/forderungsmanagement missing');
    const changed = {
      ...caller,
      bytes: new TextEncoder().encode(
        new TextDecoder()
          .decode(caller.bytes)
          .replace(/calledElement="[^"]+"/, 'calledElement="Process_Gibt_Es_Nicht"'),
      ),
    };
    const before = await relations(P);
    const preview = await importFiles(P, [changed], true);
    if (!preview.impact) throw new Error('no impact');
    expect(preview.files.map((f) => f.outcome)).toEqual(['revised']);
    expect(preview.impact.files).toEqual([
      expect.objectContaining({ modelKey: caller.key, factsChanged: true }),
    ]);
    expect(preview.impact.proposalsWithdrawn.count).toBeGreaterThan(0);
    expect(preview.impact.findingsAdded.items.map((f) => f.kind)).toContain('unresolved-call');

    await importFiles(P, [changed], false);
    const after = await relations(P);
    const gone = before.filter(
      (r) =>
        r.status !== 'obsolete' &&
        !after.some((a) => line(a) === line(r) && a.status !== 'obsolete'),
    );
    // every relation that left the review was named as withdrawn
    for (const r of gone)
      expect(preview.impact.proposalsWithdrawn.items.map(line)).toContain(line(r));
  });

  it('lets a read-only token preview, not import', async () => {
    const token = await t.createToken(P, ['analyzr:read']);
    const form = () => importForm(files.slice(0, 2));
    const dry = await t.asToken(token.secret, `/api/v1/projects/${P}/imports?dryRun=true`, {
      method: 'POST',
      body: form(),
    });
    expect(dry.status, await dry.clone().text()).toBe(200);
    const write = await t.asToken(token.secret, `/api/v1/projects/${P}/imports`, {
      method: 'POST',
      body: form(),
    });
    expect(write.status).toBe(403);
  });
});

describe('with derived files (the trust rule, M6 S2c)', () => {
  /** Imports `batch` with an agent token (`analyzr:write`): every file is derived. */
  async function importAsAgent(
    p: string,
    secret: string,
    batch: readonly CorpusFile[],
    dryRun: boolean,
  ) {
    const res = await t.asToken(
      secret,
      `/api/v1/projects/${p}/imports${dryRun ? '?dryRun=true' : ''}`,
      {
        method: 'POST',
        body: importForm(batch),
      },
    );
    const text = await res.text();
    expect(res.status, text.slice(0, 400)).toBe(200);
    return JSON.parse(text) as ImportResult;
  }
  const derivedCalls = (rs: readonly Relation[]) =>
    rs.filter((r) => r.type === 'call' && r.attrs['match'] === 'derived-caller');

  it('names the unique calls that become proposals and each file’s class, as the import does', async () => {
    await t.createProject('derived');
    const writer = await t.createToken('derived', ['analyzr:read', 'analyzr:write']);
    const preview = await importAsAgent('derived', writer.secret, files, true);
    const real = await importAsAgent('derived', writer.secret, files, false);
    expect(preview.files).toEqual(real.files);
    if (!preview.impact) throw new Error('no impact');
    const agentUpload = { class: 'derived', reasons: ['agent-upload'] };
    expect(preview.impact.files.every((f) => isDeepStrictEqual(f.trust, agentUpload))).toBe(true);
    expect(real.files.every((f) => isDeepStrictEqual(f.trust, agentUpload))).toBe(true);
    const after = await relations('derived');
    expect(after.some((r) => r.status === 'accepted')).toBe(false);
    expect(preview.impact.acceptedCalls.count).toBe(0);
    expect(preview.impact.callsProposed.count).toBeGreaterThan(0);
    expect(preview.impact.callsProposed.items.every((c) => !c.wasAccepted)).toBe(true);
    expect(preview.impact.callsProposed.items.map(line).sort()).toEqual(
      derivedCalls(after).map(line).sort(),
    );
    // The totals cover every call, each under its caller's first reason.
    expect(preview.impact.callsProposed.wasAccepted).toBe(0);
    expect(preview.impact.callsProposed.byReason).toEqual([
      { reason: 'agent-upload', count: preview.impact.callsProposed.count },
    ]);
    // Together the two lists name every proposal the import made.
    expect(
      [...preview.impact.proposalsAdded.items, ...preview.impact.callsProposed.items]
        .map(line)
        .sort(),
    ).toEqual(
      after
        .filter((r) => r.status === 'proposed')
        .map(line)
        .sort(),
    );
  });

  it('names the acceptances a derived re-import ends', async () => {
    await t.createProject('demoted');
    const writer = await t.createToken('demoted', ['analyzr:read', 'analyzr:write']);
    await importFiles('demoted', files, false);
    const accepted = (await relations('demoted')).filter(
      (r) => r.type === 'call' && r.status === 'accepted',
    );
    expect(accepted.length).toBeGreaterThan(0);
    // Changed bytes (a comment), the same facts, uploaded with an agent token.
    const changed = files.map((f) => ({
      ...f,
      bytes: new TextEncoder().encode(`${new TextDecoder().decode(f.bytes)}<!-- again -->\n`),
    }));
    const preview = await importAsAgent('demoted', writer.secret, changed, true);
    if (!preview.impact) throw new Error('no impact');
    expect(preview.impact.callsProposed.items.map((c) => [line(c), c.wasAccepted]).sort()).toEqual(
      accepted.map((r) => [line(r), true]).sort(),
    );
    expect(preview.impact.callsProposed.wasAccepted).toBe(accepted.length);
    await importAsAgent('demoted', writer.secret, changed, false);
    const after = await relations('demoted');
    for (const r of accepted) {
      expect(after.find((a) => line(a) === line(r))).toMatchObject({
        status: 'proposed',
        tier: 'key',
      });
    }
  });

  it('classifies a read-only token’s preview by its credential', async () => {
    await t.createProject('readonly');
    const token = await t.createToken('readonly', ['analyzr:read']);
    const preview = await importAsAgent('readonly', token.secret, files.slice(0, 3), true);
    expect(preview.impact?.files.map((f) => f.trust.reasons)).toEqual(
      files.slice(0, 3).map(() => ['agent-upload']),
    );
  });
});

describe('PUT …?dryRun=true and the deletion impact', () => {
  it('answers the would-be outcome of a PUT with 200, creating nothing', async () => {
    const file = files[0]!;
    const res = await t.asOwner(`/api/v1/projects/scope/models/by-key/neu%2Fmodell?dryRun=true`, {
      method: 'PUT',
      headers: { 'content-type': 'application/xml' },
      body: file.bytes,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PutModelDryRunResult;
    expect(body).toMatchObject({ outcome: 'created', modelKey: 'neu/modell', dryRun: true });
    expect(body.impact.files.map((f) => f.modelKey)).toEqual(['neu/modell']);
    expect((await json<ModelPage>('/api/v1/projects/scope/models')).items).toEqual([]);
  });

  it('names the accepted calls a deletion turns missing, and deletes nothing', async () => {
    const shipping = (await json<ModelPage>(`/api/v1/projects/${P}/models?limit=200`)).items.find(
      (m) => m.key === 'logistik/shipping',
    );
    if (!shipping) throw new Error('logistik/shipping missing');
    const seq = await lastSeq(P);
    const impact = await json<ImportImpact>(
      `/api/v1/projects/${P}/models/${shipping.id}/deletion-impact`,
    );
    expect(await lastSeq(P)).toBe(seq);
    const before = await relations(P);
    const touching = before.filter(
      (r) => r.from.startsWith('logistik/shipping#') || r.to.startsWith('logistik/shipping#'),
    );
    expect(impact.endpointsChanged.items.map((r) => [line(r), r.endpointState]).sort()).toEqual(
      touching
        .filter((r) => r.status === 'accepted')
        .map((r) => [line(r), 'missing'])
        .sort(),
    );
    expect(impact.proposalsWithdrawn.count).toBe(
      touching.filter((r) => r.status === 'proposed').length,
    );
    expect(impact.files).toEqual([]);
    expect(impact.absentKeys.count).toBe(0);

    // the deletion does what the impact said
    expect(
      (await t.asOwner(`/api/v1/projects/${P}/models/${shipping.id}`, { method: 'DELETE' })).status,
    ).toBe(204);
    const after = await relations(P);
    for (const r of impact.endpointsChanged.items) {
      expect(after.find((a) => line(a) === line(r))?.endpointState).toBe('missing');
    }
  });
});

describe('absent keys of a bundle', () => {
  const bpmn = (id: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="http://example.org/bpmn" id="D_${id}">
  <bpmn:process id="Process_${id}" name="${id}" isExecutable="false">
    <bpmn:startEvent id="S_${id}"/>
  </bpmn:process>
</bpmn:definitions>
`;
  const file = (path: string) => ({
    path,
    key: path.replace(/\.bpmn$/, ''),
    bytes: new TextEncoder().encode(bpmn(path.replace(/\W/g, '_'))),
  });

  it('lists the live keys of the system the bundle does not name, within its scope', async () => {
    const first = [file('finanzen/a.bpmn'), file('finanzen/b.bpmn'), file('lager/c.bpmn')];
    await importFiles('scope', first, false, {
      format: 'analyzr-import/1',
      source: { system: 'signavio' },
      files: [
        { path: 'finanzen/a.bpmn', externalPath: 'Finanzen/A' },
        { path: 'finanzen/b.bpmn', externalPath: 'Finanzen/B' },
        { path: 'lager/c.bpmn', externalPath: 'Lager/C' },
      ],
    });
    // a partial export of „Finanzen“ naming only a: b is absent, c lies outside the scope
    const preview = await importFiles('scope', [file('finanzen/a.bpmn')], true, {
      format: 'analyzr-import/1',
      source: { system: 'signavio', scope: ['Finanzen'] },
      files: [{ path: 'finanzen/a.bpmn', externalPath: 'Finanzen/A' }],
    });
    expect(preview.impact?.absentKeys).toEqual({ count: 1, items: ['finanzen/b'] });
    // without a scope, the whole system
    const whole = await importFiles('scope', [file('finanzen/a.bpmn')], true, {
      format: 'analyzr-import/1',
      source: { system: 'signavio' },
      files: [{ path: 'finanzen/a.bpmn', externalPath: 'Finanzen/A' }],
    });
    expect(whole.impact?.absentKeys.items).toEqual(['finanzen/b', 'lager/c']);
    // without a manifest no system to compare: none
    const plain = await importFiles('scope', [file('finanzen/a.bpmn')], true);
    expect(plain.impact?.absentKeys.count).toBe(0);
  });
});

describe('the relations tasks of a dry run (S2b follow-up)', () => {
  const T = 'tasks';
  const A = 'finanzen/rechnungsstellung';
  const B = 'finanzen/mahnwesen';
  const C = 'finanzen/zahlungseingang';
  const D = 'finanzen/gutschrift';
  // A has key-tier and lexical partners among them (pairs its claim is assigned).
  const KEYS = [
    A,
    B,
    C,
    D,
    'finanzen/e-rechnung-versand',
    'finanzen/forderungsmanagement',
    'finanzen/monatsabschluss',
  ];
  let subset: CorpusFile[];
  let first: CreatedAgentToken;
  let second: CreatedAgentToken;
  /** B's task, claimed by the second agent and held. */
  let held: ClaimedRelationsAnalysis;

  const fileOf = (key: string): CorpusFile => {
    const f = subset.find((x) => x.key === key);
    if (!f) throw new Error(`${key} missing`);
    return f;
  };
  /** The end event each test renames: a new label, new facts. */
  const LABELS = new Map<string, [string, string]>([
    [A, ['Rechnung gestellt', 'Rechnung gestellt (neu)']],
    [B, ['Kunde gesperrt', 'Kunde gesperrt (neu)']],
    [C, ['Kontoauszug verarbeitet', 'Kontoauszug verarbeitet (neu)']],
    [D, ['Gutschrift erstellt', 'Gutschrift erstellt (neu)']],
  ]);
  /** The file with its label renamed, with a comment as well (`layout`: the same facts again). */
  const relabelled = (key: string, layout = false): CorpusFile => {
    const f = fileOf(key);
    const [label, renamed] = LABELS.get(key) ?? ['', ''];
    const text = new TextDecoder().decode(f.bytes);
    const next = text.replace(`name="${label}"`, `name="${renamed}"`);
    if (next === text) throw new Error(`${key}: nothing renamed`);
    return { ...f, bytes: new TextEncoder().encode(layout ? `${next}<!-- layout -->\n` : next) };
  };
  const keyOf = (p: { type: string; from: string; to: string }) => `${p.type} ${p.from} ${p.to}`;

  async function assignmentOf(taskId: string): Promise<string[]> {
    const r = await database.db.execute(
      sql`SELECT assignment FROM analysis_task WHERE id = ${taskId}`,
    );
    const [row] = r.rows as { assignment: { type: string; from: string; to: string }[] | null }[];
    return (row?.assignment ?? []).map(keyOf).sort();
  }

  /** The `analysis.*` events of the project after `seq`, with their model. */
  async function analysisEvents(afterSeq: number): Promise<{ type: string; modelKey: unknown }[]> {
    const r = await database.db.execute(
      sql`SELECT e.type, e.payload FROM event e JOIN project p ON p.id = e.project_id
          WHERE p.key = ${T} AND e.seq > ${afterSeq} AND e.type LIKE 'analysis.%' ORDER BY e.seq`,
    );
    return (r.rows as { type: string; payload: Record<string, unknown> }[]).map((e) => ({
      type: e.type,
      modelKey: e.payload['modelKey'],
    }));
  }

  beforeAll(async () => {
    await t.createProject(T);
    subset = files.filter((f) => KEYS.includes(f.key));
    expect(subset).toHaveLength(KEYS.length);
    await importFiles(T, subset, false);
    first = await t.createToken(T, ['analyzr:read', 'analyzr:propose']);
    second = await t.createToken(T, ['analyzr:read', 'analyzr:propose']);
    const agent = asAgent(t, first.secret);
    // The first agent finishes the others without a verdict, then judges A's pairs (a no-link
    // on every candidate): with the partners' tasks done, A's claim is assigned its pairs.
    for (const key of [...KEYS.filter((k) => k !== A && k !== B), A]) {
      const [task] = await claim(agent, { projectId: T, modelKey: key });
      if (!task) throw new Error(`no task for ${key}`);
      const noLinks =
        key === A
          ? task.input.candidates.map(([type, from, to]) => ({
              type,
              from,
              to,
              reason: 'no-evidence: nicht verbunden',
            }))
          : [];
      await submit(agent, task.taskId, { ...submission(task, []), noLinks });
    }
    // The second agent holds B's claim.
    const [task] = await claim(asAgent(t, second.secret), { projectId: T, modelKey: B });
    if (!task) throw new Error('no task for B');
    held = task;
  });

  it('names the tasks queued and cancelled and the pairs to judge, as the import then does', async () => {
    const changed = [relabelled(A), relabelled(B)];
    const seq = await lastSeq(T);
    const preview = await importFiles(T, changed, true);
    expect(await lastSeq(T)).toBe(seq);
    if (!preview.impact) throw new Error('no impact');
    const tasks = preview.impact.relationsTasks;
    expect(tasks.queued).toEqual({ count: 2, items: [B, A] });
    const [holder] = (
      await json<AnalysisTaskPage>(`/api/v1/projects/${T}/analyses?state=claimed&modelKey=${B}`)
    ).items;
    expect(holder?.claimedBy).toEqual(expect.any(String));
    expect(tasks.cancelled).toEqual({
      count: 1,
      items: [
        {
          modelKey: B,
          state: 'claimed',
          claimedBy: holder?.claimedBy,
          assigned: (await assignmentOf(held.taskId)).length,
        },
      ],
    });
    expect(tasks.claimed).toBe(1);
    expect(tasks.pairs).toBeGreaterThan(0);
    expect(tasks.rejudged.count).toBeGreaterThan(0);
    expect(tasks.rejudged.count).toBe(tasks.rejudged.items.length);
    const judgedBefore = new Set(
      (await json<NoLinkList>(`/api/v1/projects/${T}/no-links`)).items.map(keyOf),
    );

    // The import queues and cancels what the dry run named.
    await importFiles(T, changed, false);
    const events = await analysisEvents(seq);
    expect(
      events
        .filter((e) => e.type === 'analysis.queued')
        .map((e) => e.modelKey)
        .sort(),
    ).toEqual(tasks.queued.items);
    expect(events.filter((e) => e.type === 'analysis.cancelled').map((e) => e.modelKey)).toEqual(
      tasks.cancelled.items.map((c) => c.modelKey),
    );
    // B's agent loses its work.
    const late = await submitRaw(asAgent(t, second.secret), held.taskId, submission(held, []));
    expect(late.status).toBe(409);
    expect((await problemOf(late)).code).toBe('task-cancelled');
    // Claiming every queued task assigns exactly the pairs; the judged ones are those named.
    const agent = asAgent(t, first.secret);
    const claimed = await claim(agent, { projectId: T, max: 5 });
    expect(claimed.map((c) => c.modelKey).sort()).toEqual(tasks.queued.items);
    const union = new Set((await Promise.all(claimed.map((c) => assignmentOf(c.taskId)))).flat());
    expect(union.size).toBe(tasks.pairs);
    expect([...union].filter((k) => judgedBefore.has(k)).sort()).toEqual(
      tasks.rejudged.items.map(keyOf).sort(),
    );
    for (const c of claimed) await submit(agent, c.taskId, submission(c, []));
  });

  it('queues nothing for a layout-only re-import, as the import does', async () => {
    // A's head is the relabelled file: the same with a comment only changes the layout.
    const layout = relabelled(A, true);
    const seq = await lastSeq(T);
    const preview = await importFiles(T, [layout], true);
    if (!preview.impact) throw new Error('no impact');
    expect(preview.files.map((f) => f.outcome)).toEqual(['revised']);
    expect(noTasks(preview.impact)).toBe(true);
    await importFiles(T, [layout], false);
    expect(await analysisEvents(seq)).toEqual([]);
  });

  it('counts a PUT’s dry run as the import’s', async () => {
    const changed = relabelled(D);
    const preview = await importFiles(T, [changed], true);
    const res = await t.asOwner(
      `/api/v1/projects/${T}/models/by-key/${encodeURIComponent(D)}?dryRun=true`,
      { method: 'PUT', headers: { 'content-type': 'application/xml' }, body: changed.bytes },
    );
    expect(res.status).toBe(200);
    const put = (await res.json()) as PutModelDryRunResult;
    expect(put.impact.relationsTasks).toEqual(preview.impact?.relationsTasks);
    expect(put.impact.relationsTasks.queued.items).toEqual([D]);
    expect(put.impact.relationsTasks.cancelled.count).toBe(0);
  });

  it('names the open task a deletion cancels, and DELETE cancels exactly that one', async () => {
    // C gets a new head, and the second agent claims its task.
    await importFiles(T, [relabelled(C)], false);
    const [task] = await claim(asAgent(t, second.secret), { projectId: T, modelKey: C });
    if (!task) throw new Error('no task for C');
    const [holder] = (
      await json<AnalysisTaskPage>(`/api/v1/projects/${T}/analyses?state=claimed&modelKey=${C}`)
    ).items;
    const seq = await lastSeq(T);
    const impact = await json<ImportImpact>(
      `/api/v1/projects/${T}/models/${task.modelId}/deletion-impact`,
    );
    expect(await lastSeq(T)).toBe(seq);
    expect(impact.relationsTasks).toEqual({
      queued: { count: 0, items: [] },
      cancelled: {
        count: 1,
        items: [
          {
            modelKey: C,
            state: 'claimed',
            claimedBy: holder?.claimedBy,
            assigned: (await assignmentOf(task.taskId)).length,
          },
        ],
      },
      claimed: 1,
      pairs: 0,
      rejudged: { count: 0, items: [] },
    });
    const res = await t.asOwner(`/api/v1/projects/${T}/models/${task.modelId}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(204);
    expect(await analysisEvents(seq)).toEqual([{ type: 'analysis.cancelled', modelKey: C }]);
  });
});

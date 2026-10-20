/**
 * The size of the agents' next run (`ProjectSummary.pairsToJudge`, M6 S2b
 * follow-up step 3b) with the real libraries and a real PostgreSQL, on
 * `nordwind-handel`: after a first import (every model waits)
 * the count equals the union of what the waiting tasks' claims are then
 * assigned, a pair between two waiting models once, and the tasks an agent
 * holds count not; after a re-import of three done models, one of them
 * claimed by another agent, a requeue of a fourth with the same facts and a
 * human's acceptance of a proposal,
 * it equals the union of the other waiting tasks' claims, without the pairs
 * the held claim was assigned, the pairs with a current judgement and the
 * settled ones, while the pairs with the done models whose judgements the
 * re-import made stale come from the waiting models' own candidates; a claim
 * whose lease ran out holds nothing and its task counts again (the memo holds
 * until that lease ends, without an event), so the count equals the union of
 * the next run, that task's claim included; the summary's memo builds it
 * again after an import, with one candidate pass per build.
 */
import type {
  ClaimedRelationsAnalysis,
  CreatedAgentToken,
  Landscape,
  NoLinkList,
  ProjectSummary,
  TypedPair,
} from '@analyzr/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { libraryAnalysis } from '../../src/analysis.ts';
import { placementsProcedure, relationsProcedure } from '../../src/app.ts';
import { createStore } from '../../src/db/store.ts';
import type { AnalysisPort, Store } from '../../src/domain/ports.ts';
import { CandidateCache } from '../../src/domain/use-cases/open-questions.ts';
import { projectUseCases } from '../../src/domain/use-cases/projects.ts';
import { startTestApp, type TestApp } from '../support/app.ts';
import { corpusFiles, importForm, type CorpusFile } from '../support/corpus.ts';
import { createTestDatabase, type TestDatabase } from '../support/db.ts';
import { asAgent, claim, submission, submit, type Caller } from '../support/pipeline.ts';

let database: TestDatabase;
let t: TestApp;
let files: CorpusFile[];
let first: CreatedAgentToken;
let second: CreatedAgentToken;

const P = 'pairs';
const A = 'finanzen/rechnungsstellung';
const B = 'finanzen/mahnwesen';
const C = 'finanzen/zahlungseingang';
const D = 'finanzen/gutschrift';
let KEYS: string[] = [];
/** The end event each re-import renames: a new label, new facts. */
const LABELS = new Map<string, [string, string]>([
  [A, ['Rechnung gestellt', 'Rechnung gestellt (neu)']],
  [B, ['Kunde gesperrt', 'Kunde gesperrt (neu)']],
  [C, ['Kontoauszug verarbeitet', 'Kontoauszug verarbeitet (neu)']],
]);

const keyOf = (p: { type: string; from: string; to: string }) => `${p.type} ${p.from} ${p.to}`;
const modelOf = (ref: string) => ref.split('#')[0] ?? '';

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await t.asOwner(path, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text.slice(0, 400)}`);
  return JSON.parse(text) as T;
}

const pairsToJudge = async () =>
  (await json<ProjectSummary>(`/api/v1/projects/${P}/summary`)).pairsToJudge;

async function importFiles(batch: readonly CorpusFile[]): Promise<void> {
  await json(`/api/v1/projects/${P}/imports`, { method: 'POST', body: importForm(batch) });
}

async function pairsOf(taskId: string): Promise<TypedPair[]> {
  const r = await database.db.execute(
    sql`SELECT assignment FROM analysis_task WHERE id = ${taskId}`,
  );
  const [row] = r.rows as { assignment: TypedPair[] | null }[];
  return row?.assignment ?? [];
}

const assignmentOf = async (taskId: string) => (await pairsOf(taskId)).map(keyOf);

/** Claims every waiting task (five at a time, nothing submitted). */
async function claimAll(agent: Caller): Promise<ClaimedRelationsAnalysis[]> {
  const out: ClaimedRelationsAnalysis[] = [];
  for (;;) {
    const batch = await claim(agent, { projectId: P, max: 5 });
    if (batch.length === 0) return out;
    out.push(...batch);
  }
}

const unionOf = async (claims: readonly ClaimedRelationsAnalysis[]) =>
  new Set((await Promise.all(claims.map((c) => assignmentOf(c.taskId)))).flat());

const relabelled = (key: string): CorpusFile => {
  const f = files.find((x) => x.key === key);
  const [label, renamed] = LABELS.get(key) ?? ['', ''];
  if (!f) throw new Error(`${key} missing`);
  const text = new TextDecoder().decode(f.bytes);
  const next = text.replace(`name="${label}"`, `name="${renamed}"`);
  if (next === text) throw new Error(`${key}: nothing renamed`);
  return { ...f, bytes: new TextEncoder().encode(next) };
};

/**
 * The project use cases over the test database with a clock of their own,
 * counting the head-facts loads (one per summary build) and the candidate
 * passes; `cache` as given (`CandidateCache(0)`: each build pays its pass).
 */
function countingUseCases(clock: () => Date, cache = new CandidateCache()) {
  const stats = { loads: 0, passes: 0 };
  const base = createStore(database.db);
  const store: Store = {
    read: (fn) =>
      base.read((tx) =>
        fn({
          ...tx,
          facts: {
            ...tx.facts,
            headProjectFacts: (projectId) => {
              stats.loads++;
              return tx.facts.headProjectFacts(projectId);
            },
          },
        }),
      ),
    write: (fn) => base.write(fn),
  };
  const analysis: AnalysisPort = {
    ...libraryAnalysis,
    projectCandidates: (facts) => {
      stats.passes++;
      return libraryAnalysis.projectCandidates(facts);
    },
  };
  const useCases = projectUseCases(
    {
      store,
      analysis,
      clock: { now: clock },
      notifier: database.notifier,
      expectedProcedure: relationsProcedure,
      expectedPlacementProcedure: placementsProcedure,
    },
    cache,
  );
  return { useCases, stats };
}

beforeAll(async () => {
  database = await createTestDatabase();
  t = startTestApp(database, { analysis: libraryAnalysis });
  await t.createProject(P);
  // The whole landscape: there a few pairs have an assigned basis in one end's candidates only.
  files = await corpusFiles('nordwind-handel');
  KEYS = files.map((f) => f.key);
  expect(KEYS).toEqual(expect.arrayContaining([A, B, C, D]));
  first = await t.createToken(P, ['analyzr:read', 'analyzr:propose']);
  second = await t.createToken(P, ['analyzr:read', 'analyzr:propose']);
});

afterAll(async () => {
  await database.drop();
});

describe('ProjectSummary.pairsToJudge', () => {
  it('equals the union of the waiting tasks’ claims after a first import; held tasks count not', async () => {
    expect(await pairsToJudge()).toBe(0);
    await importFiles(files);
    const expected = await pairsToJudge();
    expect(expected).toBeGreaterThan(0);

    const agent = asAgent(t, first.secret);
    const claims = await claimAll(agent);
    expect(claims.map((c) => c.modelKey).sort()).toEqual([...KEYS].sort());
    const union = await unionOf(claims);
    expect(union.size).toBe(expected);
    // Pairs between two waiting models are among them, each once.
    const between = [...union].filter((k) => {
      const [, from = '', to = ''] = k.split(' ');
      return modelOf(from) !== modelOf(to);
    });
    expect(between.length).toBeGreaterThan(0);
    const listed = (await Promise.all(claims.map((c) => assignmentOf(c.taskId)))).flat();
    expect(listed).toHaveLength(union.size);

    // Nothing waits while the agent holds every task.
    expect(await pairsToJudge()).toBe(0);
    // The agent judges every pair it was assigned (a no-link each).
    for (const c of claims) {
      const noLinks = (await pairsOf(c.taskId)).map((p) => ({
        ...p,
        reason: 'no-evidence: nicht verbunden',
      }));
      await submit(agent, c.taskId, { ...submission(c, []), noLinks });
    }
    expect(await pairsToJudge()).toBe(0);
  });

  it('leaves out a held claim’s pairs, judged and settled pairs, and asks the own candidates for pairs with done models', async () => {
    // A, B and C change; B's task goes to the second agent, which holds it (its claim is
    // assigned its pair with C: C sorts later). D is queued again with the same facts: its
    // judged pairs stay current.
    await importFiles([relabelled(A), relabelled(B), relabelled(C)]);
    const [held] = await claim(asAgent(t, second.secret), { projectId: P, modelKey: B });
    if (!held) throw new Error('no task for B');
    await json(`/api/v1/projects/${P}/analyses/requeue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelKeys: [D] }),
    });
    // A human accepts a proposal touching a waiting model: its pair is settled.
    const proposal = (await json<Landscape>(`/api/v1/projects/${P}/landscape`)).relations.find(
      (r) =>
        r.status === 'proposed' &&
        r.type !== 'manual' &&
        [A, C, D].some((m) => modelOf(r.from) === m || modelOf(r.to) === m),
    );
    if (!proposal) throw new Error('no proposal touching A, C or D');
    await json(`/api/v1/projects/${P}/relations/${proposal.id}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ verdict: 'accept' }),
    });
    const expected = await pairsToJudge();

    const claims = await claimAll(asAgent(t, first.secret));
    expect(claims.map((c) => c.modelKey).sort()).toEqual([A, C, D].sort());
    const union = await unionOf(claims);
    expect(union.size).toBe(expected);

    // The held claim's pairs with the waiting models are its own, not counted.
    const heldPairs = (await assignmentOf(held.taskId)).filter((k) => {
      const [, from = '', to = ''] = k.split(' ');
      return [A, C, D].includes(modelOf(from)) || [A, C, D].includes(modelOf(to));
    });
    expect(heldPairs.length).toBeGreaterThan(0);
    expect(heldPairs.filter((k) => union.has(k))).toEqual([]);
    // D's pairs judged before (current no-links) are not counted; a settled pair neither.
    const judgedOfD = (
      await json<NoLinkList>(`/api/v1/projects/${P}/no-links?modelKey=${encodeURIComponent(D)}`)
    ).items.map(keyOf);
    expect(judgedOfD.length).toBeGreaterThan(0);
    expect(judgedOfD.filter((k) => union.has(k))).toEqual([]);
    const landscape = await json<Landscape>(`/api/v1/projects/${P}/landscape`);
    const settled = landscape.relations
      .filter((r) => r.status === 'accepted' && r.type !== 'manual')
      .filter((r) => [A, C, D].some((m) => modelOf(r.from) === m || modelOf(r.to) === m))
      .map(keyOf);
    expect(settled.length).toBeGreaterThan(0);
    expect(settled.filter((k) => union.has(k))).toEqual([]);
    // Pairs with the done models whose judgements the re-import made stale are judged again.
    const done = new Set(KEYS.filter((k) => ![A, B, C, D].includes(k)));
    expect(
      [...union].filter((k) => {
        const [, from = '', to = ''] = k.split(' ');
        return done.has(modelOf(from)) || done.has(modelOf(to));
      }).length,
    ).toBeGreaterThan(0);
  });

  it('lets a claim whose lease ran out hold nothing, its task count again, and the memo end with the lease', async () => {
    const key = 'pairs-lease';
    await t.createProject(key);
    await json(`/api/v1/projects/${key}/imports`, { method: 'POST', body: importForm(files) });
    const all = (await json<ProjectSummary>(`/api/v1/projects/${key}/summary`)).pairsToJudge;
    expect(all).toBeGreaterThan(0);
    const holder = asAgent(
      t,
      (await t.createToken(key, ['analyzr:read', 'analyzr:propose'])).secret,
    );
    const [held] = await claim(holder, { projectId: key, modelKey: B });
    if (!held) throw new Error('no task for B');
    // B's assignment has pairs with the waiting models: B's claim holds them.
    const heldPairs = await assignmentOf(held.taskId);
    expect(heldPairs.length).toBeGreaterThan(0);
    const leases = await database.db.execute(
      sql`SELECT lease_until FROM analysis_task WHERE id = ${held.taskId}`,
    );
    const [row] = leases.rows as { lease_until: string | Date }[];
    const lease = new Date(row?.lease_until ?? 0);
    expect(lease.getTime()).toBeGreaterThan(Date.now());

    // The summary's own clock: the memo holds while the lease runs, without an event.
    let now = new Date();
    const { useCases, stats } = countingUseCases(() => now);
    const actor = await t.useCases.localOwnerActor('analyzr-web');
    const live = await useCases.getProjectSummary(actor, key);
    expect(live.pairsToJudge).toBe(all - heldPairs.length);
    now = new Date(lease.getTime() - 1000);
    expect(await useCases.getProjectSummary(actor, key)).toEqual(live);
    expect(stats.loads).toBe(1);
    now = new Date(lease.getTime() + 1000);
    // Run out: B's claim holds nothing, and the next run claims B's task again.
    expect((await useCases.getProjectSummary(actor, key)).pairsToJudge).toBe(all);
    expect(stats.loads).toBe(2);
    // No lease runs any more: the memo holds.
    now = new Date(lease.getTime() + 3_600_000);
    expect((await useCases.getProjectSummary(actor, key)).pairsToJudge).toBe(all);
    expect(stats.loads).toBe(2);

    // The lease runs out for the app too; the next run is assigned what the summary said.
    await database.db.execute(
      sql`UPDATE analysis_task SET lease_until = now() - interval '1 minute' WHERE id = ${held.taskId}`,
    );
    const expected = (await json<ProjectSummary>(`/api/v1/projects/${key}/summary`)).pairsToJudge;
    expect(expected).toBe(all);
    const agent = asAgent(
      t,
      (await t.createToken(key, ['analyzr:read', 'analyzr:propose'])).secret,
    );
    const claims: ClaimedRelationsAnalysis[] = [];
    for (;;) {
      const batch = await claim(agent, { projectId: key, max: 5 });
      if (batch.length === 0) break;
      claims.push(...batch);
    }
    expect(claims.map((c) => c.modelKey)).toContain(B);
    expect((await unionOf(claims)).size).toBe(expected);
  });

  it('is built again after an import, through the summary’s memo, with one candidate pass each', async () => {
    const key = 'pairs-memo';
    await t.createProject(key);
    // Two models with pairs between them: the second import adds them.
    const one = files.find((f) => f.key === A);
    const two = files.find((f) => f.key === 'finanzen/e-rechnung-versand');
    if (!one || !two) throw new Error('two files');
    await json(`/api/v1/projects/${key}/imports`, { method: 'POST', body: importForm([one]) });
    // No candidate cache: each build pays its pass, so a second lookup would show.
    const { useCases, stats } = countingUseCases(() => new Date(), new CandidateCache(0));
    const actor = await t.useCases.localOwnerActor('analyzr-web');
    const before = await useCases.getProjectSummary(actor, key);
    expect(await useCases.getProjectSummary(actor, key)).toEqual(before);
    expect(stats).toEqual({ loads: 1, passes: 1 });

    await json(`/api/v1/projects/${key}/imports`, { method: 'POST', body: importForm([two]) });
    const after = await useCases.getProjectSummary(actor, key);
    expect(stats).toEqual({ loads: 2, passes: 2 });
    expect(after.pairsToJudge).toBeGreaterThan(before.pairsToJudge);
    const http = await json<ProjectSummary>(`/api/v1/projects/${key}/summary`);
    expect(after.pairsToJudge).toBe(http.pairsToJudge);
    const union = await unionOf(
      await claim(
        asAgent(t, (await t.createToken(key, ['analyzr:read', 'analyzr:propose'])).secret),
        { projectId: key, max: 5 },
      ),
    );
    expect(union.size).toBe(after.pairsToJudge);
  });
});

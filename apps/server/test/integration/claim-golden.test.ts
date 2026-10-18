/**
 * Golden claims (M6 S5a, §4.5 "Live runs"): the claim inputs of a freshly
 * seeded project without human notes stay byte-identical. `nordwind-handel`
 * is imported with the real libraries and its golden value chain created, as
 * `analyzr seed --value-chains` does; then every relations task is claimed,
 * one model at a time in key order (so each claim's `skip` sees the same
 * earlier claims), and the placement task. Each input is normalized (typed
 * ids numbered in order of appearance, timestamps blanked; both differ per
 * run) and pinned by its SHA-256 in `__snapshots__/claims-nordwind-handel.json`.
 *
 * A second project, seeded the same way, first gets a note and an outside
 * mark on every open question whose subject is neither a relation nor a
 * placement (S5a, S5c-1: those reach no agent before S7), the mark through
 * the actions route where the item offers it and through the sheet's
 * „Liegt außerhalb der Landschaft“ elsewhere: its claims must equal the
 * first project's.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { ClaimedAnalysis, OpenQuestionPage } from '@analyzr/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { libraryAnalysis } from '../../src/analysis.ts';
import { startTestApp, type TestApp } from '../support/app.ts';
import { corpusFiles, importAll } from '../support/corpus.ts';
import { createTestDatabase, type TestDatabase } from '../support/db.ts';
import { claimKinds, post } from '../support/pipeline.ts';
import { NORDWIND_CHAIN, chainPath } from '../support/value-chain.ts';

const LANDSCAPE = 'nordwind-handel';

let database: TestDatabase;
let t: TestApp;

const owner = (path: string, init?: RequestInit) => t.asOwner(path, init);

/** Imports the landscape and saves its golden chain, as `analyzr seed --value-chains`. */
async function seed(project: string): Promise<string[]> {
  await t.createProject(project);
  const files = await corpusFiles(LANDSCAPE);
  const outcomes = await importAll(owner, project, files);
  expect(outcomes.every((o) => o.outcome === 'created')).toBe(true);
  const saved = await t.asOwner(chainPath(project, '/content'), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'if-none-match': '*' },
    body: await readFile(NORDWIND_CHAIN),
  });
  expect(saved.status).toBe(201);
  return files.map((f) => f.key).sort();
}

const TYPED_ID = /\b([a-z]{3})_[0-7][0-9A-HJKMNP-TV-Z]{25}\b/g;
const TIMESTAMP = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g;

/**
 * Every claim input of the project as `label → sha256` of its normalized
 * JSON: relations tasks by model key, then the placement task(s). Since
 * owner decision 27 a claim sorts its relations by type and ends, so the
 * digest no longer follows the database's physical row order (two projects
 * seeded alike got different orders on CI).
 */
async function claimDigests(project: string, keys: readonly string[]) {
  const inputs: [string, unknown][] = [];
  for (const modelKey of keys) {
    const items = await claimKinds(owner, { projectId: project, modelKey, kinds: ['relations'] });
    expect(items, modelKey).toHaveLength(1);
    inputs.push([`relations ${modelKey}`, (items[0] as ClaimedAnalysis).input]);
  }
  for (let i = 0; ; i++) {
    const items = await claimKinds(owner, { projectId: project, kinds: ['placement'] });
    if (items.length === 0) break;
    for (const item of items) inputs.push([`placement ${i}`, item.input]);
  }
  const ids = new Map<string, string>();
  const out: Record<string, string> = {};
  for (const [label, input] of inputs) {
    const normalized = JSON.stringify(input)
      .replace(TYPED_ID, (id, prefix: string) => {
        let n = ids.get(id);
        if (n === undefined) {
          n = `${prefix}_#${ids.size + 1}`;
          ids.set(id, n);
        }
        return n;
      })
      .replace(TIMESTAMP, '<at>');
    out[label] = createHash('sha256').update(normalized).digest('hex');
  }
  return out;
}

beforeAll(async () => {
  database = await createTestDatabase();
  t = startTestApp(database, { analysis: libraryAnalysis });
}, 60_000);

afterAll(async () => {
  await database?.drop();
});

let keys: string[] = [];
let golden: Record<string, string> = {};

describe('claims of a seeded project without notes', () => {
  it('stay byte-identical', async () => {
    keys = await seed('golden');
    golden = await claimDigests('golden', keys);
    expect(Object.keys(golden).filter((k) => k.startsWith('placement'))).toHaveLength(1);
    await expect(`${JSON.stringify(golden, null, 2)}\n`).toMatchFileSnapshot(
      '__snapshots__/claims-nordwind-handel.json',
    );
  }, 180_000);

  it('stay byte-identical with notes and outside marks on the open questions', async () => {
    expect(Object.keys(golden).length).toBeGreaterThan(0);
    // The same landscape with a note and an outside mark on every question about neither
    // a relation nor a placement (findings, chain findings and signals on a seeded project).
    await seed('answered');
    const base = '/api/v1/projects/answered/open-questions';
    const page = (await (await owner(`${base}?limit=200`)).json()) as OpenQuestionPage;
    const subjects = page.items.filter(
      (q) => q.subject.type !== 'relation' && q.subject.type !== 'placement',
    );
    expect(subjects.length).toBeGreaterThan(50);
    const notes = await post(owner, `${base}/answers`, {
      rows: subjects.map((q) => ({ id: q.id, text: `Antwort zu ${q.subjectLabel}`, kind: '' })),
    });
    expect(notes.status).toBe(200);
    // The one-click mark where the item offers it, S5a's sheet column elsewhere.
    const clickable = subjects.filter((q) => q.actions.some((a) => a.type === 'outside'));
    expect(clickable.length).toBeGreaterThan(0);
    for (const q of clickable) {
      expect((await post(owner, `${base}/${q.id}/actions`, { type: 'outside' })).status).toBe(201);
    }
    const marks = await post(owner, `${base}/answers`, {
      rows: subjects
        .filter((q) => !clickable.includes(q))
        .map((q) => ({
          id: q.id,
          text: `Außerhalb: ${q.subjectLabel}`,
          kind: 'Liegt außerhalb der Landschaft',
        })),
    });
    expect(marks.status).toBe(200);
    const after = (await (
      await owner(`${base}?state=answered&limit=200`)
    ).json()) as OpenQuestionPage;
    expect(after.total).toBe(subjects.length);
    expect(await claimDigests('answered', keys)).toEqual(golden);
  }, 180_000);
});

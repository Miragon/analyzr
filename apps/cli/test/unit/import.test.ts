import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_FILES,
  MAX_MODEL_BYTES,
  type ImportFileOutcome,
} from '@analyzr/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { formatNextSteps, formatWarningCounts } from '../../src/commands/import.ts';
import { batches, findBpmnFiles, planImport, type BpmnFile } from '../../src/files.ts';
import { runCli } from '../../src/program.ts';
import {
  AGENT_TOKEN,
  OWNER_KEY,
  fakeApi,
  json,
  ownerKeyFile,
  problem,
  tempDir,
  testIo,
} from '../support/io.ts';

let dir: string;
let models: string;
let keyFile: string;

async function put(rel: string, text = '<bpmn/>', root = models): Promise<void> {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), text);
}

beforeAll(async () => {
  dir = await tempDir();
  models = path.join(dir, 'models');
  keyFile = await ownerKeyFile(dir);
  await put('finanzen/Rechnungsstellung.bpmn');
  await put('vertrieb/auftrag.bpmn');
  await put('legacy/old.bpmn20.xml');
  await put('export/model.xml');
  await put('notes.txt', 'not bpmn');
  await put('.git/HEAD.bpmn');
  await put('node_modules/x/y.bpmn');
  // macOS resource forks and other hidden files are never models (M6 S1, as the web).
  await put('._x.bpmn');
  await put('vertrieb/._auftrag.bpmn');
  await symlink(path.join(models, 'vertrieb/auftrag.bpmn'), path.join(models, 'link.bpmn'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Multipart file names of a recorded import request. */
async function uploaded(req: Request): Promise<string[]> {
  const form = await req.formData();
  return form.getAll('files').map((f) => (f as File).name);
}

const created = (p: string): ImportFileOutcome => ({
  path: p,
  modelKey: p.replace(/\.(bpmn20\.xml|bpmn2|bpmn|xml)$/i, '').toLowerCase(),
  outcome: 'created',
  problem: null,
});

/** An import route that answers every uploaded file with `answer(path)` (default: created). */
function importRoute(answer: (path: string) => ImportFileOutcome = created) {
  return async (req: Request) => json({ files: (await uploaded(req.clone())).map(answer) });
}

/** `GET …/analyses` answering nothing waiting. */
const NOTHING_WAITING = {
  'GET /api/v1/projects/demo/analyses': () => json({ items: [], nextCursor: null }),
};

const invalid = (p: string, reason: string, detail: string): ImportFileOutcome => ({
  path: p,
  modelKey: p.replace(/\.xml$/, ''),
  outcome: 'failed',
  problem: {
    type: 'urn:analyzr:problem:bpmn-invalid',
    title: 'BPMN invalid',
    status: 422,
    code: 'bpmn-invalid',
    detail,
    reason,
  },
});

describe('findBpmnFiles / batches / planImport', () => {
  it('finds the files of the shared rule below the root, sorted, without hidden files, hidden dirs, node_modules and links', async () => {
    const files = await findBpmnFiles(models);
    expect(files.map((f) => f.path)).toEqual([
      'export/model.xml',
      'finanzen/Rechnungsstellung.bpmn',
      'legacy/old.bpmn20.xml',
      'vertrieb/auftrag.bpmn',
    ]);
    await expect(findBpmnFiles(path.join(dir, 'nope'))).rejects.toThrow(/not a directory/);
  });

  it(`splits into requests of ≤ ${MAX_IMPORT_FILES} files and ≤ 25 MB; oversized files stay local`, () => {
    const file = (i: number, size = 10): BpmnFile => ({
      path: `m${String(i).padStart(3, '0')}.bpmn`,
      bytes: new Uint8Array(size),
    });
    const many = Array.from({ length: MAX_IMPORT_FILES * 2 + 1 }, (_, i) => file(i));
    expect(batches(many).batches.map((b) => b.length)).toEqual([50, 50, 1]);

    // 4 MiB each (below the 5 MiB model limit): six fit into 25 MiB, a seventh does not.
    const big = 4 * 1024 * 1024;
    expect(big).toBeLessThan(MAX_MODEL_BYTES);
    expect(6 * big).toBeLessThanOrEqual(MAX_IMPORT_BYTES);
    const heavy = Array.from({ length: 13 }, (_, i) => file(i, big));
    expect(batches(heavy).batches.map((b) => b.length)).toEqual([6, 6, 1]);

    const { batches: groups, oversized } = batches([
      file(1),
      file(2, MAX_MODEL_BYTES + 1),
      file(3),
    ]);
    expect(groups.map((b) => b.map((f) => f.path))).toEqual([['m001.bpmn', 'm003.bpmn']]);
    expect(oversized.map((f) => f.path)).toEqual(['m002.bpmn']);
  });

  it('derives the keys first: no valid key, a key taken by an earlier file and oversized files fail locally', () => {
    const file = (p: string, size = 10): BpmnFile => ({ path: p, bytes: new Uint8Array(size) });
    const plan = planImport([
      file('---.bpmn'),
      file('a/B.bpmn'),
      file('a/b.bpmn2'),
      file('a/b.xml'),
      file('big.bpmn', MAX_MODEL_BYTES + 1),
      file('c.bpmn'),
    ]);
    expect(plan.batches.map((b) => b.map((f) => f.path))).toEqual([['a/B.bpmn', 'c.bpmn']]);
    expect(
      plan.failed.map((f) => [f.path, f.modelKey, f.problem?.code, f.problem?.detail]),
    ).toEqual([
      ['---.bpmn', null, 'validation-failed', 'the path gives no valid model key'],
      [
        'a/b.bpmn2',
        'a/b',
        'validation-failed',
        'another file of this import has model key a/b (a/B.bpmn)',
      ],
      ['big.bpmn', 'big', 'payload-too-large', `a model may have at most ${MAX_MODEL_BYTES} bytes`],
    ]);
    expect(plan.failed.map((f) => [f.outcome, f.problem?.status])).toEqual([
      ['failed', 422],
      ['failed', 422],
      ['failed', 413],
    ]);
    // A plain .xml whose key a .bpmn… file has is skipped, not failed.
    expect(plan.skipped).toEqual([{ path: 'a/b.xml', reason: 'key-taken', takenBy: 'a/B.bpmn' }]);
  });

  it('skips a plain .xml whose key a .bpmn… file has; two plain .xml files stay duplicates', () => {
    const file = (p: string): BpmnFile => ({ path: p, bytes: new Uint8Array(10) });
    const plan = planImport([
      file('Order.xml'),
      file('Prozess.bpmn'),
      file('Prozess.xml'),
      file('order.xml'),
    ]);
    expect(plan.batches.flat().map((f) => f.path)).toEqual(['Order.xml', 'Prozess.bpmn']);
    expect(plan.skipped).toEqual([
      { path: 'Prozess.xml', reason: 'key-taken', takenBy: 'Prozess.bpmn' },
    ]);
    expect(plan.failed.map((f) => [f.path, f.problem?.detail])).toEqual([
      ['order.xml', 'another file of this import has model key order (Order.xml)'],
    ]);
  });

  it('gives a key to a .bpmn… file before a plain .xml, whichever sorts first', async () => {
    const root = path.join(dir, 'owners');
    // Code-point order puts `Order.xml` (any XML of an export) before `order.bpmn`.
    await put('Order.xml', '<meta/>', root);
    await put('order.bpmn', '<bpmn/>', root);
    await put('Order_Process.xml', '<meta/>', root);
    await put('order-process.bpmn', '<bpmn/>', root);
    const found = await findBpmnFiles(root);
    expect(found.map((f) => f.path)).toEqual([
      'Order.xml',
      'Order_Process.xml',
      'order-process.bpmn',
      'order.bpmn',
    ]);
    const plan = planImport(found);
    expect(plan.batches.flat().map((f) => f.path)).toEqual(['order-process.bpmn', 'order.bpmn']);
    expect(plan.failed).toEqual([]);
    expect(plan.skipped).toEqual([
      { path: 'Order.xml', reason: 'key-taken', takenBy: 'order.bpmn' },
      { path: 'Order_Process.xml', reason: 'key-taken', takenBy: 'order-process.bpmn' },
    ]);
  });

  it('picks the same file for a key as the web upload: code-point order, not the locale', async () => {
    const root = path.join(dir, 'parity');
    await put('a_b.bpmn', '<bpmn/>', root);
    await put('a-b.bpmn', '<bpmn/>', root);
    const plan = planImport(await findBpmnFiles(root));
    // apps/web/test/lib.test.ts pins the same winner for planUpload.
    expect(plan.batches.flat().map((f) => f.path)).toEqual(['a-b.bpmn']);
    expect(plan.failed.map((f) => f.path)).toEqual(['a_b.bpmn']);
  });
});

describe('analyzr import', () => {
  const outcomes: Record<string, ImportFileOutcome> = {
    'export/model.xml': created('export/model.xml'),
    'finanzen/Rechnungsstellung.bpmn': created('finanzen/Rechnungsstellung.bpmn'),
    'legacy/old.bpmn20.xml': {
      path: 'legacy/old.bpmn20.xml',
      modelKey: 'legacy/old',
      outcome: 'unchanged',
      problem: null,
    },
    'vertrieb/auftrag.bpmn': {
      path: 'vertrieb/auftrag.bpmn',
      modelKey: 'vertrieb/auftrag',
      outcome: 'failed',
      problem: {
        type: 'urn:analyzr:problem:bpmn-invalid',
        title: 'Invalid BPMN',
        status: 422,
        code: 'bpmn-invalid',
        detail: 'not BPMN',
      },
    },
  };
  const byPath = (p: string) => outcomes[p] ?? created(p);

  it('uploads every file with its relative path and reports each outcome', async () => {
    const api = fakeApi({
      'POST /api/v1/projects/demo/imports': importRoute(byPath),
      ...NOTHING_WAITING,
    });
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
    const code = await runCli(['import', 'models', '--project', 'demo'], t.io);
    expect(code).toBe(1); // one file failed
    const imports = api.seen.filter((s) => s.method === 'POST');
    expect(imports).toHaveLength(1);
    expect(imports[0]?.authorization).toBe(`Bearer ${OWNER_KEY}`);
    expect(imports[0]?.contentType).toMatch(/^multipart\/form-data/);
    expect(await uploaded(imports[0]!.body)).toEqual([
      'export/model.xml',
      'finanzen/Rechnungsstellung.bpmn',
      'legacy/old.bpmn20.xml',
      'vertrieb/auftrag.bpmn',
    ]);
    expect(t.out()).toContain('  created   export/model\n');
    expect(t.out()).toContain('  created   finanzen/rechnungsstellung\n');
    expect(t.out()).toContain('  failed    vertrieb/auftrag  (422 bpmn-invalid: not BPMN)\n');
    expect(t.out()).toContain('demo: 4 files, 2 created, 0 revised, 1 unchanged, 1 failed\n');
    expect(t.err()).toContain('1 of 4 files failed');
  });

  it('prefers an agent token (analyzr:write) when one is given', async () => {
    const api = fakeApi({
      'POST /api/v1/projects/demo/imports': importRoute((p) =>
        p === 'vertrieb/auftrag.bpmn' ? created(p) : byPath(p),
      ),
    });
    const t = testIo({ ANALYZR_TOKEN: AGENT_TOKEN }, api.fetch, { cwd: dir });
    expect(await runCli(['import', 'models', '-p', 'demo', '--json'], t.io)).toBe(0);
    expect(api.seen[0]?.authorization).toBe(`Bearer ${AGENT_TOKEN}`);
    // --json: the summary only, no task listing.
    expect(api.seen.map((s) => s.method)).toEqual(['POST']);
    const summary = JSON.parse(t.out()) as Record<string, unknown>;
    expect(Object.keys(summary)).toEqual(['project', 'files', 'counts']);
    expect(summary).toMatchObject({
      project: 'demo',
      counts: { created: 3, unchanged: 1, revised: 0, failed: 0 },
    });
  });

  it('--create creates a missing project first (owner key)', async () => {
    const api = fakeApi({
      'GET /api/v1/projects/neu': () => problem(404, 'not-found', 'project not found'),
      'POST /api/v1/projects': () =>
        json(
          { id: 'prj_1', key: 'neu', name: 'Neu', role: 'owner', lastSeq: 1, createdAt: '' },
          201,
        ),
      'POST /api/v1/projects/neu/imports': importRoute(created),
      'GET /api/v1/projects/neu/analyses': () => json({ items: [], nextCursor: null }),
    });
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile, ANALYZR_TOKEN: AGENT_TOKEN }, api.fetch, {
      cwd: dir,
    });
    expect(await runCli(['import', 'models', '-p', 'neu', '--create', '--name', 'Neu'], t.io)).toBe(
      0,
    );
    expect(api.seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      'GET /api/v1/projects/neu',
      'POST /api/v1/projects',
      'POST /api/v1/projects/neu/imports',
      'GET /api/v1/projects/neu/analyses',
      'GET /api/v1/projects/neu/analyses',
    ]);
    // --create needs the owner: the agent token in ANALYZR_TOKEN is not used.
    expect(api.seen.every((s) => s.authorization === `Bearer ${OWNER_KEY}`)).toBe(true);
    expect(await api.seen[1]?.body.json()).toEqual({ key: 'neu', name: 'Neu' });
    expect(t.out()).toContain('created project neu');
    expect(t.out()).toContain('neu: 0 relations tasks waiting, placement task waiting: no\n');
    expect(t.out()).not.toContain('next:');
  });

  it('fails clearly for a missing project, an empty directory and an unreachable server', async () => {
    const api = fakeApi({});
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
    expect(await runCli(['import', 'models', '-p', 'ghost'], t.io)).toBe(1);
    expect(t.err()).toContain('import into ghost failed (404');

    await mkdir(path.join(dir, 'empty'), { recursive: true });
    expect(await runCli(['import', 'empty', '-p', 'demo'], t.io)).toBe(1);
    expect(t.err()).toContain('no BPMN files (*.bpmn, *.bpmn2, *.bpmn20.xml, *.xml) below');

    const offline = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, undefined, { cwd: dir });
    expect(await runCli(['import', 'models', '-p', 'demo'], offline.io)).toBe(1);
    expect(offline.err()).toContain('cannot reach analyzr at http://127.0.0.1:7400');
  });

  it('refuses a key an earlier file has before sending, also across two batches', async () => {
    const root = path.join(dir, 'dupes');
    // `Z.bpmn` sorts before the 50 files of m/, `z.bpmn2` after them: in a second request the
    // server could not tell, and `z.bpmn2` would silently revise model `z`.
    await put('Z.bpmn', '<bpmn/>', root);
    for (let i = 0; i < MAX_IMPORT_FILES; i++) {
      await put(`m/${String(i).padStart(3, '0')}.bpmn`, '<bpmn/>', root);
    }
    await put('z.bpmn2', '<bpmn/>', root);
    const api = fakeApi({
      'POST /api/v1/projects/demo/imports': importRoute(),
      ...NOTHING_WAITING,
    });
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
    expect(await runCli(['import', 'dupes', '-p', 'demo'], t.io)).toBe(1);
    const sent = await Promise.all(
      api.seen.filter((s) => s.method === 'POST').map((s) => uploaded(s.body)),
    );
    expect(sent.map((b) => b.length)).toEqual([50, 1]);
    expect(sent.flat()).toContain('Z.bpmn');
    expect(sent.flat()).not.toContain('z.bpmn2');
    expect(t.out()).toContain(
      '  failed    z  (422 validation-failed: another file of this import has model key z (Z.bpmn))\n',
    );
    expect(t.out()).toContain('demo: 52 files, 51 created, 0 revised, 0 unchanged, 1 failed\n');
    expect(t.err()).toContain('1 of 52 files failed');
  });

  it('lists a plain .xml that is no BPMN as skipped (exit 0); a DOCTYPE in .xml stays failed (exit 1)', async () => {
    const root = path.join(dir, 'xml');
    await put('prozess.bpmn', '<bpmn/>', root);
    await put('export/meta.xml', '<meta/>', root);
    await put('export/aris.xml', '<!DOCTYPE AML><AML/>', root);
    const notBpmn = invalid('export/meta.xml', 'not-bpmn', 'root element <meta> is not BPMN');
    const doctype = invalid(
      'export/aris.xml',
      'doctype-forbidden',
      'DOCTYPE declarations are not allowed in BPMN',
    );

    const skipping = fakeApi({
      'POST /api/v1/projects/demo/imports': importRoute((p) =>
        p === 'export/meta.xml' ? notBpmn : created(p),
      ),
      ...NOTHING_WAITING,
    });
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, skipping.fetch, { cwd: dir });
    expect(await runCli(['import', 'xml', '-p', 'demo'], t.io)).toBe(0);
    expect(t.out()).toContain('  skipped   export/meta.xml  (not BPMN)\n');
    expect(t.out()).toContain(
      'demo: 2 files, 2 created, 0 revised, 0 unchanged, 0 failed, 1 skipped (not BPMN)\n',
    );
    const j = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, skipping.fetch, { cwd: dir });
    expect(await runCli(['import', 'xml', '-p', 'demo', '--json'], j.io)).toBe(0);
    const summary = JSON.parse(j.out()) as { files: { path: string }[]; counts: object };
    expect(summary).toMatchObject({
      counts: { created: 2, revised: 0, unchanged: 0, failed: 0 },
      skipped: [{ path: 'export/meta.xml', reason: 'not-bpmn' }],
    });
    expect(Object.keys(summary.counts)).toHaveLength(4);
    expect(summary.files.map((f) => f.path)).toEqual(['export/aris.xml', 'prozess.bpmn']);

    const refusing = fakeApi({
      'POST /api/v1/projects/demo/imports': importRoute((p) =>
        p === 'export/aris.xml' ? doctype : p === 'export/meta.xml' ? notBpmn : created(p),
      ),
      ...NOTHING_WAITING,
    });
    const r = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, refusing.fetch, { cwd: dir });
    expect(await runCli(['import', 'xml', '-p', 'demo'], r.io)).toBe(1);
    expect(r.out()).toContain(
      '  failed    export/aris  (422 bpmn-invalid: DOCTYPE declarations are not allowed in BPMN)\n',
    );
    expect(r.out()).toContain(
      'demo: 2 files, 1 created, 0 revised, 0 unchanged, 1 failed, 1 skipped (not BPMN)\n',
    );
    expect(r.err()).toContain('1 of 2 files failed');
  });

  it('exits 1 when every file is a plain .xml that is no BPMN: nothing was imported', async () => {
    const root = path.join(dir, 'only-xml');
    await put('pom.xml', '<project/>', root);
    await put('export/meta.xml', '<meta/>', root);
    const api = fakeApi({
      'POST /api/v1/projects/demo/imports': importRoute((p) =>
        invalid(p, 'not-bpmn', 'root element is not BPMN'),
      ),
      ...NOTHING_WAITING,
    });
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
    expect(await runCli(['import', 'only-xml', '-p', 'demo'], t.io)).toBe(1);
    expect(t.out()).toBe(
      [
        '  skipped   export/meta.xml  (not BPMN)',
        '  skipped   pom.xml  (not BPMN)',
        'demo: 0 files, 0 created, 0 revised, 0 unchanged, 0 failed, 2 skipped (not BPMN)',
        '',
      ].join('\n'),
    );
    expect(t.err()).toContain('no BPMN files below only-xml: 2 skipped (not BPMN)');
    // No next step: nothing was imported.
    expect(api.seen.map((s) => s.method)).toEqual(['POST']);

    const j = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
    expect(await runCli(['import', 'only-xml', '-p', 'demo', '--json'], j.io)).toBe(1);
    expect(JSON.parse(j.out())).toMatchObject({ files: [], skipped: [{}, {}] });
  });

  it('skips a sidecar .xml whose key a .bpmn file has: never sent, listed, exit 0', async () => {
    const root = path.join(dir, 'sidecar');
    await put('Prozess.bpmn', '<bpmn/>', root);
    // A tool's sidecar: whatever it holds, it never revises the model.
    await put('Prozess.xml', '<bpmn/>', root);
    await put('export/meta.xml', '<meta/>', root);
    const api = fakeApi({
      'POST /api/v1/projects/demo/imports': importRoute((p) =>
        p === 'export/meta.xml' ? invalid(p, 'not-bpmn', 'root element is not BPMN') : created(p),
      ),
      ...NOTHING_WAITING,
    });
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
    expect(await runCli(['import', 'sidecar', '-p', 'demo'], t.io)).toBe(0);
    const imports = api.seen.filter((s) => s.method === 'POST');
    expect(imports).toHaveLength(1);
    expect(await uploaded(imports[0]!.body)).toEqual(['Prozess.bpmn', 'export/meta.xml']);
    expect(t.out()).toContain(
      [
        '  created   prozess',
        '  skipped   Prozess.xml  (same model key as Prozess.bpmn)',
        '  skipped   export/meta.xml  (not BPMN)',
        'demo: 1 files, 1 created, 0 revised, 0 unchanged, 0 failed, 2 skipped (1 not BPMN, 1 same model key)',
        '',
      ].join('\n'),
    );
    expect(t.out()).toContain('demo: 0 relations tasks waiting');
    expect(t.err()).toBe('');

    const j = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
    expect(await runCli(['import', 'sidecar', '-p', 'demo', '--json'], j.io)).toBe(0);
    const summary = JSON.parse(j.out()) as Record<string, unknown>;
    expect(Object.keys(summary)).toEqual(['project', 'files', 'counts', 'skipped']);
    expect(summary).toMatchObject({
      counts: { created: 1, revised: 0, unchanged: 0, failed: 0 },
      skipped: [
        { path: 'Prozess.xml', reason: 'key-taken', takenBy: 'Prozess.bpmn' },
        { path: 'export/meta.xml', reason: 'not-bpmn' },
      ],
    });
  });

  it('names one reason when every skipped file shares it, and still fails two plain .xml with one key', async () => {
    const root = path.join(dir, 'sidecars');
    await put('a.bpmn', '<bpmn/>', root);
    await put('A.xml', '<meta/>', root);
    await put('b.bpmn20.xml', '<bpmn/>', root);
    await put('b.xml', '<meta/>', root);
    // Two names for one key that a case-insensitive file system keeps apart.
    await put('Order_Process.xml', '<bpmn/>', root);
    await put('order-process.xml', '<bpmn/>', root);
    const api = fakeApi({
      'POST /api/v1/projects/demo/imports': importRoute(),
      ...NOTHING_WAITING,
    });
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
    expect(await runCli(['import', 'sidecars', '-p', 'demo'], t.io)).toBe(1);
    const sent = await uploaded(api.seen.find((s) => s.method === 'POST')!.body);
    expect(sent).toEqual(['Order_Process.xml', 'a.bpmn', 'b.bpmn20.xml']);
    expect(t.out()).toContain(
      '  failed    order-process  (422 validation-failed: another file of this import has model key order-process (Order_Process.xml))\n',
    );
    expect(t.out()).toContain('  skipped   A.xml  (same model key as a.bpmn)\n');
    expect(t.out()).toContain('  skipped   b.xml  (same model key as b.bpmn20.xml)\n');
    expect(t.out()).toContain(
      'demo: 4 files, 3 created, 0 revised, 0 unchanged, 1 failed, 2 skipped (same model key)\n',
    );
    expect(t.err()).toContain('1 of 4 files failed');
  });

  describe('extractor warnings', () => {
    const root = () => path.join(dir, 'warned');
    const warned: ImportFileOutcome = {
      path: 'w/a.bpmn',
      modelKey: 'w/a',
      outcome: 'revised',
      problem: null,
      warnings: [
        { code: 'invalid-id', message: '<bpmn:task> id "1x" is not a valid element id; skipped' },
        {
          code: 'parse-warning',
          message:
            'unparsable content <bpmn:task> detected line: 4 column: 4 nested error: duplicate ID <Task_A>',
          elementId: 'Task_A',
        },
        { code: 'invalid-id', message: '<bpmn:task> id "2x" is not a valid element id; skipped' },
      ],
      warningCount: 3,
    };
    const api = () =>
      fakeApi({
        'POST /api/v1/projects/demo/imports': importRoute((p) =>
          p === 'w/a.bpmn' ? warned : created(p),
        ),
        ...NOTHING_WAITING,
      });

    beforeAll(async () => {
      await put('w/a.bpmn', '<bpmn/>', root());
      await put('w/b.bpmn', '<bpmn/>', root());
    });

    it('prints the count by code per file, never changing the exit code', async () => {
      const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api().fetch, { cwd: dir });
      expect(await runCli(['import', 'warned', '-p', 'demo'], t.io)).toBe(0);
      expect(t.out()).toContain(
        '  revised   w/a  warnings: 3 (invalid-id 2, parse-warning 1)\n  created   w/b\n',
      );
      expect(t.out()).not.toContain('duplicate ID');
    });

    it('--verbose lists the entries', async () => {
      const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api().fetch, { cwd: dir });
      expect(await runCli(['import', 'warned', '-p', 'demo', '--verbose'], t.io)).toBe(0);
      expect(t.out()).toContain(
        [
          '  revised   w/a  warnings: 3 (invalid-id 2, parse-warning 1)',
          '      invalid-id: <bpmn:task> id "1x" is not a valid element id; skipped',
          '      parse-warning Task_A: unparsable content <bpmn:task> detected line: 4 column: 4 nested error: duplicate ID <Task_A>',
          '      invalid-id: <bpmn:task> id "2x" is not a valid element id; skipped',
          '  created   w/b',
        ].join('\n'),
      );
    });

    it('--json carries the entries and the count', async () => {
      const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api().fetch, { cwd: dir });
      expect(await runCli(['import', 'warned', '-p', 'demo', '--json'], t.io)).toBe(0);
      const { files } = JSON.parse(t.out()) as { files: ImportFileOutcome[] };
      expect(files[0]).toEqual(warned);
      expect(Object.keys(files[1]!)).toEqual(['path', 'modelKey', 'outcome', 'problem']);
    });

    it('counts warnings beyond the listed entries', () => {
      const listed = Array.from({ length: 20 }, () => ({ code: 'parse-warning', message: 'x' }));
      expect(formatWarningCounts(listed, 30)).toBe('30 (parse-warning 20, 10 more)');
    });

    describe("beyond the extractor's 100", () => {
      // The server lists the first 19 and the extractor's too-many-warnings entry last.
      const capped: ImportFileOutcome = {
        path: 'w/a.bpmn',
        modelKey: 'w/a',
        outcome: 'created',
        problem: null,
        warnings: [
          ...Array.from({ length: 19 }, (_, i) => ({ code: 'parse-warning', message: `w${i}` })),
          { code: 'too-many-warnings', message: '150 more warnings omitted' },
        ],
        warningCount: 101,
      };
      const cappedApi = () =>
        fakeApi({
          'POST /api/v1/projects/demo/imports': importRoute((p) =>
            p === 'w/a.bpmn' ? capped : created(p),
          ),
          ...NOTHING_WAITING,
        });

      it('names what the extractor omitted', () => {
        expect(formatWarningCounts(capped.warnings ?? [], 101)).toBe(
          '100 (parse-warning 19, 81 more, 150 more warnings omitted)',
        );
      });

      it('--verbose lists the omitted entry after the unlisted ones', async () => {
        const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, cappedApi().fetch, { cwd: dir });
        expect(await runCli(['import', 'warned', '-p', 'demo', '--verbose'], t.io)).toBe(0);
        expect(t.out()).toContain(
          [
            '  created   w/a  warnings: 100 (parse-warning 19, 81 more, 150 more warnings omitted)',
            '      parse-warning: w0',
          ].join('\n'),
        );
        expect(t.out()).toContain(
          [
            '      parse-warning: w18',
            '      … 81 more not listed',
            '      too-many-warnings: 150 more warnings omitted',
            '  created   w/b',
          ].join('\n'),
        );
      });
    });
  });

  it('ends with the tasks waiting, paging past 200 relations tasks, and the next agent step', async () => {
    const task = (i: number) => ({ id: `ana_${i}`, kind: 'relations', state: 'queued' });
    const api = fakeApi({
      'POST /api/v1/projects/demo/imports': importRoute(),
      'GET /api/v1/projects/demo/analyses': (_req, url) => {
        const q = url.searchParams;
        expect(q.get('state')).toBe('queued');
        if (q.get('kind') === 'placement') {
          expect(q.get('limit')).toBe('1');
          return json({ items: [{ id: 'ana_p', kind: 'placement' }], nextCursor: 'more' });
        }
        expect(q.get('kind')).toBe('relations');
        expect(q.get('limit')).toBe('200');
        return q.get('cursor') === 'page2'
          ? json({ items: Array.from({ length: 50 }, (_, i) => task(200 + i)), nextCursor: null })
          : json({ items: Array.from({ length: 200 }, (_, i) => task(i)), nextCursor: 'page2' });
      },
    });
    await put('a.bpmn', '<bpmn/>', path.join(dir, 'next'));
    const t = testIo({ ANALYZR_TOKEN: AGENT_TOKEN }, api.fetch, { cwd: dir });
    expect(await runCli(['import', 'next', '-p', 'demo'], t.io)).toBe(0);
    expect(api.seen.filter((s) => s.method === 'GET')).toHaveLength(3);
    expect(t.out()).toContain(
      [
        'demo: 250 relations tasks waiting, placement task waiting: yes',
        'next: let an agent work them, e.g. in Claude Code with the plugin analyzr:',
        '  /analyzr:relations demo',
        '  /analyzr:placements demo',
        '  other clients: the start prompts in examples/agents; a token: analyzr token create -p demo',
        '',
      ].join('\n'),
    );
  });

  it('words the waiting tasks as the spec does, and names a step only for what waits', () => {
    expect(formatNextSteps('demo', { relations: 1, placement: false })).toBe(
      [
        'demo: 1 relations tasks waiting, placement task waiting: no',
        'next: let an agent work them, e.g. in Claude Code with the plugin analyzr:',
        '  /analyzr:relations demo',
        '  other clients: the start prompts in examples/agents; a token: analyzr token create -p demo',
        '',
      ].join('\n'),
    );
    expect(formatNextSteps('demo', { relations: 0, placement: true })).toContain(
      '  /analyzr:placements demo\n',
    );
    expect(formatNextSteps('demo', { relations: 0, placement: true })).not.toContain(
      '/analyzr:relations',
    );
    expect(formatNextSteps('demo', { relations: 0, placement: false })).toBe(
      'demo: 0 relations tasks waiting, placement task waiting: no\n',
    );
  });

  it('still succeeds when the waiting tasks cannot be listed', async () => {
    const api = fakeApi({
      'POST /api/v1/projects/demo/imports': importRoute(),
      'GET /api/v1/projects/demo/analyses': () => problem(403, 'forbidden', 'no read scope'),
    });
    const t = testIo({ ANALYZR_TOKEN: AGENT_TOKEN }, api.fetch, { cwd: dir });
    expect(await runCli(['import', 'next', '-p', 'demo'], t.io)).toBe(0);
    expect(t.out()).toContain('demo: 1 files, 1 created');
    expect(t.err()).toContain('cannot list the waiting tasks');
  });
});

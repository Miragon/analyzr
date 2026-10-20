// M6 S2a: `analyzr import` reads `analyzr-import.json` at the import root (the integrate
// plugin's golden bundle, synthetic, and hand-written manifests): the keys it pins win over
// the paths, each batch sends the manifest's subset for its files as the part `manifest`, an
// invalid manifest stops the import before anything is sent, and the import warnings
// (`manifest-sha-mismatch`, `external-id-moved`, `external-id-changed`) are printed; plus
// `analyzr models external-ids`.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAX_IMPORT_FILES,
  modelKeyFromPath,
  type ImportFileOutcome,
  type ImportManifest,
} from '@analyzr/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { shellArg } from '../../src/commands/import.ts';
import { findBpmnFiles, planImport } from '../../src/files.ts';
import { runCli } from '../../src/program.ts';
import { fakeApi, json, ownerKeyFile, tempDir, testIo } from '../support/io.ts';

const BUNDLE = fileURLToPath(
  new URL('../../../../tools/integrate/test/fixtures/signavio/bundle/', import.meta.url),
);

let dir: string;
let keyFile: string;

beforeAll(async () => {
  dir = await tempDir();
  keyFile = await ownerKeyFile(dir);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function write(root: string, rel: string, text: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await writeFile(path.join(root, rel), text);
}

/** The files and the `manifest` part of a recorded import request. */
async function request(
  req: Request,
): Promise<{ files: string[]; manifest: ImportManifest | null }> {
  const form = await req.formData();
  const part = form.get('manifest');
  return {
    files: form.getAll('files').map((f) => (f as File).name),
    manifest: typeof part === 'string' ? (JSON.parse(part) as ImportManifest) : null,
  };
}

/** An import route answering each file `created` under the key `keyOf` gives (default: its path's). */
function importRoute(
  keyOf: (p: string) => string | null = modelKeyFromPath,
  extra: (p: string) => Partial<ImportFileOutcome> = () => ({}),
) {
  return async (req: Request) => {
    const { files } = await request(req.clone());
    return json({
      files: files.map((p) => ({
        path: p,
        modelKey: keyOf(p),
        outcome: 'created',
        problem: null,
        ...extra(p),
      })),
    });
  };
}

const NOTHING_WAITING = {
  'GET /api/v1/projects/demo/analyses': () => json({ items: [], nextCursor: null }),
};

describe('analyzr import with the golden bundle of the integrate plugin', () => {
  it("pins the manifest's keys and sends its subset with the files", async () => {
    const manifest = JSON.parse(
      await readFile(path.join(BUNDLE, 'analyzr-import.json'), 'utf8'),
    ) as ImportManifest;
    const api = fakeApi({
      'POST /api/v1/projects/demo/imports': importRoute(),
      ...NOTHING_WAITING,
    });
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
    expect(await runCli(['import', BUNDLE, '-p', 'demo', '--json'], t.io)).toBe(0);
    const [only] = api.seen.filter((s) => s.method === 'POST');
    const sent = await request(only!.body);
    expect(sent.files).toEqual(manifest.files.map((f) => f.path));
    // The subset: format, source and the batch's files, nothing else (no inventory, no chain).
    expect(sent.manifest).toEqual({
      format: manifest.format,
      source: manifest.source,
      files: manifest.files,
    });
    const summary = JSON.parse(t.out()) as Record<string, unknown>;
    expect(Object.keys(summary)).toEqual(['project', 'files', 'counts', 'manifest']);
    expect(summary['manifest']).toEqual({
      system: 'signavio',
      listed: 6,
      stored: 6,
      kept: 0,
      unlisted: [],
      missing: [],
    });
  });

  it('accepts the bundle of an export with an empty exporterVersion (systemVersion "")', async () => {
    // tools/integrate 0.1.0 writes the attribute as read; the server stores it as absent.
    const root = path.join(dir, 'empty-version');
    const manifest = JSON.parse(
      await readFile(path.join(BUNDLE, 'analyzr-import.json'), 'utf8'),
    ) as ImportManifest;
    for (const f of manifest.files) {
      await write(root, f.path, await readFile(path.join(BUNDLE, f.path), 'utf8'));
    }
    await write(
      root,
      'analyzr-import.json',
      JSON.stringify({ ...manifest, source: { ...manifest.source, systemVersion: '' } }),
    );
    const api = fakeApi({
      'POST /api/v1/projects/demo/imports': importRoute(),
      ...NOTHING_WAITING,
    });
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
    expect(await runCli(['import', 'empty-version', '-p', 'demo'], t.io)).toBe(0);
    const sent = await request(api.seen.find((x) => x.method === 'POST')!.body);
    expect(sent.manifest?.source.systemVersion).toBe('');
  });

  it('says so in text mode', async () => {
    const api = fakeApi({
      'POST /api/v1/projects/demo/imports': importRoute(),
      ...NOTHING_WAITING,
    });
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
    expect(await runCli(['import', BUNDLE, '-p', 'demo'], t.io)).toBe(0);
    expect(t.out()).toContain(
      'manifest: analyzr-import.json (signavio), 6 of 6 files listed: keys pinned, provenance stored for 6\n',
    );
    expect(t.out()).not.toContain('import warning');
  });

  it('says when unchanged files keep the provenance analyzr had', async () => {
    const api = fakeApi({
      'POST /api/v1/projects/demo/imports': importRoute(modelKeyFromPath, () => ({
        outcome: 'unchanged',
      })),
      ...NOTHING_WAITING,
    });
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
    expect(await runCli(['import', BUNDLE, '-p', 'demo'], t.io)).toBe(0);
    expect(t.out()).toContain(
      'manifest: analyzr-import.json (signavio), 6 of 6 files listed: keys pinned, provenance stored for 0; 6 unchanged keep what analyzr had\n',
    );
  });
});

describe('analyzr import with a hand-written manifest', () => {
  it('lets pinned keys win over paths, also in the local duplicate check', async () => {
    const root = path.join(dir, 'pinned');
    await write(root, 'Gemeinsame Dokumente/Auftrag (neu).bpmn', '<bpmn/>');
    await write(root, 'vertrieb/auftrag.bpmn', '<bpmn/>');
    await write(root, 'ohne.bpmn', '<bpmn/>');
    await write(
      root,
      'analyzr-import.json',
      JSON.stringify({
        format: 'analyzr-import/1',
        source: { system: 'signavio' },
        files: [
          {
            path: 'Gemeinsame Dokumente/Auftrag (neu).bpmn',
            key: 'vertrieb/auftrag',
            externalId: 'sid-1',
          },
          { path: 'fehlt.bpmn', key: 'x/fehlt' },
        ],
        valueChain: { path: 'value-chain.vc.json' },
      }),
    );
    const pins = new Map([['Gemeinsame Dokumente/Auftrag (neu).bpmn', 'vertrieb/auftrag']]);
    const keyOf = (p: string) => pins.get(p) ?? modelKeyFromPath(p);
    const plan = planImport(await findBpmnFiles(root), keyOf);
    // The pinned file gets the key; the file whose path derives it fails locally, never sent.
    expect(plan.batches.flat().map((f) => [f.path, keyOf(f.path)])).toEqual([
      ['Gemeinsame Dokumente/Auftrag (neu).bpmn', 'vertrieb/auftrag'],
      ['ohne.bpmn', 'ohne'],
    ]);
    expect(plan.failed.map((f) => [f.path, f.problem?.detail])).toEqual([
      [
        'vertrieb/auftrag.bpmn',
        'another file of this import has model key vertrieb/auftrag (Gemeinsame Dokumente/Auftrag (neu).bpmn)',
      ],
    ]);

    const api = fakeApi({
      'POST /api/v1/projects/demo/imports': importRoute(keyOf),
      ...NOTHING_WAITING,
    });
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
    expect(await runCli(['import', 'pinned', '-p', 'demo'], t.io)).toBe(1);
    const sent = await request(api.seen.find((s) => s.method === 'POST')!.body);
    expect(sent.files).toEqual(['Gemeinsame Dokumente/Auftrag (neu).bpmn', 'ohne.bpmn']);
    expect(sent.manifest?.files.map((f) => f.path)).toEqual([
      'Gemeinsame Dokumente/Auftrag (neu).bpmn',
    ]);
    expect(t.out()).toContain(
      'manifest: analyzr-import.json (signavio), 1 of 3 files listed: keys pinned, provenance stored for 1\n',
    );
    expect(t.out()).toContain(
      'manifest: 2 files are not listed, keys from the path, no provenance: ohne.bpmn, vertrieb/auftrag.bpmn\n',
    );
    expect(t.out()).toContain('manifest: lists 1 file not below the folder: fehlt.bpmn\n');
    expect(t.out()).toContain('  created   vertrieb/auftrag\n');
    expect(t.out()).toContain(
      `value chain: the bundle has value-chain.vc.json; push it with analyzr value-chain push ${shellArg(path.join(root, 'value-chain.vc.json'))} -p demo --dry-run, then without --dry-run (owner key)\n`,
    );
  });

  it("sends each batch the manifest's subset of its own files", async () => {
    const root = path.join(dir, 'batches');
    const paths = Array.from(
      { length: MAX_IMPORT_FILES + 2 },
      (_, i) => `m/f${String(i).padStart(2, '0')}.bpmn`,
    );
    for (const p of paths) await write(root, p, '<bpmn/>');
    await write(
      root,
      'analyzr-import.json',
      JSON.stringify({
        format: 'analyzr-import/1',
        source: { system: 'aris' },
        files: paths.map((p) => ({ path: p, externalId: p })),
      }),
    );
    const api = fakeApi({
      'POST /api/v1/projects/demo/imports': importRoute(),
      ...NOTHING_WAITING,
    });
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
    expect(await runCli(['import', 'batches', '-p', 'demo', '--json'], t.io)).toBe(0);
    const sent = await Promise.all(
      api.seen.filter((s) => s.method === 'POST').map((s) => request(s.body)),
    );
    expect(sent.map((r) => r.files.length)).toEqual([MAX_IMPORT_FILES, 2]);
    for (const r of sent) expect(r.manifest?.files.map((f) => f.path)).toEqual(r.files);
  });

  it('--dry-run previews each batch with the whole manifest and merges what the import would change (M6 S2b)', async () => {
    const root = path.join(dir, 'preview');
    const paths = Array.from(
      { length: MAX_IMPORT_FILES + 2 },
      (_, i) => `m/f${String(i).padStart(2, '0')}.bpmn`,
    );
    for (const p of paths) await write(root, p, '<bpmn/>');
    await write(
      root,
      'analyzr-import.json',
      JSON.stringify({
        format: 'analyzr-import/1',
        source: { system: 'aris' },
        files: paths.map((p) => ({ path: p, externalId: p })),
      }),
    );
    const list = <T>(count: number, items: T[] = []) => ({ count, items });
    const call = (n: number) => ({ type: 'call', from: `m/f0${n}#Call`, to: `x#P${n}` });
    let batch = 0;
    const api = fakeApi({
      'POST /api/v1/projects/demo/imports': async (req, url) => {
        expect(url.searchParams.get('dryRun')).toBe('true');
        const { files } = await request(req.clone());
        batch++;
        return json({
          files: files.map((p) => ({
            path: p,
            modelKey: modelKeyFromPath(p),
            outcome: 'created',
            problem: null,
          })),
          impact: {
            files: files.map((p) => ({
              modelKey: modelKeyFromPath(p),
              factsChanged: true,
              processesAdded: [`${modelKeyFromPath(p)}#P`],
              processesRemoved: [],
              trust: { class: 'derived', reasons: ['no-engine'] },
            })),
            acceptedCalls: list(1, [call(batch)]),
            // M6 S2c, the trust rule: calls of derived models only proposed, with the
            // server's totals over all of them (past the listed items)
            callsProposed:
              batch === 1
                ? {
                    ...list(150, [
                      { ...call(3), wasAccepted: true },
                      { ...call(4), wasAccepted: false },
                    ]),
                    wasAccepted: 120,
                    byReason: [
                      { reason: 'no-engine', count: 140 },
                      { reason: 'agent-upload', count: 10 },
                    ],
                  }
                : {
                    ...list(2, [{ ...call(5), wasAccepted: false }]),
                    wasAccepted: 0,
                    byReason: [{ reason: 'agent-upload', count: 2 }],
                  },
            proposalsAdded: list(2),
            proposalsWithdrawn: list(0),
            endpointsChanged: list(0),
            findingsAdded: list(1, [
              { kind: 'unresolved-call', refs: ['m/f00#Call'], detail: 'x' },
            ]),
            findingsResolved: list(0),
            absentKeys: list(1, ['alt/modell']),
            relationsTasks: {
              queued: list(0),
              cancelled: list(0),
              claimed: 0,
              pairs: 0,
              rejudged: list(0),
            },
          },
        });
      },
    });
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
    expect(await runCli(['import', 'preview', '-p', 'demo', '--dry-run'], t.io)).toBe(0);
    const sent = await Promise.all(
      api.seen.filter((s) => s.method === 'POST').map((s) => request(s.body)),
    );
    expect(sent.map((r) => r.files.length)).toEqual([MAX_IMPORT_FILES, 2]);
    // every batch carries the whole manifest: the absent keys are the bundle's, not the batch's
    for (const r of sent) expect(r.manifest?.files).toHaveLength(paths.length);
    // a dry run lists no waiting tasks: nothing was imported
    expect(api.seen.some((s) => s.path.endsWith('/analyses'))).toBe(false);
    expect(t.out()).toContain(
      [
        'demo: dry run, nothing imported; the import would',
        `  change the facts of ${paths.length} models (${paths.length} processes added, 0 removed)`,
        '  agent work: none',
        '  accept rule-tier calls: 2: m/f01#Call → x#P1, m/f02#Call → x#P2',
        '  propose instead of accept (trust rule): 152 (no engine 140, agent token 12), 120 of them accepted until now: m/f03#Call → x#P3, m/f04#Call → x#P4, m/f05#Call → x#P5, … 149 more',
        '  add rule proposals: 4',
        '  withdraw rule stances: 0',
        '  change or lose an end of accepted relations: 0',
        '  findings: 2 added, 0 resolved: unresolved-call m/f00#Call, unresolved-call m/f00#Call',
        '  not in the bundle, kept in analyzr (nothing is deleted): 1 key: alt/modell',
        "  previewed in 2 batches, each against the project's head: a call into a later batch shows as unresolved, and the pairs between new models of different batches are not counted (after the import, the waiting line and analyzr status count them)",
        '',
      ].join('\n'),
    );
    // a dry run never creates the project
    const create = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
    expect(
      await runCli(['import', 'preview', '-p', 'neu', '--create', '--dry-run'], create.io),
    ).toBe(1);
    expect(create.err()).toContain('--dry-run previews into an existing project: drop --create');
  });

  it('stops before sending anything when the manifest is invalid', async () => {
    const root = path.join(dir, 'invalid');
    await write(root, 'a.bpmn', '<bpmn/>');
    for (const [text, why] of [
      ['{', /analyzr-import\.json is no JSON/],
      [
        JSON.stringify({ format: 'analyzr-import/1', source: { system: 'Signavio' }, files: [] }),
        /not a valid analyzr-import\/1 manifest \(source\.system: must be a lowercase slug/,
      ],
      [
        JSON.stringify({
          format: 'analyzr-import/1',
          source: { system: 's' },
          files: [
            { path: 'a.bpmn', key: 'x' },
            { path: 'b.bpmn', key: 'x' },
          ],
        }),
        /files\.1\.key: key x pinned twice/,
      ],
    ] as const) {
      await writeFile(path.join(root, 'analyzr-import.json'), text);
      const api = fakeApi({});
      const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
      expect(await runCli(['import', 'invalid', '-p', 'demo'], t.io)).toBe(1);
      expect(t.err()).toMatch(why);
      expect(t.err()).toContain('nothing imported');
      expect(api.seen).toEqual([]);
      // Also with --create: the manifest is checked before the project is created.
      const c = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
      expect(
        await runCli(['import', 'invalid', '-p', 'kunde', '--create', '--name', 'Kunde'], c.io),
      ).toBe(1);
      expect(c.out()).not.toContain('created project');
      expect(api.seen).toEqual([]);
    }
  });

  it("names the importer of a refused manifest: a newer converter's kind needs a newer analyzr", async () => {
    const root = path.join(dir, 'newer');
    await write(root, 'a.bpmn', '<bpmn/>');
    await write(
      root,
      'analyzr-import.json',
      JSON.stringify({
        format: 'analyzr-import/1',
        source: {
          system: 'signavio',
          importer: { name: 'analyzr-integrate/normalize-bpmn', version: '0.9.0' },
        },
        files: [{ path: 'a.bpmn', derived: { kind: 'generated' } }],
      }),
    );
    const api = fakeApi({});
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
    expect(await runCli(['import', 'newer', '-p', 'demo'], t.io)).toBe(1);
    expect(t.err()).toContain(
      '(files.0.derived.kind: Invalid option: expected one of "export"|"converted"|"reconstructed"|"as-told"); written by analyzr-integrate/normalize-bpmn 0.9.0: if that is newer than this analyzr, update analyzr; nothing imported',
    );
    expect(api.seen).toEqual([]);
  });

  it('refuses a folder whose bundles lie in subfolders, before anything is sent', async () => {
    const root = path.join(dir, 'bundles');
    for (const b of ['2026-10-14-signavio', '2026-11-02-signavio']) {
      await write(root, `${b}/vertrieb/auftrag.bpmn`, '<bpmn/>');
      await write(
        root,
        `${b}/analyzr-import.json`,
        JSON.stringify({ format: 'analyzr-import/1', source: { system: 'signavio' }, files: [] }),
      );
    }
    const api = fakeApi({});
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
    expect(await runCli(['import', 'bundles', '-p', 'demo', '--create'], t.io)).toBe(1);
    expect(t.err()).toContain(
      'found analyzr-import.json in 2026-10-14-signavio/ and 1 more folder: import each bundle folder by itself (otherwise every key would start with the folder name); nothing imported',
    );
    expect(api.seen).toEqual([]);
    // One bundle folder imports.
    const ok = fakeApi({
      'POST /api/v1/projects/demo/imports': importRoute(),
      ...NOTHING_WAITING,
    });
    const one = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, ok.fetch, { cwd: dir });
    expect(await runCli(['import', 'bundles/2026-10-14-signavio', '-p', 'demo'], one.io)).toBe(0);
  });

  it('prints the import warnings of each file and counts them; they never fail the import', async () => {
    const root = path.join(dir, 'warned');
    await write(root, 'a.bpmn', '<bpmn/>');
    await write(root, 'b.bpmn', '<bpmn/>');
    await write(
      root,
      'analyzr-import.json',
      JSON.stringify({
        format: 'analyzr-import/1',
        source: { system: 'signavio' },
        files: [
          { path: 'a.bpmn', externalId: 'sid-1', sha256: '0'.repeat(64) },
          { path: 'b.bpmn', externalId: 'sid-2' },
        ],
      }),
    );
    const warnings: Record<string, ImportFileOutcome['importWarnings']> = {
      'a.bpmn': [
        {
          code: 'manifest-sha-mismatch',
          message:
            "the file's sha256 111111111111… differs from the manifest's 000000000000…; imported anyway",
          manifestSha256: '0'.repeat(64),
          fileSha256: '1'.repeat(64),
        },
        {
          code: 'external-id-moved',
          message: 'signavio id sid-1 already belongs to alt: likely renamed or moved in the tool',
          system: 'signavio',
          externalId: 'sid-1',
          otherKeys: ['alt'],
        },
      ],
      'b.bpmn': [
        {
          code: 'external-id-changed',
          message: 'b carries aris id A-1; this file declares signavio id sid-2',
          system: 'signavio',
          externalId: 'sid-2',
          previous: { system: 'aris', externalId: 'A-1' },
        },
      ],
    };
    const route = importRoute(modelKeyFromPath, (p) => {
      const w = warnings[p];
      return w === undefined ? {} : { importWarnings: w };
    });
    const api = fakeApi({ 'POST /api/v1/projects/demo/imports': route, ...NOTHING_WAITING });
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
    expect(await runCli(['import', 'warned', '-p', 'demo'], t.io)).toBe(0);
    expect(t.out()).toContain(
      [
        '  created   a',
        "      manifest-sha-mismatch: the file's sha256 111111111111… differs from the manifest's 000000000000…; imported anyway",
        '      external-id-moved: signavio id sid-1 already belongs to alt: likely renamed or moved in the tool',
        '  created   b',
        '      external-id-changed: b carries aris id A-1; this file declares signavio id sid-2',
        'demo: 2 files, 2 created, 0 revised, 0 unchanged, 0 failed',
        'demo: 3 import warnings (external-id-changed 1, external-id-moved 1, manifest-sha-mismatch 1); the files were imported',
      ].join('\n'),
    );
    // What to do about them, before the agent step.
    expect(t.out()).toContain(
      [
        'demo: 0 relations tasks waiting, placement task waiting: no',
        "next: same model twice? delete the extra key (analyzr models delete -p demo a) and re-import with the key pinned (keymap.json; analyzr models external-ids -p demo lists analyzr's keys)",
        'next: different models? re-import the aris bundle and give the signavio bundle a key prefix (signavio/…)',
        '',
      ].join('\n'),
    );
    const j = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
    expect(await runCli(['import', 'warned', '-p', 'demo', '--json'], j.io)).toBe(0);
    const summary = JSON.parse(j.out()) as { files: ImportFileOutcome[] };
    expect(summary.files.map((f) => f.importWarnings)).toEqual([
      warnings['a.bpmn'],
      warnings['b.bpmn'],
    ]);
  });
});

describe('analyzr models external-ids', () => {
  const list = {
    items: [
      {
        key: 'finanzen/rechnung',
        system: 'signavio',
        externalId: 'sid-3F4A',
        externalPath: 'Finanzen/Rechnung',
      },
      {
        key: 'vertrieb/auftrag',
        system: 'signavio',
        externalId: null,
        externalPath: 'Vertrieb/Auftrag',
      },
    ],
  };

  it('lists the identities as text and JSON, optionally of one system', async () => {
    const api = fakeApi({ 'GET /api/v1/projects/demo/external-ids': () => json(list) });
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
    expect(
      await runCli(['models', 'external-ids', '-p', 'demo', '--system', 'signavio'], t.io),
    ).toBe(0);
    expect(t.out()).toBe(
      [
        '  finanzen/rechnung  sid-3F4A  Finanzen/Rechnung',
        '  vertrieb/auftrag   -         Vertrieb/Auftrag',
        'demo (system signavio): 2 models from signavio',
        '',
      ].join('\n'),
    );
    expect(new URL(api.seen[0]!.body.url).searchParams.get('system')).toBe('signavio');
    const j = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
    expect(await runCli(['models', 'external-ids', '-p', 'demo', '--json'], j.io)).toBe(0);
    expect(JSON.parse(j.out())).toEqual(list);
    expect(new URL(api.seen[1]!.body.url).searchParams.has('system')).toBe(false);
  });

  it('names a tool id that several keys carry (one model twice)', async () => {
    const twice = {
      items: [
        ...list.items,
        {
          key: 'vertrieb/rechnung',
          system: 'signavio',
          externalId: 'sid-3F4A',
          externalPath: 'Vertrieb/Rechnung',
        },
      ],
    };
    const api = fakeApi({ 'GET /api/v1/projects/demo/external-ids': () => json(twice) });
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
    expect(await runCli(['models', 'external-ids', '-p', 'demo'], t.io)).toBe(0);
    expect(t.out()).toContain(
      'demo: 3 models from signavio\nsignavio id sid-3F4A on 2 keys: finanzen/rechnung, vertrieb/rechnung (one model twice? analyzr models delete -p demo <key>)\n',
    );
    const j = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
    expect(await runCli(['models', 'external-ids', '-p', 'demo', '--json'], j.io)).toBe(0);
    expect(JSON.parse(j.out())).toEqual(twice);
  });

  it('says when nothing is declared, and refuses a system that is no slug before any request', async () => {
    const api = fakeApi({ 'GET /api/v1/projects/demo/external-ids': () => json({ items: [] }) });
    const t = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
    expect(await runCli(['models', 'external-ids', '-p', 'demo'], t.io)).toBe(0);
    expect(t.out()).toBe('no models with a declared source system in demo\n');
    const bad = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, { cwd: dir });
    expect(
      await runCli(['models', 'external-ids', '-p', 'demo', '--system', 'SAP Signavio'], bad.io),
    ).toBe(1);
    expect(bad.err()).toContain('not a source system: "SAP Signavio"');
    expect(api.seen).toHaveLength(1);
  });
});

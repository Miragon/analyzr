// Spec folders, their key plan and their bundle (src/spec/bundle.ts, M6 S3c §3.5, §3.6): the
// manifest analyzr reads (validated with the contracts' schema), the derivation per spec,
// keys only from keymap.json, the refusals, and the flag replaces-known-model.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { ImportManifest as ManifestSchema } from '@analyzr/contracts/import-manifest';
import { describe, expect, it } from 'vitest';

import { BundleError } from '../src/bundle.ts';
import { PathGuardError } from '../src/guards.ts';
import { applyPlan, emptyKeymap, planKeys, type Keymap } from '../src/keymap.ts';
import {
  planSpecFolder,
  planSpecs,
  readSpecFile,
  scanSpecs,
  specFolderMark,
  SpecBundleError,
  writeSpecBundle,
} from '../src/spec/bundle.ts';
import { compactSpecBundle, compactSpecPlan } from '../src/spec/compact.ts';
import { assertSpecOutput, workspaceOf } from '../src/spec/guards.ts';
import { renderSpec } from '../src/spec/render.ts';

import { SPEC_FIXTURES, goldenSpec } from './spec-support.ts';
import { REPO_ROOT, tempDir } from './support.ts';

const SYSTEM = 'images';
const HAND = [
  'minimal',
  'lanes-gateways',
  'unnamed-messages',
  'calls-and-stores',
  'long-texts',
  'reconstructed',
];

/** A spec folder in a temporary workspace with copies of the given fixtures. */
async function specFolder(
  names: readonly string[],
  sub = '',
): Promise<{ ws: string; specs: string }> {
  const ws = await tempDir();
  await writeFile(path.join(ws, 'analyzr-workspace.json'), '{}\n');
  const specs = path.join(ws, 'specs', '2026-10-14-images');
  await mkdir(path.join(specs, sub), { recursive: true });
  for (const name of names) {
    await copyFile(
      path.join(SPEC_FIXTURES, `${name}.spec.yaml`),
      path.join(specs, sub, `${name}.spec.yaml`),
    );
  }
  return { ws, specs };
}

/** The key map after the consultant confirmed the plan of `specs`. */
async function confirmed(specs: string, keymap: Keymap = emptyKeymap()): Promise<Keymap> {
  const { plan } = await planSpecFolder(keymap, specs, {
    system: SYSTEM,
    ...(keymap.systems[SYSTEM] === undefined
      ? { rule: { strip: null, prefix: null }, scope: null }
      : {}),
  });
  return applyPlan(keymap, plan, path.basename(specs));
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

describe('writeSpecBundle', () => {
  it('renders every spec at its confirmed key with a manifest analyzr accepts', async () => {
    const { ws, specs } = await specFolder(HAND);
    const out = path.join(ws, 'bundles', '2026-10-14-images');
    const result = await writeSpecBundle({
      specDir: specs,
      outDir: out,
      system: SYSTEM,
      keymap: await confirmed(specs),
      exportedAt: '2026-10-14',
    });
    expect(result.failed).toEqual([]);
    const manifest = JSON.parse(
      await readFile(path.join(out, 'analyzr-import.json'), 'utf8'),
    ) as unknown;
    expect(ManifestSchema.safeParse(manifest).success).toBe(true);
    expect(result.manifest.source).toEqual({
      system: 'images',
      systemVersion: null,
      exportedAt: '2026-10-14T00:00:00Z',
      importer: { name: 'analyzr-integrate/analyzr-spec', version: '0.1.0' },
    });
    expect(
      result.manifest.files.map((f) => [f.key, f.externalPath, f.losses?.map((l) => l.code)]),
    ).toEqual([
      [
        'finanzen/monatsabschluss',
        'Finanzen/Monatsabschluss',
        ['layout-generated', 'link-unresolved'],
      ],
      [
        'qualitaet/lange-texte',
        'Qualität/Lange Texte',
        ['id-rewritten', 'layout-generated', 'text-truncated'],
      ],
      ['service/anfrage-beantworten', 'Service/Anfrage beantworten', ['layout-generated']],
      ['service/reklamation', 'Service/Reklamation', ['layout-generated', 'link-unresolved']],
      ['service/rueckmeldung-einholen', 'Service/Rückmeldung einholen', ['layout-generated']],
      ['vertrieb/bestellung-bearbeiten', 'Vertrieb/Bestellung bearbeiten', ['layout-generated']],
    ]);
    for (const f of result.manifest.files) {
      expect(f.path).toBe(`${f.key}.bpmn`);
      expect(f).not.toHaveProperty('externalId');
      expect(f).not.toHaveProperty('url');
      expect(f.derived).toEqual({
        kind: 'reconstructed',
        converter: null,
        llmModel: 'claude-opus-5-5',
        from: [],
      });
      const bytes = new Uint8Array(await readFile(path.join(out, f.path)));
      expect(f.sha256).toBe(sha256(bytes));
    }
    // the bytes are the renderer's for the confirmed key
    const reklamation = await renderSpec(await goldenSpec('reconstructed'), {
      key: 'service/reklamation',
    });
    expect(await readFile(path.join(out, 'service/reklamation.bpmn'), 'utf8')).toBe(
      reklamation.xml,
    );
    const file = result.files.find((f) => f.key === 'service/reklamation');
    expect(file).toMatchObject({
      spec: 'reconstructed.spec.yaml',
      kind: 'reconstructed',
      calls: [{ node: 'gutschrift', id: 'Activity_gutschrift', target: 'Gutschrift erstellen' }],
      notes: [
        { node: 'ablehnen', text: 'Pfeil zur Ablehnung nur schwach zu sehen' },
        {
          node: null,
          text: 'Rechts unten ein durchgestrichener Kasten „Rückruf“: nicht übernommen.',
        },
      ],
      modelName: 'Reklamationsbearbeitung',
      nodes: { start: 1, task: 2, gateway: 1, call: 1, end: 1 },
    });
    expect(compactSpecBundle(result)).toMatchObject({
      counts: { models: 6, reconstructed: 6, converted: 0, failed: 0 },
      losses: {
        'id-rewritten': expect.any(Number) as unknown,
        'link-unresolved': 3,
        'text-truncated': 2,
      },
      calls: { count: 3 },
    });
  });

  it('refuses as-told until S6, converter output without its run record, and invalid specs', async () => {
    const asTold = await specFolder(['minimal', 'as-told']);
    await expect(
      writeSpecBundle({
        specDir: asTold.specs,
        outDir: path.join(asTold.ws, 'bundles', 'x'),
        system: SYSTEM,
        keymap: await confirmed(asTold.specs),
      }),
    ).rejects.toMatchObject({
      code: 'as-told',
      message: expect.stringMatching(
        /^as-told\.spec\.yaml: as-told needs an interview source \(S6\)/,
      ) as unknown,
    });

    const record = await specFolder(['minimal']);
    await writeFile(path.join(record.specs, 'analyzr-specs.json'), '{}\n');
    await expect(scanSpecs(record.specs)).resolves.toMatchObject({
      runRecord: true,
      skipped: ['analyzr-specs.json'],
    });
    await expect(
      planSpecFolder(emptyKeymap(), record.specs, { system: SYSTEM }),
    ).rejects.toMatchObject({ code: 'run-record' });

    const converter = await specFolder(['collaboration']);
    const err = (await planSpecFolder(emptyKeymap(), converter.specs, { system: SYSTEM }).catch(
      (e: unknown) => e,
    )) as SpecBundleError;
    expect(err).toBeInstanceOf(SpecBundleError);
    expect(err.code).toBe('invalid-specs');
    expect(err.message).toMatch(
      /collaboration\.spec\.yaml: source\.externalId: a spec you write has no tool id or link/,
    );

    const empty = await specFolder([]);
    await expect(
      planSpecFolder(emptyKeymap(), empty.specs, { system: SYSTEM }),
    ).rejects.toMatchObject({ code: 'no-specs' });
  });

  it('takes keys only from keymap.json and writes into an empty folder only', async () => {
    const { ws, specs } = await specFolder(['minimal', 'reconstructed']);
    const out = path.join(ws, 'bundles', 'b');
    await expect(
      writeSpecBundle({ specDir: specs, outDir: out, system: SYSTEM, keymap: emptyKeymap() }),
    ).rejects.toMatchObject({ code: 'keys-unconfirmed' });
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, 'old.txt'), 'x');
    await expect(
      writeSpecBundle({
        specDir: specs,
        outDir: out,
        system: SYSTEM,
        keymap: await confirmed(specs),
      }),
    ).rejects.toMatchObject({ code: 'bundle-not-empty' });
    await expect(
      writeSpecBundle({
        specDir: specs,
        outDir: path.join(ws, 'bundles', 'c'),
        system: SYSTEM,
        keymap: await confirmed(specs),
        exportedAt: 'gestern',
      }),
    ).rejects.toBeInstanceOf(BundleError);
  });

  it('lists a model the renderer refuses as failed and bundles the others', async () => {
    const { ws, specs } = await specFolder(['minimal']);
    const nodes = Array.from({ length: 5000 }, (_, i) => ({
      source: `ev${i}`,
      type: 'event',
      direction: 'catch',
      trigger: 'timer',
      name: `Warten ${i}`,
    }));
    const flows = nodes.slice(1).map((n, i) => ({ from: `ev${i}`, to: n.source }));
    await writeFile(
      path.join(specs, 'riesig.spec.json'),
      JSON.stringify({
        format: 'analyzr-spec/1',
        source: { externalPath: 'Service/Riesig' },
        derived: { kind: 'reconstructed', llmModel: 'claude-opus-5-5' },
        processes: [{ source: 'p', nodes, flows }],
      }),
    );
    const result = await writeSpecBundle({
      specDir: specs,
      outDir: path.join(ws, 'bundles', 'b'),
      system: SYSTEM,
      keymap: await confirmed(specs),
    });
    expect(result.files.map((f) => f.key)).toEqual(['service/anfrage-beantworten']);
    expect(result.failed).toEqual([
      expect.objectContaining({
        spec: 'riesig.spec.json',
        key: 'service/riesig',
        code: expect.stringMatching(/^too-(large|many-elements)$/) as unknown,
      }),
    ]);
    expect(result.manifest.files).toHaveLength(1);
  }, 60_000);

  it('matches an inventory to the bundled models by name', async () => {
    const { ws, specs } = await specFolder(['reconstructed']);
    const result = await writeSpecBundle({
      specDir: specs,
      outDir: path.join(ws, 'bundles', 'b'),
      system: SYSTEM,
      keymap: await confirmed(specs),
      inventory: {
        format: 'analyzr-inventory/1',
        items: [
          { id: 'i1', name: 'Reklamationsbearbeitung' },
          { id: 'i2', name: 'Urlaubsantrag' },
        ],
      },
    });
    expect(result.coverage).toEqual({
      items: 2,
      matched: [],
      proposed: [{ id: 'i1', name: 'Reklamationsbearbeitung', keys: ['service/reklamation'] }],
      missing: [{ id: 'i2', name: 'Urlaubsantrag' }],
    });
    expect(result.manifest.inventory).toEqual({ path: 'inventory.json' });
  });
});

describe('planning a spec folder', () => {
  it('derives keys from the tool paths and lists the tool folders', async () => {
    const { specs } = await specFolder(['minimal', 'reconstructed', 'lanes-gateways'], 'Archiv');
    const {
      plan,
      specs: planned,
      scanned,
    } = await planSpecFolder(emptyKeymap(), specs, {
      system: SYSTEM,
      rule: { strip: null, prefix: 'bilder' },
    });
    expect(planned).toEqual([
      {
        spec: 'Archiv/minimal.spec.yaml',
        path: 'Service/Anfrage beantworten.bpmn',
        key: 'bilder/service/anfrage-beantworten',
        status: 'new',
      },
      {
        spec: 'Archiv/reconstructed.spec.yaml',
        path: 'Service/Reklamation.bpmn',
        key: 'bilder/service/reklamation',
        status: 'new',
      },
      {
        spec: 'Archiv/lanes-gateways.spec.yaml',
        path: 'Vertrieb/Bestellung bearbeiten.bpmn',
        key: 'bilder/vertrieb/bestellung-bearbeiten',
        status: 'new',
      },
    ]);
    expect(compactSpecPlan({ plan, specs: planned }, scanned)).toMatchObject({
      counts: { models: 3, new: 3 },
      replacesKnownModel: 0,
      folders: {
        count: 2,
        items: [
          { folder: 'Service', models: 2 },
          { folder: 'Vertrieb', models: 1 },
        ],
      },
      archiveLike: { count: 0 },
    });
  });

  it('names archive-like tool folders of the specs’ tool paths', async () => {
    const { specs } = await specFolder(['minimal']);
    const archived = (
      await readFile(path.join(SPEC_FIXTURES, 'minimal.spec.yaml'), 'utf8')
    ).replace(
      'externalPath: Service/Anfrage beantworten',
      'externalPath: Archiv/Service/Anfrage beantworten',
    );
    await writeFile(path.join(specs, 'alt.spec.yaml'), archived);
    const planned = await planSpecFolder(emptyKeymap(), specs, { system: SYSTEM });
    expect(compactSpecPlan(planned, planned.scanned)).toMatchObject({
      folders: {
        count: 2,
        items: [
          { folder: 'Archiv/Service', models: 1 },
          { folder: 'Service', models: 1 },
        ],
      },
      archiveLike: { count: 1, items: ['Archiv'] },
    });
  });

  it('flags a spec the agent wrote that takes a key a real export already holds', async () => {
    const { specs } = await specFolder(['reconstructed', 'minimal']);
    // a BPMN export of the same tool path got its key first
    const exported = planKeys(
      emptyKeymap(),
      [
        {
          path: 'Service/Reklamation.bpmn',
          externalId: 'sid-4711',
          externalPath: 'Service/Reklamation',
        },
      ],
      { system: SYSTEM, rule: { strip: null, prefix: null }, scope: null },
    );
    const keymap = applyPlan(emptyKeymap(), exported, 'export');
    const { plan } = await planSpecFolder(keymap, specs, { system: SYSTEM });
    expect(plan.files.map((f) => [f.key, f.status, f.flags])).toEqual([
      ['service/anfrage-beantworten', 'new', []],
      ['service/reklamation', 'known', ['replaces-known-model']],
    ]);
    expect(plan.counts.flagged).toBe(1);
    // a model with a tool id is a tool's: flagged also once this folder wrote the system's plan
    const mark = 'specs/2026-10-14-images';
    const again = await planSpecFolder(
      applyPlan(keymap, plan, mark),
      specs,
      { system: SYSTEM },
      mark,
    );
    expect(again.plan.files.map((f) => [f.key, f.flags])).toEqual([
      ['service/anfrage-beantworten', []],
      ['service/reklamation', ['replaces-known-model']],
    ]);
  });

  it('leaves the keys its own last plan wrote unflagged, and flags keys it cannot tell apart after another plan', async () => {
    const { ws, specs } = await specFolder(['reconstructed', 'minimal']);
    const mark = specFolderMark(ws, specs);
    expect(mark).toBe('specs/2026-10-14-images');
    const first = await planSpecFolder(emptyKeymap(), specs, { system: SYSTEM }, mark);
    expect(first.plan.counts.flagged).toBe(0);
    const keymap = applyPlan(emptyKeymap(), first.plan, mark);
    const replan = await planSpecFolder(keymap, specs, { system: SYSTEM }, mark);
    expect(replan.plan.files.map((f) => [f.status, f.flags])).toEqual([
      ['known', []],
      ['known', []],
    ]);
    expect(compactSpecPlan(replan, replan.scanned)).toMatchObject({
      counts: { known: 2, flagged: 0 },
      replacesKnownModel: 0,
    });
    // another folder (an export without tool ids, say) wrote the system's last plan since
    const system = keymap.systems[SYSTEM];
    if (system === undefined) throw new Error('no system');
    const other: Keymap = {
      ...keymap,
      systems: { [SYSTEM]: { ...system, lastExport: '2026-10-20-images' } },
    };
    const after = await planSpecFolder(other, specs, { system: SYSTEM }, mark);
    expect(after.plan.files.map((f) => f.flags)).toEqual([
      ['replaces-known-model'],
      ['replaces-known-model'],
    ]);
    expect(compactSpecPlan(after, after.scanned)).toMatchObject({
      counts: { flagged: 2 },
      replacesKnownModel: 2,
    });
    // a spec folder right in the workspace is marked apart from an export folder's name
    expect(specFolderMark(ws, path.join(ws, 'bilder'))).toBe('./bilder');
  });

  it('flags a new key analyzr already has, which a tool’s model may hold', async () => {
    const { specs } = await specFolder(['reconstructed']);
    const { plan } = await planSpecFolder(emptyKeymap(), specs, {
      system: 'signavio',
      rule: { strip: null, prefix: null },
      existingKeys: ['service/reklamation'],
    });
    expect(plan.files.map((f) => [f.key, f.status, f.flags])).toEqual([
      ['service/reklamation', 'new', ['exists-in-analyzr', 'replaces-known-model']],
    ]);
    expect(plan.counts.flagged).toBe(1);
  });

  it('refuses two specs of one model', async () => {
    const { specs } = await specFolder(['reconstructed']);
    await copyFile(
      path.join(SPEC_FIXTURES, 'reconstructed.spec.yaml'),
      path.join(specs, 'kopie.spec.yaml'),
    );
    const scanned = await scanSpecs(specs);
    expect(
      scanned.specs.map((s) => [s.file, s.errors.map((e) => `${e.path}: ${e.message}`)]),
    ).toEqual([
      ['kopie.spec.yaml', []],
      [
        'reconstructed.spec.yaml',
        [
          'source.externalPath: "Service/Reklamation" is also the tool path of kopie.spec.yaml: write one spec per model',
        ],
      ],
    ]);
    expect(() => planSpecs(emptyKeymap(), scanned, { system: SYSTEM })).not.toThrow();
  });
});

describe('reading spec files', () => {
  it('reads a regular file only, and never more than a spec may have', async () => {
    const { specs } = await specFolder(['minimal']);
    const big = path.join(specs, 'gross.spec.yaml');
    await writeFile(big, '');
    await truncate(big, 3 * 1024 * 1024 * 1024); // sparse: 3 GB, never read
    expect((await readSpecFile(big, 'gross.spec.yaml', 'hand')).errors).toEqual([
      {
        path: '',
        code: 'too-large',
        message: `${3 * 1024 * 1024 * 1024} bytes; a spec holds one model in at most 2097152 bytes`,
      },
    ]);
    const fifo = path.join(specs, 'rohr.spec.yaml');
    execFileSync('mkfifo', [fifo]);
    expect((await readSpecFile(fifo, 'rohr.spec.yaml', 'hand')).errors).toEqual([
      { path: '', code: 'not-a-file', message: 'not a regular file: a spec is a file' },
    ]);
    const link = path.join(specs, 'link.spec.yaml');
    await symlink(path.join(specs, 'minimal.spec.yaml'), link);
    expect((await readSpecFile(link, 'link.spec.yaml', 'hand')).errors).toEqual([
      { path: '', code: 'not-a-file', message: 'a symbolic link: name the spec file itself' },
    ]);
    await expect(
      readSpecFile(path.join(specs, 'fehlt.spec.yaml'), 'fehlt.spec.yaml', 'hand'),
    ).rejects.toThrow('fehlt.spec.yaml does not exist');
    // a folder scan lists neither the pipe nor the link, and reads the large file as too large
    const scanned = await scanSpecs(specs);
    expect(scanned.specs.map((f) => [f.file, f.errors.map((e) => e.code)])).toEqual([
      ['gross.spec.yaml', ['too-large']],
      ['minimal.spec.yaml', []],
    ]);
    expect(scanned.symlinks).toBe(1);
  });
});

describe('where analyzr-spec writes', () => {
  it('never into the spec folder, below exports/ or into a checkout', async () => {
    const { ws, specs } = await specFolder(['minimal']);
    expect(() =>
      assertSpecOutput(path.join(specs, 'b'), '--out', { specs, workspace: ws }),
    ).toThrow(PathGuardError);
    expect(() =>
      assertSpecOutput(path.join(ws, 'exports', '2026-10-14-visio', 'b'), '--out', {
        specs,
        workspace: ws,
      }),
    ).toThrow(/the customer's exports stay untouched/);
    expect(() =>
      assertSpecOutput(path.join(REPO_ROOT, 'tmp-bundle'), '--out', { specs, workspace: ws }),
    ).toThrow(/inside the analyzr checkout/);
    expect(() =>
      assertSpecOutput(path.join(ws, 'bundles', 'b'), '--out', { specs, workspace: ws }),
    ).not.toThrow();
    // below the exports/ of the workspace the target lies in, whichever workspace was named
    const other = await tempDir();
    expect(() =>
      assertSpecOutput(path.join(ws, 'exports', 'e1', 'x.bpmn'), '<out.bpmn>', {
        workspace: other,
      }),
    ).toThrow(/the customer's exports stay untouched/);
    expect(workspaceOf(path.join(specs, 'neu', 'x.bpmn'))).toBe(await realpath(ws));
    expect(workspaceOf(other)).toBeNull();
    expect(await readdir(ws)).toEqual(['analyzr-workspace.json', 'specs']);
  });
});

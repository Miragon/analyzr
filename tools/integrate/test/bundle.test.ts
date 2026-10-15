// The import bundle analyzr-import/1 (src/bundle.ts, M6 §3.2, §3.7 step 4). The bundle of the
// Signavio-style fixture is golden: test/fixtures/signavio/bundle (rewrite it with
// ANALYZR_UPDATE_GOLDEN=1); apps/cli and apps/web derive their keys from the same folder.
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { isImportPath, modelKeyFromPath, modelKeyOwners } from '@analyzr/contracts/paths';
import { describe, expect, it } from 'vitest';

import {
  BundleError,
  coverageOf,
  MANIFEST_FILE,
  normalizeExportedAt,
  parseInventory,
  scanExport,
  writeBundle,
  type ImportManifest,
} from '../src/bundle.ts';
import { applyPlan, emptyKeymap, planKeys, type Keymap } from '../src/keymap.ts';
import { NORMALIZE_BPMN_VERSION } from '../src/version.ts';

import {
  bpmn,
  copyExport,
  SIGNAVIO_BUNDLE,
  SIGNAVIO_EXPORT,
  SIGNAVIO_EXPORTED_AT,
  SIGNAVIO_RULE,
  tempDir,
} from './support.ts';

const SYSTEM = 'signavio';

/**
 * Per normalize-bpmn version, the sha256 of the golden bundle's models (paths and bytes): a
 * change to what normalize-bpmn writes needs a new NORMALIZE_BPMN_VERSION (src/version.ts),
 * since bundles declare `derived.converter: "normalize-bpmn@<version>"`. Only when the
 * fixture export itself changed may the hash of the unreleased version be replaced.
 */
const CONVERTER_OUTPUTS: Readonly<Record<string, string>> = {
  '0.1.0': '8866a48abada375525a38abbfb6c10b0e3ce8193df081c006179afece409d31f',
};

async function confirmedKeymap(
  exportPath: string,
  keymap: Keymap = emptyKeymap(),
  exclude?: string[],
): Promise<Keymap> {
  const { models } = await scanExport(exportPath);
  const plan = planKeys(keymap, models, {
    system: SYSTEM,
    ...(keymap.systems[SYSTEM] === undefined ? { rule: SIGNAVIO_RULE, scope: null } : {}),
    ...(exclude === undefined ? {} : { exclude }),
  });
  return applyPlan(keymap, plan, path.basename(exportPath));
}

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
    .sort();
}

async function manifestOf(dir: string): Promise<ImportManifest> {
  return JSON.parse(await readFile(path.join(dir, MANIFEST_FILE), 'utf8')) as ImportManifest;
}

describe('writeBundle on the Signavio-style fixture', () => {
  it('writes the golden bundle', async () => {
    const out = path.join(await tempDir(), 'bundle');
    await writeBundle({
      exportPath: SIGNAVIO_EXPORT,
      outDir: out,
      system: SYSTEM,
      keymap: await confirmedKeymap(SIGNAVIO_EXPORT),
      exportedAt: SIGNAVIO_EXPORTED_AT,
    });
    if (process.env['ANALYZR_UPDATE_GOLDEN'] === '1') {
      await rm(SIGNAVIO_BUNDLE, { recursive: true, force: true });
      await cp(out, SIGNAVIO_BUNDLE, { recursive: true });
    }
    expect(await files(out)).toEqual(await files(SIGNAVIO_BUNDLE));
    for (const file of await files(out)) {
      expect(
        await readFile(path.join(out, file), 'utf8'),
        `${file} differs from the golden bundle`,
      ).toBe(await readFile(path.join(SIGNAVIO_BUNDLE, file), 'utf8'));
    }
  });

  it('moves the converter version whenever the converted bytes change', async () => {
    const hash = createHash('sha256');
    for (const file of (await files(SIGNAVIO_BUNDLE)).filter((f) => f.endsWith('.bpmn'))) {
      hash
        .update(`${file}\0`)
        .update(await readFile(path.join(SIGNAVIO_BUNDLE, file)))
        .update('\0');
    }
    const digest = hash.digest('hex');
    expect(
      digest,
      `normalize-bpmn ${NORMALIZE_BPMN_VERSION} wrote these bytes before: bump NORMALIZE_BPMN_VERSION in src/version.ts and add {'<new version>': '${digest}'} to CONVERTER_OUTPUTS`,
    ).toBe(CONVERTER_OUTPUTS[NORMALIZE_BPMN_VERSION]);
  });

  it('declares provenance, pinned keys, kinds, losses and checksums (forward compatible)', async () => {
    const manifest = await manifestOf(SIGNAVIO_BUNDLE);
    expect(manifest.format).toBe('analyzr-import/1');
    expect(manifest.source).toEqual({
      system: 'signavio',
      systemVersion: '19.6.0',
      exportedAt: '2026-10-14T00:00:00Z',
      importer: { name: 'analyzr-integrate/normalize-bpmn', version: '0.1.0' },
    });
    expect(manifest.files.map((f) => [f.key, f.derived.kind, f.losses ?? []])).toEqual([
      ['archiv/auftragsabwicklung-alt', 'export', []],
      ['finanzen/bonitaetspruefung', 'converted', [{ code: 'id-rewritten', count: 4 }]],
      ['finanzen/rechnungsstellung', 'converted', []],
      ['logistik/versand', 'converted', [{ code: 'id-rewritten', count: 2 }]],
      ['vertrieb/angebotserstellung', 'export', []],
      ['vertrieb/auftragsabwicklung', 'export', []],
    ]);
    for (const f of manifest.files) {
      expect(f.path).toBe(`${f.key}.bpmn`);
      expect(f.externalId).toMatch(/^sid-/);
      expect(f.derived).toEqual(
        f.derived.kind === 'export'
          ? { kind: 'export', converter: null, llmModel: null, from: [] }
          : { kind: 'converted', converter: 'normalize-bpmn@0.1.0', llmModel: null, from: [] },
      );
      const bytes = await readFile(path.join(SIGNAVIO_BUNDLE, f.path));
      expect(f.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    }
    expect(manifest.files.find((f) => f.key === 'finanzen/bonitaetspruefung')?.externalPath).toBe(
      'Gemeinsame Dokumente/Finanzen/Bonitätsprüfung',
    );
  });

  it('puts every model at its pinned key’s path, so today’s import derives the same keys', async () => {
    const manifest = await manifestOf(SIGNAVIO_BUNDLE);
    const picked = (await files(SIGNAVIO_BUNDLE)).filter(isImportPath);
    expect(picked).toEqual(manifest.files.map((f) => f.path));
    expect(isImportPath(MANIFEST_FILE)).toBe(false);
    expect(isImportPath('inventory.json')).toBe(false);
    expect(isImportPath('value-chain.vc.json')).toBe(false);
    expect(picked.map(modelKeyFromPath)).toEqual(manifest.files.map((f) => f.key));
    expect([...modelKeyOwners(picked).keys()]).toEqual(manifest.files.map((f) => f.key));
  });

  it('keeps every key after a folder move in the export (keymap.json)', async () => {
    const first = await copyExport('2026-10-14-signavio');
    const keymap = await confirmedKeymap(first);
    const out1 = path.join(await tempDir(), 'b1');
    await writeBundle({ exportPath: first, outDir: out1, system: SYSTEM, keymap });

    // The re-export: Versand moved to a new tool folder, the archived copy deleted.
    const second = await copyExport('2026-10-21-signavio');
    await mkdir(path.join(second, 'Gemeinsame Dokumente/Supply Chain'));
    await rename(
      path.join(second, 'Gemeinsame Dokumente/Logistik/Versand.bpmn'),
      path.join(second, 'Gemeinsame Dokumente/Supply Chain/Versand.bpmn'),
    );
    await rm(path.join(second, 'Archiv'), { recursive: true });

    const { models } = await scanExport(second);
    const plan = planKeys(keymap, models, { system: SYSTEM });
    expect(plan.files.find((f) => f.status !== 'known')).toMatchObject({
      path: 'Gemeinsame Dokumente/Supply Chain/Versand.bpmn',
      key: 'logistik/versand',
      status: 'moved',
      previousPath: 'Gemeinsame Dokumente/Logistik/Versand',
    });
    expect(plan.absent.map((e) => e.key)).toEqual(['archiv/auftragsabwicklung-alt']);
    // Unconfirmed: the bundle waits for the consultant.
    await expect(
      writeBundle({
        exportPath: second,
        outDir: path.join(await tempDir(), 'x'),
        system: SYSTEM,
        keymap,
      }),
    ).rejects.toMatchObject({ code: 'keys-unconfirmed' });

    const out2 = path.join(await tempDir(), 'b2');
    const result = await writeBundle({
      exportPath: second,
      outDir: out2,
      system: SYSTEM,
      keymap: applyPlan(keymap, plan, '2026-10-21-signavio'),
    });
    expect(result.absent.map((e) => e.key)).toEqual(['archiv/auftragsabwicklung-alt']);
    const m1 = await manifestOf(out1);
    const m2 = await manifestOf(out2);
    expect(m2.files.map((f) => f.key)).toEqual(
      m1.files.map((f) => f.key).filter((k) => !k.startsWith('archiv/')),
    );
    const versand = m2.files.find((f) => f.key === 'logistik/versand');
    expect(versand?.externalPath).toBe('Gemeinsame Dokumente/Supply Chain/Versand');
    // Reproducible bytes: an unchanged model is `unchanged` on re-import.
    for (const f of m2.files) {
      expect(f.sha256).toBe(m1.files.find((g) => g.key === f.key)?.sha256);
    }
  });
});

describe('writeBundle: what the report needs', () => {
  it('resolves calls against the bundled processes and counts layout-only id rewrites apart', async () => {
    const out = path.join(await tempDir(), 'bundle');
    const result = await writeBundle({
      exportPath: SIGNAVIO_EXPORT,
      outDir: out,
      system: SYSTEM,
      keymap: await confirmedKeymap(SIGNAVIO_EXPORT),
    });
    const calls = result.files.flatMap((f) =>
      f.callActivities.map((c) => [f.key, c.name, c.match, c.target]),
    );
    expect(calls).toContainEqual([
      'vertrieb/auftragsabwicklung',
      'Rechnung stellen',
      'one',
      {
        key: 'finanzen/rechnungsstellung',
        processId: 'sid-4A5B6C7D-8E9F-4A0B-9C1D-2E3F4A5B6C30',
      },
    ]);
    const bonitaet = result.files.find((f) => f.key === 'finanzen/bonitaetspruefung');
    expect(bonitaet?.idRewrites.map((r) => r.type)).toEqual([
      'bpmn:Task',
      'bpmn:DataStoreReference',
    ]);
    expect(bonitaet?.layoutIdRewrites).toBe(2);
    expect(bonitaet?.losses).toEqual([{ code: 'id-rewritten', count: 4 }]);
  });

  it('leaves out the folders keymap.json excludes and lists them', async () => {
    const out = path.join(await tempDir(), 'bundle');
    const result = await writeBundle({
      exportPath: SIGNAVIO_EXPORT,
      outDir: out,
      system: SYSTEM,
      keymap: await confirmedKeymap(SIGNAVIO_EXPORT, emptyKeymap(), ['Archiv']),
    });
    expect(result.excluded).toEqual(['Archiv/Auftragsabwicklung (alt).bpmn']);
    expect((await manifestOf(out)).files.map((f) => f.key)).not.toContain(
      'archiv/auftragsabwicklung-alt',
    );
    expect(await files(out)).not.toContain('archiv/auftragsabwicklung-alt.bpmn');
  });

  it('keeps the keys when a re-export adds a copy with the same tool id', async () => {
    const first = await copyExport('2026-10-14-signavio');
    const keymap = await confirmedKeymap(first);
    const second = await copyExport('2026-10-21-signavio');
    await cp(
      path.join(second, 'Gemeinsame Dokumente/Vertrieb/Auftragsabwicklung.bpmn'),
      path.join(second, 'Gemeinsame Dokumente/Vertrieb/Auftragsabwicklung (Kopie).bpmn'),
    );
    const { models } = await scanExport(second);
    const plan = planKeys(keymap, models, { system: SYSTEM });
    expect(plan.counts).toMatchObject({ known: 6, new: 1, absent: 0 });
    expect(plan.files.find((f) => f.status === 'new')).toMatchObject({
      key: 'vertrieb/auftragsabwicklung-kopie',
      flags: ['duplicate-external-id'],
    });
    const out = path.join(await tempDir(), 'b');
    const result = await writeBundle({
      exportPath: second,
      outDir: out,
      system: SYSTEM,
      keymap: applyPlan(keymap, plan, null),
    });
    const manifest = await manifestOf(out);
    expect(manifest.files.find((f) => f.key === 'vertrieb/auftragsabwicklung')?.externalId).toBe(
      'sid-F5E4A6B7-C8D9-4E0F-9A1B-3C4D5E6F7A05',
    );
    expect(
      manifest.files.find((f) => f.key === 'vertrieb/auftragsabwicklung-kopie'),
    ).not.toHaveProperty('externalId');
    expect(result.files).toHaveLength(7);
  });
});

describe('writeBundle: guards', () => {
  it('refuses a folder that is not empty', async () => {
    const out = await tempDir();
    await writeFile(path.join(out, 'x'), '');
    await expect(
      writeBundle({
        exportPath: SIGNAVIO_EXPORT,
        outDir: out,
        system: SYSTEM,
        keymap: await confirmedKeymap(SIGNAVIO_EXPORT),
      }),
    ).rejects.toMatchObject({ code: 'bundle-not-empty' });
  });

  it('lists a model normalize-bpmn cannot take and writes the rest', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'Gut.bpmn'), bpmn('<task id="T" />'));
    await writeFile(
      path.join(dir, 'Mit DTD.bpmn'),
      bpmn('<task id="T" />').replace(
        '<definitions',
        '<!DOCTYPE definitions SYSTEM "x.dtd">\n<definitions',
      ),
    );
    const out = path.join(await tempDir(), 'b');
    const result = await writeBundle({
      exportPath: dir,
      outDir: out,
      system: 'tool',
      keymap: await planAll(dir),
    });
    expect(result.failed).toEqual([
      {
        source: 'Mit DTD.bpmn',
        key: 'mit-dtd',
        code: 'doctype-forbidden',
        message: 'the file has a DOCTYPE, which analyzr refuses',
      },
    ]);
    expect(await files(out)).toEqual(['analyzr-import.json', 'gut.bpmn']);
  });

  it('refuses an export without BPMN', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'a.txt'), 'x');
    await expect(
      writeBundle({
        exportPath: dir,
        outDir: path.join(dir, 'out'),
        system: 'tool',
        keymap: emptyKeymap(),
      }),
    ).rejects.toMatchObject({ code: 'no-models' });
  });
});

async function planAll(dir: string, system = 'tool'): Promise<Keymap> {
  const { models } = await scanExport(dir);
  return applyPlan(emptyKeymap(), planKeys(emptyKeymap(), models, { system }), null);
}

describe('inventory', () => {
  it('copies the inventory, declares it and matches it by tool id, then by name', async () => {
    const inventory = parseInventory({
      format: 'analyzr-inventory/1',
      items: [
        {
          id: 'P-01',
          name: 'Auftragsabwicklung',
          area: 'Vertrieb',
          externalId: 'sid-F5E4A6B7-C8D9-4E0F-9A1B-3C4D5E6F7A05',
        },
        { id: 'P-02', name: 'Bonitätsprüfung', area: 'Finanzen' },
        { id: 'P-03', name: 'Reklamation', area: 'Service' },
      ],
    });
    const out = path.join(await tempDir(), 'b');
    const result = await writeBundle({
      exportPath: SIGNAVIO_EXPORT,
      outDir: out,
      system: SYSTEM,
      keymap: await confirmedKeymap(SIGNAVIO_EXPORT),
      inventory,
    });
    expect(result.coverage).toEqual({
      items: 3,
      matched: [{ id: 'P-01', name: 'Auftragsabwicklung', key: 'vertrieb/auftragsabwicklung' }],
      proposed: [{ id: 'P-02', name: 'Bonitätsprüfung', keys: ['finanzen/bonitaetspruefung'] }],
      missing: [{ id: 'P-03', name: 'Reklamation', area: 'Service' }],
    });
    expect((await manifestOf(out)).inventory).toEqual({ path: 'inventory.json' });
    expect(JSON.parse(await readFile(path.join(out, 'inventory.json'), 'utf8'))).toEqual(inventory);
    expect(isImportPath('inventory.json')).toBe(false);
  });

  it('refuses columns beyond id, name, area and externalId', () => {
    expect(() =>
      parseInventory({
        format: 'analyzr-inventory/1',
        items: [{ id: '1', name: 'A', owner: 'someone' }],
      }),
    ).toThrow(/unknown fields owner/);
    expect(() => parseInventory({ items: [] })).toThrow(BundleError);
  });

  it('proposes every model with the name', () => {
    const coverage = coverageOf(
      { format: 'analyzr-inventory/1', items: [{ id: '1', name: 'Versand ' }] },
      [
        { key: 'a/versand', externalId: null, names: ['Versand'] },
        { key: 'b/versand', externalId: null, names: ['versand'] },
      ],
    );
    expect(coverage.proposed).toEqual([
      { id: '1', name: 'Versand ', keys: ['a/versand', 'b/versand'] },
    ]);
  });
});

describe('normalizeExportedAt', () => {
  it('stores a date-time, a bare date as midnight UTC', () => {
    expect(normalizeExportedAt('2026-10-14')).toBe('2026-10-14T00:00:00Z');
    expect(normalizeExportedAt('2026-10-14T09:12:00Z')).toBe('2026-10-14T09:12:00Z');
    expect(normalizeExportedAt('2026-10-14T09:12:00+02:00')).toBe('2026-10-14T09:12:00+02:00');
    expect(() => normalizeExportedAt('14.10.2026')).toThrow(/ISO 8601/);
    expect(() => normalizeExportedAt('2026-13-40')).toThrow(BundleError);
  });
});

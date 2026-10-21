// M6 S3b, S2a: `analyzr import <bundle>` on an import bundle of the integrate skill
// (analyzr-import/1) sends every model under exactly the key the bundle pins: by its path
// (S3b, as the web upload does) and, since S2a, by the manifest, which the CLI reads from the
// bundle root; both agree. The bundles are the golden one of @analyzr/integrate (synthetic) and,
// since S3c, one its `analyzr-spec.mjs` writes from the committed spec fixtures (from source).
import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { modelKeyFromPath } from '@analyzr/contracts';
import { afterAll, describe, expect, it } from 'vitest';

import { findBpmnFiles, planImport } from '../../src/files.ts';
import { readManifest } from '../../src/manifest.ts';
import { tempDir } from '../support/io.ts';

const BUNDLE = fileURLToPath(
  new URL('../../../../tools/integrate/test/fixtures/signavio/bundle/', import.meta.url),
);
const INTEGRATE = fileURLToPath(new URL('../../../../tools/integrate/', import.meta.url));
/** The hand-written spec fixtures of @analyzr/integrate (synthetic). */
const SPECS = [
  'minimal',
  'lanes-gateways',
  'unnamed-messages',
  'calls-and-stores',
  'reconstructed',
];

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

/** The keys of `bundle` by its paths (as the web upload derives them) and by its manifest. */
async function keysOf(bundle: string): Promise<void> {
  const manifest = JSON.parse(await readFile(path.join(bundle, 'analyzr-import.json'), 'utf8')) as {
    files: { path: string; key: string }[];
  };
  const found = await findBpmnFiles(bundle);
  expect(found.map((f) => f.path)).toEqual(manifest.files.map((f) => f.path));
  const plan = planImport(found);
  expect(plan.failed).toEqual([]);
  expect(plan.skipped).toEqual([]);
  expect(plan.batches.flat().map((f) => modelKeyFromPath(f.path))).toEqual(
    manifest.files.map((f) => f.key),
  );
  const loaded = await readManifest(bundle);
  expect(loaded).not.toBeNull();
  expect(found.map((f) => loaded?.byPath.get(f.path)?.key)).toEqual(
    manifest.files.map((f) => f.key),
  );
}

describe('import of an integrate bundle', () => {
  it('derives the keys the manifest pins, from the paths and from the manifest alike', async () => {
    await keysOf(BUNDLE);
  });

  it('does so for a bundle of rendered specs too', { timeout: 30_000 }, async () => {
    const ws = await tempDir();
    dirs.push(ws);
    await writeFile(path.join(ws, 'analyzr-workspace.json'), '{}\n');
    const specs = path.join(ws, 'specs', '2026-10-14-images');
    await mkdir(specs, { recursive: true });
    for (const name of SPECS) {
      await copyFile(
        path.join(INTEGRATE, 'test/fixtures/spec', `${name}.spec.yaml`),
        path.join(specs, `${name}.spec.yaml`),
      );
    }
    const spec = (args: string[]) =>
      promisify(execFile)(
        process.execPath,
        [path.join(INTEGRATE, 'src/cli/analyzr-spec.ts'), ...args],
        { cwd: INTEGRATE },
      );
    const common = [specs, '--workspace', ws, '--system', 'images'];
    await spec(['plan', ...common, '--prefix', 'bilder', '--whole-system', '--write']);
    const out = path.join(ws, 'bundles', '2026-10-14-images');
    await spec(['bundle', ...common, '--out', out, '--exported-at', '2026-10-14']);
    const manifest = JSON.parse(await readFile(path.join(out, 'analyzr-import.json'), 'utf8')) as {
      files: { key: string }[];
    };
    expect(manifest.files).toHaveLength(SPECS.length);
    expect(manifest.files.every((f) => f.key.startsWith('bilder/'))).toBe(true);
    await keysOf(out);
  });
});

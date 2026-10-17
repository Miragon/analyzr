// M6 S3b, S2a: `analyzr import <bundle>` on an import bundle of the integrate skill
// (analyzr-import/1) sends every model under exactly the key the bundle pins: by its path
// (S3b, as the web upload does) and, since S2a, by the manifest, which the CLI reads from the
// bundle root; both agree. The bundle is the golden one of @analyzr/integrate (synthetic).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { modelKeyFromPath } from '@analyzr/contracts';
import { describe, expect, it } from 'vitest';

import { findBpmnFiles, planImport } from '../../src/files.ts';
import { readManifest } from '../../src/manifest.ts';

const BUNDLE = fileURLToPath(
  new URL('../../../../tools/integrate/test/fixtures/signavio/bundle/', import.meta.url),
);

describe('import of an integrate bundle', () => {
  it('derives the keys the manifest pins, from the paths and from the manifest alike', async () => {
    const manifest = JSON.parse(
      await readFile(path.join(BUNDLE, 'analyzr-import.json'), 'utf8'),
    ) as {
      files: { path: string; key: string }[];
    };
    const found = await findBpmnFiles(BUNDLE);
    expect(found.map((f) => f.path)).toEqual(manifest.files.map((f) => f.path));
    const plan = planImport(found);
    expect(plan.failed).toEqual([]);
    expect(plan.skipped).toEqual([]);
    expect(plan.batches.flat().map((f) => modelKeyFromPath(f.path))).toEqual(
      manifest.files.map((f) => f.key),
    );
    const loaded = await readManifest(BUNDLE);
    expect(loaded).not.toBeNull();
    expect(found.map((f) => loaded?.byPath.get(f.path)?.key)).toEqual(
      manifest.files.map((f) => f.key),
    );
  });
});

// M6 S3b: `analyzr import <bundle>` on an import bundle of the integrate skill (analyzr-import/1)
// sends every model under exactly the key the bundle pins and leaves the manifest out, as the
// web upload does. The bundle is the golden one of @analyzr/integrate (synthetic).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { modelKeyFromPath } from '@analyzr/contracts';
import { describe, expect, it } from 'vitest';

import { findBpmnFiles, planImport } from '../../src/files.ts';

const BUNDLE = fileURLToPath(
  new URL('../../../../tools/integrate/test/fixtures/signavio/bundle/', import.meta.url),
);

describe('import of an integrate bundle', () => {
  it('derives the keys the manifest pins', async () => {
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
  });
});

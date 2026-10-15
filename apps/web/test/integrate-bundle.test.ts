// M6 S3b: dropping an import bundle of the integrate skill (analyzr-import/1) into „Hochladen“
// yields exactly the keys the bundle pins, as `analyzr import <bundle>` does. The bundle is the
// golden one of @analyzr/integrate (tools/integrate/test/fixtures/signavio/bundle, synthetic).
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { modelKeyFromPath } from '@analyzr/contracts/paths';
import { describe, expect, it } from 'vitest';

import { planUpload, stripRoot } from '../src/lib/upload';

const BUNDLE = join(__dirname, '../../../tools/integrate/test/fixtures/signavio/bundle');

interface Manifest {
  format: string;
  files: { path: string; key: string }[];
}

function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join('/'))
    .sort();
}

describe('upload plan of an integrate bundle', () => {
  it('sends every model under its pinned key and skips the manifest', () => {
    const manifest = JSON.parse(
      readFileSync(join(BUNDLE, 'analyzr-import.json'), 'utf8'),
    ) as Manifest;
    expect(manifest.format).toBe('analyzr-import/1');
    // A dropped folder: its own name is not part of the paths (entriesFromDataTransfer).
    const entries = files(BUNDLE).map((p) => ({
      path: stripRoot(`2026-10-14-signavio/${p}`),
      file: new File([readFileSync(join(BUNDLE, p))], p.slice(p.lastIndexOf('/') + 1)),
    }));
    const plan = planUpload(entries);
    expect(plan.failed).toEqual([]);
    expect(plan.skipped).toEqual([{ path: 'analyzr-import.json', reason: 'not-bpmn' }]);
    expect(plan.batches).toHaveLength(1);
    const sent = plan.batches.flat().map((e) => e.path);
    expect(sent).toEqual(manifest.files.map((f) => f.path));
    expect(sent.map(modelKeyFromPath)).toEqual(manifest.files.map((f) => f.key));
  });
});

// The bundled scripts and the plugin's notices are generated (scripts/bundle.ts): they must match
// a fresh build, import nothing but Node built-ins, and work without node_modules.
import { execFile } from 'node:child_process';
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  build,
  ENTRIES,
  NOTICES_FILE,
  PLUGIN_DIR,
  REPO_ROOT,
  type BuildResult,
} from '../scripts/bundle.ts';
import { inspectExport } from '../src/inspect.ts';

import { fakeAnalyzr, type FakeAnalyzr } from './fake-analyzr.ts';
import {
  PACKAGE_ROOT,
  SIGNAVIO_BUNDLE,
  SIGNAVIO_EXPORT,
  SIGNAVIO_EXPORTED_AT,
  tempDir,
} from './support.ts';

const run = promisify(execFile);
const STALE = 'stale: run `pnpm --filter @analyzr/integrate generate` and commit the result';

let fresh: BuildResult;
beforeAll(async () => {
  fresh = await build();
}, 60_000);

describe('plugins/analyzr-integrate generated files', () => {
  it('match a fresh build', async () => {
    expect([...fresh.files.keys()].sort()).toEqual(
      [
        ...Object.keys(ENTRIES).map((s) => `${PLUGIN_DIR}/scripts/${s}`),
        `${PLUGIN_DIR}/${NOTICES_FILE}`,
      ].sort(),
    );
    for (const [file, content] of fresh.files) {
      const committed = await readFile(path.join(REPO_ROOT, file), 'utf8').catch(() => '');
      // No diff: the bundles are long; the message says what to do.
      expect(committed === content, `${file} is ${STALE}`).toBe(true);
    }
  });

  it('import Node built-ins only', () => {
    for (const script of Object.keys(ENTRIES)) {
      const code = fresh.files.get(`${PLUGIN_DIR}/scripts/${script}`) ?? '';
      const specifiers = [...code.matchAll(/^import\s[^'"]*["']([^"']+)["']/gm)].map((m) => m[1]);
      expect(specifiers.length).toBeGreaterThan(0);
      expect(
        specifiers.filter((s) => !s?.startsWith('node:')),
        script,
      ).toEqual([]);
      expect(code, script).not.toMatch(/\brequire\(|import\(/);
      // Nothing of the machine or the pnpm store layout (region comments name packages).
      expect(code, script).not.toContain(REPO_ROOT);
      // (`'node_modules'` itself is a folder analyzr-read skips, as the CLI does.)
      expect(code, script).not.toMatch(/\/Users\/|\/home\/|node_modules[\\/]|\.\.\/\.\.\/\.\./);
      const regions = [...code.matchAll(/^\/\/#region (.+)$/gm)].map((m) => m[1] ?? '');
      expect(regions.length, script).toBeGreaterThan(0);
      for (const region of regions) {
        expect(region, script).toMatch(/^(?:src\/|(?:@[a-z0-9-]+\/)?[a-z0-9.-]+@\d+\.\d+\.\d+\/)/);
      }
    }
  });

  it('name every bundled third-party package with its license', () => {
    expect(
      fresh.packages.map((p) => `${p.name}@${p.version} ${p.license} ${p.scripts.join(',')}`),
    ).toEqual([
      'bpmn-moddle@10.3.1 MIT normalize-bpmn.mjs',
      'camunda-bpmn-moddle@8.0.2 MIT normalize-bpmn.mjs',
      'min-dash@5.1.0 MIT normalize-bpmn.mjs',
      'moddle@8.2.1 MIT normalize-bpmn.mjs',
      'moddle-xml@12.3.1 MIT normalize-bpmn.mjs',
      'saxen@11.2.0 MIT normalize-bpmn.mjs',
      'zeebe-bpmn-moddle@2.0.0 MIT normalize-bpmn.mjs',
    ]);
    for (const p of fresh.packages) expect(p.texts.length, p.name).toBeGreaterThan(0);
  });

  it('keep analyzr-read.mjs free of third-party code: Node, its sources and the zod-free contracts', () => {
    const code = fresh.files.get(`${PLUGIN_DIR}/scripts/analyzr-read.mjs`) ?? '';
    expect(fresh.packages.filter((p) => p.scripts.includes('analyzr-read.mjs'))).toEqual([]);
    expect(code).not.toMatch(/\bzod\b|bpmn-moddle|saxen/);
    // The merge and the file rule the CLI and the web share, not a copy.
    expect(code).toContain('function mergeImpacts(');
    expect(code).toContain('function modelKeyOwners(');
  });
});

describe('the bundled scripts, copied away from node_modules', () => {
  let analyzr: FakeAnalyzr;
  beforeAll(async () => {
    analyzr = await fakeAnalyzr();
  });
  afterAll(async () => {
    await analyzr.close();
  });

  it('analyzr-read previews the golden bundle as its sources do', async () => {
    const dir = await tempDir();
    const keyFile = path.join(dir, 'owner-key');
    await writeFile(keyFile, `analyzr_ok_${'k'.repeat(43)}`);
    await chmod(keyFile, 0o600);
    const env = { PATH: process.env['PATH'] ?? '', HOME: dir, ANALYZR_OWNER_KEY_FILE: keyFile };
    const args = ['preview', SIGNAVIO_BUNDLE, '-p', 'kunde-x', '--url', analyzr.url];
    const script = path.join(dir, 'analyzr-read.mjs');
    await copyFile(path.join(REPO_ROOT, PLUGIN_DIR, 'scripts/analyzr-read.mjs'), script);
    const bundled = await run(process.execPath, [script, ...args], { cwd: dir, env });
    const source = await run(
      process.execPath,
      [path.join(PACKAGE_ROOT, 'src/cli/analyzr-read.ts'), ...args],
      {
        cwd: dir,
        env,
      },
    );
    expect(JSON.parse(bundled.stdout)).toMatchObject({ counts: { created: 6 }, batches: 1 });
    expect(bundled.stdout).toBe(source.stdout);
    expect(analyzr.log.map((r) => `${r.method} ${r.url}`)).toEqual([
      'POST /api/v1/projects/kunde-x/imports?dryRun=true',
      'POST /api/v1/projects/kunde-x/imports?dryRun=true',
    ]);
  });

  it('inspect prints what the sources compute', async () => {
    const dir = await tempDir();
    const script = path.join(dir, 'inspect.mjs');
    await copyFile(path.join(REPO_ROOT, PLUGIN_DIR, 'scripts/inspect.mjs'), script);
    const { stdout } = await run(process.execPath, [script, SIGNAVIO_EXPORT], { cwd: dir });
    expect(JSON.parse(stdout)).toEqual(
      JSON.parse(JSON.stringify(await inspectExport(SIGNAVIO_EXPORT))),
    );
  });

  it('normalize-bpmn plans the keys and writes the golden bundle', async () => {
    const dir = await tempDir();
    const script = path.join(dir, 'normalize-bpmn.mjs');
    await copyFile(path.join(REPO_ROOT, PLUGIN_DIR, 'scripts/normalize-bpmn.mjs'), script);
    const workspace = path.join(dir, 'ws');
    const common = [SIGNAVIO_EXPORT, '--workspace', workspace, '--system', 'signavio'];
    await mkdir(workspace);
    await run(
      process.execPath,
      [script, 'plan', ...common, '--strip', 'Gemeinsame Dokumente', '--whole-system', '--write'],
      { cwd: dir },
    );
    const out = path.join(workspace, 'bundles', '2026-10-14-signavio');
    const details = path.join(workspace, 'reports', '2026-10-14-signavio.bundle.json');
    const { stdout } = await run(
      process.execPath,
      [
        script,
        'bundle',
        ...common,
        '--out',
        out,
        '--exported-at',
        SIGNAVIO_EXPORTED_AT,
        '--json-out',
        details,
      ],
      { cwd: dir },
    );
    expect(JSON.parse(stdout)).toMatchObject({ counts: { models: 6, failed: 0 }, details });
    const result = JSON.parse(await readFile(details, 'utf8')) as {
      failed: unknown[];
      files: { path: string }[];
    };
    expect(result.failed).toEqual([]);
    for (const file of ['analyzr-import.json', ...result.files.map((f) => f.path)]) {
      expect(await readFile(path.join(out, file), 'utf8'), file).toBe(
        await readFile(path.join(SIGNAVIO_BUNDLE, file), 'utf8'),
      );
    }
  }, 30_000);
});

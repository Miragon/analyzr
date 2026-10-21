// The bundled scripts and the plugin's notices are generated (scripts/bundle.ts): they must match
// a fresh build, import nothing but Node built-ins, and work without node_modules, giving what
// their sources give (since plugin 0.1.4 also analyzr-spec.mjs, analyzr-convert.mjs with its
// child in bundle mode, and analyzr.mjs, whose parity with the checkout's CLI
// apps/cli/test/unit/plugin-main.test.ts checks on the bundle too).
import { execFile } from 'node:child_process';
import { chmod, copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
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

import { CONVERT_ENTRY, fixtureConverter, visioExport, workspace } from './converter-support.ts';
import { fakeAnalyzr, type FakeAnalyzr } from './fake-analyzr.ts';
import { GOLDENS, goldenKey, SPEC_FIXTURES } from './spec-support.ts';
import {
  PACKAGE_ROOT,
  SIGNAVIO_BUNDLE,
  SIGNAVIO_EXPORT,
  SIGNAVIO_EXPORTED_AT,
  tempDir,
} from './support.ts';

const run = promisify(execFile);
const STALE = 'stale: run `pnpm --filter @analyzr/integrate generate` and commit the result';
/**
 * analyzr.mjs bundles the CLI, the client and the contracts (owner decision 30 (3)), and the
 * root package.json's version, which `--version` prints.
 */
const STALE_CLI =
  "stale: it bundles apps/cli, packages/client, packages/contracts and the root package.json's version, so a change there needs `pnpm --filter @analyzr/integrate generate`, a new plugin version and its RELEASES row";

/**
 * The Node built-ins each script imports: a new one is a decision, not an accident (above all
 * for inspect.mjs and analyzr-read.mjs, which run without asking, and analyzr-spec.mjs, which
 * runs no foreign code). analyzr.mjs has child_process from commander's executable
 * subcommands, which the CLI never declares.
 */
const BUILTINS: Readonly<Record<string, readonly string[]>> = {
  'analyzr-convert.mjs': [
    'child_process',
    'crypto',
    'fs',
    'fs/promises',
    'module',
    'path',
    'url',
    'util',
    'vm',
    'zlib',
  ],
  'analyzr-read.mjs': ['fs', 'fs/promises', 'os', 'path', 'util'],
  'analyzr-spec.mjs': ['crypto', 'fs', 'fs/promises', 'module', 'path', 'util'],
  'analyzr.mjs': [
    'child_process',
    'crypto',
    'events',
    'fs',
    'fs/promises',
    'os',
    'path',
    'process',
    'util',
  ],
  'inspect.mjs': ['crypto', 'fs', 'fs/promises', 'path', 'util'],
  'normalize-bpmn.mjs': ['crypto', 'fs', 'fs/promises', 'path', 'util'],
};

/** Runs `script` with Node, giving its exit code instead of throwing. */
async function node(
  script: string,
  args: readonly string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [script, ...args], options);
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

/** Every file below `dir` (relative, `/`-separated) with its bytes. */
async function filesOf(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  for (const e of entries.filter((x) => x.isFile())) {
    const file = path.join(e.parentPath, e.name);
    out[path.relative(dir, file).split(path.sep).join('/')] = await readFile(file, 'utf8');
  }
  return out;
}

/** A copy of the committed bundled `scripts` in a fresh folder, away from any node_modules. */
async function copied(...scripts: string[]): Promise<{ dir: string; paths: string[] }> {
  const dir = await tempDir();
  const paths = [];
  for (const script of scripts) {
    const target = path.join(dir, script);
    await copyFile(path.join(REPO_ROOT, PLUGIN_DIR, 'scripts', script), target);
    paths.push(target);
  }
  return { dir, paths };
}

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
      const stale = file.endsWith('/analyzr.mjs') ? STALE_CLI : STALE;
      expect(committed === content, `${file} is ${stale}`).toBe(true);
    }
  });

  it('import Node built-ins only, each script its own pinned set', () => {
    expect(Object.keys(BUILTINS).sort()).toEqual(Object.keys(ENTRIES).sort());
    for (const script of Object.keys(ENTRIES)) {
      const code = fresh.files.get(`${PLUGIN_DIR}/scripts/${script}`) ?? '';
      const specifiers = [...code.matchAll(/^import\s[^'"]*["']([^"']+)["']/gm)].map((m) => m[1]);
      expect(specifiers.length).toBeGreaterThan(0);
      expect(
        specifiers.filter((s) => !s?.startsWith('node:')),
        script,
      ).toEqual([]);
      expect([...new Set(specifiers.map((s) => s?.slice('node:'.length)))].sort(), script).toEqual(
        BUILTINS[script],
      );
      // no built-in loaded without an import line
      expect(code, script).not.toMatch(
        /\brequire\(|import\(|getBuiltinModule|process\.binding|_linkedBinding|process\.dlopen/,
      );
      // rolldown's shim for yaml's CommonJS build loads Node built-ins by name, nothing else:
      // `__require("process")` and `__require("buffer")`, through one createRequire; the shim
      // is defined once and only called (no alias that could load another module)
      const required = [...code.matchAll(/\b__require\(/g)].length;
      const builtins = [...code.matchAll(/\b__require\("(process|buffer)"\)/g)].map((m) => m[1]);
      expect(required, script).toBe(builtins.length);
      expect([...code.matchAll(/\b__require\b/g)].length, script).toBe(
        required === 0 ? 0 : required + 1,
      );
      if (required > 0) {
        expect(new Set(builtins), script).toEqual(new Set(['process', 'buffer']));
        expect(code.match(/createRequire/g), script).toHaveLength(2);
        expect(code, script).toContain('import { createRequire } from "node:module";');
        expect(code, script).toContain('var __require = (() => createRequire(import.meta.url))();');
      } else {
        expect(code, script).not.toContain('createRequire');
      }
      // Nothing of the machine or the pnpm store layout (region comments name packages).
      expect(code, script).not.toContain(REPO_ROOT);
      // (`'node_modules'` itself is a folder analyzr-read skips, as the CLI does.)
      expect(code, script).not.toMatch(/\/Users\/|\/home\/|node_modules[\\/]|\.\.\/\.\.\/\.\./);
      const regions = [...code.matchAll(/^\/\/#region (.+)$/gm)].map((m) => m[1] ?? '');
      expect(regions.length, script).toBeGreaterThan(0);
      for (const region of regions) {
        // this package's `src/…`, `<package>@<version>/…` (the root package's version is a
        // prerelease) or rolldown's runtime helpers
        expect(region, script).toMatch(
          /^(?:src\/|(?:@[a-z0-9-]+\/)?[a-z0-9.-]+@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\/|\\0rolldown\/runtime\.js$)/,
        );
      }
    }
  });

  it('name every bundled third-party package with its license', () => {
    expect(
      fresh.packages.map((p) => `${p.name}@${p.version} ${p.license} ${p.scripts.join(',')}`),
    ).toEqual([
      // in moduleIds (and so listed) although tree-shaking dropped its code
      '@asteasolutions/zod-to-openapi@9.1.0 MIT analyzr.mjs',
      // the runtime it generated into @analyzr/client (GENERATED_RUNTIMES)
      '@hey-api/openapi-ts@0.99.0 MIT analyzr.mjs',
      'bpmn-moddle@10.3.1 MIT analyzr-spec.mjs,normalize-bpmn.mjs',
      'camunda-bpmn-moddle@8.0.2 MIT normalize-bpmn.mjs',
      'commander@15.0.0 MIT analyzr.mjs',
      'min-dash@5.1.0 MIT analyzr-spec.mjs,normalize-bpmn.mjs',
      'moddle@8.2.1 MIT analyzr-spec.mjs,normalize-bpmn.mjs',
      'moddle-xml@12.3.1 MIT analyzr-spec.mjs,normalize-bpmn.mjs',
      // its runtime helpers (`\0rolldown/runtime.js`)
      'rolldown@1.2.12 MIT analyzr-convert.mjs,analyzr-spec.mjs,analyzr.mjs',
      'saxen@11.2.0 MIT analyzr-spec.mjs,normalize-bpmn.mjs',
      'yaml@2.9.1 ISC analyzr-convert.mjs,analyzr-spec.mjs',
      'zeebe-bpmn-moddle@2.0.0 MIT normalize-bpmn.mjs',
      'zod@4.6.5 MIT analyzr.mjs',
    ]);
    for (const p of fresh.packages) expect(p.texts.length, p.name).toBeGreaterThan(0);
    expect(fresh.files.get(`${PLUGIN_DIR}/${NOTICES_FILE}`)).toContain(
      'Bundled as the runtime it generated into `@analyzr/client`.',
    );
  });

  it('keep analyzr-read.mjs free of third-party code: Node, its sources and the zod-free contracts', () => {
    const code = fresh.files.get(`${PLUGIN_DIR}/scripts/analyzr-read.mjs`) ?? '';
    expect(fresh.packages.filter((p) => p.scripts.includes('analyzr-read.mjs'))).toEqual([]);
    expect(code).not.toMatch(/\bzod\b|bpmn-moddle|saxen/);
    // The merge and the file rule the CLI and the web share, not a copy.
    expect(code).toContain('function mergeImpacts(');
    expect(code).toContain('function modelKeyOwners(');
  });

  it('keep analyzr-spec.mjs and analyzr-convert.mjs zod-free, and the runner in analyzr-convert.mjs alone', () => {
    const code = (script: string): string =>
      fresh.files.get(`${PLUGIN_DIR}/scripts/${script}`) ?? '';
    for (const script of ['analyzr-spec.mjs', 'analyzr-convert.mjs']) {
      expect(code(script), script).not.toMatch(/\bzod\b|commander/);
      // the validator, renderer and record are the sources', not a copy
      expect(code(script), script).toContain('function validateSpec(');
    }
    expect(code('analyzr-spec.mjs')).toContain('function renderSpec(');
    for (const script of Object.keys(ENTRIES)) {
      const runner = /vm\.createContext|createContext\(|__child/.test(code(script));
      expect(runner, script).toBe(script === 'analyzr-convert.mjs');
    }
  });

  it('bundle the CLI’s own code into analyzr.mjs, without seed and mcp', () => {
    const code = fresh.files.get(`${PLUGIN_DIR}/scripts/analyzr.mjs`) ?? '';
    expect(code).toContain('function sendImport(');
    expect(code).toContain('function anyCredential(');
    expect(code).toContain('function keepOwnerKeyLocal(');
    expect(code).toContain('function guardValues(');
    expect(code).not.toMatch(/seedCommand|@modelcontextprotocol|eval\/corpus|cli-main|main\.ts"/);
    expect(code).not.toContain('import.meta');
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

  it('analyzr-spec renders every golden byte for byte and validates as its sources do', async () => {
    const {
      dir,
      paths: [script = ''],
    } = await copied('analyzr-spec.mjs');
    const source = path.join(PACKAGE_ROOT, 'src/cli/analyzr-spec.ts');
    for (const { name, origin } of GOLDENS) {
      const out = path.join(dir, `${name}.bpmn`);
      const args = ['render', path.join(SPEC_FIXTURES, `${name}.spec.yaml`), out];
      const r = await node(script, [...args, '--key', goldenKey(name), '--origin', origin], {
        cwd: dir,
      });
      expect(r, name).toMatchObject({ code: 0, stderr: '' });
      expect(await readFile(out, 'utf8'), name).toBe(
        await readFile(path.join(SPEC_FIXTURES, `${name}.bpmn`), 'utf8'),
      );
    }
    // the whole folder as specs the agent wrote: the converter goldens fail (no derived)
    const bundled = await node(script, ['validate', SPEC_FIXTURES], { cwd: dir });
    expect(bundled.code).toBe(1);
    expect(bundled).toEqual(await node(source, ['validate', SPEC_FIXTURES], { cwd: dir }));
    expect(JSON.parse(bundled.stdout)).toMatchObject({ specs: GOLDENS.length });
    expect((await node(script, ['--help'], { cwd: dir })).stdout).toMatch(
      /analyzr-integrate analyzr-spec 0\.1\.0\n$/,
    );
  }, 60_000);

  it('analyzr-convert runs the Visio converter with its child in bundle mode, and analyzr-spec plans and bundles its specs, as the sources do', async () => {
    const {
      paths: [convert = '', spec = ''],
    } = await copied('analyzr-convert.mjs', 'analyzr-spec.mjs');
    const ws = await workspace();
    const exported = await visioExport(ws);
    const conv = await fixtureConverter(ws, 'visio-bpmn.js');
    const specsOf = (n: string) => path.join(ws, 'specs', n);
    const args = (out: string) => [
      'convert',
      exported,
      '--converter',
      conv.file,
      '--sha256',
      conv.sha256,
      '--derived',
      'converted',
      '--workspace',
      ws,
      '--out',
      out,
    ];
    // The bundle's child is started with `--allow-fs-read=<the copied script>` alone (the
    // sources' with tools/integrate/src): it reads no other file, so it bundles all it needs.
    const bundled = await node(convert, args(specsOf('bundled')), { cwd: ws });
    expect(bundled, bundled.stderr).toMatchObject({ code: 0, stderr: '' });
    const source = await node(CONVERT_ENTRY, args(specsOf('source')), { cwd: ws });
    expect(source).toMatchObject({ code: 0, stderr: '' });
    const summary = (stdout: string) => {
      const { specs: _s, record: _r, ...rest } = JSON.parse(stdout) as Record<string, unknown>;
      return rest;
    };
    expect(summary(bundled.stdout)).toEqual(summary(source.stdout));
    expect(summary(bundled.stdout)).toMatchObject({
      converter: `adhoc:${conv.sha256.slice(0, 12)}`,
      reads: { files: 2, of: 3, entries: 12 },
      counts: { models: 2, failed: 0 },
    });
    const files = await filesOf(specsOf('bundled'));
    expect(Object.keys(files).sort()).toEqual([
      'analyzr-specs.json',
      'service/reklamation/reklamation.spec.yaml',
      'vertrieb/prozesse/auftragsabwicklung.spec.yaml',
    ]);
    expect(files).toEqual(await filesOf(specsOf('source')));

    const common = ['--workspace', ws, '--system', 'visio'];
    const planned = await node(spec, ['plan', specsOf('bundled'), ...common, '--write'], {
      cwd: ws,
    });
    expect(planned, planned.stderr).toMatchObject({ code: 0, stderr: '' });
    const bundle = (out: string) => ['bundle', specsOf('bundled'), ...common, '--out', out];
    const out = (n: string) => path.join(ws, 'bundles', n);
    const a = await node(spec, bundle(out('bundled')), { cwd: ws });
    expect(a, a.stderr).toMatchObject({ code: 0, stderr: '' });
    const b = await node(
      path.join(PACKAGE_ROOT, 'src/cli/analyzr-spec.ts'),
      bundle(out('source')),
      {
        cwd: ws,
      },
    );
    expect(b).toMatchObject({ code: 0, stderr: '' });
    expect(JSON.parse(a.stdout)).toMatchObject({
      counts: { models: 2, converted: 2, reconstructed: 0, failed: 0 },
    });
    expect(await filesOf(out('bundled'))).toEqual(await filesOf(out('source')));
  }, 120_000);

  it('analyzr.mjs prints the root package’s version and a help without seed and mcp', async () => {
    const {
      dir,
      paths: [script = ''],
    } = await copied('analyzr.mjs');
    const root = JSON.parse(await readFile(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(await node(script, ['--version'], { cwd: dir })).toEqual({
      code: 0,
      stdout: `${root.version}\n`,
      stderr: '',
    });
    const help = await node(script, ['--help'], { cwd: dir });
    expect(help.code).toBe(0);
    for (const cmd of ['health', 'status', 'import', 'models', 'token', 'rules']) {
      expect(help.stdout).toMatch(new RegExp(`^  ${cmd}\\b`, 'm'));
    }
    expect(help.stdout).not.toMatch(/^ {2}(seed|mcp)\b/m);
  }, 30_000);
});

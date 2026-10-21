// The script entries (src/cli/*.ts), run as the plugin runs them: exit codes and JSON output.
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import {
  converter as converterFile,
  fixtureConverter,
  visioExport,
  workspace as convertWorkspace,
} from './converter-support.ts';
import {
  bpmn,
  PACKAGE_ROOT,
  REPO_ROOT,
  SIGNAVIO_BUNDLE,
  SIGNAVIO_EXPORT,
  SIGNAVIO_RULE,
  tempDir,
} from './support.ts';

const execFileAsync = promisify(execFile);

/** `expect.stringMatching`, typed for object literals. */
const matching = (re: RegExp): string => expect.stringMatching(re) as string;

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

async function cli(
  entry: 'inspect' | 'normalize-bpmn' | 'analyzr-spec' | 'analyzr-convert',
  args: readonly string[],
): Promise<Result> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [path.join(PACKAGE_ROOT, 'src/cli', `${entry}.ts`), ...args],
      { cwd: PACKAGE_ROOT },
    );
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('inspect', () => {
  it('prints the inventory, --summary the export at a glance', async () => {
    const full = await cli('inspect', [SIGNAVIO_EXPORT]);
    expect(full.code).toBe(0);
    expect(JSON.parse(full.stdout)).toMatchObject({ totals: { files: 7 } });
    const summary = await cli('inspect', [SIGNAVIO_EXPORT, '--summary']);
    const report = JSON.parse(summary.stdout) as Record<string, unknown>;
    expect(report).not.toHaveProperty('files');
    expect(report).toMatchObject({
      totals: { files: 7, byKind: { bpmn: 6, pdf: 1 } },
      tools: [{ tool: 'signavio', files: 6 }],
      archiveLike: { count: 1, items: ['Archiv'] },
      notable: {
        count: 4,
        items: expect.arrayContaining([
          expect.objectContaining({ path: 'Prozesslandkarte.pdf', kind: 'pdf' }),
          expect.objectContaining({
            path: 'Gemeinsame Dokumente/Finanzen/Rechnungsstellung.bpmn',
            notes: ['UTF-16LE: normalize-bpmn transcodes it to UTF-8'],
          }),
        ]) as unknown,
      },
    });
  });

  it('exits 2 on a usage error and 1 for a missing export', async () => {
    expect(await cli('inspect', [])).toMatchObject({
      code: 2,
      stderr: matching(/exactly one export path/),
    });
    expect(await cli('inspect', ['--nope', 'x'])).toMatchObject({ code: 2 });
    expect(await cli('inspect', [path.join(await tempDir(), 'missing')])).toMatchObject({
      code: 1,
      stderr: matching(/does not exist/),
    });
    expect(await cli('inspect', ['--help'])).toMatchObject({
      code: 0,
      stdout: matching(/^Usage/),
    });
  });
});

describe('normalize-bpmn', () => {
  it('file: normalizes one file into a new file and refuses to overwrite', async () => {
    const dir = await tempDir();
    const input = path.join(dir, 'in.bpmn');
    const output = path.join(dir, 'out.bpmn');
    await writeFile(input, bpmn('<task id="Task 1" />'));
    const first = await cli('normalize-bpmn', ['file', input, output]);
    expect(first.code).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({
      input,
      output,
      kind: 'converted',
      idRewrites: [{ from: 'Task 1', to: 'Task_Task_1' }],
    });
    expect(await readFile(output, 'utf8')).toContain('id="Task_Task_1"');
    expect(await cli('normalize-bpmn', ['file', input, output])).toMatchObject({
      code: 1,
      stderr: matching(/exists/),
    });
  });

  it('plan: writes keymap.json only with --write; bundle needs confirmed keys', async () => {
    const ws = await tempDir();
    const args = [
      SIGNAVIO_EXPORT,
      '--workspace',
      ws,
      '--system',
      'signavio',
      '--strip',
      'Gemeinsame Dokumente',
      '--whole-system',
    ];
    const dry = await cli('normalize-bpmn', ['plan', ...args]);
    expect(JSON.parse(dry.stdout)).toMatchObject({
      firstImport: true,
      written: null,
      counts: { new: 6 },
    });
    await expect(readFile(path.join(ws, 'keymap.json'))).rejects.toThrow(/ENOENT/);
    const out = path.join(ws, 'bundles', 'b');
    expect(
      await cli('normalize-bpmn', [
        'bundle',
        SIGNAVIO_EXPORT,
        '--workspace',
        ws,
        '--system',
        'signavio',
        '--out',
        out,
      ]),
    ).toMatchObject({ code: 1, stderr: matching(/without a confirmed key/) });
    // The fixture export lies in the checkout, the workspace must not.
    expect((await cli('normalize-bpmn', ['plan', ...args, '--write'])).code).toBe(0);
    const again = await cli('normalize-bpmn', [
      'plan',
      SIGNAVIO_EXPORT,
      '--workspace',
      ws,
      '--system',
      'signavio',
      '--prefix',
      'x',
    ]);
    expect(again).toMatchObject({
      code: 1,
      stderr: matching(/fixed since its first plan --write.*--reset/),
    });
    const bundle = await cli('normalize-bpmn', [
      'bundle',
      SIGNAVIO_EXPORT,
      '--workspace',
      ws,
      '--system',
      'signavio',
      '--out',
      out,
    ]);
    expect(bundle.code).toBe(0);
    expect(JSON.parse(bundle.stdout)).toMatchObject({
      counts: { models: 6, export: 3, converted: 3, failed: 0, skipped: 1 },
      losses: { 'id-rewritten': 6 },
      calls: { one: 1 },
      failed: { count: 0, items: [] },
      manifest: path.join(out, 'analyzr-import.json'),
      details: null,
    });
  });

  it('plan: --reset, --exclude and --existing; the key rule changes only with --reset', async () => {
    const ws = await tempDir();
    const base = [SIGNAVIO_EXPORT, '--workspace', ws, '--system', 'signavio', '--whole-system'];
    await cli('normalize-bpmn', ['plan', ...base, '--write']);
    const models = path.join(ws, 'models.json');
    await writeFile(models, JSON.stringify([{ key: 'logistik/versand', stage: 'judged' }]));
    const reset = await cli('normalize-bpmn', [
      'plan',
      ...base,
      '--strip',
      'Gemeinsame Dokumente',
      '--exclude',
      'Archiv',
      '--existing',
      models,
      '--reset',
      '--write',
    ]);
    expect(reset.code).toBe(0);
    const plan = JSON.parse(reset.stdout) as Record<string, unknown>;
    expect(plan).toMatchObject({
      reset: true,
      firstImport: true,
      exclude: ['Archiv'],
      counts: { models: 5, new: 5, excluded: 1, flagged: 1 },
      attention: {
        count: 1,
        items: [{ key: 'logistik/versand', status: 'new', flags: ['exists-in-analyzr'] }],
      },
      excluded: { count: 1, items: ['Archiv/Auftragsabwicklung (alt).bpmn'] },
    });
    const keymap = JSON.parse(await readFile(path.join(ws, 'keymap.json'), 'utf8')) as {
      systems: Record<string, { exclude: string[]; entries: { key: string }[] }>;
    };
    expect(keymap.systems['signavio']?.exclude).toEqual(['Archiv']);
    expect(keymap.systems['signavio']?.entries.map((e) => e.key)).toContain('logistik/versand');
    expect(
      await cli('normalize-bpmn', ['plan', ...base, '--existing', path.join(ws, 'missing.json')]),
    ).toMatchObject({ code: 1, stderr: matching(/does not exist/) });
  });

  it('plan --from-analyzr: rebuilds a lost key map from analyzr, recorded only with --write', async () => {
    const ws = await tempDir();
    const manifest = JSON.parse(
      await readFile(path.join(SIGNAVIO_BUNDLE, 'analyzr-import.json'), 'utf8'),
    ) as { files: { key: string; externalId?: string; externalPath: string }[] };
    // What analyzr-read.mjs external-ids and models write after an import of the golden bundle.
    const identities = path.join(ws, 'reports', 'x.external-ids.json');
    const models = path.join(ws, 'reports', 'x.models.json');
    await mkdir(path.join(ws, 'reports'));
    await writeFile(
      identities,
      JSON.stringify({
        items: manifest.files.map((f) => ({
          key: f.key,
          system: 'signavio',
          externalId: f.externalId ?? null,
          externalPath: f.externalPath,
        })),
      }),
    );
    await writeFile(
      models,
      JSON.stringify(
        manifest.files.map((f, i) => ({ id: `mdl_${i}`, key: f.key, stage: 'judged' })),
      ),
    );
    const args = [
      SIGNAVIO_EXPORT,
      '--workspace',
      ws,
      '--system',
      'signavio',
      '--whole-system',
      '--existing',
      models,
      '--from-analyzr',
      identities,
    ];
    const dry = await cli('normalize-bpmn', ['plan', ...args]);
    expect(dry.code).toBe(0);
    expect(JSON.parse(dry.stdout)).toMatchObject({
      firstImport: false,
      rebuilt: {
        restored: true,
        entries: 6,
        rule: SIGNAVIO_RULE,
        ruleFits: { matching: 6, of: 6 },
        duplicates: { count: 0 },
      },
      counts: { models: 6, known: 6, new: 0, flagged: 0 },
      written: null,
    });
    await expect(readFile(path.join(ws, 'keymap.json'))).rejects.toThrow(/ENOENT/);
    // --reset would drop keys analyzr has.
    expect(await cli('normalize-bpmn', ['plan', ...args, '--reset'])).toMatchObject({
      code: 1,
      stderr: matching(/analyzr has 6 models of signavio already.*--reset/),
    });
    expect((await cli('normalize-bpmn', ['plan', ...args, '--write'])).code).toBe(0);
    const keymap = JSON.parse(await readFile(path.join(ws, 'keymap.json'), 'utf8')) as {
      systems: Record<string, { rule: unknown; entries: unknown[] }>;
    };
    expect(keymap.systems['signavio']).toMatchObject({ rule: SIGNAVIO_RULE });
    expect(keymap.systems['signavio']?.entries).toHaveLength(6);
    // Recorded: the rule is fixed, a plan without analyzr knows every file.
    expect(await cli('normalize-bpmn', ['plan', ...args, '--strip', 'Archiv'])).toMatchObject({
      code: 1,
      stderr: matching(/fixed since its first plan --write/),
    });
    const again = await cli('normalize-bpmn', [
      'plan',
      SIGNAVIO_EXPORT,
      '--workspace',
      ws,
      '--system',
      'signavio',
    ]);
    expect(JSON.parse(again.stdout)).toMatchObject({ counts: { known: 6 } });
    expect(JSON.parse(again.stdout)).not.toHaveProperty('rebuilt');
    await writeFile(identities, JSON.stringify([{ key: 'x' }]));
    expect(await cli('normalize-bpmn', ['plan', ...args])).toMatchObject({
      code: 1,
      stderr: matching(/expected the output of analyzr models external-ids --json/),
    });
  });

  it('refuses to write into the export or an analyzr checkout', async () => {
    const dir = await tempDir();
    const exportPath = path.join(dir, 'exports', '2026-10-14-signavio');
    await mkdir(exportPath, { recursive: true });
    await writeFile(path.join(exportPath, 'a.bpmn'), bpmn('<task id="T" />'));
    const ws = dir;
    const common = [exportPath, '--workspace', ws, '--system', 'tool'];
    expect((await cli('normalize-bpmn', ['plan', ...common, '--write'])).code).toBe(0);
    expect(
      await cli('normalize-bpmn', ['bundle', ...common, '--out', path.join(exportPath, 'bundle')]),
    ).toMatchObject({ code: 1, stderr: matching(/--out .* lies inside the export/) });
    expect(
      await cli('normalize-bpmn', [
        'plan',
        exportPath,
        '--workspace',
        path.join(REPO_ROOT, 'tools/integrate/test/no-such-workspace'),
        '--system',
        'tool',
      ]),
    ).toMatchObject({ code: 1, stderr: matching(/inside the analyzr checkout/) });
    expect(
      await cli('normalize-bpmn', [
        'plan',
        ...common,
        '--json-out',
        path.join(exportPath, 'plan.json'),
      ]),
    ).toMatchObject({ code: 1, stderr: matching(/--json-out .* lies inside the export/) });
    expect(await readdir(exportPath)).toEqual(['a.bpmn']);
  });

  it('bundle: exits 1 when files failed, with a bundle of all others', async () => {
    const dir = await tempDir();
    const exportPath = path.join(dir, 'export');
    await mkdir(exportPath);
    await writeFile(path.join(exportPath, 'ok.bpmn'), bpmn('<task id="T" />'));
    await writeFile(
      path.join(exportPath, 'dtd.bpmn'),
      bpmn('<task id="T" />').replace(
        '<definitions',
        '<!DOCTYPE definitions SYSTEM "x.dtd">\n<definitions',
      ),
    );
    const common = [exportPath, '--workspace', dir, '--system', 'tool'];
    await cli('normalize-bpmn', ['plan', ...common, '--write']);
    const out = path.join(dir, 'bundles', 'b');
    const result = await cli('normalize-bpmn', ['bundle', ...common, '--out', out]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      counts: { models: 1, failed: 1 },
      failed: { count: 1, items: [{ source: 'dtd.bpmn', code: 'doctype-forbidden' }] },
    });
    expect((await readdir(out)).sort()).toEqual(['analyzr-import.json', 'ok.bpmn']);
  });

  it('inventory: turns a catalog CSV into analyzr-inventory/1 with the named columns only', async () => {
    const dir = await tempDir();
    const csv = path.join(dir, 'katalog.csv');
    await writeFile(
      csv,
      '\uFEFFNr;Prozess;Verantwortlich;Bereich\r\nP-1;Versand;Erika Muster;Logistik\r\n',
    );
    const out = path.join(dir, 'inventory', '2026-10-14-signavio.json');
    const result = await cli('normalize-bpmn', [
      'inventory',
      csv,
      '--id',
      'Nr',
      '--name',
      'Prozess',
      '--area',
      'Bereich',
      '--out',
      out,
    ]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      items: 1,
      dropped: ['Verantwortlich'],
      delimiter: ';',
    });
    expect(JSON.parse(await readFile(out, 'utf8'))).toEqual({
      format: 'analyzr-inventory/1',
      items: [{ id: 'P-1', name: 'Versand', area: 'Logistik' }],
    });
    expect(
      await cli('normalize-bpmn', ['inventory', csv, '--name', 'Prozess', '--out', out]),
    ).toMatchObject({ code: 1, stderr: matching(/exists/) });
  });

  it('prints the usage for --help, also after a command', async () => {
    for (const args of [
      ['--help'],
      ['plan', '--help'],
      ['bundle', '-h'],
      ['inventory', '--help'],
    ]) {
      expect(await cli('normalize-bpmn', args)).toMatchObject({
        code: 0,
        stdout: matching(/^Usage:/),
      });
    }
  });

  it('exits 2 on usage errors', async () => {
    expect(await cli('normalize-bpmn', [])).toMatchObject({
      code: 2,
      stderr: matching(/a command is required/),
    });
    expect(await cli('normalize-bpmn', ['nope'])).toMatchObject({ code: 2 });
    expect(
      await cli('normalize-bpmn', ['plan', SIGNAVIO_EXPORT, '--system', 'signavio']),
    ).toMatchObject({
      code: 2,
      stderr: matching(/--workspace is required/),
    });
    expect(
      await cli('normalize-bpmn', [
        'plan',
        SIGNAVIO_EXPORT,
        '--workspace',
        'w',
        '--system',
        's',
        '--scope',
        'a',
        '--whole-system',
      ]),
    ).toMatchObject({ code: 2 });
  });
});

/** An export of `n` copies of the fixture's UTF-8 models in 5 folders, each with its own tool id. */
async function largeExport(n: number): Promise<string> {
  const dir = path.join(await tempDir(), 'exports', '2026-10-14-signavio');
  const sources = [
    'Gemeinsame Dokumente/Vertrieb/Auftragsabwicklung.bpmn',
    'Gemeinsame Dokumente/Vertrieb/Angebotserstellung.bpmn',
    'Gemeinsame Dokumente/Finanzen/Bonitätsprüfung.bpmn',
    'Gemeinsame Dokumente/Logistik/Versand.bpmn',
    'Archiv/Auftragsabwicklung (alt).bpmn',
  ];
  const texts = await Promise.all(
    sources.map((s) => readFile(path.join(SIGNAVIO_EXPORT, s), 'utf8')),
  );
  for (let i = 0; i < n; i++) {
    const folder = path.join(dir, 'Gemeinsame Dokumente', `Bereich ${i % 5}`);
    await mkdir(folder, { recursive: true });
    const text = (texts[i % texts.length] ?? '').replace(
      /(<definitions\b[^>]*\sid=")[^"]+"/,
      `$1sid-COPY-${String(i).padStart(4, '0')}"`,
    );
    await writeFile(path.join(folder, `Prozess ${String(i).padStart(3, '0')}.bpmn`), text);
  }
  return dir;
}

describe('output size for a landscape of 200 models', () => {
  it('stays short on stdout; the details go to --json-out', async () => {
    const exportPath = await largeExport(200);
    const ws = path.dirname(path.dirname(exportPath));
    const reports = path.join(ws, 'reports');
    const limit = 20 * 1024;

    const inspect = await cli('inspect', [exportPath, '--summary']);
    expect(inspect.code).toBe(0);
    expect(inspect.stdout.length).toBeLessThan(limit);

    const common = [exportPath, '--workspace', ws, '--system', 'signavio'];
    const plan = await cli('normalize-bpmn', [
      'plan',
      ...common,
      '--strip',
      'Gemeinsame Dokumente',
      '--whole-system',
      '--write',
      '--json-out',
      path.join(reports, '2026-10-14-signavio.plan.json'),
    ]);
    expect(plan.code).toBe(0);
    expect(plan.stdout.length).toBeLessThan(limit);
    const planDetails = JSON.parse(
      await readFile(path.join(reports, '2026-10-14-signavio.plan.json'), 'utf8'),
    ) as { files: unknown[] };
    expect(planDetails.files).toHaveLength(200);

    const bundle = await cli('normalize-bpmn', [
      'bundle',
      ...common,
      '--out',
      path.join(ws, 'bundles', '2026-10-14-signavio'),
      '--json-out',
      path.join(reports, '2026-10-14-signavio.bundle.json'),
    ]);
    expect(bundle.code).toBe(0);
    expect(bundle.stdout.length).toBeLessThan(limit);
    expect(JSON.parse(bundle.stdout)).toMatchObject({
      counts: { models: 200 },
      files: { count: 80 },
    });
    const details = JSON.parse(
      await readFile(path.join(reports, '2026-10-14-signavio.bundle.json'), 'utf8'),
    ) as { files: unknown[] };
    expect(details.files).toHaveLength(200);
  }, 120_000);
});

describe('analyzr-spec (M6 S3c, from source; drift.test.ts runs the bundle)', () => {
  const SPECS = path.join(PACKAGE_ROOT, 'test/fixtures/spec');

  /** A workspace with a spec folder holding copies of the given fixtures. */
  async function workspace(names: readonly string[]): Promise<{ ws: string; specs: string }> {
    const ws = await tempDir();
    await writeFile(path.join(ws, 'analyzr-workspace.json'), '{}\n');
    const specs = path.join(ws, 'specs', '2026-10-14-images');
    await mkdir(specs, { recursive: true });
    for (const name of names) {
      await writeFile(
        path.join(specs, `${name}.spec.yaml`),
        await readFile(path.join(SPECS, `${name}.spec.yaml`)),
      );
    }
    return { ws, specs };
  }

  it('prints its usage and exits 2 on usage errors', async () => {
    expect(await cli('analyzr-spec', ['--help'])).toMatchObject({
      code: 0,
      stdout: matching(/^Usage:[\s\S]*analyzr-integrate analyzr-spec 0\.1\.0\n$/),
    });
    for (const [args, message] of [
      [[], /a command is required/],
      [['convert'], /unknown command convert/],
      [['validate'], /validate expects one <spec file or folder>/],
      [['render', 'a.spec.yaml'], /render expects <spec file> <out.bpmn>/],
      [['render', 'a', 'b', '--key', 'Kein Schlüssel'], /--key "Kein Schlüssel" is no model key/],
      [['render', 'a', 'b', '--origin', 'export'], /--origin is hand or converter/],
      [['plan', 'specs', '--system', 'images'], /--workspace is required/],
      [
        ['plan', 'specs', '--workspace', 'w', '--system', 's', '--scope', 'a', '--whole-system'],
        /exclude each other/,
      ],
      [['bundle', 'specs', '--workspace', 'w', '--system', 's'], /--out is required/],
      [['validate', 'x', '--nope'], /Unknown option/],
    ] as const) {
      expect(await cli('analyzr-spec', args), args.join(' ')).toMatchObject({
        code: 2,
        stderr: matching(message),
      });
    }
  });

  it('validate: every problem as a line, exit 1 for errors', async () => {
    const folder = await cli('analyzr-spec', ['validate', SPECS]);
    expect(folder.code).toBe(1);
    const result = JSON.parse(folder.stdout) as {
      specs: number;
      valid: number;
      errors: { count: number; items: string[] };
      warnings: { count: number; items: string[] };
    };
    expect(result).toMatchObject({ specs: 9, valid: 7 });
    expect(result.errors.items).toEqual([
      'collaboration.spec.yaml: source.externalId: a spec you write has no tool id or link: a picture shows none',
      'collaboration.spec.yaml: source.url: a spec you write has no tool id or link: a picture shows none',
      'collaboration.spec.yaml: derived: required in a spec you write: reconstructed (from a picture or PDF, with llmModel)',
      'converter-loose.spec.yaml: source.externalId: a spec you write has no tool id or link: a picture shows none',
      'converter-loose.spec.yaml: derived: required in a spec you write: reconstructed (from a picture or PDF, with llmModel)',
      'converter-loose.spec.yaml: processes[0].nodes[2].lane: required, since the process has lanes',
      'converter-loose.spec.yaml: processes[0].flows[3]: flows into start "s"; a start has no incoming flow',
    ]);
    expect(result.warnings.items).toContain(
      'long-texts.spec.yaml: processes[0].nodes[1].name: cut to 200 characters (loss text-truncated)',
    );
    expect(
      await cli('analyzr-spec', ['validate', path.join(SPECS, 'reconstructed.spec.yaml')]),
    ).toMatchObject({ code: 0 });
    // one file of any name is read as a spec; a missing path is an error, not a usage error
    const dir = await tempDir();
    await writeFile(
      path.join(dir, 'whiteboard.yaml'),
      await readFile(path.join(SPECS, 'reconstructed.spec.yaml')),
    );
    const single = await cli('analyzr-spec', ['validate', path.join(dir, 'whiteboard.yaml')]);
    expect(single.code).toBe(0);
    expect(JSON.parse(single.stdout)).toMatchObject({ specs: 1, valid: 1 });
    expect(await cli('analyzr-spec', ['validate', path.join(dir, 'fehlt')])).toMatchObject({
      code: 1,
      stderr: matching(/fehlt does not exist/),
    });
  });

  it('render: one spec into a new file, as the golden', async () => {
    const out = path.join(await tempDir(), 'out.bpmn');
    const first = await cli('analyzr-spec', [
      'render',
      path.join(SPECS, 'collaboration.spec.yaml'),
      out,
      '--key',
      'beispiel/collaboration',
      '--origin',
      'converter',
    ]);
    expect(first.code).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({
      output: out,
      warnings: 1,
      losses: [{ code: 'layout-generated', count: 12 }],
      summary: { modelName: 'Versand' },
    });
    expect(await readFile(out, 'utf8')).toBe(
      await readFile(path.join(SPECS, 'collaboration.bpmn'), 'utf8'),
    );
    expect(
      await cli('analyzr-spec', [
        'render',
        path.join(SPECS, 'collaboration.spec.yaml'),
        out,
        '--origin',
        'converter',
      ]),
    ).toMatchObject({ code: 1, stderr: matching(/exists; render into a new file/) });
    // as a spec you wrote, converter output is invalid: nothing is written
    const second = out.replace(/\.bpmn$/, '-2.bpmn');
    const invalid = await cli('analyzr-spec', [
      'render',
      path.join(SPECS, 'collaboration.spec.yaml'),
      second,
    ]);
    expect(invalid.code).toBe(1);
    expect(JSON.parse(invalid.stdout)).toMatchObject({ valid: 0, errors: { count: 3 } });
    await expect(readFile(second)).rejects.toThrow();
  });

  it('render: never below the workspace’s exports/, into the spec’s folder or a checkout', async () => {
    const { ws, specs } = await workspace(['reconstructed']);
    const spec = path.join(specs, 'reconstructed.spec.yaml');
    // a render below exports/ would be bundled by normalize-bpmn as the tool's own export
    for (const output of [
      path.join(ws, 'exports', '2026-10-14-signavio', 'Reklamation.bpmn'),
      path.join(specs, 'reklamation.bpmn'),
      path.join(PACKAGE_ROOT, 'reklamation.bpmn'),
    ]) {
      expect(await cli('analyzr-spec', ['render', spec, output]), output).toMatchObject({
        code: 1,
        stderr: matching(
          /stay untouched; write into the workspace|lies inside the spec folder|lies inside the analyzr checkout/,
        ),
      });
      await expect(readFile(output), output).rejects.toThrow();
    }
    // the output's own workspace counts, too
    const elsewhere = path.join(await tempDir(), 'r.spec.yaml');
    await writeFile(elsewhere, await readFile(spec));
    expect(
      await cli('analyzr-spec', [
        'render',
        elsewhere,
        path.join(ws, 'exports', 'e1', 'Reklamation.bpmn'),
      ]),
    ).toMatchObject({ code: 1, stderr: matching(/the customer's exports stay untouched/) });
    expect(
      await cli('analyzr-spec', ['render', spec, path.join(ws, 'reports', 'zz.spec.json')]),
    ).toMatchObject({ code: 2, stderr: matching(/<out\.bpmn> names a new \.bpmn file/) });
    const fine = path.join(ws, 'reports', 'reklamation.bpmn');
    await mkdir(path.dirname(fine), { recursive: true });
    expect(await cli('analyzr-spec', ['render', spec, fine])).toMatchObject({ code: 0 });
  });

  it('plan, plan --write and bundle a spec folder, never writing into it', async () => {
    const { ws, specs } = await workspace(['minimal', 'reconstructed']);
    const common = [specs, '--workspace', ws, '--system', 'images'];
    const dry = await cli('analyzr-spec', [
      'plan',
      ...common,
      '--prefix',
      'bilder',
      '--whole-system',
    ]);
    expect(dry.code).toBe(0);
    expect(JSON.parse(dry.stdout)).toMatchObject({
      system: 'images',
      counts: { models: 2, new: 2 },
      examples: [
        { path: 'Service/Anfrage beantworten.bpmn', key: 'bilder/service/anfrage-beantworten' },
        { path: 'Service/Reklamation.bpmn', key: 'bilder/service/reklamation' },
      ],
      folders: { count: 1, items: [{ folder: 'Service', models: 2 }] },
      written: null,
    });
    await expect(readFile(path.join(ws, 'keymap.json'))).rejects.toThrow();
    const details = path.join(ws, 'reports', '2026-10-14-images.plan.json');
    const written = await cli('analyzr-spec', [
      'plan',
      ...common,
      '--prefix',
      'bilder',
      '--whole-system',
      '--write',
      '--json-out',
      details,
    ]);
    expect(written.code).toBe(0);
    expect(JSON.parse(await readFile(details, 'utf8'))).toMatchObject({
      specs: [
        { spec: 'minimal.spec.yaml', key: 'bilder/service/anfrage-beantworten', status: 'new' },
        { spec: 'reconstructed.spec.yaml', key: 'bilder/service/reklamation', status: 'new' },
      ],
    });
    const keymap = JSON.parse(await readFile(path.join(ws, 'keymap.json'), 'utf8')) as {
      systems: Record<string, { lastExport: string }>;
    };
    expect(keymap.systems['images']?.lastExport).toBe('specs/2026-10-14-images');

    expect(
      await cli('analyzr-spec', ['bundle', ...common, '--out', path.join(specs, 'bundle')]),
    ).toMatchObject({
      code: 1,
      stderr: matching(/lies inside the spec folder/),
    });
    const out = path.join(ws, 'bundles', '2026-10-14-images');
    const bundle = await cli('analyzr-spec', [
      'bundle',
      ...common,
      '--out',
      out,
      '--exported-at',
      '2026-10-14',
    ]);
    expect(bundle.code).toBe(0);
    expect(JSON.parse(bundle.stdout)).toMatchObject({
      counts: { models: 2, reconstructed: 2, failed: 0 },
      losses: { 'layout-generated': expect.any(Number) as unknown, 'link-unresolved': 1 },
      calls: {
        count: 1,
        items: [
          { key: 'bilder/service/reklamation', node: 'gutschrift', target: 'Gutschrift erstellen' },
        ],
      },
      manifest: path.join(out, 'analyzr-import.json'),
    });
    expect((await readdir(out, { recursive: true })).sort()).toEqual([
      'analyzr-import.json',
      'bilder',
      'bilder/service',
      'bilder/service/anfrage-beantworten.bpmn',
      'bilder/service/reklamation.bpmn',
    ]);
    // a second plan knows both models, which this folder's own plan wrote: nothing to stop
    // for; the spec folder holds only the specs
    expect(JSON.parse((await cli('analyzr-spec', ['plan', ...common])).stdout)).toMatchObject({
      counts: { known: 2, new: 0, flagged: 0 },
      replacesKnownModel: 0,
    });
    expect((await readdir(specs)).sort()).toEqual(['minimal.spec.yaml', 'reconstructed.spec.yaml']);
  });

  it('exits 1 for a folder with invalid specs, and for a bundle with a model it could not render', async () => {
    const { ws, specs } = await workspace(['minimal', 'collaboration']);
    const common = [specs, '--workspace', ws, '--system', 'images'];
    expect(await cli('analyzr-spec', ['plan', ...common])).toMatchObject({
      code: 1,
      stderr: matching(/1 of 2 specs have errors \(collaboration\.spec\.yaml: source\.externalId/),
    });
    await rm(path.join(specs, 'collaboration.spec.yaml'));
    // a chain with a flow from its start to every node: too many slots for the layout
    const n = 460;
    const nodes = Array.from({ length: n }, (_, i) => ({ source: `n${i}`, type: 'task' }));
    await writeFile(
      path.join(specs, 'faecher.spec.json'),
      JSON.stringify({
        format: 'analyzr-spec/1',
        source: { externalPath: 'Service/Faecher' },
        derived: { kind: 'reconstructed', llmModel: 'claude-opus-5-5' },
        processes: [
          {
            source: 'p',
            nodes,
            flows: [
              ...nodes.slice(1).map((_, i) => ({ from: `n${i}`, to: `n${i + 1}` })),
              ...nodes.slice(2).map((x) => ({ from: 'n0', to: x.source })),
            ],
          },
        ],
      }),
    );
    expect(await cli('analyzr-spec', ['plan', ...common, '--write'])).toMatchObject({ code: 0 });
    const bundle = await cli('analyzr-spec', [
      'bundle',
      ...common,
      '--out',
      path.join(ws, 'bundles', '2026-10-14-images'),
    ]);
    expect(bundle.code).toBe(1);
    expect(JSON.parse(bundle.stdout)).toMatchObject({
      counts: { models: 1, failed: 1 },
      failed: {
        count: 1,
        items: [
          {
            spec: 'faecher.spec.json',
            key: 'service/faecher',
            code: 'layout-too-large',
          },
        ],
      },
    });
  });

  it('plan --from-analyzr: keys analyzr already has, and the specs that would replace them', async () => {
    const { ws, specs } = await workspace(['minimal', 'reconstructed']);
    const identities = path.join(ws, 'reports', 'images.external-ids.json');
    const models = path.join(ws, 'reports', 'images.models.json');
    await mkdir(path.dirname(identities), { recursive: true });
    await writeFile(
      identities,
      JSON.stringify({
        items: [
          {
            key: 'service/reklamation',
            system: 'images',
            externalId: null,
            externalPath: 'Service/Reklamation',
          },
        ],
      }),
    );
    await writeFile(models, JSON.stringify([{ key: 'service/reklamation', id: 'mdl_01' }]));
    const plan = await cli('analyzr-spec', [
      'plan',
      specs,
      '--workspace',
      ws,
      '--system',
      'images',
      '--from-analyzr',
      identities,
      '--existing',
      models,
    ]);
    expect(plan.code).toBe(0);
    expect(JSON.parse(plan.stdout)).toMatchObject({
      rebuilt: { restored: true, entries: 1 },
      counts: { models: 2, known: 1, new: 1 },
      // on a later import every new file needs a look, too
      attention: {
        count: 2,
        items: [
          { key: 'service/anfrage-beantworten', status: 'new' },
          { key: 'service/reklamation', status: 'known', flags: ['replaces-known-model'] },
        ],
      },
      replacesKnownModel: 1,
      written: null,
    });
    await expect(readFile(path.join(ws, 'keymap.json'))).rejects.toThrow();
  });

  it('shares normalize-bpmn’s plan helpers, not a copy (src/plan-args.ts since plugin 0.1.4)', async () => {
    for (const entry of ['normalize-bpmn', 'analyzr-spec']) {
      const code = await readFile(path.join(PACKAGE_ROOT, `src/cli/${entry}.ts`), 'utf8');
      expect(code, entry).toMatch(/\bfrom '\.\.\/plan-args\.ts';/);
      for (const name of [
        'readKeymap',
        'readJson',
        'existingKeysOf',
        'identitiesOf',
        'writeDetails',
      ]) {
        expect(code, `${entry} ${name}`).not.toMatch(
          new RegExp(`^(?:async )?function ${name}\\b`, 'm'),
        );
      }
    }
  });
});

describe('analyzr-convert (M6 S3c, from source; drift.test.ts runs the bundle)', () => {
  it('prints its usage and exits 2 on usage errors', async () => {
    expect(await cli('analyzr-convert', ['--help'])).toMatchObject({
      code: 0,
      stdout: matching(/^Usage:[\s\S]*analyzr-integrate analyzr-convert 0\.1\.0\n$/),
    });
    expect(await cli('analyzr-convert', ['convert', '--help'])).toMatchObject({ code: 0 });
    const sha = 'a'.repeat(64);
    const full = [
      '--converter',
      'c.js',
      '--sha256',
      sha,
      '--derived',
      'converted',
      '--workspace',
      'w',
      '--out',
      'o',
    ];
    const without = (option: string): string[] => {
      const i = full.indexOf(option);
      return [...full.slice(0, i), ...full.slice(i + 2)];
    };
    for (const [args, message] of [
      [[], /a command is required/],
      [['validate'], /unknown command validate/],
      [['convert', ...full], /convert expects one <export>/],
      [['convert', 'e', ...without('--converter')], /--converter is required/],
      [['convert', 'e', ...without('--sha256')], /--sha256 is required/],
      [
        ['convert', 'e', ...without('--sha256'), '--sha256', 'abc'],
        /--sha256 is the converter's full sha256 \(64 hex characters\)/,
      ],
      [['convert', 'e', ...without('--derived')], /--derived is required/],
      [
        ['convert', 'e', ...without('--derived'), '--derived', 'export'],
        /--derived is converted or reconstructed/,
      ],
      [
        ['convert', 'e', ...without('--derived'), '--derived', 'reconstructed'],
        /--derived reconstructed needs --llm-model: the model you run as/,
      ],
      [
        ['convert', 'e', ...full, '--llm-model', 'claude-opus-5-5'],
        /--llm-model goes with --derived reconstructed only/,
      ],
      [['convert', 'e', ...without('--workspace')], /--workspace is required/],
      [['convert', 'e', ...without('--out')], /--out is required/],
      [['convert', 'e', ...full, '--dry-run'], /Unknown option '--dry-run'/],
    ] as const) {
      expect(await cli('analyzr-convert', args), args.join(' ')).toMatchObject({
        code: 2,
        stderr: matching(message),
      });
    }
  });

  it('converts the Visio export, and analyzr-spec validates, plans and bundles the specs', async () => {
    const ws = await convertWorkspace();
    const exported = await visioExport(ws);
    const conv = await fixtureConverter(ws, 'visio-bpmn.js');
    const specs = path.join(ws, 'specs', '2026-10-14-visio');
    const report = path.join(ws, 'reports', '2026-10-14-visio.convert.json');
    const args = [
      'convert',
      exported,
      '--converter',
      conv.file,
      '--sha256',
      conv.sha256.toUpperCase(),
      '--derived',
      'converted',
      '--workspace',
      ws,
      '--out',
      specs,
    ];
    const run = await cli('analyzr-convert', [...args, '--json-out', report]);
    expect(run.code, run.stderr).toBe(0);
    const id = `adhoc:${conv.sha256.slice(0, 12)}`;
    expect(JSON.parse(run.stdout)).toMatchObject({
      converter: id,
      sha256: conv.sha256,
      copy: `converters/adhoc-${conv.sha256.slice(0, 12)}.js`,
      derived: { kind: 'converted', llmModel: null },
      reads: { files: 2, of: 3, entries: 12 },
      counts: { models: 2, failed: 0, skipped: 2, zipRefused: 0 },
      losses: { 'element-dropped': 4 },
      record: path.join(specs, 'analyzr-specs.json'),
      details: report,
    });
    expect(JSON.parse(await readFile(report, 'utf8'))).toEqual(
      JSON.parse(await readFile(path.join(specs, 'analyzr-specs.json'), 'utf8')),
    );
    // a second run into the same folder is refused: every run writes a new one
    expect(await cli('analyzr-convert', args)).toMatchObject({
      code: 1,
      stderr: matching(/is not empty: write every run into a new folder/),
    });

    const validated = await cli('analyzr-spec', ['validate', specs]);
    expect(validated.code, validated.stdout).toBe(0);
    expect(JSON.parse(validated.stdout)).toEqual({
      specs: 2,
      valid: 2,
      errors: { count: 0, items: [] },
      warnings: { count: 0, items: [] },
    });
    const planned = await cli('analyzr-spec', [
      'plan',
      specs,
      '--workspace',
      ws,
      '--system',
      'visio',
      '--write',
    ]);
    expect(planned.code, planned.stderr).toBe(0);
    const bundle = path.join(ws, 'bundles', '2026-10-14-visio');
    const bundled = await cli('analyzr-spec', [
      'bundle',
      specs,
      '--workspace',
      ws,
      '--system',
      'visio',
      '--out',
      bundle,
    ]);
    expect(bundled.code, bundled.stderr).toBe(0);
    expect(JSON.parse(bundled.stdout)).toMatchObject({
      counts: { models: 2, converted: 2, reconstructed: 0, failed: 0 },
      // the run record analyzr-specs.json is the folder's, no file left out
      skipped: { count: 0, items: [] },
      calls: {
        count: 1,
        items: [{ key: 'vertrieb/prozesse/auftragsabwicklung', target: 'Bonitätsprüfung' }],
      },
    });
    const manifest = JSON.parse(
      await readFile(path.join(bundle, 'analyzr-import.json'), 'utf8'),
    ) as {
      files: { derived: { kind: string; converter: string } }[];
    };
    expect(manifest.files.map((f) => f.derived)).toEqual([
      { kind: 'converted', converter: id, llmModel: null, from: [] },
      { kind: 'converted', converter: id, llmModel: null, from: [] },
    ]);
  });

  it('exits 1 for a refused run and for failed models, and never writes its details into the spec folder', async () => {
    const ws = await convertWorkspace();
    const exported = await visioExport(ws);
    const conv = await fixtureConverter(ws, 'visio-bpmn.js');
    const base = [
      'convert',
      exported,
      '--converter',
      conv.file,
      '--derived',
      'converted',
      '--workspace',
      ws,
    ];
    expect(
      await cli('analyzr-convert', [
        ...base,
        '--sha256',
        'b'.repeat(64),
        '--out',
        path.join(ws, 'specs', 'a'),
      ]),
    ).toMatchObject({
      code: 1,
      stderr: matching(
        /^analyzr-convert: --converter .* has the sha256 [0-9a-f]{64}, not the approved b{64}: it changed after the consultant approved it; show the new version and ask again\n$/,
      ),
    });
    const out = path.join(ws, 'specs', 'b');
    expect(
      await cli('analyzr-convert', [
        ...base,
        '--sha256',
        conv.sha256,
        '--out',
        out,
        '--json-out',
        path.join(out, 'x.json'),
      ]),
    ).toMatchObject({
      code: 1,
      stderr: matching(/--json-out .* lies inside the spec folder/),
    });
    const half = await converterFile(
      ws,
      'half.js',
      "function convert() {\n  return { models: [{ source: { externalPath: 'A/Gut' }, processes: [{ source: 'p', nodes: [{ source: 's', type: 'start' }] }] }, { source: { externalPath: 'A/Schlecht' }, processes: [] }] };\n}\n",
    );
    const failed = await cli('analyzr-convert', [
      'convert',
      exported,
      '--converter',
      half.file,
      '--sha256',
      half.sha256,
      '--derived',
      'converted',
      '--workspace',
      ws,
      '--out',
      path.join(ws, 'specs', 'c'),
    ]);
    expect(failed.code).toBe(1);
    expect(JSON.parse(failed.stdout)).toMatchObject({
      counts: { models: 1, failed: 1 },
      failed: {
        count: 1,
        items: [
          {
            model: 1,
            externalPath: 'A/Schlecht',
            errors: [matching(/^models\[1\]: processes: must not be empty/)],
          },
        ],
      },
    });
  });

  it('lets analyzr-spec validate report a run record it cannot read', async () => {
    const ws = await convertWorkspace();
    const specs = path.join(ws, 'specs', 'x');
    await mkdir(specs, { recursive: true });
    await writeFile(path.join(specs, 'analyzr-specs.json'), '{"format":"analyzr-specs/0"}\n');
    const r = await cli('analyzr-spec', ['validate', specs]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toMatchObject({
      specs: 0,
      errors: { count: 1, items: ['analyzr-specs.json: format: expected "analyzr-specs/1"'] },
    });
  });
});

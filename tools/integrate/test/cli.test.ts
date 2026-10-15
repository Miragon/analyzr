// The script entries (src/cli/*.ts), run as the plugin runs them: exit codes and JSON output.
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { bpmn, PACKAGE_ROOT, REPO_ROOT, SIGNAVIO_EXPORT, tempDir } from './support.ts';

const execFileAsync = promisify(execFile);

/** `expect.stringMatching`, typed for object literals. */
const matching = (re: RegExp): string => expect.stringMatching(re) as string;

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

async function cli(entry: 'inspect' | 'normalize-bpmn', args: readonly string[]): Promise<Result> {
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

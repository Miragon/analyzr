// Entry of analyzr-spec (M6 S3c §3.5): validates specs, renders them as BPMN, plans their keys
// and writes their bundles. It runs no foreign code. Bundled into the plugin as
// scripts/analyzr-spec.mjs since plugin 0.1.4; the tests also run it from source
// (node tools/integrate/src/cli/analyzr-spec.ts).
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { isModelKey } from '@analyzr/contracts/paths';

import { parseInventory } from '../bundle.ts';
import { formatCompactJson } from '../compact.ts';
import {
  applyPlan,
  formatKeymap,
  KeymapError,
  rebuildFromAnalyzr,
  type KeyRule,
  type RebuildReport,
} from '../keymap.ts';
import { existingKeysOf, identitiesOf, readJson, readKeymap, writeDetails } from '../plan-args.ts';
import {
  planSpecFolder,
  readSpecFile,
  scanSpecs,
  specFolderMark,
  writeSpecBundle,
} from '../spec/bundle.ts';
import { compactSpecBundle, compactSpecPlan, compactValidation } from '../spec/compact.ts';
import { assertSpecOutput, workspaceOf } from '../spec/guards.ts';
import { renderSpec } from '../spec/render.ts';
import type { SpecOrigin } from '../spec/types.ts';
import { ANALYZR_SPEC_VERSION } from '../version.ts';

import { parse, printJson, run, UsageError } from './common.ts';

const USAGE = `Usage:
  node analyzr-spec.mjs validate <spec file or folder>
  node analyzr-spec.mjs render <spec file> <out.bpmn> [--key <model key>] [--origin hand|converter]
  node analyzr-spec.mjs plan <spec folder> --workspace <dir> --system <system>
      [--strip <tool folder>] [--prefix <key prefix>]
      [--scope <tool folder>]... [--whole-system]
      [--exclude <tool folder>]... [--no-exclude]
      [--existing <models.json>] [--from-analyzr <external-ids.json>]
      [--reset] [--write] [--json-out <file>]
  node analyzr-spec.mjs bundle <spec folder> --workspace <dir> --system <system> --out <dir>
      [--exported-at <date>] [--inventory <inventory.json>] [--json-out <file>]

validate   checks analyzr-spec/1 files (*.spec.yaml, *.spec.yml or *.spec.json below a
           folder, or one file of any name) as specs you wrote, and those the folder's
           run record (analyzr-specs.json, from analyzr-convert) lists as converter
           output, unchanged since the run: every error and warning as
           "<spec file>: <path>: <message>". Writes nothing.
render     renders one spec as BPMN 2.0 with DI into the new file <out.bpmn>, for
           checks: --key sets the definitions id (default spec); --origin converter
           checks it as converter output (no derived; loose positions are warnings).
           Never into the spec's folder or below the exports/ of the workspace (the
           folder with analyzr-workspace.json) the spec or <out.bpmn> lies in.
plan       plans the model key of every spec of the folder against <dir>/keymap.json
           from its source.externalPath (and externalId), as normalize-bpmn plan
           does for an export, with the same options. A spec you wrote is flagged
           replaces-known-model when it takes the key of a model with a tool id, of
           one without unless this folder wrote the system's last plan, or a key
           analyzr has (--existing). --write (only after the consultant confirmed
           it) records the plan in keymap.json.
bundle     writes the import bundle (analyzr-import/1) into the empty folder <dir>:
           every spec rendered at its key's path, analyzr-import.json, and
           inventory.json with --inventory. Every spec needs a confirmed key. A spec
           a converter run wrote is converted or reconstructed with adhoc:<12 hex>
           only while the run record checks out: the copy converters/adhoc-<12 hex>.js
           in the workspace holds the recorded bytes and the spec is unchanged. Exit 1
           when models failed: the bundle holds all others.

plan and bundle print a short summary on stdout and, with --json-out, the complete
result into <file>. Nothing is written into the spec folder, below the workspace's
exports/ or into an analyzr checkout. Exit 0, 1 when the work fails, 2 on a usage error.
analyzr-integrate analyzr-spec ${ANALYZR_SPEC_VERSION}
`;

function required(value: string | undefined, option: string): string {
  if (value === undefined || value === '') throw new UsageError(`${option} is required`);
  return value;
}

const wantsHelp = (argv: readonly string[]): boolean =>
  argv.includes('--help') || argv.includes('-h');

async function validateCommand(argv: readonly string[]): Promise<void> {
  const { positionals } = parse(argv, {});
  if (positionals.length !== 1) throw new UsageError('validate expects one <spec file or folder>');
  const scanned = await scanSpecs(positionals[0] ?? '');
  const result = compactValidation(
    scanned.specs,
    scanned.skipped,
    scanned.recordProblem === null ? [] : [scanned.recordProblem],
  );
  process.stdout.write(formatCompactJson(result));
  if (result.errors.count > 0) process.exitCode = 1;
}

async function renderCommand(argv: readonly string[]): Promise<void> {
  const { values, positionals } = parse(argv, {
    key: { type: 'string' },
    origin: { type: 'string' },
  });
  if (positionals.length !== 2) throw new UsageError('render expects <spec file> <out.bpmn>');
  const [input = '', output = ''] = positionals;
  const key = values.key ?? 'spec';
  if (!isModelKey(key)) {
    throw new UsageError(`--key ${JSON.stringify(key)} is no model key (e.g. vertrieb/auftrag)`);
  }
  const origin = (values.origin ?? 'hand') as SpecOrigin;
  if (origin !== 'hand' && origin !== 'converter') {
    throw new UsageError('--origin is hand or converter');
  }
  if (!/\.bpmn$/i.test(output)) throw new UsageError('<out.bpmn> names a new .bpmn file');
  // a render below exports/ would pass as the tool's own export
  const workspace = workspaceOf(input);
  assertSpecOutput(output, '<out.bpmn>', {
    specs: path.dirname(path.resolve(input)),
    ...(workspace === null ? {} : { workspace }),
  });
  const file = await readSpecFile(path.resolve(input), input, origin);
  if (file.spec === null) {
    process.stdout.write(formatCompactJson(compactValidation([file])));
    process.exitCode = 1;
    return;
  }
  const result = await renderSpec(file.spec, { key });
  await writeFile(output, result.bytes, { flag: 'wx' }).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'EEXIST') throw new Error(`${output} exists; render into a new file`);
    throw err;
  });
  const { xml: _xml, bytes: _bytes, ...report } = result;
  printJson({ input, output, warnings: file.warnings.length, ...report });
}

async function planCommand(argv: readonly string[]): Promise<void> {
  const { values, positionals } = parse(argv, {
    workspace: { type: 'string' },
    system: { type: 'string' },
    strip: { type: 'string' },
    prefix: { type: 'string' },
    scope: { type: 'string', multiple: true },
    'whole-system': { type: 'boolean' },
    exclude: { type: 'string', multiple: true },
    'no-exclude': { type: 'boolean' },
    existing: { type: 'string' },
    'from-analyzr': { type: 'string' },
    reset: { type: 'boolean' },
    write: { type: 'boolean' },
    'json-out': { type: 'string' },
  });
  if (positionals.length !== 1) throw new UsageError('plan expects one <spec folder>');
  const specDir = positionals[0] ?? '';
  const workspace = required(values.workspace, '--workspace');
  const system = required(values.system, '--system');
  if (values.scope !== undefined && values['whole-system'] === true) {
    throw new UsageError('--scope and --whole-system exclude each other');
  }
  if (values.exclude !== undefined && values['no-exclude'] === true) {
    throw new UsageError('--exclude and --no-exclude exclude each other');
  }
  assertSpecOutput(workspace, '--workspace', { specs: specDir, workspace });
  if (values['json-out'] !== undefined) {
    assertSpecOutput(values['json-out'], '--json-out', { specs: specDir, workspace });
  }
  const { file, keymap } = await readKeymap(workspace);
  const ruleGiven = values.strip !== undefined || values.prefix !== undefined;
  const rule: KeyRule | undefined = ruleGiven
    ? { strip: values.strip ?? null, prefix: values.prefix ?? null }
    : undefined;
  const scope =
    values['whole-system'] === true ? null : values.scope === undefined ? undefined : values.scope;
  const exclude = values['no-exclude'] === true ? [] : values.exclude;
  const existing =
    values.existing === undefined
      ? undefined
      : existingKeysOf(await readJson(values.existing), values.existing);
  let base = keymap;
  let rebuilt: RebuildReport | undefined;
  if (values['from-analyzr'] !== undefined) {
    const identities = identitiesOf(await readJson(values['from-analyzr']), values['from-analyzr']);
    const imported = identities.filter((i) => i.system === system).length;
    if (values.reset === true && imported > 0) {
      throw new KeymapError(
        `analyzr has ${imported === 1 ? '1 model' : `${imported} models`} of ${system} already (--from-analyzr): their keys never change, so --reset is only for a system nothing of which is imported`,
      );
    }
    ({ keymap: base, report: rebuilt } = rebuildFromAnalyzr(keymap, identities, {
      system,
      ...(existing === undefined ? {} : { modelIds: existing.modelIds }),
      ...(rule === undefined || keymap.systems[system] !== undefined ? {} : { rule }),
    }));
  }
  const folder = specFolderMark(workspace, specDir);
  const specPlan = await planSpecFolder(
    base,
    specDir,
    {
      system,
      ...(rule === undefined ? {} : { rule }),
      ...(scope === undefined ? {} : { scope }),
      ...(exclude === undefined ? {} : { exclude }),
      ...(existing === undefined ? {} : { existingKeys: existing.keys }),
      reset: values.reset === true,
    },
    folder,
    workspace,
  );
  let written: string | null = null;
  if (values.write === true) {
    await writeFile(file, formatKeymap(applyPlan(base, specPlan.plan, folder)));
    written = file;
  }
  const details = await writeDetails(values['json-out'], {
    ...specPlan.plan,
    ...(rebuilt === undefined ? {} : { rebuilt }),
    specs: specPlan.specs,
    skipped: specPlan.scanned.skipped,
    warnings: specPlan.scanned.specs.flatMap((s) =>
      s.warnings.map((w) => ({ spec: s.file, ...w })),
    ),
    keymap: file,
    written,
  });
  process.stdout.write(
    formatCompactJson({
      ...compactSpecPlan(specPlan, specPlan.scanned, rebuilt),
      keymap: file,
      written,
      details,
    }),
  );
}

async function bundleCommand(argv: readonly string[]): Promise<void> {
  const { values, positionals } = parse(argv, {
    workspace: { type: 'string' },
    system: { type: 'string' },
    out: { type: 'string' },
    'exported-at': { type: 'string' },
    inventory: { type: 'string' },
    'json-out': { type: 'string' },
  });
  if (positionals.length !== 1) throw new UsageError('bundle expects one <spec folder>');
  const specDir = positionals[0] ?? '';
  const workspace = required(values.workspace, '--workspace');
  const system = required(values.system, '--system');
  const out = required(values.out, '--out');
  const places = { specs: specDir, workspace };
  assertSpecOutput(workspace, '--workspace', { specs: specDir });
  assertSpecOutput(out, '--out', places);
  if (values['json-out'] !== undefined) assertSpecOutput(values['json-out'], '--json-out', places);
  const { keymap } = await readKeymap(workspace);
  const inventory =
    values.inventory === undefined ? null : parseInventory(await readJson(values.inventory));
  const result = await writeSpecBundle({
    specDir,
    outDir: out,
    workspace,
    system,
    keymap,
    exportedAt: values['exported-at'] ?? null,
    inventory,
  });
  const details = await writeDetails(values['json-out'], result);
  process.stdout.write(
    formatCompactJson({
      ...compactSpecBundle(result),
      manifest: path.join(result.bundle, 'analyzr-import.json'),
      details,
    }),
  );
  if (result.failed.length > 0) process.exitCode = 1;
}

run('analyzr-spec', USAGE, async () => {
  const [command, ...rest] = process.argv.slice(2);
  if (command === '--help' || command === '-h' || (command !== undefined && wantsHelp(rest))) {
    process.stdout.write(USAGE);
    return;
  }
  switch (command) {
    case 'validate':
      return validateCommand(rest);
    case 'render':
      return renderCommand(rest);
    case 'plan':
      return planCommand(rest);
    case 'bundle':
      return bundleCommand(rest);
    default:
      throw new UsageError(
        command === undefined ? 'a command is required' : `unknown command ${command}`,
      );
  }
});

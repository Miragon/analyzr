// Entry of plugins/analyzr-integrate/scripts/normalize-bpmn.mjs (M6 §3.7 steps 3 and 4).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parseInventory, scanExport, writeBundle } from '../bundle.ts';
import { compactBundle, compactPlan, formatCompactJson } from '../compact.ts';
import { inventoryFromCsv, parseCsv } from '../csv.ts';
import { assertWritable } from '../guards.ts';
import {
  applyPlan,
  emptyKeymap,
  formatKeymap,
  parseKeymap,
  planKeys,
  type KeyRule,
  type Keymap,
} from '../keymap.ts';
import { normalizeBpmn } from '../normalize.ts';
import { NORMALIZE_BPMN_VERSION } from '../version.ts';

import { parse, printJson, run, UsageError } from './common.ts';

const USAGE = `Usage:
  node normalize-bpmn.mjs file <in.bpmn> <out.bpmn>
  node normalize-bpmn.mjs plan <export> --workspace <dir> --system <system>
      [--strip <tool folder>] [--prefix <key prefix>]
      [--scope <tool folder>]... [--whole-system]
      [--exclude <tool folder>]... [--no-exclude]
      [--existing <models.json>] [--reset] [--write] [--json-out <file>]
  node normalize-bpmn.mjs bundle <export> --workspace <dir> --system <system> --out <dir>
      [--exported-at <date>] [--inventory <inventory.json>] [--json-out <file>]
  node normalize-bpmn.mjs inventory <catalog.csv> --name <column> --out <inventory.json>
      [--id <column>] [--area <column>] [--external-id <column>]

file       normalizes one BPMN file (UTF-8, ids analyzr and bpmn-moddle accept,
           references updated) and prints what changed and what was lost.
plan       plans the model key of every BPMN file of <export> against
           <dir>/keymap.json: known, moved (same tool id, new folder), new,
           collisions, flags and absent models; with --write (only after the
           consultant confirmed it) it records the plan in keymap.json.
           --strip, --prefix set the key rule on a system's first import;
           --scope names the tool folders a partial export covers,
           --whole-system a complete export; --exclude leaves tool folders
           (archive, copies) out of keys and bundles, recorded per system
           (--no-exclude clears it); --existing reads the project's models
           (analyzr models list --json) and flags new keys analyzr already
           has; --reset drops the system's rule and keys, only while nothing
           of the system is imported (other systems' keys stay taken).
bundle     writes the import bundle (analyzr-import/1) into the empty folder
           <dir>: every model normalized at its key's path, analyzr-import.json,
           and inventory.json with --inventory. Every model needs a confirmed
           key. Exit 1 when files failed: the bundle holds all others.
inventory  turns a process catalog (CSV, UTF-8 or Windows-1252, ; , or tab)
           into analyzr-inventory/1, taking only the named columns.

plan and bundle print a short summary on stdout and, with --json-out, the
complete result into <file>; file and inventory print JSON on stdout.
Nothing is ever written into <export> or into an analyzr checkout.
Exit 0, 1 when the work fails, 2 on a usage error.
analyzr-integrate normalize-bpmn ${NORMALIZE_BPMN_VERSION}
`;

const KEYMAP_FILE = 'keymap.json';

async function readKeymap(workspace: string): Promise<{ file: string; keymap: Keymap }> {
  const file = path.join(workspace, KEYMAP_FILE);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { file, keymap: emptyKeymap() };
    throw err;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${file} is not valid JSON`);
  }
  return { file, keymap: parseKeymap(value) };
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${file} does not exist`, { cause: err });
    }
    throw new Error(`${file} is not valid JSON`, { cause: err });
  }
}

/** The keys of `analyzr models list --json` (objects with `key`) or a list of keys. */
function existingKeysOf(value: unknown, file: string): string[] {
  if (Array.isArray(value)) {
    const keys = value.map((v: unknown) =>
      typeof v === 'string'
        ? v
        : typeof v === 'object' && v !== null && typeof (v as { key?: unknown }).key === 'string'
          ? (v as { key: string }).key
          : null,
    );
    if (keys.every((k) => k !== null)) return keys;
  }
  throw new Error(
    `${file}: expected the output of analyzr models list --json (a list of models with key)`,
  );
}

function required(value: string | undefined, option: string): string {
  if (value === undefined || value === '') throw new UsageError(`${option} is required`);
  return value;
}

/** Writes the complete result as JSON (two-space indent) for the agent to read details from. */
async function writeDetails(file: string | undefined, value: unknown): Promise<string | null> {
  if (file === undefined) return null;
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

const wantsHelp = (argv: readonly string[]): boolean =>
  argv.includes('--help') || argv.includes('-h');

async function fileCommand(argv: readonly string[]): Promise<void> {
  const { positionals } = parse(argv, {});
  if (positionals.length !== 2) throw new UsageError('file expects <in.bpmn> <out.bpmn>');
  const [input = '', output = ''] = positionals;
  const result = await normalizeBpmn(new Uint8Array(await readFile(input)));
  await writeFile(output, result.bytes, { flag: 'wx' }).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'EEXIST') throw new Error(`${output} exists; normalize into a new file`);
    throw err;
  });
  const { bytes: _bytes, ...report } = result;
  printJson({ input, output, ...report });
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
    reset: { type: 'boolean' },
    write: { type: 'boolean' },
    'json-out': { type: 'string' },
  });
  if (positionals.length !== 1) throw new UsageError('plan expects one <export>');
  const exportPath = positionals[0] ?? '';
  const workspace = required(values.workspace, '--workspace');
  const system = required(values.system, '--system');
  if (values.scope !== undefined && values['whole-system'] === true) {
    throw new UsageError('--scope and --whole-system exclude each other');
  }
  if (values.exclude !== undefined && values['no-exclude'] === true) {
    throw new UsageError('--exclude and --no-exclude exclude each other');
  }
  assertWritable(workspace, '--workspace', exportPath);
  if (values['json-out'] !== undefined) {
    assertWritable(values['json-out'], '--json-out', exportPath);
  }
  const { file, keymap } = await readKeymap(workspace);
  const ruleGiven = values.strip !== undefined || values.prefix !== undefined;
  const rule: KeyRule | undefined = ruleGiven
    ? { strip: values.strip ?? null, prefix: values.prefix ?? null }
    : undefined;
  const scope =
    values['whole-system'] === true ? null : values.scope === undefined ? undefined : values.scope;
  const exclude = values['no-exclude'] === true ? [] : values.exclude;
  const existingKeys =
    values.existing === undefined
      ? undefined
      : existingKeysOf(await readJson(values.existing), values.existing);
  const scanned = await scanExport(exportPath);
  const plan = planKeys(keymap, scanned.models, {
    system,
    ...(rule === undefined ? {} : { rule }),
    ...(scope === undefined ? {} : { scope }),
    ...(exclude === undefined ? {} : { exclude }),
    ...(existingKeys === undefined ? {} : { existingKeys }),
    reset: values.reset === true,
  });
  let written: string | null = null;
  if (values.write === true) {
    const exportName = path.basename(path.resolve(exportPath));
    await writeFile(file, formatKeymap(applyPlan(keymap, plan, exportName)));
    written = file;
  }
  const details = await writeDetails(values['json-out'], {
    ...plan,
    skipped: scanned.skipped,
    keymap: file,
    written,
  });
  process.stdout.write(
    formatCompactJson({
      ...compactPlan(plan),
      skipped: { count: scanned.skipped.length, items: scanned.skipped.slice(0, 20) },
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
  if (positionals.length !== 1) throw new UsageError('bundle expects one <export>');
  const exportPath = positionals[0] ?? '';
  const workspace = required(values.workspace, '--workspace');
  const system = required(values.system, '--system');
  const out = required(values.out, '--out');
  assertWritable(workspace, '--workspace', exportPath);
  assertWritable(out, '--out', exportPath);
  if (values['json-out'] !== undefined) {
    assertWritable(values['json-out'], '--json-out', exportPath);
  }
  const { keymap } = await readKeymap(workspace);
  const inventory =
    values.inventory === undefined ? null : parseInventory(await readJson(values.inventory));
  const result = await writeBundle({
    exportPath,
    outDir: out,
    system,
    keymap,
    exportedAt: values['exported-at'] ?? null,
    inventory,
  });
  const details = await writeDetails(values['json-out'], result);
  process.stdout.write(
    formatCompactJson({
      ...compactBundle(result),
      manifest: path.join(result.bundle, 'analyzr-import.json'),
      details,
    }),
  );
  if (result.failed.length > 0) process.exitCode = 1;
}

async function inventoryCommand(argv: readonly string[]): Promise<void> {
  const { values, positionals } = parse(argv, {
    id: { type: 'string' },
    name: { type: 'string' },
    area: { type: 'string' },
    'external-id': { type: 'string' },
    out: { type: 'string' },
  });
  if (positionals.length !== 1) throw new UsageError('inventory expects one <catalog.csv>');
  const csv = positionals[0] ?? '';
  const name = required(values.name, '--name');
  const out = required(values.out, '--out');
  assertWritable(out, '--out', csv);
  const result = inventoryFromCsv(parseCsv(new Uint8Array(await readFile(csv))), {
    name,
    ...(values.id === undefined ? {} : { id: values.id }),
    ...(values.area === undefined ? {} : { area: values.area }),
    ...(values['external-id'] === undefined ? {} : { externalId: values['external-id'] }),
  });
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await writeFile(out, `${JSON.stringify(result.inventory, null, 2)}\n`, { flag: 'wx' }).catch(
    (err: NodeJS.ErrnoException) => {
      if (err.code === 'EEXIST')
        throw new Error(`${out} exists; write the inventory into a new file`);
      throw err;
    },
  );
  printJson({
    out,
    items: result.inventory.items.length,
    withExternalId: result.inventory.items.filter((i) => i.externalId !== undefined).length,
    rowsWithoutName: result.rowsWithoutName,
    encoding: result.encoding,
    delimiter: result.delimiter,
    dropped: result.dropped,
  });
}

run('normalize-bpmn', USAGE, async () => {
  const [command, ...rest] = process.argv.slice(2);
  if (command === '--help' || command === '-h' || (command !== undefined && wantsHelp(rest))) {
    process.stdout.write(USAGE);
    return;
  }
  switch (command) {
    case 'file':
      return fileCommand(rest);
    case 'plan':
      return planCommand(rest);
    case 'bundle':
      return bundleCommand(rest);
    case 'inventory':
      return inventoryCommand(rest);
    default:
      throw new UsageError(
        command === undefined ? 'a command is required' : `unknown command ${command}`,
      );
  }
});

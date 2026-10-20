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
  KeymapError,
  parseKeymap,
  planKeys,
  rebuildFromAnalyzr,
  type AnalyzrIdentity,
  type KeyRule,
  type Keymap,
  type RebuildReport,
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
      [--existing <models.json>] [--from-analyzr <external-ids.json>]
      [--reset] [--write] [--json-out <file>]
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
           (analyzr models list --json, analyzr-read.mjs models) and flags
           new keys analyzr already has; --from-analyzr reads analyzr's
           identities (analyzr models external-ids --json, analyzr-read.mjs
           external-ids) and plans against the key map rebuilt from them: a
           system missing from keymap.json gets analyzr's keys and the rule
           that derives most of them (or --strip/--prefix), one the map has
           gets the keys it lacks; a tool id several keys carry stays with the
           key the map gives it, else the oldest model with a tool folder (by
           the model ids of --existing); only --write records it. --reset drops the system's rule and keys, only while nothing
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

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The keys of `analyzr models list --json` (objects with `key`, and `id`,
 * the model id that tells the older of two models) or a list of keys.
 */
function existingKeysOf(
  value: unknown,
  file: string,
): { keys: string[]; modelIds: Map<string, string> } {
  if (Array.isArray(value)) {
    const models = value.map((v: unknown) =>
      typeof v === 'string'
        ? { key: v, id: null }
        : isObject(v) && typeof v['key'] === 'string'
          ? { key: v['key'], id: typeof v['id'] === 'string' ? v['id'] : null }
          : null,
    );
    if (models.every((m) => m !== null)) {
      return {
        keys: models.map((m) => m.key),
        modelIds: new Map(models.flatMap((m) => (m.id === null ? [] : [[m.key, m.id] as const]))),
      };
    }
  }
  throw new Error(
    `${file}: expected the output of analyzr models list --json (a list of models with key)`,
  );
}

const isNullableString = (v: unknown): v is string | null => v === null || typeof v === 'string';

/** analyzr's identities: the output of `analyzr models external-ids --json` (`{items}`) or its list. */
function identitiesOf(value: unknown, file: string): AnalyzrIdentity[] {
  const items = isObject(value) ? value['items'] : value;
  if (Array.isArray(items)) {
    const identities = items.map((v: unknown) =>
      isObject(v) &&
      typeof v['key'] === 'string' &&
      typeof v['system'] === 'string' &&
      isNullableString(v['externalId'] ?? null) &&
      isNullableString(v['externalPath'] ?? null)
        ? {
            key: v['key'],
            system: v['system'],
            externalId: (v['externalId'] ?? null) as string | null,
            externalPath: (v['externalPath'] ?? null) as string | null,
          }
        : null,
    );
    if (identities.every((i) => i !== null)) return identities;
  }
  throw new Error(
    `${file}: expected the output of analyzr models external-ids --json ({"items": [{key, system, externalId, externalPath}]})`,
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
    'from-analyzr': { type: 'string' },
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
  const existing =
    values.existing === undefined
      ? undefined
      : existingKeysOf(await readJson(values.existing), values.existing);
  // The key map rebuilt from analyzr's identities (M6 S2b follow-up step 4): read, never written
  // here; --write records it with the plan.
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
  const scanned = await scanExport(exportPath);
  const plan = planKeys(base, scanned.models, {
    system,
    ...(rule === undefined ? {} : { rule }),
    ...(scope === undefined ? {} : { scope }),
    ...(exclude === undefined ? {} : { exclude }),
    ...(existing === undefined ? {} : { existingKeys: existing.keys }),
    reset: values.reset === true,
  });
  let written: string | null = null;
  if (values.write === true) {
    const exportName = path.basename(path.resolve(exportPath));
    await writeFile(file, formatKeymap(applyPlan(base, plan, exportName)));
    written = file;
  }
  const details = await writeDetails(values['json-out'], {
    ...plan,
    ...(rebuilt === undefined ? {} : { rebuilt }),
    skipped: scanned.skipped,
    keymap: file,
    written,
  });
  process.stdout.write(
    formatCompactJson({
      ...compactPlan(plan, rebuilt),
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

// Shared workspaces, exports and converters of the converter runner tests (M6 S3c §4).
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  ConvertError,
  convertExport,
  type ConvertLimits,
  type ConvertResult,
} from '../src/spec/converter.ts';
import type { RunDerivedKind } from '../src/spec/record.ts';

import { PACKAGE_ROOT, tempDir } from './support.ts';
import { zipFolder } from './zip-writer.ts';

const execFileAsync = promisify(execFile);

/** The synthetic exports and example converters (test/fixtures/converters/README.md). */
export const CONVERTER_FIXTURES = path.join(PACKAGE_ROOT, 'test/fixtures/converters');

/** The entry, run from source as the plugin will run its bundle. */
export const CONVERT_ENTRY = path.join(PACKAGE_ROOT, 'src/cli/analyzr-convert.ts');

export const VISIO_EXPORT = '2026-10-14-visio';
export const ARIS_EXPORT = '2026-10-14-aris';

/** Limits that keep a test short; the time per run stays generous for a loaded machine. */
export const TEST_LIMITS: Partial<ConvertLimits> = { runMs: 20_000, childMs: 60_000, heapMb: 512 };

export const sha256 = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex');

/** A fresh workspace: `analyzr-workspace.json`, `exports/`, `converters/`, `reports/`. */
export async function workspace(): Promise<string> {
  const ws = await tempDir();
  await writeFile(path.join(ws, 'analyzr-workspace.json'), '{}\n');
  for (const dir of ['exports', 'converters', 'reports']) await mkdir(path.join(ws, dir));
  return ws;
}

/** The Visio export: `Vertrieb/Prozesse.vsdx`, `Service/Reklamation.vsdx` and `Liesmich.txt`. */
export async function visioExport(ws: string): Promise<string> {
  const dir = path.join(ws, 'exports', VISIO_EXPORT);
  await mkdir(path.join(dir, 'Vertrieb'), { recursive: true });
  await mkdir(path.join(dir, 'Service'), { recursive: true });
  await writeFile(
    path.join(dir, 'Vertrieb', 'Prozesse.vsdx'),
    await zipFolder(path.join(CONVERTER_FIXTURES, 'visio', 'prozesse')),
  );
  await writeFile(
    path.join(dir, 'Service', 'Reklamation.vsdx'),
    await zipFolder(path.join(CONVERTER_FIXTURES, 'visio', 'reklamation')),
  );
  await writeFile(path.join(dir, 'Liesmich.txt'), 'Bitte die Visio-Dateien übernehmen.\n');
  return dir;
}

/** The ARIS export: `Export_Vertrieb.xml`. */
export async function arisExport(ws: string): Promise<string> {
  const dir = path.join(ws, 'exports', ARIS_EXPORT);
  await mkdir(dir, { recursive: true });
  await copyFile(
    path.join(CONVERTER_FIXTURES, 'aris', 'Export_Vertrieb.xml'),
    path.join(dir, 'Export_Vertrieb.xml'),
  );
  return dir;
}

/** An export of the given files (path below the export → content). */
export async function plainExport(
  ws: string,
  files: Readonly<Record<string, string | Uint8Array>>,
  name = '2026-10-14-test',
): Promise<string> {
  const dir = path.join(ws, 'exports', name);
  await mkdir(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), content);
  }
  return dir;
}

export interface ConverterFile {
  file: string;
  sha256: string;
}

/** A converter's working copy in the workspace's `converters/`, with its sha256. */
export async function converter(ws: string, name: string, source: string): Promise<ConverterFile> {
  const file = path.join(ws, 'converters', name);
  await writeFile(file, source);
  return { file, sha256: sha256(source) };
}

/** One of the example converters, copied into the workspace. */
export async function fixtureConverter(ws: string, name: string): Promise<ConverterFile> {
  return converter(ws, name, await readFile(path.join(CONVERTER_FIXTURES, name), 'utf8'));
}

export interface RunOptions {
  derived?: RunDerivedKind;
  llmModel?: string | null;
  out?: string;
  limits?: Partial<ConvertLimits>;
  sha256?: string;
}

/** `convert` in this process (its child is a real one). */
export function convertWith(
  ws: string,
  exportPath: string,
  conv: ConverterFile,
  options: RunOptions = {},
): Promise<ConvertResult> {
  return convertExport({
    exportPath,
    converter: conv.file,
    sha256: options.sha256 ?? conv.sha256,
    derived: options.derived ?? 'converted',
    llmModel: options.llmModel ?? null,
    workspace: ws,
    outDir: options.out ?? path.join(ws, 'specs', 'run'),
    limits: { ...TEST_LIMITS, ...options.limits },
  });
}

/** The error a refused run throws (fails the test when it does not throw one). */
export async function refusal(run: Promise<unknown>): Promise<ConvertError> {
  const err = await run.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(err instanceof ConvertError)) {
    const got = err === null ? 'success' : err instanceof Error ? err.message : typeof err;
    throw new Error(`expected a ConvertError, got ${got}`);
  }
  return err;
}

/**
 * A converter that runs `body` (statements calling `probe(name, fn)`) and returns one line per
 * probe as a skipped file's reason: `name -> value`, `name -> ESCAPED` for an object with a
 * `pid`, or `name threw <constructor> (inner|FOREIGN)`, where `inner` means an error of the
 * converter's own context.
 */
export function probeConverter(body: string): string {
  return `function convert(input, helpers) {
  const out = [];
  const probe = (name, fn) => {
    try {
      const v = fn();
      const shown = v !== null && typeof v === 'object' && typeof v.pid === 'number'
        ? 'ESCAPED'
        : typeof v === 'object' || typeof v === 'function' ? typeof v : String(v);
      out.push(name + ' -> ' + shown);
    } catch (e) {
      const kind = e !== null && typeof e === 'object' && e.constructor ? e.constructor.name : typeof e;
      out.push(name + ' threw ' + kind + (e instanceof Error ? ' (inner)' : ' (FOREIGN)'));
    }
  };
${body}
  return { models: [], skipped: out.map((reason) => ({ path: 'probe', reason: reason.slice(0, 500) })) };
}
`;
}

/** The probe lines of a run of {@link probeConverter}. */
export const probeLines = (result: ConvertResult): string[] =>
  result.record.skipped.map((s) => s.reason);

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** The entry run from source with `args` and the given environment (default: this process's). */
export async function convertCli(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  nodeFlags: readonly string[] = [],
): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [...nodeFlags, CONVERT_ENTRY, ...args],
      { cwd: PACKAGE_ROOT, env },
    );
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

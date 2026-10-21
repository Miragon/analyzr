/**
 * The converter runner's sandbox (M6 S3c §4.3), shared by the parent that
 * starts the child and the child that refuses to run unless it was started
 * exactly so:
 *
 * - Node's permission model (`--permission`) with one read grant: the
 *   script itself, or in source mode (tests, `node src/cli/analyzr-convert.ts`)
 *   the sources below `tools/integrate/src`; the mode follows the script's
 *   extension, never the environment. No write grant, no child processes,
 *   workers, addons, WASI or inspector. Node 24 has no network permission:
 *   the converter reaches no network API only because its context holds no
 *   host object (`child.ts`), which Node cannot guarantee as a sandbox would.
 * - `--disallow-code-generation-from-strings` for every context of the
 *   process, so a function from any realm cannot compile a string.
 * - A heap limit (`--max-old-space-size`). It does not bound the memory of
 *   `ArrayBuffer`s and typed arrays, which V8 keeps outside the heap
 *   (measured on Node 24.15: 2 GB of `Uint8Array`s under a 256 MB heap); the
 *   run's time limit is all that bounds them.
 * - An environment of three fixed variables: no token, cloud or Git
 *   credential reaches the child, and no `NODE_OPTIONS`, which Node reads for
 *   permission flags too (`--allow-fs-write` there would grant a write).
 */
import path from 'node:path';

import type { ZipFileEntry } from './unzip.ts';

/** The internal command the parent starts the child with. */
export const CHILD_COMMAND = '__child';

/** The child's whole environment: UTC and the C locale, the same on every machine. */
export const CHILD_ENV: Readonly<Record<string, string>> = { TZ: 'UTC', LANG: 'C', LC_ALL: 'C' };

/** Variables an operating system sets in every process (macOS: CoreFoundation's text encoding). */
const PLATFORM_ENV: ReadonlySet<string> = new Set(['__CF_USER_TEXT_ENCODING']);

/** What the child may read: the bundled script itself, or in source mode the folder `src/`. */
export function readGrant(script: string): string {
  return script.endsWith('.ts') ? path.resolve(path.dirname(script), '..') : script;
}

/** The Node flags the parent starts the child with (before the script). */
export function childFlags(script: string, heapMb: number): string[] {
  return [
    '--permission',
    `--allow-fs-read=${readGrant(script)}`,
    '--disallow-code-generation-from-strings',
    `--max-old-space-size=${heapMb}`,
  ];
}

/** What the child sees of its own process, to check its sandbox. */
export interface ChildProcessView {
  /** The script, as `process.argv[1]` names it. */
  script: string;
  execArgv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  permission: { has(scope: string, reference?: string): boolean } | undefined;
}

/**
 * Why the child must not run in this process, or `null`: the permission
 * model must be active with exactly the parent's flags (any heap size), the
 * environment exactly {@link CHILD_ENV}, and no write, child process, worker,
 * addon, WASI or inspector permission granted.
 */
export function sandboxProblem(view: ChildProcessView): string | null {
  const { permission } = view;
  if (permission === undefined) return 'the permission model is not active';
  const [heap, ...rest] = view.execArgv.slice(3);
  const expected = childFlags(view.script, 0).slice(0, 3);
  if (
    view.execArgv.length !== 4 ||
    expected.some((flag, i) => view.execArgv[i] !== flag) ||
    heap === undefined ||
    !/^--max-old-space-size=[1-9][0-9]{1,5}$/.test(heap) ||
    rest.length > 0
  ) {
    return `started with other Node flags than the runner's (${view.execArgv.join(' ')})`;
  }
  const keys = Object.keys(view.env).filter((k) => !PLATFORM_ENV.has(k));
  if (
    view.env['NODE_OPTIONS'] !== undefined ||
    keys.length !== Object.keys(CHILD_ENV).length ||
    keys.some((k) => !Object.hasOwn(CHILD_ENV, k) || view.env[k] !== CHILD_ENV[k])
  ) {
    return 'started with an environment other than TZ=UTC, LANG=C and LC_ALL=C';
  }
  const here = path.dirname(view.script);
  const granted = [
    ['fs.write', here],
    ['fs.write', path.parse(here).root],
    ['child'],
    ['worker'],
    ['addon'],
    ['wasi'],
    ['inspector'],
  ].filter(([scope, reference]) =>
    reference === undefined ? permission.has(scope ?? '') : permission.has(scope ?? '', reference),
  );
  if (granted.length > 0) {
    return `the permission model grants ${granted.map((g) => g.join(' ')).join(', ')}`;
  }
  return null;
}

/** One file of the export as the parent sends it to the child (its bytes follow the header). */
export interface ChildFile {
  /** Path below the export, `/`-separated, as `listExport` gives it. */
  path: string;
  size: number;
  /** sha256 of its bytes; `null` for a file the parent did not read. */
  sha256: string | null;
  /** A zip archive's files, or why it was not opened; `null` for any other file. */
  zip: { entries: ZipFileEntry[]; error: string | null } | null;
  /** Why the parent did not read the file (larger than a converter reads), else `null`. */
  unread: string | null;
}

/**
 * What the parent writes on the child's stdin: a 4-byte big-endian length,
 * this header as JSON, then the bytes of every file read (`unread` `null`)
 * in the header's order.
 */
export interface ChildHeader {
  /** The converter's source text (the bytes the consultant approved, decoded). */
  converter: string;
  files: ChildFile[];
  /** Time for one run: the converter's top level and its `convert` call together. */
  runMs: number;
  /** Largest result (bytes of JSON). */
  outputBytes: number;
}

/** What the converter read, counted by the child, not declared by the converter. */
export interface ChildReads {
  /** Files it read (text or bytes, of the file or of an entry of it). */
  files: number;
  /** Files it was given. */
  of: number;
  /** Zip entries it read. */
  entries: number;
}

export type ChildErrorCode =
  'converter-error' | 'timeout' | 'not-deterministic' | 'output-too-large' | 'input';

/** The child's one line on stdout. */
export type ChildReply =
  | { status: 'ok'; reads: ChildReads; result: unknown }
  | { status: 'error'; code: ChildErrorCode; message: string };

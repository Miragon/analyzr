import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  BPMN_FILE_SUFFIXES,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_FILES,
  MAX_MODEL_BYTES,
  comparePaths,
  createProblem,
  isImportPath,
  keyTakenBy,
  modelKeyFromPath,
  modelKeyOwners,
  type ImportFileOutcome,
} from '@analyzr/contracts';

import { CliError } from './errors.ts';

/** Directories never descended into (besides hidden ones). */
const SKIPPED_DIRS = new Set(['node_modules', '.git']);

/** The BPMN suffixes for messages and help: `*.bpmn, *.bpmn2, *.bpmn20.xml, *.xml`. */
export const BPMN_FILE_PATTERNS = [...BPMN_FILE_SUFFIXES]
  .sort()
  .map((suffix) => `*${suffix}`)
  .join(', ');

export interface BpmnFile {
  /** Path below the import root with `/` separators: the server's model key source. */
  path: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/**
 * Every file below `dir` the shared file rule picks up (`isImportPath` of
 * `@analyzr/contracts`: `.bpmn`, `.bpmn2`, `.bpmn20.xml` and `.xml`, as the
 * web upload), sorted by path (`comparePaths`, as the web). Hidden files and
 * directories, `node_modules` and symbolic links are skipped.
 *
 * @throws {CliError} if `dir` is not a directory
 */
export async function findBpmnFiles(dir: string): Promise<BpmnFile[]> {
  const info = await stat(dir).catch(() => null);
  if (!info?.isDirectory()) throw new CliError(`${dir} is not a directory`);

  const found: string[] = [];
  async function walk(rel: string): Promise<void> {
    const entries = await readdir(path.join(dir, rel), { withFileTypes: true });
    for (const e of entries) {
      const child = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && !SKIPPED_DIRS.has(e.name)) await walk(child);
      } else if (e.isFile() && isImportPath(child)) {
        found.push(child);
      }
    }
  }
  await walk('');
  found.sort(comparePaths);
  return Promise.all(
    found.map(async (p) => ({ path: p, bytes: new Uint8Array(await readFile(path.join(dir, p))) })),
  );
}

/**
 * Splits files into import requests of at most {@link MAX_IMPORT_FILES}
 * files and {@link MAX_IMPORT_BYTES} bytes, keeping the order. Files above
 * {@link MAX_MODEL_BYTES} are returned as `oversized` and never sent.
 */
export function batches(files: readonly BpmnFile[]): {
  batches: BpmnFile[][];
  oversized: BpmnFile[];
} {
  const out: BpmnFile[][] = [];
  const oversized: BpmnFile[] = [];
  let current: BpmnFile[] = [];
  let bytes = 0;
  for (const f of files) {
    if (f.bytes.byteLength > MAX_MODEL_BYTES) {
      oversized.push(f);
      continue;
    }
    if (current.length === MAX_IMPORT_FILES || bytes + f.bytes.byteLength > MAX_IMPORT_BYTES) {
      out.push(current);
      current = [];
      bytes = 0;
    }
    current.push(f);
    bytes += f.bytes.byteLength;
  }
  if (current.length > 0) out.push(current);
  return { batches: out, oversized };
}

/**
 * A file the import picked up but did not import: a plain `.xml` the server
 * found to be no BPMN (`not-bpmn`), or one never sent because a `.bpmn…`
 * file of this import has its model key (`key-taken`, a tool's sidecar
 * `Prozess.xml` next to `Prozess.bpmn`; `takenBy` names that file).
 */
export type SkippedFile =
  { path: string; reason: 'not-bpmn' } | { path: string; reason: 'key-taken'; takenBy: string };

export interface ImportPlan {
  /** The files to send, in requests within the limits (see {@link batches}). */
  batches: BpmnFile[][];
  /** Files never sent, as `failed` outcomes with the server's wording. */
  failed: ImportFileOutcome[];
  /** Plain `.xml` files never sent because a `.bpmn…` file has their key (`key-taken`). */
  skipped: SkippedFile[];
}

/**
 * Derives every model key before sending, as the server does
 * (`modelKeyFromPath`), and keeps out a file whose path gives no valid key,
 * whose key another file of this import gets (in another request the server
 * could not tell, and the second file would silently revise the first), or
 * that is larger than {@link MAX_MODEL_BYTES}. A key goes to the first
 * `.bpmn…` file and only then to a plain `.xml` (`modelKeyOwners`), so an XML
 * that may be no BPMN never keeps a model out. A plain `.xml` whose key a
 * `.bpmn…` file got is skipped (`key-taken`, `keyTakenBy`); every other
 * duplicate fails, naming the file that gets the key. Checks in the server's
 * order: key, duplicate key, size.
 */
export function planImport(files: readonly BpmnFile[]): ImportPlan {
  const failed: ImportFileOutcome[] = [];
  const skipped: SkippedFile[] = [];
  const send: BpmnFile[] = [];
  const owners = modelKeyOwners(
    files.filter((f) => f.bytes.byteLength <= MAX_MODEL_BYTES).map((f) => f.path),
  );
  const sent = new Set<string>();
  for (const f of files) {
    const key = modelKeyFromPath(f.path);
    const fail = (code: 'validation-failed' | 'payload-too-large', detail: string) =>
      failed.push({
        path: f.path,
        modelKey: key,
        outcome: 'failed',
        problem: createProblem(code, detail),
      });
    const owner = key === null ? undefined : owners.get(key);
    const takenBy = keyTakenBy(f.path, owners);
    if (!key) fail('validation-failed', 'the path gives no valid model key');
    else if (takenBy !== null) skipped.push({ path: f.path, reason: 'key-taken', takenBy });
    else if (owner !== undefined && (owner !== f.path || sent.has(key))) {
      fail('validation-failed', `another file of this import has model key ${key} (${owner})`);
    } else if (f.bytes.byteLength > MAX_MODEL_BYTES) {
      fail('payload-too-large', `a model may have at most ${MAX_MODEL_BYTES} bytes`);
    } else {
      sent.add(key);
      send.push(f);
    }
  }
  return { batches: batches(send).batches, failed, skipped };
}

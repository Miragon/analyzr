/**
 * The converter runner's parent (M6 S3c §4.3, `analyzr-convert convert`):
 * runs exactly the converter bytes the consultant approved on one export of
 * the workspace, in the child of `child.ts` inside the sandbox of
 * `sandbox.ts`, and writes each valid model as an `analyzr-spec/1` file plus
 * the run record `analyzr-specs.json` (`record.ts`) into a new spec folder.
 *
 * 1. Checks, before anything runs or is written: the workspace; the export
 *    below its `exports/`; the converter in its `converters/`, a regular
 *    file with one name and at most 1 MB, read once, whose full sha256 must
 *    be the one the consultant approved (`--sha256`: a converter changed
 *    after the question is refused, and the child gets the bytes read here,
 *    never a path); a converter that names `import` is refused, since a
 *    dynamic import would hand it an object of the child; the derivation;
 *    the output folder (new or empty; never below `exports/` or in a
 *    checkout).
 * 2. Reads the export itself (the child cannot): every regular file
 *    `listExport` gives, hidden files and symbolic links skipped and
 *    counted, each opened without following a link, at most 512 MB in all;
 *    a file over 64 MB is not read and reaches the converter without its
 *    bytes, with the reason (so a large print next to the drawings does not
 *    block the run); zip archives' directories under the guards of
 *    `unzip.ts` (an archive that fails one reaches the converter unopened,
 *    with the reason).
 * 3. Writes the write-once copy `converters/adhoc-<12 hex>.js`; an existing
 *    copy must hold the same bytes.
 * 4. Starts the child with the flags and environment of `sandbox.ts`, sends
 *    the converter and the files on stdin, and kills it after 300 s or when
 *    its output outgrows 256 MB.
 * 5. Validates the result: an object with `models` (analyzr-spec/1 objects
 *    without `format` and `derived`, each with optional `losses`), and
 *    optional `skipped` and `systemVersion`. A model returned twice byte for
 *    byte is kept once (`duplicates`); a model that fails validation, or
 *    shares its tool path or tool id with another one (every holder: none of
 *    them is known to be right), is listed in `failed`; the others are
 *    written (the command then exits 1).
 * 6. Writes the specs and the run record, after checking that the record
 *    stays within what `analyzr-spec` reads (else nothing is written).
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { modelKeyFromPath } from '@analyzr/contracts/paths';

import { formatJson, MAX_SYSTEM_VERSION_CHARS } from '../bundle.ts';
import { tidyDeclared } from '../declared.ts';
import { ExportPathError, listExport } from '../files.ts';
import { isInside, resolvedPath, WORKSPACE_FILE } from '../guards.ts';

import { problemLine } from './compact.ts';
import { UNSTORABLE } from './declared.ts';
import { assertSpecOutput } from './guards.ts';
import {
  converterCopy,
  converterId,
  CONVERTERS_DIR,
  hashRegularFile,
  MAX_CONVERTER_BYTES,
  MAX_RECORD_BYTES,
  readLosses,
  recordedLines,
  RUN_RECORD_FILE,
  RUN_RECORD_FORMAT,
  SHA256,
  type RecordedSpec,
  type RunDerivedKind,
  type RunRecord,
} from './record.ts';
import {
  CHILD_COMMAND,
  CHILD_ENV,
  childFlags,
  type ChildFile,
  type ChildHeader,
  type ChildReply,
} from './sandbox.ts';
import { looksZip, readZipDirectory, ZIP_LIMITS, type ZipLimits } from './unzip.ts';
import { MAX_LLM_MODEL_LENGTH, validateSpec } from './validate.ts';
import { ANALYZR_CONVERT_VERSION, SPEC_FORMAT } from '../version.ts';
import { formatSpec, parseSpecBytes } from './yaml.ts';

export interface ConvertLimits {
  /** Largest file of the export. */
  fileBytes: number;
  /** Largest export, all files together. */
  totalBytes: number;
  zip: ZipLimits;
  /** Time for one run of the converter (it runs twice). */
  runMs: number;
  /** Time for the whole child. */
  childMs: number;
  /** The child's heap. */
  heapMb: number;
  /** Largest result (bytes of JSON). */
  outputBytes: number;
  /** Largest run record (at most what `analyzr-spec` reads). */
  recordBytes: number;
}

/** The limits of R28 and R29. */
export const CONVERT_LIMITS: ConvertLimits = {
  fileBytes: 64 * 1024 * 1024,
  totalBytes: 512 * 1024 * 1024,
  zip: ZIP_LIMITS,
  runMs: 120_000,
  childMs: 300_000,
  heapMb: 4096,
  outputBytes: 256 * 1024 * 1024,
  recordBytes: MAX_RECORD_BYTES,
};

/** Most models and skipped files one result may hold. */
export const MAX_MODELS = 10_000;
const MAX_SKIPPED = 10_000;
const MAX_REASON_LENGTH = 500;
/** The child's stderr kept for a message. */
const STDERR_KEPT = 64 * 1024;

export interface ConvertOptions {
  /** A folder or file below `<workspace>/exports/`. */
  exportPath: string;
  /** The converter's working copy in `<workspace>/converters/`. */
  converter: string;
  /** The full sha256 the consultant approved. */
  sha256: string;
  derived: RunDerivedKind;
  /** The model the agent runs as: required for `reconstructed`, refused for `converted`. */
  llmModel: string | null;
  workspace: string;
  /** The new spec folder (absent or empty). */
  outDir: string;
  /** Smaller limits (tests). */
  limits?: Partial<ConvertLimits>;
}

export type ConvertErrorCode =
  | 'workspace'
  | 'export'
  | 'converter'
  | 'sha256'
  | 'import'
  | 'derived'
  | 'out'
  | 'copy'
  | 'too-large'
  | 'sandbox'
  | 'timeout'
  | 'out-of-memory'
  | 'output-too-large'
  | 'not-deterministic'
  | 'converter-error'
  | 'result';

export class ConvertError extends Error {
  readonly code: ConvertErrorCode;

  constructor(code: ConvertErrorCode, message: string) {
    super(message);
    this.name = 'ConvertError';
    this.code = code;
  }
}

export interface ConvertResult {
  /** The spec folder. */
  outDir: string;
  /** The run record's path. */
  recordFile: string;
  record: RunRecord;
}

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (o: Rec, key: string): unknown => (Object.hasOwn(o, key) ? o[key] : undefined);
const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/**
 * `import` as a word (an identifier that merely contains it, `imports`, is
 * no match; `import$x` is): a dynamic import can be written in no other
 * way, since a keyword takes no escapes, a letter, digit, `_` or `$` before
 * it would make it part of another identifier, and a backslash before it a
 * syntax error or part of a string.
 */
const IMPORT_WORD = /(?<![A-Za-z0-9_$\\])import\b/;

/**
 * What is wrong with a run's derivation and model id, or `null`: `reconstructed`
 * needs the model the agent runs as, `converted` takes none (the CLI's usage
 * check and {@link convertExport}'s).
 */
export function derivedProblem(
  derived: ConvertOptions['derived'],
  llmModel: string | null,
): string | null {
  if (derived === 'reconstructed') {
    const model = llmModel ?? '';
    return model.trim() === '' || model.length > MAX_LLM_MODEL_LENGTH || UNSTORABLE.test(model)
      ? `--derived reconstructed needs --llm-model: the model you run as (1 to ${MAX_LLM_MODEL_LENGTH} characters)`
      : null;
  }
  return llmModel === null
    ? null
    : '--llm-model goes with --derived reconstructed only: a converted model is read, not interpreted';
}

/** The script the child runs: this bundle itself, in source mode `src/cli/analyzr-convert.ts`. */
export function childScript(moduleUrl: string = import.meta.url): string {
  const file = fileURLToPath(moduleUrl);
  return file.endsWith('.ts')
    ? path.join(path.dirname(file), '..', 'cli', 'analyzr-convert.ts')
    : file;
}

/** `p` below `base` with `/` separators. */
const below = (base: string, p: string): string => path.relative(base, p).split(path.sep).join('/');

async function isFile(p: string): Promise<boolean> {
  return (await stat(p).catch(() => null))?.isFile() === true;
}

/** A file of the export, read whole: a regular file (no link) of exactly `size` bytes. */
async function readExportFile(absolute: string, size: number, shown: string): Promise<Uint8Array> {
  let handle;
  try {
    handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    throw new ConvertError('export', `${shown} could not be read as a regular file`);
  }
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size !== size) {
      throw new ConvertError('export', `${shown} changed while the export was read`);
    }
    const bytes = Buffer.alloc(size);
    let read = 0;
    while (read < size) {
      const { bytesRead } = await handle.read(bytes, read, size - read, read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    if (read !== size)
      throw new ConvertError('export', `${shown} changed while the export was read`);
    return bytes;
  } finally {
    await handle.close();
  }
}

/** The converter's text, checked: strict UTF-8 (a byte order mark dropped), no `import`. */
function converterText(bytes: Uint8Array, shown: string): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ConvertError('converter', `${shown} is not UTF-8: save the converter as UTF-8`);
  }
  const match = IMPORT_WORD.exec(text);
  if (match !== null) {
    const line = text.slice(0, match.index).split('\n').length;
    throw new ConvertError(
      'import',
      `${shown} names import (line ${line}): a converter is a classic script that imports nothing, not even dynamically; leave the word out, also in comments and strings (for an element named so, compare with 'im' + 'port')`,
    );
  }
  return text;
}

/** The checks of step 1 that need no file of the export. */
async function checkInputs(options: ConvertOptions): Promise<{
  workspace: string;
  exportPath: string;
  converterPath: string;
  converterBytes: Buffer;
  converterSource: string;
  sha256: string;
}> {
  const workspace = resolvedPath(options.workspace);
  if (!(await isFile(path.join(workspace, WORKSPACE_FILE)))) {
    throw new ConvertError(
      'workspace',
      `--workspace ${options.workspace} is no workspace (it holds no ${WORKSPACE_FILE})`,
    );
  }
  const exports = path.join(workspace, 'exports');
  const exportPath = resolvedPath(options.exportPath);
  if (!isInside(exportPath, exports) || exportPath === resolvedPath(exports)) {
    throw new ConvertError(
      'export',
      `${options.exportPath} lies not below ${exports}: a converter reads one export of the workspace (exports/<YYYY-MM-DD>-<system>/)`,
    );
  }

  const converterPath = path.resolve(options.converter);
  const converters = path.join(workspace, CONVERTERS_DIR);
  if (resolvedPath(path.dirname(converterPath)) !== resolvedPath(converters)) {
    throw new ConvertError(
      'converter',
      `--converter ${options.converter} lies not in ${converters}/: write the converter there`,
    );
  }
  const shown = `--converter ${options.converter}`;
  const hashed = await hashRegularFile(converterPath, MAX_CONVERTER_BYTES);
  if ('problem' in hashed) throw new ConvertError('converter', `${shown}: ${hashed.problem}`);
  const sha256 = options.sha256.toLowerCase();
  if (!SHA256.test(sha256)) {
    throw new ConvertError('sha256', "--sha256 is the converter's full sha256 (64 hex characters)");
  }
  if (hashed.sha256 !== sha256) {
    throw new ConvertError(
      'sha256',
      `${shown} has the sha256 ${hashed.sha256}, not the approved ${sha256}: it changed after the consultant approved it; show the new version and ask again`,
    );
  }
  const converterSource = converterText(hashed.bytes, shown);

  const derivedWrong = derivedProblem(options.derived, options.llmModel);
  if (derivedWrong !== null) throw new ConvertError('derived', derivedWrong);

  assertSpecOutput(options.outDir, '--out', { workspace });
  const entries = await readdir(options.outDir).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return [];
    throw new ConvertError('out', `--out ${options.outDir} is no folder`);
  });
  if (entries.length > 0) {
    throw new ConvertError(
      'out',
      `--out ${options.outDir} is not empty: write every run into a new folder (specs/<YYYY-MM-DD>-<system>/)`,
    );
  }
  return {
    workspace,
    exportPath,
    converterPath,
    converterBytes: hashed.bytes,
    converterSource,
    sha256,
  };
}

/** Step 2: the export's files with their bytes and zip directories. */
async function readExport(
  exportPath: string,
  shownExport: string,
  limits: ConvertLimits,
): Promise<{
  files: ChildFile[];
  contents: Uint8Array[];
  symlinks: number;
  hidden: number;
}> {
  let listing;
  try {
    listing = await listExport(exportPath);
  } catch (err) {
    if (err instanceof ExportPathError) throw new ConvertError('export', err.message);
    throw err;
  }
  if (listing.files.length === 0) {
    throw new ConvertError('export', `${shownExport} holds no file to convert`);
  }
  let total = 0;
  for (const f of listing.files) if (f.size <= limits.fileBytes) total += f.size;
  if (total > limits.totalBytes) {
    throw new ConvertError(
      'too-large',
      `the export's files have ${total} bytes; a converter run reads at most ${limits.totalBytes}: run the converter on one folder or file of the export at a time, each into its own --out`,
    );
  }
  const files: ChildFile[] = [];
  const contents: Uint8Array[] = [];
  for (const f of listing.files) {
    if (f.size > limits.fileBytes) {
      const split = /\.xml$/i.test(f.path)
        ? ` (a large ARIS database: export it by group, each file under ${Math.floor(limits.fileBytes / 1024 / 1024)} MB)`
        : '';
      files.push({
        path: f.path,
        size: f.size,
        sha256: null,
        zip: null,
        unread: `${f.size} bytes; a converter reads files of at most ${limits.fileBytes} bytes${split}`,
      });
      continue;
    }
    const bytes = await readExportFile(f.absolute, f.size, f.path);
    contents.push(bytes);
    files.push({
      path: f.path,
      size: f.size,
      sha256: sha256Of(bytes),
      zip: looksZip(bytes) ? readZipDirectory(bytes, limits.zip) : null,
      unread: null,
    });
  }
  return { files, contents, symlinks: listing.symlinks, hidden: listing.hidden };
}

/** Step 3: the write-once copy of the converter. */
async function writeCopy(workspace: string, sha256: string, bytes: Uint8Array): Promise<void> {
  const copy = path.join(workspace, ...converterCopy(sha256).split('/'));
  try {
    await writeFile(copy, bytes, { flag: 'wx' });
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  const existing = await hashRegularFile(copy, MAX_CONVERTER_BYTES);
  if ('problem' in existing || existing.sha256 !== sha256) {
    throw new ConvertError(
      'copy',
      `${converterCopy(sha256)} exists with other bytes${'problem' in existing ? ` (${existing.problem})` : ''}: the copy of a converter run is never changed; move it away only if no bundle was made from it`,
    );
  }
}

/**
 * Step 4: the child's reply, or the reason it gave none. `script` is the
 * child's script (tests start a stand-in to check the parent's own guards).
 */
export function runChild(
  header: ChildHeader,
  contents: readonly Uint8Array[],
  limits: ConvertLimits,
  script: string = childScript(),
): Promise<ChildReply> {
  const child = spawn(
    process.execPath,
    [...childFlags(script, limits.heapMb), script, CHILD_COMMAND],
    { env: { ...CHILD_ENV }, cwd: path.dirname(script), stdio: ['pipe', 'pipe', 'pipe'] },
  );
  return new Promise((resolve, reject) => {
    const out: Buffer[] = [];
    let outBytes = 0;
    const err: Buffer[] = [];
    let errBytes = 0;
    let failure: ConvertError | null = null;
    const stop = (e: ConvertError): void => {
      failure ??= e;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(() => {
      stop(
        new ConvertError(
          'timeout',
          `the converter did not finish within ${Math.round(limits.childMs / 1000)} s: the run was stopped`,
        ),
      );
    }, limits.childMs);
    child.stdout.on('data', (chunk: Buffer) => {
      outBytes += chunk.length;
      // the reply wraps the result: the child refuses a larger result itself
      if (outBytes > limits.outputBytes + 1024 * 1024) {
        stop(
          new ConvertError(
            'output-too-large',
            `the converter's result has more than ${limits.outputBytes} bytes of JSON: the run was stopped`,
          ),
        );
        return;
      }
      out.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (errBytes < STDERR_KEPT) {
        err.push(chunk);
        errBytes += chunk.length;
      }
    });
    // the child may end before it read everything (it refused its sandbox, or was stopped)
    child.stdin.on('error', () => undefined);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new ConvertError('sandbox', `the converter's sandbox did not start: ${e.message}`));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (failure !== null) {
        reject(failure);
        return;
      }
      const stderr = Buffer.concat(err).toString('utf8').trim();
      let reply: unknown;
      try {
        reply = JSON.parse(Buffer.concat(out).toString('utf8'));
      } catch {
        reply = null;
      }
      const status = isRecord(reply) ? own(reply, 'status') : undefined;
      if (code === 0 && (status === 'ok' || status === 'error')) {
        resolve(reply as ChildReply);
        return;
      }
      if (/heap out of memory|reached heap limit/i.test(stderr)) {
        reject(
          new ConvertError(
            'out-of-memory',
            `the converter ran out of memory (${limits.heapMb} MB): it holds too much at once`,
          ),
        );
        return;
      }
      const tail = stderr.split('\n').slice(-3).join(' ').slice(0, 500);
      reject(
        new ConvertError(
          'sandbox',
          `the converter's sandbox ended without a result (${signal ?? `exit ${String(code)}`})${tail === '' ? '' : `: ${tail}`}`,
        ),
      );
    });
    const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(headerBytes.length);
    child.stdin.write(length);
    child.stdin.write(headerBytes);
    for (const c of contents) child.stdin.write(c);
    child.stdin.end();
  });
}

/** The parts of a result besides its models: what the converter skipped, the tool version. */
function readResult(result: unknown): {
  models: unknown[];
  skipped: RunRecord['skipped'];
  systemVersion: string | null;
} {
  if (!isRecord(result)) {
    throw new ConvertError(
      'result',
      'convert returned no object: return { models: [...], skipped: [...], systemVersion }',
    );
  }
  for (const key of Object.keys(result)) {
    if (key !== 'models' && key !== 'skipped' && key !== 'systemVersion') {
      throw new ConvertError(
        'result',
        `convert's result has the unknown field ${JSON.stringify(key.slice(0, 80))} (models, skipped, systemVersion)`,
      );
    }
  }
  const models = own(result, 'models');
  if (!Array.isArray(models)) {
    throw new ConvertError('result', "convert's result has no list models");
  }
  if (models.length > MAX_MODELS) {
    throw new ConvertError(
      'result',
      `convert returned more than ${MAX_MODELS} models: convert the export in parts`,
    );
  }
  const rawSkipped = own(result, 'skipped') ?? [];
  if (!Array.isArray(rawSkipped) || rawSkipped.length > MAX_SKIPPED) {
    throw new ConvertError(
      'result',
      `skipped: expected a list of at most ${MAX_SKIPPED} { path, reason }`,
    );
  }
  const skipped = rawSkipped.map((s, i) => {
    const p = isRecord(s) ? own(s, 'path') : undefined;
    const reason = isRecord(s) ? own(s, 'reason') : undefined;
    if (
      !isRecord(s) ||
      Object.keys(s).some((k) => k !== 'path' && k !== 'reason') ||
      typeof p !== 'string' ||
      p === '' ||
      p.length > 1024 ||
      typeof reason !== 'string' ||
      reason.trim() === '' ||
      reason.length > MAX_REASON_LENGTH
    ) {
      throw new ConvertError(
        'result',
        `skipped[${i}]: expected { path, reason } (a file of the export and why, at most ${MAX_REASON_LENGTH} characters)`,
      );
    }
    return { path: p, reason };
  });
  const version = own(result, 'systemVersion') ?? null;
  if (version !== null && typeof version !== 'string') {
    throw new ConvertError('result', 'systemVersion: expected a string or null');
  }
  return {
    models,
    skipped,
    systemVersion: tidyDeclared(version, MAX_SYSTEM_VERSION_CHARS),
  };
}

/** The spec file of a model: its tool path as a key (`vertrieb/prozesse/auftrag.spec.yaml`), `-2`, … on a clash. */
function specFileName(externalPath: string, taken: Set<string>): string {
  const base = modelKeyFromPath(externalPath) ?? 'model';
  let file = `${base}.spec.yaml`;
  for (let n = 2; taken.has(file); n++) file = `${base}-${n}.spec.yaml`;
  taken.add(file);
  return file;
}

/**
 * `analyzr-convert convert`: runs the approved converter on the export and
 * writes its specs and run record (see the module comment).
 *
 * @throws {ConvertError} when a check refuses the run or the run fails (nothing is written then but the converter's copy, once it ran)
 * @throws {PathGuardError} for an output in the export, below `exports/` or in a checkout
 */
export async function convertExport(options: ConvertOptions): Promise<ConvertResult> {
  const limits: ConvertLimits = { ...CONVERT_LIMITS, ...options.limits };
  const checked = await checkInputs(options);
  const { workspace, exportPath, sha256 } = checked;
  const exported = await readExport(exportPath, options.exportPath, limits);

  await mkdir(path.join(workspace, CONVERTERS_DIR), { recursive: true });
  await writeCopy(workspace, sha256, checked.converterBytes);

  const reply = await runChild(
    {
      converter: checked.converterSource,
      files: exported.files,
      runMs: limits.runMs,
      outputBytes: limits.outputBytes,
    },
    exported.contents,
    limits,
  );
  if (reply.status === 'error') {
    throw new ConvertError(
      reply.code === 'input' ? 'sandbox' : reply.code,
      `converter ${converterId(sha256)}: ${reply.message}`,
    );
  }
  const { models, skipped, systemVersion } = readResult(reply.result);

  const failed: RunRecord['failed'] = [];
  const failModel = (model: number, externalPath: string | null, errors: string[]): void => {
    const lines = recordedLines(errors);
    failed.push({ model, externalPath, errors: lines.lines, errorCount: lines.count });
  };
  const duplicates: RunRecord['duplicates'] = [];
  const candidates: { model: number; value: Rec; spec: RecordedSpec }[] = [];
  const seen = new Map<string, number>();
  for (const [i, raw] of models.entries()) {
    const label = `models[${i}]`;
    if (!isRecord(raw)) {
      failModel(i, null, [`${label}: expected an analyzr-spec/1 mapping`]);
      continue;
    }
    // a model returned twice byte for byte (overlapping export files) is one model
    const text = JSON.stringify(raw);
    const first = seen.get(text);
    if (first !== undefined) {
      duplicates.push({ model: i, of: first });
      continue;
    }
    seen.set(text, i);
    const { losses: rawLosses, ...rest } = raw;
    const value: Rec = Object.hasOwn(rest, 'format') ? rest : { format: SPEC_FORMAT, ...rest };
    const validation = validateSpec(value, { origin: 'converter' });
    const losses = readLosses(rawLosses);
    const errors = validation.errors.map((p) => problemLine(label, p));
    if ('problem' in losses) errors.push(`${label}: ${losses.problem}`);
    const source = validation.spec?.source ?? null;
    if (source === null || errors.length > 0 || 'problem' in losses) {
      const shownPath = isRecord(own(raw, 'source'))
        ? own(own(raw, 'source') as Rec, 'externalPath')
        : undefined;
      failModel(i, typeof shownPath === 'string' ? shownPath.slice(0, 1024) : null, errors);
      continue;
    }
    const warnings = recordedLines(
      validation.warnings.map((w) => problemLine('', w).replace(/^: /, '')),
    );
    candidates.push({
      model: i,
      value,
      spec: {
        file: '',
        sha256: '',
        externalPath: source.externalPath,
        externalId: source.externalId,
        losses: losses.losses,
        warnings: warnings.lines,
        warningCount: warnings.count,
      },
    });
  }

  // a tool path or tool id held by two models fails all of them: none is known to be the right one
  const holders = (key: (c: RecordedSpec) => string | null): Map<string, number[]> => {
    const map = new Map<string, number[]>();
    for (const c of candidates) {
      const k = key(c.spec);
      if (k !== null) map.set(k, [...(map.get(k) ?? []), c.model]);
    }
    return map;
  };
  const byPath = holders((c) => c.externalPath);
  const byId = holders((c) => c.externalId);
  const others = (all: readonly number[], self: number): string => {
    const rest = all.filter((m) => m !== self);
    return `${rest
      .slice(0, 3)
      .map((m) => `models[${m}]`)
      .join(', ')}${rest.length > 3 ? ', …' : ''}`;
  };
  const valid: typeof candidates = [];
  for (const c of candidates) {
    const label = `models[${c.model}]`;
    const errors: string[] = [];
    const samePath = byPath.get(c.spec.externalPath) ?? [];
    if (samePath.length > 1) {
      errors.push(
        `${label}.source.externalPath: also ${others(samePath, c.model)}'s; write one model per tool path`,
      );
    }
    const sameId = c.spec.externalId === null ? [] : (byId.get(c.spec.externalId) ?? []);
    if (sameId.length > 1) {
      errors.push(
        `${label}.source.externalId: also ${others(sameId, c.model)}'s; an externalId identifies one model`,
      );
    }
    if (errors.length > 0) failModel(c.model, c.spec.externalPath, errors);
    else valid.push(c);
  }

  // every spec as it will be written, checked to read back as validated; written only below
  const taken = new Set<string>();
  const specs: RecordedSpec[] = [];
  const toWrite: { file: string; value: Rec; sha256: string }[] = [];
  for (const v of valid) {
    const file = specFileName(v.spec.externalPath, taken);
    const bytes = Buffer.from(formatSpec(v.value), 'utf8');
    // what analyzr-spec will read must be what was validated
    const back = parseSpecBytes(bytes);
    const reread =
      back.errors.length > 0 ? null : validateSpec(back.value, { origin: 'converter' });
    if (reread?.spec == null) {
      const problem = back.errors[0] ?? reread?.errors[0];
      failModel(v.model, v.spec.externalPath, [
        `models[${v.model}]: ${problem === undefined ? 'the spec does not read back as written' : problemLine('', problem).replace(/^: /, '')}`,
      ]);
      continue;
    }
    const sha256Spec = sha256Of(bytes);
    specs.push({ ...v.spec, file, sha256: sha256Spec });
    toWrite.push({ file, value: v.value, sha256: sha256Spec });
  }
  failed.sort((a, b) => a.model - b.model);

  const record: RunRecord = {
    format: RUN_RECORD_FORMAT,
    converter: {
      id: converterId(sha256),
      sha256,
      file: converterCopy(sha256),
      workingCopy: below(workspace, resolvedPath(checked.converterPath)),
    },
    derived: {
      kind: options.derived,
      llmModel: options.derived === 'reconstructed' ? options.llmModel : null,
    },
    runner: `analyzr-convert@${ANALYZR_CONVERT_VERSION}`,
    export: below(workspace, exportPath),
    systemVersion,
    reads: reply.reads,
    specs,
    failed,
    duplicates,
    skipped,
    unread: exported.files.flatMap((f) =>
      f.unread === null ? [] : [{ path: f.path, reason: f.unread }],
    ),
    zipRefused: exported.files.flatMap((f) =>
      f.zip?.error == null ? [] : [{ path: f.path, reason: f.zip.error }],
    ),
    symlinksSkipped: exported.symlinks,
    hiddenSkipped: exported.hidden,
  };
  const recordText = formatJson(record);
  const recordBytes = Buffer.byteLength(recordText, 'utf8');
  if (recordBytes > limits.recordBytes) {
    throw new ConvertError(
      'result',
      `the run record would have ${recordBytes} bytes; analyzr-spec reads one of at most ${limits.recordBytes}: run the converter on one folder or file of the export at a time, each into its own --out`,
    );
  }

  await mkdir(options.outDir, { recursive: true });
  for (const w of toWrite) {
    const bytes = Buffer.from(formatSpec(w.value), 'utf8');
    if (sha256Of(bytes) !== w.sha256) throw new Error(`${w.file}: formatted differently twice`);
    const absolute = path.join(options.outDir, ...w.file.split('/'));
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes, { flag: 'wx' });
  }
  const recordFile = path.join(options.outDir, RUN_RECORD_FILE);
  await writeFile(recordFile, recordText, { flag: 'wx' });
  return { outDir: options.outDir, recordFile, record };
}

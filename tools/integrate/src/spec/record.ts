/**
 * A converter run's record (M6 S3c §4.3 step 7, §3.6): `analyzr-convert
 * convert` writes `analyzr-specs.json` next to the specs it wrote, and
 * `analyzr-spec` reads it to give exactly those specs their derivation. The
 * record names the converter by its full sha256 and the write-once copy of
 * its bytes in the workspace (`converters/adhoc-<12 hex>.js`), so the code
 * that produced a bundle stays auditable after the agent edits its working
 * copy. It has no timestamps: the same converter on the same export writes
 * the same record.
 *
 * These checks catch mistakes (a spec edited after the run, a copy changed
 * or missing), not an agent set on forging: it could write a record too.
 * That is what the skill's ground rule (only the scripts write specs,
 * manifests and bundles) and the stop on modelled files and calls in the
 * preview are for.
 */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';

import { MAX_SYSTEM_VERSION_CHARS } from '../bundle.ts';
import { tidyDeclared } from '../declared.ts';

import { UNSTORABLE } from './declared.ts';
import type { SpecLoss } from './render.ts';
import type { ChildReads } from './sandbox.ts';
import { MAX_LLM_MODEL_LENGTH } from './validate.ts';

/** The record's name in a spec folder. */
export const RUN_RECORD_FILE = 'analyzr-specs.json';

/** The record's format. */
export const RUN_RECORD_FORMAT = 'analyzr-specs/1';

/** The workspace folder of converters: the agent's working copies and the write-once copies. */
export const CONVERTERS_DIR = 'converters';

/** Largest converter (bytes), and largest record (`convert` writes no larger one). */
export const MAX_CONVERTER_BYTES = 1024 * 1024;
export const MAX_RECORD_BYTES = 16 * 1024 * 1024;

/** Most warning lines kept per spec and error lines per failed model (with their full count). */
export const MAX_RECORDED_LINES = 5;

/** A loss code as the manifest's `LossCode` (`import-manifest.ts`). */
export const LOSS_CODE = /^[a-z][a-z0-9-]{0,49}$/;

/** Most loss codes a converter declares per model: with the renderer's four, the manifest's 20 hold all. */
export const MAX_CONVERTER_LOSSES = 16;

/** Largest count of a loss (the manifest's). */
export const MAX_LOSS_COUNT = 1_000_000_000;

/** How a converter run's specs are derived: chosen per mapping by the consultant (`--derived`). */
export type RunDerivedKind = 'converted' | 'reconstructed';

/** The id a run records: `adhoc:` and the first 12 hex characters of the converter's sha256. */
export const converterId = (sha256: string): string => `adhoc:${sha256.slice(0, 12)}`;

/** The write-once copy of a converter, below the workspace. */
export const converterCopy = (sha256: string): string =>
  `${CONVERTERS_DIR}/adhoc-${sha256.slice(0, 12)}.js`;

export const SHA256 = /^[0-9a-f]{64}$/;

export interface RecordedSpec {
  /** Path below the spec folder, `/`-separated. */
  file: string;
  /** sha256 of the file as written. */
  sha256: string;
  externalPath: string;
  externalId: string | null;
  /** What the converter declared it dropped, by code. */
  losses: SpecLoss[];
  /** The validator's first warnings, as lines (`validate` lists all). */
  warnings: string[];
  /** How many warnings the validator gave. */
  warningCount: number;
}

export interface RunRecord {
  format: typeof RUN_RECORD_FORMAT;
  converter: {
    id: string;
    sha256: string;
    /** The write-once copy, below the workspace. */
    file: string;
    /** The file the run was started with, below the workspace. */
    workingCopy: string;
  };
  derived: { kind: RunDerivedKind; llmModel: string | null };
  /** `analyzr-convert@<version>`. */
  runner: string;
  /** The export, below the workspace. */
  export: string;
  /** The tool version the converter read from the export, tidied, or `null`. */
  systemVersion: string | null;
  /** Counted by the runner, not declared by the converter. */
  reads: ChildReads;
  specs: RecordedSpec[];
  /**
   * Models the converter returned that failed validation (by their index in
   * its result): their first errors and how many.
   */
  failed: { model: number; externalPath: string | null; errors: string[]; errorCount: number }[];
  /** Models the converter returned twice, byte for byte: `model` left out as a copy of `of`. */
  duplicates: { model: number; of: number }[];
  /** Files the converter reported it did not convert. */
  skipped: { path: string; reason: string }[];
  /** Files of the export the runner did not read (larger than a converter reads), with why. */
  unread: { path: string; reason: string }[];
  /** Zip archives of the export that were not opened, with the guard. */
  zipRefused: { path: string; reason: string }[];
  symlinksSkipped: number;
  hiddenSkipped: number;
}

type Rec = Record<string, unknown>;
const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (o: Rec, key: string): unknown => (Object.hasOwn(o, key) ? o[key] : undefined);
const textOf = (v: unknown): string => (typeof v === 'string' ? v : '');
const whole = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) ? v : 0);
const lineList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((l): l is string => typeof l === 'string') : [];

/** The first {@link MAX_RECORDED_LINES} of `all`, with how many there are. */
export function recordedLines(all: readonly string[]): { lines: string[]; count: number } {
  return { lines: all.slice(0, MAX_RECORDED_LINES), count: all.length };
}

/**
 * A converter's declared losses of one model (absent: none): at most 16
 * codes, each once, a `LossCode` with a whole count of at most 1e9; zero
 * counts are left out, the rest sorted by code.
 */
export function readLosses(value: unknown): { losses: SpecLoss[] } | { problem: string } {
  if (value === undefined || value === null) return { losses: [] };
  if (!Array.isArray(value)) return { problem: 'losses: expected a list of {code, count}' };
  if (value.length > MAX_CONVERTER_LOSSES) {
    return { problem: `losses: at most ${MAX_CONVERTER_LOSSES} codes per model` };
  }
  const seen = new Set<string>();
  const losses: SpecLoss[] = [];
  for (const [i, item] of value.entries()) {
    const code = isRecord(item) ? own(item, 'code') : undefined;
    const count = isRecord(item) ? own(item, 'count') : undefined;
    if (!isRecord(item) || Object.keys(item).some((k) => k !== 'code' && k !== 'count')) {
      return { problem: `losses[${i}]: expected {code, count}` };
    }
    if (typeof code !== 'string' || !LOSS_CODE.test(code)) {
      return { problem: `losses[${i}].code: a lowercase slug such as element-dropped` };
    }
    if (
      typeof count !== 'number' ||
      !Number.isInteger(count) ||
      count < 0 ||
      count > MAX_LOSS_COUNT
    ) {
      return { problem: `losses[${i}].count: a whole number from 0 to ${MAX_LOSS_COUNT}` };
    }
    if (seen.has(code)) return { problem: `losses[${i}].code: ${code} appears twice` };
    seen.add(code);
    if (count > 0) losses.push({ code, count });
  }
  losses.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return { losses };
}

/** Sums losses per code (capped at the manifest's largest count), sorted by code. */
export function sumLosses(...lists: readonly (readonly SpecLoss[])[]): SpecLoss[] {
  const sums = new Map<string, number>();
  for (const list of lists) {
    for (const l of list)
      sums.set(l.code, Math.min(MAX_LOSS_COUNT, (sums.get(l.code) ?? 0) + l.count));
  }
  return [...sums]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([code, count]) => ({ code, count }));
}

/**
 * The record in `value` (parsed JSON), checked in what `analyzr-spec`
 * relies on, or the problem: the format, the converter's id, hash and copy
 * agreeing, the derivation, and every spec with its file, hash and losses.
 */
export function readRunRecord(value: unknown): RunRecord | string {
  if (!isRecord(value)) return 'not a run record (expected a JSON object)';
  if (own(value, 'format') !== RUN_RECORD_FORMAT) {
    return `format: expected ${JSON.stringify(RUN_RECORD_FORMAT)}`;
  }
  const converter = own(value, 'converter');
  if (!isRecord(converter)) return 'converter: expected {id, sha256, file, workingCopy}';
  const sha256 = own(converter, 'sha256');
  if (typeof sha256 !== 'string' || !SHA256.test(sha256)) {
    return 'converter.sha256: expected 64 lowercase hex characters';
  }
  if (own(converter, 'id') !== converterId(sha256)) {
    return `converter.id: expected ${converterId(sha256)}, the first 12 hex characters of converter.sha256`;
  }
  if (own(converter, 'file') !== converterCopy(sha256)) {
    return `converter.file: expected ${converterCopy(sha256)}`;
  }
  const workingCopy = own(converter, 'workingCopy');
  const derived = own(value, 'derived');
  const kind = isRecord(derived) ? own(derived, 'kind') : undefined;
  const llmModel = isRecord(derived) ? own(derived, 'llmModel') : undefined;
  if (kind !== 'converted' && kind !== 'reconstructed') {
    return 'derived.kind: expected converted or reconstructed';
  }
  if (kind === 'converted' && llmModel !== null) return 'derived.llmModel: null for converted';
  if (
    kind === 'reconstructed' &&
    (typeof llmModel !== 'string' ||
      llmModel.trim() === '' ||
      llmModel.length > MAX_LLM_MODEL_LENGTH ||
      UNSTORABLE.test(llmModel))
  ) {
    return `derived.llmModel: the model the agent runs as, 1 to ${MAX_LLM_MODEL_LENGTH} characters without control characters`;
  }
  const systemVersion = own(value, 'systemVersion');
  if (
    systemVersion !== null &&
    (typeof systemVersion !== 'string' ||
      tidyDeclared(systemVersion, MAX_SYSTEM_VERSION_CHARS) !== systemVersion)
  ) {
    return `systemVersion: expected null or a tidy string of at most ${MAX_SYSTEM_VERSION_CHARS} characters, as analyzr-convert writes it`;
  }
  const specs = own(value, 'specs');
  if (!Array.isArray(specs)) return 'specs: expected a list';
  const recorded: RecordedSpec[] = [];
  const files = new Set<string>();
  for (const [i, s] of specs.entries()) {
    const file = isRecord(s) ? own(s, 'file') : undefined;
    const sha = isRecord(s) ? own(s, 'sha256') : undefined;
    if (!isRecord(s) || typeof file !== 'string' || file === '' || files.has(file)) {
      return `specs[${i}].file: expected a spec file of the folder, once`;
    }
    if (typeof sha !== 'string' || !SHA256.test(sha)) {
      return `specs[${i}].sha256: expected 64 lowercase hex characters`;
    }
    const losses = readLosses(own(s, 'losses'));
    if ('problem' in losses) return `specs[${i}].${losses.problem}`;
    const externalPath = own(s, 'externalPath');
    const externalId = own(s, 'externalId');
    const warnings = lineList(own(s, 'warnings'));
    files.add(file);
    recorded.push({
      file,
      sha256: sha,
      externalPath: typeof externalPath === 'string' ? externalPath : '',
      externalId: typeof externalId === 'string' ? externalId : null,
      losses: losses.losses,
      warnings,
      warningCount: Math.max(whole(own(s, 'warningCount')), warnings.length),
    });
  }
  const reads = own(value, 'reads');
  const pairs = (v: unknown): { path: string; reason: string }[] =>
    Array.isArray(v)
      ? v
          .filter(isRecord)
          .map((p) => ({ path: textOf(own(p, 'path')), reason: textOf(own(p, 'reason')) }))
      : [];
  return {
    format: RUN_RECORD_FORMAT,
    converter: {
      id: converterId(sha256),
      sha256,
      file: converterCopy(sha256),
      workingCopy: textOf(workingCopy),
    },
    derived: { kind, llmModel: kind === 'converted' ? null : (llmModel as string) },
    runner: textOf(own(value, 'runner')),
    export: textOf(own(value, 'export')),
    systemVersion,
    reads: isRecord(reads)
      ? {
          files: whole(own(reads, 'files')),
          of: whole(own(reads, 'of')),
          entries: whole(own(reads, 'entries')),
        }
      : { files: 0, of: 0, entries: 0 },
    specs: recorded,
    failed: Array.isArray(own(value, 'failed'))
      ? (own(value, 'failed') as unknown[]).filter(isRecord).map((f) => {
          const errors = lineList(own(f, 'errors'));
          return {
            model: whole(own(f, 'model')),
            externalPath:
              typeof own(f, 'externalPath') === 'string' ? textOf(own(f, 'externalPath')) : null,
            errors,
            errorCount: Math.max(whole(own(f, 'errorCount')), errors.length),
          };
        })
      : [],
    duplicates: Array.isArray(own(value, 'duplicates'))
      ? (own(value, 'duplicates') as unknown[])
          .filter(isRecord)
          .map((d) => ({ model: whole(own(d, 'model')), of: whole(own(d, 'of')) }))
      : [],
    skipped: pairs(own(value, 'skipped')),
    unread: pairs(own(value, 'unread')),
    zipRefused: pairs(own(value, 'zipRefused')),
    symlinksSkipped: whole(own(value, 'symlinksSkipped')),
    hiddenSkipped: whole(own(value, 'hiddenSkipped')),
  };
}

/** The sha256 of a regular file's bytes, read without following a link, at most `max` bytes. */
export async function hashRegularFile(
  absolute: string,
  max: number,
): Promise<{ sha256: string; bytes: Buffer } | { problem: string }> {
  const info = await lstat(absolute).catch(() => null);
  if (info === null) return { problem: 'missing' };
  if (info.isSymbolicLink()) return { problem: 'a symbolic link' };
  if (!info.isFile()) return { problem: 'not a regular file' };
  if (info.nlink > 1) return { problem: 'a file with more than one name (a hard link)' };
  if (info.size > max) return { problem: `larger than ${max} bytes` };
  let handle;
  try {
    handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return { problem: 'not readable as a regular file' };
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > max) return { problem: 'changed while it was read' };
    const bytes = Buffer.alloc(opened.size);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== bytes.length) return { problem: 'changed while it was read' };
    return { sha256: createHash('sha256').update(bytes).digest('hex'), bytes };
  } finally {
    await handle.close();
  }
}

/**
 * Why the record's converter does not check out in `workspace`, or `null`:
 * its write-once copy exists as a regular file (no link) whose full sha256
 * is the record's.
 */
export async function converterCopyProblem(
  workspace: string,
  record: RunRecord,
): Promise<string | null> {
  const copy = path.join(workspace, ...record.converter.file.split('/'));
  const hashed = await hashRegularFile(copy, MAX_CONVERTER_BYTES);
  if ('problem' in hashed) {
    return `${RUN_RECORD_FILE}: converter ${record.converter.id} not found in ${CONVERTERS_DIR}/ (${record.converter.file}: ${hashed.problem}); run analyzr-convert again`;
  }
  if (hashed.sha256 !== record.converter.sha256) {
    return `${RUN_RECORD_FILE}: converter ${record.converter.id} changed in ${CONVERTERS_DIR}/ (${record.converter.file} has other bytes than the run); run analyzr-convert again`;
  }
  return null;
}

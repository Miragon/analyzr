/**
 * Spec folders and the bundles made from them (M6 S3c §3.5, §3.6): every
 * `*.spec.yaml`, `*.spec.yml` or `*.spec.json` below a folder is read and
 * validated; its tool path and tool id plan its key as a BPMN export's file
 * would (`planKeys`), and each model is rendered at its pinned key's path
 * with the manifest `analyzr-import.json` next to it, so `analyzr import`
 * and „Hochladen“ take the keys the consultant confirmed.
 *
 * The derivation is the spec's own: a spec the agent wrote declares
 * `reconstructed` (with the model it runs as) and becomes
 * `{kind: reconstructed, converter: null, llmModel}`; `as-told` waits for
 * an interview source (S6). Converter output is read only together with the
 * run record of its converter, which this version does not read yet: a
 * folder holding `analyzr-specs.json` is refused.
 */
import { constants } from 'node:fs';
import { mkdir, open, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  coverageOf,
  formatJson,
  INVENTORY_FILE,
  MANIFEST_FILE,
  MANIFEST_FORMAT,
  normalizeExportedAt,
  type Coverage,
  type ImportManifest,
  type Inventory,
  type ManifestFile,
} from '../bundle.ts';
import { listExport } from '../files.ts';
import {
  planKeys,
  type ExportModel,
  type Keymap,
  type KeyPlan,
  type PlanOptions,
} from '../keymap.ts';

import { renderSpec, RenderError, type RenderSummary, type SpecLoss } from './render.ts';
import { cleanLine } from './text.ts';
import type { Spec, SpecOrigin } from './types.ts';
import { MAX_NOTE_LENGTH, validateSpec } from './validate.ts';
import { ANALYZR_SPEC_VERSION, SPEC_IMPORTER } from './version.ts';
import { MAX_SPEC_BYTES, parseSpecBytes, tooLargeProblem, type SpecProblem } from './yaml.ts';

/** The names of spec files in a folder. */
export const SPEC_FILE = /\.spec\.(?:ya?ml|json)$/i;

/** A converter run's record next to the specs it wrote (M6 S3c §4.3, read from the converter step on). */
export const RUN_RECORD_FILE = 'analyzr-specs.json';

/** One spec file as read. */
export interface SpecFile {
  /** Path below the spec folder (the file name for a single file). */
  file: string;
  absolute: string;
  /** The valid spec, or `null`. */
  spec: Spec | null;
  errors: SpecProblem[];
  warnings: SpecProblem[];
}

export interface ScannedSpecs {
  specs: SpecFile[];
  /** Files below the folder that are no spec files. */
  skipped: string[];
  hidden: number;
  symlinks: number;
  /** The folder holds a converter's run record. */
  runRecord: boolean;
}

/**
 * A spec file's bytes, never more than {@link MAX_SPEC_BYTES} + 1 of them: a
 * regular file only (a symbolic link, a pipe or a device is refused before
 * anything is read, and opening a pipe does not wait for a writer).
 */
async function readBounded(absolute: string, file: string): Promise<Uint8Array | SpecProblem> {
  let handle;
  try {
    handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ELOOP' || code === 'EMLINK') {
      return {
        path: '',
        code: 'not-a-file',
        message: 'a symbolic link: name the spec file itself',
      };
    }
    if (code === 'ENOENT') throw new Error(`${file} does not exist`, { cause: err });
    throw err;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) {
      return { path: '', code: 'not-a-file', message: 'not a regular file: a spec is a file' };
    }
    if (info.size > MAX_SPEC_BYTES) return tooLargeProblem(info.size);
    // to its end, even if it grew since: at most one byte more than a spec may have
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const chunk = new Uint8Array(Math.min(64 * 1024, MAX_SPEC_BYTES + 1 - length));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      length += bytesRead;
      if (length > MAX_SPEC_BYTES) break;
    }
    return Buffer.concat(chunks, length);
  } finally {
    await handle.close();
  }
}

/** Reads one spec file and validates it. */
export async function readSpecFile(
  absolute: string,
  file: string,
  origin: SpecOrigin,
): Promise<SpecFile> {
  const bytes = await readBounded(absolute, file);
  if (!(bytes instanceof Uint8Array)) {
    return { file, absolute, spec: null, errors: [bytes], warnings: [] };
  }
  const parsed = parseSpecBytes(bytes);
  if (parsed.errors.length > 0) {
    return { file, absolute, spec: null, errors: parsed.errors, warnings: [] };
  }
  const result = validateSpec(parsed.value, { origin });
  return { file, absolute, spec: result.spec, errors: result.errors, warnings: result.warnings };
}

/**
 * The spec files of a folder (or one spec file), sorted by path, validated
 * as written by the agent; two specs naming one tool path or one tool id
 * are errors of the later one (one spec per model).
 */
export async function scanSpecs(target: string): Promise<ScannedSpecs> {
  const listing = await listExport(target);
  const single = listing.files.length === 1 && listing.files[0]?.absolute === path.resolve(target);
  const specs: SpecFile[] = [];
  const skipped: string[] = [];
  let runRecord = false;
  for (const f of listing.files) {
    if (!single && !SPEC_FILE.test(f.path)) {
      if (f.path === RUN_RECORD_FILE) runRecord = true;
      skipped.push(f.path);
      continue;
    }
    specs.push(await readSpecFile(f.absolute, f.path, 'hand'));
  }
  const paths = new Map<string, string>();
  const ids = new Map<string, string>();
  for (const s of specs) {
    if (s.spec === null) continue;
    const { externalPath, externalId } = s.spec.source;
    const other = paths.get(externalPath);
    if (other !== undefined) {
      s.errors.push({
        path: 'source.externalPath',
        code: 'duplicate-model',
        message: `${JSON.stringify(externalPath)} is also the tool path of ${other}: write one spec per model`,
      });
      s.spec = null;
      continue;
    }
    paths.set(externalPath, s.file);
    if (externalId !== null) {
      const holder = ids.get(externalId);
      if (holder !== undefined) {
        s.errors.push({
          path: 'source.externalId',
          code: 'duplicate-model',
          message: `also ${holder}'s; an externalId identifies one model`,
        });
        s.spec = null;
        continue;
      }
      ids.set(externalId, s.file);
    }
  }
  return { specs, skipped, hidden: listing.hidden, symlinks: listing.symlinks, runRecord };
}

/** The models of valid specs as planning sees them: the tool path with `.bpmn` as their path. */
export function specModels(specs: readonly SpecFile[]): (ExportModel & { spec: SpecFile })[] {
  return specs.flatMap((s) =>
    s.spec === null
      ? []
      : [
          {
            path: `${s.spec.source.externalPath}.bpmn`,
            externalId: s.spec.source.externalId,
            externalPath: s.spec.source.externalPath,
            spec: s,
          },
        ],
  );
}

export type SpecBundleErrorCode =
  'no-specs' | 'invalid-specs' | 'run-record' | 'as-told' | 'keys-unconfirmed' | 'bundle-not-empty';

export class SpecBundleError extends Error {
  readonly code: SpecBundleErrorCode;

  constructor(code: SpecBundleErrorCode, message: string) {
    super(message);
    this.name = 'SpecBundleError';
    this.code = code;
  }
}

/** Refuses a folder whose specs cannot be planned or bundled. */
function assertPlannable(scanned: ScannedSpecs, target: string): void {
  if (scanned.runRecord) {
    throw new SpecBundleError(
      'run-record',
      `${RUN_RECORD_FILE}: specs a converter wrote are bundled with the converter's run record, which this analyzr-spec ${ANALYZR_SPEC_VERSION} does not read yet; move the specs you wrote into a folder of their own`,
    );
  }
  if (scanned.specs.length === 0) {
    throw new SpecBundleError('no-specs', `no spec file (*.spec.yaml) below ${target}`);
  }
  const invalid = scanned.specs.filter((s) => s.spec === null);
  if (invalid.length > 0) {
    throw new SpecBundleError(
      'invalid-specs',
      `${invalid.length} of ${scanned.specs.length} specs have errors (${invalid
        .slice(0, 3)
        .map((s) => `${s.file}: ${s.errors[0]?.path ?? ''}: ${s.errors[0]?.message ?? ''}`)
        .join('; ')}${invalid.length > 3 ? '; …' : ''}): run validate and fix every error`,
    );
  }
}

export interface SpecPlan {
  plan: KeyPlan;
  /** Spec file → planned tool path and key. */
  specs: { spec: string; path: string; key: string; status: string }[];
}

/**
 * What `plan --write` records as a spec folder's `lastExport` in the key map:
 * its path below the workspace (`specs/2026-10-14-images`), never equal to an
 * export folder's name, which has no `/` (`2026-10-14-signavio`).
 */
export function specFolderMark(workspace: string, specDir: string): string {
  const rel = path
    .relative(path.resolve(workspace), path.resolve(specDir))
    .split(path.sep)
    .join('/');
  return rel.includes('/') ? rel : `./${rel}`;
}

/**
 * Plans the keys of a spec folder's models against the key map, as
 * `normalize-bpmn plan` does for a BPMN export. A spec the agent wrote is
 * flagged `replaces-known-model` (a stop in the consultant's key
 * confirmation) when its bundle could replace a model that did not come from
 * a picture:
 *
 * - it takes a key the key map holds for a model with a tool id (a spec the
 *   agent writes never has one, so this is a tool's model);
 * - it takes a key the key map holds without a tool id, which a picture's
 *   key and an export's alike can be, unless the system's last written plan
 *   came from this same spec folder (`folder`, {@link specFolderMark}): then
 *   the consultant confirmed these keys with that plan;
 * - it takes a new key analyzr already has (`exists-in-analyzr`).
 */
export function planSpecs(
  keymap: Keymap,
  scanned: ScannedSpecs,
  options: PlanOptions,
  folder?: string,
): SpecPlan {
  const models = specModels(scanned.specs);
  const plan = planKeys(keymap, models, options);
  const stored = options.reset === true ? undefined : keymap.systems[options.system];
  const confirmedHere = folder !== undefined && stored?.lastExport === folder;
  const byPath = new Map(models.map((m) => [m.path, m.spec]));
  const specs: SpecPlan['specs'] = [];
  for (const f of plan.files) {
    const spec = byPath.get(f.path);
    if (spec === undefined) continue;
    if (spec.spec?.derived != null) {
      const known = f.status !== 'new' && (f.externalId !== null || !confirmedHere);
      if (known || f.flags.includes('exists-in-analyzr')) f.flags.push('replaces-known-model');
    }
    specs.push({ spec: spec.file, path: f.path, key: f.key, status: f.status });
  }
  plan.counts.flagged = plan.files.filter((f) => f.flags.length > 0).length;
  return { plan, specs };
}

/** Plans a spec folder (see {@link planSpecs}); refuses a folder with invalid specs. */
export async function planSpecFolder(
  keymap: Keymap,
  target: string,
  options: PlanOptions,
  folder?: string,
): Promise<SpecPlan & { scanned: ScannedSpecs }> {
  const scanned = await scanSpecs(target);
  assertPlannable(scanned, target);
  return { ...planSpecs(keymap, scanned, options, folder), scanned };
}

export interface SpecBundleOptions {
  specDir: string;
  outDir: string;
  system: string;
  keymap: Keymap;
  /** When the customer exported or drew it (ISO 8601 date or date-time), or `null`. */
  exportedAt?: string | null;
  inventory?: Inventory | null;
}

export interface SpecBundledFile {
  /** The spec file below the spec folder. */
  spec: string;
  /** Path below the bundle. */
  path: string;
  key: string;
  externalId: string | null;
  externalPath: string;
  kind: 'reconstructed' | 'converted';
  converter: string | null;
  llmModel: string | null;
  losses: SpecLoss[];
  /** Calls drawn as collapsed subprocesses, for the report's „Verknüpfen mit …“. */
  calls: RenderSummary['calls'];
  /** The notes of the spec and its nodes, for the report. */
  notes: { node: string | null; text: string }[];
  textTruncated: RenderSummary['textTruncated'];
  processes: RenderSummary['processes'];
  messages: string[];
  signals: string[];
  blackBoxParticipants: RenderSummary['blackBoxParticipants'];
  nodes: RenderSummary['nodes'];
  modelName: string | null;
  layout: RenderSummary['layout'];
  sha256: string;
}

export interface SpecBundleResult {
  bundle: string;
  manifest: ImportManifest;
  files: SpecBundledFile[];
  /** Specs the renderer refused (not in the bundle). */
  failed: { spec: string; key: string; code: string; message: string; problems: string[] }[];
  /** Files below the spec folder that are no spec files. */
  skipped: string[];
  excluded: string[];
  absent: KeyPlan['absent'];
  coverage: Coverage | null;
}

async function assertEmpty(dir: string): Promise<void> {
  const entries = await readdir(dir).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return [];
    throw err;
  });
  if (entries.length > 0) {
    throw new SpecBundleError(
      'bundle-not-empty',
      `${dir} is not empty: write every bundle into a new folder (bundles/<YYYY-MM-DD>-<system>/)`,
    );
  }
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The notes of a spec for the report, each cut to {@link MAX_NOTE_LENGTH}. */
function notesOf(spec: Spec): SpecBundledFile['notes'] {
  const cut = (text: string): string => cleanLine(text, MAX_NOTE_LENGTH).text;
  return [
    ...spec.processes.flatMap((p) =>
      p.nodes.flatMap((n) => (n.note === null ? [] : [{ node: n.source, text: cut(n.note) }])),
    ),
    ...spec.notes.map((text) => ({ node: null, text: cut(text) })),
  ].filter((n) => n.text !== '');
}

/**
 * Writes the bundle of a spec folder whose keys the consultant confirmed
 * (every model `known` in the key map, after `analyzr-spec plan --write`).
 * A model the renderer refuses is listed in `failed`; the others are
 * written.
 *
 * @throws {SpecBundleError} for invalid specs, `as-told`, a run record, unconfirmed keys or a non-empty folder
 * @throws {BundleError} for a bad date
 */
export async function writeSpecBundle(options: SpecBundleOptions): Promise<SpecBundleResult> {
  const exportedAt =
    options.exportedAt === undefined || options.exportedAt === null
      ? null
      : normalizeExportedAt(options.exportedAt);
  const scanned = await scanSpecs(options.specDir);
  assertPlannable(scanned, options.specDir);
  const asTold = scanned.specs.filter((s) => s.spec?.derived?.kind === 'as-told');
  if (asTold.length > 0) {
    throw new SpecBundleError(
      'as-told',
      `${asTold.map((s) => s.file).join(', ')}: as-told needs an interview source (S6); analyzr-spec ${ANALYZR_SPEC_VERSION} bundles reconstructed specs`,
    );
  }
  const { plan, specs } = planSpecs(options.keymap, scanned, { system: options.system });
  const unconfirmed = plan.files.filter((f) => f.status !== 'known');
  if (unconfirmed.length > 0) {
    throw new SpecBundleError(
      'keys-unconfirmed',
      `${unconfirmed.length} models without a confirmed key (${unconfirmed
        .slice(0, 5)
        .map((f) => `${f.path}: ${f.status}`)
        .join(
          ', ',
        )}${unconfirmed.length > 5 ? ', …' : ''}): run plan, confirm it with the consultant, then plan --write`,
    );
  }
  await assertEmpty(options.outDir);

  const byFile = new Map(scanned.specs.map((s) => [s.file, s]));
  const files: SpecBundledFile[] = [];
  const manifestFiles: ManifestFile[] = [];
  const failed: SpecBundleResult['failed'] = [];
  const names: { key: string; externalId: string | null; names: string[] }[] = [];
  for (const planned of specs) {
    const spec = byFile.get(planned.spec)?.spec;
    if (spec === null || spec === undefined) continue;
    const derived = spec.derived;
    if (derived === null) continue; // a spec the agent wrote always declares it (validated)
    let rendered;
    try {
      rendered = await renderSpec(spec, { key: planned.key });
    } catch (err) {
      if (!(err instanceof RenderError)) throw err;
      failed.push({
        spec: planned.spec,
        key: planned.key,
        code: err.code,
        message: err.message,
        problems: err.problems,
      });
      continue;
    }
    const target = `${planned.key}.bpmn`;
    const absolute = path.join(options.outDir, ...target.split('/'));
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, rendered.bytes);
    const { source } = spec;
    files.push({
      spec: planned.spec,
      path: target,
      key: planned.key,
      externalId: source.externalId,
      externalPath: source.externalPath,
      kind: 'reconstructed',
      converter: null,
      llmModel: derived.llmModel,
      losses: rendered.losses,
      calls: rendered.summary.calls,
      notes: notesOf(spec),
      textTruncated: rendered.summary.textTruncated,
      processes: rendered.summary.processes,
      messages: rendered.summary.messages,
      signals: rendered.summary.signals,
      blackBoxParticipants: rendered.summary.blackBoxParticipants,
      nodes: rendered.summary.nodes,
      modelName: rendered.summary.modelName,
      layout: rendered.summary.layout,
      sha256: rendered.sha256,
    });
    manifestFiles.push({
      path: target,
      key: planned.key,
      ...(source.externalId === null ? {} : { externalId: source.externalId }),
      externalPath: source.externalPath,
      ...(source.url === null ? {} : { url: source.url }),
      derived: { kind: 'reconstructed', converter: null, llmModel: derived.llmModel, from: [] },
      ...(rendered.losses.length === 0 ? {} : { losses: rendered.losses }),
      sha256: rendered.sha256,
    });
    names.push({
      key: planned.key,
      externalId: source.externalId,
      names: [
        ...rendered.summary.processes.flatMap((p) => (p.name === null ? [] : [p.name])),
        source.externalPath.slice(source.externalPath.lastIndexOf('/') + 1),
      ],
    });
  }
  files.sort((a, b) => compare(a.path, b.path));
  manifestFiles.sort((a, b) => compare(a.path, b.path));

  const manifest: ImportManifest = {
    format: MANIFEST_FORMAT,
    source: {
      system: options.system,
      systemVersion: null,
      exportedAt,
      importer: { name: SPEC_IMPORTER, version: ANALYZR_SPEC_VERSION },
      ...(plan.scope === null ? {} : { scope: plan.scope }),
    },
    files: manifestFiles,
  };
  await mkdir(options.outDir, { recursive: true });
  let coverage: Coverage | null = null;
  if (options.inventory) {
    manifest.inventory = { path: INVENTORY_FILE };
    await writeFile(path.join(options.outDir, INVENTORY_FILE), formatJson(options.inventory));
    coverage = coverageOf(options.inventory, names);
  }
  await writeFile(path.join(options.outDir, MANIFEST_FILE), formatJson(manifest));
  return {
    bundle: options.outDir,
    manifest,
    files,
    failed,
    skipped: scanned.skipped,
    excluded: plan.excluded,
    absent: plan.absent,
    coverage,
  };
}

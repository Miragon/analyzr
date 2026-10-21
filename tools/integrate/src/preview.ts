/**
 * The preview of an import bundle (M6 S2b follow-up step 4), exactly as
 * `analyzr import <bundle> -p <project> --dry-run` sends it
 * (`apps/cli/src/commands/import.ts`, `files.ts`): every file below the
 * bundle the shared file rule picks up (`isImportPath`; hidden files and
 * folders, `node_modules` and symbolic links left out) in `comparePaths`
 * order, each under the key `analyzr-import.json` pins (else its path's), a
 * key to the first `.bpmn…` file before a plain `.xml` (`modelKeyOwners`),
 * a file without a valid key, with another file's key or above 5 MB failed
 * locally and never sent, batches of at most 50 files and 25 MB, each sent
 * with the whole manifest to `POST …/imports?dryRun=true`, the batches'
 * impacts merged with the zod-free merge the CLI and the web share. The
 * result is what `analyzr import --dry-run --json` prints; {@link
 * compactPreview} is what the skill reads, with the agent work the import
 * sets off counted as the web's „Vorschau“ counts it.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { mergeImpacts, type MergeableImpact } from '@analyzr/contracts/impact-merge';
import {
  BPMN_FILE_SUFFIXES,
  bpmnSuffixOf,
  comparePaths,
  isImportPath,
  keyTakenBy,
  modelKeyFromPath,
  modelKeyOwners,
} from '@analyzr/contracts/paths';

import { dryRunImport, type Analyzr } from './analyzr.ts';
import { capped } from './compact.ts';

/** Most files of one import request (`MAX_IMPORT_FILES` of the contracts). */
export const MAX_IMPORT_FILES = 50;
/** Most bytes of one import request (`MAX_IMPORT_BYTES`). */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
/** Most bytes of one model (`MAX_MODEL_BYTES`). */
export const MAX_MODEL_BYTES = 5 * 1024 * 1024;
/** The manifest's file name and format (`IMPORT_MANIFEST_FILE`, `IMPORT_MANIFEST_FORMAT`). */
export const IMPORT_MANIFEST_FILE = 'analyzr-import.json';
export const IMPORT_MANIFEST_FORMAT = 'analyzr-import/1';

/** Directories never descended into (besides hidden ones), as the CLI. */
const SKIPPED_DIRS = new Set(['node_modules', '.git']);

export interface BundleFile {
  /** Path below the bundle with `/` separators: the multipart file name. */
  path: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/** A problem as the server writes it (RFC 9457 with `code`). */
export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  [extra: string]: unknown;
}

/** A file's outcome as `POST …/imports` answers it (the fields the preview reads). */
export interface FileOutcome {
  path: string;
  modelKey: string | null;
  outcome: 'created' | 'revised' | 'unchanged' | 'failed';
  problem?: Problem;
  warnings?: { code: string; message: string; elementId?: string }[];
  warningCount?: number;
  importWarnings?: { code: string; message: string; otherKeys?: string[]; previous?: unknown }[];
  amendments?: { conflicts: { count: number } };
  /** The trust class, present only when `derived` (M6 S2c): a file without it counts as modelled. */
  trust?: { class: string; reasons?: string[] };
  /**
   * An unchanged file whose declared identity (system, tool id, tool folder,
   * link) differs from the model's newest one (M6 S2b follow-up step 5): the
   * import records it.
   */
  identityUpdated?: true;
  [extra: string]: unknown;
}

export type SkippedFile =
  { path: string; reason: 'not-bpmn' } | { path: string; reason: 'key-taken'; takenBy: string };

/** The manifest at the bundle root, as read (the server checks it in full). */
export interface BundleManifest {
  /** Sent with every batch, as compact JSON. */
  text: string;
  system: string;
  /** Its files' paths, in its order. */
  paths: string[];
  /** The key each listed file pins, by path (absent: the path decides). */
  keys: ReadonlyMap<string, string | undefined>;
  valueChain: string | null;
}

/** What the import read from the manifest, as `analyzr import` summarizes it (`ManifestSummary`). */
export interface ManifestSummary {
  system: string;
  listed: number;
  stored: number;
  kept: number;
  unlisted: string[];
  missing: string[];
  valueChain?: string;
}

/** A preview's result: what `analyzr import <bundle> --dry-run --json` prints. */
export interface PreviewSummary {
  project: string;
  files: FileOutcome[];
  counts: Record<FileOutcome['outcome'], number>;
  skipped?: SkippedFile[];
  manifest: ManifestSummary;
  impact: MergeableImpact;
  batches: number;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Reads `analyzr-import.json` at the bundle root: format, source system and
 * each file's path and pinned key; the rest is the server's to check.
 *
 * @throws {Error} without a manifest (the preview is for bundles), for no JSON or another format
 */
export async function readBundleManifest(dir: string): Promise<BundleManifest> {
  const file = path.join(dir, IMPORT_MANIFEST_FILE);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `no ${IMPORT_MANIFEST_FILE} in ${dir}: preview the bundle folder normalize-bpmn wrote`,
        { cause: err },
      );
    }
    throw err;
  }
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (err) {
    throw new Error(`${file} is no JSON`, { cause: err });
  }
  const source = isObject(value) ? value['source'] : undefined;
  const files = isObject(value) ? value['files'] : undefined;
  if (
    !isObject(value) ||
    value['format'] !== IMPORT_MANIFEST_FORMAT ||
    !isObject(source) ||
    typeof source['system'] !== 'string' ||
    !Array.isArray(files) ||
    !files.every(
      (f) =>
        isObject(f) &&
        typeof f['path'] === 'string' &&
        (f['key'] === undefined || typeof f['key'] === 'string'),
    )
  ) {
    throw new Error(`${file} is no ${IMPORT_MANIFEST_FORMAT} manifest`);
  }
  const entries = files as { path: string; key?: string }[];
  const chain = value['valueChain'];
  return {
    text: JSON.stringify(value),
    system: source['system'],
    paths: entries.map((f) => f.path),
    keys: new Map(entries.map((f) => [f.path, f.key])),
    valueChain: isObject(chain) && typeof chain['path'] === 'string' ? chain['path'] : null,
  };
}

/**
 * Every file below `dir` the shared file rule picks up, sorted by path, as
 * the CLI's `findBpmnFiles`: hidden files and folders, `node_modules` and
 * symbolic links left out.
 *
 * @throws {Error} if `dir` is not a directory
 */
export async function findBpmnFiles(dir: string): Promise<BundleFile[]> {
  const info = await stat(dir).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`${dir} is not a directory`);
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

/** The CLI's `batches`: requests of at most 50 files and 25 MB in order (models above 5 MB never get here). */
export function batches(files: readonly BundleFile[]): BundleFile[][] {
  const out: BundleFile[][] = [];
  let current: BundleFile[] = [];
  let bytes = 0;
  for (const f of files) {
    if (current.length === MAX_IMPORT_FILES || bytes + f.bytes.byteLength > MAX_IMPORT_BYTES) {
      out.push(current);
      current = [];
      bytes = 0;
    }
    current.push(f);
    bytes += f.bytes.byteLength;
  }
  if (current.length > 0) out.push(current);
  return out;
}

const PROBLEM_TITLES = {
  'validation-failed': 'Validation failed',
  'payload-too-large': 'Payload too large',
} as const;

/** A local failure in the server's words (`createProblem` of the contracts). */
function problem(code: keyof typeof PROBLEM_TITLES, detail: string): Problem {
  return {
    title: PROBLEM_TITLES[code],
    type: `urn:analyzr:problem:${code}`,
    status: code === 'validation-failed' ? 422 : 413,
    code,
    detail,
  };
}

export interface ImportPlan {
  batches: BundleFile[][];
  failed: FileOutcome[];
  skipped: SkippedFile[];
}

/**
 * The CLI's `planImport`: every key derived before sending; a file without
 * a valid key, with a key another file gets or above 5 MB fails locally, a
 * plain `.xml` whose key a `.bpmn…` file has is skipped (`key-taken`).
 */
export function planImport(
  files: readonly BundleFile[],
  keyOf: (path: string) => string | null,
): ImportPlan {
  const failed: FileOutcome[] = [];
  const skipped: SkippedFile[] = [];
  const send: BundleFile[] = [];
  const owners = modelKeyOwners(
    files.filter((f) => f.bytes.byteLength <= MAX_MODEL_BYTES).map((f) => f.path),
    keyOf,
  );
  const sent = new Set<string>();
  for (const f of files) {
    const key = keyOf(f.path);
    const fail = (code: keyof typeof PROBLEM_TITLES, detail: string) =>
      failed.push({
        path: f.path,
        modelKey: key,
        outcome: 'failed',
        problem: problem(code, detail),
      });
    const owner = key === null ? undefined : owners.get(key);
    const takenBy = keyTakenBy(f.path, owners, keyOf);
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
  return { batches: batches(send), failed, skipped };
}

/** A plain `.xml` the server refused as no BPMN: any XML of an export folder, listed as skipped (as the CLI). */
function isSkippedXml(f: FileOutcome): boolean {
  return (
    f.outcome === 'failed' &&
    f.problem?.code === 'bpmn-invalid' &&
    f.problem['reason'] === 'not-bpmn' &&
    bpmnSuffixOf(f.path) === '.xml'
  );
}

/** A preview's result and how many of its batches hold a new model (for the batch note). */
export interface Preview {
  summary: PreviewSummary;
  batchesWithNew: number;
}

/**
 * Previews the import of the bundle `dir` into `project` (which must exist)
 * batch by batch; nothing is imported.
 *
 * @throws {Error} without a manifest or BPMN files, or when analyzr refuses a batch
 */
export async function previewBundle(api: Analyzr, project: string, dir: string): Promise<Preview> {
  const manifest = await readBundleManifest(dir);
  const found = await findBpmnFiles(dir);
  if (found.length === 0) {
    throw new Error(
      `no BPMN files (${[...BPMN_FILE_SUFFIXES]
        .sort()
        .map((s) => `*${s}`)
        .join(', ')}) below ${dir}`,
    );
  }
  const plan = planImport(found, (p) => manifest.keys.get(p) ?? modelKeyFromPath(p));
  const files: FileOutcome[] = [...plan.failed];
  const skipped: SkippedFile[] = [...plan.skipped];
  const impacts: MergeableImpact[] = [];
  let batchesWithNew = 0;
  for (const group of plan.batches) {
    // As the CLI's dry run: the whole manifest each time, so every batch knows the absent keys
    // (none when it lists no file).
    const result = await dryRunImport<{ files: FileOutcome[]; impact?: MergeableImpact }>(
      api,
      project,
      group,
      manifest.paths.length > 0 ? manifest.text : null,
    );
    for (const f of result.files) {
      if (isSkippedXml(f)) skipped.push({ path: f.path, reason: 'not-bpmn' });
      else files.push(f);
    }
    if (result.files.some((f) => f.outcome === 'created')) batchesWithNew++;
    if (result.impact) impacts.push(result.impact);
  }
  const counts = { created: 0, revised: 0, unchanged: 0, failed: 0 };
  for (const f of files) counts[f.outcome]++;
  const picked = new Set(found.map((f) => f.path));
  const listedFiles = files.filter((f) => manifest.keys.has(f.path));
  return {
    summary: {
      project,
      files,
      counts,
      ...(skipped.length > 0 ? { skipped } : {}),
      manifest: {
        system: manifest.system,
        listed: found.filter((f) => manifest.keys.has(f.path)).length,
        stored: listedFiles.filter((f) => f.outcome === 'created' || f.outcome === 'revised')
          .length,
        kept: listedFiles.filter((f) => f.outcome === 'unchanged').length,
        unlisted: found.filter((f) => !manifest.keys.has(f.path)).map((f) => f.path),
        missing: manifest.paths.filter((p) => !picked.has(p)),
        ...(manifest.valueChain === null ? {} : { valueChain: manifest.valueChain }),
      },
      impact: mergeImpacts(impacts),
      batches: plan.batches.length,
    },
    batchesWithNew,
  };
}

/**
 * The processes the chain's placement task places for the import, as the
 * web's „Vorschau“ (`processesToPlace` in `apps/web/src/lib/agent-cost.ts`)
 * and the CLI's `placementWork` count them: with a task the import queues
 * every process due then, with one waiting or held by an agent the newly
 * due ones, never below `newlyDue`; 0 when the import does not trigger it
 * or nothing is due.
 */
export function processesToPlace(task: NonNullable<MergeableImpact['placementTask']>): number {
  if (task.outcome === 'queued') return Math.max(task.due, task.newlyDue);
  return task.outcome === 'open' || task.outcome === 'deferred' ? task.newlyDue : 0;
}

const LIST = 30;
const SHORT_LIST = 20;

/** `{code: count}` of a list of coded entries, in first-seen order. */
function byCode(items: readonly { code: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[i.code] = (out[i.code] ?? 0) + 1;
  return out;
}

/**
 * The preview for the skill's report, short also for hundreds of files: the
 * counts, the manifest, the files with a failure or a warning, what the
 * import would change (counts, the absent keys listed) and the agent work it
 * sets off, repeats or destroys (`agentWork`): the relations tasks queued
 * and cancelled, those an agent holds (their work is lost) with their keys,
 * the pairs to judge and those judged again, and the placement task with the
 * processes it places ({@link processesToPlace}). `batches` above 1: every
 * count of the agent work is approximate; `batchesWithNew` above 1: the
 * pairs between new models of different batches are not counted.
 * `counts.identityUpdated` counts the unchanged files whose new place in the
 * tool the import records (the web's „Ort im Quellsystem für 6 Modelle
 * aktualisiert“), `counts.modelled` the files analyzr would classify as
 * modelled (no `trust`: the server sets it only for derived ones), which a
 * bundle of rendered specs never holds (M6 S3c).
 */
export function compactPreview(
  preview: Preview,
  extra: { credential: 'owner-key' | 'agent-token'; details: string | null },
): Record<string, unknown> {
  const { summary } = preview;
  const impact = summary.impact;
  const noteworthy = summary.files
    .filter(
      (f) =>
        f.outcome === 'failed' ||
        (f.warningCount ?? f.warnings?.length ?? 0) > 0 ||
        (f.importWarnings ?? []).length > 0 ||
        (f.amendments?.conflicts.count ?? 0) > 0,
    )
    .map((f) => {
      const warnings = f.warningCount ?? f.warnings?.length ?? 0;
      return {
        path: f.path,
        key: f.modelKey,
        outcome: f.outcome,
        ...(f.problem
          ? {
              problem: `${f.problem.status} ${f.problem.code}: ${f.problem.detail ?? f.problem.title}`,
            }
          : {}),
        ...(warnings > 0 ? { warnings, warningCodes: byCode(f.warnings ?? []) } : {}),
        ...((f.importWarnings ?? []).length > 0
          ? {
              importWarnings: (f.importWarnings ?? []).map((w) => ({
                code: w.code,
                ...(w.otherKeys === undefined ? {} : { otherKeys: w.otherKeys }),
                ...(w.previous === undefined ? {} : { previous: w.previous }),
              })),
            }
          : {}),
        ...((f.amendments?.conflicts.count ?? 0) > 0
          ? { amendmentConflicts: f.amendments?.conflicts.count }
          : {}),
      };
    });
  const tasks = impact.relationsTasks;
  const task = impact.placementTask;
  const auto = impact.autoAcceptedCalls;
  return {
    project: summary.project,
    credential: extra.credential,
    batches: summary.batches,
    batchesWithNew: preview.batchesWithNew,
    counts: {
      ...summary.counts,
      skipped: summary.skipped?.length ?? 0,
      identityUpdated: summary.files.filter((f) => f.identityUpdated === true).length,
      modelled: summary.files.filter((f) => f.outcome !== 'failed' && f.trust === undefined).length,
    },
    manifest: {
      system: summary.manifest.system,
      listed: summary.manifest.listed,
      unlisted: capped(summary.manifest.unlisted, SHORT_LIST),
      missing: capped(summary.manifest.missing, SHORT_LIST),
      ...(summary.manifest.valueChain === undefined
        ? {}
        : { valueChain: summary.manifest.valueChain }),
    },
    files: capped(noteworthy, LIST),
    skipped: capped(summary.skipped ?? [], SHORT_LIST),
    importWarnings: byCode(summary.files.flatMap((f) => f.importWarnings ?? [])),
    impact: {
      factsChanged: impact.files.filter((f) => f.factsChanged).length,
      processesAdded: impact.files.reduce((n, f) => n + f.processesAdded.length, 0),
      processesRemoved: impact.files.reduce((n, f) => n + f.processesRemoved.length, 0),
      acceptedCalls: impact.acceptedCalls.count,
      callsProposed: {
        count: impact.callsProposed.count,
        wasAccepted: impact.callsProposed.wasAccepted,
        byReason: impact.callsProposed.byReason,
      },
      ...(auto
        ? {
            autoAcceptedCalls: {
              count: auto.count,
              ofProposed: auto.ofProposed,
              byRule: auto.byRule.map((r) => ({ ruleName: r.ruleName, count: r.count })),
            },
          }
        : {}),
      endpointsChanged: impact.endpointsChanged.count,
      ...(impact.placementsChanged ? { placementsChanged: impact.placementsChanged.count } : {}),
      proposalsAdded: impact.proposalsAdded.count,
      proposalsWithdrawn: impact.proposalsWithdrawn.count,
      findingsAdded: impact.findingsAdded.count,
      findingsResolved: impact.findingsResolved.count,
      absentKeys: {
        count: impact.absentKeys.count,
        items: impact.absentKeys.items.slice(0, SHORT_LIST),
      },
    },
    agentWork: {
      relations: {
        queued: tasks.queued.count,
        cancelled: tasks.cancelled.count,
        claimed: tasks.claimed,
        claimedKeys: tasks.cancelled.items
          .filter((t) => t.state === 'claimed')
          .map((t) => t.modelKey)
          .slice(0, SHORT_LIST),
        pairs: tasks.pairs,
        rejudged: tasks.rejudged.count,
      },
      placement: task
        ? {
            outcome: task.outcome,
            toPlace: processesToPlace(task),
            again: task.again,
            due: task.due,
          }
        : null,
    },
    details: extra.details,
  };
}

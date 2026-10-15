import path from 'node:path';

import {
  createProject,
  getProject,
  importModels,
  listAnalyses,
  type Project,
} from '@analyzr/client';
import {
  MAX_PAGE_LIMIT,
  bpmnSuffixOf,
  type ExtractWarning,
  type ImportFileOutcome,
} from '@analyzr/contracts';

import { call, callOrNull, createApi, type Api } from '../api.ts';
import { anyCredential, ownerCredential, type CredentialOptions } from '../credentials.ts';
import { CliError } from '../errors.ts';
import { BPMN_FILE_PATTERNS, findBpmnFiles, planImport, type SkippedFile } from '../files.ts';
import type { CliIo } from '../io.ts';

export interface ImportSummary {
  project: string;
  files: ImportFileOutcome[];
  counts: Record<ImportFileOutcome['outcome'], number>;
  /** Present only when a file was skipped (M6 S1); such files are not in `files` or `counts`. */
  skipped?: SkippedFile[];
}

/**
 * A plain `.xml` file (no `.bpmn…` suffix) the server refused as no BPMN
 * (422 `bpmn-invalid`, reason `not-bpmn`): any XML of an export folder, not a
 * failed model. Every other refusal (`doctype-forbidden`, …) stays `failed`.
 */
function isSkippedXml(f: ImportFileOutcome): boolean {
  return (
    f.outcome === 'failed' &&
    f.problem?.code === 'bpmn-invalid' &&
    f.problem['reason'] === 'not-bpmn' &&
    bpmnSuffixOf(f.path) === '.xml'
  );
}

/**
 * Uploads every BPMN file below `dir` to `POST /projects/{project}/imports`
 * in batches (≤ 50 files, ≤ 25 MB each). Each model key is derived before
 * sending, as the server derives it from the path below `dir`: a file
 * without a valid key, with a key another file gets (see `planImport`) or
 * above 5 MB is reported failed locally and never sent. Listed under
 * `skipped` instead: a plain `.xml` whose key a `.bpmn…` file has (never
 * sent), and a plain `.xml` the server finds to be no BPMN.
 */
export async function importDirectory(
  api: Api,
  project: string,
  dir: string,
): Promise<ImportSummary> {
  const found = await findBpmnFiles(dir);
  if (found.length === 0) throw new CliError(`no BPMN files (${BPMN_FILE_PATTERNS}) below ${dir}`);
  const plan = planImport(found);

  const files: ImportFileOutcome[] = [...plan.failed];
  const skipped: SkippedFile[] = [...plan.skipped];
  for (const group of plan.batches) {
    const result = await call(
      api,
      `import into ${project}`,
      importModels({
        client: api.client,
        path: { project },
        body: { files: group.map((f) => new File([f.bytes], f.path)) },
      }),
    );
    for (const f of result.files) {
      if (isSkippedXml(f)) skipped.push({ path: f.path, reason: 'not-bpmn' });
      else files.push(f);
    }
  }
  const counts = { created: 0, revised: 0, unchanged: 0, failed: 0 };
  for (const f of files) counts[f.outcome]++;
  return { project, files, counts, ...(skipped.length > 0 ? { skipped } : {}) };
}

/** A file's warnings as the result lists them, split for display. */
export interface WarningDisplay {
  /** The listed entries, without the extractor's `too-many-warnings` entry. */
  listed: readonly ExtractWarning[];
  /** The extractor's `too-many-warnings` entry ("N more warnings omitted"), which the server lists last. */
  omitted?: ExtractWarning;
  /** The warnings the extractor counted, without that entry. */
  count: number;
  /** Counted warnings the result does not list (`count` minus `listed`). */
  unlisted: number;
}

/** Splits a result's `warnings` and `warningCount` for display. */
export function warningDisplay(
  warnings: readonly ExtractWarning[],
  warningCount: number,
): WarningDisplay {
  const last = warnings.at(-1);
  const omitted = last?.code === 'too-many-warnings' ? last : undefined;
  const listed = omitted ? warnings.slice(0, -1) : warnings;
  const count = omitted ? warningCount - 1 : warningCount;
  return {
    listed,
    ...(omitted ? { omitted } : {}),
    count,
    unlisted: Math.max(0, count - listed.length),
  };
}

/**
 * `3 (invalid-id 2, parse-warning 1)`: the count and the listed entries by
 * code; beyond the 100 the extractor counts, its own entry follows:
 * `100 (parse-warning 19, 81 more, 150 more warnings omitted)`.
 */
export function formatWarningCounts(
  warnings: readonly ExtractWarning[],
  warningCount: number,
): string {
  const { listed, omitted, count, unlisted } = warningDisplay(warnings, warningCount);
  const byCode = new Map<string, number>();
  for (const w of listed) byCode.set(w.code, (byCode.get(w.code) ?? 0) + 1);
  const parts = [...byCode]
    .sort(([a, m], [b, n]) => n - m || (a < b ? -1 : a > b ? 1 : 0))
    .map(([code, n]) => `${code} ${n}`);
  if (unlisted > 0) parts.push(`${unlisted} more`);
  if (omitted) parts.push(omitted.message);
  return `${count} (${parts.join(', ')})`;
}

/** The reasons for skipping a file, in the order the summary names them. */
const SKIP_REASONS: Record<SkippedFile['reason'], string> = {
  'not-bpmn': 'not BPMN',
  'key-taken': 'same model key',
};

/**
 * `2 skipped (not BPMN)` when all files were skipped for one reason,
 * `2 skipped (1 not BPMN, 1 same model key)` otherwise; `null` when none was.
 */
export function skippedText(skipped: readonly SkippedFile[] = []): string | null {
  if (skipped.length === 0) return null;
  const parts = Object.entries(SKIP_REASONS)
    .map(([reason, text]) => ({ n: skipped.filter((s) => s.reason === reason).length, text }))
    .filter((p) => p.n > 0);
  const [only] = parts;
  const why =
    parts.length === 1 && only ? only.text : parts.map((p) => `${p.n} ${p.text}`).join(', ');
  return `${skipped.length} skipped (${why})`;
}

/** `, 2 skipped (not BPMN)` when files were skipped (see {@link skippedText}). */
export function skippedSuffix(summary: ImportSummary): string {
  const text = skippedText(summary.skipped);
  return text === null ? '' : `, ${text}`;
}

/** Why a file was skipped, for its line: `not BPMN`, `same model key as Prozess.bpmn`. */
function skippedWhy(s: SkippedFile): string {
  return s.reason === 'key-taken' ? `same model key as ${s.takenBy}` : SKIP_REASONS[s.reason];
}

/**
 * The import as text: one line per file (with the extractor's warnings by
 * code), the skipped files and a summary. `verbose` also lists every
 * warning entry the result carries (≤ 20 per file).
 */
export function formatImport(summary: ImportSummary, opts: { verbose?: boolean } = {}): string {
  const lines: string[] = [];
  for (const f of summary.files) {
    const name = f.modelKey ?? f.path;
    const why = f.problem
      ? `  (${f.problem.status} ${f.problem.code}: ${f.problem.detail ?? f.problem.title})`
      : '';
    const warnings = f.warnings ?? [];
    const count = f.warningCount ?? warnings.length;
    const warned = count > 0 ? `  warnings: ${formatWarningCounts(warnings, count)}` : '';
    lines.push(`  ${f.outcome.padEnd(9)} ${name}${why}${warned}`);
    if (opts.verbose && count > 0) {
      const shown = warningDisplay(warnings, count);
      for (const w of shown.listed) {
        lines.push(`      ${w.code}${w.elementId ? ` ${w.elementId}` : ''}: ${w.message}`);
      }
      if (shown.unlisted > 0) lines.push(`      … ${shown.unlisted} more not listed`);
      if (shown.omitted) lines.push(`      ${shown.omitted.code}: ${shown.omitted.message}`);
    }
  }
  for (const s of summary.skipped ?? [])
    lines.push(`  ${'skipped'.padEnd(9)} ${s.path}  (${skippedWhy(s)})`);
  const c = summary.counts;
  lines.push(
    `${summary.project}: ${summary.files.length} files, ${c.created} created, ${c.revised} revised, ${c.unchanged} unchanged, ${c.failed} failed${skippedSuffix(summary)}`,
  );
  return `${lines.join('\n')}\n`;
}

/** What waits for an agent in a project: queued relations tasks, and whether the placement task is queued. */
export interface WaitingTasks {
  relations: number;
  placement: boolean;
}

/**
 * The queued tasks of a project (`GET …/analyses`, permission `read`, so any
 * credential works): every page of the relations tasks (200 each) and one
 * placement task. The project's state, not this import's effect.
 */
export async function waitingTasks(api: Api, project: string): Promise<WaitingTasks> {
  const what = `list the waiting tasks of ${project}`;
  let relations = 0;
  let cursor: string | undefined;
  do {
    const page = await call(
      api,
      what,
      listAnalyses({
        client: api.client,
        path: { project },
        query: {
          state: 'queued',
          kind: 'relations',
          limit: MAX_PAGE_LIMIT,
          ...(cursor === undefined ? {} : { cursor }),
        },
      }),
    );
    relations += page.items.length;
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  const placement = await call(
    api,
    what,
    listAnalyses({
      client: api.client,
      path: { project },
      query: { state: 'queued', kind: 'placement', limit: 1 },
    }),
  );
  return { relations, placement: placement.items.length > 0 };
}

/**
 * The next-step block after a text-mode import: the waiting tasks in the
 * spec's wording (`relations tasks` also for one), then the agent step only
 * when something waits, each slash command only for its kind.
 */
export function formatNextSteps(project: string, waiting: WaitingTasks): string {
  const lines = [
    `${project}: ${waiting.relations} relations tasks waiting, placement task waiting: ${waiting.placement ? 'yes' : 'no'}`,
  ];
  if (waiting.relations > 0 || waiting.placement) {
    lines.push('next: let an agent work them, e.g. in Claude Code with the plugin analyzr:');
    if (waiting.relations > 0) lines.push(`  /analyzr:relations ${project}`);
    if (waiting.placement) lines.push(`  /analyzr:placements ${project}`);
    lines.push(
      `  other clients: the start prompts in examples/agents; a token: analyzr token create -p ${project}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/** The project, created with `name` unless it exists (creating needs the owner). */
export async function ensureProject(
  api: Api,
  key: string,
  name: string,
): Promise<{ project: Project; created: boolean }> {
  const existing = await callOrNull(
    api,
    `look up project ${key}`,
    getProject({ client: api.client, path: { project: key } }),
  );
  if (existing) return { project: existing, created: false };
  const project = await call(
    api,
    `create project ${key}`,
    createProject({ client: api.client, body: { key, name } }),
  );
  return { project, created: true };
}

export interface ImportOptions extends CredentialOptions {
  url: string;
  project: string;
  create?: boolean;
  name?: string;
  verbose?: boolean;
  json?: boolean;
}

/**
 * `analyzr import <dir> --project <key> [--create [--name <name>]] [--verbose] [--json]`.
 * Text mode ends with the tasks waiting in the project and the next agent
 * step; `--json` prints the summary only. Warnings and skipped files never
 * change the exit code. Exit 1 if a file failed, or if every file was a plain
 * `.xml` that is no BPMN (nothing imported; as a folder without BPMN files).
 */
export async function importCommand(io: CliIo, dir: string, opts: ImportOptions): Promise<void> {
  const credential = opts.create ? await ownerCredential(io, opts) : await anyCredential(io, opts);
  const api = createApi(io, opts.url, credential);
  if (opts.create) {
    const { created } = await ensureProject(api, opts.project, opts.name ?? opts.project);
    if (created && !opts.json) io.stdout(`created project ${opts.project}\n`);
  }
  const summary = await importDirectory(api, opts.project, path.resolve(io.cwd, dir));
  // Every file picked up was a plain `.xml` that is no BPMN: nothing was imported. A file
  // skipped for its key never gets here alone: the `.bpmn…` file that has the key was sent.
  const nothing = summary.files.length === 0;
  if (opts.json) io.stdout(`${JSON.stringify(summary, null, 2)}\n`);
  else io.stdout(formatImport(summary, { verbose: opts.verbose === true }));
  if (!opts.json && !nothing) {
    try {
      io.stdout(formatNextSteps(opts.project, await waitingTasks(api, opts.project)));
    } catch (err) {
      // The import is done; the block is information only.
      io.stderr(
        `analyzr: cannot list the waiting tasks: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
  if (nothing) {
    throw new CliError(
      `no BPMN files below ${dir}: ${skippedText(summary.skipped) ?? '0 skipped'}`,
    );
  }
  if (summary.counts.failed > 0) {
    throw new CliError(`${summary.counts.failed} of ${summary.files.length} files failed`);
  }
}

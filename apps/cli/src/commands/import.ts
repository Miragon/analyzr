import path from 'node:path';

import {
  createProject,
  getProject,
  importModels,
  listAnalyses,
  listAutoAcceptRules,
  listRelations,
  type AutoAcceptRule,
  type Project,
  type Relation,
} from '@analyzr/client';
import {
  IMPORT_MANIFEST_FILE,
  MAX_AUTO_ACCEPT_NAME_CHARS,
  MAX_PAGE_LIMIT,
  OUTSIDE_STEP,
  bpmnSuffixOf,
  isBulkDerivedCall,
  modelKeyFromPath,
  reviewPath,
  tidyDeclared,
  TrustReason,
  type AutoAcceptDerivedKind,
  type ExtractWarning,
  type ImportFileOutcome,
  type ImportImpact,
  type ImportWarning,
} from '@analyzr/contracts';
import { mergeImpacts } from '@analyzr/contracts/impact-merge';

import { call, callOrNull, createApi, type Api } from '../api.ts';
import { anyCredential, ownerCredential, type CredentialOptions } from '../credentials.ts';
import { CliError } from '../errors.ts';
import {
  BPMN_FILE_PATTERNS,
  findBpmnFiles,
  planImport,
  type BpmnFile,
  type ImportPlan,
  type SkippedFile,
} from '../files.ts';
import type { CliIo } from '../io.ts';
import { manifestSubset, nestedManifests, readManifest, type LoadedManifest } from '../manifest.ts';

export interface ImportSummary {
  project: string;
  files: ImportFileOutcome[];
  counts: Record<ImportFileOutcome['outcome'], number>;
  /** Present only when a file was skipped (M6 S1); such files are not in `files` or `counts`. */
  skipped?: SkippedFile[];
  /** Present only when the import root holds `analyzr-import.json` (M6 S2a). */
  manifest?: ManifestSummary;
  /**
   * Only for `--dry-run` (M6 S2b): what the import would change, the batches'
   * impacts merged; nothing was imported.
   */
  impact?: ImportImpact;
  /** With `impact`: the requests it took (each previewed against the head). */
  batches?: number;
}

/** What the import read from the bundle's manifest (M6 S2a). */
export interface ManifestSummary {
  /** The source system it declares. */
  system: string;
  /** BPMN files picked up that the manifest lists (their keys pinned, their provenance sent). */
  listed: number;
  /** Listed files that became a new revision (`created`, `revised`): their provenance was stored. */
  stored: number;
  /**
   * Listed files that were `unchanged`: identical bytes keep the provenance
   * analyzr already has (M6 §3.3); `provenance-kept` says where it differs.
   */
  kept: number;
  /** BPMN files picked up that the manifest does not list: their keys come from their paths. */
  unlisted: string[];
  /** Files the manifest lists that are not below the import root. */
  missing: string[];
  /** The bundle's process map (path below the import root): never sent with the models. */
  valueChain?: string;
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

/** An import read and planned locally, before anything is sent (M6 S2a). */
export interface PreparedImport {
  /** Every BPMN file picked up below the import root. */
  found: BpmnFile[];
  /** `analyzr-import.json` at the import root, checked; `null` without one. */
  manifest: LoadedManifest | null;
  plan: ImportPlan;
}

/**
 * Reads and plans the import of `dir` without sending anything: the BPMN
 * files below it, `analyzr-import.json` at its root (checked), and the plan
 * with each file's key: the key the manifest pins (M6 S2a), else the path
 * below `dir` (see `planImport`). Runs before `--create` creates the
 * project, so a refusal leaves nothing behind.
 *
 * @throws {CliError} without BPMN files, for an invalid manifest, or when
 *   `dir` has no manifest while folders below it do (bundles in subfolders:
 *   each key would start with the bundle folder's name)
 */
export async function prepareImport(dir: string): Promise<PreparedImport> {
  const found = await findBpmnFiles(dir);
  if (found.length === 0) throw new CliError(`no BPMN files (${BPMN_FILE_PATTERNS}) below ${dir}`);
  const manifest = await readManifest(dir);
  if (manifest === null) {
    const nested = await nestedManifests(dir);
    const [first] = nested;
    if (first !== undefined) {
      const more =
        nested.length > 1
          ? ` and ${nested.length - 1} more ${nested.length === 2 ? 'folder' : 'folders'}`
          : '';
      throw new CliError(
        `found ${IMPORT_MANIFEST_FILE} in ${first}/${more}: import ${nested.length > 1 ? 'each bundle folder by itself' : 'that folder'} (otherwise every key would start with the folder name); nothing imported`,
      );
    }
  }
  const plan = planImport(
    found,
    manifest === null
      ? modelKeyFromPath
      : (p) => manifest.byPath.get(p)?.key ?? modelKeyFromPath(p),
  );
  return { found, manifest, plan };
}

/**
 * Uploads a prepared import to `POST /projects/{project}/imports` in batches
 * (≤ 50 files, ≤ 25 MB each). A file without a valid key, with a key another
 * file gets (see `planImport`) or above 5 MB is reported failed locally and
 * never sent. Listed under `skipped` instead: a plain `.xml` whose key a
 * `.bpmn…` file has (never sent), and a plain `.xml` the server finds to be
 * no BPMN. With a manifest each batch sends the manifest's subset for its
 * files as the part `manifest`.
 */
export async function sendImport(
  api: Api,
  project: string,
  prepared: PreparedImport,
  options: { dryRun?: boolean } = {},
): Promise<ImportSummary> {
  const { found, manifest, plan } = prepared;
  const dryRun = options.dryRun === true;
  const files: ImportFileOutcome[] = [...plan.failed];
  const skipped: SkippedFile[] = [...plan.skipped];
  const impacts: ImportImpact[] = [];
  for (const group of plan.batches) {
    // A dry run sends the whole manifest, so every batch knows which keys the bundle names
    // (its absent keys); the server reads only the entries of the batch's files.
    const subset =
      manifest === null
        ? null
        : dryRun
          ? manifest.manifest
          : manifestSubset(
              manifest,
              group.map((f) => f.path),
            );
    const result = await call(
      api,
      `${dryRun ? 'preview the import' : 'import'} into ${project}`,
      importModels({
        client: api.client,
        path: { project },
        ...(dryRun ? { query: { dryRun: 'true' as const } } : {}),
        body: {
          files: group.map((f) => new File([f.bytes], f.path)),
          ...(subset !== null && subset.files.length > 0
            ? { manifest: JSON.stringify(subset) }
            : {}),
        },
      }),
    );
    // The generated client types typed ids (`mam_…` of `amendments`) as plain strings.
    for (const f of result.files as ImportFileOutcome[]) {
      if (isSkippedXml(f)) skipped.push({ path: f.path, reason: 'not-bpmn' });
      else files.push(f);
    }
    if (result.impact) impacts.push(result.impact as ImportImpact);
  }
  const counts = { created: 0, revised: 0, unchanged: 0, failed: 0 };
  for (const f of files) counts[f.outcome]++;
  let manifestSummary: ManifestSummary | undefined;
  if (manifest !== null) {
    const picked = new Set(found.map((f) => f.path));
    const listedFiles = files.filter((f) => manifest.byPath.has(f.path));
    manifestSummary = {
      system: manifest.manifest.source.system,
      listed: found.filter((f) => manifest.byPath.has(f.path)).length,
      stored: listedFiles.filter((f) => f.outcome === 'created' || f.outcome === 'revised').length,
      kept: listedFiles.filter((f) => f.outcome === 'unchanged').length,
      unlisted: found.filter((f) => !manifest.byPath.has(f.path)).map((f) => f.path),
      missing: manifest.manifest.files.filter((f) => !picked.has(f.path)).map((f) => f.path),
      ...(manifest.manifest.valueChain ? { valueChain: manifest.manifest.valueChain.path } : {}),
    };
  }
  const impact = dryRun ? mergeImpacts(impacts) : null;
  return {
    project,
    files,
    counts,
    ...(skipped.length > 0 ? { skipped } : {}),
    ...(manifestSummary ? { manifest: manifestSummary } : {}),
    ...(impact ? { impact, batches: plan.batches.length } : {}),
  };
}

// The batches' impacts as one (M6 §3.5): the zod-free merge the web's „Vorschau“ shares.
export { mergeImpacts };

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** `a#Call_X → b#Process_Y` for a relation's line. */
const arrow = (r: { from: string; to: string }) => `${r.from} → ${r.to}`;

/** The trust rule's reasons (M6 S2c) in a line's words. */
export const TRUST_REASONS: Readonly<Record<TrustReason, string>> = {
  'no-engine': 'no engine',
  'agent-upload': 'agent token',
  converted: 'converted',
  reconstructed: 'reconstructed',
  'as-told': 'as told',
};

/**
 * `propose instead of accept (trust rule): 12 (no engine 10, agent token 2),
 * 3 of them accepted until now`: the unique calls of derived models a dry run
 * names (M6 S2c), by the server's totals over all of them (each call under
 * its caller's first reason, so the parts add up); `null` for none.
 */
function trustLine(impact: ImportImpact): string | null {
  const { count, wasAccepted, byReason } = impact.callsProposed;
  if (count === 0) return null;
  const reasons = byReason.map((r) => `${TRUST_REASONS[r.reason]} ${r.count}`);
  return (
    `propose instead of accept (trust rule): ${count}` +
    (reasons.length > 0 ? ` (${reasons.join(', ')})` : '') +
    (wasAccepted > 0 ? `, ${wasAccepted} of them accepted until now` : '')
  );
}

/** Examples a dry run's line names, the rest counted. */
const SAMPLED = 5;

/** `a, b, c, … 2 more` of a capped list: at most {@link SAMPLED} items, then the rest counted. */
function named(items: readonly string[], count: number, separator = ', '): string {
  const shown = items.slice(0, SAMPLED);
  return `${shown.join(separator)}${count > shown.length ? `${separator}… ${count - shown.length} more` : ''}`;
}

/**
 * The placement task's part of the agent work (S2b follow-up, a project with
 * a live chain): what the write's `queuePlacementTask` does and the
 * processes it places for the write, as the web's „Vorschau“ counts them
 * (`processesToPlace` in `apps/web/src/lib/agent-cost.ts`): a task the write
 * queues places every process due, also those due before (a deletion
 * queues no task); one waiting or held places the newly due ones (`again`,
 * those an agent had placed), and the line adds all that are due then;
 * `null` when the write does not trigger it (no file changes facts) or the
 * project has no chain.
 */
function placementWork(task: ImportImpact['placementTask'], about: string): string | null {
  if (!task || task.outcome === 'not-triggered') return null;
  if (task.outcome === 'nothing-due') return 'placement task: nothing due';
  // The claim an agent holds is never cancelled: its submission queues the follow-up for these.
  const where = task.outcome === 'deferred' ? ' in its follow-up' : '';
  // Never below `newlyDue`: across batches `due` is the largest batch's, `newlyDue` their sum.
  const place = task.outcome === 'queued' ? Math.max(task.due, task.newlyDue) : task.newlyDue;
  const text =
    place > 0
      ? `${about}${plural(place, 'process', 'processes')} to place${where}${task.again > 0 ? ` (${task.again} again)` : ''}`
      : `nothing new to place${where}`;
  const all =
    task.outcome !== 'queued' && task.due > place ? `, ${about}${task.due} due in all` : '';
  const what =
    task.outcome === 'deferred'
      ? 'an agent holds it;'
      : task.outcome === 'open'
        ? 'already queued,'
        : 'queued,';
  return `placement task: ${what} ${text}${all}`;
}

/**
 * `agent work: queue 3 relations tasks, 214 pairs to judge (56 judged
 * again); placement task: queued, 7 processes to place (5 again)` (S2b
 * follow-up): the relations tasks the write queues and the pairs agents then
 * judge (an upper bound while other models' tasks wait; the pairs judged
 * again are the reliable part), and the placement task; `about` for counts
 * that several batches add up, each against the head (a pair between two
 * models of the head in two batches counts in both, one between new models
 * of two batches in neither: the batch line says so).
 */
function agentWorkLine(impact: ImportImpact, batches: number): string {
  const about = batches > 1 ? 'about ' : '';
  const { queued, pairs, rejudged } = impact.relationsTasks;
  const relations =
    queued.count > 0
      ? `queue ${plural(queued.count, 'relations task')}, ${pairs > 0 ? about : ''}${plural(pairs, 'pair')} to judge${rejudged.count > 0 ? ` (${rejudged.count} judged again)` : ''}`
      : null;
  const placement = placementWork(impact.placementTask, about);
  if (relations === null && placement === null) return '  agent work: none';
  return `  agent work: ${[relations ?? 'no relations task', placement].filter((p) => p !== null).join('; ')}`;
}

/**
 * `cancel relations tasks: 2 (vertrieb/auftrag claimed by agent:claude, 34
 * pairs assigned; finanzen/rechnung queued)` and, while agents hold some of
 * them, the warning in `costLines`' words (`models amend`): their work is
 * lost. Nothing when the write cancels no task.
 */
function cancelLines(tasks: ImportImpact['relationsTasks']): string[] {
  const { cancelled, claimed } = tasks;
  if (cancelled.count === 0) return [];
  const items = cancelled.items.map((t) =>
    t.state === 'claimed'
      ? `${t.modelKey} claimed by ${t.claimedBy ?? 'an agent'}${t.assigned === null ? '' : `, ${plural(t.assigned, 'pair')} assigned`}`
      : `${t.modelKey} queued`,
  );
  const lines = [
    `  cancel relations tasks: ${cancelled.count} (${named(items, cancelled.count, '; ')})`,
  ];
  const keys = cancelled.items.filter((t) => t.state === 'claimed').map((t) => t.modelKey);
  if (claimed === 1) {
    lines.push(
      `  warning: an agent is working on the relations task of ${keys[0] ?? 'one of these models'} right now; the import cancels the task and the agent's work is lost`,
    );
  } else if (claimed > 1) {
    lines.push(
      `  warning: agents are working on the relations tasks of ${claimed} of these models right now (${named(keys, claimed)}); the import cancels them and their work is lost`,
    );
  }
  return lines;
}

/**
 * A dry run's impact as text (M6 §3.5): the files whose model changes, the
 * agent work the import sets off (S2b follow-up: the relations tasks queued
 * and the pairs to judge, the placement task) and the tasks it cancels,
 * with a warning for those an agent holds, the rule-tier calls accepted, the
 * unique calls of derived models only proposed (M6 S2c, the trust rule; when
 * there are any), the rule proposals added and the stances withdrawn,
 * accepted relations whose end changes or goes missing, accepted placements
 * whose process does (with a live chain), the findings, and the keys the
 * bundle does not name (nothing is deleted); up to five examples each. A
 * preview of several batches says that a call into a later batch shows as
 * unresolved and the pairs between new models of different batches are not
 * counted, and its counts of agent work are "about".
 */
export function formatImpact(impact: ImportImpact, project: string, batches = 1): string {
  const sample = (items: readonly string[], count: number) =>
    items.length === 0 ? '' : `: ${named(items, count)}`;
  const added = impact.files.reduce((n, f) => n + f.processesAdded.length, 0);
  const removed = impact.files.reduce((n, f) => n + f.processesRemoved.length, 0);
  const lines = [`${project}: dry run, nothing imported; the import would`];
  const changed = impact.files.filter((f) => f.factsChanged).length;
  lines.push(
    `  change the facts of ${plural(changed, 'model')} (${added} processes added, ${removed} removed)`,
  );
  lines.push(agentWorkLine(impact, batches), ...cancelLines(impact.relationsTasks));
  const list = (label: string, l: { count: number; items: { from: string; to: string }[] }) =>
    lines.push(`  ${label} ${l.count}${sample(l.items.map(arrow), l.count)}`);
  list('accept rule-tier calls:', impact.acceptedCalls);
  const trust = trustLine(impact);
  if (trust !== null) {
    lines.push(
      `  ${trust}${sample(impact.callsProposed.items.map(arrow), impact.callsProposed.count)}`,
    );
  }
  // An owner's dry run (M6 S2c-3): what their rules for derived calls accept in the same write.
  const auto = impact.autoAcceptedCalls;
  if (auto && auto.count > 0) {
    const rules = auto.byRule.map((r) => `${JSON.stringify(r.ruleName)} ${r.count}`).join(', ');
    lines.push(
      `  accept by your rules for derived calls: ${auto.count} (${rules})${sample(auto.items.map(arrow), auto.count)}`,
    );
  }
  list('add rule proposals:', impact.proposalsAdded);
  list('withdraw rule stances:', impact.proposalsWithdrawn);
  lines.push(
    `  change or lose an end of accepted relations: ${impact.endpointsChanged.count}${sample(
      impact.endpointsChanged.items.map((r) => `${arrow(r)} (${r.endpointState})`),
      impact.endpointsChanged.count,
    )}`,
  );
  const placements = impact.placementsChanged;
  if (placements && placements.count > 0) {
    lines.push(
      `  change or lose the process of accepted placements: ${placements.count}${sample(
        placements.items.map(
          (p) =>
            `${p.process} on ${p.step === OUTSIDE_STEP || p.stepName === null ? p.step : JSON.stringify(p.stepName)} (${p.endpointState})`,
        ),
        placements.count,
      )}`,
    );
  }
  lines.push(
    `  findings: ${impact.findingsAdded.count} added, ${impact.findingsResolved.count} resolved${sample(
      impact.findingsAdded.items.map((f) => `${f.kind} ${f.refs[0] ?? ''}`),
      impact.findingsAdded.count,
    )}`,
  );
  if (impact.absentKeys.count > 0) {
    lines.push(
      `  not in the bundle, kept in analyzr (nothing is deleted): ${plural(impact.absentKeys.count, 'key')}${sample(impact.absentKeys.items, impact.absentKeys.count)}`,
    );
  }
  if (batches > 1) {
    lines.push(
      `  previewed in ${batches} batches, each against the project's head: a call into a later batch shows as unresolved, and the pairs between new models of different batches are not counted`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Uploads every BPMN file below `dir` ({@link prepareImport}, then
 * {@link sendImport}).
 *
 * @throws {CliError} for an invalid manifest, before anything is sent
 */
export async function importDirectory(
  api: Api,
  project: string,
  dir: string,
): Promise<ImportSummary> {
  return sendImport(api, project, await prepareImport(dir));
}

/** The import warnings of a summary by code, most frequent first: `external-id-moved 2, …`. */
export function importWarningCounts(summary: ImportSummary): { total: number; text: string } {
  const byCode = new Map<ImportWarning['code'], number>();
  for (const f of summary.files) {
    for (const w of f.importWarnings ?? []) byCode.set(w.code, (byCode.get(w.code) ?? 0) + 1);
  }
  const total = [...byCode.values()].reduce((a, b) => a + b, 0);
  const text = [...byCode]
    .sort(([a, m], [b, n]) => n - m || (a < b ? -1 : a > b ? 1 : 0))
    .map(([code, n]) => `${code} ${n}`)
    .join(', ');
  return { total, text };
}

/**
 * `provenance stored for 6` or `provenance stored for 0; 6 unchanged keep
 * what analyzr had`: what became of the declared provenance (identical bytes
 * keep their first revision's, M6 §3.3).
 */
function provenanceText(m: ManifestSummary): string {
  const kept =
    m.kept > 0 ? `; ${m.kept} unchanged keep${m.kept === 1 ? 's' : ''} what analyzr had` : '';
  return `provenance stored for ${m.stored}${kept}`;
}

/** The lines about the manifest: what it declares, files it does not list, files it names that are missing. */
function manifestLines(m: ManifestSummary): string[] {
  const lines = [
    `manifest: ${IMPORT_MANIFEST_FILE} (${m.system}), ${m.listed} of ${m.listed + m.unlisted.length} files listed: keys pinned, ${provenanceText(m)}`,
  ];
  const sample = (paths: readonly string[]) =>
    `${paths.slice(0, 5).join(', ')}${paths.length > 5 ? `, … ${paths.length - 5} more` : ''}`;
  if (m.unlisted.length > 0) {
    lines.push(
      `manifest: ${m.unlisted.length === 1 ? '1 file is' : `${m.unlisted.length} files are`} not listed, keys from the path, no provenance: ${sample(m.unlisted)}`,
    );
  }
  if (m.missing.length > 0) {
    lines.push(
      `manifest: lists ${m.missing.length === 1 ? '1 file' : `${m.missing.length} files`} not below the folder: ${sample(m.missing)}`,
    );
  }
  return lines;
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

/**
 * What became of a model's live amendments at the upload (M6 S5c-2, §4.8
 * c): `2 applied, 1 already in the source, 1 conflict`, the groups that are
 * not empty; `null` for a model without live amendments.
 */
export function amendmentsText(amendments: ImportFileOutcome['amendments']): string | null {
  if (amendments === undefined) return null;
  const { applied, inSource, conflicts } = amendments;
  const parts = [
    applied.count > 0 ? `${applied.count} applied` : null,
    inSource.count > 0 ? `${inSource.count} already in the source` : null,
    conflicts.count > 0
      ? `${conflicts.count} ${conflicts.count === 1 ? 'conflict' : 'conflicts'}`
      : null,
  ].filter((p) => p !== null);
  return parts.length === 0 ? null : parts.join(', ');
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
 * code and, for a model with live amendments, what became of them), the
 * skipped files and a summary, then the amendments in conflict. `verbose`
 * also lists every warning entry the result carries (≤ 20 per file).
 */
export function formatImport(summary: ImportSummary, opts: { verbose?: boolean } = {}): string {
  const lines: string[] = summary.manifest ? manifestLines(summary.manifest) : [];
  for (const f of summary.files) {
    const name = f.modelKey ?? f.path;
    const why = f.problem
      ? `  (${f.problem.status} ${f.problem.code}: ${f.problem.detail ?? f.problem.title})`
      : '';
    const warnings = f.warnings ?? [];
    const count = f.warningCount ?? warnings.length;
    const warned = count > 0 ? `  warnings: ${formatWarningCounts(warnings, count)}` : '';
    const amended = amendmentsText(f.amendments);
    lines.push(
      `  ${f.outcome.padEnd(9)} ${name}${why}${warned}${amended === null ? '' : `  amendments: ${amended}`}`,
    );
    // Against the manifest or the landscape (M6 S2a): always listed, the file was imported.
    for (const w of f.importWarnings ?? []) lines.push(`      ${w.code}: ${w.message}`);
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
  const imported = importWarningCounts(summary);
  if (imported.total > 0) {
    lines.push(
      `${summary.project}: ${imported.total === 1 ? '1 import warning' : `${imported.total} import warnings`} (${imported.text}); the files were imported`,
    );
  }
  // Amendments the new bytes no longer fit stay live and become open questions.
  const conflicts = summary.files.reduce((n, f) => n + (f.amendments?.conflicts.count ?? 0), 0);
  if (conflicts > 0) {
    lines.push(
      `${summary.project}: ${conflicts === 1 ? '1 amendment no longer applies' : `${conflicts} amendments no longer apply`}; see analyzr questions -p ${summary.project} --kind amendment-conflict`,
    );
  }
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
 * The next step for the identity warnings of an import (M6 §3.4), one line
 * each, or none: after `external-id-moved` the same tool model may be in the
 * landscape twice; after `external-id-changed` a key may hold models of two
 * systems.
 */
export function identitySteps(summary: ImportSummary): string[] {
  const p = summary.project;
  const lines: string[] = [];
  const moved = summary.files.filter((f) =>
    (f.importWarnings ?? []).some((w) => w.code === 'external-id-moved'),
  );
  const [first] = [...moved.filter((f) => f.outcome === 'created'), ...moved];
  if (first) {
    lines.push(
      `next: same model twice? delete the extra key (analyzr models delete -p ${p} ${first.modelKey ?? '<key>'}) and re-import with the key pinned (keymap.json; analyzr models external-ids -p ${p} lists analyzr's keys)`,
    );
  }
  const changed = summary.files
    .flatMap((f) => f.importWarnings ?? [])
    .find((w) => w.code === 'external-id-changed');
  if (changed?.previous && changed.system) {
    const { system, previous } = changed;
    lines.push(
      system === previous.system
        ? `next: different models? re-import the earlier ${system} export and pin this file to another key (keymap.json)`
        : `next: different models? re-import the ${previous.system} bundle and give the ${system} bundle a key prefix (${system}/…)`,
    );
  }
  return lines;
}

/** A file of the import whose model is derived (M6 S2c): its stored or kept trust class. */
const isDerivedFile = (f: ImportFileOutcome): boolean => f.trust?.class === 'derived';

/**
 * The open unique calls from derived models a bulk accept takes as they
 * stand (M6 S2c, `GET …/relations`, permission `read`, so any credential
 * works): every page of the key tier's open call proposals, filtered with
 * `isBulkDerivedCall` as the web counts the selection `?bulk=calls` opens
 * (no agent's question, no no-link). The project's state, not this
 * import's effect.
 */
export async function waitingCalls(api: Api, project: string): Promise<Relation[]> {
  const what = `list the open call proposals of ${project}`;
  const out: Relation[] = [];
  let cursor: string | undefined;
  do {
    const page = await call(
      api,
      what,
      listRelations({
        client: api.client,
        path: { project },
        query: {
          type: 'call',
          status: 'proposed',
          tier: 'key',
          limit: MAX_PAGE_LIMIT,
          ...(cursor === undefined ? {} : { cursor }),
        },
      }),
    );
    out.push(...page.items.filter(isBulkDerivedCall));
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return out;
}

/** A declared source a rule for derived calls can name (M6 S2c-3). */
export interface DerivedSource {
  derivedKind: AutoAcceptDerivedKind;
  /** For `converted`: the converter as analyzr stores it (tidied). */
  converter: string | null;
}

/**
 * The source most of the waiting calls' callers declare that a rule for
 * derived calls can name (M6 S2c-3), counted per waiting call
 * ({@link waitingCalls}) whose caller is a derived file of this import, by
 * the bundle's manifest: `export`, `converted` with its converter, or
 * `none` (no kind declared). Files an agent token uploaded (no rule accepts
 * their calls), reconstructed and as-told files and a conversion without
 * converter count for nothing; ties go to the first call. `null` without
 * such a call.
 */
export function ruleSource(
  summary: Pick<ImportSummary, 'files'>,
  manifest: Pick<LoadedManifest, 'byPath'> | null,
  waiting: readonly Pick<Relation, 'from'>[],
): DerivedSource | null {
  const byKey = new Map<string, DerivedSource>();
  for (const f of summary.files) {
    if (f.modelKey === null) continue;
    if (f.trust?.class !== 'derived' || f.trust.reasons.includes('agent-upload')) continue;
    const declared = manifest?.byPath.get(f.path)?.derived;
    const kind = declared?.kind ?? 'none';
    const converter = kind === 'converted' ? tidyDeclared(declared?.converter) : null;
    if (kind === 'reconstructed' || kind === 'as-told') continue;
    if (kind === 'converted' && converter === null) continue;
    byKey.set(f.modelKey, { derivedKind: kind, converter });
  }
  const counted = new Map<string, { source: DerivedSource; n: number }>();
  for (const c of waiting) {
    const source = byKey.get(c.from.slice(0, c.from.indexOf('#')));
    if (!source) continue;
    const key = `${source.derivedKind}\u0000${source.converter ?? ''}`;
    const entry = counted.get(key) ?? { source, n: 0 };
    entry.n++;
    counted.set(key, entry);
  }
  let best: { source: DerivedSource; n: number } | null = null;
  for (const entry of counted.values()) if (!best || entry.n > best.n) best = entry;
  return best?.source ?? null;
}

/**
 * `value` as one POSIX shell word: as it is when it has only characters no
 * shell treats specially, else in single quotes (a `'` as `'\''`), so a
 * pasted suggestion never runs `$(…)` or backticks a manifest planted.
 */
export function shellArg(value: string): string {
  return /^[A-Za-z0-9@%+=:,./_-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/** `name` + `suffix` within the 100 characters a rule name may have, cut with „…“ (as the web). */
function fitRuleName(name: string, suffix = ''): string {
  if (name.length + suffix.length <= MAX_AUTO_ACCEPT_NAME_CHARS) return name + suffix;
  const budget = MAX_AUTO_ACCEPT_NAME_CHARS - suffix.length - 1;
  let cut = '';
  for (const ch of name) {
    if (cut.length + ch.length > budget) break;
    cut += ch;
  }
  return `${cut.trimEnd()}…${suffix}`;
}

/**
 * The German name the web suggests for a rule for derived calls
 * (`suggestedRuleName`): by its source, within 100 characters, „(2)“ … while
 * another rule of the project has it (names are unique ignoring case).
 */
export function ruleName(source: DerivedSource, taken: readonly string[] = []): string {
  const base =
    source.derivedKind === 'converted'
      ? fitRuleName(`Aufrufe: konvertiert mit ${source.converter ?? ''}`)
      : source.derivedKind === 'export'
        ? 'Aufrufe: Export ohne Engine'
        : 'Aufrufe: ohne Angabe';
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = fitRuleName(base, ` (${n})`);
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * The step that lets an owner rule accept the calls of `source` (M6 S2c-3),
 * one indented line, its arguments shell-quoted ({@link shellArg}): with a
 * rule of the project naming that source, `analyzr rules apply <id>` while
 * it is on (rules are never retroactive; apply shows its dry run first),
 * else `analyzr rules enable <id>`; without one, `analyzr rules add --name …
 * --derived … [--converter …]`, which creates it off (it says how to turn
 * it on).
 */
export function ruleStep(
  project: string,
  source: DerivedSource,
  rules: readonly Pick<
    AutoAcceptRule,
    'id' | 'name' | 'enabled' | 'proposedBy' | 'derivedKind' | 'converter'
  >[],
): string {
  const p = shellArg(project);
  const naming = rules.filter(
    (r) =>
      r.proposedBy === 'rule' &&
      r.derivedKind === source.derivedKind &&
      (source.derivedKind !== 'converted' || r.converter === source.converter),
  );
  const existing = naming.find((r) => r.enabled) ?? naming[0];
  if (existing) {
    return existing.enabled
      ? `  or let the owner rule ${JSON.stringify(existing.name)} accept them: analyzr rules apply ${existing.id} -p ${p}`
      : `  or turn on the owner rule ${JSON.stringify(existing.name)} for that source: analyzr rules enable ${existing.id} -p ${p}`;
  }
  const converter =
    source.derivedKind === 'converted' ? ` --converter ${shellArg(source.converter ?? '')}` : '';
  const name = shellArg(
    ruleName(
      source,
      rules.map((r) => r.name),
    ),
  );
  return `  or add an owner rule that accepts that source's next calls: analyzr rules add --name ${name} --derived ${source.derivedKind}${converter} -p ${p}`;
}

/**
 * The next step for the unique calls of derived models (M6 S2c, the trust
 * rule), two lines or none: while `calls` of them wait ({@link waitingCalls}),
 * `next: 6 models are derived (no engine 6); 1 unique call is a proposal:
 * accept it in the web review before the agent runs:` and the web link that
 * opens the bulk accept with exactly those selected
 * (`<url>/projects/<p>/review?bulk=calls`). The models are this import's
 * derived files, `unchanged` ones included (they keep their class), each
 * under its first reason, so the parts add up; without such files the line
 * names the calls alone. With `rule` (the owner key, M6 S2c-3) a third line
 * names the owner rule for their source ({@link ruleStep}).
 */
export function trustSteps(
  summary: ImportSummary,
  calls: number,
  url: string,
  rule: string | null = null,
): string[] {
  if (calls === 0) return [];
  const derived = summary.files.filter(isDerivedFile);
  const byReason = new Map<TrustReason, number>();
  for (const f of derived) {
    const [first] = f.trust?.reasons ?? [];
    if (first !== undefined) byReason.set(first, (byReason.get(first) ?? 0) + 1);
  }
  const reasons = TrustReason.options
    .filter((reason) => byReason.has(reason))
    .map((reason) => `${TRUST_REASONS[reason]} ${byReason.get(reason) ?? 0}`);
  const n = derived.length;
  const models =
    n === 0
      ? ''
      : `${n === 1 ? '1 model is' : `${n} models are`} derived${reasons.length > 0 ? ` (${reasons.join(', ')})` : ''}; `;
  const what =
    calls === 1
      ? `1 unique call${n === 0 ? ' from derived models' : ''} is a proposal: accept it`
      : `${calls} unique calls${n === 0 ? ' from derived models' : ''} are proposals: accept them`;
  return [
    `next: ${models}${what} in the web review before the agent runs:`,
    `  ${url.replace(/\/+$/, '')}${reviewPath(summary.project)}?bulk=calls`,
    ...(rule ? [rule] : []),
  ];
}

/**
 * The next-step block after a text-mode import: the waiting tasks in the
 * spec's wording (`relations tasks` also for one), the step the identity
 * warnings call for ({@link identitySteps}), the bulk accept of the unique
 * calls of derived models that wait ({@link trustSteps}), then the agent
 * step only when something waits (`then:` after another step), each slash
 * command only for its kind.
 */
export function formatNextSteps(
  project: string,
  waiting: WaitingTasks,
  identity: readonly string[] = [],
  trust: readonly string[] = [],
): string {
  const lines = [
    `${project}: ${waiting.relations} relations tasks waiting, placement task waiting: ${waiting.placement ? 'yes' : 'no'}`,
    ...identity,
    ...trust,
  ];
  if (waiting.relations > 0 || waiting.placement) {
    lines.push(
      `${identity.length + trust.length > 0 ? 'then' : 'next'}: let an agent work them, e.g. in Claude Code with the plugin analyzr:`,
    );
    if (waiting.relations > 0) lines.push(`  /analyzr:relations ${project}`);
    if (waiting.placement) lines.push(`  /analyzr:placements ${project}`);
    lines.push(
      `  other clients: the start prompts in examples/agents; a token: analyzr token create -p ${project}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * {@link ruleStep} with the project's rules (one request, the owner key);
 * `null` when they cannot be listed (the step is information only).
 */
async function ownerRuleStep(
  api: Api,
  project: string,
  source: DerivedSource,
): Promise<string | null> {
  try {
    const list = await call(
      api,
      `list the auto-accept rules of ${project}`,
      listAutoAcceptRules({ client: api.client, path: { project } }),
    );
    return ruleStep(project, source, list.items);
  } catch {
    return null;
  }
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
  /** M6 S2b: preview with `?dryRun=true` (permission `read`): the outcomes and the impact, nothing imported. */
  dryRun?: boolean;
}

/**
 * Said on stderr before an import or a dry run with an agent token (M6 S2c,
 * decision 24.2): its revisions count as derived, so their unique calls
 * become proposals instead of acceptances. It names where the token came
 * from and how to import with the owner key instead: a token left in
 * `ANALYZR_TOKEN` would otherwise do that silently to a Camunda bundle, and
 * a re-import of the same bytes keeps the class (`trust-kept`).
 */
export function agentTokenNotice(source: '--token' | 'ANALYZR_TOKEN'): string {
  const instead = source === '--token' ? 'drop --token' : 'unset ANALYZR_TOKEN';
  return `importing with an agent token (${source}): unique calls become proposals (trust rule); ${instead} to import with the owner key`;
}

/**
 * `analyzr import <dir> --project <key> [--create [--name <name>]] [--dry-run] [--verbose] [--json]`.
 * Reads `analyzr-import.json` at `<dir>` when there is one (M6 S2a: pinned
 * keys, declared provenance, import warnings). Text mode ends with the
 * bundle's value chain to push, the tasks waiting in the project and the
 * next agent step; `--json` prints the summary only. Warnings (also import
 * warnings) and skipped files never change the exit code. Exit 1 if a file failed, or if every file was a plain
 * `.xml` that is no BPMN (nothing imported; as a folder without BPMN files).
 * `--dry-run` (M6 S2b) previews into an existing project with any credential
 * (a read-only token too): the same lines, then what the import would change
 * ({@link formatImpact}); nothing is imported, and a file that would fail
 * exits 1 as well. With an agent token, both say {@link agentTokenNotice}
 * on stderr first (M6 S2c).
 */
export async function importCommand(io: CliIo, dir: string, opts: ImportOptions): Promise<void> {
  if (opts.dryRun && opts.create) {
    throw new CliError('--dry-run previews into an existing project: drop --create');
  }
  // Read and check everything locally first: a refused manifest creates no project.
  const prepared = await prepareImport(path.resolve(io.cwd, dir));
  const credential = opts.create ? await ownerCredential(io, opts) : await anyCredential(io, opts);
  // M6 S2c: an agent token makes every revision derived, so no unique call is accepted.
  if (credential.kind === 'agent-token') {
    io.stderr(`${agentTokenNotice(opts.token === undefined ? 'ANALYZR_TOKEN' : '--token')}\n`);
  }
  const api = createApi(io, opts.url, credential);
  if (opts.create) {
    const { created } = await ensureProject(api, opts.project, opts.name ?? opts.project);
    if (created && !opts.json) io.stdout(`created project ${opts.project}\n`);
  }
  const summary = await sendImport(api, opts.project, prepared, { dryRun: opts.dryRun === true });
  // Every file picked up was a plain `.xml` that is no BPMN: nothing was imported. A file
  // skipped for its key never gets here alone: the `.bpmn…` file that has the key was sent.
  const nothing = summary.files.length === 0;
  if (opts.json) io.stdout(`${JSON.stringify(summary, null, 2)}\n`);
  else io.stdout(formatImport(summary, { verbose: opts.verbose === true }));
  if (summary.impact) {
    if (!opts.json) io.stdout(formatImpact(summary.impact, opts.project, summary.batches));
    if (nothing)
      throw new CliError(
        `no BPMN files below ${dir}: ${skippedText(summary.skipped) ?? '0 skipped'}`,
      );
    if (summary.counts.failed > 0) {
      throw new CliError(`${summary.counts.failed} of ${summary.files.length} files would fail`);
    }
    return;
  }
  if (!opts.json && summary.manifest?.valueChain !== undefined) {
    // Never sent with the models (M6 §3.2): the human pushes the chain, after a dry run.
    const chain = path.resolve(io.cwd, dir, summary.manifest.valueChain);
    io.stdout(
      `value chain: the bundle has ${summary.manifest.valueChain}; push it with analyzr value-chain push ${shellArg(chain)} -p ${shellArg(opts.project)} --dry-run, then without --dry-run (owner key)\n`,
    );
  }
  if (!opts.json && !nothing) {
    try {
      const waiting = await waitingTasks(api, opts.project);
      // Only after derived models: their calls are the ones the trust rule only proposed.
      const calls = summary.files.some(isDerivedFile) ? await waitingCalls(api, opts.project) : [];
      // The owner key may let a rule for derived calls accept them (M6 S2c-3); a token never.
      const source =
        credential.kind === 'owner-key' && calls.length > 0
          ? ruleSource(summary, prepared.manifest, calls)
          : null;
      const rule = source ? await ownerRuleStep(api, opts.project, source) : null;
      io.stdout(
        formatNextSteps(
          opts.project,
          waiting,
          identitySteps(summary),
          trustSteps(summary, calls.length, api.url, rule),
        ),
      );
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

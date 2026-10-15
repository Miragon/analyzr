/**
 * What the scripts print on stdout (M6 §3.7): short enough that an agent reads
 * it whole, also for a landscape of hundreds of models (well under 20 KB):
 * totals, everything that needs the consultant's attention first, long lists
 * cut to their first entries with the full count. The complete result goes to
 * the file `--json-out` names, where the agent reads the details from.
 */
import type { BundleResult } from './bundle.ts';
import type { InspectReport } from './inspect.ts';
import type { KeyPlan } from './keymap.ts';
import type { LossCode } from './normalize.ts';

/** A long list cut to its first entries: `count` is the full length. */
export interface Capped<T> {
  count: number;
  items: T[];
}

export function capped<T>(items: readonly T[], max: number): Capped<T> {
  return { count: items.length, items: items.slice(0, max) };
}

/**
 * JSON with two-space indentation, but every element of an array of objects
 * on one line: a list of 30 entries stays 30 lines.
 */
export function formatCompactJson(value: unknown): string {
  const render = (v: unknown, indent: string): string => {
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]';
      if (v.every((x) => typeof x !== 'object' || x === null)) return JSON.stringify(v);
      return `[\n${v.map((x) => `${indent}  ${JSON.stringify(x)}`).join(',\n')}\n${indent}]`;
    }
    if (typeof v === 'object' && v !== null) {
      const entries = Object.entries(v).filter(([, x]) => x !== undefined);
      if (entries.length === 0) return '{}';
      return `{\n${entries
        .map(([k, x]) => `${indent}  ${JSON.stringify(k)}: ${render(x, `${indent}  `)}`)
        .join(',\n')}\n${indent}}`;
    }
    return JSON.stringify(v);
  };
  return `${render(value, '')}\n`;
}

const LIST = 30;
const SHORT_LIST = 20;

/**
 * The plan for the confirmation: counts, examples, then every file that needs
 * a look (moved, flagged, colliding, and on a re-import every new one), absent
 * and excluded models.
 */
export function compactPlan(plan: KeyPlan): Record<string, unknown> {
  const attention = plan.files
    .filter(
      (f) =>
        f.status === 'moved' ||
        f.flags.length > 0 ||
        f.collidesWith !== undefined ||
        (f.status === 'new' && !plan.firstImport),
    )
    .map((f) => ({
      path: f.path,
      key: f.key,
      status: f.status,
      ...(f.previousPath === undefined ? {} : { previousPath: f.previousPath }),
      ...(f.collidesWith === undefined ? {} : { collidesWith: f.collidesWith }),
      ...(f.flags.length === 0 ? {} : { flags: f.flags }),
    }));
  return {
    system: plan.system,
    rule: plan.rule,
    scope: plan.scope,
    exclude: plan.exclude,
    firstImport: plan.firstImport,
    reset: plan.reset,
    counts: { models: plan.files.length, ...plan.counts },
    examples: plan.examples,
    attention: capped(attention, LIST),
    absent: capped(
      plan.absent.map((e) => ({ key: e.key, externalPath: e.externalPath })),
      LIST,
    ),
    excluded: capped(plan.excluded, SHORT_LIST),
  };
}

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

/**
 * The bundle at a glance: counts and totals, the files with something to
 * report, then what was not taken over, absent models and the coverage.
 */
export function compactBundle(result: BundleResult): Record<string, unknown> {
  const losses: Partial<Record<LossCode, number>> = {};
  for (const f of result.files) {
    for (const l of f.losses) losses[l.code] = (losses[l.code] ?? 0) + l.count;
  }
  const calls = result.files.flatMap((f) => f.callActivities);
  const noteworthy = result.files
    .filter(
      (f) =>
        f.kind === 'converted' ||
        f.losses.length > 0 ||
        f.parseWarnings.length > 0 ||
        f.ambiguousReferences.length > 0,
    )
    .map((f) => ({
      source: f.source,
      key: f.key,
      kind: f.kind,
      ...(f.encoding === 'utf-8' ? {} : { encoding: f.encoding }),
      ...(f.compact ? { compact: true } : {}),
      ...(f.losses.length === 0 ? {} : { losses: f.losses }),
      ...(f.idRewrites.length === 0 ? {} : { idRewrites: f.idRewrites.length }),
      ...(f.ambiguousReferences.length === 0
        ? {}
        : { ambiguousReferences: f.ambiguousReferences.length }),
      ...(f.parseWarnings.length === 0 ? {} : { parseWarnings: f.parseWarnings.length }),
      ...(f.layoutMissing.length === 0 ? {} : { layoutMissing: f.layoutMissing.length }),
    }));
  const coverage = result.coverage;
  return {
    bundle: result.bundle,
    counts: {
      models: result.files.length,
      export: result.files.filter((f) => f.kind === 'export').length,
      converted: result.files.filter((f) => f.kind === 'converted').length,
      failed: result.failed.length,
      skipped: result.skipped.length,
      excluded: result.excluded.length,
      absent: result.absent.length,
    },
    losses,
    totals: {
      idRewrites: sum(result.files.map((f) => f.idRewrites.length)),
      layoutIdRewrites: sum(result.files.map((f) => f.layoutIdRewrites)),
      calledElementRewrites: sum(result.files.map((f) => f.calledElementRewrites.length)),
      ambiguousReferences: sum(result.files.map((f) => f.ambiguousReferences.length)),
      parseWarnings: sum(result.files.map((f) => f.parseWarnings.length)),
      layoutMissing: sum(result.files.map((f) => f.layoutMissing.length)),
      blackBoxParticipants: sum(result.files.map((f) => f.blackBoxParticipants.length)),
      collapsedSubprocesses: sum(result.files.map((f) => f.collapsedSubprocesses.length)),
    },
    calls: {
      one: calls.filter((c) => c.match === 'one').length,
      none: calls.filter((c) => c.match === 'none').length,
      several: calls.filter((c) => c.match === 'several').length,
      expression: calls.filter((c) => c.match === 'expression').length,
      empty: calls.filter((c) => c.match === 'empty').length,
    },
    files: capped(noteworthy, LIST),
    failed: capped(result.failed, LIST),
    skipped: capped(result.skipped, SHORT_LIST),
    excluded: capped(result.excluded, SHORT_LIST),
    absent: capped(
      result.absent.map((e) => ({ key: e.key, externalPath: e.externalPath })),
      LIST,
    ),
    coverage:
      coverage === null
        ? null
        : {
            items: coverage.items,
            matched: coverage.matched.length,
            proposed: capped(coverage.proposed, SHORT_LIST),
            missing: capped(coverage.missing, SHORT_LIST),
          },
  };
}

/** Names that suggest an archived, old or copied model: candidates for `--exclude`. */
const ARCHIVE_LIKE =
  /(?:^|[^\p{L}\p{N}])(?:archiv|archive|archived|alt|old|kopie|copy|backup|sicherung|entwurf|draft|papierkorb|trash|veraltet|deprecated)(?:$|[^\p{L}\p{N}])/iu;

/** The shortest folder or file path of each export file whose name suggests an archive or a copy. */
export function archiveLike(paths: readonly string[]): string[] {
  const found = new Set<string>();
  for (const p of paths) {
    const segments = p.split('/');
    const at = segments.findIndex((s) => ARCHIVE_LIKE.test(s.replace(/\.[^.]*$/, '')));
    if (at >= 0) found.add(segments.slice(0, at + 1).join('/'));
  }
  return [...found].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The export at a glance: totals and tools, files per folder, archive-like
 * folders and files, and every file that is no BPMN or carries a note. The
 * per-file details come from `inspect` on a single file.
 */
export function compactInspect(report: InspectReport): Record<string, unknown> {
  const folders = new Map<string, { files: number; byKind: Record<string, number> }>();
  for (const f of report.files) {
    const slash = f.path.lastIndexOf('/');
    const folder = slash < 0 ? '.' : f.path.slice(0, slash);
    const entry = folders.get(folder) ?? { files: 0, byKind: {} };
    entry.files++;
    entry.byKind[f.kind] = (entry.byKind[f.kind] ?? 0) + 1;
    folders.set(folder, entry);
  }
  const notable = report.files
    .filter((f) => f.kind !== 'bpmn' || f.notes.length > 0)
    .map((f) => ({
      path: f.path,
      kind: f.kind,
      size: f.size,
      ...(f.notes.length === 0 ? {} : { notes: f.notes }),
    }));
  return {
    format: report.format,
    inspector: report.inspector,
    totals: report.totals,
    tools: report.tools,
    folders: capped(
      [...folders].map(([folder, v]) => ({ folder, ...v })),
      LIST,
    ),
    archiveLike: capped(archiveLike(report.files.map((f) => f.path)), SHORT_LIST),
    notable: capped(notable, LIST),
  };
}

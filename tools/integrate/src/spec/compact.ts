/**
 * What `analyzr-spec` prints on stdout (M6 S3c §2.3, §3.6), short enough for
 * an agent to read whole, as `src/compact.ts` does for the other scripts:
 * counts first, long lists cut to their first entries with the full count;
 * the complete result goes to the file `--json-out` names.
 */
import { archiveLike, capped, compactPlan } from '../compact.ts';
import type { RebuildReport } from '../keymap.ts';

import type { ScannedSpecs, SpecBundleResult, SpecFile, SpecPlan } from './bundle.ts';

const LIST = 30;
const SHORT_LIST = 20;
const PROBLEMS = 50;

/** One problem as a line: `<spec file>: <path>: <message>`. */
export function problemLine(file: string, problem: { path: string; message: string }): string {
  return problem.path === ''
    ? `${file}: ${problem.message}`
    : `${file}: ${problem.path}: ${problem.message}`;
}

/** `validate`'s result: how many specs, how many valid, every error and warning as a line. */
export function compactValidation(specs: readonly SpecFile[], skipped: readonly string[] = []) {
  const errors = specs.flatMap((s) => s.errors.map((p) => problemLine(s.file, p)));
  const warnings = specs.flatMap((s) => s.warnings.map((p) => problemLine(s.file, p)));
  return {
    specs: specs.length,
    valid: specs.filter((s) => s.errors.length === 0).length,
    errors: capped(errors, PROBLEMS),
    warnings: capped(warnings, PROBLEMS),
    ...(skipped.length === 0 ? {} : { skipped: capped([...skipped], SHORT_LIST) }),
  };
}

/** The tool folders of the specs' tool paths, with their model counts. */
export function foldersOf(paths: readonly string[]): { folder: string; models: number }[] {
  const folders = new Map<string, number>();
  for (const p of paths) {
    const slash = p.lastIndexOf('/');
    const folder = slash < 0 ? '.' : p.slice(0, slash);
    folders.set(folder, (folders.get(folder) ?? 0) + 1);
  }
  return [...folders]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([folder, models]) => ({ folder, models }));
}

/**
 * The plan for the consultant's confirmation, as `normalize-bpmn plan`
 * prints it, plus the specs' tool folders and the archive-like ones (a
 * converted tool's folders exist only in its specs).
 */
export function compactSpecPlan(
  { plan }: SpecPlan,
  scanned: ScannedSpecs,
  rebuilt?: RebuildReport,
): Record<string, unknown> {
  const paths = scanned.specs.flatMap((s) => (s.spec === null ? [] : [s.spec.source.externalPath]));
  return {
    ...compactPlan(plan, rebuilt),
    replacesKnownModel: plan.files.filter((f) => f.flags.includes('replaces-known-model')).length,
    folders: capped(foldersOf(paths), LIST),
    archiveLike: capped(archiveLike(paths), SHORT_LIST),
    warnings: scanned.specs.reduce((n, s) => n + s.warnings.length, 0),
  };
}

/** The bundle at a glance: counts and losses first, then what needs a look. */
export function compactSpecBundle(result: SpecBundleResult): Record<string, unknown> {
  const losses: Record<string, number> = {};
  for (const f of result.files) {
    for (const l of f.losses) losses[l.code] = (losses[l.code] ?? 0) + l.count;
  }
  const coverage = result.coverage;
  return {
    bundle: result.bundle,
    counts: {
      models: result.files.length,
      reconstructed: result.files.filter((f) => f.kind === 'reconstructed').length,
      converted: result.files.filter((f) => f.kind === 'converted').length,
      failed: result.failed.length,
      excluded: result.excluded.length,
      absent: result.absent.length,
    },
    losses: Object.fromEntries(Object.entries(losses).sort(([a], [b]) => (a < b ? -1 : 1))),
    calls: capped(
      result.files.flatMap((f) =>
        f.calls.map((c) => ({ key: f.key, node: c.node, target: c.target })),
      ),
      LIST,
    ),
    notes: result.files.reduce((n, f) => n + f.notes.length, 0),
    files: capped(
      result.files.map((f) => ({
        spec: f.spec,
        key: f.key,
        kind: f.kind,
        name: f.modelName,
        losses: f.losses,
      })),
      LIST,
    ),
    failed: capped(
      result.failed.map(({ spec, key, code, message }) => ({ spec, key, code, message })),
      LIST,
    ),
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

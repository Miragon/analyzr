/**
 * Where the scripts may write (M6 §3.1, skill ground rules 4 and 6): never
 * into the customer's export and never into an analyzr checkout (customer
 * data stays in the consultant's workspace); `analyzr-read.mjs`, which runs
 * without a confirmation, only files of its own kind in the workspace's
 * `reports/`.
 */
import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

/** The file that marks a consultant's workspace (skill step 0). */
export const WORKSPACE_FILE = 'analyzr-workspace.json';

/** `p` made absolute, with the symbolic links of its existing part resolved. */
export function resolvedPath(p: string): string {
  let current = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      return path.join(realpathSync(current), ...rest.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(p);
      rest.push(path.basename(current));
      current = parent;
    }
  }
}

/** True if `child` is `parent` or lies below it. */
export function isInside(child: string, parent: string): boolean {
  const rel = path.relative(resolvedPath(parent), resolvedPath(child));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** The analyzr checkout `p` lies in (a folder at or above it holds `packages/bpmn-facts/`), or `null`. */
export function checkoutOf(p: string): string | null {
  for (let dir = resolvedPath(p); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, 'packages', 'bpmn-facts'))) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}

/** Thrown for a target the scripts must not write to. */
export class PathGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathGuardError';
  }
}

/**
 * Refuses a folder or file to write that lies inside the export or inside an
 * analyzr checkout.
 *
 * @throws {PathGuardError} naming the option and the reason
 */
export function assertWritable(target: string, option: string, exportPath: string): void {
  if (isInside(target, exportPath)) {
    throw new PathGuardError(
      `${option} ${target} lies inside the export ${exportPath}: the export stays untouched; write into the workspace (bundles/, inventory/, reports/)`,
    );
  }
  const checkout = checkoutOf(target);
  if (checkout !== null) {
    throw new PathGuardError(
      `${option} ${target} lies inside the analyzr checkout ${checkout}: customer data stays outside it, in a workspace per customer`,
    );
  }
}

/**
 * Refuses a file `analyzr-read.mjs` would write (`--json-out`) unless its
 * name, also with its symbolic links resolved, ends in `suffix`
 * (`.models.json`, …) and it lies in an existing `reports/` folder next to
 * `analyzr-workspace.json`: a run that needs no confirmation can create or
 * replace only a file of the script's own kind in the workspace's reports,
 * never a settings file, `keymap.json`, a file of the consultant's or one
 * below `exports/`, and creates no folder. The file itself may not be a
 * symbolic link (also a dangling one, which the write would follow) or a
 * hard link (the write would change the other name's file too), and the
 * script opens it without following one. Never inside `bundle` (it is
 * imported as it is) or inside an analyzr checkout (customer data stays
 * outside it).
 *
 * @throws {PathGuardError} naming the option and the reason
 */
export function assertOutputFile(
  target: string,
  option: string,
  suffix: string,
  bundle?: string,
): void {
  const resolved = resolvedPath(target);
  const refused = (why: string) => new PathGuardError(`${option} ${target} is refused: ${why}`);
  if (
    !target.endsWith(suffix) ||
    !resolved.endsWith(suffix) ||
    path.basename(resolved) === suffix
  ) {
    throw refused(`it names a file <name>${suffix} in the workspace's reports/, and nothing else`);
  }
  const existing = lstatSync(target, { throwIfNoEntry: false });
  if (existing !== undefined && (!existing.isFile() || existing.nlink > 1)) {
    throw refused(
      `it is a symbolic link, a hard link or no regular file; name a new file in the workspace's reports/`,
    );
  }
  if (bundle !== undefined && isInside(target, bundle)) {
    throw new PathGuardError(
      `${option} ${target} lies inside the bundle ${bundle}: the bundle is imported as it is; write into the workspace's reports/`,
    );
  }
  const checkout = checkoutOf(target);
  if (checkout !== null) {
    throw new PathGuardError(
      `${option} ${target} lies inside the analyzr checkout ${checkout}: customer data stays outside it, in a workspace per customer`,
    );
  }
  const folder = path.dirname(resolved);
  if (
    path.basename(folder) !== 'reports' ||
    statSync(folder, { throwIfNoEntry: false })?.isDirectory() !== true ||
    statSync(path.join(path.dirname(folder), WORKSPACE_FILE), {
      throwIfNoEntry: false,
    })?.isFile() !== true
  ) {
    throw refused(
      `it lies in no workspace's reports/ folder (an existing reports/ next to ${WORKSPACE_FILE}); write <workspace>/reports/<name>${suffix}`,
    );
  }
}

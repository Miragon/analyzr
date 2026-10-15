/**
 * Where the scripts may write (M6 §3.1, skill ground rules 4 and 6): never
 * into the customer's export and never into an analyzr checkout (customer
 * data stays in the consultant's workspace).
 */
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

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

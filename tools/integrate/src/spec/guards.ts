/**
 * Where `analyzr-spec` may write (M6 S3c §3.5, skill ground rules 4 and 6):
 * never into the spec folder it reads (a bundle there would be read as its
 * input next time), never below a workspace's `exports/` (the customer's
 * files stay untouched, and a render there would pass as the tool's own
 * export), and never into an analyzr checkout (customer data stays outside
 * it). A workspace is the folder holding `analyzr-workspace.json`.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

import { checkoutOf, isInside, PathGuardError, resolvedPath, WORKSPACE_FILE } from '../guards.ts';

/** The workspace `p` lies in (a folder at or above it holds `analyzr-workspace.json`), or `null`. */
export function workspaceOf(p: string): string | null {
  for (let dir = resolvedPath(p); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, WORKSPACE_FILE))) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}

/**
 * Refuses a file or folder to write: inside `places.specs`, below the
 * `exports/` of `places.workspace` or of the workspace the target itself lies
 * in, or inside a checkout.
 *
 * @throws {PathGuardError} naming the option and the reason
 */
export function assertSpecOutput(
  target: string,
  option: string,
  places: { specs?: string; workspace?: string },
): void {
  if (places.specs !== undefined && isInside(target, places.specs)) {
    throw new PathGuardError(
      `${option} ${target} lies inside the spec folder ${places.specs}: write into the workspace (bundles/, reports/)`,
    );
  }
  for (const workspace of new Set([places.workspace, workspaceOf(target)])) {
    if (workspace === undefined || workspace === null) continue;
    const exports = path.join(workspace, 'exports');
    if (isInside(target, exports)) {
      throw new PathGuardError(
        `${option} ${target} lies below ${exports}: the customer's exports stay untouched; write into the workspace (bundles/, reports/)`,
      );
    }
  }
  const checkout = checkoutOf(target);
  if (checkout !== null) {
    throw new PathGuardError(
      `${option} ${target} lies inside the analyzr checkout ${checkout}: customer data stays outside it, in a workspace per customer`,
    );
  }
}

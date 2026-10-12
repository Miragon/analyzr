/**
 * The Claude Code plugin `plugins/analyzr` (CONCEPT §7): one generated skill per
 * pipeline procedure (`/analyzr:relations`, `/analyzr:placements`) under one
 * plugin version. Claude Code updates a Git-hosted install only when the
 * plugin version changes, so any change to a shipped skill needs a new
 * {@link PLUGIN_VERSION}; `test/plugin.test.ts` pins the sha256 of every
 * skill per plugin release, and `scripts/generate.ts` writes this version
 * into `plugins/analyzr/.claude-plugin/plugin.json`.
 */
import { listProcedures, type Procedure } from './index.ts';

/** The plugin's own version, independent of the procedure versions (two skills ship). */
export const PLUGIN_VERSION = '0.3.0';

/** The procedures the plugin ships as skills: every released pipeline procedure, by id. */
export function pipelineProcedures(): Procedure[] {
  return listProcedures().filter((p) => p.status === 'released');
}

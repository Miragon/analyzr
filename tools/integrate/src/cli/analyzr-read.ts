// Entry of plugins/analyzr-integrate/scripts/analyzr-read.mjs (M6 S2b follow-up step 4, owner
// decision 29 (2)): the skill's pre-approved way to analyzr. It reads a project's models and
// identities and previews an import bundle, and cannot import (src/analyzr.ts).
import { constants } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { homedir } from 'node:os';

import {
  analyzrBase,
  assertNoProxy,
  bypassEnvProxy,
  isProjectKey,
  isSourceSystem,
  listExternalIds,
  listModels,
  readCredential,
  type Analyzr,
} from '../analyzr.ts';
import { formatCompactJson } from '../compact.ts';
import { assertOutputFile } from '../guards.ts';
import { compactPreview, previewBundle } from '../preview.ts';
import { ANALYZR_READ_VERSION } from '../version.ts';

import { parse, run, UsageError } from './common.ts';

const USAGE = `Usage:
  node analyzr-read.mjs models -p <project> --url <url> --json-out <file.models.json>
  node analyzr-read.mjs external-ids -p <project> --url <url> [--system <system>]
      --json-out <file.external-ids.json>
  node analyzr-read.mjs preview <bundle> -p <project> --url <url> [--json-out <file.preview.json>]

models        writes the project's models (every page of GET …/models) into <file>,
              as analyzr models list --json prints them: normalize-bpmn plan
              --existing reads it.
external-ids  writes the source-system identity of every live model (GET
              …/external-ids) into <file>, as analyzr models external-ids --json
              prints it: normalize-bpmn plan --from-analyzr reads it.
preview       previews the import of <bundle> (a folder with analyzr-import.json)
              into the existing <project> as analyzr import <bundle> --dry-run
              does: batches of at most 50 files and 25 MB, each with the whole
              manifest, to POST …/imports?dryRun=true. Prints the outcomes, what
              the import would change and the agent work it sets off; --json-out
              writes the complete result (as analyzr import --dry-run --json).

Reads only: these three requests are all it can send (no import, no --create).
<url> is analyzr on this machine (http://127.0.0.1:<port>, http://[::1]:<port>,
http://localhost:<port>); redirects are refused, a proxy is never used (NO_PROXY=*),
and Node's proxy support (NODE_USE_ENV_PROXY or --use-env-proxy with HTTP_PROXY) is
refused. The credential is ANALYZR_TOKEN (an agent token), else the owner key file
(ANALYZR_OWNER_KEY_FILE, else $XDG_STATE_HOME/analyzr/owner-key or
~/.local/state/analyzr/owner-key), checked as the analyzr CLI checks it; it is never
printed. --json-out names a file of the script's own kind (*.models.json,
*.external-ids.json, *.preview.json) in an existing <workspace>/reports/ (next to
analyzr-workspace.json), no symbolic link, never inside the bundle or an analyzr
checkout.
Exit 0; 1 when the work fails (preview: also when a file would fail, with the JSON
printed); 2 on a usage error.
analyzr-integrate analyzr-read ${ANALYZR_READ_VERSION}
`;

/** The project and analyzr of a command, checked before any credential is read. */
function target(values: { project?: string | undefined; url?: string | undefined }): {
  project: string;
  base: URL;
} {
  const project = values.project;
  if (project === undefined || project === '') throw new UsageError('-p <project> is required');
  if (!isProjectKey(project)) {
    throw new UsageError(
      `not a project key: ${JSON.stringify(project)} (a lowercase slug such as kunde-x)`,
    );
  }
  if (values.url === undefined || values.url === '')
    throw new UsageError('--url <url> is required');
  const base = analyzrBase(values.url);
  assertNoProxy(proxyEnv, process.execArgv);
  return { project, base };
}

async function connect(base: URL): Promise<Analyzr> {
  return { base, credential: await readCredential(process.env, homedir(), process.cwd()) };
}

/** Writes a file `assertOutputFile` let through: no folder created, no symbolic link followed. */
async function writeJson(file: string, value: unknown): Promise<string> {
  const handle = await open(
    file,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
    0o644,
  );
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
  } finally {
    await handle.close();
  }
  return file;
}

const OPTIONS = {
  project: { type: 'string', short: 'p' },
  url: { type: 'string' },
  'json-out': { type: 'string' },
} as const;

function jsonOut(value: string | undefined, suffix: string, bundle?: string): string {
  if (value === undefined || value === '')
    throw new UsageError(`--json-out <file${suffix}> is required`);
  assertOutputFile(value, '--json-out', suffix, bundle);
  return value;
}

async function modelsCommand(argv: readonly string[]): Promise<void> {
  const { values, positionals } = parse(argv, OPTIONS);
  if (positionals.length > 0) throw new UsageError('models takes no arguments');
  const { project, base } = target(values);
  const file = jsonOut(values['json-out'], '.models.json');
  const models = await listModels(await connect(base), project);
  process.stdout.write(
    formatCompactJson({ project, models: models.length, written: await writeJson(file, models) }),
  );
}

async function externalIdsCommand(argv: readonly string[]): Promise<void> {
  const { values, positionals } = parse(argv, { ...OPTIONS, system: { type: 'string' } });
  if (positionals.length > 0) throw new UsageError('external-ids takes no arguments');
  const { project, base } = target(values);
  if (values.system !== undefined && !isSourceSystem(values.system)) {
    throw new UsageError(
      `not a source system: ${JSON.stringify(values.system)} (a lowercase slug such as signavio)`,
    );
  }
  const file = jsonOut(values['json-out'], '.external-ids.json');
  const list = await listExternalIds(await connect(base), project, values.system);
  const bySystem: Record<string, number> = {};
  for (const i of list.items as { system?: unknown }[]) {
    const s = String(i.system);
    bySystem[s] = (bySystem[s] ?? 0) + 1;
  }
  process.stdout.write(
    formatCompactJson({
      project,
      models: list.items.length,
      bySystem,
      written: await writeJson(file, list),
    }),
  );
}

async function previewCommand(argv: readonly string[]): Promise<void> {
  const { values, positionals } = parse(argv, OPTIONS);
  if (positionals.length !== 1) throw new UsageError('preview expects one <bundle>');
  const bundle = positionals[0] ?? '';
  const { project, base } = target(values);
  const file =
    values['json-out'] === undefined
      ? undefined
      : jsonOut(values['json-out'], '.preview.json', bundle);
  if (!(await stat(bundle).catch(() => null))?.isDirectory()) {
    throw new Error(`${bundle} is not a directory: preview the bundle folder normalize-bpmn wrote`);
  }
  const api = await connect(base);
  const preview = await previewBundle(api, project, bundle);
  const details = file === undefined ? null : await writeJson(file, preview.summary);
  process.stdout.write(
    formatCompactJson(compactPreview(preview, { credential: api.credential.kind, details })),
  );
  if (preview.summary.counts.failed > 0) process.exitCode = 1;
}

// Before any request: Node's proxy support never sees the credential (src/analyzr.ts).
const proxyEnv = { ...process.env };
bypassEnvProxy(process.env);

run('analyzr-read', USAGE, async () => {
  const [command, ...rest] = process.argv.slice(2);
  if (
    command === '--help' ||
    command === '-h' ||
    (command !== undefined && (rest.includes('--help') || rest.includes('-h')))
  ) {
    process.stdout.write(USAGE);
    return;
  }
  switch (command) {
    case 'models':
      return modelsCommand(rest);
    case 'external-ids':
      return externalIdsCommand(rest);
    case 'preview':
      return previewCommand(rest);
    default:
      throw new UsageError(
        command === undefined ? 'a command is required' : `unknown command ${command}`,
      );
  }
});

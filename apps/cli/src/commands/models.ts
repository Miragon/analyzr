/**
 * `analyzr models list|requeue|delete|pull` (M6 S1; pull since S5c-2): the
 * models of a project over the existing routes (`analyzr models amend` is in
 * `amend.ts`).
 *
 * - **list** pages through `GET …/models` (any credential): key, stage, head
 *   revision, engine and open items, optionally one `--stage`.
 * - **requeue** queues the relations task of the given models, or of all
 *   (`POST …/analyses/requeue`, `{modelKeys}` or `{all: true}`): `queued`,
 *   `open` (a task is queued or claimed) or `not-found` per model. Needs
 *   `write`: the owner key, or an agent token with `analyzr:write`, as
 *   `analyzr value-chain requeue`.
 * - **delete** resolves the keys through `GET …/models` (deleting takes the
 *   `mdl_` id) and deletes the models one by one (`DELETE …/models/{model}`),
 *   as the owner only: an agent token is refused before any request (a CLI
 *   guard; the server's policy lets any `write` credential delete). Unknown
 *   keys stop it before anything is deleted; without `--yes` it only lists
 *   what it would delete. When a later DELETE fails, `--json` still prints
 *   `{deleted, models, failed: {key, error}}` with the models already
 *   deleted before it exits 1. The deletion's impact on relations and
 *   placements comes with M6 S2.
 * - **external-ids** (any credential, M6 S2a, §3.4) lists the source-system
 *   identity of every live model whose uploaded head declares one
 *   (`GET …/external-ids`, optionally one `--system`): key, tool id and tool
 *   folder, from which a lost workspace's `keymap.json` is rebuilt.
 * - **pull** (any credential) writes a live model's BPMN bytes verbatim
 *   (`GET …/revisions/{revision}/content`, read as bytes, so a byte order
 *   mark and line endings stay): the head, which is the amended revision
 *   when amendments apply (M6 S5c-2, §4.8 c: „BPMN herunterladen“), or with
 *   `--original` the uploaded revision the head is computed from
 *   (`source.upstream`, „Original herunterladen“). It prints `r<rev>
 *   <sha256>` and what the revision is on stderr.
 */
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  deleteModel,
  getModelDeletionImpact,
  getRevisionContent,
  listExternalIds,
  listModels,
  listRevisions,
  requeueAnalyses,
  type Model,
  type RequeueResult,
  type Revision,
} from '@analyzr/client';
import {
  MAX_PAGE_LIMIT,
  ModelStage,
  SourceSystem,
  isModelKey,
  type ExternalIdList,
  type ImportImpact,
} from '@analyzr/contracts';

import { call, createApi, type Api } from '../api.ts';
import {
  agentToken,
  anyCredential,
  ownerCredential,
  type CredentialOptions,
} from '../credentials.ts';
import { CliError } from '../errors.ts';
import type { CliIo } from '../io.ts';

/** Most model keys one requeue request takes (`RequeueBody.modelKeys`). */
export const MAX_REQUEUE_KEYS = 1000;

export interface ModelsOptions extends CredentialOptions {
  url: string;
  project: string;
  json?: boolean;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Keys as given, without repeats; an argument that is no model key is refused before any request. */
function parseKeys(keys: readonly string[]): string[] {
  const bad = keys.filter((k) => !isModelKey(k));
  if (bad.length > 0) {
    throw new CliError(
      `not a model key: ${bad.map((k) => JSON.stringify(k)).join(', ')} (lowercase slug segments separated by /, e.g. finanzen/mahnwesen)`,
    );
  }
  return [...new Set(keys)];
}

/** Every live model of the project (all pages of `GET …/models`), sorted by key. */
export async function allModels(api: Api, project: string, stage?: ModelStage): Promise<Model[]> {
  const models: Model[] = [];
  let cursor: string | undefined;
  do {
    const page = await call(
      api,
      `list the models of ${project}`,
      listModels({
        client: api.client,
        path: { project },
        query: {
          limit: MAX_PAGE_LIMIT,
          ...(stage === undefined ? {} : { stage }),
          ...(cursor === undefined ? {} : { cursor }),
        },
      }),
    );
    models.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return models;
}

/** One line per model: key, stage, head revision, engine, open items; columns aligned. */
export function formatModels(models: readonly Model[]): string[] {
  const keyWidth = Math.max(...models.map((m) => m.key.length));
  const stageWidth = Math.max(...models.map((m) => m.stage.length));
  return models.map(
    (m) =>
      `  ${m.key.padEnd(keyWidth)}  ${m.stage.padEnd(stageWidth)}  r${String(m.headRev).padEnd(4)} ${(m.engine ?? '-').padEnd(2)}  ${plural(m.openItems, 'open item')}`,
  );
}

/** `analyzr models list -p <project> [--stage <stage>] [--json]`. */
export async function modelsListCommand(
  io: CliIo,
  opts: ModelsOptions & { stage?: string },
): Promise<void> {
  let stage: ModelStage | undefined;
  if (opts.stage !== undefined) {
    const parsed = ModelStage.safeParse(opts.stage);
    if (!parsed.success) {
      throw new CliError(
        `unknown stage ${JSON.stringify(opts.stage)}; one of ${ModelStage.options.join(', ')}`,
      );
    }
    stage = parsed.data;
  }
  const api = createApi(io, opts.url, await anyCredential(io, opts));
  const models = await allModels(api, opts.project, stage);
  if (opts.json) {
    io.stdout(`${JSON.stringify(models, null, 2)}\n`);
    return;
  }
  const where = stage === undefined ? opts.project : `${opts.project} (stage ${stage})`;
  if (models.length === 0) {
    io.stdout(`no models in ${where}\n`);
    return;
  }
  io.stdout(
    [...formatModels(models), `${where}: ${plural(models.length, 'model')}`, ''].join('\n'),
  );
}

/**
 * The identities as text: one line per model (key, tool id or `-`, tool
 * folder), columns aligned, a count per system, and one line per tool id
 * several keys carry (after `external-id-moved`: one tool model in the
 * landscape twice, which a key map rebuilt from the list cannot hold).
 */
export function formatExternalIds(list: ExternalIdList, project: string, system?: string): string {
  const where = system === undefined ? project : `${project} (system ${system})`;
  if (list.items.length === 0) return `no models with a declared source system in ${where}\n`;
  const keyWidth = Math.max(...list.items.map((i) => i.key.length));
  const idWidth = Math.max(...list.items.map((i) => (i.externalId ?? '-').length));
  const systems = new Map<string, number>();
  for (const i of list.items) systems.set(i.system, (systems.get(i.system) ?? 0) + 1);
  const lines = list.items.map(
    (i) =>
      `  ${i.key.padEnd(keyWidth)}  ${(i.externalId ?? '-').padEnd(idWidth)}  ${i.externalPath ?? '-'}` +
      (system === undefined ? `  (${i.system})` : ''),
  );
  lines.push(
    `${where}: ${[...systems].map(([s, n]) => `${plural(n, 'model')} from ${s}`).join(', ')}`,
  );
  const holders = new Map<string, { system: string; id: string; keys: string[] }>();
  for (const i of list.items) {
    if (i.externalId === null) continue;
    const id = `${i.system}\0${i.externalId}`;
    const entry = holders.get(id) ?? { system: i.system, id: i.externalId, keys: [] };
    entry.keys.push(i.key);
    holders.set(id, entry);
  }
  for (const { system: s, id, keys } of holders.values()) {
    if (keys.length < 2) continue;
    lines.push(
      `${s} id ${id} on ${keys.length} keys: ${keys.join(', ')} (one model twice? analyzr models delete -p ${project} <key>)`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/** `analyzr models external-ids -p <project> [--system <system>] [--json]` (M6 S2a). */
export async function modelsExternalIdsCommand(
  io: CliIo,
  opts: ModelsOptions & { system?: string },
): Promise<void> {
  if (opts.system !== undefined && !SourceSystem.safeParse(opts.system).success) {
    throw new CliError(
      `not a source system: ${JSON.stringify(opts.system)} (a lowercase slug such as signavio or aris)`,
    );
  }
  const api = createApi(io, opts.url, await anyCredential(io, opts));
  const list = await call(
    api,
    `list the external ids of ${opts.project}`,
    listExternalIds({
      client: api.client,
      path: { project: opts.project },
      query: opts.system === undefined ? {} : { system: opts.system },
    }),
  );
  if (opts.json) io.stdout(`${JSON.stringify(list, null, 2)}\n`);
  else io.stdout(formatExternalIds(list, opts.project, opts.system));
}

/** `analyzr models requeue -p <project> (<key>… | --all) [--json]`. */
export async function modelsRequeueCommand(
  io: CliIo,
  keys: readonly string[],
  opts: ModelsOptions & { all?: boolean },
): Promise<void> {
  if (opts.all === true && keys.length > 0) {
    throw new CliError('give model keys or --all, not both');
  }
  if (opts.all !== true && keys.length === 0) {
    throw new CliError('give the model keys to requeue, or --all for every model');
  }
  const modelKeys = parseKeys(keys);
  if (modelKeys.length > MAX_REQUEUE_KEYS) {
    throw new CliError(
      `at most ${MAX_REQUEUE_KEYS} model keys per requeue; use --all for every model`,
    );
  }
  const api = createApi(io, opts.url, await anyCredential(io, opts));
  const result: RequeueResult = await call(
    api,
    `requeue models of ${opts.project}`,
    requeueAnalyses({
      client: api.client,
      path: { project: opts.project },
      body: opts.all === true ? { all: true } : { modelKeys },
    }),
  );
  const missing = result.items.filter((i) => i.outcome === 'not-found');
  if (opts.json) io.stdout(`${JSON.stringify(result.items, null, 2)}\n`);
  else {
    const lines = result.items.map((i) => {
      const task = i.taskId === null ? '' : `  ${i.taskId}`;
      const note = i.outcome === 'open' ? '  (already queued or claimed)' : '';
      return `  ${i.outcome.padEnd(9)} ${i.modelKey}${task}${note}`;
    });
    const count = (o: string) => result.items.filter((i) => i.outcome === o).length;
    lines.push(
      `${opts.project}: ${count('queued')} queued, ${count('open')} open, ${missing.length} not found`,
    );
    io.stdout(`${lines.join('\n')}\n`);
  }
  if (missing.length > 0) {
    throw new CliError(
      `no live model ${missing.map((i) => i.modelKey).join(', ')} in ${opts.project}`,
    );
  }
}

/**
 * What deleting one model would change (`GET …/deletion-impact`, M6 S2b):
 * `2 accepted relations lose an end (missing), 5 rule stances withdrawn, findings 2 added, 0 resolved`.
 */
export function deletionImpactText(impact: ImportImpact): string {
  const missing = impact.endpointsChanged.count;
  return [
    `${plural(missing, 'accepted relation')} ${missing === 1 ? 'loses' : 'lose'} an end (missing)`,
    `${plural(impact.proposalsWithdrawn.count, 'rule stance')} withdrawn`,
    impact.acceptedCalls.count > 0
      ? `${plural(impact.acceptedCalls.count, 'call')} accepted by the rule tier`
      : null,
    `findings ${impact.findingsAdded.count} added, ${impact.findingsResolved.count} resolved`,
  ]
    .filter((p) => p !== null)
    .join(', ');
}

/** `analyzr models delete <key>… -p <project> [--yes] [--json]`. */
export async function modelsDeleteCommand(
  io: CliIo,
  keys: readonly string[],
  opts: ModelsOptions & { yes?: boolean },
): Promise<void> {
  if (agentToken(io, opts) !== undefined) {
    throw new CliError('deleting models needs the owner key: drop --token and unset ANALYZR_TOKEN');
  }
  if (keys.length === 0) throw new CliError('give the model keys to delete');
  const wanted = parseKeys(keys);
  const api = createApi(io, opts.url, await ownerCredential(io, opts));
  const byKey = new Map((await allModels(api, opts.project)).map((m) => [m.key, m]));
  const unknown = wanted.filter((k) => !byKey.has(k));
  if (unknown.length > 0) {
    throw new CliError(`no live model ${unknown.join(', ')} in ${opts.project}; nothing deleted`);
  }
  const models = wanted.map((k) => byKey.get(k)).filter((m): m is Model => m !== undefined);

  if (opts.yes !== true) {
    // M6 S2b: what each deletion would change, each against the project's head.
    const impacts: { key: string; impact: ImportImpact }[] = [];
    for (const m of models) {
      impacts.push({
        key: m.key,
        impact: (await call(
          api,
          `preview deleting ${m.key}`,
          getModelDeletionImpact({
            client: api.client,
            path: { project: opts.project, model: m.id },
          }),
        )) as ImportImpact,
      });
    }
    if (opts.json) io.stdout(`${JSON.stringify({ deleted: false, models, impacts }, null, 2)}\n`);
    else {
      io.stdout(
        [
          `would delete ${plural(models.length, 'model')} from ${opts.project}:`,
          ...formatModels(models),
          ...impacts.map(({ key, impact }) => `  ${key}: ${deletionImpactText(impact)}`),
          'Uploading a key again revives its model with a new revision.',
          '',
        ].join('\n'),
      );
    }
    throw new CliError('nothing deleted; run again with --yes to delete');
  }

  const deleted: Model[] = [];
  for (const m of models) {
    try {
      await call(
        api,
        `delete model ${m.key}`,
        deleteModel({ client: api.client, path: { project: opts.project, model: m.id } }),
      );
    } catch (err) {
      // JSON readers learn what is gone before the error; text mode printed each line already.
      if (opts.json) {
        const error = err instanceof Error ? err.message : String(err);
        io.stdout(
          `${JSON.stringify({ deleted: deleted.length > 0, models: deleted, failed: { key: m.key, error } }, null, 2)}\n`,
        );
      }
      throw err;
    }
    deleted.push(m);
    if (!opts.json) io.stdout(`deleted ${m.key}\n`);
  }
  if (opts.json) io.stdout(`${JSON.stringify({ deleted: true, models }, null, 2)}\n`);
  else {
    io.stdout(
      `${opts.project}: ${plural(models.length, 'model')} deleted; partner relations turn missing, uploading a key again revives its model\n`,
    );
  }
}

export interface PullOptions extends CredentialOptions {
  url: string;
  project: string;
  /** The uploaded revision the head is computed from, instead of the head. */
  original?: boolean;
  /** Output file; default stdout. */
  output?: string;
}

/** The model's head revision (the pages of `GET …/revisions`, newest first, until it turns up). */
async function headRevision(api: Api, project: string, model: Model): Promise<Revision> {
  let cursor: string | undefined;
  do {
    const page = await call(
      api,
      `list the revisions of ${model.key} in ${project}`,
      listRevisions({
        client: api.client,
        path: { project, model: model.id },
        query: { limit: MAX_PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }) },
      }),
    );
    const head = page.items.find((r) => r.id === model.headRevisionId);
    if (head) return head;
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  throw new CliError(`the head revision of ${model.key} is missing from its revisions`);
}

/** `analyzr models pull <key> -p <project> [--original] [-o <file>]`. */
export async function modelsPullCommand(io: CliIo, key: string, opts: PullOptions): Promise<void> {
  const [modelKey] = parseKeys([key]);
  const api = createApi(io, opts.url, await anyCredential(io, opts));
  const model = (await allModels(api, opts.project)).find((m) => m.key === modelKey);
  if (!model) throw new CliError(`no live model ${key} in ${opts.project}`);
  const head = await headRevision(api, opts.project, model);
  const upstream = head.source.kind === 'amendment' ? head.source.upstream : undefined;
  const revisionId = opts.original === true && upstream ? upstream.revisionId : head.id;
  const rev = opts.original === true && upstream ? upstream.rev : head.rev;
  const data = await call(
    api,
    `read r${rev} of ${model.key} in ${opts.project}`,
    getRevisionContent({
      client: api.client,
      path: { project: opts.project, model: model.id, revision: revisionId },
      // The bytes verbatim: a text read would drop a byte order mark.
      parseAs: 'arrayBuffer',
    }),
  );
  const raw = data as unknown;
  if (!(raw instanceof ArrayBuffer)) throw new CliError('the server sent no BPMN');
  const bytes = new Uint8Array(raw);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (opts.output === undefined)
    io.stdout(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes));
  else await writeFile(path.resolve(io.cwd, opts.output), bytes);
  const what =
    upstream === undefined
      ? 'uploaded, the head'
      : opts.original === true
        ? `uploaded; the head r${head.rev} is amended from it`
        : `the head, amended from the uploaded r${upstream.rev}`;
  io.stderr(`r${rev} ${hash} (${what})\n`);
}

/**
 * `analyzr models list|requeue|delete` (M6 S1): the models of a project over
 * the existing routes.
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
 */
import {
  deleteModel,
  listModels,
  requeueAnalyses,
  type Model,
  type RequeueResult,
} from '@analyzr/client';
import { MAX_PAGE_LIMIT, ModelStage, isModelKey } from '@analyzr/contracts';

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
    if (opts.json) io.stdout(`${JSON.stringify({ deleted: false, models }, null, 2)}\n`);
    else {
      io.stdout(
        [
          `would delete ${plural(models.length, 'model')} from ${opts.project}:`,
          ...formatModels(models),
          'Their partner relations turn missing; uploading a key again revives its model with a new revision.',
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

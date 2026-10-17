/**
 * `analyzr amendments list|export|withdraw` (M6 S5c-2, §4.8 c): the model
 * amendments of a project („Ergänzungen“), the change list for the source
 * tool, and withdrawals.
 *
 * - **list** (any credential): `GET …/amendments`, oldest first, one line
 *   per amendment: id, model, element, op, state (with the conflict reason
 *   and „model deleted“), before → after; `--model` (a model or a folder)
 *   and `--state` are the server's filters; `--json` prints the list.
 * - **export** (any credential): `GET …/amendments/export`, the change list
 *   as Markdown (default) or CSV (UTF-8 with a byte order mark), its bytes
 *   verbatim to stdout or `-o <file>`; `--since <seq>` keeps what was
 *   recorded or ended after that event. The seq the list reflects is read
 *   first (`GET …/amendments`) and printed for the next `--since`; reading
 *   it before the export can only repeat an amendment next time, never miss
 *   one.
 * - **withdraw** (owner key only; an agent token is refused before any
 *   request): `<id>` withdraws one amendment (`POST
 *   …/amendments/{id}/withdrawal`), `--model <key>` every live amendment of a
 *   model in one step (`POST …/models/{model}/amendments/withdrawal`; the
 *   model's id comes from its amendments, so a deleted model works too).
 *   Each re-derives the head from the uploaded revision without them, a new
 *   revision; a deleted model gets none, only the withdrawals. `--rev <n>`
 *   sends `If-Match: "r<n>"`, so an amendment recorded after the human
 *   looked is never withdrawn unseen (412 otherwise).
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  exportAmendments,
  listAmendments,
  withdrawAmendment,
  withdrawModelAmendments,
  type ModelAmendment,
  type ModelAmendmentList,
  type WithdrawAmendmentsResult,
} from '@analyzr/client';
import {
  AmendmentState,
  ModelAmendmentId,
  isModelKey,
  type AmendmentFilter,
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
import { shownValue } from './amend.ts';

export interface AmendmentsOptions extends CredentialOptions {
  url: string;
  project: string;
  /** A model key or a folder (`finanzen` matches `finanzen/mahnwesen`). */
  model?: string;
  /** `applied`, `in-source`, `conflict`, `withdrawn` or `superseded`. */
  state?: string;
  /** `withdraw`: only while the model's head is still this rev (`If-Match: "r<rev>"`). */
  rev?: string;
  json?: boolean;
}

export interface ExportOptions extends AmendmentsOptions {
  /** Only what was recorded or ended after this event seq. */
  since?: string;
  /** `md` (also `markdown`, the default) or `csv`. */
  format?: string;
  /** Output file; default stdout. */
  output?: string;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The flags as the server's filters; an invalid one is refused before any request. */
export function parseAmendmentFilter(opts: Pick<AmendmentsOptions, 'model' | 'state'>) {
  const filter: AmendmentFilter = {};
  if (opts.model !== undefined) {
    if (!isModelKey(opts.model)) {
      throw new CliError(
        `not a model key or folder: ${JSON.stringify(opts.model)} (lowercase slug segments separated by /, e.g. finanzen or finanzen/mahnwesen)`,
      );
    }
    filter.modelKey = opts.model;
  }
  if (opts.state !== undefined) {
    const state = AmendmentState.safeParse(opts.state);
    if (!state.success) {
      throw new CliError(
        `unknown state ${JSON.stringify(opts.state)}; one of ${AmendmentState.options.join(', ')}`,
      );
    }
    filter.state = state.data;
  }
  return filter;
}

/** `--format` → `markdown` or `csv`; unknown values are refused before any request. */
export function parseExportFormat(value: string | undefined): 'markdown' | 'csv' {
  if (value === undefined) return 'markdown';
  const v = value.trim().toLowerCase();
  if (v === 'md' || v === 'markdown') return 'markdown';
  if (v === 'csv') return 'csv';
  throw new CliError(`unknown format ${JSON.stringify(value)}; one of md (the default), csv`);
}

/** `--since` → an event seq (0 or more), refused before any request. */
export function parseSince(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const m = /^\s*(\d{1,15})\s*$/.exec(value);
  if (!m?.[1])
    throw new CliError(`--since takes an event number such as 1234 (as an export names it)`);
  return Number(m[1]);
}

/** The project and the filters for messages: `p (model finanzen, state conflict)`. */
function scope(project: string, filter: AmendmentFilter, since?: number): string {
  const parts = [
    filter.modelKey === undefined ? null : `model ${filter.modelKey}`,
    filter.state === undefined ? null : `state ${filter.state}`,
    since === undefined ? null : `since event ${since}`,
  ].filter((p) => p !== null);
  return parts.length === 0 ? project : `${project} (${parts.join(', ')})`;
}

/** `GET …/amendments` with the filters. */
async function amendments(
  api: Api,
  project: string,
  filter: AmendmentFilter,
): Promise<ModelAmendmentList> {
  return call(
    api,
    `list the amendments of ${project}`,
    listAmendments({ client: api.client, path: { project }, query: filter }),
  );
}

/** The state as the list shows it: `conflict (value-changed)`, `applied, model deleted`. */
export function stateText(a: Pick<ModelAmendment, 'state' | 'conflict' | 'modelDeleted'>): string {
  const reason = a.conflict === null ? '' : ` (${a.conflict})`;
  return `${a.state}${reason}${a.modelDeleted ? ', model deleted' : ''}`;
}

/** The element as the list shows it: the field's element, and the endpoint it was set at. */
function elementText(a: Pick<ModelAmendment, 'elementId' | 'viaElementId'>): string {
  return a.viaElementId === null || a.viaElementId === a.elementId
    ? a.elementId
    : `${a.elementId} (at ${a.viaElementId})`;
}

/** One line per amendment under a header: id, model, element, op, state, before → after; aligned. */
export function formatAmendments(items: readonly ModelAmendment[]): string[] {
  const rows = [
    {
      id: 'id',
      model: 'model',
      element: 'element',
      op: 'op',
      state: 'state',
      change: 'before → after',
    },
    ...items.map((a) => ({
      id: a.id,
      model: a.modelKey,
      element: elementText(a),
      op: a.op,
      state: stateText(a),
      change: `${shownValue(a.before)} → ${shownValue(a.after)}`,
    })),
  ];
  const width = (k: 'id' | 'model' | 'element' | 'op' | 'state') =>
    Math.max(...rows.map((r) => r[k].length));
  const [id, model, element, op, state] = [
    width('id'),
    width('model'),
    width('element'),
    width('op'),
    width('state'),
  ];
  return rows.map(
    (r) =>
      `  ${r.id.padEnd(id)}  ${r.model.padEnd(model)}  ${r.element.padEnd(element)}  ${r.op.padEnd(op)}  ${r.state.padEnd(state)}  ${r.change}`,
  );
}

/** `p: 3 amendments (applied 2, conflict 1), as of event 41`: by count, then state. */
export function summarizeAmendments(
  where: string,
  items: readonly ModelAmendment[],
  seq: number,
): string {
  const byState = new Map<string, number>();
  for (const a of items) byState.set(a.state, (byState.get(a.state) ?? 0) + 1);
  const states = [...byState]
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
    .map(([s, n]) => `${s} ${n}`);
  return `${where}: ${plural(items.length, 'amendment')}${states.length === 0 ? '' : ` (${states.join(', ')})`}, as of event ${seq}`;
}

/** `analyzr amendments list -p <project> [--model <key>] [--state <state>] [--json]`. */
export async function amendmentsListCommand(io: CliIo, opts: AmendmentsOptions): Promise<void> {
  const filter = parseAmendmentFilter(opts);
  const api = createApi(io, opts.url, await anyCredential(io, opts));
  const list = await amendments(api, opts.project, filter);
  if (opts.json) {
    io.stdout(`${JSON.stringify(list, null, 2)}\n`);
    return;
  }
  const where = scope(opts.project, filter);
  if (list.items.length === 0) {
    io.stdout(`no amendments in ${where}, as of event ${list.seq}\n`);
    return;
  }
  io.stdout(
    [...formatAmendments(list.items), summarizeAmendments(where, list.items, list.seq), ''].join(
      '\n',
    ),
  );
}

/**
 * `analyzr amendments export -p <project> [--model] [--state] [--since <seq>]
 * [--format md|csv] [-o <file>]`.
 */
export async function amendmentsExportCommand(io: CliIo, opts: ExportOptions): Promise<void> {
  const format = parseExportFormat(opts.format);
  const filter = parseAmendmentFilter(opts);
  const since = parseSince(opts.since);
  const api = createApi(io, opts.url, await anyCredential(io, opts));
  const { seq } = await amendments(api, opts.project, filter);
  const data = await call(
    api,
    `export the change list of ${opts.project}`,
    exportAmendments({
      client: api.client,
      path: { project: opts.project },
      query: { ...filter, format, ...(since === undefined ? {} : { since }) },
      // `arrayBuffer`: a text read would drop the CSV's byte order mark.
      parseAs: 'arrayBuffer',
    }),
  );
  const raw = data as unknown;
  if (!(raw instanceof ArrayBuffer)) throw new CliError('the server sent no change list');
  const bytes = new Uint8Array(raw);
  const next = `as of event ${seq}: export with --since ${seq} next time for what is new`;
  if (opts.output === undefined) {
    // `ignoreBOM`: keep the CSV's byte order mark on stdout too (Excel needs it).
    io.stdout(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes));
    io.stderr(`${next}\n`);
    return;
  }
  await writeFile(path.resolve(io.cwd, opts.output), bytes);
  io.stdout(
    `wrote the change list of ${scope(opts.project, filter, since)} to ${opts.output}; ${next}\n`,
  );
}

/** A withdrawal's result as text: what was withdrawn, the new head, or why nothing was. */
export function formatWithdrawn(
  project: string,
  what: { amendment: string } | { modelKey: string },
  r: WithdrawAmendmentsResult,
): string {
  if (r.result === 'unchanged') {
    if ('amendment' in what) {
      const [a] = r.amendments;
      return `${project}: nothing withdrawn: ${what.amendment} ended before${a ? ` (${a.state})` : ''}\n`;
    }
    return `${project}: nothing withdrawn: ${what.modelKey} has no live amendment\n`;
  }
  const modelKey = 'modelKey' in what ? what.modelKey : (r.amendments[0]?.modelKey ?? '?');
  let head = '; the model is deleted, so no revision was written';
  if (r.revision !== null) {
    const { upstream, amendments: plan = [] } = r.revision.source;
    const from = upstream === undefined ? '' : `, re-derived from the uploaded r${upstream.rev}`;
    const bytes = plan.some((e) => e.outcome === 'applied')
      ? ''
      : ' (no amendment applies: the uploaded bytes)';
    head = `; new head r${r.revision.rev}${from}${bytes}`;
  }
  const lines = [
    `${project}: withdrew ${plural(r.amendments.length, 'amendment')} of ${modelKey}${head}`,
    ...r.amendments.map(
      (a) =>
        `  ${a.id}  ${a.op}  ${elementText(a)}  ${shownValue(a.before)} → ${shownValue(a.after)}  ${stateText(a)}`,
    ),
  ];
  return `${lines.join('\n')}\n`;
}

/** `analyzr amendments withdraw (<id> | --model <key>) -p <project> [--json]`. */
export async function amendmentsWithdrawCommand(
  io: CliIo,
  id: string | undefined,
  opts: AmendmentsOptions,
): Promise<void> {
  if (agentToken(io, opts) !== undefined) {
    throw new CliError(
      'only humans withdraw amendments: analyzr amendments withdraw uses the owner key (drop --token and unset ANALYZR_TOKEN)',
    );
  }
  if ((id === undefined) === (opts.model === undefined)) {
    throw new CliError(
      'give the amendment to withdraw (mam_…, as analyzr amendments list shows it) or --model <key> for every live amendment of a model, not both',
    );
  }
  let headers: { 'if-match': string } | undefined;
  if (opts.rev !== undefined) {
    const rev = opts.rev.trim().replace(/^r/i, '');
    if (!/^[1-9]\d{0,8}$/.test(rev)) {
      throw new CliError(
        `not a revision: ${JSON.stringify(opts.rev)} (the head's number, e.g. 3 or r3, as analyzr models lists it)`,
      );
    }
    headers = { 'if-match': `"r${rev}"` };
  }
  const precondition = headers === undefined ? {} : { headers };
  let print: (r: WithdrawAmendmentsResult) => string;
  let request: (api: Api) => Promise<WithdrawAmendmentsResult>;
  if (id !== undefined) {
    const amendment = id.trim();
    if (!ModelAmendmentId.safeParse(amendment).success) {
      throw new CliError(
        `not an amendment id: ${JSON.stringify(id)} (mam_ and 26 characters, as analyzr amendments list shows it)`,
      );
    }
    print = (r) => formatWithdrawn(opts.project, { amendment }, r);
    request = (api) =>
      call(
        api,
        `withdraw the amendment ${amendment} in ${opts.project}`,
        withdrawAmendment({
          client: api.client,
          path: { project: opts.project, amendment },
          ...precondition,
        }),
      );
  } else {
    const modelKey = opts.model ?? '';
    if (!isModelKey(modelKey)) {
      throw new CliError(
        `not a model key: ${JSON.stringify(modelKey)} (lowercase slug segments separated by /, e.g. finanzen/mahnwesen)`,
      );
    }
    print = (r) => formatWithdrawn(opts.project, { modelKey }, r);
    request = async (api) => {
      // The model's id from its amendments: a deleted model keeps them live.
      const { items } = await amendments(api, opts.project, { modelKey });
      const model = items.find((a) => a.modelKey === modelKey)?.modelId;
      if (model === undefined) {
        throw new CliError(
          `${modelKey} has no amendments in ${opts.project} (analyzr amendments list -p ${opts.project} lists them)`,
        );
      }
      return call(
        api,
        `withdraw the amendments of ${modelKey} in ${opts.project}`,
        withdrawModelAmendments({
          client: api.client,
          path: { project: opts.project, model },
          ...precondition,
        }),
      );
    };
  }
  const api = createApi(io, opts.url, await ownerCredential(io, opts));
  const result = await request(api);
  io.stdout(opts.json ? `${JSON.stringify(result, null, 2)}\n` : print(result));
}

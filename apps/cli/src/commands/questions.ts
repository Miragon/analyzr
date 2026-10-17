/**
 * `analyzr questions` (M6 S4, §4.4): the open questions of a project, the
 * gaps that block links and placements, with any credential that has `read`.
 *
 * - **text** (default) and **json** page through `GET …/open-questions` in
 *   list order (questions, then value chain findings, then informational
 *   items, each by `unlocks` descending): text prints one line per question
 *   (id, unlocks, kind, first model key, subject and question, the kind key
 *   and the texts as the server returns them, line breaks folded, `[answered]`
 *   after an answered one) and a count by kind; json prints every item.
 *   `analyzr questions list` is the same command; answers are recorded by
 *   `analyzr questions answer` (`questions-answer.ts`).
 * - **md** and **csv** fetch `GET …/open-questions/export` and write its bytes
 *   verbatim: the Markdown grouped by contact hint, the CSV with its byte
 *   order mark and the answer columns for the customer (empty, or an
 *   answered item's latest answer and its kind).
 *
 * `--model` (a model key or folder), `--kind`, `--source`, `--ask-who` (a
 * lane, a step owner or a folder, exactly) and `--state` are the server's
 * filters, checked before any request; `-o` writes to a file instead of stdout.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { exportOpenQuestions, listOpenQuestions, type OpenQuestion } from '@analyzr/client';
import {
  MAX_ASK_WHO_FILTER_CHARS,
  MAX_PAGE_LIMIT,
  OpenQuestionFilter,
  OpenQuestionKind,
  OpenQuestionSource,
  OpenQuestionState,
  isModelKey,
} from '@analyzr/contracts';

import { call, createApi, type Api } from '../api.ts';
import { anyCredential, type CredentialOptions } from '../credentials.ts';
import { CliError } from '../errors.ts';
import type { CliIo } from '../io.ts';

/** Output formats: a table (default), the list as JSON, or the server's export. */
export const QUESTION_FORMATS = ['text', 'md', 'csv', 'json'] as const;
export type QuestionFormat = (typeof QUESTION_FORMATS)[number];

export interface QuestionsOptions extends CredentialOptions {
  url: string;
  project: string;
  /** A model key or a folder (`finanzen` matches `finanzen/mahnwesen`). */
  model?: string;
  kind?: string;
  source?: string;
  /** A lane, a step owner or a folder, exactly (the contact hint). */
  askWho?: string;
  /** `open` or `answered`. */
  state?: string;
  /** `text` (default), `md` (also `markdown`), `csv` or `json`. */
  format?: string;
  /** Output file; default stdout. */
  output?: string;
}

/** `--format` → a format; unknown values are refused before any request. */
export function parseFormat(value: string | undefined): QuestionFormat {
  if (value === undefined) return 'text';
  const v = value.trim().toLowerCase();
  const format = v === 'markdown' ? 'md' : v;
  if ((QUESTION_FORMATS as readonly string[]).includes(format)) return format as QuestionFormat;
  throw new CliError(
    `unknown format ${JSON.stringify(value)}; one of text (a table, the default), md, csv, json`,
  );
}

/** The flags as the server's filters; an invalid one is refused before any request. */
export function parseFilter(
  opts: Pick<QuestionsOptions, 'model' | 'kind' | 'source' | 'askWho' | 'state'>,
) {
  const filter: OpenQuestionFilter = {};
  if (opts.model !== undefined) {
    if (!isModelKey(opts.model)) {
      throw new CliError(
        `not a model key or folder: ${JSON.stringify(opts.model)} (lowercase slug segments separated by /, e.g. finanzen or finanzen/mahnwesen)`,
      );
    }
    filter.modelKey = opts.model;
  }
  if (opts.kind !== undefined) {
    const kind = OpenQuestionKind.safeParse(opts.kind);
    if (!kind.success) {
      throw new CliError(
        `unknown kind ${JSON.stringify(opts.kind)}; one of ${OpenQuestionKind.options.join(', ')}`,
      );
    }
    filter.kind = kind.data;
  }
  if (opts.source !== undefined) {
    const source = OpenQuestionSource.safeParse(opts.source);
    if (!source.success) {
      throw new CliError(
        `unknown source ${JSON.stringify(opts.source)}; one of ${OpenQuestionSource.options.join(', ')}`,
      );
    }
    filter.source = source.data;
  }
  if (opts.askWho !== undefined) {
    const askWho = OpenQuestionFilter.shape.askWho.safeParse(opts.askWho);
    if (!askWho.success || askWho.data === undefined) {
      throw new CliError(
        `not a contact hint: ${JSON.stringify(opts.askWho)} (a lane, step owner or folder name of 1 to ${MAX_ASK_WHO_FILTER_CHARS} characters, no control characters)`,
      );
    }
    filter.askWho = askWho.data;
  }
  if (opts.state !== undefined) {
    const state = OpenQuestionState.safeParse(opts.state);
    if (!state.success) {
      throw new CliError(
        `unknown state ${JSON.stringify(opts.state)}; one of ${OpenQuestionState.options.join(', ')}`,
      );
    }
    filter.state = state.data;
  }
  return filter;
}

/** Every open question matching the filters (all pages of `GET …/open-questions`), in list order. */
export async function allQuestions(
  api: Api,
  project: string,
  filter: OpenQuestionFilter,
): Promise<OpenQuestion[]> {
  const items: OpenQuestion[] = [];
  let cursor: string | undefined;
  do {
    const page = await call(
      api,
      `list the open questions of ${project}`,
      listOpenQuestions({
        client: api.client,
        path: { project },
        query: { ...filter, limit: MAX_PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }) },
      }),
    );
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return items;
}

/** Text on one line: line breaks, tabs and other control characters become one space. */
export function oneLine(text: string): string {
  return text.replace(/[\s\p{Cc}]+/gu, ' ').trim();
}

/** The model column: the first model key, `+N` for the others, `-` for steps and the chain. */
function modelColumn(q: OpenQuestion): string {
  const [first, ...rest] = q.modelKeys;
  if (first === undefined) return '-';
  return rest.length === 0 ? first : `${first} +${rest.length}`;
}

/**
 * One line per question under a header: id, unlocks (the open decisions it
 * touches), kind, model, then subject and question (`[answered]` after an
 * answered one); columns aligned.
 */
export function formatQuestions(items: readonly OpenQuestion[]): string[] {
  const rows = [
    { id: 'id', unlocks: 'unlocks', kind: 'kind', model: 'model', question: 'subject: question' },
    ...items.map((q) => ({
      id: q.id,
      unlocks: String(q.unlocks),
      kind: q.kind,
      model: modelColumn(q),
      question: `${oneLine(q.subjectLabel)}: ${oneLine(q.text)}${q.state === 'answered' ? '  [answered]' : ''}`,
    })),
  ];
  const width = (k: 'id' | 'unlocks' | 'kind' | 'model') =>
    Math.max(...rows.map((r) => r[k].length));
  const [id, unlocks, kind, model] = [width('id'), width('unlocks'), width('kind'), width('model')];
  return rows.map(
    (r) =>
      `  ${r.id.padEnd(id)}  ${r.unlocks.padStart(unlocks)}  ${r.kind.padEnd(kind)}  ${r.model.padEnd(model)}  ${r.question}`,
  );
}

/**
 * `vc-seed: 3 open questions (black-box-partner 2, call-target-unknown 1)`:
 * by count, then kind; `…, 1 answered` when answers are recorded.
 */
export function summarizeQuestions(where: string, items: readonly OpenQuestion[]): string {
  const byKind = new Map<string, number>();
  for (const q of items) byKind.set(q.kind, (byKind.get(q.kind) ?? 0) + 1);
  const kinds = [...byKind]
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, n]) => `${k} ${n}`);
  const count = `${items.length} open question${items.length === 1 ? '' : 's'}`;
  const answered = items.filter((q) => q.state === 'answered').length;
  return `${where}: ${count}${kinds.length === 0 ? '' : ` (${kinds.join(', ')})`}${answered === 0 ? '' : `, ${answered} answered`}`;
}

/** The project and the filters for messages: `p (kind held, model finanzen)`. */
function scope(project: string, filter: OpenQuestionFilter): string {
  const parts = [
    filter.kind === undefined ? null : `kind ${filter.kind}`,
    filter.source === undefined ? null : `source ${filter.source}`,
    filter.modelKey === undefined ? null : `model ${filter.modelKey}`,
    filter.askWho === undefined ? null : `ask-who ${JSON.stringify(filter.askWho)}`,
    filter.state === undefined ? null : `state ${filter.state}`,
  ].filter((p) => p !== null);
  return parts.length === 0 ? project : `${project} (${parts.join(', ')})`;
}

/** The export's bytes verbatim (`arrayBuffer`: a text read would drop the CSV's byte order mark). */
async function exportBytes(
  api: Api,
  project: string,
  filter: OpenQuestionFilter,
  format: 'md' | 'csv',
): Promise<Uint8Array> {
  const data = await call(
    api,
    `export the open questions of ${project}`,
    exportOpenQuestions({
      client: api.client,
      path: { project },
      query: { ...filter, format: format === 'md' ? 'markdown' : 'csv' },
      parseAs: 'arrayBuffer',
    }),
  );
  const bytes = data as unknown;
  if (!(bytes instanceof ArrayBuffer)) throw new CliError('the server sent no export');
  return new Uint8Array(bytes);
}

/**
 * `analyzr questions -p <project> [--model] [--kind] [--source] [--ask-who]
 * [--state] [--format text|md|csv|json] [-o <file>]`.
 */
export async function questionsCommand(io: CliIo, opts: QuestionsOptions): Promise<void> {
  const format = parseFormat(opts.format);
  const filter = parseFilter(opts);
  const api = createApi(io, opts.url, await anyCredential(io, opts));

  let bytes: Uint8Array | null = null;
  let text: string;
  if (format === 'md' || format === 'csv') {
    bytes = await exportBytes(api, opts.project, filter, format);
    // `ignoreBOM`: keep the CSV's byte order mark on stdout too (Excel needs it).
    text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
  } else {
    const items = await allQuestions(api, opts.project, filter);
    const where = scope(opts.project, filter);
    if (format === 'json') text = `${JSON.stringify(items, null, 2)}\n`;
    else if (items.length === 0) text = `no open questions in ${where}\n`;
    else text = [...formatQuestions(items), summarizeQuestions(where, items), ''].join('\n');
  }

  if (opts.output === undefined) {
    io.stdout(text);
    return;
  }
  await writeFile(path.resolve(io.cwd, opts.output), bytes ?? text);
  io.stdout(`wrote the open questions of ${scope(opts.project, filter)} to ${opts.output}\n`);
}

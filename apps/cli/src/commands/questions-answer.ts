/**
 * `analyzr questions answer` (M6 S5a, §4.5): records answers to open
 * questions. Answering is a human act (permission `review`), so the command
 * takes the owner key only and refuses an agent token before any request.
 *
 * - **One answer:** `analyzr questions answer <id> -p <project> --text <text>
 *   [--kind antwort|ausserhalb|ergaenzt]` posts to `POST
 *   …/open-questions/{id}/answers`. On a relation the text becomes a human
 *   note on it, on a placement a note on the placement, else it stays with
 *   the answer. An answer identical to a recorded one (kind and text) is
 *   `unchanged`.
 * - **A filled-in sheet:** `analyzr questions answer -p <project> --from
 *   <csv> [--dry-run]` reads the CSV the export wrote, saved again by a
 *   spreadsheet program (`readAnswerSheet`; UTF-8 only, so no umlaut is
 *   mangled), and sends the rows with a filled `Antwort` to `POST
 *   …/open-questions/answers` in one call (one transaction; `dryRun=true`
 *   previews). It prints each sent row's outcome under its row number in the
 *   spreadsheet (as the spreadsheet shows it: blank rows and the header
 *   counted). Unknown ids and invalid rows are
 *   listed and never stored, the rest is; the command exits 1 when a filled
 *   row is (or, in a dry run, would be) left out.
 *
 * Every flag and the sheet are checked before any request. The personal-data
 * check's warnings (e-mail, phone, IBAN) are printed with one hint; they never
 * block.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  answerOpenQuestion,
  answerOpenQuestions,
  type AnswerOpenQuestionResult,
  type AnswerSheetResult,
  type AnswerSheetRowResult,
  type OpenQuestion,
  type OpenQuestionAnswerKind,
  type OpenQuestionAnswerTarget,
  type PersonalDataWarning,
} from '@analyzr/client';
import {
  CsvError,
  MAX_ANSWER_CHARS,
  MAX_ANSWER_SHEET_BODY_BYTES,
  MAX_ANSWER_SHEET_ROWS,
  OPEN_QUESTION_ANSWER_KINDS,
  OpenQuestionId,
  answerKindFromCell,
  hasControlCharacters,
  normalizeAnswerText,
  readAnswerSheet,
  type AnswerSheetRow,
} from '@analyzr/contracts';

import { call, createApi } from '../api.ts';
import { agentToken, ownerCredential, type CredentialOptions } from '../credentials.ts';
import { CliError } from '../errors.ts';
import type { CliIo } from '../io.ts';
import { oneLine } from './questions.ts';

export interface AnswerOptions extends CredentialOptions {
  url: string;
  project: string;
  /** The answer (one question). */
  text?: string;
  /** `antwort` (default), `ausserhalb`, `ergaenzt`, an API value or a sheet label (one question). */
  kind?: string;
  /** A filled-in sheet: the CSV the export wrote. */
  from?: string;
  /** With `from`: preview, store nothing. */
  dryRun?: boolean;
  json?: boolean;
}

/** The short names of `--kind`, beside the API values and the sheet's labels. */
const KIND_ALIASES = new Map<string, OpenQuestionAnswerKind>([
  ['antwort', 'answer'],
  ['ausserhalb', 'outside-landscape'],
  ['außerhalb', 'outside-landscape'],
  ['ergaenzt', 'will-be-modelled'],
  ['ergänzt', 'will-be-modelled'],
]);

/**
 * `--kind` → an answer kind: `antwort` (the default), `ausserhalb` or
 * `ergaenzt`, also the API values (`answer`, `outside-landscape`,
 * `will-be-modelled`) and the sheet's labels („Liegt außerhalb der
 * Landschaft“), case ignored; anything else is refused before any request.
 */
export function parseAnswerKind(value: string | undefined): OpenQuestionAnswerKind {
  if (value === undefined) return 'answer';
  const alias = KIND_ALIASES.get(value.trim().toLocaleLowerCase('de'));
  if (alias !== undefined) return alias;
  const kind = value.trim() === '' ? null : answerKindFromCell(value);
  if (kind !== null) return kind;
  throw new CliError(
    `unknown answer kind ${JSON.stringify(value)}; one of antwort (the default), ausserhalb (outside the landscape) or ergaenzt (will be modelled), also answer, outside-landscape, will-be-modelled or the sheet's labels`,
  );
}

/** `<id>` → an open question id (`q-` and 16 hex characters), refused before any request. */
export function parseQuestionId(value: string): string {
  const id = value.trim();
  if (!OpenQuestionId.safeParse(id).success) {
    throw new CliError(
      `not an open question id: ${JSON.stringify(value)} (q- and 16 hex characters, as analyzr questions lists them)`,
    );
  }
  return id;
}

/**
 * `--text` → the answer as the server stores it (`normalizeAnswerText`: LF
 * line breaks, NFC, trimmed), refused before any request when it cannot be.
 */
export function parseAnswerText(value: string): string {
  const text = normalizeAnswerText(value);
  if (text === '') throw new CliError('the answer is empty: give it with --text');
  if (text.length > MAX_ANSWER_CHARS) {
    throw new CliError(`the answer has ${text.length} characters; at most ${MAX_ANSWER_CHARS}`);
  }
  if (hasControlCharacters(text)) {
    throw new CliError('the answer contains control characters (tab and line breaks are fine)');
  }
  return text;
}

const PERSONAL_DATA_NAMES: Readonly<Record<PersonalDataWarning['kind'], string>> = {
  email: 'an e-mail address',
  phone: 'a phone number',
  iban: 'an IBAN',
};

/** What to remember about every warned answer, printed once. */
export const PERSONAL_DATA_NOTE =
  'answers take no names or other personal data, and a recorded answer cannot be deleted';

/** `an e-mail address (characters 5–24) and a phone number (characters 30–41)`, counted from 1. */
export function describePersonalData(warnings: readonly PersonalDataWarning[]): string {
  const parts = warnings.map(
    (w) => `${PERSONAL_DATA_NAMES[w.kind]} (characters ${w.start + 1}–${w.end})`,
  );
  const last = parts.pop() ?? '';
  return parts.length === 0 ? last : `${parts.join(', ')} and ${last}`;
}

/** Where the text was (or would be) stored: `as a note on relation rel_…`, `kept with the question`. */
function storedAs(target: OpenQuestionAnswerTarget, subjectId?: string): string {
  if (target === 'answer') return 'kept with the question';
  const what = target === 'relation-note' ? 'relation' : 'placement';
  return subjectId === undefined ? `as a note on the ${what}` : `as a note on ${what} ${subjectId}`;
}

/** The note holds the text, never the kind. */
const NOTE_TEXT_ONLY = 'the note holds your text, not the kind';

/**
 * What a recorded answer does today (M6 §4.5 "Where the text lands", S5a),
 * by the item's subject and kind: a relation's note reaches agents with the
 * pair's next judgement (a hold stays for a human to decide); on a placement
 * an agent asked about, the process is due, nothing is queued; a held
 * placement keeps homing its process, so no agent gets it until a human
 * decides the hold; for steps and the value chain, which no model documents,
 * the chain is the way in; else the model's documentation.
 */
export function answerEffect(question: Pick<OpenQuestion, 'kind' | 'subject'>): string {
  const held = question.kind === 'held';
  switch (question.subject.type) {
    case 'relation':
      return held
        ? `agents take the note into account when the pair is judged again; the hold stays until a human decides it; ${NOTE_TEXT_ONLY}`
        : `agents take the note into account when the pair is judged again; ${NOTE_TEXT_ONLY}`;
    case 'placement':
      return held
        ? `the placement stays held, so no agent gets the process: decide the hold in the review screen of the web UI; ${NOTE_TEXT_ONLY}`
        : `the process is due again; nothing is queued (analyzr value-chain requeue queues the placement task); ${NOTE_TEXT_ONLY}`;
    case 'step':
    case 'value-chain':
      return 'no agent sees it yet; to change the analysis, adjust the value chain or place processes on it, or import the missing model';
    case 'ref':
    case 'process':
    case 'model':
      return 'no agent sees it yet; to change the analysis, change the model (e.g. its documentation) and import it again';
  }
}

/** One answer as text: what happened, the question, the effect and any personal-data warning. */
export function formatAnswer(project: string, r: AnswerOpenQuestionResult): string {
  const { answer, question } = r;
  const lines = [
    r.result === 'recorded'
      ? `${project}: answer to ${question.id} recorded (${answer.kind}), ${storedAs(answer.target, answer.note?.subjectId)}`
      : `${project}: answer to ${question.id} unchanged: the same answer (${answer.kind}) is recorded already (${answer.id})`,
    `  ${oneLine(question.subjectLabel)}: ${oneLine(question.text)}`,
  ];
  if (r.result === 'recorded') lines.push(`  ${answerEffect(question)}`);
  if (r.warnings.length > 0) {
    lines.push(
      `  warning: the answer probably contains ${describePersonalData(r.warnings)}`,
      `  ${PERSONAL_DATA_NOTE}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/** A row of the sheet with a filled `Antwort`: its row in the spreadsheet and its cells. */
export interface FilledRow {
  row: number;
  cells: AnswerSheetRow;
}

/** A filled-in sheet: how many rows it has and the filled ones, in order. */
export interface Sheet {
  rows: number;
  filled: FilledRow[];
}

/**
 * Reads a filled-in sheet before any request: UTF-8 (a byte order mark is
 * fine), the columns `id` and `Antwort` (`Antwortart` may be missing); a row
 * counts as filled when its `Antwort` has more than white space, as the
 * server decides. Each row keeps its number in the spreadsheet
 * (`readAnswerSheet`: blank rows and the header counted).
 *
 * @throws {CliError} when the file is missing, not UTF-8 or no answer sheet
 */
export async function readSheet(io: CliIo, file: string): Promise<Sheet> {
  const resolved = path.resolve(io.cwd, file);
  const info = await stat(resolved).catch(() => null);
  if (!info?.isFile()) throw new CliError(`${file} is not a file`);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      await readFile(resolved),
    );
  } catch {
    throw new CliError(
      `${file} is not UTF-8 text; save it as "CSV UTF-8" in your spreadsheet program`,
    );
  }
  let rows: ReturnType<typeof readAnswerSheet>;
  try {
    rows = readAnswerSheet(text);
  } catch (err) {
    if (err instanceof CsvError) throw new CliError(`${file} is no answer sheet: ${err.message}`);
    throw err;
  }
  return {
    rows: rows.length,
    filled: rows.flatMap(({ line, id, text: answer, kind }) =>
      answer.trim() === '' ? [] : [{ row: line, cells: { id, text: answer, kind } }],
    ),
  };
}

/**
 * The server's result for the filled rows as the result for the whole
 * sheet: `row` is the row in the spreadsheet (blank rows and the header
 * counted), and `ignored` counts the sheet's rows without an answer.
 */
export function sheetResult(result: AnswerSheetResult, sheet: Sheet): AnswerSheetResult {
  return {
    ...result,
    counts: {
      ...result.counts,
      ignored: result.counts.ignored + sheet.rows - sheet.filled.length,
    },
    rows: result.rows.map((r) => ({ ...r, row: sheet.filled[r.row - 1]?.row ?? r.row })),
  };
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Why a sheet row is `invalid`, with its cells. */
function invalidWhy(r: AnswerSheetRowResult, sheet: Sheet): string {
  const filled = sheet.filled.find((f) => f.row === r.row);
  switch (r.reason) {
    case 'too-long': {
      const length = filled?.cells.text.trim().length;
      return length === undefined
        ? `the answer is longer than ${MAX_ANSWER_CHARS} characters`
        : `the answer has ${length} characters; at most ${MAX_ANSWER_CHARS}`;
    }
    case 'control-characters':
      return 'the answer contains control characters (tab and line breaks are fine)';
    case 'unknown-kind':
      return `unknown Antwortart ${JSON.stringify(filled?.cells.kind ?? '')}; one of ${OPEN_QUESTION_ANSWER_KINDS.map((k) => `„${k}“`).join(', ')} or empty („Antwort“)`;
    case 'duplicate-id': {
      const first = sheet.filled.find((f) => f.cells.id === r.id && f.row < r.row);
      return first === undefined
        ? 'an earlier row answers the same question'
        : `row ${first.row} answers the same question`;
    }
    default:
      return 'cannot be recorded';
  }
}

function rowOutcome(r: AnswerSheetRowResult, dryRun: boolean): string {
  return r.outcome === 'recorded' && dryRun ? 'would record' : r.outcome;
}

function rowDetail(r: AnswerSheetRowResult, sheet: Sheet): string {
  switch (r.outcome) {
    case 'recorded':
    case 'unchanged':
      return `${r.kind ?? 'answer'}, ${storedAs(r.target ?? 'answer', r.answer?.note?.subjectId)}`;
    case 'unknown':
      return 'no current open question: a wrong id, or its source changed since the export';
    case 'invalid':
      return invalidWhy(r, sheet);
  }
}

/**
 * The sheet's outcome as text: one line per filled row (row, id, outcome,
 * kind and where the text lands, or why it is left out) with its
 * personal-data warning, the counts, the hint once, and how to go on.
 */
export function formatSheet(
  project: string,
  file: string,
  result: AnswerSheetResult,
  sheet: Sheet,
): string {
  const { dryRun, counts: c } = result;
  const shown = result.rows.map((r) => ({
    r,
    row: String(r.row),
    id: r.id === '' ? '(no id)' : r.id,
    outcome: rowOutcome(r, dryRun),
  }));
  const width = (k: 'row' | 'id' | 'outcome') => Math.max(0, ...shown.map((s) => s[k].length));
  const [row, id, outcome] = [width('row'), width('id'), width('outcome')];
  const lines: string[] = [];
  for (const s of shown) {
    lines.push(
      `  row ${s.row.padStart(row)}  ${s.id.padEnd(id)}  ${s.outcome.padEnd(outcome)}  ${rowDetail(s.r, sheet)}`,
    );
    if (s.r.warnings.length > 0) {
      lines.push(`      warning: probably contains ${describePersonalData(s.r.warnings)}`);
    }
  }
  lines.push(
    `${project}: ${file}${dryRun ? ' (dry run, nothing recorded)' : ''}: ${c.recorded} ${dryRun ? 'to record' : 'recorded'}, ${c.unchanged} unchanged, ${c.unknown} unknown, ${c.invalid} invalid, ${plural(c.ignored, 'row')} without an answer`,
  );
  if (result.rows.some((r) => r.warnings.length > 0)) {
    lines.push(
      `${dryRun ? 'check the warned answers before recording them' : 'check the warned answers'}: ${PERSONAL_DATA_NOTE}`,
    );
  }
  if (dryRun && c.recorded > 0) lines.push('run again without --dry-run to record them');
  return `${lines.join('\n')}\n`;
}

/** Exit 1 when a filled row is (or would be) left out: unknown ids, invalid rows. */
function refuseLeftOut(project: string, result: AnswerSheetResult): void {
  const { unknown, invalid } = result.counts;
  if (unknown + invalid === 0) return;
  const parts = [
    unknown > 0 ? `${unknown} unknown` : null,
    invalid > 0 ? `${invalid} invalid` : null,
  ].filter((p) => p !== null);
  const hint =
    unknown > 0
      ? `; an id changes when its source changes: export the sheet again (analyzr questions -p ${project} --format csv) and carry the answers over`
      : '; correct them in the sheet and run again';
  throw new CliError(
    `${plural(unknown + invalid, 'row')} ${result.dryRun ? 'would not be' : 'not'} recorded (${parts.join(', ')})${hint}`,
  );
}

/** `--from`: the filled-in sheet, previewed (`--dry-run`) or recorded in one call. */
async function answerSheet(io: CliIo, file: string, opts: AnswerOptions): Promise<void> {
  const sheet = await readSheet(io, file);
  if (sheet.filled.length === 0) {
    const where =
      sheet.rows === 0
        ? 'the sheet has no rows'
        : `the column Antwort is empty in ${sheet.rows === 1 ? 'its row' : `all ${sheet.rows} rows`}`;
    throw new CliError(`${file}: no answer to record: ${where}`);
  }
  if (sheet.filled.length > MAX_ANSWER_SHEET_ROWS) {
    throw new CliError(
      `${file} has ${sheet.filled.length} filled answers; at most ${MAX_ANSWER_SHEET_ROWS} per call: split the sheet`,
    );
  }
  const body = { rows: sheet.filled.map((f) => f.cells) };
  const bytes = Buffer.byteLength(JSON.stringify(body));
  if (bytes > MAX_ANSWER_SHEET_BODY_BYTES) {
    throw new CliError(
      `the answers of ${file} make ${bytes} bytes; at most ${MAX_ANSWER_SHEET_BODY_BYTES} per call: split the sheet`,
    );
  }
  const dryRun = opts.dryRun === true;
  const api = createApi(io, opts.url, await ownerCredential(io, opts));
  const result = sheetResult(
    await call(
      api,
      `${dryRun ? 'check' : 'record'} the answers of ${file} in ${opts.project}`,
      answerOpenQuestions({
        client: api.client,
        path: { project: opts.project },
        query: { dryRun: dryRun ? 'true' : 'false' },
        body,
      }),
    ),
    sheet,
  );
  io.stdout(
    opts.json
      ? `${JSON.stringify(result, null, 2)}\n`
      : formatSheet(opts.project, file, result, sheet),
  );
  refuseLeftOut(opts.project, result);
}

/**
 * `analyzr questions answer <id> -p <project> --text <text> [--kind] [--json]`
 * or `analyzr questions answer -p <project> --from <csv> [--dry-run] [--json]`.
 */
export async function questionsAnswerCommand(
  io: CliIo,
  id: string | undefined,
  opts: AnswerOptions,
): Promise<void> {
  if (agentToken(io, opts) !== undefined) {
    throw new CliError(
      'only humans answer open questions: analyzr questions answer uses the owner key (drop --token and unset ANALYZR_TOKEN)',
    );
  }
  if (opts.from !== undefined) {
    if (id !== undefined || opts.text !== undefined || opts.kind !== undefined) {
      throw new CliError(
        '--from takes the ids, answers and kinds from the sheet: drop <id>, --text and --kind',
      );
    }
    await answerSheet(io, opts.from, opts);
    return;
  }
  if (opts.dryRun === true) throw new CliError('--dry-run previews a sheet: it needs --from <csv>');
  if (id === undefined || opts.text === undefined) {
    throw new CliError(
      'give the question id and --text <answer>, or --from <csv> with a filled-in sheet',
    );
  }
  const question = parseQuestionId(id);
  const text = parseAnswerText(opts.text);
  const kind = parseAnswerKind(opts.kind);
  const api = createApi(io, opts.url, await ownerCredential(io, opts));
  const result = await call(
    api,
    `answer ${question} in ${opts.project}`,
    answerOpenQuestion({
      client: api.client,
      path: { project: opts.project, question },
      body: { text, kind },
    }),
  );
  io.stdout(
    opts.json ? `${JSON.stringify(result, null, 2)}\n` : formatAnswer(opts.project, result),
  );
}

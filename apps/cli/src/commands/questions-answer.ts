/**
 * `analyzr questions answer` (M6 S5a, §4.5; notes since S5c-1, §4.8 b):
 * records notes on open questions („Notiz hinzufügen“). Answering is a human
 * act (permission `review`), so the command takes the owner key only and
 * refuses an agent token before any request. A note informs and leaves the
 * question open: the actions resolve it (`analyzr questions
 * outside|link|place`, `questions-act.ts`; decisions in the web).
 *
 * - **One note:** `analyzr questions answer <id> -p <project> --text <text>`
 *   posts `{text}` to `POST …/open-questions/{id}/answers`. On a relation
 *   the text becomes a human note on it, on a placement a note on the
 *   placement, else it stays with the question. A note identical to the
 *   item's latest note is `unchanged`. S5a's `--kind` is gone: it is
 *   refused with the way to the outside mark.
 * - **A filled-in sheet:** `analyzr questions answer -p <project> --from
 *   <csv> [--dry-run]` reads the CSV the export wrote, saved again by a
 *   spreadsheet program (`readAnswerSheet`; UTF-8 only, so no umlaut is
 *   mangled), and sends the rows with a filled `Antwort` to `POST
 *   …/open-questions/answers` in one call (one transaction; `dryRun=true`
 *   previews): each a note, while a sheet exported before S5c-1 still
 *   carries `Antwortart`, whose „Liegt außerhalb der Landschaft“ the server
 *   records as an outside mark. It prints each sent row's outcome under its
 *   row number in the spreadsheet (as the spreadsheet shows it: blank rows
 *   and the header counted). Unknown ids and invalid rows are listed and
 *   never stored, the rest is; the command exits 1 when a filled row is (or,
 *   in a dry run, would be) left out.
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
  type OpenQuestionAction,
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
  /** The note (one question). */
  text?: string;
  /** S5a's answer kind: gone since S5c-1, refused with the way to the outside mark. */
  kind?: string;
  /** A filled-in sheet: the CSV the export wrote. */
  from?: string;
  /** With `from`: preview, store nothing. */
  dryRun?: boolean;
  json?: boolean;
}

/** S5a's `--kind`, refused before any request: every answer is a note since S5c-1. */
function refuseKind(project: string, id: string | undefined): never {
  throw new CliError(
    `--kind is gone since M6 S5c-1: every answer is a note, so drop it; to mark a question outside the landscape run analyzr questions outside ${id ?? '<id>'} -p ${project}`,
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
 * A note's text as the server stores it (`normalizeAnswerText`: LF line
 * breaks, NFC, trimmed), refused before any request when it cannot be.
 *
 * @param flag the option that gave it, for the message (`--text`, `--note`)
 */
export function parseNoteText(value: string, flag = '--text'): string {
  const text = normalizeAnswerText(value);
  if (text === '') {
    throw new CliError(
      flag === '--text'
        ? 'the note is empty: give it with --text'
        : `the note is empty: give a text with ${flag} or drop it`,
    );
  }
  if (text.length > MAX_ANSWER_CHARS) {
    throw new CliError(`the note has ${text.length} characters; at most ${MAX_ANSWER_CHARS}`);
  }
  if (hasControlCharacters(text)) {
    throw new CliError('the note contains control characters (tab and line breaks are fine)');
  }
  return text;
}

const PERSONAL_DATA_NAMES: Readonly<Record<PersonalDataWarning['kind'], string>> = {
  email: 'an e-mail address',
  phone: 'a phone number',
  iban: 'an IBAN',
};

/** What to remember about every warned note, printed once. */
export const PERSONAL_DATA_NOTE =
  'notes take no names or other personal data, and a recorded note cannot be deleted';

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

/**
 * What a recorded note does today (M6 §4.5 "Where the text lands", S5a),
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
        ? 'agents take the note into account when the pair is judged again; the hold stays until a human decides it'
        : 'agents take the note into account when the pair is judged again';
    case 'placement':
      return held
        ? 'the placement stays held, so no agent gets the process: decide the hold in the review screen of the web UI'
        : 'the process is due again; nothing is queued (analyzr value-chain requeue queues the placement task)';
    case 'step':
    case 'value-chain':
      return 'no agent sees it yet; to change the analysis, adjust the value chain or place processes on it, or import the missing model';
    case 'ref':
    case 'process':
    case 'model':
      return 'no agent sees it yet; to change the analysis, change the model (e.g. its documentation) and import it again';
  }
}

/**
 * How to run an action (M6 §4.8 a): the CLI command for `link`, `place`,
 * `outside`, `note` and `requeue`; the web UI for the decisions, choosing
 * the valid copy and fixing a step's link.
 */
export function actionCommand(
  project: string,
  q: Pick<OpenQuestion, 'id' | 'subject'>,
  a: Pick<OpenQuestionAction, 'type' | 'pick' | 'step'>,
): string {
  const p = `-p ${project}`;
  switch (a.type) {
    case 'link':
      return a.pick === 'pair'
        ? `analyzr questions link ${q.id} ${p} --pair <from> <to>`
        : `analyzr questions link ${q.id} ${p} --to <target>`;
    case 'place':
      if (q.subject.type === 'step')
        return `analyzr questions place ${q.id} ${p} --process <target>`;
      return `analyzr questions place ${q.id} ${p} --step ${a.step ?? '<step>'}`;
    case 'outside':
      return `analyzr questions outside ${q.id} ${p}`;
    case 'note':
      return `analyzr questions answer ${q.id} ${p} --text <note>`;
    case 'requeue':
      return `analyzr models requeue ${q.subject.id} ${p}`;
    case 'decide':
    case 'choose-copy':
    case 'fix-link':
      return 'the web UI';
  }
}

/**
 * What resolves a question a note leaves open: its primary action, unless
 * that is the note itself or the question is answered already (an outside
 * mark).
 */
export function resolvedBy(
  project: string,
  q: Pick<OpenQuestion, 'id' | 'subject' | 'state' | 'actions'>,
): string | null {
  const primary = q.actions.find((a) => a.primary);
  if (q.state === 'answered' || primary === undefined || primary.type === 'note') return null;
  const how = actionCommand(project, q, primary);
  return `a note leaves the question open; its action „${oneLine(primary.label)}“: ${how === 'the web UI' ? 'in the web UI' : how}`;
}

/** One note as text: what happened, the question, the effect, what resolves it, any warning. */
export function formatAnswer(project: string, r: AnswerOpenQuestionResult): string {
  const { answer, question } = r;
  const lines = [
    r.result === 'recorded'
      ? `${project}: note on ${question.id} recorded, ${storedAs(answer.target, answer.note?.subjectId)}`
      : `${project}: note on ${question.id} unchanged: the latest note says the same (${answer.id})`,
    `  ${oneLine(question.subjectLabel)}: ${oneLine(question.text)}`,
  ];
  if (r.result === 'recorded') {
    lines.push(`  ${answerEffect(question)}`);
    const next = resolvedBy(project, question);
    if (next !== null) lines.push(`  ${next}`);
  }
  if (r.warnings.length > 0) {
    lines.push(
      `  warning: the note probably contains ${describePersonalData(r.warnings)}`,
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
        ? `the note is longer than ${MAX_ANSWER_CHARS} characters`
        : `the note has ${length} characters; at most ${MAX_ANSWER_CHARS}`;
    }
    case 'control-characters':
      return 'the note contains control characters (tab and line breaks are fine)';
    case 'unknown-kind':
      return `unknown Antwortart ${JSON.stringify(filled?.cells.kind ?? '')} (a column of sheets exported before M6 S5c-1); one of ${OPEN_QUESTION_ANSWER_KINDS.map((k) => `„${k}“`).join(', ')} or empty (a note)`;
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
      // An S5a sheet's „Liegt außerhalb der Landschaft“ records an outside mark.
      return r.kind === 'outside-landscape'
        ? 'outside mark (the Antwortart of an earlier sheet), kept with the question'
        : `note, ${storedAs(r.target ?? 'answer', r.answer?.note?.subjectId)}`;
    case 'unknown':
      return 'no current open question: a wrong id, or its source changed since the export';
    case 'invalid':
      return invalidWhy(r, sheet);
  }
}

/**
 * The sheet's outcome as text: one line per filled row (row, id, outcome,
 * note or outside mark and where the text lands, or why it is left out) with its
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
      `${dryRun ? 'check the warned notes before recording them' : 'check the warned notes'}: ${PERSONAL_DATA_NOTE}`,
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
      ? `; an id changes when what it asks about changes: export the sheet again (analyzr questions -p ${project} --format csv) and carry the answers over`
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
 * `analyzr questions answer <id> -p <project> --text <text> [--json]` or
 * `analyzr questions answer -p <project> --from <csv> [--dry-run] [--json]`.
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
  if (opts.kind !== undefined) refuseKind(opts.project, id);
  if (opts.from !== undefined) {
    if (id !== undefined || opts.text !== undefined) {
      throw new CliError('--from takes the ids and notes from the sheet: drop <id> and --text');
    }
    await answerSheet(io, opts.from, opts);
    return;
  }
  if (opts.dryRun === true) throw new CliError('--dry-run previews a sheet: it needs --from <csv>');
  if (id === undefined || opts.text === undefined) {
    throw new CliError(
      'give the question id and --text <note>, or --from <csv> with a filled-in sheet',
    );
  }
  const question = parseQuestionId(id);
  const text = parseNoteText(opts.text);
  const api = createApi(io, opts.url, await ownerCredential(io, opts));
  const result = await call(
    api,
    `answer ${question} in ${opts.project}`,
    answerOpenQuestion({
      client: api.client,
      path: { project: opts.project, question },
      body: { text },
    }),
  );
  io.stdout(
    opts.json ? `${JSON.stringify(result, null, 2)}\n` : formatAnswer(opts.project, result),
  );
}

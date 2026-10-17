/**
 * The open-questions CSV (M6 §4.4, §4.5): its cell protection, the parser
 * and the reader of a filled-in sheet, shared by the server's export (which
 * writes the sheet) and every client that reads it back for
 * `POST /projects/{p}/open-questions/answers` (the CLI's `analyzr questions
 * answer --from`, the web's „Antworten aus CSV übernehmen“). Zod-free on
 * purpose: the web imports it at runtime as
 * `@analyzr/contracts/open-question-csv`.
 *
 * CSV choices: UTF-8 with a byte order mark (without it, Excel reads UTF-8 as
 * the ANSI code page and breaks every umlaut), `;` as separator (the list
 * separator of German Excel, so a double click opens columns, not one line),
 * CRLF and every field quoted (RFC 4180). A cell that a spreadsheet would
 * run as a formula (it starts with `=`, `+`, `-`, `@`, a tab, a carriage
 * return or their full-width forms) gets a leading `'` (OWASP "CSV
 * injection"); so that reading back is exact, a cell that starts with `'`
 * before such a character gets one more. {@link parseOpenQuestionsCsv}
 * undoes both.
 */

/** The byte order mark the CSV starts with (UTF-8 for Excel). */
export const CSV_BOM = '﻿';
/** The CSV separator: German Excel's list separator. */
export const CSV_SEPARATOR = ';';

/** Formula triggers of spreadsheets, also their full-width forms, after any `'`. */
const FORMULA = /^'*[=+\-@\t\r＝＋－＠]/;
const PROTECTED = /^'+[=+\-@\t\r＝＋－＠]/;

/** A cell no spreadsheet runs as a formula (a leading `'`); {@link unprotectCell} undoes it. */
export function protectCell(value: string): string {
  return FORMULA.test(value) ? `'${value}` : value;
}

/** Undoes {@link protectCell}. */
export function unprotectCell(value: string): string {
  return PROTECTED.test(value) ? value.slice(1) : value;
}

/**
 * Why a CSV cannot be read: an unterminated quoted field, text after a
 * closing quote, or (an answer sheet) no `id` or `Antwort` column. Clients
 * say it in their own language by the code; the message is English.
 */
export type CsvErrorCode = 'unterminated-quote' | 'text-after-quote' | 'missing-columns';

/** A CSV the parser could not read. */
export class CsvError extends Error {
  override readonly name = 'CsvError';
  /** What is wrong. */
  readonly code: CsvErrorCode;
  /** The row of the spreadsheet where it is (1-based, as {@link parseOpenQuestionsCsv} counts), if one. */
  readonly line: number | null;

  constructor(message: string, code: CsvErrorCode, line: number | null = null) {
    super(message);
    this.code = code;
    this.line = line;
  }
}

/**
 * Reads a CSV as the export writes it, and as spreadsheets save it again:
 * an optional byte order mark, `;`, `,` or tab as separator (the one the
 * first line with content uses most), CRLF or LF, quoted or bare fields (RFC 4180), the
 * formula protection undone. The first record with a non-empty cell is the
 * header; later records of only empty cells (a cleared row saves as `;;;;;`)
 * are dropped, but every record counts for `lines`, so a row keeps the
 * number a spreadsheet shows for it (a quoted cell with line breaks is one
 * record, as it is one spreadsheet row).
 *
 * @returns the header, the rows as written and each row's number in the
 *   spreadsheet (1-based; blank records and the header counted)
 * @throws {CsvError} on an unterminated quoted field or text after a closing quote
 */
export function parseOpenQuestionsCsv(text: string): {
  header: string[];
  rows: string[][];
  lines: number[];
} {
  const body = text.startsWith(CSV_BOM) ? text.slice(1) : text;
  // The separator from the first line with content (blank lines may precede the header).
  const firstLine = /^.*[^\s;,].*$/m.exec(body)?.[0] ?? '';
  const unquoted = firstLine.replace(/"[^"]*"/g, '');
  const separator = [';', ',', '\t'].reduce((best, s) =>
    unquoted.split(s).length > unquoted.split(best).length ? s : best,
  );
  const rows: string[][] = [];
  const records: number[] = [];
  let record = 0;
  let row: string[] = [];
  let cell = '';
  let i = 0;
  const endCell = () => {
    row.push(unprotectCell(cell));
    cell = '';
  };
  const endRow = () => {
    endCell();
    record++;
    if (row.some((c) => c !== '')) {
      rows.push(row);
      records.push(record);
    }
    row = [];
  };
  while (i < body.length) {
    const ch = body[i];
    if (ch === '"' && cell === '') {
      // A quoted field: up to the closing quote; "" is a quote.
      let j = i + 1;
      for (;;) {
        if (j >= body.length) {
          throw new CsvError(
            `unterminated quoted field from row ${record + 1}`,
            'unterminated-quote',
            record + 1,
          );
        }
        if (body[j] === '"') {
          if (body[j + 1] === '"') {
            cell += '"';
            j += 2;
            continue;
          }
          break;
        }
        cell += body[j];
        j++;
      }
      i = j + 1;
      const next = body[i];
      if (next !== undefined && next !== separator && next !== '\r' && next !== '\n') {
        // The record the quoted field ends in: its line breaks belong to it.
        throw new CsvError(
          `text after a closing quote in row ${record + 1}`,
          'text-after-quote',
          record + 1,
        );
      }
      continue;
    }
    if (ch === separator) {
      endCell();
      i++;
    } else if (ch === '\r' || ch === '\n') {
      endRow();
      i += ch === '\r' && body[i + 1] === '\n' ? 2 : 1;
    } else {
      cell += ch;
      i++;
    }
  }
  if (cell !== '' || row.length > 0) endRow();
  const [header = [], ...rest] = rows;
  return { header, rows: rest, lines: records.slice(1) };
}

/**
 * One row of a filled-in sheet as `POST …/open-questions/answers` takes it:
 * the cells `id`, `Antwort` and `Antwortart`, as written.
 */
export interface AnswerSheetRow {
  id: string;
  text: string;
  kind: string;
}

/** A row of a filled-in sheet as read: its cells and its row in the spreadsheet. */
export interface ReadSheetRow extends AnswerSheetRow {
  /** The row's number in the spreadsheet (1-based; blank rows and the header counted). */
  line: number;
}

/**
 * The rows of a filled-in sheet (the CSV the export wrote, saved again by a
 * spreadsheet program): the columns are found by their header names (`id`,
 * `Antwort`, and `Antwortart`, which may be missing), so moved or added
 * columns do not matter. Every non-blank row is returned with its row
 * number in the spreadsheet; the server ignores rows with an empty
 * `Antwort`, and clients send only the cells (`id`, `text`, `kind`).
 *
 * @throws {CsvError} when the CSV cannot be parsed or lacks the `id` or `Antwort` column
 */
export function readAnswerSheet(text: string): ReadSheetRow[] {
  const { header, rows, lines } = parseOpenQuestionsCsv(text);
  const column = (name: string) => header.findIndex((h) => h.trim() === name);
  const id = column('id');
  const answer = column('Antwort');
  const kind = column('Antwortart');
  if (id < 0 || answer < 0) {
    throw new CsvError(
      'the sheet lacks the column "id" or "Antwort" of the export',
      'missing-columns',
    );
  }
  return rows.map((r, i) => ({
    id: (r[id] ?? '').trim(),
    text: r[answer] ?? '',
    kind: kind < 0 ? '' : (r[kind] ?? ''),
    line: lines[i] ?? i + 2,
  }));
}

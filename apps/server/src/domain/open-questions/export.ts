/**
 * The export of open questions (M6 §4.4): Markdown for reading and
 * interviews, grouped by the contact hint, and a CSV the customer fills in
 * and S5a reads back. German headings and labels. Pure.
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
import {
  OPEN_QUESTION_CSV_COLUMNS,
  OPEN_QUESTION_KIND_LABELS,
  OPEN_QUESTION_SOURCE_LABELS,
  isInformationalKind,
  type OpenQuestion,
  type OpenQuestionAskWho,
  type OpenQuestionExportFormat,
  type OpenQuestionFilter,
  type OpenQuestionSource,
} from '@analyzr/contracts';

/** Sources whose text is a human's or agent's, verbatim (the export names the subject next to it). */
const VERBATIM: ReadonlySet<OpenQuestionSource> = new Set([
  'hold',
  'agent-question',
  'unsure',
  'no-link',
  'summary',
]);

/** The step owners for display: `A` or `Organisationseinheiten A, B`. */
function ownersText(owners: readonly string[]): string {
  return `${owners.length === 1 ? 'Organisationseinheit' : 'Organisationseinheiten'} ${owners.join(', ')}`;
}

/**
 * The contact hint as one line: `Organisationseinheit: …; Lanes: …; Ordner: …`
 * (empty without one); several step owners are joined for display only.
 */
export function askWhoText(askWho: OpenQuestionAskWho): string {
  return [
    askWho.stepOwners.length === 0
      ? null
      : `${askWho.stepOwners.length === 1 ? 'Organisationseinheit' : 'Organisationseinheiten'}: ${askWho.stepOwners.join(', ')}`,
    askWho.lanes.length === 0 ? null : `Lanes: ${askWho.lanes.join(', ')}`,
    askWho.folder === null ? null : `Ordner: ${askWho.folder}`,
  ]
    .filter((p) => p !== null)
    .join('; ');
}

/** The Markdown group of an item: the step owners, else the folder, else the lanes. */
export function askWhoGroup(askWho: OpenQuestionAskWho): string | null {
  if (askWho.stepOwners.length > 0) return ownersText(askWho.stepOwners);
  if (askWho.folder !== null) return `Ordner ${askWho.folder}`;
  if (askWho.lanes.length > 0) return `Lanes ${askWho.lanes.join(', ')}`;
  return null;
}

const WITHOUT_HINT = 'Ohne Ansprechpartner-Hinweis';
/** Refs the Markdown lists per item; the list (and the API) has them all. */
const MARKDOWN_REFS = 10;

// ------------------------------------------------------------------ Markdown

/**
 * Escapes text for Markdown so that it shows as written, with as few
 * backslashes as CommonMark and GFM need: the characters that format, link
 * or open HTML (`\`, `` ` ``, `*`, `[`, `]`, `<`, `|`, `~`), `_` where it can
 * start or end emphasis (not inside a word, as in `Participant_Bank`), `&`
 * before an entity, and block markers at the start of a line; line breaks
 * stay (hard breaks). GFM's autolinks need no brackets, so the `:` of
 * `scheme://`, the `.` after `www` and the `@` of an e-mail address are
 * escaped as well: agent texts never become a clickable link in the
 * customer's copy (GitHub, VS Code, markdown-it with `linkify`; a renderer
 * that links bare domains still would).
 */
export function escapeMarkdown(text: string): string {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) =>
      line
        .replace(/[\\`*[\]<|~]/g, (ch) => `\\${ch}`)
        .replace(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, '\\_')
        .replace(/&(?=#?[A-Za-z0-9]+;)/g, '\\&')
        .replace(/:(?=\/\/)/g, '\\:')
        .replace(/(?<![\p{L}\p{N}])(www)\./giu, '$1\\.')
        .replace(/(?<=[\p{L}\p{N}._%+-])@(?=[\p{L}\p{N}])/gu, '\\@')
        .replace(/^(\s*)([#>+=-])/, '$1\\$2')
        .replace(/^(\s*\d+)([.)])/, '$1\\$2'),
    )
    .join('  \n');
}

/** What the Markdown export says about itself. */
export interface MarkdownHeader {
  projectName: string;
  projectKey: string;
  /** The project's event seq the export reflects. */
  seq: number;
  filter: OpenQuestionFilter;
}

function filterText(filter: OpenQuestionFilter): string | null {
  const parts = [
    filter.modelKey === undefined ? null : `Modell oder Ordner \`${filter.modelKey}\``,
    filter.kind === undefined ? null : `Art „${OPEN_QUESTION_KIND_LABELS[filter.kind]}“`,
    filter.source === undefined ? null : `Quelle „${OPEN_QUESTION_SOURCE_LABELS[filter.source]}“`,
    filter.askWho === undefined
      ? null
      : `Ansprechpartner-Hinweis „${escapeMarkdown(filter.askWho)}“`,
    filter.state === undefined
      ? null
      : `Status ${filter.state === 'open' ? 'offen' : 'beantwortet'}`,
  ].filter((p) => p !== null);
  return parts.length === 0 ? null : parts.join(', ');
}

/**
 * The Markdown export: a title, then the items grouped by their contact
 * hint ({@link askWhoGroup}; groups in the order of their first item,
 * items without a hint last), numbered in list order. Deterministic: no
 * timestamps, the project's seq instead.
 */
export function renderOpenQuestionsMarkdown(
  items: readonly OpenQuestion[],
  header: MarkdownHeader,
): string {
  const groups = new Map<string | null, OpenQuestion[]>();
  for (const q of items) {
    const key = askWhoGroup(q.askWho);
    groups.set(key, [...(groups.get(key) ?? []), q]);
  }
  const ordered = [...groups].sort(([a], [b]) => (a === null ? 1 : 0) - (b === null ? 1 : 0));
  const lines: string[] = [
    `# Offene Fragen: ${escapeMarkdown(header.projectName)}`,
    '',
    `Projekt \`${header.projectKey}\`, Stand Ereignis ${header.seq}: ` +
      `${items.length === 1 ? 'eine offene Frage' : `${items.length} offene Fragen`}, ` +
      'nach Ansprechpartner-Hinweis gruppiert und je Gruppe nach der Zahl offener Entscheidungen ' +
      'geordnet, Hinweise zur Information zuletzt.',
  ];
  const filter = filterText(header.filter);
  if (filter !== null) lines.push('', `Filter: ${filter}.`);
  if (items.length === 0) lines.push('', 'Keine offenen Fragen.');
  let n = 0;
  for (const [group, list] of ordered) {
    lines.push('', `## ${escapeMarkdown(group ?? WITHOUT_HINT)}`);
    for (const q of list) {
      n++;
      lines.push(
        '',
        `### ${n}. ${OPEN_QUESTION_KIND_LABELS[q.kind]}: ${escapeMarkdown(q.subjectLabel)}`,
        '',
        escapeMarkdown(q.text),
        '',
      );
      if (q.context !== null) lines.push(`- Notiz: ${escapeMarkdown(q.context)}`);
      if (q.label !== null) lines.push(`- Vormerkung: ${escapeMarkdown(q.label)}`);
      if (isInformationalKind(q.kind)) lines.push('- Zur Information, keine Antwort nötig');
      lines.push(
        `- Kennung: \`${q.id}\``,
        `- Quelle: ${OPEN_QUESTION_SOURCE_LABELS[q.source]}` +
          (q.raisedBy.handle === null ? '' : ` (${escapeMarkdown(q.raisedBy.handle)})`),
        `- Offene Entscheidungen: ${q.unlocks}`,
      );
      const hint = askWhoText(q.askWho);
      if (hint !== '') lines.push(`- Ansprechpartner-Hinweis: ${escapeMarkdown(hint)}`);
      if (q.refs.length > 0) {
        const listed = q.refs.slice(0, MARKDOWN_REFS).map((r) => `\`${r}\``);
        const more = q.refs.length - listed.length;
        lines.push(`- Bezug: ${listed.join(', ')}${more > 0 ? ` und ${more} weitere` : ''}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

// ----------------------------------------------------------------------- CSV

/** The byte order mark the CSV starts with (UTF-8 for Excel). */
export const CSV_BOM = '\uFEFF';
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

const quoteCell = (value: string): string => `"${protectCell(value).replaceAll('"', '""')}"`;

/** The `Frage` cell: the text, and for verbatim texts what they are about. */
function questionCell(q: OpenQuestion): string {
  return VERBATIM.has(q.source) ? `${q.text}\n\nBetrifft: ${q.subjectLabel}` : q.text;
}

/**
 * The CSV export: {@link OPEN_QUESTION_CSV_COLUMNS}, one row per question in
 * list order, `Antwort` and `Antwortart` empty. Informational items
 * (`summary-note`, `descriptive-model`) ask nothing, so the sheet the
 * customer fills in leaves them out (the Markdown and the list keep them).
 */
export function renderOpenQuestionsCsv(items: readonly OpenQuestion[]): string {
  const rows: string[][] = [
    [...OPEN_QUESTION_CSV_COLUMNS],
    ...items
      .filter((q) => !isInformationalKind(q.kind))
      .map((q) => [
        q.id,
        OPEN_QUESTION_KIND_LABELS[q.kind],
        questionCell(q),
        askWhoText(q.askWho),
        '',
        '',
      ]),
  ];
  return `${CSV_BOM}${rows.map((r) => r.map(quoteCell).join(CSV_SEPARATOR)).join('\r\n')}\r\n`;
}

// ----------------------------------------------------------------- file name

/** Longest filter slug in a file name. */
const MAX_FILTER_SLUG = 80;

/** Text as an ASCII slug: umlauts spelled out, other marks dropped, the rest `-`. */
function slug(text: string): string {
  return text
    .replace(/[äÄ]/g, 'ae')
    .replace(/[öÖ]/g, 'oe')
    .replace(/[üÜ]/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The export's file name: `offene-fragen-<project key>` plus an ASCII slug of
 * the active filters (model or folder, kind, source, contact hint, state;
 * at most {@link MAX_FILTER_SLUG} characters), so one export per department
 * or folder says which it is: `offene-fragen-p-finanzen-black-box-partner.csv`.
 */
export function exportFilename(
  projectKey: string,
  filter: OpenQuestionFilter,
  format: OpenQuestionExportFormat,
): string {
  const parts = [
    filter.modelKey,
    filter.kind,
    filter.source,
    filter.askWho,
    filter.state === undefined ? undefined : filter.state === 'open' ? 'offen' : 'beantwortet',
  ]
    .filter((p) => p !== undefined)
    .map(slug)
    .filter((p) => p !== '');
  const filters = parts.join('-').slice(0, MAX_FILTER_SLUG).replace(/-+$/, '');
  const base = `offene-fragen-${slug(projectKey) || 'projekt'}${filters === '' ? '' : `-${filters}`}`;
  return `${base}.${format === 'csv' ? 'csv' : 'md'}`;
}

/** A CSV the parser could not read. */
export class CsvError extends Error {
  override readonly name = 'CsvError';
}

/**
 * Reads a CSV as the export writes it, and as spreadsheets save it again:
 * an optional byte order mark, `;`, `,` or tab as separator (the one the
 * header line uses most), CRLF or LF, quoted or bare fields (RFC 4180), the
 * formula protection undone. Rows of only empty cells are dropped.
 *
 * @returns the header and the rows, as written
 * @throws {CsvError} on an unterminated quoted field or text after a closing quote
 */
export function parseOpenQuestionsCsv(text: string): { header: string[]; rows: string[][] } {
  const body = text.startsWith(CSV_BOM) ? text.slice(1) : text;
  const firstLine = body.split(/\r?\n/, 1)[0] ?? '';
  const unquoted = firstLine.replace(/"[^"]*"/g, '');
  const separator = [';', ',', '\t'].reduce((best, s) =>
    unquoted.split(s).length > unquoted.split(best).length ? s : best,
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  const endCell = () => {
    row.push(unprotectCell(cell));
    cell = '';
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c !== '')) rows.push(row);
    row = [];
  };
  while (i < body.length) {
    const ch = body[i];
    if (ch === '"' && cell === '') {
      // A quoted field: up to the closing quote; "" is a quote.
      let j = i + 1;
      for (;;) {
        if (j >= body.length) throw new CsvError('unterminated quoted field');
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
        throw new CsvError(`text after a closing quote at offset ${i}`);
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
  return { header, rows: rest };
}

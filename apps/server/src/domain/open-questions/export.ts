/**
 * The export of open questions (M6 §4.4): Markdown for reading and
 * interviews, grouped by the contact hint, and a CSV the customer fills in
 * and S5a reads back. German headings and labels. Pure. The CSV's cell
 * protection and its parser are shared with the clients that read a filled
 * sheet back (`@analyzr/contracts/open-question-csv`).
 */
import {
  CSV_BOM,
  CSV_SEPARATOR,
  OPEN_QUESTION_ANSWER_KIND_LABELS,
  OPEN_QUESTION_CSV_COLUMNS,
  OPEN_QUESTION_KIND_LABELS,
  OPEN_QUESTION_SOURCE_LABELS,
  isInformationalKind,
  protectCell,
  type OpenQuestion,
  type OpenQuestionAskWho,
  type OpenQuestionExportFormat,
  type OpenQuestionFilter,
  type OpenQuestionSource,
} from '@analyzr/contracts';

export {
  CSV_BOM,
  CSV_SEPARATOR,
  CsvError,
  parseOpenQuestionsCsv,
  protectCell,
  unprotectCell,
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
      'geordnet, Befunde der Wertschöpfungskette danach, Hinweise zur Information zuletzt.',
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
      for (const a of q.answers) {
        lines.push(
          `- Antwort (${OPEN_QUESTION_ANSWER_KIND_LABELS[a.kind]}, ${escapeMarkdown(a.by)}, ` +
            `Ereignis ${a.seq}): ${escapeMarkdown(a.text)}`,
        );
      }
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

const quoteCell = (value: string): string => `"${protectCell(value).replaceAll('"', '""')}"`;

/** The `Frage` cell: the text, and for verbatim texts what they are about. */
function questionCell(q: OpenQuestion): string {
  return VERBATIM.has(q.source) ? `${q.text}\n\nBetrifft: ${q.subjectLabel}` : q.text;
}

/**
 * The CSV export: {@link OPEN_QUESTION_CSV_COLUMNS}, one row per question in
 * list order, `Antwort` and `Antwortart` empty for the customer to fill in,
 * or, for an answered item, its latest answer (so a sheet read back again
 * records nothing twice: the identical answer is `unchanged`).
 * Informational items (`summary-note`, `descriptive-model`) ask nothing, so
 * the sheet the customer fills in leaves them out (the Markdown and the list
 * keep them).
 */
export function renderOpenQuestionsCsv(items: readonly OpenQuestion[]): string {
  const rows: string[][] = [
    [...OPEN_QUESTION_CSV_COLUMNS],
    ...items
      .filter((q) => !isInformationalKind(q.kind))
      .map((q) => {
        const latest = q.answers.at(-1);
        return [
          q.id,
          OPEN_QUESTION_KIND_LABELS[q.kind],
          questionCell(q),
          askWhoText(q.askWho),
          latest?.text ?? '',
          latest ? OPEN_QUESTION_ANSWER_KIND_LABELS[latest.kind] : '',
        ];
      }),
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

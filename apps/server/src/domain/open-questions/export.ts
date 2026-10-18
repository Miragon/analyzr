/**
 * The export of open questions (M6 §4.4): Markdown for reading and
 * interviews, grouped by the contact hint, and a CSV the customer fills in
 * and the sheet route reads back as notes (five columns since S5c-1). Both
 * go to the customer, so since UX2a they speak plain German: a date instead
 * of an event number, „Betrifft“ with names instead of refs, the contact
 * hint without the folder, no ids, seqs, sources or handles (the Markdown
 * keeps the id as an HTML comment, the CSV in its `id` column); an agent's
 * verbatim reason says whose it is („Laut Agent: …“). Pure. The CSV's cell
 * protection and its parser are shared with the clients that read a filled
 * sheet back (`@analyzr/contracts/open-question-csv`).
 */
import {
  AGENT_WORDS,
  CSV_BOM,
  CSV_SEPARATOR,
  DEFAULT_EXPORT_GROUPS,
  OPEN_QUESTION_CSV_COLUMNS,
  OPEN_QUESTION_GROUP_LABELS,
  OPEN_QUESTION_KIND_LABELS,
  OPEN_QUESTION_SOURCE_LABELS,
  OPEN_QUESTION_STATE_LABELS,
  answerRoleLabel,
  isInformationalKind,
  isVerbatimSource,
  protectCell,
  type OpenQuestion,
  type OpenQuestionAskWho,
  type OpenQuestionExportFormat,
  type OpenQuestionFilter,
  type OpenQuestionGroup,
} from '@analyzr/contracts';

import { latestNote } from './answers.ts';

export {
  CSV_BOM,
  CSV_SEPARATOR,
  CsvError,
  parseOpenQuestionsCsv,
  protectCell,
  unprotectCell,
} from '@analyzr/contracts';

/** The step owners for display: `A` or `Organisationseinheiten A, B`. */
function ownersText(owners: readonly string[]): string {
  return `${owners.length === 1 ? 'Organisationseinheit' : 'Organisationseinheiten'} ${owners.join(', ')}`;
}

/**
 * The contact hint as one line (UX2a): the step owners, then the lanes,
 * each name once, comma-separated; empty without one. The folder is no
 * person to ask (and already the model filter), so it stays out.
 */
export function contactText(askWho: OpenQuestionAskWho): string {
  return [...new Set([...askWho.stepOwners, ...askWho.lanes])].join(', ');
}

/**
 * The Markdown group of an item: the step owners, else the lanes, else none
 * („Ohne Ansprechpartner“). The folder is no person to ask (as in
 * {@link contactText}), so it heads no group.
 */
export function askWhoGroup(askWho: OpenQuestionAskWho): string | null {
  if (askWho.stepOwners.length > 0) return ownersText(askWho.stepOwners);
  if (askWho.lanes.length > 0) return `Lanes ${askWho.lanes.join(', ')}`;
  return null;
}

/**
 * The reason behind the question as the customer reads it: from code as it
 * is, an agent's verbatim reason (an unsure verdict, a coded no-link)
 * attributed, „Laut Agent: …“, as the tab shows it; `null` without one.
 */
export function detailText(q: Pick<OpenQuestion, 'detail' | 'source'>): string | null {
  if (q.detail === null) return null;
  return isVerbatimSource(q.source) ? `${AGENT_WORDS}: ${q.detail}` : q.detail;
}

const WITHOUT_HINT = 'Ohne Ansprechpartner';

/** A date as the customer reads it: `17.10.2026`, in German time. */
const DATE = new Intl.DateTimeFormat('de-DE', {
  timeZone: 'Europe/Berlin',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** `17.10.2026` (German time) for a date or an ISO timestamp. */
export function formatDateDe(at: Date | string): string {
  return DATE.format(typeof at === 'string' ? new Date(at) : at);
}

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
  /** When the project last changed (its latest event): the export's „Stand“. */
  asOf: Date;
  filter: OpenQuestionFilter;
  /**
   * What each item is about, by item id, in names (`concernsOf`): the
   * „Betrifft“ line; an item without one says its subject label.
   */
  concerns?: ReadonlyMap<string, string>;
}

/** Whether the export's groups are the default ones ({@link DEFAULT_EXPORT_GROUPS}). */
function defaultGroups(groups: readonly OpenQuestionGroup[] | undefined): boolean {
  if (groups === undefined) return false;
  const set = new Set(groups);
  return (
    set.size === DEFAULT_EXPORT_GROUPS.length && DEFAULT_EXPORT_GROUPS.every((g) => set.has(g))
  );
}

function filterText(filter: OpenQuestionFilter): string | null {
  const parts = [
    filter.modelKey === undefined ? null : `Modell oder Ordner \`${filter.modelKey}\``,
    filter.kind === undefined ? null : `Art „${OPEN_QUESTION_KIND_LABELS[filter.kind]}“`,
    filter.source === undefined ? null : `Quelle „${OPEN_QUESTION_SOURCE_LABELS[filter.source]}“`,
    filter.askWho === undefined ? null : `Ansprechpartner „${escapeMarkdown(filter.askWho)}“`,
    filter.state === undefined ? null : `Status „${OPEN_QUESTION_STATE_LABELS[filter.state]}“`,
    filter.group === undefined || defaultGroups(filter.group)
      ? null
      : `${[...new Set(filter.group)].map((g) => `„${OPEN_QUESTION_GROUP_LABELS[g]}“`).join(', ')}`,
  ].filter((p) => p !== null);
  return parts.length === 0 ? null : parts.join(', ');
}

/**
 * `17.10.2026` and, for a withdrawn mark, when it was withdrawn; no handles
 * (the customer's copy names no principals, P2).
 */
function answerMeta(a: OpenQuestion['answers'][number]): string {
  const withdrawn =
    a.withdrawal === null ? '' : `, zurückgenommen am ${formatDateDe(a.withdrawal.at)}`;
  return `${formatDateDe(a.at)}${withdrawn}`;
}

/** „eine offene Frage“, „20 offene Fragen und eine erledigte“: the headline's count by state. */
function countText(items: readonly OpenQuestion[]): string {
  const open = items.filter((q) => q.state === 'open').length;
  const answered = items.length - open;
  const openText = open === 1 ? 'eine offene Frage' : `${open} offene Fragen`;
  if (answered === 0) return openText;
  return `${openText} und ${answered === 1 ? 'eine erledigte' : `${answered} erledigte`}`;
}

/**
 * The Markdown export: a title, the date and the count (open, and the
 * marked ones when the filters keep them), then the items grouped by their
 * contact hint ({@link askWhoGroup}; groups in the order of their first
 * item, items without a hint last), numbered in list order. Per item: the
 * kind and subject as the heading, the id as an HTML comment right after it
 * (invisible when rendered, the way back to `analyzr questions answer`),
 * the question, its reason ({@link detailText}), „Betrifft“, a hold's note
 * and label, the notes (a hold's: its answers) and marks with their dates,
 * and the contact hint. Deterministic: the date is the project's latest
 * event's.
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
    `Stand ${formatDateDe(header.asOf)}: ${countText(items)}, nach Ansprechpartner gruppiert.`,
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
        `<!-- ${q.id} -->`,
        '',
        escapeMarkdown(q.text),
        '',
      );
      const detail = detailText(q);
      if (detail !== null) lines.push(escapeMarkdown(detail), '');
      lines.push(`- Betrifft: ${escapeMarkdown(header.concerns?.get(q.id) ?? q.subjectLabel)}`);
      if (q.context !== null) lines.push(`- Notiz zur Vormerkung: ${escapeMarkdown(q.context)}`);
      if (q.label !== null) lines.push(`- Vormerkung: ${escapeMarkdown(q.label)}`);
      if (isInformationalKind(q.kind)) lines.push('- Zur Information, keine Antwort nötig');
      for (const a of q.answers) {
        lines.push(
          `- ${answerRoleLabel(q.kind, a.role)} (${answerMeta(a)})` +
            (a.text === null ? '' : `: ${escapeMarkdown(a.text)}`),
        );
      }
      const contact = contactText(q.askWho);
      if (contact !== '') lines.push(`- Ansprechpartner: ${escapeMarkdown(contact)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

// ----------------------------------------------------------------------- CSV

const quoteCell = (value: string): string => `"${protectCell(value).replaceAll('"', '""')}"`;

/**
 * The `Frage` cell (UX2a): the question, its reason as the second sentence
 * (the customer may need it to answer; an agent's attributed, as in the
 * Markdown), then what it is about by name.
 */
function questionCell(q: OpenQuestion, concerns: ReadonlyMap<string, string> | undefined): string {
  const detail = detailText(q);
  const asked = detail === null ? q.text : `${q.text} ${detail}`;
  return `${asked}\n\nBetrifft: ${concerns?.get(q.id) ?? q.subjectLabel}`;
}

/**
 * The CSV export (five columns since M6 S5c-1):
 * {@link OPEN_QUESTION_CSV_COLUMNS}, one row per question in list order,
 * `Antwort` empty for the customer to fill in, or the item's latest note (so
 * a sheet read back again records nothing twice: the identical note is
 * `unchanged`; an outside mark is no note and stays out of the sheet).
 * Informational items (`summary-note`, `descriptive-model`) ask nothing, so
 * the sheet the customer fills in leaves them out (the Markdown and the list
 * keep them). `concerns` names what each item is about (`concernsOf`).
 */
export function renderOpenQuestionsCsv(
  items: readonly OpenQuestion[],
  concerns?: ReadonlyMap<string, string>,
): string {
  const rows: string[][] = [
    [...OPEN_QUESTION_CSV_COLUMNS],
    ...items
      .filter((q) => !isInformationalKind(q.kind))
      .map((q) => [
        q.id,
        OPEN_QUESTION_KIND_LABELS[q.kind],
        questionCell(q, concerns),
        contactText(q.askWho),
        latestNote(q)?.text ?? '',
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
 * the active filters (model or folder, kind, source, contact hint, the state
 * `erledigt` (the name says „offene“ already, so `open` adds nothing; the
 * web's export for the customer sends it, UX2b review), and the groups unless
 * they are the default `ask`, UX2a; at most {@link MAX_FILTER_SLUG}
 * characters), so one export per department or folder says which it is:
 * `offene-fragen-p-finanzen-black-box-partner.csv`.
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
    filter.state === 'answered' ? 'erledigt' : undefined,
    filter.group === undefined || defaultGroups(filter.group)
      ? undefined
      : [...new Set(filter.group)].join('-'),
  ]
    .filter((p) => p !== undefined)
    .map(slug)
    .filter((p) => p !== '');
  const filters = parts.join('-').slice(0, MAX_FILTER_SLUG).replace(/-+$/, '');
  const base = `offene-fragen-${slug(projectKey) || 'projekt'}${filters === '' ? '' : `-${filters}`}`;
  return `${base}.${format === 'csv' ? 'csv' : 'md'}`;
}

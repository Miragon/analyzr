/**
 * The server's rules for the open-questions export (`apps/server/src/domain/open-questions/
 * export.ts`), copied because tools/integrate imports nothing from `apps/` (M6 S6 §2.2):
 * the contact group of an item, its contact line, an agent's attributed reason, the German date,
 * the Markdown escape and the file-name slug. test/interview-questions.test.ts compares each copy
 * with the server's source, so a change there fails here until it is copied again.
 */
import type { OpenQuestion, OpenQuestionAskWho } from '@analyzr/contracts';
import { AGENT_WORDS, isVerbatimSource } from '@analyzr/contracts/open-question-labels';

// ---- copied from apps/server/src/domain/open-questions/export.ts, unchanged ----

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

/** Text as an ASCII slug: umlauts spelled out, other marks dropped, the rest `-`. */
export function slug(text: string): string {
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

// ---- end of the copies ----

/** The group of the items without a contact hint, listed last. */
export const NO_CONTACT = WITHOUT_HINT;

/** The characters {@link escapeMarkdown} puts a backslash before. */
const ESCAPED = /\\([\\`*[\]<|~_&:.@#>+=\-)])/g;

/**
 * Undoes {@link escapeMarkdown} on the lines of one paragraph or list item as the export wrote
 * them: the hard breaks (`  ` at the end of every line but the last) become line breaks again,
 * then every backslash escape its character.
 */
export function unescapeMarkdown(lines: readonly string[]): string {
  return lines
    .map((line, i) => (i < lines.length - 1 && line.endsWith('  ') ? line.slice(0, -2) : line))
    .join('\n')
    .replace(ESCAPED, '$1');
}

/**
 * The interview guide (M6 S6 §2.3): one German Markdown file per selection of contact groups,
 * and next to it its record `<name>.guide.json` (format `analyzr-guide/1`), which lists the same
 * questions with their ids for what follows the interview. Per question: the question verbatim
 * as its heading (`F<n>` numbers it for the conversation), the visible id `q-…` that maps every
 * answer back, the kind and the models, then what the landscape already says (the reason, what
 * it is about, a hold's note and label, the agent's notes, the latest note, the actions in
 * „Offene Fragen“ afterwards), the follow-ups and room for notes. A line is left out when its
 * value is missing; „Die Landkarte kennt in diesem Bereich“ only from the agent's notes (the
 * questions alone do not say what the landscape knows). Every value is Markdown-escaped as the
 * server's export does it. The interviewee is addressed with „du“ (owner decision 31 (2)); the
 * consent part is the neutral checklist of decision 31 (3). Deterministic: the date is the
 * questions file's, never the clock.
 */
import type { GuideNotes } from './notes.ts';
import type { GuideGroup, QuestionItem, QuestionsInput } from './questions.ts';
import { escapeMarkdown } from './server-rules.ts';
import {
  AFTER_INTERVIEW,
  CONSENT_MARKDOWN,
  CONSENT_WITHOUT,
  GUIDE_QUOTES,
  GUIDE_TEXTS as T,
} from './texts.ts';

export const GUIDE_FORMAT = 'analyzr-guide/1';

/** The interviewee's address form: always „du“ (owner decision 31 (2), 2026-10-28). */
export const GUIDE_ADDRESS = 'du';

export interface GuideInput {
  project: { key: string; name: string };
  /** The questions file's date, `YYYY-MM-DD`. */
  date: string;
  input: QuestionsInput;
  /** The groups the guide asks, in the file's order. */
  groups: readonly GuideGroup[];
  /** The questions, in the guide's order (after `--max`). */
  items: readonly QuestionItem[];
  /** How many the selection held before `--max`. */
  total: number;
  notes: GuideNotes | null;
}

/** `27.10.2026` for `2026-10-27`. */
export const germanDate = (date: string): string => {
  const [y, m, d] = date.split('-');
  return `${d}.${m}.${y}`;
};

const plural = (n: number): string => `${n} ${n === 1 ? T.question : T.questionsCount}`;

/** A list item: its continuation lines indented under it. */
const bullet = (label: string, value: string): string =>
  `- ${label}: ${value.replace(/\n/g, '\n  ')}`;

/** A heading's text on one line. */
const oneLine = (text: string): string => text.replace(/\s*[\r\n]+\s*/g, ' ').trim();

const quote = (name: string): string => (/^„.*“$/.test(name) ? name : `„${name}“`);

/** How the head line says the date and the count (the skeleton's placeholders). */
interface HeadTexts {
  date: string;
  count: string;
}

/** The guide with the server's escape and the head line of `g`. */
export function renderGuide(g: GuideInput): string {
  const count =
    g.items.length === g.total
      ? plural(g.items.length)
      : `${g.items.length === 1 ? 'die erste' : `die ersten ${g.items.length}`} von ${plural(g.total)}`;
  return render(g, escapeMarkdown, { date: germanDate(g.date), count });
}

function render(g: GuideInput, escape: (text: string) => string, head: HeadTexts): string {
  const title = g.groups.map((x) => x.label).join('; ');
  const several = g.groups.length > 1;
  // the Markdown export orders by group: several groups follow one another
  const order = several && g.input === 'md' ? T.orderByGroup : T.order;
  const parts = [escape(g.project.name), `${T.source} ${head.date}`, `${head.count} ${order}`];
  if (g.input === 'csv') parts.push(T.fromCsv);
  const lines: string[] = [
    `# ${T.title}: ${escape(title)}`,
    '',
    parts.join(' · '),
    '',
    `## ${T.before}`,
    '',
    CONSENT_MARKDOWN,
    '',
    CONSENT_WITHOUT,
    '',
    `## ${T.intro}`,
    '',
    `„${GUIDE_QUOTES.intro}“`,
    '',
    `## ${T.questions}`,
  ];
  g.items.forEach((q, i) => {
    const notes = g.notes?.questions.get(q.id);
    const meta = [`\`${q.id}\``];
    if (q.kindLabel !== '') meta.push(escape(q.kindLabel));
    if (q.modelKeys.length > 0) {
      meta.push(
        `${q.modelKeys.length === 1 ? T.model : T.models} ${q.modelKeys.map((k) => `\`${k}\``).join(', ')}`,
      );
    }
    lines.push('', `### F${i + 1}. ${escape(oneLine(q.text))}`, '', meta.join(' · '), '');
    if (q.detail !== null) lines.push(bullet(T.why, escape(q.detail)));
    if (q.subjectLabel !== '') lines.push(bullet(T.concerns, escape(q.subjectLabel)));
    if (several && q.contact !== '') lines.push(bullet(T.contact, escape(q.contact)));
    if (q.context !== null) lines.push(bullet(T.holdNote, escape(q.context)));
    if (q.label !== null) lines.push(bullet(T.hold, escape(q.label)));
    if (notes?.landscape != null) lines.push(bullet(T.landscape, escape(notes.landscape)));
    if (q.latestNote !== null) {
      const when = q.latestNote.date === null ? '' : ` (${q.latestNote.date})`;
      lines.push(bullet(`${T.noted}${when}`, escape(q.latestNote.text)));
    }
    if (q.actions.length > 0) {
      const label = q.actions.length === 1 ? T.next : T.nextEither;
      const quoted = q.actions.map((a) => `„${escape(a)}“`);
      const choices =
        quoted.length < 2
          ? quoted.join('')
          : `${quoted.slice(0, -1).join(', ')} ${T.or} ${quoted.at(-1) ?? ''}`;
      lines.push(bullet(label, choices));
    }
    if (notes !== undefined && notes.followUps.length > 0) {
      lines.push(`- ${T.followUps}:`, ...notes.followUps.map((f) => `  - ${escape(f)}`));
    }
    lines.push(`- ${T.notes}:`);
  });
  const known = g.notes?.known ?? [];
  lines.push('', `## ${T.unmodelled}`, '', `„${GUIDE_QUOTES.unmodelled}“`);
  if (known.length > 0) {
    lines.push('', `${T.known}: ${known.map((k) => escape(quote(k))).join(', ')}`);
  }
  lines.push('', `## ${T.closing}`, '', `„${GUIDE_QUOTES.closing}“`, '', AFTER_INTERVIEW);
  return `${lines.join('\n')}\n`;
}

/** Where the guide's files lie and what it was made from, for its record. */
export interface GuideFiles {
  /** Relative to the workspace, `/`-separated. */
  questionsFile: string;
  sha256: string;
  guide: string;
  notes: string | null;
  max: number | null;
}

/** The record `<name>.guide.json` (`analyzr-guide/1`). */
export function guideRecord(g: GuideInput, files: GuideFiles): string {
  const slugOf = new Map<string | null, string>(g.groups.map((x) => [x.key, x.slug]));
  const record = {
    format: GUIDE_FORMAT,
    project: g.project,
    date: g.date,
    address: GUIDE_ADDRESS,
    input: g.input,
    questionsFile: files.questionsFile,
    sha256: files.sha256,
    guide: files.guide,
    notes: files.notes,
    groups: g.groups.map((x) => ({ slug: x.slug, label: x.label })),
    total: g.total,
    max: files.max,
    questions: g.items.map((q, i) => ({
      n: i + 1,
      id: q.id,
      kind: q.kind,
      kindLabel: q.kindLabel,
      text: q.text,
      detail: q.detail,
      subjectLabel: q.subjectLabel,
      contact: q.contact,
      group: slugOf.get(q.groupLabel) ?? null,
      modelKeys: q.modelKeys,
      unlocks: q.unlocks,
      primaryAction: q.primaryAction,
      actions: q.actions,
      latestNote: q.latestNote,
    })),
  };
  return `${JSON.stringify(record, null, 2)}\n`;
}

/**
 * The guide's structure with placeholders, for a Desktop chat that writes the guide itself from
 * the Markdown export (the start prompt `start-prompt-interview-guide.de.md` inserts it as
 * `{{text:guide-skeleton}}`): the same headings, checklist, quotes and lines as {@link
 * renderGuide} gives for a question of the Markdown export with every line, from the same code.
 */
export function guideSkeleton(): string {
  const item: QuestionItem = {
    id: 'q-…',
    kind: null,
    kindLabel: '<Art>',
    group: null,
    state: 'open',
    text: '<Frage, wörtlich>',
    detail: '<Begründung, wörtlich>',
    subjectLabel: '<Betrifft, wörtlich>',
    subjectType: null,
    context: '<Notiz zur Vormerkung, wörtlich>',
    label: '<Vormerkung, wörtlich>',
    contact: '',
    groupLabel: '<Ansprechpartner>',
    modelKeys: [],
    unlocks: null,
    block: null,
    primaryAction: null,
    actions: [],
    latestNote: { text: '<letzte Notiz, wörtlich>', date: '<Datum>' },
    informational: false,
  };
  const guide = render(
    {
      project: { key: '', name: '<Projekt>' },
      date: '',
      input: 'md',
      groups: [{ slug: '', label: '<Ansprechpartner>', key: '<Ansprechpartner>' }],
      items: [item],
      total: 1,
      notes: {
        known: ['<Prozess>', '<Prozess>'],
        questions: new Map([
          [
            item.id,
            { landscape: '<höchstens zwei Sätze>', followUps: ['<bis zu drei Nachfragen>'] },
          ],
        ]),
      },
    },
    (text) => text,
    { date: '<Datum der Datei>', count: `<Anzahl> ${T.questionsCount}` },
  );
  return guide.replace(/\n+$/, '');
}

/**
 * The open questions an interview guide is made from (M6 S6 §2.1, §2.2), read from a file in
 * the workspace, in order of preference: the CLI's `questions list --format json` (all fields),
 * the web's Markdown export („Zum Lesen (Markdown)“: the server's groups, question and reason
 * apart, „Betrifft“ with names, no `unlocks`, refs or actions) or its CSV („Zum Ausfüllen (CSV)“:
 * question and reason in one cell, the contact cell joining owners and lanes). Each becomes the
 * same {@link QuestionItem}; the guide then groups, selects and renders them deterministically.
 *
 * Grouping follows the server's Markdown export (`askWhoGroup`, `server-rules.ts`): the step
 * owners, else the lanes, else „Ohne Ansprechpartner“; groups in order of their first item, that
 * one last. A group is chosen by its slug ({@link GuideGroup.slug}: the label as ASCII, the
 * server's file-name rule), never by its label, so no lane or org-unit name of the customer's
 * models is ever an argument on a command line. The input's order is kept, never re-sorted, also
 * across several groups: the list puts the questions first, then the value chain's findings,
 * then informational items, each by `unlocks` (the most open decisions first). The Markdown
 * export orders by group, so from it several groups follow one another.
 *
 * Nothing here echoes the file's content in an error: errors name the item and the field.
 */
import type { OpenQuestion, OpenQuestionKind } from '@analyzr/contracts';
import {
  CONTACT_COLUMNS,
  CsvError,
  parseOpenQuestionsCsv,
} from '@analyzr/contracts/open-question-csv';
import {
  HOLD_ANSWER_LABEL,
  isInformationalKind,
  OPEN_QUESTION_ANSWER_ROLE_LABELS,
  OPEN_QUESTION_KIND_LABELS,
} from '@analyzr/contracts/open-question-labels';
import { isModelKey } from '@analyzr/contracts/paths';

import {
  askWhoGroup,
  contactText,
  detailText,
  formatDateDe,
  NO_CONTACT,
  slug,
  unescapeMarkdown,
} from './server-rules.ts';
import { MD_INFORMATIONAL, MD_WITHDRAWN, TECHNICAL_KINDS } from './texts.ts';

/** The three inputs, by file extension. */
export type QuestionsInput = 'json' | 'md' | 'csv';

/** The input of a file name (`.json`, `.md`, `.csv`), or `null`. */
export function inputOf(file: string): QuestionsInput | null {
  const m = /\.(json|md|csv)$/i.exec(file);
  return m ? (m[1]?.toLowerCase() as QuestionsInput) : null;
}

/** One open question as the guide needs it, whatever the input. */
export interface QuestionItem {
  id: string;
  /** The kind; `null` for a label this version does not know (Markdown, CSV). */
  kind: OpenQuestionKind | null;
  /** The kind's German label (the export's „Art“). */
  kindLabel: string;
  /**
   * The server's group (`ask`, `agent`, …); from Markdown and CSV, which do not state it, the
   * kind's (`agent` for an agent's question, `info` for an informational item), else `null`.
   */
  group: string | null;
  /** `answered`: a live outside mark; `null` where the input does not say (CSV). */
  state: 'open' | 'answered' | null;
  /** The question; from CSV the question and its reason in one paragraph. */
  text: string;
  /** The reason (an agent's attributed, „Laut Agent: …“); `null` without one and from CSV. */
  detail: string | null;
  /** What it is about: JSON's subject label, the exports' „Betrifft“ (names and pools). */
  subjectLabel: string;
  /** The subject's type (`process`, `model`, …); JSON only. */
  subjectType: string | null;
  /** A hold's note („Notiz zur Vormerkung“) and label („Vormerkung“). */
  context: string | null;
  label: string | null;
  /** The contact line (owners, then lanes), `''` without one. */
  contact: string;
  /** The contact group's label (`Organisationseinheit Lager`), `null` for „Ohne Ansprechpartner“. */
  groupLabel: string | null;
  /** The models it touches; JSON only. */
  modelKeys: string[];
  /** Open decisions it unlocks; JSON only. */
  unlocks: number | null;
  /** The list's block: 0 questions, 1 the value chain's findings, 2 informational; JSON only. */
  block: number | null;
  /** The label of its primary action („Liegt außerhalb der Landschaft“); JSON only. */
  primaryAction: string | null;
  /** The labels of its actions in „Offene Fragen“ but the note's, in display order; JSON only. */
  actions: string[];
  /** The latest note, with its German date (`null` from CSV). */
  latestNote: { text: string; date: string | null } | null;
  /** It asks nothing (a summary, a descriptive model). */
  informational: boolean;
}

/** A contact group of a questions file. */
export interface GuideGroup {
  /** ASCII, `-`-separated, unique in the file: what `guide --group` takes. */
  slug: string;
  /** As the export heads it: `Organisationseinheit Lager`, `Lanes Disposition, Versand`. */
  label: string;
  /** `null` for „Ohne Ansprechpartner“. */
  key: string | null;
}

/** A problem with a questions file: what and where, never its content. */
export interface QuestionsProblem {
  code: string;
  message: string;
}

export class QuestionsError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'QuestionsError';
    this.code = code;
  }
}

/** A questions file as read. */
export interface QuestionsFile {
  input: QuestionsInput;
  items: QuestionItem[];
  /** Every group of the file, in order of its first item, „Ohne Ansprechpartner“ last. */
  groups: GuideGroup[];
  /** The project's name the Markdown export's title gives; `null` otherwise. */
  projectName: string | null;
  warnings: QuestionsProblem[];
}

const ID = /^q-[0-9a-f]{16}$/;

/** Kind by its German label. */
const KIND_BY_LABEL = new Map<string, OpenQuestionKind>(
  Object.entries(OPEN_QUESTION_KIND_LABELS).map(([kind, label]) => [
    label,
    kind as OpenQuestionKind,
  ]),
);

/** Longest group slug. */
export const MAX_SLUG = 60;

/**
 * The groups of `items` in order of their first item, „Ohne Ansprechpartner“ last, each with a
 * slug of its label (the server's file-name rule), unique in the file with `-2`, `-3` …
 */
export function groupsOf(items: readonly QuestionItem[]): GuideGroup[] {
  const seen = new Set<string | null>();
  for (const item of items) seen.add(item.groupLabel);
  const ordered = [...seen].sort((a, b) => (a === null ? 1 : 0) - (b === null ? 1 : 0));
  const taken = new Set<string>();
  const next = new Map<string, number>();
  return ordered.map((key) => {
    const base =
      slug(key ?? NO_CONTACT)
        .slice(0, MAX_SLUG)
        .replace(/-+$/, '') || 'gruppe';
    let candidate = base;
    if (taken.has(candidate)) {
      let n = next.get(base) ?? 2;
      while (taken.has(`${base}-${n}`)) n++;
      candidate = `${base}-${n}`;
      next.set(base, n + 1);
    }
    taken.add(candidate);
    return { slug: candidate, label: key ?? NO_CONTACT, key };
  });
}

// ------------------------------------------------------------------- JSON

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');
const isNullableString = (v: unknown): v is string | null => v === null || typeof v === 'string';

type JsonQuestion = Pick<
  OpenQuestion,
  | 'id'
  | 'kind'
  | 'source'
  | 'group'
  | 'subject'
  | 'subjectLabel'
  | 'modelKeys'
  | 'text'
  | 'detail'
  | 'context'
  | 'label'
  | 'askWho'
  | 'unlocks'
  | 'state'
  | 'answers'
  | 'actions'
>;

/** Checks one item of the CLI's JSON; the problem names the field, never its value. */
function checkJsonItem(v: unknown, n: number): JsonQuestion {
  const bad = (field: string, what: string): never => {
    throw new QuestionsError('json-item', `item ${n}: ${field} ${what}`);
  };
  if (!isRecord(v)) return bad('', 'is no object');
  if (typeof v['id'] !== 'string' || !ID.test(v['id'])) bad('id', 'is no open question id (q-…)');
  for (const f of ['kind', 'source', 'group', 'subjectLabel', 'text', 'state'] as const) {
    if (typeof v[f] !== 'string') bad(f, 'is no text');
  }
  for (const f of ['detail', 'context', 'label'] as const) {
    if (!isNullableString(v[f])) bad(f, 'is neither text nor null');
  }
  const subject = v['subject'];
  if (
    !isRecord(subject) ||
    typeof subject['type'] !== 'string' ||
    typeof subject['id'] !== 'string'
  ) {
    bad('subject', 'is no {type, id}');
  }
  if (!isStrings(v['modelKeys']) || !v['modelKeys'].every(isModelKey)) {
    bad('modelKeys', 'is no list of model keys');
  }
  const askWho = v['askWho'];
  if (
    !isRecord(askWho) ||
    !isStrings(askWho['lanes']) ||
    !isStrings(askWho['stepOwners']) ||
    !isNullableString(askWho['folder'])
  ) {
    bad('askWho', 'is no {lanes, stepOwners, folder}');
  }
  if (!Number.isInteger(v['unlocks']) || (v['unlocks'] as number) < 0)
    bad('unlocks', 'is no count');
  const answers = v['answers'];
  if (
    !Array.isArray(answers) ||
    !answers.every(
      (a) =>
        isRecord(a) &&
        typeof a['role'] === 'string' &&
        isNullableString(a['text']) &&
        typeof a['at'] === 'string' &&
        !Number.isNaN(Date.parse(a['at'])),
    )
  ) {
    bad('answers', 'is no list of answers');
  }
  const actions = v['actions'];
  if (
    !Array.isArray(actions) ||
    !actions.every(
      (a) =>
        isRecord(a) &&
        typeof a['type'] === 'string' &&
        typeof a['primary'] === 'boolean' &&
        typeof a['label'] === 'string',
    )
  ) {
    bad('actions', 'is no list of actions');
  }
  return v as unknown as JsonQuestion;
}

/** The list's block of an item (the server's `rankGroup`). */
function blockOf(q: Pick<OpenQuestion, 'kind' | 'source'>): number {
  if (isInformationalKind(q.kind)) return 2;
  return q.source === 'value-chain-finding' ? 1 : 0;
}

/** Reads the CLI's `questions list --format json` (an array; an API page's `items` too). */
export function readQuestionsJson(text: string): QuestionsFile {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    // (the parser's message may quote the file)
    throw new QuestionsError(
      'json',
      'not valid JSON: write it with analyzr questions list --format json',
    );
  }
  const list = Array.isArray(value) ? value : isRecord(value) ? value['items'] : undefined;
  if (!Array.isArray(list)) {
    throw new QuestionsError(
      'json',
      'not a list of open questions (analyzr questions list --format json)',
    );
  }
  const warnings: QuestionsProblem[] = [];
  const items = list.map((raw, i): QuestionItem => {
    const q = checkJsonItem(raw, i + 1);
    const known = Object.hasOwn(OPEN_QUESTION_KIND_LABELS, q.kind);
    const note = q.answers.findLast((a) => a.role === 'note');
    const primary = q.actions.find((a) => a.primary);
    const groupLabel = askWhoGroup(q.askWho);
    return {
      id: q.id,
      kind: known ? q.kind : null,
      kindLabel: known ? OPEN_QUESTION_KIND_LABELS[q.kind] : q.kind,
      group: q.group,
      state: q.state === 'answered' ? 'answered' : 'open',
      text: q.text,
      detail: detailText(q),
      subjectLabel: q.subjectLabel,
      subjectType: q.subject.type,
      context: q.context,
      label: q.label,
      contact: contactText(q.askWho),
      groupLabel,
      modelKeys: [...q.modelKeys],
      unlocks: q.unlocks,
      block: blockOf(q),
      primaryAction: primary?.label ?? null,
      actions: q.actions.filter((a) => a.type !== 'note').map((a) => a.label),
      latestNote:
        note === undefined || note.text === null
          ? null
          : { text: note.text, date: formatDateDe(note.at) },
      informational: known ? isInformationalKind(q.kind) : false,
    };
  });
  const unknown = items.filter((q) => q.kind === null).length;
  if (unknown > 0) {
    warnings.push({
      code: 'kind-unknown',
      message: `${unknown} item(s) of a kind this script does not know: the guide shows its name as the kind`,
    });
  }
  // the server's order: blocks ascending, unlocks descending in each (a hand-edited file breaks it)
  for (let i = 1; i < items.length; i++) {
    const [a, b] = [items[i - 1], items[i]];
    if (a === undefined || b === undefined || a.block === null || b.block === null) continue;
    if (b.block < a.block || (b.block === a.block && (b.unlocks ?? 0) > (a.unlocks ?? 0))) {
      warnings.push({
        code: 'order-unexpected',
        message: `item ${i + 1} (${b.id}) is not in the order analyzr lists the questions in; the guide keeps the file's order`,
      });
      break;
    }
  }
  return finish('json', items, null, warnings);
}

/**
 * The group the exports do not state, where the kind gives it: an agent's question on its
 * proposal is always `agent`, an informational item `info` (the contracts' `OpenQuestionGroup`);
 * every other item counts as one to clarify.
 */
function groupOfKind(kind: OpenQuestionKind | null, informational: boolean): string | null {
  if (kind === 'agent-question') return 'agent';
  return informational ? 'info' : null;
}

// --------------------------------------------------------------- Markdown

const ROLE_LABELS = new Set([
  OPEN_QUESTION_ANSWER_ROLE_LABELS.note,
  OPEN_QUESTION_ANSWER_ROLE_LABELS['outside-mark'],
  HOLD_ANSWER_LABEL,
]);
const ANSWER = new RegExp(
  `^(.+?) \\((\\d\\d\\.\\d\\d\\.\\d{4})(, ${MD_WITHDRAWN} am \\d\\d\\.\\d\\d\\.\\d{4})?\\)(?:: )?`,
);

/** The Markdown export's line for an export of no questions. */
const NO_QUESTIONS = 'Keine offenen Fragen.';

interface MarkdownItem {
  heading: string;
  number: number;
  group: string | null;
  body: string[];
}

/**
 * Reads the web's Markdown export („Zum Lesen (Markdown)“, the server's
 * `renderOpenQuestionsMarkdown`): its `## ` groups, per item the heading „<n>. <Art>:
 * <Betreff>“, the id as `<!-- q-… -->` right after it, the question and its reason as
 * paragraphs, then the list („Betrifft“, the hold's note and label, the notes and marks with
 * their dates, „Ansprechpartner“). Refuses a file whose items carry no ids; an export of no
 * questions („Keine offenen Fragen.“) reads as an empty file.
 */
export function readQuestionsMarkdown(text: string): QuestionsFile {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const title = /^# Offene Fragen: (.*)$/.exec(lines[0] ?? '');
  const raw: MarkdownItem[] = [];
  let group: string | null = null;
  let current: MarkdownItem | null = null;
  for (const line of lines) {
    const g = /^## (.*)$/.exec(line);
    if (g) {
      const label = unescapeMarkdown([g[1] ?? '']);
      group = label === NO_CONTACT ? null : label;
      current = null;
      continue;
    }
    const h = /^### (\d+)\. (.*)$/.exec(line);
    if (h) {
      current = { heading: h[2] ?? '', number: Number(h[1]), group, body: [] };
      raw.push(current);
      continue;
    }
    current?.body.push(line);
  }
  if (raw.length === 0 && title !== null && lines.includes(NO_QUESTIONS)) {
    return finish('md', [], unescapeMarkdown([title[1] ?? '']), []);
  }
  if (raw.length === 0) {
    throw new QuestionsError(
      'md-no-ids',
      `no open question with its id: export the Markdown in the web, ${'„Offene Fragen“ › „Für den Kunden exportieren …“ › „Zum Lesen (Markdown)“'}`,
    );
  }
  const items = raw.map((m) => markdownItem(m));
  return finish('md', items, title ? unescapeMarkdown([title[1] ?? '']) : null, []);
}

function markdownItem(m: MarkdownItem): QuestionItem {
  const where = `item ${m.number}`;
  const [idLine = '', ...rest] = m.body;
  const id = /^<!-- (q-[0-9a-f]{16}) -->$/.exec(idLine)?.[1];
  if (id === undefined) {
    throw new QuestionsError(
      'md-id-missing',
      `${where} has no id (<!-- q-… --> right after its heading): only the web's Markdown export carries them`,
    );
  }
  // blocks separated by empty lines (a hard break's empty line is "  ", not empty)
  const blocks: string[][] = [];
  let block: string[] = [];
  for (const line of rest) {
    if (line === '') {
      if (block.length > 0) blocks.push(block);
      block = [];
    } else block.push(line);
  }
  if (block.length > 0) blocks.push(block);
  const paragraphs = blocks.filter((b) => !b[0]?.startsWith('- '));
  const list = blocks.find((b) => b[0]?.startsWith('- ')) ?? [];
  const [question, reason] = paragraphs;
  if (question === undefined) {
    throw new QuestionsError('md-question-missing', `${where} has no question`);
  }
  // bullets with their continuation lines
  const bullets: string[][] = [];
  for (const line of list) {
    if (line.startsWith('- ')) bullets.push([line.slice(2)]);
    else bullets.at(-1)?.push(line);
  }
  const kindLabel = [...KIND_BY_LABEL.keys()]
    .filter((label) => m.heading.startsWith(`${label}: `))
    .sort((a, b) => b.length - a.length)[0];
  const headSubject = kindLabel === undefined ? m.heading : m.heading.slice(kindLabel.length + 2);
  const kind = kindLabel === undefined ? null : (KIND_BY_LABEL.get(kindLabel) ?? null);
  let subjectLabel = unescapeMarkdown([headSubject]);
  let context: string | null = null;
  let label: string | null = null;
  let contact = '';
  let informational = kind !== null && isInformationalKind(kind);
  let latestNote: QuestionItem['latestNote'] = null;
  let answered = false;
  const value = (b: string[], prefix: string): string | null =>
    b[0]?.startsWith(prefix) ? unescapeMarkdown([b[0].slice(prefix.length), ...b.slice(1)]) : null;
  for (const b of bullets) {
    const concerns = value(b, 'Betrifft: ');
    if (concerns !== null) subjectLabel = concerns;
    context = value(b, 'Notiz zur Vormerkung: ') ?? context;
    label = value(b, 'Vormerkung: ') ?? label;
    contact = value(b, 'Ansprechpartner: ') ?? contact;
    if (b[0] === MD_INFORMATIONAL) informational = true;
    const a = ANSWER.exec(b[0] ?? '');
    if (a && ROLE_LABELS.has(a[1] ?? '')) {
      const role = a[1];
      const text = unescapeMarkdown([(b[0] ?? '').slice(a[0].length), ...b.slice(1)]);
      if (role === OPEN_QUESTION_ANSWER_ROLE_LABELS['outside-mark']) {
        if (a[3] === undefined) answered = true;
      } else if (text !== '') {
        latestNote = { text, date: a[2] ?? null };
      }
    }
  }
  return {
    id,
    kind,
    kindLabel: kindLabel ?? unescapeMarkdown([m.heading.split(': ')[0] ?? m.heading]),
    group: groupOfKind(kind, informational),
    state: answered ? 'answered' : 'open',
    text: unescapeMarkdown(question),
    detail: reason === undefined ? null : unescapeMarkdown(reason),
    subjectLabel,
    subjectType: null,
    context,
    label,
    contact,
    groupLabel: m.group,
    modelKeys: [],
    unlocks: null,
    block: null,
    primaryAction: null,
    actions: [],
    latestNote,
    informational,
  };
}

// -------------------------------------------------------------------- CSV

/** Separates the CSV's `Frage` cell: the question with its reason, then „Betrifft“. */
const CONCERNS = '\n\nBetrifft: ';

/**
 * Reads the web's CSV („Zum Ausfüllen (CSV)“, five columns; an older sheet with
 * „Ansprechpartner-Hinweis“ and „Antwortart“ too), as a spreadsheet may have saved it again.
 * The group is the contact cell as written, empty „Ohne Ansprechpartner“; the `Antwort` cell,
 * if filled, is the latest note (without a date).
 */
export function readQuestionsCsv(text: string): QuestionsFile {
  let parsed: ReturnType<typeof parseOpenQuestionsCsv>;
  try {
    parsed = parseOpenQuestionsCsv(text);
  } catch (err) {
    if (err instanceof CsvError) {
      throw new QuestionsError(`csv-${err.code}`, `the CSV cannot be read: ${err.message}`);
    }
    throw err;
  }
  const { header, rows, lines } = parsed;
  const column = (name: string) => header.findIndex((h) => h.trim() === name);
  const id = column('id');
  const question = column('Frage');
  const kindColumn = column('Art');
  const answer = column('Antwort');
  const contactColumn = CONTACT_COLUMNS.map(column).find((c) => c >= 0) ?? -1;
  if (id < 0 || question < 0 || contactColumn < 0) {
    throw new QuestionsError(
      'csv-columns',
      'the CSV lacks the column "id", "Frage" or "Ansprechpartner" of the export',
    );
  }
  const items = rows.map((r, i): QuestionItem => {
    const where = `row ${lines[i] ?? i + 2}`;
    const qid = (r[id] ?? '').trim();
    if (!ID.test(qid))
      throw new QuestionsError('csv-id', `${where}: no open question id (q-…) in "id"`);
    const cell = (r[question] ?? '').replace(/\r\n?/g, '\n');
    const at = cell.lastIndexOf(CONCERNS);
    const asked = (at < 0 ? cell : cell.slice(0, at)).trim();
    if (asked === '')
      throw new QuestionsError('csv-question', `${where}: the cell "Frage" is empty`);
    const label = kindColumn < 0 ? '' : (r[kindColumn] ?? '').trim();
    const kind = KIND_BY_LABEL.get(label) ?? null;
    const contact = (r[contactColumn] ?? '').trim();
    const note = answer < 0 ? '' : (r[answer] ?? '').replace(/\r\n?/g, '\n').trim();
    return {
      id: qid,
      kind,
      kindLabel: label,
      group: groupOfKind(kind, kind !== null && isInformationalKind(kind)),
      state: null,
      text: asked,
      detail: null,
      subjectLabel: at < 0 ? '' : cell.slice(at + CONCERNS.length).trim(),
      subjectType: null,
      context: null,
      label: null,
      contact,
      groupLabel: contact === '' ? null : contact,
      modelKeys: [],
      unlocks: null,
      block: null,
      primaryAction: null,
      actions: [],
      latestNote: note === '' ? null : { text: note, date: null },
      informational: kind !== null && isInformationalKind(kind),
    };
  });
  return finish('csv', items, null, []);
}

function finish(
  input: QuestionsInput,
  items: QuestionItem[],
  projectName: string | null,
  warnings: QuestionsProblem[],
): QuestionsFile {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) {
      throw new QuestionsError('duplicate-id', `the id ${item.id} appears twice`);
    }
    ids.add(item.id);
  }
  return { input, items, groups: groupsOf(items), projectName, warnings };
}

/** Reads a questions file's text by its input. */
export function readQuestions(input: QuestionsInput, text: string): QuestionsFile {
  switch (input) {
    case 'json':
      return readQuestionsJson(text);
    case 'md':
      return readQuestionsMarkdown(text);
    case 'csv':
      return readQuestionsCsv(text);
  }
}

// -------------------------------------------------------------- selection

/** Which items a guide may ask. */
export interface SelectOptions {
  /** Also the agents' questions on their proposals (`group: agent`). */
  includeAgent?: boolean;
}

/** Why a guide leaves an item out. */
export type LeftOutReason = 'informational' | 'answered' | 'technical' | 'agent' | 'proposal';

const TECHNICAL = new Set<OpenQuestionKind>(TECHNICAL_KINDS);

/** Why an item is left out of every guide, or `null` when a guide may ask it. */
export function leftOutReason(
  item: QuestionItem,
  options: SelectOptions = {},
): LeftOutReason | null {
  if (item.informational || item.group === 'info') return 'informational';
  if (item.state === 'answered') return 'answered';
  if (item.kind !== null && TECHNICAL.has(item.kind)) return 'technical';
  if (item.group === null || item.group === 'ask') return null;
  if (item.group === 'agent') return options.includeAgent === true ? null : 'agent';
  return 'proposal';
}

/** A group with the count of the questions a guide may ask in it. */
export interface GroupCount extends GuideGroup {
  count: number;
}

/** The groups that hold a question a guide may ask, with their counts. */
export function countGroups(file: QuestionsFile, options: SelectOptions = {}): GroupCount[] {
  const counts = new Map<string | null, number>();
  for (const q of file.items) {
    if (leftOutReason(q, options) === null) {
      counts.set(q.groupLabel, (counts.get(q.groupLabel) ?? 0) + 1);
    }
  }
  return file.groups
    .map((g) => ({ ...g, count: counts.get(g.key) ?? 0 }))
    .filter((g) => g.count > 0);
}

/** What a file holds that no guide asks, by reason. */
export function leftOutCounts(
  file: QuestionsFile,
  options: SelectOptions = {},
): Record<LeftOutReason, number> {
  const out = { informational: 0, answered: 0, technical: 0, agent: 0, proposal: 0 };
  for (const q of file.items) {
    const reason = leftOutReason(q, options);
    if (reason !== null) out[reason]++;
  }
  return out;
}

/**
 * The questions of the groups `slugs` names, in the file's order, never re-sorted (the most open
 * decisions first, across the groups too), and those groups in the file's order (of their first
 * item, „Ohne Ansprechpartner“ last).
 *
 * @throws {QuestionsError} for a slug the file has no group for
 */
export function selectQuestions(
  file: QuestionsFile,
  slugs: readonly string[],
  options: SelectOptions = {},
): { groups: GuideGroup[]; items: QuestionItem[] } {
  const unknown = slugs.filter((s) => !file.groups.some((g) => g.slug === s));
  if (unknown.length > 0) {
    throw new QuestionsError(
      'group-unknown',
      `no group ${unknown.join(', ')} in this file; its groups: ${file.groups.map((g) => g.slug).join(', ') || 'none'}`,
    );
  }
  const groups = file.groups.filter((g) => slugs.includes(g.slug));
  const keys = new Set(groups.map((g) => g.key));
  const items = file.items.filter(
    (q) => keys.has(q.groupLabel) && leftOutReason(q, options) === null,
  );
  return { groups, items };
}

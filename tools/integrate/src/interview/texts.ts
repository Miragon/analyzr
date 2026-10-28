/**
 * The fixed German texts of the interview guide (M6 S6 §2.3, §6.3): one source for the guide
 * renderer (`guide.ts`), the questions reader (`questions.ts`: the Markdown export's markers),
 * the skills and the Claude Desktop start prompts, which insert them as `{{text:<id>}}` ({@link
 * TEXT_CONSTANTS}, scripts/texts.ts). The guide addresses the customer's interviewees with „du“
 * (owner decision 31 (2), 2026-10-28: always, no switch); its headings and labels are nouns, and
 * the consent part is the neutral checklist of decision 31 (3). Everything said to the
 * consultant uses „du“ as well (AGENTS.md). The texts that must read as analyzr's server and web
 * write them (the export's markers, the web's labels) are compared with their sources by
 * test/texts.test.ts.
 */
import type { OpenQuestionKind } from '@analyzr/contracts';
import {
  OPEN_QUESTION_ANSWER_ROLE_LABELS,
  OPEN_QUESTION_KIND_LABELS,
} from '@analyzr/contracts/open-question-labels';

/** The headings and labels of a guide. */
export const GUIDE_TEXTS = {
  title: 'Interviewleitfaden',
  before: 'Vor dem Gespräch',
  intro: 'Einstieg',
  questions: 'Fragen',
  unmodelled: 'Abläufe ohne Modell',
  closing: 'Abschluss',
  why: 'Warum wir fragen',
  concerns: 'Betrifft',
  holdNote: 'Notiz zur Vormerkung',
  hold: 'Vormerkung',
  landscape: 'Was die Landkarte schon sagt',
  noted: 'Bisher notiert',
  next: 'In „Offene Fragen“ danach',
  nextEither: 'In „Offene Fragen“ danach, je nach Antwort',
  or: 'oder',
  contact: 'Ansprechpartner',
  followUps: 'Nachfragen',
  notes: 'Notizen',
  model: 'Modell',
  models: 'Modelle',
  known: 'Die Landkarte kennt in diesem Bereich',
  source: 'offene Fragen aus analyzr vom',
  question: 'Frage',
  questionsCount: 'Fragen',
  order: 'in der Reihenfolge von „Offene Fragen“ (die mit der größten Wirkung zuerst)',
  orderByGroup:
    'je Ansprechpartner in der Reihenfolge von „Offene Fragen“ (die mit der größten Wirkung zuerst)',
  fromCsv:
    'aus der CSV: Frage und Begründung stehen zusammen, die Gruppen folgen der Spalte „Ansprechpartner“',
} as const;

/**
 * The consent checklist before the interview (owner decision 31 (3)): neutral, for the
 * interviewer to tick; what the interviewee agrees to: a recording or notes, the evaluation with
 * an AI assistant after the names are replaced, the result in analyzr without names.
 */
export const CONSENT_CHECKLIST: readonly string[] = [
  'Einverständnis eingeholt: Aufzeichnung oder Mitschrift, Auswertung mit einem KI-Assistenten (Namen vorher ersetzt), Ergebnis in analyzr ohne Namen',
  'Gesprächspartner nur mit ihrer Rolle notiert, ohne Namen',
];

/** What holds when the interviewee agrees to less (under the checklist). */
export const CONSENT_WITHOUT =
  'Ohne Einverständnis zur Aufzeichnung: nur eine Mitschrift. Ohne Einverständnis zur Auswertung mit einem KI-Assistenten: Transkript und Mitschrift nicht unter `transcripts/` ablegen und keinem KI-Assistenten geben; die Antworten dann von Hand in analyzr eintragen.';

/** After the interview (under „Abschluss“). */
export const AFTER_INTERVIEW =
  'Nach dem Gespräch: Transkript (VTT oder Text) oder Mitschrift im Workspace unter `transcripts/` ablegen, ohne Namen im Dateinamen; die Aufnahme selbst bleibt in Teams, Zoom oder Webex. Solange Namen darin stehen, geht es an keinen KI-Assistenten.';

/** What the interviewer says, in „du“ (decision 31 (2)). */
export const GUIDE_QUOTES = {
  intro:
    'Danke, dass du dir die Zeit nimmst. Wir möchten verstehen, wie die Abläufe in deinem Bereich heute tatsächlich laufen, auch dort, wo noch nichts aufgeschrieben ist. Es gibt keine falschen Antworten.',
  unmodelled:
    'Welche Abläufe in deinem Bereich haben wir noch nicht angesprochen? Wie beginnen sie, wer ist beteiligt, und wie enden sie?',
  closing:
    'Dürfen wir uns melden, wenn beim Zusammenfassen noch etwas offen ist? Wir schicken dir die Zusammenfassung zum Gegenlesen.',
} as const;

/** The consent checklist as the guide prints it (GFM task list items). */
export const CONSENT_MARKDOWN = CONSENT_CHECKLIST.map((line) => `- [ ] ${line}`).join('\n');

// ------------------------------------------------- the web's and the export's words

/** The web's button of the exports for the customer („Offene Fragen“). */
export const WEB_EXPORT_BUTTON = 'Für den Kunden exportieren …';
/** The export dialog's two formats. */
export const WEB_EXPORT_MARKDOWN = 'Zum Lesen (Markdown)';
export const WEB_EXPORT_CSV = 'Zum Ausfüllen (CSV)';
/** The web's button that reads a filled-in sheet back. */
export const WEB_ANSWERS_BUTTON = 'Antworten aus CSV übernehmen …';

/** The web's way to the Markdown export of the open questions. */
export const WEB_MARKDOWN_EXPORT = `„Offene Fragen“ › „${WEB_EXPORT_BUTTON}“ › „${WEB_EXPORT_MARKDOWN}“`;

/** The web's way to the CSV export. */
export const WEB_CSV_EXPORT = `„Offene Fragen“ › „${WEB_EXPORT_BUTTON}“ › „${WEB_EXPORT_CSV}“`;

/** The Markdown export's line of an informational item. */
export const MD_INFORMATIONAL = 'Zur Information, keine Antwort nötig';
/** The Markdown export's word for a withdrawn note or mark („…, zurückgenommen am <Datum>“). */
export const MD_WITHDRAWN = 'zurückgenommen';
/** The Markdown export's label of a live outside mark. */
export const MD_OUTSIDE_MARK = OPEN_QUESTION_ANSWER_ROLE_LABELS['outside-mark'];

/**
 * The kinds no interviewee answers: work for the consultant in analyzr (a model to export again,
 * pairs the agents left unjudged, an amendment the source system overtook). The server files them
 * under „Zu klären“; a guide leaves them out and counts them as `technical`.
 */
export const TECHNICAL_KINDS: readonly OpenQuestionKind[] = [
  'extractor-loss',
  'unjudged',
  'amendment-conflict',
];

/** `„A“, „B“ und „C“`. */
const quotedList = (labels: readonly string[]): string => {
  const q = labels.map((l) => `„${l}“`);
  return q.length < 2 ? (q[0] ?? '') : `${q.slice(0, -1).join(', ')} und ${q.at(-1)}`;
};

/**
 * The constants the skill sources and start prompts insert as `{{text:<id>}}` (scripts/texts.ts
 * adds `guide-skeleton`, rendered by `guide.ts`); test/texts.test.ts checks that every one is used.
 */
export const TEXT_CONSTANTS: Readonly<Record<string, string>> = {
  'web-markdown-export': WEB_MARKDOWN_EXPORT,
  'web-csv-export': WEB_CSV_EXPORT,
  'web-answers-button': `„${WEB_ANSWERS_BUTTON}“`,
  'md-informational': `„${MD_INFORMATIONAL}“`,
  'md-outside-mark': `„${MD_OUTSIDE_MARK}“`,
  'md-withdrawn': `„${MD_WITHDRAWN}“`,
  'technical-kinds': quotedList(TECHNICAL_KINDS.map((k) => OPEN_QUESTION_KIND_LABELS[k])),
};

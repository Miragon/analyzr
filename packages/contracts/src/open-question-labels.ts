/**
 * The German labels of the open questions' kinds and sources (M6 §4.4), the
 * kinds that ask nothing themselves and the answer kinds (M6 §4.5), shared by the server's export (the
 * CSV's column `Art`, the Markdown headings) and the web's tab „Offene
 * Fragen“, so the sheet and the tab say the same. Zod-free on purpose: the
 * web imports it at runtime as `@analyzr/contracts/open-question-labels` from
 * its lazy open-questions chunks (the types below are erased).
 */
import type {
  OpenQuestionAnswerKind,
  OpenQuestionAnswerTarget,
  OpenQuestionKind,
  OpenQuestionSource,
} from './api/open-questions.ts';

/** German label of each kind. */
export const OPEN_QUESTION_KIND_LABELS: Readonly<Record<OpenQuestionKind, string>> = {
  'call-target-unknown': 'Aufrufziel unbekannt',
  'call-target-dynamic': 'Aufrufziel erst zur Laufzeit bekannt',
  'duplicate-process-id': 'Prozess-ID mehrfach vergeben',
  // `dangling-throw` and `unmatched-catch` cover message and signal endpoints alike.
  'message-partner-missing': 'Nachrichten- oder Signalpartner fehlt',
  held: 'Vorgemerkt',
  'agent-question': 'Frage eines Agenten',
  'placement-unsure': 'Einordnung unsicher',
  'process-without-step': 'Prozess ohne Schritt',
  'step-without-process': 'Schritt ohne Prozess',
  'unresolved-link': 'Link nicht auflösbar',
  'external-partner': 'Externer Partner?',
  'summary-note': 'Zusammenfassung eines Agenten',
  unjudged: 'Paare ohne Urteil',
  'black-box-partner': 'Pool ohne Prozess',
  'unlabelled-boundary': 'Start oder Ende ohne Namen',
  'message-without-name': 'Nachricht ohne Namen',
  'undocumented-process': 'Prozess ohne Dokumentation',
  'isolated-process': 'Prozess ohne Verbindung',
  'descriptive-model': 'Beschreibendes Modell',
};

/** German label of each source. */
export const OPEN_QUESTION_SOURCE_LABELS: Readonly<Record<OpenQuestionSource, string>> = {
  finding: 'Befund',
  'value-chain-finding': 'Befund der Wertschöpfungskette',
  hold: 'Vormerkung',
  'agent-question': 'Frage eines Agenten',
  unsure: 'Agent unsicher',
  'no-link': 'Kein Zusammenhang (Agent)',
  summary: 'Zusammenfassung eines Agenten',
  unjudged: 'Nicht bewertete Paare',
  signal: 'Lückensignal',
};

/**
 * Kinds that ask nothing themselves (a submission's summary, a descriptive
 * model): the list ranks them last, the CSV for the customer leaves them out,
 * the tab marks them „Zur Information“.
 */
export const INFORMATIONAL_OPEN_QUESTION_KINDS: readonly OpenQuestionKind[] = [
  'summary-note',
  'descriptive-model',
];

/** Whether a kind is informational ({@link INFORMATIONAL_OPEN_QUESTION_KINDS}). */
export function isInformationalKind(kind: OpenQuestionKind): boolean {
  return INFORMATIONAL_OPEN_QUESTION_KINDS.includes(kind);
}

/**
 * German label of each answer kind: the values of the CSV column
 * `Antwortart` (`OPEN_QUESTION_ANSWER_KINDS`) and the dialog's choices.
 */
export const OPEN_QUESTION_ANSWER_KIND_LABELS: Readonly<Record<OpenQuestionAnswerKind, string>> = {
  answer: 'Antwort',
  'outside-landscape': 'Liegt außerhalb der Landschaft',
  'will-be-modelled': 'Wird im Modell ergänzt',
};

/**
 * German description of where an answer's text lands (M6 §4.5 "Where the
 * text lands"), in the web's terms (Relation, Platzierung): „gespeichert als
 * Notiz an der Relation“.
 */
export const OPEN_QUESTION_ANSWER_TARGET_LABELS: Readonly<
  Record<OpenQuestionAnswerTarget, string>
> = {
  'relation-note': 'als Notiz an der Relation',
  'placement-note': 'als Notiz an der Platzierung',
  answer: 'bei der Frage',
};

/**
 * Unicode composed (a decomposed „ä“ or „ß“ from another program is the same
 * letter), spaces collapsed, case folded: how a sheet cell is compared with
 * the kinds.
 */
const fold = (value: string): string =>
  value.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de');

/**
 * The answer kind a sheet's `Antwortart` cell names: its German label or its
 * value, case and spaces ignored; an empty cell means `answer`; `null` for
 * anything else.
 */
export function answerKindFromCell(cell: string): OpenQuestionAnswerKind | null {
  const value = fold(cell);
  if (value === '') return 'answer';
  for (const [kind, label] of Object.entries(OPEN_QUESTION_ANSWER_KIND_LABELS)) {
    if (value === fold(label) || value === kind) return kind as OpenQuestionAnswerKind;
  }
  return null;
}

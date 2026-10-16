/**
 * The German labels of the open questions' kinds and sources (M6 §4.4) and
 * the kinds that ask nothing themselves, shared by the server's export (the
 * CSV's column `Art`, the Markdown headings) and the web's tab „Offene
 * Fragen“, so the sheet and the tab say the same. Zod-free on purpose: the
 * web imports it at runtime as `@analyzr/contracts/open-question-labels` from
 * its lazy open-questions chunks (the types below are erased).
 */
import type { OpenQuestionKind, OpenQuestionSource } from './api/open-questions.ts';

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

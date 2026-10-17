/**
 * The German labels of the open questions' kinds and sources (M6 §4.4), the
 * kinds that ask nothing themselves, the answer kinds and roles (M6 §4.5,
 * §4.8 b), the states and the actions (M6 §4.8 a), shared by the server
 * (the export's column `Art` and Markdown headings, the actions' labels) and
 * the web's tab „Offene Fragen“ and model view, so the sheet, the tab and the
 * CLI say the same. Zod-free on purpose: the web imports it at runtime as
 * `@analyzr/contracts/open-question-labels` from its lazy open-questions
 * chunks (the types below are erased).
 */
import type {
  OpenQuestionAnswerKind,
  OpenQuestionAnswerRole,
  OpenQuestionAnswerTarget,
  OpenQuestionKind,
  OpenQuestionSource,
  OpenQuestionState,
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
  'amendment-conflict': 'Ergänzung nicht mehr anwendbar',
  'extractor-loss': 'Elemente beim Import verloren',
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
  amendment: 'Ergänzung',
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
 * German label of each state (M6 §4.8 b): `answered` means a live outside
 * mark, so the Status filter calls it „Erledigt (außerhalb)“.
 */
export const OPEN_QUESTION_STATE_LABELS: Readonly<Record<OpenQuestionState, string>> = {
  open: 'Offen',
  answered: 'Erledigt (außerhalb)',
};

/** German label of how a stored answer counts (M6 §4.8 b). */
export const OPEN_QUESTION_ANSWER_ROLE_LABELS: Readonly<Record<OpenQuestionAnswerRole, string>> = {
  note: 'Notiz',
  'outside-mark': 'Liegt außerhalb der Landschaft',
};

/**
 * The German labels of the actions (M6 §4.8 a), by what the action does:
 * the read model puts them on each item's actions, so the tab, the model
 * view and the CLI say the same.
 */
export const OPEN_QUESTION_ACTION_LABELS = {
  /** `link`: a process or endpoint picker. */
  link: 'Verknüpfen mit …',
  /** `link` on `call-target-dynamic`: several possible targets. */
  linkTargets: 'Mögliche Ziele verknüpfen …',
  /** `link` on `unjudged`: one of the listed pairs. */
  linkPair: 'Paar verknüpfen …',
  /** `place`: a step picker for the item's process. */
  place: 'Schritt wählen …',
  /** `place` next to a proposed placement. */
  placeOther: 'Anderen Schritt wählen …',
  /** `place` on `@outside`. */
  placeOutside: 'Gehört zu keinem Schritt',
  /** `place` on a step item: a process picker. */
  placeProcess: 'Prozess zuordnen …',
  /** `decide` on a hold or an agent's question. */
  decide: 'Entscheiden',
  /** `decide` on a proposed placement. */
  decideProposal: 'Vorschlag prüfen',
  /** `choose-copy`. */
  chooseCopy: 'Gültige Kopie wählen …',
  /** `outside`. */
  outside: 'Liegt außerhalb der Landschaft',
  /** `requeue`. */
  requeue: 'Erneut einplanen',
  /** `fix-link`. */
  fixLink: 'Link korrigieren',
  /** `link` next to the primary `amend` on a call without a target (S5c-2). */
  linkOnly: 'Nur verknüpfen …',
  /** `amend` `call-target` on a call without a target. */
  amendCallTarget: 'Aufrufziel eintragen …',
  /** `amend` `call-target` on a call whose target names no process. */
  amendCallTargetChange: 'Aufrufziel im Modell ändern …',
  /** `amend` `message-name` on a message endpoint without a name. */
  amendMessageName: 'Nachrichtennamen eintragen …',
  /** `amend` `message-name` on a named message endpoint. */
  amendMessageNameChange: 'Nachrichtennamen ändern …',
  /** `amend` `message-name` on a signal endpoint without a name. */
  amendSignalName: 'Signalnamen eintragen …',
  /** `amend` `message-name` on a named signal endpoint. */
  amendSignalNameChange: 'Signalnamen ändern …',
  /** `amend` `event-name` on unnamed start or end events. */
  amendEventName: 'Namen eintragen …',
  /** `amend` `process-documentation`. */
  amendDocumentation: 'Dokumentation ergänzen …',
  /** `amend` on `amendment-conflict` (`value-changed`): the amendment again, over the tool's value. */
  keepAmendment: 'Meine Ergänzung behalten',
  /** `withdraw-amendment` on `amendment-conflict` (`value-changed`). */
  takeSourceValue: 'Wert aus dem Quellsystem übernehmen',
  /** `withdraw-amendment` on `amendment-conflict` (`element-missing`, `expression`). */
  withdrawAmendment: 'Ergänzung zurücknehmen',
  /** `withdraw-amendment` of every live amendment of the model. */
  withdrawAllAmendments: 'Alle Ergänzungen dieses Modells zurücknehmen',
  /** `note`. */
  note: 'Notiz hinzufügen',
} as const;

/** The hint next to an `amend` whose value comes from a live amendment (S5c-2). */
export const AMENDED_HINT = 'in analyzr ergänzt';

/**
 * German label of each stored answer kind (M6 §4.5): the values of S5a's
 * CSV column `Antwortart` (`OPEN_QUESTION_ANSWER_KINDS`), which sheets
 * exported before S5c-1 still carry.
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

/**
 * The German labels of the open questions' kinds and sources (M6 §4.4), the
 * groups (UX2a), the kinds that ask nothing themselves, the answer kinds and
 * roles (M6 §4.5, §4.8 b), the states and the actions (M6 §4.8 a), shared by the server
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
  OpenQuestionGroup,
  OpenQuestionKind,
  OpenQuestionSource,
  OpenQuestionState,
} from './api/open-questions.ts';

/** German label of each kind. */
export const OPEN_QUESTION_KIND_LABELS: Readonly<Record<OpenQuestionKind, string>> = {
  'call-target-unknown': 'Aufrufziel unbekannt',
  'call-target-dynamic': 'Ziel wird erst beim Ausführen bestimmt',
  'duplicate-process-id': 'Prozess-ID mehrfach vergeben',
  // `dangling-throw` and `unmatched-catch` cover message and signal endpoints alike.
  'message-partner-missing': 'Partner der Nachricht fehlt',
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
 * German label of each group (UX2a): the headings of the tab „Offene Fragen“
 * and the export's filter line. `proposal` items are decided on the value
 * chain and not listed in the tab.
 */
export const OPEN_QUESTION_GROUP_LABELS: Readonly<Record<OpenQuestionGroup, string>> = {
  ask: 'Zu klären',
  agent: 'Fragen der Agenten',
  proposal: 'Auf der Kette zu prüfen',
  info: 'Zur Information',
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
 * mark, „Außerhalb der Landschaft“ (UX2b's done card; „Erledigt (außerhalb)“
 * before).
 */
export const OPEN_QUESTION_STATE_LABELS: Readonly<Record<OpenQuestionState, string>> = {
  open: 'Offen',
  answered: 'Außerhalb der Landschaft',
};

/** German label of how a stored answer counts (M6 §4.8 b). */
export const OPEN_QUESTION_ANSWER_ROLE_LABELS: Readonly<Record<OpenQuestionAnswerRole, string>> = {
  note: 'Notiz',
  'outside-mark': 'Liegt außerhalb der Landschaft',
};

/**
 * A note on a hold is its answer (UX2b: „Antwort geben“ answers a hold), so
 * the tab, the review screen and the export call it „Antwort“.
 */
export const HOLD_ANSWER_LABEL = 'Antwort';

/** The label of a stored answer on an item of this kind: a hold's notes are its answers. */
export function answerRoleLabel(kind: OpenQuestionKind, role: OpenQuestionAnswerRole): string {
  return kind === 'held' && role === 'note'
    ? HOLD_ANSWER_LABEL
    : OPEN_QUESTION_ANSWER_ROLE_LABELS[role];
}

/**
 * Sources whose texts are a human's or an agent's, verbatim (plain text,
 * never from code). Where such an item has a `detail` (an unsure verdict, a
 * coded no-link), it is the agent's reason: the tab and the export attribute
 * it ({@link AGENT_WORDS}), so it never reads as analyzr's own statement.
 */
export const VERBATIM_OPEN_QUESTION_SOURCES: readonly OpenQuestionSource[] = [
  'hold',
  'agent-question',
  'unsure',
  'no-link',
  'summary',
];

/** Whether an item's texts are verbatim ({@link VERBATIM_OPEN_QUESTION_SOURCES}). */
export function isVerbatimSource(source: OpenQuestionSource): boolean {
  return VERBATIM_OPEN_QUESTION_SOURCES.includes(source);
}

/** The attribution before an agent's verbatim reason: „Laut Agent: …“. */
export const AGENT_WORDS = 'Laut Agent';

/**
 * The German labels of the actions (M6 §4.8 a), by what the action does:
 * the read model puts them on each item's actions, so the tab, the model
 * view and the CLI say the same.
 */
export const OPEN_QUESTION_ACTION_LABELS = {
  /** `link`: a process or endpoint picker, whenever it is the item's primary action. */
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
  placeProcess: 'Prozess platzieren …',
  /** `decide` on a hold or an agent's question (UX2a: the web opens the proposal). */
  decide: 'Vorschlag prüfen',
  /** `decide` on the value chain's proposed placements (`proposal` items, UX2a): opens the chain. */
  reviewOnChain: 'Auf der Kette prüfen',
  /** `choose-copy`. */
  chooseCopy: 'Gültige Kopie wählen …',
  /** `outside`. */
  outside: 'Liegt außerhalb der Landschaft',
  /** `requeue`. */
  requeue: 'Erneut einplanen',
  /** `fix-link`. */
  fixLink: 'Link korrigieren',
  /**
   * `link` as the second action beside a primary `amend` (a call without a target, a
   * nameless message or signal endpoint): the two outcomes side by side, the web joins
   * them into one entry (UX4). A primary link is always „Verknüpfen mit …“.
   */
  linkOnly: 'Nur verknüpfen …',
  /** `amend` `call-target`: a call without a target, or one whose target names no process. */
  amendCallTarget: 'Ziel im Modell eintragen …',
  /** `amend` `message-name` on a message endpoint, with or without a name. */
  amendMessageName: 'Nachrichtennamen im Modell eintragen …',
  /** `amend` `message-name` on a signal endpoint, with or without a name. */
  amendSignalName: 'Signalnamen im Modell eintragen …',
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

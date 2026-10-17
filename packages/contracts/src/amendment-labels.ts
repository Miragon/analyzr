/**
 * The German labels of model amendments (M6 §4.8 c, S5c-2): the fields, the
 * states, the element kinds, the conflict reasons and why a field cannot be
 * set, shared by the server (the change list, the conflict questions) and
 * the web's „Ergänzen“ section and forms, so the export, the tab and the
 * model view say the same. Zod-free on purpose, like
 * `@analyzr/contracts/open-question-labels`: the web imports it at runtime
 * as `@analyzr/contracts/amendment-labels` from its lazy chunks (the types
 * below are erased).
 */
import type {
  AmendmentConflictReason,
  AmendmentOp,
  AmendmentOutcome,
} from './api/amendment-core.ts';
import type { AmendableElementKind, AmendmentRefusal, AmendmentState } from './api/amendments.ts';

/** German name of the field each op writes (a name of unknown family: „Nachrichten- oder Signalname“). */
export const AMENDMENT_FIELD_LABELS: Readonly<Record<AmendmentOp, string>> = {
  'call-target': 'Aufrufziel',
  'message-name': 'Nachrichten- oder Signalname',
  'event-name': 'Name',
  'process-documentation': 'Dokumentation',
};

/** Whether a message or signal name is a message's or a signal's (`null`: unknown). */
export type AmendmentNameFamily = 'message' | 'signal' | null;

/** The field's German name, a name by its family: „Nachrichtenname“, „Signalname“. */
export function amendmentFieldLabel(op: AmendmentOp, family: AmendmentNameFamily = null): string {
  if (op !== 'message-name' || family === null) return AMENDMENT_FIELD_LABELS[op];
  return family === 'signal' ? 'Signalname' : 'Nachrichtenname';
}

/** „Welches Aufrufziel“, „Welcher Name“ … : the question word of a field. */
export function amendmentFieldQuestion(
  op: AmendmentOp,
  family: AmendmentNameFamily = null,
): string {
  switch (op) {
    case 'call-target':
      return 'Welches Aufrufziel';
    case 'event-name':
      return 'Welcher Name';
    case 'process-documentation':
      return 'Welche Dokumentation';
    case 'message-name':
      return `Welcher ${amendmentFieldLabel(op, family)}`;
  }
}

/**
 * German type of a message or signal endpoint by its BPMN type
 * (`attrs.elementType`, e.g. `bpmn:EndEvent`) and family:
 * „Nachrichten-Endereignis“, „Signal-Startereignis“, „Sendeaufgabe“; the
 * generic „Nachrichten- oder Signalelement“ when neither is known.
 */
export function endpointTypeLabel(
  elementType: string | undefined,
  family: AmendmentNameFamily,
): string {
  const prefix = family === 'signal' ? 'Signal' : family === 'message' ? 'Nachrichten' : null;
  switch (elementType) {
    case 'bpmn:SendTask':
      return 'Sendeaufgabe';
    case 'bpmn:ReceiveTask':
      return 'Empfangsaufgabe';
    case 'bpmn:StartEvent':
      return prefix ? `${prefix}-Startereignis` : 'Startereignis';
    case 'bpmn:EndEvent':
      return prefix ? `${prefix}-Endereignis` : 'Endereignis';
    case 'bpmn:IntermediateThrowEvent':
    case 'bpmn:IntermediateCatchEvent':
      return prefix ? `${prefix}-Zwischenereignis` : 'Zwischenereignis';
    case 'bpmn:BoundaryEvent':
      return prefix ? `${prefix}-Ereignis (angeheftet)` : 'Ereignis (angeheftet)';
    default:
      return family === 'signal'
        ? 'Signalelement'
        : family === 'message'
          ? 'Nachrichtenelement'
          : AMENDABLE_ELEMENT_LABELS.endpoint;
  }
}

/** The definite article of a German element type, accusative and dative („das“/„dem“ Endereignis). */
export function articleOf(type: string): { acc: string; dat: string } {
  const last =
    type
      .replace(/\s*\(.*\)$/, '')
      .split(/[-\s]/)
      .at(-1) ?? type;
  if (/(aktivität|aufgabe|nachricht)$/i.test(last)) return { acc: 'die', dat: 'der' };
  if (/^prozess$/i.test(last)) return { acc: 'den', dat: 'dem' };
  return { acc: 'das', dat: 'dem' };
}

/** German label of each state of an amendment („Modell gelöscht“ is a mark on top). */
export const AMENDMENT_STATE_LABELS: Readonly<Record<AmendmentState, string>> = {
  applied: 'angewendet',
  'in-source': 'im Quellsystem übernommen',
  conflict: 'Konflikt',
  withdrawn: 'zurückgenommen',
  superseded: 'ersetzt',
};

/** German label of each outcome on the head (the states of a live amendment). */
export const AMENDMENT_OUTCOME_LABELS: Readonly<Record<AmendmentOutcome, string>> = {
  applied: AMENDMENT_STATE_LABELS.applied,
  'in-source': AMENDMENT_STATE_LABELS['in-source'],
  conflict: AMENDMENT_STATE_LABELS.conflict,
};

/** The mark of an amendment whose model is deleted. */
export const AMENDMENT_MODEL_DELETED_LABEL = 'Modell gelöscht';

/** German label of each conflict reason. */
export const AMENDMENT_CONFLICT_LABELS: Readonly<Record<AmendmentConflictReason, string>> = {
  'element-missing': 'Element fehlt oder ist nicht mehr ergänzbar',
  'value-changed': 'Wert im Quellsystem geändert',
  expression: 'im Quellsystem jetzt ein Ausdruck',
};

/** German type of each element an amendment writes. */
export const AMENDABLE_ELEMENT_LABELS: Readonly<Record<AmendableElementKind, string>> = {
  call: 'Aufrufaktivität',
  'start-event': 'Startereignis',
  'end-event': 'Endereignis',
  process: 'Prozess',
  message: 'Nachricht',
  signal: 'Signal',
  endpoint: 'Nachrichten- oder Signalelement',
};

/** German explanation of why an amendment is not applicable (`not-applicable` items, `amendable`). */
export const AMENDMENT_REFUSAL_LABELS: Readonly<Record<AmendmentRefusal, string>> = {
  'only-open-questions': 'Nur für offene Fragen',
  'invalid-value': 'Der Wert ist leer, zu lang oder enthält unzulässige Zeichen',
  expression: 'Das Feld enthält einen Ausdruck, der erst zur Laufzeit ausgewertet wird',
  'cmmn-call': 'Ruft einen CMMN-Fall auf, keinen Prozess',
  'has-documentation': 'Der Prozess hat bereits eine Dokumentation aus dem Quellsystem',
  'wrong-element': 'Das Element hat dieses Feld nicht',
  'element-missing': 'Das Element fehlt im Modell',
  'duplicate-id': 'Mehrere Elemente haben diese ID',
  'redeclared-prefix': 'Das Modell bindet ein Namensraum-Präfix neu',
  'unsupported-structure': 'Diese Stelle des Modells kann analyzr nicht sicher ergänzen',
  'check-failed': 'Die Prüfung des Ergebnisses ist fehlgeschlagen',
  'duplicate-amendment': 'Die Anfrage setzt dieses Feld zweimal',
  'in-source': 'Das Modell aus dem Quellsystem hat diesen Wert bereits',
  'unknown-ref': 'Das Ziel ist kein Element der Landschaft',
  'not-a-process': 'Das Ziel ist kein Prozess',
  'same-process': 'Das Ziel liegt im selben Prozess',
  'partner-not-paired': 'Der gewählte Partner passt nicht zu diesem Namen',
  'not-a-call-target': 'Ein Ziel gibt es nur für das Aufrufziel',
  'not-a-message-name': 'Einen Partner gibt es nur für Nachrichten- und Signalnamen',
};

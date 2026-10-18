import type { ProblemCode } from '@analyzr/client';

/**
 * Failed writes in German (UX-SIMPLIFICATION.md §3.13 item 7): the problems'
 * titles in `packages/contracts/src/problem.ts` are English („Conflict“,
 * „Precondition failed“), so every screen said them. One plain sentence per
 * `ProblemCode` (a `Record`, so a new code fails to compile here and in
 * `test/problem-texts.test.ts`), and per `reason` where the server sends one
 * as a member of the problem; the original title and detail stay behind
 * „Technische Details“ (`errorDetail` in `lib/api.ts`).
 */
export const PROBLEM_TEXTS: Record<ProblemCode, string> = {
  'validation-failed': 'Die Eingabe passt so nicht. Prüf sie und versuch es noch einmal.',
  'bpmn-invalid': 'Die Datei ist kein gültiges BPMN.',
  unauthorized: 'Die Anmeldung ist abgelaufen. Lade die Seite neu.',
  'insufficient-scope': 'Dafür fehlt die Berechtigung.',
  forbidden: 'Das darfst du in diesem Projekt nicht.',
  'human-decision-required': 'Das entscheidet nur ein Mensch.',
  'demo-readonly': 'Das ist eine Demo: Hier kannst du nichts ändern.',
  'not-found': 'Das gibt es nicht mehr. Lade die Seite neu.',
  'method-not-allowed': 'Das geht an dieser Stelle nicht.',
  conflict: 'Das passt nicht mehr zum aktuellen Stand. Lade neu und prüf den neuen Stand.',
  'precondition-failed': 'Inzwischen hat sich etwas geändert. Lade neu und prüf den neuen Stand.',
  'precondition-required':
    'Es fehlt, auf welchen Stand sich die Änderung bezieht. Lade neu und versuch es noch einmal.',
  'revision-conflict':
    'Inzwischen hat jemand eine neuere Fassung gespeichert. Lade neu und prüf den neuen Stand.',
  'value-chain-invalid': 'So ist die Wertschöpfungskette nicht gültig.',
  'value-chain-unsupported-version': 'Diese Fassung des Kettenformats kennt analyzr nicht.',
  'lease-lost': 'Die Reservierung des Agenten ist abgelaufen.',
  'task-cancelled': 'Die Aufgabe ist inzwischen abgebrochen.',
  'already-submitted': 'Die Aufgabe ist schon abgegeben.',
  'wrong-task-kind': 'Das passt nicht zu dieser Art von Aufgabe.',
  'payload-too-large': 'Das ist zu groß für eine Anfrage.',
  'unsupported-media-type': 'Dieses Format nimmt analyzr nicht an.',
  internal: 'Auf dem Server ist etwas schiefgegangen. Versuch es später noch einmal.',
  'not-implemented': 'Das kann analyzr noch nicht.',
};

/**
 * The `reason` members the server adds to a problem (`DomainError` extras),
 * where a sentence says more than the code: chosen before the code's text.
 */
export const PROBLEM_REASON_TEXTS: Readonly<Record<string, string>> = {
  'rationale-required': 'Dafür braucht es eine Begründung.',
  'unknown-step': 'Diesen Schritt gibt es auf der Wertschöpfungskette nicht mehr.',
  'unknown-process': 'Diesen Prozess gibt es nicht mehr.',
  'unknown-ref': 'Dieses Element gibt es im aktuellen Stand nicht mehr.',
  'same-step': 'Der Prozess steht schon auf diesem Schritt.',
  'same-process': 'Beide Enden liegen im selben Prozess.',
  'invalid-manifest': 'Die Datei analyzr-import.json passt nicht zum Import.',
  'amendment-not-applicable': 'Die Ergänzung passt nicht mehr zum aktuellen Stand des Modells.',
};

/** The German sentence for a problem: its reason's, else its code's. */
export function problemText(code: ProblemCode, reason?: unknown): string {
  if (typeof reason === 'string') {
    const text = PROBLEM_REASON_TEXTS[reason];
    if (text !== undefined) return text;
  }
  return PROBLEM_TEXTS[code] ?? PROBLEM_TEXTS.internal;
}

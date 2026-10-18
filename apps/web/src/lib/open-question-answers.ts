import type {
  AnswerSheetReason,
  AnswerSheetResult,
  AnswerSheetRowResult,
  OpenQuestion,
  OpenQuestionAnswer,
  OpenQuestionAnswerKind,
  OpenQuestionAnswerRole,
  OpenQuestionAnswerTarget,
  OpenQuestionAction,
  OpenQuestionSubject,
} from '@analyzr/client';
// Zod-free subpaths of the contracts (M6 S5a), loaded with the lazy open-questions chunks only.
import {
  CsvError,
  parseOpenQuestionsCsv,
  readAnswerSheet,
  type CsvErrorCode,
} from '@analyzr/contracts/open-question-csv';
import {
  OPEN_QUESTION_ANSWER_ROLE_LABELS,
  OPEN_QUESTION_ANSWER_TARGET_LABELS,
} from '@analyzr/contracts/open-question-labels';
import {
  PERSONAL_DATA_KINDS,
  PERSONAL_DATA_LABELS,
  personalDataHint,
  type PersonalDataKind,
  type PersonalDataMatch,
} from '@analyzr/contracts/personal-data';

import { MAX_ANSWER_CHARS, MAX_ANSWER_SHEET_BODY_BYTES, MAX_ANSWER_SHEET_ROWS } from './limits';

/**
 * Notes on open questions (M6 §4.8 b, since S5c-1; S5a's answers), the web's
 * side: where a note's text lands and what it does, as the dialog „Notiz
 * hinzufügen“ says it; how a stored answer counts (a note, or the outside
 * mark „Liegt außerhalb der Landschaft“); the reading of a filled-in sheet
 * for „Antworten aus CSV übernehmen“ and the German texts of its preview.
 * Pure. Loaded with the tab's page and the model view's section (both
 * lazy), never with the entry.
 */

/** How each stored answer counts, as the item lists it: „Notiz“ or „Liegt außerhalb der Landschaft“. */
export const ANSWER_ROLE_LABELS: Readonly<Record<OpenQuestionAnswerRole, string>> =
  OPEN_QUESTION_ANSWER_ROLE_LABELS;

/**
 * What a sheet row records, in the preview: a note (`answer`), or, from a
 * sheet exported before S5c-1 with its `Antwortart`, the outside mark.
 */
export const SHEET_KIND_LABELS: Readonly<Record<OpenQuestionAnswerKind, string>> = {
  answer: 'Notiz',
  'outside-landscape': 'Liegt außerhalb der Landschaft',
  'will-be-modelled': 'Notiz',
};

/**
 * Where the text of a note on this subject lands (M6 §4.5 "Where the text
 * lands"), as the server decides it: a human note on a relation or a
 * placement, else the question itself.
 */
export function answerTargetOf(
  subject: Pick<OpenQuestionSubject, 'type'>,
): OpenQuestionAnswerTarget {
  return subject.type === 'relation'
    ? 'relation-note'
    : subject.type === 'placement'
      ? 'placement-note'
      : 'answer';
}

/** Where a stored answer's text is, next to the answer (the web's terms: Relation, Platzierung). */
export const ANSWER_TARGET_LABELS: Readonly<Record<OpenQuestionAnswerTarget, string>> =
  OPEN_QUESTION_ANSWER_TARGET_LABELS;

/** The sentence about agents, where it applies (a note on a relation, M6 §4.5). */
export const AGENTS_SENTENCE =
  'Die Agenten berücksichtigen die Notiz, sobald sie diese Relation neu bewerten.';

/** {@link AGENTS_SENTENCE} for a hold's answer (UX2b review: „Antwort“ throughout). */
export const AGENTS_SENTENCE_ANSWER =
  'Die Agenten berücksichtigen die Antwort, sobald sie diese Relation neu bewerten.';

/** Notes are append-only (M6 §7: no erasure path), said next to the note field. */
export const NOTE_PERMANENT = 'Eine gespeicherte Notiz lässt sich nicht mehr ändern oder löschen.';

/**
 * Answers are notes, append-only as well (said in the sheet dialog and next
 * to a hold's answer field).
 */
export const ANSWER_PERMANENT =
  'Eine gespeicherte Antwort lässt sich nicht mehr ändern oder löschen.';

/**
 * A hold stays until a human decides it (owner decision 26, Q4): said after
 * its answer, without naming a control (the card, the „Vorgemerkt“ row and the
 * review screen each decide it with their own).
 */
export const HOLD_STAYS = 'Die Vormerkung bleibt, bis du sie entscheidest.';

/** A note informs; the item stays open until its action ends it (M6 §4.8 b). */
export const NOTE_KEEPS_OPEN = 'Die Frage bleibt offen; erledigt wird sie durch ihre Aktion.';

/**
 * A note informs; an item whose only action is the note (S5c-1:
 * `unlabelled-boundary`, `undocumented-process`; S5c-2 adds their
 * amendments) ends once the model comes in again with what was missing.
 */
export const NOTE_UNTIL_IMPORT =
  'Die Frage bleibt offen, bis das Modell mit der Ergänzung neu importiert ist.';

/** Whether an item has an action besides the note that can end it (items without `actions` count as having one). */
export function endsByAction(question: {
  actions?: readonly Pick<OpenQuestionAction, 'type'>[];
}): boolean {
  return question.actions === undefined || question.actions.some((a) => a.type !== 'note');
}

/** What a note leaves: the item open until its action, or for a note-only item the next import, ends it. */
export function noteKeepsOpen(question: {
  actions?: readonly Pick<OpenQuestionAction, 'type'>[];
}): string {
  return endsByAction(question) ? NOTE_KEEPS_OPEN : NOTE_UNTIL_IMPORT;
}

/**
 * What the dialog says about where the note goes and what it does (M6 §4.5,
 * §4.8 b), by the item's subject and kind: a relation's note reaches the
 * agents with the pair's next judgement (a held relation stays held); on a
 * placement an agent asked about, the note makes the process due (nothing
 * is queued); a held placement keeps homing its process, so no agent gets
 * it until the reviewer decides the hold; every other note stays with the
 * question, and the dialog points at the path that works today: the
 * model's documentation and a new import (for steps and the chain, which
 * no model documents, the value chain itself or the missing model's import).
 * A note never ends the item: its action does, or, for an item whose only
 * action is the note, the model's next import.
 */
export function noteEffectText(
  question: Pick<OpenQuestion, 'kind'> & {
    subject: Pick<OpenQuestionSubject, 'type'>;
    actions?: readonly Pick<OpenQuestionAction, 'type'>[];
  },
): string {
  const held = question.kind === 'held';
  const keepsOpen = noteKeepsOpen(question);
  switch (question.subject.type) {
    case 'relation':
      // A hold's note is its answer (UX2b review): one term in the whole dialog.
      return held
        ? `Die Antwort wird an der Relation gespeichert. ${AGENTS_SENTENCE_ANSWER} ${HOLD_STAYS}`
        : `Die Notiz wird an der Relation gespeichert und steht auch im Prüfbildschirm. ${AGENTS_SENTENCE} ${keepsOpen}`;
    case 'placement':
      return held
        ? 'Die Antwort wird an der Platzierung gespeichert. Die Platzierung bleibt vorgemerkt, ' +
            'bis du sie entscheidest; solange bekommt kein Agent den Prozess.'
        : 'Die Notiz wird an der Platzierung gespeichert. Der Prozess wird damit fällig: ' +
            'Der Platzierungsagent sieht die Notiz mit seiner nächsten Aufgabe zur Kette; eingeplant wird dadurch noch keine. ' +
            keepsOpen;
    case 'step':
    case 'value-chain':
      return (
        'Die Notiz wird bei der Frage gespeichert, angezeigt und exportiert; die Agenten sehen sie noch nicht. ' +
        `${keepsOpen} Fehlt ein Modell, importiere es.`
      );
    case 'ref':
    case 'process':
    case 'model':
      return (
        'Die Notiz wird bei der Frage gespeichert, angezeigt und exportiert; die Agenten sehen sie noch nicht. ' +
        `${keepsOpen} Gehört das Fehlende ins Modell, ergänze es im Quellwerkzeug und importiere das Modell erneut: ` +
        'Ein neuer Stand plant das Modell neu ein.'
      );
  }
}

/**
 * The answers of an item in one line, by how they count: „2 Notizen“,
 * „1 Notiz · Als außerhalb markiert“, „Markierung zurückgenommen“; a hold's
 * notes are its answers („2 Antworten“, `answer`).
 */
export function answersSummaryText(
  answers: readonly Pick<OpenQuestionAnswer, 'role' | 'withdrawal'>[],
  answer = false,
): string {
  const notes = answers.filter((a) => a.role === 'note').length;
  const marks = answers.filter((a) => a.role === 'outside-mark');
  const live = marks.some((a) => a.withdrawal === null);
  const [one, many] = answer ? ['Antwort', 'Antworten'] : ['Notiz', 'Notizen'];
  return [
    notes === 0 ? null : notes === 1 ? `1 ${one}` : `${notes} ${many}`,
    marks.length === 0 ? null : live ? 'Als außerhalb markiert' : 'Markierung zurückgenommen',
  ]
    .filter((p) => p !== null)
    .join(' · ');
}

/**
 * The note on an item with notes before (the dialog: „Deine kommt hinzu“; a
 * sheet row in the preview: „Diese kommt hinzu“): notes are append-only, so
 * a new one joins the earlier ones; `null` without any. A hold's notes are
 * its answers (`answer`).
 */
export function notesBeforeText(
  n: number,
  who: 'Deine' | 'Diese' = 'Deine',
  answer = false,
): string | null {
  if (n === 0) return null;
  const [one, many] = answer ? ['eine Antwort', 'Antworten'] : ['eine Notiz', 'Notizen'];
  return n === 1
    ? `Schon ${one}. ${who} kommt hinzu; die bisherige bleibt stehen.`
    : `Schon ${n} ${many}. ${who} kommt hinzu; die bisherigen bleiben stehen.`;
}

/** `1.234 von 2.000 Zeichen` (the field's counter). */
export function charCountText(length: number): string {
  const de = new Intl.NumberFormat('de-DE');
  return `${de.format(length)} von ${de.format(MAX_ANSWER_CHARS)} Zeichen`;
}

/** The found personal data as the dialog lists it: label and the text found. */
export function personalDataFindings(
  text: string,
  warnings: readonly PersonalDataMatch[],
): { kind: PersonalDataKind; label: string; found: string }[] {
  return warnings.map((w) => ({
    kind: w.kind,
    label: PERSONAL_DATA_LABELS[w.kind],
    found: text.slice(w.start, w.end),
  }));
}

export { personalDataHint };

// --------------------------------------------------------------- the sheet

/** The file input's `accept`: the CSV the export wrote, as a spreadsheet saved it again. */
export const SHEET_ACCEPT = '.csv,text/csv';

/** Largest file the page reads at all; the request body has its own limit. */
export const MAX_SHEET_FILE_BYTES = 4 * MAX_ANSWER_SHEET_BODY_BYTES;

/**
 * One row as the sheet route takes it: the cells `id`, `Antwort` and S5a's
 * `Antwortart` (empty in the five-column sheet of S5c-1), as written.
 */
export interface SheetRow {
  id: string;
  text: string;
  kind: string;
}

/** A row with a filled `Antwort`: its row in the spreadsheet and its cells (what is sent). */
export interface FilledSheetRow {
  line: number;
  cells: SheetRow;
}

/**
 * A sheet read for the preview: its filled rows (the only ones sent) and how
 * many rows have no answer; or why it cannot be used.
 */
export type SheetRead =
  { ok: true; filled: FilledSheetRow[]; ignored: number } | { ok: false; message: string };

const quote = (name: string) => `„${name}“`;
const de = new Intl.NumberFormat('de-DE');

/** Why the parser could not read the file, in German. */
const CSV_PROBLEMS: Readonly<Record<CsvErrorCode, string>> = {
  'unterminated-quote': 'ein Feld in Anführungszeichen wird nicht geschlossen',
  'text-after-quote': 'nach einem schließenden Anführungszeichen folgt noch Text',
  'missing-columns': 'die Spalten „id“ und „Antwort“ fehlen',
};

/**
 * The file's bytes as text: UTF-8 only (with or without byte order mark),
 * as the CLI reads it. A sheet saved as ANSI (German Excel's „CSV
 * (Trennzeichen-getrennt)“ writes Windows-1252) would turn every umlaut into
 * „�“, and answers cannot be corrected once stored; `null` then.
 */
export function decodeSheet(bytes: ArrayBuffer | Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** {@link readSheet} on the file's bytes, refused when they are not UTF-8 ({@link decodeSheet}). */
export function readSheetBytes(name: string, bytes: ArrayBuffer | Uint8Array): SheetRead {
  const text = decodeSheet(bytes);
  if (text === null) {
    return {
      ok: false,
      message:
        `${quote(name)} ist nicht als UTF-8 gespeichert, so würden Umlaute verfälscht. ` +
        'Speichere die Datei im Tabellenprogramm als „CSV UTF-8 (durch Trennzeichen getrennt)“ und wähl sie erneut.',
    };
  }
  return readSheet(name, text);
}

/**
 * Reads a filled-in sheet (`readAnswerSheet` of the contracts, as the CLI):
 * a CSV with the export's columns `id` and `Antwort` (a sheet exported
 * before S5c-1 still has `Antwortart`, which is read and sent as well). Only rows with a filled `Antwort` are sent, at most
 * {@link MAX_ANSWER_SHEET_ROWS} in a request body of at most
 * {@link MAX_ANSWER_SHEET_BODY_BYTES}; each keeps its row in the spreadsheet
 * (blank rows and the header counted), so {@link sheetResult} can say the
 * server's outcome under the row the reviewer sees.
 */
export function readSheet(name: string, text: string): SheetRead {
  try {
    const { header } = parseOpenQuestionsCsv(text);
    const has = (column: string) => header.some((h) => h.trim() === column);
    if (!has('id') || !has('Antwort')) {
      return {
        ok: false,
        message: `${quote(name)} hat keine Spalten „id“ und „Antwort“. Nimm die CSV aus „Für den Kunden exportieren …“ und lass ihre Kopfzeile stehen.`,
      };
    }
    const rows = readAnswerSheet(text);
    if (rows.length === 0) {
      return { ok: false, message: `${quote(name)} hat unter der Kopfzeile keine Zeile.` };
    }
    const filled = rows.flatMap(({ line, id, text: answer, kind }) =>
      answer.trim() === '' ? [] : [{ line, cells: { id, text: answer, kind } }],
    );
    if (filled.length > MAX_ANSWER_SHEET_ROWS) {
      return {
        ok: false,
        message: `${quote(name)} hat ${de.format(filled.length)} ausgefüllte Antworten; analyzr nimmt höchstens ${de.format(MAX_ANSWER_SHEET_ROWS)} je Datei entgegen. Teil die Datei auf.`,
      };
    }
    if (sheetBodyBytes(filled.map((f) => f.cells)) > MAX_ANSWER_SHEET_BODY_BYTES) {
      return {
        ok: false,
        message: `Die Antworten in ${quote(name)} sind zusammen größer als 4 MB. Teil die Datei auf.`,
      };
    }
    return { ok: true, filled, ignored: rows.length - filled.length };
  } catch (error) {
    if (error instanceof CsvError) {
      const where = error.line === null ? '' : ` (Zeile ${de.format(error.line)})`;
      return {
        ok: false,
        message: `${quote(name)} lässt sich nicht als CSV lesen: ${CSV_PROBLEMS[error.code]}${where}. Speichere sie im Tabellenprogramm als CSV und versuch es erneut.`,
      };
    }
    throw error;
  }
}

/** Bytes of the sheet route's JSON body for these rows. */
export function sheetBodyBytes(rows: readonly SheetRow[]): number {
  return new TextEncoder().encode(JSON.stringify({ rows })).length;
}

/**
 * The server's result for the filled rows as the result for the whole
 * sheet, as the CLI makes it: each `row` is the row in the spreadsheet, and
 * `ignored` also counts the rows without an answer, which were not sent.
 */
export function sheetResult(
  result: AnswerSheetResult,
  read: { filled: readonly FilledSheetRow[]; ignored: number },
): AnswerSheetResult {
  return {
    ...result,
    counts: { ...result.counts, ignored: result.counts.ignored + read.ignored },
    rows: result.rows.map((r) => ({ ...r, row: read.filled[r.row - 1]?.line ?? r.row })),
  };
}

/** The preview of a sheet without a filled row: nothing to send, so no request. */
export function emptySheetResult(ignored: number): AnswerSheetResult {
  return {
    dryRun: true,
    counts: { recorded: 0, unchanged: 0, unknown: 0, invalid: 0, ignored },
    rows: [],
  };
}

/** Why a row cannot be stored, in German (`AnswerSheetReason`). */
export const SHEET_REASON_TEXTS: Readonly<Record<AnswerSheetReason, string>> = {
  'too-long': `Die Antwort ist länger als ${de.format(MAX_ANSWER_CHARS)} Zeichen.`,
  'control-characters': 'Die Antwort enthält Steuerzeichen.',
  'unknown-kind':
    'Die Antwortart dieser älteren CSV ist keine von „Antwort“, „Liegt außerhalb der Landschaft“ und „Wird im Modell ergänzt“.',
  'duplicate-id': 'Eine frühere Zeile beantwortet dieselbe Frage.',
};

/** The rows of a sheet's result, by what becomes of them (in sheet order). */
export interface SheetGroups {
  recorded: AnswerSheetRowResult[];
  unchanged: AnswerSheetRowResult[];
  unknown: AnswerSheetRowResult[];
  invalid: AnswerSheetRowResult[];
}

export function sheetGroups(result: Pick<AnswerSheetResult, 'rows'>): SheetGroups {
  const groups: SheetGroups = { recorded: [], unchanged: [], unknown: [], invalid: [] };
  for (const row of result.rows) groups[row.outcome].push(row);
  return groups;
}

const plural = (n: number, one: string, many: string) =>
  n === 1 ? `1 ${one}` : `${de.format(n)} ${many}`;

/**
 * The preview's (or the stored sheet's) counts in one sentence:
 * „3 Antworten werden gespeichert, 1 ist schon gespeichert, 1 unbekannte
 * Kennung, 2 Zeilen ohne Antwort.“ (`dryRun`), „… gespeichert …“ after.
 */
export function sheetSummaryText(result: Pick<AnswerSheetResult, 'counts' | 'dryRun'>): string {
  const { recorded, unchanged, unknown, invalid, ignored } = result.counts;
  const parts = [
    result.dryRun
      ? recorded === 1
        ? '1 Antwort wird gespeichert'
        : `${de.format(recorded)} Antworten werden gespeichert`
      : recorded === 1
        ? '1 Antwort gespeichert'
        : `${de.format(recorded)} Antworten gespeichert`,
    unchanged > 0
      ? unchanged === 1
        ? '1 ist schon gespeichert'
        : `${de.format(unchanged)} sind schon gespeichert`
      : null,
    unknown > 0 ? plural(unknown, 'unbekannte Kennung', 'unbekannte Kennungen') : null,
    invalid > 0 ? plural(invalid, 'ungültige Zeile', 'ungültige Zeilen') : null,
    ignored > 0 ? plural(ignored, 'Zeile ohne Antwort', 'Zeilen ohne Antwort') : null,
  ].filter((p) => p !== null);
  return `${parts.join(', ')}.`;
}

/**
 * The personal-data hint of a sheet, once for every row (M6 §4.5): how many
 * answers probably hold personal data and which kinds; `null` without any.
 * The preview passes the rows that would be stored (`recorded`), the ones
 * it marks: unknown and invalid rows are never stored, unchanged ones are
 * stored already.
 */
export function sheetPersonalDataText(rows: readonly AnswerSheetRowResult[]): string | null {
  const flagged = rows.filter((r) => r.warnings.length > 0);
  if (flagged.length === 0) return null;
  const kinds = PERSONAL_DATA_KINDS.filter((k) =>
    flagged.some((r) => r.warnings.some((w) => w.kind === k)),
  ).map((k) => PERSONAL_DATA_LABELS[k]);
  const list =
    kinds.length === 1 ? kinds[0] : `${kinds.slice(0, -1).join(', ')} oder ${kinds.at(-1) ?? ''}`;
  return (
    `${flagged.length === 1 ? 'Eine Antwort enthält' : `${de.format(flagged.length)} Antworten enthalten`} vermutlich ` +
    `personenbezogene Daten (${list}). Prüf sie bitte vor dem Speichern: keine Namen oder anderen personenbezogenen Daten.`
  );
}

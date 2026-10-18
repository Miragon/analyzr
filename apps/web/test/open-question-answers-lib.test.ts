/**
 * The web's side of notes and answers (M6 S5a, S5c-1,
 * `src/lib/open-question-answers.ts`): where a note lands and what the
 * dialog says about it, how stored answers count, the reading of a
 * filled-in sheet and the German texts of its preview.
 */
import type { AnswerSheetRowResult, OpenQuestionSubjectType } from '@analyzr/client';
import { personalDataWarnings } from '@analyzr/contracts/personal-data';
import { describe, expect, it } from 'vitest';

import {
  AGENTS_SENTENCE,
  AGENTS_SENTENCE_ANSWER,
  ANSWER_ROLE_LABELS,
  ANSWER_TARGET_LABELS,
  HOLD_STAYS,
  NOTE_KEEPS_OPEN,
  NOTE_UNTIL_IMPORT,
  SHEET_KIND_LABELS,
  answerTargetOf,
  answersSummaryText,
  endsByAction,
  noteEffectText,
  noteKeepsOpen,
  notesBeforeText,
  charCountText,
  decodeSheet,
  personalDataFindings,
  readSheet,
  readSheetBytes,
  sheetBodyBytes,
  sheetGroups,
  sheetPersonalDataText,
  sheetResult,
  sheetSummaryText,
} from '../src/lib/open-question-answers';

const SUBJECTS: OpenQuestionSubjectType[] = [
  'ref',
  'process',
  'model',
  'relation',
  'placement',
  'step',
  'value-chain',
];

const csv = (lines: string[][]) =>
  `\uFEFF${lines.map((l) => l.map((c) => `"${c.replaceAll('"', '""')}"`).join(';')).join('\r\n')}\r\n`;
const HEADER = ['id', 'Art', 'Frage', 'Ansprechpartner-Hinweis', 'Antwort', 'Antwortart'];

describe('where an answer lands', () => {
  it('is a note on a relation or a placement, else the question itself', () => {
    expect(SUBJECTS.map((type) => [type, answerTargetOf({ type })])).toEqual([
      ['ref', 'answer'],
      ['process', 'answer'],
      ['model', 'answer'],
      ['relation', 'relation-note'],
      ['placement', 'placement-note'],
      ['step', 'answer'],
      ['value-chain', 'answer'],
    ]);
  });

  it('says the agents sentence for relations only, and that a note leaves the item open', () => {
    for (const type of SUBJECTS) {
      const text = noteEffectText({ kind: 'call-target-unknown', subject: { type } });
      expect(text.includes(AGENTS_SENTENCE)).toBe(type === 'relation');
      expect(text).toContain(NOTE_KEEPS_OPEN);
      if (['ref', 'process', 'model'].includes(type)) {
        expect(text).toContain('ergänze es im Quellwerkzeug und importiere das Modell erneut');
      }
      if (type === 'step' || type === 'value-chain') {
        expect(text).toContain('Fehlt ein Modell, importiere es.');
      }
    }
    // „mögliche Relation“, never „Paar“ (glossary): the relation the note is on.
    expect(AGENTS_SENTENCE).toBe(
      'Die Agenten berücksichtigen die Notiz, sobald sie diese Relation neu bewerten.',
    );
  });

  it('says how a note-only item ends: with the next import, not by an action (S5c-1)', () => {
    const noteOnly = [{ type: 'note' as const }];
    const text = noteEffectText({
      kind: 'undocumented-process',
      subject: { type: 'process' },
      actions: noteOnly,
    });
    expect(text).toContain(NOTE_UNTIL_IMPORT);
    expect(text).not.toContain(NOTE_KEEPS_OPEN);
    expect(endsByAction({ actions: noteOnly })).toBe(false);
    expect(noteKeepsOpen({ actions: [{ type: 'outside' }, { type: 'note' }] })).toBe(
      NOTE_KEEPS_OPEN,
    );
    expect(NOTE_UNTIL_IMPORT).toBe(
      'Die Frage bleibt offen, bis das Modell mit der Ergänzung neu importiert ist.',
    );
  });

  it("makes the process due on an agent's placement question only; a held placement stays held", () => {
    const asked = noteEffectText({ kind: 'agent-question', subject: { type: 'placement' } });
    expect(asked).toContain('Der Prozess wird damit fällig');
    expect(asked).toContain('eingeplant wird dadurch noch keine');
    // A held placement homes its process: it never becomes due, no agent gets it.
    const held = noteEffectText({ kind: 'held', subject: { type: 'placement' } });
    expect(held).not.toContain('fällig');
    expect(held).not.toContain('Platzierungsagent');
    // A hold's note is its answer: „Antwort“ throughout, and the decision named without a
    // control (the card, the „Vorgemerkt“ row and the review screen each have their own).
    expect(held).toBe(
      'Die Antwort wird an der Platzierung gespeichert. Die Platzierung bleibt vorgemerkt, bis du ' +
        'sie entscheidest; solange bekommt kein Agent den Prozess.',
    );
    const heldRelation = noteEffectText({ kind: 'held', subject: { type: 'relation' } });
    expect(heldRelation).toBe(
      `Die Antwort wird an der Relation gespeichert. ${AGENTS_SENTENCE_ANSWER} ${HOLD_STAYS}`,
    );
    expect(AGENTS_SENTENCE_ANSWER).toBe(
      'Die Agenten berücksichtigen die Antwort, sobald sie diese Relation neu bewerten.',
    );
    expect(HOLD_STAYS).toBe('Die Vormerkung bleibt, bis du sie entscheidest.');
    for (const text of [held, heldRelation]) {
      expect(text).not.toMatch(/Notiz|Paar|Jetzt entscheiden/);
    }
    expect(noteEffectText({ kind: 'agent-question', subject: { type: 'relation' } })).not.toContain(
      'Vormerkung',
    );
  });

  it('names how stored answers count: notes, and the outside mark (S5c-1)', () => {
    expect(ANSWER_ROLE_LABELS).toEqual({
      note: 'Notiz',
      'outside-mark': 'Liegt außerhalb der Landschaft',
    });
    // a sheet row records a note, or (an S5a sheet's „Liegt außerhalb …“) the mark
    expect(SHEET_KIND_LABELS).toEqual({
      answer: 'Notiz',
      'outside-landscape': 'Liegt außerhalb der Landschaft',
      'will-be-modelled': 'Notiz',
    });
    // the contracts' terms are the web's: Relation, Platzierung
    expect(ANSWER_TARGET_LABELS).toEqual({
      'relation-note': 'als Notiz an der Relation',
      'placement-note': 'als Notiz an der Platzierung',
      answer: 'bei der Frage',
    });
    const at = '2026-10-17T10:00:00.000Z';
    expect(answersSummaryText([])).toBe('');
    expect(
      answersSummaryText([
        { role: 'note', withdrawal: null },
        { role: 'note', withdrawal: null },
      ]),
    ).toBe('2 Notizen');
    expect(
      answersSummaryText([
        { role: 'note', withdrawal: null },
        { role: 'outside-mark', withdrawal: null },
      ]),
    ).toBe('1 Notiz · Als außerhalb markiert');
    expect(
      answersSummaryText([{ role: 'outside-mark', withdrawal: { by: 'owner', seq: 9, at } }]),
    ).toBe('Markierung zurückgenommen');
    expect(charCountText(1234)).toBe('1.234 von 2.000 Zeichen');
  });

  it('says that a new note joins the earlier ones', () => {
    expect(notesBeforeText(0)).toBeNull();
    expect(notesBeforeText(1)).toBe(
      'Schon eine Notiz. Deine kommt hinzu; die bisherige bleibt stehen.',
    );
    // A hold's notes are its answers.
    expect(notesBeforeText(1, 'Deine', true)).toBe(
      'Schon eine Antwort. Deine kommt hinzu; die bisherige bleibt stehen.',
    );
    expect(notesBeforeText(2, 'Deine', true)).toBe(
      'Schon 2 Antworten. Deine kommt hinzu; die bisherigen bleiben stehen.',
    );
    expect(answersSummaryText([{ role: 'note', withdrawal: null }], true)).toBe('1 Antwort');
    expect(notesBeforeText(3, 'Diese')).toBe(
      'Schon 3 Notizen. Diese kommt hinzu; die bisherigen bleiben stehen.',
    );
  });

  it('names what the personal-data check found', () => {
    const text = 'Ruf an: +49 89 1234567 oder schreib an a.b@example.org';
    expect(personalDataFindings(text, personalDataWarnings(text))).toEqual([
      { kind: 'phone', label: 'Telefonnummer', found: '+49 89 1234567' },
      { kind: 'email', label: 'E-Mail-Adresse', found: 'a.b@example.org' },
    ]);
  });
});

describe('reading a filled-in sheet', () => {
  it('keeps the filled rows with their cells as written and their spreadsheet rows, the columns found by name', () => {
    const read = readSheet(
      'a.csv',
      csv([
        HEADER,
        ['q-0000000000000001', 'Befund', 'Frage?', '', ' Die Buchhaltung. ', 'antwort'],
        ['q-0000000000000002', 'Befund', 'Frage?', '', '', ''],
        ['q-0000000000000003', 'Befund', 'Frage?', '', '  ', 'Antwort'],
        ['q-0000000000000004', 'Befund', 'Frage?', '', 'Der Einkauf.', ''],
      ]),
    );
    expect(read).toEqual({
      ok: true,
      filled: [
        {
          line: 2,
          cells: { id: 'q-0000000000000001', text: ' Die Buchhaltung. ', kind: 'antwort' },
        },
        { line: 5, cells: { id: 'q-0000000000000004', text: 'Der Einkauf.', kind: '' } },
      ],
      ignored: 2,
    });
    // moved columns, a comma, no Antwortart
    expect(readSheet('b.csv', 'Antwort,id\r\n"Ja, so",q-0000000000000001\r\n')).toEqual({
      ok: true,
      filled: [{ line: 2, cells: { id: 'q-0000000000000001', text: 'Ja, so', kind: '' } }],
      ignored: 0,
    });
  });

  it('numbers the rows as the spreadsheet does, after a blank row or blank lines before the header', () => {
    const text =
      '\r\n;;;;;\r\n' +
      csv([HEADER, ['q-0000000000000001', '', '', '', 'A', '']]).slice(1) +
      ';;;;;\r\n' +
      csv([['q-0000000000000002', '', '', '', 'B', '']]).slice(1);
    const read = readSheet('c.csv', text);
    expect(read.ok && read.filled.map((f) => [f.cells.id, f.line])).toEqual([
      ['q-0000000000000001', 4],
      ['q-0000000000000002', 6],
    ]);
    // The server numbers the rows it got; the preview says the spreadsheet's rows.
    if (!read.ok) throw new Error('not read');
    expect(
      sheetResult(
        {
          dryRun: true,
          counts: { recorded: 0, unchanged: 0, unknown: 2, invalid: 0, ignored: 0 },
          rows: [
            { row: 1, id: 'q-0000000000000001', outcome: 'unknown', warnings: [] },
            { row: 2, id: 'q-0000000000000002', outcome: 'unknown', warnings: [] },
          ],
        },
        { ...read, ignored: 3 },
      ),
    ).toMatchObject({
      counts: { unknown: 2, ignored: 3 },
      rows: [{ row: 4 }, { row: 6 }],
    });
  });

  it('reads UTF-8 only: a sheet saved as ANSI is refused, so no umlaut is stored as „�“', () => {
    const utf8 = new TextEncoder().encode('\uFEFFid;Antwort\r\nq-1;Prüfung\r\n');
    expect(decodeSheet(utf8)).toBe('id;Antwort\r\nq-1;Prüfung\r\n');
    // „Prüfung“ in Windows-1252, as German Excel saves „CSV (Trennzeichen-getrennt)“
    const cp1252 = new Uint8Array([
      ...new TextEncoder().encode('id;Antwort\r\nq-1;Pr'),
      0xfc,
      ...new TextEncoder().encode('fung\r\n'),
    ]);
    expect(decodeSheet(cp1252)).toBeNull();
    const read = readSheetBytes('ansi.csv', cp1252);
    expect(read).toEqual({
      ok: false,
      message:
        '„ansi.csv“ ist nicht als UTF-8 gespeichert, so würden Umlaute verfälscht. Speichere die Datei im Tabellenprogramm als „CSV UTF-8 (durch Trennzeichen getrennt)“ und wähl sie erneut.',
    });
    expect(readSheetBytes('utf8.csv', utf8)).toMatchObject({
      ok: true,
      filled: [{ line: 2, cells: { text: 'Prüfung' } }],
    });
  });

  it('refuses a file without the export’s columns, without rows, or that is no CSV', () => {
    const columns = readSheet('x.csv', 'Frage;Kommentar\r\na;b\r\n');
    expect(columns.ok).toBe(false);
    expect(!columns.ok && columns.message).toContain(
      '„x.csv“ hat keine Spalten „id“ und „Antwort“',
    );
    const empty = readSheet('y.csv', csv([HEADER]));
    expect(!empty.ok && empty.message).toBe('„y.csv“ hat unter der Kopfzeile keine Zeile.');
    // the parser's problem in German, with the row
    const broken = readSheet('z.csv', 'id;Antwort\r\n"q-1;"offen\r\n');
    expect(!broken.ok && broken.message).toBe(
      '„z.csv“ lässt sich nicht als CSV lesen: nach einem schließenden Anführungszeichen folgt noch Text (Zeile 2). Speichere sie im Tabellenprogramm als CSV und versuch es erneut.',
    );
    const open = readSheet('o.csv', 'id;Antwort\r\nq-1;"offen\r\n');
    expect(!open.ok && open.message).toContain(
      'lässt sich nicht als CSV lesen: ein Feld in Anführungszeichen wird nicht geschlossen (Zeile 2).',
    );
  });

  it('counts only the filled rows against what one call takes', () => {
    // A full export with few answers: the empty rows are not sent, so it fits.
    const empty = Array.from({ length: 6000 }, (_, i) => [`q-${i}`, '', '', '', '', '']);
    const few = readSheet('voll.csv', csv([HEADER, ...empty, ['q-x', '', '', '', 'Ja', '']]));
    expect(few).toMatchObject({ ok: true, filled: [{ line: 6002 }], ignored: 6000 });
    const lines = [
      HEADER,
      ...Array.from({ length: 5001 }, (_, i) => [`q-${i}`, '', '', '', 'x', '']),
    ];
    const read = readSheet('gross.csv', csv(lines));
    expect(!read.ok && read.message).toContain(
      'hat 5.001 ausgefüllte Antworten; analyzr nimmt höchstens 5.000',
    );
  });

  it('measures the request body in bytes', () => {
    expect(sheetBodyBytes([{ id: 'q', text: 'ä', kind: '' }])).toBe(
      new TextEncoder().encode('{"rows":[{"id":"q","text":"ä","kind":""}]}').length,
    );
  });
});

describe('the preview’s texts', () => {
  const row = (
    n: number,
    outcome: AnswerSheetRowResult['outcome'],
    warnings: AnswerSheetRowResult['warnings'] = [],
  ): AnswerSheetRowResult => ({ row: n, id: `q-${n}`, outcome, warnings });

  it('counts what becomes of the rows, before and after storing', () => {
    const counts = { recorded: 3, unchanged: 1, unknown: 2, invalid: 1, ignored: 4 };
    expect(sheetSummaryText({ dryRun: true, counts })).toBe(
      '3 Antworten werden gespeichert, 1 ist schon gespeichert, 2 unbekannte Kennungen, 1 ungültige Zeile, 4 Zeilen ohne Antwort.',
    );
    expect(
      sheetSummaryText({
        dryRun: false,
        counts: { recorded: 1, unchanged: 2, unknown: 0, invalid: 0, ignored: 1 },
      }),
    ).toBe('1 Antwort gespeichert, 2 sind schon gespeichert, 1 Zeile ohne Antwort.');
  });

  it('groups the rows by outcome, in sheet order', () => {
    const groups = sheetGroups({
      rows: [row(1, 'unknown'), row(2, 'recorded'), row(3, 'invalid'), row(4, 'recorded')],
    });
    const rowsOf = (list: readonly AnswerSheetRowResult[]) => list.map((r) => r.row);
    expect({
      recorded: rowsOf(groups.recorded),
      unchanged: rowsOf(groups.unchanged),
      unknown: rowsOf(groups.unknown),
      invalid: rowsOf(groups.invalid),
    }).toEqual({
      recorded: [2, 4],
      unchanged: [],
      unknown: [1],
      invalid: [3],
    });
  });

  it('gives the personal-data hint once for every flagged row it is given', () => {
    expect(sheetPersonalDataText([row(1, 'recorded')])).toBeNull();
    expect(
      sheetPersonalDataText([
        row(1, 'recorded', [{ kind: 'email', start: 0, end: 3 }]),
        row(2, 'unknown', [
          { kind: 'iban', start: 0, end: 3 },
          { kind: 'email', start: 5, end: 9 },
        ]),
        row(3, 'recorded'),
      ]),
    ).toBe(
      '2 Antworten enthalten vermutlich personenbezogene Daten (E-Mail-Adresse oder IBAN). Prüf sie bitte vor dem Speichern: keine Namen oder anderen personenbezogenen Daten.',
    );
  });
});

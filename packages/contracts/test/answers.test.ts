/**
 * The zod-free parts of answering open questions (M6 S5a): the
 * personal-data check (true and false positives on texts as process
 * landscapes have them), the answer kinds and their labels, and the reader
 * of a filled-in sheet.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { OPEN_QUESTION_ANSWER_KINDS, OpenQuestionAnswerKind } from '../src/api/open-questions.ts';
import { CsvError, readAnswerSheet } from '../src/open-question-csv.ts';
import {
  OPEN_QUESTION_ANSWER_KIND_LABELS,
  answerKindFromCell,
} from '../src/open-question-labels.ts';
import {
  PERSONAL_DATA_KINDS,
  personalDataHint,
  personalDataWarnings,
} from '../src/personal-data.ts';

/** The kinds and matched texts the check finds in `text`. */
const found = (text: string) =>
  personalDataWarnings(text).map((w) => [w.kind, text.slice(w.start, w.end)]);

describe('the personal-data check', () => {
  it.each([
    ['Schreib an max.mustermann@example.org.', [['email', 'max.mustermann@example.org']]],
    [
      'Kontakt: Jörg.Müller+rechnung@stadtwerke-auen.de',
      [['email', 'Jörg.Müller+rechnung@stadtwerke-auen.de']],
    ],
    ['(an: a_b@mail.co.uk)', [['email', 'a_b@mail.co.uk']]],
    ['Ruf +49 89 1234567 an.', [['phone', '+49 89 1234567']]],
    ['Tel. 0049 (0)89 123 456 78', [['phone', '0049 (0)89 123 456 78']]],
    ['Durchwahl 089/12345-678', [['phone', '089/12345-678']]],
    [
      'mobil 0171-1234567 oder (089) 123456',
      [
        ['phone', '0171-1234567'],
        ['phone', '(089) 123456'],
      ],
    ],
    ['Festnetz 03433 1234.', [['phone', '03433 1234']]],
    ['Zentrale 089 / 123456', [['phone', '089 / 123456']]],
    ['Zentrale 089 / 12 34 56.', [['phone', '089 / 12 34 56']]],
    [
      'Berlin 030 - 123456 oder 030 – 1234567',
      [
        ['phone', '030 - 123456'],
        ['phone', '030 – 1234567'],
      ],
    ],
    ['mobil 01711234567', [['phone', '01711234567']]],
    ['Rückruf: 0815 4711 2222', [['phone', '0815 4711 2222']]],
    ['IBAN DE89 3704 0044 0532 0130 00 bitte', [['iban', 'DE89 3704 0044 0532 0130 00']]],
    ['iban: de89370400440532013000', [['iban', 'de89370400440532013000']]],
    ['GB82 WEST 1234 5698 7654 32.', [['iban', 'GB82 WEST 1234 5698 7654 32']]],
  ])('finds personal data in %j', (text, expected) => {
    expect(found(text)).toEqual(expected);
  });

  it.each([
    'Rechnung vom 01.10.2026 über 1.000.000 €',
    'Stichtag 2026-10-16T12:00:00Z, Zeitraum 2020-2024, Uhrzeit 10:30',
    'Datum 01-10-2026 und 16/10/2026',
    'Element Activity_0p2x9ab und Task_0123456789 in Process_1',
    'Frage q-3f2a9c41d07be815 zu mdl_01J9Z3N4X5Q6R7S8T9V0W1X2Y3',
    'PLZ 80331 München, Version 1.2.3, Anteil 0,5 und +1 Tag',
    'Bestellnummer 0004711000 und Artikel 12345678901',
    'Kurz 0891234 und 01234567',
    'IBAN mit falscher Prüfziffer DE00 3704 0044 0532 0130 00',
    'Prozess@Lager und @Kunde und a@b.c',
    'Signal „Order@Received“, Nachricht DE12AB',
    // SAP-style document numbers and ids, not phone numbers.
    'Fakturen 0090001234 und 0080012345',
    'Sachkonto 0815 4711 2222',
    'Prozess-ID 0123-4567-89',
    'Rechnung 0123456789',
    'Belegnummer: 0815-4711-22',
    'Nummernkreis 0123 4567 890',
  ])('finds nothing in %j', (text) => {
    expect(found(text)).toEqual([]);
  });

  it('claims an IBAN before its digits could look like a phone number, ordered by position', () => {
    const text = 'Tel. +49 30 1234567, IBAN DE89 3704 0044 0532 0130 00, Mail x@y.de';
    expect(personalDataWarnings(text)).toEqual([
      { kind: 'phone', start: 5, end: 19 },
      { kind: 'iban', start: 26, end: 53 },
      { kind: 'email', start: 60, end: 66 },
    ]);
  });

  it('stays fast on long texts', () => {
    const text = `${'0 1 2 3 4 5 6 7 8 9 '.repeat(100)}x ${'a.b-c_d%e+f'.repeat(150)}@`;
    const started = performance.now();
    personalDataWarnings(text);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('says in German what it found, once', () => {
    expect(personalDataHint([])).toBeNull();
    expect(personalDataHint(personalDataWarnings('a@b.de'))).toBe(
      'Der Text enthält vermutlich eine E-Mail-Adresse. Prüf bitte, ob das wirklich ' +
        'gespeichert werden soll: keine Namen oder anderen personenbezogenen Daten.',
    );
    expect(
      personalDataHint(
        personalDataWarnings('a@b.de, c@d.de, 0171 1234567, DE89370400440532013000'),
      ),
    ).toMatch(
      /^Der Text enthält vermutlich 2 E-Mail-Adressen, eine Telefonnummer und eine IBAN\. /,
    );
    expect(PERSONAL_DATA_KINDS).toEqual(['email', 'phone', 'iban']);
  });

  it('is zod-free, so the web can load it in a lazy chunk', () => {
    for (const file of ['personal-data.ts', 'open-question-csv.ts', 'open-question-labels.ts']) {
      const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
      expect(source, file).not.toMatch(/^import (?!type )/m);
    }
  });
});

describe('the answer kinds', () => {
  it('label each kind as the sheet names it', () => {
    expect(OpenQuestionAnswerKind.options.map((k) => OPEN_QUESTION_ANSWER_KIND_LABELS[k])).toEqual([
      ...OPEN_QUESTION_ANSWER_KINDS,
    ]);
  });

  it.each([
    ['', 'answer'],
    ['  ', 'answer'],
    ['Antwort', 'answer'],
    ['Liegt außerhalb der Landschaft', 'outside-landscape'],
    ['  liegt  AUSSERHALB der landschaft ', null],
    ['  liegt  außerhalb der LANDSCHAFT ', 'outside-landscape'],
    // decomposed umlauts and ß, as some programs write them
    ['Liegt au\u00DFerhalb der Landschaft'.normalize('NFD'), 'outside-landscape'],
    ['Wird im Modell erga\u0308nzt', 'will-be-modelled'],
    ['Wird im Modell ergänzt', 'will-be-modelled'],
    ['will-be-modelled', 'will-be-modelled'],
    ['Vielleicht', null],
    ['constructor', null],
  ])('reads the cell %j as %j', (cell, kind) => {
    expect(answerKindFromCell(cell)).toBe(kind);
  });
});

describe('the answer sheet reader', () => {
  it('finds the columns by name, keeps every row and the formula protection undone', () => {
    const csv =
      '﻿"Antwortart";"id";"Frage";"Antwort"\r\n' +
      '"";"q-0000000000000001";"Wer?";"\'=Niemand"\r\n' +
      '"Wird im Modell ergänzt";" q-0000000000000002 ";"Was?";"Zeile 1\nZeile 2"\r\n' +
      '"";"q-0000000000000003";"Wie?";""\r\n';
    expect(readAnswerSheet(csv)).toEqual([
      { id: 'q-0000000000000001', text: '=Niemand', kind: '', line: 2 },
      {
        id: 'q-0000000000000002',
        text: 'Zeile 1\nZeile 2',
        kind: 'Wird im Modell ergänzt',
        line: 3,
      },
      { id: 'q-0000000000000003', text: '', kind: '', line: 4 },
    ]);
    // Saved again by a spreadsheet: `,` separated, without the kind column.
    expect(readAnswerSheet('id,Antwort\nq-0000000000000004,Ja\n')).toEqual([
      { id: 'q-0000000000000004', text: 'Ja', kind: '', line: 2 },
    ]);
  });

  it('numbers each row as the spreadsheet does, blank rows and the header counted', () => {
    // Two blank lines before the header, a cleared row in the middle, a cell with a line break.
    const csv =
      '\r\n;;\r\n"id";"Antwort";"Antwortart"\r\n' +
      '"q-0000000000000001";"A";""\r\n' +
      ';;\r\n' +
      '"q-0000000000000002";"B\r\nzweite Zeile";""\r\n' +
      '"q-0000000000000003";"C";""';
    expect(readAnswerSheet(csv).map((r) => [r.id, r.line])).toEqual([
      ['q-0000000000000001', 4],
      ['q-0000000000000002', 6],
      ['q-0000000000000003', 7],
    ]);
    // `,` as separator after a blank line: found on the header line.
    expect(readAnswerSheet('\nid,Antwort\nq-0000000000000004,"Ja; so"\n')).toEqual([
      { id: 'q-0000000000000004', text: 'Ja; so', kind: '', line: 3 },
    ]);
  });

  it('refuses a sheet without the id or the answer column, or that is no CSV, with a code', () => {
    expect(() => readAnswerSheet('"id";"Frage"\r\n"q-1";"x"\r\n')).toThrow(CsvError);
    expect(() => readAnswerSheet('"Frage";"Antwort"\r\n')).toThrow(/"id" or "Antwort"/);
    const codeOf = (text: string) => {
      try {
        readAnswerSheet(text);
      } catch (err) {
        if (err instanceof CsvError) return [err.code, err.line];
        throw err;
      }
      return null;
    };
    expect(codeOf('"Frage";"Antwort"\r\n')).toEqual(['missing-columns', null]);
    expect(codeOf('"id";"Antwort"\r\n"a";"b\r\n')).toEqual(['unterminated-quote', 2]);
    expect(codeOf('"id";"Antwort"\r\n\r\n"a"x;"b"\r\n')).toEqual(['text-after-quote', 3]);
  });
});

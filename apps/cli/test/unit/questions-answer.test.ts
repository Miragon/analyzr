/**
 * `analyzr questions answer` against a fake REST API (M6 S5a, §4.5; notes
 * since S5c-1, §4.8 b): one note with `<id> --text` (S5a's `--kind` refused
 * with the way to the outside mark), a filled-in sheet with `--from
 * [--dry-run]` (five columns, or S5a's six with `Antwortart`; only the filled
 * rows are sent; outcomes under their spreadsheet rows; exit 1 when a filled
 * row is left out), the owner key only, and every flag and the sheet checked
 * before any request.
 */
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  OPEN_QUESTION_CSV_COLUMNS,
  type AnswerOpenQuestionResult,
  type AnswerSheetResult,
  type OpenQuestion,
  type OpenQuestionAnswer,
} from '@analyzr/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  actionCommand,
  describePersonalData,
  parseNoteText,
  resolvedBy,
  sheetResult,
} from '../../src/commands/questions-answer.ts';
import { runCli } from '../../src/program.ts';
import {
  AGENT_TOKEN,
  OWNER_KEY,
  fakeApi,
  json,
  ownerKeyFile,
  problem,
  tempDir,
  testIo,
} from '../support/io.ts';

let dir: string;
let keyFile: string;

beforeAll(async () => {
  dir = await tempDir();
  keyFile = await ownerKeyFile(dir);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const owner = (fetch: typeof globalThis.fetch) =>
  testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, fetch, { cwd: dir });

const Q1 = 'q-00000000000000a1';
const Q2 = 'q-00000000000000b2';
const Q3 = 'q-00000000000000c3';
const ONE = `POST /api/v1/projects/p/open-questions/${Q1}/answers`;
const SHEET = 'POST /api/v1/projects/p/open-questions/answers';

function question(extra: Partial<OpenQuestion> = {}): OpenQuestion {
  return {
    id: Q1,
    kind: 'held',
    source: 'hold',
    subject: { type: 'relation', id: 'rel_1' },
    subjectLabel: '„A“ → „B“',
    modelKeys: ['finanzen/gutschrift', 'vertrieb/auftrag'],
    text: 'Wer verschickt\ndie Mahnung?',
    context: 'Mit Finanzen klären.',
    label: null,
    askWho: { lanes: [], stepOwners: [], folder: 'finanzen' },
    unlocks: 3,
    refs: ['finanzen/gutschrift#Call_Brief'],
    raisedBy: { sourceKind: 'human', handle: 'owner', seq: 9 },
    state: 'open',
    answers: [],
    actions: [],
    ...extra,
  };
}

function answer(extra: Partial<OpenQuestionAnswer> = {}): OpenQuestionAnswer {
  return {
    id: 'oqa_1',
    questionId: Q1,
    kind: 'answer',
    role: 'note',
    target: 'relation-note',
    text: 'Finanzen, immer.',
    note: { type: 'relation', subjectId: 'rel_1', assertionId: 'asr_1' },
    by: 'owner',
    sourceKind: 'human',
    seq: 12,
    at: '2026-10-16T10:00:00.000Z',
    withdrawal: null,
    ...extra,
  };
}

/** The note's result: a note leaves the item's state as it was. */
function answered(
  a: OpenQuestionAnswer,
  result: 'recorded' | 'unchanged' = 'recorded',
  extra: Partial<OpenQuestion> = {},
) {
  const body: AnswerOpenQuestionResult = {
    result,
    answer: a,
    question: question({ answers: [a], ...extra }),
    warnings: [],
  };
  return body;
}

const DECIDE: OpenQuestion['actions'] = [
  {
    type: 'decide',
    primary: true,
    label: 'Entscheiden',
    decides: [{ type: 'relation', id: 'rel_1', version: 2 }],
  },
  { type: 'note', primary: false, label: 'Notiz hinzufügen' },
];
const LINK: OpenQuestion['actions'] = [
  { type: 'link', primary: true, label: 'Verknüpfen mit …', pick: 'process', suggested: [] },
  { type: 'outside', primary: false, label: 'Liegt außerhalb der Landschaft' },
  { type: 'note', primary: false, label: 'Notiz hinzufügen' },
];

describe('analyzr questions answer <id> (one answer)', () => {
  it('posts the trimmed text, and nothing else, with the owner key and says where the note landed', async () => {
    const bodies: unknown[] = [];
    const api = fakeApi({
      [ONE]: async (req) => {
        bodies.push(await req.json());
        return json(answered(answer(), 'recorded', { actions: DECIDE }), 201);
      },
    });
    const t = owner(api.fetch);
    expect(
      await runCli(['questions', 'answer', Q1, '-p', 'p', '--text', '  Finanzen, immer.\n'], t.io),
    ).toBe(0);
    expect(api.seen).toHaveLength(1);
    expect(api.seen[0]?.authorization).toBe(`Bearer ${OWNER_KEY}`);
    // Since M6 S5c-1 the server takes no kind: an answer is a note.
    expect(bodies).toEqual([{ text: 'Finanzen, immer.' }]);
    expect(t.err()).toBe('');
    expect(t.out()).toBe(
      [
        `p: note on ${Q1} recorded, as a note on relation rel_1`,
        '  „A“ → „B“: Wer verschickt die Mahnung?',
        '  agents take the note into account when the pair is judged again; the hold stays until a human decides it',
        '  a note leaves the question open; its action „Entscheiden“: in the web UI',
        '',
      ].join('\n'),
    );
  });

  it('prints a placement note, a kept answer, an unchanged one and the personal-data warning', async () => {
    const placement = answer({
      target: 'placement-note',
      note: { type: 'placement', subjectId: 'plc_1', assertionId: 'pas_1' },
    });
    const onPlacement = (kind: OpenQuestion['kind']) => ({
      kind,
      subject: { type: 'placement' as const, id: 'plc_1' },
    });
    const p = owner(
      fakeApi({
        [ONE]: () => json(answered(placement, 'recorded', onPlacement('agent-question')), 201),
      }).fetch,
    );
    expect(await runCli(['questions', 'answer', Q1, '-p', 'p', '--text', 'x'], p.io)).toBe(0);
    expect(p.out()).toContain(`p: note on ${Q1} recorded, as a note on placement plc_1\n`);
    expect(p.out()).toContain(
      '  the process is due again; nothing is queued (analyzr value-chain requeue queues the placement task)\n',
    );
    // A held placement keeps homing its process: nothing becomes due.
    const h = owner(
      fakeApi({ [ONE]: () => json(answered(placement, 'recorded', onPlacement('held')), 201) })
        .fetch,
    );
    expect(await runCli(['questions', 'answer', Q1, '-p', 'p', '--text', 'x'], h.io)).toBe(0);
    expect(h.out()).toContain(
      '  the placement stays held, so no agent gets the process: decide the hold in the review screen of the web UI\n',
    );
    expect(h.out()).not.toContain('due');
    // A step: the value chain is the way in.
    const step = owner(
      fakeApi({
        [ONE]: () =>
          json(
            answered(answer({ target: 'answer', note: null }), 'recorded', {
              kind: 'step-without-process',
              subject: { type: 'step', id: 'step-1' },
            }),
            201,
          ),
      }).fetch,
    );
    expect(await runCli(['questions', 'answer', Q1, '-p', 'p', '--text', 'x'], step.io)).toBe(0);
    expect(step.out()).toContain(
      '  no agent sees it yet; to change the analysis, adjust the value chain or place processes on it, or import the missing model\n',
    );

    const text = 'Liegt bei der Bank, Kontakt max.muster@example.org oder +49 30 1234567.';
    const kept = answer({ target: 'answer', note: null, text });
    const warned: AnswerOpenQuestionResult = {
      ...answered(kept, 'recorded', {
        kind: 'call-target-unknown',
        subject: { type: 'ref', id: 'finanzen/gutschrift#Call_Brief' },
        actions: LINK,
      }),
      warnings: [
        { kind: 'email', start: 28, end: 50 },
        { kind: 'phone', start: 56, end: 70 },
      ],
    };
    const k = owner(fakeApi({ [ONE]: () => json(warned, 201) }).fetch);
    expect(await runCli(['questions', 'answer', Q1, '-p', 'p', '--text', text], k.io)).toBe(0);
    expect(k.out()).toBe(
      [
        `p: note on ${Q1} recorded, kept with the question`,
        '  „A“ → „B“: Wer verschickt die Mahnung?',
        '  no agent sees it yet; to change the analysis, change the model (e.g. its documentation) and import it again',
        `  a note leaves the question open; its action „Verknüpfen mit …“: analyzr questions link ${Q1} -p p --to <target>`,
        '  warning: the note probably contains an e-mail address (characters 29–50) and a phone number (characters 57–70)',
        '  notes take no names or other personal data, and a recorded note cannot be deleted',
        '',
      ].join('\n'),
    );

    const same = owner(fakeApi({ [ONE]: () => json(answered(answer(), 'unchanged')) }).fetch);
    expect(
      await runCli(['questions', 'answer', Q1, '-p', 'p', '--text', 'Finanzen, immer.'], same.io),
    ).toBe(0);
    expect(same.out()).toBe(
      [
        `p: note on ${Q1} unchanged: the latest note says the same (oqa_1)`,
        '  „A“ → „B“: Wer verschickt die Mahnung?',
        '',
      ].join('\n'),
    );
  });

  it('--json prints the result', async () => {
    const result = answered(answer());
    const t = owner(fakeApi({ [ONE]: () => json(result, 201) }).fetch);
    expect(
      await runCli(
        ['questions', 'answer', Q1, '-p', 'p', '--text', 'Finanzen, immer.', '--json'],
        t.io,
      ),
    ).toBe(0);
    expect(JSON.parse(t.out())).toEqual(result);
  });

  it("reports the server's problem: an id that names no current question, the read-only demo", async () => {
    const gone = owner(
      fakeApi({
        [ONE]: () =>
          problem(
            404,
            'not-found',
            'open question not found; its id changes when its source changes, so list the questions again',
          ),
      }).fetch,
    );
    expect(await runCli(['questions', 'answer', Q1, '-p', 'p', '--text', 'x'], gone.io)).toBe(1);
    expect(gone.err()).toBe(
      `analyzr: answer ${Q1} in p failed (404 not-found): open question not found; its id changes when its source changes, so list the questions again\n`,
    );
    const demo = owner(
      fakeApi({ [ONE]: () => problem(403, 'demo-readonly', 'the demo is read-only') }).fetch,
    );
    expect(await runCli(['questions', 'answer', Q1, '-p', 'p', '--text', 'x'], demo.io)).toBe(1);
    expect(demo.err()).toContain('(403 demo-readonly): the demo is read-only');
    expect(demo.out()).toBe('');
  });

  it("refuses S5a's --kind with the way to the outside mark; normalizes the note as the server stores it", async () => {
    const none = fakeApi({});
    for (const kind of ['antwort', 'ausserhalb', 'ergänzt', '']) {
      const t = owner(none.fetch);
      expect(
        await runCli(['questions', 'answer', Q1, '-p', 'p', '--text', 'x', '--kind', kind], t.io),
        kind,
      ).toBe(1);
      expect(t.err()).toBe(
        `analyzr: --kind is gone since M6 S5c-1: every answer is a note, so drop it; to mark a question outside the landscape run analyzr questions outside ${Q1} -p p\n`,
      );
    }
    expect(none.seen).toHaveLength(0);
    expect(parseNoteText('  a\tb\nc  ')).toBe('a\tb\nc');
    // as the server stores it: LF line breaks, composed umlauts
    expect(parseNoteText('Zeile 1\r\nZeile 2\rerga\u0308nzt')).toBe('Zeile 1\nZeile 2\nergänzt');
    expect(() => parseNoteText(' ', '--note')).toThrow(
      'the note is empty: give a text with --note or drop it',
    );
  });

  it('says what resolves a question a note leaves open', () => {
    const q = question({ actions: LINK });
    expect(resolvedBy('p', q)).toBe(
      `a note leaves the question open; its action „Verknüpfen mit …“: analyzr questions link ${Q1} -p p --to <target>`,
    );
    // Answered (an outside mark), or only the note: nothing to add.
    expect(resolvedBy('p', { ...q, state: 'answered' })).toBeNull();
    expect(
      resolvedBy('p', question({ actions: [{ type: 'note', primary: true, label: 'Notiz' }] })),
    ).toBeNull();
    expect(resolvedBy('p', question())).toBeNull();
    const step = question({ subject: { type: 'step', id: 'step-versand' } });
    const model = question({ subject: { type: 'model', id: 'finanzen/gutschrift' } });
    expect(actionCommand('p', step, { type: 'place', pick: 'process' })).toBe(
      `analyzr questions place ${Q1} -p p --process <target>`,
    );
    expect(actionCommand('p', q, { type: 'place', step: '@outside' })).toBe(
      `analyzr questions place ${Q1} -p p --step @outside`,
    );
    expect(actionCommand('p', q, { type: 'place', pick: 'step' })).toBe(
      `analyzr questions place ${Q1} -p p --step <step>`,
    );
    expect(actionCommand('p', q, { type: 'link', pick: 'pair' })).toBe(
      `analyzr questions link ${Q1} -p p --pair <from> <to>`,
    );
    expect(actionCommand('p', q, { type: 'outside' })).toBe(`analyzr questions outside ${Q1} -p p`);
    expect(actionCommand('p', q, { type: 'note' })).toBe(
      `analyzr questions answer ${Q1} -p p --text <note>`,
    );
    expect(actionCommand('p', model, { type: 'requeue' })).toBe(
      'analyzr models requeue finanzen/gutschrift -p p',
    );
    for (const type of ['decide', 'choose-copy', 'fix-link'] as const) {
      expect(actionCommand('p', q, { type })).toBe('the web UI');
    }
  });

  it('names the personal data it found, counted from 1', () => {
    expect(describePersonalData([{ kind: 'iban', start: 0, end: 22 }])).toBe(
      'an IBAN (characters 1–22)',
    );
    expect(
      describePersonalData([
        { kind: 'email', start: 0, end: 5 },
        { kind: 'phone', start: 6, end: 9 },
        { kind: 'iban', start: 10, end: 30 },
      ]),
    ).toBe(
      'an e-mail address (characters 1–5), a phone number (characters 7–9) and an IBAN (characters 11–30)',
    );
  });
});

describe('analyzr questions answer (refused before any request)', () => {
  it('refuses an agent token: only humans answer', async () => {
    const none = fakeApi({});
    for (const argv of [
      ['questions', 'answer', Q1, '-p', 'p', '--text', 'x'],
      ['questions', 'answer', '-p', 'p', '--from', 'antworten.csv', '--dry-run'],
    ]) {
      const env = testIo({ ANALYZR_TOKEN: AGENT_TOKEN }, none.fetch, { cwd: dir });
      expect(await runCli(argv, env.io)).toBe(1);
      expect(env.err()).toBe(
        'analyzr: only humans answer open questions: analyzr questions answer uses the owner key (drop --token and unset ANALYZR_TOKEN)\n',
      );
      const flag = testIo({ ANALYZR_OWNER_KEY_FILE: keyFile }, none.fetch, { cwd: dir });
      expect(await runCli(['--token', AGENT_TOKEN, ...argv], flag.io)).toBe(1);
      expect(flag.err()).toContain('only humans answer open questions');
    }
    expect(none.seen).toHaveLength(0);
  });

  it('checks the id, the text, the kind and the flags', async () => {
    const none = fakeApi({});
    const cases: [string[], string][] = [
      [['q-1', '--text', 'x'], 'not an open question id: "q-1" (q- and 16 hex characters'],
      [[Q1.toUpperCase(), '--text', 'x'], 'not an open question id: '],
      [[Q1, '--text', '  \n '], 'the note is empty: give it with --text'],
      [[Q1, '--text', 'x'.repeat(2001)], 'the note has 2001 characters; at most 2000'],
      [[Q1, '--text', 'a\u0007b'], 'the note contains control characters'],
      [[Q1, '--text', 'x', '--kind', 'vielleicht'], '--kind is gone since M6 S5c-1'],
      [[Q1], 'give the question id and --text <note>, or --from <csv>'],
      [['--text', 'x'], 'give the question id and --text <note>, or --from <csv>'],
      [[Q1, '--text', 'x', '--dry-run'], '--dry-run previews a sheet: it needs --from <csv>'],
      [[Q1, '--from', 'a.csv'], '--from takes the ids and notes from the sheet: drop <id>'],
      [['--from', 'a.csv', '--text', 'x'], '--from takes the ids and notes from the sheet'],
      [
        ['--from', 'a.csv', '--kind', 'antwort'],
        '--kind is gone since M6 S5c-1: every answer is a note, so drop it; to mark a question outside the landscape run analyzr questions outside <id> -p p',
      ],
      [['--from', 'missing.csv'], 'missing.csv is not a file'],
    ];
    for (const [flags, message] of cases) {
      const t = owner(none.fetch);
      expect(
        await runCli(['questions', 'answer', '-p', 'p', ...flags], t.io),
        flags.join(' '),
      ).toBe(1);
      expect(t.err(), flags.join(' ')).toContain(message);
    }
    const missing = owner(none.fetch);
    expect(await runCli(['questions', 'answer', Q1, '--text', 'x'], missing.io)).toBe(1);
    expect(missing.err()).toContain('--project');
    expect(none.seen).toHaveLength(0);
  });
});

/** The header of an S5a sheet (six columns, with `Antwortart`), which still reads. */
const HEADER = '"id";"Art";"Frage";"Ansprechpartner-Hinweis";"Antwort";"Antwortart"';

/** A sheet as a spreadsheet saves the export again: byte order mark, `;`, CRLF. */
function csv(...rows: string[][]): string {
  const line = (cells: readonly string[]) =>
    cells.map((c) => `"${c.replaceAll('"', '""')}"`).join(';');
  return `\uFEFF${[HEADER, ...rows.map(line)].join('\r\n')}\r\n`;
}

async function sheetFile(name: string, content: string | Uint8Array): Promise<string> {
  await writeFile(path.join(dir, name), content);
  return name;
}

describe("analyzr questions answer --from (a filled-in sheet, S5a's six columns)", () => {
  const SHEET_CSV = csv(
    [Q1, 'Gehalten', 'Wer verschickt die Mahnung?', 'Ordner: finanzen', '', ''],
    [
      Q2,
      'Pool ohne Prozess',
      'Ist „Bank“ ein externer Partner?',
      'Ordner: finanzen',
      'Ja, die Hausbank; max@example.org',
      'Liegt außerhalb der Landschaft',
    ],
    [
      Q3,
      'Aufrufziel unbekannt',
      'Welchen Prozess ruft „Brief“ auf?',
      '',
      'Der Versand.\nImmer.',
      '',
    ],
    ['q-0000000000000000', '', '', '', 'Gibt es nicht mehr.', ''],
    [Q1, 'Gehalten', 'Wer verschickt die Mahnung?', 'Ordner: finanzen', 'Finanzen', 'vielleicht'],
    [Q3, '', '', '', 'Noch einmal.', ''],
    ['', '', '', '', '   ', ''],
  );

  /** What the server answers for the five filled rows (positions 1–5 of the request). */
  function serverResult(dryRun: boolean): AnswerSheetResult {
    const kept = answer({
      id: 'oqa_2',
      questionId: Q2,
      kind: 'outside-landscape',
      target: 'answer',
      note: null,
    });
    return {
      dryRun,
      counts: { recorded: 1, unchanged: 1, unknown: 1, invalid: 2, ignored: 0 },
      rows: [
        {
          row: 1,
          id: Q2,
          outcome: 'recorded',
          kind: 'outside-landscape',
          target: 'answer',
          ...(dryRun ? {} : { answer: kept }),
          warnings: [{ kind: 'email', start: 18, end: 33 }],
        },
        {
          row: 2,
          id: Q3,
          outcome: 'unchanged',
          kind: 'answer',
          target: 'relation-note',
          answer: answer({
            id: 'oqa_0',
            questionId: Q3,
            note: { type: 'relation', subjectId: 'rel_7', assertionId: 'asr_7' },
          }),
          warnings: [],
        },
        { row: 3, id: 'q-0000000000000000', outcome: 'unknown', warnings: [] },
        { row: 4, id: Q1, outcome: 'invalid', reason: 'unknown-kind', warnings: [] },
        { row: 5, id: Q3, outcome: 'invalid', reason: 'duplicate-id', warnings: [] },
      ],
    };
  }

  function sheetApi(seen: { url: URL; body: unknown }[] = []) {
    return fakeApi({
      [SHEET]: async (req, url) => {
        seen.push({ url, body: await req.json() });
        return json(serverResult(url.searchParams.get('dryRun') === 'true'));
      },
    });
  }

  it('--dry-run sends only the filled rows, as written, and lists them under their spreadsheet rows', async () => {
    const file = await sheetFile('antworten.csv', SHEET_CSV);
    const seen: { url: URL; body: unknown }[] = [];
    const api = sheetApi(seen);
    const t = owner(api.fetch);
    expect(
      await runCli(['questions', 'answer', '-p', 'p', '--from', file, '--dry-run'], t.io),
    ).toBe(1);
    expect(api.seen[0]?.authorization).toBe(`Bearer ${OWNER_KEY}`);
    expect(seen[0]?.url.searchParams.get('dryRun')).toBe('true');
    expect(seen[0]?.body).toEqual({
      rows: [
        {
          id: Q2,
          text: 'Ja, die Hausbank; max@example.org',
          kind: 'Liegt außerhalb der Landschaft',
        },
        { id: Q3, text: 'Der Versand.\nImmer.', kind: '' },
        { id: 'q-0000000000000000', text: 'Gibt es nicht mehr.', kind: '' },
        { id: Q1, text: 'Finanzen', kind: 'vielleicht' },
        { id: Q3, text: 'Noch einmal.', kind: '' },
      ],
    });
    expect(t.out()).toBe(
      [
        `  row 3  ${Q2}  would record  outside mark (the Antwortart of an earlier sheet), kept with the question`,
        '      warning: probably contains an e-mail address (characters 19–33)',
        `  row 4  ${Q3}  unchanged     note, as a note on relation rel_7`,
        '  row 5  q-0000000000000000  unknown       no current open question: a wrong id, or its source changed since the export',
        `  row 6  ${Q1}  invalid       unknown Antwortart "vielleicht" (a column of sheets exported before M6 S5c-1); one of „Antwort“, „Liegt außerhalb der Landschaft“, „Wird im Modell ergänzt“ or empty (a note)`,
        `  row 7  ${Q3}  invalid       row 4 answers the same question`,
        'p: antworten.csv (dry run, nothing recorded): 1 to record, 1 unchanged, 1 unknown, 2 invalid, 2 rows without an answer',
        'check the warned notes before recording them: notes take no names or other personal data, and a recorded note cannot be deleted',
        'run again without --dry-run to record them',
        '',
      ].join('\n'),
    );
    expect(t.err()).toBe(
      'analyzr: 3 rows would not be recorded (1 unknown, 2 invalid); an id changes when what it asks about changes: export the sheet again (analyzr questions -p p --format csv) and carry the answers over\n',
    );
  });

  it('records without --dry-run, prints the result as JSON for the whole sheet, and exits 1 for the rows left out', async () => {
    const file = await sheetFile('antworten-json.csv', SHEET_CSV);
    const seen: { url: URL; body: unknown }[] = [];
    const t = owner(sheetApi(seen).fetch);
    expect(await runCli(['questions', 'answer', '-p', 'p', '--from', file, '--json'], t.io)).toBe(
      1,
    );
    expect(seen[0]?.url.searchParams.get('dryRun')).toBe('false');
    const printed = JSON.parse(t.out()) as AnswerSheetResult;
    expect(printed.dryRun).toBe(false);
    expect(printed.counts).toEqual({
      recorded: 1,
      unchanged: 1,
      unknown: 1,
      invalid: 2,
      ignored: 2,
    });
    expect(printed.rows.map((r) => [r.row, r.id, r.outcome])).toEqual([
      [3, Q2, 'recorded'],
      [4, Q3, 'unchanged'],
      [5, 'q-0000000000000000', 'unknown'],
      [6, Q1, 'invalid'],
      [7, Q3, 'invalid'],
    ]);
    expect(printed.rows[0]?.answer?.id).toBe('oqa_2');
    expect(t.err()).toContain('analyzr: 3 rows not recorded (1 unknown, 2 invalid)');

    const text = owner(sheetApi().fetch);
    expect(await runCli(['questions', 'answer', '-p', 'p', '--from', file], text.io)).toBe(1);
    expect(text.out()).toContain(
      `  row 3  ${Q2}  recorded   outside mark (the Antwortart of an earlier sheet), kept with the question\n`,
    );
    expect(text.out()).toContain(
      'p: antworten-json.csv: 1 recorded, 1 unchanged, 1 unknown, 2 invalid, 2 rows without an answer\n',
    );
    expect(text.out()).toContain('check the warned notes: notes take no names');
    expect(text.out()).not.toContain('--dry-run');
  });

  it('exits 0 when every filled row is recorded or unchanged; a sheet without Antwortart and with `,` works', async () => {
    const file = await sheetFile(
      'komma.csv',
      `id,Frage,Antwort\n${Q2},"Ist ""Bank"" extern?",Ja\n${Q3},x,\n`,
    );
    const seen: { url: URL; body: unknown }[] = [];
    const api = fakeApi({
      [SHEET]: async (req, url) => {
        seen.push({ url, body: await req.json() });
        return json({
          dryRun: false,
          counts: { recorded: 1, unchanged: 0, unknown: 0, invalid: 0, ignored: 0 },
          rows: [
            {
              row: 1,
              id: Q2,
              outcome: 'recorded',
              kind: 'answer',
              target: 'answer',
              answer: answer({ questionId: Q2, target: 'answer', note: null, text: 'Ja' }),
              warnings: [],
            },
          ],
        } satisfies AnswerSheetResult);
      },
    });
    const t = owner(api.fetch);
    expect(await runCli(['questions', 'answer', '-p', 'p', '--from', file], t.io)).toBe(0);
    expect(seen[0]?.body).toEqual({ rows: [{ id: Q2, text: 'Ja', kind: '' }] });
    expect(t.out()).toBe(
      [
        `  row 2  ${Q2}  recorded  note, kept with the question`,
        'p: komma.csv: 1 recorded, 0 unchanged, 0 unknown, 0 invalid, 1 row without an answer',
        '',
      ].join('\n'),
    );
    expect(t.err()).toBe('');
  });

  it('numbers the rows as the spreadsheet shows them, also after a blank row', async () => {
    // A blank line before the header and a cleared row (`;;;;;`) in the middle.
    const file = await sheetFile(
      'luecken.csv',
      `\uFEFF\r\n${HEADER}\r\n"${Q2}";"";"";"";"Ja";""\r\n;;;;;\r\n"${Q3}";"";"";"";"Nein";""\r\n`,
    );
    const seen: unknown[] = [];
    const api = fakeApi({
      [SHEET]: async (req) => {
        seen.push(await req.json());
        return json({
          dryRun: true,
          counts: { recorded: 0, unchanged: 0, unknown: 2, invalid: 0, ignored: 0 },
          rows: [
            { row: 1, id: Q2, outcome: 'unknown', warnings: [] },
            { row: 2, id: Q3, outcome: 'unknown', warnings: [] },
          ],
        } satisfies AnswerSheetResult);
      },
    });
    const t = owner(api.fetch);
    expect(
      await runCli(['questions', 'answer', '-p', 'p', '--from', file, '--dry-run'], t.io),
    ).toBe(1);
    // Only the cells are sent, never the row numbers.
    expect(seen).toEqual([
      {
        rows: [
          { id: Q2, text: 'Ja', kind: '' },
          { id: Q3, text: 'Nein', kind: '' },
        ],
      },
    ]);
    expect(t.out()).toContain(`  row 3  ${Q2}  unknown`);
    expect(t.out()).toContain(`  row 5  ${Q3}  unknown`);
  });

  it('refuses a sheet before any request: not UTF-8, no answer sheet, nothing filled, too many answers', async () => {
    const none = fakeApi({});
    const latin1 = Buffer.concat([
      Buffer.from(`${HEADER}\r\n"${Q1}";"";"";"";"Gr`, 'utf8'),
      Buffer.from([0xfc]),
      Buffer.from('n";""\r\n', 'utf8'),
    ]);
    const many = csv(
      ...Array.from({ length: 5001 }, (_, i) => [
        `q-${i.toString(16).padStart(16, '0')}`,
        '',
        '',
        '',
        'Ja',
        '',
      ]),
    );
    const cases: [string, string | Uint8Array, string][] = [
      ['ansi.csv', latin1, 'ansi.csv is not UTF-8 text; save it as "CSV UTF-8"'],
      [
        'fragen.md',
        '# Offene Fragen\n\nText\n',
        'fragen.md is no answer sheet: the sheet lacks the column "id" or "Antwort"',
      ],
      [
        'kaputt.csv',
        `${HEADER}\r\n"${Q1}";"x`,
        'kaputt.csv is no answer sheet: unterminated quoted field',
      ],
      [
        'leer.csv',
        csv([Q1, 'Gehalten', 'Frage?', '', '', '']),
        'leer.csv: no answer to record: the column Antwort is empty in its row',
      ],
      ['kopf.csv', `\uFEFF${HEADER}\r\n`, 'kopf.csv: no answer to record: the sheet has no rows'],
      [
        'viele.csv',
        many,
        'viele.csv has 5001 filled answers; at most 5000 per call: split the sheet',
      ],
    ];
    for (const [name, content, message] of cases) {
      const file = await sheetFile(name, content);
      const t = owner(none.fetch);
      expect(await runCli(['questions', 'answer', '-p', 'p', '--from', file], t.io), name).toBe(1);
      expect(t.err(), name).toContain(message);
    }
    expect(none.seen).toHaveLength(0);
  });

  it("reports the server's problem", async () => {
    const file = await sheetFile('problem.csv', csv([Q2, '', '', '', 'Ja', '']));
    const t = owner(
      fakeApi({
        [SHEET]: () =>
          problem(403, 'human-decision-required', 'only a human answers open questions'),
      }).fetch,
    );
    expect(
      await runCli(['questions', 'answer', '-p', 'p', '--from', file, '--dry-run'], t.io),
    ).toBe(1);
    expect(t.err()).toBe(
      'analyzr: check the answers of problem.csv in p failed (403 human-decision-required): only a human answers open questions\n',
    );
  });

  it('maps the rows of the request to the rows of the sheet', () => {
    const result: AnswerSheetResult = {
      dryRun: true,
      counts: { recorded: 0, unchanged: 0, unknown: 1, invalid: 0, ignored: 0 },
      rows: [{ row: 1, id: Q1, outcome: 'unknown', warnings: [] }],
    };
    expect(
      sheetResult(result, {
        rows: 9,
        filled: [{ row: 8, cells: { id: Q1, text: 'x', kind: '' } }],
      }),
    ).toEqual({
      ...result,
      counts: { ...result.counts, ignored: 8 },
      rows: [{ row: 8, id: Q1, outcome: 'unknown', warnings: [] }],
    });
  });
});

describe('analyzr questions answer --from (the five-column sheet of S5c-1)', () => {
  it('sends each filled Antwort as a note with an empty kind and prints it as a note', async () => {
    const header = OPEN_QUESTION_CSV_COLUMNS.map((c) => `"${c}"`).join(';');
    const file = await sheetFile(
      'fuenf.csv',
      `\uFEFF${header}\r\n"${Q2}";"Pool ohne Prozess";"Ist „Bank“ extern?";"Ordner: finanzen";"Ja, die Hausbank."\r\n"${Q3}";"Aufrufziel unbekannt";"Welcher Prozess?";"";""\r\n`,
    );
    const seen: unknown[] = [];
    const api = fakeApi({
      [SHEET]: async (req) => {
        seen.push(await req.json());
        return json({
          dryRun: true,
          counts: { recorded: 1, unchanged: 0, unknown: 0, invalid: 0, ignored: 0 },
          rows: [
            { row: 1, id: Q2, outcome: 'recorded', kind: 'answer', target: 'answer', warnings: [] },
          ],
        } satisfies AnswerSheetResult);
      },
    });
    const t = owner(api.fetch);
    expect(
      await runCli(['questions', 'answer', '-p', 'p', '--from', file, '--dry-run'], t.io),
    ).toBe(0);
    expect(seen).toEqual([{ rows: [{ id: Q2, text: 'Ja, die Hausbank.', kind: '' }] }]);
    expect(t.out()).toBe(
      [
        `  row 2  ${Q2}  would record  note, kept with the question`,
        'p: fuenf.csv (dry run, nothing recorded): 1 to record, 0 unchanged, 0 unknown, 0 invalid, 1 row without an answer',
        'run again without --dry-run to record them',
        '',
      ].join('\n'),
    );
  });
});

describe('analyzr questions (subcommands)', () => {
  it('lists by default and with list; answer and the actions have their own help', async () => {
    const help = testIo();
    expect(await runCli(['questions', '--help'], help.io)).toBe(0);
    expect(help.out()).toMatch(/list \[options\]/);
    expect(help.out()).toMatch(/answer \[options\] \[id\]/);
    for (const cmd of ['outside', 'link', 'place']) {
      expect(help.out()).toMatch(new RegExp(`${cmd} \\[options\\] <id>`));
    }
    const answerHelp = testIo();
    expect(await runCli(['questions', 'answer', '--help'], answerHelp.io)).toBe(0);
    for (const flag of ['--text', '--from', '--dry-run', '--json']) {
      expect(answerHelp.out()).toContain(flag);
    }
    // S5a's --kind is gone from the help (and refused with a hint).
    expect(answerHelp.out()).not.toContain('--kind');
    const flags: Record<string, string[]> = {
      outside: ['--note', '--undo', '--json'],
      link: ['--to', '--pair', '--note', '--json'],
      place: ['--step', '--process', '--note', '--json'],
    };
    for (const [cmd, expected] of Object.entries(flags)) {
      const h = testIo();
      expect(await runCli(['questions', cmd, '--help'], h.io), cmd).toBe(0);
      for (const flag of expected) expect(h.out(), `${cmd} ${flag}`).toContain(flag);
    }

    const page = () => json({ items: [question()], nextCursor: null, total: 1 });
    for (const argv of [
      ['questions', '-p', 'p'],
      ['questions', 'list', '-p', 'p'],
    ]) {
      const t = owner(fakeApi({ 'GET /api/v1/projects/p/open-questions': page }).fetch);
      expect(await runCli(argv, t.io), argv.join(' ')).toBe(0);
      expect(t.out()).toContain('p: 1 open question (held 1)\n');
    }
  });

  it('marks answered questions in the table and counts them', async () => {
    const items = [
      question({ state: 'answered', answers: [answer()] }),
      question({ id: Q2, kind: 'call-target-unknown' }),
    ];
    const t = owner(
      fakeApi({
        'GET /api/v1/projects/p/open-questions': () => json({ items, nextCursor: null, total: 2 }),
      }).fetch,
    );
    expect(await runCli(['questions', '-p', 'p'], t.io)).toBe(0);
    expect(t.out()).toContain(
      '„A“ → „B“: Wer verschickt die Mahnung?  [answered: outside the landscape]\n',
    );
    expect(t.out()).toContain(
      'p: 2 open questions (call-target-unknown 1, held 1), 1 answered (outside the landscape)\n',
    );
  });
});

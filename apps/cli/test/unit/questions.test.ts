/**
 * `analyzr questions` against a fake REST API (M6 S4, S5c-1): the table and
 * JSON page through `GET …/open-questions` with any credential and the
 * filters; the table shows each item's primary action and, under it, the
 * targets a live proposal names (process names from `GET …/landscape`, read
 * only when there are some); `md` and `csv` write the export's bytes
 * verbatim (the CSV keeps its byte order mark), to stdout or `-o`; flags are
 * checked before any request.
 */
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import type { OpenQuestion } from '@analyzr/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  formatQuestions,
  parseFormat,
  primaryAction,
  summarizeQuestions,
} from '../../src/commands/questions.ts';
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

const LIST = 'GET /api/v1/projects/p/open-questions';
const EXPORT = 'GET /api/v1/projects/p/open-questions/export';

function question(n: number, extra: Partial<OpenQuestion> = {}): OpenQuestion {
  return {
    id: `q-${String(n).padStart(16, '0')}`,
    kind: 'call-target-unknown',
    source: 'finding',
    subject: { type: 'ref', id: 'finanzen/gutschrift#Call_Brief' },
    subjectLabel: '„Brief versenden“',
    modelKeys: ['finanzen/gutschrift'],
    text: 'Welchen Prozess ruft „Brief versenden“ auf?',
    context: null,
    label: null,
    askWho: { lanes: [], stepOwners: [], folder: 'finanzen' },
    unlocks: 1,
    refs: ['finanzen/gutschrift#Call_Brief'],
    raisedBy: { sourceKind: 'rule', handle: null, seq: 3 },
    state: 'open',
    answers: [],
    actions: [],
    ...extra,
  };
}

const ALL = [
  question(1, { unlocks: 12 }),
  question(2, {
    kind: 'held',
    source: 'hold',
    subject: { type: 'relation', id: 'rel_1' },
    subjectLabel: '„A“ → „B“',
    modelKeys: ['finanzen/gutschrift', 'vertrieb/auftrag'],
    text: 'Wer verschickt\ndie Mahnung?',
    label: 'mit Finanzen klären',
    unlocks: 3,
    raisedBy: { sourceKind: 'human', handle: 'owner', seq: 9 },
  }),
  question(3, {
    kind: 'step-without-process',
    source: 'value-chain-finding',
    subject: { type: 'step', id: 'step-versand' },
    subjectLabel: 'Versand',
    modelKeys: [],
    text: 'Welcher Prozess leistet den Schritt „Versand“?',
  }),
];

/** `GET …/open-questions` in pages of two, following the cursor. */
function pagedQuestions(all: readonly OpenQuestion[], seen: URL[] = []) {
  return (_req: Request, url: URL) => {
    seen.push(url);
    const start = Number(url.searchParams.get('cursor') ?? '0');
    const next = start + 2;
    return json({
      items: all.slice(start, next),
      nextCursor: next < all.length ? String(next) : null,
      total: all.length,
    });
  };
}

const CSV =
  '\uFEFF"id";"Art";"Frage";"Ansprechpartner-Hinweis";"Antwort"\r\n' +
  '"q-0000000000000001";"Aufrufziel unbekannt";"Welchen Prozess ruft „Brief versenden“ auf?";"Ordner: finanzen";""\r\n';
const MARKDOWN = '# Offene Fragen: P\n\nProjekt `p`, Stand Ereignis 3: eine offene Frage.\n';

function exporting(seen: URL[] = []) {
  return fakeApi({
    [EXPORT]: (_req, url) => {
      seen.push(url);
      const csv = url.searchParams.get('format') === 'csv';
      return new Response(csv ? CSV : MARKDOWN, {
        status: 200,
        headers: {
          'content-type': csv ? 'text/csv; charset=utf-8' : 'text/markdown; charset=utf-8',
          'content-disposition': `attachment; filename="offene-fragen-p.${csv ? 'csv' : 'md'}"`,
        },
      });
    },
  });
}

describe('analyzr questions (table and JSON)', () => {
  it('pages through the list with any credential and prints one line per question', async () => {
    const urls: URL[] = [];
    const api = fakeApi({ [LIST]: pagedQuestions(ALL, urls) });
    const t = testIo({ ANALYZR_TOKEN: AGENT_TOKEN }, api.fetch, { cwd: dir });
    expect(await runCli(['questions', '-p', 'p'], t.io)).toBe(0);
    expect(api.seen).toHaveLength(2);
    expect(api.seen.every((s) => s.authorization === `Bearer ${AGENT_TOKEN}`)).toBe(true);
    expect(urls.map((u) => u.searchParams.get('limit'))).toEqual(['200', '200']);
    expect(urls[1]?.searchParams.get('cursor')).toBe('2');
    expect(t.err()).toBe('');
    expect(t.out()).toBe(
      [
        '  id                  unlocks  kind                  model                   action  subject: question',
        '  q-0000000000000001       12  call-target-unknown   finanzen/gutschrift     -       „Brief versenden“: Welchen Prozess ruft „Brief versenden“ auf?',
        '  q-0000000000000002        3  held                  finanzen/gutschrift +1  -       „A“ → „B“: Wer verschickt die Mahnung?',
        '  q-0000000000000003        1  step-without-process  -                       -       Versand: Welcher Prozess leistet den Schritt „Versand“?',
        'p: 3 open questions (call-target-unknown 1, held 1, step-without-process 1)',
        '',
      ].join('\n'),
    );
  });

  it('passes the filters to the server and names them; --format json prints every item', async () => {
    const urls: URL[] = [];
    const api = fakeApi({ [LIST]: pagedQuestions(ALL, urls) });
    const t = owner(api.fetch);
    expect(
      await runCli(
        [
          'questions',
          '-p',
          'p',
          '--model',
          'finanzen',
          '--kind',
          'held',
          '--source',
          'hold',
          '--ask-who',
          'Vertrieb & Service',
          '--state',
          'open',
          '--format',
          'JSON',
        ],
        t.io,
      ),
    ).toBe(0);
    expect(api.seen[0]?.authorization).toBe(`Bearer ${OWNER_KEY}`);
    for (const url of urls) {
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        modelKey: 'finanzen',
        kind: 'held',
        source: 'hold',
        askWho: 'Vertrieb & Service',
        state: 'open',
        limit: '200',
      });
    }
    expect(JSON.parse(t.out())).toEqual(ALL);

    const empty = owner(
      fakeApi({ [LIST]: () => json({ items: [], nextCursor: null, total: 0 }) }).fetch,
    );
    expect(
      await runCli(['questions', '-p', 'p', '--kind', 'held', '--model', 'finanzen'], empty.io),
    ).toBe(0);
    expect(empty.out()).toBe('no open questions in p (kind held, model finanzen)\n');
    const nobody = owner(
      fakeApi({ [LIST]: () => json({ items: [], nextCursor: null, total: 0 }) }).fetch,
    );
    expect(
      await runCli(['questions', '-p', 'p', '--ask-who', 'Lager', '--state', 'open'], nobody.io),
    ).toBe(0);
    expect(nobody.out()).toBe('no open questions in p (ask-who "Lager", state open)\n');
  });

  it('writes the table or the JSON to -o', async () => {
    const api = fakeApi({ [LIST]: pagedQuestions(ALL) });
    const t = owner(api.fetch);
    expect(await runCli(['questions', '-p', 'p', '--format', 'json', '-o', 'q.json'], t.io)).toBe(
      0,
    );
    expect(t.out()).toBe('wrote the open questions of p to q.json\n');
    expect(JSON.parse(await readFile(path.join(dir, 'q.json'), 'utf8'))).toEqual(ALL);
  });

  it('counts by kind, most first', () => {
    const items = [question(1), question(2, { kind: 'held' }), question(3, { kind: 'held' })];
    expect(summarizeQuestions('p', items)).toBe(
      'p: 3 open questions (held 2, call-target-unknown 1)',
    );
    expect(summarizeQuestions('p', [question(1)])).toBe(
      'p: 1 open question (call-target-unknown 1)',
    );
  });
});

describe('analyzr questions (actions in the table)', () => {
  const BRIEF = 'finanzen/briefversand#Process_Briefversand';
  const DRUCK = 'finanzen/druck#Event_Druckauftrag';
  const ACTIONS = [
    question(1, {
      actions: [
        {
          type: 'link',
          primary: true,
          label: 'Verknüpfen mit …',
          pick: 'process',
          suggested: [BRIEF, DRUCK],
        },
        { type: 'outside', primary: false, label: 'Liegt außerhalb der Landschaft' },
        { type: 'note', primary: false, label: 'Notiz hinzufügen' },
      ],
    }),
    question(2, {
      kind: 'black-box-partner',
      source: 'signal',
      subject: { type: 'ref', id: 'finanzen/gutschrift#Participant_Bank' },
      subjectLabel: '„Bank“ in „finanzen/gutschrift“',
      text: 'Ist „Bank“ ein externer Partner?',
      state: 'answered',
      actions: [
        { type: 'outside', primary: true, label: 'Liegt außerhalb der Landschaft' },
        { type: 'link', primary: false, label: 'Verknüpfen mit …', pick: 'process', suggested: [] },
        { type: 'note', primary: false, label: 'Notiz hinzufügen' },
      ],
    }),
    question(3, {
      kind: 'undocumented-process',
      source: 'signal',
      subjectLabel: '„Gutschrift“',
      text: 'Was leistet der Prozess „Gutschrift“?',
      actions: [{ type: 'note', primary: true, label: 'Notiz hinzufügen' }],
    }),
  ];
  const LANDSCAPE = {
    projectId: 'prj_01JC0000000000000000000000',
    seq: 7,
    models: [
      {
        id: 'mdl_01JC0000000000000000000000',
        key: 'finanzen/briefversand',
        name: null,
        stage: 'waiting_for_agent',
        processes: [
          {
            ref: BRIEF,
            processId: 'Process_Briefversand',
            name: 'Briefversand über\nDruckdienstleister',
            participantName: null,
            isExecutable: true,
          },
        ],
      },
    ],
    relations: [],
    findings: [],
  };

  it('prints the primary action and, under the question, the suggested targets with their names and refs', async () => {
    const api = fakeApi({
      [LIST]: () => json({ items: ACTIONS, nextCursor: null, total: 3 }),
      'GET /api/v1/projects/p/landscape': () => json(LANDSCAPE),
    });
    const t = owner(api.fetch);
    expect(await runCli(['questions', '-p', 'p'], t.io)).toBe(0);
    expect(api.seen.map((s) => s.path)).toEqual([
      '/api/v1/projects/p/open-questions',
      '/api/v1/projects/p/landscape',
    ]);
    expect(t.out()).toBe(
      [
        '  id                  unlocks  kind                  model                action                                    subject: question',
        '  q-0000000000000001        1  call-target-unknown   finanzen/gutschrift  Verknüpfen mit … (link)                   „Brief versenden“: Welchen Prozess ruft „Brief versenden“ auf?',
        `      suggested for link: „Briefversand über Druckdienstleister“ (${BRIEF}), ${DRUCK}`,
        '  q-0000000000000002        1  black-box-partner     finanzen/gutschrift  Liegt außerhalb der Landschaft (outside)  „Bank“ in „finanzen/gutschrift“: Ist „Bank“ ein externer Partner?  [answered: outside the landscape]',
        '  q-0000000000000003        1  undocumented-process  finanzen/gutschrift  Notiz hinzufügen (note)                   „Gutschrift“: Was leistet der Prozess „Gutschrift“?',
        'p: 3 open questions (black-box-partner 1, call-target-unknown 1, undocumented-process 1), 1 answered (outside the landscape)',
        '',
      ].join('\n'),
    );
    // JSON carries the actions as the server sends them; no landscape needed.
    const j = owner(
      fakeApi({ [LIST]: () => json({ items: ACTIONS, nextCursor: null, total: 3 }) }).fetch,
    );
    expect(await runCli(['questions', '-p', 'p', '--format', 'json'], j.io)).toBe(0);
    expect(JSON.parse(j.out())).toEqual(ACTIONS);
  });

  it('names the primary action, or none', () => {
    expect(primaryAction(question(1))).toBe('-');
    expect(primaryAction(ACTIONS[0] ?? question(9))).toBe('Verknüpfen mit … (link)');
    // Without the landscape, suggested targets are listed by their refs.
    expect(formatQuestions(ACTIONS.slice(0, 1))[2]).toBe(
      `      suggested for link: ${BRIEF}, ${DRUCK}`,
    );
    // The proposals a link to a suggested target accepts, under it.
    const [first] = ACTIONS;
    if (!first) throw new Error('no item');
    const withProposal: OpenQuestion = {
      ...first,
      actions: first.actions.map((a) =>
        a.type === 'link'
          ? {
              ...a,
              proposals: [
                {
                  target: BRIEF,
                  relation: 'rel_01JC0000000000000000000009',
                  type: 'call',
                  from: first.subject.id as `${string}#${string}`,
                  to: BRIEF,
                },
              ],
            }
          : a,
      ),
    };
    expect(formatQuestions([withProposal]).slice(2, 4)).toEqual([
      `      suggested for link: ${BRIEF}, ${DRUCK}`,
      `        ${BRIEF}: accepts the call proposal ${first.subject.id} → ${BRIEF} (rel_01JC0000000000000000000009)`,
    ]);
  });

  it('names the targets of an amend action with several, and the value one sets again (M6 S5c-2)', () => {
    const [first] = ACTIONS;
    if (!first) throw new Error('no item');
    const amend = (targets: NonNullable<OpenQuestion['actions'][number]['amend']>['targets']) => ({
      type: 'amend' as const,
      primary: true,
      label: 'Namen eintragen …',
      amend: {
        modelId: 'mdl_01JC0000000000000000000001' as const,
        modelKey: 'finanzen/gutschrift',
        targets,
      },
    });
    const boundary: OpenQuestion = {
      ...first,
      actions: [
        amend([
          { elementId: 'Start_1', op: 'event-name', label: 'Startereignis „Start_1“' },
          { elementId: 'End_1', op: 'event-name', label: 'Endereignis „End_1“' },
        ]),
      ],
    };
    expect(formatQuestions([boundary]).slice(2)).toEqual([
      '      amend targets: Startereignis „Start_1“ (--element Start_1), Endereignis „End_1“ (--element End_1)',
    ]);
    const keep: OpenQuestion = {
      ...first,
      actions: [
        {
          ...amend([
            {
              elementId: 'Call_1',
              op: 'call-target',
              label: 'Aufrufaktivität „Brief versenden“',
              prefill: 'Process_Briefversand',
            },
          ]),
          primary: false,
          label: 'Meine Ergänzung behalten',
        },
      ],
    };
    expect(formatQuestions([keep]).slice(2)).toEqual([
      '      amend „Meine Ergänzung behalten“ sets „Process_Briefversand“ again',
    ]);
    // One target without a value to keep: nothing beyond the item's line.
    const one: OpenQuestion = {
      ...first,
      actions: [amend([{ elementId: 'Call_1', op: 'call-target', label: 'Aufrufaktivität' }])],
    };
    expect(formatQuestions([one])).toHaveLength(2);
  });
});

describe('analyzr questions (export)', () => {
  it('--format csv writes the export verbatim, with its byte order mark, and passes the filters', async () => {
    const urls: URL[] = [];
    const api = exporting(urls);
    const t = testIo({ ANALYZR_TOKEN: AGENT_TOKEN }, api.fetch, { cwd: dir });
    expect(
      await runCli(
        ['questions', '-p', 'p', '--format', 'csv', '--kind', 'call-target-unknown'],
        t.io,
      ),
    ).toBe(0);
    expect(t.out()).toBe(CSV);
    expect(Object.fromEntries(urls[0]?.searchParams ?? [])).toEqual({
      kind: 'call-target-unknown',
      format: 'csv',
    });

    // One sheet per department: the contact hint goes to the export.
    const dept = testIo({ ANALYZR_TOKEN: AGENT_TOKEN }, api.fetch, { cwd: dir });
    expect(
      await runCli(['questions', '-p', 'p', '--format', 'csv', '--ask-who', 'Finanzen'], dept.io),
    ).toBe(0);
    expect(Object.fromEntries(urls[1]?.searchParams ?? [])).toEqual({
      askWho: 'Finanzen',
      format: 'csv',
    });

    const f = testIo({ ANALYZR_TOKEN: AGENT_TOKEN }, api.fetch, { cwd: dir });
    expect(
      await runCli(['questions', '-p', 'p', '--format', 'csv', '-o', 'fragen.csv'], f.io),
    ).toBe(0);
    expect(f.out()).toBe('wrote the open questions of p to fragen.csv\n');
    const bytes = await readFile(path.join(dir, 'fragen.csv'));
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.equals(Buffer.from(CSV, 'utf8'))).toBe(true);
  });

  it('--format md (also markdown) asks for the Markdown export', async () => {
    for (const format of ['md', 'markdown']) {
      const urls: URL[] = [];
      const t = owner(exporting(urls).fetch);
      expect(
        await runCli(['questions', '-p', 'p', '--format', format, '--source', 'signal'], t.io),
      ).toBe(0);
      expect(t.out()).toBe(MARKDOWN);
      expect(Object.fromEntries(urls[0]?.searchParams ?? [])).toEqual({
        source: 'signal',
        format: 'markdown',
      });
    }
  });
});

describe('analyzr questions (errors)', () => {
  it('refuses a bad format, kind, source or model before any request', async () => {
    const none = fakeApi({});
    const cases: [string[], string][] = [
      [['--format', 'xlsx'], 'unknown format "xlsx"; one of text (a table, the default), md, csv'],
      [['--state', 'closed'], 'unknown state "closed"; one of open, answered'],
      [['--ask-who', 'x'.repeat(201)], 'not a contact hint: '],
      [['--ask-who', ''], 'not a contact hint: ""'],
      [['--ask-who', 'a\u0007b'], 'not a contact hint: '],
      [['--kind', 'gap'], 'unknown kind "gap"; one of call-target-unknown,'],
      [['--source', 'agent'], 'unknown source "agent"; one of finding,'],
      [['--model', 'Finanzen/Mahn wesen'], 'not a model key or folder: "Finanzen/Mahn wesen"'],
    ];
    for (const [flags, message] of cases) {
      const t = owner(none.fetch);
      expect(await runCli(['questions', '-p', 'p', ...flags], t.io), flags.join(' ')).toBe(1);
      expect(t.err()).toContain(message);
    }
    const missing = owner(none.fetch);
    expect(await runCli(['questions'], missing.io)).toBe(1);
    expect(missing.err()).toContain('--project');
    expect(none.seen).toHaveLength(0);
    expect(parseFormat(undefined)).toBe('text');
    expect(parseFormat('text')).toBe('text');
  });

  it("reports the server's problem", async () => {
    const t = owner(fakeApi({}).fetch);
    expect(await runCli(['questions', '-p', 'p'], t.io)).toBe(1);
    expect(t.err()).toContain('list the open questions of p failed (404');

    const refused = fakeApi({
      [EXPORT]: () => problem(403, 'insufficient-scope', 'needs analyzr:read'),
    });
    const r = testIo({ ANALYZR_TOKEN: AGENT_TOKEN }, refused.fetch, { cwd: dir });
    expect(await runCli(['questions', '-p', 'p', '--format', 'csv', '-o', 'x.csv'], r.io)).toBe(1);
    expect(r.err()).toContain('export the open questions of p failed (403');
    expect(r.out()).toBe('');
  });
});

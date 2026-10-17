/**
 * End to end: a real analyzr server (child process, real libraries, PostgreSQL
 * 17) driven by the CLI — `analyzr seed`, `import`, `token`, `status` — and
 * `analyzr mcp` spawned as a child process the way Claude Desktop starts it,
 * spoken to over stdio with the official SDK client (initialize, tools/list,
 * tools/call list_processes) in the 2025-11-25 and the 2026-07-28 revision,
 * `analyzr value-chain push|pull` with the golden dev chain, `analyzr seed
 * --value-chains` (M4 S4), `analyzr questions` on the seeded chain project
 * (M6 S4), `analyzr questions answer` (one answer, a held relation's note,
 * the CSV round trip; M6 S5a), and the import hygiene of M6 S1 (`.xml`,
 * skipped plain XML and sidecars, extractor warnings, the waiting tasks) with
 * `analyzr models list|requeue|delete`.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Status } from '../../src/commands/status.ts';
import type { CliIo } from '../../src/io.ts';
import { CLI_MAIN } from '../../src/mcp-config.ts';
import { runCli } from '../../src/program.ts';
import { tempDir } from '../support/io.ts';
import { REPO_ROOT, cleanEnv, createDatabase, startServer, type RunningServer } from './server.ts';

interface ReportCounts {
  name: string;
  counts: { models: number; rules: { accepted: number; proposed: number } };
  findings: { kind: string; computed: string[] }[];
}

let db: { url: string; drop: () => Promise<void> };
let dir: string;
let keyFile: string;
let server: RunningServer;
let report: ReportCounts[];
let agentSecret: string;
const clients: Client[] = [];

beforeAll(async () => {
  dir = await tempDir('analyzr-e2e-');
  keyFile = path.join(dir, 'state', 'analyzr', 'owner-key');
  db = await createDatabase();
  server = await startServer({ databaseUrl: db.url, ownerKeyFile: keyFile });
  const json = await readFile(path.join(REPO_ROOT, 'eval/reports/candidates.json'), 'utf8');
  report = (JSON.parse(json) as { landscapes: ReportCounts[] }).landscapes;
});

afterAll(async () => {
  for (const c of clients) await c.close().catch(() => {});
  await server?.stop();
  await db?.drop();
  await rm(dir, { recursive: true, force: true });
});

/** Runs the CLI in-process against the server with real fetch. */
async function analyzr(argv: string[], env: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
    env: { ANALYZR_URL: server.url, ANALYZR_OWNER_KEY_FILE: keyFile, ...env },
    fetch: globalThis.fetch,
    cwd: dir,
    home: dir,
    stdin: new PassThrough(),
    stdoutStream: new PassThrough(),
  };
  const code = await runCli(argv, io);
  return { code, out: out.join(''), err: err.join('') };
}

async function status(env: Record<string, string> = {}): Promise<Status> {
  const r = await analyzr(['status', '--json'], env);
  expect(r.err).toBe('');
  expect(r.code).toBe(0);
  return JSON.parse(r.out) as Status;
}

describe('the server', () => {
  it('created the owner key file on first start, readable only by its user', async () => {
    expect(server.output()).toContain(`owner key: ${keyFile} (created`);
    expect(server.output()).not.toMatch(/analyzr_ok_/);
    const key = (await readFile(keyFile, 'utf8')).trim();
    expect(key).toMatch(/^analyzr_ok_/);
  });

  it('answers analyzr health', async () => {
    const r = await analyzr(['health']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ status: 'ok', db: 'ok' });
  });
});

describe('analyzr seed', () => {
  it('creates both scored landscapes with the counts of eval:candidates', async () => {
    const r = await analyzr(['seed']);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toContain('nordwind-handel (Nordwind Handel GmbH): project created');
    expect(r.out).toContain('stadtwerke-auental (Stadtwerke Auental): project created');

    const s = await status();
    expect(s.me).toMatchObject({ handle: 'owner', clientId: 'analyzr-cli' });
    expect(s.projects.map((p) => p.key)).toEqual(['nordwind-handel', 'stadtwerke-auental']);
    for (const p of s.projects) {
      const expected = report.find((l) => l.name === p.key);
      expect(expected, p.key).toBeDefined();
      expect(p.models).toBe(expected?.counts.models);
      expect(p.stages).toEqual({ waiting_for_agent: expected?.counts.models });
      expect(p.relations).toEqual({
        accepted: expected?.counts.rules.accepted,
        proposed: expected?.counts.rules.proposed,
      });
      expect(p.endpointIssues).toBe(0);
      // One finding per computed entry (per ref; duplicate ids per group).
      for (const f of expected?.findings ?? []) {
        expect(p.findings[f.kind] ?? 0, `${p.key} ${f.kind}`).toBe(f.computed.length);
      }
    }
  });

  it('is idempotent: a second run changes nothing', async () => {
    const before = await status();
    const r = await analyzr(['seed', '--json']);
    expect(r.code).toBe(0);
    const results = JSON.parse(r.out) as {
      created: boolean;
      import: { counts: { created: number; revised: number; unchanged: number; failed: number } };
    }[];
    for (const x of results) {
      expect(x.created).toBe(false);
      expect(x.import.counts.created + x.import.counts.revised + x.import.counts.failed).toBe(0);
    }
    expect((await status()).projects.map((p) => p.seq)).toEqual(before.projects.map((p) => p.seq));
  });

  it('--project seeds a fresh project per live run; its token carries --token-name', async () => {
    const r = await analyzr([
      'seed',
      '_sample',
      '--project',
      'sample-run-1',
      '--issue-tokens',
      '--token-name',
      'claude-code-1',
      '--json',
    ]);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    const [result] = JSON.parse(r.out) as [
      {
        token: { secret: string };
        import: { files: Record<string, unknown>[]; counts: Record<string, number> };
      },
    ];
    // M6 S1 keeps the seed JSON of the corpus byte-identical: no `skipped`, no `warnings`.
    expect(Object.keys(result.import)).toEqual(['project', 'files', 'counts']);
    expect(Object.keys(result.import.counts)).toEqual([
      'created',
      'revised',
      'unchanged',
      'failed',
    ]);
    expect(result.import.files).toHaveLength(3);
    for (const f of result.import.files) {
      expect(Object.keys(f)).toEqual(['path', 'modelKey', 'outcome', 'problem']);
    }
    expect(r.out).not.toContain('"skipped"');
    expect(r.out).not.toContain('"warning');
    expect(result).toMatchObject({
      project: 'sample-run-1',
      landscape: 'sample',
      name: 'sample (sample-run-1)',
      created: true,
      models: 3,
      token: { name: 'claude-code-1' },
    });
    // The token's handle is what eval:live records as the agent.
    const asAgent = await status({ ANALYZR_TOKEN: result.token.secret });
    expect(asAgent.me).toMatchObject({ kind: 'service', handle: 'agent:claude-code-1' });
    expect(asAgent.projects.map((p) => p.key)).toEqual(['sample-run-1']);

    // A second run under the same key is refused before anything changes.
    const before = (await status()).projects.find((p) => p.key === 'sample-run-1');
    const again = await analyzr([
      'seed',
      'nordwind-handel',
      '--project',
      'sample-run-1',
      '--issue-tokens',
    ]);
    expect(again.code).toBe(1);
    expect(again.err).toContain('project sample-run-1 already exists');
    const after = (await status()).projects.find((p) => p.key === 'sample-run-1');
    expect(after).toMatchObject({ models: 3, seq: before?.seq });
    const tokens = await analyzr(['token', 'list', '-p', 'sample-run-1', '--json']);
    expect((JSON.parse(tokens.out) as unknown[]).length).toBe(1);
  });
});

describe('analyzr seed --value-chains', () => {
  it('seeds the golden dev chain without placements; the rule tier proposes its four key placements', async () => {
    const r = await analyzr([
      'seed',
      'nordwind-handel',
      '--project',
      'vc-seed',
      '--value-chains',
      '--json',
    ]);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    const [result] = JSON.parse(r.out) as [Record<string, unknown>];
    expect(result).toMatchObject({
      project: 'vc-seed',
      landscape: 'nordwind-handel',
      models: 31,
      valueChain: { outcome: 'created', rev: 1 },
      token: null,
    });
    const ownerKey = (await readFile(keyFile, 'utf8')).trim();
    const res = await fetch(
      `${server.url}/api/v1/projects/vc-seed/value-chains/main/placements?limit=200`,
      { headers: { authorization: `Bearer ${ownerKey}` } },
    );
    expect(res.status).toBe(200);
    const page = (await res.json()) as {
      items: { elementId: string; process: string; status: string; source: string; tier: string }[];
    };
    expect(page.items.map((p) => [p.elementId, p.process])).toEqual([
      ['step-mahnwesen', 'finanzen/mahnwesen#Process_Mahnwesen'],
      ['step-rechnungsstellung', 'finanzen/rechnungsstellung#Process_Rechnungsstellung'],
      ['step-wareneingang', 'lager/wareneingang#Process_Wareneingang'],
      ['step-zahlungseingang', 'finanzen/zahlungseingang#Process_Zahlungseingang'],
    ]);
    for (const p of page.items) {
      expect(p).toMatchObject({ status: 'proposed', source: 'rule', tier: 'key' });
    }
    // Creating the chain queued its placement task: a requeue finds it open.
    const requeued = await analyzr(['value-chain', 'requeue', '-p', 'vc-seed', '--json']);
    expect(requeued.err).toBe('');
    expect(requeued.code).toBe(0);
    expect(JSON.parse(requeued.out)).toMatchObject({
      outcome: 'open',
      taskId: expect.stringMatching(/^ana_/) as unknown,
    });
  });
});

describe('analyzr questions (M6 S4)', () => {
  // vc-seed as `seed --value-chains` left it: nordwind-handel, the golden chain, no agent yet.
  const SEEDED = {
    'process-without-step': 32,
    'step-without-process': 12,
    'message-partner-missing': 9,
    'black-box-partner': 6,
    'call-target-dynamic': 2,
    'call-target-unknown': 2,
    'duplicate-process-id': 1,
  };

  it('lists, filters and exports the open questions with a read-only token', async () => {
    const token = await analyzr([
      'token',
      'create',
      '-p',
      'vc-seed',
      '--name',
      'questions-e2e',
      '--scopes',
      'analyzr:read',
      '--json',
    ]);
    const reader = { ANALYZR_TOKEN: (JSON.parse(token.out) as { secret: string }).secret };

    const listed = await analyzr(['questions', '-p', 'vc-seed', '--format', 'json'], reader);
    expect(listed.err).toBe('');
    expect(listed.code).toBe(0);
    const items = JSON.parse(listed.out) as {
      id: string;
      kind: string;
      source: string;
      unlocks: number;
      modelKeys: string[];
    }[];
    const byKind: Record<string, number> = {};
    for (const q of items) byKind[q.kind] = (byKind[q.kind] ?? 0) + 1;
    expect(byKind).toEqual(SEEDED);
    expect(new Set(items.map((q) => q.id)).size).toBe(64);
    // The other questions first, then the value chain findings (owner answer 2026-10-16),
    // each by unlocks.
    const chain = items.map((q) => q.source === 'value-chain-finding');
    expect(chain).toEqual([...chain].sort((a, b) => Number(a) - Number(b)));
    for (const group of [false, true]) {
      const unlocks = items.filter((_, i) => chain[i] === group).map((q) => q.unlocks);
      expect(unlocks).toEqual([...unlocks].sort((a, b) => b - a));
    }

    const table = await analyzr(['questions', '-p', 'vc-seed'], reader);
    expect(table.code).toBe(0);
    expect(table.out).toContain(
      'vc-seed: 64 open questions (process-without-step 32, step-without-process 12, message-partner-missing 9, black-box-partner 6, call-target-dynamic 2, call-target-unknown 2, duplicate-process-id 1)\n',
    );
    expect(table.out.split('\n')).toHaveLength(64 + 3);

    const finanzen = await analyzr(
      ['questions', '-p', 'vc-seed', '--model', 'finanzen', '--format', 'json'],
      reader,
    );
    const inFinanzen = JSON.parse(finanzen.out) as { modelKeys: string[] }[];
    expect(inFinanzen.length).toBeGreaterThan(0);
    expect(inFinanzen.length).toBeLessThan(64);
    for (const q of inFinanzen) {
      expect(q.modelKeys.some((k) => k.startsWith('finanzen/'))).toBe(true);
    }

    // The CSV export, verbatim: byte order mark, the header, one row per question.
    const csvFile = path.join(dir, 'offene-fragen.csv');
    const csv = await analyzr(
      ['questions', '-p', 'vc-seed', '--format', 'csv', '-o', csvFile],
      reader,
    );
    expect(csv.err).toBe('');
    expect(csv.code).toBe(0);
    expect(csv.out).toBe(`wrote the open questions of vc-seed to ${csvFile}\n`);
    const bytes = await readFile(csvFile);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = bytes.toString('utf8');
    expect(text).toMatch(
      /^\uFEFF"id";"Art";"Frage";"Ansprechpartner-Hinweis";"Antwort";"Antwortart"\r\n/,
    );
    expect(text.match(/\r\n"q-[0-9a-f]{16}";/g)).toHaveLength(64);
    for (const q of items) expect(text).toContain(`"${q.id}";`);

    // One sheet per contact hint: the folder `finanzen`, exactly.
    const forFinanzen = await analyzr(
      ['questions', '-p', 'vc-seed', '--ask-who', 'finanzen', '--format', 'csv'],
      reader,
    );
    expect(forFinanzen.err).toBe('');
    expect(forFinanzen.code).toBe(0);
    const askedIds = [...forFinanzen.out.matchAll(/\r\n"(q-[0-9a-f]{16})";/g)].map((m) => m[1]);
    const expectedIds = (
      JSON.parse(
        (
          await analyzr(
            ['questions', '-p', 'vc-seed', '--ask-who', 'finanzen', '--format', 'json'],
            reader,
          )
        ).out,
      ) as { id: string; askWho: { folder: string | null } }[]
    ).map((q) => {
      expect(q.askWho.folder).toBe('finanzen');
      return q.id;
    });
    expect(expectedIds.length).toBeGreaterThan(0);
    expect(askedIds).toEqual(expectedIds);

    // The Markdown export of one kind: its filter line and one heading per question.
    const md = await analyzr(
      ['questions', '-p', 'vc-seed', '--kind', 'black-box-partner', '--format', 'md'],
      reader,
    );
    expect(md.code).toBe(0);
    expect(md.out).toMatch(/^# Offene Fragen: /);
    expect(md.out).toContain('Filter: Art „Pool ohne Prozess“.');
    expect(md.out.match(/^### \d+\. Pool ohne Prozess: /gm)).toHaveLength(6);
  });
});

describe('analyzr questions answer (M6 S5a)', () => {
  const P = 'answers-e2e';

  interface Item {
    id: string;
    kind: string;
    subject: { type: string; id: string };
    state: string;
  }
  interface SheetOutcome {
    dryRun: boolean;
    counts: Record<string, number>;
    rows: { row: number; id: string; outcome: string; reason?: string }[];
  }

  async function owner(pathname: string, init: RequestInit = {}): Promise<Response> {
    const ownerKey = (await readFile(keyFile, 'utf8')).trim();
    return fetch(`${server.url}/api/v1/projects/${P}${pathname}`, {
      ...init,
      headers: {
        authorization: `Bearer ${ownerKey}`,
        'content-type': 'application/json',
        ...init.headers,
      },
    });
  }

  async function list(...flags: string[]): Promise<Item[]> {
    const r = await analyzr(['questions', '-p', P, '--format', 'json', ...flags]);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    return JSON.parse(r.out) as Item[];
  }

  /** The sheet with `answer` and `kind` in the row of `id` (the export leaves both empty). */
  function fill(sheet: string, id: string, answer: string, kind = ''): string {
    const start = sheet.indexOf(`\r\n"${id}";`);
    expect(start).toBeGreaterThan(0);
    const end = sheet.indexOf(';"";""\r\n', start);
    return `${sheet.slice(0, end)};"${answer}";"${kind}"${sheet.slice(end + ';"";""'.length)}`;
  }

  it('answers one question, a held relation as a note on it, and a filled-in sheet', async () => {
    const seeded = await analyzr(['seed', 'nordwind-handel', '--project', P, '--json']);
    expect(seeded.err).toBe('');
    expect(seeded.code).toBe(0);

    // A held relation is a question whose answer lands as a human note on the relation.
    const proposed = (await (await owner('/relations?status=proposed&limit=200')).json()) as {
      items: { id: string }[];
    };
    const relation = proposed.items[0];
    if (!relation) throw new Error('the rule tier proposed no relation');
    const hold = await owner(`/relations/${relation.id}/decision`, {
      method: 'POST',
      body: JSON.stringify({
        verdict: 'hold',
        note: 'Mit dem Fachbereich klären.',
        question: 'Gilt diese Verbindung immer?',
      }),
    });
    expect(hold.status).toBe(200);
    const before = await list();
    const held = before.find((q) => q.kind === 'held' && q.subject.id === relation.id);
    const partner = before.find((q) => q.kind === 'black-box-partner');
    if (!held || !partner) throw new Error('no held relation or black-box partner to answer');
    expect(before.every((q) => q.state === 'open')).toBe(true);

    // Agents never answer: the CLI refuses the token before any request.
    const token = await analyzr(['token', 'create', '-p', P, '--name', 'answers', '--json']);
    const agent = { ANALYZR_TOKEN: (JSON.parse(token.out) as { secret: string }).secret };
    const refused = await analyzr(
      ['questions', 'answer', held.id, '-p', P, '--text', 'Ja.'],
      agent,
    );
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('only humans answer open questions');
    expect(await list('--state', 'answered')).toEqual([]);

    // One answer on the held relation: a human note on it; the item turns answered.
    const one = await analyzr([
      'questions',
      'answer',
      held.id,
      '-p',
      P,
      '--text',
      ' Ja, immer. ',
      '--json',
    ]);
    expect(one.err).toBe('');
    expect(one.code).toBe(0);
    const recorded = JSON.parse(one.out) as {
      result: string;
      answer: { kind: string; target: string; text: string; note: { assertionId: string } };
      question: { id: string; state: string };
    };
    expect(recorded).toMatchObject({
      result: 'recorded',
      answer: {
        kind: 'answer',
        target: 'relation-note',
        text: 'Ja, immer.',
        note: { type: 'relation', subjectId: relation.id },
      },
      question: { id: held.id, state: 'answered' },
      warnings: [],
    });
    const timeline = (await (await owner(`/relations/${relation.id}/assertions`)).json()) as {
      items: { id: string; kind: string; sourceKind: string; rationale: string }[];
    };
    expect(timeline.items.at(-1)).toMatchObject({
      id: recorded.answer.note.assertionId,
      kind: 'note',
      sourceKind: 'human',
      rationale: 'Ja, immer.',
    });
    const again = await analyzr(['questions', 'answer', held.id, '-p', P, '--text', 'Ja, immer.']);
    expect(again.code).toBe(0);
    expect(again.out).toContain(`${P}: answer to ${held.id} unchanged: the same answer (answer)`);

    // A subject answer stays with the question; the personal-data check warns, never blocks.
    const text = 'Die Hausbank, Kontakt max.muster@example.org';
    const kept = await analyzr([
      'questions',
      'answer',
      partner.id,
      '-p',
      P,
      '--text',
      text,
      '--kind',
      'ausserhalb',
    ]);
    expect(kept.err).toBe('');
    expect(kept.code).toBe(0);
    expect(kept.out).toMatch(
      new RegExp(
        `^${P}: answer to ${partner.id} recorded \\(outside-landscape\\), kept with the question\\n`,
      ),
    );
    expect(kept.out).toContain(
      `  warning: the answer probably contains an e-mail address (characters ${text.indexOf('max') + 1}–${text.length})\n`,
    );
    expect((await list('--state', 'answered')).map((q) => q.id).sort()).toEqual(
      [held.id, partner.id].sort(),
    );

    // The sheet of the open questions, filled in: two answers, an unknown id, a wrong kind.
    const exported = path.join(dir, 'antworten-export.csv');
    expect(
      (await analyzr(['questions', '-p', P, '--state', 'open', '--format', 'csv', '-o', exported]))
        .code,
    ).toBe(0);
    const open = await list('--state', 'open');
    const callTarget = open.find((q) => q.kind === 'call-target-unknown');
    const missing = open.find((q) => q.kind === 'message-partner-missing');
    const duplicate = open.find((q) => q.kind === 'duplicate-process-id');
    if (!callTarget || !missing || !duplicate) throw new Error('the seeded findings changed');
    let sheet = await readFile(exported, 'utf8');
    sheet = fill(sheet, callTarget.id, 'Der Versand ruft den Prozess auf.');
    sheet = fill(sheet, missing.id, 'Kommt im nächsten Release.', 'Wird im Modell ergänzt');
    sheet = fill(sheet, duplicate.id, 'Egal.', 'vielleicht');
    sheet += '"q-0000000000000000";"";"";"";"Gibt es nicht.";""\r\n';
    const sheetFile = path.join(dir, 'antworten.csv');
    await writeFile(sheetFile, sheet);
    const ids = [...sheet.matchAll(/\r\n"(q-[0-9a-f]{16})";/g)].map((m) => m[1]);
    const rowOf = (id: string) => ids.indexOf(id) + 2;

    // The dry run lists every filled row under its spreadsheet row and stores nothing.
    const dry = await analyzr(['questions', 'answer', '-p', P, '--from', sheetFile, '--dry-run']);
    expect(dry.code).toBe(1);
    expect(dry.out).toMatch(
      new RegExp(
        `\\n? {2}row +${rowOf(callTarget.id)} {2}${callTarget.id} {2}would record {2}answer, kept with the question\\n`,
      ),
    );
    expect(dry.out).toMatch(
      new RegExp(
        `row +${rowOf(missing.id)} {2}${missing.id} {2}would record {2}will-be-modelled, kept with the question\\n`,
      ),
    );
    expect(dry.out).toMatch(
      new RegExp(
        `row +${rowOf(duplicate.id)} {2}${duplicate.id} {2}invalid +unknown Antwortart "vielleicht"`,
      ),
    );
    expect(dry.out).toMatch(
      new RegExp(
        `row +${ids.length + 1} {2}q-0000000000000000 {2}unknown +no current open question`,
      ),
    );
    expect(dry.out).toContain(
      `${P}: ${sheetFile} (dry run, nothing recorded): 2 to record, 0 unchanged, 1 unknown, 1 invalid, ${ids.length - 4} rows without an answer\n`,
    );
    expect(dry.err).toContain('2 rows would not be recorded (1 unknown, 1 invalid)');
    expect(await list('--state', 'answered')).toHaveLength(2);

    // Recorded: the rest in one call, the unknown and invalid rows never; again: unchanged.
    const real = await analyzr(['questions', 'answer', '-p', P, '--from', sheetFile, '--json']);
    expect(real.code).toBe(1);
    expect(real.err).toContain('2 rows not recorded (1 unknown, 1 invalid)');
    const result = JSON.parse(real.out) as SheetOutcome;
    expect(result).toMatchObject({
      dryRun: false,
      counts: { recorded: 2, unchanged: 0, unknown: 1, invalid: 1, ignored: ids.length - 4 },
    });
    expect(result.rows.map((r) => [r.row, r.id, r.outcome])).toEqual(
      [
        [rowOf(callTarget.id), callTarget.id, 'recorded'],
        [rowOf(missing.id), missing.id, 'recorded'],
        [rowOf(duplicate.id), duplicate.id, 'invalid'],
        [ids.length + 1, 'q-0000000000000000', 'unknown'],
      ].sort((a, b) => Number(a[0]) - Number(b[0])),
    );
    const answered = await list('--state', 'answered');
    expect(answered.map((q) => q.id).sort()).toEqual(
      [held.id, partner.id, callTarget.id, missing.id].sort(),
    );
    const repeated = await analyzr(['questions', 'answer', '-p', P, '--from', sheetFile, '--json']);
    expect((JSON.parse(repeated.out) as SheetOutcome).counts).toMatchObject({
      recorded: 0,
      unchanged: 2,
    });

    // The export carries the latest answers; read back, the whole sheet is unchanged.
    const all = path.join(dir, 'antworten-alle.csv');
    expect((await analyzr(['questions', '-p', P, '--format', 'csv', '-o', all])).code).toBe(0);
    const roundTrip = await analyzr(['questions', 'answer', '-p', P, '--from', all, '--dry-run']);
    expect(roundTrip.err).toBe('');
    expect(roundTrip.code).toBe(0);
    expect(roundTrip.out).toContain(': 0 to record, 4 unchanged, 0 unknown, 0 invalid, ');
    const table = await analyzr(['questions', '-p', P, '--state', 'answered']);
    expect(table.out.match(/ {2}\[answered\]\n/g)).toHaveLength(4);
    expect(table.out).toMatch(/: 4 open questions \(.*\), 4 answered\n$/);
  });
});

describe('analyzr import', () => {
  it('revises a changed model and the rule tier follows', async () => {
    const original = await readFile(
      path.join(REPO_ROOT, 'eval/corpus/nordwind-handel/models/finanzen/gutschrift.bpmn'),
      'utf8',
    );
    const changed = path.join(dir, 'changed');
    await mkdir(path.join(changed, 'finanzen'), { recursive: true });
    await writeFile(
      path.join(changed, 'finanzen', 'gutschrift.bpmn'),
      original.replace(
        'calledElement="Process_Briefversand"',
        'calledElement="Process_Briefdienst"',
      ),
    );
    const r = await analyzr(['import', 'changed', '--project', 'nordwind-handel']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('  revised   finanzen/gutschrift\n');
    const nordwind = (await status()).projects.find((p) => p.key === 'nordwind-handel');
    expect(nordwind?.relations['accepted']).toBe(8);
    expect(nordwind?.findings['unresolved-call']).toBe(3);

    await writeFile(path.join(changed, 'finanzen', 'gutschrift.bpmn'), original);
    expect((await analyzr(['import', 'changed', '-p', 'nordwind-handel'])).code).toBe(0);
    const restored = (await status()).projects.find((p) => p.key === 'nordwind-handel');
    expect(restored?.relations['accepted']).toBe(9);
  });
});

describe('analyzr import and models (M6 S1)', () => {
  const root = () => path.join(dir, 'm6-s1');
  const sample = path.join(REPO_ROOT, 'eval/corpus/_sample/models');
  // bpmn-moddle drops the second Task_A and warns; the file is still created.
  const duplicate = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">',
    '  <bpmn:process id="Process_Dup" isExecutable="false">',
    '    <bpmn:task id="Task_A" name="Eins" />',
    '    <bpmn:task id="Task_A" name="Zwei" />',
    '  </bpmn:process>',
    '</bpmn:definitions>',
    '',
  ].join('\n');

  beforeAll(async () => {
    await mkdir(path.join(root(), 'export'), { recursive: true });
    await mkdir(path.join(root(), 'w'), { recursive: true });
    await writeFile(
      path.join(root(), 'auftrag.xml'),
      await readFile(path.join(sample, 'vertrieb/auftragsabwicklung.bpmn')),
    );
    await writeFile(path.join(root(), 'export', 'meta.xml'), '<meta/>');
    await writeFile(path.join(root(), 'w', 'dup.bpmn'), duplicate);
    // A tool's sidecar next to the model: skipped for its key, never sent.
    await writeFile(path.join(root(), 'w', 'dup.xml'), '<meta/>');
    await writeFile(path.join(root(), '._dup.bpmn'), duplicate);
  });

  it('imports .xml, skips plain XML, a sidecar and hidden files, reports warnings and what waits', async () => {
    const r = await analyzr(['import', 'm6-s1', '-p', 'm6-s1', '--create', '--verbose']);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toContain('  created   auftrag\n');
    expect(r.out).toMatch(
      / {2}created {3}w\/dup {2}warnings: 1 \(parse-warning 1\)\n {6}parse-warning: .*duplicate ID <Task_A>/,
    );
    expect(r.out).toContain('  skipped   w/dup.xml  (same model key as w/dup.bpmn)\n');
    expect(r.out).toContain('  skipped   export/meta.xml  (not BPMN)\n');
    expect(r.out).not.toContain('._dup');
    expect(r.out).toContain(
      'm6-s1: 2 files, 2 created, 0 revised, 0 unchanged, 0 failed, 2 skipped (1 not BPMN, 1 same model key)\n',
    );
    expect(r.out).toContain('m6-s1: 2 relations tasks waiting, placement task waiting: no\n');
    expect(r.out).toContain('  /analyzr:relations m6-s1\n');

    const again = await analyzr(['import', 'm6-s1', '-p', 'm6-s1', '--json']);
    expect(again.code).toBe(0);
    const summary = JSON.parse(again.out) as { files: { outcome: string }[]; skipped: unknown };
    expect(summary.files.map((f) => f.outcome)).toEqual(['unchanged', 'unchanged']);
    expect(summary.skipped).toEqual([
      { path: 'w/dup.xml', reason: 'key-taken', takenBy: 'w/dup.bpmn' },
      { path: 'export/meta.xml', reason: 'not-bpmn' },
    ]);
  });

  it('lists, requeues and deletes models; an agent token cannot delete', async () => {
    const listed = await analyzr(['models', 'list', '-p', 'm6-s1', '--json']);
    expect(listed.code).toBe(0);
    const models = JSON.parse(listed.out) as { key: string; stage: string }[];
    expect(models.map((m) => [m.key, m.stage])).toEqual([
      ['auftrag', 'waiting_for_agent'],
      ['w/dup', 'waiting_for_agent'],
    ]);

    const requeued = await analyzr(['models', 'requeue', 'w/dup', '-p', 'm6-s1']);
    expect(requeued.code).toBe(0);
    expect(requeued.out).toContain('m6-s1: 0 queued, 1 open, 0 not found');

    const token = await analyzr([
      'token',
      'create',
      '-p',
      'm6-s1',
      '--scopes',
      'read,propose,write',
      '--json',
    ]);
    const { secret } = JSON.parse(token.out) as { secret: string };
    const refused = await analyzr(['models', 'delete', 'w/dup', '-p', 'm6-s1', '--yes'], {
      ANALYZR_TOKEN: secret,
    });
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('deleting models needs the owner key');

    const dry = await analyzr(['models', 'delete', 'w/dup', '-p', 'm6-s1']);
    expect(dry.code).toBe(1);
    expect(dry.out).toContain('would delete 1 model from m6-s1:');
    expect(dry.err).toContain('nothing deleted');

    const deleted = await analyzr(['models', 'delete', 'w/dup', '-p', 'm6-s1', '--yes']);
    expect(deleted.err).toBe('');
    expect(deleted.code).toBe(0);
    expect(deleted.out).toContain('deleted w/dup\n');
    const after = await analyzr(['models', 'list', '-p', 'm6-s1']);
    expect(after.out).toContain('m6-s1: 1 model\n');
  });
});

describe('agent tokens and the MCP bridge', () => {
  it('analyzr token create issues a token that sees exactly its project', async () => {
    const r = await analyzr([
      'token',
      'create',
      '--project',
      'nordwind-handel',
      '--name',
      'e2e',
      '--scopes',
      'analyzr:read',
      '--expires',
      '7d',
      '--json',
    ]);
    expect(r.code).toBe(0);
    const token = JSON.parse(r.out) as { secret: string; scopes: string[] };
    expect(token.scopes).toEqual(['analyzr:read']);
    agentSecret = token.secret;

    const asAgent = await status({ ANALYZR_TOKEN: agentSecret });
    expect(asAgent.me).toMatchObject({ kind: 'service' });
    expect(asAgent.projects.map((p) => p.key)).toEqual(['nordwind-handel']);
  });

  function bridge(token: string): StdioClientTransport {
    return new StdioClientTransport({
      command: process.execPath,
      args: [CLI_MAIN, 'mcp'],
      env: cleanEnv({ ANALYZR_URL: server.url, ANALYZR_TOKEN: token }),
      stderr: 'pipe',
    });
  }

  it('speaks 2025-11-25 over stdio (Claude Desktop): initialize, tools/list, list_processes', async () => {
    const client = new Client({ name: 'claude-desktop-e2e', version: '0' });
    clients.push(client);
    await client.connect(bridge(agentSecret));
    expect(client.getNegotiatedProtocolVersion()).toBe('2025-11-25');
    expect(client.getServerVersion()).toMatchObject({ name: 'analyzr' });
    expect(client.getInstructions()).toMatch(/only propose/);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['list_projects', 'list_processes', 'get_process', 'get_model_xml']),
    );
    const result = await client.callTool({
      name: 'list_processes',
      arguments: { projectId: 'nordwind-handel', limit: 200 },
    });
    expect(result.isError).not.toBe(true);
    const { items } = result.structuredContent as { items: { modelKey: string }[] };
    expect(items).toHaveLength(31);
    expect(items.map((i) => i.modelKey)).toContain('finanzen/gutschrift');

    const other = await client.callTool({
      name: 'list_processes',
      arguments: { projectId: 'stadtwerke-auental' },
    });
    expect(other.isError).toBe(true);
    await client.close();
  });

  it('speaks 2026-07-28 through the same bridge (version negotiation)', async () => {
    const client = new Client(
      { name: 'modern-e2e', version: '0' },
      { versionNegotiation: { mode: 'auto' } },
    );
    clients.push(client);
    await client.connect(bridge(agentSecret));
    expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28');
    expect(client.getProtocolEra()).not.toBe('legacy');
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(8);
    const result = await client.callTool({ name: 'list_projects', arguments: {} });
    expect(JSON.stringify(result.structuredContent)).toContain('nordwind-handel');
    await client.close();
  });

  it('reports a revoked token to the MCP client instead of hanging', async () => {
    const list = await analyzr(['token', 'list', '-p', 'nordwind-handel', '--json']);
    const [token] = JSON.parse(list.out) as { id: string }[];
    expect(
      (await analyzr(['token', 'revoke', token?.id ?? '', '-p', 'nordwind-handel'])).code,
    ).toBe(0);

    const client = new Client({ name: 'revoked-e2e', version: '0' });
    clients.push(client);
    await expect(client.connect(bridge(agentSecret))).rejects.toThrow(/rejected the agent token/);
  });
});

describe('analyzr value-chain', () => {
  const golden = path.join(REPO_ROOT, 'eval/value-chains/nordwind-handel/value-chain.vc.json');

  it('pushes the golden dev chain (r1), finds it unchanged and pulls it back byte for byte', async () => {
    const created = await analyzr([
      'value-chain',
      'push',
      golden,
      '-p',
      'nordwind-handel',
      '--json',
    ]);
    expect(created.err).toBe('');
    expect(created.code).toBe(0);
    expect(JSON.parse(created.out)).toMatchObject({
      dryRun: false,
      outcome: 'created',
      valueChain: { key: 'main', headRev: 1 },
    });

    const again = await analyzr(['value-chain', 'push', golden, '-p', 'nordwind-handel']);
    expect(again.code).toBe(0);
    expect(again.out).toBe('nordwind-handel: value chain unchanged r1\n');

    const token = await analyzr([
      'token',
      'create',
      '-p',
      'nordwind-handel',
      '--name',
      'e2e-chain',
      '--scopes',
      'analyzr:read',
      '--json',
    ]);
    const { secret } = JSON.parse(token.out) as { secret: string };
    const out = path.join(dir, 'pulled.vc.json');
    const pulled = await analyzr(['value-chain', 'pull', '-p', 'nordwind-handel', '-o', out], {
      ANALYZR_TOKEN: secret,
    });
    expect(pulled.code).toBe(0);
    expect(pulled.err).toMatch(/^r1 [0-9a-f]{64}\n$/);
    expect(await readFile(out)).toEqual(await readFile(golden));

    // Agents never edit the chain: the CLI refuses an agent token before any request.
    const refused = await analyzr(['value-chain', 'push', golden, '-p', 'nordwind-handel'], {
      ANALYZR_TOKEN: secret,
    });
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('agents never edit the value chain');

    // An edit of the pulled file saves only on the revision it came from (--base r1).
    const edited = path.join(dir, 'edited.vc.json');
    const doc = JSON.parse(await readFile(out, 'utf8')) as { meta: { name: string } };
    await writeFile(edited, JSON.stringify({ ...doc, meta: { name: `${doc.meta.name} (2)` } }));
    const unbased = await analyzr(['value-chain', 'push', edited, '-p', 'nordwind-handel']);
    expect(unbased.code).toBe(1);
    expect(unbased.err).toContain('pass --base with the revision your file comes from');
    const based = await analyzr([
      'value-chain',
      'push',
      edited,
      '-p',
      'nordwind-handel',
      '--base',
      'r1',
    ]);
    expect(based.err).toBe('');
    expect(based.code).toBe(0);
    expect(based.out).toContain('nordwind-handel: value chain revised r2 (from r1)');
    const stale = await analyzr([
      'value-chain',
      'push',
      golden,
      '-p',
      'nordwind-handel',
      '--base',
      'r1',
    ]);
    expect(stale.code).toBe(1);
    expect(stale.err).toContain('the value chain is at r2; pull first');
  });

  it('seed --value-chains leaves the edited chain unchanged', async () => {
    const r = await analyzr(['seed', 'nordwind-handel', '--value-chains']);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toContain(
      '  value chain: exists r2, differs from the golden chain: left unchanged\n',
    );
    const pulled = await analyzr(['value-chain', 'pull', '-p', 'nordwind-handel']);
    expect(pulled.err).toMatch(/^r2 /);
  });
});

describe('analyzr rules (owner decision 19)', () => {
  interface LandscapeRelation {
    id: string;
    type: string;
    from: string;
    to: string;
    status: string;
    tier: string;
  }

  async function owner(pathname: string, init: RequestInit = {}): Promise<Response> {
    const ownerKey = (await readFile(keyFile, 'utf8')).trim();
    return fetch(`${server.url}/api/v1/projects/vc-seed${pathname}`, {
      ...init,
      headers: {
        authorization: `Bearer ${ownerKey}`,
        'content-type': 'application/json',
        ...init.headers,
      },
    });
  }

  it('add → preview → enable → apply → revoke against a real server', async () => {
    // The seeded vc-seed project has no rules.
    const listed = await analyzr(['rules', 'list', '-p', 'vc-seed', '--json']);
    expect(listed.err).toBe('');
    expect(JSON.parse(listed.out)).toMatchObject({
      items: [],
      system: { id: 'analyzr-rules/1.0.0', readOnly: true, accepted: 9 },
    });

    // An agent proposes a pair the rule tier already proposed (key tier) ad hoc.
    const token = await analyzr([
      'token',
      'create',
      '-p',
      'vc-seed',
      '--name',
      'rules-e2e',
      '--scopes',
      'read,propose',
      '--json',
    ]);
    const { secret } = JSON.parse(token.out) as { secret: string };
    const landscape = (await (await owner('/landscape')).json()) as {
      relations: LandscapeRelation[];
    };
    const target = landscape.relations.find(
      (r) => r.status === 'proposed' && r.tier === 'key' && r.type === 'message',
    );
    expect(target).toBeDefined();
    const proposed = await fetch(`${server.url}/api/v1/projects/vc-seed/relations`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: target?.type,
        from: target?.from,
        to: target?.to,
        confidence: 0.97,
        rationale: 'Gleicher Nachrichtenname auf beiden Seiten.',
        llmModel: 'e2e-model',
      }),
    });
    expect(proposed.status).toBe(200);

    // Agents never see rules: the token gets 403 from the server, and the CLI refuses it.
    const asAgent = await fetch(`${server.url}/api/v1/projects/vc-seed/auto-accept-rules`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(asAgent.status).toBe(403);
    const refused = await analyzr(['rules', 'list', '-p', 'vc-seed'], { ANALYZR_TOKEN: secret });
    expect(refused.code).toBe(1);
    expect(refused.err).toContain('owner-only');

    // add: off by default, with its preview (one open proposal would be accepted).
    const added = await analyzr([
      'rules',
      'add',
      '-p',
      'vc-seed',
      '--name',
      'Schlüssel-Nachrichten',
      '--kind',
      'relation',
      '--tier',
      'key',
      '--min',
      '95%',
      '--type',
      'message',
      '--agent',
      'rules-e2e',
      '--ad-hoc',
      '--json',
    ]);
    expect(added.err).toBe('');
    expect(added.code).toBe(0);
    const created = JSON.parse(added.out) as {
      outcome: string;
      rule: { id: string; revision: number; enabled: boolean };
      preview: { open: { count: number } };
    };
    expect(created).toMatchObject({ outcome: 'created', rule: { revision: 1, enabled: false } });
    expect(created.preview.open.count).toBe(1);
    const id = created.rule.id;

    const preview = await analyzr(['rules', 'preview', id, '-p', 'vc-seed', '--min', '0.98']);
    expect(preview.code).toBe(0);
    expect(preview.out).toContain('open now: 0 proposals would be accepted');

    // enable: a new revision; never retroactive, so it points to apply.
    const enabled = await analyzr(['rules', 'enable', id, '-p', 'vc-seed']);
    expect(enabled.err).toBe('');
    expect(enabled.out).toContain('1 open proposal matches the rule already');
    expect(
      (await (await owner(`/relations/${target?.id}`)).json()) as { status: string },
    ).toMatchObject({ status: 'proposed' });

    // apply: the dry run alone changes nothing; --yes accepts with expectedCount.
    const dry = await analyzr(['rules', 'apply', id, '-p', 'vc-seed']);
    expect(dry.code).toBe(1);
    expect(dry.out).toContain(`dry run: rule ${id} r2 would accept 1 open proposal in vc-seed`);
    const applied = await analyzr(['rules', 'apply', id, '-p', 'vc-seed', '--yes']);
    expect(applied.err).toBe('');
    expect(applied.code).toBe(0);
    expect(applied.out).toContain(`rule ${id} r2 accepted 1 proposal in vc-seed`);
    expect(
      (await (await owner(`/relations/${target?.id}`)).json()) as { status: string },
    ).toMatchObject({ status: 'accepted' });
    const shown = await analyzr(['rules', 'show', id, '-p', 'vc-seed']);
    expect(shown.out).toContain('in force 1, revoked 0');
    expect(shown.out).toMatch(/\n {2}r1 .* off .*\n {2}r2 .* on /);

    // revoke by agent: back to review; a second revocation finds nothing in force.
    const revoked = await analyzr([
      'rules',
      'revoke',
      '-p',
      'vc-seed',
      '--agent',
      'rules-e2e',
      '--reason',
      'Stichprobe',
      '--yes',
    ]);
    expect(revoked.err).toBe('');
    expect(revoked.code).toBe(0);
    expect(revoked.out).toContain('1 auto-acceptance revoked: 1 back to review, 0 obsolete');
    expect(
      (await (await owner(`/relations/${target?.id}`)).json()) as { status: string },
    ).toMatchObject({ status: 'proposed' });
    const again = await analyzr(['rules', 'revoke', id, '-p', 'vc-seed', '--dry-run']);
    expect(again.code).toBe(0);
    expect(again.out).toContain('0 auto-acceptances would be revoked');
    expect(again.out).toContain('1 revoked before');

    // disable: its acceptances stay revocable; the list shows the stats.
    expect((await analyzr(['rules', 'disable', id, '-p', 'vc-seed'])).code).toBe(0);
    const final = await analyzr(['rules', 'list', '-p', 'vc-seed']);
    expect(final.out).toContain(`${id}  "Schlüssel-Nachrichten"  off`);
    expect(final.out).toContain('in force 0, revoked 1');
  });
});

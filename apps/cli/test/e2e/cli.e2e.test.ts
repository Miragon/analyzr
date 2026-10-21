/**
 * End to end: a real analyzr server (child process, real libraries, PostgreSQL
 * 17) driven by the CLI — `analyzr seed`, `import`, `token`, `status` — and
 * `analyzr mcp` spawned as a child process the way Claude Desktop starts it,
 * spoken to over stdio with the official SDK client (initialize, tools/list,
 * tools/call list_processes) in the 2025-11-25 and the 2026-07-28 revision,
 * `analyzr value-chain push|pull` with the golden dev chain, `analyzr seed
 * --value-chains` (M4 S4), `analyzr questions` on the seeded chain project
 * (M6 S4), `analyzr questions answer` (one note, a held relation's note,
 * the CSV round trip; M6 S5a, notes since S5c-1), `analyzr questions
 * outside|link|place` (M6 S5c-1: targets by ref, model key and process name,
 * an accepted proposal, placements on a step and on `@outside`, the outside
 * mark and its withdrawal, an S5a sheet), `analyzr models amend|pull`,
 * `analyzr questions amend` and `analyzr amendments list|export|withdraw` (M6
 * S5c-2: amended and uploaded revisions, re-imports with a conflict and
 * „Meine Ergänzung behalten“, the change list, withdrawals), and the import hygiene of M6 S1 (`.xml`,
 * skipped plain XML and sidecars, extractor warnings, the waiting tasks) with
 * `analyzr models list|requeue|delete`, and the manifest of M6 S2a (the
 * integrate plugin's golden bundle under its pinned keys, `analyzr models
 * external-ids`, unchanged bytes, the import warnings), with the identities
 * unchanged bytes record since M6 S2b follow-up step 5 (moved folders).
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { promisify } from 'node:util';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pairsToJudgeText } from '../../src/commands/import.ts';
import type { Status } from '../../src/commands/status.ts';
import type { CliIo } from '../../src/io.ts';
import { CLI_MAIN } from '../../src/cli-main.ts';
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
      // S2b follow-up step 3b: every model waits, so the agents' first run has pairs to judge
      if (p.key === 'nordwind-handel') expect(p.pairsToJudge).toBeGreaterThan(0);
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
      group: string;
      unlocks: number;
      modelKeys: string[];
      actions: {
        type: string;
        primary: boolean;
        label: string;
        suggested?: string[];
        proposals?: unknown[];
      }[];
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
    // UX2a: the groups; the rule tier's placement proposals wait on the chain.
    expect(table.out).toContain(
      'vc-seed: 64 open questions (process-without-step 32, step-without-process 12, message-partner-missing 9, black-box-partner 6, call-target-dynamic 2, call-target-unknown 2, duplicate-process-id 1); groups: ask 58, proposal 6\n',
    );
    const ask = items.filter((q) => q.group === 'ask');
    expect(ask).toHaveLength(58);
    const onlyAsk = await analyzr(
      ['questions', '-p', 'vc-seed', '--group', 'ask', '--format', 'json'],
      reader,
    );
    expect((JSON.parse(onlyAsk.out) as { id: string }[]).map((q) => q.id)).toEqual(
      ask.map((q) => q.id),
    );
    // One line per question, under it one per action with suggested targets and one per
    // proposal a link to them accepts (M6 S5c-1).
    const suggested = items.flatMap((q) => q.actions.filter((a) => (a.suggested ?? []).length > 0));
    const proposals = suggested.flatMap((a) => a.proposals ?? []);
    expect(table.out.split('\n')).toHaveLength(64 + 3 + suggested.length + proposals.length);
    expect(table.out.split('\n')[0]).toMatch(/ {2}action +subject: question$/);
    for (const q of items) {
      const primary = q.actions.find((a) => a.primary);
      if (!primary) throw new Error(`${q.id} (${q.kind}) has no primary action`);
      expect(table.out).toMatch(
        new RegExp(`\\n {2}${q.id} .* ${primary.label} \\(${primary.type}\\) `),
      );
    }

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

    // The CSV export, verbatim: byte order mark, the header, one row per question to
    // clarify (UX2a: the export's default group `ask`), under the old file name.
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
    expect(text).toMatch(/^\uFEFF"id";"Art";"Frage";"Ansprechpartner";"Antwort"\r\n/);
    expect([...text.matchAll(/\r\n"(q-[0-9a-f]{16})";/g)].map((m) => m[1])).toEqual(
      ask.map((q) => q.id),
    );

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
      ) as { id: string; group: string; askWho: { folder: string | null } }[]
    ).flatMap((q) => {
      expect(q.askWho.folder).toBe('finanzen');
      return q.group === 'ask' ? [q.id] : [];
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
    expect(md.out.match(/^### \d+\. Pool ohne Prozess: Pool in „/gm)).toHaveLength(6);
    // For the customer: a date, the id only as an HTML comment.
    expect(md.out).toMatch(/\nStand \d{2}\.\d{2}\.\d{4}: 6 offene Fragen/);
    expect(md.out.match(/^<!-- q-[0-9a-f]{16} -->$/gm)).toHaveLength(6);
    expect(md.out).not.toMatch(/Kennung|Ereignis \d|Participant_/);
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

  /** The sheet with `answer` in the row of `id` (the five-column export leaves it empty). */
  function fill(sheet: string, id: string, answer: string): string {
    const start = sheet.indexOf(`\r\n"${id}";`);
    expect(start).toBeGreaterThan(0);
    const end = sheet.indexOf(';""\r\n', start);
    return `${sheet.slice(0, end)};"${answer}"${sheet.slice(end + ';""'.length)}`;
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

    // One answer on the held relation: a human note on it; the item stays open (M6 S5c-1:
    // a note informs, only an outside mark makes an item answered).
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
      question: { id: held.id, state: 'open' },
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
    expect(again.out).toContain(
      `${P}: note on ${held.id} unchanged: the latest note says the same`,
    );

    // A subject answer stays with the question; the personal-data check warns, never blocks.
    const text = 'Die Hausbank, Kontakt max.muster@example.org';
    const kept = await analyzr(['questions', 'answer', partner.id, '-p', P, '--text', text]);
    expect(kept.err).toBe('');
    expect(kept.code).toBe(0);
    expect(kept.out).toMatch(
      new RegExp(`^${P}: note on ${partner.id} recorded, kept with the question\\n`),
    );
    expect(kept.out).toContain(
      `  warning: the note probably contains an e-mail address (characters ${text.indexOf('max') + 1}–${text.length})\n`,
    );
    // The answer kinds are gone (M6 S5c-1): the outside mark is an action of its own.
    const kinded = await analyzr([
      'questions',
      'answer',
      partner.id,
      '-p',
      P,
      '--text',
      'x',
      '--kind',
      'ausserhalb',
    ]);
    expect(kinded.code).toBe(1);
    expect(kinded.err).toContain(
      `--kind is gone since M6 S5c-1: every answer is a note, so drop it; to mark a question outside the landscape run analyzr questions outside ${partner.id} -p ${P}`,
    );
    const marked = await analyzr(['questions', 'outside', partner.id, '-p', P]);
    expect(marked.err).toBe('');
    expect(marked.code).toBe(0);
    expect(marked.out).toMatch(
      new RegExp(`^${P}: ${partner.id} marked outside the landscape \\(oqa_[0-9A-Z]{26}\\)\\n`),
    );
    expect((await list('--state', 'answered')).map((q) => q.id)).toEqual([partner.id]);

    // The sheet of the open questions, filled in: two answers, an unknown id, a long one.
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
    sheet = fill(sheet, missing.id, 'Kommt im nächsten Release.');
    sheet = fill(sheet, duplicate.id, 'x'.repeat(2001));
    sheet += '"q-0000000000000000";"";"";"";"Gibt es nicht."\r\n';
    const sheetFile = path.join(dir, 'antworten.csv');
    await writeFile(sheetFile, sheet);
    const ids = [...sheet.matchAll(/\r\n"(q-[0-9a-f]{16})";/g)].map((m) => m[1]);
    const rowOf = (id: string) => ids.indexOf(id) + 2;

    // The dry run lists every filled row under its spreadsheet row and stores nothing.
    const dry = await analyzr(['questions', 'answer', '-p', P, '--from', sheetFile, '--dry-run']);
    expect(dry.code).toBe(1);
    expect(dry.out).toMatch(
      new RegExp(
        `\\n? {2}row +${rowOf(callTarget.id)} {2}${callTarget.id} {2}would record {2}note, kept with the question\\n`,
      ),
    );
    expect(dry.out).toMatch(
      new RegExp(
        `row +${rowOf(missing.id)} {2}${missing.id} {2}would record {2}note, kept with the question\\n`,
      ),
    );
    expect(dry.out).toMatch(
      new RegExp(`row +${rowOf(duplicate.id)} {2}${duplicate.id} {2}invalid +`),
    );
    expect(dry.out).toMatch(
      new RegExp(
        `row +${ids.length + 1} {2}q-0000000000000000 {2}unknown +no current open question`,
      ),
    );
    expect(dry.out).toContain(
      `${P}: ${sheetFile} (dry run, nothing recorded): 2 to record, 1 unchanged, 1 unknown, 1 invalid, ${ids.length - 5} rows without an answer\n`,
    );
    expect(dry.err).toContain('2 rows would not be recorded (1 unknown, 1 invalid)');
    expect(await list('--state', 'answered')).toHaveLength(1);

    // Recorded: the rest in one call, the unknown and invalid rows never; again: unchanged.
    const real = await analyzr(['questions', 'answer', '-p', P, '--from', sheetFile, '--json']);
    expect(real.code).toBe(1);
    expect(real.err).toContain('2 rows not recorded (1 unknown, 1 invalid)');
    const result = JSON.parse(real.out) as SheetOutcome;
    expect(result).toMatchObject({
      dryRun: false,
      counts: { recorded: 2, unchanged: 1, unknown: 1, invalid: 1, ignored: ids.length - 5 },
    });
    expect(result.rows.map((r) => [r.row, r.id, r.outcome])).toEqual(
      [
        [rowOf(callTarget.id), callTarget.id, 'recorded'],
        [rowOf(missing.id), missing.id, 'recorded'],
        // The held relation is still open: the export carries its note, read back unchanged.
        [rowOf(held.id), held.id, 'unchanged'],
        [rowOf(duplicate.id), duplicate.id, 'invalid'],
        [ids.length + 1, 'q-0000000000000000', 'unknown'],
      ].sort((a, b) => Number(a[0]) - Number(b[0])),
    );
    // Notes leave the items open; only the outside mark answers one.
    const answered = await list('--state', 'answered');
    expect(answered.map((q) => q.id)).toEqual([partner.id]);
    const repeated = await analyzr(['questions', 'answer', '-p', P, '--from', sheetFile, '--json']);
    expect((JSON.parse(repeated.out) as SheetOutcome).counts).toMatchObject({
      recorded: 0,
      unchanged: 3,
    });

    // The export carries the latest notes; read back, the whole sheet is unchanged.
    const all = path.join(dir, 'antworten-alle.csv');
    expect((await analyzr(['questions', '-p', P, '--format', 'csv', '-o', all])).code).toBe(0);
    const roundTrip = await analyzr(['questions', 'answer', '-p', P, '--from', all, '--dry-run']);
    expect(roundTrip.err).toBe('');
    expect(roundTrip.code).toBe(0);
    expect(roundTrip.out).toContain(': 0 to record, 4 unchanged, 0 unknown, 0 invalid, ');
    const table = await analyzr(['questions', '-p', P, '--state', 'answered']);
    expect(table.out.match(/ {2}\[answered: outside the landscape\]\n/g)).toHaveLength(1);
    expect(table.out).toMatch(
      /: 1 open question \(.*\), 1 answered \(outside the landscape\); groups: ask 1\n$/,
    );
  });
});

describe('analyzr questions outside|link|place (M6 S5c-1)', () => {
  const P = 'actions-e2e';
  const FRAUD_CHECK = 'vertrieb/order-handling#Call_FraudCheck';
  const KREDIT = 'finanzen/kreditpruefung#Process_Kreditpruefung';

  interface Item {
    id: string;
    kind: string;
    source: string;
    subject: { type: string; id: string };
    state: string;
    answers: { id: string; role: string; text: string | null; withdrawal: unknown }[];
    actions: { type: string; primary: boolean; label: string; suggested?: string[] }[];
  }

  async function rest(pathname: string, init: RequestInit = {}, secret?: string) {
    const bearer = secret ?? (await readFile(keyFile, 'utf8')).trim();
    return fetch(`${server.url}/api/v1/projects/${P}${pathname}`, {
      ...init,
      headers: {
        authorization: `Bearer ${bearer}`,
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

  const primary = (q: Item) => q.actions.find((a) => a.primary)?.type;

  it('links, places and marks open questions as a human; agents are refused', async () => {
    const seeded = await analyzr(['seed', 'nordwind-handel', '--project', P, '--value-chains']);
    expect(seeded.err).toBe('');
    expect(seeded.code).toBe(0);
    const before = await list();
    expect(before).toHaveLength(64);
    const fraud = before.find((q) => q.source === 'finding' && q.subject.id === FRAUD_CHECK);
    const otherCall = before.find(
      (q) => q.kind === 'call-target-unknown' && q.subject.id !== FRAUD_CHECK,
    );
    const unplaced = before.filter(
      (q) =>
        q.kind === 'process-without-step' &&
        primary(q) === 'place' &&
        !q.subject.id.startsWith('finanzen/kreditpruefung#'),
    );
    const step = before.find((q) => q.kind === 'step-without-process' && primary(q) === 'place');
    const [pool, otherPool] = before.filter((q) => q.kind === 'black-box-partner');
    const [first, second, third, fourth] = unplaced;
    if (
      !fraud ||
      !otherCall ||
      !first ||
      !second ||
      !third ||
      !fourth ||
      !step ||
      !pool ||
      !otherPool
    ) {
      throw new Error('the seeded open questions changed');
    }
    const findings = async () =>
      (await status()).projects.find((p) => p.key === P)?.findings['unresolved-call'];
    const unresolved = await findings();

    // Agents never act: refused before any request.
    const token = await analyzr(['token', 'create', '-p', P, '--name', 'actions', '--json']);
    const agentSecret = (JSON.parse(token.out) as { secret: string }).secret;
    const agentEnv = { ANALYZR_TOKEN: agentSecret };
    for (const argv of [
      ['link', fraud.id, '--to', KREDIT],
      ['place', first.id, '--step', '@outside'],
      ['outside', pool.id],
    ]) {
      const refused = await analyzr(['questions', ...argv, '-p', P], agentEnv);
      expect(refused.code, argv.join(' ')).toBe(1);
      expect(refused.err).toContain('only humans act on open questions');
    }

    // An ambiguous target lists the candidates and sends nothing.
    const twice = await analyzr([
      'questions',
      'link',
      fraud.id,
      '-p',
      P,
      '--to',
      'Bestellfreigabe',
    ]);
    expect(twice.code).toBe(1);
    expect(twice.err).toBe(
      'analyzr: "Bestellfreigabe" matches 2 processes; name one by its ref:\n' +
        '  „Bestellfreigabe“ (einkauf/archiv/bestellfreigabe-2019#Process_Bestellfreigabe)\n' +
        '  „Bestellfreigabe“ (einkauf/bestellfreigabe#Process_Bestellfreigabe)\n' +
        'nothing was sent\n',
    );
    const model = await analyzr([
      'questions',
      'link',
      fraud.id,
      '-p',
      P,
      '--to',
      'finanzen/kreditpruefung',
    ]);
    expect(model.code).toBe(1);
    expect(model.err).toContain(
      'model finanzen/kreditpruefung has 2 processes; name one by its ref:',
    );
    expect((await list()).map((q) => q.id)).toEqual(before.map((q) => q.id));

    // A process name: an accepted manual relation; the item goes, „Befunde“ keeps the finding (R1).
    const linked = await analyzr([
      'questions',
      'link',
      fraud.id,
      '-p',
      P,
      '--to',
      'kreditprüfung',
      '--note',
      'Laut Fachbereich Vertrieb.',
    ]);
    expect(linked.err).toBe('');
    expect(linked.code).toBe(0);
    const origin = server.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(linked.out).toMatch(
      new RegExp(
        `^${P}: ${fraud.id} linked\n  .*\n  wrote the accepted manual relation ${FRAUD_CHECK} → ${KREDIT} \\(rel_[0-9A-Z]{26}\\)\n  the question is resolved and leaves the list\n  to undo, reject the manual relation in the review screen of the web UI:\n    ${origin}/projects/${P}/review/rel_[0-9A-Z]{26}\n$`,
      ),
    );
    expect((await list()).some((q) => q.id === fraud.id)).toBe(false);
    expect(await findings()).toBe(unresolved);

    // An agent's proposal from the other call is suggested in the table, and the link accepts it.
    const target = 'finanzen/mahnwesen#Process_Mahnwesen';
    const proposed = await rest(
      '/relations',
      {
        method: 'POST',
        body: JSON.stringify({
          type: 'call',
          from: otherCall.subject.id,
          to: target,
          confidence: 0.8,
          rationale: 'Der Aufruf passt zum Zweck des Prozesses.',
        }),
      },
      agentSecret,
    );
    expect(proposed.status, await proposed.clone().text()).toBe(200);
    const proposal = ((await proposed.json()) as { relation: { id: string } }).relation;
    const table = await analyzr(['questions', '-p', P, '--kind', 'call-target-unknown']);
    expect(table.out).toContain(`  ${otherCall.id}  `);
    expect(table.out).toContain(`      suggested for link: „Mahnwesen“ (${target})\n`);
    const accepted = await analyzr([
      'questions',
      'link',
      otherCall.id,
      '-p',
      P,
      '--to',
      'finanzen/mahnwesen',
      '--json',
    ]);
    expect(accepted.err).toBe('');
    expect(accepted.code).toBe(0);
    expect(JSON.parse(accepted.out)).toMatchObject({
      result: 'applied',
      question: null,
      relations: [
        { effect: 'decision', relation: { id: proposal.id, type: 'call', status: 'accepted' } },
      ],
    });

    // Placements: on a step of the chain, on @outside, and a process on a step without one.
    const chain = (await (await rest('/value-chains/main')).json()) as {
      steps: { elementId: string; depth: number }[];
    };
    const nested = chain.steps.find((s) => s.depth > 0)?.elementId;
    if (!nested) throw new Error('the golden chain has no nested step');
    const onStep = await analyzr(['questions', 'place', first.id, '-p', P, '--step', nested]);
    expect(onStep.err).toBe('');
    expect(onStep.code).toBe(0);
    expect(onStep.out).toMatch(
      new RegExp(
        `^${P}: ${first.id}: placed „.+“ on step „.+“ \\(${nested}\\) \\(plc_[0-9A-Z]{26}\\)\n`,
      ),
    );
    const outside = await analyzr(['questions', 'place', second.id, '-p', P, '--step', '@outside']);
    expect(outside.code).toBe(0);
    expect(outside.out).toMatch(
      new RegExp(`^${P}: ${second.id}: placed „.+“ on no step \\(@outside\\)`),
    );
    const modelKey = third.subject.id.split('#')[0] ?? '';
    const filled = await analyzr(['questions', 'place', step.id, '-p', P, '--process', modelKey]);
    expect(filled.err).toBe('');
    expect(filled.code).toBe(0);
    expect(filled.out).toContain(`(${step.subject.id})`);
    const placedIds = new Set((await list()).map((q) => q.id));
    // The step's item goes, and so does the item of the process placed on it.
    for (const q of [first, second, step, third]) expect(placedIds.has(q.id), q.kind).toBe(false);

    // An action the item does not offer names the ones it does.
    const wrong = await analyzr(['questions', 'outside', fourth.id, '-p', P]);
    expect(wrong.code).toBe(1);
    expect(wrong.err).toContain(
      `${fourth.id} (process-without-step) offers no outside; its actions: Schritt wählen … (place), Gehört zu keinem Schritt (place), Notiz hinzufügen (note, analyzr questions answer)`,
    );

    // The outside mark: answered, a second click unchanged, undone, marked again.
    const marked = await analyzr([
      'questions',
      'outside',
      pool.id,
      '-p',
      P,
      '--note',
      'Die Hausbank.',
    ]);
    expect(marked.err).toBe('');
    expect(marked.code).toBe(0);
    const markId = /\((oqa_[0-9A-Z]{26})\)/.exec(marked.out)?.[1];
    if (!markId) throw new Error(`no mark id in ${marked.out}`);
    expect(marked.out).toContain(
      `  undo with: analyzr questions outside ${pool.id} -p ${P} --undo ${markId}\n`,
    );
    expect((await list('--state', 'answered')).map((q) => q.id)).toEqual([pool.id]);
    const again = await analyzr(['questions', 'outside', pool.id, '-p', P]);
    expect(again.out).toContain(
      `${P}: ${pool.id} unchanged: marked outside the landscape already (${markId})\n`,
    );
    const undone = await analyzr(['questions', 'outside', pool.id, '-p', P, '--undo', markId]);
    expect(undone.err).toBe('');
    expect(undone.code).toBe(0);
    expect(undone.out).toContain(
      `${P}: outside mark ${markId} on ${pool.id} withdrawn; the question is open again\n`,
    );
    expect(await list('--state', 'answered')).toEqual([]);
    const undoneAgain = await analyzr(['questions', 'outside', pool.id, '-p', P, '--undo', markId]);
    expect(undoneAgain.out).toContain('unchanged: withdrawn before');
    expect((await analyzr(['questions', 'outside', pool.id, '-p', P])).code).toBe(0);
    const remarked = (await list('--state', 'answered')).find((q) => q.id === pool.id);
    expect(remarked?.answers.map((a) => [a.role, a.text, a.withdrawal === null])).toEqual([
      ['outside-mark', 'Die Hausbank.', false],
      ['outside-mark', null, true],
    ]);
    // A note leaves the state as it is.
    const note = await analyzr([
      'questions',
      'answer',
      otherPool.id,
      '-p',
      P,
      '--text',
      'Ein Dienstleister.',
    ]);
    expect(note.code).toBe(0);
    expect(note.out).toContain(
      `  a note leaves the question open; its action „Liegt außerhalb der Landschaft“: analyzr questions outside ${otherPool.id} -p ${P}\n`,
    );
    expect((await list('--state', 'answered')).map((q) => q.id)).toEqual([pool.id]);
  });

  it('reads a sheet of S5a with Antwortart: the outside mark on a pool, a note on a held relation', async () => {
    const proposed = (await (await rest('/relations?status=proposed&limit=200')).json()) as {
      items: { id: string }[];
    };
    const [relation] = proposed.items;
    if (!relation) throw new Error('the rule tier proposed no relation');
    const hold = await rest(`/relations/${relation.id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ verdict: 'hold', note: 'Klären.', question: 'Gilt das immer?' }),
    });
    expect(hold.status).toBe(200);
    const items = await list('--state', 'open');
    const held = items.find((q) => q.kind === 'held' && q.subject.id === relation.id);
    const pool = items.find((q) => q.kind === 'black-box-partner' && q.answers.length === 0);
    if (!held || !pool) throw new Error('no held relation or unanswered pool');
    const outside = 'Liegt außerhalb der Landschaft';
    const sheet =
      '﻿"id";"Art";"Frage";"Ansprechpartner-Hinweis";"Antwort";"Antwortart"\r\n' +
      `"${pool.id}";"";"";"";"Extern.";"${outside}"\r\n` +
      `"${held.id}";"";"";"";"Ja, immer.";"${outside}"\r\n`;
    const file = path.join(dir, 'antworten-s5a.csv');
    await writeFile(file, sheet);
    const r = await analyzr(['questions', 'answer', '-p', P, '--from', file]);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toContain(
      `  row 2  ${pool.id}  recorded  outside mark (the Antwortart of an earlier sheet), kept with the question\n`,
    );
    expect(r.out).toContain(
      `  row 3  ${held.id}  recorded  note, as a note on relation ${relation.id}\n`,
    );
    const after = await list();
    expect(after.find((q) => q.id === pool.id)?.state).toBe('answered');
    expect(after.find((q) => q.id === held.id)?.state).toBe('open');
  });
});

describe('analyzr models amend|pull, questions amend and amendments (M6 S5c-2)', () => {
  const P = 'amend-e2e';
  const CALL = 'vertrieb/auftrag#Call_Rechnung';
  const RECHNUNG = 'finanzen/rechnung#Process_Rechnung';
  const root = () => path.join(dir, P);
  const DEFS =
    'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" targetNamespace="http://example.org/bpmn"';

  /** The caller, written for this test: a call without a target, a resolved call, unnamed start and end. */
  const auftrag = (v: { task?: string; called?: string } = {}) =>
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<bpmn:definitions ${DEFS} id="Defs_Auftrag">`,
      '  <bpmn:process id="Process_Auftrag" name="Auftragsabwicklung" isExecutable="true">',
      '    <bpmn:documentation>Wickelt Aufträge ab.</bpmn:documentation>',
      '    <bpmn:startEvent id="Start_Auftrag" />',
      `    <bpmn:task id="Task_Pruefen" name="${v.task ?? 'Auftrag prüfen'}" />`,
      `    <bpmn:callActivity id="Call_Rechnung" name="Rechnung stellen"${v.called === undefined ? '' : ` calledElement="${v.called}"`} />`,
      '    <bpmn:callActivity id="Call_Lager" name="Einlagern" calledElement="Process_Lager" />',
      '    <bpmn:endEvent id="End_Auftrag" />',
      '  </bpmn:process>',
      '</bpmn:definitions>',
      '',
    ].join('\n');
  const rechnung = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<bpmn:definitions ${DEFS} id="Defs_Rechnung">`,
    '  <bpmn:process id="Process_Rechnung" name="Rechnungsstellung" isExecutable="true">',
    '    <bpmn:documentation>Stellt Rechnungen.</bpmn:documentation>',
    '    <bpmn:startEvent id="Start_Rechnung" name="Rechnung angefordert" />',
    '    <bpmn:endEvent id="End_Rechnung" name="Rechnung gestellt" />',
    '  </bpmn:process>',
    '</bpmn:definitions>',
    '',
  ].join('\n');
  const lager = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<bpmn:definitions ${DEFS} id="Defs_Lager">`,
    '  <bpmn:process id="Process_Lager" name="Einlagerung" isExecutable="true">',
    '    <bpmn:startEvent id="Start_Lager" name="Ware angekommen" />',
    '    <bpmn:endEvent id="End_Lager" name="Ware eingelagert" />',
    '  </bpmn:process>',
    '</bpmn:definitions>',
    '',
  ].join('\n');

  interface Item {
    id: string;
    kind: string;
    subject: { type: string; id: string };
    actions: {
      type: string;
      primary: boolean;
      label: string;
      amend?: { targets: { elementId: string; op: string; prefill?: string }[]; replaces?: string };
      withdraw?: { amendment?: string };
    }[];
  }
  interface Amendment {
    id: string;
    modelKey: string;
    elementId: string;
    op: string;
    before: string | null;
    after: string;
    state: string;
    conflict: string | null;
    seq: number;
  }

  async function list(...flags: string[]): Promise<Item[]> {
    const r = await analyzr(['questions', '-p', P, '--format', 'json', ...flags]);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    return JSON.parse(r.out) as Item[];
  }

  async function amendments(): Promise<Amendment[]> {
    const r = await analyzr(['amendments', 'list', '-p', P, '--json']);
    expect(r.code).toBe(0);
    return (JSON.parse(r.out) as { items: Amendment[] }).items;
  }

  /** Imports `vertrieb/auftrag.bpmn` with these bytes alone. */
  async function reimport(text: string, name: string) {
    await mkdir(path.join(root(), name, 'vertrieb'), { recursive: true });
    await writeFile(path.join(root(), name, 'vertrieb', 'auftrag.bpmn'), text);
    return analyzr(['import', path.join(P, name), '-p', P]);
  }

  const pull = async (...flags: string[]) => {
    const r = await analyzr(['models', 'pull', 'vertrieb/auftrag', '-p', P, ...flags]);
    expect(r.code).toBe(0);
    return r;
  };

  beforeAll(async () => {
    for (const [rel, text] of [
      ['vertrieb/auftrag.bpmn', auftrag()],
      ['finanzen/rechnung.bpmn', rechnung],
      ['lager/einlagerung.bpmn', lager],
    ] as const) {
      await mkdir(path.dirname(path.join(root(), 'src', rel)), { recursive: true });
      await writeFile(path.join(root(), 'src', rel), text);
    }
  });

  it('amends through the questions and the models, pulls both revisions and re-imports', async () => {
    const imported = await analyzr(['import', path.join(P, 'src'), '-p', P, '--create']);
    expect(imported.err).toBe('');
    expect(imported.code).toBe(0);

    const items = await list();
    const call = items.find((q) => q.kind === 'call-target-unknown' && q.subject.id === CALL);
    const boundary = items.find((q) => q.kind === 'unlabelled-boundary');
    if (!call || !boundary) throw new Error('no call or boundary question');
    expect(call.actions.find((a) => a.primary)?.type).toBe('amend');
    const table = await analyzr(['questions', '-p', P]);
    expect(table.out).toMatch(
      /\n {6}amend targets: Startereignis „Start_Auftrag“ \(--element Start_Auftrag\), Endereignis „End_Auftrag“ \(--element End_Auftrag\)\n/,
    );

    // A dry run writes nothing and names the call the rule tier accepts.
    const dry = await analyzr([
      'models',
      'amend',
      'vertrieb/auftrag',
      '-p',
      P,
      '--element',
      'Call_Rechnung',
      '--call-target',
      'Rechnungsstellung',
      '--dry-run',
    ]);
    expect(dry.err).toBe('');
    expect(dry.code).toBe(0);
    expect(dry.out).toContain(`${P}: vertrieb/auftrag (r1): dry run, nothing recorded yet\n`);
    expect(dry.out).toContain(
      '  would record  call target of Call_Rechnung: (none) → „Process_Rechnung“\n',
    );
    expect(dry.out).toContain(`    accepted by the rule tier: call ${CALL} → ${RECHNUNG}\n`);
    expect(dry.out).toContain(`    finding resolved: unresolved-call ${CALL}\n`);
    expect((await amendments()).length).toBe(0);

    // The question's action: the call target by process name.
    const byQuestion = await analyzr([
      'questions',
      'amend',
      call.id,
      '-p',
      P,
      '--call-target',
      'Rechnungsstellung',
    ]);
    expect(byQuestion.err).toBe('');
    expect(byQuestion.code).toBe(0);
    expect(byQuestion.out).toContain(
      `${P}: amended vertrieb/auftrag: new head r2, computed from the uploaded r1\n  ${call.id}: `,
    );
    expect(byQuestion.out).toMatch(
      /\n {2}recorded {2}call target of Call_Rechnung: \(none\) → „Process_Rechnung“ \(mam_\w{26}\)\n/,
    );
    expect(byQuestion.out).toMatch(
      /\n {2}withdraw it with: analyzr amendments withdraw mam_\w{26} -p amend-e2e\n/,
    );
    const after = await list();
    expect(after.some((q) => q.subject.id === CALL)).toBe(false);

    // Several targets: --element picks one.
    const fresh = after.find((q) => q.kind === 'unlabelled-boundary');
    if (!fresh) throw new Error('the boundary question is gone');
    const several = await analyzr([
      'questions',
      'amend',
      fresh.id,
      '-p',
      P,
      '--name',
      'Auftrag eingegangen',
    ]);
    expect(several.code).toBe(1);
    expect(several.err).toContain(`${fresh.id} amends 2 elements: pick one with --element <id>:`);
    const start = await analyzr([
      'questions',
      'amend',
      fresh.id,
      '-p',
      P,
      '--element',
      'Start_Auftrag',
      '--name',
      'Auftrag eingegangen',
    ]);
    expect(start.err).toBe('');
    expect(start.code).toBe(0);
    expect(start.out).toContain(
      `${P}: amended vertrieb/auftrag: new head r3, computed from the uploaded r1\n`,
    );

    // Both downloads: the amended head, and the original byte for byte.
    const head = await pull('-o', path.join(P, 'amended.bpmn'));
    expect(head.err).toMatch(/^r3 [0-9a-f]{64} \(the head, amended from the uploaded r1\)\n$/);
    const amended = await readFile(path.join(root(), 'amended.bpmn'), 'utf8');
    expect(amended).toBe(
      auftrag()
        .replace(
          '<bpmn:startEvent id="Start_Auftrag" />',
          '<bpmn:startEvent id="Start_Auftrag" name="Auftrag eingegangen" />',
        )
        .replace(
          'name="Rechnung stellen" />',
          'name="Rechnung stellen" calledElement="Process_Rechnung" />',
        ),
    );
    const original = await pull('--original');
    expect(original.out).toBe(auftrag());
    expect(original.err).toMatch(
      /^r1 [0-9a-f]{64} \(uploaded; the head r3 is amended from it\)\n$/,
    );

    // The same bytes, and analyzr's own amended bytes, stay unchanged.
    const same = await reimport(auftrag(), 'same');
    expect(same.code).toBe(0);
    expect(same.out).toContain('  unchanged vertrieb/auftrag  amendments: 2 applied\n');
    const own = await reimport(amended, 'own');
    expect(own.out).toContain('  unchanged vertrieb/auftrag  amendments: 2 applied\n');

    // A change elsewhere: the uploaded revision and an amended head with both amendments.
    const elsewhere = await reimport(auftrag({ task: 'Auftrag sorgfältig prüfen' }), 'elsewhere');
    expect(elsewhere.err).toBe('');
    // The extractor still warns about the call without a target in the uploaded bytes.
    expect(elsewhere.out).toContain(
      '  revised   vertrieb/auftrag  warnings: 1 (call-without-target 1)  amendments: 2 applied\n',
    );
    const rederived = await pull();
    expect(rederived.err).toMatch(/^r5 [0-9a-f]{64} \(the head, amended from the uploaded r4\)\n$/);
    expect(rederived.out).toContain('name="Auftrag sorgfältig prüfen"');
    expect(rederived.out).toContain('calledElement="Process_Rechnung"');

    // The tool sets another target: a conflict, the other amendment still applies.
    const changed = auftrag({ task: 'Auftrag sorgfältig prüfen', called: 'Process_Versand' });
    const conflict = await reimport(changed, 'conflict');
    expect(conflict.out).toContain(
      '  revised   vertrieb/auftrag  amendments: 1 applied, 1 conflict\n',
    );
    expect(conflict.out).toContain(
      `${P}: 1 amendment no longer applies; see analyzr questions -p ${P} --kind amendment-conflict\n`,
    );
    const [question, ...more] = await list('--kind', 'amendment-conflict');
    if (!question) throw new Error('no amendment-conflict question');
    expect(more).toHaveLength(0);
    expect(question.actions.map((a) => [a.type, a.primary, a.label])).toEqual([
      ['withdraw-amendment', true, 'Wert aus dem Quellsystem übernehmen'],
      ['amend', false, 'Meine Ergänzung behalten'],
      ['note', false, 'Notiz hinzufügen'],
    ]);
    const conflicted = (await amendments()).find((a) => a.op === 'call-target');
    expect(conflicted).toMatchObject({ state: 'conflict', conflict: 'value-changed' });

    // „Meine Ergänzung behalten“: the prefilled value again, over the tool's value.
    const keep = await analyzr(['questions', 'amend', question.id, '-p', P]);
    expect(keep.err).toBe('');
    expect(keep.code).toBe(0);
    expect(keep.out).toContain(
      `  recorded  call target of Call_Rechnung: „Process_Versand“ → „Process_Rechnung“ (`,
    );
    expect(keep.out).toContain(`, replacing ${conflicted?.id ?? '?'}\n`);
    expect(await list('--kind', 'amendment-conflict')).toHaveLength(0);
  });

  it('refuses a field no question names and agents; documents a process; exports and withdraws', async () => {
    const refused = await analyzr([
      'models',
      'amend',
      'vertrieb/auftrag',
      '-p',
      P,
      '--element',
      'Call_Lager',
      '--call-target',
      'Rechnungsstellung',
    ]);
    expect(refused.code).toBe(1);
    expect(refused.out).toContain(
      '  not applicable  call target of Call_Lager: only-open-questions',
    );
    expect(refused.err).toBe('analyzr: the amendment is not applicable; nothing recorded\n');

    const token = await analyzr([
      'token',
      'create',
      '-p',
      P,
      '--scopes',
      'read,propose,write',
      '--json',
    ]);
    const agent = { ANALYZR_TOKEN: (JSON.parse(token.out) as { secret: string }).secret };
    const byAgent = await analyzr(
      [
        'models',
        'amend',
        'lager/einlagerung',
        '-p',
        P,
        '--element',
        'Process_Lager',
        '--documentation',
        'X',
      ],
      agent,
    );
    expect(byAgent.code).toBe(1);
    expect(byAgent.err).toContain('only humans amend models');
    const listed = await analyzr(['amendments', 'list', '-p', P], agent);
    expect(listed.code).toBe(0);
    expect(listed.out).toMatch(/: 3 amendments \(applied 2, superseded 1\), as of event \d+\n$/);
    const { seq } = JSON.parse((await analyzr(['amendments', 'list', '-p', P, '--json'])).out) as {
      seq: number;
    };

    const documented = await analyzr([
      'models',
      'amend',
      'lager/einlagerung',
      '-p',
      P,
      '--element',
      'Process_Lager',
      '--documentation',
      'Lagert eingehende Ware ein.',
    ]);
    expect(documented.err).toBe('');
    expect(documented.code).toBe(0);
    expect(documented.out).toContain(
      `${P}: amended lager/einlagerung: new head r2, computed from the uploaded r1\n`,
    );
    expect(documented.out).toContain(
      '  recorded  documentation of Process_Lager: (none) → „Lagert eingehende Ware ein.“ (',
    );

    // The change list: every amendment as CSV; with --since only the new one.
    const csv = await analyzr([
      'amendments',
      'export',
      '-p',
      P,
      '--format',
      'csv',
      '-o',
      path.join(P, 'liste.csv'),
    ]);
    expect(csv.err).toBe('');
    expect(csv.code).toBe(0);
    const bytes = await readFile(path.join(root(), 'liste.csv'));
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(
      bytes
        .toString('utf8')
        .split('\r\n')
        .filter((l) => l !== ''),
    ).toHaveLength(5);
    const since = await analyzr(['amendments', 'export', '-p', P, '--since', String(seq)]);
    expect(since.code).toBe(0);
    expect(since.out).toMatch(/^# Änderungsliste: /);
    expect(since.out).toContain(`neu seit Ereignis ${seq}`);
    expect(since.out.match(/^#### \d+\. /gm)).toHaveLength(1);
    expect(since.out).toContain('### Zu übertragen (1)');
    expect(since.out).toContain('Lagert eingehende Ware ein.');
    expect(since.err).toMatch(
      /^as of event \d+: export with --since \d+ next time for what is new\n$/,
    );

    // Withdrawals: one, then every live amendment of a model.
    const byAgentWithdraw = await analyzr(
      ['amendments', 'withdraw', '--model', 'lager/einlagerung', '-p', P],
      agent,
    );
    expect(byAgentWithdraw.code).toBe(1);
    expect(byAgentWithdraw.err).toContain('only humans withdraw amendments');
    const doc = (await amendments()).find((a) => a.op === 'process-documentation');
    if (!doc) throw new Error('no documentation amendment');
    const one = await analyzr(['amendments', 'withdraw', doc.id, '-p', P]);
    expect(one.err).toBe('');
    expect(one.code).toBe(0);
    expect(one.out).toContain(
      `${P}: withdrew 1 amendment of lager/einlagerung; new head r3, re-derived from the uploaded r1 (no amendment applies: the uploaded bytes)\n`,
    );
    const again = await analyzr(['amendments', 'withdraw', doc.id, '-p', P]);
    expect(again.out).toBe(`${P}: nothing withdrawn: ${doc.id} ended before (withdrawn)\n`);

    const all = await analyzr(['amendments', 'withdraw', '--model', 'vertrieb/auftrag', '-p', P]);
    expect(all.err).toBe('');
    expect(all.code).toBe(0);
    expect(all.out).toContain(
      `${P}: withdrew 2 amendments of vertrieb/auftrag; new head r9, re-derived from the uploaded r6 (no amendment applies: the uploaded bytes)\n`,
    );
    const head = await pull();
    expect(head.out).toBe(
      auftrag({ task: 'Auftrag sorgfältig prüfen', called: 'Process_Versand' }),
    );
    expect(head.err).toMatch(/^r9 [0-9a-f]{64} \(the head, amended from the uploaded r6\)\n$/);
    expect((await amendments()).map((a) => a.state).sort()).toEqual([
      'superseded',
      'withdrawn',
      'withdrawn',
      'withdrawn',
    ]);
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
    // S2b follow-up: the dry run names the agent work, in text and in `--json`
    const dry = await analyzr(['import', 'changed', '-p', 'nordwind-handel', '--dry-run']);
    expect(dry.code).toBe(0);
    const dryJson = await analyzr([
      'import',
      'changed',
      '-p',
      'nordwind-handel',
      '--dry-run',
      '--json',
    ]);
    const preview = JSON.parse(dryJson.out) as {
      impact: { relationsTasks: { queued: { items: string[] }; pairs: number; claimed: number } };
    };
    expect(preview.impact.relationsTasks.queued.items).toEqual(['finanzen/gutschrift']);
    expect(preview.impact.relationsTasks.claimed).toBe(0);
    expect(dry.out).toContain(
      `queue 1 relations task, ${preview.impact.relationsTasks.pairs} pair`,
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
    // S2b follow-up step 3b: the pairs the waiting tasks will judge, as `status` counts them
    const project = (await status()).projects.find((p) => p.key === 'm6-s1');
    expect(project?.stages).toEqual({ waiting_for_agent: 2 });
    const pairs = pairsToJudgeText(project?.pairsToJudge ?? null);
    expect(r.out).toContain(
      `m6-s1: 2 relations tasks waiting${pairs ? `, ${pairs}` : ''}, placement task waiting: no\n`,
    );
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
    // S2b follow-up: the deletion cancels the model's queued relations task
    expect(dry.out).toMatch(/\n {2}w\/dup: .*, relations task cancelled\n/);
    expect(dry.err).toContain('nothing deleted');

    const deleted = await analyzr(['models', 'delete', 'w/dup', '-p', 'm6-s1', '--yes']);
    expect(deleted.err).toBe('');
    expect(deleted.code).toBe(0);
    expect(deleted.out).toContain('deleted w/dup\n');
    const after = await analyzr(['models', 'list', '-p', 'm6-s1']);
    expect(after.out).toContain('m6-s1: 1 model\n');
  });
});

describe('analyzr import with the manifest and models external-ids (M6 S2a)', () => {
  const bundle = path.join(REPO_ROOT, 'tools/integrate/test/fixtures/signavio/bundle');
  interface ManifestFile {
    path: string;
    key: string;
    externalId?: string;
    externalPath: string;
  }
  let manifest: { files: ManifestFile[] };

  beforeAll(async () => {
    manifest = JSON.parse(await readFile(path.join(bundle, 'analyzr-import.json'), 'utf8')) as {
      files: ManifestFile[];
    };
  });

  it("imports the integrate plugin's golden bundle under its pinned keys, with its provenance", async () => {
    const r = await analyzr(['import', bundle, '-p', 'm6-s2a', '--create']);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toContain(
      'manifest: analyzr-import.json (signavio), 6 of 6 files listed: keys pinned, provenance stored for 6\n',
    );
    expect(r.out).toContain('m6-s2a: 6 files, 6 created, 0 revised, 0 unchanged, 0 failed\n');
    expect(r.out).not.toContain('import warning');
  });

  it('rebuilds the key map the bundle was written with from analyzr models external-ids', async () => {
    const r = await analyzr([
      'models',
      'external-ids',
      '-p',
      'm6-s2a',
      '--system',
      'signavio',
      '--json',
    ]);
    expect(r.code).toBe(0);
    const { items } = JSON.parse(r.out) as {
      items: { key: string; externalId: string | null; externalPath: string | null }[];
    };
    expect(
      items.map(({ key, externalId, externalPath }) => ({ key, externalId, externalPath })),
    ).toEqual(
      manifest.files.map((f) => ({
        key: f.key,
        externalId: f.externalId ?? null,
        externalPath: f.externalPath,
      })),
    );
    const text = await analyzr(['models', 'external-ids', '-p', 'm6-s2a']);
    expect(text.out).toContain('m6-s2a: 6 models from signavio\n');
  });

  it('keeps the bytes unchanged, and warns when a tool id moves to another key', async () => {
    const again = await analyzr(['import', bundle, '-p', 'm6-s2a', '--json']);
    expect(again.code).toBe(0);
    const summary = JSON.parse(again.out) as {
      files: { outcome: string; importWarnings?: unknown }[];
      manifest: { stored: number; kept: number };
    };
    expect(summary.files.every((f) => f.outcome === 'unchanged' && !f.importWarnings)).toBe(true);
    expect(summary.manifest).toMatchObject({ stored: 0, kept: 6 });

    // A re-export where the tool moved "Versand" to another folder, and a converter that
    // forgot the pinned key: the file lands on a new key, whose tool id another key holds.
    const moved = path.join(dir, 'm6-s2a-moved');
    await mkdir(path.join(moved, 'versand'), { recursive: true });
    const versand = manifest.files.find((f) => f.key === 'logistik/versand');
    if (!versand) throw new Error('no logistik/versand in the golden bundle');
    await writeFile(
      path.join(moved, 'versand/versand.bpmn'),
      (await readFile(path.join(bundle, versand.path), 'utf8')).replace(
        '</bpmn:definitions>',
        '<!-- 2 --></bpmn:definitions>',
      ),
    );
    await writeFile(
      path.join(moved, 'analyzr-import.json'),
      JSON.stringify({
        format: 'analyzr-import/1',
        source: { system: 'signavio' },
        files: [
          { path: 'versand/versand.bpmn', externalId: versand.externalId, sha256: '0'.repeat(64) },
        ],
      }),
    );
    const r = await analyzr(['import', moved, '-p', 'm6-s2a']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('  created   versand/versand\n');
    expect(r.out).toContain(
      `      external-id-moved: signavio id ${versand.externalId ?? ''} already belongs to logistik/versand: two models now carry it (moved or renamed in the tool?)\n`,
    );
    expect(r.out).toContain(
      'next: same model twice? delete the extra key (analyzr models delete -p m6-s2a versand/versand) and re-import with the key pinned',
    );
    expect(r.out).toMatch(/ {6}manifest-sha-mismatch: the file's sha256 [0-9a-f]{12}… differs/);
    expect(r.out).toContain(
      'm6-s2a: 2 import warnings (external-id-moved 1, manifest-sha-mismatch 1); the files were imported\n',
    );
  });
});

describe("the integrate plugin's analyzr-read.mjs against the server (M6 S2b follow-up step 4)", () => {
  const bundle = path.join(REPO_ROOT, 'tools/integrate/test/fixtures/signavio/bundle');
  const scripts = path.join(REPO_ROOT, 'plugins/analyzr-integrate/scripts');
  const ws = () => path.join(dir, 'integrate-ws');

  // analyzr-read writes only into an existing workspace's reports/ (skill step 0 makes it).
  beforeAll(async () => {
    await mkdir(path.join(ws(), 'reports'), { recursive: true });
    await writeFile(path.join(ws(), 'analyzr-workspace.json'), '{}\n');
  });

  /** Runs one of the plugin's bundled scripts as the skill does, with the owner key file. */
  async function plugin(script: string, args: string[]) {
    try {
      const { stdout, stderr } = await promisify(execFile)(
        process.execPath,
        [path.join(scripts, script), ...args],
        { cwd: dir, env: cleanEnv({ ANALYZR_OWNER_KEY_FILE: keyFile }) },
      );
      return { code: 0, stdout, stderr };
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
  }

  async function seqOf(project: string): Promise<number | undefined> {
    return (await status()).projects.find((p) => p.key === project)?.seq;
  }

  it.each(['m6-s2a', 'nordwind-handel'])(
    'previews the golden bundle into %s exactly as analyzr import --dry-run --json, writing nothing',
    async (project) => {
      const details = path.join(ws(), 'reports', `${project}.preview.json`);
      const seq = await seqOf(project);
      const models = (await analyzr(['models', 'list', '-p', project, '--json'])).out;
      const r = await plugin('analyzr-read.mjs', [
        'preview',
        bundle,
        '-p',
        project,
        '--url',
        server.url,
        '--json-out',
        details,
      ]);
      expect(r).toMatchObject({ code: 0, stderr: '' });
      const dry = await analyzr(['import', bundle, '-p', project, '--dry-run', '--json']);
      expect(dry.code).toBe(0);
      expect(JSON.parse(await readFile(details, 'utf8'))).toEqual(JSON.parse(dry.out));
      const summary = JSON.parse(dry.out) as {
        counts: Record<string, number>;
        impact: { relationsTasks: { queued: { count: number }; pairs: number } };
      };
      expect(JSON.parse(r.stdout)).toMatchObject({
        project,
        credential: 'owner-key',
        batches: 1,
        counts: { ...summary.counts, skipped: 0 },
        agentWork: {
          relations: {
            queued: summary.impact.relationsTasks.queued.count,
            pairs: summary.impact.relationsTasks.pairs,
          },
        },
        details,
      });
      expect(await seqOf(project)).toBe(seq);
      expect((await analyzr(['models', 'list', '-p', project, '--json'])).out).toBe(models);
    },
  );

  it('feeds external-ids into normalize-bpmn plan --from-analyzr: the key map and rule of the manifest', async () => {
    const reports = path.join(ws(), 'reports');
    const ids = path.join(reports, 'm6-s2a.external-ids.json');
    const models = path.join(reports, 'm6-s2a.models.json');
    const common = ['-p', 'm6-s2a', '--url', server.url];
    expect(
      (await plugin('analyzr-read.mjs', ['external-ids', ...common, '--json-out', ids])).code,
    ).toBe(0);
    expect(
      (await plugin('analyzr-read.mjs', ['models', ...common, '--json-out', models])).code,
    ).toBe(0);
    expect(JSON.parse(await readFile(ids, 'utf8'))).toEqual(
      JSON.parse((await analyzr(['models', 'external-ids', '-p', 'm6-s2a', '--json'])).out),
    );
    const plan = await plugin('normalize-bpmn.mjs', [
      'plan',
      path.join(REPO_ROOT, 'tools/integrate/test/fixtures/signavio/2026-10-14-signavio'),
      '--workspace',
      ws(),
      '--system',
      'signavio',
      '--whole-system',
      '--existing',
      models,
      '--from-analyzr',
      ids,
    ]);
    expect(plan.code).toBe(0);
    // The test above moved "Versand" to versand/versand without a tool folder: one tool id on
    // two keys, the older keeps it; the newer has no folder to be identified by.
    const versand = (
      JSON.parse(await readFile(ids, 'utf8')) as {
        items: { key: string; externalId: string | null }[];
      }
    ).items.find((i) => i.key === 'logistik/versand');
    expect(JSON.parse(plan.stdout)).toMatchObject({
      firstImport: false,
      rebuilt: {
        restored: true,
        entries: 6,
        rule: { strip: 'Gemeinsame Dokumente', prefix: null },
        ruleFits: { matching: 6, of: 6 },
        duplicates: {
          count: 1,
          items: [
            {
              externalId: versand?.externalId,
              keys: ['logistik/versand', 'versand/versand'],
              kept: 'logistik/versand',
              keptBy: 'oldest',
            },
          ],
        },
        skipped: { count: 1, items: [{ key: 'versand/versand', externalId: null }] },
        conflicts: { count: 0 },
      },
      counts: { models: 6, known: 6, new: 0, moved: 0 },
      written: null,
    });
  });

  // M6 S2b follow-up step 5 (owner decision 29 (1)), on a project of its own (the tests above
  // read m6-s2a's folders): the same bytes re-exported from moved folders record the new ones.
  it('records the moved folders of a re-export with unchanged bytes, which external-ids then gives', async () => {
    const manifest = JSON.parse(
      await readFile(path.join(bundle, 'analyzr-import.json'), 'utf8'),
    ) as { source: Record<string, unknown>; files: { path: string; externalPath: string }[] };
    const created = await analyzr(['import', bundle, '-p', 'm6-s2b5', '--create']);
    expect(created.code).toBe(0);
    expect(created.out).toContain('keys pinned, provenance stored for 6\n');
    // the customer moved every model below „Verschoben“ and exported again: the same bytes
    const moved = path.join(dir, 'm6-s2b5-moved');
    for (const f of manifest.files) {
      await mkdir(path.dirname(path.join(moved, f.path)), { recursive: true });
      await writeFile(path.join(moved, f.path), await readFile(path.join(bundle, f.path)));
    }
    await writeFile(
      path.join(moved, 'analyzr-import.json'),
      JSON.stringify({
        ...manifest,
        source: { ...manifest.source, systemVersion: '19.7.0', exportedAt: '2026-11-02T00:00:00Z' },
        files: manifest.files.map((f) => ({ ...f, externalPath: `Verschoben/${f.externalPath}` })),
      }),
    );
    const line =
      "manifest: analyzr-import.json (signavio), 6 of 6 files listed: keys pinned, provenance stored for 0; 6 unchanged keep their first revision's, 6 of them record a new tool id, folder or link\n";
    const seq = await seqOf('m6-s2b5');
    const dry = await analyzr(['import', moved, '-p', 'm6-s2b5', '--dry-run']);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain(line);
    expect(dry.out).toContain('m6-s2b5: dry run, nothing imported; the import would\n');
    expect(await seqOf('m6-s2b5')).toBe(seq);

    const r = await analyzr(['import', moved, '-p', 'm6-s2b5']);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toContain(line);
    expect(r.out).toContain('m6-s2b5: 6 files, 0 created, 0 revised, 6 unchanged, 0 failed\n');
    expect(r.out).not.toContain('import warning');
    // one event per recorded identity, nothing else
    expect(await seqOf('m6-s2b5')).toBe((seq ?? 0) + 6);
    const folders = manifest.files.map((f) => `Verschoben/${f.externalPath}`);
    const ids = await analyzr(['models', 'external-ids', '-p', 'm6-s2b5', '--json']);
    expect(
      (JSON.parse(ids.out) as { items: { externalPath: string | null }[] }).items.map(
        (i) => i.externalPath,
      ),
    ).toEqual(folders);
    // … and so does the integrate skill's read, which rebuilds the key map from it
    const out = path.join(ws(), 'reports', 'm6-s2b5.external-ids.json');
    expect(
      (
        await plugin('analyzr-read.mjs', [
          'external-ids',
          '-p',
          'm6-s2b5',
          '--url',
          server.url,
          '--json-out',
          out,
        ])
      ).code,
    ).toBe(0);
    expect(JSON.parse(await readFile(out, 'utf8'))).toEqual(JSON.parse(ids.out));
    // the same declaration again records nothing
    const again = await analyzr(['import', moved, '-p', 'm6-s2b5']);
    expect(again.out).toContain(
      'keys pinned, provenance stored for 0; 6 unchanged keep what analyzr had\n',
    );
    expect(await seqOf('m6-s2b5')).toBe((seq ?? 0) + 6);
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

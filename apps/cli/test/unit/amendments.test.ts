/**
 * `analyzr amendments list|export|withdraw` and `analyzr models pull`
 * against a fake REST API (M6 S5c-2, §4.8 c): the list with its filters
 * (any credential), the change list verbatim (the CSV's byte order mark
 * kept) with `--since` and the event to pass next time, withdrawals of one
 * amendment or of every live one of a model (the owner key only; a deleted
 * model by its amendments), and the head or the uploaded bytes verbatim.
 */
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import type {
  Model,
  ModelAmendment,
  ModelAmendmentList,
  Revision,
  WithdrawAmendmentsResult,
} from '@analyzr/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

const KEY = 'vertrieb/auftrag';
const MODEL_ID = 'mdl_01JC0000000000000000000001';
const REV4 = 'rev_01JC0000000000000000000004';
const REV5 = 'rev_01JC0000000000000000000005';
const REV6 = 'rev_01JC0000000000000000000006';
const MAM1 = 'mam_01JC0000000000000000000001';
const MAM2 = 'mam_01JC0000000000000000000002';
const AT = '2026-10-17T10:00:00.000Z';

const LIST = 'GET /api/v1/projects/p/amendments';
const EXPORT = 'GET /api/v1/projects/p/amendments/export';
const WITHDRAW_ONE = `POST /api/v1/projects/p/amendments/${MAM1}/withdrawal`;
const WITHDRAW_MODEL = `POST /api/v1/projects/p/models/${MODEL_ID}/amendments/withdrawal`;
const MODELS = 'GET /api/v1/projects/p/models';
const REVISIONS = `GET /api/v1/projects/p/models/${MODEL_ID}/revisions`;
const CONTENT = (rev: string) =>
  `GET /api/v1/projects/p/models/${MODEL_ID}/revisions/${rev}/content`;

function amendment(extra: Partial<ModelAmendment> = {}): ModelAmendment {
  return {
    id: MAM1,
    modelId: MODEL_ID,
    modelKey: KEY,
    elementId: 'Call_Rechnung',
    viaElementId: null,
    op: 'call-target',
    before: '',
    after: 'Process_Rechnung',
    baseRevisionId: REV4,
    supersedesId: null,
    by: 'owner',
    sourceKind: 'human',
    seq: 20,
    at: AT,
    state: 'applied',
    conflict: null,
    modelDeleted: false,
    withdrawal: null,
    ...extra,
  };
}

const NAME = amendment({
  id: MAM2,
  elementId: 'Message_Zahlung',
  viaElementId: 'Task_Zahlung',
  op: 'message-name',
  before: 'Zahlung eingegangen',
  after: 'Zahlung erhalten',
  seq: 22,
  state: 'conflict',
  conflict: 'value-changed',
});

function model(extra: Partial<Model> = {}): Model {
  return {
    id: MODEL_ID,
    projectId: 'prj_01JC0000000000000000000001',
    key: KEY,
    name: null,
    headRevisionId: REV5,
    headRev: 5,
    engine: 'c7',
    stage: 'waiting_for_agent',
    openItems: 0,
    source: null,
    trust: null,
    updatedAt: AT,
    ...extra,
  };
}

function revision(extra: Partial<Revision> = {}): Revision {
  return {
    id: REV5,
    modelId: MODEL_ID,
    rev: 5,
    contentHash: 'a'.repeat(64),
    factsHash: 'b'.repeat(64),
    factsVersion: '1',
    engine: 'c7',
    source: {
      kind: 'amendment',
      uploader: 'human',
      upstream: { revisionId: REV4, rev: 4, contentHash: 'c'.repeat(64) },
      amendments: [{ id: MAM1, elementId: 'Call_Rechnung', op: 'call-target', outcome: 'applied' }],
    },
    seq: 30,
    createdAt: AT,
    ...extra,
  };
}

describe('analyzr amendments list', () => {
  it('lists the amendments with their state and values; the filters go to the server', async () => {
    const queries: string[] = [];
    const body: ModelAmendmentList = { items: [amendment(), NAME], seq: 41 };
    const a = fakeApi({
      [LIST]: (_req, url) => {
        queries.push(url.search);
        return json(body);
      },
    });
    const t = testIo({ ANALYZR_TOKEN: AGENT_TOKEN }, a.fetch, { cwd: dir });
    expect(await runCli(['amendments', 'list', '-p', 'p', '--model', 'vertrieb'], t.io)).toBe(0);
    expect(queries).toEqual(['?modelKey=vertrieb']);
    expect(a.seen[0]?.authorization).toBe(`Bearer ${AGENT_TOKEN}`);
    expect(t.out()).toBe(
      [
        '  id                              model             element                            op            state                     before → after',
        `  ${MAM1}  ${KEY}  Call_Rechnung                      call-target   applied                   (none) → „Process_Rechnung“`,
        `  ${MAM2}  ${KEY}  Message_Zahlung (at Task_Zahlung)  message-name  conflict (value-changed)  „Zahlung eingegangen“ → „Zahlung erhalten“`,
        'p (model vertrieb): 2 amendments (applied 1, conflict 1), as of event 41',
        '',
      ].join('\n'),
    );
  });

  it('says when there are none, prints --json, and refuses bad filters before any request', async () => {
    const empty = owner(fakeApi({ [LIST]: () => json({ items: [], seq: 3 }) }).fetch);
    expect(await runCli(['amendments', 'list', '-p', 'p', '--state', 'conflict'], empty.io)).toBe(
      0,
    );
    expect(empty.out()).toBe('no amendments in p (state conflict), as of event 3\n');

    const body: ModelAmendmentList = { items: [amendment()], seq: 41 };
    const j = owner(fakeApi({ [LIST]: () => json(body) }).fetch);
    expect(await runCli(['amendments', 'list', '-p', 'p', '--json'], j.io)).toBe(0);
    expect(JSON.parse(j.out())).toEqual(body);

    const none = fakeApi({});
    for (const [args, message] of [
      [
        ['--state', 'live'],
        'unknown state "live"; one of applied, in-source, conflict, withdrawn, superseded',
      ],
      [['--model', 'Vertrieb'], 'not a model key or folder: "Vertrieb"'],
    ] as const) {
      const t = owner(none.fetch);
      expect(await runCli(['amendments', 'list', '-p', 'p', ...args], t.io)).toBe(1);
      expect(t.err()).toContain(message);
    }
    expect(none.seen).toHaveLength(0);
  });
});

describe('analyzr amendments export', () => {
  const csv = '﻿"Modell";"Modellschlüssel"\r\n"Auftrag";"vertrieb/auftrag"\r\n';

  function exportApi(queries: string[]) {
    return fakeApi({
      [LIST]: () => json({ items: [], seq: 57 }),
      [EXPORT]: (_req, url) => {
        queries.push(url.search);
        const format = url.searchParams.get('format');
        return new Response(format === 'csv' ? csv : '# Änderungsliste: P\n', {
          status: 200,
          headers: {
            'content-type':
              format === 'csv' ? 'text/csv; charset=utf-8' : 'text/markdown; charset=utf-8',
          },
        });
      },
    });
  }

  it('writes the Markdown to stdout and the event for the next --since to stderr', async () => {
    const queries: string[] = [];
    const t = owner(exportApi(queries).fetch);
    expect(await runCli(['amendments', 'export', '-p', 'p', '--since', '12'], t.io)).toBe(0);
    expect(queries).toEqual(['?format=markdown&since=12']);
    expect(t.out()).toBe('# Änderungsliste: P\n');
    expect(t.err()).toBe('as of event 57: export with --since 57 next time for what is new\n');
  });

  it('writes the CSV verbatim to a file, its byte order mark kept', async () => {
    const queries: string[] = [];
    const t = owner(exportApi(queries).fetch);
    expect(
      await runCli(
        [
          'amendments',
          'export',
          '-p',
          'p',
          '--format',
          'csv',
          '--state',
          'applied',
          '-o',
          'liste.csv',
        ],
        t.io,
      ),
    ).toBe(0);
    expect(queries).toEqual(['?state=applied&format=csv']);
    const bytes = await readFile(path.join(dir, 'liste.csv'));
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(bytes.toString('utf8')).toBe(csv);
    expect(t.out()).toBe(
      'wrote the change list of p (state applied) to liste.csv; as of event 57: export with --since 57 next time for what is new\n',
    );
  });

  it('refuses a bad format or --since before any request', async () => {
    const none = fakeApi({});
    for (const [args, message] of [
      [['--format', 'pdf'], 'unknown format "pdf"; one of md (the default), csv'],
      [['--since', '-1'], '--since takes an event number such as 1234'],
    ] as const) {
      const t = owner(none.fetch);
      expect(await runCli(['amendments', 'export', '-p', 'p', ...args], t.io)).toBe(1);
      expect(t.err()).toContain(message);
    }
    expect(none.seen).toHaveLength(0);
  });
});

describe('analyzr amendments withdraw', () => {
  const withdrawn = amendment({
    state: 'withdrawn',
    withdrawal: { reason: 'withdrawn', by: 'owner', seq: 44, at: AT },
  });
  const rederived = revision({
    id: REV6,
    rev: 6,
    source: {
      kind: 'amendment',
      uploader: 'human',
      upstream: { revisionId: REV4, rev: 4, contentHash: 'c'.repeat(64) },
      amendments: [],
    },
  });

  it('withdraws one amendment and names the re-derived head', async () => {
    const result: WithdrawAmendmentsResult = {
      result: 'withdrawn',
      amendments: [withdrawn],
      model: model({ headRev: 6, headRevisionId: REV6 }),
      revision: rederived,
    };
    const a = fakeApi({ [WITHDRAW_ONE]: () => json(result, 201) });
    const t = owner(a.fetch);
    expect(await runCli(['amendments', 'withdraw', MAM1, '-p', 'p'], t.io)).toBe(0);
    expect(a.seen.map((s) => `${s.method} ${s.path}`)).toEqual([WITHDRAW_ONE]);
    expect(a.seen[0]?.authorization).toBe(`Bearer ${OWNER_KEY}`);
    expect(t.out()).toBe(
      [
        `p: withdrew 1 amendment of ${KEY}; new head r6, re-derived from the uploaded r4 (no amendment applies: the uploaded bytes)`,
        `  ${MAM1}  call-target  Call_Rechnung  (none) → „Process_Rechnung“  withdrawn`,
        '',
      ].join('\n'),
    );

    const ended: WithdrawAmendmentsResult = {
      result: 'unchanged',
      amendments: [amendment({ state: 'superseded' })],
      model: model(),
      revision: null,
    };
    const u = owner(fakeApi({ [WITHDRAW_ONE]: () => json(ended) }).fetch);
    expect(await runCli(['amendments', 'withdraw', MAM1, '-p', 'p'], u.io)).toBe(0);
    expect(u.out()).toBe(`p: nothing withdrawn: ${MAM1} ended before (superseded)\n`);
  });

  it('--model withdraws every live amendment of a model, found by its amendments (also deleted)', async () => {
    const queries: string[] = [];
    const result: WithdrawAmendmentsResult = {
      result: 'withdrawn',
      amendments: [
        { ...withdrawn, modelDeleted: true },
        { ...NAME, state: 'withdrawn', conflict: null, modelDeleted: true },
      ],
      model: null,
      revision: null,
    };
    const a = fakeApi({
      [LIST]: (_req, url) => {
        queries.push(url.search);
        return json({
          items: [
            amendment({ modelKey: `${KEY}/alt`, modelId: 'mdl_01JC0000000000000000000009' }),
            amendment(),
          ],
          seq: 50,
        });
      },
      [WITHDRAW_MODEL]: () => json(result, 201),
    });
    const t = owner(a.fetch);
    expect(await runCli(['amendments', 'withdraw', '--model', KEY, '-p', 'p'], t.io)).toBe(0);
    expect(queries).toEqual([`?modelKey=${encodeURIComponent(KEY)}`]);
    expect(a.seen.map((s) => `${s.method} ${s.path}`)).toEqual([LIST, WITHDRAW_MODEL]);
    expect(t.out()).toBe(
      [
        `p: withdrew 2 amendments of ${KEY}; the model is deleted, so no revision was written`,
        `  ${MAM1}  call-target  Call_Rechnung  (none) → „Process_Rechnung“  withdrawn, model deleted`,
        `  ${MAM2}  message-name  Message_Zahlung (at Task_Zahlung)  „Zahlung eingegangen“ → „Zahlung erhalten“  withdrawn, model deleted`,
        '',
      ].join('\n'),
    );

    const nothing = owner(
      fakeApi({
        [LIST]: () => json({ items: [amendment({ state: 'withdrawn' })], seq: 50 }),
        [WITHDRAW_MODEL]: () =>
          json({ result: 'unchanged', amendments: [], model: model(), revision: null }),
      }).fetch,
    );
    expect(await runCli(['amendments', 'withdraw', '--model', KEY, '-p', 'p'], nothing.io)).toBe(0);
    expect(nothing.out()).toBe(`p: nothing withdrawn: ${KEY} has no live amendment\n`);

    const unknown = owner(fakeApi({ [LIST]: () => json({ items: [], seq: 50 }) }).fetch);
    expect(
      await runCli(['amendments', 'withdraw', '--model', 'lager/x', '-p', 'p'], unknown.io),
    ).toBe(1);
    expect(unknown.err()).toBe(
      'analyzr: lager/x has no amendments in p (analyzr amendments list -p p lists them)\n',
    );
  });

  it('--rev sends If-Match, so an amendment recorded since is not withdrawn unseen', async () => {
    const preconditions: (string | null)[] = [];
    const a = fakeApi({
      [WITHDRAW_ONE]: (req) => {
        preconditions.push(req.headers.get('if-match'));
        return problem(412, 'revision-conflict', 'the model is at r7; load its amendments again');
      },
    });
    const t = owner(a.fetch);
    expect(await runCli(['amendments', 'withdraw', MAM1, '-p', 'p', '--rev', 'r6'], t.io)).toBe(1);
    expect(preconditions).toEqual(['"r6"']);
    expect(t.err()).toContain('the model is at r7');
    const bad = owner(fakeApi({}).fetch);
    expect(await runCli(['amendments', 'withdraw', MAM1, '-p', 'p', '--rev', 'neu'], bad.io)).toBe(
      1,
    );
    expect(bad.err()).toContain('not a revision: "neu"');
  });

  it('refuses an agent token and bad arguments before any request', async () => {
    const none = fakeApi({});
    const agent = testIo({ ANALYZR_TOKEN: AGENT_TOKEN }, none.fetch, { cwd: dir });
    expect(await runCli(['amendments', 'withdraw', MAM1, '-p', 'p'], agent.io)).toBe(1);
    expect(agent.err()).toBe(
      'analyzr: only humans withdraw amendments: analyzr amendments withdraw uses the owner key (drop --token and unset ANALYZR_TOKEN)\n',
    );
    for (const [args, message] of [
      [[], 'give the amendment to withdraw (mam_…'],
      [[MAM1, '--model', KEY], 'give the amendment to withdraw (mam_…'],
      [['mam_1'], 'not an amendment id: "mam_1"'],
      [['--model', 'Vertrieb'], 'not a model key: "Vertrieb"'],
    ] as const) {
      const t = owner(none.fetch);
      expect(
        await runCli(['amendments', 'withdraw', '-p', 'p', ...args], t.io),
        args.join(' '),
      ).toBe(1);
      expect(t.err(), args.join(' ')).toContain(message);
    }
    expect(none.seen).toHaveLength(0);
  });

  it('--json prints the result', async () => {
    const result: WithdrawAmendmentsResult = {
      result: 'withdrawn',
      amendments: [withdrawn],
      model: model({ headRev: 6 }),
      revision: rederived,
    };
    const t = owner(fakeApi({ [WITHDRAW_ONE]: () => json(result, 201) }).fetch);
    expect(await runCli(['amendments', 'withdraw', MAM1, '-p', 'p', '--json'], t.io)).toBe(0);
    expect(JSON.parse(t.out())).toEqual(result);
  });
});

describe('analyzr models pull', () => {
  const amended =
    '﻿<?xml version="1.0"?>\r\n<bpmn:definitions calledElement="Process_Rechnung"/>\r\n';
  const uploaded = '﻿<?xml version="1.0"?>\r\n<bpmn:definitions/>\r\n';

  function pullApi(head: Revision, fetched: string[]) {
    return fakeApi({
      [MODELS]: () =>
        json({ items: [model({ headRevisionId: head.id, headRev: head.rev })], nextCursor: null }),
      // Newest first, in pages of one: the head turns up on the second page.
      [REVISIONS]: (_req, url) =>
        url.searchParams.get('cursor') === null
          ? json({ items: [revision({ id: REV6, rev: 6 })], nextCursor: 'next' })
          : json({ items: [head], nextCursor: null }),
      [CONTENT(REV5)]: () => {
        fetched.push(REV5);
        return new Response(amended, { headers: { 'content-type': 'application/xml' } });
      },
      [CONTENT(REV4)]: () => {
        fetched.push(REV4);
        return new Response(uploaded, { headers: { 'content-type': 'application/xml' } });
      },
    });
  }

  const sha = (text: string) =>
    import('node:crypto').then((c) => c.createHash('sha256').update(text, 'utf8').digest('hex'));

  it('writes the amended head verbatim to stdout, r<rev> and its hash on stderr', async () => {
    const fetched: string[] = [];
    const t = testIo({ ANALYZR_TOKEN: AGENT_TOKEN }, pullApi(revision(), fetched).fetch, {
      cwd: dir,
    });
    expect(await runCli(['models', 'pull', KEY, '-p', 'p'], t.io)).toBe(0);
    expect(fetched).toEqual([REV5]);
    expect(t.out()).toBe(amended);
    expect(t.err()).toBe(`r5 ${await sha(amended)} (the head, amended from the uploaded r4)\n`);
  });

  it('--original writes the uploaded revision to a file, byte for byte', async () => {
    const fetched: string[] = [];
    const t = owner(pullApi(revision(), fetched).fetch);
    expect(
      await runCli(['models', 'pull', KEY, '-p', 'p', '--original', '-o', 'original.bpmn'], t.io),
    ).toBe(0);
    expect(fetched).toEqual([REV4]);
    expect((await readFile(path.join(dir, 'original.bpmn'))).toString('utf8')).toBe(uploaded);
    expect(t.out()).toBe('');
    expect(t.err()).toBe(`r4 ${await sha(uploaded)} (uploaded; the head r5 is amended from it)\n`);
  });

  it('an uploaded head is both; an unknown key is refused', async () => {
    const fetched: string[] = [];
    const head = revision({ id: REV5, source: { kind: 'import', path: 'vertrieb/auftrag.bpmn' } });
    const t = owner(pullApi(head, fetched).fetch);
    expect(await runCli(['models', 'pull', KEY, '-p', 'p', '--original'], t.io)).toBe(0);
    expect(fetched).toEqual([REV5]);
    expect(t.err()).toBe(`r5 ${await sha(amended)} (uploaded, the head)\n`);

    const unknown = owner(pullApi(head, []).fetch);
    expect(await runCli(['models', 'pull', 'lager/x', '-p', 'p'], unknown.io)).toBe(1);
    expect(unknown.err()).toBe('analyzr: no live model lager/x in p\n');
    const bad = owner(fakeApi({}).fetch);
    expect(await runCli(['models', 'pull', 'Lager', '-p', 'p'], bad.io)).toBe(1);
    expect(bad.err()).toContain('not a model key: "Lager"');
  });
});

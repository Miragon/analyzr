/**
 * `analyzr models amend` and `analyzr questions amend` against a fake REST
 * API (M6 S5c-2, §4.8 c): the owner key only (an agent token is refused
 * before any request), every flag checked before any request, the element's
 * fields read first (their ETag sent as `If-Match` on the dry run and the
 * save), a call target by name resolved through the landscape, the dry run
 * before every save (stopping with `--dry-run`, for an item that is not
 * applicable, when nothing changes and for a claimed relations task without
 * `--yes`), the live amendment a new value replaces, the save problems
 * (412, 422 with the items, 409), and an item's `amend` action with its
 * targets, `replaces` and prefilled value.
 */
import { rm } from 'node:fs/promises';

import type {
  AmendModelResult,
  AmendableElement,
  AmendableField,
  Landscape,
  Model,
  ModelAmendment,
  OpenQuestion,
  Revision,
} from '@analyzr/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { costLines, effectLines, parseValue, shownValue } from '../../src/commands/amend.ts';
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
const REV3 = 'rev_01JC0000000000000000000003';
const REV4 = 'rev_01JC0000000000000000000004';
const REV5 = 'rev_01JC0000000000000000000005';
const MAM1 = 'mam_01JC0000000000000000000001';
const MAM2 = 'mam_01JC0000000000000000000002';
const CALL = `${KEY}#Call_Rechnung`;
const RECHNUNG = 'finanzen/rechnung#Process_Rechnung';
const AT = '2026-10-17T10:00:00.000Z';
const Q1 = 'q-00000000000000a1';

const MODELS = 'GET /api/v1/projects/p/models';
const LANDSCAPE = 'GET /api/v1/projects/p/landscape';
const LIST = 'GET /api/v1/projects/p/open-questions';
const AMENDABLE = (element: string) =>
  `GET /api/v1/projects/p/models/${MODEL_ID}/elements/${element}/amendable`;
const AMEND = `POST /api/v1/projects/p/models/${MODEL_ID}/amendments`;

function model(extra: Partial<Model> = {}): Model {
  return {
    id: MODEL_ID,
    projectId: 'prj_01JC0000000000000000000001',
    key: KEY,
    name: 'Auftragsabwicklung',
    headRevisionId: REV3,
    headRev: 3,
    engine: 'c7',
    stage: 'waiting_for_agent',
    openItems: 0,
    source: null,
    identity: null,
    trust: null,
    updatedAt: AT,
    ...extra,
  };
}

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

function field(extra: Partial<AmendableField> = {}): AmendableField {
  return {
    op: 'call-target',
    elementId: 'Call_Rechnung',
    viaElementId: null,
    element: 'call',
    typeLabel: 'Aufrufaktivität',
    fieldLabel: 'Aufrufziel',
    value: '',
    uploadedValue: '',
    settable: true,
    reason: null,
    live: null,
    readers: [],
    suggestions: { processes: [] },
    ...extra,
  };
}

function amendable(extra: Partial<AmendableElement> = {}): AmendableElement {
  return {
    modelId: MODEL_ID,
    modelKey: KEY,
    elementId: 'Call_Rechnung',
    headRevisionId: REV3,
    headRev: 3,
    uploadedRevisionId: REV3,
    fields: [field()],
    history: [],
    ...extra,
  };
}

const REVISION: Revision = {
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
};

const EFFECT: AmendModelResult['effect'] = {
  findingsResolved: [{ kind: 'unresolved-call', refs: [CALL], detail: 'Aufruf ohne Key' }],
  findingsAdded: [],
  accepted: [{ relation: null, type: 'call', from: CALL, to: RECHNUNG }],
  proposed: [],
  withdrawn: [],
  partnerAccepted: [],
  changed: [],
  retired: [],
};

function result(extra: Partial<AmendModelResult> = {}): AmendModelResult {
  return {
    dryRun: true,
    outcome: 'recorded',
    items: [
      {
        elementId: 'Call_Rechnung',
        op: 'call-target',
        outcome: 'recorded',
        amendmentElementId: 'Call_Rechnung',
        after: 'Process_Rechnung',
        before: '',
      },
    ],
    model: model(),
    revision: null,
    effect: EFFECT,
    cost: { factsChange: true, pairsToRejudge: 2, taskClaimed: false },
    ...extra,
  };
}

/** The saved result: the amendment recorded, the new head r5. */
function saved(extra: Partial<AmendModelResult> = {}): AmendModelResult {
  const [item] = result().items;
  return result({
    dryRun: false,
    items: item ? [{ ...item, amendment: amendment() }] : [],
    model: model({ headRev: 5, headRevisionId: REV5 }),
    revision: REVISION,
    ...extra,
  });
}

const LANDSCAPE_BODY: Landscape = {
  projectId: 'prj_01JC0000000000000000000001',
  seq: 9,
  models: [
    {
      id: 'mdl_01JC0000000000000000000002',
      key: 'finanzen/rechnung',
      name: null,
      stage: 'waiting_for_agent',
      processes: [
        {
          ref: RECHNUNG,
          processId: 'Process_Rechnung',
          name: 'Rechnungsstellung',
          participantName: null,
          isExecutable: true,
        },
      ],
    },
  ],
  relations: [],
  findings: [],
};

interface Posted {
  dryRun: boolean;
  ifMatch: string | null;
  body: unknown;
}

/** A fake API: the models, the landscape, the element's fields (ETag `"r3"`) and the amendments route. */
function api(
  answer: (dryRun: boolean, body: Record<string, unknown>) => Response,
  opts: { element?: AmendableElement; posted?: Posted[]; items?: OpenQuestion[] } = {},
) {
  const element = opts.element ?? amendable();
  return fakeApi({
    [MODELS]: () => json({ items: [model()], nextCursor: null }),
    [LANDSCAPE]: () => json(LANDSCAPE_BODY),
    [LIST]: () => json({ items: opts.items ?? [], nextCursor: null }),
    [AMENDABLE(element.elementId)]: () =>
      new Response(JSON.stringify(element), {
        status: 200,
        headers: { 'content-type': 'application/json', etag: '"r3"' },
      }),
    [AMEND]: async (req, url) => {
      const dryRun = url.searchParams.get('dryRun') === 'true';
      const body = (await req.json()) as Record<string, unknown>;
      opts.posted?.push({ dryRun, ifMatch: req.headers.get('if-match'), body });
      return answer(dryRun, body);
    },
  });
}

const routes = (seen: { method: string; path: string }[]) =>
  seen.map((s) => `${s.method} ${s.path}`);

describe('analyzr models amend', () => {
  it('reads the field, dry-runs on its ETag, saves with the same If-Match and prints the new head', async () => {
    const posted: Posted[] = [];
    const a = api((dry) => (dry ? json(result()) : json(saved(), 201)), { posted });
    const t = owner(a.fetch);
    const argv = ['models', 'amend', KEY, '-p', 'p', '--element', 'Call_Rechnung'];
    expect(await runCli([...argv, '--call-target', 'Rechnungsstellung'], t.io)).toBe(0);
    expect(routes(a.seen)).toEqual([MODELS, AMENDABLE('Call_Rechnung'), LANDSCAPE, AMEND, AMEND]);
    expect(a.seen.every((s) => s.authorization === `Bearer ${OWNER_KEY}`)).toBe(true);
    const item = { elementId: 'Call_Rechnung', op: 'call-target', target: RECHNUNG };
    expect(posted).toEqual([
      { dryRun: true, ifMatch: '"r3"', body: { items: [item] } },
      { dryRun: false, ifMatch: '"r3"', body: { items: [item] } },
    ]);
    expect(t.err()).toBe('');
    expect(t.out()).toBe(
      [
        `p: amended ${KEY}: new head r5, computed from the uploaded r4`,
        `  recorded  call target of Call_Rechnung: (none) → „Process_Rechnung“ (${MAM1})`,
        '  effect at the element:',
        `    finding resolved: unresolved-call ${CALL}`,
        `    accepted by the rule tier: call ${CALL} → ${RECHNUNG}`,
        "  cost: 2 pairs judged again; the model's relations task is queued",
        `  withdraw it with: analyzr amendments withdraw ${MAM1} -p p`,
        '',
      ].join('\n'),
    );
  });

  it('sends a ref without reading the landscape; --json prints the saved result', async () => {
    const posted: Posted[] = [];
    const a = api((dry) => (dry ? json(result()) : json(saved(), 201)), { posted });
    const t = owner(a.fetch);
    expect(
      await runCli(
        [
          'models',
          'amend',
          KEY,
          '-p',
          'p',
          '--element',
          'Call_Rechnung',
          '--call-target',
          RECHNUNG,
          '--json',
        ],
        t.io,
      ),
    ).toBe(0);
    expect(routes(a.seen)).not.toContain(LANDSCAPE);
    expect(JSON.parse(t.out())).toEqual(saved());
  });

  it('--dry-run prints the effect and the cost and saves nothing', async () => {
    const posted: Posted[] = [];
    const a = api(() => json(result()), { posted });
    const t = owner(a.fetch);
    expect(
      await runCli(
        [
          'models',
          'amend',
          KEY,
          '-p',
          'p',
          '--element',
          'Call_Rechnung',
          '--call-target',
          RECHNUNG,
          '--dry-run',
        ],
        t.io,
      ),
    ).toBe(0);
    expect(posted.map((p) => p.dryRun)).toEqual([true]);
    expect(t.out()).toBe(
      [
        `p: ${KEY} (r3): dry run, nothing recorded yet`,
        '  would record  call target of Call_Rechnung: (none) → „Process_Rechnung“',
        '  effect at the element:',
        `    finding resolved: unresolved-call ${CALL}`,
        `    accepted by the rule tier: call ${CALL} → ${RECHNUNG}`,
        "  cost: 2 pairs judged again; the model's relations task is queued",
        '',
      ].join('\n'),
    );
  });

  it('stops on an item that is not applicable (exit 1) and when nothing changes (exit 0)', async () => {
    const refused = result({
      outcome: 'unchanged',
      items: [
        {
          elementId: 'Call_Rechnung',
          op: 'call-target',
          outcome: 'not-applicable',
          reason: 'same-process',
          message: "the target is the caller's own process",
          amendmentElementId: 'Call_Rechnung',
          before: '',
        },
      ],
    });
    const posted: Posted[] = [];
    const n = owner(api(() => json(refused), { posted }).fetch);
    const argv = ['models', 'amend', KEY, '-p', 'p', '--element', 'Call_Rechnung'];
    expect(await runCli([...argv, '--call-target', RECHNUNG], n.io)).toBe(1);
    expect(posted).toHaveLength(1);
    expect(n.out()).toBe(
      [
        `p: ${KEY} (r3): not applicable, nothing recorded`,
        "  not applicable  call target of Call_Rechnung: same-process (the target is the caller's own process)",
        '',
      ].join('\n'),
    );
    expect(n.err()).toBe('analyzr: the amendment is not applicable; nothing recorded\n');

    const unchanged = result({
      outcome: 'unchanged',
      items: [
        {
          elementId: 'Call_Rechnung',
          op: 'call-target',
          outcome: 'unchanged',
          amendmentElementId: 'Call_Rechnung',
          after: 'Process_Rechnung',
          before: '',
          amendment: amendment(),
        },
      ],
      cost: { factsChange: false, pairsToRejudge: 0, taskClaimed: false },
    });
    const same: Posted[] = [];
    const u = owner(api(() => json(unchanged), { posted: same }).fetch);
    expect(await runCli([...argv, '--call-target', RECHNUNG], u.io)).toBe(0);
    expect(same).toHaveLength(1);
    expect(u.out()).toBe(
      [
        `p: ${KEY} (r3) unchanged: nothing to record`,
        `  unchanged  call target of Call_Rechnung: „Process_Rechnung“ is set by its live amendment ${MAM1} already`,
        '',
      ].join('\n'),
    );
  });

  it('a claimed relations task needs --yes', async () => {
    const claimed = result({ cost: { factsChange: true, pairsToRejudge: 214, taskClaimed: true } });
    const argv = [
      'models',
      'amend',
      KEY,
      '-p',
      'p',
      '--element',
      'Call_Rechnung',
      '--call-target',
      RECHNUNG,
    ];
    const posted: Posted[] = [];
    const t = owner(api(() => json(claimed), { posted }).fetch);
    expect(await runCli(argv, t.io)).toBe(1);
    expect(posted.map((p) => p.dryRun)).toEqual([true]);
    expect(t.out()).toContain(
      "  cost: 214 pairs judged again; the model's relations task is queued\n  warning: an agent is working on this model's relations task right now; the new head cancels the task and the agent's work is lost\n",
    );
    expect(t.err()).toBe(
      `analyzr: an agent holds the relations task of ${KEY}; saving cancels it and the agent's work is lost: run again with --yes to save anyway\n`,
    );

    const yes: Posted[] = [];
    const y = owner(
      api((dry) => (dry ? json(claimed) : json(saved({ cost: claimed.cost }), 201)), {
        posted: yes,
      }).fetch,
    );
    expect(await runCli([...argv, '--yes'], y.io)).toBe(0);
    expect(yes.map((p) => p.dryRun)).toEqual([true, false]);
    expect(y.out()).toContain(`p: amended ${KEY}: new head r5`);
  });

  it('explains a head that moved (412), a refusal at the save (422) and a stale replaces (409)', async () => {
    const argv = [
      'models',
      'amend',
      KEY,
      '-p',
      'p',
      '--element',
      'Call_Rechnung',
      '--call-target',
      RECHNUNG,
    ];
    const moved = owner(
      api((dry) =>
        dry
          ? json(result())
          : json(
              {
                type: 'urn:analyzr:problem:revision-conflict',
                title: 'revision-conflict',
                status: 412,
                code: 'revision-conflict',
                detail: 'the model is at r4',
                headRev: 4,
              },
              412,
            ),
      ).fetch,
    );
    expect(await runCli(argv, moved.io)).toBe(1);
    expect(moved.err()).toBe(
      `analyzr: ${KEY} changed after it was read at r3 (now r4); nothing recorded: run the command again to amend the new head\n`,
    );

    const notApplicable = owner(
      api((dry) =>
        dry
          ? json(result())
          : json(
              {
                type: 'urn:analyzr:problem:validation-failed',
                title: 'validation-failed',
                status: 422,
                code: 'validation-failed',
                detail: 'an amendment is not applicable; nothing was written',
                reason: 'amendment-not-applicable',
                items: [
                  {
                    elementId: 'Call_Rechnung',
                    op: 'call-target',
                    outcome: 'not-applicable',
                    reason: 'element-missing',
                    message: 'the amendment does not apply to the uploaded revision',
                  },
                ],
              },
              422,
            ),
      ).fetch,
    );
    expect(await runCli(argv, notApplicable.io)).toBe(1);
    expect(notApplicable.err()).toBe(
      'analyzr: the amendment is not applicable; nothing recorded:\n  not applicable  call target of Call_Rechnung: element-missing (the amendment does not apply to the uploaded revision)\n',
    );

    const stale = owner(
      api(() =>
        problem(
          409,
          'conflict',
          'the live amendment of Call_Rechnung (call-target) is not the one replaces names; load it again',
        ),
      ).fetch,
    );
    expect(await runCli(argv, stale.io)).toBe(1);
    expect(stale.err()).toContain(
      'analyzr: the live amendment of the field changed after it was read; nothing recorded: run the command again (the live amendment of Call_Rechnung',
    );
  });

  it('replaces the live amendment of the field, or the one still keyed by the endpoint asked', async () => {
    const posted: Posted[] = [];
    const live = amendable({ fields: [field({ live: amendment() })] });
    const t = owner(api(() => json(result()), { element: live, posted }).fetch);
    const argv = ['models', 'amend', KEY, '-p', 'p', '--element', 'Call_Rechnung'];
    expect(await runCli([...argv, '--call-target', RECHNUNG, '--dry-run'], t.io)).toBe(0);
    expect(posted[0]?.body).toEqual({
      items: [{ elementId: 'Call_Rechnung', op: 'call-target', target: RECHNUNG, replaces: MAM1 }],
    });

    // A name set at an endpoint without a message; the tool added Message_Zahlung since.
    const keyed = amendment({
      id: MAM2,
      op: 'message-name',
      elementId: 'Event_Zahlung',
      before: null,
      after: 'Zahlung erhalten',
      state: 'conflict',
      conflict: 'value-changed',
    });
    const message = amendable({
      elementId: 'Event_Zahlung',
      fields: [
        field({
          op: 'message-name',
          elementId: 'Message_Zahlung',
          viaElementId: 'Event_Zahlung',
          element: 'message',
          value: 'Zahlung eingegangen',
          uploadedValue: 'Zahlung eingegangen',
          readers: [`${KEY}#Event_Zahlung`, `${KEY}#Task_Mahnung`],
        }),
      ],
      history: [
        keyed,
        amendment({
          id: MAM1,
          op: 'message-name',
          elementId: 'Event_Zahlung',
          withdrawal: { reason: 'superseded', by: 'owner', seq: 19, at: AT },
        }),
      ],
    });
    const named: Posted[] = [];
    const answer = result({
      items: [
        {
          elementId: 'Event_Zahlung',
          op: 'message-name',
          outcome: 'recorded',
          amendmentElementId: 'Message_Zahlung',
          after: 'Zahlung erhalten',
          before: 'Zahlung eingegangen',
          supersedes: MAM2,
          warnings: [{ kind: 'email', start: 0, end: 7 }],
        },
      ],
      effect: { ...EFFECT, findingsResolved: [], accepted: [] },
    });
    const m = owner(api(() => json(answer), { element: message, posted: named }).fetch);
    expect(
      await runCli(
        [
          'models',
          'amend',
          KEY,
          '-p',
          'p',
          '--element',
          'Event_Zahlung',
          '--message-name',
          ' Zahlung erhalten ',
          '--dry-run',
        ],
        m.io,
      ),
    ).toBe(0);
    expect(named[0]?.body).toEqual({
      items: [
        {
          elementId: 'Event_Zahlung',
          op: 'message-name',
          after: ' Zahlung erhalten ',
          replaces: MAM2,
        },
      ],
    });
    expect(m.out()).toBe(
      [
        `p: ${KEY} (r3): dry run, nothing recorded yet`,
        `  would record  message name of Message_Zahlung (asked at Event_Zahlung): „Zahlung eingegangen“ → „Zahlung erhalten“, replacing ${MAM2}`,
        '  warning: the value probably contains an e-mail address (characters 1–7)',
        "  amendments take no names of people or other personal data: the value stays in the model's revisions and in the change list, and cannot be deleted",
        `  every element referencing Message_Zahlung reads the new name: ${KEY}#Event_Zahlung, ${KEY}#Task_Mahnung`,
        '  effect at the element: none',
        "  cost: 2 pairs judged again; the model's relations task is queued",
        '',
      ].join('\n'),
    );
  });

  it('sends --partner with a message name, and names the fields an element takes', async () => {
    const posted: Posted[] = [];
    const message = amendable({
      elementId: 'Event_Zahlung',
      fields: [field({ op: 'message-name', elementId: 'Message_Zahlung', element: 'message' })],
    });
    const partner = 'finanzen/rechnung#Event_Zahlung';
    const t = owner(api(() => json(result()), { element: message, posted }).fetch);
    expect(
      await runCli(
        [
          'models',
          'amend',
          KEY,
          '-p',
          'p',
          '--element',
          'Event_Zahlung',
          '--message-name',
          'Zahlung',
          '--partner',
          partner,
          '--dry-run',
        ],
        t.io,
      ),
    ).toBe(0);
    expect(posted[0]?.body).toEqual({
      items: [{ elementId: 'Event_Zahlung', op: 'message-name', after: 'Zahlung', partner }],
    });

    const wrong = owner(api(() => json(result()), { element: message }).fetch);
    expect(
      await runCli(
        ['models', 'amend', KEY, '-p', 'p', '--element', 'Event_Zahlung', '--name', 'Start'],
        wrong.io,
      ),
    ).toBe(1);
    expect(wrong.err()).toBe(
      `analyzr: ${KEY}#Event_Zahlung has no name; it takes --message-name (message Message_Zahlung)\n`,
    );
  });

  it('refuses an agent token and invalid flags before any request; an unknown model after the list', async () => {
    const none = fakeApi({});
    const agent = testIo({ ANALYZR_TOKEN: AGENT_TOKEN }, none.fetch, { cwd: dir });
    expect(
      await runCli(['models', 'amend', KEY, '-p', 'p', '--element', 'X', '--name', 'A'], agent.io),
    ).toBe(1);
    expect(agent.err()).toBe(
      'analyzr: only humans amend models: analyzr models amend uses the owner key (drop --token and unset ANALYZR_TOKEN)\n',
    );
    const cases: [string[], string][] = [
      [['Vertrieb', '--element', 'X', '--name', 'A'], 'not a model key: "Vertrieb"'],
      [[KEY, '--name', 'A'], 'give the element with --element <id>'],
      [[KEY, '--element', 'a b', '--name', 'A'], 'not an element id: "a b"'],
      [
        [KEY, '--element', 'X'],
        'give the value with --call-target, --message-name, --name or --documentation',
      ],
      [
        [KEY, '--element', 'X', '--name', 'A', '--documentation', 'B'],
        'give one value: --name or --documentation, not both',
      ],
      [[KEY, '--element', 'X', '--name', '  '], '--name needs a value, not an empty text'],
      [
        [KEY, '--element', 'X', '--name', 'x'.repeat(8001)],
        'the value of --name has 8001 characters; at most 8000',
      ],
      [
        [KEY, '--element', 'X', '--name', 'A', '--partner', RECHNUNG],
        '--partner goes with --message-name',
      ],
      [
        [KEY, '--element', 'X', '--message-name', 'A', '--partner', 'nope'],
        '--partner takes the ref of the partner endpoint',
      ],
    ];
    for (const [args, message] of cases) {
      const t = owner(none.fetch);
      expect(await runCli(['models', 'amend', '-p', 'p', ...args], t.io), args.join(' ')).toBe(1);
      expect(t.err(), args.join(' ')).toContain(message);
    }
    expect(none.seen).toHaveLength(0);

    const unknown = owner(api(() => json(result())).fetch);
    expect(
      await runCli(
        ['models', 'amend', 'lager/x', '-p', 'p', '--element', 'X', '--name', 'A'],
        unknown.io,
      ),
    ).toBe(1);
    expect(unknown.err()).toBe('analyzr: no live model lager/x in p\n');
  });

  it('refuses a target that names no process and sends nothing', async () => {
    const posted: Posted[] = [];
    const t = owner(api(() => json(result()), { posted }).fetch);
    expect(
      await runCli(
        [
          'models',
          'amend',
          KEY,
          '-p',
          'p',
          '--element',
          'Call_Rechnung',
          '--call-target',
          'Mahnwesen',
        ],
        t.io,
      ),
    ).toBe(1);
    expect(t.err()).toContain('no process matches "Mahnwesen"');
    expect(t.err()).toContain('nothing was sent');
    expect(posted).toHaveLength(0);
  });
});

const AMEND_ITEM: OpenQuestion = {
  id: Q1,
  kind: 'call-target-unknown',
  source: 'finding',
  group: 'ask',
  subject: { type: 'ref', id: CALL },
  subjectLabel: '„Rechnung stellen“ in „Auftragsabwicklung“',
  modelKeys: [KEY],
  text: 'Welchen Prozess ruft „Rechnung stellen“ auf?',
  detail: null,
  context: null,
  label: null,
  askWho: { lanes: ['Buchhaltung'], stepOwners: [], folder: 'vertrieb' },
  unlocks: 1,
  refs: [CALL],
  raisedBy: { sourceKind: 'rule', handle: null, seq: 3 },
  state: 'open',
  answers: [],
  actions: [
    {
      type: 'amend',
      primary: true,
      label: 'Aufrufziel eintragen …',
      amend: {
        modelId: MODEL_ID,
        modelKey: KEY,
        targets: [
          {
            elementId: 'Call_Rechnung',
            op: 'call-target',
            label: 'Aufrufaktivität „Rechnung stellen“',
          },
        ],
        replaces: MAM1,
      },
      hint: 'in analyzr ergänzt',
    },
    { type: 'link', primary: false, label: 'Nur verknüpfen …', pick: 'process' },
    { type: 'note', primary: false, label: 'Notiz hinzufügen' },
  ],
};

describe('analyzr questions amend', () => {
  it("runs the item's amend action: its model, element and replaces; the question in the output", async () => {
    const posted: Posted[] = [];
    const a = api((dry) => (dry ? json(result()) : json(saved(), 201)), {
      posted,
      items: [AMEND_ITEM],
    });
    const t = owner(a.fetch);
    expect(
      await runCli(
        ['questions', 'amend', Q1, '-p', 'p', '--call-target', 'Rechnungsstellung'],
        t.io,
      ),
    ).toBe(0);
    // No model list: the action names the model.
    expect(routes(a.seen)).toEqual([LIST, AMENDABLE('Call_Rechnung'), LANDSCAPE, AMEND, AMEND]);
    expect(posted[1]).toEqual({
      dryRun: false,
      ifMatch: '"r3"',
      body: {
        items: [
          { elementId: 'Call_Rechnung', op: 'call-target', target: RECHNUNG, replaces: MAM1 },
        ],
      },
    });
    expect(t.out()).toContain(
      `p: amended ${KEY}: new head r5, computed from the uploaded r4\n  ${Q1}: „Rechnung stellen“ in „Auftragsabwicklung“: Welchen Prozess ruft „Rechnung stellen“ auf?\n`,
    );
  });

  it('refuses an item without amend, a wrong flag, and asks for --element among several targets', async () => {
    const link: OpenQuestion = { ...AMEND_ITEM, actions: AMEND_ITEM.actions.slice(1) };
    const n = owner(api(() => json(result()), { items: [link] }).fetch);
    expect(await runCli(['questions', 'amend', Q1, '-p', 'p', '--name', 'A'], n.io)).toBe(1);
    expect(n.err()).toBe(
      `analyzr: ${Q1} (call-target-unknown) offers no amend; its actions: Nur verknüpfen … (link), Notiz hinzufügen (note, analyzr questions answer)\n`,
    );

    const w = owner(api(() => json(result()), { items: [AMEND_ITEM] }).fetch);
    expect(await runCli(['questions', 'amend', Q1, '-p', 'p', '--name', 'A'], w.io)).toBe(1);
    expect(w.err()).toBe(
      `analyzr: ${Q1} sets the call target of Call_Rechnung: give it with --call-target\n`,
    );

    const none = owner(api(() => json(result()), { items: [AMEND_ITEM] }).fetch);
    expect(await runCli(['questions', 'amend', Q1, '-p', 'p'], none.io)).toBe(1);
    expect(none.err()).toBe(`analyzr: give the call target of Call_Rechnung with --call-target\n`);

    const boundary: OpenQuestion = {
      ...AMEND_ITEM,
      kind: 'unlabelled-boundary',
      source: 'signal',
      actions: [
        {
          type: 'amend',
          primary: true,
          label: 'Namen eintragen …',
          amend: {
            modelId: MODEL_ID,
            modelKey: KEY,
            targets: [
              {
                elementId: 'Start_Auftrag',
                op: 'event-name',
                label: 'Startereignis „Start_Auftrag“',
              },
              { elementId: 'End_Auftrag', op: 'event-name', label: 'Endereignis „End_Auftrag“' },
            ],
          },
        },
      ],
    };
    const several = owner(api(() => json(result()), { items: [boundary] }).fetch);
    expect(
      await runCli(['questions', 'amend', Q1, '-p', 'p', '--name', 'Auftrag da'], several.io),
    ).toBe(1);
    expect(several.err()).toBe(
      [
        `analyzr: ${Q1} amends 2 elements: pick one with --element <id>:`,
        '  Startereignis „Start_Auftrag“ (--element Start_Auftrag, --name)',
        '  Endereignis „End_Auftrag“ (--element End_Auftrag, --name)',
        '',
      ].join('\n'),
    );
    const posted: Posted[] = [];
    const start = amendable({
      elementId: 'Start_Auftrag',
      fields: [
        field({
          op: 'event-name',
          elementId: 'Start_Auftrag',
          element: 'start-event',
          value: null,
          uploadedValue: null,
        }),
      ],
    });
    const one = owner(
      api(() => json(result()), { items: [boundary], element: start, posted }).fetch,
    );
    expect(
      await runCli(
        [
          'questions',
          'amend',
          Q1,
          '-p',
          'p',
          '--element',
          'Start_Auftrag',
          '--name',
          'Auftrag da',
          '--dry-run',
        ],
        one.io,
      ),
    ).toBe(0);
    expect(posted[0]?.body).toEqual({
      items: [{ elementId: 'Start_Auftrag', op: 'event-name', after: 'Auftrag da' }],
    });
    const missing = owner(api(() => json(result()), { items: [boundary] }).fetch);
    expect(
      await runCli(
        ['questions', 'amend', Q1, '-p', 'p', '--element', 'Task_X', '--name', 'A'],
        missing.io,
      ),
    ).toBe(1);
    expect(missing.err()).toContain(`analyzr: ${Q1} amends no element Task_X; its targets:\n`);
  });

  it('records the prefilled value again without a value (Meine Ergänzung behalten), as after', async () => {
    const keep: OpenQuestion = {
      ...AMEND_ITEM,
      kind: 'amendment-conflict',
      source: 'amendment',
      actions: [
        {
          type: 'withdraw-amendment',
          primary: true,
          label: 'Wert aus dem Quellsystem übernehmen',
          withdraw: { modelId: MODEL_ID, modelKey: KEY, amendment: MAM1 },
        },
        {
          type: 'amend',
          primary: false,
          label: 'Meine Ergänzung behalten',
          amend: {
            modelId: MODEL_ID,
            modelKey: KEY,
            targets: [
              {
                elementId: 'Call_Rechnung',
                op: 'call-target',
                label: 'Aufrufaktivität „Rechnung stellen“',
                prefill: 'Process_Rechnung',
              },
            ],
            replaces: MAM1,
          },
        },
      ],
    };
    const posted: Posted[] = [];
    const t = owner(
      api((dry) => (dry ? json(result()) : json(saved(), 201)), { items: [keep], posted }).fetch,
    );
    expect(await runCli(['questions', 'amend', Q1, '-p', 'p'], t.io)).toBe(0);
    expect(posted.map((p) => p.body)).toEqual([
      {
        items: [
          {
            elementId: 'Call_Rechnung',
            op: 'call-target',
            after: 'Process_Rechnung',
            replaces: MAM1,
          },
        ],
      },
      {
        items: [
          {
            elementId: 'Call_Rechnung',
            op: 'call-target',
            after: 'Process_Rechnung',
            replaces: MAM1,
          },
        ],
      },
    ]);
  });

  it('refuses an agent token before any request', async () => {
    const none = fakeApi({});
    const agent = testIo({ ANALYZR_TOKEN: AGENT_TOKEN }, none.fetch, { cwd: dir });
    expect(await runCli(['questions', 'amend', Q1, '-p', 'p', '--name', 'A'], agent.io)).toBe(1);
    expect(agent.err()).toBe(
      'analyzr: only humans amend models: analyzr questions amend uses the owner key (drop --token and unset ANALYZR_TOKEN)\n',
    );
    const bad = owner(none.fetch);
    expect(await runCli(['questions', 'amend', 'q-1', '-p', 'p'], bad.io)).toBe(1);
    expect(bad.err()).toContain('not an open question id: "q-1"');
    expect(none.seen).toHaveLength(0);
  });
});

describe('the amendment text helpers', () => {
  it('shows values on one line, cut, and (none) for none', () => {
    expect(shownValue(null)).toBe('(none)');
    expect(shownValue('')).toBe('(none)');
    expect(shownValue('Zeile 1\nZeile 2')).toBe('„Zeile 1 Zeile 2“');
    expect(shownValue('x'.repeat(100))).toBe(`„${'x'.repeat(79)}…“`);
  });

  it('parses one value flag', () => {
    expect(parseValue({})).toBeUndefined();
    expect(parseValue({ documentation: 'Doku' })).toEqual({
      op: 'process-documentation',
      raw: 'Doku',
    });
    expect(() => parseValue({ name: 'a', messageName: 'b', callTarget: 'c' })).toThrow(
      'give one value: --call-target or --message-name or --name, not several',
    );
  });

  it('lists every effect group, at most ten entries each, and the cost', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      relation: null,
      type: 'message' as const,
      from: `${KEY}#E${i}`,
      to: RECHNUNG,
    }));
    const lines = effectLines({ ...EFFECT, findingsResolved: [], accepted: [], proposed: many });
    expect(lines).toHaveLength(12);
    expect(lines.at(-1)).toBe('    … 2 more: proposed');
    expect(costLines({ factsChange: false, pairsToRejudge: 0, taskClaimed: false })).toEqual([
      '  cost: none, the facts stay as they are',
    ]);
  });
});

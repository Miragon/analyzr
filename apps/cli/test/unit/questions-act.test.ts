/**
 * `analyzr questions outside|link|place` against a fake REST API (M6 S5c-1,
 * §4.8 a): the owner key only (an agent token is refused before any
 * request), every flag checked before any request, the item read first (so
 * an action it does not offer is refused with the ones it offers), targets
 * by ref, model key or process name (the landscape read only for names; an
 * ambiguous or unknown one listed and nothing sent), `--pair` on a pair
 * item, a step item's step filled in, the outside mark and its withdrawal
 * (`--undo`), and the results as text or JSON.
 */
import { rm } from 'node:fs/promises';

import {
  OpenQuestionAnswerId,
  type Landscape,
  type OpenQuestion,
  type OpenQuestionActionResult,
  type OpenQuestionAnswer,
  type Placement,
  type Relation,
  type WithdrawOpenQuestionAnswerResult,
} from '@analyzr/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { describeActions, resolveTarget } from '../../src/commands/questions-act.ts';
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
const LIST = 'GET /api/v1/projects/p/open-questions';
const LANDSCAPE = 'GET /api/v1/projects/p/landscape';
const ACT = (q: string) => `POST /api/v1/projects/p/open-questions/${q}/actions`;
const MARK = 'oqa_01JC0000000000000000000001';
const WITHDRAW = `POST /api/v1/projects/p/open-questions/${Q1}/answers/${MARK}/withdrawal`;
const CALL = 'vertrieb/order-handling#Call_FraudCheck';
const KREDIT = 'finanzen/kreditpruefung#Process_Kreditpruefung';
const AUSKUNFT = 'finanzen/kreditpruefung#Process_AuskunfteiAdapter';
const MAHN = 'finanzen/mahnwesen#Process_Mahnwesen';
const FREIGABE = 'einkauf/bestellfreigabe#Process_Bestellfreigabe';
const FREIGABE_ALT = 'einkauf/archiv/bestellfreigabe-2019#Process_Bestellfreigabe';
const AT = '2026-10-17T10:00:00.000Z';

const LINK_ACTIONS: OpenQuestion['actions'] = [
  { type: 'link', primary: true, label: 'Verknüpfen mit …', pick: 'process', suggested: [MAHN] },
  { type: 'outside', primary: false, label: 'Liegt außerhalb der Landschaft' },
  { type: 'note', primary: false, label: 'Notiz hinzufügen' },
];

function question(extra: Partial<OpenQuestion> = {}): OpenQuestion {
  return {
    id: Q1,
    kind: 'call-target-unknown',
    source: 'finding',
    subject: { type: 'ref', id: CALL },
    subjectLabel: '„Run fraud check“ in „Order handling“',
    modelKeys: ['vertrieb/order-handling'],
    text: 'Welchen Prozess ruft „Run fraud check“\nauf?',
    context: null,
    label: null,
    askWho: { lanes: [], stepOwners: [], folder: 'vertrieb' },
    unlocks: 1,
    refs: [CALL],
    raisedBy: { sourceKind: 'rule', handle: null, seq: 3 },
    state: 'open',
    answers: [],
    actions: LINK_ACTIONS,
    ...extra,
  };
}

const PROCESS_ITEM = question({
  id: Q2,
  kind: 'process-without-step',
  source: 'value-chain-finding',
  subject: { type: 'process', id: MAHN },
  subjectLabel: '„Mahnwesen“',
  modelKeys: ['finanzen/mahnwesen'],
  text: 'Welchen Schritt leistet „Mahnwesen“?',
  actions: [
    { type: 'place', primary: true, label: 'Schritt wählen …', pick: 'step' },
    { type: 'place', primary: false, label: 'Gehört zu keinem Schritt', step: '@outside' },
    { type: 'note', primary: false, label: 'Notiz hinzufügen' },
  ],
});

const STEP_ITEM = question({
  kind: 'step-without-process',
  source: 'value-chain-finding',
  subject: { type: 'step', id: 'step-versand' },
  subjectLabel: 'Versand',
  modelKeys: [],
  text: 'Welcher Prozess leistet den Schritt „Versand“?',
  actions: [
    { type: 'place', primary: true, label: 'Prozess zuordnen …', pick: 'process' },
    { type: 'outside', primary: false, label: 'Liegt außerhalb der Landschaft' },
    { type: 'note', primary: false, label: 'Notiz hinzufügen' },
  ],
});

const PAIR_ITEM = question({
  kind: 'unjudged',
  source: 'unjudged',
  subject: { type: 'model', id: 'vertrieb/order-handling' },
  subjectLabel: '„Order handling“',
  text: '2 Paare ohne Urteil.',
  actions: [
    { type: 'requeue', primary: true, label: 'Erneut einplanen' },
    {
      type: 'link',
      primary: false,
      label: 'Paar verknüpfen …',
      pick: 'pair',
      pairs: [{ type: 'message', from: CALL, to: KREDIT }],
    },
    { type: 'note', primary: false, label: 'Notiz hinzufügen' },
  ],
});

const HELD_ITEM = question({
  kind: 'held',
  source: 'hold',
  subject: { type: 'relation', id: 'rel_1' },
  actions: [
    {
      type: 'decide',
      primary: true,
      label: 'Entscheiden',
      decides: [{ type: 'relation', id: 'rel_1', version: 2 }],
    },
    { type: 'note', primary: false, label: 'Notiz hinzufügen' },
  ],
});

const LANDSCAPE_BODY: Landscape = {
  projectId: 'prj_01JC0000000000000000000000',
  seq: 9,
  models: [
    ['finanzen/kreditpruefung', [KREDIT, 'Kreditprüfung', null], [AUSKUNFT, null, 'Auskunftei']],
    ['finanzen/mahnwesen', [MAHN, 'Mahnwesen', null]],
    ['einkauf/bestellfreigabe', [FREIGABE, 'Bestellfreigabe', null]],
    ['einkauf/archiv/bestellfreigabe-2019', [FREIGABE_ALT, 'Bestellfreigabe', null]],
    ['partner/leer'],
  ].map(([key, ...processes], i) => ({
    id: `mdl_01JC000000000000000000000${i}`,
    key: key as string,
    name: null,
    stage: 'waiting_for_agent' as const,
    processes: (processes as [string, string | null, string | null][]).map(
      ([ref, name, participantName]) => ({
        ref: ref as `${string}#${string}`,
        processId: ref.split('#')[1] ?? '',
        name,
        participantName,
        isExecutable: false,
      }),
    ),
  })),
  relations: [],
  findings: [],
};

function relation(extra: Partial<Relation> = {}): Relation {
  return {
    id: 'rel_01JC0000000000000000000001',
    type: 'manual',
    from: CALL,
    to: MAHN,
    status: 'accepted',
    endpointState: 'ok',
    tier: 'manual',
    confidence: null,
    version: 1,
    attrs: {},
    source: 'human',
    provenance: null,
    noLinks: [],
    updatedAt: AT,
    ...extra,
  };
}

function placement(extra: Partial<Placement> = {}): Placement {
  return {
    id: 'plc_01JC0000000000000000000001',
    valueChainId: 'vch_01JC0000000000000000000001',
    elementId: 'step-mahnwesen',
    generation: 1,
    stepName: 'Mahnwesen',
    stepLive: true,
    process: MAHN,
    processName: 'Mahnwesen',
    status: 'accepted',
    endpointState: 'ok',
    endpoints: { step: 'ok', process: 'ok' },
    tier: 'manual',
    confidence: null,
    version: 1,
    source: 'human',
    provenance: null,
    updatedAt: AT,
    ...extra,
  };
}

function mark(extra: Partial<OpenQuestionAnswer> = {}): OpenQuestionAnswer {
  return {
    id: MARK,
    questionId: Q1,
    kind: 'outside-landscape',
    role: 'outside-mark',
    target: 'answer',
    text: null,
    note: null,
    by: 'owner',
    sourceKind: 'human',
    seq: 12,
    at: AT,
    withdrawal: null,
    ...extra,
  };
}

function result(extra: Partial<OpenQuestionActionResult> = {}): OpenQuestionActionResult {
  return {
    result: 'applied',
    question: null,
    relations: [],
    placements: [],
    answer: null,
    warnings: [],
    ...extra,
  };
}

/** A fake API with the items, the landscape and the action route; records the action bodies. */
function api(
  items: readonly OpenQuestion[],
  answer: (body: Record<string, unknown>) => Response,
  bodies: Record<string, unknown>[] = [],
) {
  const routes: Record<string, (req: Request) => Response | Promise<Response>> = {
    [LIST]: () => json({ items, nextCursor: null, total: items.length }),
    [LANDSCAPE]: () => json(LANDSCAPE_BODY),
  };
  for (const q of items) {
    routes[ACT(q.id)] = async (req) => {
      const body = (await req.json()) as Record<string, unknown>;
      bodies.push(body);
      return answer(body);
    };
  }
  return fakeApi(routes);
}

describe('analyzr questions outside', () => {
  it('marks the item with the owner key, its note normalized, and says how to undo it', async () => {
    expect(OpenQuestionAnswerId.safeParse(MARK).success).toBe(true);
    const bodies: Record<string, unknown>[] = [];
    const a = api(
      [question()],
      () =>
        json(
          result({
            question: question({ state: 'answered', answers: [mark({ text: 'Bank.' })] }),
            answer: mark({ text: 'Bank.' }),
          }),
          201,
        ),
      bodies,
    );
    const t = owner(a.fetch);
    expect(
      await runCli(['questions', 'outside', Q1, '-p', 'p', '--note', '  Bank.\r\n'], t.io),
    ).toBe(0);
    expect(a.seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      'GET /api/v1/projects/p/open-questions',
      `POST /api/v1/projects/p/open-questions/${Q1}/actions`,
    ]);
    expect(a.seen.every((s) => s.authorization === `Bearer ${OWNER_KEY}`)).toBe(true);
    expect(bodies).toEqual([{ type: 'outside', note: 'Bank.' }]);
    expect(t.err()).toBe('');
    expect(t.out()).toBe(
      [
        `p: ${Q1} marked outside the landscape (${MARK})`,
        '  „Run fraud check“ in „Order handling“: Welchen Prozess ruft „Run fraud check“ auf?',
        `  undo with: analyzr questions outside ${Q1} -p p --undo ${MARK}`,
        '',
      ].join('\n'),
    );
  });

  it('says unchanged for a marked item, prints the warning and --json the result', async () => {
    const unchanged = result({ result: 'unchanged', question: question(), answer: mark() });
    const u = owner(api([question()], () => json(unchanged)).fetch);
    expect(await runCli(['questions', 'outside', Q1, '-p', 'p'], u.io)).toBe(0);
    expect(u.out()).toContain(
      `p: ${Q1} unchanged: marked outside the landscape already (${MARK})\n`,
    );

    const warned = result({
      answer: mark(),
      warnings: [{ kind: 'email', start: 0, end: 15 }],
    });
    const bodies: Record<string, unknown>[] = [];
    const w = owner(api([question()], () => json(warned, 201), bodies).fetch);
    expect(
      await runCli(['questions', 'outside', Q1, '-p', 'p', '--note', 'max@example.org'], w.io),
    ).toBe(0);
    expect(w.out()).toContain(
      '  warning: the note probably contains an e-mail address (characters 1–15)\n  notes take no names or other personal data, and a recorded note cannot be deleted\n',
    );

    const j = owner(api([question()], () => json(warned, 201)).fetch);
    expect(await runCli(['questions', 'outside', Q1, '-p', 'p', '--json'], j.io)).toBe(0);
    expect(JSON.parse(j.out())).toEqual(warned);
  });

  it('--undo withdraws the mark: open again, still answered by another mark, or withdrawn before', async () => {
    const withdrawn = mark({ withdrawal: { by: 'owner', seq: 14, at: AT } });
    const answers: [WithdrawOpenQuestionAnswerResult, string][] = [
      [
        { result: 'withdrawn', answer: withdrawn, question: question({ answers: [withdrawn] }) },
        `p: outside mark ${MARK} on ${Q1} withdrawn; the question is open again\n`,
      ],
      [
        {
          result: 'withdrawn',
          answer: withdrawn,
          question: question({ state: 'answered', answers: [withdrawn] }),
        },
        `p: outside mark ${MARK} on ${Q1} withdrawn; another outside mark still answers the question\n`,
      ],
      [
        { result: 'unchanged', answer: withdrawn, question: question({ answers: [withdrawn] }) },
        `p: outside mark ${MARK} on ${Q1} unchanged: withdrawn before\n`,
      ],
    ];
    for (const [body, line] of answers) {
      const a = fakeApi({ [WITHDRAW]: () => json(body, body.result === 'withdrawn' ? 201 : 200) });
      const t = owner(a.fetch);
      expect(await runCli(['questions', 'outside', Q1, '-p', 'p', '--undo', MARK], t.io)).toBe(0);
      // No list first: the server checks the mark.
      expect(a.seen.map((s) => s.path)).toEqual([WITHDRAW.slice('POST '.length)]);
      expect(t.out()).toBe(
        `${line}  „Run fraud check“ in „Order handling“: Welchen Prozess ruft „Run fraud check“ auf?\n`,
      );
    }
    const note = owner(
      fakeApi({
        [WITHDRAW]: () =>
          problem(422, 'validation-failed', 'only an outside mark is withdrawn; a note stays'),
      }).fetch,
    );
    expect(await runCli(['questions', 'outside', Q1, '-p', 'p', '--undo', MARK], note.io)).toBe(1);
    expect(note.err()).toBe(
      `analyzr: withdraw the outside mark ${MARK} of ${Q1} in p failed (422 validation-failed): only an outside mark is withdrawn; a note stays\n`,
    );
  });
});

describe('analyzr questions link', () => {
  it('sends a ref as it is, without reading the landscape, and prints the manual relation', async () => {
    const bodies: Record<string, unknown>[] = [];
    const a = api(
      [question()],
      () => json(result({ relations: [{ effect: 'manual', relation: relation() }] }), 201),
      bodies,
    );
    const t = owner(a.fetch);
    expect(
      await runCli(['questions', 'link', Q1, '-p', 'p', '--to', MAHN, '--note', 'Laut FB.'], t.io),
    ).toBe(0);
    expect(a.seen.map((s) => s.path)).not.toContain('/api/v1/projects/p/landscape');
    expect(bodies).toEqual([{ type: 'link', targets: [MAHN], note: 'Laut FB.' }]);
    expect(t.out()).toBe(
      [
        `p: ${Q1} linked`,
        '  „Run fraud check“ in „Order handling“: Welchen Prozess ruft „Run fraud check“ auf?',
        `  wrote the accepted manual relation ${CALL} → ${MAHN} (rel_01JC0000000000000000000001)`,
        '  the question is resolved and leaves the list',
        '  to undo, reject the manual relation in the review screen of the web UI:',
        '    http://127.0.0.1:7400/projects/p/review/rel_01JC0000000000000000000001',
        '',
      ].join('\n'),
    );
  });

  it('resolves a process name (case and spaces ignored) and a model key with one process', async () => {
    for (const [target, ref] of [
      ['kreditprüfung', KREDIT],
      ['  Kreditprüfung ', KREDIT],
      ['Auskunftei', AUSKUNFT],
      ['finanzen/mahnwesen', MAHN],
    ] as const) {
      const bodies: Record<string, unknown>[] = [];
      const accepted = relation({ type: 'call', status: 'accepted', source: 'human', to: ref });
      const a = api(
        [question()],
        () => json(result({ relations: [{ effect: 'decision', relation: accepted }] }), 201),
        bodies,
      );
      const t = owner(a.fetch);
      expect(await runCli(['questions', 'link', Q1, '-p', 'p', '--to', target], t.io), target).toBe(
        0,
      );
      expect(bodies, target).toEqual([{ type: 'link', targets: [ref] }]);
      expect(t.out()).toContain(
        `  accepted the call proposal ${CALL} → ${ref} (rel_01JC0000000000000000000001)\n`,
      );
      expect(t.out()).not.toContain('to undo');
      expect(t.out()).toContain(
        '  the proposal is decided (no undo); change the decision in the review screen:\n' +
          '    http://127.0.0.1:7400/projects/p/review/rel_01JC0000000000000000000001\n',
      );
    }
  });

  it('lists the candidates of an ambiguous or unknown target and sends nothing', async () => {
    const cases: [string[], string][] = [
      [
        ['--to', 'Bestellfreigabe'],
        `analyzr: "Bestellfreigabe" matches 2 processes; name one by its ref:\n  „Bestellfreigabe“ (${FREIGABE_ALT})\n  „Bestellfreigabe“ (${FREIGABE})\nnothing was sent\n`,
      ],
      [
        ['--to', 'finanzen/kreditpruefung'],
        `analyzr: model finanzen/kreditpruefung has 2 processes; name one by its ref:\n  „Auskunftei“ (${AUSKUNFT})\n  „Kreditprüfung“ (${KREDIT})\nnothing was sent\n`,
      ],
      [['--to', 'partner/leer'], 'analyzr: model partner/leer has no process\nnothing was sent\n'],
      [
        ['--to', 'Versand', '--to', 'Bestellfreigabe'],
        'analyzr: no process matches "Versand": give a ref (<model key>#<process id>), the key of a model with one process or a process name\n"Bestellfreigabe" matches 2 processes',
      ],
    ];
    const items = [question(), question({ id: Q2, kind: 'call-target-dynamic' })];
    items[1] = { ...items[1], actions: [{ ...LINK_ACTIONS[0], multiple: true }] } as OpenQuestion;
    for (const [flags, message] of cases) {
      const a = api(items, () => json(result(), 201));
      const t = owner(a.fetch);
      const id = flags.length > 2 ? Q2 : Q1;
      expect(
        await runCli(['questions', 'link', id, '-p', 'p', ...flags], t.io),
        flags.join(' '),
      ).toBe(1);
      expect(t.err(), flags.join(' ')).toContain(message);
      expect(
        a.seen.some((s) => s.method === 'POST'),
        flags.join(' '),
      ).toBe(false);
    }
  });

  it('takes several targets only where the item does, each once', async () => {
    const single = owner(api([question()], () => json(result(), 201)).fetch);
    expect(
      await runCli(['questions', 'link', Q1, '-p', 'p', '--to', MAHN, '--to', KREDIT], single.io),
    ).toBe(1);
    expect(single.err()).toBe(
      `analyzr: ${Q1} links one target („Verknüpfen mit …“): give one --to\n`,
    );
    const dynamic = question({
      kind: 'call-target-dynamic',
      actions: [
        {
          type: 'link',
          primary: true,
          label: 'Mögliche Ziele verknüpfen …',
          pick: 'process',
          multiple: true,
        },
      ],
    });
    const bodies: Record<string, unknown>[] = [];
    const many = owner(api([dynamic], () => json(result(), 201), bodies).fetch);
    expect(
      await runCli(
        ['questions', 'link', Q1, '-p', 'p', '--to', MAHN, '--to', 'Mahnwesen', '--to', KREDIT],
        many.io,
      ),
    ).toBe(0);
    expect(bodies).toEqual([{ type: 'link', targets: [MAHN, KREDIT] }]);
  });

  it('links one of the listed pairs with --pair, either way round', async () => {
    for (const refs of [
      [CALL, KREDIT],
      [KREDIT, CALL],
    ]) {
      const bodies: Record<string, unknown>[] = [];
      const t = owner(api([PAIR_ITEM], () => json(result(), 201), bodies).fetch);
      expect(await runCli(['questions', 'link', Q1, '-p', 'p', '--pair', ...refs], t.io)).toBe(0);
      expect(bodies).toEqual([{ type: 'link', pair: { from: CALL, to: KREDIT } }]);
    }
    const cases: [string[], string][] = [
      [
        ['--pair', CALL, MAHN],
        `analyzr: ${CALL} ${MAHN} is none of the pairs ${Q1} lists; the pairs:\n  message ${CALL} → ${KREDIT}\n`,
      ],
      [
        ['--to', MAHN],
        `analyzr: ${Q1} links one of the pairs it lists: give --pair <from> <to>; the pairs:\n  message ${CALL} → ${KREDIT}\n`,
      ],
    ];
    for (const [flags, message] of cases) {
      const a = api([PAIR_ITEM], () => json(result(), 201));
      const t = owner(a.fetch);
      expect(await runCli(['questions', 'link', Q1, '-p', 'p', ...flags], t.io)).toBe(1);
      expect(t.err()).toBe(message);
      expect(a.seen.some((s) => s.method === 'POST')).toBe(false);
    }
    const targets = owner(api([question()], () => json(result(), 201)).fetch);
    expect(
      await runCli(['questions', 'link', Q1, '-p', 'p', '--pair', CALL, KREDIT], targets.io),
    ).toBe(1);
    expect(targets.err()).toBe(`analyzr: ${Q1} links targets, not a pair: give --to <target>\n`);
  });

  it('says unchanged when every target is linked, and still open when the item stays', async () => {
    const u = owner(api([question()], () => json(result({ result: 'unchanged' }))).fetch);
    expect(await runCli(['questions', 'link', Q1, '-p', 'p', '--to', MAHN], u.io)).toBe(0);
    expect(u.out()).toBe(
      `p: ${Q1} unchanged: every target is linked already\n  „Run fraud check“ in „Order handling“: Welchen Prozess ruft „Run fraud check“ auf?\n`,
    );
    const open = owner(
      api([question()], () =>
        json(
          result({
            question: question(),
            relations: [{ effect: 'manual', relation: relation() }],
          }),
          201,
        ),
      ).fetch,
    );
    expect(await runCli(['questions', 'link', Q1, '-p', 'p', '--to', MAHN], open.io)).toBe(0);
    expect(open.out()).toContain('  the question is still open\n');
  });
});

describe('analyzr questions place', () => {
  it("places the item's process on a step or on @outside", async () => {
    const bodies: Record<string, unknown>[] = [];
    const a = api(
      [PROCESS_ITEM],
      (body) =>
        json(
          result({
            placements: [
              {
                effect: 'manual',
                placement:
                  body['step'] === '@outside'
                    ? placement({ elementId: '@outside', stepName: null })
                    : placement(),
              },
            ],
          }),
          201,
        ),
      bodies,
    );
    const t = owner(a.fetch);
    expect(
      await runCli(['questions', 'place', Q2, '-p', 'p', '--step', 'step-mahnwesen'], t.io),
    ).toBe(0);
    expect(t.out()).toBe(
      [
        `p: ${Q2}: placed „Mahnwesen“ on step „Mahnwesen“ (step-mahnwesen) (plc_01JC0000000000000000000001)`,
        '  „Mahnwesen“: Welchen Schritt leistet „Mahnwesen“?',
        '  the question is resolved and leaves the list',
        '  to undo, reject the placement on the value chain page of the web UI:',
        '    http://127.0.0.1:7400/projects/p/value-chain?placement=plc_01JC0000000000000000000001',
        '',
      ].join('\n'),
    );
    const o = owner(a.fetch);
    expect(
      await runCli(
        ['questions', 'place', Q2, '-p', 'p', '--step', '@outside', '--note', 'Alt.'],
        o.io,
      ),
    ).toBe(0);
    expect(o.out()).toContain(
      `p: ${Q2}: placed „Mahnwesen“ on no step (@outside) (plc_01JC0000000000000000000001)\n`,
    );
    expect(bodies).toEqual([
      { type: 'place', step: 'step-mahnwesen' },
      { type: 'place', step: '@outside', note: 'Alt.' },
    ]);
    const u = owner(api([PROCESS_ITEM], () => json(result({ result: 'unchanged' }))).fetch);
    expect(await runCli(['questions', 'place', Q2, '-p', 'p', '--step', 'step-x'], u.io)).toBe(0);
    expect(u.out()).toContain(`p: ${Q2} unchanged: the process is placed there already\n`);
  });

  it("places the named process on a step item's own step", async () => {
    const bodies: Record<string, unknown>[] = [];
    const a = api(
      [STEP_ITEM],
      () =>
        json(
          result({
            placements: [
              {
                effect: 'manual',
                placement: placement({ elementId: 'step-versand', stepName: 'Versand' }),
              },
            ],
          }),
          201,
        ),
      bodies,
    );
    const t = owner(a.fetch);
    expect(
      await runCli(['questions', 'place', Q1, '-p', 'p', '--process', 'Mahnwesen'], t.io),
    ).toBe(0);
    expect(bodies).toEqual([{ type: 'place', step: 'step-versand', process: MAHN }]);
    expect(t.out()).toContain(`placed „Mahnwesen“ on step „Versand“ (step-versand)`);
    const cases: [string[], string][] = [
      [
        ['--step', 'step-lager', '--process', MAHN],
        `analyzr: ${Q1} places a process on its step step-versand: drop --step and give the process with --process <target>\n`,
      ],
      [
        ['--step', 'step-versand'],
        `analyzr: ${Q1} places a process on its step step-versand: give it with --process <target>`,
      ],
    ];
    for (const [flags, message] of cases) {
      const c = owner(a.fetch);
      expect(await runCli(['questions', 'place', Q1, '-p', 'p', ...flags], c.io)).toBe(1);
      expect(c.err()).toContain(message);
    }
    const own = owner(api([PROCESS_ITEM], () => json(result(), 201)).fetch);
    expect(await runCli(['questions', 'place', Q2, '-p', 'p', '--process', KREDIT], own.io)).toBe(
      1,
    );
    expect(own.err()).toBe(
      `analyzr: ${Q2} places its own process ${MAHN}: drop --process and give the step with --step\n`,
    );
    expect(bodies).toHaveLength(1);
  });
});

describe('analyzr questions outside|link|place (refused)', () => {
  it('refuses an agent token before any request: only humans act', async () => {
    const none = fakeApi({});
    for (const [cmd, ...flags] of [
      ['outside'],
      ['outside', '--undo', MARK],
      ['link', '--to', MAHN],
      ['place', '--step', '@outside'],
    ] as [string, ...string[]][]) {
      const env = testIo({ ANALYZR_TOKEN: AGENT_TOKEN }, none.fetch, { cwd: dir });
      expect(await runCli(['questions', cmd, Q1, '-p', 'p', ...flags], env.io)).toBe(1);
      expect(env.err()).toBe(
        `analyzr: only humans act on open questions: analyzr questions ${cmd} uses the owner key (drop --token and unset ANALYZR_TOKEN)\n`,
      );
    }
    expect(none.seen).toHaveLength(0);
  });

  it('checks the id and the flags before any request', async () => {
    const none = fakeApi({});
    const cases: [string[], string][] = [
      [['outside', 'q-1'], 'not an open question id: "q-1"'],
      [['outside', Q1, '--note', ' \n'], 'the note is empty: give a text with --note or drop it'],
      [['outside', Q1, '--note', 'x'.repeat(2001)], 'the note has 2001 characters; at most 2000'],
      [['outside', Q1, '--undo', 'oqa_1'], 'not an answer id: "oqa_1"'],
      [
        ['outside', Q1, '--undo', MARK, '--note', 'x'],
        '--undo withdraws a mark and takes no --note',
      ],
      [['link', Q1], 'give the target with --to <target>'],
      [['link', Q1, '--to', ' '], '--to needs a target, not an empty text'],
      [['link', Q1, '--to', MAHN, '--pair', CALL, KREDIT], 'give --to <target> or --pair'],
      [['link', Q1, '--pair', CALL], '--pair takes two refs'],
      [['link', Q1, '--pair', CALL, 'Mahnwesen'], '--pair takes two refs'],
      [
        ['link', Q1, ...Array.from({ length: 11 }, (_, i) => ['--to', `m/x#P${i}`]).flat()],
        '11 targets; at most 10 per link',
      ],
      [['place', Q1], 'give the step with --step <step element id> or --step @outside'],
      [['place', Q1, '--step', ''], 'not a step: ""'],
      [['place', Q1, '--process', ' '], '--process needs a process, not an empty text'],
      [['link', Q1, '-p'], "option '-p, --project <project>' argument missing"],
    ];
    for (const [argv, message] of cases) {
      const t = owner(none.fetch);
      const withProject = argv.includes('-p') ? argv : [...argv, '-p', 'p'];
      expect(await runCli(['questions', ...withProject], t.io), argv.join(' ')).toBe(1);
      expect(t.err(), argv.join(' ')).toContain(message);
    }
    expect(none.seen).toHaveLength(0);
  });

  it('refuses an action the item does not offer, naming the ones it does', async () => {
    const t = owner(api([HELD_ITEM], () => json(result(), 201)).fetch);
    expect(await runCli(['questions', 'outside', Q1, '-p', 'p'], t.io)).toBe(1);
    expect(t.err()).toBe(
      `analyzr: ${Q1} (held) offers no outside; its actions: Entscheiden (decide, in the web UI), Notiz hinzufügen (note, analyzr questions answer)\n`,
    );
    expect(describeActions(question({ actions: [] }))).toBe(
      'none: it is informational and asks nothing',
    );
    expect(describeActions(PAIR_ITEM)).toBe(
      'Erneut einplanen (requeue, analyzr models requeue), Paar verknüpfen … (link), Notiz hinzufügen (note, analyzr questions answer)',
    );
    // M6 S5c-2: the amendment actions name their commands.
    expect(
      describeActions({
        actions: [
          {
            type: 'withdraw-amendment',
            primary: true,
            label: 'Wert aus dem Quellsystem übernehmen',
          },
          { type: 'amend', primary: false, label: 'Meine Ergänzung behalten' },
        ],
      }),
    ).toBe(
      'Wert aus dem Quellsystem übernehmen (withdraw-amendment, analyzr amendments withdraw), Meine Ergänzung behalten (amend, analyzr questions amend)',
    );
  });

  it("reports an id that names no current item, and the server's problem", async () => {
    const gone = owner(api([question({ id: Q2 })], () => json(result(), 201)).fetch);
    expect(await runCli(['questions', 'link', Q1, '-p', 'p', '--to', MAHN], gone.io)).toBe(1);
    expect(gone.err()).toBe(
      `analyzr: ${Q1} is no current open question of p: a wrong id, or what it asks about changed, which changes the id; list them again with analyzr questions -p p\n`,
    );
    const refused = owner(
      api([question()], () =>
        problem(422, 'validation-failed', `m/x#P is not an element of the head revisions`),
      ).fetch,
    );
    expect(await runCli(['questions', 'link', Q1, '-p', 'p', '--to', 'm/x#P'], refused.io)).toBe(1);
    expect(refused.err()).toBe(
      `analyzr: link ${Q1} in p failed (422 validation-failed): m/x#P is not an element of the head revisions\n`,
    );
    const demo = owner(
      api([question()], () => problem(403, 'demo-readonly', 'the demo is read-only')).fetch,
    );
    expect(await runCli(['questions', 'outside', Q1, '-p', 'p'], demo.io)).toBe(1);
    expect(demo.err()).toContain('(403 demo-readonly): the demo is read-only');
  });

  it('follows the list pages until the item turns up', async () => {
    const seen: URL[] = [];
    const items = [question({ id: Q2 }), question()];
    const a = fakeApi({
      [LIST]: (_req, url) => {
        seen.push(url);
        const start = Number(url.searchParams.get('cursor') ?? '0');
        return json({
          items: items.slice(start, start + 1),
          nextCursor: start + 1 < items.length ? String(start + 1) : null,
          total: items.length,
        });
      },
      [ACT(Q1)]: () => json(result({ answer: mark() }), 201),
    });
    const t = owner(a.fetch);
    expect(await runCli(['questions', 'outside', Q1, '-p', 'p'], t.io)).toBe(0);
    expect(seen.map((u) => u.searchParams.get('cursor'))).toEqual([null, '1']);
  });
});

describe('resolveTarget', () => {
  const landscape = {
    processes: LANDSCAPE_BODY.models.flatMap((m) =>
      m.processes.map((p) => ({
        ref: p.ref,
        name: p.name ?? p.participantName ?? p.processId,
        modelKey: m.key,
      })),
    ),
    modelKeys: new Set(LANDSCAPE_BODY.models.map((m) => m.key)),
  };

  it('takes a ref as it is, a model key with one process and a unique name', () => {
    expect(resolveTarget('x/y#Anything', landscape)).toEqual({ ok: true, ref: 'x/y#Anything' });
    expect(resolveTarget(' finanzen/mahnwesen ', landscape)).toEqual({ ok: true, ref: MAHN });
    expect(resolveTarget('MAHNWESEN', landscape)).toEqual({ ok: true, ref: MAHN });
    // The pool's name when the process has none, as the server names it.
    expect(resolveTarget('auskunftei', landscape)).toEqual({ ok: true, ref: AUSKUNFT });
  });

  it('refuses none or several', () => {
    expect(resolveTarget('Lager', landscape)).toMatchObject({ ok: false });
    expect(resolveTarget('partner/leer', landscape)).toEqual({
      ok: false,
      message: 'model partner/leer has no process',
    });
    const several = resolveTarget('bestellfreigabe', landscape);
    expect(several.ok).toBe(false);
    if (!several.ok) expect(several.message.split('\n')).toHaveLength(3);
  });
});

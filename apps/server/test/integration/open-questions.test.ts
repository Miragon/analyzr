/**
 * Open questions end to end (M6 S4): `nordwind-handel` imported with the real
 * libraries and its golden value chain created, as `analyzr seed
 * --value-chains` does; then worked by the simulation agent over MCP, held by
 * the owner, and analysed again by a probe agent after a model change (coded
 * no-links, pairs left unjudged, an unsure verdict, a placement question).
 * Requires: every source of M6 §4.1 maps to items with the expected kinds;
 * every relation and value chain finding is an item; ids stay stable across
 * reads and change exactly when what they ask about changes (M6 S5c-1);
 * filters and pages agree; the CSV and Markdown exports round trip, the CSV
 * with its empty answer column and its formula protection. Prints the counts per kind and
 * per gap signal (M6 §8 "S4 as delivered").
 */
import { readFile } from 'node:fs/promises';

import { connect as connectSim, runAgent } from '@analyzr/agent-sim';
import type { OpenQuestion } from '@analyzr/contracts';
import {
  OPEN_QUESTION_CSV_COLUMNS,
  OpenQuestionPage,
  isInformationalKind,
  type CreatedAgentToken,
  type FindingList,
  type OpenQuestionKind,
  type OpenQuestionSource,
  type PlacementPage,
  type Relation,
  type RelationPage,
  type ValueChainDetail,
  type ValueChainFindingList,
} from '@analyzr/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { libraryAnalysis } from '../../src/analysis.ts';
import { detailText, parseOpenQuestionsCsv } from '../../src/domain/open-questions/export.ts';
import { startTestApp, type TestApp } from '../support/app.ts';
import { corpusFiles, importAll } from '../support/corpus.ts';
import { createTestDatabase, type TestDatabase } from '../support/db.ts';
import { listen } from '../support/http.ts';
import { asAgent, claim, post, submission, submit } from '../support/pipeline.ts';
import { NORDWIND_CHAIN, chainPath } from '../support/value-chain.ts';

const P = 'nordwind-handel';
/** The UI load guard's id regex (UX-SIMPLIFICATION §7): no id, seq or ref in visible text. */
const ID_IN_TEXT = /rel_|plc_|agt_|mam_|oqa_|q-[0-9a-f]{16}|sid-|Stand s\d|Ereignis \d/;
const BASE = `/api/v1/projects/${P}/open-questions`;
const ORDER = 'vertrieb/order-handling';
const FRAUD_CHECK = `${ORDER}#Call_FraudCheck`;
const SEND_CONFIRMATION = `${ORDER}#Task_SendConfirmation`;
const CARRIER = 'logistik/shipping#Participant_Carrier';

let database: TestDatabase;
let t: TestApp;
let server: { url: string; close: () => Promise<void> };
let sim: CreatedAgentToken;
let probe: CreatedAgentToken;
let viewer: CreatedAgentToken;
let seeded: OpenQuestion[] = [];

type Call = (path: string, init?: RequestInit) => Promise<Response>;

const owner: Call = (path, init) => t.asOwner(path, init);

async function getJson<T>(call: Call, path: string): Promise<T> {
  const res = await call(path);
  if (res.status !== 200) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Every open question, page by page (`limit` per page), checked against the contract. */
async function listAll(query = '', limit = 50, call: Call = owner): Promise<OpenQuestion[]> {
  const out: OpenQuestion[] = [];
  let cursor: string | null = null;
  let total = -1;
  do {
    const after: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
    const page = OpenQuestionPage.parse(
      await getJson(call, `${BASE}?limit=${limit}${query}${after}`),
    );
    if (total >= 0) expect(page.total).toBe(total);
    total = page.total;
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  expect(out).toHaveLength(total);
  return out;
}

/** The items per group, every group present (as `totals` counts them). */
const groupCounts = (items: readonly OpenQuestion[]) => ({
  ask: items.filter((q) => q.group === 'ask').length,
  agent: items.filter((q) => q.group === 'agent').length,
  proposal: items.filter((q) => q.group === 'proposal').length,
  info: items.filter((q) => q.group === 'info').length,
});

const counts = (items: readonly OpenQuestion[], by: (q: OpenQuestion) => string) => {
  const out: Record<string, number> = {};
  for (const q of items) out[by(q)] = (out[by(q)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
};

/** The first page's `totals` and `askByModel` (UX2a), checked against the items. */
async function summary(
  query = '',
  call: Call = owner,
): Promise<Pick<OpenQuestionPage, 'totals' | 'askByModel'>> {
  const page = OpenQuestionPage.parse(await getJson(call, `${BASE}?limit=1${query}`));
  return { totals: page.totals, askByModel: page.askByModel };
}

function report(label: string, items: readonly OpenQuestion[]): void {
  console.log(
    `open questions ${label}: ${items.length} items; by kind ${JSON.stringify(counts(items, (q) => q.kind))}; ` +
      `signals ${JSON.stringify(
        counts(
          items.filter((q) => q.source === 'signal'),
          (q) => q.kind,
        ),
      )}; ` +
      `by source ${JSON.stringify(counts(items, (q) => q.source))}`,
  );
}

const FINDING_KINDS: Record<string, OpenQuestionKind> = {
  'unresolved-call': 'call-target-unknown',
  'dynamic-call': 'call-target-dynamic',
  'duplicate-process-id': 'duplicate-process-id',
  'dangling-throw': 'message-partner-missing',
  'unmatched-catch': 'message-partner-missing',
};

beforeAll(async () => {
  database = await createTestDatabase();
  t = startTestApp(database, { analysis: libraryAnalysis });
  await t.createProject(P, P);
  const outcomes = await importAll((p, init) => t.asOwner(p, init), P, await corpusFiles(P));
  expect(outcomes.every((o) => o.outcome === 'created')).toBe(true);
  // As `analyzr seed --value-chains`: the golden chain after the import, without placements.
  const saved = await t.asOwner(chainPath(P, '/content'), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'if-none-match': '*' },
    body: await readFile(NORDWIND_CHAIN),
  });
  expect(saved.status).toBe(201);
  sim = await t.createToken(P, ['analyzr:read', 'analyzr:propose']);
  probe = await t.createToken(P, ['analyzr:read', 'analyzr:propose']);
  viewer = await t.createToken(P, ['analyzr:read']);
  server = await listen(t.app.fetch);
}, 180_000);

afterAll(async () => {
  await server?.close();
  await database?.drop();
});

describe('open questions on nordwind-handel', () => {
  it('maps every finding of the seeded project, stably and for viewers too', async () => {
    seeded = await listAll();
    report('seeded', seeded);
    // UX2a: the groups as seeded (no agent yet): the rule tier's placement proposals wait on
    // the chain (`proposal`), everything else is to clarify; the ask subjects per model.
    const seededSummary = await summary('&state=open');
    expect(seededSummary).toEqual({
      totals: { ask: 58, agent: 0, proposal: 6, info: 0 },
      askByModel: {
        'controlling/management-reporting': 1,
        'einkauf/archiv/bestellfreigabe-2019': 1,
        'einkauf/bestellanforderung': 2,
        'einkauf/bestellfreigabe': 2,
        'einkauf/lieferantenanlage': 1,
        'finanzen/briefversand': 1,
        'finanzen/e-rechnung-versand': 1,
        'finanzen/forderungsmanagement': 3,
        'finanzen/gutschrift': 1,
        'finanzen/kreditpruefung': 2,
        'finanzen/lieferantenrechnung': 3,
        'finanzen/monatsabschluss': 1,
        'finanzen/rechnungsstellung': 1,
        'finanzen/zahlungseingang': 1,
        'finanzen/zahlungslauf': 3,
        'lager/bestandsueberwachung': 1,
        'lager/kommissionierung': 1,
        'logistik/shipping': 2,
        'logistik/speditionsversand': 2,
        'partner/customer-account-lock': 1,
        'partner/partner-onboarding': 1,
        'qualitaet/produktrueckruf': 1,
        'qualitaet/wareneingangspruefung': 1,
        'service/ersatzlieferung': 1,
        'service/kundenbenachrichtigung': 1,
        'service/reklamation': 2,
        'service/returns': 3,
        'vertrieb/marketplace-order-import': 3,
        'vertrieb/order-handling': 4,
      },
    });
    expect(groupCounts(seeded)).toEqual(seededSummary.totals);
    expect(
      counts(
        seeded.filter((q) => q.group === 'proposal'),
        (q) => q.kind,
      ),
    ).toEqual({
      'process-without-step': 4,
      'step-without-process': 2,
    });
    // The group filter, repeatable; `totals` stays the same under it.
    expect(await listAll('&group=ask')).toEqual(seeded.filter((q) => q.group === 'ask'));
    expect(await listAll('&group=proposal&group=info')).toEqual(
      seeded.filter((q) => q.group === 'proposal'),
    );
    expect(await summary('&state=open&group=agent')).toEqual(seededSummary);
    expect((await t.asOwner(`${BASE}?group=nope`)).status).toBe(422);
    const findings = await getJson<FindingList>(owner, `/api/v1/projects/${P}/findings`);
    for (const f of findings.items) {
      const subject =
        f.kind === 'duplicate-process-id'
          ? { type: 'process', id: f.refs[0] }
          : { type: 'ref', id: f.refs[0] };
      expect(
        seeded.filter(
          (q) =>
            q.source === 'finding' &&
            q.kind === FINDING_KINDS[f.kind] &&
            q.subject.type === subject.type &&
            q.subject.id === subject.id,
        ),
        `${f.kind} ${f.refs.join(' ')}`,
      ).toHaveLength(1);
    }
    const chainFindings = await getJson<ValueChainFindingList>(owner, chainPath(P, '/findings'));
    for (const f of chainFindings.items) {
      const id = f.kind === 'process-without-step' ? f.process : f.elementId;
      expect(
        seeded.filter(
          (q) => q.source === 'value-chain-finding' && q.kind === f.kind && q.subject.id === id,
        ),
        `${f.kind} ${id ?? ''}`,
      ).toHaveLength(1);
    }
    expect(counts(seeded, (q) => q.source)).toEqual({
      finding: findings.items.length,
      signal: 6,
      'value-chain-finding': chainFindings.items.length,
    });
    expect(
      counts(
        seeded.filter((q) => q.source === 'signal'),
        (q) => q.kind,
      ),
    ).toEqual({
      'black-box-partner': 6,
    });
    expect(
      counts(
        seeded.filter((q) => q.source === 'finding'),
        (q) => q.kind,
      ),
    ).toEqual({
      'call-target-dynamic': 2,
      'call-target-unknown': 2,
      'duplicate-process-id': 1,
      'message-partner-missing': 9,
    });
    // Stable across reads, the same in small pages and for a read-only token.
    expect(await listAll()).toEqual(seeded);
    expect(await listAll('', 7)).toEqual(seeded);
    expect(await listAll('', 200, (path, init) => t.asToken(viewer.secret, path, init))).toEqual(
      seeded,
    );
    // Filters, as the list computes them.
    const vertrieb = await listAll('&modelKey=vertrieb');
    expect(vertrieb.length).toBeGreaterThan(0);
    expect(vertrieb).toEqual(
      seeded.filter((q) => q.modelKeys.some((k) => k.startsWith('vertrieb/'))),
    );
    expect(await listAll('&source=signal&kind=black-box-partner')).toEqual(
      seeded.filter((q) => q.kind === 'black-box-partner'),
    );
    expect(await listAll('&askWho=logistik')).toEqual(
      seeded.filter((q) => q.askWho.folder === 'logistik'),
    );
    expect(await listAll('&state=answered')).toEqual([]);
    const bad = await t.asOwner(`${BASE}?kind=nope`);
    expect(bad.status).toBe(422);
  }, 60_000);

  it('maps every source after the agents and the owner worked the project', async () => {
    // 1. The simulation agent works every relations task and the placement task.
    const session = await connectSim(
      { kind: 'http', url: server.url, token: sim.secret },
      { name: 'analyzr-agent-sim', version: '0.0.0' },
    );
    try {
      const run = await runAgent(session, { projectId: P });
      expect(run.stop).toBe('no-work');
    } finally {
      await session.close();
    }
    const afterSim = await listAll();
    report('after the simulation agent', afterSim);
    // UX2a, the pinned groups on seeded nordwind-handel with its chain after the simulation
    // agent (the state the UI load guard and the owner's walkthrough use): 21 to clarify,
    // the agents' questions on their proposals, the chain's own queue, the summaries.
    const simSummary = await summary('&state=open');
    expect(simSummary.totals).toEqual({ ask: 21, agent: 22, proposal: 27, info: 32 });
    expect(groupCounts(afterSim)).toEqual(simSummary.totals);
    expect(counts(afterSim, (q) => `${q.group} ${q.kind}`)).toEqual({
      'agent agent-question': 22,
      'ask black-box-partner': 6,
      'ask call-target-dynamic': 2,
      'ask call-target-unknown': 2,
      'ask duplicate-process-id': 1,
      'ask message-partner-missing': 3,
      'ask placement-unsure': 3,
      'ask step-without-process': 4,
      'info summary-note': 32,
      'proposal process-without-step': 19,
      // The top-level steps whose sub-steps carry proposals.
      'proposal step-without-process': 8,
    });
    // One question per process: no chain finding beside an agent's question on a placement
    // of its process or an unsure verdict about it.
    const askedProcesses = new Set([
      ...afterSim.filter((q) => q.kind === 'placement-unsure').map((q) => q.subject.id),
      ...afterSim
        .filter((q) => q.kind === 'agent-question' && q.subject.type === 'placement')
        .flatMap((q) => q.refs),
    ]);
    expect(askedProcesses.size).toBeGreaterThan(0);
    expect(
      afterSim.filter((q) => q.kind === 'process-without-step' && askedProcesses.has(q.subject.id)),
    ).toEqual([]);
    // The proposal items open the chain: „Auf der Kette prüfen“ at a step.
    for (const q of afterSim.filter((x) => x.group === 'proposal')) {
      expect(q.actions[0], q.id).toMatchObject({
        type: 'decide',
        primary: true,
        label: 'Auf der Kette prüfen',
        step: expect.any(String) as unknown,
      });
      expect(q.actions[0]?.decides?.length, q.id).toBeGreaterThan(0);
    }
    expect(simSummary.askByModel).toEqual({
      'controlling/management-reporting': 1,
      'einkauf/archiv/bestellfreigabe-2019': 1,
      // The pool question (the models table's „Offene Punkte“: 6 relations + 1 placement + 1).
      'einkauf/bestellanforderung': 1,
      'einkauf/bestellfreigabe': 1,
      'finanzen/forderungsmanagement': 3,
      'finanzen/gutschrift': 1,
      'finanzen/lieferantenrechnung': 1,
      'finanzen/rechnungsstellung': 1,
      'finanzen/zahlungslauf': 1,
      'logistik/shipping': 1,
      'logistik/speditionsversand': 1,
      'service/reklamation': 1,
      'service/returns': 1,
      'vertrieb/marketplace-order-import': 1,
      'vertrieb/order-handling': 2,
    });
    const relations = await getJson<RelationPage>(
      owner,
      `/api/v1/projects/${P}/relations?status=proposed&limit=200`,
    );
    const asked = relations.items.filter(
      (r) => r.provenance?.sourceKind === 'agent' && r.provenance.question !== null,
    );
    expect(asked.length).toBeGreaterThan(0);
    expect(
      afterSim
        .filter((q) => q.kind === 'agent-question' && q.subject.type === 'relation')
        .map((q) => q.subject.id)
        .sort(),
    ).toEqual(asked.map((r) => r.id).sort());
    // A current submission per model, each with the simulation agent's summary.
    expect(
      afterSim.filter((q) => q.kind === 'summary-note' && q.subject.type === 'model'),
    ).toHaveLength(31);

    // 2. The owner holds a relation an agent asked about, and a proposed placement.
    const target = asked[0] as Relation;
    const hold = await post(owner, `/api/v1/projects/${P}/relations/${target.id}/decision`, {
      verdict: 'hold',
      note: 'Mit dem Fachbereich klären.',
      question: '=Gilt diese Verbindung in jedem Fall?',
      label: 'mit Fachbereich klären',
    });
    expect(hold.status).toBe(200);
    const proposedPlacements = await getJson<PlacementPage>(
      owner,
      chainPath(P, '/placements?status=proposed&limit=200'),
    );
    const heldPlacement = proposedPlacements.items[0];
    if (!heldPlacement) throw new Error('the simulation agent proposed no placement');
    const holdPlacement = await post(
      owner,
      chainPath(P, `/placements/${heldPlacement.id}/decision`),
      { verdict: 'hold', note: 'Gehört das zur Logistik oder zum Vertrieb?' },
    );
    expect(holdPlacement.status).toBe(200);

    // 3. A model change; the probe agent analyses it again: two coded no-links, a
    // summary, everything else left unjudged.
    const xml = (
      await readFile(
        new URL(`../../../../eval/corpus/${P}/models/${ORDER}.bpmn`, import.meta.url),
        'utf8',
      )
    ).replace('name="Run fraud check"', 'name="Run external fraud check"');
    expect((await t.putModel(P, ORDER, xml)).status).toBe(200);
    const probeCall = asAgent(t, probe.secret);
    const [task] = await claim(probeCall, { projectId: P, modelKey: ORDER });
    if (!task) throw new Error('no relations task for the changed model');
    const callPair = task.input.candidates.find((c) => c[0] === 'call' && c[1] === FRAUD_CHECK);
    const messagePair = task.input.candidates.find(
      (c) => c[0] === 'message' && c[1] === SEND_CONFIRMATION,
    );
    if (!callPair || !messagePair) throw new Error('the probe found no call or message pair');
    const result = await submit(
      probeCall,
      task.taskId,
      submission(task, [], {
        llmModel: 'probe',
        noLinks: [
          {
            type: 'call',
            from: callPair[1],
            to: callPair[2],
            reason: 'call-target: Die Betrugsprüfung ist in keinem Modell beschrieben.',
          },
          {
            type: 'message',
            from: messagePair[1],
            to: messagePair[2],
            reason: 'collaboration: Die Bestätigung geht an den Kunden-Pool im eigenen Modell.',
          },
        ],
        summary: 'Process_FraudCheck fehlt in der Landschaft; die Bestätigung geht an den Kunden.',
      }),
    );
    expect(result.noLinks?.counts.stored).toBe(2);
    expect(result.uncovered?.count).toBeGreaterThan(0);

    // 4. The probe asks about a placement ad hoc (a label change of a call activity
    // leaves the process's placement input, and so its unsure verdict, as it was).
    const detail = await getJson<ValueChainDetail>(owner, chainPath(P));
    const step = detail.steps.find((x) => x.depth === 0)?.elementId;
    if (!step) throw new Error('the golden chain has no top-level step');
    const adHoc = await post(probeCall, chainPath(P, '/placements'), {
      kind: 'propose',
      llmModel: 'probe',
      placements: [
        {
          step,
          process: 'finanzen/mahnwesen#Process_Mahnwesen',
          confidence: 0.5,
          rationale: 'Die Dokumentation nennt den Schritt nur am Rande.',
          question: 'Gehört das Mahnwesen zu diesem Schritt?',
        },
      ],
    });
    expect(adHoc.status).toBe(200);

    const after = await listAll();
    report('after the simulation agent, holds and the probe agent', after);
    // The probe's two coded no-links join the rule tier's items about the same gaps (the
    // fraud check's finding, the customer's pool; UX2b review): 26, not 28.
    expect((await summary('&state=open')).totals).toEqual({
      ask: 26,
      agent: 19,
      proposal: 26,
      info: 32,
    });
    // Every source of §4.1 and the signals.
    // (the coded no-links joined the items about their gaps, below)
    expect(new Set(after.map((q) => q.source))).toEqual(
      new Set<OpenQuestionSource>([
        'finding',
        'value-chain-finding',
        'hold',
        'agent-question',
        'unsure',
        'summary',
        'unjudged',
        'signal',
      ]),
    );
    const one = (pred: (q: OpenQuestion) => boolean, what: string) => {
      const found = after.filter(pred);
      expect(found, what).toHaveLength(1);
      return found[0] as OpenQuestion;
    };
    expect(
      one((q) => q.kind === 'held' && q.subject.id === target.id, 'the held relation'),
    ).toMatchObject({
      source: 'hold',
      text: '=Gilt diese Verbindung in jedem Fall?',
      context: 'Mit dem Fachbereich klären.',
      label: 'mit Fachbereich klären',
      raisedBy: { sourceKind: 'human', handle: 'owner' },
    });
    expect(after.some((q) => q.kind === 'agent-question' && q.subject.id === target.id)).toBe(
      false,
    );
    expect(
      one((q) => q.kind === 'held' && q.subject.id === heldPlacement.id, 'the held placement'),
    ).toMatchObject({ text: 'Gehört das zur Logistik oder zum Vertrieb?', context: null });
    // The simulation agent's current unsure verdicts, as the chain lists them.
    const unsure = detail.unsure.filter((u) => u.current);
    expect(unsure.length).toBeGreaterThan(0);
    // The question from code, the agent's reason verbatim as the detail (UX2a).
    expect(
      after
        .filter((q) => q.kind === 'placement-unsure')
        .map((q) => [q.subject.id, q.detail, q.raisedBy.handle])
        .sort(),
    ).toEqual(unsure.map((u) => [u.process, u.reason, u.by]).sort());
    // The probe's question on its ad-hoc placement, next to the simulation agent's.
    expect(
      one(
        (q) =>
          q.kind === 'agent-question' &&
          q.subject.type === 'placement' &&
          q.text === 'Gehört das Mahnwesen zu diesem Schritt?',
        'the placement question',
      ),
    ).toMatchObject({
      refs: ['finanzen/mahnwesen#Process_Mahnwesen'],
      raisedBy: { sourceKind: 'agent' },
      askWho: { folder: 'finanzen' },
    });
    expect(
      after.filter((q) => q.kind === 'agent-question' && q.subject.type === 'placement').length,
    ).toBeGreaterThan(1);
    // One item per gap: the coded no-links join the finding on the call and the pool the
    // confirmation goes to, the agent's words attributed in the reason.
    expect(after.some((q) => q.source === 'no-link')).toBe(false);
    const fraud = one(
      (q) => q.kind === 'call-target-unknown' && q.subject.id === FRAUD_CHECK,
      'the fraud check, once',
    );
    expect(fraud).toMatchObject({
      source: 'finding',
      text: 'Welchen Prozess ruft „Run external fraud check“ auf?',
    });
    expect(fraud.detail).toMatch(
      /\nLaut Agent: call-target: Die Betrugsprüfung ist in keinem Modell beschrieben\.$/,
    );
    const customer = one(
      (q) => q.kind === 'black-box-partner' && q.refs.includes(SEND_CONFIRMATION),
      'the customer pool',
    );
    expect(customer.detail).toMatch(
      /\nLaut Agent: collaboration: Die Bestätigung geht an den Kunden-Pool im eigenen Modell\.$/,
    );
    expect(
      one((q) => q.kind === 'summary-note' && q.subject.id === ORDER, 'the probe summary').text,
    ).toBe('Process_FraudCheck fehlt in der Landschaft; die Bestätigung geht an den Kunden.');
    const chainSummary = one(
      (q) => q.kind === 'summary-note' && q.subject.type === 'value-chain',
      'chain summary',
    );
    expect(chainSummary).toMatchObject({ subject: { id: 'main' }, modelKeys: [] });
    // The chain's open decisions: at least the held placement.
    expect(chainSummary.unlocks).toBeGreaterThan(0);
    // Informational items last.
    const firstInformational = after.findIndex((q) => isInformationalKind(q.kind));
    expect(after.slice(firstInformational).every((q) => isInformationalKind(q.kind))).toBe(true);
    const unjudged = one((q) => q.kind === 'unjudged', 'the pairs left unjudged');
    expect(unjudged.subject).toEqual({ type: 'model', id: ORDER });
    expect(unjudged.askWho.folder).toBe('vertrieb');
    expect(unjudged.refs.length).toBeGreaterThan(0);
    expect(unjudged.text).toMatch(/^Gehör(t dieses Paar|en diese Paare) zusammen\?$/);
    expect(unjudged.detail).toMatch(/^Die Analyse von /);

    // Ids: stable across reads; new for the items about what changed (the renamed fraud
    // check) and the new hold, the same for everything else, also the other items of the
    // changed model (M6 S5c-1: items are versioned by what they ask about).
    expect(await listAll()).toEqual(after);
    const seededFinding = seeded.find(
      (q) => q.source === 'finding' && q.subject.id === FRAUD_CHECK,
    );
    const afterFinding = after.find((q) => q.source === 'finding' && q.subject.id === FRAUD_CHECK);
    expect(afterFinding?.id).toBeDefined();
    expect(afterFinding?.id).not.toBe(seededFinding?.id);
    // Findings and signals still there: a new id exactly for the renamed call's.
    const key = (q: OpenQuestion) => `${q.source} ${q.kind} ${q.subject.type} ${q.subject.id}`;
    const now = new Map(after.map((q) => [key(q), q.id]));
    let kept = 0;
    let inOrder = 0;
    for (const q of seeded.filter((x) => x.source === 'finding' || x.source === 'signal')) {
      const id = now.get(key(q));
      if (id === undefined) continue;
      kept++;
      if (q.subject.id === FRAUD_CHECK) expect(id, key(q)).not.toBe(q.id);
      else expect(id, key(q)).toBe(q.id);
      if (q.modelKeys.includes(ORDER) && q.subject.id !== FRAUD_CHECK) inOrder++;
    }
    expect(kept).toBeGreaterThan(10);
    expect(inOrder).toBeGreaterThan(0);
    expect(after.find((q) => q.subject.id === CARRIER)?.id).toBe(
      seeded.find((q) => q.subject.id === CARRIER)?.id,
    );
    // The exports round trip. Without a group the export holds what needs clarifying only
    // (UX2a, owner decision 26: not the agents' questions), under the old file name, in list
    // order, the answer column empty, the hold's question (it starts with "=") protected in
    // the file and exact when read back.
    const questions = after.filter((q) => q.group === 'ask');
    const csvRes = await t.asToken(viewer.secret, `${BASE}/export?format=csv`);
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(csvRes.headers.get('content-disposition')).toBe(
      `attachment; filename="offene-fragen-${P}.csv"`,
    );
    const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await csvRes.arrayBuffer());
    expect(csv.startsWith('\uFEFF"id";"Art";"Frage";"Ansprechpartner";"Antwort"\r\n')).toBe(true);
    expect(csv).toContain(`"'=Gilt diese Verbindung in jedem Fall?`);
    const parsed = parseOpenQuestionsCsv(csv);
    expect(parsed.header).toEqual([...OPEN_QUESTION_CSV_COLUMNS]);
    expect(parsed.rows.map((r) => r[0])).toEqual(questions.map((q) => q.id));
    expect(parsed.rows.every((r) => r.length === 5 && r[4] === '')).toBe(true);
    // The question, its reason (an unsure verdict's attributed: „Laut Agent: …“), „Betrifft“.
    for (const [i, row] of parsed.rows.entries()) {
      const q = questions[i];
      const detail = q ? detailText(q) : null;
      expect(row[2]?.startsWith(detail ? `${q?.text} ${detail}` : (q?.text ?? '?'))).toBe(true);
    }
    expect(
      parsed.rows.some((r) => r[1] === 'Einordnung unsicher' && r[2]?.includes('? Laut Agent: ')),
    ).toBe(true);
    // The id regex of the UI load guard finds nothing in the sheet's visible columns.
    expect(parsed.rows.map((r) => r.slice(1).join('\n')).join('\n')).not.toMatch(ID_IN_TEXT);
    // „Auch Fragen der Agenten“: both groups, in list order, the groups in the file name.
    const withAgents = await t.asOwner(`${BASE}/export?format=csv&group=ask&group=agent`);
    expect(withAgents.headers.get('content-disposition')).toBe(
      `attachment; filename="offene-fragen-${P}-ask-agent.csv"`,
    );
    expect(parseOpenQuestionsCsv(await withAgents.text()).rows.map((r) => r[0])).toEqual(
      after.filter((q) => q.group === 'ask' || q.group === 'agent').map((q) => q.id),
    );
    // A kind names what to export: the agents' questions are not left out by the default.
    const agentOnly = parseOpenQuestionsCsv(
      await (await t.asOwner(`${BASE}/export?format=csv&kind=agent-question`)).text(),
    );
    expect(agentOnly.rows.map((r) => r[0])).toEqual(
      after.filter((q) => q.kind === 'agent-question').map((q) => q.id),
    );
    const heldOnly = await listAll('&kind=held');
    expect(heldOnly).toHaveLength(2);
    const md = await t.asOwner(`${BASE}/export?kind=held`);
    expect(md.status).toBe(200);
    expect(md.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    // The file name carries the filter.
    expect(md.headers.get('content-disposition')).toBe(
      `attachment; filename="offene-fragen-${P}-held.md"`,
    );
    const text = await md.text();
    expect(text.startsWith(`# Offene Fragen: ${P}\n`)).toBe(true);
    expect(text).toContain('Filter: Art „Vorgemerkt“.');
    expect(text).toContain('\n\\=Gilt diese Verbindung in jedem Fall?\n');
    // The id as an HTML comment after each heading only.
    for (const q of heldOnly) expect(text).toMatch(new RegExp(`^### .*\\n<!-- ${q.id} -->$`, 'm'));
    expect(text.match(/^### /gm)).toHaveLength(2);
    const all = await (await t.asOwner(`${BASE}/export?format=markdown`)).text();
    // A date, „Betrifft“ in names, no folder, no refs, no seq, no source, no „Kennung“.
    expect(all).toMatch(
      /\nStand \d{2}\.\d{2}\.\d{4}: \d+ offene Fragen, nach Ansprechpartner gruppiert\.\n/,
    );
    expect(all).toContain(
      '- Betrifft: „Run external fraud check“ in „Nordwind Online Shop – Order handling“\n',
    );
    expect(all).not.toMatch(
      /Kennung|- Quelle|Offene Entscheidungen|Bezug|Ordner:|vertrieb\/order-handling#/,
    );
    for (const q of questions) expect(all).toContain(`<!-- ${q.id} -->`);
    expect(all.match(/^### /gm)).toHaveLength(questions.length);
    expect(all.replace(/<!-- q-[0-9a-f]{16} -->/g, '')).not.toMatch(ID_IN_TEXT);

    // A new hold decision: a new id for that item only.
    const heldId = after.find((q) => q.kind === 'held' && q.subject.id === target.id)?.id;
    const again = await post(owner, `/api/v1/projects/${P}/relations/${target.id}/decision`, {
      verdict: 'hold',
      note: 'Weiter offen.',
    });
    expect(again.status).toBe(200);
    const rehold = await listAll();
    const reheld = rehold.find((q) => q.kind === 'held' && q.subject.id === target.id);
    expect(reheld?.id).not.toBe(heldId);
    expect(reheld?.text).toBe('Weiter offen.');
    expect(rehold.filter((q) => q.subject.id !== target.id).map((q) => q.id)).toEqual(
      after.filter((q) => q.subject.id !== target.id).map((q) => q.id),
    );
  }, 120_000);
});

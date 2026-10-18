/**
 * Model amendments end to end (M6 §4.8 c, S5c-2) with the real libraries and
 * a real PostgreSQL: synthetic models (`test/support/amend-fixtures.ts`)
 * amended through REST, imported again, withdrawn, deleted and revived.
 * Requires (§8 "S5c-2"):
 * - an amendment makes an amended head whose facts read the value, whose
 *   `source` names the uploaded revision and the plan, on which the rule tier
 *   accepts a unique call (decision 9), and which queues the model's
 *   relations task; a manual link from the call to the same target is
 *   retired; a missing `If-Match` gives 428, a stale one 412; the dry run
 *   writes nothing and names the findings it would resolve, the pairs to
 *   re-judge and a claimed task; a name picked with `partner` accepts the
 *   key-tier proposal; two endpoints of one message hold one live
 *   amendment; a review-only scope gets 403 `insufficient-scope`, an agent
 *   `human-decision-required`; a field no question names is refused
 *   („Nur für offene Fragen“);
 * - re-import: the same bytes are `unchanged` (also the downloaded amended
 *   file, also one downloaded before later amendments); a change elsewhere
 *   gives the uploaded revision plus an amended head with the amendments
 *   applied, the head with the highest seq, and `hashesAt` at a partner
 *   claim's `claimedSeq` returns the amended head's `facts_hash`; an incoming
 *   value equal to `after` is „im Quellsystem übernommen“, writes no amended
 *   revision when nothing else applies and re-applies when a later import
 *   brings back `before`; incoming documentation ends a documentation
 *   amendment without a conflict; an incoming expression is the conflict
 *   `expression` with the withdrawal only; any other value one
 *   `amendment-conflict` item whose „Meine Ergänzung behalten“ and „Wert aus
 *   dem Quellsystem übernehmen“ work; a removed element `element-missing`;
 *   with a conflict live a new amendment elsewhere succeeds and leaves it
 *   open; an amendment recorded while an import is being extracted is in the
 *   head after the import; the import and PUT results carry `amendments`
 *   only for models with live amendments;
 * - withdrawal writes an amended revision without it, with none left the
 *   uploaded bytes; withdrawing all of a model writes one revision; on a
 *   deleted model a withdrawal writes no revision and leaves `hashesAt`
 *   unchanged, and the amendment routes answer 404; revival re-derives; the
 *   change list (Markdown, CSV) lists every state, groups per model and
 *   honours `since`; both downloads return the expected bytes;
 * - the corpus import results keep their shape.
 */
import {
  AmendModelResult,
  AmendableElement,
  ModelAmendmentList,
  OpenQuestionPage,
  PutModelResult,
  WithdrawAmendmentsResult,
  type CreatedAgentToken,
  type ModelAmendment,
  type OpenQuestion,
  type ProjectId,
  type Relation,
  type RelationAssertionList,
  type RelationPage,
  type Revision,
  type RevisionFacts,
  type RevisionPage,
} from '@analyzr/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { libraryAnalysis } from '../../src/analysis.ts';
import { createStore } from '../../src/db/store.ts';
import { DomainError } from '../../src/domain/errors.ts';
import type { AnalysisPort } from '../../src/domain/ports.ts';
import { PARTNER_RATIONALE, RETIRED_BY_CALL } from '../../src/domain/use-cases/amendments.ts';
import {
  AUFTRAG_KEY,
  LAGER_KEY,
  RECHNUNG_KEY,
  VERSAND_KEY,
  auftrag,
  bestellung,
  lager,
  rechnung,
  versand,
} from '../support/amend-fixtures.ts';
import { startTestApp, type TestApp } from '../support/app.ts';
import { corpusFiles, importAll } from '../support/corpus.ts';
import { createTestDatabase, type TestDatabase } from '../support/db.ts';
import { asAgent, claim, post, submission, submit } from '../support/pipeline.ts';

const P = 'amend';
const API = `/api/v1/projects/${P}`;
const BESTELLUNG_KEY = 'einkauf/bestellung';
const CALL = `${AUFTRAG_KEY}#Call_Rechnung`;
const CALL_VERSAND = `${AUFTRAG_KEY}#Call_Versand`;
const PROCESS_RECHNUNG = `${RECHNUNG_KEY}#Process_Rechnung`;
const PROCESS_VERSAND = `${VERSAND_KEY}#Process_Versand`;
const BESTAETIGUNG = `${AUFTRAG_KEY}#Event_Bestaetigung`;
const PARTNER = `${RECHNUNG_KEY}#Task_Bestaetigung`;

let database: TestDatabase;
let t: TestApp;
let agent: CreatedAgentToken;
let projectId: ProjectId;
const ids = new Map<string, string>();
/** The extraction gate of the race test: the next extract of `key` waits for `release`. */
let gate: { key: string; started: () => void; release: Promise<void> } | null = null;

const gated: AnalysisPort = {
  ...libraryAnalysis,
  async extract(xml, modelKey) {
    if (gate?.key === modelKey) {
      const g = gate;
      gate = null;
      g.started();
      await g.release;
    }
    return libraryAnalysis.extract(xml, modelKey);
  },
};

const owner = (path: string, init?: RequestInit) => t.asOwner(path, init);
const modelId = (key: string): string => {
  const id = ids.get(key);
  if (!id) throw new Error(`no model ${key}`);
  return id;
};

async function getJson<T>(path: string): Promise<T> {
  const res = await owner(path);
  if (res.status !== 200) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function put(key: string, xml: string, status?: number): Promise<PutModelResult> {
  const res = await t.putModel(P, key, xml);
  const text = await res.text();
  if (status !== undefined) expect(res.status, text.slice(0, 600)).toBe(status);
  else expect(res.status, text.slice(0, 600)).toBeLessThan(300);
  const result = PutModelResult.parse(JSON.parse(text));
  ids.set(key, result.model.id);
  return result;
}

async function head(key: string): Promise<{ rev: number; id: string }> {
  const m = await getJson<{ headRev: number; headRevisionId: string }>(
    `${API}/models/${modelId(key)}`,
  );
  return { rev: m.headRev, id: m.headRevisionId };
}

/** POST …/amendments with `If-Match` of the current head (or `rev`), checked against the contract. */
async function amend(
  key: string,
  items: unknown[],
  opts: { rev?: number | null; dryRun?: boolean; status?: number } = {},
): Promise<{ status: number; body: unknown }> {
  const rev = opts.rev === undefined ? (await head(key)).rev : opts.rev;
  const res = await owner(
    `${API}/models/${modelId(key)}/amendments${opts.dryRun ? '?dryRun=true' : ''}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(rev === null ? {} : { 'if-match': `"r${rev}"` }),
      },
      body: JSON.stringify({ items }),
    },
  );
  const text = await res.text();
  if (opts.status !== undefined) expect(res.status, text.slice(0, 800)).toBe(opts.status);
  return { status: res.status, body: JSON.parse(text) as unknown };
}

async function amended(key: string, items: unknown[]): Promise<AmendModelResult> {
  const { body } = await amend(key, items, { status: 201 });
  return AmendModelResult.parse(body);
}

async function amendable(key: string, elementId: string) {
  const res = await owner(`${API}/models/${modelId(key)}/elements/${elementId}/amendable`);
  expect(res.status, await res.clone().text()).toBe(200);
  return { etag: res.headers.get('etag'), body: AmendableElement.parse(await res.json()) };
}

async function questions(): Promise<OpenQuestion[]> {
  const page = OpenQuestionPage.parse(await getJson(`${API}/open-questions?limit=200`));
  expect(page.nextCursor).toBeNull();
  return page.items;
}

function find(items: readonly OpenQuestion[], pred: (q: OpenQuestion) => boolean, what: string) {
  const found = items.filter(pred);
  expect(found, what).toHaveLength(1);
  return found[0] as OpenQuestion;
}

async function revisions(key: string): Promise<Revision[]> {
  return (await getJson<RevisionPage>(`${API}/models/${modelId(key)}/revisions?limit=200`)).items;
}

async function content(key: string, revisionId: string): Promise<string> {
  const res = await owner(`${API}/models/${modelId(key)}/revisions/${revisionId}/content`);
  expect(res.status).toBe(200);
  return res.text();
}

async function facts(key: string, revisionId: string): Promise<RevisionFacts> {
  return getJson<RevisionFacts>(`${API}/models/${modelId(key)}/revisions/${revisionId}/facts`);
}

async function headFact(key: string, elementId: string, kind: string) {
  const h = await head(key);
  return (await facts(key, h.id)).facts.find((f) => f.elementId === elementId && f.kind === kind);
}

async function amendments(query = ''): Promise<ModelAmendment[]> {
  return ModelAmendmentList.parse(await getJson(`${API}/amendments${query}`)).items;
}

async function relations(): Promise<Relation[]> {
  const live = (await getJson<RelationPage>(`${API}/relations?limit=200`)).items;
  return live;
}

async function count(table: string): Promise<number> {
  const r = await database.db.execute<{ n: string }>(
    sql.raw(`SELECT count(*)::text AS n FROM ${table} WHERE project_id = '${projectId}'`),
  );
  return Number(r.rows[0]?.n);
}

async function eventTypes(afterSeq: number): Promise<string[]> {
  const r = await database.db.execute<{ type: string }>(
    sql`SELECT type FROM event WHERE project_id = ${projectId} AND seq > ${afterSeq} ORDER BY seq`,
  );
  return r.rows.map((x) => x.type);
}

async function lastSeq(): Promise<number> {
  const r = await database.db.execute<{ last_seq: string }>(
    sql`SELECT last_seq FROM project WHERE id = ${projectId}`,
  );
  return Number(r.rows[0]?.last_seq);
}

async function withdraw(path: string, status = 201): Promise<WithdrawAmendmentsResult> {
  const res = await post(owner, path, {});
  const text = await res.text();
  expect(res.status, text.slice(0, 600)).toBe(status);
  return WithdrawAmendmentsResult.parse(JSON.parse(text));
}

beforeAll(async () => {
  database = await createTestDatabase();
  t = startTestApp(database, { analysis: gated });
  projectId = (await t.createProject(P, 'Ergänzungen')).id;
  await put(AUFTRAG_KEY, auftrag(), 201);
  await put(RECHNUNG_KEY, rechnung(), 201);
  await put(LAGER_KEY, lager(), 201);
  await put(VERSAND_KEY, versand(), 201);
  await put(BESTELLUNG_KEY, bestellung(), 201);
  agent = await t.createToken(P, ['analyzr:read', 'analyzr:propose']);
}, 120_000);

afterAll(async () => {
  await database?.drop();
});

describe('amendments at the open questions', () => {
  it('offers the amendments the questions name', async () => {
    const items = await questions();
    const lines = (q: OpenQuestion) => q.actions.map((a) => `${a.type}${a.primary ? '*' : ''}`);
    const call = find(items, (q) => q.subject.id === CALL && q.source === 'finding', 'the call');
    expect(lines(call)).toEqual(['amend*', 'link', 'outside', 'note']);
    expect(call.actions[0]?.amend).toEqual({
      modelId: modelId(AUFTRAG_KEY),
      modelKey: AUFTRAG_KEY,
      targets: [
        {
          elementId: 'Call_Rechnung',
          op: 'call-target',
          label: 'Aufrufaktivität „Rechnung stellen“',
        },
      ],
    });
    const versandCall = find(items, (q) => q.subject.id === CALL_VERSAND, 'the Versand call');
    expect(lines(versandCall)).toEqual(['link*', 'amend', 'outside', 'note']);
    const nameless = find(items, (q) => q.subject.id === BESTAETIGUNG, 'the nameless throw');
    expect(lines(nameless)).toEqual(['amend*', 'link', 'outside', 'note']);
    const boundary = find(
      items,
      (q) => q.kind === 'unlabelled-boundary' && q.subject.id === `${AUFTRAG_KEY}#Process_Auftrag`,
      'the unnamed start',
    );
    expect(boundary.actions[0]?.amend?.targets).toEqual([
      { elementId: 'Start_Auftrag', op: 'event-name', label: 'Startereignis „Start_Auftrag“' },
    ]);
    const undocumented = find(
      items,
      (q) => q.kind === 'undocumented-process' && q.subject.id === `${LAGER_KEY}#Process_Lager`,
      'the undocumented process',
    );
    expect(lines(undocumented)).toEqual(['amend*', 'note']);
  });

  it('shows the amendable fields of an element with the ETag of the head', async () => {
    const { etag, body } = await amendable(AUFTRAG_KEY, 'Call_Rechnung');
    expect(etag).toBe('"r1"');
    expect(body).toMatchObject({ headRev: 1, elementId: 'Call_Rechnung', history: [] });
    expect(body.fields).toHaveLength(1);
    expect(body.fields[0]).toMatchObject({
      op: 'call-target',
      elementId: 'Call_Rechnung',
      viaElementId: null,
      element: 'call',
      value: '',
      uploadedValue: '',
      settable: true,
      reason: null,
      live: null,
    });
    const processes = body.fields[0]?.suggestions.processes ?? [];
    expect(processes.map((p) => p.ref)).toContain(PROCESS_RECHNUNG);
    // Not the caller's own process.
    expect(processes.map((p) => p.ref)).not.toContain(`${AUFTRAG_KEY}#Process_Auftrag`);
    // A receive task of a shared message keys the message, read by both tasks.
    const zahlung = (await amendable(AUFTRAG_KEY, 'Task_Zahlung')).body;
    expect(zahlung.fields[0]).toMatchObject({
      op: 'message-name',
      elementId: 'Message_Zahlung',
      viaElementId: 'Task_Zahlung',
      element: 'message',
      value: 'Zahlung eingegangen',
      settable: true,
      readers: [`${AUFTRAG_KEY}#Task_Mahnung`, `${AUFTRAG_KEY}#Task_Zahlung`],
    });
    // A labelled end event no question names, and the tool's documentation.
    const end = (await amendable(AUFTRAG_KEY, 'End_Auftrag')).body;
    expect(end.fields[0]).toMatchObject({ settable: false, reason: 'only-open-questions' });
    const process = (await amendable(AUFTRAG_KEY, 'Process_Auftrag')).body;
    expect(process.fields[0]).toMatchObject({ settable: false, reason: 'has-documentation' });
    const missing = await owner(
      `${API}/models/${modelId(AUFTRAG_KEY)}/elements/Nirgends/amendable`,
    );
    expect(missing.status).toBe(404);
  });

  it('refuses a field no question names („Nur für offene Fragen“), also in a dry run', async () => {
    const dry = AmendModelResult.parse(
      (
        await amend(
          AUFTRAG_KEY,
          [{ elementId: 'End_Auftrag', op: 'event-name', after: 'Fertig' }],
          {
            dryRun: true,
            status: 200,
          },
        )
      ).body,
    );
    expect(dry).toMatchObject({
      dryRun: true,
      outcome: 'unchanged',
      items: [{ outcome: 'not-applicable', reason: 'only-open-questions' }],
    });
    const { body } = await amend(
      AUFTRAG_KEY,
      [{ elementId: 'End_Auftrag', op: 'event-name', after: 'Fertig' }],
      { status: 422 },
    );
    expect(body).toMatchObject({
      code: 'validation-failed',
      reason: 'amendment-not-applicable',
      items: [{ outcome: 'not-applicable', reason: 'only-open-questions' }],
    });
  });

  it('needs If-Match: 428 without it, 412 for a stale one', async () => {
    const item = { elementId: 'Call_Rechnung', op: 'call-target', target: PROCESS_RECHNUNG };
    const missing = await amend(AUFTRAG_KEY, [item], { rev: null, status: 428 });
    expect(missing.body).toMatchObject({ code: 'precondition-required' });
    const stale = await amend(AUFTRAG_KEY, [item], { rev: 7, status: 412 });
    expect(stale.body).toMatchObject({ code: 'revision-conflict', headRev: 1 });
  });

  it('previews the effect and the cost and writes nothing', async () => {
    const item = { elementId: 'Call_Rechnung', op: 'call-target', target: PROCESS_RECHNUNG };
    // An agent works on the caller: the cost names the claimed task.
    const [claimed] = await claim(asAgent(t, agent.secret), {
      projectId: P,
      modelKey: AUFTRAG_KEY,
    });
    if (!claimed) throw new Error('no task for the caller');
    const before = await lastSeq();
    const dry = AmendModelResult.parse(
      (await amend(AUFTRAG_KEY, [item], { dryRun: true, status: 200 })).body,
    );
    expect(dry).toMatchObject({
      dryRun: true,
      outcome: 'recorded',
      revision: null,
      items: [
        {
          outcome: 'recorded',
          amendmentElementId: 'Call_Rechnung',
          after: 'Process_Rechnung',
          before: '',
        },
      ],
      cost: { factsChange: true, pairsToRejudge: 0, taskClaimed: true },
    });
    expect(dry.effect.findingsResolved).toEqual([
      expect.objectContaining({ kind: 'unresolved-call', refs: [CALL] }),
    ]);
    expect(dry.effect.accepted).toEqual([
      { relation: null, type: 'call', from: CALL, to: PROCESS_RECHNUNG },
    ]);
    expect(await lastSeq()).toBe(before);
    expect(await count('model_amendment')).toBe(0);
    // The agent judges its pairs: now the cost names them.
    const noLinks = claimed.input.candidates.map(([type, from, to]) => ({
      type,
      from,
      to,
      reason: 'no-evidence: nicht verbunden',
    }));
    const done = await submit(asAgent(t, agent.secret), claimed.taskId, {
      ...submission(claimed, []),
      noLinks,
    });
    expect(done.noLinks?.items.some((i) => i.result === 'stored')).toBe(true);
    const again = AmendModelResult.parse(
      (await amend(AUFTRAG_KEY, [item], { dryRun: true, status: 200 })).body,
    );
    expect(again.cost.taskClaimed).toBe(false);
    expect(again.cost.pairsToRejudge).toBeGreaterThan(0);
  });

  it('amends a call: an amended head on the uploaded revision, the call accepted, the manual link retired', async () => {
    // A human linked the call first („Nur verknüpfen …“).
    const item = find(await questions(), (q) => q.subject.id === CALL, 'the call');
    const linked = await post(owner, `${API}/open-questions/${item.id}/actions`, {
      type: 'link',
      targets: [PROCESS_RECHNUNG],
    });
    expect(linked.status, await linked.clone().text()).toBe(201);
    const uploaded = await head(AUFTRAG_KEY);
    const before = await lastSeq();
    const result = await amended(AUFTRAG_KEY, [
      { elementId: 'Call_Rechnung', op: 'call-target', target: PROCESS_RECHNUNG },
    ]);
    const amendment = result.items[0]?.amendment;
    expect(amendment).toMatchObject({
      elementId: 'Call_Rechnung',
      op: 'call-target',
      before: '',
      after: 'Process_Rechnung',
      baseRevisionId: uploaded.id,
      state: 'applied',
      by: 'owner',
    });
    const revision = result.revision;
    expect(revision).toMatchObject({
      rev: 2,
      source: {
        kind: 'amendment',
        uploader: 'human',
        upstream: { revisionId: uploaded.id, rev: 1 },
        amendments: [
          { id: amendment?.id, elementId: 'Call_Rechnung', op: 'call-target', outcome: 'applied' },
        ],
      },
    });
    expect(result.model.headRev).toBe(2);
    // Its own events: model.amended, then the amended revision's model.revised.
    expect((await eventTypes(before)).slice(0, 2)).toEqual(['model.amended', 'model.revised']);
    // The head's facts read the value; the bytes are the uploaded ones with one attribute.
    expect((await headFact(AUFTRAG_KEY, 'Call_Rechnung', 'call'))?.keyRaw).toBe('Process_Rechnung');
    const bytes = await content(AUFTRAG_KEY, revision?.id ?? '');
    expect(bytes).toBe(
      auftrag().replace(
        '<bpmn:callActivity id="Call_Rechnung" name="Rechnung stellen" />',
        '<bpmn:callActivity id="Call_Rechnung" name="Rechnung stellen" calledElement="Process_Rechnung" />',
      ),
    );
    // Decision 9: the unique call is accepted by the rule tier; the manual link is retired.
    const all = await relations();
    expect(all.find((r) => r.type === 'call' && r.from === CALL)).toMatchObject({
      to: PROCESS_RECHNUNG,
      status: 'accepted',
      tier: 'rule',
    });
    const manualLink = all.find((r) => r.type === 'manual' && r.from === CALL);
    expect(manualLink).toMatchObject({ to: PROCESS_RECHNUNG, status: 'rejected' });
    const timeline = await getJson<RelationAssertionList>(
      `${API}/relations/${manualLink?.id}/assertions`,
    );
    expect(timeline.items.at(-1)).toMatchObject({
      kind: 'decision',
      verdict: 'reject',
      sourceKind: 'human',
      rationale: RETIRED_BY_CALL,
    });
    // The new head queued the caller's relations task.
    const tasks = await database.db.execute<{ state: string; facts_hash: string }>(
      sql`SELECT t.state, t.facts_hash FROM analysis_task t JOIN model m ON m.id = t.model_id
          WHERE m.key = ${AUFTRAG_KEY} AND t.project_id = ${projectId} ORDER BY t.seq DESC LIMIT 1`,
    );
    expect(tasks.rows[0]).toEqual({ state: 'queued', facts_hash: revision?.factsHash });
    // The question is answered by the model: gone.
    expect((await questions()).some((q) => q.subject.id === CALL)).toBe(false);
    // The element's history and live amendment.
    const after = (await amendable(AUFTRAG_KEY, 'Call_Rechnung')).body;
    expect(after.headRev).toBe(2);
    expect(after.fields[0]).toMatchObject({
      value: 'Process_Rechnung',
      uploadedValue: '',
      settable: true,
      live: { id: amendment?.id },
    });
    expect(after.history.map((h) => h.id)).toEqual([amendment?.id]);
  });

  it('keeps one live amendment for two endpoints of one message', async () => {
    const first = await amended(AUFTRAG_KEY, [
      { elementId: 'Task_Zahlung', op: 'message-name', after: 'Zahlung  erhalten\r\n' },
    ]);
    expect(first.items[0]).toMatchObject({
      outcome: 'recorded',
      amendmentElementId: 'Message_Zahlung',
      after: 'Zahlung erhalten',
      amendment: { elementId: 'Message_Zahlung', viaElementId: 'Task_Zahlung' },
    });
    const second = await amended(AUFTRAG_KEY, [
      {
        elementId: 'Task_Mahnung',
        op: 'message-name',
        after: 'Zahlungseingang',
        replaces: first.items[0]?.amendment?.id,
      },
    ]);
    expect(second.items[0]).toMatchObject({
      supersedes: first.items[0]?.amendment?.id,
      amendment: { elementId: 'Message_Zahlung', viaElementId: 'Task_Mahnung' },
    });
    const listed = (await amendments(`?modelKey=${AUFTRAG_KEY}`)).filter(
      (a) => a.op === 'message-name' && a.elementId === 'Message_Zahlung',
    );
    expect(listed.map((a) => a.state)).toEqual(['superseded', 'applied']);
    expect(listed[0]?.withdrawal).toMatchObject({ reason: 'superseded', by: 'owner' });
    for (const task of ['Task_Zahlung', 'Task_Mahnung']) {
      expect((await headFact(AUFTRAG_KEY, task, 'msg_catch'))?.attrs.messageName).toBe(
        'Zahlungseingang',
      );
    }
    // A stale `replaces` is a conflict.
    const stale = await amend(
      AUFTRAG_KEY,
      [
        {
          elementId: 'Task_Zahlung',
          op: 'message-name',
          after: 'Anders',
          replaces: first.items[0]?.amendment?.id,
        },
      ],
      { status: 409 },
    );
    expect(stale.body).toMatchObject({ code: 'conflict' });
  });

  it('accepts the key-tier proposal of a partner picked with the name', async () => {
    const result = await amended(AUFTRAG_KEY, [
      {
        elementId: 'Event_Bestaetigung',
        op: 'message-name',
        after: 'Auftrag bestätigt',
        partner: PARTNER,
      },
    ]);
    expect(result.effect.partnerAccepted).toEqual([
      expect.objectContaining({ type: 'message', from: BESTAETIGUNG, to: PARTNER }),
    ]);
    const relation = (await relations()).find(
      (r) => r.type === 'message' && r.from === BESTAETIGUNG && r.to === PARTNER,
    );
    expect(relation).toMatchObject({ status: 'accepted', tier: 'key' });
    const timeline = await getJson<RelationAssertionList>(
      `${API}/relations/${relation?.id}/assertions`,
    );
    expect(timeline.items.at(-1)).toMatchObject({
      kind: 'decision',
      verdict: 'accept',
      sourceKind: 'human',
      rationale: PARTNER_RATIONALE,
    });
    // The endpoint had no message: a new one, referenced by its event definition.
    const bytes = await content(AUFTRAG_KEY, result.revision?.id ?? '');
    expect(bytes).toMatch(/<bpmn:message id="Message_[0-9a-f]{8}" name="Auftrag bestätigt" \/>/);
    expect(bytes).toMatch(
      /<bpmn:messageEventDefinition id="MED_Best" messageRef="Message_[0-9a-f]{8}" \/>/,
    );
  });

  it('names an unnamed start and documents a process', async () => {
    const start = await amended(AUFTRAG_KEY, [
      { elementId: 'Start_Auftrag', op: 'event-name', after: 'Auftrag eingegangen' },
    ]);
    expect(start.items[0]).toMatchObject({ outcome: 'recorded' });
    expect((await headFact(AUFTRAG_KEY, 'Start_Auftrag', 'evt_start'))?.label).toBe(
      'Auftrag eingegangen',
    );
    const doc = await amended(LAGER_KEY, [
      {
        elementId: 'Process_Lager',
        op: 'process-documentation',
        after: 'Lagert Ware ein. Kontakt: lager@example.org',
      },
    ]);
    expect(doc.items[0]?.warnings).toEqual([expect.objectContaining({ kind: 'email' })]);
    expect((await headFact(LAGER_KEY, 'Process_Lager', 'process'))?.attrs.documentation).toBe(
      'Lagert Ware ein. Kontakt: lager@example.org',
    );
    expect(
      (await questions()).some(
        (q) => q.kind === 'undocumented-process' && q.subject.id === `${LAGER_KEY}#Process_Lager`,
      ),
    ).toBe(false);
  });

  it('keeps writes to humans with both permissions', async () => {
    const item = { elementId: 'Call_Versand', op: 'call-target', target: PROCESS_VERSAND };
    const rev = (await head(AUFTRAG_KEY)).rev;
    const res = await t.asToken(agent.secret, `${API}/models/${modelId(AUFTRAG_KEY)}/amendments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'if-match': `"r${rev}"` },
      body: JSON.stringify({ items: [item] }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      code: 'human-decision-required',
      reviewUrl: expect.stringContaining(`/projects/${P}/open-questions`) as unknown,
    });
    const withdrawn = await t.asToken(
      agent.secret,
      `${API}/models/${modelId(AUFTRAG_KEY)}/amendments/withdrawal`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
    );
    expect(withdrawn.status).toBe(403);
    // A human whose scopes grant review but not write.
    const reviewer = {
      ...(await t.useCases.localOwnerActor('analyzr-web')),
      scopes: ['analyzr:review' as const],
    };
    await expect(
      t.useCases.amendModel(
        reviewer,
        P,
        modelId(AUFTRAG_KEY) as never,
        { items: [item] } as never,
        rev,
      ),
    ).rejects.toSatisfy((err) => err instanceof DomainError && err.code === 'insufficient-scope');
    await expect(
      t.useCases.withdrawModelAmendments(reviewer, P, modelId(AUFTRAG_KEY) as never),
    ).rejects.toSatisfy((err) => err instanceof DomainError && err.code === 'insufficient-scope');
  });
});

describe('re-import of amended models', () => {
  let earlyDownload = '';

  it('leaves the same bytes unchanged: the upload, the amended head, an earlier download', async () => {
    const revs = await revisions(AUFTRAG_KEY);
    const uploaded = revs.find((r) => r.rev === 1);
    const amendedEarly = revs.find((r) => r.rev === 2);
    earlyDownload = await content(AUFTRAG_KEY, amendedEarly?.id ?? '');
    const h = await head(AUFTRAG_KEY);
    for (const xml of [auftrag(), await content(AUFTRAG_KEY, h.id), earlyDownload]) {
      const result = await put(AUFTRAG_KEY, xml, 200);
      expect(result.outcome).toBe('unchanged');
      expect(result.revision.id).toBe(h.id);
      expect(result.amendments).toMatchObject({ applied: { count: 4 }, conflicts: { count: 0 } });
    }
    expect((await revisions(AUFTRAG_KEY)).length).toBe(revs.length);
    expect(uploaded?.source.kind).toBe('upload');
  });

  it('re-applies the amendments to a change elsewhere: uploaded revision, amended head on top', async () => {
    const before = await revisions(AUFTRAG_KEY);
    const result = await put(AUFTRAG_KEY, auftrag({ taskName: 'Auftrag sorgfältig prüfen' }), 200);
    expect(result.outcome).toBe('revised');
    expect(result.uploadedRevisionId).toBeDefined();
    expect(result.amendments).toMatchObject({
      applied: { count: 4 },
      inSource: { count: 0 },
      conflicts: { count: 0 },
    });
    const revs = await revisions(AUFTRAG_KEY);
    expect(revs.length).toBe(before.length + 2);
    const [newest, uploaded] = revs;
    expect(uploaded).toMatchObject({ id: result.uploadedRevisionId, source: { kind: 'upload' } });
    expect(newest).toMatchObject({
      id: result.revision.id,
      rev: (uploaded?.rev ?? 0) + 1,
      source: { kind: 'amendment', upstream: { revisionId: uploaded?.id } },
    });
    expect((newest?.seq ?? 0) > (uploaded?.seq ?? 0)).toBe(true);
    expect((await head(AUFTRAG_KEY)).id).toBe(newest?.id);
    expect((await headFact(AUFTRAG_KEY, 'Call_Rechnung', 'call'))?.keyRaw).toBe('Process_Rechnung');
    expect((await headFact(AUFTRAG_KEY, 'Task_Pruefen', 'task'))?.label).toBe(
      'Auftrag sorgfältig prüfen',
    );
    // A partner's claim after the import: `hashesAt` sees the amended head.
    const [partner] = await claim(asAgent(t, agent.secret), {
      projectId: P,
      modelKey: RECHNUNG_KEY,
    });
    if (!partner) throw new Error('no task for the partner');
    const row = await database.db.execute<{ claimed_seq: string }>(
      sql`SELECT claimed_seq FROM analysis_task WHERE id = ${partner.taskId}`,
    );
    const claimedSeq = Number(row.rows[0]?.claimed_seq);
    const hashes = await createStore(database.db).read((tx) =>
      tx.revisions.hashesAt(projectId, [AUFTRAG_KEY], claimedSeq),
    );
    expect(hashes.get(AUFTRAG_KEY)).toBe(newest?.factsHash);
    // The early download is still analyzr's own output: unchanged.
    expect((await put(AUFTRAG_KEY, earlyDownload, 200)).outcome).toBe('unchanged');
  });

  it('counts a value the tool took over as carried over, and re-applies it when the tool brings back before', async () => {
    // The documentation from the tool (another text) ends the amendment's writing: no conflict,
    // and no amended revision, since nothing else applies.
    const tool = await put(LAGER_KEY, lager({ documentation: 'Die Einlagerung.' }), 200);
    expect(tool.uploadedRevisionId).toBeUndefined();
    expect(tool.revision.source).toMatchObject({
      kind: 'upload',
      amendments: [expect.objectContaining({ op: 'process-documentation', outcome: 'in-source' })],
    });
    expect(tool.amendments).toMatchObject({ inSource: { count: 1 }, conflicts: { count: 0 } });
    const listed = await amendments(`?modelKey=${LAGER_KEY}`);
    expect(listed.map((a) => a.state)).toEqual(['in-source']);
    expect((await questions()).some((q) => q.kind === 'amendment-conflict')).toBe(false);
    // The tool loses its documentation again: the amendment applies again.
    const back = await put(LAGER_KEY, lager(), 200);
    expect(back.uploadedRevisionId).toBeDefined();
    expect(back.amendments).toMatchObject({ applied: { count: 1 } });
    expect((await headFact(LAGER_KEY, 'Process_Lager', 'process'))?.attrs.documentation).toBe(
      'Lagert Ware ein. Kontakt: lager@example.org',
    );
    // The call target taken over by the tool: in the source, the other amendments applied.
    // (A change elsewhere too: the bytes alone would equal the first amended revision's.)
    const taken = await put(
      AUFTRAG_KEY,
      auftrag({ callRechnung: 'Process_Rechnung', taskName: 'Auftrag übernehmen' }),
      200,
    );
    expect(taken.amendments).toMatchObject({ applied: { count: 3 }, inSource: { count: 1 } });
    expect(
      (await amendments(`?modelKey=${AUFTRAG_KEY}&state=in-source`)).map((a) => a.elementId),
    ).toEqual(['Call_Rechnung']);
    // The change list shows it as carried over.
    const list = await (
      await owner(`${API}/amendments/export?modelKey=${AUFTRAG_KEY}&state=in-source`)
    ).text();
    expect(list).toContain('- Stand: im Quellsystem übernommen');
    expect(list.match(/^#### /gm)).toHaveLength(1);
    expect(list).toContain('### Erledigt (1)');
  });

  it('asks about an incoming expression and offers only the withdrawal', async () => {
    const result = await put(AUFTRAG_KEY, auftrag({ zahlungName: '${zahlung}' }), 200);
    expect(result.amendments?.conflicts.count).toBe(1);
    const conflict = find(
      await questions(),
      (q) => q.kind === 'amendment-conflict' && q.subject.id === `${AUFTRAG_KEY}#Message_Zahlung`,
      'the expression conflict',
    );
    expect(conflict.source).toBe('amendment');
    // The question first, the values in the detail (UX2a).
    expect(conflict.detail).toContain('${zahlung}');
    expect(conflict.actions.map((a) => `${a.type}${a.primary ? '*' : ''} ${a.label}`)).toEqual([
      'withdraw-amendment* Ergänzung zurücknehmen',
      'note Notiz hinzufügen',
    ]);
    expect(
      (await amendments(`?modelKey=${AUFTRAG_KEY}`)).find(
        (a) => a.elementId === 'Message_Zahlung' && a.withdrawal === null,
      ),
    ).toMatchObject({ state: 'conflict', conflict: 'expression' });
    // Back to the original value for the next steps.
    await put(AUFTRAG_KEY, auftrag(), 200);
  });

  it('asks about a value the tool changed; „Meine Ergänzung behalten“ and „Wert aus dem Quellsystem übernehmen“ work', async () => {
    const changed = await put(AUFTRAG_KEY, auftrag({ callRechnung: 'Process_Andere' }), 200);
    expect(changed.amendments?.conflicts.count).toBe(1);
    expect((await headFact(AUFTRAG_KEY, 'Call_Rechnung', 'call'))?.keyRaw).toBe('Process_Andere');
    const conflict = find(
      await questions(),
      (q) => q.kind === 'amendment-conflict' && q.subject.id === CALL,
      'the value conflict',
    );
    expect(conflict.detail).toContain('Process_Andere');
    expect(conflict.detail).toContain('Process_Rechnung');
    expect(conflict.actions.map((a) => `${a.type}${a.primary ? '*' : ''} ${a.label}`)).toEqual([
      'withdraw-amendment* Wert aus dem Quellsystem übernehmen',
      'amend Meine Ergänzung behalten',
      'note Notiz hinzufügen',
    ]);
    const keep = conflict.actions[1]?.amend;
    expect(keep?.targets[0]).toMatchObject({
      elementId: 'Call_Rechnung',
      op: 'call-target',
      prefill: 'Process_Rechnung',
    });
    // „Meine Ergänzung behalten“: a new amendment over the tool's value.
    const kept = await amended(AUFTRAG_KEY, [
      {
        elementId: 'Call_Rechnung',
        op: 'call-target',
        target: PROCESS_RECHNUNG,
        replaces: keep?.replaces,
      },
    ]);
    expect(kept.items[0]?.amendment).toMatchObject({
      before: 'Process_Andere',
      after: 'Process_Rechnung',
      state: 'applied',
    });
    expect((await headFact(AUFTRAG_KEY, 'Call_Rechnung', 'call'))?.keyRaw).toBe('Process_Rechnung');
    expect((await questions()).some((q) => q.id === conflict.id)).toBe(false);

    // The tool names the start now: „Wert aus dem Quellsystem übernehmen“ withdraws ours.
    await put(
      AUFTRAG_KEY,
      auftrag({ callRechnung: 'Process_Andere', startName: 'Bestellung erhalten' }),
      200,
    );
    const start = find(
      await questions(),
      (q) => q.kind === 'amendment-conflict' && q.subject.id === `${AUFTRAG_KEY}#Start_Auftrag`,
      'the start conflict',
    );
    const take = start.actions[0]?.withdraw;
    expect(take?.amendment).toBeDefined();
    const withdrawn = await withdraw(`${API}/amendments/${take?.amendment}/withdrawal`);
    expect(withdrawn.amendments[0]).toMatchObject({ state: 'withdrawn' });
    expect((await headFact(AUFTRAG_KEY, 'Start_Auftrag', 'evt_start'))?.label).toBe(
      'Bestellung erhalten',
    );
    expect((await questions()).some((q) => q.id === start.id)).toBe(false);
  });

  it('asks about a removed element, and a new amendment elsewhere leaves the conflict open', async () => {
    await put(
      AUFTRAG_KEY,
      auftrag({ callRechnung: 'Process_Andere', withoutBestaetigung: true }),
      200,
    );
    const missing = find(
      await questions(),
      (q) => q.kind === 'amendment-conflict' && q.subject.id === BESTAETIGUNG,
      'the missing element',
    );
    expect(missing.actions.map((a) => `${a.type}${a.primary ? '*' : ''} ${a.label}`)).toEqual([
      'withdraw-amendment* Ergänzung zurücknehmen',
      'withdraw-amendment Alle Ergänzungen dieses Modells zurücknehmen',
      'note Notiz hinzufügen',
    ]);
    expect(missing.actions[1]?.withdraw).toEqual({
      modelId: modelId(AUFTRAG_KEY),
      modelKey: AUFTRAG_KEY,
    });
    const versandCall = await amended(AUFTRAG_KEY, [
      { elementId: 'Call_Versand', op: 'call-target', target: PROCESS_VERSAND },
    ]);
    expect(versandCall.items[0]).toMatchObject({ outcome: 'recorded' });
    expect((await questions()).some((q) => q.id === missing.id)).toBe(true);
  });

  it('carries amendments in the import and PUT results only for models with live amendments', async () => {
    const plain = await put(
      VERSAND_KEY,
      versand().replace('Versendet Ware.', 'Versendet die Ware.'),
    );
    expect(plain.outcome).toBe('revised');
    expect('amendments' in plain).toBe(false);
    expect('uploadedRevisionId' in plain).toBe(false);
    const form = new FormData();
    form.append(
      'files',
      new Blob([
        auftrag({ callRechnung: 'Process_Andere', withoutBestaetigung: true, taskName: 'X' }),
      ]),
      `${AUFTRAG_KEY}.bpmn`,
    );
    form.append('files', new Blob([versand()]), `${VERSAND_KEY}.bpmn`);
    const res = await owner(`${API}/imports`, { method: 'POST', body: form });
    expect(res.status).toBe(200);
    const files = ((await res.json()) as { files: Record<string, unknown>[] }).files;
    expect(files[0]).toMatchObject({ outcome: 'revised', amendments: { conflicts: { count: 1 } } });
    expect(Object.keys(files[1] ?? {})).toEqual(['path', 'modelKey', 'outcome', 'problem']);
  });

  it('puts an amendment recorded while an import is being extracted into the head after the import', async () => {
    let started!: () => void;
    let release!: () => void;
    const startedP = new Promise<void>((resolve) => (started = resolve));
    gate = {
      key: BESTELLUNG_KEY,
      started,
      release: new Promise<void>((resolve) => (release = resolve)),
    };
    const importing = put(BESTELLUNG_KEY, bestellung({ taskName: 'Bestellung sorgfältig prüfen' }));
    await startedP;
    // While the import extracts outside its transaction, a human amends the model.
    const result = await amended(BESTELLUNG_KEY, [
      { elementId: 'End_Bestellung', op: 'event-name', after: 'Bestellung abgeschlossen' },
    ]);
    expect(result.items[0]).toMatchObject({ outcome: 'recorded' });
    release();
    const imported = await importing;
    expect(imported.outcome).toBe('revised');
    expect(imported.amendments).toMatchObject({ applied: { count: 1 } });
    expect((await headFact(BESTELLUNG_KEY, 'End_Bestellung', 'evt_end'))?.label).toBe(
      'Bestellung abgeschlossen',
    );
    expect((await headFact(BESTELLUNG_KEY, 'Task_Bestellung', 'task'))?.label).toBe(
      'Bestellung sorgfältig prüfen',
    );
  });
});

describe('withdrawals, deletion and the change list', () => {
  it('lists every state in the change list, per model, and honours since', async () => {
    const md = await owner(`${API}/amendments/export?format=markdown`);
    expect(md.status).toBe(200);
    expect(md.headers.get('content-disposition')).toBe(
      `attachment; filename="ergaenzungen-${P}.md"`,
    );
    const text = await md.text();
    expect(text).toContain('# Änderungsliste: Ergänzungen');
    expect(text).toMatch(/Stand: Ereignis \d+/);
    for (const heading of [AUFTRAG_KEY, LAGER_KEY, BESTELLUNG_KEY]) {
      expect(text).toContain(`(\`${heading}\`)`);
    }
    for (const state of ['angewendet', 'ersetzt', 'zurückgenommen', 'Konflikt']) {
      expect(text, state).toContain(`- Stand: ${state}`);
    }
    expect(text).toContain('Aufrufaktivität „Rechnung stellen“');
    expect(text).toContain('Prozess „Rechnungsstellung“ im Modell');
    expect(text).toContain('Lane „Buchhaltung“');
    // A shared message lists every element referencing it.
    expect(text).toContain(
      'Empfangsaufgabe „Mahnung abwarten“ (ID Task_Mahnung); Empfangsaufgabe „Zahlung abwarten“ (ID Task_Zahlung)',
    );
    // The element as the source tool knows it, with its id: the unnamed end of the race test.
    expect(text).toContain('Endereignis ohne Namen (ID End_Bestellung)');
    // Per model: what to carry over first, then what is done.
    expect(text).toMatch(/### Zu übertragen \(\d+\)/);
    expect(text).toMatch(/### Erledigt \(\d+\)/);
    const csv = await owner(`${API}/amendments/export?format=csv&modelKey=${LAGER_KEY}`);
    const bytes = new Uint8Array(await csv.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csvText = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
    expect(csvText.startsWith('\uFEFF"Modell";"Modellschlüssel";')).toBe(true);
    expect(csvText.split('\r\n').filter((l) => l !== '')).toHaveLength(2);
    // since: only what came after.
    const seq = await lastSeq();
    const none = await (await owner(`${API}/amendments/export?since=${seq}`)).text();
    expect(none).toContain('Keine Ergänzungen.');
  });

  it('returns the original and the amended bytes as downloads', async () => {
    const revs = await revisions(BESTELLUNG_KEY);
    const [amendedHead, uploaded] = revs;
    expect(await content(BESTELLUNG_KEY, uploaded?.id ?? '')).toBe(
      bestellung({ taskName: 'Bestellung sorgfältig prüfen' }),
    );
    expect(await content(BESTELLUNG_KEY, amendedHead?.id ?? '')).toBe(
      bestellung({ taskName: 'Bestellung sorgfältig prüfen' }).replace(
        '<bpmn:endEvent id="End_Bestellung" />',
        '<bpmn:endEvent id="End_Bestellung" name="Bestellung abgeschlossen" />',
      ),
    );
  });

  it('withdraws one amendment and then all of a model, re-deriving from the uploaded revision', async () => {
    const live = (await amendments(`?modelKey=${AUFTRAG_KEY}`)).filter(
      (a) => a.withdrawal === null,
    );
    expect(live.length).toBeGreaterThan(1);
    const one = live.find((a) => a.elementId === 'Call_Versand');
    const before = (await revisions(AUFTRAG_KEY)).length;
    const result = await withdraw(`${API}/amendments/${one?.id}/withdrawal`);
    expect(result).toMatchObject({ result: 'withdrawn', amendments: [{ state: 'withdrawn' }] });
    expect(result.revision?.source.kind).toBe('amendment');
    expect((await revisions(AUFTRAG_KEY)).length).toBe(before + 1);
    expect((await headFact(AUFTRAG_KEY, 'Call_Versand', 'call'))?.keyRaw).toBe(
      'Process_Versand_Alt',
    );
    // Again: unchanged.
    expect((await withdraw(`${API}/amendments/${one?.id}/withdrawal`, 200)).result).toBe(
      'unchanged',
    );
    // All of the model: one revision, the uploaded bytes.
    const all = await withdraw(`${API}/models/${modelId(AUFTRAG_KEY)}/amendments/withdrawal`);
    expect(all.amendments.length).toBe(live.length - 1);
    expect(all.amendments.every((a) => a.state === 'withdrawn')).toBe(true);
    const revs = await revisions(AUFTRAG_KEY);
    expect(revs.length).toBe(before + 2);
    const [newest] = revs;
    const upstream = newest?.source.upstream;
    expect(newest?.source.amendments).toEqual([]);
    expect(newest?.contentHash).toBe(upstream?.contentHash);
    expect(await content(AUFTRAG_KEY, newest?.id ?? '')).toBe(
      await content(AUFTRAG_KEY, upstream?.revisionId ?? ''),
    );
    expect(
      (await withdraw(`${API}/models/${modelId(AUFTRAG_KEY)}/amendments/withdrawal`, 200)).result,
    ).toBe('unchanged');
    expect((await questions()).some((q) => q.kind === 'amendment-conflict')).toBe(false);
  });

  it('keeps amendments of a deleted model live, writes no revision for them, and re-derives on revival', async () => {
    const del = await owner(`${API}/models/${modelId(LAGER_KEY)}`, { method: 'DELETE' });
    expect(del.status).toBe(204);
    const [doc] = await amendments(`?modelKey=${LAGER_KEY}&state=applied`);
    expect(doc).toMatchObject({ modelDeleted: true, op: 'process-documentation' });
    // The amendment routes answer 404 for a deleted model.
    const gone = await owner(
      `${API}/models/${modelId(LAGER_KEY)}/elements/Process_Lager/amendable`,
    );
    expect(gone.status).toBe(404);
    expect(
      (
        await amend(
          LAGER_KEY,
          [{ elementId: 'Process_Lager', op: 'process-documentation', after: 'x' }],
          { rev: 1, status: 404 },
        )
      ).body,
    ).toMatchObject({ code: 'not-found' });
    // Revival by upload re-derives from the live set.
    const revived = await put(LAGER_KEY, lager(), 201);
    expect(revived.outcome).toBe('created');
    expect(revived.amendments).toMatchObject({ applied: { count: 1 } });
    expect((await headFact(LAGER_KEY, 'Process_Lager', 'process'))?.attrs.documentation).toBe(
      'Lagert Ware ein. Kontakt: lager@example.org',
    );
    // Deleted again: a withdrawal records its row only.
    expect((await owner(`${API}/models/${modelId(LAGER_KEY)}`, { method: 'DELETE' })).status).toBe(
      204,
    );
    const store = createStore(database.db);
    const atBefore = await store.read((tx) => tx.revisions.hashesAt(projectId, [LAGER_KEY], 1e9));
    const revisionsBefore = await count('model_revision');
    const result = await withdraw(`${API}/amendments/${doc?.id}/withdrawal`);
    expect(result).toMatchObject({ result: 'withdrawn', revision: null, model: null });
    expect(result.amendments[0]).toMatchObject({ state: 'withdrawn', modelDeleted: true });
    const list = await (await owner(`${API}/amendments/export?modelKey=${LAGER_KEY}`)).text();
    expect(list).toContain('– Modell gelöscht');
    expect(await count('model_revision')).toBe(revisionsBefore);
    const atAfter = await store.read((tx) => tx.revisions.hashesAt(projectId, [LAGER_KEY], 1e9));
    expect([...atAfter]).toEqual([...atBefore]);
    expect(atAfter.has(LAGER_KEY)).toBe(false);
  });
});

/**
 * The review round's cases (S5c-2): a re-derivation that applied nothing is
 * no `unchanged` match for a later revert; a value equal to `after` as the
 * only amendment; „Meine Ergänzung behalten“ never over a value that
 * resolves; withdrawals with `If-Match` and a dry run; a name keyed by the
 * message itself is anchored at an endpoint.
 */
describe('review round: history, keep, withdrawal preconditions', () => {
  const P2 = 'amend-review';
  const API2 = `/api/v1/projects/${P2}`;
  const ids2 = new Map<string, string>();
  const id2 = (key: string): string => {
    const id = ids2.get(key);
    if (!id) throw new Error(`no model ${key}`);
    return id;
  };
  const put2 = async (key: string, xml: string): Promise<PutModelResult> => {
    const res = await t.putModel(P2, key, xml);
    const text = await res.text();
    expect(res.status, text.slice(0, 600)).toBeLessThan(300);
    const result = PutModelResult.parse(JSON.parse(text));
    ids2.set(key, result.model.id);
    return result;
  };
  const head2 = async (key: string) =>
    getJson<{ headRev: number; headRevisionId: string }>(`${API2}/models/${id2(key)}`);
  const fact2 = async (key: string, elementId: string, kind: string) => {
    const h = await head2(key);
    const f = await getJson<RevisionFacts>(
      `${API2}/models/${id2(key)}/revisions/${h.headRevisionId}/facts`,
    );
    return f.facts.find((x) => x.elementId === elementId && x.kind === kind);
  };
  const amend2 = async (key: string, items: unknown[], status: number) => {
    const rev = (await head2(key)).headRev;
    const res = await owner(`${API2}/models/${id2(key)}/amendments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'if-match': `"r${rev}"` },
      body: JSON.stringify({ items }),
    });
    const text = await res.text();
    expect(res.status, text.slice(0, 800)).toBe(status);
    return JSON.parse(text) as unknown;
  };
  const questions2 = async () =>
    OpenQuestionPage.parse(await getJson(`${API2}/open-questions?limit=200`)).items;
  const revisions2 = async (key: string) =>
    (await getJson<RevisionPage>(`${API2}/models/${id2(key)}/revisions?limit=200`)).items;
  const withdraw2 = async (path: string, init: { ifMatch?: string; status: number }) => {
    const res = await owner(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(init.ifMatch === undefined ? {} : { 'if-match': init.ifMatch }),
      },
      body: '{}',
    });
    const text = await res.text();
    expect(res.status, text.slice(0, 600)).toBe(init.status);
    return JSON.parse(text) as unknown;
  };

  beforeAll(async () => {
    await t.createProject(P2, 'Ergänzungen, Prüfrunde');
    await put2(AUFTRAG_KEY, auftrag());
    await put2(RECHNUNG_KEY, rechnung());
    await put2(VERSAND_KEY, versand());
    await put2(LAGER_KEY, lager());
    await put2(BESTELLUNG_KEY, bestellung());
  }, 120_000);

  it('stores a revert of the tool after a withdrawal that left nothing to apply', async () => {
    await amend2(
      LAGER_KEY,
      [{ elementId: 'Process_Lager', op: 'process-documentation', after: 'Lagert ein.' }],
      201,
    );
    // Withdrawn with nothing left: an amended revision whose bytes are the upload's.
    const withdrawn = WithdrawAmendmentsResult.parse(
      await withdraw2(`${API2}/models/${id2(LAGER_KEY)}/amendments/withdrawal`, { status: 201 }),
    );
    expect(withdrawn.revision?.contentHash).toBe(withdrawn.revision?.source.upstream?.contentHash);
    const tool = await put2(LAGER_KEY, lager({ documentation: 'Doku aus dem Tool' }));
    expect(tool.outcome).toBe('revised');
    // The tool goes back to the first export: a revert, not analyzr's own output.
    const revert = await put2(LAGER_KEY, lager());
    expect(revert.outcome).toBe('revised');
    expect(revert.revision.source.kind).toBe('upload');
    expect(
      (await fact2(LAGER_KEY, 'Process_Lager', 'process'))?.attrs.documentation,
    ).toBeUndefined();
  });

  it('counts a value equal to after as carried over when nothing else applies, and applies it again on before', async () => {
    await amend2(
      BESTELLUNG_KEY,
      [{ elementId: 'End_Bestellung', op: 'event-name', after: 'Bestellung abgeschlossen' }],
      201,
    );
    const before = (await revisions2(BESTELLUNG_KEY)).length;
    // The tool took the name over (and changed a task, so the bytes are no amended revision's).
    const taken = await put2(
      BESTELLUNG_KEY,
      bestellung({ taskName: 'Bestellung genau prüfen' }).replace(
        '<bpmn:endEvent id="End_Bestellung" />',
        '<bpmn:endEvent id="End_Bestellung" name="Bestellung abgeschlossen" />',
      ),
    );
    expect(taken.outcome).toBe('revised');
    expect(taken.uploadedRevisionId).toBeUndefined();
    expect(taken.revision.source).toMatchObject({
      kind: 'upload',
      amendments: [expect.objectContaining({ op: 'event-name', outcome: 'in-source' })],
    });
    expect(taken.amendments).toMatchObject({
      applied: { count: 0 },
      inSource: { count: 1 },
      conflicts: { count: 0 },
    });
    expect((await revisions2(BESTELLUNG_KEY)).length).toBe(before + 1);
    // The tool loses the name again: the amendment applies again, an amended head on top.
    const back = await put2(BESTELLUNG_KEY, bestellung({ taskName: 'Bestellung genau prüfen' }));
    expect(back.uploadedRevisionId).toBeDefined();
    expect(back.revision.source.kind).toBe('amendment');
    expect(back.amendments).toMatchObject({ applied: { count: 1 }, inSource: { count: 0 } });
    expect((await fact2(BESTELLUNG_KEY, 'End_Bestellung', 'evt_end'))?.label).toBe(
      'Bestellung abgeschlossen',
    );
  });

  it('never keeps analyzr’s value over a label or a call target the tool set that resolves', async () => {
    await amend2(
      AUFTRAG_KEY,
      [
        { elementId: 'Start_Auftrag', op: 'event-name', after: 'Auftrag eingegangen' },
        { elementId: 'Call_Rechnung', op: 'call-target', target: PROCESS_RECHNUNG },
      ],
      201,
    );
    await put2(AUFTRAG_KEY, auftrag({ startName: 'Vom Tool', callRechnung: 'Process_Versand' }));
    const conflicts = (await questions2()).filter((q) => q.kind === 'amendment-conflict');
    expect(conflicts.map((q) => q.subject.id).sort()).toEqual(
      [`${AUFTRAG_KEY}#Call_Rechnung`, `${AUFTRAG_KEY}#Start_Auftrag`].sort(),
    );
    for (const q of conflicts) {
      expect(
        q.actions.map((a) => a.label),
        q.subject.id,
      ).toEqual(['Wert aus dem Quellsystem übernehmen', 'Notiz hinzufügen']);
    }
    const live = ModelAmendmentList.parse(
      await getJson(`${API2}/amendments?modelKey=${AUFTRAG_KEY}&state=conflict`),
    ).items;
    const startId = live.find((a) => a.elementId === 'Start_Auftrag')?.id;
    const callId = live.find((a) => a.elementId === 'Call_Rechnung')?.id;
    // A keep sent anyway is refused: the tool's label and its reachable target stay.
    for (const item of [
      {
        elementId: 'Start_Auftrag',
        op: 'event-name',
        after: 'Auftrag eingegangen',
        replaces: startId,
      },
      { elementId: 'Call_Rechnung', op: 'call-target', target: PROCESS_RECHNUNG, replaces: callId },
    ]) {
      expect(await amend2(AUFTRAG_KEY, [item], 422)).toMatchObject({
        reason: 'amendment-not-applicable',
        items: [{ outcome: 'not-applicable', reason: 'only-open-questions' }],
      });
    }
    expect((await fact2(AUFTRAG_KEY, 'Start_Auftrag', 'evt_start'))?.label).toBe('Vom Tool');
    expect((await fact2(AUFTRAG_KEY, 'Call_Rechnung', 'call'))?.keyRaw).toBe('Process_Versand');
  });

  it('anchors a name keyed by the message itself at an endpoint, so the conflict shows the incoming value', async () => {
    const result = AmendModelResult.parse(
      await amend2(
        AUFTRAG_KEY,
        [{ elementId: 'Message_Zahlung', op: 'message-name', after: 'Zahlung erhalten' }],
        201,
      ),
    );
    expect(result.items[0]?.amendment).toMatchObject({
      elementId: 'Message_Zahlung',
      viaElementId: 'Task_Mahnung',
    });
    await put2(
      AUFTRAG_KEY,
      auftrag({
        startName: 'Vom Tool',
        callRechnung: 'Process_Versand',
        zahlungName: 'Zahlung vom Tool',
      }),
    );
    const conflict = (await questions2()).find(
      (q) => q.kind === 'amendment-conflict' && q.subject.id === `${AUFTRAG_KEY}#Message_Zahlung`,
    );
    expect(conflict?.text).toContain('Welcher Nachrichtenname gilt für die Empfangsaufgabe');
    expect(conflict?.detail).toContain('Jetzt im Quellsystem: „Zahlung vom Tool“');
    expect(conflict?.subjectLabel).toBe('„Mahnung abwarten“');
  });

  it('checks If-Match of a withdrawal under the lock and offers a dry run with the cost', async () => {
    const model = id2(AUFTRAG_KEY);
    const rev = (await head2(AUFTRAG_KEY)).headRev;
    const live = ModelAmendmentList.parse(
      await getJson(`${API2}/amendments?modelKey=${AUFTRAG_KEY}`),
    ).items.filter((a) => a.withdrawal === null);
    expect(live.length).toBeGreaterThan(0);
    const one = live[0]?.id ?? '';
    const amendmentCount = await database.db.execute<{ n: string }>(
      sql`SELECT count(*)::text AS n FROM model_amendment_withdrawal`,
    );
    // A stale or unreadable If-Match: 412, nothing withdrawn.
    for (const ifMatch of [`"r${rev - 1}"`, 'garbage']) {
      expect(
        await withdraw2(`${API2}/models/${model}/amendments/withdrawal`, { ifMatch, status: 412 }),
      ).toMatchObject({ code: 'revision-conflict', headRev: rev });
      expect(
        await withdraw2(`${API2}/amendments/${one}/withdrawal`, { ifMatch, status: 412 }),
      ).toMatchObject({ code: 'revision-conflict', headRev: rev });
    }
    // A dry run: what would end and the cost of the new head; nothing written.
    const dry = WithdrawAmendmentsResult.parse(
      await withdraw2(`${API2}/amendments/${one}/withdrawal?dryRun=true`, {
        ifMatch: `"r${rev}"`,
        status: 200,
      }),
    );
    expect(dry).toMatchObject({
      dryRun: true,
      result: 'withdrawn',
      revision: null,
      cost: { taskClaimed: false },
    });
    const all = WithdrawAmendmentsResult.parse(
      await withdraw2(`${API2}/models/${model}/amendments/withdrawal?dryRun=true`, {
        status: 200,
      }),
    );
    expect(all).toMatchObject({ dryRun: true, result: 'withdrawn' });
    expect(all.amendments.map((a) => a.id).sort()).toEqual(live.map((a) => a.id).sort());
    expect((await head2(AUFTRAG_KEY)).headRev).toBe(rev);
    expect(
      await database.db.execute<{ n: string }>(
        sql`SELECT count(*)::text AS n FROM model_amendment_withdrawal`,
      ),
    ).toMatchObject({ rows: amendmentCount.rows });
    // The current head: withdrawn.
    const done = WithdrawAmendmentsResult.parse(
      await withdraw2(`${API2}/models/${model}/amendments/withdrawal`, {
        ifMatch: `"r${rev}"`,
        status: 201,
      }),
    );
    expect(done.result).toBe('withdrawn');
    expect(done.dryRun).toBeUndefined();
    expect((await head2(AUFTRAG_KEY)).headRev).toBe(rev + 1);
  });
});

describe('the corpus import results', () => {
  it('keep their shape: no amendments, no uploaded revision', async () => {
    await t.createProject('amend-corpus', 'Korpus');
    const outcomes = await importAll(owner, 'amend-corpus', await corpusFiles('_sample'));
    expect(outcomes.length).toBeGreaterThan(0);
    for (const o of outcomes) {
      expect(Object.keys(o)).toEqual(['path', 'modelKey', 'outcome', 'problem']);
    }
  });
});

describe('the amendment tables (migrations 0015, 0016)', () => {
  /** The Postgres error message of a failed statement (Drizzle wraps it in `cause`). */
  async function failure(statement: string): Promise<string> {
    try {
      await database.db.execute(sql.raw(statement));
    } catch (err) {
      const cause = (err as { cause?: { message?: string } }).cause;
      return cause?.message ?? String(err);
    }
    throw new Error('statement succeeded');
  }

  it('are append-only', async () => {
    for (const [statement, message] of [
      ['UPDATE model_amendment SET after = after', /model_amendment is append-only: UPDATE/],
      ['DELETE FROM model_amendment', /model_amendment is append-only: DELETE/],
      ['TRUNCATE model_amendment CASCADE', /is append-only: TRUNCATE/],
      [
        'UPDATE model_amendment_withdrawal SET reason = reason',
        /model_amendment_withdrawal is append-only: UPDATE/,
      ],
      [
        'DELETE FROM model_amendment_withdrawal',
        /model_amendment_withdrawal is append-only: DELETE/,
      ],
      ['TRUNCATE model_amendment_withdrawal', /is append-only: TRUNCATE/],
    ] as const) {
      expect(await failure(statement), statement).toMatch(message);
    }
  });

  it('pin the base revision to the model and record humans only', async () => {
    const [row] = (
      await database.db.execute<{
        model_id: string;
        principal_id: string;
        seq: string;
      }>(sql`SELECT model_id, principal_id, seq FROM model_amendment
             WHERE project_id = ${projectId} LIMIT 1`)
    ).rows;
    if (!row) throw new Error('no amendment');
    const other = (await revisions(RECHNUNG_KEY))[0]?.id ?? '';
    const own = (await revisions(AUFTRAG_KEY)).at(-1)?.id ?? '';
    const insert = (id: string, base: string, sourceKind = 'human') =>
      `INSERT INTO model_amendment (id, project_id, model_id, element_id, op, after,
         base_revision_id, principal_id, source_kind, seq)
       VALUES ('${id}', '${projectId}', '${row.model_id}', 'X', 'event-name', 'x', '${base}',
         '${row.principal_id}', '${sourceKind}', ${row.seq})`;
    expect(await failure(insert('mam_7ZZZZZZZZZZZZZZZZZZZZZZZZ1', other))).toMatch(
      /model_amendment_base_revision_fk/,
    );
    expect(await failure(insert('mam_7ZZZZZZZZZZZZZZZZZZZZZZZZ2', own, 'agent'))).toMatch(
      /model_amendment_humans_only/,
    );
  });
});

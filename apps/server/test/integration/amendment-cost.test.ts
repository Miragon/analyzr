/**
 * The amendment cost against the write (M6 §4.8 c, S2b follow-up), with the
 * real libraries and a real PostgreSQL. Requires:
 * - `pairsToRejudge` is what the model's next claim after the write is
 *   assigned among the pairs judged before, so the pairs the amendment
 *   itself settles do not count: the call a call-target amendment makes the
 *   rule tier accept, the partner proposal a message name with `partner`
 *   accepts; it equals the PUT dry run's `rejudged` for the same change as
 *   an upload;
 * - a new head without a fact change cancels no task, so a claimed task
 *   gives `taskClaimed: false` (the withdrawal of an amendment the source
 *   has taken over).
 * The partners' tasks are done first, so judge each pair once gives every
 * pair around the caller to its own claim.
 */
import {
  AmendModelResult,
  ModelAmendmentList,
  type AnalysisTaskPage,
  PutModelResult,
  WithdrawAmendmentsResult,
  type ClaimedRelationsAnalysis,
  type CreatedAgentToken,
  type PutModelDryRunResult,
} from '@analyzr/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { libraryAnalysis } from '../../src/analysis.ts';
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
import { createTestDatabase, type TestDatabase } from '../support/db.ts';
import { asAgent, claim, post, submission, submit } from '../support/pipeline.ts';

const P = 'amendcost';
const API = `/api/v1/projects/${P}`;
const BESTELLUNG_KEY = 'einkauf/bestellung';
const CALL = `${AUFTRAG_KEY}#Call_Rechnung`;
const PROCESS_RECHNUNG = `${RECHNUNG_KEY}#Process_Rechnung`;
const BESTAETIGUNG = `${AUFTRAG_KEY}#Event_Bestaetigung`;
const PARTNER = `${RECHNUNG_KEY}#Task_Bestaetigung`;
const CALL_TARGET = { elementId: 'Call_Rechnung', op: 'call-target', target: PROCESS_RECHNUNG };

let database: TestDatabase;
let t: TestApp;
let agent: CreatedAgentToken;
const ids = new Map<string, string>();
/** The caller's claim the next test starts from. */
let held: ClaimedRelationsAnalysis | undefined;

const keyOf = (p: { type: string; from: string; to: string }) => `${p.type} ${p.from} ${p.to}`;

async function put(key: string, xml: string): Promise<PutModelResult> {
  const res = await t.putModel(P, key, xml);
  const text = await res.text();
  expect(res.status, text.slice(0, 400)).toBeLessThan(300);
  const result = PutModelResult.parse(JSON.parse(text));
  ids.set(key, result.model.id);
  return result;
}

async function headRev(key: string): Promise<number> {
  const res = await t.asOwner(`${API}/models/${ids.get(key)}`);
  return ((await res.json()) as { headRev: number }).headRev;
}

async function amend(items: unknown[], dryRun: boolean): Promise<AmendModelResult> {
  const res = await t.asOwner(
    `${API}/models/${ids.get(AUFTRAG_KEY)}/amendments${dryRun ? '?dryRun=true' : ''}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'if-match': `"r${await headRev(AUFTRAG_KEY)}"`,
      },
      body: JSON.stringify({ items }),
    },
  );
  const text = await res.text();
  expect(res.status, text.slice(0, 800)).toBe(dryRun ? 200 : 201);
  return AmendModelResult.parse(JSON.parse(text));
}

async function assignmentOf(taskId: string): Promise<string[]> {
  const r = await database.db.execute(
    sql`SELECT assignment FROM analysis_task WHERE id = ${taskId}`,
  );
  const [row] = r.rows as { assignment: { type: string; from: string; to: string }[] | null }[];
  return (row?.assignment ?? []).map(keyOf).sort();
}

async function claimCaller(): Promise<ClaimedRelationsAnalysis> {
  const [task] = await claim(asAgent(t, agent.secret), { projectId: P, modelKey: AUFTRAG_KEY });
  if (!task) throw new Error('no task for the caller');
  return task;
}

/** Judges every pair the claim shows (candidates and skips) with a no-link; their keys. */
async function judgeAll(task: ClaimedRelationsAnalysis): Promise<Set<string>> {
  const pairs = [
    ...task.input.candidates.map(([type, from, to]) => ({ type, from, to })),
    ...(task.input.skip ?? []).map(({ type, from, to }) => ({ type, from, to })),
  ];
  const done = await submit(asAgent(t, agent.secret), task.taskId, {
    ...submission(task, []),
    noLinks: pairs.map((p) => ({ ...p, reason: 'no-evidence: nicht verbunden' })),
  });
  expect(done.noLinks?.items.every((i) => i.result === 'stored')).toBe(true);
  return new Set(pairs.map(keyOf));
}

beforeAll(async () => {
  database = await createTestDatabase();
  t = startTestApp(database, { analysis: libraryAnalysis });
  await t.createProject(P, 'Kosten');
  await put(AUFTRAG_KEY, auftrag());
  await put(RECHNUNG_KEY, rechnung());
  await put(LAGER_KEY, lager());
  await put(VERSAND_KEY, versand());
  await put(BESTELLUNG_KEY, bestellung());
  agent = await t.createToken(P, ['analyzr:read', 'analyzr:propose']);
  const a = asAgent(t, agent.secret);
  for (const key of [RECHNUNG_KEY, LAGER_KEY, VERSAND_KEY, BESTELLUNG_KEY]) {
    const [task] = await claim(a, { projectId: P, modelKey: key });
    if (!task) throw new Error(`no task for ${key}`);
    await submit(a, task.taskId, submission(task, []));
  }
}, 120_000);

afterAll(async () => {
  await database?.drop();
});

describe('the amendment cost', () => {
  it('a call target: the pairs judged again, without the call it accepts, as the PUT dry run counts them', async () => {
    const judged = await judgeAll(await claimCaller());
    const callPair = `call ${CALL} ${PROCESS_RECHNUNG}`;
    expect(judged.has(callPair)).toBe(true);
    const dry = await amend([CALL_TARGET], true);
    expect(dry.effect.accepted).toEqual([
      { relation: null, type: 'call', from: CALL, to: PROCESS_RECHNUNG },
    ]);
    expect(dry.cost.factsChange).toBe(true);
    // The same change as an upload: the PUT dry run's pairs judged again.
    const res = await t.asOwner(
      `${API}/models/by-key/${encodeURIComponent(AUFTRAG_KEY)}?dryRun=true`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/xml' },
        body: auftrag({ callRechnung: 'Process_Rechnung' }),
      },
    );
    expect(res.status).toBe(200);
    const { rejudged } = ((await res.json()) as PutModelDryRunResult).impact.relationsTasks;
    expect(rejudged.items.map(keyOf)).not.toContain(callPair);
    expect(dry.cost.pairsToRejudge).toBe(rejudged.count);

    await amend([CALL_TARGET], false);
    held = await claimCaller();
    const again = (await assignmentOf(held.taskId)).filter((k) => judged.has(k));
    expect(again).not.toContain(callPair);
    expect(again).toEqual(rejudged.items.map(keyOf).sort());
    expect(dry.cost.pairsToRejudge).toBe(again.length);
  });

  it('a message name with a partner: the pairs judged again, without the partner pair it accepts', async () => {
    if (!held) throw new Error('the call target test runs first');
    const judged = await judgeAll(held);
    const partnerPair = `message ${BESTAETIGUNG} ${PARTNER}`;
    const item = {
      elementId: 'Event_Bestaetigung',
      op: 'message-name',
      after: 'Auftrag bestätigt',
      partner: PARTNER,
    };
    const dry = await amend([item], true);
    expect(dry.effect.partnerAccepted.map(keyOf)).toEqual([partnerPair]);
    expect(dry.cost.factsChange).toBe(true);

    await amend([item], false);
    held = await claimCaller();
    const again = (await assignmentOf(held.taskId)).filter((k) => judged.has(k));
    expect(again).not.toContain(partnerPair);
    expect(dry.cost.pairsToRejudge).toBe(again.length);
  });

  it('cancels no claimed task when the facts stay (a withdrawal the source has taken over)', async () => {
    if (!held) throw new Error('the partner test runs first');
    // The source takes the call target over (with a comment, so the bytes are new): an
    // amended head with the same facts, so the agent's claim stays.
    const upload = await put(
      AUFTRAG_KEY,
      `${auftrag({ callRechnung: 'Process_Rechnung' })}<!-- im Werkzeug gespeichert -->\n`,
    );
    expect(upload.outcome).toBe('revised');
    expect(upload.amendments).toMatchObject({ applied: { count: 1 }, inSource: { count: 1 } });
    const claimed = await t.asOwner(
      `${API}/analyses?state=claimed&modelKey=${encodeURIComponent(AUFTRAG_KEY)}`,
    );
    const [open] = ((await claimed.json()) as AnalysisTaskPage).items;
    expect(open?.id).toBe(held.taskId);
    const [taken] = ModelAmendmentList.parse(
      await (await t.asOwner(`${API}/amendments?modelKey=${AUFTRAG_KEY}&state=in-source`)).json(),
    ).items;
    if (!taken) throw new Error('no amendment in the source');
    const res = await post(
      (path, init) => t.asOwner(path, init),
      `${API}/amendments/${taken.id}/withdrawal?dryRun=true`,
      {},
    );
    expect(res.status, await res.clone().text()).toBe(200);
    expect(WithdrawAmendmentsResult.parse(await res.json()).cost).toEqual({
      factsChange: false,
      pairsToRejudge: 0,
      taskClaimed: false,
    });
  });
});

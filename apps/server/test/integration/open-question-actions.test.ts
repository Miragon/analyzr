/**
 * Answering by action end to end (M6 §4.8 a, S5c-1): `nordwind-handel`
 * imported with the real libraries, its golden value chain created (as
 * `analyzr seed --value-chains` does), plus a collaboration with a pool
 * without a process whose flows end at another pool and at a collapsed
 * subprocess. Requires (§8 "S5c-1"):
 * - `link` from a `call-target-unknown` item writes one accepted `manual`
 *   relation with the German rationale from code, and the item leaves the
 *   list while „Befunde“ still lists the finding; with a live agent proposal
 *   to the picked target it accepts that relation instead and writes no
 *   manual one; the agent's proposal alone leaves the item listed; a pool
 *   gets one relation per anchor of its flows in one transaction, directed
 *   like the flows (the pool-to-pool flow and the collapsed subprocess
 *   anchored at their processes), and a link to another process of the same
 *   model ends it (R1); „Rückgängig“ (a rejection) brings the item back;
 * - after a human linked call C → P, an owner's rule never accepts an
 *   agent's `call` proposal C → Q (`competing-call`, in the write, in apply
 *   and in the preview);
 * - `place` homes a `process-without-step` and a `placement-unsure`
 *   process (also on `@outside`), and the items leave the list;
 *   „Rückgängig“ brings the first back; a placement on the step and process
 *   of an agent's proposal decides that proposal (effect `decision`, no
 *   undo);
 * - `choose-copy` accepts and rejects all or nothing (a stale version is 409
 *   and writes nothing), places the other copy on `@outside`, records the
 *   note without a mark, and the item leaves the list (R1b); a new caller's
 *   proposal to a copy brings it back; the seeded project lists it once;
 * - an `external-partner` mark survives a re-judgement that replaces the
 *   coded no-link after a change elsewhere in the model;
 * - an action the item does not offer is 422 `action-not-offered`, a link
 *   the item cannot take 422 with its reason; `requeue` keeps permission
 *   `write` (an agent token may requeue).
 */
import { readFile } from 'node:fs/promises';

import {
  OpenQuestionActionResult,
  OpenQuestionPage,
  type ApplyAutoAcceptResult,
  type AutoAcceptPreview,
  type CreatedAgentToken,
  type FindingList,
  type OpenQuestion,
  type ProposeRelationResult,
  type SaveAutoAcceptRuleResult,
  type ValueChainDetail,
} from '@analyzr/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { libraryAnalysis } from '../../src/analysis.ts';
import { startTestApp, type TestApp } from '../support/app.ts';
import { corpusFiles, importAll } from '../support/corpus.ts';
import { createTestDatabase, type TestDatabase } from '../support/db.ts';
import {
  asAgent,
  claim,
  claimPlacement,
  placementSubmission,
  post,
  submission,
  submit,
  submitPlacement,
} from '../support/pipeline.ts';
import { NORDWIND_CHAIN, chainPath } from '../support/value-chain.ts';

const P = 'nordwind-handel';
const API = `/api/v1/projects/${P}`;
const BASE = `${API}/open-questions`;
const ORDER = 'vertrieb/order-handling';
const FRAUD_CHECK = `${ORDER}#Call_FraudCheck`;
const SEND_CONFIRMATION = `${ORDER}#Task_SendConfirmation`;
const POOLS = 'logistik/pools-test';
const LAGER = `${POOLS}#P_Lager`;
const VERSAND = `${POOLS}#P_Versand`;
const ZOLL = `${POOLS}#P_Zoll`;
const SPEDITION = `${POOLS}#Participant_Spedition`;

// A pool without a process (Spedition): a pool-to-pool flow from Lager, a flow to a
// collapsed subprocess of Versand (a lane member); Zoll is a third process of the model.
const POOLS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs_Pools" targetNamespace="http://example.org/bpmn">
  <bpmn:collaboration id="Collab_P">
    <bpmn:participant id="Participant_Lager" name="Lager" processRef="P_Lager"/>
    <bpmn:participant id="Participant_Versand" name="Versand" processRef="P_Versand"/>
    <bpmn:participant id="Participant_Zoll" name="Zoll" processRef="P_Zoll"/>
    <bpmn:participant id="Participant_Spedition" name="Spedition"/>
    <bpmn:messageFlow id="Flow_Auftrag" name="Transportauftrag" sourceRef="Participant_Lager" targetRef="Participant_Spedition"/>
    <bpmn:messageFlow id="Flow_Status" name="Status" sourceRef="Participant_Spedition" targetRef="Sub_Verladen"/>
  </bpmn:collaboration>
  <bpmn:process id="P_Lager" name="Lagerung" isExecutable="false">
    <bpmn:documentation>Lagert Ware ein und aus.</bpmn:documentation>
    <bpmn:startEvent id="Start_Lager" name="Ware angekommen"/>
    <bpmn:endEvent id="End_Lager" name="Ware eingelagert"/>
  </bpmn:process>
  <bpmn:process id="P_Versand" name="Verladung" isExecutable="false">
    <bpmn:documentation>Verlädt Ware für die Spedition.</bpmn:documentation>
    <bpmn:laneSet id="LaneSet_V">
      <bpmn:lane id="Lane_V" name="Versandteam">
        <bpmn:flowNodeRef>Sub_Verladen</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="Start_Versand" name="Verladung beginnt"/>
    <bpmn:subProcess id="Sub_Verladen" name="Verladen"/>
    <bpmn:endEvent id="End_Versand" name="Verladen fertig"/>
  </bpmn:process>
  <bpmn:process id="P_Zoll" name="Zollabwicklung" isExecutable="false">
    <bpmn:documentation>Wickelt den Zoll ab.</bpmn:documentation>
    <bpmn:startEvent id="Start_Zoll" name="Zoll angefragt"/>
    <bpmn:endEvent id="End_Zoll" name="Zoll erledigt"/>
  </bpmn:process>
</bpmn:definitions>`;

let database: TestDatabase;
let t: TestApp;
let agent: CreatedAgentToken;
let writer: CreatedAgentToken;
let seeded: OpenQuestion[] = [];

const owner = (path: string, init?: RequestInit) => t.asOwner(path, init);

async function getJson<T>(path: string): Promise<T> {
  const res = await owner(path);
  if (res.status !== 200) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Every open question, checked against the contract. */
async function listAll(query = ''): Promise<OpenQuestion[]> {
  const page = OpenQuestionPage.parse(await getJson(`${BASE}?limit=200${query}`));
  expect(page.nextCursor).toBeNull();
  return page.items;
}

function find(items: readonly OpenQuestion[], pred: (q: OpenQuestion) => boolean, what: string) {
  const found = items.filter(pred);
  expect(found, what).toHaveLength(1);
  return found[0] as OpenQuestion;
}

/** Runs an action and checks the answer against the contract. */
async function act(id: string, body: unknown, status = 201): Promise<OpenQuestionActionResult> {
  const res = await post(owner, `${BASE}/${id}/actions`, body);
  const text = await res.text();
  expect(res.status, text.slice(0, 800)).toBe(status);
  return OpenQuestionActionResult.parse(JSON.parse(text));
}

async function lastSeq(): Promise<number> {
  const r = await database.db.execute<{ last_seq: string }>(
    sql`SELECT last_seq FROM project WHERE key = ${P}`,
  );
  return Number(r.rows[0]?.last_seq);
}

/** The relations of the project from `from` (any status), as stored. */
async function relationsFrom(
  from: string,
): Promise<{ type: string; to_ref: string; status: string }[]> {
  return (
    await database.db.execute<{ type: string; to_ref: string; status: string }>(
      sql`SELECT r.type, r.to_ref, r.status FROM relation r JOIN project p ON p.id = r.project_id
          WHERE p.key = ${P} AND r.from_ref = ${from} ORDER BY r.type, r.to_ref`,
    )
  ).rows;
}

/** An agent's ad-hoc call proposal. */
async function proposeCall(from: string, to: string): Promise<ProposeRelationResult> {
  const res = await post(asAgent(t, agent.secret), `${API}/relations`, {
    type: 'call',
    from,
    to,
    confidence: 0.8,
    rationale: 'Der Aufruf passt zum Zweck des Prozesses.',
  });
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as ProposeRelationResult;
}

beforeAll(async () => {
  database = await createTestDatabase();
  t = startTestApp(database, { analysis: libraryAnalysis });
  await t.createProject(P, P);
  const outcomes = await importAll(owner, P, await corpusFiles(P));
  expect(outcomes.every((o) => o.outcome === 'created')).toBe(true);
  const saved = await owner(chainPath(P, '/content'), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'if-none-match': '*' },
    body: await readFile(NORDWIND_CHAIN),
  });
  expect(saved.status).toBe(201);
  // The seeded project as S4 and S5a pinned it, before the collaboration joins.
  seeded = await listAll();
  expect((await t.putModel(P, POOLS, POOLS_XML)).status).toBe(201);
  agent = await t.createToken(P, ['analyzr:read', 'analyzr:propose']);
  writer = await t.createToken(P, ['analyzr:read', 'analyzr:write']);
}, 180_000);

afterAll(async () => {
  await database?.drop();
});

describe('actions on the open questions of nordwind-handel', () => {
  it('lists the seeded duplicate process id once (R1b: calls towards its copies wait)', () => {
    expect(seeded).toHaveLength(64);
    const duplicate = find(seeded, (q) => q.kind === 'duplicate-process-id', 'the duplicate');
    expect(duplicate.actions[0]).toMatchObject({ type: 'choose-copy', primary: true });
    expect(duplicate.actions[0]?.decides?.length).toBeGreaterThan(0);
  });

  it('links a call to a process: a manual relation, accepted, with the rationale from code', async () => {
    const items = await listAll();
    const item = find(
      items,
      (q) => q.source === 'finding' && q.subject.id === FRAUD_CHECK,
      'the fraud check',
    );
    // S5c-2: the target can also be set in the model („Aufrufziel im Modell ändern …“).
    expect(item.actions.map((a) => [a.type, a.primary])).toEqual([
      ['link', true],
      ['amend', false],
      ['outside', false],
      ['note', false],
    ]);
    const result = await act(item.id, { type: 'link', targets: [ZOLL], note: 'Laut Fachbereich.' });
    expect(result).toMatchObject({
      result: 'applied',
      question: null,
      placements: [],
      answer: null,
      relations: [
        {
          effect: 'manual',
          relation: {
            type: 'manual',
            from: FRAUD_CHECK,
            to: ZOLL,
            status: 'accepted',
            provenance: { sourceKind: 'human', kind: 'decision', verdict: 'accept' },
          },
        },
      ],
    });
    expect(result.relations[0]?.relation.provenance?.rationale).toBe(
      'Aus „Offene Fragen“: Aufrufziel unbekannt – Welchen Prozess ruft „Run fraud check“ in ' +
        '„Order handling“ auf? calledElement „Process_FraudCheck“ passt zu keiner Prozess-ID im ' +
        'Projekt.\n\nLaut Fachbereich.',
    );
    // The item leaves the list (R1); „Befunde“ still lists the finding.
    expect((await listAll()).some((q) => q.id === item.id)).toBe(false);
    const findings = await getJson<FindingList>(`${API}/findings`);
    expect(
      findings.items.some((f) => f.kind === 'unresolved-call' && f.refs[0] === FRAUD_CHECK),
    ).toBe(true);
  });

  it('accepts a live agent proposal instead of writing a manual relation; the proposal alone leaves the item', async () => {
    const before = await listAll();
    const item = find(
      before,
      (q) => q.kind === 'call-target-unknown' && q.subject.id !== FRAUD_CHECK,
      'the other unresolved call',
    );
    const call = item.subject.id;
    const proposed = await proposeCall(call, VERSAND);
    expect(proposed.relation).toMatchObject({ status: 'proposed', type: 'call' });
    // An agent's proposal does not count (R1): listed, its target suggested.
    const listed = find(await listAll(), (q) => q.id === item.id, 'the call, still listed');
    expect(listed.actions[0]?.suggested).toContain(VERSAND);
    const result = await act(item.id, { type: 'link', targets: [VERSAND] });
    expect(result.relations).toMatchObject([
      {
        effect: 'decision',
        relation: { id: proposed.relation.id, type: 'call', status: 'accepted' },
      },
    ]);
    expect(result.question).toBeNull();
    // No manual relation: the typed pair is settled, judge-once stops assigning it.
    expect(await relationsFrom(call)).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ type: 'manual' })]),
    );
  });

  it("never lets an owner's rule accept an agent's call that competes with a human's link", async () => {
    const created = await post(owner, `${API}/auto-accept-rules`, {
      name: 'Semantische Aufrufe',
      kind: 'relation',
      tier: 'semantic',
      minConfidence: 0.5,
      relationType: 'call',
      includeAdHoc: true,
      enabled: true,
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const rule = ((await created.json()) as SaveAutoAcceptRuleResult).rule;
    // The write: the agent's call C → Q after the human linked C → P stays proposed.
    const proposed = await proposeCall(FRAUD_CHECK, LAGER);
    expect(proposed.relation.tier).toBe('semantic');
    const stored = await relationsFrom(FRAUD_CHECK);
    expect(stored).toEqual([
      { type: 'call', to_ref: LAGER, status: 'proposed' },
      { type: 'manual', to_ref: ZOLL, status: 'accepted' },
    ]);
    // The preview and "apply" see the same competing call.
    const preview = await post(owner, `${API}/auto-accept-rules/preview`, {
      kind: 'relation',
      tier: 'semantic',
      minConfidence: 0.5,
      relationType: 'call',
      includeAdHoc: true,
    });
    expect(preview.status).toBe(200);
    expect(((await preview.json()) as AutoAcceptPreview).open).toMatchObject({
      count: 0,
      blocked: [{ reason: 'competing-call', count: 1 }],
    });
    const dry = await post(owner, `${API}/auto-accept-rules/${rule.id}/apply?dryRun=true`, {});
    expect(dry.status).toBe(200);
    expect((await dry.json()) as ApplyAutoAcceptResult).toMatchObject({
      count: 0,
      blocked: [{ reason: 'competing-call', count: 1 }],
    });
    const applied = await post(owner, `${API}/auto-accept-rules/${rule.id}/apply`, {
      revision: rule.revision,
      expectedCount: 0,
    });
    expect(applied.status).toBe(200);
    expect(await relationsFrom(FRAUD_CHECK)).toEqual(stored);
    // The rule off again, so the other tests' proposals stay proposals.
    const off = await owner(`${API}/auto-accept-rules/${rule.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'if-match': `"r${rule.revision}"` },
      body: JSON.stringify({
        name: rule.name,
        enabled: false,
        note: rule.note,
        kind: rule.kind,
        tier: rule.tier,
        minConfidence: rule.minConfidence,
        relationType: rule.relationType,
        agentPrincipalId: rule.agentPrincipalId,
        llmModel: rule.llmModel,
        includeAdHoc: rule.includeAdHoc,
      }),
    });
    expect(off.status, await off.clone().text()).toBe(200);
  });

  it('brings a linked item back when „Rückgängig“ rejects what the link wrote', async () => {
    const manual = (
      await database.db.execute<{ id: string; version: number }>(
        sql`SELECT r.id, r.version FROM relation r JOIN project p ON p.id = r.project_id
            WHERE p.key = ${P} AND r.type = 'manual' AND r.from_ref = ${FRAUD_CHECK}`,
      )
    ).rows[0];
    if (!manual) throw new Error('no manual relation');
    const undo = await post(owner, `${API}/relations/${manual.id}/decision`, {
      verdict: 'reject',
      reason: 'Rückgängig gemacht',
    });
    expect(undo.status).toBe(200);
    const back = find(
      await listAll(),
      (q) => q.source === 'finding' && q.subject.id === FRAUD_CHECK,
      'the fraud check, back',
    );
    expect(back.id).toBe(
      seeded.find((q) => q.subject.id === FRAUD_CHECK && q.source === 'finding')?.id,
    );
    expect(back.state).toBe('open');
  });

  it("links a pool's flows: one relation per anchor, directed like its flow, in its own model", async () => {
    const item = find(await listAll(), (q) => q.subject.id === SPEDITION, 'the Spedition pool');
    expect(item.kind).toBe('black-box-partner');
    expect(item.actions.map((a) => [a.type, a.primary])).toEqual([
      ['outside', true],
      ['link', false],
      ['note', false],
    ]);
    // Zoll is another process of the same model: one relation from Lager's pool (the
    // pool-to-pool flow), one to Versand (the collapsed subprocess), in one transaction.
    const result = await act(item.id, { type: 'link', targets: [ZOLL] });
    expect(
      result.relations.map((r) => [
        r.effect,
        r.relation.type,
        r.relation.from,
        r.relation.to,
        r.relation.status,
      ]),
    ).toEqual([
      ['manual', 'manual', LAGER, ZOLL, 'accepted'],
      ['manual', 'manual', ZOLL, VERSAND, 'accepted'],
    ]);
    expect(result.question).toBeNull();
    expect((await listAll()).some((q) => q.subject.id === SPEDITION)).toBe(false);
  });

  it('places a process without a step and an unsure process, also on @outside', async () => {
    const detail = await getJson<ValueChainDetail>(chainPath(P));
    const step = detail.steps.find((s) => s.depth > 0)?.elementId;
    if (!step) throw new Error('the golden chain has no nested step');
    const lager = find(
      await listAll(),
      (q) => q.kind === 'process-without-step' && q.subject.id === LAGER,
      'Lager without a step',
    );
    expect(lager.actions.map((a) => [a.type, a.primary, a.step ?? null])).toEqual([
      ['place', true, null],
      ['place', false, '@outside'],
      ['note', false, null],
    ]);
    const placed = await act(lager.id, { type: 'place', step });
    expect(placed).toMatchObject({
      question: null,
      relations: [],
      placements: [
        {
          effect: 'manual',
          placement: { elementId: step, process: LAGER, status: 'accepted', tier: 'manual' },
        },
      ],
    });
    expect((await listAll()).some((q) => q.id === lager.id)).toBe(false);
    // „Rückgängig“: the placement rejected, the item back.
    const placement = placed.placements[0]?.placement;
    if (!placement) throw new Error('no placement');
    const undo = await post(owner, chainPath(P, `/placements/${placement.id}/decision`), {
      verdict: 'reject',
      reason: 'Rückgängig gemacht',
    });
    expect(undo.status).toBe(200);
    expect((await listAll()).find((q) => q.id === lager.id)?.state).toBe('open');

    // An agent's unsure verdict, then the process on @outside.
    const probe = asAgent(t, agent.secret);
    const [task] = await claimPlacement(probe, { projectId: P });
    if (!task) throw new Error('no placement task');
    const unsure = task.input.processes.find((p) => p.process !== LAGER)?.process;
    if (!unsure) throw new Error('no process to be unsure about');
    const result = await submitPlacement(
      probe,
      task.taskId,
      placementSubmission(task, [], {
        unsure: [{ process: unsure, reason: 'Kein Schritt passt eindeutig.' }],
      }),
    );
    expect(result.unsure?.counts.stored).toBe(1);
    const asked = find(
      await listAll(),
      (q) => q.kind === 'placement-unsure' && q.subject.id === unsure,
      'the unsure verdict',
    );
    const outside = await act(asked.id, { type: 'place', step: '@outside' });
    expect(outside.placements).toMatchObject([
      {
        effect: 'manual',
        placement: { elementId: '@outside', process: unsure, status: 'accepted' },
      },
    ]);
    const after = await listAll();
    expect(after.some((q) => q.subject.id === unsure && q.kind === 'placement-unsure')).toBe(false);
    expect(after.some((q) => q.subject.id === unsure && q.kind === 'process-without-step')).toBe(
      false,
    );
    // A process item places its own process only, on a step the chain has.
    const zoll = find(
      after,
      (q) => q.kind === 'process-without-step' && q.subject.id === ZOLL,
      'Zoll',
    );
    for (const [body, reason] of [
      [{ type: 'place', step, process: VERSAND }, 'wrong-process'],
      [{ type: 'place', step: 'kein-schritt' }, 'unknown-step'],
    ] as const) {
      const res = await post(owner, `${BASE}/${zoll.id}/actions`, body);
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ reason });
    }
  });

  it("reports a placement on an agent's proposal as its decision, which „Rückgängig“ does not take back", async () => {
    const detail = await getJson<ValueChainDetail>(chainPath(P));
    const step = detail.steps.find((s) => s.depth > 0)?.elementId;
    if (!step) throw new Error('the golden chain has no nested step');
    const proposed = await post(asAgent(t, agent.secret), chainPath(P, '/placements'), {
      kind: 'propose',
      placements: [
        { step, process: ZOLL, confidence: 0.6, rationale: 'Der Zoll gehört zu diesem Schritt.' },
      ],
    });
    expect(proposed.status, await proposed.clone().text()).toBe(200);
    const zoll = find(
      await listAll(),
      (q) => q.kind === 'process-without-step' && q.subject.id === ZOLL,
      'Zoll with a proposed placement',
    );
    expect(zoll.actions.map((a) => [a.type, a.primary])).toEqual([
      ['decide', true],
      ['place', false],
      ['place', false],
      ['note', false],
    ]);
    // „Anderen Schritt wählen …“ on the proposed step decides the agent's proposal.
    const placed = await act(zoll.id, { type: 'place', step });
    expect(placed.placements).toMatchObject([
      {
        effect: 'decision',
        placement: {
          id: zoll.actions[0]?.decides?.[0]?.id,
          elementId: step,
          process: ZOLL,
          status: 'accepted',
        },
      },
    ]);
    expect(placed.question).toBeNull();
  });

  it('chooses the valid copy all or nothing, places the other outside, keeps the note; a new caller brings it back', async () => {
    const item = find(await listAll(), (q) => q.kind === 'duplicate-process-id', 'the duplicate');
    const action = item.actions[0];
    const [stale, ...rest] = action?.decides ?? [];
    const copies = action?.choices ?? [];
    expect(copies).toHaveLength(2);
    const valid = copies.find((c) => !c.includes('/archiv/'));
    const old = copies.find((c) => c.includes('/archiv/'));
    if (!stale || !valid || !old) throw new Error('no calls or copies');
    // A stale version: 409, nothing written.
    const seq = await lastSeq();
    const conflict = await post(owner, `${BASE}/${item.id}/actions`, {
      type: 'choose-copy',
      process: valid,
      items: [
        { id: stale.id, version: stale.version + 1 },
        ...rest.map((d) => ({ id: d.id, version: d.version })),
      ],
      placeOthersOutside: true,
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      code: 'conflict',
      mismatches: [{ id: stale.id, reason: 'version', version: stale.version }],
    });
    expect(await lastSeq()).toBe(seq);
    // Not one of the copies: 422.
    const notCopy = await post(owner, `${BASE}/${item.id}/actions`, {
      type: 'choose-copy',
      process: ZOLL,
      items: (action?.decides ?? []).map((d) => ({ id: d.id, version: d.version })),
      placeOthersOutside: false,
    });
    expect(notCopy.status).toBe(422);

    const note = 'Gültig ist die aktuelle Bestellfreigabe; die Kopie im Archiv ist veraltet.';
    const result = await act(item.id, {
      type: 'choose-copy',
      process: valid,
      items: (action?.decides ?? []).map((d) => ({ id: d.id, version: d.version })),
      placeOthersOutside: true,
      note,
    });
    expect(result.question).toBeNull();
    expect(
      result.relations.map((r) => [r.effect, r.relation.to, r.relation.status]).sort(),
    ).toEqual(
      (action?.decides ?? [])
        .map((d) => {
          const r = result.relations.find((x) => x.relation.id === d.id)?.relation;
          return ['decision', r?.to, r?.to === valid ? 'accepted' : 'rejected'];
        })
        .sort(),
    );
    expect(result.relations.some((r) => r.relation.status === 'accepted')).toBe(true);
    expect(result.relations.some((r) => r.relation.status === 'rejected')).toBe(true);
    expect(
      result.relations.find((r) => r.relation.status === 'rejected')?.relation.provenance
        ?.rationale,
    ).toMatch(
      /^Aus „Offene Fragen“: Gültig ist .*; diese Kopie ist veraltet oder eine Variante\.$/,
    );
    expect(result.placements).toMatchObject([
      { effect: 'manual', placement: { elementId: '@outside', process: old, status: 'accepted' } },
    ]);
    expect(result.placements[0]?.placement.provenance?.rationale).toMatch(
      /^Aus „Offene Fragen“: Veraltete Kopie; gültig ist /,
    );
    // The note: a note on the item, no mark.
    expect(result.answer).toMatchObject({ kind: 'answer', role: 'note', text: note });
    expect((await listAll()).some((q) => q.kind === 'duplicate-process-id')).toBe(false);
    // „Befunde“ still lists the duplicate.
    const findings = await getJson<FindingList>(`${API}/findings`);
    expect(findings.items.some((f) => f.kind === 'duplicate-process-id')).toBe(true);

    // A new caller's proposal to a copy brings the item back, with its note, still open.
    await proposeCall(FRAUD_CHECK, old);
    const back = find(
      await listAll(),
      (q) => q.kind === 'duplicate-process-id',
      'the duplicate, back',
    );
    expect(back).toMatchObject({ id: item.id, state: 'open' });
    expect(back.answers.map((a) => [a.role, a.text])).toEqual([['note', note]]);
  });

  it('keeps an external-partner mark when a re-judgement replaces its coded no-link', async () => {
    const probe = asAgent(t, agent.secret);
    const judge = async (reason: string) => {
      const [task] = await claim(probe, { projectId: P, modelKey: ORDER });
      if (!task) throw new Error('no relations task for the order model');
      const pair = task.input.candidates.find(
        (c) => c[0] === 'message' && c[1] === SEND_CONFIRMATION,
      );
      if (!pair) throw new Error('no message pair at the confirmation');
      const result = await submit(
        probe,
        task.taskId,
        submission(task, [], {
          llmModel: 'probe',
          noLinks: [{ type: 'message', from: pair[1], to: pair[2], reason }],
        }),
      );
      expect(result.noLinks?.counts.stored).toBe(1);
    };
    await judge('collaboration: Die Bestätigung geht an den Kunden-Pool.');
    const partner = find(await listAll(), (q) => q.kind === 'external-partner', 'the partner');
    expect(partner.subject.id).toBe(SEND_CONFIRMATION);
    expect(partner.actions.map((a) => [a.type, a.primary])).toEqual([
      ['outside', true],
      ['link', false],
      ['note', false],
    ]);
    await act(partner.id, { type: 'outside' });
    // Another element of the model changes (a re-import): the old no-link is no longer
    // current; the re-judgement replaces it with the same code.
    const xml = (
      await readFile(
        new URL(`../../../../eval/corpus/${P}/models/${ORDER}.bpmn`, import.meta.url),
        'utf8',
      )
    ).replace('name="Validate order"', 'name="Check order"');
    expect((await t.putModel(P, ORDER, xml)).status).toBe(200);
    expect((await listAll()).some((q) => q.kind === 'external-partner')).toBe(false);
    await judge('collaboration: Der Kunde bekommt die Bestätigung per E-Mail.');
    const after = find(await listAll(), (q) => q.kind === 'external-partner', 'the partner, again');
    expect(after).toMatchObject({
      id: partner.id,
      state: 'answered',
      text: 'collaboration: Der Kunde bekommt die Bestätigung per E-Mail.',
    });
  });

  it('refuses an action the item does not offer and a link it cannot take; requeue stays write', async () => {
    const items = await listAll();
    const call = find(
      items,
      (q) => q.source === 'finding' && q.subject.id === FRAUD_CHECK,
      'the fraud check',
    );
    for (const [body, reason] of [
      [{ type: 'place', step: '@outside' }, 'action-not-offered'],
      [
        {
          type: 'choose-copy',
          process: ZOLL,
          items: [{ id: 'rel_01AAAAAAAAAAAAAAAAAAAAAAAA', version: 1 }],
          placeOthersOutside: false,
        },
        'action-not-offered',
      ],
      [{ type: 'link', targets: [ZOLL, LAGER] }, 'too-many-targets'],
      [{ type: 'link', targets: [`${ORDER}#Process_OrderHandling`] }, 'same-process'],
      [{ type: 'link', targets: [SEND_CONFIRMATION] }, 'not-a-process'],
      [{ type: 'link', targets: ['x/y#Z'] }, 'unknown-ref'],
    ] as const) {
      const res = await post(owner, `${BASE}/${call.id}/actions`, body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(await res.json(), JSON.stringify(body)).toMatchObject({
        code: 'validation-failed',
        reason,
      });
    }
    // A body without targets or with both a pair and targets fails validation.
    expect(
      (await post(owner, `${BASE}/${call.id}/actions`, { type: 'link', targets: [] })).status,
    ).toBe(422);
    // An agent with `analyzr:write` requeues (no human decision); it never acts.
    const requeued = await post(asAgent(t, writer.secret), `${API}/analyses/requeue`, {
      modelKeys: [ORDER],
    });
    expect(requeued.status).toBe(200);
    const refused = await post(asAgent(t, writer.secret), `${BASE}/${call.id}/actions`, {
      type: 'outside',
    });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: 'human-decision-required' });
  });
});

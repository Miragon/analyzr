/**
 * Answers to open questions end to end (M6 S5a, §4.5): `nordwind-handel`
 * imported with the real libraries and its golden value chain created, as
 * `analyzr seed --value-chains` does. Requires (§8 "S5a"):
 * - an answer on a held relation is a human note on it, one
 *   `open_question_answer` row links it, the item turns `answered` (also for
 *   the `state` filter) and the next claim of the relation's model shows
 *   the note; it queues nothing (no task, no `analysis.*` event, no
 *   placement input changes); the same answer again is `unchanged` and
 *   writes nothing;
 * - a subject answer keeps its text, marks the item answered until its
 *   source changes (a new `facts_hash` gives the item a new id), and never
 *   dismisses the finding behind it;
 * - the CSV round trip: the preview lists unknown, changed and invalid ids
 *   and stores nothing; the real call stores the rest in one transaction;
 *   a sheet read back again is `unchanged`, also with the line breaks and
 *   Unicode form a spreadsheet writes (texts are stored normalized);
 * - humans only (agents get `human-decision-required` with the tab's URL),
 *   ids that name no current item are 404, the table is append-only and its
 *   checks hold.
 * The placement cases (an agent's question: a note, the process due,
 * nothing queued; a held placement: a note, the hold stays, nothing due)
 * run on the placement pipeline's fixtures (`placement-pipeline.test.ts`).
 */
import { readFile } from 'node:fs/promises';

import {
  AnswerOpenQuestionResult,
  AnswerSheetResult,
  MAX_ANSWER_SHEET_BODY_BYTES,
  OpenQuestionPage,
  readAnswerSheet,
  type CreatedAgentToken,
  type DecisionResult,
  type FindingList,
  type OpenQuestion,
  type Relation,
  type RelationAssertionList,
  type RelationPage,
} from '@analyzr/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { libraryAnalysis } from '../../src/analysis.ts';
import { startTestApp, type TestApp } from '../support/app.ts';
import { corpusFiles, importAll } from '../support/corpus.ts';
import { createTestDatabase, type TestDatabase } from '../support/db.ts';
import { asAgent, claim, post } from '../support/pipeline.ts';
import { NORDWIND_CHAIN, chainPath } from '../support/value-chain.ts';

const P = 'nordwind-handel';
const BASE = `/api/v1/projects/${P}/open-questions`;
const ORDER = 'vertrieb/order-handling';
const FRAUD_CHECK = `${ORDER}#Call_FraudCheck`;

let database: TestDatabase;
let t: TestApp;
let agent: CreatedAgentToken;

const owner = (path: string, init?: RequestInit) => t.asOwner(path, init);

async function getJson<T>(path: string): Promise<T> {
  const res = await owner(path);
  if (res.status !== 200) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Every open question matching `query`, checked against the contract. */
async function listAll(query = ''): Promise<OpenQuestion[]> {
  const page = OpenQuestionPage.parse(await getJson(`${BASE}?limit=200${query}`));
  expect(page.nextCursor).toBeNull();
  return page.items;
}

function answer(id: string, body: unknown, call = owner): Promise<Response> {
  return post(call, `${BASE}/${id}/answers`, body);
}

/** The project's `open_question_answer` rows, oldest first. */
async function rows(): Promise<Record<string, unknown>[]> {
  return (
    await database.db.execute(
      sql`SELECT a.question_id, a.subject_type, a.subject_id, a.kind, a.text, a.note_assertion_id,
                 a.source_kind, a.seq
          FROM open_question_answer a JOIN project p ON p.id = a.project_id
          WHERE p.key = ${P} ORDER BY a.seq`,
    )
  ).rows;
}

async function lastSeq(): Promise<number> {
  const r = await database.db.execute<{ last_seq: string }>(
    sql`SELECT last_seq FROM project WHERE key = ${P}`,
  );
  return Number(r.rows[0]?.last_seq);
}

/** What queueing touches: the project's analysis tasks and placement inputs. */
async function queueState(): Promise<{ tasks: unknown[]; inputs: unknown[] }> {
  const tasks = await database.db.execute(
    sql`SELECT t.id, t.state, t.kind, t.subject_kind FROM analysis_task t
        JOIN project p ON p.id = t.project_id WHERE p.key = ${P} ORDER BY t.id`,
  );
  const inputs = await database.db.execute(
    sql`SELECT i.process_ref, i.input_hash, i.outcome FROM placement_input i
        JOIN project p ON p.id = i.project_id WHERE p.key = ${P} ORDER BY i.process_ref`,
  );
  return { tasks: tasks.rows, inputs: inputs.rows };
}

/** The types of the project's events after `seq`. */
async function eventTypes(after: number): Promise<string[]> {
  const r = await database.db.execute<{ type: string }>(
    sql`SELECT e.type FROM event e JOIN project p ON p.id = e.project_id
        WHERE p.key = ${P} AND e.seq > ${after} ORDER BY e.seq`,
  );
  return r.rows.map((row) => row.type);
}

/** The message of the database error a statement raises. */
async function failure(statement: ReturnType<typeof sql.raw>): Promise<string> {
  try {
    await database.db.execute(statement);
  } catch (err) {
    const cause = (err as { cause?: { message?: string } }).cause;
    return cause?.message ?? String(err);
  }
  throw new Error('statement succeeded');
}

beforeAll(async () => {
  database = await createTestDatabase();
  t = startTestApp(database, { analysis: libraryAnalysis });
  await t.createProject(P, P);
  const outcomes = await importAll(owner, P, await corpusFiles(P));
  expect(outcomes.every((o) => o.outcome === 'created')).toBe(true);
  const saved = await t.asOwner(chainPath(P, '/content'), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'if-none-match': '*' },
    body: await readFile(NORDWIND_CHAIN),
  });
  expect(saved.status).toBe(201);
  agent = await t.createToken(P, ['analyzr:read', 'analyzr:propose']);
}, 180_000);

afterAll(async () => {
  await database?.drop();
});

describe('answers to open questions on nordwind-handel', () => {
  let held: Relation;
  let heldItem: OpenQuestion;

  it('records an answer on a held relation as a human note on it, linked by one row', async () => {
    const proposed = await getJson<RelationPage>(
      `/api/v1/projects/${P}/relations?status=proposed&limit=200`,
    );
    const target = proposed.items.find((r) => r.type === 'message');
    if (!target) throw new Error('the rule tier proposed no message relation');
    const hold = await post(owner, `/api/v1/projects/${P}/relations/${target.id}/decision`, {
      verdict: 'hold',
      note: 'Mit dem Fachbereich klären.',
      question: 'Gilt diese Verbindung in jedem Fall?',
    });
    expect(hold.status).toBe(200);
    held = ((await hold.json()) as DecisionResult).relation;
    const before = await listAll();
    const item = before.find((q) => q.kind === 'held' && q.subject.id === target.id);
    if (!item) throw new Error('the held relation is no open question');
    expect(item).toMatchObject({ state: 'open', answers: [] });

    const text = 'Ja, immer. Rückfragen an max.muster@example.org.';
    const queued = await queueState();
    expect(queued.tasks.length).toBeGreaterThan(0);
    const answeredAt = await lastSeq();
    const res = await answer(item.id, { text: `  ${text}\n`, kind: 'answer' });
    expect(res.status).toBe(201);
    // Live-run neutral: the answer queues nothing (S5b would); only its note and its event.
    expect(await queueState()).toEqual(queued);
    const types = await eventTypes(answeredAt);
    expect(types.filter((type) => type.startsWith('analysis.'))).toEqual([]);
    expect(types.at(-1)).toBe('open_question.answered');
    const result = AnswerOpenQuestionResult.parse(await res.json());
    expect(result).toMatchObject({
      result: 'recorded',
      answer: {
        questionId: item.id,
        kind: 'answer',
        target: 'relation-note',
        text,
        note: { type: 'relation', subjectId: target.id },
        by: 'owner',
        sourceKind: 'human',
      },
      question: { id: item.id, state: 'answered' },
      warnings: [{ kind: 'email', start: text.indexOf('max.'), end: text.length - 1 }],
    });
    // The note on the relation: a human note with the trimmed text, status and version unchanged.
    const timeline = await getJson<RelationAssertionList>(
      `/api/v1/projects/${P}/relations/${target.id}/assertions`,
    );
    const note = timeline.items.at(-1);
    expect(note).toMatchObject({
      id: result.answer.note?.assertionId,
      kind: 'note',
      sourceKind: 'human',
      rationale: text,
    });
    expect(await getJson<Relation>(`/api/v1/projects/${P}/relations/${target.id}`)).toMatchObject({
      status: 'held',
      version: held.version,
    });
    // Exactly one row, naming the note and no text.
    expect(await rows()).toEqual([
      {
        question_id: item.id,
        subject_type: 'relation',
        subject_id: target.id,
        kind: 'answer',
        text: null,
        note_assertion_id: note?.id,
        source_kind: 'human',
        seq: String(result.answer.seq),
      },
    ]);
    // The list shows the item answered, as the response did; the state filter agrees.
    const after = await listAll();
    heldItem = after.find((q) => q.id === item.id) as OpenQuestion;
    expect(heldItem).toEqual(result.question);
    expect(after.map((q) => q.id)).toEqual(before.map((q) => q.id));
    expect(await listAll('&state=answered')).toEqual([heldItem]);
    expect((await listAll('&state=open')).some((q) => q.id === item.id)).toBe(false);

    // The same answer again: unchanged, nothing written.
    const seq = await lastSeq();
    const again = await answer(item.id, { text });
    expect(again.status).toBe(200);
    expect(AnswerOpenQuestionResult.parse(await again.json())).toMatchObject({
      result: 'unchanged',
      answer: { id: result.answer.id },
    });
    expect(await lastSeq()).toBe(seq);
    expect(await rows()).toHaveLength(1);

    // The next claim of the relation's model shows the note (as any note today).
    const [task] = await claim(asAgent(t, agent.secret), {
      projectId: P,
      modelKey: target.from.split('#')[0],
    });
    expect(task?.input.relations.find((r) => r.id === target.id)?.notes).toEqual([
      { text, at: expect.any(String) as unknown },
    ]);
  }, 60_000);

  let findingItem: OpenQuestion;

  it('keeps a subject answer with its text until the source changes the id', async () => {
    const before = await listAll();
    const item = before.find((q) => q.source === 'finding' && q.subject.id === FRAUD_CHECK);
    if (!item) throw new Error('no finding on the fraud check');
    const res = await answer(item.id, {
      text: 'Die Betrugsprüfung macht ein Dienstleister.',
      kind: 'outside-landscape',
    });
    expect(res.status).toBe(201);
    const result = AnswerOpenQuestionResult.parse(await res.json());
    expect(result).toMatchObject({
      answer: { kind: 'outside-landscape', target: 'answer', note: null },
      warnings: [],
    });
    expect((await rows()).at(-1)).toMatchObject({
      subject_type: 'ref',
      subject_id: FRAUD_CHECK,
      kind: 'outside-landscape',
      text: 'Die Betrugsprüfung macht ein Dienstleister.',
      note_assertion_id: null,
    });
    findingItem = (await listAll()).find((q) => q.id === item.id) as OpenQuestion;
    expect(findingItem).toEqual(result.question);
    expect(findingItem.state).toBe('answered');

    // „Liegt außerhalb der Landschaft“ marks the item answered, never dismisses the finding.
    const findings = await getJson<FindingList>(`/api/v1/projects/${P}/findings`);
    expect(findings.items.some((f) => f.refs[0] === FRAUD_CHECK)).toBe(true);
  });

  let changedId: string;

  it('opens the item again under a new id when its source changes', async () => {
    const xml = (
      await readFile(
        new URL(`../../../../eval/corpus/${P}/models/${ORDER}.bpmn`, import.meta.url),
        'utf8',
      )
    ).replace('name="Run fraud check"', 'name="Run external fraud check"');
    expect((await t.putModel(P, ORDER, xml)).status).toBe(200);
    const items = await listAll();
    expect(items.some((q) => q.id === findingItem.id)).toBe(false);
    const reopened = items.find((q) => q.source === 'finding' && q.subject.id === FRAUD_CHECK);
    expect(reopened).toMatchObject({ state: 'open', answers: [] });
    changedId = findingItem.id;
    // The held relation is untouched by the other model's change.
    expect(items.find((q) => q.id === heldItem.id)?.state).toBe('answered');
    // The answer stays recorded (append-only), under the old id.
    expect((await rows()).filter((r) => r['question_id'] === changedId)).toHaveLength(1);
  });

  it('previews a sheet without storing anything, then stores it in one call', async () => {
    const csvRes = await owner(`${BASE}/export?format=csv`);
    expect(csvRes.status).toBe(200);
    const sheet = readAnswerSheet(
      new TextDecoder('utf-8', { ignoreBOM: true }).decode(await csvRes.arrayBuffer()),
    ).map(({ id, text, kind }) => ({ id, text, kind }));
    // The answered relation comes with its answer, the rest is empty.
    expect(sheet.filter((r) => r.text !== '')).toEqual([
      { id: heldItem.id, text: heldItem.answers[0]?.text, kind: 'Antwort' },
    ]);
    const [a, b, c, d, e] = sheet.filter((r) => r.text === '');
    if (!a || !b || !c || !d || !e) throw new Error('the sheet has too few questions');
    const filled = sheet.map((r) => {
      if (r.id === a.id) return { ...r, text: 'Gehört zum Vertrieb.', kind: '' };
      if (r.id === b.id) return { ...r, text: 'x'.repeat(2001) };
      if (r.id === c.id) return { ...r, text: 'Vielleicht.', kind: 'Vielleicht' };
      if (r.id === d.id) {
        return { ...r, text: 'Ruf +49 89 1234567 an.', kind: ' wird IM modell ergänzt ' };
      }
      return r;
    });
    filled.push(
      { id: changedId, text: 'Eine Antwort auf eine geänderte Frage.', kind: '' },
      { id: 'q-0000000000000000', text: 'Unbekannt.', kind: '' },
      { id: a.id, text: 'Doppelt.', kind: '' },
      { id: e.id, text: '   ', kind: 'Antwort' },
    );
    const rowOf = (id: string, text?: string) =>
      filled.findIndex((r) => r.id === id && (text === undefined || r.text === text)) + 1;
    const expected = {
      counts: {
        recorded: 2,
        unchanged: 1,
        unknown: 2,
        invalid: 3,
        ignored: sheet.length - 5 + 1,
      },
      rows: [
        { row: rowOf(heldItem.id), outcome: 'unchanged', kind: 'answer', target: 'relation-note' },
        { row: rowOf(a.id, 'Gehört zum Vertrieb.'), outcome: 'recorded', kind: 'answer' },
        { row: rowOf(b.id), outcome: 'invalid', reason: 'too-long' },
        { row: rowOf(c.id), outcome: 'invalid', reason: 'unknown-kind' },
        { row: rowOf(d.id), outcome: 'recorded', kind: 'will-be-modelled' },
        { row: rowOf(changedId), id: changedId, outcome: 'unknown' },
        { row: rowOf('q-0000000000000000'), outcome: 'unknown' },
        { row: rowOf(a.id, 'Doppelt.'), outcome: 'invalid', reason: 'duplicate-id' },
      ].sort((x, y) => x.row - y.row),
    };

    const seq = await lastSeq();
    const stored = (await rows()).length;
    const preview = await post(owner, `${BASE}/answers?dryRun=true`, { rows: filled });
    expect(preview.status).toBe(200);
    const dry = AnswerSheetResult.parse(await preview.json());
    expect(dry).toMatchObject({ dryRun: true, ...expected });
    expect(dry.rows.find((r) => r.row === rowOf(d.id))?.warnings).toEqual([
      { kind: 'phone', start: 4, end: 18 },
    ]);
    expect(dry.rows.find((r) => r.row === rowOf(a.id, 'Gehört zum Vertrieb.'))?.answer).toBe(
      undefined,
    );
    expect(await lastSeq()).toBe(seq);
    expect(await rows()).toHaveLength(stored);

    const real = await post(owner, `${BASE}/answers`, { rows: filled });
    expect(real.status).toBe(200);
    const done = AnswerSheetResult.parse(await real.json());
    expect(done).toMatchObject({ dryRun: false, ...expected });
    expect(await rows()).toHaveLength(stored + 2);
    const items = new Map((await listAll()).map((q) => [q.id, q]));
    expect(items.get(a.id)?.answers.map((x) => x.text)).toEqual(['Gehört zum Vertrieb.']);
    expect(items.get(d.id)?.answers.map((x) => x.kind)).toEqual(['will-be-modelled']);
    for (const id of [b.id, c.id, e.id]) expect(items.get(id)?.state).toBe('open');
    for (const r of done.rows.filter((x) => x.outcome === 'recorded')) {
      expect(items.get(r.id)?.answers).toEqual([r.answer]);
    }

    // The same sheet again: nothing new.
    const repeat = AnswerSheetResult.parse(
      await (await post(owner, `${BASE}/answers`, { rows: filled })).json(),
    );
    expect(repeat.counts).toMatchObject({ recorded: 0, unchanged: 3 });
    expect(await rows()).toHaveLength(stored + 2);

    // A CRLF answer with decomposed umlauts (curl on Windows, another program) is stored
    // with LF and composed, so the sheet a spreadsheet saves again matches it.
    const crlf = AnswerOpenQuestionResult.parse(
      await (
        await answer(a.id, { text: 'Gehört zum\r\nVertrieb, nicht zum Einkauf.'.normalize('NFD') })
      ).json(),
    );
    expect(crlf.answer.text).toBe('Gehört zum\nVertrieb, nicht zum Einkauf.');
    expect((await rows()).at(-1)?.['text']).toBe('Gehört zum\nVertrieb, nicht zum Einkauf.');
    const resaved = AnswerSheetResult.parse(
      await (
        await post(owner, `${BASE}/answers?dryRun=true`, {
          rows: [{ id: a.id, text: 'Gehört zum\nVertrieb, nicht zum Einkauf.', kind: 'Antwort' }],
        })
      ).json(),
    );
    expect(resaved.rows).toMatchObject([{ outcome: 'unchanged', answer: { id: crlf.answer.id } }]);
    // Going back to the earlier answer records it again: the latest answer is the current one.
    const back = AnswerSheetResult.parse(
      await (
        await post(owner, `${BASE}/answers`, {
          rows: [{ id: a.id, text: 'Gehört zum Vertrieb.', kind: '' }],
        })
      ).json(),
    );
    expect(back.counts).toMatchObject({ recorded: 1, unchanged: 0 });
    expect((await listAll()).find((q) => q.id === a.id)?.answers.map((x) => x.text)).toEqual([
      'Gehört zum Vertrieb.',
      'Gehört zum\nVertrieb, nicht zum Einkauf.',
      'Gehört zum Vertrieb.',
    ]);
  }, 60_000);

  it('lets only humans answer, and only current questions', async () => {
    const agentCall = asAgent(t, agent.secret);
    const denied = await answer(heldItem.id, { text: 'Ich bin ein Agent.' }, agentCall);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({
      code: 'human-decision-required',
      reviewUrl: `http://localhost/projects/${P}/open-questions`,
    });
    const deniedSheet = await post(agentCall, `${BASE}/answers?dryRun=true`, { rows: [] });
    expect(deniedSheet.status).toBe(403);
    // A credential of another project does not see this one.
    await t.createProject('andere');
    const other = await t.createToken('andere', ['analyzr:read', 'analyzr:propose']);
    const foreign = await answer(heldItem.id, { text: 'Fremd.' }, asAgent(t, other.secret));
    expect(foreign.status).toBe(404);
    expect((await answer('q-0000000000000000', { text: 'Wer?' })).status).toBe(404);
    expect((await answer(changedId, { text: 'Zu spät.' })).status).toBe(404);
    expect((await answer('nope', { text: 'Wer?' })).status).toBe(422);
    expect((await answer(heldItem.id, { text: '   ' })).status).toBe(422);
    expect((await answer(heldItem.id, { text: 'x'.repeat(2001) })).status).toBe(422);
    expect((await answer(heldItem.id, { text: 'Ja.', kind: 'maybe' })).status).toBe(422);
    const big = await post(owner, `${BASE}/answers?dryRun=true`, {
      rows: [{ id: heldItem.id, text: 'x'.repeat(MAX_ANSWER_SHEET_BODY_BYTES), kind: '' }],
    });
    expect(big.status).toBe(413);
    expect(await big.json()).toMatchObject({ code: 'payload-too-large' });
  });

  it('keeps the table append-only, humans-only and one text per answer', async () => {
    for (const [statement, message] of [
      [
        'UPDATE open_question_answer SET kind = kind',
        /open_question_answer is append-only: UPDATE/,
      ],
      ['DELETE FROM open_question_answer', /open_question_answer is append-only: DELETE/],
      ['TRUNCATE open_question_answer', /is append-only: TRUNCATE/],
    ] as const) {
      expect(await failure(sql.raw(statement))).toMatch(message);
    }
    const insert = (columns: string) =>
      sql.raw(
        `INSERT INTO open_question_answer (id, project_id, question_id, subject_type, subject_id,
           kind, text, note_assertion_id, principal_id, source_kind, seq)
         SELECT 'oqa_x', a.project_id, a.question_id, ${columns}, a.principal_id, a.source_kind, 999
         FROM open_question_answer a WHERE a.subject_type = 'relation' LIMIT 1`,
      );
    // An agent's answer; a relation answer with a text instead of its note; a note of
    // another relation.
    expect(
      await failure(
        sql.raw(
          `INSERT INTO open_question_answer (id, project_id, question_id, subject_type, subject_id,
             kind, text, principal_id, source_kind, seq)
           SELECT 'oqa_y', a.project_id, a.question_id, 'ref', 'x#y', 'answer', 'Text',
             a.principal_id, 'agent', 999
           FROM open_question_answer a LIMIT 1`,
        ),
      ),
    ).toMatch(/open_question_answer_humans_only/);
    expect(await failure(insert(`a.subject_type, a.subject_id, a.kind, 'Text', NULL`))).toMatch(
      /open_question_answer_text_or_note/,
    );
    expect(await failure(insert(`'ref', 'x#y', a.kind, NULL, a.note_assertion_id`))).toMatch(
      /open_question_answer_text_or_note/,
    );
    expect(
      await failure(
        insert(
          `a.subject_type, 'rel_00000000000000000000000000', a.kind, NULL, a.note_assertion_id`,
        ),
      ),
    ).toMatch(/open_question_answer_relation_note_fk/);
  });
});

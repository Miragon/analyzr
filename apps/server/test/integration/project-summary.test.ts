/**
 * The project summary over REST (UX9, UX-SIMPLIFICATION §3.12 item 1)
 * against PostgreSQL: the counts equal the lists the project tabs' badges
 * count (the relations to review, the open placements on the chain, the open
 * questions' `totals.ask` of `state=open`) through proposals, decisions, a
 * hold, a deleted model and an agent's placement; `lastEventAt` is the latest
 * event's time; every member reads it, other credentials get the usual 401
 * and 404; an unchanged project answers from the memo, a write builds the
 * read model again. Synthetic models and chain only.
 */
import {
  OpenQuestionPage,
  ProjectSummary,
  type Landscape,
  type Model,
  type ModelPage,
  type Project,
  type Relation,
  type ValueChainDetail,
} from '@analyzr/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { placementsProcedure, relationsProcedure } from '../../src/app.ts';
import { createStore } from '../../src/db/store.ts';
import type { Store } from '../../src/domain/ports.ts';
import { projectUseCases } from '../../src/domain/use-cases/projects.ts';
import { startTestApp, type TestApp } from '../support/app.ts';
import { createTestDatabase, type TestDatabase } from '../support/db.ts';
import { fakeBpmn } from '../support/fake-analysis.ts';
import { chain, chainPath } from '../support/value-chain.ts';

let database: TestDatabase;
let t: TestApp;
let project: Project;
let viewer: { secret: string };
let agent: { secret: string };
let foreign: { secret: string };

const P = 'summary';
const API = `/api/v1/projects/${P}`;

const MODELS = {
  'vertrieb/annahme': fakeBpmn({
    processes: [
      {
        id: 'P_Annahme',
        name: 'Auftragsannahme',
        elements: [
          { kind: 'call', id: 'Call_Pick', name: 'Kommissionieren', ref: 'P_Pick' },
          { kind: 'msg_throw', id: 'Throw_Faellig', name: 'Rechnung fällig', ref: 'Faellig' },
        ],
      },
    ],
  }),
  'finanzen/mahnlauf': fakeBpmn({
    processes: [
      {
        id: 'P_Mahn',
        name: 'Mahnlauf',
        elements: [
          { kind: 'msg_catch', id: 'Catch_Faellig', name: 'Rechnung fällig', ref: 'Faellig' },
        ],
      },
    ],
  }),
  'lager/kommission': fakeBpmn({ processes: [{ id: 'P_Pick', name: 'Picking' }] }),
};

const post = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

async function json<T>(res: Response, status = 200): Promise<T> {
  const text = await res.text();
  expect(res.status, text.slice(0, 500)).toBe(status);
  return JSON.parse(text) as T;
}

type Call = (path: string, init?: RequestInit) => Promise<Response>;
const owner: Call = (path, init) => t.asOwner(path, init);

async function summary(key = P, call: Call = owner): Promise<ProjectSummary> {
  return ProjectSummary.parse(await json(await call(`/api/v1/projects/${key}/summary`)));
}

/** A proposal, or an accepted item whose endpoint changed or is missing (the badges' rule). */
const waits = (item: { status: string; endpointState: string }) =>
  item.status === 'proposed' || (item.status === 'accepted' && item.endpointState !== 'ok');

/** The counts as the web's badges compute them from the lists they load. */
async function badges(): Promise<Omit<ProjectSummary, 'lastEventAt'>> {
  const landscape = await json<Landscape>(await t.asOwner(`${API}/landscape`));
  const chainRes = await t.asOwner(chainPath(P));
  const detail = chainRes.status === 404 ? null : await json<ValueChainDetail>(chainRes);
  const questions = OpenQuestionPage.parse(
    await json(await t.asOwner(`${API}/open-questions?state=open&group=ask&limit=1`)),
  );
  return {
    reviewItems: landscape.relations.filter(waits).length,
    openPlacements: detail?.placements.filter(waits).length ?? 0,
    ask: questions.totals.ask,
  };
}

/** The time of the project's latest event, from the event table. */
async function latestEventAt(id = project.id): Promise<string> {
  const events = await createStore(database.db).read((tx) =>
    tx.events.list(id, { afterSeq: 0, limit: 10_000 }),
  );
  const last = events.at(-1);
  if (!last) throw new Error('no event');
  return last.at.toISOString();
}

async function relation(type: Relation['type']): Promise<Relation> {
  const landscape = await json<Landscape>(await t.asOwner(`${API}/landscape`));
  const found = landscape.relations.find((r) => r.type === type);
  if (!found) throw new Error(`no ${type} relation`);
  return found;
}

beforeAll(async () => {
  database = await createTestDatabase();
  t = startTestApp(database);
  project = await t.createProject(P);
  await t.createProject('summary-empty');
  await t.createProject('summary-other');
  viewer = await t.createToken(P, ['analyzr:read']);
  agent = await t.createToken(P, ['analyzr:read', 'analyzr:propose']);
  foreign = await t.createToken('summary-other', ['analyzr:read', 'analyzr:propose']);
});

afterAll(async () => {
  await database?.drop();
});

describe('GET /projects/{project}/summary', () => {
  it('answers zeros and the creation time for an empty project', async () => {
    const empty = await json<Project>(await t.asOwner('/api/v1/projects/summary-empty'));
    expect(await summary('summary-empty')).toEqual({
      lastEventAt: await latestEventAt(empty.id),
      reviewItems: 0,
      openPlacements: 0,
      ask: 0,
    });
  });

  it('counts what the badges count, through decisions, a hold and a deleted model', async () => {
    for (const [key, xml] of Object.entries(MODELS)) {
      expect((await t.putModel(P, key, xml)).status).toBe(201);
    }
    // The unambiguous call is accepted by the rule tier, the message a key-tier proposal.
    const first = await summary();
    expect(first).toEqual({ lastEventAt: await latestEventAt(), ...(await badges()) });
    expect(first).toMatchObject({ reviewItems: 1, openPlacements: 0 });
    expect((await relation('call')).status).toBe('accepted');

    // Held: no longer a relation to review, one more question to clarify.
    const message = await relation('message');
    expect(message.status).toBe('proposed');
    await json(
      await t.asOwner(
        `${API}/relations/${message.id}/decision`,
        post({ verdict: 'hold', note: 'Beim Kunden nachfragen.' }),
      ),
    );
    const held = await summary();
    expect(held).toEqual({ lastEventAt: await latestEventAt(), ...(await badges()) });
    expect(held.reviewItems).toBe(0);
    expect(held.ask).toBe(first.ask + 1);
    expect(held.lastEventAt > first.lastEventAt).toBe(true);

    // Accepted: nothing left to decide or to clarify about it.
    await json(
      await t.asOwner(`${API}/relations/${message.id}/decision`, post({ verdict: 'accept' })),
    );
    const accepted = await summary();
    expect(accepted).toEqual({ lastEventAt: await latestEventAt(), ...(await badges()) });
    expect(accepted).toMatchObject({ reviewItems: 0, ask: first.ask });

    // A deleted callee: the accepted call's endpoint is missing, so it waits for a decision.
    const models = await json<ModelPage>(await t.asOwner(`${API}/models`));
    const callee = models.items.find((m: Model) => m.key === 'lager/kommission');
    expect((await t.asOwner(`${API}/models/${callee?.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await relation('call')).endpointState).toBe('missing');
    const missing = await summary();
    expect(missing).toEqual({ lastEventAt: await latestEventAt(), ...(await badges()) });
    expect(missing.reviewItems).toBe(1);
  });

  it('counts the open placements of the value chain', async () => {
    const created = await t.asOwner(chainPath(P, '/content'), {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'if-none-match': '*' },
      body: JSON.stringify(
        chain({
          steps: [
            { id: 'step-verkauf', name: 'Verkauf' },
            { id: 'step-fakt', name: 'Fakturierung' },
          ],
          sequence: [['step-verkauf', 'step-fakt']],
        }),
      ),
    });
    expect(created.status).toBe(201);
    const before = await summary();
    expect(before).toEqual({ lastEventAt: await latestEventAt(), ...(await badges()) });
    await json(
      await t.asToken(
        agent.secret,
        chainPath(P, '/placements'),
        post({
          kind: 'propose',
          placements: [
            {
              step: 'step-fakt',
              process: 'finanzen/mahnlauf#P_Mahn',
              confidence: 0.7,
              rationale: 'Mahnt offene Rechnungen.',
            },
          ],
        }),
      ),
    );
    const after = await summary();
    expect(after).toEqual({ lastEventAt: await latestEventAt(), ...(await badges()) });
    expect(after.openPlacements).toBe(before.openPlacements + 1);
  });

  it('is readable by every member and by the project id; others get 401 or 404', async () => {
    const asViewer = (path: string, init?: RequestInit) => t.asToken(viewer.secret, path, init);
    expect(await summary(P, asViewer)).toEqual(await summary());
    expect(await summary(project.id)).toEqual(await summary());
    const other = await t.asToken(foreign.secret, `${API}/summary`);
    expect(other.status).toBe(404);
    expect(await other.json()).toMatchObject({ code: 'not-found' });
    expect((await t.request(`${API}/summary`)).status).toBe(401);
    expect((await t.asOwner('/api/v1/projects/nope/summary')).status).toBe(404);
  });

  it('answers an unchanged project from the memo and builds it again after a write', async () => {
    const key = 'summary-memo';
    await t.createProject(key);
    for (const model of ['vertrieb/annahme', 'finanzen/mahnlauf'] as const) {
      expect((await t.putModel(key, model, MODELS[model])).status).toBe(201);
    }
    // Use cases of their own over a store that counts the read model's loads.
    let loads = 0;
    const base = createStore(database.db);
    const store: Store = {
      read: (fn) =>
        base.read((tx) =>
          fn({
            ...tx,
            facts: {
              ...tx.facts,
              headProjectFacts: (projectId) => {
                loads++;
                return tx.facts.headProjectFacts(projectId);
              },
            },
          }),
        ),
      write: (fn) => base.write(fn),
    };
    const useCases = projectUseCases({
      store,
      analysis: t.analysis,
      clock: { now: () => new Date() },
      notifier: database.notifier,
      expectedProcedure: relationsProcedure,
      expectedPlacementProcedure: placementsProcedure,
    });
    const actor = await t.useCases.localOwnerActor('analyzr-web');

    const first = await useCases.getProjectSummary(actor, key);
    expect(first).toEqual(await summary(key));
    expect(first.reviewItems).toBe(1);
    expect(loads).toBe(1);
    expect(await useCases.getProjectSummary(actor, key)).toEqual(first);
    expect(loads).toBe(1);

    // The policy still runs before the memo: a foreign token gets 404, not the memoized summary.
    const outsider = await t.useCases.authenticateAgentToken(foreign.secret);
    if (!outsider) throw new Error('the foreign token does not authenticate');
    await expect(useCases.getProjectSummary(outsider, key)).rejects.toMatchObject({
      code: 'not-found',
    });

    // A decision is a write: it advances lastSeq, so the summary is built again.
    const landscape = await json<Landscape>(await t.asOwner(`/api/v1/projects/${key}/landscape`));
    const message = landscape.relations.find((r) => r.type === 'message');
    expect(message?.status).toBe('proposed');
    await json(
      await t.asOwner(
        `/api/v1/projects/${key}/relations/${message?.id}/decision`,
        post({ verdict: 'hold', note: 'Beim Kunden nachfragen.' }),
      ),
    );
    const held = await useCases.getProjectSummary(actor, key);
    expect(loads).toBe(2);
    expect(held).toEqual(await summary(key));
    expect(held).toMatchObject({ reviewItems: 0, ask: first.ask + 1 });
    expect(held.lastEventAt > first.lastEventAt).toBe(true);
    expect(await useCases.getProjectSummary(actor, key)).toEqual(held);
    expect(loads).toBe(2);
  });

  it('leaves the project resource as it was (MCP list_projects reads it)', async () => {
    const read = await json<Record<string, unknown>>(await t.asOwner(API));
    expect(Object.keys(read).sort()).toEqual(['createdAt', 'id', 'key', 'lastSeq', 'name', 'role']);
  });
});

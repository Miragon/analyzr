/**
 * `analyzr models list|requeue|delete` against a fake REST API (M6 S1): list
 * pages through `GET …/models`; requeue sends `{modelKeys}` or `{all: true}`
 * and reports each outcome; delete resolves keys to ids through the list,
 * refuses an agent token before any request, stops on unknown keys before
 * deleting anything and deletes only with `--yes`.
 */
import { rm } from 'node:fs/promises';

import type { Model } from '@analyzr/contracts';
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

function model(key: string, extra: Partial<Model> = {}): Model {
  return {
    id: `mdl_${key.replaceAll('/', '_')}`,
    projectId: 'prj_1',
    key,
    name: null,
    headRevisionId: 'rev_1',
    headRev: 1,
    engine: 'c7',
    stage: 'waiting_for_agent',
    openItems: 0,
    source: null,
    trust: null,
    updatedAt: '2026-10-15T10:00:00.000Z',
    ...extra,
  };
}

const MODELS = 'GET /api/v1/projects/p/models';

/** `GET …/models` in pages of two, following the cursor. */
function pagedModels(all: readonly Model[]) {
  return (_req: Request, url: URL) => {
    const start = Number(url.searchParams.get('cursor') ?? '0');
    const next = start + 2;
    return json({
      items: all.slice(start, next),
      nextCursor: next < all.length ? String(next) : null,
    });
  };
}

describe('analyzr models list', () => {
  const all = [
    model('finanzen/mahnwesen', { headRev: 3, openItems: 2, stage: 'waiting_for_review' }),
    model('finanzen/rechnung', { engine: null }),
    model('vertrieb/auftrag', { engine: 'c8', openItems: 1 }),
  ];

  it('lists every page with key, stage, head revision, engine and open items (any credential)', async () => {
    const api = fakeApi({ [MODELS]: pagedModels(all) });
    const t = testIo({ ANALYZR_TOKEN: AGENT_TOKEN }, api.fetch, { cwd: dir });
    expect(await runCli(['models', 'list', '-p', 'p'], t.io)).toBe(0);
    expect(api.seen).toHaveLength(2);
    expect(api.seen[0]?.authorization).toBe(`Bearer ${AGENT_TOKEN}`);
    expect(t.out()).toBe(
      [
        '  finanzen/mahnwesen  waiting_for_review  r3    c7  2 open items',
        '  finanzen/rechnung   waiting_for_agent   r1    -   0 open items',
        '  vertrieb/auftrag    waiting_for_agent   r1    c8  1 open item',
        'p: 3 models',
        '',
      ].join('\n'),
    );
  });

  it('filters by stage, checked before any request, and prints JSON', async () => {
    const api = fakeApi({
      [MODELS]: (_req, url) => {
        expect(url.searchParams.get('stage')).toBe('agent_failed');
        expect(url.searchParams.get('limit')).toBe('200');
        return json({ items: [all[1]], nextCursor: null });
      },
    });
    const t = owner(api.fetch);
    expect(
      await runCli(['models', 'list', '-p', 'p', '--stage', 'agent_failed', '--json'], t.io),
    ).toBe(0);
    expect(JSON.parse(t.out())).toEqual([all[1]]);

    const empty = owner(fakeApi({ [MODELS]: () => json({ items: [], nextCursor: null }) }).fetch);
    expect(await runCli(['models', 'list', '-p', 'p', '--stage', 'agent_failed'], empty.io)).toBe(
      0,
    );
    expect(empty.out()).toBe('no models in p (stage agent_failed)\n');

    const bad = fakeApi({});
    const b = owner(bad.fetch);
    expect(await runCli(['models', 'list', '-p', 'p', '--stage', 'kaputt'], b.io)).toBe(1);
    expect(b.err()).toContain('unknown stage "kaputt"; one of waiting_for_agent');
    expect(bad.seen).toHaveLength(0);
  });
});

describe('analyzr models requeue', () => {
  const REQUEUE = 'POST /api/v1/projects/p/analyses/requeue';

  it('sends the keys and reports each outcome', async () => {
    const api = fakeApi({
      [REQUEUE]: () =>
        json({
          items: [
            { modelKey: 'a/b', outcome: 'queued', taskId: 'ana_1' },
            { modelKey: 'c', outcome: 'open', taskId: 'ana_2' },
          ],
        }),
    });
    const t = testIo({ ANALYZR_TOKEN: AGENT_TOKEN }, api.fetch, { cwd: dir });
    expect(await runCli(['models', 'requeue', 'a/b', 'c', 'a/b', '-p', 'p'], t.io)).toBe(0);
    expect(await api.seen[0]?.body.json()).toEqual({ modelKeys: ['a/b', 'c'] });
    expect(api.seen[0]?.authorization).toBe(`Bearer ${AGENT_TOKEN}`);
    expect(t.out()).toBe(
      [
        '  queued    a/b  ana_1',
        '  open      c  ana_2  (already queued or claimed)',
        'p: 1 queued, 1 open, 0 not found',
        '',
      ].join('\n'),
    );
  });

  it('--all sends {all: true}; --json prints the items', async () => {
    const items = [{ modelKey: 'a', outcome: 'queued', taskId: 'ana_1' }];
    const api = fakeApi({ [REQUEUE]: () => json({ items }) });
    const t = owner(api.fetch);
    expect(await runCli(['models', 'requeue', '--all', '-p', 'p', '--json'], t.io)).toBe(0);
    expect(await api.seen[0]?.body.json()).toEqual({ all: true });
    expect(api.seen[0]?.authorization).toBe(`Bearer ${OWNER_KEY}`);
    expect(JSON.parse(t.out())).toEqual(items);
  });

  it('exits 1 for a key without a live model, and refuses misuse before any request', async () => {
    const api = fakeApi({
      [REQUEUE]: () => json({ items: [{ modelKey: 'x', outcome: 'not-found', taskId: null }] }),
    });
    const t = owner(api.fetch);
    expect(await runCli(['models', 'requeue', 'x', '-p', 'p'], t.io)).toBe(1);
    expect(t.out()).toContain('  not-found x\n');
    expect(t.err()).toContain('no live model x in p');

    const none = fakeApi({});
    for (const argv of [
      ['models', 'requeue', '-p', 'p'],
      ['models', 'requeue', 'a', '--all', '-p', 'p'],
      ['models', 'requeue', 'Not A Key', '-p', 'p'],
      ['models', 'requeue', ...Array.from({ length: 1001 }, (_, i) => `m${i}`), '-p', 'p'],
    ]) {
      const r = owner(none.fetch);
      expect(await runCli(argv, r.io), argv.slice(0, 4).join(' ')).toBe(1);
    }
    expect(none.seen).toHaveLength(0);

    const refused = fakeApi({ [REQUEUE]: () => problem(403, 'forbidden', 'needs analyzr:write') });
    const r = testIo({ ANALYZR_TOKEN: AGENT_TOKEN }, refused.fetch, { cwd: dir });
    expect(await runCli(['models', 'requeue', 'a', '-p', 'p'], r.io)).toBe(1);
    expect(r.err()).toContain('requeue models of p failed (403');
  });
});

describe('analyzr models delete', () => {
  const all = [
    model('a/eins', { openItems: 2, stage: 'waiting_for_review' }),
    model('a/zwei'),
    model('b'),
  ];

  const impact = (missing: number) => ({
    files: [],
    acceptedCalls: { count: 0, items: [] },
    callsProposed: {
      count: missing,
      items: [],
      wasAccepted: 0,
      byReason: missing > 0 ? [{ reason: 'no-engine' as const, count: missing }] : [],
    },
    proposalsAdded: { count: 0, items: [] },
    proposalsWithdrawn: { count: 3, items: [] },
    endpointsChanged: { count: missing, items: [] },
    findingsAdded: { count: missing, items: [] },
    findingsResolved: { count: 0, items: [] },
    absentKeys: { count: 0, items: [] },
  });

  function deletingApi() {
    return fakeApi({
      [MODELS]: pagedModels(all),
      'GET /api/v1/projects/p/models/mdl_b/deletion-impact': () => Response.json(impact(0)),
      // an owner's dry run: their rules for derived calls take a call the deletion makes unique
      'GET /api/v1/projects/p/models/mdl_a_eins/deletion-impact': () =>
        Response.json({
          ...impact(1),
          autoAcceptedCalls: {
            count: 1,
            items: [],
            ofProposed: 0,
            byRule: [{ ruleId: 'aar_01J9Z3N4X5Q6R7S8T9V0W1X2Y3', ruleName: 'Aufrufe', count: 1 }],
          },
        }),
      'DELETE /api/v1/projects/p/models/mdl_a_eins': () => new Response(null, { status: 204 }),
      'DELETE /api/v1/projects/p/models/mdl_b': () => new Response(null, { status: 204 }),
    });
  }

  it('refuses an agent token before any request', async () => {
    const api = deletingApi();
    const t = testIo({ ANALYZR_TOKEN: AGENT_TOKEN, ANALYZR_OWNER_KEY_FILE: keyFile }, api.fetch, {
      cwd: dir,
    });
    expect(await runCli(['models', 'delete', 'b', '-p', 'p', '--yes'], t.io)).toBe(1);
    expect(t.err()).toContain('deleting models needs the owner key');
    expect(api.seen).toHaveLength(0);
  });

  it('without --yes lists what it would delete and deletes nothing', async () => {
    const api = deletingApi();
    const t = owner(api.fetch);
    expect(await runCli(['models', 'delete', 'b', 'a/eins', '-p', 'p'], t.io)).toBe(1);
    expect(api.seen.every((s) => s.method === 'GET')).toBe(true);
    expect(t.out()).toBe(
      [
        'would delete 2 models from p:',
        '  b       waiting_for_agent   r1    c7  0 open items',
        '  a/eins  waiting_for_review  r1    c7  2 open items',
        // M6 S2b: each deletion's impact, against the project's head
        '  b: 0 accepted relations lose an end (missing), 3 rule stances withdrawn, findings 0 added, 0 resolved',
        '  a/eins: 1 accepted relation loses an end (missing), 3 rule stances withdrawn, 1 call only proposed (trust rule), 1 call accepted by your rules for derived calls, findings 1 added, 0 resolved',
        'Uploading a key again revives its model with a new revision.',
        '',
      ].join('\n'),
    );
    expect(t.err()).toContain('nothing deleted; run again with --yes');
  });

  it('stops on an unknown key before deleting anything', async () => {
    const api = deletingApi();
    const t = owner(api.fetch);
    expect(await runCli(['models', 'delete', 'b', 'gibts/nicht', '-p', 'p', '--yes'], t.io)).toBe(
      1,
    );
    expect(t.err()).toContain('no live model gibts/nicht in p; nothing deleted');
    expect(api.seen.some((s) => s.method === 'DELETE')).toBe(false);
  });

  it('--yes deletes one by one by id, as the owner', async () => {
    const api = deletingApi();
    const t = owner(api.fetch);
    expect(await runCli(['models', 'delete', 'a/eins', 'b', '-p', 'p', '--yes'], t.io)).toBe(0);
    expect(api.seen.filter((s) => s.method === 'DELETE').map((s) => s.path)).toEqual([
      '/api/v1/projects/p/models/mdl_a_eins',
      '/api/v1/projects/p/models/mdl_b',
    ]);
    expect(api.seen.every((s) => s.authorization === `Bearer ${OWNER_KEY}`)).toBe(true);
    expect(t.out()).toBe(
      [
        'deleted a/eins',
        'deleted b',
        'p: 2 models deleted; partner relations turn missing, uploading a key again revives its model',
        '',
      ].join('\n'),
    );

    const j = owner(deletingApi().fetch);
    expect(await runCli(['models', 'delete', 'b', '-p', 'p', '--yes', '--json'], j.io)).toBe(0);
    expect(JSON.parse(j.out())).toEqual({ deleted: true, models: [all[2]] });
  });

  it('--json still tells which models are gone when a later DELETE fails', async () => {
    // a/zwei has no DELETE route: the fake answers 404, as for a concurrent delete.
    const api = deletingApi();
    const j = owner(api.fetch);
    expect(
      await runCli(
        ['models', 'delete', 'a/eins', 'a/zwei', 'b', '-p', 'p', '--yes', '--json'],
        j.io,
      ),
    ).toBe(1);
    expect(api.seen.filter((s) => s.method === 'DELETE').map((s) => s.path)).toEqual([
      '/api/v1/projects/p/models/mdl_a_eins',
      '/api/v1/projects/p/models/mdl_a_zwei',
    ]);
    const out = JSON.parse(j.out()) as { failed: { key: string; error: string } };
    expect(out).toMatchObject({ deleted: true, models: [all[0]], failed: { key: 'a/zwei' } });
    expect(out.failed.error).toContain('delete model a/zwei failed (404');
    expect(j.err()).toContain('delete model a/zwei failed (404');

    // The first DELETE failing: nothing gone.
    const first = owner(fakeApi({ [MODELS]: pagedModels(all) }).fetch);
    expect(await runCli(['models', 'delete', 'b', '-p', 'p', '--yes', '--json'], first.io)).toBe(1);
    expect(JSON.parse(first.out())).toMatchObject({
      deleted: false,
      models: [],
      failed: { key: 'b' },
    });
  });
});

import type { AnalysisTask, Landscape, Model, Relation, RequeueBody } from '@analyzr/client';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { App } from '../src/app';
import { QueueList } from '../src/components/review/queue-table';
import {
  analysesQuery,
  assertionsQuery,
  landscapeQuery,
  modelsQuery,
  projectQuery,
} from '../src/lib/queries';
import { createAppRouter } from '../src/router';
import { findToast, json, renderWithRouter, stubApi } from './support/render';
import { model, noLink, provenance, relation, sampleResolver } from './support/fixtures';

const models: Model[] = [
  model({ key: 'a/held', stage: 'waiting_for_clarification', openItems: 1 }),
  model({ key: 'b/stuck', stage: 'agent_working', openItems: 0 }),
  model({ key: 'c/changed', stage: 'waiting_for_review', openItems: 1 }),
  model({ key: 'd/partner', stage: 'waiting_for_review', openItems: 1 }),
];
const held = relation({
  id: 'rel_01HELD',
  from: 'a/held#S',
  to: 'd/partner#C',
  status: 'held',
  tier: 'semantic',
  provenance: provenance({ kind: 'decision', verdict: 'hold', rationale: 'Fachbereich fragen' }),
});
const changed = relation({
  id: 'rel_01CHANGED',
  from: 'c/changed#S',
  to: 'd/partner#C',
  status: 'accepted',
  endpointState: 'changed',
  tier: 'key',
});
const accepted = relation({
  id: 'rel_01OK',
  from: 'c/changed#T',
  to: 'd/partner#D',
  status: 'accepted',
  tier: 'key',
});
const stuckTask: AnalysisTask = {
  id: 'ana_01STUCK',
  projectId: 'prj_01DEMO',
  kind: 'relations',
  subjectKind: 'model',
  modelId: 'mdl_BSTUCK',
  modelKey: 'b/stuck',
  revisionId: 'rev_BSTUCK',
  valueChainId: null,
  valueChainKey: null,
  valueChainRevisionId: null,
  state: 'claimed',
  attempts: 3,
  factsHash: 'a'.repeat(64),
  inputHash: null,
  leaseUntil: '2026-10-07T09:15:00.000Z',
  claimedBy: 'agent:sim',
  lastError: null,
  submissionId: null,
  createdAt: '2026-10-07T09:00:00.000Z',
  updatedAt: '2026-10-07T09:00:00.000Z',
};

function setup(path: string, extra: Relation[] = [], role: 'owner' | 'viewer' = 'owner') {
  const calls = stubApi({
    'POST /api/v1/projects/demo/analyses/requeue': (call) =>
      json({
        items: (call.body as RequeueBody).modelKeys?.map((modelKey) => ({
          modelKey,
          outcome: 'queued',
          taskId: 'ana_01NEW',
        })),
      }),
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const landscape: Landscape = {
    projectId: 'prj_01DEMO',
    seq: 1,
    models: [],
    relations: [held, changed, accepted, ...extra],
    findings: [],
  };
  queryClient.setQueryData(projectQuery('demo').queryKey, {
    id: 'prj_01DEMO',
    key: 'demo',
    name: 'Demo',
    role,
    lastSeq: 1,
    createdAt: '2026-10-07T09:00:00.000Z',
  });
  queryClient.setQueryData(landscapeQuery('demo').queryKey, landscape);
  queryClient.setQueryData(modelsQuery('demo').queryKey, models);
  queryClient.setQueryData(analysesQuery('demo', 'claimed').queryKey, [stuckTask]);
  queryClient.setQueryData(assertionsQuery('demo', held.id).queryKey, []);
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<App queryClient={queryClient} router={router} />);
  return { calls, router, user: userEvent.setup() };
}

describe('review inbox', () => {
  it('lists accepted relations whose endpoint changed, and counts them in the tab', async () => {
    setup('/projects/demo/review');
    const rows = await screen.findAllByTestId('queue-row');
    expect(rows.map((r) => r.dataset['relationId'])).toEqual(['rel_01CHANGED']);
    expect(within(rows[0]!).getByTestId('queue-reconfirm').textContent).toContain(
      'Endpunkt geändert',
    );
    const nav = screen.getByRole('navigation', { name: 'Projektbereiche' });
    const tab = within(nav).getByRole('link', { name: /Relationen/ });
    expect(tab.textContent).toBe('Relationen1 zu prüfen');
    expect(tab.dataset['status']).toBe('active');
    // Re-confirming is one by one: no bulk accept for it.
    expect(screen.queryByTestId('bulk-open')).toBeNull();
  });

  it('counts a held relation in its model’s open points, and lists it under „Vorgemerkt“', async () => {
    setup('/projects/demo');
    const row = (await screen.findAllByTestId('model-row')).find(
      (r) => r.dataset['modelKey'] === 'a/held',
    );
    if (!row) throw new Error('no row for a/held');
    // Text, not a link (no one list holds all of a model's points, P7); the split in a tooltip.
    const points = await within(row).findByTestId('open-points');
    expect(points.textContent).toBe('1');
    expect(points.closest('a')).toBeNull();
    expect(points.parentElement?.textContent).toBe('1 offener Punkt');
    expect(within(row).getByRole('tooltip', { hidden: true }).textContent).toBe('1 Relation');
    cleanup();
    setup('/projects/demo/review?model=a%2Fheld&view=held');
    const item = await screen.findByTestId('held-item');
    expect(item.dataset['relationId']).toBe('rel_01HELD');
    // UX5: „Jetzt entscheiden“ opens the review screen; one sentence above the list
    expect(
      within(item).getByRole('link', { name: 'Jetzt entscheiden' }).getAttribute('href'),
    ).toContain('view=held');
    expect(screen.getByTestId('held-intro').textContent).toBe(
      'Die Antwort ist eine Notiz an der Relation; entschieden wird, sobald sie feststeht.',
    );
  });

  it('keeps the phase filter of „Übersicht“ visible in the queue, and removable', async () => {
    const { router, user } = setup('/projects/demo/review?stage=waiting_for_review');
    const chip = await screen.findByTestId('stage-chip');
    expect(chip.textContent).toBe('Phase: Wartet auf Prüfung');
    await user.click(chip);
    await waitFor(() => expect(router.state.location.search).toEqual({}));
  });

  it('offers a requeue on „Übersicht“ for an expired reservation that still says "Agent arbeitet"', async () => {
    const { calls, user } = setup('/projects/demo');
    const row = (await screen.findAllByTestId('model-row')).find(
      (r) => r.dataset['modelKey'] === 'b/stuck',
    );
    if (!row) throw new Error('no row for b/stuck');
    expect((await within(row).findAllByTestId('lease-expired'))[0]?.textContent).toContain(
      'Reservierung abgelaufen am',
    );
    // „Als Nächstes“ says it too (once every count loaded).
    await waitFor(() =>
      expect(screen.getByTestId('next-step').textContent).toContain(
        'Bei 1 Modell ist die Reservierung abgelaufen',
      ),
    );
    const [retry] = within(row).getAllByRole('button', { name: /Nochmal versuchen/ });
    if (!retry) throw new Error('no retry');
    await user.click(retry);
    await findToast('Nochmal eingeplant');
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.body)).toContainEqual({
      modelKeys: ['b/stuck'],
    });
  });
});

describe('„Relationen › Zu prüfen“ (UX5)', () => {
  const key = (id: string, from: string, to: string) =>
    relation({ id, from, to, tier: 'key', status: 'proposed', confidence: 1 });

  it('shows the views, a status line, „Vorschläge prüfen (n)“ and the unremarkable bulk', async () => {
    const { router, user } = setup('/projects/demo/review', [
      key('rel_01K1', 'c/changed#A', 'd/partner#A'),
      key('rel_01K2', 'c/changed#B', 'd/partner#B'),
    ]);
    const views = await screen.findByRole('navigation', { name: 'Ansichten' });
    expect(
      within(views)
        .getAllByRole('link')
        .map((l) => [l.textContent, l.getAttribute('aria-current')]),
    ).toEqual([
      ['Zu prüfen3', 'page'],
      ['Vorgemerkt', null],
      ['Gilt', null],
      ['Abgelehnt', null],
      ['Alle', null],
    ]);
    // the expired reservation, with its action; no placements callout, no stage table
    expect(screen.getByTestId('review-status').textContent).toContain(
      'Bei 1 Modell ist die Reservierung abgelaufen',
    );
    expect(screen.queryByTestId('placements-callout')).toBeNull();
    const start = screen.getByTestId('review-start');
    expect(start.textContent).toBe('Vorschläge prüfen (3)');
    expect(start.getAttribute('href')).toBe('/projects/demo/review/rel_01K1');
    // the key tier's unflagged proposals: the count equals the dialog's default selection
    // shown once every model's facts are there (its flags need them)
    const bulk = await screen.findByTestId('bulk-open');
    expect(bulk.textContent).toBe('2 unauffällige annehmen …');
    await user.click(bulk);
    expect((await screen.findByTestId('bulk-summary')).textContent).toBe('2 von 2 ausgewählt');
    await user.keyboard('{Escape}');
    // one link per row; a click on the row opens it too
    const rows = screen.getAllByTestId('queue-row');
    for (const r of rows) expect(within(r).getAllByRole('link')).toHaveLength(1);
    expect(within(rows[0]!).queryByRole('button')).toBeNull();
    await user.click(within(rows[1]!).getByText('100 %'));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/projects/demo/review/rel_01K2'),
    );
  });

  const derived = (id: string, n: number) =>
    relation({
      id,
      type: 'call',
      tier: 'key',
      status: 'proposed',
      confidence: 0.9,
      from: `c/changed#Call_${n}`,
      to: `d/partner#Process_${n}`,
      attrs: { calledElement: `Process_${n}`, match: 'derived-caller' },
    });

  it('opens the bulk accept by itself for `?bulk=calls`, the unique calls of derived models selected; closing drops the parameter (M6 S2c)', async () => {
    const { router, user } = setup('/projects/demo/review?bulk=calls', [
      key('rel_01K1', 'c/changed#A', 'd/partner#A'),
      derived('rel_01C1', 1),
      derived('rel_01C2', 2),
    ]);
    const dialog = await screen.findByTestId('bulk-dialog');
    expect(within(dialog).getByText('2 eindeutige Aufrufe annehmen?')).toBeTruthy();
    expect(within(dialog).getAllByRole('heading', { level: 3 })[0]?.textContent).toBe(
      'Eindeutige Aufrufe aus abgeleiteten Modellen (2)',
    );
    expect(within(dialog).getByTestId('bulk-summary').textContent).toBe('2 von 3 ausgewählt');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(router.state.location.href).toBe('/projects/demo/review'));
    expect(screen.queryByTestId('bulk-dialog')).toBeNull();
    // nothing had the focus before the URL opened it: „Vorschläge prüfen“ gets it, not the body
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('review-start')));
    // opened by its button, the dialog selects every unflagged pair
    await user.click(await screen.findByTestId('bulk-open'));
    expect((await screen.findByTestId('bulk-summary')).textContent).toBe('3 von 3 ausgewählt');
  });

  it('opens nothing for `?bulk=calls` without such calls, for a viewer, or for a call an agent asks about; the parameter goes', async () => {
    const first = setup('/projects/demo/review?bulk=calls', [
      key('rel_01K1', 'c/changed#A', 'd/partner#A'),
    ]);
    await screen.findByTestId('bulk-open');
    expect(screen.queryByTestId('bulk-dialog')).toBeNull();
    // a later call would otherwise open it by itself
    await waitFor(() => expect(first.router.state.location.href).toBe('/projects/demo/review'));
    cleanup();
    const viewer = setup('/projects/demo/review?bulk=calls', [derived('rel_01C1', 1)], 'viewer');
    await screen.findAllByTestId('queue-row');
    expect(screen.queryByTestId('bulk-dialog')).toBeNull();
    expect(screen.queryByTestId('bulk-open')).toBeNull();
    await waitFor(() => expect(viewer.router.state.location.href).toBe('/projects/demo/review'));
    cleanup();
    // flagged in the dialog (decided one by one): the links do not count it either (`isBulkCall`)
    const asked = setup('/projects/demo/review?bulk=calls', [
      relation({
        ...derived('rel_01C1', 1),
        provenance: provenance({ tier: 'key', confidence: 0.9, question: 'Wirklich dieser?' }),
      }),
    ]);
    await screen.findAllByTestId('queue-row');
    await waitFor(() => expect(asked.router.state.location.href).toBe('/projects/demo/review'));
    expect(screen.queryByTestId('bulk-dialog')).toBeNull();
  });

  it('keeps the dialog of `?bulk=calls` through the accept’s refetches: the toast shows, `?bulk` goes, the focus stays on the page (M6 S2c-2)', async () => {
    const call = derived('rel_01C1', 1);
    let accepted = false;
    const landscapeOf = (seq: number): Landscape => ({
      projectId: 'prj_01DEMO',
      seq,
      models: [],
      relations: [accepted ? { ...call, status: 'accepted', version: 2 } : call],
      findings: [],
    });
    const project = {
      id: 'prj_01DEMO',
      key: 'demo',
      name: 'Demo',
      role: 'owner' as const,
      lastSeq: 1,
      createdAt: '2026-10-07T09:00:00.000Z',
    };
    stubApi({
      'GET /api/v1/projects/demo': () => json(project),
      'POST /api/v1/projects/demo/decisions': () => {
        accepted = true;
        return json({ items: [{ ...call, status: 'accepted', version: 2 }] });
      },
      // the landscape answers at once, without the proposal: the dialog's rows are gone …
      'GET /api/v1/projects/demo/landscape': () => json(landscapeOf(2)),
      // … while another query of the same refresh is still on its way
      'GET /api/v1/projects/demo/models': async () => {
        await new Promise((r) => setTimeout(r, 300));
        return json({ items: models, nextCursor: null });
      },
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    queryClient.setQueryData(projectQuery('demo').queryKey, project);
    queryClient.setQueryData(landscapeQuery('demo').queryKey, landscapeOf(1));
    queryClient.setQueryData(modelsQuery('demo').queryKey, models);
    const router = createAppRouter({
      queryClient,
      history: createMemoryHistory({ initialEntries: ['/projects/demo/review?bulk=calls'] }),
    });
    render(<App queryClient={queryClient} router={router} />);
    const user = userEvent.setup();
    const toasts = () =>
      screen
        .queryAllByTestId('toast')
        .filter((t) => t.textContent.includes('Eindeutige Aufrufe aus abgeleiteten Modellen.'))
        .length;
    const before = toasts();
    await user.click(await screen.findByTestId('bulk-confirm'));
    await waitFor(() => expect(toasts()).toBe(before + 1), { timeout: 3000 });
    expect(screen.queryByTestId('bulk-dialog')).toBeNull();
    await waitFor(() => expect(router.state.location.href).toBe('/projects/demo/review'));
    // nothing left to review: the view „Zu prüfen“ has the focus
    await waitFor(() => expect(document.activeElement?.id).toBe('relation-view-review'));
  });

  it('keeps the filters while a filter is set, and offers „Grundlage“ instead of „Stufe“', async () => {
    setup('/projects/demo/review?view=held&model=c%2Fchanged');
    await screen.findByRole('navigation', { name: 'Ansichten' });
    // nothing held in c/changed, but the model filter is set: the filters stay to lift it
    expect(screen.getByRole('search', { name: 'Liste filtern' })).toBeTruthy();
    expect(screen.getByLabelText('Grundlage')).toBeTruthy();
    expect(screen.queryByLabelText('Stufe')).toBeNull();
  });
});

describe('QueueList', () => {
  it('marks an open agent question and an agent no-link on the pair', async () => {
    const proposals = [
      relation({
        id: 'rel_01PLAIN',
        from: 'a/one#S',
        to: 'b/two#C',
        provenance: provenance(),
      }),
      relation({
        id: 'rel_01OBJECTED',
        from: 'a/one#T',
        to: 'b/two#D',
        provenance: provenance({ question: 'Auch bei Teillieferungen?' }),
        noLinks: [noLink({ id: 'nlk_01A' }), noLink({ id: 'nlk_02B', handle: 'agent:codex' })],
      }),
    ];
    await renderWithRouter(
      <QueueList
        project="demo"
        items={proposals.map((relation) => ({ relation, finishes: 0 }))}
        resolve={sampleResolver}
        filters={{}}
      />,
    );
    const rows = screen.getAllByTestId('queue-row');
    const [plain, objected] = rows;
    expect(within(plain!).queryByTestId('queue-no-link')).toBeNull();
    expect(within(plain!).queryByText('Frage')).toBeNull();
    expect(within(objected!).getByText('Frage')).toBeTruthy();
    const marker = within(objected!).getByTestId('queue-no-link');
    expect(marker.textContent).toBe('Einwand');
    expect(marker.getAttribute('title')).toBe('Kein Zusammenhang laut Agent (2 Einwände)');
  });

  it('leads with the processes, names the element once, adds the key only where names repeat', async () => {
    const proposals = [
      relation({ id: 'rel_01A', from: 'a/one#S', to: 'b/two#C', confidence: 0.92 }),
      relation({ id: 'rel_01B', from: 'a/one#S', to: 'c/three#P', confidence: 0.6 }),
    ];
    await renderWithRouter(
      <QueueList
        project="demo"
        items={proposals.map((relation) => ({ relation, finishes: 0 }))}
        resolve={(ref) => {
          const [modelKey = '', elementId = ''] = ref.split('#');
          if (elementId === 'P')
            return {
              ref,
              modelKey,
              elementId,
              label: 'Versand',
              kind: 'process',
              processName: null,
            };
          return {
            ref,
            modelKey,
            elementId,
            label: 'Rechnung',
            kind: 'msg_throw',
            processName: modelKey === 'c/three' ? 'Versand' : 'Versand',
          };
        }}
        filters={{}}
      />,
    );
    const [a, b] = screen.getAllByTestId('queue-row');
    // every end lies in a process „Versand“ of another model: the key tells them apart
    expect(within(a!).getByTestId('queue-link').textContent).toBe(
      'Versand (a/one) → Versand (b/two)',
    );
    expect(a!.textContent).toContain('Rechnung');
    expect(a!.textContent).toContain('92 %');
    // a whole process has no element name of its own
    expect(within(b!).getByTestId('queue-link').textContent).toBe(
      'Versand (a/one) → Versand (c/three)',
    );
  });
});

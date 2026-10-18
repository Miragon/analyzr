import type { AnalysisTask, Landscape, Model, RequeueBody } from '@analyzr/client';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { App } from '../src/app';
import { QueueTable } from '../src/components/review/queue-table';
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

function setup(path: string) {
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
    relations: [held, changed, accepted],
    findings: [],
  };
  queryClient.setQueryData(projectQuery('demo').queryKey, {
    id: 'prj_01DEMO',
    key: 'demo',
    name: 'Demo',
    role: 'owner',
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
    const points = within(row).getByTestId('open-points');
    expect(points.textContent).toBe('1');
    expect(points.closest('a')).toBeNull();
    expect(points.parentElement?.textContent).toBe('1 offener Punkt');
    expect(within(row).getByRole('tooltip', { hidden: true }).textContent).toBe('1 Relation');
    cleanup();
    setup('/projects/demo/review?model=a%2Fheld&view=held');
    const item = await screen.findByTestId('held-item');
    expect(item.dataset['relationId']).toBe('rel_01HELD');
    expect(
      within(item)
        .getByRole('link', { name: /Prüfen/ })
        .getAttribute('href'),
    ).toContain('view=held');
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
    // „Als Nächstes“ says it too.
    expect(screen.getByTestId('next-step').textContent).toContain(
      'Bei 1 Modell ist die Reservierung abgelaufen',
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

describe('QueueTable', () => {
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
      <QueueTable
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
});

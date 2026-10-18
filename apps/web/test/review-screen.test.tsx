import type { Fact, Landscape, Model, Project, RelationAssertion } from '@analyzr/client';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { App } from '../src/app';
import type { CanvasHighlight } from '../src/lib/bpmn-elements';
import {
  assertionsQuery,
  contentQuery,
  factsQuery,
  landscapeQuery,
  modelsQuery,
  projectQuery,
  relationQuery,
} from '../src/lib/queries';
import { createAppRouter } from '../src/router';
import { assertion, fact, model, relation } from './support/fixtures';
import { json, stubApi } from './support/render';

// bpmn-js needs a real browser: the canvas shows what it was asked to highlight and focus.
vi.mock('@/components/bpmn-canvas', () => ({
  default: ({ highlights, focus }: { highlights: CanvasHighlight[]; focus: string | null }) => (
    <div
      data-testid="canvas"
      data-highlights={highlights.map((h) => `${h.label}:${h.elementId}`).join(',')}
      data-focus={focus ?? ''}
    />
  ),
}));

const models: Model[] = [
  model({ key: 'a/one' }),
  model({ key: 'b/two' }),
  model({ key: 'c/three' }),
];
const facts: Fact[] = [
  fact({ modelKey: 'a/one', elementId: 'S', kind: 'msg_throw', label: 'Ware versandbereit' }),
  fact({ modelKey: 'a/one', elementId: 'T', kind: 'task', label: 'Ware verpacken' }),
  fact({ modelKey: 'b/two', elementId: 'C', kind: 'msg_catch', label: 'Ware angekommen' }),
  fact({ modelKey: 'b/two', elementId: 'U', kind: 'task', label: 'Rechnung prüfen' }),
  fact({ modelKey: 'c/three', elementId: 'Z', kind: 'task', label: 'Archivieren' }),
];

const X = relation({
  id: 'rel_01X',
  from: 'a/one#S',
  to: 'b/two#C',
  tier: 'semantic',
  confidence: 0.8,
});
const M = relation({
  id: 'rel_01M',
  type: 'manual',
  from: 'a/one#S',
  to: 'c/three#Z',
  tier: 'manual',
  status: 'accepted',
});
const H = relation({
  id: 'rel_01H',
  from: 'a/one#S',
  to: 'b/two#U',
  status: 'held',
  tier: 'key',
});
const D = relation({
  id: 'rel_01D',
  from: 'a/one#S',
  to: 'gone/model#C',
  status: 'accepted',
  endpointState: 'missing',
});
const history: Record<string, RelationAssertion[]> = {
  rel_01X: [
    assertion({
      id: 'asr_1',
      evidence: ['a/one#T', 'b/two#U', 'c/three#Z', 'frei formuliert'],
      rationale: 'gleiche Ware',
    }),
  ],
  rel_01M: [],
  rel_01D: [],
  rel_01H: [],
};

function setup(path: string, { role }: { role?: Project['role'] } = {}) {
  stubApi({
    'GET /api/v1/projects/demo/open-questions': () =>
      json({ items: [], nextCursor: null, totals: {}, askByModel: {} }),
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const landscape: Landscape = {
    projectId: 'prj_01DEMO',
    seq: 1,
    models: [],
    relations: [X, M, D, H],
    findings: [],
  };
  queryClient.setQueryData(landscapeQuery('demo').queryKey, landscape);
  if (role)
    queryClient.setQueryData(projectQuery('demo').queryKey, {
      id: 'prj_01DEMO',
      key: 'demo',
      name: 'Demo',
      role,
      lastSeq: 1,
      createdAt: '2026-10-07T09:00:00.000Z',
    });
  queryClient.setQueryData(modelsQuery('demo').queryKey, models);
  for (const r of [X, M, D, H]) {
    queryClient.setQueryData(relationQuery('demo', r.id).queryKey, r);
    queryClient.setQueryData(assertionsQuery('demo', r.id).queryKey, history[r.id] ?? []);
  }
  for (const m of models) {
    const ref = { project: 'demo', modelId: m.id, revisionId: m.headRevisionId };
    queryClient.setQueryData(factsQuery(ref).queryKey, {
      modelKey: m.key,
      revisionId: m.headRevisionId,
      factsVersion: '1',
      processes: [],
      facts: facts.filter((f) => f.modelKey === m.key),
      messageFlows: [],
    });
    queryClient.setQueryData(contentQuery(ref).queryKey, { xml: `<xml model="${m.key}"/>` });
  }
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<App queryClient={queryClient} router={router} />);
  return { router, user: userEvent.setup() };
}

const canvases = () =>
  screen.queryAllByTestId('canvas').map((c) => ({
    highlights: c.dataset['highlights'],
    focus: c.dataset['focus'],
  }));

describe('review screen', () => {
  it('shows a cited element in its pane, switching panes if needed, and forgets it on another relation', async () => {
    // one pane at a time (a phone, or chosen): from 1024 px both show, stacked or side by side
    const { router, user } = setup('/projects/demo/review/rel_01X?pane=from');
    await waitFor(() => expect(canvases()).toEqual([{ highlights: 'Von:S', focus: 'S' }]));
    const refs = await screen.findAllByTestId('evidence-ref');
    expect(refs.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Ware verpacken'),
      expect.stringContaining('Rechnung prüfen'),
    ]);
    // A ref into a model without a pane opens the model view at that element.
    const link = screen.getByTestId('evidence-link');
    expect(link.getAttribute('href')).toBe('/projects/demo/models/c/three?element=Z');

    // Narrow screen, only "Von" shown: a ref into the "Nach" model switches the pane …
    await user.click(refs[1]!);
    await waitFor(() => expect(canvases()).toEqual([{ highlights: 'Nach:C,Beleg:U', focus: 'U' }]));
    expect(router.state.location.search).toMatchObject({ pane: 'to' });
    // … and one into the "Von" model switches back.
    await user.click(refs[0]!);
    await waitFor(() => expect(canvases()).toEqual([{ highlights: 'Von:S,Beleg:T', focus: 'T' }]));
    expect(router.state.location.search).toMatchObject({ pane: 'from' });

    // Another relation by link or history, with a pane on the same model: nothing of X.
    await act(() =>
      router.navigate({
        to: '/projects/$project/review/$relation',
        params: { project: 'demo', relation: 'rel_01M' },
        search: { pane: 'from' },
      }),
    );
    await waitFor(() => expect(canvases()).toEqual([{ highlights: 'Von:S', focus: 'S' }]));
    // Back on the first relation, its own cited element is still marked.
    await act(async () => {
      router.history.back();
      await Promise.resolve();
    });
    await waitFor(() => expect(canvases()).toEqual([{ highlights: 'Von:S,Beleg:T', focus: 'T' }]));
  });

  it('says so when an endpoint’s model was deleted, instead of loading forever', async () => {
    setup('/projects/demo/review/rel_01D?pane=to');
    const missing = await screen.findByTestId('pane-missing-model');
    expect(missing.textContent).toContain('Modell „gone/model“ gibt es nicht mehr');
    const pane = screen.getByTestId('review-pane');
    expect(pane.getAttribute('aria-label')).toBe('Nach: gone/model');
    expect(within(pane).queryByRole('status')).toBeNull();
  });
});

describe('the review screen since UX5', () => {
  const phone = () =>
    ((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList) as typeof window.matchMedia;

  it('shows both panes from 1024 px, stacked below 1280', async () => {
    setup('/projects/demo/review/rel_01X');
    await waitFor(() => expect(canvases()).toHaveLength(2));
    expect(screen.getByTestId('review-canvas').className).toContain('flex-col');
    expect(screen.getAllByTestId('pane-chip').map((c) => c.textContent)).toEqual([
      expect.stringMatching(/^Von/),
      expect.stringMatching(/^Nach/),
    ]);
  });

  it('on a phone: a sheet with „Von → Nach“ and the confidence, the decisions one tap away', async () => {
    const wide = Object.getOwnPropertyDescriptor(window, 'matchMedia')!;
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: phone() });
    try {
      const { user } = setup('/projects/demo/review/rel_01X', { role: 'owner' });
      const panel = await screen.findByRole('complementary', { name: 'Prüfung' });
      const handle = within(panel).getByTestId('panel-handle');
      expect(handle.textContent).toBe('Process_1 → Process_1 · 80 %');
      expect(handle.getAttribute('aria-expanded')).toBe('false');
      // the header stays above it: back, position, ‹ ›, and one pane at a time
      const header = screen.getByTestId('review-header');
      expect(within(header).getByTestId('review-back').textContent).toBe('Zu prüfen');
      expect(within(header).queryByRole('radio', { name: 'Nebeneinander' })).toBeNull();
      expect(canvases()).toHaveLength(1);
      // a decision's form opens the sheet (R while collapsed)
      await user.keyboard('r');
      await waitFor(() => expect(handle.getAttribute('aria-expanded')).toBe('true'));
      expect(within(panel).getByLabelText('Grund der Ablehnung')).toBeTruthy();
    } finally {
      Object.defineProperty(window, 'matchMedia', wide);
    }
  });

  it('leads back to „Offene Fragen“ when opened from there', async () => {
    setup('/projects/demo/review/rel_01H?view=held&from=open-questions', { role: 'owner' });
    const back = await screen.findByTestId('review-back');
    expect(back.textContent).toBe('Offene Fragen');
    expect(back.getAttribute('href')).toBe('/projects/demo/open-questions');
  });

  it('answers a held relation from the decision bar instead of „Vormerken“', async () => {
    setup('/projects/demo/review/rel_01H?view=held', { role: 'owner' });
    const panel = await screen.findByTestId('decision-panel');
    expect(await within(panel).findByTestId('hold-answer')).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: /Vormerken/ })).toBeNull();
    expect(within(panel).getByRole('button', { name: /Annehmen/ })).toBeTruthy();
  });
});

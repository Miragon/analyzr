/**
 * The model view since UX3 (UX-SIMPLIFICATION.md §3.5): the header with the
 * crumb back to „Übersicht“, the model's name as the title, at most three
 * chips and „Mehr“; the panel „Dieses Modell“ with the tabs „Fragen (n)“ and
 * „Relationen (n)“ (opening on „Fragen“ when there are any), a selected
 * element filtering both with its name in the panel header and „Alle zeigen“;
 * relation cards in two lines (the type and direction in the accessible
 * name, the confidence on a proposal only); and below 1024 px the panel as a
 * sheet collapsed to its handle, which expands, is inert while collapsed and
 * collapses with Escape.
 */
import type { Landscape, Model, Project, RevisionFacts } from '@analyzr/client';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from '../src/app';
import {
  contentQuery,
  factsQuery,
  healthQuery,
  landscapeQuery,
  modelOpenQuestionsQuery,
  modelsQuery,
  projectQuery,
} from '../src/lib/queries';
import { createAppRouter } from '../src/router';
import { fact, model, openQuestion, openQuestionPage, relation } from './support/fixtures';
import { json, stubApi } from './support/render';

const PROJECT: Project = {
  id: 'prj_01DEMO',
  key: 'demo',
  name: 'Demo GmbH',
  role: 'owner',
  lastSeq: 9,
  createdAt: '2026-10-07T09:00:00.000Z',
};
const models: Model[] = [
  model({ key: 'a/order', name: 'Auftrag', stage: 'waiting_for_review' }),
  model({ key: 'c/payment', name: 'Zahlung' }),
];
const proc = (modelKey: string, processId: string, name: string) => ({
  ref: `${modelKey}#${processId}` as const,
  processId,
  name,
  participantName: null,
  isExecutable: false,
});
const FACTS: RevisionFacts[] = [
  {
    modelKey: 'a/order',
    revisionId: models[0]!.headRevisionId,
    factsVersion: '1',
    processes: [proc('a/order', 'Process_Order', 'Auftrag')],
    facts: [
      fact({ modelKey: 'a/order', elementId: 'Process_Order', kind: 'process', processId: null }),
      fact({
        modelKey: 'a/order',
        elementId: 'Call_1',
        kind: 'call',
        label: 'Zahlung abwickeln',
        processId: 'Process_Order',
      }),
      fact({
        modelKey: 'a/order',
        elementId: 'Send_1',
        kind: 'msg_throw',
        label: 'Rechnung senden',
        processId: 'Process_Order',
      }),
    ],
    messageFlows: [],
  },
  {
    modelKey: 'c/payment',
    revisionId: models[1]!.headRevisionId,
    factsVersion: '1',
    processes: [proc('c/payment', 'Process_Pay', 'Zahlungsdienst')],
    facts: [
      fact({ modelKey: 'c/payment', elementId: 'Process_Pay', kind: 'process', processId: null }),
      fact({
        modelKey: 'c/payment',
        elementId: 'Catch_1',
        kind: 'msg_catch',
        label: 'Rechnung empfangen',
        processId: 'Process_Pay',
      }),
    ],
    messageFlows: [],
  },
];
const call = relation({
  id: 'rel_01CALL',
  type: 'call',
  from: 'a/order#Call_1',
  to: 'c/payment#Process_Pay',
  status: 'accepted',
  tier: 'rule',
  confidence: 1,
});
const message = relation({
  id: 'rel_01MESSAGE',
  type: 'message',
  from: 'a/order#Send_1',
  to: 'c/payment#Catch_1',
  status: 'proposed',
  confidence: 0.8,
});
const questions = [
  openQuestion({
    id: 'q-00000000000000d1',
    kind: 'call-target-unknown',
    subject: { type: 'ref', id: 'a/order#Call_1' },
    subjectLabel: '„Zahlung abwickeln“',
    modelKeys: ['a/order'],
    refs: ['a/order#Call_1'],
    text: 'Welchen Prozess ruft „Zahlung abwickeln“ auf?',
  }),
  openQuestion({
    id: 'q-00000000000000d2',
    kind: 'undocumented-process',
    subject: { type: 'process', id: 'a/order#Process_Order' },
    subjectLabel: '„Auftrag“',
    modelKeys: ['a/order'],
    refs: ['a/order#Process_Order'],
    text: 'Was tut „Auftrag“?',
  }),
];

/** „Auftrag“ with a collapsed subprocess, which facts v1 do not know (M6 S5c-1). */
const ORDER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" id="Defs_1">
  <bpmn:process id="Process_Order" name="Auftrag">
    <bpmn:subProcess id="Sub_Pay" name="Zahlung" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_Order">
      <bpmndi:BPMNShape id="Sub_Pay_di" bpmnElement="Sub_Pay" />
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

function setup(path: string, served: () => readonly unknown[] = () => questions) {
  const landscape: Landscape = {
    projectId: 'prj_01DEMO',
    seq: 9,
    models: [],
    relations: [call, message],
    findings: [],
  };
  stubApi({
    'GET /api/v1/projects/demo': () => json(PROJECT),
    'GET /api/v1/projects/demo/models': () => json({ items: models, nextCursor: null }),
    'GET /api/v1/projects/demo/landscape': () => json(landscape),
    'GET /api/v1/projects/demo/open-questions': (c) =>
      json(openQuestionPage(served() as typeof questions, c.search)),
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(healthQuery.queryKey, { status: 'ok', version: '0.1.0', db: 'ok' });
  queryClient.setQueryData(projectQuery('demo').queryKey, PROJECT);
  queryClient.setQueryData(landscapeQuery('demo').queryKey, landscape);
  queryClient.setQueryData(modelsQuery('demo').queryKey, models);
  for (const [i, f] of FACTS.entries()) {
    const m = models[i]!;
    const ref = { project: 'demo', modelId: m.id, revisionId: m.headRevisionId };
    queryClient.setQueryData(factsQuery(ref).queryKey, f);
    queryClient.setQueryData(contentQuery(ref).queryKey, { xml: i === 0 ? ORDER_XML : '<xml/>' });
  }
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<App queryClient={queryClient} router={router} />);
  return { router, queryClient, user: userEvent.setup() };
}

const tabs = () =>
  screen.getAllByTestId('panel-tab').map((t) => [t.textContent, t.getAttribute('aria-selected')]);

describe('the model view (UX3)', () => {
  const wide = Object.getOwnPropertyDescriptor(window, 'matchMedia')!;
  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', wide);
  });

  it('heads the view with the crumb back, the name, the chips and „Mehr“', async () => {
    setup('/projects/demo/models/a/order');
    const header = await screen.findByTestId('model-header');
    expect(within(header).getByTestId('canvas-title').textContent).toBe('Auftrag');
    expect(header.textContent).toContain('a/order');
    const crumbs = within(header).getByRole('navigation', { name: 'Brotkrumen' });
    expect(within(crumbs).getByRole('link', { name: 'Demo GmbH' }).getAttribute('href')).toBe(
      '/projects/demo',
    );
    expect(within(header).getByTestId('canvas-back').textContent).toBe('Übersicht');
    // today's „← Relationen“ and „Modelle“ went: the crumb is the one way back
    expect(within(header).queryByRole('link', { name: /Relationen/ })).toBeNull();
    expect(await within(header).findByTestId('model-more', {}, { timeout: 10_000 })).toBeTruthy();
  });

  it('opens on „Fragen“ and counts both tabs; a selected element filters both', async () => {
    const { router, user } = setup('/projects/demo/models/a/order');
    const panel = await screen.findByRole('complementary', { name: 'Dieses Modell' });
    await waitFor(() =>
      expect(tabs()).toEqual([
        ['Fragen2', 'true'],
        ['Relationen2', 'false'],
      ]),
    );
    // the element in the URL: its name in the panel header, both tabs filtered to it
    await act(() =>
      router.navigate({
        to: '/projects/$project/models/$',
        params: { project: 'demo', _splat: 'a/order' },
        search: { element: 'Call_1' },
      }),
    );
    await waitFor(() =>
      expect(within(panel).getByTestId('panel-element').textContent).toContain('Zahlung abwickeln'),
    );
    await waitFor(() =>
      expect(tabs()).toEqual([
        ['Fragen1', 'true'],
        ['Relationen1', 'false'],
      ]),
    );
    expect(
      within(panel)
        .getAllByTestId('open-question')
        .map((q) => q.dataset['questionId']),
    ).toEqual(['q-00000000000000d1']);
    await user.click(within(panel).getByRole('tab', { name: /Relationen/ }));
    expect(
      within(panel)
        .getAllByTestId('model-relation')
        .map((r) => r.dataset['relationId']),
    ).toEqual(['rel_01CALL']);
    // „Alle zeigen“ lifts the filter
    await user.click(within(panel).getByTestId('panel-show-all'));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(within(panel).getAllByTestId('model-relation')).toHaveLength(2);
  });

  it('keeps „Fragen“ open when its last question is settled', async () => {
    let served = questions;
    const { queryClient } = setup('/projects/demo/models/a/order', () => served);
    const panel = await screen.findByRole('complementary', { name: 'Dieses Modell' });
    await waitFor(() =>
      expect(tabs()).toEqual([
        ['Fragen2', 'true'],
        ['Relationen2', 'false'],
      ]),
    );
    // both answered: the list says so instead of the panel flipping to „Relationen“
    served = [];
    await act(() =>
      queryClient.invalidateQueries({
        queryKey: modelOpenQuestionsQuery('demo', 'a/order').queryKey,
      }),
    );
    await waitFor(() =>
      expect(tabs()).toEqual([
        ['Fragen0', 'true'],
        ['Relationen2', 'false'],
      ]),
    );
    expect(within(panel).getByText('Zu diesem Modell ist nichts zu klären.')).toBeTruthy();
  });

  it('opens „Fragen“ on a selected collapsed subprocess: its „Verknüpfen mit …“ is there', async () => {
    setup('/projects/demo/models/a/order?element=Sub_Pay', () => []);
    const card = await screen.findByTestId('subprocess-link', {}, { timeout: 10_000 });
    expect(card.textContent).toContain('Eingeklappter Teilprozess „Zahlung“');
    await waitFor(() =>
      expect(tabs()).toEqual([
        ['Fragen0', 'true'],
        ['Relationen0', 'false'],
      ]),
    );
  });

  it('shows a relation in two lines: the element and status, the arrow to the other end', async () => {
    const { user } = setup('/projects/demo/models/a/order');
    const panel = await screen.findByRole('complementary', { name: 'Dieses Modell' });
    await user.click(await within(panel).findByRole('tab', { name: /Relationen/ }));
    const [accepted, proposed] = within(panel).getAllByTestId('model-relation');
    const link = within(accepted!).getByRole('link');
    expect(link.getAttribute('aria-label')).toBe(
      'Aufruf, ausgehend: Zahlung abwickeln nach Zahlungsdienst (c/payment)',
    );
    expect(accepted!.textContent).toContain('Zahlungsdienst · c/payment');
    // the confidence on a proposal only; no tier badge
    expect(accepted!.textContent).not.toMatch(/100 %/);
    expect(proposed!.textContent).toMatch(/80 %/);
    expect(within(panel).queryByText(/Regel|Schlüssel/)).toBeNull();
  });

  it('puts the panel into a sheet below 1024 px: collapsed to its handle, Escape closes it', async () => {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList;
    const { user } = setup('/projects/demo/models/a/order');
    const panel = await screen.findByRole('complementary', { name: 'Dieses Modell' });
    const handle = within(panel).getByTestId('panel-handle');
    await waitFor(() => expect(handle.textContent).toBe('Fragen 2 · Relationen 2'));
    expect(handle.getAttribute('aria-expanded')).toBe('false');
    expect(panel.dataset['sheet']).toBe('collapsed');
    const content = document.getElementById(handle.getAttribute('aria-controls') ?? '');
    expect(content?.hasAttribute('inert')).toBe(true);
    await user.click(handle);
    expect(handle.getAttribute('aria-expanded')).toBe('true');
    expect(handle.textContent).toBe('Dieses Modell');
    expect(content?.hasAttribute('inert')).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(content));
    await user.keyboard('{Escape}');
    expect(handle.getAttribute('aria-expanded')).toBe('false');
    // the top bar: back to „Übersicht“, the name, the first chip
    const header = screen.getByTestId('model-header');
    expect(within(header).getByTestId('canvas-back').textContent).toBe('Übersicht');
    expect(within(header).getByTestId('canvas-title').textContent).toBe('Auftrag');
  });
});

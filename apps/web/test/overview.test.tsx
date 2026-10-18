/**
 * „Übersicht“ (UX-SIMPLIFICATION.md §2.3, §2.5, §3.2; UX1): the priority
 * rules of „Als Nächstes“, the counts every screen shares
 * (`useProjectCounts`), „Offene Punkte“ per model, „Modell suchen …“ and the
 * phase chips, the „Agent starten“ popover and the export hub; and the
 * block's budget (≤ 40 words, ≤ 5 controls) as a jsdom check.
 */
import type {
  AgentToken,
  AnalysisTask,
  Health,
  Landscape,
  Model,
  Project,
  Relation,
  ValueChainDetail,
} from '@analyzr/client';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { App } from '../src/app';
import { nextStep, type NextStepInput } from '../src/lib/next-step';
import { openPointsText, projectWork } from '../src/lib/project-counts';
import {
  agentTokensQuery,
  amendmentsQuery,
  analysesQuery,
  healthQuery,
  landscapeQuery,
  modelsQuery,
  openQuestionSummaryQuery,
  projectQuery,
  valueChainQuery,
  type OpenQuestionSummary,
} from '../src/lib/queries';
import { createAppRouter } from '../src/router';
import { agentToken, chainDetail, model, placement, relation, step } from './support/fixtures';
import { stubApi } from './support/render';

// ------------------------------------------------------------------ pure rules

const base: NextStepInput = {
  waiting: [],
  failed: [],
  expired: [],
  working: 0,
  reviewItems: 0,
  firstRelation: null,
  openPlacements: 0,
  firstPlacement: null,
  ask: 0,
  hasChain: true,
  hasRelations: true,
  isOwner: true,
  canReview: true,
  activeToken: true,
};

describe('„Als Nächstes“: the priority rules (first match wins)', () => {
  it('asks an owner to connect an agent while models wait and no token is active', () => {
    const step = nextStep({
      ...base,
      waiting: ['a'],
      activeToken: false,
      reviewItems: 3,
      firstRelation: 'rel_1',
    });
    expect(step.primary).toEqual({ kind: 'connect-agent' });
  });

  it('starts the agent first while models wait, the review as the second line', () => {
    const step = nextStep({
      ...base,
      waiting: ['a', 'b'],
      reviewItems: 42,
      firstRelation: 'rel_1',
    });
    expect(step.primary).toEqual({ kind: 'start-agent', waiting: 2 });
    expect(step.lines).toEqual([{ kind: 'review-too', count: 42, relationId: 'rel_1' }]);
  });

  it('offers „Nochmal versuchen“ first when only failed or expired analyses wait', () => {
    const step = nextStep({ ...base, failed: ['f'], expired: ['e'] });
    expect(step.primary).toEqual({ kind: 'retry', modelKeys: ['f', 'e'] });
    expect(step.lines).toEqual([]);
  });

  it('lets the agent rows give way while an agent works and nothing waits', () => {
    const step = nextStep({ ...base, working: 3, reviewItems: 5, firstRelation: 'rel_1' });
    expect(step.primary).toEqual({ kind: 'review', count: 5, relationId: 'rel_1' });
    expect(step.lines).toEqual([{ kind: 'working', count: 3 }]);
  });

  it('shows editors and viewers the waiting models as a line, then the next work', () => {
    const step = nextStep({
      ...base,
      isOwner: false,
      waiting: ['a'],
      failed: ['f'],
      reviewItems: 2,
      firstRelation: 'rel_1',
    });
    expect(step.primary).toEqual({ kind: 'review', count: 2, relationId: 'rel_1' });
    expect(step.lines).toEqual([
      { kind: 'waiting', count: 1 },
      { kind: 'failed', modelKeys: ['f'] },
    ]);
  });

  it('then placements, then the questions to clarify, then nothing', () => {
    expect(
      nextStep({ ...base, openPlacements: 29, firstPlacement: 'plc_1', ask: 21 }).primary,
    ).toEqual({ kind: 'placements', count: 29, placementId: 'plc_1' });
    expect(nextStep({ ...base, ask: 21 }).primary).toEqual({ kind: 'questions', count: 21 });
    expect(nextStep(base)).toEqual({ primary: null, lines: [] });
  });

  it('names a missing chain once relations exist, for reviewers only, at most two lines', () => {
    expect(nextStep({ ...base, hasChain: false }).lines).toEqual([{ kind: 'no-chain' }]);
    expect(nextStep({ ...base, hasChain: false, canReview: false }).lines).toEqual([]);
    const crowded = nextStep({
      ...base,
      waiting: ['w'],
      failed: ['f'],
      expired: ['e'],
      reviewItems: 1,
      firstRelation: 'rel_1',
      hasChain: false,
    });
    expect(crowded.lines.map((l) => l.kind)).toEqual(['failed', 'expired']);
  });
});

describe('the counts every screen shares', () => {
  const summary: OpenQuestionSummary = {
    totals: { ask: 21, agent: 22, proposal: 27, info: 32 },
    askByModel: { 'einkauf/bestellanforderung': 1 },
  };
  const chain = chainDetail({
    placements: [
      placement({ id: 'plc_1', elementId: 's', process: 'einkauf/bestellanforderung#P' }),
      placement({ id: 'plc_2', elementId: 's', process: 'einkauf/x#P', status: 'held' }),
      placement({ id: 'plc_3', elementId: 's', process: 'vertrieb/y#P' }),
    ],
  });

  it('counts each badge from its own list, holds in none of the first two', () => {
    const work = projectWork({
      relations: [
        { status: 'proposed', endpointState: 'ok' },
        { status: 'held', endpointState: 'ok' },
        { status: 'accepted', endpointState: 'changed' },
        { status: 'accepted', endpointState: 'ok' },
      ],
      chain,
      summary,
    });
    expect([work.reviewItems, work.openPlacements, work.ask]).toEqual([2, 2, 21]);
    expect(projectWork({ relations: [], chain: null, summary }).openPlacements).toBe(0);
    expect(
      projectWork({ relations: undefined, chain: undefined, summary: undefined }),
    ).toMatchObject({ reviewItems: undefined, openPlacements: undefined, ask: undefined });
  });

  it('is not ready, and gives no open points, until relations, chain and questions loaded', () => {
    const loading = [
      projectWork({ relations: undefined, chain, summary }),
      projectWork({ relations: [], chain: undefined, summary }),
      projectWork({ relations: [], chain, summary: undefined }),
    ];
    for (const work of loading) {
      expect(work.ready).toBe(false);
      expect(work.openPoints({ key: 'einkauf/bestellanforderung', openItems: 6 })).toBeNull();
    }
    expect(projectWork({ relations: [], chain: null, summary }).ready).toBe(true);
    // A failed query settles too: its part counts as 0 instead of a placeholder forever.
    const failed = projectWork({ relations: [], chain, summary: undefined, settled: true });
    expect(failed.ready).toBe(true);
    expect(failed.openPoints({ key: 'einkauf/bestellanforderung', openItems: 6 })?.questions).toBe(
      0,
    );
  });

  it('adds relations, the open placements and the questions of a model: 6 + 1 + 1 = 8', () => {
    const work = projectWork({ relations: [], chain, summary });
    const points = work.openPoints({ key: 'einkauf/bestellanforderung', openItems: 6 });
    expect(points).toEqual({ total: 8, relations: 6, placements: 1, questions: 1 });
    expect(points && openPointsText(points)).toBe('6 Relationen · 1 Platzierung · 1 Frage');
    // A held placement is open work of its model too (its question names no model in
    // `askByModel`), though no badge of the chain counts it.
    expect(work.openPoints({ key: 'einkauf/x', openItems: 0 })).toEqual({
      total: 1,
      relations: 0,
      placements: 1,
      questions: 0,
    });
    expect(work.openPoints({ key: 'vertrieb/z', openItems: 0 })?.total).toBe(0);
  });
});

// ------------------------------------------------------------------ the screen

const LOCAL: Health = { status: 'ok', version: '0.1.0-test', db: 'ok' };

function project(role: Project['role']): Project {
  return {
    id: 'prj_01DEMO',
    key: 'demo',
    name: 'Demo',
    role,
    lastSeq: 7,
    createdAt: '2026-10-07T09:00:00.000Z',
  };
}

interface Setup {
  role?: Project['role'];
  models?: Model[];
  relations?: Relation[];
  chain?: ValueChainDetail | null;
  summary?: OpenQuestionSummary;
  tokens?: AgentToken[];
  claimed?: AnalysisTask[];
}

function setup(path: string, s: Setup = {}) {
  const calls = stubApi({});
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  const role = s.role ?? 'owner';
  queryClient.setQueryData(healthQuery.queryKey, LOCAL);
  queryClient.setQueryData(projectQuery('demo').queryKey, project(role));
  queryClient.setQueryData(modelsQuery('demo').queryKey, s.models ?? []);
  const landscape: Landscape = {
    projectId: 'prj_01DEMO',
    seq: 7,
    models: [],
    relations: s.relations ?? [],
    findings: [],
  };
  queryClient.setQueryData(landscapeQuery('demo').queryKey, landscape);
  if (s.chain) queryClient.setQueryData(valueChainQuery('demo').queryKey, s.chain);
  queryClient.setQueryData(
    openQuestionSummaryQuery('demo').queryKey,
    s.summary ?? { totals: { ask: 0, agent: 0, proposal: 0, info: 0 }, askByModel: {} },
  );
  queryClient.setQueryData(agentTokensQuery('demo').queryKey, s.tokens ?? []);
  queryClient.setQueryData(analysesQuery('demo', 'claimed').queryKey, s.claimed ?? []);
  queryClient.setQueryData(analysesQuery('demo', 'failed').queryKey, []);
  queryClient.setQueryData(amendmentsQuery('demo').queryKey, []);
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<App queryClient={queryClient} router={router} />);
  return { calls, router, user: userEvent.setup() };
}

const proposal = (id: string, from: string, to: string, confidence = 1) =>
  relation({ id, from: `${from}#A`, to: `${to}#B`, confidence });
const TOKEN = agentToken({ id: 'agt_01A', name: 'claude' });

/** Visible words and controls of an element (the UI load guard's measure, in jsdom). */
function measure(element: HTMLElement) {
  const words = (element.textContent ?? '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  const controls = element.querySelectorAll('button, a[href], input, select, [role=menuitem]');
  return { words: words.length, controls: controls.length };
}

describe('„Übersicht“', () => {
  it('starts the agent first while models wait (owner with a token), the review below', async () => {
    const { user } = setup('/projects/demo', {
      models: [
        model({ key: 'a/wait', stage: 'waiting_for_agent', openItems: 0 }),
        model({ key: 'b/review', stage: 'waiting_for_review', openItems: 1 }),
      ],
      relations: [proposal('rel_01P', 'b/review', 'a/wait')],
      tokens: [TOKEN],
    });
    const block = await screen.findByTestId('next-step');
    const start = await within(block).findByRole('button', { name: 'Agent starten' });
    // Without a chain, the second line names it (relations exist).
    expect(
      within(block)
        .getAllByTestId('next-step-line')
        .map((l) => l.textContent),
    ).toEqual([
      'Oder jetzt schon: Vorschläge prüfen (1). Was du entscheidest, sieht der Agent bei seiner nächsten Aufgabe.',
      'Noch keine Wertschöpfungskette · Anlegen oder importieren',
    ]);
    const budget = measure(block);
    expect(budget.words).toBeLessThanOrEqual(40);
    expect(budget.controls).toBeLessThanOrEqual(5);
    // The popover: the skill command, no placements command without a chain, the prompt, the line.
    await user.click(start);
    const panel = screen.getByTestId('agent-start');
    expect(panel.textContent).toContain('/analyzr:relations demo');
    expect(panel.textContent).not.toContain('/analyzr:placements');
    expect(
      within(panel)
        .getByRole('link', { name: /Startprompt für Claude Desktop/ })
        .getAttribute('href'),
    ).toBe(
      'https://github.com/Miragon/analyzr/blob/main/examples/agents/claude-desktop/start-prompt.de.md',
    );
    expect(panel.textContent).toContain(
      'Die Vorschläge erscheinen unter „Relationen“. Entscheiden kannst nur du.',
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('agent-start')).toBeNull();
  });

  it('asks the owner to connect an agent while models wait and no token is active', async () => {
    setup('/projects/demo', {
      models: [model({ key: 'a/wait', stage: 'waiting_for_agent', openItems: 0 })],
      tokens: [agentToken({ id: 'agt_01R', name: 'old', revokedAt: '2026-10-08T09:00:00.000Z' })],
    });
    const block = await screen.findByTestId('next-step');
    const link = await within(block).findByRole('link', { name: 'Agent verbinden' });
    expect(link.getAttribute('href')).toBe('/projects/demo/agents');
  });

  it('opens the review at the queue’s first item while an agent works, and says it works', async () => {
    const claimed: AnalysisTask = {
      id: 'ana_01W',
      projectId: 'prj_01DEMO',
      kind: 'relations',
      subjectKind: 'model',
      modelId: 'mdl_AWORK',
      modelKey: 'a/work',
      revisionId: 'rev_AWORK',
      valueChainId: null,
      valueChainKey: null,
      valueChainRevisionId: null,
      state: 'claimed',
      attempts: 1,
      factsHash: 'a'.repeat(64),
      inputHash: null,
      leaseUntil: '2999-01-01T22:45:00.000Z',
      claimedBy: 'agent:agent-sim',
      lastError: null,
      submissionId: null,
      createdAt: '2026-10-07T09:00:00.000Z',
      updatedAt: '2026-10-07T09:00:00.000Z',
    };
    setup('/projects/demo', {
      models: [
        model({ key: 'a/work', stage: 'agent_working', openItems: 0 }),
        model({ key: 'b/review', stage: 'waiting_for_review', openItems: 2 }),
      ],
      relations: [
        proposal('rel_01LOW', 'b/review', 'c/x', 0.6),
        proposal('rel_01HIGH', 'b/review', 'd/y', 0.9),
      ],
      tokens: [TOKEN],
      claimed: [claimed],
    });
    const primary = await screen.findByTestId('next-step-primary');
    expect(primary.textContent).toBe('Vorschläge prüfen (2)');
    expect(primary.getAttribute('href')).toBe('/projects/demo/review/rel_01HIGH');
    expect(screen.getAllByTestId('next-step-line').map((l) => l.textContent)).toEqual([
      'Agent arbeitet – 1 Modell offen',
      'Noch keine Wertschöpfungskette · Anlegen oder importieren',
    ]);
    // The holder and the reservation in the phase cell.
    const row = screen.getAllByTestId('model-row').find((r) => r.dataset['modelKey'] === 'a/work');
    expect(within(row!).getAllByTestId('stage-note')[0]?.textContent).toMatch(
      /^agent-sim · reserviert bis \d\d\.\d\d\.\d{4}, \d\d:\d\d$/,
    );
  });

  it('then the placements at the queue’s first item, then the questions, then „Alles geprüft.“', async () => {
    const chain = chainDetail({
      steps: [step({ elementId: 's-1', name: 'Einkauf' })],
      placements: [placement({ id: 'plc_01A', elementId: 's-1', process: 'a/x#P' })],
    });
    setup('/projects/demo', {
      models: [model({ key: 'a/x', stage: 'incorporated', openItems: 0 })],
      chain,
      summary: { totals: { ask: 3, agent: 0, proposal: 0, info: 0 }, askByModel: {} },
    });
    const primary = await screen.findByTestId('next-step-primary');
    expect(primary.textContent).toBe('Platzierungen prüfen (1)');
    expect(primary.getAttribute('href')).toBe('/projects/demo/value-chain?placement=plc_01A');
  });

  it('sends to „Offene Fragen“ when only questions are open', async () => {
    setup('/projects/demo', {
      models: [model({ key: 'a/x', stage: 'incorporated', openItems: 0 })],
      summary: { totals: { ask: 21, agent: 2, proposal: 0, info: 4 }, askByModel: { 'a/x': 21 } },
    });
    const primary = await screen.findByTestId('next-step-primary');
    expect(primary.textContent).toBe('Offene Fragen klären (21)');
    expect(primary.getAttribute('href')).toBe('/projects/demo/open-questions');
    const nav = screen.getByRole('navigation', { name: 'Projektbereiche' });
    expect(within(nav).getByRole('link', { name: /Offene Fragen/ }).textContent).toBe(
      'Offene Fragen21 zu klären',
    );
  });

  it('says „Alles geprüft.“ when nothing is open, and shows no zero badge', async () => {
    setup('/projects/demo', {
      models: [model({ key: 'a/x', stage: 'incorporated', openItems: 0 })],
    });
    expect((await screen.findByTestId('next-step-done')).textContent).toBe('Alles geprüft.');
    const nav = screen.getByRole('navigation', { name: 'Projektbereiche' });
    for (const link of within(nav).getAllByRole('link')) expect(link.textContent).not.toMatch(/\d/);
    expect(screen.queryByTestId('export-hub')).toBeNull();
  });

  it('gives a viewer the same text without buttons', async () => {
    setup('/projects/demo', {
      role: 'viewer',
      models: [
        model({ key: 'a/wait', stage: 'waiting_for_agent', openItems: 0 }),
        model({ key: 'b/review', stage: 'waiting_for_review', openItems: 1 }),
      ],
      relations: [proposal('rel_01P', 'b/review', 'a/wait')],
    });
    const primary = await screen.findByTestId('next-step-primary');
    const block = screen.getByTestId('next-step');
    expect(within(block).queryByRole('button')).toBeNull();
    expect(primary.textContent).toBe('Vorschläge prüfen (1)');
    expect(block.textContent).toContain('1 Modell wartet auf den Agenten');
  });

  it('shows four columns and the open points of a model with their split and target', async () => {
    setup('/projects/demo', {
      models: [
        model({
          key: 'einkauf/bestellanforderung',
          name: 'Nordwind Handel – Einkauf',
          openItems: 6,
        }),
        model({
          key: 'finanzen/gutschrift',
          name: 'Gutschrift erstellen',
          stage: 'incorporated',
          openItems: 0,
        }),
      ],
      chain: chainDetail({
        steps: [step({ elementId: 's-1', name: 'Einkauf' })],
        placements: [
          placement({ id: 'plc_01A', elementId: 's-1', process: 'einkauf/bestellanforderung#P' }),
        ],
      }),
      summary: {
        totals: { ask: 2, agent: 0, proposal: 0, info: 0 },
        askByModel: { 'einkauf/bestellanforderung': 1, 'finanzen/gutschrift': 1 },
      },
    });
    const table = await screen.findByRole('table', { name: 'Modelle' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Name', 'Phase', 'Offene Punkte', 'Aktualisiert']);
    const rows = screen.getAllByTestId('model-row');
    const first = within(rows[1]!);
    expect(first.getByRole('link', { name: 'Nordwind Handel – Einkauf' })).toBeTruthy();
    const points = first.getByTestId('open-points');
    expect(points.textContent).toBe('8');
    // Text, not a link: no one list holds a model's relations, placements and questions (P7);
    // the split is repeated in a tooltip on the focusable number (§3.13 item 6).
    expect(points.closest('a')).toBeNull();
    const trigger = points.parentElement!;
    expect(trigger.tabIndex).toBe(0);
    expect(trigger.textContent).toBe('8 offene Punkte');
    const split = document.getElementById(trigger.getAttribute('aria-describedby')!);
    expect(split?.getAttribute('role')).toBe('tooltip');
    expect(split?.textContent).toBe('6 Relationen · 1 Platzierung · 1 Frage');
    // One point: „offener Punkt“.
    expect(within(rows[0]!).getByTestId('open-points').parentElement?.textContent).toBe(
      '1 offener Punkt',
    );
  });

  it('finds „Gutschrift“ by name or key, umlauts and case folded, and keeps it in the URL', async () => {
    const { router, user } = setup('/projects/demo', {
      models: [
        model({ key: 'finanzen/gutschrift', name: 'Gutschrift erstellen' }),
        model({ key: 'vertrieb/order-handling', name: 'Order handling' }),
        model({ key: 'service/ruecklastschrift', name: 'Rücklastschrift prüfen' }),
      ],
    });
    await user.type(await screen.findByRole('searchbox', { name: 'Modell suchen' }), 'gutschrift');
    await waitFor(() => expect(screen.getAllByTestId('model-row')).toHaveLength(1));
    expect(router.state.location.search).toEqual({ q: 'gutschrift' });
    await user.clear(screen.getByRole('searchbox', { name: 'Modell suchen' }));
    await user.type(screen.getByRole('searchbox', { name: 'Modell suchen' }), 'rücklast');
    await waitFor(() =>
      expect(screen.getAllByTestId('model-row').map((r) => r.dataset['modelKey'])).toEqual([
        'service/ruecklastschrift',
      ]),
    );
  });

  it('filters by the phase chips (stages with models only) and links their proposals', async () => {
    const { router, user } = setup('/projects/demo', {
      models: [
        model({ key: 'a/r1', stage: 'waiting_for_review', openItems: 1 }),
        model({ key: 'b/r2', stage: 'waiting_for_review', openItems: 1 }),
        model({ key: 'c/done', stage: 'incorporated', openItems: 0 }),
      ],
      relations: [proposal('rel_01P', 'a/r1', 'b/r2')],
    });
    const chips = await screen.findByRole('group', { name: 'Modelle nach Phase' });
    expect(
      within(chips)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Alle 3', 'Wartet auf Prüfung 2', 'Eingearbeitet 1']);
    await user.click(within(chips).getByRole('button', { name: /Wartet auf Prüfung/ }));
    await waitFor(() => expect(screen.getAllByTestId('model-row')).toHaveLength(2));
    expect(router.state.location.search).toEqual({ stage: 'waiting_for_review' });
    const link = screen.getByTestId('stage-proposals');
    expect(link.textContent).toBe('1 Vorschlag dieser Modelle prüfen');
    expect(link.getAttribute('href')).toBe('/projects/demo/review?stage=waiting_for_review');
  });

  it('offers in „Exportieren“ only what has content, the questions through the customer dialog', async () => {
    const { user } = setup('/projects/demo', {
      models: [model({ key: 'a/x', stage: 'incorporated', openItems: 0 })],
      summary: { totals: { ask: 2, agent: 3, proposal: 0, info: 0 }, askByModel: {} },
      chain: chainDetail(),
    });
    await user.click(await screen.findByTestId('export-hub'));
    const menu = screen.getByRole('menu', { name: 'Exportieren' });
    expect(
      within(menu)
        .getAllByRole('group')
        .map((g) => g.getAttribute('aria-label')),
    ).toEqual(['Wertschöpfungskette']);
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(['Fragen für den Kunden (Markdown, CSV) …', 'Datei (.vc.json)', 'Bild (SVG)']);
    expect(within(menu).getByRole('menuitem', { name: 'Bild (SVG)' }).getAttribute('href')).toBe(
      '/projects/demo/value-chain?export=svg',
    );
    // The arrow keys walk the menu.
    expect(document.activeElement?.textContent).toBe('Fragen für den Kunden (Markdown, CSV) …');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toBe('Datei (.vc.json)');
    // the dialog of „Offene Fragen“, loaded on first use: „Zu klären“, the agents' on request
    await user.click(within(menu).getByRole('menuitem', { name: /Fragen für den Kunden/ }));
    const dialog = await screen.findByTestId('customer-export-dialog');
    expect(within(dialog).getByRole('radio', { name: /Zum Lesen \(Markdown\)/ })).toBeDefined();
    expect(
      within(dialog).getByRole('checkbox', { name: 'Auch Fragen der Agenten (3)' }),
    ).toBeDefined();
  });
});

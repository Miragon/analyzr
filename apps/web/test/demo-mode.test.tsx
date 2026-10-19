/**
 * The read-only demo in the web UI (owner decision 20): the banner while `/health`
 * reports `demo: "readonly"`, and no write action for a viewer, which every
 * demo session is: no project creation, no upload, agent or rules tab, read-
 * only notices on their direct URLs without a request, no bulk accept,
 * requeue or answer field in the inbox, no decision panel (and no A/R/H/C) on
 * the review screen. Outside the demo the same gates follow the role (an
 * editor uploads, only owners connect agents and see rules). Every role reads
 * the agents' no-links in the inbox tab „Kein Zusammenhang“.
 */
import type {
  Health,
  Landscape,
  Model,
  NoLink,
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
import { ApiError, DEMO_READONLY_MESSAGE, errorMessage } from '../src/lib/api';
import {
  analysesQuery,
  assertionsQuery,
  contentQuery,
  factsQuery,
  healthQuery,
  landscapeQuery,
  modelsQuery,
  noLinksQuery,
  projectQuery,
  projectsQuery,
  relationQuery,
  valueChainQuery,
} from '../src/lib/queries';
import { createAppRouter } from '../src/router';
import { chainDetail, model, placement, provenance, relation } from './support/fixtures';
import { stubApi, type Call } from './support/render';

const DEMO_HEALTH: Health = { status: 'ok', version: '0.1.0-test', db: 'ok', demo: 'readonly' };
const LINKS = {
  imprintUrl: 'https://example.org/impressum',
  privacyUrl: 'https://example.org/datenschutz/',
};
const LOCAL_HEALTH: Health = { status: 'ok', version: '0.1.0-test', db: 'ok' };

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

const models: Model[] = [
  model({ key: 'a/held', stage: 'waiting_for_clarification', openItems: 1 }),
  model({ key: 'b/failed', stage: 'agent_failed', openItems: 0 }),
  model({ key: 'c/review', stage: 'waiting_for_review', openItems: 1 }),
];
const proposal = relation({
  id: 'rel_01PROPOSED',
  from: 'c/review#S',
  to: 'a/held#C',
  provenance: provenance(),
});
const held = relation({
  id: 'rel_01HELD',
  from: 'a/held#S',
  to: 'c/review#C',
  status: 'held',
  tier: 'semantic',
  provenance: provenance({ kind: 'decision', verdict: 'hold', rationale: 'Fachbereich fragen' }),
});
const relations: Relation[] = [proposal, held];

/** Agents' no-links on pairs without a relation, oldest first. */
const noLinks: NoLink[] = [
  {
    id: 'nlk_01FIRST',
    type: 'message',
    from: 'a/held#Throw',
    to: 'b/failed#Catch',
    handle: 'agent:analyzr-agent-sim',
    origin: 'a/held',
    reason: 'no-evidence: Die Namen ähneln sich nur zufällig.',
    at: '2026-10-07T09:00:00.000Z',
  },
  {
    id: 'nlk_01SECOND',
    type: 'trigger',
    from: 'b/failed#End',
    to: 'c/review#Start',
    handle: 'agent:analyzr-agent-sim',
    origin: 'c/review',
    reason: 'near-miss: Ein anderes Ende.',
    at: '2026-10-07T09:01:00.000Z',
  },
];

function setup(
  path: string,
  {
    health,
    role,
    modelList = models,
    relationList = relations,
    chain,
  }: {
    health: Health;
    role: Project['role'];
    modelList?: Model[];
    relationList?: Relation[];
    chain?: ValueChainDetail;
  },
): { calls: Call[]; user: ReturnType<typeof userEvent.setup> } {
  const calls = stubApi({});
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(healthQuery.queryKey, health);
  queryClient.setQueryData(projectsQuery.queryKey, [project(role)]);
  queryClient.setQueryData(projectQuery('demo').queryKey, project(role));
  const landscape: Landscape = {
    projectId: 'prj_01DEMO',
    seq: 7,
    models: [],
    relations: relationList,
    findings: [],
  };
  queryClient.setQueryData(landscapeQuery('demo').queryKey, landscape);
  queryClient.setQueryData(modelsQuery('demo').queryKey, modelList);
  queryClient.setQueryData(noLinksQuery('demo').queryKey, noLinks);
  queryClient.setQueryData(analysesQuery('demo', 'failed').queryKey, []);
  queryClient.setQueryData(analysesQuery('demo', 'queued').queryKey, []);
  if (chain) queryClient.setQueryData(valueChainQuery('demo').queryKey, chain);
  for (const r of relationList) {
    queryClient.setQueryData(relationQuery('demo', r.id).queryKey, r);
    queryClient.setQueryData(assertionsQuery('demo', r.id).queryKey, []);
  }
  for (const m of modelList) {
    const ref = { project: 'demo', modelId: m.id, revisionId: m.headRevisionId ?? '' };
    queryClient.setQueryData(factsQuery(ref).queryKey, {
      modelKey: m.key,
      revisionId: m.headRevisionId,
      factsVersion: '1',
      processes: [],
      facts: [],
      messageFlows: [],
    });
    queryClient.setQueryData(contentQuery(ref).queryKey, { xml: `<xml model="${m.key}"/>` });
  }
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<App queryClient={queryClient} router={router} />);
  return { calls, user: userEvent.setup() };
}

/** Calls that would change something (the session aside). */
const writes = (calls: readonly Call[]) =>
  calls.filter((c) => c.method !== 'GET' && c.path !== '/api/v1/session');

describe('the demo banner', () => {
  it('shows on a demo with the repository link and marks the document', async () => {
    setup('/', { health: DEMO_HEALTH, role: 'viewer' });
    const banner = await screen.findByTestId('demo-banner');
    expect(banner.textContent).toContain('Demo – nur lesen.');
    expect(banner.textContent).toContain('Du kannst dir alles ansehen, aber nichts ändern.');
    expect(banner.textContent).not.toMatch(/Nacht|nightly|zurückgesetzt/);
    const link = within(banner).getByRole('link', { name: /analyzr auf GitHub/ });
    expect(link.getAttribute('href')).toBe('https://github.com/Miragon/analyzr');
    expect(link.getAttribute('rel')).toBe('noreferrer');
    await waitFor(() => expect(document.documentElement.dataset['analyzrDemo']).toBe('readonly'));
  });

  it('links the operator’s Impressum and Datenschutz in a new tab when health reports them', async () => {
    setup('/', { health: { ...DEMO_HEALTH, ...LINKS }, role: 'viewer' });
    const banner = await screen.findByTestId('demo-banner');
    const legal = within(banner).getByRole('navigation', { name: 'Rechtliches' });
    const links = within(legal).getAllByRole('link');
    expect(links.map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['Impressum', LINKS.imprintUrl],
      ['Datenschutz', LINKS.privacyUrl],
    ]);
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noreferrer');
      // Never shrunk or truncated away by the flex line (the sentence truncates instead).
      expect(link.className).toContain('whitespace-nowrap');
    }
    expect(legal.className).toContain('shrink-0');
  });

  it('shows only the links health reports, and only absolute https ones', async () => {
    setup('/', {
      health: { ...DEMO_HEALTH, privacyUrl: LINKS.privacyUrl },
      role: 'viewer',
    });
    const banner = await screen.findByTestId('demo-banner');
    expect(within(banner).queryByRole('link', { name: 'Impressum' })).toBeNull();
    expect(within(banner).getByRole('link', { name: 'Datenschutz' })).toBeDefined();
  });

  it('has no legal links without them or with a non-https one', async () => {
    setup('/', {
      // A server checks the scheme; the UI never renders another as a link either.
      health: { ...DEMO_HEALTH, imprintUrl: 'javascript:alert(1)' },
      role: 'viewer',
    });
    const banner = await screen.findByTestId('demo-banner');
    expect(within(banner).queryByRole('navigation', { name: 'Rechtliches' })).toBeNull();
    expect(
      within(banner)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['analyzr auf GitHub']);
  });

  it('is absent outside the demo, and the document is not marked', async () => {
    setup('/', { health: LOCAL_HEALTH, role: 'owner' });
    await screen.findByText('Projekte', { selector: 'h1' });
    expect(screen.queryByTestId('demo-banner')).toBeNull();
    expect(document.documentElement.dataset['analyzrDemo']).toBeUndefined();
  });
});

describe('the projects page', () => {
  it('offers no new project and no seed command on the demo; the role says „Leser“', async () => {
    setup('/', { health: DEMO_HEALTH, role: 'viewer' });
    const row = await screen.findByTestId('project-row');
    expect(row.textContent).toContain('Leser');
    // UX9: the visitor cannot decide anything, so nothing is open for them, also while the
    // summary (not stubbed here) fails: „–“, never „nicht geladen“.
    await within(within(row).getByTestId('last-changed')).findByText('–');
    expect(within(row).getByTestId('open-for-you').textContent).toBe('–');
    expect(screen.queryByRole('button', { name: /Neues Projekt/ })).toBeNull();
    expect(screen.queryByText(/Testlandschaften laden/)).toBeNull();
  });

  it('offers both in local mode', async () => {
    setup('/', { health: LOCAL_HEALTH, role: 'owner' });
    expect(await screen.findByRole('button', { name: /Neues Projekt/ })).toBeDefined();
    expect(screen.getByText(/Testlandschaften laden/)).toBeDefined();
  });
});

describe('project tabs and write pages', () => {
  const tabNames = (nav: HTMLElement) =>
    within(nav)
      .getAllByRole('link')
      .map((l) => l.textContent.replace(/\d+.*/, '').trim());

  it('shows a viewer the four object tabs and no upload or settings entry', async () => {
    setup('/projects/demo', { health: DEMO_HEALTH, role: 'viewer' });
    const nav = await screen.findByRole('navigation', { name: 'Projektbereiche' });
    // Owner decision 26: four object tabs, every role reads them.
    expect(tabNames(nav)).toEqual([
      'Übersicht',
      'Relationen',
      'Wertschöpfungskette',
      'Offene Fragen',
    ]);
    expect(screen.queryByRole('link', { name: 'Hochladen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Einstellungen' })).toBeNull();
  });

  it('shows an owner „Hochladen“ and the menu „Einstellungen“ outside the demo', async () => {
    const { user } = setup('/projects/demo', { health: LOCAL_HEALTH, role: 'owner' });
    const nav = await screen.findByRole('navigation', { name: 'Projektbereiche' });
    expect(tabNames(nav)).toEqual([
      'Übersicht',
      'Relationen',
      'Wertschöpfungskette',
      'Offene Fragen',
    ]);
    expect(screen.getByRole('link', { name: 'Hochladen' }).getAttribute('href')).toBe(
      '/projects/demo/upload',
    );
    const gear = screen.getByRole('button', { name: 'Einstellungen' });
    expect(gear.getAttribute('aria-expanded')).toBe('false');
    await user.click(gear);
    const menu = screen.getByRole('menu', { name: 'Einstellungen' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => [i.textContent, i.getAttribute('href')]),
    ).toEqual([
      ['Agent verbinden', '/projects/demo/agents'],
      ['Annahmeregeln', '/projects/demo/rules'],
    ]);
    // Escape closes it and gives the focus back.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(gear);
  });

  it('shows an editor „Hochladen“, but no menu „Einstellungen“', async () => {
    setup('/projects/demo', { health: LOCAL_HEALTH, role: 'editor' });
    await screen.findByRole('navigation', { name: 'Projektbereiche' });
    expect(screen.getByRole('link', { name: 'Hochladen' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Einstellungen' })).toBeNull();
  });

  it.each([
    ['/projects/demo/agents', 'Agent-Tokens erstellen und widerrufen nur die Inhaber'],
    ['/projects/demo/rules', 'Annahmeregeln sehen und pflegen nur die Inhaber'],
  ])('answers %s for an editor with the owner-only notice and no request', async (path, text) => {
    const { calls } = setup(path, { health: LOCAL_HEALTH, role: 'editor' });
    const notice = await screen.findByTestId('read-only-notice');
    expect(notice.textContent).toContain(text);
    expect(within(notice).queryByRole('link', { name: 'analyzr auf GitHub' })).toBeNull();
    // Tokens and rules are the owners'; the ledger of auto-acceptances is every reviewer's.
    expect(calls.filter((c) => /agent-tokens|auto-accept-rules/.test(c.path))).toEqual([]);
    expect(writes(calls)).toEqual([]);
  });

  it.each([
    ['viewer', DEMO_HEALTH, [], 'Dieses Projekt hat noch keine Modelle.'],
    ['viewer', LOCAL_HEALTH, [], 'Dieses Projekt hat noch keine Modelle.'],
    ['editor', LOCAL_HEALTH, ['Modelle hochladen'], 'Lade BPMN-Dateien hoch.'],
    // The trust rule (M6 S2c): only calls of Camunda models are linked at once.
    [
      'owner',
      LOCAL_HEALTH,
      ['Modelle hochladen', 'Agent verbinden'],
      'verknüpft eindeutige Aufrufe aus Camunda-Modellen sofort und schlägt die übrigen',
    ],
  ] as const)(
    'offers an empty project’s %s (%o) only the actions of the role',
    async (role, health, actions, text) => {
      setup('/projects/demo', { health, role, modelList: [], relationList: [] });
      const empty = (await screen.findByText('Noch keine Modelle')).closest('[data-slot="empty"]');
      if (!(empty instanceof HTMLElement)) throw new Error('no empty state');
      expect(empty.textContent).toContain(text);
      expect(
        within(empty)
          .queryAllByRole('link')
          .map((l) => l.textContent.trim()),
      ).toEqual(actions);
    },
  );

  it.each([
    ['/projects/demo/upload', 'In der Demo kannst du keine Modelle hochladen.'],
    ['/projects/demo/agents', 'In der Demo verbindet sich kein Agent'],
    ['/projects/demo/rules', 'In der Demo gibt es keine Annahmeregeln.'],
  ])('answers %s on the demo with a notice and no request', async (path, text) => {
    const { calls } = setup(path, { health: DEMO_HEALTH, role: 'viewer' });
    const notice = await screen.findByTestId('read-only-notice');
    expect(notice.textContent).toContain(text);
    expect(within(notice).getByRole('link', { name: 'analyzr auf GitHub' })).toBeDefined();
    expect(screen.queryByTestId('upload-dropzone')).toBeNull();
    expect(calls.filter((c) => /agent-tokens|auto-accept|imports/.test(c.path))).toEqual([]);
    expect(writes(calls)).toEqual([]);
  });

  it('names the role it takes outside the demo', async () => {
    setup('/projects/demo/upload', { health: LOCAL_HEALTH, role: 'viewer' });
    expect((await screen.findByTestId('read-only-notice')).textContent).toContain(
      'Bearbeiter und Inhaber',
    );
  });
});

describe('the review inbox for a viewer', () => {
  it('lists proposals without bulk accept', async () => {
    const { calls } = setup('/projects/demo/review', { health: DEMO_HEALTH, role: 'viewer' });
    expect(await screen.findAllByTestId('queue-row')).toHaveLength(1);
    expect(screen.queryByTestId('bulk-open')).toBeNull();
    expect(writes(calls)).toEqual([]);
  });

  it('lists failed models on „Übersicht“ without „Nochmal versuchen“', async () => {
    const { calls } = setup('/projects/demo', { health: DEMO_HEALTH, role: 'viewer' });
    const row = (await screen.findAllByTestId('model-row')).find(
      (r) => r.dataset['modelKey'] === 'b/failed',
    );
    expect(row?.textContent).toContain('Agent gescheitert');
    expect(screen.queryByRole('button', { name: /Nochmal versuchen/ })).toBeNull();
    // „Als Nächstes“ names the failure as text, with nothing to click (once every count loaded).
    await waitFor(() =>
      expect(screen.getByTestId('next-step').textContent).toContain('1 Analyse gescheitert'),
    );
    const next = screen.getByTestId('next-step');
    expect(within(next).queryByRole('button')).toBeNull();
    expect(writes(calls)).toEqual([]);
  });

  it('shows held relations with their question, without an answer field', async () => {
    setup('/projects/demo/review?view=held', { health: DEMO_HEALTH, role: 'viewer' });
    const item = await screen.findByTestId('held-item');
    expect(item.textContent).toContain('Fachbereich fragen');
    expect(within(item).queryByRole('form', { name: 'Antwort geben' })).toBeNull();
  });

  it('keeps bulk accept for an owner', async () => {
    setup('/projects/demo/review', { health: LOCAL_HEALTH, role: 'owner' });
    expect(await screen.findAllByTestId('bulk-open')).not.toHaveLength(0);
  });

  it('asks no viewer to connect an agent while models wait for one', async () => {
    setup('/projects/demo/review', {
      health: LOCAL_HEALTH,
      role: 'viewer',
      modelList: [model({ key: 'w/wait', stage: 'waiting_for_agent', openItems: 0 })],
      relationList: [],
    });
    // no relation yet: what comes next instead of views and filters (UX9)
    await screen.findByText('Noch keine Relationen');
    expect(screen.queryByRole('navigation', { name: 'Ansichten' })).toBeNull();
    // the status line says it (UX5); starting the agent is the owner's
    expect(screen.getByTestId('review-status').textContent).toBe('1 Modell wartet auf den Agenten');
    expect(screen.queryByRole('link', { name: /Agent verbinden/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Agent starten/ })).toBeNull();
  });

  it('leaves the placements to the chain: no callout in the inbox (UX5)', async () => {
    setup('/projects/demo/review', {
      health: DEMO_HEALTH,
      role: 'viewer',
      chain: chainDetail({
        placements: [placement({ id: 'plc_01OPEN', elementId: 's-1', process: 'c/review#P' })],
      }),
    });
    await screen.findByRole('navigation', { name: 'Ansichten' });
    expect(screen.queryByTestId('placements-callout')).toBeNull();
    expect(screen.queryByTestId('review-start')).toBeNull();
  });
});

describe('the agents’ no-links in the inbox', () => {
  it('lists them read-only for a viewer on the demo, with the count on the tab', async () => {
    const { calls } = setup('/projects/demo/review?view=no-links', {
      health: DEMO_HEALTH,
      role: 'viewer',
    });
    const items = await screen.findAllByTestId('no-link-item');
    expect(items.map((i) => i.dataset['noLinkId'])).toEqual(['nlk_01FIRST', 'nlk_01SECOND']);
    expect(items[0]?.textContent).toContain('no-evidence: Die Namen ähneln sich nur zufällig.');
    expect(items[0]?.textContent).toContain('agent:analyzr-agent-sim');
    expect(items[0]?.textContent).toContain('Analyse von a/held');
    // behind the foot link of „Zu prüfen“ (Q12), grouped by model; the way back on top
    expect(screen.getAllByTestId('no-link-group').length).toBeGreaterThan(0);
    expect(screen.getByTestId('no-links-back').textContent).toBe('Zu prüfen');
    for (const item of items) expect(within(item).queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('bulk-open')).toBeNull();
    expect(writes(calls)).toEqual([]);
  });

  it('follows the model filter of the inbox', async () => {
    setup('/projects/demo/review?view=no-links&model=c%2Freview', {
      health: LOCAL_HEALTH,
      role: 'owner',
    });
    const items = await screen.findAllByTestId('no-link-item');
    expect(items.map((i) => i.dataset['noLinkId'])).toEqual(['nlk_01SECOND']);
    // A no-link has no tier: the tab offers no tier filter.
    expect(screen.queryByLabelText('Grundlage')).toBeNull();
    expect(screen.getByLabelText('Modell')).toBeDefined();
    // A no-link needs no decision: no bulk accept on this tab, also for an owner.
    expect(screen.queryByTestId('bulk-open')).toBeNull();
  });

  it('says so when the filter leaves none', async () => {
    setup('/projects/demo/review?view=no-links&model=x%2Fnone', {
      health: LOCAL_HEALTH,
      role: 'owner',
    });
    expect(await screen.findByText('Kein Paar passt zu den Filtern')).toBeDefined();
  });
});

describe('the review screen for a viewer', () => {
  it('has no decision panel; A, R, H and C do nothing, J/K still walk', async () => {
    const { calls, user } = setup('/projects/demo/review/rel_01PROPOSED', {
      health: DEMO_HEALTH,
      role: 'viewer',
    });
    const line = await screen.findByTestId('read-only-review');
    expect(line.textContent).toBe('Nur lesen – in der Demo entscheidest du nicht.');
    expect(screen.queryByRole('button', { name: /Annehmen/ })).toBeNull();
    await user.keyboard('arhc');
    expect(writes(calls)).toEqual([]);
    expect(screen.getByText(/weiter, zurück/)).toBeDefined();
    expect(screen.queryByText(/entscheiden$/)).toBeNull();
  });

  it('keeps the decision panel for an owner', async () => {
    setup('/projects/demo/review/rel_01PROPOSED', { health: LOCAL_HEALTH, role: 'owner' });
    expect(await screen.findByRole('button', { name: /Annehmen/ })).toBeDefined();
    expect(screen.queryByTestId('read-only-review')).toBeNull();
  });
});

describe('errorMessage', () => {
  it('turns a demo-readonly refusal into a German sentence, never a raw error', () => {
    const error = new ApiError(
      {
        type: 'urn:analyzr:problem:demo-readonly',
        title: 'Read-only demo',
        status: 403,
        code: 'demo-readonly',
        detail: 'this analyzr is a read-only demo',
      },
      403,
    );
    expect(errorMessage(error)).toBe(DEMO_READONLY_MESSAGE);
    expect(DEMO_READONLY_MESSAGE).toBe('Das ist eine Demo: Hier kannst du nichts ändern.');
  });
});

import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from '../src/app';
import { healthQuery, projectQuery, projectsQuery } from '../src/lib/queries';
import { createAppRouter } from '../src/router';

async function render(path: string, queryClient = new QueryClient()) {
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return renderToString(<App queryClient={queryClient} router={router} />);
}

describe('web app', () => {
  it('renders the projects page in the shell, with no server line while all is well', async () => {
    const html = await render('/');
    expect(html).toContain('Projekte');
    // UX1: the server's state shows only as a banner when something is wrong.
    expect(html).not.toContain('Server wird geprüft');
    expect(html).not.toContain('data-testid="server-status"');
  });

  it('shows server health and projects from the query cache', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(healthQuery.queryKey, {
      status: 'ok',
      version: '0.1.0-test',
      db: 'ok',
    });
    queryClient.setQueryData(projectsQuery.queryKey, [
      {
        id: 'prj_01TEST',
        key: 'nordwind-handel',
        name: 'Nordwind Handel',
        role: 'owner',
        lastSeq: 42,
        createdAt: '2026-10-07T09:00:00.000Z',
      },
    ]);
    const html = await render('/', queryClient);
    // The version sits in the logo's tooltip; no „Server verbunden“, no „Stand s42“ (UX1).
    expect(html).toContain('title="analyzr 0.1.0-test"');
    expect(html).not.toContain('Server verbunden');
    expect(html).not.toContain('s42');
    expect(html).toContain('Nordwind Handel');
    expect(html).toContain('href="/projects/nordwind-handel"');
    // Every role is „Inhaber“ (local mode): the column „Rolle“ hides.
    expect(html).not.toContain('Inhaber');
    expect(html).not.toContain('>Rolle<');
  });

  it('keeps „Rolle“ while any role is not „Inhaber“', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(healthQuery.queryKey, { status: 'ok', version: '1', db: 'ok' });
    queryClient.setQueryData(projectsQuery.queryKey, [
      {
        id: 'prj_01A',
        key: 'a',
        name: 'A',
        role: 'owner',
        lastSeq: 1,
        createdAt: '2026-10-07T09:00:00.000Z',
      },
      {
        id: 'prj_01B',
        key: 'b',
        name: 'B',
        role: 'editor',
        lastSeq: 1,
        createdAt: '2026-10-07T09:00:00.000Z',
      },
    ]);
    const html = await render('/', queryClient);
    expect(html).toContain('>Rolle<');
    expect(html).toContain('Bearbeiter');
  });

  it('shows the server banner while the server or its database is unreachable', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(healthQuery.queryKey, {
      status: 'degraded',
      version: '1',
      db: 'down',
    });
    const html = await render('/', queryClient);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Datenbank nicht erreichbar');
  });

  it('offers an empty state with exactly two actions when there is no project', async () => {
    const queryClient = new QueryClient();
    // Creating and seeding show once the server's mode is known (never on the read-only demo).
    queryClient.setQueryData(healthQuery.queryKey, { status: 'ok', version: '2', db: 'ok' });
    queryClient.setQueryData(projectsQuery.queryKey, []);
    const html = await render('/', queryClient);
    expect(html).toContain('Noch kein Projekt');
    expect(html).toContain('Neues Projekt');
    expect(html).toContain('Seed-Befehl kopieren');
  });

  it('routes project tabs and the model view', async () => {
    // The write tabs show once the role is known (owners here).
    const owner = new QueryClient();
    owner.setQueryData(projectQuery('demo').queryKey, {
      id: 'prj_01TEST',
      key: 'demo',
      name: 'Demo',
      role: 'owner',
      lastSeq: 1,
      createdAt: '2026-10-07T09:00:00.000Z',
    });
    const tabs = await render('/projects/demo/relations', owner);
    // Four object tabs (owner decision 26); „Relationen“ covers /review and /relations.
    for (const tab of ['Übersicht', 'Relationen', 'Wertschöpfungskette', 'Offene Fragen'])
      expect(tabs).toContain(`>${tab}<`);
    expect(tabs.match(/<a[^>]*href="\/projects\/demo\/review"[^>]*>/)?.[0]).toContain(
      'data-status="active"',
    );
    expect(tabs).not.toContain('>Befunde<');
    expect(tabs).toContain('aria-label="Hochladen"');
    // „Agent verbinden“ and „Annahmeregeln“ sit in the closed menu „Einstellungen“.
    expect(tabs).toContain('aria-label="Einstellungen"');
    expect(tabs).not.toContain('Agent verbinden');
    const view = await render('/projects/demo/models/vertrieb/auftragsabwicklung?relation=rel_1');
    expect(view).toContain('vertrieb/auftragsabwicklung');
    expect(view).toContain('data-testid="model-view"');
  });

  it('routes the review inbox and the review screen of a relation (the reviewUrl)', async () => {
    const inbox = await render('/projects/demo/review?view=held&tier=key');
    expect(inbox).toContain('>Relationen<');
    expect(inbox).toContain('href="/projects/demo/review"');
    const screen = await render('/projects/demo/review/rel_01ABCDEFGHJKMNPQRSTVWXYZ01?tier=key');
    expect(screen).toContain('data-testid="review-screen"');
    expect(screen).toContain('Zu prüfen');
  });

  it('routes the value chain page (the placement reviewUrl) and the step drill-down', async () => {
    const page = await render('/projects/demo/value-chain?placement=plc_01ABC');
    expect(page).toContain('data-testid="value-chain-page"');
    expect(page).toContain('href="/projects/demo/review"');
    const stepView = await render('/projects/demo/value-chain/steps/step-vertrieb');
    // the drill-down lives in the project layout, its tab marked by prefix
    expect(stepView).toContain('Projektbereiche');
    expect(stepView).toContain('href="/projects/demo/value-chain"');
    expect(stepView).not.toContain('Seite nicht gefunden');
  });

  it('routes „Annahmeregeln“ for owners through „Einstellungen“ (owner decisions 19, 26)', async () => {
    const project = (role: 'owner' | 'editor') => ({
      id: 'prj_01TEST',
      key: 'demo',
      name: 'Demo',
      role,
      lastSeq: 1,
      createdAt: '2026-10-07T09:00:00.000Z',
    });
    const owner = new QueryClient();
    owner.setQueryData(projectQuery('demo').queryKey, project('owner'));
    const html = await render('/projects/demo/rules', owner);
    // No tab is active there: the crumb names the page.
    expect(html).toContain('>Annahmeregeln<');
    expect(html).toContain('aria-label="Einstellungen"');
    expect(html).not.toContain('Seite nicht gefunden');
    const reviewer = new QueryClient();
    reviewer.setQueryData(projectQuery('demo').queryKey, project('editor'));
    const editor = await render('/projects/demo/relations', reviewer);
    expect(editor).not.toContain('aria-label="Einstellungen"');
    expect(editor).not.toContain('href="/projects/demo/rules"');
    expect(editor).toContain('aria-label="Hochladen"');
  });

  it('routes the tab „Offene Fragen“ for every role, its filters in the URL (M6 S4)', async () => {
    const viewer = new QueryClient();
    viewer.setQueryData(projectQuery('demo').queryKey, {
      id: 'prj_01TEST',
      key: 'demo',
      name: 'Demo',
      role: 'viewer',
      lastSeq: 1,
      createdAt: '2026-10-07T09:00:00.000Z',
    });
    const html = await render('/projects/demo/open-questions?kind=held&model=finanzen', viewer);
    expect(html).toContain('href="/projects/demo/open-questions"');
    expect(html).toContain('>Offene Fragen<');
    expect(html).not.toContain('Seite nicht gefunden');
  });

  it('answers unknown paths with a German not-found page', async () => {
    const html = await render('/gibt-es-nicht');
    expect(html).toContain('Seite nicht gefunden');
  });
});

/**
 * S2a's web parts in the views (UX8, UX-SIMPLIFICATION.md §6): the project's
 * subtitle when every model comes from one system, the derived chip in the
 * models table (never a column), and the model view's derived chip,
 * „Herkunft“ (an amended head through its upstream; the place in the tool
 * and its link from the newest import, M6 S2b follow-up step 5) and its line
 * about elements lost on import.
 */
import type { Landscape, Model, Project, Revision } from '@analyzr/client';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { App } from '../src/app';
import { healthQuery, landscapeQuery, modelsQuery, projectQuery } from '../src/lib/queries';
import { createAppRouter } from '../src/router';
import { model, openQuestion, openQuestionPage } from './support/fixtures';
import { json, stubApi } from './support/render';

const PROJECT: Project = {
  id: 'prj_01DEMO',
  key: 'demo',
  name: 'Demo',
  role: 'owner',
  lastSeq: 9,
  createdAt: '2026-10-07T09:00:00.000Z',
};
const SIGNAVIO = { system: 'signavio', exportedAt: '2026-10-14T00:00:00Z' };
const LINK = 'https://editor.signavio.com/p/hub/model/sid-B';
const models: Model[] = [
  model({
    key: 'finanzen/bonitaet',
    source: { ...SIGNAVIO, derived: 'converted' },
    // as the import that stored the uploaded revision declared it
    identity: {
      system: 'signavio',
      externalId: 'sid-B',
      externalPath: 'Finanzen/Bonitätsprüfung',
      url: LINK,
    },
  }),
  model({ key: 'vertrieb/auftrag', source: { ...SIGNAVIO, derived: 'export' } }),
];
const HASH = 'a'.repeat(64);
const revisions: Revision[] = [
  {
    id: 'rev_FINANZENBONITAET',
    modelId: 'mdl_FINANZENBONITAET',
    rev: 2,
    contentHash: HASH,
    factsHash: HASH,
    factsVersion: '1',
    engine: null,
    source: {
      kind: 'amendment',
      uploader: 'human',
      upstream: { revisionId: 'rev_UPLOADED', rev: 1, contentHash: HASH },
    },
    seq: 8,
    createdAt: '2026-10-15T09:00:00.000Z',
  },
  {
    id: 'rev_UPLOADED',
    modelId: 'mdl_FINANZENBONITAET',
    rev: 1,
    contentHash: HASH,
    factsHash: HASH,
    factsVersion: '1',
    engine: null,
    source: {
      kind: 'import',
      path: 'finanzen/bonitaet.bpmn',
      uploader: 'human',
      system: 'signavio',
      systemVersion: '19.6.0',
      exportedAt: '2026-10-14T00:00:00Z',
      externalPath: 'Finanzen/Bonitätsprüfung',
      url: 'https://editor.signavio.com/p/hub/model/sid-B',
      derived: { kind: 'converted', converter: 'normalize-bpmn 0.1.0' },
      losses: [{ code: 'element-dropped', count: 2 }],
      trust: { class: 'derived', reasons: ['no-engine', 'converted'] },
    },
    seq: 7,
    createdAt: '2026-10-15T08:00:00.000Z',
  },
];
const loss = openQuestion({
  id: 'q-00000000000000c1',
  kind: 'extractor-loss',
  source: 'signal',
  subject: { type: 'model', id: 'finanzen/bonitaet' },
  subjectLabel: '„Bonitätsprüfung“',
  modelKeys: ['finanzen/bonitaet'],
  text: 'Welche Elemente von „Bonitätsprüfung“ sind beim Import verloren gegangen?',
  detail:
    'analyzr hat 2 Elemente übersprungen: ungültige ID „Aufgabe_Bonität_prüfen“; ungültige ID „4711“. …',
  actions: [{ type: 'note', primary: false, label: 'Notiz hinzufügen' }],
});

/** The app at `path`; the model's revisions are answered once `revisionsAnswered` resolves. */
function setup(path: string, list = models, revisionsAnswered: Promise<void> = Promise.resolve()) {
  const landscape: Landscape = {
    projectId: 'prj_01DEMO',
    seq: 9,
    models: [],
    relations: [],
    findings: [],
  };
  const calls = stubApi({
    'GET /api/v1/projects/demo': () => json(PROJECT),
    'GET /api/v1/projects/demo/models': () => json({ items: list, nextCursor: null }),
    'GET /api/v1/projects/demo/landscape': () => json(landscape),
    'GET /api/v1/projects/demo/open-questions': (call) =>
      json(openQuestionPage([loss], call.search)),
    'GET /api/v1/projects/demo/models/mdl_FINANZENBONITAET/revisions': async () => {
      await revisionsAnswered;
      return json({ items: revisions, nextCursor: null });
    },
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(healthQuery.queryKey, { status: 'ok', version: '0.1.0', db: 'ok' });
  queryClient.setQueryData(projectQuery('demo').queryKey, PROJECT);
  queryClient.setQueryData(landscapeQuery('demo').queryKey, landscape);
  queryClient.setQueryData(modelsQuery('demo').queryKey, list);
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<App queryClient={queryClient} router={router} />);
  return { calls, user: userEvent.setup() };
}

describe('provenance on „Übersicht“ (UX8)', () => {
  it('names the one source system under the key, and marks a converted model, never in a column', async () => {
    setup('/projects/demo');
    expect((await screen.findByTestId('project-source')).textContent).toBe(
      'Aus Signavio · exportiert am 14.10.2026',
    );
    const rows = await screen.findAllByTestId('model-row');
    const [converted, exported] = rows;
    expect(within(converted!).getByTestId('model-derived').textContent).toBe('Konvertiert');
    expect(within(exported!).queryByTestId('model-derived')).toBeNull();
    const table = screen.getByRole('table', { name: 'Modelle' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Name', 'Phase', 'Offene Punkte', 'Aktualisiert']);
  });

  it('says nothing when the models come from more than one system or from none', async () => {
    setup('/projects/demo', [models[0]!, model({ key: 'x/hochgeladen' })]);
    await screen.findAllByTestId('model-row');
    expect(screen.queryByTestId('project-source')).toBeNull();
  });
});

describe('provenance in the model view (UX8)', () => {
  it('shows the derived chip, the import loss with its question, and „Herkunft“ through upstream', async () => {
    const { calls, user } = setup('/projects/demo/models/finanzen/bonitaet');
    const view = await screen.findByTestId('model-view');
    expect((await within(view).findByTestId('model-derived')).textContent).toBe('Konvertiert');
    const line = await within(view).findByTestId('model-import-loss');
    expect(line.textContent).toBe('Beim Import übersprungen: 2 Elemente – Details');
    // „Details“ shows the question's card in the panel
    const card = await screen.findByTestId('open-question');
    expect(card.dataset['questionId']).toBe(loss.id);
    await user.click(within(line).getByRole('button', { name: 'Details' }));
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('data-question-id')).toBe(loss.id),
    );

    // „Herkunft“ in „Mehr“ (UX3), from the newest revisions the header reads (one request)
    await user.click(await within(view).findByTestId('model-more', {}, { timeout: 10_000 }));
    await user.click(await screen.findByRole('menuitem', { name: 'Herkunft …' }));
    const panel = await screen.findByTestId('model-provenance');
    await waitFor(() => expect(within(panel).getAllByTestId('provenance-line')).toHaveLength(6));
    expect(
      within(panel)
        .getAllByTestId('provenance-line')
        .map((l) => l.textContent),
    ).toEqual([
      'StandIn analyzr ergänzt (aus r1)',
      'QuelleAus Signavio 19.6.0 · exportiert am 14.10.2026 (angegeben)',
      'Im QuellsystemFinanzen/Bonitätsprüfung',
      'EntstandenKonvertiert · mit normalize-bpmn 0.1.0',
      'Hochgeladenüber den Owner-Zugang',
      // M6 S2c, the trust rule: the uploaded revision is derived
      'Aufrufenur als Vorschlag (ohne Camunda-Engine; als konvertiert angegeben)',
    ]);
    expect(within(panel).getByTestId('provenance-losses').textContent).toContain(
      'Elemente weggelassen: 2',
    );
    const link = within(panel).getByTestId('provenance-tool-link');
    expect(link.textContent).toBe('In Signavio öffnen');
    expect(link.getAttribute('href')).toBe(LINK);
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    // „In Signavio öffnen“ is also a direct entry of „Mehr“ (§6)
    await user.keyboard('{Escape}');
    await user.click(within(view).getByTestId('model-more'));
    expect(
      (await screen.findByRole('menuitem', { name: 'In Signavio öffnen' })).getAttribute('href'),
    ).toBe(LINK);
    expect(calls.filter((c) => c.path.endsWith('/revisions'))).toHaveLength(1);
  });

  it('reads the place in the tool and its link from the newest import, the link before the revisions (M6 S2b follow-up step 5)', async () => {
    // the customer moved the model in Signavio and re-exported the same bytes
    const moved: Model = {
      ...models[0]!,
      identity: {
        system: 'signavio',
        externalId: 'sid-B',
        externalPath: 'Verschoben/Finanzen/Bonitätsprüfung',
        url: `${LINK}-neu`,
      },
    };
    let answer = () => {};
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const { calls, user } = setup(
      '/projects/demo/models/finanzen/bonitaet',
      [moved, models[1]!],
      answered,
    );
    const view = await screen.findByTestId('model-view');
    await user.click(await within(view).findByTestId('model-more', {}, { timeout: 10_000 }));
    await waitFor(() => expect(calls.filter((c) => c.path.endsWith('/revisions'))).toHaveLength(1));
    // the revisions are still on their way: the link is the model's own
    expect(
      (await screen.findByRole('menuitem', { name: 'In Signavio öffnen' })).getAttribute('href'),
    ).toBe(`${LINK}-neu`);
    answer();
    await user.click(screen.getByRole('menuitem', { name: 'Herkunft …' }));
    const panel = await screen.findByTestId('model-provenance');
    await waitFor(() => expect(within(panel).getAllByTestId('provenance-line')).toHaveLength(6));
    // „Quelle“ stays the uploaded revision's: the bytes are the ones exported on 14.10.
    expect(
      within(panel)
        .getAllByTestId('provenance-line')
        .slice(1, 3)
        .map((l) => l.textContent),
    ).toEqual([
      'QuelleAus Signavio 19.6.0 · exportiert am 14.10.2026 (angegeben)',
      'Im QuellsystemVerschoben/Finanzen/Bonitätsprüfung',
    ]);
    expect(within(panel).getByTestId('provenance-tool-link').getAttribute('href')).toBe(
      `${LINK}-neu`,
    );
  });
});

/**
 * The tab „Offene Fragen“ and the model view's section (M6 S4, §4.4; notes
 * and the sheet since S5c-1, §4.8 b; the actions in
 * `open-question-actions.test.tsx`): the
 * tab after „Befunde“ with its count, the items in the server's order with
 * their texts (human and agent texts as plain text), contact hints, raisers
 * and links, the filters in the URL, the export through the export route
 * (byte for byte, under the server's file name), the empty states, every
 * role (read permission), and the section in the model view.
 */
import type { Health, Landscape, Model, OpenQuestion, Project } from '@analyzr/client';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { App } from '../src/app';
import {
  healthQuery,
  landscapeQuery,
  modelsQuery,
  projectQuery,
  projectsQuery,
} from '../src/lib/queries';
import { createAppRouter } from '../src/router';
import { model, openQuestion, openQuestionAnswer } from './support/fixtures';
import { findToast, json, stubApi, type Call } from './support/render';

const BASE = '/api/v1/projects/demo/open-questions';
const LOCAL: Health = { status: 'ok', version: '0.1.0-test', db: 'ok' };
const DEMO: Health = { ...LOCAL, demo: 'readonly' };

const HOSTILE = 'Gilt das auch für Teillieferungen? <img src=x onerror="alert(1)"> <b>fett</b>';

/** The actions the server computes (M6 §4.8 a, S5c-1), as the fixtures need them. */
type Action = OpenQuestion['actions'][number];
const NOTE: Action = { type: 'note', primary: false, label: 'Notiz hinzufügen' };
const OUTSIDE = (primary: boolean): Action => ({
  type: 'outside',
  primary,
  label: 'Liegt außerhalb der Landschaft',
});
const decide = (decides: NonNullable<Action['decides']>): Action => ({
  type: 'decide',
  primary: true,
  label: 'Entscheiden',
  decides,
});

/** The server's order: `unlocks` descending. */
const items: OpenQuestion[] = [
  openQuestion({
    id: 'q-00000000000000a1',
    kind: 'held',
    source: 'hold',
    subject: { type: 'relation', id: 'rel_01HELD' },
    subjectLabel: '„Rechnung senden“ → „Rechnung empfangen“',
    modelKeys: ['a/order', 'b/billing'],
    text: 'Wer verschickt die Rechnung bei Teillieferungen?',
    context: 'Laut Handbuch der Vertrieb, laut Lane die Buchhaltung.',
    label: 'mit Fachbereich Finanzen klären',
    askWho: { lanes: ['Vertrieb'], stepOwners: ['Finanzen'], folder: 'a' },
    unlocks: 5,
    refs: ['a/order#Send_Invoice', 'b/billing#Catch_Invoice'],
    raisedBy: { sourceKind: 'human', handle: 'owner', seq: 12 },
    actions: [decide([{ type: 'relation', id: 'rel_01HELD', version: 1 }]), NOTE],
  }),
  openQuestion({
    id: 'q-00000000000000a2',
    kind: 'agent-question',
    source: 'agent-question',
    subject: { type: 'relation', id: 'rel_01ASKED' },
    subjectLabel: '„Ware versandbereit“ → „Versand starten“',
    modelKeys: ['a/order', 'c/shipping'],
    text: HOSTILE,
    askWho: { lanes: [], stepOwners: [], folder: 'a' },
    unlocks: 3,
    refs: ['a/order#Event_Ready', 'c/shipping#Start_Ship'],
    raisedBy: { sourceKind: 'agent', handle: 'agent:sim', seq: 10 },
    actions: [decide([{ type: 'relation', id: 'rel_01ASKED', version: 1 }]), NOTE],
  }),
  openQuestion({
    id: 'q-00000000000000a3',
    kind: 'call-target-unknown',
    unlocks: 2,
    actions: [
      { type: 'link', primary: true, label: 'Verknüpfen mit …', pick: 'process', suggested: [] },
      OUTSIDE(false),
      NOTE,
    ],
  }),
  openQuestion({
    id: 'q-00000000000000a4',
    kind: 'step-without-process',
    source: 'value-chain-finding',
    subject: { type: 'step', id: 'step-einkauf' },
    subjectLabel: '„Einkauf“',
    modelKeys: [],
    text: 'Welche Prozesse gehören zu „Einkauf“? Kein Prozess angenommen.',
    askWho: { lanes: [], stepOwners: ['Einkauf'], folder: null },
    refs: [],
    raisedBy: { sourceKind: 'rule', handle: null, seq: 8 },
    actions: [
      { type: 'place', primary: true, label: 'Prozess zuordnen …', pick: 'process' },
      OUTSIDE(false),
      NOTE,
    ],
  }),
  openQuestion({
    id: 'q-00000000000000a5',
    kind: 'black-box-partner',
    source: 'signal',
    subject: { type: 'ref', id: 'c/shipping#Participant_Carrier' },
    subjectLabel: 'Pool „Participant_Carrier“',
    modelKeys: ['c/shipping'],
    text: 'Ist „Participant_Carrier“ ein externer Partner, oder fehlt sein Modell?',
    askWho: { lanes: [], stepOwners: [], folder: 'c' },
    refs: ['c/shipping#Participant_Carrier'],
    actions: [
      OUTSIDE(true),
      { type: 'link', primary: false, label: 'Verknüpfen mit …', pick: 'process', suggested: [] },
      NOTE,
    ],
  }),
  openQuestion({
    id: 'q-00000000000000a6',
    kind: 'summary-note',
    source: 'summary',
    subject: { type: 'model', id: 'a/order' },
    subjectLabel: '„Auftrag“',
    modelKeys: ['a/order'],
    text: 'Zwei Nachrichten ohne Gegenstück; vermutlich fehlt das Lagermodell.',
    askWho: { lanes: [], stepOwners: [], folder: 'a' },
    refs: [],
    raisedBy: { sourceKind: 'agent', handle: 'agent:sim', seq: 10 },
  }),
];

const models: Model[] = [
  model({ key: 'a/order' }),
  model({ key: 'b/billing' }),
  model({ key: 'c/shipping' }),
];

function project(role: Project['role']): Project {
  return {
    id: 'prj_01DEMO',
    key: 'demo',
    name: 'Demo',
    role,
    lastSeq: 12,
    createdAt: '2026-10-07T09:00:00.000Z',
  };
}

/** The list route answers both the tab's count (`limit=1`) and the full list. */
function listRoute(list: readonly OpenQuestion[]) {
  return (call: Call) => {
    const query = new URLSearchParams(call.search);
    const modelKey = query.get('modelKey');
    const matching = list.filter(
      (q) =>
        (modelKey === null ||
          q.modelKeys.some((k) => k === modelKey || k.startsWith(`${modelKey}/`))) &&
        (query.get('state') === null || q.state === query.get('state')),
    );
    const limit = Number(query.get('limit') ?? '50');
    return json({ items: matching.slice(0, limit), nextCursor: null, total: matching.length });
  };
}

function setup(
  path: string,
  {
    list = items,
    role = 'owner',
    health = LOCAL,
    routes = {},
  }: {
    list?: readonly OpenQuestion[];
    role?: Project['role'];
    health?: Health;
    routes?: Parameters<typeof stubApi>[0];
  } = {},
) {
  const landscape: Landscape = {
    projectId: 'prj_01DEMO',
    seq: 12,
    models: [],
    relations: [],
    findings: [],
  };
  // A write refreshes the whole project (`keys.project`): its reads answer again.
  const calls = stubApi({
    'GET /api/v1/projects': () => json({ items: [project(role)], nextCursor: null }),
    'GET /api/v1/projects/demo': () => json(project(role)),
    'GET /api/v1/projects/demo/models': () => json({ items: models, nextCursor: null }),
    'GET /api/v1/projects/demo/landscape': () => json(landscape),
    [`GET ${BASE}`]: listRoute(list),
    ...routes,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(healthQuery.queryKey, health);
  queryClient.setQueryData(projectsQuery.queryKey, [project(role)]);
  queryClient.setQueryData(projectQuery('demo').queryKey, project(role));
  queryClient.setQueryData(landscapeQuery('demo').queryKey, landscape);
  queryClient.setQueryData(modelsQuery('demo').queryKey, models);
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<App queryClient={queryClient} router={router} />);
  return { calls, router, user: userEvent.setup() };
}

const rows = () => screen.findAllByTestId('open-question');
const ids = async () => (await rows()).map((r) => r.dataset['questionId']?.slice(-2));

describe('tab „Offene Fragen“', () => {
  it('follows „Befunde“ with the count of open questions', async () => {
    const { calls } = setup('/projects/demo');
    const nav = await screen.findByRole('navigation', { name: 'Projektbereiche' });
    const links = within(nav).getAllByRole('link');
    const names = links.map((l) => l.textContent.replace(/\d+.*/, '').trim());
    expect(names.indexOf('Offene Fragen')).toBe(names.indexOf('Befunde') + 1);
    const tab = within(nav).getByRole('link', { name: /Offene Fragen/ });
    expect(tab.getAttribute('href')).toBe('/projects/demo/open-questions');
    await waitFor(() => expect(tab.textContent).toBe('Offene Fragen6 offen'));
    // the count asks for one open item and reads `total`
    const count = calls.find((c) => c.path === BASE);
    expect(new URLSearchParams(count?.search).get('limit')).toBe('1');
    expect(new URLSearchParams(count?.search).get('state')).toBe('open');
  });

  it('lists every question in the server order with kind, subject, ranking and id', async () => {
    setup('/projects/demo/open-questions');
    expect(await ids()).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
    const [first, , third, , pool, summary] = await rows();
    expect(first!.textContent).toContain('Vorgemerkt');
    // the source only where the badge and the verbatim intro leave it unsaid
    expect(within(first!).queryByTestId('question-source')).toBeNull();
    expect(within(summary!).queryByTestId('question-source')).toBeNull();
    expect(within(third!).getByTestId('question-source').textContent).toBe('Befund');
    expect(within(pool!).getByTestId('question-source').textContent).toBe('Lückensignal');
    expect(first!.textContent).toContain('„Rechnung senden“ → „Rechnung empfangen“');
    expect(within(first!).getByTestId('question-unlocks').textContent).toBe(
      '5 offene Entscheidungen',
    );
    expect(first!.textContent).toContain('q-00000000000000a1');
    expect(within(third!).getByTestId('question-text').textContent).toBe(items[2]!.text);
    expect(third!.textContent).toContain('Erkannt vonanalyzrs3');
    // informational items rank last and say so
    expect(within(summary!).getByTestId('question-unlocks').textContent).toBe('Zur Information');
    expect(screen.getByTestId('open-questions-count').textContent).toBe(
      '6 Fragen, geordnet nach offenen Entscheidungen',
    );
    // a screen reader hears the count change with the filters
    expect(screen.getByTestId('open-questions-count').getAttribute('aria-live')).toBe('polite');
  });

  it('says when an item touches no open decision, and names the subject of each link', async () => {
    setup('/projects/demo/open-questions', {
      list: [openQuestion({ id: 'q-00000000000000b1', kind: 'isolated-process', unlocks: 0 })],
    });
    const [row] = await rows();
    expect(within(row!).getByTestId('question-unlocks').textContent).toBe(
      'Keine offene Entscheidung',
    );
    const link = within(row!).getByTestId('question-link');
    const subject = document.getElementById(link.getAttribute('aria-describedby') ?? '');
    expect(subject?.textContent).toBe('„Zahlung abwickeln“');
  });

  it('shows human and agent texts verbatim as plain text, with who said them', async () => {
    setup('/projects/demo/open-questions');
    const [held, asked, , , , summary] = await rows();
    const hold = within(held!).getByTestId('question-verbatim');
    expect(hold.textContent).toContain('Vorgemerkt vonowner');
    expect(within(hold).getByTestId('question-text').textContent).toBe(items[0]!.text);
    expect(within(hold).getByTestId('question-context').textContent).toBe(
      `Notiz${items[0]!.context}`,
    );
    expect(within(hold).getByTestId('question-label').textContent).toBe(
      'mit Fachbereich Finanzen klären',
    );
    // the agent's HTML stays text: no element, the characters as written
    const question = within(asked!).getByTestId('question-text');
    expect(question.textContent).toBe(HOSTILE);
    expect(question.querySelector('img, b')).toBeNull();
    expect(question.querySelector('[data-plain-text]')).not.toBeNull();
    expect(within(asked!).getByTestId('question-verbatim').textContent).toContain(
      'Frage vonagent:sim',
    );
    expect(within(summary!).getByTestId('question-verbatim').textContent).toContain(
      'Zusammenfassung vonagent:sim',
    );
    // the contact hint, as in the export
    expect(within(held!).getByTestId('question-ask-who').textContent).toBe(
      'Ansprechpartner-Hinweis:Organisationseinheit: Finanzen; Lanes: Vertrieb; Ordner: a',
    );
  });

  it('links to the review screen, the value chain page and the model view, and lists the refs', async () => {
    setup('/projects/demo/open-questions');
    const [held, , call, step, pool, summary] = await rows();
    const links = (row: HTMLElement) =>
      within(row)
        .getAllByTestId('question-link')
        .map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links(held!)).toEqual([['Prüfen', '/projects/demo/review/rel_01HELD']]);
    expect(links(step!)).toEqual([
      ['Schritt auf der Kette zeigen', '/projects/demo/value-chain?step=step-einkauf'],
    ]);
    expect(links(call!)).toEqual([
      ['Im Modell zeigen', '/projects/demo/models/a/order?element=Call_1'],
    ]);
    expect(links(pool!)).toEqual([
      ['Im Modell zeigen', '/projects/demo/models/c/shipping?element=Participant_Carrier'],
    ]);
    expect(links(summary!)).toEqual([['Modell öffnen', '/projects/demo/models/a/order']]);
    // both ends of the held relation, each into the model view
    const refs = within(held!).getByRole('list', { name: 'Bezug' });
    expect(
      within(refs)
        .getAllByRole('link')
        .map((a) => a.getAttribute('href')),
    ).toEqual([
      '/projects/demo/models/a/order?element=Send_Invoice',
      '/projects/demo/models/b/billing?element=Catch_Invoice',
    ]);
    expect(within(call!).queryByRole('list', { name: 'Bezug' })).toBeNull();
  });

  it('filters by kind, model or folder, contact hint and source in the URL, and resets', async () => {
    const { router, user } = setup('/projects/demo/open-questions');
    await rows();
    const kind = screen.getByLabelText('Art');
    expect(
      within(kind)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([
      'Alle Arten',
      'Vorgemerkt (1)',
      'Frage eines Agenten (1)',
      'Aufrufziel unbekannt (1)',
      'Schritt ohne Prozess (1)',
      'Pool ohne Prozess (1)',
      'Zusammenfassung eines Agenten (1)',
    ]);
    await user.selectOptions(kind, 'black-box-partner');
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ kind: 'black-box-partner' }),
    );
    expect(await ids()).toEqual(['a5']);
    expect(screen.getByTestId('open-questions-count').textContent).toBe(
      '1 von 6 Fragen, geordnet nach offenen Entscheidungen',
    );
    await user.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    // the button leaves with the filters; the focus stays in the filters
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Art')));

    // only steps match: the model select has no empty „Modelle“ group
    await user.selectOptions(screen.getByLabelText('Art'), 'step-without-process');
    expect(await ids()).toEqual(['a4']);
    expect(
      within(screen.getByLabelText('Modell oder Ordner'))
        .queryAllByRole('group')
        .map((g) => g.getAttribute('label')),
    ).toEqual([]);
    await user.selectOptions(screen.getByLabelText('Art'), '');

    // a folder matches every model below it
    const modelSelect = screen.getByLabelText('Modell oder Ordner');
    await user.selectOptions(modelSelect, 'a');
    expect(await ids()).toEqual(['a1', 'a2', 'a3', 'a6']);
    await user.selectOptions(modelSelect, 'b/billing');
    expect(await ids()).toEqual(['a1']);
    await user.selectOptions(modelSelect, '');

    const askWho = screen.getByLabelText('Ansprechpartner-Hinweis');
    expect(
      within(askWho)
        .getAllByRole('group')
        .map((g) => g.getAttribute('label')),
    ).toEqual(['Organisationseinheiten', 'Lanes', 'Ordner']);
    await user.selectOptions(askWho, 'Einkauf');
    expect(await ids()).toEqual(['a4']);
    await user.selectOptions(askWho, '');

    await user.selectOptions(screen.getByLabelText('Quelle'), 'signal');
    expect(await ids()).toEqual(['a5']);
    expect(router.state.location.search).toEqual({ source: 'signal' });
  });

  it('reads its filters from the URL and says when none matches', async () => {
    const { user } = setup('/projects/demo/open-questions?state=answered&kind=nope');
    const empty = await screen.findByTestId('open-questions-empty');
    expect(empty.textContent).toContain('Keine Frage passt zu den Filtern');
    expect(screen.queryAllByTestId('open-question')).toEqual([]);
    // an unknown kind is no filter; the state option without items stays selectable
    expect(screen.getByLabelText<HTMLSelectElement>('Art').value).toBe('');
    expect(screen.getByLabelText<HTMLSelectElement>('Status').value).toBe('answered');
    await user.click(within(empty).getByRole('button', { name: 'Filter zurücksetzen' }));
    expect(await ids()).toHaveLength(6);
  });

  it('says so when there is no open question', async () => {
    setup('/projects/demo/open-questions', { list: [] });
    const empty = await screen.findByTestId('open-questions-empty');
    expect(empty.textContent).toContain('Keine offenen Fragen');
    expect(screen.queryByRole('search')).toBeNull();
  });

  it('shows 50 at first and more on request', async () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      openQuestion({ id: `q-${(i + 1).toString(16).padStart(16, '0')}`, unlocks: 200 - i }),
    );
    const { user } = setup('/projects/demo/open-questions', { list: many });
    expect(await rows()).toHaveLength(50);
    const more = screen.getByTestId('open-questions-more');
    expect(more.textContent).toBe('Weitere 50 anzeigen (70 übrig)');
    await user.click(more);
    await user.click(screen.getByTestId('open-questions-more'));
    expect(await rows()).toHaveLength(120);
    expect(screen.queryByTestId('open-questions-more')).toBeNull();
  });

  it('exports the filtered list through the export route, byte for byte under the server’s name', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:analyzr');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const csv = '\uFEFF"id";"Art";"Frage";"Ansprechpartner-Hinweis";"Antwort";"Antwortart"\r\n';
    const { calls, user } = setup('/projects/demo/open-questions?kind=held&model=a', {
      routes: {
        [`GET ${BASE}/export`]: (call) => {
          const format = new URLSearchParams(call.search).get('format');
          return new Response(format === 'csv' ? csv : '# Offene Fragen: Demo\n', {
            headers: {
              'content-type':
                format === 'csv' ? 'text/csv; charset=utf-8' : 'text/markdown; charset=utf-8',
              'content-disposition': `attachment; filename="offene-fragen-demo.${format === 'csv' ? 'csv' : 'md'}"`,
            },
          });
        },
      },
    });
    await rows();
    await user.click(screen.getByRole('button', { name: 'Als CSV exportieren' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    const exported = calls.filter((c) => c.path === `${BASE}/export`);
    expect(Object.fromEntries(new URLSearchParams(exported[0]?.search))).toEqual({
      kind: 'held',
      modelKey: 'a',
      format: 'csv',
    });
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('offene-fragen-demo.csv');
    const blob = createObjectURL.mock.calls[0]![0];
    // the byte order mark survives (Excel needs it for umlauts)
    expect([...new Uint8Array(await blob.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

    await user.click(screen.getByRole('button', { name: 'Als Markdown exportieren' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(2));
    expect((click.mock.contexts[1] as HTMLAnchorElement).download).toBe('offene-fragen-demo.md');
    expect(new URLSearchParams(calls.at(-1)?.search).get('format')).toBe('markdown');
  });

  it('reports a failed export', async () => {
    const { user } = setup('/projects/demo/open-questions', {
      routes: {
        [`GET ${BASE}/export`]: () =>
          json({ title: 'Validation failed', status: 422, code: 'validation-failed' }, 422),
      },
    });
    await rows();
    await user.click(screen.getByRole('button', { name: 'Als Markdown exportieren' }));
    expect((await findToast('Export fehlgeschlagen')).textContent).toContain('Validation failed');
  });

  it('is every role’s: a viewer on the read-only demo reads and exports without writing', async () => {
    const createObjectURL = vi.fn(() => 'blob:analyzr');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const { calls, user } = setup('/projects/demo/open-questions', {
      role: 'viewer',
      health: DEMO,
      routes: { [`GET ${BASE}/export`]: () => new Response('# Offene Fragen\n') },
    });
    expect(await rows()).toHaveLength(6);
    await user.click(screen.getByRole('button', { name: 'Als Markdown exportieren' }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(calls.filter((c) => c.method !== 'GET' && c.path !== '/api/v1/session')).toEqual([]);
  });
});

describe('model view section „Offene Fragen“', () => {
  it('lists the questions of exactly this model, compact, with a link to the tab', async () => {
    const child = openQuestion({
      id: 'q-00000000000000b1',
      modelKeys: ['a/order/sub'],
      subject: { type: 'ref', id: 'a/order/sub#Call_9' },
    });
    const { calls } = setup('/projects/demo/models/a/order', { list: [...items, child] });
    const section = await screen.findByTestId('model-open-questions');
    await waitFor(() =>
      expect(
        within(section)
          .getAllByTestId('open-question')
          .map((r) => r.dataset['questionId']),
      ).toEqual([
        'q-00000000000000a1',
        'q-00000000000000a2',
        'q-00000000000000a3',
        'q-00000000000000a6',
      ]),
    );
    expect(within(section).getByRole('heading', { name: 'Offene Fragen (4)' })).toBeDefined();
    expect(
      within(section)
        .getByRole('link', { name: /Im Tab zeigen/ })
        .getAttribute('href'),
    ).toBe('/projects/demo/open-questions?model=a%2Forder');
    const request = calls.find((c) => c.path === BASE && c.search.includes('modelKey'));
    expect(new URLSearchParams(request?.search).get('modelKey')).toBe('a/order');
    // compact: no refs list, no link back to the model in view without an element
    const rows = within(section).getAllByTestId('open-question');
    expect(within(rows[0]!).queryByRole('list', { name: 'Bezug' })).toBeNull();
    expect(within(rows[3]!).queryAllByTestId('question-link')).toEqual([]);
    expect(
      within(rows[2]!)
        .getAllByTestId('question-link')
        .map((a) => a.getAttribute('href')),
    ).toEqual(['/projects/demo/models/a/order?element=Call_1']);
    // agent texts stay plain text here as well
    expect(within(rows[1]!).getByTestId('question-text').querySelector('img')).toBeNull();
  });

  it('says when the model has no open question', async () => {
    setup('/projects/demo/models/b/billing', { list: items.slice(2) });
    const section = await screen.findByTestId('model-open-questions');
    await waitFor(() =>
      expect(section.textContent).toContain('Zu diesem Modell ist keine Frage offen.'),
    );
    expect(within(section).getByRole('heading', { name: 'Offene Fragen (0)' })).toBeDefined();
  });
});

// ------------------------------------------------------------------ notes (M6 S5a, S5c-1)

/**
 * The sheet route over a list that changes like the server's: every filled
 * `Antwort` records a note; an S5a sheet's „Liegt außerhalb der Landschaft“
 * records the outside mark on an item that is neither a relation nor a
 * placement (it turns `answered`); an unknown id is never stored.
 */
function answerRoutes(list: OpenQuestion[]) {
  let seq = 20;
  return {
    [`GET ${BASE}`]: (call: Call) => listRoute(list)(call),
    [`POST ${BASE}/answers`]: (call: Call) => {
      const dryRun = new URLSearchParams(call.search).get('dryRun') === 'true';
      const { rows } = call.body as { rows: { id: string; text: string; kind: string }[] };
      const counts = { recorded: 0, unchanged: 0, unknown: 0, invalid: 0, ignored: 0 };
      const out = [];
      for (const [i, r] of rows.entries()) {
        if (r.text.trim() === '') {
          counts.ignored++;
          continue;
        }
        const q = list.find((x) => x.id === r.id.trim());
        const onDecision = q?.subject.type === 'relation' || q?.subject.type === 'placement';
        const kind =
          r.kind === 'Liegt außerhalb der Landschaft' && !onDecision
            ? ('outside-landscape' as const)
            : ('answer' as const);
        const warnings = r.text.includes('@')
          ? [{ kind: 'email' as const, start: 0, end: r.text.length }]
          : [];
        if (!q) {
          counts.unknown++;
          out.push({ row: i + 1, id: r.id, outcome: 'unknown' as const, warnings });
        } else if (r.kind === 'Vielleicht') {
          counts.invalid++;
          out.push({
            row: i + 1,
            id: r.id,
            outcome: 'invalid' as const,
            reason: 'unknown-kind' as const,
            warnings,
          });
        } else {
          counts.recorded++;
          const target =
            q.subject.type === 'relation' ? ('relation-note' as const) : ('answer' as const);
          out.push({ row: i + 1, id: r.id, outcome: 'recorded' as const, kind, target, warnings });
          if (!dryRun) {
            const answer = openQuestionAnswer({
              id: `oqa_${++seq}`,
              questionId: q.id,
              kind,
              role: kind === 'outside-landscape' ? 'outside-mark' : 'note',
              target,
              text: r.text.trim(),
              seq,
            });
            const at = list.indexOf(q);
            list[at] = {
              ...q,
              state: kind === 'outside-landscape' ? 'answered' : q.state,
              answers: [...q.answers, answer],
            };
          }
        }
      }
      return json({ dryRun, counts, rows: out });
    },
  } satisfies Parameters<typeof stubApi>[0];
}

/** `POST …/open-questions/{q}/answers` (a note, text only) for every item of `list` (stateful). */
function noteRoutes(list: OpenQuestion[]) {
  const routes: Parameters<typeof stubApi>[0] = {};
  let seq = 30;
  for (const q of list) {
    routes[`POST ${BASE}/${q.id}/answers`] = (call) => {
      const current = list.find((x) => x.id === q.id)!;
      const { text } = call.body as { text: string };
      const target =
        q.subject.type === 'relation'
          ? ('relation-note' as const)
          : q.subject.type === 'placement'
            ? ('placement-note' as const)
            : ('answer' as const);
      const latest = current.answers.filter((a) => a.role === 'note').at(-1);
      const same = latest?.text === text ? latest : undefined;
      const answer =
        same ??
        openQuestionAnswer({
          id: `oqa_${++seq}`,
          questionId: q.id,
          target,
          text,
          note:
            target === 'relation-note'
              ? { type: 'relation', subjectId: q.subject.id, assertionId: 'asr_01NOTE' }
              : null,
          seq,
        });
      // a note informs: the item's state stays as it was (M6 §4.8 b)
      const question: OpenQuestion = same
        ? current
        : { ...current, answers: [...current.answers, answer] };
      list[list.indexOf(current)] = question;
      return json(
        { result: same ? 'unchanged' : 'recorded', answer, question, warnings: [] },
        same ? 200 : 201,
      );
    };
  }
  return routes;
}

const dialog = () => screen.findByRole('dialog');

/** „Notiz hinzufügen“ of an item: under „Weitere Aktionen“, or the button when it is the only action. */
async function openNote(user: ReturnType<typeof userEvent.setup>, row: HTMLElement) {
  const direct = within(row)
    .queryAllByTestId('question-action')
    .find((b) => b.dataset['action'] === 'note');
  if (direct) {
    await user.click(direct);
  } else {
    await user.click(within(row).getByTestId('question-more-actions'));
    await user.click(await screen.findByRole('menuitem', { name: 'Notiz hinzufügen' }));
  }
  return dialog();
}

describe('notes (M6 S5a, S5c-1)', () => {
  it('offers the actions on every item that asks something and the CSV takeover to reviewers only', async () => {
    setup('/projects/demo/open-questions', { role: 'editor' });
    const all = await rows();
    // the primary action as the visible button, the rest under „Weitere Aktionen“
    const primaries = all.map((row) =>
      within(row)
        .queryAllByTestId('question-action')
        .filter((b) => b.dataset['primary'] === 'true')
        .map((b) => b.textContent),
    );
    expect(primaries).toEqual([
      ['Entscheiden'],
      ['Entscheiden'],
      ['Verknüpfen mit …'],
      ['Prozess zuordnen …'],
      ['Liegt außerhalb der Landschaft'],
      [],
    ]);
    // the informational summary has no action row at all; „Beantworten“ is gone
    expect(within(all[5]!).queryByTestId('question-actions')).toBeNull();
    expect(screen.queryByRole('button', { name: /Beantworten/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Antworten aus CSV übernehmen' })).toBeDefined();
    // the buttons name the item's subject for screen readers
    const button = within(all[0]!).getByTestId('question-action');
    const subject = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(subject?.textContent).toBe('„Rechnung senden“ → „Rechnung empfangen“');
  });

  it('hides every action from viewers and on the read-only demo', async () => {
    setup('/projects/demo/open-questions', { role: 'viewer' });
    expect(await rows()).toHaveLength(6);
    expect(screen.queryAllByTestId('question-actions')).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Antworten aus CSV übernehmen' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Als CSV exportieren' })).toBeDefined();
    // the links stay: reading is every role's
    expect(screen.getAllByTestId('question-link').length).toBeGreaterThan(0);
    cleanup();
    setup('/projects/demo/open-questions', { role: 'owner', health: DEMO });
    expect(await rows()).toHaveLength(6);
    expect(screen.queryAllByTestId('question-actions')).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Antworten aus CSV übernehmen' })).toBeNull();
  });

  it('adds a note to a held relation: no kinds, the hint, the agents sentence, the live warning; the item stays open', async () => {
    const list = items.map((q) => ({ ...q }));
    const { calls, user } = setup('/projects/demo/open-questions', {
      list,
      routes: { ...noteRoutes(list), [`GET ${BASE}`]: listRoute(list) },
    });
    const [held] = await rows();
    const box = await openNote(user, held!);
    expect(within(box).getByRole('heading', { name: 'Notiz hinzufügen' })).toBeDefined();
    expect(within(box).getByTestId('note-question').textContent).toContain(items[0]!.text);
    // no answer kinds any more (M6 §4.8 b)
    expect(within(box).queryAllByRole('radio')).toEqual([]);
    expect(box.textContent).not.toContain('Antwortart');
    expect(within(box).getByTestId('note-hint').textContent).toBe(
      'Keine Namen oder anderen personenbezogenen Daten.',
    );
    expect(within(box).getByTestId('note-permanent').textContent).toBe(
      'Eine gespeicherte Notiz lässt sich nicht mehr ändern oder löschen.',
    );
    const effect = within(box).getByTestId('note-effect').textContent;
    expect(effect).toContain(
      'Die Agenten berücksichtigen die Notiz, sobald das Paar neu bewertet wird.',
    );
    expect(effect).toContain('Die Notiz wird an der Relation gespeichert');
    expect(effect).toContain(
      'Die Vormerkung bleibt; die Entscheidung triffst du mit „Entscheiden“.',
    );
    const save = within(box).getByRole('button', { name: 'Notiz speichern' });
    expect(save).toHaveProperty('disabled', true);

    const field = within(box).getByLabelText('Deine Notiz');
    expect(document.activeElement).toBe(field);
    expect(field.getAttribute('maxlength')).toBe('2000');
    await user.type(field, 'Die Buchhaltung, Rückfragen an max.muster@example.com');
    const warning = within(box).getByTestId('note-personal-data');
    const status = within(warning).getByRole('status');
    expect(status.textContent).toBe(
      'Vermutlich personenbezogene DatenDer Text enthält vermutlich eine E-Mail-Adresse. Prüf bitte, ob das wirklich gespeichert werden soll: keine Namen oder anderen personenbezogenen Daten.',
    );
    expect(status.textContent).not.toContain('max.muster@example.com');
    expect(save).toHaveProperty('disabled', false);
    await user.clear(field);
    await user.type(field, '  Die Buchhaltung verschickt sie.  ');
    expect(warning.textContent).toBe('');
    await user.click(save);

    expect((await findToast('Notiz gespeichert')).textContent).toContain(
      'Gespeichert als Notiz an der Relation. Die Frage bleibt offen',
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/answers'));
    expect(post?.path).toBe(`${BASE}/q-00000000000000a1/answers`);
    // the text only: the route takes no kind since S5c-1
    expect(post?.body).toEqual({ text: 'Die Buchhaltung verschickt sie.' });

    const [noted] = await rows();
    await waitFor(() => expect(within(noted!).queryByTestId('question-answer')).not.toBeNull());
    // a note informs: the item stays open
    expect(noted!.dataset['state']).toBe('open');
    expect(within(noted!).queryByTestId('question-state')).toBeNull();
    const answer = within(noted!).getByTestId('question-answer');
    expect(answer.dataset['target']).toBe('relation-note');
    expect(answer.dataset['role']).toBe('note');
    expect(within(answer).getByTestId('question-answer-kind').textContent).toBe('Notiz');
    expect(answer.textContent).toContain('als Notiz an der Relation');
    expect(within(answer).getByTestId('question-answer-text').textContent).toBe(
      'Die Buchhaltung verschickt sie.',
    );
    // the focus goes back to the menu that opened the dialog
    await waitFor(() =>
      expect(document.activeElement).toBe(within(noted!).getByTestId('question-more-actions')),
    );
  });

  it('points at the model’s source for every other subject, and says the item stays open', async () => {
    const placement = openQuestion({
      id: 'q-00000000000000c1',
      kind: 'held',
      source: 'hold',
      subject: { type: 'placement', id: 'plc_01HELD' },
      subjectLabel: '„Zahlung“ auf „Finanzen“',
      text: 'Gehört das hierher?',
      actions: [decide([{ type: 'placement', id: 'plc_01HELD', version: 1 }]), NOTE],
    });
    const { user } = setup('/projects/demo/open-questions', { list: [...items, placement] });
    const all = await rows();
    const effect = async (row: HTMLElement) => {
      const box = await openNote(user, row);
      const text = within(box).getByTestId('note-effect').textContent;
      await user.click(within(box).getByRole('button', { name: 'Abbrechen' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      return text;
    };
    const finding = await effect(all[2]!);
    expect(finding).toContain('ergänze es im Quellwerkzeug und importiere das Modell erneut');
    expect(finding).toContain('Die Frage bleibt offen; erledigt wird sie durch ihre Aktion.');
    expect(finding).not.toContain('Die Agenten berücksichtigen');
    expect(await effect(all[3]!)).toContain('Fehlt ein Modell, importiere es.');
    // A held placement homes its process: the note makes nothing due, the hold stays.
    const plc = await effect(all[6]!);
    expect(plc).toContain('Die Notiz wird an der Platzierung gespeichert');
    expect(plc).not.toContain('fällig');
    expect(plc).toContain(
      'Die Platzierung bleibt vorgemerkt; solange bekommt kein Agent den Prozess.',
    );
  });

  it('starts every dialog afresh, says when a note was there already, and keeps the text on a refusal', async () => {
    const list = items.map((q) => ({ ...q }));
    let refuse = true;
    const routes = noteRoutes(list);
    const record = routes[`POST ${BASE}/q-00000000000000a3/answers`]!;
    const { user } = setup('/projects/demo/open-questions', {
      list,
      routes: {
        ...routes,
        [`GET ${BASE}`]: listRoute(list),
        [`POST ${BASE}/q-00000000000000a3/answers`]: (call) =>
          refuse
            ? json(
                {
                  title: 'Validation failed',
                  status: 422,
                  code: 'validation-failed',
                  detail: 'text: too long',
                },
                422,
              )
            : record(call),
      },
    });
    let box = await openNote(user, (await rows())[2]!);
    await user.type(within(box).getByLabelText('Deine Notiz'), 'Der Zahlungsdienst.');
    await user.click(within(box).getByRole('button', { name: 'Notiz speichern' }));
    expect((await within(box).findByTestId('note-error')).textContent).toContain(
      'Validation failed: text: too long',
    );
    expect(within(box).getByLabelText<HTMLTextAreaElement>('Deine Notiz').value).toBe(
      'Der Zahlungsdienst.',
    );
    refuse = false;
    await user.click(within(box).getByRole('button', { name: 'Notiz speichern' }));
    expect(await findToast('Notiz gespeichert')).toBeDefined();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // the next dialog starts empty and says the item has a note; the same note again
    // changes nothing
    box = await openNote(user, (await rows())[2]!);
    expect(within(box).getByLabelText<HTMLTextAreaElement>('Deine Notiz').value).toBe('');
    expect(within(box).getByTestId('note-before').textContent).toBe(
      'Schon eine Notiz. Deine kommt hinzu; die bisherige bleibt stehen.',
    );
    await user.type(within(box).getByLabelText('Deine Notiz'), 'Der Zahlungsdienst.');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(await findToast('Notiz schon gespeichert')).toBeDefined();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes on an id that changed meanwhile and says so', async () => {
    const { user } = setup('/projects/demo/open-questions', {
      routes: {
        [`POST ${BASE}/q-00000000000000a5/answers`]: () =>
          json({ title: 'Not Found', status: 404, code: 'not-found' }, 404),
      },
    });
    const box = await openNote(user, (await rows())[4]!);
    await user.type(within(box).getByLabelText('Deine Notiz'), 'Ein externer Spediteur.');
    await user.click(within(box).getByRole('button', { name: 'Notiz speichern' }));
    expect((await findToast('Frage gibt es so nicht mehr')).textContent).toContain(
      'Die Quelle der Frage hat sich inzwischen geändert (dann hat die Frage eine neue Kennung)',
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows notes and outside marks as plain text, and the Status filter finds the marked items', async () => {
    const marked = openQuestion({
      ...items[2]!,
      state: 'answered',
      answers: [
        openQuestionAnswer({ questionId: items[2]!.id, text: 'Erst <b>so</b>', seq: 21 }),
        // S5a's „Wird im Modell ergänzt“ shows as a note
        openQuestionAnswer({
          id: 'oqa_02',
          questionId: items[2]!.id,
          kind: 'will-be-modelled',
          text: 'Wird modelliert.',
          seq: 22,
        }),
        openQuestionAnswer({
          id: 'oqa_03',
          questionId: items[2]!.id,
          kind: 'outside-landscape',
          role: 'outside-mark',
          text: null,
          seq: 23,
          withdrawal: { by: 'owner', seq: 24, at: '2026-10-16T11:00:00.000Z' },
        }),
        openQuestionAnswer({
          id: 'oqa_04',
          questionId: items[2]!.id,
          kind: 'outside-landscape',
          role: 'outside-mark',
          text: 'Ein externer Zahlungsdienst.',
          seq: 25,
        }),
      ],
    });
    const list = items.map((q) => (q.id === marked.id ? marked : q));
    const { router, user } = setup('/projects/demo/open-questions', { list });
    const row = (await rows())[2]!;
    expect(row.dataset['state']).toBe('answered');
    expect(within(row).getByTestId('question-state').textContent).toBe('Erledigt (außerhalb)');
    const answers = within(row).getAllByTestId('question-answer');
    expect(answers.map((a) => [a.dataset['role'], a.dataset['withdrawn']])).toEqual([
      ['note', 'false'],
      ['note', 'false'],
      ['outside-mark', 'true'],
      ['outside-mark', 'false'],
    ]);
    expect(answers.map((a) => within(a).getByTestId('question-answer-kind').textContent)).toEqual([
      'Notiz',
      'Notiz',
      'Liegt außerhalb der Landschaft',
      'Liegt außerhalb der Landschaft',
    ]);
    expect(within(row).getByTestId('question-answers').textContent).toContain(
      '2 Notizen · Als außerhalb markiert',
    );
    expect(answers[0]!.querySelector('b')).toBeNull();
    expect(within(answers[0]!).getByTestId('question-answer-text').textContent).toBe(
      'Erst <b>so</b>',
    );
    expect(answers[0]!.textContent).toContain('bei der Frage');
    // a mark without a note has no text; a withdrawn one says by whom
    expect(within(answers[2]!).queryByTestId('question-answer-text')).toBeNull();
    expect(within(answers[2]!).getByTestId('question-answer-withdrawn').textContent).toContain(
      'zurückgenommen von owner',
    );
    const at = within(answers[0]!).getByTestId('question-answer-at');
    expect(at.getAttribute('datetime')).toBe('2026-10-16T10:00:00.000Z');
    expect(at.getAttribute('title')).toBe('Projektstand s21');
    // a marked item offers to take the mark back instead of marking again
    expect(within(row).getByTestId('question-withdraw-mark').textContent).toBe(
      'Markierung zurücknehmen',
    );

    const state = screen.getByLabelText('Status');
    expect(
      within(state)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Alle', 'Offen (5)', 'Erledigt (außerhalb) (1)']);
    await user.selectOptions(state, 'answered');
    await waitFor(() => expect(router.state.location.search).toEqual({ state: 'answered' }));
    expect(await ids()).toEqual(['a3']);
    await user.selectOptions(state, 'open');
    expect(await ids()).toEqual(['a1', 'a2', 'a4', 'a5', 'a6']);
  });

  it('adds a note in the model view’s section as well', async () => {
    const list = items.map((q) => ({ ...q }));
    const { calls, user } = setup('/projects/demo/models/a/order', {
      list,
      routes: { ...noteRoutes(list), [`GET ${BASE}`]: listRoute(list) },
    });
    const section = await screen.findByTestId('model-open-questions');
    await waitFor(() => expect(within(section).getAllByTestId('open-question')).toHaveLength(4));
    const call = within(section)
      .getAllByTestId('open-question')
      .find((r) => r.dataset['questionId'] === 'q-00000000000000a3')!;
    const box = await openNote(user, call);
    expect(within(box).getByTestId('note-effect').textContent).toContain('Quellwerkzeug');
    await user.type(within(box).getByLabelText('Deine Notiz'), 'Der Zahlungsdienst.');
    await user.click(within(box).getByRole('button', { name: 'Notiz speichern' }));
    expect(await findToast('Notiz gespeichert')).toBeDefined();
    expect(
      calls.some((c) => c.method === 'POST' && c.path === `${BASE}/q-00000000000000a3/answers`),
    ).toBe(true);
    await waitFor(() =>
      expect(
        within(section)
          .getAllByTestId('open-question')
          .find((r) => r.dataset['questionId'] === 'q-00000000000000a3')
          ?.querySelector('[data-testid=question-answer]'),
      ).not.toBeNull(),
    );
  });

  it('hides the actions in the model view from viewers', async () => {
    setup('/projects/demo/models/a/order', { role: 'viewer' });
    const section = await screen.findByTestId('model-open-questions');
    await waitFor(() => expect(within(section).getAllByTestId('open-question')).toHaveLength(4));
    expect(within(section).queryAllByTestId('question-actions')).toEqual([]);
  });
});

/**
 * The CSV the export writes, filled in: BOM, `;`, CRLF, every field quoted;
 * five columns (M6 S5c-1), or with S5a's `Antwortart` when a row names a kind.
 */
function sheet(rows: ([string, string] | [string, string, string])[]): File {
  const cell = (v: string) => `"${v.replaceAll('"', '""')}"`;
  const s5a = rows.some((r) => r.length === 3);
  const lines = [
    ['id', 'Art', 'Frage', 'Ansprechpartner-Hinweis', 'Antwort', ...(s5a ? ['Antwortart'] : [])],
    ...rows.map(([id, answer, kind]) => [
      id,
      'Befund',
      'Frage?',
      '',
      answer,
      ...(s5a ? [kind ?? ''] : []),
    ]),
  ].map((r) => r.map(cell).join(';'));
  return new File([`\uFEFF${lines.join('\r\n')}\r\n`], 'antworten.csv', { type: 'text/csv' });
}

const sheetPosts = (calls: readonly Call[]) =>
  calls.filter((c) => c.method === 'POST' && c.path === `${BASE}/answers`);

describe('„Antworten aus CSV übernehmen“ (M6 S5a, S5c-1)', () => {
  it('previews an S5a sheet’s dry run (notes, the outside mark, unknown ids, invalid rows, the hint once) and stores on confirmation', async () => {
    const list = items.map((q) => ({ ...q }));
    const { calls, user } = setup('/projects/demo/open-questions', {
      list,
      routes: answerRoutes(list),
    });
    await rows();
    await user.click(screen.getByRole('button', { name: 'Antworten aus CSV übernehmen' }));
    const box = await dialog();
    const confirm = within(box).getByTestId('answer-sheet-confirm');
    expect(confirm).toHaveProperty('disabled', true);
    // stored answers cannot be changed or deleted, and the dialog says so up front
    expect(
      within(box).getByText(/Eine gespeicherte Antwort lässt sich nicht mehr ändern/),
    ).toBeDefined();
    // one status region from the start, so the dry run's result is announced
    const status = within(box).getByRole('status');
    expect(status.textContent).toBe('');
    // a German button for the picker, the chosen file named next to it
    expect(within(box).getByRole('button', { name: 'Datei auswählen' })).toBeDefined();
    expect(within(box).getByTestId('answer-sheet-file-name').textContent).toBe(
      'Keine Datei ausgewählt',
    );
    await user.upload(
      within(box).getByLabelText('CSV-Datei'),
      sheet([
        ['q-00000000000000a1', 'Die Buchhaltung, max@example.com', ''],
        ['q-00000000000000a3', 'Ein externer Zahlungsdienst.', 'Liegt außerhalb der Landschaft'],
        ['q-00000000000000a4', '', ''],
        ['q-00000000000000ff', 'Gibt es nicht mehr.', ''],
        ['q-00000000000000a5', 'Spediteur', 'Vielleicht'],
      ]),
    );
    const preview = await within(box).findByTestId('answer-sheet-preview');
    expect(within(box).getByTestId('answer-sheet-file-name').textContent).toBe('„antworten.csv“');
    expect(within(box).getByRole('button', { name: 'Andere Datei auswählen' })).toBeDefined();
    const dry = sheetPosts(calls);
    expect(dry).toHaveLength(1);
    expect(new URLSearchParams(dry[0]!.search).get('dryRun')).toBe('true');
    // only the filled rows, their cells as written
    expect((dry[0]!.body as { rows: unknown[] }).rows).toEqual([
      { id: 'q-00000000000000a1', text: 'Die Buchhaltung, max@example.com', kind: '' },
      {
        id: 'q-00000000000000a3',
        text: 'Ein externer Zahlungsdienst.',
        kind: 'Liegt außerhalb der Landschaft',
      },
      { id: 'q-00000000000000ff', text: 'Gibt es nicht mehr.', kind: '' },
      { id: 'q-00000000000000a5', text: 'Spediteur', kind: 'Vielleicht' },
    ]);
    expect(within(preview).getByTestId('answer-sheet-summary').textContent).toBe(
      '„antworten.csv“: 2 Antworten werden gespeichert, 1 unbekannte Kennung, 1 ungültige Zeile, 1 Zeile ohne Antwort.',
    );
    expect(status.textContent).toBe(
      '„antworten.csv“: 2 Antworten werden gespeichert, 1 unbekannte Kennung, 1 ungültige Zeile, 1 Zeile ohne Antwort.',
    );
    // the personal-data hint once, the row marked
    expect(within(preview).getAllByTestId('answer-sheet-personal-data')).toHaveLength(1);
    const byOutcome = (outcome: string) =>
      within(preview)
        .getAllByTestId('answer-sheet-row')
        .filter((r) => r.dataset['outcome'] === outcome);
    const recorded = byOutcome('recorded');
    expect(recorded.map((r) => r.dataset['questionId'])).toEqual([
      'q-00000000000000a1',
      'q-00000000000000a3',
    ]);
    expect(recorded[0]!.textContent).toContain('„Rechnung senden“ → „Rechnung empfangen“');
    expect(within(recorded[0]!).getByTestId('answer-sheet-row-kind').textContent).toBe('Notiz');
    expect(recorded[0]!.textContent).toContain('als Notiz an der Relation');
    expect(within(recorded[0]!).getByTestId('answer-sheet-row-warning')).toBeDefined();
    expect(within(recorded[1]!).getByTestId('answer-sheet-row-kind').textContent).toBe(
      'Liegt außerhalb der Landschaft',
    );
    expect(recorded[1]!.textContent).toContain('Zeile 3');
    expect(byOutcome('unknown').map((r) => r.dataset['questionId'])).toEqual([
      'q-00000000000000ff',
    ]);
    // the spreadsheet's rows, also after the row without an answer that was not sent
    expect(byOutcome('unknown')[0]!.textContent).toContain('Zeile 5');
    expect(byOutcome('invalid')[0]!.textContent).toContain('Zeile 6');
    // the lost answer stays readable, so it can be entered again
    expect(byOutcome('unknown')[0]!.textContent).toContain('Gibt es nicht mehr.');
    expect(preview.textContent).toContain('ihre Quelle hat sich seit dem Export geändert');
    const invalid = byOutcome('invalid')[0]!;
    expect(within(invalid).getByTestId('answer-sheet-reason').textContent).toContain(
      'Die Antwortart dieser älteren CSV ist keine von',
    );
    // nothing stored yet
    expect(list.every((q) => q.state === 'open')).toBe(true);

    expect(confirm.textContent).toBe('2 Antworten speichern');
    await user.click(confirm);
    expect(await findToast('2 Antworten gespeichert')).toBeDefined();
    const stored = sheetPosts(calls);
    expect(new URLSearchParams(stored[1]!.search).get('dryRun')).toBe('false');
    expect(stored[1]!.body).toEqual(dry[0]!.body);
    // Rows were left out: the dialog stays with the stored result and their texts.
    const after = await within(box).findByTestId('answer-sheet-left-out');
    expect(after.textContent).toContain('Nicht jede Zeile ist gespeichert.');
    expect(within(box).getByTestId('answer-sheet-summary').textContent).toBe(
      '„antworten.csv“: 2 Antworten gespeichert, 1 unbekannte Kennung, 1 ungültige Zeile, 1 Zeile ohne Antwort.',
    );
    const left = within(box)
      .getAllByTestId('answer-sheet-row')
      .filter((r) => r.dataset['outcome'] === 'unknown' || r.dataset['outcome'] === 'invalid');
    expect(left.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Gibt es nicht mehr.'),
      expect.stringContaining('Spediteur'),
    ]);
    expect(within(box).queryByTestId('answer-sheet-confirm')).toBeNull();
    expect(within(box).queryByTestId('answer-sheet-personal-data')).toBeNull();
    await user.click(within(box).getByRole('button', { name: 'Schließen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // the note leaves the held relation open; the old sheet's outside mark marks the call
    await waitFor(async () =>
      expect(
        (await rows())
          .filter((r) => r.dataset['state'] === 'answered')
          .map((r) => r.dataset['questionId']),
      ).toEqual(['q-00000000000000a3']),
    );
    expect(
      within((await rows())[0]!)
        .getAllByTestId('question-answer')
        .map((a) => a.dataset['role']),
    ).toEqual(['note']);
  });

  it('says in the dialog that every filled answer becomes a note, without „Antwortart“', async () => {
    setup('/projects/demo/open-questions');
    await rows();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Antworten aus CSV übernehmen' }));
    const box = await dialog();
    expect(box.textContent).toContain('in der die Spalte „Antwort“ ausgefüllt ist');
    expect(box.textContent).toContain('Jede Antwort wird als Notiz an ihrer Frage gespeichert');
    expect(box.textContent).toContain('Eine ältere Datei mit der Spalte „Antwortart“ geht auch');
  });

  it('refuses a file without the export’s columns before sending anything', async () => {
    const { calls, user } = setup('/projects/demo/open-questions');
    await rows();
    await user.click(screen.getByRole('button', { name: 'Antworten aus CSV übernehmen' }));
    const box = await dialog();
    await user.upload(
      within(box).getByLabelText('CSV-Datei'),
      new File(['Frage;Kommentar\r\nx;y\r\n'], 'notizen.csv', { type: 'text/csv' }),
    );
    expect((await within(box).findByTestId('answer-sheet-error')).textContent).toContain(
      '„notizen.csv“ hat keine Spalten „id“ und „Antwort“',
    );
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
    expect(within(box).getByTestId('answer-sheet-confirm')).toHaveProperty('disabled', true);
  });

  it('says when no row brings a new answer, and stores nothing', async () => {
    const list = items.map((q) => ({ ...q }));
    const { calls, user } = setup('/projects/demo/open-questions', {
      list,
      routes: answerRoutes(list),
    });
    await rows();
    await user.click(screen.getByRole('button', { name: 'Antworten aus CSV übernehmen' }));
    const box = await dialog();
    await user.upload(within(box).getByLabelText('CSV-Datei'), sheet([['q-00000000000000a1', '']]));
    expect(await within(box).findByTestId('answer-sheet-nothing')).toBeDefined();
    expect(within(box).getByTestId('answer-sheet-summary').textContent).toBe(
      '„antworten.csv“: 0 Antworten werden gespeichert, 1 Zeile ohne Antwort.',
    );
    expect(within(box).getByTestId('answer-sheet-confirm')).toHaveProperty('disabled', true);
    await user.click(within(box).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // nothing filled, so nothing to check: no request at all
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('refuses a sheet saved as ANSI before sending anything, so no umlaut is stored as „�“', async () => {
    const { calls, user } = setup('/projects/demo/open-questions');
    await rows();
    await user.click(screen.getByRole('button', { name: 'Antworten aus CSV übernehmen' }));
    const box = await dialog();
    // „Prüfung“ in Windows-1252, as German Excel saves „CSV (Trennzeichen-getrennt)“
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('"id";"Antwort";"Antwortart"\r\n"q-00000000000000a3";"Pr'),
      0xfc,
      ...new TextEncoder().encode('fung";""\r\n'),
    ]);
    await user.upload(
      within(box).getByLabelText('CSV-Datei'),
      new File([bytes], 'ansi.csv', { type: 'text/csv' }),
    );
    expect((await within(box).findByTestId('answer-sheet-error')).textContent).toContain(
      '„ansi.csv“ ist nicht als UTF-8 gespeichert, so würden Umlaute verfälscht. Speichere die Datei im Tabellenprogramm als „CSV UTF-8 (durch Trennzeichen getrennt)“',
    );
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
    expect(within(box).getByTestId('answer-sheet-confirm')).toHaveProperty('disabled', true);
  });

  it('warns about personal data only in rows it would store, and says when a note joins earlier ones', async () => {
    const list = items.map((q) =>
      q.id === 'q-00000000000000a3'
        ? {
            ...q,
            answers: [openQuestionAnswer({ questionId: q.id, text: 'Erst so.', seq: 21 })],
          }
        : { ...q },
    );
    const { calls, user } = setup('/projects/demo/open-questions', {
      list,
      routes: answerRoutes(list),
    });
    await rows();
    await user.click(screen.getByRole('button', { name: 'Antworten aus CSV übernehmen' }));
    const box = await dialog();
    await user.upload(
      within(box).getByLabelText('CSV-Datei'),
      sheet([
        ['q-00000000000000a3', 'Dann doch so.'],
        ['q-00000000000000ff', 'Fragen an info@example.com'],
      ]),
    );
    const preview = await within(box).findByTestId('answer-sheet-preview');
    expect(sheetPosts(calls)).toHaveLength(1);
    // the only address is in a row that is never stored: no hint
    expect(within(preview).queryByTestId('answer-sheet-personal-data')).toBeNull();
    const recorded = within(preview)
      .getAllByTestId('answer-sheet-row')
      .find((r) => r.dataset['outcome'] === 'recorded')!;
    expect(within(recorded).getByTestId('answer-sheet-row-before').textContent).toBe(
      'Schon eine Notiz. Diese kommt hinzu; die bisherige bleibt stehen.',
    );
    // the unknown row was left out: the dialog stays and lists it
    await user.click(within(box).getByTestId('answer-sheet-confirm'));
    expect(await findToast('1 Antwort gespeichert')).toBeDefined();
    expect(await within(box).findByTestId('answer-sheet-left-out')).toBeDefined();
    expect(within(box).queryByTestId('answer-sheet-row-before')).toBeNull();
  });

  it('closes after storing when every filled row is stored', async () => {
    const list = items.map((q) => ({ ...q }));
    const { user } = setup('/projects/demo/open-questions', { list, routes: answerRoutes(list) });
    await rows();
    await user.click(screen.getByRole('button', { name: 'Antworten aus CSV übernehmen' }));
    const box = await dialog();
    await user.upload(
      within(box).getByLabelText('CSV-Datei'),
      sheet([
        ['q-00000000000000a3', 'Der Zahlungsdienst.'],
        ['q-00000000000000a4', ''],
      ]),
    );
    await within(box).findByTestId('answer-sheet-preview');
    await user.click(within(box).getByTestId('answer-sheet-confirm'));
    expect(await findToast('1 Antwort gespeichert')).toBeDefined();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

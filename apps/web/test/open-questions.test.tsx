/**
 * The tab „Offene Fragen“ and the model view's section (M6 S4, §4.4): the
 * tab after „Befunde“ with its count, the items in the server's order with
 * their texts (human and agent texts as plain text), contact hints, raisers
 * and links, the filters in the URL, the export through the export route
 * (byte for byte, under the server's file name), the empty states, every
 * role (read permission), and the section in the model view.
 */
import type { Health, Landscape, Model, OpenQuestion, Project } from '@analyzr/client';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
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
import { model, openQuestion } from './support/fixtures';
import { findToast, json, stubApi, type Call } from './support/render';

const BASE = '/api/v1/projects/demo/open-questions';
const LOCAL: Health = { status: 'ok', version: '0.1.0-test', db: 'ok' };
const DEMO: Health = { ...LOCAL, demo: 'readonly' };

const HOSTILE = 'Gilt das auch für Teillieferungen? <img src=x onerror="alert(1)"> <b>fett</b>';

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
  }),
  openQuestion({
    id: 'q-00000000000000a3',
    kind: 'call-target-unknown',
    unlocks: 2,
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
  const calls = stubApi({ [`GET ${BASE}`]: listRoute(list), ...routes });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(healthQuery.queryKey, health);
  queryClient.setQueryData(projectsQuery.queryKey, [project(role)]);
  queryClient.setQueryData(projectQuery('demo').queryKey, project(role));
  const landscape: Landscape = {
    projectId: 'prj_01DEMO',
    seq: 12,
    models: [],
    relations: [],
    findings: [],
  };
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

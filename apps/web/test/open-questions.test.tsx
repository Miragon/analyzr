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

// ------------------------------------------------------------------ answers (M6 S5a)

/**
 * The answer routes over a list that changes like the server's: a POST
 * records an answer on the item (`recorded`), the same kind and text again
 * is `unchanged`, an id the list does not have is 404.
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
        const kind = r.kind === 'Liegt außerhalb der Landschaft' ? 'outside-landscape' : 'answer';
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
              target,
              text: r.text.trim(),
              seq,
            });
            const at = list.indexOf(q);
            list[at] = { ...q, state: 'answered', answers: [...q.answers, answer] };
          }
        }
      }
      return json({ dryRun, counts, rows: out });
    },
  } satisfies Parameters<typeof stubApi>[0];
}

/** `POST …/open-questions/{q}/answers` for every item of `list` (stateful). */
function singleAnswerRoutes(list: OpenQuestion[]) {
  const routes: Parameters<typeof stubApi>[0] = {};
  let seq = 30;
  for (const q of list) {
    routes[`POST ${BASE}/${q.id}/answers`] = (call) => {
      const current = list.find((x) => x.id === q.id)!;
      const body = call.body as { text: string; kind: OpenQuestion['answers'][number]['kind'] };
      const target =
        q.subject.type === 'relation'
          ? ('relation-note' as const)
          : q.subject.type === 'placement'
            ? ('placement-note' as const)
            : ('answer' as const);
      const same = current.answers.find((a) => a.kind === body.kind && a.text === body.text);
      const answer =
        same ??
        openQuestionAnswer({
          id: `oqa_${++seq}`,
          questionId: q.id,
          kind: body.kind,
          target,
          text: body.text,
          note:
            target === 'relation-note'
              ? { type: 'relation', subjectId: q.subject.id, assertionId: 'asr_01NOTE' }
              : null,
          seq,
        });
      const question: OpenQuestion = same
        ? current
        : { ...current, state: 'answered', answers: [...current.answers, answer] };
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

describe('answering (M6 S5a)', () => {
  it('offers „Beantworten“ on every item and the CSV takeover to reviewers only', async () => {
    setup('/projects/demo/open-questions', { role: 'editor' });
    const all = await rows();
    for (const row of all) expect(within(row).getByTestId('question-answer-button')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Antworten aus CSV übernehmen' })).toBeDefined();
    // the button names the item's subject for screen readers
    const button = within(all[0]!).getByTestId('question-answer-button');
    const subject = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(subject?.textContent).toBe('„Rechnung senden“ → „Rechnung empfangen“');
  });

  it('hides both from viewers and on the read-only demo', async () => {
    setup('/projects/demo/open-questions', { role: 'viewer' });
    expect(await rows()).toHaveLength(6);
    expect(screen.queryAllByTestId('question-answer-button')).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Antworten aus CSV übernehmen' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Als CSV exportieren' })).toBeDefined();
    cleanup();
    setup('/projects/demo/open-questions', { role: 'owner', health: DEMO });
    expect(await rows()).toHaveLength(6);
    expect(screen.queryAllByTestId('question-answer-button')).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Antworten aus CSV übernehmen' })).toBeNull();
  });

  it('answers a held relation: kinds, the hint, the agents sentence, the live warning, then answered', async () => {
    const list = items.map((q) => ({ ...q }));
    const { calls, user } = setup('/projects/demo/open-questions', {
      list,
      routes: { ...singleAnswerRoutes(list), [`GET ${BASE}`]: listRoute(list) },
    });
    const [held] = await rows();
    await user.click(within(held!).getByTestId('question-answer-button'));
    const box = await dialog();
    expect(within(box).getByRole('heading', { name: 'Frage beantworten' })).toBeDefined();
    expect(within(box).getByTestId('answer-question').textContent).toContain(items[0]!.text);
    // three kinds, „Antwort“ chosen
    const kinds = within(box).getAllByRole('radio');
    expect(kinds.map((k) => [k.textContent, k.getAttribute('aria-checked')])).toEqual([
      ['Antwort', 'true'],
      ['Liegt außerhalb der Landschaft', 'false'],
      ['Wird im Modell ergänzt', 'false'],
    ]);
    expect(within(box).getByTestId('answer-hint').textContent).toBe(
      'Keine Namen oder anderen personenbezogenen Daten.',
    );
    // an answer is append-only, and the dialog says so before it is saved
    expect(within(box).getByTestId('answer-permanent').textContent).toBe(
      'Eine gespeicherte Antwort lässt sich nicht mehr ändern oder löschen.',
    );
    expect(within(box).getByTestId('answer-effect').textContent).toContain(
      'Die Agenten berücksichtigen die Antwort, sobald das Paar neu bewertet wird.',
    );
    expect(within(box).getByTestId('answer-effect').textContent).toContain('Notiz an der Relation');
    expect(within(box).getByTestId('answer-effect').textContent).toContain(
      'Die Vormerkung bleibt; die Entscheidung triffst du.',
    );
    expect(within(box).getByTestId('answer-effect').textContent).toContain(
      'Die Notiz enthält nur deinen Text, nicht die Antwortart',
    );
    const save = within(box).getByRole('button', { name: 'Antwort speichern' });
    expect(save).toHaveProperty('disabled', true);

    const field = within(box).getByLabelText('Deine Antwort');
    expect(document.activeElement).toBe(field);
    expect(field.getAttribute('maxlength')).toBe('2000');
    await user.type(field, 'Die Buchhaltung, Rückfragen an max.muster@example.com');
    // the warning comes live and never blocks
    const warning = within(box).getByTestId('answer-personal-data');
    // the live region holds the sentence; the list of finds sits outside it
    const status = within(warning).getByRole('status');
    expect(status.textContent).toBe(
      'Vermutlich personenbezogene DatenDer Text enthält vermutlich eine E-Mail-Adresse. Prüf bitte, ob das wirklich gespeichert werden soll: keine Namen oder anderen personenbezogenen Daten.',
    );
    expect(status.textContent).not.toContain('max.muster@example.com');
    expect(within(warning).getByRole('list', { name: 'Gefunden' }).textContent).toBe(
      'E-Mail-Adresse: max.muster@example.com',
    );
    expect(field.getAttribute('aria-describedby')?.split(' ')).toContain(status.id);
    expect(save).toHaveProperty('disabled', false);
    await user.clear(field);
    await user.type(field, '  Die Buchhaltung verschickt sie.  ');
    expect(warning.textContent).toBe('');
    // the live region stays, empty, so the next warning is announced
    expect(within(warning).getByRole('status').textContent).toBe('');
    await user.click(within(box).getByRole('radio', { name: 'Liegt außerhalb der Landschaft' }));
    expect(within(box).getByTestId('answer-kind-hint').textContent).toContain(
      'Die Frage gilt damit als beantwortet; einen Befund verwirft das nicht.',
    );
    await user.click(save);

    expect(await findToast('Antwort gespeichert')).toBeDefined();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/answers'));
    expect(post?.path).toBe(`${BASE}/q-00000000000000a1/answers`);
    expect(post?.body).toEqual({
      kind: 'outside-landscape',
      text: 'Die Buchhaltung verschickt sie.',
    });

    const [answered] = await rows();
    await waitFor(() => expect(answered!.dataset['state']).toBe('answered'));
    expect(within(answered!).getByTestId('question-state').textContent).toBe('Beantwortet');
    const answer = within(answered!).getByTestId('question-answer');
    expect(answer.dataset['target']).toBe('relation-note');
    expect(within(answer).getByTestId('question-answer-kind').textContent).toBe(
      'Liegt außerhalb der Landschaft',
    );
    expect(answer.textContent).toContain('als Notiz an der Relation');
    expect(within(answer).getByTestId('question-answer-text').textContent).toBe(
      'Die Buchhaltung verschickt sie.',
    );
    // the focus goes back to the button that opened the dialog
    await waitFor(() =>
      expect(document.activeElement).toBe(within(answered!).getByTestId('question-answer-button')),
    );
  });

  it('points at the model’s documentation for every other subject, and at the chain for steps', async () => {
    const placement = openQuestion({
      id: 'q-00000000000000c1',
      kind: 'held',
      source: 'hold',
      subject: { type: 'placement', id: 'plc_01HELD' },
      subjectLabel: '„Zahlung“ auf „Finanzen“',
      text: 'Gehört das hierher?',
    });
    const { user } = setup('/projects/demo/open-questions', { list: [...items, placement] });
    const all = await rows();
    const effect = async (row: HTMLElement) => {
      await user.click(within(row).getByTestId('question-answer-button'));
      const text = within(await dialog()).getByTestId('answer-effect').textContent;
      await user.click(within(await dialog()).getByRole('button', { name: 'Abbrechen' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      return text;
    };
    const finding = await effect(all[2]!);
    expect(finding).toContain('ergänze die Dokumentation des Modells und importiere es erneut');
    expect(finding).not.toContain('Die Agenten berücksichtigen');
    expect(await effect(all[3]!)).toContain('passe die Wertschöpfungskette an');
    expect(await effect(all[5]!)).toContain('Dokumentation des Modells');
    // A held placement homes its process: the answer makes nothing due, the hold stays.
    const plc = await effect(all[6]!);
    expect(plc).toContain('als Notiz an der Platzierung');
    expect(plc).not.toContain('fällig');
    expect(plc).toContain(
      'Die Platzierung bleibt vorgemerkt; solange bekommt kein Agent den Prozess.',
    );
  });

  it('starts every dialog afresh, says when an answer was there already, and keeps the text on a refusal', async () => {
    const list = items.map((q) => ({ ...q }));
    let refuse = true;
    const routes = singleAnswerRoutes(list);
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
    const third = (await rows())[2]!;
    await user.click(within(third).getByTestId('question-answer-button'));
    let box = await dialog();
    await user.type(within(box).getByLabelText('Deine Antwort'), 'Der Zahlungsdienst.');
    await user.click(within(box).getByRole('button', { name: 'Antwort speichern' }));
    expect((await within(box).findByTestId('answer-error')).textContent).toContain(
      'Validation failed: text: too long',
    );
    // still open, the text kept
    expect(within(box).getByLabelText<HTMLTextAreaElement>('Deine Antwort').value).toBe(
      'Der Zahlungsdienst.',
    );
    refuse = false;
    await user.click(within(box).getByRole('button', { name: 'Antwort speichern' }));
    expect(await findToast('Antwort gespeichert')).toBeDefined();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // the next dialog starts empty and says the item has an answer; the same answer again
    // changes nothing
    await user.click(within((await rows())[2]!).getByTestId('question-answer-button'));
    box = await dialog();
    expect(within(box).getByLabelText<HTMLTextAreaElement>('Deine Antwort').value).toBe('');
    expect(within(box).getByTestId('answer-before').textContent).toBe(
      'Schon beantwortet. Deine Antwort kommt hinzu; die bisherige bleibt stehen.',
    );
    await user.type(within(box).getByLabelText('Deine Antwort'), 'Der Zahlungsdienst.');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(await findToast('Antwort schon gespeichert')).toBeDefined();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes on an id that changed meanwhile and says so', async () => {
    const { user } = setup('/projects/demo/open-questions', {
      routes: {
        [`POST ${BASE}/q-00000000000000a5/answers`]: () =>
          json({ title: 'Not Found', status: 404, code: 'not-found' }, 404),
      },
    });
    await user.click(within((await rows())[4]!).getByTestId('question-answer-button'));
    const box = await dialog();
    await user.type(within(box).getByLabelText('Deine Antwort'), 'Ein externer Spediteur.');
    await user.click(within(box).getByRole('button', { name: 'Antwort speichern' }));
    expect((await findToast('Frage gibt es so nicht mehr')).textContent).toContain(
      'Die Quelle der Frage hat sich inzwischen geändert (dann hat die Frage eine neue Kennung)',
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('hands the focus to the count when the answered item leaves the list „Offen“', async () => {
    const list = items.map((q) => ({ ...q }));
    const { user } = setup('/projects/demo/open-questions?state=open', {
      list,
      routes: { ...singleAnswerRoutes(list), [`GET ${BASE}`]: listRoute(list) },
    });
    expect(await ids()).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
    const first = (await rows())[0]!;
    await user.click(within(first).getByTestId('question-answer-button'));
    const box = await dialog();
    expect(within(box).queryByTestId('answer-before')).toBeNull();
    await user.type(within(box).getByLabelText('Deine Antwort'), 'Die Buchhaltung.');
    await user.click(within(box).getByRole('button', { name: 'Antwort speichern' }));
    expect(await findToast('Antwort gespeichert')).toBeDefined();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(async () => expect(await ids()).toEqual(['a2', 'a3', 'a4', 'a5', 'a6']));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId('open-questions-count')),
    );
  });

  it('shows the answers of answered items as plain text, and the Status filter finds them', async () => {
    const answered = openQuestion({
      ...items[2]!,
      state: 'answered',
      answers: [
        openQuestionAnswer({ questionId: items[2]!.id, text: 'Erst <b>so</b>', seq: 21 }),
        openQuestionAnswer({
          id: 'oqa_02',
          questionId: items[2]!.id,
          kind: 'will-be-modelled',
          text: 'Wird modelliert.',
          seq: 22,
        }),
      ],
    });
    const list = items.map((q) => (q.id === answered.id ? answered : q));
    const { router, user } = setup('/projects/demo/open-questions', { list });
    const row = (await rows())[2]!;
    expect(row.dataset['state']).toBe('answered');
    const answers = within(row).getAllByTestId('question-answer');
    expect(answers.map((a) => a.dataset['answerKind'])).toEqual(['answer', 'will-be-modelled']);
    expect(within(row).getByTestId('question-answers').textContent).toContain('2 Antworten');
    expect(answers[0]!.querySelector('b')).toBeNull();
    expect(within(answers[0]!).getByTestId('question-answer-text').textContent).toBe(
      'Erst <b>so</b>',
    );
    expect(answers[0]!.textContent).toContain('bei der Frage');
    const at = within(answers[0]!).getByTestId('question-answer-at');
    expect(at.getAttribute('datetime')).toBe('2026-10-16T10:00:00.000Z');
    expect(at.getAttribute('title')).toBe('Projektstand s21');

    const state = screen.getByLabelText('Status');
    expect(
      within(state)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Alle', 'Offen (5)', 'Beantwortet (1)']);
    await user.selectOptions(state, 'answered');
    await waitFor(() => expect(router.state.location.search).toEqual({ state: 'answered' }));
    expect(await ids()).toEqual(['a3']);
    await user.selectOptions(state, 'open');
    expect(await ids()).toEqual(['a1', 'a2', 'a4', 'a5', 'a6']);
  });

  it('answers in the model view’s section as well', async () => {
    const list = items.map((q) => ({ ...q }));
    const { calls, user } = setup('/projects/demo/models/a/order', {
      list,
      routes: { ...singleAnswerRoutes(list), [`GET ${BASE}`]: listRoute(list) },
    });
    const section = await screen.findByTestId('model-open-questions');
    await waitFor(() => expect(within(section).getAllByTestId('open-question')).toHaveLength(4));
    const call = within(section)
      .getAllByTestId('open-question')
      .find((r) => r.dataset['questionId'] === 'q-00000000000000a3')!;
    await user.click(within(call).getByTestId('question-answer-button'));
    const box = await dialog();
    expect(within(box).getByTestId('answer-effect').textContent).toContain(
      'Dokumentation des Modells',
    );
    await user.type(within(box).getByLabelText('Deine Antwort'), 'Der Zahlungsdienst.');
    await user.click(within(box).getByRole('button', { name: 'Antwort speichern' }));
    expect(await findToast('Antwort gespeichert')).toBeDefined();
    expect(
      calls.some((c) => c.method === 'POST' && c.path === `${BASE}/q-00000000000000a3/answers`),
    ).toBe(true);
    await waitFor(() =>
      expect(
        within(section)
          .getAllByTestId('open-question')
          .find((r) => r.dataset['questionId'] === 'q-00000000000000a3')?.dataset['state'],
      ).toBe('answered'),
    );
  });

  it('hides „Beantworten“ in the model view from viewers', async () => {
    setup('/projects/demo/models/a/order', { role: 'viewer' });
    const section = await screen.findByTestId('model-open-questions');
    await waitFor(() => expect(within(section).getAllByTestId('open-question')).toHaveLength(4));
    expect(within(section).queryAllByTestId('question-answer-button')).toEqual([]);
  });
});

/** The CSV the export writes, filled in: BOM, `;`, CRLF, every field quoted. */
function sheet(rows: [string, string, string][]): File {
  const cell = (v: string) => `"${v.replaceAll('"', '""')}"`;
  const lines = [
    ['id', 'Art', 'Frage', 'Ansprechpartner-Hinweis', 'Antwort', 'Antwortart'],
    ...rows.map(([id, answer, kind]) => [id, 'Befund', 'Frage?', '', answer, kind]),
  ].map((r) => r.map(cell).join(';'));
  return new File([`\uFEFF${lines.join('\r\n')}\r\n`], 'antworten.csv', { type: 'text/csv' });
}

const sheetPosts = (calls: readonly Call[]) =>
  calls.filter((c) => c.method === 'POST' && c.path === `${BASE}/answers`);

describe('„Antworten aus CSV übernehmen“ (M6 S5a)', () => {
  it('previews the dry run (filled rows, unknown ids, invalid rows, the hint once) and stores on confirmation', async () => {
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
    expect(recorded[0]!.textContent).toContain('als Notiz an der Relation');
    expect(within(recorded[0]!).getByTestId('answer-sheet-row-warning')).toBeDefined();
    expect(recorded[1]!.textContent).toContain('Liegt außerhalb der Landschaft');
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
      'Die Antwortart ist keine von',
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
    await waitFor(async () =>
      expect(
        (await rows())
          .filter((r) => r.dataset['state'] === 'answered')
          .map((r) => r.dataset['questionId']),
      ).toEqual(['q-00000000000000a1', 'q-00000000000000a3']),
    );
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
    await user.upload(
      within(box).getByLabelText('CSV-Datei'),
      sheet([['q-00000000000000a1', '', '']]),
    );
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

  it('warns about personal data only in rows it would store, and says when an answer joins earlier ones', async () => {
    const list = items.map((q) =>
      q.id === 'q-00000000000000a3'
        ? {
            ...q,
            state: 'answered' as const,
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
        ['q-00000000000000a3', 'Dann doch so.', ''],
        ['q-00000000000000ff', 'Fragen an info@example.com', ''],
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
      'Schon beantwortet. Deine Antwort kommt hinzu; die bisherige bleibt stehen.',
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
        ['q-00000000000000a3', 'Der Zahlungsdienst.', ''],
        ['q-00000000000000a4', '', ''],
      ]),
    );
    await within(box).findByTestId('answer-sheet-preview');
    await user.click(within(box).getByTestId('answer-sheet-confirm'));
    expect(await findToast('1 Antwort gespeichert')).toBeDefined();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

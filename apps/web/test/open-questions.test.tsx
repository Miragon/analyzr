/**
 * The tab „Offene Fragen“ and the model view's „Fragen“ (M6 S4, §4.4; notes
 * and the sheet since S5c-1, §4.8 b; the actions in
 * `open-question-actions.test.tsx`; reworked in UX2b,
 * UX-SIMPLIFICATION.md §3.3): the last of the four tabs with its count, „Zu
 * klären“ as lean cards in the server's order (the subject a link, the
 * question with „Warum?“ closed, human and agent texts as plain text, whom
 * to ask, no ids, no event numbers, no source label), the agents' questions
 * only under „Art“, „Zur Information“ and „Erledigte zeigen“ closed, three
 * filters in the URL (the source a removable chip), the export dialog for
 * the customer (`group=ask` by default, the agents' questions on request,
 * byte for byte under the server's name), the empty states, every role
 * (read permission), and the model view's „Fragen“ (`ask` only).
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
import { model, openQuestion, openQuestionAnswer, openQuestionPage } from './support/fixtures';
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
  label: 'Vorschlag prüfen',
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
    group: 'agent',
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
      { type: 'place', primary: true, label: 'Prozess platzieren …', pick: 'process' },
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
    group: 'info',
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
  return (call: Call) => json(openQuestionPage(list, call.search));
}

function setup(
  path: string,
  {
    list = items,
    role = 'owner',
    health = LOCAL,
    routes = {},
    findings = [],
  }: {
    list?: readonly OpenQuestion[];
    role?: Project['role'];
    health?: Health;
    routes?: Parameters<typeof stubApi>[0];
    findings?: Landscape['findings'];
  } = {},
) {
  const landscape: Landscape = {
    projectId: 'prj_01DEMO',
    seq: 12,
    models: [],
    relations: [],
    findings,
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
/** Opens a closed group of the tab („Zur Information“, „Erledigte zeigen“). */
async function openGroup(user: ReturnType<typeof userEvent.setup>, testId: string) {
  const group = await screen.findByTestId(testId);
  await user.click(group.querySelector('summary')!);
  return group;
}

describe('tab „Offene Fragen“', () => {
  it('is the last of the four tabs and counts „Zu klären“ (owner decision 26)', async () => {
    const { calls } = setup('/projects/demo');
    const nav = await screen.findByRole('navigation', { name: 'Projektbereiche' });
    const links = within(nav).getAllByRole('link');
    const names = links.map((l) => l.textContent.replace(/\d+.*/, '').trim());
    expect(names).toEqual(['Übersicht', 'Relationen', 'Wertschöpfungskette', 'Offene Fragen']);
    const tab = within(nav).getByRole('link', { name: /Offene Fragen/ });
    expect(tab.getAttribute('href')).toBe('/projects/demo/open-questions');
    const ask = items.filter((q) => q.state === 'open' && q.group === 'ask').length;
    expect(ask).toBe(4);
    await waitFor(() => expect(tab.textContent).toBe(`Offene Fragen${ask} zu klären`));
    // one call: the first open item of `group=ask`, whose page carries `totals` and `askByModel`
    const count = calls.find((c) => c.path === BASE);
    const query = new URLSearchParams(count?.search);
    expect(query.get('limit')).toBe('1');
    expect(query.get('state')).toBe('open');
    expect(query.getAll('group')).toEqual(['ask']);
  });

  it('keeps the list „Befunde“ behind a link at its foot (Q2)', async () => {
    setup('/projects/demo/open-questions', {
      findings: [
        { kind: 'unresolved-call', refs: ['a/order#Call_1'], detail: 'Pay' },
        { kind: 'dynamic-call', refs: ['a/order#Call_2'], detail: '${x}' },
      ],
    });
    await rows();
    const link = screen.getByTestId('findings-link');
    expect(link.textContent).toBe('Alle Befunde der Modelle als Liste (2)');
    expect(link.getAttribute('href')).toBe('/projects/demo/findings');
  });

  it('keeps the link to „Befunde“ when nothing is open (findings resolved by links, R1)', async () => {
    setup('/projects/demo/open-questions', {
      list: [],
      findings: [{ kind: 'unresolved-call', refs: ['a/order#Call_1'], detail: 'Pay' }],
    });
    expect(await screen.findByText('Keine offenen Fragen')).toBeTruthy();
    expect(screen.getByTestId('findings-link').textContent).toBe(
      'Alle Befunde der Modelle als Liste (1)',
    );
  });

  it('shows no link to „Befunde“ without findings', async () => {
    setup('/projects/demo/open-questions');
    await rows();
    expect(screen.queryByTestId('findings-link')).toBeNull();
  });

  it('lists „Zu klären“ in the server order as lean cards: no id, no event number, no source label', async () => {
    setup('/projects/demo/open-questions');
    expect(await ids()).toEqual(['a1', 'a3', 'a4', 'a5']);
    const [held, call, step, pool] = await rows();
    expect(held!.textContent).toContain('Vorgemerkt');
    expect(within(held!).getByTestId('question-subject').textContent).toBe(
      '„Rechnung senden“ → „Rechnung empfangen“',
    );
    // the ranking only from two open decisions on, as „Betrifft …“
    expect(within(held!).getByTestId('question-unlocks').textContent).toBe(
      'Betrifft 5 offene Entscheidungen',
    );
    expect(within(call!).getByTestId('question-unlocks').textContent).toBe(
      'Betrifft 2 offene Entscheidungen',
    );
    expect(within(step!).queryByTestId('question-unlocks')).toBeNull();
    expect(within(call!).getByTestId('question-text').textContent).toBe(items[2]!.text);
    for (const row of [held!, call!, step!, pool!]) {
      expect(row.textContent).not.toMatch(
        /q-[0-9a-f]{16}|\bs\d+\b|Erkannt von|Lückensignal|Befund/,
      );
      expect(within(row).queryByTestId('question-source')).toBeNull();
    }
    expect(screen.getByTestId('open-questions-count').textContent).toBe('4 zu klären');
    // a screen reader hears the count change with the filters
    expect(screen.getByTestId('open-questions-count').getAttribute('aria-live')).toBe('polite');
    // one intro line, how it works closed
    expect(screen.getByTestId('open-questions-intro').textContent).toBe(
      'Was in der Landschaft noch fehlt. Zu jeder Frage gibt es eine Aktion, mit der du sie erledigst.',
    );
    expect(screen.getByTestId('open-questions-how').hasAttribute('open')).toBe(false);
    expect(screen.getByTestId('open-questions-how').textContent).toContain(
      'ein Hinweis, keine Zuständigkeit',
    );
  });

  it('keeps the agents’ questions on their proposals and the informational items closed', async () => {
    const { user } = setup('/projects/demo/open-questions');
    await rows();
    expect(screen.queryByText(HOSTILE)).toBeNull();
    const info = screen.getByTestId('open-questions-info');
    expect(info.hasAttribute('open')).toBe(false);
    expect(info.querySelector('summary')?.textContent).toBe('Zur Information (1)');
    // closed, the group holds nothing to click
    expect(within(info).queryAllByRole('link')).toEqual([]);
    await openGroup(user, 'open-questions-info');
    const summary = within(info).getByTestId('open-question');
    expect(summary.dataset['questionId']).toBe('q-00000000000000a6');
    expect(summary.textContent).toContain('Zusammenfassung des Agenten anzeigen');
    expect(within(summary).getByTestId('question-text').textContent).toBe(items[5]!.text);
    expect(within(summary).getByTestId('question-subject').getAttribute('href')).toBe(
      '/projects/demo/models/a/order',
    );
  });

  it('folds descriptive models with one reason into one notice in „Zur Information“', async () => {
    const descriptive = (id: string, key: string) =>
      openQuestion({
        id,
        kind: 'descriptive-model',
        source: 'signal',
        group: 'info',
        subject: { type: 'model', id: key },
        subjectLabel: `„${key}“`,
        modelKeys: [key],
        text: `Hinweis: „${key}“ ist ein beschreibendes Modell, ohne Engine und ohne ausführbaren Prozess.`,
        detail:
          'Die automatische Verknüpfung findet hier wenig; Aufrufziele, Nachrichtennamen und Dokumentation helfen den Agenten, mögliche Relationen zu finden.',
      });
    const { user } = setup('/projects/demo/open-questions', {
      list: [
        items[2]!,
        descriptive('q-00000000000000d1', 'a/order'),
        descriptive('q-00000000000000d2', 'b/billing'),
      ],
    });
    await rows();
    const info = await openGroup(user, 'open-questions-info');
    expect(info.querySelector('summary')?.textContent).toBe('Zur Information (2)');
    expect(within(info).getByTestId('open-questions-descriptive').textContent).toBe(
      '2 von 3 Modellen sind beschreibend (ohne Engine). Die automatische Verknüpfung findet hier wenig; Aufrufziele, Nachrichtennamen und Dokumentation helfen den Agenten, mögliche Relationen zu finden.',
    );
    expect(within(info).queryAllByTestId('open-question')).toEqual([]);
  });

  it('shows the question first, its reason behind „Warum?“, an agent’s words as plain text', async () => {
    const { user } = setup('/projects/demo/open-questions', {
      list: [
        openQuestion({
          id: 'q-00000000000000c1',
          text: 'Welchen Prozess ruft „Zahlung abwickeln“ auf?',
          detail: 'Das eingetragene Ziel „Pay“ gibt es in keinem Modell.',
        }),
        openQuestion({
          id: 'q-00000000000000c2',
          kind: 'placement-unsure',
          source: 'unsure',
          subject: { type: 'process', id: 'a/order#Process_Order' },
          subjectLabel: '„Auftrag“',
          text: 'Auf welchen Schritt der Wertschöpfungskette gehört „Auftrag“?',
          detail: HOSTILE,
          raisedBy: { sourceKind: 'agent', handle: 'agent:sim', seq: 10 },
        }),
      ],
    });
    const [finding, unsure] = await rows();
    expect(within(finding!).getByTestId('question-text').textContent).toBe(
      'Welchen Prozess ruft „Zahlung abwickeln“ auf?',
    );
    const why = within(finding!).getByTestId('question-why');
    expect(why.tagName).toBe('DETAILS');
    expect(why.hasAttribute('open')).toBe(false);
    expect(within(why).getByTestId('question-detail').textContent).toBe(
      'Das eingetragene Ziel „Pay“ gibt es in keinem Modell.',
    );
    await user.click(within(why).getByText('Warum?'));
    expect(why.hasAttribute('open')).toBe(true);
    // The question from code, the agent's words verbatim behind „Warum?“, one agent unnamed.
    expect(within(unsure!).getByTestId('question-text').textContent).toBe(
      'Auf welchen Schritt der Wertschöpfungskette gehört „Auftrag“?',
    );
    const words = within(unsure!).getByTestId('question-detail');
    expect(words.textContent).toBe(`Laut Agent: ${HOSTILE}`);
    expect(words.querySelector('img, b')).toBeNull();
    expect(unsure!.textContent).not.toContain('agent:sim');
  });

  it('shows a hold’s question, its note behind „Warum?“, its label and whom to ask', async () => {
    setup('/projects/demo/open-questions');
    const [held] = await rows();
    expect(within(held!).getByTestId('question-text').textContent).toBe(items[0]!.text);
    expect(within(held!).getByTestId('question-context').textContent).toBe(
      `Notiz zur Vormerkung: ${items[0]!.context}`,
    );
    expect(within(held!).getByTestId('question-label').textContent).toBe(
      'mit Fachbereich Finanzen klären',
    );
    // step owners, then lanes; no folder
    expect(within(held!).getByTestId('question-ask-who').textContent).toBe(
      'Ansprechpartner: Finanzen, Vertrieb',
    );
  });

  it('links each subject to where it is: the review screen, the chain, the model view', async () => {
    setup('/projects/demo/open-questions');
    const [held, call, step, pool] = await rows();
    const href = (row: HTMLElement) =>
      within(row).getByTestId('question-subject').getAttribute('href');
    expect(href(held!)).toBe('/projects/demo/review/rel_01HELD');
    expect(href(call!)).toBe('/projects/demo/models/a/order?element=Call_1');
    expect(href(step!)).toBe('/projects/demo/value-chain?step=step-einkauf');
    expect(href(pool!)).toBe('/projects/demo/models/c/shipping?element=Participant_Carrier');
    // no refs list any more
    expect(within(held!).queryByRole('list', { name: 'Bezug' })).toBeNull();
  });

  it('filters by kind, model or folder and contact in the URL, and resets', async () => {
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
      'Aufrufziel unbekannt (1)',
      'Schritt ohne Prozess (1)',
      'Pool ohne Prozess (1)',
      'Frage eines Agenten (1)',
    ]);
    await user.selectOptions(kind, 'black-box-partner');
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ kind: 'black-box-partner' }),
    );
    expect(await ids()).toEqual(['a5']);
    expect(screen.getByTestId('open-questions-count').textContent).toBe('1 von 4 zu klären');
    expect(screen.getByTestId('open-questions-filter-toggle').textContent).toBe('Filter (1)');
    await user.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    // the button leaves with the filters; the focus stays in the filters
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Art')));

    // „Frage eines Agenten“ lists the agents' questions (the web twin of `--group agent`)
    await user.selectOptions(screen.getByLabelText('Art'), 'agent-question');
    expect(await ids()).toEqual(['a2']);
    expect(screen.getByTestId('open-questions-count').textContent).toBe('1 Fragen der Agenten');
    await user.selectOptions(screen.getByLabelText('Art'), '');

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
    expect(await ids()).toEqual(['a1', 'a3']);
    await user.selectOptions(modelSelect, 'b/billing');
    expect(await ids()).toEqual(['a1']);
    await user.selectOptions(modelSelect, '');

    // step owners and lanes in one list, without groups or folders
    const askWho = screen.getByLabelText('Ansprechpartner');
    expect(within(askWho).queryAllByRole('group')).toEqual([]);
    expect(
      within(askWho)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Alle Ansprechpartner', 'Einkauf (1)', 'Finanzen (1)', 'Vertrieb (1)']);
    await user.selectOptions(askWho, 'Einkauf');
    expect(await ids()).toEqual(['a4']);
    await user.selectOptions(askWho, '');
    // „Quelle“ has no select any more
    expect(screen.queryByLabelText('Quelle')).toBeNull();
    expect(screen.queryByLabelText('Status')).toBeNull();
  });

  it('keeps a source from a link as a removable chip', async () => {
    const { router, user } = setup('/projects/demo/open-questions?source=signal');
    expect(await ids()).toEqual(['a5']);
    const chip = screen.getByTestId('open-questions-source-chip');
    expect(chip.textContent).toBe('Quelle: Lückensignal');
    await user.click(chip);
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(await ids()).toEqual(['a1', 'a3', 'a4', 'a5']);
  });

  it('reads its filters from the URL and says when none matches', async () => {
    const { user } = setup('/projects/demo/open-questions?kind=unjudged&model=nope');
    const empty = await screen.findByTestId('open-questions-empty');
    expect(empty.textContent).toContain('Keine Frage passt zu den Filtern');
    expect(screen.queryAllByTestId('open-question')).toEqual([]);
    // the selected kind without items stays selectable
    expect(screen.getByLabelText<HTMLSelectElement>('Art').value).toBe('unjudged');
    await user.click(within(empty).getByRole('button', { name: 'Filter zurücksetzen' }));
    expect(await ids()).toHaveLength(4);
  });

  it('says so when there is no open question, and when nothing is left to clarify', async () => {
    setup('/projects/demo/open-questions', { list: [] });
    const empty = await screen.findByTestId('open-questions-empty');
    expect(empty.textContent).toContain('Keine offenen Fragen');
    expect(screen.queryByRole('search')).toBeNull();
    cleanup();
    setup('/projects/demo/open-questions', { list: [items[1]!, items[5]!] });
    const none = await screen.findByTestId('open-questions-empty');
    expect(none.textContent).toContain('Nichts zu klären');
    expect(screen.getByTestId('open-questions-count').textContent).toBe('0 zu klären');
    expect(screen.getByTestId('open-questions-info')).toBeDefined();
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

  it('exports for the customer: „Zu klären“ by default under the server’s name, the agents’ questions on request', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:analyzr');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const csv = '﻿"id";"Art";"Frage";"Ansprechpartner";"Antwort"\r\n';
    const { calls, user } = setup('/projects/demo/open-questions?model=a', {
      routes: {
        [`GET ${BASE}/export`]: (call) => {
          const format = new URLSearchParams(call.search).get('format');
          return new Response(format === 'csv' ? csv : '# Offene Fragen: Demo\n', {
            headers: {
              'content-type':
                format === 'csv' ? 'text/csv; charset=utf-8' : 'text/markdown; charset=utf-8',
              'content-disposition': `attachment; filename="offene-fragen-demo-a.${format === 'csv' ? 'csv' : 'md'}"`,
            },
          });
        },
      },
    });
    await rows();
    await user.click(screen.getByRole('button', { name: 'Für den Kunden exportieren …' }));
    const box = await screen.findByTestId('customer-export-dialog');
    expect(within(box).getByRole('heading', { name: 'Für den Kunden exportieren' })).toBeDefined();
    expect(within(box).getByRole('radio', { name: /Zum Lesen \(Markdown\)/ })).toHaveProperty(
      'checked',
      true,
    );
    // the agents' questions under the same filters, off by default
    const agents = within(box).getByRole('checkbox', { name: 'Auch Fragen der Agenten (1)' });
    expect(agents.getAttribute('aria-checked')).toBe('false');
    await user.click(within(box).getByRole('radio', { name: /Zum Ausfüllen \(CSV\)/ }));
    await user.click(within(box).getByRole('button', { name: 'Herunterladen' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('customer-export-dialog')).toBeNull());
    // the focus goes back to the button that opened it (the dialog has no Radix trigger)
    const opener = screen.getByRole('button', { name: 'Für den Kunden exportieren …' });
    await waitFor(() => expect(document.activeElement).toBe(opener));
    const exported = calls.filter((c) => c.path === `${BASE}/export`);
    const first = new URLSearchParams(exported[0]?.search);
    expect([...first.keys()].sort()).toEqual(['format', 'group', 'modelKey', 'state']);
    expect(first.getAll('group')).toEqual(['ask']);
    // the open items, as the list shows them: a marked item is settled, not asked again
    expect(first.get('state')).toBe('open');
    expect(first.get('modelKey')).toBe('a');
    expect(first.get('format')).toBe('csv');
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('offene-fragen-demo-a.csv');
    const blob = createObjectURL.mock.calls[0]![0];
    // the byte order mark survives (Excel needs it for umlauts)
    expect([...new Uint8Array(await blob.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

    await user.click(screen.getByRole('button', { name: 'Für den Kunden exportieren …' }));
    const again = await screen.findByTestId('customer-export-dialog');
    await user.click(within(again).getByRole('radio', { name: /Zum Lesen \(Markdown\)/ }));
    await user.click(within(again).getByRole('checkbox', { name: /Auch Fragen der Agenten/ }));
    await user.click(within(again).getByRole('button', { name: 'Herunterladen' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(2));
    const second = new URLSearchParams(
      calls.filter((c) => c.path === `${BASE}/export`).at(-1)?.search,
    );
    expect(second.getAll('group')).toEqual(['ask', 'agent']);
    expect(second.get('format')).toBe('markdown');
  });

  it('reports a failed export', async () => {
    const { user } = setup('/projects/demo/open-questions', {
      routes: {
        [`GET ${BASE}/export`]: () =>
          json({ title: 'Validation failed', status: 422, code: 'validation-failed' }, 422),
      },
    });
    await rows();
    await user.click(screen.getByRole('button', { name: 'Für den Kunden exportieren …' }));
    const box = await screen.findByTestId('customer-export-dialog');
    await user.click(within(box).getByRole('button', { name: 'Herunterladen' }));
    expect((await findToast('Export fehlgeschlagen')).textContent).toContain(
      'Die Eingabe passt so nicht.',
    );
    // the dialog stays, so the reviewer may try again
    expect(screen.getByTestId('customer-export-dialog')).toBeDefined();
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
    expect(await rows()).toHaveLength(4);
    // no action, so no promise of one in the intro
    expect(screen.getByTestId('open-questions-intro').textContent).toBe(
      'Was in der Landschaft noch fehlt.',
    );
    await user.click(screen.getByRole('button', { name: 'Für den Kunden exportieren …' }));
    await user.click(
      within(await screen.findByTestId('customer-export-dialog')).getByRole('button', {
        name: 'Herunterladen',
      }),
    );
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(calls.filter((c) => c.method !== 'GET' && c.path !== '/api/v1/session')).toEqual([]);
  });
});

describe('model view section „Fragen“', () => {
  it('lists the open questions „Zu klären“ of exactly this model, compact, with a link to the tab', async () => {
    const child = openQuestion({
      id: 'q-00000000000000b1',
      modelKeys: ['a/order/sub'],
      subject: { type: 'ref', id: 'a/order/sub#Call_9' },
    });
    const { calls } = setup('/projects/demo/models/a/order', { list: [...items, child] });
    const section = await screen.findByTestId('model-open-questions');
    // the agent's question sits on its relation, the summary in the tab's „Zur Information“
    await waitFor(() =>
      expect(
        within(section)
          .getAllByTestId('open-question')
          .map((r) => r.dataset['questionId']),
      ).toEqual(['q-00000000000000a1', 'q-00000000000000a3']),
    );
    expect(within(section).getByRole('heading', { name: 'Fragen (2)' })).toBeDefined();
    expect(
      within(section)
        .getByRole('link', { name: /Im Tab zeigen/ })
        .getAttribute('href'),
    ).toBe('/projects/demo/open-questions?model=a%2Forder');
    const request = calls.find((c) => c.path === BASE && c.search.includes('modelKey'));
    const query = new URLSearchParams(request?.search);
    expect(query.get('modelKey')).toBe('a/order');
    expect(query.get('state')).toBe('open');
    expect(query.getAll('group')).toEqual(['ask', 'agent', 'info']);
    // the agents' questions: one link to them (they sit on their proposals until UX3 shows
    // them on the relation cards); the summary read-only, closed (decision 24.8)
    expect(
      within(section)
        .getByRole('link', { name: 'Fragen der Agenten zu Vorschlägen (1)' })
        .getAttribute('href'),
    ).toBe('/projects/demo/open-questions?model=a%2Forder&kind=agent-question');
    const info = within(section).getByTestId('model-questions-info');
    expect(info.hasAttribute('open')).toBe(false);
    expect(info.querySelector('summary')?.textContent).toBe('Zur Information (1)');
    const rows = within(section).getAllByTestId('open-question');
    expect(within(rows[1]!).getByTestId('question-subject').getAttribute('href')).toBe(
      '/projects/demo/models/a/order?element=Call_1',
    );
  });

  it('says when nothing about the model is to clarify', async () => {
    setup('/projects/demo/models/b/billing', { list: items.slice(2) });
    const section = await screen.findByTestId('model-open-questions');
    await waitFor(() =>
      expect(section.textContent).toContain('Zu diesem Modell ist nichts zu klären.'),
    );
    expect(within(section).getByRole('heading', { name: 'Fragen (0)' })).toBeDefined();
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

describe('notes (M6 S5a, S5c-1; a hold’s answer since UX2b)', () => {
  it('offers the actions on every card and the CSV takeover to reviewers only', async () => {
    setup('/projects/demo/open-questions', { role: 'editor' });
    const all = await rows();
    // the primary action as the visible button; a hold answers first (UX2b)
    const primaries = all.map((row) =>
      within(row)
        .queryAllByTestId('question-action')
        .filter((b) => b.dataset['primary'] === 'true')
        .map((b) => b.textContent),
    );
    expect(primaries).toEqual([
      ['Antwort geben'],
      ['Verknüpfen mit …'],
      ['Prozess platzieren …'],
      ['Liegt außerhalb der Landschaft'],
    ]);
    // a hold is decided where the diagrams are (Q4): „Jetzt entscheiden“ beside its answer
    const decideNow = within(all[0]!).getByRole('link', { name: 'Jetzt entscheiden' });
    expect(decideNow.getAttribute('href')).toBe('/projects/demo/review/rel_01HELD?view=held');
    expect(within(all[0]!).queryByTestId('question-more-actions')).toBeNull();
    // at most three actions per card
    for (const row of all)
      expect(
        within(row).getByTestId('question-actions').querySelectorAll(':scope > button, :scope > a')
          .length,
      ).toBeLessThanOrEqual(3);
    expect(screen.queryByRole('button', { name: /Beantworten/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Antworten aus CSV übernehmen …' })).toBeDefined();
    // the buttons name the item's subject for screen readers
    const button = within(all[0]!).getAllByTestId('question-action')[0]!;
    const subject = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(subject?.textContent).toBe('„Rechnung senden“ → „Rechnung empfangen“');
  });

  it('keeps the id in „Weitere Aktionen“ as „Kennung kopieren“', async () => {
    // user-event puts a clipboard of its own on `navigator`
    const { user } = setup('/projects/demo/open-questions');
    const [, call] = await rows();
    await user.click(within(call!).getByTestId('question-more-actions'));
    expect((await screen.findAllByRole('menuitem')).map((i) => i.textContent)).toEqual([
      'Liegt außerhalb der Landschaft',
      'Notiz hinzufügen',
      'Kennung kopieren',
    ]);
    await user.click(screen.getByRole('menuitem', { name: 'Kennung kopieren' }));
    expect(await findToast('Kennung kopiert')).toBeDefined();
    expect(await navigator.clipboard.readText()).toBe('q-00000000000000a3');
  });

  it('hides every action from viewers and on the read-only demo', async () => {
    setup('/projects/demo/open-questions', { role: 'viewer' });
    expect(await rows()).toHaveLength(4);
    expect(screen.queryAllByTestId('question-actions')).toEqual([]);
    expect(screen.queryByRole('button', { name: /Antworten aus CSV übernehmen/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Für den Kunden exportieren …' })).toBeDefined();
    // the subjects stay links: reading is every role's
    expect(screen.getAllByTestId('question-subject').length).toBe(4);
    cleanup();
    setup('/projects/demo/open-questions', { role: 'owner', health: DEMO });
    expect(await rows()).toHaveLength(4);
    expect(screen.queryAllByTestId('question-actions')).toEqual([]);
    expect(screen.queryByRole('button', { name: /Antworten aus CSV übernehmen/ })).toBeNull();
  });

  it('answers a held relation in the note dialog: no kinds, the hint, the agents sentence, the live warning; the hold stays', async () => {
    const list = items.map((q) => ({ ...q }));
    const { calls, user } = setup('/projects/demo/open-questions', {
      list,
      routes: { ...noteRoutes(list), [`GET ${BASE}`]: listRoute(list) },
    });
    const [held] = await rows();
    const box = await openNote(user, held!);
    expect(within(box).getByRole('heading', { name: 'Antwort geben' })).toBeDefined();
    expect(within(box).getByTestId('note-question').textContent).toContain(items[0]!.text);
    // no answer kinds any more (M6 §4.8 b)
    expect(within(box).queryAllByRole('radio')).toEqual([]);
    expect(box.textContent).not.toContain('Antwortart');
    expect(within(box).getByTestId('note-hint').textContent).toBe(
      'Keine Namen oder anderen personenbezogenen Daten.',
    );
    // A hold's note is its answer: „Antwort“ throughout the dialog (UX2b review).
    expect(within(box).getByTestId('note-permanent').textContent).toBe(
      'Eine gespeicherte Antwort lässt sich nicht mehr ändern oder löschen.',
    );
    const effect = within(box).getByTestId('note-effect').textContent;
    expect(effect).toBe(
      'Die Antwort wird an der Relation gespeichert. Die Agenten berücksichtigen die Antwort, ' +
        'sobald sie diese Relation neu bewerten. Die Vormerkung bleibt, bis du sie entscheidest.',
    );
    expect(box.textContent).not.toMatch(/Notiz|Paar/);
    const save = within(box).getByRole('button', { name: 'Antwort speichern' });
    expect(save).toHaveProperty('disabled', true);

    const field = within(box).getByLabelText('Deine Antwort');
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

    expect((await findToast('Antwort gespeichert')).textContent).toContain(
      'Gespeichert an der Relation. Die Vormerkung bleibt, bis du sie entscheidest.',
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const post = calls.find((c) => c.method === 'POST' && c.path.endsWith('/answers'));
    expect(post?.path).toBe(`${BASE}/q-00000000000000a1/answers`);
    // the text only: the route takes no kind since S5c-1
    expect(post?.body).toEqual({ text: 'Die Buchhaltung verschickt sie.' });

    const [noted] = await rows();
    // an answer informs: the item stays open, the latest answer on the card
    await waitFor(() =>
      expect(within(noted!).getByTestId('question-note').textContent).toBe(
        'Antwort vom 16.10.2026: Die Buchhaltung verschickt sie.',
      ),
    );
    expect(noted!.dataset['state']).toBe('open');
    // one answer needs no „Verlauf“
    expect(within(noted!).queryByTestId('question-answers')).toBeNull();
    // answered, the decision is next: „Jetzt entscheiden“ leads, „Antwort ergänzen“ beside it,
    // and the focus goes back to the button that opened the dialog, now that one
    const actions = within(noted!).getAllByTestId('question-action');
    expect(actions.map((a) => [a.textContent, a.dataset['primary']])).toEqual([
      ['Jetzt entscheiden', 'true'],
      ['Antwort ergänzen', 'false'],
    ]);
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Antwort ergänzen'));
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
    const finding = await effect(all[1]!);
    expect(finding).toContain('ergänze es im Quellwerkzeug und importiere das Modell erneut');
    expect(finding).toContain('Die Frage bleibt offen; erledigt wird sie durch ihre Aktion.');
    expect(finding).not.toContain('Die Agenten berücksichtigen');
    expect(await effect(all[2]!)).toContain('Fehlt ein Modell, importiere es.');
    // A held placement homes its process: the note makes nothing due, the hold stays.
    const plc = await effect(all[4]!);
    expect(plc).toContain('Die Antwort wird an der Platzierung gespeichert');
    expect(plc).not.toContain('fällig');
    expect(plc).toContain(
      'Die Platzierung bleibt vorgemerkt, bis du sie entscheidest; solange bekommt kein Agent den Prozess.',
    );
    // its „Jetzt entscheiden“ opens the chain at the placement
    expect(
      within(all[4]!).getByRole('link', { name: 'Jetzt entscheiden' }).getAttribute('href'),
    ).toBe('/projects/demo/value-chain?placement=plc_01HELD');
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
    let box = await openNote(user, (await rows())[1]!);
    expect(within(box).getByRole('heading', { name: 'Notiz hinzufügen' })).toBeDefined();
    await user.type(within(box).getByLabelText('Deine Notiz'), 'Der Zahlungsdienst.');
    await user.click(within(box).getByRole('button', { name: 'Notiz speichern' }));
    expect((await within(box).findByTestId('note-error')).textContent).toContain(
      'Die Eingabe passt so nicht.',
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
    box = await openNote(user, (await rows())[1]!);
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
    const box = await openNote(user, (await rows())[3]!);
    await user.type(within(box).getByLabelText('Deine Notiz'), 'Ein externer Spediteur.');
    await user.click(within(box).getByRole('button', { name: 'Notiz speichern' }));
    expect((await findToast('Frage gibt es so nicht mehr')).textContent).toContain(
      'Die Quelle der Frage hat sich inzwischen geändert (dann hat die Frage eine neue Kennung)',
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows notes and withdrawn marks as plain text under „Verlauf“, and a marked item under „Erledigte zeigen“', async () => {
    const noted = openQuestion({
      ...items[2]!,
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
      ],
    });
    const marked = openQuestion({
      ...items[4]!,
      state: 'answered',
      answers: [
        openQuestionAnswer({
          id: 'oqa_04',
          questionId: items[4]!.id,
          kind: 'outside-landscape',
          role: 'outside-mark',
          text: 'Ein externer Spediteur.',
          seq: 25,
        }),
      ],
    });
    const list = items.map((q) => (q.id === noted.id ? noted : q.id === marked.id ? marked : q));
    const { user } = setup('/projects/demo/open-questions', { list });
    expect(await ids()).toEqual(['a1', 'a3', 'a4']);
    const row = (await rows())[1]!;
    expect(within(row).getByTestId('question-note').textContent).toBe(
      'Notiz vom 16.10.2026: Wird modelliert.',
    );
    const history = within(row).getByTestId('question-answers');
    expect(history.hasAttribute('open')).toBe(false);
    expect(history.querySelector('summary')?.textContent).toBe('Verlauf (3)');
    const answers = within(history).getAllByTestId('question-answer');
    expect(answers.map((a) => [a.dataset['role'], a.dataset['withdrawn']])).toEqual([
      ['note', 'false'],
      ['note', 'false'],
      ['outside-mark', 'true'],
    ]);
    expect(answers[0]!.querySelector('b')).toBeNull();
    expect(within(answers[0]!).getByTestId('question-answer-text').textContent).toBe(
      'Erst <b>so</b>',
    );
    expect(within(answers[2]!).getByTestId('question-answer-withdrawn').textContent).toContain(
      'zurückgenommen von owner',
    );
    // no event numbers, not even in a tooltip
    expect(history.innerHTML).not.toMatch(/Projektstand s\d/);

    // the marked item: one line under „Erledigte zeigen“, its mark taken back from there
    const done = await openGroup(user, 'open-questions-done');
    expect(done.querySelector('summary')?.textContent).toBe('Erledigte zeigen (1)');
    const line = within(done).getByTestId('open-question');
    expect(line.dataset['state']).toBe('answered');
    expect(line.textContent).toContain(
      'Außerhalb der Landschaft·Pool „Participant_Carrier“·Ein externer Spediteur.',
    );
    expect(within(line).getByTestId('question-withdraw-mark').textContent).toBe(
      'Markierung zurücknehmen',
    );
  });

  it('opens „Erledigte zeigen“ from a link with `state=answered`', async () => {
    const marked = openQuestion({ ...items[4]!, state: 'answered' });
    setup('/projects/demo/open-questions?state=answered', {
      list: items.map((q) => (q.id === marked.id ? marked : q)),
    });
    const done = await screen.findByTestId('open-questions-done');
    expect(done.hasAttribute('open')).toBe(true);
    expect(within(done).getByTestId('open-question').dataset['questionId']).toBe(marked.id);
  });

  it('adds a note in the model view’s „Fragen“ as well', async () => {
    const list = items.map((q) => ({ ...q }));
    const { calls, user } = setup('/projects/demo/models/a/order', {
      list,
      routes: { ...noteRoutes(list), [`GET ${BASE}`]: listRoute(list) },
    });
    const section = await screen.findByTestId('model-open-questions');
    await waitFor(() => expect(within(section).getAllByTestId('open-question')).toHaveLength(2));
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
          ?.querySelector('[data-testid=question-note]'),
      ).not.toBeNull(),
    );
  });

  it('hides the actions in the model view from viewers', async () => {
    setup('/projects/demo/models/a/order', { role: 'viewer' });
    const section = await screen.findByTestId('model-open-questions');
    await waitFor(() => expect(within(section).getAllByTestId('open-question')).toHaveLength(2));
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
    await user.click(screen.getByRole('button', { name: 'Antworten aus CSV übernehmen …' }));
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
    // the note leaves the held relation open; the old sheet's outside mark marks the call,
    // which leaves the cards for „Erledigte zeigen“
    await waitFor(async () => expect(await ids()).toEqual(['a1', 'a4', 'a5']));
    expect(within((await rows())[0]!).getByTestId('question-note').textContent).toContain(
      'Die Buchhaltung, max@example.com',
    );
    const done = await openGroup(user, 'open-questions-done');
    expect(within(done).getByTestId('open-question').dataset['questionId']).toBe(
      'q-00000000000000a3',
    );
  });

  it('says in the dialog that every filled answer becomes a note, without „Antwortart“', async () => {
    setup('/projects/demo/open-questions');
    await rows();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Antworten aus CSV übernehmen …' }));
    const box = await dialog();
    expect(box.textContent).toContain('in der die Spalte „Antwort“ ausgefüllt ist');
    expect(box.textContent).toContain('Jede Antwort wird als Notiz an ihrer Frage gespeichert');
    expect(box.textContent).toContain('Eine ältere Datei mit der Spalte „Antwortart“ geht auch');
  });

  it('refuses a file without the export’s columns before sending anything', async () => {
    const { calls, user } = setup('/projects/demo/open-questions');
    await rows();
    await user.click(screen.getByRole('button', { name: 'Antworten aus CSV übernehmen …' }));
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
    await user.click(screen.getByRole('button', { name: 'Antworten aus CSV übernehmen …' }));
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
    await user.click(screen.getByRole('button', { name: 'Antworten aus CSV übernehmen …' }));
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
    await user.click(screen.getByRole('button', { name: 'Antworten aus CSV übernehmen …' }));
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
    await user.click(screen.getByRole('button', { name: 'Antworten aus CSV übernehmen …' }));
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

import type { Placement, UnplacedProcess, ValueChainDetail } from '@analyzr/client';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/app';
import type {
  ChainCanvasHandle,
  ChainCanvasProps,
} from '../src/components/value-chain/chain-canvas-types';
import { getToasts } from '../src/lib/toast';
import { createAppRouter } from '../src/router';
import { chainDetail, impact, placement, step } from './support/fixtures';
import { json, stubApi, type Call } from './support/render';

// The renderer needs a real browser (e2e/value-chain*.spec.ts): a stand-in records what the page
// asks of the canvas and answers the imperative handle.
interface CanvasStub {
  props: ChainCanvasProps | null;
  text: string;
  undo: boolean;
  /** A change the real canvas would still be debouncing. */
  pending: boolean;
  /** Import warnings the next imports report. */
  warnings: number;
  /** Names of the elements on the canvas. */
  names: Record<string, string>;
  /** Ids of the elements on the canvas (`elementIds`). */
  ids: string[];
  /** What the page asked the canvas to change. */
  calls: unknown[][];
}
const canvas = vi.hoisted((): CanvasStub => ({
  props: null,
  text: '',
  undo: false,
  pending: false,
  warnings: 0,
  names: {},
  ids: [],
  calls: [],
}));
vi.mock('@/components/value-chain/canvas/chain-canvas', async () => {
  const React = await import('react');
  const handle: ChainCanvasHandle = {
    exportCanonical: () => canvas.text,
    emptyText: (name) =>
      `{"connections":[],"elements":[],"meta":{"name":${JSON.stringify(name)}},"schemaVersion":1}\n`,
    takePendingChange: () => {
      const was = canvas.pending;
      canvas.pending = false;
      return was;
    },
    undo: () => undefined,
    redo: () => undefined,
    canUndo: () => canvas.undo,
    canRedo: () => false,
    elementIds: () => canvas.ids,
    elementInfo: (id) =>
      id in canvas.names
        ? {
            id,
            type: 'step',
            name: canvas.names[id] ?? '',
            color: null,
            link: null,
            parentId: 's-vertrieb',
          }
        : null,
    setLink: (id, link) => void canvas.calls.push(['setLink', id, link]),
    setName: (id, name) => void canvas.calls.push(['setName', id, name]),
    setColor: () => undefined,
    chainName: () => 'Demo – Wertschöpfungskette',
    setChainName: () => undefined,
    saveSVG: () => '<svg/>',
    zoom: () => undefined,
    fit: () => undefined,
  };
  function Stub(props: ChainCanvasProps, ref: React.ForwardedRef<ChainCanvasHandle>) {
    canvas.props = props;
    React.useImperativeHandle(ref, () => handle);
    const { onImported } = props;
    const { key } = props.document;
    React.useEffect(() => {
      onImported({ key, warnings: canvas.warnings });
      // once per import, like the real canvas
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, props.mode]);
    return (
      <div
        data-testid="vc-canvas"
        data-mode={props.mode}
        data-key={key}
        data-selected={props.selectedId ?? ''}
        data-invalid={props.invalidIds.join(',')}
        data-overlays={props.overlays
          .flatMap((o) =>
            [o.badge?.text ?? '', ...o.findings].filter(Boolean).map((t) => `${o.elementId}:${t}`),
          )
          .join(',')}
      />
    );
  }
  return { default: React.forwardRef(Stub) };
});

/** Names of the elements on the stand-in canvas. */
const NAMES: Record<string, string> = { 's-auftrag': 'Auftrag (lokal)' };
canvas.names = { ...NAMES };

afterEach(() => {
  // edits leave drafts behind; the next test would be offered them
  localStorage.clear();
  canvas.props = null;
  canvas.text = '';
  canvas.undo = false;
  canvas.pending = false;
  canvas.warnings = 0;
  canvas.names = { ...NAMES };
  canvas.ids = [];
  canvas.calls = [];
});

const BASE = '/api/v1/projects/demo/value-chains/main';
const HEAD_TEXT = '{"connections":[],"elements":[],"meta":{"name":"Demo"},"schemaVersion":1}\n';
const EDITED = '{"connections":[],"elements":[],"meta":{"name":"Demo neu"},"schemaVersion":1}\n';

const steps = [
  step({ elementId: 's-vertrieb', name: 'Vertrieb', childIds: ['s-auftrag'] }),
  step({
    elementId: 's-auftrag',
    name: 'Auftrag',
    parentId: 's-vertrieb',
    path: ['Vertrieb', 'Auftrag'],
    counts: { accepted: 1, proposed: 1, held: 0 },
  }),
];
const placements: Placement[] = [
  placement({
    id: 'plc_open',
    elementId: 's-auftrag',
    stepName: 'Auftrag',
    process: 'v/order#P_Order',
  }),
  placement({
    id: 'plc_done',
    elementId: 's-auftrag',
    stepName: 'Auftrag',
    process: 'v/inv#P_Inv',
    status: 'accepted',
    confidence: 0.9,
  }),
  placement({
    id: 'plc_out',
    elementId: '@outside',
    process: 'v/archiv#P_Old',
    processName: 'Altes Verfahren',
    provenance: {
      ...placement({ id: 'x', elementId: 'x', process: 'a#b' }).provenance!,
      rationale: 'Archivkopie von v/order#P_Order.',
    },
  }),
];
const detail: ValueChainDetail = chainDetail({
  steps,
  placements,
  findings: [
    {
      kind: 'step-without-process',
      elementId: 's-vertrieb',
      process: null,
      link: null,
      state: null,
      calledFrom: [],
      detail: 'x',
    },
    {
      kind: 'process-without-step',
      elementId: null,
      process: 'v/order#P_Order',
      link: null,
      state: 'proposed',
      calledFrom: [],
      detail: 'x',
    },
  ],
});
const unplaced: UnplacedProcess[] = [
  {
    process: 'v/ship#P_Ship',
    name: 'Versand',
    modelKey: 'v/ship',
    lanes: [],
    starts: [],
    ends: [],
    neighbours: [],
    calls: { out: [], in: [] },
    hints: [{ step: 's-auftrag', name: 'Auftrag', score: 3 }],
  },
];

function content(text: string, rev: number): Response {
  return new Response(text, {
    status: 200,
    headers: { 'content-type': 'application/json', etag: `"r${rev}"` },
  });
}

interface Setup {
  role?: 'owner' | 'viewer';
  chain?: ValueChainDetail | null;
  routes?: Record<string, (call: Call) => Response | Promise<Response>>;
}

function setup(path: string, { role = 'owner', chain = detail, routes = {} }: Setup = {}) {
  const state = { chain, head: { text: HEAD_TEXT, rev: chain?.valueChain.headRev ?? 0 } };
  const calls = stubApi({
    'GET /api/v1/projects/demo': () =>
      json({
        id: 'prj_01DEMO',
        key: 'demo',
        name: 'Demo',
        role,
        lastSeq: 1,
        createdAt: '2026-10-07T09:00:00.000Z',
      }),
    'GET /api/v1/projects/demo/models': () => json({ items: [], nextCursor: null }),
    'GET /api/v1/projects/demo/landscape': () =>
      json({ projectId: 'prj_01DEMO', seq: 1, models: [], relations: [], findings: [] }),
    [`GET ${BASE}`]: () =>
      state.chain
        ? json(state.chain)
        : json(
            {
              type: 'urn:analyzr:problem:not-found',
              title: 'Not Found',
              status: 404,
              code: 'not-found',
            },
            404,
          ),
    [`GET ${BASE}/content`]: () => content(state.head.text, state.head.rev),
    [`GET ${BASE}/placements`]: () => json({ items: placements, nextCursor: null }),
    [`GET ${BASE}/unplaced-processes`]: () => json({ items: unplaced, nextCursor: null }),
    [`GET ${BASE}/revisions`]: () =>
      json({
        items: [
          {
            id: 'vcr_01HEAD',
            rev: 3,
            contentHash: 'a'.repeat(64),
            structureHash: 'b'.repeat(64),
            schemaVersion: 1,
            baseRevisionId: null,
            principalId: 'prn_01OWNER',
            handle: 'owner',
            seq: 7,
            createdAt: '2026-10-09T08:00:00.000Z',
          },
        ],
        nextCursor: null,
      }),
    [`GET ${BASE}/steps/s-auftrag`]: () =>
      json({
        step: steps[1],
        breadcrumb: [],
        children: [],
        placements: { own: [], subtree: [], reachedByCall: [] },
      }),
    ...routes,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<App queryClient={queryClient} router={router} />);
  return { calls, state, router, user: userEvent.setup() };
}

const stub = () => screen.getByTestId('vc-canvas');

describe('value chain page', () => {
  it('shows the empty state with the CLI command; creating runs the dry run, then PUT If-None-Match: *', async () => {
    const created = { ...detail, valueChain: { ...detail.valueChain, headRev: 1 } };
    const { calls, state, user } = setup('/projects/demo/value-chain', {
      chain: null,
      routes: {
        [`PUT ${BASE}/content`]: (call) => {
          const dryRun = call.search === '?dryRun=true';
          if (!dryRun) {
            state.chain = created;
            state.head = { text: EDITED, rev: 1 };
          }
          return json(
            {
              dryRun,
              outcome: 'created',
              valueChain: dryRun ? null : created.valueChain,
              revision: null,
              impact: {
                structureChanged: true,
                steps: { added: [], removed: [], changed: [] },
                placements: { stranded: 0, toReconfirm: 0, proposalsWithdrawn: 0 },
              },
            },
            dryRun ? 200 : 201,
          );
        },
      },
    });
    const empty = await screen.findByTestId('empty-chain');
    expect(within(empty).getByTestId('code-block').textContent).toBe(
      'analyzr value-chain push kette.vc.json -p demo',
    );
    await user.click(within(empty).getByRole('button', { name: /Wertschöpfungskette anlegen/ }));
    await waitFor(() => expect(stub().dataset['mode']).toBe('edit'));
    expect(canvas.props?.document.text).toBeNull();
    // the user draws something
    canvas.text = EDITED;
    canvas.undo = true;
    act(() => canvas.props?.onChange());
    expect(await screen.findByTestId('unsaved')).toBeTruthy();
    await user.click(screen.getByTestId('save-chain'));
    await waitFor(() => expect(screen.getByTestId('chain-rev').textContent).toBe('r1'));
    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts.map((c) => [c.search, c.headers['if-none-match'], c.headers['if-match']])).toEqual([
      ['?dryRun=true', '*', undefined],
      ['', '*', undefined],
    ]);
    // no POST: nothing stored before the first save, no empty revision 1
    expect(calls.filter((c) => c.method === 'POST' && c.path.includes('value-chains'))).toEqual([]);
    expect(screen.queryByTestId('unsaved')).toBeNull();
  });

  it('shows the overview: coverage, „Platzierungen prüfen“, „Zu prüfen“, „Ohne Schritt“, the closed tree and @outside (UX6)', async () => {
    const { user } = setup('/projects/demo/value-chain');
    const overview = await screen.findByTestId('chain-overview');
    // P_Inv is homed; P_Order and P_Old are proposed, P_Ship has nothing
    await waitFor(() =>
      expect(screen.getByTestId('chain-summary').textContent).toBe(
        '1 von 4 Prozessen platziert · 2 Vorschläge offen',
      ),
    );
    expect(screen.getByTestId('review-placements').textContent).toBe('Platzierungen prüfen (2)J');
    const rows = within(overview).getAllByTestId('open-placement');
    expect(rows.map((i) => i.dataset['placementId'])).toEqual(['plc_open', 'plc_out']);
    // a plain proposal carries no marker
    expect(rows.map((r) => r.textContent)).toEqual([
      'P_OrderAuftrag',
      'Altes VerfahrenAußerhalb der Kette',
    ]);
    // the gaps stay answerable in „Offene Fragen“; only unresolvable links are listed here
    expect(within(overview).queryAllByTestId('chain-finding')).toEqual([]);
    expect(within(overview).queryByRole('region', { name: 'Befunde' })).toBeNull();
    const without = within(overview).getByRole('region', { name: 'Ohne Schritt' });
    expect((await within(without).findByTestId('unplaced-process')).textContent).toContain(
      'Versand',
    );
    // the tree: closed, its top-level rows collapsed with their roll-ups
    const tree = screen.getByTestId<HTMLDetailsElement>('step-tree');
    expect(tree.open).toBe(false);
    expect(
      within(overview)
        .getAllByTestId('step-tree-item')
        .map((i) => [i.dataset['elementId'], i.getAttribute('aria-expanded'), i.textContent]),
    ).toEqual([['s-vertrieb', 'false', 'Vertrieb1 Prozess1 offen']]);
    expect(within(overview).getByLabelText('Außerhalb der Kette').textContent).toContain(
      'Archivkopie von v/order#P_Order.',
    );
    // badges on the canvas; „nichts angenommen“ not on Vertrieb, whose sub-step waits for a decision
    await waitFor(() => expect(stub().dataset['overlays']).toBe('s-auftrag:1 Prozess · 1 offen'));
    // the header: the project as the way back, the revision behind the chain's name
    const header = screen.getByTestId('chain-header');
    expect(within(header).getByTestId('canvas-back').getAttribute('href')).toBe('/projects/demo');
    expect(within(header).queryByText(/gespeichert von/)).toBeNull();
    await user.click(within(header).getByTestId('chain-revision'));
    // the time in the runner's zone (CI runs in UTC)
    expect((await screen.findByTestId('chain-revision-text')).textContent).toMatch(
      /^Revision 3 · gespeichert von owner · 09\.10\.2026, \d\d:00$/,
    );
    expect(screen.getByTestId('unplaced-chip').textContent).toBe('1 Prozess ohne Schritt');
    await user.click(within(header).getByTestId('chain-export'));
    expect(
      within(screen.getByTestId('chain-export-menu'))
        .getAllByRole('menuitem')
        .map((m) => m.textContent),
    ).toEqual(['Datei (.vc.json)', 'Bild (SVG)']);
  });

  it('labels „nichts angenommen“ only on steps whose subtree waits for nothing (UX6)', async () => {
    const lager = step({ elementId: 's-lager', name: 'Lager' });
    setup('/projects/demo/value-chain', {
      chain: chainDetail({
        ...detail,
        steps: [...steps, lager],
        placements,
        findings: [
          ...detail.findings,
          {
            kind: 'step-without-process',
            elementId: 's-lager',
            process: null,
            link: null,
            state: null,
            calledFrom: [],
            detail: 'x',
          },
        ],
      }),
    });
    await waitFor(() =>
      expect(stub().dataset['overlays']).toBe(
        's-auftrag:1 Prozess · 1 offen,s-lager:nichts angenommen',
      ),
    );
  });

  it('scrolls to „Ohne Schritt“ from the header’s chip, from a step too, once per click', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    const { router, user } = setup('/projects/demo/value-chain?step=s-auftrag');
    await screen.findByTestId('step-panel');
    await user.click(await screen.findByTestId('unplaced-chip'));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    const section = await screen.findByRole('region', { name: 'Ohne Schritt' });
    await waitFor(() => expect(scroll.mock.contexts).toContain(section));
    const times = () =>
      scroll.mock.contexts.filter(
        (c) => c instanceof Element && c.getAttribute('aria-label') === 'Ohne Schritt',
      ).length;
    const once = times();
    // back from a step later: no scroll of its own
    await user.click(within(section).getByRole('button', { name: 'Auftrag' }));
    await user.click(await screen.findByTestId('panel-back'));
    await screen.findByRole('region', { name: 'Ohne Schritt' });
    expect(times()).toBe(once);
  });

  it('starts the review at the first open placement („Platzierungen prüfen“, J)', async () => {
    const { router, user } = setup('/projects/demo/value-chain');
    await user.click(await screen.findByTestId('review-placements'));
    await waitFor(() => expect(router.state.location.search).toEqual({ placement: 'plc_open' }));
  });

  it('selects the placement and its step from ?placement=, the step from ?step=', async () => {
    setup('/projects/demo/value-chain?placement=plc_done');
    const card = await screen.findByText('P_Inv');
    await waitFor(() => expect(stub().dataset['selected']).toBe('s-auftrag'));
    const active = card.closest('[data-testid=placement-card]') as HTMLElement;
    expect(active.dataset['active']).toBe('true');
    expect(screen.getByTestId('step-panel').dataset['elementId']).toBe('s-auftrag');
  });

  it('opens a step from ?step= with the first open placement active', async () => {
    setup('/projects/demo/value-chain?step=s-auftrag');
    await waitFor(() => expect(stub().dataset['selected']).toBe('s-auftrag'));
    const cards = await screen.findAllByTestId('placement-card');
    expect(cards.map((c) => [c.dataset['placementId'], c.dataset['active']])).toEqual([
      ['plc_open', 'true'],
      ['plc_done', 'false'],
    ]);
    expect(screen.getByTestId('queue-position').textContent).toBe('1 von 2 offen');
  });

  it('gives viewers a read-only page: no edit, no decisions, no manual placement', async () => {
    setup('/projects/demo/value-chain?step=s-auftrag', { role: 'viewer' });
    await screen.findAllByTestId('placement-card');
    expect(screen.queryByTestId('edit-chain')).toBeNull();
    expect(screen.queryByTestId('placement-decision')).toBeNull();
    expect(screen.queryByTestId('add-process')).toBeNull();
  });

  it('counts the open placements on the chain’s tab, not in the inbox (UX5)', async () => {
    setup('/projects/demo/review');
    await screen.findByRole('navigation', { name: 'Ansichten' });
    expect(screen.queryByTestId('placements-callout')).toBeNull();
    const tabs = within(screen.getByRole('navigation', { name: 'Projektbereiche' }));
    await waitFor(() =>
      expect(tabs.getByRole('link', { name: /^Wertschöpfungskette/ }).textContent).toBe(
        'Wertschöpfungskette2 Platzierungen zu prüfen',
      ),
    );
  });

  it('offers a draft on the current head for restore, one on an older base for download', async () => {
    localStorage.setItem(
      'analyzr:vc-draft:demo:vch_01DEMO:r3',
      JSON.stringify({ text: '{"draft":true}', savedAt: '2026-10-09T09:00:00.000Z' }),
    );
    const { user } = setup('/projects/demo/value-chain');
    await user.click(await screen.findByTestId('edit-chain'));
    const dialog = await screen.findByTestId('draft-dialog');
    expect(dialog.textContent).toContain('Ungespeicherter Entwurf gefunden');
    await user.click(within(dialog).getByRole('button', { name: 'Entwurf wiederherstellen' }));
    await waitFor(() => expect(canvas.props?.document.text).toBe('{"draft":true}'));
    expect(stub().dataset['mode']).toBe('edit');
  });

  it('only lets an older draft be downloaded or discarded', async () => {
    localStorage.setItem(
      'analyzr:vc-draft:demo:vch_01DEMO:r2',
      JSON.stringify({ text: '{"old":true}', savedAt: '2026-10-08T09:00:00.000Z' }),
    );
    const { user } = setup('/projects/demo/value-chain');
    await user.click(await screen.findByTestId('edit-chain'));
    const dialog = await screen.findByTestId('draft-dialog');
    expect(dialog.textContent).toContain('beruht auf r2, inzwischen gibt es r3');
    expect(within(dialog).queryByRole('button', { name: 'Entwurf wiederherstellen' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Verwerfen' }));
    expect(localStorage.getItem('analyzr:vc-draft:demo:vch_01DEMO:r2')).toBeNull();
    expect(canvas.props?.document.text).toBe(HEAD_TEXT);
  });

  it('lists the violations of a refused save, marks and selects the element', async () => {
    const { router, user } = setup('/projects/demo/value-chain', {
      routes: {
        [`PUT ${BASE}/content`]: () =>
          json(
            {
              type: 'urn:analyzr:problem:value-chain-invalid',
              title: 'Invalid',
              status: 422,
              code: 'value-chain-invalid',
              violations: [
                {
                  reason: 'hierarchy-too-deep',
                  elementId: 's-auftrag',
                  connectionId: null,
                  path: null,
                  detail: 'x',
                },
              ],
              truncated: false,
            },
            422,
          ),
      },
    });
    await user.click(await screen.findByTestId('edit-chain'));
    await waitFor(() => expect(stub().dataset['mode']).toBe('edit'));
    canvas.text = EDITED;
    act(() => canvas.props?.onChange());
    await user.click(await screen.findByTestId('save-chain'));
    const panel = await screen.findByTestId('violations-panel');
    expect(within(panel).getByTestId('violation').textContent).toBe(
      'Zu tief geschachtelt: höchstens zwei Ebenen unter der obersten. „Auftrag (lokal)“ (s-auftrag)',
    );
    expect(stub().dataset['invalid']).toBe('s-auftrag');
    await user.click(within(panel).getByRole('button', { name: /Auftrag \(lokal\)/ }));
    await waitFor(() => expect(router.state.location.search).toEqual({ step: 's-auftrag' }));
    await user.click(within(panel).getByRole('button', { name: 'Schließen' }));
    expect(screen.queryByTestId('violations-panel')).toBeNull();
    expect(stub().dataset['invalid']).toBe('');
  });

  it('on a 412 downloads the local copy, then loads the newer revision; or keeps editing', async () => {
    const createObjectURL = vi.fn(() => 'blob:analyzr');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const { state, user } = setup('/projects/demo/value-chain', {
      routes: {
        [`PUT ${BASE}/content`]: () =>
          json(
            {
              type: 'urn:analyzr:problem:revision-conflict',
              title: 'Revision conflict',
              status: 412,
              code: 'revision-conflict',
              headRev: 5,
              etag: '"r5"',
            },
            412,
          ),
      },
    });
    await user.click(await screen.findByTestId('edit-chain'));
    await waitFor(() => expect(stub().dataset['mode']).toBe('edit'));
    canvas.text = EDITED;
    act(() => canvas.props?.onChange());
    await screen.findByTestId('unsaved');

    // keep editing: the dialog closes, nothing changes
    await user.click(screen.getByTestId('save-chain'));
    const dialog = await screen.findByTestId('conflict-dialog');
    expect(dialog.textContent).toContain('Inzwischen wurde r5 gespeichert, du hast r3 bearbeitet.');
    await user.click(within(dialog).getByRole('button', { name: 'Weiter bearbeiten' }));
    await waitFor(() => expect(screen.queryByTestId('conflict-dialog')).toBeNull());
    expect(stub().dataset['mode']).toBe('edit');
    expect(createObjectURL).not.toHaveBeenCalled();

    // load the newer one: the local copy downloads first
    await user.click(screen.getByTestId('save-chain'));
    const again = await screen.findByTestId('conflict-dialog');
    state.head = { text: '{"newer":true}', rev: 5 };
    state.chain = { ...detail, valueChain: { ...detail.valueChain, headRev: 5 } };
    const keyBefore = stub().dataset['key'];
    await user.click(within(again).getByRole('button', { name: /Neuere Revision laden/ }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('demo-r3-entwurf.vc.json');
    await waitFor(() => expect(screen.getByTestId('chain-rev').textContent).toBe('r5'));
    expect(stub().dataset['key']).not.toBe(keyBefore);
    expect(canvas.props?.document.text).toBe('{"newer":true}');
    expect(stub().dataset['mode']).toBe('edit');
  });
});

const EMPTY_NAME = 'Demo – Wertschöpfungskette';
const emptyText = (name: string) =>
  `{"connections":[],"elements":[],"meta":{"name":${JSON.stringify(name)}},"schemaVersion":1}\n`;
const EDITED_2 =
  '{"connections":[],"elements":[],"meta":{"name":"Demo neuer"},"schemaVersion":1}\n';
const SAVED_AT = '2026-10-09T09:00:00.000Z';
const draftKey = (chain: string, rev: number) => `analyzr:vc-draft:demo:${chain}:r${rev}`;

/** A save answer (dry run or save) with no placement impact. */
function saveAnswer(dryRun: boolean, headRev: number) {
  return json({
    dryRun,
    outcome: 'revised',
    valueChain: { ...detail.valueChain, headRev },
    revision: null,
    impact: impact(),
  });
}

async function editMode(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByTestId('edit-chain'));
  await waitFor(() => expect(stub().dataset['mode']).toBe('edit'));
}

/** An edit the canvas has reported (debounced in the real one). */
function edit(text: string) {
  canvas.text = text;
  act(() => canvas.props?.onChange());
}

describe('value chain page: drafts and unsaved changes', () => {
  it('keeps a restored draft of a new chain dirty and stored until the drawing is empty again', async () => {
    const DRAFT = `{"connections":[],"elements":[],"meta":{"name":"Neue Kette"},"schemaVersion":1}\n`;
    localStorage.setItem(draftKey('new', 0), JSON.stringify({ text: DRAFT, savedAt: SAVED_AT }));
    const { user } = setup('/projects/demo/value-chain', { chain: null });
    await user.click(await screen.findByTestId('create-chain'));
    const dialog = await screen.findByTestId('draft-dialog');
    expect(dialog.textContent).toContain('eine neue Kette gezeichnet und nicht gespeichert');
    await user.click(within(dialog).getByRole('button', { name: 'Entwurf wiederherstellen' }));
    await waitFor(() => expect(canvas.props?.document.text).toBe(DRAFT));
    expect(await screen.findByTestId('unsaved')).toBeTruthy();
    // a later change back to the restored drawing (an undo): still unsaved, the draft stays
    edit(DRAFT);
    expect(screen.getByTestId('unsaved')).toBeTruthy();
    expect(localStorage.getItem(draftKey('new', 0))).not.toBeNull();
    // back to the empty chain: nothing to save, no draft
    edit(emptyText(EMPTY_NAME));
    await waitFor(() => expect(screen.queryByTestId('unsaved')).toBeNull());
    expect(localStorage.getItem(draftKey('new', 0))).toBeNull();
  });

  it('asks for an explicit choice about a draft: focus on restore, Escape stays, nothing cleared meanwhile', async () => {
    localStorage.setItem(
      draftKey('vch_01DEMO', 3),
      JSON.stringify({ text: EDITED, savedAt: SAVED_AT }),
    );
    const { user } = setup('/projects/demo/value-chain');
    await user.click(await screen.findByTestId('edit-chain'));
    const dialog = await screen.findByTestId('draft-dialog');
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe('Entwurf wiederherstellen'),
    );
    // a change event while the dialog asks leaves the stored draft alone
    edit(HEAD_TEXT);
    expect(localStorage.getItem(draftKey('vch_01DEMO', 3))).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(screen.getByTestId('draft-dialog')).toBe(dialog);
    // Enter takes the focused, safe action
    await user.keyboard('{Enter}');
    await waitFor(() => expect(canvas.props?.document.text).toBe(EDITED));
    expect(screen.queryByTestId('draft-dialog')).toBeNull();
    expect(localStorage.getItem(draftKey('vch_01DEMO', 3))).not.toBeNull();
  });

  it('asks before „Fertig“ when the click itself committed an edit the canvas has not reported yet', async () => {
    const { user } = setup('/projects/demo/value-chain');
    await editMode(user);
    canvas.text = EDITED;
    canvas.pending = true;
    await user.click(screen.getByTestId('finish-edit'));
    const dialog = await screen.findByTestId('discard-dialog');
    expect(dialog.textContent).toContain('Bearbeitung beenden?');
    expect(JSON.parse(localStorage.getItem(draftKey('vch_01DEMO', 3)) ?? '{}')).toMatchObject({
      text: EDITED,
    });
    // Escape keeps editing
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('discard-dialog')).toBeNull());
    expect(stub().dataset['mode']).toBe('edit');
  });

  it('asks before leaving through a link when an edit is still on its way from the canvas', async () => {
    const { router, user } = setup('/projects/demo/value-chain');
    await editMode(user);
    canvas.text = EDITED;
    canvas.pending = true;
    await user.click(screen.getByTestId('canvas-back'));
    const dialog = await screen.findByTestId('discard-dialog');
    expect(dialog.textContent).toContain('Seite verlassen?');
    expect(router.state.location.pathname).toBe('/projects/demo/value-chain');
    await user.click(within(dialog).getByRole('button', { name: 'Weiter bearbeiten' }));
    await waitFor(() => expect(screen.queryByTestId('discard-dialog')).toBeNull());
    expect(router.state.location.pathname).toBe('/projects/demo/value-chain');
  });

  it('keeps an edit made while the save ran unsaved, as a draft on the new base', async () => {
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { user, state } = setup('/projects/demo/value-chain', {
      routes: {
        [`PUT ${BASE}/content`]: async (call) => {
          const dryRun = call.search === '?dryRun=true';
          if (dryRun) await gate;
          else state.head = { text: EDITED, rev: 4 };
          return saveAnswer(dryRun, dryRun ? 3 : 4);
        },
      },
    });
    await editMode(user);
    edit(EDITED);
    await user.click(screen.getByTestId('save-chain'));
    // while the dry run is on its way
    edit(EDITED_2);
    release();
    await waitFor(() => expect(screen.getByTestId('chain-rev').textContent).toBe('r4'));
    expect(screen.getByTestId('unsaved')).toBeTruthy();
    expect(localStorage.getItem(draftKey('vch_01DEMO', 3))).toBeNull();
    expect(JSON.parse(localStorage.getItem(draftKey('vch_01DEMO', 4)) ?? '{}')).toMatchObject({
      text: EDITED_2,
    });
  });

  it('never opens the impact dialog for a save that needs no confirmation, however long it runs', async () => {
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { calls, user } = setup('/projects/demo/value-chain', {
      routes: {
        [`PUT ${BASE}/content`]: async (call) => {
          const dryRun = call.search === '?dryRun=true';
          if (!dryRun) await gate;
          return saveAnswer(dryRun, dryRun ? 3 : 4);
        },
      },
    });
    await editMode(user);
    edit(EDITED);
    await user.click(screen.getByTestId('save-chain'));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2));
    expect(screen.queryByTestId('impact-dialog')).toBeNull();
    release();
    await waitFor(() => expect(screen.getByTestId('chain-rev').textContent).toBe('r4'));
    expect(screen.queryByTestId('impact-dialog')).toBeNull();
    expect(screen.queryByTestId('unsaved')).toBeNull();
  });
});

describe('value chain page: keyboard and focus', () => {
  it('goes back from a step to the overview by button or Escape, focusing that step in the tree', async () => {
    const { router, user } = setup('/projects/demo/value-chain?step=s-auftrag');
    const panel = await screen.findByTestId('step-panel');
    // the path segments select the parent step
    await user.click(within(panel).getByRole('button', { name: 'Vertrieb' }));
    await waitFor(() => expect(router.state.location.search).toEqual({ step: 's-vertrieb' }));
    await user.click(await screen.findByTestId('panel-back'));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    // the closed tree opens to give the focus back
    const items = await screen.findAllByTestId('step-tree-item');
    expect(screen.getByTestId<HTMLDetailsElement>('step-tree').open).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    expect(items.map((i) => i.tabIndex)).toEqual([0]);
    // Enter opens it again; Escape in the panel goes back
    await user.keyboard('{Enter}');
    const again = await screen.findByTestId('step-panel');
    within(again).getByTestId('panel-back').focus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(router.state.location.search).toEqual({}));
  });

  it('makes the step tree one tab stop: arrows, Home, End; right opens, then to a child; left closes, then to the parent', async () => {
    const { user } = setup('/projects/demo/value-chain');
    await user.click(await screen.findByText('Schritte'));
    const item = (id: string) =>
      screen
        .getAllByTestId('step-tree-item')
        .find((i) => i.dataset['elementId'] === id) as HTMLElement;
    expect(screen.getAllByTestId('step-tree-item')).toHaveLength(1);
    expect(item('s-vertrieb').getAttribute('aria-expanded')).toBe('false');
    item('s-vertrieb').focus();
    await user.keyboard('{ArrowRight}');
    expect(item('s-vertrieb').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByTestId('step-tree-item').map((i) => i.tabIndex)).toEqual([0, -1]);
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(item('s-auftrag'));
    expect(screen.getAllByTestId('step-tree-item').map((i) => i.tabIndex)).toEqual([-1, 0]);
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(item('s-vertrieb'));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(item('s-auftrag'));
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(item('s-vertrieb'));
    // "offen" in the tree counts like the canvas badge, a parent sums its subtree
    expect(item('s-auftrag').textContent).toBe('Auftrag1 Prozess1 offen');
    expect(item('s-vertrieb').textContent).toBe('Vertrieb1 Prozess1 offen');
    await user.keyboard('{ArrowLeft}');
    expect(item('s-vertrieb').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAllByTestId('step-tree-item')).toHaveLength(1);
    // the chevron opens it too; the row itself selects the step
    await user.click(screen.getByTestId('step-tree-toggle'));
    expect(screen.getAllByTestId('step-tree-item')).toHaveLength(2);
  });

  it('scrolls the active card into view (an @outside placement far down the overview)', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    setup('/projects/demo/value-chain?placement=plc_out');
    const card = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(
        '[data-testid=placement-card][data-placement-id=plc_out]',
      );
      if (!found) throw new Error('no card');
      return found;
    });
    expect(card.dataset['active']).toBe('true');
    expect(scroll.mock.contexts).toContain(card);
    // its section leads the overview, so sections that load later cannot push it away
    expect(
      screen.getByTestId('chain-overview').querySelector('section')?.getAttribute('aria-label'),
    ).toBe('Außerhalb der Kette');
  });

  it('shows key hints only where the keys work', async () => {
    const { user } = setup('/projects/demo/value-chain?step=s-auftrag');
    const active = () =>
      screen
        .getAllByTestId('placement-card')
        .find((c) => c.dataset['active'] === 'true') as HTMLElement;
    await waitFor(() => expect(active()).toBeTruthy());
    expect(within(active()).getByText('R')).toBeTruthy();
    // edit mode: the keys work only while the panel has the focus
    await editMode(user);
    await waitFor(() => expect(within(active()).queryByText('R')).toBeNull());
    // a click on the card focuses it: the panel takes the keys from the canvas
    await user.click(within(active()).getByText('Passt fachlich.'));
    await waitFor(() => expect(within(active()).getByText('R')).toBeTruthy());
  });

  it('gives viewers „Platzierungen prüfen“ with J, the cards without decisions', async () => {
    const { user } = setup('/projects/demo/value-chain', { role: 'viewer' });
    await user.click(await screen.findByTestId('review-placements'));
    const cards = await screen.findAllByTestId('placement-card');
    expect(cards.find((c) => c.dataset['active'] === 'true')?.dataset['placementId']).toBe(
      'plc_open',
    );
    expect(screen.queryByTestId('placement-decision')).toBeNull();
  });

  it('keeps the focus in the name field after Enter and when the canvas echoes the name', async () => {
    const { user } = setup('/projects/demo/value-chain?step=s-auftrag');
    await editMode(user);
    const field = await screen.findByLabelText<HTMLInputElement>('Name');
    await user.clear(field);
    await user.type(field, 'Auftrag neu{Enter}');
    expect(canvas.calls).toEqual([['setName', 's-auftrag', 'Auftrag neu']]);
    expect(document.activeElement).toBe(field);
    // the canvas reports the change: the same field, still focused
    canvas.names['s-auftrag'] = 'Auftrag neu';
    edit(EDITED);
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe('Auftrag neu');
    // Escape in the field restores it and stays in the panel
    await user.type(field, ' x');
    await user.keyboard('{Escape}');
    expect(field.value).toBe('Auftrag neu');
    expect(screen.getByTestId('step-panel')).toBeTruthy();
    // leaving the field applies nothing twice
    await user.tab();
    expect(canvas.calls).toHaveLength(1);
  });

  it('moves the focus into "Prozess hinzufügen" and back to its button', async () => {
    const { user } = setup('/projects/demo/value-chain?step=s-auftrag');
    await user.click(await screen.findByTestId('add-process'));
    const form = screen.getByTestId('manual-placement-form');
    expect(document.activeElement).toBe(within(form).getByLabelText(/Prozess für .* suchen/));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('add-process')));
    expect(screen.getByTestId('step-panel')).toBeTruthy();
  });

  it('shows import warnings in the panel, where they can be closed', async () => {
    canvas.warnings = 2;
    const { user } = setup('/projects/demo/value-chain');
    const alert = await screen.findByTestId('import-warnings');
    expect(alert.closest('aside')).not.toBeNull();
    expect(alert.textContent).toContain('2 Elemente übersprungen');
    await user.click(within(alert).getByRole('button', { name: 'Hinweis schließen' }));
    expect(screen.queryByTestId('import-warnings')).toBeNull();
  });
});

describe('value chain page: import (M4 §3.3)', () => {
  /** An invented draft as an agent writes it: rough waypoints, no links. */
  const DRAFT = JSON.stringify({
    schemaVersion: 1,
    meta: { name: 'Musterhochschule – Wertschöpfungskette' },
    elements: [
      {
        id: 'step-a',
        elementType: 'step',
        name: 'Bewerbung',
        bounds: { x: 0, y: 0, width: 160, height: 60 },
      },
      {
        id: 'step-b',
        elementType: 'step',
        name: 'Studium',
        bounds: { x: 300, y: 0, width: 160, height: 60 },
      },
    ],
    connections: [
      {
        id: 'seq-a-b',
        connectionType: 'sequence',
        source: 'step-a',
        target: 'step-b',
        waypoints: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      },
    ],
  });
  const file = (text: string, name = 'entwurf.vc.json') =>
    new File([text], name, { type: 'application/json' });
  const lastToast = () => getToasts().at(-1);

  async function editing() {
    const ctx = setup('/projects/demo/value-chain');
    await waitFor(() => expect(stub().dataset['key']).toBe('view:r3'));
    await ctx.user.click(screen.getByTestId('edit-chain'));
    await waitFor(() => expect(stub().dataset['mode']).toBe('edit'));
    return ctx;
  }

  it('offers the import to reviewers in edit mode and on the empty state, never to viewers', async () => {
    const { user } = setup('/projects/demo/value-chain');
    await waitFor(() => expect(stub().dataset['key']).toBe('view:r3'));
    // View mode: no import (edit first).
    expect(screen.queryByTestId('import-chain')).toBeNull();
    await user.click(screen.getByTestId('edit-chain'));
    expect(await screen.findByTestId('import-chain')).toBeTruthy();
    const input = screen.getByTestId('import-file');
    expect(input.getAttribute('accept')).toBe('.vc.json,application/json');
  });

  it('shows the empty state with „Importieren“ for editors only', async () => {
    setup('/projects/demo/value-chain', { chain: null });
    const empty = await screen.findByTestId('empty-chain');
    expect(within(empty).getByRole('button', { name: /Importieren/ })).toBeTruthy();
    expect(within(empty).getByRole('button', { name: /Wertschöpfungskette anlegen/ })).toBeTruthy();
  });

  it('gives viewers no import', async () => {
    setup('/projects/demo/value-chain', { role: 'viewer', chain: null });
    const empty = await screen.findByTestId('empty-chain');
    expect(within(empty).queryByRole('button', { name: /Importieren/ })).toBeNull();
    expect(screen.queryByTestId('import-file')).toBeNull();
  });

  it('refuses files in German: not JSON, too large, a schema violation, a newer format', async () => {
    const { user } = await editing();
    const input = screen.getByTestId('import-file');
    const key = stub().dataset['key'];
    await user.upload(input, file('kein json', 'kaputt.vc.json'));
    await waitFor(() =>
      expect(lastToast()?.description).toBe(
        '„kaputt.vc.json“ ist keine JSON-Datei. Wähle eine .vc.json-Datei.',
      ),
    );
    expect(lastToast()).toMatchObject({ tone: 'danger', title: 'Import nicht möglich' });
    await user.upload(input, file(' '.repeat(2 * 1024 * 1024 + 1), 'riesig.vc.json'));
    await waitFor(() =>
      expect(lastToast()?.description).toMatch(/^„riesig\.vc\.json“ ist größer als 2 MB/),
    );
    await user.upload(
      input,
      file(
        JSON.stringify({
          schemaVersion: 1,
          meta: { name: 'X' },
          elements: [{ id: 'a' }],
          connections: [],
        }),
      ),
    );
    await waitFor(() =>
      expect(lastToast()?.description).toMatch(
        /^„entwurf\.vc\.json“ ist keine gültige Wertschöpfungskette \(Feld „elements\.0\.elementType“\): /,
      ),
    );
    const duplicate = JSON.parse(DRAFT) as { elements: { id: string }[] };
    duplicate.elements[1]!.id = 'step-a';
    await user.upload(input, file(JSON.stringify(duplicate)));
    await waitFor(() =>
      expect(lastToast()?.description).toMatch(
        /keine gültige Wertschöpfungskette: Duplicate id "step-a"/,
      ),
    );
    await user.upload(input, file(JSON.stringify({ ...JSON.parse(DRAFT), schemaVersion: 2 })));
    await waitFor(() =>
      expect(lastToast()?.description).toBe(
        '„entwurf.vc.json“ hat die Formatversion 2; analyzr kennt höchstens 1. Exportiere die Kette im älteren Format oder aktualisiere analyzr.',
      ),
    );
    // Nothing was imported.
    expect(stub().dataset['key']).toBe(key);
  });

  it('imports into an empty drawing at once: re-laid out, unsaved and kept as a draft', async () => {
    const { user } = await editing();
    const key = stub().dataset['key'];
    // What the canvas exports after the import (the re-laid draft, canonical).
    canvas.text = EDITED;
    await user.upload(screen.getByTestId('import-file'), file(DRAFT));
    await waitFor(() => expect(stub().dataset['key']).not.toBe(key));
    expect(screen.queryByTestId('import-confirm')).toBeNull();
    expect(canvas.props?.document).toMatchObject({ text: DRAFT, relayout: true });
    expect(await screen.findByTestId('unsaved')).toBeTruthy();
    // The base stays the head (r3): the draft is stored against it, the save uses If-Match "r3".
    expect(screen.getByTestId('chain-rev').textContent).toBe('r3');
    expect(
      JSON.parse(localStorage.getItem('analyzr:vc-draft:demo:vch_01DEMO:r3') ?? '{}'),
    ).toMatchObject({
      text: EDITED,
    });
    expect(lastToast()).toMatchObject({ title: '„entwurf.vc.json“ importiert' });
  });

  it('asks before replacing a drawing with content; „Abbrechen“ keeps it, „Ersetzen“ imports', async () => {
    const { user } = await editing();
    canvas.ids = ['s-vertrieb', 's-auftrag'];
    const key = stub().dataset['key'];
    await user.upload(screen.getByTestId('import-file'), file(DRAFT, 'neu.vc.json'));
    const dialog = await screen.findByTestId('import-confirm');
    expect(dialog.textContent).toContain(
      'Die aktuelle Zeichnung wird durch „neu.vc.json“ ersetzt.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByTestId('import-confirm')).toBeNull());
    expect(stub().dataset['key']).toBe(key);
    await user.upload(screen.getByTestId('import-file'), file(DRAFT, 'neu.vc.json'));
    await user.click(await screen.findByTestId('import-replace'));
    await waitFor(() => expect(stub().dataset['key']).not.toBe(key));
    expect(canvas.props?.document).toMatchObject({ text: DRAFT, relayout: true });
  });

  it('asks before replacing unsaved edits, even of an empty drawing', async () => {
    const { user } = await editing();
    canvas.text = EDITED;
    act(() => canvas.props?.onChange());
    expect(await screen.findByTestId('unsaved')).toBeTruthy();
    await user.upload(screen.getByTestId('import-file'), file(DRAFT));
    expect((await screen.findByTestId('import-confirm')).textContent).toContain(
      '„entwurf.vc.json“ ersetzt',
    );
  });

  it('asks before a new chain from a file replaces the stored draft of a new chain; the import becomes the draft', async () => {
    const OLD = `{"connections":[],"elements":[],"meta":{"name":"Alter Entwurf"},"schemaVersion":1}\n`;
    const key = 'analyzr:vc-draft:demo:new:r0';
    localStorage.setItem(key, JSON.stringify({ text: OLD, savedAt: '2026-10-09T09:00:00.000Z' }));
    const { user } = setup('/projects/demo/value-chain', { chain: null });
    await screen.findByTestId('empty-chain');
    canvas.text = EDITED;
    await user.upload(screen.getByTestId('import-file'), file(DRAFT));
    const confirm = await screen.findByTestId('import-confirm');
    expect(confirm.textContent).toContain('Entwurf ersetzen?');
    expect(confirm.textContent).toContain(
      'eine neue Kette gezeichnet und nicht gespeichert; „entwurf.vc.json“ ersetzt diesen Entwurf.',
    );
    // „Abbrechen“ keeps the stored draft and the empty state.
    await user.click(within(confirm).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(screen.queryByTestId('import-confirm')).toBeNull());
    expect(screen.getByTestId('empty-chain')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(key) ?? '{}')).toMatchObject({ text: OLD });
    // „Ersetzen“ imports without offering the old draft, and the import is the draft now.
    await user.upload(screen.getByTestId('import-file'), file(DRAFT));
    await user.click(await screen.findByTestId('import-replace'));
    await waitFor(() => expect(stub().dataset['mode']).toBe('edit'));
    expect(canvas.props?.document).toMatchObject({ text: DRAFT, relayout: true });
    expect(await screen.findByTestId('unsaved')).toBeTruthy();
    expect(screen.queryByTestId('draft-dialog')).toBeNull();
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(key) ?? '{}')).toMatchObject({ text: EDITED }),
    );
  });

  it('starts a new chain from a file on the empty state, saved with If-None-Match: *', async () => {
    const created = { ...detail, valueChain: { ...detail.valueChain, headRev: 1 } };
    const { calls, state, user } = setup('/projects/demo/value-chain', {
      chain: null,
      routes: {
        [`PUT ${BASE}/content`]: (call) => {
          const dryRun = call.search === '?dryRun=true';
          if (!dryRun) {
            state.chain = created;
            state.head = { text: EDITED, rev: 1 };
          }
          return json(
            {
              dryRun,
              outcome: 'created',
              valueChain: dryRun ? null : created.valueChain,
              revision: null,
              impact: {
                structureChanged: true,
                steps: { added: [], removed: [], changed: [] },
                placements: { stranded: 0, toReconfirm: 0, proposalsWithdrawn: 0 },
              },
            },
            dryRun ? 200 : 201,
          );
        },
      },
    });
    await screen.findByTestId('empty-chain');
    canvas.text = EDITED;
    await user.upload(screen.getByTestId('import-file'), file(DRAFT));
    await waitFor(() => expect(stub().dataset['mode']).toBe('edit'));
    expect(canvas.props?.document).toMatchObject({ text: DRAFT, relayout: true });
    expect(await screen.findByTestId('unsaved')).toBeTruthy();
    expect(screen.getByTestId('chain-rev').textContent).toBe('neu');
    await user.click(screen.getByTestId('save-chain'));
    await waitFor(() => expect(screen.getByTestId('chain-rev').textContent).toBe('r1'));
    expect(
      calls.filter((c) => c.method === 'PUT').map((c) => [c.search, c.headers['if-none-match']]),
    ).toEqual([
      ['?dryRun=true', '*'],
      ['', '*'],
    ]);
  });
});

describe('value chain page: the placement agent (M4 §3.2)', () => {
  const agentDetail = chainDetail({
    ...detail,
    placements,
    pipeline: {
      stage: 'waiting_for_review',
      task: {
        id: 'ana_01TASK',
        state: 'done',
        attempts: 1,
        leaseUntil: null,
        claimedBy: 'agent:claude',
      },
      reviewItems: 2,
      heldItems: 0,
      due: 3,
      unsure: 1,
    },
    unsure: [
      {
        process: 'v/foerder#P_Antrag',
        name: 'Fördermittelantrag',
        reason: 'Kein Schritt beschreibt Fördermittel; <b>Dokumentation</b> leer.',
        by: 'agent:claude',
        at: '2026-10-09T08:30:00.000Z',
        current: true,
      },
    ],
  });

  it('shows what is due with „Agent starten“, and the agent’s doubt in „Ohne Schritt“', async () => {
    const { user } = setup('/projects/demo/value-chain', { chain: agentDetail });
    const stage = await screen.findByTestId('chain-stage');
    expect(stage.dataset['stage']).toBe('waiting_for_review');
    expect(stage.textContent).toBe('3 Prozesse fälligAgent starten');
    const section = screen.getByRole('region', { name: 'Ohne Schritt' });
    expect(within(section).getByRole('heading').textContent).toBe('Ohne Schritt(2)');
    const item = (await within(section).findAllByTestId('unplaced-process')).find(
      (i) => i.dataset['process'] === 'v/foerder#P_Antrag',
    ) as HTMLElement;
    expect(item.dataset['unsure']).toBe('true');
    // The reason as plain text, never HTML; the agent's handle behind „Technische Angaben“.
    expect(within(item).getByTestId('unsure-reason').textContent).toBe(
      'Agent unsicher: Kein Schritt beschreibt Fördermittel; <b>Dokumentation</b> leer.',
    );
    expect(item.querySelector('b')).toBeNull();
    expect(item.querySelector('details')?.textContent).toContain('claude');
    await user.click(within(item).getByRole('button', { name: /Platzieren/ }));
    expect(within(item).getByRole('button', { name: /Abbrechen/ })).toBeTruthy();
  });

  it.each([
    ['waiting_for_agent', 'queued', 'Wartet auf den Agenten'],
    ['agent_working', 'claimed', 'Agent arbeitet'],
    ['agent_failed', 'failed', 'Agent gescheitertNochmal versuchen'],
  ] as const)('names the stage %s only while it asks for something', async (stage, state, text) => {
    setup('/projects/demo/value-chain', {
      chain: {
        ...agentDetail,
        pipeline: {
          ...agentDetail.pipeline,
          stage,
          task: { ...agentDetail.pipeline.task!, state },
          due: 0,
        },
        unsure: [],
      },
    });
    expect((await screen.findByTestId('chain-stage')).textContent).toBe(text);
    expect(screen.queryByTestId('chain-due')).toBeNull();
  });

  it.each(['waiting_for_review', 'waiting_for_clarification', 'incorporated'] as const)(
    'shows no stage line for %s with nothing due',
    async (stage) => {
      setup('/projects/demo/value-chain', {
        chain: { ...agentDetail, pipeline: { ...agentDetail.pipeline, stage, due: 0 } },
      });
      await screen.findByTestId('chain-summary');
      expect(screen.queryByTestId('chain-stage')).toBeNull();
    },
  );

  it('gives viewers the doubted process without „Platzieren“', async () => {
    setup('/projects/demo/value-chain', { role: 'viewer', chain: agentDetail });
    const items = await screen.findAllByTestId('unplaced-process');
    expect(items.map((i) => i.dataset['process'])).toEqual(['v/foerder#P_Antrag', 'v/ship#P_Ship']);
    for (const item of items)
      expect(within(item).queryByRole('button', { name: /Platzieren/ })).toBeNull();
  });

  it('schedules the placement task for processes due without one („Agent starten“)', async () => {
    const { calls, state, user } = setup('/projects/demo/value-chain', {
      chain: agentDetail,
      routes: {
        'POST /api/v1/projects/demo/analyses/requeue': () => {
          state.chain = {
            ...agentDetail,
            pipeline: {
              ...agentDetail.pipeline,
              stage: 'waiting_for_agent',
              task: { ...agentDetail.pipeline.task!, id: 'ana_02NEXT', state: 'queued' },
            },
          };
          return json({ items: [], valueChain: { outcome: 'queued', taskId: 'ana_02NEXT' } });
        },
      },
    });
    // The task is done and 3 processes are due: a reviewer's decisions queue nothing.
    const stage = await screen.findByTestId('chain-stage');
    await user.click(within(stage).getByRole('button', { name: /Agent starten/ }));
    await waitFor(() =>
      expect(calls.find((c) => c.path.endsWith('/analyses/requeue'))?.body).toEqual({
        valueChain: true,
      }),
    );
    expect(await screen.findByText('Eingeplant')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId('chain-stage').dataset['stage']).toBe('waiting_for_agent'),
    );
    // no token in this stub: the owner's „Agent starten“ waits for one (the popover's state)
    expect(screen.getByTestId('chain-stage').textContent).toBe('Wartet auf den Agenten');
    expect(screen.queryByTestId('requeue-chain')).toBeNull();
  });

  it('offers „Nochmal versuchen“ after a failed task and reports when nothing is due', async () => {
    const { user } = setup('/projects/demo/value-chain', {
      chain: {
        ...agentDetail,
        pipeline: {
          ...agentDetail.pipeline,
          stage: 'agent_failed',
          task: { ...agentDetail.pipeline.task!, state: 'failed', attempts: 3 },
          due: 0,
        },
      },
      routes: {
        'POST /api/v1/projects/demo/analyses/requeue': () =>
          json({ items: [], valueChain: { outcome: 'nothing-due', taskId: null } }),
      },
    });
    await user.click(await screen.findByTestId('requeue-chain'));
    expect(await screen.findByText('Nichts fällig')).toBeTruthy();
  });

  it('offers nothing while the task is claimed', async () => {
    setup('/projects/demo/value-chain', {
      chain: {
        ...agentDetail,
        pipeline: {
          ...agentDetail.pipeline,
          stage: 'agent_working',
          task: { ...agentDetail.pipeline.task!, state: 'claimed' },
        },
      },
    });
    expect((await screen.findByTestId('chain-stage')).textContent).toBe('Agent arbeitet');
    expect(screen.queryByTestId('chain-due')).toBeNull();
    expect(screen.queryByTestId('requeue-chain')).toBeNull();
  });

  it('shows viewers what is due, without the button', async () => {
    setup('/projects/demo/value-chain', { role: 'viewer', chain: agentDetail });
    const stage = await screen.findByTestId('chain-stage');
    expect(stage.textContent).toBe('3 Prozesse fällig');
    expect(within(stage).queryByRole('button')).toBeNull();
  });
});

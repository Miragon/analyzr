import type { Landscape, Model, Relation } from '@analyzr/client';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { App } from '../src/app';
import { RelationsView } from '../src/components/relation-table';
import {
  agentTokensQuery,
  autoAcceptedQuery,
  autoAcceptRulesQuery,
  landscapeQuery,
  modelsQuery,
  projectQuery,
} from '../src/lib/queries';
import {
  decidedBy,
  moreFilterCount,
  narrowsView,
  parseResultViewSearch,
  parseShown,
  resultViewOf,
  shownFor,
  statusOptions,
  viewFilters,
  type RelationFilters,
} from '../src/lib/relation-filters';
import { createAppRouter } from '../src/router';
import {
  OWNER,
  autoAcceptRule,
  ledgerEntry,
  model,
  provenance,
  relation,
  sampleRelations,
  sampleResolver,
} from './support/fixtures';
import { json, stubApi } from './support/render';

const MODEL_KEYS = [
  'finance/payment-collection',
  'finanzen/rechnungsstellung',
  'vertrieb/auftragsabwicklung',
];

function Harness({
  initial = {},
  relations = sampleRelations,
  onChange,
}: {
  initial?: RelationFilters;
  relations?: typeof sampleRelations;
  onChange?: (filters: RelationFilters) => void;
}) {
  const [filters, setFilters] = useState<RelationFilters>(initial);
  const [shown, setShown] = useState<number>();
  return (
    <RelationsView
      relations={relations}
      resolve={sampleResolver}
      modelKeys={MODEL_KEYS}
      filters={filters}
      onFiltersChange={(next) => {
        onChange?.(next);
        setFilters(next);
        setShown(undefined);
      }}
      shown={shown}
      onShownChange={setShown}
      renderActions={(r) => <button type="button">Zeigen {r.id}</button>}
    />
  );
}

const rows = () => screen.queryAllByTestId('relation-row');
const rowIds = () => rows().map((row) => row.dataset['relationId']);
const decided = (row: HTMLElement) => within(row).getByTestId('decided-by').textContent;
const moreFilters = () => screen.getByRole('button', { name: /^Weitere Filter/ });

describe('RelationsView', () => {
  it('lists rule-accepted calls first, then key-tier proposals', () => {
    render(<Harness />);
    expect(rowIds()).toEqual([
      'rel_01CALL000000000000000000001',
      'rel_01STEM000000000000000000001',
      'rel_01MESSAGE000000000000000001',
      'rel_01SIGNAL0000000000000000001',
    ]);
    const [accepted, stem] = rows();
    expect(accepted!.dataset['status']).toBe('accepted');
    expect(accepted!.dataset['tier']).toBe('rule');
    expect(within(accepted!).getByText('Angenommen')).toBeTruthy();
    expect(within(accepted!).getByText('Eindeutiger Aufruf')).toBeTruthy();
    // „Entschieden von“: analyzr, not its procedure `analyzr-rules/1.0.0` (UX9)
    expect(decided(accepted!)).toBe('analyzr');
    expect(within(stem!).getByText('Vorgeschlagen')).toBeTruthy();
    expect(within(stem!).getByText('Gleicher Name')).toBeTruthy();
    expect(within(stem!).getByText('80 %')).toBeTruthy();
    expect(within(stem!).getByText('Endpunkt geändert')).toBeTruthy();
    // nobody decided a proposal yet
    expect(decided(stem!)).toBe('– noch nicht entschieden');
  });

  it('shows element labels, model keys and process names for both endpoints, wrapped', () => {
    render(<Harness />);
    const message = rows().find(
      (r) => r.dataset['relationId'] === 'rel_01MESSAGE000000000000000001',
    )!;
    const cells = within(message);
    expect(cells.getAllByText('Ware versandbereit')).toHaveLength(2);
    expect(cells.getByText(/vertrieb\/auftragsabwicklung/)).toBeTruthy();
    expect(cells.getByText(/· Auftragsabwicklung/)).toBeTruthy();
    expect(cells.getByText(/finanzen\/rechnungsstellung/)).toBeTruthy();
    // the endpoint columns wrap a long name instead of cutting it (UX9)
    const label = cells.getAllByText('Ware versandbereit')[0]!;
    expect(label.dataset['plainText']).toBe('');
    expect(label.className).not.toContain('truncate');
    // a process endpoint shows the process name; an unknown element falls back to its id
    const call = rows()[0]!;
    expect(within(call).getByText('Payment collection')).toBeTruthy();
    const signal = rows()[3]!;
    expect(within(signal).getByText('End_RechnungsstellungAbgeschlossen')).toBeTruthy();
    // the name shows in full: no ref `model#Element` behind it on hover (P2)
    const table = screen.getByRole('table', { name: 'Relationen' });
    expect(table.querySelectorAll('[title*="#"]')).toHaveLength(0);
  });

  it('gives the endpoints the freed width; „Grundlage“ and „Status“ wrap their badges instead', () => {
    render(<Harness />);
    const table = screen.getByRole('table', { name: 'Relationen' });
    // Typ, Von, →, Nach, Grundlage, Status, Konfidenz, Entschieden von, Aktion: the endpoints take
    // the rest; „Grundlage“ and „Status“ as wide as before UX9 (§3.10 item 3)
    expect([...table.querySelectorAll('col')].map((c) => c.className)).toEqual([
      'w-28',
      '',
      'w-6',
      '',
      'w-28',
      'w-36',
      'w-20',
      'w-36',
      'w-24',
    ]);
    const call = rows()[0]!;
    const tier = within(call).getByText('Eindeutiger Aufruf').closest('td')!;
    expect(tier.className).toContain('[&_[data-slot=badge]]:whitespace-normal');
    const status = within(call).getByText('Angenommen').closest('td')!;
    expect(status.className).toContain('[&_[data-slot=badge]]:whitespace-normal');
  });

  it('filters by status and model in the row, tier and type behind „Weitere Filter“, and resets', async () => {
    const user = userEvent.setup();
    const changes: RelationFilters[] = [];
    render(<Harness onChange={(f) => changes.push(f)} />);
    // closed: only „Status“ and „Modell“ are in the row
    expect(screen.queryByLabelText('Typ')).toBeNull();
    expect(moreFilters().textContent).toBe('Weitere Filter');
    expect(moreFilters().getAttribute('aria-expanded')).toBe('false');

    await user.click(moreFilters());
    await user.selectOptions(screen.getByLabelText('Typ'), 'call');
    expect(rowIds()).toEqual([
      'rel_01CALL000000000000000000001',
      'rel_01STEM000000000000000000001',
    ]);
    // the disclosure says how many of its filters are set
    expect(moreFilters().textContent).toBe('Weitere Filter (1)');

    // a filter in the row is outside the disclosure: it closes
    await user.selectOptions(screen.getByLabelText('Status'), 'proposed');
    expect(rowIds()).toEqual(['rel_01STEM000000000000000000001']);
    expect(screen.queryByLabelText('Grundlage')).toBeNull();

    await user.click(moreFilters());
    await user.selectOptions(screen.getByLabelText('Grundlage'), 'rule');
    expect(rows()).toHaveLength(0);
    expect(screen.getByText('Keine Relation passt zu den Filtern')).toBeTruthy();
    expect(moreFilters().textContent).toBe('Weitere Filter (2)');

    await user.click(screen.getAllByRole('button', { name: 'Filter zurücksetzen' })[0]!);
    expect(rows()).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Filter zurücksetzen' })).toBeNull();

    await user.selectOptions(screen.getByLabelText('Modell'), 'vertrieb/auftragsabwicklung');
    expect(rowIds()).toEqual([
      'rel_01CALL000000000000000000001',
      'rel_01MESSAGE000000000000000001',
      'rel_01SIGNAL0000000000000000001',
    ]);
    expect(changes.at(-1)).toEqual({ model: 'vertrieb/auftragsabwicklung' });
    expect(changes).toContainEqual({ type: 'call', status: 'proposed', tier: 'rule' });
  });

  it('offers „Status“ only in „Alle“, and resets to the view’s own filters', async () => {
    const user = userEvent.setup();
    const changes: RelationFilters[] = [];
    render(<Harness initial={{ status: 'accepted' }} onChange={(f) => changes.push(f)} />);
    // „Gilt“ is a status: no status filter, nothing to reset
    expect(rowIds()).toEqual(['rel_01CALL000000000000000000001']);
    expect(screen.queryByLabelText('Status')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Filter zurücksetzen' })).toBeNull();
    await user.selectOptions(screen.getByLabelText('Modell'), 'finanzen/rechnungsstellung');
    expect(rows()).toHaveLength(0);
    expect(screen.getByText('Keine Relation passt zu den Filtern')).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: 'Filter zurücksetzen' })[0]!);
    // back to „Gilt“, not to „Alle“
    expect(changes.at(-1)).toEqual({ status: 'accepted' });
    expect(rowIds()).toEqual(['rel_01CALL000000000000000000001']);
  });

  it('keeps the details for the review screen: no chevron, no refs, ids or attributes', () => {
    render(<Harness />);
    expect(screen.queryByRole('button', { name: 'Details anzeigen' })).toBeNull();
    expect(screen.queryByTestId('relation-details')).toBeNull();
    // every cell but the action (the harness's buttons name the ids)
    const text = [...screen.getByRole('table', { name: 'Relationen' }).querySelectorAll('td')]
      .filter((td) => td.nextElementSibling !== null)
      .map((td) => td.textContent)
      .join(' ');
    expect(text).toContain('Zahlung abwickeln');
    expect(text).not.toContain('#Call_ZahlungAbwickeln');
    expect(text).not.toContain('binding');
    expect(text).not.toMatch(/rel_|Version/);
  });

  it('renders the action slot per row (the route’s „Öffnen“)', () => {
    render(<Harness />);
    expect(screen.getByRole('columnheader', { name: 'Aktion' })).toBeTruthy();
    for (const r of sampleRelations) {
      expect(screen.getByRole('button', { name: `Zeigen ${r.id}` })).toBeTruthy();
    }
  });

  it('explains an empty landscape', () => {
    render(<Harness relations={[]} />);
    expect(screen.getByText('Noch keine Relationen')).toBeTruthy();
    expect(screen.queryByRole('search')).toBeNull();
  });

  it('says who decided: the human’s handle, never an agent, procedure or model', () => {
    render(
      <Harness
        relations={[
          relation({
            id: 'rel_A',
            from: 'a#x',
            to: 'b#y',
            tier: 'lexical',
            confidence: 0.7,
            provenance: provenance({ handle: 'agent:sim', llmModel: null }),
          }),
          relation({
            id: 'rel_B',
            from: 'a#x',
            to: 'c#z',
            status: 'rejected',
            provenance: provenance({
              sourceKind: 'human',
              handle: 'owner',
              kind: 'decision',
              verdict: 'reject',
            }),
          }),
          relation({
            id: 'rel_C',
            from: 'a#x',
            to: 'd#w',
            status: 'accepted',
            tier: 'manual',
            type: 'manual',
            confidence: null,
          }),
        ]}
      />,
    );
    const row = (id: string) => rows().find((r) => r.dataset['relationId'] === id)!;
    expect(decided(row('rel_A'))).toBe('– noch nicht entschieden');
    expect(decided(row('rel_B'))).toBe('owner');
    // relations from before M2 carry no provenance: a manual one was a human's
    expect(decided(row('rel_C'))).toBe('Mensch');
    expect(within(row('rel_C')).getByText('–')).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Relationen' });
    expect(table.textContent).not.toMatch(/agent:|analyzr-relations|claude-|sim-policy/);
  });

  it('hides „Annahmeregel“ in „Abgelehnt“, where no acceptance is in force', async () => {
    const user = userEvent.setup();
    const props = {
      relations: sampleRelations,
      resolve: sampleResolver,
      modelKeys: MODEL_KEYS,
      onFiltersChange: () => undefined,
      onShownChange: () => undefined,
      autoRules: [{ id: 'aar_01J9Z3N4X5Q6R7S8T9V0W1X2Y3', name: 'Gleicher Name ab 95 %' }],
    };
    const { rerender } = render(<RelationsView {...props} filters={{ status: 'accepted' }} />);
    await user.click(moreFilters());
    expect(screen.getByLabelText('Annahmeregel')).toBeTruthy();
    rerender(<RelationsView {...props} filters={{ status: 'rejected' }} />);
    expect(screen.getByLabelText('Typ')).toBeTruthy();
    expect(screen.queryByLabelText('Annahmeregel')).toBeNull();
  });

  it('shows the first 40 rows, then „Weitere 40 anzeigen“, and starts over with another filter', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 90 }, (_, i) =>
      relation({
        id: `rel_${String(i).padStart(3, '0')}`,
        from: `vertrieb/auftragsabwicklung#E${String(i).padStart(3, '0')}`,
        to: `finanzen/rechnungsstellung#S${String(i).padStart(3, '0')}`,
        type: i % 2 === 0 ? 'message' : 'signal',
      }),
    );
    render(<Harness relations={many} />);
    expect(rows()).toHaveLength(40);
    expect(screen.getByText('90 Relationen')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Weitere 40 anzeigen (50 übrig)' }));
    expect(rows()).toHaveLength(80);
    await user.click(screen.getByRole('button', { name: 'Weitere 10 anzeigen (10 übrig)' }));
    expect(rows()).toHaveLength(90);
    expect(screen.queryByTestId('relations-more')).toBeNull();
    await user.click(moreFilters());
    await user.selectOptions(screen.getByLabelText('Typ'), 'signal');
    expect(rows()).toHaveLength(40);
    expect(screen.getByTestId('relations-more').textContent).toBe('Weitere 5 anzeigen (5 übrig)');
  });
});

describe('result view helpers (UX9)', () => {
  it('names the view of a filter set and counts the filters behind „Weitere Filter“', () => {
    expect(resultViewOf({})).toBe('all');
    expect(resultViewOf({ status: 'accepted', model: 'a' })).toBe('accepted');
    expect(resultViewOf({ status: 'rejected' })).toBe('rejected');
    expect(resultViewOf({ auto: 'any' })).toBe('auto');
    expect(resultViewOf({ auto: 'aar_01J9Z3N4X5Q6R7S8T9V0W1X2Y3' })).toBe('auto');
    // a rule chosen in „Gilt“: every acceptance in force is accepted, so the view of the rules
    expect(resultViewOf({ auto: 'any', status: 'accepted' })).toBe('auto');
    expect(resultViewOf({ auto: 'aar_01J9Z3N4X5Q6R7S8T9V0W1X2Y3', status: 'accepted' })).toBe(
      'auto',
    );
    // with another status (in „Alle“) nothing matches: no view of its own
    expect(resultViewOf({ auto: 'any', status: 'rejected' })).toBe('all');
    expect(resultViewOf({ auto: 'any', status: 'proposed' })).toBe('all');
    expect(resultViewOf({ status: 'proposed' })).toBe('all');
    expect(moreFilterCount({ auto: 'any' })).toBe(0);
    expect(moreFilterCount({ auto: 'any', status: 'accepted' })).toBe(0);
    expect(moreFilterCount({ auto: 'aar_01J9Z3N4X5Q6R7S8T9V0W1X2Y3', status: 'accepted' })).toBe(1);
    expect(moreFilterCount({ auto: 'aar_01J9Z3N4X5Q6R7S8T9V0W1X2Y3', tier: 'key' })).toBe(2);
    expect(moreFilterCount({ type: 'call', model: 'a', status: 'held' })).toBe(1);
    // „Angenommen“ and „Abgelehnt“ are views of their own
    expect(statusOptions(undefined)).toEqual(['proposed', 'held']);
    expect(statusOptions('accepted')).toEqual(['accepted', 'proposed', 'held']);
  });

  it('resets a view to its own filters, and „Gilt“ with a rule to the rules’ view', () => {
    expect(narrowsView({ status: 'accepted' })).toBe(false);
    expect(narrowsView({ status: 'accepted', model: 'a' })).toBe(true);
    expect(narrowsView({ auto: 'any' })).toBe(false);
    // „Automatisch angenommen“ is accepted anyway: a status kept from „Gilt“ narrows nothing
    expect(narrowsView({ auto: 'any', status: 'accepted' })).toBe(false);
    expect(narrowsView({ auto: 'aar_01J9Z3N4X5Q6R7S8T9V0W1X2Y3', status: 'accepted' })).toBe(true);
    expect(viewFilters(resultViewOf({ auto: 'aar_01J9Z3N4X5Q6R7S8T9V0W1X2Y3' }))).toEqual({
      auto: 'any',
    });
    expect(narrowsView({})).toBe(false);
    expect(narrowsView({ status: 'held' })).toBe(true);
  });

  it('keeps the rows shown as a multiple of the page, enough for the relation on the way back', () => {
    expect(parseShown(80)).toBe(80);
    expect(parseShown('120')).toBe(120);
    expect(parseShown(40)).toBe(40);
    for (const bad of [0, -40, 50, 80.5, '80px', '', null, undefined, Number.POSITIVE_INFINITY]) {
      expect(parseShown(bad)).toBeUndefined();
    }
    expect(parseResultViewSearch({ status: 'accepted', shown: 80, x: 1 })).toEqual({
      status: 'accepted',
      shown: 80,
    });
    expect(parseResultViewSearch({ shown: 7 })).toEqual({});
    // the first page holds rows 1 to 40: no `shown`; row 41 needs two pages
    expect(shownFor(0, undefined)).toBeUndefined();
    expect(shownFor(39, undefined)).toBeUndefined();
    expect(shownFor(40, undefined)).toBe(80);
    expect(shownFor(-1, undefined)).toBeUndefined();
    // never fewer rows than the view showed
    expect(shownFor(3, 120)).toBe(120);
    expect(shownFor(130, 80)).toBe(160);
  });

  it('says who decided', () => {
    const entry = ledgerEntry({ id: 'rel_A', ruleName: 'Gleicher Name ab 95 %' });
    const human = provenance({ sourceKind: 'human', handle: 'maria', kind: 'decision' });
    const rule = provenance({ sourceKind: 'rule', handle: 'analyzr-rules', kind: 'decision' });
    const accepted = { status: 'accepted' as const, tier: 'key' as const };
    expect(decidedBy({ ...accepted, provenance: human }, entry)).toEqual({
      source: 'auto',
      text: 'Regel „Gleicher Name ab 95 %“',
    });
    expect(decidedBy({ ...accepted, provenance: human })).toEqual({
      source: 'human',
      text: 'maria',
    });
    expect(decidedBy({ ...accepted, provenance: rule })?.text).toBe('analyzr');
    expect(decidedBy({ ...accepted, status: 'held', provenance: human })?.text).toBe('maria');
    expect(decidedBy({ ...accepted, status: 'proposed', provenance: provenance() })).toBeNull();
    // an agent never decides; a relation without provenance: the rule tier's or a human's
    expect(decidedBy({ ...accepted, provenance: provenance({ kind: 'decision' }) })).toBeNull();
    expect(decidedBy({ status: 'accepted', tier: 'rule', provenance: null })?.text).toBe('analyzr');
    expect(decidedBy({ status: 'accepted', tier: 'manual', provenance: null })?.text).toBe(
      'Mensch',
    );
    expect(decidedBy({ ...accepted, provenance: null })).toBeNull();
  });
});

// ------------------------------------------------------------------ the route (UX9)

const AUTO_RULE = 'aar_01J9Z3N4X5Q6R7S8T9V0W1X2Y3';

/**
 * A landscape shaped like seeded `nordwind-handel` worked by the simulation agent: 31 models,
 * 100 relations (10 calls analyzr accepted, 4 the owner accepted, 2 an auto-accept rule
 * accepted, 76 proposals of the key, lexical and semantic tiers, 5 held, 3 rejected).
 */
function nordwind(): { models: Model[]; relations: Relation[] } {
  const folders = ['einkauf', 'finanzen', 'lager', 'logistik', 'service', 'vertrieb'];
  const models = Array.from({ length: 31 }, (_, i) =>
    model({ key: `${folders[i % folders.length]!}/prozess-${String(i).padStart(2, '0')}` }),
  );
  const at = (i: number, side: string) =>
    `${models[i % models.length]!.key}#${side}_${String(i).padStart(3, '0')}`;
  const human = (verdict: 'accept' | 'reject' | 'hold') =>
    provenance({ sourceKind: 'human', handle: 'owner', kind: 'decision', verdict });
  const relations: Relation[] = [];
  const add = (n: number, make: (i: number) => Partial<Relation>) => {
    for (let k = 0; k < n; k += 1) {
      const i = relations.length;
      relations.push(
        relation({
          id: `rel_${String(i).padStart(3, '0')}`,
          from: at(i, 'Von'),
          to: at(i + 7, 'Nach'),
          ...make(i),
        }),
      );
    }
  };
  add(10, () => ({
    type: 'call',
    status: 'accepted',
    tier: 'rule',
    provenance: provenance({ sourceKind: 'rule', handle: 'analyzr-rules', kind: 'decision' }),
  }));
  add(4, () => ({ status: 'accepted', provenance: human('accept') }));
  add(2, () => ({ status: 'accepted', provenance: human('accept') }));
  add(40, () => ({ provenance: provenance({ handle: 'agent:agent-sim', tier: 'key' }) }));
  add(36, (i) => ({
    tier: i % 3 === 0 ? 'semantic' : 'lexical',
    confidence: 0.52,
    provenance: provenance({ handle: 'agent:agent-sim' }),
  }));
  add(5, () => ({ status: 'held', provenance: human('hold') }));
  add(3, () => ({ status: 'rejected', provenance: human('reject') }));
  return { models, relations };
}

function setupRoute(
  path: string,
  { models, relations }: { models: Model[]; relations: Relation[] },
) {
  stubApi({
    'GET /api/v1/projects/demo/open-questions': () =>
      json({ items: [], nextCursor: null, total: 0, totals: {}, askByModel: {} }),
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(projectQuery('demo').queryKey, {
    id: 'prj_01DEMO',
    key: 'demo',
    name: 'Demo',
    role: 'owner',
    lastSeq: 1,
    createdAt: '2026-10-07T09:00:00.000Z',
  });
  const landscape: Landscape = {
    projectId: 'prj_01DEMO',
    seq: 1,
    models: models.map((m) => ({
      id: m.id,
      key: m.key,
      name: m.name,
      stage: m.stage,
      processes: [],
    })),
    relations,
    findings: [],
  };
  queryClient.setQueryData(landscapeQuery('demo').queryKey, landscape);
  queryClient.setQueryData(modelsQuery('demo').queryKey, models);
  queryClient.setQueryData(agentTokensQuery('demo').queryKey, []);
  queryClient.setQueryData(autoAcceptRulesQuery('demo').queryKey, {
    items: [autoAcceptRule({ id: AUTO_RULE, name: 'Gleicher Name ab 95 %', enabled: true })],
    system: {
      id: 'analyzr-rules/1.0.0',
      name: 'Eindeutige Aufrufe',
      description: '',
      kind: 'relation',
      relationType: 'call',
      readOnly: true,
      accepted: 10,
    },
  });
  // the two relations an auto-accept rule accepted (recorded under the owner)
  queryClient.setQueryData(
    autoAcceptedQuery('demo').queryKey,
    relations.slice(14, 16).map((r) =>
      ledgerEntry({
        id: r.id,
        ruleId: AUTO_RULE,
        ruleName: 'Gleicher Name ab 95 %',
        decidedBy: OWNER,
      }),
    ),
  );
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<App queryClient={queryClient} router={router} />);
  return { router, user: userEvent.setup() };
}

/** The controls the UI load guard counts (`e2e/ui-load.spec.ts` `measure`), `summary` added. */
const CONTROLS =
  'button, a[href], input, select, textarea, [role=tab], [role=menuitem], [role=radio], [role=checkbox], [role=switch], summary';

/** Controls a reader can reach: not in a closed `details` (its summary aside), not inert. */
function controls(root: ParentNode = document): Element[] {
  return [...root.querySelectorAll(CONTROLS)].filter((el) => {
    if (el.closest('[inert], [hidden]')) return false;
    const closed = el.closest('details:not([open])');
    return closed === null || el.parentElement === closed;
  });
}

describe('the result views of „Relationen“ (UX9)', () => {
  it('stays within 60 controls on „Alle“ with 100 relations, shell included', async () => {
    setupRoute('/projects/demo/relations', nordwind());
    await waitFor(() => expect(screen.getAllByTestId('relation-row')).toHaveLength(40));
    await waitFor(() =>
      expect(screen.getByRole('navigation', { name: 'Ansichten' }).textContent).toContain(
        'Automatisch angenommen',
      ),
    );
    const all = controls();
    const main = screen.getByRole('main');
    const view = controls(main).filter((el) => !el.closest('[data-testid=project-tabs]'));
    const perRow = Math.max(
      ...screen.getAllByTestId('relation-row').map((r) => controls(r).length),
    );
    console.log(
      `Relationen › Alle, 100 relations: ${all.length} controls (shell included), ${view.length} of the view, ${perRow} per row`,
    );
    expect(all.length).toBeLessThanOrEqual(60);
    expect(perRow).toBe(1);
    // the decided ones say who: the rule, analyzr, the owner; nobody yet for a proposal
    const row = (id: string) =>
      screen.getAllByTestId('relation-row').find((r) => r.dataset['relationId'] === id)!;
    expect(decided(row('rel_000'))).toBe('analyzr');
    expect(decided(row('rel_010'))).toBe('owner');
    expect(decided(row('rel_014'))).toBe('Regel „Gleicher Name ab 95 %“');
  });

  it('opens a row on the review screen with the view’s filters, and leads back to the view', async () => {
    // „Gilt“ of one model: the two calls analyzr accepted from and into it
    const { router, user } = setupRoute(
      '/projects/demo/relations?status=accepted&model=finanzen%2Fprozess-07',
      nordwind(),
    );
    const listed = await screen.findAllByTestId('relation-row');
    expect(listed.map((r) => r.dataset['relationId'])).toEqual(['rel_000', 'rel_007']);
    const open = within(listed[0]!).getByRole('link', { name: /öffnen$/ });
    expect(open.textContent).toBe('Öffnen');
    expect(open.getAttribute('aria-label')).not.toMatch(/rel_|#/);
    const href = new URL(open.getAttribute('href')!, 'http://x');
    expect(href.pathname).toBe('/projects/demo/review/rel_000');
    expect(Object.fromEntries(href.searchParams)).toEqual({
      status: 'accepted',
      model: 'finanzen/prozess-07',
      from: 'relations',
    });
    await user.click(open);
    const back = await screen.findByTestId('review-back');
    expect(back.textContent).toBe('Gilt');
    expect(back.getAttribute('href')).toBe(
      '/projects/demo/relations?status=accepted&model=finanzen%2Fprozess-07',
    );
    // J/K walk the view's rows, not the queue „Zu prüfen“
    expect(screen.getByTestId('queue-position').textContent).toBe('1 von 2');
    await user.click(screen.getByRole('button', { name: 'Nächste Relation (J)' }));
    await waitFor(() => expect(screen.getByTestId('queue-position').textContent).toBe('2 von 2'));
    expect(router.state.location.pathname).toBe('/projects/demo/review/rel_007');
    expect(router.state.location.search).toEqual({
      status: 'accepted',
      model: 'finanzen/prozess-07',
      from: 'relations',
    });
  });

  it('keeps the rows shown in the URL, through the review screen and back; a filter starts over', async () => {
    const { router, user } = setupRoute('/projects/demo/relations', nordwind());
    const listed = () => screen.getAllByTestId('relation-row');
    await waitFor(() => expect(listed()).toHaveLength(40));
    await user.click(screen.getByRole('button', { name: 'Weitere 40 anzeigen (60 übrig)' }));
    await waitFor(() => expect(listed()).toHaveLength(80));
    expect(router.state.location.search).toEqual({ shown: 80 });
    // row 60 of „Alle“: its „Öffnen“ carries the rows shown to the review screen …
    const open = within(listed()[59]!).getByRole('link', { name: /öffnen$/ });
    expect(
      Object.fromEntries(new URL(open.getAttribute('href')!, 'http://x').searchParams),
    ).toEqual({ shown: '80', from: 'relations' });
    await user.click(open);
    await waitFor(() =>
      expect(screen.getByTestId('queue-position').textContent).toBe('60 von 100'),
    );
    // … J keeps them, and the way back shows them again, the relation now open among them
    await user.click(screen.getByRole('button', { name: 'Nächste Relation (J)' }));
    await waitFor(() =>
      expect(screen.getByTestId('queue-position').textContent).toBe('61 von 100'),
    );
    expect(router.state.location.search).toEqual({ shown: 80, from: 'relations' });
    const relation = router.state.location.pathname.split('/').at(-1);
    const back = screen.getByTestId('review-back');
    expect(back.getAttribute('href')).toBe('/projects/demo/relations?shown=80');
    await user.click(back);
    await waitFor(() => expect(listed()).toHaveLength(80));
    expect(listed().map((r) => r.dataset['relationId'])).toContain(relation);
    // another filter starts the rows over
    await user.selectOptions(screen.getByLabelText('Modell'), 'einkauf/prozess-00');
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ model: 'einkauf/prozess-00' }),
    );
  });

  it('shows the rows down to a relation J reached beyond the first page on the way back', async () => {
    const { user } = setupRoute('/projects/demo/relations', nordwind());
    const listed = () => screen.getAllByTestId('relation-row');
    await waitFor(() => expect(listed()).toHaveLength(40));
    await user.click(within(listed()[39]!).getByRole('link', { name: /öffnen$/ }));
    await waitFor(() =>
      expect(screen.getByTestId('queue-position').textContent).toBe('40 von 100'),
    );
    expect(screen.getByTestId('review-back').getAttribute('href')).toBe('/projects/demo/relations');
    await user.click(screen.getByRole('button', { name: 'Nächste Relation (J)' }));
    await waitFor(() =>
      expect(screen.getByTestId('queue-position').textContent).toBe('41 von 100'),
    );
    expect(screen.getByTestId('review-back').getAttribute('href')).toBe(
      '/projects/demo/relations?shown=80',
    );
  });

  it('says what comes next while the project has models but no relation, without views and filters', async () => {
    const { models } = nordwind();
    setupRoute('/projects/demo/relations', { models, relations: [] });
    const empty = await screen.findByTestId('relations-empty');
    expect(empty.textContent).toContain(
      'Noch keine RelationenEindeutige Aufrufe verknüpft analyzr beim Hochladen; den Rest schlägt ein Agent vor.',
    );
    // an owner without an agent token connects one first (UX-SIMPLIFICATION.md §2.6)
    expect(
      (await within(empty).findByRole('link', { name: 'Agent verbinden' })).getAttribute('href'),
    ).toBe('/projects/demo/agents');
    expect(screen.queryByRole('navigation', { name: 'Ansichten' })).toBeNull();
    expect(screen.queryByRole('search')).toBeNull();
  });

  it('keeps the upload hint without models, also on the tab’s landing „Zu prüfen“', async () => {
    setupRoute('/projects/demo/review', { models: [], relations: [] });
    const empty = await screen.findByTestId('relations-empty');
    expect(empty.textContent).toContain('Lade Modelle hoch:');
    expect(within(empty).queryByRole('link')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Ansichten' })).toBeNull();
  });
});

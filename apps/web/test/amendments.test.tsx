/**
 * Model amendments in the web (M6 §4.8 c, S5c-2; UX4): one entry for a link
 * or the amendment of the same gap („Ziel wählen …“, „Partner wählen …“,
 * „Im Modell eintragen (statt nur zu verknüpfen)“ sends exactly one of
 * them), the amend form at a question (the dry run inline with the effect
 * and the cost above one „Speichern“, the second confirmation for a claimed
 * task, a refusal, a head that changed meanwhile; „Agent starten“ in the
 * toast), the amendment-conflict item's actions („Wert aus dem Quellsystem
 * übernehmen“, „Meine Ergänzung behalten“, all of a model), the model view's
 * „Ergänzen“ (fields, history with „Zurücknehmen“, the header's badge and
 * downloads), the models table's mark with the change list, and the pure
 * helpers (the sentence, the normalized value, the plan, the upload result's
 * counts, the canvas's resolution of a message).
 */
import type {
  AmendModelItem,
  AmendModelResult,
  AmendableElement,
  AmendableField,
  Health,
  Landscape,
  Model,
  ModelAmendment,
  OpenQuestion,
  Project,
  Revision,
  RevisionFacts,
} from '@analyzr/client';
import { QueryClient } from '@tanstack/react-query';
import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { App } from '../src/app';
import {
  amendedElements,
  effectSentence,
  normalizeAmendmentValue,
  planCounts,
  revisionOrigin,
} from '../src/lib/amendments';
import { resolveAmended, type DiagramElement } from '../src/lib/bpmn-elements';
import {
  factsQuery,
  healthQuery,
  landscapeQuery,
  modelsQuery,
  projectQuery,
  projectsQuery,
} from '../src/lib/queries';
import { amendmentCountsText } from '../src/lib/upload';
import { createAppRouter } from '../src/router';
import { agentToken, fact, model, openQuestion, openQuestionPage } from './support/fixtures';
import { findToast, json, stubApi, type Call } from './support/render';

const PROJECT = '/api/v1/projects/demo';
const BASE = `${PROJECT}/open-questions`;
const LOCAL: Health = { status: 'ok', version: '0.1.0-test', db: 'ok' };
const NOW = '2026-10-17T10:00:00.000Z';
const HASH = 'a'.repeat(64);

// ------------------------------------------------------------------ the landscape

const ORDER = model({ key: 'a/order', name: 'Auftrag', headRev: 3 });
const models: Model[] = [ORDER, model({ key: 'b/billing' }), model({ key: 'c/payment' })];
const M = `${PROJECT}/models/${ORDER.id}`;

const proc = (modelKey: string, processId: string, name: string) => ({
  ref: `${modelKey}#${processId}`,
  processId,
  name,
  participantName: null,
  isExecutable: true,
});

const FACTS: RevisionFacts[] = [
  {
    modelKey: 'a/order',
    revisionId: ORDER.headRevisionId,
    factsVersion: '1',
    processes: [proc('a/order', 'Process_Order', 'Auftrag')],
    facts: [
      fact({ modelKey: 'a/order', elementId: 'Process_Order', kind: 'process', processId: null }),
      fact({
        modelKey: 'a/order',
        elementId: 'Call_1',
        kind: 'call',
        label: 'Zahlung abwickeln',
        processId: 'Process_Order',
      }),
      fact({
        modelKey: 'a/order',
        elementId: 'StartEvent_1',
        kind: 'evt_start',
        eventDef: 'none',
        processId: 'Process_Order',
      }),
      fact({
        modelKey: 'a/order',
        elementId: 'EndEvent_1',
        kind: 'evt_end',
        eventDef: 'none',
        processId: 'Process_Order',
      }),
      fact({
        modelKey: 'a/order',
        elementId: 'Send_Invoice',
        kind: 'msg_throw',
        label: 'Rechnung senden',
        processId: 'Process_Order',
      }),
    ],
    messageFlows: [],
  },
  {
    modelKey: 'b/billing',
    revisionId: models[1]!.headRevisionId,
    factsVersion: '1',
    processes: [proc('b/billing', 'Process_Billing', 'Rechnungsstellung')],
    facts: [
      fact({
        modelKey: 'b/billing',
        elementId: 'Catch_Invoice',
        kind: 'msg_catch',
        label: 'Rechnung empfangen',
        processId: 'Process_Billing',
        attrs: { messageName: 'Rechnung' },
      }),
    ],
    messageFlows: [],
  },
  {
    modelKey: 'c/payment',
    revisionId: models[2]!.headRevisionId,
    factsVersion: '1',
    processes: [proc('c/payment', 'Process_Pay', 'Zahlungsdienst')],
    facts: [],
    messageFlows: [],
  },
];

const PROCESSES = [
  {
    ref: 'b/billing#Process_Billing',
    processId: 'Process_Billing',
    name: 'Rechnungsstellung',
    modelKey: 'b/billing',
    modelName: 'Rechnung',
    ambiguous: false,
  },
  {
    ref: 'c/payment#Process_Pay',
    processId: 'Process_Pay',
    name: 'Zahlungsdienst',
    modelKey: 'c/payment',
    modelName: null,
    ambiguous: false,
  },
];

function amendment(
  overrides: Partial<ModelAmendment> & Pick<ModelAmendment, 'id'>,
): ModelAmendment {
  return {
    modelId: ORDER.id,
    modelKey: 'a/order',
    elementId: 'Call_1',
    viaElementId: null,
    op: 'call-target',
    before: '',
    after: 'Process_Billing',
    baseRevisionId: 'rev_UPLOADED',
    supersedesId: null,
    by: 'owner',
    sourceKind: 'human',
    seq: 30,
    at: NOW,
    state: 'applied',
    conflict: null,
    modelDeleted: false,
    withdrawal: null,
    ...overrides,
  };
}

const TYPE_LABELS: Record<AmendableField['element'], string> = {
  call: 'Aufrufaktivität',
  'start-event': 'Startereignis',
  'end-event': 'Endereignis',
  process: 'Prozess',
  message: 'Nachricht',
  signal: 'Signal',
  endpoint: 'Nachrichten-Zwischenereignis',
};
const FIELD_LABELS: Record<AmendableField['op'], string> = {
  'call-target': 'Aufrufziel',
  'message-name': 'Nachrichtenname',
  'event-name': 'Name',
  'process-documentation': 'Dokumentation',
};

function field(
  overrides: Partial<AmendableField> & Pick<AmendableField, 'op' | 'elementId' | 'element'>,
): AmendableField {
  return {
    typeLabel: TYPE_LABELS[overrides.element],
    fieldLabel: FIELD_LABELS[overrides.op],
    viaElementId: null,
    value: null,
    uploadedValue: null,
    settable: true,
    reason: null,
    live: null,
    readers: [],
    suggestions: {},
    ...overrides,
  };
}

function element(
  elementId: string,
  fields: AmendableField[],
  history: ModelAmendment[] = [],
  headRev = 3,
): AmendableElement {
  return {
    modelId: ORDER.id,
    modelKey: 'a/order',
    elementId,
    headRevisionId: ORDER.headRevisionId,
    headRev,
    uploadedRevisionId: 'rev_UPLOADED',
    fields,
    history,
  };
}

const CALL_FIELD = field({
  op: 'call-target',
  elementId: 'Call_1',
  element: 'call',
  value: '',
  uploadedValue: '',
  suggestions: { processes: PROCESSES },
});

/** A nameless message endpoint's field: the landscape's names, one with a partner. */
const MESSAGE_FIELD = field({
  op: 'message-name',
  elementId: 'Send_Invoice',
  element: 'endpoint',
  suggestions: {
    names: [
      {
        name: 'Mahnung',
        endpoints: [
          {
            ref: 'c/payment#Throw_Dun',
            kind: 'msg_throw',
            name: 'Mahnung senden',
            processName: 'Zahlungsdienst',
            modelKey: 'c/payment',
            partner: false,
          },
        ],
      },
      {
        name: 'Rechnung',
        endpoints: [
          {
            ref: 'b/billing#Catch_Invoice',
            kind: 'msg_catch',
            name: 'Rechnung empfangen',
            processName: 'Rechnungsstellung',
            modelKey: 'b/billing',
            partner: true,
          },
        ],
      },
    ],
  },
});

/** The amendable fields the forms read, by element. */
function amendableRoutes(
  overrides: Record<string, AmendableElement> = {},
): Parameters<typeof stubApi>[0] {
  const elements: Record<string, AmendableElement> = {
    Call_1: element('Call_1', [CALL_FIELD]),
    Call_9: element('Call_9', [
      field({
        op: 'call-target',
        elementId: 'Call_9',
        element: 'call',
        value: 'Process_Neu',
        uploadedValue: 'Process_Neu',
        live: amendment({ id: 'mam_01CONFLICT', elementId: 'Call_9', state: 'conflict' }),
        suggestions: { processes: PROCESSES },
      }),
    ]),
    Process_Order: element('Process_Order', [
      field({ op: 'process-documentation', elementId: 'Process_Order', element: 'process' }),
    ]),
    StartEvent_1: element('StartEvent_1', [
      field({
        op: 'event-name',
        elementId: 'StartEvent_1',
        element: 'start-event',
        suggestions: { labels: ['Rechnung bezahlt'] },
      }),
    ]),
    EndEvent_1: element('EndEvent_1', [
      field({ op: 'event-name', elementId: 'EndEvent_1', element: 'end-event' }),
    ]),
    ...overrides,
  };
  return Object.fromEntries(
    Object.entries(elements).map(([id, e]) => [`GET ${M}/elements/${id}/amendable`, () => json(e)]),
  );
}

function revision(overrides: Partial<Revision> & Pick<Revision, 'id' | 'rev'>): Revision {
  return {
    modelId: ORDER.id,
    contentHash: HASH,
    factsHash: HASH,
    factsVersion: '1',
    engine: 'c8',
    source: { kind: 'import', path: 'a/order.bpmn' },
    seq: 10 + overrides.rev,
    createdAt: NOW,
    ...overrides,
  };
}

/** The amendments route's answer: the dry run or the save of the posted items. */
function amendAnswer(
  items: readonly AmendModelItem[],
  { dryRun, taskClaimed = false }: { dryRun: boolean; taskClaimed?: boolean },
): AmendModelResult {
  return {
    dryRun,
    outcome: 'recorded',
    items: items.map((i) => ({
      elementId: i.elementId,
      op: i.op,
      outcome: 'recorded',
      amendmentElementId: i.elementId,
      after:
        i.target !== undefined
          ? i.target.slice(i.target.indexOf('#') + 1)
          : (i.after ?? '').replace(/\s+/g, ' ').trim(),
      before: i.op === 'call-target' ? '' : null,
    })),
    model: { ...ORDER, headRev: dryRun ? 3 : 5 },
    revision: dryRun ? null : revision({ id: 'rev_AMENDED', rev: 5 }),
    effect: {
      findingsResolved: items.some((i) => i.op === 'call-target')
        ? [{ kind: 'unresolved-call', refs: ['a/order#Call_1'], detail: '' }]
        : [],
      findingsAdded: [],
      accepted: items.some((i) => i.op === 'call-target')
        ? [
            {
              relation: null,
              type: 'call',
              from: 'a/order#Call_1',
              to: 'b/billing#Process_Billing',
            },
          ]
        : [],
      proposed: [],
      withdrawn: [],
      partnerAccepted: [],
      changed: [],
      retired: [],
    },
    cost: { factsChange: true, pairsToRejudge: 214, taskClaimed },
  };
}

// ------------------------------------------------------------------ the items

type Action = OpenQuestion['actions'][number];
const NOTE: Action = { type: 'note', primary: false, label: 'Notiz hinzufügen' };
const amendOf = (
  targets: { elementId: string; op: AmendModelItem['op']; label: string; prefill?: string }[],
  replaces?: string,
) => ({
  modelId: ORDER.id,
  modelKey: 'a/order',
  targets,
  ...(replaces ? { replaces } : {}),
});

function fixtures(): OpenQuestion[] {
  return [
    openQuestion({
      id: 'q-00000000000000d1',
      unlocks: 9,
      actions: [
        {
          type: 'amend',
          primary: true,
          label: 'Aufrufziel eintragen …',
          amend: amendOf([
            {
              elementId: 'Call_1',
              op: 'call-target',
              label: 'Aufrufaktivität „Zahlung abwickeln“',
            },
          ]),
        },
        {
          type: 'link',
          primary: false,
          label: 'Nur verknüpfen …',
          pick: 'process',
          suggested: ['c/payment#Process_Pay'],
        },
        { type: 'outside', primary: false, label: 'Liegt außerhalb der Landschaft' },
        NOTE,
      ],
    }),
    openQuestion({
      id: 'q-00000000000000d2',
      kind: 'undocumented-process',
      source: 'signal',
      subject: { type: 'process', id: 'a/order#Process_Order' },
      subjectLabel: '„Auftrag“',
      refs: ['a/order#Process_Order'],
      unlocks: 8,
      actions: [
        {
          type: 'amend',
          primary: true,
          label: 'Dokumentation ergänzen …',
          amend: amendOf([
            { elementId: 'Process_Order', op: 'process-documentation', label: 'Prozess „Auftrag“' },
          ]),
        },
        NOTE,
      ],
    }),
    openQuestion({
      id: 'q-00000000000000d3',
      kind: 'unlabelled-boundary',
      source: 'signal',
      subject: { type: 'process', id: 'a/order#Process_Order' },
      subjectLabel: '„Auftrag“',
      refs: ['a/order#StartEvent_1', 'a/order#EndEvent_1'],
      unlocks: 7,
      actions: [
        {
          type: 'amend',
          primary: true,
          label: 'Namen eintragen …',
          amend: amendOf([
            { elementId: 'StartEvent_1', op: 'event-name', label: 'Startereignis „StartEvent_1“' },
            { elementId: 'EndEvent_1', op: 'event-name', label: 'Endereignis „EndEvent_1“' },
          ]),
        },
        NOTE,
      ],
    }),
    openQuestion({
      id: 'q-00000000000000d4',
      kind: 'amendment-conflict',
      source: 'amendment',
      subject: { type: 'ref', id: 'a/order#Call_9' },
      subjectLabel: '„Versand“',
      text: 'Welcher Wert gilt für Aufrufziel an „Versand“? …',
      refs: ['a/order#Call_9'],
      unlocks: 6,
      actions: [
        {
          type: 'withdraw-amendment',
          primary: true,
          label: 'Wert aus dem Quellsystem übernehmen',
          withdraw: {
            modelId: ORDER.id,
            modelKey: 'a/order',
            amendment: 'mam_01CONFLICT',
            compare: {
              field: 'Aufrufziel',
              incoming: 'Process_Neu',
              after: 'Process_Billing',
              before: null,
            },
          },
        },
        {
          type: 'amend',
          primary: false,
          label: 'Meine Ergänzung behalten',
          amend: amendOf(
            [
              {
                elementId: 'Call_9',
                op: 'call-target',
                label: 'Aufrufaktivität „Versand“',
                prefill: 'Process_Billing',
              },
            ],
            'mam_01CONFLICT',
          ),
        },
      ],
    }),
    openQuestion({
      id: 'q-00000000000000d5',
      kind: 'amendment-conflict',
      source: 'amendment',
      subject: { type: 'ref', id: 'a/order#Call_Gone' },
      subjectLabel: '„Call_Gone“',
      refs: ['a/order#Call_Gone'],
      unlocks: 5,
      actions: [
        {
          type: 'withdraw-amendment',
          primary: true,
          label: 'Ergänzung zurücknehmen',
          withdraw: { modelId: ORDER.id, modelKey: 'a/order', amendment: 'mam_01GONE' },
        },
        {
          type: 'withdraw-amendment',
          primary: false,
          label: 'Alle Ergänzungen dieses Modells zurücknehmen',
          withdraw: { modelId: ORDER.id, modelKey: 'a/order' },
        },
      ],
    }),
  ] as OpenQuestion[];
}

function project(role: Project['role']): Project {
  return { id: 'prj_01DEMO', key: 'demo', name: 'Demo', role, lastSeq: 12, createdAt: NOW };
}

function listRoute(list: readonly OpenQuestion[]) {
  return (call: Call) => json(openQuestionPage(list, call.search, { folders: false }));
}

/** The amendments route: a dry run answers 200, a save 201 and ends the items that asked for it. */
function amendRoute(
  list: OpenQuestion[],
  options: { taskClaimed?: boolean; dry?: (items: AmendModelItem[]) => Response | null } = {},
) {
  return (call: Call) => {
    const { items } = call.body as { items: AmendModelItem[] };
    const dryRun = new URLSearchParams(call.search).get('dryRun') === 'true';
    if (dryRun) {
      const custom = options.dry?.(items);
      if (custom) return custom;
      return json(
        amendAnswer(items, { dryRun, ...(options.taskClaimed ? { taskClaimed: true } : {}) }),
      );
    }
    for (const item of items) {
      const at = list.findIndex((q) =>
        q.actions.some((a) => a.amend?.targets.some((t) => t.elementId === item.elementId)),
      );
      if (at >= 0) list.splice(at, 1);
    }
    return json(amendAnswer(items, { dryRun }), 201);
  };
}

function setup(
  path: string,
  {
    role = 'owner',
    list = fixtures(),
    routes = {},
  }: {
    role?: Project['role'];
    list?: OpenQuestion[];
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
  const calls = stubApi({
    'GET /api/v1/projects': () => json({ items: [project(role)], nextCursor: null }),
    [`GET ${PROJECT}`]: () => json(project(role)),
    [`GET ${PROJECT}/models`]: () => json({ items: models, nextCursor: null }),
    [`GET ${PROJECT}/landscape`]: () => json(landscape),
    [`GET ${PROJECT}/amendments`]: () => json({ items: [], seq: 12 }),
    [`GET ${BASE}`]: listRoute(list),
    [`POST ${M}/amendments`]: amendRoute(list),
    ...amendableRoutes(),
    ...routes,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  queryClient.setQueryData(healthQuery.queryKey, LOCAL);
  queryClient.setQueryData(projectsQuery.queryKey, [project(role)]);
  queryClient.setQueryData(projectQuery('demo').queryKey, project(role));
  queryClient.setQueryData(landscapeQuery('demo').queryKey, landscape);
  queryClient.setQueryData(modelsQuery('demo').queryKey, models);
  for (const [i, f] of FACTS.entries()) {
    const m = models[i]!;
    queryClient.setQueryData(
      factsQuery({ project: 'demo', modelId: m.id, revisionId: m.headRevisionId }).queryKey,
      f,
    );
  }
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<App queryClient={queryClient} router={router} />);
  return { calls, list, router, user: userEvent.setup() };
}

const rows = () => screen.findAllByTestId('open-question');
const row = async (id: string) => {
  let found: HTMLElement | undefined;
  await waitFor(() => {
    found = screen.getAllByTestId('open-question').find((r) => r.dataset['questionId'] === id);
    if (!found) throw new Error(`no item ${id}`);
  });
  return found!;
};
const primary = (item: HTMLElement) =>
  within(item)
    .getAllByTestId('question-action')
    .find((b) => b.dataset['primary'] === 'true')!;
const amendPosts = (calls: readonly Call[]) =>
  calls.filter((c) => c.method === 'POST' && c.path === `${M}/amendments`);

async function fromMenu(user: ReturnType<typeof userEvent.setup>, item: HTMLElement, name: string) {
  await user.click(within(item).getByTestId('question-more-actions'));
  await user.click(await screen.findByRole('menuitem', { name }));
}

// ------------------------------------------------------------------ the form at a question

const actionPosts = (calls: readonly Call[], id: string) =>
  calls.filter((c) => c.method === 'POST' && c.path === `${BASE}/${id}/actions`);
const options = (scope: HTMLElement, testId = 'action-option') =>
  within(scope)
    .getAllByTestId(testId)
    .map((o) => o.dataset['ref']);

describe('one entry for a link or an amendment (UX4, M6 S5c-2)', () => {
  it('„Ziel wählen …“: the pick, „Im Modell eintragen“ checked, the dry run inline, one „Speichern“', async () => {
    const { calls, user } = setup('/projects/demo/open-questions', {
      routes: {
        [`GET ${PROJECT}/agent-tokens`]: () =>
          json({ items: [agentToken({ id: 'agt_01A', name: 'claude' })] }),
      },
    });
    const item = await row('q-00000000000000d1');
    // the amendment and „Nur verknüpfen …“ are one entry, nothing of them in the menu
    expect(primary(item).textContent).toBe('Ziel wählen …');
    await user.click(within(item).getByTestId('question-more-actions'));
    expect((await screen.findAllByRole('menuitem')).map((m) => m.textContent)).toEqual([
      'Liegt außerhalb der Landschaft',
      'Notiz hinzufügen',
      'Kennung kopieren',
    ]);
    await user.keyboard('{Escape}');
    await user.click(primary(item));
    const panel = await within(item).findByTestId('question-action-panel');
    // the process the question's link suggests comes first, under „Vorgeschlagen“
    await waitFor(() => expect(options(panel)).toHaveLength(2));
    expect(options(panel)).toEqual(['c/payment#Process_Pay', 'b/billing#Process_Billing']);
    expect(
      within(panel)
        .getAllByTestId('picker-section')
        .map((s) => s.textContent),
    ).toEqual(['Vorgeschlagen', 'Alle Prozesse']);
    // „Name – Modell“, no id in the text
    expect(within(panel).getAllByTestId('action-option')[1]!.textContent).toBe(
      'Rechnungsstellung – b/billing',
    );
    expect(within(panel).queryByTestId('action-in-model')).toBeNull();
    await user.click(within(panel).getAllByTestId('action-option')[1]!);

    // no key yet: the amendment was the item's primary action, so the box starts checked
    const box = within(panel).getByTestId('action-in-model');
    expect(box.getAttribute('aria-checked')).toBe('true');
    const effect = await within(panel).findByTestId('amend-effect', {}, { timeout: 4_000 });
    expect(effect.textContent).toBe(
      'Danach: 1 Aufruf angenommen, 1 Befund erledigt. Die Agenten beurteilen 214 mögliche Relationen neu, sobald du den Agenten startest.',
    );
    const [dry] = amendPosts(calls);
    expect(dry!.search).toBe('?dryRun=true');
    expect(dry!.headers['if-match']).toBe('"r3"');
    expect(dry!.body).toEqual({
      items: [{ elementId: 'Call_1', op: 'call-target', target: 'b/billing#Process_Billing' }],
    });
    expect(within(panel).getByTestId('amend-hint').textContent).toContain(
      'Der nächste Import aus dem Quellsystem behält die Ergänzung',
    );
    // click 3: „Speichern“ sends the amendment only, never the link
    const save = within(panel).getByTestId('action-submit');
    expect(save.textContent).toBe('Speichern');
    await user.click(save);
    const toast = await findToast('Ergänzung gespeichert');
    const posts = amendPosts(calls);
    expect(posts.map((p) => p.search)).toEqual(['?dryRun=true', '?dryRun=false']);
    expect(posts[1]!.headers['if-match']).toBe('"r3"');
    expect(posts[1]!.body).toEqual(dry!.body);
    expect(actionPosts(calls, 'q-00000000000000d1')).toHaveLength(0);
    await waitFor(() =>
      expect(
        screen.queryAllByTestId('open-question').map((r) => r.dataset['questionId']),
      ).not.toContain('q-00000000000000d1'),
    );
    // the toast offers „Agent starten“ (§2.6): the agents judge the pairs once started
    await user.click(within(toast).getByTestId('toast-action'));
    expect((await screen.findByTestId('agent-start-host')).textContent).toContain(
      '/analyzr:relations demo',
    );
  });

  it('unchecked, only the link is sent; „+ Notiz“ opens the note', async () => {
    const list = fixtures();
    const { calls, user } = setup('/projects/demo/open-questions', {
      list,
      routes: {
        [`POST ${BASE}/q-00000000000000d1/actions`]: () =>
          json({
            result: 'applied',
            question: null,
            relations: [],
            placements: [],
            answer: null,
            warnings: [],
          }),
      },
    });
    const item = await row('q-00000000000000d1');
    await user.click(primary(item));
    const panel = await within(item).findByTestId('question-action-panel');
    await waitFor(() => expect(options(panel)).toHaveLength(2));
    await user.click(within(panel).getAllByTestId('action-option')[0]!);
    await user.click(within(panel).getByTestId('action-in-model'));
    expect(within(panel).getByTestId('action-in-model').getAttribute('aria-checked')).toBe('false');
    expect(within(panel).getByTestId('action-preview').textContent).toContain(
      'Legt eine angenommene Relation',
    );
    expect(within(panel).queryByTestId('action-note')).toBeNull();
    await user.click(within(panel).getByTestId('action-note-toggle'));
    await user.type(within(panel).getByTestId('action-note'), 'Laut Fachbereich');
    const submit = within(panel).getByTestId('action-submit');
    expect(submit.textContent).toBe('Verknüpfen');
    await user.click(submit);
    await waitFor(() => expect(actionPosts(calls, 'q-00000000000000d1')).toHaveLength(1));
    expect(actionPosts(calls, 'q-00000000000000d1')[0]!.body).toEqual({
      type: 'link',
      targets: ['c/payment#Process_Pay'],
      note: 'Laut Fachbereich',
    });
    // a dry run may have run while it was checked; nothing was saved
    expect(amendPosts(calls).every((c) => c.search === '?dryRun=true')).toBe(true);
  });

  it('a changed head on the dry run sends nothing, not even the link, and loads the field again', async () => {
    const list = fixtures();
    const { calls, user } = setup('/projects/demo/open-questions', {
      list,
      routes: {
        [`POST ${M}/amendments`]: amendRoute(list, {
          dry: () =>
            json(
              {
                type: 'urn:analyzr:problem:revision-conflict',
                title: 'Revision conflict',
                status: 412,
                code: 'revision-conflict',
                headRev: 4,
              },
              412,
            ),
        }),
      },
    });
    const item = await row('q-00000000000000d1');
    await user.click(primary(item));
    const panel = await within(item).findByTestId('question-action-panel');
    await waitFor(() => expect(options(panel)).toHaveLength(2));
    await user.click(within(panel).getAllByTestId('action-option')[1]!);
    const conflict = await within(panel).findByTestId('amend-conflict', {}, { timeout: 4_000 });
    expect(conflict.textContent).toContain('Es ist jetzt r4.');
    expect(within(panel).getByTestId<HTMLButtonElement>('action-submit').disabled).toBe(true);
    expect(amendPosts(calls).every((c) => c.search === '?dryRun=true')).toBe(true);
    expect(actionPosts(calls, 'q-00000000000000d1')).toHaveLength(0);
  });

  it('asks a second time when an agent holds the model’s task', async () => {
    const list = fixtures();
    const { calls, user } = setup('/projects/demo/open-questions', {
      list,
      routes: { [`POST ${M}/amendments`]: amendRoute(list, { taskClaimed: true }) },
    });
    const item = await row('q-00000000000000d1');
    await user.click(primary(item));
    const panel = await within(item).findByTestId('question-action-panel');
    await waitFor(() => expect(options(panel)).toHaveLength(2));
    await user.click(within(panel).getAllByTestId('action-option')[0]!);
    const claimed = await within(panel).findByTestId('amend-claimed', {}, { timeout: 4_000 });
    expect(claimed.textContent).toContain(
      'Ein Agent bearbeitet dieses Modell gerade; seine Arbeit geht verloren.',
    );
    const submit = within(panel).getByTestId('action-submit');
    expect(submit.textContent).toBe('Speichern');
    await user.click(submit);
    expect(submit.textContent).toBe('Trotzdem speichern');
    expect(amendPosts(calls).map((c) => c.search)).toEqual(['?dryRun=true']);
    await user.click(submit);
    expect(await findToast('Ergänzung gespeichert')).toBeDefined();
    expect(amendPosts(calls).map((c) => c.search)).toEqual(['?dryRun=true', '?dryRun=false']);
  });

  it('„Partner wählen …“: a partner’s name in the model, or only the link for a whole process', async () => {
    const list = [
      openQuestion({
        id: 'q-00000000000000e1',
        kind: 'message-partner-missing',
        subject: { type: 'ref', id: 'a/order#Send_Invoice' },
        subjectLabel: '„Rechnung senden“',
        refs: ['a/order#Send_Invoice'],
        actions: [
          {
            type: 'amend',
            primary: true,
            label: 'Nachrichtennamen im Modell eintragen …',
            amend: amendOf([
              {
                elementId: 'Send_Invoice',
                op: 'message-name',
                label: 'Nachrichten-Zwischenereignis „Rechnung senden“',
              },
            ]),
          },
          { type: 'link', primary: false, label: 'Nur verknüpfen …', pick: 'endpoint' },
          NOTE,
        ],
      }),
    ] as OpenQuestion[];
    const { calls, user } = setup('/projects/demo/open-questions', {
      list,
      routes: {
        [`POST ${M}/amendments`]: amendRoute(list),
        ...amendableRoutes({ Send_Invoice: element('Send_Invoice', [MESSAGE_FIELD]) }),
      },
    });
    const item = await row('q-00000000000000e1');
    expect(primary(item).textContent).toBe('Partner wählen …');
    // a card whose only further action is the note shows it as a ghost button
    expect(within(item).queryByTestId('question-more-actions')).toBeNull();
    expect(
      within(item)
        .getAllByTestId('question-action')
        .map((b) => [b.textContent, b.dataset['action']]),
    ).toEqual([
      ['Partner wählen …', 'link'],
      ['Notiz', 'note'],
    ]);
    await user.click(primary(item));
    const panel = await within(item).findByTestId('question-action-panel');
    await waitFor(() => expect(options(panel)).toContain('b/billing#Catch_Invoice'));
    // a whole process: no name to write, only the link
    await user.click(
      within(panel)
        .getAllByTestId('action-option')
        .find((o) => o.dataset['ref'] === 'c/payment#Process_Pay')!,
    );
    const box = within(panel).getByTestId('action-in-model');
    expect(box.getAttribute('aria-checked')).toBe('false');
    expect((box as HTMLButtonElement).disabled).toBe(true);
    expect(within(panel).getByTestId('action-in-model-reason').textContent).toContain(
      'nur verknüpfen',
    );
    // the partner endpoint: its name in the model, which pairs both
    await user.click(
      within(panel)
        .getAllByTestId('action-option')
        .find((o) => o.dataset['ref'] === 'b/billing#Catch_Invoice')!,
    );
    expect(within(panel).getByTestId('action-in-model').getAttribute('aria-checked')).toBe('true');
    await within(panel).findByTestId('amend-effect', {}, { timeout: 4_000 });
    expect(amendPosts(calls)[0]!.body).toEqual({
      items: [
        {
          elementId: 'Send_Invoice',
          op: 'message-name',
          after: 'Rechnung',
          partner: 'b/billing#Catch_Invoice',
        },
      ],
    });
  });
});

describe('the amend form at a question (M6 S5c-2, UX4)', () => {
  it('names a refusal in German and writes nothing; a changed head loads the fields again', async () => {
    const list = fixtures();
    let dryRuns = 0;
    const { calls, user } = setup('/projects/demo/open-questions', {
      list,
      routes: {
        [`POST ${M}/amendments`]: amendRoute(list, {
          dry: (items) => {
            dryRuns += 1;
            if (dryRuns === 1)
              return json({
                ...amendAnswer(items, { dryRun: true }),
                outcome: 'unchanged',
                items: items.map((i) => ({
                  elementId: i.elementId,
                  op: i.op,
                  outcome: 'not-applicable',
                  reason: 'only-open-questions',
                })),
              });
            return json(
              {
                type: 'urn:analyzr:problem:revision-conflict',
                title: 'Revision conflict',
                status: 412,
                code: 'revision-conflict',
                headRev: 4,
              },
              412,
            );
          },
        }),
      },
    });
    const item = await row('q-00000000000000d2');
    await user.click(primary(item));
    const form = await within(item).findByTestId('amend-form');
    // no „Sammeln“ any more (UX4): one „Speichern“
    expect(within(form).queryByText('Sammeln')).toBeNull();
    const text = await within(form).findByTestId('amend-text');
    await user.type(text, 'Nimmt Aufträge an');
    const refused = await within(form).findByTestId('amend-refused', {}, { timeout: 4_000 });
    expect(refused.textContent).toContain(
      'Prozess „Auftrag“ · Dokumentation: Nur für offene Fragen.',
    );
    expect(refused.textContent).toContain('Nichts gespeichert.');
    expect(within(form).getByTestId<HTMLButtonElement>('amend-submit').disabled).toBe(true);

    const reads = () =>
      calls.filter((c) => c.path === `${M}/elements/Process_Order/amendable`).length;
    const before = reads();
    await user.type(text, '.');
    const conflict = await within(form).findByTestId('amend-conflict', {}, { timeout: 4_000 });
    expect(conflict.textContent).toContain('Es ist jetzt r4.');
    await waitFor(() => expect(reads()).toBeGreaterThan(before));
    expect(amendPosts(calls).every((c) => c.search === '?dryRun=true')).toBe(true);
  });

  it('shows the value as it will be stored and refuses a value that is too long before sending', async () => {
    const { calls, user } = setup('/projects/demo/open-questions');
    const item = await row('q-00000000000000d3');
    await user.click(primary(item));
    const form = await within(item).findByTestId('amend-form');
    const [start, end] = await within(form).findAllByTestId('amend-text');
    await user.type(start!, '  Auftrag   eingegangen ');
    expect(within(form).getByTestId('amend-stored-as').textContent).toBe(
      'Gespeichert wird: „Auftrag eingegangen“',
    );
    // a start event's label partners elsewhere are suggested
    expect(start!.getAttribute('list')).not.toBeNull();
    // longer than a label may be: refused before sending, never cut
    await user.click(end!);
    await user.paste('x'.repeat(201));
    expect(within(form).getByTestId<HTMLButtonElement>('amend-submit').disabled).toBe(true);
    expect(form.textContent).toContain('Höchstens 200 Zeichen.');
    await user.clear(end!);
    await user.type(end!, 'Auftrag erledigt, Rückfragen an kunde@example.com');
    expect(
      within(form)
        .getAllByTestId('amend-personal-data')
        .map((p) => p.textContent),
    ).toContain(
      'Der Text enthält vermutlich eine E-Mail-Adresse. Prüf bitte, ob das wirklich gespeichert werden soll: keine Namen oder anderen personenbezogenen Daten.',
    );
    // only dry runs (of valid values), never a save
    expect(amendPosts(calls).every((c) => c.search === '?dryRun=true')).toBe(true);
  });

  it('picks a partner’s name, which accepts the pair, or takes free text', async () => {
    const list = [
      openQuestion({
        id: 'q-00000000000000e1',
        kind: 'message-partner-missing',
        subject: { type: 'ref', id: 'a/order#Send_Invoice' },
        subjectLabel: '„Rechnung senden“',
        refs: ['a/order#Send_Invoice'],
        actions: [
          {
            type: 'amend',
            primary: true,
            label: 'Nachrichtennamen eintragen …',
            amend: amendOf([
              {
                elementId: 'Send_Invoice',
                op: 'message-name',
                label: 'Nachrichten- oder Signalelement „Rechnung senden“',
              },
            ]),
          },
          NOTE,
        ],
      }),
    ] as OpenQuestion[];
    const { calls, user } = setup('/projects/demo/open-questions', {
      list,
      routes: {
        [`POST ${M}/amendments`]: amendRoute(list),
        ...amendableRoutes({ Send_Invoice: element('Send_Invoice', [MESSAGE_FIELD]) }),
      },
    });
    const item = await row('q-00000000000000e1');
    await user.click(primary(item));
    const form = await within(item).findByTestId('amend-form');
    const text = await within(form).findByTestId('amend-text');
    expect(within(form).getByText('Nachrichtenname')).toBeDefined();
    expect(
      within(form)
        .getAllByTestId('amend-name-option')
        .map((o) => o.textContent),
    ).toEqual([
      'Mahnung1 Element mit diesem Namen',
      'RechnungPartner: Rechnung empfangen in Rechnungsstellung (b/billing)',
    ]);
    await user.type(text, 'rech');
    expect(within(form).getAllByTestId('amend-name-option')).toHaveLength(1);
    await user.click(within(form).getByTestId('amend-name-option'));
    expect((text as HTMLInputElement).value).toBe('Rechnung');
    expect(within(form).getByTestId('amend-partner').textContent).toContain(
      'Mit dem Speichern nimmst du den Vorschlag zwischen beiden an.',
    );
    await waitFor(
      () =>
        expect(amendPosts(calls).at(-1)?.body).toEqual({
          items: [
            {
              elementId: 'Send_Invoice',
              op: 'message-name',
              after: 'Rechnung',
              partner: 'b/billing#Catch_Invoice',
            },
          ],
        }),
      { timeout: 4_000 },
    );
    // typing again makes it free text: no partner
    await user.type(text, 'sausgang');
    expect(within(item).queryByTestId('amend-partner')).toBeNull();
  });
});

// ------------------------------------------------------------------ the conflict item

describe('the amendment-conflict item’s actions (M6 S5c-2)', () => {
  it('shows both values side by side, and takes the tool’s value after the withdrawal’s cost', async () => {
    const { calls, user } = setup('/projects/demo/open-questions', {
      routes: {
        [`POST ${PROJECT}/amendments/mam_01CONFLICT/withdrawal`]: (call) =>
          call.search.includes('dryRun=true')
            ? json({
                result: 'withdrawn',
                amendments: [amendment({ id: 'mam_01CONFLICT', state: 'conflict' })],
                model: ORDER,
                revision: null,
                dryRun: true,
                cost: { factsChange: true, pairsToRejudge: 5, taskClaimed: true },
              })
            : json(
                {
                  result: 'withdrawn',
                  amendments: [amendment({ id: 'mam_01CONFLICT', state: 'withdrawn' })],
                  model: { ...ORDER, headRev: 4 },
                  revision: revision({ id: 'rev_4', rev: 4 }),
                },
                201,
              ),
      },
    });
    const item = await row('q-00000000000000d4');
    // The two values, and keeping analyzr's as a visible second button.
    const values = within(item).getByTestId('conflict-values');
    expect(within(values).getByTestId('conflict-incoming').textContent).toBe('„Process_Neu“');
    expect(within(values).getByTestId('conflict-after').textContent).toBe('„Process_Billing“');
    expect(
      within(item)
        .getAllByTestId('question-action')
        .map((b) => b.textContent),
    ).toEqual(['Wert aus dem Quellsystem übernehmen', 'Meine Ergänzung behalten']);
    expect(primary(item).textContent).toBe('Wert aus dem Quellsystem übernehmen');
    await user.click(primary(item));
    // Its cost first, from the dry run; nothing withdrawn yet.
    const confirm = await within(item).findByTestId('withdraw-confirm');
    expect((await within(confirm).findByTestId('withdraw-effect')).textContent).toBe(
      'Der Wert aus dem Quellsystem gilt; analyzr nimmt seine Ergänzung zurück. Das Modell bekommt eine neue Revision ohne diese Ergänzung. Die Agenten beurteilen 5 mögliche Relationen neu, sobald du den Agenten startest.',
    );
    expect(within(confirm).getByTestId('withdraw-claimed').textContent).toContain(
      'Ein Agent bearbeitet dieses Modell gerade',
    );
    const posts = () =>
      calls.filter((c) => c.path === `${PROJECT}/amendments/mam_01CONFLICT/withdrawal`);
    expect(posts().map((c) => c.search)).toEqual(['?dryRun=true']);
    await waitFor(() =>
      expect(document.activeElement).toBe(within(confirm).getByTestId('withdraw-confirm-button')),
    );
    await user.click(within(confirm).getByTestId('withdraw-confirm-button'));
    const toast = await findToast('Wert aus dem Quellsystem übernommen');
    expect(toast.textContent).toContain('Das Modell ist jetzt r4, ohne diese Ergänzung.');
    // The withdrawal names the head the dry run showed.
    expect(posts().map((c) => [c.search, c.headers['if-match']])).toEqual([
      ['?dryRun=true', undefined],
      ['?dryRun=false', '"r3"'],
    ]);
  });

  it('„Meine Ergänzung behalten“ starts with the conflicting value and replaces the amendment', async () => {
    const { calls, user } = setup('/projects/demo/open-questions');
    const item = await row('q-00000000000000d4');
    await user.click(
      within(item)
        .getAllByTestId('question-action')
        .find((b) => b.textContent === 'Meine Ergänzung behalten')!,
    );
    const form = await within(item).findByTestId('amend-form');
    await waitFor(() =>
      expect(
        within(form)
          .getAllByTestId('amend-option')
          .find((o) => o.getAttribute('aria-checked') === 'true')?.dataset['ref'],
      ).toBe('b/billing#Process_Billing'),
    );
    expect(within(form).getByTestId('amend-current').textContent).toBe(
      'Bisher: „Process_Neu“ · in analyzr ergänzt',
    );
    // the prefilled value is checked at once
    await within(form).findByTestId('amend-effect', {}, { timeout: 4_000 });
    expect(amendPosts(calls)[0]!.body).toEqual({
      items: [
        {
          elementId: 'Call_9',
          op: 'call-target',
          replaces: 'mam_01CONFLICT',
          target: 'b/billing#Process_Billing',
        },
      ],
    });
  });

  it('withdraws every amendment of the model after asking once', async () => {
    const { calls, user } = setup('/projects/demo/open-questions', {
      routes: {
        [`POST ${M}/amendments/withdrawal`]: (call) =>
          call.search.includes('dryRun=true')
            ? json({
                result: 'withdrawn',
                amendments: [
                  amendment({ id: 'mam_01GONE', state: 'conflict' }),
                  amendment({ id: 'mam_01LIVE' }),
                ],
                model: ORDER,
                revision: null,
                dryRun: true,
                cost: { factsChange: true, pairsToRejudge: 0, taskClaimed: false },
              })
            : json(
                {
                  result: 'withdrawn',
                  amendments: [],
                  model: { ...ORDER, headRev: 4 },
                  revision: revision({ id: 'rev_4', rev: 4 }),
                },
                201,
              ),
      },
    });
    const item = await row('q-00000000000000d5');
    expect(primary(item).textContent).toBe('Ergänzung zurücknehmen');
    await fromMenu(user, item, 'Alle Ergänzungen dieses Modells zurücknehmen');
    const panel = await within(item).findByTestId('withdraw-confirm');
    expect((await within(panel).findByTestId('withdraw-effect')).textContent).toContain(
      'Das Modell bekommt eine neue Revision ohne diese 2 Ergänzungen; sonst ändert sich nichts.',
    );
    const posts = () => calls.filter((c) => c.path === `${M}/amendments/withdrawal`);
    expect(posts().map((c) => c.search)).toEqual(['?dryRun=true']);
    await user.click(within(panel).getByTestId('withdraw-confirm-button'));
    expect(await findToast('Alle Ergänzungen zurückgenommen')).toBeDefined();
    expect(posts().map((c) => c.headers['if-match'])).toEqual([undefined, '"r3"']);
  });

  it('shows no amendment action to a viewer', async () => {
    setup('/projects/demo/open-questions', { role: 'viewer' });
    for (const r of await rows()) expect(within(r).queryByTestId('question-actions')).toBeNull();
  });
});

// ------------------------------------------------------------------ the model view

describe('the model view’s „Ergänzen“, badge and downloads (M6 S5c-2)', () => {
  const live = amendment({ id: 'mam_01LIVE' });
  const ended = amendment({
    id: 'mam_01OLD',
    after: 'Process_Pay',
    state: 'superseded',
    seq: 20,
    withdrawal: { reason: 'superseded', by: 'owner', seq: 30, at: NOW },
  });
  const amendedHead = revision({
    id: ORDER.headRevisionId,
    rev: 3,
    source: {
      kind: 'amendment',
      uploader: 'human',
      upstream: { revisionId: 'rev_UPLOADED', rev: 2, contentHash: HASH },
      amendments: [
        { id: 'mam_01LIVE', elementId: 'Call_1', op: 'call-target', outcome: 'applied' },
      ],
    },
  });
  const routes = (withdrawn: { n: number }) => ({
    ...amendableRoutes({
      Call_1: element('Call_1', [{ ...CALL_FIELD, value: 'Process_Billing', live }], [ended, live]),
    }),
    [`GET ${M}/revisions`]: () =>
      json({
        items: [
          amendedHead,
          revision({ id: 'rev_UPLOADED', rev: 2 }),
          revision({ id: 'rev_1', rev: 1 }),
        ],
        nextCursor: null,
      }),
    [`GET ${M}/revisions/rev_UPLOADED/content`]: () =>
      new Response('<definitions/>', { headers: { 'content-type': 'application/xml' } }),
    [`POST ${PROJECT}/amendments/mam_01LIVE/withdrawal`]: (call: Call) => {
      if (call.search.includes('dryRun=true')) {
        return json({
          result: 'withdrawn',
          amendments: [live],
          model: ORDER,
          revision: null,
          dryRun: true,
          cost: { factsChange: true, pairsToRejudge: 1, taskClaimed: false },
        });
      }
      withdrawn.n += 1;
      return json(
        {
          result: 'withdrawn',
          amendments: [{ ...live, state: 'withdrawn' }],
          model: { ...ORDER, headRev: 4 },
          revision: revision({ id: 'rev_4', rev: 4 }),
        },
        201,
      );
    },
  });

  it('lists the element’s field and history, withdraws with „Zurücknehmen“', async () => {
    const withdrawn = { n: 0 };
    const { user } = setup('/projects/demo/models/a/order?element=Call_1', {
      routes: routes(withdrawn),
    });
    const section = await screen.findByTestId('amend-section');
    const [f] = await within(section).findAllByTestId('amend-section-field');
    expect(f!.dataset['op']).toBe('call-target');
    // A call target by the process's name, its id small.
    expect(within(f!).getByTestId('amend-section-value').textContent).toBe(
      'Prozess „Rechnungsstellung“ (Rechnung) Process_Billing (im Quellsystem: leer)',
    );
    expect(f!.textContent).toContain('angewendet');
    const history = within(section).getAllByTestId('amend-history-item');
    // newest first, with who, before → after and state
    expect(history.map((h) => h.dataset['state'])).toEqual(['applied', 'superseded']);
    expect(history[1]!.textContent).toContain('ersetzt');
    expect(within(history[1]!).queryByTestId('amend-withdraw')).toBeNull();
    // „Zurücknehmen …“ says the cost first, then withdraws; the focus moves to the heading.
    await user.click(within(history[0]!).getByTestId('amend-withdraw'));
    const confirm = await within(history[0]!).findByTestId('withdraw-confirm');
    expect((await within(confirm).findByTestId('withdraw-effect')).textContent).toContain(
      'Die Agenten beurteilen 1 mögliche Relation neu, sobald du den Agenten startest.',
    );
    expect(withdrawn.n).toBe(0);
    await user.click(within(confirm).getByTestId('withdraw-confirm-button'));
    expect(await findToast('Ergänzung zurückgenommen')).toBeDefined();
    expect(withdrawn.n).toBe(1);
    await waitFor(() => expect(document.activeElement?.id).toBe('model-amend'));

    // „Ändern …“ opens the form for this one field, replacing the live amendment; Escape
    // closes it and the focus returns to the button, which stays mounted.
    const edit = within(f!).getByTestId('amend-section-edit');
    await user.click(edit);
    expect(edit.getAttribute('aria-expanded')).toBe('true');
    const form = await within(section).findByTestId('amend-form');
    expect(form).toBeDefined();
    within(form).getAllByRole('button')[0]!.focus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(within(section).queryByTestId('amend-form')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(edit));
  });

  it('shows the badge naming the uploaded revision and downloads the original', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:analyzr');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const { calls, user } = setup('/projects/demo/models/a/order', { routes: routes({ n: 0 }) });
    // the chip in the header (one of at most three, UX3)
    const badge = await screen.findByTestId('amended-badge', {}, { timeout: 10_000 });
    expect(badge.textContent).toBe('In analyzr ergänzt (1) · aus r2');
    // „Mehr“ holds „Herkunft“, „Revisionen“, the downloads and an info line (UX3)
    await user.click(await screen.findByTestId('model-more'));
    expect((await screen.findAllByRole('menuitem')).map((m) => m.textContent)).toEqual([
      'Herkunft …',
      'Revisionen (3) …',
      'BPMN herunterladen',
      'Original herunterladen',
      'Änderungsliste (Markdown)',
      'Änderungsliste (CSV)',
    ]);
    expect(screen.getByTestId('menu-info').textContent).toMatch(/· Kopfrevision r3$/);
    await user.click(screen.getByRole('menuitem', { name: 'Revisionen (3) …' }));
    expect(
      within(await screen.findByTestId('model-revisions'))
        .getAllByTestId('model-revision')
        .map((r) => r.textContent),
    ).toEqual([
      expect.stringMatching(/^r3 · in analyzr ergänzt \(aus r2\) · .* · Kopf$/),
      expect.stringMatching(/^r2 · importiert · /),
      expect.stringMatching(/^r1 · importiert · /),
    ]);
    await user.keyboard('{Escape}');
    await user.click(screen.getByTestId('model-more'));
    await user.click(await screen.findByRole('menuitem', { name: 'Original herunterladen' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('a-order-original-r2.bpmn');
    expect(calls.some((c) => c.path === `${M}/revisions/rev_UPLOADED/content`)).toBe(true);
  });

  it('offers no edit and no withdrawal to a viewer', async () => {
    setup('/projects/demo/models/a/order?element=Call_1', {
      role: 'viewer',
      routes: routes({ n: 0 }),
    });
    const section = await screen.findByTestId('amend-section');
    await within(section).findAllByTestId('amend-section-field');
    expect(within(section).queryByTestId('amend-section-edit')).toBeNull();
    expect(within(section).queryByTestId('amend-withdraw')).toBeNull();
  });

  it('says where a field is changed instead, next to one that can be set', async () => {
    // no open question offers these fields here (with one, its card is the one entry, UX3)
    setup('/projects/demo/models/a/order?element=Call_1', {
      list: [],
      routes: amendableRoutes({
        Call_1: element('Call_1', [
          { ...CALL_FIELD, value: 'Process_Pay', settable: false, reason: 'only-open-questions' },
          {
            ...CALL_FIELD,
            op: 'event-name',
            element: 'end-event',
            typeLabel: 'Endereignis',
            fieldLabel: 'Name',
            suggestions: {},
          },
        ]),
      }),
    });
    const section = await screen.findByTestId('amend-section');
    expect(within(section).getByRole('heading', { level: 3 }).textContent).toBe('Ergänzen');
    expect(within(section).getByTestId('amend-section-reason').textContent).toBe(
      'Diesen Wert änderst du im Quellsystem; ergänzen lässt sich nur, wonach eine offene Frage fragt oder was leer ist.',
    );
  });

  it('leaves out a field an open question of the element offers: its card is the one entry (UX3)', async () => {
    setup('/projects/demo/models/a/order?element=Call_1', {
      routes: amendableRoutes({
        Call_1: element('Call_1', [
          CALL_FIELD,
          {
            ...CALL_FIELD,
            op: 'event-name',
            element: 'end-event',
            typeLabel: 'Endereignis',
            fieldLabel: 'Name',
            suggestions: {},
          },
        ]),
      }),
    });
    const section = await screen.findByTestId('amend-section', {}, { timeout: 10_000 });
    expect(
      within(section)
        .getAllByTestId('amend-section-field')
        .map((f) => f.dataset['op']),
    ).toEqual(['event-name']);
  });

  it('shows no section where nothing can be set and nothing was amended', async () => {
    const { calls } = setup('/projects/demo/models/a/order?element=Call_1', {
      routes: amendableRoutes({
        Call_1: element('Call_1', [
          { ...CALL_FIELD, value: 'Process_Pay', settable: false, reason: 'only-open-questions' },
        ]),
      }),
    });
    await waitFor(() =>
      expect(calls.some((c) => c.path.endsWith('/elements/Call_1/amendable'))).toBe(true),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('amend-section')).toBeNull();
  });
});

// ------------------------------------------------------------------ the models table

describe('the models table’s mark and the change list (M6 S5c-2)', () => {
  it('marks amended models and downloads the change list', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:analyzr');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const { calls, user } = setup('/projects/demo', {
      routes: {
        [`GET ${PROJECT}/amendments`]: () =>
          json({
            items: [
              amendment({ id: 'mam_01A' }),
              amendment({ id: 'mam_01B', elementId: 'Call_2' }),
              amendment({ id: 'mam_01C', state: 'withdrawn' }),
            ],
            seq: 40,
          }),
        [`GET ${PROJECT}/amendments/export`]: () =>
          new Response('# Änderungsliste\n', {
            headers: {
              'content-type': 'text/markdown; charset=utf-8',
              'content-disposition': 'attachment; filename="ergaenzungen-demo.md"',
            },
          }),
      },
    });
    const marked = await screen.findAllByTestId('model-amended');
    expect(marked).toHaveLength(1);
    expect(marked[0]!.closest('[data-testid=model-row]')?.textContent).toContain('a/order');
    expect(marked[0]!.querySelector('[title]')?.getAttribute('title')).toContain(
      '2 Ergänzungen aus analyzr im Kopf',
    );
    // UX1: the change list is an entry of the export hub on „Übersicht“.
    await user.click(await screen.findByTestId('export-hub'));
    const group = within(screen.getByRole('menu', { name: 'Exportieren' })).getByRole('group', {
      name: 'Änderungsliste fürs Quellsystem',
    });
    await user.click(within(group).getByRole('menuitem', { name: 'Markdown' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('ergaenzungen-demo.md');
    const exported = calls.find((c) => c.path === `${PROJECT}/amendments/export`);
    expect(new URLSearchParams(exported?.search).get('format')).toBe('markdown');
  });
});

// ------------------------------------------------------------------ pure helpers

describe('amendment helpers (M6 S5c-2)', () => {
  const none = {
    findingsResolved: [],
    findingsAdded: [],
    accepted: [],
    proposed: [],
    withdrawn: [],
    partnerAccepted: [],
    changed: [],
    retired: [],
  };
  const rel = { relation: null, type: 'message' as const, from: 'a#x', to: 'b#y' };

  it('names the effect, and the cost in a sentence of its own', () => {
    expect(
      effectSentence({
        effect: none,
        cost: { factsChange: false, pairsToRejudge: 0, taskClaimed: false },
      }),
    ).toBe('Danach: sonst ändert sich nichts.');
    expect(
      effectSentence({
        effect: {
          ...none,
          proposed: [rel, rel],
          partnerAccepted: [rel],
          changed: [rel],
          retired: [rel],
          findingsAdded: [{ kind: 'dangling-throw', refs: ['a#x'], detail: '' }],
          withdrawn: [rel, rel],
        },
        cost: { factsChange: true, pairsToRejudge: 1, taskClaimed: false },
      }),
    ).toBe(
      'Danach: 1 Vorschlag zum gewählten Partner angenommen, 2 neue Vorschläge zum Prüfen, 1 neuer Befund, 2 Relationen entfallen, 1 angenommene Relation muss neu bestätigt werden, 1 manuelle Verknüpfung durch die Ergänzung ersetzt. Die Agenten beurteilen 1 mögliche Relation neu, sobald du den Agenten startest.',
    );
    expect(
      effectSentence({
        effect: none,
        cost: { factsChange: true, pairsToRejudge: 1214, taskClaimed: true },
      }),
    ).toBe('Die Agenten beurteilen 1.214 mögliche Relationen neu, sobald du den Agenten startest.');
  });

  it('normalizes a value as the server stores it', () => {
    expect(normalizeAmendmentValue('event-name', ' a \r\n b\u200E ')).toEqual({
      ok: true,
      value: 'a b',
    });
    expect(
      normalizeAmendmentValue('process-documentation', 'Zeile 1 \r\n\r\n\r\nZeile  2'),
    ).toEqual({
      ok: true,
      value: 'Zeile 1\n\nZeile 2',
    });
    expect(normalizeAmendmentValue('message-name', '${name}')).toEqual({
      ok: false,
      problem: 'expression',
    });
    expect(normalizeAmendmentValue('event-name', 'x'.repeat(201))).toEqual({
      ok: false,
      problem: 'too-long',
    });
    expect(normalizeAmendmentValue('event-name', '   ')).toEqual({ ok: false, problem: 'empty' });
    expect(normalizeAmendmentValue('event-name', '=x')).toEqual({ ok: true, value: '=x' });
  });

  it('reads the head’s plan: counts, the elements written, the origin', () => {
    const source = {
      kind: 'amendment' as const,
      upstream: { revisionId: 'rev_U', rev: 3, contentHash: HASH },
      amendments: [
        {
          id: 'mam_1',
          elementId: 'Call_1',
          op: 'call-target' as const,
          outcome: 'applied' as const,
        },
        {
          id: 'mam_2',
          elementId: 'Msg_1',
          op: 'message-name' as const,
          outcome: 'applied' as const,
        },
        {
          id: 'mam_3',
          elementId: 'End_1',
          op: 'event-name' as const,
          outcome: 'in-source' as const,
        },
        {
          id: 'mam_4',
          elementId: 'Call_2',
          op: 'call-target' as const,
          outcome: 'conflict' as const,
          reason: 'value-changed' as const,
        },
      ],
    };
    expect(planCounts(source)).toEqual({ applied: 2, inSource: 1, conflicts: 1 });
    expect(amendedElements(source)).toEqual(['Call_1', 'Msg_1']);
    expect(revisionOrigin({ source })).toBe('in analyzr ergänzt (aus r3)');
    expect(revisionOrigin({ source: { kind: 'upload' } })).toBe('hochgeladen');
    expect(planCounts(undefined)).toEqual({ applied: 0, inSource: 0, conflicts: 0 });
  });

  it('says what became of a model’s amendments at an upload', () => {
    const g = (count: number) => ({ count, ids: [] });
    expect(amendmentCountsText(undefined)).toBeNull();
    expect(amendmentCountsText({ applied: g(2), inSource: g(0), conflicts: g(1) })).toBe(
      '2 Ergänzungen angewendet, 1 Konflikt',
    );
    expect(amendmentCountsText({ applied: g(1), inSource: g(1), conflicts: g(2) })).toBe(
      '1 Ergänzung angewendet, 1 im Quellsystem übernommen, 2 Konflikte',
    );
  });

  it('shows a message’s amendment at every shape that references it', () => {
    const root: DiagramElement = { id: 'Process_A', type: 'bpmn:Process' };
    const throwEvent: DiagramElement = {
      id: 'Throw_1',
      type: 'bpmn:IntermediateThrowEvent',
      parent: root,
      businessObject: { eventDefinitions: [{ messageRef: { id: 'Message_1' } }] },
    };
    const label: DiagramElement = {
      id: 'Throw_1_label',
      type: 'label',
      parent: root,
      businessObject: { eventDefinitions: [{ messageRef: { id: 'Message_1' } }] },
    };
    const task: DiagramElement = {
      id: 'Receive_1',
      type: 'bpmn:ReceiveTask',
      parent: root,
      businessObject: { messageRef: { id: 'Message_1' } },
    };
    const signal: DiagramElement = {
      id: 'Signal_End',
      type: 'bpmn:EndEvent',
      parent: root,
      businessObject: { eventDefinitions: [{ signalRef: { id: 'Signal_1' } }] },
    };
    const all = [root, throwEvent, label, task, signal];
    const registry = {
      get: (id: string) => all.find((e) => e.id === id),
      filter: (fn: (e: DiagramElement) => boolean) => all.filter(fn),
    };
    expect(resolveAmended(registry, 'Message_1').map((e) => e.id)).toEqual([
      'Throw_1',
      'Receive_1',
    ]);
    expect(resolveAmended(registry, 'Signal_1').map((e) => e.id)).toEqual(['Signal_End']);
    expect(resolveAmended(registry, 'Throw_1').map((e) => e.id)).toEqual(['Throw_1']);
    expect(resolveAmended(registry, 'Process_A')).toEqual([]);
  });
});

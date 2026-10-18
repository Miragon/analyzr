/**
 * Answering by action (M6 §4.8 a, S5c-1) in the tab „Offene Fragen“ and the
 * model view's section: the primary action as the button and the others
 * under „Weitere Aktionen“ (reviewers only), the pickers („Vorgeschlagen“
 * first; processes as „Name (Modell)“, the complementary endpoints, the
 * steps with „außerhalb der Kette“, the listed pairs, the copies), the
 * sentence naming what an action writes before it runs (the proposals it
 * accepts by name), a `decide` decided where the diagrams are (UX2b, owner
 * decision 26, Q4: a hold's „Antwort geben“ and „Jetzt entscheiden“, an
 * agent's question's „Vorschlag öffnen“), a refusal in German, the one-click outside mark and its withdrawal,
 * „Rückgängig“ after every action that wrote a manual relation or placement
 * (one bulk decision; none after one that decided proposals), requeue,
 * „Link korrigieren“, the focus moving on, and „Verknüpfen mit …“ on a
 * collapsed subprocess in the model view (its button, focus and undo).
 */
import type {
  Health,
  Landscape,
  Model,
  OpenQuestion,
  Placement,
  Project,
  Relation,
  RevisionFacts,
} from '@analyzr/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { App } from '../src/app';
import SubprocessLink from '../src/components/open-questions/subprocess-link';
import { Toaster } from '../src/components/toaster';
import { collapsedSubprocess } from '../src/lib/open-question-pickers';
import {
  factsQuery,
  healthQuery,
  landscapeQuery,
  modelsQuery,
  projectQuery,
  projectsQuery,
} from '../src/lib/queries';
import { buildRefIndex, resolverOf } from '../src/lib/refs';
import { createAppRouter } from '../src/router';
import {
  chainDetail,
  fact,
  model,
  openQuestion,
  openQuestionAnswer,
  placement,
  relation,
  step,
  openQuestionPage,
} from './support/fixtures';
import { findToast, json, stubApi, type Call } from './support/render';

const PROJECT = '/api/v1/projects/demo';
const BASE = `${PROJECT}/open-questions`;
const LOCAL: Health = { status: 'ok', version: '0.1.0-test', db: 'ok' };
const NOW = '2026-10-17T10:00:00.000Z';

type Action = OpenQuestion['actions'][number];
const NOTE: Action = { type: 'note', primary: false, label: 'Notiz hinzufügen' };
const OUTSIDE = (primary: boolean): Action => ({
  type: 'outside',
  primary,
  label: 'Liegt außerhalb der Landschaft',
});

// ------------------------------------------------------------------ the landscape

const models: Model[] = ['a/order', 'b/billing', 'c/payment', 'd/dup', 'e/dup'].map((key) =>
  model({ key }),
);

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
    revisionId: models[0]!.headRevisionId,
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
        elementId: 'Call_2',
        kind: 'call',
        label: 'Ziel nach Land',
        processId: 'Process_Order',
      }),
      fact({
        modelKey: 'a/order',
        elementId: 'Send_Invoice',
        kind: 'msg_throw',
        eventDef: 'message',
        label: 'Rechnung senden',
        processId: 'Process_Order',
        attrs: { elementType: 'bpmn:IntermediateThrowEvent' },
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
        elementId: 'Process_Billing',
        kind: 'process',
        processId: null,
      }),
      fact({
        modelKey: 'b/billing',
        elementId: 'Catch_Invoice',
        kind: 'msg_catch',
        eventDef: 'message',
        label: 'Rechnung empfangen',
        processId: 'Process_Billing',
        attrs: { elementType: 'bpmn:StartEvent' },
      }),
      fact({
        modelKey: 'b/billing',
        elementId: 'Send_Reminder',
        kind: 'msg_throw',
        eventDef: 'message',
        label: 'Mahnung senden',
        processId: 'Process_Billing',
        attrs: { elementType: 'bpmn:IntermediateThrowEvent' },
      }),
    ],
    messageFlows: [],
  },
  {
    modelKey: 'c/payment',
    revisionId: models[2]!.headRevisionId,
    factsVersion: '1',
    processes: [proc('c/payment', 'Process_Pay', 'Zahlungsdienst')],
    facts: [
      fact({ modelKey: 'c/payment', elementId: 'Process_Pay', kind: 'process', processId: null }),
    ],
    messageFlows: [],
  },
  {
    modelKey: 'd/dup',
    revisionId: models[3]!.headRevisionId,
    factsVersion: '1',
    processes: [proc('d/dup', 'Process_Dup', 'Auftrag prüfen (alt)')],
    facts: [
      fact({ modelKey: 'd/dup', elementId: 'Process_Dup', kind: 'process', processId: null }),
    ],
    messageFlows: [],
  },
  {
    modelKey: 'e/dup',
    revisionId: models[4]!.headRevisionId,
    factsVersion: '1',
    processes: [proc('e/dup', 'Process_Dup', 'Auftrag prüfen')],
    facts: [
      fact({ modelKey: 'e/dup', elementId: 'Process_Dup', kind: 'process', processId: null }),
    ],
    messageFlows: [],
  },
];

const STEPS = [
  step({ elementId: 'step-vertrieb', name: 'Vertrieb', rank: 0 }),
  step({ elementId: 'step-einkauf', name: 'Einkauf', rank: 1 }),
  step({ elementId: 'step-x', name: 'Altsystem', rank: 2 }),
];

const PROPOSED: Placement = placement({
  id: 'plc_01PROP',
  elementId: 'step-vertrieb',
  stepName: 'Vertrieb',
  process: 'c/payment#Process_Pay',
  processName: 'Zahlungsdienst',
});

const HELD: Relation = relation({
  id: 'rel_01HELD',
  from: 'a/order#Send_Invoice',
  to: 'b/billing#Catch_Invoice',
  status: 'held',
});

// ------------------------------------------------------------------ the items

/** Every action type, as the server computes them for the fixtures (`actions.ts`). */
function fixtures(): OpenQuestion[] {
  return [
    openQuestion({
      id: 'q-00000000000000b1',
      kind: 'held',
      source: 'hold',
      subject: { type: 'relation', id: 'rel_01HELD' },
      subjectLabel: '„Rechnung senden“ → „Rechnung empfangen“',
      modelKeys: ['a/order', 'b/billing'],
      text: 'Wer verschickt die Rechnung?',
      refs: ['a/order#Send_Invoice', 'b/billing#Catch_Invoice'],
      raisedBy: { sourceKind: 'human', handle: 'owner', seq: 12 },
      unlocks: 9,
      actions: [
        {
          type: 'decide',
          primary: true,
          label: 'Vorschlag prüfen',
          decides: [{ type: 'relation', id: 'rel_01HELD', version: 1 }],
        },
        NOTE,
      ],
    }),
    openQuestion({
      id: 'q-00000000000000b2',
      kind: 'call-target-unknown',
      subject: { type: 'ref', id: 'a/order#Call_1' },
      unlocks: 8,
      actions: [
        {
          type: 'link',
          primary: true,
          label: 'Verknüpfen mit …',
          pick: 'process',
          suggested: ['c/payment#Process_Pay'],
          proposals: [
            {
              target: 'c/payment#Process_Pay',
              relation: 'rel_01SUGG',
              type: 'call',
              from: 'a/order#Call_1',
              to: 'c/payment#Process_Pay',
            },
          ],
          exclude: ['a/order#Process_Order'],
        },
        OUTSIDE(false),
        NOTE,
      ],
    }),
    openQuestion({
      id: 'q-00000000000000b3',
      kind: 'call-target-dynamic',
      subject: { type: 'ref', id: 'a/order#Call_2' },
      subjectLabel: '„Ziel nach Land“',
      refs: ['a/order#Call_2'],
      unlocks: 7,
      actions: [
        {
          type: 'link',
          primary: true,
          label: 'Mögliche Ziele verknüpfen …',
          pick: 'process',
          multiple: true,
          suggested: [],
        },
        OUTSIDE(false),
        NOTE,
      ],
    }),
    openQuestion({
      id: 'q-00000000000000b4',
      kind: 'message-partner-missing',
      subject: { type: 'ref', id: 'a/order#Send_Invoice' },
      subjectLabel: '„Rechnung senden“',
      refs: ['a/order#Send_Invoice'],
      unlocks: 6,
      actions: [
        { type: 'link', primary: true, label: 'Verknüpfen mit …', pick: 'endpoint', suggested: [] },
        OUTSIDE(false),
        NOTE,
      ],
    }),
    openQuestion({
      id: 'q-00000000000000b5',
      kind: 'duplicate-process-id',
      subject: { type: 'process', id: 'd/dup#Process_Dup' },
      subjectLabel: 'Prozess-ID „Process_Dup“',
      modelKeys: ['d/dup', 'e/dup'],
      refs: ['d/dup#Process_Dup', 'e/dup#Process_Dup'],
      unlocks: 5,
      actions: [
        {
          type: 'choose-copy',
          primary: true,
          label: 'Gültige Kopie wählen …',
          pick: 'process',
          choices: ['d/dup#Process_Dup', 'e/dup#Process_Dup'],
          decides: [
            { type: 'relation', id: 'rel_01CALLD', version: 2 },
            { type: 'relation', id: 'rel_01CALLE', version: 1 },
          ],
        },
      ],
    }),
    openQuestion({
      id: 'q-00000000000000b6',
      kind: 'black-box-partner',
      source: 'signal',
      subject: { type: 'ref', id: 'a/order#Participant_Carrier' },
      subjectLabel: 'Pool „Participant_Carrier“',
      refs: ['a/order#Participant_Carrier'],
      unlocks: 4,
      actions: [
        OUTSIDE(true),
        { type: 'link', primary: false, label: 'Verknüpfen mit …', pick: 'process', suggested: [] },
        NOTE,
      ],
    }),
    openQuestion({
      id: 'q-00000000000000b7',
      kind: 'unjudged',
      source: 'unjudged',
      subject: { type: 'model', id: 'a/order' },
      subjectLabel: '„Auftrag“',
      refs: ['a/order#Send_Invoice', 'b/billing#Catch_Invoice'],
      unlocks: 3,
      actions: [
        { type: 'requeue', primary: true, label: 'Erneut einplanen' },
        {
          type: 'link',
          primary: false,
          label: 'Paar verknüpfen …',
          pick: 'pair',
          pairs: [{ type: 'message', from: 'a/order#Send_Invoice', to: 'b/billing#Catch_Invoice' }],
        },
        NOTE,
      ],
    }),
    openQuestion({
      id: 'q-00000000000000b8',
      kind: 'agent-question',
      source: 'agent-question',
      group: 'agent',
      subject: { type: 'placement', id: 'plc_01PROP' },
      subjectLabel: '„Zahlungsdienst“ auf „Vertrieb“',
      modelKeys: ['c/payment'],
      text: 'Gehört der Zahlungsdienst zum Vertrieb?',
      refs: ['c/payment#Process_Pay'],
      raisedBy: { sourceKind: 'agent', handle: 'agent:sim', seq: 10 },
      unlocks: 2,
      actions: [
        {
          type: 'decide',
          primary: true,
          label: 'Vorschlag prüfen',
          decides: [{ type: 'placement', id: 'plc_01PROP', version: 1 }],
        },
        NOTE,
      ],
    }),
    openQuestion({
      id: 'q-00000000000000c1',
      kind: 'process-without-step',
      source: 'value-chain-finding',
      subject: { type: 'process', id: 'b/billing#Process_Billing' },
      subjectLabel: '„Rechnungsstellung“',
      modelKeys: ['b/billing'],
      refs: ['b/billing#Process_Billing'],
      unlocks: 1,
      actions: [
        { type: 'place', primary: true, label: 'Schritt wählen …', pick: 'step' },
        { type: 'place', primary: false, label: 'Gehört zu keinem Schritt', step: '@outside' },
        NOTE,
      ],
    }),
    openQuestion({
      id: 'q-00000000000000c2',
      kind: 'step-without-process',
      source: 'value-chain-finding',
      subject: { type: 'step', id: 'step-einkauf' },
      subjectLabel: '„Einkauf“',
      modelKeys: [],
      refs: [],
      unlocks: 1,
      actions: [
        { type: 'place', primary: true, label: 'Prozess platzieren …', pick: 'process' },
        OUTSIDE(false),
        NOTE,
      ],
    }),
    openQuestion({
      id: 'q-00000000000000c3',
      kind: 'unresolved-link',
      source: 'value-chain-finding',
      subject: { type: 'step', id: 'step-x' },
      subjectLabel: '„Altsystem“',
      modelKeys: [],
      refs: [],
      unlocks: 0,
      actions: [{ type: 'fix-link', primary: true, label: 'Link korrigieren' }, NOTE],
    }),
    openQuestion({
      id: 'q-00000000000000c4',
      kind: 'undocumented-process',
      source: 'signal',
      subject: { type: 'process', id: 'c/payment#Process_Pay' },
      subjectLabel: '„Zahlungsdienst“',
      modelKeys: ['c/payment'],
      refs: ['c/payment#Process_Pay'],
      unlocks: 0,
      actions: [{ type: 'note', primary: true, label: 'Notiz hinzufügen' }],
    }),
    openQuestion({
      id: 'q-00000000000000c5',
      kind: 'summary-note',
      source: 'summary',
      group: 'info',
      subject: { type: 'model', id: 'a/order' },
      subjectLabel: '„Auftrag“',
      text: 'Zwei Nachrichten ohne Gegenstück.',
      refs: [],
      unlocks: 0,
      actions: [],
    }),
  ];
}

const short = (id: string) => id.slice(-2);

function project(role: Project['role']): Project {
  return { id: 'prj_01DEMO', key: 'demo', name: 'Demo', role, lastSeq: 12, createdAt: NOW };
}

/** The server's list: the full list, the tab's count (`limit=1`) and a model's items. */
function listRoute(list: readonly OpenQuestion[]) {
  return (call: Call) => json(openQuestionPage(list, call.search));
}

/**
 * The action route over a list that changes like the server's: `outside`
 * marks the item (a second click is `unchanged`), every other action takes
 * it off the list; a `link` to a suggested target accepts the proposal
 * (`decision`), any other writes a manual relation; `place` a manual
 * placement; `choose-copy` decides the calls.
 */
function actionRoutes(list: OpenQuestion[]) {
  const routes: Parameters<typeof stubApi>[0] = {};
  let n = 0;
  const take = (id: string) => {
    const at = list.findIndex((x) => x.id === id);
    if (at >= 0) list.splice(at, 1);
  };
  for (const q of list) {
    routes[`POST ${BASE}/${q.id}/actions`] = (call) => {
      const current = list.find((x) => x.id === q.id);
      if (!current) return json({ title: 'Not Found', status: 404, code: 'not-found' }, 404);
      const body = call.body as {
        type: string;
        targets?: string[];
        pair?: { from: string; to: string };
        step?: string;
        process?: string;
        items?: { id: string; version: number }[];
        placeOthersOutside?: boolean;
        note?: string;
      };
      const empty = { relations: [], placements: [], answer: null, warnings: [] };
      if (body.type === 'outside') {
        const live = current.answers.find(
          (a) => a.role === 'outside-mark' && a.withdrawal === null,
        );
        if (live)
          return json({ ...empty, result: 'unchanged', question: current, answer: live }, 200);
        const answer = openQuestionAnswer({
          id: 'oqa_01MARK',
          questionId: q.id,
          kind: 'outside-landscape',
          role: 'outside-mark',
          text: body.note ?? null,
          seq: 40,
        });
        const question: OpenQuestion = {
          ...current,
          state: 'answered',
          answers: [...current.answers, answer],
        };
        list[list.indexOf(current)] = question;
        return json({ ...empty, result: 'applied', question, answer }, 201);
      }
      take(q.id);
      if (body.type === 'link') {
        const action = current.actions.find((a) => a.type === 'link')!;
        const pairs = body.pair
          ? [body.pair]
          : (body.targets ?? []).map((to) => ({ from: current.subject.id, to }));
        const relations = pairs.map((p) => {
          const suggested = action.suggested?.includes(p.to) ?? false;
          return {
            effect: suggested ? 'decision' : 'manual',
            relation: relation({
              id: suggested ? 'rel_01SUGG' : `rel_01MAN${++n}`,
              from: p.from,
              to: p.to,
              type: suggested ? 'call' : 'manual',
              status: 'accepted',
              tier: suggested ? 'rule' : 'manual',
              version: suggested ? 2 : 1,
            }),
          };
        });
        return json({ ...empty, result: 'applied', question: null, relations }, 201);
      }
      if (body.type === 'place') {
        const placed = placement({
          id: 'plc_01MAN',
          elementId: body.step!,
          stepName: STEPS.find((s) => s.elementId === body.step)?.name ?? null,
          process: body.process ?? current.subject.id,
          processName: null,
          status: 'accepted',
          tier: 'manual',
          version: 1,
        });
        return json(
          {
            ...empty,
            result: 'applied',
            question: null,
            placements: [{ effect: 'manual', placement: placed }],
          },
          201,
        );
      }
      // choose-copy: the first call accepted towards the copy, the other rejected
      const relations = (body.items ?? []).map((item, i) => ({
        effect: 'decision',
        relation: relation({
          id: item.id,
          from: `x/caller#Call_${i}`,
          to: i === 0 ? body.process! : 'e/dup#Process_Dup',
          type: 'call',
          status: i === 0 ? 'accepted' : 'rejected',
          version: item.version + 1,
        }),
      }));
      const placements = body.placeOthersOutside
        ? [
            {
              effect: 'manual',
              placement: placement({
                id: 'plc_01OUT',
                elementId: '@outside',
                process: 'e/dup#Process_Dup',
                status: 'accepted',
                tier: 'manual',
              }),
            },
          ]
        : [];
      return json({ ...empty, result: 'applied', question: null, relations, placements }, 201);
    };
    routes[`POST ${BASE}/${q.id}/answers/oqa_01MARK/withdrawal`] = () => {
      const current = list.find((x) => x.id === q.id)!;
      const answers = current.answers.map((a) =>
        a.id === 'oqa_01MARK' ? { ...a, withdrawal: { by: 'owner', seq: 41, at: NOW } } : a,
      );
      const question: OpenQuestion = { ...current, state: 'open', answers };
      list[list.indexOf(current)] = question;
      return json(
        { result: 'withdrawn', answer: answers.find((a) => a.id === 'oqa_01MARK'), question },
        201,
      );
    };
  }
  return routes;
}

/** Decisions (the inline panels and „Rückgängig“), recorded; a decided item leaves the list. */
function decisionRoutes(list: OpenQuestion[]) {
  const decided = (subject: string) => {
    const at = list.findIndex((q) => q.subject.id === subject);
    if (at >= 0) list.splice(at, 1);
  };
  const routes: Parameters<typeof stubApi>[0] = {
    [`GET ${PROJECT}/relations/rel_01HELD`]: () => json(HELD),
    [`POST ${PROJECT}/relations/rel_01HELD/decision`]: () => {
      decided('rel_01HELD');
      return json({ relation: { ...HELD, status: 'accepted', version: 2 }, corrected: null });
    },
    [`POST ${PROJECT}/value-chains/main/placements/plc_01PROP/decision`]: () => {
      decided('plc_01PROP');
      return json({
        placement: { ...PROPOSED, status: 'accepted', version: 2 },
        corrected: null,
      });
    },
    [`POST ${PROJECT}/value-chains/main/placements/plc_01MAN/decision`]: () =>
      json({ placement: { ...PROPOSED, id: 'plc_01MAN', status: 'rejected' }, corrected: null }),
  };
  // „Rückgängig“ rejects what a link wrote in one bulk decision, all or nothing.
  routes[`POST ${PROJECT}/decisions`] = (call) => {
    const body = call.body as { items: { id: string; version: number }[] };
    return json({
      items: body.items.map(({ id }) =>
        relation({ id, from: 'a/order#Call_1', to: 'x', status: 'rejected' }),
      ),
    });
  };
  return routes;
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
    [`GET ${PROJECT}/value-chains/main`]: () =>
      json(chainDetail({ steps: STEPS, placements: [PROPOSED] })),
    [`GET ${PROJECT}/value-chains/main/placements`]: () =>
      json({ items: [PROPOSED], nextCursor: null }),
    [`POST ${PROJECT}/analyses/requeue`]: () =>
      json({ items: [{ modelKey: 'a/order', outcome: 'queued', taskId: 'tsk_01NEW' }] }),
    [`GET ${BASE}`]: listRoute(list),
    ...actionRoutes(list),
    ...decisionRoutes(list),
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
  const found = (await rows()).find((r) => r.dataset['questionId'] === id);
  if (!found) throw new Error(`no item ${id}`);
  return found;
};
const primary = (item: HTMLElement) =>
  within(item)
    .getAllByTestId('question-action')
    .find((b) => b.dataset['primary'] === 'true')!;
const posts = (calls: readonly Call[], path: string) =>
  calls.filter((c) => c.method === 'POST' && c.path === path);
const options = (panel: HTMLElement) =>
  within(panel)
    .getAllByTestId('action-option')
    .map((o) => o.dataset['ref'] ?? o.dataset['step'] ?? o.dataset['pair']);
const sections = (panel: HTMLElement) =>
  within(panel)
    .queryAllByTestId('picker-section')
    .map((s) => s.textContent);

async function fromMenu(user: ReturnType<typeof userEvent.setup>, item: HTMLElement, name: string) {
  await user.click(within(item).getByTestId('question-more-actions'));
  await user.click(await screen.findByRole('menuitem', { name }));
}

const toastAction = async (title: string) =>
  within(await findToast(title)).getByTestId('toast-action');

// ------------------------------------------------------------------ the tab

describe('actions in the tab „Offene Fragen“ (M6 S5c-1)', () => {
  it('shows the primary action as the button and the others under „Weitere Aktionen“', async () => {
    const { user } = setup('/projects/demo/open-questions');
    const all = await rows();
    // „Zu klären“ only: the agent's question sits on its proposal, the summary is closed
    expect(
      all.map((r) => [
        short(r.dataset['questionId']!),
        within(r)
          .queryAllByTestId('question-action')
          .filter((b) => b.dataset['primary'] === 'true')
          .map((b) => b.textContent),
      ]),
    ).toEqual([
      ['b1', ['Antwort geben']],
      ['b2', ['Verknüpfen mit …']],
      ['b3', ['Mögliche Ziele verknüpfen …']],
      ['b4', ['Verknüpfen mit …']],
      ['b5', ['Gültige Kopie wählen …']],
      ['b6', ['Liegt außerhalb der Landschaft']],
      ['b7', ['Erneut einplanen']],
      ['c1', ['Schritt wählen …']],
      ['c2', ['Prozess platzieren …']],
      ['c3', ['Link korrigieren']],
      ['c4', ['Notiz hinzufügen']],
    ]);
    // nothing to classify: an item with a single action has no menu
    expect(within(all[4]!).queryByTestId('question-more-actions')).toBeNull();
    expect(within(all[10]!).queryByTestId('question-more-actions')).toBeNull();
    // the secondary ones are menu items, the id last
    await user.click(within(all[7]!).getByTestId('question-more-actions'));
    expect((await screen.findAllByRole('menuitem')).map((m) => m.textContent)).toEqual([
      'Gehört zu keinem Schritt',
      'Notiz hinzufügen',
      'Kennung kopieren',
    ]);
  });

  it('link: picks a process, „Vorgeschlagen“ first, names what it writes, and „Rückgängig“ rejects it', async () => {
    const { calls, user } = setup('/projects/demo/open-questions');
    const item = await row('q-00000000000000b2');
    const button = primary(item);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await user.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const panel = within(item).getByTestId('question-action-panel');
    expect(button.getAttribute('aria-controls')).toBe(panel.id);
    // „Name – Modell“, the suggested first, then the rest by name (UX4), the item's own
    // process left out
    expect(options(panel)).toEqual([
      'c/payment#Process_Pay',
      'e/dup#Process_Dup',
      'd/dup#Process_Dup',
      'b/billing#Process_Billing',
    ]);
    expect(sections(panel)).toEqual(['Vorgeschlagen', 'Alle Prozesse']);
    expect(within(panel).getAllByTestId('action-option')[0]!.textContent).toBe(
      'Zahlungsdienst – c/payment, vorgeschlagen',
    );
    // the search field has the focus and narrows the list
    expect(document.activeElement).toBe(within(panel).getByLabelText('Prozess suchen'));
    expect(within(panel).getByTestId('action-submit')).toHaveProperty('disabled', true);
    await user.click(within(panel).getAllByTestId('action-option')[0]!);
    expect(within(panel).getByTestId('action-preview').textContent).toBe(
      'Nimmt den Vorschlag „Zahlung abwickeln“ → „Zahlungsdienst“ an.',
    );
    await user.click(within(panel).getAllByTestId('action-option')[3]!);
    expect(within(panel).getByTestId('action-preview').textContent).toBe(
      'Legt eine angenommene Relation „Zahlung abwickeln“ → „Rechnungsstellung“ an.',
    );
    // „+ Notiz“ opens the note (UX4)
    expect(within(panel).queryByTestId('action-note')).toBeNull();
    await user.click(within(panel).getByTestId('action-note-toggle'));
    await user.type(within(panel).getByTestId('action-note'), '  Laut Fachbereich.  ');
    await user.click(within(panel).getByTestId('action-submit'));

    const undo = await toastAction('Verknüpft');
    expect(undo.textContent).toBe('Rückgängig');
    expect((await findToast('Verknüpft')).textContent).toContain(
      'Angenommene Relation „Zahlung abwickeln“ → „Rechnungsstellung“ angelegt.',
    );
    expect(posts(calls, `${BASE}/q-00000000000000b2/actions`)[0]!.body).toEqual({
      type: 'link',
      targets: ['b/billing#Process_Billing'],
      note: 'Laut Fachbereich.',
    });
    // the item left the list
    await waitFor(async () =>
      expect((await rows()).map((r) => r.dataset['questionId'])).not.toContain(
        'q-00000000000000b2',
      ),
    );
    await user.click(undo);
    expect((await findToast('Rückgängig gemacht')).textContent).toContain(
      'Die Relation ist abgelehnt; die Frage ist wieder offen.',
    );
    expect(posts(calls, `${PROJECT}/decisions`)[0]!.body).toEqual({
      verdict: 'reject',
      reason: 'Rückgängig gemacht',
      expectedCount: 1,
      items: [{ id: 'rel_01MAN1', version: 1 }],
    });
  });

  it('link: accepting a live proposal has no „Rückgängig“; the toast leads to the decision', async () => {
    const { router, user } = setup('/projects/demo/open-questions');
    const item = await row('q-00000000000000b2');
    await user.click(primary(item));
    const panel = within(item).getByTestId('question-action-panel');
    await user.click(within(panel).getAllByTestId('action-option')[0]!);
    await user.click(within(panel).getByTestId('action-submit'));
    const toast = await findToast('Verknüpft');
    expect(toast.textContent).toContain(
      'Vorschlag „Zahlung abwickeln“ → „Zahlungsdienst“ angenommen.',
    );
    const go = within(toast).getByTestId('toast-action');
    expect(go.textContent).toBe('Entscheidung ansehen');
    await user.click(go);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/projects/demo/review/rel_01SUGG'),
    );
  });

  it('link: several possible targets at once (call-target-dynamic)', async () => {
    const { calls, user } = setup('/projects/demo/open-questions');
    const item = await row('q-00000000000000b3');
    await user.click(primary(item));
    const panel = within(item).getByTestId('question-action-panel');
    const boxes = within(panel).getAllByRole('checkbox');
    expect(boxes).toHaveLength(4);
    expect(within(panel).getByText('0 von höchstens 10 gewählt')).toBeDefined();
    await user.click(boxes[2]!);
    await user.click(boxes[3]!);
    expect(within(panel).getByText('2 von höchstens 10 gewählt')).toBeDefined();
    expect(
      within(panel).getByTestId('action-preview').textContent.split('an.').filter(Boolean),
    ).toHaveLength(2);
    await user.click(within(panel).getByTestId('action-submit'));
    expect((await findToast('Verknüpft')).textContent).toContain(
      '2 angenommene Relationen angelegt.',
    );
    expect(posts(calls, `${BASE}/q-00000000000000b3/actions`)[0]!.body).toEqual({
      type: 'link',
      targets: ['b/billing#Process_Billing', 'c/payment#Process_Pay'],
    });
  });

  it('link: a message endpoint picks the complementary endpoints of other processes, or a whole process', async () => {
    const { calls, user } = setup('/projects/demo/open-questions');
    const item = await row('q-00000000000000b4');
    await user.click(primary(item));
    const panel = within(item).getByTestId('question-action-panel');
    // a thrown message: the catches of other processes, then whole processes; no throw; the
    // best fits to „Rechnung senden“ first (UX4)
    expect(options(panel)).toEqual([
      'b/billing#Catch_Invoice',
      'b/billing#Process_Billing',
      'e/dup#Process_Dup',
      'd/dup#Process_Dup',
      'c/payment#Process_Pay',
    ]);
    expect(sections(panel)).toEqual(['Passt vermutlich', 'Ganzer Prozess']);
    await user.click(within(panel).getAllByTestId('action-option')[0]!);
    expect(within(panel).getByTestId('action-preview').textContent).toBe(
      'Legt eine angenommene Relation „Rechnung senden“ → „Rechnung empfangen“ an.',
    );
    await user.click(within(panel).getByTestId('action-submit'));
    expect(await findToast('Verknüpft')).toBeDefined();
    expect(posts(calls, `${BASE}/q-00000000000000b4/actions`)[0]!.body).toEqual({
      type: 'link',
      targets: ['b/billing#Catch_Invoice'],
    });
  });

  it('link: one of the pairs an analysis left unjudged, from „Weitere Aktionen“', async () => {
    const { calls, user } = setup('/projects/demo/open-questions');
    const item = await row('q-00000000000000b7');
    await fromMenu(user, item, 'Paar verknüpfen …');
    const panel = await within(item).findByTestId('question-action-panel');
    const [pair] = within(panel).getAllByTestId('action-option');
    expect(pair!.textContent).toBe('„Rechnung senden“ → „Rechnung empfangen“ (Nachricht)');
    // the menu hands the focus to the panel's search, not back to the menu
    await waitFor(() =>
      expect(document.activeElement).toBe(within(panel).getByLabelText('Paar suchen')),
    );
    await user.click(pair!);
    expect(within(panel).getByTestId('action-preview').textContent).toContain(
      'Verknüpft „Rechnung senden“ → „Rechnung empfangen“',
    );
    await user.click(within(panel).getByTestId('action-submit'));
    expect(await findToast('Verknüpft')).toBeDefined();
    expect(posts(calls, `${BASE}/q-00000000000000b7/actions`)[0]!.body).toEqual({
      type: 'link',
      pair: { from: 'a/order#Send_Invoice', to: 'b/billing#Catch_Invoice' },
    });
  });

  it('place: picks a step (also „außerhalb der Kette“), and „Rückgängig“ rejects the placement', async () => {
    const { calls, user } = setup('/projects/demo/open-questions');
    const item = await row('q-00000000000000c1');
    await user.click(primary(item));
    const panel = within(item).getByTestId('question-action-panel');
    await waitFor(() =>
      expect(options(panel)).toEqual(['step-vertrieb', 'step-einkauf', 'step-x', '@outside']),
    );
    await user.click(within(panel).getAllByTestId('action-option')[1]!);
    expect(within(panel).getByTestId('action-preview').textContent).toBe(
      'Platziert „Rechnungsstellung“ auf „Einkauf“ (manuell, gilt sofort).',
    );
    await user.click(within(panel).getAllByTestId('action-option')[3]!);
    expect(within(panel).getByTestId('action-preview').textContent).toBe(
      'Setzt „Rechnungsstellung“ bewusst außerhalb der Kette (manuell, gilt sofort).',
    );
    await user.click(within(panel).getAllByTestId('action-option')[1]!);
    await user.click(within(panel).getByTestId('action-submit'));
    expect(posts(calls, `${BASE}/q-00000000000000c1/actions`)[0]!.body).toEqual({
      type: 'place',
      step: 'step-einkauf',
    });
    const undo = await toastAction('Platziert');
    expect((await findToast('Platziert')).textContent).toContain('→ „Einkauf“.');
    await user.click(undo);
    expect((await findToast('Rückgängig gemacht')).textContent).toContain(
      'Die Platzierung ist abgelehnt',
    );
    expect(
      posts(calls, `${PROJECT}/value-chains/main/placements/plc_01MAN/decision`)[0]!.body,
    ).toEqual({ verdict: 'reject', reason: 'Rückgängig gemacht', version: 1 });
  });

  it('place: „Gehört zu keinem Schritt“ in one click, with „Rückgängig“', async () => {
    const { calls, user } = setup('/projects/demo/open-questions');
    const item = await row('q-00000000000000c1');
    await fromMenu(user, item, 'Gehört zu keinem Schritt');
    expect(await toastAction('Platziert')).toBeDefined();
    expect((await findToast('Platziert')).textContent).toContain('„Außerhalb der Kette“');
    expect(posts(calls, `${BASE}/q-00000000000000c1/actions`)[0]!.body).toEqual({
      type: 'place',
      step: '@outside',
    });
    expect(within(item).queryByTestId('question-action-panel')).toBeNull();
  });

  it('place: a process for a step without one', async () => {
    const { calls, user } = setup('/projects/demo/open-questions');
    const item = await row('q-00000000000000c2');
    await user.click(primary(item));
    const panel = within(item).getByTestId('question-action-panel');
    expect(within(panel).getByLabelText('Prozess für „Einkauf“ suchen')).toBeDefined();
    const option = within(panel)
      .getAllByTestId('action-option')
      .find((o) => o.dataset['ref'] === 'c/payment#Process_Pay')!;
    await user.click(option);
    expect(within(panel).getByTestId('action-preview').textContent).toBe(
      'Platziert „Zahlungsdienst“ auf „Einkauf“ (manuell, gilt sofort).',
    );
    expect(within(panel).getByTestId('action-submit').textContent).toBe('Zuordnen');
    await user.click(within(panel).getByTestId('action-submit'));
    expect(await toastAction('Platziert')).toBeDefined();
    expect(posts(calls, `${BASE}/q-00000000000000c2/actions`)[0]!.body).toEqual({
      type: 'place',
      step: 'step-einkauf',
      process: 'c/payment#Process_Pay',
    });
  });

  it('choose-copy: the valid copy, the other copies outside, the prefilled note; no „Rückgängig“', async () => {
    const { calls, router, user } = setup('/projects/demo/open-questions');
    const item = await row('q-00000000000000b5');
    await user.click(primary(item));
    const panel = within(item).getByTestId('question-action-panel');
    // a handful of copies: no search field
    expect(within(panel).queryByRole('textbox', { name: /Kopie/ })).toBeNull();
    expect(options(panel)).toEqual(['d/dup#Process_Dup', 'e/dup#Process_Dup']);
    const outside = await within(panel).findByRole('checkbox', {
      name: 'Andere Kopien in der Wertschöpfungskette auf „außerhalb“ setzen',
    });
    expect(outside.getAttribute('aria-checked')).toBe('true');
    // the copies by their model's path, the shared id behind „Technische Angaben“ (UX4)
    expect(
      within(panel)
        .getAllByTestId('action-option')
        .map((o) => o.textContent),
    ).toEqual(['d/dupAuftrag prüfen (alt)', 'e/dupAuftrag prüfen']);
    expect(within(panel).getByTestId('action-copy-technical').textContent).toContain(
      'Prozess-ID in jeder Kopie: Process_Dup',
    );
    expect(within(panel).queryByTestId('action-copy-delete-hint')).toBeNull();
    await user.click(within(panel).getAllByTestId('action-option')[1]!);
    // „+ Notiz“ opens the note, prefilled with the valid copy
    await user.click(within(panel).getByTestId('action-note-toggle'));
    expect(within(panel).getByTestId<HTMLTextAreaElement>('action-note').value).toBe(
      'Gültig ist „Auftrag prüfen“ in e/dup; die anderen Kopien sind veraltet oder Varianten.',
    );
    expect(within(panel).getByTestId('action-preview').textContent).toBe(
      'Entscheidet die 2 offenen Aufrufe zu den Kopien: angenommen zu „Auftrag prüfen“, abgelehnt zu den anderen Kopien. Ändern kannst du jede Entscheidung danach unter „Relationen“.',
    );
    await user.click(within(panel).getByTestId('action-submit'));
    const toast = await findToast('Gültige Kopie gewählt');
    expect(toast.textContent).toContain(
      '2 Aufrufe entschieden: 1 angenommen, 1 abgelehnt; 1 andere Kopie auf „außerhalb“ gesetzt.',
    );
    expect(posts(calls, `${BASE}/q-00000000000000b5/actions`)[0]!.body).toEqual({
      type: 'choose-copy',
      process: 'e/dup#Process_Dup',
      items: [
        { id: 'rel_01CALLD', version: 2 },
        { id: 'rel_01CALLE', version: 1 },
      ],
      placeOthersOutside: true,
      note: 'Gültig ist „Auftrag prüfen“ in e/dup; die anderen Kopien sind veraltet oder Varianten.',
    });
    // decided proposals: the toast leads to „Relationen“, where a reviewer changes them
    const go = within(toast).getByTestId('toast-action');
    expect(go.textContent).toBe('In „Relationen“ ansehen');
    await user.click(go);
    await waitFor(() => expect(router.state.location.pathname).toBe('/projects/demo/relations'));
  });

  it('choose-copy: a stale call version is refused and nothing is written', async () => {
    const { user } = setup('/projects/demo/open-questions', {
      routes: {
        [`POST ${BASE}/q-00000000000000b5/actions`]: () =>
          json(
            {
              title: 'Conflict',
              status: 409,
              code: 'conflict',
              mismatches: [{ id: 'rel_01CALLD', reason: 'version', version: 3 }],
            },
            409,
          ),
      },
    });
    const item = await row('q-00000000000000b5');
    await user.click(primary(item));
    const panel = within(item).getByTestId('question-action-panel');
    await user.click(within(panel).getAllByTestId('action-option')[0]!);
    await user.click(within(panel).getByTestId('action-submit'));
    expect((await within(panel).findByTestId('action-error')).textContent).toContain(
      'Die Liste hat sich geändert',
    );
  });

  it('outside: one click marks the item, „Rückgängig“ withdraws the mark, and a marked item is taken back under „Erledigte zeigen“', async () => {
    const { calls, user } = setup('/projects/demo/open-questions');
    await user.click(primary(await row('q-00000000000000b6')));
    const undo = await toastAction('Als außerhalb der Landschaft markiert');
    expect(posts(calls, `${BASE}/q-00000000000000b6/actions`)[0]!.body).toEqual({
      type: 'outside',
    });
    // marked: the item leaves the cards for „Erledigte zeigen“
    await waitFor(async () =>
      expect((await rows()).map((r) => short(r.dataset['questionId']!))).not.toContain('b6'),
    );
    expect(screen.getByTestId('open-questions-done').querySelector('summary')?.textContent).toBe(
      'Erledigte zeigen (1)',
    );
    await user.click(undo);
    expect((await findToast('Markierung zurückgenommen')).textContent).toContain(
      'Die Frage ist wieder offen.',
    );
    expect(posts(calls, `${BASE}/q-00000000000000b6/answers/oqa_01MARK/withdrawal`)).toHaveLength(
      1,
    );
    await waitFor(async () =>
      expect((await row('q-00000000000000b6')).dataset['state']).toBe('open'),
    );

    // marked again, then taken back on its line under „Erledigte zeigen“
    await user.click(primary(await row('q-00000000000000b6')));
    const done = await screen.findByTestId('open-questions-done');
    await user.click(done.querySelector('summary')!);
    const line = await within(done).findByTestId('open-question');
    expect(line.dataset['state']).toBe('answered');
    expect(within(line).getByTestId('question-state').textContent).toBe('Außerhalb der Landschaft');
    // a done line offers nothing but the way back
    expect(within(line).queryAllByTestId('question-action')).toEqual([]);
    await user.click(within(line).getByTestId('question-withdraw-mark'));
    await waitFor(() =>
      expect(posts(calls, `${BASE}/q-00000000000000b6/answers/oqa_01MARK/withdrawal`)).toHaveLength(
        2,
      ),
    );
  });

  it('outside: an item marked elsewhere is one line under „Erledigte zeigen“ with the way back only', async () => {
    const list = fixtures().map((q) =>
      q.id === 'q-00000000000000b6'
        ? {
            ...q,
            state: 'answered' as const,
            answers: [
              openQuestionAnswer({
                id: 'oqa_01MARK',
                questionId: q.id,
                kind: 'outside-landscape',
                role: 'outside-mark',
                text: null,
              }),
            ],
          }
        : q,
    );
    const { calls, user } = setup('/projects/demo/open-questions', { list });
    await rows();
    const done = screen.getByTestId('open-questions-done');
    await user.click(done.querySelector('summary')!);
    const line = within(done).getByTestId('open-question');
    expect(line.dataset['questionId']).toBe('q-00000000000000b6');
    expect(within(line).queryByTestId('question-more-actions')).toBeNull();
    await user.click(within(line).getByTestId('question-withdraw-mark'));
    expect(await findToast('Markierung zurückgenommen')).toBeDefined();
    expect(posts(calls, `${BASE}/q-00000000000000b6/answers/oqa_01MARK/withdrawal`)).toHaveLength(
      1,
    );
  });

  it('decide: a hold answers in the note dialog and is decided on the review screen (Q4)', async () => {
    const { calls, user } = setup('/projects/demo/open-questions');
    const item = await row('q-00000000000000b1');
    // no inline decision any more
    const decideNow = within(item).getByRole('link', { name: 'Jetzt entscheiden' });
    expect(decideNow.getAttribute('href')).toBe(
      '/projects/demo/review/rel_01HELD?view=held&from=open-questions',
    );
    expect(decideNow.dataset['action']).toBe('decide');
    await user.click(primary(item));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Antwort geben' })).toBeDefined();
    expect(within(item).queryByTestId('question-action-panel')).toBeNull();
    expect(posts(calls, `${PROJECT}/relations/rel_01HELD/decision`)).toEqual([]);
  });

  it('decide: an agent’s question, under „Frage eines Agenten“, opens its proposal on the chain', async () => {
    setup('/projects/demo/open-questions?kind=agent-question');
    const item = await row('q-00000000000000b8');
    const open = primary(item);
    expect(open.textContent).toBe('Vorschlag öffnen');
    expect(open.tagName).toBe('A');
    expect(open.getAttribute('href')).toBe(
      '/projects/demo/value-chain?placement=plc_01PROP&from=open-questions',
    );
  });

  it('requeue: queues the analysed model again', async () => {
    const { calls, user } = setup('/projects/demo/open-questions');
    const item = await row('q-00000000000000b7');
    await user.click(primary(item));
    expect(await findToast('Erneut eingeplant')).toBeDefined();
    expect(posts(calls, `${PROJECT}/analyses/requeue`)[0]!.body).toEqual({
      modelKeys: ['a/order'],
    });
  });

  it('fix-link: leads to the chain page at the step, where its link editor is', async () => {
    setup('/projects/demo/open-questions');
    const item = await row('q-00000000000000c3');
    const link = primary(item);
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe(
      '/projects/demo/value-chain?step=step-x&from=open-questions',
    );
    // the step's own chain link would lead to the same place: left out
    expect(within(item).queryAllByTestId('question-link')).toEqual([]);
  });

  it('keeps the panel with the server’s reason, closes on an item that changed meanwhile, and cancels with Escape', async () => {
    const { user } = setup('/projects/demo/open-questions', {
      routes: {
        [`POST ${BASE}/q-00000000000000b2/actions`]: () =>
          json(
            {
              title: 'Validation failed',
              status: 422,
              code: 'validation-failed',
              detail: 'c/payment#Process_Pay lies in the process of a/order#Call_1',
              reason: 'same-process',
            },
            422,
          ),
        [`POST ${BASE}/q-00000000000000b3/actions`]: () =>
          json({ title: 'Not Found', status: 404, code: 'not-found' }, 404),
      },
    });
    const item = await row('q-00000000000000b2');
    await user.click(primary(item));
    let panel = within(item).getByTestId('question-action-panel');
    await user.click(within(panel).getAllByTestId('action-option')[0]!);
    await user.click(within(panel).getByTestId('action-submit'));
    // The server's reason in German, the refs by name.
    expect((await within(panel).findByTestId('action-error')).textContent).toContain(
      '„Zahlungsdienst“ liegt im selben Prozess wie „Zahlung abwickeln“',
    );
    // Escape closes the panel and hands the focus back to the button
    await user.keyboard('{Escape}');
    expect(within(item).queryByTestId('question-action-panel')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(primary(item)));

    const gone = await row('q-00000000000000b3');
    await user.click(primary(gone));
    panel = within(gone).getByTestId('question-action-panel');
    await user.click(within(panel).getAllByRole('checkbox')[0]!);
    await user.click(within(panel).getByTestId('action-submit'));
    expect((await findToast('Frage gibt es so nicht mehr')).textContent).toContain('neue Kennung');
    expect(within(gone).queryByTestId('question-action-panel')).toBeNull();
  });

  it('moves the focus to the next item once an action ended one', async () => {
    const { user } = setup('/projects/demo/open-questions');
    const item = await row('q-00000000000000c1');
    await fromMenu(user, item, 'Gehört zu keinem Schritt');
    await findToast('Platziert');
    await waitFor(async () =>
      expect(document.activeElement).toBe(primary(await row('q-00000000000000c2'))),
    );
  });
});

// ------------------------------------------------------------------ the model view

describe('actions in the model view’s section (M6 S5c-1)', () => {
  const section = () => screen.findByTestId('model-open-questions');
  const item = async (id: string) => {
    const s = await section();
    await waitFor(() =>
      expect(within(s).getAllByTestId('open-question').length).toBeGreaterThan(0),
    );
    return within(s)
      .getAllByTestId('open-question')
      .find((r) => r.dataset['questionId'] === id)!;
  };

  it('marks a pool outside the landscape and takes it back', async () => {
    const { calls, user } = setup('/projects/demo/models/a/order');
    await user.click(primary(await item('q-00000000000000b6')));
    await user.click(await toastAction('Als außerhalb der Landschaft markiert'));
    expect(await findToast('Markierung zurückgenommen')).toBeDefined();
    expect(posts(calls, `${BASE}/q-00000000000000b6/answers/oqa_01MARK/withdrawal`)).toHaveLength(
      1,
    );
  });

  it('links a call target, with „Rückgängig“', async () => {
    const { calls, user } = setup('/projects/demo/models/a/order');
    const call = await item('q-00000000000000b2');
    await user.click(primary(call));
    const panel = within(call).getByTestId('question-action-panel');
    await user.click(within(panel).getAllByTestId('action-option')[1]!);
    await user.click(within(panel).getByTestId('action-submit'));
    await user.click(await toastAction('Verknüpft'));
    expect(await findToast('Rückgängig gemacht')).toBeDefined();
    expect(posts(calls, `${PROJECT}/decisions`)).toHaveLength(1);
  });

  it('offers a hold’s answer and „Jetzt entscheiden“ there too', async () => {
    const { user } = setup('/projects/demo/models/b/billing');
    const held = await item('q-00000000000000b1');
    // from the model view the review screen keeps its own way back (only the tab is returned to)
    expect(within(held).getByRole('link', { name: 'Jetzt entscheiden' }).getAttribute('href')).toBe(
      '/projects/demo/review/rel_01HELD?view=held',
    );
    await user.click(primary(held));
    expect(
      within(await screen.findByRole('dialog')).getByRole('heading', { name: 'Antwort geben' }),
    ).toBeDefined();
  });

  it('places a process on a step', async () => {
    const { calls, user } = setup('/projects/demo/models/b/billing');
    const proc = await item('q-00000000000000c1');
    await user.click(primary(proc));
    const panel = within(proc).getByTestId('question-action-panel');
    await waitFor(() => expect(options(panel)).toContain('step-vertrieb'));
    await user.click(within(panel).getAllByTestId('action-option')[0]!);
    await user.click(within(panel).getByTestId('action-submit'));
    expect(await toastAction('Platziert')).toBeDefined();
    expect(posts(calls, `${BASE}/q-00000000000000c1/actions`)[0]!.body).toEqual({
      type: 'place',
      step: 'step-vertrieb',
    });
  });

  it('chooses the valid copy of a process id', async () => {
    const { calls, user } = setup('/projects/demo/models/d/dup');
    const dup = await item('q-00000000000000b5');
    await user.click(primary(dup));
    const panel = within(dup).getByTestId('question-action-panel');
    await user.click(within(panel).getAllByTestId('action-option')[0]!);
    await user.click(within(panel).getByTestId('action-submit'));
    expect(await findToast('Gültige Kopie gewählt')).toBeDefined();
    expect(posts(calls, `${BASE}/q-00000000000000b5/actions`)[0]!.body).toMatchObject({
      type: 'choose-copy',
      process: 'd/dup#Process_Dup',
    });
  });

  it('shows no action to a viewer', async () => {
    setup('/projects/demo/models/a/order', { role: 'viewer' });
    const s = await section();
    await waitFor(() =>
      expect(within(s).getAllByTestId('open-question').length).toBeGreaterThan(0),
    );
    expect(within(s).queryAllByTestId('question-actions')).toEqual([]);
  });
});

// ------------------------------------------------------------------ collapsed subprocess

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" id="Defs_1">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="Pool_Order" processRef="Process_Order" />
  </bpmn:collaboration>
  <bpmn:process id="Process_Order" name="Auftrag">
    <bpmn:subProcess id="Sub_Pay" name="Zahlung" />
    <bpmn:subProcess id="Sub_Open" name="Offen" />
    <bpmn:subProcess id="Sub_Event" triggeredByEvent="true" />
    <bpmn:task id="Task_1" name="Prüfen" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="Sub_Pay_di" bpmnElement="Sub_Pay" />
      <bpmndi:BPMNShape id="Sub_Open_di" bpmnElement="Sub_Open" isExpanded="true" />
      <bpmndi:BPMNShape id="Sub_Event_di" bpmnElement="Sub_Event" />
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1" />
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

describe('„Verknüpfen mit …“ on a collapsed subprocess (M6 S5c-1)', () => {
  it('finds a collapsed subprocess and its process in the file, and nothing else', () => {
    expect(collapsedSubprocess(XML, 'Sub_Pay')).toEqual({
      elementId: 'Sub_Pay',
      name: 'Zahlung',
      processId: 'Process_Order',
    });
    expect(collapsedSubprocess(XML, 'Sub_Open')).toBeNull();
    expect(collapsedSubprocess(XML, 'Sub_Event')).toBeNull();
    expect(collapsedSubprocess(XML, 'Task_1')).toBeNull();
    expect(collapsedSubprocess(XML, 'Nope')).toBeNull();
    expect(collapsedSubprocess('<kein xml', 'Sub_Pay')).toBeNull();
  });

  async function renderLink(elementId: string, role: Project['role'] = 'owner') {
    const calls = stubApi({
      [`GET ${PROJECT}/models`]: () => json({ items: models, nextCursor: null }),
      [`POST ${PROJECT}/relations`]: () =>
        json({
          result: 'applied',
          relation: relation({
            id: 'rel_01SUB',
            type: 'manual',
            from: 'a/order#Process_Order',
            to: 'c/payment#Process_Pay',
            status: 'accepted',
            tier: 'manual',
          }),
        }),
      [`POST ${PROJECT}/decisions`]: () =>
        json({ items: [relation({ id: 'rel_01SUB', from: 'a', to: 'b', status: 'rejected' })] }),
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    queryClient.setQueryData(healthQuery.queryKey, LOCAL);
    queryClient.setQueryData(projectQuery('demo').queryKey, project(role));
    queryClient.setQueryData(modelsQuery('demo').queryKey, models);
    for (const [i, f] of FACTS.entries()) {
      const m = models[i]!;
      queryClient.setQueryData(
        factsQuery({ project: 'demo', modelId: m.id, revisionId: m.headRevisionId }).queryKey,
        f,
      );
    }
    const resolve = resolverOf(
      buildRefIndex(
        FACTS.flatMap((f) => f.facts),
        FACTS.flatMap((f) => f.processes),
      ),
    );
    const rootRoute = createRootRoute({
      component: () => (
        <>
          <SubprocessLink
            project="demo"
            modelKey="a/order"
            xml={XML}
            elementId={elementId}
            resolve={resolve}
          />
          <Toaster />
        </>
      ),
    });
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    await router.load();
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    return { calls, user: userEvent.setup() };
  }

  it('links the subprocess’s process to the picked one as a manual relation, with „Rückgängig“', async () => {
    const { calls, user } = await renderLink('Sub_Pay');
    const card = await screen.findByTestId('subprocess-link');
    expect(card.textContent).toContain('Eingeklappter Teilprozess „Zahlung“');
    expect(card.textContent).toContain('Verknüpfe seinen Prozess „Auftrag“');
    const open = within(card).getByRole('button', { name: 'Verknüpfen mit …' });
    await user.click(open);
    // The button stays, expanded and pointing at the form; Escape closes it, focus back.
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(open.getAttribute('aria-controls')).toBe(
      within(card).getByTestId('subprocess-link-form').id,
    );
    await user.keyboard('{Escape}');
    expect(within(card).queryByTestId('subprocess-link-form')).toBeNull();
    expect(open.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(document.activeElement).toBe(open));
    await user.click(open);
    const form = within(card).getByTestId('subprocess-link-form');
    // every other process, the subprocess's own left out
    expect(
      within(form)
        .getAllByTestId('action-option')
        .map((o) => o.dataset['ref']),
    ).toEqual([
      'c/payment#Process_Pay',
      'e/dup#Process_Dup',
      'd/dup#Process_Dup',
      'b/billing#Process_Billing',
    ]);
    // the subprocess's name „Zahlung“ ranks „Zahlungsdienst“ first (UX4)
    expect(sections(form)).toEqual(['Passt vermutlich', 'Alle Prozesse']);
    await user.click(
      within(form)
        .getAllByTestId('action-option')
        .find((o) => o.dataset['ref'] === 'c/payment#Process_Pay')!,
    );
    expect(within(form).getByTestId('action-preview').textContent).toBe(
      'Legt eine angenommene Relation „Auftrag“ → „Zahlungsdienst“ an.',
    );
    await user.click(within(form).getByTestId('action-submit'));
    const undo = await toastAction('Verknüpft');
    expect(posts(calls, `${PROJECT}/relations`)[0]!.body).toEqual({
      type: 'manual',
      from: 'a/order#Process_Order',
      to: 'c/payment#Process_Pay',
      confidence: 1,
      rationale:
        'Aus der Modellansicht: Der eingeklappte Teilprozess „Zahlung“ in „Auftrag“ verweist auf diesen Prozess.',
    });
    // After saving the focus is back on the button.
    await waitFor(() => expect(document.activeElement).toBe(open));
    await user.click(undo);
    expect(await findToast('Rückgängig gemacht')).toBeDefined();
    expect(posts(calls, `${PROJECT}/decisions`)[0]!.body).toEqual({
      verdict: 'reject',
      reason: 'Rückgängig gemacht',
      expectedCount: 1,
      items: [{ id: 'rel_01SUB', version: 1 }],
    });
  });

  it('offers nothing for other elements, and nothing to a viewer', async () => {
    await renderLink('Task_1');
    expect(screen.queryByTestId('subprocess-link')).toBeNull();
  });

  it('offers nothing to a viewer', async () => {
    await renderLink('Sub_Pay', 'viewer');
    expect(screen.queryByTestId('subprocess-link')).toBeNull();
  });
});

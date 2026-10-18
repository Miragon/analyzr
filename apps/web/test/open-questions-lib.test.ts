import { OPEN_QUESTION_KIND_LABELS } from '@analyzr/contracts/open-question-labels';
import type { OpenQuestion } from '@analyzr/client';
import { describe, expect, it } from 'vitest';

import {
  CARD_ACTION_LABELS,
  OPEN_QUESTION_KINDS,
  OPEN_QUESTION_STATES,
  activeFilterCount,
  agentQuestionCount,
  askWhoText,
  attachmentName,
  cardActions,
  countText,
  decideLink,
  exportGroups,
  exportQuery,
  filterOpenQuestions,
  infoGroup,
  latestNote,
  openQuestionFacets,
  parseOpenQuestionFilters,
  questionView,
  questionsOfModel,
  relationProcessesText,
  subjectLink,
  unlocksText,
  viewLink,
} from '../src/lib/open-questions';
import { resolverOf, type RefLabel } from '../src/lib/refs';
import { openQuestion, openQuestionAnswer } from './support/fixtures';

type Action = OpenQuestion['actions'][number];
const NOTE: Action = { type: 'note', primary: false, label: 'Notiz hinzufügen' };
const OUTSIDE: Action = {
  type: 'outside',
  primary: false,
  label: 'Liegt außerhalb der Landschaft',
};

const finding = openQuestion({
  id: 'q-0000000000000001',
  modelKeys: ['finanzen/mahnwesen'],
  askWho: { lanes: ['Buchhaltung'], stepOwners: [], folder: 'finanzen' },
  unlocks: 4,
});
const held = openQuestion({
  id: 'q-0000000000000002',
  kind: 'held',
  source: 'hold',
  subject: { type: 'relation', id: 'rel_01HELD' },
  modelKeys: ['finanzen/zahlung', 'vertrieb/auftrag'],
  askWho: { lanes: ['Vertrieb'], stepOwners: ['Finanzen'], folder: 'finanzen' },
  raisedBy: { sourceKind: 'human', handle: 'owner', seq: 9 },
  unlocks: 2,
  actions: [
    {
      type: 'decide',
      primary: true,
      label: 'Vorschlag prüfen',
      decides: [{ type: 'relation', id: 'rel_01HELD', version: 2 }],
    },
    NOTE,
  ],
});
const pool = openQuestion({
  id: 'q-0000000000000003',
  kind: 'black-box-partner',
  source: 'signal',
  subject: { type: 'ref', id: 'finanzenx/bank#Participant_Bank' },
  modelKeys: ['finanzenx/bank'],
  askWho: { lanes: [], stepOwners: [], folder: 'finanzenx' },
});
const step = openQuestion({
  id: 'q-0000000000000004',
  kind: 'step-without-process',
  source: 'value-chain-finding',
  subject: { type: 'step', id: 'step-einkauf' },
  modelKeys: [],
  refs: [],
  askWho: { lanes: [], stepOwners: ['Einkauf'], folder: null },
});
const asked = openQuestion({
  id: 'q-0000000000000005',
  kind: 'agent-question',
  source: 'agent-question',
  group: 'agent',
  subject: { type: 'relation', id: 'rel_01ASKED' },
  modelKeys: ['finanzen/zahlung'],
  askWho: { lanes: ['Vertrieb'], stepOwners: [], folder: 'finanzen' },
  actions: [
    {
      type: 'decide',
      primary: true,
      label: 'Vorschlag prüfen',
      decides: [{ type: 'relation', id: 'rel_01ASKED', version: 1 }],
    },
    NOTE,
  ],
});
const proposed = openQuestion({
  id: 'q-0000000000000006',
  kind: 'process-without-step',
  source: 'value-chain-finding',
  group: 'proposal',
  subject: { type: 'process', id: 'finanzen/zahlung#Process_Zahlung' },
  modelKeys: ['finanzen/zahlung'],
  actions: [
    {
      type: 'decide',
      primary: true,
      label: 'Auf der Kette prüfen',
      step: 'step-finanzen',
      decides: [{ type: 'placement', id: 'plc_01P', version: 1 }],
    },
  ],
});
const summary = openQuestion({
  id: 'q-0000000000000007',
  kind: 'summary-note',
  source: 'summary',
  group: 'info',
  subject: { type: 'model', id: 'finanzen/zahlung' },
  modelKeys: ['finanzen/zahlung'],
});
const marked = openQuestion({
  id: 'q-0000000000000008',
  kind: 'black-box-partner',
  source: 'signal',
  subject: { type: 'ref', id: 'finanzen/mahnwesen#Participant_Kunde' },
  modelKeys: ['finanzen/mahnwesen'],
  state: 'answered',
  answers: [
    openQuestionAnswer({
      questionId: 'q-0000000000000008',
      kind: 'outside-landscape',
      role: 'outside-mark',
      text: null,
    }),
  ],
  actions: [{ ...OUTSIDE, primary: true }, NOTE],
});
const items = [finding, held, pool, step, asked, proposed, summary, marked];

describe('open questions: the view (UX2b)', () => {
  it('shows „Zu klären“ as cards, informational and answered items apart, never the chain’s proposals', () => {
    const view = questionView(items, {});
    expect(view.group).toBe('ask');
    expect(view.cards.map((q) => q.id.slice(-1))).toEqual(['1', '2', '3', '4']);
    expect(view.info.map((q) => q.id.slice(-1))).toEqual(['7']);
    expect(view.done.map((q) => q.id.slice(-1))).toEqual(['8']);
    expect(view.total).toBe(4);
    expect(countText(view)).toBe('4 zu klären');
    // a filter narrows every part; the count says of how many
    const narrowed = questionView(items, { model: 'finanzen' });
    expect(narrowed.cards.map((q) => q.id.slice(-1))).toEqual(['1', '2']);
    expect(narrowed.info.map((q) => q.id.slice(-1))).toEqual(['7']);
    expect(countText(narrowed)).toBe('2 von 4 zu klären');
  });

  it('lists the agents’ questions only while „Art“ asks for them', () => {
    const view = questionView(items, { kind: 'agent-question' });
    expect(view.group).toBe('agent');
    expect(view.cards.map((q) => q.id.slice(-1))).toEqual(['5']);
    expect(view.info).toEqual([]);
    expect(countText(view)).toBe('1 Fragen der Agenten');
  });

  it('keeps the valid filters of a URL search and counts the set ones', () => {
    expect(
      parseOpenQuestionFilters({
        kind: 'held',
        source: 'nope',
        model: 'finanzen',
        askWho: ' ',
        state: 'answered',
        other: 'x',
      }),
    ).toEqual({ kind: 'held', model: 'finanzen', state: 'answered' });
    expect(parseOpenQuestionFilters({ kind: 'toString', state: 'closed' })).toEqual({});
    expect(activeFilterCount({ state: 'answered' })).toBe(0);
    expect(activeFilterCount({ kind: 'held', source: 'hold', askWho: 'Vertrieb' })).toBe(3);
  });

  it('filters as the server does: a model or a folder, contact names exactly', () => {
    const ids = (f: Parameters<typeof filterOpenQuestions>[1]) =>
      filterOpenQuestions([finding, held, pool, step], f).map((q) => q.id.slice(-1));
    // `finanzen` matches the folder, not `finanzenx/…`
    expect(ids({ model: 'finanzen' })).toEqual(['1', '2']);
    expect(ids({ model: 'finanzen/zahlung' })).toEqual(['2']);
    expect(ids({ model: 'finanzen/zahl' })).toEqual([]);
    expect(ids({ askWho: 'Vertrieb' })).toEqual(['2']);
    expect(ids({ askWho: 'Finanzen' })).toEqual(['2']);
    // a folder, as an old link names it, still matches as on the server
    expect(ids({ askWho: 'finanzen' })).toEqual(['1', '2']);
    expect(ids({ askWho: 'Buch' })).toEqual([]);
    expect(ids({ kind: 'held', source: 'hold', state: 'open' })).toEqual(['2']);
  });

  it('counts each option under the other filters, „Frage eines Agenten“ last', () => {
    const facets = openQuestionFacets(items, {});
    expect(facets.kinds.map((o) => [o.value, o.count])).toEqual([
      ['held', 1],
      ['call-target-unknown', 1],
      ['step-without-process', 1],
      ['black-box-partner', 1],
      ['agent-question', 1],
    ]);
    expect(facets.kinds[0]?.label).toBe('Vorgemerkt');
    expect(facets.folders).toEqual([
      { value: 'finanzen', label: 'finanzen/', count: 2 },
      { value: 'finanzenx', label: 'finanzenx/', count: 1 },
      { value: 'vertrieb', label: 'vertrieb/', count: 1 },
    ]);
    expect(facets.models.map((o) => o.value)).toEqual([
      'finanzen/mahnwesen',
      'finanzen/zahlung',
      'finanzenx/bank',
      'vertrieb/auftrag',
    ]);
    // step owners and lanes in one list, by name; the folder is no contact
    expect(facets.askWho).toEqual([
      { value: 'Buchhaltung', label: 'Buchhaltung', count: 1 },
      { value: 'Einkauf', label: 'Einkauf', count: 1 },
      { value: 'Finanzen', label: 'Finanzen', count: 1 },
      { value: 'Vertrieb', label: 'Vertrieb', count: 1 },
    ]);
    // under „Frage eines Agenten“ the other filters count the agents' questions
    const agents = openQuestionFacets(items, { kind: 'agent-question' });
    expect(agents.models.map((o) => [o.value, o.count])).toEqual([['finanzen/zahlung', 1]]);
    expect(agents.askWho.map((o) => o.value)).toEqual(['Vertrieb']);
    // a selected value without cards stays selectable
    const empty = openQuestionFacets(items, {
      kind: 'unjudged',
      askWho: 'Niemand',
      model: 'gibt/es-nicht',
    });
    expect(empty.kinds.find((o) => o.value === 'unjudged')).toEqual({
      value: 'unjudged',
      label: 'Paare ohne Urteil',
      count: 0,
    });
    expect(empty.askWho).toEqual([{ value: 'Niemand', label: 'Niemand', count: 0 }]);
    expect(empty.folders.map((o) => o.value)).toContain('gibt/es-nicht');
  });
});

describe('open questions: the export for the customer (Q11)', () => {
  it('sends the list’s filters, „Zu klären“ unless the agents’ questions are asked for', () => {
    expect(
      exportQuery({ model: 'finanzen', kind: 'held', askWho: 'Vertrieb', state: 'open' }),
    ).toEqual({
      modelKey: 'finanzen',
      kind: 'held',
      askWho: 'Vertrieb',
    });
    expect(exportQuery({})).toEqual({});
    expect(exportGroups({}, false)).toEqual(['ask']);
    expect(exportGroups({}, true)).toEqual(['ask', 'agent']);
    expect(exportGroups({ kind: 'agent-question' }, false)).toEqual(['agent']);
    expect(agentQuestionCount(items, {})).toBe(1);
    expect(agentQuestionCount(items, { model: 'vertrieb' })).toBe(0);
    expect(agentQuestionCount(items, { kind: 'held' })).toBe(0);
  });

  it('takes the download name from Content-Disposition', () => {
    expect(attachmentName('attachment; filename="offene-fragen-demo.csv"', 'x.csv')).toBe(
      'offene-fragen-demo.csv',
    );
    expect(attachmentName(null, 'x.md')).toBe('x.md');
    expect(attachmentName('attachment', 'x.md')).toBe('x.md');
  });
});

describe('a relation’s processes on its card (UX2b review)', () => {
  const at = (labels: Record<string, Omit<RefLabel, 'ref' | 'modelKey' | 'elementId'>>) =>
    resolverOf(new Map(Object.entries(labels)));
  const from = 'einkauf/bestellanforderung#Throw_Lieferant';
  const to = 'einkauf/lieferantenanlage#Start_Lieferant';
  const hold = (subjectLabel: string) => ({
    subject: { type: 'relation' as const, id: 'rel_01X' },
    subjectLabel,
    // sorted by code point, as the server sends them: the order says nothing about the direction
    refs: [from, to].sort(),
  });

  it('names both processes in the order the label names the ends', () => {
    const resolve = at({
      [from]: {
        label: 'Neuer Lieferant benötigt',
        kind: 'msg_throw',
        processName: 'Bestellanforderung',
      },
      [to]: {
        label: 'Neuer Lieferant benoetigt',
        kind: 'msg_catch',
        processName: 'Lieferantenanlage',
      },
    });
    expect(
      relationProcessesText(
        hold('„Neuer Lieferant benötigt“ → „Neuer Lieferant benoetigt“'),
        resolve,
      ),
    ).toBe('in „Bestellanforderung“ → „Lieferantenanlage“');
    expect(
      relationProcessesText(
        hold('„Neuer Lieferant benoetigt“ → „Neuer Lieferant benötigt“'),
        resolve,
      ),
    ).toBe('in „Lieferantenanlage“ → „Bestellanforderung“');
  });

  it('tells equal names apart by the sending end, and says nothing when that stays open', () => {
    const named = (fromKind: string | null, toKind: string | null) =>
      at({
        [from]: { label: 'Auftrag', kind: fromKind as RefLabel['kind'], processName: 'Einkauf' },
        [to]: { label: 'Auftrag', kind: toKind as RefLabel['kind'], processName: 'Vertrieb' },
      });
    expect(
      relationProcessesText(hold('„Auftrag“ → „Auftrag“'), named('msg_throw', 'msg_catch')),
    ).toBe('in „Einkauf“ → „Vertrieb“');
    expect(
      relationProcessesText(hold('„Auftrag“ → „Auftrag“'), named('msg_catch', 'msg_throw')),
    ).toBe('in „Vertrieb“ → „Einkauf“');
    expect(relationProcessesText(hold('„Auftrag“ → „Auftrag“'), named(null, null))).toBeNull();
  });

  it('adds nothing for two processes the label names, nor for other subjects', () => {
    const resolve = at({
      [from]: { label: 'Einkauf', kind: 'process', processName: 'Einkauf' },
      [to]: { label: 'Vertrieb', kind: 'process', processName: 'Vertrieb' },
    });
    expect(relationProcessesText(hold('„Einkauf“ → „Vertrieb“'), resolve)).toBeNull();
    expect(
      relationProcessesText(
        { subject: { type: 'ref', id: from }, subjectLabel: '„x“', refs: [from] },
        resolve,
      ),
    ).toBeNull();
  });
});

describe('open questions: cards (UX2b)', () => {
  it('links the subject to where it is: the model view, the review screen or the chain', () => {
    expect(subjectLink(finding)).toEqual({ to: 'model', modelKey: 'a/order', element: 'Call_1' });
    expect(subjectLink(held)).toEqual({ to: 'review', relation: 'rel_01HELD' });
    expect(subjectLink(step)).toEqual({ to: 'chain', step: 'step-einkauf' });
    expect(subjectLink({ subject: { type: 'placement', id: 'plc_01X' } })).toEqual({
      to: 'chain',
      placement: 'plc_01X',
    });
    expect(subjectLink({ subject: { type: 'value-chain', id: 'main' } })).toEqual({ to: 'chain' });
    expect(subjectLink(summary)).toEqual({ to: 'model', modelKey: 'finanzen/zahlung' });
  });

  it('names the card’s way into the diagram, and leaves it out where it leads nowhere new', () => {
    // the owner's walkthrough, 2026-10-18: a labelled button, not a name to guess at
    expect(viewLink(finding, { withActions: true })).toEqual({
      link: { to: 'model', modelKey: 'a/order', element: 'Call_1' },
      label: 'Im Modell zeigen',
    });
    expect(viewLink(finding, { currentModel: 'a/order', withActions: true })?.label).toBe(
      'Im Diagramm zeigen',
    );
    expect(viewLink(step, { withActions: true })?.label).toBe('In der Kette zeigen');
    expect(viewLink(summary, { withActions: false })?.label).toBe('Modell öffnen');
    expect(viewLink(summary, { currentModel: 'finanzen/zahlung', withActions: false })).toBeNull();
    // „Jetzt entscheiden“ and „Vorschlag öffnen“ open the review screen already; a viewer has neither
    expect(viewLink(held, { withActions: true })).toBeNull();
    expect(
      viewLink(
        {
          ...held,
          answers: [openQuestionAnswer({ questionId: held.id, target: 'relation-note' })],
        },
        { withActions: true },
      ),
    ).toBeNull();
    expect(viewLink(held, { withActions: false })?.label).toBe('Relation ansehen');
    expect(viewLink(asked, { withActions: true })).toBeNull();
    // „Auf der Kette prüfen“ opens the step, the button the process
    expect(viewLink(proposed, { withActions: true })).toEqual({
      link: { to: 'model', modelKey: 'finanzen/zahlung', element: 'Process_Zahlung' },
      label: 'Im Modell zeigen',
    });
  });

  it('answers a hold first and decides it where the diagrams are (Q4)', () => {
    const arranged = cardActions(held);
    expect(arranged.primary).toEqual({ action: NOTE, label: CARD_ACTION_LABELS.answer });
    expect(arranged.secondary?.label).toBe('Jetzt entscheiden');
    expect(arranged.menu).toEqual([]);
    // Answered, the decision is the next step: it leads, „Antwort ergänzen“ beside it.
    const answered = cardActions({
      ...held,
      answers: [openQuestionAnswer({ questionId: held.id, target: 'relation-note' })],
    });
    expect(answered.primary?.label).toBe('Jetzt entscheiden');
    expect(answered.primary?.action.type).toBe('decide');
    expect(answered.secondary).toEqual({ action: NOTE, label: 'Antwort ergänzen' });
    expect(answered.menu).toEqual([]);
    expect(decideLink(held, held.actions[0]!)).toEqual({
      to: 'review',
      relation: 'rel_01HELD',
      held: true,
    });
    const placement = openQuestion({
      id: 'q-0000000000000009',
      kind: 'held',
      source: 'hold',
      subject: { type: 'placement', id: 'plc_01H' },
    });
    expect(
      decideLink(placement, { decides: [{ type: 'placement', id: 'plc_01H', version: 1 }] }),
    ).toEqual({ to: 'chain', placement: 'plc_01H' });
  });

  it('opens an agent’s proposal and the chain’s step from their `decide`', () => {
    expect(cardActions(asked).primary?.label).toBe('Vorschlag öffnen');
    expect(cardActions(asked).menu.map((c) => c.label)).toEqual(['Notiz hinzufügen']);
    expect(decideLink(asked, asked.actions[0]!)).toEqual({ to: 'review', relation: 'rel_01ASKED' });
    expect(cardActions(proposed).primary?.label).toBe('Auf der Kette prüfen');
    expect(decideLink(proposed, proposed.actions[0]!)).toEqual({
      to: 'chain',
      step: 'step-finanzen',
    });
  });

  it('keeps the API’s primary action elsewhere, both values of a conflict side by side, nothing on a marked item', () => {
    const pooled = openQuestion({
      id: 'q-000000000000000a',
      kind: 'black-box-partner',
      actions: [
        { ...OUTSIDE, primary: true },
        { type: 'link', primary: false, label: 'Verknüpfen mit …' },
        NOTE,
      ],
    });
    const arranged = cardActions(pooled);
    expect(arranged.primary?.label).toBe('Liegt außerhalb der Landschaft');
    expect(arranged.secondary).toBeUndefined();
    expect(arranged.menu.map((c) => c.label)).toEqual(['Verknüpfen mit …', 'Notiz hinzufügen']);

    const withdraw: Action = {
      type: 'withdraw-amendment',
      primary: true,
      label: 'Wert aus dem Quellsystem übernehmen',
      withdraw: {
        modelId: 'mdl_01X',
        modelKey: 'a/order',
        amendment: 'mam_01X',
        compare: { field: 'Ziel', incoming: 'B', after: 'A', before: null },
      },
    };
    const keep: Action = {
      type: 'amend',
      primary: false,
      label: 'Meine Ergänzung behalten',
      amend: {
        modelId: 'mdl_01X',
        modelKey: 'a/order',
        targets: [{ elementId: 'Call_1', op: 'call-target', label: 'Aufruf' }],
        replaces: 'mam_01X',
      },
    };
    const conflict = openQuestion({
      id: 'q-000000000000000b',
      kind: 'amendment-conflict',
      source: 'amendment',
      actions: [withdraw, keep, NOTE],
    });
    expect(cardActions(conflict).secondary?.label).toBe('Meine Ergänzung behalten');
    expect(cardActions(conflict).menu.map((c) => c.label)).toEqual(['Notiz hinzufügen']);

    expect(cardActions(marked)).toEqual({ primary: undefined, secondary: undefined, menu: [] });
  });

  it('says what an item ranks by from two on and whom to ask, without the folder', () => {
    expect(unlocksText(finding)).toBe('Betrifft 4 offene Entscheidungen');
    expect(unlocksText(held)).toBe('Betrifft 2 offene Entscheidungen');
    expect(unlocksText(pool)).toBeNull();
    expect(unlocksText({ kind: 'isolated-process', unlocks: 0 })).toBeNull();
    expect(unlocksText({ kind: 'summary-note', unlocks: 5 })).toBeNull();
    expect(askWhoText(held.askWho)).toBe('Finanzen, Vertrieb');
    expect(
      askWhoText({ lanes: ['Einkauf', 'Lager'], stepOwners: ['Einkauf'], folder: 'einkauf' }),
    ).toBe('Einkauf, Lager');
    expect(askWhoText({ lanes: [], stepOwners: [], folder: 'finanzen' })).toBe('');
  });

  it('shows the latest note and the items of exactly one model', () => {
    const noted = openQuestion({
      id: 'q-000000000000000c',
      answers: [
        openQuestionAnswer({ id: 'oqa_01A', questionId: 'q-000000000000000c', text: 'Erst' }),
        openQuestionAnswer({ id: 'oqa_01B', questionId: 'q-000000000000000c', text: 'Dann' }),
      ],
    });
    expect(latestNote(noted)?.text).toBe('Dann');
    expect(latestNote(finding)).toBeNull();
    expect(questionsOfModel(items, 'finanzen/zahlung').map((q) => q.id.slice(-1))).toEqual([
      '2',
      '5',
      '6',
      '7',
    ]);
    expect(questionsOfModel(items, 'finanzen')).toEqual([]);
  });

  it('folds two or more descriptive models with one reason into one notice', () => {
    const descriptive = (id: string, key: string) =>
      openQuestion({
        id,
        kind: 'descriptive-model',
        source: 'signal',
        group: 'info',
        subject: { type: 'model', id: key },
        detail: 'Die automatische Verknüpfung findet hier wenig.',
      });
    const two = [descriptive('q-00000000000000d1', 'a'), descriptive('q-00000000000000d2', 'b')];
    const group = infoGroup([...two, summary], 6);
    expect(group.descriptive?.text).toBe(
      '2 von 6 Modellen sind beschreibend (ohne Engine). Die automatische Verknüpfung findet hier wenig.',
    );
    expect(group.descriptive?.items).toHaveLength(2);
    expect(group.rest).toEqual([summary]);
    expect(infoGroup([two[0]!, summary], 6).descriptive).toBeNull();
  });

  it('shows the labels the export writes, and marks the informational kinds', () => {
    for (const [kind, p] of Object.entries(OPEN_QUESTION_KINDS)) {
      expect(p.label).toBe(OPEN_QUESTION_KIND_LABELS[kind as keyof typeof OPEN_QUESTION_KINDS]);
    }
    expect(
      Object.entries(OPEN_QUESTION_KINDS)
        .filter(([, p]) => p.informational)
        .map(([k]) => k)
        .sort(),
    ).toEqual(['descriptive-model', 'summary-note']);
    expect(OPEN_QUESTION_KINDS['message-partner-missing'].label).toBe(
      'Partner der Nachricht fehlt',
    );
    // UX2b: the glossary's state label, also in the export's filter line
    expect(OPEN_QUESTION_STATES.answered).toBe('Außerhalb der Landschaft');
  });
});

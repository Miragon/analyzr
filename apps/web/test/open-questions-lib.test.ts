import {
  OPEN_QUESTION_KIND_LABELS,
  OPEN_QUESTION_SOURCE_LABELS,
} from '@analyzr/contracts/open-question-labels';
import { describe, expect, it } from 'vitest';

import {
  OPEN_QUESTION_KINDS,
  OPEN_QUESTION_SOURCES,
  askWhoText,
  attachmentName,
  exportQuery,
  extraRefs,
  filterOpenQuestions,
  hasFilters,
  openQuestionFacets,
  parseOpenQuestionFilters,
  questionLinks,
  questionsOfModel,
  unlocksText,
} from '../src/lib/open-questions';
import { openQuestion } from './support/fixtures';

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
const items = [finding, held, pool, step];

describe('open questions: filters', () => {
  it('keeps the valid filters of a URL search', () => {
    expect(
      parseOpenQuestionFilters({
        kind: 'held',
        source: 'nope',
        model: 'finanzen',
        askWho: ' ',
        state: 'open',
        other: 'x',
      }),
    ).toEqual({ kind: 'held', model: 'finanzen', state: 'open' });
    expect(parseOpenQuestionFilters({ kind: 'toString', state: 'closed' })).toEqual({});
    expect(hasFilters({})).toBe(false);
    expect(hasFilters({ askWho: 'Vertrieb' })).toBe(true);
  });

  it('filters as the server does: a model or a folder, contact hints exactly', () => {
    const ids = (f: Parameters<typeof filterOpenQuestions>[1]) =>
      filterOpenQuestions(items, f).map((q) => q.id.slice(-1));
    // `finanzen` matches the folder, not `finanzenx/…`
    expect(ids({ model: 'finanzen' })).toEqual(['1', '2']);
    expect(ids({ model: 'finanzen/zahlung' })).toEqual(['2']);
    expect(ids({ model: 'finanzen/zahl' })).toEqual([]);
    // a lane, the step owner or the folder, exactly
    expect(ids({ askWho: 'Vertrieb' })).toEqual(['2']);
    expect(ids({ askWho: 'Finanzen' })).toEqual(['2']);
    expect(ids({ askWho: 'finanzen' })).toEqual(['1', '2']);
    expect(ids({ askWho: 'Buch' })).toEqual([]);
    expect(ids({ kind: 'held', source: 'hold', state: 'open' })).toEqual(['2']);
    expect(ids({ state: 'answered' })).toEqual([]);
    expect(ids({})).toEqual(['1', '2', '3', '4']);
  });

  it('offers and matches each step owner of an item on its own', () => {
    const both = openQuestion({
      id: 'q-0000000000000005',
      askWho: { lanes: [], stepOwners: ['Einkauf', 'Finanzen'], folder: null },
    });
    const list = [...items, both];
    expect(filterOpenQuestions(list, { askWho: 'Einkauf' }).map((q) => q.id.slice(-1))).toEqual([
      '4',
      '5',
    ]);
    expect(filterOpenQuestions(list, { askWho: 'Finanzen' }).map((q) => q.id.slice(-1))).toEqual([
      '2',
      '5',
    ]);
    expect(openQuestionFacets(list, {}).askWho[0]).toEqual({
      label: 'Organisationseinheiten',
      options: [
        { value: 'Einkauf', label: 'Einkauf', count: 2 },
        { value: 'Finanzen', label: 'Finanzen', count: 2 },
      ],
    });
    expect(askWhoText(both.askWho)).toBe('Organisationseinheiten: Einkauf, Finanzen');
  });

  it('sends the same filters to the export, the model as `modelKey`', () => {
    expect(exportQuery({ model: 'finanzen', kind: 'held', askWho: 'Vertrieb' })).toEqual({
      modelKey: 'finanzen',
      kind: 'held',
      askWho: 'Vertrieb',
    });
    expect(exportQuery({})).toEqual({});
  });

  it('counts each option under the other filters and lists only those with items', () => {
    const facets = openQuestionFacets(items, {});
    expect(facets.kinds.map((o) => [o.value, o.count])).toEqual([
      ['held', 1],
      ['call-target-unknown', 1],
      ['step-without-process', 1],
      ['black-box-partner', 1],
    ]);
    expect(facets.kinds[0]?.label).toBe('Vorgemerkt');
    expect(facets.sources.map((o) => o.value)).toEqual([
      'hold',
      'finding',
      'value-chain-finding',
      'signal',
    ]);
    expect(facets.states).toEqual([{ value: 'open', label: 'Offen', count: 4 }]);
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
    expect(facets.askWho).toEqual([
      {
        label: 'Organisationseinheiten',
        options: [
          { value: 'Einkauf', label: 'Einkauf', count: 1 },
          { value: 'Finanzen', label: 'Finanzen', count: 1 },
        ],
      },
      {
        label: 'Lanes',
        options: [
          { value: 'Buchhaltung', label: 'Buchhaltung', count: 1 },
          { value: 'Vertrieb', label: 'Vertrieb', count: 1 },
        ],
      },
      {
        label: 'Ordner',
        options: [
          { value: 'finanzen', label: 'finanzen', count: 2 },
          { value: 'finanzenx', label: 'finanzenx', count: 1 },
        ],
      },
    ]);

    // under kind=held the other facets count only held items; the kind facet ignores its own filter
    const narrowed = openQuestionFacets(items, { kind: 'held' });
    expect(narrowed.kinds.map((o) => o.value)).toEqual([
      'held',
      'call-target-unknown',
      'step-without-process',
      'black-box-partner',
    ]);
    expect(narrowed.sources).toEqual([{ value: 'hold', label: 'Vormerkung', count: 1 }]);
    expect(narrowed.models.map((o) => o.value)).toEqual(['finanzen/zahlung', 'vertrieb/auftrag']);

    // a selected value without items stays selectable
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
    expect(empty.askWho.at(-1)).toEqual({
      label: 'Gewählt',
      options: [{ value: 'Niemand', label: 'Niemand', count: 0 }],
    });
    expect(empty.folders.map((o) => o.value)).toContain('gibt/es-nicht');
  });
});

describe('open questions: presentation and links', () => {
  it('links each subject to where it is decided', () => {
    expect(questionLinks(held)).toEqual([
      { to: 'review', relation: 'rel_01HELD', label: 'Prüfen' },
    ]);
    expect(questionLinks(step)).toEqual([
      { to: 'chain', step: 'step-einkauf', label: 'Schritt auf der Kette zeigen' },
    ]);
    expect(questionLinks({ kind: 'held', subject: { type: 'placement', id: 'plc_01X' } })).toEqual([
      { to: 'chain', placement: 'plc_01X', label: 'Auf der Kette prüfen' },
    ]);
    expect(
      questionLinks({ kind: 'summary-note', subject: { type: 'value-chain', id: 'main' } }),
    ).toEqual([{ to: 'chain', label: 'Zur Wertschöpfungskette' }]);
    expect(
      questionLinks({ kind: 'summary-note', subject: { type: 'model', id: 'a/order' } }),
    ).toEqual([{ to: 'model', modelKey: 'a/order', label: 'Modell öffnen' }]);
    expect(questionLinks(finding)).toEqual([
      { to: 'model', modelKey: 'a/order', element: 'Call_1', label: 'Im Modell zeigen' },
    ]);
    // a process's place on the chain also leads to the chain page
    expect(
      questionLinks({
        kind: 'process-without-step',
        subject: { type: 'process', id: 'a/order#Process_Order' },
      }),
    ).toEqual([
      { to: 'model', modelKey: 'a/order', element: 'Process_Order', label: 'Im Modell zeigen' },
      { to: 'chain', label: 'Zur Wertschöpfungskette' },
    ]);
  });

  it('lists the refs besides the subject, and the items of exactly one model', () => {
    expect(extraRefs(finding)).toEqual([]);
    expect(extraRefs({ ...held, refs: ['finanzen/zahlung#A', 'vertrieb/auftrag#B'] })).toEqual([
      'finanzen/zahlung#A',
      'vertrieb/auftrag#B',
    ]);
    expect(questionsOfModel(items, 'finanzen/zahlung').map((q) => q.id)).toEqual([held.id]);
    expect(questionsOfModel(items, 'finanzen')).toEqual([]);
  });

  it('says what an item ranks by and whom to ask, as the export does', () => {
    expect(unlocksText(finding)).toBe('4 offene Entscheidungen');
    expect(unlocksText(pool)).toBe('1 offene Entscheidung');
    expect(unlocksText({ kind: 'isolated-process', unlocks: 0 })).toBe('Keine offene Entscheidung');
    expect(unlocksText({ kind: 'summary-note', unlocks: 1 })).toBe('Zur Information');
    expect(unlocksText({ kind: 'descriptive-model', unlocks: 1 })).toBe('Zur Information');
    expect(askWhoText(held.askWho)).toBe(
      'Organisationseinheit: Finanzen; Lanes: Vertrieb; Ordner: finanzen',
    );
    expect(askWhoText({ lanes: [], stepOwners: [], folder: null })).toBe('');
    expect(OPEN_QUESTION_KINDS['black-box-partner'].label).toBe('Pool ohne Prozess');
  });

  it('shows the labels the export writes, and marks the informational kinds', () => {
    for (const [kind, p] of Object.entries(OPEN_QUESTION_KINDS)) {
      expect(p.label).toBe(OPEN_QUESTION_KIND_LABELS[kind as keyof typeof OPEN_QUESTION_KINDS]);
    }
    for (const [source, p] of Object.entries(OPEN_QUESTION_SOURCES)) {
      expect(p.label).toBe(
        OPEN_QUESTION_SOURCE_LABELS[source as keyof typeof OPEN_QUESTION_SOURCES],
      );
    }
    expect(
      Object.entries(OPEN_QUESTION_KINDS)
        .filter(([, p]) => p.informational)
        .map(([k]) => k)
        .sort(),
    ).toEqual(['descriptive-model', 'summary-note']);
    expect(OPEN_QUESTION_KINDS['message-partner-missing'].label).toBe(
      'Nachrichten- oder Signalpartner fehlt',
    );
  });

  it('takes the download name from Content-Disposition', () => {
    expect(attachmentName('attachment; filename="offene-fragen-demo.csv"', 'x.csv')).toBe(
      'offene-fragen-demo.csv',
    );
    expect(attachmentName(null, 'x.md')).toBe('x.md');
    expect(attachmentName('attachment', 'x.md')).toBe('x.md');
  });
});

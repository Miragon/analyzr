/**
 * The open-questions read model (M6 S4, §4.1–§4.4), a pure function of the
 * head facts, findings, relations, judgements, no-links, candidates, the
 * value chain and the current submissions:
 * - `nordwind-handel` as imported (the libraries' view): the expected kinds
 *   and counts, ids stable across reads and new when a model's facts change;
 * - the gap signals on `nordwind-handel` and on eval:descriptive's variants
 *   of it (the signal counts that decided which signals ship);
 * - every source of §4.1 on a synthetic landscape, with ids, texts,
 *   `askWho` and `unlocks`;
 * - filters, order (value chain findings after the other questions, owner
 *   answer 2026-10-16) and cursor pages;
 * - the Markdown and CSV export, the CSV's formula protection and its round trip;
 * - answers (M6 S5a): the state and the answers on the items, where each
 *   answer's text lands (the use case's routing on a stand-in transaction),
 *   the answers in both exports, and the check of a filled-in sheet.
 * Synthetic models only besides the dev landscape.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CONTACT_COLUMNS,
  OPEN_QUESTION_CSV_COLUMNS,
  OPEN_QUESTION_GROUP_LABELS,
  OPEN_QUESTION_KIND_LABELS,
  OpenQuestion,
  OpenQuestionGroup,
  OpenQuestionKind,
  OpenQuestionPage,
  OpenQuestionSource,
  isInformationalKind,
  readAnswerSheet,
  type OpenQuestionAnswerId,
  type ProjectId,
} from '@analyzr/contracts';
import { landscapeVariants } from '@analyzr/eval-tools/descriptive';
import { describe, expect, it } from 'vitest';

import { decodeCursor } from '../../src/domain/cursor.ts';
import {
  CSV_BOM,
  detailText,
  escapeMarkdown,
  exportFilename,
  formatDateDe,
  parseOpenQuestionsCsv,
  protectCell,
  renderOpenQuestionsCsv,
  renderOpenQuestionsMarkdown,
  unprotectCell,
} from '../../src/domain/open-questions/export.ts';
import type { Actor } from '../../src/domain/actor.ts';
import { DomainError } from '../../src/domain/errors.ts';
import { checkSheet, sameAnswer } from '../../src/domain/open-questions/answers.ts';
import {
  OPEN_QUESTION_GROUP_RULES,
  POSITION_SHAPE,
  groupOf,
  rankGroup,
  type OpenQuestionInput,
} from '../../src/domain/open-questions/model.ts';
import {
  askByModel,
  buildOpenQuestions,
  filterOpenQuestions,
  groupTotals,
  kindCounts,
  openQuestionPage,
  openQuestions,
  pageOpenQuestions,
  signalCounts,
} from '../../src/domain/open-questions/read-model.ts';
import {
  GAP_SIGNALS,
  SHIPPED_SIGNALS,
  SIGNALS_OFF,
} from '../../src/domain/open-questions/signals.ts';
import { noLinkCode } from '../../src/domain/open-questions/sources.ts';
import {
  CandidateCache,
  currentPlacementBatches,
  recordAnswers,
} from '../../src/domain/use-cases/open-questions.ts';
import type {
  DoneChainTask,
  OpenQuestionAnswerRecord,
  RelationRecord,
  StoredOpenQuestionAnswer,
  Tx,
} from '../../src/domain/ports.ts';
import { pairKey } from '../../src/domain/judgements.ts';
import { recomputeStatus } from '../../src/domain/status.ts';
import { CORPUS_DIR, corpusFiles } from '../support/corpus.ts';
import {
  AT,
  PROJECT,
  assertion,
  assertionId,
  libraryInput,
  relationId,
} from '../support/open-questions.ts';
import {
  A,
  AGENT,
  AGENT_2,
  AUFTRAG,
  CALL,
  DEFS,
  HUMAN,
  N,
  R,
  RECHNUNG,
  START_RECHNUNG,
  STORNO,
  TASK_NOTIZ,
  TASK_RECHNUNG,
  noLink,
  placement,
  placementAssertionId,
  placementId,
  synthetic,
} from '../support/open-questions-synthetic.ts';

const ID = /^q-[0-9a-f]{16}$/;
/** The UI load guard's id regex (UX-SIMPLIFICATION §7): no id, seq or ref in visible text. */
const ID_IN_TEXT = /rel_|plc_|agt_|mam_|oqa_|q-[0-9a-f]{16}|sid-|Stand s\d|Ereignis \d/;

// ------------------------------------------------------------ nordwind-handel

describe('nordwind-handel as imported', () => {
  it('lists its findings and black-box pools, nothing else, in a stable order', async () => {
    const input = await libraryInput(await corpusFiles('nordwind-handel'));
    const items = openQuestions(input);
    expect(kindCounts(items)).toEqual({
      'call-target-unknown': 2,
      'call-target-dynamic': 2,
      'duplicate-process-id': 1,
      'message-partner-missing': 9,
      'black-box-partner': 6,
    });
    for (const q of items) {
      expect(OpenQuestion.parse(q)).toEqual(q);
      expect(q.id).toMatch(ID);
      expect(q.state).toBe('open');
      expect(q.unlocks).toBeGreaterThanOrEqual(0);
    }
    expect(new Set(items.map((q) => q.id)).size).toBe(items.length);
    // Ordered by unlocks, descending.
    expect(items.map((q) => q.unlocks)).toEqual(
      [...items.map((q) => q.unlocks)].sort((a, b) => b - a),
    );
    // A second read gives the same items.
    expect(openQuestions(input)).toEqual(items);
    const call = items.find((q) => q.subject.id === 'vertrieb/order-handling#Call_FraudCheck');
    expect(call).toMatchObject({
      kind: 'call-target-unknown',
      source: 'finding',
      subject: { type: 'ref', id: 'vertrieb/order-handling#Call_FraudCheck' },
      subjectLabel: '„Run fraud check“',
      modelKeys: ['vertrieb/order-handling'],
      askWho: { lanes: [], stepOwners: [], folder: 'vertrieb' },
      raisedBy: { sourceKind: 'rule', handle: null },
    });
    // UX2a: the question first, the reason apart and in plain German (no calledElement).
    expect(call).toMatchObject({
      group: 'ask',
      text: 'Welchen Prozess ruft „Run fraud check“ auf?',
      detail: 'Das eingetragene Ziel „Process_FraudCheck“ gibt es in keinem Modell.',
    });
    const duplicate = items.find((q) => q.kind === 'duplicate-process-id');
    expect(duplicate?.modelKeys).toEqual([
      'einkauf/archiv/bestellfreigabe-2019',
      'einkauf/bestellfreigabe',
    ]);
    expect(duplicate).toMatchObject({
      subjectLabel: '„Bestellfreigabe“',
      text: 'Welche Kopie von „Bestellfreigabe“ gilt?',
      detail:
        'Die Prozess-ID „Process_Bestellfreigabe“ steht in 2 Modellen ' +
        '(einkauf/archiv/bestellfreigabe-2019, einkauf/bestellfreigabe); Aufrufe darauf sind ' +
        'mehrdeutig.',
    });
    // A pool without a process: named by the pool it talks to, never by its id.
    const pool = items.find((q) => q.subject.id === 'logistik/shipping#Participant_Carrier');
    expect(pool?.subjectLabel).toBe('Pool in „Nordwind Logistics – Parcel shipping“');
    expect(pool?.text).toBe(
      'Externer Partner oder fehlendes Modell? Nachrichten: „Pickup scan“, „Proof of delivery“, ' +
        '„Shipping order“.',
    );
    expect(pool?.detail).toBe(
      'Der Pool hat im Modell keinen Prozess: ein externer Partner, oder ein Prozess, dessen ' +
        'Modell fehlt. Nachrichtenflüsse: „Pickup scan“ an „Await pickup scan“; „Proof of ' +
        'delivery“ an „Await proof of delivery“; „Shipping order“ von „Transmit shipping order ' +
        'to carrier“.',
    );
    // Every item of a project as imported asks something (no agent, no chain yet).
    expect(new Set(items.map((q) => q.group))).toEqual(new Set(['ask']));
    for (const q of items.filter((x) => x.kind === 'black-box-partner')) {
      expect(q.subjectLabel).toMatch(/^Pool in „[^_]+“$/);
    }
  });

  it('versions items by what they ask about, not by the whole model (S5c-1)', async () => {
    const input = await libraryInput(await corpusFiles('nordwind-handel'));
    const before = openQuestions(input);
    // A new facts_hash alone (another element of the model changed): every id stays.
    const models = new Map(input.models);
    const head = models.get('vertrieb/order-handling');
    if (!head) throw new Error('model missing');
    models.set('vertrieb/order-handling', { ...head, factsHash: 'f'.repeat(64) });
    expect(openQuestions({ ...input, models }).map((q) => q.id)).toEqual(before.map((q) => q.id));
    // A changed fact at the fraud check (its label, say): only its item gets a new id.
    const call = 'vertrieb/order-handling#Call_FraudCheck';
    const projectFacts = {
      models: input.projectFacts.models.map((m) => ({
        ...m,
        facts: m.facts.map((f) => (f.ref === call ? { ...f, fingerprint: '0'.repeat(12) } : f)),
      })),
    };
    const after = openQuestions({ ...input, projectFacts });
    expect(after.map((q) => q.subject)).toEqual(before.map((q) => q.subject));
    for (const [i, q] of after.entries()) {
      if (q.subject.id === call) expect(q.id).not.toBe(before[i]?.id);
      else expect(q.id, `${q.kind} ${q.subject.id}`).toBe(before[i]?.id);
    }
    // A pool's item changes with its flows' inside ends.
    const pool = before.find((q) => q.subject.id === 'logistik/shipping#Participant_Carrier');
    const inside = pool?.refs.find((r) => r !== pool.subject.id);
    if (!pool || inside === undefined) throw new Error('no pool with flows');
    const moved = openQuestions({
      ...input,
      projectFacts: {
        models: input.projectFacts.models.map((m) => ({
          ...m,
          facts: m.facts.map((f) => (f.ref === inside ? { ...f, fingerprint: '1'.repeat(12) } : f)),
        })),
      },
    });
    expect(moved.find((q) => q.subject.id === pool.subject.id)?.id).not.toBe(pool.id);
  });
});

describe('the gap signals', () => {
  it('ship all but message-without-name, which has its reason', () => {
    expect(SHIPPED_SIGNALS).toEqual(GAP_SIGNALS.filter((s) => s !== 'message-without-name'));
    expect(Object.keys(SIGNALS_OFF)).toEqual(['message-without-name']);
    expect(SIGNALS_OFF['message-without-name']).toMatch(/duplicates message-partner-missing/);
  });

  // The counts that decided which signals ship (M6 §8 "S4 as delivered"). Each
  // variant is eval:descriptive's cumulative transform of the dev models.
  it('fire on nordwind-handel and its descriptive variants where information is missing', async () => {
    const { variants } = await landscapeVariants(path.join(CORPUS_DIR, 'nordwind-handel'));
    const counts: Record<string, Record<string, number>> = {};
    const nameless: Record<string, { flowEnds: number; findings: number; other: number }> = {};
    for (const [name, models] of variants) {
      const input = await libraryInput(models.map((m) => ({ key: m.key, bytes: m.xml })));
      counts[name] = signalCounts(input);
      // Why message-without-name stays off: a nameless message endpoint is either a
      // message-flow end or already a dangling-throw/unmatched-catch finding.
      const asked = new Set(input.findings.flatMap((f) => f.refs));
      const tally = { flowEnds: 0, findings: 0, other: 0 };
      for (const m of input.projectFacts.models) {
        const ends = new Set(m.messageFlows.flatMap((f) => [f.from, f.to]));
        for (const f of m.facts) {
          if (f.kind !== 'msg_throw' && f.kind !== 'msg_catch') continue;
          if (f.attrs.messageName !== undefined) continue;
          if (ends.has(f.ref)) tally.flowEnds++;
          else if (asked.has(f.ref)) tally.findings++;
          else tally.other++;
        }
      }
      nameless[name] = tally;
    }
    const none = Object.fromEntries(GAP_SIGNALS.map((s) => [s, 0]));
    expect(counts).toEqual({
      baseline: { ...none, 'black-box-partner': 6 },
      'engine-stripped': { ...none, 'black-box-partner': 6 },
      descriptive: { ...none, 'black-box-partner': 6, 'descriptive-model': 31 },
      pools: { ...none, 'black-box-partner': 50, 'descriptive-model': 31 },
      tasks: { ...none, 'black-box-partner': 50, 'isolated-process': 2, 'descriptive-model': 31 },
      'no-docs': {
        ...none,
        'black-box-partner': 50,
        'undocumented-process': 32,
        'isolated-process': 2,
        'descriptive-model': 31,
      },
    });
    expect(nameless).toEqual({
      baseline: { flowEnds: 4, findings: 0, other: 0 },
      'engine-stripped': { flowEnds: 4, findings: 0, other: 0 },
      descriptive: { flowEnds: 19, findings: 46, other: 0 },
      pools: { flowEnds: 65, findings: 0, other: 0 },
      tasks: { flowEnds: 39, findings: 0, other: 0 },
      'no-docs': { flowEnds: 39, findings: 0, other: 0 },
    });
  }, 60_000);
});

// ------------------------------------------------------- synthetic landscape

describe('every source of §4.1 on a synthetic landscape', () => {
  it('maps each source with its kind, subject, text and raiser', async () => {
    const input = await synthetic();
    const items = openQuestions(input);
    for (const q of items) expect(OpenQuestion.parse(q)).toEqual(q);
    expect(kindCounts(items)).toEqual({
      // The coded no-links join the finding on their call and the bank's pool (UX2b review).
      'call-target-unknown': 1,
      'message-partner-missing': 1,
      held: 2,
      'agent-question': 2,
      'placement-unsure': 1,
      // One question per process: Rechnungsstellung's placement is held (its hold asks it),
      // and an agent asks about Notizen's proposed placement (UX2a).
      'step-without-process': 2,
      'unresolved-link': 1,
      'summary-note': 2,
      unjudged: 1,
      'black-box-partner': 1,
      'unlabelled-boundary': 1,
      'undocumented-process': 1,
      'isolated-process': 1,
      'descriptive-model': 1,
    });
    const one = (kind: string, source: string, subjectId?: string) => {
      const found = items.filter(
        (q) =>
          q.kind === kind &&
          q.source === source &&
          (subjectId === undefined || q.subject.id === subjectId),
      );
      expect(found, `${kind} ${source} ${subjectId ?? ''}`).toHaveLength(1);
      return found[0] as OpenQuestion;
    };

    const finding = one('call-target-unknown', 'finding');
    expect(finding).toMatchObject({
      subject: { type: 'ref', id: CALL },
      group: 'ask',
      text: 'Welchen Prozess ruft „Bonität prüfen“ auf?',
      // The agent's coded no-links about the call, attributed, after the reason from code.
      detail:
        'Das eingetragene Ziel „P_Bonitaet“ gibt es in keinem Modell.\n' +
        'Laut Agent: call-target: „Notizen“ prüft keine Bonität.\n' +
        'Laut Agent: call-target: „Rechnungsstellung“ ist kein Prüfprozess.',
      askWho: {
        lanes: ['Vertriebsinnendienst'],
        stepOwners: ['Vertrieb & Service'],
        folder: 'vertrieb',
      },
    });
    expect(one('message-partner-missing', 'finding')).toMatchObject({
      text: 'Wer empfängt, was „Auftrag storniert“ sendet?',
      detail:
        'Kein anderer Prozess der Landschaft empfängt die Nachricht „AuftragStorniert“, und ' +
        'kein Nachrichtenfluss führt zu einem Partner.',
    });

    const heldRelation = items.find((q) => q.kind === 'held' && q.subject.type === 'relation');
    expect(heldRelation).toMatchObject({
      source: 'hold',
      group: 'ask',
      subjectLabel: '„Rechnung anfordern“ → „Rechnung angefordert“',
      text: '=Kommt die Anforderung immer als Nachricht?',
      detail: null,
      context: 'Mit Finanzen klären, ob die Anforderung als Nachricht kommt.',
      label: 'mit Fachbereich Finanzen klären',
      modelKeys: ['finanzen/rechnung', 'vertrieb/auftrag'],
      refs: [START_RECHNUNG, TASK_RECHNUNG],
      raisedBy: { sourceKind: 'human', handle: 'owner', seq: 50 },
    });
    const heldPlacement = items.find((q) => q.kind === 'held' && q.subject.type === 'placement');
    expect(heldPlacement).toMatchObject({
      subject: { type: 'placement', id: placementId(2) },
      subjectLabel: '„Rechnungsstellung“ auf „Finanzen“',
      text: 'Gehört die Rechnungsstellung zu Finanzen oder zum Vertrieb?',
      context: null,
      label: null,
      askWho: { stepOwners: ['Finanzbuchhaltung'], folder: 'finanzen' },
    });

    const relationQuestion = items.find(
      (q) => q.kind === 'agent-question' && q.subject.type === 'relation',
    );
    expect(relationQuestion).toMatchObject({
      subject: { type: 'relation', id: relationId(90) },
      group: 'agent',
      detail: null,
      text: 'Prüft „Rechnungsstellung“ (finanzen/rechnung) die Bonität für „Bonität prüfen“?',
      raisedBy: { sourceKind: 'agent', handle: 'agent:claude', seq: 60 },
    });
    expect(
      items.find((q) => q.kind === 'agent-question' && q.subject.type === 'placement'),
    ).toMatchObject({
      text: 'Ist „Notizen“ wirklich Ablage?',
      subjectLabel: '„Notizen“ auf „Ablage“',
    });

    // The question from code, the agent's reason verbatim as the detail (UX2a).
    expect(one('placement-unsure', 'unsure')).toMatchObject({
      subject: { type: 'process', id: R },
      group: 'ask',
      text: 'Auf welchen Schritt der Wertschöpfungskette gehört „Rechnungsstellung“?',
      detail: 'Kein Schritt passt eindeutig.',
      raisedBy: { sourceKind: 'agent', handle: 'agent:sim', seq: 70 },
    });

    // „Notizen“ has an agent's question on its proposed placement: one question per
    // process, so no process-without-step item (UX2a, `oneQuestionPerProcess`).
    expect(items.some((q) => q.kind === 'process-without-step')).toBe(false);
    expect(one('step-without-process', 'value-chain-finding', 'step-finanzen')).toMatchObject({
      subjectLabel: '„Finanzen“',
      group: 'ask',
      text: 'Welche Prozesse gehören zu „Finanzen“?',
      modelKeys: [],
      askWho: { lanes: [], stepOwners: ['Finanzbuchhaltung'], folder: null },
      // The held placement on it.
      unlocks: 1,
    });
    expect(one('unresolved-link', 'value-chain-finding')).toMatchObject({
      text: 'Auf welchen Prozess soll der Link von „Ablage“ zeigen?',
      detail: 'Der verlinkte Prozess ist in keinem aktuellen Modell enthalten.',
    });

    // Coded no-links, on their own (without the call's finding and the pool's signal they
    // join): call-target grouped per call, collaboration at the end with a message flow in its
    // own file, no-evidence left out.
    const alone = openQuestions(
      { ...input, findings: input.findings.filter((f) => !f.refs.includes(CALL)) },
      { signals: SHIPPED_SIGNALS.filter((sig) => sig !== 'black-box-partner') },
    );
    const noLink = (kind: string) => {
      const found = alone.filter((q) => q.kind === kind && q.source === 'no-link');
      expect(found, kind).toHaveLength(1);
      return found[0] as OpenQuestion;
    };
    const target = noLink('call-target-unknown');
    expect(target).toMatchObject({
      subject: { type: 'ref', id: CALL },
      text: 'Welchen Prozess ruft „Bonität prüfen“ auf?',
      detail:
        'call-target: „Notizen“ prüft keine Bonität.\ncall-target: „Rechnungsstellung“ ist kein Prüfprozess.',
      refs: [N, R, CALL],
      raisedBy: { sourceKind: 'agent', handle: 'agent:claude', seq: 202 },
    });
    expect(noLink('external-partner')).toMatchObject({
      subject: { type: 'ref', id: TASK_NOTIZ },
      text: 'Ist der Partner von „Notiz schreiben“ extern, oder fehlt sein Modell?',
      detail: 'collaboration: Die Stornierung geht an die Bank.',
    });

    expect(one('summary-note', 'summary', 'vertrieb/auftrag')).toMatchObject({
      subject: { type: 'model', id: 'vertrieb/auftrag' },
      group: 'info',
      subjectLabel: '„Auftragsabwicklung“ (vertrieb/auftrag)',
      text: 'Die Bonitätsprüfung fehlt als Modell.',
      // The model's open decisions: the held message pair and the proposed call.
      unlocks: 2,
    });
    expect(one('summary-note', 'summary', 'main')).toMatchObject({
      subject: { type: 'value-chain', id: 'main' },
      subjectLabel: 'Wertschöpfungskette „Kette“',
      modelKeys: [],
      // The chain's: two open processes, a held and a proposed placement.
      unlocks: 4,
    });
    // The judged call pair is left out, the message pair stays.
    expect(one('unjudged', 'unjudged')).toMatchObject({
      subject: { type: 'model', id: 'vertrieb/auftrag' },
      text: 'Gehört dieses Paar zusammen?',
      detail:
        'Die Analyse von „Auftragsabwicklung“ (vertrieb/auftrag) ' +
        'hat ein zugewiesenes Paar ohne Urteil gelassen, und noch kein Agent hat es bewertet: ' +
        '„Auftrag storniert“ in „Auftragsabwicklung“ → „Rechnung angefordert“ in ' +
        '„Rechnungsstellung“. 2 weitere hat die Analyse nicht aufgeführt.',
      refs: [START_RECHNUNG, STORNO],
    });

    // The signals.
    expect(one('black-box-partner', 'signal')).toMatchObject({
      // The pool it talks to is „Ablage“ (Notizen's participant).
      subjectLabel: 'Pool in „Ablage“',
      text: 'Externer Partner oder fehlendes Modell? Nachrichten: „Überweisung“.',
      // The agent's coded no-link about the end that talks to it joins it (UX2b review).
      detail:
        'Der Pool hat im Modell keinen Prozess: ein externer Partner, oder ein Prozess, dessen ' +
        'Modell fehlt. Nachrichtenflüsse: „Überweisung“ von „Notiz schreiben“.\n' +
        'Laut Agent: collaboration: Die Stornierung geht an die Bank.',
    });
    expect(one('unlabelled-boundary', 'signal')).toMatchObject({
      subject: { type: 'process', id: R },
      text: 'Womit endet „Rechnungsstellung“?',
      detail:
        'Ein Start- oder Endereignis hat keinen Namen; ohne Namen findet analyzr keine ' +
        'Prozesse, die diesen auslösen oder die er auslöst.',
      refs: ['finanzen/rechnung#End_Rechnung', R],
    });
    expect(one('undocumented-process', 'signal').subject).toEqual({ type: 'process', id: N });
    expect(one('isolated-process', 'signal').subject).toEqual({ type: 'process', id: N });
    expect(one('descriptive-model', 'signal')).toMatchObject({
      subject: { type: 'model', id: 'archiv/notiz' },
      group: 'info',
      unlocks: 1,
    });
    // Every item has a group by its kind (UX2a); the step whose proposed placement waits
    // on the chain (Notizen on „Ablage“) is decided there.
    const byGroup = (g: string) => items.filter((q) => q.group === g);
    expect(byGroup('agent').map((q) => q.kind)).toEqual(['agent-question', 'agent-question']);
    expect(
      byGroup('info')
        .map((q) => q.kind)
        .sort(),
    ).toEqual(['descriptive-model', 'summary-note', 'summary-note']);
    expect(byGroup('proposal').map((q) => [q.kind, q.subjectLabel])).toEqual([
      ['step-without-process', '„Ablage“'],
    ]);
    expect(byGroup('ask')).toHaveLength(items.length - 6);
  });

  it('computes unlocks from the open decisions at the subject', async () => {
    const input = await synthetic();
    const items = openQuestions(input);
    const by = (kind: string, subject: string) =>
      items.find((q) => q.kind === kind && q.subject.id === subject);
    // The isolated process: no pair, but open in the chain.
    expect(by('isolated-process', N)?.unlocks).toBe(1);
    // The held relation counts itself, the proposed call at Call_Pruefung's process is
    // elsewhere; Task_Rechnung and Start_Rechnung have no other open pair.
    const heldRelation = items.find((q) => q.kind === 'held' && q.subject.type === 'relation');
    expect(heldRelation?.unlocks).toBe(
      new Set([
        pairKey({ type: 'message', from: TASK_RECHNUNG, to: START_RECHNUNG }),
        ...input.candidates
          .filter(
            (c) =>
              c.basis !== 'compatible' &&
              [c.from, c.to].some((r) => r === TASK_RECHNUNG || r === START_RECHNUNG) &&
              !input.judged.has(pairKey(c)),
          )
          .map(pairKey),
      ]).size,
    );
    // A process counts the pairs at all its elements plus being open in the chain.
    const unsure = by('placement-unsure', R);
    expect(unsure?.unlocks).toBeGreaterThan(1);
    // A placement counts its process's decisions, not the other placements on its step.
    const heldPlacement = items.find((q) => q.kind === 'held' && q.subject.type === 'placement');
    expect(heldPlacement?.unlocks).toBe(unsure?.unlocks);
    // Without a chain, the process is not open: one less.
    const withoutChain = openQuestions({ ...input, chain: null }).find(
      (q) => q.kind === 'unlabelled-boundary',
    );
    expect(withoutChain?.unlocks).toBe((by('unlabelled-boundary', R)?.unlocks ?? 0) - 1);
  });

  it('keeps ids across reads and changes them with their source', async () => {
    const input = await synthetic();
    const items = openQuestions(input);
    expect(openQuestions(await synthetic()).map((q) => q.id)).toEqual(items.map((q) => q.id));
    const idOf = (list: typeof items, kind: string, type?: string) =>
      list.find((q) => q.kind === kind && (type === undefined || q.subject.type === type))?.id;

    // A new hold decision (another assertion) gives the held relation a new id.
    const heldRelation = input.relations.find((r) => r.status === 'held');
    if (!heldRelation) throw new Error('no held relation');
    const histories = new Map(input.histories);
    histories.set(heldRelation.id, [
      ...(histories.get(heldRelation.id) ?? []),
      assertion({
        id: assertionId(51),
        relationId: heldRelation.id,
        seq: 51,
        kind: 'decision',
        verdict: 'hold',
        sourceKind: 'human',
        principalId: HUMAN,
        handle: 'owner',
        rationale: 'Neu vorgemerkt.',
      }),
    ]);
    const rehold = openQuestions({ ...input, histories });
    expect(idOf(rehold, 'held', 'relation')).not.toBe(idOf(items, 'held', 'relation'));
    expect(idOf(rehold, 'held', 'placement')).toBe(idOf(items, 'held', 'placement'));

    // A changed placement input hash, another submission: new ids for those only.
    if (!input.chain) throw new Error('no chain');
    const moved = openQuestions({
      ...input,
      chain: {
        ...input.chain,
        unsure: input.chain.unsure.map((u) => ({ ...u, inputHash: 'h-neu' })),
      },
      submissions: input.submissions.map((s) => ({ ...s, submissionId: `${s.submissionId}x` })),
    });
    for (const kind of ['placement-unsure', 'summary-note', 'unjudged']) {
      expect(idOf(moved, kind), kind).not.toBe(idOf(items, kind));
    }
    expect(idOf(moved, 'black-box-partner')).toBe(idOf(items, 'black-box-partner'));
  });
});

describe('filters, order and pages', () => {
  it('filters by model or folder, kind, source, contact hint and state', async () => {
    const items = openQuestions(await synthetic());
    const ids = (f: Parameters<typeof filterOpenQuestions>[1]) =>
      filterOpenQuestions(items, f).map((q) => q.id);
    expect(ids({ modelKey: 'archiv' })).toEqual(ids({ modelKey: 'archiv/notiz' }));
    expect(ids({ modelKey: 'archiv' }).length).toBeGreaterThan(0);
    expect(ids({ modelKey: 'archiv/noti' })).toEqual([]);
    expect(filterOpenQuestions(items, { kind: 'held' }).every((q) => q.kind === 'held')).toBe(true);
    expect(filterOpenQuestions(items, { source: 'signal' })).toHaveLength(5);
    // The lane of Event_Storno: its finding and the pairs left unjudged that start there.
    expect(
      filterOpenQuestions(items, { askWho: 'Vertriebsleitung' })
        .map((q) => `${q.kind} ${q.subject.id}`)
        .sort(),
    ).toEqual([`message-partner-missing ${STORNO}`, 'unjudged vertrieb/auftrag']);
    expect(
      filterOpenQuestions(items, { askWho: 'Finanzbuchhaltung' }).every((q) =>
        q.askWho.stepOwners.includes('Finanzbuchhaltung'),
      ),
    ).toBe(true);
    expect(ids({ askWho: 'finanzen' }).length).toBeGreaterThan(0);
    expect(ids({ state: 'open' })).toEqual(items.map((q) => q.id));
    expect(ids({ state: 'answered' })).toEqual([]);
  });

  it('pages in list order with a cursor that survives a vanished item', async () => {
    const items = openQuestions(await synthetic());
    const seen: string[] = [];
    let after: Parameters<typeof pageOpenQuestions>[2];
    for (;;) {
      const page = pageOpenQuestions(items, 4, after);
      expect(page.total).toBe(items.length);
      seen.push(...page.items.map((q) => q.id));
      if (page.nextCursor === null) break;
      after = decodeCursor(page.nextCursor, POSITION_SHAPE);
    }
    expect(seen).toEqual(items.map((q) => q.id));
    const first = pageOpenQuestions(items, 3);
    const cursor = decodeCursor(first.nextCursor ?? '', POSITION_SHAPE);
    // The last item of the first page is gone: the next page still starts after it.
    const fewer = items.filter((q) => q.id !== first.items[2]?.id);
    expect(pageOpenQuestions(fewer, 3, cursor).items.map((q) => q.id)).toEqual(
      items.slice(3, 6).map((q) => q.id),
    );
    expect(pageOpenQuestions(items, 500).nextCursor).toBeNull();
  });
});

describe('the export', () => {
  it('renders Markdown grouped by the contact hint, texts escaped', async () => {
    const input = await synthetic();
    const { index, items } = buildOpenQuestions(input);
    const concerns = new Map(items.map((q) => [q.id, index.concerns(q)]));
    const md = renderOpenQuestionsMarkdown(items, {
      projectName: 'Test *Projekt*',
      asOf: new Date('2026-10-17T22:30:00.000Z'),
      filter: { kind: 'held' },
      concerns,
    });
    expect(md.startsWith('# Offene Fragen: Test \\*Projekt\\*\n')).toBe(true);
    // UX2a: a date (German time: past midnight already), no event number, no project key.
    expect(md).toContain('\nStand 18.10.2026: ');
    expect(md).not.toMatch(/Ereignis \d|Projekt `/);
    expect(md).toContain('Filter: Art „Vorgemerkt“.');
    // The id only as an HTML comment right after each heading, no „Kennung“, „Quelle“,
    // „Offene Entscheidungen“ or „Bezug“ lines.
    for (const q of items)
      expect(md).toMatch(new RegExp(`^### \\d+\\. .*\\n<!-- ${q.id} -->$`, 'm'));
    expect(md).not.toMatch(/Kennung|- Quelle|Offene Entscheidungen|Bezug|Ordner:/);
    // The id regex of the UI load guard finds nothing once the comments are gone.
    expect(md.replace(/<!-- q-[0-9a-f]{16} -->/g, '')).not.toMatch(ID_IN_TEXT);
    const groups = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(groups).toEqual([
      ...new Set([...groups].filter((g) => g !== 'Ohne Ansprechpartner')),
      ...(groups.includes('Ohne Ansprechpartner') ? ['Ohne Ansprechpartner'] : []),
    ]);
    expect(groups).toContain('Organisationseinheit Finanzbuchhaltung');
    // The folder is no person to ask: no group heading names it (UX2b review).
    expect(groups.filter((g) => g?.startsWith('Ordner'))).toEqual([]);
    // The hold's verbatim question starts with "=": escaped at the start of the line.
    expect(md).toContain('\n\\=Kommt die Anforderung immer als Nachricht?\n');
    expect(md).toContain('- Vormerkung: mit Fachbereich Finanzen klären');
    expect(md).toContain(
      '- Notiz zur Vormerkung: Mit Finanzen klären, ob die Anforderung als Nachricht kommt.',
    );
    // The question, then its reason, then what it is about by name, the contact hint
    // without the folder.
    expect(md).toContain(
      '\nWelchen Prozess ruft „Bonität prüfen“ auf?\n\n' +
        'Das eingetragene Ziel „P_Bonitaet“ gibt es in keinem Modell.  \n' +
        'Laut Agent: call-target: „Notizen“ prüft keine Bonität.  \n' +
        'Laut Agent: call-target: „Rechnungsstellung“ ist kein Prüfprozess.\n\n' +
        '- Betrifft: „Bonität prüfen“ in „Auftragsabwicklung“\n' +
        '- Ansprechpartner: Vertrieb & Service, Vertriebsinnendienst\n',
    );
    expect(md).toContain(
      '- Betrifft: „Rechnung anfordern“ in „Auftragsabwicklung“ → „Rechnung angefordert“ in ' +
        '„Rechnungsstellung“\n',
    );
    expect(escapeMarkdown('<img src=x> *a* [l](u) # b\n- c\n1. d\n> e')).toBe(
      '\\<img src=x> \\*a\\* \\[l\\](u) # b  \n\\- c  \n1\\. d  \n\\> e',
    );
    // `_` only where it can delimit emphasis, `&` only before an entity.
    expect(escapeMarkdown('Participant_Bank _x_ a\\_b R&D &amp; &#35;')).toBe(
      'Participant_Bank \\_x\\_ a\\\\\\_b R&D \\&amp; \\&#35;',
    );
    expect(
      renderOpenQuestionsMarkdown([], { projectName: 'P', asOf: new Date(0), filter: {} }),
    ).toContain('Keine offenen Fragen.');
    expect(formatDateDe('2026-10-17T21:59:59.000Z')).toBe('17.10.2026');
    expect(formatDateDe('2026-10-17T22:00:00.000Z')).toBe('18.10.2026');
  });

  it('writes a CSV spreadsheets open safely, and reads it back', async () => {
    const { index, items } = buildOpenQuestions(await synthetic());
    const csv = renderOpenQuestionsCsv(items, new Map(items.map((q) => [q.id, index.concerns(q)])));
    expect(csv.startsWith(`${CSV_BOM}"id";"Art";"Frage";"Ansprechpartner";"Antwort"\r\n`)).toBe(
      true,
    );
    expect(csv.endsWith('\r\n')).toBe(true);
    // The hold's question starts with "=": a leading apostrophe, so no formula runs.
    expect(csv).toContain(`"'=Kommt die Anforderung immer als Nachricht?`);
    const { header, rows } = parseOpenQuestionsCsv(csv);
    expect(header).toEqual([...OPEN_QUESTION_CSV_COLUMNS]);
    // The questions only: summaries and the descriptive model ask nothing to answer.
    const questions = items.filter((q) => !isInformationalKind(q.kind));
    expect(questions.length).toBe(items.length - 3);
    expect(rows.map((r) => r[0])).toEqual(questions.map((q) => q.id));
    for (const [i, row] of rows.entries()) {
      const q = questions[i] as OpenQuestion;
      expect(row).toHaveLength(5);
      expect(row[1]).toBe(OPEN_QUESTION_KIND_LABELS[q.kind]);
      // The question, its reason as the second sentence (an agent's attributed), then „Betrifft“.
      const detail = detailText(q);
      expect(row[2]?.startsWith(detail === null ? q.text : `${q.text} ${detail}`)).toBe(true);
      expect(row[2]).toMatch(/\n\nBetrifft: /);
      expect(row[4]).toBe('');
    }
    const held = rows.find((r) => r[2]?.startsWith('=Kommt'));
    expect(held?.[2]).toBe(
      '=Kommt die Anforderung immer als Nachricht?\n\nBetrifft: „Rechnung anfordern“ in ' +
        '„Auftragsabwicklung“ → „Rechnung angefordert“ in „Rechnungsstellung“',
    );
    // Task_Rechnung's process is accepted on a step of „Vertrieb & Service“; no folder.
    expect(held?.[3]).toBe('Vertrieb & Service, Vertriebsinnendienst');
    const call = rows.find((r) =>
      r[2]?.startsWith('Welchen Prozess ruft „Bonität prüfen“ auf? Das'),
    );
    expect(call?.[2]).toBe(
      'Welchen Prozess ruft „Bonität prüfen“ auf? Das eingetragene Ziel „P_Bonitaet“ gibt es ' +
        'in keinem Modell.\nLaut Agent: call-target: „Notizen“ prüft keine Bonität.\n' +
        'Laut Agent: call-target: „Rechnungsstellung“ ist kein Prüfprozess.\n\n' +
        'Betrifft: „Bonität prüfen“ in „Auftragsabwicklung“',
    );
    // An unsure verdict's reason is the agent's: attributed, as on the card.
    const unsure = rows.find((r) =>
      r[2]?.startsWith('Auf welchen Schritt der Wertschöpfungskette gehört „Rechnungsstellung“?'),
    );
    expect(unsure?.[2]).toContain('? Laut Agent: Kein Schritt passt eindeutig.\n\nBetrifft: ');
    // Without names at hand, the subject label.
    expect(parseOpenQuestionsCsv(renderOpenQuestionsCsv(items)).rows[0]?.[2]).toMatch(
      /\n\nBetrifft: /,
    );

    // As a spreadsheet saves it again: no BOM, commas, LF, bare fields, answers filled in;
    // also with the contact column's header before UX2a.
    for (const contact of CONTACT_COLUMNS) {
      const resaved = [
        `id,Art,Frage,${contact},Antwort,Antwortart`,
        `${items[0]?.id ?? ''},Art,"Frage, mit Komma",,"Ja, über ""Bonität""",Antwort`,
        ',,,,,',
        '',
      ].join('\n');
      expect(parseOpenQuestionsCsv(resaved).rows).toEqual([
        [items[0]?.id, 'Art', 'Frage, mit Komma', '', 'Ja, über "Bonität"', 'Antwort'],
      ]);
      expect(readAnswerSheet(resaved)).toEqual([
        { id: items[0]?.id, text: 'Ja, über "Bonität"', kind: 'Antwort', line: 2 },
      ]);
    }
    expect(() => parseOpenQuestionsCsv('"a;b\r\n')).toThrow(/unterminated/);
    expect(() => parseOpenQuestionsCsv('"a"b;c\r\n')).toThrow(/after a closing quote/);
  });

  it('protects every formula trigger and undoes it exactly', () => {
    for (const value of [
      '=1+1',
      '+49 30',
      '-5',
      '@SUM(A1)',
      '\tTab',
      '\rCR',
      '＝1',
      "'=already",
      "''+two",
      "'plain",
      'plain',
      '',
    ]) {
      const cell = protectCell(value);
      expect(/^[=+\-@\t\r＝＋－＠]/.test(cell), JSON.stringify(value)).toBe(false);
      expect(unprotectCell(cell), JSON.stringify(value)).toBe(value);
    }
    expect(protectCell('=1')).toBe("'=1");
    expect(protectCell("'x")).toBe("'x");
  });
});

describe('no-link codes', () => {
  it('reads the code before the colon', () => {
    expect(noLinkCode('call-target: Ziel unklar.')).toBe('call-target');
    expect(noLinkCode('  Collaboration : extern')).toBe('collaboration');
    expect(noLinkCode('Score 0.31 below 0.5: x')).toBeNull();
    expect(noLinkCode('kein Code')).toBeNull();
  });
});

// ------------------------------------------------------------- review fixes

/**
 * A collaboration whose message flows end at a collapsed subprocess and at an
 * intermediate none event (no facts of their own, but lane members), and at
 * an expanded subprocess (named by its children's `subprocessId`); a message
 * catch inside that subprocess, in no lane itself; a signal nobody catches.
 */
const LAGER = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${DEFS}>
  <bpmn:signal id="Sig_Alarm" name="Lageralarm"/>
  <bpmn:collaboration id="Collab_Lager">
    <bpmn:participant id="P_A" name="Auftrag" processRef="Proc_A"/>
    <bpmn:participant id="P_B" name="Lager" processRef="Proc_B"/>
    <bpmn:messageFlow id="MF1" sourceRef="Task_Send" targetRef="Sub_Pick"/>
    <bpmn:messageFlow id="MF2" sourceRef="Evt_None" targetRef="Task_Recv"/>
    <bpmn:messageFlow id="MF3" sourceRef="Task_Send" targetRef="Sub_Pack"/>
  </bpmn:collaboration>
  <bpmn:process id="Proc_A" name="Auftrag" isExecutable="false">
    <bpmn:documentation>Gibt Aufträge ans Lager.</bpmn:documentation>
    <bpmn:laneSet id="LS_A">
      <bpmn:lane id="Lane_Auftrag" name="Team Auftrag">
        <bpmn:flowNodeRef>Task_Send</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Evt_None</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:task id="Task_Send" name="Auftrag senden"/>
    <bpmn:intermediateThrowEvent id="Evt_None" name="Bescheid"/>
  </bpmn:process>
  <bpmn:process id="Proc_B" name="Lager" isExecutable="false">
    <bpmn:documentation>Kommissioniert und verpackt.</bpmn:documentation>
    <bpmn:laneSet id="LS_B">
      <bpmn:lane id="Lane_Lager" name="Team Lager">
        <bpmn:flowNodeRef>Sub_Pick</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Sub_Pack</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_Recv</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:subProcess id="Sub_Pick" name="Kommissionieren"/>
    <bpmn:subProcess id="Sub_Pack" name="Verpacken">
      <bpmn:intermediateCatchEvent id="Evt_Msg" name="Karton bestellt">
        <bpmn:messageEventDefinition id="MED_Karton"/>
      </bpmn:intermediateCatchEvent>
      <bpmn:intermediateThrowEvent id="Evt_Alarm" name="Alarm geben">
        <bpmn:signalEventDefinition id="SED_Alarm" signalRef="Sig_Alarm"/>
      </bpmn:intermediateThrowEvent>
    </bpmn:subProcess>
    <bpmn:task id="Task_Recv" name="Bescheid empfangen"/>
  </bpmn:process>
</bpmn:definitions>`;

describe('the review fixes', () => {
  it('places message-flow ends without facts in their process: no black box, no isolation', async () => {
    const items = openQuestions(await libraryInput([{ key: 'lager/kommission', bytes: LAGER }]));
    for (const q of items) expect(OpenQuestion.parse(q)).toEqual(q);
    expect(items.filter((q) => q.kind === 'black-box-partner')).toEqual([]);
    expect(items.filter((q) => q.kind === 'isolated-process')).toEqual([]);
  });

  it('gives an element inside a subprocess the lanes of the subprocess', async () => {
    const items = openQuestions(await libraryInput([{ key: 'lager/kommission', bytes: LAGER }]));
    const catchQuestion = items.find((q) => q.subject.id === 'lager/kommission#Evt_Msg');
    expect(catchQuestion).toMatchObject({
      kind: 'message-partner-missing',
      askWho: { lanes: ['Team Lager'], stepOwners: [], folder: 'lager' },
    });
    expect(catchQuestion?.text).toBe('Wer sendet, was „Karton bestellt“ empfängt?');
  });

  it('asks signal findings about signals', async () => {
    const items = openQuestions(await libraryInput([{ key: 'lager/kommission', bytes: LAGER }]));
    const alarm = items.find((q) => q.subject.id === 'lager/kommission#Evt_Alarm');
    expect(alarm?.kind).toBe('message-partner-missing');
    expect(alarm?.text).toBe('Wer fängt das Signal, das „Alarm geben“ wirft?');
    expect(alarm?.detail).toBe(
      'Kein anderer Prozess der Landschaft fängt das Signal „Lageralarm“.',
    );
    expect(OPEN_QUESTION_KIND_LABELS['message-partner-missing']).toBe(
      'Partner der Nachricht fehlt',
    );
  });

  it('never reads a no-link code from the object prototype', async () => {
    const input = await synthetic();
    const before = openQuestions(input).filter((q) => q.source === 'no-link');
    const items = openQuestions({
      ...input,
      noLinks: [
        ...input.noLinks,
        noLink(5, CALL, N, 'constructor: Kein Aufruf.'),
        noLink(6, CALL, R, 'Constructor: Kein Aufruf.'),
        noLink(7, STORNO, TASK_NOTIZ, '__proto__: nichts'),
        noLink(8, STORNO, TASK_NOTIZ, 'toString: nichts'),
        noLink(9, STORNO, TASK_NOTIZ, 'hasOwnProperty: nichts'),
      ],
    });
    for (const q of items) expect(OpenQuestion.parse(q)).toEqual(q);
    expect(items.filter((q) => q.source === 'no-link').map((q) => q.id)).toEqual(
      before.map((q) => q.id),
    );
    expect(() => renderOpenQuestionsCsv(items)).not.toThrow();
  });

  it('leaves out holds and questions no decision can reach any more', async () => {
    const input = await synthetic();
    if (!input.chain) throw new Error('no chain');
    const kinds = (items: readonly OpenQuestion[]) =>
      items
        .filter((q) => q.kind === 'held' || q.kind === 'agent-question')
        .map((q) => `${q.kind} ${q.subject.type}`)
        .sort();
    expect(kinds(openQuestions(input))).toEqual([
      'agent-question placement',
      'agent-question relation',
      'held placement',
      'held relation',
    ]);
    // A later chain revision removed both steps: their placements stay, unreachable.
    const live = new Map(input.chain.live);
    live.delete('step-finanzen');
    live.delete('step-ablage');
    // The held relation's model was deleted, and so was the asked relation's callee's.
    const relations = input.relations.map((r): RelationRecord =>
      r.status === 'held' || r.id === relationId(90) ? { ...r, endpointState: 'missing' } : r,
    );
    const stale = openQuestions({ ...input, relations, chain: { ...input.chain, live } });
    expect(kinds(stale)).toEqual([]);
  });

  it('drops an agent question that a later rejection answered', async () => {
    const input = await synthetic();
    const asked = input.relations.find((r) => r.id === relationId(90));
    if (!asked) throw new Error('no asked relation');
    const history = [
      assertion({
        id: assertionId(70),
        relationId: asked.id,
        seq: 10,
        sourceKind: 'agent',
        principalId: AGENT,
        handle: 'agent:claude',
        tier: 'lexical',
        confidence: 0.5,
        fromFp: 'f1',
        toFp: 't1',
        question: 'Alte Frage vor der Ablehnung?',
      }),
      assertion({
        id: assertionId(71),
        relationId: asked.id,
        seq: 20,
        kind: 'decision',
        verdict: 'reject',
        sourceKind: 'human',
        principalId: HUMAN,
        handle: 'owner',
        fromFp: 'f1',
        toFp: 't1',
      }),
      assertion({
        id: assertionId(72),
        relationId: asked.id,
        seq: 30,
        sourceKind: 'agent',
        principalId: AGENT_2,
        handle: 'agent:codex',
        tier: 'lexical',
        confidence: 0.6,
        fromFp: 'f2',
        toFp: 't1',
      }),
    ];
    expect(recomputeStatus(history).status).toBe('proposed');
    const histories = new Map(input.histories);
    histories.set(asked.id, history);
    const questions = openQuestions({ ...input, histories }).filter(
      (q) => q.kind === 'agent-question' && q.subject.type === 'relation',
    );
    expect(questions).toEqual([]);
    // A question asked after the rejection stays.
    histories.set(asked.id, [
      ...history.slice(0, 2),
      { ...history[2], question: 'Neue Frage?' } as (typeof history)[number],
    ]);
    expect(
      openQuestions({ ...input, histories })
        .filter((q) => q.kind === 'agent-question' && q.subject.type === 'relation')
        .map((q) => q.text),
    ).toEqual(['Neue Frage?']);
  });

  it('names every step owner, and the filter matches each of them', async () => {
    const input = await synthetic();
    if (!input.chain) throw new Error('no chain');
    // Auftragsabwicklung is accepted on a step of each org unit.
    const placements = [...input.chain.placements, placement(4, 'step-finanzen', A, 'accepted')];
    const items = openQuestions({ ...input, chain: { ...input.chain, placements } });
    const call = items.find((q) => q.kind === 'call-target-unknown' && q.source === 'finding');
    expect(call?.askWho.stepOwners).toEqual(['Finanzbuchhaltung', 'Vertrieb & Service']);
    for (const owner of ['Finanzbuchhaltung', 'Vertrieb & Service']) {
      expect(filterOpenQuestions(items, { askWho: owner }).map((q) => q.id)).toContain(call?.id);
    }
    expect(filterOpenQuestions(items, { askWho: 'Finanzbuchhaltung, Vertrieb & Service' })).toEqual(
      [],
    );
    const md = renderOpenQuestionsMarkdown(items, { projectName: 'P', asOf: AT, filter: {} });
    expect(md).toContain('\n## Organisationseinheiten Finanzbuchhaltung, Vertrieb & Service\n');
    // The contact hint: the step owners, then the lanes; no folder (UX2a).
    expect(md).toContain(
      '- Ansprechpartner: Finanzbuchhaltung, Vertrieb & Service, Vertriebsinnendienst\n',
    );
    expect(renderOpenQuestionsCsv(items)).toContain(
      '"Finanzbuchhaltung, Vertrieb & Service, Vertriebsinnendienst"',
    );
  });

  it('ranks the value chain findings after the other questions, before informational items', async () => {
    const items = openQuestions(await synthetic());
    const groups = items.map(rankGroup);
    expect(groups).toEqual([...groups].sort((a, b) => a - b));
    expect(new Set(groups)).toEqual(new Set([0, 1, 2]));
    expect(
      items.filter((q) => rankGroup(q) === 1).every((q) => q.source === 'value-chain-finding'),
    ).toBe(true);
    for (const group of [0, 1, 2]) {
      const unlocks = items.filter((q) => rankGroup(q) === group).map((q) => q.unlocks);
      expect(unlocks).toEqual([...unlocks].sort((a, b) => b - a));
    }
    // A chain finding with more open decisions than a question still comes after it.
    const lastQuestion = items.filter((q) => rankGroup(q) === 0).at(-1);
    const firstChain = items.find((q) => rankGroup(q) === 1);
    expect(firstChain?.unlocks).toBeGreaterThan(lastQuestion?.unlocks ?? Infinity);
  });

  it('counts 0 where nothing is open and ranks informational items last', async () => {
    const input = await synthetic();
    const items = openQuestions({ ...input, chain: null });
    // Without a chain nothing is open there: the isolated, undocumented process has no decision.
    expect(items.find((q) => q.kind === 'isolated-process')?.unlocks).toBe(0);
    const informational = items.map((q) => isInformationalKind(q.kind));
    expect(informational).toEqual([...informational].sort((a, b) => Number(a) - Number(b)));
    const questions = items.filter((q) => !isInformationalKind(q.kind)).map((q) => q.unlocks);
    expect(questions).toEqual([...questions].sort((a, b) => b - a));
    expect(informational.at(-1)).toBe(true);
  });

  it('shows the summary of each placement batch until newer batches claimed all its processes', () => {
    const t = (seq: number, processes: string[] | null): DoneChainTask => ({
      id: `ana_${String(seq).padStart(26, '0')}`,
      valueChainKey: 'main',
      seq,
      processes,
    });
    const first = t(10, ['a#P1', 'a#P2']);
    const second = t(20, ['a#P3']);
    const rerun = t(30, ['a#P1']);
    // Three batches: the first still covers P2.
    expect(currentPlacementBatches([first, second, rerun]).map((b) => b.seq)).toEqual([30, 20, 10]);
    // A re-run of P1 and P2 supersedes the first batch.
    expect(
      currentPlacementBatches([first, second, t(40, ['a#P1', 'a#P2'])]).map((b) => b.seq),
    ).toEqual([40, 20]);
    expect(currentPlacementBatches([t(5, null), t(4, null)]).map((b) => b.seq)).toEqual([5]);
    expect(currentPlacementBatches([])).toEqual([]);
  });

  it('computes candidates once per head facts', async () => {
    const input = await libraryInput([
      { key: 'vertrieb/auftrag', bytes: AUFTRAG },
      { key: 'finanzen/rechnung', bytes: RECHNUNG },
    ]);
    const hashes = new Map([...input.models].map(([k, m]) => [k, m.factsHash]));
    let computed = 0;
    const compute = () => {
      computed++;
      return [...input.candidates];
    };
    const cache = new CandidateCache(1);
    const first = cache.get(PROJECT, input.projectFacts, hashes, compute);
    expect(cache.get(PROJECT, input.projectFacts, hashes, compute)).toBe(first);
    expect(computed).toBe(1);
    // A model's new head: computed again.
    const changed = new Map(hashes).set('finanzen/rechnung', 'x'.repeat(64));
    cache.get(PROJECT, input.projectFacts, changed, compute);
    expect(computed).toBe(2);
    // One project per cache of size 1: another project evicts it.
    const other: ProjectId = `prj_${'1'.repeat(26)}`;
    cache.get(other, input.projectFacts, hashes, compute);
    cache.get(PROJECT, input.projectFacts, changed, compute);
    expect(computed).toBe(4);
    // Without a head hash for a model there is no exact key.
    cache.get(PROJECT, input.projectFacts, new Map(), compute);
    cache.get(PROJECT, input.projectFacts, new Map(), compute);
    expect(computed).toBe(6);
  });
});

describe('the export, after review', () => {
  it('breaks bare autolinks in Markdown', () => {
    expect(
      escapeMarkdown('Siehe https://example.org/x, www.example.org und max.muster@example.org'),
    ).toBe('Siehe https\\://example.org/x, www\\.example.org und max.muster\\@example.org');
    // Times and handles stay; an `@` between word characters is escaped even without a domain.
    expect(escapeMarkdown('Zeit 10:30, Kosten@Stelle nicht, agent:claude')).toBe(
      'Zeit 10:30, Kosten\\@Stelle nicht, agent:claude',
    );
  });

  it('names the file after the project and the filters, in ASCII', () => {
    expect(exportFilename('p', {}, 'csv')).toBe('offene-fragen-p.csv');
    expect(exportFilename('p', {}, 'markdown')).toBe('offene-fragen-p.md');
    expect(
      exportFilename(
        'p',
        {
          modelKey: 'finanzen/mahnwesen',
          kind: 'black-box-partner',
          source: 'signal',
          askWho: 'Vertrieb & Service',
          state: 'open',
        },
        'csv',
      ),
    ).toBe('offene-fragen-p-finanzen-mahnwesen-black-box-partner-signal-vertrieb-service.csv');
    // The name says „offene“ already: `open` adds nothing (the web's customer export sends it).
    expect(exportFilename('p', { state: 'open', group: ['ask'] }, 'csv')).toBe(
      'offene-fragen-p.csv',
    );
    expect(exportFilename('p', { state: 'answered' }, 'csv')).toBe('offene-fragen-p-erledigt.csv');
    expect(exportFilename('p', { askWho: 'Größe Überweisung – Café' }, 'markdown')).toBe(
      'offene-fragen-p-groesse-ueberweisung-cafe.md',
    );
    const long = exportFilename('p', { askWho: 'x'.repeat(200) }, 'csv');
    expect(long).toBe(`offene-fragen-p-${'x'.repeat(80)}.csv`);
    expect(exportFilename('p', { askWho: '„“' }, 'csv')).toBe('offene-fragen-p.csv');
    // UX2a: the default groups (`ask`) keep the old name; other groups slug into it.
    expect(exportFilename('p', { group: ['ask'] }, 'csv')).toBe('offene-fragen-p.csv');
    expect(exportFilename('p', { group: ['ask', 'agent'] }, 'csv')).toBe(
      'offene-fragen-p-ask-agent.csv',
    );
  });
});

// ------------------------------------------------------- groups and totals (UX2a)

describe('groups and totals (UX2a)', () => {
  it('give every kind a group, by a Record over the kinds', () => {
    // A kind without a group fails here (and does not compile in `model.ts`).
    expect(Object.keys(OPEN_QUESTION_GROUP_RULES).sort()).toEqual(
      [...OpenQuestionKind.options].sort(),
    );
    for (const kind of OpenQuestionKind.options) {
      for (const proposed of [false, true]) {
        for (const source of OpenQuestionSource.options) {
          expect(OpenQuestionGroup.options, `${kind} ${source} ${proposed}`).toContain(
            groupOf(kind, { source, proposed }),
          );
        }
      }
    }
    const of = (kind: OpenQuestionKind, proposed = false) =>
      groupOf(kind, { source: 'finding', proposed });
    expect(of('agent-question')).toBe('agent');
    expect(of('summary-note')).toBe('info');
    expect(of('descriptive-model')).toBe('info');
    expect(of('process-without-step')).toBe('ask');
    expect(of('process-without-step', true)).toBe('proposal');
    expect(of('step-without-process', true)).toBe('proposal');
    expect(of('unresolved-link', true)).toBe('ask');
    expect(of('held', true)).toBe('ask');
    expect(
      OpenQuestionKind.options.filter((k) => of(k) === 'ask' && of(k, true) === 'ask'),
    ).toEqual(
      OpenQuestionKind.options.filter(
        (k) =>
          !['agent-question', 'summary-note', 'descriptive-model'].includes(k) &&
          k !== 'process-without-step' &&
          k !== 'step-without-process',
      ),
    );
    expect(Object.keys(OPEN_QUESTION_GROUP_LABELS)).toEqual([...OpenQuestionGroup.options]);
    expect(OPEN_QUESTION_GROUP_LABELS.ask).toBe('Zu klären');
  });

  it('filter by group, count per group under the other filters and the ask subjects per model', async () => {
    const items = openQuestions(await synthetic());
    const ask = filterOpenQuestions(items, { group: ['ask'] });
    expect(ask.length).toBeGreaterThan(0);
    expect(ask.every((q) => q.group === 'ask')).toBe(true);
    expect(filterOpenQuestions(items, { group: ['agent', 'info'] }).map((q) => q.id)).toEqual(
      items.filter((q) => q.group === 'agent' || q.group === 'info').map((q) => q.id),
    );
    // The order stays the list order in every filtered list.
    expect(ask.map((q) => q.id)).toEqual(items.filter((q) => q.group === 'ask').map((q) => q.id));
    expect(groupTotals(items)).toEqual({ ask: ask.length, agent: 2, proposal: 1, info: 3 });

    // The page: `total` under every filter, `totals` and `askByModel` without `group`.
    const page = openQuestionPage(items, { group: ['ask'], state: 'open' }, 5);
    expect(page.items).toEqual(ask.slice(0, 5));
    expect(page.total).toBe(ask.length);
    expect(page.totals).toEqual(groupTotals(items));
    expect(OpenQuestionPage.parse(page)).toEqual(page);
    expect(openQuestionPage(items, { state: 'answered' }, 5)).toMatchObject({
      items: [],
      total: 0,
      totals: { ask: 0, agent: 0, proposal: 0, info: 0 },
      askByModel: {},
    });
    // Per model: the distinct subjects of the ask items about neither a relation nor a
    // placement (two items about one call count once), under each model they touch.
    const subjects = (key: string) =>
      new Set(
        ask
          .filter(
            (q) =>
              q.modelKeys.includes(key) &&
              q.subject.type !== 'relation' &&
              q.subject.type !== 'placement',
          )
          .map((q) => `${q.subject.type}:${q.subject.id}`),
      ).size;
    const byModel = askByModel(items);
    expect(Object.keys(byModel)).toEqual(
      [...new Set(ask.flatMap((q) => q.modelKeys))].filter((k) => subjects(k) > 0).sort(),
    );
    for (const [key, n] of Object.entries(byModel)) expect(n, key).toBe(subjects(key));
    // Bonität prüfen: the coded no-link about the call joins the finding, one item (UX2b review).
    expect(
      ask.filter((q) => q.subject.id === CALL && q.kind === 'call-target-unknown'),
    ).toHaveLength(1);
    expect(page.askByModel).toEqual(byModel);
  });

  it('asks one question per process: an agent question or an unsure verdict drops the chain finding', async () => {
    const input = await synthetic();
    if (!input.chain) throw new Error('no chain');
    const pws = (i: OpenQuestionInput) =>
      openQuestions(i).filter((q) => q.kind === 'process-without-step' && q.subject.id === N);
    // An agent asks about Notizen's proposed placement: no chain finding for it.
    expect(pws(input)).toEqual([]);
    // Without the question, the finding is back, decided on the chain (proposal).
    const histories = new Map(input.chain.histories);
    const [, , notiz] = input.chain.placements;
    if (!notiz) throw new Error('no placement of Notizen');
    histories.set(
      notiz.id,
      (histories.get(notiz.id) ?? []).map((a) => ({ ...a, question: null })),
    );
    const quiet = { ...input, chain: { ...input.chain, histories } };
    expect(pws(quiet)).toMatchObject([
      {
        group: 'proposal',
        text: 'Auf welchen Schritt der Wertschöpfungskette gehört „Notizen“?',
        detail: 'Ein Vorschlag wartet auf der Wertschöpfungskette auf Prüfung.',
      },
    ]);
    // Without its placement, it asks (no proposal), with the plain reason.
    const placements = input.chain.placements.filter((p) => p.id !== notiz.id);
    const none = { ...quiet, chain: { ...quiet.chain, placements } };
    expect(pws(none)).toMatchObject([
      { group: 'ask', detail: 'Der Prozess ist noch auf keinem Schritt platziert.' },
    ]);
    // An unsure verdict on it: the unsure item asks, the finding goes.
    const unsure = {
      ...none,
      chain: {
        ...none.chain,
        unsure: [
          ...none.chain.unsure,
          { process: N, reason: 'Unklar.', inputHash: 'h-n', handle: 'agent:sim', seq: 71 },
        ],
      },
    };
    expect(pws(unsure)).toEqual([]);
    expect(
      openQuestions(unsure).filter((q) => q.kind === 'placement-unsure' && q.subject.id === N),
    ).toHaveLength(1);
  });

  it('exports the bundle of the Signavio fixture without an id, ref or seq in its text', async () => {
    const dir = fileURLToPath(
      new URL('../../../../tools/integrate/test/fixtures/signavio/bundle/', import.meta.url),
    );
    const files = (await readdir(dir, { recursive: true }))
      .map((e) => e.split(path.sep).join('/'))
      .filter((e) => e.endsWith('.bpmn'))
      .sort();
    const input = await libraryInput(
      await Promise.all(
        files.map(async (f) => ({
          key: f.slice(0, -'.bpmn'.length),
          bytes: new Uint8Array(await readFile(path.join(dir, f))),
        })),
      ),
    );
    const { index, items } = buildOpenQuestions(input);
    expect(items.length).toBeGreaterThan(0);
    const concerns = new Map(items.map((q) => [q.id, index.concerns(q)]));
    const md = renderOpenQuestionsMarkdown(items, {
      projectName: 'Signavio',
      asOf: AT,
      filter: {},
      concerns,
    });
    expect(md.replace(/<!-- q-[0-9a-f]{16} -->/g, '')).not.toMatch(ID_IN_TEXT);
    const csv = parseOpenQuestionsCsv(renderOpenQuestionsCsv(items, concerns));
    expect(csv.rows.map((r) => r.slice(1).join('\n')).join('\n')).not.toMatch(ID_IN_TEXT);
    // Its pool is named by the pool it talks to.
    expect(items.filter((q) => q.kind === 'black-box-partner').map((q) => q.subjectLabel)).toEqual([
      'Pool in „Vertrieb“',
    ]);
  });
});

// ------------------------------------------------- notes and outside marks (S5a, S5c-1)

const HUMAN_ACTOR: Actor = {
  principalId: HUMAN,
  kind: 'user',
  handle: 'owner',
  clientId: 'analyzr-web',
  interactive: true,
  scopes: ['analyzr:review'],
  binding: null,
};

const answerId = (n: number): OpenQuestionAnswerId => `oqa_${String(n).padStart(26, '0')}`;

/** A stored answer to `q` (a note answer for relation and placement subjects). */
function stored(
  n: number,
  q: OpenQuestion,
  over: Partial<StoredOpenQuestionAnswer> = {},
): StoredOpenQuestionAnswer {
  const note =
    q.subject.type === 'relation'
      ? assertionId(900 + n)
      : q.subject.type === 'placement'
        ? placementAssertionId(900 + n)
        : null;
  return {
    id: answerId(n),
    projectId: PROJECT,
    questionId: q.id,
    subjectType: q.subject.type,
    subjectId: q.subject.id,
    kind: 'answer',
    text: note === null ? `Antwort ${n}` : null,
    noteAssertionId: note,
    principalId: HUMAN,
    sourceKind: 'human',
    seq: 1000 + n,
    answerText: `Antwort ${n}`,
    handle: 'owner',
    createdAt: AT,
    withdrawal: null,
    ...over,
  };
}

/** A withdrawal of a stored mark. */
const withdrawal = (seq: number) => ({ seq, principalId: HUMAN, handle: 'owner', createdAt: AT });

describe('notes and outside marks on the items', () => {
  it('turns an item answered only while a live outside mark names its id', async () => {
    const input = await synthetic();
    const items = openQuestions(input);
    const heldRelation = items.find((q) => q.kind === 'held' && q.subject.type === 'relation');
    const heldPlacement = items.find((q) => q.kind === 'held' && q.subject.type === 'placement');
    const finding = items.find((q) => q.source === 'finding');
    const pool = items.find((q) => q.kind === 'black-box-partner');
    const step = items.find((q) => q.kind === 'step-without-process');
    if (!heldRelation || !heldPlacement || !finding || !pool || !step) {
      throw new Error('missing items');
    }
    const answers = [
      // S5a's rows: notes on relations and placements, also its outside rows there.
      stored(1, heldRelation),
      stored(2, heldPlacement, { kind: 'outside-landscape' }),
      // A note and S5a's „Wird im Modell ergänzt“: notes, the item stays open.
      stored(3, finding),
      stored(4, finding, { kind: 'will-be-modelled' }),
      // An outside mark with a note, and one without: answered.
      stored(5, pool, { kind: 'outside-landscape' }),
      stored(6, step, { kind: 'outside-landscape', text: null, answerText: null }),
      // A withdrawn mark no longer counts.
      stored(7, finding, { kind: 'outside-landscape', withdrawal: withdrawal(1100) }),
      // An answer to an item whose source changed since: it answers nothing now.
      stored(8, finding, { questionId: 'q-00000000000000ff', kind: 'outside-landscape' }),
    ];
    const answered = openQuestions({ ...input, answers });
    for (const q of answered) expect(OpenQuestion.parse(q)).toEqual(q);
    expect(answered.map((q) => q.id)).toEqual(items.map((q) => q.id));
    const byId = new Map(answered.map((q) => [q.id, q]));
    expect(byId.get(heldRelation.id)).toMatchObject({
      state: 'open',
      answers: [
        {
          id: answerId(1),
          questionId: heldRelation.id,
          kind: 'answer',
          role: 'note',
          target: 'relation-note',
          text: 'Antwort 1',
          note: {
            type: 'relation',
            subjectId: heldRelation.subject.id,
            assertionId: assertionId(901),
          },
          by: 'owner',
          sourceKind: 'human',
          seq: 1001,
          at: AT.toISOString(),
          withdrawal: null,
        },
      ],
    });
    expect(byId.get(heldPlacement.id)).toMatchObject({
      state: 'open',
      answers: [
        {
          kind: 'outside-landscape',
          role: 'note',
          target: 'placement-note',
          note: { type: 'placement', assertionId: placementAssertionId(902) },
        },
      ],
    });
    expect(byId.get(finding.id)).toMatchObject({
      state: 'open',
      answers: [
        { kind: 'answer', role: 'note', target: 'answer', note: null, text: 'Antwort 3' },
        { kind: 'will-be-modelled', role: 'note', text: 'Antwort 4' },
        {
          kind: 'outside-landscape',
          role: 'outside-mark',
          withdrawal: { by: 'owner', seq: 1100, at: AT.toISOString() },
        },
      ],
    });
    expect(byId.get(pool.id)).toMatchObject({
      state: 'answered',
      answers: [{ role: 'outside-mark', text: 'Antwort 5', withdrawal: null }],
    });
    expect(byId.get(step.id)).toMatchObject({
      state: 'answered',
      answers: [{ role: 'outside-mark', text: null }],
    });
    // Everything else as before; the state filter separates them.
    const touched = [heldRelation.id, heldPlacement.id, finding.id, pool.id, step.id];
    const others = answered.filter((q) => !touched.includes(q.id));
    expect(others).toEqual(items.filter((q) => !touched.includes(q.id)));
    expect(filterOpenQuestions(answered, { state: 'answered' }).map((q) => q.id)).toEqual(
      items.filter((q) => [pool.id, step.id].includes(q.id)).map((q) => q.id),
    );
    expect(filterOpenQuestions(answered, { state: 'open' })).toHaveLength(items.length - 2);
  });

  it('keeps a mark across a change elsewhere in the model, and opens the item at its subject', async () => {
    const input = await synthetic();
    const finding = openQuestions(input).find(
      (q) => q.source === 'finding' && q.subject.id === CALL,
    );
    if (!finding) throw new Error('no finding at the call');
    const answers = [stored(1, finding, { kind: 'outside-landscape' })];
    expect(openQuestions({ ...input, answers }).find((q) => q.id === finding.id)?.state).toBe(
      'answered',
    );
    // A new facts_hash alone (another element of the model changed): the same id.
    const models = new Map(input.models);
    const head = models.get('vertrieb/auftrag');
    if (!head) throw new Error('no head');
    models.set('vertrieb/auftrag', { ...head, factsHash: 'f'.repeat(64) });
    expect(
      openQuestions({ ...input, models, answers }).find((q) => q.id === finding.id)?.state,
    ).toBe('answered');
    // A changed fact at the subject (the call's fingerprint): a new id, open again.
    const projectFacts = {
      models: input.projectFacts.models.map((m) => ({
        ...m,
        facts: m.facts.map((f) => (f.ref === CALL ? { ...f, fingerprint: 'f'.repeat(12) } : f)),
      })),
    };
    const changed = openQuestions({ ...input, projectFacts, answers });
    expect(changed.some((q) => q.id === finding.id)).toBe(false);
    expect(
      changed.find(
        (q) => q.source === 'finding' && q.subject.id === CALL && q.kind === finding.kind,
      ),
    ).toMatchObject({ state: 'open', answers: [] });
  });

  it('shows notes and marks in the Markdown, the latest note in the five-column CSV', async () => {
    const input = await synthetic();
    const items = openQuestions(input);
    const finding = items.find((q) => q.source === 'finding');
    if (!finding) throw new Error('no finding');
    const answered = openQuestions({
      ...input,
      answers: [
        stored(1, finding, { answerText: 'Erst so.' }),
        stored(2, finding, { answerText: '=Dann so.' }),
        stored(3, finding, { kind: 'outside-landscape', answerText: 'Extern.' }),
        stored(4, finding, {
          kind: 'outside-landscape',
          text: null,
          answerText: null,
          withdrawal: withdrawal(1200),
        }),
      ],
    });
    const csv = renderOpenQuestionsCsv(answered);
    expect(csv.split('\r\n')[0]).toBe(`${CSV_BOM}"id";"Art";"Frage";"Ansprechpartner";"Antwort"`);
    // The latest note, protected against formulas like every cell; the mark is no note.
    expect(csv).toContain(`;"'=Dann so."\r\n`);
    expect(csv).not.toContain('Extern.');
    const sheet = readAnswerSheet(csv);
    expect(sheet.filter((r) => r.text !== '')).toEqual([
      { id: finding.id, text: '=Dann so.', kind: '', line: expect.any(Number) as unknown },
    ]);
    const checked = checkSheet(sheet, new Map(answered.map((q) => [q.id, q])));
    expect(checked.counts).toMatchObject({ recorded: 0, unchanged: 1, ignored: sheet.length - 1 });
    const md = renderOpenQuestionsMarkdown(answered, {
      projectName: 'P',
      asOf: AT,
      filter: { state: 'answered' },
    });
    // Dated, without event numbers (UX2a) and without handles (UX2b review: the customer's copy).
    expect(md).toContain('- Notiz (16.10.2026): Erst so.\n');
    expect(md).toContain('- Notiz (16.10.2026): \\=Dann so.\n');
    expect(md).toContain('- Liegt außerhalb der Landschaft (16.10.2026): Extern.\n');
    expect(md).toContain(
      '- Liegt außerhalb der Landschaft (16.10.2026, zurückgenommen am 16.10.2026)\n',
    );
    expect(md).not.toContain('owner');
    // The headline counts by state: the marked item is no open question.
    expect(md).toContain(
      `Stand 16.10.2026: ${answered.length - 1} offene Fragen und eine erledigte,`,
    );
    expect(md).not.toMatch(/Ereignis \d/);
    expect(md).toContain('Filter: Status „Außerhalb der Landschaft“.');
  });
});

describe('one item per gap: coded no-links join the rule tier’s items (UX2b review)', () => {
  it('keeps what was recorded under a merged no-link: its notes on the survivor, a live mark as its own item', async () => {
    const input = await synthetic();
    // The no-link items as they stood on their own (before the merge, or without the finding).
    const alone = openQuestions(
      { ...input, findings: input.findings.filter((f) => !f.refs.includes(CALL)) },
      { signals: SHIPPED_SIGNALS.filter((sig) => sig !== 'black-box-partner') },
    );
    const callNoLink = alone.find((q) => q.source === 'no-link' && q.subject.id === CALL);
    const partner = alone.find((q) => q.source === 'no-link' && q.kind === 'external-partner');
    if (!callNoLink || !partner) throw new Error('no coded no-links');
    const survivor = (items: readonly OpenQuestion[]) =>
      items.find((q) => q.source === 'finding' && q.subject.id === CALL);

    // A note recorded under the call's no-link shows on the finding, which stays open.
    const noted = openQuestions({
      ...input,
      answers: [stored(1, callNoLink, { answerText: 'Ruft die Bonitätsprüfung der Bank.' })],
    });
    expect(noted.some((q) => q.id === callNoLink.id)).toBe(false);
    expect(survivor(noted)).toMatchObject({ state: 'open' });
    expect(survivor(noted)?.answers.map((a) => [a.questionId, a.role, a.text])).toEqual([
      [callNoLink.id, 'note', 'Ruft die Bonitätsprüfung der Bank.'],
    ]);

    // A live outside mark keeps the no-link an item of its own (answered, not „Zu klären“).
    const marked = openQuestions({
      ...input,
      answers: [stored(2, partner, { kind: 'outside-landscape', answerText: 'Die Bank.' })],
    });
    expect(marked.find((q) => q.id === partner.id)).toMatchObject({ state: 'answered' });
    expect(marked.filter((q) => q.kind === 'black-box-partner' && q.state === 'open')).toHaveLength(
      1,
    );
    // Withdrawn, the mark no longer keeps it apart: it joins the pool's item, its history along.
    const withdrawn = openQuestions({
      ...input,
      answers: [
        stored(2, partner, {
          kind: 'outside-landscape',
          answerText: null,
          withdrawal: withdrawal(1200),
        }),
      ],
    });
    expect(withdrawn.some((q) => q.id === partner.id)).toBe(false);
    const pool = withdrawn.find((q) => q.kind === 'black-box-partner');
    expect(pool?.state).toBe('open');
    expect(pool?.answers.map((a) => [a.questionId, a.role, a.withdrawal !== null])).toEqual([
      [partner.id, 'outside-mark', true],
    ]);
  });

  it('labels a hold’s notes „Antwort“ in the export, without handles', async () => {
    const input = await synthetic();
    const held = openQuestions(input).find(
      (q) => q.kind === 'held' && q.subject.type === 'relation',
    );
    if (!held) throw new Error('no held relation');
    const answered = openQuestions({
      ...input,
      answers: [stored(3, held, { answerText: 'Ja, laut Einkauf immer.' })],
    });
    const md = renderOpenQuestionsMarkdown(
      answered.filter((q) => q.id === held.id),
      { projectName: 'P', asOf: AT, filter: { kind: 'held' } },
    );
    expect(md).toContain('- Antwort (16.10.2026): Ja, laut Einkauf immer.\n');
    expect(md).toContain('- Notiz zur Vormerkung: ');
    expect(md).not.toMatch(/owner|- Notiz \(/);
  });
});

describe('a filled-in sheet', () => {
  it('lists unknown, changed and invalid rows, ignores empty ones and keeps the rest', async () => {
    const input = await synthetic();
    const items = openQuestions(input);
    const [a, b, c, d, e] = items.filter((q) => !isInformationalKind(q.kind));
    if (!a || !b || !c || !d || !e) throw new Error('too few items');
    const answered = openQuestions({ ...input, answers: [stored(1, e)] });
    const current = new Map(answered.map((q) => [q.id, q]));
    const rows = [
      { id: a.id, text: '  Ja, über a@b.de.  ', kind: '' },
      { id: ` ${b.id} `, text: 'x'.repeat(2000), kind: 'Wird im Modell ergänzt' },
      { id: c.id, text: 'x'.repeat(2001), kind: '' },
      { id: d.id, text: 'Mit\u0007Glocke', kind: '' },
      { id: e.id, text: 'Antwort 1', kind: 'antwort' },
      { id: 'q-00000000000000ff', text: 'Geänderte Quelle.', kind: '' },
      { id: 'kein-id', text: 'Irgendwas.', kind: '' },
      { id: a.id, text: 'Zweimal.', kind: '' },
      { id: c.id, text: '   ', kind: 'Antwort' },
      { id: '', text: '', kind: '' },
      { id: d.id.replace('q-', 'q-'), text: 'Vielleicht', kind: 'Vielleicht' },
    ];
    const checked = checkSheet(rows, current);
    expect(checked.counts).toEqual({
      recorded: 2,
      unchanged: 1,
      unknown: 2,
      invalid: 4,
      ignored: 2,
    });
    expect(
      checked.rows.map((r) => [r.row, r.outcome, r.reason ?? r.kind ?? null, r.warnings.length]),
    ).toEqual([
      // Every filled Antwort is a note, also S5a's „Wird im Modell ergänzt“.
      [1, 'recorded', 'answer', 1],
      [2, 'recorded', 'answer', 0],
      [3, 'invalid', 'too-long', 0],
      [4, 'invalid', 'control-characters', 0],
      [5, 'unchanged', 'answer', 0],
      [6, 'unknown', null, 0],
      [7, 'unknown', null, 0],
      [8, 'invalid', 'duplicate-id', 0],
      [11, 'invalid', 'duplicate-id', 0],
    ]);
    // What gets recorded: trimmed texts on the current items, with where they land.
    expect(
      checked.record.map((r) => [r.draft.question.id, r.draft.kind, r.draft.text?.length]),
    ).toEqual([
      [a.id, 'answer', 'Ja, über a@b.de.'.length],
      [b.id, 'answer', 2000],
    ]);
    expect(checked.rows[0]?.target).toBe(
      a.subject.type === 'relation'
        ? 'relation-note'
        : a.subject.type === 'placement'
          ? 'placement-note'
          : 'answer',
    );
    expect(checked.rows[4]?.answer?.id).toBe(answerId(1));
    // An unknown kind on a first row of its id.
    expect(
      checkSheet([{ id: d.id, text: 'Vielleicht', kind: 'Vielleicht' }], current).rows,
    ).toMatchObject([{ outcome: 'invalid', reason: 'unknown-kind' }]);
  });

  it("reads an S5a sheet's Antwortart: outside marks where the item can carry one", async () => {
    const input = await synthetic();
    const items = openQuestions(input);
    const finding = items.find((q) => q.source === 'finding');
    const pool = items.find((q) => q.kind === 'black-box-partner');
    const heldRelation = items.find((q) => q.kind === 'held' && q.subject.type === 'relation');
    if (!finding || !pool || !heldRelation) throw new Error('missing items');
    const marked = openQuestions({
      ...input,
      answers: [stored(1, pool, { kind: 'outside-landscape', answerText: 'Bank.' })],
    });
    const current = new Map(marked.map((q) => [q.id, q]));
    const checked = checkSheet(
      [
        { id: finding.id, text: 'Ein Dienstleister.', kind: 'Liegt außerhalb der Landschaft' },
        // A live mark already: unchanged, whatever the text.
        { id: pool.id, text: 'Die Hausbank.', kind: 'outside-landscape' },
        // On a relation: a note.
        { id: heldRelation.id, text: 'Extern.', kind: 'liegt AUSSERHALB der landschaft' },
      ],
      current,
    );
    expect(checked.rows.map((r) => [r.outcome, r.kind, r.target])).toEqual([
      ['recorded', 'outside-landscape', 'answer'],
      ['unchanged', 'outside-landscape', 'answer'],
      ['invalid', undefined, undefined],
    ]);
    // „außerhalb“ spelled with ss does not name the kind; with ß it does.
    expect(
      checkSheet(
        [{ id: heldRelation.id, text: 'Extern.', kind: 'Liegt außerhalb der Landschaft' }],
        current,
      ).rows,
    ).toMatchObject([{ outcome: 'recorded', kind: 'answer', target: 'relation-note' }]);
    expect(checked.rows[1]?.answer?.id).toBe(answerId(1));
    expect(checked.record.map((r) => [r.draft.kind, r.draft.text])).toEqual([
      ['outside-landscape', 'Ein Dienstleister.'],
    ]);
  });

  it('compares a note with the latest note only: going back to an earlier one records it again', async () => {
    const input = await synthetic();
    const finding = openQuestions(input).find((q) => q.source === 'finding');
    if (!finding) throw new Error('no finding');
    // x, then y, then a mark: y is the latest note (the export shows it).
    const answered = openQuestions({
      ...input,
      answers: [
        stored(1, finding, { answerText: 'x' }),
        stored(2, finding, { answerText: 'y' }),
        stored(3, finding, { kind: 'outside-landscape', answerText: 'z' }),
      ],
    });
    const current = new Map(answered.map((q) => [q.id, q]));
    const item = current.get(finding.id);
    if (!item) throw new Error('no item');
    // Back to x: recorded, so x becomes the latest again.
    expect(sameAnswer({ question: item, kind: 'answer', text: 'x' })).toBeUndefined();
    expect(checkSheet([{ id: item.id, text: 'x', kind: 'Antwort' }], current).rows).toMatchObject([
      { outcome: 'recorded', kind: 'answer' },
    ]);
    // y again: unchanged, with the latest note; the mark's text is no note.
    expect(sameAnswer({ question: item, kind: 'answer', text: 'y' })?.id).toBe(answerId(2));
    expect(sameAnswer({ question: item, kind: 'answer', text: 'z' })).toBeUndefined();
    // A second mark: unchanged while the live one stands, whatever its text.
    expect(sameAnswer({ question: item, kind: 'outside-landscape', text: null })?.id).toBe(
      answerId(3),
    );
    expect(checkSheet([{ id: item.id, text: ' y ', kind: '' }], current).rows).toMatchObject([
      { outcome: 'unchanged', answer: { id: answerId(2), kind: 'answer' } },
    ]);
  });

  it('normalizes line breaks and Unicode before comparing, as the stored texts are', async () => {
    const input = await synthetic();
    const finding = openQuestions(input).find((q) => q.source === 'finding');
    if (!finding) throw new Error('no finding');
    const answered = openQuestions({
      ...input,
      answers: [stored(1, finding, { answerText: 'Zeile 1\nZeile 2: ergänzt' })],
    });
    const current = new Map(answered.map((q) => [q.id, q]));
    // CRLF from Windows tools, a lone CR, decomposed umlauts: the same answer.
    const checked = checkSheet(
      [{ id: finding.id, text: 'Zeile 1\r\nZeile 2: erga\u0308nzt\r\n', kind: 'Antwort' }],
      current,
    );
    expect(checked.rows).toMatchObject([{ outcome: 'unchanged' }]);
    const recorded = checkSheet(
      [{ id: finding.id, text: 'Neu\rmit Umbruch: Stra\u00DFe'.normalize('NFD'), kind: '' }],
      current,
    );
    expect(recorded.record.map((r) => r.draft.text)).toEqual(['Neu\nmit Umbruch: Straße']);
  });
});

describe('where an answer lands (the use case on a stand-in transaction)', () => {
  /** A transaction that knows one relation and one placement and records what is written. */
  function standIn(input: OpenQuestionInput) {
    const written: { table: string; row: Record<string, unknown> }[] = [];
    const events: { type: string; payload: Record<string, unknown> }[] = [];
    const answers: StoredOpenQuestionAnswer[] = [];
    let seq = 5000;
    const tx = {
      relations: {
        findInProject: (_p: string, id: string) =>
          Promise.resolve(input.relations.find((r) => r.id === id) ?? null),
      },
      placements: {
        findInProject: (_p: string, id: string) =>
          Promise.resolve(input.chain?.placements.find((x) => x.id === id) ?? null),
      },
      assertions: {
        insert: (row: Record<string, unknown>) => {
          written.push({ table: 'relation_assertion', row });
          return Promise.resolve();
        },
      },
      placementAssertions: {
        insert: (row: Record<string, unknown>) => {
          written.push({ table: 'placement_assertion', row });
          return Promise.resolve();
        },
      },
      events: {
        append: (_p: string, e: { type: string; payload: Record<string, unknown> }) => {
          events.push(e);
          return Promise.resolve(++seq);
        },
      },
      openQuestionAnswers: {
        insert: (row: OpenQuestionAnswerRecord) => {
          written.push({ table: 'open_question_answer', row: { ...row } });
          const note = written.find((w) => w.row['id'] === row.noteAssertionId)?.row;
          answers.push({
            ...row,
            answerText: row.text ?? (note ? String(note['rationale']) : null),
            handle: 'owner',
            createdAt: AT,
            withdrawal: null,
          });
          return Promise.resolve();
        },
        list: () => Promise.resolve(answers),
      },
    };
    return { tx: tx as unknown as Tx, written, events };
  }

  it('records a note on a relation or placement, a text otherwise, a mark with or without a note', async () => {
    const input = await synthetic();
    const items = openQuestions(input);
    const relation = items.find((q) => q.kind === 'held' && q.subject.type === 'relation');
    const placementItem = items.find((q) => q.subject.type === 'placement');
    const finding = items.find((q) => q.source === 'finding');
    const pool = items.find((q) => q.kind === 'black-box-partner');
    if (!relation || !placementItem || !finding || !pool) throw new Error('missing items');
    const { tx, written, events } = standIn(input);
    const recorded = await recordAnswers(tx, PROJECT, HUMAN_ACTOR, [
      { question: relation, kind: 'answer', text: 'Ja, als Nachricht.' },
      { question: placementItem, kind: 'answer', text: 'Kommt ins Modell.' },
      { question: finding, kind: 'outside-landscape', text: 'Extern.' },
      { question: pool, kind: 'outside-landscape', text: null },
    ]);
    expect(
      written.map((w) => [w.table, w.row['kind'], w.row['rationale'] ?? w.row['text']]),
    ).toEqual([
      ['relation_assertion', 'note', 'Ja, als Nachricht.'],
      ['open_question_answer', 'answer', null],
      ['placement_assertion', 'note', 'Kommt ins Modell.'],
      ['open_question_answer', 'answer', null],
      ['open_question_answer', 'outside-landscape', 'Extern.'],
      ['open_question_answer', 'outside-landscape', null],
    ]);
    expect(written[0]?.row).toMatchObject({ sourceKind: 'human', relationId: relation.subject.id });
    expect(written[1]?.row).toMatchObject({
      questionId: relation.id,
      subjectType: 'relation',
      noteAssertionId: written[0]?.row['id'],
      sourceKind: 'human',
    });
    expect(written[3]?.row['noteAssertionId']).toBe(written[2]?.row['id']);
    expect(written[4]?.row['noteAssertionId']).toBeNull();
    expect(written[5]?.row).toMatchObject({ text: null, noteAssertionId: null });
    expect(events.map((e) => e.type)).toEqual([
      'relation.noted',
      'open_question.answered',
      'placement.noted',
      'open_question.answered',
      'open_question.answered',
      'open_question.answered',
    ]);
    // No free text in the answer events.
    expect(events[4]?.payload).toEqual({
      questionId: finding.id,
      kind: 'outside-landscape',
      subject: finding.subject,
      target: 'answer',
    });
    expect(recorded.map((a) => [a.role, a.target, a.text, a.seq])).toEqual([
      ['note', 'relation-note', 'Ja, als Nachricht.', 5002],
      ['note', 'placement-note', 'Kommt ins Modell.', 5004],
      ['outside-mark', 'answer', 'Extern.', 5005],
      ['outside-mark', 'answer', null, 5006],
    ]);
    // Never a mark on a relation or placement (they are decided instead).
    await expect(
      recordAnswers(tx, PROJECT, HUMAN_ACTOR, [
        { question: relation, kind: 'outside-landscape', text: null },
      ]),
    ).rejects.toThrow(/outside mark on a relation or placement/);
  });

  it('lets only humans answer', async () => {
    const input = await synthetic();
    const finding = openQuestions(input).find((q) => q.source === 'finding');
    if (!finding) throw new Error('no finding');
    const { tx, written } = standIn(input);
    await expect(
      recordAnswers(tx, PROJECT, { ...HUMAN_ACTOR, kind: 'service', interactive: false }, [
        { question: finding, kind: 'answer', text: 'Agent.' },
      ]),
    ).rejects.toBeInstanceOf(DomainError);
    expect(written).toEqual([]);
  });
});

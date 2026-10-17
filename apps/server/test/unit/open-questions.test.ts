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
import path from 'node:path';

import {
  OPEN_QUESTION_CSV_COLUMNS,
  OPEN_QUESTION_KIND_LABELS,
  OpenQuestion,
  isInformationalKind,
  readAnswerSheet,
  type OpenQuestionAnswerId,
  type PlacementAssertionId,
  type PlacementId,
  type PrincipalId,
  type ProjectId,
  type Ref,
  type ValueChainId,
} from '@analyzr/contracts';
import { landscapeVariants } from '@analyzr/eval-tools/descriptive';
import { describe, expect, it } from 'vitest';

import { decodeCursor } from '../../src/domain/cursor.ts';
import {
  CSV_BOM,
  escapeMarkdown,
  exportFilename,
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
  POSITION_SHAPE,
  rankGroup,
  type ChainInput,
  type OpenQuestionInput,
} from '../../src/domain/open-questions/model.ts';
import {
  filterOpenQuestions,
  kindCounts,
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
  PlacementRecord,
  RelationRecord,
  StoredNoLink,
  StoredOpenQuestionAnswer,
  StoredPlacementAssertion,
  Tx,
} from '../../src/domain/ports.ts';
import { pairKey } from '../../src/domain/judgements.ts';
import { recomputeStatus } from '../../src/domain/status.ts';
import { prepareRevision } from '../../src/domain/value-chain/document.ts';
import { valueChainFindings } from '../../src/domain/value-chain/findings.ts';
import { OUTSIDE } from '../../src/domain/value-chain/steps.ts';
import { CORPUS_DIR, corpusFiles } from '../support/corpus.ts';
import {
  AT,
  PROJECT,
  assertion,
  assertionId,
  libraryInput,
  relationId,
} from '../support/open-questions.ts';
import { chain } from '../support/value-chain.ts';

const ID = /^q-[0-9a-f]{16}$/;
const HUMAN = `prn_${'0'.repeat(21)}HUMAN` as PrincipalId;
const AGENT = `prn_${'0'.repeat(21)}AGENT` as PrincipalId;
const AGENT_2 = `prn_${'0'.repeat(19)}AGENTTWO` as PrincipalId;

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
    expect(call?.text).toBe(
      'Welchen Prozess ruft „Run fraud check“ in „Order handling“ auf? calledElement ' +
        '„Process_FraudCheck“ passt zu keiner Prozess-ID im Projekt.',
    );
    const duplicate = items.find((q) => q.kind === 'duplicate-process-id');
    expect(duplicate?.modelKeys).toEqual([
      'einkauf/archiv/bestellfreigabe-2019',
      'einkauf/bestellfreigabe',
    ]);
    const pool = items.find((q) => q.subject.id === 'logistik/shipping#Participant_Carrier');
    expect(pool?.subjectLabel).toBe('„Participant_Carrier“');
    expect(pool?.text).toBe(
      'Ist „Participant_Carrier“ in logistik/shipping ein externer Partner, oder fehlt das ' +
        'Modell seines Prozesses? „Participant_Carrier“ gehört zu keinem Prozess des Modells, ' +
        'ist also vermutlich ein Pool ohne Prozess. Nachrichtenflüsse: „Pickup scan“ an „Await ' +
        'pickup scan“; „Proof of delivery“ an „Await proof of delivery“; „Shipping order“ von ' +
        '„Transmit shipping order to carrier“.',
    );
  });

  it('gives new ids exactly to the items of a model whose facts changed', async () => {
    const input = await libraryInput(await corpusFiles('nordwind-handel'));
    const before = openQuestions(input);
    const models = new Map(input.models);
    const head = models.get('vertrieb/order-handling');
    if (!head) throw new Error('model missing');
    models.set('vertrieb/order-handling', { ...head, factsHash: 'f'.repeat(64) });
    const after = openQuestions({ ...input, models });
    expect(after.map((q) => q.subject)).toEqual(before.map((q) => q.subject));
    for (const [i, q] of after.entries()) {
      const was = before[i];
      if (q.modelKeys.includes('vertrieb/order-handling')) expect(q.id).not.toBe(was?.id);
      else expect(q.id).toBe(was?.id);
    }
    // Its unresolved call, its unmatched catch and its black-box pool.
    expect(
      after.filter((q) => q.modelKeys.includes('vertrieb/order-handling')).map((q) => q.kind),
    ).toEqual(
      expect.arrayContaining([
        'call-target-unknown',
        'message-partner-missing',
        'black-box-partner',
      ]),
    );
    expect(after.filter((q) => q.modelKeys.includes('vertrieb/order-handling'))).toHaveLength(3);
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

const DEFS =
  'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs" targetNamespace="http://example.org/bpmn"';
const C7 = 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"';

const AUFTRAG = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${DEFS} ${C7}>
  <bpmn:message id="Msg_RA" name="RechnungAngefordert"/>
  <bpmn:message id="Msg_Storno" name="AuftragStorniert"/>
  <bpmn:process id="P_Auftrag" name="Auftragsabwicklung" isExecutable="true">
    <bpmn:documentation>Nimmt Aufträge an und lässt sie berechnen.</bpmn:documentation>
    <bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_Innendienst" name="Vertriebsinnendienst">
        <bpmn:flowNodeRef>Task_Rechnung</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Call_Pruefung</bpmn:flowNodeRef>
      </bpmn:lane>
      <bpmn:lane id="Lane_Leitung" name="Vertriebsleitung">
        <bpmn:flowNodeRef>Event_Storno</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="Start_Auftrag" name="Auftrag eingegangen"/>
    <bpmn:sendTask id="Task_Rechnung" name="Rechnung anfordern" messageRef="Msg_RA"/>
    <bpmn:callActivity id="Call_Pruefung" name="Bonität prüfen" calledElement="P_Bonitaet"/>
    <bpmn:intermediateThrowEvent id="Event_Storno" name="Auftrag storniert">
      <bpmn:messageEventDefinition id="MED_Storno" messageRef="Msg_Storno"/>
    </bpmn:intermediateThrowEvent>
    <bpmn:endEvent id="End_Auftrag" name="Auftrag erledigt"/>
  </bpmn:process>
</bpmn:definitions>`;

const RECHNUNG = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${DEFS} ${C7}>
  <bpmn:message id="Msg_RA" name="RechnungAngefordert"/>
  <bpmn:process id="P_Rechnung" name="Rechnungsstellung" isExecutable="true">
    <bpmn:documentation>Stellt Rechnungen aus.</bpmn:documentation>
    <bpmn:startEvent id="Start_Rechnung" name="Rechnung angefordert">
      <bpmn:messageEventDefinition id="MED_RA" messageRef="Msg_RA"/>
    </bpmn:startEvent>
    <bpmn:endEvent id="End_Rechnung"/>
  </bpmn:process>
</bpmn:definitions>`;

const NOTIZ = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${DEFS}>
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="Participant_Notiz" name="Ablage" processRef="Notizablage"/>
    <bpmn:participant id="Participant_Bank" name="Bank"/>
    <bpmn:messageFlow id="Flow_Bank" name="Überweisung" sourceRef="Task_Notiz" targetRef="Participant_Bank"/>
  </bpmn:collaboration>
  <bpmn:process id="Notizablage" name="Notizen" isExecutable="false">
    <bpmn:task id="Task_Notiz" name="Notiz schreiben"/>
  </bpmn:process>
</bpmn:definitions>`;

const A = 'vertrieb/auftrag#P_Auftrag' as Ref;
const R = 'finanzen/rechnung#P_Rechnung' as Ref;
const N = 'archiv/notiz#Notizablage' as Ref;
const TASK_RECHNUNG = 'vertrieb/auftrag#Task_Rechnung' as Ref;
const START_RECHNUNG = 'finanzen/rechnung#Start_Rechnung' as Ref;
const CALL = 'vertrieb/auftrag#Call_Pruefung' as Ref;
const STORNO = 'vertrieb/auftrag#Event_Storno' as Ref;
const TASK_NOTIZ = 'archiv/notiz#Task_Notiz' as Ref;

const placementId = (n: number): PlacementId => `plc_${String(n).padStart(26, '0')}`;
const placementAssertionId = (n: number): PlacementAssertionId =>
  `pas_${String(n).padStart(26, '0')}`;
const CHAIN_ID: ValueChainId = `vch_${'0'.repeat(26)}`;

function placement(
  n: number,
  elementId: string,
  processRef: Ref,
  status: PlacementRecord['status'],
): PlacementRecord {
  return {
    id: placementId(n),
    projectId: PROJECT,
    valueChainId: CHAIN_ID,
    elementId,
    generation: 1,
    processRef,
    status,
    endpointState: 'ok',
    tier: 'lexical',
    confidence: 0.7,
    version: 1,
    stepFp: null,
    processFp: null,
    createdAt: AT,
    updatedAt: AT,
  };
}

function placementAssertion(
  n: number,
  placement: PlacementId,
  over: Partial<StoredPlacementAssertion>,
): StoredPlacementAssertion {
  return {
    id: placementAssertionId(n),
    projectId: PROJECT,
    placementId: placement,
    seq: 100 + n,
    kind: 'proposal',
    verdict: null,
    sourceKind: 'agent',
    principalId: AGENT,
    clientId: null,
    declared: null,
    submissionId: null,
    tier: 'lexical',
    confidence: 0.7,
    rationale: null,
    evidence: null,
    question: null,
    label: null,
    linkedPlacementId: null,
    stepFp: null,
    processFp: null,
    stepHash: null,
    processHash: null,
    handle: 'agent:sim',
    createdAt: AT,
    ...over,
  };
}

function noLink(n: number, from: Ref, to: Ref, reason: string): StoredNoLink {
  return {
    id: `nlk_${String(n).padStart(26, '0')}`,
    projectId: PROJECT,
    type: 'message',
    fromRef: from,
    toRef: to,
    fromModel: from.split('#')[0] ?? '',
    toModel: to.split('#')[0] ?? '',
    fromHash: 'a',
    toHash: 'b',
    reason,
    sourceKind: 'agent',
    principalId: AGENT,
    clientId: null,
    declared: { procedure: { id: 'analyzr-relations', version: '0.2.0' }, llmModel: null },
    submissionId: `sbm_${'0'.repeat(26)}`,
    modelId: `mdl_${'0'.repeat(26)}`,
    seq: 200 + n,
    handle: 'agent:claude',
    origin: from.split('#')[0] ?? '',
    current: true,
    createdAt: AT,
  };
}

const STRUCTURE = prepareRevision(
  chain({
    name: 'Kette',
    steps: [
      { id: 'step-vertrieb', name: 'Vertrieb' },
      { id: 'step-eingang', name: 'Auftragseingang', parent: 'step-vertrieb' },
      { id: 'step-finanzen', name: 'Finanzen' },
      { id: 'step-ablage', name: 'Ablage', link: 'analyzr:process/x/fehlt#P' },
    ],
    orgUnits: [
      { id: 'org-vertrieb', name: 'Vertrieb & Service', owns: ['step-vertrieb'] },
      { id: 'org-fibu', name: 'Finanzbuchhaltung', owns: ['step-finanzen'] },
    ],
  }),
).structure;

/** The synthetic landscape, held, asked, no-linked, placed and summarized. */
async function synthetic(): Promise<OpenQuestionInput> {
  const base = await libraryInput([
    { key: 'vertrieb/auftrag', bytes: AUFTRAG },
    { key: 'finanzen/rechnung', bytes: RECHNUNG },
    { key: 'archiv/notiz', bytes: NOTIZ },
  ]);
  // The key-tier message pair, held by a human (note, question, label).
  const relations = base.relations.map((r): RelationRecord =>
    r.fromRef === TASK_RECHNUNG && r.toRef === START_RECHNUNG ? { ...r, status: 'held' } : r,
  );
  const held = relations.find((r) => r.status === 'held');
  if (!held) throw new Error('the key pair is missing');
  // An agent's lexical call proposal with a question, and another agent's without one.
  const asked: RelationRecord = {
    ...held,
    id: relationId(90),
    type: 'call',
    fromRef: CALL,
    toRef: R,
    status: 'proposed',
    tier: 'lexical',
  };
  const histories = new Map(base.histories);
  histories.set(held.id, [
    ...(histories.get(held.id) ?? []),
    assertion({
      id: assertionId(50),
      relationId: held.id,
      seq: 50,
      kind: 'decision',
      verdict: 'hold',
      sourceKind: 'human',
      principalId: HUMAN,
      handle: 'owner',
      rationale: 'Mit Finanzen klären, ob die Anforderung als Nachricht kommt.',
      question: '=Kommt die Anforderung immer als Nachricht?',
      label: 'mit Fachbereich Finanzen klären',
    }),
  ]);
  histories.set(asked.id, [
    assertion({
      id: assertionId(60),
      relationId: asked.id,
      seq: 60,
      sourceKind: 'agent',
      principalId: AGENT,
      handle: 'agent:claude',
      tier: 'lexical',
      confidence: 0.5,
      question: 'Prüft „Rechnungsstellung“ (finanzen/rechnung) die Bonität für „Bonität prüfen“?',
    }),
    assertion({
      id: assertionId(61),
      relationId: asked.id,
      seq: 61,
      sourceKind: 'agent',
      principalId: AGENT_2,
      handle: 'agent:codex',
      tier: 'lexical',
      confidence: 0.6,
    }),
  ]);
  const placements = [
    placement(1, 'step-eingang', A, 'accepted'),
    placement(2, 'step-finanzen', R, 'held'),
    placement(3, 'step-ablage', N, 'proposed'),
  ];
  const chainInput: ChainInput = {
    key: 'main',
    headSeq: 40,
    structure: STRUCTURE,
    live: new Map([...STRUCTURE.steps.map((s) => [s.elementId, 1] as const), [OUTSIDE, 1]]),
    placements,
    histories: new Map([
      [
        placements[1]?.id ?? '',
        [
          placementAssertion(1, placementId(2), {}),
          placementAssertion(2, placementId(2), {
            kind: 'decision',
            verdict: 'hold',
            sourceKind: 'human',
            principalId: HUMAN,
            handle: 'owner',
            rationale: 'Gehört die Rechnungsstellung zu Finanzen oder zum Vertrieb?',
          }),
        ],
      ],
      [
        placements[2]?.id ?? '',
        [placementAssertion(3, placementId(3), { question: 'Ist „Notizen“ wirklich Ablage?' })],
      ],
    ]),
    findings: valueChainFindings({
      structure: STRUCTURE,
      live: new Map([...STRUCTURE.steps.map((s) => [s.elementId, 1] as const), [OUTSIDE, 1]]),
      processes: [A, R, N],
      placements,
      calls: [],
    }),
    open: [N, R],
    unsure: [
      {
        process: R,
        reason: 'Kein Schritt passt eindeutig.',
        inputHash: 'h-rechnung',
        handle: 'agent:sim',
        seq: 70,
      },
    ],
  };
  const unjudged = { type: 'message' as const, from: STORNO, to: START_RECHNUNG };
  const judgedCall = { type: 'call' as const, from: CALL, to: R };
  return {
    ...base,
    relations: [...relations, asked],
    histories,
    judged: new Set([pairKey(judgedCall)]),
    noLinks: [
      noLink(1, CALL, N, 'call-target: „Notizen“ prüft keine Bonität.'),
      noLink(2, CALL, R, 'call-target: „Rechnungsstellung“ ist kein Prüfprozess.'),
      noLink(3, STORNO, TASK_NOTIZ, 'collaboration: Die Stornierung geht an die Bank.'),
      noLink(4, STORNO, START_RECHNUNG, 'no-evidence: Nichts verbindet die beiden.'),
    ],
    chain: chainInput,
    submissions: [
      {
        kind: 'relations',
        subject: 'vertrieb/auftrag',
        submissionId: `sbm_${'1'.repeat(26)}`,
        handle: 'agent:claude',
        seq: 80,
        summary: 'Die Bonitätsprüfung fehlt als Modell.',
        uncovered: { count: 4, pairs: [unjudged, judgedCall] },
      },
      {
        kind: 'placement',
        subject: 'main',
        submissionId: `sbm_${'2'.repeat(26)}`,
        handle: 'agent:sim',
        seq: 90,
        summary: 'Ablage passt nur bedingt.',
        uncovered: null,
      },
    ],
  };
}

describe('every source of §4.1 on a synthetic landscape', () => {
  it('maps each source with its kind, subject, text and raiser', async () => {
    const items = openQuestions(await synthetic());
    for (const q of items) expect(OpenQuestion.parse(q)).toEqual(q);
    expect(kindCounts(items)).toEqual({
      'call-target-unknown': 2,
      'message-partner-missing': 1,
      held: 2,
      'agent-question': 2,
      'placement-unsure': 1,
      'process-without-step': 2,
      'step-without-process': 2,
      'unresolved-link': 1,
      'external-partner': 1,
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
      text: 'Welchen Prozess ruft „Bonität prüfen“ in „Auftragsabwicklung“ auf? calledElement „P_Bonitaet“ passt zu keiner Prozess-ID im Projekt.',
      askWho: {
        lanes: ['Vertriebsinnendienst'],
        stepOwners: ['Vertrieb & Service'],
        folder: 'vertrieb',
      },
    });
    expect(one('message-partner-missing', 'finding').text).toBe(
      'Wer empfängt, was „Auftrag storniert“ in „Auftragsabwicklung“ sendet? Nachricht ' +
        '„AuftragStorniert“ wird geworfen, aber von keinem anderen Prozess gefangen und ' +
        'erreicht per Nachrichtenfluss keinen Teilnehmer.',
    );

    const heldRelation = items.find((q) => q.kind === 'held' && q.subject.type === 'relation');
    expect(heldRelation).toMatchObject({
      source: 'hold',
      subjectLabel: '„Rechnung anfordern“ → „Rechnung angefordert“',
      text: '=Kommt die Anforderung immer als Nachricht?',
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
      text: 'Prüft „Rechnungsstellung“ (finanzen/rechnung) die Bonität für „Bonität prüfen“?',
      raisedBy: { sourceKind: 'agent', handle: 'agent:claude', seq: 60 },
    });
    expect(
      items.find((q) => q.kind === 'agent-question' && q.subject.type === 'placement'),
    ).toMatchObject({
      text: 'Ist „Notizen“ wirklich Ablage?',
      subjectLabel: '„Notizen“ auf „Ablage“',
    });

    expect(one('placement-unsure', 'unsure')).toMatchObject({
      subject: { type: 'process', id: R },
      text: 'Kein Schritt passt eindeutig.',
      raisedBy: { sourceKind: 'agent', handle: 'agent:sim', seq: 70 },
    });

    expect(one('process-without-step', 'value-chain-finding', N).text).toMatch(
      /^Zu welchem Schritt der Wertschöpfungskette gehört „Notizen“\? Keine angenommene Platzierung/,
    );
    expect(one('step-without-process', 'value-chain-finding', 'step-finanzen')).toMatchObject({
      subjectLabel: '„Finanzen“',
      modelKeys: [],
      askWho: { lanes: [], stepOwners: ['Finanzbuchhaltung'], folder: null },
      // The held placement on it.
      unlocks: 1,
    });
    expect(one('unresolved-link', 'value-chain-finding').text).toBe(
      'Auf welchen Prozess soll der Link von „Ablage“ zeigen? Der verlinkte Prozess x/fehlt#P ist in keiner aktuellen Revision enthalten.',
    );

    // Coded no-links: call-target grouped per call, collaboration at the end with a
    // message flow in its own file, no-evidence left out.
    const target = one('call-target-unknown', 'no-link');
    expect(target).toMatchObject({
      subject: { type: 'ref', id: CALL },
      text: 'call-target: „Notizen“ prüft keine Bonität.\ncall-target: „Rechnungsstellung“ ist kein Prüfprozess.',
      refs: [N, R, CALL],
      raisedBy: { sourceKind: 'agent', handle: 'agent:claude', seq: 202 },
    });
    expect(one('external-partner', 'no-link')).toMatchObject({
      subject: { type: 'ref', id: TASK_NOTIZ },
      text: 'collaboration: Die Stornierung geht an die Bank.',
    });

    expect(one('summary-note', 'summary', 'vertrieb/auftrag')).toMatchObject({
      subject: { type: 'model', id: 'vertrieb/auftrag' },
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
      text:
        'Gehören diese Paare zusammen? Die Analyse von „Auftragsabwicklung“ (vertrieb/auftrag) ' +
        'hat ein zugewiesenes Paar ohne Urteil gelassen, und noch kein Agent hat es bewertet: ' +
        '„Auftrag storniert“ in „Auftragsabwicklung“ → „Rechnung angefordert“ in ' +
        '„Rechnungsstellung“. 2 weitere hat die Analyse nicht aufgeführt.',
      refs: [START_RECHNUNG, STORNO],
    });

    // The signals.
    expect(one('black-box-partner', 'signal').text).toBe(
      'Ist „Participant_Bank“ in archiv/notiz ein externer Partner, oder fehlt das Modell ' +
        'seines Prozesses? „Participant_Bank“ gehört zu keinem Prozess des Modells, ist also ' +
        'vermutlich ein Pool ohne Prozess. Nachrichtenflüsse: „Überweisung“ von „Notiz schreiben“.',
    );
    expect(one('unlabelled-boundary', 'signal')).toMatchObject({
      subject: { type: 'process', id: R },
      text: 'Womit endet „Rechnungsstellung“? Ein Start- oder Endereignis hat keinen Namen; Auslöser-Beziehungen zu anderen Prozessen brauchen benannte Ereignisse.',
      refs: ['finanzen/rechnung#End_Rechnung', R],
    });
    expect(one('undocumented-process', 'signal').subject).toEqual({ type: 'process', id: N });
    expect(one('isolated-process', 'signal').subject).toEqual({ type: 'process', id: N });
    expect(one('descriptive-model', 'signal')).toMatchObject({
      subject: { type: 'model', id: 'archiv/notiz' },
      unlocks: 1,
    });
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
    const items = openQuestions(await synthetic());
    const md = renderOpenQuestionsMarkdown(items, {
      projectName: 'Test *Projekt*',
      projectKey: 'test',
      seq: 99,
      filter: { kind: 'held' },
    });
    expect(md.startsWith('# Offene Fragen: Test \\*Projekt\\*\n')).toBe(true);
    expect(md).toContain('Projekt `test`, Stand Ereignis 99:');
    expect(md).toContain('Filter: Art „Vorgemerkt“.');
    for (const q of items) expect(md).toContain(`- Kennung: \`${q.id}\``);
    const groups = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(groups).toEqual([
      ...new Set([...groups].filter((g) => g !== 'Ohne Ansprechpartner-Hinweis')),
      ...(groups.includes('Ohne Ansprechpartner-Hinweis') ? ['Ohne Ansprechpartner-Hinweis'] : []),
    ]);
    expect(groups).toContain('Organisationseinheit Finanzbuchhaltung');
    expect(groups).toContain('Ordner archiv');
    // The hold's verbatim question starts with "=": escaped at the start of the line.
    expect(md).toContain('\n\\=Kommt die Anforderung immer als Nachricht?\n');
    expect(md).toContain('- Vormerkung: mit Fachbereich Finanzen klären');
    expect(md).toContain('- Notiz: Mit Finanzen klären, ob die Anforderung als Nachricht kommt.');
    expect(escapeMarkdown('<img src=x> *a* [l](u) # b\n- c\n1. d\n> e')).toBe(
      '\\<img src=x> \\*a\\* \\[l\\](u) # b  \n\\- c  \n1\\. d  \n\\> e',
    );
    // `_` only where it can delimit emphasis, `&` only before an entity.
    expect(escapeMarkdown('Participant_Bank _x_ a\\_b R&D &amp; &#35;')).toBe(
      'Participant_Bank \\_x\\_ a\\\\\\_b R&D \\&amp; \\&#35;',
    );
    expect(
      renderOpenQuestionsMarkdown([], { projectName: 'P', projectKey: 'p', seq: 1, filter: {} }),
    ).toContain('Keine offenen Fragen.');
  });

  it('writes a CSV spreadsheets open safely, and reads it back', async () => {
    const items = openQuestions(await synthetic());
    const csv = renderOpenQuestionsCsv(items);
    expect(
      csv.startsWith(
        `${CSV_BOM}"id";"Art";"Frage";"Ansprechpartner-Hinweis";"Antwort";"Antwortart"\r\n`,
      ),
    ).toBe(true);
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
      expect(row).toHaveLength(6);
      expect(row[1]).toBe(OPEN_QUESTION_KIND_LABELS[q.kind]);
      expect(row[2]?.startsWith(q.text)).toBe(true);
      expect(row.slice(4)).toEqual(['', '']);
    }
    const held = rows.find((r) => r[2]?.startsWith('=Kommt'));
    expect(held?.[2]).toBe(
      '=Kommt die Anforderung immer als Nachricht?\n\nBetrifft: „Rechnung anfordern“ → „Rechnung angefordert“',
    );
    // Task_Rechnung's process is accepted on a step of „Vertrieb & Service“.
    expect(held?.[3]).toBe(
      'Organisationseinheit: Vertrieb & Service; Lanes: Vertriebsinnendienst; Ordner: vertrieb',
    );

    // As a spreadsheet saves it again: no BOM, commas, LF, bare fields, answers filled in.
    const resaved = [
      'id,Art,Frage,Ansprechpartner-Hinweis,Antwort,Antwortart',
      `${items[0]?.id ?? ''},Art,"Frage, mit Komma",,"Ja, über ""Bonität""",Antwort`,
      ',,,,,',
      '',
    ].join('\n');
    expect(parseOpenQuestionsCsv(resaved).rows).toEqual([
      [items[0]?.id, 'Art', 'Frage, mit Komma', '', 'Ja, über "Bonität"', 'Antwort'],
    ]);
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
    expect(catchQuestion?.text).toMatch(/^Wer sendet, was „Karton bestellt“ in „Lager“ empfängt\?/);
  });

  it('asks signal findings about signals', async () => {
    const items = openQuestions(await libraryInput([{ key: 'lager/kommission', bytes: LAGER }]));
    const alarm = items.find((q) => q.subject.id === 'lager/kommission#Evt_Alarm');
    expect(alarm?.kind).toBe('message-partner-missing');
    expect(alarm?.text).toBe(
      'Wer fängt das Signal, das „Alarm geben“ in „Lager“ wirft? Signal „Lageralarm“ wird ' +
        'geworfen, aber von keinem anderen Prozess gefangen und erreicht per Nachrichtenfluss ' +
        'keinen Teilnehmer.',
    );
    expect(OPEN_QUESTION_KIND_LABELS['message-partner-missing']).toBe(
      'Nachrichten- oder Signalpartner fehlt',
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
    const md = renderOpenQuestionsMarkdown(items, {
      projectName: 'P',
      projectKey: 'p',
      seq: 1,
      filter: {},
    });
    expect(md).toContain('\n## Organisationseinheiten Finanzbuchhaltung, Vertrieb & Service\n');
    expect(renderOpenQuestionsCsv(items)).toContain(
      '"Organisationseinheiten: Finanzbuchhaltung, Vertrieb & Service; Lanes: Vertriebsinnendienst; Ordner: vertrieb"',
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
    ).toBe(
      'offene-fragen-p-finanzen-mahnwesen-black-box-partner-signal-vertrieb-service-offen.csv',
    );
    expect(exportFilename('p', { askWho: 'Größe Überweisung – Café' }, 'markdown')).toBe(
      'offene-fragen-p-groesse-ueberweisung-cafe.md',
    );
    const long = exportFilename('p', { askWho: 'x'.repeat(200) }, 'csv');
    expect(long).toBe(`offene-fragen-p-${'x'.repeat(80)}.csv`);
    expect(exportFilename('p', { askWho: '„“' }, 'csv')).toBe('offene-fragen-p.csv');
  });
});

// --------------------------------------------------------------- answers (S5a)

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
    ...over,
  };
}

describe('answers on the items', () => {
  it('turns an item answered while an answer names its id, with the answers', async () => {
    const input = await synthetic();
    const items = openQuestions(input);
    const heldRelation = items.find((q) => q.kind === 'held' && q.subject.type === 'relation');
    const heldPlacement = items.find((q) => q.kind === 'held' && q.subject.type === 'placement');
    const finding = items.find((q) => q.source === 'finding');
    if (!heldRelation || !heldPlacement || !finding) throw new Error('missing items');
    const answers = [
      stored(1, heldRelation),
      stored(2, heldPlacement),
      stored(3, finding, { kind: 'outside-landscape' }),
      stored(4, finding, { kind: 'will-be-modelled' }),
      // An answer to an item whose source changed since: it answers nothing now.
      stored(5, finding, { questionId: 'q-00000000000000ff' }),
    ];
    const answered = openQuestions({ ...input, answers });
    for (const q of answered) expect(OpenQuestion.parse(q)).toEqual(q);
    expect(answered.map((q) => q.id)).toEqual(items.map((q) => q.id));
    const byId = new Map(answered.map((q) => [q.id, q]));
    expect(byId.get(heldRelation.id)).toMatchObject({
      state: 'answered',
      answers: [
        {
          id: answerId(1),
          questionId: heldRelation.id,
          kind: 'answer',
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
        },
      ],
    });
    expect(byId.get(heldPlacement.id)?.answers).toMatchObject([
      {
        target: 'placement-note',
        note: { type: 'placement', assertionId: placementAssertionId(902) },
      },
    ]);
    expect(byId.get(finding.id)?.answers).toMatchObject([
      { kind: 'outside-landscape', target: 'answer', note: null, text: 'Antwort 3' },
      { kind: 'will-be-modelled', text: 'Antwort 4' },
    ]);
    // Everything else as before; the state filter separates them.
    const others = answered.filter(
      (q) => ![heldRelation.id, heldPlacement.id, finding.id].includes(q.id),
    );
    expect(others).toEqual(
      items.filter((q) => ![heldRelation.id, heldPlacement.id, finding.id].includes(q.id)),
    );
    expect(others.every((q) => q.state === 'open' && q.answers.length === 0)).toBe(true);
    expect(filterOpenQuestions(answered, { state: 'answered' }).map((q) => q.id)).toEqual(
      items
        .filter((q) => [heldRelation.id, heldPlacement.id, finding.id].includes(q.id))
        .map((q) => q.id),
    );
    expect(filterOpenQuestions(answered, { state: 'open' })).toEqual(others);
  });

  it("opens a subject answer's item again when its source changes", async () => {
    const input = await synthetic();
    const finding = openQuestions(input).find(
      (q) => q.source === 'finding' && q.modelKeys.includes('vertrieb/auftrag'),
    );
    if (!finding) throw new Error('no finding in vertrieb/auftrag');
    const answers = [stored(1, finding)];
    expect(openQuestions({ ...input, answers }).find((q) => q.id === finding.id)?.state).toBe(
      'answered',
    );
    const models = new Map(input.models);
    const head = models.get('vertrieb/auftrag');
    if (!head) throw new Error('no head');
    models.set('vertrieb/auftrag', { ...head, factsHash: 'f'.repeat(64) });
    const changed = openQuestions({ ...input, models, answers });
    expect(changed.some((q) => q.id === finding.id)).toBe(false);
    const again = changed.find(
      (q) =>
        q.source === 'finding' && q.subject.id === finding.subject.id && q.kind === finding.kind,
    );
    expect(again).toMatchObject({ state: 'open', answers: [] });
  });

  it('shows the answers in both exports; the sheet read back changes nothing', async () => {
    const input = await synthetic();
    const items = openQuestions(input);
    const finding = items.find((q) => q.source === 'finding');
    if (!finding) throw new Error('no finding');
    const answered = openQuestions({
      ...input,
      answers: [
        stored(1, finding, { answerText: 'Erst so.' }),
        stored(2, finding, { kind: 'outside-landscape', answerText: '=Dann so.' }),
      ],
    });
    const csv = renderOpenQuestionsCsv(answered);
    // The latest answer and its kind, protected against formulas like every cell.
    expect(csv).toContain(`"'=Dann so.";"Liegt außerhalb der Landschaft"`);
    const sheet = readAnswerSheet(csv);
    expect(sheet.filter((r) => r.text !== '')).toEqual([
      {
        id: finding.id,
        text: '=Dann so.',
        kind: 'Liegt außerhalb der Landschaft',
        line: expect.any(Number) as unknown,
      },
    ]);
    const checked = checkSheet(sheet, new Map(answered.map((q) => [q.id, q])));
    expect(checked.counts).toMatchObject({ recorded: 0, unchanged: 1, ignored: sheet.length - 1 });
    const md = renderOpenQuestionsMarkdown(answered, {
      projectName: 'P',
      projectKey: 'p',
      seq: 1,
      filter: {},
    });
    expect(md).toContain('- Antwort (Antwort, owner, Ereignis 1001): Erst so.\n');
    expect(md).toContain(
      '- Antwort (Liegt außerhalb der Landschaft, owner, Ereignis 1002): \\=Dann so.\n',
    );
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
      [1, 'recorded', 'answer', 1],
      [2, 'recorded', 'will-be-modelled', 0],
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
      checked.record.map((r) => [r.draft.question.id, r.draft.kind, r.draft.text.length]),
    ).toEqual([
      [a.id, 'answer', 'Ja, über a@b.de.'.length],
      [b.id, 'will-be-modelled', 2000],
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

  it('compares with the latest answer only: going back to an earlier one records it again', async () => {
    const input = await synthetic();
    const finding = openQuestions(input).find((q) => q.source === 'finding');
    if (!finding) throw new Error('no finding');
    // x, then y: y is the current answer (the export and the list show it).
    const answered = openQuestions({
      ...input,
      answers: [
        stored(1, finding, { answerText: 'x' }),
        stored(2, finding, { kind: 'outside-landscape', answerText: 'y' }),
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
    // y again: unchanged, with the latest answer.
    expect(sameAnswer({ question: item, kind: 'outside-landscape', text: 'y' })?.id).toBe(
      answerId(2),
    );
    // y with another kind: a new answer.
    expect(sameAnswer({ question: item, kind: 'answer', text: 'y' })).toBeUndefined();
    expect(
      checkSheet([{ id: item.id, text: 'y', kind: 'Wird im Modell ergänzt' }], current).rows,
    ).toMatchObject([{ outcome: 'recorded', kind: 'will-be-modelled' }]);
    // An empty Antwortart (or none: a sheet without the column) with the latest text is
    // unchanged whatever the latest kind, so a re-saved export records nothing twice.
    expect(checkSheet([{ id: item.id, text: ' y ', kind: '' }], current).rows).toMatchObject([
      { outcome: 'unchanged', answer: { id: answerId(2), kind: 'outside-landscape' } },
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
            answerText: row.text ?? String(note?.['rationale']),
            handle: 'owner',
            createdAt: AT,
          });
          return Promise.resolve();
        },
        list: () => Promise.resolve(answers),
      },
    };
    return { tx: tx as unknown as Tx, written, events };
  }

  it('records a note on a relation or placement and a text otherwise, each with its event', async () => {
    const input = await synthetic();
    const items = openQuestions(input);
    const relation = items.find((q) => q.kind === 'held' && q.subject.type === 'relation');
    const placementItem = items.find((q) => q.subject.type === 'placement');
    const finding = items.find((q) => q.source === 'finding');
    if (!relation || !placementItem || !finding) throw new Error('missing items');
    const { tx, written, events } = standIn(input);
    const recorded = await recordAnswers(tx, PROJECT, HUMAN_ACTOR, [
      { question: relation, kind: 'answer', text: 'Ja, als Nachricht.' },
      { question: placementItem, kind: 'will-be-modelled', text: 'Kommt ins Modell.' },
      { question: finding, kind: 'outside-landscape', text: 'Extern.' },
    ]);
    expect(
      written.map((w) => [w.table, w.row['kind'], w.row['rationale'] ?? w.row['text']]),
    ).toEqual([
      ['relation_assertion', 'note', 'Ja, als Nachricht.'],
      ['open_question_answer', 'answer', null],
      ['placement_assertion', 'note', 'Kommt ins Modell.'],
      ['open_question_answer', 'will-be-modelled', null],
      ['open_question_answer', 'outside-landscape', 'Extern.'],
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
    expect(events.map((e) => e.type)).toEqual([
      'relation.noted',
      'open_question.answered',
      'placement.noted',
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
    expect(recorded.map((a) => [a.target, a.text, a.seq])).toEqual([
      ['relation-note', 'Ja, als Nachricht.', 5002],
      ['placement-note', 'Kommt ins Modell.', 5004],
      ['answer', 'Extern.', 5005],
    ]);
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

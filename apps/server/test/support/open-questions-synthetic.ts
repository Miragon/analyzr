/**
 * The synthetic landscape of the open-questions tests (M6 S4, S5a, S5c-1):
 * three small models (an order process with a send task, a call and a
 * message throw; an invoicing process started by the message; a notes
 * process with a black-box bank pool), a human hold, agents' questions,
 * coded no-links, a value chain with accepted, held and proposed
 * placements, an unsure verdict and two submission summaries.
 */
import type {
  PlacementAssertionId,
  PlacementId,
  PrincipalId,
  Ref,
  ValueChainId,
} from '@analyzr/contracts';

import { pairKey } from '../../src/domain/judgements.ts';
import type { ChainInput, OpenQuestionInput } from '../../src/domain/open-questions/model.ts';
import type {
  PlacementRecord,
  RelationRecord,
  StoredNoLink,
  StoredPlacementAssertion,
} from '../../src/domain/ports.ts';
import { prepareRevision } from '../../src/domain/value-chain/document.ts';
import { valueChainFindings } from '../../src/domain/value-chain/findings.ts';
import { OUTSIDE } from '../../src/domain/value-chain/steps.ts';
import { AT, PROJECT, assertion, assertionId, libraryInput, relationId } from './open-questions.ts';
import { chain } from './value-chain.ts';

export const HUMAN = `prn_${'0'.repeat(21)}HUMAN` as PrincipalId;
export const AGENT = `prn_${'0'.repeat(21)}AGENT` as PrincipalId;
export const AGENT_2 = `prn_${'0'.repeat(19)}AGENTTWO` as PrincipalId;

export const DEFS =
  'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs" targetNamespace="http://example.org/bpmn"';
export const C7 = 'xmlns:camunda="http://camunda.org/schema/1.0/bpmn"';

export const AUFTRAG = `<?xml version="1.0" encoding="UTF-8"?>
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

export const RECHNUNG = `<?xml version="1.0" encoding="UTF-8"?>
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

export const NOTIZ = `<?xml version="1.0" encoding="UTF-8"?>
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

export const A = 'vertrieb/auftrag#P_Auftrag' as Ref;
export const R = 'finanzen/rechnung#P_Rechnung' as Ref;
export const N = 'archiv/notiz#Notizablage' as Ref;
export const TASK_RECHNUNG = 'vertrieb/auftrag#Task_Rechnung' as Ref;
export const START_RECHNUNG = 'finanzen/rechnung#Start_Rechnung' as Ref;
export const CALL = 'vertrieb/auftrag#Call_Pruefung' as Ref;
export const STORNO = 'vertrieb/auftrag#Event_Storno' as Ref;
export const TASK_NOTIZ = 'archiv/notiz#Task_Notiz' as Ref;

export const placementId = (n: number): PlacementId => `plc_${String(n).padStart(26, '0')}`;
export const placementAssertionId = (n: number): PlacementAssertionId =>
  `pas_${String(n).padStart(26, '0')}`;
export const CHAIN_ID: ValueChainId = `vch_${'0'.repeat(26)}`;

export function placement(
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

export function placementAssertion(
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

export function noLink(n: number, from: Ref, to: Ref, reason: string): StoredNoLink {
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

export const STRUCTURE = prepareRevision(
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

/**
 * The synthetic landscape, held, asked, no-linked, placed and summarized;
 * `extra` files join it (their processes have no placement).
 */
export async function synthetic(
  extra: readonly { key: string; bytes: string }[] = [],
): Promise<OpenQuestionInput> {
  const base = await libraryInput([
    { key: 'vertrieb/auftrag', bytes: AUFTRAG },
    { key: 'finanzen/rechnung', bytes: RECHNUNG },
    { key: 'archiv/notiz', bytes: NOTIZ },
    ...extra,
  ]);
  const processes = base.projectFacts.models.flatMap((m) => m.processes.map((p) => p.ref));
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
      processes,
      placements,
      calls: [],
    }),
    open: processes.filter((p) => p !== A).sort(),
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

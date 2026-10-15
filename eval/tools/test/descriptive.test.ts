// Tests for eval:descriptive (src/descriptive*.ts, lib/descriptive.mjs,
// src/claim-estimate.ts): the transforms on small synthetic landscapes, every
// corpus model in every variant (extracts without warnings, complete DI, every
// element id kept), the holdout redaction (also on the real holdout, PASS/FAIL
// only) and the determinism of the report.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';

import { FACTS_VERSION, extractFacts, type ExtractResult } from '@analyzr/bpmn-facts';
import type { ProjectFacts } from '@analyzr/contracts';
import { generateCandidates, runRules } from '@analyzr/relations';

import { checkDi } from '../lib/checks.mjs';
import { VARIANTS, roundTrip, transformModel, type Variant } from '../lib/descriptive.mjs';
import { createModdle } from '../lib/moddle.mjs';
import { CORPUS_DIR, loadModels } from '../src/corpus.ts';
import { UNKNOWN_PARTNER, transformContexts } from '../src/descriptive-context.ts';
import { renderDescriptiveMarkdown } from '../src/descriptive-report.ts';
import {
  HIDDEN,
  SMALL,
  redactDescriptive,
  redactGrid,
  type Cell,
  type FindingRow,
  type GridCell,
  type LandscapeDescriptive,
  type VariantResult,
} from '../src/descriptive-score.ts';
import { evaluateDescriptive } from '../src/descriptive.ts';

const NS =
  'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" ' +
  'xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" ' +
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:modeler="http://camunda.org/schema/modeler/1.0"';

const shape = (id: string, x: number, y: number, w: number, h: number): string =>
  `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"><dc:Bounds x="${x}" y="${y}" width="${w}" height="${h}" /></bpmndi:BPMNShape>`;
const edge = (id: string, ...points: Array<[number, number]>): string =>
  `<bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}">${points.map(([x, y]) => `<di:waypoint x="${x}" y="${y}" />`).join('')}</bpmndi:BPMNEdge>`;
const flow = (id: string, from: string, to: string): string => `<bpmn:sequenceFlow id="${id}" sourceRef="${from}" targetRef="${to}" />`;

/** C8: a call to b/billing and a message throw that b/billing catches. */
const ORDER = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" id="Definitions_A" targetNamespace="http://bpmn.io/schema/bpmn" modeler:executionPlatform="Camunda Cloud" modeler:executionPlatformVersion="8.9.0">
  <bpmn:process id="Process_Order" name="Auftragsabwicklung" isExecutable="true">
    <bpmn:documentation>Nimmt Aufträge an.</bpmn:documentation>
    <bpmn:startEvent id="Start_Order" name="Auftrag eingegangen"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="Task_Check" name="Auftrag prüfen">
      <bpmn:documentation>Prüft den Auftrag.</bpmn:documentation>
      <bpmn:extensionElements><zeebe:taskDefinition type="check" /></bpmn:extensionElements>
      <bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing>
    </bpmn:serviceTask>
    <bpmn:callActivity id="Call_Bill" name="Rechnung stellen">
      <bpmn:extensionElements><zeebe:calledElement processId="Process_Bill" propagateAllChildVariables="false" /></bpmn:extensionElements>
      <bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F3</bpmn:outgoing>
    </bpmn:callActivity>
    <bpmn:intermediateThrowEvent id="Event_Shipped" name="Ware versendet">
      <bpmn:incoming>F3</bpmn:incoming><bpmn:outgoing>F4</bpmn:outgoing>
      <bpmn:messageEventDefinition id="Event_Shipped_ed" messageRef="Message_Shipped" />
    </bpmn:intermediateThrowEvent>
    <bpmn:endEvent id="End_Order" name="Auftrag erledigt"><bpmn:incoming>F4</bpmn:incoming></bpmn:endEvent>
    ${flow('F1', 'Start_Order', 'Task_Check')}
    ${flow('F2', 'Task_Check', 'Call_Bill')}
    ${flow('F3', 'Call_Bill', 'Event_Shipped')}
    ${flow('F4', 'Event_Shipped', 'End_Order')}
  </bpmn:process>
  <bpmn:message id="Message_Shipped" name="WareVersendet">
    <bpmn:extensionElements><zeebe:subscription correlationKey="=orderId" /></bpmn:extensionElements>
  </bpmn:message>
  <bpmndi:BPMNDiagram id="Diagram_A"><bpmndi:BPMNPlane id="Plane_A" bpmnElement="Process_Order">
    ${shape('Start_Order', 100, 100, 36, 36)}${shape('Task_Check', 180, 78, 100, 80)}${shape('Call_Bill', 330, 78, 100, 80)}
    ${shape('Event_Shipped', 480, 100, 36, 36)}${shape('End_Order', 560, 100, 36, 36)}
    ${edge('F1', [136, 118], [180, 118])}${edge('F2', [280, 118], [330, 118])}${edge('F3', [430, 118], [480, 118])}${edge('F4', [516, 118], [560, 118])}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>
`;

/** C7: the catch after an event-based gateway and a send task nobody receives. */
const BILLING = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="Definitions_B" targetNamespace="http://bpmn.io/schema/bpmn" modeler:executionPlatform="Camunda Platform" modeler:executionPlatformVersion="7.24.0">
  <bpmn:process id="Process_Bill" name="Rechnungsstellung" isExecutable="true" camunda:historyTimeToLive="180">
    <bpmn:startEvent id="Start_Bill" name="Rechnung angefordert"><bpmn:outgoing>G1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:eventBasedGateway id="Gateway_Wait"><bpmn:incoming>G1</bpmn:incoming><bpmn:outgoing>G2</bpmn:outgoing><bpmn:outgoing>G3</bpmn:outgoing></bpmn:eventBasedGateway>
    <bpmn:intermediateCatchEvent id="Catch_Shipped" name="Ware versendet">
      <bpmn:incoming>G2</bpmn:incoming><bpmn:outgoing>G4</bpmn:outgoing>
      <bpmn:messageEventDefinition id="Catch_Shipped_ed" messageRef="Message_Shipped" />
    </bpmn:intermediateCatchEvent>
    <bpmn:intermediateCatchEvent id="Catch_Timeout" name="Frist abgelaufen">
      <bpmn:incoming>G3</bpmn:incoming><bpmn:outgoing>G5</bpmn:outgoing>
      <bpmn:timerEventDefinition id="Catch_Timeout_ed"><bpmn:timeDuration xsi:type="bpmn:tFormalExpression">P1D</bpmn:timeDuration></bpmn:timerEventDefinition>
    </bpmn:intermediateCatchEvent>
    <bpmn:sendTask id="Task_Notify" name="Kunde benachrichtigen" messageRef="Message_Notified" camunda:type="external" camunda:topic="notify">
      <bpmn:incoming>G4</bpmn:incoming><bpmn:outgoing>G6</bpmn:outgoing>
    </bpmn:sendTask>
    <bpmn:endEvent id="End_Bill" name="Rechnung gestellt"><bpmn:incoming>G5</bpmn:incoming><bpmn:incoming>G6</bpmn:incoming></bpmn:endEvent>
    ${flow('G1', 'Start_Bill', 'Gateway_Wait')}
    ${flow('G2', 'Gateway_Wait', 'Catch_Shipped')}
    ${flow('G3', 'Gateway_Wait', 'Catch_Timeout')}
    ${flow('G4', 'Catch_Shipped', 'Task_Notify')}
    ${flow('G5', 'Catch_Timeout', 'End_Bill')}
    ${flow('G6', 'Task_Notify', 'End_Bill')}
  </bpmn:process>
  <bpmn:message id="Message_Shipped" name="WareVersendet" />
  <bpmn:message id="Message_Notified" name="KundeBenachrichtigt" />
  <bpmndi:BPMNDiagram id="Diagram_B"><bpmndi:BPMNPlane id="Plane_B" bpmnElement="Process_Bill">
    ${shape('Start_Bill', 100, 100, 36, 36)}${shape('Gateway_Wait', 170, 93, 50, 50)}${shape('Catch_Shipped', 260, 100, 36, 36)}
    ${shape('Catch_Timeout', 260, 200, 36, 36)}${shape('Task_Notify', 340, 78, 100, 80)}${shape('End_Bill', 490, 100, 36, 36)}
    ${edge('G1', [136, 118], [170, 118])}${edge('G2', [220, 118], [260, 118])}${edge('G3', [195, 143], [195, 218], [260, 218])}
    ${edge('G4', [296, 118], [340, 118])}${edge('G5', [296, 218], [508, 218], [508, 136])}${edge('G6', [440, 118], [490, 118])}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>
`;

/** C8: a FEEL call target and a call to a process no model has. */
const CALLS = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" id="Definitions_C" targetNamespace="http://bpmn.io/schema/bpmn" modeler:executionPlatform="Camunda Cloud" modeler:executionPlatformVersion="8.9.0">
  <bpmn:process id="Process_Calls" name="Aufrufe" isExecutable="true">
    <bpmn:startEvent id="Start_Calls" name="Aufruf angefordert"><bpmn:outgoing>C1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:callActivity id="Call_Dynamic" name="Nächsten Schritt aufrufen">
      <bpmn:extensionElements><zeebe:calledElement processId="=nextProcess" propagateAllChildVariables="false" /></bpmn:extensionElements>
      <bpmn:incoming>C1</bpmn:incoming><bpmn:outgoing>C2</bpmn:outgoing>
    </bpmn:callActivity>
    <bpmn:callActivity id="Call_Unknown" name="Altsystem aufrufen">
      <bpmn:extensionElements><zeebe:calledElement processId="Process_Nowhere" propagateAllChildVariables="false" /></bpmn:extensionElements>
      <bpmn:incoming>C2</bpmn:incoming><bpmn:outgoing>C3</bpmn:outgoing>
    </bpmn:callActivity>
    <bpmn:endEvent id="End_Calls" name="Aufrufe erledigt"><bpmn:incoming>C3</bpmn:incoming></bpmn:endEvent>
    ${flow('C1', 'Start_Calls', 'Call_Dynamic')}
    ${flow('C2', 'Call_Dynamic', 'Call_Unknown')}
    ${flow('C3', 'Call_Unknown', 'End_Calls')}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_C"><bpmndi:BPMNPlane id="Plane_C" bpmnElement="Process_Calls">
    ${shape('Start_Calls', 100, 100, 36, 36)}${shape('Call_Dynamic', 180, 78, 100, 80)}${shape('Call_Unknown', 330, 78, 100, 80)}${shape('End_Calls', 480, 100, 36, 36)}
    ${edge('C1', [136, 118], [180, 118])}${edge('C2', [280, 118], [330, 118])}${edge('C3', [430, 118], [480, 118])}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>
`;

const SYNTHETIC = [
  { key: 'a/order', xml: ORDER },
  { key: 'b/billing', xml: BILLING },
  { key: 'c/calls', xml: CALLS },
];

/**
 * C7 with a collaboration and a black-box pool „Lager“ (a partner's process
 * name): a message start event, a boundary catch and a send task with two
 * partner processes.
 */
const HUB = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="Definitions_Hub" targetNamespace="http://bpmn.io/schema/bpmn" modeler:executionPlatform="Camunda Platform" modeler:executionPlatformVersion="7.24.0">
  <bpmn:collaboration id="Collaboration_Hub">
    <bpmn:participant id="Participant_Hub" name="Zentrale" processRef="Process_Hub" />
    <bpmn:participant id="Participant_Lager" name="Lager" />
  </bpmn:collaboration>
  <bpmn:process id="Process_Hub" name="Zentrale" isExecutable="true">
    <bpmn:startEvent id="Start_Hub" name="Bestellung eingegangen">
      <bpmn:outgoing>H1</bpmn:outgoing>
      <bpmn:messageEventDefinition id="Start_Hub_ed" messageRef="Message_Order" />
    </bpmn:startEvent>
    <bpmn:userTask id="Task_Check" name="Bestellung prüfen"><bpmn:incoming>H1</bpmn:incoming><bpmn:outgoing>H2</bpmn:outgoing></bpmn:userTask>
    <bpmn:boundaryEvent id="Boundary_Cancel" name="Storno eingegangen" attachedToRef="Task_Check">
      <bpmn:outgoing>H4</bpmn:outgoing>
      <bpmn:messageEventDefinition id="Boundary_Cancel_ed" messageRef="Message_Cancel" />
    </bpmn:boundaryEvent>
    <bpmn:sendTask id="Task_Ship" name="Versand anstoßen" messageRef="Message_Ship" camunda:class="x.Ship">
      <bpmn:incoming>H2</bpmn:incoming><bpmn:outgoing>H3</bpmn:outgoing>
    </bpmn:sendTask>
    <bpmn:endEvent id="End_Hub" name="Bestellung erledigt"><bpmn:incoming>H3</bpmn:incoming></bpmn:endEvent>
    <bpmn:endEvent id="End_Cancelled" name="Bestellung storniert"><bpmn:incoming>H4</bpmn:incoming></bpmn:endEvent>
    ${flow('H1', 'Start_Hub', 'Task_Check')}
    ${flow('H2', 'Task_Check', 'Task_Ship')}
    ${flow('H3', 'Task_Ship', 'End_Hub')}
    ${flow('H4', 'Boundary_Cancel', 'End_Cancelled')}
  </bpmn:process>
  <bpmn:message id="Message_Order" name="BestellungEingegangen" />
  <bpmn:message id="Message_Ship" name="VersandAngestossen" />
  <bpmn:message id="Message_Cancel" name="StornoEingegangen" />
  <bpmndi:BPMNDiagram id="Diagram_Hub"><bpmndi:BPMNPlane id="Plane_Hub" bpmnElement="Collaboration_Hub">
    <bpmndi:BPMNShape id="Participant_Hub_di" bpmnElement="Participant_Hub" isHorizontal="true"><dc:Bounds x="50" y="40" width="600" height="250" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Participant_Lager_di" bpmnElement="Participant_Lager" isHorizontal="true"><dc:Bounds x="50" y="330" width="600" height="60" /></bpmndi:BPMNShape>
    ${shape('Start_Hub', 100, 100, 36, 36)}${shape('Task_Check', 180, 78, 100, 80)}${shape('Boundary_Cancel', 212, 140, 36, 36)}
    ${shape('Task_Ship', 330, 78, 100, 80)}${shape('End_Hub', 480, 100, 36, 36)}${shape('End_Cancelled', 330, 210, 36, 36)}
    ${edge('H1', [136, 118], [180, 118])}${edge('H2', [280, 118], [330, 118])}${edge('H3', [430, 118], [480, 118])}${edge('H4', [230, 176], [230, 228], [330, 228])}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>
`;

/** C8: an intermediate throw and catch and a message end event, all talking to x/hub. */
const SHOP = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" id="Definitions_Shop" targetNamespace="http://bpmn.io/schema/bpmn" modeler:executionPlatform="Camunda Cloud" modeler:executionPlatformVersion="8.9.0">
  <bpmn:process id="Process_Shop" name="Shop" isExecutable="true">
    <bpmn:startEvent id="Start_Shop" name="Kunde bestellt"><bpmn:outgoing>S1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:intermediateThrowEvent id="Throw_Order" name="Bestellung senden">
      <bpmn:incoming>S1</bpmn:incoming><bpmn:outgoing>S2</bpmn:outgoing>
      <bpmn:messageEventDefinition id="Throw_Order_ed" messageRef="Message_Order" />
    </bpmn:intermediateThrowEvent>
    <bpmn:intermediateCatchEvent id="Catch_Ship" name="Versand angestoßen">
      <bpmn:incoming>S2</bpmn:incoming><bpmn:outgoing>S3</bpmn:outgoing>
      <bpmn:messageEventDefinition id="Catch_Ship_ed" messageRef="Message_Ship" />
    </bpmn:intermediateCatchEvent>
    <bpmn:endEvent id="End_Cancel" name="Bestellung zurückgezogen">
      <bpmn:incoming>S3</bpmn:incoming>
      <bpmn:messageEventDefinition id="End_Cancel_ed" messageRef="Message_Cancel" />
    </bpmn:endEvent>
    ${flow('S1', 'Start_Shop', 'Throw_Order')}
    ${flow('S2', 'Throw_Order', 'Catch_Ship')}
    ${flow('S3', 'Catch_Ship', 'End_Cancel')}
  </bpmn:process>
  <bpmn:message id="Message_Order" name="BestellungEingegangen" />
  <bpmn:message id="Message_Ship" name="VersandAngestossen">
    <bpmn:extensionElements><zeebe:subscription correlationKey="=orderId" /></bpmn:extensionElements>
  </bpmn:message>
  <bpmn:message id="Message_Cancel" name="StornoEingegangen" />
  <bpmndi:BPMNDiagram id="Diagram_Shop"><bpmndi:BPMNPlane id="Plane_Shop" bpmnElement="Process_Shop">
    ${shape('Start_Shop', 100, 100, 36, 36)}${shape('Throw_Order', 180, 100, 36, 36)}${shape('Catch_Ship', 260, 100, 36, 36)}${shape('End_Cancel', 340, 100, 36, 36)}
    ${edge('S1', [136, 118], [180, 118])}${edge('S2', [216, 118], [260, 118])}${edge('S3', [296, 118], [340, 118])}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>
`;

/** C7 without a collaboration: a receive task. */
const LAGER = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="Definitions_Lager" targetNamespace="http://bpmn.io/schema/bpmn" modeler:executionPlatform="Camunda Platform" modeler:executionPlatformVersion="7.24.0">
  <bpmn:process id="Process_Lager" name="Lager" isExecutable="true" camunda:historyTimeToLive="180">
    <bpmn:startEvent id="Start_Lager" name="Schicht beginnt"><bpmn:outgoing>L1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:receiveTask id="Receive_Ship" name="Versandauftrag empfangen" messageRef="Message_Ship"><bpmn:incoming>L1</bpmn:incoming><bpmn:outgoing>L2</bpmn:outgoing></bpmn:receiveTask>
    <bpmn:endEvent id="End_Lager" name="Ware versandt"><bpmn:incoming>L2</bpmn:incoming></bpmn:endEvent>
    ${flow('L1', 'Start_Lager', 'Receive_Ship')}
    ${flow('L2', 'Receive_Ship', 'End_Lager')}
  </bpmn:process>
  <bpmn:message id="Message_Ship" name="VersandAngestossen" />
  <bpmndi:BPMNDiagram id="Diagram_Lager"><bpmndi:BPMNPlane id="Plane_Lager" bpmnElement="Process_Lager">
    ${shape('Start_Lager', 100, 100, 36, 36)}${shape('Receive_Ship', 180, 78, 100, 80)}${shape('End_Lager', 330, 100, 36, 36)}
    ${edge('L1', [136, 118], [180, 118])}${edge('L2', [280, 118], [330, 118])}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>
`;

const EXCHANGE = [
  { key: 'x/hub', xml: HUB },
  { key: 'x/lager', xml: LAGER },
  { key: 'x/shop', xml: SHOP },
];

type Models = ReadonlyArray<{ key: string; xml: string }>;

function projectFactsOf(results: readonly ExtractResult[]): ProjectFacts {
  return {
    models: results.map((r) => ({
      modelKey: r.modelKey,
      factsVersion: FACTS_VERSION,
      processes: r.processes,
      facts: r.facts,
      messageFlows: r.messageFlows,
    })),
  };
}

async function extractAll(models: Models): Promise<ExtractResult[]> {
  return Promise.all(models.map((m) => extractFacts(m.xml, { modelKey: m.key })));
}

/** DI problems of a transformed model (counts only on failure); collapsed subprocesses are expected there (the corpus validator wants expanded ones). */
async function diProblems(xml: string): Promise<string[]> {
  const { rootElement, warnings } = await createModdle('c7').fromXML(xml);
  assert.equal(warnings.length, 0, `${warnings.length} moddle warnings`);
  return checkDi(rootElement).filter((e) => !e.endsWith('subprocess shape must be expanded (isExpanded="true")'));
}

/** A landscape in every variant. */
async function variantsOf(models: Models): Promise<Map<Variant, Array<{ key: string; xml: string }>>> {
  const contexts = transformContexts(projectFactsOf(await extractAll(models)));
  const out = new Map<Variant, Array<{ key: string; xml: string }>>(VARIANTS.map((v) => [v, []]));
  for (const m of models) {
    const ctx = contexts.get(m.key);
    assert.ok(ctx);
    const xml = await transformModel(m.xml, ctx);
    for (const v of VARIANTS) out.get(v)?.push({ key: m.key, xml: xml[v] });
  }
  return out;
}

const syntheticVariants = () => variantsOf(SYNTHETIC);

const factOf = (r: ExtractResult | undefined, id: string) => r?.facts.find((f) => f.elementId === id);
const findingsOf = (facts: readonly ExtractResult[]) =>
  runRules(projectFactsOf(facts)).findings.map((f) => [f.kind, ...f.refs].join(' ')).sort();

interface Walked {
  type: string;
  parent: string | null;
}

/** Every BPMN and BPMN DI element with an id (engine extensions left out), by id. */
async function elementIds(xml: string): Promise<Map<string, Walked>> {
  const { rootElement } = await createModdle('c7').fromXML(xml);
  const out = new Map<string, Walked>();
  const seen = new Set<object>();
  const visit = (el: Record<string, unknown>): void => {
    if (seen.has(el)) return;
    seen.add(el);
    const type = String(el['$type']);
    const parent = el['$parent'] as { id?: unknown } | undefined;
    if (typeof el['id'] === 'string' && /^bpmn(di)?:/.test(type)) {
      out.set(el['id'], { type, parent: typeof parent?.id === 'string' ? parent.id : null });
    }
    for (const [key, value] of Object.entries(el)) {
      if (key.startsWith('$')) continue;
      for (const v of Array.isArray(value) ? value : [value]) {
        if (v !== null && typeof v === 'object' && typeof (v as { $type?: unknown }).$type === 'string') {
          visit(v as Record<string, unknown>);
        }
      }
    }
  };
  visit(rootElement as Record<string, unknown>);
  return out;
}

/**
 * Element ids of the original a variant lost beyond the intended ones: the
 * message and signal definitions (from descriptive on), the event definitions
 * of events that became tasks (from tasks on), documentation (no-docs).
 */
function unexpectedlyLost(original: Map<string, Walked>, variant: Map<string, Walked>, v: Variant): number {
  const at = VARIANTS.indexOf(v);
  let lost = 0;
  for (const [id, el] of original) {
    if (variant.has(id)) continue;
    if ((el.type === 'bpmn:Message' || el.type === 'bpmn:Signal') && at >= VARIANTS.indexOf('descriptive')) continue;
    if (
      el.type === 'bpmn:MessageEventDefinition' &&
      at >= VARIANTS.indexOf('tasks') &&
      el.parent !== null &&
      variant.get(el.parent)?.type === 'bpmn:Task'
    ) {
      continue;
    }
    if (el.type === 'bpmn:Documentation' && at >= VARIANTS.indexOf('no-docs')) continue;
    lost++;
  }
  return lost;
}

test('the transform context names callees and message partners from the model files', async () => {
  const contexts = transformContexts(projectFactsOf(await extractAll(SYNTHETIC)));
  assert.deepEqual(contexts.get('a/order'), {
    callees: { Call_Bill: 'Rechnungsstellung' },
    messages: { Event_Shipped: { direction: 'out', partners: ['Rechnungsstellung'] } },
  });
  assert.deepEqual(contexts.get('b/billing'), {
    callees: {},
    messages: {
      Catch_Shipped: { direction: 'in', partners: ['Auftragsabwicklung'] },
      // No partner by name: the neutral pool, not the message name.
      Task_Notify: { direction: 'out', partners: [UNKNOWN_PARTNER] },
    },
  });
  // A dynamic and an unresolved target: no callee, the activity keeps its name.
  assert.deepEqual(contexts.get('c/calls'), { callees: { Call_Dynamic: null, Call_Unknown: null }, messages: {} });

  const exchange = transformContexts(projectFactsOf(await extractAll(EXCHANGE)));
  assert.deepEqual(exchange.get('x/hub')?.messages, {
    Boundary_Cancel: { direction: 'in', partners: ['Shop'] },
    Start_Hub: { direction: 'in', partners: ['Shop'] },
    // Two partner processes; „Zentrale“ is x/hub's pool name, „Lager“ a process without a pool.
    Task_Ship: { direction: 'out', partners: ['Lager', 'Shop'] },
  });
  assert.deepEqual(exchange.get('x/shop')?.messages, {
    Catch_Ship: { direction: 'in', partners: ['Zentrale'] },
    End_Cancel: { direction: 'out', partners: ['Zentrale'] },
    Throw_Order: { direction: 'out', partners: ['Zentrale'] },
  });
  assert.deepEqual(exchange.get('x/lager')?.messages, { Receive_Ship: { direction: 'in', partners: ['Zentrale'] } });
});

test('engine-stripped removes the Camunda namespaces and keeps the call target as calledElement', async () => {
  const models = (await syntheticVariants()).get('engine-stripped') ?? [];
  for (const m of models) {
    assert.doesNotMatch(m.xml, /camunda|zeebe|executionPlatform/i, m.key);
    assert.deepEqual(await diProblems(m.xml), [], m.key);
  }
  const facts = await extractAll(models);
  const [order, billing] = facts;
  assert.ok(order && billing);
  assert.deepEqual(facts.map((r) => r.engine), [null, null, null]);
  assert.deepEqual(facts.flatMap((r) => r.warnings), []);
  assert.match(models[0]?.xml ?? '', /<bpmn:callActivity id="Call_Bill" name="Rechnung stellen" calledElement="Process_Bill">/);
  const rules = runRules(projectFactsOf(facts));
  assert.deepEqual(
    rules.relations.map((r) => [r.type, r.from, r.to, r.status]),
    [
      ['call', 'a/order#Call_Bill', 'b/billing#Process_Bill', 'accepted'],
      ['message', 'a/order#Event_Shipped', 'b/billing#Catch_Shipped', 'proposed'],
    ],
  );
});

test('engine-stripped: a C8 FEEL call target lands in calledElement and facts v1 takes it for a static one (a facts gap)', async () => {
  // Pinned on purpose: when a facts version treats `=expr` in calledElement
  // as dynamic without an engine, this test and the report's engine-stripped
  // findings change together (descriptive-report.ts FACTS_EFFECTS).
  const callsOnly = (facts: readonly ExtractResult[]) => findingsOf(facts).filter((f) => f.endsWith('#Call_Dynamic') || f.endsWith('#Call_Unknown'));
  const original = await extractAll(SYNTHETIC);
  assert.equal(factOf(original[2], 'Call_Dynamic')?.attrs.dynamic, true);
  assert.deepEqual(callsOnly(original), ['dynamic-call c/calls#Call_Dynamic', 'unresolved-call c/calls#Call_Unknown']);

  const models = (await syntheticVariants()).get('engine-stripped') ?? [];
  assert.match(models[2]?.xml ?? '', /<bpmn:callActivity id="Call_Dynamic" name="Nächsten Schritt aufrufen" calledElement="=nextProcess">/);
  const stripped = await extractAll(models);
  assert.equal(factOf(stripped[2], 'Call_Dynamic')?.attrs.dynamic, false);
  assert.deepEqual(callsOnly(stripped), ['unresolved-call c/calls#Call_Dynamic', 'unresolved-call c/calls#Call_Unknown']);
});

test('descriptive: not executable, calls as collapsed subprocesses named after the callee, no message or signal refs', async () => {
  const models = (await syntheticVariants()).get('descriptive') ?? [];
  const facts = await extractAll(models);
  const [order, billing] = facts;
  assert.ok(order && billing);
  assert.deepEqual(facts.flatMap((r) => r.warnings), []);
  assert.deepEqual(facts.flatMap((r) => r.processes).map((p) => p.isExecutable), [false, false, false]);
  const xml = models[0]?.xml ?? '';
  assert.match(xml, /<bpmn:subProcess id="Call_Bill" name="Rechnungsstellung">/);
  assert.match(xml, /<bpmndi:BPMNShape id="Call_Bill_di" bpmnElement="Call_Bill" isExpanded="false">/);
  assert.equal(factOf(order, 'Call_Bill'), undefined);
  // Unresolved and dynamic calls keep their own names.
  assert.match(models[2]?.xml ?? '', /<bpmn:subProcess id="Call_Dynamic" name="Nächsten Schritt aufrufen">/);
  assert.match(models[2]?.xml ?? '', /<bpmn:subProcess id="Call_Unknown" name="Altsystem aufrufen">/);
  for (const m of models) {
    assert.doesNotMatch(m.xml, /messageRef|signalRef|<bpmn:message |<bpmn:signal /, m.key);
    assert.deepEqual(await diProblems(m.xml), [], m.key);
  }
  // The names live on the labels only: no message name, so no key-tier pair.
  assert.equal(factOf(order, 'Event_Shipped')?.attrs.messageName, undefined);
  assert.equal(factOf(order, 'Event_Shipped')?.keyRaw, 'Ware versendet');
  assert.deepEqual(runRules(projectFactsOf(facts)).relations, []);
});

test('descriptive strips signal names like message names', async () => {
  const signals = (xml: string, catchName: string) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NS} id="Definitions_${catchName}" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_${catchName}" name="${catchName}" isExecutable="true">
    ${xml}
  </bpmn:process>
  <bpmn:signal id="Signal_Closed" name="PeriodeGeschlossen" />
  <bpmndi:BPMNDiagram id="Diagram_${catchName}"><bpmndi:BPMNPlane id="Plane_${catchName}" bpmnElement="Process_${catchName}">
    ${shape(`Start_${catchName}`, 100, 100, 36, 36)}${shape(`End_${catchName}`, 200, 100, 36, 36)}${edge(`F_${catchName}`, [136, 118], [200, 118])}
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
  const models = [
    {
      key: 's/close',
      xml: signals(
        `<bpmn:startEvent id="Start_Close" name="Monat endet"><bpmn:outgoing>F_Close</bpmn:outgoing></bpmn:startEvent>
    <bpmn:endEvent id="End_Close" name="Periode geschlossen"><bpmn:incoming>F_Close</bpmn:incoming><bpmn:signalEventDefinition id="End_Close_ed" signalRef="Signal_Closed" /></bpmn:endEvent>
    ${flow('F_Close', 'Start_Close', 'End_Close')}`,
        'Close',
      ),
    },
    {
      key: 's/report',
      xml: signals(
        `<bpmn:startEvent id="Start_Report" name="Periode geschlossen"><bpmn:outgoing>F_Report</bpmn:outgoing><bpmn:signalEventDefinition id="Start_Report_ed" signalRef="Signal_Closed" /></bpmn:startEvent>
    <bpmn:endEvent id="End_Report" name="Bericht erstellt"><bpmn:incoming>F_Report</bpmn:incoming></bpmn:endEvent>
    ${flow('F_Report', 'Start_Report', 'End_Report')}`,
        'Report',
      ),
    },
  ];
  const original = await extractAll(models);
  assert.deepEqual(runRules(projectFactsOf(original)).relations.map((r) => [r.type, r.from, r.to]), [
    ['signal', 's/close#End_Close', 's/report#Start_Report'],
  ]);
  const descriptive = (await variantsOf(models)).get('descriptive') ?? [];
  for (const m of descriptive) assert.doesNotMatch(m.xml, /signalRef|<bpmn:signal /, m.key);
  const facts = await extractAll(descriptive);
  assert.deepEqual(facts.flatMap((r) => r.warnings), []);
  assert.equal(factOf(facts[0], 'End_Close')?.kind, 'sig_throw');
  assert.equal(factOf(facts[0], 'End_Close')?.attrs.signalName, undefined);
  assert.deepEqual(runRules(projectFactsOf(facts)).relations, []);
});

test('pools: message flows to black-box pools named after the partner; every element stays what it is', async () => {
  const models = (await syntheticVariants()).get('pools') ?? [];
  const facts = await extractAll(models);
  const [order, billing] = facts;
  assert.ok(order && billing);
  assert.deepEqual(facts.flatMap((r) => r.warnings), []);
  for (const m of models) assert.deepEqual(await diProblems(m.xml), [], m.key);
  // a/order had no collaboration: one is created around its process.
  assert.deepEqual(order?.processes.map((p) => [p.processId, p.participantName]), [['Process_Order', 'Auftragsabwicklung']]);
  assert.equal(factOf(order, 'Event_Shipped')?.kind, 'msg_throw');
  assert.deepEqual(
    order?.messageFlows.map((f) => [f.from, f.to]),
    [['a/order#Event_Shipped', 'a/order#Participant_Rechnungsstellung']],
  );
  assert.match(models[0]?.xml ?? '', /<bpmn:participant id="Participant_Rechnungsstellung" name="Rechnungsstellung" \/>/);
  assert.equal(factOf(billing, 'Catch_Shipped')?.kind, 'msg_catch');
  assert.equal(factOf(billing, 'Task_Notify')?.kind, 'msg_throw');
  assert.deepEqual(
    billing?.messageFlows.map((f) => [f.from, f.to]).sort(),
    [
      ['b/billing#Participant_Auftragsabwicklung', 'b/billing#Catch_Shipped'],
      ['b/billing#Task_Notify', 'b/billing#Participant_Externer_Partner'],
    ],
  );
  assert.match(models[1]?.xml ?? '', new RegExp(`<bpmn:participant id="Participant_Externer_Partner" name="${UNKNOWN_PARTNER}" />`));
  assert.doesNotMatch(models[1]?.xml ?? '', /KundeBenachrichtigt/);
  // A message flow answers the throw and the catch: no dangling-throw or
  // unmatched-catch, and no key pair; the pair is still a candidate.
  const project = projectFactsOf(facts);
  const rules = runRules(project);
  assert.deepEqual(rules.relations, []);
  assert.deepEqual(rules.findings, []);
  assert.ok(generateCandidates(project).some((c) => c.from === 'a/order#Event_Shipped' && c.to === 'b/billing#Catch_Shipped'));
});

test('pools and tasks: start, boundary and end events, two partners, a reused black-box pool', async () => {
  const variants = await variantsOf(EXCHANGE);
  const pools = variants.get('pools') ?? [];
  const tasks = variants.get('tasks') ?? [];
  const poolFacts = await extractAll(pools);
  const taskFacts = await extractAll(tasks);
  assert.deepEqual([...poolFacts, ...taskFacts].flatMap((r) => r.warnings), []);
  for (const m of [...pools, ...tasks]) assert.deepEqual(await diProblems(m.xml), [], m.key);
  const [hub, lager, shop] = poolFacts;
  assert.ok(hub && lager && shop);

  // x/hub keeps its collaboration; the black-box pool „Lager“ is reused, „Shop“ is added once.
  const hubXml = pools[0]?.xml ?? '';
  assert.deepEqual(
    [...hubXml.matchAll(/<bpmn:participant id="([^"]+)" name="([^"]+)"/g)].map((m) => [m[1], m[2]]),
    [
      ['Participant_Hub', 'Zentrale'],
      ['Participant_Lager', 'Lager'],
      ['Participant_Shop', 'Shop'],
    ],
  );
  assert.deepEqual(
    hub?.messageFlows.map((f) => [f.from, f.to]).sort(),
    [
      ['x/hub#Participant_Shop', 'x/hub#Boundary_Cancel'],
      ['x/hub#Participant_Shop', 'x/hub#Start_Hub'],
      ['x/hub#Task_Ship', 'x/hub#Participant_Lager'],
      ['x/hub#Task_Ship', 'x/hub#Participant_Shop'],
    ],
  );
  assert.deepEqual(
    lager?.messageFlows.map((f) => [f.from, f.to]),
    [['x/lager#Participant_Zentrale', 'x/lager#Receive_Ship']],
  );
  const kinds = (facts: readonly ExtractResult[], ids: Record<string, string[]>) =>
    Object.entries(ids).flatMap(([key, list]) =>
      list.map((id) => `${id}:${factOf(facts.find((r) => r.modelKey === key), id)?.kind}`),
    );
  const endpoints = {
    'x/hub': ['Start_Hub', 'Boundary_Cancel', 'Task_Ship'],
    'x/shop': ['Throw_Order', 'Catch_Ship', 'End_Cancel'],
    'x/lager': ['Receive_Ship'],
  };
  assert.deepEqual(kinds(poolFacts, endpoints), [
    'Start_Hub:msg_catch',
    'Boundary_Cancel:msg_catch',
    'Task_Ship:msg_throw',
    'Throw_Order:msg_throw',
    'Catch_Ship:msg_catch',
    'End_Cancel:msg_throw',
    'Receive_Ship:msg_catch',
  ]);
  // tasks: intermediate events, send and receive tasks become tasks; start, boundary and end events stay.
  assert.deepEqual(kinds(taskFacts, endpoints), [
    'Start_Hub:msg_catch',
    'Boundary_Cancel:msg_catch',
    'Task_Ship:task',
    'Throw_Order:task',
    'Catch_Ship:task',
    'End_Cancel:msg_throw',
    'Receive_Ship:task',
  ]);
  // The message flows stay as they are.
  assert.deepEqual(
    taskFacts.map((r) => r.messageFlows),
    poolFacts.map((r) => r.messageFlows),
  );
  assert.deepEqual(runRules(projectFactsOf(poolFacts)).findings, []);
  // Candidates: pools keeps the throw and the start event pairable; tasks turns the throw into a task.
  const pair = (facts: readonly ExtractResult[]) =>
    generateCandidates(projectFactsOf(facts)).some((c) => c.from === 'x/shop#Throw_Order' && c.to === 'x/hub#Start_Hub');
  assert.equal(pair(poolFacts), true);
  assert.equal(pair(taskFacts), false);
});

test('no-docs removes every documentation; the transforms are deterministic', async () => {
  const variants = await syntheticVariants();
  for (const m of variants.get('no-docs') ?? []) assert.doesNotMatch(m.xml, /documentation/, m.key);
  assert.match(variants.get('tasks')?.[0]?.xml ?? '', /<bpmn:documentation>Nimmt Aufträge an.<\/bpmn:documentation>/);
  const again = await syntheticVariants();
  for (const v of VARIANTS) assert.deepEqual(again.get(v), variants.get(v), v);
});

test('every corpus model: a plain round trip keeps the facts; every variant extracts without warnings, with complete DI and every element id', async () => {
  for (const landscape of ['_sample', 'nordwind-handel', 'stadtwerke-auental']) {
    const models = await loadModels(path.join(CORPUS_DIR, landscape));
    const original = await extractAll(models);
    const contexts = transformContexts(projectFactsOf(original));
    for (const [i, m] of models.entries()) {
      // Counts and model keys only in messages, no values (the holdout's models are checked here too).
      const same = await extractFacts(await roundTrip(m.xml), { modelKey: m.key });
      assert.ok(
        isDeepStrictEqual(
          [same.engine, same.processes, same.facts, same.messageFlows],
          [original[i]?.engine, original[i]?.processes, original[i]?.facts, original[i]?.messageFlows],
        ),
        `${landscape}/${m.key}: the round trip changed facts`,
      );
      const ids = await elementIds(m.xml);
      const out = await transformModel(m.xml, contexts.get(m.key) ?? { callees: {}, messages: {} });
      for (const v of VARIANTS) {
        const r = await extractFacts(out[v], { modelKey: m.key });
        assert.equal(r.warnings.length, 0, `${landscape}/${m.key} (${v}): ${r.warnings.length} extractor warnings`);
        assert.ok(r.engine === null, `${landscape}/${m.key} (${v}): an engine detected`);
        assert.equal((await diProblems(out[v])).length, 0, `${landscape}/${m.key} (${v}): DI problems`);
        const lost = unexpectedlyLost(ids, await elementIds(out[v]), v);
        assert.equal(lost, 0, `${landscape}/${m.key} (${v}): ${lost} element ids lost`);
      }
    }
  }
});

// ------------------------------------------------------------------ holdout

const cellAt = (variant: number, metric: string, value: Cell, anchors: readonly number[] = []): GridCell => ({
  variant,
  metric,
  value,
  anchors,
});

test('redactGrid: counts of 1 to 4 and differences of 1 to 4 to any nested number shown are not shown', () => {
  // A series that goes down and up again: compared with every value shown, not only the last one.
  assert.deepEqual(redactGrid([cellAt(0, 'rules', 20), cellAt(1, 'rules', 10), cellAt(2, 'rules', 16)]), [20, 10, HIDDEN]);
  // One variant's coverage chain: covered and key/lexical 1 apart.
  assert.deepEqual(
    redactGrid([cellAt(0, 'covered', 20), cellAt(0, 'keyLexical', 19), cellAt(0, 'rules', 12)]),
    [20, HIDDEN, 12],
  );
  // Different metrics of different variants are not nested; a count under 5 is „< 5“; anchors; given redactions stay.
  assert.deepEqual(
    redactGrid([
      cellAt(0, 'covered', 20),
      cellAt(1, 'keyLexical', 18),
      cellAt(1, 'rules', 3),
      cellAt(2, 'correct', 8, [10]),
      cellAt(2, 'covered', SMALL),
      cellAt(3, 'found:x', 0, [3]),
    ]),
    [20, 18, SMALL, HIDDEN, SMALL, HIDDEN],
  );
});

interface Fixture {
  covered: number;
  keyLexical: number;
  rules: number;
  accepted: number;
  proposed: number;
  correct: number;
  lexical: number;
  findings: Array<Pick<FindingRow, 'kind' | 'computed' | 'expected' | 'found'>>;
}

function variant(name: VariantResult['variant'], f: Fixture): VariantResult {
  return {
    variant: name,
    warnings: 0,
    engines: { c7: 0, c8: 0, none: 3 },
    processes: 3,
    executableProcesses: 0,
    facts: 30,
    mustLink: { total: 20, covered: f.covered, keyLexical: f.keyLexical, rules: f.rules },
    ruleTier: {
      accepted: f.accepted,
      correct: f.correct,
      precision: f.accepted === 0 ? null : f.correct / f.accepted,
      proposed: f.proposed,
      acceptedUnderTrustPolicy: 0,
    },
    candidates: { total: 100, rule: f.accepted, key: f.proposed, lexical: f.lexical, compatible: 100 - f.accepted - f.proposed - f.lexical },
    claim: { meanBytes: 1000, maxBytes: 2000, maxModel: 'x/y', overBudget: 0 },
    findings: f.findings,
    byType: [
      {
        type: 'call',
        coverage: { total: 3, covered: 3, keyLexical: 3, rules: 3 },
        endpoints: { from: 3, to: 3 },
        candidates: 3,
        ruleAccepted: f.accepted,
        ruleAcceptedCorrect: f.correct,
      },
      {
        type: 'message',
        coverage: { total: 17, covered: f.covered - 3, keyLexical: f.keyLexical - 3, rules: 0 },
        endpoints: { from: 10, to: 10 },
        candidates: 97,
        ruleAccepted: 0,
        ruleAcceptedCorrect: 0,
      },
    ],
  };
}

const finding = (kind: FindingRow['kind'], computed: number, expected: number, found: number) => ({ kind, computed, expected, found });

test('the holdout section keeps aggregates only, nested numbers 0 or at least 5 apart', () => {
  const landscape: LandscapeDescriptive = {
    name: 'holdout',
    split: 'holdout',
    models: 3,
    variants: [
      // key/lexical 2 under its candidate count (7 + 5 + 10); rules equal to the rule-tier relations.
      variant('baseline', {
        covered: 20,
        keyLexical: 20,
        rules: 12,
        accepted: 7,
        proposed: 5,
        correct: 7,
        lexical: 10,
        findings: [finding('unresolved-call', 1, 2, 1), finding('dangling-throw', 6, 6, 6)],
      }),
      // covered 1 under the total; rules 2 under the rule-tier relations; one wrong acceptance.
      variant('engine-stripped', {
        covered: 19,
        keyLexical: 15,
        rules: 13,
        accepted: 7,
        proposed: 8,
        correct: 6,
        lexical: 30,
        findings: [finding('unresolved-call', 2, 2, 1), finding('dangling-throw', 12, 6, 6)],
      }),
      // key/lexical 3 under engine-stripped's; 3 must_link in the rule tier; 3 computed dangling throws not expected.
      variant('descriptive', {
        covered: 12,
        keyLexical: 12,
        rules: 3,
        accepted: 3,
        proposed: 0,
        correct: 3,
        lexical: 30,
        findings: [finding('unresolved-call', 0, 2, 0), finding('dangling-throw', 8, 6, 5)],
      }),
    ],
    byTag: [{ tag: 't', mustLink: 1, covered: [1, 1, 0] }],
  };
  const r = redactDescriptive(landscape);
  assert.ok(r.note);
  assert.equal(r.byTag, undefined);
  assert.deepEqual(
    r.variants.map((v) => [v.mustLink.total, v.mustLink.covered, v.mustLink.keyLexical, v.mustLink.rules]),
    [
      [20, 20, HIDDEN, 12],
      [20, HIDDEN, 15, HIDDEN],
      [20, 12, HIDDEN, SMALL],
    ],
  );
  assert.deepEqual(r.variants.map((v) => v.ruleTier.correct), [7, HIDDEN, SMALL]);
  assert.deepEqual(r.variants.map((v) => v.ruleTier.precision), [1, HIDDEN, SMALL]);
  assert.deepEqual(r.variants.map((v) => v.claim.maxModel), [null, null, null]);
  // Per relation type only the model-derived counts.
  assert.deepEqual(r.variants[0]?.byType, [
    { type: 'call', endpoints: { from: 3, to: 3 }, candidates: 3, ruleAccepted: 7 },
    { type: 'message', endpoints: { from: 10, to: 10 }, candidates: 97, ruleAccepted: 0 },
  ]);
  assert.doesNotMatch(JSON.stringify(r), /x\/y/);
  // Finding kinds under 5 expected show „< 5“; found against expected, computed and the other variants.
  assert.deepEqual(
    r.variants.map((v) => v.findings.map((f) => [f.kind, f.expected, f.found])),
    [
      [
        ['unresolved-call', SMALL, SMALL],
        ['dangling-throw', 6, 6],
      ],
      [
        ['unresolved-call', SMALL, SMALL],
        ['dangling-throw', 6, 6],
      ],
      [
        ['unresolved-call', SMALL, SMALL],
        ['dangling-throw', 6, HIDDEN],
      ],
    ],
  );
  assert.equal(nestedViolations(r), 0);
  // A dev landscape is not redacted.
  assert.deepEqual(redactDescriptive({ ...landscape, split: 'dev' }), { ...landscape, split: 'dev' });
});

/**
 * Pairs of numbers a holdout section shows that differ by 1 to 4 although
 * nested (HOLDOUT_NOTE), plus shown ground-truth counts of 1 to 4: 0 when the
 * redaction holds. Written apart from redactGrid, over the redacted output.
 */
function nestedViolations(l: LandscapeDescriptive): number {
  let n = 0;
  const check = (a: Cell, b: Cell): void => {
    if (typeof a === 'number' && typeof b === 'number' && a !== b && Math.abs(a - b) < 5) n++;
  };
  const vs = l.variants;
  for (const v of vs) {
    const chain: Cell[] = [v.mustLink.total, v.mustLink.covered, v.mustLink.keyLexical, v.mustLink.rules];
    for (const [i, a] of chain.entries()) {
      check(a, 0);
      for (const b of chain.slice(i + 1)) check(a, b);
    }
    check(v.mustLink.covered, v.candidates.total);
    check(v.mustLink.keyLexical, v.candidates.rule + v.candidates.key + v.candidates.lexical);
    check(v.mustLink.rules, v.ruleTier.accepted + v.ruleTier.proposed);
    if (v.ruleTier.accepted > 0) {
      check(v.ruleTier.correct, 0);
      check(v.ruleTier.correct, v.ruleTier.accepted);
    }
    for (const f of v.findings) {
      check(f.expected, 0);
      check(f.found, 0);
      check(f.found, f.expected);
      check(f.found, f.computed);
    }
  }
  for (const [i, a] of vs.entries()) {
    for (const b of vs.slice(i + 1)) {
      check(a.mustLink.covered, b.mustLink.covered);
      check(a.mustLink.keyLexical, b.mustLink.keyLexical);
      check(a.mustLink.rules, b.mustLink.rules);
      if (a.ruleTier.accepted > 0 && b.ruleTier.accepted > 0) check(a.ruleTier.correct, b.ruleTier.correct);
      for (const f of a.findings) check(f.found, b.findings.find((g) => g.kind === f.kind)?.found ?? SMALL);
    }
  }
  return n;
}

test('the real holdout section: aggregates only, nested numbers 0 or at least 5 apart (PASS/FAIL only)', async () => {
  const report = await evaluateDescriptive(['stadtwerke-auental']);
  const [holdout] = report.landscapes;
  assert.ok(holdout?.split === 'holdout' && holdout.note !== undefined, 'the holdout is redacted');
  assert.ok(holdout.byTag === undefined, 'no tags');
  assert.ok(holdout.variants.every((v) => v.claim.maxModel === null), 'no model names');
  assert.ok(holdout.variants.every((v) => v.byType.every((t) => t.coverage === undefined && t.ruleAcceptedCorrect === undefined)), 'no ground truth per type');
  const violations = nestedViolations(holdout);
  assert.ok(violations === 0, `${violations} nested pairs 1 to 4 apart`);
});

test('the report is deterministic', async () => {
  const first = await evaluateDescriptive(['nordwind-handel']);
  const second = await evaluateDescriptive(['nordwind-handel']);
  assert.equal(JSON.stringify(second), JSON.stringify(first));
  assert.equal(renderDescriptiveMarkdown(second), renderDescriptiveMarkdown(first));
  const [dev] = first.landscapes;
  assert.deepEqual(dev?.variants.map((v) => v.variant), ['baseline', ...VARIANTS]);
  // The baseline is eval:candidates' landscape: same coverage and acceptances.
  assert.equal(dev?.variants[0]?.mustLink.covered, dev?.variants[0]?.mustLink.total);
  assert.equal(dev?.variants[0]?.ruleTier.precision, 1);
  assert.equal(dev?.variants[1]?.ruleTier.acceptedUnderTrustPolicy, 0);
});

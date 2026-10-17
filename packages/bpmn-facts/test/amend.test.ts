// Model amendments (M6 §4.8 c, S5c-2): byte-preserving splices of the fields
// open questions name, checked by extracting the result again. Regression
// snapshots pin what applyAmendments writes on hand-written C7 and C8
// fixtures in the Camunda Modeler's layout (not Modeler saves, S5c-2 as
// delivered), and a dependency-free check of the BPMN XSD's child order
// (`support/xsd-order.ts`) runs over them and over every corpus model; a
// Signavio-style export pins that every byte outside the spliced ranges
// stays, BOM and CRLF included.
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AMENDMENT_VALUE_LIMITS,
  BpmnInputError,
  applyAmendments,
  escapeXmlValue,
  extractFacts,
  isAmendmentExpression,
  normalizeAmendmentValue,
  readAmendable,
} from '../src/index.ts';
import type {
  AmendResult,
  Amendment,
  AmendmentOp,
  AmendmentRefusalReason,
  ExtractResult,
} from '../src/index.ts';

import { BPMN_NS, MODEL_KEY, definitions, expectValid, factOf, model } from './support/bpmn.ts';
import { xsdOrderViolations } from './support/xsd-order.ts';

const FIXTURES = fileURLToPath(new URL('./fixtures/amend/', import.meta.url));
const CORPUS = fileURLToPath(new URL('../../../eval/corpus/', import.meta.url));
const OPTS = { modelKey: MODEL_KEY };
const ZEEBE_NS = 'http://camunda.org/schema/zeebe/1.0';

/** UTF-8 text with a BOM kept as U+FEFF, so byte comparisons see it. */
const decode = (bytes: Uint8Array): string =>
  new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);

async function fixture(name: string): Promise<Buffer> {
  return readFile(path.join(FIXTURES, name));
}

function amendment(elementId: string, op: AmendmentOp, after: string, id?: string): Amendment {
  return { id: id ?? `mam_${op}_${elementId}`, elementId, op, after };
}

/** `Message_` / `Signal_` + 8 hex of sha256(amendment id). */
function createdId(kind: 'Message' | 'Signal', amendmentId: string): string {
  return `${kind}_${createHash('sha256').update(amendmentId, 'utf8').digest('hex').slice(0, 8)}`;
}

/** Applies amendments that must all apply; returns the text and its facts. */
async function applied(
  xml: string | Uint8Array,
  amendments: Amendment[],
): Promise<{ text: string; result: AmendResult }> {
  const result = await applyAmendments(xml, amendments, OPTS);
  expect(result.outcomes.filter((o) => o.status !== 'applied')).toEqual([]);
  expectValid(result.extraction);
  expect(await extractFacts(result.xml, OPTS)).toEqual(result.extraction);
  return { text: decode(result.xml), result };
}

/** Applies one amendment that must be refused; nothing is written. */
async function refused(
  xml: string | Uint8Array,
  a: Amendment,
  reason: AmendmentRefusalReason,
): Promise<string> {
  const result = await applyAmendments(xml, [a], OPTS);
  const [outcome] = result.outcomes;
  expect(outcome).toMatchObject({ id: a.id, status: 'refused', reason });
  const input = typeof xml === 'string' ? new TextEncoder().encode(xml) : xml;
  expect(Buffer.from(result.xml).equals(Buffer.from(input))).toBe(true);
  return outcome?.status === 'refused' ? outcome.message : '';
}

/** `input` with each `[from, to]` replaced; every `from` must occur exactly once. */
function edit(input: string, edits: ReadonlyArray<readonly [string, string]>): string {
  let out = input;
  for (const [from, to] of edits) {
    expect(out.split(from).length - 1, `occurrences of ${JSON.stringify(from)}`).toBe(1);
    out = out.replace(from, () => to);
  }
  return out;
}

function fact(result: ExtractResult, kind: Parameters<typeof factOf>[1], id: string) {
  return factOf(result, kind, id);
}

// ------------------------------------------------------------------ values

describe('normalizeAmendmentValue', () => {
  it('stores names and targets as sanitized single lines, documentation as a block', () => {
    expect(normalizeAmendmentValue('event-name', '  Auftrag \r\n  eingegangen\t')).toEqual({
      ok: true,
      value: 'Auftrag eingegangen',
    });
    expect(normalizeAmendmentValue('call-target', ' Process_A ')).toEqual({
      ok: true,
      value: 'Process_A',
    });
    expect(
      normalizeAmendmentValue('process-documentation', 'Erste  Zeile\r\n\r\n\r\n‮Zweite'),
    ).toEqual({ ok: true, value: 'Erste Zeile\n\nZweite' });
  });

  it('refuses empty, too long, expression and non-XML values, never cuts them', () => {
    expect(normalizeAmendmentValue('message-name', ' ‎\t')).toEqual({
      ok: false,
      problem: 'empty',
    });
    for (const op of [
      'call-target',
      'message-name',
      'event-name',
      'process-documentation',
    ] as const) {
      const max = AMENDMENT_VALUE_LIMITS[op];
      expect(normalizeAmendmentValue(op, 'x'.repeat(max)).ok).toBe(true);
      expect(normalizeAmendmentValue(op, 'x'.repeat(max + 1))).toEqual({
        ok: false,
        problem: 'too-long',
      });
    }
    expect(AMENDMENT_VALUE_LIMITS).toEqual({
      'call-target': 1000,
      'message-name': 1000,
      'event-name': 200,
      'process-documentation': 2000,
    });
    for (const value of ['=ziel', ' = ziel', '${ziel}', 'a#{b}']) {
      expect(isAmendmentExpression(value)).toBe(true);
      expect(normalizeAmendmentValue('call-target', value)).toEqual({
        ok: false,
        problem: 'expression',
      });
      expect(normalizeAmendmentValue('message-name', value)).toEqual({
        ok: false,
        problem: 'expression',
      });
    }
    expect(normalizeAmendmentValue('event-name', '=Beginn').ok).toBe(true);
    expect(normalizeAmendmentValue('event-name', 'a￿b')).toEqual({
      ok: false,
      problem: 'invalid-character',
    });
    expect(normalizeAmendmentValue('message-name', 'a\uD800b')).toEqual({
      ok: false,
      problem: 'invalid-character',
    });
    expect(normalizeAmendmentValue('message-name', 'a\u{1F600}b').ok).toBe(true);
  });

  it('escapes &, <, >, ", tab and line breaks as references', () => {
    expect(escapeXmlValue('a & b < c > d " e \' f\tg\nh\ri')).toBe(
      "a &amp; b &lt; c &gt; d &quot; e ' f&#9;g&#10;h&#13;i",
    );
    expect(escapeXmlValue("it's", "'")).toBe('it&apos;s');
  });
});

// --------------------------------------------------------------------- C7

describe('Camunda 7', () => {
  it('sets a missing calledElement', async () => {
    const input = await fixture('c7-modeler.bpmn');
    const { text, result } = await applied(input, [
      amendment('Call_Rechnung', 'call-target', 'Process_Rechnung'),
    ]);
    expect(text).toBe(
      edit(decode(input), [
        [
          '<bpmn:callActivity id="Call_Rechnung" name="Rechnung stellen">',
          '<bpmn:callActivity id="Call_Rechnung" name="Rechnung stellen" calledElement="Process_Rechnung">',
        ],
      ]),
    );
    expect(fact(result.extraction, 'call', 'Call_Rechnung')).toMatchObject({
      keyRaw: 'Process_Rechnung',
      keyNorm: 'process rechnung',
    });
    expect(result.extraction.warnings.map((w) => w.elementId)).toEqual(['Call_Fall']);
  });

  it('replaces a calledElement and keeps the extension elements', async () => {
    const input = await fixture('c7-modeler.bpmn');
    const { text, result } = await applied(input, [
      amendment('Call_Versand', 'call-target', 'Process_Versand'),
    ]);
    expect(text).toBe(
      edit(decode(input), [
        ['calledElement="Process_Versand_Alt"', 'calledElement="Process_Versand"'],
      ]),
    );
    expect(fact(result.extraction, 'call', 'Call_Versand').keyRaw).toBe('Process_Versand');
  });

  it('refuses a call of a CMMN case', async () => {
    const input = await fixture('c7-modeler.bpmn');
    await refused(input, amendment('Call_Fall', 'call-target', 'Process_X'), 'cmmn-call');
  });

  it('regression snapshot: every operation at once, in the XSD child order', async () => {
    const input = await fixture('c7-modeler.bpmn');
    expect(xsdOrderViolations(decode(input))).toEqual([]);
    const { result } = await applied(input, [
      amendment('Call_Rechnung', 'call-target', 'Process_Rechnung', 'mam_c7_1'),
      amendment('Call_Versand', 'call-target', 'Process_Versand', 'mam_c7_2'),
      amendment('Event_Bestaetigung', 'message-name', 'Auftragsbestätigung', 'mam_c7_3'),
      amendment('StartEvent_1', 'event-name', 'Auftrag eingegangen', 'mam_c7_4'),
      amendment('EndEvent_1', 'event-name', 'Auftrag abgeschlossen', 'mam_c7_5'),
      amendment(
        'Process_Auftrag',
        'process-documentation',
        'Vom Auftragseingang bis zur Zahlung.',
        'mam_c7_6',
      ),
    ]);
    const golden = await fixture('c7-modeler.amended.bpmn');
    expect(decode(result.xml)).toBe(decode(golden));
    expect(Buffer.from(result.xml).equals(golden)).toBe(true);
    expect(xsdOrderViolations(decode(result.xml))).toEqual([]);
  });
});

// --------------------------------------------------------------------- C8

describe('Camunda 8', () => {
  it('replaces the processId of zeebe:calledElement', async () => {
    const input = await fixture('c8-modeler.bpmn');
    const { text, result } = await applied(input, [
      amendment('Call_D', 'call-target', 'Process_D'),
    ]);
    expect(text).toBe(edit(decode(input), [['processId="Process_Alt"', 'processId="Process_D"']]));
    expect(fact(result.extraction, 'call', 'Call_D').keyRaw).toBe('Process_D');
  });

  it('inserts extensionElements as the first child without documentation', async () => {
    const input = await fixture('c8-modeler.bpmn');
    const { text } = await applied(input, [amendment('Call_A', 'call-target', 'Process_A')]);
    expect(text).toBe(
      edit(decode(input), [
        [
          '<bpmn:callActivity id="Call_A" name="Ohne Erweiterung">\n',
          '<bpmn:callActivity id="Call_A" name="Ohne Erweiterung">\n' +
            '      <bpmn:extensionElements>\n' +
            '        <zeebe:calledElement processId="Process_A" />\n' +
            '      </bpmn:extensionElements>\n',
        ],
      ]),
    );
  });

  it('inserts extensionElements right after the last documentation', async () => {
    const input = await fixture('c8-modeler.bpmn');
    const { text } = await applied(input, [amendment('Call_B', 'call-target', 'Process_B')]);
    expect(text).toBe(
      edit(decode(input), [
        [
          '<bpmn:documentation>Prüft die Lieferung.</bpmn:documentation>\n',
          '<bpmn:documentation>Prüft die Lieferung.</bpmn:documentation>\n' +
            '      <bpmn:extensionElements>\n' +
            '        <zeebe:calledElement processId="Process_B" />\n' +
            '      </bpmn:extensionElements>\n',
        ],
      ]),
    );
  });

  it('appends zeebe:calledElement to existing extensionElements', async () => {
    const input = await fixture('c8-modeler.bpmn');
    const { text } = await applied(input, [amendment('Call_C', 'call-target', 'Process_C')]);
    expect(text).toBe(
      edit(decode(input), [
        [
          '        </zeebe:ioMapping>\n',
          '        </zeebe:ioMapping>\n        <zeebe:calledElement processId="Process_C" />\n',
        ],
      ]),
    );
  });

  it('expands a self-closing start tag', async () => {
    const input = await fixture('c8-modeler.bpmn');
    const { text } = await applied(input, [amendment('Call_E', 'call-target', 'Process_E')]);
    expect(text).toBe(
      edit(decode(input), [
        [
          '<bpmn:callActivity id="Call_E" name="Nicht verbunden" />',
          '<bpmn:callActivity id="Call_E" name="Nicht verbunden">\n' +
            '      <bpmn:extensionElements>\n' +
            '        <zeebe:calledElement processId="Process_E" />\n' +
            '      </bpmn:extensionElements>\n' +
            '    </bpmn:callActivity>',
        ],
      ]),
    );
  });

  it('declares xmlns:zeebe on the new element when the root has none', async () => {
    const xml = definitions(
      'none',
      '<bpmn:process id="Process_1" isExecutable="true">\n' +
        '  <bpmn:callActivity id="Call_A" name="A" />\n' +
        '</bpmn:process>',
    ).replace(
      ' id="Definitions_1"',
      ' modeler:executionPlatform="Camunda Cloud" id="Definitions_1"',
    );
    expect((await extractFacts(xml, OPTS)).engine).toBe('c8');
    const { text, result } = await applied(xml, [amendment('Call_A', 'call-target', 'Process_Z')]);
    expect(text).toBe(
      edit(xml, [
        [
          '<bpmn:callActivity id="Call_A" name="A" />',
          '<bpmn:callActivity id="Call_A" name="A">\n' +
            '    <bpmn:extensionElements>\n' +
            `      <zeebe:calledElement xmlns:zeebe="${ZEEBE_NS}" processId="Process_Z" />\n` +
            '    </bpmn:extensionElements>\n' +
            '  </bpmn:callActivity>',
        ],
      ]),
    );
    expect(fact(result.extraction, 'call', 'Call_A').keyRaw).toBe('Process_Z');
  });

  it("uses the root's prefix for the Zeebe namespace", async () => {
    const xml = definitions(
      'c8',
      '<bpmn:process id="Process_1" isExecutable="true"><bpmn:callActivity id="Call_A" /></bpmn:process>',
    ).replace('xmlns:zeebe=', 'xmlns:z=');
    const { text } = await applied(xml, [amendment('Call_A', 'call-target', 'Process_Z')]);
    expect(text).toContain(
      '<bpmn:callActivity id="Call_A"><bpmn:extensionElements><z:calledElement processId="Process_Z" /></bpmn:extensionElements></bpmn:callActivity>',
    );
  });

  it('regression snapshot: every operation at once, in the XSD child order', async () => {
    const input = await fixture('c8-modeler.bpmn');
    expect(xsdOrderViolations(decode(input))).toEqual([]);
    const { result } = await applied(input, [
      amendment('Call_A', 'call-target', 'Process_A', 'mam_c8_1'),
      amendment('Call_B', 'call-target', 'Process_B', 'mam_c8_2'),
      amendment('Call_C', 'call-target', 'Process_C', 'mam_c8_3'),
      amendment('Call_D', 'call-target', 'Process_D', 'mam_c8_4'),
      amendment('Call_E', 'call-target', 'Process_E', 'mam_c8_5'),
      amendment('End_Meldung', 'message-name', 'Wareneingang gemeldet', 'mam_c8_6'),
      amendment('StartEvent_1', 'event-name', 'Lieferung eingetroffen', 'mam_c8_7'),
      amendment('EndEvent_1', 'event-name', 'Ohne Folge', 'mam_c8_8'),
      amendment(
        'Process_Lager',
        'process-documentation',
        'Nimmt Lieferungen an\nund prüft sie.',
        'mam_c8_9',
      ),
    ]);
    const golden = await fixture('c8-modeler.amended.bpmn');
    expect(decode(result.xml)).toBe(decode(golden));
    expect(xsdOrderViolations(decode(result.xml))).toEqual([]);
    expect(fact(result.extraction, 'process', 'Process_Lager').attrs.documentation).toBe(
      'Nimmt Lieferungen an\nund prüft sie.',
    );
    expect(fact(result.extraction, 'msg_throw', 'End_Meldung')).toMatchObject({
      keyRaw: 'Wareneingang gemeldet',
      attrs: { messageName: 'Wareneingang gemeldet' },
    });
  });
});

// ------------------------------------------------------------ engine null

describe('without an engine', () => {
  it('writes the calledElement attribute when there is no Zeebe extension', async () => {
    const xml = model('none', '<bpmn:callActivity id="Call_A" name="A" />');
    const { text, result } = await applied(xml, [amendment('Call_A', 'call-target', 'Process_A')]);
    expect(text).toBe(
      edit(xml, [['id="Call_A" name="A" />', 'id="Call_A" name="A" calledElement="Process_A" />']]),
    );
    expect(result.extraction.engine).toBeNull();
    expect(fact(result.extraction, 'call', 'Call_A').keyRaw).toBe('Process_A');
  });

  it('writes the Zeebe extension where the element has one, as Extraction.call reads it', async () => {
    // Both namespaces and no execution platform: engine null, the zeebe extension wins.
    const xml = definitions(
      'none',
      `<bpmn:process id="Process_1" isExecutable="true">
  <bpmn:callActivity id="Call_A" name="A" calledElement="Process_Attr">
    <bpmn:extensionElements>
      <zeebe:calledElement processId="Process_Old" />
    </bpmn:extensionElements>
  </bpmn:callActivity>
</bpmn:process>`,
    ).replace(
      ' id="Definitions_1"',
      ` xmlns:camunda="http://camunda.org/schema/1.0/bpmn" xmlns:zeebe="${ZEEBE_NS}" id="Definitions_1"`,
    );
    const before = await extractFacts(xml, OPTS);
    expect(before.engine).toBeNull();
    expect(fact(before, 'call', 'Call_A').keyRaw).toBe('Process_Old');
    const { text, result } = await applied(xml, [
      amendment('Call_A', 'call-target', 'Process_New'),
    ]);
    expect(text).toBe(edit(xml, [['processId="Process_Old"', 'processId="Process_New"']]));
    expect(fact(result.extraction, 'call', 'Call_A').keyRaw).toBe('Process_New');
  });

  it('writes a Zeebe extension the namespace detection missed (matched by local name)', async () => {
    const xml = model(
      'none',
      `<bpmn:callActivity id="Call_A">
  <bpmn:extensionElements>
    <zeebe:calledElement xmlns:zeebe="${ZEEBE_NS}" processId="Process_Old" />
  </bpmn:extensionElements>
</bpmn:callActivity>`,
    );
    expect(fact(await extractFacts(xml, OPTS), 'call', 'Call_A').keyRaw).toBe('Process_Old');
    const { text } = await applied(xml, [amendment('Call_A', 'call-target', 'Process_New')]);
    expect(text).toBe(edit(xml, [['processId="Process_Old"', 'processId="Process_New"']]));
  });

  it('refuses an engine-null calledElement="=x", which the facts read as a static call', async () => {
    const xml = model('none', '<bpmn:callActivity id="Call_A" calledElement="=ziel" />');
    expect(fact(await extractFacts(xml, OPTS), 'call', 'Call_A').attrs.dynamic).toBe(false);
    await refused(xml, amendment('Call_A', 'call-target', 'Process_A'), 'expression');
  });
});

// ------------------------------------------------------ messages and signals

const SHARED = definitions(
  'c7',
  `<bpmn:collaboration id="Collaboration_1">
    <bpmn:participant id="Participant_A" name="Vertrieb" processRef="Process_1" />
    <bpmn:participant id="Participant_Kunde" name="Kunde" />
    <bpmn:messageFlow id="Flow_Unnamed" sourceRef="Event_Send" targetRef="Participant_Kunde" messageRef="Message_Shared" />
    <bpmn:messageFlow id="Flow_Named" name="Antwort" sourceRef="Participant_Kunde" targetRef="Task_Receive" messageRef="Message_Shared" />
  </bpmn:collaboration>
  <bpmn:process id="Process_1" name="Vertrieb" isExecutable="true">
    <bpmn:intermediateThrowEvent id="Event_Send" name="Senden">
      <bpmn:messageEventDefinition id="Def_Send" messageRef="Message_Shared" />
    </bpmn:intermediateThrowEvent>
    <bpmn:receiveTask id="Task_Receive" name="Empfangen" messageRef="Message_Shared" />
    <bpmn:sendTask id="Task_Unreferenced" name="Melden" />
    <bpmn:intermediateThrowEvent id="Signal_Throw" name="Alarm auslösen">
      <bpmn:signalEventDefinition id="Def_Signal" signalRef="Signal_Alarm" />
    </bpmn:intermediateThrowEvent>
    <bpmn:intermediateCatchEvent id="Signal_Catch" name="Alarm abwarten">
      <bpmn:signalEventDefinition id="Def_Signal_Catch" />
    </bpmn:intermediateCatchEvent>
  </bpmn:process>
  <bpmn:message id="Message_Shared" name="Bestellung" />
  <bpmn:signal id="Signal_Alarm" name="Alarm" />
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Collaboration_1" />
  </bpmndi:BPMNDiagram>`,
);

describe('message and signal names', () => {
  it('lists the readers of a shared message and the endpoints that reference it', async () => {
    const doc = await readAmendable(SHARED, OPTS);
    expect(doc.fields.find((f) => f.elementId === 'Message_Shared')).toEqual({
      elementId: 'Message_Shared',
      op: 'message-name',
      element: 'message',
      processId: null,
      value: 'Bestellung',
      expression: false,
      readers: ['Event_Send', 'Flow_Named', 'Flow_Unnamed', 'Task_Receive'],
      blocked: null,
    });
    expect(doc.endpoints.filter((e) => e.reference === 'Message_Shared')).toEqual([
      {
        elementId: 'Event_Send',
        kind: 'msg_throw',
        processId: 'Process_1',
        reference: 'Message_Shared',
        name: 'Bestellung',
        expression: false,
        amendmentElementId: 'Message_Shared',
      },
      {
        elementId: 'Task_Receive',
        kind: 'msg_catch',
        processId: 'Process_1',
        reference: 'Message_Shared',
        name: 'Bestellung',
        expression: false,
        amendmentElementId: 'Message_Shared',
      },
    ]);
  });

  it('renames a shared message: every reader changes in its message name and what derives from it', async () => {
    const before = await extractFacts(SHARED, OPTS);
    const { text, result } = await applied(SHARED, [
      amendment('Message_Shared', 'message-name', 'Auftrag'),
    ]);
    expect(text).toBe(
      edit(SHARED, [
        [
          '<bpmn:message id="Message_Shared" name="Bestellung" />',
          '<bpmn:message id="Message_Shared" name="Auftrag" />',
        ],
      ]),
    );
    const after = result.extraction;
    for (const [kind, id] of [
      ['msg_throw', 'Event_Send'],
      ['msg_catch', 'Task_Receive'],
    ] as const) {
      expect(fact(after, kind, id)).toMatchObject({
        keyRaw: 'Auftrag',
        keyNorm: 'auftrag',
        label: fact(before, kind, id).label,
        attrs: { messageName: 'Auftrag', dynamic: false },
      });
      expect(fact(after, kind, id).fingerprint).not.toBe(fact(before, kind, id).fingerprint);
    }
    expect(fact(after, 'message_flow', 'Flow_Unnamed')).toMatchObject({
      keyRaw: 'Auftrag',
      attrs: { messageName: 'Auftrag' },
    });
    expect(fact(after, 'message_flow', 'Flow_Named')).toMatchObject({
      keyRaw: 'Antwort',
      attrs: { messageName: 'Auftrag' },
    });
    expect(after.messageFlows.map((f) => f.messageName)).toEqual(['Auftrag', 'Auftrag']);
    const untouched = (r: ExtractResult) =>
      r.facts.filter(
        (f) => !['Event_Send', 'Task_Receive', 'Flow_Unnamed', 'Flow_Named'].includes(f.elementId),
      );
    expect(untouched(after)).toEqual(untouched(before));
  });

  it('creates a message with its messageRef for an endpoint without a reference', async () => {
    const a = amendment('Task_Unreferenced', 'message-name', 'Meldung', 'mam_create');
    const id = createdId('Message', 'mam_create');
    const { text, result } = await applied(SHARED, [a]);
    expect(text).toBe(
      edit(SHARED, [
        [
          '<bpmn:sendTask id="Task_Unreferenced" name="Melden" />',
          `<bpmn:sendTask id="Task_Unreferenced" name="Melden" messageRef="${id}" />`,
        ],
        [
          '<bpmn:signal id="Signal_Alarm" name="Alarm" />\n',
          `<bpmn:signal id="Signal_Alarm" name="Alarm" />\n  <bpmn:message id="${id}" name="Meldung" />\n`,
        ],
      ]),
    );
    expect(fact(result.extraction, 'msg_throw', 'Task_Unreferenced')).toMatchObject({
      keyRaw: 'Meldung',
      label: 'Melden',
      attrs: { messageName: 'Meldung' },
    });
  });

  it('suffixes the new id with _2, _3 … when the file already uses it', async () => {
    const id = createdId('Message', 'mam_create');
    const xml = SHARED.replace(
      '<bpmn:signal id="Signal_Alarm" name="Alarm" />',
      `<bpmn:signal id="Signal_Alarm" name="Alarm" />\n  <bpmn:message id="${id}" name="Belegt" />\n  <bpmn:message id="${id}_2" />`,
    );
    const { text } = await applied(xml, [
      amendment('Task_Unreferenced', 'message-name', 'Meldung', 'mam_create'),
    ]);
    expect(text).toContain(`messageRef="${id}_3"`);
    expect(text).toContain(`<bpmn:message id="${id}_3" name="Meldung" />`);
  });

  it('renames a signal and creates one for a signal endpoint without a reference', async () => {
    const id = createdId('Signal', 'mam_signal');
    const { text, result } = await applied(SHARED, [
      amendment('Signal_Alarm', 'message-name', 'Feueralarm'),
      amendment('Signal_Catch', 'message-name', 'Entwarnung', 'mam_signal'),
    ]);
    expect(text).toBe(
      edit(SHARED, [
        [
          '<bpmn:signalEventDefinition id="Def_Signal_Catch" />',
          `<bpmn:signalEventDefinition id="Def_Signal_Catch" signalRef="${id}" />`,
        ],
        [
          '<bpmn:signal id="Signal_Alarm" name="Alarm" />\n',
          `<bpmn:signal id="Signal_Alarm" name="Feueralarm" />\n  <bpmn:signal id="${id}" name="Entwarnung" />\n`,
        ],
      ]),
    );
    expect(fact(result.extraction, 'sig_throw', 'Signal_Throw')).toMatchObject({
      keyRaw: 'Feueralarm',
      attrs: { signalName: 'Feueralarm' },
    });
    expect(fact(result.extraction, 'sig_catch', 'Signal_Catch')).toMatchObject({
      keyRaw: 'Entwarnung',
      attrs: { signalName: 'Entwarnung' },
    });
  });

  it('refuses an endpoint that references a message: the message is amended', async () => {
    const message = await refused(
      SHARED,
      amendment('Event_Send', 'message-name', 'Auftrag'),
      'wrong-element',
    );
    expect(message).toContain('Message_Shared');
  });

  it('refuses a name over an expression', async () => {
    const xml = SHARED.replace('name="Bestellung"', 'name="${bestellung}"');
    await refused(xml, amendment('Message_Shared', 'message-name', 'Auftrag'), 'expression');
  });

  it('refuses a reference that does not resolve and an ambiguous event', async () => {
    const dangling = SHARED.replace(
      '<bpmn:sendTask id="Task_Unreferenced" name="Melden" />',
      '<bpmn:sendTask id="Task_Unreferenced" name="Melden" messageRef="Message_Missing" />',
    );
    await refused(
      dangling,
      amendment('Task_Unreferenced', 'message-name', 'Meldung'),
      'unsupported-structure',
    );
    const both = model(
      'c7',
      `<bpmn:intermediateCatchEvent id="Event_Both">
  <bpmn:messageEventDefinition id="Def_M" />
  <bpmn:signalEventDefinition id="Def_S" />
</bpmn:intermediateCatchEvent>`,
    );
    await refused(both, amendment('Event_Both', 'message-name', 'X'), 'unsupported-structure');
  });
});

// ------------------------------------------------- events and documentation

describe('start and end names, process documentation', () => {
  it('sets a start name and replaces an end name', async () => {
    const xml = model(
      'c8',
      '<bpmn:startEvent id="Start_1" />\n<bpmn:endEvent id="End_1" name="Fertig" />',
    );
    const { text, result } = await applied(xml, [
      amendment('Start_1', 'event-name', 'Auftrag eingegangen'),
      amendment('End_1', 'event-name', 'Auftrag erledigt'),
    ]);
    expect(text).toBe(
      edit(xml, [
        [
          '<bpmn:startEvent id="Start_1" />',
          '<bpmn:startEvent id="Start_1" name="Auftrag eingegangen" />',
        ],
        ['name="Fertig"', 'name="Auftrag erledigt"'],
      ]),
    );
    expect(fact(result.extraction, 'evt_start', 'Start_1')).toMatchObject({
      label: 'Auftrag eingegangen',
      keyRaw: 'Auftrag eingegangen',
      keyNorm: 'auftrag eingegangen',
    });
    expect(fact(result.extraction, 'evt_end', 'End_1').label).toBe('Auftrag erledigt');
  });

  it('refuses event-name on a start event that is no evt_start fact', async () => {
    const xml = model(
      'c7',
      '<bpmn:startEvent id="Start_M"><bpmn:messageEventDefinition id="D" /></bpmn:startEvent>',
    );
    await refused(xml, amendment('Start_M', 'event-name', 'X'), 'wrong-element');
  });

  it('inserts documentation as the first child, before lanes and flow elements', async () => {
    const xml = definitions(
      'c7',
      `  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_1" name="Buchhaltung" />
    </bpmn:laneSet>
    <bpmn:task id="Task_1" name="Prüfen" />
  </bpmn:process>
  <bpmn:process id="Process_Empty" isExecutable="false" />
  <bpmn:process id="Process_Hollow" isExecutable="false">
  </bpmn:process>`,
    );
    const { text, result } = await applied(xml, [
      amendment('Process_1', 'process-documentation', 'Prüft Rechnungen.'),
      amendment('Process_Empty', 'process-documentation', 'Leer.'),
      amendment('Process_Hollow', 'process-documentation', 'Hohl.'),
    ]);
    expect(text).toBe(
      edit(xml, [
        [
          '<bpmn:process id="Process_1" isExecutable="true">\n',
          '<bpmn:process id="Process_1" isExecutable="true">\n    <bpmn:documentation>Prüft Rechnungen.</bpmn:documentation>\n',
        ],
        [
          '<bpmn:process id="Process_Empty" isExecutable="false" />',
          '<bpmn:process id="Process_Empty" isExecutable="false">\n    <bpmn:documentation>Leer.</bpmn:documentation>\n  </bpmn:process>',
        ],
        [
          '<bpmn:process id="Process_Hollow" isExecutable="false">\n  </bpmn:process>',
          '<bpmn:process id="Process_Hollow" isExecutable="false">\n    <bpmn:documentation>Hohl.</bpmn:documentation>\n  </bpmn:process>',
        ],
      ]),
    );
    expect(fact(result.extraction, 'process', 'Process_1').attrs.documentation).toBe(
      'Prüft Rechnungen.',
    );
    expect(fact(result.extraction, 'lane', 'Lane_1').attrs.documentation).toBeUndefined();
  });

  it('never replaces the documentation of a process', async () => {
    const xml = definitions(
      'c7',
      '<bpmn:process id="Process_1"><bpmn:documentation>Vorhanden.</bpmn:documentation></bpmn:process>',
    );
    await refused(
      xml,
      amendment('Process_1', 'process-documentation', 'Neu.'),
      'has-documentation',
    );
  });
});

// ---------------------------------------------------------- Signavio-style

describe('a Signavio-style export (default namespace, vendor extensions)', () => {
  const CALL = 'sid-718091A3-B4C5-46D7-98F9-1A2B3C4D5E19';
  const SEND = 'sid-607F8192-A3B4-45C6-87E8-091A2B3C4D18';
  const MESSAGE = 'sid-E8F7081A-2B3C-4D4E-8F60-8192A3B4C526';
  const END = 'sid-8291A2B4-C5D6-47E8-890A-2B3C4D5E6F20';
  const PROCESS = 'sid-C8B7D9E0-F1A2-4B3C-8D4E-6F7A8B9C0D08';
  const amendments = [
    amendment(CALL, 'call-target', 'Process_Rechnungsstellung', 'mam_sig_1'),
    amendment(SEND, 'message-name', 'Auftragsbestätigung', 'mam_sig_2'),
    amendment(MESSAGE, 'message-name', 'Kundenauftrag', 'mam_sig_3'),
    amendment(END, 'event-name', 'Auftrag erledigt', 'mam_sig_4'),
  ];
  const created = createdId('Message', 'mam_sig_2');

  /** The input with exactly the four splices, every other byte as it was. */
  function expected(input: string, nl: string): string {
    return edit(input, [
      [
        'calledElement="sid-4A5B6C7D-8E9F-4A0B-9C1D-2E3F4A5B6C30"',
        'calledElement="Process_Rechnungsstellung"',
      ],
      [
        'name="Auftragsbestätigung senden" startQuantity="1">',
        `name="Auftragsbestätigung senden" startQuantity="1" messageRef="${created}">`,
      ],
      [
        `<message id="${MESSAGE}" name="Auftrag"/>`,
        `<message id="${MESSAGE}" name="Kundenauftrag"/>`,
      ],
      ['name="Auftrag abgeschlossen">', 'name="Auftrag erledigt">'],
      ['</process>', `</process>${nl}   <message id="${created}" name="Auftragsbestätigung" />`],
    ]);
  }

  it('changes nothing outside the spliced ranges (LF, no BOM)', async () => {
    const input = decode(await fixture('signavio-auftragsabwicklung.bpmn'));
    expect(input.includes('\r')).toBe(false);
    const { text, result } = await applied(input, amendments);
    expect(text).toBe(expected(input, '\n'));
    expect(text).toContain(
      '<signavio:signavioMetaData metaKey="linkedmodel" metaValue="Finanzen/Bonitätsprüfung"/>',
    );
    expect(result.extraction.engine).toBeNull();
    expect(fact(result.extraction, 'call', CALL).keyRaw).toBe('Process_Rechnungsstellung');
    expect(fact(result.extraction, 'msg_throw', SEND).keyRaw).toBe('Auftragsbestätigung');
    expect(
      fact(result.extraction, 'msg_catch', 'sid-3D4C5E6F-7081-4293-94B5-D6E7F8091A15').keyRaw,
    ).toBe('Kundenauftrag');
  });

  it('keeps the BOM and CRLF line endings byte for byte', async () => {
    const lf = decode(await fixture('signavio-auftragsabwicklung.bpmn'));
    const crlf = lf.replace(/\n/g, '\r\n');
    const input = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(crlf, 'utf8')]);
    const { result } = await applied(input, amendments);
    const want = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(expected(crlf, '\r\n'), 'utf8'),
    ]);
    expect(decode(result.xml)).toBe(decode(want));
    expect(Buffer.from(result.xml).equals(want)).toBe(true);
    expect(/(?<!\r)\n/.test(decode(result.xml))).toBe(false);
  });

  it('refuses documentation on its documented process and reads the collapsed subprocess as no call', async () => {
    const input = await fixture('signavio-auftragsabwicklung.bpmn');
    await refused(input, amendment(PROCESS, 'process-documentation', 'Neu.'), 'has-documentation');
    await refused(
      input,
      amendment('sid-5F6E7081-92A3-44B5-96D7-F8091A2B3C17', 'call-target', 'Process_Bonitaet'),
      'wrong-element',
    );
  });
});

// ---------------------------------------------------------------- escaping

describe('escaping', () => {
  it('escapes &, <, > and " in attribute values and reads them back', async () => {
    const xml = model('c7', '<bpmn:startEvent id="Start_1" />');
    const name = 'Rechnung & "Mahnung" <neu>';
    const { text, result } = await applied(xml, [amendment('Start_1', 'event-name', name)]);
    expect(text).toContain(
      '<bpmn:startEvent id="Start_1" name="Rechnung &amp; &quot;Mahnung&quot; &lt;neu&gt;" />',
    );
    expect(fact(result.extraction, 'evt_start', 'Start_1').label).toBe(name);
  });

  it('escapes line breaks in documentation as references', async () => {
    const xml = definitions('c8', '<bpmn:process id="Process_1" isExecutable="true" />');
    const doc = 'Erste Zeile & mehr\n\n<Zweite> "Zeile"';
    const { text, result } = await applied(xml, [
      amendment('Process_1', 'process-documentation', doc),
    ]);
    expect(text).toContain(
      '<bpmn:documentation>Erste Zeile &amp; mehr&#10;&#10;&lt;Zweite&gt; &quot;Zeile&quot;</bpmn:documentation>',
    );
    expect(fact(result.extraction, 'process', 'Process_1').attrs.documentation).toBe(doc);
  });

  it("keeps a single-quoted attribute's quotes and escapes ' inside", async () => {
    const xml = model('c7', "<bpmn:endEvent id='End_1' name='Alt' />");
    const { text, result } = await applied(xml, [amendment('End_1', 'event-name', "Kunde's Ende")]);
    expect(text).toContain("<bpmn:endEvent id='End_1' name='Kunde&apos;s Ende' />");
    expect(fact(result.extraction, 'evt_end', 'End_1').label).toBe("Kunde's Ende");
  });

  it('writes markup declarations in values as text, never as markup', async () => {
    const xml = model('c7', '<bpmn:startEvent id="Start_1" />');
    const name = '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]> &e;';
    const { text, result } = await applied(xml, [amendment('Start_1', 'event-name', name)]);
    expect(text).not.toContain('<!DOCTYPE');
    expect(fact(result.extraction, 'evt_start', 'Start_1').label).toBe(name);
  });
});

describe('the XSD child order', () => {
  it('flags a root element after a relationship, documentation after extensionElements and two extensionElements', () => {
    expect(
      xsdOrderViolations(
        definitions(
          'c7',
          '<bpmn:process id="P" isExecutable="true"><bpmn:extensionElements /><bpmn:documentation>x</bpmn:documentation><bpmn:extensionElements /></bpmn:process>\n' +
            '<bpmn:relationship id="R1" type="t"><bpmn:source>P</bpmn:source><bpmn:target>P</bpmn:target></bpmn:relationship>\n' +
            '<bpmn:message id="M" />',
        ),
      ),
    ).toEqual([
      'bpmn:definitions#Definitions_1: <bpmn:message> after <bpmn:relationship>',
      'bpmn:process#P: <bpmn:documentation> after <bpmn:extensionElements>',
      'bpmn:process: 2 extensionElements',
    ]);
  });

  it('puts a new message before a trailing relationship of a file without a diagram', async () => {
    const xml = definitions(
      'c7',
      `<bpmn:process id="P" isExecutable="true">
  <bpmn:endEvent id="End_1" name="Ende">
    <bpmn:messageEventDefinition id="MED_1" />
  </bpmn:endEvent>
</bpmn:process>
<bpmn:relationship id="R1" type="trace">
  <bpmn:source>P</bpmn:source>
  <bpmn:target>P</bpmn:target>
</bpmn:relationship>`,
    );
    expect(xsdOrderViolations(xml)).toEqual([]);
    const id = createdId('Message', 'mam_rel');
    const { text } = await applied(xml, [amendment('End_1', 'message-name', 'Neu', 'mam_rel')]);
    expect(text).toBe(
      edit(xml, [
        [
          '<bpmn:messageEventDefinition id="MED_1" />',
          `<bpmn:messageEventDefinition id="MED_1" messageRef="${id}" />`,
        ],
        ['</bpmn:process>\n', `</bpmn:process>\n<bpmn:message id="${id}" name="Neu" />\n`],
      ]),
    );
    expect(xsdOrderViolations(text)).toEqual([]);
  });
});

describe('a declared encoding other than UTF-8', () => {
  const BODY = `<bpmn:process id="P" isExecutable="true">
  <bpmn:startEvent id="Start_1" />
  <bpmn:callActivity id="Call_1" name="Pruefen" />
  <bpmn:endEvent id="End_1">
    <bpmn:messageEventDefinition id="MED_1" messageRef="Message_1" />
  </bpmn:endEvent>
</bpmn:process>
<bpmn:message id="Message_1" />`;
  const ascii = (bytes: Uint8Array) => bytes.every((b) => b < 0x80);

  for (const encoding of ['ISO-8859-1', 'US-ASCII', 'windows-1252']) {
    it(`writes every value as ASCII under encoding="${encoding}", read back by the facts`, async () => {
      const xml = definitions('c7', BODY).replace('encoding="UTF-8"', `encoding="${encoding}"`);
      expect(ascii(new TextEncoder().encode(xml))).toBe(true);
      const { text, result } = await applied(xml, [
        amendment('Call_1', 'call-target', 'Prozess_Prüfung'),
        amendment('Message_1', 'message-name', 'Bestätigung'),
        amendment('Start_1', 'event-name', 'Prüfung läuft'),
        amendment('P', 'process-documentation', 'Größe ändern\n€ und mehr'),
      ]);
      expect(ascii(result.xml)).toBe(true);
      expect(text).toContain('calledElement="Prozess_Pr&#xFC;fung"');
      expect(text).toContain('<bpmn:message id="Message_1" name="Best&#xE4;tigung" />');
      expect(text).toContain('name="Pr&#xFC;fung l&#xE4;uft"');
      expect(text).toContain(
        '<bpmn:documentation>Gr&#xF6;&#xDF;e &#xE4;ndern&#10;&#x20AC; und mehr</bpmn:documentation>',
      );
      const facts = result.extraction;
      expect(fact(facts, 'call', 'Call_1').keyRaw).toBe('Prozess_Prüfung');
      expect(fact(facts, 'msg_throw', 'End_1').attrs.messageName).toBe('Bestätigung');
      expect(fact(facts, 'evt_start', 'Start_1').label).toBe('Prüfung läuft');
      expect(fact(facts, 'process', 'P').attrs.documentation).toBe('Größe ändern\n€ und mehr');
    });
  }

  it('refuses a character beyond the Basic Multilingual Plane there: the facts could not read its reference', async () => {
    const xml = definitions('c7', BODY).replace('encoding="UTF-8"', 'encoding="ISO-8859-1"');
    const message = await refused(
      xml,
      amendment('Start_1', 'event-name', 'Start \u{1F680}'),
      'unsupported-structure',
    );
    expect(message).toContain('Basic Multilingual Plane');
  });

  it('keeps raw UTF-8 for a file declared UTF-8 (or utf8) and for one without a declaration', async () => {
    for (const xml of [
      definitions('c7', BODY),
      definitions('c7', BODY).replace('encoding="UTF-8"', "encoding='utf8'"),
      definitions('c7', BODY).replace('<?xml version="1.0" encoding="UTF-8"?>\n', ''),
    ]) {
      const { text } = await applied(xml, [amendment('Start_1', 'event-name', 'Prüfung')]);
      expect(text).toContain('name="Prüfung"');
    }
  });
});

// ---------------------------------------------------------------- refusals

describe('refusals', () => {
  it('refuses expression targets in either dialect, whatever the engine', async () => {
    await refused(
      model('c7', '<bpmn:callActivity id="Call_A" calledElement="${ziel}" />'),
      amendment('Call_A', 'call-target', 'Process_A'),
      'expression',
    );
    await refused(
      model(
        'c8',
        '<bpmn:callActivity id="Call_A"><bpmn:extensionElements><zeebe:calledElement processId="=ziel" /></bpmn:extensionElements></bpmn:callActivity>',
      ),
      amendment('Call_A', 'call-target', 'Process_A'),
      'expression',
    );
    await refused(
      model('none', '<bpmn:callActivity id="Call_A" calledElement="#{ziel}" />'),
      amendment('Call_A', 'call-target', 'Process_A'),
      'expression',
    );
  });

  it('refuses a duplicate id', async () => {
    const xml = model(
      'c7',
      '<bpmn:callActivity id="Call_A" />\n<bpmn:task id="Call_A" name="Kopie" />',
    );
    await refused(xml, amendment('Call_A', 'call-target', 'Process_A'), 'duplicate-id');
  });

  it('refuses a prefix rebound on the way to the element', async () => {
    const xml = model(
      'c8',
      `<bpmn:subProcess id="Sub_1" xmlns:zeebe="urn:other">
  <bpmn:callActivity id="Call_A" />
</bpmn:subProcess>`,
    );
    await refused(xml, amendment('Call_A', 'call-target', 'Process_A'), 'redeclared-prefix');
    // A redeclaration with the same URI binds nothing new.
    const same = model(
      'c8',
      `<bpmn:subProcess id="Sub_1" xmlns:bpmn="${BPMN_NS}">
  <bpmn:callActivity id="Call_A" />
</bpmn:subProcess>`,
    );
    await applied(same, [amendment('Call_A', 'call-target', 'Process_A')]);
  });

  it('refuses a missing element, the wrong element and a second amendment of one field', async () => {
    const xml = model('c7', '<bpmn:task id="Task_1" name="A" />\n<bpmn:startEvent id="Start_1" />');
    await refused(xml, amendment('Nope', 'event-name', 'X'), 'element-missing');
    await refused(xml, amendment('Task_1', 'call-target', 'Process_A'), 'wrong-element');
    await refused(xml, amendment('Task_1', 'process-documentation', 'X'), 'wrong-element');
    const result = await applyAmendments(
      xml,
      [
        amendment('Start_1', 'event-name', 'Eins', 'a'),
        amendment('Start_1', 'event-name', 'Zwei', 'b'),
      ],
      OPTS,
    );
    expect(result.outcomes.map((o) => [o.id, o.status, 'reason' in o ? o.reason : null])).toEqual([
      ['a', 'applied', null],
      ['b', 'refused', 'duplicate-amendment'],
    ]);
    expect(decode(result.xml)).toContain('name="Eins"');
  });

  it('refuses a value that is not in its normalized form', async () => {
    const xml = model('c7', '<bpmn:startEvent id="Start_1" />');
    await refused(xml, amendment('Start_1', 'event-name', ' Beginn'), 'invalid-value');
    await refused(xml, amendment('Start_1', 'event-name', 'x'.repeat(201)), 'invalid-value');
    await refused(xml, amendment('Start_1', 'event-name', ''), 'invalid-value');
    const call = model('c7', '<bpmn:callActivity id="Call_A" />');
    await refused(call, amendment('Call_A', 'call-target', '${ziel}'), 'invalid-value');
  });

  it('refuses every amendment of markup the splice cannot read, which bpmn-moddle tolerates', async () => {
    const xml = model('c7', '<bpmn:startEvent id="Start_1" name="a" name="b" />');
    expect(fact(await extractFacts(xml, OPTS), 'evt_start', 'Start_1').label).toBe('a');
    await refused(xml, amendment('Start_1', 'event-name', 'X'), 'unsupported-structure');
    const doc = await readAmendable(xml, OPTS);
    expect(doc.fields.map((f) => f.blocked?.reason)).toEqual([
      'unsupported-structure',
      'unsupported-structure',
    ]);
  });

  it('rejects hostile input like extractFacts', async () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x "y">]><bpmn:definitions xmlns:bpmn="${BPMN_NS}" id="D" />`;
    await expect(applyAmendments(xml, [], OPTS)).rejects.toBeInstanceOf(BpmnInputError);
    await expect(readAmendable(xml, OPTS)).rejects.toMatchObject({ code: 'doctype-forbidden' });
  });
});

// ------------------------------------------------------------------ checks

describe('the check', () => {
  // A C7 call that reads its target from a stray Zeebe extension: the C7
  // write goes to the calledElement attribute, which then wins and drops the
  // extension's binding from the fact.
  const STRAY = definitions(
    'c7',
    `<bpmn:process id="Process_1" isExecutable="true">
  <bpmn:callActivity id="Call_Stray">
    <bpmn:extensionElements>
      <zeebe:calledElement xmlns:zeebe="${ZEEBE_NS}" processId="Process_Q" bindingType="deployment" />
    </bpmn:extensionElements>
  </bpmn:callActivity>
  <bpmn:startEvent id="Start_1" />
</bpmn:process>`,
  );

  it('reports an amendment that would not read exactly the intended change and writes nothing', async () => {
    expect(fact(await extractFacts(STRAY, OPTS), 'call', 'Call_Stray').attrs.binding).toBe(
      'deployment',
    );
    const message = await refused(
      STRAY,
      amendment('Call_Stray', 'call-target', 'Process_R'),
      'check-failed',
    );
    expect(message).toContain('call#Call_Stray');
  });

  it('applies the other amendments of the list', async () => {
    const result = await applyAmendments(
      STRAY,
      [
        amendment('Call_Stray', 'call-target', 'Process_R', 'a'),
        amendment('Start_1', 'event-name', 'Beginn', 'b'),
      ],
      OPTS,
    );
    expect(result.outcomes.map((o) => [o.id, o.status])).toEqual([
      ['a', 'refused'],
      ['b', 'applied'],
    ]);
    expect(decode(result.xml)).toBe(
      edit(STRAY, [
        ['<bpmn:startEvent id="Start_1" />', '<bpmn:startEvent id="Start_1" name="Beginn" />'],
      ]),
    );
    expect(fact(result.extraction, 'call', 'Call_Stray').keyRaw).toBe('Process_Q');
  });

  it('refuses a result over the size limit', async () => {
    const xml = definitions('c7', '<bpmn:process id="Process_1" isExecutable="true" />');
    const limits = { maxBytes: Buffer.byteLength(xml) + 100 };
    const result = await applyAmendments(
      xml,
      [amendment('Process_1', 'process-documentation', 'x'.repeat(500))],
      { modelKey: MODEL_KEY, limits },
    );
    expect(result.outcomes).toMatchObject([{ status: 'refused', reason: 'check-failed' }]);
    expect(decode(result.xml)).toBe(xml);
  });
});

// ------------------------------------------------------------- determinism

describe('determinism', () => {
  it('gives identical bytes for identical inputs, from bytes or text', async () => {
    const input = await fixture('c8-modeler.bpmn');
    const list = [
      amendment('Call_A', 'call-target', 'Process_A', 'mam_1'),
      amendment('End_Meldung', 'message-name', 'Meldung', 'mam_2'),
      amendment('Process_Lager', 'process-documentation', 'Doku.', 'mam_3'),
    ];
    const first = await applyAmendments(input, list, OPTS);
    const second = await applyAmendments(input, list, OPTS);
    const fromText = await applyAmendments(decode(input), list, OPTS);
    expect(Buffer.from(first.xml).equals(Buffer.from(second.xml))).toBe(true);
    expect(Buffer.from(first.xml).equals(Buffer.from(fromText.xml))).toBe(true);
    expect(first.outcomes).toEqual(second.outcomes);
  });

  it('returns the input bytes when nothing applies', async () => {
    const input = await fixture('c7-modeler.bpmn');
    const result = await applyAmendments(input, [], OPTS);
    expect(Buffer.from(result.xml).equals(input)).toBe(true);
    expect(result.extraction).toEqual(await extractFacts(input, OPTS));
  });
});

// ------------------------------------------------------------ readAmendable

describe('readAmendable', () => {
  it('reads every amendable field of the C7 fixture with its value and obstacles', async () => {
    const doc = await readAmendable(await fixture('c7-modeler.bpmn'), OPTS);
    expect(doc.engine).toBe('c7');
    expect(
      doc.fields.map((f) => [f.elementId, f.op, f.element, f.value, f.blocked?.reason ?? null]),
    ).toEqual([
      ['Call_Fall', 'call-target', 'call', '', 'cmmn-call'],
      ['Call_Rechnung', 'call-target', 'call', '', null],
      ['Call_Versand', 'call-target', 'call', 'Process_Versand_Alt', null],
      ['EndEvent_1', 'event-name', 'end-event', null, null],
      ['Event_Bestaetigung', 'message-name', 'endpoint', null, null],
      ['Message_Zahlung', 'message-name', 'message', 'Zahlung eingegangen', null],
      ['Process_Auftrag', 'process-documentation', 'process', null, null],
      ['StartEvent_1', 'event-name', 'start-event', null, null],
    ]);
    expect(doc.fields.find((f) => f.elementId === 'Call_Fall')?.caseRef).toBe(true);
    expect(doc.fields.find((f) => f.elementId === 'Call_Rechnung')?.caseRef).toBe(false);
    expect(doc.fields.find((f) => f.elementId === 'Message_Zahlung')?.readers).toEqual([
      'Task_Zahlung',
    ]);
    expect(
      doc.endpoints.map((e) => [e.elementId, e.kind, e.reference, e.amendmentElementId]),
    ).toEqual([
      ['Event_Bestaetigung', 'msg_throw', null, 'Event_Bestaetigung'],
      ['Task_Zahlung', 'msg_catch', 'Message_Zahlung', 'Message_Zahlung'],
    ]);
  });

  it('flags expressions in either dialect and the obstacles of the structure', async () => {
    const xml = model(
      'none',
      `<bpmn:callActivity id="Call_Feel" calledElement="=ziel" />
<bpmn:callActivity id="Call_A" />
<bpmn:task id="Call_A" />`,
    );
    const doc = await readAmendable(xml, OPTS);
    expect(doc.fields.find((f) => f.elementId === 'Call_Feel')).toMatchObject({
      value: '=ziel',
      expression: true,
      blocked: { reason: 'expression' },
    });
    expect(doc.fields.find((f) => f.elementId === 'Call_A')?.blocked?.reason).toBe('duplicate-id');
  });
});

// ------------------------------------------------------------------ corpus

describe('every Modeler-written corpus model (holdout excluded)', () => {
  it('takes an amendment of every amendable field at once, reads exactly that and keeps the XSD child order', async () => {
    let count = 0;
    for (const landscape of ['_sample', 'nordwind-handel']) {
      const dir = path.join(CORPUS, landscape, 'models');
      const files = (await readdir(dir, { recursive: true })).filter((f) => f.endsWith('.bpmn'));
      for (const file of files.sort()) {
        const bytes = await readFile(path.join(dir, file));
        const doc = await readAmendable(bytes, OPTS);
        const list = doc.fields
          .filter((f) => f.blocked === null)
          .map((f, i) =>
            amendment(
              f.elementId,
              f.op,
              f.op === 'call-target' ? `Process_Amended_${i}` : `Ergänzt ${i} & <mehr>`,
              `mam_${i}`,
            ),
          );
        const result = await applyAmendments(bytes, list, OPTS);
        expect(
          result.outcomes.filter((o) => o.status !== 'applied'),
          `${landscape}/${file}`,
        ).toEqual([]);
        // The splices add no break of the XSD's child order.
        const before = xsdOrderViolations(decode(bytes));
        expect(xsdOrderViolations(decode(result.xml)), `${landscape}/${file}`).toEqual(before);
        count += list.length;
      }
    }
    expect(count).toBeGreaterThan(100);
  });
});

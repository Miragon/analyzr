// normalize-bpmn for one file (src/normalize.ts, M6 §3.7): every output extracts with
// @analyzr/bpmn-facts without id warnings; references follow rewritten ids.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { extractFacts, type ExtractWarning } from '@analyzr/bpmn-facts';
import { describe, expect, it } from 'vitest';

import { listExport } from '../src/files.ts';
import { MAX_BYTES, MAX_INPUT_BYTES, normalizeBpmn, NormalizeError } from '../src/normalize.ts';
import { attribute, descendants, ownText, parseXml, type XmlElement } from '../src/xml.ts';

import { BPMN_NS, bpmn, edge, shape, SIGNAVIO_EXPORT, text, utf8 } from './support.ts';

/** The id warnings §3.7 rules out: lost elements and moddle's illegal or duplicate ids. */
function idWarnings(warnings: readonly ExtractWarning[]): ExtractWarning[] {
  return warnings.filter(
    (w) =>
      ['missing-id', 'invalid-id', 'duplicate-id'].includes(w.code) ||
      (w.code === 'parse-warning' && /illegal ID|duplicate ID/.test(w.message)),
  );
}

async function extract(bytes: Uint8Array): Promise<ExtractWarning[]> {
  return (await extractFacts(bytes, { modelKey: 'test/model' })).warnings;
}

function elements(xml: string): XmlElement[] {
  const root = parseXml(xml).root;
  return [root, ...descendants(root)];
}

const byId = (xml: string, id: string): XmlElement | undefined =>
  elements(xml).find((el) => attribute(el, 'id') === id);

const COLLABORATION = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="${BPMN_NS}" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Defs 1" targetNamespace="http://example.org/test">
  <message id="Msg ü" name="Bestellung" />
  <collaboration id="Collab_1">
    <participant id="Part 1" name="Einkauf" processRef="Proc 1" />
    <participant id="Part_2" name="Lieferant" />
    <messageFlow id="MF 1" sourceRef="Part_2" targetRef="Start 1" />
  </collaboration>
  <process id="Proc 1" isExecutable="false">
    <laneSet id="LS_1">
      <lane id="Lane 1" name="Einkauf"><flowNodeRef>Start 1</flowNodeRef><flowNodeRef>Gw 1</flowNodeRef><flowNodeRef>Task 1</flowNodeRef></lane>
    </laneSet>
    <startEvent id="Start 1" name="Bestellung eingegangen"><outgoing>Flow 1</outgoing><messageEventDefinition id="MED_1" messageRef="Msg ü" /></startEvent>
    <exclusiveGateway id="Gw 1" default="Flow 2"><incoming>Flow 1</incoming><outgoing>Flow 2</outgoing></exclusiveGateway>
    <task id="Task 1" name="Bestellung prüfen"><incoming>Flow 2</incoming></task>
    <boundaryEvent id="Boundary 1" attachedToRef="Task 1" />
    <sequenceFlow id="Flow 1" sourceRef="Start 1" targetRef="Gw 1" />
    <sequenceFlow id="Flow 2" sourceRef="Gw 1" targetRef="Task 1" />
  </process>
  <bpmndi:BPMNDiagram id="Diagram_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Collab_1">
      ${shape('Part 1', 'Part_1_di')}${shape('Part_2')}${shape('Lane 1', 'Lane_1_di')}${shape('Start 1', 'Start_1_di')}${shape('Gw 1', 'Gw_1_di')}${shape('Task 1', 'Task_1_di')}${shape('Boundary 1', 'Boundary_1_di')}
      ${edge('Flow 1', 'Flow_1_di')}${edge('Flow 2', 'Flow_2_di')}${edge('MF 1', 'MF_1_di')}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</definitions>
`;

describe('normalizeBpmn: pass-through', () => {
  it('keeps the bytes of a file analyzr reads completely (export)', async () => {
    const input = utf8(bpmn('<task id="Task_1" name="A" />', { di: shape('Task_1') }));
    const result = await normalizeBpmn(input);
    expect(result.kind).toBe('export');
    expect(result.bytes).toBe(input);
    expect(result).toMatchObject({
      encoding: 'utf-8',
      idRewrites: [],
      calledElementRewrites: [],
      losses: [],
      parseWarnings: [],
      layoutMissing: [],
    });
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('passes a static call through unchanged (§3.9: the tool’s own calls)', async () => {
    const input = utf8(bpmn('<callActivity id="Call_1" calledElement="Process_Billing" />'));
    const result = await normalizeBpmn(input);
    expect(result.kind).toBe('export');
    expect(result.summary.callActivities).toEqual([
      { id: 'Call_1', name: null, calledElement: 'Process_Billing' },
    ]);
  });
});

describe('normalizeBpmn: encodings', () => {
  it('transcodes UTF-16 to UTF-8 (converted, nothing lost)', async () => {
    const source = bpmn('<task id="Task_1" name="Prüfen" />', { di: shape('Task_1') }).replace(
      'encoding="UTF-8"',
      'encoding="UTF-16"',
    );
    const input = new Uint8Array([0xff, 0xfe, ...Buffer.from(source, 'utf16le')]);
    await expect(extractFacts(input, { modelKey: 'test/model' })).rejects.toThrow(/UTF-16/);
    const result = await normalizeBpmn(input);
    expect(result).toMatchObject({ kind: 'converted', encoding: 'utf-16le', losses: [] });
    const out = text(result.bytes);
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(out).toContain('name="Prüfen"');
    expect(await extract(result.bytes)).toEqual([]);
  });

  it('transcodes UTF-16 without a byte order mark, also when every character is ASCII', async () => {
    const source = bpmn('<task id="Task_1" name="A" />').replace(
      'encoding="UTF-8"',
      'encoding="UTF-16"',
    );
    const result = await normalizeBpmn(new Uint8Array(Buffer.from(source, 'utf16le')));
    expect(result).toMatchObject({ kind: 'converted', encoding: 'utf-16le' });
    expect(await extract(result.bytes)).toEqual([]);
  });

  it('transcodes a declared ISO-8859-1 file with umlauts', async () => {
    const source = bpmn('<task id="Task_1" name="Prüfen" />').replace(
      'encoding="UTF-8"',
      'encoding="ISO-8859-1"',
    );
    const result = await normalizeBpmn(new Uint8Array(Buffer.from(source, 'latin1')));
    expect(result.kind).toBe('converted');
    expect(text(result.bytes)).toContain('name="Prüfen"');
  });

  it('keeps an ASCII-only file with another declared encoding as it is', async () => {
    const source = bpmn('<task id="Task_1" name="A" />').replace(
      'encoding="UTF-8"',
      'encoding="ISO-8859-1"',
    );
    expect((await normalizeBpmn(utf8(source))).kind).toBe('export');
  });
});

describe('normalizeBpmn: ids', () => {
  it('rewrites unsafe ids and every reference to them', async () => {
    const input = utf8(COLLABORATION);
    expect(idWarnings(await extract(input)).length).toBeGreaterThan(0);

    const result = await normalizeBpmn(input);
    expect(result.kind).toBe('converted');
    expect(result.idRewrites.map((r) => [r.from, r.to, r.reason, r.type])).toEqual([
      ['Defs 1', 'Definitions_Defs_1', 'unsafe', 'bpmn:Definitions'],
      ['Msg ü', 'Message_Msg_ue', 'unsafe', 'bpmn:Message'],
      ['Part 1', 'Participant_Part_1', 'unsafe', 'bpmn:Participant'],
      ['MF 1', 'MessageFlow_MF_1', 'unsafe', 'bpmn:MessageFlow'],
      ['Proc 1', 'Process_Proc_1', 'unsafe', 'bpmn:Process'],
      ['Lane 1', 'Lane_Lane_1', 'unsafe', 'bpmn:Lane'],
      ['Start 1', 'StartEvent_Start_1', 'unsafe', 'bpmn:StartEvent'],
      ['Gw 1', 'ExclusiveGateway_Gw_1', 'unsafe', 'bpmn:ExclusiveGateway'],
      ['Task 1', 'Task_Task_1', 'unsafe', 'bpmn:Task'],
      ['Boundary 1', 'BoundaryEvent_Boundary_1', 'unsafe', 'bpmn:BoundaryEvent'],
      ['Flow 1', 'SequenceFlow_Flow_1', 'unsafe', 'bpmn:SequenceFlow'],
      ['Flow 2', 'SequenceFlow_Flow_2', 'unsafe', 'bpmn:SequenceFlow'],
    ]);
    expect(result.losses).toEqual([{ code: 'id-rewritten', count: 12 }]);

    const out = text(result.bytes);
    expect(
      byId(out, 'Participant_Part_1') &&
        attribute(byId(out, 'Participant_Part_1') as XmlElement, 'processRef'),
    ).toBe('Process_Proc_1');
    expect(attribute(byId(out, 'MessageFlow_MF_1') as XmlElement, 'targetRef')).toBe(
      'StartEvent_Start_1',
    );
    expect(attribute(byId(out, 'MED_1') as XmlElement, 'messageRef')).toBe('Message_Msg_ue');
    expect(attribute(byId(out, 'ExclusiveGateway_Gw_1') as XmlElement, 'default')).toBe(
      'SequenceFlow_Flow_2',
    );
    expect(attribute(byId(out, 'BoundaryEvent_Boundary_1') as XmlElement, 'attachedToRef')).toBe(
      'Task_Task_1',
    );
    expect(attribute(byId(out, 'SequenceFlow_Flow_2') as XmlElement, 'sourceRef')).toBe(
      'ExclusiveGateway_Gw_1',
    );
    const lane = byId(out, 'Lane_Lane_1') as XmlElement;
    expect(lane.children.map(ownText)).toEqual([
      'StartEvent_Start_1',
      'ExclusiveGateway_Gw_1',
      'Task_Task_1',
    ]);
    expect((byId(out, 'Task_Task_1') as XmlElement).children.map(ownText)).toEqual([
      'SequenceFlow_Flow_2',
    ]);
    const di = elements(out)
      .filter((el) => el.local === 'BPMNShape' || el.local === 'BPMNEdge')
      .map((el) => attribute(el, 'bpmnElement'));
    expect(di).toEqual([
      'Participant_Part_1',
      'Part_2',
      'Lane_Lane_1',
      'StartEvent_Start_1',
      'ExclusiveGateway_Gw_1',
      'Task_Task_1',
      'BoundaryEvent_Boundary_1',
      'SequenceFlow_Flow_1',
      'SequenceFlow_Flow_2',
      'MessageFlow_MF_1',
    ]);
    expect(result.parseWarnings).toEqual([]);
    expect(await extract(result.bytes)).toEqual([]);
  });

  it('suffixes duplicates and maps DI by order and flows by incoming/outgoing', async () => {
    const input = utf8(
      bpmn(
        [
          '<startEvent id="S"><outgoing>F1</outgoing></startEvent>',
          '<task id="T" name="first"><incoming>F1</incoming><outgoing>F2</outgoing></task>',
          '<task id="T" name="second"><incoming>F2</incoming><outgoing>F3</outgoing></task>',
          '<endEvent id="E"><incoming>F3</incoming></endEvent>',
          '<sequenceFlow id="F1" sourceRef="S" targetRef="T" />',
          '<sequenceFlow id="F2" sourceRef="T" targetRef="T" />',
          '<sequenceFlow id="F3" sourceRef="T" targetRef="E" />',
        ].join(''),
        {
          di: [
            shape('S'),
            shape('T', 'T_di'),
            shape('T', 'T_di'),
            shape('E'),
            edge('F1'),
            edge('F2'),
            edge('F3'),
          ].join(''),
        },
      ),
    );
    const warnings = await extract(input);
    expect(warnings.some((w) => /duplicate ID <T>/.test(w.message))).toBe(true);

    const result = await normalizeBpmn(input);
    expect(result.idRewrites).toEqual([
      { from: 'T', to: 'T_2', reason: 'duplicate', type: 'bpmn:Task' },
      { from: 'T_di', to: 'T_di_2', reason: 'duplicate', type: 'bpmndi:BPMNShape' },
    ]);
    const out = text(result.bytes);
    const flow = (id: string): [string | undefined, string | undefined] => {
      const el = byId(out, id) as XmlElement;
      return [attribute(el, 'sourceRef'), attribute(el, 'targetRef')];
    };
    expect(flow('F1')).toEqual(['S', 'T']);
    expect(flow('F2')).toEqual(['T', 'T_2']);
    expect(flow('F3')).toEqual(['T_2', 'E']);
    const shapes = elements(out).filter((el) => el.local === 'BPMNShape');
    expect(shapes.map((el) => [attribute(el, 'id'), attribute(el, 'bpmnElement')])).toEqual([
      ['S_di', 'S'],
      ['T_di', 'T'],
      ['T_di_2', 'T_2'],
      ['E_di', 'E'],
    ]);
    expect(await extract(result.bytes)).toEqual([]);
  });

  it('maps a duplicated flow in incoming, outgoing and default to the flow that ends or starts there', async () => {
    const input = utf8(
      bpmn(
        [
          '<exclusiveGateway id="G" default="F"><outgoing>F</outgoing><outgoing>F</outgoing></exclusiveGateway>',
          '<task id="A"><incoming>F</incoming></task>',
          '<task id="B"><incoming>F</incoming></task>',
          '<sequenceFlow id="F" sourceRef="G" targetRef="A" />',
          '<sequenceFlow id="F" sourceRef="G" targetRef="B" />',
        ].join(''),
      ),
    );
    const result = await normalizeBpmn(input);
    expect(result.idRewrites).toEqual([
      { from: 'F', to: 'F_2', reason: 'duplicate', type: 'bpmn:SequenceFlow' },
    ]);
    const out = text(result.bytes);
    const refs = (id: string): string[] => (byId(out, id) as XmlElement).children.map(ownText);
    expect(attribute(byId(out, 'F_2') as XmlElement, 'targetRef')).toBe('B');
    expect(refs('A')).toEqual(['F']);
    expect(refs('B')).toEqual(['F_2']);
    expect(refs('G')).toEqual(['F', 'F_2']);
    // Which of the two is the default flow cannot be told: listed for the consultant.
    expect(result.ambiguousReferences).toEqual([
      { element: 'G', property: 'default', reference: 'F', to: 'F' },
    ]);
    expect(await extract(result.bytes)).toEqual([]);
  });

  it('lists a flow to a duplicated node it cannot assign', async () => {
    const input = utf8(
      bpmn(
        [
          '<task id="T" /><task id="T" /><task id="X" />',
          '<sequenceFlow id="F1" sourceRef="X" targetRef="T" />',
        ].join(''),
      ),
    );
    const result = await normalizeBpmn(input);
    expect(result.ambiguousReferences).toEqual([
      { element: 'F1', property: 'targetRef', reference: 'T', to: 'T' },
    ]);
  });

  it('gives an element analyzr needs an id for a stable one when it has none', async () => {
    const body = [
      '<task name="Prüfen" />',
      '<task id="" name="Freigeben" />',
      '<task name="Prüfen" />',
      '<sequenceFlow sourceRef="Known" targetRef="Other" />',
      '<task id="Known" /><task id="Other" />',
    ].join('');
    const input = utf8(bpmn(body));
    // The extractor skips the tasks; bpmn-js cannot draw the flow (no DI can point at it).
    expect((await extract(input)).filter((w) => w.code === 'missing-id')).toHaveLength(3);

    const result = await normalizeBpmn(input);
    expect(result.kind).toBe('converted');
    expect(result.idRewrites.map((r) => [r.from, r.reason, r.type])).toEqual([
      ['', 'missing', 'bpmn:Task'],
      ['', 'missing', 'bpmn:Task'],
      ['', 'missing', 'bpmn:Task'],
      ['', 'missing', 'bpmn:SequenceFlow'],
    ]);
    for (const r of result.idRewrites) expect(r.to).toMatch(/^(Task|SequenceFlow)_[0-9a-f]{8}$/);
    expect(new Set(result.idRewrites.map((r) => r.to)).size).toBe(4);
    expect(result.losses).toContainEqual({ code: 'id-rewritten', count: 4 });
    expect(idWarnings(await extract(result.bytes))).toEqual([]);
    const facts = await extractFacts(result.bytes, { modelKey: 'test/model' });
    expect(facts.facts.filter((f) => f.kind === 'task').map((f) => f.label)).toEqual(
      expect.arrayContaining(['Prüfen', 'Freigeben']),
    );
    // Stable: the same ids on another run and after an unrelated element is added.
    const again = await normalizeBpmn(utf8(bpmn(`${body}<task id="Neu" />`)));
    expect(again.idRewrites.map((r) => r.to)).toEqual(result.idRewrites.map((r) => r.to));
  });

  it('rewrites an unsafe static calledElement the way the called process id is rewritten', async () => {
    const caller = utf8(
      bpmn(
        '<callActivity id="Call_1" calledElement="Rechnung stellen" /><callActivity id="Call_2" calledElement="${target}" />',
      ),
    );
    const callee = utf8(bpmn('').replace('<process id="P"', '<process id="Rechnung stellen"'));
    const [a, b] = await Promise.all([normalizeBpmn(caller), normalizeBpmn(callee)]);
    expect(a.calledElementRewrites).toEqual([
      { from: 'Rechnung stellen', to: 'Process_Rechnung_stellen' },
    ]);
    expect(attribute(byId(text(a.bytes), 'Call_2') as XmlElement, 'calledElement')).toBe(
      '${target}',
    );
    expect(b.idRewrites.map((r) => r.to)).toEqual(['Process_Rechnung_stellen']);
  });

  it('is deterministic', async () => {
    const [a, b] = await Promise.all([
      normalizeBpmn(utf8(COLLABORATION)),
      normalizeBpmn(utf8(COLLABORATION)),
    ]);
    expect(text(a.bytes)).toBe(text(b.bytes));
    expect(a.sha256).toBe(b.sha256);
  });
});

describe('normalizeBpmn: losses', () => {
  it('counts elements without DI as layout-missing', async () => {
    const input = utf8(
      bpmn('<task id="A" /><task id="B" /><sequenceFlow id="F" sourceRef="A" targetRef="B" />', {
        di: shape('A'),
      }),
    );
    const result = await normalizeBpmn(input);
    expect(result.kind).toBe('export');
    expect(result.losses).toEqual([{ code: 'layout-missing', count: 2 }]);
    expect(result.layoutMissing).toEqual(['B', 'F']);
  });

  it('counts what bpmn-moddle drops while converting', async () => {
    const input = utf8(
      bpmn(
        '<task id="Task 1"><foo:bar xmlns:foo="urn:foo" /></task><sequenceFlow id="F" sourceRef="Task 1" targetRef="Missing" />',
      ),
    );
    const result = await normalizeBpmn(input);
    expect(result.kind).toBe('converted');
    expect(result.losses).toEqual([
      { code: 'element-dropped', count: 1 },
      { code: 'attribute-dropped', count: 1 },
      { code: 'id-rewritten', count: 1 },
      { code: 'layout-missing', count: 2 },
    ]);
    expect(text(result.bytes)).not.toContain('foo:bar');
    expect(idWarnings(await extract(result.bytes))).toEqual([]);
  });

  it('reports bpmn-moddle warnings of an unchanged file as analyzr will', async () => {
    const input = utf8(
      bpmn('<task id="T"><foo:bar xmlns:foo="urn:foo" /></task>', { di: shape('T') }),
    );
    const result = await normalizeBpmn(input);
    expect(result.kind).toBe('export');
    expect(result.parseWarnings).toEqual([
      expect.stringMatching(/^unparsable content <foo:bar> detected/),
    ]);
    expect((await extract(input)).map((w) => w.code)).toEqual(['parse-warning']);
  });

  it('keeps Camunda extensions and the engine', async () => {
    const input = utf8(
      bpmn(
        '<serviceTask id="Task 1" camunda:class="x.Y"><extensionElements><camunda:inputOutput><camunda:inputParameter name="a">1</camunda:inputParameter></camunda:inputOutput></extensionElements></serviceTask>',
        {
          ns: ' xmlns:camunda="http://camunda.org/schema/1.0/bpmn"',
        },
      ),
    );
    const result = await normalizeBpmn(input);
    const out = text(result.bytes);
    expect(out).toContain('camunda:class="x.Y"');
    expect(out).toContain('<camunda:inputParameter name="a">1</camunda:inputParameter>');
    expect((await extractFacts(result.bytes, { modelKey: 'test/model' })).engine).toBe('c7');
    expect(result.parseWarnings).toEqual([]);
  });
});

describe('normalizeBpmn: entities', () => {
  it('leaves unknown entity references and a bare & as analyzr reads them', async () => {
    const input = utf8(bpmn('<task id="T" name="A&nbsp;B &amp C & D" />'));
    expect((await extract(input)).length).toBe(0);
    const result = await normalizeBpmn(input);
    expect(result.kind).toBe('export');
    // Converted (an unsafe id elsewhere): the label reads the same in analyzr.
    const converted = await normalizeBpmn(
      utf8(bpmn('<task id="T" name="A&nbsp;B &amp C & D" /><task id="Bad id" />')),
    );
    expect(converted.kind).toBe('converted');
    const before = await extractFacts(input, { modelKey: 'test/model' });
    const after = await extractFacts(converted.bytes, { modelKey: 'test/model' });
    const label = (r: typeof before): string | undefined =>
      r.facts.find((f) => f.elementId === 'T')?.label;
    expect(label(after)).toBe(label(before));
    expect(label(after)).toBe('A&nbsp;B &amp C & D');
  });
});

/** A one-line BPMN document of `count` tasks, each padded to about `size` bytes. */
function large(count: number, size: number, options: { bad?: boolean; gap?: string } = {}): string {
  const gap = options.gap ?? '';
  const tasks = Array.from({ length: count }, (_, i) => {
    const head = `<task id="${options.bad === true && i === 0 ? 'Bad id' : `Task_${i}`}" name="`;
    return `${head}${'x'.repeat(Math.max(1, size - head.length - 4))}" />`;
  });
  return bpmn(tasks.join(gap)).replace(/\n/g, '');
}

describe('normalizeBpmn: analyzr’s 5 MB apply to what it writes', () => {
  it('takes a UTF-16 file above 5 MB whose UTF-8 fits', async () => {
    const source = large(20_000, 150).replace('encoding="UTF-8"', 'encoding="UTF-16"');
    const input = new Uint8Array([0xff, 0xfe, ...Buffer.from(source, 'utf16le')]);
    expect(input.byteLength).toBeGreaterThan(MAX_BYTES);
    const result = await normalizeBpmn(input);
    expect(result).toMatchObject({ kind: 'converted', encoding: 'utf-16le', compact: false });
    expect(result.bytes.byteLength).toBeLessThanOrEqual(MAX_BYTES);
    expect((await extractFacts(result.bytes, { modelKey: 'test/model' })).facts.length).toBe(
      20_001,
    );
  }, 60_000);

  it('writes compact XML when indenting would exceed 5 MB', async () => {
    const source = large(40_000, 127, { bad: true });
    expect(source.length).toBeLessThan(MAX_BYTES);
    const result = await normalizeBpmn(utf8(source));
    expect(result).toMatchObject({ kind: 'converted', compact: true });
    expect(result.bytes.byteLength).toBeLessThanOrEqual(MAX_BYTES);
    expect(idWarnings(await extract(result.bytes))).toEqual([]);
  }, 60_000);

  it('converts a file above 5 MB that fits without its whitespace, refuses one that does not', async () => {
    const spaced = large(32_000, 160, { gap: '\n          ' });
    expect(spaced.length).toBeGreaterThan(MAX_BYTES);
    const fits = await normalizeBpmn(utf8(spaced));
    expect(fits).toMatchObject({ kind: 'converted', compact: true, idRewrites: [] });
    expect(fits.bytes.byteLength).toBeLessThanOrEqual(MAX_BYTES);

    const dense = large(30_000, 180);
    expect(dense.length).toBeGreaterThan(MAX_BYTES);
    await expect(normalizeBpmn(utf8(dense))).rejects.toMatchObject({
      code: 'too-large',
      message: expect.stringMatching(/after normalizing/) as string,
    });
  }, 60_000);
});

describe('normalizeBpmn: refusals', () => {
  it.each([
    ['too-large', new Uint8Array(MAX_INPUT_BYTES + 1)],
    ['doctype-forbidden', utf8('<?xml version="1.0"?><!DOCTYPE AML SYSTEM "x.dtd"><AML/>')],
    ['not-bpmn', utf8('<root xmlns="urn:other" />')],
    ['not-xml', utf8('<definitions')],
    ['unsupported-encoding', new Uint8Array([0x3c, 0x61, 0xfc, 0x2f, 0x3e])],
  ])('refuses %s', async (code, input) => {
    await expect(normalizeBpmn(input)).rejects.toThrow(NormalizeError);
    await expect(normalizeBpmn(input)).rejects.toMatchObject({ code });
  });
});

describe('the Signavio-style fixture', () => {
  it('normalizes every model into one analyzr extracts without id warnings', async () => {
    const { files } = await listExport(SIGNAVIO_EXPORT);
    const models = files.filter((f) => f.path.endsWith('.bpmn'));
    expect(models).toHaveLength(6);
    const kinds: Record<string, string> = {};
    for (const f of models) {
      const result = await normalizeBpmn(new Uint8Array(await readFile(f.absolute)));
      kinds[path.basename(f.path)] = result.kind;
      expect(idWarnings(await extract(result.bytes)), f.path).toEqual([]);
      expect(result.parseWarnings, f.path).toEqual([]);
      expect(result.layoutMissing, f.path).toEqual([]);
    }
    expect(kinds).toEqual({
      'Auftragsabwicklung (alt).bpmn': 'export',
      'Bonitätsprüfung.bpmn': 'converted',
      'Rechnungsstellung.bpmn': 'converted',
      'Versand.bpmn': 'converted',
      'Angebotserstellung.bpmn': 'export',
      'Auftragsabwicklung.bpmn': 'export',
    });
  });
});

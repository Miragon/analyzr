// The validator of analyzr-spec/1 (src/spec/validate.ts, M6 S3c §2.3) and the YAML reader
// (src/spec/yaml.ts, §3.1): every error and warning with its message, per origin; done-when
// D3 (a), no field that could become a calledElement; the zod-free copies of the manifest's
// rules pinned against the contracts.
import { ImportManifest } from '@analyzr/contracts/import-manifest';
import { describe, expect, it } from 'vitest';

import { externalIdProblem, urlProblem } from '../src/spec/declared.ts';
import type { SpecOrigin } from '../src/spec/types.ts';
import { validateSpec } from '../src/spec/validate.ts';
import { formatSpec, MAX_SPEC_BYTES, parseSpecBytes, parseSpecText } from '../src/spec/yaml.ts';

import { readFixture } from './spec-support.ts';

type Value = Record<string, unknown>;

/** A small valid spec the agent wrote; every call gives a fresh copy. */
function hand(): Value {
  return {
    format: 'analyzr-spec/1',
    source: { externalPath: 'Service/Anfrage' },
    derived: { kind: 'reconstructed', llmModel: 'claude-opus-5-5' },
    processes: [
      {
        source: 'p',
        name: 'Anfrage',
        nodes: [
          { source: 's', type: 'start', name: 'Eingang' },
          { source: 't', type: 'task', name: 'Prüfen' },
          { source: 'e', type: 'end', name: 'Erledigt' },
        ],
        flows: [
          { from: 's', to: 't' },
          { from: 't', to: 'e' },
        ],
      },
    ],
  };
}

/** The same as converter output (no derived). */
function converter(): Value {
  const { derived: _derived, ...rest } = hand();
  return rest;
}

const proc = (v: Value): Value => (v['processes'] as Value[])[0] as Value;
const nodes = (v: Value): Value[] => proc(v)['nodes'] as Value[];
const flows = (v: Value): Value[] => proc(v)['flows'] as Value[];

/** Errors and warnings as `path: message` lines. */
function check(value: unknown, origin: SpecOrigin = 'hand') {
  const r = validateSpec(value, { origin });
  return {
    valid: r.spec !== null,
    errors: r.errors.map((p) => `${p.path}: ${p.message}`),
    warnings: r.warnings.map((p) => `${p.path}: ${p.message}`),
    codes: r.errors.map((p) => p.code),
  };
}

const errorsOf = (value: unknown, origin: SpecOrigin = 'hand'): string[] =>
  check(value, origin).errors;

describe('a valid spec', () => {
  it('passes with its defaults filled in', () => {
    const r = validateSpec(hand(), { origin: 'hand' });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.spec?.processes[0]?.nodes[0]).toMatchObject({
      trigger: 'none',
      reads: [],
      lane: null,
    });
    expect(r.spec?.processes[0]?.nodes[1]).toMatchObject({ taskKind: 'none' });
    expect(r.spec?.derived).toEqual({
      kind: 'reconstructed',
      llmModel: 'claude-opus-5-5',
      from: [],
    });
    expect(check(converter(), 'converter')).toMatchObject({
      valid: true,
      errors: [],
      warnings: [],
    });
  });

  it('accepts every golden fixture', async () => {
    for (const [name, origin] of [
      ['minimal', 'hand'],
      ['lanes-gateways', 'hand'],
      ['collaboration', 'converter'],
      ['unnamed-messages', 'hand'],
      ['calls-and-stores', 'hand'],
      ['long-texts', 'hand'],
      ['converter-loose', 'converter'],
      ['reconstructed', 'hand'],
      ['as-told', 'hand'],
    ] as const) {
      expect(check(await readFixture(`${name}.spec.yaml`), origin).errors, name).toEqual([]);
    }
  });
});

describe('errors of both origins', () => {
  it('format', () => {
    const v = hand();
    v['format'] = 'analyzr-spec/2';
    expect(errorsOf(v)).toEqual(['format: expected "analyzr-spec/1", got "analyzr-spec/2"']);
    delete v['format'];
    expect(errorsOf(v)).toEqual(['format: required ("analyzr-spec/1")']);
    expect(errorsOf([])).toEqual([': expected a mapping, got a list']);
  });

  it('shape: unknown and refused fields, wrong types, empty required strings', () => {
    const v = hand();
    v['key'] = 'service/anfrage';
    v['name'] = 'Anfrage';
    (v['source'] as Value)['externalPath'] = '';
    proc(v)['nodes'] = 'none';
    expect(errorsOf(v)).toEqual([
      'key: unknown field (model keys come from keymap.json through plan, never from a spec)',
      'name: unknown field (analyzr names a model after its first process: set the process name or its pool)',
      'source.externalPath: must not be empty',
      'processes[0].nodes: expected a list',
    ]);
    const proto = JSON.parse(
      '{"format": "analyzr-spec/1", "__proto__": {"x": 1}, "constructor": 1, "source": {"externalPath": "A"}, "derived": {"kind": "reconstructed", "llmModel": "m"}, "processes": []}',
    ) as unknown;
    expect(errorsOf(proto)).toEqual([
      '__proto__: "__proto__" is no field name',
      'constructor: "constructor" is no field name',
      'processes: must not be empty (at least one process)',
    ]);
    // the YAML path gives __proto__ as an own key too, and prototype is refused alike
    const fromYaml = parseSpecText(
      [
        'format: analyzr-spec/1',
        'source: {externalPath: A}',
        'derived: {kind: reconstructed, llmModel: m}',
        '__proto__: {x: 1}',
        'prototype: 1',
        'processes: [{source: p, nodes: [{source: t, type: task}]}]',
      ].join('\n'),
    );
    expect(fromYaml.errors).toEqual([]);
    expect(errorsOf(fromYaml.value)).toEqual([
      '__proto__: "__proto__" is no field name',
      'prototype: "prototype" is no field name',
    ]);
    expect(({} as Value)['x']).toBeUndefined();
  });

  it('shape: required sources and tool paths, hints for coordinates and conditions', () => {
    const v = hand();
    delete (v['source'] as Value)['externalPath'];
    delete nodes(v)[1]?.['source'];
    nodes(v)[0] = { source: 's', type: 'start', x: 10, y: 20 };
    flows(v)[1] = { from: 't', to: 'e', condition: 'betrag > 100' };
    expect(errorsOf(v)).toEqual([
      'source.externalPath: required (tool folder and model name, "/"-separated, e.g. Vertrieb/Prozesse/Auftrag)',
      'processes[0].nodes[0].x: unknown field (analyzr lays the model out itself; a spec has no coordinates)',
      'processes[0].nodes[0].y: unknown field (analyzr lays the model out itself; a spec has no coordinates)',
      'processes[0].nodes[1].source: required',
      'processes[0].flows[1].condition: unknown field (a spec carries nothing executable: put the condition into the flow name)',
      'processes[0].flows[0].to: no node "t" in process "p"',
      'processes[0].flows[1].from: no node "t" in process "p"',
    ]);
    const w = hand();
    delete w['source'];
    expect(errorsOf(w)).toEqual([
      'source: required (externalPath: where the model lives in the tool)',
    ]);
  });

  it('repeats at most 80 characters of the input in a message', () => {
    const v = hand();
    v['format'] = 'x'.repeat(5000);
    v['y'.repeat(5000)] = 1;
    nodes(v)[1] = { source: 't', type: 'z'.repeat(5000), lane: 'l' };
    nodes(v)[2] = { source: 'e', type: 'end', lane: 'q'.repeat(5000) };
    const lines = errorsOf(v);
    expect(lines).toEqual([
      `${'y'.repeat(80)}…: unknown field`,
      `format: expected "analyzr-spec/1", got "${'x'.repeat(80)}…"`,
      `processes[0].nodes[1].type: unknown type "${'z'.repeat(80)}…" (start, end, task, subprocess, call, event, gateway)`,
      // after a node that failed, a later one is still named by its own place
      `processes[0].nodes[2].lane: no lane "${'q'.repeat(80)}…" in process "p"`,
    ]);
  });

  it('ids must be strings: an unquoted 0012 or 1.10 is a number in YAML', () => {
    const parsed = parseSpecText(
      [
        'format: analyzr-spec/1',
        'source: {externalPath: A}',
        'derived: {kind: reconstructed, llmModel: m}',
        'processes:',
        '  - source: 0012',
        '    nodes:',
        '      - {source: 1.10, type: task, name: 42}',
      ].join('\n'),
    );
    expect(parsed.errors).toEqual([]);
    expect(errorsOf(parsed.value)).toEqual([
      'processes[0].source: expected a string, got number 12 (quote ids: an unquoted 0012 or 1.10 is a number in YAML)',
      'processes[0].nodes[0].source: expected a string, got number 1.1 (quote ids: an unquoted 0012 or 1.10 is a number in YAML)',
      'processes[0].nodes[0].name: expected a string, got number 42 (quote it)',
    ]);
  });

  it('types: an unknown node type, and per-type fields', () => {
    const v = hand();
    nodes(v)[1] = { source: 't', type: 'decision', name: 'Prüfen' };
    nodes(v)[0] = { source: 's', type: 'start', name: 'Eingang', kind: 'user' };
    expect(errorsOf(v)).toEqual([
      'processes[0].nodes[0].kind: unknown field (not a field of a start node; "kind" belongs to task, gateway)',
      'processes[0].nodes[1].type: unknown type "decision" (start, end, task, subprocess, call, event, gateway)',
    ]);
    nodes(v)[1] = { source: 't', name: 'Prüfen' };
    nodes(v)[0] = { source: 's', type: 'start' };
    expect(errorsOf(v)).toEqual([
      'processes[0].nodes[1].type: required (start, end, task, subprocess, call, event, gateway)',
    ]);
    nodes(v)[1] = { source: 't', type: 'gateway' };
    expect(errorsOf(v)).toEqual([
      'processes[0].nodes[1].kind: required (exclusive, parallel, inclusive, event-based)',
    ]);
    nodes(v)[1] = { source: 't', type: 'gateway', kind: 'xor' };
    expect(errorsOf(v)).toEqual([
      'processes[0].nodes[1].kind: unknown gateway kind "xor" (exclusive, parallel, inclusive, event-based)',
    ]);
    nodes(v)[1] = { source: 't', type: 'task', kind: 'script' };
    expect(errorsOf(v)).toEqual([
      'processes[0].nodes[1].kind: unknown task kind "script" (none, user, manual, service, send, receive)',
    ]);
  });

  it('D3 (a): no field or type that could become a calledElement', () => {
    const v = hand();
    nodes(v)[1] = { source: 't', type: 'call', target: 'Prüfung', calledElement: 'Process_x' };
    expect(errorsOf(v)).toEqual([
      'processes[0].nodes[1].calledElement: unknown field (a call names its target with "target"; analyzr never writes calledElement from a spec)',
    ]);
    nodes(v)[1] = { source: 't', type: 'callActivity', name: 'Prüfung', target: 'Prüfung' };
    // only the type: fields of some node type are not reported as unknown on top
    expect(errorsOf(v)).toEqual([
      'processes[0].nodes[1].type: unknown type "callActivity" (start, end, task, subprocess, call, event, gateway)',
    ]);
    nodes(v)[1] = { source: 't', type: 'call', name: 'Prüfen', target: 'Prüfung' };
    expect(errorsOf(v)).toEqual([
      'processes[0].nodes[1].name: unknown field (a call is named after its target; put a differing label into documentation)',
    ]);
    nodes(v)[1] = { source: 't', type: 'call', target: ' \u0007 ' };
    expect(errorsOf(v)).toEqual(['processes[0].nodes[1].target: must not be empty']);
    nodes(v)[1] = { source: 't', type: 'call' };
    expect(errorsOf(v)).toEqual([
      'processes[0].nodes[1].target: required (the callee as the source names it)',
    ]);
    nodes(v)[1] = { source: 't', type: 'task', id: 'Task_1' };
    expect(errorsOf(v)).toEqual([
      'processes[0].nodes[1].id: unknown field (the BPMN id derives from "source"; a spec contains no BPMN id)',
    ]);
  });

  it('source ids: unique over the whole spec, at most 200 characters, no control characters', () => {
    const v = hand();
    nodes(v)[1] = { source: 'p', type: 'task' };
    flows(v)[1] = { from: 's', to: 'e', source: 's' };
    nodes(v).push({ source: 'x'.repeat(201), type: 'task' }, { source: 'a\u0000b', type: 'task' });
    expect(errorsOf(v)).toEqual([
      'processes[0].nodes[1].source: "p" is used twice (also processes[0])',
      'processes[0].nodes[3].source: longer than 200 characters',
      'processes[0].nodes[4].source: contains control characters or lone surrogates',
      'processes[0].flows[1].source: "s" is used twice (also processes[0].nodes[0])',
      'processes[0].flows[0].to: no node "t" in process "p"',
    ]);
  });

  it('references: flows inside their process, lanes and data stores of the process', () => {
    const v = hand();
    (v['processes'] as Value[]).push({
      source: 'q',
      lanes: [{ source: 'l1' }],
      dataStores: [{ source: 'ds' }],
      nodes: [
        { source: 'q1', type: 'task', lane: 'l9', reads: ['ds', 'ds'], writes: ['nope'] },
        { source: 'q2', type: 'task', lane: 'l1' },
      ],
      flows: [{ from: 'q1', to: 't' }],
    });
    expect(errorsOf(v)).toEqual([
      'processes[1].nodes[0].lane: no lane "l9" in process "q"',
      'processes[1].nodes[0].reads[1]: "ds" is listed twice',
      'processes[1].nodes[0].writes[0]: no data store "nope" in process "q"',
      'processes[1].flows[0].to: no node "t" in process "q" (it lies in process "p"; a flow stays inside its process, a message flow connects pools)',
    ]);
  });

  it('message flows: two different pools, no gateway, known ends', () => {
    const v = hand();
    v['participants'] = [{ source: 'kunde', name: 'Kunde' }];
    nodes(v).push({ source: 'g', type: 'gateway', kind: 'exclusive' });
    v['messageFlows'] = [
      { from: 's', to: 't' },
      { from: 'kunde', to: 'kunde' },
      { from: 'g', to: 'kunde' },
      { from: 'x', to: 'p' },
      { from: 'kunde', to: 's', name: 'Anfrage' },
      { from: 'kunde', to: 's' },
      { from: 'p', to: 'kunde' },
    ];
    expect(errorsOf(v)).toEqual([
      'messageFlows[0]: both ends lie in process "p"; a message flow connects two pools',
      'messageFlows[1]: both ends are participant "kunde"; a message flow connects two pools',
      'messageFlows[2].from: gateway "g" sends and receives no messages: connect the task or event',
      'messageFlows[3].from: no node, process or participant "x"',
      'messageFlows[5]: a second message flow from "kunde" to "s": give each message flow between the same ends its own source',
    ]);
  });

  it('triggers fit the node type; message and signal names only where they belong', () => {
    const v = hand();
    nodes(v)[0] = { source: 's', type: 'start', trigger: 'terminate' };
    nodes(v)[1] = { source: 't', type: 'task', message: 'Auftrag' };
    nodes(v).push(
      { source: 'ev1', type: 'event', trigger: 'message' },
      { source: 'ev2', type: 'event', direction: 'catch', trigger: 'none' },
      { source: 'ev3', type: 'event', direction: 'throw', trigger: 'message', signal: 'X' },
      { source: 'ev4', type: 'event', direction: 'catch' },
      { source: 'ev5', type: 'end', trigger: 'timer' },
      { source: 'ev6', type: 'event', direction: 'both', trigger: 'message' },
    );
    expect(errorsOf(v)).toEqual([
      'processes[0].nodes[0].trigger: "terminate" is no trigger of a start (none, message, signal, timer)',
      'processes[0].nodes[1].message: only on a message trigger or a send or receive task',
      'processes[0].nodes[3].direction: required (catch or throw)',
      'processes[0].nodes[4].trigger: "none" is no trigger of a catch event (message, signal, timer)',
      'processes[0].nodes[5].signal: only on a signal trigger',
      'processes[0].nodes[6].trigger: required',
      'processes[0].nodes[7].trigger: "timer" is no trigger of an end (none, message, signal, terminate)',
      'processes[0].nodes[8].direction: unknown direction "both" (catch, throw)',
    ]);
  });

  it('flows: one per pair of nodes unless each has its own source', () => {
    const v = hand();
    flows(v).push({ from: 's', to: 't', name: 'nochmal' });
    expect(errorsOf(v)).toEqual([
      'processes[0].flows[2]: a second flow from "s" to "t": give each flow between the same nodes its own source',
    ]);
    flows(v)[0] = { from: 's', to: 't', source: 'f1' };
    flows(v)[2] = { from: 's', to: 't', source: 'f2' };
    expect(errorsOf(v)).toEqual([]);
  });

  it('converter output: tool ids and links as analyzr stores them', () => {
    const v = converter();
    v['source'] = {
      externalId: 'x'.repeat(256),
      externalPath: 'A',
      url: 'https://u:p@tool.example/m',
    };
    expect(errorsOf(v, 'converter')).toEqual([
      'source.externalId: longer than 255 characters',
      'source.url: contains a user name or password',
    ]);
    v['source'] = { externalId: 'a\u0001', externalPath: '/A//B', url: 'ftp://tool.example/m' };
    expect(errorsOf(v, 'converter')).toEqual([
      'source.externalId: contains control characters or lone surrogates',
      'source.url: not an http(s) link such as https://tool.example.com/model/4711',
      'source.externalPath: tool folders and the model name, "/"-separated, without empty parts (e.g. Vertrieb/Prozesse/Auftrag)',
    ]);
  });

  it('tool paths and export files analyzr can store', () => {
    const v = hand();
    v['source'] = { externalPath: `A/${'b'.repeat(1023)}`, file: `x/${'f'.repeat(1023)}` };
    expect(errorsOf(v)).toEqual([
      'source.externalPath: longer than 1024 characters',
      'source.file: a path below the export of at most 1024 characters without control characters',
    ]);
    v['source'] = { externalPath: 'A/B\u0007', file: 'x\u0000.vsdx' };
    expect(errorsOf(v)).toEqual([
      'source.externalPath: contains control characters or lone surrogates',
      'source.file: a path below the export of at most 1024 characters without control characters',
    ]);
    v['source'] = { externalPath: 'Service/Anfrage', file: 'bilder/whiteboard.jpg' };
    expect(errorsOf(v)).toEqual([]);
  });

  it('limits: at most 5000 nodes, 10000 flows and associations, 1000 parts and 100 errors per spec', () => {
    const v = hand();
    proc(v)['nodes'] = Array.from({ length: 5001 }, (_, i) => ({ source: `n${i}`, type: 'task' }));
    proc(v)['flows'] = [{ from: 'n0', to: 'nowhere' }];
    // over a limit, only the limit is reported: the references are not checked
    expect(errorsOf(v)).toEqual(['processes: 5001 nodes; a spec holds one model of at most 5000']);
    proc(v)['nodes'] = Array.from({ length: 2 }, (_, i) => ({
      source: `n${i}`,
      type: 'task',
      ...(i === 0 ? { reads: ['d'] } : {}),
    }));
    proc(v)['dataStores'] = [{ source: 'd' }];
    proc(v)['flows'] = Array.from({ length: 10_000 }, (_, i) => ({
      from: 'n0',
      to: 'n1',
      source: `f${i}`,
    }));
    expect(errorsOf(v)).toEqual([
      'processes: 10001 flows, message flows and data associations (reads, writes); a spec holds one model of at most 10000',
    ]);
    proc(v)['flows'] = [];
    proc(v)['lanes'] = Array.from({ length: 999 }, (_, i) => ({ source: `l${i}` }));
    expect(check(v).codes).toEqual(['too-many-parts']);
    expect(errorsOf(v)).toEqual([
      'processes: 1001 processes, participants, lanes and data stores; a spec holds one model of at most 1000',
    ]);
    proc(v)['lanes'] = [];
    proc(v)['dataStores'] = [];
    proc(v)['nodes'] = Array.from({ length: 150 }, () => ({ source: 'same', type: 'task' }));
    const lines = errorsOf(v);
    expect(lines).toHaveLength(101);
    expect(lines.at(-1)).toBe(': 49 more errors');
  });

  it('refuses a spec of 20000 processes for its size, without checking each against all', () => {
    const v = hand();
    v['processes'] = Array.from({ length: 20_000 }, (_, i) => ({
      source: `p${i}`,
      nodes: [{ source: `n${i}`, type: 'task' }],
    }));
    const started = performance.now();
    expect(check(v).codes).toEqual(['too-many-nodes', 'too-many-parts']);
    // a pass over every source per process took 80 s here; now it is linear and skipped
    expect(performance.now() - started).toBeLessThan(5000);
  });
});

describe('errors of a spec the agent wrote', () => {
  it('declares its derivation: reconstructed with the model it runs as', () => {
    const v = hand();
    delete v['derived'];
    expect(errorsOf(v)).toEqual([
      'derived: required in a spec you write: reconstructed (from a picture or PDF, with llmModel)',
    ]);
    v['derived'] = { kind: 'converted' };
    expect(errorsOf(v)).toEqual([
      'derived.kind: "converted" is set by analyzr-convert; a spec you write is "reconstructed"',
    ]);
    v['derived'] = { kind: 'export' };
    expect(errorsOf(v)).toEqual([
      'derived.kind: "export" is a tool\'s own BPMN; a spec you write is "reconstructed"',
    ]);
    v['derived'] = { kind: 'vision' };
    expect(errorsOf(v)).toEqual(['derived.kind: unknown kind "vision" (reconstructed, as-told)']);
    v['derived'] = { kind: 'reconstructed' };
    expect(errorsOf(v)).toEqual([
      'derived.llmModel: required for reconstructed (the model you run as)',
    ]);
    for (const llmModel of ['', ' ', 'm'.repeat(121), 'claude\nopus']) {
      v['derived'] = { kind: 'reconstructed', llmModel };
      expect(errorsOf(v), JSON.stringify(llmModel)).toEqual([
        'derived.llmModel: the model id you run as: 1 to 120 characters without control characters',
      ]);
    }
    v['derived'] = { kind: 'reconstructed', llmModel: 'm', from: ['src-1'] };
    expect(errorsOf(v)).toEqual(['derived.from: only for as-told (the interviews it comes from)']);
    v['derived'] = { kind: 'as-told', from: Array.from({ length: 101 }, (_, i) => `src-${i}`) };
    expect(errorsOf(v)).toEqual(['derived.from: at most 100 source ids']);
    v['derived'] = { kind: 'as-told', from: ['src-1', 'Frau Meier'] };
    expect(errorsOf(v)).toEqual([
      'derived.from[1]: an opaque source id ([A-Za-z0-9._:-], at most 64), never a name',
    ]);
    v['derived'] = { kind: 'as-told', from: ['src-1'] };
    expect(errorsOf(v)).toEqual([]);
  });

  it('carries no tool id and no link: a picture shows none', () => {
    const v = hand();
    v['source'] = { externalId: '4711', externalPath: 'A', url: 'https://tool.example/m' };
    expect(errorsOf(v)).toEqual([
      'source.externalId: a spec you write has no tool id or link: a picture shows none',
      'source.url: a spec you write has no tool id or link: a picture shows none',
    ]);
    v['source'] = { externalId: null, externalPath: 'A', url: null };
    expect(errorsOf(v)).toEqual([]);
  });

  it('draws starts, ends and lanes as BPMN wants them', () => {
    const v = hand();
    proc(v)['lanes'] = [{ source: 'l1', name: 'Service' }];
    for (const n of nodes(v)) n['lane'] = 'l1';
    delete nodes(v)[1]?.['lane'];
    flows(v).push({ from: 't', to: 's' }, { from: 'e', to: 't' });
    expect(errorsOf(v)).toEqual([
      'processes[0].nodes[1].lane: required, since the process has lanes',
      'processes[0].flows[2]: flows into start "s"; a start has no incoming flow',
      'processes[0].flows[3]: flows out of end "e"; an end has no outgoing flow',
    ]);
  });
});

describe('converter output', () => {
  it('declares no derivation: the run sets it', () => {
    expect(errorsOf(hand(), 'converter')).toEqual([
      'derived: set by analyzr-convert --derived; a converter does not declare its derivation',
    ]);
  });

  it('is rendered as the tool draws it: loose positions are warnings', () => {
    const v = converter();
    proc(v)['lanes'] = [{ source: 'l1', name: 'Service' }];
    for (const n of nodes(v)) n['lane'] = 'l1';
    delete nodes(v)[1]?.['lane'];
    flows(v).push({ from: 't', to: 's' }, { from: 'e', to: 't' });
    expect(check(v, 'converter')).toMatchObject({
      valid: true,
      warnings: [
        'processes[0].nodes[1].lane: none in a process with lanes: drawn below the lanes, no lane invented',
        'processes[0].flows[2]: flows into start "s"; a start has no incoming flow (rendered as given)',
        'processes[0].flows[3]: flows out of end "e"; an end has no outgoing flow (rendered as given)',
      ],
    });
  });
});

describe('warnings', () => {
  it('texts over their limit, nodes without a flow, a process without start or end, empty lanes', () => {
    const v = hand();
    proc(v)['documentation'] = 'd'.repeat(2001);
    proc(v)['lanes'] = [{ source: 'l1' }, { source: 'l2' }];
    for (const n of nodes(v)) n['lane'] = 'l1';
    nodes(v)[1] = { source: 't', type: 'task', name: 'n'.repeat(201), lane: 'l1' };
    nodes(v).push({ source: 'x', type: 'task', lane: 'l1' });
    nodes(v)[0] = { source: 's', type: 'task', lane: 'l1' };
    expect(check(v)).toMatchObject({
      valid: true,
      warnings: [
        'processes[0].documentation: cut to 2000 characters (loss text-truncated)',
        'processes[0].nodes[1].name: cut to 200 characters (loss text-truncated)',
        'processes[0].nodes[3]: no flow in or out',
        'processes[0]: no start',
        'processes[0].lanes[1]: no node in this lane',
      ],
    });
  });

  it('the name analyzr shows for a spec with several processes', () => {
    const v = hand();
    (v['processes'] as Value[]).push({
      source: 'a-first',
      pool: 'Einkauf',
      nodes: [{ source: 'a1', type: 'task' }],
    });
    expect(check(v).warnings).toContain(
      'processes: analyzr names the model "Einkauf" after its first process by id ("a-first")',
    );
    delete (v['processes'] as Value[])[1]?.['pool'];
    expect(check(v).warnings).toContain(
      'processes: analyzr shows the model without a name: its first process by id ("a-first") has neither pool nor name',
    );
  });

  it('notes cut for the report, a process without an end, and at most 100 warnings', () => {
    const v = hand();
    nodes(v)[1] = { source: 't', type: 'task', note: 'n'.repeat(501) };
    v['notes'] = ['kurz', 'm'.repeat(501)];
    nodes(v)[2] = { source: 'e', type: 'task' };
    expect(check(v)).toMatchObject({
      valid: true,
      warnings: [
        'processes[0].nodes[1].note: cut to 500 characters in the report',
        'notes[1]: cut to 500 characters in the report',
        'processes[0]: no end',
      ],
    });
    const many = hand();
    nodes(many).push(
      ...Array.from({ length: 150 }, (_, i) => ({ source: `lose${i}`, type: 'task' })),
    );
    const warnings = check(many).warnings;
    expect(warnings).toHaveLength(101);
    expect(warnings.at(-1)).toBe(': 50 more warnings');
  });
});

describe('the YAML reader', () => {
  const yaml = (lines: string[]) => parseSpecText(lines.join('\n'));
  const messages = (lines: string[]) => yaml(lines).errors.map((e) => `${e.path}: ${e.message}`);

  it('refuses anchors, aliases, merge keys, tags, duplicate keys, several documents and odd keys', () => {
    expect(messages(['a: &x 1', 'b: *x'])).toEqual([
      'line 1, column 7: anchors (&name) are not allowed: write every value out',
      'line 2, column 4: aliases (*name) are not allowed: write every value out',
    ]);
    expect(messages(['a: {k: 1}', 'b:', '  <<: {k: 2}'])).toEqual([
      'line 3, column 3: merge keys (<<) are not allowed: write every value out',
    ]);
    expect(messages(['a: !!binary aGVsbG8=', 'b: !foo bar'])).toEqual([
      'line 2, column 4: tags are not allowed; quote the value instead',
      'line 1, column 13: tags (tag:yaml.org,2002:binary) are not allowed; quote the value instead',
      'line 2, column 9: tags (!foo) are not allowed; quote the value instead',
    ]);
    expect(messages(['a: 1', 'a: 2'])).toEqual([
      'line 2, column 1: a key appears twice in one mapping',
    ]);
    expect(messages(['a: 1', '---', 'b: 2'])).toEqual([
      'line 2, column 1: more than one YAML document: write one spec per file',
    ]);
    expect(messages(['? [a, b]', ': 1', '1: x'])).toEqual([
      'line 1, column 3: keys are field names: write them as plain text',
      'line 3, column 1: keys are field names: write them as plain text',
    ]);
    expect(yaml(['a: [1, 2']).errors[0]).toMatchObject({ code: 'yaml', path: 'line 1, column 9' });
    expect(yaml(['a: 1']).value).toEqual({ a: 1 });
  });

  it('reads UTF-8 of at most 2 MB, JSON included', () => {
    const big = new Uint8Array(MAX_SPEC_BYTES + 1).fill(0x20);
    expect(parseSpecBytes(big).errors).toEqual([
      {
        path: '',
        code: 'too-large',
        message: `${MAX_SPEC_BYTES + 1} bytes; a spec holds one model in at most ${MAX_SPEC_BYTES} bytes`,
      },
    ]);
    expect(parseSpecBytes(new Uint8Array([0x61, 0x3a, 0x20, 0xff])).errors).toEqual([
      { path: '', code: 'encoding', message: 'not UTF-8: save the spec as UTF-8' },
    ]);
    const bom = new TextEncoder().encode('﻿a: ä');
    expect(parseSpecBytes(bom)).toEqual({ value: { a: 'ä' }, errors: [] });
    expect(parseSpecText('{"a": [1, "x"]}').value).toEqual({ a: [1, 'x'] });
  });

  it('writes specs that it reads back unchanged, never with an alias', async () => {
    const value = await readFixture('collaboration.spec.yaml');
    const shared = { source: 'x', name: '0012' };
    const withTwice = { ...(value as Value), participants: [shared, { ...shared, source: 'y' }] };
    const text = formatSpec(withTwice);
    expect(text).not.toMatch(/[&*]\w/);
    expect(parseSpecText(text)).toEqual({ value: withTwice, errors: [] });
    expect(parseSpecText(formatSpec({ id: '0012', v: '1.10', b: 'yes', n: 'null' })).value).toEqual(
      {
        id: '0012',
        v: '1.10',
        b: 'yes',
        n: 'null',
      },
    );
  });
});

describe('the zod-free copies of the manifest’s rules', () => {
  const manifestAccepts = (file: Value): boolean =>
    ImportManifest.safeParse({
      format: 'analyzr-import/1',
      source: { system: 'visio' },
      files: [{ path: 'a.bpmn', ...file }],
    }).success;

  it('refuse what the contracts refuse (externalId)', () => {
    for (const id of [
      '4711',
      'x'.repeat(255),
      'x'.repeat(256),
      '',
      'a\u0000b',
      'a\nb',
      'a\ud800b',
      'é😀',
    ]) {
      expect(externalIdProblem(id) === null, JSON.stringify(id)).toBe(
        manifestAccepts({ externalId: id }),
      );
    }
  });

  it('accept only links the contracts accept unchanged (url)', () => {
    const cases = [
      'https://tool.example/m/4711',
      'HTTP://TOOL.EXAMPLE/m',
      'http:tool.example/m',
      'https://',
      'ftp://tool.example/m',
      'https://user:secret@tool.example/m',
      'https://tool.example/a b',
      'https://tool.example/\u0001',
      `https://tool.example/${'x'.repeat(2030)}`,
      'mailto:a@b.c',
    ];
    for (const url of cases) {
      expect(urlProblem(url) === null, url).toBe(manifestAccepts({ url }));
    }
    // stricter where analyzr would store another value than the bundle declares
    for (const url of [' https://tool.example/m ', 'https://tool.exa\nmple/m']) {
      expect(manifestAccepts({ url })).toBe(true);
      expect(urlProblem(url)).not.toBeNull();
    }
  });
});

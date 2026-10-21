/**
 * The deterministic renderer of `analyzr-spec/1` (M6 S3c §3.3): one valid
 * spec becomes BPMN 2.0 XML with complete DI, written by bpmn-moddle without
 * engine extensions, and the same spec always gives the same bytes.
 *
 * - The root is `<bpmn:definitions id="Definitions_<key>" exporter="analyzr-spec">`
 *   without an exporter version, timestamps or modeler attributes, so
 *   analyzr finds no engine (`engine: null`) and a renderer release alone
 *   revises no model; every process is `isExecutable="false"`.
 * - Nothing executable: event definitions carry no expressions (an empty
 *   timer), messages and signals are root elements named only when the
 *   spec names them (else the label is the fact's key), conditions do not
 *   exist.
 * - A call is always a collapsed `bpmn:subProcess` named after its target,
 *   never a `bpmn:callActivity` with a `calledElement` (no call link is
 *   guessed), plus the loss `link-unresolved`; the consultant links it in
 *   analyzr („Verknüpfen mit …“).
 * - Semantic elements are written sorted by id (pools, lanes, nodes, flows,
 *   data stores), so shuffling the spec's lists or reordering its pools and
 *   lanes changes no semantic byte; the drawing keeps the list order of
 *   pools and lanes (`layout.ts`).
 * - The plane shows the collaboration when there are several processes,
 *   lanes, black-box participants or message flows, else the process.
 *
 * Every render runs the self-check (`check.ts`) and analyzr's size limits;
 * a model that fails them is refused, never written.
 */
import { createHash } from 'node:crypto';

import { selfCheck } from './check.ts';
import { assignIds, DIAGRAM_ID, pairKey, PLANE_ID, type SpecIds } from './ids.ts';
import {
  LayoutLimitError,
  layoutSpec,
  type LayoutInput,
  type LayoutNode,
  type ShapeKind,
} from './layout.ts';
import { create, specModdle, type CreatedElement } from './moddle.ts';
import { cleanBlock, cleanLine } from './text.ts';
import type { NodeType, Spec, SpecFlow, SpecNamed, SpecNode, SpecProcess } from './types.ts';

/** analyzr's limits for one BPMN file (`DEFAULT_PARSE_LIMITS` of `@analyzr/bpmn-facts`). */
export const MAX_RENDERED_BYTES = 5 * 1024 * 1024;
export const MAX_RENDERED_ELEMENTS = 50_000;

/** The `exporter` attribute of every rendered model. */
export const EXPORTER = 'analyzr-spec';

/** A loss the renderer declares (M6 §3.2), counted. */
export interface SpecLoss {
  code: string;
  count: number;
}

export interface RenderSummary {
  /** In the spec's order. */
  processes: { id: string; name: string | null }[];
  blackBoxParticipants: { id: string; name: string | null }[];
  /** Nodes per spec type. */
  nodes: Partial<Record<NodeType, number>>;
  /** The message and signal names the model declares. */
  messages: string[];
  signals: string[];
  /** Every call, drawn as a collapsed subprocess named after its target. */
  calls: { node: string; id: string; target: string }[];
  /** The texts that were cut (loss `text-truncated`): the element's BPMN id and the spec field, sorted. */
  textTruncated: { element: string; field: string }[];
  /** The name analyzr shows for the model: its first process by id, the pool's name, else the process's. */
  modelName: string | null;
  layout: { shapes: number; edges: number };
}

export interface RenderResult {
  /** The model as written (UTF-8, ends in a line break). */
  xml: string;
  bytes: Uint8Array;
  sha256: string;
  /** Sorted by code; only codes with a count. */
  losses: SpecLoss[];
  summary: RenderSummary;
}

export type RenderErrorCode = 'self-check' | 'too-large' | 'too-many-elements' | 'layout-too-large';

/** A model the renderer refuses to write. */
export class RenderError extends Error {
  readonly code: RenderErrorCode;
  readonly problems: string[];

  constructor(code: RenderErrorCode, message: string, problems: string[] = []) {
    super(message);
    this.name = 'RenderError';
    this.code = code;
    this.problems = problems;
  }
}

export interface RenderOptions {
  /** The model key the definitions and collaboration ids carry (`spec` outside a bundle). */
  key: string;
  /**
   * Inspects the XML before the self-check (tests only: to show that the
   * self-check refuses a broken render).
   */
  tamper?: (xml: string) => string;
}

const TASK_TYPES = {
  none: 'bpmn:Task',
  user: 'bpmn:UserTask',
  manual: 'bpmn:ManualTask',
  service: 'bpmn:ServiceTask',
  send: 'bpmn:SendTask',
  receive: 'bpmn:ReceiveTask',
} as const;

const GATEWAY_TYPES = {
  exclusive: 'bpmn:ExclusiveGateway',
  parallel: 'bpmn:ParallelGateway',
  inclusive: 'bpmn:InclusiveGateway',
  'event-based': 'bpmn:EventBasedGateway',
} as const;

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function get<K, V>(map: ReadonlyMap<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined) throw new Error('render: missing entry');
  return value;
}

const kindOf = (n: SpecNode): ShapeKind =>
  n.type === 'gateway'
    ? 'gateway'
    : n.type === 'start' || n.type === 'end' || n.type === 'event'
      ? 'event'
      : 'activity';

/**
 * The emitted texts of a spec: sanitized, cut, empty ones left out. A cut
 * one is noted by its element (the spec's object) and field, never by list
 * position, so the details do not change when the spec's lists are shuffled.
 */
class Texts {
  readonly truncated: { owner: object; field: string }[] = [];

  line(raw: string | null, owner: object, field: string): string | null {
    if (raw === null) return null;
    const { text, truncated } = cleanLine(raw);
    if (truncated) this.truncated.push({ owner, field });
    return text === '' ? null : text;
  }

  block(raw: string | null, owner: object, field: string): string | null {
    if (raw === null) return null;
    const { text, truncated } = cleanBlock(raw);
    if (truncated) this.truncated.push({ owner, field });
    return text === '' ? null : text;
  }
}

interface NodeTexts {
  name: string | null;
  documentation: string | null;
  target: string | null;
  message: string | null;
  signal: string | null;
}

/**
 * Renders a valid spec (as `validateSpec` returns it).
 *
 * @throws {RenderError} when the result fails the self-check or analyzr's size limits
 */
export async function renderSpec(spec: Spec, options: RenderOptions): Promise<RenderResult> {
  // 1. texts
  const t = new Texts();
  const nodeTexts = new Map<SpecNode, NodeTexts>();
  const flowNames = new Map<SpecFlow, string | null>();
  const processTexts = new Map<
    SpecProcess,
    { name: string | null; documentation: string | null; pool: string | null }
  >();
  const named = new Map<object, string | null>();
  for (const p of spec.processes) {
    processTexts.set(p, {
      name: t.line(p.name, p, 'name'),
      documentation: t.block(p.documentation, p, 'documentation'),
      pool: t.line(p.pool, p, 'pool'),
    });
    for (const l of p.lanes) named.set(l, t.line(l.name, l, 'name'));
    for (const d of p.dataStores) named.set(d, t.line(d.name, d, 'name'));
    for (const n of p.nodes) {
      nodeTexts.set(n, {
        name: t.line(n.name, n, 'name'),
        documentation: t.block(n.documentation, n, 'documentation'),
        target: t.line(n.target, n, 'target'),
        message: t.line(n.message, n, 'message'),
        signal: t.line(n.signal, n, 'signal'),
      });
    }
    for (const f of p.flows) flowNames.set(f, t.line(f.name, f, 'name'));
  }
  for (const pt of spec.participants) named.set(pt, t.line(pt.name, pt, 'name'));
  for (const f of spec.messageFlows) flowNames.set(f, t.line(f.name, f, 'name'));
  const messages = new Set<string>();
  const signals = new Set<string>();
  for (const nt of nodeTexts.values()) {
    if (nt.message !== null) messages.add(nt.message);
    if (nt.signal !== null) signals.add(nt.signal);
  }

  // 2. ids
  const collaboration =
    spec.processes.length > 1 ||
    spec.processes.some((p) => p.lanes.length > 0) ||
    spec.participants.length > 0 ||
    spec.messageFlows.length > 0;
  const ids = assignIds(spec, {
    key: options.key,
    messages: [...messages],
    signals: [...signals],
    collaboration,
  });
  const nodeId = (n: SpecNode): string => get(ids.nodes, n);
  const nodeBySource = new Map<string, { node: SpecNode; process: SpecProcess }>();
  for (const p of spec.processes)
    for (const n of p.nodes) nodeBySource.set(n.source, { node: n, process: p });
  const lanesBySource = new Map<string, string>();
  const storesBySource = new Map<string, string>();
  for (const p of spec.processes) {
    for (const l of p.lanes) lanesBySource.set(l.source, get(ids.lanes, l));
    for (const d of p.dataStores) storesBySource.set(d.source, get(ids.dataStores, d));
  }
  // sources are unique over the spec, and a node names only its own process's stores
  const storeId = (source: string): string => get(storesBySource, source);
  const byId = <T>(items: readonly T[], id: (item: T) => string): T[] =>
    [...items].sort((a, b) => compare(id(a), id(b)));

  // 3. layout
  const processBySource = new Map(spec.processes.map((p) => [p.source, p]));
  const blackBySource = new Map(spec.participants.map((pt) => [pt.source, pt]));
  const endpoint = (source: string): { id: string; pool: string } => {
    const placed = nodeBySource.get(source);
    if (placed !== undefined) {
      return { id: nodeId(placed.node), pool: get(ids.processes, placed.process).participant };
    }
    const proc = processBySource.get(source);
    if (proc !== undefined) {
      const participant = get(ids.processes, proc).participant;
      return { id: participant, pool: participant };
    }
    const black = blackBySource.get(source);
    const id = black === undefined ? '' : get(ids.participants, black);
    return { id, pool: id };
  };
  /** A process's nodes by the data store they read or write. */
  const usersOf = (p: SpecProcess): Map<string, SpecNode[]> => {
    const users = new Map<string, SpecNode[]>();
    for (const n of p.nodes) {
      for (const ds of new Set([...n.reads, ...n.writes])) {
        const list = users.get(ds);
        if (list === undefined) users.set(ds, [n]);
        else list.push(n);
      }
    }
    return users;
  };
  const storeUsers = new Map(spec.processes.map((p) => [p, usersOf(p)]));
  const layoutInput: LayoutInput = {
    collaboration,
    processes: spec.processes.map((p) => ({
      participant: get(ids.processes, p).participant,
      lanes: p.lanes.map((l) => get(ids.lanes, l)),
      nodes: byId(p.nodes, nodeId).map((n): LayoutNode => ({
        id: nodeId(n),
        kind: kindOf(n),
        label: kindOf(n) === 'activity' ? null : get(nodeTexts, n).name,
        lane: n.lane === null ? null : get(lanesBySource, n.lane),
        isStart: n.type === 'start',
      })),
      flows: byId(p.flows, (f) => get(ids.flows, f)).map((f) => ({
        id: get(ids.flows, f),
        from: nodeId(get(nodeBySource, f.from).node),
        to: nodeId(get(nodeBySource, f.to).node),
        label: get(flowNames, f),
      })),
      stores: byId(p.dataStores, (d) => get(ids.dataStores, d)).map((d) => ({
        id: get(ids.dataStores, d),
        label: get(named, d),
        users: (get(storeUsers, p).get(d.source) ?? []).map(nodeId),
      })),
      associations: p.nodes
        .flatMap((n) => [
          ...n.reads.map((ds) => {
            const store = storeId(ds);
            return {
              id: get(ids.inputs, pairKey(nodeId(n), store)),
              node: nodeId(n),
              store,
              read: true,
            };
          }),
          ...n.writes.map((ds) => {
            const store = storeId(ds);
            return {
              id: get(ids.outputs, pairKey(nodeId(n), store)),
              node: nodeId(n),
              store,
              read: false,
            };
          }),
        ])
        .sort((a, b) => compare(a.id, b.id)),
    })),
    blackBoxes: spec.participants.map((pt) => get(ids.participants, pt)),
    messageFlows: byId(spec.messageFlows, (f) => get(ids.messageFlows, f)).map((f) => {
      const from = endpoint(f.from);
      const to = endpoint(f.to);
      return {
        id: get(ids.messageFlows, f),
        from: from.id,
        to: to.id,
        fromPool: from.pool,
        toPool: to.pool,
        label: get(flowNames, f),
      };
    }),
  };
  let layout;
  try {
    layout = layoutSpec(layoutInput);
  } catch (err) {
    if (!(err instanceof LayoutLimitError)) throw err;
    throw new RenderError('layout-too-large', err.message);
  }

  // 4. the semantic model
  const docs = (text: string | null) =>
    text === null ? undefined : [create('bpmn:Documentation', { text })];
  const elements = new Map<string, CreatedElement>();
  const keep = (el: CreatedElement, id: string): CreatedElement => {
    elements.set(id, el);
    return el;
  };
  const messageEls = new Map<string, CreatedElement>();
  for (const [name, id] of [...ids.messages].sort(([, a], [, b]) => compare(a, b))) {
    messageEls.set(name, create('bpmn:Message', { id, name }));
  }
  const signalEls = new Map<string, CreatedElement>();
  for (const [name, id] of [...ids.signals].sort(([, a], [, b]) => compare(a, b))) {
    signalEls.set(name, create('bpmn:Signal', { id, name }));
  }
  const definitionsOf = (n: SpecNode, nt: NodeTexts): CreatedElement[] | undefined => {
    switch (n.trigger) {
      case 'message':
        return [
          create('bpmn:MessageEventDefinition', {
            messageRef: nt.message === null ? undefined : messageEls.get(nt.message),
          }),
        ];
      case 'signal':
        return [
          create('bpmn:SignalEventDefinition', {
            signalRef: nt.signal === null ? undefined : signalEls.get(nt.signal),
          }),
        ];
      case 'timer':
        return [create('bpmn:TimerEventDefinition')];
      case 'terminate':
        return [create('bpmn:TerminateEventDefinition')];
      case 'none':
      case null:
        return undefined;
    }
  };
  const calls: RenderSummary['calls'] = [];
  const counts: Partial<Record<NodeType, number>> = {};
  const processEls: { p: SpecProcess; id: string; el: CreatedElement }[] = [];
  for (const p of spec.processes) {
    const pids = get(ids.processes, p);
    const pt = get(processTexts, p);
    const storeEls = new Map<string, CreatedElement>();
    for (const d of byId(p.dataStores, (x) => get(ids.dataStores, x))) {
      const id = get(ids.dataStores, d);
      storeEls.set(
        d.source,
        keep(create('bpmn:DataStoreReference', { id, name: get(named, d) ?? undefined }), id),
      );
    }
    const nodeEls = new Map<SpecNode, CreatedElement>();
    for (const n of byId(p.nodes, nodeId)) {
      const nt = get(nodeTexts, n);
      const id = nodeId(n);
      counts[n.type] = (counts[n.type] ?? 0) + 1;
      const base = { id, name: nt.name ?? undefined, documentation: docs(nt.documentation) };
      let el: CreatedElement;
      switch (n.type) {
        case 'start':
          el = create('bpmn:StartEvent', { ...base, eventDefinitions: definitionsOf(n, nt) });
          break;
        case 'end':
          el = create('bpmn:EndEvent', { ...base, eventDefinitions: definitionsOf(n, nt) });
          break;
        case 'event':
          el = create(
            n.direction === 'throw' ? 'bpmn:IntermediateThrowEvent' : 'bpmn:IntermediateCatchEvent',
            { ...base, eventDefinitions: definitionsOf(n, nt) },
          );
          break;
        case 'task':
          el = create(TASK_TYPES[n.taskKind ?? 'none'], {
            ...base,
            messageRef: nt.message === null ? undefined : messageEls.get(nt.message),
          });
          break;
        case 'subprocess':
          el = create('bpmn:SubProcess', base);
          break;
        case 'call': {
          const target = nt.target ?? '';
          el = create('bpmn:SubProcess', { ...base, name: target });
          calls.push({ node: n.source, id, target });
          break;
        }
        case 'gateway':
          el = create(GATEWAY_TYPES[n.gatewayKind ?? 'exclusive'], base);
          break;
      }
      if (n.reads.length > 0) {
        const property = create('bpmn:Property', {
          id: get(ids.properties, n),
          name: '__targetRef_placeholder',
        });
        el.set('properties', [property]);
        el.set(
          'dataInputAssociations',
          byId(n.reads, (ds) => get(ids.inputs, pairKey(id, storeId(ds)))).map((ds) => {
            const aid = get(ids.inputs, pairKey(id, storeId(ds)));
            return keep(
              create('bpmn:DataInputAssociation', {
                id: aid,
                sourceRef: [get(storeEls, ds)],
                targetRef: property,
              }),
              aid,
            );
          }),
        );
      }
      if (n.writes.length > 0) {
        el.set(
          'dataOutputAssociations',
          byId(n.writes, (ds) => get(ids.outputs, pairKey(id, storeId(ds)))).map((ds) => {
            const aid = get(ids.outputs, pairKey(id, storeId(ds)));
            return keep(
              create('bpmn:DataOutputAssociation', { id: aid, targetRef: get(storeEls, ds) }),
              aid,
            );
          }),
        );
      }
      nodeEls.set(n, keep(el, id));
    }
    const incoming = new Map<SpecNode, CreatedElement[]>();
    const outgoing = new Map<SpecNode, CreatedElement[]>();
    const flowEls = byId(p.flows, (f) => get(ids.flows, f)).map((f) => {
      const id = get(ids.flows, f);
      const from = get(nodeBySource, f.from).node;
      const to = get(nodeBySource, f.to).node;
      const el = keep(
        create('bpmn:SequenceFlow', {
          id,
          name: get(flowNames, f) ?? undefined,
          sourceRef: get(nodeEls, from),
          targetRef: get(nodeEls, to),
        }),
        id,
      );
      for (const [map, node] of [
        [outgoing, from],
        [incoming, to],
      ] as const) {
        const list = map.get(node);
        if (list === undefined) map.set(node, [el]);
        else list.push(el);
      }
      return el;
    });
    for (const [n, el] of nodeEls) {
      const inc = incoming.get(n);
      const out = outgoing.get(n);
      if (inc !== undefined) el.set('incoming', inc);
      if (out !== undefined) el.set('outgoing', out);
    }
    const laneNodes = new Map<string, CreatedElement[]>();
    for (const [n, el] of nodeEls) {
      if (n.lane === null) continue;
      const list = laneNodes.get(n.lane);
      if (list === undefined) laneNodes.set(n.lane, [el]);
      else list.push(el);
    }
    const laneSets =
      p.lanes.length === 0
        ? undefined
        : [
            create('bpmn:LaneSet', {
              id: pids.laneSet,
              lanes: byId(p.lanes, (l) => get(ids.lanes, l)).map((l) => {
                const id = get(ids.lanes, l);
                return keep(
                  create('bpmn:Lane', {
                    id,
                    name: get(named, l) ?? undefined,
                    flowNodeRef: laneNodes.get(l.source) ?? [],
                  }),
                  id,
                );
              }),
            }),
          ];
    const el = create('bpmn:Process', {
      id: pids.process,
      name: pt.name ?? undefined,
      isExecutable: false,
      documentation: docs(pt.documentation),
      laneSets,
      flowElements: [...nodeEls.values(), ...storeEls.values(), ...flowEls],
    });
    processEls.push({ p, id: pids.process, el: keep(el, pids.process) });
  }

  // the collaboration
  let collaborationEl: CreatedElement | null = null;
  const participantNames = new Map<SpecProcess, string | null>();
  if (collaboration) {
    const participants: { id: string; el: CreatedElement }[] = [];
    for (const { p, el } of processEls) {
      const pt = get(processTexts, p);
      const name = pt.pool ?? pt.name;
      participantNames.set(p, name);
      const id = get(ids.processes, p).participant;
      participants.push({
        id,
        el: keep(create('bpmn:Participant', { id, name: name ?? undefined, processRef: el }), id),
      });
    }
    for (const pt of spec.participants) {
      const id = get(ids.participants, pt);
      participants.push({
        id,
        el: keep(create('bpmn:Participant', { id, name: get(named, pt) ?? undefined }), id),
      });
    }
    const messageFlowEls = layoutInput.messageFlows.map((mf) =>
      keep(
        create('bpmn:MessageFlow', {
          id: mf.id,
          name: mf.label ?? undefined,
          sourceRef: get(elements, mf.from),
          targetRef: get(elements, mf.to),
        }),
        mf.id,
      ),
    );
    collaborationEl = create('bpmn:Collaboration', {
      id: ids.collaboration,
      participants: byId(participants, (x) => x.id).map((x) => x.el),
      messageFlows: messageFlowEls.length === 0 ? undefined : messageFlowEls,
    });
  }

  // 5. DI: pools, lanes, nodes and data stores, then flows, data associations, message flows
  const shapeIds = [...layout.shapes.keys()];
  const order = (id: string): number => {
    const type = elements.get(id)?.$type ?? '';
    return type === 'bpmn:Participant' ? 0 : type === 'bpmn:Lane' ? 1 : 2;
  };
  const planeElements: CreatedElement[] = [];
  for (const id of shapeIds.sort((a, b) => order(a) - order(b) || compare(a, b))) {
    const s = get(layout.shapes, id);
    const el = get(elements, id);
    planeElements.push(
      create('bpmndi:BPMNShape', {
        id: get(ids.di, id),
        bpmnElement: el,
        isHorizontal: s.horizontal,
        isExpanded: el.$type === 'bpmn:SubProcess' ? false : undefined,
        bounds: create('dc:Bounds', s.bounds),
        label:
          s.label === undefined
            ? undefined
            : create('bpmndi:BPMNLabel', { bounds: create('dc:Bounds', s.label) }),
      }),
    );
  }
  const edgeOrder = (id: string): number => {
    const type = elements.get(id)?.$type ?? '';
    return type === 'bpmn:SequenceFlow' ? 0 : type === 'bpmn:MessageFlow' ? 2 : 1;
  };
  for (const id of [...layout.edges.keys()].sort(
    (a, b) => edgeOrder(a) - edgeOrder(b) || compare(a, b),
  )) {
    const e = get(layout.edges, id);
    planeElements.push(
      create('bpmndi:BPMNEdge', {
        id: get(ids.di, id),
        bpmnElement: get(elements, id),
        waypoint: e.waypoints.map((pt) => create('dc:Point', pt)),
        label:
          e.label === undefined
            ? undefined
            : create('bpmndi:BPMNLabel', { bounds: create('dc:Bounds', e.label) }),
      }),
    );
  }
  const firstProcess = processEls[0]?.el;
  const plane = create('bpmndi:BPMNPlane', {
    id: PLANE_ID,
    bpmnElement: collaborationEl ?? firstProcess,
    planeElement: planeElements,
  });
  const definitions = create('bpmn:Definitions', {
    id: ids.definitions,
    targetNamespace: 'http://bpmn.io/schema/bpmn',
    exporter: EXPORTER,
    rootElements: [
      ...(collaborationEl === null ? [] : [collaborationEl]),
      ...byId(processEls, (x) => x.id).map((x) => x.el),
      ...messageEls.values(),
      ...signalEls.values(),
    ],
    diagrams: [create('bpmndi:BPMNDiagram', { id: DIAGRAM_ID, plane })],
  });
  const { xml: written } = await specModdle().toXML(definitions, { format: true });
  const xml0 = written.endsWith('\n') ? written : `${written}\n`;
  const xml = options.tamper === undefined ? xml0 : options.tamper(xml0);

  // 6. checks and limits
  const bytes = new TextEncoder().encode(xml);
  if (bytes.length > MAX_RENDERED_BYTES) {
    throw new RenderError(
      'too-large',
      `the rendered model has ${bytes.length} bytes; analyzr reads at most ${MAX_RENDERED_BYTES}: split the model`,
    );
  }
  const check = await selfCheck(xml);
  if (check.elements > MAX_RENDERED_ELEMENTS) {
    throw new RenderError(
      'too-many-elements',
      `the rendered model has ${check.elements} elements; analyzr reads at most ${MAX_RENDERED_ELEMENTS}: split the model`,
    );
  }
  if (check.problems.length > 0) {
    throw new RenderError(
      'self-check',
      `the rendered model failed the self-check: ${check.problems[0] ?? ''}`,
      check.problems,
    );
  }

  const losses: SpecLoss[] = [
    { code: 'id-rewritten', count: ids.rewritten },
    { code: 'layout-generated', count: layout.shapes.size },
    { code: 'link-unresolved', count: calls.length },
    { code: 'text-truncated', count: t.truncated.length },
  ].filter((l) => l.count > 0);
  return {
    xml,
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    losses,
    summary: {
      processes: spec.processes.map((p) => ({
        id: get(ids.processes, p).process,
        name: get(processTexts, p).name,
      })),
      blackBoxParticipants: spec.participants.map((pt) => ({
        id: get(ids.participants, pt),
        name: get(named, pt),
      })),
      nodes: counts,
      messages: [...messages].sort(compare),
      signals: [...signals].sort(compare),
      calls: calls.sort((a, b) => compare(a.id, b.id)),
      textTruncated: truncatedOf(t, ids),
      modelName: modelNameOf(spec, ids, processTexts, participantNames),
      layout: { shapes: layout.shapes.size, edges: layout.edges.size },
    },
  };
}

/** The cut texts by element id and field, sorted (see {@link Texts}). */
function truncatedOf(t: Texts, ids: SpecIds): RenderSummary['textTruncated'] {
  const idOf = (owner: object): string =>
    ids.nodes.get(owner as SpecNode) ??
    ids.flows.get(owner as SpecFlow) ??
    ids.messageFlows.get(owner as SpecFlow) ??
    ids.processes.get(owner as SpecProcess)?.process ??
    ids.lanes.get(owner as SpecNamed) ??
    ids.dataStores.get(owner as SpecNamed) ??
    ids.participants.get(owner as SpecNamed) ??
    '';
  return t.truncated
    .map(({ owner, field }) => ({ element: idOf(owner), field }))
    .sort((a, b) => compare(a.element, b.element) || compare(a.field, b.field));
}

/**
 * The name analyzr shows for the model (`apps/server/src/domain/ingest.ts`):
 * of the first process by id, its participant's name, else its own.
 */
function modelNameOf(
  spec: Spec,
  ids: SpecIds,
  texts: ReadonlyMap<SpecProcess, { name: string | null }>,
  participants: ReadonlyMap<SpecProcess, string | null>,
): string | null {
  const first = [...spec.processes].sort((a, b) =>
    compare(get(ids.processes, a).process, get(ids.processes, b).process),
  )[0];
  if (first === undefined) return null;
  return participants.get(first) ?? texts.get(first)?.name ?? null;
}

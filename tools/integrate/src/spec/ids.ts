/**
 * The one id function of the renderer (M6 S3c §2.6): every id a rendered
 * model contains, DI ids included, is made here, from the spec's sources
 * and never from list positions, so a re-export keeps every id.
 *
 * - `<Prefix>_<source>` for a source that is a safe id (`SAFE_ID_PATTERN`
 *   of `src/ids.ts`), else `sanitizeId`'s form (umlauts transliterated,
 *   anything else outside `[A-Za-z0-9_.-]` as `_`). The prefix is the
 *   element's category, not its exact type (`Activity` for every task kind,
 *   collapsed subprocesses and calls; `Event` for every event; `Gateway` for
 *   every gateway), so a type refinement keeps the id and every anchor on it
 *   (`<key>#<elementId>`), as bpmn-js and the Camunda Modeler name elements.
 * - Ids made of other ids use their bodies, never raw sources:
 *   `LaneSet_<process body>`, `Flow_<from body>_<to body>`,
 *   `DataInputAssociation_<node body>_<store body>`; messages and signals
 *   `Message_<name>` by their exact name.
 * - At most 255 characters: a longer id is cut and ends in
 *   `_<shortHash(raw value)>`.
 * - Collisions: unsafe sources that come out alike each get
 *   `_<shortHash(source)>` (a safe source never changes), and so do message
 *   or signal names that come out alike. Then a final pass over every id in
 *   a fixed order (sourced ids, then derived ones, then DI ids, each sorted
 *   by prefix and raw value) gives any remaining clash the hash suffix. No
 *   suffix depends on list order.
 * - bpmn-js derives ids of its own when it imports a model: `<id>_label`
 *   for an external label and `<id>_plane` for a collapsed subprocess's
 *   drill-down plane, in the same registry as the elements. So no element
 *   id may be another's id plus `_label` or `_plane` (`Event_x` next to
 *   `Event_x_label` would leave one element undrawn, `Activity_c` next to
 *   `Activity_c_plane` fails the import): the final pass treats them as
 *   taken, for every element (a name or a type refinement keeps every id).
 *
 * Every source whose id is not `<Prefix>_<source>` and every id the final
 * pass changed counts as the loss `id-rewritten`.
 */
import { MAX_ID_LENGTH, SAFE_ID_PATTERN, sanitizeId, shortHash } from '../ids.ts';

import type { Spec, SpecFlow, SpecNamed, SpecNode, SpecProcess } from './types.ts';

export const PREFIX = {
  process: 'Process',
  participant: 'Participant',
  lane: 'Lane',
  laneSet: 'LaneSet',
  event: 'Event',
  activity: 'Activity',
  gateway: 'Gateway',
  dataStore: 'DataStoreReference',
  flow: 'Flow',
  messageFlow: 'MessageFlow',
  message: 'Message',
  signal: 'Signal',
  dataInput: 'DataInputAssociation',
  dataOutput: 'DataOutputAssociation',
  property: 'Property',
  definitions: 'Definitions',
  collaboration: 'Collaboration',
} as const;

/** The diagram's fixed ids (no element of the spec can take them: every other id has a prefix). */
export const DIAGRAM_ID = 'BPMNDiagram_1';
export const PLANE_ID = 'BPMNPlane_1';

/** The suffixes bpmn-js appends to an element's id for ids of its own (label, drill-down plane). */
export const BPMNJS_SUFFIXES: readonly string[] = ['_label', '_plane'];

/** `id` cut to {@link MAX_ID_LENGTH}, ending in a hash of `raw` when cut (a copy of `capped` in `src/ids.ts`). */
export function capped(id: string, source: string): string {
  return id.length <= MAX_ID_LENGTH ? id : `${id.slice(0, MAX_ID_LENGTH - 9)}_${shortHash(source)}`;
}

/**
 * `candidate` if `taken` says it is free, else the first free
 * `<candidate>_<n>` for n = `from`, `from` + 1, … (a copy of `uniqueId` in `src/ids.ts`).
 */
export function uniqueId(candidate: string, taken: (id: string) => boolean, from = 2): string {
  if (!taken(candidate)) return candidate;
  for (let n = from; ; n++) {
    const suffix = `_${n}`;
    const id = `${candidate.slice(0, MAX_ID_LENGTH - suffix.length)}${suffix}`;
    if (!taken(id)) return id;
  }
}

/** True for an id analyzr and bpmn-moddle both accept unchanged. */
export function isRenderedId(id: string): boolean {
  return id.length <= MAX_ID_LENGTH && SAFE_ID_PATTERN.test(id);
}

/** `<prefix>_<raw>` for a safe `raw`, else `sanitizeId`'s form; at most 255 characters. */
export function idFor(prefix: string, raw: string): string {
  return SAFE_ID_PATTERN.test(raw) ? capped(`${prefix}_${raw}`, raw) : sanitizeId(raw, prefix);
}

/** `id` with `_<shortHash(raw)>` appended (cut to 255). */
function withHash(id: string, raw: string): string {
  return capped(`${id}_${shortHash(raw)}`, raw);
}

/** The part of an id after its prefix. */
function bodyOf(id: string, prefix: string): string {
  return id.slice(prefix.length + 1);
}

/** The prefix of a node's id: its category. */
export function nodePrefix(node: SpecNode): string {
  switch (node.type) {
    case 'start':
    case 'end':
    case 'event':
      return PREFIX.event;
    case 'gateway':
      return PREFIX.gateway;
    case 'task':
    case 'subprocess':
    case 'call':
      return PREFIX.activity;
  }
}

export interface ProcessIds {
  process: string;
  participant: string;
  laneSet: string;
}

/** Every id of a rendered spec. */
export interface SpecIds {
  definitions: string;
  collaboration: string;
  processes: Map<SpecProcess, ProcessIds>;
  /** Black-box participants. */
  participants: Map<SpecNamed, string>;
  lanes: Map<SpecNamed, string>;
  dataStores: Map<SpecNamed, string>;
  nodes: Map<SpecNode, string>;
  /** The `__targetRef_placeholder` property of a node that reads a data store. */
  properties: Map<SpecNode, string>;
  flows: Map<SpecFlow, string>;
  messageFlows: Map<SpecFlow, string>;
  /** By `<node id> <data store id>`. */
  inputs: Map<string, string>;
  outputs: Map<string, string>;
  /** By the exact (cleaned) name. */
  messages: Map<string, string>;
  signals: Map<string, string>;
  /** Semantic id → its DI shape's or edge's id. */
  di: Map<string, string>;
  /** Sources whose id is not `<Prefix>_<source>`, plus ids the final pass changed. */
  rewritten: number;
}

/** What the ids derive from besides the spec. */
export interface IdOptions {
  /** The model key the definitions and collaboration ids carry (`spec` outside a bundle). */
  key: string;
  /** The exact message and signal names the model writes (cleaned). */
  messages: readonly string[];
  signals: readonly string[];
  /** The diagram shows a collaboration: participants get DI. */
  collaboration: boolean;
}

/** A pair's key in {@link SpecIds.inputs} and {@link SpecIds.outputs}. */
export const pairKey = (nodeId: string, storeId: string): string => `${nodeId} ${storeId}`;

interface Entry {
  prefix: string;
  raw: string;
  id: string;
  assign: (id: string) => void;
}

const PREFIX_ORDER: readonly string[] = Object.values(PREFIX);
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byPrefixAndRaw = (a: Entry, b: Entry): number =>
  PREFIX_ORDER.indexOf(a.prefix) - PREFIX_ORDER.indexOf(b.prefix) || compare(a.raw, b.raw);

/**
 * Ids from sources that came out alike: every unsafe source among them gets
 * the hash suffix; with `all`, every member does (names, where none is the
 * tool's id).
 */
function separate(entries: readonly Entry[], all: boolean): void {
  const groups = new Map<string, Entry[]>();
  for (const e of entries) {
    const group = groups.get(e.id);
    if (group === undefined) groups.set(e.id, [e]);
    else group.push(e);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const e of group) {
      if (all || !SAFE_ID_PATTERN.test(e.raw)) e.id = withHash(e.id, e.raw);
    }
  }
}

/** Assigns every id of `spec` (see the module comment). */
export function assignIds(spec: Spec, options: IdOptions): SpecIds {
  const ids: SpecIds = {
    definitions: '',
    collaboration: '',
    processes: new Map(),
    participants: new Map(),
    lanes: new Map(),
    dataStores: new Map(),
    nodes: new Map(),
    properties: new Map(),
    flows: new Map(),
    messageFlows: new Map(),
    inputs: new Map(),
    outputs: new Map(),
    messages: new Map(),
    signals: new Map(),
    di: new Map(),
    rewritten: 0,
  };
  const storesBySource = new Map<SpecProcess, Map<string, SpecNamed>>();

  // 1. Ids of the elements with a source of their own.
  const sourced: Entry[] = [];
  const add = (list: Entry[], prefix: string, raw: string, assign: (id: string) => void): void => {
    list.push({ prefix, raw, id: idFor(prefix, raw), assign });
  };
  for (const p of spec.processes) {
    const entry: ProcessIds = { process: '', participant: '', laneSet: '' };
    ids.processes.set(p, entry);
    add(sourced, PREFIX.process, p.source, (id) => (entry.process = id));
    for (const l of p.lanes) add(sourced, PREFIX.lane, l.source, (id) => ids.lanes.set(l, id));
    for (const d of p.dataStores) {
      add(sourced, PREFIX.dataStore, d.source, (id) => ids.dataStores.set(d, id));
    }
    for (const n of p.nodes) add(sourced, nodePrefix(n), n.source, (id) => ids.nodes.set(n, id));
    for (const f of p.flows) {
      if (f.source !== null) add(sourced, PREFIX.flow, f.source, (id) => ids.flows.set(f, id));
    }
  }
  for (const pt of spec.participants) {
    add(sourced, PREFIX.participant, pt.source, (id) => ids.participants.set(pt, id));
  }
  for (const mf of spec.messageFlows) {
    if (mf.source !== null) {
      add(sourced, PREFIX.messageFlow, mf.source, (id) => ids.messageFlows.set(mf, id));
    }
  }
  separate(sourced, false);
  for (const e of sourced) {
    if (e.id !== `${e.prefix}_${e.raw}`) ids.rewritten++;
  }

  // 2. Ids made of other ids' bodies, and of names.
  const derived: Entry[] = [];
  const bodies = new Map<string, string>();
  for (const e of sourced) bodies.set(`${e.prefix}:${e.raw}`, bodyOf(e.id, e.prefix));
  const body = (prefix: string, source: string): string => bodies.get(`${prefix}:${source}`) ?? '';
  const derive = (prefix: string, b: string, raw: string, assign: (id: string) => void): void => {
    derived.push({ prefix, raw, id: capped(`${prefix}_${b}`, raw), assign });
  };
  const nodeBody = new Map<string, string>();
  const endpointBody = new Map<string, string>();
  for (const p of spec.processes) {
    const pb = body(PREFIX.process, p.source);
    const entry = ids.processes.get(p) ?? { process: '', participant: '', laneSet: '' };
    derive(PREFIX.participant, pb, p.source, (id) => (entry.participant = id));
    derive(PREFIX.laneSet, pb, p.source, (id) => (entry.laneSet = id));
    endpointBody.set(p.source, pb);
    for (const n of p.nodes) {
      const nb = body(nodePrefix(n), n.source);
      nodeBody.set(n.source, nb);
      endpointBody.set(n.source, nb);
      if (n.reads.length > 0) {
        derive(PREFIX.property, nb, n.source, (id) => ids.properties.set(n, id));
      }
    }
    for (const n of p.nodes) {
      const nb = nodeBody.get(n.source) ?? '';
      for (const [list, prefix, map] of [
        [n.reads, PREFIX.dataInput, ids.inputs],
        [n.writes, PREFIX.dataOutput, ids.outputs],
      ] as const) {
        for (const ds of list) {
          const db = body(PREFIX.dataStore, ds);
          derive(prefix, `${nb}_${db}`, `${n.source}\u0000${ds}`, (id) =>
            map.set(pairKey(nodeIdOf(n), dataStoreIdOf(p, ds)), id),
          );
        }
      }
    }
    for (const f of p.flows) {
      if (f.source !== null) continue;
      const b = `${nodeBody.get(f.from) ?? ''}_${nodeBody.get(f.to) ?? ''}`;
      derive(PREFIX.flow, b, `${f.from}\u0000${f.to}`, (id) => ids.flows.set(f, id));
    }
  }
  for (const pt of spec.participants) {
    endpointBody.set(pt.source, body(PREFIX.participant, pt.source));
  }
  for (const mf of spec.messageFlows) {
    if (mf.source !== null) continue;
    const b = `${endpointBody.get(mf.from) ?? ''}_${endpointBody.get(mf.to) ?? ''}`;
    derive(PREFIX.messageFlow, b, `${mf.from}\u0000${mf.to}`, (id) => ids.messageFlows.set(mf, id));
  }
  const named: Entry[] = [];
  for (const [names, prefix, map] of [
    [options.messages, PREFIX.message, ids.messages],
    [options.signals, PREFIX.signal, ids.signals],
  ] as const) {
    for (const name of new Set(names)) {
      add(named, prefix, name, (id) => map.set(name, id));
    }
  }
  separate(named, true);
  const keyBody = options.key.replace(/[/-]/g, '_');
  const containers: Entry[] = [
    {
      prefix: PREFIX.definitions,
      raw: options.key,
      id: idFor(PREFIX.definitions, keyBody),
      assign: (id) => (ids.definitions = id),
    },
    {
      prefix: PREFIX.collaboration,
      raw: options.key,
      id: idFor(PREFIX.collaboration, keyBody),
      assign: (id) => (ids.collaboration = id),
    },
  ];

  // 3. The final pass: unique, at most 255 characters and clear of the ids bpmn-js derives, in a
  // fixed order.
  const taken = new Set<string>([DIAGRAM_ID, PLANE_ID]);
  /** Element ids (bpmn-js registers these and its derived ones; DI ids it does not). */
  const elementIds = new Set<string>();
  const blocked = (id: string, element: boolean): boolean => {
    if (taken.has(id)) return true;
    if (!element) return false;
    return BPMNJS_SUFFIXES.some(
      (suffix) =>
        elementIds.has(`${id}${suffix}`) ||
        (id.endsWith(suffix) && elementIds.has(id.slice(0, -suffix.length))),
    );
  };
  const settle = (e: Entry, element = true): void => {
    let id = e.id;
    if (blocked(id, element) || !isRenderedId(id)) {
      id = withHash(id, e.raw);
      id = uniqueId(id, (x) => blocked(x, element));
      ids.rewritten++;
    }
    taken.add(id);
    if (element) elementIds.add(id);
    e.id = id;
    e.assign(id);
  };
  for (const e of containers) settle(e);
  for (const e of [...sourced].sort(byPrefixAndRaw)) settle(e);
  for (const e of [...derived, ...named].sort(byPrefixAndRaw)) settle(e);

  // 4. DI ids, last.
  const drawn: string[] = [];
  for (const p of spec.processes) {
    const entry = ids.processes.get(p);
    if (options.collaboration && entry !== undefined) drawn.push(entry.participant);
    for (const l of p.lanes) drawn.push(ids.lanes.get(l) ?? '');
    for (const d of p.dataStores) drawn.push(ids.dataStores.get(d) ?? '');
    for (const n of p.nodes) drawn.push(ids.nodes.get(n) ?? '');
    for (const f of p.flows) drawn.push(ids.flows.get(f) ?? '');
  }
  if (options.collaboration) {
    for (const pt of spec.participants) drawn.push(ids.participants.get(pt) ?? '');
  }
  for (const mf of spec.messageFlows) drawn.push(ids.messageFlows.get(mf) ?? '');
  drawn.push(...ids.inputs.values(), ...ids.outputs.values());
  for (const semantic of drawn.sort(compare)) {
    settle(
      {
        prefix: '',
        raw: semantic,
        id: `${semantic}_di`,
        assign: (id) => ids.di.set(semantic, id),
      },
      false,
    );
  }
  return ids;

  function nodeIdOf(n: SpecNode): string {
    return ids.nodes.get(n) ?? '';
  }
  function dataStoreIdOf(p: SpecProcess, source: string): string {
    let stores = storesBySource.get(p);
    if (stores === undefined) {
      stores = new Map(p.dataStores.map((d) => [d.source, d]));
      storesBySource.set(p, stores);
    }
    const ds = stores.get(source);
    return ds === undefined ? '' : (ids.dataStores.get(ds) ?? '');
  }
}

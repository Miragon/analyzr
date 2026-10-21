// The checks every rendered model must pass in the analyzr-spec tests (M6 S3c §1.3, §3.2):
// bpmn-moddle reads it without warnings; bpmn-js's own BpmnTreeWalker walks it with a handler
// that applies BpmnImporter's refusals (D2 a); the DI rules of the eval generator's checkDi
// (eval/tools/lib/checks.mjs), restated without "subprocess expanded" (v1 draws none) and with
// the unlaned band of converter output; the layout's readability rules; and no call link.
import walkerModule from 'bpmn-js/lib/import/BpmnTreeWalker.js';
import { BpmnModdle } from 'bpmn-moddle';

import { L } from '../src/spec/layout.ts';
import { attribute, descendants, parseXml } from '../src/xml.ts';

/** A parsed element, read loosely. */
export interface El {
  readonly $type: string;
  readonly id?: string;
  readonly $parent?: El;
  $instanceOf(type: string): boolean;
  readonly [key: string]: unknown;
}

interface BoundsEl {
  x: number;
  y: number;
  width: number;
  height: number;
}

const list = (el: El | undefined, key: string): El[] => (el?.[key] as El[] | undefined) ?? [];
const one = (el: El | undefined, key: string): El | undefined => el?.[key] as El | undefined;
const boundsOf = (el: El | undefined): BoundsEl | undefined =>
  el?.['bounds'] as BoundsEl | undefined;

const moddle = new BpmnModdle();

// bpmn-js ships ES modules without "type": "module": the type checker reads a CommonJS module
// (the class under `default`), vitest hands over the class itself.
type WalkerClass = typeof walkerModule.default;
const BpmnTreeWalker: WalkerClass =
  (walkerModule as unknown as { default?: WalkerClass }).default ??
  (walkerModule as unknown as WalkerClass);

/** Reads rendered XML as bpmn-js does (bpmn-moddle without extensions). */
export async function parseRendered(xml: string): Promise<{ definitions: El; warnings: string[] }> {
  const parsed = await moddle.fromXML(xml);
  return {
    definitions: parsed.rootElement as unknown as El,
    warnings: parsed.warnings.map((w) => w.message),
  };
}

const isConnection = (el: El): boolean =>
  el.$instanceOf('bpmn:SequenceFlow') ||
  el.$instanceOf('bpmn:MessageFlow') ||
  el.$instanceOf('bpmn:DataAssociation') ||
  el.$instanceOf('bpmn:Association');

/** The elements bpmn-js draws: participants, message flows, lanes, flow elements, data associations. */
export function drawable(definitions: El): El[] {
  const out: El[] = [];
  const roots = list(definitions, 'rootElements');
  for (const c of roots.filter((r) => r.$type === 'bpmn:Collaboration')) {
    out.push(...list(c, 'participants'), ...list(c, 'messageFlows'));
  }
  for (const p of roots.filter((r) => r.$type === 'bpmn:Process')) {
    for (const ls of list(p, 'laneSets')) out.push(...list(ls, 'lanes'));
    for (const el of list(p, 'flowElements')) {
      if (el.$type === 'bpmn:DataObject') continue;
      out.push(el, ...list(el, 'dataInputAssociations'), ...list(el, 'dataOutputAssociations'));
    }
  }
  return out;
}

/** The elements whose label bpmn-js draws outside them (`LabelUtil.js` `isLabelExternal`). */
const EXTERNAL_LABELS = [
  'bpmn:Event',
  'bpmn:Gateway',
  'bpmn:DataStoreReference',
  'bpmn:DataObjectReference',
  'bpmn:DataInput',
  'bpmn:DataOutput',
  'bpmn:SequenceFlow',
  'bpmn:MessageFlow',
  'bpmn:Group',
];

/**
 * D2 (a): bpmn-js's BpmnTreeWalker over the model, with a handler that refuses what
 * BpmnImporter refuses (`BpmnImporter.js` `add`, `_attachBoundary`, `_getConnectedElement`):
 * a DI it does not know, a parent or a connection end not yet drawn, an end not specified;
 * plus a BPMNShape on a connection or a BPMNEdge on a node. Every id the importer registers
 * must be unique: the elements' own, `<id>_label` for a named element with an external label
 * (`addLabel`) and `<id>_plane` for a collapsed subprocess's drill-down plane (`add` for a
 * plane, `SubprocessCompatibility.js`); a clash leaves an element undrawn or fails the
 * import. Then every drawable element must have been drawn exactly once (the walker skips an
 * element without DI silently and reports a second DI element itself).
 */
export function walkProblems(definitions: El): string[] {
  const errors: string[] = [];
  const drawn = new Set<El>();
  const name = (el: El | undefined): string =>
    el === undefined ? '<none>' : `${el.$type} ${el.id ?? ''}`;
  const registered = new Map<string, string>();
  const register = (id: string | undefined, what: string): void => {
    if (id === undefined) return;
    const other = registered.get(id);
    if (other !== undefined) errors.push(`element ${id} (${what}) already exists (${other})`);
    else registered.set(id, what);
  };
  const need = (owner: El, end: El | undefined, side: string): void => {
    if (end === undefined) errors.push(`${name(owner)}#${side}Ref not specified`);
    else if (!drawn.has(end))
      errors.push(`${name(end)} referenced by ${name(owner)}#${side}Ref not yet drawn`);
  };
  const walker = new BpmnTreeWalker({
    root(element: El) {
      drawn.add(element);
      register(element.id, `root ${name(element)}`);
      return element;
    },
    element(element: El, di: El, parent: El | undefined) {
      if (drawn.has(element)) errors.push(`already rendered ${name(element)}`);
      if (parent !== undefined && !drawn.has(parent))
        errors.push(`parent of ${name(element)} not yet drawn`);
      if (di.$instanceOf('bpmndi:BPMNShape')) {
        if (isConnection(element)) errors.push(`a BPMNShape on the connection ${name(element)}`);
        if (element.$instanceOf('bpmn:BoundaryEvent'))
          need(element, one(element, 'attachedToRef'), 'attachedTo');
      } else if (di.$instanceOf('bpmndi:BPMNEdge')) {
        if (!isConnection(element)) errors.push(`a BPMNEdge on the node ${name(element)}`);
        const source =
          element.$type === 'bpmn:DataInputAssociation'
            ? list(element, 'sourceRef')[0]
            : element.$type === 'bpmn:DataOutputAssociation'
              ? element.$parent
              : one(element, 'sourceRef');
        const target =
          element.$type === 'bpmn:DataInputAssociation'
            ? element.$parent
            : one(element, 'targetRef');
        need(element, source, 'source');
        need(element, target, 'target');
      } else {
        errors.push(`unknown di ${name(di)} for ${name(element)}`);
      }
      register(element.id, name(element));
      const label = element['name'];
      if (
        EXTERNAL_LABELS.some((t) => element.$instanceOf(t)) &&
        typeof label === 'string' &&
        label
      ) {
        register(`${element.id ?? ''}_label`, `the label of ${name(element)}`);
      }
      if (element.$instanceOf('bpmn:SubProcess') && di['isExpanded'] !== true) {
        register(`${element.id ?? ''}_plane`, `the plane of ${name(element)}`);
      }
      drawn.add(element);
      return element;
    },
    error(message: string) {
      errors.push(message);
    },
  });
  try {
    walker.handleDefinitions(definitions);
  } catch (err) {
    errors.push(`walker: ${err instanceof Error ? err.message : String(err)}`);
  }
  for (const el of drawable(definitions)) {
    if (!drawn.has(el)) errors.push(`${name(el)} has no DI element`);
  }
  return errors;
}

const inside = (a: BoundsEl, b: BoundsEl): boolean =>
  a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
const onOrIn = (p: { x: number; y: number }, b: BoundsEl, tol = 1): boolean =>
  p.x >= b.x - tol && p.x <= b.x + b.width + tol && p.y >= b.y - tol && p.y <= b.y + b.height + tol;
const validBounds = (b: BoundsEl | undefined): boolean =>
  b !== undefined &&
  [b.x, b.y, b.width, b.height].every((v) => Number.isFinite(v)) &&
  b.width > 0 &&
  b.height > 0;
const overlap = (a: BoundsEl, b: BoundsEl): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

interface Diagram {
  di: Map<El, El>;
  collaboration: El | undefined;
  processes: El[];
  plane: El | undefined;
}

function diagramOf(definitions: El, errors: string[]): Diagram {
  const diagrams = list(definitions, 'diagrams');
  if (diagrams.length !== 1)
    errors.push(`expected exactly one BPMNDiagram, found ${diagrams.length}`);
  const plane = one(diagrams[0], 'plane');
  const di = new Map<El, El>();
  for (const pe of list(plane, 'planeElement')) {
    const target = one(pe, 'bpmnElement');
    if (target === undefined) errors.push(`${pe.id ?? ''}: bpmnElement does not resolve`);
    else if (di.has(target)) errors.push(`${target.id ?? ''}: more than one DI element`);
    else di.set(target, pe);
  }
  const roots = list(definitions, 'rootElements');
  return {
    di,
    collaboration: roots.find((r) => r.$type === 'bpmn:Collaboration'),
    processes: roots.filter((r) => r.$type === 'bpmn:Process'),
    plane,
  };
}

/**
 * The DI rules of the eval generator's `checkDi`, restated: one diagram whose plane shows the
 * collaboration or the only process; every drawable element exactly one DI element of the
 * right kind with valid bounds; participants and lanes horizontal; edges with at least two
 * finite waypoints whose ends lie on their source and target; shapes inside their pool and
 * lane; lanes spanning the pool body and tiling it from its top, every flow node in exactly
 * one lane, except nodes of converter output drawn in the unlaned band below the lanes.
 */
export function diProblems(definitions: El): string[] {
  const errors: string[] = [];
  const { di, collaboration, processes, plane } = diagramOf(definitions, errors);
  const target = collaboration ?? (processes.length === 1 ? processes[0] : undefined);
  if (target === undefined) errors.push('several processes without a collaboration');
  else if (one(plane, 'bpmnElement') !== target) errors.push(`plane must show ${target.id ?? ''}`);
  for (const el of drawable(definitions)) {
    const d = di.get(el);
    const want = isConnection(el) ? 'bpmndi:BPMNEdge' : 'bpmndi:BPMNShape';
    if (d === undefined) {
      errors.push(`${el.id ?? ''}: no DI`);
      continue;
    }
    if (d.$type !== want) errors.push(`${el.id ?? ''}: DI is ${d.$type}, expected ${want}`);
    if (want === 'bpmndi:BPMNShape') {
      if (!validBounds(boundsOf(d))) errors.push(`${el.id ?? ''}: invalid bounds`);
      const label = one(d, 'label');
      if (label !== undefined && !validBounds(boundsOf(label))) {
        errors.push(`${el.id ?? ''}: invalid label bounds`);
      }
      if (
        (el.$type === 'bpmn:Participant' || el.$type === 'bpmn:Lane') &&
        d['isHorizontal'] !== true
      ) {
        errors.push(`${el.id ?? ''}: must be horizontal`);
      }
    } else {
      const wps = list(d, 'waypoint') as unknown as { x: number; y: number }[];
      if (wps.length < 2 || !wps.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) {
        errors.push(`${el.id ?? ''}: an edge needs at least two finite waypoints`);
        continue;
      }
      const [s, t] =
        el.$type === 'bpmn:DataInputAssociation'
          ? [list(el, 'sourceRef')[0], el.$parent]
          : el.$type === 'bpmn:DataOutputAssociation'
            ? [el.$parent, one(el, 'targetRef')]
            : [one(el, 'sourceRef'), one(el, 'targetRef')];
      const sb = s === undefined ? undefined : boundsOf(di.get(s));
      const tb = t === undefined ? undefined : boundsOf(di.get(t));
      const first = wps[0];
      const last = wps.at(-1);
      if (sb !== undefined && first !== undefined && !onOrIn(first, sb)) {
        errors.push(`${el.id ?? ''}: first waypoint is not on ${s?.id ?? ''}`);
      }
      if (tb !== undefined && last !== undefined && !onOrIn(last, tb)) {
        errors.push(`${el.id ?? ''}: last waypoint is not on ${t?.id ?? ''}`);
      }
    }
  }
  const b = (el: El): BoundsEl | undefined => boundsOf(di.get(el));
  for (const p of processes) {
    const participant = list(collaboration, 'participants').find(
      (pt) => one(pt, 'processRef') === p,
    );
    const pool = participant === undefined ? undefined : b(participant);
    for (const el of list(p, 'flowElements')) {
      const eb = b(el);
      if (eb === undefined || el.$type === 'bpmn:SequenceFlow') continue;
      if (pool !== undefined && !inside(eb, pool))
        errors.push(`${el.id ?? ''}: shape lies outside its pool`);
    }
    const lanes = list(p, 'laneSets').flatMap((ls) => list(ls, 'lanes'));
    if (lanes.length === 0) continue;
    if (pool === undefined) {
      errors.push(`${p.id ?? ''}: lanes need a participant (pool)`);
      continue;
    }
    const sorted = lanes
      .map((l) => ({ l, lb: b(l) }))
      .filter((x): x is { l: El; lb: BoundsEl } => x.lb !== undefined)
      .sort((x, y) => x.lb.y - y.lb.y);
    let y = pool.y;
    for (const { l, lb } of sorted) {
      if (lb.x !== pool.x + L.POOL_HEADER || lb.x + lb.width !== pool.x + pool.width) {
        errors.push(`${l.id ?? ''}: lane must span the pool body`);
      }
      if (lb.y !== y)
        errors.push(
          `${l.id ?? ''}: lanes must tile the pool from its top (expected y=${y}, got ${lb.y})`,
        );
      y = lb.y + lb.height;
    }
    const membership = new Map<El, number>();
    for (const l of lanes) {
      const lb = b(l);
      for (const n of list(l, 'flowNodeRef')) {
        membership.set(n, (membership.get(n) ?? 0) + 1);
        const nb = b(n);
        if (lb !== undefined && nb !== undefined && !inside(nb, lb)) {
          errors.push(`${n.id ?? ''}: shape lies outside its lane ${l.id ?? ''}`);
        }
      }
    }
    const lanesBottom = y;
    for (const el of list(p, 'flowElements')) {
      if (el.$type === 'bpmn:SequenceFlow' || el.$type === 'bpmn:DataStoreReference') continue;
      const count = membership.get(el) ?? 0;
      const eb = b(el);
      const unlaned = count === 0 && eb !== undefined && eb.y >= lanesBottom;
      if (count !== 1 && !unlaned)
        errors.push(`${el.id ?? ''}: must be referenced by exactly one lane (found ${count})`);
    }
    if (y !== pool.y + pool.height && !list(p, 'flowElements').some((el) => (b(el)?.y ?? 0) >= y)) {
      errors.push(`${p.id ?? ''}: lanes do not fill the pool`);
    }
  }
  return errors;
}

const SHAPES_WITH_LABELS = new Set(['bpmn:DataStoreReference']);

const isInteger = (v: number): boolean => Number.isInteger(v);
const integralBounds = (b: BoundsEl): boolean =>
  [b.x, b.y, b.width, b.height].every((v) => isInteger(v));

/**
 * The layout's readability rules (M6 S3c §3.2): no two flow-node or data-store shapes
 * overlap, and no two pools; no external label (events, gateways, data stores, sequence and
 * message flows) covers a flow-node or data-store shape; every edge has at least two waypoints
 * and only axis-parallel segments; every coordinate is an integer; in a collaboration, every
 * sequence flow and data association with its label stays inside its pool; every pool is at
 * least `MIN_POOL_W` wide. Containment of shapes in pools and lanes is `diProblems`'.
 */
export function layoutProblems(definitions: El): string[] {
  const errors: string[] = [];
  const { di, collaboration, processes } = diagramOf(definitions, errors);
  const nodes: { el: El; b: BoundsEl; label?: BoundsEl }[] = [];
  const pools: { el: El; b: BoundsEl }[] = [];
  for (const [el, d] of di) {
    const bounds = boundsOf(d);
    if (bounds === undefined || d.$type !== 'bpmndi:BPMNShape') continue;
    const label = boundsOf(one(d, 'label'));
    if (!integralBounds(bounds) || (label !== undefined && !integralBounds(label))) {
      errors.push(`${el.id ?? ''}: bounds are not on integer coordinates`);
    }
    if (el.$type === 'bpmn:Participant') {
      if (bounds.width < L.MIN_POOL_W)
        errors.push(`${el.id ?? ''}: pool narrower than ${L.MIN_POOL_W}`);
      pools.push({ el, b: bounds });
      continue;
    }
    if (el.$type === 'bpmn:Lane') continue;
    const external =
      el.$instanceOf('bpmn:Event') ||
      el.$instanceOf('bpmn:Gateway') ||
      SHAPES_WITH_LABELS.has(el.$type);
    nodes.push({ el, b: bounds, ...(external && label !== undefined ? { label } : {}) });
  }
  const labels: { el: El; label: BoundsEl }[] = nodes.flatMap((n) =>
    n.label === undefined ? [] : [{ el: n.el, label: n.label }],
  );
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < nodes.length; j++) {
      const c = nodes[j];
      if (c !== undefined && overlap(a.b, c.b))
        errors.push(`${a.el.id ?? ''} overlaps ${c.el.id ?? ''}`);
    }
  }
  for (let i = 0; i < pools.length; i++) {
    for (let j = i + 1; j < pools.length; j++) {
      const a = pools[i];
      const c = pools[j];
      if (a !== undefined && c !== undefined && overlap(a.b, c.b))
        errors.push(`pool ${a.el.id ?? ''} overlaps pool ${c.el.id ?? ''}`);
    }
  }
  for (const [el, d] of di) {
    if (d.$type !== 'bpmndi:BPMNEdge') continue;
    const wps = list(d, 'waypoint') as unknown as { x: number; y: number }[];
    if (wps.length < 2) errors.push(`${el.id ?? ''}: fewer than two waypoints`);
    wps.forEach((p, i) => {
      if (!isInteger(p.x) || !isInteger(p.y)) {
        errors.push(`${el.id ?? ''}: waypoint ${i} is not on integer coordinates`);
      }
      const q = wps[i + 1];
      if (q !== undefined && p.x !== q.x && p.y !== q.y) {
        errors.push(`${el.id ?? ''}: segment ${i} is not axis-parallel`);
      }
    });
    const label = boundsOf(one(d, 'label'));
    if (label !== undefined) {
      if (!integralBounds(label)) errors.push(`${el.id ?? ''}: label not on integer coordinates`);
      labels.push({ el, label });
    }
  }
  for (const { el, label } of labels) {
    for (const c of nodes) {
      if (c.el !== el && overlap(label, c.b))
        errors.push(`the label of ${el.id ?? ''} covers ${c.el.id ?? ''}`);
    }
  }
  // inside its pool: a process's sequence flows and data associations, with their labels
  for (const p of processes) {
    const participant = list(collaboration, 'participants').find(
      (pt) => one(pt, 'processRef') === p,
    );
    const pool = participant === undefined ? undefined : boundsOf(di.get(participant));
    if (pool === undefined) continue;
    const connections = list(p, 'flowElements').flatMap((el) => [
      ...(el.$type === 'bpmn:SequenceFlow' ? [el] : []),
      ...list(el, 'dataInputAssociations'),
      ...list(el, 'dataOutputAssociations'),
    ]);
    for (const el of connections) {
      const d = di.get(el);
      const wps = list(d, 'waypoint') as unknown as { x: number; y: number }[];
      if (wps.some((w) => !onOrIn(w, pool, 0))) {
        errors.push(`${el.id ?? ''}: runs outside its pool ${participant?.id ?? ''}`);
      }
      const label = boundsOf(one(d, 'label'));
      if (label !== undefined && !inside(label, pool)) {
        errors.push(`${el.id ?? ''}: label lies outside its pool ${participant?.id ?? ''}`);
      }
    }
  }
  return errors;
}

const ENGINE_NAMESPACES = [
  'http://camunda.org/schema/1.0/bpmn',
  'http://camunda.org/schema/zeebe/1.0',
  'http://camunda.org/schema/modeler/1.0',
];

/**
 * D3 (b) and the root's promises: no `callActivity` element and no `calledElement` attribute
 * anywhere (element and attribute names of the parsed tree), no engine or modeler namespace,
 * every process `isExecutable="false"`.
 */
export function structureProblems(xml: string): string[] {
  const errors: string[] = [];
  const { root } = parseXml(xml);
  for (const el of [root, ...descendants(root)]) {
    if (el.local === 'callActivity') errors.push(`callActivity ${attribute(el, 'id') ?? ''}`);
    for (const a of el.attributes) {
      if (a.name.slice(a.name.indexOf(':') + 1) === 'calledElement')
        errors.push(`calledElement on ${el.name}`);
      if (ENGINE_NAMESPACES.includes(a.value) && a.name.startsWith('xmlns'))
        errors.push(`namespace ${a.value}`);
    }
    if (el.local === 'process' && attribute(el, 'isExecutable') !== 'false') {
      errors.push(`process ${attribute(el, 'id') ?? ''} is not isExecutable="false"`);
    }
  }
  return errors;
}

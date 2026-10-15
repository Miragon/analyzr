// eval:descriptive (M6 §3.11): deterministic transforms that turn an
// executable Camunda model into the BPMN a descriptive modelling tool
// exports. They apply cumulatively, in VARIANTS order:
//
// - engine-stripped: the Camunda namespaces (camunda, zeebe, modeler) and
//   everything in them removed, so @analyzr/bpmn-facts finds no engine; a C8
//   call target (zeebe:calledElement) becomes the standard BPMN attribute
//   `calledElement`, which C7 uses already (verbatim: a FEEL target `=expr`
//   lands there too, which facts v1 then takes for a static target);
// - descriptive: every process `isExecutable="false"`; call activities become
//   collapsed subprocesses named after the callee (no call target); messages
//   and signals lose their `messageRef` and `signalRef` (the names stay only on
//   the labels) and the `bpmn:message` and `bpmn:signal` definitions go;
// - pools: every message endpoint that talks to another model (no message
//   flow inside its file) gets a message flow to or from a black-box pool
//   per partner; every event, send and receive task stays what it is;
// - tasks: those endpoints' intermediate message throws and catches and send
//   and receive tasks become plain tasks, keeping their message flows (a
//   catch or receive task after an event-based gateway, and start, end and
//   boundary events, stay events);
// - no-docs: every `bpmn:documentation` removed.
//
// Element ids never change, so refs stay comparable with expected.yaml (only
// the message and signal definitions and the event definitions of converted
// events disappear). What a transform needs from the whole landscape (callee
// names, message partners) comes in as a TransformContext computed from the
// original facts (src/descriptive-context.ts); the transforms read nothing
// else. Parsing and writing go through bpmn-moddle without engine extensions
// (unknown attributes stay in `$attrs`, unknown extension elements stay
// generic), so the output is deterministic for the same input.
import { BpmnModdle } from 'bpmn-moddle';

/** The variants, in the order they apply (each on top of the previous one). */
export const VARIANTS = ['engine-stripped', 'descriptive', 'pools', 'tasks', 'no-docs'];

/** Namespaces engine-stripped removes. */
export const ENGINE_NAMESPACES = [
  'http://camunda.org/schema/1.0/bpmn',
  'http://camunda.org/schema/zeebe/1.0',
  'http://camunda.org/schema/modeler/1.0'
];

/** Black-box pool height and the gap between pools (bpmn-js defaults). */
const POOL_HEIGHT = 60;
const POOL_GAP = 40;
/** Space a pool keeps around its shapes; the label band on its left. */
const POOL_PADDING = 30;
const POOL_LABEL_BAND = 30;

const isElement = (v) => v !== null && typeof v === 'object' && typeof v.$type === 'string';

/**
 * Every moddle element contained in `root`, each once, in a deterministic
 * order: depth-first along the enumerable own properties in insertion order.
 * bpmn-moddle keeps references (`sourceRef`, `incoming`, `bpmnElement`, …)
 * as non-enumerable own properties, so the walk follows containment only.
 */
function allElements(root) {
  const seen = new Set();
  const out = [];
  const visit = (el) => {
    if (seen.has(el)) return;
    seen.add(el);
    out.push(el);
    for (const [key, value] of Object.entries(el)) {
      if (key.startsWith('$')) continue;
      if (Array.isArray(value)) {
        for (const v of value) if (isElement(v)) visit(v);
      } else if (isElement(value)) {
        visit(value);
      }
    }
  };
  visit(root);
  return out;
}

/** Ids in use; `fresh(base)` returns an unused NCName-safe id based on `base` and reserves it. */
function idPool(definitions) {
  const used = new Set(allElements(definitions).map((e) => e.id).filter((id) => typeof id === 'string'));
  return (base) => {
    const safe = base.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^([^A-Za-z_])/, '_$1');
    let id = safe;
    for (let i = 2; used.has(id); i++) id = `${safe}_${i}`;
    used.add(id);
    return id;
  };
}

function plane(definitions) {
  const p = definitions.diagrams?.[0]?.plane;
  if (!p) throw new Error(`${definitions.id}: no diagram plane`);
  return p;
}

function shapeOf(definitions, element) {
  return (plane(definitions).planeElement ?? []).find((d) => d.bpmnElement === element);
}

/** Flow element containers (processes, subprocesses) with the elements they hold, by element id. */
function containers(definitions) {
  const byId = new Map();
  const walk = (container) => {
    for (const el of container.flowElements ?? []) {
      byId.set(el.id, container);
      if (el.$type === 'bpmn:SubProcess') walk(el);
    }
  };
  for (const p of (definitions.rootElements ?? []).filter((r) => r.$type === 'bpmn:Process')) walk(p);
  return byId;
}

/** Replaces `old` in its container's flowElements by `next` (same id). */
function replaceFlowElement(definitions, old, next) {
  const container = containers(definitions).get(old.id);
  const list = container?.flowElements;
  const i = list ? list.indexOf(old) : -1;
  if (i < 0) throw new Error(`${old.id}: not found in a flow element container`);
  list[i] = next;
  next.$parent = container;
  // References (sequence flows, lanes, boundary events, DI) are written by
  // id, which stays; point them at the new element anyway.
  for (const el of allElements(definitions)) {
    for (const key of Object.getOwnPropertyNames(el)) {
      if (key.startsWith('$')) continue;
      const value = el[key];
      if (value === old) el[key] = next;
      else if (Array.isArray(value)) {
        for (let j = 0; j < value.length; j++) if (value[j] === old) value[j] = next;
      }
    }
  }
}

/** The own properties of `el` (attributes, children and references) to carry over to a replacement, minus `drop`. */
function carried(el, drop) {
  const props = {};
  for (const key of Object.getOwnPropertyNames(el)) {
    const value = el[key];
    if (key.startsWith('$') || drop.includes(key) || value === undefined) continue;
    props[key] = value;
  }
  return props;
}

// ----------------------------------------------------------- engine-stripped

/**
 * Removes the Camunda namespaces and everything in them: their `xmlns`
 * declarations, attributes and extension elements (an empty
 * `extensionElements` goes too). A C8 call target moves to `calledElement`
 * unless the attribute is set already.
 */
export function stripEngine(definitions) {
  const prefixes = new Set();
  for (const [name, value] of Object.entries(definitions.$attrs ?? {})) {
    if (name.startsWith('xmlns:') && ENGINE_NAMESPACES.includes(value)) {
      prefixes.add(name.slice('xmlns:'.length));
      delete definitions.$attrs[name];
    }
  }
  const foreign = (qname) => prefixes.has(qname.split(':')[0]);
  for (const el of allElements(definitions)) {
    for (const name of Object.keys(el.$attrs ?? {})) {
      if (name.includes(':') && foreign(name)) delete el.$attrs[name];
    }
    const ext = el.extensionElements;
    if (!ext) continue;
    const values = ext.values ?? [];
    if (el.$type === 'bpmn:CallActivity' && el.calledElement === undefined) {
      const called = values.find((v) => foreign(v.$type) && v.$type.split(':')[1].toLowerCase() === 'calledelement');
      if (typeof called?.processId === 'string') el.calledElement = called.processId;
    }
    ext.values = values.filter((v) => !foreign(v.$type));
    if (ext.values.length === 0) delete el.extensionElements;
  }
}

// --------------------------------------------------------------- descriptive

/**
 * Not executable; call activities as collapsed subprocesses named after the
 * callee (`ctx.callees[id]`, else their own name); no `messageRef` or
 * `signalRef` anywhere and no `bpmn:message` or `bpmn:signal` definitions.
 */
export function makeDescriptive(moddle, definitions, ctx) {
  for (const el of allElements(definitions)) {
    if (el.$type === 'bpmn:Process') el.isExecutable = false;
  }
  const calls = allElements(definitions).filter((e) => e.$type === 'bpmn:CallActivity');
  for (const call of calls) {
    const props = carried(call, ['calledElement', 'extensionElements']);
    const callee = ctx.callees[call.id];
    const sub = moddle.create('bpmn:SubProcess', { ...props, ...(callee ? { name: callee } : {}) });
    replaceFlowElement(definitions, call, sub);
    const shape = shapeOf(definitions, sub);
    if (shape) shape.isExpanded = false;
  }
  for (const el of allElements(definitions)) {
    if (
      el.$type === 'bpmn:MessageEventDefinition' ||
      el.$type === 'bpmn:SendTask' ||
      el.$type === 'bpmn:ReceiveTask' ||
      el.$type === 'bpmn:MessageFlow'
    ) {
      delete el.messageRef;
    }
    if (el.$type === 'bpmn:SignalEventDefinition') delete el.signalRef;
  }
  definitions.rootElements = (definitions.rootElements ?? []).filter(
    (r) => r.$type !== 'bpmn:Message' && r.$type !== 'bpmn:Signal'
  );
}

// --------------------------------------------------------------- pools, tasks

/** Properties of events, send and receive tasks that a plain task does not have. */
const EVENT_ONLY = [
  'eventDefinitions',
  'eventDefinitionRefs',
  'dataInputs',
  'dataOutputs',
  'inputSet',
  'outputSet',
  'parallelMultiple',
  'messageRef',
  'implementation',
  'operationRef',
  'instantiate'
];

const TO_TASK = new Set(['bpmn:IntermediateThrowEvent', 'bpmn:IntermediateCatchEvent', 'bpmn:SendTask', 'bpmn:ReceiveTask']);

/** After an event-based gateway only catch events and receive tasks may follow (BPMN 2.0 §10.6.6). */
function afterEventGateway(el) {
  return (el.incoming ?? []).some((f) => f.sourceRef?.$type === 'bpmn:EventBasedGateway');
}

function convertible(el) {
  if (!TO_TASK.has(el.$type)) return false;
  if (el.$type.startsWith('bpmn:Intermediate') && (el.eventDefinitions ?? []).length !== 1) return false;
  if (el.$type === 'bpmn:IntermediateCatchEvent' || el.$type === 'bpmn:ReceiveTask') return !afterEventGateway(el);
  return true;
}

function bbox(boundsList) {
  const xs = boundsList.flatMap((b) => [b.x, b.x + b.width]);
  const ys = boundsList.flatMap((b) => [b.y, b.y + b.height]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function bounds(moddle, x, y, width, height) {
  return moddle.create('dc:Bounds', { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
}

/**
 * The collaboration of the model, created around its single process (with a
 * pool enclosing every shape) when there is none.
 */
function ensureCollaboration(moddle, definitions, fresh) {
  const roots = definitions.rootElements ?? [];
  const existing = roots.find((r) => r.$type === 'bpmn:Collaboration');
  if (existing) return existing;
  const processes = roots.filter((r) => r.$type === 'bpmn:Process');
  if (processes.length !== 1) throw new Error(`${definitions.id}: ${processes.length} processes without a collaboration`);
  const [process] = processes;
  const p = plane(definitions);
  const participant = moddle.create('bpmn:Participant', {
    id: fresh(`Participant_${process.id}`),
    ...(process.name ? { name: process.name } : {}),
    processRef: process
  });
  const collaboration = moddle.create('bpmn:Collaboration', {
    id: fresh(`Collaboration_${process.id}`),
    participants: [participant],
    messageFlows: []
  });
  definitions.rootElements = [collaboration, ...roots];
  const shapes = (p.planeElement ?? []).filter((d) => d.$type === 'bpmndi:BPMNShape' && d.bounds);
  const box = bbox(shapes.flatMap((s) => [s.bounds, ...(s.label?.bounds ? [s.label.bounds] : [])]));
  const x = box.minX - POOL_PADDING - POOL_LABEL_BAND;
  const y = box.minY - POOL_PADDING;
  const shape = moddle.create('bpmndi:BPMNShape', {
    id: fresh(`${participant.id}_di`),
    bpmnElement: participant,
    isHorizontal: true,
    bounds: bounds(moddle, x, y, box.maxX + POOL_PADDING - x, box.maxY + POOL_PADDING - y)
  });
  p.planeElement = [shape, ...(p.planeElement ?? [])];
  p.bpmnElement = collaboration;
  return collaboration;
}

/** The flow elements of `ctx.messages`, sorted by id. */
function messageTargets(definitions, ctx) {
  const inContainer = containers(definitions);
  return allElements(definitions)
    .filter((e) => typeof e.id === 'string' && Object.hasOwn(ctx.messages, e.id) && inContainer.has(e.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Message endpoints in `ctx.messages` get a message flow to (`out`) or from
 * (`in`) one black-box pool per partner, created below every other shape (an
 * existing black-box pool of that name is reused); every element stays what
 * it is.
 */
export function addPools(moddle, definitions, ctx) {
  const targets = messageTargets(definitions, ctx);
  if (targets.length === 0) return;
  const fresh = idPool(definitions);
  const collaboration = ensureCollaboration(moddle, definitions, fresh);
  collaboration.messageFlows ??= [];
  const p = plane(definitions);

  const poolBox = () => {
    const shapes = (p.planeElement ?? []).filter((d) => d.$type === 'bpmndi:BPMNShape' && d.bounds);
    return bbox(shapes.flatMap((s) => [s.bounds, ...(s.label?.bounds ? [s.label.bounds] : [])]));
  };
  const pools = new Map();
  const poolOf = (name) => {
    const known = pools.get(name);
    if (known) return known;
    const reuse = (collaboration.participants ?? []).find((pt) => !pt.processRef && pt.name === name);
    if (reuse && shapeOf(definitions, reuse)) {
      pools.set(name, reuse);
      return reuse;
    }
    const box = poolBox();
    const participant = moddle.create('bpmn:Participant', { id: fresh(`Participant_${name}`), name });
    collaboration.participants = [...(collaboration.participants ?? []), participant];
    p.planeElement.push(
      moddle.create('bpmndi:BPMNShape', {
        id: fresh(`${participant.id}_di`),
        bpmnElement: participant,
        isHorizontal: true,
        bounds: bounds(moddle, box.minX, box.maxY + POOL_GAP, box.maxX - box.minX, POOL_HEIGHT)
      })
    );
    pools.set(name, participant);
    return participant;
  };

  for (const el of targets) {
    const { direction, partners } = ctx.messages[el.id];
    const shape = shapeOf(definitions, el);
    for (const partner of partners) {
      const pool = poolOf(partner);
      const flow = moddle.create('bpmn:MessageFlow', {
        id: fresh(`MessageFlow_${el.id}_${pool.id}`),
        sourceRef: direction === 'out' ? el : pool,
        targetRef: direction === 'out' ? pool : el
      });
      collaboration.messageFlows.push(flow);
      const pb = shapeOf(definitions, pool)?.bounds;
      const eb = shape?.bounds;
      if (!pb || !eb) throw new Error(`${definitions.id}: no shape for ${el.id} or ${pool.id}`);
      const cx = Math.round(eb.x + eb.width / 2);
      const x = Math.min(Math.max(cx, pb.x + POOL_LABEL_BAND), pb.x + pb.width);
      const atElement = moddle.create('dc:Point', { x: cx, y: Math.round(eb.y + eb.height) });
      const elbow = moddle.create('dc:Point', { x: cx, y: Math.round(pb.y - POOL_GAP / 2) });
      const elbow2 = moddle.create('dc:Point', { x, y: Math.round(pb.y - POOL_GAP / 2) });
      const atPool = moddle.create('dc:Point', { x, y: Math.round(pb.y) });
      const path = x === cx ? [atElement, atPool] : [atElement, elbow, elbow2, atPool];
      p.planeElement.push(
        moddle.create('bpmndi:BPMNEdge', {
          id: fresh(`${flow.id}_di`),
          bpmnElement: flow,
          waypoint: direction === 'out' ? path : [...path].reverse()
        })
      );
    }
  }
}

/**
 * The message endpoints in `ctx.messages` that are intermediate throws and
 * catches or send and receive tasks become plain tasks with the same id and
 * message flows (see the file header for the exceptions).
 */
export function convertToTasks(moddle, definitions, ctx) {
  for (const target of messageTargets(definitions, ctx)) {
    if (!convertible(target)) continue;
    // The task keeps name, documentation, flows, data associations and
    // properties; what only events or send and receive tasks have goes.
    const el = moddle.create('bpmn:Task', carried(target, EVENT_ONLY));
    replaceFlowElement(definitions, target, el);
    const shape = shapeOf(definitions, el);
    if (shape) delete shape.label;
  }
}

// ------------------------------------------------------------------- no-docs

/** Removes every `bpmn:documentation`. */
export function stripDocumentation(definitions) {
  for (const el of allElements(definitions)) {
    if (el.documentation !== undefined) delete el.documentation;
  }
}

// --------------------------------------------------------------------- entry

/**
 * Applies the variants of {@link VARIANTS} cumulatively to one model.
 *
 * @param {string} xml the original BPMN
 * @param {{callees: Record<string, string | null>, messages: Record<string, {direction: 'out' | 'in', partners: string[]}>}} ctx
 * @returns {Promise<Record<string, string>>} the XML after each variant
 */
export async function transformModel(xml, ctx) {
  const moddle = new BpmnModdle();
  const { rootElement: definitions, warnings } = await moddle.fromXML(xml);
  if (warnings.length > 0) throw new Error(`parse warnings: ${warnings.map((w) => w.message).join('; ')}`);
  const out = {};
  const write = async (variant) => {
    out[variant] = (await moddle.toXML(definitions, { format: true })).xml;
  };
  stripEngine(definitions);
  await write('engine-stripped');
  makeDescriptive(moddle, definitions, ctx);
  await write('descriptive');
  addPools(moddle, definitions, ctx);
  await write('pools');
  convertToTasks(moddle, definitions, ctx);
  await write('tasks');
  stripDocumentation(definitions);
  await write('no-docs');
  return out;
}

/** Parses and writes `xml` with the same bpmn-moddle setup, changing nothing (for the round-trip check). */
export async function roundTrip(xml) {
  const moddle = new BpmnModdle();
  const { rootElement } = await moddle.fromXML(xml);
  return (await moddle.toXML(rootElement, { format: true })).xml;
}

/**
 * A deterministic summary of a BPMN 2.0 document read with `xml.ts`, without
 * bpmn-moddle: what inspect lists per file and what normalize-bpmn reports
 * for the German report (processes, black-box pools, collapsed subprocesses,
 * calls, ids).
 */
import { isSafeId } from './ids.ts';
import { attribute, descendants, type XmlElement } from './xml.ts';

export const BPMN_MODEL_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
export const BPMN_DI_NS = 'http://www.omg.org/spec/BPMN/20100524/DI';
export const DD_DI_NS = 'http://www.omg.org/spec/DD/20100524/DI';
export const DD_DC_NS = 'http://www.omg.org/spec/DD/20100524/DC';

/** Namespaces whose elements carry the ids bpmn-moddle checks. */
export const ID_NAMESPACES: ReadonlySet<string> = new Set([BPMN_MODEL_NS, BPMN_DI_NS, DD_DI_NS]);

/** True if `root` is a BPMN 2.0 `<definitions>`. */
export function isBpmnRoot(root: XmlElement): boolean {
  return root.local === 'definitions' && root.ns === BPMN_MODEL_NS;
}

const SUBPROCESS_NAMES: ReadonlySet<string> = new Set([
  'subProcess',
  'transaction',
  'adHocSubProcess',
]);

/** Children that make a subprocess expanded content (flow elements and artifacts). */
const FLOW_CONTENT_NAMES: ReadonlySet<string> = new Set([
  'startEvent',
  'endEvent',
  'intermediateCatchEvent',
  'intermediateThrowEvent',
  'boundaryEvent',
  'task',
  'userTask',
  'serviceTask',
  'sendTask',
  'receiveTask',
  'manualTask',
  'businessRuleTask',
  'scriptTask',
  'callActivity',
  'subProcess',
  'transaction',
  'adHocSubProcess',
  'exclusiveGateway',
  'inclusiveGateway',
  'parallelGateway',
  'eventBasedGateway',
  'complexGateway',
  'sequenceFlow',
  'dataObject',
  'dataObjectReference',
  'dataStoreReference',
]);

export interface NamedElement {
  id: string;
  name: string | null;
}

export interface BpmnSummary {
  /** `<definitions id>`: the externalId candidate of a model (to verify per tool, M6 §3.8). */
  definitionsId: string | null;
  exporter: string | null;
  exporterVersion: string | null;
  targetNamespace: string | null;
  processes: (NamedElement & { isExecutable: boolean | null })[];
  participants: number;
  /** Pools without a process (`processRef`): external partners or missing models. */
  blackBoxParticipants: NamedElement[];
  /** Call activities with their static or dynamic `calledElement` as written. */
  callActivities: (NamedElement & { calledElement: string | null })[];
  /** Subprocesses drawn collapsed (or without content): often links to other diagrams in the tool. */
  collapsedSubprocesses: NamedElement[];
  messageFlows: number;
  diagrams: number;
  elements: number;
  /** Namespaces of the elements inside `extensionElements`, sorted. */
  extensionNamespaces: string[];
  ids: {
    /** Elements of the BPMN and DI namespaces with an id. */
    total: number;
    /** Ids analyzr or bpmn-moddle would not accept (normalize-bpmn rewrites them). */
    unsafe: number;
    /** Occurrences of an id beyond its first. */
    duplicate: number;
  };
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function named(el: XmlElement): NamedElement {
  return { id: attribute(el, 'id') ?? '', name: attribute(el, 'name') ?? null };
}

/** Summarizes a BPMN document whose root passed {@link isBpmnRoot}. */
export function summarizeBpmn(root: XmlElement): BpmnSummary {
  const all = [...descendants(root)];
  const bpmn = (el: XmlElement, ...locals: string[]): boolean =>
    el.ns === BPMN_MODEL_NS && locals.includes(el.local);

  const shapes = new Map<string, XmlElement>();
  let diagrams = 0;
  for (const el of all) {
    if (el.ns !== BPMN_DI_NS) continue;
    if (el.local === 'BPMNDiagram') diagrams++;
    if (el.local === 'BPMNShape') {
      const ref = attribute(el, 'bpmnElement');
      if (ref !== undefined && !shapes.has(ref)) shapes.set(ref, el);
    }
  }

  const ids = { total: 0, unsafe: 0, duplicate: 0 };
  const seen = new Set<string>();
  for (const el of [root, ...all]) {
    if (el.ns === null || !ID_NAMESPACES.has(el.ns)) continue;
    const id = attribute(el, 'id');
    if (id === undefined) continue;
    ids.total++;
    if (!isSafeId(id)) ids.unsafe++;
    if (seen.has(id)) ids.duplicate++;
    seen.add(id);
  }

  const extensionNamespaces = new Set<string>();
  for (const el of all) {
    if (el.local !== 'extensionElements' || el.ns !== BPMN_MODEL_NS) continue;
    for (const child of descendants(el)) {
      if (child.ns !== null) extensionNamespaces.add(child.ns);
    }
  }

  const processes = root.children
    .filter((el) => bpmn(el, 'process'))
    .map((el) => {
      const executable = attribute(el, 'isExecutable');
      return {
        ...named(el),
        isExecutable: executable === undefined ? null : executable.trim() === 'true',
      };
    });
  const participantEls = all.filter((el) => bpmn(el, 'participant'));
  const blackBoxParticipants = participantEls
    .filter((el) => (attribute(el, 'processRef') ?? '').trim() === '')
    .map(named);
  const callActivities = all
    .filter((el) => bpmn(el, 'callActivity'))
    .map((el) => ({ ...named(el), calledElement: attribute(el, 'calledElement') ?? null }));
  const collapsedSubprocesses = all
    .filter((el) => el.ns === BPMN_MODEL_NS && SUBPROCESS_NAMES.has(el.local))
    .filter((el) => {
      const shape = shapes.get(attribute(el, 'id') ?? '');
      if (shape !== undefined) return attribute(shape, 'isExpanded')?.trim() !== 'true';
      return !el.children.some((c) => c.ns === BPMN_MODEL_NS && FLOW_CONTENT_NAMES.has(c.local));
    })
    .map(named);

  return {
    definitionsId: attribute(root, 'id') ?? null,
    exporter: attribute(root, 'exporter') ?? null,
    exporterVersion: attribute(root, 'exporterVersion') ?? null,
    targetNamespace: attribute(root, 'targetNamespace') ?? null,
    processes,
    participants: participantEls.length,
    blackBoxParticipants,
    callActivities,
    collapsedSubprocesses,
    messageFlows: all.filter((el) => bpmn(el, 'messageFlow')).length,
    diagrams,
    elements: all.length + 1,
    extensionNamespaces: [...extensionNamespaces].sort(compare),
    ids,
  };
}

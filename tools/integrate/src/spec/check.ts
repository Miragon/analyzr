/**
 * The renderer's self-check (M6 S3c §3.4), run on every render, also
 * outside the tests: the bytes are read back, and the model is refused
 * (`failed: self-check`) when
 *
 * - bpmn-moddle reports any warning (unknown content, an unresolved
 *   reference, a duplicate id);
 * - an id is unsafe, longer than 255 characters or not unique, or an
 *   element's id is another element's id plus `_label` or `_plane`, the
 *   ids bpmn-js derives for a label and a drill-down plane (`ids.ts`);
 * - an element bpmn-js draws (participant, lane, flow node, data store,
 *   sequence flow, message flow, data association) has no DI element, or
 *   more than one, or one of the wrong kind;
 * - a `callActivity` element or a `calledElement` attribute exists
 *   (element and attribute names, not a substring of the text).
 *
 * The full fact extraction of `@analyzr/bpmn-facts` runs in the tests only:
 * bundling it would pull in the contracts with zod.
 */
import { attribute, descendants, parseXml, type XmlElement } from '../xml.ts';

import { BPMNJS_SUFFIXES, isRenderedId } from './ids.ts';
import { specModdle } from './moddle.ts';

const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const BPMNDI_NS = 'http://www.omg.org/spec/BPMN/20100524/DI';

/** BPMN elements with an id that bpmn-js does not draw. */
const NOT_DRAWN = new Set([
  'definitions',
  'process',
  'collaboration',
  'laneSet',
  'message',
  'signal',
  'property',
]);
const EDGES = new Set([
  'sequenceFlow',
  'messageFlow',
  'dataInputAssociation',
  'dataOutputAssociation',
]);

/** Most problems listed. */
const MAX_LISTED = 20;

export interface SelfCheck {
  /** Empty when the model passed. */
  problems: string[];
  /** Elements of the document (analyzr refuses more than 50,000). */
  elements: number;
}

/** Checks rendered BPMN (see the module comment). */
export async function selfCheck(xml: string): Promise<SelfCheck> {
  const problems: string[] = [];
  const note = (message: string): void => {
    if (problems.length < MAX_LISTED) problems.push(message);
  };
  let doc;
  try {
    doc = parseXml(xml);
  } catch (err) {
    return { problems: [`not well-formed: ${String(err)}`], elements: 0 };
  }
  const all: XmlElement[] = [doc.root, ...descendants(doc.root)];
  const ids = new Set<string>();
  const elementIds = new Set<string>();
  const drawn: { id: string; edge: boolean }[] = [];
  const di = new Map<string, string[]>();
  for (const el of all) {
    if (el.local === 'callActivity') note(`a callActivity element (${attribute(el, 'id') ?? ''})`);
    for (const a of el.attributes) {
      const local = a.name.slice(a.name.indexOf(':') + 1);
      if (local === 'calledElement') note(`a calledElement attribute on <${el.name}>`);
    }
    const id = attribute(el, 'id');
    if (id !== undefined) {
      if (!isRenderedId(id)) note(`unsafe id ${JSON.stringify(id.slice(0, 80))}`);
      if (ids.has(id)) note(`id ${id} twice`);
      ids.add(id);
      if (el.ns === BPMN_NS) elementIds.add(id);
      if (el.ns === BPMN_NS && !NOT_DRAWN.has(el.local)) {
        drawn.push({ id, edge: EDGES.has(el.local) });
      }
    }
    if (el.ns === BPMNDI_NS && (el.local === 'BPMNShape' || el.local === 'BPMNEdge')) {
      const target = attribute(el, 'bpmnElement') ?? '';
      const found = di.get(target);
      if (found === undefined) di.set(target, [el.local]);
      else found.push(el.local);
    }
  }
  for (const id of elementIds) {
    for (const suffix of BPMNJS_SUFFIXES) {
      if (id.endsWith(suffix) && elementIds.has(id.slice(0, -suffix.length))) {
        note(`id ${id} is the id bpmn-js derives for ${id.slice(0, -suffix.length)}`);
      }
    }
  }
  for (const { id, edge } of drawn) {
    const found = di.get(id) ?? [];
    const want = edge ? 'BPMNEdge' : 'BPMNShape';
    if (found.length !== 1 || found[0] !== want) {
      note(`${id}: ${found.length === 0 ? 'no DI' : found.join(', ')} (expected one ${want})`);
    }
  }
  const parsed = await specModdle().fromXML(xml);
  for (const w of parsed.warnings) note(`bpmn-moddle: ${w.message.replace(/\s+/g, ' ')}`);
  return { problems, elements: doc.elements };
}

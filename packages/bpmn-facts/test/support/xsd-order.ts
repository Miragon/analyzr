// A dependency-free check of the BPMN XSD's child order (M6 §4.8 c "Applying"):
// the order the Camunda 7 and Zeebe parsers validate and bpmn-moddle tolerates.
// It stands in for the Modeler saves §4.8 c asks for (S5c-2 as delivered):
// - every BPMN element (`tBaseElement`): `documentation*`, then
//   `extensionElements?`, then everything else;
// - `definitions`: `import*`, `extension*`, root elements, `BPMNDiagram*`,
//   `relationship*`.
// Only BPMN model and BPMN DI children count; vendor elements outside
// `extensionElements` are none of the XSD's business here.
import { scanElements } from '../../src/xml-elements.ts';
import type { XmlDocument, XmlElement } from '../../src/xml-elements.ts';

const BPMN = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const BPMNDI = 'http://www.omg.org/spec/BPMN/20100524/DI';

/** Rank of a `definitions` child in the XSD's sequence; `null` for one it ignores. */
function definitionsRank(c: XmlElement): number | null {
  if (c.ns === BPMNDI) return c.local === 'BPMNDiagram' ? 3 : null;
  if (c.ns !== BPMN) return null;
  switch (c.local) {
    case 'import':
      return 0;
    case 'extension':
      return 1;
    case 'relationship':
      return 4;
    default:
      return 2;
  }
}

/** Rank of a BPMN element's child: documentation, extensionElements, the rest. */
function baseRank(c: XmlElement): number | null {
  if (c.ns !== BPMN) return null;
  return c.local === 'documentation' ? 0 : c.local === 'extensionElements' ? 1 : 2;
}

function children(doc: XmlDocument, el: XmlElement): XmlElement[] {
  return el.children.map((i) => doc.elements[i]).filter((c): c is XmlElement => c !== undefined);
}

/**
 * The places where the text breaks the XSD's child order, e.g.
 * `definitions: <bpmn:message> after <bpmn:relationship>`; empty when it
 * keeps it.
 */
export function xsdOrderViolations(text: string): string[] {
  const doc = scanElements(text.startsWith('﻿') ? text.slice(1) : text);
  const out: string[] = [];
  for (const el of doc.elements) {
    if (el.ns !== BPMN) continue;
    // Text-only content models and the children of extensionElements are not sequences of BPMN elements.
    if (el.local === 'extensionElements' || el.local === 'documentation') continue;
    const rank = el.local === 'definitions' ? definitionsRank : baseRank;
    let max = -1;
    let previous: XmlElement | null = null;
    let extensions = 0;
    for (const c of children(doc, el)) {
      const r = rank(c);
      if (r === null) continue;
      if (el.local !== 'definitions' && r === 1) extensions++;
      if (r < max && previous) {
        out.push(
          `${el.name}#${el.attributes.find((a) => a.name === 'id')?.value ?? '?'}: <${c.name}> after <${previous.name}>`,
        );
      }
      if (r >= max) {
        max = r;
        previous = c;
      }
    }
    if (extensions > 1) out.push(`${el.name}: ${extensions} extensionElements`);
  }
  return out;
}

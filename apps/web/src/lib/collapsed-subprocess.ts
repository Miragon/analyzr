/** A collapsed subprocess selected in the model view (no fact in facts v1, M6 §4.8 a). */
export interface CollapsedSubprocess {
  elementId: string;
  /** Its name, else its id. */
  name: string;
  /** The process it lies in (its id in the file). */
  processId: string;
}

const SUBPROCESS_TAGS = new Set(['subProcess', 'adHocSubProcess', 'transaction']);

/**
 * The collapsed subprocess with this id in a BPMN file, or `null` (not a
 * subprocess, expanded, an event subprocess, or in no process). Collapsed is
 * what bpmn-js draws as collapsed: its diagram shape is not `isExpanded`.
 * Its own module, so the model view (entry chunk) tells it for the panel's
 * tab without loading the pickers (UX3).
 */
export function collapsedSubprocess(xml: string, elementId: string): CollapsedSubprocess | null {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml');
  } catch {
    return null;
  }
  if (doc.getElementsByTagName('parsererror').length > 0) return null;
  const all = doc.getElementsByTagNameNS('*', '*');
  let element: Element | null = null;
  for (const el of Array.from(all)) {
    if (SUBPROCESS_TAGS.has(el.localName) && el.getAttribute('id') === elementId) {
      element = el;
      break;
    }
  }
  if (!element || element.getAttribute('triggeredByEvent') === 'true') return null;
  const shape = Array.from(doc.getElementsByTagNameNS('*', 'BPMNShape')).find(
    (s) => s.getAttribute('bpmnElement') === elementId,
  );
  if (!shape || shape.getAttribute('isExpanded') === 'true') return null;
  let parent = element.parentElement;
  while (parent && parent.localName !== 'process') parent = parent.parentElement;
  const processId = parent?.getAttribute('id');
  if (!processId) return null;
  return { elementId, name: element.getAttribute('name')?.trim() || elementId, processId };
}

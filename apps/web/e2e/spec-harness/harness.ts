/**
 * The import check of models rendered by analyzr-spec (M6 S3c done-when D2 b), run in a real
 * browser by `e2e/spec-render-import.spec.ts`: bpmn-js's NavigatedViewer, loaded as the model
 * view loads it (`src/components/bpmn-canvas.tsx`), imports each model; the result is counts
 * only, never names. Exposes `window.specHarness`.
 */
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';

import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';

/** A parsed element, read loosely. */
interface El {
  $type: string;
  id?: string;
  [key: string]: unknown;
}

interface Registered {
  id: string;
  type: string;
  waypoints?: unknown[];
  labelTarget?: unknown;
  businessObject?: { id?: string };
}

export interface SpecCheck {
  /** Import warnings bpmn-js reported. */
  warnings: number;
  /** 1 when the import failed. */
  errors: number;
  /** Shapes in the element registry (labels and roots left out). */
  shapes: number;
  /** Connections in the element registry. */
  edges: number;
  /**
   * Participants, lanes, flow elements, data associations and message flows not drawn: no
   * registry entry under their id, or one that is another element's (a label bpmn-js named
   * `<id>_label`, a plane `<id>_plane`).
   */
  missing: number;
}

const list = (el: El | undefined, key: string): El[] => (el?.[key] as El[] | undefined) ?? [];

/** The ids of every element bpmn-js should draw. */
function drawable(definitions: El): string[] {
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
  return out.map((el) => el.id ?? '');
}

async function check(xml: string): Promise<SpecCheck> {
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;inset:0;width:1600px;height:1000px';
  document.body.append(host);
  const viewer = new NavigatedViewer({ container: host });
  try {
    const { warnings } = await viewer.importXML(xml);
    const registry = viewer.get<{
      getAll(): Registered[];
      get(id: string): Registered | undefined;
    }>('elementRegistry');
    const drawn = (id: string): boolean => {
      const entry = registry.get(id);
      return (
        entry !== undefined &&
        entry.type !== 'label' &&
        entry.labelTarget === undefined &&
        entry.businessObject?.id === id
      );
    };
    const all = registry.getAll();
    const definitions = viewer.getDefinitions() as unknown as El;
    return {
      warnings: warnings.length,
      errors: 0,
      shapes: all.filter(
        (e) => e.waypoints === undefined && e.type !== 'label' && e.labelTarget === undefined,
      ).length,
      edges: all.filter((e) => e.waypoints !== undefined).length,
      missing: drawable(definitions).filter((id) => !drawn(id)).length,
    };
  } catch {
    return { warnings: 0, errors: 1, shapes: 0, edges: 0, missing: 0 };
  } finally {
    viewer.destroy();
    host.remove();
  }
}

declare global {
  interface Window {
    specHarness: { check: (xml: string) => Promise<SpecCheck>; ready: boolean };
  }
}

window.specHarness = { check, ready: true };

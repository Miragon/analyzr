/**
 * The parts of bpmn-js / diagram-js the model view uses, typed locally
 * (bpmn-js exports no service types), plus the pure element lookup.
 */

/** The parts of diagram-js services this component uses (bpmn-js ships no service types). */
export interface DiagramElement {
  id: string;
  type: string;
  /** Shapes have bounds; connections and the root do not. */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  parent?: DiagramElement;
  businessObject?: {
    processRef?: { id?: string };
    /** A send or receive task's message. */
    messageRef?: { id?: string };
    /** An event's definitions: the message or signal it references. */
    eventDefinitions?: { messageRef?: { id?: string }; signalRef?: { id?: string } }[];
  };
}
export interface ElementRegistry {
  get(id: string): DiagramElement | undefined;
  filter(fn: (element: DiagramElement) => boolean): DiagramElement[];
}
export interface Canvas {
  zoom(): number;
  zoom(level: number | 'fit-viewport', center?: 'auto'): number;
  addMarker(element: DiagramElement | string, marker: string): void;
  removeMarker(element: DiagramElement | string, marker: string): void;
  scrollToElement(element: DiagramElement, padding?: number): void;
  getRootElement(): DiagramElement;
  viewbox(): Viewbox;
  viewbox(box: Pick<Viewbox, 'x' | 'y' | 'width' | 'height'>): Viewbox;
}
export interface Viewbox {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  outer: { width: number; height: number };
}
export interface Overlays {
  add(
    element: DiagramElement | string,
    type: string,
    overlay: { position: Record<string, number>; html: HTMLElement },
  ): string;
  remove(filter: { type: string }): void;
}
export interface EventBus {
  on(event: string, callback: (event: { element: DiagramElement }) => void): void;
}
export interface Viewer {
  importXML(xml: string): Promise<{ warnings: unknown[] }>;
  get(name: 'canvas'): Canvas;
  get(name: 'elementRegistry'): ElementRegistry;
  get(name: 'overlays'): Overlays;
  get(name: 'eventBus'): EventBus;
  destroy(): void;
}

export interface CanvasHighlight {
  /** Element id, or a process id (resolved to its pool in a collaboration). */
  elementId: string;
  /** Short text shown next to the element, e.g. "Von" or "Nach". */
  label: string;
  tone?: 'endpoint' | 'related' | 'finding' | 'evidence';
}

export const MARKERS = {
  endpoint: 'analyzr-endpoint',
  related: 'analyzr-related',
  finding: 'analyzr-finding',
  evidence: 'analyzr-evidence',
} as const;
export const OVERLAY_TYPE = 'analyzr-highlight';
/** The overlays „ergänzt“ on elements an amendment wrote (M6 S5c-2). */
export const AMENDED_OVERLAY_TYPE = 'analyzr-amended';

/**
 * A shape for an element or process id: the element itself, else the pool
 * whose process has that id. `null` for the diagram root (a plain process).
 */
export function resolveElement(
  registry: Pick<ElementRegistry, 'get' | 'filter'>,
  id: string,
): DiagramElement | null {
  const direct = registry.get(id);
  if (direct && direct.parent) return direct;
  const pool = registry.filter(
    (e) => e.type === 'bpmn:Participant' && e.businessObject?.processRef?.id === id,
  )[0];
  return pool ?? null;
}

/** Whether a shape references the message or signal `id` (its event definition, or a send or receive task). */
function references(element: DiagramElement, id: string): boolean {
  const bo = element.businessObject;
  if (!bo) return false;
  if (bo.messageRef?.id === id) return true;
  return (bo.eventDefinitions ?? []).some((d) => d.messageRef?.id === id || d.signalRef?.id === id);
}

/**
 * The shapes an amendment of `id` shows at (M6 S5c-2, the overlay
 * „ergänzt“): the element itself, the pool of a process, or, for a
 * `bpmn:message` or `bpmn:signal` (a root element without a shape), every
 * shape that references it. Empty for the root of a plain process.
 */
export function resolveAmended(
  registry: Pick<ElementRegistry, 'get' | 'filter'>,
  id: string,
): DiagramElement[] {
  const element = resolveElement(registry, id);
  if (element) return [element];
  if (registry.get(id)) return [];
  return registry.filter((e) => e.parent !== undefined && e.type !== 'label' && references(e, id));
}

/** The id a click on `element` refers to: a pool stands for its process. */
export function clickedId(element: DiagramElement): string {
  if (element.type === 'bpmn:Participant')
    return element.businessObject?.processRef?.id ?? element.id;
  return element.id;
}

/** Smallest zoom at which labels stay readable when the view jumps to an element. */
export const FOCUS_SCALE = 1;
/** Below this zoom an element counts as unreadable even when it is in view. */
export const READABLE_SCALE = 0.75;

/** True if `element` lies fully inside the viewbox at a readable zoom: no need to move. */
export function isInView(
  current: Pick<Viewbox, 'x' | 'y' | 'width' | 'height' | 'scale'>,
  element: Pick<DiagramElement, 'x' | 'y' | 'width' | 'height'>,
): boolean {
  const { x, y, width, height } = element;
  if (x === undefined || y === undefined || width === undefined || height === undefined)
    return false;
  return (
    current.scale >= READABLE_SCALE &&
    x >= current.x &&
    y >= current.y &&
    x + width <= current.x + current.width &&
    y + height <= current.y + current.height
  );
}

/**
 * The viewbox that centres `element` at a readable scale (at least
 * {@link FOCUS_SCALE}, more if the user zoomed in further); `null` for
 * elements without bounds.
 */
export function focusViewbox(
  current: Pick<Viewbox, 'scale' | 'outer'>,
  element: Pick<DiagramElement, 'x' | 'y' | 'width' | 'height'>,
): Pick<Viewbox, 'x' | 'y' | 'width' | 'height'> | null {
  const { x, y, width, height } = element;
  if (x === undefined || y === undefined || width === undefined || height === undefined)
    return null;
  const scale = Math.max(current.scale, FOCUS_SCALE);
  const w = current.outer.width / scale;
  const h = current.outer.height / scale;
  return { x: x + width / 2 - w / 2, y: y + height / 2 - h / 2, width: w, height: h };
}

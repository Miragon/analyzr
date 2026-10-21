/**
 * The deterministic left-to-right layout of a rendered spec (M6 S3c §3.2),
 * started from a copy of `eval/tools/lib/layout.mjs` (M6 §3.9 allows it) and
 * cut to what `analyzr-spec/1` draws: no expanded or event subprocesses, no
 * boundary events. Per process:
 *
 * 1. cycles are broken by a depth-first search in id order;
 * 2. layers follow the longest path from the starts (a node without an
 *    incoming flow starts at layer 0);
 * 3. long edges reserve dummy slots in the layers they cross (at most
 *    {@link MAX_SLOTS} per process, else the layout refuses);
 * 4. rows are assigned per lane: of the items wanting a row, the one on the
 *    longest remaining path to an end keeps it (so the main line stays
 *    straight), the others go below, ties to nodes before dummies, then to
 *    the smaller id, so nothing depends on list order;
 * 5. columns and rows are sized to their largest shape, each shape centred
 *    in its cell; the gaps between rows grow with the external labels of
 *    events (below) and gateways (above), so no label covers a shape;
 * 6. edges are orthogonal and bend in the gaps between columns (a split
 *    gateway's leave through its top or bottom, a join's enter there); back
 *    edges loop below or above their rows, whichever side's legs cross
 *    fewer shapes, overlapping loops on tracks of their own that the rows
 *    make room for, so no loop leaves its lane; a flow from a node to itself
 *    loops on the side its label leaves free;
 * 7. a flow's label sits in the column gap after its source's column (a
 *    loop's after its target's), which no shape occupies: the gap widens to
 *    the label, and each lane keeps room above its first and below its last
 *    row's middle for the tallest label of its flows, so no label leaves its
 *    lane or covers a shape.
 *
 * Pools are stacked in list order (processes, then black-box participants)
 * with equal width, lanes tile the pool in list order, and nodes without a
 * lane (converter output only) sit in an unlaned band at the bottom of their
 * pool; no lane is invented. Data stores sit in a band below the lane of
 * their first user by id, data associations run orthogonally to them, and
 * message flows run vertically and bend in the strip next to their source
 * pool, which holds their labels and grows with them; one that would cross a
 * shape of a pool between its ends takes the free corridor left of every
 * pool's first column.
 * Coordinates are integers; the layout depends on nothing but its input, in
 * which nodes, flows and data stores come sorted by id.
 */

export const L = {
  COL_GAP: 60,
  ROW_GAP: 50,
  MIN_ROW_H: 80,
  PAD_LEFT: 50,
  PAD_RIGHT: 50,
  PAD_TOP: 40,
  PAD_BOTTOM: 50,
  BAND_GAP: 50,
  DS_GAP: 30,
  POOL_HEADER: 30,
  LANE_HEADER: 30,
  POOL_GAP: 60,
  BLACKBOX_H: 60,
  MIN_LANE_H: 120,
  MIN_POOL_W: 600,
  ORIGIN_X: 150,
  ORIGIN_Y: 80,
  LABEL_MAX_W: 90,
  LABEL_LINE_H: 14,
  LABEL_GAP: 7,
  LABEL_MARGIN: 6,
  CHAR_W: 6,
  LOOP: 20,
  /** Distance between loops that run side by side. */
  TRACK: 10,
  /** Distance between a flow's label and its line. */
  FLOW_LABEL_GAP: 4,
} as const;

export type ShapeKind = 'event' | 'activity' | 'gateway';

export const SIZE: Readonly<Record<ShapeKind | 'store', { w: number; h: number }>> = {
  event: { w: 36, h: 36 },
  activity: { w: 100, h: 80 },
  gateway: { w: 50, h: 50 },
  store: { w: 50, h: 50 },
};

export interface LayoutNode {
  id: string;
  kind: ShapeKind;
  /** The external label's text (events and gateways), or `null`. */
  label: string | null;
  /** The lane's id, or `null`. */
  lane: string | null;
  isStart: boolean;
}

export interface LayoutFlow {
  id: string;
  from: string;
  to: string;
  label: string | null;
}

export interface LayoutStore {
  id: string;
  label: string | null;
  /** Ids of the nodes that read or write it. */
  users: string[];
}

export interface LayoutAssociation {
  id: string;
  node: string;
  store: string;
  read: boolean;
}

export interface LayoutProcess {
  /** The pool's participant id (drawn only in a collaboration). */
  participant: string;
  /** Lane ids, top to bottom. */
  lanes: string[];
  /** Sorted by id, as `flows` and `stores`. */
  nodes: LayoutNode[];
  flows: LayoutFlow[];
  stores: LayoutStore[];
  associations: LayoutAssociation[];
}

export interface LayoutMessageFlow {
  id: string;
  /** A node's or a participant's id. */
  from: string;
  to: string;
  fromPool: string;
  toPool: string;
  label: string | null;
}

export interface LayoutInput {
  collaboration: boolean;
  /** Pools top to bottom (one in a model without a collaboration). */
  processes: LayoutProcess[];
  /** Black-box participants' ids, below the processes. */
  blackBoxes: string[];
  messageFlows: LayoutMessageFlow[];
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ShapeDi {
  bounds: Bounds;
  label?: Bounds;
  /** Participants and lanes. */
  horizontal?: true;
}

export interface EdgeDi {
  waypoints: Point[];
  label?: Bounds;
}

export interface LayoutResult {
  shapes: Map<string, ShapeDi>;
  edges: Map<string, EdgeDi>;
}

class Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;

  constructor(x: number, y: number, w: number, h: number) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
  }

  get cx(): number {
    return this.x + this.w / 2;
  }

  get cy(): number {
    return this.y + this.h / 2;
  }

  get right(): number {
    return this.x + this.w;
  }

  get bottom(): number {
    return this.y + this.h;
  }

  moved(dx: number, dy: number): Box {
    return new Box(this.x + dx, this.y + dy, this.w, this.h);
  }

  bounds(): Bounds {
    return { x: this.x, y: this.y, width: this.w, height: this.h };
  }
}

const even = (v: number): number => Math.ceil(v / 2) * 2;
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `map.get(key)`, which the layout has always set before. */
function at<K, V>(map: ReadonlyMap<K, V>, key: K): V {
  const value = map.get(key);
  if (value === undefined) throw new Error('layout: missing entry');
  return value;
}

/**
 * The approximate box of an external label (bpmn-js draws 11px Arial in
 * lines of about 14px, at most 90px wide, and breaks a word that does not
 * fit, as diagram-js's text layout does).
 */
export function textBox(text: string): { width: number; height: number } {
  const perLine = Math.floor(L.LABEL_MAX_W / L.CHAR_W);
  const words = text
    .trim()
    .split(/\s+/)
    .flatMap((w) => w.match(new RegExp(`.{1,${perLine}}`, 'gsu')) ?? []);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const candidate = line === '' ? w : `${line} ${w}`;
    if (line !== '' && candidate.length > perLine) {
      lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line !== '') lines.push(line);
  const width = Math.max(L.CHAR_W, ...lines.map((l) => l.length * L.CHAR_W));
  return { width: Math.ceil(width), height: Math.max(1, lines.length) * L.LABEL_LINE_H };
}

function simplify(points: readonly Point[]): Point[] {
  const pts = points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  const dedup = pts.filter((p, i) => {
    const prev = pts[i - 1];
    return prev === undefined || p.x !== prev.x || p.y !== prev.y;
  });
  return dedup.filter((p, i) => {
    const a = dedup[i - 1];
    const b = dedup[i + 1];
    if (a === undefined || b === undefined) return true;
    return !((a.x === p.x && p.x === b.x) || (a.y === p.y && p.y === b.y));
  });
}

function labelBelow(b: Box, text: string): Bounds {
  const t = textBox(text);
  return {
    x: Math.round(b.cx - t.width / 2),
    y: Math.round(b.bottom + L.LABEL_GAP),
    width: t.width,
    height: t.height,
  };
}

function labelAbove(b: Box, text: string): Bounds {
  const t = textBox(text);
  return {
    x: Math.round(b.cx - t.width / 2),
    y: Math.round(b.y - L.LABEL_GAP - t.height),
    width: t.width,
    height: t.height,
  };
}

// ------------------------------------------------------------------- grid

interface Dummy {
  dummy: true;
  layer: number;
  lane: string | null;
  /** The flow whose slot it is. */
  key: string;
  /** Length of the remaining path: the rest of its edge plus its target's. */
  rest: number;
}

type Item = LayoutNode | Dummy;

const isDummy = (it: Item): it is Dummy => 'dummy' in it;

interface Edge {
  flow: LayoutFlow;
  from: LayoutNode;
  to: LayoutNode;
}

interface Band {
  lane: string | null;
  y: number;
  height: number;
}

interface Grid {
  width: number;
  height: number;
  bands: Band[];
  pos: Map<string, Box>;
  routes: Map<string, Point[]>;
  /** Flow labels by flow id. */
  labels: Map<string, Bounds>;
}

/** A back edge's loop: along which row (in the order of all rows, top to bottom), on which side, on which track there. */
interface Loop {
  edge: Edge;
  side: 'below' | 'above';
  row: number;
  track: number;
}

/**
 * Most slots the flows of one process may reserve in the layers they skip (a
 * flow over n layers takes n − 1): the layout's work and size grow with them,
 * and a model needing more could be neither drawn nor read.
 */
export const MAX_SLOTS = 100_000;

/** Thrown when a process needs more than {@link MAX_SLOTS} slots. */
export class LayoutLimitError extends Error {
  readonly slots: number;

  constructor(slots: number) {
    super(
      `the layout needs ${slots} slots for flows that skip layers, at most ${MAX_SLOTS}: split the model`,
    );
    this.name = 'LayoutLimitError';
    this.slots = slots;
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

/**
 * Lays out one process in coordinates relative to its pool's content area.
 *
 * @throws {LayoutLimitError} when its long flows need more than {@link MAX_SLOTS} slots
 */
function computeGrid(proc: LayoutProcess): Grid {
  const laned = proc.lanes.length > 0;
  const unlaned = laned && proc.nodes.some((n) => n.lane === null);
  const laneIds: (string | null)[] = laned ? [...proc.lanes, ...(unlaned ? [null] : [])] : [null];
  const laneOf = (n: LayoutNode): string | null => (laned ? n.lane : null);
  const nodes = proc.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const shapeSize = (n: LayoutNode) => SIZE[n.kind];

  const edges: Edge[] = proc.flows
    .filter((f) => f.from !== f.to)
    .map((flow) => ({ flow, from: at(byId, flow.from), to: at(byId, flow.to) }));
  const succ = new Map<LayoutNode, Edge[]>(nodes.map((n) => [n, []]));
  for (const e of edges) at(succ, e.from).push(e);

  // 1. cycle breaking: depth-first in id order, from the starts, then nodes without incoming flow
  const incoming = new Set(edges.map((e) => e.to));
  const state = new Map<LayoutNode, number>();
  const back = new Set<Edge>();
  const roots = [
    ...nodes.filter((n) => n.isStart),
    ...nodes.filter((n) => !n.isStart && !incoming.has(n)),
    ...nodes,
  ];
  for (const r of roots) {
    if (state.has(r)) continue;
    state.set(r, 1);
    const stack: [LayoutNode, number][] = [[r, 0]];
    for (let top = stack.at(-1); top !== undefined; top = stack.at(-1)) {
      const out = at(succ, top[0]);
      const e = out[top[1]];
      if (e !== undefined) {
        top[1]++;
        const s = state.get(e.to) ?? 0;
        if (s === 1) back.add(e);
        else if (s === 0) {
          state.set(e.to, 1);
          stack.push([e.to, 0]);
        }
      } else {
        state.set(top[0], 2);
        stack.pop();
      }
    }
  }
  const fwd = edges.filter((e) => !back.has(e));

  // 2. longest-path layering
  const layer = new Map<LayoutNode, number>(nodes.map((n) => [n, 0]));
  const indeg = new Map<LayoutNode, number>(nodes.map((n) => [n, 0]));
  for (const e of fwd) indeg.set(e.to, at(indeg, e.to) + 1);
  const order: LayoutNode[] = nodes.filter((n) => at(indeg, n) === 0);
  for (let i = 0; i < order.length; i++) {
    const n = order[i];
    if (n === undefined) continue;
    for (const e of at(succ, n)) {
      if (back.has(e)) continue;
      layer.set(e.to, Math.max(at(layer, e.to), at(layer, n) + 1));
      indeg.set(e.to, at(indeg, e.to) - 1);
      if (at(indeg, e.to) === 0) order.push(e.to);
    }
  }
  const maxLayer = Math.max(0, ...nodes.map((n) => at(layer, n)));
  // the longest remaining path (in flows) from each node to an end
  const rest = new Map<LayoutNode, number>();
  for (const n of [...order].reverse()) {
    let best = 0;
    for (const e of at(succ, n)) if (!back.has(e)) best = Math.max(best, 1 + (rest.get(e.to) ?? 0));
    rest.set(n, best);
  }
  const restOf = (it: Item): number => (isDummy(it) ? it.rest : (rest.get(it) ?? 0));

  // 3. chains with dummy slots for long edges, counted first: their number bounds the work
  let slots = 0;
  for (const e of fwd) slots += at(layer, e.to) - at(layer, e.from) - 1;
  if (slots > MAX_SLOTS) throw new LayoutLimitError(slots);
  const chains = fwd.map((edge) => {
    const items: Item[] = [edge.from];
    for (let l = at(layer, edge.from) + 1; l < at(layer, edge.to); l++) {
      items.push({
        dummy: true,
        layer: l,
        lane: laneOf(edge.from),
        key: edge.flow.id,
        rest: 1 + (rest.get(edge.to) ?? 0),
      });
    }
    items.push(edge.to);
    return { edge, items };
  });
  const layerOf = (it: Item): number => (isDummy(it) ? it.layer : at(layer, it));
  const laneOfItem = (it: Item): string | null => (isDummy(it) ? it.lane : laneOf(it));
  const keyOf = (it: Item): string => (isDummy(it) ? it.key : it.id);
  const preds = new Map<Item, Item[]>();
  const items: Item[] = [...nodes];
  for (const c of chains) {
    c.items.forEach((it, k) => {
      if (isDummy(it)) items.push(it);
      const prev = c.items[k - 1];
      if (prev !== undefined) push(preds, it, prev);
    });
  }

  // 4. rows per (layer, lane)
  const row = new Map<Item, number>();
  const cell = new Map<string, Item[]>();
  for (const it of items) push(cell, `${layerOf(it)}|${laneOfItem(it)}`, it);
  for (let l = 0; l <= maxLayer; l++) {
    for (const lane of laneIds) {
      const list = cell.get(`${l}|${lane}`) ?? [];
      const desired = new Map<Item, number>();
      for (const it of list) {
        const ps = (preds.get(it) ?? []).filter((p) => laneOfItem(p) === lane && row.has(p));
        desired.set(it, ps.length > 0 ? Math.min(...ps.map((p) => at(row, p))) : 0);
      }
      list.sort(
        (a, b) =>
          at(desired, a) - at(desired, b) ||
          restOf(b) - restOf(a) ||
          Number(isDummy(a)) - Number(isDummy(b)) ||
          compare(keyOf(a), keyOf(b)),
      );
      let last = -1;
      for (const it of list) {
        const r = Math.max(at(desired, it), last + 1);
        row.set(it, r);
        last = r;
      }
    }
  }

  // 5. row heights per lane and the label room of events and gateways between rows; every row
  // in one order, top to bottom
  const rowsOf = new Map<string | null, { h: number; above: number; below: number }[]>(
    laneIds.map((id) => [id, []]),
  );
  for (const it of items) {
    const rows = at(rowsOf, laneOfItem(it));
    const r = at(row, it);
    while (rows.length <= r) rows.push({ h: L.MIN_ROW_H, above: 0, below: 0 });
    const entry = rows[r];
    if (!isDummy(it) && entry !== undefined) entry.h = Math.max(entry.h, shapeSize(it).h);
  }
  for (const id of laneIds) {
    const rows = at(rowsOf, id);
    if (rows.length === 0) rows.push({ h: L.MIN_ROW_H, above: 0, below: 0 });
  }
  for (const n of nodes) {
    if (n.label === null || n.kind === 'activity') continue;
    const entry = at(rowsOf, laneOf(n))[at(row, n)];
    if (entry === undefined) continue;
    const over = L.LABEL_GAP + textBox(n.label).height - (entry.h - shapeSize(n).h) / 2;
    if (n.kind === 'event') entry.below = Math.max(entry.below, over);
    else entry.above = Math.max(entry.above, over);
  }
  const laneIndex = new Map(laneIds.map((id, i) => [id, i]));
  const rowBase: number[] = [];
  let rowCount = 0;
  for (const id of laneIds) {
    rowBase.push(rowCount);
    rowCount += at(rowsOf, id).length;
  }
  /** An item's row in the order of all rows. */
  const g = (it: Item): number => (rowBase[at(laneIndex, laneOfItem(it))] ?? 0) + at(row, it);

  // 6. back edges loop below (or above) the rows they join, on the side whose legs cross fewer
  // shapes of their columns; overlapping loops along one row and side get tracks of their own,
  // and the rows make room for them
  const nodesByLayer = new Map<number, LayoutNode[]>();
  for (const n of nodes) push(nodesByLayer, at(layer, n), n);
  const crossed = (
    n: LayoutNode,
    from: number,
    to: number,
    skip: readonly LayoutNode[],
  ): number => {
    let count = 0;
    for (const m of nodesByLayer.get(at(layer, n)) ?? []) {
      if (!skip.includes(m) && g(m) >= from && g(m) <= to) count++;
    }
    return count;
  };
  const loops: Loop[] = [];
  const tracksAt = new Map<string, { lo: number; hi: number; track: number }[]>();
  /** Tracks used below and above a row, by its index in the order of all rows. */
  const tracksBelow = new Map<number, number>();
  const tracksAbove = new Map<number, number>();
  for (const edge of [...back].sort((a, b) => compare(a.flow.id, b.flow.id))) {
    const gs = g(edge.from);
    const gt = g(edge.to);
    const lower = Math.max(gs, gt);
    const upper = Math.min(gs, gt);
    const skip = [edge.from, edge.to];
    const below = crossed(edge.from, gs + 1, lower, skip) + crossed(edge.to, gt + 1, lower, skip);
    const above = crossed(edge.from, upper, gs - 1, skip) + crossed(edge.to, upper, gt - 1, skip);
    const side = above < below ? 'above' : 'below';
    const anchor = side === 'below' ? lower : upper;
    const lo = Math.min(at(layer, edge.from), at(layer, edge.to));
    const hi = Math.max(at(layer, edge.from), at(layer, edge.to));
    const key = `${side}|${anchor}`;
    const used = tracksAt.get(key) ?? [];
    const busy = new Set(used.filter((u) => u.hi > lo && u.lo < hi).map((u) => u.track));
    let track = 0;
    while (busy.has(track)) track++;
    used.push({ lo, hi, track });
    tracksAt.set(key, used);
    const tracks = side === 'below' ? tracksBelow : tracksAbove;
    tracks.set(anchor, Math.max(tracks.get(anchor) ?? 0, track + 1));
    loops.push({ edge, side, row: anchor, track });
  }

  // 7. flow labels: each sits in the column gap after its source's column (a loop's after its
  // target's), which no shape occupies, so that gap is wide enough for it; each lane keeps room
  // above its first row's middle and below its last row's for the tallest label of a flow from
  // or to it, so a label never leaves its lane
  const gapW = Array.from({ length: maxLayer + 1 }, (_, l): number =>
    l < maxLayer ? L.COL_GAP : 0,
  );
  const labelLayer = new Map<string, number>();
  const labelRoom = new Map<string | null, number>(laneIds.map((id) => [id, 0]));
  for (const f of proc.flows) {
    if (f.label === null) continue;
    const from = at(byId, f.from);
    const to = at(byId, f.to);
    const t = textBox(f.label);
    const l = Math.min(at(layer, from), at(layer, to));
    labelLayer.set(f.id, l);
    // a self-loop's label sits right of the loop's leg in the gap
    const lead = from === to ? L.LOOP + L.FLOW_LABEL_GAP : L.LABEL_MARGIN;
    gapW[l] = Math.max(gapW[l] ?? 0, even(t.width + lead + L.LABEL_MARGIN));
    const need = t.height + L.FLOW_LABEL_GAP + L.LABEL_MARGIN;
    for (const n of [from, to]) labelRoom.set(laneOf(n), Math.max(at(labelRoom, laneOf(n)), need));
  }

  const colW = Array.from({ length: maxLayer + 1 }, () => SIZE.event.w);
  for (const n of nodes) colW[at(layer, n)] = Math.max(colW[at(layer, n)] ?? 0, shapeSize(n).w);
  const colX: number[] = [L.PAD_LEFT];
  for (let l = 1; l <= maxLayer; l++) {
    colX[l] = (colX[l - 1] ?? 0) + (colW[l - 1] ?? 0) + (gapW[l - 1] ?? 0);
  }
  const mainRight = (colX[maxLayer] ?? 0) + (colW[maxLayer] ?? 0);

  // data stores: in the band of the lane of their first user by id
  const storesByLane = new Map<string | null, { store: LayoutStore; anchor: LayoutNode | null }[]>(
    laneIds.map((id) => [id, []]),
  );
  for (const store of proc.stores) {
    const users = store.users.map((u) => at(byId, u)).sort((a, b) => compare(a.id, b.id));
    const anchor = users[0] ?? null;
    const lane = laned ? (anchor === null ? (proc.lanes[0] ?? null) : anchor.lane) : null;
    at(storesByLane, lane).push({ store, anchor });
  }

  // vertical bands
  const rowTop = new Map<string | null, number[]>();
  const storeTop = new Map<string | null, number>();
  const bands: Band[] = [];
  let y = 0;
  for (const lane of laneIds) {
    const rows = at(rowsOf, lane);
    const base = rowBase[at(laneIndex, lane)] ?? 0;
    const room = at(labelRoom, lane);
    const first = rows[0];
    const lastRow = rows.at(-1);
    const top = y;
    const aboveFirst = tracksAbove.get(base) ?? 0;
    let cy =
      top +
      Math.max(
        L.PAD_TOP,
        (first?.above ?? 0) + L.LABEL_MARGIN,
        aboveFirst === 0 ? 0 : L.PAD_TOP + L.TRACK * (aboveFirst - 1),
        room - (first?.h ?? L.MIN_ROW_H) / 2,
      );
    const tops: number[] = [];
    rows.forEach((entry, r) => {
      tops[r] = cy;
      cy += entry.h;
      const next = rows[r + 1];
      if (next === undefined) return;
      const tracks = (tracksBelow.get(base + r) ?? 0) + (tracksAbove.get(base + r + 1) ?? 0);
      cy += Math.max(
        L.ROW_GAP,
        entry.below + next.above + L.LABEL_MARGIN,
        L.ROW_GAP + L.TRACK * Math.max(0, tracks - 1),
      );
    });
    rowTop.set(lane, tops);
    const belowLast = tracksBelow.get(base + rows.length - 1) ?? 0;
    const floor = Math.max(
      (lastRow?.below ?? 0) + L.LABEL_MARGIN,
      belowLast === 0 ? 0 : L.ROW_GAP + L.TRACK * (belowLast - 1),
      room - (lastRow?.h ?? L.MIN_ROW_H) / 2,
    );
    const stores = at(storesByLane, lane);
    if (stores.length > 0) {
      cy += Math.max(L.BAND_GAP, floor);
      storeTop.set(lane, cy);
      cy += SIZE.store.h;
      const labels = stores.map((s) =>
        s.store.label === null ? 0 : textBox(s.store.label).height,
      );
      cy += Math.max(L.PAD_BOTTOM, L.LABEL_GAP + Math.max(0, ...labels) + L.LABEL_MARGIN);
    } else {
      cy += Math.max(L.PAD_BOTTOM, floor);
    }
    let h = Math.ceil(cy - top);
    if (laned) h = Math.max(h, L.MIN_LANE_H);
    bands.push({ lane, y: top, height: h });
    y += h;
  }
  const height = even(y);
  const lastBand = bands.at(-1);
  if (lastBand !== undefined) lastBand.height += height - y; // the bands tile the pool body

  // positions
  const pos = new Map<string, Box>();
  const center = new Map<Dummy, Point>();
  const rowBox = (it: Item): { top: number; h: number } => {
    const lane = laneOfItem(it);
    const r = at(row, it);
    return { top: at(rowTop, lane)[r] ?? 0, h: at(rowsOf, lane)[r]?.h ?? L.MIN_ROW_H };
  };
  for (const it of items) {
    const l = layerOf(it);
    const { top, h: rh } = rowBox(it);
    const x = colX[l] ?? 0;
    const w = colW[l] ?? 0;
    if (isDummy(it)) {
      center.set(it, { x: x + w / 2, y: top + rh / 2 });
    } else {
      const s = shapeSize(it);
      pos.set(
        it.id,
        new Box(Math.round(x + (w - s.w) / 2), Math.round(top + (rh - s.h) / 2), s.w, s.h),
      );
    }
  }
  let right = mainRight;
  for (const lane of laneIds) {
    const placed = at(storesByLane, lane)
      .map(({ store, anchor }) => ({
        store,
        want: anchor === null ? L.PAD_LEFT + SIZE.store.w / 2 : at(pos, anchor.id).cx,
      }))
      .sort((a, b) => a.want - b.want || compare(a.store.id, b.store.id));
    let prevRight = Number.NEGATIVE_INFINITY;
    for (const { store, want } of placed) {
      const x = Math.round(Math.max(want - SIZE.store.w / 2, prevRight + L.DS_GAP, L.PAD_LEFT));
      pos.set(store.id, new Box(x, storeTop.get(lane) ?? 0, SIZE.store.w, SIZE.store.h));
      prevRight = x + SIZE.store.w;
      right = Math.max(right, prevRight);
    }
  }
  // a self-loop's label right of the last column needs the room of that gap
  const width = even(Math.max(right + L.PAD_RIGHT, mainRight + (gapW[maxLayer] ?? 0)));

  // 8. routes
  const columnClear = (l: number, y1: number, y2: number, exclude: LayoutNode): boolean => {
    const lo = Math.min(y1, y2);
    const hi = Math.max(y1, y2);
    return !(nodesByLayer.get(l) ?? []).some((n) => {
      if (n === exclude) return false;
      const b = at(pos, n.id);
      return b.bottom > lo && b.y < hi;
    });
  };
  /** The middle of the column gap before layer `l`, where edges bend. */
  const gapBefore = (l: number): number => (colX[l] ?? 0) - (gapW[l - 1] ?? 0) / 2;
  // A split leaves through its top or bottom and a join is entered there, never both on one
  // gateway: a join's exit would run along its own entries.
  const outDegree = new Map<LayoutNode, number>();
  const inDegree = new Map<LayoutNode, number>();
  for (const e of edges) {
    outDegree.set(e.from, (outDegree.get(e.from) ?? 0) + 1);
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }
  const isSplit = (n: LayoutNode): boolean =>
    n.kind === 'gateway' && (outDegree.get(n) ?? 0) > 1 && (inDegree.get(n) ?? 0) <= 1;
  const isJoin = (n: LayoutNode): boolean =>
    n.kind === 'gateway' && (inDegree.get(n) ?? 0) > 1 && (outDegree.get(n) ?? 0) <= 1;
  const routes = new Map<string, Point[]>();
  for (const { edge, items: its } of chains) {
    const pts: Point[] = [];
    const nextCy = (it: Item): number => (isDummy(it) ? at(center, it).y : at(pos, it.id).cy);
    const s = at(pos, edge.from.id);
    const first = its[1];
    const ny = first === undefined ? s.cy : nextCy(first);
    if (
      isSplit(edge.from) &&
      ny !== s.cy &&
      columnClear(at(layer, edge.from), s.cy, ny, edge.from)
    ) {
      pts.push({ x: s.cx, y: ny > s.cy ? s.bottom : s.y }, { x: s.cx, y: ny });
    } else {
      pts.push({ x: s.right, y: s.cy });
    }
    for (let k = 1; k < its.length; k++) {
      const it = its[k];
      const cur = pts.at(-1);
      if (it === undefined || cur === undefined) continue;
      const l = layerOf(it);
      if (!isDummy(it)) {
        const t = at(pos, it.id);
        if (isJoin(it) && cur.y !== t.cy && columnClear(l, cur.y, t.cy, it)) {
          pts.push({ x: t.cx, y: cur.y }, { x: t.cx, y: cur.y > t.cy ? t.bottom : t.y });
        } else {
          if (cur.y !== t.cy) pts.push({ x: gapBefore(l), y: cur.y }, { x: gapBefore(l), y: t.cy });
          pts.push({ x: t.x, y: t.cy });
        }
      } else {
        const d = at(center, it);
        if (cur.y !== d.y) pts.push({ x: gapBefore(l), y: cur.y }, { x: gapBefore(l), y: d.y });
      }
    }
    routes.set(edge.flow.id, simplify(pts));
  }
  // back edges: along their row's track
  const rowSpan = new Map<number, { top: number; bottom: number }>();
  for (const lane of laneIds) {
    const base = rowBase[at(laneIndex, lane)] ?? 0;
    const tops = at(rowTop, lane);
    at(rowsOf, lane).forEach((entry, r) => {
      const top = tops[r] ?? 0;
      rowSpan.set(base + r, { top, bottom: top + entry.h });
    });
  }
  const loopY = new Map<string, number>();
  for (const { edge, side, row: r, track } of loops) {
    const src = at(pos, edge.from.id);
    const t = at(pos, edge.to.id);
    const span = at(rowSpan, r);
    const ly =
      side === 'below'
        ? span.bottom + L.ROW_GAP / 2 + L.TRACK * track
        : span.top - L.ROW_GAP / 2 - L.TRACK * track;
    loopY.set(edge.flow.id, ly);
    const [sy, ty] = side === 'below' ? [src.bottom, t.bottom] : [src.y, t.y];
    routes.set(
      edge.flow.id,
      simplify([
        { x: src.cx, y: sy },
        { x: src.cx, y: ly },
        { x: t.cx, y: ly },
        { x: t.cx, y: ty },
      ]),
    );
  }
  // a flow from a node to itself: out of its right side, around the side its label leaves free
  for (const flow of proc.flows.filter((f) => f.from === f.to)) {
    const n = at(byId, flow.from);
    const b = at(pos, n.id);
    const side = n.kind === 'event' ? b.y - L.LOOP : b.bottom + L.LOOP;
    routes.set(
      flow.id,
      simplify([
        { x: b.right, y: b.cy },
        { x: b.right + L.LOOP, y: b.cy },
        { x: b.right + L.LOOP, y: side },
        { x: b.cx, y: side },
        { x: b.cx, y: n.kind === 'event' ? b.y : b.bottom },
      ]),
    );
  }

  // 9. flow labels in their gap, next to the flow's line there: centred above the last line that
  // crosses the gap, or below it when the flow comes down to it in the gap (so the labels of
  // flows that leave one node for different rows stand at different rows); a loop's above its
  // track below the rows, below its track above them; a self-loop's right of its leg, below the
  // node's middle (an outgoing flow's label stands above it)
  const labels = new Map<string, Bounds>();
  const backOf = new Map(loops.map((lp) => [lp.edge.flow.id, lp]));
  for (const f of proc.flows) {
    if (f.label === null) continue;
    const l = at(labelLayer, f.id);
    const start = (colX[l] ?? 0) + (colW[l] ?? 0);
    const end = start + (gapW[l] ?? 0);
    const t = textBox(f.label);
    let x = start + (end - start - t.width) / 2;
    let y0: number;
    let above: boolean;
    const loop = backOf.get(f.id);
    if (f.from === f.to) {
      x = start + L.LOOP + L.FLOW_LABEL_GAP;
      y0 = at(pos, f.from).cy;
      above = false;
    } else if (loop !== undefined) {
      y0 = at(loopY, f.id);
      above = loop.side === 'below';
    } else {
      const pts = at(routes, f.id);
      let crossing = -1;
      pts.forEach((p, i) => {
        const q = pts[i + 1];
        if (q === undefined || p.y !== q.y) return;
        if (Math.min(p.x, q.x) < end && Math.max(p.x, q.x) > start) crossing = i;
      });
      y0 = pts[crossing]?.y ?? at(pos, f.from).cy;
      const line = y0;
      above = !pts.some((p) => p.x > start && p.x < end && p.y < line);
    }
    labels.set(f.id, {
      x: Math.round(x),
      y: Math.round(above ? y0 - L.FLOW_LABEL_GAP - t.height : y0 + L.FLOW_LABEL_GAP),
      width: t.width,
      height: t.height,
    });
  }

  return { width, height, bands, pos, routes, labels };
}

// ------------------------------------------------------------------- emit

/**
 * Lays out a whole model: absolute DI bounds and waypoints by element id.
 *
 * @throws {LayoutLimitError} when a process's long flows need more than {@link MAX_SLOTS} slots
 */
export function layoutSpec(input: LayoutInput): LayoutResult {
  const shapes = new Map<string, ShapeDi>();
  const edges = new Map<string, EdgeDi>();
  const boxes = new Map<string, Box>();
  const addShape = (id: string, b: Box, extra: Omit<ShapeDi, 'bounds'> = {}): void => {
    shapes.set(id, { bounds: b.bounds(), ...extra });
    boxes.set(id, b);
  };

  const grids = input.processes.map((proc) => ({ proc, grid: computeGrid(proc) }));
  /** The pool (participant id) of every flow node and data store. */
  const poolOf = new Map<string, string>();
  const emit = (proc: LayoutProcess, grid: Grid, ox: number, oy: number): void => {
    for (const s of proc.stores) poolOf.set(s.id, proc.participant);
    for (const n of proc.nodes) {
      poolOf.set(n.id, proc.participant);
      const b = at(grid.pos, n.id).moved(ox, oy);
      const label =
        n.label === null || n.kind === 'activity'
          ? undefined
          : n.kind === 'gateway'
            ? labelAbove(b, n.label)
            : labelBelow(b, n.label);
      addShape(n.id, b, label === undefined ? {} : { label });
    }
    for (const s of proc.stores) {
      const b = at(grid.pos, s.id).moved(ox, oy);
      addShape(s.id, b, s.label === null ? {} : { label: labelBelow(b, s.label) });
    }
    for (const f of proc.flows) {
      const waypoints = at(grid.routes, f.id).map((p) => ({ x: p.x + ox, y: p.y + oy }));
      const label = grid.labels.get(f.id);
      edges.set(
        f.id,
        label === undefined
          ? { waypoints }
          : { waypoints, label: { ...label, x: label.x + ox, y: label.y + oy } },
      );
    }
  };

  // Pools top to bottom: the processes, then the black boxes. The strip below a pool is as high
  // as the tallest label of a message flow that bends in it needs.
  const order = [...input.processes.map((p) => p.participant), ...input.blackBoxes];
  const indexOf = new Map(order.map((id, i) => [id, i]));
  const stripOf = (mf: LayoutMessageFlow): number => {
    const from = at(indexOf, mf.fromPool);
    return from < at(indexOf, mf.toPool) ? from : from - 1;
  };
  const stripH = order.map((): number => L.POOL_GAP);
  if (input.collaboration) {
    for (const mf of input.messageFlows) {
      if (mf.label === null) continue;
      const need = 2 * (textBox(mf.label).height + L.FLOW_LABEL_GAP + L.LABEL_MARGIN);
      stripH[stripOf(mf)] = Math.max(stripH[stripOf(mf)] ?? 0, even(need));
    }
  }

  const pools = new Map<string, { index: number; box: Box }>();
  if (!input.collaboration) {
    const only = grids[0];
    if (only !== undefined) emit(only.proc, only.grid, L.ORIGIN_X, L.ORIGIN_Y);
  } else {
    const contentW = Math.max(
      0,
      ...grids.map(({ proc, grid }) => grid.width + (proc.lanes.length > 0 ? L.LANE_HEADER : 0)),
    );
    const poolW = even(Math.max(L.MIN_POOL_W, L.POOL_HEADER + contentW));
    let y = L.ORIGIN_Y;
    let index = 0;
    for (const { proc, grid } of grids) {
      const x = L.ORIGIN_X;
      const laneX = x + L.POOL_HEADER;
      let gx = laneX;
      if (proc.lanes.length > 0) {
        gx += L.LANE_HEADER;
        for (const band of grid.bands) {
          if (band.lane === null) continue;
          const lb = new Box(laneX, y + band.y, poolW - L.POOL_HEADER, band.height);
          addShape(band.lane, lb, { horizontal: true });
        }
      }
      emit(proc, grid, gx, y);
      const pb = new Box(x, y, poolW, grid.height);
      pools.set(proc.participant, { index, box: pb });
      addShape(proc.participant, pb, { horizontal: true });
      y += grid.height + (stripH[index] ?? L.POOL_GAP);
      index++;
    }
    for (const id of input.blackBoxes) {
      const pb = new Box(L.ORIGIN_X, y, poolW, L.BLACKBOX_H);
      pools.set(id, { index, box: pb });
      addShape(id, pb, { horizontal: true });
      y += L.BLACKBOX_H + (stripH[index] ?? L.POOL_GAP);
      index++;
    }
  }

  // message flows: vertical, bending in the strip next to the source pool, where their labels
  // sit; one that would cross a shape of a pool between its ends runs down the free corridor
  // left of every pool's shapes
  const poolBoxes: Box[][] = order.map(() => []);
  for (const [id, pool] of poolOf) poolBoxes[at(indexOf, pool)]?.push(at(boxes, id));
  const gapUse = new Map<string, number>();
  const plans = input.messageFlows.map((mf) => {
    const sp = at(pools, mf.fromPool);
    const tp = at(pools, mf.toPool);
    const down = sp.index < tp.index;
    const gapKey = `${sp.index}${down ? '+' : '-'}`;
    gapUse.set(gapKey, (gapUse.get(gapKey) ?? 0) + 1);
    return { mf, sp, tp, down, gapKey, slot: at(gapUse, gapKey) - 1 };
  });
  let detours = 0;
  for (const { mf, sp, tp, down, gapKey, slot } of plans) {
    const fromNode = mf.from !== mf.fromPool;
    const toNode = mf.to !== mf.toPool;
    const sBox = fromNode ? at(boxes, mf.from) : sp.box;
    const tBox = toNode ? at(boxes, mf.to) : tp.box;
    const clampTo = (v: number, pool: Box): number =>
      Math.min(Math.max(v, pool.x + L.POOL_HEADER + 20), pool.right - 20);
    let sx: number;
    let tx: number;
    if (fromNode && toNode) {
      sx = sBox.cx;
      tx = tBox.cx;
    } else if (fromNode) {
      sx = sBox.cx;
      tx = clampTo(sx, tp.box);
    } else if (toNode) {
      tx = tBox.cx;
      sx = clampTo(tx, sp.box);
    } else {
      sx = tx = Math.round(sp.box.x + sp.box.w / 2);
    }
    const sy = down ? sBox.bottom : sBox.y;
    const ty = down ? tBox.y : tBox.bottom;
    const n = at(gapUse, gapKey);
    const strip = stripH[down ? sp.index : sp.index - 1] ?? L.POOL_GAP;
    const stripTop = down ? sp.box.bottom : sp.box.y - strip;
    const spread = Math.min(10, (strip - 12) / Math.max(1, n - 1));
    const gy = stripTop + strip / 2 + (slot - (n - 1) / 2) * spread;
    const lo = Math.min(sp.index, tp.index);
    const between = poolBoxes.slice(lo + 1, Math.max(sp.index, tp.index)).flat();
    let pts: Point[];
    let bendTo = tx;
    if (between.some((b) => tx >= b.x - 4 && tx <= b.right + 4)) {
      // between the lane headers and the first column: free in every pool
      const corridor = L.ORIGIN_X + L.POOL_HEADER + L.LANE_HEADER + 4 + 4 * (detours % 4);
      // close to the target pool, away from the flows that bend in the middle of that gap
      const gy2 = down ? tp.box.y - 8 - 4 * (detours % 4) : tp.box.bottom + 8 + 4 * (detours % 4);
      detours++;
      if (!fromNode) sx = corridor;
      if (!toNode) tx = corridor;
      bendTo = corridor;
      pts = [
        { x: sx, y: sy },
        { x: sx, y: gy },
        { x: corridor, y: gy },
        { x: corridor, y: gy2 },
        { x: tx, y: gy2 },
        { x: tx, y: ty },
      ];
    } else if (sx === tx) {
      pts = [
        { x: sx, y: sy },
        { x: tx, y: ty },
      ];
    } else {
      pts = [
        { x: sx, y: sy },
        { x: sx, y: gy },
        { x: tx, y: gy },
        { x: tx, y: ty },
      ];
    }
    const edge: EdgeDi = { waypoints: simplify(pts) };
    if (mf.label !== null) {
      // in the strip, above the flow's bend there, never out of the strip
      const t = textBox(mf.label);
      const want = gy - L.FLOW_LABEL_GAP - t.height;
      edge.label = {
        x: Math.round((sx + bendTo) / 2 + 5),
        y: Math.round(
          Math.min(
            Math.max(want, stripTop + L.LABEL_MARGIN),
            stripTop + strip - L.LABEL_MARGIN - t.height,
          ),
        ),
        width: t.width,
        height: t.height,
      };
    }
    edges.set(mf.id, edge);
  }

  // data associations: orthogonal, from the activity's bottom or top into the data store
  for (const { proc } of grids) {
    for (const a of proc.associations) {
      const d = at(boxes, a.store);
      const n = at(boxes, a.node);
      const ax = Math.round(n.x + n.w * (a.read ? 0.45 : 0.55));
      const below = d.y >= n.bottom;
      const above = d.bottom <= n.y;
      let pts: Point[];
      if (below || above) {
        const ay = below ? n.bottom : n.y;
        pts =
          ax >= d.x && ax <= d.right
            ? [
                { x: ax, y: ay },
                { x: ax, y: below ? d.y : d.bottom },
              ]
            : [
                { x: ax, y: ay },
                { x: ax, y: d.cy },
                { x: ax < d.x ? d.x : d.right, y: d.cy },
              ];
      } else {
        // beside each other (a data store in an unlaned band next to its user cannot be)
        pts = [
          { x: d.x >= n.right ? n.right : n.x, y: n.cy },
          { x: d.x >= n.right ? d.x : d.right, y: n.cy },
        ];
      }
      const ordered = simplify(a.read ? [...pts].reverse() : pts);
      edges.set(a.id, { waypoints: ordered });
    }
  }

  return { shapes, edges };
}

// converters/visio-bpmn.js: a synthetic example converter (test fixture of M6 S3c, see README.md).
// Every VSDX page drawn with the BPMN stencil becomes one analyzr-spec/1 model; pages joined by an
// off-page reference pair become one model. Shapes of the stencil become tasks, events, gateways,
// collapsed subprocesses and calls; connectors glued at both ends become flows. Text annotations,
// unglued connectors and the off-page references themselves are dropped (element-dropped). A
// joined model is named after the page its chain starts on (the page no off-page reference leads
// into), so reordering the pages in Visio keeps its tool path.
// Written for the fixture's invented shape data, never checked against a real Visio export.
'use strict';

const NODE_MASTERS = {
  Task: 'task',
  'Collapsed Sub-Process': 'subprocess',
  'Start Event': 'start',
  'Intermediate Event': 'event',
  'End Event': 'end',
  Gateway: 'gateway',
};
const TASK_KINDS = {
  None: 'none',
  User: 'user',
  Manual: 'manual',
  Service: 'service',
  Send: 'send',
  Receive: 'receive',
};
const GATEWAY_KINDS = {
  Exclusive: 'exclusive',
  Parallel: 'parallel',
  Inclusive: 'inclusive',
  'Event-based': 'event-based',
};
const TRIGGERS = {
  None: 'none',
  Message: 'message',
  Signal: 'signal',
  Timer: 'timer',
  Terminate: 'terminate',
};
const CONNECTORS = ['Sequence Flow', 'Message Flow', 'Association'];

const kids = (el, local) => (el === null ? [] : el.children.filter((c) => c.local === local));
const kid = (el, local) => kids(el, local)[0] || null;
// an element's text with its children's, in document order (shape text may hold <fld>, <cp>, …)
const allText = (el) => el.content.map((c) => (typeof c === 'number' ? allText(el.children[c]) : c)).join('');
const label = (shape) => {
  const text = kid(shape, 'Text');
  return text === null ? '' : allText(text).replace(/\s+/g, ' ').trim();
};
const cell = (shape, name) => kids(shape, 'Cell').find((c) => c.attrs.N === name) || null;
const rows = (shape, section) => kids(kids(shape, 'Section').find((s) => s.attrs.N === section) || null, 'Row');
const prop = (shape, name) => {
  const row = rows(shape, 'Property').find((r) => r.attrs.N === name);
  const value = row ? kids(row, 'Cell').find((c) => c.attrs.N === 'Value') : undefined;
  return value ? value.attrs.V : null;
};
const offPageTarget = (shape) => {
  const row = rows(shape, 'Hyperlink')[0];
  const sub = row ? kids(row, 'Cell').find((c) => c.attrs.N === 'SubAddress') : undefined;
  return sub ? sub.attrs.V : null;
};
const containerOf = (shape) => {
  const c = cell(shape, 'Relationships');
  const m = c === null ? null : /DEPENDSON\(4,Sheet\.(\d+)!SheetRef\(\)\)/.exec(c.attrs.F || '');
  return m === null ? null : m[1];
};
const pinY = (shape) => {
  const c = cell(shape, 'PinY');
  return c === null ? 0 : Number(c.attrs.V);
};

function readDocument(file, helpers) {
  const part = (entry) => helpers.xml(helpers.text(file.path, entry)).root;
  const masters = new Map(kids(part('visio/masters/masters.xml'), 'Master').map((m) => [m.attrs.ID, m.attrs.NameU]));
  const rels = new Map(
    kids(part('visio/pages/_rels/pages.xml.rels'), 'Relationship').map((r) => [r.attrs.Id, r.attrs.Target]),
  );
  const app = kid(kid(part('visio/document.xml'), 'DocumentProperties'), 'AppVersion');
  const pages = kids(part('visio/pages/pages.xml'), 'Page').map((p, index) => {
    const root = part(`visio/pages/${rels.get(kid(p, 'Rel').attrs['r:id'])}`);
    const shapes = kids(kid(root, 'Shapes'), 'Shape').map((s) => ({
      id: s.attrs.ID,
      master: masters.get(s.attrs.Master) || null,
      label: label(s),
      el: s,
    }));
    const ends = new Map();
    for (const c of kids(kid(root, 'Connects'), 'Connect')) {
      const e = ends.get(c.attrs.FromSheet) || {};
      if (c.attrs.FromCell === 'BeginX') e.begin = c.attrs.ToSheet;
      if (c.attrs.FromCell === 'EndX') e.end = c.attrs.ToSheet;
      ends.set(c.attrs.FromSheet, e);
    }
    // an off-page reference names its target page as written (NameU or Name); the model path has no "/"
    const written = [p.attrs.NameU, p.attrs.Name].filter((n) => typeof n === 'string' && n !== '');
    const names = written.length > 0 ? written : [`Seite ${p.attrs.ID}`];
    return { index, id: p.attrs.ID, names, name: names[0].replace(/\//g, '-'), shapes, ends };
  });
  return { pages, version: app === null ? null : `Visio ${app.text.trim()}` };
}

/** Pages joined by an off-page reference pair (each points at the other) form one group. */
function pageGroups(pages) {
  const byName = new Map();
  for (const p of pages) for (const n of p.names) if (!byName.has(n)) byName.set(n, p);
  const targets = (p) => p.shapes.filter((s) => s.master === 'Off-page reference').map((s) => offPageTarget(s.el));
  const lead = pages.map((p) => p.index);
  const find = (i) => (lead[i] === i ? i : find(lead[i]));
  for (const p of pages) {
    for (const target of targets(p)) {
      const other = byName.get(target);
      if (other !== undefined && other !== p && targets(other).some((t) => p.names.includes(t))) {
        const [a, b] = [find(p.index), find(other.index)].sort((x, y) => x - y);
        lead[b] = a;
      }
    }
  }
  const groups = new Map();
  for (const p of pages) {
    const g = groups.get(find(p.index)) || [];
    g.push(p);
    groups.set(find(p.index), g);
  }
  return [...groups.values()];
}

/** Whether a sequence flow on `page` leaves one of its off-page references: the page continues another. */
function continues(page) {
  const refs = new Set(page.shapes.filter((s) => s.master === 'Off-page reference').map((s) => s.id));
  return page.shapes.some((s) => s.master === 'Sequence Flow' && refs.has((page.ends.get(s.id) || {}).begin));
}

function buildModel(file, group, helpers) {
  // the page the chain starts on names the model (and its tool path)
  const first = group.find((p) => !continues(p)) || group[0];
  const sid = (page, shapeId) => helpers.sourceId(`p${page.id}`, `s${shapeId}`);
  const key = (page, shapeId) => `${page.id}/${shapeId}`;
  let dropped = 0;

  // pools (by name across the pages) and their lanes, top to bottom
  const pools = [];
  const poolOf = new Map();
  const laneOf = new Map();
  for (const page of group) {
    const poolShapes = page.shapes.filter((s) => s.master === 'Pool / Lane');
    poolShapes.sort((a, b) => pinY(b.el) - pinY(a.el) || Number(a.id) - Number(b.id));
    for (const s of poolShapes) {
      let pool = pools.find((p) => p.name === s.label);
      if (pool === undefined) {
        pool = { source: sid(page, s.id), name: s.label, lanes: [], dataStores: [], nodes: [], flows: [] };
        pools.push(pool);
      }
      poolOf.set(key(page, s.id), pool);
    }
    const lanes = page.shapes.filter((s) => s.master === 'Swimlane');
    lanes.sort((a, b) => pinY(b.el) - pinY(a.el) || Number(a.id) - Number(b.id));
    for (const s of lanes) {
      const pool = poolOf.get(key(page, containerOf(s.el)));
      if (pool === undefined) {
        dropped++;
        continue;
      }
      let lane = pool.lanes.find((l) => l.name === s.label);
      if (lane === undefined) {
        lane = { source: sid(page, s.id), name: s.label };
        pool.lanes.push(lane);
      }
      laneOf.set(key(page, s.id), { pool, lane: lane.source });
    }
  }
  let loose = null; // the process of shapes outside any pool
  const processOf = (page, shape) => {
    const where = key(page, containerOf(shape.el));
    const lane = laneOf.get(where);
    if (lane !== undefined) return { process: lane.pool, lane: lane.lane };
    const pool = poolOf.get(where);
    if (pool !== undefined) return { process: pool, lane: null };
    if (loose === null) {
      loose = { source: helpers.sourceId(`p${first.id}`), name: null, lanes: [], dataStores: [], nodes: [], flows: [] };
    }
    return { process: loose, lane: null };
  };

  // nodes, data stores and off-page references
  const nodes = new Map();
  const stores = new Map();
  const offPage = new Map();
  for (const page of group) {
    for (const s of page.shapes) {
      if (s.master === 'Off-page reference') {
        offPage.set(key(page, s.id), { page, target: offPageTarget(s.el), into: [], out: [] });
        continue;
      }
      if (s.master === 'Data Store') {
        stores.set(key(page, s.id), { source: sid(page, s.id), name: s.label, process: null });
        continue;
      }
      const type = NODE_MASTERS[s.master];
      if (type === undefined) {
        if (!CONNECTORS.includes(s.master) && s.master !== 'Pool / Lane' && s.master !== 'Swimlane') dropped++;
        continue;
      }
      const { process, lane } = processOf(page, s);
      const node = { source: sid(page, s.id), type };
      const call = type === 'subprocess' && prop(s.el, 'BpmnActivityType') === 'Call Activity';
      if (call) {
        node.type = 'call';
        node.target = s.label;
      } else if (s.label !== '') {
        node.name = s.label;
      }
      const trigger = TRIGGERS[prop(s.el, 'BpmnTriggerOrResult') || 'None'] || 'none';
      if (type === 'start' || type === 'end') node.trigger = trigger;
      if (type === 'event') {
        // an intermediate event without a trigger can only be a throwing one in BPMN
        node.direction = prop(s.el, 'BpmnEventType') === 'Intermediate (Throwing)' || trigger === 'none' ? 'throw' : 'catch';
        node.trigger = trigger;
      }
      if (type === 'task') node.kind = TASK_KINDS[prop(s.el, 'BpmnTaskType') || 'None'] || 'none';
      if (type === 'gateway') node.kind = GATEWAY_KINDS[prop(s.el, 'BpmnGatewayType') || 'Exclusive'] || 'exclusive';
      const message = prop(s.el, 'BpmnMessageName');
      if (message !== null && (trigger === 'message' || node.kind === 'send' || node.kind === 'receive')) {
        node.message = message;
      }
      if (lane !== null) node.lane = lane;
      process.nodes.push(node);
      nodes.set(key(page, s.id), { node, process });
    }
  }

  // connectors glued at both ends
  const messageFlows = [];
  const endOf = (page, id) => {
    const k = key(page, id);
    if (nodes.has(k)) return { node: nodes.get(k) };
    if (poolOf.has(k)) return { pool: poolOf.get(k) };
    if (stores.has(k)) return { store: stores.get(k) };
    if (offPage.has(k)) return { offPage: offPage.get(k) };
    return null;
  };
  for (const page of group) {
    for (const s of page.shapes) {
      if (!CONNECTORS.includes(s.master)) continue;
      const glued = page.ends.get(s.id) || {};
      const from = glued.begin === undefined ? null : endOf(page, glued.begin);
      const to = glued.end === undefined ? null : endOf(page, glued.end);
      if (from === null || to === null) {
        dropped++;
        continue;
      }
      const flow = { source: sid(page, s.id) };
      if (s.label !== '') flow.name = s.label;
      if (s.master === 'Sequence Flow' && from.offPage !== undefined && to.node !== undefined) {
        from.offPage.out.push({ ...flow, to: to.node.node.source });
      } else if (s.master === 'Sequence Flow' && from.node !== undefined && to.offPage !== undefined) {
        to.offPage.into.push({ ...flow, from: from.node.node.source, process: from.node.process });
      } else if (s.master === 'Sequence Flow' && from.node !== undefined && to.node !== undefined) {
        from.node.process.flows.push({ from: from.node.node.source, to: to.node.node.source, ...flow });
      } else if (s.master === 'Message Flow' && from.offPage === undefined && to.offPage === undefined) {
        const end = (e) => (e.node !== undefined ? e.node.node.source : e.pool !== undefined ? e.pool.source : null);
        if (end(from) === null || end(to) === null) dropped++;
        else messageFlows.push({ from: end(from), to: end(to), ...flow });
      } else if (s.master === 'Association' && from.store !== undefined && to.node !== undefined) {
        (to.node.node.reads = to.node.node.reads || []).push(from.store.source);
        from.store.process = from.store.process || to.node.process;
      } else if (s.master === 'Association' && from.node !== undefined && to.store !== undefined) {
        (from.node.node.writes = from.node.node.writes || []).push(to.store.source);
        to.store.process = to.store.process || from.node.process;
      } else {
        dropped++;
      }
    }
  }
  // an off-page pair joins the flows into one reference with the flows out of its partner
  for (const ref of offPage.values()) {
    const partner = [...offPage.values()].find(
      (o) => o !== ref && o.page.names.includes(ref.target) && ref.page.names.includes(o.target),
    );
    dropped++;
    if (partner === undefined) {
      dropped += ref.into.length + ref.out.length;
      continue;
    }
    for (const into of ref.into) {
      for (const out of partner.out) {
        // one flow keeps its connector's id; a reference that fans out joins both connectors' ids
        const source = partner.out.length === 1 ? into.source : helpers.sourceId(into.source, out.source);
        into.process.flows.push({ from: into.from, to: out.to, source, ...(into.name ? { name: into.name } : {}) });
      }
    }
  }
  for (const store of stores.values()) {
    if (store.process === null) dropped++;
    else store.process.dataStores.push({ source: store.source, name: store.name });
  }

  const withNodes = [...pools, ...(loose === null ? [] : [loose])].filter((p) => p.nodes.length > 0);
  if (withNodes.length === 0) return null;
  const processes = withNodes.map((p) => ({
    source: p.source,
    name: withNodes.length === 1 || p.name === null ? first.name : p.name,
    ...(p.name === null ? {} : { pool: p.name }),
    lanes: p.lanes,
    dataStores: p.dataStores,
    nodes: p.nodes,
    flows: p.flows,
  }));
  return {
    source: {
      externalId: null,
      externalPath: `${file.path.replace(/\.vsdx$/i, '')}/${first.name}`,
      file: file.path,
    },
    participants: pools.filter((p) => p.nodes.length === 0 && p.lanes.length === 0).map((p) => ({ source: p.source, name: p.name })),
    processes,
    messageFlows,
    losses: dropped === 0 ? [] : [{ code: 'element-dropped', count: dropped }],
  };
}

function convert(input, helpers) {
  const models = [];
  const skipped = [];
  const versions = new Set();
  for (const file of input.files) {
    if (!/\.vsdx$/i.test(file.path) || file.zip === null) {
      skipped.push({ path: file.path, reason: 'not a VSDX file' });
      continue;
    }
    if (file.zip.error !== null) {
      skipped.push({ path: file.path, reason: `not opened: ${file.zip.error}` });
      continue;
    }
    const doc = readDocument(file, helpers);
    if (doc.version !== null) versions.add(doc.version);
    for (const group of pageGroups(doc.pages)) {
      const model = buildModel(file, group, helpers);
      if (model === null) {
        skipped.push({ path: file.path, reason: `page "${group[0].names[0]}" has no process shapes` });
      } else {
        models.push(model);
      }
    }
  }
  return { systemVersion: versions.size === 1 ? [...versions][0] : null, models, skipped };
}

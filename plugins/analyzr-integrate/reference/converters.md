# Ad-hoc converters

Status: format note for `analyzr-convert.mjs` (runner 0.1.0): the runner, its sandbox and the
skeleton below are tested on analyzr's side (the skeleton runs on a synthetic Visio export in
`tools/integrate/test/plugin.test.ts`); what a tool writes into its exports is unverified (see
the tool's note: `visio.md`, `aris.md`, `adonis.md`).

A converter turns a machine-readable export that is no BPMN 2.0 (VSDX, ARIS AML, ADOxx XML, …)
into `analyzr-spec/1` models (`analyzr-spec.md`), which `analyzr-spec.mjs` then renders as BPMN.
You write it for the export at hand; the consultant approves each version by its sha256 before it
runs (confirmation 4), and `analyzr-convert.mjs` runs exactly those bytes in a sandbox. It never
writes BPMN, never touches a file itself and never declares how its output was derived.

## Converted or reconstructed

Chosen per mapping in confirmation 1, passed as `convert --derived`:

- `converted`: the source's shapes are BPMN or carry their process meaning one to one (the Visio
  BPMN stencil, ARIS BPMN diagrams in AML, ADOxx BPMN models). analyzr shows „Konvertiert“.
- `reconstructed` (with `--llm-model <the model you run as>`): the mapping interprets
  (EPC functions, events and connectors read as BPMN, plain flowcharts' process, decision and
  terminator shapes). analyzr shows „KI-rekonstruiert“.

Both are derived: analyzr never treats them as modelled, and records no call from them.

## The contract

A converter is a classic script, `<workspace>/converters/<system>-<purpose>.js` (for example
`visio-bpmn.js`, `aris-epk.js`), that defines one synchronous function:

```text
function convert(input, helpers) → { models, skipped?, systemVersion? }

input.files      every regular, non-hidden file below the export, sorted by path:
                 { path, size, sha256, zip, unread }
  path           below the export, "/"-separated
  zip            null, or { entries: [{ name, size }], error } for a zip (VSDX is one), entries
                 sorted by name; error is a guard's reason when the archive was not opened
                 (entries then empty)
  unread         null, or why the file was not read (over 64 MB; sha256 is null then)
helpers.text(path, entry?)    the file or zip entry as text, decoded as inspect decodes it
                              (byte order mark, declared encoding, UTF-16)
helpers.bytes(path, entry?)   its bytes, a Uint8Array
helpers.xml(text)             { root }: elements { name, local, ns, attrs, children, text,
                              content }; content holds the text runs (strings) and child indexes
                              (numbers) in document order; a DOCTYPE is skipped, an entity other
                              than the predefined ones stays as written, never expanded
helpers.sourceId(...parts)    a stable source id from tool ids: the non-empty strings and numbers
                              joined by "-" ("p3-s17"); control characters become "_", over 200
                              characters are cut to 187 plus "-" and 12 hex

models           analyzr-spec/1 objects without format and derived, each with optional
                 losses: [{ code, count }] (at most 16 codes, for example element-dropped)
skipped          [{ path, reason }] for files, pages or models you did not convert (reason ≤ 500)
systemVersion    the tool version the export names ("Visio 16.0"), or null
```

Any other field of the result fails the run. A helper on an unread file throws.

**What the sandbox allows.** The file runs as the body of a function in a context of its own:
its top level runs once per run, within the same time limit as `convert`, and its declarations
are its own. There is no `require`, no `process`, no `fetch`, no timers, no `eval` or
`Function` from text, no `WebAssembly`, no `SharedArrayBuffer`. The word `import` must not occur
anywhere in the file, comments and strings included (the runner refuses it before anything
runs): write `'im' + 'port'` where a text needs it. `Date.now()`, `new Date()` without an
argument, `Math.random()` and `Intl` formatting without a date throw; `new Date("2026-10-14")`
parses in UTC. The converter runs twice, each time in a fresh context, and both runs must return
the same JSON and read the same files; 120 s per run, a 4 GB heap, at most 256 MB of output,
10,000 models and 10,000 skipped entries. Node cannot guarantee that the process reaches no
network (the converter's context only holds no way to it), which the consent question says.

An error ends the run with its first frame, for example
`converter adhoc:3f2a9c1b7d4e: run 1: TypeError: Cannot read properties of null (reading 'attrs') at convert (converter.js:12:9)`:
fix the converter (its new version needs a new yes) and run it into a new folder.

## Rules

- **Ids from the tool's ids**, never from list positions or counters: `helpers.sourceId(page ID,
  shape ID)` for Visio (shape ids are unique per page only), the occurrence id (`ObjOcc.ID`) for
  ARIS. Then a re-export keeps every id, and an unchanged model stays `unchanged`.
- **`externalId` identifies one model**: an ARIS model GUID; for a Visio page `null` unless the
  page itself carries a stable id; never the id of a file or document that holds several models.
  Two models with the same `externalId` or `externalPath` both fail.
- **`externalPath`** is the tool folder and the model's name, stable across exports
  (`Vertrieb/Prozesse/Auftragsabwicklung` for page „Auftragsabwicklung“ of
  `Vertrieb/Prozesse.vsdx`); `plan` derives the key from it.
- **One spec per model.** A process the tool splits over pages (off-page references) is one
  model; a model with several pools is one spec with several processes.
- **Nothing invented**: `message` and `signal` only when the source names the message or signal
  itself; `documentation` only from the tool's own description; no name from a guess.
- **Report what you drop**: every shape you leave out counts in `losses` as `element-dropped`;
  every file or page you skip goes into `skipped` with a reason.
- **Calls** only as `type: call` with `target` (the callee as the tool names it); analyzr draws
  them as collapsed subprocesses and the consultant links them.
- **No deep recursion over XML trees**: the stack's depth can differ between the two runs (then
  they differ), and a deep tree can exhaust it. Walk deep trees with a list as a stack; recursion
  over a few levels (pages, groups) is fine.
- **Deterministic**: sort what the tool does not order, keep what it orders (pages, lanes top to
  bottom). The determinism checks catch honest mistakes; they are no security property.
- Names as the tool writes them, whitespace collapsed; the renderer sanitizes and cuts.

## Running it

After the consultant's yes (confirmation 4), with the sha256 you showed:

```text
node <scripts>/analyzr-convert.mjs convert "<workspace>/exports/<YYYY-MM-DD>-<system>" \
  --converter "<workspace>/converters/<name>.js" --sha256 <the 64 hex you showed> \
  --derived converted --workspace "<workspace>" \
  --out "<workspace>/specs/<spec folder>" \
  --json-out "<workspace>/reports/<spec folder>.convert.json"
```

The spec folder is `<YYYY-MM-DD>-<system>` (`<YYYY-MM-DD>-<system>-converter` when the export also
has BPMN files of that system), with `-2`, `-3` … for a folder that exists: every run writes a new
one.

It keeps a write-once copy `converters/adhoc-<first 12 hex>.js` (the run is recorded as
`adhoc:<12 hex>`) and writes one spec per model plus the run record `analyzr-specs.json` into the
new or empty `--out`; a model that fails validation is listed in `failed` (exit 1), the others are
written. Its output names what the converter read (`reads`: files of how many, zip entries),
counted by the runner, not declared by the converter. Then `analyzr-spec.mjs validate`, `plan`
and `bundle` on that folder; `bundle` checks the record against the copy, so a spec changed after
the run is refused. Keep the converter: the next export of the same tool runs the same bytes, and
unchanged models stay unchanged.

## Skeleton: VSDX pages drawn with the BPMN stencil

A starting point, one model per page: tasks, events, gateways, collapsed subprocesses and calls
from the stencil's masters, flows from connectors glued at both ends (`Connects`, never the
geometry). It drops pools, lanes, data stores, message flows and off-page references
(`element-dropped`); extend it for those as `visio.md` describes. The shape data names
(`BpmnTaskType`, `BpmnTriggerOrResult`, `BpmnGatewayType`, `BpmnActivityType`,
`BpmnMessageName`) are assumptions to check against the export at hand.

```js
// converters/visio-bpmn.js: every VSDX page drawn with the BPMN stencil becomes one model.
'use strict';

const NODES = { Task: 'task', 'Collapsed Sub-Process': 'subprocess', 'Start Event': 'start',
  'Intermediate Event': 'event', 'End Event': 'end', Gateway: 'gateway' };
const TASKS = { None: 'none', User: 'user', Manual: 'manual', Service: 'service', Send: 'send', Receive: 'receive' };
const GATEWAYS = { Exclusive: 'exclusive', Parallel: 'parallel', Inclusive: 'inclusive', 'Event-based': 'event-based' };
const TRIGGERS = { None: 'none', Message: 'message', Signal: 'signal', Timer: 'timer', Terminate: 'terminate' };

const kids = (el, local) => (el === null ? [] : el.children.filter((c) => c.local === local));
const kid = (el, local) => kids(el, local)[0] || null;
// shape text in document order (it may hold <cp>, <fld>, …); two levels deep at most
const textOf = (el) => el.content.map((c) => (typeof c === 'number' ? textOf(el.children[c]) : c)).join('');
const label = (shape) => (kid(shape, 'Text') === null ? '' : textOf(kid(shape, 'Text')).replace(/\s+/g, ' ').trim());
const prop = (shape, name) => {
  const section = kids(shape, 'Section').find((s) => s.attrs.N === 'Property') || null;
  const row = kids(section, 'Row').find((r) => r.attrs.N === name);
  const value = row ? kids(row, 'Cell').find((c) => c.attrs.N === 'Value') : undefined;
  return value ? value.attrs.V : null;
};

function pageModel(file, page, masters, helpers) {
  const sid = (shapeId) => helpers.sourceId(`p${page.id}`, `s${shapeId}`);
  const nodes = new Map();
  let dropped = 0;
  const shapes = kids(kid(page.root, 'Shapes'), 'Shape');
  for (const s of shapes) {
    const master = masters.get(s.attrs.Master) || null;
    const type = NODES[master];
    if (type === undefined) {
      if (master !== 'Sequence Flow') dropped++;
      continue;
    }
    const node = { source: sid(s.attrs.ID), type };
    const text = label(s);
    if (type === 'subprocess' && prop(s, 'BpmnActivityType') === 'Call Activity') {
      node.type = 'call';
      node.target = text || 'Aufruf';
    } else if (text !== '') {
      node.name = text;
    }
    const trigger = TRIGGERS[prop(s, 'BpmnTriggerOrResult') || 'None'] || 'none';
    if (type === 'start' || type === 'end') node.trigger = trigger;
    if (type === 'event') {
      node.direction = trigger === 'none' ? 'throw' : 'catch';
      node.trigger = trigger;
    }
    if (type === 'task') node.kind = TASKS[prop(s, 'BpmnTaskType') || 'None'] || 'none';
    if (type === 'gateway') node.kind = GATEWAYS[prop(s, 'BpmnGatewayType') || 'Exclusive'] || 'exclusive';
    const message = prop(s, 'BpmnMessageName');
    if (message !== null && (trigger === 'message' || node.kind === 'send' || node.kind === 'receive')) {
      node.message = message;
    }
    nodes.set(s.attrs.ID, node);
  }
  // a connector's ends are the shapes it is glued to
  const ends = new Map();
  for (const c of kids(kid(page.root, 'Connects'), 'Connect')) {
    const e = ends.get(c.attrs.FromSheet) || {};
    if (c.attrs.FromCell === 'BeginX') e.begin = c.attrs.ToSheet;
    if (c.attrs.FromCell === 'EndX') e.end = c.attrs.ToSheet;
    ends.set(c.attrs.FromSheet, e);
  }
  const flows = [];
  for (const s of shapes.filter((x) => masters.get(x.attrs.Master) === 'Sequence Flow')) {
    const e = ends.get(s.attrs.ID) || {};
    const from = nodes.get(e.begin);
    const to = nodes.get(e.end);
    if (from === undefined || to === undefined) {
      dropped++;
      continue;
    }
    flows.push({ source: sid(s.attrs.ID), from: from.source, to: to.source, ...(label(s) ? { name: label(s) } : {}) });
  }
  if (nodes.size === 0) return null;
  return {
    source: { externalId: null, externalPath: `${file.path.replace(/\.vsdx$/i, '')}/${page.name}`, file: file.path },
    processes: [{ source: helpers.sourceId(`p${page.id}`), name: page.name, nodes: [...nodes.values()], flows }],
    losses: dropped === 0 ? [] : [{ code: 'element-dropped', count: dropped }],
  };
}

function convert(input, helpers) {
  const models = [];
  const skipped = [];
  for (const file of input.files) {
    if (!/\.vsdx$/i.test(file.path) || file.zip === null || file.zip.error !== null) {
      skipped.push({ path: file.path, reason: file.zip && file.zip.error ? `not opened: ${file.zip.error}` : 'not a VSDX file' });
      continue;
    }
    const part = (entry) => helpers.xml(helpers.text(file.path, entry)).root;
    const masters = new Map(kids(part('visio/masters/masters.xml'), 'Master').map((m) => [m.attrs.ID, m.attrs.NameU]));
    const rels = new Map(kids(part('visio/pages/_rels/pages.xml.rels'), 'Relationship').map((r) => [r.attrs.Id, r.attrs.Target]));
    for (const p of kids(part('visio/pages/pages.xml'), 'Page')) {
      const page = {
        id: p.attrs.ID,
        name: (p.attrs.NameU || p.attrs.Name || `Seite ${p.attrs.ID}`).replace(/\//g, '-'),
        root: part(`visio/pages/${rels.get(kid(p, 'Rel').attrs['r:id'])}`),
      };
      const model = pageModel(file, page, masters, helpers);
      if (model === null) skipped.push({ path: file.path, reason: `page "${page.name}" has no process shapes` });
      else models.push(model);
    }
  }
  return { systemVersion: null, models, skipped };
}
```

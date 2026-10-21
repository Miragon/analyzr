# Microsoft Visio

Status: unverified: based on public documentation. Nothing below was checked against a real or
sandbox export yet (M6 §3.8, owner question §10.4); what analyzr itself does is marked
"verified on analyzr's side".

## Export paths

- **`.vsdx`** (Visio 2013 and later): an Open Packaging Conventions zip of XML parts.
- **`.vsd`** (older): a binary OLE2 file; not readable without Visio.
- **PDF, PNG, SVG** exports of pages.
- Whether Visio can write BPMN 2.0 XML from its BPMN template is to verify.

## What arrives

- `.vsdx`: `[Content_Types].xml`, `visio/document.xml`, `visio/pages/pages.xml` and one
  `visio/pages/page<N>.xml` per page, masters in `visio/masters/`; shapes with their master
  (for example "Task", "Start Event" of the BPMN stencil), text, shape data (properties) and
  connectors glued to shapes (`Connects`).
- Plain flowcharts (process, decision, terminator shapes) carry no BPMN semantics.

## Pitfalls

- **Not BPMN:** analyzr refuses a `.vsdx` (`not-xml`/`not-bpmn`, verified on analyzr's side).
- **Layout:** the model view needs BPMN DI (`apps/web/src/components/bpmn-canvas.tsx` imports
  with bpmn-js, verified on analyzr's side); `analyzr-spec.mjs` lays every spec out (verified on
  analyzr's side), so a converter writes no coordinates.
- **Shape ids are unique per page only:** a source id is page ID and shape ID together
  (`helpers.sourceId("p" + page ID, "s" + shape ID)`).
- **Flows come from `Connects`**, never from geometry: a connector glued at both ends
  (`BeginX` and `EndX`) is a flow; one drawn near shapes without being glued is dropped
  (`element-dropped`).
- **Masters:** the BPMN stencil's shapes are recognized by their master's `NameU` ("Task",
  "Start Event", "Gateway", "Pool / Lane", "Swimlane", "Sequence Flow", "Message Flow",
  "Off-page reference", …); the shape data (`BpmnTaskType`, `BpmnTriggerOrResult`,
  `BpmnGatewayType`, `BpmnMessageName`, `BpmnActivityType`) and the container formula that places
  a shape in a lane (`DEPENDSON(4,Sheet.N!SheetRef())`) are to verify on a real export.
- **Tool ids:** a page carries no id that is known to be stable across exports (to verify), and
  the document's own id is the file's, not a model's: `externalId` stays `null` (one id shared by
  every page would give all of them one tool identity). `externalPath` is the file path without
  `.vsdx` plus the page name (`Vertrieb/Prozesse/Auftragsabwicklung`).
- **Off-page references:** a pair of references on two pages, each pointing at the other, joins
  them into one model (the references themselves `element-dropped`, the model named after the page
  the chain starts on, so reordering pages keeps its path); a reference to another process is a
  `call` with `target`. How Visio stores the target page (a hyperlink row's `SubAddress`) is to
  verify.
- **Legends and text boxes:** a page of annotations only is skipped; text annotations on a process
  page are dropped.
- **Text** holds line breaks and formatting (`<cp>`, `<fld>`: read the text runs in order); shape
  data and lanes may name people: use roles.
- **`.vsd`** (Visio 2003 and older) is OLE2 (`inspect` kind `ole2`): ask for a VSDX, a PDF or a
  BPMN export instead.

## Mapping to analyzr

- BPMN stencil: an ad-hoc converter (`converters.md`, a skeleton there) that writes
  `analyzr-spec/1`, run with `--derived converted`; ids from shape ids; analyzr shows
  „Konvertiert“ with `adhoc:<12 hex>`.
- Plain flowcharts (process, decision, terminator shapes): the same kind of converter, run with
  `--derived reconstructed` (it interprets), or pictures of the pages (`images.md`); analyzr shows
  „KI-rekonstruiert“.
- PDF or PNG exports of pages: `images.md`.

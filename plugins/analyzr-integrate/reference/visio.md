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
  with bpmn-js, verified on analyzr's side), so any conversion must produce layout.
- **Connectors** may be drawn near shapes without being glued; pages may continue a process
  through off-page references.
- **Text** holds line breaks and formatting; shape data may name people.

## Mapping to analyzr

- BPMN stencil: an ad-hoc converter that writes `analyzr-spec/1`, ids from shape ids (M6 S3c).
- Plain flowcharts: a reconstructed spec (`derived.kind` `reconstructed`, M6 S3c).
- In skill v0 the skill reports what it found (inspect lists the zip parts and recognizes
  VSDX) and stops.

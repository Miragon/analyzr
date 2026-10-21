# Synthetic converter fixtures (UNVERIFIED)

Everything here is **hand-written and synthetic**, for the tests of the converter runner
`analyzr-convert` (M6 S3c step 2, `tools/integrate/src/spec/converter.ts`): an invented company
(„Beispiel GmbH“), invented names, page and shape ids, ARIS GUIDs
(`0f6c2a9e-1b7d-4e5a-9c11-…`) and object ids. No Visio, no ARIS instance and no customer
produced any of it; nothing derives from `eval/corpus/**` or from the holdout landscape. What it
shows of the VSDX and AML formats comes from public documentation and general knowledge and is
**unverified** (`plugins/analyzr-integrate/reference/visio.md`, `aris.md`): in particular the
shape data names (`BpmnTaskType`, `BpmnTriggerOrResult`, `BpmnMessageName`,
`BpmnGatewayType`, `BpmnActivityType`), the container formula that places a shape in a lane
(`DEPENDSON(4,Sheet.N!SheetRef())`), the off-page reference's hyperlink row (whose `SubAddress`
the converter matches against a page's `NameU` and `Name`) and, for AML, styled attribute values
(`StyledElement` with `PlainText TextValue`, read in order) are assumptions. The tests also run
both converters on variants built from these files (`spec-converter.test.ts`, "beyond their
fixtures"): an intermediate event without shape data (a throwing none event), an off-page
reference that leads to two shapes, the pages in another order (the model keeps the name of the
page its chain starts on), a page named with a "/" and otherwise in `Name`, an EPC without
elements (skipped) and mixed text.

| File | What it is |
|---|---|
| `visio/prozesse/` | The parts of `Vertrieb/Prozesse.vsdx`, zipped by the tests (`test/zip-writer.ts`). Page „Auftragsabwicklung“: a pool „Vertrieb“ with the lanes „Innendienst“ and „Buchhaltung“, a black-box pool „Kunde“ with two message flows, a message start with a message name, a send task with one, an exclusive gateway, a call („Bonitätsprüfung“, a collapsed sub-process marked as call activity), a data store read by a task, a text annotation and a connector glued at one end only (both dropped), and an off-page reference to page „Auftragsabwicklung – Versand“, which continues the process in a lane „Versand“ and points back: the pair joins both pages into one model. Page „Legende“ holds only text annotations (skipped). |
| `visio/reklamation/` | The parts of `Service/Reklamation.vsdx`: one page without a pool (a process without lanes), a send task without a message name, a service task. |
| `visio-bpmn.js` | The example converter for both (`--derived converted`: the BPMN stencil is read one to one). |
| `aris/Export_Vertrieb.xml` | An AML export with a DOCTYPE and an internal entity (never expanded), German and English names, groups „Vertrieb“ and „Vertrieb/Finanzen“; the EPC „Auftragsabwicklung“ (an XOR split, a process interface „Bonitätsprüfung“, an organizational unit, and one event definition „Kunde informiert“ occurring twice), the EPC „Bonitätsprüfung“ (an AND split and join, one rule definition occurring twice) and a value-added chain diagram (skipped). |
| `aris-epk.js` | The example converter for it (`--derived reconstructed`: EPC elements read as BPMN are an interpretation). |

The converters are classic scripts as the runner wants them: one `convert(input, helpers)`, no
module syntax, deterministic. Their bytes matter (the tests approve them by their sha256), and
`tools/integrate/test/fixtures/` is left out of formatting and linting.

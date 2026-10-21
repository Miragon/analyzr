# ARIS (ARIS Architect, ARIS Cloud)

Status: unverified: based on public documentation. Nothing below was checked against a real or
sandbox export yet (M6 §3.8, owner question §10.4); what analyzr itself does is marked
"verified on analyzr's side".

## Export paths

- **AML export** of a database or a group: one XML file (ARIS Markup Language), often large.
- **BPMN 2.0 export** of BPMN collaboration or process diagrams (to verify: which ARIS
  editions offer it, whether it writes BPMN DI).
- **Reports and scripts** that write Excel or CSV lists (process catalogs).
- **Pictures and PDFs** of models.

## What arrives

- AML: `<?xml …?>`, most likely a `<!DOCTYPE AML SYSTEM "ARIS-Export.dtd">`, root element
  `AML` with groups, object definitions (`ObjDef`, with GUIDs), models (`Model`) with object
  occurrences (`ObjOcc`) and connections (`CxnDef`, `CxnOcc`), attributes per language
  (`LocaleId`).
- Model types such as EPC (eEPK), value-added chain diagrams (Wertschöpfungskettendiagramm),
  BPMN diagrams, organizational charts.
- BPMN export: BPMN 2.0 XML; tool markers (exporter, namespace) to verify.

## Pitfalls

- **DOCTYPE:** analyzr refuses any DOCTYPE (`doctype-forbidden`, verified on analyzr's side),
  and so does `normalize-bpmn`, so AML never enters directly. A converter's `helpers.xml` skips
  the DOCTYPE and never expands a declared entity (verified on analyzr's side): an entity
  reference stays as written.
- **Definitions versus occurrences:** one object definition appears in many models, and often
  twice in one EPC (an event that ends one branch and starts another). Take source ids from the
  occurrences (`ObjOcc.ID`), so both occurrences stay two nodes; whether occurrence ids are stable
  across exports is to verify (a definition with one occurrence may use its `ObjDef` GUID).
- **EPC semantics** (events, functions, connectors) differ from BPMN, so an EPC mapping runs with
  `--derived reconstructed`: a function is a task, an event a start (nothing leads to it), an end
  (nothing leaves it) or a plain intermediate throw event (`trigger: none`), an XOR, AND or OR
  rule an exclusive, parallel or inclusive gateway, a process interface a `call` with `target`;
  organizational units and their connections are dropped (`element-dropped`), or become lanes
  where the consultant wants roles drawn. The symbol and type names (`MT_EEPC`, `OT_FUNC`,
  `OT_EVT`, `OT_RULE`, `ST_OPR_XOR_1`, `ST_PRCS_IF`, …) and the styled attribute values
  (`StyledElement` with `PlainText TextValue`) are to verify on a real export.
- **Languages:** names and descriptions per `LocaleId`; pick one language per import (German is
  1031) and keep it for every later export.
- **Large databases:** a converter reads at most 64 MB per file (a larger one reaches it unread)
  and 512 MB per run; ask for an export by group (each file under 64 MB) instead of the whole
  database.
- **Value-added chains** are process maps, not processes: they belong in a `.vc.json` (later);
  a converter skips them.

## Mapping to analyzr

- BPMN 2.0 export → the BPMN path of this skill (`normalize-bpmn`).
- AML with EPCs → an ad-hoc converter (`converters.md`) that writes `analyzr-spec/1`, run with
  `--derived reconstructed`; analyzr shows „KI-rekonstruiert“ with `adhoc:<12 hex>`.
- AML with BPMN diagrams → the same, run with `--derived converted` („Konvertiert“).
- Keys and `externalId`: the model's GUID (`<GUID>` of the `Model` element) is its tool id
  (to verify); `externalPath` is the group path plus the model name
  (`Vertrieb/Finanzen/Bonitätsprüfung`).
- Value-added chain → `.vc.json`, flattened to depth ≤ 2 (M4 §2; later).
- PDF or picture exports of models: `images.md`.

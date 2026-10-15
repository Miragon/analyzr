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
  and so does `normalize-bpmn`, so AML never enters directly.
- **Definitions versus occurrences:** one object definition appears in many models; a
  converter must take ids from the definition or the occurrence consistently (M6 §3.4 rule 2).
- **EPC semantics** (events, functions, connectors) differ from BPMN; a mapping is a
  conversion with losses, or a reconstruction.
- **Languages:** names and descriptions per `LocaleId`; pick one language per import.
- **Value-added chains** are process maps, not processes: they belong in a `.vc.json` (later).

## Mapping to analyzr

- BPMN 2.0 export → the BPMN path of this skill (`normalize-bpmn`).
- AML and EPC → an ad-hoc converter that writes `analyzr-spec/1` (M6 S3c) or a reconstructed
  spec; in skill v0 the skill reports what it found and stops.
- Value-added chain → `.vc.json`, flattened to depth ≤ 2 (M4 §2; later).
- Keys and `externalId`: the model GUID is the natural tool id (to verify).

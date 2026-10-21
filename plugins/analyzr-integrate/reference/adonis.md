# BOC ADONIS

Status: unverified: based on public documentation. Nothing below was checked against a real or
sandbox export yet (M6 §3.8, owner question §10.4); what analyzr itself does is marked
"verified on analyzr's side".

## Export paths

- **ADOxx XML export** of models and model groups (the meta-modelling platform ADONIS runs on).
- **BPMN 2.0 export** of BPMN models (to verify: editions, DI, file per model).
- Process maps and reports (Excel, PDF).

## What arrives

- ADOxx XML: root element `ADOXML` (to verify), models (`MODEL`) with instances
  (`INSTANCE`), connectors (`CONNECTOR`), attributes (`ATTRIBUTE`) and inter-model
  references (`INTERREF`).
- BPMN export: BPMN 2.0 XML, possibly with a BOC namespace; tool markers to verify.

## Pitfalls

- **Model types:** ADONIS distinguishes its own business process diagrams from BPMN models;
  only BPMN models export as BPMN 2.0 (to verify).
- **Inter-model references** (`INTERREF`) are the links between processes; a BPMN export may
  drop them, so check the report's list of collapsed subprocesses.
- **Attribute profiles and languages** vary per installation.
- **People:** responsibility attributes often name persons or roles.

## Mapping to analyzr

- BPMN 2.0 export → the BPMN path of this skill (`normalize-bpmn`); verified on analyzr's
  side: any BPMN 2.0 parses, `engine` is `null` without Camunda markers.
- ADOxx XML → an ad-hoc converter (`converters.md`) that writes `analyzr-spec/1`: BPMN models
  with `--derived converted`, ADONIS's own business process diagrams with `--derived
  reconstructed` (it interprets); source ids from the `INSTANCE` ids, `INTERREF`s to other models
  as a `call` with `target` (to verify).

# Bizagi Modeler

Status: unverified: based on public documentation. Nothing below was checked against a real or
sandbox export yet (M6 §3.8, owner question §10.4); what analyzr itself does is marked
"verified on analyzr's side".

## Export paths

- **`.bpm`**: Bizagi Modeler's own file (a package; to verify whether it is a zip and what it
  holds).
- **BPMN 2.0 export** ("Export → BPMN 2.0", to verify) and XPDL export.
- Word, PDF and web (HTML) documentation exports.

## What arrives

- BPMN 2.0 XML, possibly with Bizagi extension elements and attributes (namespace to verify);
  one file may hold several diagrams or processes.
- XPDL 2.x XML (not BPMN 2.0 XML).

## Pitfalls

- **`.bpm` is not BPMN 2.0:** ask for the BPMN 2.0 export.
- **Several processes per file:** analyzr keys a file, not a process, so one file stays one
  model; its processes appear as processes of that model.
- **Subprocess references** between diagrams may become collapsed subprocesses without a call.
- **XPDL** is a different format; converting it is a later converter, not v0.

## Mapping to analyzr

- BPMN 2.0 export → the BPMN path of this skill (`normalize-bpmn`); verified on analyzr's
  side: any BPMN 2.0 parses, unknown extension content becomes a `parse-warning`.
- `.bpm`: ask for the BPMN 2.0 export (what a `.bpm` holds is to verify, so no converter is
  written for it); XPDL: an ad-hoc converter (`converters.md`) is possible, but the BPMN 2.0
  export is better.
- PDF or Word documentation exports: `images.md`.

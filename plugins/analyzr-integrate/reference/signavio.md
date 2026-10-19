# SAP Signavio Process Manager

Status: unverified: based on public documentation. Nothing below was checked against a real or
sandbox export yet (M6 §3.8, owner question §10.4); what analyzr itself does is marked
"verified on analyzr's side".

## Export paths

- **One diagram:** in the editor or the explorer, export as "BPMN 2.0 XML": one `.bpmn` (or
  `.xml`) file per diagram. To verify: menu names, the file name (diagram name?), the encoding.
- **Several diagrams or a folder:** a bulk export from the explorer, probably a zip with one
  file per diagram (the skill unpacks it into `exports/`). To verify: whether the zip keeps the explorer's folder structure (shared
  documents, sub-folders) and how name clashes are resolved.
- **API:** Signavio has a REST API; pulling with it is a later candidate (M6 §6), not this
  skill.

## What arrives

- BPMN 2.0 XML with `exporter="Signavio Process Editor, http://www.signavio.com"`, an
  `exporterVersion`, `targetNamespace="http://www.signavio.com"` and the namespace
  `xmlns:signavio="http://www.signavio.com"`.
- Extension elements in `extensionElements`: `signavio:signavioMetaData` (`metaKey`/`metaValue`,
  e.g. `bgcolor` or the customer's own attributes) and `signavio:signavioDiagramMetaData` (e.g.
  `revisionid`).
- Ids of the form `sid-<UUID>`; `<definitions id>` per diagram, assumed to be the diagram's
  stable id across revisions and exports (used as `externalId`; to verify).
- `isExecutable="false"`, no Camunda namespace; collaborations with pools and lanes;
  documentation in `<documentation>`.
- Linked diagrams ("Unterprozess verlinken") as collapsed subprocesses, probably without a
  `calledElement`; to verify whether a call activity ever carries one.

## Pitfalls

- **Links between diagrams get lost:** a collapsed subprocess that stands for another diagram
  is no call for analyzr, so no `call` relation arises from it; the report lists every
  collapsed subprocess for the consultant.
- **Customer attributes can name people** (process owner, author) in `signavio:signavioMetaData`;
  they stay in the model bytes analyzr stores (M6 §7 "Privacy").
- **Archived and copied diagrams:** exports may hold old versions next to current ones
  (`inspect --summary` lists archive-like folders; `plan --exclude` leaves them out), and a
  copy may keep the original's id (then `normalize-bpmn plan` flags `duplicate-external-id`
  and recognizes both files by their paths).
- **Wrapping folders:** a bulk export may put everything below one folder (for example
  „Gemeinsame Dokumente“); strip it from the keys on the first import (`--strip`).
- **Dictionary (glossary) entries** may appear as extension attributes or names; to verify.

## Mapping to analyzr

- Path: BPMN 2.0 → `normalize-bpmn` → bundle; `derived.kind` `export` for bytes analyzr reads
  completely, else `converted`.
- Verified on analyzr's side: the file parses as plain BPMN and `engine` is `null`; unknown
  extension content becomes a `parse-warning`, never an error
  (`packages/bpmn-facts/src/moddle.ts`); a collapsed subprocess yields no fact of its own; a
  static `calledElement` that matches exactly one process id passes through `normalize-bpmn`
  unchanged. Without an engine the model counts as derived (owner decision 24.2): analyzr
  proposes such a call at 90 % instead of accepting it, and the consultant accepts these calls
  in one step after the import („Gesammelt annehmen“).
- Keys: from the tool folders and the diagram's file name; `externalId` is the
  `<definitions id>`, so a folder move in Signavio keeps the key through `keymap.json`.

# Synthetic Signavio-style export (UNVERIFIED)

`2026-10-14-signavio/` is a **hand-written, synthetic** export of a fictitious machine builder,
written for the tests of `@analyzr/integrate` and for following the skill
`integrate-landscape` (M6 §8 S3b). It is **not** a real SAP Signavio export: no Signavio
instance produced it, and what it shows of Signavio's export format (the `exporter` attribute,
the `http://www.signavio.com` namespace with `signavioMetaData` and `signavioDiagramMetaData`
extension elements, `sid-` ids, `<definitions id>` as the model's tool id, one file per
diagram in the tool's folders) comes from general knowledge and public documentation and is
**unverified** (`plugins/analyzr-integrate/reference/signavio.md`). Nothing in it derives from
a customer or from the holdout landscape; the names are generic.

Realistic quirks:

- nested tool folders below a wrapping folder (`Gemeinsame Dokumente/Vertrieb/…`) and an
  `Archiv/` folder with an archived copy whose file name has a space and parentheses;
- Signavio extension elements in `extensionElements`, `sid-` ids, `isExecutable="false"`,
  no Camunda namespace (analyzr's `engine` is null);
- a collaboration with a **black-box pool** („Kunde“) and message flows to and from it, and
  lanes named after roles;
- a **collapsed subprocess** („Bonität prüfen“) that stands for another diagram;
- a call activity whose static `calledElement` names the process id of another file (passed
  through unchanged);
- a non-BPMN file (`Prozesslandkarte.pdf`, a placeholder, not a real PDF).

Deliberate defects for normalize-bpmn (not claimed to be Signavio behaviour):

- `Gemeinsame Dokumente/Finanzen/Rechnungsstellung.bpmn` is UTF-16LE with a byte order mark;
- `Gemeinsame Dokumente/Finanzen/Bonitätsprüfung.bpmn` has an id with umlauts
  (`Aufgabe_Bonität_prüfen`, a valid NCName that bpmn-moddle drops as „illegal ID“) and an id
  starting with a digit (`4711`);
- `Gemeinsame Dokumente/Logistik/Versand.bpmn` has two tasks with the same id (a copy-paste
  glitch; bpmn-moddle drops the second).

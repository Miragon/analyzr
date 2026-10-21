# Pictures and PDFs

Status: no tool export involved; what analyzr does with the spec is verified on analyzr's side
(the spec format and its renderer: `analyzr-spec.md`; the example below is validated and rendered
by `tools/integrate/test/plugin.test.ts`). How well a picture reads depends on the picture: every
reading is yours, and the consultant checks it.

## What arrives

- Photos of whiteboards and flipcharts, screenshots of a modelling tool, scanned or exported PDFs
  (one page per process, or a whole process handbook).
- `inspect` counts JPEG, PNG and GIF files as `image` and PDFs as `pdf`; other picture formats
  (HEIC from a phone, WebP) count as `binary`: ask for JPEG or PNG. There is nothing to convert:
  you read them with your own file reader (Claude Code reads pictures and PDF pages) and write one
  spec per process yourself, `derived.kind: reconstructed` with the model you run as.

## Pitfalls

- **Illegible text:** a label you cannot read gets no `name` and a `note` („unleserlich“); never
  guess a name from the context.
- **Implicit flows:** a whiteboard often shows order by position, not by arrows. Draw a flow only
  where the picture shows a line or an arrow; where the order is only implied, add a `note`.
- **Several processes in one picture:** one spec per process the picture shows (each its own
  model and key); a sketch of a process landscape (boxes for whole processes) is no process
  model: list it under „Offene Punkte“ instead.
- **Printouts next to the models:** a PDF in a tool's export often prints the models the export
  holds as BPMN or VSDX, or shows the landscape map. Read it only for a process the other files
  lack; a second, reconstructed copy of a model would take its own key.
- **People's names** in lanes, sticky notes, labels and file names („Workshop mit Frau
  Meier.jpg“): use the role instead (lane „Vertrieb“, „Sachbearbeitung“) everywhere in the spec,
  also in `documentation`, message and signal names, `note`, `notes` and `source.file`
  („Frau Meier prüft“ becomes „Sachbearbeitung prüft“), and derive the tool path from the
  process the picture shows, never from a file name that names a person. Keys never change
  once analyzr has them, and analyzr keeps every tool path it was given.
- **Crossed-out shapes and second versions** on the same board: leave them out and say so in
  `notes`.
- **Labels that look like message names** („Mail an Kunde“): a task's label is no message name;
  set `message` only when the picture names the message itself.
- **Screenshots of a tool:** the tool path it shows (its folder tree, the model's name) is the
  `externalPath`, so a later real export of that tool takes the key over; still no `externalId`
  or `url`, which a picture never proves.

## Mapping to analyzr

- One `*.spec.yaml` per process in `specs/<YYYY-MM-DD>-<system>-images/` of the workspace
  (`specs/<YYYY-MM-DD>-images/` for the system `images`), a folder of its own, never a
  converter's: `<system>` is the tool whose model a picture shows (a screenshot or printout:
  `visio`, `aris`, `signavio`), else `images` (whiteboards, flipcharts, drawings, also in a
  tool's export); the date is the day the pictures were taken or delivered.
- `derived: {kind: reconstructed, llmModel: <the model you run as>}`; ask the consultant if you
  do not know your model id.
- `source.externalPath`: the tool's folder and model name when the picture shows a tool's model,
  else the process's area and name („Service/Reklamation“); `source.file`: the picture's path
  below the export (a person's name in it replaced by the role).
- No `externalId`, no `url` (`validate` refuses both in a spec you write).
- A call to another process is `type: call` with `target`; analyzr never links it on its own.
- `documentation` only for text the picture shows word for word.
- Read the files only with your own file reader: never upload a customer picture to a web OCR
  service, a converter or another connector.
- Then `analyzr-spec.mjs validate` until no errors remain, and `plan` and `bundle` as for
  converter specs. analyzr shows these models as „KI-rekonstruiert“.

## Example

A flipchart with two lanes, written as roles (the photo's lanes named two people):

```yaml
format: analyzr-spec/1
source:
  externalPath: Einkauf/Bestellanforderung
  file: Flipchart Einkauf.jpg
derived:
  kind: reconstructed
  llmModel: claude-opus-5-5
processes:
  - source: p
    name: Bestellanforderung
    lanes:
      - { source: fachbereich, name: Fachbereich }
      - { source: einkauf, name: Einkauf }
    nodes:
      - { source: bedarf, type: start, name: Bedarf erkannt, lane: fachbereich }
      - { source: anfordern, type: task, kind: user, name: Bestellanforderung anlegen, lane: fachbereich }
      - { source: freigabe, type: gateway, kind: exclusive, name: Freigegeben?, lane: einkauf }
      - { source: bestellen, type: task, name: Bestellung auslösen, lane: einkauf }
      - { source: x3, type: task, lane: einkauf, note: "Beschriftung unleserlich" }
      - { source: erledigt, type: end, name: Bestellt, lane: einkauf }
      - { source: abgelehnt, type: end, name: Abgelehnt, lane: fachbereich }
    flows:
      - { from: bedarf, to: anfordern }
      - { from: anfordern, to: freigabe }
      - { from: freigabe, to: bestellen, name: ja }
      - { from: freigabe, to: abgelehnt, name: nein }
      - { from: bestellen, to: x3 }
      - { from: x3, to: erledigt }
notes:
  - "Die Bahnen hießen auf dem Foto nach zwei Personen; ich habe ihre Rollen eingesetzt."
```

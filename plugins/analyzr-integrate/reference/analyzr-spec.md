# analyzr-spec/1

Status: format note for `analyzr-spec.mjs` (renderer 0.1.0): the validator, the renderer and the
examples below are tested on analyzr's side (the examples are validated and rendered by
`tools/integrate/test/plugin.test.ts`).

One spec file describes **one model**: its processes, lanes, nodes and flows, and where it lives
in the tool. `analyzr-spec.mjs` validates it, renders it as BPMN 2.0 with layout (no engine, no
conditions, no scripts) and bundles it; analyzr then treats the model as derived: `converted` or
`reconstructed`, never as modelled. A spec comes from one of two places:

- **converter output**: `analyzr-convert.mjs convert` writes one spec per model a converter
  returns (`converters.md`), and its run record `analyzr-specs.json` next to them. Never edit
  these files: fix the converter and run it again (a changed spec is refused).
- **a spec you write** from a picture or PDF (`images.md`): `*.spec.yaml` in a spec folder of its
  own, with `derived` (`reconstructed` and the model you run as).

## Files

- YAML 1.2 (core schema) or JSON, one model per file, at most 2 MB, UTF-8. Name the files
  `*.spec.yaml` (or `.spec.yml`, `.spec.json`); `validate` and `bundle` read every such file below
  the folder.
- No anchors, aliases, merge keys (`<<`) or tags (`!!binary`, `!foo`), one document per file,
  no duplicate key: each is an error.
- **Quote ids:** every `source`, `from`, `to`, `lane`, `reads`, `writes` and `externalId` must be
  a YAML string. An unquoted `0012` or `1.10` is a number in YAML and an error.
- An unknown field is an error. There is no `key`, no `name` at the top, no BPMN id and no
  `calledElement`: keys come from `keymap.json` through `plan`, the BPMN ids from each element's
  `source`, and the name analyzr shows for the model from the process whose BPMN id sorts first:
  its `pool` when the model is drawn as a collaboration (several processes, lanes, black-box pools
  or message flows) and the process has one, else its `name`.

## Fields

`?` marks an optional field; `null` counts as absent.

```text
format: analyzr-spec/1                 required, literal
source:                                required: where the model lives in the tool
  externalId?: string                  converter output only: the tool's id of this one model
                                       (an ARIS model GUID; never a file's or a document's id); 1–255
  externalPath: string                 required: tool folder and model name, "/"-separated
                                       ("Vertrieb/Prozesse/Auftragsabwicklung"); 1–1024, no empty parts
  url?: string                         converter output only: http(s) link into the tool, no credentials
  file?: string                        the export file it came from (for the report)
derived:                               required in a spec you write, refused in converter output
  kind: reconstructed                  (as-told is for interviews, S6; bundle refuses it until then)
  llmModel: string                     the model you run as (1–120 characters)
participants?:                         black-box pools (no process), top to bottom
  - { source, name? }
processes:                             at least one, top to bottom
  - source: string
    name?: string
    documentation?: string             only text the source holds; at most 2000 characters
    pool?: string                      the pool's name in a collaboration (default: the process name)
    lanes?: [{ source, name? }]        top to bottom
    dataStores?: [{ source, name? }]
    nodes:                             at least one
      - source: string                 unique over the whole spec, 1–200 characters
        type: start | end | task | subprocess | call | event | gateway
        name?: string                  not on call (a call is drawn under its target's name)
        documentation?: string
        lane?: string                  a lane of this process (required in a spec you write when
                                       the process has lanes)
        note?: string                  for the report only, never drawn ("Beschriftung unleserlich")
        start:      trigger?: none | message | signal | timer        (default none)
        end:        trigger?: none | message | signal | terminate    (default none)
        event:      direction: catch | throw
                    trigger: message | signal | timer (catch); none | message | signal (throw)
        task:       kind?: none | user | manual | service | send | receive   (default none)
                    reads?, writes?: [data store source]
        subprocess: collapsed; reads?, writes?
        call:       target: string     the callee as the source names it
        gateway:    kind: exclusive | parallel | inclusive | event-based
        message?:   the message's own name, only when the source names it (message triggers,
                    send and receive tasks); without it the label is the key
        signal?:    the signal's own name, only when the source names it (signal triggers)
    flows?: [{ from, to, name?, source? }]          nodes of this process
messageFlows?: [{ from, to, name?, source? }]       nodes, processes or participants of two pools
notes?: [string]                       for the report only
```

Limits: at most 5,000 nodes, 10,000 flows, message flows and data associations together, and
1,000 processes, participants, lanes and data stores together per spec (`too-many-nodes`,
`too-many-flows`, `too-many-parts`); a layout of more than 100,000 slots fails as
`layout-too-large`, a render over 5 MB or 50,000 elements as `too-large` and
`too-many-elements`. Labels and keys are cut at 200 characters, documentation at 2000 (a warning
and the loss `text-truncated`).

## What the renderer does

- Ids are `<Category>_<source>` (`Activity_t1`, `Event_s1`, `Gateway_g1`, `Flow_t1_t2`,
  `Lane_…`, `Process_…`), so a task refined to a send task, or a call later linked, keeps its id
  and every link on it. Unsafe sources are rewritten (`id-rewritten`).
- A `call` becomes a collapsed subprocess named after its target, with the loss
  `link-unresolved`: analyzr records no call target from a spec; the consultant links it in the
  model view („Verknüpfen mit …“).
- Every process is `isExecutable="false"`, without engine attributes; the layout is generated
  (`layout-generated`).
- Nodes, flows and data stores are sorted, so a re-export that only reorders them gives the same
  bytes; pools and lanes keep their order.

## Example: a converter's output

What `analyzr-convert.mjs` writes for one Visio page (no `derived`: the run sets it). The shape
data names the messages, so the converter sets `message`.

```yaml
format: analyzr-spec/1
source:
  externalId: null
  externalPath: Vertrieb/Prozesse/Auftragsabwicklung
  file: Vertrieb/Prozesse.vsdx
participants:
  - { source: pool-kunde, name: Kunde }
processes:
  - source: page-1
    name: Auftragsabwicklung
    documentation: Vom Auftragseingang bis zur Auftragsbestätigung.
    lanes:
      - { source: lane-vertrieb, name: Vertrieb }
      - { source: lane-finanzen, name: Finanzbuchhaltung }
    dataStores:
      - { source: ds-crm, name: CRM }
    nodes:
      - { source: s1, type: start, trigger: message, message: Auftrag, name: Auftrag eingegangen, lane: lane-vertrieb }
      - { source: t1, type: task, name: Auftrag prüfen, lane: lane-vertrieb, reads: [ds-crm] }
      - { source: g1, type: gateway, kind: exclusive, name: Auftrag vollständig?, lane: lane-vertrieb }
      - { source: c1, type: call, target: Bonitätsprüfung, lane: lane-finanzen }
      - { source: t2, type: task, kind: send, message: Auftragsbestätigung, name: Bestätigung senden, lane: lane-vertrieb }
      - { source: t3, type: task, name: Rückfrage stellen, lane: lane-vertrieb }
      - { source: e1, type: end, name: Auftrag bestätigt, lane: lane-vertrieb }
      - { source: e2, type: end, name: Auftrag zurückgestellt, lane: lane-vertrieb }
    flows:
      - { from: s1, to: t1 }
      - { from: t1, to: g1 }
      - { from: g1, to: c1, name: ja }
      - { from: g1, to: t3, name: nein }
      - { from: c1, to: t2 }
      - { from: t2, to: e1 }
      - { from: t3, to: e2 }
messageFlows:
  - { from: pool-kunde, to: s1, name: Auftrag }
  - { from: t2, to: pool-kunde, name: Auftragsbestätigung }
```

## Example: a spec you write from a picture

From `exports/2026-10-14-bilder/Whiteboard Reklamation.jpg`. The whiteboard names no messages, so
there is no `message`; what you could not read is a `note`, and what you left out is in `notes`.

```yaml
format: analyzr-spec/1
source:
  externalPath: Service/Reklamation
  file: Whiteboard Reklamation.jpg
derived:
  kind: reconstructed
  llmModel: claude-opus-5-5
processes:
  - source: p
    name: Reklamationsbearbeitung
    nodes:
      - { source: start, type: start, name: Reklamation eingegangen }
      - { source: pruefen, type: task, name: Reklamation prüfen }
      - { source: berechtigt, type: gateway, kind: exclusive, name: Berechtigt? }
      - { source: gutschrift, type: call, target: Gutschrift erstellen }
      - { source: ablehnen, type: task, kind: send, name: Ablehnung senden,
          note: "Pfeil zur Ablehnung nur schwach zu sehen" }
      - { source: ende, type: end, name: Reklamation erledigt }
    flows:
      - { from: start, to: pruefen }
      - { from: pruefen, to: berechtigt }
      - { from: berechtigt, to: gutschrift, name: ja }
      - { from: berechtigt, to: ablehnen, name: nein }
      - { from: gutschrift, to: ende }
      - { from: ablehnen, to: ende }
notes:
  - "Rechts unten ein durchgestrichener Kasten „Rückruf“: nicht übernommen."
```

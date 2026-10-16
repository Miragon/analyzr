# analyzr – Milestone M6 "Landscape integration and gap analysis"

Status: in progress (2026-10-15); owner decision 24 (§2, HANDOFF §4); S0 (this concept, revised
after review), S1, S3a and S3b done, the „erste Anfänge“ await the owner's review (§8) · Branch:
`feat/integration-and-gaps` ·
Spec: [CONCEPT.md](CONCEPT.md) §1–§7 · Previous: [M4-VALUE-CHAIN.md](M4-VALUE-CHAIN.md) · Paused:
the process network map (decision 22, issue [#2](https://github.com/Miragon/analyzr/issues/2)),
which keeps the name M5. M6 goes ahead of it; that amends decision 22's "next milestone" (decision
24.6, confirmed 2026-10-15).

M6 makes analyzr usable on customer landscapes that live in other tools. Part A builds the
toolkit around analyzr (CLI, an import bundle, a second Claude Code plugin with interactive
skills, converters, a deterministic BPMN renderer), so a consultant can get a landscape from
ARIS, Signavio, Visio & co. into analyzr quickly, ad hoc and reproducibly. Part B lets analyzr
show what is missing to build more links and lets the consultant answer it, in the web UI as
well. Part C adds interview skills that turn conversations into questions, fact sheets and BPMN
drafts. Agents propose and draft, humans decide, and analyzr holds no LLM credentials (decision
4); this concept adds that the consultant runs every import (§3.1).

## 1. Purpose and the one loop

Everything in M6 serves one loop:

```
ingest from any tool ──► facts ──► rule tier, findings ──► agents judge (once) and report gaps
        ▲                                                              │
        │                                                              ▼
 new input (re-export, answer, as-told model) ◄── consultant answers ◄── open questions
        │                       (web UI or interviews)
        └──► re-analysis only where the input changed
```

Most of the loop exists. Four joints are missing:

| Step | Today | Where | Missing joint |
|---|---|---|---|
| Ingest | `PUT …/models/by-key/{key}`, `POST …/imports` (≤ 50 files, 25 MB), seed; one transaction per request; identical bytes are `unchanged` (no revision, no event); a `relations` task for a new model or a changed `facts_hash` (and after a failed task, also for a layout-only change); the server sets `RevisionSource` (`{kind: 'import', path}` for imports, `{kind: 'upload'}` for PUT; the enum value `seed` is unused, `analyzr seed` imports), a client cannot send provenance | `apps/server/src/domain/ingest.ts`, `use-cases/models.ts`, `packages/contracts/src/api/models.ts` | **1. typed provenance** on revisions (trust only with the owner's OK, §3.10); **4. an import-impact function** (no dry run for models exists) |
| Facts | `@analyzr/bpmn-facts` parses any BPMN 2.0; `engine` is `null` when the file names neither Camunda 7 nor 8; `isExecutable` defaults to false and no rule reads it; unknown content becomes warnings, which the server drops (`apps/server/src/analysis.ts` passes facts, processes, message flows and the engine on, not `warnings`) | `packages/bpmn-facts/src/extract.ts` | (warnings: S1) |
| Rule tier, findings | a static `calledElement` matching exactly one process id is accepted (decision 9); equal message or signal names are key-tier proposals; five finding kinds | `packages/relations/src/rules.ts`, `packages/contracts/src/findings.ts` | reads joint 1 only if the owner amends decision 9 (§3.10) |
| Agents judge | judge each pair once (basis: both models' `facts_hash` plus the procedure) and each process once (`analyzr-placement-input/1`) | `apps/server/src/domain/judgements.ts`, `value-chain/pipeline.ts` | a structured gap channel (S7) |
| Open questions | spread over holds, agent questions, unsure placement verdicts, coded no-links, findings, value chain findings, submission summaries (REST only) | §4.1 | **2. one open-questions read model** |
| Answers | human notes on relations and placements | `use-cases/review.ts` `addRelationNote` | **3. answers that change analysis input**: a relation note queues nothing and is not part of the judgement basis; a placement note makes the process due but queues nothing |
| Re-analysis | a new `facts_hash` re-queues the model; a human placement assertion changes the process's input hash (`lastNonAgentSeqs`) | `ingest.ts` `queueAnalysis`, `value-chain/pipeline.ts` | joint 3 |

Joint 4 also serves M5: its `impact_of` reuses the relation-graph part of the same pure function
(HANDOFF §7 "Next milestone").

### 1.1 The consultant's path

From „Kunde gibt mir einen Export“ to „Landschaft in analyzr, Lücken gelistet“; each step names
the command or screen and the slice that adds it ("today" means it exists now):

1. **Workspace.** Set up a workspace for the customer and file the export under `exports/`
   (§3.7; S3b).
2. **Convert.** `/analyzr-integrate:integrate-landscape <export>`: a bundle and a German report
   (S3b).
3. **Import.** Create the project and import the bundle: `analyzr import <bundle> -p <project>
   --create --name …`, or „Neues Projekt“ and „Hochladen“ with the bundle folder in the web
   (today). The preview comes with S2b; until then a first import can go into a probe project
   (§3.7 step 5).
4. **First gap list.** „Offene Fragen“ right after the import, from the deterministic signals
   alone, without an LLM run (S4).
5. **Relations.** Create an agent token and run `/analyzr:relations <project>` or
   `examples/agents/claude-code/run-headless.sh` (today); the next-step block after `analyzr
   import` names it (S1).
6. **Value chain.** The customer's process map as a `.vc.json` from the skill (pushed with
   `analyzr value-chain push` or imported on the chain page), a draft from `draft_value_chain`
   (size limit: §6), or the chain editor (today).
7. **Placements.** `/analyzr:placements <project>` (today).
8. **Review** in the web (today); export „Offene Fragen“ with the agents' questions for the
   customer (S4).
9. **Answers.** Record the customer's answers one by one or from the returned CSV (S5a).
10. **Next export.** Run the skill again, preview and re-import (S2b); the answers reach the
    agents with S5b and S7.

The size and cost of the first agent run on a customer landscape (§6 "Run size and cost
estimate") already matter at step 5, during M6: S1 prints the tasks waiting, and the follow-up of
S2b's impact counts the pairs to judge.

## 2. Owner decision 24 (2026-10-15)

Recorded in HANDOFF §4 on 2026-10-15 in short form; HANDOFF §7 names M6 and keeps M5 paused, and
CONCEPT §11 notes what §7 "Deferrals" says. The full record:

24. **Landscape integration and gap analysis (M6)** (2026-10-15), before the process network map
    (M5, paused); this amends decision 22's "next milestone" (§10.7). The wishes: „Brauchen einen
    Mechanismus, eventuell eine CLI um möglichst einfach Modelle usw. rein zu kippen und
    Integrationen ad-hoc zu schreiben.“ „Kunden haben die unterschiedlichsten Systeme, Aris,
    Signavio, Visio & co. Die von außen analysiert und eingekippt werden sollten.“ „Wir brauchen
    eventuell Skills & Co, um aus Interviews Prozesse aufzuzeigen“ „Wäre es super wenn die AI
    aufgrund von Modellen und fehlenden Informationen erkennt und Vorschläge macht das zu
    ergänzen. Also bewusst Modelle bewertet und sagt: Da fehlt mir etwas um weitere Verknüpfungen
    zu bauen.“ The answers:
    1. **Priority: the toolkit around analyzr.** „ich will eher etwas haben mit dem ich schnell
       dann landschaften integrieren kann. d.h. tools drum herum mit denne das geht. SKills & Co.
       Dafür reicht aber das konzept und erste anfänge, wenn jetzt schon sinnvoll.“ No customer
       tool is named and no sample export exists, so converters stay generic (§3.8). The „erste
       Anfänge“ are S1, S3a and S3b (§8, about 6.5 days of agent work): import hygiene, the loss
       measurement and the integrate skill v0 for BPMN exports. The owner reviews them before the
       rest starts.
    2. **Trust policy: decided as recommended** („Ja, wie empfohlen“, after „warum? was meinst
       du dazu?“ and the agent's explanation). It amends decision 9 (a unique static call in a
       derived revision, §3.10, is proposed, tier `key`, 0.9) and extends decision 19 (rules may
       accept such call proposals narrowed by derived kind and converter); revisions stored
       before S2c keep their acceptances, listed once for a bulk revocation (option (a) of
       §10.1). It ships as S2c; until then the toolkit limits the risk on its side (§3.9: specs
       from ad-hoc converters, reconstructions and interviews get no `calledElement`; the
       consultant runs every import, §3.1). The related question whether REST ingest and model
       deletion need a human or a scope of their own stays open (§10.1).
    3. **Who answers gaps:** „Ich als berater, aber sollte auch in der UI gehen.“ The consultant
       (local mode's single human, decision 6) answers, and answering works in the web UI, not only
       through skills or the CLI (§4.5). It ships as S5a, live-run neutral, right after the
       open-questions view.
    4. **Gap output form: decided by the agent** („entscheide du was besser passt“): a `gaps` field
       in the existing submissions, `analyzr-relations@0.3.0` and `analyzr-placements@0.2.0`,
       released together after the owner's live runs, not a pipeline kind `analyzr-gaps` of its
       own. Why: the relations task reads the model anyway and sees exactly what blocks a link, so
       there is no second reading pass and no extra procedure, live gate or task kind; the
       deterministic gap signals and the open-questions view come first without any agent change.
       The cost: the 0.3.0 bump re-judges every pair (the judgement bases include the procedure)
       and needs a live-gate round for both procedures (decision 13); but that bump is needed
       anyway for `missing-info`, the guidance for descriptive models and the claim-input fields,
       and a kind of its own would add a second procedure and live gate on top. A kind of its own
       stays possible if model-level assessment beyond linking proves necessary.
    5. **Customer exports and transcripts at the operator's LLM vendor:** „ja das passt erstmal.
       wir reden dann irgendwann über alternativen.“
    6. **Process:** „Gehe Schritt für Schritt vor, das hier weiterzuentwickeln und
       weiterzutreiben.“ M6 ships in small slices (§8), each with the full gates.
    7. **M6 before M5** („Ja, M6 zuerst“, 2026-10-15): amends decision 22's "next milestone";
       M5 stays paused.
    8. **Principle 7 counts `packages/*` only** („Ja, tools/integrate“): the toolkit's scripts
       ship in the private workspace package `tools/integrate` (§3.7, S3b).
    9. **Agent submission summaries are shown read-only** („Ja, nur lesend“) in „Offene Fragen“
       and the model view (S4); this reverses the resolution of M3-RELATIONS-PROCEDURE.md
       question 1.

## 3. Part A: Integration toolkit

### 3.1 Ground rules

- **Outside the core.** Converters, the renderer and the skills live in
  `plugins/analyzr-integrate`, `tools/integrate` and the consultant's workspace, not in analyzr's
  five packages (CONCEPT principle 7; its reading for `tools/integrate` is §10.8) and never in the
  server: AML, VSDX, ADOxx or Bizagi parsers in the server would widen the attack surface
  `packages/bpmn-facts/src/input.ts` keeps small (DOCTYPE and ENTITY refused, UTF-8 only, 5 MB,
  50k elements). BPMN 2.0 comes in (principle 3); everything else is converted first.
- **Deterministic first.** Code converts where it can; an LLM writes only a spec YAML that
  deterministic code renders (§3.9). Every capability analyzr itself gains (dry run, provenance,
  open questions) is a domain use case behind REST that the CLI and the web render (decision 3).
- **The consultant imports; the agent client is the guard.** The integrate skill inspects,
  converts, writes the bundle and runs read commands and dry runs only; it never runs a write
  command. It prints the import, which the consultant runs (`! <command>` in Claude Code) or does
  with „Hochladen“ in the web (the pattern of `draft_value_chain`, M4 §3.3). analyzr does not
  enforce this in local mode: an agent with a shell runs as the consultant's OS user, and
  `analyzr import` without `--token`/`ANALYZR_TOKEN` falls back to the owner key file that user
  can read (`apps/cli/src/credentials.ts` `anyCredential`). So the guard is the client's approval
  of every command that is not pre-approved: the skill pre-approves read commands and `analyzr
  import … --dry-run` only, and the consultant does not run it in a bypass or auto-approve mode
  (Codex with approvals on). A stronger setup denies the agent the owner key file (a Claude Code
  `permissions.deny` rule, a Codex sandbox without read access to that path as HANDOFF §9 asks
  for the holdout; the exact rules are verified in S3b); in the Docker setup the key sits in the
  container's volume anyway. A read+propose `ANALYZR_TOKEN`, if set, makes an accidental import
  without `--dry-run` fail with 403 `insufficient-scope`: a guard against mistakes, not against an
  agent that unsets it, and local mode does not need it. The policy lets any `analyzr:write` token
  ingest (`apps/server/src/domain/policy.ts`, `write.humanOnly` is `null`); the reference setups
  issue no write scope (`examples/agents/README.md` "Rules for every run"), and the integrate
  skill needs none. For the same reason the provenance field `uploader` (§3.3) tells credential
  kinds apart, not people.
- **No customer data in the repository.** Exports, bundles and transcripts stay in the
  consultant's workspace outside the checkout; fixtures are synthetic; nothing derives from the
  holdout.

### 3.2 The import bundle `analyzr-import/1`

A folder any converter, script or person can produce, language-agnostic:

```
<bundle>/
  analyzr-import.json          # manifest (optional; without it, today's behaviour)
  <key path>.bpmn              # one model per file at its key's path, e.g. vertrieb/auftragsabwicklung.bpmn
  value-chain.vc.json          # optional: a process map as a value chain (M4 format)
  inventory.json               # optional: the customer's process inventory (analyzr-inventory/1)
```

The models sit at the bundle root at their key's path, so `analyzr import <bundle>`, dropping the
folder into „Hochladen“ (the web strips the dropped folder's own name, `apps/web/src/lib/upload.ts`
`stripRoot`) and the manifest-aware import of S2 all yield the same keys; none of the three other
files matches the BPMN file rule, also with `.xml` (S1). The skill writes every file at the path
of its pinned key, so a bundle stays importable without manifest support.

```jsonc
{
  "format": "analyzr-import/1",
  "source": {"system": "signavio", "systemVersion": null, "exportedAt": "2026-10-14T09:12:00Z",
             "importer": {"name": "analyzr-integrate/normalize-bpmn", "version": "0.1.0"},
             "scope": ["Vertrieb"]},                    // optional: tool folders a partial export covers (§3.5)
  "files": [{
    "path": "vertrieb/auftragsabwicklung.bpmn",         // below the bundle root, the multipart file name
    "key": "vertrieb/auftragsabwicklung",               // pinned key; else the path decides
    "externalId": "sid-6F1C…",                          // the tool's model id, opaque
    "externalPath": "Vertrieb/Auftragsabwicklung",      // folder in the tool
    "url": "https://…",                                 // optional, http(s) only
    "derived": {"kind": "converted", "converter": "normalize-bpmn@0.1.0", "llmModel": null, "from": []},
    "losses": [{"code": "attribute-dropped", "count": 4}],
    "sha256": "…"                                       // optional; a mismatch is the warning manifest-sha-mismatch, the file is imported
  }],
  "valueChain": {"path": "value-chain.vc.json", "derived": {"kind": "converted", "converter": "…"}},
  "inventory": {"path": "inventory.json"}
}
```

| `derived.kind` | Meaning |
|---|---|
| `export` | the tool's own BPMN 2.0, bytes unchanged |
| `converted` | deterministic code transformed it; `converter` names a bundled converter (`name@version`) or an ad-hoc script (`adhoc:<first 12 hex of its sha256>`); ad-hoc converters emit `analyzr-spec/1`, never BPMN (§3.9) |
| `reconstructed` | an LLM or vision model derived it from a picture, PDF or an ambiguous format (EPC semantics, plain Visio shapes); `llmModel` required |
| `as-told` | from interviews (Part C); `from` lists opaque source ids (`src-…`), never names or excerpts |

A kind `generated` (an LLM wrote the model from an SOP or a process description) is added when a
skill produces it; no M6 slice does.

`losses` counts what a conversion dropped (`element-dropped`, `attribute-dropped`,
`link-unresolved` for a tool link to a model not in the export or a call the renderer did not
write, `layout-generated`, `id-rewritten`, `text-truncated`), at most 20 entries, counts only. The
schema lives in `@analyzr/contracts` (`ImportManifest`), so the CLI, the web and the server
validate it the same way. The CLI sends each batch's subset of the manifest as an extra multipart
part `manifest`; the web does the same when a dropped folder holds `analyzr-import.json`. The
`.vc.json` and the inventory are never sent with the models: the human pushes the chain with
`analyzr value-chain push --dry-run`, then without it (owner key only, as today), or imports it
on the chain page, and analyzr does not ingest inventories in M6 ("inventory-first import" is a
later candidate, §6).

**`analyzr-inventory/1`** is `{format, items: [{id, name, area?, externalId?}]}`. The skill
converts the customer's sheet (Excel or CSV) and drops columns that name people. It matches items
to models by `externalId`, else proposes name matches, which the report lists as „Zuordnung
vorgeschlagen“ for the consultant to confirm; unmatched items become the request list („Bitte
nachliefern: …“) and the coverage line („Modelle für 31 von 48 Prozessen im Katalog“). The file
stays in the workspace.

A process map (ARIS value-added chain, a Signavio or ADONIS process map; formats to verify)
becomes a `.vc.json` flattened to depth ≤ 2 and ≤ 500 elements (M4 §2); a step whose detail
model is in the bundle gets the link `analyzr:process/<key>#<processId>`, which already yields
a key-tier placement proposal (`packages/relations/src/placement.ts`, M4 §2 "Tiers"), never an
acceptance.

### 3.3 Typed provenance on revisions

`RevisionSource` (a `looseObject` over `model_revision.source` jsonb, so no migration) gains typed
optional fields. They stay out of facts and `facts_hash` (`packages/bpmn-facts/src/fingerprint.ts`),
so provenance never triggers re-judging.

| Field | Set by | Shown as |
|---|---|---|
| `kind`, `path` | server (unchanged) | |
| `uploader` (`human` \| `agent`) | server, `sourceKindOf(actor)` at ingest (`apps/server/src/domain/actor.ts`): `human` for the owner key or the web session, `agent` for an agent token; a credential kind, not a person (§3.1) | „Hochgeladen über Owner-Zugang/Agenten-Token“ |
| `manifestSha256` | server | |
| `system`, `systemVersion`, `exportedAt`, `importer`, `scope` | manifest (declared) | „Herkunft … (angegeben)“ |
| `externalId`, `externalPath`, `url` | manifest (declared, not checked beyond the URL scheme) | „Im Quellsystem öffnen“ for an http(s) URL (`rel="noopener noreferrer"`, as M4 links) |
| `derived {kind, converter, llmModel, from}` | manifest (declared) | badges „Konvertiert“, „KI-rekonstruiert“, „Aus Interview“ |
| `losses` | manifest (declared) | „Verluste bei der Konvertierung“ |

If the owner amends decision 9 (§3.10), declared values can only lower trust, never raise it.
Identical bytes stay `unchanged` and keep the first revision's provenance (append-only); a
correction needs new bytes. The fields analyzr adds itself aim to hold no personal data: the
integrate skill drops author and owner fields of exports, and `derived.from` takes opaque ids only
(pattern `[A-Za-z0-9._:-]{1,64}`). The declared `externalPath` and `url` are not checked, and the
model bytes themselves (lanes, documentation, tool metadata) can name people (§7 "Privacy").

### 3.4 Stable identity

Model keys are immutable path slugs (`modelKeyFromPath`, today in
`apps/server/src/domain/paths.ts`, from S1 in `@analyzr/contracts`); rename and re-anchoring come
in R2 (CONCEPT §10), and decisions anchor on `<key>#<elementId>` (ADR-0001). So the first import
fixes a landscape's keys for good, and three rules hold from the first customer import on:

1. **Keys come from the tool's identity, not its folders.** The manifest pins `key` per file; on
   a re-export the skill reuses the `externalId → key` mapping of the workspace's `keymap.json`
   (§3.7), so a folder move in the tool keeps the key. analyzr is the record (decision 7): if the
   workspace is lost or a colleague does the re-export, the skill rebuilds `keymap.json` from
   `GET /projects/{p}/external-ids?system=<s>` (S2a: key, `externalId` and `externalPath` of each
   live model's head revision).
2. **Element ids come from tool ids, never regenerated.** A converter derives every id from the
   source object's id (`<Type>_<NCName-safe source id>`, a prefix for ids starting with a digit,
   a deterministic suffix on collisions, ≤ 255 characters, `packages/contracts/src/refs.ts`). A
   converter that regenerates ids sends accepted relations to `changed`/`missing` on every
   re-import and re-queues every model (decision 17).
3. **Bytes are reproducible.** Converters write no timestamps or volatile metadata, so a
   re-export of an unchanged model is `unchanged` (content hash), not a new revision.

The import result and the dry run carry two warnings; the import proceeds:

- `external-id-moved`: the same `(system, externalId)` already belongs to another live key (a
  likely rename in the tool).
- `external-id-changed`: the key's head revision carries a different `(system, externalId)` than
  the incoming file, both present (two systems export the same folder and name, and the second
  would silently revise the first). An as-told draft has no `externalId`, so the real model that
  replaces it does not trigger it. The skill stops on it and asks; when a second system joins, its
  key-scheme confirmation proposes a prefix (for example `aris/…`).

### 3.5 Server dry run: one pure `importImpact`

The existing previews compute impact with pure code (`apps/server/src/domain/value-chain/impact.ts`
"Pure"; `auto-accept/preview.ts`, the pure part that the rule preview and the apply dry run share);
`apps/server/src` has no rollback pattern. M6 follows that precedent:

- **Refactor first:** `recomputeProject` (`apps/server/src/domain/recompute.ts`) runs inside the
  write transaction. It splits into a pure planner (rule assertions to record or withdraw,
  statuses, endpoint states, findings) and the writer, pinned by a golden digest over seeded
  histories as M4 S1 did for `recomputeStatus`.
- **`importImpact(head, candidates)`**, pure, over the head and the candidate files (key, content
  hash, extracted facts, warnings), in two steps:
  - **S2b:** per file the would-be outcome, key, warnings, whether facts change and processes
    added or removed; rule-tier calls newly accepted (decision 9) and rule proposals added or
    withdrawn; accepted relations turning `changed` or `missing`; findings added and resolved; and
    live keys of the same `source.system` absent from the bundle, limited to those whose
    `externalPath` lies inside the manifest's `source.scope` (default: the whole system), so a
    partial export does not list every other area (information only: nothing is pruned,
    decision 7).
  - **Follow-up, right after:** judgements made non-current (pairs to re-judge, the cost signal);
    relations tasks queued or cancelled and whether the placement task becomes due; placements
    turning `changed` or `missing`. The head then also covers current judgements, placements, the
    chain's structure and open tasks.

  Lists are capped at 100 with counts.
- **REST:** `POST …/imports?dryRun=true` and `PUT …/models/by-key/{key}?dryRun=true` answer the
  import result plus `impact`; `GET …/models/{m}/deletion-impact` runs the same function with the
  model removed. Permission `read`: a dry run writes nothing and takes no project lock, so the
  skill can run it with the consultant's credential or a read-only token (§3.1).
- **Limits:** one dry run covers one request (≤ 50 files, 25 MB). A larger bundle gets one dry run
  per batch, each against the head; a call from batch 1 into batch 2 shows as `unresolved-call`
  in batch 1's preview, and the CLI says so. Multi-batch imports are not atomic today either; a
  staged import with an exact preview is a later candidate (§6).
- **M5:** `impact_of` reuses the relation-graph part (what depends on a process).

### 3.6 CLI ergonomics

| Need | Today (`apps/cli/src`) | M6 |
|---|---|---|
| Which files count | `.bpmn`, `.bpmn2`, `.bpmn20.xml` (`files.ts` `BPMN_FILE`); the web (`apps/web/src/lib/upload.ts` `BPMN_SUFFIXES`) and the server's key derivation (`domain/paths.ts`) also know `.xml`; the CLI skips hidden directories but not hidden files (`._x.bpmn`), the web skips both | S1: one shared rule in `@analyzr/contracts` |
| Same key twice | the server refuses it within one request; across batches the second file silently revises the first | S1: refused locally before sending (a plain `.xml` that loses its key to a `.bpmn…` file: skipped, "S1 as delivered") |
| Extractor warnings | dropped | S1: in import and PUT results, printed |
| What happened next | per-file outcome only | S1: tasks waiting in the project and the next agent step |
| Models | no verb; REST has list, delete and requeue | S1: `analyzr models list\|delete\|requeue` |
| Provenance, keys | none | S2: `analyzr-import.json` read from the import root |
| Preview | `value-chain push --dry-run`, `rules preview`, `rules apply --dry-run` and `rules revoke --dry-run`; nothing for models | S2: `import --dry-run`, deletion impact in `models delete` |
| Open questions | none | S4: `analyzr questions`; S5a: `analyzr questions answer` (also `--from <csv>`) |
| Zip, URL, git sources; adapter hook | none | later (a zip library is a new dependency; the web would need a lazy chunk under the 240 KB entry ceiling, decision 21) |

### 3.7 The second plugin `analyzr-integrate`

One plugin for all interactive, non-pipeline skills (integration, open questions, interviews),
next to the sha-pinned pipeline plugin `plugins/analyzr` (0.3.0), which does not change.

```
plugins/analyzr-integrate/
  .claude-plugin/plugin.json                                  # name analyzr-integrate, own version
  skills/integrate-landscape/SKILL.md                         # S3b
  skills/interview-guide/…, skills/interview-facts/…          # S6
  reference/{signavio,aris,visio,adonis,bizagi,images}.md     # S3b, S3c
  scripts/inspect.mjs, scripts/normalize-bpmn.mjs             # S3b
  scripts/analyzr-spec.mjs (renderer, §3.9), scripts/analyzr.mjs (CLI)   # S3c
  scripts/transcript-prep.mjs                                 # S6
```

- **Script sources.** One private workspace package `tools/integrate` (`@analyzr/integrate`,
  imported by nothing in `apps/` or `packages/`; principle 7: §10.8) holds the sources and tests
  of every script. One generate script bundles each entry into a self-contained
  `plugins/analyzr-integrate/scripts/*.mjs` (a marketplace install has no `node_modules`),
  checked by one drift test, with the bundled licences in the plugin's notices (exact versions,
  `pnpm notices`). `normalize-bpmn` parses and writes through bpmn-moddle, as
  `packages/bpmn-facts/src/moddle.ts` reads it: UTF-16 to UTF-8; invalid or duplicate ids
  rewritten by §3.4 rule 2, each rewrite also updating `sourceRef`, `targetRef`, `default`,
  `attachedToRef`, `messageRef`, `processRef` and the DI's `bpmnElement`, with `id-rewritten`
  losses; missing DI reported as a loss. Its tests extract every output with `@analyzr/bpmn-facts`
  and expect no `missing-id`, `invalid-id` or `duplicate-id` warning and no `parse-warning` naming
  an illegal or duplicate id.
- **Skill texts.** In S3b `SKILL.md` is written directly in the plugin, in English; Codex reads
  the same file by path (`examples/agents/codex/README.md` says where). The skills are unversioned
  (no `RELEASED` pin); the plugin version moves with every change, so Git-hosted installs update.
  With S6, whose interview guide is useful without a shell, the texts move to one source in
  `packages/procedures/prompts/` (CONCEPT §7: interactive prompts `listProcedures` never reads),
  rendered by a new `packages/procedures/src/interactive.ts` (not `wrappers.ts`, whose changes
  would touch the released skills) into the plugin and into German start prompts
  `examples/agents/claude-desktop/start-prompt-<skill>.de.md`, with a drift test. Serving them as
  MCP prompts waits for the end of the live runs (the `prompts/list` snapshot,
  `apps/server/test/integration/__snapshots__/mcp-prompts.json`).
- **Marketplace.** `.claude-plugin/marketplace.json` lists the second plugin;
  `packages/procedures/test/plugin.test.ts` pins that file with `toEqual` and one plugin, so the
  test changes; `RELEASED` and `PLUGIN_RELEASES` stay untouched.
- **Language.** Skill texts in English like the procedures; everything they say to the consultant
  in German, „du“ and „…“ (AGENTS.md).

**Workspace.** One per customer, outside the checkout:

```
<workspace>/
  analyzr-workspace.json              # project key and name, ANALYZR_URL, the CLI form, source systems
  exports/<YYYY-MM-DD>-<system>/      # the customer's files, untouched
  converters/                         # ad-hoc converters (adhoc:<sha>), S3c
  keymap.json                         # (system, externalId) → key, the key rule and scope per system
  bundles/<YYYY-MM-DD>-<system>/      # the bundles (§3.2)
  reports/<YYYY-MM-DD>-<system>.md    # the German reports
```

**Reaching analyzr.** The skill runs outside the checkout, and no documented setup puts an
`analyzr` command on the host: the CLI is `pnpm analyzr` in a checkout or `analyzr` in the
container, the container sees no workspace (`docker/compose.yaml` mounts only the state volume),
and a host CLI against the Docker server needs the owner key copied out of the volume
(`ANALYZR_OWNER_KEY_FILE`, DEVELOPMENT.md "The `analyzr` CLI"). So the skill checks
`$ANALYZR_URL/health` first (default `http://127.0.0.1:7400`) and picks the import path, recorded
in `analyzr-workspace.json`:

1. `ANALYZR_CLI`, if set (for example `pnpm -C ~/Code/analyzr analyzr`);
2. else `pnpm -C <checkout> analyzr` if the consultant names a checkout; the skill passes absolute
   paths;
3. else the web: the models through „Hochladen“ with the bundle folder (with manifest and
   „Vorschau“ from S2), the chain through the `.vc.json` import on the chain page (both exist
   today).

The report always gives the command and the web path. In S3c the generate script also bundles
`apps/cli` into `plugins/analyzr-integrate/scripts/analyzr.mjs` (self-contained, drift test), so
`node "$CLAUDE_PLUGIN_ROOT/scripts/analyzr.mjs" import …` works anywhere with Node 24.

**`/analyzr-integrate:integrate-landscape <export> [--workspace <dir>]`** (`disable-model-invocation:
true`; Claude Code and Codex, since it needs a shell). The project comes from
`analyzr-workspace.json`; on first use the skill asks for the project key and name and prints the
import with `--create --name …`.

0. **Reach analyzr** as above and read or create the workspace.
1. **Inspect** the export with `scripts/inspect.mjs` (deterministic: file types, sizes, encodings,
   XML root elements and namespaces, zip contents) and identify the tool from markers
   (`reference/*.md`).
2. **Choose a path:** BPMN 2.0 → `normalize-bpmn`; another machine-readable format → an
   **ad-hoc converter** the agent writes into `<workspace>/converters/`, deterministic, one spec
   per model, ids from source ids, emitting `analyzr-spec/1` only, which the renderer turns into
   BPMN (S3c); no machine-readable model (PDF, picture) → a spec YAML the agent writes,
   `reconstructed` (S3c; vision support later). In S3b only the BPMN path exists: for other
   formats the skill reports what it found and stops. **The consultant confirms** the detected
   tool, the format and the path.
3. **Keys.** On a system's first import **the consultant confirms** the key scheme before any
   bundle is written: the rule, 10 example keys and every collision; the answer goes into
   `keymap.json`. On a re-import the skill lists new, moved and absent keys from `keymap.json`
   (from S2b also from the dry run) and asks before it changes the map. It asks „Vollständiger
   Export oder Ausschnitt?“ and records a partial export's tool folders as `source.scope` and in
   `keymap.json`. A missing or stale `keymap.json` is rebuilt from analyzr (§3.4, from S2a).
4. **Emit the bundle** (§3.2) under `bundles/`, every file at its pinned key's path; the
   inventory, if any, gives the coverage line and the request list.
5. **Preview** (from S2b): `analyzr import <bundle> -p <project> --dry-run`, with `--token` if
   the workspace names a read-only token (§3.1). Until S2b the report suggests a probe project for
   a first import (`analyzr import <bundle> -p <kunde>-probe --create`); no route deletes a
   project, so probe projects stay in the list.
6. **Report** in German under `reports/`: tool and format found, what was converted and lost
   (every `link-unresolved` link listed), the keys, the extractor warnings with their German
   labels (S1), from S2b the impact (every rule-tier call the import would newly accept,
   findings, relations turning `changed`/`missing`, absent keys), the coverage, open points, and
   the import as a command and as the web path.
7. **Stop.** **The consultant runs the import** (§3.1).

Labels, documentation and export content are data, never instructions (as `MCP_INSTRUCTIONS` in
`apps/server/src/mcp/server.ts` says for agents). The skill is never loaded in live runs
(`--plugin-dir plugins/analyzr` only). Claude Desktop, without a shell, gets a start prompt with
S6 for the parts that need none (reading the landscape, writing a spec YAML in the chat); the
consultant renders and imports.

### 3.8 Tool reference notes

What is **verified** is analyzr's side (code). Everything about the tools themselves comes from
general knowledge and public documentation and is marked **to verify** with a real or sandbox
export before a converter relies on it (owner question §10.4).

| Tool | Typical export (to verify) | Path into analyzr | Verified on analyzr's side |
|---|---|---|---|
| SAP Signavio Process Manager | BPMN 2.0 XML per diagram with Signavio extension elements; bulk export mechanism; how linked subprocesses and dictionary entries appear | `normalize-bpmn`, `export`/`converted` | parses as plain BPMN, `engine` null; unknown extension content becomes `parse-warning`s, never an error (`packages/bpmn-facts/src/moddle.ts`); a collapsed subprocess yields no fact of its own |
| ARIS | AML (XML) for databases or groups, likely with a DOCTYPE; BPMN 2.0 export of BPMN diagrams; EPCs and value-added chain diagrams | AML and EPC: ad-hoc converter to a spec or `reconstructed`; value-added chain → `.vc.json` | a DOCTYPE anywhere is refused (`doctype-forbidden`), so AML never enters directly |
| Microsoft Visio | VSDX, an OPC zip of XML parts; what the BPMN stencil stores per shape; off-page references | ad-hoc converter to a spec, or `reconstructed` for plain flowcharts | not BPMN, refused (`not-xml`/`not-bpmn`); the model view needs BPMN DI (`apps/web/src/components/bpmn-canvas.tsx` imports with bpmn-js), so a converter must produce layout |
| BOC ADONIS | ADOxx XML; a BPMN 2.0 export | BPMN path if available, else ad hoc | as for any BPMN |
| Bizagi Modeler | `.bpm` package; a BPMN 2.0 export | BPMN path | as for any BPMN |
| Camunda Modeler, Web Modeler | BPMN 2.0 with Camunda extensions | direct import (works today) | `engine` c7/c8 detected |
| PDF, screenshots, slides | images | later: vision into a spec, `reconstructed` | |

Each `reference/<tool>.md` has the sections "Export paths", "What arrives", "Pitfalls", "Mapping
to analyzr" and a status line ("unverified: based on public documentation" until a sandbox
export confirms it).

### 3.9 Spec YAML and the deterministic renderer

The only thing an LLM writes for BPMN is a spec YAML, directly or through an ad-hoc converter;
code renders the BPMN with DI. The eval generator (`eval/tools/SPEC.md`,
`eval/tools/lib/{schema,model,layout,bpmn}.mjs`) is the precedent but requires `engine: c7|c8`
and must stay byte-identical (`validate.mjs` compares the corpus with a fresh generation), so it
is not reused in place.

- **`analyzr-spec/1`**: one file per model: `key`, `name`, `derived`, processes with lanes,
  nodes (`start`, `end`, `task`, `subprocess` collapsed, `call`, `event` with `none`, `message`,
  `signal` or `timer`), sequence flows, documentation, a `source` id per element (ids derive from
  it, §3.4), black-box participants and message flows. No engine: the output has
  `isExecutable="false"` and no Camunda namespace, so `engine` is null.
- **Calls:** until the owner decides §3.10, a `calledElement` reaches analyzr only from the tool
  itself (`export`, and `normalize-bpmn`, which passes the tool's calls through) and from specs of
  converters bundled with the plugin (`<name>@<version>`). For specs of `adhoc:` converters and
  for `reconstructed` and `as-told` specs, the renderer writes a collapsed subprocess named after
  the target plus a `link-unresolved` loss, and the report lists these links for the consultant.
  Ad-hoc converters emit specs only, so the rule applies to them; one that wrote BPMN directly
  would bypass it, which the report's list of newly accepted calls (from S2b) shows. This limits,
  without changing decision 9, how often decision 9 accepts a call that LLM-written code produced;
  it is revisited with S2c and its decision-19 extension per converter.
- **Where:** an entry of `tools/integrate` (§3.7), bundled into
  `plugins/analyzr-integrate/scripts/analyzr-spec.mjs`. It may start from a copy of the eval
  layouter; one package shared with the eval generator needs a principle-7 exception and waits
  until the renderer has proven itself.
- **Checks:** the renderer's tests extract every rendered fixture with `@analyzr/bpmn-facts`
  (no warnings) and import it with bpmn-js (no import warnings; a Playwright check like M4 S3's
  import harness for chains).

### 3.10 Trust policy (decision 24.2)

**The problem.** Decision 9 accepts a static `calledElement` that matches exactly one process id
at ingest, without review (`packages/relations/src/rules.ts` `callRules`, tier `rule`). That is
right for a call a human modelled in an executable Camunda model. It is wrong for a call an LLM
reconstructed from a picture or an interview, a converter guessed, or an agent uploaded: such a
model creates accepted relations on upload that no human ever saw.

**The rule** (recommended by the agent, agreed by the owner 2026-10-15). A revision is **modelled** when its `engine` is `c7` or `c8`, its `uploader`
is `human` and its declared `derived.kind` is absent or `export`; otherwise **derived**. Every
signal is computed or authenticated by the server; declarations can only lower trust. The server
authenticates the credential, not the person using it: `uploader: human` means the owner key or
the web session, which any process of the consultant's OS user can use (§3.1). A unique static
call from a derived revision becomes a **proposal** (tier `key`, confidence 0.9, a German
rationale naming the reason) instead of an acceptance; findings are unchanged. Consequences:

- Camunda landscapes imported with the owner key or the web behave exactly as today, and so do
  the eval corpus, `eval:candidates`, the seeds and the owner's live runs (every corpus model is
  c7 or c8, HANDOFF §5).
- **Revisions stored before S2c.** Recompute re-derives the rule tier's assertions on every
  ingest or delete, from the head facts of old revisions too (`recompute.ts`). A rule that read
  `engine` alone would, at the first ingest after S2c, turn the accepted unique calls of every
  engine-null revision already stored into proposals, including the customer landscapes
  imported between S2a and S2c. So S2c stores the class at ingest (`source.trust`), and the rule
  tier reads it. For revisions without it the owner chooses (§10.1): (a) they count as modelled
  and keep their rule-tier acceptances, which are listed once under „Vor der Vertrauensregel
  angenommen“ for a bulk revocation; or (b) they are classified from what they carry (a missing
  `uploader` counts as human, `engine` null still makes them derived), and their calls turn into
  proposals at the next ingest, previewed with `importImpact` before S2c is switched on.
  Recommendation: (a).
- Signavio, ARIS or interview models get their calls as proposals, accepted in bulk per tier
  (the existing bulk dialog) or one by one. The read-only system rule „Eindeutige Aufrufe“ says
  so.
- An owner's auto-accept rule (decision 19) never accepts a rule-tier proposal today (`not-agent`,
  `apps/server/src/domain/auto-accept/evaluate.ts`). The recommendation includes extending
  decision-19 rules to rule-tier call proposals of derived revisions, narrowed by derived kind
  and converter, so a trusted converter's calls can be accepted without a click. Decision 19's
  agreed design names kind, tier, minimum confidence and optionally an agent or a model, and
  CONCEPT §11 defers further narrowing, so that extension is part of the owner's answer.

The owner agreed with option (a) for older revisions and with the decision-19 extension
(decision 24.2). It ships as S2c; until then §3.9's renderer rule and the
consultant-runs-the-import rule limit the risk.

### 3.11 `eval:descriptive`: measure the loss first

The corpus is executable Camunda only: in `nordwind-handel` no file has `isExecutable="false"` or
a data object. Customer exports are mostly descriptive. Before converters and facts v2 get real
effort, an LLM-free eval measures how much of the relation finding survives tool-style models:

| Variant (deterministic byte transform of the dev models) | Models what |
|---|---|
| `engine-stripped` | Camunda namespaces and `executionPlatform` removed: `engine` null (the trust policy's cost) |
| `descriptive` | plus `isExecutable="false"`, call activities as collapsed subprocesses named after the callee, messages without `messageRef` (names only on labels) |
| `pools` | plus inter-model message events replaced by tasks with message flows to a black-box pool named after the partner |
| `no-docs` | plus documentation removed |

Measured per variant and type: `must_link` coverage among rule tier ∪ candidates (the
`eval:candidates` metric), rule-tier acceptances and their precision, candidate volume and
estimated claim size against the 100 KB budget, findings. `pnpm eval:descriptive` in
`eval/tools`, report `eval/reports/descriptive.{md,json}` with the CI drift check like the other
reports, report-only (no threshold). Tooling may transform the holdout's model files; the report
shows the holdout in aggregate only, nothing over fewer than 5 items, and whoever writes the
transforms never opens the holdout's `expected.yaml`, `README.md` or `spec/`. The variants model
tool behaviour that is itself to verify (§3.8). S3a also records the size of `get_landscape` per
model on the seeded `nordwind-handel` and states the v1 limit in §6.

**Results (S3a, 2026-10-15, `eval/reports/descriptive.md`).** Delivered as five variants: `pools`
keeps every element and adds the message flows, and a separate `tasks` turns the exchange events
into tasks (§8 "S3a as delivered"). On `nordwind-handel` (31 models; 42 must_link: 9 call, 25
message, 6 signal, 2 trigger), each variant on top of the previous one:

| Variant | must_link in rules ∪ candidates | in rules ∪ key/lexical | in rule tier | rule-tier accepted (precision; under 24.2) | candidates | claim input mean / max | dangling-throw / unmatched-catch |
|---|---|---|---|---|---|---|---|
| baseline | 42/42 | 42/42 | 37/42 | 9 (100 %; 9) | 1806 | 40.8 / 80.1 KB | 5 / 4 |
| `engine-stripped` | 42/42 | 42/42 | 37/42 | 9 (100 %; 0) | 1806 | 40.8 / 80.1 KB | 5 / 4 |
| `descriptive` | 33/42 | 31/42 | 0/42 | 0 | 1670 | 35.6 / 61.1 KB | 25 / 29 |
| `pools` | 33/42 | 31/42 | 0/42 | 0 | 1670 | 35.7 / 61.2 KB | 2 / 6 |
| `tasks` | 9/42 | 9/42 | 0/42 | 0 | 989 | 24.6 / 43.5 KB | 2 / 6 |
| `no-docs` | 9/42 | 9/42 | 0/42 | 0 | 989 | 21.6 / 39.7 KB | 2 / 6 |

By type: calls 9/9, then 0/9 from `descriptive` on (a collapsed subprocess yields no fact);
messages 25/25 through `pools` (23/25 within key/lexical, 0/25 in the rule tier), 1/25 from
`tasks` on (a task with a message flow is no endpoint in facts v1); signals 6/6 and triggers 2/2
in every variant, the signals through lexical candidates once `descriptive` strips `signalRef`. No
claim input exceeds 100 KB, and no variant draws an extractor warning. The holdout (26 models, 40
must_link; aggregate only) moves the same way: 40/40 in baseline and `engine-stripped`, 12/40 from
`tasks` on (its `descriptive` and `pools` coverage is hidden by the redaction), no rule-tier
acceptance under 24.2 once the engine is gone, claim input max 74.9 → 43.3 KB. What it means:

- `engine-stripped` costs nothing today; under the trust policy (S2c) every rule-tier acceptance
  of such a model becomes a proposal.
- `descriptive` loses every call and the whole key tier: agents have to find every message and
  signal link themselves, and the dangling/unmatched findings jump from 9 to 54.
- `pools` keeps the coverage, but its message flows answer the throws and catches, so those
  findings vanish, the expected ones too: the gap list (S4) loses that signal on such models.
- `tasks` loses almost every message link (25 → 1).
- Documentation only shrinks the claim input.

That makes the case for facts v2 (§6: collapsed subprocesses as call endpoints, task-to-pool
messages, black-box participants) and for the guidance for descriptive models in S7 (decision
24.4). Found along the way: without an engine, facts v1 treats only a JUEL `calledElement` as
dynamic, so a C8 FEEL target (`=expr`) moved into `calledElement` counts as static
(`engine-stripped`: `dynamic-call` 2 → 1, `unresolved-call` 2 → 3); `descriptive.test.ts` pins it
until a facts version fixes it. The `get_landscape` size and the v1 limit are in §6.

## 4. Part B: Gap analysis

### 4.1 Sources that exist today

| Source | Content | Where | In the web today |
|---|---|---|---|
| Relation findings | `unresolved-call`, `dynamic-call`, `duplicate-process-id`, `dangling-throw`, `unmatched-catch` (German `detail`) | `packages/relations/src/rules.ts`, `apps/server/src/domain/findings.ts` `visibleFindings` | tab „Befunde“, model view |
| Value chain findings | `process-without-step` (with `state`, `calledFrom`), `step-without-process`, `unresolved-link` | `apps/server/src/domain/value-chain/findings.ts` | chain page |
| Holds | human note plus optional question and label (decision 10), relations and placements | `use-cases/review.ts`, `placements.ts` | held list; the label cannot be filtered |
| Agent questions | `question` (≤ 500) on proposals, required at confidence 0.3–0.7 when the answer lies outside the models | `packages/procedures/relations.md` §9, `placements.md` §9 | review queue and details |
| Unsure placements | `unsure` verdict with a free German reason | `placement_input`, `ValueChainDetail.unsure` | „Agent unsicher“ |
| Coded no-links | `call-target`, `collaboration` carry gap information; `no-evidence` mixes "nothing connects" and "information missing" | `relations.md` §11, `GET …/no-links` | inbox tab „Kein Zusammenhang“ |
| Submission summary, uncovered pairs | free text ≤ 500 naming suspected modelling gaps and dead ends; up to 50 unjudged pairs | `GET …/analyses/{a}/submission` | none (REST only, M3-RELATIONS-PROCEDURE.md question 1) |
| Extractor warnings | skipped elements, unresolved message flows, bpmn-moddle `parse-warning`s | `ExtractResult.warnings` | none (S1: import results; S2: stored) |

### 4.2 The open-questions read model

Computed on read from the sources above plus §4.3, never stored, deterministic. One item:

```ts
OpenQuestion {
  id: string                 // `q-` + 16 hex of sha256(kind | subject | source version)
  kind: OpenQuestionKind     // own enum, §4.3
  source: 'finding' | 'value-chain-finding' | 'hold' | 'agent-question' | 'unsure' | 'no-link'
        | 'summary' | 'unjudged' | 'signal'
  subject: { type: 'ref' | 'process' | 'model' | 'relation' | 'placement' | 'step', id: string }
  modelKeys: string[]        // for filters
  text: string               // German: from code for findings and signals, verbatim (plain text) for human and agent texts
  askWho: { lanes: string[], stepOwner: string | null, folder: string | null }
  unlocks: number            // open decisions touching the subject
  refs: Ref[]                // links for the reviewer
  raisedBy: { sourceKind: 'rule' | 'agent' | 'human', handle: string | null, seq: number }
  state: 'open' | 'answered' // S5a
}
```

- **Id:** the source version is the head `facts_hash` of the subject's model for findings and
  signals, the assertion id for questions and holds, the placement input hash for unsure
  verdicts, the submission id for summaries. When the source changes, the id changes, and an
  answered item comes back open.
- **`unlocks`:** for a ref, the unjudged or non-current candidate pairs of tiers `rule`, `key`
  and `lexical` and the proposed or held relations touching it, at least 1; for a process, plus
  its open placement; for a model, the sum over its endpoints. It ranks, it predicts nothing.
- **`askWho`:** the lanes containing the subject (lane facts, `extract.ts` `lanes`), the owner of
  the top-level step the process is accepted on (org units own top-level steps, decision 18;
  used as a UI hint, never as agent evidence) and the model key's first folder. A hint, no
  assignee (decision 10).
- **Stage:** open questions never change a model's or the chain's stage; `waiting_for_clarification`
  stays driven by human holds (decision 8).

### 4.3 Deterministic gap signals

Their own enum, not `FindingKind`: `FindingKind` is part of the claim input, the MCP
`get_landscape` output and `eval:candidates`' `expected_findings` scoring
(`eval/tools/src/score.ts`), all frozen for the live runs. `OpenQuestionKind` covers the mapped
sources (`call-target-unknown`, `call-target-dynamic`, `duplicate-process-id`,
`message-partner-missing`, `held`, `agent-question`, `placement-unsure`, `process-without-step`,
`step-without-process`, `unresolved-link`, `external-partner`, `summary-note`, `unjudged`) and
these new signals, computed from head facts:

| Signal | Rule | Question it asks |
|---|---|---|
| `black-box-partner` | a message flow (`MessageFlowInfo.from/to`) ends at a participant that no process fact names as its `attrs.participantId` | external partner or a missing model? (the participant's name needs facts v2; S4 shows its id) |
| `unlabelled-boundary` | a process whose none start or none end events have no label | what starts or ends it? (trigger relations need labelled none events) |
| `message-without-name` | a message event without a `messageRef` name | which message? (no key-tier pairing possible) |
| `undocumented-process` | a process fact without documentation | what does it do? (agents' main evidence for placements) |
| `isolated-process` | no relation in any status and no `rule`, `key` or `lexical` candidate | how does it connect to the rest? |
| `descriptive-model` | `engine` null and every process non-executable | informational: the rule tier finds little here |
| `extractor-loss` (S2) | the revision's stored extractor warnings (S2) with the codes `missing-id`, `invalid-id` or `duplicate-id`, or a `parse-warning` whose message matches `unparsable content\|duplicate ID\|illegal ID` (bpmn-moddle drops a second element with the same id and reports it only as a `parse-warning`, „duplicate ID <…>“; a non-NCName id arrives as „illegal ID <…>“ followed by `missing-id`) | which elements were lost on import? |

Every signal is validated on `nordwind-handel` (dev) in tests before it ships; noisy ones stay
off. `extractor-loss` is validated on synthetic fixtures, since every corpus model extracts
without a warning, and ships with S2, which stores the warnings.

### 4.4 Web tab „Offene Fragen“, CLI and export

- **REST** (contracts first, tag `open-questions`): `GET /projects/{p}/open-questions` (filters
  `modelKey`, `kind`, `source`, `askWho`, `state`; cursor pages) and `GET
  /projects/{p}/open-questions/export?format=markdown|csv` with the same filters (German
  headings, grouped by `askWho`, rendered by a pure domain function). Permission `read`, so
  viewers and the read-only demo see them. The CSV has the columns `id`, `Art`, `Frage`,
  `Ansprechpartner-Hinweis`, `Antwort` and `Antwortart`, the last two empty (`Antwortart` one of
  „Antwort“, „Liegt außerhalb der Landschaft“, „Wird im Modell ergänzt“), so the customer can fill
  in the sheet and S5a reads it back.
- **Web:** the tab „Offene Fragen“ after „Befunde“ with its count, filters (Art, Modell oder
  Ordner, Ansprechpartner-Hinweis, Quelle, Status), sorted by `unlocks`; a section „Offene
  Fragen“ in the model view; buttons „Als Markdown exportieren“ and „Als CSV exportieren“. Agent
  and human texts render with the existing `PlainText` component. The page is a lazy route chunk
  (entry ceiling, decision 21).
- **CLI:** `analyzr questions -p <project> [--model <key>] [--kind …] [--format md|csv|json]
  [-o <file>]`.
- **Summaries** (`summary-note`) are shown only if the owner reverses the resolution of
  M3-RELATIONS-PROCEDURE.md question 1 (§10.2); without it S4 leaves them out.
- **MCP** `list_open_questions` (read) comes with S7, after the live runs.

### 4.5 Answering in the UI, and re-analysis only where the input changed

Answering ships in two slices. **S5a** records and shows answers and changes no analysis rule,
so it is live-run neutral and comes right after S4. **S5b** makes answers re-open exactly the
affected judgements; it touches the judge-once core and recorded rules (§10.5).

**S5a: answers recorded.** The consultant answers each item with „Beantworten“ in the tab or the
model view (also `POST /projects/{p}/open-questions/{q}/answers` and `analyzr questions answer
<id>`; permission `review`, humans only). The dialog takes a text (≤ 2,000, with the hint „Keine
Namen oder anderen personenbezogenen Daten“) and one of „Antwort“, „Liegt außerhalb der
Landschaft“ and „Wird im Modell ergänzt“, and says „Die Agenten berücksichtigen die Antwort,
sobald das Paar neu bewertet wird“. A deterministic check (e-mail, phone and IBAN patterns, the
same as S7's guard) warns in the dialog and never blocks. Every answer is one row in a new
append-only table `open_question_answer(id, project_id, question_id, subject_type, subject_id,
kind, text, note_assertion_id, principal_id, source_kind, seq)`, `check(source_kind = 'human')`,
with exactly one of `text` and `note_assertion_id`; an item is `answered` while a row for its id
exists. Where the text lands:

| Subject | Text stored as | Effect in S5a | Added by S5b |
|---|---|---|---|
| relation (held, or proposed with an agent question) | a human note through the existing `addRelationNote` use case (existing claim input field `notes`) | as any note today: shown to the next claim of either model; blocks auto-accept rules on the pair | the pair's agent judgements stop being current and the origin model of each is queued in the same transaction |
| placement | a human note through the existing placement note use case | as today: the process becomes due (`lastNonAgentSeqs`); nothing is queued | the placement task is queued in the same transaction (`queuePlacementTasks`) instead of waiting for a submit, an ingest or `analyzr value-chain requeue` |
| anything else (findings, signals, unsure verdicts, no-links without a relation, summaries) | `text` in the row | shown and exported; the dialog points at the path that works today: change the model's documentation and re-import (a new `facts_hash` re-queues the model) | reaches agents only with S7 (an optional `answers` field in both claim inputs, counted in the bases below) |

**Bulk answers (S5a).** `analyzr questions answer -p <project> --from antworten.csv [--dry-run]`
and, in the web, „Antworten aus CSV übernehmen“ with a preview read the CSV the export wrote
(§4.4) and send the filled rows to `POST /projects/{p}/open-questions/answers` (`dryRun=true`
previews). Rows with an empty `Antwort` are ignored; unknown ids, including those whose source
changed since the export (which changes the id), are listed and never stored; each answer has at
most 2,000 characters; the personal-data hint shows once. Same use case as single answers, one
transaction per file.

**The relations basis (S5b, decision 17).** A judgement today is current while both endpoint
models' `facts_hash` equal the heads and the procedure is the one claims name (`judgements.ts`
`isCurrent`). S5b adds the human input to the basis the way placements fold it into their input
hash (`lastNonAgentSeqs`), per pair instead of per process: the pair's human input is the highest
`seq` of a human note on its relation, and a judgement is current only while that `seq` is not
above the `claimedSeq` of the task whose submission made the judgement (`analysis_task.claimed_seq`,
"the project state the claim input shows"; reached through the judgement's `submission_id`), so
the agent saw every note that counts. No new column, no change to append-only rows. As for
`lastNonAgentSeqs`:

- only human notes count, never agent activity, never an auto-acceptance or its revocation, never
  a note on an obsolete relation; decisions do not count (accept and reject settle the pair; a
  hold is confirmed by agents anyway);
- the pair is judged again because its input changed, as after a `facts_hash` change; the other
  pairs of both models stay `judged`, so the re-queued task assigns essentially that one pair;
- ad-hoc relation proposals have no claim and stay outside judge-once, as today (HANDOFF §8
  "Ad-hoc verdicts");
- answer notes block auto-accept rules on the pair (decision 19 safeguards), so the answer never
  triggers an unreviewed acceptance; if the owner lets plain notes through (HANDOFF §8
  "Auto-accept: notes block"), answer notes keep blocking, and `open_question_answer`'s
  `note_assertion_id` lets the safeguard tell them apart;
- the hold stays in force: an agent's confirmation of a held pair is recorded as its judgement
  and the human still decides;
- at deploy a one-time step queues the origin models of every pair the new basis makes
  non-current (notes recorded under S5a or earlier), since nothing else would queue them.

**Recorded rules.** S5b widens the relations judgement basis by the pair's last human note and
lets notes queue relations and placement tasks. That amends CONCEPT §2 (a judgement's basis is
"the `facts_hash` of both endpoint models … plus the declared procedure"), §3 („Human decisions
and notes make processes due but queue nothing; a reviewer queues the task“), §11 ("judging each
pair once per change of its models") and HANDOFF "Taken during M3" and "Taken during M4 S5", so
it is an owner decision (§10.5), not one this concept takes.

**Live runs.** Live runs use fresh projects without human notes (M3-LIVE-RUNS.md). S5a uses the
existing note use cases and new storage only, so it may land before the live runs. S5b changes
nothing in fresh live-run projects either (a golden test pins byte-identical claims for seeded
projects without notes; the sim recordings and `eval:replay` stay unchanged), but it touches the
judge-once core, so it lands after the owner's live runs unless the owner says otherwise.

### 4.6 The agent part, after the live runs (S7)

One batched release with one live-gate round (decision 13): every release offers every pair and
every open process again, because the judgement bases include the procedure.

- **`analyzr-relations@0.3.0`:** a no-link code `missing-info: <the missing fact>` separate from
  `no-evidence`; an optional `gaps` field in the submission (≤ 20 items `{subject, kind, text ≤
  300}`, subject a head ref, process ref or the task's model key, kinds `missing-partner`,
  `unknown-trigger`, `unknown-call-target`, `external-party-unclear`, `missing-documentation`,
  `ambiguous-name`, `possible-duplicate`, `other`), stored verbatim with the submission and read
  by the open-questions view from current submissions; guidance for descriptive models; the
  revision's declared `derived.kind` (S2a provenance, not the trust class, which exists only if
  the owner amends decision 9) and `isExecutable` in the claim input (optional fields in
  `analyzr-claim/1`).
- **`analyzr-placements@0.2.0`:** unsure kinds `no-fitting-step` (with an optional
  `suggestedStep` name: a chain gap the human may draw), `process-unclear`, `several-steps`; the
  same `gaps` field.
- **Claim inputs** gain S5a's subject answers; their `seq` joins the relations basis (pairs
  touching the subject) and `lastNonAgentSeqs` (the subject's processes), the latter as
  `analyzr-placement-input/2`.
- **MCP** `list_open_questions`; the interview skills' texts as MCP prompts.
- **Personal-data guard** on agent free text (e-mail, phone, IBAN patterns, as S5a checks human
  answers), warning-only at first, calibrated on the corpus.
- **Gate:** the existing live gates per landscape and model, plus §4.7.

### 4.7 Eval `nordwind-gaps`

A dev-only derived landscape with deliberately removed information, generated deterministically
from `nordwind-handel`'s models by `eval/tools` into `eval/gaps/nordwind/` (not `eval/corpus`, so
`analyzr seed`, `eval:candidates` and the demo stay as they are): documentation removed from
chosen processes, message names dropped, call targets emptied, partner processes deleted behind
black-box pools, start labels removed. `expected-gaps.yaml` lists per removal the subject, the
gap kind an agent should report and the pairs that lose their evidence. Scored by `eval:replay`:
planted gaps reported (a `gaps` item or a `missing-info` no-link on the subject), false gap rate
and `missing-info` share on the complete `nordwind-handel` (overuse), recall drop. Thresholds come
from a first dev run and the owner confirms them. The simulation agent gets a deterministic gap
policy (`sim-policy-1` extended) so recordings exist before any LLM run. No holdout variant
until a third landscape or owner-authored data exists.

## 5. Part C: Interviews

Skills in `analyzr-integrate`, nothing new in analyzr's core:

1. **Interview guide** (`interview-guide`): reads the open questions (REST export now, MCP after
   S7), groups them by `askWho`, orders by `unlocks`, adds per question what the landscape
   already says (refs) and keeps the question ids, so answers map back. Output Markdown. Address
   form for customer employees: §10.3.
2. **Transcript pre-processor** (`scripts/transcript-prep.mjs`, deterministic, local): VTT or
   plain-text transcripts (formats to verify, e.g. speaker tags in Teams VTT) → segments with ids
   `T1…Tn`, speakers replaced by roles from a mapping the consultant provides, masking of
   e-mail addresses, phone numbers, IBANs and the names on the mapping list. The mapping stays in
   the workspace.
3. **As-told fact sheet** (`interview-facts`): per process trigger, steps, outcomes, handovers,
   systems and open points, every statement citing `src:<sourceId>#T<n>`; contradictions with
   the landscape (read over MCP) flagged; answers to guide questions listed by question id for
   the consultant to enter with „Beantworten“ or the CSV (S5a). Nothing is written to analyzr.
4. **BPMN draft:** the skill writes an `analyzr-spec/1` from the fact sheet, renders it (§3.9,
   no `calledElement` for `as-told`), emits a bundle with `derived {kind: as-told, llmModel,
   from: [src ids]}`, runs the dry run; the consultant imports it. When the real model arrives
   later, its manifest pins the same key, so the as-told draft becomes revision 1 of that model.

Transcripts and excerpts never enter analyzr, the repository or the eval corpus; analyzr sees
opaque source ids only, and the fields analyzr adds itself aim to hold no transcript text or
personal data. Models and free texts can still contain personal data (§7 "Privacy"). Sending
exports and transcripts to the operator's LLM vendor is accepted for now (decision 24.5). An
interview eval corpus (synthetic, `nordwind-handel` only) and an interview-informed value chain
draft (after the owner's rated draft run, M4b) are later work.

## 6. Later candidates

| Candidate | Why, and when |
|---|---|
| Paged landscape digest (`get_landscape_digest`, CONCEPT §5's `landscape.json` resource) | `get_landscape` takes only `projectId` and returns the whole head unpaged, and `draft_value_chain` reads it; a 200–300-model customer landscape may not fit an agent's context. **S3a measured it** on `nordwind-handel` (31 models; `apps/server/test/integration/landscape-size.test.ts`, the text content an agent reads, in UTF-8 bytes): 42.2 KB seeded (1,394 B per model), 71.4 KB after the simulation agent's relations tasks (2,359 B per model; 57 relations, 48 of them resting on agent proposals at about 1.1 KB each with provenance and 273-character rationales: relations dominate); the HTTP response carries the JSON twice (text and `structuredContent`). **v1 limit: 40 models per project for `get_landscape`-based work (`draft_value_chain`), with a warning from 35**: with LLM rationales of about 400 characters a model costs about 2.56 KB, so 40 models fill the ~100 KB a tool page holds (CONCEPT §6); Claude Code's 500,000-character result limit (`MAX_RESULT_SIZE_CHARS`) is reached at about 200 models, and a 200–300-model landscape would be about 470–700 KB. The integrate report warns above the limit and suggests drafting the chain from the customer's process map or by hand in the chain editor (not yet in skill v0, §8 "S3b as delivered"). The digest itself comes after the live runs (the MCP surface is frozen until then), before the first large customer landscape. |
| Duplicate, variant and contradiction detection | exports hold copies (ARIS and Signavio of one process, archived versions, as-told next to modelled); a `possible-variant` signal first, an agent verdict later. After S4 shows real data. |
| Change summary per import, events since seq X | re-imports are routine; reviewers need "what changed since I looked" (CONCEPT §5's `/events` is not in the contracts). Builds on `importImpact`. |
| MCP `get_project_status` | lets a consultant's agent decide what to run next; today only `analyzr status`. After the live runs. |
| Customer assessment report skill | the deliverable of a landscape analysis: coverage, gaps, network, placements, open questions, every statement citing refs. After S4. |
| Inventory-first import | coverage against the customer's catalog from day one, without stub models. Needs a boundary entity: with placeholders. |
| Instruction-like content signal | foreign exports and transcripts widen the injection surface; a cheap deterministic backstop as an extractor warning and gap signal. With S4 or S7. |
| Run size and cost estimate | claim sizes against the 100 KB and 96 KB (`CLAIM_PLACEMENT_MAX_BYTES`) budgets, documentation cut by `CLAIM_DOC_CHARS`, CONCEPT §7's cost per revision. Before the first paid customer run; the follow-up of S2b's impact gives the pair count. |
| Reindex with judgement carry-over, then facts v2 | no reindex exists (`packages/bpmn-facts/src/version.ts` named one until M6 S1); `facts_hash` includes `FACTS_VERSION`, so any fact change re-judges every pair. Carry-over first, then one bump with descriptive facts (collapsed subprocesses, data objects, black-box participants, task-to-pool messages), systems and tool identities. Only if `eval:descriptive` shows a large loss. |
| Placeholders (external parties, phantom processes) | lifts CONCEPT §11's deferral; the computed boundary signals of §4.3 come first. Owner decision. |
| MCP `put_model` or model drafts as proposals | shell-less agents (Claude Desktop) could submit models; only after the trust decision. Owner choice between the two. |
| Vision reconstruction | screenshots, PDFs, slides into a spec, `reconstructed`, one review per diagram. After the renderer and the trust decision. |
| Tool API pullers | Signavio and ARIS APIs, one-way, no prune, customer-tool credentials with the consultant, never in analyzr. When a customer needs repeated syncs. |
| Zip import, staged imports, adapter hook, document store, identity-key rule | each when a real import shows the need. |

## 7. Constraints

- **Live-run comparability (decision 13, HANDOFF §7).** Until the owner's runs of
  `analyzr-relations@0.2.0` and `analyzr-placements@0.1.0` are done, nothing changes the released
  procedures, the claim inputs, proposal and submission validation, the MCP tool and prompt
  surface (21 tools including the two `decide_*` stubs, 3 prompts, no resources;
  `apps/server/test/integration/__snapshots__/mcp-{tools,prompts}.json`), `draft_value_chain`, the
  sim recordings or the committed reports. S1–S4, S5a and S6 keep to it; S5b is neutral but
  waits; S7 comes after.
- **Decision 17.** `facts_hash` includes `FACTS_VERSION`; there is no reindex; every judgement
  basis includes the procedure. Provenance stays out of facts.
- **Principle 7.** Five library packages; the toolkit lives in `plugins/` and `tools/integrate`
  (precedents outside `packages/*`: `tools/notices`, `apps/agent-sim`, `apps/demo`); whether that
  reading holds for product logic shipped to consultants is §10.8.
- **Decision 7.** PostgreSQL is the record; imports are one-way; no prune, no sync, no watch;
  deletions are explicit and human.
- **Decision 9** stays until the owner amends it (§3.10). **Decision 8:** stages are fixed.
  **Decision 10:** no assignee. **Decisions 4 and 5:** agents propose and draft, humans decide, no
  LLM credentials. This concept adds: the consultant runs every import (§3.1; not enforced by the
  policy, which lets any `analyzr:write` token ingest, §10.1), and every skill also ships as a
  start prompt (M4 practice).
- **Deferrals (CONCEPT §11).** M6 lifts the deferral of "agent findings" in part (gap reports
  bound to submissions, without a lifecycle, S7) and adds answers to open questions (S5a), close
  to the deferred "comments"; the S2c recommendation narrows decision-19 rules by derived kind and
  converter, which §11 also defers. CONCEPT §11 notes both since decision 24.
- **Holdout hygiene.** No agent opens the holdout's `expected.yaml`, `README.md`, `spec/`,
  expected placements, recordings or report sections; tooling reports it in aggregate only.
- **Privacy.** Customer exports and transcripts never enter the repository or the eval corpus.
  The fields analyzr adds itself (provenance, losses, `derived.from`, gap kinds) are designed to
  hold no personal data. Models and free texts can: customer BPMN bytes (lanes, documentation,
  tool metadata) are stored as immutable revisions; stored extractor warnings (S2) quote
  bpmn-moddle messages, which can contain unknown extension content; the declared `externalPath`
  and `url` are not checked; human answers (S5a) and agent `gaps` (S7) are free text behind a
  warning-only check. M6 is the first milestone that puts customer data into the append-only
  store (principle 5), and there is no erasure path: model deletion is soft (uploading the key
  again revives the model) and no route deletes a project (§10.6).
- **House rules.** Contracts first and a regenerated client for every route; `policy.require` in
  every use case; a pure domain (dependency-cruiser); exact dependency versions and `pnpm
  notices`; the web entry ceiling of 240 KB (decision 21).

## 8. Slices

| Slice | Scope | Size |
|---|---|---|
| S0 | this concept; decision 24 | 0.5 d |
| S1 | import hygiene: shared file rule and key derivation, duplicate keys across batches, warnings in results, `analyzr models list\|delete\|requeue`, next-step block | 2 d |
| S2 | a: typed provenance, manifest, key pinning, identity warnings and `external-ids`, stored warnings and `extractor-loss`, „Herkunft“ in the web; b: `importImpact` (and its follow-up), dry runs in REST, CLI and the web upload; c: the trust marker (only with the owner's OK) | 3 + 3 + 1 d |
| S3 | a: `eval:descriptive` and the `get_landscape` size; b: integrate v0 for BPMN exports (plugin, `tools/integrate` with `inspect` and `normalize-bpmn`, workspace, key map, report); c: renderer and spec YAML, the ad-hoc converter path, the bundled CLI | 1.5 + 3 + 3 d |
| S4 | open-questions read model, gap signals (without `extractor-loss`), tab „Offene Fragen“, model view section, export, `analyzr questions` | 5 d |
| S5 | a: answers in the web, REST and CLI, the CSV round trip, `open_question_answer`; b: notes that make pairs non-current and queue exactly the affected work | 3 + 1.5 d |
| S6 | interview skills: guide, transcript pre-processor, fact sheet, as-told drafts; the skill text generator and start prompts | 3 d |
| S7 | after the live runs: `analyzr-relations@0.3.0` + `analyzr-placements@0.2.0`, claim input additions, MCP `list_open_questions` and prompts, personal-data guard, `nordwind-gaps`, one live-gate round | 6 d + the owner's live runs |

**Order.** S0 → S1 → S3b, with S3a in parallel: these are the „erste Anfänge“ of decision 24.1
(about 6.5 d). Then the owner reviews them, ideally on a sandbox or anonymized export (§10.4),
and confirms the rest of the order, proposed as S4 → S5a → S2a/S2b → S3c → S6, and after the
owner's live runs S5b and S7; S2c only with the owner's OK (§10.1). Why: S4 needs S2 only for
`extractor-loss`, which therefore moves into S2; every other signal reads facts that exist. On a
first import into a fresh project a dry run shows little beyond the keys, which the skill already
knows. Answering in the UI (24.3) needs no change to the judge-once core. The accepted cost:
revisions imported before S2 keep no provenance, and a re-import of the same bytes stays
`unchanged` and does not add it.

About seven weeks of agent work, plus the owner's runs. Every slice runs all gates (AGENTS.md)
before it is called done and records deviations here as "S<n> as delivered".

**S1 "Import hygiene"** (live-run neutral; no migration; part of the „erste Anfänge“).

- **Shared file rule.** A zod-free module `packages/contracts/src/paths.ts`, exported from the
  root (`index.ts` adds `export * from './paths.ts'`) and as the subpath
  `@analyzr/contracts/paths` (a new `exports` entry in `packages/contracts/package.json`):
  - `BPMN_FILE_SUFFIXES = ['.bpmn20.xml', '.bpmn2', '.bpmn', '.xml']` (longest first),
    `bpmnSuffixOf(path)` (the matching suffix, case-insensitive, or `null`), `isHiddenPath(path)`
    (a path segment starting with `.`) and `isImportPath(path)` (a BPMN suffix and not hidden);
  - `modelKeyFromPath(path)`, moved verbatim from `apps/server/src/domain/paths.ts`, its suffix
    list replaced by `BPMN_FILE_SUFFIXES`;
  - `MODEL_KEY_PATTERN`, `MODEL_KEY_MAX_LENGTH` and `isModelKey`, moved from `refs.ts`; `refs.ts`
    imports them and does not re-export them, so the root's two `export *` stay unambiguous.

  The server's `use-cases/models.ts` imports `modelKeyFromPath` from the contracts;
  `domain/paths.ts` goes, and its cases in `apps/server/test/unit/domain-utils.test.ts` move to
  `packages/contracts/test/paths.test.ts`. The CLI's `files.ts` uses `isImportPath` instead of
  `BPMN_FILE`: it picks up `.xml`, skips hidden files as the web does, and still skips
  `node_modules`, `.git` and symbolic links. The web's `lib/upload.ts` imports `bpmnSuffixOf`,
  `isHiddenPath` and `modelKeyFromPath` from the subpath instead of its `BPMN_SUFFIXES`,
  `isBpmnPath` and `isHidden`, so `planUpload` still drops hidden files silently and reports
  other non-BPMN files `not-bpmn` (the cases of `isBpmnPath` in `apps/web/test/lib.test.ts` move
  with it). It is the web's first runtime import from the contracts: `eslint.config.js` keeps the
  root `@analyzr/contracts` restricted, allows `@analyzr/contracts/paths` explicitly and adds a
  `patterns` entry restricting every other `@analyzr/contracts/*` subpath (today's `paths` entry
  matches the bare specifier only); the header comment of `apps/web/src/lib/limits.ts` names the
  exception; the bundle guard in `apps/web/test/bundle.test.ts` proves no zod enters the entry
  chunk. The contracts, not `@analyzr/client`, because the server does not depend on the client
  and all three depend on the contracts. The server keeps accepting any file name, as today.
- **Every place that names the accepted files** follows the rule: the upload panel's `accept`
  and its text „Erlaubt sind …“ (`apps/web/src/components/upload-panel.tsx`) are built from
  `BPMN_FILE_SUFFIXES`; the CLI's „no BPMN files (*.bpmn) below …“
  (`apps/cli/src/commands/import.ts`) and the `import` argument help „directory with .bpmn
  files“ (`apps/cli/src/program.ts`) name all four suffixes.
- **Duplicate keys.** The CLI and the web derive every key with `modelKeyFromPath` before
  sending; a file without a valid key, or whose key an earlier file of the same import already
  has, is reported `failed` locally with the server's wording (`validation-failed`, „the path
  gives no valid model key“, „another file of this import has model key …“) and never sent.
  Today the second file silently revises the first when the two land in different batches.
- **Plain `.xml` that is no BPMN.** A file picked up only by the `.xml` suffix that the server
  rejects with 422 `bpmn-invalid`, reason `not-bpmn`, is listed as skipped: the CLI's
  `ImportSummary` gains `skipped: {path, reason: 'not-bpmn'}[]`, present only when non-empty, and
  the file leaves `files`; `counts` keeps its four keys; the text summary adds „N skipped (not
  BPMN)“ only when N > 0; the CLI exits 0 if nothing else failed. The web lists it under its
  skipped files („übersprungen: kein BPMN“). Every other rejection (`doctype-forbidden` for an AML
  file, for example) stays `failed`. With the corpus (31 dev, 26 holdout and 3 `_sample` files,
  all `.bpmn`, none hidden, none with a warning) the JSON of `import` and of `seed --json` (which
  embeds `ImportSummary`, read by `apps/demo` and M3-LIVE-RUNS.md step 2) stays byte-identical.
- **Extractor warnings.** The contracts get `ExtractWarning` `{code (≤ 50), message (≤ 300),
  elementId? (≤ 255)}` and two optional fields on `ImportFileOutcome` and `PutModelResult`:
  `warnings` (at most 20, `MAX_RESULT_WARNINGS`, in the extractor's order) and `warningCount`
  (everything the extractor returned, ≤ 101 with its own `too-many-warnings` entry). The
  extractor caps a message at 1,000 characters (`extract.ts` `Extraction.warn`) and bpmn-moddle
  messages embed line, column and nested errors, so the server cuts a longer message to 300
  characters ending in `…` (as `claim-input.ts` `truncate`). Both fields are present only for
  `created` and `revised` with at least one warning; `unchanged` files are not extracted,
  `failed` ones carry the problem. Absent when empty, so results for warning-free files stay
  byte-identical. Server: `Extracted` in `domain/ports.ts` gains `warnings`, `analysis.ts` passes
  `ExtractResult.warnings` on, `test/support/fake-analysis.ts` `extractFake` returns `warnings:
  []`, `IngestResult` carries them, `importFiles` and `putModel` cut and cap them; not stored,
  events unchanged. Client regenerated. The CLI prints per file `warnings: 3 (invalid-id 2,
  parse-warning 1)`; a new `--verbose` option on `import` prints the entries; `--json` carries the
  result's entries (≤ 20) and `warningCount`; warnings never change the exit code. The web upload
  panel shows „3 Hinweise“ per file with the entries in a disclosure: a German label per code
  (for example `parse-warning` „Unbekannter oder fehlerhafter Inhalt“, `missing-id` „Element ohne
  ID übersprungen“, `invalid-id` „Ungültige ID: Element übersprungen“, `duplicate-id` „Doppelte
  ID: zweites Element übersprungen“, `call-without-target` „Aufruf ohne Ziel“,
  `message-flow-unresolved` „Nachrichtenfluss ohne gültiges Ende übersprungen“, the three
  `*-truncated` codes „Text gekürzt“, `too-many-warnings` „Weitere Hinweise ausgelassen“; an
  unknown code shows the code), the element id and the extractor's English message.
  The skill's report (S3b) uses the same labels.
- **CLI verbs over existing routes** (checked in `packages/contracts/src/api/routes.ts`):
  - `analyzr models list -p <project> [--stage <stage>] [--json]` → `GET
    /projects/{p}/models` (`listModels`, every page): key, stage, head revision, engine, open
    items. Any credential.
  - `analyzr models requeue -p <project> (<key>… | --all) [--json]` → `POST
    /projects/{p}/analyses/requeue` with `{modelKeys}` (≤ 1,000) or `{all: true}`
    (`requeueAnalyses`): `queued`, `open` or `not-found` per model. Owner key, or an agent token
    with `analyzr:write`, as `analyzr value-chain requeue`, which already sends `{valueChain:
    true}`.
  - `analyzr models delete <key>… -p <project> [--yes] [--json]` → keys resolved through `GET
    …/models` (there is no lookup by key; `getModel` and `deleteModel` take the `mdl_` id), then
    `DELETE /projects/{p}/models/{model}` (`deleteModel`) one by one. Owner key only: an agent
    token is refused before any request, as for `value-chain push` (a CLI guard; the server
    policy stays as it is). Unknown keys exit 1 before anything is deleted. Without `--yes` it
    lists what it would delete (key, stage, `openItems`), says that partner relations turn
    `missing` and that uploading the key again revives the model, and exits 1 („nothing
    deleted“). The deletion impact itself comes with S2.
  - After a text-mode `analyzr import`: `<project>: N relations tasks waiting, placement task
    waiting: yes|no`. That is the project's state, not this import's effect (the import result
    does not report what it queued, and earlier backlog counts too). It comes from `GET
    /projects/{p}/analyses?state=queued&kind=relations&limit=200`, following `nextCursor` (one
    more call per 200 tasks), and `…&kind=placement&limit=1` (`listAnalyses`, permission `read`,
    so it works with any credential, unlike `GET /analyses/pending`, which needs
    `analyzr:propose`). Then the next step (`/analyzr:relations <project>`, `/analyzr:placements
    <project>`, the start prompts in `examples/agents`). `--json` output unchanged.
  - Not possible over existing routes, so not in S1: a deletion or import preview (S2), the
    number of candidate pairs the waiting tasks will judge (S2b's follow-up), requeueing a single
    pair (S5b queues exactly the affected work instead).
- **Docs:** DEVELOPMENT.md "The `analyzr` CLI"; CONCEPT §4, which still lists `analyzr import
  <dir>` for R1; CONCEPT §3 "Requeue" and the comment in `packages/bpmn-facts/src/version.ts`,
  which both name a non-existent `analyzr reindex`.
- **Does not touch:** procedures, plugins, claim inputs, MCP tools and prompts (snapshots
  unchanged), facts and `FACTS_VERSION`, the rule tier, judgement bases, the database schema,
  recordings and reports, the JSON of `analyzr import` and `analyzr seed` for the corpus.
- **Done when:**
  - contracts tests (`packages/contracts/test/paths.test.ts`) cover the moved key cases plus
    `.xml`, `.BPMN`, `.bpmn20.xml`, hidden files and `isHiddenPath` apart from `bpmnSuffixOf`;
  - CLI tests cover `.xml` pickup, a skipped `._x.bpmn`, duplicate keys across two batches (the
    second never sent), a `not-bpmn` `.xml` under `skipped` with exit 0, a `doctype-forbidden`
    `.xml` as `failed` with exit 1, warnings in text, with `--verbose` and in JSON, the next-step
    block paging past 200 tasks, and `models list|requeue|delete` (agent token refused for delete
    before any request, nothing deleted without `--yes`, unknown key exits 1 before deleting);
    a CLI e2e test pins that `seed --json` for `_sample` has an `import` with exactly `project`,
    `files` and `counts`, four count keys, no `skipped` and no `warnings`;
  - a server integration test with `startTestApp(database, { analysis: libraryAnalysis })`
    (`apps/server/test/integration/real-libraries.test.ts`) imports a revision with a duplicate
    element id and gets `revised` with `warnings[0]` = `{code: 'parse-warning', message:
    /duplicate ID <Task_A>/}` and `warningCount: 1` (bpmn-moddle drops the second element, so no
    `duplicate-id` arrives); a task whose 400-character id is no NCName gives a `parse-warning`
    of about 490 characters, answered cut to 300 ending in `…`; PUT answers the same; a
    warning-free import answers exactly as before (no `warnings` key);
  - web unit tests for the upload plan (`.xml`, hidden files dropped silently, `not-bpmn`,
    duplicate keys) and the code labels (an unknown code shows its code), a test that the upload
    panel's `accept` and text follow `BPMN_FILE_SUFFIXES`, and a Playwright check of the warnings
    display;
  - the client regenerated; MCP snapshots, `eval:candidates`, `eval:replay` and `eval:placements`
    unchanged; all gates green.

**S1 as delivered** (2026-10-15, branch `feat/integration-and-gaps`; every gate green): every
bullet above, with three deviations:

- The next-step block after a text-mode `import` prints the `next:` lines only when something
  waits, and each slash command only for the kind that waits; the spec names the step
  unconditionally. The waiting line keeps the spec's wording (`1 relations tasks waiting`).
- A model key goes to the first file with a `.bpmn`, `.bpmn2` or `.bpmn20.xml` suffix and only
  then to a plain `.xml` (`modelKeyOwners` in `@analyzr/contracts/paths`, used by the CLI and
  the web), not to the first file in path order: an export's `Order.xml` that may be no BPMN
  sorts before `order.bpmn` and would keep the model out. The local refusal names the file that
  gets the key (the server's wording plus the path: „another file of this import has model key
  z (Z.bpmn)“ for `z.bpmn2`); a plain `.xml` that loses its key to a `.bpmn…` file is skipped
  instead (below).
- Beyond the extractor's 100 warnings the result lists the first 19 and the extractor's
  `too-many-warnings` entry („N more warnings omitted“) last, instead of the first 20, so the
  number it dropped reaches the user; `warningCount` stays ≤ 101 (`MAX_RESULT_WARNING_COUNT`,
  now in the schema). The CLI prints `warnings: 100 (parse-warning 19, 81 more, 150 more warnings
  omitted)`, `--verbose` the entry after „… 81 more not listed“; the web shows „100 Hinweise“ and
  the entry („Weitere Hinweise ausgelassen“) after „… und 81 weitere“.

**Taken by the implementing agent (the owner may overrule):** a plain `.xml` whose model key went
to a `.bpmn`, `.bpmn2` or `.bpmn20.xml` file of the same import (a tool's sidecar `Prozess.xml`
next to `Prozess.bpmn`) is skipped, not failed, so such an export imports in one go: it is never
sent (only the server could tell whether it is BPMN, and if so it would revise the model), it is
listed with the reason `key-taken` and the file that has the key (`keyTakenBy` in
`@analyzr/contracts/paths`, used by the CLI and the web), and it never changes the exit code. The
CLI prints `skipped   Prozess.xml  (same model key as Prozess.bpmn)`, the summary names the
reasons (`, 2 skipped (1 not BPMN, 1 same model key)`; `, N skipped (not BPMN)` as before when all
are no BPMN), `--json` carries `{path, reason: 'key-taken', takenBy}` under `skipped`, and the
corpus JSON of `import` and `seed --json` stays byte-identical. The web lists the file as
„gleicher Modellschlüssel wie Prozess.bpmn“ under „N Dateien übersprungen (kein BPMN, größer als
5,0 MB oder gleicher Modellschlüssel wie eine BPMN-Datei)“. Unchanged: two `.bpmn…` files with
one key, two plain `.xml` files with one key (neither has a `.bpmn…` owner) and a path without a
valid key fail as before; the exit 1 for „nothing imported“ stays limited to an import whose files
were all plain `.xml` that is no BPMN (a skipped sidecar always has its model sent next to it).

Choices the spec left open: the CLI and the web sort an import by UTF-16 code units
(`comparePaths` in `@analyzr/contracts/paths`; the web's `localeCompare` gave `a_b.bpmn` the key
the CLI gave `a-b.bpmn`); `isHiddenPath` splits on `\` as well as `/`, as `modelKeyFromPath`
does; a file above 5 MB that the CLI keeps local now names its derived `modelKey` (it was `null`;
the server's wording for the same case); the CLI also lists each skipped file (`skipped   <path>
(not BPMN)`) and `seed`'s short line gets the same „N skipped“ suffix; when every file picked up is
a plain `.xml` that is no BPMN, nothing was imported: `import` prints the skipped files and exits 1
(„no BPMN files below <dir>: N skipped (not BPMN)“, as for a folder without BPMN files, without
the next-step block), and the web shows the warning toast „Keine BPMN-Dateien gefunden“ instead
of „0 Dateien importiert“; a failed task listing (a token without `read`) is a note on stderr that
leaves the exit code alone; `models requeue` exits 1 when a key has no live model; `models delete
--json` prints `{deleted, models}`, and when a later DELETE fails `{deleted, models, failed: {key,
error}}` with the models deleted before it, then exits 1; the web lists the files that failed
before sending first and labels `multiple-event-definitions` „Mehrere Ereignisdefinitionen“.
Beyond the spec: the bundle guard also pins `packages/contracts/src/paths.ts` as the only
contracts module in the web bundle (entry chunk 201.2 KB gzip after the review fixes, ceiling
240 KB), and the Playwright check ran with the whole suite (46 passed, before the review fixes)
against a server started from source on a Testcontainers PostgreSQL. The bpmn-moddle message for a 400-character id that is no NCName has
485 characters.

**S2 "Provenance, manifest, dry run"** (after the owner's review of the „erste Anfänge“). S2a:
§3.2–§3.4: typed provenance, the manifest (`sha256` optional, `source.scope`), key pinning,
`external-id-moved` and `external-id-changed`, `GET /projects/{p}/external-ids?system=`; a
nullable `extract_warnings` jsonb column on `model_revision`, written at insert (old rows stay
null), and §4.3's `extractor-loss` on it; the web reads `analyzr-import.json` from a dropped
folder and shows „Herkunft“ in the model view and badges in the models table. S2b: §3.5's
`importImpact` and the dry runs in REST, the CLI and the web upload („Vorschau“ before
„Importieren“), the deletion impact in `models delete`; the follow-up (judgements, tasks,
placements) right after. S2c: §3.10, only with the owner's OK. Does not touch: facts, the claim
input, MCP (`RevisionSource` appears in no MCP output schema), procedures. Done when: provenance
round trips through PUT, import and the web; a manifest's pinned keys win over paths; a checksum
mismatch gives `manifest-sha-mismatch` and the file is imported; `external-id-moved` and
`external-id-changed` appear in their cases; absent keys respect `source.scope`; a key map
rebuilt from `external-ids` equals the one the import used; `extractor-loss` fires on synthetic
fixtures (duplicate and illegal ids, unknown elements) and never on the corpus; the recompute
golden digest is unchanged after the refactor; the dry run's impact equals what the real import
then does (property test over seeded imports, growing with the follow-up); `analyzr import
--dry-run` and the deletion impact in `models delete` print it; corpus behaviour unchanged.

**S3 "Toolkit".** S3a (part of the „erste Anfänge“): §3.11, report committed, CI drift check,
and the `get_landscape` size per model of the seeded `nordwind-handel` with the v1 limit in §6.
S3b "Integrate v0 for BPMN exports" (part of the „erste Anfänge“): the plugin skeleton and the
plugin test's marketplace pin; `tools/integrate` with `inspect` and `normalize-bpmn`, bundled with
a drift test; `integrate-landscape` with the workspace, `keymap.json`, the three confirmations,
a bundle today's CLI and web import, and the German report; the reference notes of §3.8 (marked
unverified); the Codex pointer. No renderer, no manifest reading, no dry run; the skill already
writes `analyzr-import.json`, so its bundles stay forward compatible. S3c: the renderer and
`analyzr-spec/1` (§3.9), the ad-hoc converter path for Visio, AML and pictures, and
`scripts/analyzr.mjs`. Does not touch: `plugins/analyzr`, `RELEASED`, `PLUGIN_RELEASES`, MCP
prompts, the eval generator. Done when (S3b): the skill turns a synthetic Signavio-style BPMN
export (hand-written, marked unverified, never from the holdout or a customer) into a bundle and a
report; `analyzr import <bundle>` and dropping the bundle into „Hochladen“ yield the same keys; a
second run after a folder move in the export keeps the keys through `keymap.json`; normalized
outputs extract without id warnings; it runs end to end against a scratch stack of the agent's
own compose project (AGENTS.md), with a checkout's CLI and with the web path; the drift test
passes. Done when (S3c): rendered fixtures extract without warnings and import into bpmn-js
without warnings; a spec from an `adhoc:` converter yields no `calledElement`; `node
scripts/analyzr.mjs import` works against the scratch stack.

**S3a as delivered** (2026-10-15, branch `feat/integration-and-gaps`; every gate green, together
with S3b): `pnpm eval:descriptive` (`eval/tools/src/descriptive.ts`, `descriptive-context.ts`,
`descriptive-score.ts`, `descriptive-report.ts`, the transforms in
`eval/tools/lib/descriptive.mjs`), the report `eval/reports/descriptive.{md,json}` with a CI drift
step, report only; results in §3.11. `get_landscape` is measured by
`apps/server/test/integration/landscape-size.test.ts`, which requires < 100 KB on
`nordwind-handel`; results and the v1 limit in §6. The claim size estimate
(`eval/tools/src/claim-estimate.ts`, exported by `@analyzr/eval-tools`) is pinned byte for byte to
the server's `renderClaimInput` on every dev model by
`apps/server/test/unit/claim-estimate.test.ts`. Deviations:

- Five variants, not four: `pools` (message flows to black-box pools, every element unchanged) and
  `tasks` (the exchange events and send and receive tasks as plain tasks with those flows) are
  separate, so the report attributes the findings drop to the flows and the coverage drop to the
  tasks.
- `descriptive` strips signals like messages (no `signalRef`, no `bpmn:signal`), not only
  `messageRef`.
- Only intermediate message throws and catches and send and receive tasks become tasks; start, end
  and boundary events and a catch or receive task after an event-based gateway stay events, so the
  BPMN stays valid.

Choices the spec left open:

- The transforms run through bpmn-moddle without engine extensions and keep every element id
  (only message and signal definitions and the event definitions of converted events go; a test
  checks every corpus model in every variant), so `expected.yaml` applies unchanged.
- `engine-stripped` moves a C8 `zeebe:calledElement` verbatim to the standard `calledElement` (the
  optimistic case: the tool keeps the target). That is how S3a found the FEEL gap of facts v1
  (§3.11); `normalize-bpmn` never moves a target there and leaves expressions alone.
- Collapsed subprocesses take the callee's exact process name, partner pools the partner's exact
  pool or process name (the optimistic case; facts v1 reads neither name, and a variant without
  verbatim names is a prerequisite before a facts version matches them); unresolved and dynamic
  calls keep their label.
- Partners come from the rule tier's message-name pairs on the unchanged models, never from
  `expected.yaml`, so a transformed model carries no ground truth, and no transformed model is
  written to disk. An endpoint without such a pair gets one pool „Externer Partner“, never one
  named after the message; there is one pool per partner name and model, and message flows carry
  no name. A single-process model gets a collaboration around its process; the generated DI passes
  the corpus validator's `checkDi` (except its rule that subprocesses are expanded).
- An extractor warning on any variant is an error (exit 1).
- The claim size is the input `renderClaimInput` renders on a fresh import with every candidate
  listed and without `judged` and `skip`, which depend on the claim order; the baseline (mean
  40.8 KB, max 80.1 KB) equals the M3 measurement.
- „Accepted under decision 24.2“ is computed (acceptances whose caller has an engine), since S2c
  does not exist yet.
- The holdout section shows whole-landscape numbers only, with no model names and no ground truth
  per relation type or tag (one type's count would equal the total minus the others'). A count of
  1 to 4 items is „< 5“, and a number that differs by 1 to 4 from any shown number it is nested
  with (the same metric in another variant, the coverage levels within a variant, the totals they
  lie in, expected against computed findings) is „hidden“ (`redactGrid` in
  `eval/tools/src/descriptive-score.ts`; a test checks every nested pair of the real holdout
  section and prints PASS/FAIL only). The console prints the same redacted numbers.
- The tool behaviour the variants assume is listed in the report header as assumptions to verify,
  separate from the facts v1 effects.

**S3b as delivered** (2026-10-15, branch `feat/integration-and-gaps`; every gate green, together
with S3a): the plugin `plugins/analyzr-integrate` 0.1.0 (`.claude-plugin/plugin.json`,
`skills/integrate-landscape/SKILL.md`, `reference/{signavio,aris,visio,adonis,bizagi}.md` with
the four sections and the status line "unverified: based on public documentation", the generated
`scripts/{inspect,normalize-bpmn}.mjs` and `THIRD-PARTY-NOTICES.md`), listed in
`.claude-plugin/marketplace.json` (`claude plugin validate --strict` passes for both with Claude
Code 2.1.300); the private package `tools/integrate` (`@analyzr/integrate`, imported by nothing
in `apps/` or `packages/`; it imports only the zod-free `@analyzr/contracts/paths`, so its keys
are `modelKeyFromPath`'s) with the sources and 145 tests. `pnpm --filter @analyzr/integrate
generate` bundles each entry with rolldown 1.2.12, the version Vite 8.3.2 locks (no new package
in the lockfile, only the importer entry; `pnpm notices` unchanged), into a self-contained,
unminified ES module (inspect 32 KB, normalize-bpmn 228 KB) and writes the plugin's notices
(bpmn-moddle, camunda-bpmn-moddle, min-dash, moddle, moddle-xml, saxen, zeebe-bpmn-moddle, all
MIT). The drift test compares both with a fresh build, checks that the bundles import Node
built-ins only and name no local path, and runs them copied away from `node_modules`. Deviations:

- `normalize-bpmn` has four subcommands: `file`, `plan` (the keys; `--write` after the
  consultant's yes), `bundle` and `inventory` (a CSV catalog, UTF-8 or Windows-1252, into
  `analyzr-inventory/1`, taking only the named columns, so columns naming people never reach it).
  Key planning and the bundle live there instead of a third script, since BPMN is v0's only path
  (the pure `keymap.ts` and `bundle.ts` can serve S3c's renderer).
- Missing DI is the loss code `layout-missing` (elements bpmn-js draws without a shape or edge,
  their ids listed); §3.2's list lacks it, so S2a's `ImportManifest` must accept it.
- References follow rewritten ids through every reference property bpmn-moddle's descriptors
  declare (attributes such as `sourceRef`, `default`, `processRef`, `bpmnElement` and reference
  texts such as `<incoming>` and `<flowNodeRef>`), not only the seven names of §3.7; a static
  `calledElement` that is no safe id is rewritten like the process id it names, so calls across
  files stay consistent; an expression (`=…`, `${…}`, `#{…}`) is left alone.
- An element analyzr or bpmn-js needs an id for (flow elements, processes, collaborations,
  participants, lanes, message flows, artifacts) that has none gets one, `<Type>_<hash of the
  nearest id above, type, name and position>`, stable when unrelated elements are added and
  counted as `id-rewritten` (reason `missing`): §3.4 rule 2 has no source id to derive it from,
  and without one the extractor skips the element (`missing-id`).
- The workspace gains `inventory/` for catalogs and `reports/<…>.{models,plan,bundle}.json` for
  the scripts' complete results; `keymap.json` records per system the key rule, the scope and the
  folders to leave out (formats `analyzr-keymap/1` and `analyzr-workspace/1`).
- The skill pre-approves only `inspect.mjs`; §3.1's `analyzr import … --dry-run` waits for S2b
  (`allowed-tools` lasts for the invoking turn only). The guard setup it offers (a
  `permissions.deny` rule `Read(~/.local/state/analyzr/**)`, the sandbox with a
  `credentials.files` deny, `autoAllowBashIfSandboxed` and `allowUnsandboxedCommands` false)
  follows the setting descriptions of Claude Code 2.1.300 but was not tried in a live session, so
  §3.1's "the exact rules are verified in S3b" stays open; the skill asks the consultant to check
  `/permissions` and `/sandbox`. Codex's sandbox modes restrict writes, not reads, so the Codex
  sandbox without read access to the key that §3.1 names does not exist: its approvals are the
  guard (`examples/agents/codex/README.md`).
- The skill unpacks a zip export into `exports/` itself after the consultant's yes, as it copies
  a folder there; the zip itself is not copied.
- Not in v0: the report's warning above §6's v1 limit, which S3a fixed in parallel; the next
  plugin version adds it.

Choices the spec left open:

- An id is kept only if analyzr and bpmn-moddle both accept it (`[A-Za-z_][A-Za-z0-9_.-]*`, at
  most 255 characters). bpmn-moddle drops an element whose id fails its ASCII check, so `Prüfen`,
  a valid NCName, is rewritten (`Task_Pruefen`) like `4711` (`DataStoreReference_4711`).
  Duplicates get `_2`, `_3`: the k-th DI shape goes to the k-th element; `sourceRef`,
  `targetRef`, `incoming`, `outgoing` and `default` go to the occurrence the flow starts or ends
  at, in order when several do; every other reference goes to the first, and references the
  script could only guess are listed as `ambiguousReferences`.
- Bytes analyzr reads completely pass through unchanged (`derived.kind` `export`, `converter`
  null); everything else gets text edits and is then read and written by bpmn-moddle (the
  extension chosen as `extractFacts` chooses it) and is `converted` (`normalize-bpmn@0.1.0`).
  Besides UTF-16, a declared ISO-8859-1 or windows-1252 file is transcoded; undeclared entities
  such as `&nbsp;` stay undecoded, as bpmn-moddle's reader leaves them, and a DOCTYPE is refused.
  The input may be up to 10 MB (UTF-16 doubles the bytes); analyzr's 5 MB and 50,000 elements are
  checked on the output, which is written compact when indenting would exceed 5 MB and refused
  (`failed`) otherwise.
- Identity: a file matches its `keymap.json` entry by tool id (the `<definitions id>`, to verify
  per tool) when that id is unique in the export and not generic (`Definitions_1` and the like),
  else by its tool path unless file and entry carry different ids. Flags: `duplicate-external-id`
  (the file at the known path keeps its key, a copy is new), `generic-external-id`, `renamed`,
  `exists-in-analyzr`
  (with `plan --existing`, the output of `analyzr models list --json`, which the skill runs read
  only), `outside-scope` and `no-key`. Keys are `modelKeyFromPath` of the path below the export
  after an optional `--strip <folder>`, with an optional `--prefix`; collisions get `-2`, `-3`.
  The rule is fixed after a system's first import; every key in `keymap.json` stays taken (absent
  models too); `plan --write` adds and moves entries but never removes one; `plan --reset` drops
  one system's rule and keys while nothing of it is imported; `plan --exclude` (archive folders,
  which `inspect --summary` lists as `archiveLike`) is recorded per system.
- The manifest: `exportedAt` from `--exported-at` (a bare date becomes midnight UTC);
  `systemVersion` is the exporter version when every file agrees; an empty `losses` and a null
  `externalId` are left out. The bundle's details give each call a `match` (`one` with its target
  key and process, `none`, `several`, `expression`, `empty`), from which the report lists the
  calls analyzr will accept on import (decision 9).
- The scripts print short JSON (long lists cut to their first entries plus a count; on a
  200-model export inspect 5.8 KB, plan 1.9 KB, bundle 6.6 KB), and `plan` and `bundle` write the
  complete result with `--json-out`. They refuse an `--out`, `--json-out` or `--workspace` inside
  the export or inside an analyzr checkout (symbolic links resolved).
- The report's extractor warnings: normalize-bpmn reports bpmn-moddle's warnings for the written
  bytes (analyzr's `parse-warning`s) before the import; the other codes appear only at import,
  because bundling `@analyzr/bpmn-facts` would pull in the whole contracts package with zod.
- Every command the skill prints is `<cli> --url "<analyzrUrl>" …`; the report says that the
  import needs the owner key (`ANALYZR_OWNER_KEY_FILE` with analyzr in Docker) and gives the web
  path. A probe project is recommended only when the bundle shows failed files, warnings, missing
  layout or ambiguous references; confirmations 1 and 3 and the archive question go in one
  message.
- Releases: `RELEASES` in `tools/integrate/test/plugin.test.ts` pins a sha256 over the plugin's
  files per plugin version, and `CONVERTER_OUTPUTS` in `tools/integrate/test/bundle.test.ts` the
  golden bundle's models per `NORMALIZE_BPMN_VERSION`, so a change of the plugin moves its
  version and a change of what normalize-bpmn writes moves the converter's. The golden bundle of
  the synthetic Signavio-style fixture (`tools/integrate/test/fixtures/signavio/bundle`, rewritten
  with `ANALYZR_UPDATE_GOLDEN=1`) is what the CLI and web tests read.

End to end, by the implementing agent (the consultant's three answers given by the agent): the
skill on the synthetic export gave a bundle of 6 models, 3 of them converted (one UTF-16 file, 4
rewritten and 2 duplicate ids), and a German report. Against its own compose project
`analyzr-s3b` (database only, the server from source, removed with `down -v`) the checkout CLI
imported the bundle under the pinned keys without a warning (one call accepted by the rule tier),
while the raw export failed one file, drew 11 `parse-warning`s and got `gemeinsame-dokumente/…`
keys. A re-export with a moved folder and the archive deleted kept `logistik/versand` and imported
as 5 `unchanged`. These runs preceded the review round, whose fixes left the golden bundle's bytes
unchanged; after it, „Hochladen“ in Chromium (Playwright, the folder picker) gave the same 6 keys
and skipped the manifest.

**S4 "Open questions".** Scope: §4.1–§4.4 without `extractor-loss` (S2); summaries only with the
owner's OK. Does not touch: `FindingKind`, the claim inputs, MCP, stages. Done when: every source
of §4.1 maps to items on the seeded dev project with the expected ids, kinds and `unlocks`; each
signal is checked on `nordwind-handel`; ids are stable across reads and change with their source;
the export round trips, the CSV with its empty answer columns; the tab and the model view section
pass Playwright; the entry chunk stays under its ceiling.

**S4 as delivered** (2026-10-16, branch `feat/integration-and-gaps`; every gate green, with a
review round's fixes): the read model in `apps/server/src/domain/open-questions/` (`model.ts`:
input, index, ids, `askWho`, `unlocks`, order; `sources.ts`: §4.1; `signals.ts`: §4.3;
`read-model.ts`: list, filters, cursor pages; `export.ts`: Markdown, CSV and its parser, the file
name), the use case `use-cases/open-questions.ts` (permission `read`, one read snapshot), the
routes `GET /projects/{p}/open-questions` and `…/open-questions/export` (tag `open-questions`,
`READ_PROBLEMS`), the zod-free labels `@analyzr/contracts/open-question-labels` (the server's
export and the web read the same German labels), the tab „Offene Fragen“ after „Befunde“ with its
count, the model view's section „Offene Fragen“ (both lazy chunks; the entry stays at 207.5 KB
gzip, `apps/web/test/bundle.test.ts` says why it grew by 6 KB), and `analyzr questions` with
`--model`, `--kind`, `--source`, `--ask-who`, `--state` and `--format text|md|csv|json`. Summaries
are shown read-only (decision 24.9). Live-run neutral: `FindingKind`, claim inputs, MCP tools,
prompts and snapshots, procedures, plugins, facts, stages, recordings and reports are unchanged.

Counts. The seeded dev project (`nordwind-handel` with its golden chain, no agent yet) has 64
items: 14 findings (`message-partner-missing` 9, `call-target-unknown` 2, `call-target-dynamic`
2, `duplicate-process-id` 1), 44 chain findings (`process-without-step` 32,
`step-without-process` 12) and 6 signals, all `black-box-partner`; without the chain, 20. After
the simulation agent: 115 (22 `agent-question`, 3 `placement-unsure`, 32 `summary-note` for the
31 models and the chain; 3 `message-partner-missing`, since the agent's links answer 6 findings,
which are hidden as in „Befunde“); after two holds, a model change and a probe agent every
source of §4.1 except the extractor warnings (S2) is there: 119 items (2 `held`, 19
`agent-question`, 1 `external-partner` and 1 `call-target-unknown` from coded no-links, 1
`unjudged`; `apps/server/test/integration/open-questions.test.ts` prints the counts). Shipped
signals: `black-box-partner`, `unlabelled-boundary`, `undocumented-process`, `isolated-process`
and `descriptive-model`; `message-without-name` stays off, `extractor-loss` comes with S2. The
signals on the dev models and eval:descriptive's cumulative variants
(`apps/server/test/unit/open-questions.test.ts`):

| Variant | `black-box-partner` | `undocumented-process` | `isolated-process` | `descriptive-model` | `unlabelled-boundary` | `message-without-name` (off) |
|---|---|---|---|---|---|---|
| baseline | 6 | 0 | 0 | 0 | 0 | 0 |
| engine-stripped | 6 | 0 | 0 | 0 | 0 | 0 |
| descriptive | 6 | 0 | 0 | 31 | 0 | 0 |
| pools | 50 | 0 | 0 | 31 | 0 | 0 |
| tasks | 50 | 0 | 2 | 31 | 0 | 0 |
| no-docs | 50 | 32 | 2 | 31 | 0 | 0 |

`message-without-name` stays off (`SIGNALS_OFF`): a message endpoint without a name and without a
message flow never pairs in the key tier, so the rule tier already reports it as `dangling-throw`
or `unmatched-catch` („Eine Nachricht ohne Nachrichtennamen …“); on the descriptive variant all
46 such endpoints were findings already and the other 19 nameless ones are message-flow ends. Its
kind stays reserved. `unlabelled-boundary` does not fire on the corpus (its none events are
labelled) and is checked on synthetic models.

Scale. Whole-project candidates grow quadratically with the landscape: on 10 renamed copies of
`nordwind-handel` (310 models, 3,830 facts, 43,876 candidates) `generateCandidates` takes about
2.3 s (155 models 0.65 s, 31 models 30 ms), the read model itself 12 ms (200 items, 154 KB JSON
per page); the loading is a constant ~20 queries. The use case therefore memoizes the candidates
per project on the live models' `modelKey=facts_hash` (exact, since they are a pure function of
the head facts; at most 8 projects per server), so only the first read after an ingest pays; the
items themselves are computed per request (the tab's count, its pages, the model view and the
export each read once). Done tasks load through two lean queries (per model and facts hash the
newest done relations task; the chain's done placement tasks on its head revision), without the
assignments. The value chain helpers still read the head facts three times per request (they are
shared with the placement pipeline and stay as they are).

Deviations from §4 and choices the spec left open:

- **`askWho.stepOwners: string[]`** instead of `stepOwner: string | null` (§4.2): one entry per
  org unit, sorted, so the `askWho` filter matches each of them, a name containing „, “ stays
  unambiguous and no option exceeds the filter's 200 characters; the export and the web join them
  for display only („Organisationseinheiten A, B“, also as the Markdown group).
- **`unlocks` may be 0** (§4.2 says at least 1): an item that touches no open decision says „Keine
  offene Entscheidung“, not „1 offene Entscheidung“. The list orders questions before the
  informational items (`summary-note`, `descriptive-model`), each by `unlocks` descending, then
  subject, kind and id (the cursor carries that position). A model's informational items count
  the open decisions at every element and process of the model (§4.2's "sum over its endpoints",
  each pair once), the chain's summary its open processes and the proposed or held placements on
  live steps.
- **The CSV leaves the informational items out**: they ask nothing, so the sheet the customer
  fills in (and S5a reads back) holds questions only; the Markdown keeps them, marked „Zur
  Information, keine Antwort nötig“. The tab's count is the API's `total` for `state=open` and
  still includes them.
- **The export's file name carries the filters** as an ASCII slug
  (`offene-fragen-<project>-finanzen-black-box-partner.csv`, at most 80 characters of filters),
  so one export per department or folder says which it is.
- **`message-partner-missing`** is labelled „Nachrichten- oder Signalpartner fehlt“: the rule tier
  raises `dangling-throw` and `unmatched-catch` for signal endpoints too, and a signal finding asks
  „Wer fängt das Signal, das … wirft?“ (or „Wer wirft …“).
- **`black-box-partner`** places a message-flow end in its process when the facts name it, also
  without a fact of its own: lane members, enclosing (collapsed or expanded) subprocesses,
  boundary hosts, data stores' readers and writers; `isolated-process` uses the same map. Facts v1
  cannot tell a pool without a process from a collapsed subprocess or an intermediate none event
  outside every lane, so the question names the end („Ist „X“ in … ein externer Partner, …? „X“
  gehört zu keinem Prozess des Modells, ist also vermutlich ein Pool ohne Prozess.“) rather than
  calling it a pool outright.
- **Holds and agents' questions** are listed only where a decision can still reach them: a
  placement on the live generation of its step, a relation or placement whose ends are in the
  head facts (not `missing`). An agent's question counts only on a proposal newer than the latest
  decision in force: a question asked before a rejection that another agent's proposal reopened
  is answered by that rejection.
- **Placement summaries per batch**: a placement run comes in batches of at most 50 processes,
  each its own task, so the chain shows the summary of every done placement task on its head
  revision until newer tasks claimed every process it claimed (`currentPlacementBatches`); per
  live model, the newest done relations task on its head facts, as specified.
- **Lanes inside subprocesses**: an element inside an embedded subprocess has the lanes of the
  nearest enclosing subprocess in a named lane (a lane lists the subprocess, not its elements).
- **No-link codes** are read from a `Map`, so an agent's reason starting `constructor:` or
  `__proto__:` is no code.
- **The tab filters in the browser**: it loads every item once (pages of 200) and filters with the
  server's rules, so the filters react at once and each option shows its count under the other
  filters (`e2e/open-questions.spec.ts` compares every filter with the API); an option lists only
  values that have items, or the one set in the URL, which hides „Nachricht ohne Namen“ and
  „Beantwortet“ for now. The exports send the same filters to the export route. The tab's count is
  one request per project page (`limit=1`, its `total`); the server still computes the whole list
  for it, with the candidates memoized (above).
- **Accessibility in the tab**: the count is announced (`aria-live`), the reset buttons hand the
  focus to the first filter, a link names the item's subject (`aria-describedby`), the source
  label shows only where the badge and the verbatim intro do not say it already.

**Taken by the implementing agent (the owner may overrule):** chain findings rank like every other
question, by `unlocks`. On a freshly seeded project 44 of the 64 items are `process-without-step`
(32) and `step-without-process` (12), correctly so while nothing is placed; they shrink as
placements are accepted, and the filter Quelle (`source=value-chain-finding`) separates them. If
they should rank below the other questions, that is a change to the sort key only.

Verified (2026-10-16, after the review round): every gate (AGENTS.md, plus `pnpm
eval:descriptive`; `eval/reports` unchanged), Playwright `e2e/open-questions.spec.ts` (6 passed)
and the whole suite against a server run from source on a scratch PostgreSQL, and `demo.spec.ts`
(14 passed, the new nordwind-handel walk included) against a scratch demo image
([DEVELOPMENT.md](DEVELOPMENT.md) "M6 S4 (2026-10-16)"). Not checked: other browsers than
Chromium, screen readers.

**S5a "Answers recorded"** (live-run neutral; may land before the live runs). Scope: §4.5 S5a:
„Beantworten“ in the tab and the model view, the answer routes, `analyzr questions answer`, the
CSV round trip, `open_question_answer`, the personal-data warning. Does not touch: claim input
formats, procedures, judgement bases, queueing, auto-accept safeguards. Done when: an answer on a
held relation is a human note on it, one `open_question_answer` row links it, and the item turns
`answered`; a placement answer is a placement note (the process due, nothing queued, as today);
a subject answer marks the item answered until its source changes; the CSV preview lists unknown
ids and stores nothing for them; claims of note-free seeded projects are byte-identical;
recordings and `eval:replay` unchanged.

**S5b "Answers re-judged"** (after the live runs unless the owner says otherwise, §10.5). Scope:
§4.5's relations basis and queueing, the one-time requeue at deploy. Done when: a note answer on
a held relation makes exactly that pair non-current and queues its origin model, whose next claim
assigns that pair and lists the others as `judged`; a placement answer queues the chain's task;
the deploy step queues exactly the origin models of pairs the new basis makes non-current; claims
of note-free seeded projects are byte-identical; recordings and `eval:replay` unchanged.

**S6 "Interviews".** Scope: §5 items 1–4 as skills and scripts; the skill text generator and the
German start prompts (§3.7). Does not touch: analyzr's core. Done when: a synthetic
`nordwind-handel` interview (written for this test, no personal data) yields a guide, a fact sheet
with valid citations and an as-told bundle whose dry run passes; the drift test covers the
generated texts.

**S7 "Gap release"** (after the live runs). Scope: §4.6, §4.7. Done when: `nordwind-gaps` is
scored by `eval:replay` for the sim agent; the owner's live gate passes for both procedures
with the new gap thresholds; `RELEASED`, `PLUGIN_RELEASES`, the plugin and the MCP snapshots are
updated as AGENTS.md describes.

**Taken by this concept (the owner may overrule):** the gaps field (decision 24.4); the order of
§8 after the „erste Anfänge“, until the owner's review; models at the bundle root at their key's
path; ad-hoc converters emit specs only; no `derived.kind` `generated` until a skill produces
it; a manifest checksum mismatch warns instead of failing; dry runs with permission `read`;
`models delete` for the owner key only; every answer recorded in `open_question_answer`, its text
in a note where a relation or placement exists; S5a before the live runs; the answer kind „Liegt
außerhalb der Landschaft“ closes an open-question item but never dismisses a finding (M4 §10
keeps "dismissing findings" out); identical bytes keep their first provenance; `nordwind-gaps`
outside `eval/corpus`.

## 9. Out of scope

Bundled converters for AML, VSDX, ADOxx or Bizagi packages (until sample exports exist); MCP
`put_model` and model drafts; stored placeholders and agent findings as entities with a
lifecycle; assignees, due dates and notifications (decision 10, server mode R1); sync, prune and
watch; tool API pullers; vision reconstruction; facts v2 and reindex; a non-BPMN document store;
staged imports; project deletion and purging (§10.6); cross-project relations; a new pipeline
stage; OKF (deferred, decision 22).

## 10. Open questions for the owner

1. **Trust policy (amends decisions 9 and 19). Decided 2026-10-15 as recommended, with (a)
   (decision 24.2); only its last sentence stays open.** Calls in models that are not modelled (engine
   null, uploaded with an agent token, or declared converted, reconstructed or as-told) are
   proposed (tier `key`, 0.9) instead of accepted, and decision-19 rules may accept such
   rule-tier call proposals narrowed by derived kind and converter (§3.10). Recommendation: yes to
   both. Two caveats to weigh: `uploader: human` means the owner key or the web session, which
   every process of your OS user can use, so it separates credential kinds, not people (§3.1);
   and for revisions stored before S2c you choose between (a) keeping their rule-tier
   acceptances, listed once under „Vor der Vertrauensregel angenommen“ for a bulk revocation, and
   (b) turning them into proposals at the next ingest. Recommendation: (a). Related: should REST
   ingest and model deletion require a human, or a scope of their own, rather than any
   `analyzr:write` token? In local mode a human-only rule still lets the consultant's own
   processes act with the owner key. Recommendation: decide with the trust policy; until then the
   toolkit's tokens carry no write scope.
2. **Agent summaries for reviewers. Decided 2026-10-15: shown read-only (decision 24.9).** Showing submission summaries in „Offene Fragen“ and the
   model view reverses the resolution of [M3-RELATIONS-PROCEDURE.md](M3-RELATIONS-PROCEDURE.md)
   question 1 (2026-10-08: summaries stay REST-only). They are where agents report gaps today.
   Recommendation: show them, read-only.
3. **Address form in customer-facing interview guides.** Agent-facing and UI texts use „du“
   (AGENTS.md); questions put to customer employees probably need „Sie“. Recommendation: „Sie“ by
   default in guides meant for customers, „du“ for everything analyzr and the skills say to you.
4. **Sample exports.** Can Miragon get trial or sandbox instances (or anonymized exports) of
   ARIS, SAP Signavio, ADONIS, Bizagi and Visio, so the reference notes of §3.8 stop being
   unverified? Customer exports never enter the repository.
5. **S5b: answers that re-queue.** S5b widens the relations judgement basis by the pair's last
   human note and lets notes queue relations and placement tasks; that amends CONCEPT §2, §3 and
   §11 and the M3 and M4 S5 records (§4.5 "Recorded rules"). It also relies on notes blocking
   auto-accept rules (HANDOFF §8 "Auto-accept: notes block"): answer notes keep blocking even if
   you let plain notes through. May it change these rules, and may it land before your live runs?
   It changes nothing in fresh live-run projects but touches the judge-once core.
   Recommendation: yes to the change, after the live runs. S5a (recording and showing answers)
   does not wait for this.
6. **Erasure of customer data.** M6 puts customer models and free texts into the append-only
   store, and nothing erases them: model deletion is soft and no route deletes a project (§7
   "Privacy"). Options: one database (compose project) per customer engagement in local mode,
   dropped at its end; a project deletion route; or a purge use case as an explicit exception to
   principle 5. Recommendation: one database per engagement for now, a purge use case with server
   mode (R1).
7. **M6 before M5. Decided 2026-10-15: yes (decision 24.6).** Decision 22 makes the process network map the next milestone, and you
   paused it. This concept puts M6 ahead of it, but none of your words quoted in decision 24 says
   so. Please confirm the order; then decision 24 says "amends decision 22's 'next milestone'"
   and HANDOFF §7 "Next milestone" names M6.
8. **Principle 7 and `tools/integrate`. Decided 2026-10-15: principle 7 counts `packages/*`
   only (decision 24.7).** The toolkit's scripts (`inspect`, `normalize-bpmn`, the
   renderer, `transcript-prep`, the bundled CLI) are product logic shipped to consultants, in one
   private workspace package `tools/integrate` outside `packages/*`. M4 treated a sixth package
   in `packages/` as breaking principle 7. Reading proposed here: principle 7 counts `packages/*`
   only (precedents `tools/notices`, `apps/agent-sim`, `apps/demo`). Recommendation: confirm that
   reading. Otherwise S3b ships `inspect` alone as a dependency-free script and `normalize-bpmn`
   waits for an exception. S3b needs the answer.

HANDOFF §8 "First users" is answered in part: the consultant works with the CLI and the skills
(24.1), and answering also works in the web UI (24.3). Manifest upload and preview in the web
follow decision 3. Whether Git/bpmiq.yml import moves earlier stays open.

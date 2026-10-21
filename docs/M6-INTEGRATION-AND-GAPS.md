# analyzr – Milestone M6 "Landscape integration and gap analysis"

Status: in progress (2026-10-15); owner decisions 24, 25, 28, 29 and 30 (§2, HANDOFF §4); S0 (this
concept, revised after review), S1, S3a, S3b, S4, S5a, S5c-1, S5c-2 (answering by action and model
amendments, decision 25, §4.8), S2a (provenance, manifest, stable identity; its web parts came
with the UI simplification's UX8, §8 "S2a as delivered"), S2b (the dry runs) with steps 1 to 5
of its follow-up (the agent work in the dry runs, relations side, placements, the surfaces, the
size of the agents' next run, the integrate plugin 0.1.3 and the identity rows of decision 29
(1), §8 "S2b follow-up step 1 as delivered", "S2b follow-up step 2 as delivered", "S2b follow-up
step 3 as delivered", "S2b follow-up step 3b as delivered", "S2b follow-up step 4 as delivered"
and "S2b follow-up step 5 as delivered"),
S2c-1 (the trust class and the rule tier, §8 "S2c-1 as delivered"), S2c-2 (the fast path for
derived calls, §8 "S2c-2 as delivered"), S2c-3 (owners' rules for derived calls, §8 "S2c-3 as
delivered") and S2c-4 („Vor der Vertrauensregel angenommen“, §8 "S2c-4 as delivered"; with it all of
S2c) and step 1 of S3c (`analyzr-spec/1` and the deterministic renderer, run from source, §8 "S3c
step 1 as delivered") done, the „erste Anfänge“ await the owner's review, and the integrate skill's
pre-approval awaits one live check by the owner (HANDOFF §8); next S3c steps 2–4 (the converter
runner, the CLI core, the integrate plugin 0.1.4), then the safeguard of decision 30 (2), then S6;
after the owner's live runs S5b, S7 and facts v2 · Branch: `feat/integration-and-gaps` ·
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

Decision 25 closes much of joint 3 without touching the judge-once core: the consultant answers
by action, so an answer is a relation, a placement or a decision at once, or an amendment of the
model whose new revision re-queues the model through its `facts_hash` (§4.8). Text stays a note;
S5b and S7 are what make notes reach agents.

### 1.1 The consultant's path

From „Kunde gibt mir einen Export“ to „Landschaft in analyzr, Lücken gelistet“; each step names
the command or screen and the slice that adds it ("today" means it exists now):

1. **Workspace.** Set up a workspace for the customer and file the export under `exports/`
   (§3.7; S3b).
2. **Convert.** `/analyzr-integrate:integrate-landscape <export>`: a bundle and a German report
   (S3b, for BPMN exports); S3c adds Visio, ARIS AML, PDFs and pictures in the same run, through
   `analyzr-spec/1` and its renderer (§3.9, decision 30; the renderer since step 1, in the skill
   from plugin 0.1.4).
3. **Import.** Create the project and import the bundle: `analyzr import <bundle> -p <project>
   --create --name …`, or „Neues Projekt“ and „Hochladen“ with the bundle folder in the web
   (today). The preview („Vorschau“ in the web, `--dry-run` in the CLI) came with S2b; the skill
   recommends it instead of a probe project since plugin 0.1.2 (S2c-2, §3.7 step 5) and, since
   plugin 0.1.3 (S2b's follow-up step 4), runs it itself through a bundled read-only script
   (decision 29 (2)) into an existing project. A bundle
   without a Camunda engine (most exports) gets its unique calls as proposals (the trust rule,
   §3.10): one bulk accept, „Gesammelt annehmen“ after „Importieren“ or the link `analyzr import`
   prints opens the dialog with them selected and one click accepts them before step 5 (S2c-2).
4. **First gap list.** „Offene Fragen“ right after the import, from the deterministic signals
   alone, without an LLM run (S4).
5. **Relations.** Create an agent token and run `/analyzr:relations <project>` or
   `examples/agents/claude-code/run-headless.sh` (today); the next-step block after `analyzr
   import` names it (S1).
6. **Value chain.** The customer's process map as a `.vc.json` from the skill (pushed with
   `analyzr value-chain push` or imported on the chain page), a draft from `draft_value_chain`
   (size limit: §6), or the chain editor (today).
7. **Placements.** `/analyzr:placements <project>` (today).
8. **Review** in the web (today); export the questions to clarify for the customer („Für den
   Kunden exportieren …“ in „Offene Fragen“; the agents' questions only with „Auch Fragen der
   Agenten“, owner decision 26, UX-SIMPLIFICATION.md Q11; S4).
9. **Answers.** Act on each question in „Offene Fragen“ or the model view: link, place, mark
   „Liegt außerhalb der Landschaft“, or fill in a missing call target, name or documentation in
   the model (S5c, §4.8); answer a hold („Antwort geben“) and decide it where the diagrams are
   („Jetzt entscheiden“: the review screen or the chain, decision 26, Q4); the customer's answers
   come back as notes, one by one or from the returned CSV (S5a, simplified by S5c-1).
10. **Next export.** Run the skill again, preview and re-import (S2b); analyzr re-applies its
    model amendments to the new export (S5c-2) and hands over the change list for the source
    tool; notes reach the agents with S5b and S7.

The size and cost of the first agent run on a customer landscape (§6 "Run size and cost
estimate") already matter at step 5, during M6: S1 prints the tasks waiting, and since step 1 of
S2b's follow-up the impact counts the pairs an import sets agents to judge (per request, against
the head, so on a first import across batches a pair between two batches counts in neither; the
„Vorschau“ and the CLI show it since step 3, and their batch notes name that gap), and since step
3b the project summary gives the first run's size, the pairs the waiting tasks will judge
(`ProjectSummary.pairsToJudge`), in „Als Nächstes“, after an import and in the CLI („5 Modelle
warten auf den Agenten · etwa 7.300 mögliche Relationen“).

## 2. Owner decisions 24 (2026-10-15), 25 (2026-10-17), 28 (2026-10-19), 29 (2026-10-20) and 30 (2026-10-21)

Decision 24 is recorded in HANDOFF §4 on 2026-10-15 in short form; HANDOFF §7 names M6 and keeps
M5 paused, and CONCEPT §11 notes what §7 "Deferrals" says. Decision 25 is recorded in HANDOFF §4
on 2026-10-17 in short form, and CONCEPT §11 notes it. The full records:

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
       §10.1). It ships as S2c (the class and the rule tier delivered in S2c-1 on 2026-10-19, the
       fast path for the derived calls in S2c-2, the decision-19 extension in S2c-3 and the list
       „Vor der Vertrauensregel angenommen“ in S2c-4, all three on 2026-10-20, §8 "S2c"; decision
       28 below); besides, the toolkit limits the risk on its side (§3.9: specs
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

25. **Answering by action, and targeted model amendments** (2026-10-17), taken after S5a was
    delivered. The owner wrote: „ich verstehe die Antwortarten nicht? Das soll für den User alles
    möglichst einfach sein, der user soll auch anpassungen am bpmn modell machen können. also
    fehlende Keys setzen, modelle zur Verknüpfung auswählen usw. was bringen die
    Textantworten?“ The agent explained (in German) that text answers are today only stored,
    shown and exported and change nothing automatically (agents read them only from S5b and S7,
    after the live runs), that text helps only for knowledge that does not belong in a model,
    and proposed that every open question offers a direct action, with text only as an optional
    note:

    | Question | Direct action |
    |---|---|
    | Aufrufziel unbekannt, Prozess ohne Verbindung, Nachrichtenpartner fehlt | „Verknüpfen mit …“: pick the target model or process from a list → an accepted manual relation (the backend has it, the UI does not) |
    | Vorgemerkt, Agent unsicher, Frage eines Agenten | accept, reject or correct right from the tab |
    | Prozess ohne Schritt | pick a step → a manual placement (the backend exists) |
    | Externer Partner, Pool ohne Prozess | one click „Liegt außerhalb der Landschaft“ |
    | Aufruf ohne Key, Nachricht ohne Namen, Start/Ende ohne Namen, doppelte Prozess-ID | set the value directly in the model → a new model revision |

    It noted that the last row is new (analyzr so far only stores what was uploaded; CONCEPT §11
    defers "the Web Modeler"), the catch being that models come from Signavio, ARIS & co. and the
    next import overwrites a change made in analyzr. The owner then answered two questions:
    1. **„Wie sollen Änderungen am BPMN-Modell in analyzr funktionieren?“ → „Gezielte
       Ergänzungen (Empfohlen)“**: „Nur die Felder, die eine Frage nennt (Aufrufziel/Key,
       Nachrichtenname, Start/Ende-Name, Prozess-ID), per Formular am Element. Ergibt eine neue
       Revision mit Herkunft „in analyzr ergänzt“. Der nächste Import wendet sie automatisch
       wieder an, solange das Element existiert, sonst wird daraus eine Frage. Exportierbar als
       korrigiertes BPMN und als Änderungsliste fürs Quellsystem.“ Rejected: „Voller Modeler im
       Browser“ (the bpmn-js modeler, everything editable) and „Keine BPMN-Änderungen“ (only links
       and placements in analyzr; models are fixed in the source tool and imported again).
    2. **„Wann soll „Fragen per Aktion beantworten“ kommen?“ → „Jetzt, vor S2 (Empfohlen)“**:
       „Als nächster Slice S5c. Dabei vereinfache ich die Antworten: Die drei Antwortarten fallen
       weg, „Liegt außerhalb der Landschaft“ wird eine eigene Aktion, „Wird im Modell ergänzt“
       ersetzt die echte Änderung, und Text bleibt nur als optionale Notiz.“

    What it amends: CONCEPT §11's deferral of "the Web Modeler", lifted in part (targeted
    amendments of the fields questions name, as revisions; no modeler, §9); S5a's answer kinds
    (§4.5, delivered as recorded in §8 "S5a as delivered"); the order of §8 (S5c before S2); and
    the reading of ADR-0001 (decisions 2 and 3) and CONCEPT principle 3 and §4 that analyzr only
    stores what was uploaded and that a head's bytes are the uploaded ones: analyzr now writes
    *amended revisions*, computed from uploaded bytes (ADR-0001's header and CONCEPT principle 3
    and §4 carry a forward note since decision 25 was recorded; §7 "Decision 7"). Imports stay one-way
    (decision 7): nothing is written back to the source tool; the corrected BPMN and the change
    list are downloads for the human. Specified in §4.8; slices S5c-1 and S5c-2 (§8). The concept
    also extends S2c's rule (decision 24.2): a call target a human set by amendment counts as
    modelled, whatever the class of the uploaded revision (§3.10). It refines „solange das
    Element existiert“: a field the tool changed since is not overwritten but asked about
    (`value-changed`), and a value the tool took over counts as carried over („im Quellsystem
    übernommen“) and is not written again (§4.8 c). It leaves process ids out of the first
    amendments and adds process documentation, which the option text did not list. §10.9 asked
    the owner to confirm the fields, the 24.2 extension, the refinement and the treatment of
    linked diagrams. **Owner answers 2026-10-17** (AskUserQuestion, each the recommended option):
    1. **Fields:** „Ohne Prozess-ID, mit Doku (Empfohlen)“: call target, message name, start/end
       name and the documentation of a process that has none; „Gültige Kopie wählen“ for
       duplicate process ids, the rename stays in the tool.
    2. **Amended call targets:** „Ja, gilt als modelliert (Empfohlen)“: extends decision 24.2 as
       §3.10 "Added with decision 25" says.
    3. **Re-import:** „Nicht überschreiben (Empfohlen)“: a field the tool changed since becomes
       „Ergänzung nicht mehr anwendbar“, a value the tool took over counts as carried over.
    4. **Linked diagrams:** „Erst verknüpfen, Umbau später (Empfohlen)“: „Verknüpfen mit …“ from
       the model view now (S5c-1), the conversion operation once a real or sandbox export
       confirms the shape (§6, §10.4).

Decision 28 (2026-10-19, at the start of S2c; HANDOFF §4) answers the three open points of the
S2c plan, each with the recommended option, and refines 24.2 and 25.2: „Streng“ (a rule for
derived call proposals names only „Export“, „Konvertiert“ or „Ohne Angabe“, and no rule ever
accepts calls of a revision uploaded with an agent token), „Ja, wie gesetzt“ (a call target the
source tool took over, `in-source`, counts as modelled like an applied one) and „Nur die heute
abgeleiteten“ (the list „Vor der Vertrauensregel angenommen“ holds only pre-S2c acceptances whose
revision would classify as derived from what it carries). §3.10 "Decision 28" places them.

Decision 29 (2026-10-20, after step 1 of S2b's follow-up; HANDOFF §4) answers two open points,
each with the recommended option: (1) **provenance of unchanged bytes** (§10.10) gets option (b),
an append-only identity row per import and model (system, tool id, tool folder, link), written
also for an unchanged file whose declaration differs; `external-ids`, the change list,
„Herkunft“ and the identity warnings read the newest row; no re-analysis, `facts_hash` untouched.
It is step 5 of S2b's follow-up, its own step after steps 1–4 (migrations 0021/0022), before the first
customer re-export, delivered on 2026-10-20 (§8 "S2b follow-up step 5 as delivered").
(2) **The integrate skill's pre-approved preview** (§3.1, §3.7 step 5) is no
CLI pattern but a read-only script bundled with the plugin, `analyzr-read.mjs`, which
`allowed-tools` pre-approves: it has only `GET …/models`, `GET …/external-ids` and
`POST …/imports` with `dryRun=true` built in, talks to loopback hosts only and follows no
redirect; the real import stays with the consultant. A rule over the CLI form is not safe:
`import b -p p --create --name --dry-run` parses `--dry-run` as the value of `--name` and imports for real, the
CLI's prefix differs per workspace, and `--url` could send the key elsewhere. It came with
plugin 0.1.3 (step 4 of the follow-up, §8 "S2b follow-up step 4 as delivered").

Decision 30 (2026-10-21, at the start of S3c; HANDOFF §4) answers the questions of the S3c plan,
each with the recommended option: (1) **„Agent liest ab (Empfohlen)“**: pictures and PDFs are read
by the session agent itself, with its own file reader only, and become `reconstructed` specs with
`llmModel`; no vision pipeline is built and analyzr holds no LLM key (§3.7 step 2, §3.8, §9). (2)
**„Ja, als kleiner Schritt (Empfohlen)“**: a safeguard so owners' agent rules (decision 19) never
accept relations or placements with a `reconstructed` (from S6 also `as-told`) endpoint, as its own
small server step after S3c and before S6, not part of S3c (§3.10 "Decision 30 (2)", §10.11). (3)
**„Ja, immer aktuell (Empfohlen)“**: the bundled CLI `analyzr.mjs` bundles `apps/cli`, the client
and the contracts, so every change there needs a new integrate plugin version, which the drift test
enforces (§3.7 "Reaching analyzr"; S3c steps 3 and 4). (4) **„Alle wie empfohlen (Empfohlen)“**: A1,
converters of interpretive formats (EPCs, plain flowcharts) declare `reconstructed` (§3.2, §3.8,
§3.9); A2, no key and no name in the spec, keys only through `keymap.json` and `plan` (§3.9); A3,
category id prefixes (`Activity_`, `Event_`, `Gateway_`, `Flow_`, …) built by one capped,
collision-checked id function (§3.4 rule 2); A4, the converter runner in its own script
`analyzr-convert.mjs` (§3.7); A5, without a checkout the skill proposes the bundled CLI, and the web
stays in the report (§3.7 "Reaching analyzr"). The passages it changes say "(decision 30)"; HANDOFF
§4 lists what each part amends. Open, not decided: calls from ad-hoc converters later (§10.12). Step
1 of S3c delivered (1), A2 and A3 as far as the spec and the renderer go (§8 "S3c step 1 as
delivered").

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
  of every command that is not pre-approved: the skill pre-approves only its own read-only
  scripts (`inspect.mjs`; since plugin 0.1.3 `analyzr-read.mjs` for analyzr's reads: the models,
  the external ids and the dry run), and the consultant does not run it in a bypass or auto-approve mode
  (Codex with approvals on). By decision 29 (2) no rule over any CLI form is pre-approved, so the
  dry run is pre-approved only as the plugin's read-only script (§3.7 step 5), never as a pattern
  over `analyzr import`, which a real import can match. A stronger setup denies the agent the owner key file (a Claude Code
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
| `converted` | deterministic code transformed it one to one (BPMN, or shapes that are BPMN or carry process semantics one to one: the Visio BPMN stencil, AML BPMN models); `converter` names a bundled converter (`name@version`) or an ad-hoc script (`adhoc:<first 12 hex of its sha256>`); ad-hoc converters emit `analyzr-spec/1`, never BPMN (§3.9) |
| `reconstructed` | an LLM derived it: the session agent read a picture or PDF with its own file reader and wrote the spec (no vision pipeline), or an ad-hoc converter interprets an ambiguous format (EPC semantics, plain flowcharts), then with `converter` `adhoc:…`; `llmModel` required. A converter run declares `converted` or `reconstructed` per mapping, as the consultant confirms it with the path (decision 30) |
| `as-told` | from interviews (Part C); `from` lists opaque source ids (`src-…`), never names or excerpts |

A kind `generated` (an LLM wrote the model from an SOP or a process description) is added when a
skill produces it; no M6 slice does.

`losses` counts what a conversion dropped (`element-dropped`, `attribute-dropped`,
`link-unresolved` for a tool link to a model not in the export or a call the renderer did not
write, `layout-generated`, `id-rewritten`, `text-truncated`; S3b adds `layout-missing`, and a newer
converter's code, any lowercase slug, is stored as declared), at most 20 entries, counts only. The
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
| `externalId`, `externalPath`, `url` | manifest (declared, not checked beyond the URL scheme); with `system` also recorded per import and model in `model_identity` since S2b's follow-up step 5, whose newest row is the model's identity (§3.4) | „Im Quellsystem“ and „In Signavio öffnen“ (named after the system) for an http(s) URL (`rel="noopener noreferrer"`, as M4 links), from the newest row |
| `derived {kind, converter, llmModel, from}` | manifest (declared) | badges „Konvertiert“, „KI-rekonstruiert“, „Aus Interview“ |
| `losses` | manifest (declared) | „Verluste bei der Konvertierung“ |
| `upstream`, `amendments` (S5c-2, decision 25) | server: `upstream` on an amended revision (`kind: 'amendment'`), the uploaded revision it is computed from; `amendments` on a head with live amendments, each with its outcome (§4.8 c) | „In analyzr ergänzt (aus r3)“ |
| `trust` (`{class, reasons}`, S2c-1, decision 24.2) | server, last, on every uploaded revision stored since S2c-1 (`trustOf` in `apps/server/src/domain/trust.ts`): `modelled` when `engine` is `c7` or `c8`, `uploader` is `human` and `derived.kind` is absent or `export`, else `derived` with its reasons in the order `no-engine`, `agent-upload`, `converted`, `reconstructed`, `as-told`; never declared (a manifest's `trust` is dropped); absent on an amended revision (readers follow `upstream`) and on revisions stored before S2c (they count as modelled, option (a), until the owner reviews them; since S2c-4 the review is stored apart in `revision_trust_review`, never in `source`, and read where `trust` is absent) | for a derived one „Aufrufe: nur als Vorschlag (ohne Camunda-Engine)“ in „Herkunft“, and the rationale of its call proposals (§3.10) |

Since decision 24.2 amends decision 9 (§3.10, delivered in S2c-1), declared values can only lower
trust, never raise it. Identical bytes stay `unchanged` and keep the first revision's provenance
and trust class (append-only; since S2c-1 the warning `trust-kept` says when the request would
have classified them differently); a
correction needs new bytes. Their identity (system, tool id, tool folder, link) is recorded all the
same since S2b's follow-up step 5 (decision 29 (1), §10.10: a folder move keeps a Signavio export's
bytes): an append-only identity row per import and model, written also for an unchanged file whose
declaration differs, which `external-ids`, the change list, „Herkunft“ and the identity warnings
read as the newest row; the warning `provenance-kept` now says only that the manifest declares
another derivation, which stays with the revision (S2a: another place in the tool). A revision
stored without a manifest declares nothing and writes no row: the newest row stays the identity (S2a
read the newest revision a manifest declared), so such an upload never erases a declared identity.
An amended revision keeps no manifest fields of its own: readers of
provenance (the „Herkunft“ panel, `external-ids`, the trust class of S2c) follow `upstream` to
the uploaded revision, so S2a extends the uploaded revisions only. Its own `uploader` and
`principal_id` are those of the request that caused it (the human for an amendment write or a
withdrawal; the importer, `sourceKindOf(actor)`, at a re-import or a revival); they never raise
the trust class, which comes from `upstream`'s revision except for `call-target` amendments that
are applied or taken over by the source tool (`in-source`, decision 28 (2); §3.10). The fields analyzr adds itself aim to hold no personal data: the
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
   `GET /projects/{p}/external-ids?system=<s>` (key, `externalId` and `externalPath` of each live
   model as the newest import declared them: its newest identity row since S2b's follow-up step 5,
   also for unchanged bytes; S2a read the head's uploaded revision, or the newest revision a
   manifest declared when the head came without one; the skill's part since plugin 0.1.3,
   `normalize-bpmn.mjs plan --from-analyzr`, §3.7 step 3).
2. **Element ids come from tool ids, never regenerated.** A converter derives every id from the
   source object's id, at most 255 characters (`packages/contracts/src/refs.ts`): `normalize-bpmn`
   passes the tool's ids through and rewrites only unsafe or duplicate ones (`<Type>_<NCName-safe
   source id>`, a prefix for ids starting with a digit, a deterministic suffix on collisions), and
   the renderer of `analyzr-spec/1` writes `<Category>_<source id>` with one prefix per category
   (`Activity_` for every task kind, collapsed subprocesses and calls, `Event_` for every event,
   `Gateway_`, `Flow_`, `MessageFlow_`, …), built by one capped, collision-checked id function, so a
   type refinement (a task that becomes a send task, an event that turns from catch to throw, later
   a collapsed subprocess that becomes a call) keeps the id and every anchor on it (decision 30). A
   converter that regenerates ids sends accepted relations to `changed`/`missing` on every re-import
   and re-queues every model (decision 17).
3. **Bytes are reproducible.** Converters write no timestamps or volatile metadata, so a
   re-export of an unchanged model is `unchanged` (content hash), not a new revision.

The import result and the dry run carry two warnings; the import proceeds:

- `external-id-moved`: the same `(system, externalId)` already belongs to another live key (a
  likely rename in the tool); since S2b's follow-up step 5 compared with the keys' newest identity
  rows, an earlier unchanged file of the request counting too.
- `external-id-changed`: the key's identity (since S2b's follow-up step 5 its newest identity row;
  in S2a its head revision) carries a different `(system, externalId)` than
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
  - **S2c-1:** the trust rule planned like the import (§3.10): each created or revised file's
    would-be class (`ImpactFile.trust`), classified by the dry run's own credential (a read-only
    token previews the files as agent uploads), and the unique calls of derived callers that would
    only be proposed (`callsProposed`, apart from `proposalsAdded`, with `wasAccepted` per item and
    the totals `wasAccepted` and `byReason` over all of them, past the cap).
  - **Follow-up, right after,** in steps:
    - **Step 1, the relations side (delivered 2026-10-20, §8 "S2b follow-up step 1 as
      delivered"):** `relationsTasks`, required, REST only: the relations tasks the write queues
      (`queued`) and cancels (`cancelled`, the claimed ones first with the holder's handle and
      the length of their assignment; `claimed` counts them past the cap: their work is lost),
      planned with the write's own pure `planQueue`; `pairs`, the typed pairs agents judge
      around the queued models after the write (an upper bound while other models' tasks wait);
      and `rejudged`, those of them whose current agent judgement the write makes non-current
      (judged again, the cost signal). The head then also covers the current judgements and the
      open tasks. A deletion cancels the model's open task and queues nothing.
    - **Step 2, placements (delivered 2026-10-20, §8 "S2b follow-up step 2 as delivered"):**
      only for a project with a live value chain, optional and REST only (a project without one
      has neither field): `placementsChanged`, the accepted placements whose process the write
      turns `changed` or `missing` (where the write's refresh records
      `placement.endpoint_changed`; held and obsolete placements and those on removed steps are
      not named), sorted by process, then step; and `placementTask`, the chain's placement task
      after the write (`queued`, `open`, `deferred` while an agent holds it, `nothing-due`, or
      `not-triggered` for a layout-only upload or a deletion, which never queue) with the open
      processes due after the write (`due`), those of them not due before (`newlyDue`) and those
      of these an agent had judged (`again`, placed again). Due-ness comes from the pipeline's
      own input hashes over the head and the would-be head, with the rule tier's placement
      writes planned as the write records them. The head then also covers the chain's
      structure, placements and their histories, the agent's verdicts and the open placement
      task.
    - **Step 3, the surfaces (delivered 2026-10-20, §8 "S2b follow-up step 3 as delivered"):**
      the „Vorschau“ names the agent work in the last of its three lines, on a first import too
      (for example „214 mögliche Relationen zu beurteilen (56 davon erneut), 7 Prozesse zu
      platzieren“): the relations part only when `pairs` is above 0, „(N davon erneut)“ for the
      pairs judged again; the placement part when the write triggers the placement task and it
      has processes to place (a task the write queues places every process due, one waiting or
      held by an agent the newly due ones, so with the held-claim rule also a deferred task),
      „(N davon erneut)“ for those placed again; „etwa“ in front for more than one batch. A
      placements line right after the endpoints line („1 angenommene Platzierung mit geändertem
      oder fehlendem Prozess“), and in „Was ändert sich?“ the lists „Angenommene Platzierungen mit
      geändertem oder fehlendem Prozess“ and „Mögliche Relationen, die erneut beurteilt werden“.
      While the import cancels a relations task an agent holds, the warning „Ein Agent bearbeitet
      „vertrieb/auftrag“ gerade; seine Arbeit geht verloren.“ and a second click („Trotzdem
      importieren“). `analyzr import --dry-run` prints `agent work: …`, `cancel relations tasks:
      …` and `warning: …` right after the facts line and the placements line after the endpoints
      line; `analyzr models delete` lists the task cancelled, the placements losing their process
      and the processes made due. **„etwa“ across batches:** each batch counts against the head
      without the others, so a pair between two models of the head in two batches counts in both,
      one between new models of two batches in neither (on a first import in parts most of them);
      „etwa“ / "about" is no bound either way, so the batch notes name the gap on a first import
      („Vorschau je 50 Dateien; Aufrufe zwischen den Teilen erscheinen hier als unaufgelöst,
      mögliche Relationen zwischen neuen Modellen verschiedener Teile fehlen in der Zahl.“; the
      CLI: "and the pairs between new models of different batches are not counted"); the
      backlog's count, step 3b, is the full fix.
    - **Step 3b, the size of the agents' next run (delivered 2026-10-20, §8 "S2b follow-up step
      3b as delivered"):** `ProjectSummary.pairsToJudge`, required, REST only: over the stored
      head, the distinct typed pairs the next claims of the relations tasks an agent may claim
      now will be assigned, that is the queued ones (the models „warten auf den Agenten“) and the
      claimed ones whose lease ran out with attempts left; a pair between two such models counts
      once; pairs with a current agent judgement and those a decision settles are left out, as in
      the dry runs; a task whose lease runs counts not, and neither does a pair of its assignment
      with such a model its claim saw as it is now (`planClaim`'s rule 1). Exact for the stored
      state when read (on 496 models, after a partial re-import, the next 440 claims'
      assignments together are 16,586 pairs, equal to it); "about" („etwa“), as decisions and
      imports before the claims change it and agents may examine more pairs than they are assigned.
      „Als Nächstes“ names it beside „Agent starten“ or „Agent verbinden“ and in the waiting line
      („5 Modelle warten auf den Agenten · etwa 7.300 mögliche Relationen“), so does the waiting
      text on „Hochladen“ after an import, and the CLI's waiting line of `analyzr import` and the
      models line of `analyzr status` (`about 7300 pairs to judge`); the batch notes point there
      („…; die ganze Zahl steht nach dem Import unter „Als Nächstes“.“, `(after the import, the
      waiting line and analyzr status count them)`). It reuses what the summary already reads: the
      per-model candidates come from the open questions' whole-project candidate pass (the new
      `projectCandidates` of `@analyzr/relations`), the summary is memoized per project state as
      before, now also until the earliest live lease runs out.
    - **Step 5, the identity rows (delivered 2026-10-20, §8 "S2b follow-up step 5 as delivered";
      decision 29 (1)):** an unchanged file the manifest lists whose declared identity differs from
      its model's newest identity row carries `identityUpdated: true` in its outcome, the same in
      the dry run and in the import, which records it (REST only, `ImportImpact` unchanged, so the
      merge across batches and the integrate plugin stay); the absent keys compare the manifest's
      `source.scope` with the newest rows' folders, so a scoped partial export after a folder move
      names the right models.

  Lists are capped at 100 with counts.
- **REST:** `POST …/imports?dryRun=true` and `PUT …/models/by-key/{key}?dryRun=true` answer the
  import result plus `impact`; `GET …/models/{m}/deletion-impact` runs the same function with the
  model removed. Permission `read`: a dry run writes nothing and takes no project lock, so the
  skill can run it with the consultant's credential or a read-only token (§3.1).
- **Limits:** one dry run covers one request (≤ 50 files, 25 MB). A larger bundle gets one dry run
  per batch, each against the head; a call from batch 1 into batch 2 shows as `unresolved-call`
  in batch 1's preview, and the CLI and the „Vorschau“ say so (since the follow-up's step 3 also
  that the pairs between new models of different batches are not counted: the CLI always, the
  „Vorschau“ when new models lie in two batches or more; since step 3b where the whole number
  shows after the import). Multi-batch imports are not atomic today
  either; a staged import with an exact preview is a later candidate (§6).
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
| Open questions | none | S4: `analyzr questions`; S5a: `analyzr questions answer` (also `--from <csv>`); S5c-1: `analyzr questions outside\|link\|place`, notes without a kind |
| Model amendments | none | S5c-2: `analyzr models amend\|pull`, `analyzr amendments list\|export\|withdraw` |
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
  scripts/analyzr-read.mjs (read-only preview, decision 29 (2))  # 0.1.3, S2b's follow-up step 4
  scripts/analyzr-spec.mjs (renderer, §3.9), scripts/analyzr.mjs (CLI)   # S3c, 0.1.4
  scripts/analyzr-convert.mjs (converter runner, decision 30)         # S3c, 0.1.4
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
  converters/                         # ad-hoc converters (adhoc:<sha>) for analyzr-convert.mjs, S3c
  specs/<YYYY-MM-DD>-<system>/        # analyzr-spec/1 files from a converter run or the agent, S3c
  keymap.json                         # (system, externalId) → key, the key rule and scope per system
  bundles/<YYYY-MM-DD>-<system>/      # the bundles (§3.2)
  reports/<YYYY-MM-DD>-<system>.md    # the German reports
  reports/<YYYY-MM-DD>-<system>.*.json  # the scripts' results (plan, bundle, models, external-ids, preview)
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
3. else, from plugin 0.1.4 (S3c step 4), the bundled CLI (decision 30): the workspace records
   `"cli": "plugin"`, which the skill expands to `node <absolute plugin path>/scripts/analyzr.mjs`
   on every run (`$CLAUDE_PLUGIN_ROOT` is not set in the consultant's terminal);
4. else, or when the consultant prefers it, the web: the models through „Hochladen“ with the bundle
   folder (with manifest and „Vorschau“ from S2), the chain through the `.vc.json` import on the
   chain page (both exist today); the workspace then records `"cli": null`.

The report always gives the command and the web path. The skill's own reads and its preview do
not depend on that path: since plugin 0.1.3 they go through the plugin's `analyzr-read.mjs`
(step 5), which talks only to an analyzr on this machine (127.0.0.1, `[::1]`, `localhost`) with
`ANALYZR_TOKEN` or the owner key file, found as the CLI finds it; the CLI's read commands and dry
run are its fallbacks, each approved once by the consultant. From plugin 0.1.4 (S3c step 4) the
generate script also bundles `apps/cli` with the client and the contracts, every command but `seed`
and `mcp`, into `plugins/analyzr-integrate/scripts/analyzr.mjs` (self-contained, drift test), so
`node <plugin>/scripts/analyzr.mjs import …` works anywhere with Node 24 and names itself in the
next steps it prints; it sends the owner key only to an analyzr on this machine. By decision 30 (3)
every change of `apps/cli`, `packages/client` or `packages/contracts` then needs `generate` and a
new integrate plugin version (the drift test enforces it); `analyzr-read.mjs` stays zod-free.

**`/analyzr-integrate:integrate-landscape <export> [--workspace <dir>]`** (`disable-model-invocation:
true`; Claude Code and Codex, since it needs a shell). The project comes from
`analyzr-workspace.json`; on first use the skill asks for the project key and name and prints the
import with `--create --name …`.

0. **Reach analyzr** as above and read or create the workspace.
1. **Inspect** the export with `scripts/inspect.mjs` (deterministic: file types, sizes, encodings,
   XML root elements and namespaces, zip contents) and identify the tool from markers
   (`reference/*.md`).
2. **Choose a path:** BPMN 2.0 → `normalize-bpmn`; another machine-readable format → an **ad-hoc
   converter** the agent writes into `<workspace>/converters/`, deterministic, one spec per model,
   ids from source ids, emitting `analyzr-spec/1` only, which the renderer turns into BPMN (S3c);
   only the plugin's `analyzr-convert.mjs` runs it, recorded as `adhoc:<first 12 hex of its
   sha256>`, and the run declares `converted` for a one-to-one mapping (the Visio BPMN stencil, AML
   BPMN models) or `reconstructed` for an interpretive one (EPCs, plain flowcharts; decision 30); no
   machine-readable model (PDF, picture) → the session agent reads it with its own file reader and
   writes a spec YAML, `reconstructed` with `llmModel` (S3c; no vision pipeline, decision 30 (1)).
   Until plugin 0.1.4 (S3c step 4) only the BPMN path ships: for other formats the skill reports
   what it found and stops. **The consultant confirms** the detected tool, the format and the path,
   for a converter also the derivation.
3. **Keys.** On a system's first import **the consultant confirms** the key scheme before any
   bundle is written: the rule, 10 example keys and every collision; the answer goes into
   `keymap.json`. On a re-import the skill lists new, moved and absent keys from `keymap.json`
   (from S2b also from the dry run) and asks before it changes the map. It asks „Vollständiger
   Export oder Ausschnitt?“ and records a partial export's tool folders as `source.scope` and in
   `keymap.json`. A missing or stale `keymap.json` is rebuilt from analyzr (§3.4, from S2a; the
   skill's part since plugin 0.1.3, S2b's follow-up step 4, §8 "S2b follow-up step 4 as
   delivered"): the skill reads the project's models and identities with `analyzr-read.mjs
   models` and `external-ids` and plans with `--existing` and `--from-analyzr` whenever it could
   read them (analyzr has the project and answers). A system missing from the map gets analyzr's
   keys, tool ids and folders, with the key rule inferred from the (`externalPath`, key) pairs (the
   rule that derives most keys, a tie to the simpler one) and confirmed by the consultant; a system
   the map has gets the keys it lacks, and its entries never change. A tool id several keys carry
   (after `external-id-moved`, one tool model twice) stays with the key the map gives it, else with
   the older model's (the smallest model id) that has a tool folder; the other keys keep their
   folder only and go to the consultant as likely duplicate imports, with the `models delete`
   command; without model ids none keeps it and the plan matches by path. Keys without a tool folder
   are skipped and named, an identity the map gives another key is a conflict. The skill reports it
   in German („Die Schlüsselzuordnung für „signavio“ fehlte; ich habe sie aus analyzr
   wiederhergestellt: 6 Modelle, Regel „ohne den Ordner „Gemeinsame Dokumente““ (passt zu 6 von
   6).“, „Die Werkzeug-ID „…“ tragen „a“ und „b“: „a“ (älter) behält sie; „b“ ist vermutlich doppelt
   importiert.“).
4. **Emit the bundle** (§3.2) under `bundles/`, every file at its pinned key's path; the
   inventory, if any, gives the coverage line and the request list.
5. **Preview** (from S2b): `analyzr import <bundle> -p <project> --dry-run`, with `--token` if
   the workspace names a read-only token (§3.1; since plugin 0.1.3 a read token is
   `ANALYZR_TOKEN`, set in the shell that starts Claude Code, never in the workspace, which holds
   no secrets, and `analyzr-read.mjs` refuses `--token`). Until plugin 0.1.2 (S2c-2) the report
   suggested a probe project for a first import (`analyzr import <bundle> -p <kunde>-probe
   --create`; no route deletes a project, so probe projects stay in the list); since then it
   recommends the dry run, which needs an existing project. **Decision 29 (2)** (2026-10-20): the
   skill runs the preview itself only through the plugin's read-only script
   `scripts/analyzr-read.mjs` (since plugin 0.1.3, S2b's follow-up step 4: `preview <bundle> -p
   <project> --url <analyzrUrl> --json-out <workspace>/reports/<…>.preview.json`), which
   `allowed-tools` pre-approves: its guarded requests are only `GET …/models`, `GET …/external-ids`
   and `POST …/imports` with `dryRun=true` built in, to loopback hosts only, without redirects and
   without a proxy, so it cannot import. It sends the bundle as `analyzr import <bundle> --dry-run`
   does (batches of at most 50 files and 25 MB, each with the whole manifest) and merges the batches
   with the CLI's and the web's merge. Into an existing project only: for a missing one the skill
   says „Das Projekt <project> gibt es in analyzr noch nicht. Leg es an („Neues Projekt“ im Web),
   dann zeige ich dir die Vorschau.“ No rule over the CLI form is pre-approved (`import b -p p
   --create --name --dry-run` parses `--dry-run` as `--name`'s value and imports for real; the CLI's
   prefix differs per workspace; `--url` could send the key elsewhere); the CLI's `--dry-run` stays
   the fallback, printed for the consultant (approved once, never with "don't ask again", if the
   agent is to run it), and the real import stays with the consultant (step 7). Whether the
   pre-approval holds beyond the turn that invoked the skill, and the other points of a live
   session, are for the owner to check once (HANDOFF §8).
6. **Report** in German under `reports/`: tool and format found, what was converted and lost
   (every `link-unresolved` link listed), the keys, the extractor warnings with their German
   labels (S1), from S2b the impact (every rule-tier call the import would newly accept,
   findings, relations turning `changed`/`missing`, absent keys), since plugin 0.1.3 a section
   „Vorschau“ in the words of the web's „Vorschau“ (the headline, the impact lines, the agent
   work „214 mögliche Relationen zu beurteilen (56 davon erneut), 7 Prozesse zu platzieren“ with
   „etwa “ for more than one batch, the claimed-task warning, the batch notes), three lines of the
   skill's own from the plan where the web has none („Neue Aufgaben für den Agenten: 12 Modelle;
   abgebrochen: 2“, the advice „Warte am besten, bis er abgegeben hat, oder nimm den Verlust in
   Kauf.“ after the warning, „Ein Agent platziert gerade; geänderte Prozesse kommen danach noch
   einmal.“) and a „Kurzfassung“ line naming the agent work, the coverage, open points (models
   likely imported twice with their deletion), and the import as a command and as the web path.
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
| ARIS | AML (XML) for databases or groups, likely with a DOCTYPE; BPMN 2.0 export of BPMN diagrams; EPCs and value-added chain diagrams | AML: an ad-hoc converter to specs, run by `analyzr-convert.mjs` (S3c), `converted` for BPMN models and `reconstructed` for EPCs (decision 30); value-added chain → `.vc.json` | a DOCTYPE anywhere is refused (`doctype-forbidden`), so AML never enters directly |
| Microsoft Visio | VSDX, an OPC zip of XML parts; what the BPMN stencil stores per shape; off-page references | an ad-hoc converter to specs, run by `analyzr-convert.mjs` (S3c), `converted` for the BPMN stencil and `reconstructed` for plain flowcharts (decision 30) | not BPMN, refused (`not-xml`/`not-bpmn`); the model view needs BPMN DI (`apps/web/src/components/bpmn-canvas.tsx` imports with bpmn-js), so a converter must produce layout |
| BOC ADONIS | ADOxx XML; a BPMN 2.0 export | BPMN path if available, else ad hoc | as for any BPMN |
| Bizagi Modeler | `.bpm` package; a BPMN 2.0 export | BPMN path | as for any BPMN |
| Camunda Modeler, Web Modeler | BPMN 2.0 with Camunda extensions | direct import (works today) | `engine` c7/c8 detected |
| PDF, screenshots, slides | images | the session agent reads them with its own file reader and writes a spec, `reconstructed` with `llmModel` (S3c; no vision pipeline, decision 30 (1)) | `inspect` classifies `pdf` and `image`; the renderer's BPMN has DI, so the model view draws it |

Each `reference/<tool>.md` has the sections "Export paths", "What arrives", "Pitfalls", "Mapping
to analyzr" and a status line ("unverified: based on public documentation" until a sandbox
export confirms it).

### 3.9 Spec YAML and the deterministic renderer

The only thing an LLM writes for BPMN is a spec YAML, directly or through an ad-hoc converter;
code renders the BPMN with DI. The eval generator (`eval/tools/SPEC.md`,
`eval/tools/lib/{schema,model,layout,bpmn}.mjs`) is the precedent but requires `engine: c7|c8`
and must stay byte-identical (`validate.mjs` compares the corpus with a fresh generation), so it
is not reused in place.

- **`analyzr-spec/1`** (decision 30): one file per model, YAML 1.2 (core schema) or JSON, checked
  strictly (an unknown key is an error, ids are YAML strings). It carries no key and no name: keys
  come only through `keymap.json` and `plan` (§3.4 rule 1, so the consultant's key confirmation is
  never bypassed), and analyzr names a model after its first process. The fields: `format`; `source`
  (`externalPath`, the tool folder and model name the key derives from; from a converter also
  `externalId` and `url`; `file` for the report only); `derived` (`reconstructed` with `llmModel`,
  or `as-told` with opaque `from` ids), only in a spec the agent writes, since a converter run
  declares the derivation itself (§3.7 step 2); black-box `participants`; `processes` with `name`,
  `documentation`, `pool`, `lanes`, `dataStores`, nodes (`start`, `end`, `task` of kind none, user,
  manual, service, send or receive, `subprocess` collapsed, `call` with a `target`, `event` as a
  catch or a throw with a message, signal, timer or no trigger, `gateway` exclusive, parallel,
  inclusive or event-based) and sequence flows; `messageFlows`; `notes` for the report. Every
  element has a `source` id, from which its BPMN id derives (§3.4 rule 2); `message` and `signal`
  names appear only where the source names them, else the facts key on the label. No engine: the
  output has `isExecutable="false"` and no Camunda namespace, so `engine` is null. The schema, its
  errors and its limits as delivered: §8 "S3c step 1 as delivered".
- **Calls:** a `calledElement` reaches analyzr only from the tool itself (`export`, and
  `normalize-bpmn`, which passes the tool's calls through) and, later, from specs of converters
  bundled with the plugin (`<name>@<version>`; S3c ships none). In S3c no spec yields one, whatever
  its derivation: the schema has no field for it (`calledElement` is an unknown field,
  `callActivity` an unknown type), the renderer no code path, and its self-check refuses a render
  with one. A `call` becomes a collapsed subprocess named after its `target` plus a
  `link-unresolved` loss, and the report lists these links for the consultant, who links them with
  „Verknüpfen mit …“; with the category id prefixes such a link survives a later converter fix
  (decision 30). Ad-hoc converters emit specs only, so the rule applies to them; one that wrote BPMN
  directly would bypass it, which the report's list of newly accepted calls (from S2b) shows (or,
  since S2c-1, its calls only proposed). This limits, without changing decision 9, how often
  decision 9 accepts a call that LLM-written code produced. The rendered models have no engine, so
  since S2c-1 a `calledElement` in them that names exactly one process would become a proposal (tier
  `key`, 0.9) in any case (§3.10); the rule still keeps a guessed target from becoming even that,
  and the rules for derived calls (S2c-3) accept only „Export“, „Konvertiert“ and „Ohne Angabe“
  (decision 28 (1)). The revisit with S2c and its decision-19 extension per converter that this rule
  promised is now an open question: calls from ad-hoc converters whose target is a model of the same
  export, resolved by its tool id, written as proposals (§10.12).
- **Where:** an entry of `tools/integrate` (§3.7): the sources in `tools/integrate/src/spec/` and
  the entry `src/cli/analyzr-spec.ts` with `validate`, `render`, `plan` and `bundle`, run from
  source since S3c step 1 and bundled into `plugins/analyzr-integrate/scripts/analyzr-spec.mjs` with
  plugin 0.1.4 (step 4). `plan` derives the keys from each spec's `source.externalPath` as
  `normalize-bpmn plan` does for an export, and flags `replaces-known-model` when a spec the agent
  wrote would take a key that may belong to a tool's model, a stop in the consultant's key
  confirmation. Its layout started from a copy of the eval layouter (`src/spec/layout.ts`); one
  package shared with the eval generator needs a principle-7 exception and waits until the renderer
  has proven itself.
- **Checks:** a runtime self-check on every render re-reads the bytes with bpmn-moddle and refuses
  the model on any warning, an unsafe, over-long or clashing id, an unresolved reference, missing
  DI, or a `callActivity` or `calledElement`. The renderer's tests extract every rendered fixture
  with `@analyzr/bpmn-facts` (no warnings, `engine` null) and walk it with bpmn-js's tree walker
  under the importer's refusals (in CI); a Playwright check like M4 S3's import harness for chains
  imports the goldens and random renders into bpmn-js (`apps/web/e2e/spec-render-import.spec.ts`,
  not in CI).

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
  Recommendation: (a). Decided (a) with 24.2 and delivered in S2c-1; the list came with S2c-4
  (2026-10-20) and, by decision 28 (3), holds only acceptances whose revision would classify as
  derived.
- Signavio, ARIS or interview models get their calls as proposals, accepted in bulk (since S2c-2
  the key tier's bulk dialog lists them first as their own group, „Eindeutige Aufrufe aus
  abgeleiteten Modellen“, which „Gesammelt annehmen“ opens with exactly those selected) or one by
  one. The read-only system rule „Eindeutige Aufrufe“ says so.
- An owner's auto-accept rule (decision 19) never accepted a rule-tier proposal before S2c-3
  (`not-agent`, `apps/server/src/domain/auto-accept/evaluate.ts`). The recommendation includes
  extending decision-19 rules to rule-tier call proposals of derived revisions, narrowed by
  derived kind and converter, so a trusted converter's calls can be accepted without a click
  (delivered in S2c-3, below). Decision 19's
  agreed design names kind, tier, minimum confidence and optionally an agent or a model, and
  CONCEPT §11 defers further narrowing, so that extension is part of the owner's answer.

The owner agreed with option (a) for older revisions and with the decision-19 extension
(decision 24.2). It ships as S2c; until then §3.9's renderer rule and the
consultant-runs-the-import rule limit the risk. **S2c-1 delivered the class and the rule tier**
(2026-10-19, §8 "S2c-1 as delivered"): the server stores `source.trust` at ingest, the recompute
applies the rule before it plans (`applyTrust`, the one place it is applied), and the rule
proposal carries `attrs.calledElement`, `attrs.match: 'derived-caller'` and the rationale
„Vertrauensregel: Der Aufruf nennt genau einen Prozess, aber das aufrufende Modell gilt als
abgeleitet (ohne Camunda-Engine; über ein Agenten-Token hochgeladen). Darum nur vorgeschlagen.“
(the reasons as the model carries them). Only the caller's class counts. A rule acceptance whose
caller's new revision is derived ends at that ingest (the rule's later proposal ends its
decision), and a re-import as modelled accepts again; human decisions stay in force with the rule
proposing behind them. **S2c-2 delivered the fast path** (2026-10-20, §8 "S2c-2 as delivered"):
„Gesammelt annehmen“ on „Übersicht“ and after „Importieren“, the system rule card's count „N aus
abgeleiteten Modellen vorgeschlagen“ and the link `analyzr import` prints open the bulk dialog
with such calls selected, and one click accepts them before the agent runs (at most 500 at a
time; one an agent asks about or objects to is decided one by one). **S2c-3 delivered the
decision-19 extension** (2026-10-20, §8 "S2c-3 as delivered"): a rule of the third „Art“,
„Eindeutige Aufrufe aus abgeleiteten Modellen“, accepts the rule tier's proposals of unique calls
whose caller declares the source it names („Export“, „Konvertiert“ with one converter, „Ohne
Angabe“), in the write that recorded them (imports, amendment writes and withdrawals, deletions),
never a call of a revision uploaded with an agent token (no agent rule either), and no write made
with an agent token sets it off; the toast after the first bulk accept offers it. **S2c-4 delivered
the list** (2026-10-20, §8 "S2c-4 as delivered"): the owner reviews, once per uploaded revision,
the rule tier's acceptances from revisions stored before S2c that would be derived today, from the
system rule card's line „N vor der Vertrauensregel angenommen – prüfen…“ or with `analyzr rules
pre-trust`; „Zurück in die Prüfung“ records `derived` (the calls become the rule tier's proposals,
which „Gesammelt annehmen“ or an enabled rule for derived calls accepts), „Behalten“ records
`modelled` (they stay accepted). The review lives in the append-only `revision_trust_review` and is
read only where a revision carries no class, so it never overrides the class the server assigned.

**Added with decision 25 (2026-10-17; extends decision 24.2; confirmed by the owner 2026-10-17, decision 25.2).**
A call target set by a model amendment (S5c-2, §4.8 c) was picked by a human from the
landscape's processes, so such a call counts as modelled whatever the class of the uploaded
revision, and the rule tier keeps accepting it; the amended revision's other calls keep the class
of its uploaded revision. The rule tier reads the applied `call-target` amendments from the
head's `source.amendments` and the class of the rest from `source.upstream`'s revision; the
amended revision's own `uploader` (the importer at a re-import, §3.3) never raises it. S5c-2
lands before S2c, so amended revisions stored before S2c carry no `source.trust` either. The modelled
treatment (applied and, by decision 28 (2), `in-source` call-target amendments; not `conflict`)
is delivered in S2c-1; under option (a) the list „Vor der Vertrauensregel angenommen“ (S2c-4,
delivered 2026-10-20) leaves out the calls of both: it names an amended head's uploaded revision,
and a review of it keeps the call whose target was set in analyzr accepted.

**Decision 28 (2026-10-19, HANDOFF §4).** (1) „Streng“: S2c-3's rules for derived call proposals
may name only the derived kinds „Export“, „Konvertiert“ and „Ohne Angabe“ (never
„KI-rekonstruiert“ or „Aus Interview“, whose specs carry no `calledElement`, §3.9), and no rule
ever accepts calls of a revision uploaded with an agent token (safeguard `agent-upload`; delivered
in S2c-3, which reads "no rule" literally, agent rules included, §8 "S2c-3 as delivered").
(2) „Ja, wie gesetzt“: `in-source` counts as modelled (above), so a call stays accepted after the
consultant carried the change list over. (3) „Nur die heute abgeleiteten“: S2c-4's list (delivered
2026-10-20) holds
only rule acceptances from before S2c whose revision would classify as derived from what it
carries (engine null; an agent upload, or a service principal before S2a; a declared kind other
than `export`); Camunda projects, the demo and the live-run projects list nothing. The readings
the S2c plan took without asking stand: the class lives in `source.trust` and amended revisions
store none; a converter matches exactly, version included; a dry run classifies by its own
credential; only the caller's class counts; derived call proposals are assigned to agents like
any rule proposal; the label `analyzr-rules/1.0.0` stays.

**Decision 30 (2) (2026-10-21, HANDOFF §4).** „Ja, als kleiner Schritt“: decision 28 (1) keeps rules
from the calls of „KI-rekonstruiert“ and „Aus Interview“ models, but an owner's agent rule (decision
19) still accepts an agent's relation or placement proposal whatever its endpoints' derivation
(`ruleMatches` in `apps/server/src/domain/auto-accept/evaluate.ts` reads the derivation only for the
rule tier's derived calls), so a message name misread from a whiteboard can end as a relation
accepted by a rule such as „Nachricht ab 0,9“. A safeguard will block a rule whenever an endpoint's
uploaded revision declares `reconstructed` (from S6 also `as-told`), in a small server step of its
own after S3c and before S6; S3c does not change the server. Until then the skill's report says so
for every bundle with reconstructed models (from plugin 0.1.4).

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

- `engine-stripped` costs nothing in the eval, which runs the libraries without the trust rule;
  in analyzr, since S2c-1, every rule-tier acceptance of such a model is a proposal instead
  (§3.10).
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
  state: 'open' | 'answered' // S5a; since S5c-1 `answered` = a live outside mark (§4.8 b)
  actions: OpenQuestionAction[] // S5c-1 (§4.8 a)
}
```

- **Id:** the source version is the head `facts_hash` of the subject's model for findings and
  signals, the assertion id for questions and holds, the placement input hash for unsure
  verdicts, the submission id for summaries. When the source changes, the id changes, and an
  answered item comes back open. Value chain findings are versioned by what they ask about: the
  process model's `facts_hash` (`process-without-step`), the step's fingerprint
  (`step-without-process`) and with the link (`unresolved-link`). **Since S5c-1** findings,
  signals, `process-without-step` and the coded no-links are versioned by what they ask about
  too, not by the whole model: the sorted fingerprints of the item's subject and anchor facts
  (CONCEPT §2), plus what the question reads beyond them (`black-box-partner`: the box id and
  its flows' ends and names; `undocumented-process`: the documentation; `unlabelled-boundary`:
  the ids of the unnamed events; `duplicate-process-id`: the copies' refs and fingerprints);
  `external-partner` and a no-link `call-target-unknown` take the subject's fingerprint instead
  of the no-link ids, so a re-judgement that stores new no-links with the same code keeps the
  item; `descriptive-model` keeps the model's `facts_hash`. Decision 25 makes amendments
  frequent and the outside mark the only `answered` state (§4.8 b), and every amendment writes a
  new `facts_hash`: an amendment or re-import elsewhere in the model must keep the item's id, its
  outside mark and the ids of an exported CSV, while a change at the subject changes them. S5a's
  rows on the agent-created stack `analyzr-local` lose their items once (no real data exists
  elsewhere). A chain finding that goes away
  (a placement accepted) and comes back (the placement revoked or rejected, its step removed)
  therefore keeps its id and its answer, by design (S5a): the answer is about the process or the
  step, not about a placement, and the question's text is the same.
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
`step-without-process`, `unresolved-link`, `external-partner`, `summary-note`, `unjudged`; since
S5c-2 also `amendment-conflict`, source `amendment`, §4.8 c) and these new signals, computed from
head facts:

| Signal | Rule | Question it asks |
|---|---|---|
| `black-box-partner` | a message flow (`MessageFlowInfo.from/to`) ends at a participant that no process fact names as its `attrs.participantId` | external partner or a missing model? (the participant's name needs facts v2; S4 shows its id) |
| `unlabelled-boundary` | a process whose none start or none end events have no label | what starts or ends it? (trigger relations need labelled none events) |
| `message-without-name` | a message event without a `messageRef` name | which message? (no key-tier pairing possible) |
| `undocumented-process` | a process fact without documentation | what does it do? (agents' main evidence for placements) |
| `isolated-process` | no relation in any status and no `rule`, `key` or `lexical` candidate | how does it connect to the rest? |
| `descriptive-model` | `engine` null and every process non-executable | informational: the rule tier finds little here |
| `extractor-loss` (S2) | the revision's stored extractor warnings (S2) with the codes `missing-id`, `invalid-id` or `duplicate-id`, or a `parse-warning` whose message matches `unparsable content\|duplicate ID\|illegal ID` (bpmn-moddle drops a second element with the same id and reports it only as a `parse-warning`, „duplicate ID <…>“; a non-NCName id arrives as „illegal ID <…>“ followed by `missing-id`); not a dropped diagram element (`BPMNShape` …, layout only) or an element of a namespace bpmn-moddle does not know („unrecognized element“, a vendor's extension) | which elements were lost on import? |

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
  in the sheet and S5a reads it back. S5c-1 drops `Antwortart` (five columns, every filled
  `Antwort` a note; §4.8 b). UX2a ([UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §7) adds the
  repeatable filter `group` and the page's `totals` and `askByModel`, holds only the `ask` items
  in an export without `group` (unless `kind` or `source` names what to export), renames the
  contact column `Ansprechpartner` and writes both files for the customer in plain German (§4.8
  a and b).
- **Web:** the tab „Offene Fragen“ after „Befunde“ with its count, filters (Art, Modell oder
  Ordner, Ansprechpartner-Hinweis, Quelle, Status), sorted by `unlocks` (since the owner's
  answer of 2026-10-16 the value chain's findings after the other questions, §8 "S4 as
  delivered"); a section „Offene
  Fragen“ in the model view; buttons „Als Markdown exportieren“ and „Als CSV exportieren“. Agent
  and human texts render with the existing `PlainText` component. The page is a lazy route chunk
  (entry ceiling, decision 21). **Since UX2b** ([UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md)
  §3.3, §7 "UX2b as delivered"): the last of the four project tabs (owner decision 26), its badge
  and count line „21 zu klären“ (`group=ask`, `state=open`); the cards show only „Zu klären“ (the
  agents' questions sit on their proposals and show here only under „Art“ „Frage eines
  Agenten“, the chain's `proposal` items never), then the closed groups „Zur Information“ and
  „Erledigte zeigen“; three filters (Art, Modell oder Ordner, Ansprechpartner), the list open by
  default (`?source=` a removable chip, `?state=answered` opens „Erledigte zeigen“); one button
  „Für den Kunden exportieren …“ opening a dialog („Zum Lesen (Markdown)“, „Zum Ausfüllen (CSV)“,
  „Auch Fragen der Agenten (n)“ off, so the default holds `ask` under the old file name); the
  model view's section „Fragen“ with the `ask` items only.
- **CLI:** `analyzr questions -p <project> [--model <key>] [--kind …] [--group …] [--format
  md|csv|json] [-o <file>]` (`--group` since UX2a).
- **Summaries** (`summary-note`) are shown only if the owner reverses the resolution of
  M3-RELATIONS-PROCEDURE.md question 1 (§10.2); without it S4 leaves them out.
- **MCP** `list_open_questions` (read) comes with S7, after the live runs.

### 4.5 Answering in the UI, and re-analysis only where the input changed

Answering ships in two slices. **S5a** records and shows answers and changes no analysis rule,
so it is live-run neutral and comes right after S4. **S5b** makes answers re-open exactly the
affected judgements; it touches the judge-once core and recorded rules (§10.5).

**Changed by S5c-1 (decision 25; §4.8 b).** What follows describes S5a as specified and
delivered (§8 "S5a as delivered" stays the record). S5c-1 changes: the three answer kinds go from
the dialog, the CLI (`--kind`) and the CSV (`Antwortart`); „Liegt außerhalb der Landschaft“
becomes the one-click action `outside` (an `open_question_answer` row of kind
`outside-landscape` with an optional text, revocable); „Wird im Modell ergänzt“ is dropped in
favour of real amendments (S5c-2); free text stays as „Notiz hinzufügen“ and as the CSV round
trip, and a note no longer makes an item `answered`: only a live outside mark does, while every
other item ends through its action (§4.8 a). Where a note's text lands (the table below) is
unchanged. Rows recorded before keep their kind (append-only) and show as notes, except
`outside-landscape` on a subject that is neither a relation nor a placement.

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
| placement, proposed with an agent question | a human note through the existing placement note use case | as today: the process becomes due (`lastNonAgentSeqs`); nothing is queued | the placement task is queued in the same transaction (`queuePlacementTasks`) instead of waiting for a submit, an ingest or `analyzr value-chain requeue` |
| placement, held | a human note through the existing placement note use case | as today: the hold keeps homing the process (`processHomes.held`), so it is not open and never due; no agent gets it until the reviewer decides the hold | nothing while the hold stands: the process stays homed, so a queued task finds it not due |
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
  revision's declared `derived.kind` (S2a provenance, not S2c-1's trust class `source.trust`) and
  `isExecutable` in the claim input (optional fields in
  `analyzr-claim/1`).
- **`analyzr-placements@0.2.0`:** unsure kinds `no-fitting-step` (with an optional
  `suggestedStep` name: a chain gap the human may draw), `process-unclear`, `several-steps`; the
  same `gaps` field.
- **Claim inputs** gain the subject notes and outside marks (S5a, S5c-1); their `seq` joins the
  relations basis (pairs touching the subject) and `lastNonAgentSeqs` (the subject's processes),
  the latter as `analyzr-placement-input/2`. From then on, recording a subject note or recording
  or withdrawing an outside mark makes those pairs and processes non-current and queues their
  tasks in the same transaction, with S5b's mechanism; the release itself re-offers every pair
  and process (above), so no deploy-time requeue is needed (part of §10.5). Model amendments need none of this: they reach
  agents as facts of a new revision (S5c-2). Optionally the facts a human set by amendment are
  marked in the claim input, so agents weigh them as human input.
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

### 4.8 Answering by action, and model amendments (decision 25)

Every open question gets one obvious action that changes the landscape: a link, a placement, a
decision, the mark „Liegt außerhalb der Landschaft“, or an amendment of the model; text stays an
optional note. Two slices (§8): **S5c-1** wires the actions to use cases that exist, adds the
outside mark and simplifies answers and the CSV, and writes no BPMN; **S5c-2** adds model
amendments. Every action and amendment is a human act: permission `review` (amendments and their
withdrawal also `write`, c), agents get `human-decision-required` with the tab's `reviewUrl` (as
answers, §4.5), the read-only demo `demo-readonly`, and the web hides the actions from viewers.
The one exception is `requeue`, which decides nothing and keeps `requeueAnalyses`' permission
`write`. Agents keep proposing (decision 4).

#### a) The action per kind

The read model computes the actions with each item (pure `actionsFor(item, index)` in a new
`apps/server/src/domain/open-questions/actions.ts`): `OpenQuestion.actions:
OpenQuestionAction[]`, each `{type, primary, label}` plus what the client needs (`pick:
'process' | 'endpoint' | 'step' | 'pair'` for the picker, `multiple`, `suggested: Ref[]` for the
targets a live proposal already names, and for amendments `amend: {modelKey, targets:
{elementId, op, label}[] (1–20, the amendments route's item limit), replaces?}`, one form field
per target, saved in one request). Types: `decide`, `link`, `place`, `choose-copy`, `outside`,
`requeue`, `fix-link`, `amend` and `withdraw-amendment` (S5c-2), `note`. At most one action is
primary; `label` is German and from code, so the tab, the model view and the CLI say the same.
Informational items get none; every other item also has `note` („Notiz hinzufügen“, not
repeated below). Only REST carries `actions` (MCP `list_open_questions` comes with S7).
`actionsFor` reads the chain finding's `state` (`value-chain/findings.ts`: `held`, `proposed`,
`none`) and never offers `amend` on a call whose target is an expression in either dialect
(`^\s*=`, `${`, `#{`), whatever the engine: without an engine facts v1 treat only JUEL as
dynamic (§3.11), so an engine-null `calledElement="=x"` arrives as an unresolved static call. A C7
call of a CMMN case (`camunda:caseRef`, no `calledElement`) also arrives as „Aufruf ohne Key“;
`call-target` refuses it (c), and once S2 stores the extractor's warnings, whose
`call-without-target` names `caseRef`, `actionsFor` makes `outside` its primary action.

| Kind (label) | Primary action | Secondary | Writes | The item ends |
|---|---|---|---|---|
| `call-target-unknown` „Aufrufziel unbekannt“: finding `unresolved-call` without `calledElement` („Aufruf ohne Key“) | `amend` `call-target` „Aufrufziel eintragen …“ (S5c-2; until then `link` is primary) | `link` „Nur verknüpfen …“, `outside` | the amendment: an amended revision (c); `link`: the decision on a live typed proposal or `acceptManual` (`use-cases/review.ts`, existing; "Where the actions write") through the new action route; `outside`: an answer row (migration 0013, b) | amendment: the facts change, the finding goes and decision 9 accepts the unique call; `link`: R1 (below); `outside`: `answered` |
| `call-target-unknown`: `calledElement` set but naming no process (no expression), or a no-link coded `call-target` | `link` „Verknüpfen mit …“ (process picker) | `amend` „Aufrufziel im Modell ändern …“ (S5c-2; with `replaces` and the text „in analyzr ergänzt“ when the value comes from a live amendment), `outside` | as above | as above |
| `call-target-dynamic` „Aufrufziel erst zur Laufzeit bekannt“ | `link` „Mögliche Ziele verknüpfen …“ (`multiple`, at most 10 processes) | `outside` | per target as for `link` above, in one transaction | R1; `answered`. No amendment: an expression is the engine's runtime semantics |
| `duplicate-process-id` „Prozess-ID mehrfach vergeben“ | `choose-copy` „Gültige Kopie wählen …“ | – | the call relations proposed or held towards the copies (`attrs.match: 'duplicate-process-id'`, `packages/relations/src/rules.ts`): accepted towards the chosen copy, rejected towards the others with a German reason, all or nothing with their versions (the bulk decision of `decideRelations`, existing); with „Andere Kopien in der Wertschöpfungskette auf „außerhalb“ setzen“ (checked by default when a chain exists) the other copies not yet homed go to `@outside` through `acceptManualPlacement`, the reason naming the valid copy as decision 18 asks for archived copies; the dialog's note, optional and prefilled („Gültig ist „…“ in …; die anderen Kopien sind veraltet oder Varianten.“), is a note row, no mark; the dialog points at `analyzr models delete` for obsolete copies | R1b (below); the finding stays in „Befunde“ until a copy is renamed in the tool or its model deleted. Copies that are all valid (variants) are decided call by call in the review („Prüfen“) |
| `message-partner-missing` „Nachrichten- oder Signalpartner fehlt“: endpoint without a message or signal name | `amend` `message-name` „Nachrichtennamen eintragen …“ (S5c-2; until then `link`) | `link`, `outside` | the amendment; a name picked from a partner's suggestion sends `partner`, and the same transaction accepts the key-tier proposals between the endpoint and that partner as the human's decision (rationale from code); `link`: as above, from the endpoint to the picked partner endpoint | amendment: the facts change and the accepted relation hides the finding; a free-text name that pairs elsewhere yields key-tier proposals only, which hide the finding too (`visibleFindings` counts proposals), so the form's summary names them and links to „Prüfen“; `link`: `visibleFindings` hides it (existing: any live relation at the end, `domain/findings.ts`), the partner's own finding too; `answered` |
| `message-partner-missing`: named endpoint | `link` „Verknüpfen mit …“ (endpoint picker: the complementary message or signal endpoints of other processes, grouped by model and process) | `amend` „Nachrichtennamen ändern …“ (S5c-2), `outside` | as above | as above |
| `held` „Vorgemerkt“ on a relation | `decide` „Entscheiden“: an inline panel with Annehmen, Ablehnen, Korrigieren (the review screen's components, `components/review/`) | – (the note is the S5a note on the relation) | `decideRelation` (existing route) | decided: no longer `held` |
| `held` on a placement | `decide`: Annehmen, Ablehnen, Korrigieren to another step | – | `decidePlacement` (existing route) | decided |
| `agent-question` „Frage eines Agenten“ (relation or placement) | `decide`, also Vormerken | – | `decideRelation`, `decidePlacement` | decided (`agentQuestions` lists only proposals waiting for review, `sources.ts`) |
| `placement-unsure` „Einordnung unsicher“ | `place` „Schritt wählen …“ (step picker over the live chain) | `place` on `@outside` „Gehört zu keinem Schritt“ | `acceptManualPlacement` (`value-chain/placements.ts`, existing, as `postPlacements` kind `manual` uses it) through the action route, its rationale from code | the process is homed, so its unsure verdict is no longer listed |
| `process-without-step` „Prozess ohne Schritt“, `state: none` | `place` „Schritt wählen …“ | `place` on `@outside` | as above | the finding goes (`@outside` counts, `value-chain/findings.ts`) |
| `process-without-step`, `state: proposed` (an agent's placement waits for review) | `decide` „Vorschlag prüfen“: Annehmen, Ablehnen, Korrigieren on the proposed placement, naming its step | `place` „Anderen Schritt wählen …“, `place` on `@outside` | `decidePlacement` (existing route); `acceptManualPlacement` | decided or homed |
| `process-without-step`, `state: held` | none: the read model drops the item, since the `held` item of the same placement asks it (one question per process) | – | – | – |
| `step-without-process` „Schritt ohne Prozess“ | `place` „Prozess zuordnen …“ (process picker); `decide` „Vorschlag prüfen“ instead while a placement on the step is proposed | `outside`; `place` when `decide` is primary | `acceptManualPlacement` of the picked process on the step; `decidePlacement` | the finding goes; `answered` |
| `unresolved-link` „Link nicht auflösbar“ | `fix-link` „Link korrigieren“: the chain page at the step (`?step=`) with its link editor | – | the chain save with its dry run and `If-Match` (existing, M4 S3) | the finding goes with the save |
| `external-partner` „Externer Partner?“ (no-link coded `collaboration`) | `outside` „Liegt außerhalb der Landschaft“ | `link` „Verknüpfen mit …“ | an answer row; as for `link` above | `answered`; R1 |
| `summary-note`, `descriptive-model` (informational) | none | – | – | with their source (a newer submission, a new revision) |
| `unjudged` „Paare ohne Urteil“ | `requeue` „Erneut einplanen“ | `link` „Paar verknüpfen …“ (`pick: 'pair'`: one of the listed pairs) | `requeueAnalyses` for the analysed model (existing, permission `write`); as for `link` above | when every listed pair has a current judgement or a settling decision (existing rule, `submissionQuestions`), or (S5c-1) an accepted relation of any type between its two refs, so a manual link from „Paar verknüpfen …“ answers its pair |
| `black-box-partner` „Pool ohne Prozess“ | `outside`, next to „Im Modell zeigen“ (the model view at `?element=<box>`, where the canvas highlights and names the pool) | `link` „Verknüpfen mit …“ (process picker): one relation per anchor of the box's flows (below), directed like its flow, in one transaction; offered while at least one anchor exists | an answer row; as for `link` above, per anchor | `answered`; R1 |
| `unlabelled-boundary` „Start oder Ende ohne Namen“ | `amend` `event-name` „Namen eintragen …“, one target per unnamed none start or end event of the process (S5c-2; in S5c-1 only the note) | – | the amendment | the facts change |
| `message-without-name` (off since S4, reserved) | `amend` `message-name` (S5c-2) | `link`, `outside` | as for `message-partner-missing` | the facts change |
| `undocumented-process` „Prozess ohne Dokumentation“ | `amend` `process-documentation` „Dokumentation ergänzen …“ (S5c-2; in S5c-1 only the note) | – | the amendment | the facts change |
| `isolated-process` „Prozess ohne Verbindung“ | `link` „Verknüpfen mit …“ (process picker, process to process) | `outside` | as for `link` above | any relation touching the process (existing rule, `signals.ts`); `answered` |
| `extractor-loss` (S2; not yet in the contracts) | none in analyzr: the elements were dropped on import and are fixed in the tool or with `normalize-bpmn` | – | – | with the next import |
| `amendment-conflict` „Ergänzung nicht mehr anwendbar“ (new, S5c-2, c) | reason `value-changed`: `withdraw-amendment` „Wert aus dem Quellsystem übernehmen“; reasons `element-missing` and `expression`: `withdraw-amendment` „Ergänzung zurücknehmen“ | `value-changed`, only where the op may write over the incoming value (c): `amend` „Meine Ergänzung behalten“ (`replaces` the conflicting amendment; its `before` is the incoming value); `element-missing`: „Alle Ergänzungen dieses Modells zurücknehmen“ | a withdrawal, or a new amendment that supersedes the old one | withdrawn, or applied again |

A conflict's text shows the incoming value and analyzr's value side by side.

**Since UX2a** ([UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §2.4 and §7, owner decision 26):
every item carries a `group` from a `Record` over the kinds (`model.ts`
`OPEN_QUESTION_GROUP_RULES`): `ask` „Zu klären“, `agent` „Fragen der Agenten“ (`agent-question`),
`proposal` (decided on the value chain) and `info` „Zur Information“ (`summary-note`,
`descriptive-model`); a label and a filter, never a sort key, so the order of this section
holds in every filtered list. One question per process extends: `process-without-step` is also
dropped beside an agent's question on a placement of the process or an unsure verdict about it.
`process-without-step` with a proposed placement and `step-without-process` with a proposal on
the step or below it are `proposal` items: their primary action is `decide` „Auf der Kette
prüfen“ with `step` (the chain page's `?step=`) and `decides` the proposals, instead of „Vorschlag
prüfen“ and, for a step whose sub-steps carry the proposals, „Prozess zuordnen …“. The labels of
the table change: `link` beside an `amend` „Nur verknüpfen …“ (else „Verknüpfen mit …“), `amend`
„Ziel im Modell eintragen …“, „Nachrichtennamen im Modell eintragen …“ and „Signalnamen im
Modell eintragen …“ for the empty and the named case alike, `decide` „Vorschlag prüfen“,
`place` on a step item „Prozess platzieren …“, and the kinds „Ziel wird erst beim Ausführen
bestimmt“ (`call-target-dynamic`) and „Partner der Nachricht fehlt“ (`message-partner-missing`).
The question comes first and short (`text`), its reason apart (`detail`, from code; an unsure
verdict's and a coded no-link's agent words verbatim), never the frozen findings' `detail`; a
pool without a process is named „Pool in „<the pool it talks to>““. UX4 joins `link` and
`amend` into one entry in the web.

**Anchors of a pool's flows.** The inside end of a message flow to or from a box is whatever the
flow's other end is: an element with a fact, or one without (a pool whose process the model
holds, a collapsed subprocess, a gateway, an intermediate none event; S4 places such ends in their
process, §8 "S4 as delivered"). `acceptManual` refuses a ref without a head fact (`unknown-ref`),
so each end maps to an anchor that can carry a relation: its own fact if it has one, else its
process (a flow node through `OpenQuestionIndex.processOfRef`, a pool through the process fact
whose `attrs.participantId` it is); an end without either (a flow between two boxes) has none.
`link` writes from these anchors, R1 checks them, and the pickers offer the whole process when no
endpoint fits.

**R1: resolved by an accepted link.** The read model hides a `call-target-unknown`,
`call-target-dynamic`, `external-partner` or `black-box-partner` item once each of its anchors
(the call, the coded end, the anchors of the box's flows) has an accepted relation of any type to
a ref in another process (the rule `acceptManual` applies), decided by a human, an owner's rule
or the rule tier. The relation counts in the direction a `link` writes (S5c-1's review round):
leaving the call; leaving the coded end, or arriving at it when it only catches; along each of
the box's flows (leaving the anchor of a flow to the box, arriving at the anchor of a flow from
it); and a `call` never answers a pool or an external partner, since an accepted call into the
process a pool's flow falls back to (decision 9 accepts unique calls of modelled callers at ingest) says nothing about
the flow's partner. The pickers' suggestions and `link` follow the same rule. An agent's proposal does not count until a human or an owner's rule accepts
it. R1 lives in the read model only; `visibleFindings`, „Befunde“ and the claim inputs'
`findings` stay as they are (frozen for the live runs, §7). `message-partner-missing` and
`isolated-process` already end with a relation (above). On the seeded projects of S4 no human or
rule has accepted such a link, so their counts stay.

**R1b: duplicate ids resolved by decided calls.** The read model hides a `duplicate-process-id`
item while no call relation towards any of the copies is proposed or held: the question asks
which copy calls mean, and once each such call is decided (by „Gültige Kopie wählen“ or in
„Prüfen“) nothing waits on it. It comes back with a new caller's proposals. A duplicate without
any open call therefore stays in „Befunde“ only. Read model only, like R1; S5c-1's done-when pins
the seeded dev project's count.

**Where the actions write.** One new route, contracts first: `POST
/projects/{p}/open-questions/{q}/actions` (tag `open-questions`, permission `review`), its body
discriminated by `type`: `link {targets: Ref[] (1–10), pair?: {from, to}, note?}`, `place {step:
<element id> | '@outside', process?: Ref, note?}`, `choose-copy {process: Ref, items: {id,
version}[], placeOthersOutside: boolean, note?}`, `outside {note?}`. One transaction under the
project lock; the items are computed after taking the lock (as S5a's answers) and `q` must name a
current item and the action one of its `actions` (404 `not-found`, 422 `validation-failed` with
`reason: 'action-not-offered'` otherwise). It delegates to what exists. For each `link` target,
when a typed relation from the anchor to it is live (proposed or held: a rule-tier file-stem or
process-name proposal for an unresolved `calledElement`, `rules.ts`; a key-tier message
proposal; an agent's proposal), `decideRelation` accepts that relation as the human's decision
(rationale from code), so the typed pair is settled and judge-once stops assigning it
(`judgements.ts` `isAssignedRelation` skips `manual` relations, so a second, manual relation
would leave it open); otherwise `acceptManual` writes a `manual` relation, accepted at once, the
rationale German and from code: „Aus „Offene Fragen“: <Art> – <Frage, gekürzt>“, plus the note.
The pickers list the targets of such live relations first, under „Vorgeschlagen“ (the action's
`suggested`). For a process picker the target is the process of the relation's other end, and a
link to it accepts every live typed relation from the anchor (in the link's direction, R1) into
that process; the action's `proposals` name them per target, so the picker's preview says which
proposals it accepts, and its `exclude` names the anchors' processes, which a link would join to
themselves (S5c-1's review round). It also delegates to `acceptManualPlacement` (rationale likewise), the bulk
decision of `decideRelations` (all or nothing) and the answer row. It answers `{question:
OpenQuestion | null, relations, placements, answer}`, the relations and placements it wrote or
decided (for the undo below), with `question` null when the item is gone. `decide` uses the
existing `decideRelation` and `decidePlacement` routes from the inline panels (since UX2b, owner
decision 26 Q4, the web decides where the diagrams are instead: a hold's card answers in the
note dialog, „Antwort geben“, and opens the review screen or the chain with „Jetzt
entscheiden“, an agent's question its proposal with „Vorschlag öffnen“; the inline panels
went; the API's actions are unchanged), `requeue` the existing `requeueAnalyses`, and
`fix-link` the chain page; no route edits one step's link today,
and S5c needs none. Typed human links (a human-accepted `call` where no proposal exists) are a
later choice that M5's network map may want; the review's „Korrigieren“ stays as it is (HANDOFF
§8 "`correct` on a typed pair").

**Competing calls (decision 19).** After S5c-1 a link from a call element is often a `manual`
relation, which today's safeguard `competing-call` does not see: it counts relations of type
`call` only (`auto-accept/apply.ts` `callsFrom`, `preview.ts`, `evaluate.ts`), and
`human-involved` checks the same relation only. An owner's rule could then accept an agent's
`call` proposal C → Q after a human linked C → P, and the call would have two accepted targets
that nobody compared. S5c-1 counts accepted or held `manual` relations leaving a `call` element as
competing calls, in the write paths, apply and the „Regeln“ preview (as delivered: only a manual
relation to another target than the agent's call, since an agreeing link is no second target; the
owner confirms this reading, HANDOFF §8, §8 "S5c-1 as delivered"). This tightens decision 19's
agreed design („a call has one target“, never over a human decision) without changing it; live-run
projects have no rules, and the `eval:replay` what-if (`eval/tools/src/auto-accept-whatif.ts`,
its own code over recordings without human links) does not see it.

**Web.** Each item in the tab and in the model view's section shows its primary action as a
button and the others under „Weitere Aktionen“; „Beantworten“ goes. The pickers reuse
`components/picker-list.tsx`, `value-chain/manual-placement-form.tsx` and the review's decision
panels; a picker lists processes as „Name (Modell)“, searchable, and names what the action will
write before it does („Legt eine angenommene Relation „…“ → „…“ an.“ or „Nimmt den Vorschlag
„…“ → „…“ an.“). `outside` is one click with a toast „Als außerhalb der Landschaft markiert –
Rückgängig“. Every action that wrote a manual relation or placement gets the same toast:
„Rückgängig“ rejects what it wrote through `decideRelation` or `decidePlacement` (append-only,
rationale „Rückgängig gemacht“ from code), from the ids in the action's answer. An action that
decided existing proposals (`choose-copy`, a `link` that accepted a live proposal) has no undo:
its toast links to the decision in „Relationen“, where a reviewer can change it. After an action
the item leaves the list (or turns `answered`), and the focus moves to the next item. The pickers,
panels and forms load with the tab's and the section's lazy chunks, their labels from the zod-free
`@analyzr/contracts/open-question-labels` (entry ceiling, decision 21; S4 saw rolldown split
shared modules into the entry, so the bundle guard is re-checked). In the model view, selecting a
collapsed subprocess (no fact in facts v1; in Signavio-style exports often a link to another
diagram, c) offers „Verknüpfen mit …“ too: an accepted manual relation from its process to the
picked process through the existing `POST …/relations` (kind `manual`, humans only), without a
question.

**CLI.** `analyzr questions list` prints each item's primary action label and, with `--format
text`, the suggested targets with their refs; `analyzr questions outside <id> -p <project>
[--note <text>]` and `--undo <answer id>`; `analyzr questions link <id> --to <target>…` and
`analyzr questions place <id> --step <element id>|@outside`. A target is a ref, a model key whose
model has one process, or a unique process name; an ambiguous one lists the candidates and sends
nothing. Owner key only, an agent token is refused before any request (as `questions answer`).
Decisions stay in the web, which has the review components; the CLI has no decision commands
today.

#### b) Simplified answers

- **The answer kinds go** from the web dialog, the CLI (`--kind`) and the CSV (`Antwortart`).
  The contracts drop `kind` from `AnswerOpenQuestionBody` (a request that sends it gets 422, so
  an old client notices); `OpenQuestionAnswerKind` keeps its three values for stored rows.
- **„Liegt außerhalb der Landschaft“ is the action `outside`**: one click, an optional note
  (≤ 2,000 characters, the personal-data warning). It stores one `open_question_answer` row of
  kind `outside-landscape` whose `text` is the note or null. Migration 0013 (generated)
  replaces the check `open_question_answer_text_or_note` so that an outside mark may have neither
  text nor note (never on a relation or placement subject, which gets `decide` instead), adds
  `unique('open_question_answer_project_id_unique').on(projectId, id)` (the target of the
  composite foreign key, as `no_link_project_id_unique`) and adds
  `open_question_answer_withdrawal(answer_id pk, project_id, principal_id, source_kind =
  'human', seq, created_at)` with a composite foreign key to its answer (the pattern of
  `no_link_withdrawal`; its `seq` is that of an `open_question.answer_withdrawn` event naming the
  question and the answer, no text); 0014 adds its append-only and no-truncate triggers. A
  mistaken click is undone with „Rückgängig“ (`POST …/open-questions/{q}/answers/{a}/withdrawal`,
  permission `review`); a withdrawn mark no longer counts, and marking again records a new row.
  `outside` is `unchanged` while a live (not withdrawn) outside mark exists for the item, whatever
  the latest note says; a note is `unchanged` when identical to the item's latest note (S5a
  compared any latest answer). Additive:
  0011 and 0012 stay as they are, since the agent-created stack `analyzr-local` already applied
  them, and stored rows never change (principle 5). No real data exists outside tests (the
  branch is not merged).
- **`answered` means a live outside mark.** „Text bleibt nur als optionale Notiz“: a note
  informs and the action resolves, so a note no longer makes an item `answered`; otherwise an
  answer from the department would drop the item from „Offen“ before anyone built the link. The
  Status filter calls the state „Erledigt (außerhalb)“; the tab's count stays the `total` of
  `state=open`. Stored rows of kind `answer` and `will-be-modelled` show as notes, and so do
  stored `outside-landscape` rows on a relation or placement subject (S5a accepted them there as
  notes; such an item ends only through `decide`); every other stored `outside-landscape` row
  keeps marking. Since items are versioned by what they ask about (§4.2), a mark survives an
  amendment or re-import elsewhere in the model.
- **„Wird im Modell ergänzt“ is dropped**, replaced by real amendments (c). The database check
  keeps the value for stored rows; the use cases never write it again.
- **Notes.** „Notiz hinzufügen“ on every non-informational item posts to `POST
  …/open-questions/{q}/answers` with `{text}` only; where the text lands is S5a's table (a human
  note through `recordRelationNote` or `addPlacementNote` on a relation or placement, else the
  row's text), and so is everything a note does there (the next claim shows it; it blocks
  auto-accept rules on the pair).
- **The CSV round trip stays, with five columns**: `id`, `Art`, `Frage`,
  `Ansprechpartner` (`Ansprechpartner-Hinweis` before UX2a; a sheet with either header reads),
  `Antwort`; since UX2a `Frage` holds the question, its reason as the second sentence and
  „Betrifft: …“ with names, the contact cell the step owners and lanes (no folder), and an export
  without `group` holds the `ask` items only. The sheet route records each filled `Antwort` as a note,
  with S5a's checks (unknown ids, 2,000 characters, control characters, the personal-data
  warning, one transaction, the dry run). An S5a sheet with `Antwortart` still reads: „Liegt
  außerhalb der Landschaft“ (or `outside-landscape`) records the outside mark with the text as
  its note, except on a relation or placement item, where it records a note; „Antwort“, „Wird im
  Modell ergänzt“ and an empty cell record a note; anything else is `invalid` (`unknown-kind`). No column replaces it: the department writes what it knows, and the
  consultant acts in the tab, where the actions are.

#### c) Model amendments („Ergänzungen“)

**Operations (v1).** Only the fields the questions name, set through a form at the element:

| `op` | Element (fact) | What it writes | The value comes from | Rules |
|---|---|---|---|---|
| `call-target` | call activity (`call`) | the field `Extraction.call` reads (`packages/bpmn-facts/src/extract.ts`): C7 the `calledElement` attribute; C8 `processId` of `zeebe:calledElement`, inserted into `extensionElements` when missing (insertion rules under "Applying"); engine null the `calledElement` attribute, or the zeebe extension's `processId` when the element has one (it wins there) | the process picker: head processes of the project outside the caller's process, written as the process id | never over an expression in either dialect (`^\s*=`, `${`, `#{`), whatever the engine (dynamic calls are runtime semantics; reason `expression`); never on a call with `camunda:caseRef` (it calls a CMMN case, and the Camunda 7 parser refuses `calledElement` next to it; reason `cmmn-call`, the form says „Ruft einen CMMN-Fall auf, keinen Prozess“); an id several models define is allowed with the warning that the call stays ambiguous (proposals to every copy, `rules.ts`) |
| `message-name` | the `bpmn:message` or `bpmn:signal` a message or signal endpoint (`msg_*`, `sig_*`) references; an endpoint without a reference | the referenced element's `name` (every endpoint referencing it changes with it; the form lists them), or, without a reference, a new `<message id="…" name="…"/>` (`<signal …>`) after the last root element before the first `BPMNDiagram` plus the `messageRef` (`signalRef`) on the event definition or the send or receive task; the new id is `Message_` (`Signal_`) plus the first 8 hex of sha256 of the amendment id, with `_2`, `_3` on a collision with an id of the file | the landscape's message (signal) names with where they are thrown and caught, or free text | one line, at most 1,000 characters (`MAX_KEY_LENGTH`), no expression (`=`, `${`, `#{`), neither as the value nor over one; a name used elsewhere yields key-tier proposals at confidence 1.0, never an acceptance by itself (CONCEPT §2; a partner picked from the suggestions is accepted by the human, a) |
| `event-name` | start or end event (`evt_start`, `evt_end`) | its `name` attribute | free text, with the labels of start and end events elsewhere as suggestions (trigger partners) | one line, at most 200 characters (`MAX_LABEL_LENGTH`) |
| `process-documentation` | process (`process`) without documentation | a `<documentation>` as the process element's first child (BPMN 2.0 requires it first) | free text | only while the process has none (it never replaces the tool's text); at most 2,000 characters (`MAX_DOCUMENTATION_LENGTH`) |

**Where a field can be amended.** „Nur die Felder, die eine Frage nennt“: a field is amendable
only where an open question names it or where it is empty or unresolved (a call without
`calledElement` or with one naming no process and no expression, an endpoint without a message or
signal name or whose name pairs with nothing, an unnamed start or end event, a process without
documentation), and where a live amendment set it (to replace or withdraw it). Elsewhere
`amendable` answers „Nur für offene Fragen“ with the reason (`only-open-questions`). Replacing a
value that resolves (a call that reaches a process, a name that pairs, a labelled event, the
tool's documentation) would turn accepted relations `changed` and override the source tool; it
is not in v1 (§6). As delivered (§8 "S5c-2 as delivered"), "a live amendment set it" counts only
a live amendment the head applies (one in conflict or carried over by the tool sets nothing), and
„Meine Ergänzung behalten“ is offered only where the incoming value does not resolve, never for
a start or end name.

Not in v1: **process ids** (`duplicate-process-id`). A process id is the anchor of every relation
and placement at the process (`<key>#<processId>`), the target of other models' calls, and is
referenced inside its file (a participant's `processRef`, the DI plane's `bpmnElement`).
Renaming one copy turns its accepted relations and placements `missing` (decision memory is lost
until re-anchoring, R2, ADR-0001), lets callers that meant it resolve to the other copy, where
decision 9 accepts them unseen, and needs an id rewrite across the file instead of one attribute.
The duplicate gets „Gültige Kopie wählen“ instead (a); the rename belongs in the tool. Also not
in v1: names of tasks, lanes and pools, message flows, deleting or adding elements. The owner's
option text named „Prozess-ID“ and did not name documentation; the owner confirmed both on
2026-10-17 (decision 25.1, §10.9).

**Collapsed subprocesses are not call activities.** In Signavio-style exports a link to another
diagram is a collapsed `subProcess` with vendor metadata (`signavio:signavioMetaData
metaKey="linkedmodel"`, the synthetic fixture
`tools/integrate/test/fixtures/signavio/2026-10-14-signavio/Gemeinsame Dokumente/Vertrieb/Auftragsabwicklung.bpmn`;
to verify, `plugins/analyzr-integrate/reference/signavio.md`) and no `calledElement`. Facts v1
make no fact for it, so it raises no question and `call-target` cannot reach it: „Aufrufziel/Key“
in v1 means call activities and leaves out the main call shape of descriptive exports
(`eval:descriptive`: calls 9/9 → 0/9 from `descriptive` on, §3.11). As the owner chose
(decision 25.4, §10.9), the model view links such an element with „Verknüpfen mit …“ from its
process (§4.8 a, S5c-1); the conversion into a call activity waits for a real export (§6).

**Storage.** Two append-only tables (migration 0015 generated, 0016 the triggers), with the
`no_link`/`no_link_withdrawal` pattern:

```sql
model_amendment(id 'mam_', project_id, model_id, element_id, via_element_id null,
         op in ('call-target','message-name','event-name','process-documentation'),
         before text null, after text not null, base_revision_id, supersedes_id null,
         principal_id, client_id, source_kind = 'human', seq, created_at,
         unique (project_id, id),
         fk (project_id, model_id) → model,
         fk (project_id, model_id, base_revision_id) → model_revision (project_id, model_id, id),
         fk (project_id, supersedes_id) → model_amendment (project_id, id))
model_amendment_withdrawal(amendment_id pk, project_id, reason in ('withdrawn','superseded'),
         principal_id, source_kind = 'human', seq, created_at,
         fk (project_id, amendment_id) → model_amendment (project_id, id))
```

0015 also adds `unique('model_revision_project_model_id_unique').on(projectId, modelId, id)` to
`model_revision`, so the base revision is one of the amendment's model. `element_id` is the
element whose field is written: the call, the event, the process, and for `message-name` the
referenced `bpmn:message` or `bpmn:signal`, with `via_element_id` keeping the endpoint the form
was opened from, for display; only an endpoint without a reference keys the amendment by itself.
`before` is the value as the uploaded revision reads it (`''` for no `calledElement`, null for no
name), `after` the value set, both in the extractor's sanitized form (`sanitizeLine` for targets
and names, `sanitizeBlock` for documentation, with the field's fact limit,
`packages/bpmn-facts/src/sanitize.ts`), so the check and the re-import compare like facts and a
pasted CRLF or a double space neither fails the check nor makes a conflict; the form shows the
normalized value before saving. At most one amendment per model, element and `op` is live: a new
one supersedes the previous one (a withdrawal, reason `superseded`) in its transaction, under the
project lock, so a second name for one message replaces the first; a request with two items on
the same element and `op` is refused (422). Every withdrawal is a human's: carrying a value over
from the source tool is a computed state (below), so `analyzr-rules`, which may only accept calls
(CONCEPT §6), writes nothing here. Values are model content, so they never enter events:
`model.amended` names the recorded and superseded amendment ids, element ids and ops (the seq of
their rows), `model.amendment_withdrawn` the id, op and reason (the seq of a withdrawal row), as
`open_question.answered` carries no text.

**Revisions.** The uploaded bytes stay a revision of their own, the *uploaded* revision (what
the tool exported, with its import or upload provenance), and the result is an *amended* revision
on top of it that becomes the head ("derived" stays the trust class of decision 24.2, §3.10). An
amended revision is always computed from its uploaded revision's bytes, never from the previous
head: every derivation (an amendment, a withdrawal, a re-import, a revival) runs
`planAmendments(live, current)` against the uploaded revision and splices exactly the
amendments it marks `applied`, so a withdrawal is a re-derivation without it, a re-import
re-applies the same list, and an amendment in conflict is never forced onto bytes it no longer
fits. **Head and seq:** a model's head is always its revision with the highest seq, and the head
never points back at an older revision, since code that reads "the model at seq X" takes the
newest revision by seq (`hashesAt` in `apps/server/src/db/store.ts`, used for judge-once
currency and the partner bases recorded at submit). Every revision has its own event: the
uploaded one `model.revised` as today, the amended one a `model.revised` with `source.kind:
'amendment'` appended after it (and after `model.amended`) in the same transaction. Its source:

```jsonc
{"kind": "amendment", "uploader": "human",              // the request's credential kind (§3.3); RevisionSource is a looseObject: no migration
 "upstream": {"revisionId": "rev_…", "rev": 3, "contentHash": "…"},
 "amendments": [{"id": "mam_…", "elementId": "Call_Rechnung", "op": "call-target", "outcome": "applied"},
                {"id": "mam_…", "elementId": "Message_Rechnung", "op": "message-name",
                 "outcome": "conflict", "reason": "value-changed"}]}   // every live amendment, no values
```

The head carries the plan: `source.amendments` lists every live amendment of the model with its
outcome (`applied`, `in-source`, or `conflict` with its reason `element-missing`,
`value-changed` or `expression`), on an amended head and, when nothing applies, on the uploaded
head (a server field next to the provenance). An amendment's state is read from the current
head's list and its withdrawal row: „angewendet“, „im Quellsystem übernommen“, „Konflikt“,
„zurückgenommen“, „ersetzt“, marked „Modell gelöscht“ while its model is deleted.

`RevisionSource.kind` gains `amendment`; it appears in no MCP output schema (§8 "S2"). Why two
revisions instead of one amended revision that carries the uploaded hash: the original stays
downloadable as it came (`getRevisionContent` of the uploaded revision), re-derivation needs the
uploaded bytes, the history says what came from the tool and what from analyzr, and S2's
provenance stays on the revision its manifest describes (§3.3). **Identical bytes stay
`unchanged`:** ingest (`ingest.ts` `liveHeadHash`, `storeFile`) compares an incoming file with
the head's own `content_hash`, with its `source.upstream.contentHash` and with the content hash
of every amended revision of the model (analyzr's own output, such as a corrected BPMN downloaded
before later amendments), so importing the same export again, or uploading any downloaded
amended file, stores nothing and never counts an amendment as carried over. As delivered, only
amended revisions whose bytes differ from their uploaded revision's count: a re-derivation that
applied nothing holds an earlier export, which the tool may bring back as a revert (§8 "S5c-2 as
delivered"). The cost: an import
of an amended model writes two revisions, and `headRev` counts both. `model_revision.xml`
changes its comment from "the uploaded bytes, verbatim" to "the uploaded bytes, or bytes
computed from an uploaded revision by amendments".

**Applying.** A pure `applyAmendments(xml, amendments)` in `@analyzr/bpmn-facts` (new
`src/amend.ts`, exported; the package already owns the extractor's precedence, `assertSafeXml`,
the scanner of `xml-scan.ts` and `extractFacts`, so no sixth package and no XML logic in the
domain), a function of the bytes and of the amendments in seq order only, so two derivations
from the same inputs give identical bytes (stable downloads, the `unchanged` match of a
downloaded file, S2b's dry run equal to the import). Beside it a pure `readAmendable(xml)` reads,
per amendable element, its kind, its current values in the facts' sanitized form, the message or
signal an endpoint references, whether a value is an expression in either dialect and whether a
call has `camunda:caseRef`: what `planAmendments`, `amendable` and the checks need beyond facts
v1, which carry neither message ids nor `caseRef` (facts and `FACTS_VERSION` stay unchanged).
Both are reached through `AnalysisPort.amend` and `AnalysisPort.readAmendable`, as extraction is
through `AnalysisPort.extract`, so the domain stays pure and tests use doubles.
**Byte-preserving:** it works on the stored bytes (`assertSafeXml` returns text without the BOM,
so it only checks) and finds the target's start tag by its `id` attribute (exactly one; the local
name the expected BPMN type, in the BPMN model namespace through a prefix or the default
namespace, as the Signavio-style fixture writes it; no redeclaration on the way), then splices:
it replaces or adds one attribute (the value escaped, `&`, `<`, `>`, `"`, tab and line breaks as
character references) or inserts one minimal element. bpmn-moddle tolerates a wrong child order
that the Camunda 7 and Zeebe parsers, which validate against the BPMN XSD, refuse, so the
insertion rules are fixed: a self-closing start tag is expanded with the element's own qualified
name; a new `extensionElements` goes right after the last `documentation` child, else right after
the start tag; a new `documentation` is the first child; new BPMN elements take the prefix of the
amended element (of `definitions` for a root element), the default namespace included;
`zeebe:calledElement` uses the root's prefix for the Zeebe namespace and declares `xmlns:zeebe` on
itself when the root has none (a C8 file detected through `executionPlatform` alone, `extract.ts`).
Every other byte stays: vendor extensions of Signavio or ARIS exports, comments, whitespace, the
BOM and line endings. No bpmn-moddle round trip: bpmn-moddle drops what it cannot read (into
`parse-warning`s, `moddle.ts`), which `normalize-bpmn` accepts for `converted` files (§3.7) but an
amendment must not. **Checked:** the result passes `assertSafeXml` and the limits again (5 MB,
50,000 elements); `extractFacts` reads every amended field as `after` and every other fact exactly
as before (same fingerprint and attrs; for a shared message the other elements referencing it
change only in their message name and what derives from it, key and fingerprint); no new warning
code. A failed check refuses the amendment (422 `validation-failed`, `reason:
'amendment-not-applicable'`) or, at a re-import, makes it a conflict. Golden tests pin the child
order on C7 and C8 fixtures against what Camunda Modeler writes for the same change (saved from
the Modeler once into the fixtures; no new dependency). As delivered, the fixtures are
hand-written in the Modeler's layout and the expected files are `applyAmendments`' own output
(regression snapshots), with a dependency-free check of the BPMN XSD's child order over them and
every corpus output; one Modeler save of each fixture is asked of the owner (§8 "S5c-2 as
delivered", HANDOFF §8).

**What an amended revision sets off** is what any change from the tool sets off: a new
`facts_hash` (the extractor and `FACTS_VERSION` are unchanged) runs `recomputeProject`, queues
the model's relations task and makes its judgements non-current (decision 17); the placement
input of the model's processes changes with names, documentation and start or end labels, so they
become due; a changed call target, name or label changes the element's fingerprint
(documentation is not part of one, `fingerprint.ts`), so accepted relations there turn `changed`
and wait for re-confirming, and a rejection there reopens. A unique call target set by amendment
is accepted by decision 9, since S2c-1 also on a derived caller (decision 25.2, §3.10). **The cost is shown before every
save.** `facts_hash` includes documentation, names and labels (`fingerprint.ts`), so even one
documentation line makes every judgement of a pair touching the model non-current, and a new head
cancels the model's open relations task: an agent holding its claim gets 409 `task-cancelled` at
submit (CONCEPT §3), its work lost. The dry run therefore returns the current judgements it makes
non-current (pairs to re-judge, as S2b's follow-up counts them) and whether the model's relations
task is claimed. Since step 1 of S2b's follow-up (`AmendmentCost` unchanged) `pairsToRejudge`
counts the pairs agents judge again after the write: the model's pairs whose current judgement
the new head makes non-current, without those the write itself settles (the import dry run's
`pairsToJudge` and `judgementShift` for the one model, against the relations as the write leaves
them: its recompute under the derived head's trust, for an owner the derived calls their rules
accept, the partner proposals `settleLinks` accepts). While a partner's task waits, judge each
pair once may give some of them to that task rather than to the model's next claim. The number
can drop to 0 where agents judged only `compatible` pairs (the search space no claim assigns);
`taskClaimed` comes from the write's `planQueue`, so it is set only when the facts change (and
never when nothing can be recorded). The form says „Danach: … Die Agenten beurteilen 214
mögliche Relationen neu, sobald du den Agenten startest.“ (the cost as its own sentence since
UX4) and, for a claimed
task, warns „Ein Agent bearbeitet dieses Modell gerade; seine Arbeit geht verloren.“, saving only
after confirmation. One request carries up to 20 amendments of a model, and the tab and the model
view collect them before one save (Web, below), so working through a model's questions costs one
re-judgement. **Manual links at the element.** A changed call target or message name changes the
element's fingerprint (the call target is part of `ref_name_norm`), so a manual relation from it
(often a link from „Offene Fragen“, a) turns `changed` like any accepted relation there; the dry
run lists them. A manual relation from the call to the target the amendment sets is retired in
the same transaction, as the rule tier accepts the call: a human rejection with a rationale from
code („Ersetzt durch den Aufruf aus der Ergänzung“), append-only; likewise a manual link between an
endpoint and the `partner` whose key-tier proposal the amendment accepts (a). Other manual
relations there wait for re-confirming.

**Re-import.** On every upload of the key, ingest plans each live amendment against the incoming
bytes (pure `planAmendments(live, incoming)` in a new `apps/server/src/domain/amendments/`, over
`readAmendable` of the incoming file); values compare in their sanitized form:

| The incoming file | Outcome |
|---|---|
| the element is missing, or no longer of the op's kind | conflict `element-missing` |
| a `call-target` or `message-name` whose incoming value is an expression | conflict `expression` (only the withdrawal is offered) |
| its value equals `after`; for `process-documentation`, any documentation | in the source: nothing to splice, shown „im Quellsystem übernommen“; applied again when a later import brings back `before` |
| its value equals `before` | applied |
| any other value | conflict `value-changed`: not applied, stays live |

`process-documentation` never conflicts: the op never replaces the tool's text, so the tool's
documentation always takes over. When at least one applies, the transaction stores the uploaded
revision and the amended head; otherwise the uploaded revision is the head and carries the plan.
Recompute, endpoint states and queueing run once, for the final head, as for any ingest. Each
conflict is an open question of the new kind `amendment-conflict` („Ergänzung nicht mehr
anwendbar“), new source `amendment`, subject the element's ref (version: the amendment id and
the uploaded revision's id), its text naming the field and showing before, after and the
incoming value; actions in a. S2b's `importImpact` calls the same planner, so the dry run lists
per file the amendments applied, in the source and in conflict („n Ergänzungen nicht mehr
anwendbar“). A converter that regenerates element ids (against §3.4 rule 2) shows there as a wave
of `element-missing`, which „Alle Ergänzungen dieses Modells zurücknehmen“ clears in one step;
v1 does not re-anchor (§6). The import and PUT results (`ImportFileOutcome`, `PutModelResult`,
contracts first) gain an optional `amendments: {applied, inSource, conflicts}` (counts plus at
most 20 ids), present only for a model with live amendments, so the corpus and seed JSON stay
byte-identical; `revision` is the final head, and an optional `uploadedRevisionId` names the
uploaded one. The CLI prints „2 Ergänzungen angewendet, 1 Konflikt“, the web upload panel the
same per file (as delivered the CLI prints English, „amendments: 2 applied, 1 conflict“, like
the rest of the CLI).

**Concurrency.** Ingest reads the live amendment set with the heads before its write transaction
and plans, applies and extracts there (CPU-bound, as it extracts today, `ingest.ts`), keeping a
token of the set (the sorted live ids and the highest amendment or withdrawal seq); under the
project lock it reads the set again and, if the token changed, plans, applies and extracts again
inside the transaction. Amendment writes and withdrawals take the project lock and check
`If-Match` inside it (as delivered, `If-Match` is required on amendment writes and optional on
withdrawals, HANDOFF §8). So an amendment recorded while an import is being extracted is in the head
after the import. The tail every head change runs (`recomputeProject`, `touchNoLinkRelations`,
`syncValueChainAfterModels`, `queueAnalysis`, `queuePlacementTasks`) moves into one function that
ingest, amendment writes and withdrawals call.

**Withdrawal** („Ergänzung zurücknehmen“, reason `withdrawn`) re-derives from the uploaded
revision with the remaining live amendments and writes a new amended revision; with none left its
bytes equal the uploaded revision's, a new revision all the same (as a revert upload today), so
`headRev` only grows. „Alle Ergänzungen dieses Modells zurücknehmen“ withdraws every live
amendment of a model in one transaction and one re-derivation. **Model deletion** keeps the
amendments live (deletion is soft), and nothing writes a revision for a deleted model (one written
after `model.deleted` would make `hashesAt` see the model as present, and `storeFile` clears
`deletedSeq`, so reusing it would revive the model): a withdrawal there records only its row, the
amendment route and `amendable` answer 404 `not-found`, and the `amendment-conflict` actions are
not offered. A revival by upload re-derives from the live set as a re-import does.

**Exports.** The change list, `GET /projects/{p}/amendments/export?format=markdown|csv` (filters
`modelKey`, `state` and `since=<seq>`; German headings, the file name like the open-questions
export), grouped per model: the model's name and key (from S2a also its `externalPath` and „Im
Quellsystem öffnen“, followed through `source.upstream`); per amendment the pool or process and
the lane, the element's German type and name („Aufrufaktivität „Rechnung stellen“, Lane
„Buchhaltung““), the field, before → after, who, when and the state; a `call-target` names its
target as „Prozess „Rechnungsstellung“ im Modell „…“ (Pfad …, ID …)“, marked „Ziel nicht mehr in
der Landschaft“ when no head process has that id any more; a shared message lists every element
referencing it. Every export names the seq it reflects („Stand: Ereignis 1234“), so `since=` lists
only what is new since the last carry-over. The consultant carries it into the source tool;
analyzr writes nothing back (decision 7). For Signavio and ARIS the change list is the path (a
diagram link is picked in the tool, not typed as an id); the corrected BPMN, whose
`calledElement` is a bare process id without an `<import>`, is for Camunda tools. The amended BPMN
is the head's bytes and the original the uploaded revision's, both through the existing
`getRevisionContent`; the web offers „BPMN herunterladen“ and „Original herunterladen“, the CLI
`analyzr models pull <key> -p <project> [--original] [-o <file>]`. The OKF export (deferred,
decision 22) would write the head, amended or not; §9.

**REST** (contracts first, tag `amendments`, the client regenerated):

- `GET /projects/{p}/models/{model}/elements/{elementId}/amendable` (`read`): the fields the
  element allows (above), each with its current and uploaded value, whether it can be set and
  why not (`only-open-questions`, `expression`, `cmmn-call`, …), the suggestions (processes,
  names, partners), the element's amendment history, and `ETag: "r<headRev>"`, which the form
  sends; 404 for a deleted model;
- `POST /projects/{p}/models/{model}/amendments?dryRun=` (`review` and `write`): `{items:
  [{elementId, op, after | target: Ref, partner?: Ref, replaces?}]}` (1–20, no two on one element
  and `op`), `If-Match: "r<headRev>"` required and checked under the project lock (428 and 412
  `revision-conflict`, as the value chain's saves); each item answered `recorded`, `unchanged`
  (identical to the live amendment) or `not-applicable` (with the reason), the new head, and the
  would-be effect at the element (findings resolved and added, rule-tier relations accepted or
  withdrawn, the key-tier proposals a `partner` accepts, relations turning `changed`, manual
  relations retired: `runRules` over the head facts with the model's facts replaced, pure) and the
  cost (the current judgements made non-current, whether the model's relations task is claimed;
  since S2b's follow-up step 1 counted as above: the pairs agents judge again after the write,
  and a claimed task only when the facts change, so the write cancels it);
  a dry run writes nothing; 404 for a deleted model;
- `GET /projects/{p}/amendments` (`read`; filters `modelKey`, `state`), `POST
  /projects/{p}/amendments/{a}/withdrawal` and `POST
  /projects/{p}/models/{model}/amendments/withdrawal` (every live amendment of the model; both
  `review` and `write`; as delivered also `?dryRun=` with the cost and an optional `If-Match`),
  and the export above.

**Both permissions.** An amendment is a human decision about content (`review`, humans only) and
writes a revision, which ingest guards with `write`. Scopes do not nest that way
(`apps/server/src/domain/policy.ts`: review ⊇ propose ⊇ read, write ⊇ read), so the amendment and
withdrawal use cases call `policy.require` for both, and a review-only scope gets 403
`insufficient-scope`.

**Web.** At a question, an `amend` action opens a form for its targets (picker or text, the
personal-data warning for names and documentation, the normalized value as it will be stored, and
the hint „Der nächste Import aus dem Quellsystem behält die Ergänzung, solange das Feld dort
unverändert ist.“) and saves after a dry run's summary („Danach: 1 Aufruf angenommen, 1 Befund
erledigt, 214 Paare werden neu beurteilt.“, with the warning for a claimed task; since UX4 the
cost is its own sentence: „Die Agenten beurteilen 214 mögliche Relationen neu, sobald du den
Agenten startest.“). „Sammeln“ next to
„Speichern“ keeps the amendment in the page instead: a bar per model („3 Ergänzungen für „…“
gesammelt – Speichern“) saves them with one dry run and one request. In the model view, selecting
an element (today's `?element=` of the bpmn-js NavigatedViewer, `components/bpmn-canvas.tsx`; no
modeler; a pool maps to its process through `attrs.participantId`) shows a section „Ergänzen“
with its amendable fields and its history (who, when, before → after, state, „Zurücknehmen“);
amended elements get an overlay „ergänzt“, the header a badge „In analyzr ergänzt (n)“ naming
the uploaded rev, and the downloads. The models table marks amended models; the history lists
uploaded and amended revisions. `model-view.tsx` is in the entry chunk, so the section, its
history, the forms and the downloads load lazily with the model view's panel (entry ceiling,
decision 21), their labels from a zod-free contracts module on the bundle guard's allowlist.

**CLI.** `analyzr models amend <key> -p <project> --element <id> (--call-target <target> |
--message-name <name> | --name <label> | --documentation <text>) [--dry-run] [--yes]` (a target
as in `questions link`; it prints the cost, and a claimed relations task needs `--yes`),
`analyzr amendments list|export|withdraw -p <project> …` (`withdraw --model <key>` for every live
amendment of a model) and `analyzr models pull`; owner key only, an agent token refused before any
request.

**MCP: no new tool before the live runs.** Agents read an amended head like any revision:
`get_model_xml` returns its bytes, `get_process`, `get_landscape` and the claim input its facts;
`RevisionSource` is in no MCP output schema, so the tool and prompt snapshots stay. Telling agents
which facts a human set is an S7 option (§4.6).

**Personal data.** Names and documentation typed in land in immutable revisions and in the
change list; the personal-data check warns and never blocks, as for notes. Erasure stays §10.6.

#### d) Live-run neutrality

- Live-run projects are fresh, seeded and without human input (M3-LIVE-RUNS.md): no action, no
  mark, no note, no amendment, no rule. Every S5c write is a human route; the read model adds
  `actions`, R1 and R1b (links and decisions by humans or rules), versions items by what they ask
  about (§4.2), reads the chain findings' `state` and changes what `answered` means, none of which
  a claim reads.
- Shared paths change in four places: ingest's `unchanged` comparison (a model without amended
  revisions compares as today); the re-application step, which runs only for models with live
  amendments; the ingest tail, moved into one function without a change in behaviour; and the
  auto-accept safeguard `competing-call`, which also counts manual relations leaving a call
  element (live-run projects have no rules; the `eval:replay` what-if has its own code).
- The golden claim test (`claim-golden.test.ts`) keeps the SHA-256 of the claims of a seeded
  project without actions and amendments, and pins them again after an `outside` mark on every
  subject that is neither a relation nor a placement (as S5a pinned text answers); the corpus JSON
  of `analyzr import` and `seed --json`, the sim recordings, `eval:replay` and every committed
  report stay as they are; the MCP snapshots, facts and `FACTS_VERSION`, `FindingKind`, the
  procedures and the plugins are untouched.

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
   the consultant to act on in „Offene Fragen“ or to enter as notes from the CSV (S5a, S5c).
   Nothing is written to analyzr.
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
| Run size and cost estimate | claim sizes against the 100 KB and 96 KB (`CLAIM_PLACEMENT_MAX_BYTES`) budgets, documentation cut by `CLAIM_DOC_CHARS`, CONCEPT §7's cost per revision. Before the first paid customer run; S2b's follow-up gives the pair count: since its step 1 per request (`relationsTasks.pairs`, the pairs an import sets agents to judge, against the head, so on a first import across batches a pair between two batches counts in neither; shown since its step 3 in the „Vorschau“ and `analyzr import --dry-run`, whose batch notes name that gap), and since its step 3b the backlog's, the first run's size (`ProjectSummary.pairsToJudge`, the pairs the next claims of the claimable relations tasks will be assigned, in „Als Nächstes“, after an import, in `analyzr import`'s waiting line and in `analyzr status`). |
| Reindex with judgement carry-over, then facts v2 | no reindex exists (`packages/bpmn-facts/src/version.ts` named one until M6 S1); `facts_hash` includes `FACTS_VERSION`, so any fact change re-judges every pair. Carry-over first, then one bump with descriptive facts (collapsed subprocesses, data objects, black-box participants, task-to-pool messages), systems and tool identities; it must not read the collapsed subprocesses `analyzr-spec` renders for the calls of converted or reconstructed models as call endpoints, which would undo §3.9's rule. Only if `eval:descriptive` shows a large loss. |
| Placeholders (external parties, phantom processes) | lifts CONCEPT §11's deferral; the computed boundary signals of §4.3 come first. Owner decision. |
| MCP `put_model` or model drafts as proposals | shell-less agents (Claude Desktop) could submit models; only after the trust decision. Owner choice between the two. |
| Vision pipeline | an automated pipeline from screenshots, PDFs and slides into specs, `reconstructed`, one review per diagram. Since decision 30 (1) the session agent reads pictures and PDFs itself with its own file reader and writes the `reconstructed` specs (S3c); a pipeline of its own stays later. |
| Tool API pullers | Signavio and ARIS APIs, one-way, no prune, customer-tool credentials with the consultant, never in analyzr. When a customer needs repeated syncs. |
| Zip import, staged imports, adapter hook, document store, identity-key rule | each when a real import shows the need. |
| More amendment operations, typed human links | process ids (an id rewrite across the file plus re-anchoring of relations and placements, R2), task and pool names, replacing values that already resolve (a reachable call target, a pairing name, a label, the tool's documentation; §4.8 c), a collapsed subprocess turned into a call activity (§10.9), re-anchoring amendments after a converter regenerated ids, a per-amendment mark „Im Quellsystem eingetragen“ for the change list; links as human-accepted `call`, `message` or `trigger` relations where no proposal exists, instead of `manual` (§4.8 a). After S5c-2 shows how consultants use it. |

## 7. Constraints

- **Live-run comparability (decision 13, HANDOFF §7).** Until the owner's runs of
  `analyzr-relations@0.2.0` and `analyzr-placements@0.1.0` are done, nothing changes the released
  procedures, the claim inputs, proposal and submission validation, the MCP tool and prompt
  surface (21 tools including the two `decide_*` stubs, 3 prompts, no resources;
  `apps/server/test/integration/__snapshots__/mcp-{tools,prompts}.json`), `draft_value_chain`, the
  sim recordings or the committed reports. S1–S4, S5a, S5c and S6 keep to it (S5c: §4.8 d); S5b
  is neutral but waits; S7 comes after.
- **Decision 17.** `facts_hash` includes `FACTS_VERSION`; there is no reindex; every judgement
  basis includes the procedure. Provenance stays out of facts. A model amendment (S5c-2) is a
  new revision with new facts, so it re-queues and re-judges like a change from the tool; that is
  intended, not an exception, and its cost (the pairs to re-judge, a claimed task that would be
  cancelled) is shown before every save, which can carry all of a model's amendments at once
  (§4.8 c).
- **Principle 7.** Five library packages; the toolkit lives in `plugins/` and `tools/integrate`
  (precedents outside `packages/*`: `tools/notices`, `apps/agent-sim`, `apps/demo`); whether that
  reading holds for product logic shipped to consultants is §10.8.
- **Decision 7.** PostgreSQL is the record; imports are one-way; no prune, no sync, no watch;
  deletions are explicit and human. Decision 25 keeps this: analyzr re-applies its amendments to
  every import and never writes to the source tool; the amended BPMN and the change list are
  downloads the consultant carries over by hand, as the OKF export is an export (CONCEPT
  principle 3: "nothing flows both ways" holds for analyzr's own data flows). What decision 25
  changes is that analyzr writes revisions of its own, amended revisions computed from uploaded
  bytes (ADR-0001 decisions 2 and 3; CONCEPT principle 3, §2's `model_revision.xml` and §4's
  "BPMN bytes are canonical at their origin (the revision for uploads …)"). ADR-0001's header and
  CONCEPT principle 3 and §4 carried a forward note since decision 25; S5c-2's docs pass rewrote
  the places (§8 "S5c-2 as delivered").
- **Decision 9 as amended by 24.2 (since S2c-1, 2026-10-19):** a unique static call in a derived
  revision is proposed, not accepted. Decision 25.2 adds (confirmed by the owner 2026-10-17) that
  a call target a human set by amendment counts as modelled, so the rule tier keeps accepting it,
  and decision 28 (2) counts one the source tool took over (`in-source`) the same (§3.10). The
  eval, the seeds and the live-run projects hold Camunda models a human imported, so the rule
  changes nothing there. **Decision 8:** stages are fixed.
  **Decision 10:** no assignee. **Decisions 4 and 5:** agents propose and draft, humans decide, no
  LLM credentials. This concept adds: the consultant runs every import (§3.1; not enforced by the
  policy, which lets any `analyzr:write` token ingest, §10.1), and every skill also ships as a
  start prompt (M4 practice).
- **Deferrals (CONCEPT §11).** M6 lifts the deferral of "agent findings" in part (gap reports
  bound to submissions, without a lifecycle, S7) and adds answers to open questions (S5a), close
  to the deferred "comments"; the S2c recommendation narrows decision-19 rules by derived kind and
  converter, which §11 also defers (delivered in S2c-3; decision 28 (1) narrows it further). CONCEPT §11 notes both since decision 24. Decision 25 lifts
  the deferral of "the Web Modeler" in part: targeted amendments of the fields open questions
  name, through forms, as amended revisions; no modeler (§9). CONCEPT §11 notes it. S5c-1
  tightens decision 19's safeguard `competing-call` to count manual relations from a call element
  (§4.8 a), within its agreed design.
- **Principle 5 (append-only).** S5c adds rows and never changes one: outside marks and their
  withdrawals, amendments and their withdrawals (withdrawn, superseded; carried over by the source
  tool is computed, never written), uploaded and amended revisions, manual relations retired by a
  rejection; migrations 0013 to 0016 add (constraints and tables), 0011 and 0012 stay as they
  are. S2b's follow-up step 5 adds `model_identity` (an identity row per import and model, never
  changed; 0022's triggers and guard), and the revision keeps its first provenance.
- **Holdout hygiene.** No agent opens the holdout's `expected.yaml`, `README.md`, `spec/`,
  expected placements, recordings or report sections; tooling reports it in aggregate only.
- **Privacy.** Customer exports and transcripts never enter the repository or the eval corpus.
  The fields analyzr adds itself (provenance, losses, `derived.from`, gap kinds) are designed to
  hold no personal data. Models and free texts can: customer BPMN bytes (lanes, documentation,
  tool metadata) are stored as immutable revisions; stored extractor warnings (S2) quote
  bpmn-moddle messages, which can contain unknown extension content; the declared `externalPath`
  and `url` are not checked (since S2b's follow-up step 5 also kept per import in the append-only
  `model_identity`; its event `model.identity_declared` holds neither); human answers and notes
  (S5a, S5c-1), names and documentation typed
  into amendments (S5c-2, which end up in amended revisions and the change list) and agent
  `gaps` (S7) are free text behind a warning-only check. M6 is the first milestone that puts customer data into the append-only
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
| S2 | a: typed provenance, manifest, key pinning, identity warnings and `external-ids`, stored warnings and `extractor-loss`, „Herkunft“ in the web; b: `importImpact` (and its follow-up), dry runs in REST, CLI and the web upload; c: the trust rule (decision 24.2, OK given), with decision 19's extension and the list „Vor der Vertrauensregel angenommen“ in four steps ("S2c" below; 1 d planned before the extension and the list were counted) | 3 + 3 + 5 d |
| S3 | a: `eval:descriptive` and the `get_landscape` size; b: integrate v0 for BPMN exports (plugin, `tools/integrate` with `inspect` and `normalize-bpmn`, workspace, key map, report); c: renderer and spec YAML, the ad-hoc converter path, the bundled CLI, in four steps with the integrate plugin 0.1.4 last ("S3" below; 3 d planned in S0, about 8.5 d in the S3c plan, 2 d of them for what its design and security critiques hardened: the runner, the ids, the release mechanics) | 1.5 + 3 + 8.5 d |
| S4 | open-questions read model, gap signals (without `extractor-loss`), tab „Offene Fragen“, model view section, export, `analyzr questions` | 5 d |
| S5 | a: answers in the web, REST and CLI, the CSV round trip, `open_question_answer`; b: notes that make pairs non-current and queue exactly the affected work | 3 + 1.5 d |
| S5c-1 | "Actions" (decision 25): `actions` on every item, R1 and R1b, items versioned by what they ask about, the action route (link, place, choose copy, outside; a link accepts a live typed proposal before it writes a manual relation), `competing-call` counting manual relations from calls, the outside mark and its withdrawal (migrations 0013/0014), notes without kinds, the five-column CSV, the actions with undo in the tab and the model view's section, `analyzr questions outside\|link\|place`; no BPMN writing | 4.5 d |
| S5c-2 | "Model amendments" (decision 25): `applyAmendments` and `readAmendable` in `@analyzr/bpmn-facts`, `model_amendment` (migrations 0015/0016), uploaded and amended revisions with the plan on the head, re-application at import with `amendment-conflict` and the concurrency token, withdrawal, the cost in the dry run, the amendments in the import and PUT results, the change list and downloads, the routes, the form at the question with „Sammeln“ and the model view's „Ergänzen“, `analyzr models amend\|pull` and `analyzr amendments` | 8 d |
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

**Order since decision 25** (2026-10-17, „Jetzt, vor S2“): S5c-1 → S5c-2 → S2a/S2b → S2c → S3c →
S6; after the owner's live runs S5b, S7 and facts v2 (§6, the reindex with judgement carry-over
first). S5c-1 comes first because it needs no BPMN writing and makes most items actionable at
once with use cases that exist; S5c-2 follows because S2 builds on its revision shape (S2a's
provenance follows `source.upstream`, S2b's `importImpact` plans amendments, S2c's trust rule
reads the amended calls; §3.3, §3.10, "S2" below). The owner answered §10.9 on 2026-10-17
(decision 25.1–25.4), so S5c-2 follows S5c-1 directly.

**After S2a** (2026-10-17): the owner asked to simplify the UI from the users' needs („Denke aber
bitte auch noch daran, die UI etwas zu vereinfachen. Denke aus User Need Sicht. Wirkt alles
inzwischen etwas überladen“). The UI simplification ([UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md),
written by a separate run) therefore comes next and takes S2a's web parts; then S2b → S2c → S3c →
S6, and after the owner's live runs S5b, S7 and facts v2.

About seven weeks of agent work, plus the owner's runs; S5c adds about 12.5 days. Every slice runs
all gates (AGENTS.md) before it is called done and records deviations here as "S<n> as
delivered".

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
    number of candidate pairs the waiting tasks will judge (S2b's follow-up, delivered in its step 3b as `ProjectSummary.pairsToJudge` with the waiting line's `about N pairs to judge`), requeueing a single
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
placements) right after. S2c: §3.10, only with the owner's OK (given with decision 24.2). Since
decision 25, S2 comes after S5c-2 and builds on its revisions: S2a writes the manifest fields on
uploaded revisions only and its readers (`external-ids`, „Herkunft“, `external-id-changed`)
follow an amended head's `source.upstream`; S2b's `importImpact` plans the re-application of live
amendments per file with S5c-2's `planAmendments` (applied, in the source, conflicts) and computes
the impact against the would-be amended head; S2c classifies an amended head by its uploaded
revision and treats its applied or `in-source` `call-target` amendments as modelled (§3.10,
decisions 25.2 and 28 (2)), and option (a)'s list leaves their calls out. Does not touch: facts, the claim
input, MCP (`RevisionSource` appears in no MCP output schema), procedures. Done when: provenance
round trips through PUT, import and the web; a manifest's pinned keys win over paths; a checksum
mismatch gives `manifest-sha-mismatch` and the file is imported; `external-id-moved` and
`external-id-changed` appear in their cases; absent keys respect `source.scope`; a key map
rebuilt from `external-ids` equals the one the import used; `extractor-loss` fires on synthetic
fixtures (duplicate and illegal ids, unknown elements) and never on the corpus; the recompute
golden digest is unchanged after the refactor; the dry run's impact equals what the real import
then does (property test over seeded imports, growing with the follow-up); `analyzr import
--dry-run` and the deletion impact in `models delete` print it; corpus behaviour unchanged.

**S2a as delivered** (2026-10-17, branch `feat/integration-and-gaps`; every gate green): the
server, contracts, client and CLI parts of S2a. The web parts of S2a („Herkunft“ in the model view,
badges in the models table, reading `analyzr-import.json` from a dropped folder) are deferred to
the UI simplification slice ([UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md), written by a separate
run), which the owner asked for with S2a („die UI etwas zu vereinfachen … Wirkt alles inzwischen
etwas überladen“), so that they are built into the simplified UI instead of onto today's; until then „Hochladen“ imports a bundle
folder without its manifest, under the path keys, which equal the pinned keys for every bundle the
integrate skill writes (§3.2), and without declared provenance. (Since UX8, 2026-10-18, the web
parts are built: „Hochladen“ reads the manifest of a dropped folder like `analyzr import`,
`Model.source` gives the models table's chip and the project's subtitle, the model view shows
„Herkunft“, the derived chip and the import loss; UX-SIMPLIFICATION.md §7 "UX8 as delivered".)
Delivered:

- **Contracts** (`packages/contracts/src/api/import-manifest.ts`): `ImportManifest`
  (`analyzr-import/1`: `source` with the required `system`, a lowercase slug as in
  `keymap.json`, `systemVersion`, `exportedAt`, `importer`, `scope`; per file `path`, `key`,
  `externalId`, `externalPath`, `url` (http(s), no credentials), `derived` (`export`,
  `converted`, `reconstructed` with a required `llmModel`, `as-told` with opaque `from` ids),
  `losses` (≤ 20, the codes of §3.2 plus S3b's `layout-missing`, and any newer converter's code,
  a lowercase slug stored as declared) and `sha256`; `valueChain`, `inventory`; unique paths and
  pinned keys; unknown fields dropped; identity fields without control characters or lone
  surrogates, the informational `systemVersion`, `externalPath`, `converter` and `llmModel`
  tidied instead, `tidyDeclared`), `ImportWarning` (`manifest-sha-mismatch`, `external-id-moved`,
  `external-id-changed`, `provenance-kept`, with an English message and the identities or
  checksums), `ExternalIdList`; `RevisionSource` gains the typed fields of §3.3 (`uploader`,
  `manifestSha256`, `system`, `systemVersion`, `exportedAt`, `importer`, `scope`, `externalId`,
  `externalPath`, `url`, `derived`, `losses`); `ImportFileOutcome` and `PutModelResult` gain
  `importWarnings`, present only when there is one, so results without a manifest keep their
  shape; `OpenQuestionKind` gains `extractor-loss` („Elemente beim Import verloren“). Routes:
  the part `manifest` of `POST …/imports`, the header `Analyzr-Manifest` of `PUT
  …/models/by-key/{key}`, `GET …/external-ids?system=` (permission `read`). The client is
  regenerated.
- **Server.** `apps/server/src/domain/provenance.ts` (pure): the manifest parsed and checked, the
  `source` of an uploaded revision, the identity warnings, the `external-ids` list. A listed
  file gets its pinned key and its declared provenance on the uploaded revision; an amended
  revision keeps none of its own, and every reader (`external-ids`, the identity warnings, the
  change list) takes the provenance from the uploaded revision through `source.upstream`
  (`RevisionRepo.uploadedSources`), or, when that revision came without a manifest (a web
  upload, a PUT without the header), from the newest revision a manifest declared. `model_revision.extract_warnings` (migration 0017, generated):
  every revision written since stores the extractor's warnings at insert (every entry, each cut to
  300 characters as in the results; `[]` for none); older rows stay null. The gap signal
  `extractor-loss` (§4.3) reads the head revision's stored warnings. The change list's Markdown
  names per model where it lives in the source tool („Im Quellsystem (signavio): <tool folder> ·
  Im Quellsystem öffnen“, §4.8 c "Exports"), from the uploaded revision.
- **CLI.** `analyzr import <dir>` reads `analyzr-import.json` at `<dir>`, checks it before
  sending anything, also before `--create` creates the project (an invalid manifest exits 1,
  nothing imported, naming the manifest's importer as a hint that a newer converter may need a
  newer analyzr), refuses a folder without a manifest whose subfolders hold one (`found
  analyzr-import.json in 2026-10-14-signavio/: import that folder …`: the bundles of a
  workspace's `bundles/` would otherwise get keys starting with their folder names), plans with
  the pinned keys (also the local duplicate check), sends each batch the manifest's subset for its
  files, prints `manifest: analyzr-import.json (signavio), 6 of 6 files listed: keys pinned,
  provenance stored for 6` (`provenance stored for 0; 6 unchanged keep what analyzr had` for
  identical bytes), the files the manifest does not list and the ones it names that are missing,
  each file's import warnings (`      external-id-moved: …`, always, not only with `--verbose`),
  `<project>: N import warnings (…); the files were imported` and, after `external-id-moved` or
  `external-id-changed`, one `next:` line each before the agent step (`next: same model twice?
  delete the extra key (analyzr models delete -p <p> <key>) and re-import with the key pinned
  …`, `next: different models? re-import the signavio bundle and give the aris bundle a key
  prefix (aris/…)`; the agent line then starts with `then:`), and a hint to push the bundle's
  value chain (`analyzr value-chain push … --dry-run`); `--json` gains `manifest` (only with a
  manifest: `system`, `listed`, `stored`, `kept`, `unlisted`, `missing`, `valueChain`); warnings
  never change the exit code. `analyzr models external-ids -p <project> [--system <s>] [--json]`
  (any credential); its text names every tool id several keys carry (`signavio id sid-… on 2
  keys: …`).
- **Plugin `analyzr-integrate` 0.1.1** (text only, no script changed, so `normalize-bpmn` stays
  0.1.0 and its golden bundle unchanged): the skill says that `analyzr import` reads the manifest
  now and that „Hochladen“ does not yet (same keys, no provenance; the CLI preferred, the web path
  marked „ohne Herkunftsangaben“), and labels the import warnings in German (on
  `external-id-changed` it stops and asks, §3.4).
- **Live-run neutral**: provenance stays out of facts and `facts_hash`; no change to the
  extractor or `FACTS_VERSION`, the rule tier, claim input formats, submission validation,
  procedures, the pipeline plugin `analyzr`, MCP tools, prompts and snapshots (`RevisionSource`, `ImportWarning` and
  `OpenQuestionKind` appear in no MCP output schema, checked against
  `apps/server/test/integration/__snapshots__/mcp-tools.json`), recordings or reports;
  `claim-golden.test.ts` green; the corpus JSON of `import` and `seed --json` unchanged (no
  manifest, no warning). What changes for every ingest: an uploaded revision's `source` carries
  `uploader`, and its row the stored warnings.

Choices the spec left open (the owner may overrule):

- **PUT carries provenance in a header**: `Analyzr-Manifest`, the base64url of the UTF-8 JSON of
  a manifest that lists exactly this file (its `key`, if given, equal to the PUT's key; its
  `path` becomes `source.path`). §3.3 names PUT but no transport; a header keeps the raw-XML body
  and the one manifest schema.
- **An invalid manifest refuses the request** (422 `validation-failed`, reason
  `invalid-manifest`) instead of being ignored: the first import fixes the keys for good (§3.4),
  and an ignored manifest would fix path keys the consultant did not confirm. Two `manifest`
  parts are refused too.
- **`manifestSha256` is the SHA-256 of the manifest bytes the server received** (the batch's
  subset, compact JSON from the CLI), set only on files the manifest lists. A text part's line
  breaks may arrive as CRLF (multipart rules), which is why the CLI sends compact JSON.
- **A file the manifest does not list** keeps its path key and gets no declared provenance
  (`kind`, `path`, `uploader` only); the CLI names such files. A manifest entry without a file is
  ignored by the server and named by the CLI.
- **`uploader` on every uploaded revision**, not only with a manifest (§3.3: set by the server at
  ingest), so S2c can classify revisions stored from now on.
- **The identity warnings** compare with the live heads before the request (deleted models do not
  count) and with earlier files of the same request that became heads; they are computed for
  `created`, `revised` and `unchanged` files (an unchanged file keeps its first provenance, the
  warning says what the manifest declares now); `external-id-changed` also fires when only the
  system differs; a head or file without both a system and a tool id raises neither (the as-told
  case of §3.4). `manifest-sha-mismatch` is also listed on a file that then failed. Their
  messages say the consequence (`… already belongs to vertrieb/angebot: two models now carry it
  (moved or renamed in the tool?)`, `this file (aris id …) revised vertrieb/auftrag, which held
  signavio id …`).
- **`provenance-kept`** (an addition after the review): an `unchanged` file the manifest lists
  whose declared system, tool id, tool folder or link differs from the provenance analyzr keeps,
  or for which analyzr keeps none (stored without a manifest), gets this warning (§3.3: identical
  bytes keep their first provenance). The common case is a folder moved in the tool, which leaves
  a Signavio export's bytes as they were: until the identity rows of decision 29 (1) landed
  (§10.10; S2b's follow-up step 5, 2026-10-20, which narrowed the warning to the derivation, "S2b
  follow-up step 5 as delivered"), `external-ids` and the change list kept the old tool folder,
  and the warning said so. Never next to `external-id-changed` (until step 5).
- **An upload without a manifest keeps a declared identity** (an addition after the review): the
  readers fall back to the newest revision a manifest declared, so a later „Hochladen“ of a
  re-export (the web sends no manifest until its S2a part) or a PUT without the header does not
  drop a model from `external-ids` or from the identity warnings' protection. Known interim gap:
  a bundle imported first through the web records no identity at all, and importing the same
  bytes again with the CLI cannot add it (`provenance-kept` says so); the skill therefore prefers
  the CLI for a bundle (plugin 0.1.1). Since UX8 „Hochladen“ reads the manifest as well, and
  plugin 0.1.2 (S2c-2) no longer marks the web path „ohne Herkunftsangaben“. Decision 29 (1)
  closed the gap (S2b's follow-up step 5, 2026-10-20): the identity row is written also for
  unchanged bytes whose declaration differs, through the CLI and the web alike.
- **Informational declared fields are tidied, identity fields refused** (an addition after the
  review): `systemVersion`, `externalPath`, `derived.converter` and `derived.llmModel` accept any
  string within their length; analyzr stores them with lone surrogates replaced by U+FFFD, control
  characters by spaces, trimmed, and an empty one as absent (the integrate plugin 0.1.0 writes an
  export's `exporterVersion=""` as `systemVersion: ""`). `path`, `externalId`, `scope`, the
  importer and the link refuse control characters and lone surrogates (PostgreSQL's jsonb holds
  neither U+0000 nor a lone surrogate, so they answered 500 for the whole request before), and the
  link refuses a user name or password (it would be stored for good).
- **`extract_warnings` is not exposed on `Revision`**: it is read by `extractor-loss`, whose
  question lists the losses; the revisions list stays small.
- **`extractor-loss`** is one question per model (subject `model`), listing up to 10 losses in
  German („doppelte ID „Task_A““, „ungültige ID „4711““, „nicht lesbares Element
  „bpmn:unknownThing““, „ein Element ohne ID (bpmn:Task)“, „Prozess mit ungültiger ID „4711“
  (samt Inhalt)“; an id cut with the stored message ends in „…“); a dropped diagram element
  (`bpmndi:BPMNShape`, matched by local name since the prefix is the file's) and an element of a
  namespace bpmn-moddle does not know („unrecognized element“, a vendor's extension) do not
  count; the count reads „mindestens“ when the extractor stopped listing (`too-many-warnings`) or
  a process went with its content; it is versioned by the losses without
  line and column, so an amendment elsewhere keeps its id; its only action is the note (the fix
  is a new export, the question says so); an amended head is read by its own stored warnings,
  which carry the codes of its uploaded revision (an amendment adds no warning code, §4.8 c).
- **`GET …/external-ids`** is one unpaged list sorted by key; `system` is optional; a model whose
  manifest named no tool id is listed with `externalId: null` (the key map identifies it by its
  tool path), so the rebuilt key map has every entry.
- **The change list's CSV is unchanged**; only the Markdown names the tool folder and the link.

**S2b step 1 as delivered** (2026-10-18, on the branch, every gate green): §3.5's refactor. The
project recompute (`apps/server/src/domain/recompute.ts`) is the pure `planRecompute` (over the
head facts with the rule tier's result, the relations and their histories: the steps `derive`,
`withdraw` and `refresh` in the order they are written, the findings and the summary; new
assertions get provisional seqs after every stored one, so the planned states are the stored
ones) and `writeRecompute`, which performs a plan in the recompute's order;
`relation-state.ts` splits `refreshRelation` into the pure `refreshPatch` and `writeRefresh`. A new
relation's id comes from the writer, right before its event, as before: ids of one millisecond do
not sort by creation, and the placement claim lists relations by id (`claim-golden.test.ts` caught
it). Pinned by a golden digest over a seeded history computed on the code before the split
(`apps/server/test/integration/recompute-golden.test.ts`: `nordwind-handel` imported, a rule
acceptance rejected, proposals accepted and held, a call target changed, a model deleted and
revived, an unchanged re-import; relations, assertions, events and findings with ids and
timestamps normalized). No behaviour changes; the claim inputs, the MCP snapshots and the reports
are unchanged.

**S2b step 2 as delivered** (2026-10-18, on the branch, every gate green): `importImpact` and the
dry runs in REST and the CLI. Contracts first: `ImportImpact` (`files`, `acceptedCalls`,
`proposalsAdded`, `proposalsWithdrawn`, `endpointsChanged`, `findingsAdded`, `findingsResolved`,
`absentKeys`; lists of at most 100 with counts), `ImportResult.impact` (only on a dry run),
`PutModelDryRunResult`, the query `dryRun` of `POST …/imports` and `PUT …/models/by-key/{key}`,
and `GET …/models/{m}/deletion-impact`; the client regenerated. Server: the pure
`src/domain/import-impact.ts` over `planRecompute` (step 1) and `previewIngest` in `ingest.ts`
(the same reads and extraction as the ingest, an amended head where live amendments apply, no
write, no lock, permission `read`; the rules principal taken from the histories, so a dry run
creates nothing). The absent keys are the live keys of the manifest's system that neither the
manifest nor the request names, within `source.scope`, so the CLI sends the whole manifest with
each batch of a dry run. CLI: `analyzr import --dry-run` (merged impact, the batch note) and the
deletion impact in `analyzr models delete`'s listing. Tests: real-PostgreSQL
`import-dry-run.test.ts` (the corpus's dry run equal to its import, outcomes byte for byte, the
accepted calls, proposals and findings it then makes, nothing written, an unchanged re-import
empty, a changed call target withdrawn, a read-only token previews but cannot import, PUT's dry
run, the deletion impact equal to the deletion, absent keys within a scope), unit tests of the
pure parts and the CLI. Left: the web's „Vorschau“ before „Importieren“ (UX-SIMPLIFICATION.md §6)
and the follow-up (judgements, tasks, placements).

**S2b step 3 as delivered** (2026-10-18, on the branch, every gate green): the web's „Vorschau“ before
„Importieren“ (UX-SIMPLIFICATION.md §6): a drop runs the dry run with the plan the import will send
(each batch with the whole manifest) and shows it in the result's layout with at most three lines
of impact, the capped lists behind „Was ändert sich?“, the shared-top-folder hint and the batch
note; „Importieren“ sends the same plan, „Abbrechen“ sends nothing. One click more, no new screen.
Left: the follow-up (judgements made non-current, tasks queued or cancelled, the placement task
due, placements changed or missing), and the plugin's next version with the pre-approved
`--dry-run` (since decision 29 (2) a bundled read-only script, not a CLI pattern; plugin 0.1.3).
Steps 1 to 4 of the follow-up, the relations side, the placements, the surfaces, the size of the
agents' next run and the plugin 0.1.3, are delivered (2026-10-20, "S2b follow-up step 1 as
delivered" to "S2b follow-up step 4 as delivered" below).

Left for S2b: `importImpact`, the dry runs (`POST …/imports?dryRun=true`, `PUT …?dryRun=true`,
`analyzr import --dry-run`), the deletion impact in `models delete`, and the absent keys of §3.5,
which respect `source.scope` (stored on each revision since S2a). Left for the plugin's next
version, with S2b's dry run: the skill's rebuild of a lost `keymap.json` from `analyzr models
external-ids` (§3.7 step 3, with the rule for a tool id several keys carry) and the pre-approved
`--dry-run`; plugin 0.1.1 changes only the skill text (above). Plugin 0.1.2 (S2c-2) recommends the
dry run in the report, for the consultant to run; the key-map rebuild and a pre-approved `--dry-run`
were still left (by decision 29 (2) the read-only script `analyzr-read.mjs`; both delivered with
plugin 0.1.3 in step 4 of S2b's follow-up, "S2b follow-up step 4 as delivered" below). Left for the
plugin's next version as well, and still left after 0.1.2 (no script changed): `normalize-bpmn`
writing `null` for an empty or blank `exporterVersion` (analyzr already stores it as absent;
delivered with plugin 0.1.3 as well). Left for the UI simplification slice
([UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md)): S2a's web parts, that is „Herkunft“ in the model
view, the badges in the models table and the manifest of a dropped folder in „Hochladen“.

Tests: server unit tests (`provenance.test.ts`: the golden manifest of `tools/integrate`, also
with a byte order mark, every refusal (also a NUL or a lone surrogate in an identity field or the
link, credentials in the link, a blank `llmModel`), a newer converter's loss code and an empty or
odd informational field accepted and stored tidied, the source fields, the warnings in each case
including earlier files of one request, `provenance-kept` and a stored file without a manifest
that keeps the key's identity, the `external-ids` list, `extractor-loss` on synthetic fixtures
with duplicate and illegal ids and an unknown element and its stable id, without a duplicated
diagram shape or a vendor element, with a process lost with its content, an id cut with its
message and „mindestens“ after 100 warnings, the change list's origin line;
`open-question-actions.test.ts`: the note as its only action); real-PostgreSQL tests
(`provenance.test.ts`: the golden bundle imported with its manifest, its provenance on every
uploaded revision and the key map rebuilt from `external-ids` equal to the one the bundle was
written with; pinned keys, a checksum mismatch, `external-id-moved`, `external-id-changed`
(also across systems), the as-told case, an invalid manifest, a manifest with a NUL, a lone
surrogate or credentials refused with 422 and none of the request's files imported, an empty
`systemVersion` and odd tool folder stored tidied with the scope; PUT with `Analyzr-Manifest`
round-tripping and refusing a foreign key, several files, bad base64url and a lone surrogate;
identical bytes keeping their first provenance, with `provenance-kept` after a folder move and
silence for the same manifest; a web-style upload without a manifest keeping the identity in
`external-ids` and for `external-id-moved`; an amended head following `source.upstream` before
and after a re-import, also in the change list's Markdown; `extract_warnings` written at insert
and `extractor-loss` dropping after a clean export; migration 0017 on a database with a revision
leaves it null; `corpus.test.ts`: every corpus revision stores `[]` and no `extractor-loss` item
exists on either landscape, counts only); CLI unit tests (`manifest.test.ts`: also an empty
`systemVersion`, the stored and kept counts, no project created with `--create` for an invalid
manifest, the importer named in a refusal, bundles in subfolders refused, the `next:` lines, a
tool id on two keys) and an e2e section (the golden bundle under its pinned keys, `models
external-ids` equal to the key map, unchanged bytes, a moved tool id with a checksum mismatch and
its `next:` line).

Verified (2026-10-17, after the review round, and again by a separate gate pass on the final
tree, which changed no code): every gate (`pnpm format:check`, `pnpm -r typecheck`, `pnpm -r
lint` with dependency-cruiser: no violations, 144 modules, 734 dependencies; `pnpm -r test` with
Testcontainers: server 1,572 tests in 75 files, web 432, CLI 248 plus 7 skipped (the live
project), bpmn-facts 199, contracts 156, integrate 145, eval/tools 108, relations 85, agent-sim
57, procedures 37, demo 27, notices 9, client 4; `pnpm eval:candidates`, `pnpm eval:replay`,
`pnpm eval:placements`, `pnpm eval:descriptive`); `git diff --stat eval/reports` empty; the MCP
snapshots unchanged (none of `uploader`, `manifestSha256`, `importWarnings`, `extractor-loss` or
`provenance-kept` in `mcp-tools.json`); no diff under `apps/server/src/mcp`,
`packages/bpmn-facts`, `packages/relations`, `packages/procedures` or `plugins/analyzr`;
`claim-golden.test.ts` and `corpus.test.ts` green; the client regenerated with `pnpm --filter
@analyzr/client generate` ([DEVELOPMENT.md](DEVELOPMENT.md) "M6 S2a (2026-10-17)"). Not checked:
the web in a browser (S2a adds only the new kind's label and hint there; no Playwright run), a
real tool export with a manifest (only the integrate plugin's synthetic golden bundle; HANDOFF §8
"M6: sample exports"), the plugin 0.1.1 in a live Claude Code session, a scratch Docker stack
(the CLI e2e tests ran against a server started from source on Testcontainers' PostgreSQL),
migration 0017 on the owner's stacks (not touched; the test runs it on a database that holds a
revision), the CI run (next push).

**S2c "The trust rule"** (decisions 24.2, 25.2 and 28; §3.10). Planned on 2026-10-19 at about 5 d
in four steps, each passing every gate on its own:

| Step | Scope | State |
|---|---|---|
| S2c-1 | the trust class and the rule tier: the contracts (`RevisionSource.trust`, `Model.trust`, `ImpactFile.trust`, `ImportImpact.callsProposed`, `ImportFileOutcome.trust`, `trust-kept`, `AutoAcceptSystemRule.proposed`), `trust.ts`, ingest and the three planners, the recompute with the rationale, the system rule's text and count, the client texts | done 2026-10-19 (below) |
| S2c-2 | the fast path: the bulk dialog's group „Eindeutige Aufrufe aus abgeleiteten Modellen (n)“ opened by `?bulk=calls` (the system card's count of these proposals a link to it), a line in the upload's „Als Nächstes“ and in „Übersicht“'s („12 eindeutige Aufrufe zuerst bestätigen · Gesammelt annehmen“), `analyzr import`'s `next:` line and a warning before sending with an agent token, the integrate plugin 0.1.2 (its skill and Signavio notes say that calls of engine-less or converted bundles arrive as 90 % proposals) | done 2026-10-20 (below) |
| S2c-3 | decision 19's extension: the criteria `proposedBy`, `derivedKind` and `converter` (migration 0018), the block reasons `agent-upload` and `amendment-conflict`, an agent rule pinned to agent proposals, the fifth write path right after the recompute of an ingest, a PUT, an amendment write or withdrawal, or a deletion, apply, preview, ledger and revocation, `autoAcceptedCalls` in an owner's dry run, `analyzr rules add --derived`, the dialog's third „Art“ and the bulk toast's offer | done 2026-10-20 (below) |
| S2c-4 | „Vor der Vertrauensregel angenommen“: the append-only `revision_trust_review` (migrations 0019/0020), the list of decision 28 (3), „Zurück in die Prüfung“ and „Behalten“ from the system rule card, two owner-only routes, `analyzr rules pre-trust` | done 2026-10-20 (below) |

**S2c-1 as delivered** (2026-10-19, on the branch, every gate green, with a review round's fixes;
[DEVELOPMENT.md](DEVELOPMENT.md) "M6 S2c-1 (2026-10-19)"). Contracts first (client regenerated):
`TrustClass`, `TrustReason`, `RevisionTrust` and `ModelTrustSummary`, the shared
`TRUST_REASON_LABELS`, `DERIVED_CALL_CONFIDENCE` (0.9) and `DERIVED_CALLER_MATCH`
(`derived-caller`); `RevisionSource.trust` (optional), `Model.trust` (REST only; `null` for a head
stored before S2c), `ImpactFile.trust`, the required `ImportImpact.callsProposed`
(`ImpactProposedCalls`: the capped items with `wasAccepted` each, and the totals `wasAccepted` and
`byReason` over all calls, each counted once under its caller's first reason, so the parts add up
to `count`), `ImportFileOutcome.trust` (only for a derived file, so corpus results keep their
shape), the import warning `trust-kept` (at most 4 import warnings instead of 3) and
`AutoAcceptSystemRule.proposed`; the import and PUT route descriptions name `trust-kept` and the
dry run's classification. Server: the pure `apps/server/src/domain/trust.ts` (`trustOf`,
`modelTrust` and `trustByModel` over `RevisionRepo.headTrustRows` (the head, an amended head's
uploaded revision, its engine and the uploader's principal kind; never the newest-declared
fallback of `uploadedSources`), `applyTrust`, `trustRationale`, `trustSummary`,
`trustKeptWarning`); `storeFile` writes `trust` last on the uploaded head, amended revisions get
none; `RecomputeInput.trust` is required, so `recomputeProject`, `previewIngest`,
`deletionImpact` and the amendment effect (before and after, with the derived head's call
targets) all apply it; the rationale is part of a stance's comparison, so a change of reasons
re-asserts the proposal once; when the rules stop deriving a marked call, the withdrawal also
drops `match` and `calledElement` from the relation's attributes, so a relation an agent keeps
open no longer reads as a derived call; `recomputeProject` returns the derived proposals it
recorded for S2c-3 (unread until then); the system rule's German description names the rule
(„… wird beim Import angenommen, wenn das aufrufende Modell aus Camunda 7 oder 8 stammt, über den
Owner-Zugang oder das Web hochgeladen wurde und nicht als konvertiert, KI-rekonstruiert oder aus
einem Interview angegeben ist. Sonst wird er mit 90 % vorgeschlagen. Ein Aufrufziel, das du in
analyzr ergänzt hast, gilt immer als modelliert.“) and `proposed` counts the open call proposals
with the marker. Web: the tier hint „… aus Camunda-Modellen automatisch angenommen.“, the detail
„eindeutiger Aufruf aus abgeleitetem Modell“, the „Vorschau“ line „12 Aufrufe nur vorgeschlagen
(ohne Camunda-Engine) – nach dem Import gesammelt annehmen“ (the most common reason of `byReason`)
and the list „Aufrufe als Vorschlag“ (with „(bisher angenommen)“), the line „Aufrufe: nur als
Vorschlag (…)“ in „Herkunft“ for a derived revision („· von dir gesetzte Aufrufziele gelten als
modelliert“ when there are any; none for a modelled or older one), the `trust-kept` text, the
system rule card („Eindeutige Aufrufe aus Camunda-Modellen nimmt analyzr beim Hochladen an · immer
aktiv · 10 angenommen · 12 aus abgeleiteten Modellen vorgeschlagen“), „Verlauf“ titling the
proposal „Eindeutiger Aufruf erkannt (analyzr)“, and the empty texts of „Relationen“ and of a new
project's „Übersicht“. CLI: `analyzr import --dry-run` prints `propose instead of accept (trust
rule): 12 (no engine 10, agent token 2), 3 of them accepted until now` with up to five examples,
`analyzr models delete`'s impact `N calls only proposed (trust rule)`, `analyzr rules list` the
system rule as `call relations of modelled callers …; N accepted, M only proposed (derived
callers, trust rule)`. No migration, no new route or use case (the existing `write` and `read`
checks hold), MCP unchanged. Deviations from the plan, most from the review round:

- **The totals past the cap.** `callsProposed` is a schema of its own with `wasAccepted` and
  `byReason` over every call (the plan had per-item flags only, so the CLI's line contradicted
  itself past 100 calls); the web's „Vorschau“ line takes its reason from `byReason`, not from
  `files[].trust`.
- **`trust-kept` compares the class, not the reasons.** A revision stored before S2c counts as
  modelled, so re-importing its engine-less bytes with the owner key now warns.
- **`ImportFileOutcome.trust` also on unchanged files** whose kept class is derived, and in dry
  runs.
- **The card's count is plain text** until S2c-2 opens a list of exactly those rows (`?tier=key`
  showed every „Gleicher Name“ proposal, against the rule that a count opens its own list). S2c-2
  made it a link to `?bulk=calls`.
- **Recognized by the assertion.** The web tells a trust-rule proposal by itself (rule, proposal,
  tier `key`, 0.9, a rationale: `isTrustRuleProposal` in `lib/review.ts`), not by the relation's
  marker, which goes when the caller turns modelled: „Verlauf“ titles it without the „Gleicher
  Name“ badge, and once the rule accepted the call, its old proposal no longer shows as
  „Begründung“ (`currentProposal`).
- **The empty „Übersicht“** promised „verknüpft eindeutige Aufrufe sofort“; it now reads „…
  verknüpft eindeutige Aufrufe aus Camunda-Modellen sofort und schlägt die übrigen und gleiche
  Nachrichtennamen als Relationen vor.“
- **Tests.** The fake extractor's default engine is `c7` (a test that wants a derived model sets
  `engine: null`); the recompute golden digest (`a83c10ba…`) is unchanged because its normalizer
  drops `trust` from `model.revised` payloads before hashing, while a separate assertion checks
  that every one is modelled; the amendment cases sit in the new `integration/trust.test.ts`.

Tests: server unit `trust.test.ts` (the class's truth table and the reasons' order, an amended
head reading its upstream, applied and `in-source` call targets as modelled and conflicts apart,
`applyTrust` over the real `runRules` for a derived, a modelled and a legacy caller, every other
branch of a derived caller (ambiguous, by name, dynamic, recursive) and the findings unchanged,
the pinned German texts, `trust-kept`), `recompute-trust.test.ts` (the real `planRecompute` and
`writeRecompute` in memory: a derived call proposed with its rationale, a rule acceptance replaced
when the caller turns derived and back, a human acceptance, rejection and hold kept, the marker
dropped with the rule's proposal and when the callee is deleted, the totals past the cap, a
modelled landscape planned exactly as before), `import-impact.test.ts`, `amendments.test.ts`,
`auto-accept-rules.test.ts`; real PostgreSQL `trust.test.ts` (a C7 upload by the web or the owner
key modelled and its call accepted; the same bytes with a write token, without an engine or
declared converted or reconstructed derived and the call proposed; a C8 export modelled; a
declared `trust` never stored; the findings the same whatever the class; unchanged bytes keeping
their class with `trust-kept`; the Signavio golden bundle derived with „Rechnung stellen“
proposed; the system rule's count; a call target set in analyzr accepted on an engine-less caller
while its other call stays proposed, the manual link retired, the effect equal to what the write
changed, kept through re-imports also `in-source`, the proposal back after a withdrawal;
revisions stored before S2c keeping their acceptances), `import-dry-run.test.ts` (derived files in
the property test: `callsProposed` and `ImpactFile.trust` equal what the import then does; a
read-only token previews agent uploads), `provenance.test.ts`, `real-libraries.test.ts`,
`review.test.ts`, `recompute-golden.test.ts`; web `lib`, `limits`, `provenance-lib`,
`provenance-view`, `upload-panel`, `rules-tab`, `relation-table`, `review-details`, `demo-mode`;
CLI `manifest`, `models`, `rules`, `amend`, `amendments` (the line with two reasons, two batches
and a count past the cap); Playwright `auto-accept.spec.ts` (the card's text).

What it costs and leaves open. A landscape a human imports from Camunda behaves as before, so the
corpus, the seeds, the demo and the owner's live runs are unchanged (eval reports, MCP snapshots,
procedures, recordings and claim inputs). A landscape without an engine or imported with an agent
token now gets its unique calls as proposals, so its first analysis takes one review step more
(S2c-2 below makes it one bulk accept): on the UI load guard's `signavio-beispiel`, imported with a
write token, „Rechnung stellen“ is now proposed, the tab reads „Relationen 1 zu prüfen“ and „Als
Nächstes“ adds „Oder jetzt schon: Vorschläge prüfen (1) …“. Such proposals are not settled, so a
claim assigns the pair to an agent until someone accepts it; the procedure's candidate keeps basis
`rule` (S7 below). The integrate plugin 0.1.1 still promised otherwise: its report lists the calls
with `match` `one` as „Aufrufe, die analyzr beim Import als Beziehung annehmen kann“ and its
Signavio note says such a call „is accepted at import“, while an engine-less export's calls now
arrive as 90 % proposals; 0.1.2 (S2c-2) corrects both.
Revisions stored between S2a and S2c without an engine or by an agent token keep their
acceptances until the owner reviews them (listed since S2c-4, below).

**S2c-2 as delivered** (2026-10-20, on the branch, every gate green, with a review round's fixes;
[DEVELOPMENT.md](DEVELOPMENT.md) "M6 S2c-2 (2026-10-20)" and "The trust rule"). The fast path for
derived calls: one bulk accept (a link opens the dialog with them selected, one click accepts
them; at most 500 at a time, one an agent asks about or objects to decided one by one) takes the
unique calls of a derived landscape before the agent runs, so the agent's relations claims skip
those pairs (accepted pairs are settled) and the agent judges
only the pairs that are really open; the CLI and the integrate plugin point there. No route, no
migration, no MCP change; the OpenAPI spec and the client are unchanged.

- **What counts.** `isBulkDerivedCall` in the contracts (`api/relations.ts`, a plain function): an
  open unique call from a derived model (call, `proposed`, tier `key`, `attrs.match`
  `derived-caller`) with no agent's question on the proposal its status rests on and no current
  no-link, so the bulk accept takes it as it stands. Every number that leads to this bulk accept
  counts these: the web's (`isBulkCall`, mirrored in `apps/web/src/lib/review.ts`), the system
  rule card's (`isOpenDerivedCall` in `trust.ts` picks the stored rows, now also requiring tier
  `key`, which S2c-1's count did not check; `auto-accept.ts` builds their views and filters with
  `isBulkDerivedCall`) and `analyzr import`'s, so each equals the selection its link opens (up
  to 500; the rest follow).
- **The bulk dialog.** `isDerivedCall` (the same test without the flags) puts the derived calls
  first under „Eindeutige Aufrufe aus abgeleiteten Modellen (N)“, then the other unflagged pairs
  under „Gleicher Name (M)“; no name flag applies to such a call (it names its target by id); the
  description „Gleicher Name und eindeutige Aufrufe. …“ while such calls are listed. `?bulk=calls`
  opens it by itself for reviewers once the flags are known, titled „N eindeutige Aufrufe
  annehmen?“, with exactly the unflagged calls selected (at most 500: „Höchstens 500 auf einmal;
  die übrigen N danach.“) and the other rows unselected. Closing drops `?bulk` (replace) and
  returns the focus to the page; a stale `?bulk` with nothing to open is dropped. After accepting
  only derived calls the toast says „Eindeutige Aufrufe aus abgeleiteten Modellen.“ and offers no
  rule.
- **The links.** „Übersicht“'s „Als Nächstes“: „N eindeutige Aufrufe zuerst bestätigen ·
  Gesammelt annehmen“ while an agent row leads (after the failed and expired lines), „Davon N
  eindeutige Aufrufe · Gesammelt annehmen“ as the first line under „Vorschläge prüfen“; it
  replaces „Oder jetzt schon: Vorschläge prüfen (n). …“ when every open review item is such a
  call; at most two lines, viewers the text only. The upload's „Als Nächstes“ after „Importieren“:
  first `upload-next-calls`, „12 eindeutige Aufrufe warten auf deine Bestätigung · Gesammelt
  annehmen“. The system rule card's count is a link now (plain text in S2c-1).
- **CLI.** `analyzr import`, after an import with derived models and only while such calls wait:
  `next: 6 models are derived (no engine 6); 1 unique call is a proposal: accept it in the web
  review before the agent runs:` and `  <url>/projects/<p>/review?bulk=calls`, the agent step then
  `then:`. With an agent token, before anything is sent (also for `--dry-run`), on stderr:
  `importing with an agent token (ANALYZR_TOKEN): unique calls become proposals (trust rule);
  unset ANALYZR_TOKEN to import with the owner key` (with `--token`:
  `… (--token): …; drop --token to import with the owner key`).
- **Integrate plugin 0.1.2** (texts only, no script changed, so `normalize-bpmn` and its golden
  bundle stay; hash `b9f2a073…` in `RELEASES`, 0.1.0 and 0.1.1 unchanged): step 5 recommends the
  dry run (`analyzr import … --dry-run`, or the web's „Vorschau“) instead of a probe project and
  notes that it needs an existing project; the report's „Eindeutige Aufrufe“ says that analyzr
  accepts such calls at import only from a Camunda 7 or 8 model uploaded with the owner key or the
  web, and that an engine-less or converted bundle's calls arrive as 90 % proposals the consultant
  accepts in one step with „Gesammelt annehmen“ before the agent starts; the „Import“ step names
  that step before the relations run; the passages saying „Hochladen“ ignores the manifest (stale
  since UX8) are gone; `reference/signavio.md` says the same.
- **Demo.** `demo.spec.ts` treats „Gesammelt annehmen“ as a write label; a demo viewer gets the
  calls line as text only.

Deviations from the plan, most from the review round:

- **The counts leave out flagged calls.** The plan counted every derived call; after „Agent
  starten“ an agent's question on such a pair would have made a link promise N calls and open a
  dialog with 0 selected. The group's heading still counts every derived call, a flagged one in
  it, flagged and without a checkbox (not under „Genauer ansehen“), and the review line shows while
  such a call remains.
- **„Davon N eindeutige Aufrufe“** under „Vorschläge prüfen“, where „zuerst“ read oddly.
- **No rule offer after only derived calls** (no agent rule accepts them); the toast's offer of a
  rule for them came with S2c-3 (below). A mixed selection keeps the „Gleicher Name ab 100 %“ offer.
- **At most 500 selected** from `?bulk=calls`, so the link never ends at a disabled button.
- **The dialog stays open until closed** (`bulkMode`): the accept's refetches dropped its rows and
  unmounted it before its toast, leaving `?bulk` in the URL.
- **The CLI's `next:` line counts the waiting calls**, not the derived models, and prints the deep
  link instead of the label „Gesammelt annehmen“ (which the review page does not show); it no
  longer mentions `analyzr rules add --derived` (S2c-3 adds an owner-key suggestion, below). It
  asks only after an import with derived models (unchanged ones included), so an import of
  modelled files only does not mention calls still waiting from an earlier import.
- **The notice names the token's source and the way out**, since a token left in the shell is the
  plan's main risk and a re-import of the same bytes keeps the class (`trust-kept`); no
  `analyzr:` prefix.
- **Plugin 0.1.2 also fixes the manifest passages** stale since UX8 (the plan changed steps 5 and 6
  only).

Tests: contracts (`isBulkDerivedCall`), server unit `trust.test.ts` (`isOpenDerivedCall`), real
PostgreSQL `trust.test.ts` (a bulk accept of „Rechnung stellen“ at tier `key`, the card's count 1
→ 0; an agent's no-link drops it to 0 with the call still proposed); web `review-lib`,
`bulk-accept-dialog`, `review-inbox` (incl. the accept while another query answers 300 ms after
the landscape), `overview`, `upload-panel`, `lib`, `rules-tab`, `limits`; CLI `import` (the notice
for both sources and a dry run, `--json` with an agent token, the `next:` line, no lookup after
modelled files); integrate `plugin.test.ts`; Playwright `trust-calls.spec.ts` (new: „Hochladen“ and
`analyzr import` with an agent token, each into a project of its own), `ui-load.spec.ts` (the calls
line equals the dialog's selection), `demo.spec.ts`.

What it costs and leaves open. Nothing changes for Camunda landscapes a human imports, so the
corpus, the seeds, the demo and the owner's live runs are unchanged (eval reports, MCP snapshots,
procedures, recordings). On the UI load guard's `signavio-beispiel`, „Übersicht“ reads „1
eindeutigen Aufruf zuerst bestätigen · Gesammelt annehmen“ instead of „Oder jetzt schon: Vorschläge
prüfen (1) …“ (122 → 113 words at 1440, the controls unchanged), and the dialog behind it measures
22 controls and 112 words. Calls nobody accepts stay unsettled, and the claims assign them to judge
as before. Left: S2c-3 (owners' rules for these proposals by derived kind and converter, the toast's
rule offer; delivered 2026-10-20, below), S2c-4 („Vor der Vertrauensregel angenommen“; delivered
2026-10-20, below), the skill's key-map rebuild, a pre-approved `--dry-run` (since decision 29 (2) a
read-only script) and `normalize-bpmn` writing `null` for an empty `exporterVersion` (all three
delivered with plugin 0.1.3, "S2b follow-up step 4 as delivered" below).

**S2c-3 as delivered** (2026-10-20, on the branch, every gate green, with a review round's fixes;
[DEVELOPMENT.md](DEVELOPMENT.md) "M6 S2c-3 (2026-10-20)" and "Auto-accept rules (owner decision
19)"). Decision 19's extension by decision 24.2, narrowed by decision 28 (1): an owner's
auto-accept rule may accept the rule tier's proposals of unique calls from derived models, by the
source the caller declares. For the first analysis: after the first „Gesammelt annehmen“ of a
source's calls the toast offers an owner the rule for that source; once it is on, the unique calls
each later import of that source proposes are accepted in the import's own write, without a
click, before the agent runs (so its claims skip those pairs), marked „Automatisch angenommen“ and
revocable, and the „Vorschau“ (or `analyzr import --dry-run` with the owner key) says so
beforehand. Contracts first (client regenerated), migration 0018, no new route, MCP unchanged.

- **Criteria and storage.** `AutoAcceptCriteria`, the draft, the revision and the rule gain
  `proposedBy` (`agent` | `rule`, default `agent`), `derivedKind` (`export` | `converted` | `none`,
  `none` meaning no kind declared) and `converter` (trimmed, 1–120 characters, no control
  characters, matched exactly, `name@version`). The contract's `checkProposer`, the domain's
  `proposerFits` (reason `derived-criteria`) and the NULL-safe database check
  `auto_accept_rule_revision_proposer_check` (migration `0018_auto_accept_rule_tier.sql`, three
  columns, `proposed_by` defaulting to `agent`) agree: an agent rule names neither; a rule for
  derived calls is a relation rule of tier `key`, type `call`, minimum 0.9, without agent, model or
  ad hoc, names a derived kind and a converter exactly for `converted`; reconstructed and as-told
  cannot be named. Rules from before read as agent rules, saving one unchanged writes nothing, and
  `proposedBy` never changes on a revise (422 `kind-changed`).
- **Matching and safeguards.** An agent rule now requires an agent's proposal, so no existing rule
  starts accepting the rule tier's proposals (pinned for „Gleicher Name ab 90 %“ with type any or
  `call`). A rule for derived calls requires the rule tier's proposal of a unique call from a
  derived model (told by the assertion: rule, proposal, `key`, 0.9, a rationale) whose caller's
  uploaded revision declares the rule's kind and, for `converted`, exactly its converter. The
  block reasons `agent-upload` and `amendment-conflict` follow `no-matching-rule`: no rule, an
  agent rule neither, accepts any proposal on a call whose caller's revision was uploaded with an
  agent token (a revision stored since S2c-1; one stored before carries no class and counts as
  modelled, option (a)), and a rule for derived calls never accepts a call whose call-target
  amendment is in `conflict`.
- **The fifth write path.** `autoAcceptDerivedCalls` runs in `afterHeadChange` right after
  `recomputeProject` (imports, PUT, amendment writes and withdrawals) and in `deleteModel` (a
  deletion that makes a duplicate process id unique), in the same transaction under the lock,
  over only the derived-call proposals that write recorded, in natural-key order, recorded under
  the rule's author and caused by the request's actor. No query without such proposals, one
  without an enabled rule for derived calls; nothing for a write made with an agent token. A
  proposal the rule tier makes again on a relation it already proposed (the callee renamed, the
  reasons changed) is new and accepted; an unchanged or unrelated import records none, so older
  proposals need `apply`.
- **Dry run.** `ImportImpact.autoAcceptedCalls` (items with `ruleId` and `ruleName`, `byRule`,
  `ofProposed`: how many of them `callsProposed` counts) in `previewIngest` and `deletionImpact`,
  only for an actor who passes `admin` (an owner on the web or with the owner key), `count` 0
  without a rule; editors, viewers, read-only and agent tokens never get rule data. The pure
  mirror in `import-impact.ts` reads the plan's new `histories`, so after the import the accepted
  calls equal `acceptedCalls` ∪ `autoAcceptedCalls`.
- **Apply, preview, ledger, revocation.** Triggers per rule; the replay reads the caller's
  declaration from its current head (documented approximation); `AutoAcceptPreview.derivedGroups`
  (open, blocked, accepted, rejected per source a rule can name); `proposedBy` on items and ledger
  entries. Revoking requeues the pair's models unless the same kind of proposal is still open: an
  agent's for an agent rule, the rule tier's derived-call proposal for a rule for derived calls
  (so revoking such an acceptance queues nothing).
- **CLI.** `analyzr rules add --name … --derived export|converted|none [--converter …]` (refuses
  `--kind`, `--tier`, `--min`, `--type`, `--agent`, `--model`, `--ad-hoc`; off unless `--enable`);
  `rules edit` on such a rule takes `--derived`, `--converter`, name and note only, and an agent
  rule never becomes one; criteria and items read `rule tier (derived call)`; `rules preview`
  shows the sources instead of the curve; the system line adds `analyzr rules add --derived accepts
  the next ones` while calls are only proposed. `analyzr import --dry-run` with the owner key
  prints `accept by your rules for derived calls: 12 ("Aufrufe: Export ohne Engine" 12)`; after an
  import with the owner key the `next:` block adds the step for the source most of the waiting
  calls' callers declare: `rules apply <id>` while a rule for it is on, `rules enable <id>` while
  it is off, else `rules add --name … --derived …` (without `--enable`), its arguments
  shell-quoted (`shellArg`, also on the value-chain `push` line). `analyzr models delete` names
  the calls the owner's rules would accept.
- **Web.** The rule dialog's third „Art“ „Eindeutige Aufrufe aus abgeleiteten Modellen“ with
  „Herkunft“ (each source with its open calls) and, for „Konvertiert“, „Konverter“ (sorted by open
  calls, „Lädt …“, „Wähle einen Konverter.“, „Noch kein Aufruf im Projekt stammt aus einem
  Konverter; wähle eine andere Herkunft.“), the hint „Die Herkunft gibt der Import an; analyzr
  prüft sie nicht. Über ein Agenten-Token hochgeladene Modelle nimmt keine Regel an.“, names such as
  „Aufrufe: Export ohne Engine“ within 100 characters; the preview without curve; the row's
  criteria „Eindeutige Aufrufe aus abgeleiteten Modellen · Export ohne Camunda-Engine“ and the
  enable toast „Sie wirkt auf neue Aufrufvorschläge aus abgeleiteten Modellen.“; the page lead
  „analyzr nimmt neue Vorschläge, die eine aktive Regel trifft, selbst an – nie bei einer offenen
  Frage, einem Einwand oder wenn du schon entschieden hast.“; the marks „ausgelöst vom
  Aufrufvorschlag aus einem abgeleiteten Modell (90 %)“; the block labels „Über ein Agenten-Token
  hochgeladen“ and „Ergänzung nicht mehr anwendbar“; the bulk toast's offer „Eindeutige Aufrufe aus
  abgeleiteten Modellen künftig automatisch annehmen?“ (owners, the most common nameable source,
  `?new=calls`); the „Vorschau“ line „… · deine Regel „Aufrufe: Export ohne Engine“ nimmt 12 davon
  gleich an“.

Deviations from the plan, most from the review round:

- **`agent-upload` blocks every rule**, agent rules included, for any proposal on a call whose
  caller's revision an agent token uploaded: decision 28 (1) read literally, "no rule ever"
  (for classified revisions, those stored since S2c-1; an older one counts as modelled, so an
  agent rule may still accept an agent's proposal on its calls). The plan put the check on the
  rule tier's proposals only, and the review reproduced the gap: an agent's own proposal of an
  agent-uploaded caller's call (tier `key`, since the rule tier names the pair) was accepted by an
  owner's „Gleicher Name ab 90 %“. `autoAcceptRelations` makes one more query for it, only when a
  call is among the triggers and a rule is enabled.
- **A write made with an agent token sets off no rule for derived calls**: an agent's upload of a
  callee or its deletion of a duplicate never decides which call is accepted (the plan ran the
  hook for every write).
- **A proposal the rule tier makes again in a person's import counts as new** and is accepted (say,
  the callee renamed), as an agent's re-proposal after a model change is for agent rules (plan
  §4.1: "only the proposals this write recorded"); the review asked to leave such proposals to
  apply, and this was kept on purpose (HANDOFF §4, "Taken during M6 S2c-3").
- **Revocation follows the trigger.** The plan's "any live non-human proposal" kept an agent
  rule's revoked acceptance `proposed` with nothing queued after the agent's proposal was gone
  (the rule tier's proposal usually stays on such pairs); now the trigger's kind decides.
- **Recognized by the assertion**, not by `attrs.match` (equivalent for live stances; the
  preview's in-memory data has no attributes). **No `derived` field** on items or the ledger, only
  `proposedBy`; `derivedGroups` leaves out sources a rule cannot name (reconstructed, as told, a
  conversion without converter).
- **`autoAcceptedCalls` for every owner** (`count` 0 without a rule, in the deletion impact too) and
  **`ofProposed`**: the rule tier may re-assert a proposal on a relation already proposed, so the
  „Vorschau“ line does not treat the calls as a subset of `callsProposed`: „… nimmt 1 davon und 2
  bereits vorgeschlagene gleich an“, a line of its own without calls proposed anew („1 bereits
  vorgeschlagener Aufruf – deine Regel „…“ nimmt ihn gleich an“), and „– nach dem Import gesammelt
  annehmen“ dropped only when the rules take every call proposed anew.
- **Neutral texts** where a derived call made „Agentenvorschlag“ wrong: the page lead, the revoke
  dialog („Ist noch ein Vorschlag offen …“), its summary („(ein Vorschlag ist noch offen)“) and
  the provenance („kein Vorschlag war mehr offen …“); `auto-accept.spec.ts` follows.
- **The offer only where it helps.** None when a rule, on or off, already names the source (the
  CLI suggests `rules apply <id>` or `rules enable <id>` instead) and none when no source can be
  named (agent uploads); the CLI picks the source from the waiting calls' callers, not by counting
  files, and quotes it for the shell (a manifest's converter could plant `$(…)`); suggested names
  are cut to 100 characters; the suggested `rules add` has no `--enable`, so new rules start off
  as in the web.
- **„Konverter“** lists the most open calls first, says „Lädt …“ while the preview loads and
  „Konverter wählen …“ until one is chosen, and saving without one says why.
- **The e2e flow uses „Hochladen“** (the owner's web session, a human upload like the owner key)
  instead of the owner-key CLI, since the e2e harness has no owner key file, and a "re-import" is
  a fresh project, since unchanged bytes record no new proposal.

Tests: server unit `auto-accept-evaluate.test.ts`, `auto-accept-preview.test.ts`,
`auto-accept-rules.test.ts`, `recompute-trust.test.ts` (the dry run's mirror); real PostgreSQL
`derived-call-rules.test.ts` (new, 14 tests: the owner-only dry run and the property, the
acceptance in the import's write, the narrowing, `agent-upload` for agent rules too,
`amendment-conflict`, an existing agent rule accepting nothing, `proposedBy` fixed, non-retroactive
with apply, revocation without requeue and never again, an agent token's write accepting nothing
while a person's callee rename does, the deletion, identical events without rules),
`migration-rule-tier.test.ts` (new: 0018 on existing rules, 14 rows refused by the check's name),
`auto-accept.test.ts` (the requeue when the agent's proposal is gone); web `rules-tab`,
`auto-accept-lib`, `bulk-accept-dialog`, `lib`, `review-lib`, `auto-accept-marks`, the bundle
guard; CLI `rules`, `import`, `models`, `manifest`; Playwright `derived-call-rules.spec.ts` (new: the
toast's offer and its prefilled dialog; „Hochladen“ with the rule on, the call accepted and marked,
revoked back to a proposal; an agent token's import blocked by `agent-upload`), `trust-calls.spec.ts`
(the toast per case), `auto-accept.spec.ts`.

What it costs and leaves open. Live-run neutral: no project, seed or live-run project has a rule,
so the eval reports, MCP snapshots, procedures and recordings are unchanged, and agents never see
rule data. The bundle entry is 226.0 KB gzip (+0.9); „Annahmeregeln“ measures 82 words (80) from
the new page lead; every other screen is unchanged. The readings the implementing agent took
that the owner may overrule are in HANDOFF §4 ("Taken during M6 S2c-3"). Open:

- **The amendment effect's dry run does not predict a rule's acceptance.** Withdrawing a
  call-target amendment can bring the rule tier's proposal back, and an owner's enabled rule for
  that source accepts it in the same write; the effect's dry run does not say so.
- **The callee side.** Only the caller's class counts (decision 24.2, a reading of the S2c plan):
  a call whose callee an agent token uploaded is not blocked, so a person's later write that
  proposes it again, or apply, may accept a call to a process version only an agent uploaded (the
  agent's own write sets no rule off); the exposure decision 9 already has.
- **The replay's approximation**: the preview and apply read the caller's declared source from its
  current head, not from the revision the proposal was made under.

Left: S2c-4 („Vor der Vertrauensregel angenommen“; delivered the same day, below), the skill's
key-map rebuild, a pre-approved `--dry-run` (since decision 29 (2) a read-only script) and
`normalize-bpmn` writing `null` for an empty `exporterVersion` (all three delivered with plugin
0.1.3, "S2b follow-up step 4 as delivered" below).

**S2c-4 as delivered** (2026-10-20, on the branch, every gate green, with a review round's fixes;
[DEVELOPMENT.md](DEVELOPMENT.md) "M6 S2c-4 (2026-10-20)" and "The trust rule (M6 S2c-1)").
„Vor der Vertrauensregel angenommen“, decisions 24.2 (a) and 28 (3): the owner reviews, once per
uploaded revision, the unique calls the rule tier accepted from revisions stored before S2c whose
revision would be derived today. With it S2c is complete. For the first analysis: a landscape
imported before the trust rule catches up without a re-import, one list and one decision per
model; „Zurück in die Prüfung“ sends the calls straight to „Gesammelt annehmen“ (or an enabled
rule for that source accepts them again in the same write), and „Behalten“ ends the question for
good. Contracts first (client regenerated), migrations 0019/0020, two owner-only routes, MCP
unchanged.

- **Storage.** `revision_trust_review` (0019, generated): `project_id`, `revision_id` (the uploaded
  revision), `model_id`, `class` (`modelled` | `derived`, checked), `principal_id`, `client_id`,
  `source_kind` (`human` only, checked), `seq` (the event's), `created_at`; primary key
  `(project_id, revision_id)`, one review per revision; foreign key `(project_id, model_id,
  revision_id)` → `model_revision`. 0020 (hand-written): the append-only and no-truncate triggers
  and the `BEFORE INSERT` guard `analyzr_trust_review_guard`, which refuses a revision carrying
  `source.trust` or an amended one, whoever writes.
- **Reading.** `storedTrust` in `trust.ts`: `source.trust`, else the review (`derived` with the
  reasons `legacyTrust` computes from what the revision carries, or `modelled`), else `null`; a
  review never overrides a stored class. `headTrustRows` LEFT JOINs the review of the uploaded
  revision (an amended head's upstream), and `modelTrust`, `Model.trust` and the class unchanged
  bytes keep (`ImportFileOutcome.trust`, `trust-kept`) all read it. So a revision reviewed
  `derived` with the reason `agent-upload` gets S2c-3's safeguard `agent-upload` like a classified
  one: no rule accepts its calls again, and they wait for „Gesammelt annehmen“.
- **The list** (pure `preTrustAcceptances`, by model, decision 28 (3)): an accepted call with both
  endpoints present that rests on the rule tier's decision alone (no human decision, no owner
  rule's marked acceptance in force), whose caller's uploaded revision has no class and no review,
  whose element's call target was not set in analyzr (applied or `in-source`, 25.2), and whose
  revision would be derived from what it carries (engine null; an agent upload, or before S2a a
  service principal; a declared kind other than `export`). An amended head names its uploaded
  revision. Camunda projects a human imported, the demo and the live-run projects list nothing.
- **Routes** (owners only, `policy.require` with `admin`; editors, viewers, agent and read-only
  tokens get 403; no MCP). `GET /api/v1/projects/{project}/pre-trust-calls` (`PreTrustList`: per
  model the uploaded revision and `rev`, reasons, derived kind, converter, count and up to 100
  calls) and `POST …/pre-trust-calls/review?dryRun=` (`{verdict, revisionIds, expectedCount}` →
  `PreTrustReviewResult {dryRun, verdict, revisions, count, toProposed, autoAcceptedCalls}`). 422
  `unknown-revision`, `revision-classified` (classified or amended) and `expected-count-required`;
  409 with `count`: `not-listed` (dry run and write: reviewed, uploaded again, or nothing of it to
  review; the message says to list again) and `count-changed`. `expectedCount` counts the listed
  calls. The demo answers the GET with 403 (`apps/demo/src/check.ts`).
- **The write** (under the project lock): one event `revision.trust_reviewed {revisionIds, class,
  count}` and the review rows with its `seq`; for `derived` then `recomputeProject` (the calls
  turn into the rule tier's proposals, `key`, 0.9, with the rationale) and the fifth write path
  over the proposals it recorded, caused by the owner, so an enabled S2c-3 rule may accept them
  again in the same write; for `modelled` nothing else. No analysis is queued.
- **The dry run** writes nothing: `relationImpact` with the reviews in memory and the owner's rules
  as an import's dry run evaluates them; its new fourth parameter `ofProposed` (`'proposed'` |
  `'was-accepted'`) counts `autoAcceptedCalls.ofProposed` among `toProposed` for a review (among
  `callsProposed` for an import), so the dry run equals the write; the calls left for „Gesammelt
  annehmen“ are `toProposed − ofProposed`.
- **Web.** `AutoAcceptSystemRule.preTrust`; on the system rule card „ · N vor der
  Vertrauensregel angenommen – prüfen…“ (owners, not in the demo, N > 0). Its dialog (lazy, in the
  revoke dialog's pattern): a checkbox per model (all ticked) with name, count and reasons, the dry
  run in one line that follows the selection („3 Aufrufe gehen zurück in die Prüfung. Deine Regel
  „…“ nimmt 2 davon gleich wieder an.“), the note „„Behalten“ lässt sie angenommen; danach fragt
  analyzr bei diesen Modellen nicht mehr.“, „Behalten“ (outline) and „Zurück in die Prüfung“
  (primary); a 409 reloads the list („Die Liste hat sich geändert“); the toast offers „Gesammelt
  annehmen“ (`/review?bulk=calls`) while calls stay open; the focus returns to the line, else to
  „Neue Regel“ or „Erste Regel anlegen“.
- **CLI.** `analyzr rules pre-trust -p <key> [--model <key…>] [--revoke|--keep] [--dry-run] [--yes]
  [--json]` with the owner key only: without a verdict the list; with one the dry run, and `--yes`
  sends its count as `expectedCount`; a 409 is explained; after `--revoke` a `next:` line with the
  bulk link while calls are left; `--json` gives an empty `PreTrustReviewResult` when nothing is
  listed. `rules list`'s system line names `preTrust`.

Deviations from the plan (§4.2 of the S2c plan), with reasons:

- **A stricter foreign key**, `(project_id, model_id, revision_id)` as in 0015, which implies the
  planned `(project_id, revision_id)`; the primary key gives the uniqueness.
- **A guard trigger in 0020** besides the append-only triggers: the database itself refuses a
  review of a classified or amended revision, so no writer can overrule a class assigned since S2c.
- **The review is read beyond `headTrustRows`**: `Model.trust` and the class unchanged bytes keep
  read it too, otherwise „Herkunft“, the bulk toast's source, `ImportFileOutcome.trust` and
  `trust-kept` would contradict the rule tier.
- **Calls whose callee is gone are not listed**: the review cannot turn them into proposals now,
  and the list's count then equals the dry run's `toProposed`.
- **„Behalten“ skips the recompute**: `modelled` reads like no class for the rule tier and the
  auto-accept evaluator (everything the recompute reads); only `Model.trust` shows `modelled`.
- **`expectedCount` counts listed calls**, not revisions, and the dry run refuses a revision that
  is not listed (409 `not-listed`) as the write does (review fix).
- **No analysis is queued** after „Zurück in die Prüfung“: the calls go to the human bulk accept,
  and the models show `waiting_for_review` through their open items (once their analysis is
  done).
- **Small choices.** The result reuses `ImpactAutoAcceptedCalls`; the CLI also takes `--dry-run`,
  like apply and revoke; the dialog has no „Abbrechen“ (its X closes it), so it keeps one primary
  and one secondary; only „Zurück in die Prüfung“ runs a dry run, „Behalten“ sends the list's
  count; the dialog lists models, not calls (the CLI and the API show the calls); the rules
  principal is resolved before the policy check, as in ingest.

The review round (a server, safety and data lens and a web, CLI and UX lens) found eight minor
points, all fixed: the dry run answered zeros for a revision that is not listed while the write
refused it (a client following the message looped); `ofProposed` was counted over every new
proposal in the dry run but over the calls accepted before in the write; the dialog never said
that „Behalten“ is final; the toast and the CLI advised accepting „before the agent starts“,
though no analysis follows (now „Sie stehen in der Prüfung; nimm sie dort gesammelt an.“ and
`next: accept them in the web review („Gesammelt annehmen“):`); `--json` with a verdict printed
the list's shape when nothing was listed; the dry run of `--keep` spoke as if done; the dry-run
line and the CLI counted the calls a rule accepts again by `count` instead of `ofProposed`; four
web cases were untested (a failed dry run, another failure of the review, the focus after the
review, the toast's navigation).

Tests: server unit `trust.test.ts` (`legacyTrust`, `storedTrust`, every case of
`preTrustAcceptances`), `recompute-trust.test.ts` (`ofProposed` for a review and an import),
`auto-accept-rules.test.ts`; real PostgreSQL `trust-review.test.ts` (new, 11 tests, revisions from
before S2c made by stripping `source.trust` by SQL: the list and the count, an amended head, both
verdicts with the dry run equal to the write, an enabled rule accepting again, unchanged bytes,
every refusal, the database guard, the 403s, the append-only triggers),
`migration-trust-review.test.ts` (new, 3 tests: 0019/0020 on a database migrated to 0018 with
revisions), `demo-mode.test.ts`; web `pre-trust.test.tsx` (new, 9 tests), `rules-tab.test.tsx`
(the line, the dialog and the focus), the bundle guard; demo `check.test.ts`; CLI `rules.test.ts`
(7 new tests); Playwright `pre-trust.spec.ts` (new: against the server, a project imported now
lists nothing, its card has no line, its classified caller is refused and an agent token gets
403; in the browser, with the list and the review stubbed, the line, the dialog, the selection,
the note and the toast's way to the real bulk dialog). A revision from before the trust rule
cannot be made through the API (the server writes `source.trust` on every upload and no route
writes a revision's source), so the whole flow is covered by the Testcontainers tests.

What it costs and leaves open. Live-run neutral: the corpus, the seeds, the demo and the live-run
projects hold no acceptance from before the trust rule that would be derived, so the eval reports,
MCP snapshots, procedures and recordings are unchanged, and no measured project of the UI load
guard shows the card's line. The bundle entry is 226.1 KB gzip (+0.1); the dialog and its texts
load with the lazy rules page; dependency-cruiser counts 147 modules. The readings the implementing
agent took that the owner may overrule are in HANDOFF §4 ("Taken during M6 S2c-4"); no owner
question. Open:

- **A review is per uploaded revision.** Unchanged bytes keep the reviewed class; once a model is
  uploaded again with other bytes, its new revision carries the trust rule's class and the review
  no longer applies, so „Behalten“ is final only for the revision it names.
- **Owners' existing stacks.** A landscape imported there before S2c-1 without an engine or with
  an agent token (say, a Signavio bundle) shows the card's line after the update; nothing changes
  until the owner decides.
- **The callee side** stays as S2c-3 left it: only the caller's class counts.

Left: S2b's follow-up (judgements made non-current, tasks queued or cancelled, the placement task
due, placements changed or missing; the integrate plugin's next release with the key-map rebuild,
a pre-approved `--dry-run` and `normalize-bpmn` writing `null` for an empty `exporterVersion`;
its steps 1 to 5, the relations side, the placements, the surfaces, the size of the agents' next
run, the plugin 0.1.3 and the identity rows of decision 29 (1), delivered the same day, below; the
pre-approved `--dry-run` became a read-only script by decision 29 (2), plugin 0.1.3 in step 4);
then S3c and S6.

**S2b follow-up step 1 as delivered** (2026-10-20, on the branch, every gate green, with a review
round's fixes; [DEVELOPMENT.md](DEVELOPMENT.md) "M6 S2b follow-up step 1 (2026-10-20)" and
"Provenance and the import manifest (M6 S2a)"): the agent work in the dry runs, relations side
(§3.5 "Follow-up"). For the first analysis: the server now knows before an import how much agent
work it sets off (the relations tasks it queues, the pairs agents then judge), repeats (the pairs
judged again) or destroys (a claimed task it cancels, whose work is lost), so the consultant can
hold back a costly trivial change, wait for an agent or skip a re-import once the surfaces show it
(step 3); and the amendment form's number („Die Agenten beurteilen 3 mögliche Relationen neu,
sobald du den Agenten startest.“) no longer counts pairs the amendment itself settles. No user-visible text
changed in this step: the „Vorschau“, the CLI's lines and the plugin follow in steps 3 and 4;
`analyzr import --dry-run --json` and `models delete --json` carry the field. Contracts first (the
client regenerated); no route, no migration, MCP unchanged.

- **The contract.** `ImportImpact.relationsTasks` (`ImpactRelationsTasks`), required, REST only
  (the import's and PUT's dry runs and the deletion impact; no MCP output schema holds
  `ImportImpact`):
  - `queued` (`impactList(ModelKey)`, by key): the models whose relations task the write queues;
  - `cancelled` (`impactList(ImpactCancelledTask)`, the claimed ones first, then by key): the open
    tasks the write cancels, each `{modelKey, state: 'queued'|'claimed', claimedBy, assigned}`,
    for a claimed one the holder's handle (what `GET …/analyses` already shows at `read`) and the
    number of pairs its claim was assigned, both `null` while queued;
  - `claimed`: how many of them an agent holds (their work is lost), past the cap;
  - `pairs`: the typed pairs agents judge around the queued models after the write, each queued
    model's candidates of an assigned basis and its assigned relations then, without a current
    agent judgement or a settling decision then; an **upper bound** of what the queued tasks'
    claims are assigned, since judge each pair once may give a pair to another model's open task
    (while such a task waits it would judge the pair anyway);
  - `rejudged` (`impactList(ImpactRelation)`, by type, from and to): those of them whose current
    agent judgement the write makes non-current, judged again.

  A deletion cancels the model's open task and queues nothing (`pairs` 0, CONCEPT §3). Counted per
  request against the head, so a pair between models of two batches counts in both when both
  models are in the head; on a first import across batches it counts in neither (the first run's
  size needs the backlog's count, step 3b, delivered the same day: "S2b follow-up step 3b as
  delivered" below).
- **Planned as the write plans.** The new pure `apps/server/src/domain/queue-plan.ts` (`planQueue`,
  `needsDoneTask`) follows `queueAnalysis` branch for branch; `queueAnalysis` is now read, plan,
  write, with the same reads and the same event order (`recompute-golden` unchanged). The dry run
  plans each created or revised file with it; unchanged and failed files queue nothing.
- **Judgements.** Pure `currentPairs`, `judgementShift` and `pairsToJudge` in `judgements.ts`
  (`settles`, `isAssignedRelation` and `relationPair` take narrower `Pick` types). The judgements
  are the live pipeline proposals of the relations that are not obsolete (`linkJudgements`) and
  the live no-links touching the changing models; "before" is the head hashes, "after" the
  would-be ones (a deleted key dropped). A pair is judged again when a judgement was current before
  and none is after, so a revert that makes an older judgement current again loses nothing.
- **`importImpact` plans the recompute once.** `relationsAfter`, factored out of
  `autoAcceptedCalls` (which marks an owner's rule acceptances in the same map), gives the
  relations as the claims after the write read them; `plannedRelations` does the same for the
  amendment cost. `relationImpact` keeps its signature for the trust review and delegates.
- **Reads**, in the dry run's read-only snapshot (permission `read`, no lock, nothing written), only
  for files whose bytes are not already known: the open relations tasks (queued and claimed, with
  the holder's handle and the assignment), `headHashes`, the live no-links touching those models
  (the new `NoLinkFilter.touchingModelKeys`), and for each such file's model without an open task
  its latest done task. An unchanged re-import reads nothing more than before.
- **The prepared candidate index.** `indexCandidates` in `packages/relations` and an optional
  fourth parameter `prepared` of `generateCandidates` (it throws for an index of other facts)
  compute the landscape-wide part once (the index, the rule relations, the pairs they fix, the
  text forms); the port's new `AnalysisPort.candidateSource(projectFacts)` serves the dry run's
  focus models from it and is built only when a task is queued. The candidates are equal with and
  without it (tests on a synthetic landscape and on every model of `_sample` and `nordwind-handel`,
  the holdout left out); `eval:candidates` is unchanged.
- **One merge for the batches.** The zod-free `@analyzr/contracts/impact-merge` (`MAX_IMPACT_ITEMS`,
  re-exported by `api/models.ts`; `TRUST_REASON_ORDER`, which `TrustReason` now enumerates;
  `mergeImpacts`) replaces the CLI's and the web's own merges with byte-identical output; ESLint
  allows it in the web, and the bundle guard lists it in the entry next to `paths.ts`. For the
  relations tasks: `queued` concatenated and sorted by key; `cancelled` concatenated, claimed first
  and then by key, before the cap (a claimed task stays listed past the first batch's cap);
  `claimed` and `pairs` added up; `rejudged` deduplicated by item and sorted, its count lowered by
  the duplicates found among the items (past a cap an upper bound).
- **The amendment cost** (`costOf`; `AmendmentCost` unchanged; §4.8 c) counts against the relations
  as the write leaves them: the recompute over the would-be facts under the derived head's trust,
  for an owner the derived calls their rules accept, the partner proposals `settleLinks` accepts;
  `pairsToRejudge` is the pairs to judge for the one model whose judgement the new head makes
  non-current, `taskClaimed` comes from `planQueue` (only when the facts change), and the
  not-recordable branch answers `{factsChange: false, pairsToRejudge: 0, taskClaimed: false}`.
  `withdrawalDryRun` takes the actor.

Deviations from the plan, with reasons:

- **The done task is read for every changing file without an open task**, not only for
  layout-only ones: whether its facts change is known only after the extraction, outside the read
  snapshot (at most 50 small indexed queries).
- **`pairs` is an upper bound**, not the exact union of the claims, while other models' tasks
  wait: exact routing needs every waiting partner model's candidates, which in a re-import during
  a first analysis means seconds per batch, and would still not give "the work the import adds"
  (pairs with partners whose key sorts later only move from that partner's task to the queued
  one). `rejudged` is the reliable "judged again" number; the contract says so.
- **The prepared candidate index** (the plan's fallback above about 2 s per 50-file batch) came in
  with the review fixes: the first measurement added 1.7 s of CPU, about 2.2 s per batch with cold
  reads.
- **The amendment cost counts against the relations after the write**, not the stored ones: the
  stored ones counted the call a call-target amendment accepts and the partner pair a message-name
  amendment accepts.
- **The amendment test's "> 0 after the no-links"**: in that fixture the claim's candidates were
  only `compatible` pairs, and the assigned pairs went to the partners' queued tasks, so the count
  is 0 there; the test now also submits no-links on those pairs and checks
  `0 < pairsToRejudge ≤ skip.length`. The new integration tests finish the partners first for the same reason.
- **Small choices.** `ALL_TASKS` a local constant in `ingest.ts`; `costOf` reads
  `listLive({touchingModelKey})` with stale no-links (a revert makes them current again) and no
  done task (the cancellation never depends on it).

The review round (a correctness lens and a refactor-safety and contracts lens) found one major and
seven minor points, all fixed: (1) the amendment cost counted pairs the amendment itself settles (3
instead of 2 for a call target, 2 instead of 1 for a partner name; now counted after the write,
`amendment-cost.test.ts`); (2) `pairs` claimed to be exactly what the claims are assigned (reworded
as an upper bound in the contract, OpenAPI and `pairsToJudge`, a unit test pins it); (3) and (4)
the added dry-run time at or above the 2 s threshold, from both lenses (the prepared index); (5)
the merged lists broke their sort descriptions (sorted before the cap); (6) every batch read every
live no-link, also for an unchanged re-import (reads only for changing models,
`touchingModelKeys`); (7) the claimed-task case without a fact change was not tested end to end (a
withdrawal dry run in `amendment-cost.test.ts`); (8) `impact-merge.ts` had no zod-free source
check (`impact-merge.test.ts`).

Tests: server unit `queue-plan.test.ts` (new, 12 tests: one row per `queueAnalysis` branch, when
the done task is read, the cancelled task handed back), `judgement-shift.test.ts` (new, 9 tests:
`judgementShift` for a stale hash, pairs counted once, a link and a no-link on one pair, another
procedure, a deleted model, a revert; `pairsToJudge` without judged and settled pairs, equal to
`planClaim`'s union without partner tasks, the upper bound with an outside open task),
`import-impact.test.ts` (5 tests: the recompute planned once, the relations after the plan, the
pairs and those judged again, the cancelled tasks, a deletion), `recompute-trust.test.ts` (an
owner's rule acceptance settles the pair); real PostgreSQL `import-dry-run.test.ts` (4 tests, the
dry run equal to the write: queued `[B, A]`, B cancelled as claimed with the handle and its
assignment's length, nothing written; after the import the `analysis.queued` and
`analysis.cancelled` events as previewed and B's submit 409 `task-cancelled`; the claims'
assignments together equal to `pairs`, their part judged before equal to `rejudged`; a layout-only
re-import queuing nothing; PUT's dry run equal to the import's; the deletion impact naming the
claimed task and `DELETE` writing exactly that one `analysis.cancelled`), `amendment-cost.test.ts`
(new, 3 tests: a call target counted as the PUT dry run's `rejudged` and the next claim's part
judged before, without the accepted call; a partner name without the accepted partner pair; a
withdrawal dry run without a fact change while the task is claimed), `amendments.test.ts` (a
not-recordable dry run while claimed); contracts `impact-merge.test.ts` (new, 10 tests); relations
`candidates.test.ts` and `sample.test.ts` (the prepared index equal); CLI and web fixtures with
`relationsTasks`, the bundle guard.

What it costs and leaves open. On 16 renamed copies of `nordwind-handel` (496 models, 6,128 facts,
19,417 live no-links) with a 50-file batch of renamed labels, the dry run adds 0.67 s of CPU (1.7 s
before the prepared index; 0.63–0.64 s of it the 50 focus models' candidates), the whole REST dry
run takes 1.13–1.17 s against a real database, the no-link read 31–34 ms (5,503 of the batch's
models instead of all 19,417 in 94–97 ms), the task and head-hash reads 1–2 ms, and an unchanged
50-file re-import 234–258 ms; the pair counts are identical with and without the prepared index
(3,004 pairs, 2,889 judged again). Live-run neutral: claim inputs, `renderClaims`, MCP snapshots,
procedures, recordings and eval reports unchanged. The bundle entry is 226.3 KB gzip (+0.2, the
shared merge in the entry). The readings the implementing agent took that the owner may overrule
are in HANDOFF §4 ("Taken during the M6 S2b follow-up step 1"); no owner question. Open:

- **`pairs` overstates while other models' tasks wait** (above): during a first analysis a
  re-import's preview can name pairs the partners' queued tasks would judge anyway; the surfaces
  (step 3) must not present it as new work; the pairs judged again (`rejudged`) are the reliable
  part.
- **A non-owner's preview** counts a derived call an owner's rule would accept as a pair to judge
  (no rule data outside an owner's preview).
- **The amendment number can drop to 0** where agents judged only `compatible` pairs, the search
  space no claim assigns.

Left: step 2 (placements: `placementsChanged`, `placementTask`; delivered the same day, "S2b
follow-up step 2 as delivered" below), step 3 (the surfaces: the „Vorschau“'s cost line, the
claimed-task warning with a second click, the CLI's lines, the deletion listing; delivered the same
day, "S2b follow-up step 3 as delivered" below), optionally 3b (`ProjectSummary.pairsToJudge` in
„Als Nächstes“; delivered the same day, "S2b follow-up step 3b as delivered" below), step 4 (plugin
0.1.3: the key-map rebuild, `analyzr-read.mjs` by decision 29 (2), `exporterVersion`; delivered the
same day, "S2b follow-up step 4 as delivered" below), step 5 (the identity rows of decision 29 (1),
migrations 0021/0022; delivered the same day, "S2b follow-up step 5 as delivered" below); then S3c
and S6.

**S2b follow-up step 2 as delivered** (2026-10-20, on the branch, every gate green, with a review
round's fixes; [DEVELOPMENT.md](DEVELOPMENT.md) "M6 S2b follow-up step 2 (2026-10-20)" and
"Provenance and the import manifest (M6 S2a)"): the agent work in the dry runs, placements (§3.5
"Follow-up"). For the first analysis: before an import the server now knows whether the
placement agent must place processes (again) and how many, and which accepted placements lose or
change their process, so once the surfaces show it (step 3) the consultant sees what a re-export
sets off on the value chain before importing, and can hold back a trivial change that would send
judged processes back to the agent or wait while an agent places. No user-visible text changed in
this step: the „Vorschau“ lines, the CLI's lines and the deletion listing come in step 3;
`analyzr import --dry-run --json` and `models delete --json` carry the fields. Contracts first
(the client regenerated); no route, no migration, MCP unchanged.

- **The contract.** `ImportImpact` gains two optional fields, present only when the project has
  a live value chain (a project without one has neither), REST only (the import's and PUT's dry
  runs and the deletion impact; no MCP output schema holds `ImportImpact`):
  - `placementsChanged` (`impactList(ImpactPlacement)`, by process, then step, capped at 100):
    the accepted placements whose process the write turns `changed` or `missing`, each
    `{step, stepName, process, endpointState}`; `step` is the element id (`@outside` included),
    `stepName` its name in the chain's head (`null` for `@outside`);
  - `placementTask` (`ImpactPlacementTask {outcome, due, newlyDue, again}`): `outcome` is
    `queued` (no task was open and a process is due), `open` (a queued task waits; its claim
    shows the new head), `deferred` (an agent holds the task: it gets `requeue_after` and is never
    cancelled, its submission queues the follow-up), `nothing-due` or `not-triggered`; `due` the
    open processes due after the write, `newlyDue` those of them not due before, `again` those of
    `newlyDue` an agent had judged (placed again).
- **Triggered as the write decides it.** Only a created or revised file with other facts triggers
  the task (`afterHeadChange`); a layout-only upload, an unchanged import and a deletion never
  queue it (M4 §3.2), so the deletion impact is always `not-triggered`, but still reports `due`,
  `newlyDue` and `again` (those processes wait for the next trigger or a requeue). The outcome
  follows `queuePlacementTask`: a queued task gives `open`, one an agent holds `deferred`, else
  `queued` when an open process is due, else `nothing-due`.
- **Due-ness from the pipeline's own input hashes.** `loadPipelineInputs` (`value-chain/queue.ts`)
  is now the same reads in the same order, then the new pure `pipelineInputs` (`byProcess`,
  `hashContext`, `hashOf`, `open`, `due`), which the write and claim paths and the dry runs share
  (`claim-golden` unchanged); `factsByProcess` and `processOwnFields` (`unplaced.ts`) take
  fact-shaped input (types only). The new pure `value-chain/model-impact.ts` (`ChainRead`,
  `ChainSide`, `headFactOrder`, `placementImpact`) runs it over the head and over the would-be
  head: its facts, the relations the write leaves (`importImpact` computes the relations part
  first, so an owner's rule acceptances are in them and a newly accepted call makes both ends
  due), the placements and histories after the rule tier (below) and the agent's verdicts as
  stored (`placement_input`). `again` is "newly due and open before": an agent's verdict, or the
  held claim, matched the process's input then.
- **The rule tier, planned.** Every head change runs the chain's sync, whose rule tier proposes
  and withdraws over the would-be head processes. The new pure `planRulePlacements`
  (`value-chain/rules.ts`) plans those writes; `recomputeRulePlacements` now reads, plans, then
  writes with the same queries and event order (`value-chain-golden` unchanged). Whenever the
  write changes a head (a created or revised file, a layout-only one included, or a deletion) the
  dry run appends the planned rule assertions to the histories with seqs after every stored one,
  so a process the rule tier records on gets a new input hash, as in the write; an unchanged
  import plans nothing. The rules principal is taken from the histories (a dry run never creates
  it).
- **The held claim.** While an agent holds the task, the processes its claim shows count as judged
  on the input the claim showed (its submission records those verdicts): in the `deferred` case
  `due` is what the follow-up then offers, and a process the import changes under the claim
  counts as newly due and placed again.
- **The placements.** `placementsChanged` comes from `derivedPlacementState` over the history after
  the rule tier, as `refreshPlacement` computes it; an accepted placement keeps its decision's
  anchor (`recomputeStatusOf`), so the list equals the write's `placement.endpoint_changed` events
  that turn an accepted placement `changed` or `missing`. Held and obsolete placements,
  placements on removed steps and a placement turning back to `ok` (a revert, a revival; the
  write records that event too) are not named, as `endpointsChanged` names accepted relations
  only.
- **One fact order.** The extractor lists a model's fact kinds in the enum's order, `facts.head` in
  code point order, and a process's first start and end labels (`processOwnFields`) follow the
  order, so a process with message and plain start events would hash differently in the dry run
  than in the write. The new pure `domain/fact-order.ts` (`compareStoredFacts`) is the one
  comparator that `store.ts` (`facts.head`, a revision's facts) and `headFactOrder` share; the
  stored order is unchanged.
- **Reads** (`readChain` in `ingest.ts`, inside the dry run's read-only snapshot; permission
  `read`, no lock, nothing written): one query without a live chain (the fields are then left
  out); else the head's structure (cached by content hash), the live step generations, the
  placements with their histories, the agent's verdicts, the open placement task and, while an
  agent holds it, the input hashes its claim showed (one more query). `importImpact` takes the
  chain as an optional seventh parameter. The chain is read for an unchanged batch too, so the
  fields are always present with a chain.
- **The merge** (`mergePlacements` in the zod-free `@analyzr/contracts/impact-merge`): the fields
  only when some batch has them; `placementsChanged`' counts added up, its items concatenated,
  sorted again and capped (a process belongs to one batch, so the count is exact); `placementTask`
  the strongest outcome (`deferred` > `open` > `queued` > `nothing-due` > `not-triggered`, a typed
  `Record` of all five), `due` the largest batch's count, `newlyDue` and `again` added up. All three
  counts are approximate across batches: each batch counts against the head, so another batch's
  revert or removed process is not seen, and a process two batches make due counts in both.

Deviations from the plan, with reasons:

- **The dry run plans the rule tier** (above). The plan's invariant (the rule tier records on a
  process only where it is new or its own fields change, so the dry run need not simulate it) did
  not hold: a proposal a human decision suppressed at the last run is recorded once that decision
  is gone. The review's case: a placement auto-accepted, then a step link added to its step (the
  rule tier derives the placement, the auto-acceptance suppresses it), then the auto-acceptance
  revoked; the next head change records the rule proposal on a process whose own fields did not
  change, so the write made it due and the dry run did not. The plan's fallback,
  `planRulePlacements`, is now built.
- **The shared fact order** (above), an addition: without it the dry run's due-ness differed from
  the write's for a process with start or end events of mixed kinds.
- **`pipelineInputs` also returns `byProcess`** (its callers need it, computed once); it is generic
  over the fact type and takes a structural chain state.
- **`placementsChanged` over the history** (`derivedPlacementState`, as `refreshPlacement`), sorted
  by process, then step (the plan left the order open).
- **The held claim counts** (above): as planned, a claimed process was due before and after, so a
  process the import changed under the claim showed neither as newly due nor as placed again,
  although its follow-up judges it again.
- **The chain is read for an unchanged batch too** (about 20–30 ms): the fields are always present
  with a chain.

The review round (a correctness lens, dry run equals write, and a refactor-safety and contracts
lens) found one major and five minor points and a nit, all fixed: (1) major, the write could queue
a placement task the dry run did not predict (the revoked auto-acceptance above; now the rule-tier
plan, a dry-run-equals-write test of that case and three unit tests, two of which fail without the
plan); (2) the merged `due` was called a lower bound (now "approximate, the largest batch's
count"); (3) the fact order existed twice, its tests pinned it only against itself (now one
comparator, and an integration test that `facts.head` keeps it on `nordwind-handel`, which has a
process with message and plain start events); (4) a re-placement under a held claim was not
counted (the held-claim rule; the lease test now expects `{deferred, 1, 1, 1}`, equal to the
follow-up's queued `due`); (5) the deletion's due-ness was never checked against the write (a
deletion of a model a step links to: `{not-triggered, 2, 2, 2}`, then no task queued and the chain
due 2); (6) no multi-file import dry run on a chain project (one layout-only file and one rename:
`queued` with due 1, as the import's `analysis.queued`); (7) nit, an untyped outcome order (a
typed `Record` of all five outcomes, which the type checker keeps complete).

Tests: server unit `test/unit/placement-impact.test.ts` (new, 21 tests: an accepted placement named
`changed` on a rename and `missing` when its process or its whole model leaves the head, none on a
removed step, no held one, `@outside` without a step name, nothing when the process comes back or
nothing changes, the sort; nothing due on an unchanged head; due-ness of a new process, of an
own-field change but not its sibling, of both ends of a newly accepted call, of every open process
when a step link resolves, a process due before not newly due, more than five start events of mixed
kinds keeping their digest; the outcome matrix with `not-triggered`; the rule tier's proposal a
revoked auto-acceptance no longer suppresses, nothing where its proposal is live or a human decided,
a proposal on a new spot and a withdrawal each a new non-agent seq; the held claim's processes
judged on the claim's input, and without its hashes; `headFactOrder`), `recompute-trust.test.ts` (a
derived call an owner's rule accepts makes both ends due, `{queued, 2, 2, 2}`; without the rules
nothing is due); real PostgreSQL `value-chain-ingest.test.ts` (before each write, a rename and back,
a deletion and revival, a rule proposal withdrawn and back, an unchanged re-import and a layout-only
re-save, the dry run's `placementsChanged` equals the following `endpoint_changed` events that turn
an accepted placement `changed` or `missing`, and `lastSeq` is unchanged; the head's fact order on
`nordwind-handel`), `placement-pipeline.test.ts` (the triggers: layout-only `not-triggered`, a new
model `queued` with the `analysis.queued` payload's `due`, a deletion `not-triggered` with no event;
an own-field change `{queued, 1, 1, 1}`, a task label `nothing-due`; an import during the lease
`deferred`, then `requeue_after` set and the follow-up offering the changed process; the rule tier
proposing and withdrawing on a rename, dry run equal to write; an accepted placement the rule tier
re-proposes named changed; a newly accepted call making both ends due; the revoked auto-acceptance;
the deletion of a model a step links to; a batch with a layout-only file and a rename),
`import-dry-run.test.ts` (no chain, no placement fields, in the import's dry run and the deletion
impact); contracts `impact-merge.test.ts` (2 new tests: absent, added up, sorted again and capped;
the outcome precedence, the largest `due` and the sums); the bundle guard's comment.

One web fix the e2e run found (older than step 2: the spec failed the same way on a stack built
from step 1's commit): an owner who clicked „Agent starten“ on the chain's line before their agent
tokens had loaded got the toast „Eingeplant“ and no popover, since `RetryAgent` decided by the
agent state of the click's render. It now opens the popover for every owner, once the tokens are
known, and shows the toast only while they are not known when the requeue answers
(`agent-start.test.tsx`, two tests that fail on the old code; the entry stays 226.6 KB).

What it costs and leaves open. On 16 renamed copies of `nordwind-handel` (496 models, 6,128 facts,
the golden chain, 512 processes judged over 31 claims, 64 rule proposals accepted) with a 50-file
batch, on the final tree and a quiet machine: the chain reads take 6.4–10.5 ms and
`placementImpact` 9.5–10.7 ms (about 3 ms of it planning the rule tier), so a 50-file dry run
gains about 20 ms (25–30 ms on the busier machine of the review round); the REST medians of 7
runs, without a chain → with it: an unchanged batch 320 → 327 ms, renamed processes 1,242 → 1,244
ms, changed end labels 1,159 → 1,193 ms (within the runs' spread). Live-run neutral: claim
inputs, `renderClaims`, MCP snapshots, procedures, recordings and eval reports unchanged
(`claim-golden`, `recompute-golden` and `value-chain-golden` green unchanged). The bundle entry is
226.6 KB gzip (+0.3, the merge of the chain's part). The readings the implementing agent took that
the owner may overrule are in HANDOFF §4 ("Taken during the M6 S2b follow-up step 2"); no owner
question. Open:

- **A non-owner's preview** leaves out the neighbours of calls an owner's rules for derived calls
  would accept (no rule data outside an owner's preview), so its `due` can be too low.
- **Across batches** the placement task's counts are approximate (above), as the pairs are; step
  3's cost line starts with „etwa“ for more than one batch (delivered the same day, "S2b follow-up
  step 3 as delivered" below).
- **`readChain` takes the first live chain with a head** (M4 has only `main`).

Left: step 3 (the surfaces, as planned in §3.5 "Follow-up": the „Vorschau“'s cost line, whose
placement part „N Prozesse zu platzieren (… davon erneut)“ with the held-claim rule also appears for
a deferred task, the placements line and list, the claimed-task warning with a second click, the
CLI's lines, the deletion listing; delivered the same day, "S2b follow-up step 3 as delivered"
below), optionally 3b (`ProjectSummary.pairsToJudge` in „Als Nächstes“; delivered the same day, "S2b
follow-up step 3b as delivered" below), step 4 (plugin 0.1.3: the key-map rebuild,
`analyzr-read.mjs` by decision 29 (2), `exporterVersion`; delivered the same day, "S2b follow-up
step 4 as delivered" below), step 5 (the identity rows of decision 29 (1), migrations 0021/0022;
delivered the same day, "S2b follow-up step 5 as delivered" below); then S3c and S6.

**S2b follow-up step 3 as delivered** (2026-10-20, on the branch, every gate green, with a review
round's fixes; [DEVELOPMENT.md](DEVELOPMENT.md) "M6 S2b follow-up step 3 (2026-10-20)",
[UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §6 and §7 "M6 S2b follow-up step 3's texts as
delivered"): the agent work of a dry run on the surfaces (§3.5 "Follow-up"), that is the web's
„Vorschau“, the lines of `analyzr import --dry-run` and the listing of `analyzr models delete`. For
the first analysis: before „Importieren“ the consultant sees how much agent work an import sets
off (pairs to judge, processes to place), which agent work it repeats („davon erneut“) and whether
it destroys an agent's running work (the warning and a second click), so imports can be timed and
batched without losing agent runs; on a first import the line shows the agent work it sets off.
Web and CLI only: no route, no migration, no contract change (only comments in
`packages/contracts/src/impact-merge.ts`), the client not regenerated; MCP, the procedures, the
plugin and the recordings are untouched.

- **The cost line** (the new `apps/web/src/lib/agent-cost.ts`, in the entry; `impactLines(impact,
  batches)` in `lib/upload.ts`) always takes the last of the „Vorschau“'s three lines, on a first
  import too; an unchanged re-import has none, so „Danach: keine Änderung an Relationen und
  Befunden.“ stays. The relations part only when `pairs` is above 0: „214 mögliche Relationen zu
  beurteilen“ („1 mögliche Relation zu beurteilen“), then „(56 davon erneut)“ when `rejudged` is
  above 0. The placement part (`processesToPlace`) when the write triggers the chain's placement
  task and it has processes to place: a task the write queues (`queued`) places every process due
  (`max(due, newlyDue)`, since across batches `due` is the largest batch's count and `newlyDue`
  their sum), one waiting (`open`) or held by an agent (`deferred`, its follow-up) the newly due
  ones: „7 Prozesse zu platzieren“ („1 Prozess zu platzieren“), then „(5 davon erneut)“ when
  `again` is above 0. The parts are joined by „, “, with „etwa “ in front for more than one batch
  („etwa 7.300 mögliche Relationen zu beurteilen“). For example: „Danach: 3 Aufrufe automatisch
  verknüpft · 2 angenommene Relationen mit geändertem oder fehlendem Endpunkt · 214 mögliche
  Relationen zu beurteilen (56 davon erneut), 7 Prozesse zu platzieren“. No text calls `pairs` new
  or exact (an upper bound while other models' tasks wait, step 1); the pairs judged again are the
  reliable part. Every count of the impact lines is now formatted the German way („1.234 Aufrufe
  automatisch verknüpft“).
- **The placements line**, ranked right after the endpoints line: „1 angenommene Platzierung mit
  geändertem oder fehlendem Prozess“ („2 angenommene Platzierungen …“). The cost line can push it,
  or the endpoints line, into „Was ändert sich?“ (the order UX-SIMPLIFICATION.md §6 planned, the
  agent work in the last of the three lines; HANDOFF §4 (b)).
- **„Was ändert sich?“** gains two lists: „Angenommene Platzierungen mit geändertem oder fehlendem
  Prozess (n)“ after the endpoints list, its items „lager/versand#Process_1 → „Versand“ (fehlt)“,
  „a#P → Außerhalb der Kette (geändert)“ for `@outside` and a step without a name by its element
  id; and last „Mögliche Relationen, die erneut beurteilt werden (n)“, its items the relation
  type's label, from and to („Nachricht a#Send → b#Catch“). There is no list of all pairs to judge
  and none of the processes to place (the impact carries counts only), and the relations tasks
  queued are not listed; so the disclosure now shows only when some list has items.
- **The warning** (`preview-claimed`, a destructive alert above the buttons, as in the amend form)
  while the import cancels relations tasks an agent holds (`relationsTasks.claimed` above 0; their
  work is lost). One: „Ein Agent bearbeitet „vertrieb/auftrag“ gerade; seine Arbeit geht verloren.“
  with „Der Import bricht seine Analyse ab; sie wird danach neu eingeplant.“ Several: „Agenten
  bearbeiten gerade 5 dieser Modelle; ihre Arbeit geht verloren.“ with „„a“, „b“, „c“ und 2
  weitere. Der Import bricht ihre Analysen ab; sie werden danach neu eingeplant.“ (two: „„a“ und
  „b“. …“; three: „„a“, „b“ und „c“. …“). No handle, no lease. A placement task an agent holds keeps
  its work and gets no warning. While the warning shows, the fallback „Danach: keine Änderung an
  Relationen und Befunden.“ is hidden.
- **The second click** (`useSecondClick`, which the amend form's `useClaimedConfirm` now shares):
  only while the warning shows, the first click on „Importieren“ sends nothing and turns it into
  „Trotzdem importieren“ (the destructive variant, described by the warning through
  `aria-describedby`); the second click imports. „Abbrechen“ closes the preview as before, which
  disarms, and a new preview disarms. A double click arms only (`repeated`: while a second click is
  needed, a click with `detail` above 1 sends nothing and its default is prevented; a keyboard's
  click, `detail` 0, still confirms), in all three places that ask a second time: the „Vorschau“,
  the amend form's „Speichern“ and the action panel's submit.
- **The batch note** (`batchNoteText`): „Vorschau je 50 Dateien; Aufrufe zwischen den Teilen
  erscheinen hier als unaufgelöst.“, and when new models lie in two or more batches „Vorschau je 50
  Dateien; Aufrufe zwischen den Teilen erscheinen hier als unaufgelöst, mögliche Relationen zwischen
  neuen Modellen verschiedener Teile fehlen in der Zahl.“ (the „etwa“ rule, §3.5 "Follow-up", step
  3).
- **`analyzr import --dry-run`** (`formatImpact`), right after `change the facts of …`:
  - `  agent work: queue 3 relations tasks, 214 pairs to judge (56 judged again); placement task:
    queued, 9 processes to place (1 again)`; with nothing to do `  agent work: none`; without a
    relations task `  agent work: no relations task; placement task: nothing due`; a waiting task
    `placement task: already queued, 1 process to place, 9 due in all`; a held one `placement task:
    an agent holds it; 2 processes to place in its follow-up (1 again), 3 due in all` or `… nothing
    new to place in its follow-up`; "N due in all" only for those two; across batches `about 214
    pairs`, `about 7 processes to place`, `about 9 due in all`. The relations part names the queued
    tasks also with `0 pairs to judge`.
  - `  cancel relations tasks: 2 (vertrieb/auftrag claimed by agent:claude, 34 pairs assigned;
    finanzen/rechnung queued)`, then for a claimed task `  warning: an agent is working on the
    relations task of vertrieb/auftrag right now; the import cancels the task and the agent's work
    is lost`, for several `  warning: agents are working on the relations tasks of 7 of these models
    right now (a, b, c, d, e, … 2 more); the import cancels them and their work is lost`.
  - After the endpoints line: `  change or lose the process of accepted placements: 2:
    lager/versand#Process_1 on "Versand" (missing), lager/zoll#Process_2 on @outside (changed)`
    (`@outside` and a step without a name by the step id).
  - The batch line: `  previewed in 2 batches, each against the project's head: a call into a later
    batch shows as unresolved, and the pairs between new models of different batches are not
    counted`.
  - `--json` is unchanged: it has carried the fields since steps 1 and 2 (the e2e test now checks
    `relationsTasks` in it).
- **`analyzr models delete`** (`deletionImpactText`): each model's line adds, only when non-zero,
  `relations task cancelled` or `relations task cancelled while an agent works on it (its work is
  lost)`, `2 accepted placements lose their process (missing)` (`1 accepted placement loses its
  process (missing)`) and `3 processes become due for placement` (`1 process becomes due …`); once
  after the listing, when a deletion makes processes due: `Deleting queues no placement task;
  afterwards analyzr value-chain requeue -p <project> queues it unless one waits.` The stale module
  comment ("comes with M6 S2") is replaced.

Deviations from the plan, with reasons:

- **The processes to place** (the plan named no number): `newlyDue` for a waiting or held task
  (the waiting task covers the rest anyway), every process due for a task the write queues (from the
  review: after a deletion, which queues no task, the next import queues one for processes due
  before). `again` stays a part of the number, so „davon erneut“ holds.
- **The held task's CLI wording carries counts** (`… to place in its follow-up (1 again)`), not the
  plan's text without numbers.
- **The relations part only when `pairs` is above 0**; the CLI still names the queued tasks.
- **„Abbrechen“ closes the preview** as before, which disarms; no separate "disarm but keep" state,
  as in the amend form.
- **The several-model warning names at most three models**, then „und N weitere“ (the plan's
  example mixed counts).
- **The deletion's requeue hint** comes once after the listing and names the project, not per model
  (from the review).
- **Shared with the amend form:** `useSecondClick`, `possibleRelationsText` and `CLAIMED_WARNING`
  (in `lib/agent-cost.ts`: `CLAIMED_WARNING` moved there and re-exported by the lazy
  `lib/amendments.ts`, whose `useClaimedConfirm` and `rejudgeText` now use `useSecondClick` and
  `possibleRelationsText`).
- **The UI load step „Vorschau (erneuter Import)“** was first left out (the claim scenario is in
  `upload-preview.spec.ts`) and came with the review round, as the step's plan asked.

The review round (a surface-correctness lens and a UX-and-regression lens) found 14 points, one
major; 12 are fixed with tests and 2 rejected. Fixed: (1) major, from both lenses: on a first
import previewed in several batches „etwa“ / "about" hid a large undercount, since the pairs
between new models of different batches count in no batch (the batch notes now say so; the
comments in `agent-cost.ts`, `impact-merge.ts` and the CLI's `agentWorkLine` corrected; „etwa“
stays, HANDOFF §4 (c)); (2) from both: „Was ändert sich?“ opened onto nothing when the cost line
was the only line (the disclosure only with items; this also covers a line that only says what the
rules accept); (3) from both: a placement task the import queues for processes due before showed
no placement part, and the web and the CLI disagreed (`processesToPlace`, HANDOFF §4 (a)); (4) a
double click went past the warning (`repeated`, in all three places); (5) from both: one sentence
mixed „1234“ and „1.234“ (German numbers throughout); (6) the heaviest „Vorschau“ was never measured
(the UI load step); (7) the fallback contradicted the warning (hidden beside it); (8) the requeue
hint repeated on every model's line (once). Rejected: the cost line pushing the endpoints line into
the list (the order UX-SIMPLIFICATION.md §6 planned, the agent work in the last of the three lines,
kept: HANDOFF §4 (b)); a screen-reader live region when the button arms (not a regression, the amend
form has none either; it would go into all three second-click places, left open for the owner:
HANDOFF §4 (g) and §8).

Tests: web `lib.test.ts` (the third slot, the singular forms, German numbers, „etwa“, the placement
part per outcome with the queued task's count, the placements line's rank, both lists' items, the
warning for one and for several, the batch note), `upload-panel.test.tsx` (the cost line with a
deferred placement task, both lists, both warning texts without a handle; the first click sends
nothing, a double click arms only, „Abbrechen“ and a new preview each disarm, the second click
imports; the disclosure only with a list, no fallback beside the warning), `amendments.test.tsx` (a
double click on the action panel's submit arms only), `bundle.test.ts` (`lib/agent-cost.ts` in the
entry, `amendments.ts` lazy); CLI `import.test.ts` (the relations part, every placement outcome,
"about", the cancelled and claimed warnings in singular and plural past the cap, the placements
line, the merge), `manifest.test.ts` (the pinned block gains `  agent work: none` and the batch
line's clause on the pairs), `models.test.ts` (the listing with a claimed task, placements and the
hint once; the singular forms), `cli.e2e.test.ts` (`import --dry-run` in text and `--json`, the
deletion listing's `relations task cancelled`); Playwright `upload-preview.spec.ts` (new: on a
project of its own from `_sample` an agent puts no-links on one model's pairs and keeps another
model's claim; a re-export of both through „Hochladen“ shows the cost line with „davon erneut“, the
list of the pairs judged again and the exact warning; a double click turns „Importieren“ into
„Trotzdem importieren“ and the heads stay unchanged over REST, „Abbrechen“ disarms and a new preview
asks again, the second click imports, and the holder's submit gets 409 `task-cancelled`),
`smoke.spec.ts` (a first bundle import names the agent work in its last line and shows no warning),
`ui-load.spec.ts` (the new step).

What it costs and leaves open. Every gate green on the final tree (server 1,775, web 653, CLI 275
plus 7 skipped, contracts 177, bpmn-facts 200, integrate 145, eval/tools 108, relations 88,
agent-sim 57, procedures 37, demo 27, notices 9, client 4; dependency-cruiser 150 modules, no
violations; the eval reports unchanged). Live-run neutral: claim inputs, MCP snapshots, procedures,
the plugin and recordings unchanged. The bundle entry is 227.6 KB gzip (+1.0 over step 2's 226.6,
ceiling 240; `lib/agent-cost.ts` in the entry, `amendments.ts` still lazy). The UI load guard: UX7's
„Vorschau“ (a first import of the raw Signavio export) 20 controls, 133 words and 6 badges (128
words before; the 5 more are „· 7 mögliche Relationen zu beurteilen“); the new step „Vorschau
(erneuter Import)“ on the worked `nordwind-handel` (`finanzen/rechnungsstellung` re-exported, a dry
run only) 16 controls, 95 words and 1 badge at 1440 px, 16 controls, 93 words and 1 badge at 390
px, no horizontal scroll; no budget constant changed. The e2e run on the final tree: the full Playwright suite 111 passed and 21 skipped, the demo
check 152 of 152, `demo.spec.ts` 14 of 14 (before it, the implementing
agent's full Playwright run on its scratch stack had 110 passed and 21 skipped; the review round's
runs `smoke.spec.ts` 5 of 5 and `upload-preview.spec.ts` with `ui-load.spec.ts` 31 of 31). The
readings the owner may overrule are in HANDOFF §4 ("Taken during the M6 S2b follow-up step 3"); one
open UX point for the owner (HANDOFF §8). Open:

- **No list of the pairs to judge and none of the processes to place**: the impact carries counts
  only; the pairs judged again are listed.
- **The number across batches**: `pairs` stays an upper bound while other models' tasks wait, and
  across batches it is no bound either way; on a first import in parts it falls far short (the
  batch notes say so). Step 3b's backlog count is the full fix (delivered the same day, "S2b
  follow-up step 3b as delivered" below: after the import „Als Nächstes“, the CLI's waiting line
  and `analyzr status` give the whole number).
- **The deletion's requeue hint** shows also when a placement task already waits (a deletion's
  impact is always `not-triggered`, so it cannot tell); `requeue` then answers that one waits.
- **Arming is not announced to a screen reader**: the warning is announced when the preview renders
  and the button points to it, but its new name is not reliably read out (as in the amend form).

Left: optionally 3b (`ProjectSummary.pairsToJudge` in „Als Nächstes“ and the CLI's waiting line, the
first run's size that a preview in batches cannot give; delivered the same day, "S2b follow-up step
3b as delivered" below), step 4 (plugin 0.1.3: the key-map rebuild, `analyzr-read.mjs` by decision
29 (2), `exporterVersion`; its report can reuse the web texts above, which it does; delivered the
same day, "S2b follow-up step 4 as delivered" below), step 5 (the identity rows of decision 29 (1),
migrations 0021/0022; delivered the same day, "S2b follow-up step 5 as delivered" below); then S3c
and S6.

**S2b follow-up step 3b as delivered** (2026-10-20, on the branch, every gate green, with a review
round's fixes; [DEVELOPMENT.md](DEVELOPMENT.md) "M6 S2b follow-up step 3b (2026-10-20)" and "The
agents' next run", [UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §2.3 and §7 "M6 S2b follow-up step
3b's texts as delivered"): the size of the agents' next run (§3.5 "Follow-up"), the one number a
dry run split into batches cannot give for a first import (a pair between new models of different
batches counts in no batch). For the first analysis: right after a first import in parts, and on
every „Übersicht“, the consultant sees how big the agents' run will be, so they can plan the agent
run and its cost. Contracts first, REST only; no migration, no new route; MCP and its snapshots,
the procedures, the claim inputs, the plugin and the recordings are untouched.

- **The field** `ProjectSummary.pairsToJudge` (`GET /projects/{p}/summary`, permission `read`;
  required, an integer from 0; the route's description names it; the client regenerated): over
  the stored head, the distinct typed pairs the next claims of the relations tasks an agent may
  claim now will be assigned. Those tasks are the ones `TaskRepo.claim` takes at the read's clock:
  the queued ones (the models „warten auf den Agenten“) and the claimed ones whose lease ran out
  with attempts left. Each pair once (one between two such models too), without the pairs with a
  current agent judgement (link or no-link) and those a decision settles (accepted, or rejected
  with unchanged endpoints), as the dry runs count them. A task whose lease runs adds nothing (its
  pairs are its claim's), and neither does a pair of its assignment whose other end is such a model
  its claim saw as it is now (rule 1 of the claim planning: that model's claim skips it); rules 2
  and 3 only decide which claim judges a pair, so the union is exact for the stored state when
  read. 0 when no such task waits.
- **How it is counted** (`countPairsToJudge` in `apps/server/src/domain/use-cases/projects.ts`,
  the pure `heldPairs` in `judgements.ts`): `pairsToJudge` over the claimable models, their own
  candidates, the relations and current judgements the open questions' read model already read,
  and as judged also the pairs live claims hold. The own candidates come from the read model's
  candidate pass: the new `projectCandidates` of `@analyzr/relations` (the port method
  `AnalysisPort.projectCandidates`) returns the whole-project candidates, identical to
  `generateCandidates` without a focus, and from the same pass per model what `generateCandidates`
  around it gives of a basis other than `compatible`; `CandidateCache` keeps both and
  `loadOpenQuestionInput` returns them (`LoadedOpenQuestionInput.ownCandidates`), so the summary
  makes no cache lookup of its own and generates no candidates. The new reads: the queued and the
  claimed relations tasks, and one revision query (`revisions.hashesAt`) per live claim whose
  assignment names a claimable model revised since that claim. Placement tasks judge no pairs.
- **The memo** (`SummaryMemo`, per project on `lastSeq`): the summary reads the clock, for the
  leases only; each entry keeps `validUntil`, the earliest lease of a claimed relations task that
  has not run out, and the summary is built again once it passes, without an event.
- **„Als Nächstes“ on „Übersicht“** (`lib/next-step.ts`, `components/next-step-block.tsx`,
  `pairsToJudgeText` in `lib/agent-cost.ts`; the summary's query in `routes/project-models.tsx`
  only while models wait): owners see the size beside „Agent starten“ or „Agent verbinden“ as
  muted plain text, no control and no „ · “, once their tokens are known: [Agent starten] „etwa
  7.300 mögliche Relationen“ (`next-step-pairs`). Editors and viewers get it in the waiting line:
  „5 Modelle warten auf den Agenten · etwa 7.300 mögliche Relationen“, „1 Modell wartet auf den
  Agenten · 1 mögliche Relation“. German numbers, exact; „etwa“ from 2 on, none for 1; nothing for
  0, and nothing while only failed analyses or expired reservations wait (no model waits).
- **„Hochladen“ after an import** (`waitingText(…, pairs)` in `lib/upload.ts`,
  `components/upload-panel.tsx`): the same suffix on the waiting text, „5 Modelle und die
  Platzierungen warten auf den Agenten · etwa 7.300 mögliche Relationen“, from a summary read
  after the import that succeeded (`isSuccess && isFetchedAfterMount`), so no number from before
  it and nothing when that read fails. The read is cheap there: the open questions' read after
  the import has already filled the shared candidate cache.
- **The batch notes** point to the whole number: „Vorschau je 50 Dateien; Aufrufe zwischen den
  Teilen erscheinen hier als unaufgelöst, mögliche Relationen zwischen neuen Modellen verschiedener
  Teile fehlen in der Zahl; die ganze Zahl steht nach dem Import unter „Als Nächstes“.“; the CLI's
  `  previewed in 2 batches, each against the project's head: a call into a later batch shows as
  unresolved, and the pairs between new models of different batches are not counted (after the
  import, the waiting line and analyzr status count them)`.
- **The CLI** (`pairsToJudge` and `pairsToJudgeText` in `apps/cli/src/commands/import.ts`,
  `status.ts`): `analyzr import`'s waiting line `demo: 250 relations tasks waiting, about 7300
  pairs to judge, placement task waiting: yes` (`1 pair to judge`), only when above 0, from `GET
  …/summary` (one request more while relations tasks wait, any credential; left out when it
  fails); `analyzr status`'s models line `  models     31 (31 waiting for agent), about 198 pairs
  to judge` while models wait, and `--json`'s `pairsToJudge` per project (0 while none waits,
  `null` when the summary cannot be read). `analyzr import --json` is unchanged: it prints no
  waiting tasks.

Deviations from the plan, with reasons:

- **A new function in `@analyzr/relations`**, not the cached whole-project candidates alone (the
  plan: "through the existing `CandidateCache`"): those overcount once only some models wait,
  since a pair with a model that does not wait can have an assigned basis only from that model's
  side, which the waiting model's claim does not assign (5,503 against the exact 2,940 for 50 of
  496 models); generating each waiting model's own candidates instead cost 5.9–6.9 s on the first
  summary after a head change (against 0.27 s) and was reverted. `projectCandidates` gives them from
  the pass the cache already pays for, and that pass is as fast as before (medians of 9 on 496
  models: HEAD's `generateCandidates` 5,345 ms, the new one 5,356 ms, `projectCandidates` 5,335 ms).
  `generateCandidates`' output and `eval:candidates` are unchanged.
- **Exact for the stored state**, while the plan asked for "about how many": „etwa“ / "about" in
  the texts stands for what changes before the claims run.
- **Claimed tasks whose lease ran out count, and the summary reads the clock** (the review round's
  change; the implementer had counted every claim as live, with no clock): the count is the size
  of the next run, while „N Modelle warten auf den Agenten“ still counts the queued tasks only. The
  alternative, queued tasks only with expired claims holding nothing, would depend on the order of
  the claims (HANDOFF §4).
- **The suffix also beside „Agent verbinden“**: right after a first import the owner usually has
  no token yet, which is exactly when the run gets planned.
- **No „ · “ beside the owner's button**: the size sits beside it as muted plain text; the waiting
  lines keep „ · “.
- **`--json`**: `analyzr status --json` carries the field; `analyzr import --json` prints no
  waiting tasks and stays unchanged.
- **„Hochladen“** shows the suffix too: the step's task made it depend on a cheap summary read
  there, which it is (above).

The review round (a count-correctness lens and a surface-and-UX lens) found 12 points; 9 are
fixed, 3 not taken. Fixed: (1) a second candidate-cache lookup in the summary could run the
whole-project pass again under concurrency (the pass's own candidates now come with the read
model's input; a test counts one pass per build with `CandidateCache(0)`); (2) `waitingPairs` and
`CandidateCache.focusPairs` were not needed (removed: the plain `pairsToJudge` with the held pairs
as judged); (3) an expired lease kept holding its pairs until the next event (the clock and
`validUntil`, above; the test fails without the clock check, "expected 195 to be 198"); (4) the
benchmark's old side ran the new candidate code (re-measured against the real HEAD; `emit` makes
no closures per call); (5) a revision query per claimed task whether needed or not (now only for
live claims with a claimable model revised since); (6) the batch notes did not say where the whole
number shows (they do); (7) „Hochladen“ could show a number from before the import after a failed
read (in TanStack Query 5.104.1 `isFetchedAfterMount` is true after a failed fetch too; now
`isSuccess && isFetchedAfterMount`, with a test that fails on the old guard); (8) the route's
description contradicted the UI (now the badge counts for editors and owners, `pairsToJudge` for
every member); (9) the UI load guard's new check could pass silently (it asserts a count above 1).
Not taken: „zu beurteilen“ in the suffix (the plan's text; two more words, `signavio-beispiel`'s
„Als Nächstes“ would have 24 instead of 22: HANDOFF §4); no „etwa“ in front of an exact count
(HANDOFF §4); the docs' old lines (left to the docs pass).

Tests: server unit `next-run.test.ts` (new: the count over the pass's own candidates equals
`pairsToJudge` over each model's own `generateCandidates` call on `_sample` and `nordwind-handel`
for four sets of models, a pair between two claimable models once; `heldPairs` is what `planClaim`
skips, rule 1), integration `pairs-to-judge.test.ts` (new, real PostgreSQL, the whole
`nordwind-handel`: equal to the union of the claims' assignments after a first import, and with a
held claim, a requeue and an acceptance; a lease that runs out, 198, 195 while held, 198 a second
after the lease, and the memo with it; built again after an import, one candidate pass each),
`project-summary.test.ts` and `open-questions.test.ts` (`pairsToJudge` 0 on an empty project and
after the agent's run); relations (`projectCandidates` equals the per-focus `generateCandidates`,
on synthetic facts and the corpus); contracts (required, never negative); web `lib.test.ts`,
`overview.test.tsx` (the next-step texts, the singular, 0, UX1's budget), `upload-panel.test.tsx`
(the suffix after an import, no stale number after a failed read), `bundle.test.ts` (227.9 KB); CLI
`import.test.ts`, `seed-status.test.ts`, `manifest.test.ts`, `cli.e2e.test.ts`; Playwright
`smoke.spec.ts` (after the bundle import the waiting text and „Übersicht“'s suffix equal REST's
`pairsToJudge`) and `ui-load.spec.ts` (UX1's budget on `signavio-beispiel` with the suffix).

What it costs and leaves open. Every gate green (server 1,783, web 659, CLI 278 plus 7 skipped,
contracts 178, bpmn-facts 200, integrate 145, eval/tools 108, relations 91, agent-sim 57,
procedures 37, demo 27, notices 9, client 4; dependency-cruiser 150 modules, no violations; the
eval reports unchanged). Live-run neutral. The bundle entry is 227.9 KB gzip (+0.3 over step 3's
227.6, ceiling 240). `getProjectSummary` on 496 models, HEAD against the new code, medians of 3:
cold 5,429 → 5,662, 5,449 → 5,620 and 5,667 → 5,969 ms in the three states (all waiting; 100 done
with 5 held; 50 of them re-imported; within the runs' spread), a rebuild over cached candidates
15–83 ms more, memoized 1–2 ms before and after, so the projects list and „Übersicht“ are not
measurably slower. The UI load guard: `signavio-beispiel`'s „Als Nächstes“ with the suffix 22
words and 4 controls (budget 40 and 5), its „Übersicht“ 117 / 102 words (113 / 98 before); no
budget constant changed. The e2e runs: the implementer's and the fixer's on their scratch stack
`ui-load.spec.ts` 30 of 30, `smoke.spec.ts` with `upload-preview.spec.ts` 6 of 6; the lead's run on
the final tree: the full Playwright suite 111 passed and 21 skipped, the demo check 152 of 152,
`demo.spec.ts` 14 of 14, after a fix of an older web race its first run found (`RetryAgent`
swapped its button for the popover's trigger as the owner's agent tokens arrived, so a click then
was lost; it now keeps one element; DEVELOPMENT.md "M6 S2b follow-up step 3b (2026-10-20)"). The
readings the owner may overrule are in HANDOFF §4 ("Taken during the M6 S2b follow-up step 3b").
Open:

- **A head nobody has read yet** costs the whole-project candidates once: `analyzr import` in text
  mode and `analyzr status` now read the summary while models wait, about 6 s at 496 models and
  30 ms at 31 (the web's first „Übersicht“ pays the same anyway).
- **The number moves without the consultant's doing**: a lease that runs out makes its task count
  again (the memo ends with it), and decisions and imports before the claims change it („etwa“).
- **The suffix beside „Agent starten“ in a browser**: the e2e stacks' owners have no token, so the
  specs check it beside „Agent verbinden“ and in the waiting text; a web unit test covers „Agent
  starten“.

Left: step 4 (plugin 0.1.3: the key-map rebuild, `analyzr-read.mjs` by decision 29 (2),
`exporterVersion`; delivered the same day, "S2b follow-up step 4 as delivered" below), step 5 (the
identity rows of decision 29 (1), migrations 0021/0022; delivered the same day, "S2b follow-up step
5 as delivered" below); then S3c and S6.

**S2b follow-up step 4 as delivered** (2026-10-20, on the branch, every gate green, with a review
round's fixes; [DEVELOPMENT.md](DEVELOPMENT.md) "M6 S2b follow-up step 4 (2026-10-20)" and "The
integrate plugin and `tools/integrate`"; owner decision 29 (2), §2): the integrate plugin 0.1.3
(§3.7 steps 3, 5 and 6). The skill previews an import itself through the plugin's own read-only
script, which cannot import, recovers a lost key map from analyzr, and reports the agent work in
the web's words. For the first analysis: a consultant's first import of a big export goes through
without duplicate models (a lost `keymap.json` is rebuilt from analyzr before any key is derived
afresh, and a tool id on two keys is named with its deletion for the consultant) and with the agent
work known up front (the pairs to judge, the processes to place, the work repeated, an agent's
running work the import would cancel), with no import by the agent. Only `plugins/analyzr-integrate`
and `tools/integrate` change, plus a CLI e2e section: no route, no migration, no contract change,
the client not regenerated; the server, the web, MCP, the procedures, the claim inputs, the
pipeline plugin and the recordings are untouched, and the integrate plugin is never loaded in live
runs.

- **`exporterVersion`** (`src/bundle.ts`, the new `src/declared.ts`): `normalize-bpmn` declares it
  as `source.systemVersion` tidied as analyzr stores it (`tidyDeclared`, a local copy of the
  contracts' function with the manifest's limit added, since integrate bundles zod-free contract
  modules only; a test pins the two together within the limit): lone surrogates as U+FFFD, control
  characters as spaces, the ends trimmed; blank or over 100 characters (the manifest's limit, pinned
  against `ImportManifest`: 100 taken, 101 refused) `null`. Inspect stays raw.
  `NORMALIZE_BPMN_VERSION` stays 0.1.0: the model bytes (`CONVERTER_OUTPUTS['0.1.0']`) are
  unchanged, and a new converter version would change `derived.converter`, which owners' rules for
  derived calls match exactly (S2c-3); the comment in `src/version.ts` now says the converter
  version guards the model bytes and the declared derivation, while an informational value moves
  with the plugin version.
- **The key-map rebuild** (`rebuildFromAnalyzr`, `inferRule`, `ruleFits` in `src/keymap.ts`, pure;
  `normalize-bpmn.mjs plan … --from-analyzr <external-ids.json>`; `plan --write` stays the only
  writer; `analyzr-keymap/1` unchanged, the result checked with `parseKeymap`): (1) a system
  missing from the map gets analyzr's live identities of that system, the rule inferred (or
  `--strip`/`--prefix`), the whole system as scope, nothing excluded; a key without a tool path is
  skipped and listed; with none of the system's models in analyzr the map stays and the plan is a
  first import; (2) a tool id (generic ones count as none) on several keys stays with the key the
  map gives it (`keptBy: keymap`), else with the oldest model's key, the smallest `mdl_` ULID from
  `--existing` (`oldest`), or the oldest with a tool path when that one has none (`path`); the
  others keep their tool path only and are listed as `duplicates`; without model ids nobody keeps
  it (`null`); keys left with one path and no tool id are settled alike, the others dropped from
  the map and listed; (3) a system the map has gets only the keys it lacks, unless an entry
  already holds that identity (`conflicts`), and its entries, rule, scope and exclusions never
  change; (4) a key another system holds is a conflict; (5) the rule: `strip` none or a leading
  folder a rule can name, `prefix` none or leading key segments every key shares that form a
  valid key; a key fits when derived exactly or with a collision's `-n`; most fits wins, a tie
  the simpler rule (fewer parts, fewer segments, code-point order). Paths compare in the form
  analyzr stores them (`storedPath`), so a file whose tool path analyzr stored tidied is `known`.
  `existingKeysOf` keeps `id` from `--existing`; `compactPlan(plan, rebuilt)` prints `rebuilt:
  {restored, entries, rule, ruleFits, duplicates, skipped, conflicts}` after the plan's header and
  before the counts; with rebuilt entries the plan has `firstImport: false`.
- **`analyzr-read.mjs`** (`src/analyzr.ts`, `src/preview.ts`, the entry `src/cli/analyzr-read.ts`,
  in the bundle's `ENTRIES`; `ANALYZR_READ_VERSION` 0.1.0): `models -p <p> --url <u> --json-out
  <f.models.json>` (every page of `GET …/models`, as `analyzr models list --json` prints them),
  `external-ids -p <p> --url <u> [--system <s>] --json-out <f.external-ids.json>` (as `analyzr
  models external-ids --json`) and `preview <bundle> -p <p> --url <u> [--json-out
  <f.preview.json>]`, which walks the bundle as the CLI does (`isImportPath`, the manifest's
  pinned keys, `modelKeyOwners`, local failures as `createProblem` writes them, batches of at most
  50 files and 25 MB in `comparePaths` order), sends each batch with the whole manifest to `POST
  …/imports?dryRun=true`, merges them with `mergeImpacts` of `@analyzr/contracts/impact-merge` and
  prints compact JSON (`credential`, `batches`, `batchesWithNew`, `counts`, `manifest`, `files`,
  `skipped`, the impact's counts, `agentWork` with the relations' `queued`, `cancelled`, `claimed`,
  `claimedKeys`, `pairs`, `rejudged` and the placement's `outcome`, `toPlace` as the web's
  `processesToPlace`, `again`); the file gets what `analyzr import --dry-run --json` prints. Its
  guard: the three requests built by `requestFor` and checked again by `assertAllowed` right
  before `fetch`; `--url` http(s) to 127.0.0.1, `[::1]` or `localhost` without user name,
  password, path, query or fragment; `redirect: 'error'`; `NO_PROXY=*` before any request and a
  refusal while Node's proxy support is on with `HTTP(S)_PROXY`; strict parsing (no `--create`,
  `--name`, `--dry-run`, `--token`); the credential `ANALYZR_TOKEN` (an agent token by its
  pattern, an owner key there refused) or the owner key file, found and checked as
  `apps/cli/src/credentials.ts` does, never printed; `--json-out` only the script's own three
  kinds of file in an existing `reports/` next to `analyzr-workspace.json`, no symbolic or hard
  link, `O_NOFOLLOW`, no folder created, never inside the bundle or a checkout
  (`assertOutputFile`);
  `preview` only for a folder with `analyzr-import.json`.
- **The skill** (`SKILL.md`): the two rules of `allowed-tools`,
  `Bash(node ${CLAUDE_SKILL_DIR}/../../scripts/inspect.mjs *)` and
  `Bash(node ${CLAUDE_SKILL_DIR}/../../scripts/analyzr-read.mjs *)`; both run exactly as shown
  and each on its own (nothing in front of `node`, nothing after the command, no `$(…)` or
  backticks in an argument, `--url` the workspace's `analyzrUrl`). Ground rule 2: the agent's own
  analyzr commands are the health check and `analyzr-read.mjs`; only where the script cannot run,
  each approved once by the consultant and never with "don't ask again", the CLI's `models list`
  and `models external-ids` (step 3) and, on the consultant's wish, its dry run (step 5); never
  `analyzr import` without `--dry-run`, never with `--create` or `--name`; the script reads the
  credential, the agent never does. Step 3 reads `models` and `external-ids`, plans with
  `--existing` and `--from-analyzr` whenever it could read them and reports `rebuilt` in German:
  „Die Schlüsselzuordnung für „<system>“ fehlte; ich habe sie aus analyzr wiederhergestellt:
  <entries> Modelle, Regel „<rule>“ (passt zu <matching> von <of>).“ (the rule as „Pfad wie im
  Werkzeug“, „ohne den Ordner „…““, „mit dem Präfix „…/““), „Neue Modelle bekommen ihre Schlüssel
  nach dieser Regel; die übrigen Schlüssel bleiben, wie sie sind.“ when it fits fewer than all, „Die
  Schlüsselzuordnung für „<system>“ kannte <entries> Modelle nicht, die analyzr hat; ich habe sie
  ergänzt.“, per duplicate by `keptBy` („Die Werkzeug-ID „…“ tragen „a“ und „b“: „a“ (älter)
  behält sie; „b“ ist vermutlich doppelt importiert.“; „„a“ behält sie, weil deine
  Schlüsselzuordnung sie „a“ gibt; …“; „„a“ behält sie, weil das ältere „b“ in analyzr keine
  Ordnerangabe hat; …“; without model ids „… darum behält sie keines: Die Dateien werden über
  ihren Pfad erkannt.“), the skipped keys and the conflicts. Step 5 runs `analyzr-read.mjs preview
  "<absolute bundle path>" -p <project> --url "<analyzrUrl>" --json-out
  "<workspace>/reports/<YYYY-MM-DD>-<system>.preview.json"` into an existing project only (for a
  missing one: „Das Projekt <project> gibt es in analyzr noch nicht. Leg es an („Neues Projekt“
  im Web), dann zeige ich dir die Vorschau.“); otherwise it prints `<cli> --url "<analyzrUrl>"
  import "<absolute bundle path>" -p <project> --dry-run` for the consultant or points to the web.
  Step 6: the „Kurzfassung“ has four lines, the second the agent work („Danach für die Agenten: 214
  mögliche Relationen zu beurteilen (56 davon erneut), 7 Prozesse zu platzieren“, with
  `batchesWithNew` above 1 „ (ohne die Paare zwischen den Teilen; die ganze Zahl steht nach dem
  Import unter „Als Nächstes“)“, without agent work „Danach für die Agenten: nichts zu beurteilen
  oder zu platzieren“); the new section 9 „Vorschau“ in the web's words (the headline „Vorschau: 5
  Modelle neu · 1 neue Revision · …“, the impact lines of `impactLines`, the cost line with
  `processesToPlace` and „etwa “ for more than one batch, the claimed-task warnings of
  `claimedImportWarning`, both batch notes; the skill's own lines where the web has none: from the
  plan „Neue Aufgaben für den Agenten: 12 Modelle; abgebrochen: 2“, the advice „Warte am besten,
  bis er abgegeben hat, oder nimm den Verlust in Kauf.“ after each claimed-task warning and „Ein
  Agent platziert gerade; geänderte Prozesse kommen danach noch einmal.“ for a deferred placement
  task, and for a preview with an agent token that the files count as agent uploads and „Deine
  Regeln für abgeleitete Aufrufe fehlen in dieser Vorschau; die Zahlen für die Agenten können
  darum abweichen.“); `external-id-moved` in a
  preview reads „Werkzeug-ID gehört schon zu <Schlüssel>: Der Import würde das Modell doppelt
  anlegen“, the skill then recommends no import and goes back to step 3; „Offene Punkte“ lists the
  models likely imported twice with `models delete`; „Import“ is section 11 and says, after a
  preview with `ANALYZR_TOKEN`, „Starte den Import in einem Terminal ohne ANALYZR_TOKEN (vorher
  `unset ANALYZR_TOKEN`): Sonst nimmt die CLI das Token statt des Owner-Zugangs.“ The guard setup
  describes `analyzr-read.mjs` and the read token for its sandbox (`<cli> --url "<analyzrUrl>"
  token create -p <project> -n integrate-preview -s analyzr:read`, set as `ANALYZR_TOKEN`) and
  offers no lasting rule.
- **The release**: `plugin.json` 0.1.3 (its description names the rebuild and the preview),
  `RELEASES['0.1.3']` = `c1915b05d18beea39d4436899be3edeff98ca4e7318aacfd2726d12333317f61` with a
  comment, the bundle regenerated (`analyzr-read.mjs` new, `normalize-bpmn.mjs` changed,
  `inspect.mjs` and the plugin's notices unchanged), `claude plugin validate --strict` (Claude Code
  2.1.303) passed; `pnpm notices` left `THIRD-PARTY-NOTICES.md` unchanged; `marketplace.json` and
  the procedures' `RELEASED` and `PLUGIN_RELEASES` untouched.

Deviations from the plan, with reasons:

- **`exporterVersion` changes what analyzr stores in two edge cases** (the plan expected no
  change): models declaring one version with and without spaces around it now give that version
  (before none, since the raw values differed), and one over 100 characters gives none (before
  analyzr refused the bundle). The model bytes are unchanged, so `NORMALIZE_BPMN_VERSION` stays
  (HANDOFF §4).
- **The older key is not always the smallest ULID**: the key the map already gives the tool id
  keeps it (a stale map is never rewritten), and an oldest key without a tool path yields to the
  oldest one with a path (it could not be identified in a re-export); `keptBy` says which, and the
  skill has a text for each, so „(älter)“ is said only where it holds.
- **Duplicates before skipping**: duplicates are found before keys without a path are skipped, so
  a tool id moved to a key without a folder shows as both (the CLI e2e case).
- **Paths compared as analyzr stores them** (not in the plan): a tool path analyzr stored
  tidied would otherwise have planned the export's file as new, a duplicate model.
- **`--strip`/`--prefix` with `--from-analyzr`** override the inferred rule, only while the map
  lacks the system; **`--reset` with `--from-analyzr`** is refused while analyzr has models of the
  system (their keys never change).
- **`preview` needs a manifest**: a folder without `analyzr-import.json` is refused, so a
  pre-approved run never sends an arbitrary folder.
- **`--json-out` restricted**: only the script's own three kinds of file, in an existing `reports/`
  next to `analyzr-workspace.json`, no symbolic or hard link, `O_NOFOLLOW`, no folder created, so a
  pre-approved command cannot overwrite `settings.json`, `keymap.json` or anything outside the
  workspace's reports.
- **No proxy**: `NO_PROXY=*` and the refusal under Node's proxy support (Node 24.15 tunnels even
  a request to 127.0.0.1 through a configured proxy, which would see the credential).
- **`ANALYZR_TOKEN` checked by its pattern** (`analyzr_at_…`; an owner key there refused), so a
  malformed value never reaches an error message.
- **Exit codes**: a refused URL exits 1, not 2; `preview` exits 1 when a file would fail, as the
  CLI does, with the JSON printed. **`external-ids --system`** is optional.
- **A CLI fallback for step 3's reads**: where the script cannot run (no credential in the
  sandbox, analyzr not on this machine) the CLI's `models list` and `models external-ids`, each
  approved once.
- **No `permissions.allow` rule offered** until the owner's live check (the plan: only if the turn
  limit is confirmed); the implementer's offer was removed in the review round.
- **The report's texts** are the shipped ones of steps 3 and 3b (`agentCostText`,
  `processesToPlace`, `claimedImportWarning`, `batchNoteText`) wherever the web has one, not the
  plan's example sentences; three plan sentences without a web counterpart stay as the skill's
  own (the queued and cancelled tasks, the advice after the claimed-task warning, the deferred
  placement task); the „Kurzfassung“ has four lines.
- **The drift test's store-path check** looks for `node_modules/` instead of the bare word, since
  `analyzr-read` skips that folder by name.

The review round (its findings on security, the key-map rebuild, the skill and the release): 25
findings fixed, 1 fixed in part, 1 rejected, and the docs item left to this docs pass. Fixed, among
them: (1) the proxy guard could be bypassed by other spellings of Node's proxy option (now
`NO_PROXY=*` first and every spelling refused; a test shows the plain run reaching the proxy and the
bypass going direct); (2) `--json-out` followed a dangling symbolic link and could write outside
`reports/` (the restrictions above); (3) a malformed token could be printed in an error (the
pattern, the secret stripped from every error); (4) the skill did not forbid extending a
pre-approved command (the rule above, a test on its command lines); (5) a tool path analyzr stored
tidied planned a duplicate model (`storedPath`); (6) „(älter)“ could be false (`keptBy`); (7) a
tool id was lost when its oldest holder had no path; (8) `inferRule` could propose a strip folder
the map refuses; (9) the 100-character limit was not pinned against the contracts; (10) the
`version.ts` comment; (11) no fallback when the script cannot reach analyzr; (12) the
„Kurzfassung“'s cross-batch remark and its text without agent work; (13) the agent-token note
without the owners' rules; (14) ground rule 2 contradicting step 5; (15) `external-id-moved` in a
preview; (16) `ANALYZR_TOKEN` reaching the real import; (17) the `permissions.allow` offer; (18)
singulars, the auto-accept wording, „über den Owner-Zugang“, the workspace comment and „50 Dateien
und 25 MB“; (19) a weak import test (every spelling of an import command now checked, only the
report's „Import“ prints the real one). In part: the refusal under Node's proxy support stays next
to `NO_PROXY=*` as a second guard, so a guard sandbox that sets it with a proxy falls back to the
consultant's dry run. Rejected: a `GET /health` before sending the credential (decision 29 (2)
allows exactly three requests, and any local process can fake the answer; the skill instead
requires `--url` to be the workspace's `analyzrUrl`).

Tests: integrate `analyzr-read.test.ts` (new, against `test/fake-analyzr.ts`: the three commands,
batches of 50 and 11 with the whole manifest each, every refusal, no request but the three over all
runs), `keymap.test.ts` (`rebuildFromAnalyzr` and `inferRule`, 14 tests), `cli.test.ts` (`plan
--from-analyzr`, `--reset` refused), `bundle.test.ts` (the declared `systemVersion`, the limit,
`tidyDeclared` against the contracts'), `drift.test.ts` (`analyzr-read.mjs` free of third-party
code and zod, its bundled copy run away from `node_modules`), `plugin.test.ts` (the files,
`allowed-tools`, the pre-approved command lines, no `permissions.allow`, every import command a dry
run outside the report's „Import“, `RELEASES['0.1.3']`); CLI e2e `cli.e2e.test.ts` (new section,
real server: the bundled preview equal to `analyzr import --dry-run --json` on `m6-s2a` and
`nordwind-handel` with `seq` and the models unchanged; `external-ids` into `plan --from-analyzr`:
`restored`, the strip rule „Gemeinsame Dokumente“, 6 of 6 fitting, every model known, one duplicate
kept by the oldest key, one skipped key).

What it costs and leaves open. Every gate green (server 1,783, web 659, CLI 281 plus 7 skipped,
contracts 178, bpmn-facts 200, integrate 205, eval/tools 108, relations 91, agent-sim 57, procedures
37, demo 27, notices 9, client 4; dependency-cruiser 150 modules, no violations; the eval reports
unchanged). Live-run neutral. The implementer's scratch stack previewed the golden bundle into
`nordwind-handel` with the bundled script and a read token (5 new, 1 revised, 6 relations tasks
queued, 38 pairs, 1 task cancelled) and got 404 for a missing project; the docs pass's own stack,
built from the reviewed tree, gave the same. The e2e run on the final tree: the scratch stack
`analyzr-s2b4` (image `analyzr-s2b4:dev` from the final tree, ports 7690 and 55690, `analyzr seed`):
the full Playwright suite 111 passed and 21 skipped, the test names and the UI load numbers as in
step 3b's run; the demo stack `analyzr-s2b4-demo` (port 7691): `pnpm --filter @analyzr/demo check`
152 of 152 and `demo.spec.ts` 14 of 14; the bundled `analyzr-read.mjs` with a read token on
`analyzr-s2b4`: the golden bundle previewed into `nordwind-handel` (5 new, 1 revised, 6 relations
tasks queued, 38 pairs, 1 task cancelled), `lastSeq` unchanged, `models` and `external-ids` written
into the workspace's `reports/`, 404 with exit 1 for a missing project, a hard-linked `--json-out`
and the command `import` refused; the stacks, their volumes and images and the workspace removed.
The readings the owner may overrule are in HANDOFF §4 ("Taken during the M6 S2b follow-up step 4");
the live checks for the owner are in HANDOFF §8. Open:

- **The pre-approval in a live session**: whether the two rules count as two, whether
  `${CLAUDE_SKILL_DIR}` expands in `allowed-tools`, whether the pre-approval lasts beyond the
  invoking turn (steps 3 and 5 follow the consultant's answers; else one approval each, or a
  lasting rule with the expanded path), whether compound commands, prefixes, redirects and
  substitutions make Claude Code ask, and what the guard sandbox allows (loopback, the key denied,
  `ANALYZR_TOKEN` passed, Node's proxy support): none of it was tried (no LLM call).
- **A preview with a read token** classifies the files as agent uploads and knows none of the
  owner's rules for derived calls, so its calls show as proposals and its agent numbers can
  differ; the report says so.
- **A folder moved in the tool** keeps the old path in `external-ids` until step 5's identity rows
  (decision 29 (1)), so a key map rebuilt after such a re-export plans the file as `moved` again
  (its key stays) and the skill asks about it once more. Closed by step 5 (below) once the
  consultant has run the import of such a re-export.
- **The reference notes** stay unverified (§10.4), as does the guard setup (§3.1).

Left: step 5 (the identity rows of decision 29 (1), migrations 0021/0022; delivered the same day,
"S2b follow-up step 5 as delivered" below); then S3c and S6.

**S2b follow-up step 5 as delivered** (2026-10-20, on the branch, every gate green, with a review
round's fixes; [DEVELOPMENT.md](DEVELOPMENT.md) "M6 S2b follow-up step 5 (2026-10-20)" and
"Provenance and the import manifest"; owner decision 29 (1), §2, §10.10): the identity rows.
analyzr's record of where each model lives in the customer's tool stays current across re-exports
whose bytes did not change: a moved folder, another tool id or link, a bundle imported over bytes
first uploaded without one. For the first analysis: once such a re-export is imported, the key-map
rebuild (§3.4 rule 1, §3.7 step 3) plans its files as known, the absent-key list of a scoped partial
export names the right models, the change list points to where a model lives now, and no stale
folder lets a path-derived key create a duplicate model; none of it re-analyses or re-queues.
Server, contracts, client, CLI and web change; the integrate plugin stays 0.1.3 (nothing it reads
changes shape), and `packages/procedures`, `tools/integrate/src`, `impact-merge.ts`, `paths.ts`,
`ImportImpact`, `ManifestSummary`'s JSON, MCP and its snapshots, the claim inputs, facts,
`facts_hash` and the trust class are untouched.

- **The table** `model_identity` (`apps/server/src/db/schema.ts`; `0021_model_identity.sql`
  generated, `0022_model_identity_triggers.sql` hand-written): project, model, `seq`, revision,
  `kind` (`revision` or `unchanged`), `system`, the nullable `external_id`, `external_path` and
  `url`, principal, client, `created_at`; the primary key `(project_id, model_id, seq)`, a composite
  foreign key to the revision, a partial unique per stored revision. 0022: the append-only and
  no-truncate triggers; the guard `analyzr_model_identity_guard` (`check_violation`): a row names an
  uploaded, not amended, revision of its model; a `revision` row sits at its revision's seq with its
  revision's principal, system, tool id, folder and link; an `unchanged` row sits on its own
  `model.identity_declared` event naming the same model, revision, system, tool id, principal and
  client, and names the revision the live model's unchanged bytes are kept as (the head, or an
  amended head's `upstream`). The backfill: one `revision` row per uploaded revision a manifest
  declared, deleted models too, at its seq with its principal and time and its `model.revised`
  event's client, through the guard, `ON CONFLICT DO NOTHING`; the newest row is then what S2a's
  readers read (the head's uploaded revision's declaration, else the newest declared revision's).
- **The writer** (`recordIdentity` in `ingest.ts`, inside the ingest's transaction under the project
  lock): a stored listed file (`created`, `revised`, a revival) gets a `revision` row at its
  uploaded revision's `model.revised` seq, right after the uploaded head and before an amended head
  on top; an unchanged listed file gets an `unchanged` row only when its declaration differs from
  the newest row (`identityUpdate`, pure, in `provenance.ts`), with its own event
  `model.identity_declared` (`{modelId, modelKey, revisionId, system, externalId, manifestSha256}`,
  no folder or link). A file without a manifest entry returns before any query. Amendment writes,
  withdrawals, deletions and `analyzr value-chain push` write none. An unchanged re-import thus
  writes no revision, facts, task or recompute; `last_seq` moves by one per recorded unchanged file
  (and with it the landscape ETag, MCP `get_landscape`'s seq, the change list's „Stand“ and the
  summary's `lastEventAt`), the ETags of amendments and value chains do not.
- **The readers**: `uploadedSources` joins the newest row laterally (`newestIdentityOf`, `ORDER BY
  seq DESC LIMIT 1` served by the primary key) and returns the uploaded head's source with the four
  identity fields from the row (`withIdentity`; absent without one); its fallback query is gone.
  `external-ids`, the identity warnings and the dry run's absent keys read it; `identities.newest`
  (`DISTINCT ON`) serves the ingest's check, the dry run and the change list (live and deleted
  models); `modelViews` joins the row for `Model.identity`. The trust class (`headTrustRows`),
  `Model.source` and `Revision.source` read no row.
- **Contracts**: `ModelIdentity` `{system, externalId, externalPath, url}` and `Model.identity`,
  required and nullable, REST only (no MCP output carries `Model`);
  `ImportFileOutcome.identityUpdated: true`, only on an unchanged listed file whose identity the
  import records (or would: the dry run's `files` equal the import's); `MAX_IMPORT_WARNINGS` = 4
  (the schema's limit, the OpenAPI unchanged); the docs of `provenance-kept`, `external-id-changed`,
  `ExternalIdEntry`, `RevisionSource`'s identity fields ("as this revision was declared")
  and `Revision.contentHash` ("identical uploads store no revision"); the descriptions of
  `putModelByKey`, `importModels` and `listExternalIds`; the client regenerated.
- **The warnings** (`identityWarnings` in `provenance.ts`): every listed file takes its identity in
  the request's sequence, stored or unchanged, as the ingest records it; `external-id-moved` says
  `two models now carry it (moved or renamed in the tool?)` for both; the unchanged
  `external-id-changed` reads `this unchanged file (<system> id <id>) now identifies <key>, which
  held <system> id <id>`. `provenance-kept` compares the derivation only (`derivationOf`:
  `derived.kind` with an absent one as `none`, plus the converter of `converted`): `unchanged, so
  its revision keeps the derivation <kept> (this file: <incoming>); tool id, folder and link go by
  this file; a correction needs changed bytes`, a derivation reading `converted with <converter>`,
  `converted`, `export`, `reconstructed`, `as-told` or `none declared`; it is raised also next to
  `external-id-changed`, not next to a `trust-kept` that names the derivation
  (`trustKeptNamesDerivation` in `trust.ts`: the two classes' reasons differ in `converted`,
  `reconstructed` or `as-told`), and dropped as a file's fifth warning (`withinWarningLimit`), in
  the import, the PUT and the PUT dry run.
- **The web**: „Hochladen“ offers „Importieren“ also when an outcome has `identityUpdated`, and the
  „Vorschau“'s „Danach:“ names „Ort im Quellsystem für 6 Modelle aktualisiert“
  (`identityUpdateText`, „für 1 Modell“, de-DE counts) when no file would be created or revised; the
  headline after the import stays („Kein Modell importiert · 6 unverändert“). „Herkunft“ reads „Im
  Quellsystem“ from `Model.identity` („Signavio: …“ when the revision declares no system or another
  one; no line for an identity without a folder) and the link „In Signavio öffnen“, there and in
  „Mehr“, from `Model.identity.url` (`toolLinkOf(model)`, no longer waiting for the revisions);
  „Quelle“, „Entstanden“, „Hochgeladen“, the losses and „Aufrufe“ stay the revision's.
  `provenance-kept` reads „Unverändert: analyzr behält die bisherige Angabe, wie die Datei
  entstanden ist. Eine Korrektur braucht geänderte Dateien.“ (UX-SIMPLIFICATION.md §7).
- **The CLI**: the manifest line counts the files with `identityUpdated`, in the import and its dry
  run alike (`provenance stored for 0; 6 unchanged keep their first revision's, 6 of them record a
  new tool id, folder or link`; `… 1 of them records …`; `provenance stored for 5; 1 unchanged keeps
  its first revision's and records a new tool id, folder or link`; still `… 6 unchanged keep what
  analyzr had` when nothing is recorded); the help and doc of `models external-ids` name the newest
  import; `ManifestSummary`'s JSON is unchanged.

Deviations from the plan, with reasons:

- **A stronger guard** than planned: the event of an `unchanged` row must name its model, revision,
  system, tool id, principal and client, the revision must be the one the live model keeps (so no
  `unchanged` row for a deleted model), and a `revision` row must carry its revision's principal;
  the writer and the backfill meet it, at one indexed lookup per row.
- **`model_identity_revision_unique` is redundant** but kept: the guard pins a `revision` row's seq
  to its revision's, so a second row for one revision fails on the primary key first.
- **No query for an undeclared file**: `recordIdentity` returns before reading the newest row, so an
  unchanged re-import without a manifest costs nothing more.
- **`provenance-kept` beside `trust-kept`**: the plan kept it silent beside every `trust-kept`; the
  review round showed that this hid a derivation change when only the credential differed (a model
  stored as an agent upload, the owner declaring `export`: the derivation stays „Ohne Angabe“) and
  made a read-only token's dry run differ from the owner's; now it is silent only beside a
  `trust-kept` that names the derivation, and `withinWarningLimit` keeps the limit of four.
- **The CLI's verb** `record(s)` instead of the plan's "with", so the line says that the identity is
  recorded.
- **„Herkunft“'s link** has no fallback to the revision's link: after the backfill every revision
  that declares one has its row.
- **The moved manifests of the tests also bump `systemVersion` and `exportedAt`** (19.7.0,
  2026-11-02) in the CLI e2e and the smoke spec, so the check that „Quelle“ keeps 19.6.0 and
  14.10.2026 proves something.
- **Two integration tests on other data**: the amended-head case re-imports the current uploaded
  bytes (the model's first bytes are no longer known, so they would come back `revised`), and the
  agent-token case uses a Camunda 7 model (with an engine-less one both classes are `derived`, and
  `trust-kept` never fires).

The review round (semantics, data and surfaces): 8 distinct findings, 6 fixed, 2 rejected. Fixed:
(1) `provenance-kept` hidden beside every `trust-kept` (above); (2) the stale description of
`external-id-changed` in `routes.ts`; (3) the guard too loose for `unchanged` rows (above); (4) the
CLI line not saying that the identity is recorded; (5) the upload panel's test never reaching the
branch it named (now it fails without the panel's guard); (6) the bundle history's numbers and the
placement of `identityUpdateText`'s test. Rejected: the headline after „Importieren“ confirming the
recorded places (the plan keeps `importHeadline` as it is; HANDOFF §4 asks the owner), and naming
the owners' rules in the German `provenance-kept` text (the plan's text; it says only that the
derivation stays).

Tests: server unit `provenance.test.ts` (the helpers, the identity warnings' sequence, every
`provenance-kept` case with its exact message, the four-warning limit, `originOf` from an identity)
and `trust.test.ts` (`trustKeptNamesDerivation`); integration `provenance.test.ts` (the moved-folder
re-import, a bundle over bytes first uploaded without one, another tool id and an entry without one,
a deletion and revival with the change list, an unchanged PUT and its dry run, the amended head, the
agent token, both warnings beside `trust-kept` and five candidates kept at four, the dry run's
`files` equal to the import's, scoped absent keys, append-only and the guard), the new
`migration-model-identity.test.ts` (eight cases on a database migrated to 0020, the rows exact, the
readers equal to S2a's, the backfill idempotent) and `value-chain-ingest.test.ts` (an identity-only
re-import on a live chain moving nothing else); CLI unit `manifest.test.ts` (four new line forms,
import and dry run, the JSON shape) and e2e `cli.e2e.test.ts` (new, project `m6-s2b5`: the moved
folders through the dry run, the import, `models external-ids` and the bundled `analyzr-read.mjs
external-ids`); web `provenance-lib.test.ts`, `provenance-view.test.tsx`, `upload-panel.test.tsx`
and `lib.test.ts`; Playwright `smoke.spec.ts` (the UX8 bundle test re-imports a copy with moved
folders).

What it costs and leaves open. Every gate green (server 1,804, web 663, CLI 286 plus 7 skipped,
contracts 178, bpmn-facts 200, integrate 205, eval/tools 108, relations 91, agent-sim 57, procedures
37, demo 27, notices 9, client 4; dependency-cruiser 150 modules, no violations; the eval reports
unchanged). Live-run neutral. The bundle entry 228.1 KB gzip (+99 B). On 496 models imported with a
manifest, medians of 7: the landscape read 232.4 → 230.5 ms, `models.list` 13.5 → 17.1 ms,
`models.view` 12.7 → 14.2 ms, `uploadedSources` 2.5 → 3.8 ms, `GET …/external-ids` 3.3 → 4.7 ms, the
import 40.9 → 38.0 s. Before the review round the implementer's scratch stack `analyzr-s2b5i` ran
`smoke.spec.ts` with the extended test, 5 of 5, and was removed. The e2e run on the final tree:
Playwright 111 passed and 21 skipped, the UI load unchanged, the demo check 152 of 152,
`demo.spec.ts` 14 of 14 (a pixel comparison of the chain page failed in two runs while the machine
was loaded and passed in nine since, DEVELOPMENT.md "M6 S2b follow-up step 5"). The backfill on
`analyzr-local`: 0 rows, as none of its 63 revisions declares a system. The readings the owner may
overrule are in HANDOFF §4 ("Taken during the M6 S2b follow-up step 5"). Open:

- **The skill's report of an identity-only re-export** (plugin 0.1.3): its preview says „keine
  Änderung an Relationen und Befunden.“ and its `provenance-kept` label reads „Unverändert: analyzr
  behält die bisherige Herkunft“; the places are recorded once the consultant runs the import it
  hands over. The list for the next plugin release is in HANDOFF §7 "M6".
- **The result headline** after „Importieren“ does not name the recorded places (HANDOFF §4).
- **`Model.source` describes the bytes**: a landscape first uploaded without a manifest shows no
  subtitle „Aus Signavio“ and no chip after its bundle is imported over it, until its bytes change;
  „Herkunft“ names the system in „Im Quellsystem“.
- **A real customer re-export** (§10.4) is still untried.

Left: S3c, then S6; after the owner's live runs S5b, S7 and facts v2.

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

**S3c's plan** (2026-10-21, revised after a design and a security critique; decision 30 answered its
questions): four steps, about 8.5 d against the 3 d planned in S0, each shippable with every gate
green and live-run neutral; the done-when above is made checkable as D1 (rendered models extract
without warnings, `engine` null), D2 (bpmn-js imports them without warnings: (a) its tree walker
under the importer's refusals in CI, (b) `NavigatedViewer` in a browser), D3 (no `calledElement`
from any spec: (a) the schema, (b) the renderer, (c) the converter fixture, (d) the dry run on a
scratch stack), D4 (the bundled CLI imports a spec bundle into a scratch stack) and D5 (the drift
test and plugin 0.1.4's release row).

1. **`analyzr-spec/1` and the deterministic renderer** (3 d; delivered 2026-10-21, "S3c step 1 as
   delivered" below): the spec types, the YAML reader, the validator, the id function, the layout,
   the renderer and its self-check, the spec bundle and the entry `analyzr-spec.ts` (`validate`,
   `render`, `plan`, `bundle`), run from source; the goldens, `RENDER_OUTPUTS`, the fuzz test, D1
   and D2 (a) in CI, the Playwright harness spec of D2 (b), `replaces-known-model`.
2. **The converter runner `analyzr-convert.mjs`** (2.5 d, planned): `convert` runs exactly the bytes
   whose full sha256 the consultant approved (`--sha256`, a new confirmation per converter version),
   in a context without host objects inside a child Node under `--permission`, without file grants
   or environment, records them as `adhoc:<12 hex>` with a write-once copy in `converters/`, and
   declares `--derived converted|reconstructed` per mapping; the run record `analyzr-specs.json`,
   which `bundle` checks; Visio and AML fixtures with their converters; D3 (a) to (c).
3. **The CLI core** (1.25 d, planned): `apps/cli`'s commands in a shared core with the command name
   it prints, the parse guard (an option value that starts with `--` is a usage error, in both
   CLIs), the owner key sent only to loopback hosts by the bundled CLI, the parity tests from
   source.
4. **The integrate plugin 0.1.4** (1.75 d, planned): `analyzr-spec.mjs`, `analyzr-convert.mjs` and
   `analyzr.mjs` (every command but `seed` and `mcp`) bundled, the copied helpers moved into shared
   modules, SKILL.md with the converter and picture paths and the two items of S2b's follow-up step
   5, the reference notes `images.md`, `analyzr-spec.md` and `converters.md`, the release row, and
   the scratch-stack e2e of D3 (d) and D4.

Steps 1–3 leave `plugins/analyzr-integrate/` byte-identical (`generate`, then `git diff --exit-code
plugins/analyzr-integrate`), so 0.1.3 stays the released version and one release, 0.1.4, comes at
the end. After S3c and before S6 comes the safeguard of decision 30 (2), a small server step of its
own (§3.10).

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
- „Accepted under decision 24.2“ is computed (acceptances whose caller has an engine): the eval
  runs the libraries, not the server, and the trust rule lives in the server (S2c-1). The proxy
  equals the server's class for models a human imports without a declared derivation, as the
  variants are, so it stays as it is.
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
are `modelKeyFromPath`'s; since S2b's follow-up step 4 also `/impact-merge`, and from plugin 0.1.4
`analyzr.mjs` bundles the full contracts with zod, decision 30 (3)) with the sources and 145 tests.
`pnpm --filter @analyzr/integrate
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
- The workspace gains `inventory/` for catalogs and `reports/<…>.{models,plan,bundle}.json` for the
  scripts' complete results (since plugin 0.1.3 also `external-ids` and `preview`); `keymap.json`
  records per system the key rule, the scope and the folders to leave out (formats
  `analyzr-keymap/1` and `analyzr-workspace/1`).
- The skill pre-approves only `inspect.mjs`; §3.1's pre-approved dry run waits for S2b
  (Claude Code may keep `allowed-tools` for the invoking turn only; since decision 29 (2) a
  read-only script, `analyzr-read.mjs` in plugin 0.1.3, takes its place, delivered in S2b's
  follow-up step 4; whether the pre-approval lasts for the invoking turn only is still for the
  owner's live check, HANDOFF §8). The guard setup it offers (a `permissions.deny` rule
  `Read(~/.local/state/analyzr/**)`, the sandbox with a `credentials.files` deny,
  `autoAllowBashIfSandboxed` and `allowUnsandboxedCommands` false) follows the setting descriptions
  of Claude Code 2.1.300 but was not tried in a live session, so §3.1's "the exact rules are
  verified in S3b" stays open; the skill asks the consultant to check `/permissions` and `/sandbox`.
  Codex's sandbox modes restrict writes, not reads, so the Codex sandbox without read access to the
  key that §3.1 names does not exist: its approvals are the guard
  (`examples/agents/codex/README.md`).
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
  calls analyzr will accept on import (decision 9; since S2c-1 only from modelled bundles: an
  engine-less export's calls arrive as 90 % proposals, which the plugin says since 0.1.2, S2c-2,
  under „Eindeutige Aufrufe“ with the one-step accept „Gesammelt annehmen“).
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
  layout or ambiguous references (since 0.1.2, S2c-2: the dry run instead, above all in those
  cases); confirmations 1 and 3 and the archive question go in one message.
- Releases: `RELEASES` in `tools/integrate/test/plugin.test.ts` pins a sha256 over the plugin's
  files per plugin version, and `CONVERTER_OUTPUTS` in `tools/integrate/test/bundle.test.ts` the
  golden bundle's models per `NORMALIZE_BPMN_VERSION`, so a change of the plugin moves its
  version and a change of the model bytes normalize-bpmn writes or of the derivation it declares
  moves the converter's (since plugin 0.1.3 a purely informational value, such as the declared
  `systemVersion`, moves with the plugin version only). The golden bundle of the synthetic
  Signavio-style fixture (`tools/integrate/test/fixtures/signavio/bundle`, rewritten with
  `ANALYZR_UPDATE_GOLDEN=1`) is what the CLI and web tests read.

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

**S3c step 1 as delivered** (2026-10-21, on the branch, every gate green, with a review round's
fixes; [DEVELOPMENT.md](DEVELOPMENT.md) "M6 S3c step 1 (2026-10-21)" and "The integrate plugin and
`tools/integrate`"; owner decision 30, §2): `analyzr-spec/1` and the deterministic renderer. For the
first analysis: landscapes that exist only as Visio, ARIS AML, PDFs or whiteboard pictures get one
strict format and one renderer whose BPMN imports without a warning, draws in the model view at once
and carries no guessed call link, so steps 2–4 can bring them into analyzr in the same first pass as
the BPMN exports. Only `tools/integrate` changes (new modules under `src/spec/`, the entry
`src/cli/analyzr-spec.ts`, tests and fixtures, two type-only widenings), plus a harness page and
spec under `apps/web/e2e/`; the plugin stays 0.1.3 byte for byte after `generate`, and the server,
contracts, client, CLI, web product code, MCP and its snapshots, the procedures, the claim inputs,
facts, `facts_hash` and the trust rule are untouched.

- **The format** (`src/spec/types.ts`, `validate.ts`, §3.9): YAML 1.2 core or JSON; an unknown key
  is an error, a `null` optional field counts as absent, and every id-like value (`source`, `from`,
  `to`, `lane`, `reads`, `writes`, `externalId`) must be a YAML string („quote ids: an unquoted 0012
  or 1.10 is a number in YAML“). Top level: `format` (`analyzr-spec/1`), `source` (`externalPath`
  required, 1–1,024 characters, `/`-separated without empty parts or control characters;
  `externalId` 1–255 and `url` http(s) without credentials, taken as written, only in converter
  output; `file` for the report), `derived` (required in a spec the agent writes, refused in
  converter output: `reconstructed` with `llmModel` of 1–120 characters, or `as-told` with at most
  100 `from` ids `[A-Za-z0-9._:-]{1,64}`), `participants`, `processes` (at least one: `source`,
  `name`, `documentation`, `pool`, `lanes`, `dataStores`, at least one node, `flows`),
  `messageFlows`, `notes`. Nodes: `start` (trigger none, message, signal or timer), `end` (none,
  message, signal or terminate), `event` (`direction` catch with message, signal or timer, or throw
  with none, message or signal), `task` (`kind` none, user, manual, service, send or receive;
  `message` only on send and receive; `reads`, `writes`), `subprocess` (collapsed; `reads`,
  `writes`), `call` (`target`, no `name`), `gateway` (exclusive, parallel, inclusive or
  event-based); `message` and `signal` optional. Limits: source ids 1–200 characters and unique over
  the spec; at most 5,000 nodes, 10,000 flows, message flows and data associations together, and
  1,000 processes, participants, lanes and data stores together; 2 MB per file; 100 problems of a
  kind, then one line naming the rest.
- **The YAML reader** (`src/spec/yaml.ts`): at most 2 MB, strict UTF-8 (a byte order mark dropped),
  `parseDocument` with `version: '1.2'`, `schema: 'core'`, `uniqueKeys`, `merge: false` and
  `strict`, every parser error and warning fatal (a duplicate key, several documents, an unknown
  tag, bad indentation), then a pass that refuses every tag (`!!binary`, `!!str`, `!foo`), anchor,
  alias, `<<` key and any key that is not a plain string, and only then `toJS` with `maxAliasCount:
  0`; problems are named `line L, column C`. Codes: `too-large`, `encoding`, `yaml`, `yaml-tag`,
  `yaml-anchor`, `yaml-alias`, `yaml-merge`, `yaml-key` and `too-many-problems`. A spec file is read
  by `readBounded` (`src/spec/bundle.ts`) only as a regular file, without following a link or
  waiting on a pipe, and never beyond 2 MB plus one byte (`not-a-file` for anything but a regular
  file). `formatSpec` writes YAML that reads back unchanged
  (for step 2's converter output).
- **The validator** (`validateSpec(value, {origin})`): every problem as `<path>: <message>` with a
  code. Errors: the shape (`format`, `type`, `required`, `empty`, `refused-field` for `__proto__`,
  `constructor` and `prototype`, `unknown-field` with a hint for `calledElement`, `id`, `key`,
  `x`/`y`, `condition`, a top-level `name` and the fields of other node types, `value`), ids and
  references (`source`, `duplicate-source`, `reference`, `duplicate`), triggers (`message`,
  `signal`), flows (`duplicate-flow`, `message-flow-pool`, `message-flow-end`), the tool fields
  (`external-id`, `url`, `hand-tool-id` in a spec the agent writes, `too-long`, `external-path`,
  `file`), the derivation (`derived-required`, `converter-derived`, `derived-kind` with its own
  texts for `converted` and `export`, `llm-model`, `derived-from`), the sizes (`too-many-nodes`,
  `too-many-flows`, `too-many-parts`, `too-many-problems`), in a spec the agent writes
  `lane-required`, `start-incoming` and `end-outgoing` (in converter output warnings, rendered as
  given), and per folder `duplicate-model` (one tool path or tool id twice). Warnings:
  `text-truncated` (200 characters for labels and keys, 2,000 for documentation), `note-truncated`
  (500), `no-flow`, `no-start`, `no-end`, `empty-lane`, `no-lane`, `model-name` (the name analyzr
  will show when the spec has several processes). An echoed value is cut at 80 characters.
- **Ids** (`src/spec/ids.ts`, §3.4 rule 2, decision 30): `<Prefix>_<source>` for a safe source, else
  `sanitizeId`'s form (imported unchanged); the prefixes `Process`, `Participant`, `Lane`,
  `LaneSet`, `Event`, `Activity` (every task kind, subprocesses and calls), `Gateway`,
  `DataStoreReference`, `Flow`, `MessageFlow`, `Message`, `Signal`, `DataInputAssociation`,
  `DataOutputAssociation`, `Property`, and `Definitions_`/`Collaboration_` from the key; composites
  from bodies, never raw sources (`Flow_<from>_<to>`, `LaneSet_<process>`); at most 255 characters,
  a longer id cut and ended with `_<shortHash>` (a pinned copy of `capped`); unsafe sources or
  message and signal names that come out alike each get the hash, a safe source never changes; a
  final pass in a fixed order (containers, sourced, derived and named ids, DI ids last) gives a
  clash `_<hash>`, then `_2`. Besides `<id>_di`, the `<id>_label` and `<id>_plane` of every element
  id are taken, as bpmn-js registers labels and drill-down planes under them. `id-rewritten` counts
  every source whose id is not `<Prefix>_<source>` and every id the final pass changed.
- **The layout** (`src/spec/layout.ts`, ported from `eval/tools/lib/layout.mjs`): per process,
  cycles broken by DFS in id order, longest-path layers, slots for long flows, rows per lane where
  the item on the longest remaining path keeps the row (ties to real nodes, then the smaller id);
  columns and rows sized to their largest shape, gaps and lane paddings grown for event, gateway and
  flow labels; orthogonal edges bending in the column gaps, vertical exits only from a split and
  vertical entries only into a join, back-edge loops planned per row and side on their own tracks,
  self-loops round the free side, flow labels in the column gap after their source's column; pools
  stacked in list order with equal width (at least 600), lanes tiled in list order, converter nodes
  without a lane in an unlaned band at the bottom (no lane invented), data stores below the lane of
  their first user, orthogonal data associations; message flows vertical, bending next to the source
  pool, detouring through the corridor left of every pool's first column where they would cross a
  shape; integer coordinates; at most 100,000 slots (`layout-too-large`).
- **The renderer** (`src/spec/render.ts`, `check.ts`, `moddle.ts`): bpmn-moddle without extensions;
  `exporter="analyzr-spec"` without `exporterVersion`, no timestamps or modeler attributes, every
  process `isExecutable="false"`; nodes, flows, message flows and data stores in id order, and
  processes, participants and lanes also written in id order while the drawing keeps their list
  order; event definitions without expressions, `messageRef` and `signalRef` only to a named message
  or signal; a call a collapsed `bpmn:subProcess` named after its target with `link-unresolved` 1;
  every text through copies of bpmn-facts' `sanitizeLine` and `sanitizeBlock` plus U+FFFE, U+FFFF
  and lone surrogates removed, cut as the validator warns. The self-check refuses a render on any
  bpmn-moddle warning, an unsafe, over-long, duplicate or `_label`/`_plane`-clashing id, an element
  bpmn-js draws with no DI, two or the wrong kind, a `callActivity` or a `calledElement`; a render
  over 5 MB or 50,000 elements is refused too (`RenderError`: `self-check`, `too-large`,
  `too-many-elements`, `layout-too-large`).
- **The commands** (`src/cli/analyzr-spec.ts`, run from source until 0.1.4; exit 0, 1 when the work
  fails, 2 on a usage error): `validate <spec file or folder>` (`*.spec.yaml`, `*.spec.yml`,
  `*.spec.json` below a folder, or one file of any name, as specs the agent wrote); `render <spec>
  <out.bpmn> [--key] [--origin hand|converter]` into a new `.bpmn` file; `plan <spec folder>
  --workspace --system …` with `normalize-bpmn plan`'s flags, the keys from `source.externalPath`
  (and `externalId`), the specs' tool folders and archive-like folders, and `replaces-known-model`;
  `bundle <spec folder> --workspace --system --out …` into an empty folder, every confirmed key's
  model at its path, a failed model listed under `failed` with exit 1 and the others written.
  Refused: an output in the spec folder, below the `exports/` of the workspace the input or the
  output lies in (the folder with `analyzr-workspace.json`), or inside a checkout; a folder without
  specs (`no-specs`), with invalid specs (`invalid-specs`), with a converter run's record
  `analyzr-specs.json` until step 2 (`run-record`), with `as-told` specs until S6, with unconfirmed
  keys (`keys-unconfirmed`), or a non-empty `--out` (`bundle-not-empty`).
- **The bundle**: the manifest names the importer `analyzr-integrate/analyzr-spec` 0.1.0
  (`ANALYZR_SPEC_VERSION` in `src/spec/version.ts`), `systemVersion` null, and per file `derived`
  `{kind: reconstructed, converter: null, llmModel, from: []}` and the losses `id-rewritten`,
  `layout-generated` (every DI shape, pools and lanes included), `link-unresolved` and
  `text-truncated`, summed and sorted by code; it passes the contracts' `ImportManifest`.
  `--json-out` adds per file the calls with their targets, the notes, `textTruncated` as a sorted
  list of `{element, field}`, the processes, messages, signals, black-box participants, nodes by
  type and the layout's counts. `src/bundle.ts` and `src/keymap.ts` gained type-only widenings
  (`ManifestFile.url`, `derived.kind` with `reconstructed` and `as-told`, `llmModel` a string, open
  loss codes, the importer name, `PlanFlag` `replaces-known-model`), which change no bundled byte.

Deviations from the plan, with reasons:

- **`render --origin hand|converter`**, so converter output can be rendered for checks before step 2
  exists.
- **Processes, participants and lanes are written sorted by id too**; the drawing keeps their list
  order. The plan's test "reorder lanes: only DI bytes change" needs it.
- **The layout goes beyond the eval layouter** (above): vertical exits only from splits and entries
  only into joins (a join's exit ran along its entries), the message-flow corridor (a message flow
  ran through an unrelated start event), self-loops, orthogonal data associations (eval draws
  diagonals), and after the review flow labels in the column gaps, loops planned per row and side,
  and the slot limit.
- **Limits the plan did not set**: the node, flow and part counts, notes at 500 characters, a tool
  path without empty parts or control characters, a link taken as written, echoed input at 80
  characters, and the file read guard. They keep the layout bounded and the declared value equal to
  what analyzr stores.
- **Modules the plan did not list**: `spec/moddle.ts`, `spec/guards.ts` (`assertWritable`'s message
  names "the export", and spec folders need the `exports/` rule) and `spec/compact.ts`.
- **`replaces-known-model` in three cases** (after the review): a key with a tool id; a key without
  one unless the system's last written plan came from this spec folder (`plan --write` records it as
  `lastExport`, `specs/<folder>`); a new key analyzr already has. The plan's "`known` or `moved`"
  flagged a re-plan's own keys. The plan's `moved` case cannot occur: a spec the agent writes has no
  tool id, so the plan matches it by path only.
- **The `<id>_label` and `<id>_plane` rule** (after the review): bpmn-js registers a label and a
  drill-down plane under these ids, so an element named like that lost its label or failed its plane
  in the browser.
- **`layout-generated` counts every DI shape**, pools and lanes included.
- **The eval `checkDi` restatement runs in `spec-layout.test.ts`**, not in `spec-bpmnjs.test.ts`;
  bpmn-js in vitest needed no `server.deps.inline`, only a type shim for its CommonJS and ES module
  forms.
- **No golden of a reference example yet**: `reference/analyzr-spec.md` comes with step 4.
  `RENDER_OUTPUTS['0.1.0']` was replaced once, before any commit, when the review round's layout
  fixes changed four goldens (HANDOFF §4).

The review round (renderer, security, tests): 25 distinct findings, 3 of them major, 24 fixed (in
one a sub-point rejected), 1 in part. Major and fixed: an element id ending in `_label` or `_plane`
clashing with the ids bpmn-js derives (above); a valid spec of 5,000 nodes with long flows that ran
out of memory in the layout (now refused in 0.2 s as `layout-too-large`; 5,000 nested back edges
render in 3.4 s and are refused as over 5 MB); and `render` writing into a workspace's `exports/`.
Fixed among the minor findings and nits: flow labels covering shapes; facts pins too thin (now
with element ids,
documentation, lane members, data store readers and writers, message and signal names and message
flow ends); a re-plan flagging its own keys and `exists-in-analyzr` not flagged; `validate`
quadratic in processes (20,000 processes now 68 ms instead of 80 s, the part limit); the whole file
read before the size check; `counts.flagged` missing the new flag; messages echoing input at any
length; the self-check's rules untested one by one; untested validator messages; the harness
counting a label or plane entry as drawn; pool overlaps and integer coordinates unchecked; no lone
surrogate in the fuzz; the CLI's exit paths and the walker's refusal branches untested. Rejected: a
`moved` test for `replaces-known-model` (above). In part: the three fuzz loops stay in their files
(the S3c plan keeps D2 (a) and the layout checks in files of their own); every fuzz spec now also
renders shuffled. The fixer also found that problems after an invalid element were reported at the
wrong list index; each element now keeps its index.

Tests (`tools/integrate`, 332, 205 before): `spec-validate.test.ts` (every error and warning with
its exact message per origin, the YAML guards, the sizes, the zod-free copies of the manifest's
`externalId` and URL rules against the contracts), `spec-render.test.ts` (the 9 goldens byte for
byte, `RENDER_OUTPUTS`, the facts per golden, determinism: twice, shuffled lists, YAML against JSON,
reordered lanes and pools changing DI only, a renamed key changing the definitions and collaboration
ids only, a task refined to a send task or a call and an event changing direction keeping their ids;
the id rules, the sanitize copies against bpmn-facts, seven tampered renders each refused by its own
self-check rule, the limits; 200 seeded random specs through D1 and D3 (b)), `spec-layout.test.ts`
(the readability checks: no shape overlap, every shape in its pool and lane, axis-parallel edges and
labels inside their pool, no label over a shape, pool widths, no pool overlap, integer coordinates;
eval's DI rules; lane order and the unlaned band; on goldens and fuzz), `spec-bpmnjs.test.ts` (D2
(a): bpmn-moddle without a warning and bpmn-js's `BpmnTreeWalker` with a handler that applies
`BpmnImporter`'s refusals, every drawable element drawn exactly once, every id bpmn-js registers
unique; negative cases), `spec-bundle.test.ts` (the manifest against `ImportManifest`, `as-told` and
the run record refused, keys from `keymap.json`, the file reader (a sparse 3 GB file, a pipe and a
link never read), two specs of one model, the folders and `replaces-known-model` in each case,
inventory coverage, where it writes) and `cli.test.ts` (the entry's usage and exit codes,
`validate`, `render`, `plan`, `plan --write`, `bundle` with a failed model, `plan --from-analyzr`,
and the copies of `plan-args.ts` against `normalize-bpmn`'s); Playwright
`apps/web/e2e/spec-render-import.spec.ts` (new: Vite serves `e2e/spec-harness`, no analyzr server;
`NavigatedViewer.importXML` on every golden and 50 seeded random renders that
`tools/integrate/test/spec-fuzz-write.ts` writes into a temporary folder; 0 warnings, 0 errors,
nothing missing, counts only).

What it costs and leaves open. Every gate green (integrate 332 (205), server 1,804, web 663, CLI 286
plus 7 skipped, contracts 178, bpmn-facts 200, eval/tools 108, relations 91, agent-sim 57,
procedures 37, demo 27, notices 9, client 4; dependency-cruiser 150 modules, no violations; the eval
reports unchanged; `generate` followed by `git diff --exit-code plugins/analyzr-integrate` clean).
`yaml@2.9.1` (ISC) and the devDependency `bpmn-js@18.31.0` joined `tools/integrate`: importer
entries only in the lockfile, `THIRD-PARTY-NOTICES.md` unchanged. Live-run neutral. The harness spec
ran in the implementing agents' run and again in the fix round's, 2 of 2 each (the goldens and 50
random renders), and the fixer imported 400 random renders in Chromium, all clean; the lead's run:
Playwright 113 passed and 21 skipped on a scratch stack (step 5's tests plus the harness spec's 2),
the UI load unchanged, the demo check 152 of 152, `demo.spec.ts` 14 of 14. The readings the owner
may overrule are in HANDOFF §4 ("Taken during M6 S3c step 1"). Open:

- **The integrate skill does not use it yet**: `analyzr-spec` is not bundled before 0.1.4, so
  consultants still get the report-and-stop for other formats.
- **Cosmetic, not flagged by any check**: a message flow from a node can cross shapes of its own
  pool below that node (from the eval layouter), and a task name near 200 characters overflows its
  fixed 100 × 80 box in bpmn-js.
- **The `model-name` warning** approximates the first process by id without collision suffixes; the
  renderer's summary is exact.
- **Rules on reconstructed models**: until the safeguard of decision 30 (2), an owner's agent rule
  can accept relations and placements on models a bundle declares `reconstructed` (§3.10).

Left: steps 2–4 of S3c (the converter runner, the CLI core, the integrate plugin 0.1.4), then the
safeguard of decision 30 (2), then S6; after the owner's live runs S5b, S7 and facts v2.

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
are shown read-only (decision 24.8). Live-run neutral: `FindingKind`, claim inputs, MCP tools,
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
  offene Entscheidung“, not „1 offene Entscheidung“. The list orders questions first, the value
  chain's findings after them (the owner's answer of 2026-10-16, below) and the informational
  items (`summary-note`, `descriptive-model`) last, each group by `unlocks` descending, then
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

**Taken by the implementing agent, then changed by the owner:** S4 let chain findings rank like
every other question, by `unlocks`. On a freshly seeded project 44 of the 64 items are
`process-without-step` (32) and `step-without-process` (12), correctly so while nothing is
placed; they shrink as placements are accepted, and the filter Quelle
(`source=value-chain-finding`) separates them. The agent proposed ranking them below the other
questions as a change to the sort key only. **Owner answer 2026-10-16** („ja mach weiter“ to
that proposal): value chain findings (source `value-chain-finding`: `process-without-step`,
`step-without-process`, `unresolved-link`) rank after every other question and before the
informational items (`summary-note`, `descriptive-model`); within each group the order stays
(`unlocks` descending, then subject, kind and id). Delivered with S5a as a change to the sort key
only: `rankGroup` in `open-questions/model.ts` gives the group (0 questions, 1 chain findings, 2
informational items), the cursor keeps its shape `[int, int, string, int, string]` with the group
as its first number, the tab's intro and the Markdown export's header say the order („…,
Befunde der Wertschöpfungskette danach, Hinweise zur Information zuletzt.“), and the server's
unit tests, the CLI's e2e test and `e2e/open-questions.spec.ts` pin it.

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

**S5a as delivered** (2026-10-17, branch `feat/integration-and-gaps`; every gate green, with a
review round's fixes): the append-only table `open_question_answer` (migrations 0011, generated,
and 0012, its append-only and no-truncate triggers; a composite foreign key from a note answer to
its relation's or placement's assertion through generated `relation_id`/`placement_id`, checks:
humans only, text or note by subject type, text 1–2,000 characters, the id pattern), the pure
`apps/server/src/domain/open-questions/answers.ts` (where the text lands, the check of a sheet's
rows) and the answer use cases in `use-cases/open-questions.ts` (permission `review`, humans
only, `human-decision-required` with the tab's `reviewUrl`; a note answer goes through
`recordRelationNote` or `addPlacementNote`, every answer gets an `open_question.answered` event
without free text), the routes `POST …/open-questions/{q}/answers` and `POST
…/open-questions/answers?dryRun=` (read-only demo: `demo-readonly`), `state` and `answers` on
every item, the latest answer and its kind in the CSV and every answer in the Markdown, the
zod-free `@analyzr/contracts/open-question-csv` (the sheet's reader, shared by the server's
export, the CLI and the web) and `@analyzr/contracts/personal-data` (the warning check),
„Beantworten“ in the tab and the model view's section, „Antworten aus CSV übernehmen“ with a
preview, and `analyzr questions answer <id> --text [--kind]` and `--from <csv> [--dry-run]`.
Live-run neutral: the claim inputs of a freshly seeded project are pinned by SHA-256
(`claim-golden.test.ts`), also after a text answer on every subject that is neither a relation
nor a placement; no claim input format, procedure, plugin, judgement basis, queueing, auto-accept
safeguard, `FindingKind`, MCP tool or prompt, fact, stage, recording or report changed.

Deviations from §4.5 and choices the spec left open (after the review round):

- **A held placement is not made due by an answer.** §4.5's table first said a placement answer
  makes the process due; that holds for an agent's question on a proposed placement only. A held
  placement homes its process (`processHomes.held`), so it stays not open: no agent gets it until
  the reviewer decides the hold (the table above now has both rows;
  `placement-pipeline.test.ts` pins `due` unchanged and `requeue` `nothing-due`). The dialog, the
  CLI and the route descriptions say it by the item's kind.
- **`unchanged` means identical to the item's latest answer** (kind and text), the one the list
  and the export show as current; going back to an earlier answer records it again. A sheet row
  with an empty `Antwortart` (also a sheet without the column) whose text equals the latest
  answer is `unchanged` whatever the latest kind, so a re-saved export records nothing twice.
- **Texts are normalized before they are compared and stored** (`normalizeAnswerText`: LF line
  breaks, Unicode NFC, trimmed), on both routes and in the CLI's own checks; `Antwortart` cells
  are compared in NFC as well.
- **Sheets are UTF-8 only, in the CLI and the web**: the web decodes the file's bytes with a
  fatal UTF-8 decoder and refuses an ANSI sheet (German Excel's „CSV (Trennzeichen-getrennt)“)
  before sending anything, since a stored answer cannot be corrected.
- **Rows keep their spreadsheet numbers**: the parser counts every record, blank ones and the
  header included, and both clients send only the filled rows and map the server's positions
  back, so a full export with more than 5,000 questions imports when at most 5,000 are filled.
  After storing, the web keeps the dialog open while rows were left out and lists them with
  their texts.
- **A note holds the text only**: the kind stays in `open_question_answer`; the dialog asks for a
  text that stands on its own.
- **The personal-data check** also finds `089 / 12 34 56`, `030 - 123456` and `030 – 1234567`,
  and no longer flags bare digit runs under 11 digits (SAP document numbers such as
  `0090001234`), `01` other than the mobile prefixes 015–017, or digits right after an id's
  label (`Sachkonto`, `Rechnung`, `Beleg`, `Prozess-ID` …). It warns, never blocks.
- **Value chain findings keep their id when they go away and come back** (§4.2): the answer is
  about the process or the step.
- **Both dialogs say that a stored answer cannot be changed or deleted**, as the CLI does.
- **A note answer writes two events**: the note's own (`relation.noted` or `placement.noted`, as
  the note use cases write it) and `open_question.answered`; the row's `seq` is the answer
  event's. The row has no `client_id` (the event carries it) and a `created_at`.
- **Writes take the project lock** and compute the items after taking it, as the neighbouring
  write use cases do; a sheet's dry run reads one snapshot without the lock. A sheet is one
  transaction: at most 5,000 filled rows and 4 MB per call (413 `payload-too-large` above), and
  both clients refuse a larger sheet before sending (the consultant splits it) instead of
  splitting it themselves.
- **No dry run for a single answer** (the single route has none): its personal-data warning
  comes with the stored answer, in the CLI after storing; the web dialog shows it live while
  typing. It never blocks.
- **`analyzr questions` has subcommands**: Commander lets a parent command take its options
  anywhere on the line, so the list's `-p` and `--kind` would have swallowed the answer's flags.
  `list` is the default subcommand, so `analyzr questions -p …` lists as before; `analyzr
  questions list` means the same, and `analyzr questions answer` records. The list marks answered
  items with `[answered]` and its summary ends with `, N answered`.
- **The CLI's `--kind`** takes `antwort`, `ausserhalb`/`außerhalb` and `ergaenzt`/`ergänzt`, the
  API values and the sheet's labels, ignoring case; an empty or unknown value is refused before
  any request. `--from` exits 1 when a filled row is (or in a dry run would be) left out as
  `unknown` or `invalid`, after printing; in a real run the other rows are stored. The CLI counts
  a warning's position from 1 and never echoes the matched text.
- **The web's file picker** is a German button („Datei auswählen“, then „Andere Datei
  auswählen“) over a hidden input, since Chromium's native one is English; after saving, the
  focus returns to the item's „Beantworten“, or to the count when the Status filter „Offen“
  removed the item. An item with answers says „Schon beantwortet. Deine Antwort kommt hinzu; die
  bisherige bleibt stehen.“ (answers are append-only).

Verified (2026-10-17, after the review round, and again after the docs pass with the owner's
answer on the chain findings): `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint`
(dependency-cruiser: no violations, 132 modules), `pnpm -r test` with Testcontainers (server
1,446 in 69 files, web 373 in 35, cli 174 plus 7 skipped, contracts 155), `pnpm eval:candidates`,
`pnpm eval:replay`, `pnpm eval:placements` and `pnpm eval:descriptive` with `git diff --stat
eval/reports` empty; Playwright in Chromium against a server run from source on PostgreSQL in a
scratch compose project (database only, removed afterwards): `open-questions.spec.ts` 11 passed,
the whole suite 57 passed and 21 skipped (the demo walk and the screenshots)
([DEVELOPMENT.md](DEVELOPMENT.md) "M6 S5a (2026-10-17)"). `demo.spec.ts` passed 14 against a
demo image built before the review round (neither button appears on the demo). Not checked:
`demo.spec.ts` against an image with the review round's fixes, other browsers than Chromium,
screen readers.

**S5b "Answers re-judged"** (after the live runs unless the owner says otherwise, §10.5). Scope:
§4.5's relations basis and queueing, the one-time requeue at deploy. Done when: a note answer on
a held relation makes exactly that pair non-current and queues its origin model, whose next claim
assigns that pair and lists the others as `judged`; a placement answer queues the chain's task;
the deploy step queues exactly the origin models of pairs the new basis makes non-current; claims
of note-free seeded projects are byte-identical; recordings and `eval:replay` unchanged. Since
decision 25 it is about notes alone: outside marks queue nothing before S7 (from S7 on, a subject
note or an outside mark joins the bases and queues with this slice's mechanism, §4.6), and model
amendments need no S5b, since they re-queue through `facts_hash` (decision 17).

**S5c-1 "Actions"** (decision 25; live-run neutral; may land before the live runs). Scope: §4.8
a and b: `OpenQuestionAction` and `OpenQuestion.actions` in the contracts with the labels in
`@analyzr/contracts/open-question-labels`; the pure `actionsFor` (`open-questions/actions.ts`,
reading the chain findings' `state` and the expression rule), R1 and R1b in the read model;
items versioned by what they ask about (§4.2); `answered` as a live outside mark; the route `POST
…/open-questions/{q}/actions` (link, place, choose copy, outside; a link accepts a live typed
proposal through `decideRelation` before it writes a manual relation; the anchors of a pool's
flows) and `POST …/open-questions/{q}/answers/{a}/withdrawal`; the safeguard `competing-call`
counting accepted or held manual relations from a call element (`auto-accept/apply.ts`,
`preview.ts`); `AnswerOpenQuestionBody` without `kind`; the five-column CSV and the reader's
compatibility with S5a sheets; migrations 0013 (the relaxed check, the unique `(project_id,
id)`, `open_question_answer_withdrawal`) and 0014 (its triggers); the client regenerated; the
web: the action row on each item in the tab and in the model view's section, the pickers with
„Vorgeschlagen“, the inline decision panels, the one-click outside mark and „Rückgängig“ after
every action that wrote a manual relation or placement, „Im Modell zeigen“, „Verknüpfen mit …“ on
a collapsed subprocess in the model view, „Notiz hinzufügen“ instead of „Beantworten“, the sheet
dialog without `Antwortart`; the CLI: `analyzr questions list` with the primary action and the
suggested targets, `analyzr questions outside|link|place` with targets by ref, model key or
process name, `questions answer` without `--kind`; docs (DEVELOPMENT.md, CONCEPT §2's schema for
`open_question_answer`, CONCEPT §3 step 5's competing calls). Does not touch: BPMN bytes and
revisions, facts and `FACTS_VERSION`, `visibleFindings` and `FindingKind`, the claim input
formats, procedures, plugins, judgement bases, queueing, the other auto-accept safeguards, MCP
tools, prompts and snapshots, recordings and reports. Done when:

- a unit test over a fixture with every kind of the contracts (both `call-target-unknown`
  flavours, an engine-null FEEL `calledElement` offered no `amend`, named and nameless
  `message-partner-missing`, relation and placement holds and questions, `process-without-step`
  in each `state` (`held` dropped), `step-without-process` with a proposed placement,
  informational items) pins each kind's actions and its single primary;
- `link` from a `call-target-unknown` item writes one accepted `manual` relation with the German
  rationale from code, and the item leaves the list while „Befunde“ still lists the finding; with
  a live rule-tier or agent proposal to the picked target it accepts that relation instead and
  writes no manual one; a `black-box-partner` with two flows gets two relations in one
  transaction, directed like the flows, and a pool-to-pool flow and a collapsed-subprocess end
  anchor at their processes; an agent's proposal from the same call leaves the item listed, a
  link to another process of the same model ends it (R1);
- after a human linked call C → P with a manual relation, an owner's rule does not accept an
  agent's `call` proposal C → Q (`competing-call`, in a write, in apply and in the preview);
- `place` homes a `process-without-step` and a `placement-unsure` process (also on `@outside`),
  and the items leave the list;
- `choose-copy` accepts and rejects all or nothing (a stale version gives 409 and writes
  nothing), places the other copies on `@outside` when asked, records the note without a mark,
  and the item leaves the list (R1b); a new caller's proposal to a copy brings it back; the
  seeded dev project's count is pinned;
- `outside` records one row of kind `outside-landscape` with null text, the item turns
  `answered`, a second click is `unchanged`, the withdrawal opens it again, and marking again
  records a new row; a note and then `outside` records the mark; a note leaves the item `open`;
  stored rows of kind `answer` and `will-be-modelled`, and stored `outside-landscape` rows on
  relation and placement subjects, show as notes, every other stored `outside-landscape` row
  keeps marking;
- an outside mark and the ids of an exported CSV survive a change to another element of the same
  model (a re-import), a change at the subject reopens the item, and a re-judgement that
  replaces the coded no-link keeps an `external-partner` mark;
- „Rückgängig“ after `link` and `place` rejects what they wrote;
- the export has five columns; an S5a sheet with `Antwortart` reads as §4.8 b says, „Liegt
  außerhalb …“ on a relation item as a note;
- an agent token gets `human-decision-required`, the demo `demo-readonly`, a viewer sees no
  action, an item whose source changed gives 404, an action the item does not offer 422;
  `requeue` keeps permission `write`;
- Playwright: each action type in the tab and in the model view's section; the entry chunk stays
  under its ceiling;
- claims of a seeded project are byte-identical before and after an outside mark on every
  subject that is neither a relation nor a placement; MCP snapshots, recordings, `eval:replay`
  and every report unchanged; all gates green.

**S5c-1 as delivered** (2026-10-17, branch `feat/integration-and-gaps`; every gate green, with a review round's fixes): `OpenQuestionAction` and
`OpenQuestion.actions` in the contracts (labels in `@analyzr/contracts/open-question-labels`),
the pure `apps/server/src/domain/open-questions/actions.ts` (`actionsFor`, R1, R1b, what a `link`
writes or accepts, the rationales), items versioned by what they ask about (§4.2), `answered` as
a live outside mark with `role` (`note` or `outside-mark`) and `withdrawal` on every answer, the
routes `POST …/open-questions/{q}/actions` and `…/answers/{a}/withdrawal`, migrations 0013
(generated: the relaxed check, the unique `(project_id, id)`, `open_question_answer_withdrawal`)
and 0014 (its append-only and no-truncate triggers), `competing-call` counting manual relations
from a call element in the write paths, apply and the preview, `AnswerOpenQuestionBody` without
`kind`, the five-column CSV with S5a sheets still read, the client regenerated, the action row in
the tab and the model view's section (pickers with „Vorgeschlagen“, the review's decision panels
inline, the one-click outside mark, „Rückgängig“, „Im Modell zeigen“, „Notiz hinzufügen“),
„Verknüpfen mit …“ on a collapsed subprocess, and `analyzr questions outside|link|place` with the
list's primary action and suggested targets. The seeded dev project still lists 64 items (R1b
keeps its duplicate: calls towards the copies wait). Live-run neutral: the claims of a seeded
project are byte-identical before and after an outside mark on every subject that is neither a
relation nor a placement (`claim-golden.test.ts`); no BPMN byte, fact, `FACTS_VERSION`,
`visibleFindings`, `FindingKind`, claim input format, procedure, plugin, judgement basis,
queueing, MCP tool, prompt or snapshot, recording or report changed.

Deviations from §4.8 and choices the spec left open (after the review round):

- **R1 counts by direction, and never a `call` for a pool or an external partner** (recorded in
  §4.8 a "R1"). The literal "an accepted relation of any type" let an accepted rule-tier call into
  the process a pool's flow falls back to hide the pool, and a manual relation into a call
  activity hide its call target question. R1, the pickers' suggestions and `link` share one rule
  (`answersAt`).
- **A process picker's suggestion is a promise the link keeps.** The suggested target of a process
  picker is the process of a live proposal's other end; a link to it accepts every live typed
  relation from the anchor (in the link's direction) into that process instead of writing a
  manual relation next to it. The action carries them as `proposals` (target, relation, type,
  ends), so the preview names each („nimmt den Vorschlag „A“ → „B“ an“) and `analyzr questions
  list` prints them under the suggestion; it carries `exclude`, the processes of the anchors, so
  a pool's picker no longer offers the process that holds its flows (a link there was refused as
  `same-process`, now said in German with the names).
- **An `unjudged` pair counts as answered by an accepted relation of any type between its refs**
  (§4.8 a's table): a manual relation from „Paar verknüpfen …“ settles only its own pair key, so
  the pair stayed listed and a second click was `unchanged`. Read model only; judge-once still
  assigns the typed pair.
- **`place` on the step and process of an agent's proposal or a hold decides it.**
  `acceptManualPlacement` accepts an existing placement with that natural key; the action reports
  it as effect `decision` (no „Rückgängig“, which would have rejected the agent's proposal; the
  toast leads to the placement on the chain page), as it does for accepted relation proposals.
  `choose-copy`'s placements on `@outside` follow the same rule.
- **`competing-call` counts a manual relation only to another target.** §4.8 a and §7 record
  „accepted or held `manual` relations leaving a `call` element“; the code leaves out a manual
  relation to the same target as the call (an agreeing link is no second target, decision 19's
  „a call has one target“), so an owner's rule may still accept an agent's call that agrees with
  the human's link, and the „Regeln“ preview counts a human's later manual link to another target
  as a correction of the call. CONCEPT §3 step 5 says so; HANDOFF §8 asks the owner to confirm
  this reading.
- **„Rückgängig“ is all or nothing**: the relations a link wrote (a pool's anchors, a dynamic
  call's targets) are rejected in one bulk decision with their versions (`decideRelations`), the
  placement through `decidePlacement`.
- **„Link korrigieren“ opens the chain page at the step in view mode**, where the step's link
  shows as „nicht auflösbar“; its link editor is one click away in edit mode („Bearbeiten“), as
  every chain edit is (§4.8 a said "with its link editor").
- **The CLI names the places to undo or change**: each manual relation and each decided proposal
  as the review screen's URL on the server's origin, a placement as the chain page's
  `?placement=` URL; the web toast for a decided placement leads to the chain page.
- **Note-only kinds** (`unlabelled-boundary`, `undocumented-process` until S5c-2) say that the
  next import of the completed model ends them, not „ihre Aktion“; the tab's intro says „Die
  meisten Fragen haben eine Aktion …“.
- **Panels and forms**: the `decide` panel takes the focus and closes with Escape or „Abbrechen“
  (focus back on its opener) like the pickers; „Verknüpfen mit …“ on a collapsed subprocess keeps
  its button (`aria-expanded`, `aria-controls`), returns the focus to it and starts closed for
  another element; the dynamic call's multi-select says when it shows only the first 60 matches;
  the copy note and the subprocess note have the live personal-data warning, and an action's
  toast names what the check found in its note.
- **Not done**: the place pickers still list the process or step of a proposal waiting there
  (picking it decides that proposal, reported as above).

Verified (2026-10-17, after the review round, and again by a separate gate pass on the final
tree): every gate (`pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` with
dependency-cruiser, `pnpm -r test` with Testcontainers, `pnpm eval:candidates`, `pnpm
eval:replay`, `pnpm eval:placements`, `pnpm eval:descriptive`; `git diff --stat eval/reports`
empty; MCP snapshots unchanged; the gate pass fixed one type error in the CLI e2e test's own
types, nothing in the code); the entry chunk 208.0 KB gzip (ceiling 240 KB); Playwright in
Chromium against a server run from source on a scratch PostgreSQL: `open-questions.spec.ts` 21
passed (every action type in the tab, also „Link korrigieren“ and a requeue the flow now always
has, and in the model view's section, where steps' items never show), the whole suite 67 passed
and 21 skipped; `demo.spec.ts` 14 passed against a scratch demo image built from the tree (no
action on the demo) ([DEVELOPMENT.md](DEVELOPMENT.md) "M6 S5c-1 (2026-10-17)"). Not checked:
other browsers than Chromium, screen readers, 0013/0014 on a database that already holds S5a
answers.

**S5c-2 "Model amendments"** (decision 25 with the owner's answers 25.1–25.4 of 2026-10-17;
live-run neutral; may land before the live runs). Scope: §4.8 c: `applyAmendments`, `readAmendable`
and their checks in `@analyzr/bpmn-facts` (`src/amend.ts`), `AnalysisPort.amend` and
`AnalysisPort.readAmendable`; `model_amendment` and `model_amendment_withdrawal` (migrations 0015
with the unique constraints, 0016; typed id `mam_`); the amended revision (`RevisionSource.kind`
`amendment`, `upstream`, the plan in `amendments` on the head, its own `model.revised` event) and
ingest's `unchanged` against the uploaded and every amended hash; `planAmendments` and the
re-application in ingest with the concurrency token, revival included, and the shared tail
function; withdrawal (one, or all of a model; no revision on a deleted model); the kind
`amendment-conflict` and the source `amendment` with their actions; the amendments in
`ImportFileOutcome` and `PutModelResult`; the routes (`amendable` with its `ETag`, amendments
with dry run, cost, `partner` and `If-Match`, list, withdrawals, the change-list export with
`since`); the client regenerated; the web: the form at a question with „Sammeln“, the model
view's „Ergänzen“ with history, overlay, badge and both downloads (lazy), the mark in the models
table; the CLI: `analyzr models amend|pull`, `analyzr amendments list|export|withdraw`; docs
(DEVELOPMENT.md; CONCEPT §2 (`model_revision.xml`, "Hashes"), principle 3, §4 (canonical bytes,
the OKF layout's "head bytes, verbatim"), §5 (the PUT row, the events `model.amended` and
`model.amendment_withdrawn`) and §6 ("Principals and provenance"); ADR-0001's decisions 2 and 3,
whose header carries the amendment line since decision 25). Does not touch: the extractor and
`FACTS_VERSION`, the rule tier's rules, `FindingKind`, claim input formats, procedures, plugins,
MCP tools, prompts and snapshots, recordings and reports. Done when:

- `applyAmendments` unit tests: C7 `calledElement` set and replaced; C8 `zeebe:calledElement`
  replaced and inserted (with and without `extensionElements`, after a `documentation`, into a
  self-closing start tag, without `xmlns:zeebe` on the root); engine null with and without a
  zeebe extension, as `Extraction.call` reads it; a message name set on a shared message (the
  other elements listed and changed) and created with its `messageRef`; a signal; a start and an
  end name; documentation inserted as the first child; on a Signavio-style fixture with vendor
  extensions and a default namespace the output equals the input outside the spliced ranges, byte
  for byte, BOM and CRLF included; values with `&`, `<`, `"` and line breaks escaped; an
  expression target (also an engine-null `calledElement="=x"`), a `camunda:caseRef` call, a
  duplicate id and a redeclared prefix refused; a check that would fail is reported, never
  written; two derivations from the same inputs give identical bytes; the golden C7 and C8
  fixtures keep the Modeler's child order;
- an amendment through REST makes an amended head whose facts read the value, whose `source`
  names the uploaded revision and the plan, on which the rule tier accepts a unique call
  (decision 9), and which queues the model's relations task; a manual link from the call to the
  same target is retired; a stale `If-Match` gives 412; the dry run writes nothing and names the
  findings it would resolve, the pairs to re-judge and a claimed task; a name picked with
  `partner` accepts the key-tier proposal; two endpoints of one message hold one live amendment; a
  review-only scope gets 403 `insufficient-scope`; a field no question names is refused („Nur für
  offene Fragen“);
- re-import: the same bytes are `unchanged` (also the downloaded amended file, also one downloaded
  before later amendments); a change elsewhere gives the uploaded revision plus an amended head
  with the amendment applied, the head with the highest seq, and `hashesAt` at a partner claim's
  `claimedSeq` after the import returns the amended head's `facts_hash`; an incoming value equal
  to `after` shows the amendment „im Quellsystem übernommen“, writes no amended revision when
  nothing else applies and re-applies when a later import brings back `before`; incoming
  documentation ends a `process-documentation` amendment's writing without a conflict; an
  incoming expression gives the conflict `expression` with the withdrawal only; any other value
  gives one `amendment-conflict` item whose „Wert aus dem Quellsystem übernehmen“ and „Meine
  Ergänzung behalten“ work; a removed element gives `element-missing`; with one conflict live, a
  new amendment on another element succeeds and leaves the conflict open; an amendment recorded
  while an import is being extracted is in the head after the import; the import and PUT results
  carry `amendments` only for models with live amendments;
- withdrawal writes an amended revision without it, with none left the uploaded bytes;
  withdrawing all of a model writes one revision; on a deleted model a withdrawal writes no
  revision and leaves `hashesAt` unchanged, and the amendment route answers 404; revival
  re-derives; the change list (Markdown, CSV) lists every state, groups per model and honours
  `since`; both downloads return the expected bytes;
- an agent token gets `human-decision-required`, the demo `demo-readonly`;
- Playwright: the form at a question with „Sammeln“, the model view's section with history,
  overlay and badge; the entry chunk stays under its ceiling;
- claims of a seeded project without amendments byte-identical; the corpus JSON of `analyzr
  import` and `seed --json` byte-identical; MCP snapshots, recordings, `eval:replay` and every
  report unchanged; all gates green.

**S5c-2 as delivered** (2026-10-17, branch `feat/integration-and-gaps`; every gate green, with a
review round's fixes): `applyAmendments` and `readAmendable` in `@analyzr/bpmn-facts` (`src/amend.ts`, on a
positioned element scan, `src/xml-elements.ts`), reached through `AnalysisPort.amend` and
`AnalysisPort.readAmendable`; `model_amendment` and `model_amendment_withdrawal` (migrations 0015
generated, 0016 the triggers; typed id `mam_`); uploaded and amended revisions with the plan on
the head, each with its own `model.revised`; the pure `apps/server/src/domain/amendments/`
(planning, the fields a human may set, derivation, effect and cost, the change list);
re-application at every import with the concurrency token, revival included, and the shared tail
function; withdrawals of one or all of a model; the open question `amendment-conflict` (source
`amendment`) with its actions; `amendments` and `uploadedRevisionId` in the import and PUT results
only for models with live amendments; the routes of tag `amendments` (contracts first, the client
regenerated); the form at a question with „Sammeln“ and its bar, the model view's „Ergänzen“ with
history, overlay, badge and both downloads (lazy), the mark in the models table; `analyzr models
amend|pull`, `analyzr questions amend` and `analyzr amendments list|export|withdraw`; the docs
(CONCEPT principle 3, §2, §4, §5, §6; ADR-0001 decisions 2 and 3; DEVELOPMENT.md). Live-run
neutral: no change to the extractor and `FACTS_VERSION` (`xml-scan.ts` only gains exports), the
rule tier's rules, `FindingKind`, claim input formats, procedures, plugins, MCP tools, prompts and
snapshots, recordings or reports; `claim-golden.test.ts` and the key shapes of the corpus import
and `seed --json` results unchanged.

Deviations from §4.8 c and choices the spec left open (after the review round):

- **The golden C7 and C8 fixtures are hand-written, not Modeler saves.** §4.8 c asks for golden
  tests against what Camunda Modeler writes for the same change, saved once into the fixtures; the
  inputs (`packages/bpmn-facts/test/fixtures/amend/c7-modeler.bpmn`, `c8-modeler.bpmn`) are written
  in the Modeler's layout, and the `*.amended.bpmn` files are `applyAmendments`' own output, so
  those two tests are regression snapshots (named so). What stands in for the Modeler comparison: a
  dependency-free check of the BPMN XSD's child order (`test/support/xsd-order.ts`: per BPMN element
  `documentation*`, `extensionElements?`, the rest; `definitions`: `import*`, `extension*`, root
  elements, `BPMNDiagram*`, `relationship*`), run over the snapshots and over the output of every
  Modeler-written corpus model of `_sample` and `nordwind-handel` with every field amended (no new
  break of the order; the holdout is left out). The implementing agent recorded that the review
  round's check with Camunda 7.24's XSD-validating parser passed the snapshots and the corpus
  outputs; that check is not in the repository, and the gate pass did not repeat it (no engine
  was started). HANDOFF §8 asks
  the owner for one Modeler save of each fixture to compare the child order with.
- **Files declared in another encoding than UTF-8.** `assertSafeXml` reads every file as UTF-8, so
  such a file holds ASCII only; Java parsers follow the declaration. `applyAmendments` therefore
  writes every code point above U+007E as a character reference in such a file (the declaration
  read from the text), and refuses a character beyond the Basic Multilingual Plane there
  (`unsupported-structure`), because the extractor's parser (saxen) decodes numeric references
  with `String.fromCharCode` and the check could not read it back.
- **A new message or signal goes before a trailing `relationship`** too (the XSD's order), not only
  before the first `BPMNDiagram`.
- **„Meine Ergänzung behalten“ only where the incoming value does not resolve** (§4.8 a, c): a call
  target naming no head process and no expression, or a name the endpoint asked about that pairs
  with nothing; never for a start or end name (a changed one is a label) and never for
  documentation. `amendable` counts only a live amendment the head applies as „a live amendment set
  it“; one in conflict or carried over by the tool sets nothing, so the model view cannot write over
  a value the tool changed either.
- **`unchanged` after a withdrawal that left nothing to apply.** §4.8 c lists "the content hash of
  every amended revision of the model" as analyzr's own output; a re-derivation that applied
  nothing has the uploaded bytes, so counting it would drop a later revert to that export without a
  signal. Only amended revisions whose bytes differ from their uploaded revision's count.
- **Withdrawals take an optional `If-Match: "r<headRev>"`** (checked under the project lock, 412
  `revision-conflict`; a header naming no revision never matches) **and a dry run**
  (`?dryRun=true`: what would end and the `cost` of the new head, nothing written). §4.8 c's "check
  `If-Match`" reads as required for amendment writes; for withdrawals it is optional so that a
  script withdrawing by id keeps working. The web sends the head its dry run showed, from the
  model view, the conflict actions and „Alle Ergänzungen … zurücknehmen“; `analyzr amendments
  withdraw` sends it with `--rev <n>`. Every withdrawal in the web asks first with the cost (as
  every save does), so „Wert aus dem Quellsystem übernehmen“ is no longer one click.
- **A name keyed by the message or signal itself is stored with an endpoint** (`via_element_id`:
  the first endpoint by id that references it), so its conflict question reads the incoming value
  at that endpoint and the change list names the element.
- **The conflict question names the field with its article and family** („Welcher
  Nachrichtenname gilt für die Empfangsaufgabe „…“ in „…“?“), shows the incoming value first, and
  the `withdraw-amendment` action of a `value-changed` conflict carries both values (`compare`),
  which the tab shows side by side above the actions, with „Meine Ergänzung behalten“ as a visible
  second button where it is offered. Endpoints are labelled by their BPMN type and family
  („Nachrichten-Zwischenereignis“, „Sendeaufgabe“) instead of „Nachrichten- oder
  Signalelement“, and `AmendableField` carries `typeLabel` and `fieldLabel`.
- **The change list names each element as the source tool knows it**: its uploaded revision's
  label, „ohne Namen“ when it has none, and its id („Endereignis ohne Namen (ID End_Auftrag)“; a
  message or signal name adds the message or signal and its id). Per model the Markdown lists
  „Zu übertragen“ (applied, conflict) before „Erledigt“ (in the source, withdrawn, superseded);
  the CSV writes raw values in „Vorher“ and „Nachher“ (an empty cell for none) and adds „Ziel“ (a
  call target's process) and „Zu übertragen“ (`ja`/`nein`).
- **`analyzr questions amend`**, not named in §4.8 c, runs an item's `amend` action from the CLI
  (the prefilled value for „Meine Ergänzung behalten“).
- **A stale `replaces`** (it names another amendment than the field's live one) answers 409
  `conflict`.
- **The CLI prints English** („amendments: 2 applied, 1 conflict“), like the rest of the CLI; §4.8
  c's „2 Ergänzungen angewendet, 1 Konflikt“ is the web upload panel's wording, which links to
  „Offene Fragen“ filtered by the model's conflicts.
- **Web details**: the model view's section shows only where this user can set a field or the
  element has a history („Ergänzungen“ when nothing can be set), and says where a field no
  question names is changed instead; the amended mark is a small pen on the shape's lower right
  corner, clear of the highlight labels; the collection's bar is opaque, its lists scroll, it
  checks against the model's current head and asks before the page is left; the cost sentence
  says what a pair is („Paare (mögliche Verbindungen zu anderen Modellen) werden von den Agenten
  neu beurteilt“), and why „Sammeln“ helps is said under the buttons; a call target shows as the
  process the human picked; the start events come before the end events in the form of
  „Start oder Ende ohne Namen“.

Verified (2026-10-17, after the review round, and again by a separate gate pass on the final
tree): every gate (`pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` with
dependency-cruiser, `pnpm -r test` with Testcontainers, `pnpm eval:candidates`, `pnpm
eval:replay`, `pnpm eval:placements`, `pnpm eval:descriptive`; `git diff --stat eval/reports`
empty; MCP snapshots unchanged; the gate pass changed no code); the entry chunk 211.0 KB gzip
(ceiling 240 KB); Playwright in Chromium against a server run from source on a scratch
PostgreSQL: `amendments.spec.ts` 5 passed and `open-questions.spec.ts` 21 passed, the whole
suite 72 passed and 21 skipped; `demo.spec.ts` 14 passed against a scratch demo image built from
the tree, and `analyzr-demo check` passed on it ([DEVELOPMENT.md](DEVELOPMENT.md) "M6 S5c-2
(2026-10-17)"). Not checked: other browsers than Chromium, screen readers, a Camunda Modeler save
of the two fixtures (HANDOFF §8), a Camunda engine deploying amended files (the repository's
tests check the XSD's child order only), 0015/0016 on a database that already holds models and
revisions (the migrations test's data holds none), the CI run (next push).

**S6 "Interviews".** Scope: §5 items 1–4 as skills and scripts; the skill text generator and the
German start prompts (§3.7). Does not touch: analyzr's core. Done when: a synthetic
`nordwind-handel` interview (written for this test, no personal data) yields a guide, a fact sheet
with valid citations and an as-told bundle whose dry run passes; the drift test covers the
generated texts.

**S7 "Gap release"** (after the live runs). Scope: §4.6, §4.7. Done when: `nordwind-gaps` is
scored by `eval:replay` for the sim agent; the owner's live gate passes for both procedures
with the new gap thresholds; `RELEASED`, `PLUGIN_RELEASES`, the plugin and the MCP snapshots are
updated as AGENTS.md describes. `analyzr-relations@0.3.0` also takes up the case S2c-1 created: a
unique static call from a derived caller is a candidate of basis `rule` (score 1;
`packages/relations` is unchanged) whose relation is only proposed (tier `key`, 0.9, source
`rule`). `relations.md` §4 describes basis `rule` as „a unique static call the rule tier
accepted“ and §8.9 item 1 says „leave it alone“, while §10 says to judge a `proposed` relation
like a candidate; such a pair is not settled, so a claim assigns it, and 0.3.0 should say to
judge it like any call proposal (support or no-link). The released `0.2.0` stays as it is; the
live runs use Camunda landscapes a human imports, where the case does not occur.

**Taken by this concept (the owner may overrule):** the gaps field (decision 24.4); the order of
§8 after the „erste Anfänge“, until the owner's review; models at the bundle root at their key's
path; ad-hoc converters emit specs only; no `derived.kind` `generated` until a skill produces
it; a manifest checksum mismatch warns instead of failing; dry runs with permission `read`;
`models delete` for the owner key only; every answer recorded in `open_question_answer`, its text
in a note where a relation or placement exists; S5a before the live runs; the answer kind „Liegt
außerhalb der Landschaft“ closes an open-question item but never dismisses a finding (M4 §10
keeps "dismissing findings" out); identical bytes keep their first provenance; `nordwind-gaps`
outside `eval/corpus`.

**Taken by this concept for S5c (decision 25; the owner may overrule):** the actions come from
the server with each item (`actions`, one primary at most, German labels from code), so the tab,
the model view and the CLI offer the same; a link accepts a live typed proposal to the picked
target and otherwise writes a `manual` relation accepted at once, with a German rationale from
code naming the question; one action route for the actions that need the item (link, place,
choose copy, outside), while decisions, requeue and the chain's link editing use what exists; R1
hides partner questions once each anchor has an accepted link to another process (not an agent's
proposal), and R1b hides a duplicate-id question once no call to a copy waits, both in the read
model only, never in `visibleFindings` or the claim input; items are versioned by what they ask
about, not by their model's `facts_hash`; `competing-call` also counts manual relations from a
call element (a tightening within decision 19's agreed design); a chain finding with a proposed
placement offers that decision, one with a held placement gives way to the `held` item; a note
no longer closes an item, only an outside mark (`answered`) or the item's own action does; the
outside mark is revocable through an append-only withdrawal, and every action that wrote a
relation or placement has an undo by rejection; the CSV drops `Antwortart` (five columns) and
still reads S5a sheets; „Gültige Kopie wählen“ decides the ambiguous calls, can place the other
copies on `@outside` (decision 18) and leaves no mark; a field is amendable only where a question
names it or where it is empty or unresolved; an amendment is written byte-preserving, never
through a bpmn-moddle round trip, refused unless the facts read exactly the intended change, and
deterministic in its bytes; a `message-name` amendment is keyed by the message or signal it
renames; values are stored sanitized; the uploaded bytes stay a revision and the amended head is
computed from them with the amendments the plan applies, the plan carried on the head, every
revision with its own event and the head always the revision with the highest seq; identical
uploaded bytes and analyzr's own amended bytes stay `unchanged`; at a re-import an amendment is
applied when the incoming value equals its `before`, counts as carried over (computed, never a
withdrawal) when it equals its `after`, and is otherwise a conflict question whose primary action
takes the tool's value; the tool's documentation always wins; amendments stay live through a
model's deletion, which writes no revision; amendment writes need `review` and `write`; the cost
is shown before every save; a manual link that an amendment's call or accepted message replaces is
retired; no new MCP tool, and agents see amended heads like any revision; S5c-1 before S5c-2, both
before S2. The v1 fields, the 24.2 extension, the re-import refinement and the treatment of
linked diagrams are the owner's (decision 25.1–25.4, §10.9), not taken here.

## 9. Out of scope

Bundled converters for AML, VSDX, ADOxx or Bizagi packages (until sample exports exist); MCP
`put_model` and model drafts; stored placeholders and agent findings as entities with a
lifecycle; assignees, due dates and notifications (decision 10, server mode R1); sync, prune and
watch; tool API pullers; a vision pipeline; facts v2 and reindex; a non-BPMN document store;
staged imports; project deletion and purging (§10.6); cross-project relations; a new pipeline
stage; OKF (deferred, decision 22; when it resumes, the proposal is that `models/<key>.bpmn` holds
the head, amended or not, with the uploaded revision named as its source, so the export shows
what the landscape analysis rests on); a BPMN modeler in the browser (the bpmn-js Modeler, every
element editable: rejected in decision 25.1, which chose targeted amendments, §4.8 c), and any
write-back or sync to the source tools (decision 7). Pictures and PDFs themselves are in scope: by
decision 30 (1) the session agent reads them with its own file reader and writes `reconstructed`
specs (S3c, §3.7 step 2); only an automated vision pipeline stays out.

## 10. Open questions for the owner

1. **Trust policy (amends decisions 9 and 19). Decided 2026-10-15 as recommended, with (a)
   (decision 24.2; the class and the rule tier delivered in S2c-1, the decision-19 extension in
   S2c-3, the list „Vor der Vertrauensregel angenommen“ in S2c-4 (2026-10-20), decision 28
   answered the S2c plan's open points, §3.10); only its last sentence stays
   open.** Calls in models that are not modelled (engine
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
2. **Agent summaries for reviewers. Decided 2026-10-15: shown read-only (decision 24.8).** Showing submission summaries in „Offene Fragen“ and the
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
   you let plain notes through. From S7 on, notes on other subjects and the outside marks of S5c-1
   join the bases too, and recording one (or withdrawing a mark) queues the affected tasks with
   the same mechanism (§4.6). May it change these rules, and may it land before your live runs?
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
9. **Model amendments: four points to confirm before S5c-2. Decided 2026-10-17, each as
   recommended (decision 25.1–25.4, §2):** „Ohne Prozess-ID, mit Doku“, „Ja, gilt als
   modelliert“, „Nicht überschreiben“, „Erst verknüpfen, Umbau später“. The questions as asked:
   1. **The fields.** Your chosen option named „Aufrufziel/Key, Nachrichtenname, Start/Ende-Name,
      Prozess-ID“. This concept (§4.8 c) leaves the process id out and adds the documentation of
      a process that has none. Process id: it is the anchor of every relation and placement at
      the process and the target of other models' calls; renaming one copy of a duplicate id
      sends its accepted relations and placements to `missing` until re-anchoring (R2), lets
      callers that meant it be accepted by decision 9 towards the other copy without anyone
      seeing it, and needs an id rewrite across the file. For the question „Prozess-ID mehrfach
      vergeben“ you get „Gültige Kopie wählen“ instead (the ambiguous calls decided in one step,
      the other copies optionally set to „außerhalb“ in the value chain), and the rename stays in
      the tool. Documentation: the question „Prozess ohne Dokumentation“ names it, and it is what
      agents read most to place a process; without it that question could only take a text
      note, the kind of answer you questioned. A field is amendable only where a question names
      it or where it is empty; values that already resolve are not replaced in v1. Recommendation:
      yes to both, in S5c-2; process ids later, with re-anchoring, if real landscapes need them
      (§6).
   2. **Amended call targets and the trust rule (extends decision 24.2).** Under 24.2 a call in a
      derived revision (no engine, for example a Signavio export) is only proposed. A call target
      you set by amendment was picked by a human from the landscape's processes, so the concept
      counts it as modelled and the rule tier keeps accepting it, whatever the uploaded
      revision's class, and leaves it off the list „Vor der Vertrauensregel angenommen“ (§3.10).
      Recommendation: yes.
   3. **Re-import, refining „solange das Element existiert“.** If the element exists but the tool
      changed the field since, the amendment is not written over the tool's value; it becomes the
      question „Ergänzung nicht mehr anwendbar“, whose main action takes the tool's value. If the
      tool now has the amendment's value itself, the amendment counts as carried over („im
      Quellsystem übernommen“) and is not written again; it applies again if a later export loses
      the value. Documentation from the tool always wins (§4.8 c). Recommendation: keep.
   4. **Linked diagrams in Signavio-style exports.** A link to another diagram arrives as a
      collapsed subprocess without `calledElement` (to verify, §10.4), which facts v1 do not see,
      so „Aufrufziel/Key“ in v1 covers call activities only and such links raise no question. (a)
      A further operation turns such a subprocess into a call activity with a `calledElement` (a
      byte-preserving rename of its tags, the planner treating the collapsed subprocess as the
      value before), plus a signal „Zugeklappter Teilprozess ohne Aufrufziel“ that reads the
      bytes, since facts v1 have no fact for it. (b) The model view links such an element with
      „Verknüpfen mit …“ from its process (a manual relation, already in S5c-1, §4.8 a), and the
      model itself is fixed in the tool. Recommendation: (b) now and (a) as a follow-up once a
      real or sandbox export confirms the shape (§10.4), so the operation is not built on an
      unverified assumption.

10. **Provenance of unchanged bytes (amends §3.3, raised by the S2a review). Decided 2026-10-20
    as recommended (decision 29 (1), §2), delivered in step 5 of S2b's follow-up the same day (§8
    "S2b follow-up step 5 as delivered"):** of the options (a) keep the warning
    `provenance-kept`, (b) the append-only identity row and (c) defer until a customer re-export
    shows the problem, the owner chose (b): the identity row per import and model as proposed
    below, as step 5 of S2b's follow-up, its own step after steps 1–4 (migrations 0021/0022), and
    before the first customer re-export; no re-analysis, `facts_hash` untouched. The question as
    first raised: Identical bytes
    stay `unchanged` and keep their first revision's provenance (§3.3, append-only). A folder
    moved in the tool leaves a Signavio export's bytes as they were, so after such a re-export
    `external-ids` and the change list keep the old tool folder, and a bundle imported first
    through the web (no manifest until the web's S2a part) can never get its identity recorded
    by importing the same bytes again with the CLI. S2a says so (`provenance-kept`, „provenance
    stored for 0; 6 unchanged keep what analyzr had“) and the skill prefers the CLI (until
    plugin 0.1.2: since UX8 the web sends the manifest too), but does not fix it. Proposal: record each import's declared identity per model in an append-only row
    (model, seq: system, tool id, tool folder, link), written also for unchanged files whose
    declaration differs; `external-ids`, the change list, „Herkunft“ and the identity warnings
    read the newest row, the revision keeps its first provenance, and nothing re-queues (facts
    and `facts_hash` stay untouched). Recommendation: yes, with S2b, before the first customer
    re-export.
11. **Rule acceptances on reconstructed models (extends decision 28 (1); raised by the S3c plan).
    Decided 2026-10-21 as recommended (decision 30 (2), §2, §3.10), as its own small server step
    after S3c and before S6:** an owner's agent rule (decision 19) may accept an agent's relation or
    placement proposal on any model, also one an LLM read from a whiteboard. The question as asked:
    „Sollen deine Regeln für Agenten-Vorschläge Relationen und Platzierungen an KI-rekonstruierten
    (und später „Aus Interview“) Modellen nie annehmen, wie es Entscheidung 28 (1) für Aufrufe schon
    regelt?“ Options: (a) a safeguard that blocks a rule when an endpoint's uploaded revision
    declares `reconstructed` or `as-told`, as a small server step before the first customer picture
    import; (b) keep it as it is, and the report says so. Recommendation: (a), after S3c and before
    S6, which brings `as-told`; until then the report says it (from plugin 0.1.4).
12. **Calls from ad-hoc converters, later. Open (decision 30 left it open).** §3.9 kept
    `calledElement` out of the specs of `adhoc:` converters until the owner decided §3.10, to be
    revisited with S2c and its decision-19 extension per converter; S2c is delivered, so a rendered
    call would now be a 90 % proposal anyway. S3c keeps its done-when: no spec yields a
    `calledElement`. The question: „Sollen Aufrufe aus Ad-hoc-Konvertern, deren Ziel ein Modell
    desselben Exports ist (über dessen Werkzeug-ID aufgelöst, nicht über einen Namen), später als
    echte Aufrufe geschrieben werden: nur als Vorschlag (90 %), gesammelt annehmbar?“
    Recommendation: yes, as a later step once a sandbox AML or Visio export (§10.4) shows how
    process interfaces and off-page links look; the renderer, not the converter's free text,
    resolves the target.

HANDOFF §8 "First users" is answered in part: the consultant works with the CLI and the skills
(24.1), and answering also works in the web UI (24.3), by action since decision 25. Manifest upload and preview in the web
follow decision 3. Whether Git/bpmiq.yml import moves earlier stays open.

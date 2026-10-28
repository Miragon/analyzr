# analyzr – Handoff (status as of 2026-10-28)

This file lets another person or AI agent continue analyzr without the original
conversation. It records **where we stand, what the owner decided, what is open and what comes
next**. Specs live in the linked documents; this file does not repeat them.

Owner: Dominik Horn (Miragon). Communication with the owner is in **German**; repository docs
and code are in English.

---

## 1. TL;DR

- analyzr is a **headless TypeScript store for BPMN process landscapes** in its own repository
  **`Miragon/analyzr`** (private at first, branch `main`, MIT; owner decision 23). Agents (any MCP
  client the operator chooses) analyse models and **propose** relations and value chain
  placements; **humans decide**. analyzr itself holds **no LLM credentials**.
- **Done:** concept (ADR-0001), test landscapes + eval toolchain, **M1** (skeleton: facts, rules,
  server, REST, MCP, local mode, CLI, web), **M2** (analysis pipeline, agent proposals, human
  review, simulation agent, `eval:replay`), **M4 preparation** (value chain concept + golden data),
  **M3 code** (the released procedure, claim input additions, the Claude Code plugin
  `plugins/analyzr`, reference setups in `examples/agents`, `analyzr seed --project`, `eval:live` and
  the live gate; dev-landscape validation of `0.1.0` with Sonnet: 3 runs, precision 100 %, no
  must_not_link), and **judge each pair once** (procedure `analyzr-relations@0.2.0`, the owner's
  requirement that no work happens twice: each pair is judged in one task, no-links are stored and
  shown to reviewers), and **M4 S0** (the value chain packages `@miragon/value-chain-*` 0.3.0
  consumed from npm: exact dependencies, the golden-chain validator on the npm schema-model,
  the dependency specifier guard with one locked version of each value chain package,
  `diagram-js` and zod v4, and the schema-model round trip in Node), and **M4 S1** (2026-10-09:
  the value chain tables with migrations 0006/0007, `recomputeStatus` generalised over the
  subject with relation behaviour pinned by a golden digest, step generations, the revision
  write path and the placement lifecycle as domain functions), and **M4 S2** (2026-10-09: the
  value chain and placements over REST, MCP and `analyzr value-chain push|pull`, the rule tier's key
  proposals, placements that follow model ingest and deletion, findings, server tiers with
  `baseline-prefix/1` in `@analyzr/relations`), and **M4 S3** (2026-10-09: the value chain page in
  the web UI: viewer and modeler in a lazy chunk, collision-free ids, overlays, placement review
  in the side panel, save with dry run, conflict and drafts, link editing, drill-down; the bundle
  guard, the import harness and the CSS check in Playwright), and **M4 S4** (2026-10-09:
  `eval:placements` with its committed report, `analyzr seed --value-chains`, German texts for the
  rule tier; with it **M4a is done**, `eval:placements` green in CI since the push of S4), and
  **M4 S5** (2026-10-09: the `placement` pipeline kind with judge each process once,
  the procedure `analyzr-placements@0.1.0` and the skill `/analyzr:placements` (plugin 0.3.0), the
  prompts `place_processes` and `draft_value_chain`, Import of a `.vc.json` on the chain page, the
  simulation agent's placement policy, placement recordings scored by `eval:replay`, the placement
  live gate; M4b's code is done, its owner actions are open), and **auto-accept rules** (owner
  decision 19, 2026-10-10: project rules the owner maintains in the new tab
  „Regeln“ or with `analyzr rules …` accept agent proposals of relations and placements up to a
  chosen confidence, recorded as the owner's decision with rule and revision; agents never see
  rules; off by default, never retroactive (apply with a dry run), conservative safeguards, a
  preview with the project's empirical precision, marks and filters in the review views for
  every reviewer, bulk, per-agent and single revoke; `eval:replay` gained the „Auto-accept
  what-if“ at 0.8/0.9/0.95; a review round's fixes are in, see §7), and the **public read-only
  demo** (owner decision 20, 2026-10-10:
  `ANALYZR_DEMO=readonly`, the demo image with the seed baked in, Fly.io
  configuration and deploy workflow, built and checked locally, a review round's fixes are in,
  Miragon's Impressum and privacy policy linked in the banner (decision 21); deployed and live
  on Fly.io (organization `miragon`) since 2026-10-10, as **https://analyzr-demo.fly.dev** since
  2026-10-12, issue [#1](https://github.com/Miragon/analyzr/issues/1)), and the **migration to analyzr**
  (decision 23, 2026-10-11: the new repository with a fresh history, every name renamed, also in
  the holdout files (blindly, §7 "Migration owner actions", step 0), MIT
  with `THIRD-PARTY-NOTICES.md`, version `0.1.0-alpha.0`).
- **Next:** the remaining owner actions of decision 23 (§7 "Migration owner actions": the rules
  on `main`, the MCP clients), then the **owner's live runs** of `analyzr-relations@0.2.0` and `analyzr-placements@0.1.0`, only in
  analyzr (`docs/M3-LIVE-RUNS.md`, steps 1–6 and 6a: 3 runs per landscape and model incl. the
  holdout), a chain drafted in Claude Desktop and rated, the holdout import check. After the live
  runs the owner chooses auto-accept thresholds from the what-if (§7 "Auto-accept rules"). The
  process network map (M5, owner decision 22) stays paused; M6 goes first (decision 24); OKF
  (the R1 export and **S6**) is deferred (decision 22).
- **In progress (2026-10-15):** **M6 "Landscape integration and gap analysis"**
  (`docs/M6-INTEGRATION-AND-GAPS.md`, branch `feat/integration-and-gaps`): the owner's wish for
  tools around analyzr that integrate customer landscapes from ARIS, Signavio, Visio & co
  quickly (skills, plugin, CLI, converters), for agents that say what is missing to build more
  links, answered by the consultant in the web UI too, and for interview skills (decision 24:
  M6 before M5, the trust policy, `tools/integrate`, summaries read-only). S0 (the concept), S1
  "Import hygiene", S3a `eval:descriptive` and S3b, the plugin `analyzr-integrate` v0, are done
  (M6 §8 "S1 as delivered", "S3a as delivered", "S3b as delivered"), and **S4 „Offene Fragen“**
  (2026-10-16: the open-questions read model over REST, the tab, the model view's section, the
  Markdown and CSV export and `analyzr questions`; M6 §8 "S4 as delivered"; since the owner's
  answer of 2026-10-16 the value chain's findings rank after the other questions), and **S5a
  „Antworten“** (done 2026-10-17, on the branch, with a review round's
  fixes: answers recorded in the append-only `open_question_answer`, migrations 0011/0012, one by
  one or from the returned CSV, in the web UI and with `analyzr questions answer`; note answers on
  relations and placements through the note use cases; live-run neutral; M6 §8 "S5a as
  delivered"). **Owner decision 25** (2026-10-17, after S5a): every open question is answered by
  an action (link, place, decide, „Liegt außerhalb der Landschaft“), text only as an optional
  note, and the consultant may fill in the fields a question names in the BPMN model (targeted
  amendments as amended revisions computed from the uploaded bytes, re-applied at every import,
  exported as corrected BPMN and a change list; no modeler), now, before S2 (M6 §2, §4.8).
  **S5c-1 "Actions"** (done 2026-10-17 on the branch, with a
  review round's fixes; M6 §8 "S5c-1 as delivered"): an action on every open question (link,
  place, decide, choose the valid copy, the revocable outside mark, requeue, fix a step's link),
  „Rückgängig“ after every manual relation, placement or mark an action wrote, notes without
  kinds, the five-column CSV, `analyzr questions outside|link|place`; no BPMN writing; live-run
  neutral; one refinement of decision 19's `competing-call` for the owner to confirm (§8).
  **S5c-2 "Model amendments"** (done 2026-10-17 on the branch, with a review round's fixes and a
  separate gate pass, every gate green; M6 §8 "S5c-2 as delivered"): the fields a question names set in the model as amended revisions
  computed from the uploaded bytes by byte-preserving splices, re-applied at every import (a
  value the tool changed becomes „Ergänzung nicht mehr anwendbar“), withdrawals, the cost before
  every save and withdrawal, the change list and both BPMN downloads, the form at a question with
  „Sammeln“ (removed in UX4) and „Ergänzen“ in the model view, `analyzr models amend|pull`, `analyzr questions
  amend` and `analyzr amendments`; live-run neutral; two points for the owner (§8: one Modeler
  save of each golden fixture, the optional `If-Match` on withdrawals). **S2a "Provenance,
  manifest, stable identity"** (done 2026-10-17 on the branch, every gate green; M6 §8 "S2a as
  delivered"): `analyzr-import.json` read by `analyzr import` (keys pinned, checked before
  sending, each batch's subset sent), typed provenance on the uploaded revision (an amended head
  follows `source.upstream`), PUT with the header `Analyzr-Manifest`, the import warnings
  `manifest-sha-mismatch`, `external-id-moved` and `external-id-changed`, `GET …/external-ids`
  and `analyzr models external-ids`, the stored extractor warnings (migration 0017) and the open
  question `extractor-loss`; live-run neutral. After the review: `provenance-kept` for unchanged
  bytes whose manifest declares another tool folder, an upload without a manifest no longer
  erases a declared identity, odd informational fields stored tidied (no 500 for a NUL or a lone
  surrogate), the manifest checked before `--create`, `next:` lines after the identity
  warnings, and the integrate plugin 0.1.1 (skill text only: the CLI reads the manifest, the web
  did not yet; it does since UX8). Its web parts („Herkunft“, badges, the manifest of a dropped
  folder) waited for the UI simplification the owner asked for on 2026-10-17 and came with UX8;
  the skill's key-map rebuild was left for the plugin's next version (0.1.2 in S2c-2 did not bring
  it; it came with plugin 0.1.3, step 4 of S2b's follow-up, 2026-10-20). Its one owner question, M6
  §10.10, is decided (decision 29 (1), 2026-10-20:
  an append-only identity row per import and model, as step 5 of S2b's follow-up, its own
  step after steps 1–4; delivered in step 5 the same day). **UX2a "Open questions: groups and
  totals"** (done 2026-10-18 on the branch, every gate green; UX-SIMPLIFICATION.md §7 "UX2a as
  delivered"): `group` on every open question (`ask` „Zu klären“, `agent`, `proposal`, `info`),
  the repeatable filter, `totals` and `askByModel`, the question first with its reason apart, the
  customer export in plain German with `ask` by default, `analyzr questions --group`; seeded
  `nordwind-handel` after the simulation agent: 21 to clarify; live-run neutral. **UX1 "Shell
  and Übersicht"** (done 2026-10-18 on the branch, every gate green, the UI load guard and every
  Playwright spec against a scratch stack; UX-SIMPLIFICATION.md §7 "UX1 as delivered"): four
  object tabs with their open work as the badge (Relationen 48, Wertschöpfungskette 29, Offene
  Fragen 21 on the walkthrough's state), „Hochladen“ a button, „Agent verbinden“ and
  „Annahmeregeln“ in the owners' menu „Einstellungen“, the tab „Befunde“ gone (its list behind a
  link), „Übersicht“ with „Als Nächstes“, „Agent starten“, the export hub, „Modell suchen …“, the
  phase chips and „Offene Punkte“, failed writes in German; web only, live-run neutral; the entry
  chunk 211.0 → 209.2 KB. **UX2b "Offene Fragen" in the web** (done 2026-10-18 on the branch,
  every gate green, the UI load guard and every Playwright spec against a scratch stack;
  UX-SIMPLIFICATION.md §7 "UX2b as delivered"): the tab shows „Zu klären“ as lean cards (21 on
  the walkthrough's state, the badge's number; 231 → 76 controls, 3,119 → 643 words, the first
  card at 575 → 246 px), one intro line with „So funktioniert es“, three filters, „Zur
  Information“ and „Erledigte zeigen“ closed, the agents' questions on their proposals (under
  „Art“ too), the export dialog for the customer („Zu klären“ by default, „Auch Fragen der
  Agenten“ on request), a hold answered in one dialog from its card, its „Vorgemerkt“ row and
  the review screen and decided with „Jetzt entscheiden“, the model view's „Fragen“ with „Zu
  klären“ only; web only plus one zod-free label, live-run neutral; the entry chunk 209.3 KB.
  **First wave review round** (2026-10-18, on the branch; UX-SIMPLIFICATION.md §7 "First wave
  review round"): an agent's coded no-link joins the rule tier's item about the same gap (one
  item per gap, read model only), a primary link always reads „Verknüpfen mit …“, the customer
  export holds the open items only and names no folder, handle or unattributed agent text, an
  answered hold leads with „Jetzt entscheiden“ and its answer shows on the review screen,
  „Offene Punkte“ is text with its split in a tooltip and counts held placements, the model view
  keeps the agent's summary closed (decision 24.8); the agents' no-links stay the view „Kein
  Zusammenhang“ until UX5 builds the decided foot link (Q12). **The first wave of the UI
  simplification is done** (2026-10-18, on the branch: UX2a, UX1, UX2b and the review round;
  every gate green, the UI load guard and the whole Playwright suite against a scratch stack, the
  demo walk against a scratch demo image, the screenshots retaken; DEVELOPMENT.md "UI
  simplification first wave (2026-10-18)"). **The owner's walkthrough** (2026-10-18, on
  `analyzr-local`; UX-SIMPLIFICATION.md §7 "Owner walkthrough"): „finde, das geht in eine gute
  Richtung“; one finding, fixed the same day: a question card opens its subject with a labelled
  button („Im Modell zeigen“, „In der Kette zeigen“, …) instead of a name one had to guess was a
  link. **UX7 „Hochladen“ and „Agent verbinden“** (done 2026-10-18 on the branch, every gate
  green, the UI load guard and the whole Playwright suite against a scratch stack;
  UX-SIMPLIFICATION.md §7 "UX7 as delivered"): the upload says what happened („5 Modelle
  importiert · 1 Fehler · 1 übersprungen“), what comes next (the waiting models with „Agent
  starten“, the questions there are already), why a file failed in German with its remedy (a
  UTF-16 file: bpmn-facts names the encoding, the server passes it on as `encoding`) and the
  skipped elements grouped by cause; the token form shows name and button, step 3 starts the
  agent; live-run neutral. **UX8 „S2a's web parts“** (done 2026-10-18 on the branch, every gate
  green, the whole Playwright suite against a scratch stack; UX-SIMPLIFICATION.md §7 "UX8 as
  delivered"): „Hochladen“ reads a dropped bundle's `analyzr-import.json` like `analyzr import`
  (pinned keys, the subset per batch, the identity warnings in German, an invalid manifest stops
  before sending), `Model.source` (REST only) gives the models table's chip and the project's
  subtitle („Aus Signavio · exportiert am 14.10.2026“), the model view shows „Herkunft“, the
  derived chip and „Beim Import übersprungen: 2 Elemente“; live-run neutral. **M6 S2b** (done
  2026-10-18 on the branch in three steps, every gate green; M6 §8 "S2b step 1–3 as delivered"):
  the recompute split into the pure `planRecompute` and its writer (pinned by a golden digest),
  the pure `importImpact` with the dry runs `POST …/imports?dryRun=true` and `PUT …?dryRun=true`
  (permission `read`) and `GET …/models/{m}/deletion-impact`, `analyzr import --dry-run` and the
  deletion impact in `analyzr models delete`, and the web's „Vorschau“ before „Importieren“; of
  the follow-up (judgements, tasks, placements, then their surfaces, the size of the agents'
  next run, the integrate plugin 0.1.3 and the identity rows) steps 1 to 5 are done (below);
  live-run neutral. **UX3 „Modellansicht“**
  (done 2026-10-18 on the branch, every gate green, the UI load guard and the whole Playwright
  suite against a scratch stack; UX-SIMPLIFICATION.md §7 "UX3 as delivered"): the shared canvas
  panel and header (an aside from 1024 px, below it a sheet collapsed to its handle, the canvas
  ending above it, so the bpmn.io watermark stays unobstructed), the tabs „Fragen (n)“ and
  „Relationen (n)“ filtered by a selected element, two-line relation cards, the crumb as the one
  way back, at most three chips and „Mehr“ (Herkunft, Revisionen, the downloads); the panel 10
  controls and 75 words on `vertrieb/order-handling` (37 and 515 before), „Gutschrift“ on a phone
  shows its name with the canvas at 86 %; web only, live-run neutral. **UX4 „Frage-Aktionen“**
  (done 2026-10-18 on the branch, every gate green, the UI load guard and the whole Playwright
  suite against a scratch stack; UX-SIMPLIFICATION.md §7 "UX4 as delivered"): a link and the
  amendment of the same gap are one entry („Ziel wählen …“, „Partner wählen …“) whose box „Im
  Modell eintragen (statt nur zu verknüpfen)“ sends exactly one of them (owner decision 26 Q5),
  ranked pickers („Vorgeschlagen“, „Passt vermutlich“, then by name), „Sammeln“ removed, the dry
  run inline above one „Speichern“ and „Agent starten“ in the toast after it, „+ Notiz“, the
  copies by path, the ghost button „Notiz“, the note dialog's texts per case; web only,
  live-run neutral. **UX5 step 1 „Relationen“** (done 2026-10-18 on the branch, every gate green,
  the UI load guard and the whole Playwright suite against a scratch stack; UX-SIMPLIFICATION.md
  §7 "UX5 step 1 as delivered"; Q6 and Q7 answered „ja“, decision 26 (5) and (6)): the views „Zu
  prüfen“, „Vorgemerkt“, „Gilt“, „Abgelehnt“, „Automatisch angenommen“, „Alle“, a status line
  only when something needs an action, „Vorschläge prüfen (n)“ with „n unauffällige annehmen …“
  (the key tier only, the count its selection, the flagged pairs under „Genauer ansehen“, then the
  rule offered), rows that lead with the processes and one link each, the no-links behind a foot
  link, the glossary's tier names; the first proposal at 297 px (620 before); web only, live-run
  neutral. **UX5 step 2 „Prüfbildschirm“** (done 2026-10-18 on the branch, every gate green, the UI
  load guard and the whole Playwright suite against a scratch stack, the screenshots retaken;
  UX-SIMPLIFICATION.md §7 "UX5 step 2 as delivered"): the review screen on the canvas pages' panel
  (a sheet on a phone with the way back and ‹ › above it, both panes from 1024 px), the panel in 93
  words with one closed „Verlauf“, a hold answered from the decision bar, the way back to „Offene
  Fragen“, „Automatisch angenommen“ as one status badge (Q6) everywhere; web only, live-run
  neutral. **UX6 step 1 „Wertschöpfungskette“** (done 2026-10-19 on the branch, every gate green,
  the UI load guard and the whole Playwright suite against a scratch stack, the chain's screenshots
  retaken; UX-SIMPLIFICATION.md §7 "UX6 step 1 as delivered"): the panel with one status line and
  „Platzierungen prüfen (29)“ at its top, „Zu prüfen“, one list „Ohne Schritt“ for the unplaced
  processes and the agent's doubts, the tree closed, the stage only when it asks for something
  („Agent gescheitert · Nochmal versuchen“, „3 Prozesse fällig · Agent starten“); the cards with
  one „Details“ and a held card answered through „Offene Fragen“; the header „‹ <Projekt>“, name,
  „Bearbeiten“, „Exportieren“; „nichts angenommen“ on 4 steps instead of 12; panel 75 words and 20
  controls (319 and 84 before); web only, live-run neutral. **UX6 step 2** (done 2026-10-19 on the
  branch, every gate green, the UI load guard and the whole Playwright suite against a scratch
  stack; UX-SIMPLIFICATION.md §7 "UX6 step 2 as delivered"): the chain on the canvas pages' panel
  (a sheet on a phone collapsed to „29 offen“, view-first; from 1024 px an aside the zoom group
  hides), the selected step outlined 4 px, labels scaled with the zoom, the palette's column free
  in edit mode, a double-click on an unlinked step zooming in place, the way back to „Offene
  Fragen“ after a decision; web only, live-run neutral. **UX9** (done 2026-10-19 on the branch,
  every gate green, the UI load guard and the whole Playwright suite against a scratch stack;
  UX-SIMPLIFICATION.md §7 "UX9 as delivered"; Q8 answered „Nur anzeigen“, decision 26 (7)): the
  result views of „Relationen“ in 56 controls (194 before) with „Weitere Filter“, „Entschieden von“
  and „Öffnen“; rule rows of „Aktiv“, „Bearbeiten“, „Mehr“ with a confirmation before enabling and
  a leaner dialog; the projects list with „Offen für dich“ and „Zuletzt geändert“ from the new REST
  route `GET /projects/{p}/summary` (`Project` and MCP unchanged); every UX slice is delivered.
  **M6 S2c-1 „The trust class and the rule tier“** (done 2026-10-19 on the branch, every gate
  green, the UI load guard and the whole Playwright suite against a scratch stack; M6 §8 "S2c-1
  as delivered"; decisions 24.2, 25.2 and 28): every uploaded revision stores its trust class
  (`source.trust`, set by the server: `modelled` for a Camunda 7 or 8 file uploaded with the owner
  key or the web whose manifest declares no derivation other than `export`, else `derived` with
  its reasons); the rule tier accepts a unique static call only from a modelled caller and
  proposes it from a derived one (tier `key`, 90 %, a German rationale), a call target set in
  analyzr counts as modelled, and
  revisions stored before S2c count as modelled; the dry run names these calls (`callsProposed`),
  and „Vorschau“, „Herkunft“, the system rule card and the CLI say so; `trust-kept` for unchanged
  bytes; no migration, live-run neutral (the corpus is all Camunda, imported by a human).
  For a landscape without an engine (a Signavio export) or uploaded with an agent token, its
  unique calls are proposals instead of being linked at once. **M6 S2c-2 „The fast path for
  derived calls“** (done 2026-10-20 on the branch, every gate green, the UI load guard, the whole
  Playwright suite with the new `trust-calls.spec.ts` and the demo walk against scratch stacks;
  M6 §8 "S2c-2 as delivered") makes that one bulk accept: „Gesammelt annehmen“ (after
  „Importieren“ and on „Übersicht“'s „Als Nächstes“), the system rule card's count „N aus
  abgeleiteten Modellen vorgeschlagen“ and the link `analyzr import` prints after such an import
  open the bulk dialog with exactly these calls selected (their own group „Eindeutige Aufrufe aus
  abgeleiteten Modellen“, `?bulk=calls`, at most 500 at a time), and one click accepts them before
  the agent runs, so the agent's claims skip those pairs and the agent judges only the truly open
  ones; a call an agent asks about or objects to is decided one by one and not counted. `analyzr import`
  says on stderr when an agent token (`ANALYZR_TOKEN` or `--token`) makes the calls proposals, and
  the integrate plugin 0.1.2 points the consultant to the dry run and to „Gesammelt annehmen“; no
  route, migration or MCP change, live-run neutral. **M6 S2c-3 „Rules for derived calls“** (done
  2026-10-20 on the branch, every gate green, the UI load guard, the whole Playwright suite with
  the new `derived-call-rules.spec.ts` and the demo walk against scratch stacks; M6 §8 "S2c-3 as
  delivered"; decision 19 as extended by 24.2 and narrowed by 28 (1)): an owner's auto-accept rule
  of the new „Art“ „Eindeutige Aufrufe aus abgeleiteten Modellen“ names one declared source
  („Export ohne Camunda-Engine“, „Konvertiert“ with one converter, „Ohne Angabe“) and accepts that
  source's unique calls in the very write that proposes them (imports, amendment writes and
  withdrawals, deletions; migration 0018), marked and revocable; no rule, an agent rule neither,
  accepts a call of a revision an agent token uploaded (stored since S2c-1; older revisions carry
  no class and count as modelled), and no write made with an agent token sets such a rule off;
  the owner's „Vorschau“ and `analyzr import --dry-run` name what the rule will take. For the
  first analysis: right after the first „Gesammelt annehmen“ the toast offers the rule for that
  source (`analyzr import` with the owner key suggests the same), and once it is on, the unique
  calls each later import of that source proposes are accepted without a click, before the agent
  runs (calls already waiting need `rules apply`); live-run neutral (no project has a rule, agents
  never see rule data). **M6 S2c-4 „Vor der Vertrauensregel angenommen“** (done 2026-10-20 on the
  branch, every gate green with a review round's fixes; M6 §8 "S2c-4 as delivered"; decisions
  24.2 (a) and 28 (3)): with it **S2c is complete**. The owner reviews, once per uploaded
  revision, the rule tier's acceptances from before S2c whose revision would be derived today
  (no engine; an agent token, or before S2a a service principal; a declared kind other than
  `export`): the system rule card's line „N vor der Vertrauensregel angenommen – prüfen…“ (owners,
  never in the demo) opens a dialog with one row per model, the dry run in one line, „Behalten“
  and „Zurück in die Prüfung“; `analyzr rules pre-trust` does the same with the owner key. The
  review is stored append-only (`revision_trust_review`, migrations 0019/0020, a database guard
  against reviewing a classified or amended revision) and read where a revision carries no
  class. For the first analysis: a landscape imported before the trust rule catches up without a
  re-import, one list and one decision per model; „Zurück in die Prüfung“ sends the calls straight
  to „Gesammelt annehmen“ (or an enabled rule for that source accepts them again in the same
  write), and „Behalten“ ends the question for good; Camunda landscapes a human imported list
  nothing, so it is live-run neutral. **M6 S2b follow-up step 1 "Agent work in the dry runs,
  relations side"** (done 2026-10-20 on the branch, every gate green with a review round's
  fixes; M6 §8 "S2b follow-up step 1 as delivered"; DEVELOPMENT.md "M6 S2b follow-up step 1
  (2026-10-20)"): every dry run (the import's, PUT's and the deletion impact) now names the
  relations tasks the write queues and cancels, a claimed one with its holder and the length of
  its assignment (`ImportImpact.relationsTasks`, REST only), the pairs agents then judge around
  the queued models (an upper bound while other models' tasks wait) and those judged again,
  planned with the write's own pure `planQueue`; the amendment cost counts the same way, against
  the relations as the write leaves them, and reports a claimed task only when the facts change;
  one zod-free merge (`@analyzr/contracts/impact-merge`) for the CLI, the web and, since step 4, the
  plugin; a prepared candidate index keeps a 50-file dry run on 496 models at about 1.1 s. For the
  first analysis: the server knows before an import how much agent work it sets off, repeats or
  destroys (the „Vorschau“, the CLI's lines and the plugin show it from steps 3 and 4), and the
  amendment form's number no longer counts pairs the amendment itself settles; no user-visible text changed yet, live-run neutral.
  **M6 S2b follow-up step 2 "Placements in the dry runs"** (done 2026-10-20 on the branch, every
  gate green with a review round's fixes; M6 §8 "S2b follow-up step 2 as delivered";
  DEVELOPMENT.md "M6 S2b follow-up step 2 (2026-10-20)"): for a project with a live value chain
  the import's and PUT's dry runs and the deletion impact now also name the accepted placements
  whose process the write turns `changed` or `missing` (`ImportImpact.placementsChanged`) and the
  chain's placement task after the write (`placementTask`: `queued`, `open`, `deferred` while an
  agent holds it, `nothing-due`, or `not-triggered` for a layout-only upload or a deletion) with
  the processes due, newly due and placed again, REST only and absent without a chain; due-ness comes from the pipeline's own pure
  `pipelineInputs` over the head and the would-be head, with the rule tier's placement writes
  planned as the write records them (`planRulePlacements`; the plan's "no simulation" invariant
  did not hold) and one stored fact order (`domain/fact-order.ts`); about 20–30 ms more per
  50-file batch on 496 models. For the first analysis: before an import the server knows whether
  the placement agent must place processes (again) and how many, and which accepted placements
  lose or change their process; the surfaces follow in step 3; no user-visible text changed,
  live-run neutral. The e2e run found an older web race, fixed with it: an owner who clicked
  „Agent starten“ before their agent tokens had loaded got a toast and no popover (`RetryAgent`
  now opens it once the tokens are known).
  **M6 S2b follow-up step 3 "The surfaces"** (done 2026-10-20 on the branch, every gate green with
  a review round's fixes, 12 of 14 points fixed; M6 §8 "S2b follow-up step 3 as delivered";
  DEVELOPMENT.md "M6 S2b follow-up step 3 (2026-10-20)"; UX-SIMPLIFICATION.md §6): the agent work
  of a dry run reaches the screens. The „Vorschau“'s last line names it, on a first import too
  („214 mögliche Relationen zu beurteilen (56 davon erneut), 7 Prozesse zu platzieren“, „etwa“ for
  more than one batch); a placements line and two lists in „Was ändert sich?“ (the placements
  losing their process, the pairs judged again); while the import cancels a relations task an
  agent holds, the warning „Ein Agent bearbeitet „vertrieb/auftrag“ gerade; seine Arbeit geht
  verloren.“ and a second click („Trotzdem importieren“; a double click arms only, also in the
  amend form and the action panel); the batch note says on a first import that the pairs between
  new models of different batches are missing from the number. `analyzr import --dry-run` prints
  `agent work: …`, the tasks it cancels with a `warning:` and the placements line;
  `analyzr models delete` lists the task cancelled, the placements losing their process and the
  processes made due, with the requeue hint once. For the first analysis: before „Importieren“
  the consultant sees how much agent work an import sets off, which it repeats and whether it
  destroys an agent's running work, so imports can be timed and batched without losing agent
  runs. Web and CLI only (no route, no migration, no contract change), live-run neutral; the
  readings taken are in §4 ("Taken during the M6 S2b follow-up step 3"); the e2e run: the full
  Playwright suite 111 passed and 21 skipped, the demo check 152 of 152, `demo.spec.ts` 14 of 14.
  **M6 S2b follow-up step 3b "The agents' next run"** (done 2026-10-20 on the branch, every gate
  green with a review round's fixes, 9 of 12 points fixed; M6 §8 "S2b follow-up step 3b as
  delivered"; DEVELOPMENT.md "M6 S2b follow-up step 3b (2026-10-20)"; UX-SIMPLIFICATION.md §7):
  the project summary counts the pairs the agents' next run will judge
  (`ProjectSummary.pairsToJudge`, REST only, contracts first): the distinct typed pairs the next
  claims of the relations tasks an agent may claim now (queued, or claimed with a lease that ran
  out) will be assigned, over the stored head, each once, without judged and settled pairs; a task
  whose lease runs counts not. „Als Nächstes“ names it beside „Agent starten“ or „Agent verbinden“
  („etwa 7.300 mögliche Relationen“) and in the waiting line („5 Modelle warten auf den Agenten ·
  etwa 7.300 mögliche Relationen“), so does the waiting text on „Hochladen“ after an import, and
  the CLI (`analyzr import`'s waiting line and `analyzr status`: `about 7300 pairs to judge`); the
  batch notes point there. It reads the candidates the open questions' read model already computes
  (the new `projectCandidates` of `@analyzr/relations`) and stays memoized per project state (now
  also until the earliest live lease runs out): on 496 models a rebuild costs 15–83 ms more, a
  memoized read nothing. For the first analysis: right after a first import in parts, and on every
  „Übersicht“, the consultant sees how big the agents' run will be, the one number a preview in
  batches cannot give, and can plan the agent run and its cost. MCP unchanged, live-run neutral;
  the readings taken are in §4 ("Taken during the M6 S2b follow-up step 3b"); the e2e run on the
  final tree: the full Playwright suite 111 passed and 21 skipped, the demo check 152 of 152,
  `demo.spec.ts` 14 of 14. Its first run found an older web race, fixed with it: a click on
  „Agent starten“ as the owner's agent tokens arrived was lost (`RetryAgent` now keeps one button
  element). **M6 S2b follow-up step 4 "The integrate plugin 0.1.3"** (done 2026-10-20 on the branch,
  every gate green with a review round's fixes: 25 findings fixed, 1 in part, 1 rejected; M6 §8 "S2b
  follow-up step 4 as delivered"; DEVELOPMENT.md "M6 S2b follow-up step 4 (2026-10-20)"; owner
  decision 29 (2)): the skill's pre-approved way to analyzr is the plugin's own read-only script
  `analyzr-read.mjs` (`models`, `external-ids`, `preview`: only `GET …/models`, `GET …/external-ids`
  and `POST …/imports` with `dryRun=true` built in, loopback hosts only, no redirects, no proxy,
  strict arguments; `ANALYZR_TOKEN` or the owner key file as the CLI finds it, never printed;
  results only into the workspace's `reports/`), pre-approved next to `inspect.mjs`. The skill
  previews an import itself into an existing project, exactly as `analyzr import --dry-run` sends
  it, and reports it in a section „Vorschau“ in the web's words (the agent work, the claimed-task
  warning, the batch notes) plus three lines of the skill's own from the plan, which the web lacks
  („Neue Aufgaben für den Agenten: …“, the advice „Warte am besten, …“ after the warning, „Ein Agent
  platziert gerade; …“), the agent work also in the „Kurzfassung“; `normalize-bpmn.mjs plan
  --from-analyzr` rebuilds a lost or stale `keymap.json` from analyzr's identities (the key rule
  inferred, a tool id on several keys kept by the key the map gives it or the oldest model, the
  others named as likely duplicate imports with `models delete`); `exporterVersion` is declared
  tidied without a new `NORMALIZE_BPMN_VERSION`. `RELEASES['0.1.3']`, `claude plugin validate
  --strict` passed, the notices unchanged; no route, migration or contract change, live-run neutral;
  the readings taken are in §4 ("Taken during the M6 S2b follow-up step 4"); the e2e run on the
  final tree: Playwright 111 passed and 21 skipped on a scratch stack built from it, test names and
  UI load numbers as in step 3b, demo check 152 of 152, `demo.spec.ts` 14 of 14, and the bundled
  `analyzr-read.mjs` with a read token on that stack (`lastSeq` unchanged). Not tried live (no LLM
  call): whether the pre-approval works as written, the owner's one live check in §8. For the first
  analysis: a consultant's first import of a big export goes through without duplicate models and
  with the agent work known up front, and the agent cannot import.
  **M6 S2b follow-up step 5 "The identity rows"** (done 2026-10-20 on the branch, every gate green
  with a review round's fixes: 8 findings, 6 fixed, 2 rejected; M6 §8 "S2b follow-up step 5 as
  delivered"; DEVELOPMENT.md "M6 S2b follow-up step 5 (2026-10-20)"; UX-SIMPLIFICATION.md §7; owner
  decision 29 (1)): an append-only identity row per import and model (`model_identity`, migrations
  0021 and 0022 with the triggers, a guard and the backfill of every declared uploaded revision;
  system, tool id, tool folder, link), written for every stored file a manifest lists and for an
  unchanged one whose declaration differs from the model's newest row (then with the internal event
  `model.identity_declared`, which holds no folder or link); `external-ids`, the identity warnings,
  the dry run's absent keys, the change list and „Herkunft“ („Im Quellsystem“ and „In Signavio
  öffnen“ from the new `Model.identity`, REST only) read the newest row; the revision keeps its
  first provenance and trust class, nothing re-queues, `facts_hash` untouched. The import and its
  dry run mark such a file `identityUpdated`: „Hochladen“ offers „Importieren“ for it with „Danach:
  Ort im Quellsystem für 6 Modelle aktualisiert“, the CLI says `6 unchanged keep their first
  revision's, 6 of them record a new tool id, folder or link`; `provenance-kept` now says only that
  the revision keeps its derivation (none declared counting as its own kind) and stays silent next
  to a `trust-kept` that names it. Contracts first, the client regenerated, no new route; plugin
  0.1.3, MCP and its snapshots, the procedures and facts untouched, live-run neutral; server 1,804
  tests, web 663, CLI 286; on 496 models the landscape read unchanged (232.4 → 230.5 ms); the
  readings taken are in §4 ("Taken during the M6 S2b follow-up step 5"); the e2e run on the final
  tree: Playwright 111 passed and 21 skipped, the UI load unchanged, the demo check 152 of 152,
  `demo.spec.ts` 14 of 14. For the first analysis: a re-export after a folder reorganization, or a
  bundle imported over models first uploaded without one, keeps analyzr's record of where each model
  lives
  current with the normal import and without re-analysis, so the key-map rebuild, the absent-key
  list and the change list stay right and no duplicate models arise.
  **Owner decision 29** (2026-10-20, §4): M6 §10.10 decided (identity rows, delivered in step 5),
  and the integrate skill's pre-approved preview a bundled read-only script, not a CLI pattern
  (delivered in step 4).
  **Owner decision 30** (2026-10-21, §4; each the recommended option) answers the S3c plan's
  questions: pictures and PDFs are read by the session agent itself with its own file reader into
  `reconstructed` specs (no vision pipeline, no LLM key in analyzr); a safeguard keeps owners' agent
  rules from accepting relations or placements with a `reconstructed` (later `as-told`) endpoint, as
  its own small server step after S3c and before S6; the bundled CLI `analyzr.mjs` bundles
  `apps/cli`, the client and the contracts, so every change there needs a new integrate plugin
  version; and A1–A5 as recommended (converters of interpretive formats declare `reconstructed`, no
  key and no name in the spec, category id prefixes, the converter runner in its own script
  `analyzr-convert.mjs`, the bundled CLI proposed without a checkout). Open: calls from ad-hoc
  converters later (§8).
  **M6 S3c step 1 "`analyzr-spec/1` and the deterministic renderer"** (done 2026-10-21 on the
  branch, every gate green with a review round's fixes: 25 findings, 24 fixed, 1 in part; M6 §8 "S3c
  step 1 as delivered"; DEVELOPMENT.md "M6 S3c step 1 (2026-10-21)"; decision 30): `analyzr-spec/1`,
  one strict YAML or JSON file per model without key or name (a `source` id per element; processes
  with lanes and data stores, starts, ends, tasks of six kinds, collapsed subprocesses, calls with a
  `target`, catch and throw events, four gateway kinds, flows, black-box pools and message flows;
  message and signal names only where the source names them), its validator (every problem with its
  path; a YAML reader without tags, anchors, aliases or merge keys; ids as strings; limits on size
  and counts) and a deterministic renderer to BPMN 2.0 with DI and without an engine
  (`isExecutable="false"`; ids `<Category>_<source id>` from one capped, collision-checked id
  function; the eval layouter's algorithm, independent of the order of nodes, flows and data stores
  (pools and lanes in list order); a call always a collapsed
  subprocess named after its target with the loss `link-unresolved`, never a `calledElement`; a
  self-check on every render), in `tools/integrate/src/spec/` with the entry `analyzr-spec.ts`
  (`validate`, `render`, `plan` with the new flag `replaces-known-model`, `bundle`), run from
  source: the integrate plugin stays 0.1.3 byte for byte, 0.1.4 comes in step 4. Checked on 9
  synthetic golden specs (renders, facts and `RENDER_OUTPUTS['0.1.0']` pinned) and 200 seeded random
  ones: no extractor warning and `engine` null (D1), no bpmn-moddle warning and bpmn-js's tree
  walker with its importer's refusals drawing every element once (D2 (a)), no `callActivity` and no
  `calledElement` (D3 (a), (b)); in Chromium the harness spec `spec-render-import.spec.ts` imported
  the goldens and 50 random renders without a warning, 2 of 2 in the implementing agents' run and
  again in the fix round's (D2 (b)).
  Integrate 332 tests (205), every other count unchanged; no server, contract, web product, MCP,
  procedure or plugin change, live-run neutral; the readings taken are in §4 ("Taken during M6 S3c
  step 1"); the lead's e2e run: Playwright 113 passed and 21 skipped on a scratch stack (step 5's
  tests plus the harness spec's 2), the UI load unchanged, the demo check 152 of 152, `demo.spec.ts`
  14 of 14. For the first analysis: landscapes that exist only as Visio, ARIS AML, PDFs or
  whiteboard pictures get one strict format and one renderer whose BPMN imports without a warning,
  draws in the model view at once and carries no guessed call link, the base on which steps 2–4
  bring them into analyzr in the same first pass as the BPMN exports.
  **M6 S3c step 2 "the converter runner"** (done 2026-10-21 on the branch, every gate green with a
  review round's fixes: three reviews (escapes, correctness, release and tests), every finding that
  held up fixed, none rejected, the one major a missing test, no working escape; M6 §8 "S3c step 2
  as delivered"; DEVELOPMENT.md "M6 S3c step 2 (2026-10-21)"; decision 30 (A1), (A4)):
  `analyzr-convert` with `convert`, the only script that runs code an agent wrote, in
  `tools/integrate/src/spec/` with the entry `src/cli/analyzr-convert.ts`, run from source until
  plugin 0.1.4 (0.1.3 stays byte for byte after `generate`). It runs exactly the converter bytes
  whose full sha256 the consultant approved (`--sha256`), twice, each time in a fresh `vm` context
  without host objects inside a child Node under the permission model (one read grant, its own
  script; no write, child process, worker, addon, WASI or inspector;
  `--disallow-code-generation-from-strings`; only `TZ`, `LANG` and `LC_ALL` in its environment;
  time, heap and output limits; the child refuses to run outside that sandbox), and requires both
  results to be identical; the parent reads the export itself (no link followed, zip guards, a file
  over 64 MB passed on unread) and sends every byte on stdin. Node 24 has no network permission: the
  converter reaches no network only because its context holds no host object, and the consent
  text drafted for step 4 says so („Ein Netzverbot kann Node nicht garantieren“). It writes one
  `analyzr-spec/1` file per model, a write-once copy `converters/adhoc-<12 hex>.js` and the run
  record `analyzr-specs.json` (no timestamps), which `analyzr-spec plan` and `bundle` check against
  that copy before the specs take the run's derivation, `converted` or `reconstructed` with
  `adhoc:<12 hex>` as `--derived` chose it per mapping. Synthetic Visio (VSDX) and ARIS AML fixtures
  with example converters; D3 (a)–(c) for converter output (no `calledElement`, every call a
  collapsed subprocess with `link-unresolved`, the manifest `converted` or `reconstructed` with
  `adhoc:<12 hex>`); every known escape fails (the `constructor` chains,
  `process.getBuiltinModule`, `Error.prepareStackTrace`, promise jobs after the run,
  `Atomics.wait`, endless loops, huge outputs). Integrate 390 tests (332), every other count
  unchanged; no server, contract, web, MCP, procedure, dependency or plugin change, live-run
  neutral; the readings taken are in §4 ("Taken during M6 S3c step 2"); the lead's run: on a scratch
  stack the fixtures' Visio export (converted, `adhoc:dc5dcd69948a`, 2 models) and ARIS export
  (reconstructed, `adhoc:c987bfc789d4`, 2 models) went through `convert`, `plan` and `bundle` from
  source and imported with `analyzr import`: no extractor warning, every revision `derived`, no
  relation at all (so no call proposed or accepted, D3 (d)), a second import all `unchanged`. For
  the first analysis: once 0.1.4 ships, the integrate skill turns Visio and ARIS AML exports into
  specs in the same first pass as the BPMN exports: the agent writes a small converter, the
  consultant approves each version by its checksum, and it runs boxed in.
  **M6 S3c step 3 "the CLI core"** (done 2026-10-21 on the branch, every gate green with a review
  round's fixes: three reviews (behaviour, security, structure), of their findings 16 fixed with
  tests, 3 in part and 2 rejected with a reason, the one major a bypass of the parse guard by a
  repeated option or the `--` that ends the options, fixed; M6 §8 "S3c step 3 as delivered";
  DEVELOPMENT.md "M6 S3c step 3 (2026-10-21)"; decision 30 (3), (A5)): only `apps/cli` changes.
  `src/core-program.ts` holds the 34 commands both CLIs share (`buildCoreProgram`: every one but
  `seed` and `mcp`, moved unchanged except that `import` and `status` take the command name,
  `token create` the entry and `globals()` the loopback flag), which `src/program.ts` extends with
  `mcp` and `seed` in today's order (the help of all 43 command paths pinned by a snapshot taken
  before the split, unchanged), and `src/plugin-main.ts` is the entry of the bundled CLI
  `analyzr.mjs`, run from source until plugin 0.1.4 (not in the bundle's entries yet; 0.1.3 stays
  byte for byte after `generate`). The plugin's CLI names the command that runs it in every next
  step `import` prints and in `status`'s hint (`node <path of analyzr.mjs>`, with `--url <url>`
  unless the default; the checkout's keeps `analyzr`), sends the owner key only to `127.0.0.1`,
  `[::1]` and `localhost` over http(s) (an agent token anywhere) and prints no Claude Desktop config
  naming a file it lacks. Both CLIs refuse a word that reads as a flag (`--` and no space) as an
  option value or, after `--`, as an argument: exit 2 before anything is read or sent, so
  `import b -p p --create --name --dry-run` says `analyzr: --name "--dry-run": an option value never
  starts with --; did you forget the name?` instead of importing for real. Parity tests run
  `plugin-main.ts` and `main.ts` as child processes against fakes: the same requests, batches and
  output except the command name. CLI 317 tests (286) plus 7 skipped, every other count unchanged;
  no server, contract, client, web, MCP, procedure, dependency or plugin change, live-run neutral; a
  scratch bundle of the entry (not in `ENTRIES`) weighs 653 KB (151 KB gzip) and runs away from
  `node_modules`; the readings taken are in §4 ("Taken during M6 S3c step 3"); the lead's run: every
  gate on the final tree, with the CLI e2e suite (29 tests on Testcontainers: the import lines with
  `analyzr` as before) and the parity tests of the plugin entry run from source; no stack, since
  neither the server nor the web changed (the bundle against a stack is D4, step 4). For the first
  analysis: once 0.1.4 ships, a consultant without a checkout imports a landscape with the plugin's
  CLI and gets next steps that name a command they can run against the same analyzr, and a dry run
  whose project name was forgotten can no longer import for real.
  **M6 S3c step 4 "the integrate plugin 0.1.4"** (done 2026-10-21 on the branch, every gate green
  with a review round's fixes: three reviews (skill, release, flows), of 28 distinct findings 26
  fixed, 1 rejected, 2 items for the docs pass; M6 §8 "S3c step 4 as delivered"; DEVELOPMENT.md "M6
  S3c step 4 (2026-10-21)"; decision 30): with it **S3c is complete** (M6 §8 "S3c as delivered").
  The integrate plugin is 0.1.4 (`RELEASES['0.1.4']`, `claude plugin validate --strict` passed with
  Claude Code 2.1.306): it bundles `analyzr-spec.mjs` (the renderer, 497 KB), `analyzr-convert.mjs`
  (the converter runner, 336 KB; its child's one read grant is the bundle itself) and `analyzr.mjs`
  (`apps/cli`'s `plugin-main.ts` with the client, the contracts, zod and commander, 652 KB; decision
  30 (3)), rebuilds `analyzr-read.mjs` (0.1.1: the compact preview counts `identityUpdated` and
  `modelled`) and `normalize-bpmn.mjs` (its model bytes and version unchanged), and lists 13
  packages in its notices (yaml, zod, commander, hey-api's client runtime and rolldown's helpers
  among them). The skill (`allowed-tools` byte for byte as before, so still only `inspect.mjs` and
  `analyzr-read.mjs` pre-approved, decision 29 (2)) takes an export over on three paths per group
  of files: BPMN 2.0 through `normalize-bpmn`; Visio, ARIS AML and other machine-readable formats
  through a converter the agent writes and the consultant approves per version (confirmation 4:
  its path, length, `adhoc:<12 hex>`, full sha256 and „Ein Netzverbot kann Node nicht
  garantieren“, then the turn ends; Claude Code asks before each `analyzr-convert.mjs` run, never
  „don't ask again“), `converted` or `reconstructed` per mapping (A1); and pictures and PDFs the
  agent reads with its own file reader into `reconstructed` specs, roles in place of people's
  names, nothing uploaded (decision 30 (1)). Without a checkout it proposes the bundled CLI
  (`"cli": "plugin"`, expanded per run to the absolute path of `analyzr.mjs`) and always names the
  web path (A5). The report counts the models per path in the „Kurzfassung“, adds „Konverter“ and
  „Aus Bildern rekonstruiert“ (which asks the consultant to check those models), labels the new
  losses in the web's words, says „Danach: Ort im Quellsystem für 6 Modelle aktualisiert“ for an
  identity-only re-export and „Unverändert: analyzr behält die bisherige Angabe, wie die Datei
  entstanden ist“ (the two items of S2b's follow-up step 5), and for any reconstructed model opens
  „Offene Punkte“ with „Bis analyzr das ausschließt, können deine Regeln für Agenten-Vorschläge …
  annehmen“ (until 0.1.5; decision 30 (2)); the preview stops a spec bundle with modelled files or
  calls. New reference notes `images.md`, `analyzr-spec.md` and `converters.md`, every example run
  by a test. One change to step 3: the bundled CLI's next steps always carry `--url`, also the
  default one. Integrate 407 tests (390), CLI 327 (317) plus 7 skipped: the parity cases also on the
  shipped `analyzr.mjs`, the bundles run from copies in the drift test (`analyzr-spec.mjs`'s goldens
  byte for byte, `analyzr-convert.mjs`'s Visio run equal to the source's), and the CLI e2e on
  Testcontainers imports a converter bundle and a picture bundle with the bundled scripts,
  `analyzr.mjs` giving what the checkout's CLI gives, then all unchanged (D3 (d), D4); no server,
  contract, client, web, MCP, procedure, migration or dependency change, live-run neutral; the
  readings taken are in §4 ("Taken during M6 S3c step 4"); the lead's run: on the scratch stack
  `analyzr-s3c4` the bundled `analyzr-convert.mjs`, `analyzr-spec.mjs`, `analyzr.mjs` and
  `analyzr-read.mjs`, run from a copy of the plugin in a folder with a space outside the repository,
  took the fixtures' Visio (`converted`) and ARIS (`reconstructed`) exports through convert,
  validate, plan, bundle and import with the owner key: 2 and 2 models `created`, no extractor
  warning, every revision `derived` with its `adhoc:` converter, no relation at all, the dry run's
  `callsProposed` and `acceptedCalls` 0, a second import and the preview all `unchanged`, the next
  steps naming `node '<path>' --url …`; the owner key refused for 192.0.2.1 and `--name --dry-run`
  refused with exit 2 before any request. Not tried live (no LLM call): the skill's paths in a
  Claude Code session, the owner's one live session in §8. For the first analysis: one skill run
  brings Visio, ARIS AML, PDFs and whiteboard pictures into analyzr in the same first pass as the
  BPMN exports, consultants without a checkout import with the bundled CLI, and an identity-only
  re-export says that its import records the new places.
  **M6 decision-30 (2) safeguard "no owner's rule on reconstructed or as-told models"** (done
  2026-10-28 on the branch, every gate green with a review round's fixes: two reviews (correctness,
  surfaces and release), 9 findings, one minor, the rest nits: 3 fixed (2 with tests), 2 rejected as
  code changes with a reason, 3 for the docs pass, 1 left to the owner (§8); M6 §8 "Decision-30 (2)
  safeguard as delivered"; DEVELOPMENT.md "M6 decision-30 (2) safeguard (2026-10-28)"; decision 30
  (2)): a new block reason `reconstructed-endpoint` in the contracts, checked right after
  `agent-upload` (which is reported when both apply) and before `amendment-conflict`, with
  `UNSEEN_DERIVATIONS` (`reconstructed`, `as-told`) and `isUnseenDerivation`, so S6 needs no server
  change. No owner's rule (agent rules for relations and placements, and rules for derived calls on
  the callee side) accepts anything with an end in a live model whose uploaded revision (an amended
  head: its `source.upstream`'s, as the trust rule reads it) declares one of them: both ends of a
  relation, a placement's process. It reads the declaration, not the class (a revision stored
  between S2a and S2c counts, and „Behalten“ does not lift it), in every write path (relations and
  placement submissions, both ad hoc, the fifth path after imports, PUT, amendment writes and
  withdrawals, deletions and „Zurück in die Prüfung“), in „Anwenden“ and its dry run, the preview's
  „Jetzt offen“, curve and replay (such an item never fires but still counts as decided),
  `derivedGroups` and the import, deletion and trust-review dry runs. Unchanged: decision 9's system
  rule (only the caller's class counts), every human decision, the acceptances made before. The web
  names it „Modell KI-rekonstruiert oder aus Interview“ where a rule is held back (the live preview,
  „Anwenden“'s dry run; no page-lead change), and the bulk toast offers no rule for pairs that each
  have an end in such a model; the CLI prints the code and its owner-rule suggestion after an
  import skips calls into this import's reconstructed or as-told files. The integrate plugin is
  0.1.5 (`RELEASES['0.1.5']`): the bundled `analyzr.mjs` rebuilt with the contracts (decision 30
  (3)), and the report drops „Bis analyzr das ausschließt, …“ from „Offene Punkte“ (4b's „Prüf sie
  bitte gegen die Vorlage …“ stays, `allowed-tools` byte for byte as before). Server 1,828 tests
  (1,804), contracts 180 (178), web 666 (663), CLI 328 (327) plus 7 skipped, every other count
  unchanged; the new `reconstructed-rules.test.ts` (12 cases on PostgreSQL) and Playwright
  `reconstructed-rules.spec.ts`; no migration (the reason is not stored), no MCP, procedure or
  dependency change, live-run neutral (the eval reports unchanged); the readings taken are in §4
  ("Taken during the decision-30 (2) safeguard step"); the lead's run: the whole Playwright suite on
  a scratch stack, 114 passed and 21 skipped (the new `reconstructed-rules.spec.ts` among them;
  `auto-accept`, `derived-call-rules` and `trust-calls` green), the UI load numbers as before, the
  demo check 152 of 152, `demo.spec.ts` 14 of 14; two flaky checks made robust on the way (the
  mobile review screen's ‹ › hit test ignores that a disabled button takes no pointer events; the
  chain page's CSS check waits until the canvas has settled). Left open: an agent token's re-upload
  of such a model without a manifest lifts the safeguard for everything but its calls (pinned in a
  test; §8). For the first analysis: the consultant can keep the owner's rules on for the whole
  first pass, also over bundles that mix BPMN exports with whiteboards, PDFs and interpretive
  conversions; the exported and converted models get their bulk acceptances without a click, nothing
  an LLM read from a picture is accepted unseen, and the report's „Offene Punkte“ opens with what
  really is open.
  **Owner decision 31** (2026-10-28, §4) answers the S6 plan's questions: as-told drafts get keys
  of their own (`interview/…`), and the consultant deletes a draft once the tool's model is
  imported (amends M6 §5 item 4); interview guides address the customer's interviewees always with
  „du“, with no switch (answers M6 §10.3); the guide's consent part is a neutral checklist, and
  the skill that reads transcripts (step 4) asks first; the owner supplies short sample
  transcripts before step 3's formats are finalized.
  **M6 S6 steps 1–2 "the skill text generator and the interview guide"** (done 2026-10-28 on the
  branch, every gate green with a review round's fixes: three reviews (guide, security,
  generator), of 35 findings 31 fixed with tests, 3 in part, 1 rejected (a cosmetic line length);
  M6 §8 "S6 steps 1–2 as delivered"; DEVELOPMENT.md "M6 S6 steps 1–2 (2026-10-28)"; decision 31):
  step 1 generates the integrate plugin's skill texts and the German Claude Desktop start prompts
  from one source per skill in `tools/integrate/skills/` with shared fragments
  (`scripts/texts.ts`, called by `generate`, compared by the drift test; integrate-landscape's
  source moved byte for byte), and step 2 adds the skill `/analyzr-integrate:interview-guide
  [<questions file>] [--workspace <dir>]` with its deterministic script `analyzr-interview.mjs`
  (`groups`, `guide`; no network, environment or clock). It reads the open questions from a file
  below the workspace's `interviews/questions/` (the CLI's `questions list --format json`, else the
  web's Markdown export, else its CSV), groups them as the server's export does (step owners, else
  lanes, „Ohne Ansprechpartner“ last), takes groups by slug only (never a customer's label on a
  command line), keeps analyzr's order, also across groups (`--max` cuts it), and writes
  `interviews/guides/<date>-<slug>.md` with every question verbatim and its id `q-…`, beside a
  record `*.guide.json`. A guide asks only what an interview can clarify (no informational items,
  outside marks, chain proposals or the consultant's own work in analyzr), takes the agent's
  optional notes from analyzr's read-only MCP tools only after checking them (keys, ids, lengths,
  personal data, the formal address), opens with the neutral consent checklist and addresses the
  interviewee with „du“ (decision 31 (2), (3)). The skill pre-approves nothing and never writes to
  analyzr; it reads the landscape over an MCP server of its own, `analyzr-lesen`, whose token can
  only read. Both skills keep the agent out of `transcripts/` and search only named folders. The
  integrate plugin is 0.1.6 (`RELEASES['0.1.6']`; `analyzr-spec.mjs` and `analyzr-convert.mjs`
  rebuilt with the shared strict YAML reader, their outputs unchanged; integrate-landscape's
  `allowed-tools` byte for byte as before; `claude plugin validate --strict` passed). Integrate
  480 tests (407), CLI 330 (328) plus 7 skipped (the e2e runs the bundled script on a seeded
  `nordwind-handel`'s real CLI JSON and on the server's Markdown and CSV exports, D1), every other
  count unchanged; no server, contract, client, web, MCP, procedure, migration or dependency
  change, live-run neutral; the readings taken are in §4 ("Taken during M6 S6 steps 1–2"); the
  lead's run: every gate on the final tree, the CLI e2e suite on Testcontainers with the guide from
  the server's own export (330 CLI tests plus 7 skipped), `generate` twice with identical bytes,
  `claude plugin validate --strict` passed; no stack, since neither the server nor the web changed.
  Not tried live (no LLM call): the skill in a Claude Code session and the
  two Desktop prompts. For the first analysis: the open questions analyzr finds turn into a ready
  interview guide per contact group in one step, the questions that unlock the most first, and
  every answer maps back by its question id.
  **Next:** S6 step 3, the transcript pre-processor, once the owner's sample transcripts are in
  (decision 31 (4)); then step 4 (the fact sheet, as-told bundles, the marketplace description,
  plugin 0.1.7) and step 5 (integrate-landscape and interviews, 0.1.8); after the owner's live runs
  S5b, S7 and facts v2 as recommended (§7 "M6"; M6 §8 "After S2a").

## 2. Read in this order

| # | Document | What it holds |
|---|---|---|
| 1 | `docs/adr/0001-headless-landscape-store.md` | ADR-0001, the architecture decision (status: proposed; amended by decisions 23 and 25) |
| 2 | `docs/CONCEPT.md` | The full spec: domain, pipeline, review workflow, store vs Git/OKF, interfaces, auth (local mode v1, server mode R1), agents/procedures, eval, stack, repository, license and releases, roadmap, open questions |
| 3 | `docs/DEVELOPMENT.md` | How to run, test and extend the workspace (the operational source of truth) |
| 4 | `docs/M1-SKELETON.md`, `docs/M2-PIPELINE-REVIEW.md`, `docs/M3-RELATIONS-PROCEDURE.md` | Scope and status of the milestones |
| 4a | `docs/M3-LIVE-RUNS.md` | The owner's step-by-step guide for the live LLM runs |
| 5 | `docs/M4-VALUE-CHAIN.md` | The value chain milestone (concept, slices, open questions) |
| 6 | `eval/README.md`, `eval/tools/SPEC.md`, `eval/value-chains/README.md` | Test landscapes, trap catalog, generator/validator, golden value chains |
| 7 | `examples/agents/README.md` | The reference agent setups (Claude Code, Claude Desktop, Codex) |
| 8 | `docs/M6-INTEGRATION-AND-GAPS.md` | M6, in progress: integration toolkit, gap analysis, interviews (concept, decisions 24, 25, 28, 29, 30 and 31, answering by action and model amendments in §4.8, slices with what each delivered, the `eval:descriptive` results in §3.11, the `get_landscape` limit in §6, open questions) |
| 9 | `docs/UX-SIMPLIFICATION.md` | The UI simplification (owner decision 26): user, jobs and principles, the target information architecture, the changes per screen, the glossary, the slices with what each delivered (first wave UX2a, UX1, UX2b done 2026-10-18) and the UI load guard |

## 3. Repository state

| Item | State |
|---|---|
| Repository | `Miragon/analyzr`, **private** at first, default branch `main`, one initial commit (decision 23). Developed until 2026-10-11 on branch `claude/proa-2` of `Miragon/ProA` (draft PR #2, HEAD `61ee5ea`); commit hashes and CI run ids in these docs refer to that repository. |
| CI | `.github/workflows/ci.yml` (workflow "CI": typecheck, lint, tests, eval gates, client drift, build; the product image with a compose live check; the demo image) on every pull request and push to `main`, no path filters. Its three jobs "Typecheck, lint, test", "Docker image and compose stack" and "Read-only demo image" become the required status checks once the owner sets the ruleset for `main` (§7 "Migration owner actions", step 2). |
| Version | `0.1.0-alpha.0`; every package `private: true`, no tags or releases yet (CONCEPT §9). |

## 4. Owner decisions (binding)

1. **Greenfield** (superseded in part by decision 23, which replaces the repository part): a new
   codebase, no data migration, no compatibility with an earlier API.
2. **TypeScript end to end** (pnpm workspace, Node 24, Hono, PostgreSQL/Drizzle, React 19 +
   Vite + Tailwind v4 + shadcn, bpmn-js/diagram-js).
3. **Headless first:** every capability is a domain use case reachable via REST and, where agents
   need it, MCP; the UI is just one client.
4. **Intelligence in agents/skills, not in analyzr.** No LLM key in analyzr. Facts are computed by code;
   agents judge; humans decide.
5. **Agent freely chosen** (local Claude subscription via Claude Code/Desktop, deployed agents,
   other vendors) – everything over MCP from outside.
6. **v1 runs locally** (`ANALYZR_AUTH=local`: 127.0.0.1, Host/Origin checks, UI = owner, MCP via
   agent tokens; Claude Desktop through the `analyzr mcp` stdio bridge). **Generic OIDC** (Keycloak
   or WorkOS) comes with **server mode in R1**.
7. **PostgreSQL is the system of record**; OKF (Open Knowledge Format) only as export; Git/bpmiq.yml
   only as import source.
8. **Pipeline** of models: not yet analysed → agent working → waiting for review / waiting for
   clarification → incorporated (owner's idea, CONCEPT §3).
9. **Auto-accept only unambiguous calls** (static `calledElement` / `zeebe:calledElement`
   matching exactly one process id, not the caller). Everything else is a proposal. Extended by
   decision 19: the owner may add rules that accept further proposals. Amended by decisions
   24.2, 25.2 and 28 (2) (delivered in M6 S2c-1, 2026-10-19): only a call from a *modelled*
   revision is accepted; from a *derived* one (no Camunda engine, uploaded with an agent token, or
   declared converted, reconstructed or as-told) it is proposed (tier `key`, 0.9), and a call
   target set by amendment (applied, or taken over by the source tool, `in-source`) counts as
   modelled (M6 §3.10).
10. **"Vormerken" (hold)** = note + optional question/label, no assignee in v1.
11. **License:** superseded by decision 23 (MIT). All packages stay `private: true`; nothing is
    published to npm before a first release.
12. **Commits and merges** (amended by decision 23): until the owner sets the rules for `main`
    (§8), agents commit on feature branches; **nothing lands on `main` without the owner's
    explicit OK**.
13. **Live LLM runs (M3) are done by the owner personally** with Claude Desktop/Code on the
    owner's subscription; no API key is provided. Prepare everything so the owner only has to
    follow a guide.
14. **Value chain** (the owner's meaning of "Prozesslandkarte") via the npm packages
    `@miragon/value-chain-schema-model` and `@miragon/value-chain-renderer`, pinned at **0.3.0**
    (released 2026-10-08 from `Miragon/value-chain-modeler`, MIT; deps zod 4.6.5 and diagram-js
    15.28.0 match analyzr exactly). Do not copy the modeler into analyzr. 0.2.0 was decided first; 0.3.0
    followed the same day as a pure version sync (neither package's source changed between 0.1.0
    and 0.3.0), so the owner left the choice to the agent, which pinned the newest (2026-10-08).
15. **Order:** M2 → **M3** → **M4** (value chain). The process network map follows later (R1).
16. **No Agent SDK for now** (2026-10-08): models are evaluated through MCP with local agents
    (Claude Code, Claude Desktop, Codex); the reference worker was removed (the earlier
    repository's history keeps it, §3).
17. **No work twice** (2026-10-08): no pair may be judged twice, also with several agents. Done
    as "judge each pair once" in `analyzr-relations@0.2.0` (`M3-RELATIONS-PROCEDURE.md`, CONCEPT §3),
    released before any live run, so the owner's runs use `0.2.0`.
18. **Value chain defaults** (2026-10-09): the defaults of `M4-VALUE-CHAIN.md` §11 hold:
    archived copies go to `@outside` with the current version in the reason; one home step per
    process, a second only by a reviewer's decision; a step rename sends accepted placements to
    re-confirm; org units are owners of top-level steps, not agent evidence; one chain per project
    in M4; step kinds by colour until upstream has a category.
19. **Auto-accept rules** (2026-10-10): the owner maintains rules that accept agent proposals
    without a click: "up to x % confidence the agent may link by itself". Scope: **auto-accept
    only** (no glossary or fixed mappings), for **relations and placements**. Design the owner
    agreed to: a rule names the kind, the tier and a minimum confidence, optionally an agent or a
    model; the acceptance is recorded as decided **by the owner's rule** (agents still only
    propose, the check "agents never decide" stays); never for a pair or process with an open
    agent question, an objection or no-link of another agent, or a human decision; off by
    default; a preview shows what a rule would have accepted so far; accepted items are marked
    and can be revoked in bulk. **Delivered 2026-10-10**: CONCEPT §2
    "Auto-accept marker", §3 review workflow step 5, DEVELOPMENT.md "Auto-accept rules (owner
    decision 19)". Decision 24.2 extends it to the rule tier's call proposals of derived
    revisions, narrowed by derived kind and converter (decision 28 (1)); that extension is
    **delivered** in M6 S2c-3 (2026-10-20; M6 §8 "S2c-3 as delivered", DEVELOPMENT.md "Auto-accept
    rules (owner decision 19)"). Decision 30 (2) (2026-10-21) narrows it: no owner's rule accepts a
    relation or placement with a `reconstructed` or `as-told` endpoint (safeguard
    `reconstructed-endpoint`), **delivered** in a small server step of its own after S3c and before
    S6 (2026-10-28; M6 §3.10 "Decision 30 (2)" and §8 "Decision-30 (2) safeguard as delivered",
    DEVELOPMENT.md "Auto-accept rules (owner decision 19)").
20. **Public demo on Fly.io** (2026-10-10): (1) **read-only** demo mode: everyone sees
    everything, nobody can change anything; no MCP, no tokens; (2) **both landscapes**,
    `nordwind-handel` and `stadtwerke-auental`, with their value chains (`analyzr seed
    --value-chains`); (3) **deployed on every push to `main`** (amended by decision 23); (4) after seeding, a **run of the
    simulation agent**, so the review shows agent proposals, questions, no-links and placement
    proposals; (5) **no automatic nightly reset** (first asked for, then withdrawn: „doch nicht
    nachts … aber ich muss es machen können“): the owner resets the demo on demand, with
    one documented action; visitors have no reset endpoint. No Camunda engines; analyzr holds no LLM
    credentials. **Live 2026-10-10** under the earlier name; under analyzr at
    https://analyzr-demo.fly.dev since 2026-10-12: CONCEPT §6 "Read-only demo", DEVELOPMENT.md
    "Demo deployment (Fly.io)" with "Reset the demo".
21. **Demo legal links and the entry ceiling** (2026-10-10): (1) the demo links Miragon's own
    legal pages („nimm die dinge vom miragon.io impressum“): the Impressum
    https://miragon.io/impressum and the privacy policy https://miragon.io/datenschutz/, whose
    section „Wenn du unsere Tools nutzt“ covers Miragon's tools on Fly.io (Frankfurt, server logs
    30 days, no further data without a login); the repository copies no Impressum text and analyzr's
    code stays generic (two optional demo settings). (2) The web entry chunk's gzip ceiling in the
    bundle guard rises from 200 to **240 KB** („du kannst die Grenze dann anheben jetzt schon“;
    199.8 KB used with the legal links); the 40 KB chain-only budget is unchanged. **Done
    2026-10-10**: DEVELOPMENT.md "Legal pages", `apps/web/test/bundle.test.ts`.
22. **Process network map next, OKF deferred** (2026-10-10): the next milestone is the process
    network map, the bottom-up network of relations (the owner asked how it differs from the value
    chain: top-down structure vs the bottom-up network of relations). OKF is not
    needed for now („okf brauchen wir erstmal nicht“): the R1 OKF export and M4 S6 are deferred.
    The owner paused the work after the issue („mach erstmal eine pause“); the concept comes when
    the owner resumes.
23. **Own repository analyzr, MIT** (2026-10-11): „ich würde das ganze eher in ein neues repo, weg
    von einem fork migrieren und es analyzr nennen … Dann im neuen Repo auf MIT gehen?“ (1) A **new
    repository `Miragon/analyzr`**, private at first, with a **fresh history** (one initial commit):
    a complete break, no fork, no ProA 1.x code and no ProA name. (2) The name **analyzr**, always
    lowercase, without a trademark check. (3) **MIT**, „Copyright (c) 2026 Miragon GmbH“, with
    `THIRD-PARTY-NOTICES.md`; every package stays `private: true`. (4) The procedure ids become
    `analyzr-relations@0.2.0` and `analyzr-placements@0.1.0`: the version numbers stay, and the
    `RELEASED` table starts fresh with these two; the plugin `analyzr` stays at 0.3.0 with one
    release row. (5) The label baseline is `baseline-label/1`; the value chain link prefix is
    `analyzr:process/` (no alias). (6) The demo app is `analyzr-demo`; the issues of the demo and
    of the process network map move to `Miragon/analyzr`; PR #2 of the earlier repository is
    closed without a merge. (7) The version restarts at `0.1.0-alpha.0`. **Done 2026-10-11** in
    the working tree: CONCEPT §9, ADR-0001, `README.md`, `LICENSE`, `tools/notices`. The one
    match in the holdout files (the old baseline id in `eval/corpus/stadtwerke-auental/README.md`)
    was replaced blindly before the initial commit (§7 "Migration owner actions", step 0). The GitHub and
    Fly.io steps are the owner's too.

24. **Landscape integration and gap analysis, M6** (2026-10-15; details and quotes in
    `docs/M6-INTEGRATION-AND-GAPS.md` §2). The owner asked for a mechanism, maybe a CLI, to dump
    models in easily and write integrations ad hoc, for landscapes from ARIS, Signavio, Visio & co,
    for interview skills, and for agents that say what is missing to build more links. (1) The
    priority is the **toolkit around analyzr** („tools drum herum … Skills & Co“), concept and
    first beginnings now. (2) **Trust policy** („Ja, wie empfohlen“): a unique static call in a
    *derived* revision (engine null, uploaded with an agent token, or declared converted,
    reconstructed or as-told) is proposed (tier `key`, 0.9) instead of accepted, which amends
    decision 9; decision-19 rules may accept such call proposals narrowed by derived kind and
    converter, which extends decision 19; revisions stored before S2c keep their acceptances,
    listed once for a bulk revocation (option a; the list delivered in M6 S2c-4 as „Vor der
    Vertrauensregel angenommen“, narrowed by decision 28 (3)). (3) The **consultant answers
    gaps**, also in the web UI („Ich als berater, aber sollte auch in der UI gehen.“). (4) Gap
    output form left to the
    agent („entscheide du was besser passt“): a **`gaps` field** in `analyzr-relations@0.3.0` and
    `analyzr-placements@0.2.0` after the live runs, no pipeline kind of its own. (5) Customer
    exports and transcripts may go to the operator's LLM vendor for now („ja das passt erstmal“).
    (6) **M6 before M5** (amends decision 22's "next milestone"; M5 stays paused). (7) Principle
    7 counts `packages/*` only, so the toolkit's scripts ship in the private workspace package
    `tools/integrate`. (8) Agent submission summaries are shown **read-only** in „Offene
    Fragen“ and the model view (reverses M3-RELATIONS-PROCEDURE.md question 1). (9) Work step by
    step („Gehe Schritt für Schritt vor“).

25. **Answering by action, and targeted model amendments, M6 S5c** (2026-10-17, after S5a was
    delivered; details and quotes in `docs/M6-INTEGRATION-AND-GAPS.md` §2 and §4.8). The owner:
    „ich verstehe die Antwortarten nicht? Das soll für den User alles möglichst einfach sein, der
    user soll auch anpassungen am bpmn modell machen können. also fehlende Keys setzen, modelle
    zur Verknüpfung auswählen usw. was bringen die Textantworten?“ (1) **BPMN changes as targeted
    amendments** („Gezielte Ergänzungen (Empfohlen)“): only the fields a question names, through a
    form at the element; a new revision with the provenance „in analyzr ergänzt“; the next import
    re-applies it while the element exists, otherwise it becomes a question; exportable as
    corrected BPMN and as a change list for the source tool. Rejected: a full modeler in the
    browser, and no BPMN changes at all. (2) **Now, before S2** („Jetzt, vor S2 (Empfohlen)“), as
    slice S5c: the three answer kinds go, „Liegt außerhalb der Landschaft“ becomes an action of
    its own, real amendments replace „Wird im Modell ergänzt“, and text stays only as an
    optional note. It amends CONCEPT §11's deferral of "the Web Modeler" (lifted in part, no
    modeler), S5a's answer kinds, M6 §8's order, and the reading of ADR-0001 (decisions 2 and 3)
    and CONCEPT principle 3 and §4 that analyzr only stores uploaded bytes (ADR-0001's header and
    CONCEPT carry a forward note); imports stay one-way (decision 7), nothing is written back to a
    source tool. The concept refines „while the element exists“: a field the tool changed since is
    not overwritten but asked about (`value-changed`), and a value the tool took over counts as
    carried over and is not written again. It also extends S2c's rule (decision 24.2): call
    targets set by amendment count as modelled. **Answers 2026-10-17** (M6 §10.9, each the
    recommended option): 25.1 the fields of v1 without process ids and with missing process
    documentation („Ohne Prozess-ID, mit Doku“); 25.2 call targets set by amendment count as
    modelled, extending 24.2 („Ja, gilt als modelliert“); 25.3 a field the tool changed is asked
    about, not overwritten („Nicht überschreiben“); 25.4 Signavio's linked diagrams get a link
    from the model view now and a conversion operation after a real export („Erst verknüpfen,
    Umbau später“).
26. **UI simplification** (2026-10-18; details, measurements and the plan in
    `docs/UX-SIMPLIFICATION.md`). The owner, after M6 S5c: „Denke aber bitte auch noch daran, die
    UI etwas zu vereinfachen. Denke aus User Need Sicht. Wirkt alles inzwischen etwas überladen“.
    After a user-need audit the owner answered four questions, each with the recommended option
    (UX-SIMPLIFICATION.md §5.4 Q1–Q5, Q10–Q12): (1) **navigation** „4 Tabs (Empfohlen)“: „Übersicht“
    with „Als Nächstes“, „Relationen“ (today's „Prüfen“ and „Relationen“ in one tab with views),
    „Wertschöpfungskette“, „Offene Fragen“; „Hochladen“ a button; „Agent verbinden“ and
    „Annahmeregeln“ in an owner menu; the tab „Befunde“ and the model view's „Befunde“ section go
    (the list stays behind a link); the agents' no-links behind a foot link in „Relationen“ (answers
    HANDOFF §8 "Demo: no-links in the review"); every URL stays. (2) **„Offene Fragen“ shows „Zu
    klären“** („Ja, nur „Zu klären““): the badge counts it, summaries sit in a closed „Zur
    Information“, the agents' questions show on their proposals, and the customer export carries
    only the questions to clarify by default („Auch Fragen der Agenten“ as an option). (3) **Decide
    where the diagrams are** („Dort, wo die Diagramme sind“): holds and agent questions are decided
    on the review screen or the chain, reached from „Offene Fragen“ with „Jetzt entscheiden“ and
    back; one entry „Ziel wählen …“ with the checkbox „Im Modell eintragen“ chooses between a link
    and an amendment. (4) **Order** („Erste Welle, dann Walkthrough“): UX2a → UX1 → UX2b (about 8
    agent days), then the owner walks five tasks and decides the rest of UX3–UX9; the upload and
    provenance slices UX7/UX8 (S2a's web parts) come before S2b and S2c. It amends decision 19's
    tab name „Regeln“ (now „Annahmeregeln“ in the owner menu), decision 24.8's place of the
    summaries (still shown read-only, in a closed group), decision 25's inline „decide“ panel, and
    CONCEPT §3's inbox as a tab of its own; agents, facts, procedures, claim inputs and MCP are
    untouched (live-run neutral). At UX5 (2026-10-18) the owner answered Q6 and Q7 „Q6 und Q7 ja,
    mach weiter“, each the recommended option: (5) **the auto-accept mark** is one status badge
    „Automatisch angenommen“ instead of „Angenommen“ plus a box, the rule's name and revision in
    „Verlauf“ (and the badge's tooltip), a revoked item one line „Automatische Annahme
    widerrufen“; filters unchanged (amends CONCEPT §3 step 5's text „Automatisch angenommen –
    Regel „…““ in the table, review screen, queue, chain and step view); (6) **bulk accept only
    for „Gleicher Name“** (the key tier, CONCEPT §3 step 2): the lexical bulk, which preselected
    pairs at 65 %, goes; the key tier's bulk preselects the unflagged pairs and its count is that
    selection. At UX9 (2026-10-19) the owner answered Q8 „Nur anzeigen“, the recommended option:
    (7) **the bulk flags do not block an auto-accept rule**: the rule's preview and apply name how
    many of their proposals the bulk accept would flag („davon N mit allgemeinem oder mehrfach
    genutztem Namen (in der Sammelannahme markiert)“), the rule accepts them all the same; whether
    they should block is decided after the live runs with the what-if (§8 "Shared-name flag").
27. **Claim order** (2026-10-18; §8 "Claim order" answered „ja, mach weiter“, the recommended
    option): a relations claim sorts its relations by type, `from` and `to`
    (`apps/server/src/domain/claim-input.ts`). Before, they came in the database's physical row
    order (`relations.all` has no `ORDER BY`), which updates and vacuum move: on CI two projects
    seeded alike got different claims. Every claim input changes once, before the owner's live
    runs, so two runs of one landscape see one order; the recordings (they keep the claim's size
    and counts) and the replays are unchanged, `claim-golden.test.ts`'s snapshot is re-pinned.
28. **The trust rule's open points** (2026-10-19, at the start of M6 S2c; each the recommended
    option; refines decisions 24.2 and 25.2): (1) **„Streng“**: an auto-accept rule for the call
    proposals of derived revisions may name only the derived kinds „Export“, „Konvertiert“ and
    „Ohne Angabe“ (never „KI-rekonstruiert“ or „Aus Interview“), and no rule ever accepts calls of
    a revision uploaded with an agent token (safeguard `agent-upload`); (2) **„Ja, wie gesetzt“**:
    a call-target amendment the source tool took over (`in-source`) counts as modelled like an
    applied one, so the call stays accepted after the consultant carried the change list over;
    (3) **„Nur die heute abgeleiteten“**: „Vor der Vertrauensregel angenommen“ lists only rule
    acceptances from before S2c whose revision would classify as derived from what it carries
    (no engine, an agent upload or a service principal before S2a, a declared kind other than
    export); Camunda projects, the demo and the live-run projects list nothing. (1) is delivered
    in M6 S2c-3, (2) in S2c-1, (3) in S2c-4 (2026-10-20; M6 §8 "S2c-4 as delivered").
29. **Provenance of unchanged bytes, and the integrate skill's preview** (2026-10-20, after step 1
    of M6 S2b's follow-up; each the recommended option; M6 §2): (1) **M6 §10.10, option (b)**: an
    append-only identity row per import and model (system, tool id, tool folder, link), written
    also for an unchanged file whose declaration differs; `external-ids`, the change list,
    „Herkunft“ and the identity warnings read the newest row; no re-analysis, `facts_hash`
    untouched; step 5 of S2b's follow-up, its own step after steps 1–4 (migrations 0021/0022), before the
    first customer re-export; (2) **the pre-approved preview** (M6 §3.1, §3.7 step 5) is not a CLI
    pattern, which is unsafe (`import b -p p --create --name --dry-run` parses `--dry-run` as
    `--name`'s value and imports for real; the CLI's prefix differs per workspace; `--url` could
    send the key elsewhere), but a read-only script bundled with the plugin, `analyzr-read.mjs`
    (only `GET …/models`, `GET …/external-ids` and `POST …/imports` with `dryRun=true` built in,
    loopback hosts only, no redirects), which `allowed-tools` pre-approves; the real import stays
    with the consultant. (1) is delivered in step 5 of the follow-up (2026-10-20; M6 §8 "S2b
    follow-up step 5 as delivered"; its optional live check is in §8). (2) is delivered with the
    integrate plugin 0.1.3 (step 4 of the
    follow-up, 2026-10-20; M6 §8 "S2b follow-up step 4 as delivered"); its live check is in §8.
30. **The S3c plan's questions: pictures, rule acceptances on reconstructed models, the bundled CLI
    and the concept text** (2026-10-21, at the start of M6 S3c; the owner chose the recommended
    option of every question; M6 §2): (1) **„Agent liest ab (Empfohlen)“**: pictures and PDFs are
    read by the session agent itself, with its own file reader only, and become `reconstructed`
    specs with `llmModel`; no vision pipeline, no LLM key in analyzr (decision 4), and decision 24
    (5) covers the files at the operator's LLM vendor. It amends M6 §3.8's "later: vision into a
    spec" and reads §9's "vision reconstruction" as an automated pipeline, which stays out of scope
    (now "a vision pipeline"; A7 of the S3c plan). (2) **„Ja, als kleiner Schritt (Empfohlen)“**: a
    safeguard so owners' agent rules (decision 19) never accept relations or placements with a
    `reconstructed` (from S6 also `as-told`) endpoint, as decision 28 (1) already keeps rules from
    such models' calls; its own small server step after S3c and before S6, not part of S3c. Until it
    landed, an owner's rule like „Nachricht ab 0,9“ could accept an agent's proposal on a model read
    from a whiteboard (M6 §3.10 "Decision 30 (2)"). (3) **„Ja, immer aktuell (Empfohlen)“**: the
    bundled CLI `analyzr.mjs` bundles `apps/cli`, the client and the contracts (zod included), so
    every change there needs `generate` and a new integrate plugin version, which the drift test
    enforces; `analyzr-read.mjs` stays zod-free. It amends M6 §8 "S3b as delivered"
    (`tools/integrate` imports only the zod-free contracts) and the generate rule of §9 (A6); it
    takes effect with S3c steps 3 and 4. (4) **„Alle wie empfohlen (Empfohlen)“**, A1–A5: (A1)
    converters of interpretive formats (EPCs, plain flowcharts) declare `reconstructed` with
    `converter: adhoc:…` and those of BPMN shapes `converted`, chosen per mapping in the
    consultant's first confirmation (M6 §3.2 and §3.9 had been read as "ad-hoc output is
    `converted`"); (A2) a spec carries no key and no name: keys come only through `keymap.json` and
    `plan` (M6 §3.4 rule 1), and analyzr names a model after its first process (§3.9 listed `key`
    and `name`); (A3) the renderer's element ids take category prefixes (`Activity_`, `Event_`,
    `Gateway_`, `Flow_`, …) from one capped, collision-checked id function, so a type refinement
    keeps an id and every anchor on it (§3.4 rule 2 said `<Type>_<source id>`; `normalize-bpmn`
    keeps passing tool ids through); (A4) the converter runner is a script of its own,
    `analyzr-convert.mjs`, so an approval of the harmless spec commands never covers running code
    (§3.7 listed `inspect`, `normalize-bpmn`, `analyzr-read`, `analyzr-spec` and `analyzr` as the
    scripts besides S6's); (A5) without a checkout the skill proposes the bundled CLI (`"cli":
    "plugin"` in the workspace, expanded to the absolute path on every run), and the report always
    gives the web path too (§3.7 "Reaching analyzr" had `ANALYZR_CLI`, a checkout or the web, and
    `$CLAUDE_PLUGIN_ROOT`, which the consultant's terminal does not set). Open, not decided: whether
    calls from ad-hoc converters whose target is a model of the same export (resolved by its tool
    id, never by a name) are later written as real calls, as 90 % proposals the consultant accepts
    in bulk, once a sandbox AML or Visio export shows how process interfaces look (Q2 of the S3c
    plan; §8, M6 §10.12). (1), (A2) and (A3) are delivered in S3c step 1 as far as the spec and the
    renderer go (2026-10-21; M6 §8 "S3c step 1 as delivered"), (A1) and (A4) in step 2 as far as
    the runner goes (`--derived` per run, `analyzr-convert` a script of its own, run from source;
    2026-10-21; M6 §8 "S3c step 2 as delivered"), (3) in step 3 as far as the CLI core goes (the
    commands both CLIs share and the bundle's entry `plugin-main.ts`, run from source, in no bundle
    yet; 2026-10-21; M6 §8 "S3c step 3 as delivered"); the rest came with step 4 (2026-10-21; M6 §8
    "S3c step 4 as delivered": (1) in the skill's picture path, (3) as the bundle `analyzr.mjs`,
    (A1) and (A4) in the skill's converter path, (A5) in its step 0, and the report line that (2)
    asked for until the safeguard step); (2) itself came with the safeguard step (2026-10-28; M6 §8
    "Decision-30 (2) safeguard as delivered"), whose plugin 0.1.5 drops that line.
31. **The S6 plan's questions: as-told drafts and a later tool model, the address form, consent
    and sample transcripts** (2026-10-28, at the start of M6 S6; M6 §2): (1) **„Eigene Schlüssel
    (Empfohlen)“**: as-told drafts get keys of their own (`interview/…`), and the consultant
    deletes a draft after the tool's model is imported. It amends M6 §5 item 4's "the as-told
    draft becomes revision 1 of that model" (amendment A1 of the S6 plan: the key map holds every
    key once over all systems, and what a human accepted on the draft would go `missing` with the
    tool's element ids anyway). (2) **„Immer „du““**: interview guides address the customer's
    interviewees always with „du“, with no per-workspace switch; this deviates from the S6 plan's
    recommendation („Sie“ by default, switchable to „du“) and answers M6 §10.3. (3) **„Neutrale
    Checkliste (Empfohlen)“**: the guide's consent part is the neutral checklist (recording or
    notes; evaluation with an AI assistant with names replaced; the result in analyzr without
    names), plus the skill asking before the agent reads a transcript; that question belongs to
    step 4's interview-facts, the guide carries the checklist. (4) **„Ja, Testgespräche
    (Empfohlen)“**: the owner supplies short sample transcripts (Teams, Zoom, Webex if possible;
    VTT and text; invented names) before step 3's formats are finalized (§8). (2) and (3) are
    delivered in S6 step 2 with the integrate plugin 0.1.6 (2026-10-28; M6 §8 "S6 steps 1–2 as
    delivered"): „du“ only (no switch, no `--address`, no workspace setting; a formal follow-up in
    the agent's notes is a warning) and the checklist under „Vor dem Gespräch“, with the additions
    of "Taken during M6 S6 steps 1–2" (b) below; the question before a transcript is read comes
    with step 4, (1) with steps 4 and 5 (the `interview` keys with the as-told bundles, the hint
    to delete a draft with 0.1.8), and (4) is open (§8).

**Taken during decision 20 by the implementing agent (the owner may overrule; details in
DEVELOPMENT.md "Demo deployment (Fly.io)"):** the seed is made **while the image is built** and
baked in as a PostgreSQL data directory; every start copies it, so a restart is the reset and a
broken seed fails the build; PostgreSQL 17.11 comes from its official image with the Node binary
copied in, inside the same machine (no Fly Postgres, no volume, **no Fly secret**: the request's
`DATABASE_URL` and `ANALYZR_SESSION_SECRET` are not needed); the supervisor is a typed workspace
package `apps/demo` (`analyzr-demo seed|serve|check`); the visitor is a principal of its own
(`urn:analyzr:demo`/`visitor`, scope `analyzr:read`, viewer of every project, granted at build time),
so the policy denies writes behind the HTTP guard; the guard refuses every non-GET/HEAD/OPTIONS
method before authentication with the new problem code `demo-readonly`, documented on every write
route of the contracts; credentials are refused (401), `/mcp` answers 404; a third barrier, a
read-only database role (`default_transaction_read_only`, `statement_timeout` 30 s), and the
server refuses to start in demo mode without it; `ANALYZR_PUBLIC_ORIGIN` (default
`https://$FLY_APP_NAME.fly.dev`) replaces localhost in the Host/Origin checks, and is refused
outside the demo; the web UI hides write actions **by role** (viewers in general, which also
prepares server mode), the tab „Regeln“ stays owner-only (so it is hidden in the demo instead of
read-only), „Agent verbinden“ is now owner-only too (agent tokens are an owner action, CONCEPT
§6); the banner text promises no nightly reset; Fly: region `fra`, `shared-cpu-1x` with 1 GB,
**`auto_stop_machines = "stop"`** (the owner, 2026-10-10: an idle demo shuts down and costs
nothing; first chosen: `suspend`), blue-green deploys behind `/health`, restart policy `on-failure` (not `always`,
which keeps machines from stopping), `--ha=false`; flyctl 0.4.108 from the release tarball with
its sha256 instead of the setup action; the reset is a redeploy (fresh seed) or `fly machine
stop`/`start` (same seed), and the workflow's manual run offers both; a CI job `demo` builds and
checks the image; the seed's agent tokens stay (revoking them would withdraw their proposals;
the demo accepts no credential).

**Taken during decision 23 by the implementing agents (the owner may overrule):** the compose
service is `server` (container `analyzr-server-1`) and the product image can be overridden with
`ANALYZR_IMAGE`; code, tests and contract descriptions name owner decisions instead of issue
numbers (transferred issues get new numbers); token prefixes, scopes, cookie, URNs, the Bearer
realm, the MCP server name, the formats and hash domain tags are renamed without aliases (no
analyzr database or client exists yet), the migrations are edited in place, and recordings and
reports are regenerated (every number unchanged); the simulation agent's holdout relations
recording and `replay.md` are compared by digest in the tests, and the CI eval steps print
`git diff --stat` only; `tools/notices` generates `THIRD-PARTY-NOTICES.md`, checked by a test;
the stale `minimumReleaseAgeExclude` entries are removed; Dependabot is left open (§8). A review
round (2026-10-12) added the build tools whose code the web bundle contains (rolldown, tailwindcss,
vite; devDependencies, so not in `pnpm licenses list --prod`) to the notices, made
`ANALYZR_E2E_VC_EXTRA` resolve a relative path against the directory pnpm was started in, wrote
the owner's holdout check and the three required CI checks into the migration steps, replaced the
owner's checkout path in the docs with placeholders, and narrowed the agents' Docker rule to
projects and tags of their own (AGENTS.md).

**Taken during M3 by the implementing agent (the owner may overrule; details in
`M3-RELATIONS-PROCEDURE.md`):** agents write rationales, questions, no-link reasons and summaries
in **German** (the review UI is German; a per-project language setting is deferred); the claim
input gains message-flow ends, partner documentation, partner processes and findings (optional
fields within `analyzr-claim/1`); every live run uses a **fresh project and its own token** (token
name = recording agent); the live gate is evaluated **per procedure version, landscape and
declared model** (3 runs each), against the previous version's live runs on that model or else
the simulation agent; every MCP tool declares `anthropic/maxResultSizeChars` so Claude Code
passes large claim inputs inline; the plugin carries no MCP server. For decision 17: an agent
judgement (pipeline proposal or stored no-link) carries a basis (both models' `facts_hash` at the
claim plus the procedure) and is current while it holds; the claim assigns each unjudged `rule`,
`key` or `lexical` candidate pair and each open relation (whatever its basis) to exactly one task
and lists current judgements (`judged`) and partner-assigned pairs (`skip`) instead of repeating
them as candidates (that kept the input below 100 KB); other `compatible` candidates stay the
search space; an agent's confirmation of a held pair is recorded as its judgement (the hold stays
in force); a submission withdraws only
judgements made on another version of its model; judgements of different principals or origins
coexist, so disagreements reach the reviewer; recordings keep the `uncovered` count, not the pairs.
This answers the former open questions "Supersession scope" and "No-links in review".

**Taken during M4 S5 by the implementing agents (the owner may overrule; details in
`M4-VALUE-CHAIN.md` §3.2 "As delivered in S5" and §9 "S5 as delivered"):** decision 17 (no work
twice) holds for placements as **judge each process once**: a process is judged again only when
its input hash changes (its model's facts, the chain's structure and step generations, its
neighbours through accepted relations with their accepted steps, the last human or rule-tier
assertion on it; never agent activity); at most one placement task per chain is open (no parallel
placement agents per project), follow-ups are queued only at submit; unsure and skipped processes
are remembered until their input changes; ad-hoc agent proposals count as the agent's verdict
(`judged`); a submission withdraws stale pipeline proposals of anyone and the caller's own
unrepeated ones, other agents' current proposals stay. `facts_hash` keeps its name and chain tasks
get `input_hash` (instead of the rename M4 §8 planned). `work_pipeline` works one kind per run
(`kind`, default relations with the released text). The plugin has its own version (0.3.0) with
a release table. New pipeline withdrawal reasons for placements are German; the relation ones stay
English. The placement live gate's bar is the higher recall@1 of `baseline-prefix/1` with and
without votes plus 20 points. The simulation agent's placement policy extends `sim-policy-1`.

**Taken during decision 19 by the implementing agents (the owner may overrule; details in
DEVELOPMENT.md "Auto-accept rules (owner decision 19)"):** the deciding principal is the author of
the rule revision in force (whoever created, edited or enabled it), pinned by a database foreign
key; the event principal is the causer (the agent, or the owner applying the rule); every edit,
enable and disable is an immutable revision, rules are never deleted, names are unique per project;
one kind, one tier and an inclusive minimum confidence of at least 0.5 per rule, optionally one
relation type, one agent and one exact declared model; **ad-hoc proposals only when the rule says
so** (default: pipeline proposals with a claim basis); the first matching rule in creation order is
recorded and its author must still be an owner; rules evaluate only proposals newly recorded by a
write and are **never retroactive** (apply: dry run, head revision, `expectedCount`);
**submission and ad-hoc results report the status before rules ran** (recordings and replays stay
independent of a project's rules, agents get no per-item feedback); the safeguards block also on
any human note or human proposal and on an earlier auto-acceptance or its revocation, so a revoked
item is never auto-accepted again and **a rule never re-confirms** after an endpoint change;
competing calls from one element and competing steps of one process block; revoking returns an
item to `proposed` while a live proposal remains (its judgement stays current, nothing is judged
twice), else it becomes `obsolete` and counts as a lost judgement; a human decision taken since is
never touched; **token revocation keeps auto-acceptances** (they are owner decisions) and the agents
page offers to revoke them with the token (and the tab „Regeln“ per agent); decision 9 stays
built in (as amended by 24.2 since M6 S2c-1) and shows as the read-only system rule „Eindeutige Aufrufe“; no MCP tool and no rule data
for agents (the revocation text names no rule); **the marks are every reviewer's** (editors read
the ledger of acceptances, permission `review`; the rules, apply and revoke stay the owners'); a
revocation ends exactly the acceptance (a later proposal of the rule's author stays); **saving a
rule whose author is no longer an owner takes it over**, also without a change; an agent's ad-hoc
placement proposal never replaces another agent's current `unsure` verdict (the doubt keeps
blocking); the preview counts only unmarked human decisions as ground truth, replays what the
rule's own earlier firing would have blocked, and counts an item as corrected when a human
accepted a competitor of it; the `eval:replay` what-if is report-only and replays a run in
recording order (an acceptance stays, later competitors are blocked), the holdout as `all` rows
without the tier split and with rows hidden when a difference between thresholds would reveal fewer
than 5 items, relations per tier (offline pair assessor), placements
overall, the holdout aggregate only with „< 5“ and a secondary suppression of the tier split.

**Taken during M6 S2c-3 by the implementing agent (the owner may overrule; details in M6 §8
"S2c-3 as delivered" and DEVELOPMENT.md "Auto-accept rules (owner decision 19)"):** (a) decision
28 (1) is read literally, "no rule ever": the safeguard `agent-upload` also stops existing agent
rules, so no rule accepts any proposal (an agent's included) on a call whose caller's revision was
uploaded with an agent token (the reading covers classified revisions, those stored since S2c-1;
one stored before carries no class and counts as modelled, option (a), so an agent rule may still
accept an agent's proposal on its calls); (b) a proposal the rule tier makes again in a person's
import (say, the callee renamed, so its endpoint fingerprint changes) counts as new and an enabled
rule for its source accepts it, as an agent's re-proposal after a model change counts as new for
agent rules;
(c) a write made with an agent token (an upload, a deletion) never sets off a rule for derived
calls, so an agent's upload of a callee or its deletion of a duplicate never decides which call is
accepted; (d) new rules start off, as before, and the rule `analyzr import` suggests is created
without `--enable`. Also: whose proposals a rule accepts (`proposedBy`) never changes, like its
kind; the converter matches exactly, version included; only the caller's class counts.

**Taken during M6 S2c-4 by the implementing agent (the owner may overrule; details in M6 §8
"S2c-4 as delivered" and DEVELOPMENT.md "The trust rule (M6 S2c-1)"):** (a) the owner's review is
read beyond the rule tier: `Model.trust` shows it (also on `GET …/models`, which agent tokens can
read: after „Behalten“ `{class: 'modelled', reasons: []}`, the same exposure S2c-1 already has for
every classified model; not on MCP), and so do the „Herkunft“ line, the bulk toast's source and
the class unchanged bytes keep (`trust-kept`), so none of them contradicts the rule tier (and a
revision reviewed `derived` with the reason `agent-upload` gets S2c-3's safeguard `agent-upload`,
so no rule accepts its calls again); (b) an accepted call whose callee is gone (endpoint
`missing`) is not listed, since the review cannot turn it into a proposal now, so the list's count
equals the dry run's `toProposed`; (c) „Behalten“ skips the recompute and writes only the review
and its event, since `modelled` reads like no class for the rule tier and the auto-accept
evaluator (everything the recompute reads; only `Model.trust` shows `modelled`, reading (a)); (d)
`expectedCount` counts the listed calls, not the revisions, and the dry run refuses a revision
that is not listed (409 `not-listed`) as the write does; (e) „Zurück in die Prüfung“ queues no
analysis: the calls go to the human bulk accept („Gesammelt annehmen“), and the models show
`waiting_for_review` through their open items (once their analysis is done); (f) the database
itself refuses a review of a classified or amended revision (the trigger
`analyzr_trust_review_guard`), whoever writes, so no writer can overrule a class the server
assigned; (g) the dialog lists models, not individual calls, to stay simple (the CLI's list and
the API show the calls, up to 100 per model); if you want the calls in the dialog too, say so.

**Taken during the M6 S2b follow-up step 1 by the implementing agent (the owner may overrule;
details in M6 §8 "S2b follow-up step 1 as delivered" and DEVELOPMENT.md "Provenance and the import
manifest (M6 S2a)"):** (a) a pair counts as "judged again" (`rejudged`, the amendment cost) only
when a judgement of it was current before the write and none is after; a revert that makes an
older judgement current again loses nothing; (b) `pairs` is an upper bound while other models'
tasks wait (a pair a partner's queued task or live claim would take still counts): exact routing
would cost seconds per batch and still not give "the work the import adds", so `rejudged` is the
reliable number; (c) a non-owner's preview counts a derived call an owner's rule would accept as a
pair to judge (an overcount; no rule data outside an owner's preview); (d) the amendment cost
counts against the relations as the write leaves them (its recompute, an owner's rules, the
partner acceptances of `settleLinks`), so it can drop to 0 where agents judged only `compatible`
pairs; (e) the dry run reads the latest done task for every changing file without an open task,
not only for layout-only ones, since the extraction happens outside the read snapshot; (f) one
shared zod-free merge (`@analyzr/contracts/impact-merge`) for the CLI, the web and the plugin's
script (which bundles it since step 4, so an `ImportImpact` change that reaches the merge also
needs a plugin release).

**Taken during the M6 S2b follow-up step 2 by the implementing agent (the owner may overrule;
details in M6 §8 "S2b follow-up step 2 as delivered" and DEVELOPMENT.md "Provenance and the import
manifest (M6 S2a)"):** (a) `placementsChanged` lists accepted placements only (as
`endpointsChanged` names accepted relations only; held and obsolete placements, those on removed
steps and a placement turning back to `ok` are not named), sorted by process, then step; (b) a
process counts as placed again (`again`) when it is newly due and was open before, that is, an
agent's verdict (or the held claim, (d)) matched its input then; (c) the dry run plans the rule
tier's placement writes (`planRulePlacements`, appended to the histories whenever the write
changes a head): the plan's invariant that it need not simulate them did not hold (an
auto-acceptance revoked since the last run lets the next head change record a rule proposal on a
process whose own fields did not change); (d) while an agent holds the placement task, the
processes its claim shows count as judged on the input the claim showed: in the deferred case
`due` is what the follow-up offers, and a process the import changes under the claim counts as
newly due and placed again; (e) across batches the merged `due` is the largest batch's count and
`newlyDue` and `again` are added up, all approximate (not a lower bound: another batch's revert or
removed process is not seen, and a process two batches make due counts in both); (f) the chain is
read also for an unchanged batch, so the fields are always present with a chain (about 20–30 ms
per 50-file batch on 496 models); (g) the deletion impact reports `due`, `newlyDue` and `again`
although a deletion never queues the task (`not-triggered`; those processes wait for the next
trigger or a requeue); (h) a non-owner's preview leaves out the neighbours of the calls an owner's
rules for derived calls would accept, so its `due` can be too low (no rule data outside an
owner's preview; the counterpart of step 1's (c)).

**Taken during the M6 S2b follow-up step 3 by the lead agent, on the implementing agent's and the
review round's open points (the owner may overrule each; details in M6 §8 "S2b follow-up step 3 as
delivered" and UX-SIMPLIFICATION.md §6):** (a) „N Prozesse zu platzieren“ counts, for a placement
task the import queues (`queued`), every process due (`max(due, newlyDue)`: it places them all,
also those a deletion made due without queuing a task), and for one waiting (`open`) or held by an
agent (`deferred`) the newly due ones (the waiting task covers the rest anyway); the CLI counts the
same and adds "N due in all" only for `open` and `deferred`; (b) the cost line always takes the
last of the three lines, on a first import too, so it can push the endpoints or the placements line
into „Was ändert sich?“ (the order UX-SIMPLIFICATION.md §6 planned, the agent work in the last of
the three lines; the UX review asked to confirm it, the lead kept it: the human decisions it
pushes still show in the list); (c) „etwa“ / "about" stays across batches,
and the batch note names the gap on a first import (the web only when new models lie in two or
more batches, the CLI always): „…, mögliche Relationen zwischen neuen Modellen verschiedener Teile
fehlen in der Zahl.“; step 3b's backlog count is the full fix (delivered the same day, "Taken
during the M6 S2b follow-up step 3b" below); (d) the second click comes only with the claimed-task
warning; „Abbrechen“ closes the preview as before (which disarms), a new
preview disarms, and a double click arms only, in all three places that ask a second time (the
„Vorschau“, the amend form, the action panel); (e) the warning for several models names at most
three, then „und N weitere“, and shows no handle and no lease (as the amend form); (f) the fallback
„Danach: keine Änderung an Relationen und Befunden.“ is hidden while the warning shows; (g) no
screen-reader live region when the button arms (not a regression, the amend form has none either;
it would go into all three places at once, so it is left open for you, §8); (h) the relations part
of the cost line shows only when `pairs` is above 0, and there is no list of all pairs to judge
and none of the processes to place (the impact carries counts only); the pairs judged again are
listed; (i) the CLI shows an accepted placement on `@outside` or on a step without a name by the
step id (`on @outside`), and `analyzr models delete` prints the requeue hint once after the
listing, also when a task already waits ("… queues it unless one waits").

**Taken during the M6 S2b follow-up step 3b by the implementing agent and the review round's
fixer (the owner may overrule each; details in M6 §8 "S2b follow-up step 3b as delivered",
DEVELOPMENT.md "The agents' next run" and UX-SIMPLIFICATION.md §7):** (a) `pairsToJudge` counts the
relations tasks an agent may claim now, the ones `TaskRepo.claim` takes: the queued ones and the
claimed ones whose lease ran out with attempts left, so it is the size of the next run, while „N
Modelle warten auf den Agenten“ still counts the queued tasks only; a task whose lease runs counts
not, and neither does a pair of its assignment with such a model its claim saw as it is now (rule
1: that model's claim skips it); the alternative, queued tasks only with expired claims holding
nothing, would make the number depend on the order of the claims; (b) the summary reads the clock
for those leases, and its memo holds until the earliest live lease runs out, so the number changes
then without an event; (c) „etwa“ from 2 on and none for 1 („etwa 1“ reads wrong; „etwa“ marks a
planning number, since decisions and imports before the claims change it), exact German numbers,
nothing for 0; the alternatives are no „etwa“ at all (the number is exact for the stored state,
like a one-batch „Vorschau“'s) or „etwa“ with a rounded number from 100 on; (d) the suffix names
no verb („etwa 7.300 mögliche Relationen“, the plan's text); „zu beurteilen“ would add two words
(`signavio-beispiel`'s „Als Nächstes“ 24 instead of 22, budget 40); (e) the suffix also stands
beside „Agent verbinden“ (right after a first import the owner usually has no token yet, which is
when the run gets planned), beside the owner's button as muted plain text without „ · “, for
editors and viewers in the waiting line after „ · “, and only while models wait (not while only
failed analyses or expired reservations wait); (f) „Hochladen“ after an import shows it from a
summary read after the import that succeeded, so no number from before it, and none when that read
fails; (g) `analyzr import` in text mode and `analyzr status` read the summary while models wait
(one request more): on a head nobody has read yet that computes the whole-project candidates, about
6 s at 496 models and 30 ms at 31 (the web's first „Übersicht“ pays it anyway); a failed read
leaves the pairs out (`status --json`: `null`), and `analyzr import --json` stays unchanged (it
prints no waiting tasks); (h) the count is exact through a new function in `@analyzr/relations`,
`projectCandidates` (the whole-project candidates and, from the same pass, each model's own), not
the cached whole-project candidates alone, which overcount once only some models wait (5,503
against the exact 2,940 for 50 of 496 models), nor each waiting model's own candidates generated
per summary (5.9–6.9 s on the first summary after a head change).

**Taken during the M6 S2b follow-up step 4 by the implementing agent and the review round's fixer
(the owner may overrule each; details in M6 §8 "S2b follow-up step 4 as delivered" and
DEVELOPMENT.md "The integrate plugin and `tools/integrate`"):** (a) `exporterVersion` is declared
tidied as analyzr stores it without a new `NORMALIZE_BPMN_VERSION`: the model bytes are
unchanged, and a new converter version would change `derived.converter`, which owners' rules for
derived calls match exactly; what analyzr stores changes in two edge cases (models declaring one
version with and without spaces around it now give that version instead of none; one over 100
characters gives none instead of a refused bundle), and `src/version.ts` now says that the
converter version guards the model bytes and the declared derivation, an informational value the
plugin version only; (b) the key that keeps a tool id several keys carry is the one the key map
already gives it, else the oldest model's (the smallest model id) that has a tool folder, and the
report says which (`keptBy`: „(älter)“ only where it holds); without model ids none keeps it and the
files are matched by path; (c) the key rule a rebuild infers is the one that derives most keys
(strip none or a leading folder, prefix none or shared leading key segments), a tie to the simpler
rule; `--strip`/`--prefix` override it only while the map lacks the system, and `--reset` is
refused while analyzr has models of the system; (d) tool paths are compared as analyzr stores them
(ends trimmed, control characters as spaces), so such a file counts as known, not as new; (e)
`analyzr-read.mjs preview` takes only a folder with `analyzr-import.json`, and its `--json-out` only
the script's own three kinds of file (`*.models.json`, `*.external-ids.json`, `*.preview.json`) in
an existing `reports/` next to `analyzr-workspace.json`, never a symbolic or hard link (the hard
link added by the lead), never inside the bundle or a checkout, no folder created: stricter than
the plan, so a pre-approved command can neither send an arbitrary folder nor overwrite
`settings.json` or `keymap.json`; (f) no proxy: the
script sets `NO_PROXY=*` before any request and also refuses to run while Node's proxy support is
on with `HTTP(S)_PROXY` (a second guard; the cost: a guard sandbox that sets it falls back to the
consultant's dry run; dropping the refusal would rely on Node reading `NO_PROXY` at each request,
which a test pins on Node 24); (g) no `GET /health` before the credential is sent (decision 29 (2)
allows exactly three requests, and a health answer proves nothing about who listens); the skill
instead requires `--url` to be the workspace's `analyzrUrl`; (h) `ANALYZR_TOKEN` must look like an
agent token (`analyzr_at_…`; an owner key there is refused), and the skill says to run the real
import without it (`unset ANALYZR_TOKEN`), since the CLI would take the token; (i) the skill offers
no lasting `permissions.allow` rule until your live check (§8) and never one for the CLI; where the
script cannot run, the CLI's `models list`, `models external-ids` and dry run are each approved
once, never with "don't ask again"; (j) exit codes: a refused URL exits 1 (not 2), `preview` exits 1
when a file would fail, as the CLI does, with the JSON printed; `external-ids --system` is
optional; (k) where the web has a text, the report uses the shipped one of steps 3 and 3b (the
cost line, the claimed-task warning, the batch notes) instead of the plan's example sentence;
three plan sentences the web has no counterpart for were kept as the skill's own: „Neue Aufgaben
für den Agenten: 12 Modelle; abgebrochen: 2“, the advice „Warte am besten, bis er abgegeben hat,
oder nimm den Verlust in Kauf.“ after the claimed-task warning, and „Ein Agent platziert gerade;
geänderte Prozesse kommen danach noch einmal.“ for a placement task an agent holds; the
„Kurzfassung“ has four lines, the second the agent work, and for `external-id-moved` in a preview
the report gives no import recommendation but a way back to the keys.

**Taken during the M6 S2b follow-up step 5 by the implementing agents and the review round's fixer
(the owner may overrule each; details in M6 §8 "S2b follow-up step 5 as delivered", DEVELOPMENT.md
"Provenance and the import manifest (M6 S2a)" and UX-SIMPLIFICATION.md §7), the ones you most likely
want to decide first:** (a) **`provenance-kept` now means the derivation**: an unchanged listed file
gets it when it declares another derivation than its revision keeps, `derived.kind` with an absent
one as its own kind („Ohne Angabe“, none declared, as owners' rules for derived calls and decision
28 (1) count it) or another converter of a conversion; the place in the tool no longer raises it (it
is recorded now). It is raised also next to `external-id-changed`, but not next to a `trust-kept`
that names the derivation (the kept class's and the request's reasons differ in `converted`,
`reconstructed` or `as-told`, so that warning already says the request's classification is not
taken), and it goes as a file's fifth warning (the contract allows four). So a bundle imported over
the same bytes first uploaded without one warns on every file (`none declared (this file: export)`):
your rules for „Export“ or „Konvertiert“ do not take those models' calls until their bytes change,
the rules for „Ohne Angabe“ do; a plain moved folder warns on none. The review round narrowed the
plan's "never next to `trust-kept`" to this, since a `trust-kept` for another credential alone (a
model stored as an agent upload, now declared `export` by you) says nothing of the derivation. The
German text „Unverändert: analyzr behält die bisherige Angabe, wie die Datei entstanden ist. Eine
Korrektur braucht geänderte Dateien.“ names no rule; if it should say which of your rules will not
take these calls, say so. Alternatives: an absent derivation counted as `export` (fewer warnings,
but a rule for „Export“ would silently not take those calls), or no warning at all (a
„KI-rekonstruiert“ declared for bytes first uploaded without a manifest would be lost silently); (b)
**„Importieren“ for a recorded identity**: the web offers it also when the dry run says an unchanged
file would record a new place in the tool (before, only for a created or revised file, so the web
could never record an identity-only re-export), and the „Danach:“ line says „Ort im Quellsystem für
6 Modelle aktualisiert“ when no file would be created or revised (beside one the places go along
unnamed, as stored provenance does). After „Importieren“ the headline stays „Kein Modell importiert
· 6 unverändert“ with the toast „6 Dateien importiert“; the review round asked for „· Ort im
Quellsystem für 6 Modelle aktualisiert“ there too, which the plan did not take (about five lines in
`importHeadline` and two tests, if you want it). Alternative: the button without the text („keine
Änderung an Relationen und Befunden.“ next to „Importieren“); (c) **„Herkunft“**: „Im Quellsystem“
and the link „In Signavio öffnen“ (also in „Mehr“, now without waiting for the revisions) come from
the model's identity as the newest import declared it, with the system in the value when the
revision declares none or another („Signavio: Verschoben/…“); an identity without a folder shows no
such line and one without a link no link, never the revision's; „Quelle“ with version and export
date, „Entstanden“, „Hochgeladen“, the losses and „Aufrufe“ stay the revision's, since they describe
the bytes (so after a re-export with unchanged bytes „Quelle“ still names the first export's version
and date). Alternative: „Quelle … (angegeben)“ from the identity's system when the revision declares
none (it would claim a declaration the bytes never had and disagree with the chip and the subtitle);
(d) **a declaration replaces the identity whole**: an entry without tool id, folder or link sets
them null, as a revised file's does, now also for unchanged bytes and silently (no identity warning
without both a system and a tool id, S2a's rule); the key stays in `external-ids` with `externalId:
null`, leaves the identity warnings' protection, and a rebuild matches it by folder only.
Alternatives: a merge field by field (a stale folder would stay when a converter stops declaring
it), or `external-id-changed` for a dropped tool id; the skill's Signavio bundles always carry tool
ids; (e) **the integrate plugin stays 0.1.3**: nothing it reads changes shape. Its preview of an
identity-only re-export says „Danach: keine Änderung an Relationen und Befunden.“ (true: no relation
or finding changes) and then hands over the import command as always, which records the places; its
report label for `provenance-kept`, „Unverändert: analyzr behält die bisherige Herkunft“, is broader
than the warning's new meaning. Both are on the list for its next release (§7 "M6"); you may want
that release before the first customer re-export; (f) **agents**: an `analyzr:write` agent token can
record the identity of unchanged bytes (before, only with new bytes, which re-queue and classify as
`agent-upload`); the row records the agent's principal, and the trust class and `trust-kept` stay as
they are. Alternative: rows for unchanged bytes from humans only (a moved folder would stay stale
after an agent's import). The others: (g) the table `model_identity` with the primary key
`(project_id, model_id, seq)`, `revision_id` not null with a composite foreign key to
`model_revision`, the partial unique `(project_id, revision_id)` for kind `revision` (kept, though
the guard makes it redundant: a second row for one revision hits the primary key first), and no id
column (nothing references a row); (h) one `model.identity_declared` per unchanged file with a new
declaration, its payload without folder and link like the newer events that keep declared free text
out; a stored file's row shares its revision's `model.revised` seq; (i) every stored listed file
gets a row, also with an unchanged identity (one per declared uploaded revision, as the backfill
writes them), an unchanged one only when its declaration differs; a file without a manifest entry
writes and reads nothing; (j) rows survive a deletion: a deleted model is in no live reader, the
change list of its amendments names its newest row, and a revival without a manifest gets the
identity from before the deletion back (as S2a's fallback did); (k) the backfill writes every
declared uploaded revision, deleted models included, at its seq with its principal, time and its
event's client, checked by the guard, so the newest row is what the readers read before (the
migration test pins it); the guard, stricter after the review, also refuses an `unchanged` row for a
deleted model or for any revision but the one the model's bytes are kept as; (l) an unchanged listed
file takes effect in the request's sequence of identity warnings, the consequence is `two models now
carry it` for stored and unchanged files alike, and the unchanged `external-id-changed` reads `this
unchanged file (<system> id <id>) now identifies <key>, which held <system> id <id>`; (m)
`identityUpdated` is a field of each file's outcome, the same in the dry run and the import, not of
`ImportImpact` (no merge change, so no plugin release) nor of the PUT results; no new warning code;
(n) `Model.identity` is on every `Model` (list and get, REST only) instead of a new route or an
overlay on `Revision.source`; `ExternalIdEntry` keeps its shape (no link); (o) `Model.source` stays
the revision's, so a landscape first uploaded without a manifest and then re-imported unchanged with
its bundle shows no subtitle „Aus Signavio“ and no chip until its bytes change, and „Herkunft“ names
Signavio in „Im Quellsystem“ only; (p) the change list names the newest row for live and deleted
models; (q) the CLI's manifest line counts the files with `identityUpdated` (`provenance stored for
2; 4 unchanged keep their first revision's, 3 of them record a new tool id, folder or link`; `1
unchanged keeps its first revision's and records …`), keeps `… K unchanged keep what analyzr had`
when none is recorded, prints the same in the dry run, and `ManifestSummary`'s JSON stays (the
review round made the verb `record`, the plan had "with"); (r) `created_at` from the database's
default, a backfilled row's from its revision; (s) `uploadedSources` keeps its name, joins the
newest row laterally, has no fallback query any more and reads the identity from rows only; (t) a
real import reads the identity per batch, a batched dry run compares each batch with the state
before the import (as for stored files). Recorded readings, behaviour and texts this step changes
(none an owner decision; amendments to recorded decisions: none): (1) CONCEPT §2's "identical
uploads are no-ops" and "an unchanged re-import writes nothing": an unchanged file with a new
declared identity writes an identity row and its event (decision 29 (1) orders the row, and a row
needs a seq); (2) S2a's review reading of `provenance-kept` (its four fields, "or analyzr has none",
never next to `external-id-changed`), now (a); (3) S2a's "an unchanged file never changes an
identity in the request's sequence" and the unchanged wordings of both identity warnings, now (l);
(4) S2b's web rule „Importieren“ only for a created or revised file, now (b); (5) the wording of M6
§3.3 and §3.4 (the identity of "the key's head revision" or of "the newest revision a manifest
declared"), superseded by decision 29 (1) itself; (6) the CLI's manifest line, now (q), and the
web's `provenance-kept` text; (7) step 4's (b): the oldest model with a tool folder, which keeps a
tool id several keys carry, can now be another key than before, since an unchanged import can give a
model its first folder (intended, no plugin change).

**Taken during M6 S3c step 1 by the implementing agents and the review round's fixer (the owner may
overrule each; details in M6 §8 "S3c step 1 as delivered" and DEVELOPMENT.md "The integrate plugin
and `tools/integrate`"), the ones you most likely want to decide first:** (a)
**`RENDER_OUTPUTS['0.1.0']` replaced once**: the review round's layout fixes changed four goldens
(`lanes-gateways`, `collaboration`, `converter-loose`, `reconstructed`), and the fixer replaced the
renderer version 0.1.0's hash instead of moving to 0.1.1, since 0.1.0 was never committed or
released (the test's comment says so); from its commit on, a change of the bytes rendered from the
same spec needs a new `ANALYZR_SPEC_VERSION`. Alternative: the fixed renders as 0.1.1 now; (b)
**`replaces-known-model`** flags a spec the agent wrote (one with `derived`) when its key in the key
map carries a tool id, when its key carries none and the system's last written plan came from
another folder (`plan --write` records the spec folder as `lastExport` with its workspace path,
`specs/2026-10-14-images`, which an export folder's name, without a `/`, never equals), or when it
is a new key analyzr already has (`exists-in-analyzr`). The key map cannot tell an export's key
without a tool id from an earlier picture's, so a re-read picture is flagged again when another spec
folder planned its system in between: one stop too many, never one too few, so the skill text of
step 4 should say that such a spec may replace a tool's model, not that the model comes from an
export. The planned `moved` case was rejected: a spec the agent writes has no tool id, so the plan
matches it by path only, which gives `known`, never `moved`; (c) **the layout goes beyond the eval
layouter** (after screenshots): only a split gateway leaves through its top or bottom and only a
join is entered there; back-edge loops are planned per row and side on their own tracks; self-loops
go round the free side; data associations are orthogonal; a flow label sits in the column gap after
its source's column (a loop's after its target's), and each lane reserves room for its tallest
label; a message flow that would cross a shape of a pool between its ends detours through the free
corridor left of every pool's first column; long flows may need at most 100,000 layout slots, above
that the model fails as `layout-too-large` and the others are bundled. Seen, not fixed: a message
flow from a node can still cross shapes of its own pool below that node, and a task name of nearly
200 characters overflows its fixed 100 × 80 box (both cosmetic; no check flags them); (d) **the
XML** writes processes, participants and lanes sorted by id while the drawing keeps their list
order, so reordering lanes changes only DI bytes; `layout-generated` counts every DI shape, pools
and lanes included; (e) **ids**: besides `<id>_di`, the `<id>_label` and `<id>_plane` of every
element id are taken, since bpmn-js registers labels and drill-down planes under them (the review
showed a lost label and a failed plane otherwise): an element whose id would end in such a suffix
gets `_<hash>` and counts as `id-rewritten`; (f) **limits the plan did not set**: per spec at most
5,000 nodes, 10,000 flows, message flows and data associations together, and 1,000 processes,
participants, lanes and data stores together (`too-many-nodes`, `too-many-flows`, `too-many-parts`);
a note cut at 500 characters in the report; a tool path without empty parts or control characters; a
link taken exactly as written; echoed input cut at 80 characters; a spec file read only as a regular
file, without following a link or waiting on a pipe, and never beyond 2 MB (`not-a-file`,
`too-large`). The others: (g) `render` needs a new `.bpmn` file and refuses the spec's folder; every
output of `analyzr-spec` is refused below the `exports/` of the workspace the input lies in and of
the one the output lies in (the folder holding `analyzr-workspace.json`) and inside a checkout;
`render --origin converter` checks a spec as converter output; (h) a spec folder holding a converter
run's record `analyzr-specs.json` is refused (`run-record`) until step 2 checks it, `bundle`
declares `{kind: reconstructed, converter: null}` with the spec's `llmModel` and `systemVersion`
null, and `as-told` is refused until S6; (i) the validator's `model-name` warning finds the first
process by its id without collision suffixes, an approximation, while the renderer's summary is
exact; (j) the details file's `textTruncated` is a sorted list of `{element, field}`; (k) no golden
of a reference example yet: `reference/analyzr-spec.md` comes with step 4; (l) `spec/plan-args.ts`
and the copies of `capped`, `uniqueId`, `sanitizeLine` and `sanitizeBlock` stay apart from their
originals until step 4, each pinned against its original by a test, and `ANALYZR_SPEC_VERSION` stays
in `spec/version.ts`, so no shipped bundle changes. Recorded readings and concept text this step
changes: those decision 30 (4) decided (A2 and A3, in the spec and the renderer); amendments to
recorded decisions: none.

**Taken during M6 S3c step 2 by the implementing agents and the review round's fixer (the owner may
overrule each; details in M6 §8 "S3c step 2 as delivered" and DEVELOPMENT.md "The integrate plugin
and `tools/integrate`", "`analyzr-convert`"), the ones you most likely want to decide first:** (a)
**a file over 64 MB reaches the converter unread** (the fixer, against plan §4.3, which refused the
run and told the consultant to move the file out of the export, against the skill's ground rule 6
"The export stays untouched"): `sha256` null and `unread` with the reason (for an `.xml` the hint
to export an ARIS database by group), listed in the record's `unread`; a helper called on it throws
`"<path>" was not read: …`; the 512 MB per run count only the bytes sent, and that refusal says to
run on one folder or file of the export at a time. Alternative: refuse the run, with a message that
keeps the export untouched; (b) **typed-array memory is bounded only by the run's time**: the heap
limit (4 GB) does not cover `ArrayBuffer`s and typed arrays, which V8 keeps outside the heap
(measured on Node 24.15: 2 GB of `Uint8Array`s under a 256 MB heap), so a hostile converter the
consultant approved can use up the machine's memory within its 120 s (a denial of service, not an
escape); `sandbox.ts` says so, and no V8 flag limits it. Alternative: a watchdog in the parent that
polls the child's RSS and kills it at, say, 6 GB (on macOS memory compression can hide pages from
RSS); (c) **no network guarantee**: Node 24.15 has no network permission (measured: `net.connect`
works under `--permission`); the converter reaches no network only because its context holds no
host object (a local listener counted 0 connections over every path tried), which the usage text
and the consent draft say instead of a promise. Check it at the next Node upgrade, which may bring
a network permission the child's flags can use, and in your live check (§8); (d) **`import`
refused as a word**: a converter whose text names `import` anywhere, comments and strings included,
is refused before it runs, since without `--experimental-vm-modules` Node rejects `import()` with an
error object of the child's own realm, from which a converter reached the child's
`Object.prototype` (measured); the plan's throwing `importModuleDynamically` needs that flag, and
the refusal suggests `'im' + 'port'` for an element named so; (e) **one tool path or tool id in two
models fails every holder** (`also models[j]'s`; none of them is known to be right), while a model
returned twice byte for byte is kept once and listed in `duplicates` (overlapping AML exports by
group). The others: (f) the converter is compiled inside the context as a function body
(`vm.compileFunction` with `parsingContext`), not run as a classic script, so its top level runs
within the runner's time limit and error handling and its declarations cannot shadow the runner; a
syntax error is reported with its line from a compile in the host that runs nothing; (g) the parent
reads zip directories and applies the guards, the child inflates entries on demand (never beyond the
declared size, size and CRC checked), entries sorted by name as the export's files are; an archive
that fails a guard (also one with a symbolic-link entry) reaches the converter as
`zip: {entries: [], error}` and is listed in `zipRefused`, instead of refusing the run; (h)
`helpers.xml` gives each element `content` (text runs and child indexes in document order) next to
`text`; (i) the record keeps per spec `externalPath`, `externalId`, the losses and the first 5
warning lines with `warningCount` instead of the plan's `notes` (they stay in the spec), gives
`failed` per model the first 5 errors with `errorCount`, and adds `duplicates`, `unread`,
`zipRefused` and `hiddenSkipped`; `convert` refuses (`result`) a run whose record would exceed the
16 MB `analyzr-spec` reads, leaving only the converter copy; (j) the copy is written after the input
checks and after the export is read, not as the plan's step 2, so a run refused by a check or while
the export is read leaves nothing; once the child has started, only the copy stays; `--out` must be
new or empty (choosing a `-2` name is the skill's); (k) `readRunRecord` refuses instead of tidying
(`llmModel` without control characters and at most 120 characters, `systemVersion` already tidy and
at most 100), since `convert` writes only such values; the record check catches mistakes, not
forgery (an agent could write a record too; the skill's ground rule that only the scripts write
specs and bundles and the preview's stop on modelled files and calls remain the guard, plan §3.6);
(l) the child accepts any `--max-old-space-size` (the tests run with 512) and tolerates macOS's
`__CF_USER_TEXT_ENCODING` in its environment; (m) both runs must give the same JSON and the same
sorted list of files and entries read (an honest converter can still differ through stack depth);
(n) limits the plan did not set: at most 10,000 zip entries, methods 0 and 8 only, no split or
encrypted archive, unique safe entry names, no overlapping data, entries up to 1 MB exempt from the
1:200 ratio; at most 10,000 models and 10,000 skipped entries per result, reasons of at most 500
characters; `helpers.xml` at most 64M characters, a raw source id 64K, the inflated-entry cache 256
MB; (o) heap exhaustion is not tested (Node aborts, and macOS writes a crash report per run); the
parent reports it as `out-of-memory` from stderr; (p) `ANALYZR_CONVERT_VERSION` (0.1.0) stays in
`spec/version.ts` until step 4 moves it next to `src/version.ts`, so no shipped bundle changes.
Recorded readings and concept text this step changes: those decision 30 (4) decided (A1, `--derived`
per run, and A4, the runner a script of its own); amendments to recorded decisions: none.

**Taken during M6 S3c step 3 by the implementing agents and the review round's fixer (the owner may
overrule each; details in M6 §8 "S3c step 3 as delivered" and DEVELOPMENT.md "The `analyzr` CLI"),
the ones you most likely want to decide first:** (a) **`--url` in the plugin's printed commands**
(the fixer, against plan §5.2, which left it to the skill; since step 4 always, also for the
default: (a) of "Taken during M6 S3c step 4" below): the plugin's CLI names
`node <path of analyzr.mjs>` (the path shell-quoted only where it needs it, as `shellArg` does) plus
`--url <url>` whenever the run talked to another URL than the default `http://127.0.0.1:7400` (from
`--url` or `ANALYZR_URL`), so its steps are complete as printed and reach the analyzr the import
went to; the checkout's CLI still prints plain `analyzr`, which the skill rewrites to
`<cli> --url "<analyzrUrl>" …` as today, and step 4's skill must pass the plugin's lines, which
start with `node` and the script path, on unchanged, never adding a second `--url`. Alternative:
plain `node <path>`, and the skill inserts `--url` after the script path; (b) **`--owner-key-file`
is not carried** into the printed steps: a step without it fails with a clear "no owner key" error,
while a missing `--url` could write to another analyzr. Alternative: carry it when it was given; (c)
**exit 2 for the parse guard** (plan §5.3, R34), while commander's own usage errors (an unknown
option, a value missing at the very end) keep its exit 1. Alternative: 1 for both; (d) **the guard
refuses only a word that reads as a flag**, two dashes and no whitespace (`/^--\S*$/`; the fixer,
against plan §5.3's "any option value that starts with `--`", which refused free text): `--text
"-- siehe oben"` and `--name "--dry-run x"` pass; `--dryrun`, `--` and `--name=--x` are refused,
and so is a real value without a space such as `--text "--siehe"` (written with a space or another
first character it passes); it does not catch a value with one dash (`--name -n`), a flag written
without dashes or a value missing at the end (commander's error, exit 1); (e) **no proxy refusal**:
before it sends the owner key the plugin's CLI sets `no_proxy` and `NO_PROXY` to exactly `*`, as
`analyzr-read.mjs` does, so Node's proxy support (`NODE_USE_ENV_PROXY`, `--use-env-proxy`) never
tunnels it, also not with `no_proxy=' * '`; porting `analyzr-read.mjs`'s `assertNoProxy` was
rejected, since it would refuse the consultant's CLI behind a proxy, Node reads the variables at
every request (a child-process test pins it) and the owner key works only against a loopback
server anyway. The others: (f) the loopback rule judges the host as fetch parses the URL (`127.1`,
`2130706433`, `[0:0::1]` and `LOCALHOST` pass; `127.0.0.2`, `[::ffff:127.0.0.1]`, `localhost.`,
`a.localhost`, `0.0.0.0` and `127.0.0.1.example.com` do not), refuses a scheme other than `http:`
and `https:` and a URL with a user name or password, never prints the URL as given (it may hold a
password), runs in `ownerCredential` before the key file is read (so the host is said before a
missing key file) and again in `createApi`; `status` says it in its note "no credentials, so no
projects" and exits 0; a redirect cannot carry the key off, since Node 24.15's fetch drops
`Authorization` on a redirect to another origin (checked); (g) the plugin's `--help` keeps
`Usage: analyzr …`, the same on every machine and without a path, and its description says to run
it as `node <path of analyzr.mjs> <command>`; (h) beyond the plan's list, the batch line of a dry
run in batches (`… <cmd> status count them`) and `status`'s hint for an analyzr without projects
(`no projects yet: <cmd> import <dir> --project <key> --create`, without `seed`) name the command
too; the start-prompt line adds `(in analyzr's repository)` for any command but `analyzr`; other
commands' hints (`models external-ids`, `questions`, `amend`) keep `analyzr`, as the plan says;
(i) `CLI_MAIN` moved to `src/cli-main.ts` and `runProgram` lives in `src/core-program.ts`, so no
bundle of `plugin-main.ts` carries a `main.ts` path, `seed` or `mcp`; a static import-graph test
enforces it (not dependency-cruiser), and any new entry must go through `runProgram` or `runCli`,
or it has no guard; (j) no shebang in `plugin-main.ts`, since the bundle's banner writes one (a
second makes rolldown warn `DUPLICATE_SHEBANG`, which `bundle.ts` turns into an error). Recorded
readings and concept text this step changes: none (R33 and R34 are the plan's; decision 30 (3)
takes effect for the CLI core); amendments to recorded decisions: none.

**Taken during M6 S3c step 4 by the implementing agents and the review round's fixer (the owner may
overrule each; details in M6 §8 "S3c step 4 as delivered" and DEVELOPMENT.md "The integrate plugin
and `tools/integrate`"), the ones you most likely want to decide first:** (a) **`--url` always in
the bundled CLI's printed commands** (the fixer, against step 3's reading (a), "`--url` unless the
default"): `pluginCommand` names `node <path of analyzr.mjs> --url <url>` also for
`http://127.0.0.1:7400`, since a step pasted into a shell whose `ANALYZR_URL` names another analyzr
would otherwise go there (a test runs `--url http://127.0.0.1:7400` with `ANALYZR_URL` naming
another); the skill passes these lines on as printed, never with a second `--url`, and rewrites only
the checkout's `analyzr …` lines. Alternative: step 3's form; (b) **pictures in a tool's export go
to the system `images`** unless a picture shows that tool's model (a screenshot or a printout of
it), the fixer's reading of plan R10 ("the tool it shows"): whiteboards, flipcharts and drawings get
keys of a system of their own, so they never take a tool model's key. Alternative: the export's
system with a key prefix; (c) **„unverändert“ in two meanings** (a review finding, rejected): the
„Kurzfassung“'s „6 Modelle unverändert“ is the Art `export` (bytes passed on as the tool wrote
them), as section 4 of the report labels it, while the „Vorschau“'s „2 unverändert“ means bytes
analyzr already has; it is the plan's own wording (R30), and a change would touch both labels.
Alternative: „6 Modelle wie exportiert“; (d) **confirmation 4 per converter version and export**:
asked before a converter version runs on an export for the first time; a rerun of the same bytes on
the same export into a new folder asks nothing new, a new export or a new sha256 asks again; (e)
**`replaces-known-model` has a way out**: with a tool id or `exists-in-analyzr` the skill asks
whether the picture gets a key of its own or is left out, without one also whether it is the same
model as an earlier picture's (then the plan stays); a key of its own moves the spec to
`specs/<date>-images` and plans it as the system `images` (`--prefix bilder` on that system's first
import; under `images` already, another `source.externalPath`), leaving out deletes the agent's own
spec, and a picture's tool path is never `--exclude`d (exclusions hold for every path of a system
and would leave the tool's own model out of every later bundle); (f) **no `@analyzr/cli`
devDependency of `tools/integrate`**: with one, `pnpm install` links the CLI's bin and makes
`apps/cli/src/main.ts` executable on every install; `ENTRIES` names the entry by its relative path,
so no package graph shows that `analyzr.mjs` bundles `apps/cli`, the client, the contracts and the
root `package.json`'s version, and a filtered test run after a change there must include
`@analyzr/integrate` (§9, DEVELOPMENT.md); (g) **no `exporter="analyzr-spec"` flag in
`normalize-bpmn`** (the plan's optional item): it would change the output and the versions of
`inspect` and `normalize-bpmn`, while `render` refuses outputs below `exports/` and ground rule 8
plus the preview's stop cover a BPMN written past the renderer. The others: (h) folders of their own
per path: the BPMN files' bundle `bundles/<date>-<system>`, a converter's specs
`specs/<date>-<system>` (`…-converter` when the export also has BPMN files of that system), the
pictures' `specs/<date>-<system>-images` (`specs/<date>-images` for `images`), a spec folder's
bundle under its name below `bundles/` and its details files `reports/<spec folder>.<command>.json`,
so no path overwrites another's; (i) one report per export with one part per bundle, the new
sections 4a „Konverter“ and 4b „Aus Bildern rekonstruiert“, so the numbers of the other sections
stay; (j) the decision-30 (2) line opens „Offene Punkte“ (until 0.1.5) for every bundle with
`counts.reconstructed` above 0, from pictures or a converter; (k) a model of the run's other bundle
or of a picture spec folder of the system is never called absent or offered for deletion in another
path's plan, bundle or preview („Absent, but from another path“), and a file counts as „nicht
übernommen“ only when no confirmed path took it over (`analyzr-specs.json` not listed as skipped);
(l) the preview stops a spec bundle (no import recommended) when it shows `counts.modelled`,
`impact.acceptedCalls` or `impact.callsProposed.count` above 0, since a rendered spec is always
derived and carries no call target; (m) a recorded `cli` is never replaced, a recorded `null` stays
and step 7 offers the bundled CLI, and the report's bundled-CLI command holds the installed
version's path and says to ask for the new one after a plugin update; (n) `sanitizeLine` and
`sanitizeBlock` stay pinned copies in `src/spec/text.ts` (bundling bpmn-facts would bring zod into
`analyzr-spec.mjs`), while `plan-args.ts` moved to `src/`, `capped` and `uniqueId` are shared and
the spec's and the runner's versions live in `src/version.ts`; (o) the plugin's notices list
rolldown 1.2.12 (its runtime helpers are in the three new bundles), `@asteasolutions/zod-to-openapi`
9.1.0 (in the module graph, its code tree-shaken) and `@hey-api/openapi-ts` 0.99.0 for the client's
runtime (`GENERATED_RUNTIMES` in `scripts/bundle.ts`); (p) `converters.md`'s skeleton is a compact
page converter (no pools, lanes, data stores, message flows or off-page references; the plugin ships
no fixtures), run by a test on the Visio fixture; (q) `--derived reconstructed` without
`--llm-model` exits 2 (a usage error), and a converter's spec edited after the run is refused with
"never edit a converter's spec; fix the converter and run it again into a new folder"; (r)
`validate` still skips a symbolic link in a spec folder without a word (the agent writes specs with
its own Write tool); (s) the Signavio example of step 2 looks at the PDF first: a landscape map is
left out and named, a process the BPMN files lack is read. Recorded readings and concept text this
step changes: step 3's (a) (now (a) above), step 1's (b) (the skill says such a spec "may replace" a
tool's model), step 2's message for a changed spec (now (q)), M6 §3.7's "until plugin 0.1.4 only the
BPMN path ships" (now three paths); amendments to recorded decisions: none.

**Taken during the decision-30 (2) safeguard step by the implementing agents and the review round's
fixer (the owner may overrule each; details in M6 §8 "Decision-30 (2) safeguard as delivered" and
DEVELOPMENT.md "Auto-accept rules (owner decision 19)"), the ones you most likely want to decide
first:** (a) **every owner's rule**: the safeguard covers agent rules and also rules for derived
calls, on the callee side, so a rule for `export` no longer accepts a unique call from an export
into a reconstructed callee (decision 19's record of 30 (2) said "no rule will accept", read as
literally as S2c-3 read decision 28 (1)); the trust class and the rule tier still read only the
caller (decisions 24.2 and 28 unchanged: this is a safeguard on owners' rules), a callee an agent
token uploaded stays unblocked as S2c-3 left it, and decision 9's system rule still accepts a
modelled caller's unique call into a reconstructed callee at ingest (it is no owner's rule; rare,
since such a model's process ids come from the renderer's id function, A3). Alternative: agent rules
only; (b) **the declaration counts, not the class**: `derived.kind` of the uploaded revision (an
amended head: its `source.upstream`'s, so an amendment never lifts it), so a revision stored between
S2a and S2c without a class counts too and an owner's „Behalten“ (S2c-4) does not lift it; identical
bytes keep it (`provenance-kept`), changed bytes without a declaration lift it (the older proposals
then need „Anwenden“), and a manifest-less upload (only a spec bundle's `.bpmn` files dropped into
„Hochladen“) declares nothing and is not blocked (the skill always sends the bundle folder with
`analyzr-import.json`). Alternative: the class; (c) **no undo and no list**: acceptances a rule made
on such models before this step stay in force and revocable as before (per rule „Widerrufen…“, per
item on the review screen); none is recorded in the projects the repository knows (the corpus is
Camunda only, no seed has rules, the demo takes no writes, plugin 0.1.4's picture path has not run
live), and on a stack of your own you find any by the chip „KI-rekonstruiert“ and „Widerrufen…“ per
rule; the rule's „Bisher“ and „Automatisch angenommen, nicht geprüft“ no longer count them, since
the replay asks what the rule would accept now. Alternative: a one-time list like „Vor der
Vertrauensregel angenommen“ (about 1 d more); (d) **the label only, no new page lead** (the plan's
alternative, which its critique recommended under the no-overload principle): „Modell
KI-rekonstruiert oder aus Interview“ appears exactly where a rule is held back (the rule dialog's
live preview and „Anwenden“'s dry run, under „Erfüllen die Regel, aber eine Schutzregel hält sie
zurück:“); the page lead of „Annahmeregeln“ and the derived-call hint („Die Herkunft gibt der Import
an; analyzr prüft sie nicht. Über ein Agenten-Token hochgeladene Modelle nimmt keine Regel an.“)
stay as they are (the label covers it). Alternative: the lead's clause „…, und nie an
KI-rekonstruierten Modellen oder Modellen aus Interviews.“; (e) **the report line dropped without a
replacement**: 4b's „Prüf sie bitte gegen die Vorlage, bevor du ihnen vertraust“ stays. Alternative:
one sentence in 4b, „Relationen und Platzierungen an diesen Modellen nimmt keine Annahmeregel an;
sie warten in der Prüfung auf dich.“ The others: (f) `as-told` is blocked now: no model declares it
before S6, so S6 needs no server change, and a contracts test makes every future `DerivedKind` land
on purpose either among the kinds a rule for derived calls may name or in `UNSEEN_DERIVATIONS`; (g)
the order: right after `agent-upload`, which is reported when both apply, before
`amendment-conflict`, so a reconstructed process's `@outside` or removed step reports
`reconstructed-endpoint` (blocked either way); (h) the endpoints: both ends of a relation, a
placement's process only (a value chain carries no derivation in analyzr); (i) whose head: the write
paths read the head the write sees, „Anwenden“, the preview and its replay the current head (the
documented approximation); a model that is not live reads as not reconstructed (`endpoint-not-ok`
blocks its items anyway), and so does an amended head whose upstream row is missing (fail-open like
the trust rule, pinned by a test; revisions are append-only, so practically unreachable); (j) humans
unchanged: „Gesammelt annehmen“ and the key tier's bulk preselect pairs on such models as before,
but the toast after a bulk accept offers „Gleicher Name ab 100 % künftig automatisch annehmen?“ only
while some accepted pair other than a derived call has neither end in such a model, and the rule for
derived calls only by calls into other callees (by `Model.source.derived`; offered as before while
the models have not loaded); (k) the CLI's owner-rule suggestion after an import (from the plan's
critique): it skips calls into files of this import whose kept trust reasons include `reconstructed`
or `as-told`; a callee imported earlier, or an unchanged one stored before S2c without a class, is
not looked up (one `GET …/models` more per import), so the line may name a rule that accepts none of
those calls, which `rules add` creates off and prints with its preview, whose blocked line, like
the one of `rules apply`'s dry run (`rules enable`'s count leaves such calls out), would then
name `reconstructed-endpoint`. Alternative: the exact lookup; (l) the plugin–server skew: plugin
0.1.5 drops the warning and assumes an analyzr with this step (the skill checks no server version;
both come from one repository state), and the 0.1.4 bundled CLI against the new server prints the
new code as it comes; (m) no migration: the reason is not stored, the ledger and the rule statistics
are unchanged, and the `eval:replay` what-if mirrors no derivation (the corpus has none); (n) the
names: the code `reconstructed-endpoint` (it covers `as-told` too), `hasReconstructedEndpoint` and
the evaluators' required field `reconstructedEndpoint`, and `UNSEEN_DERIVATIONS` and
`isUnseenDerivation` exported by `@analyzr/contracts` for the server and the CLI, while the web
keeps a copy so its runtime stays zod-free (a parity test); (o) an agent token's upload of changed
bytes of such a model without a manifest stores a revision that declares nothing and lifts the
safeguard for its messages, signals, triggers and placements and for calls into it (`agent-upload`
blocks only its own calls): built as worded, pinned by a unit test, asked in §8. Recorded readings
and concept text this step changes: decision 19's and 30 (2)'s "not built yet" (now delivered),
S2c-3's "only the caller's class counts" for owners' rules (now also the callee's declaration; the
class and the rule tier unchanged), S3c step 4's (j) (the line is gone in 0.1.5), CONCEPT §2's
trust-rule sentence, §3 step 5's safeguards and §6's two rule risks; amendments to recorded
decisions: none.

**Taken during M6 S6 steps 1–2 by the implementing agents (the owner may overrule each; details in
M6 §8 "S6 steps 1–2 as delivered" and DEVELOPMENT.md "The integrate plugin and
`tools/integrate`"), the ones you most likely want to decide first:** (a) **the consultant's own
work stays out of a guide** (the fixer, from the guide review): the kinds `extractor-loss`
(„Elemente beim Import verloren“), `unjudged` („Paare ohne Urteil“) and `amendment-conflict`
(„Ergänzung nicht mehr anwendbar“) are work in analyzr, not questions for an interviewee, so no
guide asks them; `groups` counts them as `leftOut.technical`, and the skill says so in
confirmation 1, while `duplicate-process-id` stays in (which copy is current, the business can
answer). Alternative: ask them too, as everything of the group `ask`; (b) **the consent part
beyond the checklist** (decision 31 (3); the owner may want to confirm it): the first box carries
the decision's three uses in one line („Einverständnis eingeholt: Aufzeichnung oder Mitschrift,
Auswertung mit einem KI-Assistenten (Namen vorher ersetzt), Ergebnis in analyzr ohne Namen“, not
the plan's „Ergebnis als Prozessmodell ohne Namen in analyzr“, since answers reach analyzr too),
the second „Gesprächspartner nur mit ihrer Rolle notiert, ohne Namen“; below them a paragraph for a
missing consent (no recording: notes only; no evaluation with an AI assistant: transcript and notes
not under `transcripts/` and to no AI assistant, the answers entered in analyzr by hand), and under
„Abschluss“ where the transcript goes, ending „Solange Namen darin stehen, geht es an keinen
KI-Assistenten.“ Alternative: the checklist alone, in the decision's words; (c) **transcripts in
the workspace before the read lock** (the security review, fixed in part): until step 4's
interview-facts brings the read lock with its canary, only the skills' texts keep an agent out of
`transcripts/` (integrate-landscape's ground rule 4, interview-guide's 5), while Claude Code's Read,
Grep and Glob read the working folder without asking; the guide and the hand-over tell the
consultant to give no transcript with names to an AI assistant. Alternatives: tell consultants to
keep transcripts outside the workspace until step 4, or have the skill print the deny rule
`Read(./transcripts/**)` now (its path form unverified until the live session); (d) **the
landscape over an MCP server of its own** (the fixer, from the security review): in Claude Code
too the agent uses only `mcp__analyzr-lesen__…`, a server the consultant adds in a terminal with
the `claude mcp add` line that `token create … -s analyzr:read` prints, named `analyzr-lesen`, and
only six read-only tools (`list_processes`, `get_process`, `which_processes_use`,
`find_unlinked_events`, `get_value_chain`, `get_landscape` up to 40 models; a test checks each is
`readOnlyHint: true` in the MCP snapshot), never `mcp__analyzr__…`, whose token may be an analysis
run's that can propose. Alternative: a read-only token for the usual server `analyzr`; (e)
**„Die Landkarte kennt in diesem Bereich“ only from the notes' `known`**: the plan's fallback to
the group's subjects listed only a few processes and leaked model keys. Alternative: the fallback;
(f) **every action, not only the primary one**: „In „Offene Fragen“ danach, je nach Antwort:
„Liegt außerhalb der Landschaft“ oder „Verknüpfen mit …““ (from the JSON only; the record gains
`actions`), so the line no longer reads like the expected answer. Alternative: the primary action
alone, as planned. The others: (g) the questions file only below `interviews/questions/`, as
`<YYYY-MM-DD>.questions.<json, md or csv>` (a regular file of at most 20 MB in UTF-8, no symbolic
or hard link; `interviews/` and its two folders real folders, no links): the skill first copies a
file the consultant names there with `cp -n` under that name, the path in single quotes, never
from `transcripts/`, so the script can be pointed neither at a transcript nor at a credential
file; the notes file and `--out` only in `interviews/guides/`, `--out` a new `.md` and never a
link, an existing guide kept unless `--replace`; (h) the CLI's read command adds `--group agent`,
so `--include-agent` has the agents' questions on their proposals, and it works from the Markdown
and the CSV too (the exports name such a question by its kind „Frage eines Agenten“); (i) a slug
is the whole label by the server's file-name rule (`organisationseinheit-lager`,
`lanes-disposition-versand`), unique with `-2`, the same from JSON and Markdown; „Ohne
Ansprechpartner“ is not split by folder (the server's export never groups by folder; the skill
says the models name nobody there); (j) several groups: the file's order across all chosen groups
(plan R11), `--max` cuts that order, the warning `group-cut` names a chosen group it leaves empty
and `group-empty` one with nothing to ask, the title and the record name only groups that keep a
question, and every question gets its „Ansprechpartner“ line; a Markdown export lists group by
group, so a guide of several groups from it says „je Ansprechpartner in der Reihenfolge …“; (k)
above 20 questions the skill says in confirmation 1 that it takes the first 15 (step 4 passes
`--max 15`) unless the consultant writes „alle“, so no second message is needed; (l) the notes check
runs against the chosen groups' questions before `--max` (the notes of a question `--max` cuts stay
unused), refuses a question id in a text (`notes-question-id`) and warns of „Sie“ and „Ihnen“
anywhere and „Ihr…“ inside a sentence (`address-form`), and personal data in analyzr's own texts of
a question is a warning (`personal-data`, naming `F<n>`, the id and the field, never the value);
(m) no pointer to what does not ship yet: the closing quote says „Zusammenfassung“ instead of
„Faktenblatt“, and the hand-over says how the answers map back today (the web shows no ids: find a
question in „Offene Fragen“ by its text and „Betrifft“; by id through „Zum Ausfüllen (CSV)“ and
„Antworten aus CSV übernehmen …“) instead of „Das Auswerten kommt mit der nächsten Version“; a test
fails on a text that names a skill or script the plugin does not ship; (n) the generator lives in
`tools/integrate`, not in `packages/procedures` as M6 §3.7 planned (the plan's R1: one `generate`
and one drift test for the whole plugin, and `packages/procedures` pins released procedures); if
S7 serves the texts as MCP prompts, it moves the sources, and a changed byte of a skill then needs
a plugin version; (o) interview-guide has no `allowed-tools` (`guide` writes files; the CLI's read
and every script ask), integrate-landscape's is byte for byte as before; (p) the copies of the
server's rules (`src/interview/server-rules.ts`: `askWhoGroup`, `contactText`, `detailText`, the
file-name slug, `escapeMarkdown`, `formatDateDe`) are tested against the server's source text and
the Markdown and CSV fixtures against the server's renderer, loaded at run time by a test; nothing
in `src/` imports from `apps/`; (q) the clock check forbids `Date.now`, `new Date()` without an
argument and `performance.now` in the script's own regions; the verbatim `formatDateDe` keeps
`new Date(at)`, which parses a timestamp of the file; (r) the picture start prompt carries a
complete `analyzr-spec/1` example that a test validates and renders, since a Desktop chat has no
`REFERENCE/`; (s) an empty Markdown export reads as 0 questions, and the skill says there is
nothing to ask. Recorded readings and concept text this step changes: M6 §3.7's "Skill texts" (the
generator in `packages/procedures`, now in `tools/integrate`), M6 §5 item 1's "REST export now" (now
a file: the CLI's JSON, else the web's Markdown or CSV) and the S6 plan's „Sie“ by default with a
switch (decision 31 (2)); amendments to recorded decisions: none beyond decision 31 (1), which the
owner made.

## 5. What exists

| Path | Content |
|---|---|
| `packages/contracts` | zod schemas, API resources, OpenAPI 3.1 (contracts-first routes); zod-free subpaths the web may import (`paths` since M6 S1, `open-question-labels` since M6 S4, `open-question-csv` and `personal-data` since M6 S5a; since M6 S5c-1 the labels also name the actions, states and answer roles, and `OpenQuestion.actions` and the action and withdrawal routes are in the API; since M6 S5c-2 `amendment-labels`, the routes of tag `amendments`, `RevisionSource.kind` `amendment` with `upstream` and the plan, and `amendments` and `uploadedRevisionId` in the import and PUT results; since M6 S2a `api/import-manifest.ts` with `ImportManifest` (`analyzr-import/1`), `ImportWarning` and `ExternalIdList`, the typed provenance on `RevisionSource`, `importWarnings` in the import and PUT results, the part `manifest`, the header `Analyzr-Manifest`, `GET …/external-ids` and the open-question kind `extractor-loss`; since M6 S2b's follow-up step 1 `ImportImpact.relationsTasks` and the zod-free `impact-merge`, the dry run's merge of its batches that the CLI and the web share (since step 4 the integrate plugin's `analyzr-read.mjs` too); since its step 2, only with a live value chain, `ImportImpact.placementsChanged` (`ImpactPlacement`) and `placementTask` (`ImpactPlacementTask`), merged there too; since its step 3b `ProjectSummary.pairsToJudge`, the size of the agents' next run; since M6 S3c step 4 the integrate plugin's bundled CLI `analyzr.mjs` carries the whole package with zod, so a change here needs `generate` and a new plugin version, decision 30 (3); since the decision-30 (2) safeguard step the block reason `reconstructed-endpoint` and `UNSEEN_DERIVATIONS` with `isUnseenDerivation` in `api/auto-accept.ts`) |
| `packages/client` | hey-api client generated from the OpenAPI document (drift test); since M6 S3c step 4 also bundled into the integrate plugin's `analyzr.mjs` (decision 30 (3)) |
| `packages/bpmn-facts` | C7/C8 fact extraction, hostile-XML protection, `FACTS_VERSION`; since M6 S5c-2 `applyAmendments` and `readAmendable` (byte-preserving splices of model amendments, checked by extracting again; never a bpmn-moddle round trip) |
| `packages/relations` | rule tier (unambiguous calls, key-tier proposals, findings), candidates for agents (since M6 S2b's follow-up step 1 with `indexCandidates`, the landscape-wide part computed once for many focus models; since step 3b `projectCandidates`, the whole-project candidates and from the same pass each model's own, for the summary's pairs to judge), `baseline-label/1`, pair assessor, and since M4 S2 `baseline-prefix/1` and the name-stem rule for placements (`placement.ts`) |
| `packages/procedures` | the released procedures `analyzr-relations@0.2.0` (`relations.md`; judge each pair once) and `analyzr-placements@0.1.0` (`placements.md`, `kind: placement`, M4 S5; judge each process once), the wrappers for the `work_pipeline` and `place_processes` prompts and the Claude Code skills, the `draft_value_chain` prompt text (`prompts/`), the skill generator and drift tests |
| `plugins/analyzr`, `.claude-plugin/marketplace.json` | Claude Code plugin 0.3.0 with the generated skills `/analyzr:relations` and `/analyzr:placements [project] [max-tasks]`; its own version since two skills ship (a test pins every skill's sha256 per plugin release); the marketplace lists both plugins since M6 S3b |
| `plugins/analyzr-integrate` | the second Claude Code plugin (M6 S3b, 0.1.4 since S3c step 4, 0.1.5 since the decision-30 (2) safeguard step: the bundled CLI rebuilt with the contracts, the report without „Bis analyzr das ausschließt, …“; 0.1.6 since M6 S6 step 2: the interview guide) for interactive, non-pipeline skills: `/analyzr-integrate:integrate-landscape <export> [--workspace <dir>]` turns a customer's export into import bundles `analyzr-import/1` and a German report in the consultant's workspace, on three paths (BPMN 2.0 normalized; since 0.1.4 Visio, ARIS AML and other machine-readable formats through an ad-hoc converter the agent writes and the consultant approves per version by its sha256, and pictures and PDFs the agent reads itself into `reconstructed` specs, decision 30), keys pinned in `keymap.json` (since 0.1.3 rebuilt from analyzr when lost), since 0.1.3 previews the import itself into an existing project (the report's „Vorschau“ with the agent work), never imports (the consultant does, without a checkout since 0.1.4 with the bundled CLI); since 0.1.6 `/analyzr-integrate:interview-guide [<questions file>] [--workspace <dir>]` turns analyzr's open questions (the CLI's JSON list, else the web's Markdown or CSV export, in the workspace's `interviews/questions/`) into a German interview guide per contact group in `interviews/guides/`, every question verbatim with its id, the interviewee addressed with „du“ and a neutral consent checklist first (decision 31), with the bundled `analyzr-interview.mjs` (`groups`, `guide`) and `reference/interviews.md`; it pre-approves nothing, never writes to analyzr and reads the landscape only over a read-only MCP server of its own, `analyzr-lesen`; both skills keep the agent out of the workspace's `transcripts/`, and both `SKILL.md` are generated from `tools/integrate/skills/`; reference notes per tool (unverified; since 0.1.4 also `images.md`, `analyzr-spec.md` and `converters.md`), the bundled scripts `inspect.mjs`, `normalize-bpmn.mjs`, since 0.1.3 the read-only `analyzr-read.mjs` (the two read-only ones pre-approved, the pre-approval not yet tried live, §8) and since 0.1.4 `analyzr-spec.mjs` (the renderer), `analyzr-convert.mjs` (the converter runner, never pre-approved) and `analyzr.mjs` (analyzr's CLI without `seed` and `mcp`), since 0.1.6 `analyzr-interview.mjs` (the interview guide; no network) (generated) and their notices; a sha256 per plugin release in `tools/integrate/test/plugin.test.ts`; never loaded in live runs |
| `tools/integrate` | `@analyzr/integrate` (M6 S3b, decision 24.8): the sources and tests of the integrate plugin's scripts (`inspect`, `normalize-bpmn` with `file`, `plan` (since M6 S2b's follow-up step 4 with `--from-analyzr`, the pure `rebuildFromAnalyzr` and `inferRule` in `src/keymap.ts`), `bundle`, `inventory`, and since step 4 `analyzr-read` with `models`, `external-ids` and `preview`: `src/analyzr.ts` the request guard and the credential, `src/preview.ts` the bundle walked as the CLI walks it and the batches merged with `@analyzr/contracts/impact-merge`), bundled by `pnpm --filter @analyzr/integrate generate` with a drift test (`analyzr-read.mjs` holds only Node built-ins, its sources and the zod-free `@analyzr/contracts/paths` and `/impact-merge`); since M6 S3c step 1 the sources of `analyzr-spec` in `src/spec/` (the `analyzr-spec/1` types, the YAML reader that refuses tags, anchors and aliases, the validator, the id function with category prefixes, the layout, the renderer with its self-check, the spec bundle) with the entry `src/cli/analyzr-spec.ts` (`validate`, `render`, `plan`, `bundle`), bundled as `analyzr-spec.mjs` since plugin 0.1.4, with `yaml` as a dependency and `bpmn-js` for its tests only; since S3c step 2 the converter runner `analyzr-convert` (the entry `src/cli/analyzr-convert.ts` with `convert`; in `src/spec/` the parent `converter.ts`, the child `child.ts` with the in-context helpers of `inner.ts` in the sandbox of `sandbox.ts`, the zip reader `unzip.ts` beside the unchanged `src/zip.ts`, the run record `record.ts`, which `analyzr-spec plan` and `bundle` check), bundled as `analyzr-convert.mjs` since 0.1.4; since S3c step 4 the generate script also bundles `apps/cli/src/plugin-main.ts` into `analyzr.mjs` (with the client, the contracts, zod and commander; no package dependency shows it, decision 30 (3)), the modules the entries share are `src/plan-args.ts`, `src/ids.ts` and `src/version.ts`, and the drift test runs every bundle from a copy away from `node_modules`; a synthetic Signavio-style export and its golden bundle, which the CLI and web tests import; since S3c step 1 nine synthetic golden specs with their renders (`RENDER_OUTPUTS`); since step 2 a synthetic Visio export (VSDX parts the tests zip) and ARIS AML export with their example converters (`test/fixtures/converters/`, unverified); since M6 S6 step 1 the skill text generator `scripts/texts.ts` (`renderTexts`, called by `generate`, compared by the drift test) with one source per skill, `skills/<skill>/skill.src.md` and `start-prompt.de.src.md`, and the shared fragments of `skills/_shared/`, writing the plugin's `SKILL.md` files and the Claude Desktop start prompts `start-prompt-{integrate-landscape,interview-guide}.de.md`; since step 2 the interview guide `analyzr-interview` (`src/interview/`: the readers of the CLI's JSON and the web's Markdown and CSV, the server's export rules copied and tested against its source, the notes check, the guide and its German texts; the entry `src/cli/analyzr-interview.ts` with `groups` and `guide`), bundled as `analyzr-interview.mjs` since plugin 0.1.6, and the shared strict YAML reader `src/yaml.ts`, with synthetic interview fixtures (`test/fixtures/interview/`: the questions as JSON, Markdown and CSV, a notes file, 4 golden guides pinned by `GUIDE_OUTPUTS`); a fake analyzr for the script's tests; imported by nothing in `apps/` or `packages/` |
| `examples/agents` | reference setups: Claude Code (interactive and `run-headless.sh [--skill placements]`), Claude Desktop (configs + German start prompts for relations, placements and drafting a chain; since M6 S6 step 2 two generated ones on the read-only connector `analyzr-lesen`, an interview guide from the Markdown export and specs from pictures and PDFs), Codex; documentation, not in the image |
| `apps/server` | Hono server: domain (pure, dependency-cruiser enforced), Drizzle/PostgreSQL, REST `/api/v1`, MCP `/mcp` (stateless Streamable HTTP), local mode, agent tokens, pipeline, review; since M4 S1/S2 the value chain and placements (`src/domain/value-chain/`: storage, lifecycle, `prepareRevision`, rule proposals, findings; REST under `/value-chains`, six MCP tools; the web page since S3); since decision 19 the owner's auto-accept rules (`src/domain/auto-accept/`, seven owner-only routes and the ledger for every reviewer, no MCP); since M6 S4 the open questions (`src/domain/open-questions/`: one read model over findings, chain findings, holds, agents' questions, unsure verdicts, coded no-links, summaries and unjudged pairs plus the gap signals, computed on read; `GET …/open-questions` and `…/open-questions/export?format=markdown\|csv`, permission `read`; no MCP until S7); since M6 S5a the answers (the append-only `open_question_answer`, migrations 0011/0012; `POST …/open-questions/{q}/answers` and `…/open-questions/answers?dryRun=`, permission `review`, humans only; on a relation or placement a human note through the note use cases); since M6 S5c-1 the actions (`open-questions/actions.ts`, pure: each item's actions, R1 and R1b, what a link writes or accepts; `POST …/open-questions/{q}/actions` for link, place, choose copy and the outside mark, `…/answers/{a}/withdrawal`, permission `review`, humans only; the append-only `open_question_answer_withdrawal`, migrations 0013/0014; items versioned by what they ask about; the safeguard `competing-call` also counts a human's manual link from the call element to another target); since M6 S5c-2 the model amendments (`src/domain/amendments/`, pure: planning against the uploaded revision, the fields a human may set, derivation, effect and cost, the change list; the append-only `model_amendment` and `model_amendment_withdrawal`, migrations 0015/0016; uploaded plus amended revisions with the plan on the head; the routes of tag `amendments`, `review` and `write`, humans only; the open question `amendment-conflict`); since M6 S2a provenance and stable identity (`src/domain/provenance.ts`, pure: the manifest checked, the uploaded revision's declared `source`, the import warnings, the `external-ids` list; readers follow an amended head's `source.upstream`, and since M6 S2b's follow-up step 5 take the system, tool id, tool folder and link from the model's newest row of the append-only `model_identity` (migrations 0021/0022 with the triggers, the guard and the backfill; written also for an unchanged file whose declaration differs, with the internal event `model.identity_declared`; `Model.identity`, REST only), before it from the newest revision a manifest declared; `model_revision.extract_warnings`, migration 0017; the open question `extractor-loss`); since UX2a (decision 26) the open questions' groups (`group` on every item from a `Record` over the kinds: `ask` „Zu klären“, `agent`, `proposal`, `info`; the repeatable `group` filter; `totals` and `askByModel` on every page), the question first with its reason apart (`text`, `detail`), the customer export in plain German (dated, „Betrifft“, no folder, the id only in HTML comments, the CSV column `Ansprechpartner`, `ask` by default under the old file name); since the first wave's review an agent's coded no-link joins the rule tier's item about the same gap (read model only) and a primary link reads „Verknüpfen mit …“; since M6 S2c-1 the trust rule (`src/domain/trust.ts`, pure: the class stored on every uploaded revision as `source.trust`, a unique call of a derived caller proposed at 0.9 instead of accepted, a call target set in analyzr modelled; `callsProposed` in the dry runs, the import warning `trust-kept`; no migration, no MCP; since S2c-2 the system rule counts only the calls a bulk accept takes, the contracts' `isBulkDerivedCall`; since S2c-3 the owners' rules for derived calls: `proposedBy`, `derivedKind` and `converter` on the rule revisions with migration 0018, the safeguards `agent-upload` (every rule) and `amendment-conflict`, the fifth write path `autoAcceptDerivedCalls` after the recompute of an import, an amendment write or a deletion, `ImportImpact.autoAcceptedCalls` for owners, `derivedGroups` in the preview; since S2c-4 the owner's review of the acceptances from before S2c, „Vor der Vertrauensregel angenommen“: `src/domain/use-cases/trust-review.ts`, `preTrustAcceptances` and `storedTrust` in `trust.ts`, the append-only `revision_trust_review` with migrations 0019/0020, `GET …/pre-trust-calls` and `POST …/pre-trust-calls/review?dryRun=`, owners only, the event `revision.trust_reviewed`); since the decision-30 (2) safeguard step the block reason `reconstructed-endpoint` (`hasReconstructedEndpoint` in `auto-accept/evaluate.ts`: no owner's rule accepts anything with an end in a live model whose uploaded revision declares `reconstructed` or `as-told`, in every write path, apply, the preview and the dry runs; no migration); since M6 S2b the dry runs and the deletion impact (the pure `src/domain/import-impact.ts` over `planRecompute`, permission `read`, nothing written), since its follow-up step 1 with the relations tasks the write would queue and cancel (the pure `src/domain/queue-plan.ts`, which the write's `queueAnalysis` shares), the pairs agents then judge and those judged again (`pairsToJudge`, `judgementShift` in `judgements.ts`), and the amendment cost counted the same way; since step 2, with a live value chain, the accepted placements whose process the write changes or removes and the placement task's outcome with the processes due, newly due and placed again (the pure `src/domain/value-chain/model-impact.ts` over the pipeline's pure `pipelineInputs`, which `loadPipelineInputs` shares; the rule tier planned by `planRulePlacements`, which the write's `recomputeRulePlacements` shares; one stored fact order, `src/domain/fact-order.ts`); since step 3b the summary's `pairsToJudge`, the pairs the next claims of the claimable relations tasks will be assigned (`countPairsToJudge` in `src/domain/use-cases/projects.ts` over the open questions' candidate pass, `heldPairs` in `judgements.ts`; the summary memo holds until the earliest live lease runs out) |
| `apps/cli` | `analyzr health / status / import (reads analyzr-import.json since M6 S2a) / seed [--project --issue-tokens --token-name --value-chains] / models list\|requeue\|delete\|external-ids [--system] / questions [list] [--model --kind --source --ask-who --state --group (since UX2a) --format text\|md\|csv\|json -o] / questions answer <id> --text \| --from <csv> [--dry-run] (notes; `--kind` refused since M6 S5c-1) / questions outside <id> [--note] [--undo <answer>] / questions link <id> --to <target>… \| --pair <from> <to> [--note] / questions place <id> --step <id>\|@outside \| --process <target> [--note] / questions amend <id> / models amend <key> --element <id> … \| pull <key> [--original] / amendments list\|export\|withdraw [--rev] / token create\|list\|revoke / value-chain push\|pull / rules list\|show\|add\|edit\|enable\|disable\|preview\|apply\|revoke [--derived …] / rules pre-trust [--model] [--revoke\|--keep] / mcp` (stdio bridge; `rules add --derived` since M6 S2c-3, `rules pre-trust` since S2c-4, and since the decision-30 (2) safeguard step `import`'s owner-rule suggestion skips calls into this import's reconstructed or as-told files; since M6 S2b's follow-up step 3 `import --dry-run` names the agent work, the relations tasks it cancels with a warning for a claimed one and the placements losing their process, and `models delete` lists the task cancelled, the placements and the processes made due; since step 3b `import`'s waiting line and `status`'s models line add `about 7300 pairs to judge`, `status --json` `pairsToJudge`; since M6 S3c step 3 every command but `seed` and `mcp` in `src/core-program.ts` (`buildCoreProgram`), which `src/program.ts` extends with both, and `src/plugin-main.ts`, the entry of the integrate plugin's bundled CLI `analyzr.mjs` since 0.1.4: its next steps and `status`'s hint name `node <path> --url <url>` (since S3c step 4 also for the default URL), it sends the owner key only to `127.0.0.1`, `[::1]` and `localhost`, its `token create` names no Claude Desktop entry; in both the parse guard: a word that reads as a flag as an option value, or as an argument after `--`, is a usage error, exit 2, so `import b -p p --create --name --dry-run` no longer imports) |
| `apps/web` | projects, models, relations, findings, bpmn-js model view, upload, connect-an-agent, inbox, review screen; since M4 S3 the value chain page (`/projects/{key}/value-chain`: renderer viewer/modeler in a lazy chunk, placement review, save with dry run and conflict, drafts, link editing) and the step view; since decision 19 the tab „Regeln“ (auto-accept rules with live preview, apply, revoke) and the marks and filters of auto-accepted items in the review views, since M6 S2c-3 with the third „Art“ „Eindeutige Aufrufe aus abgeleiteten Modellen“ (offered by the bulk toast after accepting such calls) and the „Vorschau“ line naming what an owner's rules take at once, since M6 S2c-4 with the system rule's line „… vor der Vertrauensregel angenommen – prüfen…“ and its dialog („Behalten“, „Zurück in die Prüfung“), since the decision-30 (2) safeguard step with the block reason „Modell KI-rekonstruiert oder aus Interview“ (and no bulk toast offering a rule for pairs that each have an end in such a model); since M6 S2b's follow-up step 3 the „Vorschau“'s line of the agent work an import sets off, its lists of the placements losing their process and of the pairs judged again, and the warning with a second click („Trotzdem importieren“) before an import that cancels an agent's claim (`lib/agent-cost.ts`, shared with the amend form); since step 3b „etwa 7.300 mögliche Relationen“, the size of the agents' next run, beside „Agent starten“ or „Agent verbinden“ and in the waiting line of „Als Nächstes“ and after an import; since M6 S4 the tab „Offene Fragen“ (every gap as a question, filters, Markdown and CSV export) and the model view's section of the same name, since M6 S5a with „Antworten aus CSV übernehmen“ (a preview first) for reviewers, since M6 S5c-1 with an action on every question (pickers, inline decisions, the outside mark, „Rückgängig“) and „Notiz hinzufügen“ instead of S5a's „Beantworten“, and „Verknüpfen mit …“ on a collapsed subprocess in the model view; since M6 S5c-2 the amend form at a question with „Sammeln“ and its bar, the conflicts with both values side by side, „Ergänzen“ in the model view with history, overlay, badge and both BPMN downloads, every withdrawal after its cost, and the change list in the models tab; since M6 S2a the open-question kind „Elemente beim Import verloren“ (S2a's „Herkunft“, badges and the manifest of a dropped folder come with the UI simplification); since UX1 (decision 26) the shell of four object tabs („Übersicht“, „Relationen“, „Wertschöpfungskette“, „Offene Fragen“, badges from one hook), „Hochladen“ as a button, the owners' menu „Einstellungen“ („Agent verbinden“, „Annahmeregeln“, the former tab „Regeln“), the list „Befunde“ behind a link in „Offene Fragen“, „Übersicht“ with „Als Nächstes“, the popover „Agent starten“, the export hub, search, phase chips and „Offene Punkte“, failed writes in German, the server banner only on trouble; since UX2b „Offene Fragen“ as lean cards „Zu klären“ (the badge's number) with one intro line, three filters, „Zur Information“ and „Erledigte zeigen“ closed, the agents' questions on their proposals, the dialog „Für den Kunden exportieren …“ and a hold answered in one dialog from its card, its „Vorgemerkt“ row and the review screen and decided with „Jetzt entscheiden“ (the inline decision panels gone), the model view's „Fragen“ with „Zu klären“ only; since the first wave's review „Offene Punkte“ as text with its split in a tooltip, the customer export of the open items only, the agent's summary closed in the model view; the UI load guard `e2e/ui-load.spec.ts` |
| `apps/agent-sim` | LLM-free reference agent that works the pipeline over MCP, both task kinds since M4 S5 |
| `apps/demo` | `analyzr-demo seed\|serve\|check` (owner decision 20): seeds the read-only demo while its image is built, supervises PostgreSQL and the server in the container, checks a running demo from outside |
| `eval/corpus` | test landscapes `nordwind-handel` (dev, 31 models, 17 C7/14 C8) and `stadtwerke-auental` (holdout, 26 models, 10 C7/16 C8) + `_sample`; every model deploys on Camunda 7.24.0 and 8.9.22 |
| `eval/tools` | spec format, BPMN generator with DI, validator, deploy check (`engines.compose.yaml`), `eval:candidates`, `eval:replay`, `eval:live` and the live gate, `eval:placements` (M4 S4: the golden value chains, the rule tier and `baseline-prefix/1`), the „Auto-accept what-if“ of `eval:replay` (decision 19), `eval:descriptive` (M6 S3a: how much of the LLM-free relation finding survives descriptive, tool-style models; report only; its model variants also as `@analyzr/eval-tools/descriptive`, on which the server's test checks the gap signals of M6 S4) |
| `eval/recordings`, `eval/reports` | recorded submissions (today the sim agent under `analyzr-relations@0.2.0` and `analyzr-placements@0.1.0`; the owner's live runs go here too) and generated reports incl. both live gates, pairs judged twice and uncovered pairs |
| `eval/value-chains` | golden value chains + expected placements for both landscapes (M4); `validate-value-chains.mjs` checks them with `@miragon/value-chain-schema-model` 0.3.0 from npm (pinned in `eval/tools`) and its built-in cross-check, run by `pnpm test` |
| `docker/` | `compose.yaml` (project `analyzr`: PostgreSQL 17 on 127.0.0.1:55432, analyzr on 127.0.0.1:7400) and `Dockerfile`; the read-only demo (owner decision 20): `Dockerfile.demo` with its `.dockerignore`, `compose.demo.yaml` (project `analyzr-demo`, 127.0.0.1:7480), `fly.demo.toml` |
| `tools/notices` | `@analyzr/notices`: `pnpm notices` writes `THIRD-PARTY-NOTICES.md` from `pnpm licenses list --prod --json` plus the build tools whose code the web bundle contains (`BUNDLED_BUILD_TOOLS`: rolldown, tailwindcss, vite); its test (in `pnpm test`) fails while the file is stale |
| `LICENSE`, `THIRD-PARTY-NOTICES.md`, `README.md` | MIT („Copyright (c) 2026 Miragon GmbH“), the licenses of the production dependencies and of the bundled build tools (both copied into the runtime images), the project overview |
| `.github/workflows/ci.yml` | CI (workflow "CI"): jobs `verify`, `docker` and `demo` on every pull request and push to `main`, no path filters; the eval steps print `git diff --stat` only |
| `.github/workflows/demo-deploy.yml` | deploys the read-only demo to Fly.io on pushes to `main` (path-filtered) and by hand (`deploy` or `restart`); skips until the secret `FLY_API_TOKEN` exists |

**Key metrics (eval, no LLM):**

| Landscape | Rule-tier precision | must_link among rules ∪ candidates | baseline-label/1 recall / precision | Sim agent (proposals) P / R / F1 |
|---|---|---|---|---|
| nordwind-handel (dev) | 100 % (9/9) | 100 % (42/42) | 33.3 % / 66.7 % | 73.3 % / 78.6 % / 75.9 % |
| stadtwerke-auental (holdout) | 100 % (3/3) | 100 % (40/40) | 42.5 % / 65.4 % | 64.0 % / 80.0 % / 71.1 % |

**LLM dev validation of `analyzr-relations@0.1.0` (2026-10-08, dev landscape only, run under the
earlier procedure ids, §3):** three runs on
fresh projects of a scratch stack, each task worked by its own Claude Sonnet 5.5 subagent of the
implementing session through the real MCP tools (a CLI helper instead of a native MCP client):
every run precision **100 %**, recall **78.6 %** (= all 33 non-call must_link pairs; the 9 unique
calls are rule-accepted, so recall ∪ rule tier is 100 %), F1 **88.0 %**, **0** must_not_link, 6
questions, all on may_link pairs, 0 invalid items. The sim agent (73.3 % / 78.6 % / 75.9 %, 3
must_not_link at ≥ 0.8) is beaten on precision at equal recall. These runs are **not** committed
as recordings and do not count for the live gate: the holdout and the owner's clients are untested.
`0.2.0` keeps the sim agent's scores and judges no pair twice (under `0.1.0` it judged 154 and 121
pairs twice). Three LLM dev runs of `0.2.0` (Sonnet 5.5, concurrent claims) kept precision
100 %, recall 78.6 % and 0 must_not_link, and judged 8–10 pairs twice instead of about 150, with
40 instead of 78 proposal items (`M3-RELATIONS-PROCEDURE.md`, dev-run numbers).

## 6. Run and verify

```sh
pnpm install
pnpm format:check && pnpm -r typecheck && pnpm -r lint && pnpm -r test   # server tests use Testcontainers (Docker)
pnpm eval:candidates && pnpm eval:replay && pnpm eval:placements && pnpm eval:descriptive
docker compose -p analyzr -f docker/compose.yaml up -d --build --wait     # analyzr on http://127.0.0.1:7400
docker compose -p analyzr -f docker/compose.yaml exec server analyzr seed      # loads both landscapes
docker compose -p analyzr -f docker/compose.yaml exec server analyzr seed --value-chains   # and their golden value chains
docker compose -p analyzr -f docker/compose.yaml exec server analyzr status
ANALYZR_TOKEN=… pnpm eval:live --project <run project> --landscape nordwind-handel   # after a live run
```

Details (tokens, Claude Code/Desktop configuration, simulation agent, troubleshooting) are in
`docs/DEVELOPMENT.md`. Optional Camunda engines for the test landscapes:
`cd eval/tools && pnpm engines:up && node deploy-check.mjs ../corpus/nordwind-handel --keep`
(Cockpit http://localhost:18080/camunda, Operate http://localhost:18088/operate, demo/demo).

**Machine state (owner's Mac, 2026-10-11):** the owner's old `proa2` stack (127.0.0.1:7400 and
55432, the sim-agent projects awaiting review) and the eval engines `proa-eval-engines` (18080,
18088) keep running; they belong to the earlier repository, and nothing of their data moves to
analyzr. analyzr uses the same default ports: stop `proa2` when switching (`docker compose -p
proa2 stop` from the old checkout), or start analyzr with `ANALYZR_HOST_PORT` and
`ANALYZR_DB_PORT` on other ports (DEVELOPMENT.md "Troubleshooting"); `analyzr-eval-engines` (`pnpm
engines:up`) needs 18080/18088 free as well. No analyzr stack or volume exists yet. A source-run
server (`pnpm dev`) creates the new owner key at `~/.local/state/analyzr/owner-key` on its first
start; a container's key lives in its volume (`analyzr_analyzr-state`).

## 7. Next steps

### M3 – the owner's live runs (next)

The code, procedure (`analyzr-relations@0.2.0`, judge each pair once), plugin, reference setups and
tooling are done (`M3-RELATIONS-PROCEDURE.md`). What remains needs the owner's Claude subscription:

1. Follow `docs/M3-LIVE-RUNS.md`, only in analyzr (a run recorded in the earlier repository is
   keyed by the old procedure ids and not comparable): start the analyzr stack (step 1), seed a
   fresh project per run
   (`analyzr seed nordwind-handel --project … --issue-tokens --token-name …`), run Claude Code
   (`examples/agents/claude-code/run-headless.sh`) or Claude Desktop (start prompt), then
   `pnpm eval:live` and commit the recording. Three runs per landscape and model, then the holdout
   `stadtwerke-auental`. Never tune the procedure on holdout results.
2. Things only such a run can confirm (listed as "not verified" in the docs): `/analyzr:relations`
   in `claude -p` with `--tools ""`, Claude Code honouring `anthropic/maxResultSizeChars`, MCP
   prompts in Claude Desktop, the Desktop start prompt, Codex.
3. Afterwards: decide the M3 open questions (§8), mark the procedure's live gate in
   `M3-RELATIONS-PROCEDURE.md`, and only then change the procedure as `0.2.1`/`0.3.0` (a released
   version's skill never changes; regenerate it with `pnpm --filter @analyzr/procedures generate` and
   add its hash to `RELEASED`, §9). Judge each pair once leaves some double work by design
   (`compatible` pairs two concurrent partner searches both examine, re-claims after a lease
   expired, candidate-cap drift; DEVELOPMENT.md "Judge each pair once"): revisit it if the live runs'
   "judged twice" or `uncovered` numbers are not near 0.

### M4 – value chain (M4a done; M4b's code done, its owner actions open; S6 blocked)

Follow `docs/M4-VALUE-CHAIN.md` (slices S0–S6, ~4 weeks; S0–S5 done, S6 waits for the R1
OKF export). **S0 is done** (2026-10-08,
§9 "S0 as delivered"): schema-model 0.3.0 in `apps/server`, `apps/web` and `eval/tools`, the
renderer 0.3.0 in `apps/web`, exact and without overrides (the published packages pin the
diagram-js, diagram-js-direct-editing and zod versions analyzr already uses; only a type-only `didi`
12.0.0 is a second copy); `minimumReleaseAgeExclude` listed both 0.3.0 versions while pnpm 11
held them back as younger than a day (the entries were removed with decision 23); the validator imports the npm package (the sibling-checkout
mode is gone, `VERIFIED_SCHEMA_MODEL` = `0.1.0`, `0.3.0`); `runtime-pins.test.ts` rejects
`link:`, `file:`, `portal:`, tarball, Git and non-exact specifiers in every `package.json` and the
lockfile, and requires one locked version of each value chain package, `diagram-js`,
`diagram-js-direct-editing` and zod v4 that every `@miragon/value-chain-*` pin names (bump the
pins in `apps/server`, `apps/web` and `eval/tools` together). The bundle guard and the Playwright
import check moved to S3, the first slice that imports the renderer; Dependabot for the pnpm
workspace is not set up (§8); until then bumps are manual.

**S1 is done** (2026-10-09, M4 §9 "S1 as delivered"): the tables `value_chain`,
`value_chain_revision` (append-only), `value_chain_step` (generations, tombstone-only, incl. the
pseudo-step `@outside`), `placement` and `placement_assertion` (append-only, with the M4b basis
columns already in place) in migrations 0006 (generated) and 0007 (triggers, deferred submission
reference); typed ids `vch_`, `vcr_`, `plc_`, `pas_`; `status.ts` generalised over a subject
descriptor, with the relation functions unchanged as instances and a golden digest over 2,000
random relation histories computed before the change; the domain functions in
`apps/server/src/domain/value-chain/` (create, save with the `unchanged` no-op, delete and revive
a chain with step generations and placement endpoint refresh; a save or deletion withdraws the
live proposals on the generations it tombstones; propose, also as the rule tier, withdraw,
accept, reject, hold, correct, manual placement, note). Since S2 the use cases, ingest and model
deletion call them with `prepareRevision`'s output (the seam `PreparedRevision`).

**S2 is done** (2026-10-09, M4 §9 "S2 as delivered"): `prepareRevision` (canonical bytes, analyzr
rules with per-element violations, kinds, ranks, step fingerprints, `structure_hash`), 19 REST
routes under `/value-chains` (`If-Match: "r<rev>"` required, 428/412 `revision-conflict`,
`If-None-Match: *` to create, `?dryRun=true` with the impact, decisions incl. bulk, unplaced
processes, findings), six MCP tools (`get_value_chain`, `get_value_chain_document`,
`list_unplaced_processes`, `propose_placement`, `withdraw_placement_proposal`, the stub
`decide_placement`), `analyzr value-chain push|pull`, the rule tier's key proposals (step link or
equal name, recorded under `analyzr-rules`, re-derived on every save and model change), placements
that follow model ingest and deletion (`changed`, `missing`, `ok` again), findings, token
revocation of placement proposals, server tiers. `baseline-prefix/1` moved from S4 into S2 and
lives in `@analyzr/relations` (`placement.ts`), next to the normalization it builds on and reachable
from both the server and `eval/tools` without a sixth package; S4 shrinks to about 1 d. Taken by
the implementing agents (M4 §9 lists all deviations): the top-level ranks group by kind band; the
dry run runs in a snapshot, not under the project lock (the save re-checks and returns its own
impact); "unplaced" and "pending" go by placement status, so a rejected placement homes nothing.
From the S2 review: an analyzr rule bounds coordinates and sizes (`geometry-out-of-range`; a finite
coordinate near `Number.MAX_VALUE` was stored as `null` and broke every later read of the
project's chain), the canonical form is loaded again as reads load it before it is stored, the
size and count limits are checked first (an 8,000-step hierarchy blocked the event loop for
43 s), `rev` is capped at 999,999,999, the rule tier runs before the endpoint refresh in saves
too (no `endpoint_changed` there and back on a rename), and `analyzr value-chain push` needs
`--base` (the revision pulled) or `--force` for an existing chain, so a pull, edit, push round
trip cannot silently revert a save made in between.

**S3 is done** (2026-10-09, M4 §9 "S3 as delivered"): the page `/projects/{key}/value-chain` (tab
"Wertschöpfungskette" with the open placement count; the `reviewUrl` of refused agent writes,
`?placement=` selects the card) and the step view `…/value-chain/steps/{id}`. The renderer's
NavigatedViewer and Modeler live in a lazy chunk (`src/components/value-chain/canvas/`, the only
place allowed to import renderer, schema-model, diagram-js or zod: ESLint plus
`apps/web/test/bundle.test.ts`, chain-only code 36.0 KB gzip of a 40 KB budget beyond the shared
diagram-js chunk); `diagram-js` 15.28.0 became a direct web dependency, no `didi` override was
needed, and `src/lib/zod-csp.ts` sets zod's `jitless` so the CSP sees no `new Function` probe.
analyzr's element factory names new elements `shape_<ULID>`, so a re-added step never takes a deleted
step's id. Placements are reviewed in the side panel (A/R/H/C on the active card, J/K, bulk
re-confirm, manual placements, `@outside` and removed steps); saves run the dry run with `If-Match`
(`If-None-Match: *` creates the chain on its first save), ask before stranding or sending to
re-confirm, show the save's own impact, offer "Neuere Revision laden" on 412 (the local copy
downloads first) and keep unsaved edits as drafts in `localStorage`. Link editing writes
`analyzr:process/<ref>` (a key-tier proposal) and clears with one undoable command. The server texts
for a missing chain and `get_value_chain` name the page. Playwright: the import harness (golden dev
chain and synthetic chains, 0 warnings, waypoints equal `layouter.layoutConnection`, ids never
repeat) and the value chain flow (15 tests, incl. the CSS check of the bpmn-js review screen around
the chain page, which found no difference). A review of the uncommitted work made 20 findings (two
on the same impact-dialog flaw), all fixed with tests before the commit (M4 §9 "S3 review fixes",
DEVELOPMENT.md "M4 S3 review fixes"): drafts that an import deleted or marked clean, edits lost to
the 300 ms change debounce or made during a save, the impact dialog on every save, a re-checked bulk
row, the unfitted first view under StrictMode, the chain routes in the entry chunk (now route
chunks; the bundle guard also bounds the entry), and keyboard, focus and wording issues (link
picker, draft dialog focus, "Zur Übersicht"/Escape, the tree's single tab stop, "nichts angenommen"
instead of "ohne Prozess", "offen" counted alike everywhere). Taken by the implementing agent: the
import check runs on the dev chain plus synthetic chains, never on the holdout chain (the owner can
run it with `ANALYZR_E2E_VC_EXTRA=<path>`, counts only); the confirm rule also counts withdrawn
proposals; the renderer's copy-paste copies nothing in 0.3.0 (no `element.copy` rule), and its
palette and context pad are English (new upstream asks in M4 §12).

**S4 is done** (2026-10-09, M4 §9 "S4 as delivered"; with it **M4a is done**, see M4 §9 "M4a
done criteria status"): `pnpm eval:placements` (`eval/tools/src/placements*.ts`, report
`eval/reports/placements.{md,json}`, a CI step with the drift check) gates each scored landscape
on the validator, on the golden placements naming exactly the process facts and on every
key-tier rule proposal of the golden chain being a must or may, and scores the rule tier and
`baseline-prefix/1` with and without votes (dev: 4 rule proposals, all hits; baseline recall@1
43.8 %, precision@1 53.8 %, recall@3 65.6 %, area recall@1 59.4 %; without votes 46.9 %,
57.7 %, 62.5 %, 56.3 %; the holdout passes, as aggregate numbers only, none over fewer than 5
processes). The rule derivation moved into
`@analyzr/relations` (`derivePlacementRules`), so the gate checks what the server runs. `analyzr seed
--value-chains` creates each golden chain after the import (created, revived, unchanged, or
differs and left unchanged); the image ships the chain files only, guarded in CI. The rule
tier's texts are German (placement rationale and withdrawal, value chain finding details, chain
withdrawal reasons, the relation rule tier's finding details), so the agent-sim recordings were
re-recorded (only `input.bytes` changed). A new MCP integration case closes the M4a criterion
"proposed ad hoc over MCP … survive re-ingest and a layout-only re-save". Taken by the
implementing agent (M4 §9 lists all deviations): the analyzr rules check of the golden chains is a
server unit test (`value-chain-golden.test.ts`), not part of eval:placements, because eval/tools
must not import from an app; no numeric baseline gate (the committed report pins the numbers);
the report and console show numbers only for the holdout, unlike `candidates.md` and
`replay.md`; neighbours for the votes are the `must_link` relations of `expected.yaml`, known
steps the golden musts (leave-one-out), plus a row without votes; the image ships
`eval/value-chains/*/value-chain.vc.json` (no ground truth: the document an agent reads over MCP)
so the container quickstart and M4b live runs can seed; seed never overwrites an edited chain
and revives a deleted one (it says so); the German finding details land before the M3 live runs
without a procedure version bump (the claim format and the skill are unchanged).

**Follow-ups and owner actions from S4:**
- Run the holdout import check once (counts only):
  `ANALYZR_E2E_VC_EXTRA=$PWD/eval/value-chains/stadtwerke-auental/value-chain.vc.json pnpm --filter @analyzr/web e2e value-chain-import`
  from the repository root.
- Review the German server texts (M4 §9 "S4 as delivered"). Still English: the pipeline and token
  reasons ("superseded by submission …", "superseded by a newer analysis task …", "agent token …
  revoked"), API error messages, MCP tool descriptions and CLI output; translate them in one
  slice if wanted. A database from before S4 keeps English relation finding details until the
  next ingest or deletion. Undecided rule placement proposals are re-asserted in German at the
  next chain save that stores a revision or at the next model change; rule proposals a human
  already accepted, rejected or held keep their English rationale in the history until a step or
  process fingerprint changes (no migration; add a one-off rewrite if the owner wants a full
  switch).
- The M3 live runs (above); seed their projects with `--value-chains` only when the run also
  covers placements (M4b).
- "`eval:placements` is green in CI": confirmed (CI run 37942115182 on `bef64e0`, the S4
  push).

**S5 is done** (2026-10-09, M4 §9 "S5 as delivered"; M4b's code is done): analysis tasks have two
kinds, `relations` and `placement` (subject: the value chain; migration 0008, `facts_hash` kept
and `input_hash` added for chain tasks). **Judge each process once:** a per-process input hash
decides when a process is due again, `placement_input` remembers the last agent verdict
(`proposed`, `unsure` with the reason, `skipped`), one placement task per chain is open at a time,
its claim (`analyzr-claim-placement/1`, ≤ 50 processes, ≤ 96 KB) is rendered under the project lock,
follow-ups are queued at submit (truncation with progress, or a trigger during the lease), saves
never cancel a claimed task. `claim_analysis` and `GET /analyses/pending` take `kinds` (default
relations, so M2 clients see nothing new), `submit_analysis` takes `placements` and `unsure`
(`wrong-task-kind` for the other kind), `get_value_chain` returns the stage and the unsure list,
`list_unplaced_processes` marks `judged` and `inTask` processes. The procedure `analyzr-placements@0.1.0`
(released; English text with invented examples, German output; a server drift test keeps it in
line with the code), the skill `/analyzr:placements` (plugin 0.3.0; the relations skill unchanged),
the prompts `work_pipeline` with `kind`, `place_processes` and `draft_value_chain`. The chain page
imports a `.vc.json` (edit mode and the empty state; re-laid out by the layouter; unsaved until
saved) and shows the agent's stage and „Agent unsicher“. The simulation agent works both kinds
(`decidePlacements`: rule-tier proposals at 0.95, else `baseline-prefix/1` hints with fixed bands);
its placement recordings are committed (the holdout's compared by digest only) and scored by
`eval:replay` (dev: recall@1 46.9 %, as the baseline without votes; precision 57.7 %, 6 traps at ≥
0.8: a floor, not a bar); the placement live gate needs recall@1 ≥ the better baseline row + 20
points (dev 66.9 %) and no must_not at ≥ 0.8. Relations behave byte for byte as before (their
recordings, report sections and released skill unchanged). Examples: `run-headless.sh --skill
placements`, German start prompts for placements and drafting.

**S5 review fixes** (2026-10-10, M4 §9 "Review fixes", committed with S5): the input
hash covers only what a claim shows (human notes on an open proposal now appear on it in the
claim; org units, layout, a sibling process or a task label re-offer nothing; the basis of
pipeline proposals follows the same digests); `list_unplaced_processes` marks the processes of a
claimed placement task `inTask` and procedure section 13 skips them (the remaining double work is
listed in CONCEPT §3 and M4 §3.2); the server start queues the first placement task of chains
that never had one (M4a chains after migration 0008), and reviewers queue it by hand on the chain
page („Aufgabe einplanen“, „Erneut einplanen“) or with `analyzr value-chain requeue`; procedure
sections 4 and 11 describe what a claim really carries (skill regenerated, the placements 0.1.0
hash updated while nothing is committed); `eval:live` accepts a REST relations payload without
`relations`; the simulation agent's rationale no longer claims a name match (recordings
regenerated, scores unchanged); `run-headless.sh --skill placements` counts a moved task or a
falling due count as progress; marketplace and README name both skills; the draft prompt has a
drift test; an import on the empty state asks before it replaces a stored new-chain draft.

**Owner actions from S5:**
- Three placement live runs per landscape and model (dev first, then the holdout):
  `M3-LIVE-RUNS.md` step 6a (`analyzr seed <landscape> --project <key> --value-chains --issue-tokens
  --token-name <run>`, `/analyzr:placements` or `work_pipeline` with kind `placement`, `pnpm
  eval:live`, then commit the recording with `pnpm eval:replay`'s reports). Never edit a run
  project's chain.
- Draft a chain in Claude Desktop (`examples/agents/claude-desktop/start-prompt-draft.de.md` or
  the MCP prompt `draft_value_chain`), import it on the chain page, edit, save and rate it (the
  open M4b criterion).
- The holdout import check (from S3/S4, counts only):
  `ANALYZR_E2E_VC_EXTRA=$PWD/eval/value-chains/stadtwerke-auental/value-chain.vc.json pnpm --filter @analyzr/web e2e value-chain-import`
  from the repository root.

**S6** (M4 §9 "S6 checklist"): the OKF extension, **deferred** with the OKF export (owner
decision 22). After a bump of the renderer, schema-model or zod: rerun the bundle guard (chain-only
37.0 of 40 KB used since S5; the entry 199.8 KB of the 240 KB ceiling the owner set on
2026-10-10, decision 21), the import harness and the CSS check (Playwright is not in CI). The
owner accepted the defaults of M4 §11 (2026-10-09): archived copies to `@outside` with the reason,
one home step per process (a second only by a reviewer's decision), a step rename sends accepted
placements to re-confirm, org units as owners of top-level steps (not agent evidence), one chain
per project, kinds by colour until upstream has a category.

### Auto-accept rules (owner decision 19, delivered 2026-10-10)

Done in the commit after S5 (core: storage with migrations 0009/0010, the
evaluator in all four agent write paths, revocation, preview, ledger, REST; edge: the tab
„Regeln“, marks and filters in the relation table, review screen, timeline, queue, chain page and
step view, the token revoke offer, `analyzr rules …`, the `eval:replay` what-if, these docs, German
screenshots `docs/screenshots/d19-*.png`). A review round (2026-10-10) fixed: the rule
dialog's „Neuere Revision laden“ now loads the newer revision into the form and lists what changed;
the marks and filters for editors; thresholds with every decimal (no silent rounding on save);
revoking leaves a later proposal of the rule's author; another agent's `unsure` survives an ad-hoc
proposal, so preview, apply and the write path agree; the preview's and the what-if's
counterfactual (an acceptance blocks later competitors); the holdout differencing across
thresholds; taking over a rule whose author lost the owner role; `analyzr rules apply` on a rule that
is off; outcome-aware revocation texts and a per-agent revoke in the tab; the rules table's
numbers; „Durch Systemregel angenommen“; „Inhaber“; the documented 422 reasons; the eval README on
comparability. Every gate passes (DEVELOPMENT.md "Verified end to end"). No project has a rule
until the owner creates one. Extended in M6 S2c-3 (2026-10-20) to the rule tier's call proposals
of derived models by declared source (decisions 24.2 and 28 (1); §7 "M6"); since M6 S2c-4 the
page's system rule also lists the rule tier's acceptances from before the trust rule for the
owner's review (decision 28 (3)). Since the decision-30 (2) safeguard step (2026-10-28) no owner's
rule accepts anything on a model declared reconstructed or as-told (`reconstructed-endpoint`).

**Owner actions:**
- After the live runs (M3 and placements): read the „Auto-accept what-if“ sections of
  `eval/reports/replay.md` and choose a threshold per tier from the dev runs of the model in use
  (no traps, precision at the target), then check the holdout aggregate; the simulation agent's
  rows are only a smoke test (its key-tier relation proposals hold 3 traps at every threshold).
- In a working project (never a live-run project): create the first rule off, read its preview
  (the project's empirical precision on decisions you already made), enable it, and apply it to the
  open proposals only after reading the dry run list.
- Decide the new open questions in §8.

### Demo deployment (owner decision 20)

Owner decision 20 (§4). Built in the commit after the auto-accept rules:
`ANALYZR_DEMO=readonly` in the server (the read-only guard, the viewer session,
`demo-readonly`, MCP off, credentials refused, the public Host/Origin guard, `Health.demo`), the
visitor and the read-only database role (`demo-bootstrap.ts`), the web UI's banner and role
gating, `apps/demo`, `docker/Dockerfile.demo` (+ `.dockerignore`), `docker/compose.demo.yaml`,
`docker/fly.demo.toml`, `.github/workflows/demo-deploy.yml`, the CI job `demo`, tests at every
level and these docs. Verified locally (DEVELOPMENT.md "Read-only demo, owner decision 20"): the image
builds with the seed in about 5 s, starts in about 1 s, `analyzr-demo check` passes, the
Playwright walk passes, a restart is back at the seed, the image holds no eval file and the
database no expected answer, every gate passes.

**Deployed 2026-10-10 under the earlier name** (§3): the app lived in the Fly organization
`miragon` (the owner's choice, like Miragon's other tools) with an app-scoped deploy token as the
GitHub secret `FLY_API_TOKEN`; the first deploy was a `gh workflow run` dispatched from the
development branch; the remote build seeded in the build step and the smoke check passed 126
checks against the public URL with both legal links. One machine (`shared-cpu-1x`, 1 GB, `fra`),
no volume, a shared IPv4 and a dedicated IPv6 (both free). The owner asked the same day that an
idle demo shuts down and costs nothing ("wenn sie 30 Minuten nicht genutzt wird"):
`auto_stop_machines` went from `suspend` to `stop` (`min_machines_running = 0`); verified: the
machine stopped about 4 minutes after the last request, and a cold start takes about 13 s. The
app `analyzr-demo` does not exist yet: it needs the setup below.

**Review round (2026-10-10, same day):** `POST /api/v1/session` reads at most 4 KiB (a single
anonymous 700 MB request had killed the 1 GB machine; now 413 before reading, in local mode
too); `analyzr-demo check` sends nothing but `GET /health` to a server that is not a read-only
demo and no write unless the session is the visitor (it had deleted `nordwind-handel`'s value
chain on a local-mode server), and its write walk names keys that exist nowhere; the agents'
no-links now show in the review, as decision 20(4) asks: the inbox tab „Kein Zusammenhang“ with
the new read route `GET …/no-links` (every role, every mode; the simulation agent's 150 and 101
no-links are on pairs without a relation, which `Relation.noLinks` cannot show; the implementing
agent chose this over a seed change, which decision 17 forbids anyway: no pair is judged
twice); an empty project and the inbox offer write actions only to the roles that have them;
the demo walk checks more write actions (also by test id) and the no-links; the reset docs name
`gh workflow run` as the one fresh-seed action (GitHub documents dispatching a branch workflow
once it has run), the local `fly deploy … --build-arg ANALYZR_DEMO_SEED=manual-$(date +%s)` as the
fallback, "Re-run all jobs" only with its limits (30 days, same commit and inputs), and the
deploy token's one-year expiry with its renewal.

**Legal links (2026-10-10, decision 21): done.** The optional demo settings
`ANALYZR_DEMO_IMPRINT_URL` and `ANALYZR_DEMO_PRIVACY_URL` (absolute https URLs, checked at start,
refused outside the demo) appear in `/health` as `imprintUrl` and `privacyUrl` (local mode's
answer unchanged), `analyzr-demo serve` passes them through, and the banner shows „Impressum“ and
„Datenschutz“ at every width down to 320 px, opening in a new tab. `docker/fly.demo.toml`
(`[env]`) and `docker/compose.demo.yaml` set Miragon's two pages; `analyzr-demo check` fails without
both links, `demo.spec.ts` checks them at five widths. Miragon's privacy policy covers the demo
(Fly.io Frankfurt, logs 30 days, no login); the session cookie is strictly necessary, so there is
no consent banner (DEVELOPMENT.md "Legal pages"). With them the entry chunk reached 199.8 KB of
the former 200 KB ceiling, which the owner raised to 240 KB the same day. A review round's two
fixes are in: the legal-links test runs last in the serial `demo.spec.ts` (a demo without the
optional links fails it alone, the read walk still runs), and M4 §5 names the new ceiling.

**Owner actions** (the commands are in DEVELOPMENT.md "Demo deployment (Fly.io)"):
- The one-time setup of `analyzr-demo` and its first deploy: §7 "Migration owner actions", step 3.
  **The new token expires one year after it is created**; note the date and renew it before with
  `fly tokens create deploy --app analyzr-demo --expiry 8760h | gh secret set FLY_API_TOKEN --repo
  Miragon/analyzr`.
- **Reset** whenever wanted, the one documented action for a fresh seed: `gh workflow run
  demo-deploy.yml --repo Miragon/analyzr --ref main` (or "Run workflow" on GitHub). Fallback from
  the checkout: `fly deploy --config docker/fly.demo.toml --app analyzr-demo --remote-only
  --ha=false --build-arg ANALYZR_DEMO_SEED=manual-$(date +%s)`. The same seed in seconds: `fly
  machine stop`/`start` (or the manual run with `-f action=restart`). "Re-run all jobs" in the
  browser works only within 30 days and only on the newest run that deployed the current head (it
  repeats commit and inputs).
- Optional: a custom domain (`fly certs add`, DNS, `FLY_DEMO_PUBLIC_ORIGIN`) and the open question in §8 (no-links in the
  review). While the repository is private, the banner's link „analyzr auf GitHub“ answers 404
  for visitors (§8).

### M6 – landscape integration and gap analysis (in progress since 2026-10-15, decision 24)

The owner asked (2026-10-15) for a mechanism, maybe a CLI, to dump models in easily and write
integrations ad hoc; for analysing and importing landscapes from ARIS, Signavio, Visio & co; for
skills that surface processes from interviews; and for agents that assess models deliberately
and say what is missing to build more links. Decision 24 (§4) records the answers. **Open:** the
questions of M6 §10 that are not answered yet (listed in §8).

Slices (M6 §8): S0 concept (**done 2026-10-15**, reviewed from three lenses: code accuracy, owner
decisions, consultant usefulness), **S1 "Import hygiene"** (**done 2026-10-15** on
`feat/integration-and-gaps`; M6 §8 "S1 as delivered" records its deviations: one shared file rule
and key derivation in `@analyzr/contracts`, `.xml` in the CLI,
duplicate keys across batches, extractor warnings in import and PUT results, `analyzr models
list|requeue|delete`, the next-step block; live-run neutral), **S3a `eval:descriptive`**
(**done 2026-10-15**; M6 §8 "S3a as delivered", results in M6 §3.11: on `nordwind-handel` the
must_link coverage among rules ∪ candidates falls from 42/42 to 33/42 for descriptive models and
to 9/42 when message exchanges are drawn as tasks, every rule-tier acceptance is lost under the
trust policy once the engine is gone; `get_landscape` is 42.2 KB seeded and 71.4 KB after the
simulation agent, so the v1 limit is 40 models per project with a warning from 35, M6 §6) and
**S3b, the plugin `analyzr-integrate` v0** (**done 2026-10-15**; M6 §8 "S3b as delivered":
`/analyzr-integrate:integrate-landscape` for BPMN 2.0 exports, `tools/integrate` with `inspect`
and `normalize-bpmn`, the workspace with `keymap.json`, the bundle and the German report, run end
to end against a scratch stack with the CLI and the web upload; its guard setup is not yet tried
in a live Claude Code session, and its report does not yet warn above the 40-model limit). These
three are the „erste Anfänge“ of decision 24.1. **S4 „Offene Fragen“** (**done 2026-10-16**, with
a review round's fixes; M6 §8 "S4 as delivered"): every source of M6 §4.1 and the gap signals as
one list (`GET …/open-questions`, permission `read`), the Markdown and CSV export, the tab „Offene
Fragen“ after „Befunde“, the model view's section and `analyzr questions`; on the seeded dev
project 64 questions (14 findings, 44 chain findings, 6 black-box pools); `message-without-name`
stays off (it duplicates `message-partner-missing`); deviations: `askWho.stepOwners` as a list,
`unlocks` may be 0 with informational items last, the CSV without informational items, the
export named after its filters; whole-project candidates (2.3 s at 310 models) are memoized per
head facts. **Owner answer 2026-10-16** („ja mach weiter“): the value chain's findings
(`process-without-step`, `step-without-process`, `unresolved-link`) rank after every other
question and before the informational items, each group by `unlocks` as before; delivered with
S5a as a change to the sort key only (M6 §8 "S4 as delivered"). **S5a „Antworten“** (**done
2026-10-17** on the branch, with a review round's fixes; M6 §8 "S5a as
delivered"): „Beantworten“ in the tab and the model view, „Antworten aus CSV übernehmen“ with a
preview, `analyzr questions answer` (one answer or `--from <csv>`), the routes `POST
…/open-questions/{q}/answers` and `…/open-questions/answers?dryRun=` (permission `review`, humans
only), the append-only table `open_question_answer` (migrations 0011/0012); an answer on a
relation or placement is a human note through the existing note use cases (a held placement
stays held, so its process is not due), every other answer keeps its text; claims of seeded
projects pinned byte for byte. **Owner decision 25** (2026-10-17, §4) followed S5a: answer by
action, amend the model where a question names a field, now and before S2 (M6 §4.8). **S5c-1
"Actions"** (**done 2026-10-17** on the branch, with a review
round's fixes; M6 §8 "S5c-1 as delivered"; one refinement of decision 19's `competing-call` for
the owner to confirm, §8 below): an action on every open question from the server, the action
route for link, place, choose copy and outside, a link accepting a live typed proposal before it
writes a manual relation, items versioned by what they ask about, `competing-call` also counting
a human's manual link from a call element to another target, the revocable outside mark with
migrations 0013/0014, notes that no longer close items, the five-column CSV, the actions with
undo in the tab and the model view, „Verknüpfen mit …“ on a collapsed subprocess, `analyzr
questions outside|link|place`; no BPMN writing; live-run neutral. **S5c-2 "Model amendments"**
(**done 2026-10-17** on the branch, with a review round's fixes and a separate gate pass, every
gate green, Playwright and the demo walk included; M6 §8 "S5c-2 as delivered"; decision
25.1–25.4; two points for the owner in §8 below): byte-preserving, deterministic `applyAmendments`
and `readAmendable` in `@analyzr/bpmn-facts` (refused unless the extracted facts read exactly the
intended change; files declared in another encoding than UTF-8 written as ASCII), `model_amendment`
with migrations 0015/0016, uploaded plus amended revisions with the plan on the head, re-application
at every import with the question „Ergänzung nicht mehr anwendbar“ (both values side by side;
„Meine Ergänzung behalten“ only over a value that does not resolve), withdrawals with their cost
and an optional `If-Match`, the cost of each save shown in its dry run, the change list (what to
carry over first, each element with its id) and both BPMN downloads, the form at the question
with „Sammeln“ (removed in UX4) and „Ergänzen“ in the model view, `analyzr models amend|pull`,
`analyzr questions amend` and `analyzr amendments list|export|withdraw`; live-run neutral. **S2a
"Provenance, manifest, stable identity"** (**done 2026-10-17** on the branch, every gate green; M6
§8 "S2a as delivered"): the manifest `analyzr-import.json` read by `analyzr import` and sent per
batch (an invalid one stops the import before anything is sent), pinned keys, the declared
provenance on the uploaded revision (an amended head follows `source.upstream`), PUT with
`Analyzr-Manifest`, the import warnings `manifest-sha-mismatch`, `external-id-moved` and
`external-id-changed`, `GET …/external-ids` with `analyzr models external-ids` (the key map the
golden bundle was written with comes back from it), the stored extractor warnings (migration 0017)
and the open question `extractor-loss`; live-run neutral. The review round added the warning
`provenance-kept` (an unchanged file whose manifest declares another tool folder or link: identical
bytes keep their first provenance), the readers' fallback to the newest declared revision (an
upload without a manifest never erases an identity), tidied informational fields (an export's
empty `exporterVersion` imports; a NUL or a lone surrogate is refused with 422 instead of a 500
for the whole request; no credentials in links), open loss codes, the manifest checked before
`--create`, the refusal of a folder whose bundles lie in subfolders, `next:` lines after the
identity warnings, the tool ids several keys carry in `models external-ids`, finer
`extractor-loss` texts (no diagram or vendor elements, „Prozess … (samt Inhalt)“, „mindestens“),
and the integrate plugin 0.1.1 (skill text only). The interim gap this left (a bundle imported
first without its manifest recorded no identity, through „Hochladen“ before UX8 or as single files,
and the same bytes imported again could not add it; a folder move in the tool kept the old folder
in `external-ids`) is closed by the identity rows of decision 29 (1) (M6 §10.10; step 5 of S2b's
follow-up, 2026-10-20), through the CLI and the web alike. Its web parts
waited for the UI simplification the owner asked for (2026-10-17: „die UI etwas zu vereinfachen …
Wirkt alles inzwischen etwas überladen“) and came with UX8; the skill's key-map rebuild and the
pre-approved `--dry-run` were planned for the plugin's next version, after S2b; 0.1.2 (S2c-2) only
recommends the dry run for the consultant to run, so the rebuild and the pre-approval stayed open
(both came with plugin 0.1.3, step 4 of S2b's follow-up, 2026-10-20; the pre-approval as the
read-only script `analyzr-read.mjs`, decision 29 (2)). **The UI simplification's first wave is
done** (the owner asked for it after S2a, 2026-10-17: „Denke aus User Need Sicht. Wirkt alles
inzwischen etwas überladen“; `docs/UX-SIMPLIFICATION.md`, decided as owner decision 26): UX2a (the
open questions' groups and totals in server, contracts and CLI), UX1 (the shell and „Übersicht“ in
the web), UX2b („Offene Fragen“ in the web) and the first wave's review round, done 2026-10-18 on
the branch with every gate green, the UI load guard and the whole Playwright suite against a scratch
stack, the demo walk against a scratch demo image and the screenshots retaken (UX-SIMPLIFICATION.md
§7 "… as delivered", "First wave review round"; DEVELOPMENT.md "UI simplification first wave
(2026-10-18)"). The owner walked five tasks on `analyzr-local` the same day („finde, das geht in
eine gute Richtung“; UX-SIMPLIFICATION.md §7 "Owner walkthrough"); its one finding, entering the
model from a question card, is fixed with a labelled button on the card. **Next**, in the
proposed order (Q10), which the owner kept („Sonst kannst du weitermachen“): UX7 („Hochladen“,
„Agent verbinden“; done 2026-10-18, UX-SIMPLIFICATION.md §7 "UX7 as delivered") → UX8 (done
2026-10-18, "UX8 as delivered"; S2a's web parts: „Herkunft“, the badges, the manifest of a dropped
folder) → S2b (`importImpact`, the dry runs, the deletion impact, absent keys within `source.scope`;
done 2026-10-18, its follow-up's steps 1 to 5 on 2026-10-20) → UX3 (model view; done 2026-10-18,
"UX3 as delivered") → UX4 (question actions; done 2026-10-18, "UX4 as delivered") → UX5
(„Relationen“ and the review screen; done 2026-10-18, "UX5 step 1/2 as delivered") → UX6 (value
chain; done 2026-10-19, "UX6 step 1/2 as delivered") → UX9 (result views, „Annahmeregeln“, the
projects summary; done 2026-10-19, "UX9 as delivered"), alongside S2c (the trust rule of decision
24.2, in four steps, M6 §8 "S2c"; all four done by 2026-10-20) and S3c (renderer and spec YAML, the
ad-hoc converter path, the bundled CLI; in four steps, M6 §8 "S3", all done 2026-10-21); then the
decision-30 (2) safeguard (done 2026-10-28); then S6 (interviews; steps 1–2 done 2026-10-28); after
the owner's live runs S5b, S7 and facts v2 as recommended (M6 §3.11 and §6: the reindex with
judgement carry-over first). **S2c-1 „The trust class and the rule tier“** (**done 2026-10-19** on
the branch, every gate green, the UI load guard and the whole Playwright suite against a scratch
stack; M6 §8 "S2c-1 as delivered"; decisions 24.2, 25.2 and 28): the server stores the trust
class on every uploaded revision (`source.trust` `{class, reasons}`, computed by the pure
`apps/server/src/domain/trust.ts` from the engine, the credential kind and the declared
derivation, written last so no declared value reaches it; none on an amended revision, whose
readers follow `upstream`); the recompute applies the trust rule before it plans, so a unique
static call from a derived caller is a rule proposal (tier `key`, 0.9, `attrs.match`
`derived-caller`, the rationale „Vertrauensregel: …“), an acceptance from before ends when its
caller's new revision is derived, and a call whose target was set in analyzr (applied or
`in-source`) stays accepted; revisions stored before S2c count as modelled (24.2 (a)); the dry
runs, the deletion impact and the amendment effect plan the same (`ImportImpact.callsProposed`
with `wasAccepted` and `byReason`, `ImpactFile.trust`); `Model.trust`, `ImportFileOutcome.trust`,
`AutoAcceptSystemRule.proposed` and the import warning `trust-kept` (REST only, no migration);
the web's „Vorschau“ line and list, the „Aufrufe“ line in „Herkunft“, the system rule card, the
timeline title and the empty texts; the CLI's dry-run, deletion-impact and system-rule lines.
Live-run neutral: the corpus, the seeds and the live-run projects are Camunda models a human
imported, so nothing changes there (eval reports, MCP snapshots, procedures, recordings and
claim inputs unchanged). The first analysis of a landscape without an engine, or of one imported
with an agent token, took one review step more: its unique calls are proposals, and until they
are accepted the agent's relations claims also assign them as unsettled pairs to judge.
**S2c-2 „The fast path for derived calls“** (**done 2026-10-20** on the branch, every gate green,
the UI load guard, the whole Playwright suite and the demo walk against scratch stacks; M6 §8
"S2c-2 as delivered"; DEVELOPMENT.md "M6 S2c-2 (2026-10-20)") makes that step one bulk accept:
„Gesammelt annehmen“ opens the key tier's bulk dialog (`?bulk=calls`) with these calls first as
their own group „Eindeutige Aufrufe aus abgeleiteten Modellen (n)“ and exactly them selected (at
most 500), and one click accepts them before the agent runs; accepted pairs are settled, so the
agent's claims skip them and the agent judges only the truly open pairs. The links: „Übersicht“'s
„Als Nächstes“ („n eindeutige Aufrufe zuerst bestätigen · Gesammelt annehmen“ while an agent row
leads, „Davon n eindeutige Aufrufe · Gesammelt annehmen“ under „Vorschläge prüfen“; it replaces
„Oder jetzt schon: Vorschläge prüfen …“ when every open item is such a call), the upload's „Als
Nächstes“ after „Importieren“ (first), the system rule card's count (plain text in S2c-1, now a
link), and `analyzr import`'s `next:` line with the link `<url>/projects/<p>/review?bulk=calls`,
printed only while such calls wait. Every one of these numbers counts the calls a bulk accept takes
as they stand (`isBulkDerivedCall` in the contracts: no agent's question, no no-link), so it equals
the dialog's selection. `analyzr import` says on stderr, before sending and also for a dry run,
when an agent token (`ANALYZR_TOKEN` or `--token`) makes the calls proposals and how to import
with the owner key instead. The integrate plugin 0.1.2 (texts only) recommends the dry run instead
of a probe project, says that an engine-less or converted bundle's calls arrive as 90 % proposals
for „Gesammelt annehmen“ before the agent starts, and no longer says the web ignores the manifest
(stale since UX8). No route, migration or MCP change; live-run neutral. **S2c-3 „Rules for
derived calls“** (**done 2026-10-20** on the branch, every gate green with a review round's fixes,
the UI load guard, the whole Playwright suite with the new `derived-call-rules.spec.ts` and the
demo walk against scratch stacks; M6 §8 "S2c-3 as delivered"; DEVELOPMENT.md "M6 S2c-3
(2026-10-20)"): decision 19's extension. A rule names whose proposals it accepts (`proposedBy`,
fixed for good) and, for the rule tier's proposals of unique calls from derived models, the
declared source (`derivedKind` `export`, `converted` with exactly one `converter`, or `none`;
never reconstructed or as-told); kind, tier, type and minimum are fixed (relation, `key`, `call`,
0.9), checked by the contract and by the database (migration 0018), and rules from before read as
agent rules, which now match agent proposals only. The new safeguards `agent-upload` (no rule, an
agent rule neither, accepts a proposal on a call whose caller's revision an agent token uploaded,
for revisions stored since S2c-1, older ones counting as modelled) and `amendment-conflict` follow
`no-matching-rule`. The fifth write path runs right after the recompute of every import, amendment
write or withdrawal and deletion, over only the proposals
that write recorded, never for a write made with an agent token; the owner's dry run of an import
or deletion names what the rules accept (`autoAcceptedCalls`, with `byRule` and `ofProposed`),
nobody else's; apply, the preview (with `derivedGroups`), the ledger (`proposedBy`) and revocation
(requeueing unless the triggering kind of proposal is still open) work as for agent rules. Web:
the dialog's third „Art“ with „Herkunft“ and „Konverter“, the bulk toast's offer „Eindeutige
Aufrufe aus abgeleiteten Modellen künftig automatisch annehmen?“ (owners; none when a rule already
names the source or no source can be named), the „Vorschau“ line „… · deine Regel „…“ nimmt 12
davon gleich an“, neutral revocation texts and the page lead „analyzr nimmt neue Vorschläge, die
eine aktive Regel trifft, selbst an – …“. CLI: `analyzr rules add --derived …`, the dry-run line
and, with the owner key, the `next:` step (`rules apply`, `rules enable` or `rules add`, quoted for
the shell). For the first analysis of a derived landscape, the unique calls each later import of a
trusted source proposes are accepted without a click, marked and revocable (calls already waiting
need `rules apply`), and the toast offers the rule right after the first bulk accept. Live-run
neutral; the readings taken without asking are in §4 ("Taken during M6 S2c-3"); the open points (the
amendment effect's dry run does not predict a rule's acceptance; only the caller's class counts) are
in M6 §8. **S2c-4 „Vor der Vertrauensregel angenommen“** (**done 2026-10-20** on the branch, every
gate green with a review round's fixes; M6 §8 "S2c-4 as delivered"; DEVELOPMENT.md "M6 S2c-4
(2026-10-20)"; decisions 24.2 (a) and 28 (3)) completes S2c: the owner reviews, once per uploaded
revision, the rule tier's acceptances from before S2c whose revision would be derived today. Server:
the append-only `revision_trust_review` (migration 0019; 0020 adds the append-only triggers and a
guard that refuses a classified or amended revision for any writer), read by `storedTrust`
(`source.trust`, else the review, else none; a review never overrides a stored class), the pure list
`preTrustAcceptances` (rule-tier acceptances with no other decision in force, from uploaded
revisions without a class that would be derived from what they carry; call targets set in
analyzr and calls whose callee is gone left out; an amended head names its uploaded revision),
`GET …/pre-trust-calls` and `POST …/pre-trust-calls/review?dryRun=` (owners only: editors,
viewers, agent and read-only tokens get 403; not on MCP; the demo answers the list with 403),
`expectedCount` the listed calls (409 `count-changed`, or `not-listed`, which the dry run answers
too), the event `revision.trust_reviewed`, `AutoAcceptSystemRule.preTrust`. „Zurück in die
Prüfung“ records `derived`, recomputes and runs the owner's rules for derived calls in the same
write; „Behalten“ records `modelled` and changes nothing else; no analysis is queued. Web: the
system rule card's line „N vor der Vertrauensregel angenommen – prüfen…“ (owners, not in the
demo) and its dialog (a checkbox per model with name, count and reasons, the dry run following
the selection, the note that „Behalten“ is final, „Behalten“ and „Zurück in die Prüfung“, the
toast offering „Gesammelt annehmen“ while calls stay open). CLI: `analyzr rules pre-trust -p <key>
[--model …] [--revoke|--keep] [--dry-run] [--yes] [--json]`. For the first analysis: a landscape
imported before the trust rule catches up without a re-import, one list and one decision per
model; „Zurück in die Prüfung“ sends the calls straight to „Gesammelt annehmen“ (or an enabled
rule for that source accepts them again in the same write), and „Behalten“ ends the question for
good. Live-run neutral (Camunda landscapes a human imported list nothing); the readings taken
without asking are in §4 ("Taken during M6 S2c-4"). **S2b follow-up step 1 "Agent work in the
dry runs, relations side"** (**done 2026-10-20** on the branch, every gate green with a review
round's fixes; M6 §8 "S2b follow-up step 1 as delivered"; DEVELOPMENT.md "M6 S2b follow-up step 1
(2026-10-20)"): `ImportImpact.relationsTasks` (required, REST only: the import's and PUT's dry
runs and the deletion impact; MCP unchanged) names the relations tasks the write queues
(`queued`) and cancels (`cancelled`, a claimed one first with its holder's handle and the length
of its assignment; `claimed` past the cap), the typed pairs agents judge around the queued models
after the write (`pairs`, an upper bound while other models' tasks wait) and those whose current
agent judgement the write makes non-current (`rejudged`). The write and the dry runs plan with
one pure `planQueue` (`queueAnalysis` is now read, plan, write, with the same reads and events);
`importImpact` plans the recompute once and reads the relations as the write leaves them
(`relationsAfter`; `plannedRelations` does the same for the amendment cost); `currentPairs`,
`judgementShift` and `pairsToJudge` in `judgements.ts`; the dry run reads the open tasks, the head
hashes, the no-links touching the changing models (`NoLinkFilter.touchingModelKeys`) and a model's
latest done task only for files whose bytes are not known yet, so an unchanged re-import reads
nothing more; a prepared candidate index (`indexCandidates`, `generateCandidates`' optional fourth
parameter, `AnalysisPort.candidateSource`; equal candidates, `eval:candidates` unchanged) keeps a
50-file batch on 496 models at 0.67 s of added CPU and 1.13–1.17 s for the whole REST dry run (an
unchanged 50-file re-import 234–258 ms). The CLI and the web merge their batches with the shared
zod-free `@analyzr/contracts/impact-merge` (output unchanged). The amendment cost (`AmendmentCost`
unchanged) now counts against the relations as the write leaves them (recompute, an owner's
rules, `settleLinks`' partner acceptances) and reports a claimed task only when the facts change.
No user-visible text changed (`--json` carries the field); live-run neutral; the readings taken
without asking are in §4 ("Taken during the M6 S2b follow-up step 1"). For the first analysis:
the server knows before an import how much agent work it sets off, repeats or destroys; the
surfaces follow in step 3; the amendment form's number no longer counts pairs the amendment
itself settles. **S2b follow-up step 2 "Placements in the dry runs"** (**done 2026-10-20** on the
branch, every gate green with a review round's fixes: one major, five minor and a nit; M6 §8 "S2b
follow-up step 2 as delivered"; DEVELOPMENT.md "M6 S2b follow-up step 2 (2026-10-20)"): only for a
project with a live value chain, optional and REST only (MCP unchanged), `ImportImpact` names the
accepted placements whose process the write turns `changed` or `missing` (`placementsChanged`,
`ImpactPlacement {step, stepName, process, endpointState}`, by process, then step; equal to the
write's `placement.endpoint_changed` events that turn an accepted placement `changed` or `missing`)
and the chain's placement task after the write (`placementTask`,
`ImpactPlacementTask {outcome, due, newlyDue, again}`: `queued`, `open`, `deferred` while an agent
holds it, `nothing-due`, or `not-triggered`, since only a created or revised file with other facts
triggers it and a layout-only upload or a deletion never queues). `loadPipelineInputs` is now its
reads plus the pure `pipelineInputs`, which the new pure `value-chain/model-impact.ts`
(`placementImpact`) runs over the head and over the would-be head (the relations the write
leaves, an owner's rule acceptances included; the agent's verdicts; while an agent holds the
task, the input its claim showed); the rule tier's placement writes are planned as the write
records them (the pure `planRulePlacements`; `recomputeRulePlacements` now
reads, plans, writes, `value-chain-golden` unchanged), since the plan's "no simulation" invariant
did not hold (a revoked auto-acceptance); `store.ts` and the dry run share one fact order
(`domain/fact-order.ts`); `readChain` in `ingest.ts` is one query without a chain. The shared merge
keeps the strongest outcome, the largest batch's `due` and the sums (approximate across batches).
About 20–30 ms more per 50-file batch on 496 models. No user-visible text changed (`--json` carries
the fields); live-run neutral; the readings taken without asking are in §4 ("Taken during the M6
S2b follow-up step 2"). For the first analysis: before an import the server knows whether the
placement agent must place processes (again) and how many, and which accepted placements lose or
change their process; the surfaces follow in step 3. **S2b follow-up step 3 "The surfaces"**
(**done 2026-10-20** on the branch, every gate green with a review round's fixes: 14 points, one
major, 12 fixed, 2 rejected; M6 §8 "S2b follow-up step 3 as delivered"; DEVELOPMENT.md "M6 S2b
follow-up step 3 (2026-10-20)"; UX-SIMPLIFICATION.md §6 and §7 "M6 S2b follow-up step 3's texts as
delivered"): the web's „Vorschau“ (`lib/agent-cost.ts`, new, in the entry; `impactLines(impact,
batches)`) names the agent work in the last of its three lines, on a first import too: „214
mögliche Relationen zu beurteilen (56 davon erneut), 7 Prozesse zu platzieren“ (the relations part
only when `pairs` is above 0; a placement task the import queues places every process due, one
waiting or held the newly due ones; „etwa“ for more than one batch), a placements line right after
the endpoints line, and in „Was ändert sich?“ (shown only when a list has items) the placements
losing their process and the pairs judged again. While the import cancels a relations task an agent
holds: the destructive warning („Ein Agent bearbeitet „vertrieb/auftrag“ gerade; seine Arbeit geht
verloren.“, several by count and at most three keys) and the second click („Trotzdem
importieren“), through `useSecondClick`, which the amend form now shares; a double click arms only
in all three second-click places. The batch note names, on a first import in parts, the pairs
between new models of different batches that count in no batch. `analyzr import --dry-run` prints
`agent work: …`, `cancel relations tasks: …`, `warning: …` and the placements line, its batch line
the same gap; `analyzr models delete` lists the task cancelled, the placements losing their
process and the processes made due, and the requeue hint once. All counts of the impact lines in
German numbers. No route, no migration, no contract change (comments only), the client not
regenerated; the bundle entry 227.6 KB gzip (+1.0); the UI load guard's new step „Vorschau
(erneuter Import)“ 16 controls and 95 / 93 words at 1440 / 390, UX7's „Vorschau“ 133 words (128);
live-run neutral; the readings taken are in §4 ("Taken during the M6 S2b follow-up step 3"), the
screen-reader point is open in §8. For the first analysis: before „Importieren“ the consultant
sees how much agent work an import sets off (pairs to judge, processes to place), which it repeats
(„davon erneut“) and whether it destroys an agent's running work, so imports can be timed and
batched without losing agent runs. **S2b follow-up step 3b "The agents' next run"** (**done
2026-10-20** on the branch, every gate green with a review round's fixes: 12 points, 9 fixed, 3
not taken; M6 §8 "S2b follow-up step 3b as delivered"; DEVELOPMENT.md "M6 S2b follow-up step 3b
(2026-10-20)" and "The agents' next run"; UX-SIMPLIFICATION.md §7 "M6 S2b follow-up step 3b's
texts as delivered"): `ProjectSummary.pairsToJudge` (REST only, contracts first, the client
regenerated; MCP unchanged), the distinct typed pairs the next claims of the relations tasks an
agent may claim now will be assigned over the stored head (the queued ones and the claimed ones
whose lease ran out with attempts left; held tasks and the pairs rule 1 gives them count not;
judged and settled pairs left out as in the dry runs), exact for the stored state and equal to the
union of the claims' assignments (16,586 pairs after 440 claims on 496 models).
`countPairsToJudge` (`use-cases/projects.ts`) runs `pairsToJudge` with the pure `heldPairs` over
what the open questions' read model already read; each model's own candidates come from its
whole-project candidate pass through the new `projectCandidates` of `@analyzr/relations` (the
whole-project candidates unchanged, `eval:candidates` too), so the summary generates no
candidates; its memo now holds until the earliest live lease runs out. On 496 models a rebuild
costs 15–83 ms more and a memoized read nothing. „Als Nächstes“ shows „etwa 7.300 mögliche
Relationen“ beside „Agent starten“ or „Agent verbinden“ and in the waiting line, „Hochladen“ on its
waiting text after an import (from a read after it only), the CLI `about 7300 pairs to judge` in
`analyzr import`'s waiting line and `analyzr status` (`--json`'s `pairsToJudge`); „1 mögliche
Relation“ without „etwa“, nothing for 0; the batch notes point there. The bundle entry 227.9 KB
gzip (+0.3); `signavio-beispiel`'s „Als Nächstes“ with the suffix 22 words and 4 controls (UX1's
budget 40 and 5); live-run neutral; the readings taken are in §4 ("Taken during the M6 S2b
follow-up step 3b"); the e2e run on the final tree: the full Playwright suite 111 passed and 21
skipped, the demo check 152 of 152, `demo.spec.ts` 14 of 14, with a fix of an older web race it
found (a click on „Agent starten“ as the owner's agent tokens arrived was lost; `RetryAgent` now
keeps one button element). For the first analysis: right
after a first import in parts, and on every „Übersicht“, the consultant sees how big the agents'
run will be, the one number a preview in batches cannot give, and can plan the agent run and its
cost. **Owner decision 29** (2026-10-20, §4) answers M6 §10.10 (identity rows, step 5) and makes the
integrate skill's pre-approved preview a bundled read-only script (step 4). **S2b follow-up step 4
"The integrate plugin 0.1.3"** (**done 2026-10-20** on the branch, every gate green with a review
round's fixes: 25 findings fixed, 1 in part, 1 rejected, the docs item left to the docs pass; M6 §8
"S2b follow-up step 4 as delivered"; DEVELOPMENT.md "M6 S2b follow-up
step 4 (2026-10-20)" and "The integrate plugin and `tools/integrate`"): the plugin's read-only
`analyzr-read.mjs` (`src/analyzr.ts`, `src/preview.ts`, `src/cli/analyzr-read.ts`), pre-approved
next to `inspect.mjs` by decision 29 (2): `models` and `external-ids` into the workspace's
`reports/`, and `preview`, which walks a bundle as `analyzr import --dry-run` does (the file rule,
the manifest's pinned keys, batches of 50 files and 25 MB, each with the whole manifest) and merges
the batches with the contracts' `mergeImpacts`; only `GET …/models`, `GET …/external-ids` and `POST
…/imports` with `dryRun=true` built in, checked again right before each request, to 127.0.0.1,
`[::1]` or `localhost` without userinfo, no redirect, no proxy (`NO_PROXY=*`, refused under Node's
proxy support), strict arguments, `ANALYZR_TOKEN` or the owner key file as the CLI finds it, never
printed. `normalize-bpmn.mjs plan --from-analyzr` plans against the key map rebuilt from analyzr's
identities (the pure `rebuildFromAnalyzr` and `inferRule`; `plan --write` the only writer,
`analyzr-keymap/1` unchanged). The skill reads models and identities itself, plans with `--existing`
and `--from-analyzr` whenever it could read them, previews into an existing project, and its report
gains the section „Vorschau“ in the web's words and the agent work in the „Kurzfassung“;
`exporterVersion` is declared tidied (no `NORMALIZE_BPMN_VERSION` bump). Plugin 0.1.3 with its
`RELEASES` row, `claude plugin validate --strict` passed (Claude Code 2.1.303), both notices files
unchanged; integrate 205 tests (145), the CLI e2e runs the bundled scripts against the real server
(the preview equal to `analyzr import --dry-run --json`, `seq` unchanged; the key map restored with
6 of 6 keys fitting); live-run neutral; the readings taken are in §4 ("Taken during the M6 S2b
follow-up step 4"); the e2e run on the final tree: Playwright 111 passed and 21 skipped on a scratch
stack built from it, test names and UI load numbers as in step 3b, demo check 152 of 152,
`demo.spec.ts` 14 of 14, and the bundled `analyzr-read.mjs` with a read token on that stack
(`lastSeq` unchanged). Open for the owner: one live session to check the pre-approval and the guard
sandbox (§8); no LLM call was made. For the first analysis: a consultant's first import of a big
export goes through without duplicate models (a lost key map is recovered from analyzr) and with the
agent work known up front, and the agent cannot import.
**S2b follow-up step 5 "The identity rows"** (**done 2026-10-20** on the branch, every gate green
with a review round's fixes: 8 findings, 6 fixed, 2 rejected; M6 §8 "S2b follow-up step 5 as
delivered"; DEVELOPMENT.md "M6 S2b follow-up step 5 (2026-10-20)" and "Provenance and the import
manifest"; UX-SIMPLIFICATION.md §7 "M6 S2b follow-up step 5's texts as delivered"; decision 29 (1)):
`model_identity` (append-only; 0021 generated, 0022 hand-written with the triggers, the guard
`analyzr_model_identity_guard` and the backfill), one row per stored listed file at its
`model.revised` seq and one per unchanged listed file whose declaration differs from the newest row,
with its own `model.identity_declared`; `uploadedSources` joins the newest row laterally (its
fallback query gone), `identities.newest` serves the ingest, the dry run and the change list,
`modelViews` gives `Model.identity`; `ImportFileOutcome.identityUpdated` (the dry run's `files`
equal to the import's), `provenance-kept` narrowed to the derivation (`trustKeptNamesDerivation`,
`withinWarningLimit`), and the identity warnings with unchanged files taking effect in a request's
sequence. The web offers „Importieren“ for an identity-only re-export („Danach: Ort im Quellsystem
für 6 Modelle aktualisiert“) and reads „Im Quellsystem“ and the tool link from `Model.identity`; the
CLI counts the recorded identities in its manifest line. The interim gap of S2a is closed (above).
Server 1,804 tests (1,783), web 663 (659), CLI 286 (281) plus 7 skipped; the bundle entry 228.1 KB
gzip (+99 B); on 496 models the landscape read 232.4 → 230.5 ms and `models.list` 13.5 → 17.1 ms;
live-run neutral; the readings taken are in §4 ("Taken during the M6 S2b follow-up step 5"); the e2e
run on the final tree: Playwright 111 passed and 21 skipped, the same tests as after step 4, the UI
load numbers unchanged, the demo check 152 of 152, `demo.spec.ts` 14 of 14 (a pixel comparison of
the chain page failed in two runs while the machine was loaded and passed in nine since,
DEVELOPMENT.md "M6 S2b follow-up step 5"). The integrate plugin stays 0.1.3 (nothing it reads
changes shape). Its next release took both (0.1.4, S3c step 4: a `tools/integrate` change, a rebuilt
`analyzr-read.mjs` and a `RELEASES` row): the report label for `provenance-kept` „Unverändert:
analyzr behält die bisherige Angabe, wie die Datei entstanden ist“ (0.1.3's „Unverändert: analyzr
behält die bisherige Herkunft“ is broader now that the place in the tool changes), and a report line
„Danach: Ort im Quellsystem für 6 Modelle aktualisiert“ (the compact preview passing
`identityUpdated`); until then the skill's preview of an identity-only re-export says „keine
Änderung an Relationen und Befunden.“ and hands over the import command as always, which records the
places. For the first analysis: a re-export after a folder reorganization, or a bundle imported over
models first uploaded without one, keeps analyzr's record of where each model lives current with the
normal import and without re-analysis, so the key-map rebuild plans those files as known, the
absent-key list of a scoped export names the right models, the change list points to where a model
lives now, and no duplicate models arise. **Owner decision 30** (2026-10-21, §4) answers the S3c
plan's questions, each with the recommended option: the session agent reads pictures and PDFs itself
into `reconstructed` specs; a safeguard keeps owners' agent rules from relations and placements with
a reconstructed endpoint, as its own small server step after S3c; the bundled CLI ties every change
of `apps/cli`, the client and the contracts to a new integrate plugin version; A1–A5 as recommended.
S3c is planned in four steps (about 8.5 d against the 3 d planned in S0; M6 §8 "S3"): 1.
`analyzr-spec/1` and the deterministic renderer, 2. the converter runner `analyzr-convert.mjs`, 3.
the CLI core in `apps/cli`, 4. the integrate plugin 0.1.4, which also takes the two items of step 5
above; steps 1–3 leave the plugin byte-identical. **S3c step 1 "`analyzr-spec/1` and the
deterministic renderer"** (**done 2026-10-21** on the branch, every gate green with a review round's
fixes: 25 findings of three reviews (renderer, security, tests), 24 fixed, 1 in part, and one bug
the reviews missed, fixed too; M6 §8 "S3c step 1 as delivered"; DEVELOPMENT.md "M6 S3c step 1
(2026-10-21)" and "The integrate plugin and `tools/integrate`"; decision 30):
`tools/integrate/src/spec/` and the entry `src/cli/analyzr-spec.ts`, run from source: `validate`
(every error and warning as `<spec file>: <path>: <message>`), `render` (one spec into a new `.bpmn`
file, for checks), `plan` (the keys against `keymap.json` from each spec's `source.externalPath`,
with `normalize-bpmn plan`'s flags, the specs' tool folders, and the flag `replaces-known-model`)
and `bundle` (an `analyzr-import/1` bundle with the importer `analyzr-integrate/analyzr-spec` 0.1.0,
`derived` `reconstructed` with the spec's `llmModel`, the losses `layout-generated`,
`link-unresolved`, `id-rewritten` and `text-truncated`; a failed model listed, the others written).
The format: YAML 1.2 core or JSON, strict (an unknown key is an error; every parser warning fatal;
no tag, anchor, alias, merge key or non-string key; 2 MB), ids as strings, `source` (`externalPath`,
from converters also `externalId` and `url`), `derived` only in a spec the agent writes, no key, no
name, no `calledElement`, no `callActivity`. The renderer: bpmn-moddle without extensions,
`exporter="analyzr-spec"` without a version, `isExecutable="false"`, every text sanitized as
bpmn-facts does it and cut at 200 (labels and keys) or 2,000 characters (documentation), ids
`<Category>_<source id>` capped at 255 with a hash, the layout ported from the eval layouter and
independent of the order of nodes, flows and data stores (pools and lanes in list order), a runtime
self-check on every render. Integrate 332 tests (205): every
validator message, 9 synthetic goldens with their facts and `RENDER_OUTPUTS` pinned, determinism
(shuffled lists, YAML against JSON, a refined task keeping its id), 200 seeded random specs through
D1, D2 (a), the layout checks, eval's DI rules and the self-check; the Playwright harness spec
`apps/web/e2e/spec-render-import.spec.ts` (no server: the goldens and 50 random renders in bpmn-js's
`NavigatedViewer`; 2 of 2 in the implementing agents' run and again in the fix round's). The plugin
stays 0.1.3 byte for byte after `generate`; `yaml@2.9.1` and the devDependency `bpmn-js@18.31.0`
joined `tools/integrate` (no new package in the lockfile, the notices unchanged); every other count
unchanged; live-run neutral; the readings taken are in §4 ("Taken during M6 S3c step 1"); the lead's
e2e run: Playwright 113 passed and 21 skipped on a scratch stack (step 5's tests plus the harness
spec's 2), the UI load unchanged, the demo check 152 of 152, `demo.spec.ts` 14 of 14. For the first
analysis: landscapes that exist only as Visio, ARIS AML, PDFs or whiteboard pictures get one strict
format and one renderer whose BPMN imports without a warning, draws at once and carries no guessed
call link; steps 2–4 bring them into analyzr in the same first pass as the BPMN exports.
**S3c step 2 "the converter runner"** (**done 2026-10-21** on the branch, every gate green with a
review round's fixes: three reviews (escapes, correctness, release and tests), every finding that
held up fixed, none rejected, the one major a missing test of the bridge between the child and the
converter's context, no working escape; M6 §8 "S3c step 2 as delivered"; DEVELOPMENT.md "M6 S3c
step 2 (2026-10-21)" and "The integrate plugin and `tools/integrate`"; decision 30 (A1), (A4)): the
entry `src/cli/analyzr-convert.ts` with `convert` and the internal `__child`, and in
`tools/integrate/src/spec/` the parent `converter.ts`, the child `child.ts`, the in-context helpers
`inner.ts`, the sandbox `sandbox.ts`, the zip reader `unzip.ts` (the shared `src/zip.ts` unchanged)
and the run record `record.ts`, run from source: `convert <export>` with `--converter`,
`--sha256 <64 hex>`, `--derived converted|reconstructed` (`--llm-model` with `reconstructed`),
`--workspace` and a new or empty `--out` below `specs/`. It refuses unless the converter (a regular
file directly in `converters/`, at most 1 MB, never naming `import`) has exactly the approved
sha256; reads the export below `exports/` itself (hidden files and links skipped and counted, a file
over 64 MB passed on unread, 512 MB per run, zip archives under guards, a refused archive passed on
unopened with its reason); writes the write-once copy `converters/adhoc-<12 hex>.js`; runs the
converter twice in a child Node (`--permission` with one read grant, its own script;
`--disallow-code-generation-from-strings`; a 4 GB heap; `TZ=UTC`, `LANG=C` and `LC_ALL=C` as its
whole environment; the child checks all of it and refuses otherwise), each time in a fresh `vm`
context without host objects (strings never compiled, `Atomics`, `SharedArrayBuffer`, `WebAssembly`
and weak references removed, clock and randomness throwing, promise jobs inside the 120 s limit;
300 s for the child, 256 MB of output) and requires the same result and the same reads; validates
each model as converter output (a failed one listed, a shared tool path or tool id failing every
holder, a byte-identical twin kept once, the others written, exit 1); and writes the specs and
`analyzr-specs.json` (no timestamps: the converter's id, sha256, copy and working copy, the
derivation, the runner `analyzr-convert@0.1.0`, the reads the child counted, the specs with their
sha256 and losses, the failed and duplicate models, the skipped, unread and refused files).
`analyzr-spec validate`, `plan` and `bundle` read the record: a listed spec is converter output and
takes the run's derivation `{kind, converter: adhoc:<12 hex>, llmModel}` and losses, but only while
it is unchanged (`changed-after-run`) and, at `plan` and `bundle`, while the copy in `converters/`
holds the recorded bytes (`run-record`); the record catches mistakes, not forgery. Node 24 has no
network permission (measured: `net.connect` works under `--permission`): the converter reaches no
network only because its context holds no host object, and the German consent draft for step 4 says
so; nor does the heap limit bound typed-array memory (§4 "Taken during M6 S3c step 2" (b)).
Synthetic VSDX and AML fixtures with their example converters (`visio-bpmn.js` `converted`,
`aris-epk.js` `reconstructed`), unverified; D3 (a)–(c) for converter output, through `plan` and
`bundle` to a manifest the contracts accept. Integrate 390 tests (332): every escape of the plan's
critiques fails, the child started by hand refuses in 7 cases, a local listener counts no
connection, the zip guards hold; every other count unchanged; no dependency, server, contract, web,
MCP, procedure, facts or trust-rule change; the plugin stays 0.1.3 byte for byte after `generate`;
live-run neutral; the readings taken are in §4 ("Taken during M6 S3c step 2"); the lead's run: on a
scratch stack the fixtures' Visio export (converted, `adhoc:dc5dcd69948a`, 2 models) and ARIS export
(reconstructed, `adhoc:c987bfc789d4`, 2 models) went through `convert`, `plan` and `bundle` from
source and imported with `analyzr import`: no extractor warning, every revision `derived`, no
relation at all (so no call proposed or accepted, D3 (d)), a second import all `unchanged`. For the
first analysis: once 0.1.4 ships, the integrate skill turns Visio and ARIS AML exports into specs in
the same first pass as the BPMN exports: the agent writes a small converter, the consultant approves
each version by its hash, and it runs boxed in.
**S3c step 3 "the CLI core"** (**done 2026-10-21** on the branch, every gate green with a review
round's fixes: three reviews (behaviour, security, structure), of their findings (nits and parts
counted) 16 fixed with tests, 3 in part and 2 rejected with a reason, the one major a bypass of
the parse guard by a repeated option or the `--` that ends the options, fixed; M6 §8 "S3c step 3
as delivered"; DEVELOPMENT.md "M6 S3c step 3 (2026-10-21)" and "The `analyzr` CLI"; decision 30
(3), (A5)): only `apps/cli` changes. `src/core-program.ts`'s `buildCoreProgram(io, {description,
commandName, mcpEntry, ownerKeyLoopbackOnly})` holds the 34 commands both CLIs share (every one
but `seed`, which reads the checkout's `eval/corpus`, and `mcp`, whose MCP SDK would more than
double the bundle), moved unchanged from `src/program.ts` except that `import` and `status` take the
command name, `token create` the entry and `globals()` the loopback flag; `src/program.ts` now adds
`mcp` and `seed` in today's order; the help of all 43 command paths is pinned by a snapshot taken
before the split and unchanged after it. `src/plugin-main.ts`, the bundle's entry (not in
`tools/integrate`'s `ENTRIES` before step 4), runs the core with `commandName`
`node <path of analyzr.mjs>` (from `process.argv[1]`, shell-quoted only where it needs it, as
`shellArg` does) plus `--url <url>` when the run talked to another than the default URL, named in
every next step `import` prints (the amendment conflicts' `questions`, `models delete` and
`external-ids` after identity warnings, the owner rule steps' `rules apply`, `enable` and `add`,
`token create` with `(in analyzr's repository)` after the start prompts, `value-chain push`, the
batch line's `status`) and in `status`'s hint for an analyzr without projects (without `seed`),
while the checkout's CLI keeps `analyzr`; with `mcpEntry` null, so `token create` outside the
container prints the Claude Code command and `Claude Desktop: the stdio bridge needs analyzr mcp
from an analyzr checkout or the container (docs/DEVELOPMENT.md); the plugin's analyzr.mjs has no
mcp` instead of a config naming a missing file (`CLI_MAIN` moved to `src/cli-main.ts`, so no bundle
carries a `main.ts` path); and with `ownerKeyLoopbackOnly`: the owner key goes only to `127.0.0.1`,
`[::1]` and `localhost` (the host as fetch parses it, over http(s), no user name or password in the
URL; `no_proxy` and `NO_PROXY` set to `*` first), checked before the key file is read and again
before the request; an agent token goes anywhere, and the checkout's CLI is unchanged. The parse
guard (`guardValues`, which `runProgram` sets on the whole tree of either CLI, `seed` and `mcp`
included): a word that reads as a flag (`--` and no whitespace) given as an option value at any
occurrence (a repeated option, a list, `--name=--x`, the global options), or as an argument after
`--`, is a usage error, exit 2, before any action runs (`analyzr: --name "--dry-run": an option
value never starts with --; did you forget the name?`, `analyzr: argument "--dry-run": an argument
never starts with --; an option belongs before the -- that ends them`); text with a space,
environment values and defaults pass. CLI 317 tests (286) plus 7 skipped: `core-program.test.ts`
(19), `plugin-main.test.ts` (9: both entries as child processes against fakes, the same requests,
batches and output except the command name, the guard, the loopback rule, the proxy), the help
snapshot, `token create` without an entry, a bundle of rendered specs; every other count unchanged;
no server, contract, client, web, MCP, procedure, migration, dependency or plugin change (0.1.3 byte
for byte after `generate`); live-run neutral; a scratch bundle of `plugin-main.ts` (rolldown as
`bundle.ts` runs it, not in `ENTRIES`): 652,994 bytes (150,641 gzip), one chunk, no warning, no
dynamic import, running away from `node_modules`; the readings taken are in §4 ("Taken during M6 S3c
step 3"); the lead's run: every gate on the final tree, with the CLI e2e suite (29 tests on
Testcontainers: the import lines with `analyzr` as before) and the parity tests of the plugin entry
run from source; no stack, since neither the server nor the web changed (the bundle against a stack
is D4, step 4). For the first analysis: once 0.1.4 ships, a consultant without a checkout imports a
landscape with the plugin's CLI and gets next steps that name a command they can run against the
same analyzr, and a dry run whose project name was forgotten can no longer import for real.
**S3c step 4 "the integrate plugin 0.1.4"** (**done 2026-10-21** on the branch, every gate green
with a review round's fixes: three reviews (skill, release, flows), of their 28 distinct findings 26
fixed, 1 rejected (the two meanings of „unverändert“, §4 "Taken during M6 S3c step 4" (c)) and 2
items for the docs pass (the package graph's coupling, `validate` silent on symbolic links); M6 §8
"S3c step 4 as delivered"; DEVELOPMENT.md "M6 S3c step 4 (2026-10-21)" and "The integrate plugin and
`tools/integrate`"; decision 30): `scripts/bundle.ts`'s `ENTRIES` gain `analyzr-convert.mjs`,
`analyzr-spec.mjs` and `analyzr.mjs` (`../../apps/cli/src/plugin-main.ts`), `GENERATED_RUNTIMES`
names hey-api as the client's runtime in the notices, and the shared modules steps 1–3 deferred are
in place (`src/plan-args.ts`, `capped` and `uniqueId` from `src/ids.ts`, the versions in
`src/version.ts`; `ANALYZR_READ_VERSION` 0.1.1, since the compact preview counts `identityUpdated`
and `modelled`). The plugin 0.1.4 (`RELEASES['0.1.4']`
`c5d396e863ca18b7137330575ff83227fb6d0f045280336b2725f844f1c65eb2`, the older rows untouched; the
marketplace and `packages/procedures`' pin of it unchanged, R24; `claude plugin validate --strict`
passed for the plugin and the marketplace with Claude Code 2.1.306, with one informational
`ICON_MISSING`) holds 17 files, 1,933,960 bytes: `analyzr-spec.mjs` 496,944 (113,421 gzip),
`analyzr-convert.mjs` 335,915 (81,452), `analyzr.mjs` 652,192 (150,069), the rebuilt
`analyzr-read.mjs` 36,957 and `normalize-bpmn.mjs` 244,061 (model bytes and `NORMALIZE_BPMN_VERSION`
unchanged), `inspect.mjs` byte-identical, and notices of 13 packages (new: yaml 2.9.1, zod 4.6.5,
commander 15.0.0, `@asteasolutions/zod-to-openapi` 9.1.0, `@hey-api/openapi-ts` 0.99.0 and rolldown
1.2.12's runtime helpers). SKILL.md (72 KB, `allowed-tools` byte-identical and pinned): step 0
chooses the import path (`$ANALYZR_CLI`, a named checkout, else `"plugin"`, `null` only for the web;
a recorded one is kept); step 2 three paths per group of files plus "not readable here" (`.vsd`,
`.bpm`), pictures looked at first; step 2a writes the converter, measures it (`shasum -a 256`, `wc
-l`), asks confirmation 4 in the words drafted in S3c step 2 and ends the turn, then runs
`analyzr-convert.mjs convert … --sha256 <the sha256 it showed>` and reports the measured reads; step
2b reads pictures and PDFs with the agent's own file reader only (only what the picture shows, roles
in place of people's names in every field, `validate` until no error); steps 3–5 run
`analyzr-spec.mjs plan` and `bundle` on spec folders, ask the two questions of
`replaces-known-model`, keep other paths' models off the absent list and stop a spec bundle whose
preview shows modelled files or calls; the report adds the „Kurzfassung“ per path (R30),
„Konverter“, „Aus Bildern rekonstruiert“, the new labels, the two items of S2b's follow-up step 5
(above) and, for any reconstructed model, the decision-30 (2) line (until 0.1.5) in „Offene Punkte“;
„Import“ gives one command per bundle and the web path always. The reference notes `images.md`,
`analyzr-spec.md` and `converters.md` are new (their examples validated, rendered and run by
`plugin.test.ts`), `visio.md` and `aris.md` follow the fixtures' assumptions (marked to verify),
`adonis.md` names the ADOxx converter path and `bizagi.md` asks for BPMN instead of a `.bpm`.
`apps/cli` changes one function: `pluginCommand` always adds `--url` (§4 (a)). Integrate 407 tests
(390), CLI 327 (317; 297 unit, 30 e2e) plus 7 skipped, every other count unchanged; no server,
contract, client, web, MCP, procedure, migration or dependency change; the eval reports and the root
`THIRD-PARTY-NOTICES.md` unchanged; live-run neutral; the readings taken are in §4 ("Taken during M6
S3c step 4"); the lead's run: on the scratch stack `analyzr-s3c4` the bundled `analyzr-convert.mjs`,
`analyzr-spec.mjs`, `analyzr.mjs` and `analyzr-read.mjs`, run from a copy of the plugin in a folder
with a space outside the repository, took the fixtures' Visio (`converted`) and ARIS
(`reconstructed`) exports through convert, validate, plan, bundle and import with the owner key: 2
and 2 models `created`, no extractor warning, every revision `derived` with its `adhoc:` converter,
no relation at all, the dry run's `callsProposed` and `acceptedCalls` 0, a second import and the
preview all `unchanged`, the next steps naming `node '<path>' --url …`; the owner key refused for
192.0.2.1 and `--name --dry-run` refused with exit 2 before any request; the commit: this step's
commit on the branch, with which 0.1.4 counts as released. Open for the owner: the one live
session (§8) and the readings (§4). For the first analysis: one skill run brings Visio, ARIS AML,
PDFs and whiteboard pictures into analyzr in the same first pass as the BPMN exports, consultants
without a checkout import with the bundled CLI, and an identity-only re-export reports that its
import records the new places. **S3c as a whole** (four steps, all on 2026-10-21, about 8.5 d
planned; M6 §8 "S3c as delivered"): one strict spec format with a deterministic renderer, a boxed-in
runner for the converters an agent writes, one CLI core for the checkout and the plugin, and the
plugin 0.1.4 that uses them; D1, D2 (a), D3 (a)–(c) and D5 in the gates, D2 (b) in Chromium,
D3 (d) and D4 on Testcontainers, and with the bundled scripts on the lead's scratch stack too. **The
decision-30 (2) safeguard step** (**done 2026-10-28** on the branch, every gate green
with a review round's fixes: two reviews (correctness, surfaces and release), 9 findings, 3 fixed (2
with tests), 2 rejected as code changes with a reason, 3 for the docs pass, 1 for the owner (§8); M6
§8 "Decision-30 (2) safeguard as delivered"; DEVELOPMENT.md "M6 decision-30 (2) safeguard
(2026-10-28)"; decision 30 (2)): the block reason `reconstructed-endpoint` keeps every owner's rule
(agent rules for relations and placements, rules for derived calls on the callee side) from anything
with an end in a model whose uploaded revision declares `reconstructed` or `as-told` (an amended
head: its upstream's; the declaration, not the class), right after `agent-upload`, in every write
path, „Anwenden“, the preview, its replay and the dry runs; decision 9's system rule, the humans'
decisions and the acceptances made before are unchanged. The web labels it „Modell KI-rekonstruiert
oder aus Interview“ where a rule is held back and offers no rule after a bulk accept whose pairs no
rule could accept; the CLI's suggestion after an import skips calls into this import's reconstructed
or as-told files; the integrate plugin 0.1.5 bundles the new contracts and drops the report line
„Bis analyzr das ausschließt, …“. Server 1,828 tests (1,804), contracts 180 (178), web 666 (663),
CLI 328 (327) plus 7 skipped; no migration, MCP, procedure or dependency change, live-run neutral;
the readings taken are in §4 ("Taken during the decision-30 (2) safeguard step"); the lead's run:
the whole Playwright suite on a scratch stack, 114 passed and 21 skipped (the new
`reconstructed-rules.spec.ts` among them; `auto-accept`, `derived-call-rules` and `trust-calls`
green), the UI load numbers as before, the demo check 152 of 152, `demo.spec.ts` 14 of 14; two flaky
checks made robust on the way (the mobile review screen's ‹ › hit test ignores that a disabled
button takes no pointer events; the chain page's CSS check waits until the canvas has settled); the
commit: this step's commit on the branch, with which 0.1.5 counts as released. Open for the owner:
the agent-token re-upload residual (§8). For the first analysis: owners' rules can stay on over the
whole first pass, whiteboards and PDFs included, and nothing an LLM read is accepted unseen.
**S6 "Interviews"** (planned 2026-10-28 after a design and a privacy critique; M6 §8 "S6's plan";
owner decision 31 answered its questions): five steps, about 8 d against the 3 d of S0, each
shippable with every gate green: 1. the skill text generator (integrate-landscape's source moved
byte for byte, 0.1.5 stays); 2. the interview guide with `analyzr-interview.mjs` and the
`transcripts/` rule in every skill (**0.1.6**); 3. the transcript pre-processor
`transcript-prep.mjs` from source (formats, masking, segments, the read lock's check; 0.1.6 stays),
once the owner's sample transcripts are in (decision 31 (4)); 4. the fact sheet with citations, the
answers CSV, as-told drafts with their bundle checks, the skill interview-facts with its start
prompt, the marketplace description and its pin (**0.1.7**); 5. integrate-landscape and interviews
(a later tool model's hint to delete the draft, decision 31 (1); a transcript in an export named by
its path, never read; **0.1.8**). **S6 steps 1–2 "the skill text generator and the interview
guide"** (**done 2026-10-28** on the branch, every gate green with a review round's fixes: three
reviews (guide, security, generator), of 35 findings 31 fixed with tests, 3 in part and 1 rejected,
a cosmetic line length; M6 §8 "S6 steps 1–2 as delivered"; DEVELOPMENT.md "M6 S6 steps 1–2
(2026-10-28)"; decision 31 (2), (3)): the plugin's skill texts and the German Desktop start prompts
come from one source per skill in `tools/integrate/skills/` with shared fragments, and the skill
`/analyzr-integrate:interview-guide` with its script `analyzr-interview.mjs` turns the open
questions (the CLI's JSON list, else the web's Markdown or CSV export) into a German guide per
contact group, chosen by slug, in analyzr's order, every question verbatim with its id, the agent's
landscape notes checked by the script, the neutral consent checklist first and „du“ to the
interviewee; it pre-approves nothing, writes nothing to analyzr and reads the landscape over the
read-only MCP server `analyzr-lesen`; both skills keep the agent out of `transcripts/`. The
integrate plugin is 0.1.6 (`RELEASES['0.1.6']`). Integrate 480 tests (407), CLI 330 (328) plus 7
skipped; no server, contract, client, web, MCP, procedure, migration or dependency change, live-run
neutral; the readings taken are in §4 ("Taken during M6 S6 steps 1–2"); the lead's run: every gate
on the final tree, the CLI e2e suite on Testcontainers with the guide from the server's own export
(330 CLI tests plus 7 skipped), `generate` twice with identical bytes, `claude plugin validate
--strict` passed; no stack, since neither the server nor the web changed;
the commit: this step's commit on the branch, with which 0.1.6 counts as released. Open for the
owner: the readings (§4; (b) adds to decision 31 (3)'s
checklist, (c) is about transcripts before the read lock), the sample transcripts and the checks
before the first real interview (§8). For the first analysis: the open questions analyzr finds
become a ready interview guide per contact group in one step, and every answer maps back by its
question id. **Next:** S6 step 3, the transcript pre-processor, once the owner's sample transcripts
are in (decision 31 (4)); then step 4 (the fact sheet, as-told bundles, the marketplace description,
0.1.7) and step 5 (0.1.8); after the owner's live runs S5b, S7 and facts v2. Queued for a later
step: the root `THIRD-PARTY-NOTICES.md` does not name `@hey-api/openapi-ts`, whose runtime the
client also carries into the web bundle and the CLI (`tools/notices` could take the plugin's
`GENERATED_RUNTIMES`); the analyzr-integrate description in `.claude-plugin/marketplace.json`, which
still names only the BPMN path: update it with S6 step 4, which touches `packages/procedures`'
pin of it anyway (S3c plan R24); and two READMEs outside the plugin's hash, so without a new
plugin version: `examples/agents/claude-code/README.md` still says the skill pre-approves
only `inspect`, names the BPMN path only and names neither the interview guide nor its
read-only server `analyzr-lesen` (the Claude Desktop README does since S6 step 2), and
`examples/agents/codex/README.md` lacks `converters/`, `specs/`, the picture path (which needs
an agent that can view pictures) and the interview guide; both should name the three paths, the
bundled CLI, the approval per converter run and the two pre-approved scripts. The owner's review of
S1–S2a, ideally on a sandbox or anonymized export (M6 §10.4), can run alongside. Nothing of M6
changes released procedures, claim inputs or the MCP surface before the owner's live runs for the
Camunda landscapes a human imports (since S2c-1 a derived landscape's unique calls reach agents'
claims as unsettled rule proposals, M6 §8 "S7").

### Paused milestone: process network map, M5 (owner decisions 22 and 24)

The bottom-up network of relations (diagram-js + elkjs, value chain steps as groups, saved views,
impact analysis, end-to-end paths, MCP `impact_of` and `trace_landscape_path`); scope and open
questions are in issue [#2](https://github.com/Miragon/analyzr/issues/2). First step when the owner resumes: the
concept `docs/M5-PROCESS-MAP.md` (as `docs/M4-VALUE-CHAIN.md`), then slices.

### Later (R1 and beyond)

Lint workflow, descriptions/glossary by agents, OKF export (deferred, decision 22), server mode (OIDC, users, invitations,
public URL for claude.ai/ChatGPT/Routines), runtime overlays from Camunda 7/8, Web Modeler and
Git/bpmiq.yml import, MCP App widget.

### Migration owner actions (decision 23)

0. **Done 2026-10-12** (before the initial commit, at the owner's request, without opening the
   file): a count-only check showed that the one match in
   `eval/corpus/stadtwerke-auental/README.md` was the old baseline id; the main agent replaced it
   blindly with `sed` by `baseline-label/1`. Every holdout file now counts 0 matches
   (`grep -ric proa eval/corpus/stadtwerke-auental eval/value-chains/stadtwerke-auental`).
1. **Done 2026-10-12:** the private repository `Miragon/analyzr` with the initial commit on
   `main` (`f83ce07`); CI green (all three jobs).
2. Set a ruleset for `main` (the owner): the three CI jobs of `ci.yml` as required status checks,
   "Typecheck, lint, test", "Docker image and compose stack" and "Read-only demo image" (rulesets
   require checks by job name, not by workflow; they appear in the picker only after CI has run
   once, so after the push of step 1), and the commit and merge rules of §8.
3. **Done 2026-10-12:** the Fly app `analyzr-demo` (organization `miragon`), an app-scoped deploy
   token as the secret `FLY_API_TOKEN` (**expires 2027-10-12**; renew with `fly tokens create
   deploy --app analyzr-demo --expiry 8760h | gh secret set FLY_API_TOKEN --repo
   Miragon/analyzr`), the first deploy dispatched on `main`; the smoke check passed 126 checks
   against https://analyzr-demo.fly.dev with both legal links; a shared IPv4 (free), one
   `shared-cpu-1x` machine with 1 GB that stops when idle.
4. **Done 2026-10-12:** the issues moved from `Miragon/ProA` (#3 → [#1](https://github.com/Miragon/analyzr/issues/1),
   the demo, closed as delivered; #4 → [#2](https://github.com/Miragon/analyzr/issues/2), the
   process network map, rewritten for analyzr).
5. Not needed: the owner deletes the repository `Miragon/ProA` (with PR #2 and its secrets).
6. **Done 2026-10-12:** the old Fly app `proa-demo` is destroyed (its deploy token with it).
7. Re-add the MCP server as `analyzr` in Claude Code, Claude Desktop and Codex with new agent
   tokens (old tokens, owner keys, the `proa` entries and `mcp__proa__*` allow-lists no longer
   work), and install the plugin `analyzr` (`claude plugin install analyzr@analyzr`).
8. Check that https://miragon.io/datenschutz/ covers the renamed demo.

## 8. Open questions for the owner

| Topic | Question | Source |
|---|---|---|
| Rules on `main` | Which rules apply on `main` (pull requests only, squash merges, signed commits, the three CI jobs as required checks, §7 "Migration owner actions", step 2)? Until you decide: agents commit on feature branches, and nothing lands on `main` without your explicit OK (decision 12). | Decision 23 |
| Going public | When does the repository go public? While it is private, the demo banner's link „analyzr auf GitHub“ answers 404 for visitors, a marketplace install from `Miragon/analyzr` needs repository access, and GitHub Actions minutes are billed. | Decision 23 |
| Logo and trademark | The web UI shows the Miragon mark next to the analyzr wordmark; the README says the Miragon name and logo are not licensed under MIT. Should analyzr get a logo of its own? A trademark check of the name (and of the npm scope `@analyzr`) before a first release? | Decision 23 |
| Dependabot | Set up Dependabot for the pnpm workspace (exact versions, grouped updates)? Until then dependency bumps are manual. | Decision 23 |
| Holdout per-item lists | `eval/reports/candidates.md` and `replay.md` list the holdout's misses and wrong pairs per item (`placements.md` shows aggregates only). Fine while the repository is private; switch them to aggregates before it goes public? | Decision 23 |
| First users | UI upload or Git/bpmiq.yml repos? Decides whether folder/bpmiq.yml import moves earlier. | CONCEPT §12 |
| Shared-name flag | The bulk dialog flags 20–22 of 33 key-tier pairs (names used by >2 processes), incl. legitimate broadcasts. Keep, or flag only names with several senders? Since UX5 the flagged pairs sit under „Genauer ansehen“ (no checkbox, decided one by one) and the button names the unflagged ones („11 unauffällige annehmen …“), so the flag decides what the bulk leaves out; an auto-accept rule shows the flagged count and is not blocked (Q8, decision 26 (7)); whether it should block is decided after the live runs with the what-if. | M2 web stage |
| `correct` on a typed pair | Correcting towards a pair that already has a key-tier proposal creates a second, manual relation. Offer "accept the existing proposal instead"? | M2 e2e |
| Revoking a token | Revoking now withdraws that token's open proposals and no-links (CONCEPT §6) and, since `0.2.0`, queues the models whose pairs it judged again, and, since M4 S2, withdraws its live placement proposals; since M4 S5 the chain's placement task is queued again for the processes it judged. Confirm. | M2 fix, 0.2.0, M4 S2, M4 S5 |
| Ad-hoc verdicts | Since M4 S5 an agent's ad-hoc placement proposals count as its verdict (the pipeline does not judge those processes again); ad-hoc relation proposals do not. Keep the asymmetry? | M4 S5 |
| Message-name matching | Names match ignoring separators (`Zahlung_Eingegangen` = `ZahlungEingegangen`). Confirm. | M1 relations |
| Local session | `POST /api/v1/session` is open to any local process (fine single-user, not on shared machines). Add a one-time login link later? | M1 integrate |
| Auto-accept: token revocation | Revoking an agent token keeps the auto-acceptances its proposals triggered (they are your decisions); the agents page offers to revoke them in the same step. Keep, or revoke them automatically? | Decision 19 |
| Auto-accept: ad hoc | Rules accept only pipeline proposals unless „Auch Ad-hoc-Vorschläge“ is set (ad-hoc proposals have no claim basis). Keep the default off? | Decision 19 |
| Auto-accept: 0.5 floor | No rule may accept below 0.5 confidence (contract and database check). Keep the floor, or raise it (e.g. 0.8)? | Decision 19 |
| Auto-accept: notes block | Any human note on a pair or process blocks a rule, like a decision or a hold (a note is often an answer to a question). Keep, or let a plain note through? | Decision 19 |
| Auto-accept: no re-confirm | After an endpoint change an accepted item waits for a human, also when a rule accepted it; a rule never re-confirms. Keep? | Decision 19 |
| Auto-accept: unique names | Rule names are unique per project ignoring case, so marks and filters are unambiguous. Keep? | Decision 19 |
| Auto-accept: results | Submission and ad-hoc results report the status before rules ran (an agent's `proposed` may already be accepted; `get_relations` shows the truth). Keeps recordings comparable and agents uninformed. Keep? | Decision 19 |
| Auto-accept: marks for editors | Editors see which acceptances a rule made (the ledger names rule, revision, agent and confidence, never the criteria); only owners see the rules, apply and revoke. Keep, or show the marks to viewers too? | Decision 19 review |
| Auto-accept: take-over | A rule whose author lost the owner role matches nothing until an owner saves it; saving it, also unchanged, makes that owner its author (its later acceptances are recorded under them). Since UX9 the rule's „Aktiv“ switch (off for such a rule) and its dialog say so before saving („Du wirst damit die entscheidende Person dieser Regel“), also when another owner wrote it. Keep, or add an explicit „Übernehmen“ action? | Decision 19 review |
| M6: sample exports | Sandbox instances or anonymized exports of ARIS, Signavio, ADONIS, Bizagi, Visio? | M6 §10.4 |
| M6: sample transcripts | By decision 31 (4) you supply short test conversations before S6 step 3's transcript formats are finalized: one each from Teams and Zoom (and Webex, if possible), with invented names, each as VTT and as plain text. Step 3 starts once they are in: its formats (M6 §5 item 2: speaker tags in Teams VTT and the like) are unverified, and the synthetic fixtures only stand in for them. Real customer transcripts never enter the repository. | Decision 31 (4), M6 §10.4, the S6 plan Q4 |
| M6: before the first real interview | An owner action, not a decision, and it does not block S6: before a guide of S6 step 2 is used with a customer's employees and a transcript is evaluated with an AI assistant (step 4), please make sure that the customer contract names the operator's LLM vendor as a sub-processor, that the account in use runs on commercial terms without training on the content, and that the customer's rules on recording are clear (a works agreement, who records, whether a VTT may be downloaded to the consultant's machine). Decision 24 (5) covers the transfer on Miragon's side, not these; the guide's consent checklist (decision 31 (3)) asks the interviewee, not the customer. | The S6 plan O-B, decision 31 (3), M6 §7 "Privacy" |
| M6: answers re-queue | May S5b widen the relations judgement basis by human notes and queue tasks (after the live runs), and from S7 on also by subject notes and outside marks? | M6 §10.5 |
| M6: erasure | One database per customer engagement for now, a purge use case with server mode? | M6 §10.6 |
| M6: Modeler saves of the amendment fixtures | S5c-2's golden fixtures are hand-written in the Camunda Modeler's layout, and the expected files are `applyAmendments`' own output (regression snapshots plus a check of the BPMN XSD's child order, M6 §8 "S5c-2 as delivered"). Could you open `packages/bpmn-facts/test/fixtures/amend/c7-modeler.bpmn` and `c8-modeler.bpmn` once in Camunda Modeler 5.x, make the changes of `test/amend.test.ts`'s two snapshot tests (call targets, names, documentation, the message reference) and save them, so the child order is compared with what the Modeler writes? | M6 §4.8 c, S5c-2 |
| M6: `If-Match` on withdrawals | S5c-2 makes `If-Match` optional on both withdrawal routes (the web always sends the head its dry run showed; `analyzr amendments withdraw --rev <n>`), so a script withdrawing by id keeps working; amendment writes require it. Keep it optional, or require it as on saves (428 without)? | M6 §4.8 c "Concurrency", S5c-2 as delivered |
| M6: `competing-call` and manual links | S5c-1 counts a human's accepted or held `manual` relation from a call element as a competing call only when it goes to another target: an agent's `call` proposal to the same target agrees with the human and is no second target, so an owner's rule may still accept it; the „Regeln“ preview counts a human's later manual link to another target as a correction of the call. Keep this reading of decision 19's „a call has one target“, or count every manual relation from the call element (then a rule never accepts the agreeing call either)? | M6 §8 "S5c-1 as delivered", decision 19 |
| M6: the second click for screen readers | When a button turns into „Trotzdem importieren“ (the „Vorschau“) or „Trotzdem speichern“ (the amend form, the action panel) because an agent's claim would be cancelled, a screen reader hears nothing new: the warning is an alert announced when it appears and the button points to it (`aria-describedby`), but the focused button's new name is not reliably read out. The amend form has worked this way all along, so it is no regression. Add a polite live region that says to click once more, in all three places at once, or keep it as is? | M6 §8 "S2b follow-up step 3 as delivered", §4 "Taken during the M6 S2b follow-up step 3" (g) |
| M6: the integrate skill, one live session (plugin 0.1.6) | Plugin 0.1.6 (M6 S6 step 2, on top of the decision-30 (2) safeguard step's 0.1.5 and S3c step 4's 0.1.4; its new skill interview-guide pre-approves nothing, and its live checks come with the interview skills of 0.1.7, the S6 plan O-A) pre-approves for integrate-landscape, as 0.1.3, 0.1.4 and 0.1.5 did, only `inspect.mjs` and `analyzr-read.mjs` (`allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/../../scripts/inspect.mjs *), Bash(node ${CLAUDE_SKILL_DIR}/../../scripts/analyzr-read.mjs *)`, byte for byte as before), and has, since 0.1.4, the converter path, the picture path and the bundled CLI; no LLM call was made, so none of it was tried in Claude Code. Could you run one session (Claude Code 2.1.306 or later)? Setup: a scratch analyzr of your own, built from the same checkout (0.1.5 and 0.1.6 assume an analyzr with the decision-30 (2) safeguard; a compose project `analyzr-<x>` on free ports, `analyzr seed`; for the scripts and the CLI on the host a copy of its owner key with `ANALYZR_OWNER_KEY_FILE`, DEVELOPMENT.md "The `analyzr` CLI"), a workspace outside the checkout prepared so that step 0 asks nothing and the invoking turn reaches step 1 (the folders `exports/`, `inventory/`, `bundles/` and `reports/`, and `<ws>/analyzr-workspace.json` with `format` `analyzr-workspace/1`, `project` `{"key": "nordwind-handel", "name": "Nordwind Handel GmbH"}`, `analyzrUrl` the scratch analyzr's URL, `cli` `"plugin"` and `systems` `[]`) with three exports: `exports/2026-10-14-signavio` (a copy of `tools/integrate/test/fixtures/signavio/2026-10-14-signavio`), `exports/2026-10-14-visio` with `Vertrieb/Prozesse.vsdx` and `Service/Reklamation.vsdx` (`cd <checkout>/tools/integrate/test/fixtures/converters/visio/prozesse && zip -X -D -r <file> .`, likewise `reklamation`) and a `Liesmich.txt`, and `exports/2026-10-14-bilder` with one photo of a hand-drawn process or a PDF of one, one lane named after an invented person; Claude Code started in `<ws>` with `--plugin-dir <checkout>/plugins/analyzr-integrate`. (1) Run `/analyzr-integrate:integrate-landscape exports/2026-10-14-signavio` and ask in the same message, after the export, to run `analyzr-read.mjs --help` first, with the script path as the skill's step 3 writes it (`node ${CLAUDE_SKILL_DIR}/../../scripts/analyzr-read.mjs --help`): in this invoking turn both it and step 1's `inspect.mjs` must run without asking (step 0's `curl` health check is not pre-approved and may ask), which shows that both comma-separated rules parse and that `${CLAUDE_SKILL_DIR}` expands inside `allowed-tools`; if either script asks here, the rules or the variable fail, whatever (2) shows. Confirmation 1 must say that the agent looked at `Prozesslandkarte.pdf`, found no readable content (the fixture's PDF is a placeholder without any) and leaves it out, named in the report as not taken over, without reading it as a model or calling it a landscape map (the skill's own example says „Das PDF zeigt eine Prozesslandkarte“; said of this file, that would be made up). (2) Answer the confirmations: do `analyzr-read.mjs models` and `external-ids` (step 3) and `preview` (step 5), in later turns, run without asking? If Claude Code asks only there, after (1) ran both scripts without asking, the pre-approval lasts for the invoking turn only: decide whether the guard setup should offer a lasting `permissions.allow` rule with the expanded plugin path (its `/../../` form included; to be offered again after each plugin update), or one approval per run stays. (3) Ask the agent to run the pre-approved command with, one at a time, `; echo x`, `&& echo x`, `\|\| echo x`, `\| cat`, a newline and a second command, a prefix `NODE_OPTIONS=…`, `HTTP_PROXY=…` or `ANALYZR_TOKEN=…` in front, a redirect `> ~/x`, `$(…)` or backticks in an argument, and the path `node ${CLAUDE_SKILL_DIR}/../../scripts/analyzr-read.mjs/../analyzr.mjs --help`: each must make Claude Code ask (deny it). (4) Run the skill on `exports/2026-10-14-visio`: confirmation 1 must name the converter path with „Konvertiert“ and ask for the system „visio“. (5) Confirmation 4 must show the path `converters/<…>.js`, its line count, `adhoc:<12 hex>`, the full sha256 (compare it with your own `shasum -a 256`) and the sentence that Node cannot guarantee a ban on network access, and the turn must end there, with no allow rule offered. (6) Say yes: Claude Code's own prompt must appear for `node …/analyzr-convert.mjs convert … --sha256 <that hash> … --out "<ws>/specs/2026-10-14-visio" --json-out "<ws>/reports/2026-10-14-visio.convert.json"`; approve it once, never with "don't ask again"; the agent's „Der Konverter hat … gelesen …“ must match the printed `reads`, with „Liesmich.txt“ not taken over. (7) Have one comment line added to the converter and run it again: confirmation 4 must come again with a new hash, and pushed to reuse the old hash, the runner refuses (`… has the sha256 …, not the approved …`). (8) Keys, bundle and preview: `analyzr-read.mjs` as found in (2); `analyzr-spec.mjs plan` and `bundle` ask (approve each once); the report must have the „Kurzfassung“ counted per path, „Konverter“ with the measured reads and „Weggelassen: … Elemente ohne Prozessbedeutung“, „Bonitätsprüfung“ under „Verweis nicht aufgelöst“ with „Verknüpfen mit …“, and `callsProposed` 0. (9) Run the skill on `exports/2026-10-14-bilder`: confirmation 1 must propose the system „images“; the agent reads the file with its own file reader only (no web, upload or connector tool in the transcript) and writes `specs/2026-10-14-images/*.spec.yaml` with `derived: reconstructed` and its model id, the role in place of the invented name everywhere (`documentation`, `notes` and `source.file` included), until `validate` is clean; the report's „Aus Bildern rekonstruiert“ must ask you to check the models and name each picture by its `source.file`, and „Offene Punkte“ must no longer carry „Bis analyzr das ausschließt, …“ (gone since 0.1.5). (10) In a terminal, run the printed `node "<plugin>/scripts/analyzr.mjs" --url … import … -p … --create --name …`: its next steps must carry `--url <url>`, also for http://127.0.0.1:7400; a second run must be all unchanged; asked to run that import itself, the agent must refuse (ground rule 2); the model view must show „Konvertiert“ with `adhoc:…` and „KI-rekonstruiert“. (11) Ask for the guard setup (the skill offers it on first use only, which the prepared workspace skips) and accept it (the workspace's `.claude/settings.json`), create a read token in a terminal (`node "<plugin>/scripts/analyzr.mjs" --url <url> token create -p nordwind-handel -n integrate-preview -s analyzr:read`), set it as `ANALYZR_TOKEN` and restart Claude Code in `<ws>` from that shell: `/permissions` shows the deny rule, `/sandbox` is active, the preview reaches 127.0.0.1, the agent cannot read the owner key file (point the deny paths at it), `ANALYZR_TOKEN` reaches the sandboxed command; note whether the sandbox sets `NODE_USE_ENV_PROXY` or `--use-env-proxy` with `HTTP(S)_PROXY` (then `analyzr-read` refuses by design and the skill falls back to the printed dry run), whether a converter run still starts its child Node there, and whether it reaches the network, which Node 24 cannot forbid. (12) Look at what "don't ask again" would write for the CLI's dry run and for `analyzr-convert.mjs` (accept neither), and note whether the 72 KB skill loads and behaves completely. Tell me what asked and what did not. | M6 §8 "S6 steps 1–2 as delivered", "Decision-30 (2) safeguard as delivered", "S3c step 4 as delivered" and "S2b follow-up step 4 as delivered"; §4 "Taken during M6 S3c step 4", "Taken during the M6 S2b follow-up step 4" (i) and "Taken during M6 S3c step 2" (c); decisions 29 (2) and 30 |
| M6: the identity rows on `analyzr-local`, optional | Step 5 backfilled 0 identity rows on `analyzr-local`: none of its 63 revisions was imported with a manifest, so it has no identity yet. If you like, check one case once there, a bundle imported over models first uploaded without it: drop the golden bundle folder (`tools/integrate/test/fixtures/signavio/bundle`) into „Hochladen“ of `signavio-beispiel`; if its models came from the same bytes without the bundle, the „Vorschau“ says „Danach: Ort im Quellsystem für 6 Modelle aktualisiert“ with „Importieren“, and afterwards „Herkunft“ and `analyzr models external-ids -p signavio-beispiel` show the tool folders (the files also get „Unverändert: …“ hints, and which ones depends on that stack's data: if those revisions were stored before the trust rule and you did not review them as derived, all six say „… ob es die Aufrufe des Modells annimmt oder nur vorschlägt …“ and the three declared `export` also „… die bisherige Angabe, wie die Datei entstanden ist …“; otherwise all six say the latter). You may skip it: a server test covers this case, the CLI e2e and Playwright a moved re-export on scratch stacks. Nothing touches `analyzr`, `analyzr-demo` or `analyzr-eval-engines`. | M6 §8 "S2b follow-up step 5 as delivered", §4 "Taken during the M6 S2b follow-up step 5" (a), (b) |
| M6: calls from ad-hoc converters, later | No spec yields a `calledElement` in S3c, whatever its derivation: a call is rendered as a collapsed subprocess named after its target, with the loss `link-unresolved`, which the consultant links with „Verknüpfen mit …“ (M6 §3.9). M6 §3.9 meant to revisit this with S2c, which is delivered, so a rendered call would now be a 90 % proposal anyway. Should calls from ad-hoc converters whose target is a model of the same export, resolved by that model's tool id and never by a name, later be written as real calls: only as proposals (tier `key`, 0.9) that you accept in bulk? Recommendation: yes, as a later step once a sandbox AML or Visio export (M6 §10.4) shows how process interfaces and off-page links look; the renderer, not the converter's free text, resolves the target. Decision 30 left it open. | Decision 30 (Q2 of the S3c plan), M6 §3.9 and §10.12 |
| M6: an agent token's re-upload of a reconstructed model | The decision-30 (2) safeguard reads only the declaration of a model's uploaded revision. A principal with an agent token and `analyzr:write` that uploads changed bytes of a reconstructed or as-told model without a manifest (PUT or import) stores a revision that declares nothing, so from then on your agent rules (say „Nachricht ab 0,9“, a placement rule) may accept that agent's message, signal, trigger and placement proposals on the model again, and your rules may accept calls into it again (an agent's call proposal, or a derived caller's call under a rule for derived calls); only its own calls stay blocked, by `agent-upload` (decision 28 (1), `call` relations only). It is no regression (before the step nothing blocked them) and is pinned in a unit test, so a change is deliberate. A person's re-export with changed bytes and no declaration lifts the safeguard on purpose (a person exported or edited the file). Close the gap for agent tokens? (a) An agent token's upload without a declaration keeps the `derived` kind of the model's previous uploaded revision; (b) `agent-upload` blocks your rules (agent rules and rules for derived calls) on every relation and placement with an end in a model whose uploaded revision an agent token uploaded, not only on its calls (an extension of decision 28 (1), which then also covers models an agent token uploaded from the start); (c) keep it as built. Until you decide: (c). | M6 §8 "Decision-30 (2) safeguard as delivered", §10.13; §4 "Taken during the decision-30 (2) safeguard step" (o) |

## 9. Working agreements and pitfalls

- **Process safety (hard rule):** never use `pkill`, `killall` or `kill` by pattern. A subagent
  once killed the owner's apps (Docker Desktop, Teams, …) with a mis-ordered BSD `pkill`. Stop
  only PIDs you started; stop containers only via `docker compose -p <own project>`.
- **Shared Docker:** the owner runs other containers on this machine, including the stacks of the
  earlier repository (§6 "Machine state"). Never stop or modify them. The owner's analyzr uses the
  compose projects `analyzr` (ports 7400, 7401 for Vite, 55432), `analyzr-demo` (7480) and
  `analyzr-eval-engines` (18080/18088) and the image tags `analyzr:local` and `analyzr-demo:local`;
  agents never touch them
  either (`pnpm docker:up`, `pnpm db:up`, `pnpm db:down` and `pnpm engines:up` act on them). Agents
  verify only with compose projects and image tags `analyzr-<x>` they create themselves, on free
  ports (`ANALYZR_HOST_PORT`, `ANALYZR_DB_PORT`, `ANALYZR_IMAGE`), and remove them afterwards.
- **Exact dependency versions** everywhere (no `^`/`~`; pnpm 11 with `saveExact`, see
  DEVELOPMENT.md). After a dependency change run `pnpm notices`.
- **Domain purity:** `apps/server/src/domain` imports nothing from db/http/mcp/auth
  (dependency-cruiser, part of lint). Contracts first for every route. Authorization via
  `policy.require(actor, permission, projectId)` in every use case; foreign ids → 404.
- **Agents never decide** – keep that invariant in policy, DB check and MCP.
- **Holdout hygiene:** `stadtwerke-auental` is the holdout. Whoever writes or tunes a procedure
  never reads `eval/corpus/stadtwerke-auental/{expected.yaml,README.md,spec/}` (ground truth and
  traps), `eval/recordings/**/stadtwerke-auental.jsonl`, `eval/value-chains/stadtwerke-auental/`,
  or the stadtwerke sections of `eval/reports/*` (they list missed and wrong pairs). Live agents
  start outside the checkout with MCP tools only (Claude Code `--tools ""`; Codex keeps its shell
  and its sandbox allows reads, so a working directory alone does not isolate it: on the holdout
  it runs only in an environment without read access to the checkout); the Docker image ships
  none of these files (`docker/Dockerfile.dockerignore`) except, since M4 S4, the golden chain
  files `eval/value-chains/*/value-chain.vc.json` for `analyzr seed --value-chains`: steps without
  links, the document an agent reads over MCP in a seeded project anyway; the expected
  placements stay out (CI checks it). The placement report `eval/reports/placements.*` shows
  the holdout as aggregate numbers only, none over fewer than 5 processes (no rule tier split,
  no per-tag numbers of small tags). The descriptive report `eval/reports/descriptive.*` (M6 S3a)
  shows it as whole-landscape numbers only, „< 5“ for 1 to 4 items and „hidden“ where nested
  numbers would differ by 1 to 4 (`eval/README.md`, holdout hygiene); its transforms read the
  holdout's models, never its `expected.yaml` (partners come from the unchanged models' facts).
- **Procedure releases are immutable:** recordings are keyed by `<id>@<version>`, and Git-hosted
  plugin installs stay at their version. A change to `relations.md`, to the wrapper
  (`packages/procedures/src/wrappers.ts`) or to the skill frontmatter needs a new version: bump it,
  run `pnpm --filter @analyzr/procedures generate` (skill + plugin version), add the new version's
  sha256 to `RELEASED` in `packages/procedures/test/plugin.test.ts` (its failing test prints it)
  and regenerate the sim recordings (`vitest … agent-sim.test.ts -u` writes the new folder but
  never deletes the old one: remove it by hand). Since decision 23 the table holds
  `analyzr-relations@0.2.0` and `analyzr-placements@0.1.0` only, and the plugin 0.3.0 has one
  release row; the earlier versions were released under the old ids (§3).
- **The integrate plugin moves its version with every change** (M6 S3b): `plugins/analyzr-integrate`
  is unversioned in `RELEASED` and `PLUGIN_RELEASES`; `RELEASES` in
  `tools/integrate/test/plugin.test.ts` pins a sha256 over its files per plugin version (the
  failing test prints it), and `CONVERTER_OUTPUTS` in `tools/integrate/test/bundle.test.ts` pins
  what `normalize-bpmn` writes per converter version; since M6 S3c step 1 `RENDER_OUTPUTS` in
  `tools/integrate/test/spec-render.test.ts` pins what `analyzr-spec` renders from the golden specs
  per `ANALYZR_SPEC_VERSION`. After a change of `tools/integrate/src`, run `pnpm --filter
  @analyzr/integrate generate` (the drift test fails until the bundled scripts match); since plugin
  0.1.4 every entry is bundled, and `analyzr.mjs` bundles `apps/cli`, `packages/client`,
  `packages/contracts` and the root `package.json`'s version, so a change there needs `generate`
  and a new plugin version too (decision 30 (3)); no package dependency shows this, so a filtered
  test run after such a change must include `@analyzr/integrate`. A version counts as released
  once it is committed; until then its row may change.
- **Large MCP results:** Claude Code saves tool results above 50,000 characters to a file unless
  the tool declares `anthropic/maxResultSizeChars` (analyzr's tools do); with `--tools ""` an agent
  could not read that file. Keep the declaration on new tools.
- **Verify before claiming:** every milestone so far ran all gates (format, typecheck, lint, tests
  against real PostgreSQL, eval gates, docker build) plus adversarial reviews; keep that standard.
- **Commits** end with the attribution line the owner asks for; nothing lands on `main` without
  the owner's explicit OK (decision 12).
- **`Miragon/value-chain-modeler`** is a separate product (VS Code extension, web app). Consume it
  from npm; changes to it go through its own repo.

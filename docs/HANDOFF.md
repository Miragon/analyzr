# analyzr – Handoff (status as of 2026-10-18)

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
  „Sammeln“ and „Ergänzen“ in the model view, `analyzr models amend|pull`, `analyzr questions
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
  not yet). Its web parts („Herkunft“, badges, the manifest of a dropped folder) wait for the UI
  simplification the owner asked for on 2026-10-17; the skill's key-map rebuild comes with the
  plugin's next version. One owner question: M6 §10.10. **UX2a "Open questions: groups and
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
  deletion impact in `analyzr models delete`, and the web's „Vorschau“ before „Importieren“; the
  follow-up (judgements, tasks, placements) still open; live-run neutral. **Next:** UX3 → UX4 →
  UX5 → UX6 → UX9 (the owner: „Sonst kannst du weitermachen“), alongside S2c (the trust rule),
  S2b's follow-up and S3c; S6 after them; after the owner's
  live runs S5b, S7 and facts v2 as recommended (§7 "M6"; M6 §8 "After S2a").

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
| 8 | `docs/M6-INTEGRATION-AND-GAPS.md` | M6, in progress: integration toolkit, gap analysis, interviews (concept, decisions 24 and 25, answering by action and model amendments in §4.8, slices with what each delivered, the `eval:descriptive` results in §3.11, the `get_landscape` limit in §6, open questions) |
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
   decision 19: the owner may add rules that accept further proposals.
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
    decision 19)".
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
    listed once for a bulk revocation (option a). (3) The **consultant answers gaps**, also in the
    web UI („Ich als berater, aber sollte auch in der UI gehen.“). (4) Gap output form left to the
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
    untouched (live-run neutral).
27. **Claim order** (2026-10-18; §8 "Claim order" answered „ja, mach weiter“, the recommended
    option): a relations claim sorts its relations by type, `from` and `to`
    (`apps/server/src/domain/claim-input.ts`). Before, they came in the database's physical row
    order (`relations.all` has no `ORDER BY`), which updates and vacuum move: on CI two projects
    seeded alike got different claims. Every claim input changes once, before the owner's live
    runs, so two runs of one landscape see one order; the recordings (they keep the claim's size
    and counts) and the replays are unchanged, `claim-golden.test.ts`'s snapshot is re-pinned.

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
built in and shows as the read-only system rule „Eindeutige Aufrufe“; no MCP tool and no rule data
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

## 5. What exists

| Path | Content |
|---|---|
| `packages/contracts` | zod schemas, API resources, OpenAPI 3.1 (contracts-first routes); zod-free subpaths the web may import (`paths` since M6 S1, `open-question-labels` since M6 S4, `open-question-csv` and `personal-data` since M6 S5a; since M6 S5c-1 the labels also name the actions, states and answer roles, and `OpenQuestion.actions` and the action and withdrawal routes are in the API; since M6 S5c-2 `amendment-labels`, the routes of tag `amendments`, `RevisionSource.kind` `amendment` with `upstream` and the plan, and `amendments` and `uploadedRevisionId` in the import and PUT results; since M6 S2a `api/import-manifest.ts` with `ImportManifest` (`analyzr-import/1`), `ImportWarning` and `ExternalIdList`, the typed provenance on `RevisionSource`, `importWarnings` in the import and PUT results, the part `manifest`, the header `Analyzr-Manifest`, `GET …/external-ids` and the open-question kind `extractor-loss`) |
| `packages/client` | hey-api client generated from the OpenAPI document (drift test) |
| `packages/bpmn-facts` | C7/C8 fact extraction, hostile-XML protection, `FACTS_VERSION`; since M6 S5c-2 `applyAmendments` and `readAmendable` (byte-preserving splices of model amendments, checked by extracting again; never a bpmn-moddle round trip) |
| `packages/relations` | rule tier (unambiguous calls, key-tier proposals, findings), candidates for agents, `baseline-label/1`, pair assessor, and since M4 S2 `baseline-prefix/1` and the name-stem rule for placements (`placement.ts`) |
| `packages/procedures` | the released procedures `analyzr-relations@0.2.0` (`relations.md`; judge each pair once) and `analyzr-placements@0.1.0` (`placements.md`, `kind: placement`, M4 S5; judge each process once), the wrappers for the `work_pipeline` and `place_processes` prompts and the Claude Code skills, the `draft_value_chain` prompt text (`prompts/`), the skill generator and drift tests |
| `plugins/analyzr`, `.claude-plugin/marketplace.json` | Claude Code plugin 0.3.0 with the generated skills `/analyzr:relations` and `/analyzr:placements [project] [max-tasks]`; its own version since two skills ship (a test pins every skill's sha256 per plugin release); the marketplace lists both plugins since M6 S3b |
| `plugins/analyzr-integrate` | the second Claude Code plugin (M6 S3b, 0.1.1 since S2a) for interactive, non-pipeline skills: `/analyzr-integrate:integrate-landscape <export> [--workspace <dir>]` turns a customer's BPMN 2.0 export into an import bundle `analyzr-import/1` and a German report in the consultant's workspace (keys pinned in `keymap.json`), never imports (the consultant does); reference notes per tool (unverified), the bundled scripts `inspect.mjs` and `normalize-bpmn.mjs` (generated) and their notices; a sha256 per plugin release in `tools/integrate/test/plugin.test.ts`; never loaded in live runs |
| `tools/integrate` | `@analyzr/integrate` (M6 S3b, decision 24.8): the sources and tests of the integrate plugin's scripts (`inspect`, `normalize-bpmn` with `file`, `plan`, `bundle`, `inventory`), bundled by `pnpm --filter @analyzr/integrate generate` with a drift test; a synthetic Signavio-style export and its golden bundle, which the CLI and web tests import; imported by nothing in `apps/` or `packages/` |
| `examples/agents` | reference setups: Claude Code (interactive and `run-headless.sh [--skill placements]`), Claude Desktop (configs + German start prompts for relations, placements and drafting a chain), Codex; documentation, not in the image |
| `apps/server` | Hono server: domain (pure, dependency-cruiser enforced), Drizzle/PostgreSQL, REST `/api/v1`, MCP `/mcp` (stateless Streamable HTTP), local mode, agent tokens, pipeline, review; since M4 S1/S2 the value chain and placements (`src/domain/value-chain/`: storage, lifecycle, `prepareRevision`, rule proposals, findings; REST under `/value-chains`, six MCP tools; the web page since S3); since decision 19 the owner's auto-accept rules (`src/domain/auto-accept/`, seven owner-only routes and the ledger for every reviewer, no MCP); since M6 S4 the open questions (`src/domain/open-questions/`: one read model over findings, chain findings, holds, agents' questions, unsure verdicts, coded no-links, summaries and unjudged pairs plus the gap signals, computed on read; `GET …/open-questions` and `…/open-questions/export?format=markdown\|csv`, permission `read`; no MCP until S7); since M6 S5a the answers (the append-only `open_question_answer`, migrations 0011/0012; `POST …/open-questions/{q}/answers` and `…/open-questions/answers?dryRun=`, permission `review`, humans only; on a relation or placement a human note through the note use cases); since M6 S5c-1 the actions (`open-questions/actions.ts`, pure: each item's actions, R1 and R1b, what a link writes or accepts; `POST …/open-questions/{q}/actions` for link, place, choose copy and the outside mark, `…/answers/{a}/withdrawal`, permission `review`, humans only; the append-only `open_question_answer_withdrawal`, migrations 0013/0014; items versioned by what they ask about; the safeguard `competing-call` also counts a human's manual link from the call element to another target); since M6 S5c-2 the model amendments (`src/domain/amendments/`, pure: planning against the uploaded revision, the fields a human may set, derivation, effect and cost, the change list; the append-only `model_amendment` and `model_amendment_withdrawal`, migrations 0015/0016; uploaded plus amended revisions with the plan on the head; the routes of tag `amendments`, `review` and `write`, humans only; the open question `amendment-conflict`); since M6 S2a provenance and stable identity (`src/domain/provenance.ts`, pure: the manifest checked, the uploaded revision's declared `source`, the import warnings, the `external-ids` list; readers follow an amended head's `source.upstream`, or the newest revision a manifest declared; `model_revision.extract_warnings`, migration 0017; the open question `extractor-loss`); since UX2a (decision 26) the open questions' groups (`group` on every item from a `Record` over the kinds: `ask` „Zu klären“, `agent`, `proposal`, `info`; the repeatable `group` filter; `totals` and `askByModel` on every page), the question first with its reason apart (`text`, `detail`), the customer export in plain German (dated, „Betrifft“, no folder, the id only in HTML comments, the CSV column `Ansprechpartner`, `ask` by default under the old file name); since the first wave's review an agent's coded no-link joins the rule tier's item about the same gap (read model only) and a primary link reads „Verknüpfen mit …“ |
| `apps/cli` | `analyzr health / status / import (reads analyzr-import.json since M6 S2a) / seed [--project --issue-tokens --token-name --value-chains] / models list\|requeue\|delete\|external-ids [--system] / questions [list] [--model --kind --source --ask-who --state --group (since UX2a) --format text\|md\|csv\|json -o] / questions answer <id> --text \| --from <csv> [--dry-run] (notes; `--kind` refused since M6 S5c-1) / questions outside <id> [--note] [--undo <answer>] / questions link <id> --to <target>… \| --pair <from> <to> [--note] / questions place <id> --step <id>\|@outside \| --process <target> [--note] / questions amend <id> / models amend <key> --element <id> … \| pull <key> [--original] / amendments list\|export\|withdraw [--rev] / token create\|list\|revoke / value-chain push\|pull / rules list\|show\|add\|edit\|enable\|disable\|preview\|apply\|revoke / mcp` (stdio bridge) |
| `apps/web` | projects, models, relations, findings, bpmn-js model view, upload, connect-an-agent, inbox, review screen; since M4 S3 the value chain page (`/projects/{key}/value-chain`: renderer viewer/modeler in a lazy chunk, placement review, save with dry run and conflict, drafts, link editing) and the step view; since decision 19 the tab „Regeln“ (auto-accept rules with live preview, apply, revoke) and the marks and filters of auto-accepted items in the review views; since M6 S4 the tab „Offene Fragen“ (every gap as a question, filters, Markdown and CSV export) and the model view's section of the same name, since M6 S5a with „Antworten aus CSV übernehmen“ (a preview first) for reviewers, since M6 S5c-1 with an action on every question (pickers, inline decisions, the outside mark, „Rückgängig“) and „Notiz hinzufügen“ instead of S5a's „Beantworten“, and „Verknüpfen mit …“ on a collapsed subprocess in the model view; since M6 S5c-2 the amend form at a question with „Sammeln“ and its bar, the conflicts with both values side by side, „Ergänzen“ in the model view with history, overlay, badge and both BPMN downloads, every withdrawal after its cost, and the change list in the models tab; since M6 S2a the open-question kind „Elemente beim Import verloren“ (S2a's „Herkunft“, badges and the manifest of a dropped folder come with the UI simplification); since UX1 (decision 26) the shell of four object tabs („Übersicht“, „Relationen“, „Wertschöpfungskette“, „Offene Fragen“, badges from one hook), „Hochladen“ as a button, the owners' menu „Einstellungen“ („Agent verbinden“, „Annahmeregeln“, the former tab „Regeln“), the list „Befunde“ behind a link in „Offene Fragen“, „Übersicht“ with „Als Nächstes“, the popover „Agent starten“, the export hub, search, phase chips and „Offene Punkte“, failed writes in German, the server banner only on trouble; since UX2b „Offene Fragen“ as lean cards „Zu klären“ (the badge's number) with one intro line, three filters, „Zur Information“ and „Erledigte zeigen“ closed, the agents' questions on their proposals, the dialog „Für den Kunden exportieren …“ and a hold answered in one dialog from its card, its „Vorgemerkt“ row and the review screen and decided with „Jetzt entscheiden“ (the inline decision panels gone), the model view's „Fragen“ with „Zu klären“ only; since the first wave's review „Offene Punkte“ as text with its split in a tooltip, the customer export of the open items only, the agent's summary closed in the model view; the UI load guard `e2e/ui-load.spec.ts` |
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
until the owner creates one.

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
25.1–25.4; two points for the owner in §8 below): byte-preserving, deterministic `applyAmendments` and `readAmendable` in
`@analyzr/bpmn-facts` (refused unless the extracted facts read exactly the intended change;
files declared in another encoding than UTF-8 written as ASCII), `model_amendment` with
migrations 0015/0016, uploaded plus amended revisions with the plan on the head, re-application at
every import with the question „Ergänzung nicht mehr anwendbar“ (both values side by side;
„Meine Ergänzung behalten“ only over a value that does not resolve), withdrawals with their cost
and an optional `If-Match`, the cost of each save shown in its dry run, the change list (what to
carry over first, each element with its id) and both BPMN downloads, the form at the question
with „Sammeln“ and „Ergänzen“ in the model view, `analyzr models amend|pull`, `analyzr questions
amend` and `analyzr amendments list|export|withdraw`; live-run neutral. **S2a "Provenance,
manifest, stable identity"** (**done 2026-10-17** on the branch, every gate green; M6 §8 "S2a as
delivered"): the manifest `analyzr-import.json` read by `analyzr import` and sent per batch (an
invalid one stops the import before anything is sent), pinned keys, the declared provenance on
the uploaded revision (an amended head follows `source.upstream`), PUT with `Analyzr-Manifest`,
the import warnings `manifest-sha-mismatch`, `external-id-moved` and `external-id-changed`,
`GET …/external-ids` with `analyzr models external-ids` (the key map the golden bundle was
written with comes back from it), the stored extractor warnings (migration 0017) and the open
question `extractor-loss`; live-run neutral. The review round added the warning
`provenance-kept` (an unchanged file whose manifest declares another tool folder or link: identical
bytes keep their first provenance), the readers' fallback to the newest declared revision (an
upload without a manifest never erases an identity), tidied informational fields (an export's
empty `exporterVersion` imports; a NUL or a lone surrogate is refused with 422 instead of a 500
for the whole request; no credentials in links), open loss codes, the manifest checked before
`--create`, the refusal of a folder whose bundles lie in subfolders, `next:` lines after the
identity warnings, the tool ids several keys carry in `models external-ids`, finer
`extractor-loss` texts (no diagram or vendor elements, „Prozess … (samt Inhalt)“, „mindestens“),
and the integrate plugin 0.1.1 (skill text only). Known interim gap until M6 §10.10 is decided: a
bundle imported first through „Hochladen“ records no identity, and the same bytes imported again
cannot add it; a folder move in the tool keeps the old folder in `external-ids`. Its web parts
wait for the UI simplification the owner asked for (2026-10-17: „die UI etwas zu vereinfachen …
Wirkt alles inzwischen etwas überladen“); the skill's key-map rebuild and the pre-approved `--dry-run` come with the plugin's
next version, after S2b. **The UI simplification's first wave is done** (the owner asked for it
after S2a, 2026-10-17: „Denke aus User Need Sicht. Wirkt alles inzwischen etwas überladen“;
`docs/UX-SIMPLIFICATION.md`, decided as owner decision 26): UX2a (the open questions' groups and
totals in server, contracts and CLI), UX1 (the shell and „Übersicht“ in the web), UX2b („Offene
Fragen“ in the web) and the first wave's review round, done 2026-10-18 on the branch with every
gate green, the UI load guard and the whole Playwright suite against a scratch stack, the demo
walk against a scratch demo image and the screenshots retaken (UX-SIMPLIFICATION.md §7 "… as
delivered", "First wave review round"; DEVELOPMENT.md "UI simplification first wave
(2026-10-18)"). The owner walked five tasks on `analyzr-local` the same day („finde, das geht in
eine gute Richtung“; UX-SIMPLIFICATION.md §7 "Owner walkthrough"); its one finding, entering the
model from a question card, is fixed with a labelled button on the card. **Next**, in the
proposed order (Q10), which the owner kept („Sonst kannst du weitermachen“): UX7 („Hochladen“, „Agent verbinden“; done 2026-10-18, UX-SIMPLIFICATION.md §7 "UX7 as delivered") → UX8 (done 2026-10-18, "UX8 as delivered"; S2a's web
parts: „Herkunft“, the badges, the manifest of a dropped folder) → S2b (`importImpact`, the dry
runs, the deletion impact, absent keys within `source.scope`) → UX3 (model view) → UX4 (question
actions) → UX5 („Relationen“ and the review screen) → UX6 (value chain) → UX9 (result views,
„Annahmeregeln“, the projects summary), alongside S2c (the trust rule of decision 24.2) and S3c
(renderer and spec YAML, the ad-hoc converter path, the bundled CLI); then S6 (interviews); after
the owner's live runs S5b, S7 and facts v2 as recommended (M6 §3.11 and §6: the reindex with
judgement carry-over first). The owner's review of S1–S2a, ideally on a sandbox or anonymized export
(M6 §10.4), can run alongside. Nothing of M6 changes released procedures, claim inputs or the
MCP surface before the owner's live runs.

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
| Shared-name flag | The bulk dialog flags 20–22 of 33 key-tier pairs (names used by >2 processes), incl. legitimate broadcasts. Keep, or flag only names with several senders? | M2 web stage |
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
| Auto-accept: take-over | A rule whose author lost the owner role matches nothing until an owner saves it; saving it, also unchanged, makes that owner its author (its later acceptances are recorded under them). Keep, or add an explicit „Übernehmen“ action? | Decision 19 review |
| M6: address form | „Sie“ in interview guides for customers, „du“ elsewhere? | M6 §10.3 |
| M6: sample exports | Sandbox instances or anonymized exports of ARIS, Signavio, ADONIS, Bizagi, Visio? | M6 §10.4 |
| M6: answers re-queue | May S5b widen the relations judgement basis by human notes and queue tasks (after the live runs), and from S7 on also by subject notes and outside marks? | M6 §10.5 |
| M6: erasure | One database per customer engagement for now, a purge use case with server mode? | M6 §10.6 |
| M6: provenance of unchanged bytes | Identical bytes keep their first provenance, so a folder moved in the tool (same Signavio bytes) keeps the old folder in `external-ids` and the change list, and a bundle first imported through the web never gets its identity recorded. S2a only warns (`provenance-kept`). Record each import's declared identity per model in an append-only row that the readers use, with S2b? Recommendation: yes. | M6 §10.10 |
| M6: Modeler saves of the amendment fixtures | S5c-2's golden fixtures are hand-written in the Camunda Modeler's layout, and the expected files are `applyAmendments`' own output (regression snapshots plus a check of the BPMN XSD's child order, M6 §8 "S5c-2 as delivered"). Could you open `packages/bpmn-facts/test/fixtures/amend/c7-modeler.bpmn` and `c8-modeler.bpmn` once in Camunda Modeler 5.x, make the changes of `test/amend.test.ts`'s two snapshot tests (call targets, names, documentation, the message reference) and save them, so the child order is compared with what the Modeler writes? | M6 §4.8 c, S5c-2 |
| M6: `If-Match` on withdrawals | S5c-2 makes `If-Match` optional on both withdrawal routes (the web always sends the head its dry run showed; `analyzr amendments withdraw --rev <n>`), so a script withdrawing by id keeps working; amendment writes require it. Keep it optional, or require it as on saves (428 without)? | M6 §4.8 c "Concurrency", S5c-2 as delivered |
| M6: `competing-call` and manual links | S5c-1 counts a human's accepted or held `manual` relation from a call element as a competing call only when it goes to another target: an agent's `call` proposal to the same target agrees with the human and is no second target, so an owner's rule may still accept it; the „Regeln“ preview counts a human's later manual link to another target as a correction of the call. Keep this reading of decision 19's „a call has one target“, or count every manual relation from the call element (then a rule never accepts the agreeing call either)? | M6 §8 "S5c-1 as delivered", decision 19 |

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
  what `normalize-bpmn` writes per converter version. After a change of `tools/integrate/src`, run
  `pnpm --filter @analyzr/integrate generate` (the drift test fails until the bundled scripts
  match). A version counts as released once it is committed; until then its row may change.
- **Large MCP results:** Claude Code saves tool results above 50,000 characters to a file unless
  the tool declares `anthropic/maxResultSizeChars` (analyzr's tools do); with `--tools ""` an agent
  could not read that file. Keep the declaration on new tools.
- **Verify before claiming:** every milestone so far ran all gates (format, typecheck, lint, tests
  against real PostgreSQL, eval gates, docker build) plus adversarial reviews; keep that standard.
- **Commits** end with the attribution line the owner asks for; nothing lands on `main` without
  the owner's explicit OK (decision 12).
- **`Miragon/value-chain-modeler`** is a separate product (VS Code extension, web app). Consume it
  from npm; changes to it go through its own repo.

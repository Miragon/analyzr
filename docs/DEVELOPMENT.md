# analyzr – Development

How to run, use, build and test analyzr. Spec: [CONCEPT.md](CONCEPT.md); milestones:
[M1-SKELETON.md](M1-SKELETON.md), [M2-PIPELINE-REVIEW.md](M2-PIPELINE-REVIEW.md) (items 1–9 are
in: the backend of items 1–6, the review web UI of item 7, the simulation agent with
`eval:replay` of item 8 and this document; all of it was run together against the Docker stack,
see [M2 end to end](#m2-end-to-end-2026-10-08), and again after the
[M2 review fixes](#m2-review-fixes-2026-10-08)), and current
[M3-RELATIONS-PROCEDURE.md](M3-RELATIONS-PROCEDURE.md) (code complete, live runs pending: the
released procedure `analyzr-relations@0.2.0`, which judges each pair once
([below](#judge-each-pair-once)), the Claude Code plugin, the agent reference setups in
`examples/agents`, `eval:live` and the live gate; the owner's guide to live runs is
[M3-LIVE-RUNS.md](M3-LIVE-RUNS.md)). Of [M4-VALUE-CHAIN.md](M4-VALUE-CHAIN.md), slices S0
to S4 are in, which completes M4a: the `@miragon/value-chain-*` 0.3.0 packages are dependencies and the golden
value chains are validated with the npm schema-model ([M4 S0](#m4-s0-2026-10-08)); the value
chain tables, the placement lifecycle and `recomputeStatus` generalised over the subject
([M4 S1](#m4-s1-2026-10-09)); the value chain and placements over REST, MCP and
`analyzr value-chain push|pull`, the rule tier's key proposals, placements that follow model
changes, findings and `baseline-prefix/1` ([below](#value-chain-and-placements-m4),
[M4 S2](#m4-s2-2026-10-09)); and the value chain page in the web UI: viewer and modeler,
placement review, save with dry run, conflict and drafts, link editing, drill-down
([below](#value-chain-in-the-web-ui-m4), [M4 S3](#m4-s3-2026-10-09)); and the LLM-free placement
eval `eval:placements`, `analyzr seed --value-chains` and German texts for the rule tier
([below](#value-chain-and-placements-m4), [M4 S4](#m4-s4-2026-10-09)). Of
[M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md), S1 (import hygiene in the CLI and the
web upload), S3a (`eval:descriptive` and the `get_landscape` size), S3b (the second plugin
`analyzr-integrate` with `tools/integrate`,
[below](#the-integrate-plugin-and-toolsintegrate-m6-s3b)) and S4 (the open questions over REST,
in the web and in `analyzr questions`, [below](#open-questions-m6-s4), [M6 S4](#m6-s4-2026-10-16))
and S5a (answers to them in the web, over REST and with `analyzr questions answer`,
[M6 S5a](#m6-s5a-2026-10-17)), S5c-1 (answering them by action: links, placements, decisions,
the outside mark, notes without kinds, [M6 S5c-1](#m6-s5c-1-2026-10-17)), S5c-2 (model
amendments, [M6 S5c-2](#m6-s5c-2-2026-10-17)), S2a and S2b (provenance, the import manifest and
the dry runs, [below](#provenance-and-the-import-manifest-m6-s2a)), S2c-1 (the trust class and
the rule tier, [below](#the-trust-rule-m6-s2c-1)), S2c-2 (the fast path for derived calls,
[M6 S2c-2](#m6-s2c-2-2026-10-20)), S2c-3 (owners' rules for derived calls,
[M6 S2c-3](#m6-s2c-3-2026-10-20)), S2c-4 („Vor der Vertrauensregel angenommen“,
[M6 S2c-4](#m6-s2c-4-2026-10-20)) and steps 1 to 5 of S2b's follow-up (the agent work in the dry
runs, relations side, placements, the surfaces that show it, the size of the agents' next run,
the integrate plugin 0.1.3 with its read-only preview and the key-map rebuild, and the identity
rows of owner decision 29 (1),
[M6 S2b follow-up step 1](#m6-s2b-follow-up-step-1-2026-10-20),
[step 2](#m6-s2b-follow-up-step-2-2026-10-20), [step 3](#m6-s2b-follow-up-step-3-2026-10-20),
[step 3b](#m6-s2b-follow-up-step-3b-2026-10-20),
[step 4](#m6-s2b-follow-up-step-4-2026-10-20) and
[step 5](#m6-s2b-follow-up-step-5-2026-10-20)) and steps 1 to 3 of S3c (`analyzr-spec/1` and its
deterministic renderer, the converter runner `analyzr-convert` and the CLI core both `analyzr` CLIs
share, with the parse guard, run from source until the integrate plugin 0.1.4,
[M6 S3c step 1](#m6-s3c-step-1-2026-10-21), [step 2](#m6-s3c-step-2-2026-10-21) and
[step 3](#m6-s3c-step-3-2026-10-21)) are in. The public read-only demo of
owner decision 20 runs at https://analyzr-demo.fly.dev after the first deploy
([Demo deployment (Fly.io)](#demo-deployment-flyio)).

The [Quickstart](#quickstart-docker) and [Troubleshooting](#troubleshooting) were run end to end on
2026-10-07 (macOS, Docker Desktop with Compose v5.5, Node 24.15, pnpm 11.1.3, Claude Code
2.1.292), the M2 part of the Quickstart ([Let the simulation agent work the
pipeline](#let-the-simulation-agent-work-the-pipeline)) on 2026-10-08. The M3 setups were checked
without a model on 2026-10-08 ([M3](#m3-2026-10-08)), and the procedure in three LLM dev runs on
the dev landscape (Claude Sonnet 5.5 subagents, not the owner's clients). [Verified
end to end](#verified-end-to-end) lists exactly what was run and what was not.

## Status

| Part | State |
|---|---|
| Workspace, TypeScript, ESLint, Prettier, dependency-cruiser, CI (`ci.yml`) | working |
| `packages/contracts`: schemas, types, REST route configs, OpenAPI 3.1 | working |
| `packages/client`: hey-api client generated from the contracts | working |
| `packages/bpmn-facts`: `extractFacts` (C7 and C8, CONCEPT §2), `assertSafeXml` (DOCTYPE/ENTITY, UTF-8, 5 MB), 50k-element limit, `factFingerprint`, `factsHash`, `normalizeKey`; since M6 S5c-2 `applyAmendments` and `readAmendable` (byte-preserving splices of model amendments, checked by extracting again, [Conventions](#conventions)) | working; tested per construct, against hostile XML and on every eval/corpus model (the amendments on every Modeler-written dev corpus model, holdout excluded) |
| `packages/relations`: `runRules` (rule tier + findings, German details since M4 S4), `generateCandidates` (key, lexical, compatible; both directions; since M6 S2b's follow-up step 1 an optional prepared `indexCandidates` for many focus models over one landscape, the same candidates; since step 3b `projectCandidates`, the whole-project candidates and from the same pass each focus model's own of a basis other than `compatible`, for the summary's pairs to judge), `labelBaseline` (`baseline-label/1`, plain label matching), endpoint semantics, DE/EN text similarity; for M4 `derivePlacementRules` (the rule tier's key placements), `baselinePrefix` (`baseline-prefix/1`), `sharesNameStem`, `quoteDe` | working; unit-tested, gated by `eval:candidates` and `eval:placements` |
| `apps/server`: full CONCEPT §2 schema, domain use cases with `policy.require`, ingest/import/delete as one transaction (facts, rule tier, assertions, endpoint state, analysis tasks, events) with the real `@analyzr/bpmn-facts` and `@analyzr/relations`, every REST route of the contracts, local mode (Host/Origin guard, owner session cookie, owner key for the CLI, agent tokens), MCP `/mcp` with the eight read tools, the built web UI at `/` | working; importing `nordwind-handel` and `stadtwerke-auental` reproduces the rule relations and findings of `eval:candidates` exactly (integration test); MCP contract test with the SDK client |
| `packages/procedures`: the procedures `analyzr-relations@0.2.0` (`relations.md`, status `released`, M3; judge each pair once) and `analyzr-placements@0.1.0` (`placements.md`, `released`, `kind: placement`, M4 S5), the loader for MCP `get_procedure`, the wrappers for the MCP prompts `work_pipeline` and `place_processes` and the Claude Code skills (`renderPipelineWrapper`, `renderAdHocWrapper`, `renderSkill`, `pnpm --filter @analyzr/procedures generate`), the `draft_value_chain` prompt text (`prompts/`) ([below](#the-relations-procedure-m3), [placements](#the-placement-pipeline-and-analyzr-placements-m4-s5)) | working; unit tests (frontmatter, wrappers, the guard against skill expansion), the drift test of the generated skill and plugin version, a sha256 guard that keeps a released version's skill from changing, and a server test that keeps the procedure's limits, invalid reasons (relations and no-links), tool names and tool arguments in line with the contracts and the MCP tools; three LLM dev runs of `0.1.0` on `nordwind-handel` (Sonnet 5.5: precision 100 %, recall 78.6 %, 0 must_not_link; [M3](#m3-2026-10-08)) |
| `plugins/analyzr`: Claude Code plugin `analyzr` (0.3.0, its own version since S5) with the generated skills `/analyzr:relations [project] [max-tasks]` and `/analyzr:placements [project] [max-tasks]` and no MCP server; `.claude-plugin/marketplace.json`: the repository as marketplace `analyzr` (`claude plugin install analyzr@analyzr`) | working; `claude plugin validate --strict` passes for both manifests (Claude Code 2.1.295 for 0.3.0); drift tests and the per-release sha256 table in `@analyzr/procedures`; not yet run with a model |
| `plugins/analyzr-integrate` and `tools/integrate` (M6 S3b, [below](#the-integrate-plugin-and-toolsintegrate-m6-s3b)): the second Claude Code plugin (0.1.3; 0.1.1 and 0.1.2 changed only texts: the skill in M6 S2a, the skill and the Signavio note in S2c-2; 0.1.3 in S2b's follow-up step 4: the read-only `analyzr-read.mjs`, pre-approved next to `inspect.mjs`, with which the skill previews an import itself, `plan --from-analyzr` rebuilding a lost key map, the report's „Vorschau“ with the agent work, `exporterVersion` declared tidied) with `/analyzr-integrate:integrate-landscape` for BPMN 2.0 exports, the reference notes per tool and the bundled scripts `inspect.mjs`, `normalize-bpmn.mjs` and `analyzr-read.mjs`; their sources and tests in `@analyzr/integrate`; since M6 S3c step 1 also the sources of `analyzr-spec` (`analyzr-spec/1`, its validator and the deterministic renderer, [M6 S3c step 1](#m6-s3c-step-1-2026-10-21)) and since step 2 of the converter runner `analyzr-convert` (an agent's converter, approved by its sha256, run twice in a sandboxed child Node into specs and a run record, [M6 S3c step 2](#m6-s3c-step-2-2026-10-21)), run from source until 0.1.4 bundles them | working; 390 tests (normalized outputs extracted with `@analyzr/bpmn-facts`, keys and the rebuild from analyzr, bundle, inventory, the scripts as the plugin runs them, `analyzr-read` against a fake analyzr with its refusals, the drift test, the release table; since M6 S3c step 1 the spec validator, the renderer on 9 golden specs and 200 seeded random ones with their facts extracted, bpmn-js's tree walker with the importer's refusals and the layout checks; since step 2 the converter runner's escapes, limits, zip guards and run record on synthetic Visio and AML exports with example converters), the Playwright harness `e2e/spec-render-import.spec.ts` (renders in bpmn-js, no server, not in CI), the CLI and web tests on the golden bundle, the CLI e2e running the bundled `analyzr-read.mjs` against a real server ([M6 S2b follow-up step 4](#m6-s2b-follow-up-step-4-2026-10-20)), `claude plugin validate --strict` (Claude Code 2.1.300; for 0.1.2 and 0.1.3 Claude Code 2.1.303, [M6 S2c-2](#m6-s2c-2-2026-10-20)); followed by hand by the implementing agent and imported into a scratch stack with the checkout CLI and „Hochladen“; not yet invoked as a skill in a Claude Code or Codex session, its guard setup and the pre-approval of `analyzr-read.mjs` not tried live ([HANDOFF.md](HANDOFF.md) §8) |
| `examples/agents` (M3, placements since M4 S5): reference setups for Claude Code (interactive, headless `run-headless.sh [--skill placements]`), Claude Desktop (both bridge entries, German start prompts for relations, placements and drafting a chain) and Codex; documentation, not workspace packages, not in the image; no Agent SDK setup for now (owner decision 16, [HANDOFF.md](HANDOFF.md) §4) | checked without a model ([M3](#m3-2026-10-08)): shellcheck and dry runs of `run-headless.sh` against fakes (incl. failed batches, a reused log directory and a trailing slash in `ANALYZR_URL`), the Codex TOML parses; no setup has run a model yet |
| M2 backend: analysis pipeline (claim/submit/release, lease, long-poll), claim input (with the M3 additions: message-flow ends, partner and process documentation, findings, and `judged`/`skip`), submissions, ad-hoc proposals, review (accept/reject/hold/correct, bulk, notes, timeline), model engine, relation provenance, answered findings hidden ([below](#analysis-pipeline-and-review-m2)); judge each pair once (`analyzr-relations@0.2.0`: the basis of agent judgements, the assignment at the claim, stored no-links, `Relation.noLinks`, `uncovered`; [below](#judge-each-pair-once)) | working over REST and MCP; real-Postgres integration tests incl. concurrent claims, lease expiry, cancellation, decision memory across re-uploads, the claim-input size and additions on both corpus landscapes, judge each pair once (`judge-once.test.ts`); MCP contract test with the SDK client; reviewed in the web UI ([Review in the web UI](#review-in-the-web-ui-m2)); end to end against the Docker stack with the simulation agent (HTTP and the bridge in the container; before 0.2.0) and in the browser (`e2e/pipeline.spec.ts`: review, re-upload, `suppressed` vs. `reopened`) |
| `apps/cli`: `analyzr seed` (M3: `--project`, `--token-name`; M4 S4: `--value-chains`), `import` (M6 S1: the shared file rule, keys derived before sending, skipped plain XML, extractor warnings, the waiting tasks and the next agent step), `models list/requeue/delete` (M6 S1; since S5c-2 `models amend|pull`), `questions` (M6 S4; since S5a `questions [list]` and `questions answer`; since S5c-1 `questions outside|link|place` and notes without kinds; since S5c-2 `questions amend`; since UX2a `questions --group` and the groups in its summary line), `amendments list|export|withdraw` (M6 S5c-2), the amendments in `import`'s output (M6 S5c-2), `import` reading the manifest `analyzr-import.json` (pinned keys, provenance, import warnings with `next:` lines) and `models external-ids` (M6 S2a), `import`'s `next:` line with the web link for the unique calls of derived models and its agent-token notice (M6 S2c-2), `rules add --derived` and, with the owner key, `import`'s dry-run line and `next:` step for owners' rules for derived calls (M6 S2c-3), `rules pre-trust` and the system line's count of acceptances from before the trust rule (M6 S2c-4), `token create/list/revoke`, `status`, `health`, and `analyzr mcp` (stdio bridge for Claude Desktop); since M6 S3c step 3 the commands both CLIs share in `src/core-program.ts` (every one but `seed` and `mcp`), the parse guard in both (a word that reads as a flag is no option value, exit 2) and `src/plugin-main.ts`, the entry of the integrate plugin's bundled CLI `analyzr.mjs` (from source until 0.1.4: next steps naming `node <path>`, the owner key for this machine only; [M6 S3c step 3](#m6-s3c-step-3-2026-10-21)) | working; unit tests, an e2e test against a real server, and a live check against the running Docker stack; since M6 S3c step 3 parity tests of the plugin's entry against the checkout's, from source |
| `apps/agent-sim`: `analyzr-agent-sim`, the LLM-free simulation agent (M2 item 8): works the pipeline over MCP (HTTP or the `analyzr mcp` bridge) with the deterministic policy `sim-policy-1`, since M4 S5 both task kinds (`--kinds`, the placement policy `decidePlacements`), and records claim inputs and submissions in `eval/recordings` ([below](#simulation-agent-and-evalreplay-m2)) | working; unit tests (both policies, recorder lines of both kinds, CLI, the loop against an in-memory MCP server) and an end-to-end server test on both corpus landscapes with their golden chains (every task done, provenance, nothing decided, the committed recordings reproduced byte for byte, the holdout placement recording by digest) |
| `apps/web`: projects (create), per project four object tabs since UX1 (owner decision 26): Übersicht („Als Nächstes“, the export hub, the models table with „Modell suchen …“, the phase chips and „Offene Punkte“), Relationen (M2: review queue, bulk accept per tier, held list, no-links; the results one link away with filters, rule vs. key tier, provenance), Wertschöpfungskette (M4 S3, [below](#value-chain-in-the-web-ui-m4)), Offene Fragen (the list „Befunde“ behind a link at its foot) (M6 S4: every gap as a question, filters, Markdown and CSV export; since S5a „Antworten aus CSV übernehmen“ for reviewers; since S5c-1 each item's actions with „Rückgängig“ and „Notiz hinzufügen“ instead of „Beantworten“; since S5c-2 the amend form and the conflicts of model amendments (since UX4 the link and the amendment of one gap in one entry, the dry run inline, no „Sammeln“); since UX2b „Zu klären“ as lean cards with three filters, „Zur Information“ and „Erledigte zeigen“ closed, the export dialog for the customer, a hold answered in one dialog and decided with „Jetzt entscheiden“), the button Hochladen (files or a folder via the import endpoint) and the owners' menu „Einstellungen“ with Agent verbinden (token, Claude Code/Desktop/generic configurations, revoke) and Annahmeregeln; model view with bpmn-js that highlights relation endpoints and switches to the other model (and, since M6 S4, lists the model's open questions, since S5c-1 with their actions, since UX2b as „Fragen“ with „Zu klären“ as cards, one link to the agents' questions on its proposals and the agent's summary closed under „Zur Information“ (decision 24.8), and offers „Verknüpfen mit …“ on a selected collapsed subprocess; since S5c-2 „Ergänzen“ at a selected element, the badge, the overlay and both BPMN downloads); review screen per relation (both models in bpmn-js, rationale, evidence, question, provenance, timeline; accept/reject/hold/correct with A/R/H/C, J/K through the queue); bulk accept that leaves generic or widely shared names, open agent questions and ambiguous call targets unchecked (since M6 S2c-2 with the unique calls of derived models as its first group, opened with them selected by „Gesammelt annehmen“, `?bulk=calls`; since S2c-3 its toast offers owners a rule for their source); Miragon design system | working; component tests (Testing Library), Playwright smoke, review and pipeline flows and the UI load guard (`e2e/ui-load.spec.ts`, UX1, UX2b) against a running server, the screenshots below |
| Open questions (M6 S4, [M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §4 and §8 "S4 as delivered"): the read model `apps/server/src/domain/open-questions/` (every source of §4.1, the gap signals of §4.3 without `extractor-loss`, ids, `askWho`, `unlocks`, filters, cursor pages, the Markdown and CSV export), `GET …/open-questions` and `…/open-questions/export` (permission `read`), the tab „Offene Fragen“ and the model view's section, `analyzr questions` | working over REST, the CLI and the web UI (no MCP until M6 S7); unit tests (every source on a synthetic landscape, the signals on `nordwind-handel` and eval:descriptive's variants, the export and its CSV round trip, the review fixes), a real-PostgreSQL test (`open-questions.test.ts`: every source after the simulation agent, holds and a probe agent; ids, filters, pages, both exports), CLI unit and e2e tests, web component tests, the bundle guard and Playwright (`e2e/open-questions.spec.ts`) against a scratch server; live-run neutral (MCP snapshots, claim inputs, procedures and recordings unchanged) |
| Answers to open questions (M6 S5a, [M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §4.5 and §8 "S5a as delivered"): the append-only table `open_question_answer` (migrations 0011/0012), `open-questions/answers.ts` and the answer use cases (permission `review`, humans only; note answers through the note use cases), `POST …/open-questions/{q}/answers` and `POST …/open-questions/answers?dryRun=`, „Beantworten“ in the tab and the model view (since S5c-1 „Notiz hinzufügen“ and the actions, below), „Antworten aus CSV übernehmen“, `analyzr questions answer`, the zod-free `@analyzr/contracts/open-question-csv` and `…/personal-data` | working over REST, the CLI and the web UI (no MCP until M6 S7); unit tests (where the text lands, the sheet check, the latest-answer rule, normalization, the personal-data check, the sheet reader with spreadsheet row numbers), real-PostgreSQL tests (`open-question-answers.test.ts`: note answers, nothing queued, the CSV round trip, humans only, the table's triggers and checks; both placement cases in `placement-pipeline.test.ts`; the migrations on existing data; `claim-golden.test.ts` pins seeded claims by SHA-256), CLI unit and e2e tests, web component tests, the bundle guard and Playwright (`e2e/open-questions.spec.ts`) against a scratch server ([M6 S5a](#m6-s5a-2026-10-17)); live-run neutral |
| Answering by action (M6 S5c-1, [M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §4.8 a and b and §8 "S5c-1 as delivered"): `actions` on every item (the pure `open-questions/actions.ts`: `actionsFor`, R1 and R1b, what a `link` writes or accepts), items versioned by what they ask about, `POST …/open-questions/{q}/actions` (link, place, choose copy, outside) and `POST …/open-questions/{q}/answers/{a}/withdrawal`, `open_question_answer_withdrawal` (migrations 0013/0014), `competing-call` counting manual relations from a call element, notes without kinds and the five-column CSV, the action row in the tab and the model view's section, „Verknüpfen mit …“ on a collapsed subprocess, `analyzr questions outside\|link\|place` | working over REST, the CLI and the web UI (no MCP until M6 S7); unit tests (`open-question-actions.test.ts`: every kind's actions and its single primary, R1 by direction, R1b, the suggestions and what a link accepts), real-PostgreSQL tests (`open-question-actions.test.ts`, `open-question-answers.test.ts`, `claim-golden.test.ts` after outside marks), CLI unit and e2e tests, web component tests, the bundle guard and Playwright (`e2e/open-questions.spec.ts`) against a scratch server ([M6 S5c-1](#m6-s5c-1-2026-10-17)); live-run neutral |
| Model amendments (M6 S5c-2, [M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §4.8 c and §8 "S5c-2 as delivered"): `applyAmendments` and `readAmendable` in `@analyzr/bpmn-facts` (`src/amend.ts`, byte-preserving splices checked by extracting again; `src/xml-elements.ts`, a positioned element scan), `model_amendment` and `model_amendment_withdrawal` (migrations 0015/0016), uploaded plus amended revisions with the plan on the head, re-application at every import with the concurrency token, the open question `amendment-conflict`, withdrawals (one or all of a model, with a dry run and an optional `If-Match`), the change list (`GET …/amendments/export`) and both BPMN downloads, the routes of tag `amendments`, the form at a question (since UX4 one entry with the link, the dry run inline, no „Sammeln“) and the model view's „Ergänzen“, `analyzr models amend\|pull`, `analyzr questions amend`, `analyzr amendments list\|export\|withdraw` | working over REST, the CLI and the web UI (no MCP: agents read amended heads like any revision); bpmn-facts unit tests (`amend.test.ts`: every op on C7, C8 and engine-null fixtures, Signavio-style bytes, escaping, other declared encodings, refusals, the check, determinism, regression snapshots and the XSD child order over every corpus model), server unit and real-PostgreSQL tests (`amendments.test.ts` both), CLI unit and e2e tests, web component tests and Playwright (`e2e/amendments.spec.ts`) ([M6 S5c-2](#m6-s5c-2-2026-10-17)); live-run neutral |
| Provenance, manifest and stable identity (M6 S2a, [M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §3.2–§3.4 and §8 "S2a as delivered"): `ImportManifest` (`analyzr-import/1`), `ImportWarning` and `ExternalIdList` in `@analyzr/contracts` (`api/import-manifest.ts`), the typed provenance on `RevisionSource`, the pure `apps/server/src/domain/provenance.ts`, the part `manifest` of `POST …/imports`, the header `Analyzr-Manifest` of `PUT …/models/by-key/{key}`, `GET …/external-ids?system=`, `model_revision.extract_warnings` (migration 0017) and the open question `extractor-loss`, `analyzr import` reading `analyzr-import.json`, `analyzr models external-ids`; since M6 S2b's follow-up step 5 (owner decision 29 (1), [below](#m6-s2b-follow-up-step-5-2026-10-20)) the append-only identity rows `model_identity` (migrations 0021/0022, with a guard and the backfill), written per import and model also for unchanged bytes whose declaration differs (the internal event `model.identity_declared`), read as the newest row by `external-ids`, the identity warnings, the absent keys, the change list and `Model.identity` („Herkunft“), and `ImportFileOutcome.identityUpdated` | working over REST, the CLI and since UX8 the web („Hochladen“ reads a dropped folder's manifest, `Model.source` gives the models table's chip and the project's subtitle, the model view shows „Herkunft“, the derived chip and the import loss; no MCP); server unit tests (`provenance.test.ts`), real-PostgreSQL tests (`provenance.test.ts`: the integrate plugin's golden bundle with its manifest, the key map rebuilt from `external-ids`, pinned keys, the import warnings, PUT, unchanged bytes (since step 5 recording a moved folder, a first identity, another tool id, under an amended head and with an agent token; `provenance-kept` for another derivation), an upload without a manifest keeping the identity, values jsonb cannot hold refused with 422, amended heads also in the change list, stored warnings, `extractor-loss`, migration 0017 on existing revisions, the identity rows' triggers and guard; `migration-model-identity.test.ts`: 0021/0022 on existing models, every reader answering as before; `value-chain-ingest.test.ts`: an identity-only re-import moving nothing else; `corpus.test.ts`: no warning and no `extractor-loss` on the corpus), CLI unit and e2e tests, web unit tests and Playwright `e2e/smoke.spec.ts` (a moved bundle re-imported); live-run neutral |
| The trust rule (M6 S2c-1 to S2c-4, [M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §3.10 and §8 "S2c-1 as delivered" to "S2c-4 as delivered", owner decisions 24.2, 25.2 and 28; [below](#the-trust-rule-m6-s2c-1)): the trust class on every uploaded revision (`source.trust`, the pure `apps/server/src/domain/trust.ts`, `RevisionRepo.headTrustRows`), the rule tier under it in the recompute, the dry runs, the deletion impact and the amendment effect (a unique call from a derived caller proposed, tier `key`, 0.9, with a German rationale; a call target set in analyzr counts as modelled), `Model.trust`, `ImpactFile.trust`, `ImportImpact.callsProposed`, `ImportFileOutcome.trust`, the import warning `trust-kept`, `AutoAcceptSystemRule.proposed`; the web's „Vorschau“ line and list, the „Aufrufe“ line in „Herkunft“, the system rule card, „Verlauf“'s title and the empty texts; the CLI's dry-run, deletion-impact and system-rule lines; since S2c-2 the fast path: `isBulkDerivedCall` in the contracts (a plain function, OpenAPI unchanged), the bulk dialog's group „Eindeutige Aufrufe aus abgeleiteten Modellen (n)“, opened with exactly those calls selected (`?bulk=calls`) by „Gesammelt annehmen“ in „Übersicht“'s and the upload's „Als Nächstes“ and by the system rule card's count „N aus abgeleiteten Modellen vorgeschlagen“, `analyzr import`'s `next:` line with that link and its agent-token notice, the integrate plugin 0.1.2; since S2c-3 owners' auto-accept rules for these proposals by declared source (migration 0018, the fifth write path, `ImportImpact.autoAcceptedCalls`, `analyzr rules add --derived`, the dialog's third „Art“ and the bulk toast's offer; [Auto-accept rules](#auto-accept-rules-owner-decision-19)); since S2c-4 the owner's review of the rule tier's acceptances from before the trust rule, „Vor der Vertrauensregel angenommen“ (decision 28 (3): the append-only `revision_trust_review`, migrations 0019/0020, read by `storedTrust`; the pure list `preTrustAcceptances`; `GET …/pre-trust-calls` and `POST …/pre-trust-calls/review?dryRun=`, owners only; the event `revision.trust_reviewed`; `AutoAcceptSystemRule.preTrust`; the system rule card's line and its dialog; `analyzr rules pre-trust`) | working over REST, the web and the CLI (no MCP; migration 0018 since S2c-3, 0019/0020 since S2c-4); server unit tests (`trust.test.ts`, `recompute-trust.test.ts`, the auto-accept suites), real-PostgreSQL tests (`trust.test.ts`, derived files in `import-dry-run.test.ts`, `derived-call-rules.test.ts`, `migration-rule-tier.test.ts`, `trust-review.test.ts`, `migration-trust-review.test.ts`), contracts, web and CLI unit tests, the UI load guard and Playwright `e2e/trust-calls.spec.ts`, `e2e/derived-call-rules.spec.ts` and `e2e/pre-trust.spec.ts` ([M6 S2c-3](#m6-s2c-3-2026-10-20), [M6 S2c-4](#m6-s2c-4-2026-10-20)); live-run neutral |
| Open questions: groups and totals (UX2a, [UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §2.4, §2.5 and §7, owner decision 26): `OpenQuestion.group` (`ask`, `agent`, `proposal`, `info`) from the `Record` over the kinds `OPEN_QUESTION_GROUP_RULES` (`open-questions/model.ts`), the repeatable `group` filter, `totals` and `askByModel` on the page, the question first (`text`) with its reason apart (`detail`), pools named by where they are, one question per process extended to agents' placement questions and unsure verdicts, „Auf der Kette prüfen“ on the `proposal` items, the export for the customer (a date, „Betrifft“ in names, the contact hint without the folder, the id as an HTML comment, the CSV header `Ansprechpartner` with the old one still read, `group=ask` by default under the old file name), the API's action labels („Verknüpfen mit …“ for a primary link, „Nur verknüpfen …“ only beside a primary amendment since the first wave's review, „Ziel im Modell eintragen …“, „Vorschlag prüfen“), `analyzr questions --group`; since the first wave's review an agent's coded no-link joins the rule tier's item about the same gap (`mergeCodedNoLinks`, read model only) and the export names no folder or handle and attributes an agent's words („Laut Agent: …“, `isVerbatimSource`) | working over REST and the CLI; the web shows `detail` under the question until UX2b reworks the tab; unit tests (`open-questions.test.ts`: a kind without a group fails, the groups, totals and `askByModel`, one question per process, the export without ids on the synthetic landscape and the Signavio bundle; `open-question-actions.test.ts`: the labels and the chain action), real-PostgreSQL tests (`open-questions.test.ts`: the seeded and post-simulation counts per group and `askByModel` pinned, the default export, the id regex), contracts, CLI unit and e2e tests, web component tests; live-run neutral (MCP snapshots, claim inputs, procedures, recordings and reports unchanged) |
| Shell and „Übersicht“ (UX1, [UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §2.2, §2.3, §3.1, §3.2, §3.12, §3.13 items 7 and 8, and §7, owner decision 26; [Web UI](#web-ui)): four object tabs with their open work as the badge (`src/lib/project-counts.ts` `useProjectCounts`, „Offene Fragen“ counts `totals.ask`), „Hochladen“ as a button and the owners' menu „Einstellungen“ (a light disclosure, no floating-ui in the entry), the key under the name instead of „Stand s…“, the server banner only on trouble, failed writes in German per `ProblemCode` and `reason` (`src/lib/problem-texts.ts`, the server's words behind „Technische Details“), „Als Nächstes“ (`src/lib/next-step.ts`), the popover „Agent starten“ (`components/agent-start.tsx`), the export hub (`components/export-hub.tsx`), „Modell suchen …“ (`?q=`) and the phase chips (`?stage=`), the models table „Name | Phase | Offene Punkte | Aktualisiert“ with the holder, reservation and „Nochmal versuchen“, the projects list without „Stand“ (and „Rolle“ only when it says something), „Neues Projekt“ with „Kurzname: … (ändern)“; one `$initial` code-splitting group for the entry | working in the web UI (no route, contract or server change); component tests (`overview.test.tsx`, `problem-texts.test.tsx`, `projects-page.test.tsx`, `app.test.tsx`, `demo-mode.test.tsx`, `review-inbox.test.tsx`), the bundle guard (209.2 KB), the UI load guard and every Playwright spec against a scratch stack ([UX1](#ux1-2026-10-18)); live-run neutral |
| „Offene Fragen“ in the web (UX2b, [UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §2.4, §3.3 and §7, owner decision 26 Q3, Q4 and Q11; [Web UI](#web-ui)): the tab shows the open questions „Zu klären“ as lean cards (the subject a link, the question with „Warum?“ closed, whom to ask, at most three actions, no ids, event numbers or source labels; `src/lib/open-questions.ts` `questionView`, `cardActions`), the count line equal to the badge, one intro line with „So funktioniert es“, three filters („Art“, „Modell oder Ordner“, „Ansprechpartner“; „Filter (n)“ on a phone; `?source=` a chip), „Zur Information“ and „Erledigte zeigen“ closed, the agents' questions only under „Art“ („Vorschlag öffnen“), the export dialog „Für den Kunden exportieren …“ (`group=ask` by default, „Auch Fragen der Agenten (n)“), a hold answered in the note dialog from its card, the „Vorgemerkt“ row and the review screen and decided with „Jetzt entscheiden“ (the inline decision panels gone), the model view's „Fragen“ with „Zu klären“ only; the state label „Außerhalb der Landschaft“ in the contracts | working in the web UI (no route or server change; one zod-free label); component tests (`open-questions.test.tsx`, `open-question-actions.test.tsx`, `open-questions-lib.test.ts`, `held-list.test.tsx`, `review-details.test.tsx`, `overview.test.tsx`), the bundle guard (209.3 KB), the UI load guard's UX2b budgets and hold task and every Playwright spec against a scratch stack ([UX2b](#ux2b-2026-10-18)); live-run neutral |
| `eval:candidates` | working; passes on `nordwind-handel` (dev) and `stadtwerke-auental` (holdout); report in `eval/reports/candidates.md` |
| `eval:replay` | working; scores the relations recordings in `eval/recordings` against `expected.yaml` (precision, recall and F1 per type and tag, must_not_link hits, questions, no-links, pairs judged twice, uncovered pairs) and, since M4 S5, the placement recordings against `expected-placements.yaml` (on the golden chain only; recall@1 next to `baseline-prefix/1`, the holdout as aggregates); report in `eval/reports/replay.md` with both live gates (it reports them, `eval:live` enforces them) |
| `eval:placements` (M4 S4): the golden value chains against the process facts (validator, coverage, every key-tier rule proposal a must or may), the rule tier and `baseline-prefix/1` with and without votes scored; the holdout as numbers only ([below](#value-chain-and-placements-m4)) | working; passes on `nordwind-handel` (dev) and `stadtwerke-auental` (holdout); report in `eval/reports/placements.md` |
| `eval:descriptive` (M6 S3a): five cumulative, deterministic transforms of the corpus models as descriptive tools would export them (engine-stripped, descriptive, pools, tasks, no-docs), each scored like `eval:candidates`, with the estimated claim input size per model; the holdout in aggregate only ([Tests](#tests)) | working; report only (no threshold), report in `eval/reports/descriptive.md`; the claim estimate is pinned to `renderClaimInput` by a server test |
| `eval:live` (M3; placement tasks since M4 S5): records a live run from its project's stored submissions in `eval/recordings`, scores it and checks the live gates ([below](#live-runs-evallive-and-the-live-gate-m3)) | working; unit tests with fixtures, the server test that rebuilds the simulation agent's recordings from the stored submissions byte for byte (input aside), a smoke test against a seeded server; three LLM dev runs recorded into a scratch directory (not committed); no live run of the owner recorded yet |
| `docker/compose.yaml`, `docker/Dockerfile` | working; `up -d --build --wait` starts PostgreSQL and analyzr (migrations at start, owner key in the `analyzr-state` volume); CI builds it, seeds it and runs the live check against it; an M1 stack upgrades in place (migrations 0002/0003 on its data, the engine backfill equal to `@analyzr/bpmn-facts` on all 57 corpus models) |
| Value chain packages (M4 S0, [M4-VALUE-CHAIN.md](M4-VALUE-CHAIN.md) §5, §9): `@miragon/value-chain-schema-model` 0.3.0 in `apps/server`, `apps/web` and `eval/tools`, `@miragon/value-chain-renderer` 0.3.0 in `apps/web`; `eval/value-chains/validate-value-chains.mjs` on the npm schema-model | consumed; the server canonicalizes and validates every saved chain with schema-model (S2), the web's lazy chain chunk renders and edits it with the renderer (S3); the server's Node round trip of both golden chains, the validator in `pnpm test` (both modes), the dependency specifier guard; the bundle guard (`apps/web/test/bundle.test.ts`) and the Playwright import check (`e2e/value-chain-import.spec.ts`) since S3 |
| Value chain storage and placements (M4 S1, [M4-VALUE-CHAIN.md](M4-VALUE-CHAIN.md) §2, §9): tables `value_chain`, `value_chain_revision`, `value_chain_step`, `placement`, `placement_assertion` (migrations 0006/0007), `status.ts` generalised over the subject, `src/domain/value-chain/` (step generations, the revision write path, the placement lifecycle) | working, behind S2's use cases; unit tests (golden relation digest, relation ↔ placement equivalence, generations, tiers) and real-PostgreSQL tests (lifecycle, revisions, deletion and revival, triggers, checks, composite foreign keys) |
| Value chain in the web UI (M4 S3, [below](#value-chain-in-the-web-ui-m4)): the page `/projects/{key}/value-chain` (NavigatedViewer, Modeler in edit mode, lazy chunk), collision-free ids, overlays, side panel with placement review (A/R/H/C, J/K, bulk re-confirm, manual placements), save with dry run, conflict and drafts, link editing, drill-down, the step view; since S5 Import of a `.vc.json` (re-laid out) and the agent's stage and unsure list | working; component tests with a stand-in canvas, the bundle guard, the import harness and the value chain flow in Playwright (Chromium) against a throwaway stack incl. the CSS check, the screenshots `m4-*.png` |
| The `placement` pipeline kind (M4 S5, [below](#the-placement-pipeline-and-analyzr-placements-m4-s5)): task kinds and subjects (migration 0008), judge each process once (input hashes, `placement_input`, one open task per chain, follow-ups at submit), the claim input `analyzr-claim-placement/1`, placement submissions with supersession and unsure verdicts, the chain's stage, the procedure, prompts and skill, the placement live gate | working over REST and MCP; unit and real-PostgreSQL tests (`placement-pipeline.test.ts`: every trigger and stage, supersession, the unsure memory, truncation with one follow-up, saves during a lease), the simulation agent on both landscapes, the procedure drift test, Playwright for the Import; no LLM run yet |
| Value chain and placements over REST, MCP and CLI (M4 S2, [below](#value-chain-and-placements-m4)): `prepareRevision` (canonical bytes, analyzr rules, kinds, ranks, fingerprints, `structure_hash`), 19 routes (`If-Match`/`If-None-Match`, `dryRun`, decisions incl. bulk, unplaced processes, findings), six MCP tools, `analyzr value-chain push\|pull`, the rule tier's key proposals, placements that follow model ingest and deletion, server tiers with `baseline-prefix/1` (`@analyzr/relations`), token revocation | working over REST, MCP and the CLI (and since S3 in the web UI); unit tests (document rules, structure incl. the golden dev chain, impact, items, tiers, rules, findings, `baseline-prefix/1`), real-PostgreSQL tests (REST, placements, rule tier, the dev landscape with its golden chain through model changes, policy matrix, MCP contract), the CLI against a fake API and end to end |
| Auto-accept rules (owner decision 19, [below](#auto-accept-rules-owner-decision-19)): the tables `auto_accept_rule` and `auto_accept_rule_revision` and the assertion marker (migrations 0009/0010), the evaluator with its safeguards in all four agent write paths and, since M6 S2c-3, rules for derived calls (migration 0018) in a fifth write path after the recompute of an import, an amendment write, a deletion or (since M6 S2c-4) an owner's „Zurück in die Prüfung“, apply and revoke with dry runs, the preview and the ledger (`src/domain/auto-accept/`), seven owner-only routes and the ledger for every reviewer (since M6 S2c-4 two more owner-only routes under the same tag, the review of the acceptances from before the trust rule), `analyzr rules …`, the page „Annahmeregeln“ (the tab „Regeln“ until UX1, now in the owners' menu „Einstellungen“) with marks and filters in the review views, the „Auto-accept what-if“ of `eval:replay` | working over REST, the CLI and the web UI (no MCP by design); unit tests (evaluator, status with revocations, preview, rules, the what-if), real-PostgreSQL tests (relations and placements end to end, revocation, migration on existing data, constraints, policy matrix; since M6 S2c-3 `derived-call-rules.test.ts` and `migration-rule-tier.test.ts`), CLI unit and e2e tests, web component tests and Playwright (`e2e/auto-accept.spec.ts`, since M6 S2c-3 `e2e/derived-call-rules.spec.ts`) against a throwaway stack; MCP snapshots and recordings unchanged |
| Read-only demo on Fly.io (owner decision 20, [below](#demo-deployment-flyio)): `ANALYZR_DEMO=readonly` in the server (the read-only guard before authentication, the viewer session, `demo-readonly`, MCP off, credentials refused, the public Host/Origin guard, `Health.demo`), the read-only database role and the visitor (`demo-bootstrap.ts`), the web UI's banner and role gating, `apps/demo` (`analyzr-demo seed\|serve\|check`), `docker/Dockerfile.demo` with the seed baked in, `docker/compose.demo.yaml`, `docker/fly.demo.toml`, `.github/workflows/demo-deploy.yml` and the CI job `demo`; after the review round: the session body capped at 4 KiB, `analyzr-demo check` never writes to a non-demo, the agents' no-links in the inbox tab „Kein Zusammenhang“ (`GET …/no-links`, every role and mode); the operator's legal links (`ANALYZR_DEMO_IMPRINT_URL`, `ANALYZR_DEMO_PRIVACY_URL`, „Impressum“ and „Datenschutz“ in the banner; Miragon's pages in `fly.demo.toml`) | built and checked locally (the image, `analyzr-demo check`, the Playwright walk, restart = seed, no eval file in the image; [Read-only demo, owner decision 20](#read-only-demo-owner-decision-20-2026-10-10)); unit and real-PostgreSQL tests (every write route 403 with three credentials and none forgotten, every GET route over the read-only role, a 700 MB session body cut off at 4 KiB); deployed and checked live on 2026-10-10 under the earlier name ([Verified end to end](#verified-end-to-end)); live at https://analyzr-demo.fly.dev since 2026-10-12 (Fly organization `miragon`, idle machines stopped; smoke check 126 passed) |

## Quickstart (Docker)

### Prerequisites

- Docker with Compose v2 (Docker Desktop on macOS). That is all analyzr itself needs: the image holds
  the server, the web UI and the `analyzr` CLI.
- Only for the CLI from the checkout, `pnpm dev`, the tests and the "checkout" variant of Claude
  Desktop: Node 24 and pnpm 11.1.3 (`packageManager` in `package.json`), then `pnpm install` at
  the repository root. `.node-version` pins 24.21.0, the version of the image and of CI; any
  Node 24 runs the checkout (`engines`), and a unit test keeps `.node-version`, the image's
  `NODE_IMAGE`, pnpm and the Dockerfile frontend in sync.
- Free ports on 127.0.0.1: 7400 (analyzr) and 55432 (PostgreSQL). [Troubleshooting](#troubleshooting)
  shows how to move them.

### Start

```sh
docker compose -p analyzr -f docker/compose.yaml up -d --build --wait   # or: pnpm docker:up
curl -s http://127.0.0.1:7400/health
# {"status":"ok","version":"0.1.0-alpha.0","db":"ok"}
```

This builds the image `analyzr:local` (the first build takes a few minutes, later ones seconds),
starts PostgreSQL 17 and analyzr (compose project `analyzr`, containers `analyzr-db-1` and
`analyzr-server-1`), runs the migrations and creates the owner key in the volume `analyzr_analyzr-state`.
`--wait` returns once both health checks pass. Both ports are published on 127.0.0.1 only.

### Load the test landscapes

```sh
docker compose -p analyzr -f docker/compose.yaml exec server analyzr seed
docker compose -p analyzr -f docker/compose.yaml exec server analyzr status
```

`seed` creates `nordwind-handel` (31 models; 9 accepted and 33 proposed relations; 14 findings)
and `stadtwerke-auental` (26 models; 3 accepted, 36 proposed; 17 findings) from `eval/corpus`,
exactly the rule tier that `eval:candidates` computes. Running it again changes nothing.
`analyzr seed _sample` loads the three-model sample into the project `sample`. `analyzr seed
--value-chains` also creates each landscape's golden value chain (r1, without placements; the
rule tier proposes 4 placements in `nordwind-handel`), and a later run never overwrites a chain
you edited. Every model starts
at the stage "waiting for agent": an agent with `analyzr:propose` works the pipeline
([Analysis pipeline and review](#analysis-pipeline-and-review-m2)). A live run with an LLM agent
gets a fresh project of its own (`analyzr seed nordwind-handel --project <key> --issue-tokens
--token-name <run>`, see [Live runs](#live-runs-evallive-and-the-live-gate-m3)).

### Let the simulation agent work the pipeline

The LLM-free simulation agent fills the review inbox without a model (an LLM agent works the same
pipeline with the `relations` procedure: [Connect Claude Code](#connect-claude-code), [Connect
Claude Desktop](#connect-claude-desktop)). It runs from the checkout (`pnpm install`; it is not
in the image) and talks to the stack over MCP with an agent token, one per project:

```sh
docker compose -p analyzr -f docker/compose.yaml exec server analyzr token create \
  --project nordwind-handel --name agent-sim --scopes read,propose --expires 7d --json   # the secret
ANALYZR_TOKEN=analyzr_at_… pnpm agent-sim                       # over HTTP, like Claude Code
ANALYZR_TOKEN=analyzr_at_… pnpm agent-sim \
  --stdio-command "/usr/local/bin/docker exec -i -e ANALYZR_TOKEN analyzr-server-1 analyzr mcp"   # like Claude Desktop
docker compose -p analyzr -f docker/compose.yaml exec server analyzr status
```

It claims and submits until nothing is left (31 tasks in `nordwind-handel`, 26 in
`stadtwerke-auental`). Afterwards `nordwind-handel` has 48 proposed relations (33 of them in the
key tier), 28 models "waiting for review" and 3 "incorporated"; `stadtwerke-auental` has 52
proposed, 20 and 6. Every proposal names the token's principal (`agent:agent-sim`), its client
id, the declared procedure `analyzr-relations@0.2.0` (the one the claim names; the simulation agent
follows its own policy, not the procedure's rules) and the model `sim-policy-1`; borderline pairs
carry a question. Each pair is judged in one task only (a proposal or a no-link,
[judge each pair once](#judge-each-pair-once)). Review them at
http://127.0.0.1:7400/projects/nordwind-handel/review. Running the agent again changes nothing
(every task is done); after a re-upload with other facts it works only the changed model. Options
and the policy: [Simulation agent](#simulation-agent-and-evalreplay-m2).

### URLs

| What | URL |
|---|---|
| Web UI (you are the owner; local mode has no login) | http://127.0.0.1:7400 (http://localhost:7400 works too) |
| REST API | http://127.0.0.1:7400/api/v1, OpenAPI 3.1 at http://127.0.0.1:7400/api/v1/openapi.json |
| MCP (Streamable HTTP, agent token required) | http://127.0.0.1:7400/mcp |
| Health | http://127.0.0.1:7400/health |
| PostgreSQL | `postgres://analyzr:analyzr@127.0.0.1:55432/analyzr` |

Screenshots with the seeded landscapes (`apps/web/e2e/screenshots.spec.ts`):
[projects](screenshots/01-projects.png), [„Übersicht“](screenshots/02-models.png),
[relations](screenshots/03-relations.png), [model view](screenshots/04-model-view.png),
[findings](screenshots/05-findings.png), [connect an agent](screenshots/06-connect-agent.png),
[Claude Desktop entry](screenshots/07-connect-claude-desktop.png). The review (M2,
`apps/web/e2e/review.spec.ts`, a project of its own with agent proposals made over REST):
[inbox](screenshots/m2-01-inbox.png), [review screen](screenshots/m2-02-review.png),
[bulk accept](screenshots/m2-03-bulk.png), [held list](screenshots/m2-04-held.png),
[correction](screenshots/m2-05-correct.png), [timeline](screenshots/m2-06-timeline.png),
[version conflict](screenshots/m2-07-conflict.png). The pipeline end to end (M2,
`apps/web/e2e/pipeline.spec.ts`, a project worked by the simulation agent):
[stages after the agent run](screenshots/m2-08-pipeline-stages.png), [an agent proposal with
its question and provenance](screenshots/m2-09-agent-proposal.png), [bulk accept with agent
questions and an ambiguous call target flagged](screenshots/m2-10-bulk-flags.png), [a rejection
whose endpoint changed after a re-upload](screenshots/m2-11-endpoint-changed.png), [the same
relation reopened by the agent's second run](screenshots/m2-12-reopened.png). The value chain (M4
S3, `apps/web/e2e/value-chain.spec.ts`, the golden `nordwind-handel` chain in a project of its
own): [the chain with badges and findings](screenshots/m4-01-chain-view.png), [a step with the
rule tier's and an agent's placement](screenshots/m4-02-step-panel.png), [the modeler with the
link editor](screenshots/m4-03-edit-link.png), [the dry run before a rename](screenshots/m4-04-save-impact.png),
[a save conflict](screenshots/m4-05-conflict.png), [the step view](screenshots/m4-06-step-view.png),
[a project without a chain](screenshots/m4-07-empty.png), [the bulk re-confirm](screenshots/m4-08-reconfirm.png).
The placement pipeline and Import (M4 S5, `e2e/value-chain-draft.spec.ts` and
`e2e/value-chain-agent.spec.ts`): [an invented draft imported into a new chain, unsaved](screenshots/m4-12-import.png),
[the impact dialog of an import that replaces the golden chain](screenshots/m4-13-import-impact.png),
[the panel after the simulation agent's placement task: „Platzierungen prüfen“, „Zu prüfen“ and its doubts in „Ohne Schritt“](screenshots/m4-14-agent-unsure.png).

![Relations of nordwind-handel: rule acceptances and key-tier proposals](screenshots/03-relations.png)

![Model view: the endpoint of an accepted call highlighted in bpmn-js](screenshots/04-model-view.png)

![Review screen: both endpoint models side by side, the agent's rationale, evidence, question and provenance, the decision with keyboard shortcuts](screenshots/m2-02-review.png)

![Bulk accept of the key tier: every pair listed, generic and widely shared names flagged and left unchecked](screenshots/m2-03-bulk.png)

![Decision memory: the rejection, then the simulation agent's new proposal after the endpoint was renamed](screenshots/m2-12-reopened.png)

![Value chain page: the golden nordwind-handel chain with process badges and finding labels, the overview panel with the step tree](screenshots/m4-01-chain-view.png)

![Value chain page: a step selected, its placements as cards (the rule tier's key proposal and an agent's proposal) with the decision and keyboard shortcuts](screenshots/m4-02-step-panel.png)

### Create an agent token

Every MCP client needs an agent token (`analyzr_at_…`): valid for one project, scopes `analyzr:read`,
`analyzr:propose` and `analyzr:write` (never review), at most 365 days, shown exactly once.

- **Web UI:** open the project → **Agent verbinden** → name, rights, validity → **Token
  erstellen**. The page shows the secret once, ready-to-paste configurations for Claude Code,
  Claude Desktop and other clients, and the token list with **Widerrufen**.
- **CLI in the container** (prints the same configurations; `--json` prints only the token):
  ```sh
  docker compose -p analyzr -f docker/compose.yaml exec server analyzr token create \
    --project nordwind-handel --name claude --scopes read,propose --expires 90d
  docker compose -p analyzr -f docker/compose.yaml exec server analyzr token list --project nordwind-handel
  docker compose -p analyzr -f docker/compose.yaml exec server analyzr token revoke --project nordwind-handel agt_…
  ```

A revoked or expired token is refused with 401 on its next request. Revoking also withdraws the
token's open proposals and no-links, hands its claimed tasks back (CONCEPT §6) and queues the
models whose pairs it judged again; an expired token's proposals stay for review.

### Connect Claude Code

Claude Code talks to `/mcp` over HTTP with the token as a bearer header:

```sh
export ANALYZR_TOKEN=analyzr_at_…
claude mcp add --transport http analyzr http://127.0.0.1:7400/mcp --header "Authorization: Bearer ${ANALYZR_TOKEN}"
claude mcp list
# analyzr: http://127.0.0.1:7400/mcp (HTTP) - ✔ Connected
```

Without `--scope` this is Claude Code's `local` scope: the server is available in the current
directory only, and the expanded secret is stored in `~/.claude.json`. `--scope user` makes it
available everywhere. To keep the definition in a repository without the secret, use the project
scope with single quotes, so `.mcp.json` holds the literal `${ANALYZR_TOKEN}` and Claude Code reads
it from the environment:

```sh
claude mcp add --scope project --transport http analyzr http://127.0.0.1:7400/mcp \
  --header 'Authorization: Bearer ${ANALYZR_TOKEN}'
```

```json
{
  "mcpServers": {
    "analyzr": {
      "type": "http",
      "url": "http://127.0.0.1:7400/mcp",
      "headers": { "Authorization": "Bearer ${ANALYZR_TOKEN}" }
    }
  }
}
```

A project server needs a one-time approval (`claude mcp list` shows `⏸ Pending approval` until
you start `claude` in that directory and approve it). Then ask, for example, "Which processes in
nordwind-handel call the dunning process?"; the tools are listed under [MCP](#mcp). Cursor and VS
Code use the same URL and header; Codex reads the token from an environment variable
(`examples/agents/codex/config.toml`, `bearer_token_env_var = "ANALYZR_TOKEN"`).

**Work the pipeline.** The plugin `plugins/analyzr` adds the skill `/analyzr:relations [project]
[max-tasks]`, generated from the procedure ([The relations procedure](#the-relations-procedure-m3)).
Load it for one session with `claude --plugin-dir <checkout>/plugins/analyzr`, or install it from
the repository's marketplace:

```sh
claude plugin marketplace add "$PWD"   # from the root of your checkout
claude plugin install analyzr@analyzr
```

`--plugin-dir` and a marketplace added from a local checkout load the plugin's current files at
every session start. An install from a Git-hosted marketplace (`claude plugin marketplace add
Miragon/analyzr`, which needs access to the repository while it is private) is a cached copy that stays at its version until a new procedure
version is released; then `claude plugin marketplace update analyzr && claude plugin update
analyzr@analyzr` (and a new session).

Then, in a session, `/analyzr:relations nordwind-handel 5` claims one task at a time and stops
after five tasks or when none is left; only a user starts the skill, the model cannot invoke
it. The plugin carries no MCP server: the connection above stays separate, so the tools keep the names `mcp__analyzr__*`. Without the plugin, the server's MCP
prompt `work_pipeline` gives the same instructions: `/analyzr:work_pipeline` in the `/` menu
(marked "(MCP)"), or `/mcp__analyzr__work_pipeline <projectId> <maxTasks>` (positional arguments,
so `maxTasks` needs a project before it). For a run with `--tools ""` (no built-in tools), add
`"alwaysLoad": true` to the server entry, so analyzr's tools load at session start instead of
behind tool search. Runs that count as evaluation start Claude Code in an empty directory
outside the checkout (`eval/` holds the ground truth) with a fresh project and its own token:
`examples/agents/claude-code` has the configuration (`mcp.json` with `${ANALYZR_TOKEN}` and
`alwaysLoad`), the interactive command line and `run-headless.sh` (one fresh `claude -p` per
batch until nothing is pending); the owner's step-by-step guide is
[M3-LIVE-RUNS.md](M3-LIVE-RUNS.md).

### Connect Claude Desktop

Claude Desktop starts local MCP servers over stdio only, so it runs the bridge `analyzr mcp`, which
relays every message to `/mcp` with `ANALYZR_TOKEN`. Add one entry under `mcpServers` in
`~/Library/Application Support/Claude/claude_desktop_config.json` (create the file if it is
missing, keep other entries) and restart Claude Desktop. Claude Desktop does not get your shell's
`PATH` on macOS, so the command must be an absolute path.

**analyzr in Docker:** the bridge runs inside the container. `which docker` prints the path; with
Docker Desktop it is `/usr/local/bin/docker`.

```json
{
  "mcpServers": {
    "analyzr": {
      "command": "/usr/local/bin/docker",
      "args": ["exec", "-i", "-e", "ANALYZR_TOKEN", "analyzr-server-1", "analyzr", "mcp"],
      "env": { "ANALYZR_TOKEN": "analyzr_at_…" }
    }
  }
}
```

**Bridge from the checkout** (Node ≥ 24 and `pnpm install` in the checkout; analyzr may run in
Docker or with `pnpm dev`). `command` is the absolute path of the Node 24 binary, which
`node -p process.execPath` prints (`which node` may print a version-manager shim that needs your
shell); `args` holds the absolute path of `apps/cli/src/main.ts`:

```json
{
  "mcpServers": {
    "analyzr": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/path/to/analyzr/apps/cli/src/main.ts", "mcp"],
      "env": { "ANALYZR_URL": "http://127.0.0.1:7400", "ANALYZR_TOKEN": "analyzr_at_…" }
    }
  }
}
```

The **Agent verbinden** page prints both entries with the real token (enter your Node or Docker
path there). `analyzr token create` prints the Docker entry when it runs in the container (with
`"command": "docker"` and a reminder to make it absolute) and the checkout entry with its own
absolute Node path when it runs from the checkout. The bridge keeps no state, speaks 2025-11-25
and 2026-07-28, logs to stderr only, and answers every request with a JSON-RPC error naming the
cause if analyzr is down or rejects the token.

**Work the pipeline.** Claude Desktop has no plugin skill, and whether it offers the MCP prompt
`work_pipeline` is not documented; the procedure is self-contained, so the agent loads it with
`get_procedure` and follows it. `examples/agents/claude-desktop` holds both entries as files and
the German start prompt `start-prompt.de.md` with the placeholders `{{PROJEKT}}`, `{{MODELL_ID}}`
(the exact API model id, which the agent declares as `llmModel`; Claude Desktop shows only a
product name) and `{{ANZAHL}}` (the batch size). A new chat per batch keeps the procedure in full
view; for evaluation runs leave other connectors off. Live runs:
[M3-LIVE-RUNS.md](M3-LIVE-RUNS.md).

### Stop and clean up

```sh
docker compose -p analyzr -f docker/compose.yaml stop      # stop; containers and data stay
docker compose -p analyzr -f docker/compose.yaml down      # remove the containers; volumes stay (or: pnpm db:down)
docker compose -p analyzr -f docker/compose.yaml down -v   # also delete analyzr_db-data and analyzr_analyzr-state
docker image rm analyzr:local
```

After `stop` or `down`, `up -d --wait` brings back the projects, the tokens and the owner key.
After `down -v`, start and seed again. Revoke the tokens you handed out (`analyzr token revoke`),
remove the client entries (`claude mcp remove analyzr`, plus `-s project` or `-s user` for those
scopes; the entry in `claude_desktop_config.json`).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `up` fails: `port is already allocated` or `address already in use` | 7400 or 55432 is taken (`lsof -nP -iTCP:7400 -sTCP:LISTEN`), often by `pnpm dev` (also 7400) or a second analyzr. Stop that, or publish other ports: `ANALYZR_HOST_PORT=7500 ANALYZR_DB_PORT=55500 docker compose -p analyzr -f docker/compose.yaml up -d --wait`. The Origin check follows `ANALYZR_HOST_PORT`. Then use `http://127.0.0.1:7500` everywhere (UI, `claude mcp add`, `ANALYZR_URL`); `analyzr token create` in the container still prints 7400 in its Claude Code command. With another database port, `pnpm dev` needs `DATABASE_URL=postgres://analyzr:analyzr@127.0.0.1:55500/analyzr`. |
| 403 `local mode accepts only localhost Host headers` | analyzr was opened by a name or address other than `localhost`, `127.0.0.1` or `[::1]` (a LAN IP, a `.local` name, a proxy). Local mode serves this machine only: use http://127.0.0.1:7400. |
| 403 `local mode accepts only localhost origins on the analyzr ports (ANALYZR_ORIGIN_PORTS)` | A browser page on another port called analyzr (another app, a dev server on a new port). Allowed are localhost origins on `ANALYZR_ORIGIN_PORTS`: in Docker the published port and 7401, with `pnpm dev` 7400 and 7401. Add a port with `ANALYZR_ORIGIN_PORTS=7400,<port>` on the server. curl, the CLI and MCP clients send no `Origin` and are not affected. |
| 401 `send an agent token (Authorization: Bearer analyzr_at_…) or open a session` | A REST call without credentials. The web UI opens its session itself; scripts use `POST /api/v1/session` (cookie, see below) or an agent token. |
| 401 on `/mcp`: `MCP needs an agent token …` or `invalid, expired or revoked agent token` | Missing, wrong, revoked or expired token, or the owner key (`analyzr_ok_…`), which MCP never accepts. Create a new token. Claude Code shows `✘ Failed to connect — Server rejected the configured Authorization header (HTTP 401)`; the bridge answers `analyzr at … rejected the agent token (401 …); check ANALYZR_TOKEN`. |
| `claude mcp list`: `⏸ Pending approval` | A project server from `.mcp.json` is not approved yet: start `claude` in that directory and approve `analyzr`. |
| `claude mcp list`: `Missing environment variables: ANALYZR_TOKEN` | `.mcp.json` refers to `${ANALYZR_TOKEN}`: export it in the shell that starts Claude Code. |
| Claude Desktop lists `analyzr` as failed | Usually a command it cannot find (no shell `PATH`): use absolute paths (`/usr/local/bin/docker`, the output of `node -p process.execPath`). The Docker entry also needs the running container `analyzr-server-1` (`docker ps`). Try the entry by hand: `ANALYZR_TOKEN=… /usr/local/bin/docker exec -i -e ANALYZR_TOKEN analyzr-server-1 analyzr mcp` must wait for input instead of exiting. |
| The server exits at start: `… is accessible by group or others (mode 644); run: chmod 600 …` | The owner key file is readable by others; run the printed `chmod`. Other owner key errors (`belongs to another OS user`, `does not hold an owner key; delete it …`) name their fix too. |
| `analyzr seed`/`token` on the host: no owner key | The Docker server's key lives in its volume. Run the CLI in the container (`docker compose … exec server analyzr …`) or copy the key, see [Local mode](#local-mode-who-is-calling-concept-6). |
| `analyzr …` on the host: `401 Unauthorized): invalid owner key`, or `analyzr status`: `does not accept the owner key at …` | The key file on the host belongs to another analyzr instance (usually `~/.local/state/analyzr/owner-key` from an earlier `pnpm dev`), while the Docker server has its own key in its volume. Run the CLI in the container, or copy the container's key and set `ANALYZR_OWNER_KEY_FILE` (see [Local mode](#local-mode-who-is-calling-concept-6)). `analyzr status` then shows the server only; the other commands fail. |
| The server exits at start: `ANALYZR_HOST=… is not a loopback address` | Local mode has no login, so it listens on 127.0.0.1 only. Unset `ANALYZR_HOST`. In a container (which must listen on 0.0.0.0) publish the port on 127.0.0.1 only and set `ANALYZR_ALLOW_NON_LOOPBACK=1`, as `docker/compose.yaml` does: `docker run -p 127.0.0.1:7400:7400 -e ANALYZR_ALLOW_NON_LOOPBACK=1 -e DATABASE_URL=… analyzr:local`. |
| UI: "Server nicht erreichbar" or "Datenbank nicht erreichbar" | analyzr or PostgreSQL is down or restarting: `docker compose -p analyzr -f docker/compose.yaml ps`, `… logs server`. |
| `eval:live: project … is not named after a corpus landscape` | A live run's project has a key of its own (`--project` of `analyzr seed`): name the landscape it was seeded from, e.g. `--landscape nordwind-handel`. |
| `eval:live: project … has analyses of N models not in landscape …` (exit 2) | `--landscape` names another landscape than the one the project was seeded from; nothing was written. Name the right one and record again. |
| `eval:live: warning: project … was worked under N tokens (…)` | More than one agent token submitted in the project (also two tokens of one name, and also with `--agent`, which would file them as one run): that is no run. Do not commit it; start the run again in a fresh project. |
| `eval:live: warning: project … gives … recording files, …` | The run's submissions declared more than one `llmModel` or procedure version; the live gate would count every file as a run. Do not commit it: start the run again in a fresh project ([M3-LIVE-RUNS.md](M3-LIVE-RUNS.md#3b-claude-desktop)). |
| `eval:live: GET /projects/…/analyses?…: 401 …` | The token is missing, revoked or expired, or belongs to another analyzr. Use the run's agent token or the owner key (`ANALYZR_TOKEN`); with analyzr in Docker, the checkout needs the container's key (see [Local mode](#local-mode-who-is-calling-concept-6)). |
| Saving the value chain in the web UI: "Jemand hat inzwischen gespeichert" (412 `revision-conflict`) | Someone saved a newer revision (another tab, `analyzr value-chain push`, an agent never can) after you entered edit mode; analyzr does not merge. "Neuere Revision laden" downloads your version as `<key>-r<rev>-entwurf.vc.json` first, then you edit the newest revision; re-apply your change from the file. "Weiter bearbeiten" keeps your drawing, but the next save conflicts again. Only `analyzr value-chain push --force` saves over the head. |
| Integration or e2e tests cannot start PostgreSQL | Testcontainers needs a running Docker; or set `ANALYZR_TEST_DATABASE_URL` to a PostgreSQL whose user may `CREATEDB`. |

## Development without Docker

```sh
pnpm install
pnpm db:up          # only PostgreSQL of docker/compose.yaml, on 127.0.0.1:55432
pnpm dev            # server on 127.0.0.1:7400 (node --watch) + Vite on http://127.0.0.1:7401
pnpm seed           # second terminal: the eval landscapes, as the owner
pnpm analyzr status    # models by stage, relations by status, findings per project
```

Vite proxies `/api`, `/mcp` and `/health` to the server. The server runs pending migrations at
startup (`ANALYZR_MIGRATE=off` disables it), creates the owner key on its first start
(`~/.local/state/analyzr/owner-key`, below) and serves `apps/web/dist` at `/` if it exists, so after
`pnpm build` the UI is also at http://127.0.0.1:7400. `pnpm dev` and the container `analyzr-server-1` both
use port 7400: stop the container first (`docker compose -p analyzr -f docker/compose.yaml stop
server`). With the checkout CLI against the Docker server, copy the container's owner key (see
[Local mode](#local-mode-who-is-calling-concept-6)).

## Demo deployment (Fly.io)

A public analyzr to show others (owner decision 20 in [HANDOFF.md](HANDOFF.md) §4): both landscapes, `nordwind-handel` and
`stadtwerke-auental`, with their value chains, worked by the simulation agent, on one Fly.io
machine. **Everyone sees everything, nobody can change anything**, and there is no login. No
Camunda engine, no LLM credential, no Fly secret.

### What it is

- **One image, `docker/Dockerfile.demo`** (the product image `docker/Dockerfile` is unchanged):
  PostgreSQL 17.11 from its official image (Debian trixie), the Node 24.21.0 binary of the product
  image, the server, the built web UI and the supervisor `@analyzr/demo` (`apps/demo`,
  `analyzr-demo seed | serve | check`).
- **The seed is made while the image is built** (`analyzr-demo seed`, stage `seed`): `initdb`,
  PostgreSQL on loopback, the server in normal local mode on loopback, `analyzr seed
  nordwind-handel stadtwerke-auental --value-chains --issue-tokens --token-name agent-sim`, then
  `analyzr-agent-sim` per project with its token (both task kinds, default `sim-policy-1`, from the
  claim inputs alone), a check that every task is done and the agent proposed, asked, no-linked
  and placed, then `apps/server/src/demo-bootstrap.ts` (the visitor and the read-only role),
  `VACUUM (FREEZE, ANALYZE)` and a clean shutdown. The data directory becomes
  `/opt/analyzr-demo/pgdata-template`, described by `/opt/analyzr-demo/seed.json` (seed id, time,
  counts). A broken seed fails the build, so Fly keeps the release that runs. The build arg
  `ANALYZR_DEMO_SEED` names the seed and is the seed layer's only changing input: the deploy
  workflow passes its run and attempt (`<run_id>.<run_attempt>`), so every workflow deploy seeds
  afresh, while a build with an unchanged value (the default `local`, e.g. a second manual
  `fly deploy` of the same commit or a local `--build`) reuses the cached seed. On 2026-10-10 the seed took about 5 s: `nordwind-handel` 31 models, 48 agent
  proposals (12 with a question), 150 no-links, 29 placement proposals, 3 „Agent unsicher“;
  `stadtwerke-auental` 26 models, 52 proposals (15 with a question), 101 no-links, 25 placements,
  2 unsure.
- **Every start is the seed** (`analyzr-demo serve`, the entry point): it copies the template to
  `/tmp/analyzr-demo`, starts PostgreSQL on 127.0.0.1 (no autovacuum, no durability: the data is a
  throwaway copy) and the server with `ANALYZR_DEMO=readonly` on 0.0.0.0:8080, as the read-only
  role. SIGTERM or SIGINT stop the server, then PostgreSQL; if either dies, the supervisor stops
  the other and exits 1, and Fly restarts the machine from the seed. Start to healthy: about 2 s
  locally.
- **Three write barriers.** (1) The server's read-only guard answers every method other than
  GET, HEAD and OPTIONS with 403 `demo-readonly`, on every path, before authentication; the only
  exceptions are `POST` and `DELETE /api/v1/session`. (2) Every session is the visitor
  (`urn:analyzr:demo` / `visitor`), a user with scope `analyzr:read` only and the viewer role in every
  project, so the domain policy denies writes as well. (3) The server connects as the role
  `analyzr_demo` with `default_transaction_read_only = on` and `statement_timeout = 30s`; a write
  that slipped through fails in PostgreSQL. Besides: `/mcp` answers 404, any `Authorization`
  header 401, there is no owner key, and the server refuses to start in demo mode unless its
  database role is read-only and the visitor exists. The session routes, the only writes anyone
  reaches, carry no data, and `POST /api/v1/session` reads at most 4 KiB
  (`MAX_SESSION_BODY_BYTES`, 413 `payload-too-large` before the body is read; in local mode too),
  so no request can fill the 1 GB machine's memory.
- **Host and Origin** follow the public origins (`ANALYZR_PUBLIC_ORIGIN`, by default
  `https://$FLY_APP_NAME.fly.dev`): `Host` must be one of their hosts (or a loopback name),
  `Origin` must be one of them exactly; `GET /health` is exempt for Fly's checker. The session
  cookie is `Secure` and the server sends `Strict-Transport-Security` when every origin is https.
- **The web UI** shows the banner „Demo – nur lesen. Du kannst dir alles ansehen, aber nichts
  ändern. Die Vorschläge stammen vom Simulationsagenten (ohne LLM).“ with a link to the
  repository (it promises no nightly reset) and the operator's „Impressum“ and „Datenschutz“
  ([below](#legal-pages)), and hides every write action: no „Neues Projekt“, no button
  „Hochladen“, no menu „Einstellungen“ („Agent verbinden“, „Annahmeregeln“; their URLs show a
  notice and send no request), no „Agent starten“ or „Nochmal versuchen“, no bulk accept (nor
  „Gesammelt annehmen“), „Antwort geben“, „Jetzt entscheiden“ or decision panel (A/R/H/C do
  nothing), no value chain editing. Read views stay: „Übersicht“, the model view, „Relationen“ with its results and
  „Kein Zusammenhang“, the list „Befunde“ behind its link in „Offene Fragen“, the review screen in
  read mode, the value chain page and the step view.
  Screenshots: [projects](screenshots/demo-01-projects.png),
  [model view](screenshots/demo-02-model-view.png), [inbox](screenshots/demo-03-inbox.png),
  [review screen](screenshots/demo-04-review.png),
  [value chain](screenshots/demo-05-value-chain.png),
  [no-links](screenshots/demo-06-no-links.png).
- **No-links** (decision 20(4)): the inbox tab „Kein Zusammenhang“ lists every live, current
  agent no-link with its reason (`GET /api/v1/projects/{p}/no-links`), also on pairs without a
  relation; on a pair with one it shows as „Einwand“ in the queue and on the review screen as
  well. The simulation agent alone no-links only pairs without a relation (its proposals and
  no-links never meet, and with its default thresholds it no-links none of the rule tier's
  proposals), so on the demo the tab is where its 150 and 101 no-links show; the queue has no
  „Einwand“. The tab is read-only for every role and in every mode.
- **Holdout:** the runtime image holds no `eval/` directory, no CLI and no simulation agent, and
  `/opt/analyzr-demo` holds only the template and `seed.json`; the database holds models, value
  chains and agent proposals, never expected answers. `docker/Dockerfile.demo.dockerignore` (a
  superset of the product's, next to the Dockerfile for BuildKit and named as `ignorefile` in
  `docker/fly.demo.toml` for flyctl's own upload) keeps answers, recordings and reports out of the
  build context, the stage `prod-seed` removes them again and the runtime stage checks.

### Legal pages

The owner, 2026-10-10: „nimm die dinge vom miragon.io impressum“. Miragon GmbH runs the demo,
and its own pages cover it: the Impressum at https://miragon.io/impressum and the privacy policy
at https://miragon.io/datenschutz/, whose section „Wenn du unsere Tools nutzt“ says that
Miragon's own tools run on Fly.io in the EU region Frankfurt, that server logs are kept for 30
days, and that tools without a login collect no further data. The demo is such a tool: no login,
no form, no analytics, no third-party request (fonts and scripts come from the demo itself; the
CSP allows `'self'` only).

- **The cookie.** The demo's only cookie, `analyzr_session` (HttpOnly, `SameSite=Strict`, `Secure`
  on https, 12 hours), holds the viewer session without which the web UI cannot read the API:
  strictly necessary, so there is no consent banner. The local storage the UI uses for value
  chain drafts and agent setups holds nothing on the demo (both are write paths).
- **The settings.** `docker/fly.demo.toml` (`[env]`) and `docker/compose.demo.yaml` set
  `ANALYZR_DEMO_IMPRINT_URL` and `ANALYZR_DEMO_PRIVACY_URL` to those two pages. analyzr's code holds no
  operator data and the repository copies no Impressum text; another operator sets its own URLs
  there. The server checks both at start (absolute `https://` URLs, refused outside the demo),
  `/health` reports them (`imprintUrl`, `privacyUrl`; local mode's answer is unchanged) and
  `analyzr-demo serve` passes them through.
- **The banner** shows „Impressum“ and „Datenschutz“ at every width, a phone's 320 px included,
  in its one line of `--analyzr-banner-h`, each opening in a new tab (`rel="noreferrer"`); the
  sentences and the repository link give way first ([phone](screenshots/demo-07-phone.png)).
  `analyzr-demo check` fails when `/health` lacks either link.

### Run it locally

```sh
docker compose -p analyzr-demo -f docker/compose.demo.yaml up -d --build --wait   # http://127.0.0.1:7480
pnpm --filter @analyzr/demo check --url http://127.0.0.1:7480                      # every write refused?
ANALYZR_E2E_URL=http://127.0.0.1:7480 pnpm --filter @analyzr/web e2e demo             # the browser walk
docker compose -p analyzr-demo -f docker/compose.demo.yaml restart demo           # back to the seed
docker compose -p analyzr-demo -f docker/compose.demo.yaml down -v && docker image rm analyzr-demo:local
```

The image tag is `analyzr-demo:local` (`ANALYZR_DEMO_IMAGE` sets another), never the product's
`analyzr:local`; `ANALYZR_DEMO_PORT` moves the port. The container has one CPU and 1 GB, as the Fly
machine. `--build` reuses the cached seed while nothing changed; `ANALYZR_DEMO_SEED=$(date +%s)
docker compose -p analyzr-demo -f docker/compose.demo.yaml up -d --build --wait` seeds afresh (the
compose file passes it as the build arg). The other Playwright specs skip themselves on a demo server,
`demo.spec.ts` on any other; `demo.spec.ts` also checks the banner's legal links at 320, 390,
768, 1024 and 1440 px (visible, whole, inside the viewport, the banner as high as
`--analyzr-banner-h`, no sideways scroll). That test is the file's last: the spec runs serially, and
the links are optional settings, so a demo without them fails that test alone while the read walk
and the write checks still run. `analyzr-demo check` requires both legal links in `/health`
(absolute https URLs) and prints them; it sends nothing but `GET /health` to a server that
is not a read-only demo, and no write unless the session is the visitor and a viewer of every
listed project; its write walk names the project `analyzr-demo-check-none` and the chain key
`none`, so a mistyped URL (the owner's `analyzr` stack on 7400) cannot lose data.

### One-time setup on Fly.io (owner)

1. Install flyctl (`brew install flyctl`) and log in: `fly auth login`.
2. Create the app (the name is global on fly.dev; take another if `analyzr-demo` is taken):
   `fly apps create analyzr-demo --org miragon` (the organization of Miragon's other tools;
   `fly orgs list` shows yours).
3. A deploy token for this app only, as the repository secret. It **expires after one year**
   (`8760h`; note the date): then every deploy, reset and restart fails with an authorization
   error until you run the same two commands again (see [Troubleshooting](#troubleshooting-the-demo)).
   ```sh
   fly tokens create deploy --app analyzr-demo --expiry 8760h   # prints FlyV1 …
   gh secret set FLY_API_TOKEN --repo Miragon/analyzr           # paste it
   ```
4. Only for another app name: `gh variable set FLY_DEMO_APP --repo Miragon/analyzr --body <name>`
   (the workflow passes it as `--app`; `docker/fly.demo.toml` names `analyzr-demo`).
5. The first deploy: `gh workflow run demo-deploy.yml --repo Miragon/analyzr --ref main` (or
   GitHub → Actions → "Demo deploy" → "Run workflow"; afterwards every push to `main` that touches
   `apps/`, `packages/`, `eval/corpus/`, `eval/value-chains/`, `docker/`, the root package files or
   the workflow deploys too), or from the checkout's root:
   `fly deploy --config docker/fly.demo.toml --app analyzr-demo --remote-only --ha=false
   --build-arg ANALYZR_DEMO_SEED=manual-$(date +%s)` (the build arg makes the seed fresh; without
   it a second manual deploy of the same commit reuses the remote builder's cached seed). The
   build runs on Fly's remote builder, the seed included; then https://analyzr-demo.fly.dev.
6. Optional, a domain of your own: `fly certs add demo.example.org --app analyzr-demo`, the DNS
   records `fly certs show demo.example.org --app analyzr-demo` names, then
   `gh variable set FLY_DEMO_PUBLIC_ORIGIN --repo Miragon/analyzr --body
   "https://demo.example.org,https://analyzr-demo.fly.dev"` and a deploy (the workflow passes it as
   `ANALYZR_PUBLIC_ORIGIN` and checks the first origin).

**Costs:** one `shared-cpu-1x` machine with 1 GB that runs only while people visit. The owner
asked (2026-10-10) that an idle demo shuts down and costs nothing: `auto_stop_machines = "stop"`
with `min_machines_running = 0`, so Fly's proxy stops the machine within minutes without traffic
(well before the 30 minutes the owner named) and starts it again on the next request; the first
visitor after a pause waits about 15 seconds (machine start, PostgreSQL from the baked seed, the
server; 13 s measured on 2026-10-10). Verified the same day: after the deploy the machine was
`stopped` about 4 minutes after the last request, and the next request started it again. A stopped machine
bills only the storage of its root file system (cents per month), no CPU, RAM or snapshot; a
blue-green deploy runs a second machine for a few minutes. Check it with
`fly machine list --app analyzr-demo` (state `stopped`). Current prices:
https://fly.io/docs/about/pricing/. **No Fly secrets:** the request for the demo listed `DATABASE_URL` and
`ANALYZR_SESSION_SECRET`, but PostgreSQL runs inside the machine (its URL never leaves the
container) and the session key is random per start, which only ends the visitors' viewer
sessions; the web UI opens a new one by itself.

### Reset the demo

Nothing resets on a timer, and visitors have no reset endpoint (owner decision 20: „doch nicht
nachts … aber ich muss es machen können“). The demo cannot drift (nothing can be written), so a
reset is either a fresh seed or a plain restart. **The one documented action for a fresh seed**
of the current `main` commit (a few minutes; the old release serves until the new one
is healthy):

```sh
gh workflow run demo-deploy.yml --repo Miragon/analyzr --ref main
gh run watch --repo Miragon/analyzr   # optional: pick the new "Demo deploy" run and follow it
```

The demo's first deploy (2026-10-10, under the earlier name; [Verified end to
end](#verified-end-to-end)) was dispatched exactly this way. The workflow file is on the default
branch `main`, so GitHub → Actions → "Demo deploy" → "Run workflow" does the same in the browser.

When `gh` is not at hand or the dispatch fails, the same fresh seed from the checkout's root
(once: `fly auth login`; it deploys the checked-out commit):

```sh
fly deploy --config docker/fly.demo.toml --app analyzr-demo --remote-only --ha=false \
  --build-arg ANALYZR_DEMO_SEED=manual-$(date +%s)
```

The same seed again, in seconds (every start copies the seed; once: `fly auth login`), which
always works, also with an expired deploy token:

```sh
fly machine stop  --app analyzr-demo $(fly machine list --app analyzr-demo -q)
fly machine start --app analyzr-demo $(fly machine list --app analyzr-demo -q)
#   or: gh workflow run demo-deploy.yml --repo Miragon/analyzr --ref main -f action=restart
```

In the browser, GitHub → Actions → "Demo deploy" → a run → "Re-run all jobs" is only an
alternative, with limits GitHub documents ("Re-run workflows and jobs"): a run can be re-run up
to 30 days after it first ran, and a re-run repeats the run's event with its commit
(`GITHUB_SHA`) and inputs. So it gives a fresh seed of the current head only when you re-run the
newest run that deployed it, a push run or a `deploy` dispatch; a re-run of a `restart` dispatch
only restarts, and a re-run of an older push run deploys that older commit again.

`fly apps restart` is not used: it restarts running machines only, and the demo's machine is
usually stopped. Links into the demo survive a restart, not a deploy (a new seed has new ids).

### Troubleshooting the demo

| Symptom | Cause and fix |
|---|---|
| The workflow is green but nothing was deployed; notice "Demo deploy skipped" | The secret `FLY_API_TOKEN` is missing or empty (setup step 3). |
| `gh workflow run demo-deploy.yml …`: workflow not found | The workflow file is not on `main` yet, or `--repo` names another repository: push it to `main`, or deploy from the checkout with `fly deploy … --build-arg ANALYZR_DEMO_SEED=manual-$(date +%s)`. |
| No "Re-run all jobs" button | The run is older than 30 days (GitHub's limit). Use `gh workflow run …` or `fly deploy …` ([Reset the demo](#reset-the-demo)). |
| Deploy, reset or restart fails with `unauthorized`, `401` or a token error | The deploy token from setup step 3 expired (one year) or was revoked: `fly tokens create deploy --app analyzr-demo --expiry 8760h \| gh secret set FLY_API_TOKEN --repo Miragon/analyzr` (once: `fly auth login`), then run the workflow again. The demo keeps serving meanwhile, and `fly machine stop`/`start` work with your own login. |
| A manual `fly deploy` shows the old seed (`fly logs`: the start line `demo: seed <id> from <time>` names the earlier seed) | It ran without a new `ANALYZR_DEMO_SEED`, so the remote builder reused its cached seed: pass `--build-arg ANALYZR_DEMO_SEED=manual-$(date +%s)`. |
| The build fails in stage `seed` | The seed's log names the failed step (`demo seed: …`, the server's and PostgreSQL's lines). The running release keeps serving. |
| 403 `forbidden` "answers only under its public address" | The address is not in `ANALYZR_PUBLIC_ORIGIN`: set `FLY_DEMO_PUBLIC_ORIGIN` with every origin (custom domain and fly.dev) and deploy. |
| 403 `demo-readonly` | Expected for every write; the web UI shows „Das ist eine Demo: Hier kannst du nichts ändern.“ if one slips through. |
| The machine restarts again and again | `fly logs --app analyzr-demo`: the supervisor exits 1 when the server or PostgreSQL dies (`demo: … ended unexpectedly`), the server when its role is not read-only or the visitor is missing, or when a legal link is malformed (`ANALYZR_DEMO_IMPRINT_URL: …: must be https`; fix `[env]` in `docker/fly.demo.toml`). |
| `analyzr-demo check`: "no legal notice (Impressum) link" or "no privacy policy (Datenschutz) link" | The machine runs without `ANALYZR_DEMO_IMPRINT_URL` or `ANALYZR_DEMO_PRIVACY_URL`: `[env]` in `docker/fly.demo.toml` lost them, or an older release serves. The start log names the links the server took (`legal links: imprint …, privacy …`). |

### Configuration of the demo

| Variable | Where | |
|---|---|---|
| `ANALYZR_DEMO` | server | `readonly`: the read-only demo; anything else is refused. Refused together with a non-empty `ANALYZR_OWNER_KEY_FILE`, `ANALYZR_ORIGIN_PORTS`, `ANALYZR_ALLOW_NON_LOOPBACK=1` and `ANALYZR_MIGRATE=auto` (migrations default to off) |
| `ANALYZR_PUBLIC_ORIGIN` | server, `analyzr-demo serve` | required with `ANALYZR_DEMO`: comma-separated bare origins, `https://` (or `http://` on a loopback host); refused without `ANALYZR_DEMO`. `analyzr-demo serve` defaults it to `https://$FLY_APP_NAME.fly.dev` (Fly sets `FLY_APP_NAME`) |
| `ANALYZR_DEMO_IMPRINT_URL`, `ANALYZR_DEMO_PRIVACY_URL` | server, `analyzr-demo serve`; `docker/fly.demo.toml` `[env]`, `docker/compose.demo.yaml` | the operator's legal notice and privacy policy ([Legal pages](#legal-pages)): optional absolute `https://` URLs, refused without `ANALYZR_DEMO`; `analyzr-demo serve` passes them through as given; set to https://miragon.io/impressum and https://miragon.io/datenschutz/ |
| `ANALYZR_HOST`, `ANALYZR_PORT`, `ANALYZR_WEB_DIST` | image | `0.0.0.0`, `8080`, `/app/apps/web/dist` |
| `ANALYZR_DEMO_SEED` | build arg | the seed id in `seed.json` and the log; default `local`. The seed layer's only changing input: the workflow passes `<run_id>.<run_attempt>`, a manual build a value of its own (an unchanged value reuses the cached seed); `docker/compose.demo.yaml` passes it through |
| `FLY_API_TOKEN` | repository secret | the deploy token; without it the workflow skips |
| `FLY_DEMO_APP`, `FLY_DEMO_PUBLIC_ORIGIN` | repository variables | optional: another app name; the public origins of a custom domain |

## Reference

### Layout

```
apps/server/      @analyzr/server  Hono + @hono/zod-openapi, Drizzle + pg, MCP (src/{domain,db,http,mcp,auth})
apps/cli/         @analyzr/cli     the `analyzr` command (commander); since M6 S3c step 3 src/core-program.ts (the
                                   commands both CLIs share) and src/plugin-main.ts (the integrate plugin's bundled CLI)
apps/agent-sim/   @analyzr/agent-sim  `analyzr-agent-sim`: LLM-free simulation agent over MCP (src/{policy,agent,connect,recorder,program}.ts)
apps/demo/        @analyzr/demo    `analyzr-demo seed|serve|check`: the read-only demo's seed, supervisor and check (owner decision 20)
apps/web/         @analyzr/web     React 19 + Vite + Tailwind v4 + shadcn + TanStack (src/{routes,components,lib,theme}, test/, e2e/)
packages/contracts/  zod schemas, types, REST route configs, buildOpenApiDocument(); src/paths.ts: the zod-free
                     BPMN file rule and model key of a path (also `@analyzr/contracts/paths`, the web's runtime import);
                     src/open-question-labels.ts: the open questions' German labels (also
                     `@analyzr/contracts/open-question-labels`, zod-free, M6 S4); likewise
                     src/open-question-csv.ts and src/personal-data.ts (M6 S5a) and
                     src/amendment-labels.ts (the model amendments' German labels, M6 S5c-2) and
                     src/impact-merge.ts (the dry run's merge of its batches, shared by the CLI and
                     the web, M6 S2b follow-up)
packages/client/     hey-api client generated from the contracts (src/generated is generated)
packages/bpmn-facts/ fact extraction (CONCEPT §2); src/amend.ts: model amendments by byte-preserving
                     splices (`applyAmendments`, `readAmendable`, M6 S5c-2)
packages/relations/  rules, candidates (with the prepared index indexCandidates), baseline-label/1, baseline-prefix/1 and the name-stem rule (placement.ts, M4)
packages/procedures/ agent procedures as Markdown with frontmatter (relations.md = analyzr-relations; MCP get_procedure),
                     src/wrappers.ts (MCP prompt and skill text), scripts/generate.ts (writes the plugin's skill)
plugins/analyzr/     Claude Code plugin: .claude-plugin/plugin.json, skills/relations/SKILL.md (generated, do not edit)
plugins/analyzr-integrate/  Claude Code plugin (M6 S3b): skills/integrate-landscape/SKILL.md, reference/*.md,
                     scripts/*.mjs and THIRD-PARTY-NOTICES.md (generated from tools/integrate, do not edit)
.claude-plugin/   marketplace.json: this repository as the plugin marketplace `analyzr`
examples/agents/  reference setups: claude-code/, claude-desktop/, codex/; not workspace packages
eval/tools/       @analyzr/eval-tools: corpus generator/validator (.mjs) + eval:candidates, eval:replay, eval:live, eval:placements,
                  eval:descriptive (src/*.ts; its transforms in lib/descriptive.mjs)
eval/recordings/  agent recordings <procedure>@<version>/<agent>/<llmModel>/<landscape>.jsonl (eval:replay input)
eval/value-chains/  golden value chains + expected placements (M4); validate-value-chains.mjs (deps from eval/tools)
docker/           compose.yaml (project analyzr), Dockerfile; the read-only demo: Dockerfile.demo (+ .dockerignore),
                  compose.demo.yaml (project analyzr-demo), fly.demo.toml
tools/notices/    @analyzr/notices: writes THIRD-PARTY-NOTICES.md from `pnpm licenses list --prod --json` + bundled build tools (pnpm notices)
tools/integrate/  @analyzr/integrate (M6 S3b): sources and tests of the integrate plugin's scripts (src/cli/{inspect,normalize-bpmn,analyzr-read}.ts;
                  analyzr-read since M6 S2b follow-up step 4), scripts/generate.ts bundles them into plugins/analyzr-integrate/scripts;
                  since M6 S3c step 1 src/spec/ and src/cli/analyzr-spec.ts (analyzr-spec/1 and its renderer, run from source until 0.1.4);
                  since step 2 src/cli/analyzr-convert.ts (the converter runner, its modules in src/spec/, also from source until 0.1.4);
                  test/fixtures: a synthetic export, a golden bundle, the golden specs (fixtures/spec/), synthetic Visio and AML
                  exports with their example converters (fixtures/converters/)
docs/             CONCEPT.md, HANDOFF.md, M1-SKELETON.md, M2-PIPELINE-REVIEW.md, M3-RELATIONS-PROCEDURE.md, M3-LIVE-RUNS.md,
                  M4-VALUE-CHAIN.md, M6-INTEGRATION-AND-GAPS.md, this file, adr/ (ADR-0001), screenshots/
```

Package dependencies point one way: `contracts` ← `bpmn-facts` ← `relations` ← `server`;
`contracts` ← `client` ← `cli`, `web`; `contracts` ← `agent-sim` (talks to the server over MCP
only; the server's integration test uses it as a dev dependency); `contracts` ← `demo` (runs the
server, the CLI and the agent as child processes, never imports them); `procedures` (no dependencies)
← `server`, `eval-tools`; `eval-tools` (`contracts`, `bpmn-facts`, `relations`, `procedures`) is
a dev dependency of the server, whose integration test reads a project the way `eval:live` does
(`eval/tools/src/index.ts` exports only the light modules: the REST reader, the mapping, the gate,
the recordings loader and, since M4 S4, the placement scorer; since M6 S3a the claim size estimate
of `eval:descriptive`, which the server's unit test `claim-estimate.test.ts` pins to
`renderClaimInput`; not the corpus toolchain; since M6 S4 the subpath `@analyzr/eval-tools/descriptive`
gives the server's `open-questions.test.ts` eval:descriptive's model variants, toolchain
included); `integrate` (`tools/integrate`, M6 S3b) depends on
the zod-free `@analyzr/contracts/paths`, since M6 S2b's follow-up step 4 also on the zod-free
`@analyzr/contracts/impact-merge` (the dry run's merge of its batches, which `analyzr-read.mjs`
shares with the CLI and the web), and on bpmn-moddle with the Camunda extensions, since M6 S3c step
1 on `yaml` (the spec reader), on `bpmn-facts` and, since S3c step 1, `bpmn-js` for its tests only,
and nothing imports it: its scripts reach consultants bundled into `plugins/analyzr-integrate` (the
drift test keeps zod and every other third-party module out of `analyzr-read.mjs`). Workspace
dependencies use `workspace:0.0.0`. The value chain packages (M4) come from npm at exactly 0.3.0:
`@miragon/value-chain-schema-model` in `server` (DOM-free), `web` and `eval-tools` (for
`eval/value-chains/validate-value-chains.mjs`, which lives outside any package and resolves its
dependencies from `eval/tools`), `@miragon/value-chain-renderer` in `web` only (it needs a DOM;
Node cannot load it).

### Commands (repository root)

| Command | What it does |
|---|---|
| `pnpm typecheck` | `tsc` in every package |
| `pnpm lint` | ESLint (type-aware) in every package; the server also runs dependency-cruiser |
| `pnpm test` | vitest in every package (server integration and CLI e2e tests need Docker; `@analyzr/procedures` checks that `plugins/analyzr` is generated from the current procedure), `node --test` in eval/tools |
| `pnpm format` / `pnpm format:check` | Prettier over the workspace (`.prettierignore` keeps eval, Markdown, snapshots and generated files out) |
| `pnpm build` | builds the web UI (`apps/web/dist`) |
| `pnpm notices` | regenerates `THIRD-PARTY-NOTICES.md` from `pnpm licenses list --prod --json` (`tools/notices`): every production dependency with its license text, plus the build tools whose code the web bundle contains (`BUNDLED_BUILD_TOOLS` in `tools/notices/src/notices.ts`: rolldown, tailwindcss and vite, devDependencies of `@analyzr/web`, from `pnpm licenses list --json --filter @analyzr/web`; add a tool there when another one injects code into `apps/web/dist`); run it after every dependency change, since a test in `pnpm test` fails while the file is stale |
| `pnpm eval:candidates` | the LLM-free eval gate; writes `eval/reports/candidates.{md,json}`, exit 1 if a gate fails |
| `pnpm eval:replay` | scores the recordings in `eval/recordings` against `expected.yaml` and evaluates the live gate; writes `eval/reports/replay.{md,json}`, exit 1 only for an unreadable recording, whatever the gate says, 2 on a usage error (an unknown option, a named `--recordings` directory that does not exist) ([below](#simulation-agent-and-evalreplay-m2)) |
| `pnpm eval:live --project <key> [--landscape <name>] [--url] [--token] [--agent] [--out] [--corpus] [--no-write] [--json]` | records a live run from the project's stored submissions in `eval/recordings/<procedure>@<version>/<token name>/<llmModel>/<landscape>.jsonl`, scores it and checks the live gate; token: the run's agent token or the owner key (`ANALYZR_TOKEN`); exit 1 when a gate fails or on a runtime error, 2 on a usage error ([below](#live-runs-evallive-and-the-live-gate-m3)) |
| `pnpm eval:placements [--out <dir>] [--no-write] [landscape…]` | the LLM-free placement eval (M4 §6): per scored landscape the validator, golden placements = process facts, every key-tier rule proposal a must or may; scores the rule tier and `baseline-prefix/1` (with and without votes); writes `eval/reports/placements.{md,json}` (the holdout as numbers only); exit 1 if a gate fails or golden data cannot be read, 2 on a usage error or a validator that cannot run ([below](#value-chain-and-placements-m4)) |
| `pnpm eval:descriptive [--out <dir>] [--no-write] [landscape…]` | M6 §3.11: five cumulative, deterministic transforms of every scored landscape's models (`engine-stripped`, `descriptive`, `pools`, `tasks`, `no-docs`), each scored like `eval:candidates`: must_link coverage among rules ∪ candidates, within key/lexical and within the rule tier, rule-tier acceptances and their precision, acceptances under decision 24.2, candidate volume, estimated claim input size against 100 KB, findings, per relation type; writes `eval/reports/descriptive.{md,json}` (the holdout in aggregate only); report only: exit 1 when a transform fails or yields BPMN the extractor warns about, 2 on a usage error ([eval/README.md](../eval/README.md)) |
| `pnpm agent-sim [options]` | the simulation agent `analyzr-agent-sim` from the checkout (`ANALYZR_URL`, `ANALYZR_TOKEN`; `--help`) |
| `pnpm --filter @analyzr/eval-tools check` / `validate:all` / `test` | the corpus: models in sync with their specs, full validation of every landscape, the toolchain tests |
| `node eval/value-chains/validate-value-chains.mjs [--builtin] [<landscape> ...]` | validates the golden value chains (M4) with `@miragon/value-chain-schema-model` from npm, as `eval/tools` pins it, plus the built-in cross-check; `--builtin` uses the built-in copy alone, `--help` prints the usage; exit 1 on a finding, 2 when it cannot run as configured (failed import, stale install, unverified version) ([eval/value-chains/README.md](../eval/value-chains/README.md#validation)) |
| `pnpm docker:up` | the whole Compose stack (PostgreSQL + analyzr on 127.0.0.1:7400), built fresh |
| `pnpm db:up` / `pnpm db:down` | only PostgreSQL up (for `pnpm dev`) / the whole stack down (volumes stay) |
| `pnpm db:migrate` | applies migrations to `DATABASE_URL` |
| `pnpm dev` | server (`node --watch`, 127.0.0.1:7400) and Vite (127.0.0.1:7401) in parallel |
| `pnpm seed` | `analyzr seed`: one project per scored eval landscape; `pnpm seed --value-chains` also creates each golden value chain; `pnpm seed <landscape> --project <key> --issue-tokens --token-name <run>` seeds a fresh project for a live run ([below](#the-analyzr-cli)) |
| `pnpm analyzr <command>` | the `analyzr` CLI from the checkout; relative paths resolve against the directory you run it in |
| `ANALYZR_LIVE_URL=http://127.0.0.1:7400 pnpm --filter @analyzr/cli test:live` | live check of a running, seeded analyzr: tokens, MCP over HTTP, the stdio bridge as Claude Desktop starts it (see [Tests](#tests)) |
| `pnpm --filter @analyzr/web e2e smoke` | Playwright smoke test against a running analyzr (`ANALYZR_E2E_URL`, default http://127.0.0.1:7400); creates its own project `e2e-<time>` |
| `pnpm --filter @analyzr/web e2e review` | Playwright review flow (M2) against a running analyzr; creates its own project `review-<time>` from `nordwind-handel` and an agent token, proposes over REST, then reviews in the browser |
| `pnpm --filter @analyzr/web e2e pipeline` | Playwright pipeline flow (M2) against a running analyzr: its own project `pipeline-<time>` from `nordwind-handel`, worked by `analyzr-agent-sim` over MCP, reviewed in the browser, then a re-upload and the agent's second run (decision memory) |
| `pnpm --filter @analyzr/web e2e value-chain.spec` | Playwright value chain flow (M4 S3) against a running analyzr: its own projects `vc-<time>` (nordwind-handel with its golden chain), `vc-empty-<time>` and `vc-sketch-<time>`, an agent token, placements over REST, then the page in the browser incl. the CSS check |
| `ANALYZR_E2E_URL=http://127.0.0.1:<port> pnpm --filter @analyzr/web e2e ui-load` | the UI load guard (UX-SIMPLIFICATION.md §7) against an agent-owned stack: `nordwind-handel` seeded with its chain and worked by the simulation agent, `signavio-beispiel` from the CLI's bundle import and an empty project (made here when the stack lacks them; an existing one is used as it is, so on a stack seeded with `analyzr seed`, whose `nordwind-handel` has neither the chain nor the agent's work, set `ANALYZR_UI_LOAD_NORDWIND=<another key>` and the guard makes that project; `ANALYZR_UI_LOAD_SIGNAVIO`, `…_EMPTY` and `…_HOLDS` name the others), at 1440x900 and 390x844; the slices' load budgets, tasks, consistency of every count, no ids in visible text; `ANALYZR_UI_LOAD_REPORT=<file>` writes every screen's measurements |
| `pnpm --filter @analyzr/web e2e value-chain-import` | the renderer's import check in Chromium on a Vite-served harness page (no analyzr server): the golden dev chain and synthetic chains import without warnings with the layouter's waypoints, analyzr's ids never repeat; `ANALYZR_E2E_VC_EXTRA=<path>` checks another chain (counts only) |
| `pnpm --filter @analyzr/web e2e spec-render-import` | M6 S3c step 1: what `analyzr-spec` renders, imported into bpmn-js's `NavigatedViewer` in Chromium on a Vite-served harness page (no analyzr server): every golden of `tools/integrate/test/fixtures/spec/` and 50 seeded random renders without a warning or an error, every drawable element drawn (counts only; no option for other folders) |
| `ANALYZR_SCREENSHOTS_DIR=$PWD/docs/screenshots pnpm --filter @analyzr/web e2e screenshots` | retakes the M1 screenshots from a running, seeded analyzr; with `… e2e review` the `m2-*.png`, with `… e2e value-chain.spec` the `m4-01` … `m4-08`, with `… e2e value-chain-draft value-chain-agent` the `m4-12` … `m4-14` |
| `docker compose -p analyzr-demo -f docker/compose.demo.yaml up -d --build --wait` | the read-only demo image with its seed on http://127.0.0.1:7480 ([Demo deployment](#demo-deployment-flyio)) |
| `pnpm --filter @analyzr/demo check --url <demo> [--wait <s>] [--json]` | checks a running demo from outside: health, both landscapes as a viewer with agent proposals, questions, no-links and placements, every write route 403 `demo-readonly`, MCP 404, credentials 401; exit 1 on a failure. Writes nothing to a server that is not a read-only demo (only `GET /health`, then the failure „not a read-only demo“) |
| `ANALYZR_E2E_URL=http://127.0.0.1:7480 pnpm --filter @analyzr/web e2e demo` | Playwright walk through the demo's read views; fails on any write request, API error or write action shown (skips on a non-demo server) |
| `pnpm --filter @analyzr/client generate` | regenerates `packages/client` after a contracts change |
| `pnpm --filter @analyzr/procedures generate` | writes one skill per released pipeline procedure (`plugins/analyzr/skills/relations/SKILL.md` from `relations.md`, `plugins/analyzr/skills/placements/SKILL.md` from `placements.md`) and `PLUGIN_VERSION` into `plugins/analyzr/.claude-plugin/plugin.json`; run it after every change of a procedure or a wrapper and commit the result ([Conventions](#conventions)) |
| `pnpm --filter @analyzr/integrate generate` | bundles `tools/integrate/src/cli/{inspect,normalize-bpmn,analyzr-read}.ts` with rolldown into the self-contained `plugins/analyzr-integrate/scripts/{inspect,normalize-bpmn,analyzr-read}.mjs` and writes the plugin's `THIRD-PARTY-NOTICES.md`; run it after every change of `tools/integrate/src` or of a bundled dependency and commit the result (the drift test fails until they match), and move the plugin version ([below](#the-integrate-plugin-and-toolsintegrate-m6-s3b)); `src/cli/analyzr-spec.ts` and `src/spec/` (M6 S3c step 1) and `src/cli/analyzr-convert.ts` (step 2) are in no entry until plugin 0.1.4, so a change there leaves the plugin unchanged (run them from source: `node tools/integrate/src/cli/analyzr-spec.ts`, `node tools/integrate/src/cli/analyzr-convert.ts`) |
| `pnpm --filter @analyzr/server db:generate` | writes the next migration after a schema change |

### Server configuration

| Variable | Default | |
|---|---|---|
| `ANALYZR_PORT` | `7400` | |
| `ANALYZR_HOST` | `127.0.0.1` | local mode refuses to start on a non-loopback address unless `ANALYZR_ALLOW_NON_LOOPBACK=1` |
| `ANALYZR_ALLOW_NON_LOOPBACK` | `0` | `1` lets local mode bind e.g. `0.0.0.0` (with a warning at start): only inside a container whose port is published on 127.0.0.1; compose sets it, the image does not |
| `DATABASE_URL` | `postgres://analyzr:analyzr@127.0.0.1:55432/analyzr` | the compose database |
| `ANALYZR_AUTH` | `local` | the only mode in v1 (CONCEPT §6) |
| `ANALYZR_WEB_DIST` | `apps/web/dist` if built | empty string disables UI serving |
| `ANALYZR_MIGRATE` | `auto` | `off` skips migrations at startup |
| `ANALYZR_ORIGIN_PORTS` | `ANALYZR_PORT,7401` | ports a localhost `Origin` may use; compose sets `ANALYZR_HOST_PORT,7401` |
| `ANALYZR_SESSION_SECRET` | random per process | key of the session cookie (≥ 32 characters); without it a restart ends every session (the UI reopens its session by itself) |
| `ANALYZR_OWNER_KEY_FILE` | `$XDG_STATE_HOME/analyzr/owner-key`, else `~/.local/state/analyzr/owner-key` | the CLI's owner key, created on first start; `/var/lib/analyzr/owner-key` in the image; empty string: no owner key |
| `ANALYZR_DEMO` | unset | `readonly`: the public read-only demo ([Demo deployment](#demo-deployment-flyio)); needs `ANALYZR_PUBLIC_ORIGIN` and a read-only database role; refused with an owner key file, `ANALYZR_ORIGIN_PORTS`, `ANALYZR_ALLOW_NON_LOOPBACK=1` or `ANALYZR_MIGRATE=auto` |
| `ANALYZR_PUBLIC_ORIGIN` | unset | the demo's public origins (comma-separated `https://host[:port]`, `http://` on loopback only); refused without `ANALYZR_DEMO`, so local mode can never be opened by it |
| `ANALYZR_DEMO_IMPRINT_URL`, `ANALYZR_DEMO_PRIVACY_URL` | unset | optional, demo only: the operator's legal notice and privacy policy, absolute `https://` URLs (no user name or password, at most 2048 characters, normalized); `/health` reports them as `imprintUrl` and `privacyUrl` and the banner links them; refused without `ANALYZR_DEMO` and when malformed |

`docker/compose.yaml` reads `ANALYZR_HOST_PORT` (default `7400`) and `ANALYZR_DB_PORT` (default
`55432`) for the published ports, and sets `ANALYZR_CONTAINER=analyzr-server-1`, so `analyzr token create`
in the container prints the `docker exec` entry for Claude Desktop.

Local mode rejects any request whose `Host` is not `localhost`, `127.0.0.1` or `[::1]`, or whose
`Origin` is not one of those hosts on a `ANALYZR_ORIGIN_PORTS` port (403 `forbidden`), on REST, MCP
and the UI alike. The Host check keeps browsers (DNS rebinding) out, not other machines: a
non-browser client sets any `Host`, so the bind address is the boundary, and local mode binds
loopback only (`ANALYZR_ALLOW_NON_LOOPBACK`).

Every response carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy` and `Cross-Origin-Opener-Policy`
`same-origin`, and a CSP: the web UI gets `script-src 'self'` (no inline or foreign scripts) and
`frame-ancestors 'none'`; REST, MCP and `/health` get `default-src 'none'; frame-ancestors
'none'; sandbox`. Uploaded BPMN is stored verbatim and may hold anything (an XHTML `<script>` in
`extensionElements`, for instance); `GET …/revisions/{r}/content` therefore answers with
`Content-Disposition: attachment` under that sandbox CSP, so a browser downloads it instead of
running it on the analyzr origin with the owner's session.

### Local mode: who is calling (CONCEPT §6)

Local mode has one human, the **owner**, and any number of **agent tokens**.

- **Owner session.** `POST /api/v1/session` (body optional: `{"client": "analyzr-web" | "analyzr-cli"}`)
  sets the cookie `analyzr_session` (HttpOnly, SameSite=Strict, Path=/, 12 h, no `Secure` because
  local mode is plain http). The value is `v1.<client>.<issued-at>.<nonce>.<HMAC-SHA256>`; it
  names no user, because local mode has exactly one. Requests with a valid cookie act as the
  owner on that interactive client (a human: all scopes, owner of the projects it creates).
  `DELETE /api/v1/session` clears it. The web UI calls `POST /api/v1/session` on start and
  again after a 401 (the Vite dev server shares the cookie, since cookies ignore ports). The
  endpoint is open to any client on localhost — that is the trust model of local mode (CONCEPT
  §6 "Remaining risk: an agent driving the user's browser or CLI"); the Host/Origin guard keeps
  websites and DNS rebinding out.
- **Owner key** (the CLI's bootstrap credential, `Authorization: Bearer analyzr_ok_…`, REST only).
  On its first start the server creates `ANALYZR_OWNER_KEY_FILE`: directory mode 0700, file created
  exclusively with mode 0600, content `analyzr_ok_` + 43 base64url characters (256 random bits).
  An existing file is used only if it is a regular file of the server's OS user that group and
  others cannot access (like an ssh key); otherwise the server refuses to start and names the
  `chmod`. The key is never logged (the log names the file), never stored in the database, and
  compared in constant time against its sha256 in memory. The `analyzr` CLI on the same machine
  reads the same file (same checks) and acts as the owner on the interactive client `analyzr-cli`:
  `seed`, `import --create` and `token …` need it. MCP never accepts it, and the CLI refuses it
  as `--token`/`ANALYZR_TOKEN`. Rotate it by deleting the file and restarting the server. With
  Docker, run the CLI in the container (`docker compose -p analyzr -f docker/compose.yaml exec server
  analyzr …`), or copy the key to the host with a private umask and point the CLI at it:
  ```sh
  mkdir -p ~/.local/state/analyzr
  (umask 077; docker compose -p analyzr -f docker/compose.yaml exec -T server cat /var/lib/analyzr/owner-key \
    > ~/.local/state/analyzr/docker-owner-key)
  ANALYZR_OWNER_KEY_FILE=~/.local/state/analyzr/docker-owner-key pnpm seed
  ```
  Why a file and not the open session endpoint: the key binds owner rights to the OS account
  that started the server (other local accounts cannot read it), and it lets the session
  endpoint be closed later without touching the CLI. Until the web UI has a login step, that
  endpoint stays open, so on a shared multi-user machine local mode is not yet a boundary
  between OS accounts; the next step is a one-time login link for the browser (printed by the
  CLI, signed with the owner key) and a switch that closes `POST /api/v1/session` otherwise.
- **Agent tokens** (`Authorization: Bearer analyzr_at_…`): created by the owner on an interactive
  client (`POST /api/v1/projects/{p}/agent-tokens`, secret shown once), stored as sha256 plus an
  8-character prefix; one project, scopes `analyzr:read`/`analyzr:propose`/`analyzr:write` (never
  review), expiry 1–365 days (default 90), revocation, `last_used_at` (written at most once a
  minute). A token acts as `editor` (`viewer` if read-only) in its project; any other project
  is 404. A bearer header always wins over the cookie; an invalid token is 401
  `error="invalid_token"`. MCP accepts agent tokens only.
- Without credentials every contract route answers 401 with `WWW-Authenticate: Bearer`, except
  `/health`, `/api/v1/openapi.json` and `/api/v1/session`.
- The read-only demo (`ANALYZR_DEMO=readonly`) is a variant of this mode: the session is the viewer
  `visitor` instead of the owner, every write answers 403 `demo-readonly`, MCP 404 and any
  credential 401 ([Demo deployment](#demo-deployment-flyio)). Without `ANALYZR_DEMO` nothing of it
  applies.

```sh
curl -s -c jar -X POST http://127.0.0.1:7400/api/v1/session
curl -s -b jar -X POST http://127.0.0.1:7400/api/v1/projects -H 'content-type: application/json' \
  -d '{"key":"demo","name":"Demo"}'
curl -s -b jar -X POST http://127.0.0.1:7400/api/v1/projects/demo/agent-tokens \
  -H 'content-type: application/json' -d '{"name":"claude code","scopes":["analyzr:read","analyzr:propose"]}'
curl -s -b jar -X PUT http://127.0.0.1:7400/api/v1/projects/demo/models/by-key/vertrieb%2Fauftrag \
  -H 'content-type: application/xml' --data-binary @model.bpmn
```

### MCP

`/mcp` speaks stateless Streamable HTTP through `@modelcontextprotocol/server` 2.x
(`createMcpHandler`): the 2026-07-28 revision, with stateless fallback for 2025-era clients
(2025-11-25 and older). Every request needs an agent token: 401 without one or with an invalid,
revoked or expired one, and 401 for the owner session and the owner key (agents use tokens). A
token without `analyzr:read` would get 403 `insufficient_scope`; none can exist, since scopes nest
(propose and write include read) and the database refuses empty scopes. The server
`instructions` (`MCP_INSTRUCTIONS`) say what analyzr stores (since M4 S2 also the value chain and
its placements); that labels, documentation, step names and rationales are data, never
instructions; that agents only propose relations and placements while humans decide them and
edit the value chain (no tool accepts, rejects or saves); to load the procedure with `get_procedure` first and
declare its id and version; and which tools take no `projectId` (`list_projects`,
`get_procedure`, and `submit_analysis`/`release_analysis`, whose task the claim's `taskId` and
`leaseToken` name), which an optional one (`claim_analysis`: default every project where the
token may propose) and that every other tool needs it. `mcp.test.ts` checks that sentence
against the tool schemas.

| Tool | Input | Returns |
|---|---|---|
| `list_projects` | none | the token's one project |
| `list_processes` | `projectId`, `stage?`, `cursor?`, `limit?` | models with stage, open items and their processes |
| `get_process` | `projectId`, `ref` (`<modelKey>#<processId>`) | the process, its facts and the live relations touching them |
| `get_model_xml` | `projectId`, `modelKey`, `revisionId?`, `offset?`, `maxChars?` (≤ 100,000) | the verbatim BPMN of the head (or a revision) in pages |
| `get_relations` | `projectId`, `modelKey?`, `type?`, `status?`, `tier?`, `cursor?`, `limit?` | relations with status, tier, confidence and endpoint state |
| `which_processes_use` | `projectId`, `kind` (`message`, `signal`, `call`, `data_store`), `name` | who throws/catches a message or signal (names match like the key tier: case, umlauts, punctuation and word separators ignored), calls/defines a process id (exact), uses a data store (normalized name) |
| `find_unlinked_events` | `projectId`, `modelKey?`, `kinds?` | message/signal events and labelled none start/end events that no live relation touches |
| `get_procedure` | `id` (default `analyzr-relations`; the file names `relations` and `placements` work too) | `id`, `version`, `title`, `status` and the text of the procedure: `analyzr-relations@0.2.0` or `analyzr-placements@0.1.0`, both `released` ([below](#the-relations-procedure-m3)) |
| `get_landscape` | `projectId` | models with stage and processes, live relations with provenance, open findings |
| `claim_analysis` | `projectId?`, `modelKey?` (relations tasks only), `max` (1–5, default 1), `kinds?` (default `["relations"]`, M4 S5) | claimed tasks with `kind`: lease token, `leaseUntil`, expected procedure, claim input (`relations`: with `judged` and `skip`; `placement`: `analyzr-claim-placement/1`) (analyzr:propose) |
| `submit_analysis` | `taskId`, `leaseToken`, `submissionId` (UUID), `procedure`, `llmModel?`, `relations?` (≤ 200, default `[]`), `noLinks?` (≤ 500, `{type?, from, to, reason}`; the procedure always sends `type`), `placements?` (≤ 200), `unsure?` (≤ 200, `{process, reason}`), `summary?`, `costUsd?` | relations: the result per item and per no-link, `withdrawn`, `withdrawnNoLinks`, `uncovered`; placement: `kind`, per placement and unsure item, `withdrawn`, `skipped`, `followUp` (a flat superset object); a field of the other kind is `wrong-task-kind` (analyzr:propose) |
| `release_analysis` | `taskId`, `leaseToken`, `reason?` | `{taskId, state: queued}` |
| `propose_relation` | `projectId`, `type` (not `manual`), `from`, `to`, `confidence`, `rationale`, `evidence?`, `question?`, `procedure?`, `llmModel?` | `{result, relation}`; an invalid pair is the problem `validation-failed` with `reason` |
| `withdraw_proposal` | `projectId`, `relationId` | the relation after withdrawing the caller's own live proposal (a pipeline proposal queues both endpoint models again) |
| `decide_relation` | `projectId`, `relationId`, `verdict` | never succeeds: `human-decision-required` with `reviewUrl` (agents only propose) |
| `get_value_chain` (M4) | `projectId` | `ValueChainDetail`: steps (kind, depth, rank, path, sub-steps, owners, link, placement counts), org units, every non-obsolete placement (also on removed steps, `stepLive: false`), the findings and, since S5, `pipeline` (stage, task, due, unsure counts) and `unsure`; `not-found` while the project has no chain |
| `get_value_chain_document` (M4) | `projectId`, `rev?`, `offset?`, `maxChars?` (≤ 100,000) | the canonical `.vc.json` of the head (or a revision) in pages, with `revisionId`, `rev`, `contentHash`, `totalChars`, `nextOffset` |
| `list_unplaced_processes` (M4) | `projectId`, `cursor?`, `limit?` (≤ 200, default 50) | head processes without an accepted, held or `proposed` placement on a live step: name, model key, lanes, ≤ 5 start and end labels, documentation (≤ 200), relation neighbours with their accepted steps, calls both ways, the top 3 `baseline-prefix/1` hints, and since S5 `judged` (an agent's verdict on the current input: skip it) and `inTask` (in the input of the placement task an agent holds right now: skip it) |
| `propose_placement` (M4) | `projectId`, `procedure?`, `llmModel?`, `placements` (1–200 items `{step, process, confidence, rationale, evidence?, question?}`) | per item `applied`, `duplicate`, `suppressed`, `reopened` or `invalid:<reason>`, with counts (analyzr:propose); the server computes the tier |
| `withdraw_placement_proposal` (M4) | `projectId`, `placementId` | the placement after withdrawing the caller's own live proposal (409 `conflict` without one) |
| `decide_placement` (M4) | `projectId`, `placementId`, `verdict` | never succeeds: `human-decision-required` with the value chain `reviewUrl` |

The read tools carry `readOnlyHint`; the pipeline and proposal tools `readOnlyHint: false`,
`destructiveHint: false`. Every tool declares `_meta` `anthropic/maxResultSizeChars: 500000`
(`MAX_RESULT_SIZE_CHARS`, checked by `mcp-contract.test.ts`): Claude Code otherwise saves a result
above 50,000 characters to a file and shows the model only its path, which an agent without
built-in tools cannot read, and claim inputs reach about 90 KB; other clients ignore the key.
`examples/agents/claude-code` also sets `MAX_MCP_OUTPUT_TOKENS=100000` for Claude Code builds that
do not read it. The prompt `work_pipeline` takes `projectId?`, `maxTasks?` (a string, as
prompt arguments are: a whole number from 1 to 100 without a leading zero; anything
else is refused with "must be a whole number from 1 to 100") and, since M4 S5, `kind?`
(`relations`, the default with the released text exactly, or `placement`, which renders
`analyzr-placements` with `kinds: ["placement"]` in its claims; last, so positional clients keep
`<projectId> <maxTasks>`). The prompts `place_processes({projectId})` (the placements procedure
wrapped for ad-hoc work with `list_unplaced_processes` and `propose_placement`) and
`draft_value_chain({projectId})` (a `.vc.json` draft for a human to import) came with S5
([placements](#the-placement-pipeline-and-analyzr-placements-m4-s5)). Its text is
`renderPipelineWrapper` of `@analyzr/procedures`, the same as the Claude Code skill's: the scope
(the project, at most `maxTasks` tasks, `claim_analysis({projectId, max: 1})`, when to stop),
the exact model id as `llmModel`, `release_analysis` instead of an expiring lease,
`get_procedure` again after the context was summarized, then the procedure verbatim, which
carries the loop ([The relations procedure](#the-relations-procedure-m3)). `prompts/list` is the
snapshot `__snapshots__/mcp-prompts.json`. `projectId` is a `prj_` id or the project key
(validated by pattern, like REST `{project}`). Domain errors come back as tool errors whose text is the RFC
9457 problem (`not-found`, 404, also for another project's key or ids); invalid arguments come
back as tool errors naming the validation failure; any other error is logged on the server and
comes back as the problem `internal`, never with its message (a failed query would carry SQL).
The complete `tools/list` (descriptions and JSON schemas) is the snapshot
`apps/server/test/integration/__snapshots__/mcp-tools.json`. Output schemas have a plain object
root: a named contract schema would serialize as a `$ref` root, which the SDK wraps as
`{ result: … }`. Input schemas use `$defs`/`$ref` for the shared contract types (model key, ref,
enums), never at the root: `claim_analysis` had a root `$ref` (the named `ClaimAnalysisBody`),
which hid `projectId`, `modelKey` and `max` from clients that read only `properties`; it is a
plain object now, and `mcp.test.ts` forbids a root `$ref` on every input schema. Schemas use
standard JSON Schema only (`pattern`, the formats `date-time` and `uuid`;
the contract test checks it): zod's `.startsWith()` would emit `format: "starts_with"`, which
every SDK client reports on stderr, so the lease token is a `pattern`.

`analyzr mcp` (the stdio bridge) relays JSON-RPC unchanged between stdio (`StdioServerTransport`)
and `ANALYZR_URL/mcp` (`StreamableHTTPClientTransport` with `Authorization: Bearer $ANALYZR_TOKEN`),
both from the official SDK 2.x. For 2025-era clients it forwards the version negotiated by
`initialize` as `MCP-Protocol-Version`. stdout carries only the protocol; it exits when the
client closes stdin.

### Analysis pipeline and review (M2)

Backend of [M2-PIPELINE-REVIEW.md](M2-PIPELINE-REVIEW.md) items 1–6 (CONCEPT §2, §3, §5). REST
routes are in the contracts (`packages/contracts/src/api/{analyses,review}.ts`, OpenAPI tags
`analyses` and `review`); MCP tools [above](#mcp). Domain: `src/domain/use-cases/{analyses,review}.ts`,
`proposals.ts` (per-item checks and the one write path of submissions and ad-hoc proposals),
`claim-input.ts`, `lease.ts`, `status.ts` (`recomputeStatus`, `classifyProposal`, both pure),
`relation-state.ts`, `findings.ts`, and since 0.2.0 `judgements.ts` (basis, currency, `planClaim`;
pure) and `no-links.ts` (no-link checks and withdrawal).

| Route | |
|---|---|
| `POST /api/v1/analyses/claim` `{projectId?, modelKey?, max ≤ 5}` | claims queued tasks and expired leases with attempts left, oldest first, in the projects where the caller may propose (`analyzr:propose`, editor or better) |
| `GET /api/v1/analyses/pending?projectId=&wait=0..30` | claimable tasks per project; `wait` long-polls |
| `POST /api/v1/analyses/{a}/submission`, `…/release` | submit (≤ 1 MB) or hand back a claimed task |
| `GET/POST /api/v1/projects/{p}/analyses[/requeue]`, `GET …/analyses/{a}/submission` | tasks newest first; requeue `{modelKeys}` or `{all: true}` (`analyzr:write`); the stored submission |
| `POST /api/v1/projects/{p}/relations`, `DELETE …/relations/{rel}/proposal` | ad-hoc proposal (or, for humans, an accepted `manual` relation); withdraw the caller's own proposal |
| `POST …/relations/{rel}/decision`, `POST …/decisions`, `POST …/relations/{rel}/notes`, `GET …/relations/{rel}/assertions` | decide (owner on an interactive client), bulk decide, note, timeline |

**Claim and lease.** The claim is one transaction: it locks the projects (writers always lock the
project row first, so claims cannot deadlock with ingest), turns claimed tasks whose lease expired
at attempt 3 into `failed` (`analysis.failed`; nothing runs on a timer, so the pending count and a
requeue do the same, and a model never stays "agent working" with a dead lease once an agent asks
for work or the owner requeues), and claims with one `UPDATE … WHERE id IN (SELECT …
ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT n)`, which sets the 15-minute lease and
`attempts + 1`. Each task then gets a lease token `analyzr_lt_` + 256 random bits (base64url), shown
once and stored as `sha256(taskId|principalId|token)`, and `claimed_seq`, the seq of its
`analysis.claimed` event. The inputs are rendered in the same transaction, under the project lock,
so each input shows exactly the state at its `claimed_seq`, and each task stores its assignment
([judge each pair once](#judge-each-pair-once)); the tasks of one call are planned in order, so a
later one sees the earlier ones' assignments. If rendering fails, the tasks are handed back at
once. A release queues the task again, gives the attempt back and clears its assignment. Submit
and release need the holder's token and principal: another holder, a release or a wrong token
answer 409 `lease-lost`, a new revision with other facts 409 `task-cancelled`; a late submit passes
while nobody claimed the task again or cancelled it, also after it failed, unless a newer task of
the model exists or the model changed or was deleted since the failure (409 `task-cancelled`: the
stale analysis would otherwise supersede the newer one). A requeue queues a new task for every model
without an open one; a claimed task whose lease expired is not open (cancelled, "lease expired;
requeued"). A done task answers its own `submissionId` with the stored result
(`replayed: true`) and any other with 409 `already-submitted`. Clock: the server clock
(`deps.clock`), so tests advance leases without waiting.

**Claim input** (`analyzr-claim/1`, schema `ClaimInput` in the contracts): the model (key, name,
revision, engine, processes), its head facts with default fields left out and documentation cut
to 300 characters (`CLAIM_DOC_CHARS`), the candidates of `generateCandidates` around the model as
`[type, from, to, basis, score]` tuples (since 0.2.0 without the pairs listed in `judged` or
`skip`, so they are the pairs left to judge, the `compatible` search space and the pairs a
decision settles), the partner endpoints they name (keyed by ref), and the non-obsolete relations
touching the model with the human decision (reason, hold note, question, label), an agent's open
question and the notes, sorted by type, `from` and `to` since owner decision 27 (before, they came
in the database's physical row order, which updates and vacuum move). M3 added four optional parts and judge each pair once two more, so older
inputs still parse and the format stays `analyzr-claim/1`:

- `message_flow` facts carry `from` and `to`: the refs of the element or pool (participant) at
  each end inside the file (`attrs.sourceRef`/`targetRef`). Such a pair is never a relation
  (`invalid:message-flow`); it shows which endpoints a collaboration already connects.
- Partner endpoints carry `doc`, their documentation cut to 300 characters.
- `partnerProcesses`: for every process a partner endpoint belongs to, keyed by process ref, its
  `name` (the process name, else the pool name) and `doc` (cut likewise), sorted by ref; left
  out without partners.
- `findings`: the project's findings as `GET …/findings` lists them (`visibleFindings`, so
  answered `dangling-throw`/`unmatched-catch` are hidden) with at least one ref in the model,
  sorted by kind, refs and detail; left out when there are none. The claim loads them once per
  project inside its transaction; `renderClaimInput` stays pure.
- `judged` (0.2.0): every current agent judgement on a pair touching the model, any origin and
  principal, the claimant's own included: a link verdict as `{relation, origin, by, mine?}`
  (type, refs, confidence and question are in `relations`), a no-link as `{type, from, to,
  origin, by, mine?, reason}` with the reason cut to 120 characters (`CLAIM_REASON_CHARS`);
  `origin` is the model whose analysis judged, `by` the principal's handle, `mine` marks the
  claimant's own. Sorted by pair, then kind, origin, handle and id; left out when empty.
- `skip` (0.2.0): `{type, from, to, model, reason}`, the candidate pairs a partner model's task
  judges (`claimed` or `queued`); sorted by pair; left out when empty.

On the eval corpus, with every task claimed at once (so later claims list in `skip` what earlier
ones were assigned), the largest input is 82.0 KB on `nordwind-handel` (`vertrieb/order-handling`,
251 candidates, 105 partners) and 75.5 KB on `stadtwerke-auental`, the mean 40.6 KB and 48.6 KB
(before M3: 68.7 KB at most, mean 34–41 KB; with M3 before 0.2.0: 80.1 and 74.8 KB). Seeded with
LLM-sized judgements (every other model's task first judges its open `key` and `lexical`
candidates and ten `compatible` ones, with 400-character rationales and reasons beyond the cut),
the input of `vertrieb/order-handling` is 92.9 KB, with 5 link verdicts and 66 no-links in
`judged`; in the simulation agent's sequential run it is at most 86.7 KB (88,775 bytes, mean
41.2 KB on `nordwind-handel`). Judged and skipped pairs stay out of `candidates`: while they also
stayed there, the input crossed 100 KB in both measured cases. `claim-input-size.test.ts` measures
every model of both landscapes and the seeded case, requires < 100 KB, and checks the M3 additions
on the whole corpus: message-flow ends in the model, `partnerProcesses` exactly the partners'
processes, findings touching the model, and every addition present in each landscape;
`agent-sim.test.ts` requires < 100 KB for every input the simulation agent records.

**Submissions.** At most 1 MB (`MAX_SUBMISSION_BYTES`), on REST (body limit, 413) and on MCP alike
(`submit_analysis` answers `payload-too-large`; the MCP endpoint refuses any request over 1 MB +
16 KB, instead of the SDK's 4 MiB default). The body is checked for shape only (≤ 200 relations,
declared procedure and LLM model without control characters, ≤ 500 no-links, 422 otherwise);
each relation item is then checked in this order and answered `invalid:<reason>` if it fails:
`type-not-allowed` (`manual`), `malformed-ref`, `confidence-out-of-range`, `rationale-too-long` (>
1,000), `question-too-long` (> 500), `too-much-evidence` (> 20), `control-characters` (rationale,
question or evidence with a control character other than tab and line breaks; PostgreSQL cannot
store U+0000), `outside-task-model` (neither end in the
task's model), `unknown-ref` (not a head fact), `type-mismatch` (the ends cannot take those sides,
`endpointRole`), `same-process`, `message-flow`. Valid items are `applied`, `duplicate` (the
caller's identical live proposal, for a pipeline item one from an earlier submission with the same
basis and procedure; a rule acceptance with the same fingerprints; or an earlier item of the same
submission), `suppressed` (the status rests on a human decision with the same endpoint
fingerprints; nothing is recorded; a pipeline proposal under a human hold is the exception: it is
the agent's judgement on the held pair, recorded as `applied` unless it repeats its own on the same
basis, `duplicate`, while the hold stays in force) or `reopened` (recorded, and a rejection becomes
`proposed` because an endpoint changed). The server computes the tier (`createPairAssessor` of
`@analyzr/relations`: `key`, `lexical`, `semantic`); `source_kind`, principal and client come from the
credential, procedure and LLM model are only declared; a recorded pipeline proposal stores its
basis (`relation_assertion.from_hash`, `to_hash`, [judge each pair once](#judge-each-pair-once)).

No-links are checked next, per item, in the order of `NO_LINK_INVALID_REASONS`:
`type-not-allowed` (a given type other than `call`, `message`, `signal`, `trigger`),
`malformed-ref`, `control-characters` (in the reason), `outside-task-model`, `unknown-ref`, then
the type: a given one must fit the ends (`type-mismatch`, `same-process`, `message-flow`); without
one the server takes the one type that fits (`type-required` when several do; when none does,
`same-process` or `message-flow` if a type fails only on that, else `type-mismatch`); last
`also-proposed` (the
submission also proposes the typed pair). A valid no-link is `stored` (table `no_link`, with its
basis, the declared procedure and model, and the analysed model as origin) or `duplicate` (an
earlier no-link of the submission on the typed pair, or the caller's live, current one); the result
lists the outcomes per index in `noLinks` with counts.

Supersession (judge each pair once, CONCEPT §2, §3): a submission withdraws every live agent
judgement (pipeline proposal or no-link, any principal, any origin) on a pair touching the task's
model that is stale on this model's side: its hash there differs from the task's `facts_hash` or is
missing (rows from before 0.2.0), or it was made under another procedure than claims name now.
Judgements stale only on the partner's side are left to the partner's analysis, and current ones
stay, so a requeue with unchanged facts and procedure withdraws nothing. Proposals are withdrawn
under their proposer with the new submission as reason, no-links by a withdrawal row stamped with
the `analysis.done` seq. Same principal, same origin: a valid no-link item of the caller (stored,
or `duplicate` of its current no-link from another model's analysis) replaces the caller's own
proposal on that typed pair from an earlier analysis of this model, and a new proposal or a stored
no-link replaces the caller's own no-link from there; other principals' judgements, and the
caller's from another model's analysis (one token for all models), stay beside it, so
disagreements stay visible. Rule-tier and ad-hoc proposals stay, and human decisions keep the
status (a held relation stays held). The result counts `withdrawn` and `withdrawnNoLinks`, and
`uncovered` reports the pairs of the task's stored assignment that are left without a judgement
(no valid proposal item, no stored or duplicate no-link, no live current judgement): the count and
the first 50 (`MAX_UNCOVERED_PAIRS`), also for a late submit after the task failed (failing keeps
the assignment); nothing is queued for them. A task whose claim relied on a
judgement withdrawn meanwhile (`analysis_task.requeue_after`, see revoking a token below) queues a
follow-up task for its model when it is submitted. The submission is stored with the request
as received (REST) or the parsed arguments (MCP), without the lease token and with U+0000 (which
jsonb cannot hold) as U+FFFD, plus its result
(`GET …/analyses/{a}/submission`). The assertion → submission foreign key is checked at commit
(migration 0003), so the submission row can hold the final result.

**Review.** Decisions need the `review` permission (a user on an interactive client: the owner via
the web UI or the CLI); agent tokens get 403 `human-decision-required` with `reviewUrl`
(`<origin>/projects/<key>/review/<relation>`, the review screen of the M2 web UI) on REST and from
the MCP stub `decide_relation`. `accept` (optional note), `reject` (reason), `hold` (note, optional
question and label: status `held`, an open item; a model whose only open items are held is
`waiting_for_clarification`), `correct` (rejects the relation and accepts another pair as a
`manual` relation, both assertions linked through `linkedRelationId`). `version` in the body (409
`conflict`) or `If-Match: "<version>"` (412; `GET …/relations/{rel}` sends the ETag) make a decision
conditional. Bulk decisions send `items: [{id, version}]`, `expectedCount` and optionally `tier`;
any mismatch (count, version, tier, unknown, duplicate or obsolete) answers 409 with `mismatches`
and changes nothing. Notes (`kind = note`, humans only, also a DB check) answer held questions,
never change the status and reach the next claim input. Every relation carries `source` and
`provenance` (the assertion its status rests on: kind, verdict, source, handle, client, declared
procedure and model, tier, confidence, rationale, question, label) and, since 0.2.0, `noLinks`:
the live, current agent no-links on the same `(type, from, to)` (`{id, handle, origin, reason,
at}`, oldest first; one batched query per list, currency computed in SQL).
`GET …/no-links[?modelKey=]` lists every live, current agent no-link of the project
(`{id, type, from, to, handle, origin, reason, at}`, oldest first), also on pairs without a
relation, which `Relation.noLinks` cannot show (the inbox tab „Kein Zusammenhang“). Storing or
withdrawing a no-link moves the version of the relation on its pair, and so does a new head
`facts_hash` of a model (ingest, delete) for every relation on the pair of a live no-link touching
it, since currency may flip either way (a revert makes an older no-link current again); so a bulk
decision prepared before answers 409. A procedure release only ends currency (no objection
appears) and moves nothing. `GET …/assertions` is the full timeline. Decision memory: a rejection stays
while proposals repeat the same endpoint fingerprints (`suppressed`), turns `endpointState:
changed` when an endpoint changes, and is reopened by the next proposal with the new fingerprints.
A hold stays the decision in force while agents confirm the held pair in submissions (recorded as
their judgement, so partner analyses skip it).
Stances are per principal, but a human's latest decision stays in force when the same human later
proposes the relation (working the pipeline over REST) or that proposal is withdrawn
(`decisionsInForce` in `status.ts`); only another decision replaces it. An accepted relation whose
endpoint changed is an open item; accepting it again anchors the decision on the current
fingerprints. Reasons, notes, questions, labels, rationales and evidence of decisions, notes and
ad-hoc proposals refuse control characters other than tab and line breaks (422), as does a release
reason.

**Revoking an agent token** (CONCEPT §6: "revoking a token or service withdraws its proposals")
withdraws, in the same transaction, every live proposal of the token's principal (pipeline and
ad hoc; recorded under that principal, by the revoking owner, reason "agent token … revoked") and
its live no-links (withdrawal rows stamped with the `agent_token.revoked` seq), and queues its
claimed tasks again without counting the attempt. Decisions stay, and so do other principals'
proposals on the same relations. Partner analyses may have skipped pairs because of the lost
judgements, so both endpoint models of every withdrawn pipeline proposal and no-link judge again:
a model without an open task gets a queued one (reason `judgement withdrawn`), a claimed task gets
`requeue_after` (its submit queues a follow-up), a queued task's claim sees the loss anyway.
`withdraw_proposal` (`DELETE …/relations/{rel}/proposal`) of a pipeline proposal does the same for
its two models. Let a token expire instead if its proposals should stay for review.

**Other API changes.** `Model.engine` and `Revision.engine` (`c7`/`c8`/`null`, from
`@analyzr/bpmn-facts`; migration 0003 backfills older revisions from the `<definitions>` tag);
relations created by any path return the database's `updatedAt` (`relations.insert` returns the
stored row), and a relation's `version` moves with every new assertion (since 0.2.0 also with
every stored or withdrawn no-link on its pair and with every new `facts_hash` of a model that one
of its live no-links touches), so a bulk decision on a stale view fails;
`dangling-throw`/`unmatched-catch` findings are hidden once a proposed, accepted or held relation
connects that endpoint (`GET …/findings`, the landscape).

**Long-poll.** `GET /analyses/pending?wait=` subscribes before it counts, so no wake-up is lost,
then waits at most `wait` seconds for `NOTIFY analyzr_analysis` (a trigger fires whenever a task
becomes `queued`) and counts again; expired leases are not announced, the bounded wait covers
them. One dedicated `LISTEN` connection per process (`application_name = analyzr-listen`, never a
pool connection), opened on first use, re-opened after errors, at most 200 waiters per process and
8 per caller (principal; more answer at once, so one token cannot take every slot), aborted
requests let go at once; `docker`/`pnpm dev` shutdown closes it first so waiting requests answer
immediately.

**Events.** `analysis.queued` (new head, requeue or `judgement withdrawn`), `claimed`, `released`,
`done` (with counts, `late`, and since 0.2.0 the no-link counts, `withdrawnNoLinks` and
`uncovered`), `failed`, `cancelled`; `relation.proposed`, `withdrawn`, `decided`, `noted`,
`endpoint_changed`; each with the acting principal and client and a dense `seq`.

#### Judge each pair once

The owner's requirement (2026-10-08): no work may happen twice, also with several agents. Under
`analyzr-relations@0.1.0`, every cross-model pair was judged in the tasks of both its models, because
a submission withdrew every unrepeated pipeline proposal touching its model; since `0.2.0` a pair is
judged once per change of its models (`src/domain/judgements.ts`, pure; CONCEPT §3).

- **Agent judgements** are the live pipeline proposals (proposal stances from a submission) and the
  live no-links. Rule-tier and ad-hoc proposals and human decisions are none.
- **Basis.** Each judgement records the `facts_hash` of both endpoint models as the judging agent
  saw them: the task's own model as the task analyses it, a partner as it was at the claim's
  `claimed_seq` (its head at submit if it had none then), plus the declared procedure. It is
  **current** while both hashes equal the models' heads (a deleted model has none) and the
  procedure is the one claims name now; rows from before 0.2.0 have no basis and are never current.
  A model-level hash covers documentation and message flows, so a documentation change re-judges
  the model's pairs, and a procedure release plus a requeue re-judges every pair once.
- **Assignment at the claim.** Each candidate pair of basis `rule`, `key` or `lexical`, and each
  relation touching the model whatever its pair's basis (`isAssignedRelation`: not `manual`, not
  obsolete, no missing end; a `compatible` candidate or no candidate at all), without a current
  judgement and without a settling decision (accepted, or rejected with unchanged endpoints; held
  pairs are judged, and a confirmation is recorded as a judgement while the hold stays) goes to
  exactly one analysis: (1) the partner model's claimed task, if its lease is live, its stored
  assignment holds the pair and its claim saw this model as it is now: `skip` `claimed` (also for a
  pair that is `compatible` here); (2) else the partner's queued task, if its model key sorts first
  and its own assigned pairs (candidates and relations) hold the pair: `skip` `queued`; (3) else
  this claim. Intra-model pairs always stay with the claim. The claim's pairs are stored as its
  assignment (`analysis_task.assignment`: cleared on release and cancel, kept on failure for a late
  submit's `uncovered`, replaced by a re-claim), which rule 1 and `uncovered` read. This is exactly
  procedure §4 "your pairs".
- **`compatible` candidates** that are no relation are nobody's assignment and never `uncovered`:
  they are the search space for missing partners; a verdict on one lists the pair in later claims'
  `judged`.
- **Re-analysis** is queued when the new head's facts differ from the previous head's (a revert
  too) and on a revive ([Conventions](#conventions)), and after a lost judgement (revoking a token,
  `withdraw_proposal`); every current judgement is skipped there, so it stays cheap.
- **Remaining double work:** a `compatible` pair (or one found with a tool) that two concurrent
  partner analyses both examine; re-claims after a lease expired (claims no longer skip what the
  expired lease held, so the old holder's late submission can repeat pairs judged meanwhile); and
  candidate-cap drift, where rule 2 hands a pair to a queued partner whose candidates no longer hold
  it at its own claim (a lexical top 5 moved): the pair then stays unjudged until one of its models
  changes.

### The relations procedure (M3)

`packages/procedures/relations.md` is `analyzr-relations@0.2.0`, status `released`; `0.1.0` replaced
the M2 placeholder `0.0.1`, and `0.2.0` replaced `0.1.0` before any live run to judge each pair
once. Every claim names it (`app.ts` reads id and version from `@analyzr/procedures`). The text is
self-contained, so a client that only calls `get_procedure` (Claude Desktop, Codex) can follow it:
ground rules, failure modes to avoid, the loop (one task per claim, lease and call budget,
release, reload after a summary, submission errors), the claim input with `judged` and `skip`, the
read tools, valid endpoints, a fixed work order per task, judgement rules (identical specific and
generic names, collaborations, near-misses, translation and transliteration, other words, twins
and modelling gaps, triggers, calls), confidence bands and questions, human decisions and
supersession, the submission format with typed, coded no-links, and a self-check. Its examples
are invented, so the eval landscapes stay unseen.

**Language.** Agents write `rationale`, `question`, the sentence of a no-link `reason`
(`<code>: <sentence>`, codes such as `near-miss`, `generic-name`, `no-evidence`), the `summary`
and release reasons in German, because the review UI is German; refs, element ids, message and
signal names and quoted labels stay verbatim. A per-project language setting is deferred to R1.
The simulation agent is not bound by it: `sim-policy-1` still writes English.

**Judge each pair once (0.2.0).** The rule "repeat every pair you still support" of `0.1.0` is
gone: a submission withdraws only judgements made on another version of its model or under another
procedure, and current ones stay without repetition ([Submissions](#analysis-pipeline-and-review-m2),
[judge each pair once](#judge-each-pair-once)). The procedure has agents judge their pairs (the
`rule`, `key` and `lexical` candidates and the relations listed in neither `judged` nor `skip`,
except those a decision settles), give every pair they examine a verdict, `compatible` candidates
and partner-search hits included, so a no-link for each one they reject (`type` required), leave
`judged` and `skip` pairs alone, contradict a `judged` verdict only with concrete evidence by a
judgement of their own, and keep `uncovered` at 0. A pair that fails the endpoint rules gets no
no-link (the code `invalid-endpoint` is gone); reviewers now see no-links on the relation.

**Delivery.** One text, three ways:

| Way | Where | Adds |
|---|---|---|
| MCP tool `get_procedure` | every client; the server instructions say to load it first | nothing |
| MCP prompt `work_pipeline` (`projectId?`, `maxTasks?`) | clients that offer prompts; Claude Code: `/analyzr:work_pipeline`, `/mcp__analyzr__work_pipeline <projectId> <maxTasks>` | the wrapper with the given scope |
| Skill `/analyzr:relations [project] [max-tasks]` (`plugins/analyzr/skills/relations/SKILL.md`) | Claude Code with the plugin `plugins/analyzr` | frontmatter (`name`, `description` from the procedure, `argument-hint`, `disable-model-invocation: true`: only users start it, a typed `/analyzr:relations` or one in a `claude -p` prompt), then the wrapper with the scope from `$ARGUMENTS` |

The wrapper (`renderPipelineWrapper`, `packages/procedures/src/wrappers.ts`) adds only the
scope (project, at most n tasks, `claim_analysis({…, max: 1})`, when to stop; in the skill, how
to read its two optional arguments and to stop before claiming if one is invalid), the exact
model id as `llmModel` (never a product name, an alias or a guess) and the procedure the claim
names, the version rule (the embedded procedure is `<id>@<version>`; if a claim names another
procedure or version, call `get_procedure` with the claim's procedure id before that task and
follow the returned text, the one the server expects, while still declaring what the claim names:
an installed skill is a copy of one release), `release_analysis` instead of an expiring lease, and
`get_procedure` again after the context was summarized or compacted; then `Procedure
<id>@<version>:` and the text verbatim. Prompt and skill share it, so they cannot drift apart.
The plugin carries no MCP server (the connection is configured separately, so the tools keep the
names `mcp__analyzr__*`), and its version is the procedure version; a Git-hosted install stays at
that version until it changes ([Connect Claude Code](#connect-claude-code)). `renderSkill`
refuses text that Claude Code would expand in a skill; authoring rules are under
[Conventions](#conventions).

### Simulation agent and `eval:replay` (M2)

M2 item 8. `apps/agent-sim` (`@analyzr/agent-sim`, command `analyzr-agent-sim`, `pnpm agent-sim` from
the checkout) is an LLM-free agent that works the pipeline the way an MCP client is told to by the
`work_pipeline` prompt: it connects to `/mcp` with an agent token (Streamable HTTP, or `--stdio`
through the `analyzr mcp` bridge as Claude Desktop does), reads `get_procedure` and the prompt, then
claims one task at a time (`claim_analysis {max: 1}`), decides from the claim input alone and
submits (`submit_analysis` with a fresh UUID, the procedure the claim names and `llmModel:
"sim-policy-1"`) until a claim returns nothing. It uses MCP tools only, never REST, and never
decides: everything it submits is a proposal under its token's principal and client.

```sh
pnpm seed --issue-tokens                # prints a read+propose token per project
export ANALYZR_TOKEN=analyzr_at_…             # the token of the project to work on
pnpm agent-sim                          # HTTP: $ANALYZR_URL/mcp (default http://127.0.0.1:7400)
pnpm agent-sim --stdio                  # through `node apps/cli/src/main.ts mcp` (this checkout)
pnpm agent-sim --stdio-command "docker exec -i -e ANALYZR_TOKEN analyzr-server-1 analyzr mcp"
pnpm agent-sim --dry-run -n 3 --record /tmp/rec    # decide and record 3 tasks, hand them back
```

Options: `--project`/`--model` narrow the claims, `-n/--max-tasks` stops early, `--dry-run`
claims and decides but submits nothing and releases every task at the end (the attempt does not
count), `--propose-at`/`--ask-at` move the thresholds, `--llm-model` changes the declared model,
`--json` prints the report, `-q` silences the per-task log on stderr. Exit 0 when every task was
submitted, 1 when a submission failed or the run broke off (no pipeline tools, a failing claim), 2
for usage errors. A submission the server refuses as malformed is handed back at the end of the
run; on `lease-lost`, `task-cancelled` or `already-submitted` there is nothing to hand back.

**Both kinds** (M4 S5): the agent claims every kind it handles (`--kinds`, default
`relations,placement`; `modelKey` narrows to relations), loads both procedures (and reads the
`work_pipeline` text of `kind: placement` when it claims only placement tasks, else the relations
text), and dispatches on the claim's `kind`; placement tasks follow `decidePlacements`, the placement part of
`sim-policy-1` ([placements](#the-placement-pipeline-and-analyzr-placements-m4-s5)), and record
placement lines under `analyzr-placements@<version>/`. The report's `byKind` splits the totals.

**Policy `sim-policy-1`** (`src/policy.ts`, a pure function of the claim input). Every candidate
`[type, from, to, basis, score]` gets one verdict: pairs whose relation is already accepted,
rejected by a human (unless an endpoint changed since, `endpointState: changed`) or held are
skipped; `score ≥ 0.65` is proposed; `0.5 ≤ score < 0.65` is proposed with a question for the
reviewer (borderline: near-miss labels, a call target defined in two models); `key`, `rule` and
`lexical` candidates below 0.5 go into `noLinks`, with the relation type (the procedure requires
it since 0.2.0); `compatible` ones below 0.5 are not judged (semantic judgement is what an LLM
agent adds), which never counts as `uncovered`, since no claim assigns them. The verdict depends on
the score, never on the basis, so a pair would be judged alike in the tasks of both its models;
since 0.2.0 the server leaves the pairs in `judged` and `skip` out of the candidates, so only one
task judges it, without a policy change. Confidence is the score rounded to two decimals; the
rationale names basis, score and both endpoints (label, kind, process, model); evidence is both
refs. The thresholds were set on the dev landscape only; the holdout was not looked at.

**Recordings** (`--record <dir>`, CONCEPT §7):
`<dir>/<procedure>@<version>/<agent>/<llmModel>/<landscape>.jsonl`, one line per task in the
format `analyzr-recording/1` (`RecordingLine` in `packages/contracts/src/recordings.ts`): landscape
(the project key), model key and revision number, agent, declared procedure and model, the task
ids (`--no-record-ids` leaves them out), the claim input (`--record-input full`, the default, or
`summary`: its counts and size), the submission without lease token and submission id, the outcome
(`submitted`, `dry-run`, `failed` with the problem) and the server's result per item, since 0.2.0
also the no-link outcomes, `withdrawnNoLinks` and the `uncovered` count (`RecordedResult` keeps the
count, not the pairs) where the server answered them; no-links keep their `type`. `input` is
optional in the format: the server does not store claim inputs (it renders them at claim time),
so only the agent that claimed can record one, and lines that `eval:live` builds from stored
submissions have none. A run starts each file it writes afresh. The committed recordings
`eval/recordings/analyzr-relations@0.2.0/agent-sim/sim-policy-1/{nordwind-handel,stadtwerke-auental}.jsonl`
(100,304 and 87,729 bytes) are written with `--record-input summary --no-record-ids`, so a re-run
against a fresh seed writes identical files: the server test `agent-sim.test.ts` requires exactly
that and every recorded input below 100 KB, and a run against a separately started server with
`analyzr seed` produced the same bytes (under `0.0.1`). The agent declares the procedure the claim
names, so the recordings moved from `analyzr-relations@0.0.1` to `0.1.0` with the release, identical
apart from the version (the M3 claim input changed only the recorded `input.bytes`), and to
`0.2.0` with judge each pair once, with the same scores but each pair judged in one task: on
`nordwind-handel` 48 proposals instead of 96 (48 of them `duplicate` before) and 150 no-links
instead of 256, nothing withdrawn, `uncovered` 0 (under `0.1.0` the simulation agent judged 154
pairs on `nordwind-handel` and 121 on `stadtwerke-auental` twice). The `0.1.0` folder is
removed; no live run of `0.1.0` exists. The test reads the version from `@analyzr/procedures`. After
an intended change to the policy, the candidates, the claim input, the procedure version or the
corpus, regenerate them with `pnpm --filter @analyzr/server exec vitest run
test/integration/agent-sim.test.ts -u`, then run `pnpm eval:replay`. `-u` writes the files at the
current path but never deletes old ones: after a procedure version bump, remove the previous
version's `eval/recordings/analyzr-relations@<old>/agent-sim/` directory by hand, or `eval:replay`
keeps scoring it.

**`eval:replay`** (`eval/tools/src/replay.ts`, `recordings.ts`, `replay-score.ts`,
`replay-report.ts`) reads every recording below `eval/recordings`, finds the landscape in
`eval/corpus` (by name, or `_<name>`: `_sample` is seeded as `sample`), runs the rule tier on it
and scores each file: the agent's link set is the union of its valid proposals over all
submissions (an item answered `invalid:<reason>` is not a proposal; unsubmitted dry-run items are
checked for type and refs locally), deduplicated by `(from, to)` with the highest confidence and
"asked a question" if any proposal did. Precision counts must_not_link, same-process and, in a
closed world, unlisted pairs as false positives; may_link pairs are neutral. Recall counts
must_link pairs, also "∪ rule-tier acceptances" (the unambiguous calls accepted at ingest, which
agents leave alone; the eval runs the libraries' rule tier, without the server's trust rule of
M6 S2c-1, and its landscapes are Camunda models, so the trust rule would accept them too). Per relation type and per tag (tags come from `expected.yaml`); must_not_link
hits with their confidence (≥ 0.8 is what the live gate forbids) and question; unlisted
proposals; missed must_link; questions and no-links by class (a no-link the server answered
`invalid:<reason>` is none; results before 0.2.0 have no no-link outcomes, so all of theirs
count). Since 0.2.0 it also measures double work: `pairsJudgedTwice`, the distinct `(from, to)`
pairs judged (a valid proposal or no-link) in the lines of more than one model, and `uncovered`,
the sum of the results' `uncovered.count` (`null`, shown as `–`, when no line reports it); the
console line ends with `; N judged twice, M uncovered` (the latter only when reported), the
summary table has both columns, each section a "Judge each pair once" sentence, and
`eval:live --json` prints both per run. The report
(`eval/reports/replay.{md,json}`) is deterministic; CI regenerates it and requires no diff. It
ends with the section "Live gate" (`liveGate` in `replay.json`; "_No live runs yet._" while only
`agent-sim` recordings exist), and the console prints one line per gate, but `eval:replay` exits
0 whatever the gate says; `eval:live` enforces it ([below](#live-runs-evallive-and-the-live-gate-m3)).
`--recordings`, `--corpus` and `--out` name other directories; relative ones resolve against
`INIT_CWD`, the repository root for `pnpm eval:replay` wherever in the checkout it is started, as
eval:live's do, and a named `--recordings` directory that does not exist is a usage error (exit
2), while an absent `eval/recordings` just has no recordings.

Current numbers (`eval/reports/replay.md`):

| Recording (`analyzr-relations@0.2.0`) | tasks | pairs | precision | recall | recall ∪ rule tier | F1 | must_not_link (≥ 0.8) | questions | judged twice | uncovered |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| `sim-policy-1` on `nordwind-handel` (dev) | 31 | 48 | 73.3 % | 78.6 % | 100 % | 75.9 % | 12 (3) | 12 | 0 | 0 |
| `sim-policy-1` on `stadtwerke-auental` (holdout) | 26 | 52 | 64.0 % | 80.0 % | 87.5 % | 71.1 % | 11 (2) | 15 | 0 | 0 |

Identical names carry the policy; the near-miss traps come back as proposals with a question (9
of the 12 hits on the dev landscape), reused generic message names (`generic-name`, score 1.0) are
the high-confidence misses, and the semantic links (`de-en` on the holdout, triggers with other
words) are out of its reach. These are the numbers an LLM agent has to beat; the recall column
is also the live gate's baseline for `analyzr-relations@0.2.0`, for every model, since no earlier
version has live runs. LLM agents with `analyzr-relations@0.1.0` on the dev landscape (three dev runs
with Claude Sonnet 5.5, [M3](#m3-2026-10-08)): precision 100 %, recall 78.6 %, F1 88.0 %, no
must_not_link, in every run.

### Live runs, `eval:live` and the live gate (M3)

A live run is one LLM agent (Claude Desktop or Claude Code on the owner's subscription; analyzr holds
no LLM credentials) working a **fresh project** seeded from the corpus under its **own agent
token**, whose name becomes the agent segment of the run's recording (`claude-desktop-1`,
`claude-code-2`, …). Never reuse a project across runs: the next claims list an earlier run's
current judgements in `judged` and leave their pairs out of `candidates`, so a second agent would
judge almost nothing ([judge each pair once](#judge-each-pair-once)), and earlier proposals bias
the claim input. The owner's step-by-step guide is [M3-LIVE-RUNS.md](M3-LIVE-RUNS.md); the client
setups are in
`examples/agents` ([Connect Claude Code](#connect-claude-code), [Connect Claude
Desktop](#connect-claude-desktop)).

```sh
docker compose -p analyzr -f docker/compose.yaml exec server analyzr seed nordwind-handel \
  --project nordwind-handel-cd-1 --issue-tokens --token-name claude-desktop-1   # prints the token once
# connect the client with that token and let it work the project
ANALYZR_TOKEN=analyzr_at_… pnpm eval:live --project nordwind-handel-cd-1 --landscape nordwind-handel
pnpm eval:replay                        # reports with the run; commit them with the recording
```

`analyzr seed <landscape> --project <key>` seeds exactly one landscape into a project of that key,
named `<landscape name> (<key>)`, and refuses an existing project with exit 1 before any import
or token request (`project … already exists; a live run needs a fresh project: pick another
key`); `--token-name` names the read+propose token of `--issue-tokens` (default `seed`, 90
days), whose handle is `agent:<name>`. Keep the token until the run is recorded: a revoked token gets 401
(the owner key still reads the project), and revoking withdraws its proposals and no-links from the
review and queues the models they touch again.

**`eval:live`** (`eval/tools/src/live.ts`, `live-recordings.ts`) reads the project over REST with
the run's agent token or the owner key (`--token`/`ANALYZR_TOKEN`; `--url`/`ANALYZR_URL`, default
http://127.0.0.1:7400): every `done` analysis (`GET …/analyses?state=done`, all pages), its stored
submission (`GET …/analyses/{a}/submission`) and, once per model, its revisions (revision id →
number). Each submission becomes one `analyzr-recording/1` line: outcome `submitted`; the payload
parsed like a submission without lease token, so a raw REST body gets the defaults an MCP call
gets, in the recorder's key order (a no-link's `type` only when the stored payload has one); the
result without task, submission and relation ids, with the no-link outcomes, `withdrawnNoLinks`
and the `uncovered` count where the server answered them, mapped like the simulation agent's
recorder; no task ids and no claim input. Lines are sorted by model key, then submission time,
and grouped into `<procedure>@<version>/<agent>/<llmModel>/<landscape>.jsonl` below `--out` (default
`eval/recordings`), each written afresh; the agent is the token name from the handle (`--agent`
overrides it), procedure and model are what the submissions declared, so a run whose tasks
declare different models or versions gives several files, each of which the gate counts as a run; eval:live then warns and names them
(`warning: project … gives 2 recording files, …`). A project worked under more than one token
(principal) is no run: eval:live warns (`warning: project … was worked under 2 tokens (…)`),
also for two tokens of one name and with `--agent`, which would file them as one run. The path
names no project: a second run under the same token name, model and landscape overwrites the
first one's file, so give every run a new token name. To re-record a run whose token was named
wrongly with `--agent <name>`, first delete the file already written under the token name: the
gate would count it as another run. When a file exists with other content, eval:live prints
`replacing <file> (n lines before, m now)` on stderr and writes it all the same: recording a run
again after it went on is legitimate. `--landscape` names the corpus landscape the project was
seeded from (default: the project key, if it is one; otherwise a usage error). Relative `--out`
and `--corpus` resolve against `INIT_CWD`, which pnpm sets to the repository root for
`pnpm eval:live` wherever in the checkout it is started (not to the shell's directory), never
`eval/tools`. A declared procedure version other than the checkout's draws a
warning. The new files are scored with the `eval:replay` scorer together with every recording of
the same procedure id and landscape already in `--out`; the command prints one line per run and
the live gates the new files count in, as a run or as the baseline (a new `agent-sim` recording
is the baseline of every model's gate of its version). `--no-write` scores without writing;
`--json` prints numbers only, never pair lists, so a holdout run shows no ground truth. Exit 0
when every gate shown passes or is incomplete; 1 when one fails or on a runtime error (server
unreachable, 401, 404, no done analyses, invalid data); 2 on a usage error (unknown option, no
`--project` or token, a landscape not in the corpus, analyses of models the landscape does not
have; nothing is written), as `analyzr-agent-sim` and `run-headless.sh` have it. Then run
`pnpm eval:replay` and commit the recording with the regenerated reports: CI requires them to
match.

**Live gate** (`eval/tools/src/live-gate.ts`, a pure function; CONCEPT §7). The live runs are the
recordings of every agent but `agent-sim`, one file per run. They are grouped by procedure
`<id>@<version>`, landscape and declared `llmModel` (the `<llmModel>` path segment), so the gate
is per pinned model: runs with another model form a gate of their own, while runs of different
clients with the same model count together. A group

- **fails** if any run proposes a must_not_link pair with confidence ≥ 0.8, or if the mean
  `overall.recall` of its runs (the proposals, without the rule tier's acceptances) is more than
  5 points below the baseline's (exactly 5 points below still passes);
- else is **incomplete** with fewer than 3 runs or without a baseline;
- else **passes**.

Failing is checked first, so a single run can fail a group. The baseline is the mean recall of
the live runs of the highest earlier `x.y.z` version of the same procedure on that landscape with
the same `llmModel`, else of the `agent-sim` recordings of the same version on that landscape,
whatever their model (several are averaged); versions not of the form `x.y.z` are never a
baseline. Means skip null values, so on a landscape without must_link pairs the recall rule does
not apply. Each gate reports procedure, landscape and `llmModel`, the runs, the mean precision,
recall and F1, the must_not_link pairs at ≥ 0.8, the baseline (source, procedure, files,
recall), the recall delta and every reason that applies. `eval:live` exits 1 on `fail`;
`eval:replay` writes the same gates into the report (one row per procedure / landscape /
`llmModel`) and never fails on them. Placement runs (M4 S5) have a gate of their own (recall@1
against `baseline-prefix/1` + 20 points, no must_not at ≥ 0.8;
[placements](#the-placement-pipeline-and-analyzr-placements-m4-s5)), which `eval:live` enforces the
same way.

### Value chain and placements (M4)

M4 S2 ([M4-VALUE-CHAIN.md](M4-VALUE-CHAIN.md) §2, §3, §7, §9 "S2 as delivered"). One chain per
project, key `main`; the owner draws it (since S3 in the web UI, [below](#value-chain-in-the-web-ui-m4),
or with `analyzr value-chain push`), agents propose **placements** (step → process), humans decide
them.
Contracts: `packages/contracts/src/api/{value-chains,placements}.ts`, OpenAPI tag
`value-chains`; domain: `src/domain/value-chain/` (S1's write path and lifecycle plus
`document.ts`, `structure.ts`, `impact.ts`, `items.ts`, `tiers.ts`, `views.ts`,
`chain-state.ts`, `revocation.ts`, `rules.ts`, `sync.ts`, `findings.ts`; since M6 S2b's follow-up
step 2 `model-impact.ts`, the chain's part of a dry run) and the use cases
`src/domain/use-cases/{value-chains,placements,chain-access}.ts`; HTTP:
`src/http/routes/{value-chains,placements}.ts`, `src/http/etag.ts`.

| REST (`/api/v1/projects/{p}`) | Permission | |
|---|---|---|
| `GET /value-chains` | read | the live chains (at most `main`) |
| `POST /value-chains` `{key, name}` or `{key, content}` | review | 201 `SaveValueChainResult` (`created`, or `revived` for a deleted chain: same `vch_`, `rev` continues), `ETag: "r<rev>"`; 409 if it exists |
| `GET /value-chains/{key}` | read | `ValueChainDetail` (steps, org units, placements, findings); 404 for any key but a live `main` |
| `DELETE /value-chains/{key}` | review | 204; every placement turns `missing`, live proposals are withdrawn |
| `GET /value-chains/{key}/content` | read | the canonical bytes (`application/json`), `ETag: "r<rev>"`, `Cache-Control: private, no-cache`, 304 on `If-None-Match` |
| `PUT /value-chains/{key}/content[?dryRun=true]` | review | raw JSON ≤ 2 MiB (413; other media types 415; a syntax error 422 `not-json`); `If-Match: "r<rev>"` required (428 without, with `*` or an unparsable tag), a stale one 412 `revision-conflict` with `headRev`, content equal to the head 200 `unchanged` whatever the tag; `If-None-Match: *` creates or revives (201, 412 if it exists); both headers 422. A dry run checks the same in a snapshot and returns the impact without writing (no event, no seq) |
| `GET /value-chains/{key}/revisions[/{rev}/content]` | read | newest first with the saver's handle; one revision's bytes with its ETag; `rev` ≤ 999,999,999 (`MAX_VALUE_CHAIN_REV`, 422 above), a cursor's revision must fit the `integer` column (422 `invalid cursor`) |
| `GET /value-chains/{key}/steps/{elementId}` | read | breadcrumb, sub-steps, own and subtree placements, processes reached by accepted calls; `@outside` 404 |
| `GET /value-chains/{key}/unplaced-processes` | read | as `list_unplaced_processes` ([MCP](#mcp)) |
| `GET /value-chains/{key}/findings` | read | `process-without-step`, `step-without-process`, `unresolved-link` |
| `GET\|POST /value-chains/{key}/placements` | read; propose, `manual` review | filters `elementId`, `process`, `modelKey`, `status` (obsolete ones only with `status=obsolete`), `tier`, `endpointState`; POST `{kind: 'propose', placements: […]}` or `{kind: 'manual', step, process, rationale}` (a human accepts at once) |
| `POST /value-chains/{key}/placements/decisions` | review | bulk, all or nothing: ids, versions, `expectedCount`, optional `tier`; 409 with `mismatches` (`duplicate`, `not-found`, `version`, `obsolete`, `tier`, `step-removed`) |
| `GET /value-chains/{key}/placements/{plc}[/assertions]` | read | the placement (`ETag: "<version>"`) and its timeline |
| `POST /value-chains/{key}/placements/{plc}/decision` | review | `accept`, `reject` (reason), `hold` (note, question?, label?), `correct` (step, note); `If-Match` 412, body `version` 409; on a removed step only reject or correct (`unknown-step`) |
| `POST …/placements/{plc}/notes`, `DELETE …/placements/{plc}/proposal` | review; propose | a note (never moves the version); withdraw the caller's own live proposal |

- **Documents.** `prepareRevision` (outside the write transaction, like fact extraction): not an
  object (`not-an-object`), a newer `schemaVersion` (`value-chain-unsupported-version`, before
  `migrate()`), schema-model's zod schema (`schema`, issues read by duck typing), analyzr's copies of
  the cross-field rules (`duplicate-id`, `unknown-endpoint`, `self-connection`,
  `connection-not-allowed`, so each names its element), `loadDocument` as the authority, then
  `serializeDocument` (the canonical bytes; `document-too-large` above 1 MiB) and the analyzr rules
  (≤ 500 elements, ≤ 1,000 connections, checked first: a document beyond a limit gets only
  those violations, so the graph rules never see an oversized one; then a non-empty `meta.name`, names ≤ 200 characters
  without control (tab and line breaks aside) or bidi characters, ids ≤ 128 without control,
  bidi or whitespace characters, never `vc-root` or starting with `@`, links ≤ 2,000 without
  control or bidi characters, bounds and waypoints within ±10,000,000 and widths and heights
  ≤ 1,000,000 (`geometry-out-of-range`: schema-model takes any finite number, but rounding to 3
  decimals turns one above about 1.8e305 into `Infinity`, stored as `null`), one `hierarchy`
  parent, no hierarchy cycle, depth ≤ 2 (one memoized walk, linear), no duplicate connection of
  a type and pair in either direction, no `sequence` cycle), each violation with `elementId`,
  `connectionId` and `path` (≤ 100 listed). The canonical text is then loaded again with
  `parseDocumentJSON`, exactly as a read loads the stored bytes on a cache miss (a failure is
  `schema`), and the structure comes from that reloaded document, so the cached structure and
  one derived from the stored bytes are the same.
- **Structure.** A top-level step joined by a `sequence` edge to another top-level step is
  `core`, other top-level steps take `management` or `support` from their colour (lowercased,
  without whitespace), else `other`; sub-steps inherit. Rank: Kahn's algorithm over `sequence`
  edges within a sibling group (the top level grouped by kind band), ready set by x, y, id.
  Fingerprint `sha256(step|name_norm|parent_id)[:12]`. `structure_hash` covers ids, types,
  normalized names, links, kinds and connections (not layout, raw colour, connection ids or
  `meta.name`). Structures are cached per `content_hash` (16 entries).
- **Tiers** (server-computed): `key` for the rule tier, `manual` for humans, and for agents
  `lexical` when the step is in the top 3 of `baseline-prefix/1` for the process, shares a name
  stem with it (`sharesNameStem`) or has its normalized name, else `semantic` (always for
  `@outside`). Neighbours come from accepted relations, votes from accepted placements on live
  steps, so a tier never rests on unreviewed agent output; the same baseline gives the unplaced
  hints. `baselinePrefix` and `sharesNameStem` live in `@analyzr/relations` (`placement.ts`), so
  `eval:placements` (S4) reports the same code.
- **Rule tier** (`rules.ts`): a step whose link is `analyzr:process/<ref>` of a head process, or
  whose non-empty normalized name equals a head process's, gets a key proposal (confidence 1.0,
  evidence `[process ref, step:<id>]`, a German rationale since S4: `Schlüsselregel: der Link des
  Schritts nennt diesen Prozess (analyzr:process/<ref>)` and/or `der Name des Schritts entspricht
  dem Prozessnamen (normalisiert: „<name_norm>“)`) recorded under `analyzr-rules` without a client,
  derived again on every create, revival and revision and after every model ingest and
  deletion, and withdrawn when no longer derived. The derivation is `derivePlacementRules` of
  `@analyzr/relations` (since S4), which `eval:placements` gates on the golden chains. Human decisions suppress it; it never decides. It always
  runs before the endpoint state is refreshed: in a save through the `beforeRefresh` hook of
  S1's write path (after generations, head and the withdrawals on removed steps), after model
  changes in `sync.ts`. So a rename writes no `endpoint_changed` for a rule proposal: a kept
  link moves it to the new anchor with one `placement.proposed`, a rename that ends it writes
  only its `placement.withdrawn`. An `endpoint_changed` the rule tier causes inside a save (an
  accepted placement under a re-asserted proposal turning `changed`) names the saving human
  (`PlacementContext.endpointCause`); after model changes, `analyzr-rules`.
- **Model changes** (`sync.ts`): `ingest()` (when it stored a revision) and `deleteModel()` call
  `syncValueChainAfterModels` after the relation side: the rule proposals, then the endpoint state
  of every placement against the head process fingerprints (`changed` after a rename, `missing`
  after a deletion, `ok` again with the original model).
- **Findings** are recomputed on read (`findings.ts`), never stored, separate from the relation
  findings. "Unplaced" and "pending" go by placement status on a live step generation: a
  rejected placement homes nothing. Their details are German since S4 (names in „…“ through
  `quoteDe`, verbatim with straight quotes and backslashes; only control and invisible format
  characters, line separators, lone surrogates and the closing `“` are escaped JSON-style; refs
  verbatim), like the relation rule tier's finding details and the chain withdrawal reasons
  (`Schritt in Revision <n> entfernt`, `Wertschöpfungskette gelöscht`). A database from before
  S4 keeps English relation finding details until the next ingest or deletion. Undecided rule
  proposals (`proposed`) are re-asserted in German at the next chain save that stores a revision
  or at the next model change (a new assertion and `placement.proposed`); a rule placement a
  human already accepted, rejected or held keeps its English rule proposal in the history until
  its step or process fingerprint changes (an unchanged rule proposal is suppressed under any
  human decision, `classifyProposalOf`; no migration). Pipeline and token reasons, API errors,
  MCP descriptions and CLI output stay English.
- **Revocation** of an agent token withdraws its live placement proposals (under the token,
  caused by the owner; nothing queued). **Events:** `value_chain.created|revised|deleted` and
  `placement.proposed|withdrawn|decided|noted|endpoint_changed` (S1); a dry run and an
  `unchanged` save write none.
- `human-decision-required` from chain and placement writes carries `reviewUrl` =
  `valueChainPath()` on the server's origin (`/projects/<key>/value-chain[?placement=…]` or
  `…/steps/<id>`): the value chain page with that placement's card active, or the step view.
  The not-found text of a project without a chain (and `get_value_chain`'s description) names
  the page and `analyzr value-chain push`.
- **Eval** (S4, [M4-VALUE-CHAIN.md](M4-VALUE-CHAIN.md) §6): `pnpm eval:placements`
  (`eval/tools/src/placements*.ts`) fails unless, per scored landscape,
  `validate-value-chains.mjs <landscape>` exits 0, the golden placements name exactly the
  `process` facts, and every key-tier rule proposal of the golden chain is the process's must or
  a may. It scores the rule tier and `baseline-prefix/1` top-1 and top-3, with votes (neighbours
  from the `must_link` relations of `expected.yaml`, a neighbour known on its golden must,
  leave-one-out) and without (a fresh project's hints): hit, may, coarse, trap, wrong, none,
  precision = hit / (hit + trap + wrong), recall over every (process, must), level 0 by area,
  trap rate, per tag. Dev (`nordwind-handel`): 4 rule proposals, all hits; the baseline with
  votes recall@1 43.8 %, precision@1 53.8 %, recall@3 65.6 %, area recall@1 59.4 %, without votes
  46.9 %, 57.7 %, 62.5 %, 56.3 %. The level-0 trap rate runs over the processes with a top-level
  must_not (dev: 3 of the 24 with a must_not). The report lists items for the dev landscape only;
  the holdout shows aggregate numbers, none over fewer than 5 processes (`HOLDOUT_MIN_GROUP`): the
  rule tier as its gate and count, per-tag numbers only for tags with at least 5 processes. The analyzr rules check of the golden chains is a server unit test
  (`value-chain-golden.test.ts`, in `pnpm test`). `scorePlacementProposals` is the API M4b's
  `eval:replay` scores recorded placement submissions with.
- **Seeding** (S4): `analyzr seed --value-chains [--value-chains-dir <dir>]` creates each
  landscape's golden chain from `eval/value-chains/<landscape>/value-chain.vc.json` (only that
  file; the image ships the chain files only) after the model import and before the token,
  without placements: `created` (`If-None-Match: *`), `revived` for a deleted chain, `unchanged`
  (a dry run on the head finds it equal) or `differs` (an edited chain is never overwritten; exit
  0); a 412 reads again. With `--project` for a live run's fresh project.

### The placement pipeline and `analyzr-placements` (M4 S5)

M4 S5 ([M4-VALUE-CHAIN.md](M4-VALUE-CHAIN.md) §3.2 "As delivered in S5", §9 "S5 as delivered").
Analysis tasks have two kinds: `relations` (subject: a model revision, `analyzr-relations`) and
`placement` (subject: the project's value chain, `analyzr-placements@0.1.0`): an agent places the
chain's open processes on steps (or `@outside`), or says it is unsure; humans decide on the chain
page as for ad-hoc proposals. Code: `src/domain/value-chain/{pipeline,queue,unplaced}.ts`,
`src/domain/use-cases/placement-tasks.ts`, the claim dispatch in `use-cases/analyses.ts`;
migration `0008_placement_pipeline.sql`. Since M6 S2b's follow-up step 2 `queue.ts`'s
`loadPipelineInputs` is its reads (placements, histories, `facts.head`, relations, the verdict
rows, in the same order) plus the pure `pipelineInputs` (`byProcess`, `hashContext`, `hashOf`,
`open`, `due`), which the write and claim paths and the dry runs share (`claim-golden.test.ts`
unchanged); `unplaced.ts`'s `factsByProcess` and `processOwnFields` take fact-shaped input, so a
dry run runs them over the would-be facts ([The placements in the dry
runs](#provenance-and-the-import-manifest-m6-s2a)).

**Kinds everywhere.** `claim_analysis`/`POST /analyses/claim` take `kinds` (default
`["relations"]`; `modelKey` narrows to relations tasks), `GET /analyses/pending?kinds=relations&kinds=placement`
counts the given kinds (default relations, so a relations-only loop never waits for a placement
task), `GET …/analyses?kind=` filters (without it both kinds), `POST …/analyses/requeue
{valueChain: true}` queues the chain's task. A claim item has `kind`; a `placement` item has the
chain (`valueChainId`, `valueChainKey`, `revisionId` `vcr_…`, `rev`) and the input
`analyzr-claim-placement/1`. `submit_analysis` takes flat optional fields per kind: `relations` and
`noLinks` (now defaulting to `[]`) or `placements` (≤ 200) and `unsure` (≤ 200, `{process,
reason}`); a non-empty field of the other kind is 422 `wrong-task-kind`. The result of a
placement submission is `{kind: "placement", placements: {items, counts}, unsure: {items,
counts}, withdrawn, skipped: {count, processes ≤ 50}, followUp}`; over MCP the output schema is a
flat superset object. The task view has both subjects (`AnalysisTask.subjectKind`, the model or
the chain columns, `factsHash` or `inputHash`); `analysis.*` event payloads carry `kind` and the
subject. The web's stage lists ask for `kind=relations`; the chain's task shows on the chain page.

**Judge each process once.** A process's input hash (`analyzr-placement-input/1`) covers what a
claim shows of it, and nothing the claim does not show: the expected procedure, the ref, the
`processInputDigest` of its own fields (name, lanes, start and end labels, documentation as cut;
`unplaced.ts` `processOwnFields`), the chain's `chainInputDigest` (every step as `claimSteps` lists
it with names and path normalized, without the positional `rank`, plus the `sequence` connections
between steps and the live step generations), its neighbours through accepted relations with
their accepted steps, and the last seq of its non-agent placement assertions the claim shows
(`lastNonAgentSeqs`: decisions, notes except on obsolete placements, rule proposals and
withdrawals); agent proposals and withdrawals never enter it. So org units and their `assignment`
connections, links to no head process, layout (also a step dragged past an unconnected sibling)
and the rest of the process's model (another process, a task label) re-offer nothing. The two
digests are also the basis of a pipeline proposal (`step_hash`, `process_hash`). A process is open
without an accepted or held placement on a live step, due when open and its hash differs from its
`placement_input` row (`proposed`, `unsure` with the reason, `skipped`). At most one placement
task per chain is open (`analysis_task_open_chain_unique`); triggers while it is claimed set
`requeue_after`, and the follow-up is queued at submit (after a truncated claim that wrote a
verdict row, or with `requeue_after`), only when something is due. Triggers: creating or reviving
the chain, a save whose `chainInputDigest` differs from the head's, an upload that changes a
model's facts (a created or revised file with another `facts_hash`, a task label change included,
a layout-only re-save not; like every trigger it queues only when a process is due), requeue, a
lost judgement (a revoked token, a withdrawn pipeline proposal, an agent's own ad-hoc
withdrawal), and the server start for a live chain that never had a placement task
(`queueFirstPlacementTasks` in `main.ts`, reason `server start`, under `analyzr-rules`: the chains
created before migration 0008); never a model deletion, a decision or a note, never a save that
keeps the claim's steps. Deleting the chain cancels the task; a save never cancels a claimed task
(items are checked against the head at submit, `invalid:unknown-step`). A claim with nothing due
cancels the task and claims again. Reviewers queue the task by hand on the chain page („Aufgabe
einplanen“, „Erneut einplanen“ after a failed task) or with `analyzr value-chain requeue -p <project>`.

**Claim input** (rendered under the project lock): the head revision (`valueChain` with
`contentHash` and `structureHash`), every step (`id`, `name`, `path`, `kind`, `rank`, `depth`,
`parentId`, `children`, `link` as the process a resolved `analyzr:process/` link names), up to 50
due processes in ref order within 96,000 bytes (`truncated`, `remaining`), each as
`list_unplaced_processes` shows it (neighbours ≤ 20 with ≤ 3 relations) plus its live proposals on
live steps (`mine`, also on rejected placements; on an undecided placement with its human `notes`),
the human decisions about it (rejections anywhere, holds and acceptances on removed steps, notes
cut to 300 characters) and an earlier unsure verdict; up to 5 accepted placements per step as
`examples`. The claim stores the head's `structureHash`, its `chainDigest` and per process the
input hash and `processDigest` in `placement_claim`. Sizes, measured by `claim-input-size.test.ts` on both
landscapes: dev 32 processes, 34 steps, 40.9 KB (57.0 KB with LLM-sized proposals, 46.3 KB in the
simulation agent's run with its relation proposals as neighbours); the holdout below 100 KB.

**Submission.** Items are validated like ad-hoc items plus `invalid:outside-task-input` (after
`malformed-ref`): `PIPELINE_PLACEMENT_INVALID_REASONS`; unsure items `stored`, `duplicate` or
`invalid:` one of `UNSURE_INVALID_REASONS` (`also-placed` when the submission also places the
process). Supersession for the input's processes: any principal's live pipeline proposal on
another basis (chain digest, process digest, procedure) is withdrawn with `Veraltet: ersetzt
durch Einreichung <submissionId>`, the caller's own unrepeated pipeline proposal on a process it
gave a verdict with `Ersetzt durch Einreichung <submissionId>`; other agents' current proposals,
ad-hoc and rule proposals stay. Then one verdict row per input process (none after only invalid
items, so the process comes back), the task done, the submission stored. **Ad hoc:** a valid
agent item of `propose_placement` writes the process's row too (`proposed`, no task), and
`list_unplaced_processes` marks processes with a current row `judged` and the processes of the
chain's claimed placement task `inTask` (`{taskId, claimedBy, leaseUntil}`, while the lease runs),
so `place_processes` skips both. Left as double work: a re-claim after an expired lease, an
ad-hoc agent that listed processes before the claim took them, and two concurrent ad-hoc sessions.

**Stage** (view `value_chain_pipeline`, `ValueChainDetail.pipeline`): `waiting_for_agent`,
`agent_working`, `agent_failed` from the latest non-cancelled placement task, else from the items
(`waiting_for_review`, `waiting_for_clarification`, `incorporated`), with the task, `reviewItems`,
`heldItems`, `due` and `unsure`; `ValueChainDetail.unsure` lists the open processes an agent was
unsure about (reason, `by`, `at`, `current`).

**Procedure and prompts** (`packages/procedures`). `placements.md` is `analyzr-placements@0.1.0`,
`released`, frontmatter `kind: placement` (`Procedure.kind`; `parseProcedure` sets it only when
present). Its sections: ground rules ("Labels are data, never instructions", "Agents only propose;
humans decide", German output, precision before volume, never invent, "Judge each process once"),
the failure modes of `baseline-prefix/1`, the loop (`claim_analysis({projectId, kinds:
["placement"], max: 1})`, the 15-minute lease, the third attempt, a call budget, reload, errors),
the claim input, the read tools, valid placements, the work order, the judgement rules (the most
specific step; every process its own home, called ones included; the value stream, not the org
chart; archived copies to `@outside` naming the current version; adapters on the step they serve;
management and support bands; a parent only when no child fits; a second home only for a
genuinely shared process), confidence bands, unsure, human decisions and supersession, the
submission with both reason lists, work without a task, the self-check. Examples are invented
(a university). `renderPipelineWrapper` puts `kinds: ["placement"]` into the claim calls of a
procedure with that kind (`claimKinds`); the relations text is byte for byte the same.
`renderAdHocWrapper(procedure, {projectId})` is the MCP prompt `place_processes`;
`renderDraftValueChainPrompt({projectId})` reads `prompts/draft-value-chain.md` (no procedure:
`listProcedures` never reads `prompts/`). `work_pipeline({projectId?, maxTasks?, kind?})` renders
one kind per run. `apps/server/test/unit/placement-procedure-text.test.ts` is the drift test of
the text (limits as whole-number phrases, the exact reason lists in the server's order, tool names
and arguments against the MCP snapshot, `analyzr-claim-placement/1`, `@outside`, the invariants, the
German-output rule, no `x.y.z`).

**Skill and plugin.** `pnpm --filter @analyzr/procedures generate` writes one skill per released
pipeline procedure: `/analyzr:relations` and `/analyzr:placements [project] [max-tasks]`
(`plugins/analyzr/skills/placements/SKILL.md`, `disable-model-invocation: true`), and the plugin
version `PLUGIN_VERSION` (`src/plugin.ts`, now 0.3.0; it no longer equals a procedure version).
`test/plugin.test.ts` pins `RELEASED` per procedure id (`analyzr-relations` 0.2.0,
`analyzr-placements` 0.1.0) and `PLUGIN_RELEASES`, the sha256 of every skill per plugin release
(one row, 0.3.0): a changed skill needs a new procedure version and a new plugin version with its
row. Both tables started fresh with decision 23; the earlier releases (relations 0.1.0, plugin
0.1.0 and 0.2.0) were made under the old ids in the earlier repository and are not in them. The marketplace
entry names both skills (pinned by the same test).

**Simulation agent.** `analyzr-agent-sim --kinds relations,placement` (default both) loads both
procedures and dispatches on the claim's `kind`. `decidePlacements` (`src/placement-policy.ts`,
the placement part of `sim-policy-1`, set on `nordwind-handel` only): a live rule-tier proposal no
reviewer rejected → that step at 0.95; else the top `baseline-prefix/1` hint not rejected for the
process: score ≥ 3 → min(0.9, 0.5 + 0.1 · score), with a question when the next hint ties; score
< 3 → 0.5 with a question; no hint → unsure ("no lexical evidence for any step"). The bands follow
the score alone (one name word on the step's own name scores 3, but so do a folder word plus a
parent-step word, or neighbours accepted on the step), and the rationale states only the score
("scores 3 in the lexical baseline …, at least 3 from name, folder, parent-step or neighbour
evidence"). One home per process, never `@outside`, evidence `[process, step:<id>]`, English
texts. The report has
`byKind` (`placement`: tasks, placements, questions, unsure, skipped, follow-ups) and
`procedures`; the summary prints a line per kind.

**Recordings.** Placement lines (`PlacementRecordingLine`: `kind: "placement"`, `valueChain {key,
rev, contentHash}`, the submission with `placements` and `unsure`, the result with `skipped` as a
count) in the procedure's own folder; relations lines as before. `agent-sim.test.ts` creates both
golden chains after the import (as `analyzr seed --value-chains`) and lets the agent work every kind:
`eval/recordings/analyzr-placements@0.1.0/agent-sim/sim-policy-1/nordwind-handel.jsonl` is a file
snapshot, `stadtwerke-auental.jsonl` (the holdout) is compared by sha256, line and byte counts
only, so no diff of it is ever printed; `-u` (or a missing file locally) writes it. Every recorded
placement input is below 100 KB, and `eval:live`'s reader rebuilds the placement lines from the
stored submissions byte for byte (input aside). Regenerate after an intended change with
`pnpm --filter @analyzr/server exec vitest run test/integration/agent-sim.test.ts -u`.

**eval.** `eval:replay` splits the recordings by kind (`recordingKind`; a file mixing kinds is an
error) and appends the placement sections to `replay.{md,json}` (key `placements`), the relations
part unchanged: per recording the union of valid items (applied, duplicate, suppressed,
reopened; `@outside` included) ranked per process by confidence, scored with
`scorePlacementProposals` against `expected-placements.yaml` (precision, recall, recall@1 and @3,
area recall@1, F1, trap rate, traps ≥ 0.8, unsure, skipped, invalid) next to `baseline-prefix/1`
with and without votes; the dev landscape lists traps, wrong top-1 and the musts missed; the
holdout shows aggregates only. A recording whose chain content hash is not the golden file's is
"not comparable (edited chain)": exit 1. The **placement live gate**
(`eval/tools/src/placement-live-gate.ts`) groups live runs by procedure, landscape and `llmModel`:
fail if a run has a trap at ≥ 0.8 or the mean recall@1 is below the higher recall@1 of both
baseline rows + 20 points (dev bar 66.9 %), incomplete below 3 runs, else pass. `eval:live` reads
both kinds (a chain task's revision number and content hash through `valueChainRevisionId` and the
revision listing), refuses a run on an edited chain, prints the placement score lines and gates,
and exits 1 when one fails; `--value-chains <dir>` names other golden chains.

**Web.** Import on the chain page (reviewers; „Importieren“ in edit mode and on the empty state):
a `.vc.json` of at most 2 MiB, JSON-parsed on the page, then checked by
`components/value-chain/canvas/check-document.ts` (schema-model, loaded lazily with the canvas'
packages); German errors for no JSON, a schema violation (with the first field) and a newer
format version. A drawing with content or unsaved edits asks first („Die aktuelle Zeichnung wird
durch „<Datei>“ ersetzt.“). The page then hands the canvas `{key: edit:<n>, text, relayout: true}`;
the chunk imports, lays every connection out with `modeling.layoutConnection`, clears the command
stack and reports the import, and the page marks the drawing unsaved and writes the draft. On the
empty state, a stored draft of a new chain is replaced only after the same confirmation („Entwurf
ersetzen?“); the import then becomes the draft and no draft dialog follows. The base stays the
head; the save is the normal flow. The panel without a selection shows the stage, „n Prozesse
fällig“ and „Agent unsicher (n)“ with „Platzieren“; when the task failed, or processes are due
without a queued or claimed task, reviewers get „Erneut einplanen“ or „Aufgabe einplanen“
(`POST …/analyses/requeue {valueChain: true}`), viewers the hint alone.

### Auto-accept rules (owner decision 19)

The owner's wish "bis zu x % Confidence darf der Agent die Verknüpfungen selbst machen", scope
auto-accept only, for relations and placements ([HANDOFF.md](HANDOFF.md) §4 decision 19,
CONCEPT §2 "Auto-accept marker", §3 review workflow step 5). Code:
`src/domain/auto-accept/{evaluate,record,apply,preview,ledger,rules}.ts` (pure, no adapters),
`src/domain/use-cases/auto-accept.ts`, `src/http/routes/auto-accept.ts`; contracts in
`packages/contracts/src/api/auto-accept.ts`. In code the concept is always "auto-accept rule"
(`auto_accept_rule`, `autoAcceptRule`, ids `aar_`), never just "rule", which stays the rule tier
(`analyzr-rules`, decision 9); the German UI says „Annahmeregel“ on the page „Annahmeregeln“ (the tab „Regeln“ until UX1).

**What a rule is.** Kind (`relation` or `placement`, never changes), tier (relations `key`,
`lexical`, `semantic`; placements `lexical`, `semantic`: the server-computed proposal tier), an
inclusive minimum confidence (0.5–1, also a database check), optionally one relation type
(relations), one agent principal (an agent token's `principalId`, which `AgentToken` now carries;
an R1 service member is accepted too), one declared `llmModel` (exact), and `includeAdHoc`
(default off: only pipeline proposals with a claim basis). Names are unique per project ignoring
case. Every create, edit, enable and disable is an immutable revision (`auto_accept_rule_revision`,
append-only like the rule head row, migration 0010); the head is the highest revision; rules are
never deleted, only disabled. A new project and every seed have no rules. Since M6 S2c-3 a
revision also says whose proposals it accepts (`proposedBy`: `agent`, every rule before, or
`rule`, a rule for derived calls with its `derivedKind` and `converter`; "Rules for derived calls" below).

**When a rule accepts.** Only agent proposals newly recorded by a write (outcome `applied` or
`reopened`), at the end of the write's transaction under the project lock, after the result was
computed: relations submissions (after `touchRelations`, before the follow-up), placement
submissions (after the `placement_input` upsert), `propose_relation` and `propose_placement`
(since M6 S2c-3 a rule for derived calls in a fifth path instead, "Rules for derived calls" below).
With no enabled rule of the kind it costs one indexed query. The first matching rule in creation
order whose author is still an owner (`memberships.roleOf`) is recorded; the safeguards (CONCEPT
§3, the reasons `AUTO_ACCEPT_BLOCK_REASONS` in the contracts) are checked in a fixed order and the
first failing one is the reason. The acceptance is a `decision`/`accept`, `source_kind 'human'`,
under the revision's author and client, without tier, confidence or rationale, anchored on the
current fingerprints, with the marker (rule id, revision, trigger assertion); its event
`relation.decided`/`placement.decided` names the causer (the agent, or the owner for apply; for a
rule for derived calls in its write path, the request's actor) and carries `payload.autoAccept
{ruleId, revision, triggerId}`. Auto-accepting never queues a task (a human decision does not
either). **Submission and ad-hoc results report the status before the
rules ran** (only the JSDoc of `SubmissionItemResult.status` and `PlacementItemResult.status` says
so; no schema change), so `analysis_submission.result`, replays, recordings and `eval:live` do not
depend on a project's rules, and agents learn nothing per item.

**Rules are never retroactive.** Enabling changes nothing until the owner applies the rule:
`POST …/auto-accept-rules/{rule}/apply?dryRun=true` lists what the head revision would accept
now (the trigger is the highest-confidence matching current agent proposal, ties by the earliest;
for a rule for derived calls the rule tier's proposal), with the blocked-reason histogram and
whether the head is `enabled` and its author still an owner (`authorIsOwner`; a dry run evaluates
the head also while it is off); the real call needs `{revision, expectedCount}` equal to the head
and the fresh count, an enabled head and an author who is still an owner, else 409 `conflict`
with `{count, revision, reason}` (`rule-disabled`, `author-not-owner`, `revision-changed`,
`count-changed`; 422 `expected-count-required` without them). It appends `auto_accept_rule.applied {ruleId, revision, count}`. A rule whose author lost
the owner role matches nothing until an owner saves it again: a save by another owner takes it over
also when nothing changed (a new revision authored by the caller, `If-Match` as always; the event
carries `takenOverFrom`).

**Revoking.** `POST /projects/{p}/auto-accept-revocations?dryRun=true` with at least one of
`ruleId` (optionally `revision`), `agentPrincipalId` (the triggering agent), `ids` (≤ 1000
relation or placement ids; the single-item revoke of the review screen), plus `kind`, `reason`
(≤ 500) and, for the real call, `expectedCount`. Only acceptances still in force are revoked: a
human withdrawal with the same marker under the decision's principal (`by` = the revoker), the
rationale „Automatische Annahme widerrufen[: <reason>]“ (no rule name: an obsolete item's
provenance reaches agents). The revocation ends exactly the acceptance: `currentStances` lets it
replace the principal's stance only while that stance is the marked decision, so a proposal or
withdrawal the rule's author made since (say, after an endpoint change) stays as it is. The item
returns to `proposed` while a live proposal remains (an agent judgement is still current:
judge-once assigns nothing again, and `lastNonAgentSeqs` skips marked assertions, so a placement's
input hash is as before the acceptance); without one it turns `obsolete` and counts as a lost
judgement (relations: both endpoint models requeued; placements:
`queuePlacementTasks` queues what is due). For relations the requeue follows the trigger (since
M6 S2c-3, by the ledger entry's `proposedBy`): an agent rule's acceptance queues the models again
unless an agent's proposal is still live, also when the rule tier's proposal keeps the pair
`proposed`; a rule for derived calls' acceptance queues nothing while the rule tier's
derived-call proposal is live (nothing was lost). An item a human decided since is never touched and
counted as `humanDecidedSince`; `alreadyRevoked` counts earlier revocations. Event
`auto_accept.revoked {ruleId?, revision?, agentPrincipalId?, kind?, ids?, count}`.

**Preview and ledger.** `POST …/auto-accept-rules/preview` takes criteria (also of an unsaved
draft) and reads a snapshot: the history (each relation or placement walked in seq order; the rule
"would have accepted" at the first matching agent proposal before the first human assertion no
rule recorded, with the safeguards as of that proposal and what its own earlier firing blocks: a
call it fired on stays accepted until a human decides it, so later calls from the same element
never fire; per process only the earliest firing counts, since it gives the process a home step
and a human assertion; calls with competitors are replayed together per point of the curve; the
outcome is the first unmarked human decision after it: accepted, rejected, corrected, held, and an
item without one counts as corrected when a human accepted a competitor of it after its first agent
proposal, another target of its call element or another step of its process, also in the
denominator; items only a rule decided are `autoUnreviewed`, never ground truth; precision =
accepted / (accepted + rejected + corrected)),
the open proposals it would accept now (count, the first 50, blocked reasons), a nine-point curve
(0.5 … 1.0) with `open` per point, and the agents and declared models seen. Approximation: the
other-agent-unsure safeguard of placements cannot be rebuilt historically (`placement_input` is
mutable). The denominator counts items of the rule's kind (and type) with an agent proposal before
the first unmarked human decision; agent and model narrowing do not apply to it. `GET
/projects/{p}/auto-accepted?kind=&ruleId=&state=&agentPrincipalId=` is the ledger: one entry per
acceptance (subject, decision, trigger, rule name of the deciding revision, decider, agent, model,
tier, confidence, `state` `in-force` | `revoked` | `human-decided` with the later verdict), oldest
first, live chains only. Rule statistics (`inForce`, `revoked`, `confirmed`, `overruled`,
`lastAcceptedAt`) come from it. `Relation`, `Placement` and the assertion resources carry no marker
on purpose; the web joins the ledger. The ledger names rules and revisions, never their criteria,
and every human reviewer reads it (permission `review`), so editors see the marks too. Since M6
S2c-3 the preview fires per rule at its own triggers, a relation preview also carries
`derivedGroups` whatever the criteria, and items and ledger entries carry `proposedBy`
("Rules for derived calls" below).

**Routes and permission.** All under `/api/v1/projects/{project}`, every one `admin` (an owner on
an interactive client with `analyzr:write`) except the ledger: agent tokens get 403 `forbidden`,
foreign projects 404, anonymous 401. `GET`/`POST auto-accept-rules` (201 with `{outcome, rule}`
and `ETag: "r1"`), `GET`/`PUT auto-accept-rules/{rule}` (`ETag: "r<rev>"`; PUT the whole draft
with `If-Match`: 428 without, 412 `revision-conflict` with `headRev` on a stale tag, `unchanged`
when the draft equals the head whatever the tag, unless the author is no longer an owner (then the
save takes the rule over)), `POST auto-accept-rules/preview`, `POST auto-accept-rules/{rule}/apply`,
`POST auto-accept-revocations`, since M6 S2c-4 `GET pre-trust-calls` and `POST
pre-trust-calls/review` ([The trust rule](#the-trust-rule-m6-s2c-1)), and `GET auto-accepted`, the
ledger, with permission `review`
(editors and owners on an interactive client; agent tokens get 403 `human-decision-required`,
viewers 403 `forbidden`). A refused draft is 422 `validation-failed`: with `reason`
`unknown-agent`, `name-taken` or `kind-changed` (since M6 S2c-3 also a change of `proposedBy`) from
the domain, or with the schema's `errors` (field paths) for a tier of another kind, a type on a
placement rule, a confidence outside 0.5–1, control characters or criteria a rule for derived
calls may not name, which the contract refuses before the domain (it checks them again for other
callers; `derived-criteria`). Item lists of apply and revocations stop at 1000 (`truncated`). No MCP tool, resource or prompt; the MCP
snapshots are unchanged. The list also carries the **system rule** of decision 9 as amended by
24.2 (`analyzr-rules/1.0.0` „Eindeutige Aufrufe“, read-only, with the count of relations whose
acceptance rests on the rule tier and, since M6 S2c-1, `proposed`, the open proposals of unique
calls from derived models, `attrs.match` `derived-caller`, since S2c-2 only those a bulk accept
takes as they stand (tier `key`, no agent's question, no no-link: `isBulkDerivedCall`), and since
M6 S2c-4 `preTrust`, the rule tier's acceptances from before the trust rule whose caller would be
derived today and that the owner has not reviewed („Vor der Vertrauensregel angenommen“, counted by
`preTrustAcceptances`, the same list `GET …/pre-trust-calls` returns); its German description names
the trust rule, [The trust rule](#the-trust-rule-m6-s2c-1)), never stored as a rule row. Those
proposals are recorded by the rule tier, not an agent, so no agent rule accepts them (an agent
rule matches agent proposals only, pinned by tests); since M6 S2c-3 a rule for derived calls may
(next paragraph).

**Rules for derived calls** (M6 S2c-3; decision 24.2's
extension of decision 19, narrowed by decision 28 (1);
[M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §8 "S2c-3 as delivered", [The trust
rule](#the-trust-rule-m6-s2c-1)). A rule may accept the rule tier's proposals of unique calls from
derived models instead of agent proposals, narrowed by the source the caller declares.

- *Criteria.* `AutoAcceptCriteria` and the draft gain `proposedBy` (`agent` | `rule`, default
  `agent`), `derivedKind` (`export` | `converted` | `none`; `none`: the caller's uploaded revision
  declares no kind) and `converter` (trimmed, 1–120 characters, `MAX_AUTO_ACCEPT_CONVERTER_CHARS`,
  no control characters; matched exactly as stored, `name@version`). The contract's refinement
  `checkProposer`, the domain's `proposerFits` (reason `derived-criteria`) and the database check
  `auto_accept_rule_revision_proposer_check` (NULL-safe) say the same: an agent rule names
  neither; a rule for derived calls is a relation rule of tier `key`, type `call`, minimum
  `DERIVED_CALL_CONFIDENCE` (0.9), without agent, model or ad hoc, names a derived kind, and a
  converter exactly for `converted`; reconstructed and as-told cannot be named. Migration
  `0018_auto_accept_rule_tier.sql` (generated) adds `proposed_by text not null default 'agent'`,
  `derived_kind` and `converter` and the check; rows from before read as agent rules, and
  `draftFields`/`sameFields` cover the new fields, so saving an older rule unchanged writes
  nothing. `proposedBy` never changes on a revise (422 `kind-changed`).
- *Matching.* `ruleMatches`: an agent rule requires an agent's proposal, so an existing rule such as
  „Gleicher Name ab 90 %“ for any type or `call` never accepts the rule tier's proposal (pinned); a
  rule for derived calls requires the rule tier's proposal of a unique call from a derived model
  (`isDerivedCallProposal`: a rule proposal at tier `key` and 0.9 on a call with a rationale, told
  by the assertion, not by `attrs.match`) whose caller's uploaded revision declares the rule's kind
  (`none` for none) and, for `converted`, exactly its converter (`derivedCallView` over
  `trustByModel(headTrustRows)`; `null` for a modelled caller or one stored before S2c and not
  reviewed `derived`, M6 S2c-4).
- *Safeguards.* `not-agent` still blocks every trigger but an agent's proposal and a derived call's
  proposal. Right after `no-matching-rule` come `agent-upload` and `amendment-conflict`: no rule,
  an agent rule neither, accepts any proposal on a `call` whose caller's head revision (an amended
  head's upstream) was uploaded with an agent token since S2c-1 (or, since S2c-4, was stored before
  S2c and reviewed `derived` with the reason `agent-upload`) (`TriggerView.agentUploadedCaller`;
  decision 28 (1) read literally, "no rule ever"; `autoAcceptRelations` makes one more
  `headTrustRows` query, only when a call is among the triggers and a rule is enabled; the
  preview's open proposals, its replay and the dry run check it too), and a rule for derived calls
  never accepts a call whose call-target amendment is in `conflict`. The existing order follows.
- *The fifth write path.* `autoAcceptDerivedCalls` (`auto-accept/apply.ts`) runs in
  `afterHeadChange` right after `recomputeProject` (imports, PUT, amendment writes and
  withdrawals) and in `deleteModel` after its recompute (a deletion can make a duplicate process id
  unique), in the same transaction under the project lock. It evaluates only the derived-call
  proposals this write's recompute recorded (`derivedProposals`), in natural-key order, against
  the enabled rules for derived calls (`enabledDerivedCallRules`, one query), and records each
  acceptance through `recordRelationAutoAccept` under the rule's author, caused by the request's
  actor. No query when the write recorded none; nothing at all for a write made with an agent
  token (`sourceKindOf(actor) !== 'human'`: an agent's upload of a callee or its deletion of a
  duplicate never decides which call is accepted). Since M6 S2c-4 an owner's „Zurück in die
  Prüfung“ (`reviewPreTrustCalls`) runs it too, right after its recompute; it returns each
  acceptance with the rule that made it (`AutoAcceptedCall`), which the review's result counts. A
  proposal the rule tier records again on a relation it already proposed (a callee's fingerprint
  or the reasons changed) is a new proposal and accepted, as an agent's re-proposal after a model
  change is for agent rules; an unchanged or unrelated import records none, so older proposals
  still need `apply`.
- *Dry run.* `previewIngest` and `deletionImpact` add `ImportImpact.autoAcceptedCalls`
  (`ImpactAutoAcceptedCalls`: the capped items with `ruleId` and `ruleName`, `byRule` over all of
  them by the first matching rule in creation order, and `ofProposed`, how many of them
  `callsProposed` also counts; the others were proposals before and the rule tier asserts them
  again) only for an actor who passes `admin` (an owner on an interactive client: the web or the
  owner key), `count` 0 when the owner has no such rule; editors, viewers, read-only and agent
  tokens never get it, so no rule data reaches agents. The pure `autoAcceptedCalls`
  (`import-impact.ts`) mirrors the write over the plan's `histories` (new on `RecomputePlan`), so
  after the import the accepted calls equal `acceptedCalls` ∪ `autoAcceptedCalls`. The amendment
  effect's dry run does not include it (M6 §8 "S2c-3 as delivered").
- *Apply, preview, ledger, revocation.* `loadRelations` reads `headTrustRows`; apply and the
  preview pick each rule's triggers (`triggersOf`); the replay reads the caller's declared kind,
  converter, agent upload and conflicts from its current head, not from the revision the proposal
  was made under (an approximation, documented in `preview.ts`). `AutoAcceptPreview.derivedGroups`
  lists per source a rule can name (export, converted per converter, none; reconstructed, as-told
  and a conversion without converter left out) the open proposals a rule naming it would accept
  now, those a safeguard blocks, and the human acceptances and rejections so far.
  `AutoAcceptItem` and `AutoAcceptLedgerEntry` carry `proposedBy` (the item's `agent` is then the
  rule tier's principal). Revoking follows the trigger (Revoking above).

**Interactions.** Judge-once: an auto-accepted item is a human decision for every purpose
(`settles`, `suppressed`, claim inputs show `decision: accept, source: human` without a marker;
placements are homed and count for neighbours). Facts changes, re-confirmation and supersession
behave exactly as for human acceptances (an endpoint change makes an open item for a human; a rule
never re-confirms: `human-involved`); the trigger proposal is superseded like any pipeline
proposal while the decision stays. Token revocation withdraws the token's open proposals as before
and keeps its auto-acceptances (owner decisions); the agents page offers to revoke them too
(HANDOFF §8), and „Annahmeregeln“ revokes one agent's acceptances across rules. A manual placement
on an auto-accepted placement now counts as confirming it. An agent's ad-hoc placement proposal
still counts as its verdict, except that it never replaces another agent's current `unsure` row
of the process (`placement_input` keeps one row per process): that doubt stays the safeguard
`agent-unsure` for the write itself, later writes, the preview and "apply" (the process counts as
judged either way).

### The `analyzr` CLI

`node apps/cli/src/main.ts` (`pnpm analyzr` from the checkout, `analyzr` in the container). Global
options: `--url` (`ANALYZR_URL`, default http://127.0.0.1:7400), `--token` (`ANALYZR_TOKEN`, an agent
token), `--owner-key-file` (`ANALYZR_OWNER_KEY_FILE`).

**Parse guard** (M6 S3c step 3, both CLIs, every command): a word that reads as a flag, `--` and no
whitespace, is never an option value, at any occurrence (a repeated option, a list such as
`--scopes` or `--to`, `--name=--x`, the global options), nor an argument after the `--` that ends
the options. Either is a usage error, exit 2, before anything is read or sent:
`analyzr import b -p p --create --name --dry-run` prints
`analyzr: --name "--dry-run": an option value never starts with --; did you forget the name?`
instead of creating project `p` named "--dry-run" and importing for real (the last word is the
option's placeholder: `the project?` for `-p`, `the number?` for `--rev <n>`, `the revision?` for
`--base <rev>`), and `analyzr import -p p -- --dry-run` prints
`analyzr: argument "--dry-run": an argument never starts with --; an option belongs before the -- that ends them`.
Text with a space (`--text "-- siehe oben"`), a value with one dash (`--name -x`), environment
values and defaults pass; a real value without a space that starts with `--` (`--text "--siehe"`)
is refused too. Commander's own usage errors (an unknown option, a value missing at the very end)
keep exit 1.

**The integrate plugin's bundled CLI** (M6 S3c step 3, run from source as
`node apps/cli/src/plugin-main.ts` until plugin 0.1.4 bundles it as `scripts/analyzr.mjs`): the
same commands but `seed` and `mcp` (`apps/cli/src/core-program.ts`, which `src/program.ts` extends
with both), the same requests and output, with four differences. Its next steps (the table's
`import` row) and `status`'s hint for an analyzr without projects name `node <path of analyzr.mjs>`
(the path shell-quoted only where it needs it, as `shellArg` does), plus `--url <url>` when the URL
is not the default, instead of `analyzr` (`no projects yet: node <path> import <dir> --project <key>
--create`, without `seed`; the start-prompt line adds `(in analyzr's repository)`). It sends the
owner key only to analyzr on this machine: an http(s) URL without a user name or password whose
host, as fetch parses it, is `127.0.0.1`, `[::1]` or `localhost`, after setting `no_proxy` and
`NO_PROXY` to `*`; any other host exits 1 before any request with `this analyzr CLI sends the owner
key only to analyzr on this machine (127.0.0.1, [::1], localhost), not to <host>; for another
analyzr use an agent token (--token or ANALYZR_TOKEN)` (`status` says it in its note and exits 0),
while an agent token goes anywhere. Its `token create` outside the container prints, instead of the
Claude Desktop config, `Claude Desktop: the stdio bridge needs analyzr mcp from an analyzr checkout
or the container (docs/DEVELOPMENT.md); the plugin's analyzr.mjs has no mcp`. Last, its `--help`
keeps `Usage: analyzr …` with a description that says to run it as
`node <path of analyzr.mjs> <command>`.

| Command | Credential | |
|---|---|---|
| `analyzr seed [landscape…] [--corpus dir] [-p\|--project <key>] [--issue-tokens [--token-name <name>]] [--value-chains [--value-chains-dir <dir>]] [--verbose] [--json]` | owner key | one project per landscape of `eval/corpus` (default: every scored one, i.e. not starting with `_`; `_sample` seeds into `sample`), named after `landscape.yaml`; imports `models/`; safe to repeat (unchanged models stay unchanged). `--project` seeds exactly one named landscape into a project of that key, named `<landscape name> (<key>)` (a fresh project per live run; an existing project is refused with exit 1 before any import or token request); `--issue-tokens` creates a read+propose token per project (90 days), named `--token-name` (default `seed`; the name is the agent segment of `eval:live` recordings). `--value-chains` (M4 S4) also creates each landscape's golden value chain from `eval/value-chains/<landscape>/value-chain.vc.json` (or `--value-chains-dir`), after the import and before the token, without placements: a line `value chain: created r1` (`revived` for a deleted chain, `unchanged` when the head equals it, `exists r<n>, differs from the golden chain: left unchanged` for an edited chain, which is never overwritten, `no golden value chain` for `_sample`). Misuse (`--project` without exactly one landscape or with an invalid key, `--token-name` without `--issue-tokens`, `--value-chains-dir` without `--value-chains` or not a directory) is refused before any request. The JSON result names the `landscape` of each project and its `valueChain` (`{outcome, rev}`, `null` without the flag) |
| `analyzr import <dir> --project <key> [--create [--name n]] [--dry-run] [--verbose] [--json]` | agent token (`analyzr:write`) or owner key; `--dry-run` any credential | every file below `<dir>` the shared file rule picks up (M6 S1, `isImportPath` of `@analyzr/contracts/paths`, as the web upload: `.bpmn`, `.bpmn2`, `.bpmn20.xml`, `.xml`, case-insensitive; hidden files and directories, `node_modules` and symbolic links are skipped), in requests of ≤ 50 files and ≤ 25 MB, in code-point order (`comparePaths`, as the web); the model key is the path below `<dir>` (`modelKeyFromPath`, derived before sending: a path without a valid key, a key another file of the import gets, also in another request, and a file above 5 MB are reported `failed` locally in the server's wording and never sent; a key goes to the first `.bpmn…` file and only then to a plain `.xml`, `modelKeyOwners`, and the refusal names that file: `another file of this import has model key z (Z.bpmn)`); listed as `skipped` instead, outside `files` and `counts`, and never changing the exit code: a plain `.xml` whose key a `.bpmn…` file has (a tool's sidecar `Prozess.xml` next to `Prozess.bpmn`, `keyTakenBy`; never sent; reason `key-taken`, text `skipped   Prozess.xml  (same model key as Prozess.bpmn)`), while two `.bpmn…` files or two plain `.xml` files with one key stay `failed`, and a plain `.xml` the server refuses as no BPMN (422 `bpmn-invalid`, reason `not-bpmn`; text `skipped   meta.xml  (not BPMN)`); the summary names the reasons („N skipped (not BPMN)“ when all share one, „2 skipped (1 not BPMN, 1 same model key)“ otherwise); JSON: `skipped: [{path, reason, takenBy?}]`, only when non-empty; every other refusal (a DOCTYPE, …) stays `failed`; per-file outcome with the extractor's warnings by code (`warnings: 3 (invalid-id 2, parse-warning 1)`; beyond the extractor's 100 its own entry follows, `warnings: 100 (parse-warning 19, 81 more, 150 more warnings omitted)`; `--verbose` lists the entries, `--json` carries the result's `warnings` (≤ 20) and `warningCount`; warnings never change the exit code); in text mode it ends with the project's waiting work (`<project>: N relations tasks waiting, placement task waiting: yes\|no`, from `GET …/analyses?state=queued`, so any credential with `read` works; the project's state, not this import's effect; since M6 S2b's follow-up step 3b, while relations tasks wait, with the size of the agents' next run after them, `demo: 250 relations tasks waiting, about 7300 pairs to judge, placement task waiting: yes` (`1 pair to judge`; nothing for 0), from `GET …/summary`'s `pairsToJudge`, one request more, also `read`, left out when it fails; the whole number a preview in batches cannot give) and, only when something waits, the next agent step (`/analyzr:relations <project>` when relations tasks wait, `/analyzr:placements <project>` when the placement task waits, the start prompts in `examples/agents`); exit 1 if a file failed, or if every file was a plain `.xml` that is no BPMN (nothing imported: „no BPMN files below <dir>: N skipped (not BPMN)“, no next-step block); since M6 S5c-2 a model with live amendments adds `amendments: 2 applied, 1 already in the source, 1 conflict` to its line, and conflicts end in „N amendments no longer apply; see analyzr questions -p <project> --kind amendment-conflict“; since M6 S2a it reads `analyzr-import.json` at `<dir>` (the bundle's manifest, `analyzr-import/1`): checked with the contracts' `ImportManifest` before anything is sent, also before `--create` creates the project (an invalid one exits 1, „nothing imported“, naming the manifest's importer as a hint that a newer converter may need a newer analyzr); a `<dir>` without a manifest whose subfolders hold one (a workspace's `bundles/`) is refused before anything is sent („found analyzr-import.json in <folder>/: import that folder …“); the keys it pins win over the paths (also in the local duplicate check), each batch sends the manifest's subset for its files as the part `manifest` (compact JSON), text mode prints `manifest: analyzr-import.json (<system>), N of M files listed: keys pinned, provenance stored for N` (`…; K unchanged keep what analyzr had` for identical bytes, which keep their first provenance; since M6 S2b's follow-up step 5, when unchanged files record a new identity, counted from the files' `identityUpdated`, `provenance stored for 2; 4 unchanged keep their first revision's, 3 of them record a new tool id, folder or link`, `… 6 of them record …`, `… 1 of them records …`, `provenance stored for 5; 1 unchanged keeps its first revision's and records a new tool id, folder or link`; the dry run prints the same line) with the files it does not list (path keys, no provenance) and the ones it names that are missing, each file's import warnings (`manifest-sha-mismatch`, `external-id-moved`, `external-id-changed`, `provenance-kept`, since M6 S2c-1 `trust-kept`, always listed, never changing the exit code), `<project>: N import warnings (…); the files were imported` and, after `external-id-moved` or `external-id-changed`, a `next:` line each before the agent step (which then starts with `then:`), and for a bundle with a value chain the `value-chain push … --dry-run` to run next (the chain is never sent with the models); `--json` gains `manifest` `{system, listed, stored, kept, unlisted, missing, valueChain?}` only with a manifest (unchanged by step 5), and the files carry the server's `importWarnings` (since step 5 also `identityUpdated`); since M6 S2b `--dry-run` previews into an existing project (not with `--create`) through `POST …/imports?dryRun=true`, each batch with the whole manifest (so every batch knows which keys the bundle names), prints the same lines and then what the import would change (`<project>: dry run, nothing imported; the import would` … the facts of N models changed with processes added and removed; since M6 S2b's follow-up step 3 right after it the agent work: `  agent work: queue 3 relations tasks, 214 pairs to judge (56 judged again); placement task: queued, 7 processes to place (5 again)` (`  agent work: none` without any, `no relations task; …` with only the placement part; the placement part by outcome and counted as the web counts it: a task the import queues places every process due, also those due before, `queued, 9 processes to place (1 again)`; one waiting or held the newly due ones, with all that are due then, `already queued, 1 process to place, 9 due in all`, `an agent holds it; 2 processes to place in its follow-up (1 again), 3 due in all` or `… nothing new to place in its follow-up`; `nothing due`; no part when no file changes facts or the project has no chain; `about` in front of the counts several batches add up), the relations tasks it cancels (`  cancel relations tasks: 2 (vertrieb/auftrag claimed by agent:claude, 34 pairs assigned; finanzen/rechnung queued)`) and, while agents hold some of them, a warning as `models amend` gives it (`  warning: an agent is working on the relations task of vertrieb/auftrag right now; the import cancels the task and the agent's work is lost`; several: `  warning: agents are working on the relations tasks of 7 of these models right now (a, b, c, d, e, … 2 more); the import cancels them and their work is lost`); then rule-tier calls accepted, since M6 S2c-1 and only when there are any the unique calls of derived callers only proposed (`propose instead of accept (trust rule): 12 (no engine 10, agent token 2), 3 of them accepted until now`, from the server's totals over all of them), rule proposals added, rule stances withdrawn, accepted relations losing or changing an end, since step 3, with a live value chain and only when there are any, accepted placements losing or changing their process (`  change or lose the process of accepted placements: 2: lager/versand#Process_1 on "Versand" (missing), lager/zoll#Process_2 on @outside (changed)`; the step id for `@outside` and for a step without a name), findings added and resolved, up to five examples each, the keys not in the bundle (kept, nothing deleted), and for several batches that each was previewed against the head, so a call into a later batch shows as unresolved, since step 3 `…, and the pairs between new models of different batches are not counted`, since step 3b followed by ` (after the import, the waiting line and analyzr status count them)`); `--json` gains `impact` (the batches' merged, `callsProposed`'s totals added up; since M6 S2b's follow-up step 1 merged by the contracts' zod-free `mergeImpacts`, `@analyzr/contracts/impact-merge`, which the web shares, and carrying `relationsTasks`: the tasks queued, sorted by key, and cancelled, claimed first, concatenated, `claimed` and `pairs` added up, the pairs judged again deduplicated; since step 2, with a live value chain, `placementsChanged`, concatenated, sorted by process, then step, and capped, and `placementTask` with the strongest outcome, the largest batch's `due` and `newlyDue` and `again` added up; their text lines above since step 3) and `batches`; a file that would fail exits 1, and no waiting tasks are listed; since M6 S2c-1 a file whose model is derived carries `trust` (`{class, reasons}`) in `--json`; since M6 S2c-2, after an import whose files include derived models (unchanged ones too), text mode counts the unique calls of derived models that wait for a bulk accept (every page of `GET …/relations?type=call&status=proposed&tier=key`, permission `read`, counted with the contracts' `isBulkDerivedCall`, so the number is the selection the web's link opens) and, only when at least one waits, prints before the agent step (which then starts with `then:`) `next: 6 models are derived (no engine 6); 1 unique call is a proposal: accept it in the web review before the agent runs:` and the link `  <url>/projects/<p>/review?bulk=calls` (the models are this import's derived files, each under its first reason; an import of modelled files only asks nothing, so calls still waiting from an earlier import go unmentioned there); with an agent token (`--token`, or `ANALYZR_TOKEN`, which it prefers to the owner key) it says once on stderr before anything is sent, also for `--dry-run`, `importing with an agent token (ANALYZR_TOKEN): unique calls become proposals (trust rule); unset ANALYZR_TOKEN to import with the owner key` (with `--token`: `… (--token): …; drop --token to import with the owner key`), never with the owner key or `--create`; since M6 S2c-3 an owner's dry run (the owner key; `impact.autoAcceptedCalls` merged across batches, `ofProposed` added up) adds `  accept by your rules for derived calls: 12 ("Aufrufe: Export ohne Engine" 12)` with up to five examples, and with the owner key only the `next:` block gets a third line for the source most of the waiting calls' callers among this import's derived files declare (`ruleSource`; agent uploads, reconstructed and as-told files and a conversion without converter count for nothing), from the project's rules (one request; the line is left out when it fails): `  or let the owner rule "<name>" accept them: analyzr rules apply <id> -p <p>` while a rule naming that source is on (rules are never retroactive), `  or turn on the owner rule "<name>" for that source: analyzr rules enable <id> -p <p>` while it is off, else `  or add an owner rule that accepts that source's next calls: analyzr rules add --name <name> --derived <kind> [--converter <c>] -p <p>` (no `--enable`: the rule starts off and `rules add` says how to turn it on; the name as the web suggests it, at most 100 characters, „(2)“ … when taken); its arguments and the value-chain `push` line's path and project are POSIX-shell-quoted (`shellArg`), so a manifest cannot plant `$(…)` or backticks in a line the owner pastes; `--json` keeps stdout pure JSON and prints no `next:` line; since M6 S3c step 3 a word that reads as a flag as an option value is refused before anything is read or sent (the parse guard above: `analyzr import b -p p --create --name --dry-run` exits 2 with `analyzr: --name "--dry-run": an option value never starts with --; did you forget the name?`), and the integrate plugin's bundled CLI names `node <path of analyzr.mjs>` (plus `--url <url>` unless the default) instead of `analyzr` in every line above that names a command: the amendment conflicts' `questions`, the identity steps' `models delete` and `models external-ids`, the owner rule steps' `rules apply`, `rules enable` and `rules add`, the agent step's `token create` (after "the start prompts in examples/agents (in analyzr's repository)"), the `value-chain push` line and the batch line's `status` |
| `analyzr models list -p <key> [--stage <stage>] [--json]` (M6 S1) | agent token or owner key | every page of `GET …/models`: key, stage, head revision, engine, open items; `--stage` is checked before any request |
| `analyzr models requeue -p <key> (<key>… \| --all) [--json]` (M6 S1) | owner key, or an agent token with `analyzr:write` | `POST …/analyses/requeue` with `{modelKeys}` (≤ 1,000, checked before any request) or `{all: true}`: `queued`, `open` (a task is already queued or claimed) or `not-found` per model; exit 1 if a key has no live model |
| `analyzr models delete <key>… -p <key> [--yes] [--json]` (M6 S1) | owner key only (an agent token is refused before any request; the server's policy lets any `write` credential delete) | resolves the keys through `GET …/models` (deleting takes the `mdl_` id); an unknown key exits 1 before anything is deleted; without `--yes` it lists the models (key, stage, open items), says that partner relations turn `missing` and that uploading a key again revives its model, and exits 1 („nothing deleted“); with `--yes` `DELETE …/models/{model}` one by one (`--json`: `{deleted, models}`; when a DELETE fails, `{deleted, models, failed: {key, error}}` with the models deleted before it, then exit 1). Since M6 S2b the listing without `--yes` adds each deletion's impact (`GET …/deletion-impact`, each against the project's head): `<key>: 2 accepted relations lose an end (missing), 5 rule stances withdrawn, findings 2 added, 0 resolved` (`--json`: `impacts: [{key, impact}]`, each impact since M6 S2b's follow-up step 1 with `relationsTasks`, the model's open task the deletion cancels, and since step 2, with a live value chain, `placementsChanged` (the model's accepted placements turning `missing`) and `placementTask` (`not-triggered`, with the processes due after the deletion, `due`, those it makes due, `newlyDue`, and those of them placed again, `again`)); since M6 S2c-1 also `N calls only proposed (trust rule)` when there are any, since S2c-3 with the owner key `N calls accepted by your rules for derived calls` (a duplicate process id gone); since M6 S2b's follow-up step 3, each only when not zero, `relations task cancelled` (or `relations task cancelled while an agent works on it (its work is lost)`), `2 accepted placements lose their process (missing)` and `3 processes become due for placement`, and when any deletion makes processes due the listing says once, after its lines, `Deleting queues no placement task; afterwards analyzr value-chain requeue -p <key> queues it unless one waits.` |
| `analyzr models external-ids -p <key> [--system <system>] [--json]` (M6 S2a) | agent token or owner key | `GET …/external-ids`: per live model with a declared identity its key, tool id (`-` when the manifest named none) and tool folder, as the newest import declared them (since M6 S2b's follow-up step 5 the model's newest identity row, also for unchanged bytes; a head stored without a manifest keeps the newest row; before, the head's uploaded revision, else the newest revision a manifest declared), the count per system, and a line per tool id several keys carry (`signavio id sid-… on 2 keys: …`, one model twice after `external-id-moved`); `--system` (a lowercase slug, checked before any request) keeps one; the JSON is the response, from which a lost workspace's `keymap.json` is rebuilt |
| `analyzr questions [list] -p <key> [--model <key or folder>] [--kind <kind>] [--source <source>] [--ask-who <name>] [--state open\|answered] [--group <group>…] [--format text\|md\|csv\|json] [-o <file>]` (M6 S4; `--group` since UX2a) | agent token (`analyzr:read`) or owner key | the open questions ([M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §4.2); `list` is the default subcommand of `questions` (M6 S5a), so `analyzr questions -p …` lists: `text` (default) and `json` page through `GET …/open-questions` (questions first, then the value chain's findings, then the informational items, each by `unlocks` descending): a header, one line per question (id, unlocks, kind, the first model key with `+N` for more or `-` for steps and the chain, `subject: question` as the server returns them, line breaks folded into one space, `  [answered: outside the landscape]` after a marked item; since S5c-1 also the primary action, and under a question the suggested targets as `„Name“ (ref)` with the proposals a link to each accepts) and `<project> (<filters>): N open questions (kind n, …)` with `, N answered (outside the landscape)` when marks are recorded and, since UX2a, `; groups: ask n, agent n, …` (`no open questions in …` when none match), or every item as one JSON array; `md` (also `markdown`) and `csv` write `GET …/open-questions/export`'s bytes verbatim (the CSV with its byte order mark and the `Antwort` column, empty or holding the item's latest note, without the informational items; both only the `ask` items unless `--group`, `--kind` or `--source` says otherwise); `--group` (`ask`, `agent`, `proposal`, `info`) repeats or takes a comma-separated list, and the list shows every group without it; every flag is checked before any request (`--ask-who`: a lane, one step owner or the folder, exactly, ≤ 200 characters); `-o` writes to a file |
| `analyzr questions answer <id> -p <key> --text <text> [--json]`, `analyzr questions answer -p <key> --from <csv> [--dry-run] [--json]` (M6 S5a; notes without kinds since S5c-1) | owner key only (an agent token is refused before any request: only humans answer) | one note (`POST …/open-questions/{q}/answers`; the text normalized as the server stores it, ≤ 2,000 characters; `--kind` is refused since S5c-1 with a hint at `questions outside`; no dry run, the single route has none): what was recorded, where the text landed and what it does by the item's subject and kind (a note never ends the item; its action does, named with where to run it), the personal-data warning; or a filled-in sheet (UTF-8 only; only the rows with an `Antwort` are sent, in one call to `POST …/open-questions/answers`, `--dry-run` previews; an S5a sheet's `Antwortart` still reads, „Liegt außerhalb der Landschaft“ as the outside mark except on a relation or placement item): one line per sent row under its spreadsheet row (blank rows and the header counted), the counts, exit 1 when a filled row is (or would be) left out |
| `analyzr questions outside <id> -p <key> [--note <text>] [--json]`, `… --undo <answer id>` (M6 S5c-1) | owner key only (an agent token is refused before any request) | the outside mark „Liegt außerhalb der Landschaft“ (`POST …/open-questions/{q}/actions` `{type: 'outside'}`; the item turns `answered`, a second mark is `unchanged`) with the line to undo it; `--undo` withdraws the mark (`POST …/answers/{a}/withdrawal`), the item is open again |
| `analyzr questions link <id> -p <key> --to <target>… \| --pair <from> <to> [--note <text>] [--json]` (M6 S5c-1) | owner key only | links the item's anchor to each target (a ref, the key of a model with one process, or a unique process name; an ambiguous or unknown one lists the candidates and sends nothing; `--to` repeats for a dynamic call's possible targets, ≤ 10); an `unjudged` item links one of its listed pairs with `--pair`: per relation `wrote the accepted manual relation …` or `accepted the <type> proposal …`, what became of the item, and the web UI's review screen for each relation (to reject a manual one, „Rückgängig“; to change a decision) |
| `analyzr questions place <id> -p <key> --step <element id>\|@outside \| --process <target> [--note <text>] [--json]` (M6 S5c-1) | owner key only | places the item's process on the step (a manual placement, accepted at once); a step item (`step-without-process`) takes the process with `--process`: where it is placed, what became of the item, and the value chain page of the placement (`?placement=`) to reject it, or to change it when the placement decided an agent's proposal on that step |
| `analyzr models amend <key> -p <key> --element <id> (--call-target <target> \| --message-name <name> \| --name <label> \| --documentation <text>) [--partner <ref>] [--dry-run] [--yes] [--json]` (M6 S5c-2) | owner key only (an agent token is refused before any request: amendments are human decisions about content, `review` and `write`) | sets one field of one element as an amendment (M6 §4.8 c): reads the element's amendable fields (`GET …/elements/{id}/amendable`, its ETag sent as `If-Match`), resolves a call target as `questions link` does, dry-runs (`POST …/amendments?dryRun=true`) and prints the effect and the cost (the pairs judged again); stops there with `--dry-run`, for a field that is not applicable (exit 1), when nothing changes, and when an agent holds the model's relations task unless `--yes`; else saves with the same `If-Match` and prints the recorded amendment and the new head, computed from the uploaded revision |
| `analyzr questions amend <id> -p <key> [--element <id>] [--call-target … \| --message-name … \| --name … \| --documentation …] [--dry-run] [--yes] [--json]` (M6 S5c-2) | owner key only | runs an item's `amend` action: the model, the element and the live amendment it replaces come from the action; `--element` picks one of several targets; without a value the action's prefilled value („Meine Ergänzung behalten“ on an `amendment-conflict`) |
| `analyzr models pull <key> -p <key> [--original] [-o <file>]` (M6 S5c-2) | agent token or owner key | the head's bytes (amended or not) verbatim, or with `--original` the uploaded revision's; stderr names the revision, its content hash and how it relates to the other |
| `analyzr amendments list\|export -p <key> [--model <key or folder>] [--state <state>] [--json]`, `export [--since <seq>] [--format md\|csv] [-o <file>]` (M6 S5c-2) | agent token or owner key | every amendment with its state (`applied`, `in-source`, `conflict` with its reason, `withdrawn`, `superseded`, „model deleted“), before → after; the change list's bytes verbatim (per model what to carry over into the source tool first, then what is done; the CSV with raw values), with the event to pass as `--since` next time |
| `analyzr amendments withdraw (<id> \| --model <key>) -p <key> [--rev <n>] [--json]` (M6 S5c-2) | owner key only | withdraws one amendment, or every live amendment of a model in one step: a new head re-derived from the uploaded revision without them (a deleted model gets none, only the withdrawals); `--rev` sends `If-Match: "r<n>"`, so an amendment recorded since the human looked is not withdrawn unseen (412) |
| `analyzr token create --project <key> [--name] [--scopes …] [--expires 90d] [--json]` | owner key | scopes `analyzr:read`, `analyzr:propose`, `analyzr:write` (also `read,propose`); expiry `Nd` or `Nw`, ≤ 365 days; prints the secret, the Claude Code command and the Claude Desktop config (`mcp` of this checkout's `main.ts`, in the container `docker exec`); the integrate plugin's bundled CLI (M6 S3c step 3) prints instead of that config, outside the container, `Claude Desktop: the stdio bridge needs analyzr mcp from an analyzr checkout or the container (docs/DEVELOPMENT.md); the plugin's analyzr.mjs has no mcp` |
| `analyzr token list` / `analyzr token revoke <id>` (`--project <key>`) | owner key | |
| `analyzr status [--project <key>] [--json]` | agent token or owner key (optional) | health, caller, per project models by stage, relations by status, accepted relations with changed/missing endpoints, findings; since M6 S2b's follow-up step 3b, while models wait for an agent, the models line names the size of the agents' next run (`  models     31 (31 waiting for agent), about 198 pairs to judge`, `1 pair to judge`, nothing for 0) from `GET …/summary`'s `pairsToJudge` (one request more per such project, none while nothing waits); `--json` carries `pairsToJudge` per project (0 while no model waits, `null` when the summary cannot be read, and the text line then leaves it out); without projects it ends with `no projects yet: analyzr seed, or analyzr import <dir> --project <key> --create`, in the integrate plugin's bundled CLI (M6 S3c step 3) `no projects yet: node <path> import <dir> --project <key> --create`; there a refused owner key (another host than this machine) shows as `no credentials, so no projects: …`, exit 0 |
| `analyzr health` | none | |
| `analyzr value-chain push <file> --project <key> [--key main] [--base <rev> \| --force] [--dry-run] [--yes] [--json]` | owner key only (an agent token is refused before any request: agents never edit the chain) | reads the file (≤ 2 MiB, JSON) and the head revision (`GET …/content`); `If-Match` names `--base`, the revision the file was pulled from (`r<rev>` from `pull`); for an existing chain it refuses to save without `--base` (exit 1), since the head read at push time would let it silently revert a save made after the pull; `--force` saves on the current head; content equal to the head is `unchanged` and `--dry-run` works without either; `If-None-Match: *` when the project has no chain. A dry run first; stops with exit 1 before stranding placements or sending accepted ones to re-confirm unless `--yes`, then saves; `--dry-run` prints the impact only; 412 "pull first", 422 lists the violations with their element ids |
| `analyzr value-chain pull --project <key> [--key main] [--rev <n>] [-o <file>]` | agent token or owner key | writes the canonical `.vc.json` of the head (or revision `n`) verbatim (stdout by default) and `r<rev> <sha256>` on stderr (`r<rev>` is the `--base` of the next push) |
| `analyzr value-chain requeue --project <key> [--json]` (M4 S5) | owner key, or an agent token with `analyzr:write` | `POST …/analyses/requeue {valueChain: true}`: queues the chain's placement task when an open process is due (after a failed task, or for processes human decisions and notes made due, which never queue a task themselves); prints `queued placement task <id>`, that one is already queued or claimed, or `nothing due`; exit 1 without a chain |
| `analyzr rules list\|show <id> -p <key> [--json]` (owner decision 19) | owner key only (an agent token is refused before any request) | `list`: the system rule (decision 9 as amended by 24.2, read-only: `system rule analyzr-rules/1.0.0 "Eindeutige Aufrufe": call relations of modelled callers, always on, read-only; N accepted`, since M6 S2c-1 with `, M only proposed (derived callers, trust rule)` while such proposals are open, since S2c-3 `…; analyzr rules add --derived accepts the next ones)`, since S2c-4 `, K accepted before the trust rule from callers that would be derived today (review them: analyzr rules pre-trust)` while such acceptances wait) and every rule with its head revision, criteria (a rule for derived calls `rule tier (derived call): export`, `converted normalize-bpmn@0.1.0` or `none (no kind declared)`), author and what it accepted (in force, revoked, confirmed, overruled; a warning when its author is no longer an owner); `show`: the immutable revisions |
| `analyzr rules add --name <n> --kind relation\|placement --tier <tier> --min 0.9\|90% [--type <t>] [--agent <agt_…\|token name\|prn_…>] [--model <id>] [--ad-hoc] [--note <text>] [--enable] -p <key> [--json]` | owner key only | creates a rule, **off unless `--enable`**, and prints its preview; flags are checked before any request (kind, tiers per kind, the 50 % floor, a type only for relations); the agent is resolved through the token list (`AgentToken.principalId`; a name with one live token, else ask for the id) |
| `analyzr rules add --name <n> --derived export\|converted\|none [--converter <name@version>] [--note <text>] [--enable] -p <key> [--json]` (M6 S2c-3) | owner key only | a rule for derived calls: the rule tier's proposals of unique calls from derived models whose caller declares that source; kind, tier, type and minimum are fixed (relation, key, call, 90 %), so `--kind`, `--tier`, `--min`, `--type`, `--agent`, `--model` and `--ad-hoc` are refused with it; `--converter` exactly with `converted` (≤ 120 characters); `reconstructed` and `as-told` are refused (`… (no rule accepts calls of reconstructed or as-told models)`); off unless `--enable`; the preview shows the humans' verdicts on such calls, the open ones it would accept with `rule tier (derived call)` as proposer, and the project's sources (`sources (as the callers declare them now):` with open, blocked, accepted and rejected per source), no curve |
| `analyzr rules edit <id> [flags] -p <key>`, `enable <id>`, `disable <id>` | owner key only | reads the head, merges the flags (`any` drops a narrowing: `--type any`, `--agent any`, `--model any`; `--no-ad-hoc`; `--note ""` removes the note; the kind never changes, nor whose proposals it accepts: since M6 S2c-3 a rule for derived calls takes `--derived`, `--converter`, `--name` and `--note` only, and an agent rule never `--derived` or `--converter`) and saves the next revision with `If-Match: "r<head>"` (412: "changed meanwhile, run again"; a 422 names the server's reason or the refused fields); saving a rule whose author is no longer an owner takes it over, also `edit <id>` without flags ("taken over"); `enable` reports how many open proposals already match and points to `apply` (rules are never retroactive); thresholds print with every decimal they have (`90.04%`) |
| `analyzr rules preview [<id>] [flags] -p <key> [--json]` | owner key only | a saved rule (changed by flags) or an unsaved one (`--kind --tier --min`, since M6 S2c-3 or `--derived …`): history with precision, open now with blocked reasons, the curve (a rule for derived calls: the sources per declared kind instead) |
| `analyzr rules apply <id> [--dry-run] [--yes] -p <key> [--json]` | owner key only | prints the dry run; accepts only with `--yes`, passing the head revision and the dry run's count as `expectedCount` (409: "nothing changed, run again"); without `--yes` and with matches it exits 1 ("nothing accepted yet"). While the rule is off it says to `enable` it first, while its author is no longer an owner how to take it over (`edit <id>`), and never suggests `--yes` or a rerun (also for the 409 reasons `rule-disabled` and `author-not-owner`) |
| `analyzr rules revoke [<id>] [--revision <n>] [--agent <a>] [--kind <k>] [--ids <id…>] [--reason <text>] [--dry-run] [--yes] -p <key> [--json]` | owner key only | the same dry-run pattern for revocations: how many go back to review, become obsolete, were decided by a human since (untouched) or revoked before |
| `analyzr rules pre-trust -p <key> [--model <key…>] [--revoke\|--keep] [--dry-run] [--yes] [--json]` (M6 S2c-4) | owner key only (an agent token is refused before any request) | „Vor der Vertrauensregel angenommen“: without `--revoke` or `--keep` the list (`GET …/pre-trust-calls`): per model its key, name, `r<rev>`, count and reasons, then its calls (`… N more` past 100), and `next: send them back to review with analyzr rules pre-trust --revoke -p <key>, or keep them accepted with --keep (each model is decided once; --model narrows)`; nothing listed: `nothing in <key> was accepted before the trust rule from a caller that would be derived today`. `--model` (repeated or comma-separated) narrows to listed models; an unknown one exits 1 naming the listed ones; `--revoke` with `--keep` and `--yes` without either are refused. With a verdict it prints the dry run (`--revoke`: how many calls of how many models would go back to review and become proposals of the rule tier, and `your rules for derived calls would accept N of them again (and M other proposals): "<rule>" N`; `--keep`: `… would stay accepted; the model would never be listed again`) and exits 1 ("nothing changed yet: run the command again with --yes …") unless `--dry-run`; `--yes` sends the dry run's count as `expectedCount`, and after `--revoke` with calls left it prints `next: accept them in the web review („Gesammelt annehmen“):` and the full link `…/projects/<key>/review?bulk=calls`. A 409 (dry run or review) is explained: nothing changed, run it again. `--json`: the list, or `PreTrustReviewResult` (also an empty one when nothing is listed) |
| `analyzr mcp` | agent token | the stdio bridge above |

### The integrate plugin and `tools/integrate` (M6 S3b)

`plugins/analyzr-integrate` is a second Claude Code plugin, next to the pipeline plugin
`plugins/analyzr`, for interactive, non-pipeline skills
([M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §3.7, "S3b as delivered" in §8). Its
version lives in its own `.claude-plugin/plugin.json` (0.1.3 since M6 S2b's follow-up step 4) and moves with
every change of any plugin file: `RELEASES` in `tools/integrate/test/plugin.test.ts` pins a
sha256 over the plugin's files per version, and the failing test prints the new hash. Its skills are unversioned (no
`RELEASED` or `PLUGIN_RELEASES` row); the marketplace entry is pinned in
`packages/procedures/test/plugin.test.ts`. Install it with `claude plugin install
analyzr-integrate@analyzr` or `--plugin-dir plugins/analyzr-integrate`
([examples/agents/claude-code/README.md](../examples/agents/claude-code/README.md)); live runs never
load it (`--plugin-dir plugins/analyzr` only). Codex reads the same `SKILL.md` by path
([examples/agents/codex/README.md](../examples/agents/codex/README.md)).

`/analyzr-integrate:integrate-landscape <export> [--workspace <dir>]` (`disable-model-invocation`,
needs a shell and Node 24) turns a customer's BPMN 2.0 export into an import bundle
`analyzr-import/1` and a German report in the consultant's workspace: one per customer, outside
any checkout (`analyzr-workspace.json`, `exports/`, `keymap.json`, `inventory/`, `bundles/`,
`reports/`). It inspects the export, asks three confirmations (tool, format and path with the
folders to leave out; the keys; complete export or excerpt), pins the keys in `keymap.json`,
writes the bundle and the report, and stops. For other formats it reports what it found and
stops (v0 has no converter). It never imports and never writes to analyzr: up to 0.1.2 its only
analyzr commands were `GET /health` and `models list` (read-only, to flag keys analyzr already
has); since 0.1.3 they are `GET /health` and the plugin's read-only `analyzr-read.mjs` (below),
with the CLI's `models list`, `models external-ids` and `import … --dry-run` only as fallbacks the
consultant approves once; it prints the import as `<cli> --url "<analyzrUrl>" import …` and as
the web path („Hochladen“ with the bundle folder), and the consultant runs it. Since M6 S2a `analyzr import` reads
`analyzr-import.json` (pinned keys, declared provenance, import warnings; [the CLI](#the-analyzr-cli)),
and since UX8 „Hochladen“ reads it too, so both record the same keys and provenance; identical
bytes imported later keep a revision's first provenance (since M6 S2b's follow-up step 5 with their
declared tool id, folder and link recorded, [below](#m6-s2b-follow-up-step-5-2026-10-20)), so the
skill says to import the bundle folder itself (files one by one carry no manifest). 0.1.1 (S2a)
still preferred the CLI and marked the web path „ohne
Herkunftsangaben“; 0.1.2 (M6 S2c-2, texts only, no script changed) drops that, recommends the
dry run (`analyzr import … --dry-run`, or the web's „Vorschau“) instead of a probe project, and
says in the report and the Signavio note that the unique calls of an engine-less or converted
bundle arrive as 90 % proposals, which the consultant accepts in one step with „Gesammelt
annehmen“ before the relations run ([The trust rule](#the-trust-rule-m6-s2c-1)). 0.1.3 (M6 S2b's
follow-up step 4, [below](#m6-s2b-follow-up-step-4-2026-10-20)) lets the skill do three things
itself. It reads the project's models and identities (`analyzr-read.mjs models` and
`external-ids` into `reports/`) and plans with `--existing` and `--from-analyzr` whenever it
could read them (analyzr has the project and answers), so a lost or stale `keymap.json` is
rebuilt from analyzr before any key is derived afresh (a re-export of a landscape analyzr has
keeps every key, and a tool id several keys carry is named as a likely duplicate import with the
`models delete` command for the consultant). It previews the import (`analyzr-read.mjs preview`
into an existing project only; for a missing one it asks the consultant to create it in the web
first). And its report gains a section „Vorschau“ with the agent work the import sets off,
repeats or destroys: the headline, the impact lines, the cost line, the claimed-task warning and
the batch notes in the web's words, and three texts of the skill's own, taken from the plan since
the web has no such line (for the tasks queued and cancelled „Neue Aufgaben für den Agenten: …“,
after the warning the advice „Warte am besten, bis er abgegeben hat, oder nimm den Verlust in
Kauf.“, for a placement task an agent holds „Ein Agent platziert gerade; geänderte Prozesse
kommen danach noch einmal.“); and a „Kurzfassung“ line naming that agent work.
`normalize-bpmn` declares an export's `exporterVersion` tidied as analyzr stores it (blank or over
100 characters: none). The reference notes
`reference/{signavio,aris,visio,adonis,bizagi}.md` have the sections "Export paths", "What
arrives", "Pitfalls" and "Mapping to analyzr" and are unverified (no real or sandbox export yet,
M6 §10.4).

The scripts need Node 24 (`inspect` and `normalize-bpmn` no network; `analyzr-read` only analyzr
on this machine), never write into the export or into an analyzr checkout (`src/guards.ts`,
symbolic links resolved), print short JSON on stdout and exit 0, 1 when the work fails, 2 on a
usage error (`--help` prints the usage):

| Script | What it does |
|---|---|
| `inspect.mjs <export> [--summary]` | reads only: per file size, sha256, kind (`bpmn`, `xml`, `zip`, `ole2`, `pdf`, `image`, `text`, `binary`), encoding, XML root and namespaces, a BPMN summary, a zip listing and tool markers; `--summary` gives totals, tools, files per folder, archive-like folders and files, and the notable files. Pre-approved by the skill (since 0.1.3 together with `analyzr-read.mjs`) |
| `normalize-bpmn.mjs file <in> <out>` | one file: bytes analyzr reads completely pass through (`derived.kind` `export`); otherwise UTF-16 and declared ISO-8859-1 or windows-1252 become UTF-8, unsafe, duplicate and missing ids are rewritten by M6 §3.4 rule 2 with every reference following, and bpmn-moddle writes the result (`converted`, `normalize-bpmn@0.1.0`); losses `id-rewritten`, `element-dropped`, `attribute-dropped`, `layout-missing`; a DOCTYPE is refused, the input may be up to 10 MB, the output at most 5 MB and 50,000 elements (written compact when indenting would exceed 5 MB) |
| `normalize-bpmn.mjs plan <export> --workspace <dir> --system <s> …` | the model keys against `keymap.json`: known, moved, new, collisions, flags, absent; `--strip` and `--prefix` set the key rule (first import only), `--scope` or `--whole-system`, `--exclude` and `--no-exclude`, `--existing <models.json>` (the output of `analyzr models list --json` or `analyzr-read.mjs models`; since 0.1.3 also the model ids, which tell the older of two models), `--from-analyzr <external-ids.json>` (since 0.1.3: the output of `analyzr models external-ids --json` or `analyzr-read.mjs external-ids`; plans against the key map rebuilt from it, `rebuilt` in the output, below), `--reset` (refused with `--from-analyzr` while analyzr has models of the system); `--write` records the plan, with what it took from analyzr, after the consultant's yes and never removes an entry |
| `normalize-bpmn.mjs bundle <export> --workspace <dir> --system <s> --out <dir> …` | the bundle in an empty folder: every model normalized at its key's path, `analyzr-import.json` and, with `--inventory`, `inventory.json`; refuses while a model has no confirmed key; exit 1 with `failed` entries (the bundle holds every other file) |
| `normalize-bpmn.mjs inventory <catalog.csv> --name <column> --out <file> …` | a process catalog (CSV, UTF-8 or Windows-1252, `;`, `,` or tab) as `analyzr-inventory/1`, with only the named columns (`--id`, `--area`, `--external-id`) |
| `analyzr-read.mjs models -p <project> --url <url> --json-out <file.models.json>` | since 0.1.3: every page of `GET …/projects/{p}/models` into the file, as `analyzr models list --json` prints it (`plan --existing` reads it) |
| `analyzr-read.mjs external-ids -p <project> --url <url> [--system <s>] --json-out <file.external-ids.json>` | since 0.1.3: `GET …/projects/{p}/external-ids` into the file, as `analyzr models external-ids --json` prints it (`plan --from-analyzr` reads it) |
| `analyzr-read.mjs preview <bundle> -p <project> --url <url> [--json-out <file.preview.json>]` | since 0.1.3: the import of a bundle (a folder with `analyzr-import.json`) previewed exactly as `analyzr import <bundle> --dry-run` sends it (`src/preview.ts`: the files `isImportPath` picks up in `comparePaths` order, each under the key the manifest pins, `modelKeyOwners`, local failures as the CLI's, batches of at most 50 files and 25 MB, each with the whole manifest, to `POST …/imports?dryRun=true`), the batches merged with the shared `mergeImpacts`; the file gets what `analyzr import --dry-run --json` prints, stdout `credential`, `batches`, `batchesWithNew` (batches holding a new model), `counts`, `manifest`, the files that would fail or carry warnings, `skipped`, the impact's counts and `agentWork` (relations `queued`, `cancelled`, `claimed` with `claimedKeys`, `pairs`, `rejudged`; placement `outcome`, `toPlace` counted as the web's `processesToPlace`, `again`); exit 1 when a file would fail, with the JSON printed |

`plan` and `bundle` write their complete result into the file `--json-out` names; `analyzr-read`'s
`--json-out` takes only a file of its own kind (`*.models.json`, `*.external-ids.json`,
`*.preview.json`) in an existing `reports/` next to `analyzr-workspace.json` (the guard below).

**The key-map rebuild** (since 0.1.3; the pure `rebuildFromAnalyzr` and `inferRule` in
`src/keymap.ts`, `plan --write` stays the only writer, the format `analyzr-keymap/1` unchanged,
the result checked with `parseKeymap`): (1) a system missing from the map gets analyzr's live
identities of that system as its entries, with the rule inferred from them (or `--strip` and
`--prefix`, only while the map lacks the system), the whole system as its scope and nothing
excluded; a key without a tool path is skipped and listed; if analyzr has none of the system's
models, the map stays as it is and the plan is a first import; (2) generic tool ids count as none;
a tool id several keys carry stays with the key the map already gives it (`keptBy: keymap`), else
with the oldest model's key, the smallest `mdl_` ULID of `--existing` (`oldest`), or, when that one
has no tool path, the oldest with one (`path`); the others keep their tool path only and are
listed as `duplicates`; without model ids nobody keeps it (`null`) and the plan matches by path;
keys left with one tool path and no tool id are settled alike, the others dropped from the map and
listed; (3) a system the map has gets only the keys it lacks, unless an entry of it already holds
that identity (a conflict); its entries, rule, scope and exclusions never change; (4) a key another
system of the map holds is a conflict; (5) the rule: `strip` none or a leading folder a rule can
name, `prefix` none or leading key segments every key shares and that form a valid key; a key fits
when the rule derives it, also with a collision's `-2` suffix; most fits wins, a tie the simpler
rule (fewer parts, then fewer segments, then code-point order), in time linear in the keys times
the path depth. Paths are compared as analyzr stores them (`src/declared.ts`: ends trimmed,
control characters as spaces), so a file whose tool path analyzr stored tidied is `known`. With
rebuilt entries the plan sees `firstImport: false`; `compactPlan` prints `rebuilt` (`restored`,
`entries`, `rule`, `ruleFits {matching, of}`, `duplicates`, `skipped`, `conflicts`) after the
plan's header and before the counts.

`tools/integrate` (`@analyzr/integrate`, private) holds the sources (`src/`, the entries in
`src/cli/`) and the tests. `pnpm --filter @analyzr/integrate generate` (`scripts/generate.ts`,
`scripts/bundle.ts`) bundles each entry with rolldown 1.2.12, the version Vite locks, into one
unminified ES module that imports Node built-ins only (a marketplace install has no
`node_modules`), its region comments naming `src/…` or `<package>@<version>/<file>`, and writes
the plugin's `THIRD-PARTY-NOTICES.md` from the modules each bundle contains (bpmn-moddle,
camunda-bpmn-moddle, min-dash, moddle, moddle-xml, saxen, zeebe-bpmn-moddle, all MIT;
`analyzr-read.mjs` holds none: only its sources and the zod-free `@analyzr/contracts/paths` and
`/impact-merge`, so the notices did not change with it). After a change of `src/` or of a bundled
dependency, also of the contracts' `paths.ts` or `impact-merge.ts` (an `ImportImpact` change that
reaches the merge, M6 S2b's follow-up step 1): run it, commit the result, and move the plugin
version with its `RELEASES` row (the drift test fails until then). A change to the model bytes
`normalize-bpmn` writes or to the derivation it declares (`derived`, `losses`) also needs a new
`NORMALIZE_BPMN_VERSION` (`src/version.ts`) with its row in `CONVERTER_OUTPUTS`
(`test/bundle.test.ts`), since bundles declare the converter's version and owners' rules for
derived calls match it exactly (M6 S2c-3); a purely informational value moves with the plugin
version only (0.1.3 declares `exporterVersion` as `source.systemVersion` tidied as analyzr stores
it, `tidyDeclared` in `src/declared.ts`, pinned against the contracts' own by a test: one version
with and without spaces around it now gives that version instead of none, and one over 100
characters none instead of a refused bundle; `NORMALIZE_BPMN_VERSION` stays 0.1.0). The synthetic
Signavio-style export `test/fixtures/signavio/2026-10-14-signavio/` (hand-written, unverified,
never from a customer or the holdout; its `README.md` lists its quirks and deliberate defects)
and its golden bundle `test/fixtures/signavio/bundle/` (rewritten with `ANALYZR_UPDATE_GOLDEN=1
pnpm --filter @analyzr/integrate test`) are what the CLI and web tests import. Prettier skips the
fixtures and the bundled scripts (`.prettierignore`).

**Guard.** The skill pre-approves only `inspect.mjs` and, since 0.1.3, `analyzr-read.mjs`
(`allowed-tools:`
`Bash(node ${CLAUDE_SKILL_DIR}/../../scripts/inspect.mjs *), Bash(node ${CLAUDE_SKILL_DIR}/../../scripts/analyzr-read.mjs *)`),
so Claude Code asks before every other command; it is not run in a bypass or auto-approve mode. The skill runs both exactly as shown and
each on its own: nothing in front of `node` (no `NODE_OPTIONS=…`, `HTTP_PROXY=…` or
`ANALYZR_TOKEN=…`), nothing after it (no `>`, `|`, `;`, `&&`, `||`), no `$(…)` or backticks in an
argument, `--url` always the workspace's `analyzrUrl` (a test checks the skill's command lines).
The guard setup it offers once writes the workspace's `.claude/settings.json` with the
consultant's yes: a `permissions.deny` rule `Read(~/.local/state/analyzr/**)`, the sandbox with a
`credentials.files` deny on that folder, `autoAllowBashIfSandboxed` and `allowUnsandboxedCommands`
false. These keys follow the setting descriptions of Claude Code 2.1.300; they were not tried in
a live session (M6 §3.1's "verified in S3b" stays open), so the skill asks the consultant to
check `/permissions` and `/sandbox`. Under that sandbox the script cannot read the owner key
either: the consultant may give it a read token, `<cli> --url "<analyzrUrl>" token create -p
<project> -n integrate-preview -s analyzr:read`, set as `ANALYZR_TOKEN` in the shell that starts
Claude Code and unset again for the real import (else the CLI takes the token); such a preview
classifies the files as agent uploads and knows none of the owner's rules for derived calls, and
the report says so. The skill offers no `permissions.allow` rule (none for the CLI ever, and none
for `analyzr-read.mjs` until the owner's live check, [HANDOFF.md](HANDOFF.md) §8); if Claude Code
asks before `analyzr-read.mjs` in a later turn, the consultant approves it once, and the CLI's
fallbacks once each, never with "don't ask again". Codex's sandbox modes restrict writes, not
reads: there its approvals are the guard. By owner decision 29 (2) (2026-10-20) the preview is
pre-approved since plugin 0.1.3 (step 4 of M6 S2b's follow-up) only as this read-only script,
never as a rule over the CLI form, which a real import can match (`import b -p p --create --name
--dry-run` takes `--dry-run` as `--name`'s value); the real import stays with the consultant.

**`analyzr-read.mjs`** (`src/analyzr.ts`, `src/preview.ts`, the entry `src/cli/analyzr-read.ts`)
cannot import. `requestFor` builds exactly three requests, `GET …/projects/{p}/models?limit=200`
(with `cursor`), `GET …/projects/{p}/external-ids` (with `system`) and `POST
…/projects/{p}/imports?dryRun=true` with the query a constant, and `assertAllowed` checks each
again right before `fetch` (same origin, the path, the query keys, exactly `?dryRun=true`);
anything else throws before a byte is sent. `--url` must be http(s) to 127.0.0.1, `[::1]` or
`localhost` on any port, with no user name, password, path, query or fragment (else exit 1, before
any credential is read), and requests use `redirect: 'error'`. Node's proxy support never sees the
credential: the entry sets `NO_PROXY` and `no_proxy` to `*` before any request, and refuses to run
while `NODE_USE_ENV_PROXY` or `--use-env-proxy` (any spelling Node takes, also in `NODE_OPTIONS`)
is on together with `HTTP_PROXY` or `HTTPS_PROXY` (on Node 24.15 Node then tunnels even a request
to 127.0.0.1 through the proxy; a test pins that the bypass goes direct). Parsing is strict:
`--create`, `--name`, `--dry-run`, `--token`, another command or an extra argument exit 2. The
credential is `ANALYZR_TOKEN` (`^analyzr_at_[0-9A-Za-z]+$`; an owner key there is refused), else
the owner key file, found and checked as `apps/cli/src/credentials.ts` does (`ANALYZR_OWNER_KEY_FILE`,
else `$XDG_STATE_HOME/analyzr/owner-key` or `~/.local/state/analyzr/owner-key`; this OS user's
regular file without access for group and others, the key pattern); the secret is never printed, also not in an error, and
the skill never reads it. `--json-out` must end in `.models.json`, `.external-ids.json` or
`.preview.json` (also after resolving symbolic links), be no symbolic or hard link, and lie in an
existing `reports/` next to `analyzr-workspace.json`, never inside the bundle or an analyzr checkout
(`assertOutputFile` in `src/guards.ts`); the file is opened with `O_NOFOLLOW`, and no folder is
created. `preview` takes only a folder with `analyzr-import.json` at its root, so a pre-approved
run never sends an arbitrary folder. The server's dry run writes nothing and takes no lock.

**`analyzr-spec`** (M6 S3c step 1, [M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §3.9 and
§8 "S3c step 1 as delivered", owner decision 30, [below](#m6-s3c-step-1-2026-10-21); `src/spec/`,
the entry `src/cli/analyzr-spec.ts`) validates `analyzr-spec/1` files, renders them as BPMN 2.0 with
DI, plans their keys and writes their bundles; it runs no foreign code. It is in no bundle before
plugin 0.1.4 (S3c step 4), which also teaches the skill the converter and picture paths, so until
then it runs from source (Node 24, no network) and consultants do not reach it. Exit codes and the
short JSON on stdout as for the other scripts:

```
S=tools/integrate/src/cli/analyzr-spec.ts
node $S validate "$WS/specs/2026-10-14-images"
node $S render "$WS/specs/2026-10-14-images/reklamation.spec.yaml" "$WS/reports/reklamation.bpmn"
node $S plan "$WS/specs/2026-10-14-images" --workspace "$WS" --system images --whole-system --write
node $S bundle "$WS/specs/2026-10-14-images" --workspace "$WS" --system images \
  --out "$WS/bundles/2026-10-14-images" --exported-at 2026-10-14
```

| Command | What it does |
|---|---|
| `validate <spec file or folder>` | checks `*.spec.yaml`, `*.spec.yml` and `*.spec.json` below a folder (also one file of any name) as specs the agent wrote, and since S3c step 2 those the folder's run record `analyzr-specs.json` lists as converter output, unchanged since the run (`changed-after-run`; an unreadable record is one error): every error and warning as `<spec file>: <path>: <message>`, a tool path or tool id twice in a folder as `duplicate-model`; writes nothing; exit 1 on an error, never on a warning |
| `render <spec> <out.bpmn> [--key <model key>] [--origin hand\|converter]` | one spec into a new `.bpmn` file, for checks: `--key` sets the definitions id (default `spec`), `--origin converter` checks the spec as converter output (no `derived`; loose positions are warnings) |
| `plan <spec folder> --workspace <dir> --system <s> …` | the model keys against `keymap.json` from each spec's `source.externalPath` (and `externalId`), exactly as `normalize-bpmn plan` plans an export, with the same flags (`--strip`, `--prefix`, `--scope`, `--whole-system`, `--exclude`, `--no-exclude`, `--existing`, `--from-analyzr`, `--reset`, `--write`, `--json-out`), plus the specs' tool folders and archive-like folders and the flag `replaces-known-model`: a spec the agent wrote takes a key the map holds with a tool id, one without unless this spec folder wrote the system's last plan (`plan --write` records it as `lastExport`, `specs/<folder>`), or a new key analyzr already has (`--existing`); the skill stops there |
| `bundle <spec folder> --workspace <dir> --system <s> --out <dir> [--exported-at <date>] [--inventory <file>] [--json-out <file>]` | the bundle in an empty folder: every spec rendered at its confirmed key's path, `analyzr-import.json` (importer `analyzr-integrate/analyzr-spec`, `derived` `reconstructed` with the spec's `llmModel` for a spec the agent wrote, since S3c step 2 the run's `converted` or `reconstructed` with `adhoc:<12 hex>` and `systemVersion` for one a converter run wrote, the losses `id-rewritten`, `layout-generated`, `link-unresolved`, `text-truncated`, summed with a converter's) and, with `--inventory`, `inventory.json`; refuses invalid specs, unconfirmed keys and `as-told` specs (until S6), and since S3c step 2, like `plan`, a folder whose run record does not check out in `--workspace` (`run-record`, below); exit 1 with `failed` entries (the bundle holds every other model) |

No output goes into the spec folder, below the `exports/` of the workspace (the folder with
`analyzr-workspace.json`) the input or the output lies in, or into an analyzr checkout
(`src/spec/guards.ts`). A spec file is read only as a regular file of at most 2 MB, without
following a link or waiting on a pipe.

**The format** (`src/spec/types.ts`, `validate.ts`; every field, error and limit in M6 §8 "S3c step
1 as delivered"): one model per file, YAML 1.2 core or JSON, strict (an unknown key is an error, ids
are YAML strings), read by `src/spec/yaml.ts` with every parser warning fatal and no tag, anchor,
alias, merge key or non-string key. A spec has no key and no name (keys come from `keymap.json`
through `plan`, decision 30): `format`, `source` (`externalPath`; `externalId` and `url` only from a
converter), `derived` (only in a spec the agent writes: `reconstructed` with `llmModel`, or
`as-told`), `participants`, `processes` with lanes, data stores, nodes (`start`, `end`, `event`,
`task`, `subprocess`, `call` with a `target`, `gateway`) and flows, `messageFlows`, `notes`. A
`calledElement` key and the type `callActivity` are refused with a hint.

**The renderer** (`src/spec/render.ts`, `layout.ts`, `ids.ts`, `check.ts`, `moddle.ts`) writes
through bpmn-moddle without extensions: `exporter="analyzr-spec"` without a version, every process
`isExecutable="false"`, no engine; ids `<Category>_<source id>` (`Activity_`, `Event_`, `Gateway_`,
`Flow_`, …) from one capped, collision-checked id function, which also keeps every id clear of
another's `_di`, `_label` and `_plane`; elements in id order, pools and lanes drawn in list order,
so shuffling nodes, flows, message flows, data stores, reads or writes changes no byte and
reordering lanes or pools moves only the DI; a call as a collapsed subprocess named after its target
with `link-unresolved`, never a `calledElement`; every text sanitized as `@analyzr/bpmn-facts` does
it (pinned copies in `src/spec/text.ts`) and cut at 200 or 2,000 characters. The layout is the eval
layouter's (`eval/tools/lib/layout.mjs`), ported and extended. A self-check (`check.ts`) reads every
render back and refuses a model with a bpmn-moddle warning, a bad id, missing DI or a call activity,
as it refuses one over 5 MB, 50,000 elements or 100,000 layout slots; the full fact extraction runs
in the tests only, since bundling `@analyzr/bpmn-facts` would pull in zod.

**Releases and goldens.** `ANALYZR_SPEC_VERSION` (0.1.0, `src/spec/version.ts`, named in the
manifest's importer, never in the model bytes) moves whenever the bytes rendered from the same spec
change: `RENDER_OUTPUTS` in `test/spec-render.test.ts` pins a sha256 over the golden renders per
version (its failing test prints the new one), as `CONVERTER_OUTPUTS` pins `normalize-bpmn`; an
optional field or enum value may join `analyzr-spec/1` only when every existing render stays
byte-identical. The goldens `test/fixtures/spec/<name>.spec.yaml` and `<name>.bpmn` (9, synthetic,
an invented „Beispiel GmbH“, never from a customer, `eval/corpus` or the holdout; their `README.md`
says what each covers) are rewritten with `ANALYZR_UPDATE_GOLDEN=1 pnpm --filter @analyzr/integrate
test`. `src/spec/plan-args.ts` and the copies in `ids.ts` and `text.ts` stay apart from the modules
the shipped bundles include until 0.1.4, each pinned against its original by a test.

**In a browser.** CI checks bpmn-js only through its tree walker (`test/spec-bpmnjs.test.ts`). The
import itself runs in Playwright: `pnpm --filter @analyzr/web e2e spec-render-import`
(`apps/web/e2e/spec-render-import.spec.ts`, 2 tests, no analyzr server) writes 50 seeded random
renders into a temporary folder with `tools/integrate/test/spec-fuzz-write.ts`, serves
`apps/web/e2e/spec-harness` with Vite and imports every golden and every random render with
`NavigatedViewer`: 0 warnings, 0 errors, every participant, lane, flow node, data store, flow, data
association and message flow drawn, counts only. It takes no other folder, so customer renders never
pass through the checkout's test output.

**`analyzr-convert`** (M6 S3c step 2, [M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §3.9
"Converter runs" and §8 "S3c step 2 as delivered", owner decision 30 (A1) and (A4),
[below](#m6-s3c-step-2-2026-10-21); the entry `src/cli/analyzr-convert.ts`, the parent
`src/spec/converter.ts`, the child `child.ts`, the in-context helpers `inner.ts`, the sandbox
`sandbox.ts`, the zip reader `unzip.ts`, the run record `record.ts`) runs one ad-hoc converter, a
script the agent wrote, on one export of the workspace, and writes one `analyzr-spec/1` file per
model and the run record `analyzr-specs.json` into a new spec folder for `analyzr-spec plan` and
`bundle`. It is the only script that executes code an agent wrote, so it is a script of its own
(decision 30 (A4)) that no approval of the spec commands covers, and it is never pre-approved: the
consultant approves each converter version by its full sha256, and Claude Code asks before each
run (never "don't ask again"). It is in no bundle before plugin 0.1.4 (S3c step 4), which also
teaches the skill to write converters, so until then it runs from source and consultants do not
reach it:

```
C=tools/integrate/src/cli/analyzr-convert.ts
node $C convert "$WS/exports/2026-10-14-visio" --converter "$WS/converters/visio-bpmn.js" \
  --sha256 <64 hex> --derived converted --workspace "$WS" --out "$WS/specs/2026-10-14-visio" \
  --json-out "$WS/reports/2026-10-14-visio.convert.json"
node $C convert "$WS/exports/2026-10-14-aris" --converter "$WS/converters/aris-epk.js" \
  --sha256 <64 hex> --derived reconstructed --llm-model claude-opus-5-5 --workspace "$WS" \
  --out "$WS/specs/2026-10-14-aris"
```

`--derived` is chosen per mapping: `converted` for BPMN shapes read one to one (the Visio BPMN
stencil, AML BPMN models), `reconstructed` with `--llm-model`, the model the agent runs as, for
interpretive mappings such as EPCs and plain flowcharts (decision 30 (A1)); `--llm-model` with
`converted` is refused. `--sha256` (either case) must equal the sha256 of the converter's bytes,
read once; a converter changed after the consultant's yes is refused. `--out` must be new or empty
(choosing a `-2` name is the skill's), never below `exports/` or in a checkout, and `--json-out`
(the whole record) must lie outside it. There is no `--dry-run`. Exit 0, 1 when the run is refused
or a model failed (the others are written), 2 on a usage error; the internal codes of a refused run
(`ConvertError.code`, pinned by the tests; stderr carries only the message) are `workspace`,
`export`, `converter`, `sha256`, `import`, `derived`, `out`, `copy`, `too-large`, `sandbox`,
`timeout`, `out-of-memory`, `output-too-large`, `not-deterministic`, `converter-error` and `result`.
The short JSON on stdout names the converter's id, sha256 and copy, the derivation, `reads` (files
and zip entries the converter read, counted by the child), `counts` (`models`, `failed`,
`duplicates`, `skipped`, `unread`, `zipRefused`, `symlinksSkipped`, `hiddenSkipped`), the summed
losses and the warnings.

**The converter contract.** A converter is a script in the workspace's `converters/` that defines
one synchronous `convert(input, helpers)`. The runner compiles its text as a function body inside
the context, so its top-level declarations are local, and it must not contain the word `import`
anywhere, comments and strings included (compare with `'im' + 'port'` for an element named so).
`input.files` lists every regular, non-hidden file of the export, sorted, as
`{path, size, sha256, zip, unread}`: `zip` is `null` or `{entries: [{name, size}], error}` (entries
sorted by name; `error` set and no entries when the archive failed a guard), and `unread` is the
reason a file over 64 MB was not read (`sha256` null). The helpers are functions of the context
itself: `helpers.text(path, entry?)` decodes a file or zip entry as `inspect` does;
`helpers.bytes(path, entry?)` gives a `Uint8Array` of the context; `helpers.xml(text)` gives
`{root}`, its elements `{name, local, ns, attrs, children, text, content}` (`text` the element's own
character data joined, `content` its text runs and child indexes in document order; a DOCTYPE
skipped, entities other than the predefined ones left as written); `helpers.sourceId(...parts)`
joins non-empty strings and numbers with `-` (control characters become `_`, over 200 characters
become 187, `-` and 12 hex). A helper on an unread file throws. It returns
`{models, skipped?, systemVersion?}`: `models` are `analyzr-spec/1` objects without `format` and
`derived`, each with optional `losses: [{code, count}]` (at most 16 codes, each a `LossCode`, counts
0 to 1e9), `skipped` is `[{path, reason}]`, any other field fails the run. No clock, no randomness,
no locale-dependent formatting: `Date.now()`, `new Date()` and `Date()` without an argument,
`Math.random()` and `Intl` formatting without a date throw, while `new Date("2026-10-14")` parses in
UTC. Its errors read like `converter adhoc:…: run 1: TypeError: …` with its frame
(`at convert (converter.js:2:9)`). Each model is validated as converter output
(`origin: 'converter'`: no `derived`, `externalId` and `url` allowed, loose positions warnings); a
model that fails, or shares its tool path or tool id with another (every holder fails), is listed in
`failed`; one returned twice byte for byte is written once (`duplicates`); the others are written as
YAML named by their tool path as a key (`vertrieb/prozesse/auftrag.spec.yaml`). The two example
converters of the fixtures are the skeleton for `reference/converters.md`, which comes with
plugin 0.1.4.

**The sandbox, and what it cannot guarantee.** The parent reads the export itself (below
`<workspace>/exports/`; hidden files and symbolic links skipped and counted, every file opened
without following a link) and sends the converter's approved bytes and every file on the child's
stdin. The child is `process.execPath` with `--permission`, `--allow-fs-read=<its own script>` (in
source mode `tools/integrate/src`, decided by the script's extension),
`--disallow-code-generation-from-strings` and `--max-old-space-size=4096`, `cwd` the script's folder
and exactly `TZ=UTC`, `LANG=C` and `LC_ALL=C` as its environment, so no `ANALYZR_TOKEN`, cloud or
Git credential and no `NODE_OPTIONS` (which Node reads for permission flags) reaches it. It refuses
with exit 2 unless the permission model is active, `execArgv` holds exactly these flags (any heap
size), the environment exactly these three variables (macOS's `__CF_USER_TEXT_ENCODING` tolerated)
and no write, child-process, worker, addon, WASI or inspector permission is granted; started by hand
outside that sandbox it refuses. It runs the converter twice, each time in a fresh
`vm.createContext(Object.create(null))` with `codeGeneration: {strings: false, wasm: false}` and
`microtaskMode: 'afterEvaluate'`, with `Atomics`, `SharedArrayBuffer`, `WebAssembly`, `WeakRef` and
`FinalizationRegistry` deleted, and the helpers built inside the context over a bridge that passes
strings only, deleted from the global before any converter code runs; it reads nothing the context
throws beyond plain data properties, and both runs must give the same JSON and read the same files.
Node 24.15 has no network permission (`net.connect` works under `--permission`): the converter
reaches no network only because its context holds no host object, so the usage text and the consent
text drafted for step 4 say that Node cannot guarantee a ban on network access, and the consultant
is invited to read the converter before saying yes. The heap limit does not bound `ArrayBuffer`s and
typed arrays, which V8 keeps outside the heap, so a hostile approved converter can use up the
machine's memory within its 120 s ([HANDOFF.md](HANDOFF.md) §4 "Taken during M6 S3c step 2" (b),
(c)). Recheck the network at the next Node upgrade.

| Limit | Value |
|---|---|
| Converter | 1 MB, UTF-8, a regular file directly in `converters/` with one name |
| Export | 64 MB per file (a larger one reaches the converter unread), 512 MB of bytes sent per run (else: run on one folder or file at a time) |
| Zip archives | no ZIP64, split or encrypted archive; methods 0 and 8; safe, unique entry names; no overlapping data; no symbolic-link entry; 64 MB per entry, 256 MB per archive, a ratio of at most 1:200 (entries up to 1 MB exempt), at most 10,000 entries; an entry never inflated beyond its declared size, size and CRC checked |
| Time | 120 s per run (top level and `convert` together, promise jobs included), 300 s for the whole child (then it is killed) |
| Memory | a 4 GB heap (`out-of-memory` when Node aborts); typed arrays outside it |
| Result | 256 MB of JSON; at most 10,000 models and 10,000 skipped entries, reasons of at most 500 characters, `systemVersion` tidied, at most 100 |
| Helpers | `helpers.xml` text at most 64M characters, a raw source id 64K characters, the inflated-entry cache 256 MB |
| Spec | 2 MB as YAML (a larger one fails its model) |
| Record | 16 MB (`convert` refuses a run whose record would be larger) |

**The run record and its check.** Before the run `convert` writes the write-once copy
`converters/adhoc-<first 12 hex>.js` (`wx`; an existing copy must hold the same bytes, else `copy`),
so the code behind a bundle stays auditable after the agent edits its working copy; the run is
recorded as `adhoc:<12 hex>`. `<out>/analyzr-specs.json` (`analyzr-specs/1`, no timestamps, so the
same converter on the same export writes the same record) holds `converter` (`id`, `sha256`, `file`
the copy, `workingCopy`), `derived` (`kind`, `llmModel`), `runner` (`analyzr-convert@0.1.0`,
`ANALYZR_CONVERT_VERSION` in `src/spec/version.ts` until 0.1.4 moves it to `src/version.ts`),
`export`, `systemVersion`, `reads` (`files`, `of`, `entries`), `specs` (`file`, `sha256`,
`externalPath`, `externalId`, `losses`, the first 5 `warnings` and `warningCount`), `failed`
(`model`, `externalPath`, the first 5 `errors` and `errorCount`), `duplicates`, `skipped`, `unread`,
`zipRefused`, `symlinksSkipped` and `hiddenSkipped`. `analyzr-spec validate`, `plan` and `bundle`
read it (a regular file of at most 16 MB): a spec it lists is converter output and is refused when
its sha256 differs from the recorded one (`changed-after-run`: run the converter again, or move the
spec into a folder of its own and declare it `reconstructed`); `plan` and `bundle` refuse the folder
(`run-record`) without `--workspace`, when the copy is missing, changed, a symbolic or hard link, or
the id does not match the sha256, and when the record is no valid JSON or holds values `convert`
never writes (an `llmModel` with control characters or over 120 characters, an untidy
`systemVersion`). A spec the record does not list is one the agent wrote. These checks catch
mistakes, not forgery: an agent could write a record too, so the skill's rule that only the scripts
write specs and bundles and the preview's stop on modelled files and calls stay the guard.

**Fixtures.** `test/fixtures/converters/` (hand-made, synthetic, marked unverified in its
`README.md`, never from a customer, `eval/corpus` or the holdout): the parts of
`Vertrieb/Prozesse.vsdx` and `Service/Reklamation.vsdx` (zipped by the tests with
`test/zip-writer.ts`) and the converter `visio-bpmn.js` (`converted`), an AML export
`aris/Export_Vertrieb.xml` and the converter `aris-epk.js` (`reconstructed`). Their bytes matter:
the tests approve them by their sha256. The shape data names, the lane container formula, the
off-page hyperlink row and the styled AML texts are assumptions, to verify with a sandbox export
(M6 §10.4).

### Open questions (M6 S4)

Every gap that blocks links or placements as one list of German questions
([M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §4, §8 "S4 as delivered"), computed
on read and never stored; it ranks and asks, it decides nothing and drives no stage (decision 8).
The pure read model lives in `apps/server/src/domain/open-questions/` (`model.ts`: input, index,
ids, `askWho`, `unlocks`, order; `sources.ts`: the sources of §4.1; `signals.ts`: the gap signals
of §4.3 with `SIGNALS_OFF`; `read-model.ts`: list, filters, cursor pages; `export.ts`: Markdown,
CSV, the file name; since S5a `answers.ts`: where an answer's text lands, the API view of an
answer, the check of a sheet's rows); the CSV parser `parseOpenQuestionsCsv` and the sheet reader
`readAnswerSheet` live in the zod-free `@analyzr/contracts/open-question-csv` since S5a (the
server's export re-exports them). `use-cases/open-questions.ts` loads one read snapshot under
`policy.require(…, 'read', …)` and memoizes the whole-project candidates per project on the live
models' `modelKey=facts_hash` (at most 8 projects per server); its answer use cases require
`review` (below).

- **Sources:** relation findings (`call-target-unknown`, `call-target-dynamic`,
  `duplicate-process-id`, `message-partner-missing`, as „Befunde“ lists them: `visibleFindings`), value
  chain findings, holds (note, question, label), agents' questions on live proposals newer than
  the latest decision in force, current `unsure` verdicts, no-links coded `call-target` or
  `collaboration` (`external-partner`), the summaries of current submissions (`summary-note`,
  read-only, decision 24.8) and the pairs they left unjudged (`unjudged`). Since M6 S2a the
  head revision's stored extractor warnings (`extractor-loss`, one question per model listing
  the elements skipped on import: duplicate, illegal or missing ids and unparsable content, not
  a dropped diagram element or a vendor's element; revisions stored before S2a carry none).
- **Signals** over the head facts: `black-box-partner`, `unlabelled-boundary`,
  `undocumented-process`, `isolated-process` and `descriptive-model` (informational);
  `message-without-name` is off (it duplicates `message-partner-missing`), its kind reserved.
- **Item:** `id` (`q-` + 16 hex of `sha256(kind|subject|source version)`, new when the source
  changes), `kind`, `source`, `group` (UX2a: `ask` „Zu klären“, `agent` „Fragen der Agenten“,
  `proposal` decided on the value chain, `info` „Zur Information“, from the `Record` over the
  kinds `OPEN_QUESTION_GROUP_RULES` in `open-questions/model.ts`; a label and a filter, never a
  sort key), `subject` (`ref`, `process`, `model`, `relation`, `placement`, `step`,
  `value-chain`) and `subjectLabel` (a pool without a process: „Pool in „<the pool it talks
  to>““, never its id), `modelKeys`, `text` (the question, short: from code, or verbatim for
  human and agent texts: render as plain text), `detail` (UX2a: why it is asked, from code in
  plain German, never the frozen findings' `detail`; an unsure verdict's and a coded no-link's
  agent words verbatim; `null` where the question says it all), `context` and `label` (a hold's
  note and label),
  `askWho` (`lanes`, `stepOwners`, `folder`: a hint, never an assignee), `unlocks` (open decisions
  touching the subject, 0 when none), `refs`, `raisedBy`, `state` (`answered` while an answer
  names the id, S5a) and `answers` (oldest first).
- **REST** (tag `open-questions`, permission `read`, so viewers, agent tokens with `read` and the
  read-only demo): `GET /api/v1/projects/{p}/open-questions` with `modelKey` (a model or a folder:
  `finanzen` matches `finanzen/mahnwesen`), `kind`, `source`, `askWho` (a lane, one step owner or
  the folder, exactly, ≤ 200 characters), `state`, `group` (UX2a, repeatable: `?group=ask&group=agent`),
  `cursor` and `limit` (≤ 200, default 50): `{items, nextCursor, total, totals, askByModel}`
  (`totals` per group and `askByModel`, the distinct subjects of the `ask` items about neither a
  relation nor a placement per model key, both under every filter but `group`, so the badge and
  the count lines need one call), questions first, then the value chain's findings
  (`process-without-step`, `step-without-process`, `unresolved-link`; the owner's answer of
  2026-10-16), then the informational items (`summary-note`, `descriptive-model`), each group by
  `unlocks` descending, then subject, kind and id (the cursor's first number is the rank group;
  one question per process: no `process-without-step` beside a held placement, an agent's
  question on a placement of the process or an unsure verdict about it). `GET
  …/open-questions/export?format=markdown|csv` with the same filters is an attachment named
  `offene-fragen-<project>[-<filters as an ASCII slug, ≤ 80 characters>].md|csv`; without
  `group` it holds the `ask` items only (owner decision 26: the customer is asked what needs
  clarifying), unless `kind` or `source` names what to export, and the default groups do not
  slug into the name. Both files go to the customer in plain German (UX2a): the Markdown dated
  by the project's latest event („Stand 17.10.2026“, German time), grouped by contact hint (step
  owners, else folder, else lanes), per item the question, its reason, „Betrifft: „<element>“ in
  „<pool>““, a hold's note and label, the notes and marks with their dates, „Ansprechpartner:
  <step owners and lanes>“ (no folder), the id only as an HTML comment after the heading
  (`<!-- q-… -->`), no refs, seqs, sources or „Kennung“; agent and human texts escaped so they
  never format or link, the informational items marked „Zur Information, keine Antwort nötig“;
  the CSV for the customer without the informational items, UTF-8 with a byte order mark,
  `;`-separated, CRLF, every field quoted, the columns `id`, `Art`, `Frage`, `Ansprechpartner`,
  `Antwort` (since S5c-1 five columns: `Antwortart` is gone; since UX2a the contact column is
  `Ansprechpartner`, a sheet with the old header `Ansprechpartner-Hinweis` reads all the same, and
  `Frage` holds the question, its reason and „Betrifft: …“; the `Antwort` cell is empty, or holds
  the item's latest note), a cell that a spreadsheet would run as a formula prefixed with `'`.
- **Clients:** the tab „Offene Fragen“ and the model view's section ([Web UI](#web-ui); since UX2b
  both show the open `ask` items, the tab the agents' questions under „Art“, the informational and
  marked items in closed groups; its customer export sends `group` explicitly),
  `analyzr questions` ([The `analyzr` CLI](#the-analyzr-cli)). The German labels of kinds and
  sources are the zod-free `@analyzr/contracts/open-question-labels`, shared by the export and the
  web. No MCP tool until S7 (after the live runs): claim inputs, `FindingKind`, MCP tools and
  prompts are unchanged.
- **Answers (S5a):** `POST …/open-questions/{q}/answers` (`{text, kind}`; 201 `recorded`, 200
  `unchanged` when the item's latest answer has the same kind and text, 404 for an id that names
  no current item) and `POST …/open-questions/answers?dryRun=true|false` (the rows of a filled-in
  sheet, ≤ 5,000 and 4 MB per call, one transaction; rows `recorded`, `unchanged`, `unknown`,
  `invalid` with a reason, empty answers counted as `ignored`), permission `review`, humans only
  (agents get `human-decision-required` with the tab's `reviewUrl`), refused by the read-only
  demo. Texts are normalized (`normalizeAnswerText`: LF, NFC, trimmed) and checked for e-mail
  addresses, phone numbers and IBANs (`@analyzr/contracts/personal-data`, warnings only). On a
  relation or placement the text becomes a human note through `recordRelationNote` or
  `addPlacementNote` (it reaches agents as any note; a held placement stays held and its process
  not due), else it stays in `open_question_answer`. The CSV export holds an answered item's
  latest answer and kind; `readAnswerSheet` (`@analyzr/contracts/open-question-csv`) reads a
  re-saved sheet with each row's spreadsheet number, and both clients send only the filled rows
  (UTF-8 only).
- **Answering by action (S5c-1):** every item carries `actions` (`{type, primary, label}` plus
  the picker, `suggested` targets with the `proposals` a link to each accepts, `exclude`d
  processes, the pairs, the copies, the fixed step or what `decide` decides; at most one primary;
  none for informational items, `note` on every other). `POST …/open-questions/{q}/actions`
  (`{type: 'link' | 'place' | 'choose-copy' | 'outside', …}`; 201 `applied`, 200 `unchanged`;
  404 for an item whose source changed, 422 `action-not-offered` or the action's own reason, 409
  when `choose-copy`'s calls changed) answers with the item as the list now shows it (`null` when
  it left), the relations and placements it wrote (`manual`, which „Rückgängig“ rejects) or
  decided (`decision`, no undo), the answer and the personal-data warnings. `POST
  …/open-questions/{q}/answers/{a}/withdrawal` withdraws an outside mark. `{text, kind}` is now
  `{text}` (a request with `kind` gets 422); a note never makes an item `answered`, only a live
  outside mark does. The read model hides an item an accepted link answers (R1: from the call,
  from or towards the coded end, along each of a pool's flows, never a `call` for a pool or an
  external partner) and a duplicated process id while no call towards its copies waits (R1b).
- **Model amendments (S5c-2):** the kinds that name a field (`call-target-unknown`,
  `message-partner-missing`, `unlabelled-boundary`, `undocumented-process`) offer `amend`
  (`{modelId, modelKey, targets: [{elementId, op, label, prefill?}], replaces?}`, run through the
  amendments route, [below](#model-amendments-m6-s5c-2)); the new kind `amendment-conflict`
  („Ergänzung nicht mehr anwendbar“, source `amendment`, one item per live amendment in conflict,
  versioned by the amendment and the uploaded revision) offers `withdraw-amendment` (`withdraw:
  {modelId, modelKey, amendment?, compare?}`; without `amendment` every live amendment of the
  model; `compare` carries a `value-changed` conflict's field, incoming value, analyzr's value and
  the value before) and, only where the incoming value does not resolve, `amend` „Meine Ergänzung
  behalten“ with the conflicting value as `prefill`.

### Model amendments (M6 S5c-2)

The fields an open question names, set in the model by a human
([M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §4.8 c, §8 "S5c-2 as delivered";
decision 25): a call target, a message or signal name, a start or end name, the documentation of
a process without one. The uploaded bytes stay a revision of their own; analyzr computes an
amended revision from them (byte-preserving splices, [Conventions](#conventions) "Model
amendments") and makes it the head, and every import of the key re-applies each live amendment
whose field the source tool left as it was. Nothing is written back to the source tool: the
corrected BPMN and the change list are downloads. Contracts:
`packages/contracts/src/api/{amendments,amendment-core}.ts`, OpenAPI tag `amendments`, the German
labels in the zod-free `@analyzr/contracts/amendment-labels`; domain: `src/domain/amendments/`
(`plan.ts`, `fields.ts`, `derive.ts`, `effect.ts`, `state.ts`, `export.ts`),
`src/domain/open-questions/amendment-questions.ts` and the use cases
`src/domain/use-cases/amendments.ts`; HTTP: `src/http/routes/amendments.ts`. Writes are human
decisions about content that write a revision, so the use cases require both `review` and
`write`: agent tokens get 403 `human-decision-required` (with `reviewUrl`), a scope without both
403 `insufficient-scope`, a viewer 403 `forbidden`, the read-only demo 403 `demo-readonly`.

| REST (`/api/v1/projects/{p}`) | Permission | |
|---|---|---|
| `GET /models/{m}/elements/{elementId}/amendable` | read | `AmendableElement`: per field the element allows its value on the head and on the uploaded revision, `settable` and the reason when not (`only-open-questions`, `expression`, `cmmn-call`, `has-documentation`, …), the live amendment, the readers of a message name, the suggestions (processes, names with their endpoints, labels) and the element's history; `ETag: "r<headRev>"`; an endpoint yields the field of the message or signal it references, a pool its process; 404 for a deleted model or an element without fact or field |
| `POST /models/{m}/amendments?dryRun=` | review and write, humans only | `{items: [{elementId, op, after \| target, partner?, replaces?}]}` (1–20, no two on one element and op); `If-Match: "r<headRev>"` required (428 `precondition-required`, 412 `revision-conflict` with `headRev`, checked under the project lock); each item `recorded`, `unchanged` or `not-applicable` (a request with one writes nothing: 422 `validation-failed`, `reason: 'amendment-not-applicable'`); a stale `replaces` 409 `conflict`; 201 with the new amended head, 200 for a dry run or `unchanged`; always the `effect` (findings resolved and added, relations accepted, proposed, withdrawn, partner-accepted, `changed`, retired) and the `cost` (`factsChange`, `pairsToRejudge`, `taskClaimed`); events `model.amended`, then the amended revision's `model.revised` |
| `POST /models/{m}/amendments/withdrawal?dryRun=` | review and write, humans only | every live amendment of the model: one withdrawal row each (`model.amendment_withdrawn`) and one re-derivation (bytes equal to the uploaded revision's); a deleted model gets the rows only, no revision; optional `If-Match: "r<headRev>"` (412); the dry run answers what would end and the `cost`; 201 `withdrawn`, 200 dry run or `unchanged` |
| `POST /amendments/{a}/withdrawal?dryRun=` | review and write, humans only | one amendment, re-derived without it; otherwise as above |
| `GET /amendments?modelKey=&state=` | read | `{items, seq}`, oldest first, each with its state (`applied`, `in-source`, `conflict` with its reason, `withdrawn`, `superseded`) and `modelDeleted`; `modelKey` matches a model or a folder |
| `GET /amendments/export?format=markdown\|csv&modelKey=&state=&since=` | read | the change list as an attachment `ergaenzungen-<project>[-<filters>].md\|csv`: per model „Zu übertragen“ (applied, conflict) before „Erledigt“ (in the source, withdrawn, superseded), each element as its uploaded revision names it with its id, the field, before → after, who, when, the state, „Stand: Ereignis …“; `since` lists only what was recorded or ended after that seq; the CSV (UTF-8 with BOM, `;`, CRLF, every field quoted, formula-like cells escaped) with raw values and the columns „Ziel“ and „Zu übertragen“ |

The `cost` (`costOf` in the use cases) is counted since M6 S2b's follow-up step 1 as the import's
dry run counts its pairs ([The relations tasks](#provenance-and-the-import-manifest-m6-s2a)):
`pairsToRejudge` is `pairsToJudge` for the model over the would-be candidates and the relations as
the write leaves them (`plannedRelations`: the recompute under the derived head's trust and, for
an owner, the derived calls their rules accept; then `acceptPartners` marks the partner proposals
`settleLinks` accepts), narrowed to the pairs whose current judgement the new head makes non-current (`judgementShift`), so
a pair the amendment itself settles is not counted (while a partner's task waits, judge each pair
once may give some of these pairs to that task rather than to the model's next claim); `taskClaimed` comes from `planQueue`, so only
when the facts change; a request with nothing recordable answers `{factsChange: false,
pairsToRejudge: 0, taskClaimed: false}`. The amended BPMN and the original are the existing `GET /models/{m}/revisions/{r}/content` of the
head and of `source.upstream.revisionId`. An amended revision's `source` is `{kind: 'amendment',
uploader, upstream: {revisionId, rev, contentHash}, amendments: [{id, elementId, op, outcome,
reason?}]}`; when nothing applies, the uploaded head carries the plan. `PUT …/models/by-key/{key}`
and `POST …/imports` add `amendments: {applied, inSource, conflicts}` (counts and ≤ 20 ids) and,
when an amended head was written on top, `uploadedRevisionId`, only for models with live
amendments, so every other result keeps its keys. No MCP tool: agents read an amended head like
any revision. Clients: the amend form, the collection's bar and the model view's „Ergänzen“
([Web UI](#web-ui)), `analyzr models amend|pull`, `analyzr questions amend` and `analyzr
amendments` ([The `analyzr` CLI](#the-analyzr-cli)).

### Provenance and the import manifest (M6 S2a)

An import bundle's manifest `analyzr-import.json` (`analyzr-import/1`,
[M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §3.2–§3.4, §8 "S2a as delivered") pins
model keys and declares where each model comes from. Contracts:
`packages/contracts/src/api/import-manifest.ts` (`ImportManifest`, `ImportWarning`,
`ExternalIdList`, `tidyDeclared`, `KNOWN_LOSS_CODES`) and the typed fields of `RevisionSource`;
domain: the pure `src/domain/provenance.ts` (the manifest parsed and checked, the uploaded
revision's `source`, the import warnings, the `external-ids` list) and `src/domain/warnings.ts`
(the extractor's warnings cut to 300 characters, as results and storage hold them). Readers take a
model's provenance from `RevisionRepo.uploadedSources`: every field from the head's uploaded
revision (an amended head's `source.upstream`), never another revision's, and since M6 S2b's
follow-up step 5 `system`, `externalId`, `externalPath` and `url` from the model's newest identity
row (absent without one; before step 5 the head's uploaded revision's, or, when that one came
without a manifest, the newest revision's a manifest declared). The declared fields never enter
facts or `facts_hash`, and no MCP tool returns them.
Since UX8 every `Model` (REST only) carries `source`, the head's declared provenance in short
(`ModelSourceSummary`: `system`, `derived` = `derived.kind` or `null`, `exportedAt` or `null`; an
amended head's from its `upstream`, the store joins it; `null` when the head declares no system,
also after an upload without a manifest, whose identity `external-ids` still keeps), for the
models table's chip and the model view's header (`sourceSummary` in `src/domain/provenance.ts`).

**The identity rows** (M6 S2b's follow-up step 5, owner decision 29 (1),
[below](#m6-s2b-follow-up-step-5-2026-10-20)): `model_identity` (append-only, migrations 0021/0022)
holds per import and model the identity a manifest declared (system, tool id, tool folder, link,
with the principal and client that declared it); the newest row by `seq` is the model's identity.
`storeFile` in `ingest.ts` writes it (`recordIdentity`) in the ingest's transaction: for every
stored listed file (`created`, `revised`, a revival) one row of kind `revision` at its uploaded
revision's `model.revised` seq, also when the identity equals the newest row; for an `unchanged`
listed file only when its declaration differs from the newest row (`identityUpdate` in
`src/domain/provenance.ts`, which the dry run shares), with an internal event
`model.identity_declared` of its own (payload `{modelId, modelKey, revisionId, system, externalId,
manifestSha256}`, no folder or link) and a row of kind `unchanged` naming the uploaded revision the
bytes are kept as (an amended head's `upstream`). A file without a manifest entry writes and reads
nothing, and amendment writes, withdrawals and deletions write no row. So an unchanged re-import
writes no revision, facts, task or recompute, and nothing at all unless a listed file declares
another identity than the newest row; then `last_seq` (and the landscape ETag with it) moves by one
per such file. The revision keeps its first provenance and trust class: `Revision.source`,
`Model.source` (the bytes' declaration) and `Model.trust` read no row. Readers: `uploadedSources`
joins the newest row laterally (`newestIdentityOf`, served by the primary key; the fallback query is
gone) for `external-ids`, the identity warnings and the dry run's absent keys; `identities.newest`
(`DISTINCT ON`) serves the ingest, the dry run and the change list, whose origin names the newest
row for live and deleted models; `modelViews` joins it for `Model.identity` (`ModelIdentity`:
`{system, externalId, externalPath, url}`, or `null` when no manifest ever declared the model; REST
only, on the list, the get and the PUT result's model). `ImportFileOutcome.identityUpdated: true`
marks an unchanged file whose identity the import records; a dry run answers exactly the same
`files` and writes nothing (`lastSeq` unchanged), the PUT results never carry it, and
`ImportImpact`, `ManifestSummary` and `ExternalIdEntry` keep their shape. A real import in several
batches reads the identity anew per batch (a later batch sees an earlier one's rows), while a
batched dry run compares every batch with the state before the import; keys are unique per bundle,
so no model is in two batches. An `analyzr:write` agent token records rows under its principal, and
the trust class stays the uploaded revision's.

| REST (`/api/v1/projects/{p}`) | Permission | |
|---|---|---|
| `POST /imports?dryRun=true`, `PUT /models/by-key/{key}?dryRun=true` (M6 S2b) | read | the outcomes the import or upload would answer (warnings, amendments, import warnings) and `impact` (`ImportImpact`, below); nothing is written and no lock is taken; the PUT answers `PutModelDryRunResult` with 200 also for a would-be new model |
| `GET /models/{model}/deletion-impact` (M6 S2b) | read | the `ImportImpact` of deleting the model (its facts removed from the head); `files` and `absentKeys` empty; since S2b's follow-up step 1 `relationsTasks` names the model's open task the deletion cancels and queues nothing; since step 2, with a live value chain, `placementsChanged` names the accepted placements of its processes turning `missing` and `placementTask` is `not-triggered` (a deletion never queues the placement task) with the processes due after the deletion (`due`), those it makes due (`newlyDue`) and those of them placed again (`again`) |
| `POST /imports` with the part `manifest` | write | the manifest's JSON (≤ 1 MiB, one part); a listed file gets the key it pins and its declared provenance on the uploaded revision, with `manifestSha256` (the SHA-256 of the manifest bytes received); an unlisted file keeps its path key and declares nothing; `importWarnings` on a file's outcome only when there is one; since M6 S2b's follow-up step 5 a listed `unchanged` file whose declared identity differs from the model's newest row records it, with `identityUpdated: true` on its outcome (also in the dry run) |
| `PUT /models/by-key/{key}` with the header `Analyzr-Manifest` | write | the base64url of the UTF-8 JSON of a manifest that lists exactly this file (≤ 8,192 characters; its `key`, if given, equal to `{key}`; its `path` becomes `source.path`); `importWarnings` and, since M6 S2b's follow-up step 5, the identity of unchanged bytes as above (no `identityUpdated` on the PUT results; the result's `model.identity` shows it) |
| `GET /external-ids?system=` | read | `{items: [{key, system, externalId, externalPath}]}`: one unpaged list, sorted by key, of every live model whose provenance declares a source system (since M6 S2b's follow-up step 5 its newest identity row's system, tool id and folder); `externalId: null` when the manifest named no tool id |

**The impact** (M6 §3.5, slice S2b; `src/domain/import-impact.ts`, pure): the recompute planned
over the would-be head facts (`planRecompute`, the steps a real recompute would write; an amended
head where live amendments apply) and read as transitions: `files` (created and revised files:
whether their facts change, process refs added and removed), `acceptedCalls` (relations that
would become accepted, which only the rule tier's call decisions do), `proposalsAdded` (relations
that would become proposed), `proposalsWithdrawn` (rule stances withdrawn), `endpointsChanged`
(accepted relations whose end would turn `changed` or `missing`), `findingsAdded` and
`findingsResolved` (by kind and refs) and `absentKeys` (live keys whose uploaded source declares
the manifest's system, not named by the manifest or the request, only those whose tool folder
lies in `source.scope`; information only, decision 7); each list `{count, items}` with at most 100
items. Since M6 S2c-1 the planner applies the trust rule like the recompute: `files[].trust` is the
class each uploaded revision would get, and `callsProposed` lists apart from `proposalsAdded` the
unique calls of derived callers that would only be proposed ([The trust rule](#the-trust-rule-m6-s2c-1)). `previewIngest` in `src/domain/ingest.ts` reads the head in one read transaction, extracts
outside it and never calls `rulesPrincipal` (the histories name the rules principal). One dry run
covers one request; the CLI's batches each run against the head.

**The relations tasks** (M6 S2b follow-up step 1, [M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md)
§3.5 and §8 "S2b follow-up step 1 as delivered"): `ImportImpact.relationsTasks`
(`ImpactRelationsTasks`, required, REST only) says what agent work the write sets off, repeats or
destroys. `queued` (by key) and `cancelled` (`ImpactCancelledTask {modelKey, state, claimedBy,
assigned}`, the claimed ones first, then by key; `claimedBy` is the holder's handle and `assigned`
the length of its claim's assignment, both `null` while queued) come from the pure
`planQueue` in `src/domain/queue-plan.ts`, which the write's `queueAnalysis` uses too (read, plan,
write; the same reads and event order, pinned by `recompute-golden.test.ts`), per created or
revised file; a deletion cancels the model's open task and queues nothing. `claimed` counts the
cancelled tasks an agent holds, past the cap. `pairs` is `pairsToJudge` (`judgements.ts`) over the
queued models: their candidates of an assigned basis over the would-be facts and their assigned
relations as the write leaves them (`relationsAfter` in `import-impact.ts`, the plan's steps plus,
for an owner, the derived calls their rules accept), without the pairs with a current agent
judgement after the write or a settling decision; it ignores judge each pair once's partner rules,
so it is an upper bound of what the queued tasks' claims are assigned while other models' open
tasks wait. `rejudged` is the part of `pairs` that `judgementShift` finds: a judgement current with
the head hashes now (`headHashes`) and none current with the would-be ones (a revert loses nothing).
The judgements are the live pipeline proposals of relations that are not obsolete
(`linkJudgements`) and the live no-links touching the changing models, stale ones included. The
reads stay in the dry run's snapshot and happen only for files whose bytes are not known yet: the
open relations tasks (queued and claimed), `headHashes`, `noLinks.listLive` with the new filter
`touchingModelKeys`, and per such file whose model has no open task its latest done task (whether
the facts change is known only after the extraction, outside the snapshot); an unchanged re-import
reads nothing more. The candidates come from the new port method
`AnalysisPort.candidateSource(projectFacts)`, which indexes the would-be landscape once
(`indexCandidates` of `@analyzr/relations`, passed as `generateCandidates`' fourth parameter) and
is built only when a task is queued; on 496 models a 50-file batch adds 0.67 s of CPU ([M6 S2b
follow-up step 1](#m6-s2b-follow-up-step-1-2026-10-20)). Batches are merged by the contracts'
zod-free `mergeImpacts` (`@analyzr/contracts/impact-merge`, with `MAX_IMPACT_ITEMS` and
`TRUST_REASON_ORDER`), which the CLI and the web share: the queued tasks sorted by key, the
cancelled ones claimed first, then by key, before the cap, `claimed` and `pairs` added up (a pair
between models of two batches counts in both when both models are in the head; on a first import
across batches it counts in neither, each batch previewed against a head without the others), the pairs judged again deduplicated by item with
their count lowered by the duplicates found. Since step 3 ([M6 S2b follow-up
step 3](#m6-s2b-follow-up-step-3-2026-10-20)) the surfaces show it: the „Vorschau“'s cost line in
the last of its three lines („214 mögliche Relationen zu beurteilen (56 davon erneut)“, only when
`pairs` is above 0; „etwa“ for several batches, whose note says on a first import in parts that
the pairs between new models of different batches are missing from the number), the list
„Mögliche Relationen, die erneut beurteilt werden“ and, for the claimed tasks the import cancels,
the warning `preview-claimed` with the second click „Trotzdem importieren“ ([Web UI](#web-ui),
„Hochladen“); the CLI's `agent work:`, `cancel relations tasks:` and `warning:` lines and the
deletion listing's `relations task cancelled` ([The `analyzr` CLI](#the-analyzr-cli)); `--json`
carries it. The whole number after an import, which a preview in batches cannot give, is the
summary's `pairsToJudge` since step 3b ("The agents' next run" below).

**The placements in the dry runs** (M6 S2b follow-up step 2,
[M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §3.5 and §8 "S2b follow-up step 2 as
delivered"): only for a project with a live value chain `ImportImpact` carries two optional
fields, REST only (a project without a chain has neither): `placementsChanged`
(`impactList(ImpactPlacement)`, each `{step, stepName, process, endpointState}`, by process, then
step) and `placementTask` (`ImpactPlacementTask {outcome, due, newlyDue, again}`). `readChain` in
`ingest.ts` reads the chain in the dry run's snapshot: one query without a live chain; else the
head's structure (cached by content hash), the live step generations, the placements with their
histories, the `placement_input` rows, the open placement task and, while an agent holds it, the
input hashes its claim showed (one more query); the rules principal comes from the histories.
`importImpact`'s optional seventh parameter hands it, with the head facts, `headChange` (a created
or revised file, or a deletion) and `triggered` (a created or revised file with other facts), to
the pure `placementImpact` in `src/domain/value-chain/model-impact.ts`, after the relations part,
so the relations the write leaves (an owner's rule acceptances included) give the neighbours. It
runs the pipeline's pure `pipelineInputs` over the head and over the would-be head: `due` is the
open processes due after the write, `newlyDue` those not due before, `again` those of them open
before (an agent's verdict, or the held claim, matched their input). The outcome mirrors
`afterHeadChange` and `queuePlacementTask`: `not-triggered` unless a created or revised file
changes facts (a layout-only upload and a deletion never queue, M4 §3.2; the deletion impact still
counts the due processes), `open` for a queued task, `deferred` for a claimed one (the write sets
`requeue_after`), else `queued` when a process is due, else `nothing-due`.

- **The rule tier's plan.** A write that changes a head (`headChange`, a layout-only file
  included) runs the chain's sync, whose rule tier proposes and withdraws over the would-be head
  processes. The pure `planRulePlacements` (`value-chain/rules.ts`; `recomputeRulePlacements`
  reads, plans with it and writes, with the same queries and event order,
  `value-chain-golden.test.ts` unchanged) gives those writes, and the dry run appends them to the
  histories with seqs after every stored one (a new placement for a proposal on a new spot, the
  touched placements' statuses recomputed). So a process the rule tier records on gets a new
  non-agent seq in its input hash (`lastNonAgentSeqs`), as in the write, also where a revoked
  auto-acceptance no longer suppresses a proposal; an unchanged import plans nothing.
- **The held claim.** While an agent holds the task, the input hashes its claim showed count as
  its verdicts (its submission records them), so `due` is what the follow-up then offers, and a
  process the import changes under the claim is newly due and placed again.
- **The placements.** `placementsChanged` comes from `derivedPlacementState` over the history
  after the rule tier, as `refreshPlacement` computes it: the accepted placements the write's
  `placement.endpoint_changed` events turn `changed` or `missing` (an accepted placement keeps its
  decision's anchor); held, obsolete and removed-step placements and a return to `ok` are not
  named.
- **The shared fact order.** A process's first start and end labels (`processOwnFields`) follow
  the fact order, and the extractor lists kinds in the enum's order while `facts.head` sorts by
  code point, so `headFactOrder` sorts the would-be facts with `compareStoredFacts` of
  `src/domain/fact-order.ts`, the comparator `store.ts` uses for `facts.head` and a revision's
  facts; `value-chain-ingest.test.ts` pins it on `nordwind-handel` (message and plain start
  events in one process).
- **The merge** (`mergePlacements` in `@analyzr/contracts/impact-merge`) adds the fields only when
  a batch has them: `placementsChanged` added up, concatenated, sorted again and capped;
  `placementTask` with the strongest outcome (`deferred`, `open`, `queued`, `nothing-due`,
  `not-triggered`), the largest batch's `due`, and `newlyDue` and `again` added up, all three
  approximate across batches.

The chain is read for an unchanged batch too, so the fields are always present with a chain;
on 496 models a 50-file batch gains about 20–30 ms ([M6 S2b follow-up
step 2](#m6-s2b-follow-up-step-2-2026-10-20)). Since step 3 the surfaces show them: the
„Vorschau“'s placement part of the cost line („7 Prozesse zu platzieren (5 davon erneut)“; for a
task the write queues every process due, also those due before, `max(due, newlyDue)`, for one
waiting or held the newly due ones: `processesToPlace` in `apps/web/src/lib/agent-cost.ts`, which
the CLI's `placementWork` mirrors), the placements line right after the endpoints line and the
list „Angenommene Platzierungen mit geändertem oder fehlendem Prozess“; the CLI's
`placement task:` part of `agent work:` (`N due in all` for a waiting or held task when more are
due) and the line `change or lose the process of accepted placements:`; the deletion listing's
placements losing their process and processes made due, with the requeue hint once; `--json`
carries them.

**The agents' next run** (M6 S2b follow-up step 3b,
[M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §3.5 and §8 "S2b follow-up step 3b as
delivered"): `GET /projects/{p}/summary` (permission `read`, REST only: MCP returns no
`ProjectSummary`) carries `pairsToJudge`, required, the distinct typed pairs the next claims of
the relations tasks an agent may claim now will be assigned, over the stored head. Those tasks are
the ones `TaskRepo.claim` takes at the read's clock: the queued ones (the models „warten auf den
Agenten“) and the claimed ones whose lease ran out with attempts left. `countPairsToJudge` in
`src/domain/use-cases/projects.ts` runs `pairsToJudge` (`judgements.ts`) over those models with
their own candidates and the relations and current judgements the open questions' read model
already read, the pairs live claims hold added to the judged ones: each pair counts once (one
between two such models too), and the pairs with a current agent judgement and those a decision
settles are left out, as in the dry runs. A task whose lease runs adds nothing (its pairs are its
claim's), and neither does a pair of its assignment whose other end is such a model the claim saw
as it is now (`heldPairs`, `planClaim`'s rule 1: the model's head is not newer than the claim's
`claimed_seq`, or has the facts it had then, `revisions.hashesAt`); rules 2 and 3 only decide
which claim judges a pair, so the union is exact for the stored state when read. The own
candidates come from the open questions' candidate pass: the port method
`AnalysisPort.projectCandidates` (`projectCandidates` of `@analyzr/relations`) gives the
whole-project candidates (`generateCandidates` without a focus, unchanged) and, from the same
pass, per model what `generateCandidates` around it gives of a basis other than `compatible`;
`CandidateCache` keeps both and `loadOpenQuestionInput` returns them
(`LoadedOpenQuestionInput.ownCandidates`), so the summary makes no cache lookup of its own and
generates no candidates. The whole-project candidates alone overcount once only some models wait
(a pair with a model that does not wait can have an assigned basis only from that model's side,
which the waiting model's claim does not assign: 5,503 against the exact 2,940 for 50 of 496
models), and generating the own candidates per waiting model cost 5.9–6.9 s on the first summary
after a head change. The new reads: the queued and the claimed relations tasks, and one revision
query per live claim whose assignment names a claimable model revised since that claim. The
summary memo (`SummaryMemo`) now also keeps `validUntil`, the earliest lease of a claimed
relations task that has not run out, and builds the summary again once it passes, without an
event. On 496 models a rebuild costs 15–83 ms more and a memoized read nothing ([M6 S2b follow-up
step 3b](#m6-s2b-follow-up-step-3b-2026-10-20)). It is "about" („etwa“): decisions and imports
before the claims change it, and agents may examine more pairs than they are assigned. The web
shows it beside the agent row of „Als Nächstes“ and in the waiting text after an import („etwa
7.300 mögliche Relationen“, [Web UI](#web-ui)), the CLI in `analyzr import`'s waiting line and
`analyzr status`'s models line (`about 7300 pairs to judge`, [The `analyzr`
CLI](#the-analyzr-cli)); the batch notes of the „Vorschau“ and of `import --dry-run` point there.

An invalid manifest (not UTF-8 JSON, a schema error such as a control character or a lone
surrogate in an identity field or credentials in `url`, two `manifest` parts, a header that is no
base64url) refuses the whole request with 422 `validation-failed`, `reason: 'invalid-manifest'`,
and nothing is imported. The informational `systemVersion`, `externalPath`, `derived.converter`
and `derived.llmModel` are stored tidied instead (`tidyDeclared`; an empty one as absent; since
M6 S2c-3 a rule for derived calls matches the tidied converter exactly). The import warnings
leave the file imported: `manifest-sha-mismatch` (the declared and the received SHA-256),
`external-id-moved` (the tool id already belongs to other live keys, `otherKeys`),
`external-id-changed` (the key's head declared another `(system, externalId)`, `previous`) and
`provenance-kept` (an unchanged file whose manifest declares another derivation than its revision
keeps: `derived.kind` with an absent one counted as its own kind, none declared, as owners' rules
and „Ohne Angabe“ count it, or another converter of a conversion; since M6 S2b's follow-up step 5,
which records the declared tool id, folder and link of unchanged bytes; before, another system,
tool id, tool folder or link than analyzr kept, or none kept, and never next to
`external-id-changed`), and since M6 S2c-1 `trust-kept` (an unchanged file this request would give
another trust class; at most four import warnings per file, `MAX_IMPORT_WARNINGS`: since step 5
`provenance-kept` is not raised next to a `trust-kept` that names the derivation, the two classes'
reasons differing in `converted`, `reconstructed` or `as-told`, and is dropped as a file's fifth
warning, `withinWarningLimit`). Every
revision written since S2a stores the extractor's warnings in `model_revision.extract_warnings`
(migration 0017), which the open question `extractor-loss` reads ([Open
questions](#open-questions-m6-s4)). Clients: `analyzr import` (reads the manifest at the folder's
root, checks it before anything is sent, sends each batch its subset) and `analyzr models
external-ids` ([The `analyzr` CLI](#the-analyzr-cli)); since UX8 the web upload reads a dropped
folder's manifest the same way ([Web UI](#web-ui), „Hochladen“).

### The trust rule (M6 S2c-1)

Owner decisions 24.2, 25.2 and 28 ([M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md)
§3.10, §8 "S2c-1 as delivered"; CONCEPT §2 "Trust rule"): a unique static call is accepted only
when the calling model is *modelled*; from a *derived* one it is proposed. Code: the pure
`src/domain/trust.ts`; contracts in `packages/contracts/src/api/models.ts` (`TrustClass`,
`TrustReason`, `RevisionTrust`, `ModelTrustSummary`, `ImpactProposedCalls`, the shared
`TRUST_REASON_LABELS`, `DERIVED_CALL_CONFIDENCE` = 0.9, `DERIVED_CALLER_MATCH` =
`derived-caller`). No migration, no route, no MCP change in S2c-1 and S2c-2. S2c-2 added the
fast path below (M6 §8 "S2c-2 as delivered"); S2c-3 lets owners' auto-accept rules accept these
proposals by declared source (migration 0018, no route, no MCP change; M6 §8 "S2c-3 as
delivered", "Rules for derived calls" in [Auto-accept rules](#auto-accept-rules-owner-decision-19)).
S2c-4 lets the owner review the rule tier's acceptances from before S2c (migrations 0019/0020, two
owner-only routes, no MCP change; M6 §8 "S2c-4 as delivered", „Vor der Vertrauensregel
angenommen“ below).

- **The class.** `trustOf(engine, source)`: `modelled` when the extracted `engine` is `c7` or
  `c8`, `source.uploader` is `human` (the owner key or the web session, `sourceKindOf(actor)`)
  and `source.derived.kind` is absent or `export`; otherwise `derived` with its `reasons` in the
  order `no-engine`, `agent-upload`, `converted`, `reconstructed`, `as-told` (a missing `uploader`
  counts as an agent's). `storeFile` in `ingest.ts` writes it last as `source.trust` on the
  uploaded head (so also into the `model.revised` event), and no declared value reaches it; an
  amended revision gets none, and identical bytes write no revision, so the stored class stays.
- **A model's trust.** `RevisionRepo.headTrustRows(projectId)` gives per live model the head's
  source, an amended head's uploaded revision's source (`source.upstream`), that revision's engine
  and the kind of the principal that stored it (since S2c-4 also the model's id and name, the
  uploaded revision's id and `rev`, and the owner's review of it, a LEFT JOIN), never the identity
  rows `uploadedSources` reads since M6 S2b's follow-up step 5 (nor, before them, its
  newest-declared fallback); `modelTrust` reads from it the uploaded revision's
  class (`storedTrust`: `source.trust`, since S2c-4 else the owner's review, else `null` for one
  stored before S2c, which counts as modelled: option (a)), the head plan's call targets that are
  `applied` or `in-source` (`modelledCalls`, decisions 25.2 and 28 (2)) and those in `conflict`,
  and the declared kind and converter. `Model.trust` (REST only; `trustSummary` in the store's
  `toView`) carries the class with `derivedKind` and `converter`, `null` for a revision stored
  before S2c that the owner has not reviewed.
- **The rule tier under it.** `applyTrust(runRules(…), trust)` is the one place the rule applies:
  an accepted rule-tier `call` whose caller model (the `from` ref's key) is derived and whose
  element is not in `modelledCalls` becomes `proposed`, tier `key`, 0.9, its `attrs` with
  `calledElement` and `match: 'derived-caller'`, with `trustRationale(reasons)` („Vertrauensregel:
  Der Aufruf nennt genau einen Prozess, aber das aufrufende Modell gilt als abgeleitet (ohne
  Camunda-Engine). Darum nur vorgeschlagen.“); every other relation and the findings pass through,
  and a caller missing from the map throws. `RecomputeInput.trust` is required, so
  `recomputeProject`, `previewIngest`, `deletionImpact` (the stored map without the deleted model)
  and `amendmentEffect` (before, and after with the derived head's call targets) all apply it.
  `planRecompute` compares the rationale with the stance too. A rule decision from before ends
  when the rule proposes the call (a later proposal of the rule principal ends its decision), so
  the relation turns from accepted to proposed and its version moves; a re-import as modelled
  accepts it again; human decisions stay in force with the rule proposing behind them. When the
  rules stop deriving a marked call, its withdrawal also drops `match` and `calledElement` from the
  relation's attributes. `writeRecompute` returns the derived proposals it recorded, which S2c-3's
  fifth write path evaluates.
- **Dry runs and results.** `ImportImpact.callsProposed` (`import-impact.ts`): the would-be
  derived call proposals apart from `proposalsAdded`, `wasAccepted` per item and, over all of them
  past the cap of 100, the totals `wasAccepted` and `byReason` (each call once, under its caller's
  first reason, so the parts add up to `count`). `ImpactFile.trust`: the class the uploaded
  revision would get; `previewIngest` classifies by the dry run's own credential (a read-only token
  previews agent uploads), an unchanged file keeps its stored class. `ImportFileOutcome.trust`
  only when the model's class after the request is derived (also a kept class, also in a dry run),
  so a corpus result keeps its shape. `trust-kept` (`trustKeptWarning`): an unchanged file whose
  kept class (from before S2c: the owner's review since M6 S2c-4, else modelled) differs from the
  one this request would give; only the class is compared.
- **The system rule.** `systemRule(accepted, proposed, preTrust)` describes the rule in German
  (CONCEPT §3 step 5) and `proposed` counts the open call relations with `attrs.match`
  `derived-caller`; since S2c-2 only those a bulk accept takes as they stand: `isOpenDerivedCall`
  (`trust.ts`: call, `proposed`, tier `key`, the marker) picks the stored rows, `auto-accept.ts`
  builds their relation views and keeps those `isBulkDerivedCall` accepts. `preTrust` (S2c-4)
  counts the calls `preTrustAcceptances` lists (below).
- **Clients.** CLI: the `--dry-run` line `propose instead of accept (trust rule): 12 (no engine
  10, agent token 2), 3 of them accepted until now`, the deletion impact's `N calls only proposed
  (trust rule)` and the system rule's line in `rules list` ([The `analyzr` CLI](#the-analyzr-cli)).
  Web: „Vorschau“, „Herkunft“, the system rule card, „Verlauf“ and the empty texts ([Web
  UI](#web-ui)); `src/lib/provenance.ts` copies `TRUST_REASON_LABELS` and `src/lib/limits.ts`
  `DERIVED_CALL_CONFIDENCE`, each compared with the contracts by a test; `isTrustRuleProposal`
  (`src/lib/review.ts`) tells the proposal by the assertion itself (rule, proposal, tier `key`,
  0.9, a rationale), because the relation's marker goes when the caller turns modelled.
- **The fast path (M6 S2c-2).** One bulk accept takes the unique calls of a derived landscape
  before the agent runs (a link opens the dialog with them selected, one click accepts them; at
  most 500 at a time, and one an agent asks about or objects to is decided one by one):
  - *What counts.* `isBulkDerivedCall` (contracts `api/relations.ts`, a plain function, so the
    OpenAPI spec and the client are unchanged): an open unique call from a derived model (call,
    `proposed`, tier `key`, the marker) with no agent's question on the proposal its status rests
    on and no current no-link, so a bulk accept takes it as it stands. Every number that leads
    to this bulk accept counts these: the web's „Gesammelt annehmen“ lines (`isBulkCall` in
    `src/lib/review.ts`, mirrored; a test checks it equals "derived call without bulk flags"), the
    system rule card and `analyzr import`, so each number equals the selection its link opens (up
    to 500; the rest follow). A derived call an agent asks
    about or objects to is decided one by one; the dialog's group shows it, flagged.
  - *The bulk dialog* (`components/review/bulk-accept-dialog.tsx`). `isDerivedCall` (the same
    test without the flag conditions) puts the derived calls first under „Eindeutige Aufrufe aus
    abgeleiteten Modellen (N)“, N counting every one of them, a flagged one in the group without a
    checkbox; the other unflagged pairs follow under „Gleicher Name (M)“. No name flag applies to
    such a call (`bulkFlags`: it names its target by id). The description reads „Gleicher Name und
    eindeutige Aufrufe. Markierte mögliche Relationen wählst du bewusst selbst aus.“ while derived
    calls are listed. `?bulk=calls` (`ReviewSearch.bulk`) opens it by itself for reviewers once
    the facts and so the flags have loaded, titled „N eindeutige Aufrufe annehmen?“, with exactly
    the unflagged derived calls selected (`bulkPreselection`, at most 500: „Höchstens 500 auf
    einmal; die übrigen N danach.“); the other rows stay listed, unselected. It stays open until
    closed (`bulkMode`), so the accept's refetches cannot unmount it before its toast; closing
    drops `?bulk` (replace) and moves the focus to the button that opened it, else „Vorschläge
    prüfen“, else the view „Zu prüfen“. A `?bulk=calls` with nothing to open (no such call, a
    viewer, only flagged calls) is dropped. After accepting only derived calls the toast says
    „Eindeutige Aufrufe aus abgeleiteten Modellen.“ (since S2c-3 it offers owners a rule for their
    source instead, below); a mixed selection keeps the owner's „Gleicher Name ab 100 % künftig
    automatisch annehmen?“.
  - *The links.* „Übersicht“'s „Als Nächstes“ (`src/lib/next-step.ts`, line `calls`): „N
    eindeutige Aufrufe zuerst bestätigen · Gesammelt annehmen“ while an agent row leads (after the
    failed and expired lines), „Davon N eindeutige Aufrufe · Gesammelt annehmen“ as the first line
    under „Vorschläge prüfen“; it replaces „Oder jetzt schon: Vorschläge prüfen (n). …“ when every
    open review item is such a call; the cap of two lines holds and viewers get the text only. The
    upload's „Als Nächstes“ after „Importieren“: first item `upload-next-calls`, „12 eindeutige
    Aufrufe warten auf deine Bestätigung · Gesammelt annehmen“ (reviewers, counted over the
    refreshed landscape). The system rule card's „… aus abgeleiteten Modellen vorgeschlagen“
    („Annahmeregeln“) is a link now (plain text in S2c-1). All three open
    `/projects/<p>/review?bulk=calls`.
  - *The CLI.* `analyzr import` prints the `next:` line with that link when such calls wait after
    an import of derived models, and the agent-token notice on stderr ([The `analyzr`
    CLI](#the-analyzr-cli)); the integrate plugin 0.1.2 points the consultant there ([The
    integrate plugin](#the-integrate-plugin-and-toolsintegrate-m6-s3b)).
- **Rules for derived calls (M6 S2c-3).** An owner's rule names one source („Export ohne
  Camunda-Engine“, „Konvertiert“ with one converter, „Ohne Angabe“) and accepts that source's unique
  calls in the import's own write, marked and revocable; the server side is "Rules for derived
  calls" in [Auto-accept rules](#auto-accept-rules-owner-decision-19), the web's in [Auto-accept
  rules in the web UI](#auto-accept-rules-in-the-web-ui-owner-decision-19), the CLI's in [The
  `analyzr` CLI](#the-analyzr-cli). The way there is the fast path: after „Gesammelt annehmen“
  accepted only derived calls, an owner's toast asks „Eindeutige Aufrufe aus abgeleiteten Modellen
  künftig automatisch annehmen?“ with „Annahmeregel anlegen“, which opens „Neue Regel“ prefilled
  for the source most of the accepted calls' callers declare (`derivedCallSource` over
  `Model.trust`, `/rules?new=calls&derivedKind=…&converter=…`); there is no offer when no source can
  be named (every caller uploaded with an agent token, reconstructed, as told, or converted without
  a converter) or when a rule, on or off, already names it (`ruleNamesSource`; the dialog loads the
  models and the rules for owners). `analyzr import` with the owner key suggests the same step
  after its `next:` link. The „Vorschau“ before an owner's next import says what the rule takes at
  once, and the upload's `upload-next-calls` counts only the calls left (from the landscape).
- **„Vor der Vertrauensregel angenommen“ (M6 S2c-4).** Owner decisions 24.2 (a) and 28 (3) (M6 §8
  "S2c-4 as delivered"): a one-time clean-up for landscapes imported before the trust rule, without
  a re-import. Code: `src/domain/use-cases/trust-review.ts`, `legacyTrust`, `storedTrust` and
  `preTrustAcceptances` in `trust.ts`; contracts in `packages/contracts/src/api/trust-review.ts`.
  - *Storage.* `revision_trust_review` (`0019_revision_trust_review.sql`, generated): `project_id`,
    `revision_id` (the uploaded revision), `model_id`, `class` (`modelled` or `derived`, check
    `revision_trust_review_class_check`), `principal_id`, `client_id`, `source_kind` (`human` only,
    check `revision_trust_review_humans_only`), `seq` (the event's) and `created_at`; primary key
    `(project_id, revision_id)`, one review per revision; foreign key `(project_id, model_id,
    revision_id)` → `model_revision`. `0020_revision_trust_review_triggers.sql` (hand-written): the
    append-only and no-truncate triggers (`analyzr_forbid_change`) and the `BEFORE INSERT` guard
    `analyzr_trust_review_guard`, which refuses a revision that carries `source.trust` or is
    amended (`source.kind` `amendment`), whoever writes.
  - *Reading.* `headTrustRows` LEFT JOINs the review of the uploaded revision (an amended head's
    upstream). `storedTrust`: `source.trust`, else the review (`derived` with the reasons
    `legacyTrust` computes from what the revision carries, or `modelled` with none), else `null`;
    a review never overrules a stored class. `modelTrust`, `trustSummary` (so `Model.trust`, also
    on `GET …/models`) and the class unchanged bytes keep (`keptTrust` in `ingest.ts`, one more
    query and only for a revision without `source.trust`; so `ImportFileOutcome.trust` and
    `trust-kept`) all read it. Hence a revision reviewed `derived` with the reason `agent-upload`
    gets the safeguard `agent-upload` like a classified one: no rule accepts its calls again.
  - *The list.* `preTrustAcceptances(rows, relations, histories)`, pure, by model in key order,
    the calls by natural key: an accepted `call` relation whose endpoints are present
    (`endpointState` not `missing`) and that rests on the rule tier's decision alone (no other
    decision in force, an owner rule's marked acceptance included), whose caller's uploaded
    revision carries no class and has no review, whose element is not in `modelledCalls`
    (decision 25.2), and whose revision would be derived from what it carries (`legacyTrust`:
    engine null; `uploader` agent, or for a revision stored before S2a a `service` principal; a
    declared kind other than `export`). An amended head names its uploaded revision. Camunda
    models a human imported, the demo and the live-run projects list nothing.
  - *Routes* (tag `auto-accept`; both use cases call `policy.require(…, 'admin', …)`: owners on
    an interactive client; editors, viewers, agent tokens and read-only tokens get 403; no MCP).
    `GET /api/v1/projects/{project}/pre-trust-calls` → `PreTrustList {count, models}`, each
    `PreTrustModel` with `modelId`, `modelKey`, `modelName`, the uploaded `revisionId` and `rev`,
    `reasons` (at least one), `derivedKind`, `converter`, `count` and the first 100 `calls`
    (`{relationId, from, to}`). `POST …/pre-trust-calls/review?dryRun=` with
    `PreTrustReviewBody {verdict: 'derived' | 'modelled', revisionIds (unique, ≤ 1000),
    expectedCount?}` → `PreTrustReviewResult {dryRun, verdict, revisions, count, toProposed,
    autoAcceptedCalls}`. Refusals in this order: 422 `validation-failed` with `reason`
    `unknown-revision` (no revision of the project) or `revision-classified` (it carries
    `source.trust` or is amended); 422 `expected-count-required` (the real call only); 409
    `conflict` with `count` and `reason` `not-listed` (a revision not listed now: reviewed,
    uploaded again, or nothing of it to review; the dry run answers it too and the message says to
    list again, so a client never loops), then `count-changed` (`expectedCount` is not the number
    of listed calls of the named revisions; it counts calls, not revisions). The demo answers the
    GET with 403 (`apps/demo/src/check.ts` checks it) and the POST with `demo-readonly`.
  - *The write* (under `lockForWrite`): one event `revision.trust_reviewed {revisionIds, class,
    count}`, the review rows with its `seq`, then for `derived` `recomputeProject` (the calls turn
    into the rule tier's proposals, tier `key`, 0.9, with the rationale) and
    `autoAcceptDerivedCalls` over the proposals it recorded, caused by the owner, so an enabled
    S2c-3 rule may accept them again in the same write; `toProposed` counts the relations
    accepted before that are open derived calls after. `modelled` („Behalten“) writes only the
    event and the rows: for the rule tier and the auto-accept evaluator (everything the recompute
    reads) that class reads like `null`, so nothing is recomputed; only `Model.trust` shows
    `modelled`.
    No analysis is queued; the calls wait for „Gesammelt annehmen“.
  - *The dry run* plans the same over a snapshot and writes nothing: `relationImpact` with the
    reviews applied in memory and the owner's rules as an import's dry run evaluates them;
    `toProposed` is `callsProposed.wasAccepted`, and `relationImpact`'s new fourth parameter
    `ofProposed` (`'proposed'` | `'was-accepted'`) counts `autoAcceptedCalls.ofProposed` among the
    calls accepted before for a review (`'was-accepted'`) and among `callsProposed` for an import
    (`'proposed'`, the default), as the write counts it. The calls left for „Gesammelt annehmen“
    are `toProposed − ofProposed`. „Behalten“'s dry run answers `count` and zeros.
  - *Clients.* Web: the system rule card's line, its dialog and the toast ([Auto-accept rules in
    the web UI](#auto-accept-rules-in-the-web-ui-owner-decision-19)). CLI: `analyzr rules
    pre-trust` and the system rule's line ([The `analyzr` CLI](#the-analyzr-cli)).
- **What it costs.** Camunda models a human imports behave as before, so the corpus, the seeds, the
  demo and the live-run projects do not change. Unique calls of a landscape without an engine (a
  Signavio export), with a declared conversion or imported with an agent token (also
  `ANALYZR_TOKEN` set in the shell, which `analyzr import` prefers to the owner key, so it says
  so) wait for a human. Since S2c-2 that is one bulk accept: „Gesammelt annehmen“ after
  „Importieren“ or on „Übersicht“, the system rule card's count or the CLI's link opens the dialog
  with them selected, and one click accepts them before the agent runs (at most 500 at a time; one
  an agent asks about or objects to is decided one by one); accepted pairs are settled, so the agent's relations claims skip them and the agent judges only
  the pairs that are really open. Calls left unaccepted stay unsettled, and the claims assign them
  to judge too. Since S2c-3 an owner's rule for a trusted source accepts the unique calls each
  later import of that source proposes without a click (marked, revocable; calls already waiting
  need `rules apply`; never an agent token's upload, and no write made with an agent token sets it
  off), offered in the toast right after the first bulk accept. Since S2c-4 a landscape imported
  before the trust rule catches up without a re-import: the system rule card (or `analyzr rules
  pre-trust`) lists the models whose unique calls the rule tier accepted although they would be
  derived today, one list and one decision per model; „Zurück in die Prüfung“ sends the calls
  straight to „Gesammelt annehmen“ (or an enabled rule for that source accepts them again in the
  same write), and „Behalten“ ends the question for good. Camunda landscapes a human imported list
  nothing.

### Web UI

`apps/web` is the owner's UI in local mode (CONCEPT §6, M1-SKELETON item 9). In development it
runs under Vite on http://127.0.0.1:7401 (`pnpm dev`, proxying `/api`, `/mcp` and `/health` to
the server); after `pnpm build` the server serves it at http://127.0.0.1:7400.

| Route | Content |
|---|---|
| `/` | projects: the name with its key below, „Rolle“ only while a role is not „Inhaber“ (always on the demo), „Offen für dich“ (since UX9 from `GET /projects/{p}/summary`: relations to review, open placements and questions to clarify, in the shared focusable „Offene Punkte“ cell; „–“ for viewers, the demo visitor and 0, „nicht geladen“ on a failed read) and „Zuletzt geändert“ (the latest event; on a phone a line under the key); „Neues Projekt“ with the key derived from the name as one line „Kurzname: kunde-maschinenbau (ändern)“ (the field opens on demand or on a taken key, whose 409 says so in German); the seed hint and „Seed-Befehl kopieren“ only in the dev server (UX1) |
| `/projects/{key}` | **Übersicht** (UX1, [UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §2.3, §3.2): **„Als Nächstes“** (`src/lib/next-step.ts`, first match wins: „Agent verbinden“ or the popover „Agent starten“ (owners) while models wait for an agent (since M6 S2b's follow-up step 3b with the size of the agents' next run beside the button as muted plain text, no control, once the owner's tokens are known: „etwa 7.300 mögliche Relationen“, `next-step-pairs`, the summary's `pairsToJudge`, read only while models wait, [The agents' next run](#provenance-and-the-import-manifest-m6-s2a); „1 mögliche Relation“ without „etwa“, nothing for 0 or while only failed or expired analyses wait), „Nochmal versuchen“ when only failed analyses or expired reservations wait, „Vorschläge prüfen (n)“ at the review queue's first item, „Platzierungen prüfen (n)“ at the placement queue's first item, „Offene Fragen klären (n)“, else „Alles geprüft.“; at most two lines below: „Agent arbeitet – n Modelle offen“, „n Modelle warten auf den Agenten“ (editors, viewers; since step 3b „5 Modelle warten auf den Agenten · etwa 7.300 mögliche Relationen“, „1 Modell wartet auf den Agenten · 1 mögliche Relation“), „n Analysen gescheitert · Nochmal versuchen“, „Bei n Modellen ist die Reservierung abgelaufen · Nochmal versuchen“, since M6 S2c-2 „n eindeutige Aufrufe zuerst bestätigen · Gesammelt annehmen“ (the unique calls of derived models a bulk accept takes, `isBulkCall`; under „Vorschläge prüfen“ the first line, „Davon n eindeutige Aufrufe · Gesammelt annehmen“; to `/review?bulk=calls`, [The trust rule](#the-trust-rule-m6-s2c-1)), „Oder jetzt schon: Vorschläge prüfen (n). …“ (not when every open review item is such a call), „Noch keine Wertschöpfungskette · Anlegen oder importieren“; viewers get the text without buttons) with **„Exportieren“** at its right (`components/export-hub.tsx`, each entry only with content: the questions for the customer as Markdown or CSV (the export route's default `ask` under the old file name), the change list for the source tool (Markdown, CSV), the chain as `.vc.json` and as an SVG drawn on the chain page, `?export=svg`); then **„Modell suchen …“** (`?q=`, name and key, umlauts and case folded, `matchesName`) and the **phase chips** „Modelle nach Phase: Alle 31 · Wartet auf Prüfung 28 · …“ (`?stage=`, only stages with models, `components/review/stage-bar.tsx` `StageChips`; with a chip active and proposals open the link „n Vorschläge dieser Modelle prüfen“ to `/review?stage=`); the **models table** „Name | Phase | Offene Punkte | Aktualisiert“: the model's name as the link (its key when it has none) with the key small below, the mark „ergänzt“ (M6 S5c-2) and, since UX8, the derived chip of a file that is no plain export („Konvertiert“, „KI-rekonstruiert“, „Aus Interview“, from `Model.source`, the system in its tooltip; never a column), under the phase badge the holder and reservation („agent-sim · reserviert bis 22:45“), „Reservierung abgelaufen am … · Nochmal versuchen“ or „Nach 3 Versuchen gescheitert · Nochmal versuchen“; **„Offene Punkte“** = the model's open relations (`Model.openItems`) + the open and held placements of its processes + `askByModel` (one subject once, the agents' questions add nothing), as text (no one list holds a model's relations, placements and questions; P7), its split („7 Relationen · 1 Platzierung · 1 Frage“) in a tooltip on the focusable number (`role=tooltip`, `aria-describedby`; since UX3 the model view's tabs count its questions and relations); on a phone name and phase stack and „Aktualisiert“ hides; engine and revision live in the model view. An empty project keeps „Modelle hochladen“ and the ghost „Agent verbinden“ |
| `/projects/{key}/review` | **Relationen** (the tab since UX1 is M2's inbox; its badge counts open proposals and accepted relations with a changed endpoint). Since UX5 ([UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §3.6, owner decision 26 (6)) the tab's views (`components/review/relation-views.tsx`, links with `aria-current`): **Zu prüfen (n)** and **Vorgemerkt** here, **Gilt**, **Abgelehnt**, **Automatisch angenommen** (only above 0, with the ledger) and **Alle** on `/relations`; the model filter stays across them. „Zu prüfen“: one status line only when something needs an action („2 Modelle warten auf den Agenten · Agent starten“ for owners, „1 Analyse gescheitert · Nochmal versuchen“, „Bei 1 Modell ist die Reservierung abgelaufen · Nochmal versuchen“; `lib/pipeline-state.ts`, shared with „Übersicht“); one row with „Vorschläge prüfen (n)“ at the queue's first item, „n unauffällige annehmen …“ beside it (reviewers; the key tier only, shown once every model's facts loaded, its count the dialog's default selection; since M6 S2c-2 `?bulk=calls`, the target of the „Gesammelt annehmen“ links and of the system rule card's count, opens the same dialog with the unique calls of derived models selected, [The trust rule](#the-trust-rule-m6-s2c-1)) and the filters „Grundlage“ and „Modell“ at the right (while there is something to filter, or one to lift); the queue (`QueueList`: the processes first, „Gutschrift erstellen → Reklamationsbearbeitung“, the key only where two models share a name, below the message or call name once and both where they differ beyond spelling, the type icon and the confidence; at the right „Angenommen, Endpunkt geändert“, „widerrufen“, „Frage“, „Einwand“, „schließt 1 Modell ab“ and the agent only when several propose; one link per row, a click anywhere on the row for the mouse; on a phone the same row as a card); the foot link **„Kein Zusammenhang laut Agent (n)“** to `?view=no-links` (the agents' live, current no-links with their reasons, also on pairs without a relation, grouped by model and closed, read-only, filtered by model and stage; „‹ Zu prüfen“ back). The placements callout went (the chain's badge counts them). **Vorgemerkt** (`?view=held`): one sentence „Die Antwort ist eine Notiz an der Relation; entschieden wird, sobald sie feststeht.“, read-only rows with „Antwort geben“ (the note dialog of „Offene Fragen“, UX2b) and „Jetzt entscheiden“ (the review screen). Filters `?stage=&tier=&model=` stay in the URL and travel to the review screen ([below](#review-in-the-web-ui-m2)); an active `?stage=` shows as the removable chip „Phase: …“ |
| `/projects/{key}/review/{relation}` | **Review screen** of one relation, also the relation detail and the `reviewUrl` of `human-decision-required` ([below](#review-in-the-web-ui-m2)) |
| `/projects/{key}/relations` | the results of **Relationen** (a tab of its own until UX1; since UX5 its views „Gilt“ `?status=accepted`, „Abgelehnt“ `?status=rejected`, „Automatisch angenommen“ `?auto=any` and „Alle“, the quick filters gone): filters status/tier („Grundlage“)/type/model in the URL (`?status=&tier=&type=&model=`), for reviewers also the filter `?auto=any|aar_…` (owner decision 19). Since UX9 ([UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §3.10): „Status“ (only in „Alle“) and „Modell“ visible, „Grundlage“, „Typ“ and „Annahmeregel“ (not in „Abgelehnt“) behind „Weitere Filter (n)“; rows of type, from → to (names wrapped, not cut, no ref tooltip), „Grundlage“, status, confidence, „Entschieden von“ (a human's handle, „analyzr“ for the rule tier, „Regel „…““ for an acceptance in force, never procedure or model ids) and one „Öffnen“, 40 rows a page (`?shown=`), which the review screen keeps (`?from=relations`: J/K walk the result list, a decision stays, the back link returns to the view and page); without any relation the empty state „Noch keine Relationen. …“ with „Agent starten“, here and on `/review`. |
| `/projects/{key}/findings` | **Befunde** grouped by kind, each ref with a link into the model view; no tab since UX1 (owner decision 26, Q2): „Alle Befunde der Modelle als Liste (n)“ at the foot of „Offene Fragen“ leads here, the crumb names it |
| `/projects/{key}/open-questions` | **Offene Fragen** (M6 S4; reworked in UX2b, [UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §3.3; the last of the four tabs, its badge counts „Zu klären“, `totals.ask` of `GET …/open-questions?state=open&group=ask&limit=1`, the call that also gives „Offene Punkte“ their `askByModel`; every role and the read-only demo): one intro line („Was in der Landschaft noch fehlt. Zu jeder Frage gibt es eine Aktion, mit der du sie erledigst.“, the second sentence for reviewers only) with „So funktioniert es“ closed; three filters „Art“, „Modell oder Ordner“ (folders and models) and „Ansprechpartner“ (step owners and lanes) in the URL (`?kind=&model=&askWho=`), counted under the other filters, on a phone behind „Filter (n)“; a link's `?source=` shows as the removable chip „Quelle: …“; the count line „21 zu klären“ (filtered „3 von 21 zu klären“; the badge's number); „Für den Kunden exportieren …“ opens a dialog: „Zum Lesen (Markdown)“ (default) or „Zum Ausfüllen (CSV)“ and „Auch Fragen der Agenten (n)“ (off, shown with agents' questions under the filters), downloading the export route's file for the list's filters with `group` (`ask`, so the old name `offene-fragen-<project>[-<filters>].md\|csv`; with the agents' questions `-ask-agent`) and `state=open` (the open items, as the list shows them: a marked item is not asked again; `open` adds nothing to the file name), every opening from the defaults, the focus back on the button that opened it. The cards are the open items of `group=ask` in the server's order (questions by open decisions, then the value chain's findings, the owner's answer of 2026-10-16): the kind badge, the subject's name with the process an element lies in and, since the owner's walkthrough (2026-10-18), a labelled button into the diagram at the header's end („Im Modell zeigen“, in the model view „Im Diagramm zeigen“, „Modell öffnen“, „In der Kette zeigen“, „Relation ansehen“: the model view at the element, the review screen, the chain at `?step=` or `?placement=`; left out where a visible „Jetzt entscheiden“, „Vorschlag öffnen“ or „Auf der Kette prüfen“ opens the same place, `viewLink`), „Betrifft N offene Entscheidungen“ from two on; the question with „Warum?“ closed (the reason, an agent's verbatim reason after „Laut Agent“, a hold's note); a hold's label; „Ansprechpartner: …“; the latest note and, with more, „Verlauf (n)“ (notes and withdrawn marks); no ids, event numbers or source labels (the id under „Kennung kopieren“ in „Weitere Aktionen“). „Art“ „Frage eines Agenten“ lists the agents' questions instead (their `decide` the link „Vorschlag öffnen“ to the proposal); the chain's `proposal` items are never listed (the chain's badge counts them). Below the cards the closed groups „Zur Information (n)“ (agents' summaries one line each with „Zusammenfassung des Agenten anzeigen“, descriptive models one line when two or more share their reason) and „Erledigte zeigen (n)“ (one line per marked item, „Außerhalb der Landschaft · <Notiz>“, with „Markierung zurücknehmen“; a link with `?state=answered` opens it), then „Alle Befunde der Modelle als Liste (n)“. For editors and owners (permission `review`; not on the read-only demo) at most three actions per card: the primary action as a button, one beside it where needed, the rest under „Weitere Aktionen“, a menu of the note alone the ghost button „Notiz“ (UX4); `link`, `place` and `choose-copy` open a picker with „Vorgeschlagen“ first, then up to three best fits by name under „Passt vermutlich“ (UX4: the call's label and unresolved value, the endpoint's name, `bestFits` in `lib/generic-names.ts`), then the rest by name, rows „Name – Modell“ (the ref in the tooltip), the copies of a duplicated id by their model's path (the id behind „Technische Angaben“), the note behind „+ Notiz“, each naming what it will write or accept before it does; the outside mark, „Gehört zu keinem Schritt“ and „Erneut einplanen“ run in one click; „Link korrigieren“ opens the chain page at the step; a hold answers with „Antwort geben“ in the note dialog (also from its „Vorgemerkt“ row and the review screen, one place to answer a hold; „Antwort“ throughout the dialog, the card's „Antwort vom …“; a hold without an open item, an end missing, answers on the relation itself) and is decided with „Jetzt entscheiden“, which leads once the hold has its answer („Antwort ergänzen“ beside it) (the review screen at `?view=held`, or the chain at the placement; owner decision 26, Q4: no inline decision panels since UX2b); a toast names what an action did, with „Rückgängig“ when it wrote manual relations or a placement (rejected in one bulk decision) or an outside mark (withdrawn), and the way to the decision when it decided existing proposals; „Notiz hinzufügen“ records a note that leaves the item open (the dialog says what ends it). „Antworten aus CSV übernehmen …“ reads the filled-in CSV (a German file picker, UTF-8 only, also an S5a sheet with `Antwortart`), previews it through the dry run (stored, unchanged, unknown ids and invalid rows with their spreadsheet rows and texts, the personal-data alert), stores it with „N Antworten speichern“ and stays open listing the rows left out. Since M6 S5c-2 (model amendments, [above](#model-amendments-m6-s5c-2)): `amend` opens the amend form for the question's fields (a process picker with „Vorgeschlagen“ and „Passt vermutlich“ first for a call target, the landscape's names with their endpoints for a message name (a picked partner is accepted with it), labels elsewhere for a start or end name, documentation; the live personal-data warning, the value as it will be stored). Since UX4 ([UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §3.4, owner decision 26 Q5) a call's or an endpoint's link and its amendment are one entry, „Ziel wählen …“ or „Partner wählen …“ (`linkWithAmend`; the API keeps both actions and their labels): after the pick, editors and owners choose with „Im Modell eintragen (statt nur zu verknüpfen)“, checked where the amendment was the primary action (no key or name yet); checked sends only the amendment (a call target the landscape offers, or a partner whose name the endpoint can take), unchecked only the link, never both. The dry run runs by itself once the values settle (`useAmendDraft`, 400 ms, `If-Match` of the head the form read; its key outside the project's, so a save's refresh does not run it again), „Danach: …“ and the cost („Die Agenten beurteilen 15 mögliche Relationen neu, sobald du den Agenten startest.“) stand above the one „Speichern“, which asks a second time („Trotzdem speichern“) only when an agent holds the model's task; the hint that the next import keeps the amendment sits behind „Und beim nächsten Import?“; after the save the toast offers the owner „Agent starten“ (the root's `AgentStartHost`) or „Agent verbinden“. „Sammeln“ and its bar are gone; an `amendment-conflict` shows the source tool's value and analyzr's side by side, with „Wert aus dem Quellsystem übernehmen“ and, where offered, „Meine Ergänzung behalten“; every withdrawal asks first with its dry run's cost and sends `If-Match` with the head it showed. A lazy route chunk; the labels come from the zod-free `@analyzr/contracts/open-question-labels` and `…/amendment-labels`, the sheet reader from `…/open-question-csv` and the warning check from `…/personal-data` |
| `/projects/{key}/upload` | **Hochladen** (since UX1 the button pinned right of the tab row, an icon with `aria-label` on a phone; editors and owners; the crumb „<Projekt> › Hochladen“): drag and drop files or a whole folder, or pick them; `POST …/imports` in batches of ≤ 50 files / 25 MB; the shared file rule of `@analyzr/contracts/paths` decides (M6 S1, as `analyzr import`: `.bpmn`, `.bpmn2`, `.bpmn20.xml`, `.xml`; the picker's `accept` and the text „Erlaubt sind …“ come from `BPMN_FILE_SUFFIXES`): hidden files are dropped silently; models > 5 MB, other files, a plain `.xml` whose key a `.bpmn…` file has (a tool's sidecar, never sent, `keyTakenBy`, as `analyzr import`) and a plain `.xml` the server refuses as no BPMN are skipped and named in one line, up to three with their reason („1 Datei übersprungen: Prozesslandkarte.pdf (kein BPMN)“; „größer als 5,0 MB“, „gleicher Kurzname wie Prozess.bpmn“), the rest counted with the whole list behind a disclosure (UX7); every model key is derived before sending, in code-point order as `analyzr import` (`comparePaths`, `modelKeyOwners`: a `.bpmn…` file gets a key before a plain `.xml`), so a path without a valid key or with the key another file gets (other than such a sidecar) fails without being sent, naming that file; when every file is a plain `.xml` that is no BPMN, the warning toast „Keine BPMN-Dateien gefunden“ replaces the success toast; a dropped or picked folder is the import root, so `models/vertrieb/a.bpmn` becomes `vertrieb/a`, like `analyzr import models`. Since M6 S2b a drop shows the dry run first (`?dryRun=true`, each batch with the whole manifest), in the result's own layout: „Vorschau: 5 Modelle neu · 1 Fehler · 1 übersprungen“, the outcome column „Wird neu“, „Neue Revision“, „Unverändert“, „Fehler“, at most three lines of what would change („Danach: 2 Aufrufe automatisch verknüpft · 1 angenommene Relation mit geändertem oder fehlendem Endpunkt · 3 Modelle des Quellsystems nicht im Bundle (bleiben erhalten)“, `impactLines`; since M6 S2c-1 a line right after the linked calls, „12 Aufrufe nur vorgeschlagen (ohne Camunda-Engine) – nach dem Import gesammelt annehmen“, for the unique calls of derived models, naming the most common reason of `callsProposed.byReason`, which can push the last line out of the three; since M6 S2c-3, in an owner's preview with an enabled rule for derived calls, what the rules take at once, `autoAcceptedText`: „12 Aufrufe nur vorgeschlagen (ohne Camunda-Engine) · deine Regel „Aufrufe: Export ohne Engine“ nimmt 12 davon gleich an“, „… und 3 bereits vorgeschlagene“ for calls proposed before that the import proposes again (`ofProposed` tells them apart), „deine Regeln nehmen“ for several rules, „– nach dem Import gesammelt annehmen“ only while calls proposed anew are left, and without calls proposed anew a line of its own, „1 bereits vorgeschlagener Aufruf – deine Regel „…“ nimmt ihn gleich an“; since M6 S2b's follow-up step 3, with a live value chain, „1 angenommene Platzierung mit geändertem oder fehlendem Prozess“ right after the endpoints line, and the agent work the import sets off always in the last of the three, on a first import too, so it can push the endpoints or placements line into the list: „Danach: 3 Aufrufe automatisch verknüpft · 2 angenommene Relationen mit geändertem oder fehlendem Endpunkt · 214 mögliche Relationen zu beurteilen (56 davon erneut), 7 Prozesse zu platzieren“ (`agentCostText` in `lib/agent-cost.ts`); the relations part only when `pairs` is above 0, „1 mögliche Relation zu beurteilen“, „(N davon erneut)“ for the pairs judged again; the placement part when the import triggers the chain's placement task and it has processes to place (`processesToPlace`: for a task the import queues every process due, also those due before, for one waiting or held by an agent the newly due ones), „(N davon erneut)“ for those an agent had placed; „etwa“ in front for more than one batch; every count of the lines in de-DE („1.234“); an unchanged re-import has no cost line and keeps „Danach: keine Änderung an Relationen und Befunden.“; since step 5, when no file would be created or revised and unchanged files would record a new place in the tool, the part „Ort im Quellsystem für 6 Modelle aktualisiert“ („für 1 Modell“, `identityUpdateText`) instead, after the absent-keys line if there is one; beside a created or revised file the places go along unnamed), the capped lists behind „Was ändert sich?“, shown only when one has items (since M6 S2c-1 also „Aufrufe als Vorschlag“, „(bisher angenommen)“ after a call whose acceptance would end; since step 3 „Angenommene Platzierungen mit geändertem oder fehlendem Prozess“ after the endpoints' list, „lager/versand#Process_1 → „Versand“ (fehlt)“, „Außerhalb der Kette“ for `@outside`, a step without a name by its id, and last „Mögliche Relationen, die erneut beurteilt werden“, „Nachricht a#Send → b#Catch“; the pairs to judge and the processes to place are counts without a list), the hint when every key starts with one folder („Alle Kurznamen beginnen mit „x/“ – leg den Unterordner ab, …“; keys are fixed for good), for more than one batch „Vorschau je 50 Dateien; Aufrufe zwischen den Teilen erscheinen hier als unaufgelöst.“ (since step 3 `batchNoteText`; when new models lie in two batches or more, a first import in parts, „… als unaufgelöst, mögliche Relationen zwischen neuen Modellen verschiedener Teile fehlen in der Zahl.“, since step 3b „…; die ganze Zahl steht nach dem Import unter „Als Nächstes“.“), since step 3, when the import cancels relations tasks an agent holds, the destructive alert `preview-claimed` above the buttons (one model: „Ein Agent bearbeitet „vertrieb/auftrag“ gerade; seine Arbeit geht verloren.“ and „Der Import bricht seine Analyse ab; sie wird danach neu eingeplant.“; several: „Agenten bearbeiten gerade 5 dieser Modelle; ihre Arbeit geht verloren.“ and „„a“, „b“, „c“ und 2 weitere. Der Import bricht ihre Analysen ab; sie werden danach neu eingeplant.“, at most three named; no handle, no lease; a placement task an agent holds keeps its work and gets none; the „keine Änderung“ line hidden beside it), then „Importieren“ (only when a file would be created or revised, since M6 S2b's follow-up step 5 also when an unchanged file would record a new place in the tool, `identityUpdated`; it sends the same plan; while that alert shows, the first click sends nothing and turns the button into the destructive „Trotzdem importieren“, described by the alert through `aria-describedby`, and the second click imports; „Abbrechen“ closes the preview and so disarms, a new preview asks again, and a double click arms only: `useSecondClick`, which the amend form's „Trotzdem speichern“ and the action panel's submit share) and „Abbrechen“; after „Importieren“ the panel turns into the result below. Since UX7 ([UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §3.9) the dropzone says „BPMN-Dateien oder einen Ordner hierher ziehen.“ („… auswählen.“ on touch), „Der Ordnerpfad wird zum Kurznamen, z. B. finanzen/mahnwesen.“ and the converter for tool exports with a copy button (the limits only in a skip or an error); the result's headline counts what happened („5 Modelle importiert · 1 Fehler · 1 übersprungen“; while it runs „Importiere … 3 von 6 Dateien“); „Als Nächstes“ below it, the web twin of `analyzr import`'s `formatNextSteps`, names first (since M6 S2c-2, reviewers) the unique calls of derived models that wait, „12 eindeutige Aufrufe warten auf deine Bestätigung · Gesammelt annehmen“ (`upload-next-calls`, to `/review?bulk=calls`), then what waits for the agent („5 Modelle warten auf den Agenten“, the models in `waiting_for_agent`, and the chain's queued placement task; since M6 S2b's follow-up step 3b with the size of the agents' next run, „5 Modelle und die Platzierungen warten auf den Agenten · etwa 7.300 mögliche Relationen“, from the summary's `pairsToJudge` read once the import's refresh is done and only while models wait, shown only from a read after the import that succeeded, so no number from before it, `isSuccess && isFetchedAfterMount`; none when that read fails) with „Agent starten“ (owners; „Agent verbinden“ without a token), „9 offene Fragen gibt es schon jetzt · Offene Fragen ansehen“ and „Zur Übersicht“, a placeholder until the project's queries have refreshed; one row per file „Modell | Ergebnis | Hinweis“ (the model link with the file's path below); a failed file says why in German by the problem's code, `reason` and `encoding` (`fileProblemText`: „Die Datei ist UTF-16-kodiert; analyzr liest nur UTF-8. Speichere sie als UTF-8 oder wandle den Export mit /analyzr-integrate:integrate-landscape um.“), the server's words behind „Technische Details“; the extractor's warnings as „2 Hinweise“ in a disclosure (`groupWarnings`): the elements bpmn-moddle or the extractor skipped for an invalid or a used id in one entry per cause („2 Elemente übersprungen, weil ihre ID ungültig ist: Aufgabe „Aufgabe_Bonität_prüfen“, Datenspeicher „4711“. Sie fehlen im Diagramm und in den Verbindungen. Mit /analyzr-integrate:integrate-landscape bereinigen und erneut hochladen.“; their diagram shapes and the references to them fold in, every skipped element one „Hinweis“), every other warning with its German label per code and the element id (an unknown code shows the code), the English messages behind „Technische Details“; beyond the extractor's 100, „100 Hinweise“ and its `too-many-warnings` entry „Weitere Hinweise ausgelassen“ after „… und 81 weitere“. Since UX8 a folder with `analyzr-import.json` at its root is read as `analyzr import` reads it (`lib/upload-manifest.ts`: checked with the contracts' own `ImportManifest`, a dynamic import of `@analyzr/contracts/import-manifest`, so zod stays out of the entry): its pinned keys plan the upload (`planUpload`'s `keyOf`), each batch sends its subset as the part `manifest`, the manifest, the bundle's chain and inventory are neither sent nor listed as skipped; one line says „Bundle erkannt: Signavio, exportiert am 14.10.2026 · 6 von 6 Dateien gelistet · Kurznamen aus dem Bundle“ (and „2 Dateien stehen nicht im Bundle; sie bekommen ihren Pfad als Kurznamen.“); an invalid manifest, or one only in a subfolder, stops before anything is sent with a German reason; the identity warnings show in German in the file's disclosure (`importWarningText`, „Im Quellsystem umbenannt oder verschoben? „sid-K“ gehörte bisher zu „lager/alt“; …“; since M6 S2c-1 also `trust-kept`: „Unverändert: analyzr behält, ob es die Aufrufe des Modells annimmt oder nur vorschlägt. Eine neue Einstufung braucht geänderte Dateien.“; since M6 S2b's follow-up step 5 `provenance-kept` as „Unverändert: analyzr behält die bisherige Angabe, wie die Datei entstanden ist. Eine Korrektur braucht geänderte Dateien.“) and `external-id-moved`/`-changed` count in the headline („1 Hinweis zur Identität“); a bundle with a value chain adds „Das Bundle enthält eine Wertschöpfungskette · Auf der Kette importieren“ to „Als Nächstes“; since M6 S5c-2, for a model with live amendments, what became of them („2 Ergänzungen angewendet, 1 im Quellsystem übernommen, 1 Konflikt“), conflicts with the link „in „Offene Fragen“ entscheiden“ (the tab filtered by `amendment-conflict` and the model) |
| `/projects/{key}/agents` | **Agent verbinden** (since UX1 in the owners' menu „Einstellungen“, the gear right of the tab row; the crumb names it): create an agent token (since UX7 the name and „Token erstellen“; „Erweitert: Rechte und Gültigkeit“ closed with today's defaults; that agents only propose said once, in step 1's description), secret shown once with a copy button, then ready-to-paste configurations: Claude Code (`claude mcp add --transport http …`), Claude Desktop (`analyzr mcp` from the checkout with Node 24, or `docker exec -i … analyzr-server-1 analyzr mcp`; the Node or Docker path you enter becomes `command`), any other MCP client (URL + bearer header, `.mcp.json`); step 3 „Agent starten“ with the popover's commands inline (`StartCommands`); list and revoke tokens (the token's prefix below its name; revoking says in two sentences what stops at once and that decisions stay, the rest under „Was passiert genau?“) |
| `/projects/{key}/rules` | **Annahmeregeln** (owner decision 19, owners only; the tab „Regeln“ until UX1, now in the menu „Einstellungen“, which other roles do not see; the crumb names it): the system rule in one line, the project's auto-accept rules (since UX9 a row of „Aktiv“, „Bearbeiten“ and „Mehr“), the create/edit dialog with the live preview (since M6 S2c-3 with the third „Art“ „Eindeutige Aufrufe aus abgeleiteten Modellen“), apply, revoke, revisions, since M6 S2c-4 the system rule's line „… vor der Vertrauensregel angenommen – prüfen…“ with its dialog ([below](#auto-accept-rules-in-the-web-ui-owner-decision-19)) |
| `/projects/{key}/value-chain` | **Wertschöpfungskette** (M4 S3, the tab counts open placement items): the chain on a full-viewport canvas, the side panel (from 1024 px an aside the zoom group's toggle hides, below it a sheet; UX6), edit mode; `?step=` selects a step, `?placement=plc_…` (the `reviewUrl` of placement writes) a placement and its step, `?from=open-questions` (the tab's links) leads the way back and the end of a decision to „Offene Fragen“ ([below](#value-chain-in-the-web-ui-m4)) |
| `/projects/{key}/value-chain/steps/{element-id}` | **Step view** (drill-down, in the project layout): breadcrumb, sub-steps with counts, the step's processes (own, in the sub-steps, reached by call) with links to the model view and back to the chain |
| `/projects/{key}/models/{model-key}` | **Model view** (since UX3, [UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §3.5 and §3.13): borderless bpmn-js `NavigatedViewer` (lazy chunk) with the shared canvas header and panel. The header (`components/canvas-header.tsx`): from 1024 px a card with the crumb „<Projekt> › Übersicht“ as the one way back, the model's name with its key small below, at most three chips (stage, „In analyzr ergänzt (n) · aus r<rev>“ naming the uploaded revision, the derived chip of UX8) and „Mehr“; below 1024 px a top bar with „‹ Übersicht“, the name, „Mehr“ and the first chip; „Beim Import übersprungen: 2 Elemente – Details“ from the model's open `extractor-loss` question below it (its „Details“ shows the card in „Fragen“). „Mehr“ (`ModelMore`, in the amendments chunk, never in the entry): „Herkunft …“ (a dialog, `components/model-provenance.tsx` `ProvenanceDetails`: „Aus Signavio 19.6.0 · exportiert am 14.10.2026 (angegeben)“, the place in the tool (since M6 S2b's follow-up step 5 „Im Quellsystem“ from `Model.identity`, as the newest import declared it, „Signavio: …“ when the revision declares no system or another one, no line for an identity without a folder), how the file was derived, who uploaded it, the losses of a conversion; an amended head through `source.upstream`; since M6 S2c-1 for a derived revision the line „Aufrufe: nur als Vorschlag (ohne Camunda-Engine)“ with every reason, plus „· von dir gesetzte Aufrufziele gelten als modelliert“ when a call target was set in analyzr; none for a modelled revision or one stored before S2c), „In Signavio öffnen“ for an http(s) link (`noopener noreferrer`; since step 5 `Model.identity.url`, so it no longer waits for the revisions), „Revisionen (n) …“ (a dialog, uploaded and amended), „BPMN herunterladen“, „Original herunterladen“ (an amended head's uploaded bytes), „Fürs Quellsystem“ with the change list as Markdown or CSV, and the line „<Engine> · Kopfrevision rN“. The panel „Dieses Modell“ (`components/canvas-panel.tsx`; from 1024 px an aside at the right, below it a sheet collapsed to its handle „Fragen 3 · Relationen 7“, the content `inert` while collapsed, Escape collapses, the canvas container ends above the sheet in both states) with the tabs **„Fragen (n)“** and **„Relationen (n)“**: it opens on „Fragen“ when there are questions or the selected element offers „Ergänzen“ or „Verknüpfen mit …“, else (and for `?relation=`) on „Relationen“, settled once per selection. „Fragen“: the model's open questions „Zu klären“ (M6 S4, a lazy chunk; since UX2b `group=ask&state=open`, an agent's question sits on its relation) as the tab's compact cards with „Im Tab zeigen“ and, since M6 S5c-1, each item's actions for reviewers; the collection's bar; a selected element an amendment can write (a process, a call, a message or signal endpoint, a start or end event; M6 S5c-2, one lazy module) shows „Ergänzen“ with the fields no open question of the element covers („Eintragen …“ or „Ändern …“ open the amend form) and its history (who, when, before → after, state, „Zurücknehmen“ after the cost); a selected collapsed subprocess (no fact in facts v1) offers „Verknüpfen mit …“: an accepted manual relation from its process to the picked process through `POST …/relations`, with „Rückgängig“. „Relationen“: two-line cards (type icon, the element, the status; the arrow with the other end's name and key; the confidence on a proposal only; „Aufruf, ausgehend: …“ as the accessible name), the selected one with „Zu … wechseln“ and „Prüfen“. `?relation=rel_…` highlights its endpoints (marker plus „Von“/„Nach“ label); `?element=` (a click on the canvas, a question's „Im Diagramm zeigen“) highlights one element and filters both tabs, its label in the panel header with „Alle zeigen“; elements with a finding keep the marker „Befund“ (the section „Befunde“ went, Q2); amended shapes get a small pen on their lower right corner; the legend „gewählter Endpunkt · hat Relationen · Klick auf ein Element filtert die Liste.“ until the first click on an element, then behind the info button next to the zoom controls |

**The project shell** (UX1, [UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §2.2, §3.1, owner decision
26; `src/routes/project.tsx`, `components/page-shell.tsx`): the crumb „analyzr › <Projekt>“ (a page
without a tab adds its own: „Hochladen“, „Agent verbinden“, „Annahmeregeln“, „Befunde“), the
project's name with its key small below (no „Stand s…“; the seq stays in the API; since UX8, when
every model declares the same source system, „· Aus Signavio · exportiert am 14.10.2026“ after it,
`commonSourceLine`), then four object
tabs „Übersicht“, „Relationen“, „Wertschöpfungskette“, „Offene Fragen“ in one row (a horizontally
scrolling row of 35 px on a phone), each badge its object's open work and never 0, all from
`src/lib/project-counts.ts` `useProjectCounts` (the same numbers feed „Als Nächstes“ and „Offene
Punkte“; the three badges never count one item: „Relationen“ `isReviewItem`, „Wertschöpfungskette“
`isOpenPlacement`, „Offene Fragen“ `totals.ask`, holds only there). Pinned right of the row,
outside its scrolling part: the button „Hochladen“ (editors and owners) and the owners' menu
„Einstellungen“ (a gear: „Agent verbinden“, „Annahmeregeln“). Menus and popovers in the entry chunk
(the gear, „Exportieren“, „Agent starten“) are `components/light-popover.tsx`: a trigger with
`aria-expanded`, an absolutely positioned panel, Escape and an outside click close it, a menu's
items take the arrow keys; Radix's dropdown with floating-ui stays in the lazy chunks. The server's
state shows only on trouble, as a banner with `role=alert` („Server nicht erreichbar“, „Datenbank
nicht erreichbar“); the version is in the logo's tooltip. **Failed writes in German**:
`errorMessage` gives one sentence per `ProblemCode` and, before it, per known `reason`
(`src/lib/problem-texts.ts`, e.g. 412 „Inzwischen hat sich etwas geändert. Lade neu und prüf den
neuen Stand.“), never the English title; `errorDetail` keeps title, status and the server's detail,
which danger toasts (`toast({ …, error })`) and alerts (`components/error-text.tsx` `ErrorText`) show
behind a closed „Technische Details“. **„Agent starten“** (`components/agent-start.tsx`, owners): one
popover with the copyable `/analyzr:relations <p>` (and `/analyzr:placements <p>` once a chain
exists), the commands wrapping instead of being cut off, the link to the Claude Desktop start
prompt and „Die Vorschläge erscheinen unter „Relationen“. Entscheiden kannst nur du.“ (with a chain
„… unter „Relationen“ und auf der „Wertschöpfungskette“.“); without an active agent token the entry
is „Agent verbinden“; „Nochmal versuchen“ (permission `write`) requeues and then opens the popover
for owners (a second click closes it instead of requeueing again), editors get a plain button and a
toast. The entry chunk is one chunk since UX1 (`vite.config.ts`: a `codeSplitting`
group with `tags: ['$initial']`): 209.8 KB gzip after the first wave (2026-10-18), from 211.0 KB in
seven chunks before UX1.

**Measured load** (the UI load guard, `e2e/ui-load.spec.ts` with `ANALYZR_UI_LOAD_REPORT`, after the
first wave, 2026-10-18, [UI simplification first wave](#ui-simplification-first-wave-2026-10-18)):
`nordwind-handel` seeded with its chain and worked by the simulation agent, nothing decided (the
walkthrough's state); `signavio-beispiel` from `analyzr import` of the Signavio fixture's bundle; an
empty project. Visible controls, words, `data-slot=badge` and the first item's top; before = the
web before UX1 ([UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §7 "UX1 as delivered", "UX2b as
delivered"). Later slices' rows as they measured them; the rows of `signavio-beispiel` and the
empty project as re-measured after M6 S2c-1 (2026-10-19, [M6 S2c-1](#m6-s2c-1-2026-10-19)):
`signavio-beispiel` is imported with a write token and names no engine, so since the trust rule
its call „Rechnung stellen“ is a proposal: the tab reads „Relationen 1 zu prüfen“ and „Als
Nächstes“ adds „Oder jetzt schon: Vorschläge prüfen (1) …“; the empty project's text now says
„… eindeutige Aufrufe aus Camunda-Modellen sofort und schlägt die übrigen …“ (37 / 36 words
before). The `signavio-beispiel` rows they replace were the first wave's numbers, already out of
date before S2c-1 („Übersicht“ 19 controls, 95 / 80 words, 6 badges; „Offene Fragen“ 248 words;
UX8's subtitle and chips had brought „Übersicht“ to 103 words, [UX8](#ux8-2026-10-18)). Measured on
the branch right before S2c-1 they were 19 controls, 103 / 88 words, 9 badges and 253 words, so
S2c-1 adds one control and 19 words to „Übersicht“ and one word to „Offene Fragen“, the badges
unchanged. Re-measured after M6 S2c-2 (2026-10-20, [M6 S2c-2](#m6-s2c-2-2026-10-20)):
`signavio-beispiel`'s only open review item is that call, so „Als Nächstes“ shows „1 eindeutigen
Aufruf zuerst bestätigen · Gesammelt annehmen“ instead of the review line (122 / 107 words before,
the controls, badges and primary unchanged), and the bulk dialog behind it is a new row (no
budget); every other row as in S2c-1's run, which already differed from three older cells below
(`nordwind-handel`'s „Offene Fragen“ 709 / 606 words, „Annahmeregeln“ 80 words and
„Wertschöpfungskette“ 25 controls in both runs). Re-measured after M6 S2c-3 (2026-10-20, [M6
S2c-3](#m6-s2c-3-2026-10-20)): every row as in S2c-2's run except „Annahmeregeln“, 13 controls and
82 words with one rule (80 before), the longer page lead; no measured project has a rule for
derived calls, so the rule dialog's default still shows its four criteria and the name.
Re-measured after M6 S2b's follow-up step 3 (2026-10-20, [M6 S2b follow-up
step 3](#m6-s2b-follow-up-step-3-2026-10-20)): UX7's „Vorschau“ gains the cost line („· 7 mögliche
Relationen zu beurteilen“, 133 words, 128 before), and the guard's new step „Vorschau (erneuter
Import)“ is a new row (no budget): `finanzen/rechnungsstellung` of the worked `nordwind-handel`
re-exported with other documentation, a dry run only (the cost line with „davon erneut“ in the
last of at most three lines, no warning, „Abbrechen“, the heads unchanged over REST); every
other row as in [step 2](#m6-s2b-follow-up-step-2-2026-10-20)'s run (the lead's run on the
final tree, „Projekte“ included); no budget constant changed. Re-measured after step 3b
(2026-10-20, [M6 S2b follow-up step 3b](#m6-s2b-follow-up-step-3b-2026-10-20), the implementer's
and the fixer's runs on `analyzr-s2bf3bi`): `signavio-beispiel`'s models wait for the agent, so
its „Übersicht“ gains „etwa N mögliche Relationen“ beside „Agent verbinden“ (117 / 102 words,
113 / 98 before; the controls and badges unchanged), and UX1's budget for „Als Nächstes“ is now
checked there too, with the suffix: 22 words and 4 controls (≤ 40, ≤ 5); `nordwind-handel`'s
agent run is done, so nothing waits and its rows are unchanged; every other row as in step 3's
run; no budget constant changed.

| Screen | 1440x900 | 390x844 | Before (1440x900) | Budget |
|---|---|---|---|---|
| Tab bar | 4 tabs, 3 badges, 1 row | 1 scrolling row ≤ 48 px, „Hochladen“ in view | 9 tabs, 6 counts, 2 rows (4 rows at 390) | one row; ≤ 48 px at 390 |
| „Übersicht“, `nordwind-handel` | 44 controls, 379 words, 31 badges, primary at 224 px | 44, 314, 31, 224 px | 43, 400, 62, no primary | „Als Nächstes“ ≤ 40 words, ≤ 5 controls; primary ≤ 260 / ≤ 300 px |
| „Übersicht“, `signavio-beispiel` | 20, 117, 9, 224 px (113 words before M6 S2b's follow-up step 3b); „Als Nächstes“ 22 words, 4 controls | 20, 102, 9, 224 px | 18, 122 | „Als Nächstes“ ≤ 40 words, ≤ 5 controls (since step 3b) |
| „Gesammelt annehmen“ (the bulk dialog from `?bulk=calls`), `signavio-beispiel` (M6 S2c-2) | 22 controls, 112 words, 0 badges, first row at 449 px | – | – | – |
| „Übersicht“, empty project | 9, 42, 0 | 9, 41, 0 | 13, 56, 5 zero counts | – |
| „Offene Fragen“, `nordwind-handel` | 76, 710, 21, first card at 246 px (643 words before the walkthrough's button) | 74, 607, 21, 362 px | 231, 3,119, 50, 575 px (1,260 at 390) | ≤ 80 controls, ≤ 1,000 words, ≤ 250 / ≤ 450 px |
| „Offene Fragen“, `signavio-beispiel` | 34, 254, 7, 246 px | – | 45, 881, 503 px | – |
| „Hochladen“ before an import (UX7) | 13 controls, 49 words; the dropzone 38 words | – | 71 words | the dropzone ≤ 45 words |
| „Vorschau“, the first import of the raw Signavio export (UX7, M6 S2b) | 20 controls, 133 words, 6 badges (128 words before S2b's follow-up step 3) | – | – | – |
| „Vorschau (erneuter Import)“, `nordwind-handel` (M6 S2b follow-up step 3) | 16 controls, 95 words, 1 badge | 16, 93, 1, no horizontal scroll | – | – |
| „Agent verbinden“, empty project (UX7) | 23 controls (the closed „Erweitert“ counted), 172 words; the token form 2 visible controls | – | the form 6 controls | the form: name and button |
| „Relationen › Zu prüfen“ (UX5) | 48 rows: 10 controls besides them, 1 per row, 496 words (about 446 at the audit's 42 rows), first row at 297 px, no name cut | 390 px wide (the rows as cards) | 64, 828, 48, first row at 440 px (429 px wide at 390) | first row ≤ 360 px; ≤ 12 controls besides the rows, 1 per row; 450 words at 42 rows; 390 px at 390 |
| „Wertschöpfungskette“ (UX6) | 24, 195, „Platzierungen prüfen (29)“ at 63 px; the panel 20 controls, 75 words; the header 4 controls besides the chip; the card 6; „nichts angenommen“ on 4 steps; the selected step's stroke 4 px | the sheet collapsed to „29 offen“, the project link on top (`elementFromPoint`), the canvas above the sheet over more than 55 % of the screen, 390 px wide | 60, 482, first open placement at 1,153 px; the panel 84, 319 (the audit); the header 8; the card 8; 12 labels | the panel ≤ 40 controls, ≤ 150 words, the primary in view; header 4; card 6; 4 labels |
| „Relationen › Alle“ (UX9) | 56 controls (≤ 60), 1 per row, 40 rows a page, no ids or ref tooltips | – | 194 controls (the audit, 58 rows, 3 per row) | ≤ 60 controls |
| „Annahmeregeln“ (UX9) | a rule row 3 controls („Aktiv“, „Bearbeiten“, „Mehr“), the dialog four criteria and the prefilled name (a rule for derived calls: „Art“, „Herkunft“, „Konverter“ for „Konvertiert“, and the name); the page 13 controls, 82 words with one rule since M6 S2c-3 (78 at UX9, 80 in S2c-1's and S2c-2's runs) | – | a row 6, the dialog 10 | row 3; dialog 4 + name |
| Projects list (UX9) | 24 controls, 179 words; „Offen für dich“ equals the sum of the project's three badges | „Zuletzt geändert“ as a line under the key | „Angelegt“, no open work | – |
| Model view `vertrieb/order-handling` (UX3) | 18, 196, 3 badges; the panel 10 controls, 75 words, the first question ends inside it | `finanzen/gutschrift`: the name in the top bar, the sheet collapsed, the canvas 86 % of the screen | 35, 555; the panel 37, 515, the first question 1,275 px down | the panel ≤ 25 controls, ≤ 300 words, the first question without scrolling; ≤ 3 chips and „Mehr“; ≥ 55 % canvas at 390 |
| Review screen, an agent proposal (UX5) | the panel 93 words with „Verlauf“ closed | the sheet collapsed to „Von → Nach · Konfidenz“, the way back and ‹ › on top | 201 words | ≤ 110 words; the way back and ‹ › answer `elementFromPoint` at 390 |
| Entry chunk (gzip) | 228.1 KB in 1 chunk (218.1 before UX3, 219.8 after it, 220.7 after UX4, 221.3 after UX5 step 1, 221.9 after step 2, 222.1 after UX6, 223.4 after UX9, 224.1 after M6 S2c-1, 225.1 after S2c-2, 226.0 after S2c-3, 226.1 after S2c-4, 226.3 after S2b's follow-up step 1, 226.6 after step 2, 227.6 after step 3, 227.9 after step 3b and step 4) | | 211.0 KB in 7 | < 240 KB, each slice ≤ +3 KB |

How it talks to the server: only through `@analyzr/client` (generated from the contracts) with
`baseUrl` = the page's origin. `src/lib/api.ts` wraps `fetch`: on a 401 it calls
`POST /api/v1/session` once (parallel 401s share it) and repeats the request, so the UI never
holds a token and survives server restarts. `unwrap()` turns problem+json into `ApiError`.
`src/` imports only *types* from `@analyzr/contracts` (ESLint enforces it; the zod schemas would
land in the bundle) and mirrors the few constants it needs in `src/lib/limits.ts`, which
`test/limits.test.ts` compares with the contracts (since M6 S5c-2 also the amendment limits
mirrored in `src/lib/amendments.ts`). The runtime imports are zod-free subpaths:
`@analyzr/contracts/paths` (M6 S1: the BPMN file rule and the model key of a path, in
`src/lib/upload.ts`), `@analyzr/contracts/open-question-labels` (M6 S4: the German labels of
the open questions' kinds and sources, in `src/lib/open-questions.ts`), `…/open-question-csv`
and `…/personal-data` (M6 S5a: the answer sheet's reader and the personal-data check) and
`…/amendment-labels` (M6 S5c-2: the German labels of the amendments' fields, states, element
types and refusals, in `src/lib/amendments.ts`), `…/impact-merge` (M6 S2b follow-up: the
„Vorschau“'s merge of its batches, `mergeImpacts`, the one the CLI uses, in `src/lib/upload.ts`)
and `…/import-manifest` (UX8: a dropped bundle's
manifest checked with the contracts' schema, with zod, a dynamic import of its own in
`src/lib/upload-manifest.ts`), all but `paths` and `impact-merge` in lazy chunks only; ESLint
allows those subpaths and restricts every other, and the bundle guard pins them as the only
contracts modules in the bundle, `paths.ts` and `impact-merge.ts` alone in the entry. The **engine** is `Model.engine` and the
**provenance** is `Relation.provenance` (M2 API): the rule tier shows `analyzr-rules/1.0.0` and what
matched, agent proposals the principal handle plus the declared procedure (`id@version`) and LLM
model, human decisions the handle and the verdict; only a relation without provenance falls back
to what tier and attributes say. Element labels come from the facts of every head revision
(`GET …/revisions/{r}/facts`, cached per revision).

**Roles and the read-only demo** (owner decision 20): `src/lib/permissions.ts` (`useProjectPermissions`)
derives what the caller may do from `Project.role`: editors and owners write and review, owners
manage agent tokens and rules, viewers only read; every permission is false until the role is
loaded, so a write action never flashes up. `src/lib/server-mode.ts` reads `Health.demo`: on the
read-only demo every permission is false as well (its session is a viewer anyway), the banner
(`components/demo-banner.tsx`) marks the document (`<html data-analyzr-demo>`, the full-height
layouts subtract `--analyzr-banner-h`), and the projects page hides „Neues Projekt“ and the seed
hint (shown once `/health` has answered). Write entries are hidden (the button „Hochladen“
for editors and owners, the menu „Einstellungen“ with „Agent verbinden“ and „Annahmeregeln“ for
owners only; „Als Nächstes“ shows viewers its text without buttons); their URLs render
`components/read-only-notice.tsx` without a request. Empty states follow the same gates: an
empty project offers „Modelle hochladen“ to editors and owners and „Agent verbinden“ to owners,
a viewer reads „Dieses Projekt hat noch keine Modelle.“; the inbox asks only owners to start
an agent, and its placements callout says „deine Prüfung“ only to reviewers. `errorMessage`
turns a 403 `demo-readonly` into „Das ist eine Demo: Hier kannst du nichts ändern.“ (one of the
German problem texts since UX1). Local mode
is unchanged: its single user owns every project.

#### Auto-accept rules in the web UI (owner decision 19)

`src/routes/project-rules.tsx` (the route; the page `project-rules-page.tsx` is a lazy chunk),
`src/components/rules/*`, `src/lib/auto-accept.ts` (the ledger join, the `auto` filter, the texts
of marks and revocations; in the entry chunk), `src/lib/auto-accept-rules.ts` (labels of kinds,
tiers and block reasons, percent input, drafts; rules page only), `src/lib/auto-accept-actions.ts`
(`useIsOwner`, `useAutoAcceptIndex`, revocations), `src/lib/auto-accept-rule-actions.ts` and
`src/lib/auto-accept-queries.ts` (rule writes, preview, dry runs). The page (in the menu
„Einstellungen“ since UX1), apply and every revoke need `project.role === 'owner'`; the ledger query and the marks are every reviewer's
(`useCanReview`: owner or editor), so a machine acceptance never passes for a human one; for
viewers every view looks as before. Editors filter by the rules the ledger names (`ledgerRules`),
owners by all their relation rules. German texts call the role „Inhaber“, as the project list
does.

- **„Annahmeregeln“** (the tab „Regeln“ until UX1; since then in the owners' menu
  „Einstellungen“ on every project page; rows and texts since UX9, [UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md)
  §3.11). The safeguard once at the top, since M6 S2c-3 „analyzr nimmt neue Vorschläge, die eine
  aktive Regel trifft, selbst an – nie bei einer offenen Frage, einem Einwand oder wenn du schon
  entschieden hast.“ (before: „analyzr nimmt neue Agentenvorschläge ab deiner Konfidenz selbst an –
  …“, wrong once a rule accepts the rule tier's call proposals);
  the system rule in one line („Eindeutige Aufrufe aus Camunda-Modellen nimmt analyzr beim
  Hochladen an · immer aktiv · N angenommen“, decision 9 as amended by 24.2, the count links to the
  rule-accepted relations; since M6 S2c-1 „ · M aus abgeleiteten Modellen vorgeschlagen“ while such
  proposals are open, since S2c-2 a link to the bulk accept with exactly those selected,
  `?bulk=calls`, and counting only the calls it takes as they stand; since S2c-4 „ · N vor der
  Vertrauensregel angenommen – prüfen…“ while `system.preTrust` > 0, a button that opens the dialog
  below, never in the demo: the page passes `onPreTrust` only outside it); the rules table: name
  and note, criteria („Relationen · Gleicher Name · ab 95 %“ with the narrowing; under the name
  below 768 px; a rule for derived calls „Eindeutige Aufrufe aus abgeleiteten Modellen · Export
  ohne Camunda-Engine“, „… · Konvertiert mit normalize-bpmn@0.1.0“ or „… · Ohne Angabe“, no
  narrowing, `criteriaLabel`; „Verlauf“ the same), „Bisher“ with the non-zero counts („N in Kraft“ for relation rules a link to exactly
  those relations, `?auto=aar_…`; a line under the name on a phone), and three controls: the
  „Aktiv“ switch (a new revision with `If-Match`; on 412 „Neuere Revision laden“), „Bearbeiten“ and
  „Mehr“ („Verlauf“ with revision, author and time; „Widerrufen…“ while acceptances are in force).
  Turning a rule on asks first when its dry run finds open proposals („Nur aktivieren“ or
  „Aktivieren und Liste ansehen…“) or when the caller would become its deciding person (another
  author, or one who lost the owner role: such a rule's switch stands off, since it accepts
  nothing; „Du wirst damit die entscheidende Person dieser Regel“; with `/me` unknown it asks
  hedged); turning it off asks nothing. The toast after turning it on says „Sie wirkt auf neue
  Agentenvorschläge.“, for a rule for derived calls „Sie wirkt auf neue Aufrufvorschläge aus
  abgeleiteten Modellen.“ (`actsOnText`). An active rule whose dry run finds open proposals shows
  „N offene Vorschläge passen – ansehen …“ (cached 30 s, no refetch on focus), which opens apply.
  The page's „Mehr“ holds „Nach Agent widerrufen…“ (the agents with acceptances in force, from the
  ledger, revoked tokens included, never the rule tier for derived calls' acceptances,
  `inForceAgents`; the revoke dialog with `agentPrincipalId`) while acceptances exist. Dialogs opened from the menus give the focus back to the row's or the page's „Mehr“. Empty
  state „Noch keine Regeln. Ohne Regeln entscheidest du jeden Vorschlag selbst.“ with „Erste Regel
  anlegen“ only.
- **Create/edit dialog** (`rule-dialog.tsx`): Name (prefilled from the criteria, „Gleicher Name ab
  95 %“, a suffix when taken, the user's once edited), Art (fixed when editing), Grundlage (per
  kind), „ab Konfidenz (%)“ (at least 50, German decimals, up to four: the field shows a rule's
  threshold with every decimal it has and saves it unchanged unless the text is edited, so an edit
  of the note never moves a CLI-set 0.9004 to 0.9; tables and history show thresholds the same way,
  with `formatThreshold`) and Typ (relations) visible; behind „Weiter einschränken“ (open when one
  is set) Agent (the project's tokens, revoked ones marked, plus agents seen in proposals; handles
  without „agent:“), LLM-Modell (suggestions from the preview, free text), „Auch
  Ad-hoc-Vorschläge“ and Notiz; for placements the hint that `@outside`, a process with a home step
  or with several proposed steps are never accepted. Beside it the live preview (debounced 300 ms):
  „Bisher: X von Y entschiedenen Agentenvorschlägen hätte die Regel angenommen – davon A
  angenommen, R abgelehnt, K korrigiert (Trefferquote …)“, „Automatisch angenommen, nicht
  geprüft“, „Jetzt offen: N würden angenommen“ with the blocked reasons in German and, since UX9,
  „davon N mit allgemeinem oder mehrfach genutztem Namen (in der Sammelannahme markiert)“
  (decision 26 (7): shown, never blocking; the same name flags as the bulk accept), and the curve
  under „Nach Konfidenz aufschlüsseln“ with the rows whose numbers change (the rule's row marked).
  The third „Art“ (M6 S2c-3), „Eindeutige Aufrufe aus abgeleiteten Modellen“ (`RULE_ARTS`, `artOf`;
  fixed when editing, since whose proposals a rule accepts never changes): instead of Grundlage,
  Konfidenz and Typ the field „Herkunft“ („Export ohne Camunda-Engine“, „Konvertiert“, „Ohne
  Angabe“, each with „(N offen)“ from the preview's `derivedGroups`) and, for „Konvertiert“,
  „Konverter“ (the project's converters, the most open calls first, then by name, „x (N offen)“;
  „Lädt …“ until the preview answers, „Konverter wählen …“ while none is chosen, „Kein Konverter im
  Projekt“ when there is none; saving without one says „Wähle einen Konverter.“, or in a project
  without converted calls „Noch kein Aufruf im Projekt stammt aus einem Konverter; wähle eine andere
  Herkunft.“); one hint line „Die Herkunft gibt der Import an; analyzr prüft sie nicht. Über ein
  Agenten-Token hochgeladene Modelle nimmt keine Regel an.“; „Weiter einschränken“ holds only
  „Notiz“; the suggested name „Aufrufe: Export ohne Engine“, „Aufrufe: konvertiert mit <converter>“
  or „Aufrufe: ohne Angabe“, cut with „…“ to 100 characters, the suffix included (`fitRuleName`). Its
  preview speaks of calls („Bisher: X von Y entschiedenen Aufrufen aus abgeleiteten Modellen hätte
  die Regel angenommen – …“, „Jetzt offen: N Aufrufe …“), without the curve and the name flags (no
  name flag applies to such a call); while „Konvertiert“ has no converter yet, it loads the sources
  only. One „Speichern“ with an „Aktiv“ switch (off for a new rule); saving another principal's rule
  active says that the caller becomes its deciding person. On 412 „Neuere Revision laden“ puts the
  head into the form and lists what the other owner changed („ab Konfidenz: 90 % → 97 %“, „Agent:
  alle Agenten → …“, „Status: aktiv → aus“); the user's own edits are dropped, so nothing is saved
  over a revision nobody looked at. 422 reasons in German. After saving an active rule with open
  matches: „N offene Vorschläge erfüllen die Regel bereits – jetzt anwenden?“ → the apply dialog.
  The bulk accept's offer opens the dialog prefilled (`?new=key`, UX5; after accepting only
  derived calls `?new=calls&derivedKind=…&converter=…`, M6 S2c-3, read by `parseRulesSearch`, the
  URL cleaned).
- **Apply and revoke dialogs** run the dry run when they open (a query that is never cached; the
  apply dialog shows only its own fresh result), list the dry run's items with element names and
  „100 %“ (the whole list scrolls, „davon mindestens N“ where the server cut it; the proposer is the
  agent, or since M6 S2c-3 „Aufrufvorschlag aus einem abgeleiteten Modell“, `proposerName`), say how many carry a bulk-accept flag, and confirm with the dry run's
  count (`expectedCount`, plus the head revision for apply); on 409 they show „Die … haben sich
  geändert“ and the fresh dry run. Apply is disabled, with the reason, while the dry run says the
  head is off or its author no longer an owner. The revoke dialog says how many go back to review,
  become obsolete (judged again), were decided by a human since (unchanged) or were revoked
  before, and takes an optional reason; since M6 S2c-3 its texts say „Vorschlag“, not
  „Agentenvorschlag“ („Ist noch ein Vorschlag offen, steht das Element wieder in der Prüfung; sonst
  wird es veraltet und die Agenten beurteilen es neu.“, the summary „… zurück in die Prüfung (ein
  Vorschlag ist noch offen)“).
- **„Vor der Vertrauensregel angenommen“** (M6 S2c-4; `components/rules/pre-trust-dialog.tsx`, its
  texts in `src/lib/pre-trust.ts`, both in the rules page's lazy chunk), in the revoke dialog's
  pattern. The description „In diesen Modellen hat analyzr eindeutige Aufrufe angenommen, bevor es
  die Vertrauensregel gab. Heute würde es sie nur vorschlagen, weil das aufrufende Modell als
  abgeleitet gilt.“; per model a checkbox (every model ticked), its name and „2 Aufrufe · ohne
  Camunda-Engine“ (count and reasons, `preTrustModelDetail`); the dry run of „Zurück in die
  Prüfung“ in one line that follows the selection („3 Aufrufe gehen zurück in die Prüfung.“, with
  an owner's rule for derived calls „ Deine Regel „…“ nimmt 2 davon gleich wieder an.“ or „… sie
  alle …“, counted by `ofProposed`; „Wähle mindestens ein Modell.“ with none ticked); under it the
  note „„Behalten“ lässt sie angenommen; danach fragt analyzr bei diesen Modellen nicht mehr.“;
  then „Behalten“ (outline) and „Zurück in die Prüfung“ (primary, disabled until the dry run
  answered; no „Abbrechen“, the dialog's X closes it). Both send the selected revisions with the
  list's count as `expectedCount`. A 409 of the dry run or the review reloads the list with „Die
  Liste hat sich geändert“ („Es wurde nichts geändert. …“); another failure of the review shows
  „Das hat nicht geklappt“ and keeps the dialog and the selection; another failure of the dry run
  shows the error in place of the dry-run line and keeps „Zurück in die Prüfung“ disabled; a list
  that fails to load shows „Liste konnte nicht geladen werden“; an empty list says „Nichts mehr zu
  prüfen.“. The toast: „N Aufrufe zurück in der Prüfung“ with „Sie stehen in der Prüfung; nimm
  sie dort gesammelt an.“ and the action „Gesammelt annehmen“ (`/projects/<p>/review?bulk=calls`)
  while calls are left; „Deine Regel hat sie gleich wieder angenommen.“ (or „Deine Regel hat 2
  davon gleich wieder angenommen; die übrigen nimmst du gesammelt an.“; „Deine Regeln haben …“ for
  several) when rules took them; „N Aufrufe behalten“ with „Sie bleiben angenommen; analyzr fragt
  nicht mehr danach.“ after „Behalten“; „N Aufrufe geprüft“ with „An ihrem Status ändert sich
  nichts.“ when a review `derived` turned none of them into a proposal (practically unreachable,
  since the list holds only calls the review turns into proposals). Closing returns the focus to the
  card's line, else to „Neue Regel“ or „Erste Regel anlegen“.
- **Marks.** The ledger (`GET …/auto-accepted`) is indexed by subject and assertion id: the badge
  „Automatisch angenommen – Regel „…““ in the relation table, the preset „Automatisch angenommen“
  (beside „Durch Systemregel angenommen“, decision 9) and the select „Annahmeregel“ (`?auto=any` or
  `?auto=aar_…` in the URL; the table's link of a relation rule opens it); on the review screen the
  box „Entschieden durch Regel „…“ (Revision n), aktiviert von <owner>; ausgelöst von <agent> mit
  0,93“ (since M6 S2c-3 for a rule for derived calls „…; ausgelöst vom Aufrufvorschlag aus einem
  abgeleiteten Modell (90 %)“, the badge's tooltip „… mit 90 %“; after a revocation without a live
  proposal „kein Vorschlag war mehr offen: …“) with the single-item revoke for owners („Automatische Annahme widerrufen“) and what became
  of earlier acceptances (after a revocation by the item's status: back in review, or obsolete and
  judged again by the agents); in the history „Automatisch
  angenommen“ and „Automatische Annahme widerrufen“ with the rule and revision; „widerrufen“ in
  the queue rows of revoked items; on the chain page the badge on the placement card, the same
  provenance box under „Herkunft“, the panel filter „Nur automatisch angenommene“, and the badge in
  the step view.
- **Agents page.** Revoking a token offers „N automatisch angenommene Vorschläge stammen von
  diesem Agenten – nach dem Widerrufen des Tokens auch diese widerrufen?“ and says that, with the
  token's proposals withdrawn, they become obsolete and are judged again unless another agent's
  proposal is open; checked, it runs the revocation with `agentPrincipalId` after the DELETE (dry
  run, then its count, reason „Token „…“ widerrufen“). If that fails, the toast points to
  „Annahmen eines Agenten widerrufen“ under „Einstellungen › Annahmeregeln“.
- The entry chunk grew from 192.9 to 197.6 KB gzip (ceiling 200 KB): the rules page, its dialogs
  and helpers load with the route; only the marks, the revoke dialog and the ledger join are in the
  entry. Screenshots: `docs/screenshots/d19-*.png` (Playwright with `ANALYZR_SCREENSHOTS_DIR`).

#### Review in the web UI (M2)

M2-PIPELINE-REVIEW item 7 on the REST routes of [Analysis pipeline and review](#analysis-pipeline-and-review-m2);
`src/lib/review.ts` (queue, held list, stage counts, evidence, conflicts, all pure),
`src/lib/review-actions.ts` (mutations), `src/components/review/*`, `src/routes/project-review.tsx`
and `src/routes/review.tsx`.

- **Inbox** (`/projects/{key}/review`, the tab „Relationen“ since UX1, its view „Zu prüfen“ since
  UX5). The models per pipeline stage ("Phase" in the UI; the tier is the „Grundlage“ since UX5)
  are the phase chips of „Übersicht“ since UX1
  (in pipeline order: Wartet auf Agent → Agent arbeitet → Agent gescheitert → Wartet auf Prüfung →
  Klärung offen → Eingearbeitet, only stages with models); a chip filters the models table, and
  with proposals open „n Vorschläge dieser Modelle prüfen“ opens the queue with `?stage=`, shown
  there as the removable chip „Phase: …“. A reservation that expired while nobody claimed since
  still says "Agent arbeitet" and is marked „Reservierung abgelaufen am …“ with „Nochmal
  versuchen“ in the model's phase cell, like a failed analysis („Nach 3 Versuchen gescheitert“);
  a model waiting for clarification counts its held relations in its „Offene Punkte“ (text since
  the first wave's review; the „Vorgemerkt“ view lists them). The queue holds the open proposals and
  the accepted relations whose endpoint changed or is missing ("Angenommen, Endpunkt geändert";
  the same `review_items` that keep a model in "Wartet auf Prüfung", and the badge of
  „Relationen“), highest confidence first, then those whose decision finishes a model (its last
  open item, "schließt 1 Modell ab"); an agent's question shows as "Frage", an agent's no-link on
  the pair as "Einwand" (tooltip "Kein Zusammenhang laut Agent", with the count when there are
  several). Since UX5 a row's one link (the pair, the processes first) and a click on the row
  open the review screen with the same filters, as does „Vorschläge prüfen (n)“ at the first
  item; the views „Gilt“, „Abgelehnt“, „Automatisch angenommen“ and „Alle“ show the results.
- **Review screen** (`/projects/{key}/review/{relation}`, full viewport like the model view; since
  UX5, [UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §3.7, the canvas pages' shared panel): both
  endpoint models in bpmn-js from 1024 px (side by side from 1280, stacked from 1024 to 1279; on a
  phone, and with the toggle, one at a time: "Von" / "Nach"; one canvas when both ends lie in one
  file), endpoints marked and labelled "Von"/"Nach", each pane's chip with „Von“ or „Nach“, the
  process name and „Im Modell“, the model key, engine and stage behind its info button; a pane
  whose model was deleted says so ("Modell „…“ gibt es nicht mehr") instead of loading. Below
  1024 px the panel „Prüfung“ is a sheet collapsed to its handle („Bestellanforderung →
  Lieferantenanlage · 100 %“), the header a top bar above it (back, „1 von 48“, ‹ ›, „Von“ /
  „Nach“), the canvas ending above the sheet; a decision's form (R, H, C) expands it. The way back
  says „Zu prüfen“, „Vorgemerkt“ or, opened from „Offene Fragen“ (`?from=open-questions`, a hold's
  „Jetzt entscheiden“ in the tab), „Offene Fragen“, where the end of the list leads too. The panel
  shows type, status („Automatisch angenommen“ for an item a rule accepted, owner decision 26 (5);
  a revoked one says „Automatische Annahme widerrufen“), endpoint state, confidence, both
  endpoints, the agent's question, the callout "Kein Zusammenhang laut Agent" with every current
  agent no-link on the pair (`Relation.noLinks`: handle, time, "Analyse von {origin}", the reason as
  plain text, "Ohne Begründung." for an empty one), a held relation's box (note, question, label,
  the latest answer, read-only), rationale and evidence by element name (of the proposal the
  status rests on, else the latest; since M6 S2c-1 never a trust-rule proposal once the rule tier
  accepted the call, `currentProposal`; refs into the two
  endpoint models are buttons that centre and mark the element as "Beleg", switching to its pane
  when only the other one is shown; refs into other project models link to the model view at that
  element; anything else stays text; a cited element belongs to its relation, so another relation,
  reached by link or history, starts without it), and one closed **„Verlauf (n)“** (`GET
  …/assertions`, oldest first: „Gleicher Name erkannt (analyzr)“ (since M6 S2c-1 the trust rule's
  proposal of a unique call „Eindeutiger Aufruf erkannt (analyzr)“ without the tier badge, told by
  `isTrustRuleProposal`), „Vom Agenten vorgeschlagen“,
  withdrawals, decisions, notes with their texts and the tier, links between a correction and the
  corrected proposal; an entry shown above keeps only its title, who and when; an auto-acceptance
  with its rule, revision, agent and „Automatische Annahme widerrufen“ for owners; the relation id
  and version, client, declared procedure and LLM model behind „Technische Angaben“).
- **Decisions** at the panel's foot: **Annehmen** (A; "Erneut annehmen" for an accepted relation
  whose endpoint changed, which anchors the decision on the current endpoints; a missing endpoint
  can only be rejected or corrected), **Ablehnen** (R, reason required; agents see it),
  **Vormerken** (H, note required, question and label behind „Frage oder Label ergänzen“ since
  UX5; on a held relation „Antwort geben“ or „Antwort ergänzen“ takes its place, the note dialog of
  „Offene Fragen“), **Korrigieren** (C: choose
  which end is wrong, pick an element from the compatible endpoints of the landscape, say why;
  sent as `verdict: correct`, so the server accepts a `manual` relation and rejects the proposal;
  the candidates are one radio group, a single tab stop with the arrow keys moving the choice).
  The correction candidates mirror `endpointRole` of `@analyzr/relations` (`src/lib/endpoints.ts`,
  same role as the replaced end, any endpoint for a `manual` relation, never in the process of the
  end that stays), ranked by shared words with either end. J/→ and K/← walk the queue (opened
  from the held list, `?view=held`, they walk the held list, and "Vorgemerkt" leads back to it);
  after a decision the screen moves on to the next item (back to the list at its end). Shortcuts
  never fire while typing, with a modifier, or while a dialog is open; Cmd/Ctrl+Enter submits a
  form (reject, hold, correction, the answer in the held list), Escape cancels it, and a
  cancelled correction starts afresh.
- **Versions.** Every decision sends the `version` the reviewer saw. A 409 (another decision, a
  new proposal or no-link, a re-upload meanwhile) shows "Die Relation wurde inzwischen geändert"
  with both versions, saves nothing and reloads the new state; the shortcuts pause until "Neuen
  Stand prüfen".
- **Bulk accept of „Gleicher Name“** (since UX5 the key tier only, owner decision 26 (6); before,
  one button per tier, „Schlüssel: 33 annehmen…“): the outline button „11 unauffällige annehmen …“
  names the unflagged pairs, shown once every model's facts loaded, and the dialog selects exactly
  those; the flagged ones sit in the closed „Genauer ansehen (n)“, each with one flag line
  („Allgemeiner Name · in 4 Prozessen“, `flagLine`) and „Vorschlag öffnen“, without a checkbox:
  they stay in the queue and are decided one by one. After the accept an owner's toast asks
  „Gleicher Name ab 100 % künftig automatisch annehmen?“ with „Annahmeregel anlegen“ (the rules
  page at `?new=key`, the new rule prefilled). The flags (`src/lib/generic-names.ts`):
  a message or signal name or end label made of generic words only ("Antwort", "Antwort erhalten",
  "Daten aktualisiert"; DE/EN list, camelCase split, umlauts folded), a name more than two
  processes use (with how many send and receive), a proposal whose agent asks the reviewer a
  question ("Der Agent fragt nach: …", the review screen shows it in full), a pair an agent judged
  unrelated (`agent-no-link`, one flag per current no-link: "{handle} sieht keinen Zusammenhang:
  „…“"; questions and reasons are cut to 160 characters) and a call whose process id several
  models define (`duplicate-process-id`: accepting every target is rarely right). The request
  carries ids, versions, the tier and `expectedCount`; a 409 keeps the dialog open
  with "Die Liste hat sich geändert … Es wurde nichts entschieden". Accepted relations whose
  endpoint changed are never in a bulk list; they are confirmed one by one. Since M6 S2c-2 the
  unique calls of derived models (the trust rule's proposals) come first under „Eindeutige
  Aufrufe aus abgeleiteten Modellen (n)“, then „Gleicher Name (n)“, and `?bulk=calls` opens the
  dialog with exactly those calls selected ([The trust rule](#the-trust-rule-m6-s2c-1)); a flagged
  derived call stays in its group, flagged and without a checkbox, instead of under „Genauer
  ansehen“, „Gleicher Name (n)“ is headed only next to that group, and after accepting only
  derived calls the toast says „Eindeutige Aufrufe aus abgeleiteten Modellen.“; since M6 S2c-3 it
  asks owners „Eindeutige Aufrufe aus abgeleiteten Modellen künftig automatisch annehmen?“ with
  „Annahmeregel anlegen“ instead, unless no source can be named or a rule already names it ([The
  trust rule](#the-trust-rule-m6-s2c-1)).
- **Held list** (`?view=held`): per held relation the hold note, question and label, the answers so
  far (notes after the hold) and „Antwort geben“ (since UX2b the note dialog of „Offene Fragen“ for
  the hold's question, `POST …/open-questions/{q}/answers`, which records a note on the relation;
  before, an answer field with `POST …/notes`), plus „Jetzt entscheiden“ (UX5; "Prüfen" before)
  to decide once the answer is known; one sentence above the list says what an answer is.
  The review screen shows a held relation's question, note and label in its box „Offene Frage
  (vorgemerkt)“ with the same „Antwort geben“ (UX2b).
- **Plain text.** Rationales, questions, notes, labels and evidence render through `PlainText`
  (React text, `white-space: pre-wrap`): no HTML, no Markdown; the review flow checks that an
  `<img onerror>` rationale stays text under the CSP. (Task errors are no longer shown in the web
  since UX1 removed the stage table; `analyzr status` and the task API keep them.)

#### Value chain in the web UI (M4)

M4 S3 ([M4-VALUE-CHAIN.md](M4-VALUE-CHAIN.md) §4, §5, §9 "S3 as delivered") on the REST routes of
[Value chain and placements](#value-chain-and-placements-m4): `src/routes/value-chain.tsx` and
`value-chain-step.tsx` (the route definitions), `src/routes/value-chain-page.tsx` (the page) and
`value-chain-step-page.tsx` (the step view), both loaded with their routes
(`lazyRouteComponent`), `src/components/value-chain/*` (panel, cards, dialogs), the lazy chunk
`src/components/value-chain/canvas/*`, and in `src/lib/`
`value-chain.ts` (pure: badges, open items, the J/K queue, step tree, drill-down targets,
evidence, impact and the confirmation rule, violation texts, links, kinds, the pre-check),
`value-chain-save.ts` (the save state machine), `value-chain-actions.ts` (decisions, bulk,
manual placements, notes), `drafts.ts`, `ulid.ts`, `zod-csp.ts`, `download.ts`.

- **Import and the agent** (M4 S5, [placements](#the-placement-pipeline-and-analyzr-placements-m4-s5)):
  „Importieren“ (edit mode and the empty state, reviewers only; `src/lib/value-chain-import.ts`,
  `canvas/check-document.ts`) replaces the drawing with a `.vc.json` after the size, JSON and
  schema checks and a confirmation when the drawing has content or unsaved edits; the canvas
  re-lays every connection (`ChainCanvasDocument.relayout`) and the drawing stays unsaved until
  „Speichern“. The panel without a selection shows the placement agent's stage when it asks for
  something („Agent arbeitet“, „Agent gescheitert · Nochmal versuchen“, „Wartet auf den Agenten ·
  Agent starten“, „3 Prozesse fällig · Agent starten“) and the agent's doubts at the top of „Ohne
  Schritt“ („Agent unsicher: …“, `unplaced-list.tsx`) with „Platzieren“ (UX6).
- **Modes.** View mode is the renderer's `NavigatedViewer` (pan, zoom, select; double-click on a
  linked step opens its model, on any other selects and zooms in place: `focusElement`), edit mode
  ("Bearbeiten", editors only, from 1024 px) its `Modeler` with palette, context pad, direct editing
  and undo/redo, the fit leaving the palette's column free; "Fertig" leaves edit mode (asking before
  unsaved changes are discarded). Viewers get the page read-only. The canvas stays light and sits
  on the dotted paper like the model view; the palette and context-pad tooltips are the renderer's
  (English).
- **Layout** (UX6 step 2, the canvas pages' `CanvasPanel` and `useCanvasSheet`): from 1024 px the
  panel is an aside of 440 px that „Details ausblenden“ in the zoom group hides (the canvas takes
  its room, „Details zeigen“ brings it back); below 1024 px the header is a top bar („‹ <Projekt>“,
  the name, „Exportieren“; view-first, no editing) and the panel a sheet collapsed to „29 offen“ (a
  selected step's name), which a decision's form expands; J/K/A work while it is collapsed. The
  canvas container ends above the sheet and beside the aside; a `ResizeObserver` tells diagram-js
  when it changes size.
- **The chunk.** Only `src/components/value-chain/canvas/` imports the renderer, schema-model,
  diagram-js or zod values (ESLint; the bundle guard checks the build): it is loaded with the page,
  whose own route chunk holds the panels, dialogs and save logic, so the entry chunk every page
  loads carries neither (the bundle guard checks both and keeps the entry under a gzip ceiling,
  240 KB since the owner raised it on 2026-10-10).
  The canvas reports a change 300 ms after an executed, undone or redone command, never for an
  import (which only clears the command stack); before deciding about unsaved changes ("Fertig",
  leaving) the page takes a change that is still waiting, so an edit committed by that very click
  (a name field left by clicking) counts. analyzr adds diagram-js overlays and an element factory
  that names new elements `shape_<ULID>`/`connection_<ULID>`, so a step added in a later session
  never takes a deleted step's id. `src/lib/zod-csp.ts` (first import of `main.tsx` and of the
  chunk) sets zod's `jitless`, so the CSP sees no `new Function` probe.
- **Overlays.** Above each step one row of labels: "3 Prozesse · 2 offen" (processes accepted or
  held on the step; open = proposed, or accepted with a changed or missing endpoint; a step with
  only a proposal reads "1 offen"), the finding labels "nichts angenommen" (topmost step without an
  accepted process on it or below, and since UX6 only when nothing in its subtree waits for a
  decision or an answer: `pendingSteps`) and "Link ungelöst"; the step tree and the step view count
  "offen" the same way; findings also dash the step's outline, the selected step gets a 4 px one
  (`!important` over the renderer's inline width, UX6), an element a refused save names is
  outlined red with "Fehler beim Speichern". The labels scale with the zoom up to 100 %, so the
  steps' names stay the largest text. The legend is one line: „3 offen“ zu prüfen · „2 Prozesse“
  platziert · lila Management · grün Unterstützung.
- **Header** (UX6, `chain-header.tsx` on the shared `CanvasHeader`): „‹ <Projekt>“ as the way
  back, the chain's name with its revision behind a disclosure („Revision 3 · gespeichert von
  owner · …“), the chip „3 Prozesse ohne Schritt“ (scrolls the panel to the list), „Bearbeiten“
  and „Exportieren“ („Datei (.vc.json)“, „Bild (SVG)“); in edit mode the base revision and
  „Ungespeichert“ beside the name and the toolbar below („Speichern“, undo, redo, „Exportieren“,
  „Importieren“, „Fertig“).
- **Panel.** Without a selection (UX6): one status line („0 von 31 Prozessen platziert · 29
  Vorschläge offen“, `chainCoverage`), „Platzierungen prüfen (29)“ (= J, the first open
  placement), the stage when it asks for something, „Zu prüfen (n)“ in review order (the first 8,
  „Alle n zeigen“; a marker only on „erneut prüfen“) with "Alle erneut bestätigen (n)" (accepted
  placements whose step or process changed, all or nothing with ids, versions and
  `expectedCount`; those on removed steps or with a missing process are listed apart for a
  rejection or correction), „Ohne Schritt (n)“ (`unplacedItems`: the agent's doubts first with
  „Agent unsicher: …“, then the processes without a step; hints, „Platzieren“, „Im Modell zeigen“,
  ref, agent and time behind „Technische Angaben“), „Link nicht auflösbar (n)“ when a step has such
  a link, the step tree closed („Schritte (n)“: its top-level rows collapsed with roll-ups,
  `subtreeCounts`; one tab stop; arrow keys, Home/End, ArrowRight opens a step or goes to its first
  sub-step, ArrowLeft closes it or goes to the parent, Enter or Space selects, the chevron opens by
  pointer), "Außerhalb der Kette", "Auf entfernten Schritten" and the owners' filter of
  auto-accepted placements; the process and step gaps are answered in „Offene Fragen“. In edit mode
  the overview is the chain's name and „Wähle einen Schritt, um ihn zu bearbeiten. Gespeichert wird
  erst mit „Speichern“.“ With a step: "Zur Übersicht" (also Escape; the focus returns to that step
  in the tree, which opens for it), the path (each segment selects that parent), name, the kind on
  a top-level step, owners, the link when there is one (the element id in edit mode only), the
  placement cards, the sub-steps' processes, "Über Aufrufe erreicht", "Prozess hinzufügen" (a
  manual placement, accepted at once, rationale prefilled „Manuell zugeordnet.“; its search field
  takes the focus, which returns to the button when the form closes), „Prozess öffnen“ for a linked
  step and „Als Liste öffnen“ (the step view). Import warnings of the renderer show at the top of
  the panel and can be closed.
- **Review.** Placement cards (UX6) show process, its model path and confidence, a status only
  when it is not a plain proposal (the auto-accept mark stays), endpoint state, rationale, question
  and a hold's note and answers as plain text, one closed „Details“ (tier and the rule's basis,
  „Vorgeschlagen von Agent „…“ · <Zeit>“, the evidence by element or step name, auto-accept
  provenance, the timeline with entries shown above kept to title, who and when, and „Technische
  Angaben“: placement id and version, ref, client, procedure, model), „Im Modell“, and the decision
  (M2's reject and hold forms, the hold's question and label folded; correct picks another step or
  „Außerhalb der Kette“ and prefills „Gehört auf „<Schritt>“.“). A held card answers through the
  note dialog of „Offene Fragen“ („Antwort geben“ in place of „Vormerken“; a hold without an open
  question takes a note on the placement). One card is active (`?placement=`, else the first open
  one on the step) and scrolls into view when it becomes active: A/R/H/C act on it, J/K move
  through the chain's open placements and after a decision the page moves on. In edit mode the
  keys work only while the panel has focus (the Modeler binds H, L, S, C and E on the canvas); a
  click on a card gives the panel the focus, and the key hints show only while the keys work. A
  409 shows "Die Platzierung wurde inzwischen geändert" and pauses the keys until "Neuen Stand
  prüfen".
- **Editing in the panel.** The name (Enter or leaving the field), the kind of a top-level step
  ("Art": „Kern (Standard)“, Management = purple, Unterstützung = green; core comes from the
  predecessor chain) and the link: "Kein Link", „Prozess“ (a picker over the head processes; a click or
  the arrow keys only mark a process, "Übernehmen" or Enter writes
  `analyzr:process/<model_key>#<process_id>`, which the save turns into a key-tier proposal and the
  double-click follows into the model view) or "Anderer Link" (≤ 2,000 characters, no control or
  bidi characters, "Übernehmen"). Each change is one undoable command (toolbar or Ctrl+Z on the
  canvas); the fields keep the focus while the canvas reports the change, and take over a change
  they did not make (an undo).
- **Save.** "Speichern" serializes the drawing canonically (`serializeDocument`), does nothing
  when it equals the base, pre-checks size and counts, runs the dry run with `If-Match:
  "r<rev>"` (a new chain `If-None-Match: *`: nothing is stored before the first save), asks
  before stranding placements, sending accepted ones to re-confirm or withdrawing proposals (only
  then the impact dialog opens; a save without such an impact keeps the spinner on "Speichern"),
  saves, and reports the save's own impact (a dialog when it differs from the dry run). An edit
  made while the request runs stays unsaved, as a draft on the new revision. A 412
  offers "Neuere Revision laden" (your version downloads as `.vc.json` first) or "Weiter
  bearbeiten" ([Troubleshooting](#troubleshooting)); a 422 lists the violations with the elements'
  names (a click selects them). A banner says when someone saved a newer revision meanwhile.
  „Exportieren“: the head or the drawing as `.vc.json`, the drawing as SVG.
- **Drafts.** Unsaved edits are kept in `localStorage` per project, chain and base revision (a
  chain not saved yet under `new:r0`, compared with the empty chain); entering edit mode offers to
  restore a draft of the current head, or to download or discard one of an older revision. The
  choice is explicit (Escape does not close the dialog, the focus starts on "Entwurf
  wiederherstellen" or "Herunterladen"), and nothing touches the stored draft until it is made;
  a draft is removed only by a save, an `unchanged` answer, "Verwerfen" or editing back to the
  base. Leaving the page while dirty asks first ("Weiter bearbeiten" is the default, also on
  Escape); a reload keeps the draft.
- **Drill-down.** Double-click (view mode): a resolved `analyzr:process/` link opens the model
  view at that process; any other step is selected and zoomed in place, its step view one click
  away („Als Liste öffnen“ in the panel; `/value-chain/steps/…` stays a deep link). The step
  view names a process by name and model path (the row's name links to its card on the chain), a
  kind only on a top-level step, owners and link only when set.
- **CSS.** The renderer's stylesheet (with diagram-js' own) comes with the chunk; analyzr's rules
  are scoped under `.analyzr-vc`. The Playwright CSS check proves the bpmn-js review screen looks
  the same after the chain page and the other way round.

Design: `miragon-brand:modeler-tool-design`. `src/theme/cd-tokens.generated.css` is vendored
unchanged from the skill (re-copy it to update, never edit it); `src/index.css` maps the shadcn
tokens onto it (one light mode, no dark theme, CI radii and shadows, Geist and Geist Mono
self-hosted), `src/theme/tokens.ts` mirrors the palette for code and `test/theme.test.ts` is the
drift test. UI texts are German with "du". The favicon and empty-state mark are the official
Miragon app icon. shadcn components live in `src/components/ui` (added with
`pnpm dlx shadcn@4.21.2 add …`, then adapted: CI radii, blue primary hover, badge radius, toggle
and dialog backdrop); toasts are a small Radix-based `Toaster` (`src/lib/toast.ts`).

## Conventions

**TypeScript runs from source.** Node 24 strips types natively, so the server and the CLI run
`node src/main.ts` without a build step, and workspace packages export `./src/index.ts`. That
requires:

- relative imports with the `.ts` extension (`import { x } from './x.ts'`); the web app, bundled
  by Vite, uses extensionless imports and the `@/` alias like shadcn;
- erasable syntax only (`erasableSyntaxOnly`): no `enum`, `namespace` or constructor parameter
  properties;
- `import type` for types (`verbatimModuleSyntax`).

TypeScript is 6.0.3: TypeScript 7 is published, but typescript-eslint 8.71 supports `<6.1`.

**Dependencies.** Exact versions only; `pnpm add` saves exact versions (`saveExact` in
`pnpm-workspace.yaml`, which is where pnpm 11 reads its settings). pnpm 11 refuses releases younger
than a day, runs no install scripts unless listed under `allowBuilds`, and pins one `vite` via
`overrides`. A version pinned on purpose before it is a day old goes under
`minimumReleaseAgeExclude` as `<name>@<exact version>` (`pnpm add <name>@<version>` adds the entry
itself; today there is none); the entry is harmless once the release is older, so remove it then. After editing `pnpm-workspace.yaml` alone, `pnpm install` may report "Already up
to date"; touching `package.json` makes it re-resolve. `apps/server/test/unit/runtime-pins.test.ts`
enforces the rule in `pnpm test`: every dependency in every workspace `package.json` and every
override is an exact version or, for the workspace's own packages, `workspace:`; `link:`, `file:`,
`portal:`, tarball and Git specifiers fail, and so does a `pnpm-lock.yaml` entry that is not an
exact registry release (an `integrity` as the only resolution, the importer version equal to its
pin, workspace packages as `link:` to their directory). The same test requires one locked version
each of the `@miragon/value-chain-*` packages, `diagram-js`, `diagram-js-direct-editing` and zod
4.x, with every `@miragon/value-chain-*` pin naming it (M4 §5): bump those pins in `apps/server`,
`apps/web` and `eval/tools` together, and add the new schema-model version to the validator's
`VERIFIED_SCHEMA_MODEL` after reading its CHANGELOG.

**Contracts first.** REST routes are declared once in `packages/contracts/src/api/routes.ts`
(zod-to-openapi route configs). The server implements them with
`app.openapi(createRoute(apiRoutes.x), handler)` inside a `register…Routes(app, deps)` function
called from `src/app.ts`; any contract route without a handler answers 501, so the served
OpenAPI document never points into a 404 (a safety net: `createAnalyzrApp` returns these
`placeholders`, and a unit test requires none, plus a real `app.openapi` handler for every
contract operation). Every route with params, query or a body declares 422 (a contracts test
checks it), since the validation hook answers malformed input with `validation-failed`. `GET /api/v1/openapi.json` serves
`buildOpenApiDocument()` from the contracts. After changing contracts, run
`pnpm --filter @analyzr/client generate`; CI fails if `packages/client` is stale. On schemas with a
`.meta({ id })`, use `orNull(schema)` instead of `.nullable()` (zod-to-openapi drops the `null`
otherwise).

**Server layers** (`apps/server/src`): `domain` (use cases, `DomainError`, no imports from `db`,
`http`, `mcp`, `auth` or from hono/pg/drizzle/MCP packages, enforced by
`.dependency-cruiser.cjs` in `pnpm lint`), `db` (Drizzle, `casing: 'snake_case'`, migrations in
`apps/server/drizzle/`), `http` (routes, problem+json via `problemResponse` and
`DomainError` mapping), `mcp` (tools registered in `createMcpServer`), `auth` (local guard,
session cookie, bearer/cookie → `Actor`). `src/analysis.ts` binds the domain's `AnalysisPort`
to `@analyzr/bpmn-facts` and `@analyzr/relations`; tests inject doubles through `createAnalyzrApp`.

**Domain** (`apps/server/src/domain`). Ports in `ports.ts` (`Store` with `read` = REPEATABLE READ
read-only snapshot and `write` = one transaction; repositories that only find rows *in a
project*; `AnalysisPort`). Every use case (`use-cases/*`) starts with
`policy.require(tx, actor, permission, projectRef)` (`policy.ts`: the CONCEPT §6 matrix; unknown
and foreign projects are 404). `ingest.ts`: `PUT`, import and seed go through
`ingest(project, files, actor)` — facts are extracted before the transaction; the transaction
locks the project row, stores revisions and facts, runs `recomputeProject` once
(`recompute.ts`: rule tier over the head facts, rule assertions, `recomputeStatus`, endpoint
state, findings) and queues `relations` tasks (since 0.2.0 when the new head's `facts_hash`
differs from the previous head's, so a revert is judged again, and always for a new or revived
model; a layout-only change queues nothing unless no task is open and none analysed these facts;
an open task for other facts is cancelled). Identical bytes are `unchanged` without revision or
event. Rule assertions follow the rules: an unambiguous call from a modelled caller, or one whose
call target was set in analyzr (applied or `in-source`), is a rule decision `accept`, everything
else a rule proposal (since M6 S2c-1 also any other unambiguous call from a derived caller, the trust rule applied first in `planRecompute`; `storeFile` stores each
uploaded revision's class, [The trust rule](#the-trust-rule-m6-s2c-1)), re-asserted when the
endpoint fingerprints (or the rationale) change and withdrawn when no longer derived — except an
acceptance whose endpoint is missing (deleted model), which stays accepted with
`endpoint_state = missing`, an open item. Since M6 S2c-3 the owner's enabled rules for derived
calls evaluate the derived-call proposals that recompute recorded right after it, in the same
transaction (`autoAcceptDerivedCalls`, never for a write made with an agent token; [Auto-accept
rules](#auto-accept-rules-owner-decision-19)).
A human decision always outranks the rule. Every write appends events with a dense per-project
`seq` (`UPDATE project SET last_seq = last_seq + 1 RETURNING`). `status.ts` computes status,
tier and basis for any subject (`recomputeStatusOf`, `classifyProposalOf` with a `Subject`
descriptor); relations and, since M4 S1, placements (`domain/value-chain/`) are its instances.
The value chain functions (`createValueChain`, `saveValueChainRevision`, `deleteValueChain`, the
placement lifecycle) run inside the caller's transaction after `lockForWrite`; only the use
cases of `use-cases/{value-chains,placements}.ts` call them, with `policy.require` (chain writes,
decisions, manual placements and notes through `requireChainReview`, which adds the value chain
`reviewUrl`) and a document prepared by `prepareRevision` outside the transaction. Ingest and
model deletion end with `syncValueChainAfterModels` (rule proposals, then endpoint state), every
chain save with the rule tier's recomputation; derived writes are recorded under `analyzr-rules`
without a client. Entity tags and conditional headers (`"<version>"`, `"r<rev>"`, `If-Match`,
`If-None-Match`) are parsed in `src/http/etag.ts` only.

**Schema** (`src/db/schema.ts`, CONCEPT §2): `project`, `principal`, `membership`, `invitation`
(unused in M1), `agent_token`, `model`, `model_revision` (verbatim bytes as `bytea`, processes
and message flows as jsonb), `fact`, `relation` (+ generated `from_model`/`to_model`, anchor
fingerprints), `relation_assertion` (check: agents never decide), `analysis_task` (partial
unique index: one open task per model and kind), `analysis_submission`, `no_link`,
`no_link_withdrawal`, `event`, `finding` (derived, replaced by every ingest), and the view
`model_pipeline` (stage and open items). Child tables use composite foreign keys
`(project_id, x_id)`. `event`, `relation_assertion`, `analysis_submission`, `no_link` and
`no_link_withdrawal` are append-only (trigger function in `drizzle/0001_append_only.sql`,
hand-written; a no-link is live while it has no withdrawal row).
M2: `model_revision.engine`; `relation_assertion.question`, `label`, `linked_relation_id` and the
kind `note` (check: notes only from humans); `analysis_submission.client_id`
(`0002_pipeline_review.sql`, generated); the `analyzr_analysis` NOTIFY trigger, the engine backfill
and the deferred assertion → submission foreign key (`0003_pipeline_notify.sql`, hand-written).
Judge each pair once (0.2.0): `analysis_task.claimed_seq`, `assignment` (jsonb typed pairs) and
`requeue_after`, `relation_assertion.from_hash`/`to_hash` (the basis of a pipeline proposal, NULL
otherwise and for older rows), the tables `no_link` (type `call|message|signal|trigger`, refs and
models, basis, reason, source kind, principal, client, declared procedure and model, submission,
origin model, `seq`; unique per submission and typed pair) and `no_link_withdrawal`
(`0004_judge_once.sql`, generated); their append-only triggers and the `claimed_seq` backfill from
the latest `analysis.claimed` event (`0005_judge_once_triggers.sql`, hand-written).
M4 S1 (value chain, [M4-VALUE-CHAIN.md](M4-VALUE-CHAIN.md) §2): `value_chain` (mutable like
`model`: key, name, head, `deleted_seq`; the head is a revision of the same chain),
`value_chain_revision` (canonical bytes as `bytea`, `content_hash`, `structure_hash`,
`schema_version`, base revision of the same chain, humans only by check), `value_chain_step`
(one row per step element id and generation plus the pseudo-step `@outside`; tombstoned by
`deleted_seq`/`deleted_rev`; a partial unique index allows one live generation per id),
`placement` (mutable derived state like `relation`: natural key chain, element, generation and
process ref, generated `process_model`, status, endpoint state, tier without `rule`, anchor
fingerprints; a composite foreign key to its step generation) and `placement_assertion` (the
`relation_assertion` columns with `step_fp`/`process_fp`, the M4b basis `step_hash`/`process_hash`
and `submission_id`; checks: neither agents nor the rule tier decide, notes by humans, the basis
pairing) (`0006_value_chain.sql`, generated); `value_chain_revision` and `placement_assertion`
append-only, `value_chain_step` tombstone-only (`analyzr_value_chain_step_tombstone_only`), and the
deferred `placement_assertion` → submission foreign key (`0007_value_chain_triggers.sql`,
hand-written). Owner decision 19 adds `auto_accept_rule` (immutable head row: kind, creator), its revisions
`auto_accept_rule_revision` (criteria, `enabled`, the human author; checks: humans only, minimum
confidence 0.5–1, tiers per kind, relation types, name and model lengths), the marker columns
`auto_accept_rule_id`, `auto_accept_rule_revision`, `auto_accept_trigger_id` on both assertion
tables with the author-pinning composite foreign key to the revision, the same-subject trigger
foreign key (new uniques `(project_id, relation_id|placement_id, id)`), the marker check and a
partial index (`0009_auto_accept.sql`, generated, with the two uniques moved before the foreign
keys that need them), and the append-only and no-truncate triggers on both rule tables
(`0010_auto_accept_triggers.sql`, hand-written). M6 S5a adds `open_question_answer` (id, project,
question id `q-` and 16 hex, subject type and id, kind, `text` xor `note_assertion_id`, generated
`relation_id`/`placement_id` with one composite foreign key each to the answered relation's or
placement's assertion (on 0009's uniques), principal, `source_kind = 'human'`, seq; checks: humans
only, text or note by subject type, text 1–2,000 characters, the id pattern)
(`0011_open_question_answer.sql`, generated) and its append-only and no-truncate triggers
(`0012_open_question_answer_triggers.sql`, hand-written); `migration-auto-accept.test.ts` applies
0009–0012 to a database that already holds data. M6 S5c-1 relaxes the check
`open_question_answer_text_or_note` (an outside mark, `kind = 'outside-landscape'` on a subject
that is neither a relation nor a placement, may have neither text nor note), adds the unique
`(project_id, id)` on `open_question_answer` and the table `open_question_answer_withdrawal`
(the answer id as primary key, project, principal, `source_kind = 'human'` by check, seq; a
composite foreign key to the answer in its project) (`0013_open_question_actions.sql`, generated,
the unique moved before the foreign key that needs it), and its append-only and no-truncate
triggers (`0014_open_question_answer_withdrawal_triggers.sql`, hand-written); the same test runs
every migration up to 0014 on its data, which holds no answer rows before 0013. M6 S5c-2 adds
`model_amendment` (id `mam_`, project, model, element and the endpoint it was opened from, op,
`before` and `after` in the facts' sanitized form, the uploaded revision it was recorded on,
`supersedes_id`, principal, client, `source_kind = 'human'` by check, seq; composite foreign keys
to the model, to a revision of that model (`model_revision`'s new unique `(project_id, model_id,
id)`) and to the superseded amendment) and `model_amendment_withdrawal` (the amendment id as
primary key, reason `withdrawn` or `superseded`, principal, humans only, seq)
(`0015_model_amendments.sql`, generated, the unique moved before the foreign key that needs it)
and their append-only and no-truncate triggers (`0016_model_amendment_triggers.sql`,
hand-written). `model_revision.xml` holds the uploaded bytes or bytes computed from an uploaded
revision by amendments; `source.kind = 'amendment'` marks the latter, with `upstream` and the
plan in `amendments`. `migration-auto-accept.test.ts` now runs every migration up to 0016 on its
data, which holds no model or revision rows; `amendments.test.ts` checks the new tables' triggers
and checks on a fresh database. M6 S2a adds the nullable `model_revision.extract_warnings` (jsonb, the
extractor's warnings written at insert, `[]` for none, null for revisions stored before;
`0017_revision_extract_warnings.sql`, generated); `provenance.test.ts` runs 0017 on a database
that holds a revision. `model_revision.source` (a `looseObject`, no migration) carries the typed
provenance of an uploaded revision (`uploader`, `manifestSha256` and the manifest's declared
fields); an amended revision carries none of its own. M6 S2c-3 adds `proposed_by` (`text not null
default 'agent'`), `derived_kind` and `converter` to `auto_accept_rule_revision` and the NULL-safe
check `auto_accept_rule_revision_proposer_check` (an agent rule names no derivation; a rule for
derived calls is a relation rule of tier `key`, type `call`, minimum 0.9, without agent, model or
ad hoc, with `derived_kind` in `export`, `converted`, `none` and a converter of 1–120 characters
exactly for `converted`) (`0018_auto_accept_rule_tier.sql`, generated; `ADD COLUMN … DEFAULT`
fires no row trigger, so 0010's append-only triggers stay); `migration-rule-tier.test.ts` runs it
on existing rules, which read as agent rules and keep their acceptances, and refuses 14 rows by the
check's name; `migration-auto-accept.test.ts` now runs every later migration on its data (up to
0018 then, up to 0020 since M6 S2c-4, up to 0022 since M6 S2b's follow-up step 5).
M6 S2c-4 adds `revision_trust_review`, the owner's review of an uploaded revision stored before the
trust rule (project, revision, model, `class` `modelled` or `derived` by check, principal, client,
`source_kind = 'human'` by check, seq; primary key `(project_id, revision_id)`, a composite foreign
key `(project_id, model_id, revision_id)` to `model_revision`'s unique)
(`0019_revision_trust_review.sql`, generated), and its append-only and no-truncate triggers plus
the guard `analyzr_trust_review_guard`, which refuses a revision that carries `source.trust` or is
amended (`0020_revision_trust_review_triggers.sql`, hand-written); `migration-trust-review.test.ts`
runs both on a database migrated to 0018 that holds revisions.
M6 S2b's follow-up step 5 adds `model_identity`, the identity a manifest declared per import and
model (owner decision 29 (1); project, model, `seq`, revision, `kind` `revision` or `unchanged` by
check, `system`, the nullable `external_id`, `external_path` and `url`, principal, client,
`created_at`; primary key `(project_id, model_id, seq)`, which also serves both reads of the newest
row, a composite foreign key `(project_id, model_id, revision_id)` to `model_revision`'s unique, and
the partial unique `model_identity_revision_unique` `(project_id, revision_id) WHERE kind =
'revision'`) (`0021_model_identity.sql`, generated), and its append-only and no-truncate triggers,
the guard `analyzr_model_identity_guard` and the backfill (`0022_model_identity_triggers.sql`,
hand-written). The guard (`check_violation`) refuses a row whose revision is no uploaded revision of
its model (another model's, an amended one); a `revision` row whose seq, principal, system, tool id,
folder or link differ from its revision's (so also one for an undeclared revision); and an
`unchanged` row without its own `model.identity_declared` event at its seq naming the same model,
revision, system, tool id, principal and client, or naming another revision than the one the live
model's unchanged bytes are kept as (the head, or an amended head's `upstream`; so none for a
deleted model). The backfill writes one `revision` row per uploaded revision a manifest declared
(`source.system` set, not amended), deleted models included, with the revision's seq, principal and
`created_at` and its `model.revised` event's client, through the guard, idempotent by `ON CONFLICT
DO NOTHING`; its newest row per model is what `uploadedSources` read before (the head's uploaded
revision if declared, else the newest declared one), so every reader answers as before.
`migration-model-identity.test.ts` runs both on a database migrated to 0020 that holds declared,
undeclared, amended, deleted and revived models, and a scratch `drizzle-kit generate` reports no
schema changes.
Migrations: `pnpm --filter @analyzr/server db:generate` for schema changes,
`pnpm --filter @analyzr/server exec drizzle-kit generate --custom --name <name>` for SQL drizzle-kit
does not model.

**Facts** (`packages/bpmn-facts`). `extractFacts(xml, {modelKey})` rejects hostile or broken
input with a `BpmnInputError` (`doctype-forbidden`, `entity-forbidden`, `too-large`,
`too-many-elements`, `not-xml`, `not-bpmn`, `invalid-model-key`; the server maps it to 422
`bpmn-invalid` with the code as `reason`, 413 for `too-large`; UX7: a `not-xml` whose cause is the
encoding also carries `encoding`, `utf-16` or `not-utf-8`, as the error's field and the problem's
member, so the web names the remedy) and returns non-fatal `warnings` otherwise (at most 100 plus
`too-many-warnings`; M6 S1: the server passes them into the import and PUT results of `created`
and `revised` files as `warnings` (the first 20, each message cut to 300 characters ending in `…`;
beyond 100 the first 19 and the `too-many-warnings` entry) and `warningCount` (≤ 101), both absent
without warnings; they are not stored). It parses with
bpmn-moddle plus the camunda (C7) or the zeebe (C8) extension, chosen from
`modeler:executionPlatform` or the declared namespace (the two extensions cannot be loaded
together). Facts follow CONCEPT §2; `attrs` keys are declared in `FactAttrs` (`@analyzr/contracts`):
`messageName`/`signalName` only when the key comes from a real message/signal ref (rules never
match labels), `dynamic` for expressions (C7 `${…}`/`#{…}`, C8 `=…`), call binding/version/tenant,
`correlationKey`, `subprocessId`, `readBy`/`writtenBy`, `flowNodeRefs`. Timer, conditional, error,
escalation, link and compensation events produce no facts except none/timer/conditional starts and
none/terminate ends (out of v1). Any change to extraction, normalization or fingerprints needs a
new `FACTS_VERSION`; the corpus snapshots (`test/__snapshots__/*.facts.txt`) make such changes
visible.

**Model amendments** (`packages/bpmn-facts/src/amend.ts`, M6 S5c-2, decision 25). BPMN is written
only by byte-preserving splices, never through a bpmn-moddle round trip (bpmn-moddle drops what it
cannot read). `applyAmendments(xml, amendments, opts)` finds each target's start tag by its `id`
through the positioned scan of `xml-elements.ts` (exactly one element, of the op's BPMN type, no
prefix rebound on the way), replaces or adds one attribute or inserts one minimal element in the
XSD's child order (`documentation` first, `extensionElements` right after the last
`documentation`, a new root element after the last root element before the first `BPMNDiagram` or
`relationship`), escapes values (`&`, `<`, `>`, `"`, tab, line breaks; in a file whose
declaration names another encoding than UTF-8 also every code point above U+007E as a character
reference, and a character beyond the Basic Multilingual Plane is refused there, since the
extractor's parser cannot read its reference back), and keeps every other byte (vendor extensions,
comments, the BOM, line endings). Every result is extracted again; an amendment whose facts would
not read exactly the intended change, or that adds a warning, is refused (`check-failed`), never
written. The result is a function of the bytes and the amendments in seq order only. The server's
pure `domain/amendments/` plans live amendments against an uploaded revision (`plan.ts`), decides
which fields may be set (`fields.ts`: an open question names the field, or it is empty or
unresolved, or a live amendment the head applies set it), derives heads (`derive.ts`), computes the
effect and the cost (`effect.ts`) and renders the change list (`export.ts`); the BPMN work reaches
it through `AnalysisPort.amend` and `AnalysisPort.readAmendable`.

**Relations** (`packages/relations`, no LLM). `runRules(projectFacts)` is the rule tier of
CONCEPT §2: a constant `calledElement` that exactly one other process has as id is `accepted`
(tier `rule`, `analyzr-rules/1.0.0`, binding/version/tenant in `attrs`; the library knows no trust
class: the server turns it into a proposal for a derived caller, M6 S2c-1); two or more processes with
the id give `key`-tier proposals (confidence 1/n) and `duplicate-process-id`; no match gives
`unresolved-call` plus proposals by file stem (`key`, 0.8) or process name (`lexical`, 0.6); an
expression gives `dynamic-call`. Identical message or signal names (`nameKey`: `normalizeKey`
without word separators, so umlaut, case and `_` variants match) of real refs in different
processes are `key`-tier proposals with confidence 1.0, never accepted, unless a message flow in
the file joins them. `dangling-throw`/`unmatched-catch` mark message and signal endpoints without
such a partner and without a message flow; rules see names only, so endpoints that only a
semantic link (other words or language) connects are reported too. Endpoints follow
`endpointRole` and `EVENT_DEF_COMPATIBILITY` (starts/ends in embedded subprocesses and ends in
event subprocesses never; the typed event-subprocess start yes; timer/conditional starts and
terminate ends never; `trigger` = labelled none end → labelled none start). `generateCandidates`
offers per endpoint the rule/key pairs, the top 5 lexical matches (score
`0.6 · concept Jaccard + 0.4 · relative Levenshtein`; camelCase split, DE/EN stopwords, a short
generic DE/EN synonym list with inflection, `ge…` participle and compound-head handling) and up
to 30 further compatible endpoints; calls only while their target is open. With a focus model it
returns that model's perspectives (a subset of the unfocused run). `labelBaseline` (`baseline-label/1`) is plain
label matching: a search label (lowercase, non-ASCII-alphanumerics → space, words sorted and joined),
Levenshtein ≤ 4 between every end/intermediate throw and every start/intermediate catch
(whatever the event definition, scope or process), call activities by label to process-model
name (file stem, or process/pool name in collaborations). Facts lack timer/conditional/link and
error/escalation events, so the eval passes them in as `extraEvents` from a full parse.

**Procedures** (`packages/procedures`). One Markdown file per procedure in the package root:
frontmatter of `key: value` lines with `id`, `version` (`x.y.z`), `title`, `status`
(`placeholder` or `released`), optionally `description` (one line; it becomes the skill's
description, else the title does) and `kind` (the task kind its claims name, `placement` for
`analyzr-placements`; left out for the default kind), other keys ignored, then the text. Prompt
texts that are no procedure live in `prompts/` (not read by `listProcedures`). `listProcedures` parses
every `*.md` in the package root except `README.md`, so drafts, templates and generators stay out
of the root. The text pins no version (no `x.y.z`; agents declare the one the claim names) and
holds no `---` (`procedures.test.ts`), and it must not contain what Claude Code expands in a
skill: `$ARGUMENTS`, `$` followed by a digit (`$1.00` too), `${CLAUDE_`, `` !` `` at the start or
after whitespace, and ```` ```! ````; `renderSkill` throws on them, so `generate` fails. After
every change of a procedure run `pnpm --filter @analyzr/procedures generate` and commit
`plugins/analyzr/skills/<name>/SKILL.md` and `plugins/analyzr/.claude-plugin/plugin.json` (its
`version` is `PLUGIN_VERSION` of `src/plugin.ts`, since S5 the plugin's own); `test/plugin.test.ts`
fails until they match, and while the shipped skills differ from the row of `PLUGIN_RELEASES` for
the plugin version (a changed skill needs a new plugin version and its row). Never edit the
skill by hand. **A released version's skill never changes:** Git-hosted plugin installs stay at
their version until it changes, and runs are recorded under `<id>@<version>`. So a change to
`relations.md`, to the wrapper (`src/wrappers.ts`) or to the skill frontmatter (`renderSkill`)
needs a new procedure version, and that version's sha256 of the rendered skill goes into `RELEASED`
(per procedure id) in `test/plugin.test.ts`, whose test "never changes the skill of a released version" fails
otherwise and prints the new hash. The `0.1.0` entry is the skill with the version rule and
`disable-model-invocation`, which were added before any live run under the unchanged version;
`0.2.0` (judge each pair once) has an entry of its own.
`apps/server/test/unit/procedure-text.test.ts` keeps the prose in line with the code: the
procedure is `released`; every checked limit appears as a whole number in its own phrase (the
helper `phrase` does not let "15 minutes" pass for 5 or "12,000" for 2,000): lease minutes, the
third attempt, relations and no-links per submission, evidence entries, rationale, question,
summary and no-link reason lengths, the documentation cut, the 1 MiB body, the documentation
length (`MAX_DOCUMENTATION_LENGTH`) and the lexical (5) and compatible (30) candidate caps; the
`invalid:<reason>` list of its Limits section equals the contracts' (as sets, since the text
orders them for agents), and so does its no-link list (`NO_LINK_INVALID_REASONS`); it names only
MCP tools that the tools snapshot lists, and only arguments their input schemas have. Not checked
yet, because the contracts keep them inline: the `llmModel` limit (100), the procedure id and
version limits (100, 50) and the evidence entry limit (1,000); checking them needs
`MAX_LLM_MODEL_CHARS`, `MAX_PROCEDURE_ID_CHARS`, `MAX_PROCEDURE_VERSION_CHARS` and
`MAX_EVIDENCE_ENTRY_CHARS` exported from `@analyzr/contracts`. A new version also moves the simulation
agent's recordings ([Recordings](#simulation-agent-and-evalreplay-m2)).

**Errors** are RFC 9457 `application/problem+json` with `type` `urn:analyzr:problem:<code>` and a
`code` member; codes and statuses are in `PROBLEMS` (`@analyzr/contracts`).

## Tests

- Unit tests live in each package's `test/`. The server has two vitest projects:
  `pnpm --filter @analyzr/server test:unit` (no Docker) and `test:integration` (real PostgreSQL).
- Integration tests get one PostgreSQL 17.11 per run from Testcontainers (`test/global-setup.ts`);
  each test file calls `createTestDatabase()` (`test/support/db.ts`) for its own migrated database
  and `drop()`s it afterwards, so files run in parallel. Testcontainers removes its containers
  itself. To use an existing server instead, set
  `ANALYZR_TEST_DATABASE_URL=postgres://user:pass@host:port/db` (the user needs `CREATEDB`).
- Server integration tests (`apps/server/test/integration`): ingest and import (idempotency,
  revisions, facts, rule relations, endpoint state, stages, task queueing), the policy matrix
  over REST (owner session, tokens per scope, foreign project, anonymous), token lifecycle and
  sessions, database constraints (append-only triggers, agents never decide, one open task,
  composite foreign keys), and MCP with the plain SDK client over real HTTP plus a raw
  2025-11-25 JSON-RPC exchange. These use `test/support/fake-analysis.ts` (BPMN-looking
  documents that carry their facts, and a small rule tier) to stay small and precise; since M6
  S2c-1 its documents default to engine `c7`, so an owner or web upload is modelled, and a test
  that wants a derived model sets `engine: null`.
  With the real libraries: `real-libraries.test.ts` ingests `eval/corpus/_sample` against its
  `expected.yaml`; `corpus.test.ts` imports `nordwind-handel` and `stadtwerke-auental` into
  one project each and requires exactly the models, facts, rule relations (type, endpoints,
  status, tier, confidence, attributes) and findings that `eval:candidates` computes
  (`eval/reports/candidates.json`), no change on re-import, a new revision plus recomputed
  relations and findings for a changed model, and `endpoint_state = missing` for accepted calls
  into a deleted model (restored on re-upload). `owner-key.test.ts` covers the CLI credential.
  `hardening.test.ts` (real libraries): control characters in BPMN attributes are stored
  sanitized instead of failing the transaction; an event with a message and a signal
  definition anchors each relation to the fact of its own kind; `which_processes_use` matches
  names like the key tier; malformed MCP/REST input (NUL in a project ref, cursor or name) is
  a validation error and an unexpected error reaches agents only as `internal`; revision
  content is a sandboxed download.
  `test/unit/policy.test.ts` checks the generated matrix permission × role × scopes × principal
  kind.
- M2 pipeline and review (real PostgreSQL; fake analysis unless noted):
  `pipeline.test.ts` (claim and its hashed, bound lease token, the claim input, per-item results
  for every invalid reason, provenance, verbatim storage, replay and 409 `already-submitted`,
  release, lease expiry with re-claim and `lease-lost`, failure after the third lost lease in the
  claim transaction, late submits, cancellation by a new revision, supersession, requeue, scopes,
  a claim whose input cannot be built; after the review: a third expired lease failed by the
  pending count or a requeue without anybody claiming, a requeue cancelling an expired lease with
  attempts left, a late submit after the failure refused once a newer task ran or the model
  changed, the 413 for a body over 1 MB, items with control characters `invalid` while the others
  apply and NUL stored as U+FFFD, control characters in the declared model and a release reason
  refused, a revoked token's proposals withdrawn and its task handed back with decisions and other
  agents' proposals kept); `pipeline-concurrency.test.ts` (over real HTTP: two
  projects, six agent tokens and the owner claim at once, every task exactly once, again after the
  leases expired; a row locked by another transaction is skipped, not waited for; the long-poll
  wakes on NOTIFY, is bounded, shares one LISTEN connection, lets go of aborted requests, ignores
  other projects and bounds the waits per caller); `review.test.ts` (accept, reject, hold, correct, notes, If-Match and versions,
  bulk with count/version/tier/duplicate mismatches, decision memory across re-uploads, held items
  and `waiting_for_clarification`, the claim input with decisions and notes, findings answered by a
  relation, ad-hoc proposals and withdrawal, manual relations, agents never decide, events, a
  human's acceptance kept when the same human proposes the pair again and that proposal is
  superseded, control characters refused in every decision, note and ad-hoc proposal);
  `claim-input-size.test.ts` (real libraries, every model of both scored landscapes, < 100 KB);
  `policy.test.ts` (claim, pending, requeue, ad-hoc proposals, decisions, bulk and notes per
  credential); `db-constraints.test.ts` (notes by humans only, agents never decide even through the
  store, the deferred submission reference, the engine backfill); `mcp-contract.test.ts` (the pipeline
  tools, `decide_relation`, `propose_relation`/`withdraw_proposal`, `get_landscape` and the prompt in
  both protocol versions; a submission just over 1 MB refused as `payload-too-large`, a request
  over the MCP limit as HTTP 413). Unit: `status.test.ts` (with 2,000 random histories as property tests:
  order independence, notes ignored, obsolete exactly without live stances, latest decision wins
  unless a changed proposal reopens a rejection, `classifyProposal` never drops a proposal that would
  change the status; a human decision in force across the same human's later proposal and its
  withdrawal), `pipeline.test.ts` (lease tokens, item checks incl. control characters, the stored
  payload's NUL replacement, findings filter, claim-input rendering, If-Match, notifier fallbacks
  incl. the per-caller limit); `packages/relations/test/assess.test.ts`.
- M2 simulation agent and `eval:replay`: `apps/agent-sim/test/unit` (`pnpm --filter
  @analyzr/agent-sim test`, no Docker): `policy.test.ts` (one verdict per candidate incl. skips for
  accepted, rejected, held and reopened pairs, rationale and question texts, no-links, thresholds,
  verdict by score whatever the basis, the submission limits on 900 seeded random candidates),
  `recorder.test.ts` (recording lines with and without ids, input summary, layout, files started
  afresh per run; typed no-links, the no-link outcomes, `withdrawnNoLinks` and the `uncovered`
  count), `agent.test.ts` (the loop over the real SDK client against an in-memory MCP
  server: procedure and prompt read, one claim per task, scope and `maxTasks`, dry run, refused
  submissions handed back at the end, no loop on a repeated task, missing tools, wrong token) and
  `program.test.ts` (the command line: token checks, options, exit codes, recording paths). The
  end-to-end run is the server test `agent-sim.test.ts` (real PostgreSQL and libraries): both
  scored landscapes imported, `nordwind-handel` worked over Streamable HTTP and
  `stadtwerke-auental` through `analyzr-agent-sim --stdio` (the `analyzr mcp` bridge as a child
  process); every task `done` with attempt 1 and its stored submission (handle, client, declared
  procedure and model, no lease token, nothing invalid), every agent-sourced relation `proposed`
  with the token's principal, client, procedure and model (also checked row by row in
  `relation_assertion`), no decision but the rule tier's, no `relation.decided` event by the
  agent, the recordings equal to `eval/recordings` (file snapshots), every recorded claim input
  below 100 KB, and a dry run that leaves every task queued with no attempt counted.
  `eval/tools/test/replay.test.ts`: a fixture recording of `_sample` with every case
  (server-invalid and locally invalid items, a pair proposed twice, must_not_link at high
  confidence, unlisted, no-links incl. one on a must_link, questions) scored to exact numbers; a
  judge-once fixture (`test/fixtures/judge-once/…`, three models with typed no-links, two answered
  invalid, and `uncovered` counts: 1 pair judged twice, 3 uncovered, the invalid no-links left
  out); the committed simulation recordings judge no pair twice; the report is deterministic and
  the committed `replay.md` up to date (with its "Live gate" section); unreadable recordings are
  refused with file and line; the command resolves relative `--recordings`, `--corpus` and `--out`
  against its base directory (the same bytes), a named `--recordings` that does not exist or is a
  file and an unknown option exit 2 with nothing written, and an unknown landscape exits 1 without
  the usage text.
- M3 procedure and plugin: `packages/procedures/test` (`pnpm --filter @analyzr/procedures test`, no
  Docker): `procedures.test.ts` (the released procedure, its `description`, no version and no
  `---` in the text, frontmatter parsing), `wrappers.test.ts` (the wrapper for a fixed scope, no
  scope and the skill's arguments, the version rule in both scopes; the skill's frontmatter with
  `disable-model-invocation: true`, the title fallback, the expansion guard and a `$` it lets
  through) and `plugin.test.ts` (the committed `SKILL.md` equals `renderSkill`, the skill of a
  released version has the sha256 in `RELEASED`, `plugin.json` has the name `analyzr` and the
  procedure version, the marketplace lists `./plugins/analyzr`, the plugin declares no `mcpServers`
  and has no `.mcp.json`). `apps/server/test/unit/procedure-text.test.ts`: the procedure text
  against the contracts, the candidate caps and the MCP tools snapshot, with tool arguments, and
  the whole-number helper itself ([Conventions](#conventions)). `mcp-contract.test.ts`: the
  `work_pipeline` text equals `renderPipelineWrapper`, ends with the procedure and carries the
  version rule with the server's id and version; `maxTasks`
  `7` and `100` (also without a project) limit the loop, and `0`, `101`, `07`, `1.5`, `-3`, `abc`
  and the empty string are refused. `mcp.test.ts`: no input schema has a root `$ref`, and the
  instructions name exactly the tools without a required `projectId` (`test/unit/mcp.test.ts`
  checks the wording).
- M3 claim input: the contracts (an input without the additions still parses, the additions
  parse, malformed ones are refused), unit `pipeline.test.ts` (message-flow ends, partner
  documentation, `partnerProcesses` with the documentation cut, findings filtered to the model
  and sorted, both fields left out when there is nothing), integration `pipeline.test.ts`
  (`partnerProcesses` exactly the partners' processes, each input with the findings touching its
  model) and `claim-input-size.test.ts` ([above](#analysis-pipeline-and-review-m2)).
- Judge each pair once (`analyzr-relations@0.2.0`): `apps/server/test/integration/judge-once.test.ts`
  (real PostgreSQL, fake analysis, 21 tests): two models one after the other (the second claim
  lists the first's judgements in `judged`, its empty submission withdraws nothing, `uncovered` 0);
  the assignment (a queued partner with the earlier key; no `compatible` pair assigned, never
  `uncovered`, until a verdict lists it; a claimed partner's pairs skipped, and releasing and
  claiming either side again loses nothing; a claim judges what an expired lease held, and that
  task, claimed again, skips it; a partner version and a claimant version uploaded after the
  other's claim); disagreements that stay visible (another principal's no-link against a link, the
  same principal from another model's analysis) and the same principal changing its mind in a
  re-analysis of the same model, which replaces its own judgement; new versions (a doc-only change
  re-judged, an identical repeat `applied` with the new basis; a revert X1 → X2 → X1 with a partner
  analysis in between; delete Y, change X, revive Y unchanged; a procedure release plus a requeue
  judges every pair once more); losses (a revoked token's no-links withdrawn, both endpoint models
  queued or given `requeue_after`; `withdraw_proposal` of a pipeline proposal); submissions (a
  partner without a head at the claim gets its head as basis; every no-link outcome; `uncovered`
  with nothing queued; a result stored before no-links replays as stored) and a bulk decision
  prepared before a no-link arrived (409). Unit `judge-once.test.ts`: currency and staleness of a
  basis, `planClaim` (every rule, `compatible` pairs, settled and judged pairs, intra-model pairs),
  `validateNoLink` in order with the type inference, `judged` and `skip` as rendered.
  `db-constraints.test.ts`: `no_link` and `no_link_withdrawal` append-only, one withdrawal row, no
  no-link without its submission or with another type, the `claimed_seq` backfill of migration
  0005. `status.test.ts`: `classifyProposal` answers `duplicate` for a pipeline proposal only with
  the same basis and procedure. `claim-input-size.test.ts`: every task claimed at once, and the
  case seeded with LLM-sized judgements ([above](#analysis-pipeline-and-review-m2)).
  `procedure-text.test.ts`: the no-link reasons. Contracts: `judged` and `skip`, typed no-links
  and their outcomes, results stored before 0.2.0 and with the new fields, `Relation.noLinks`,
  recordings with the no-link type and the `uncovered` count. Tests whose rule changed say why in
  the test: in `pipeline.test.ts` the claim input lists the shared pairs of a queued earlier-key
  model in `skip`, a requeue keeps the current judgements while a new model version withdraws
  those on the old one, and a revert queues a task (also in `ingest.test.ts`); in `review.test.ts`
  the human-pipeline case withdraws only the proposal on the old model.
- M3 live runs: `eval/tools/test/live-gate.test.ts` (pass, fail, incomplete; one gate per
  procedure version, landscape and `llmModel`, whose runs, means and 0.8 rule do not mix; the
  baseline from the highest earlier version's live runs with the same `llmModel` or from
  `agent-sim` of any model, `0.1.10` after `0.1.9`; the 5-point boundary with float noise; 0.79999
  vs. 0.8; null recall) and `live.test.ts` (raw REST and MCP payloads from `test/fixtures/live`,
  typed and untyped no-links with the no-link outcomes, `withdrawnNoLinks` and the `uncovered`
  count in the recorder's key order,
  U+FFFD, the agent from the handle or `--agent`, sorting and grouping, refused payloads and
  landscapes, the REST reader against a fake server: pages, revision numbers, 401, 404, an
  unreachable server; the command on `_sample`: incomplete, a pass with three runs and the
  `agent-sim` baseline, a second model as a gate of its own, a fail at exactly 0.8 with
  `--no-write`, the warning for several tokens (two names, `--agent`, two tokens of one name),
  the warnings for several files and for a replaced file, the procedure warning, usage errors
  with exit 2 before any request, analyses of models another `--landscape` does not have with
  exit 2 and nothing written, runtime errors with exit 1). The server's `agent-sim.test.ts` runs `eval:live`'s
  reader with each project's agent token after the simulation agent and requires the recorder's
  lines, input aside, byte for byte. `apps/cli`: unit tests for `seed --project`/`--token-name`
  (an existing `--project` refused before any import or token request, misuse refused before any
  request, `--help`) and an e2e test that seeds `_sample` into `sample-run-1` with the token
  `claude-code-1`, whose handle is `agent:claude-code-1`; a second seed into that key exits 1 and
  changes nothing (same `seq`, 3 models, 1 token).
- Read-only demo (owner decision 20): `apps/server/test/integration/demo-mode.test.ts` (real PostgreSQL
  and libraries: `nordwind-handel` seeded with its chain and worked by the simulation agent, then
  `grantDemoVisitor` and the read-only role with a random name; every registered write route
  answers 403 `demo-readonly` with the visitor's cookie, anonymously and with the seed token, and
  that set equals the contracts' write routes; unknown methods and paths too; nothing in the
  database changes; the session is the visitor and a viewer; every GET contract route answers 2xx
  over the read-only role, or 403 `insufficient-scope` beyond reading; a direct UPDATE as the role
  fails with SQLSTATE 25006, its statement timeout is 30 s; `/mcp` 404 for every method;
  credentials 401; local mode next to it unchanged). Unit: `demo-mode.test.ts` (health with and
  without the flag, byte for byte in local mode; the Host/Origin matrix and `/health` under any
  Host; every write route 403 with three credentials; case and encoding; MCP routes absent; HSTS
  and the `Secure` cookie), `config.test.ts` (every refusal, the origin forms, local mode
  unchanged), `policy.test.ts` (the visitor may only read), `demo-image.test.ts` (the demo
  Dockerfile's base images and pnpm equal the product's and the tests' PostgreSQL, the seed stage,
  the runtime stage copies no eval file, the demo .dockerignore keeps every exclusion of the
  product's, `fly.demo.toml` and the workflow's pins and skip). `apps/demo/test` (`pnpm --filter
  @analyzr/demo test`, a fake spawner and fetch): the seed's steps and environments, no secret in the
  log or on a command line, every failure stopping what it started; serve from a fresh copy,
  signal order, exit 1 when a child dies, the origins; the check against a fake demo and a
  broken one; the command line. Web: `test/demo-mode.test.tsx` (banner, projects page, tabs,
  notices without requests, inbox, held list, review screen without the decision panel,
  `errorMessage`). Playwright: `e2e/demo.spec.ts` against the demo image; the other specs skip
  on a demo server (`e2e/server-mode.ts`).
- `apps/cli`: `pnpm --filter @analyzr/cli test:unit` (commands against a fake REST API, owner key
  file checks, the MCP bridge against the SDK's in-memory `createMcpHandler`) and `test:e2e`:
  starts `node apps/server/src/main.ts` as a child process on a free port with its own database
  (Testcontainers, or `ANALYZR_TEST_DATABASE_URL`) and owner key, runs `analyzr seed`, `import`,
  `token`, `status` against it, and spawns `analyzr mcp` the way Claude Desktop does, talking to it
  with the SDK's `StdioClientTransport` in 2025-11-25 and 2026-07-28 (initialize, tools/list,
  `list_processes`), plus a revoked token, and since M4 S2 `analyzr value-chain push` of the golden
  dev chain (created r1, then `unchanged`), `pull` with a read token byte for byte, an agent
  token's push refused, an edited file refused without `--base`, saved with `--base r1` (r2),
  and the stale file on `--base r1` answered "pull first".
- `apps/web` (`pnpm --filter @analyzr/web test`, vitest on jsdom with Testing Library):
  `relation-table.test.tsx` (order, rule acceptances vs. key-tier proposals, labels, quick
  filters, filters, details, action slot, provenance), `connect-agent.test.tsx` (token list and
  states, creation with the request body, secret shown once, exact Claude Code command, Claude
  Desktop node/Docker configurations, generic client, revocation after confirmation, problem
  toast), `upload-panel.test.tsx` (folder paths, batches, per-file outcomes, skipped files, the
  picker's `accept` and „Erlaubt sind …“ from the file rule, warnings in a disclosure, a duplicate
  key failed before sending, a sidecar `.xml` skipped („gleicher Modellschlüssel wie …“, the
  heading naming every reason), a plain `.xml` that is no BPMN skipped, the warning toast when only
  such files came, the extractor's `too-many-warnings` entry after „… und 81 weitere“),
  `api.test.ts` (session on 401, one session for parallel 401s, problems), `lib.test.ts` (upload
  planning, snippets, slugs, refs, filters, provenance fallback), `app.test.tsx` (routes rendered
  on the server, incl. the inbox and the review screen), `theme.test.ts` (token drift) and
  `limits.test.ts` (constants and label maps against the contracts). Review (M2):
  `decision-panel.test.tsx` (accept with the seen version, A/R/H/C shortcuts, required reason and
  note, question and label only when given, shortcuts ignored while typing, Escape, the correction
  dialog with compatible candidates, search and the exact `correct` body, the 409 conflict message
  with both versions and paused shortcuts, other errors as toasts, obsolete and accepted
  relations, "Erneut annehmen" for a changed endpoint and none for a missing one, the correction
  candidates as one radio group with arrow keys, Cmd/Ctrl+Enter and a fresh start after
  "Abbrechen"), `bulk-accept-dialog.test.tsx` (every pair listed, generic and shared names, agent
  questions, agent no-links (two on one pair, HTML in a reason shown as text) and ambiguous call
  targets flagged and unchecked, the exact body with ids, versions,
  tier and `expectedCount`, select all/none with a dash for "some", 409 keeps the dialog open,
  after the reload a pair flagged now or changed since a deliberate check is unchecked),
  `held-list.test.tsx` (hold note, question, label, only answers after the hold, saving an answer
  as a note, also with Cmd/Ctrl+Enter, empty list), `review-screen.test.tsx` (the real router with
  a stand-in canvas: evidence switches the pane, refs into other models link to the model view,
  another relation by link or history starts without the previous one's evidence, a deleted
  endpoint model is named instead of loading), `review-inbox.test.tsx` (accepted relations with a
  changed endpoint in the queue and the tab count but not in bulk, held items of a model waiting
  for clarification, requeue of an expired lease, "Frage" and "Einwand" in the queue),
  `review-details.test.tsx` (hostile rationale as plain text, endpoints, question, provenance,
  clickable evidence refs vs. text, timeline order with the deciding entry and correction link; the
  no-link callout after the question with each entry, a hostile reason as text, an empty reason,
  none without no-links) and `review-lib.test.ts` (queue order and filters, held order, stage
  counts, neighbours, evidence parsing, conflicts, generic names and the bulk flags in order with
  the cut, endpoint roles and correction candidates, provenance from the API). Value chain (M4
  S3): `value-chain-lib.test.ts` (badge texts and open counts, the J/K order, drill-down targets,
  evidence kinds, step tree and pickers with `@outside`, impact summary and the confirmation rule,
  violation texts, link validation and the `analyzr:process` builder, the pre-check, kinds by colour,
  the re-confirm selection without removed steps and missing processes, ULID format and 10,000
  draws without a repeat), `drafts.test.ts` (keys, restore or download, quota and blocked storage
  swallowed), `chain-canvas.test.tsx` (the chain chunk with a stand-in renderer: no change event
  for an import, one per debounced edit, the pending change taken at once, the first fit under
  StrictMode and the view kept from view to edit mode), `value-chain-page.test.tsx` (the real
  router with a stand-in canvas: the empty state
  with the exact CLI command and the create flow's dry run plus `PUT If-None-Match: *` without a
  POST, the overview with findings, unplaced and `@outside`, `?placement=` and `?step=`, viewers
  without edit and decisions, the tab count and the inbox callout, drafts offered for restore or
  only download, violations listed, marked and selectable, a 412 that downloads the local copy
  and loads the newer revision or keeps editing; the S3 review fixes: a restored draft of a new
  chain staying dirty and stored, the draft dialog's focus and Escape with nothing cleared while
  it asks, "Fertig" and a link asking for an edit the canvas has not reported yet, an edit made
  during the save kept as a draft on the new base, no impact dialog for an unconfirmed slow save,
  "Zur Übersicht" and Escape with the focus back in the tree, the tree's roving tab stop, the
  active card scrolled into view, key hints only where the keys work, the name field keeping the
  focus, the focus in and out of "Prozess hinzufügen", closable import warnings),
  `placement-decision-panel.test.tsx` (accept with
  the seen version, A/R/H/C, required reason and note, the exact `correct` body without the own
  step, removed step and missing process limited to reject or correct, "Erneut annehmen", a 409
  pausing the keys, keys off without panel focus, other errors as toasts), `chain-save.test.tsx`
  (the save state machine: no-op, dry run then save with the same `If-Match`, `If-None-Match: *`
  for a new chain, confirmation and a save whose impact differs, 412, 422, 428, 413, unsupported
  version, `unchanged`, refusals before any request; the impact dialog and the violations panel),
  `link-editor.test.tsx` (three modes, picker search, a process applied only with "Übernehmen" or
  Enter while the held arrow keys write nothing, the focus kept through the canvas' echo, an undo
  taken over, clearing with `null`, validation), `bulk-reconfirm-dialog.test.tsx` (ids, versions
  and `expectedCount`, a 409 keeps the dialog open, removed steps listed apart, an unchecked
  placement staying unchecked at a new version), `step-view.test.tsx` (breadcrumb, sub-steps
  counted like the badges, own, subtree and reached-by-call with their links, one `h1`, the active
  tab, 404), `bundle.test.ts` (node environment, two production builds in memory with
  `NODE_ENV=production`, as `pnpm build` makes them: one `diagram-js`, one zod v4, one renderer
  and schema-model, the entry chunk free of them and of the chain page and step view, the entry
  ≤ 240 KB gzip (the owner raised the ceiling from 200 KB on 2026-10-10 at 199.8 KB used), no
  renderer rule in the main CSS, the chain-only code ≤ 40 KB gzip beyond the
  shared diagram-js chunk, with a printed breakdown), plus `app.test.tsx` (both routes)
  and `limits.test.ts` (every `MAX_VALUE_CHAIN_*`, the value chain constants and label maps). The
  tests stub `fetch` and talk through the real generated client; components with links render in
  a throwaway router (`renderWithRouter`).
- `apps/web/e2e/smoke.spec.ts` (Playwright, Chromium): creates its own project `e2e-<time>`,
  imports `eval/corpus/_sample` and walks projects → relations (rule acceptance, key-tier quick
  filter) → model view (endpoint highlighted in the caller, switch to the called model), re-imports
  the folder through the upload page (all `unchanged`), uploads a file with a duplicate element id
  and a plain XML (M6 S1: „1 Hinweis“ with the warning in its disclosure, the XML skipped),
  checks findings and creates a token. It
  needs a running server with the built UI and skips itself otherwise, so it is not part of
  `pnpm test` or CI:
  ```sh
  pnpm db:up && pnpm build && node apps/server/src/main.ts &   # or: pnpm docker:up
  pnpm --filter @analyzr/web exec playwright install chromium     # once
  pnpm --filter @analyzr/web e2e                                  # ANALYZR_E2E_URL=http://127.0.0.1:7400
  ```
- `apps/web/e2e/review.spec.ts` (Playwright, M2 review flow, same prerequisites): creates its own
  project from `eval/corpus/nordwind-handel` and an agent token, then as the agent over REST
  claims ten tasks, submits proposals for eight (built from the claim input's lexical candidates,
  with rationale, evidence, one question and one rationale carrying HTML; the first task with a
  `key` candidate also sends a typed no-link on it, answered `stored` and shown on that key-tier
  relation's `noLinks`), releases one and keeps one claimed. In the browser: the stage counts (22
  waiting, 1 working) and the holder of the claimed task; the review screen with both models
  imported and endpoints marked, rationale, provenance, an evidence ref marked "Beleg", J/K; A, R
  (reason, Ctrl+Enter) and H (note, question, label) with the stored status checked over REST; the
  held list with a saved answer; a correction and the linked timelines of both relations; the HTML
  rationale rendered as text (no element, no dialog) and a 409 conflict after a decision made
  meanwhile over REST; the agent's no-link as "Einwand" in the key-tier queue, as a flagged,
  unchecked row with its exact text in the bulk dialog and in the review screen's callout, the
  relation still `proposed`; the bulk accept of the key tier with flagged pairs left open (8
  tests). Every page is checked for CSP violations.
- `apps/web/e2e/pipeline.spec.ts` (Playwright, M2 end to end, same prerequisites plus the
  checkout's `apps/agent-sim`): creates its own project from `eval/corpus/nordwind-handel` and an
  agent token (read, propose), then runs `analyzr-agent-sim` as a child process over MCP until no task
  is left (every task submitted at attempt 1, nothing invalid; the five pairs the flow decides are
  proposed with the token's principal and client, `analyzr-relations` and `sim-policy-1`). In the
  browser: the phase chips of „Übersicht“ equal the models' stages (none waiting for the agent,
  some waiting for review, some incorporated), questions in the queue, the agent's provenance in the relations
  table; the review screen with the agent's rationale, question and provenance; A, R twice, H with
  a question and its answer in the held list; a correction of the dynamic call
  `Call_RechnungAusgeben` to `finanzen/briefversand` (a `manual` relation accepted, the proposal
  rejected); the bulk accept of the key tier with "Antwort" (generic) and both targets of the
  duplicate process id (agent question, ambiguous target) left open. Then decision memory: the
  modeler renames the start event of `finanzen/zahlungslauf` and uploads it again; the rejection
  touching it stays rejected with "Endpunkt geändert" and the model waits for the agent; the other
  rejected pair, proposed again over MCP (`propose_relation`), answers `suppressed` without a new
  version; `decide_relation` over MCP answers `human-decision-required` with a `reviewUrl` that
  opens the review screen; the agent's second run works only that model and reopens the changed
  pair (`reopened`, status `proposed`, timeline proposal → rejection → proposal), while the
  accepted and held relations of that model keep their status; the reviewer accepts it.
- `apps/web/e2e/value-chain-import.spec.ts` (Playwright, M4 S3, no analyzr server): starts Vite's
  dev server on `e2e/harness` (the renderer, schema-model and analyzr's canvas modules) on a free
  port inside the spec and checks in Chromium that the golden dev chain imports with 0 warnings
  and its 39 stored waypoint lists equal `layouter.layoutConnection` (rounded to 3 decimals like
  `serializeDocument`), that synthetic chains drawn with the modeling API (a row of sub-steps, a
  rake, a centred sub-step, a sequence with a bendpoint, assignments) round-trip the same way, and
  that analyzr's element factory never repeats an id while the renderer's own hands out `shape_1`
  again in a new session. `ANALYZR_E2E_VC_EXTRA=<path>` checks another chain with counts-only output
  (the owner's way to run the holdout chain, which S3 never reads); a relative path resolves against
  the directory pnpm was started in (`INIT_CWD`, `e2e/user-path.ts`), not `apps/web`.
- `apps/web/e2e/spec-render-import.spec.ts` (Playwright, M6 S3c step 1, no analyzr server; D2 (b) of
  M6 §8 "S3"): writes 50 seeded random renders of `analyzr-spec` into a temporary folder
  (`tools/integrate/test/spec-fuzz-write.ts`), starts Vite's dev server on `e2e/spec-harness`
  (bpmn-js's `NavigatedViewer` with its CSS, as the model view loads it) on a free port inside the
  spec, and checks in Chromium that every golden render of `tools/integrate/test/fixtures/spec/` and
  every random render imports with 0 warnings and 0 errors and that the element registry holds every
  participant, lane, flow node, data store, sequence flow, data association and message flow, a
  label's or plane's entry not counted as the element (2 tests, counts only; it takes no other
  folder).
- `apps/web/e2e/value-chain.spec.ts` (Playwright, M4 S3, a running server as for review): creates
  `vc-<time>` from `eval/corpus/nordwind-handel` with an agent token and `vc-empty-<time>`. The
  empty state with the CLI command, then a chain drawn in the browser and saved as r1 (nothing
  stored before); the golden chain pushed over REST (`If-None-Match: *`) with 34 steps, the rule
  tier's four badges, finding labels and 0 import warnings; agent proposals over REST reviewed in
  the panel (A, R with Ctrl+Enter, H with a question, C to another step; statuses over REST; an HTML
  rationale as text; `@outside` in the overview); a rename whose dry run lists the re-confirm, then
  the bulk re-confirm; a save over r3 saved meanwhile (412, the local copy downloads and parses, the
  page shows r3); a draft that survives a reload (kept while the dialog asks, Escape does not
  dismiss it, the focus on restore; still dirty and stored after the restore; then discard); a new
  chain drawn in `vc-sketch-<time>` and restored after a reload (still unsaved and stored a second
  later, "Fertig" asks, nothing stored); a name typed and left by clicking "Fertig" or the header
  link "Prüfen" (both ask); a step added, placed, deleted (stranded) and, after a reload, another
  added: a fresh `shape_<ULID>` that no revision had, the old placement `missing`, the new step
  empty; a `analyzr:process` link marked in the picker and applied with "Übernehmen", undone with
  Ctrl+Z, applied again by keyboard (Tab, Enter; the focus stays) and saved (the rule tier's key
  proposal under `analyzr-rules`, the double-click opens the model view), then cleared (no link stored,
  the proposal obsolete); the drill-down by double-click (breadcrumb, sub-step, a process to the
  model view, reached by call with the relation link); an unchanged re-import and a layout-only save
  (Shift+Arrow in the modeler, same `structureHash`; its PUT delayed by 1.5 s shows no impact
  dialog) keeping every placement's status and endpoint state; an agent's `decide_placement` over
  REST (403 with the `reviewUrl` that opens the page with the card active), and an `@outside` card
  scrolled into view; and the CSS check in both directions (computed styles and screenshots equal).
  Every page is checked for CSP violations. With `ANALYZR_SCREENSHOTS_DIR` it writes `m4-01` … `m4-08`.
- `packages/bpmn-facts/test/hostile.test.ts` also appends NUL, a right-to-left override and SOH
  to every text attribute of every corpus model and requires the same facts as for the clean
  file, with no control or bidi character anywhere in the result.
- `packages/bpmn-facts/test/corpus.test.ts` extracts every model of `eval/corpus` (no warnings
  allowed), checks that every `expected.yaml` endpoint resolves to a fact of a compatible kind
  and that the deterministic findings follow from the facts, and compares a fact summary per
  landscape with `test/__snapshots__/<landscape>.facts.txt`. After an intended extraction change,
  bump `FACTS_VERSION` and run `pnpm --filter @analyzr/bpmn-facts exec vitest run -u`.
- `packages/relations/test`: endpoint rules, the rule tier, candidates, text similarity and the
  baseline on hand-built facts (`test/support/facts.ts`), plus `_sample` end to end through
  `extractFacts`; since M6 S2b's follow-up step 1 the prepared index (`indexCandidates`) giving the
  same candidates as without it, on a synthetic landscape and for every focus model of `_sample`
  and `nordwind-handel` (the holdout left out).
- `pnpm eval:candidates` (`eval/tools/src/candidates.ts`, `landscape.ts`, `score.ts`,
  `report.ts`) scores every landscape in `eval/corpus` not starting with `_`. Gates per
  landscape: rule-tier precision 1.0 (unlisted pairs count as wrong in a closed world), no
  must_not_link accepted, ≥ 98 % of must_link pairs among rules ∪ candidates, findings
  `unresolved-call`/`dynamic-call`/`duplicate-process-id` equal to `expected_findings` (per ref;
  duplicates per group), and every expected `dangling-throw`/`unmatched-catch` found, each extra
  explained by a must_link/may_link of that endpoint. It also reports recall within rules ∪
  key/lexical candidates, per type and tag, and the same pairs for baseline-label/1. The report is
  deterministic; regenerate it after an algorithm change. The holdout landscape is scored but
  must not be tuned against: document a holdout-only miss instead (the report lists must_link
  pairs that only the `compatible` basis reaches). `eval/tools/test/candidates.test.ts` runs the
  gate and unit-tests the scorer.
- `pnpm eval:descriptive` (M6 S3a; `eval/tools/src/descriptive.ts`, `descriptive-context.ts`,
  `descriptive-score.ts`, `descriptive-report.ts`, `claim-estimate.ts`, the transforms in
  `lib/descriptive.mjs`) measures how much of the LLM-free relation finding survives descriptive
  models; no threshold, and an extractor warning on any variant fails it. Its results are in
  [M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §3.11.
  `eval/tools/test/descriptive.test.ts` covers the transform context (callees and partners from the model files), each variant on
  synthetic models (engine null with the call target kept; a C8 FEEL target taken for a static one
  by facts v1, pinned as a facts gap; collapsed subprocesses named after the callee, no
  `messageRef` or `signalRef`; message flows to black-box pools, a reused pool, two partners,
  start, boundary and end events kept; tasks; no documentation; determinism), every corpus model
  (a plain round trip keeps the facts; every variant extracts without warnings, with complete DI
  and every element id), the holdout redaction (`redactGrid` on synthetic grids, and every nested
  pair of the real holdout section, printing PASS/FAIL only) and a deterministic report. The
  server's unit test `claim-estimate.test.ts` requires `renderClaimInput` to render the estimate's
  bytes for every dev model.
- `apps/server/test/integration/mcp-contract.test.ts` is the MCP contract test (CONCEPT §8):
  the official SDK client over real HTTP with agent tokens against the real libraries on
  `eval/corpus/_sample`, imported into two projects. `tools/list` is a file snapshot
  (`__snapshots__/mcp-tools.json`, identical in 2025-11-25 and 2026-07-28; after an intended
  tool change run `pnpm --filter @analyzr/server exec vitest run test/integration/mcp-contract.test.ts -u`;
  `-u` takes an optional value, so a path right after it is not a file filter and every file runs).
  Every tool is called with valid input (the client validates `structuredContent` against the
  output schema), invalid input, and the other project's key and id and unknown ids (404). The
  credential matrix: no token, malformed, revoked (also for an open client) and expired tokens,
  the owner key and the owner session (401), every agent scope, a token cannot be created
  without `analyzr:read` or with `analyzr:review` (422) nor stored without scopes (check
  constraint), and a scope-less row, with the constraint dropped, gets 403 `insufficient_scope`
  on MCP and REST. `tools/list` uses no JSON Schema format but `date-time` and `uuid`.
- `apps/cli/test/live/stack.live.test.ts` (`ANALYZR_LIVE_URL=http://127.0.0.1:7400 pnpm --filter
  @analyzr/cli test:live`) checks a running, seeded analyzr as a user runs it: health, UI, OpenAPI
  and a foreign `Host`; agent tokens through `analyzr token create` in the container
  (`ANALYZR_LIVE_CONTAINER`, default `analyzr-server-1`; empty: the checkout CLI with the local owner
  key); MCP over HTTP in 2025-11-25 and 2026-07-28; `analyzr mcp` started exactly as both Claude
  Desktop entries say, with the environment of a macOS GUI app (`PATH=/usr/bin:/bin:/usr/sbin:/sbin`,
  cwd `/`), where a bare `docker` cannot be found; a revoked token refused through the bridge.
  Each path lists the token's project, all models, the accepted rule relations (compared with
  `eval/reports/candidates.json`), a process, XML and the procedure, and gets 404 for the other
  project. M2: the pipeline tools are listed, and deciding a proposed relation as an agent
  (`decide_relation` for accept, reject and hold, and REST `POST …/decision`) answers 403
  `human-decision-required` with `reviewUrl` = `<ANALYZR_LIVE_URL>/projects/<key>/review/<rel>`,
  changes nothing and that URL serves the UI. Its tokens are revoked at the end (they stay
  listed as revoked). Without
  `ANALYZR_LIVE_URL` it is skipped, so `pnpm test` never touches a running stack.
- `apps/web/e2e/screenshots.spec.ts` retakes `docs/screenshots/0*.png` from a running,
  seeded analyzr (`ANALYZR_SCREENSHOTS_DIR`, see Commands). It creates a token named "Screenshot",
  blanks every full secret in the page before each screenshot, and revokes the token afterwards.
  `review.spec.ts` writes `m2-01` … `m2-07`, `pipeline.spec.ts` `m2-08` … `m2-12` into the same
  directory when `ANALYZR_SCREENSHOTS_DIR` is set.
- M4 S0 (value chain packages, no Docker): `apps/server/test/unit/value-chain-schema-model.test.ts`
  parses both golden chains in `eval/value-chains` with `@miragon/value-chain-schema-model`
  (`loadDocument`, `parseDocumentJSON`, `validateDocument`) and requires `serializeDocument` to
  reproduce the committed bytes (since one chain is the holdout's, a failure names the first
  differing line, or the function and error class, never an error message), checks that the
  package rejects a newer `schemaVersion`, duplicate ids and unknown endpoints, and that its
  `zod`, resolved from the package's real path as Node loads it, is the server's zod package
  (not `instanceof`, which zod v4 answers by trait name for any copy). `runtime-pins.test.ts`
  holds the dependency specifier guard and the one-version lockfile check
  ([Conventions](#conventions)), with a self-test of the forbidden forms.
  `eval/tools/test/value-chains.test.mjs` runs `validate-value-chains.mjs` in both modes and
  requires every landscape ok and the built-in copy's agreement with the pinned package version
  (a failure shows the summary lines only, not the holdout's findings).
- M4 S1 (value chain storage and placements): unit `status-subjects.test.ts` holds a golden
  sha256 over the relation results (`recomputeStatus`, `currentStances`, `decisionsInForce`,
  `classifyProposal` with and without a basis and under an appended hold, `endpointState`) of
  2,000 seeded random histories from `test/support/status-histories.ts`, computed on the code
  before the generalisation: a change means relation behaviour changed. The same histories mapped
  to placement form give the same status, tier, confidence, basis and classification;
  `placementEndpointState` covers `@outside` and tombstoned generations. `value-chain-steps.test.ts`:
  generations (first revision, removal, a returning id, org units ignored, delete, revival, `@`
  ids refused, deterministic order); `placements.test.ts`: the tier precedence (no key-match
  input for agents). Integration
  `value-chain.test.ts` (synthetic chains from `test/support/value-chain.ts` and the dev
  landscape's golden chain, never the holdout's): revisions (rev 1, `unchanged`, rev 2 tombstones
  and withdraws the agent and rule proposals on the removed step under their proposers, caused
  by the saving human, so a proposal-only placement turns `obsolete` without an endpoint event
  while an acceptance stays `missing` and can then only be rejected, not accepted or held, and no
  new proposal lands on the dead generation; rev 3 re-adds a step as generation 2 while its old
  placement stays `missing`, a layout-only save), deletion and revival (same `vch_`, `rev`
  continues, new generations, the live proposals withdrawn, no placement comes back), the
  canonical bytes and their hash, refusals (agents, a second chain, another key, a foreign base
  revision, `@` ids), the lifecycle (proposal, duplicate, acceptance, `changed` after a rename,
  re-confirmation, rejection with a required reason, `suppressed`, `reopened`, hold, a pipeline
  judgement under the hold, note, withdrawal to `obsolete`), `correct` linked both ways, manual
  placements incl. `@outside`, `@outside` proposals without a reason refused, the rule tier's key
  proposals recorded as `rule` under `analyzr-rules` (and `key` refused for any other source), a
  deleted model making the process side `missing`, the
  repositories' listings (revisions newest first, placements by filter in code point order and
  by cursor, nothing from another project), dense and typed events; every chain and placement write leaves relations, their assertions,
  no-links, tasks, findings, models and `model_pipeline` unchanged. `db-constraints.test.ts`:
  append-only `value_chain_revision` and `placement_assertion`, tombstone-only `value_chain_step`,
  humans-only revisions, the `placement_assertion` checks (agents and rules never decide, notes by
  humans, verdict, basis pairing, no `rule` tier, linked placement), one live generation per id,
  the composite foreign keys (head and base revision of another chain, a placement on another
  chain's or project's generation or on none) and the deferred submission reference.
- M4 S2 (value chain and placements over REST, MCP and CLI; synthetic chains and the dev
  landscape only, never the holdout's files). Unit (no Docker): `value-chain-document.test.ts`
  (every violation reason with its ids, the version before zod, each cross-field violation also
  refused by `loadDocument`, canonical bytes equal `serializeDocument(loadDocument(x))`;
  geometry at and beyond the limits, a structure re-read after clearing the cache equal to the
  prepared one, canonical text that does not load again refused with its path; the limits
  first, an 8,000-step hierarchy chain refused in milliseconds, a chain at the limits checked
  quickly, and the hierarchy and sequence rules equal to a reference copy of their first,
  quadratic version on 400 seeded random graphs), `domain-utils.test.ts` (the `int` cursor
  kind),
  `value-chain-structure.test.ts` (kinds incl. colour variants and inheritance, ranks,
  fingerprints, `structure_hash` invariant under layout and sensitive to ids, links,
  connections and recolouring into another kind, owners, link kinds, the LRU, the golden dev
  chain against `expected-placements.yaml`), `value-chain-impact.test.ts`,
  `placement-items.test.ts` (the reason order, `@outside`, evidence forms, the step limit,
  tiers), `placement-tiers.test.ts` (the stem rule equals the dev placements' `name-match` and
  `semantic` tags), `value-chain-rules.test.ts` (links, equal names, pasted links, unknown and
  malformed links, stable rationales; every rule proposal of the golden dev chain with the dev
  models' real facts is a `must` or `may` step), `value-chain-findings.test.ts` (states,
  `@outside`, removed steps, callers, topmost steps, unresolved links, order), `etag.test.ts`,
  `packages/relations/test/placement.test.ts` (the baseline's weights, ties, top 3, votes,
  leave-one-out and `@outside` on synthetic chains; the README's stem examples), contracts
  (statuses 412/428, outcomes, `CreateValueChainBody`, bulk refinements, `valueChainPath`, the
  value chain routes and components, findings apart from `FindingKind`). Integration (real
  PostgreSQL): `value-chain-api.test.ts` (create by name and by the golden content, ETag and
  bytes, 428, 412 with `headRev`, `unchanged` with a stale tag, a dry run that writes nothing,
  layout-only saves, renames to re-confirm, removed steps with stranded and withdrawn
  placements, `If-None-Match`, refused documents, 413, 415, agents refused with `reviewUrl`,
  revisions, `rev` and crafted cursors beyond the `integer` column (422), concurrent saves on
  one `If-Match` and concurrent creates (exactly one wins, 412 or 409 for the other, dense
  `seq`; a mutation that takes the lock after the check fails them), the drill-down incl.
  reached-by-call on the dev landscape), `placements-api.test.ts`
  (every invalid reason, tiers, the step limit, duplicates in a request, every decision with
  versions and `If-Match`, obsolete and removed steps, bulk with every mismatch, manual
  placements, notes, timeline, withdrawal, filters and paging, unplaced processes, token
  revocation, dense typed events, the relation side unchanged), `value-chain-rules.test.ts`
  (rule proposals on create, nothing written by unchanged and layout-only saves, withdrawn after
  a rename and proposed again, a kept link re-asserted on the new anchor, the events of both
  renames pinned (no `endpoint_changed`), pasted links, an accepted proposal kept and sent to
  re-confirm with its `endpoint_changed` under the saving human, a rejected one suppressed and its process
  unplaced again, token revocation leaving rule proposals alone, a deleted process withdrawn
  and proposed again on re-upload, a removed step, findings with callers and unresolved links),
  `value-chain-ingest.test.ts` (real libraries, `nordwind-handel` with its golden chain: the
  four rule proposals are must steps, an accepted placement `changed` after a process rename,
  `missing` after the model's deletion and `ok` again, a rule proposal withdrawn and back with
  the process name, unchanged re-imports and layout-only model and chain revisions moving
  nothing, relations and findings exactly those of `eval:candidates`), `policy.test.ts` (every
  value chain route × owner session, owner key, read/propose/write tokens, foreign project,
  anonymous), `mcp-contract.test.ts` (the six tools in both protocol versions with valid,
  invalid and foreign input, `rev` beyond 999,999,999; a read token on `propose_placement`;
  `decide_placement`), and S1's
  `value-chain.test.ts` on the real `prepareRevision` (a model deletion refreshes placements
  itself now). CLI: `apps/cli/test/unit/value-chain.test.ts` (push and pull against the fake
  API: create, a save refused without `--base`, If-Match on `--base`, the head moved between
  pull and push ("pull first"), `--force` on the head and not with `--base`, `unchanged`,
  `--dry-run`, the `--yes` gate, 412, 422 with violations, agent token and bad files refused
  before any request, verbatim pull with `--rev` and `-o`) and the e2e round trip above.
- M4 S4 (the placement eval, seeding, German texts; synthetic data and the dev landscape, the
  holdout only through aggregate gates): `eval/tools/test/placements.test.ts` (every scored
  landscape passes its gates, gate messages with titles and counts only, no assertion on a
  property of the holdout's data; two runs render the same bytes; the holdout JSON has no
  per-item fields, no rule tier numbers and no per-tag numbers of a tag with fewer than 5
  processes, and its Markdown section no rule rows or cells and no such tag rows, checked
  without naming a tag; the dev rule proposals, the frozen baseline's top-1 counts and its
  level-0 trap numbers; the dev chain's steps, parents and content hash; a missing golden
  directory exit 1 and usage errors exit 2; every class on a synthetic chain incl. a trap
  subtree, `coarse` and `@outside` as must and may; recall@1/@3, precision, level 0, `none`,
  trap rate (at level 0 over top-level must_not only), tags; the gates failing on a coarse, trap
  or unlisted rule proposal, a missing or extra process and a validator exit 1; leave-one-out;
  an unranked set with confidence as S5 passes it; redaction, a holdout tag with 5 processes
  kept). `apps/server/test/unit/value-chain-golden.test.ts`:
  `prepareRevision` accepts every golden chain and keeps its bytes (a failure names violation
  reasons with counts, never ids). `packages/relations/test/placement.test.ts`
  (`derivePlacementRules`), `rules.test.ts` and `text.test.ts` (German finding details,
  `quoteDe` with quotes verbatim and invisible characters escaped); the server's rule, findings
  and chain tests with the German strings;
  `value-chain-ingest.test.ts`: a placement proposed with `propose_placement` over the MCP SDK
  client and an agent token, accepted over REST, survives an unchanged re-import and a
  layout-only re-save (the M4a criterion over MCP). CLI: `seed-status.test.ts` (`--value-chains`
  against the fake API: created, unchanged, differs without a non-dry save, revived, 412 read
  again, 422, `_sample` without a chain, the JSON shape, option misuse, `--help`) and the e2e
  test (`analyzr seed nordwind-handel --project vc-seed --value-chains` → created r1 with exactly
  the four rule proposals; after the push test's r2, `differs`). The agent-sim recordings were
  re-recorded for the German finding details (only `input.bytes` changed).
- M4 S5 (the placement pipeline; synthetic data and the dev landscape, the holdout only as
  counts and digests): `apps/server/test/unit/placement-pipeline.test.ts` (input hash, open and
  due processes, the caps and the byte budget, the supersession plan, rendering, the task view)
  and `test/integration/placement-pipeline.test.ts` over REST and MCP (every queue trigger and
  non-trigger, one open task per chain, the default kinds of claim and pending, claim, submit,
  release, lease expiry and late submits, `wrong-task-kind`, the item and unsure checks, the
  verdict memory, supersession, saves during a lease, 60 synthetic processes with exactly one
  follow-up and none without progress, revocation and withdrawals, revival, ad-hoc verdicts and
  `judged`, every stage); additions to `db-constraints.test.ts` (subject checks, both open-task
  indexes, `placement_input`), `claim-input-size.test.ts` (both landscapes' placement claims, the
  holdout as counts), the contract and MCP prompt tests;
  `test/unit/placement-procedure-text.test.ts` (the procedure's drift test);
  `agent-sim.test.ts` with the golden chains (above); `@analyzr/procedures`
  (`procedures.test.ts`: both procedures, `kind`, the prompts folder, the draft prompt's rules and
  skeleton; `wrappers.test.ts`: the placement claim call, the relations text unchanged,
  `renderAdHocWrapper`; `plugin.test.ts`: `RELEASED` per procedure id and `PLUGIN_RELEASES`);
  agent-sim (`placement-policy.test.ts`, placement recorder lines, the loop with both kinds and
  `--kinds`); eval/tools (`placements-replay.test.ts`: union and ranks, outcomes, the
  comparability check, holdout redaction, the report sections, the placement gate, the committed
  recordings with no holdout ref in their section; `live-placements.test.ts`: the reader with the
  revision listing, the command with incomplete, passing and failing gates, an edited chain
  refused); web (`value-chain-page.test.tsx`: Import visibility for reviewers and viewers, the
  file errors, the confirmation, dirtiness and draft, a new chain from a file with `If-None-Match:
  *`, the stage line and „Agent unsicher“; `chain-canvas.test.tsx`: the re-layout with a stand-in
  renderer, no change reported, none in view mode; `chain-save.test.tsx`: the impact lists scroll
  inside the dialog); Playwright `e2e/value-chain-draft.spec.ts` (needs a server and starts the
  import harness itself) and `e2e/value-chain-agent.spec.ts` (needs a server: the dev landscape
  with its golden chain waits for the agent with every open process due; `analyzr-agent-sim --kinds
  placement` as a child process works the placement task; the panel shows „Wartet auf Prüfung“,
  „Agent unsicher (n)“ with the reasons as text and „Platzieren“ with the manual form; writes
  `m4-14`; then a reviewer's rejection leaves one process due without a task and „Aufgabe
  einplanen“ queues it); the server's `draft-prompt-skeleton.test.ts` (the `draft_value_chain`
  skeleton passes `prepareRevision` and shares no step id or name with the dev golden chain; its
  limits, reserved id and kind colours follow the contracts, its tool calls the MCP snapshot).

- Auto-accept rules (owner decision 19). Server unit: `auto-accept-evaluate.test.ts` (every
  criterion incl. the inclusive boundary, first match by creation order, an author no longer
  owner; every safeguard for relations and placements and their order), `auto-accept-status.test.ts`
  (a revoked decision is not in force, a later human decision is untouched, property tests against
  the old implementation, the golden digest unchanged), `auto-accept-preview.test.ts` (firing
  point, outcome mapping, rule decisions no ground truth, no-link liveness by seq, the curve, the
  benchmark), `auto-accept-rules.test.ts`, `placement-pipeline.test.ts` (`lastNonAgentSeqs` skips
  marked rows). Server integration: `auto-accept.test.ts` (relations and placements through
  submissions and ad-hoc proposals, results reported before rules, no rules = byte-identical,
  judge-once after an acceptance, revocation to `proposed` and `obsolete`, apply and revoke with
  dry runs and 409, edit = new revision, 412/428, token revocation, endpoint change and step
  rename, seeds without rules), `migration-auto-accept.test.ts` (0009/0010 on a database with
  data), additions to `db-constraints.test.ts` (append-only rule tables, the checks, the marker
  foreign keys) and `policy.test.ts` (every rule route by role, scope, foreign project,
  anonymous); MCP snapshots and the agent-sim recordings unchanged. CLI: `test/unit/rules.test.ts`
  (percent parsing, agent resolution, the edit merge, If-Match and 412, dry run then `--yes` with
  `expectedCount`, 409, JSON, an agent token refused, a 403 reported) and the e2e `analyzr rules
  (owner decision 19)` in `cli.e2e.test.ts` (add → preview → enable → apply → revoke → disable
  against a real server, an agent token's 403). Web: `auto-accept-lib.test.ts` (ledger join,
  `auto` filter, German numbers and texts), `rules-tab.test.tsx` (the dialog's fields per kind,
  validation, the debounced preview, create, edit with If-Match and 412, German 422 texts; the
  table's toggle and 412; the system rule; apply and revoke dialogs with dry run, `expectedCount`
  and 409), `auto-accept-marks.test.tsx` (relation table and filter, queue „widerrufen“, timeline,
  provenance with single-item revoke, placement card, the token revoke checkbox), `app.test.tsx`
  (the tab for owners only), `limits.test.ts` (the copied constants, the label maps); Playwright
  `e2e/auto-accept.spec.ts` (needs a server: the tab, a rule with its live preview, enable, apply,
  marks and filter, provenance, revoke back to „Prüfen“, a placement rule's mark on the chain
  page; writes `d19-*.png`). Eval: `auto-accept-whatif.test.ts` (relations per tier with the
  offline safeguards on `_sample`, placements on a synthetic chain, holdout redaction and the
  secondary suppression, determinism, the report sections).
  The review fixes added: a revocation leaves a later stance of the rule's author
  (`auto-accept-status.test.ts`, and end to end with an endpoint change and the owner's proposal);
  the preview's counterfactual (X→A then X→B, S1 then S2, each at two minimum confidences); editors
  read the ledger but not the rules, viewers neither, agent tokens get `human-decision-required`;
  taking over a rule whose author lost the owner role (412 first, then `revised` once, then
  `unchanged`, then apply); the 409 reasons of apply; another agent's `unsure` row survives an
  ad-hoc proposal, and the preview and the dry run count 0 with `agent-unsure`; the CLI's apply on
  a rule that is off or whose author is no owner, the take-over by `edit`, the schema's `errors`,
  thresholds with every decimal; the web dialog's 412 reload (the form shows the newer revision and
  what changed), a threshold kept unless edited, the take-over hint, marks for editors and none
  for viewers, the single-item revoke for owners only, outcome-aware revocation texts, the
  per-agent revoke, the rules table's numbers; the what-if in recording order (a later competing
  call or step and the agent's later no-link or re-judgement do not undo an acceptance) and the
  holdout's threshold differencing.
- M6 S1 "Import hygiene": `packages/contracts/test/paths.test.ts` (the moved key cases plus `.xml`,
  `.BPMN`, `.bpmn20.xml`, hidden files, `isHiddenPath` apart from `bpmnSuffixOf`, `comparePaths`
  apart from the locale, `modelKeyOwners` giving a key to a `.bpmn…` file before a plain `.xml`,
  `keyTakenBy` naming that file only for a plain `.xml`)
  and additions to `contracts.test.ts` (`ExtractWarning`, the optional result fields, `warningCount`
  ≤ 101, OpenAPI); server: `domain-utils.test.ts` (`resultWarnings`: cap 20, the 300-character cut
  with `…`, surrogate pairs, the `too-many-warnings` entry listed last) and `real-libraries.test.ts` (real libraries: a duplicate element id in a revision gives
  `revised` with one `parse-warning`, a 400-character id that is no NCName a message cut to 300,
  PUT the same, warning-free and `unchanged` results without the fields); CLI:
  `test/unit/import.test.ts` (`.xml` picked up, hidden files and links skipped, keys derived before
  sending with a duplicate across two batches never sent, `Order.xml` + `order.bpmn` (the `.xml`
  skipped `key-taken`) and `a-b.bpmn` + `a_b.bpmn` with the web's winners, a sidecar
  `Prozess.xml` next to `Prozess.bpmn` skipped `key-taken` with exit 0 and the model sent once,
  two plain `.xml` with one key still failed, the summary naming one or both reasons, a
  `not-bpmn` `.xml` skipped with exit 0, only such files with exit 1, and a `doctype-forbidden`
  one failed with exit 1, warnings in text,
  `--verbose` and JSON, also beyond 100, the waiting tasks paged past 200 and the next step only
  for what waits), `test/unit/models.test.ts` (`models list|requeue|delete`: paging, stage check,
  bodies, outcomes, an agent token refused for delete before any request, nothing deleted without
  `--yes`, an unknown key before deleting, `--json` after a failed DELETE) and the e2e
  `analyzr import and models (M6 S1)` (with a sidecar skipped) plus the pin that `seed --json` for
  `_sample` keeps exactly `project`, `files`, `counts`; web: `lib.test.ts` (upload plan with `.xml`, hidden files, `not-bpmn`,
  duplicate keys, a sidecar `.xml` skipped `key-taken`, the CLI's winners, the skip reasons in
  German; the code labels, the warnings beyond 100),
  `upload-panel.test.tsx` and `bundle.test.ts` (above), Playwright
  `smoke.spec.ts` (the warnings display).
- M6 S3a and S3b: `eval:descriptive` (above); server: `test/unit/claim-estimate.test.ts` and
  `test/integration/landscape-size.test.ts` (`get_landscape` over Streamable HTTP with an agent
  token on `nordwind-handel`, seeded and after the simulation agent's relations tasks; prints the
  sizes and requires < 100 KB, M6 §6); `tools/integrate/test` (`pnpm --filter @analyzr/integrate
  test`, 145 tests): `normalize.test.ts` (every output, the fixture's included, extracts with
  `@analyzr/bpmn-facts` without `missing-id`, `invalid-id`, `duplicate-id` or an id
  `parse-warning`; references follow rewritten, duplicate and added ids; UTF-16 and Latin-1, the
  size limits and the compact rewrite, unknown entities), `ids.test.ts`, `xml.test.ts`,
  `encoding.test.ts`, `csv.test.ts`, `inspect.test.ts` (deterministic, read-only, markers, zips),
  `keymap.test.ts` (tool id before path, copies, generic ids, moves and renames, `--existing`,
  scope, exclusions, reset), `bundle.test.ts` (the golden bundle, a re-export with a moved folder
  keeping its keys, `CONVERTER_OUTPUTS`), `cli.test.ts` (the entries as the plugin runs them: exit
  codes, short stdout under 20 KB for 200 models, `--json-out`, the guards against writing into the
  export or a checkout), `drift.test.ts` (the bundled scripts and notices match a fresh build,
  import Node built-ins only, name no local path and run copied away from `node_modules`) and
  `plugin.test.ts` (manifest, skill frontmatter, the printed commands, `RELEASES`); CLI:
  `test/unit/integrate-bundle.test.ts` (`analyzr import <bundle>` sends every model under the key
  the golden bundle pins and leaves the manifest out); web: `test/integrate-bundle.test.ts`
  (`planUpload` on the golden bundle gives the same keys, `analyzr-import.json` skipped as
  `not-bpmn`); `packages/procedures/test/plugin.test.ts` pins the marketplace with both plugins.
- M6 S4 "Open questions": server `test/unit/open-questions.test.ts` (25 tests on the real
  libraries, helpers in `test/support/open-questions.ts`: `nordwind-handel` as imported (its
  findings and black-box pools, new ids exactly for a model whose facts changed), the signal
  counts on the dev models and eval:descriptive's variants plus why `message-without-name` stays
  off, every source of §4.1 on a synthetic landscape with kind, subject, text, raiser and
  `unlocks`, ids across reads and source changes, filters, order and cursor pages, the Markdown
  and CSV export with formula protection and the CSV read back, no-link codes, and the review
  fixes: message-flow ends inside subprocesses, lanes of subprocesses, signal findings, prototype
  keys, unreachable holds and questions, a question answered by a later rejection, every step
  owner, `unlocks` 0, placement batches, the candidate cache, autolinks, the file name) and
  `test/integration/open-questions.test.ts` (real PostgreSQL: every finding of the seeded project
  mapped, stable across reads, page sizes and a read-only token, the filters and a 422; then the
  simulation agent, two holds, a model change and a probe agent: every source, ids changed with
  their source, both exports; it prints the counts per kind); CLI `test/unit/questions.test.ts`
  (every page read with any credential, the table and the count by kind, the filters passed and
  named, `--format json`, `-o`, the CSV verbatim with its byte order mark, `md` and `markdown`, a
  bad format, kind, source or model refused before any request, the server's problem), `program.test.ts` (`questions` in the
  help) and the e2e `analyzr questions (M6 S4)` (a read-only token on `vc-seed`: the seeded counts,
  order, `--model finanzen`, `--ask-who` as CSV against JSON, the CSV via `-o`, the Markdown with
  `--kind black-box-partner`); web `open-questions.test.tsx` (the tab after „Befunde“ with its count, the
  server's order, „Keine offene Entscheidung“, human and agent texts as plain text with who said
  them, the links, filters in the URL and the reset, 50 at first, both exports byte for byte and a
  failed one, a viewer on the demo, the model view's section),
  `open-questions-lib.test.ts` (filters as the server's, facets, links, file names, the labels
  equal to `@analyzr/contracts/open-question-labels`), `limits.test.ts` (a label for every kind,
  source and state), `bundle.test.ts` (the page, its components and labels outside the entry,
  the route chunk) and `demo-mode.test.tsx` (the tab for the demo's viewer and for owners); Playwright
  `e2e/open-questions.spec.ts` (6 tests, its own project from `nordwind-handel` with an agent's
  HTML question and summary, a hold and the golden chain: the count, order and every filter
  against the API, combined filters in the list and the export, plain texts, the links to the
  review screen, the chain page and the model view, both downloads, the model view's section) and
  one test in `demo.spec.ts` (the tab, the CSV export and the model view's section on the demo,
  no write action).
- M6 S5a "Answers recorded": contracts `test/answers.test.ts` (the sheet reader with spreadsheet
  row numbers, `normalizeAnswerText`, the personal-data check with its pinned cases); server
  `test/unit/open-questions.test.ts` ("answers on the items": `state` and `answers`, an item
  opened again when its source changes, both exports and the sheet read back, the latest-answer
  rule; "where an answer lands" on a stand-in transaction; humans only; the order with the value
  chain's findings after the other questions), `test/integration/open-question-answers.test.ts`
  (real PostgreSQL: an answer on a held relation as a human note linked by one row with nothing
  queued, a subject answer kept until its source changes, a sheet previewed without storing and
  then stored in one call, humans only and current questions only, the table append-only,
  humans-only and one text per answer), `placement-pipeline.test.ts` (an answer to an agent's
  placement question as a note that makes the process due; an answer to a held placement: the
  hold stays, `due` unchanged, `requeue` `nothing-due`), `migration-auto-accept.test.ts` (0009–0012
  on a database with data, answers on an existing relation and placement) and
  `claim-golden.test.ts` (the claim inputs of a freshly seeded `nordwind-handel` by SHA-256
  against `__snapshots__/claims-nordwind-handel.json`, taken on the code before S5a, also with a
  text answer on every subject that is neither a relation nor a placement); CLI
  `test/unit/questions-answer.test.ts` (17 tests against a fake API) and the e2e `analyzr
  questions answer (M6 S5a)` (its own project `answers-e2e`: an agent token refused, a relation
  answer as a note, `unchanged` on repeat, a subject answer with the personal-data warning, a
  sheet's dry run, real run and rerun, a full export read back as `unchanged`, the `[answered]`
  marker); web `open-questions.test.tsx` ("answering (M6 S5a)" and „Antworten aus CSV
  übernehmen“: the dialog, the live region, the focus fallback, the earlier-answers note, the
  file name, an ANSI file refused without a request, readable unknown rows, the left-out rows
  after storing), `open-question-answers-lib.test.ts` (16 tests: texts, the sheet reader, the
  preview), `limits.test.ts` and `bundle.test.ts`; Playwright `e2e/open-questions.spec.ts` (5 more
  tests, 11 in all: the held relation and the held placement answered, the Status filter against
  the API, an answer in the model view's section, the CSV filled in and taken back) and
  `demo.spec.ts` (neither button on the demo).
- M6 S5c-1 "Actions": server `test/unit/open-question-actions.test.ts` (9 tests on a synthetic
  landscape from `test/support/open-questions-synthetic.ts`: every kind's actions with at most
  one primary and a note on every question; R1 for calls and pools, by the direction a link
  takes and never a call for a pool; an `unjudged` pair ended by an accepted relation between
  its refs; R1b; what a link writes per anchor and which proposals a suggested process accepts),
  `test/unit/open-questions.test.ts` (items versioned by what they ask about; `answered` only
  while a live outside mark names the item; both exports with notes and marks, the five-column
  CSV; an S5a sheet's `Antwortart`), `test/unit/auto-accept-preview.test.ts` (a human's manual
  link from the call element blocks an agent's call to another target now and as of its
  proposal, the same target passes), `test/integration/open-question-actions.test.ts` (11 tests,
  real PostgreSQL on `nordwind-handel`: a manual relation with the rationale from code, a live
  agent proposal accepted instead, an owner's rule kept from a call that competes with a human's
  link, „Rückgängig“ bringing the item back, a pool's flows, placements also on `@outside`, a
  placement on an agent's proposal reported as its decision, the valid copy all or nothing, an
  external-partner mark across a re-judgement, refusals), `open-question-answers.test.ts`
  (notes leave items open, the outside mark and its withdrawal, marks and CSV ids across a change
  elsewhere in the model, the five-column sheet, an S5a sheet, humans only, both tables
  append-only) and `claim-golden.test.ts` (the seeded claims byte-identical after a note and an
  outside mark on every subject that is neither a relation nor a placement); CLI
  `test/unit/questions-act.test.ts` (18 tests against a fake API: `outside` with `--undo`, `link`
  with refs, names, model keys, several targets and `--pair`, `place` on a step, on `@outside`
  and for a step item, agent tokens and flags refused before any request, `resolveTarget`),
  `questions-answer.test.ts` and `questions.test.ts` (notes without kinds, the action column and
  the suggestions in the list) and the e2e `analyzr questions outside|link|place (M6 S5c-1)` (2
  tests: link, place and mark as a human, agents refused; an S5a sheet read back); web
  `open-question-actions.test.tsx` (30 tests: every action type in the tab with its picker,
  panel, toast and „Rückgängig“, the focus rules, the model view's section, „Verknüpfen mit …“
  on a collapsed subprocess, nothing for a viewer), `open-question-pickers-lib.test.ts` (5 tests:
  the pickers' options, what an action writes and undoes, refusals in German),
  `open-questions.test.tsx`, `open-question-answers-lib.test.ts`, `limits.test.ts` and
  `bundle.test.ts`; Playwright `e2e/open-questions.spec.ts` (10 more tests, 21 in all: every
  action type in the tab, a pool linked to a suggested process, the valid copy, the outside mark
  and the Status filter, a requeue, notes from the CSV also with S5a's `Antwortart`, the model
  view's section acting in place, „Link korrigieren“ and the collapsed subprocess) and
  `demo.spec.ts` (no action and no note button on the demo).
- M6 S5c-2 "Model amendments": bpmn-facts `test/amend.test.ts` (every op on hand-written C7 and
  C8 fixtures in the Camunda Modeler's layout and on engine-null documents as `Extraction.call`
  reads them; shared messages, created messages and signals; a Signavio-style export byte for byte
  outside the spliced ranges, BOM and CRLF included; escaping; files declared `ISO-8859-1`,
  `US-ASCII` or `windows-1252` written as pure ASCII; a new message before a trailing
  `relationship`; refusals; the check; determinism; regression snapshots of both fixtures, and a
  dependency-free check of the BPMN XSD's child order (`test/support/xsd-order.ts`) over them and
  over every Modeler-written corpus model, holdout excluded) and `test/xml-elements.test.ts`;
  server `test/unit/amendments.test.ts` (planning, the concurrency token, which fields may be set,
  request items, the effect, the conflict questions with their actions, „Meine Ergänzung
  behalten“ only over a value that does not resolve, the change list) and
  `test/integration/amendments.test.ts` (real PostgreSQL: amended heads with the plan, decision 9
  on an amended call, the dry run's cost, partners, re-imports, conflicts, the race with an
  import, withdrawals with `If-Match` and their dry run, deletion and revival, the change list and
  both downloads, a revert after a withdrawal that left nothing to apply, a value equal to `after`
  as the only amendment, the tables append-only), `demo-mode.test.ts` and the
  `open-question-*` tests; CLI `test/unit/amend.test.ts` and `amendments.test.ts` (fake API:
  `models amend`, `questions amend`, `models pull`, `amendments list|export|withdraw` with `--rev`,
  agent tokens refused) and the e2e `analyzr models amend|pull, questions amend and amendments`;
  web `test/amendments.test.tsx` (the form at a question with its dry run, „Sammeln“ and the bar,
  conflicts with both values and the withdrawal's cost, the model view's section with its focus
  rules, history and withdrawal, the badge and downloads, the models table's mark) and the bundle
  guard; Playwright `e2e/amendments.spec.ts` (5 tests).
- M6 S2a "Provenance, manifest, stable identity": server `test/unit/provenance.test.ts` (the
  golden manifest of `tools/integrate`, also with a byte order mark; every refusal, among them a
  NUL or a lone surrogate in an identity field or the link, credentials in the link and a blank
  `llmModel`; a newer converter's loss code and odd informational fields stored tidied; the
  source fields; each import warning, also against earlier files of one request; the
  `external-ids` list; `extractor-loss` on synthetic extractor output: duplicate and illegal ids,
  an unknown element, a process lost with its content, an id cut with its message, „mindestens“
  after 100 warnings, no duplicated diagram shape or vendor element; the change list's origin
  line) and `open-question-actions.test.ts` (the note as `extractor-loss`'s only action);
  `test/integration/provenance.test.ts` (real PostgreSQL: the golden bundle with its manifest and
  the key map rebuilt from `external-ids`, pinned keys, the import warnings (since M6
  S2b's follow-up step 5 none after a folder move, below), PUT with `Analyzr-Manifest`,
  unchanged bytes, an upload
  without a manifest keeping the identity, unstorable values refused with 422 and nothing
  imported, an amended head following `source.upstream` also in the change list's Markdown,
  `extract_warnings` written at insert, `extractor-loss` dropping after a clean export, migration
  0017 on a database that holds a revision) and `corpus.test.ts` (every corpus revision stores
  `[]`, no `extractor-loss` item); contracts `test/paths.test.ts` (pinned keys in the key owner
  rule); CLI `test/unit/manifest.test.ts` (reading and checking the manifest, the stored and kept
  counts, no project created with `--create` for an invalid manifest, bundles in subfolders
  refused, the `next:` lines, a tool id on two keys), `integrate-bundle.test.ts` (path keys and
  manifest keys agree) and the e2e section `analyzr import with the manifest and models
  external-ids` (the golden bundle under its pinned keys, the key map from `models external-ids`,
  unchanged bytes, a moved tool id with a checksum mismatch); integrate `test/plugin.test.ts`
  (the release hash of plugin 0.1.1).
- UX2a "Open questions: groups and totals": server `test/unit/open-questions.test.ts` (the block
  `groups and totals (UX2a)`: every kind has a group by a `Record` over the kinds, the filter,
  `totals` per group under the other filters and `askByModel`, one question per process (an agent
  question or an unsure verdict drops the chain finding), the Signavio fixture's bundle exported
  without an id, ref or seq in its text) and `open-question-actions.test.ts` (the action labels,
  „Auf der Kette prüfen“ on the `proposal` items), `test/integration/open-questions.test.ts` (the
  counts per group and `askByModel` pinned on seeded `nordwind-handel` before and after the
  simulation agent, the default export under the old file name, the id regex over the rendered
  Markdown and CSV); contracts `test/answers.test.ts` (the block `the groups, their filter and the
  export (UX2a)`: one or several groups, the export's default groups, every group labelled and
  counted, the column „Ansprechpartner“ with the old header still read); CLI
  `test/unit/questions.test.ts` (`--group` repeated or comma-separated, also in the export, an
  unknown group refused; the summary's `; groups: …`), `questions-act.test.ts`,
  `questions-answer.test.ts` and the e2e test (the 64 questions and the order of the owner's answer
  of 2026-10-16 unchanged, the Markdown); web fixtures with `group`, `detail`, `totals` and
  `askByModel`.
- UX1 "Shell and Übersicht": web `test/overview.test.tsx` (20 tests: the priority rules of „Als
  Nächstes“ as pure cases (no token, a token and the review as the second line, only failed or
  expired, the agent working, editors and viewers, placements, questions, nothing, the missing
  chain, at most two lines), the shared counts (each badge from its own list, §2.5's 6 + 1 + 1 = 8,
  the split text), and the screen: „Agent starten“ with its popover and the block's budget
  (≤ 40 words, ≤ 5 controls), „Agent verbinden“ with a revoked token, the review at the queue's
  first item while the agent works, the placements, the questions, „Alles geprüft.“ without zero
  badges, a viewer without buttons, the four columns and „Offene Punkte“ with its split and
  target, „Modell suchen …“ with folded umlauts, the phase chips and their proposals link, the
  export hub's entries and keys), `problem-texts.test.tsx` (every `ProblemCode` German and never its
  title, reasons before codes, the detail behind „Technische Details“ in an alert and a toast),
  `projects-page.test.tsx` (the list without „Stand“ and „Rolle“, „Kurzname: … (ändern)“, a taken
  key), `app.test.tsx` (no server line, the version in the logo's tooltip, „Rolle“ only with
  another role, the banner, the four tabs with „Relationen“ active on `/relations`, the menu
  „Einstellungen“ for owners), `demo-mode.test.tsx` (the four tabs for every role, „Hochladen“ and
  the menu by role, Escape, a failed model without „Nochmal versuchen“ for a viewer),
  `review-inbox.test.tsx` (the badge „Relationen“, the held items from „Offene Punkte“, the chip
  „Phase: …“, the requeue of an expired reservation on „Übersicht“), the list stubs of
  `open-questions.test.tsx`, `open-question-actions.test.tsx` and `amendments.test.tsx` answer
  `group`, `totals` and `askByModel` (`openQuestionPage` in `test/support/fixtures.ts`), the change
  list from the export hub, the foot link to „Befunde“, `api.test.ts` and the bundle guard (209.2
  KB, one chunk); Playwright `e2e/ui-load.spec.ts` (the UI load guard, 7 tests and 4 `fixme` for
  later slices), `smoke.spec.ts` (no server line, „Relationen“ and „Alle Relationen“, „Befunde“
  from „Offene Fragen“, „Agent verbinden“ from „Einstellungen“), `review.spec.ts` (the stages,
  holder and reservation on „Übersicht“), `pipeline.spec.ts` (the phase chips equal the stages,
  „Vorschläge prüfen (n)“), `open-questions.spec.ts` (the tab order, the badge counts „Zu klären“),
  `auto-accept.spec.ts` („Einstellungen › Annahmeregeln“), `amendments.spec.ts` (the change list
  from the hub), `demo.spec.ts` (the four tabs, „Als Nächstes“ without writes, „Alle Relationen“,
  „Befunde“ from „Offene Fragen“, every menu opened by the write guard, the decide labels on
  buttons only) and `screenshots.spec.ts` (01, 02).
- UX2b "„Offene Fragen“ in the web": web `test/open-questions.test.tsx` (37 tests: the tab and its
  badge, „Zu klären“ as lean cards in the server order without ids, event numbers or source
  labels, „Betrifft …“ from two on, the agents' questions and the informational items apart, the
  descriptive models as one line, „Warum?“ closed with an agent's words as plain text, a hold's
  note, label and contact, the subjects' links, the three filters, „Frage eines Agenten“, the
  source chip, the empty states, the export dialog (`group=ask` by default, the agents' questions
  on request, the byte order mark, a failed export, a viewer), the model view's „Fragen“, „Antwort
  geben“ on a hold, „Kennung kopieren“, notes and withdrawn marks under „Verlauf“, „Erledigte
  zeigen“ and `?state=answered`, the CSV takeover), `open-question-actions.test.tsx` (the primary
  actions, the done line's way back, a hold decided on the review screen, an agent's question on
  the chain), `open-questions-lib.test.ts` (the view, the facets, the export's groups, the card's
  actions and links, the descriptive notice), `held-list.test.tsx` and `review-details.test.tsx`
  (a hold answered in the dialog of „Offene Fragen“), `overview.test.tsx` (the hub opens the
  dialog), `open-question-answers-lib.test.ts` („Jetzt entscheiden“) and the bundle guard (209.3
  KB); server `test/unit/open-questions.test.ts` (the filter line „Außerhalb der Landschaft“);
  Playwright `e2e/ui-load.spec.ts` (the UX2b budgets at both widths, `signavio-beispiel`, a hold
  answered from three entries on `ui-load-vormerkung`, the customer export without ids),
  `open-questions.spec.ts` (rewritten: the cards in the API's order, the filters and the chip, the
  export dialog, decided where the diagrams are, „Erledigte zeigen“, the model view's „Fragen“),
  `review.spec.ts` and `pipeline.spec.ts` (the held list's „Antwort geben“), `demo.spec.ts` (the
  export dialog, the intro without the promise of an action, the heading „Fragen“, „Antwort
  speichern“ and `hold-answer` in the write guard).
- First wave review round: server `test/unit/open-questions.test.ts` (the block `one item per gap:
  coded no-links join the rule tier's items`: a `call-target` no-link joins the finding on its
  call, a `collaboration` no-link the `black-box-partner` item, the agent's reasons as „Laut Agent:
  …“, notes and withdrawn marks kept on the survivor, a live outside mark its own item; a hold's
  notes exported as „Antwort“ without handles, its own note as „Notiz zur Vormerkung“; an agent's
  verbatim reason attributed („Laut Agent: …“); the Markdown grouped by step owners, then lanes,
  then „Ohne Ansprechpartner“) and
  `open-question-actions.test.ts` (a primary link „Verknüpfen mit …“, „Nur verknüpfen …“ only
  beside a primary amendment), `test/integration/open-questions.test.ts` (the pin after the probe
  agent 28 → 26) and `open-question-actions.test.ts` (a coded no-link joins the pool it is about,
  the pool's mark kept across a re-judgement); web `test/open-questions-lib.test.ts`
  (`relationProcessesText`: both processes on a relation's card, equal names told apart by the
  sending end; „Jetzt entscheiden“ leads once a hold has its answer), `overview.test.tsx`
  („Offene Punkte“ as text with its split in a tooltip, „1 offener Punkt“, held placements
  counted, the export hub's entries), `agent-start.test.tsx` (the commands wrap, the chain named,
  „Nochmal versuchen“ closes on a second click, editors a plain button), `projects-page.test.tsx`
  (a name without a key shows the field, the focus stays in the name), `held-list.test.tsx` and
  `review-details.test.tsx` (a hold without an open item answered on the relation, the latest
  answer and „Antwort ergänzen“ on the review screen), `open-questions.test.tsx`
  (the export dialog sends `state=open`, the „Befunde“ link on an empty list, the model view's link
  to the agents' questions and „Zur Information“), `upload-panel.test.tsx` (a failed batch keeps
  the server's reason behind „Technische Details“) and the bundle guard (209.8 KB); Playwright
  `e2e/ui-load.spec.ts` (the active tab inside the row on a phone, every entry of „Exportieren“
  inside its menu, the hold's answer on the review screen, „Offene Punkte“ the sum of its parts,
  the `fixme` for „Gutschrift“ on a phone with UX3's done-when) and `open-questions.spec.ts`;
  `screenshots.spec.ts` waits for the badge „Offene Fragen“ before `02-models` (on a fresh stack
  the open questions answer last).
- M6 S2c-1 "The trust class and the rule tier": server unit `test/unit/trust.test.ts` (the class's
  truth table over engine, uploader and declared kind with the reasons' order; an amended head
  reading its upstream, a legacy revision `null`, applied and `in-source` call targets modelled and
  conflicts apart; `applyTrust` over the real `runRules`: a derived caller's call proposed with the
  marker and the rationale, a modelled or legacy caller's output equal to `runRules`', an amended
  call accepted beside the model's proposed one, the ambiguous, by-name, dynamic and recursive
  branches and the findings unchanged, a missing model throwing; the pinned German texts;
  `trust-kept`), `test/unit/recompute-trust.test.ts` (the real `planRecompute` and `writeRecompute`
  over an in-memory store: a derived call inserted with its rationale, a rule acceptance replaced
  when the caller turns derived and back, a human acceptance, rejection and hold kept, the marker
  dropped with the rule's proposal (another `calledElement`, a deleted callee), `callsProposed`'s
  totals past the cap, a modelled landscape planned as before), `import-impact.test.ts`
  (`ImpactFile.trust`), `amendments.test.ts`, `auto-accept-rules.test.ts` (the system rule's text
  and `proposed`); `test/support/trust.ts` (a `ModelTrust` per model); real PostgreSQL
  `test/integration/trust.test.ts` (the class at ingest by credential, engine and declaration, a
  declared `trust` dropped, the findings equal across classes, `trust-kept`, the Signavio golden
  bundle's „Rechnung stellen“ proposed, the system rule's count; a call target set in analyzr on an
  engine-less caller accepted while its other call stays proposed, the manual link retired, the
  effect equal to what the write changed, kept through re-imports also `in-source`, the proposal
  back after a withdrawal; a revision stored before S2c keeping its acceptance),
  `import-dry-run.test.ts` (derived files in the property test, a read-only token's preview),
  `provenance.test.ts`, `real-libraries.test.ts`, `review.test.ts` and `recompute-golden.test.ts`
  (`trust` dropped from `model.revised` payloads before hashing, every one checked modelled, the
  digest unchanged); web `lib.test.ts` (`impactLines` with the calls line and the absent keys,
  `mergeImpacts`, `ruleDetail`), `limits.test.ts`, `provenance-lib.test.ts` and
  `provenance-view.test.tsx` (the „Aufrufe“ line, the copied labels), `upload-panel.test.tsx`,
  `rules-tab.test.tsx` (the card's text and plain count), `relation-table.test.tsx`,
  `review-details.test.tsx` (the title without „Gleicher Name“, no old proposal as „Begründung“
  after the rule's acceptance), `demo-mode.test.tsx` (the empty „Übersicht“); CLI
  `manifest.test.ts` (the dry-run line with two reasons, two batches and a count past the cap),
  `models.test.ts` (the deletion impact's line), `rules.test.ts` (the system rule's line),
  `amend.test.ts`, `amendments.test.ts`; Playwright `e2e/auto-accept.spec.ts` (the card's text);
  `e2e/ui-load.spec.ts` is unchanged (its numbers re-measured, "Web UI").
- M6 S2c-2 "The fast path for derived calls": contracts `test/contracts.test.ts`
  (`isBulkDerivedCall` takes an open unique call from a derived model with nothing to read first,
  and leaves out one an agent asks about or objects to, and every other relation); server unit
  `test/unit/trust.test.ts` (`isOpenDerivedCall`: the stored rows the card's count is built from, nothing the
  dialog's group would not hold), real PostgreSQL `test/integration/trust.test.ts` (a reviewer's bulk
  accept at tier `key` accepts „Rechnung stellen“ and the card's count goes from 1 to 0; an agent's
  no-link drops the count to 0 while the call stays proposed); web `review-lib.test.ts`
  (`isDerivedCall`, no name flag but an agent's question or no-link, `isBulkCall` equal to a
  derived call without bulk flags, `bulkPreselection` with the cap of 500),
  `bulk-accept-dialog.test.tsx` (the group first and selected with the others, the calls mode
  selecting exactly those calls and accepting them without a rule offer, a flagged call kept in
  its group unselected, at most 500 with the rest named, the „Gleicher Name“ offer after a mixed
  selection), `review-inbox.test.tsx` (`?bulk=calls` opens the dialog and closing drops it;
  nothing opens without such calls, for a viewer or for a call an agent asks about, and the
  parameter goes; the dialog survives the accept's refetches when another query answers 300 ms
  after the landscape: the toast shows, `?bulk` goes, the focus stays on the page),
  `overview.test.tsx` (the calls line after the failed lines while an agent row leads, instead of
  the review line when every open item is such a call, first under „Vorschläge prüfen“ within two
  lines, the viewer's text, no count for a call an agent asks about or objects to),
  `upload-panel.test.tsx` (`upload-next-calls` first, a viewer without it), `lib.test.ts`
  (`callsWaitingText`), `rules-tab.test.tsx` (the card's count a link), `limits.test.ts`
  (`DERIVED_CALLER_MATCH` equal to the contracts') and the bundle guard (225.1 KB); CLI
  `test/unit/import.test.ts` (the notice once on stderr before sending, for `ANALYZR_TOKEN` and
  `--token`, also for a dry run, never with the owner key; `--json` stdout pure JSON with an
  agent token; the `next:` line with the count and the web link before the agent's `then:`;
  nothing when no call waits, no lookup after an import of modelled files only; the derived models
  under their first reason, unchanged ones too); integrate `test/plugin.test.ts` (the 0.1.2 hash);
  Playwright `e2e/trust-calls.spec.ts` (new; projects of its own per run from the integrate
  plugin's golden bundle: through „Hochladen“, the „Vorschau“ line, `upload-next-calls` before the
  agent item and the accept, the relation then accepted by a human and every line gone; through
  `analyzr import` with an agent token, the stderr notice and the `next:` link, the rule card's
  link opening exactly those calls, Escape and a reload not reopening it, „Übersicht“'s calls line
  without a review line, everything gone after the accept), `e2e/ui-load.spec.ts` (`signavio-beispiel`'s
  calls line equal to the API's bulk calls and to the dialog's selection behind „Gesammelt
  annehmen“, measured once the page behind settled, closed with Escape without a decision, the
  focus on „Vorschläge prüfen“) and `e2e/demo.spec.ts` („Gesammelt annehmen“ a write label).
- M6 S2c-3 "Rules for derived calls": server unit `auto-accept-evaluate.test.ts` (humans never
  trigger a rule, the rule tier only with a derived call; a rule for derived calls accepts the
  rule tier's proposal from the named source, never an agent's proposal or another rule-tier
  proposal; the pin that an existing agent rule, any type or `call`, 0.5 or 0.9, never accepts a
  derived call; the narrowing by kind and exact converter; `agent-upload` and `amendment-conflict`,
  also for an agent rule on an agent's call proposal from an agent-uploaded caller; their order
  after `no-matching-rule`; `isDerivedCallProposal` and `derivedCallView`),
  `auto-accept-preview.test.ts` (the replay fires at the rule tier's proposal from the named
  source, never at an agent upload or a conflicted target, no agent rule at an agent-uploaded
  caller's call; `derivedGroups`; the ledger's `proposedBy`), `auto-accept-rules.test.ts` (the
  allowed and refused criteria, reconstructed and as-told never, the domain's check, an older rule
  saved unchanged writes nothing), `recompute-trust.test.ts` (the dry run's `autoAcceptedCalls` by
  rule and nothing without the owner's rules, nothing from another source, an agent upload, a
  conflicted target or with a no-link, `ofProposed` for a re-asserted proposal, not retroactive);
  real PostgreSQL `test/integration/derived-call-rules.test.ts` (new, 14 tests: the owner's dry
  run on the web and with the owner key, none for an editor, a read-only or an agent token; the
  property `acceptedCalls` ∪ `autoAcceptedCalls`; the acceptance in the import's write, marked,
  the author's decision, the importer the causer; converter X leaves converter Y alone;
  `agent-upload` also for an agent rule on the agent's own proposal of the call; an existing agent
  rule accepts nothing; `amendment-conflict`; `proposedBy` never changes and an unchanged save
  writes nothing; older proposals left to apply, an unrelated or unchanged import accepting
  nothing; a revocation back to the rule tier's proposal queueing nothing and never accepted
  again when the rule tier proposes the call again; an agent token's write (a callee upload, a
  deletion) accepting nothing while a person's callee rename does; a deletion that makes a
  duplicate id unique, with its dry run; identical events without such rules or without derived
  proposals), `test/integration/migration-rule-tier.test.ts` (new: 0018 on existing rules, which
  read as agent rules and keep their acceptances; 14 refused rows each on
  `auto_accept_rule_revision_proposer_check`), `auto-accept.test.ts` (revoking an agent rule's
  acceptance queues the models again when the agent's proposal is gone, though the rule tier still
  proposes the pair); web `rules-tab.test.tsx` („Herkunft“ with its open calls instead of tier,
  confidence and type, the hint line; „Konvertiert“ picking and saving exactly a converter, the
  order, „Lädt …“ and why a save waits, a project without converted calls; prefilled from a draft
  and the „Art“ fixed when editing; the row's criteria and the enable toast; `?new=calls`),
  `auto-accept-lib.test.ts` (labels, the suggested name within 100 characters, the open calls per
  source, the block labels, `proposerName`, `inForceAgents`, `parseRulesSearch`),
  `bulk-accept-dialog.test.tsx` (the offer prefilled with the most common source; none after only
  agent-uploaded callers; none when a rule, on or off, names the source), `lib.test.ts`
  (`impactLines` and `mergeImpacts` with `autoAcceptedCalls` and `ofProposed`), `review-lib.test.ts`
  (`derivedCallSource`), `auto-accept-marks.test.tsx` (the proposal named instead of an agent) and
  the bundle guard (226.0 KB); CLI `rules.test.ts` (`add --derived` with its fixed criteria, the
  sources and no curve; `converted` needing exactly one `--converter`, the refused flags; `edit`
  limits; criteria, list and system lines), `import.test.ts` (the suggestion from the waiting
  calls' callers with apply, enable or add and the shell quoting, never with an agent token; the
  dry-run line and its merge), `models.test.ts` (the deletion impact's line), `manifest.test.ts`
  (the quoted value-chain path); Playwright `e2e/derived-call-rules.spec.ts` (new; projects of its
  own per run from the integrate plugin's golden bundle: the toast's offer after „Gesammelt
  annehmen“ and its prefilled dialog saved active; a rule created and enabled in the dialog, then
  „Hochladen“ with the „Vorschau“ line, the call accepted and marked, no „Gesammelt annehmen“ line
  once the next steps settled, the provenance naming the call proposal, „Widerrufen…“ returning it
  to a proposal; an agent token's CLI import left a proposal, the rule's preview naming
  „Über ein Agenten-Token hochgeladen“), `e2e/trust-calls.spec.ts` (the toast's text per case: the
  offer after the owner's web upload, none after the agent token's import) and
  `e2e/auto-accept.spec.ts` (the neutral revocation summary).
- M6 S2c-4 "Vor der Vertrauensregel angenommen": server unit `test/unit/trust.test.ts`
  (`legacyTrust` from what a revision carries; a review read where the revision carries no class,
  `derived` with its reasons or `modelled`; a stored class never overruled; an amended head reading
  its upstream's review; `preTrustAcceptances`: a legacy caller derived by engine, by agent upload
  or before S2a by a service principal, by declared kind (`export` no reason), listed by model;
  nothing for a Camunda model a human uploaded, a call whose target was set in analyzr, a call a
  human or an owner's rule decided, one not resting on a decision, a non-accepted, missing-endpoint
  or non-call relation, a revision reviewed either way or classified; the amended head's uploaded
  revision named; models and calls sorted), `recompute-trust.test.ts` (`ofProposed` among the
  calls accepted before for a review, among `callsProposed` for an import),
  `auto-accept-rules.test.ts` (the new `preTrust` argument); real PostgreSQL
  `test/integration/trust-review.test.ts` (new, 11 tests; revisions from before S2c made by
  stripping `source.trust` by SQL: the list and the system rule's count, nothing for a project
  imported since S2c; an amended head listing its uploaded revision without the call whose target
  was set in analyzr, which a review keeps accepted; „Zurück in die Prüfung“ with the dry run equal
  to the write, proposals with the rationale, `Model.trust`, one event, never listed again (its
  dry run then 409), still proposed through later ingests; an enabled rule for derived calls
  accepting them again in the same write, as the dry run said; „Behalten“ keeping them accepted
  with only the review's event, and unchanged bytes keeping the reviewed `modelled` with
  `trust-kept`; unchanged bytes after „Zurück in die Prüfung“ reporting `derived`; 422 without
  `expectedCount` or for an unknown id, 409 for a changed count; a revision with nothing to review
  refused with 409 `not-listed` in the dry run as in the write, for both verdicts, alone or with a
  listed one, nothing written; a classified or amended revision refused by the domain and by the
  database trigger; 403 for an editor, a viewer, a write and a read-only token, the owner key
  allowed; the append-only triggers), `test/integration/migration-trust-review.test.ts` (new, 3
  tests: 0019 and 0020 on a database migrated to 0018 with existing revisions, which still read as
  stored before the trust rule; the guard, the checks, the foreign key and the primary key;
  `headTrustRows` reading a review; append-only), `demo-mode.test.ts` (`listPreTrustCalls` among
  the routes a demo visitor may not read); web `pre-trust.test.tsx` (new, 9 tests: the texts of
  the line, a model, the dry run and the toast; the card's line for owners with a count, none
  without a count or without its dialog (the demo); the dialog with every model selected, the dry
  run following the selection and „Zurück in die Prüfung“ sending it with the list's count;
  „Behalten“ with the count; a failed dry run keeping „Zurück in die Prüfung“ disabled; a 409 of
  the dry run or of the review reloading the list; another failure keeping the dialog and the
  selection), `rules-tab.test.tsx` (the line opens the dialog and the focus returns; after the
  review the line is gone and the focus goes to „Erste Regel anlegen“; fixtures with `preTrust`),
  `relation-table.test.tsx` (fixture) and the bundle guard (226.1 KB); demo `check.test.ts`
  (`pre-trust-calls` among the GETs a
  visitor gets 403 for); CLI `rules.test.ts` (7 new tests: the list with reasons, calls and the
  `next:` line; `--revoke` printing the dry run and changing nothing without `--yes`; `--revoke
  --yes` sending the dry run's count and naming the rules that accept again and the review link;
  `--keep --yes` and a 409 explained; conflicting flags, an unknown model and an agent token
  refused before any review; the system line, an empty list and the dry run of `--keep`; `--json`
  with nothing listed in the review's shape); Playwright `e2e/pre-trust.spec.ts` (new: against the
  server, a project imported now through „Hochladen“ from the integrate plugin's golden bundle lists
  nothing, its card has no line, a review of its classified caller is 422 `revision-classified` and
  an agent token gets 403; in the browser, with the list and the review's answers stubbed by
  `page.route` and `preTrust` patched into the real rules list, the line opens the dialog, unticking
  a model changes the dry-run line, the „Behalten“ note shows, „Zurück in die Prüfung“ sends the
  selection with the list's count and the toast's „Gesammelt annehmen“ opens the project's real bulk
  dialog). A revision from before the trust rule cannot be made through the API (the server writes
  `source.trust` last on every upload, and no route writes a revision's source), so the whole flow
  is covered by the Testcontainers tests, not end to end.
- M6 S2b follow-up step 1 "Agent work in the dry runs, relations side": server unit
  `test/unit/queue-plan.test.ts` (new, 12 tests: one row per branch of `queueAnalysis`, a revert
  included; the done task read only without an open task and for a layout-only change; the
  cancelled task handed back), `test/unit/judgement-shift.test.ts` (new, 9 tests: `judgementShift`
  for a stale hash, a pair counted once (within a model, between two changed models, a link and a
  no-link on it), another procedure never lost, a deleted model, a revert losing nothing;
  `pairsToJudge` without judged and settled pairs, equal to the union of `planClaim`'s assignments
  without partner tasks, and an upper bound when an open task outside the queued models takes a
  pair), `import-impact.test.ts` (5 tests: the recompute planned once with the relations' part as
  `relationImpact` gives it, the relations after the plan, the pairs and those judged again, the
  cancelled tasks claimed first and counted past the cap, a deletion cancelling and queuing
  nothing), `recompute-trust.test.ts` (an owner's rule acceptance settles the pair: no pair to
  judge); real PostgreSQL `test/integration/import-dry-run.test.ts` (4 tests, the dry run equal to
  the write: queued `[B, A]`, B cancelled as claimed with the holder's handle and its assignment's
  length, nothing written; after the import the `analysis.queued` and `analysis.cancelled` events
  as previewed and B's submit 409 `task-cancelled`; the claims of every queued task together
  assigned exactly `pairs`, their part judged before exactly `rejudged`; a layout-only re-import
  queuing nothing and writing no `analysis.*` event; PUT's dry run equal to the import's; the
  deletion impact naming the claimed task and `DELETE` writing exactly that one
  `analysis.cancelled`), `test/integration/amendment-cost.test.ts` (new, 3 tests: a call target's
  cost equal to the PUT dry run's `rejudged` and to the next claim's part judged before, the call
  it accepts not counted; a partner message name's cost without the partner pair it accepts; a
  withdrawal dry run without a fact change while the task is claimed answering `{factsChange:
  false, pairsToRejudge: 0, taskClaimed: false}`), `test/integration/amendments.test.ts` (a
  not-recordable dry run while the task is claimed, the same zeros; the cost after the agent's
  no-links on the pairs its claim left to the partners); contracts `test/impact-merge.test.ts`
  (new, 10 tests: the reason order and the cap of the contract, zod-free source, the files, counts,
  caps, calls only proposed and an owner's rules merged as before, the relations tasks
  concatenated and sorted as the server sorts them also when the batches' keys do not follow
  their order, a claimed task listed past the first batch's cap, the pairs judged again
  deduplicated and sorted); relations `candidates.test.ts` and `sample.test.ts` (the prepared
  index, above); CLI `import.test.ts`, `manifest.test.ts` and `models.test.ts` and web
  `lib.test.ts` and `upload-panel.test.tsx` (fixtures with `relationsTasks`, the merge
  unchanged); the bundle guard (226.3 KB, `impact-merge.ts` in the entry).
- M6 S2b follow-up step 2 "Placements in the dry runs": server unit
  `test/unit/placement-impact.test.ts` (new, 21 tests: an accepted placement named `changed` on a
  rename and `missing` when its process or its whole model leaves the head, none on a removed step,
  no held one, `@outside` without a step name, nothing when the process comes back or nothing
  changes, the sort; nothing due on an unchanged head; due-ness of a new process, of an own-field
  change but not its sibling, of both ends of a newly accepted call, of every open process when a
  step link resolves, a process due before not newly due, more than five start events of mixed kinds
  keeping their digest; the outcome matrix with `not-triggered`; the rule tier the write runs: the
  proposal a revoked auto-acceptance no longer suppresses, nothing where its proposal is live or a
  human decided, a proposal on a new spot and a withdrawal each a new non-agent seq; the held
  claim's processes judged on the claim's input, and without its hashes; `headFactOrder`),
  `recompute-trust.test.ts` (a derived call an owner's rule accepts makes both ends due,
  `{queued, 2, 2, 2}`; without the rules nothing is due); real PostgreSQL
  `test/integration/value-chain-ingest.test.ts` (before each write, a rename and back, a deletion
  and revival, a rule proposal withdrawn and back, an unchanged re-import and a layout-only re-save,
  the dry run's `placementsChanged` equals the following `placement.endpoint_changed` events that
  turn an accepted placement `changed` or `missing`, and `lastSeq` is unchanged; `headFactOrder`
  over the head equal to `facts.head` on `nordwind-handel`),
  `test/integration/placement-pipeline.test.ts` (the triggers: layout-only `not-triggered`, a new
  model `queued` with the `analysis.queued` payload's `due`, a deletion `not-triggered` and no
  event; an own-field change `{queued, 1, 1, 1}`, a task label `nothing-due`; an import during the
  lease `deferred` `{1, 1, 1}`, then `requeue_after` set and the follow-up offering the changed
  process; the rule tier proposing and withdrawing on a rename, dry run equal to write; an accepted
  placement the rule tier re-proposes named changed; a newly accepted call making both ends due; the
  rule proposal a revoked auto-acceptance no longer suppresses; the deletion of a model a step links
  to, `{not-triggered, 2, 2, 2}`, then the chain due 2; a batch with a layout-only file and a
  rename, `queued` with due 1 as the import's `analysis.queued`),
  `test/integration/import-dry-run.test.ts` (no chain, no placement fields, in the import's dry run
  and the deletion impact); contracts `test/impact-merge.test.ts` (2 new tests: the chain's part
  absent, added up, sorted again and capped; the outcome precedence, the largest `due` and the
  sums); `claim-golden`, `recompute-golden` and `value-chain-golden` unchanged; the bundle guard
  (226.6 KB).
- M6 S2b follow-up step 3 "The surfaces": web `lib.test.ts` (2 new tests: the cost line in the
  last of the three lines, also on a first import, and the S2b lines unchanged without it; the
  singular forms, the pairs judged again, „etwa“ for several batches and every count in de-DE; the
  placement part per outcome, `processesToPlace` counting every process due for a task the import
  queues, never fewer than `newlyDue`, and the newly due ones for a waiting or held task; the
  placements line right after the relations' ends; `rejudgedText` and `placementChangeText` with
  „Außerhalb der Kette“ and a step without a name; the warning for one claimed model and for
  several, at most three named, the rest counted past the cap; `batchNoteText` for one batch, a
  re-import, new models in one batch only and a first import in parts), `upload-panel.test.tsx`
  (2 new tests: the cost line with a deferred placement task, both new lists, the warning by key
  without a handle and for five models, the first click sending nothing, „Abbrechen“ and a new
  preview each disarming, a double click (`detail` 2) arming only, the second click importing;
  „Was ändert sich?“ absent when the cost line is the only line, and no „keine Änderung“ line
  beside the warning),
  `amendments.test.tsx` (the action panel's „Trotzdem speichern“ armed by `user.dblClick`, no
  submit), the bundle guard (227.6 KB, `lib/agent-cost.ts` in the entry, `amendments.ts` lazy);
  CLI `import.test.ts` (5 new tests: the `agent work:` line right after the facts with the pairs
  and those judged again and `about`; the placement task by outcome, a queued task placing every
  process due, `due in all` for a waiting or held one; the cancelled tasks and the warning in the
  singular and the plural past the cap; the placements line after the relations' ends; the merged
  batches and `--json`'s fields), `manifest.test.ts` (the pinned block with `  agent work: none`
  and the batch line's clause on the pairs), `models.test.ts` (the listing with a claimed task,
  placements and processes due and the requeue hint printed once for two deletions; 1 new test:
  `deletionImpactText` with a queued task, the singular forms and none of the new parts without
  them), e2e `cli.e2e.test.ts` (`import --dry-run` on `nordwind-handel` in text and `--json`,
  `relationsTasks` queuing the changed model; the deletion listing's `relations task cancelled`);
  Playwright `e2e/upload-preview.spec.ts` (new; a project of its own from `eval/corpus/_sample`: an
  agent judges one model's pairs with no-links and keeps another model's claim; a re-export of both
  through „Hochladen“ previews the cost line with „davon erneut“, the judged model in the list of
  pairs judged again and the exact warning; a double click on „Importieren“ only arms („Trotzdem
  importieren“, the heads unchanged over REST), „Abbrechen“ and a new preview ask again, the second
  click imports, and the holder's submit gets 409 `task-cancelled`), `e2e/smoke.spec.ts` (a first
  bundle import names the pairs to judge in its last line and shows no warning) and
  `e2e/ui-load.spec.ts` (the new step „Vorschau (erneuter Import)“, "Web UI", Measured load).
- M6 S2b follow-up step 3b "The agents' next run": server unit `next-run.test.ts` (new:
  `pairsToJudge` over the whole-project pass's own candidates equals it over each model's own
  `generateCandidates` call on `_sample` and `nordwind-handel` for four sets of models, and a pair
  between two claimable models counts once; `heldPairs` holds the pairs of a claim's assignment
  with a waiting model its claim saw as it is now and equals what `planClaim` skips, rule 1),
  integration `pairs-to-judge.test.ts` (new, real PostgreSQL, the whole `nordwind-handel`: the
  count equals the union of the claims' assignments after a first import, held tasks counting
  not; with a held claim, a requeue and an acceptance the held claim's pairs, judged and settled
  pairs stay out and pairs with done models come from the own candidates; a claim whose lease ran
  out holds nothing, its task counts again and the memo ends with the lease, 198, 195 while held
  and still memoized a second before the lease ends, 198 a second after it; built again after an
  import through the memo, one candidate pass per build with `CandidateCache(0)`; the
  implementer's two mutations, no own candidates and no rule 1, each failed it, as did the
  fixer's without the clock check), `project-summary.test.ts` (the badge counts unchanged,
  `pairsToJudge` 0 on an empty project) and `open-questions.test.ts` (`pairsToJudge` 0 after the
  simulation agent's run); relations `candidates.test.ts` and `sample.test.ts`
  (`projectCandidates` gives `generateCandidates`' whole-project candidates and each focus model's
  own of a basis other than `compatible`); contracts (`pairsToJudge` required, an integer, never
  negative); web `lib.test.ts` (`waitingText` with the suffix, with the placements too, „1 mögliche
  Relation“ without „etwa“, none for 0, German numbers; the batch note's pointer to „Als
  Nächstes“), `overview.test.tsx` (the pairs on the agent row of `nextStep`, none without waiting
  models; the suffix beside „Agent starten“ and in the editors' waiting line, within UX1's budget,
  one pair without „etwa“, nothing for 0), `upload-panel.test.tsx` (the suffix after an import;
  no number from a summary cached before the import when reading it again fails, which the old
  guard showed), the bundle guard (227.9 KB); CLI `import.test.ts` (the waiting line with `about
  7300 pairs to judge` and `1 pair to judge`, none for 0 or an unknown count, left out when the
  summary cannot be read), `seed-status.test.ts` (`status`'s models line and `--json`'s
  `pairsToJudge`: 0 and no summary request while nothing waits, `1 pair to judge`, `null` when
  the summary fails), `manifest.test.ts` (the batch line's pointer), e2e `cli.e2e.test.ts` (the
  freshly seeded `nordwind-handel` has pairs to judge; the import's waiting line as `status`
  counts them); Playwright `e2e/smoke.spec.ts` (after the bundle import the waiting text and
  „Übersicht“'s suffix beside „Agent verbinden“ equal REST's `pairsToJudge`) and
  `e2e/ui-load.spec.ts` (UX1's budget on `signavio-beispiel` with the suffix, its count above 1).
- M6 S2b follow-up step 4 "The integrate plugin 0.1.3": `tools/integrate/test` (205 tests, 145
  before) `analyzr-read.test.ts` (new, against `test/fake-analyzr.ts`, a local HTTP server that
  logs every request: `models` writing every page as `analyzr models list --json` does,
  `external-ids` with an agent token, why a project or a credential does not work without naming
  a secret, no credential in a failed request's error; `preview` on the golden bundle as `analyzr
  import --dry-run` sends it with the agent work, 61 files in batches of 50 and 11, each with the
  whole manifest (hidden files, `node_modules` and other endings left out), merged, exit 1 for the
  file that would fail; a missing project (404) and a folder without a manifest refused; the refusals: every URL that is not this machine's analyzr or
  carries a user name, a proxy Node would send the credential through in each spelling of its
  proxy support, `NO_PROXY=*` read at each request (the plain run reaches the proxy, the bypass
  gets 200 from the server), a redirect, every `--json-out` that is not the script's own kind of
  file in an existing workspace's `reports/` (a dangling link, a path below `exports/`,
  `reports/../../…`, a folder without `analyzr-workspace.json`, inside the bundle or a checkout),
  every unknown option or command (`--create`, `--name`), and, over all these runs, no request but
  the three; `requestFor` and `assertAllowed`; the constants mirrored from the contracts and the
  CLI, the local failures as `createProblem` writes them, the processes to place as the web's
  `processesToPlace` counts them), `keymap.test.ts` (`rebuildFromAnalyzr`: a lost map restored from
  the golden bundle's identities with every file of the export known, a tool id on several keys
  kept by the oldest model, a duplicate whose second key has no tool path and is skipped, a
  generic tool id identifying nothing and one key per path without a tool id, a stale map gaining
  only what it lacks with its conflicts, the key the map gives keeping the tool id, the oldest key
  with a tool path keeping it, tool paths analyzr stored tidied, nothing of the system in analyzr
  leaving the map unchanged, a given rule for a missing system and a stored rule fixed;
  `inferRule`: strip folder and prefix with collisions' suffixes, a tie to the simpler rule, only
  strip folders a rule can name, hand-edited keys counted), `cli.test.ts` (`plan --from-analyzr`
  recorded only with `--write`, `--reset` refused while analyzr has the system's models),
  `bundle.test.ts` (the declared `systemVersion`: blank or absent none, padded trimmed; the
  contracts' `ImportManifest` taking 100 characters and refusing 101; `tidyDeclared` equal to the
  contracts' own within the limit), `drift.test.ts` (`analyzr-read.mjs` holding only Node built-ins,
  its sources and the zod-free contract modules, with `mergeImpacts` and `modelKeyOwners` bundled,
  not copied; the bundled copy run away from `node_modules` printing what the sources print) and
  `plugin.test.ts` (the file list with `analyzr-read.mjs`, the two-rule `allowed-tools`, each
  pre-approved command in the body in exactly the form its rule matches, the three `analyzr-read`
  commands against the workspace's `analyzrUrl` with results into `reports/`, no command line with
  `| ; & < >`, a backtick or `$(`, no `permissions.allow`, every import command outside the report's
  „Import“ a dry run without `--create` or `--name`, `RELEASES['0.1.3']`); CLI e2e `cli.e2e.test.ts`
  (new section: the bundled `analyzr-read.mjs preview` of the golden bundle into `m6-s2a` and
  `nordwind-handel` writes exactly what `analyzr import --dry-run --json` prints, with the project's
  `seq` and models unchanged; `external-ids` and `models` fed to the bundled `normalize-bpmn.mjs
  plan --from-analyzr` restore the key map with the strip rule, 6 of 6 keys fitting, every model
  known, one duplicate kept by the oldest key and one skipped key).
- M6 S2b follow-up step 5 "The identity rows": server `test/unit/provenance.test.ts` (the helpers
  `declaredIdentity`, `sameModelIdentity`, `identityUpdate` and `withIdentity`; the identity
  warnings' sequence with unchanged files taking effect, `two models now carry it` for an unchanged
  file too, the new unchanged `external-id-changed` message, an unchanged file dropping its key's
  tool id silent; every `provenance-kept` case with its exact message, a moved folder, link or tool
  id silent; no `provenance-kept` next to a `trust-kept` that names the derivation, and
  `withinWarningLimit` dropping it only as a fifth warning; `originOf` from an identity) and
  `trust.test.ts` (`trustKeptNamesDerivation`: only a class change in a derivation reason, not one
  of the credential alone); `test/integration/provenance.test.ts` (real PostgreSQL: the moved-folder
  re-import recording six rows and six `model.identity_declared` events with no warning, `lastSeq`
  +6, the revisions, `Model.source`, `Model.trust` and the facts hashes unchanged, the same manifest
  again quiet; its dry run's `files` equal to the import's, whole objects; scoped absent keys
  reading the new folders; a bundle over bytes first uploaded without one, `provenance-kept` on all
  six files, no `trust-kept`; another tool id, also one another live key holds, and an entry without
  one; a deletion, the change list naming the last place, a revival without and with a manifest; an
  unchanged PUT with `Analyzr-Manifest` and its dry run; a moved folder under an amended head in the
  change list; an agent token's rows under its principal, the class kept; `provenance-kept` beside a
  `trust-kept` for another credential, the same in a read-only token's dry run, and a file with all
  five warnings kept at four; the table append-only and its guard refusing amended, foreign,
  mismatching and event-less rows, an exact copy failing on the primary key),
  `migration-model-identity.test.ts` (new: 0021/0022 on a database migrated to 0020 with eight
  cases, the rows exact, `uploadedSources` and `externalIdEntries` equal to S2a's readers,
  `Model.identity`, the newest row of a deleted model, the backfill run again adding nothing, the
  triggers) and `value-chain-ingest.test.ts` (an identity-only re-import on a live chain writing
  only `model.identity_declared` events: placements, the placement task, `placement_input` and the
  head hashes equal, nothing queued); CLI `test/unit/manifest.test.ts` (the four new forms of the
  manifest line, each in the import and its dry run, `--json` keeping `ManifestSummary`'s shape and
  showing `identityUpdated` per file) and e2e `cli.e2e.test.ts` (new, on `m6-s2b5` beside the plugin
  section: the golden bundle, then a copy with its folders under `Verschoben/` dry-run, `lastSeq`
  unchanged, and imported, `lastSeq` +6, `models external-ids --json` and the bundled
  `analyzr-read.mjs external-ids` giving the moved folders, the same import again quiet); web
  `provenance-lib.test.ts` (the identity's folder over the revision's, none for an identity without
  one, the system prefix, „Quelle“ the revision's, `toolLinkOf` from the identity, the new
  `provenance-kept` text), `provenance-view.test.tsx` (a moved folder in „Herkunft“, the menu link
  while the revisions are still pending), `upload-panel.test.tsx` („Danach: Ort im Quellsystem für 1
  Modell aktualisiert“ and „Importieren“ sending the manifest, the result „Kein Modell importiert ·
  2 unverändert“; no such part beside a created file), `lib.test.ts` (`identityUpdateText`), the
  bundle guard (228.1 KB); Playwright `e2e/smoke.spec.ts` (the UX8 bundle test re-imports a copy
  with moved folders: „Vorschau: 6 unverändert“, „Danach: Ort im Quellsystem für 6 Modelle
  aktualisiert“, „Importieren“, „Kein Modell importiert · 6 unverändert“, `external-ids` and
  „Herkunft“ with the moved folder and the first export's „Quelle“).
- M6 S3c step 1 "`analyzr-spec/1` and the deterministic renderer": `tools/integrate/test` (332
  tests, 205 before) `spec-validate.test.ts` (new: every error and warning with its exact message,
  per origin; ids as strings; D3 (a): `calledElement`, `callActivity` and a call's `name` refused;
  the limits, also 20,000 processes refused in milliseconds; the YAML reader refusing anchors,
  aliases, merge keys, tags, duplicate keys, several documents and odd keys, reading UTF-8 of at
  most 2 MB and JSON, `formatSpec` read back unchanged; the zod-free `externalId` and URL rules
  against the contracts' `ImportManifest`), `spec-render.test.ts` (new: the 9 goldens byte for byte
  and `RENDER_OUTPUTS`; per golden the facts `extractFacts` gives, with element ids, documentation,
  lane members, data store readers and writers, message and signal names and message flow ends, the
  participant names and the model name; determinism: twice, YAML against JSON, shuffled nodes,
  flows, message flows and data stores, reordered lanes and pools moving only DI, another key
  changing only the definitions and collaboration ids, a task refined to a send task or a call and
  an event changing direction keeping their ids; the id function's prefixes, the 255 cap, uniqueness
  and the `_label`/`_plane` rule; the copies of `capped`, `uniqueId`, `sanitizeLine` and
  `sanitizeBlock` against their originals; seven tampered renders, each refused by its own
  self-check rule; the slot, size and element limits; 200 seeded random specs, also shuffled,
  through D1 (no extractor warning, `engine` null, `isExecutable="false"`, no engine namespace) and
  D3 (b) on the parsed tree), `spec-layout.test.ts` (new: the readability checks on goldens and
  fuzz: no two shapes overlapping, every shape inside its pool and lane, axis-parallel edges with at
  least two waypoints, sequence flows, data associations and their labels inside their pool, no
  label over a shape, no pool over another, pool widths, integer coordinates everywhere; eval's DI
  rules restated; lane order and the unlaned band), `spec-bpmnjs.test.ts` (new: D2 (a) on goldens
  and 200 random specs, bpmn-moddle without a warning and bpmn-js's `BpmnTreeWalker` with a handler
  applying `BpmnImporter`'s refusals, every drawable element drawn exactly once and every id bpmn-js
  registers unique; a removed shape, a shape on a connection, an edge on a node, an unspecified
  `sourceRef` and an unknown DI refused), `spec-bundle.test.ts` (new: the manifest against the
  contracts' `ImportManifest`, losses summed, `as-told`, the run record, unconfirmed keys and a
  non-empty `--out` refused, two specs of one model, the folders and `replaces-known-model` in each
  of its cases and on a re-plan of its own keys, inventory coverage, the spec file reader with a
  sparse 3 GB file, a pipe and a link, the output guards) and `cli.test.ts` (the `analyzr-spec`
  entry from source: usage and exit codes, `validate` on a folder, a file of any name and a missing
  path, `render` refused into a checkout or `exports/`, `plan`, `plan --write`, `plan
  --from-analyzr`, `bundle` with exit 1 for a failed model, `plan` exit 1 on invalid specs;
  `spec/plan-args.ts` against `normalize-bpmn`'s helpers); Playwright
  `e2e/spec-render-import.spec.ts` (new, above).
- M6 S3c step 2 "the converter runner": `tools/integrate/test` (390 tests, 332 before)
  `spec-converter.test.ts` (new, 27: the Visio and ARIS fixtures through `convert` with their exact
  run record, the AML DOCTYPE skipped and its entity left as written, the same specs and record on
  every run and the copy kept once; the example converters on edited copies of their fixtures (an
  untriggered intermediate event, a reference that fans out, pages in another order and named
  otherwise, an EPC without elements, styled and mixed text); D3 (a), no field and no type becoming
  a `calledElement`, and (b, c), the calls as collapsed subprocesses with `link-unresolved` and the
  manifest, checked with the contracts' `ImportManifest`, saying `converted` or `reconstructed` with
  `adhoc:<12 hex>`, the renders through the structure checks, bpmn-moddle, bpmn-js's tree walker and
  the DI checks and `extractFacts` without a warning or a `call` fact; the record at `analyzr-spec`:
  listed specs validated as converter output and the others as the agent's, a spec edited after the
  run, a copy missing, changed or a link, a record that cannot be read (one folder error) and one
  read strictly; the result: valid models written and every invalid one listed (a declared
  `derived`, bad losses, not a model, a shared tool id or path), the first warning and error lines
  with their counts, nothing written when the record would be too large, a spec over 2 MB, `-2`
  names, a result that is no object with a list of models, compile errors and throws with their
  line; the refusals before a run: another sha256, a converter outside `converters/`, a link, a
  second name, over 1 MB, not UTF-8 or naming `import`, an export outside `exports/`, a workspace
  without its file, a wrong derivation, an `--out` not empty, below `exports/` or in a checkout, a
  file over 64 MB passed on unread and an export over 512 MB refused before it is read, a copy with
  other bytes; the child's script in source and bundle mode; the losses read strictly and summed),
  `spec-sandbox.test.ts` (new, 18: every constructor chain ending in `EvalError` and no host global,
  `Error.prepareStackTrace` frames leading nowhere, endless loops and promise jobs timing out, jobs
  after the run changing nothing, the clock and randomness throwing, the result cap, the bridge
  boundary (a host `RangeError`, a non-string, `''` and `'!msg'`, every helper error the context's
  own), two runs that differ in their result or in what they read, the parent stopping a child that
  outlives its time or writes too much; files, zip entries and XML as plain data with the reads
  counted, a symbolic link and paths outside the export never seen, an archive that fails a guard
  passed on unopened and a damaged entry an error; the child started by hand refusing in 7 cases,
  its sandbox self-check, a token and `NODE_OPTIONS` in the parent never reaching it, a local TCP
  listener counting 0 connections; source ids, the context's global names and the usage naming
  `__child`), `spec-unzip.test.ts` (new, 9: a VSDX listed as `inspect` lists it with every entry
  inflated back to its bytes, entries sorted by name, a symbolic-link entry refused, directories
  left out and stored entries read, names that leave the archive, ZIP64, split and encrypted
  archives, other methods and broken records, entries sharing data, the size limits and the ratio,
  the size and checksum of every inflated entry) and `cli.test.ts` (4 new: `analyzr-convert`'s usage
  and exit 2 on usage errors, the Visio export converted from source and then validated, planned and
  bundled by `analyzr-spec`, exit 1 for a refused run and for failed models with no details written
  into the spec folder, and `validate` reporting a record it cannot read); helpers
  `test/converter-support.ts` (the fixture exports and workspaces) and `test/zip-writer.ts` (a small
  zip writer for the fixtures and hostile archives). The two child-spawning files run with a 60 s
  per-test timeout.
- M6 S3c step 3 "the CLI core": `apps/cli/test`, 317 tests (286 before; 288 unit, 29 e2e) plus 7
  skipped (the live project): `unit/core-program.test.ts` (new, 19: the core has every command of
  the checkout but `seed` and `mcp`, each with the same help; the static import graph of
  `plugin-main.ts` without `main.ts`, `program.ts`, `cli-main.ts`, `commands/seed.ts`,
  `commands/mcp.ts` and `mcp-bridge.ts`, and with exactly `@analyzr/client`, `@analyzr/contracts`,
  `@analyzr/contracts/impact-merge`, `commander` and Node built-ins; `nodeCommand` and
  `pluginCommand` quoting the script and adding `--url` unless it is the default; the root
  `package.json`'s version; every next step of an import naming the command and the rest of the text
  the same, with `--url` and with `ANALYZR_URL`, the owner rule steps, `status`'s hint without
  `seed`, the batch line; the parse guard on 17 command lines in both CLIs with the exact message,
  exit 2 and no request (`--name --dry-run`, `--name=--dry-run`, `-p --dry-run`, the global `--url`,
  `--scopes`, a second `--to`, `-n`, `--dryrun`, `--`, a repeated `-p`, `--name`, `--url`, `--base`
  and `--reason`, `--rev`, and a flag after `--` for `import` and `models delete`),
  `seed --corpus --json` refused too, and text with a space, a value with one dash and the defaults
  passing; the loopback rule: 8 URLs accepted and 15 refused, the refusal never echoing the URL,
  `no_proxy` and `NO_PROXY` exactly `*` and a refused host changing nothing, every leaf command of
  the plugin with `--url http://192.0.2.1:7400` never sending the owner key (more than 20 of them
  saying why), `import --create` and `token create` refused with exit 1 and no request, `status`'s
  note with exit 0, the host said before a missing key file, an agent token sent anywhere, the
  checkout sending the owner key to any host and leaving `NO_PROXY` alone),
  `unit/plugin-main.test.ts` (new, 9: `node src/plugin-main.ts` and `node src/main.ts` as child
  processes, each against its own HTTP fake on 127.0.0.1 with only `PATH`, `HOME` and the owner key
  file in the environment, 30 s per test: `--version` and `--help`; the help of one command per group
  identical (every path's help in process, `core-program.test.ts`); a dry run of the golden Signavio bundle with `--json` (the same stdout,
  stderr, exit code and request log: method, URL, authorization, multipart file names, the
  `manifest` part) and as text; a folder of 61 files in batches of 50 and 11 in both; `import
  --create --name` on a bundle that triggers every next step, the same 8 requests and the same text
  once the command, `(in analyzr's repository)` and the port are normalized, no step saying `analyzr
  <cmd>`; `token create` without a `main.ts` path in the plugin; `--create --name --dry-run` and the
  repeated `--name` and `-p` forms exiting 2 without a request in both; the owner key refused for
  192.0.2.1 and an agent token sent; with `NODE_USE_ENV_PROXY=1` and `HTTP_PROXY`, alone or with
  `no_proxy=' * '`, `NO_PROXY='* '` or `no_proxy=corp.example`, the plugin's owner key going
  straight to its fake and the checkout's request into the proxy), `unit/program.test.ts` (the help
  of all 43 command paths against `unit/__snapshots__/help.txt`, recorded before the split),
  `unit/token.test.ts` (`mcpEntry: null` with and without `ANALYZR_CONTAINER`) and
  `unit/integrate-bundle.test.ts` (a bundle of rendered specs: `tools/integrate`'s `analyzr-spec
  plan --write` and `bundle` from source on 5 committed spec fixtures in a temporary workspace, the
  keys from the paths and from the manifest alike); the helpers `test/support/help.ts`,
  `fake-server.ts` (a handler that throws answers 500) and `next-steps.ts` import no CLI source, so
  step 4 can run the same cases on the bundle; `e2e/cli.e2e.test.ts` and `live/stack.live.test.ts`
  change their imports only (the live test passes `entry: CLI_MAIN`).

## CI

`.github/workflows/ci.yml` (workflow "CI") runs on every pull request and every push to `main`,
without path filters, and by hand (`workflow_dispatch`); a newer run on the same ref cancels the
older one. Job `verify`: install with the frozen lockfile,
format check, typecheck, lint, tests (incl. Testcontainers, the MCP contract test, the plugin
drift check of `@analyzr/procedures`, the `THIRD-PARTY-NOTICES.md` check of `@analyzr/notices`,
and since M4 S0 the dependency specifier guard and the golden
value chain validator), client drift check, `eval/tools` check and validate,
`eval:candidates` (fails on a gate; `eval/reports` must be up to date), `eval:replay`
(`eval/reports` and `eval/recordings` must be up to date, the live gate section included; the
gate itself fails nothing), since M4 S4 `eval:placements` (fails on a gate; `eval/reports` must
be up to date, with no untracked file there), since M6 S3a `eval:descriptive` (report only; it
fails when a transform yields BPMN the extractor warns about; `eval/reports` must be up to date,
with no untracked file there), and the web build. The tests include `tools/integrate`'s drift
test of the integrate plugin's bundled scripts and its release table. The eval steps print only
`git diff --stat` (file names and counts), so no holdout line of a report or recording reaches
the CI log. Job `docker`: builds the image
and starts the Compose stack (`up -d --build --wait`), checks `/health` and `/`, runs `analyzr seed`,
`analyzr seed --value-chains` and `analyzr status` in the container, checks that the image holds the
golden chain files and no `expected.yaml`, `expected-placements.yaml`, `*.md`, `*.mjs` or
`*.jsonl` under `/app/eval`, then the live check (`test:live`) against it. Job `demo` (owner
decision 20): builds and starts `docker/compose.demo.yaml` (the seed runs in the build, so a broken seed
fails here first), checks that the runtime image has no `eval/`, CLI or agent and only the seed
in `/opt/analyzr-demo`, runs `analyzr-demo check`, restarts the container and checks again. Actions are
pinned to commit SHAs. Its three jobs, "Typecheck, lint, test", "Docker image and compose
stack" and "Read-only demo image", become the required status checks once the owner sets the
ruleset for `main` (CONCEPT §9; rulesets require checks by job name, and a job appears in the
ruleset's picker only after it has run once).

`.github/workflows/demo-deploy.yml` deploys the demo to Fly.io on pushes to `main` that
touch `apps/`, `packages/`, `eval/corpus/`, `eval/value-chains/`, `docker/`, the root package
files or itself, and by hand (`workflow_dispatch`, input `action`: `deploy` or `restart`); one
run at a time, never cancelled. Without the secret `FLY_API_TOKEN` it skips with a notice and
stays green. It installs flyctl 0.4.108 from the release tarball with its sha256 (no setup
action), deploys with `--remote-only --ha=false` and the run as seed id, and runs `analyzr-demo
check` against the public URL. It does not wait for CI; the build-time seed, the blue-green
health check and the check gate it. Since `main` is the default branch, a `workflow_run` trigger
on "CI" could gate it as well; that is optional and not used. Setup, reset and troubleshooting:
[Demo deployment](#demo-deployment-flyio). The Playwright tests (also the value chain import harness and CSS check, and
since M6 S3c step 1 the spec render harness) are not in CI; the bundle guard of the web (`apps/web/test/bundle.test.ts`) runs with `pnpm test`. `examples/agents` is outside the workspace:
CI only runs Prettier over its JSON files; `run-headless.sh` is not shellchecked, and no setup
runs against a model. `eval:live` needs a live project and is not in CI either.

## Verified end to end

Runs before 2026-10-11 were made in the repository `Miragon/ProA` (branch `claude/proa-2`) under
the ProA names: the `proa` CLI, the compose project `proa2` with the container `proa2-proa-1`,
the procedure ids `proa-*` and the Fly app `proa-demo`. Commit hashes and CI run ids below refer
to that repository; the commands are given with the analyzr names.

On 2026-10-07, on macOS with Docker Desktop (Compose v5.5.1), Node 24.15.0, pnpm 11.1.3 and
Claude Code 2.1.292, starting from a clean state (`down -v`):

1. `docker compose -p analyzr -f docker/compose.yaml up -d --build --wait`: both containers
   healthy. `analyzr seed` in the container: the counts in [Load the test landscapes](#load-the-test-landscapes),
   equal to `eval/reports/candidates.json`.
2. curl: `/health` ok; `/` and a deep UI link 200 HTML; OpenAPI 3.1 with 22 operations;
   anonymous API 401; a foreign `Host`, a foreign `Origin` and a localhost `Origin` on another
   port 403; the landscape ETag `"s105"` answered 304; `/mcp` without a token 401; `/.well-known/…` 404.
3. The MCP contract test (28 tests) and the live check (6 tests) above, the latter against the
   Docker stack, including both Claude Desktop entries started as Claude Desktop starts them.
4. Claude Code: `claude mcp add --scope project --transport http analyzr http://127.0.0.1:7400/mcp
   --header 'Authorization: Bearer ${ANALYZR_TOKEN}'` in a new directory under `/private/tmp` with
   its own `CLAUDE_CONFIG_DIR`, so the user's Claude configuration stayed untouched; the server
   approved there; `claude mcp list` showed `✔ Connected`, with a wrong token the 401 message,
   without `ANALYZR_TOKEN` the missing-variable warning. No prompt was run. The token was revoked.
5. Playwright against the Docker stack: the smoke test (3 tests) and the screenshots.
6. All gates: `pnpm -r typecheck`, `pnpm -r lint`, `pnpm format:check`, `pnpm -r test` (server
   570, cli 50 plus 6 live tests skipped, web 52, bpmn-facts 134, relations 57, contracts 23,
   procedures 6, client 4, eval/tools 27), `pnpm eval:candidates` (pass, report unchanged),
   eval/tools `check` and `validate:all`, `pnpm build`, client generation without drift,
   `docker build -f docker/Dockerfile .` (rerun after the review fixes, also on 2026-10-07).
7. Port override with a second, throwaway compose project (`ANALYZR_HOST_PORT=7402
   ANALYZR_DB_PORT=55433`): health ok, `Origin` on 7402 accepted, on 7400 refused.
8. Review fixes against the rebuilt stack: security headers on UI and API responses; 422 for
   `limit=0`, a malformed model id, `status=bogus` and a NUL project ref, 415 for an import
   with `text/plain`; in headless Chromium, an agent token with `analyzr:write` uploads BPMN with
   an XHTML `<script>`, the owner opens its content URL, and the browser downloads it instead
   of running it (before the fix the script minted an agent token as the owner); the Playwright
   smoke test with its CSP-violation check; `docker run analyzr:local` without
   `ANALYZR_ALLOW_NON_LOOPBACK=1` refuses to start (exit 1); `analyzr status` on the host with a
   stale `~/.local/state/analyzr/owner-key` reports the server only (exit 0).

M2 simulation agent, on 2026-10-08 (same machine, Node 24.15): PostgreSQL in a throwaway compose
project (`ANALYZR_DB_PORT=55441 docker compose -p analyzr-sim -f docker/compose.yaml up -d --wait db`),
the server from the checkout on port 7441 with its own owner key, `analyzr seed --issue-tokens`, then
`pnpm agent-sim --record rec --record-input summary --no-record-ids` with the `nordwind-handel`
token over HTTP (31 tasks submitted) and `node apps/agent-sim/src/main.ts --stdio …` with the
`stadtwerke-auental` token through the bridge (26 tasks); both recordings byte-identical to
`eval/recordings`, `eval:replay --recordings rec` gave the committed numbers, `analyzr status` showed
no model waiting for an agent and only the rule tier's acceptances. A requeue of all models, a dry
run of two tasks (both queued again, attempts 0) and a second full run (all 96 proposals
`duplicate`, nothing withdrawn) followed; then `down -v`. The owner's `analyzr` stack was not
touched.

M2 review UI, on 2026-10-08 (same machine): PostgreSQL in a throwaway compose project
(`ANALYZR_DB_PORT=55471 docker compose -p analyzr-m2web -f docker/compose.yaml up -d --wait db`), the
server from the checkout on port 7431 with its own owner key and the freshly built UI, `analyzr seed`;
Playwright in Chromium with `ANALYZR_E2E_URL=http://127.0.0.1:7431`: the review flow (7 tests), the
smoke test (3) and the screenshots (M1 retaken, since the relations table and the model view now
link to the review screen, plus `m2-*.png`), no CSP violation. Then the gates: `pnpm format:check`,
`pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` (web 98, server 723, cli 50 plus 6 live tests
skipped, agent-sim 36, relations 61, bpmn-facts 134, contracts 32, procedures 6, client 4,
eval/tools 32), `pnpm eval:candidates` (pass, report unchanged) and `pnpm build`; then `down -v`.
Not run for the UI: the Docker image and the CI docker job, other browsers than Chromium, screen
readers.

### M2 end to end (2026-10-08)

Everything of M2 together, on the owner's `analyzr` stack (until then the M1 image with the M1
seed; a `pg_dump` was taken first) and a second compose project from the same image:

1. **Upgrade in place.** `docker compose -p analyzr -f docker/compose.yaml up -d --build --wait`
   applied migrations 0002 and 0003 to the M1 database; the engine backfill gave every one of the
   57 models the engine `@analyzr/bpmn-facts` detects (27 `c7`, 30 `c8`). `analyzr seed`: all files
   `unchanged`.
2. **Pipeline.** One read+propose token per project (`analyzr token create` in the container).
   `analyzr-agent-sim` over HTTP on `nordwind-handel` (31 tasks, 96 proposals: 48 applied, 48
   duplicate; 256 no-links) and through the bridge in the container (`--stdio-command
   "/usr/local/bin/docker exec -i -e ANALYZR_TOKEN analyzr-server-1 analyzr mcp"`, Claude Desktop's Docker
   entry) on `stadtwerke-auental` (26 tasks, 104 proposals: 52 applied, 52 duplicate). The
   recordings (`--record-input summary --no-record-ids`) are byte-identical to `eval/recordings`,
   also on this upgraded database. Stages moved from 31 and 26 "waiting for agent" to 28 "waiting
   for review" + 3 "incorporated" and 20 + 6; every proposed relation's provenance names the
   token's principal and client, `analyzr-relations@0.0.1` and `sim-policy-1`; findings that a
   proposal answers are hidden (14 → 8 and 17 → 16). The inbox in Chromium shows the same counts.
3. **Agents cannot decide.** The live check (7 tests, incl. `decide_relation` for every verdict
   and REST `POST …/decision` with an agent token: 403 `human-decision-required` with the stack's
   `reviewUrl`, nothing changed) passed against the stack before and after the final rebuild.
4. **Review in the browser** (`e2e/pipeline.spec.ts`, see [Tests](#tests)) against the second
   project `ANALYZR_HOST_PORT=7460 ANALYZR_DB_PORT=55460 docker compose -p analyzr-e2e -f
   docker/compose.yaml up -d --build --wait`, so the owner's queue stays undecided: accept, two
   rejections with reasons, a hold with a question and its answer, a correction, the key-tier bulk
   accept with the generic "Antwort" pair and both targets of the duplicate process id left open;
   then the re-upload of `finanzen/zahlungslauf`, `suppressed` for the unchanged rejected pair
   over MCP, `reopened` for the changed one by the agent's second run, accepted and held relations
   unchanged. With the review (7) and smoke (3) specs: 16 passed, no CSP violation; screenshots
   `m2-01` … `m2-12`. Then `down -v`.
5. **Gates:** `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` (server
   723, web 101, cli 50 plus 7 live tests skipped, agent-sim 36, relations 61, bpmn-facts 134,
   contracts 32, procedures 6, client 4, eval/tools 32), `pnpm eval:candidates` (pass, report
   unchanged), `pnpm eval:replay` (reports byte-identical), eval/tools `check` and `validate:all`,
   client generation without drift, `drizzle-kit generate` without schema changes, `pnpm build`,
   and the image build (`up --build`).
6. **Fixed on the way:** the lease token's schema was zod `.startsWith()`, so `claim_analysis`
   declared `format: "starts_with"` and every SDK client printed a warning (now a `pattern`; the
   contract test allows only standard formats); the bulk accept took the agent's key-tier
   proposals that ask the reviewer a question, and both targets of a duplicate process id, without
   a look (now flagged and unchecked); its "Alle" box showed a tick while only some were selected
   (now a dash); the e2e helpers counted the diagrams before they were mounted.

Found and left open (decisions for the owner):

- An agent that leaves out decided pairs, as `sim-policy-1` does, has its earlier proposals on
  accepted and held relations of that model withdrawn by its next submission (supersession). The
  status stays, but the relation's `version` moves, so a reviewer who has it open gets the 409
  "inzwischen geändert" screen after an agent run. Since `0.2.0` only when the model changed:
  current judgements stay ([judge each pair once](#judge-each-pair-once)).
- `correct` towards a pair that already has a typed proposal (e.g. the key-tier message) creates a
  second, `manual` relation next to it; the typed proposal stays open.
- Revoking an agent token did not withdraw its proposals (CONCEPT §6 lists it as a mitigation);
  fixed below, [M2 review fixes](#m2-review-fixes-2026-10-08).
- Through the bridge in the container, `reviewUrl` carries the container's port 7400, which is
  wrong when `ANALYZR_HOST_PORT` moves the published port.
- The simulation agent writes English rationales and questions into a German UI; the real
  procedure (M3) decides the language. Decided in M3: German
  ([The relations procedure](#the-relations-procedure-m3)); `sim-policy-1` stays English.

State left behind: the `analyzr` stack runs the final image with both landscapes seeded and worked
by the simulation agent, nothing decided but the rule tier (`nordwind-handel`: 48 proposed, 28
models waiting for review; `stadtwerke-auental`: 52 and 20). The two simulation tokens
(`agent-sim-http`, `agent-sim-bridge`) and the live check's tokens are revoked; their proposals
stay (they were revoked before a revocation withdrew proposals).

Not verified: Claude Desktop itself (no GUI session; the bridge was started exactly as its
configuration says), the `local` and `user` scopes of `claude mcp add` (they write to the user's
Claude configuration; the HTTP exchange is the same as with the project scope), Cursor, VS Code
and Codex, other operating systems, `pnpm dev` in this run (earlier stages verified it), and
`ci.yml` on GitHub (only parsed locally).

### M2 review fixes (2026-10-08)

A review of the M2 state (pipeline, security, UX) found 15 issues; all were verified and fixed,
none rejected. Each fix has a test that fails without it (checked by disabling the fix for 1–7, 9
and 10):

1. A late submit on a `failed` task passed after a newer task of the model had run, and its
   supersession withdrew the newer proposals. Now 409 `task-cancelled` when a newer task exists or
   the model changed or was deleted after the failure.
2. A task whose third lease expired stayed `claimed` ("Agent arbeitet") until somebody claimed in
   the project; pending did not count it, and requeue answered `open`. Now the pending count and a
   requeue fail it too (requeue then queues a new task; an expired lease with attempts left is
   cancelled and requeued), and the inbox marks an expired lease with "Erneut einplanen".
3. A human's later proposal replaced that human's own decision (per-principal stance), so an
   accepted relation turned `proposed` and, after supersession, `obsolete`. Now a human's latest
   decision stays in force until the same human decides again (`decisionsInForce`); the property
   tests' oracle follows.
4. MCP `submit_analysis` took up to the SDK default of 4 MiB and stored it. Now the MCP endpoint
   refuses requests over 1 MB + 16 KB (HTTP 413), and the use case refuses a stored payload over
   1 MB (`payload-too-large`) for REST and MCP alike.
5. U+0000 in agent or human text gave a 500 and lost the whole submission. Now submission items
   answer `invalid:control-characters` (a new reason in the contracts, OpenAPI, client and MCP
   snapshot), other free text (decisions, bulk decisions, notes, ad-hoc proposals, release reason)
   is refused with 422, declared procedure and LLM model are names, and the stored payload keeps
   U+0000 as U+FFFD.
6. One token could take all 200 long-poll slots. Now at most 8 waits per caller (principal).
7. Revoking a token now withdraws its live proposals and hands its claimed tasks back (CONCEPT
   §6); the revoke dialog says so (since 0.2.0 it also names the withdrawn no-links and the models
   it judged, which wait for an agent again).
8. Accepted relations whose endpoint changed kept models in "Wartet auf Prüfung" but were in no
   list, and "Annehmen" was disabled. Now they are in the queue and the tab count ("Angenommen,
   Endpunkt geändert") and can be accepted again ("Erneut annehmen").
9. The bulk dialog kept a pair checked after a 409 reload although it was flagged now. Deliberate
   checks now hold for the version seen.
10. The review screen kept the previous relation's "Beleg" after navigating by link or history.
    Cited elements now belong to their relation; evidence switches to the hidden pane, and refs
    into other models link to the model view.
11. A pane for a deleted endpoint model spun forever; it now names the missing model.
12. "Stufe" meant both the pipeline stage and the tier on the inbox; the pipeline stage is now
    "Phase" (models table, filter, stage list), and the provenance says "Vorgeschlagen
    von"/"Entschieden von" and "LLM-Modell".
13. "Vorschläge zeigen" on a model waiting for clarification opened an empty list; it now opens
    its held items, and the review screen walks and returns to the held list (`view=held`).
14. The correction candidates were up to 60 tab stops without arrow keys, and Cmd/Ctrl+Enter did
    nothing there or in the held list's answer. Now one Radix radio group, Cmd/Ctrl+Enter in both
    forms, and "Abbrechen" starts afresh.
15. `agent-sim.test.ts` told maintainers `vitest run -u <file>` (updates every snapshot); now
    `vitest run <file> -u`.

Verified afterwards, on the same machine:

- Gates: `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` (no dependency violations),
  `pnpm -r test` (server 738, web 112, cli 50 plus 7 live tests skipped, agent-sim 36, relations
  61, bpmn-facts 134, contracts 33, procedures 6, client 4, eval/tools 32), `pnpm eval:candidates`
  and `pnpm eval:replay` (reports and recordings byte-identical), eval/tools `check` and
  `validate:all`, client generation without drift, `drizzle-kit generate` without schema changes,
  `pnpm --filter @analyzr/web build`.
- E2E step 1: a `pg_dump` of the owner's database, then `docker compose -p analyzr -f
  docker/compose.yaml up -d --build --wait` with the final code (the image build); `analyzr seed`
  all `unchanged`; `analyzr status` identical before and after (48 and 52 proposed, 28 and 20 models
  waiting for review).
- Step 3: the live check (7 tests) against the owner's stack; nothing changed there but two
  created and revoked tokens.
- Steps 2 and 4 on a throwaway project from the same image (`ANALYZR_HOST_PORT=7460
  ANALYZR_DB_PORT=55460 docker compose -p analyzr-e2e …`, removed with `down -v` afterwards), so the
  owner's queue stays undecided: `analyzr seed`, the M1 screenshots retaken from that fresh seed
  (the models table now says "Phase"), one token per project, `analyzr-agent-sim` over HTTP on
  `nordwind-handel` (31 tasks, 48 applied, 48 duplicate) and through the bridge in the container
  on `stadtwerke-auental` (26 tasks, 52 and 52), both recordings byte-identical to
  `eval/recordings`, the same stages, findings and provenance as before; revoking the
  `nordwind-handel` token withdrew its 48 proposals (33 rule-tier key proposals stayed); then
  `pipeline.spec`, `review.spec` and `smoke.spec` in Chromium (16 passed) with the `m2-*`
  screenshots retaken.

State left behind: the `analyzr` stack runs the image with these fixes, its data as before (both
landscapes seeded and worked by the simulation agent, nothing decided but the rule tier). The
`pg_dump` taken before the rebuild stays in the session's scratchpad.

### M3 (2026-10-08)

The M3 commits (`16c9f4b` claim input and MCP instructions, `5340ee2` live-run tooling, `81f96e4`
wrappers, plugin and reference setups, `23873a8` the release of `analyzr-relations@0.1.0`), same
machine, Claude Code 2.1.294. Verified without a model:

1. **Plugin.** `claude plugin validate --strict plugins/analyzr` and `claude plugin validate --strict
   .` (the marketplace) pass, rerun on the final tree with plugin version 0.1.0. The validator
   checks the manifests only, neither the skill nor a `.mcp.json` (shown with a deliberately
   broken scratch copy); the skill's frontmatter was parsed once with the workspace's `yaml`
   2.9.1. A deliberate drift of the skill was caught by `plugin.test.ts` and repaired by
   `generate`.
2. **`run-headless.sh`.** `bash -n`; shellcheck 0.10.0 (`--severity=style`, in a throwaway
   container) without findings; dry runs with a fake pending endpoint and a fake `claude` on
   `PATH`: 7 pending tasks in batches of 3 gave three batches and exit 0 with the temporary
   directory removed and the `claude -p` flags as documented; a pending count that did not go
   down stopped with "no progress" (exit 1); a rejected token, bad arguments, a missing
   `ANALYZR_TOKEN` and a set `ANTHROPIC_API_KEY` without `--allow-api-billing` exit 2.
3. **Agent SDK worker** (removed on 2026-10-08: the owner decided against the Agent SDK for
   now). In an isolated `npm install` of a scratch copy, `tsc --noEmit` against
   `@anthropic-ai/claude-agent-sdk` 0.3.293 passes; `--help`, a missing key, an alias as model and
   `--once` (nothing pending, and a 401) behave as documented without starting a `query()`.
   `docker build` of its Dockerfile succeeds; the image prints `--help` and refuses to start
   without `ANTHROPIC_API_KEY`. Nothing of it is committed; the image was removed.
4. **Codex.** `config.toml` parses (Python 3.12 `tomllib`); its keys follow OpenAI's
   documentation. Not run.
5. **Claim input.** `claim-input-size.test.ts` on both landscapes: at most 80.1 KB and 74.8 KB,
   mean 40.8 KB and 48.6 KB, every addition present; the regenerated simulation recordings
   changed only in `input.bytes`, and `eval:replay` gave the same numbers.
6. **`eval:live` smoke test** (before the release, so the claims still named
   `analyzr-relations@0.0.1`): PostgreSQL in a throwaway compose project `analyzr-m3blive`, the server
   from the checkout on port 7452, `analyzr seed nordwind-handel --project nordwind-live-1
   --issue-tokens --token-name claude-code-1`, and `analyzr-agent-sim` with that token through all
   31 tasks. `eval:live` wrote `analyzr-relations@0.0.1/claude-code-1/sim-policy-1/nordwind-handel.jsonl`,
   byte-identical to the committed simulation recording once `input` is removed and the agent
   renamed. Scored with `--no-write` against `eval/recordings`, the gate took the `agent-sim`
   baseline (recall 78.6 %) and failed with exit 1 on 3 must_not_link pairs at ≥ 0.8, the
   simulation agent's known high-confidence hits. Then the server was stopped and the project
   removed with `down -v`; the owner's `analyzr` stack was not touched.
7. **Gates** on the final tree: `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` (no
   dependency violations, 85 modules, 299 dependencies), `pnpm -r test` (server 750, web 112, cli
   55 plus 7 live tests skipped, agent-sim 36, relations 61, bpmn-facts 134, contracts 36,
   procedures 21, client 4, eval/tools 49), `pnpm eval:candidates` (pass, report unchanged) and
   `pnpm eval:replay` (reports and recordings unchanged).
8. **Review fixes** on top of `f50e550` (version `0.1.0` kept; its skill gained the version rule
   and `disable-model-invocation`, and `RELEASED` holds the new hash):
   - `run-headless.sh`: `bash -n`, shellcheck 0.10.0 and 0.11.0 without findings; dry runs (bash
     3.2, fake pending endpoint, fake `claude`): a run to the end (7 pending, batches of 3, exit
     0, cost 1.5000, temporary directory removed); `claude` exiting 1 with
     `error_max_budget_usd`, exiting 0 with `is_error` or without JSON, and a good batch followed
     by a failing one each stop with `stopped: batch N failed`, exit 1 and no `done`; no progress
     exits 1 with the MCP hint; `max-batches` exits 0; a `ANALYZR_LOG_DIR` holding `batch-*.json`
     exits 2 with its files untouched and no cost line, an empty one works; `ANALYZR_URL=…///`
     reaches `claude` without the slashes; a temporary directory removed mid-run exits 2 before
     the next batch; analyzr unreachable exits 2.
   - Agent SDK worker (removed on 2026-10-08: the owner decided against the Agent SDK for now),
     with a fake Claude Code executable in a scratch copy: the child's
     `--mcp-config` carries `Bearer ${ANALYZR_TOKEN}` and its environment the token; a task ending in
     `error_max_budget_usd` prints its JSON line and its cost counts; three in a row stop the
     worker with exit 1; a failed MCP server is still an error. That Claude Code expands
     `${ANALYZR_TOKEN}` in `--mcp-config` JSON was checked with Claude Code 2.1.293 and 2.1.294
     against a local server that logs the header.
   - Codex: with codex-cli 0.159.3, `codex sandbox` in `read-only` and `workspace-write`, started
     from an empty directory, read the checkout's files and listed `eval/` by absolute path, so a
     working directory does not isolate Codex ([its README](../examples/agents/codex/README.md#not-isolated-from-the-checkout)).
   - `claude plugin validate --strict` passes with the new frontmatter; `pnpm eval:replay
     --recordings nope --no-write` started in `docs/` names `<root>/nope` and exits 2.
   - Gates: `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint`; tests of procedures (22),
     eval/tools (55), cli (55 plus 7 live tests skipped, e2e included) and the server's
     `procedure-text.test.ts` and `mcp-contract.test.ts` (48, snapshots unchanged);
     `pnpm eval:candidates` (pass) and `pnpm eval:replay` twice (reports unchanged).

LLM dev runs: three dev runs on 2026-10-08, each on a fresh `nordwind-handel` project of a scratch stack, every task worked by its own Claude Sonnet 5.5 subagent of the implementing Claude Code session through the real MCP tools (called with a command-line MCP client instead of a native connection). Projects `nordwind-dev-1` to `-3` on a server started from the
checkout (port 7410, its own compose database `analyzr-m3`), seeded with `analyzr seed nordwind-handel
--project nordwind-dev-<n> --issue-tokens --token-name claude-sonnet-dev-<n>`; each subagent got
the `work_pipeline` prompt (`maxTasks` 1) and worked one task. All three runs: 31 of 31 tasks
submitted, 0 invalid items, precision 100.0 %, recall 78.6 % (all 33 non-call must_link pairs;
∪ rule tier 100 %), F1 88.0 %, 0 must_not_link, 6 questions (all on `may_link` pairs: the
ambiguous and dynamic calls, one conditional trigger); `pnpm eval:live` recorded and scored each
run (into a scratch directory) and reported the gate `pass` after the third. Run 1 used a draft
that the released text refines in five places. Per task 1–3 minutes and about 75,000 tokens in
that harness (instructions, claim input, tool results), which at Sonnet 5.5 API prices is roughly
$0.15–0.20. The subagents' tool calls were audited: none read outside its work directory. The
recordings are not committed and do not count for the gate.

Not verified: any run with a model besides the dev run above: `/analyzr:relations` and
`/analyzr:work_pipeline` in Claude Code, interactively or through `run-headless.sh` (that
`claude -p "/analyzr:relations …"` expands the skill and that `--tools ""` with `alwaysLoad` leaves
the agent analyzr's tools follows Claude Code's documentation, not a test, as does that Claude Code
honours `anthropic/maxResultSizeChars`), the Claude Desktop start
prompt, Codex; whether Claude Desktop offers the
`work_pipeline` prompt; installing the plugin from the marketplace (`claude plugin install
analyzr@analyzr`); the image with the M3 code (`up --build`, `analyzr seed --project` in the container)
and `ci.yml` on GitHub.

### Judge each pair once, `analyzr-relations@0.2.0` (2026-10-08)

Commit `7126f0b` ([Judge each pair once](#judge-each-pair-once)), same machine. Verified without a
model:

1. **Gates** on the final tree: `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint`
   (dependency-cruiser clean), `pnpm -r test` with `CI=1` (server 794, web 116, agent-sim 37,
   contracts 42, procedures 22, eval/tools 57; the other packages unchanged), `pnpm
   eval:candidates` (pass, report unchanged) and `pnpm eval:replay` twice (reports stable; the
   score lines equal those under `0.1.0`, now with 0 pairs judged twice and 0 uncovered on both
   landscapes). `drizzle-kit generate` after migration 0004 writes nothing.
2. **Claim input.** `claim-input-size.test.ts` with every task claimed at once: at most 82.0 KB
   (`nordwind-handel`, `vertrieb/order-handling`) and 75.5 KB, mean 40.6 and 48.6 KB; seeded with
   LLM-sized judgements 92.9 KB; the simulation agent's recorded inputs at most 86.7 KB.
3. **Simulation agent.** The recordings moved to `analyzr-relations@0.2.0` with identical scores; on
   `nordwind-handel` 48 proposals instead of 96 and 150 no-links instead of 256, all `applied` or
   `stored`, nothing withdrawn, nothing invalid, `uncovered` 0; under `0.1.0` it judged 154 and 121
   pairs twice. `agent-sim.test.ts` reproduces both files byte for byte, and `eval:live`'s reader
   rebuilds them from the stored submissions (input aside).
4. **Web.** During the implementation the review e2e (8 tests, incl. the no-link in queue, bulk
   dialog and review screen), the pipeline flow (6) and the smoke test (3) passed in Chromium
   against a throwaway compose project `analyzr-webnolink` and the server from the working tree, with
   the freshly built UI; then `down -v`. No screenshot shows the no-link callout; `m2-*.png` is
   unchanged.

Left open: the remaining double work of [judge each pair once](#judge-each-pair-once)
(`compatible` pairs that two concurrent partner searches both examine, re-claims after a lease
expired, candidate-cap drift).

LLM dev runs of `0.2.0`: three runs on `nordwind-jo-1` to `-3` (scratch stack, Sonnet 5.5 subagents,
concurrent claims): precision 100.0 %, recall 78.6 %, F1 88.0 %, 0 must_not_link, 6 questions, 40
proposal items, 205–209 no-link items, 8–10 pairs judged twice (`0.1.0`: 148–160), 0 / 2 / 0
uncovered; live gate `pass` in that harness (details in
[M3-RELATIONS-PROCEDURE.md](M3-RELATIONS-PROCEDURE.md#dev-run-numbers)).

Not verified: the owner's clients with `0.2.0`, the image with
this commit (`up --build`; the owner's `analyzr` stack was not touched, so migrations 0004 and 0005
have not run on its data), and `ci.yml` on GitHub.

### Judge each pair once: review fixes (2026-10-08)

A review of `7126f0b` and `3f087c9` confirmed six defects; fixed before `0.2.0` was published, so
the version stays and its text and pinned hash (`RELEASED` in `plugin.test.ts`) changed; skill and
plugin regenerated. The `0.2.0` dev runs above used the earlier text.

1. **Relations outside the assigned candidates** were judged by both endpoint analyses under
   concurrent claims (a relation on a `compatible` pair, or on no candidate at all). `planClaim`
   now takes the relations touching the model (`isAssignedRelation`: not `manual`, not obsolete,
   not settled, no missing end) as assigned pairs under rules 1–3, and a `compatible` candidate
   that is such a relation counts as assigned; rule 2's partner pair sets include them too. They
   land in the stored assignment, so partners skip them and `uncovered` counts them; procedure §4
   "your pairs" is exactly the assignment.
2. **A confirmed held pair** left no judgement (`suppressed`, not recorded, while supersession
   withdrew the agent's older stance), so every later claim assigned it again. A pipeline proposal
   on a relation whose decision in force is a human hold with the same fingerprints now goes
   through the own-stance duplicate check and is recorded otherwise (`applied`); the status stays
   `held` (`decisionsInForce`). Ad-hoc proposals and human acceptances and rejections stay
   `suppressed`. Procedure §10 and §11 say so.
3. **A no-link answered `duplicate`** (the caller's current no-link from another model's analysis)
   did not replace the caller's own proposal from this model's earlier analysis; the replacement
   now uses every valid no-link item, stored or duplicate.
4. **A late submit after the task failed** reported `uncovered: 0`, because failing cleared the
   assignment. `failExpired` keeps it (claims read only queued and claimed tasks).
5. **`Relation.noLinks` could change without a version move** (a revert makes an older no-link
   current again). Ingest and model deletion move the version of every relation on the pair of a
   live no-link touching a model whose `facts_hash` changed (`touchNoLinkRelations`).
6. **The web revoke dialog** now names the 0.2.0 consequences (proposals and no-links withdrawn,
   its tasks and the models it judged queued again, decisions stay, let the token expire instead).

Tests: `judge-once.test.ts` gained five integration tests (a relation on a compatible pair under
two concurrent claims and in one claim call, a held pair across a procedure release, the duplicate
no-link, a late submit after the failure, the revert and a bulk decision), the unit tests cover
relation pairs in `planClaim`, `isAssignedRelation` and `classifyProposal` under a hold;
`review.test.ts` expects a recorded confirmation of a held item; the web test checks the dialog
text. MCP tool descriptions (`claim_analysis`, `submit_analysis`), the OpenAPI descriptions and
the client were regenerated. Gates on the final tree: `pnpm format:check`, `pnpm -r typecheck`,
`pnpm -r lint` (dependency-cruiser clean), `CI=1 pnpm -r test` (server 802, web 116, agent-sim
37, contracts 42, procedures 22, eval/tools 57), `pnpm eval:candidates` (pass, report unchanged)
and `pnpm eval:replay` twice (reports unchanged: the simulation agent's recordings are reproduced
byte for byte, 0 pairs judged twice, 0 uncovered).

### M4 S0 (2026-10-08)

Consuming the value chain release ([M4-VALUE-CHAIN.md](M4-VALUE-CHAIN.md) §9 "S0 as
delivered"), on macOS with Node 24.15.0 and pnpm 11.1.3:

1. `npm view` and `npm pack` of `@miragon/value-chain-schema-model` and
   `@miragon/value-chain-renderer` 0.1.0, 0.2.0 and 0.3.0: the dependencies of 0.3.0 are zod 4.6.5
   (schema-model) and diagram-js 15.28.0, diagram-js-direct-editing 3.6.0, didi 12.0.0, tiny-svg
   4.1.4 and schema-model 0.3.0 (renderer); the `dist` files are identical in all three versions;
   neither package has an install script.
2. `pnpm add` of the exact versions (pnpm wrote the `minimumReleaseAgeExclude` entries, since 0.3.0
   was nine hours old), then `pnpm install --frozen-lockfile`: one `diagram-js` 15.28.0, one
   `diagram-js-direct-editing` 3.6.0 and zod 4.6.5 for the packages; a second `didi` (12.0.0, the
   renderer's, referenced only by its type declarations); no overrides.
3. The validator: all landscapes, `nordwind-handel` alone, `--builtin`, `--help` (exit 0); an
   unknown option and an unknown landscape (exit 2); with scratch copies of the script, an
   unverified version and an install that differs from the pin (exit 2) and a built-in copy that
   serializes differently (exit 1, "disagrees").
4. The specifier guard against a scratch edit (`link:` for the renderer in `apps/web/package.json`,
   a `file:` importer specifier and a tarball resolution in `pnpm-lock.yaml`): both guard tests
   failed naming exactly these three entries; the files were restored.
5. Review fixes, each against a scratch edit that was restored afterwards: the one-version check
   (schema-model 0.4.0 in `apps/web/package.json`; a second `diagram-js` and a second zod 4.x in
   `pnpm-lock.yaml`, the schema-model's zod moved to it) failed naming exactly these four
   problems; a dangling connection in the dev chain made the round trip fail with
   `loadDocument threw Error (message withheld …)`, no id in the output. The zod check resolves
   the schema-model's zod from its real path: from the pnpm link it would find the server's zod
   whatever the package pins, while the same lookup from `shadcn` finds zod 3.25.76, so the
   check can fail.
6. `docker build -f docker/Dockerfile -t analyzr:s0-check .`: `pnpm fetch`, then
   `pnpm install --offline --frozen-lockfile`, the web build and the production install passed; in
   the image `apps/server` imports the schema-model; the image was removed again (`analyzr:local` and
   the running stack untouched).
7. Gates: `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` (dependency-cruiser clean),
   `CI=1 pnpm -r test` (server 812, web 116, cli 55 plus 7 live tests skipped, agent-sim 37,
   relations 61, bpmn-facts 134, contracts 42, procedures 22, client 4, eval/tools 61),
   `pnpm eval:candidates` (pass, report unchanged), `pnpm eval:replay` (reports unchanged) and
   `pnpm build` (no chunk contains the renderer).

Not run: anything with the renderer in a browser (S3), the CI workflow itself.

### M4 S1 (2026-10-09)

Value chain storage and the placement lifecycle ([M4-VALUE-CHAIN.md](M4-VALUE-CHAIN.md) §9 "S1
as delivered"), on macOS with Node 24.15.0 and pnpm 11.1.3:

1. The golden relation digest was computed on `status.ts` before the generalisation and pinned;
   after the change it is unchanged. A mutation check (the anchor's key order swapped) fails it;
   the synthetic proposal's `sourceKind` does not reach any result (only decisions read it).
2. `pnpm --filter @analyzr/server db:generate --name value_chain` wrote `0006_value_chain.sql` with
   CREATE TABLE, ADD CONSTRAINT and CREATE INDEX for the five new tables only (no ALTER on an
   existing table); `drizzle-kit generate --custom --name value_chain_triggers` gave
   `0007_value_chain_triggers.sql`, written by hand; a second `db:generate` reported "No schema
   changes, nothing to migrate".
3. Gates: `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` (dependency-cruiser clean),
   `CI=1 pnpm -r test` (server 866, web 116, cli 55 plus 7 live tests skipped, agent-sim 37,
   relations 61, bpmn-facts 134, contracts 43, procedures 22, client 4, eval/tools 61),
   `pnpm eval:candidates` (pass, report unchanged) and `pnpm eval:replay` (reports and recordings
   unchanged).

Not run: the Docker image and the owner's `analyzr` stack (migrations 0006 and 0007 have not run
on its data), the CI workflow itself. Nothing calls the new code in production before S2.

### M4 S2 (2026-10-09)

The value chain and placements over REST, MCP and the CLI ([M4-VALUE-CHAIN.md](M4-VALUE-CHAIN.md)
§9 "S2 as delivered"), on macOS with Node 24.15.0 and pnpm 11.1.3:

1. `pnpm --filter @analyzr/client generate` after each contracts change (the core routes, then
   `getValueChainFindings` and `ValueChainFinding`); the MCP snapshot regenerated with
   `pnpm --filter @analyzr/server exec vitest run test/integration/mcp-contract.test.ts -u`, both
   protocol versions identical.
2. The CLI end to end (`apps/cli` `test:e2e`: a real server as a child process, PostgreSQL from
   Testcontainers): `analyzr seed`, then `analyzr value-chain push` of the golden dev chain (created
   r1, four rule proposals), a second push (`unchanged r1`), `pull` with a read token (the bytes
   equal the committed file), a push with that token refused before any request, and (review
   fixes) an edited file refused without `--base`, saved with `--base r1`, the stale golden file
   on `--base r1` answered "pull first".
3. The dev landscape with its golden chain through model changes with the real libraries
   (`value-chain-ingest.test.ts`): a process rename turned an accepted placement `changed`, the
   model's deletion `missing`, the original `ok` again; unchanged re-imports wrote no event;
   relations and findings equal to what the libraries compute for `eval:candidates`.
4. `pnpm --filter @analyzr/server exec drizzle-kit generate`: "No schema changes, nothing to
   migrate" (S2 needs no migration). `node eval/value-chains/validate-value-chains.mjs`: exit 0,
   the cross-check agrees on 2 of 2 (the holdout's files run through the validator for pass and
   fail only; no S2 test reads them).
5. Review fixes (same day): `prepareRevision` on oversized bodies now answers in milliseconds
   (an 8,000-step hierarchy chain of 1.74 MB: 71 ms, was 43 s; a 9,500-edge sequence star:
   48 ms; a chain at the limits: 8 ms); a mutation that takes the project lock after the
   `If-Match` check fails the concurrent-save tests (`[200, 200]`, `[201, 409]`); the client and
   the MCP snapshot regenerated (`geometry-out-of-range`, `rev` ≤ 999,999,999, the not-found
   texts naming `analyzr value-chain push`).
6. Gates: `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` (dependency-cruiser clean),
   `CI=1 pnpm -r test` (server 1,111, web 116, cli 71 plus 7 live tests skipped, agent-sim 37,
   relations 75, bpmn-facts 134, contracts 54, procedures 22, client 4, eval/tools 61),
   `pnpm eval:candidates` (pass, report unchanged) and `pnpm eval:replay` (reports and
   recordings unchanged).

Not run: the Docker image and the owner's `analyzr` stack, the CI workflow itself, anything in a
browser (S3 builds the chain page; the `reviewUrl` of refused agent writes points at it and
shows the web app's not-found page until then), an MCP client other than the SDK's in the tests.

### M4 S3 (2026-10-09)

The value chain page in the web UI ([M4-VALUE-CHAIN.md](M4-VALUE-CHAIN.md) §9 "S3 as delivered"),
on macOS with Docker Desktop, Node 24.15.0, pnpm 11.1.3 and Playwright's Chromium:

1. A throwaway stack that left the owner's `analyzr` stack (7400/55432) and his `analyzr:local` image
   alone: PostgreSQL only in the compose project `analyzr-s3`
   (`ANALYZR_DB_PORT=55501 docker compose -p analyzr-s3 -f docker/compose.yaml up -d --wait db`), the
   server from the checkout on port 7501 with its own `ANALYZR_OWNER_KEY_FILE` and the freshly built
   UI (`pnpm build`), `analyzr seed nordwind-handel`, and `analyzr value-chain push` of the golden dev
   chain (created r1, 34 steps, the rule tier's four proposals), which the page then rendered
   (the M4a criterion "the golden chain pushed with the CLI renders").
2. Playwright against it (`ANALYZR_E2E_URL=http://127.0.0.1:7501`): `value-chain.spec.ts` (13 tests),
   `value-chain-import.spec.ts` (3 tests, the extra-chain test skipped), and the existing
   `review.spec.ts` (8), `pipeline.spec.ts` (6, the simulation agent over MCP) and
   `smoke.spec.ts` (3), all passing, no CSP violation; the screenshots `m4-01` … `m4-08`. The CSS
   check found no difference in either direction.
3. The bundle guard: one `diagram-js` (15.28.0), one zod (4.6.5), one renderer and schema-model
   (0.3.0) in the web chunks; the entry chunk without them; the chain-only code 36.0 KB gzip
   (budget 40 KB) beyond a shared diagram-js chunk of 76.0 KB; the production chain chunk 89.6 KB
   gzip unsplit.
4. The MCP snapshot regenerated for the new `get_value_chain` description (both protocol
   versions identical); OpenAPI and the client unchanged.
5. Gates: `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` (dependency-cruiser clean),
   `CI=1 pnpm -r test` (server 1,111, web 184, cli 71 plus 7 live tests skipped, agent-sim 37,
   relations 75, bpmn-facts 134, contracts 54, procedures 22, client 4, eval/tools 61),
   `pnpm eval:candidates` (pass, report unchanged), `pnpm eval:replay` (reports and recordings
   unchanged), `pnpm build`, and `docker build -f docker/Dockerfile -t analyzr:s3-check .` (then
   `docker image rm analyzr:s3-check`). Then the server stopped by its PID and
   `docker compose -p analyzr-s3 -f docker/compose.yaml down -v`.

Not run: the holdout chain through the import check (S3 never reads it; the owner can with
`ANALYZR_E2E_VC_EXTRA`), the owner's `analyzr` stack and the CI workflow itself, other browsers than
Chromium, screen readers, a chain near the 500-element limit in the browser.

### M4 S3 review fixes (2026-10-09)

The review findings on the uncommitted S3 work ([M4-VALUE-CHAIN.md](M4-VALUE-CHAIN.md) §9 "S3
review fixes"), on macOS with Docker Desktop, Node 24.15.0, pnpm 11.1.3 and Playwright's Chromium:

1. A throwaway stack beside the owner's `analyzr` stack (7400/55432), which stayed untouched:
   PostgreSQL in the compose project `analyzr-s3`
   (`ANALYZR_DB_PORT=55511 docker compose -p analyzr-s3 -f docker/compose.yaml up -d --wait db`) and
   the server from the checkout on port 7511 with its own `ANALYZR_OWNER_KEY_FILE` and the freshly
   built UI; the server tests used the same database (`ANALYZR_TEST_DATABASE_URL`).
2. Playwright against it (`ANALYZR_E2E_URL=http://127.0.0.1:7511`): `value-chain.spec.ts` (15 tests,
   two new: a new chain's draft restored after a reload, an edit committed by the click on
   "Fertig" or a link), `value-chain-import.spec.ts` (3, the extra-chain test skipped),
   `review.spec.ts` (8), `pipeline.spec.ts` (6) and `smoke.spec.ts` (3), all passing, no CSP
   violation; the screenshots `m4-01` … `m4-08` retaken. The Vite dev server (StrictMode, port
   7521 against the same server) and the production build now open the golden chain with the
   same fitted viewbox.
3. The bundle guard: the entry chunk without the chain page, its components and the step view,
   192.9 KB gzip (ceiling 200 KB; Vite reports 638.4 KB / 195.9 KB), the page a route chunk of
   81.0 KB / 22.7 KB gzip; the chain-only code 36.1 KB gzip (budget 40 KB) beyond the shared
   diagram-js chunk of 76.0 KB.
4. Gates: `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` (dependency-cruiser clean),
   `CI=1 pnpm -r test` (server 1,111, web 205, cli 71 plus 7 live tests skipped, agent-sim 37,
   relations 75, bpmn-facts 134, contracts 54, procedures 22, client 4, eval/tools 61),
   `pnpm --filter @analyzr/web build`, `pnpm eval:candidates` (pass, report unchanged) and
   `pnpm eval:replay` (reports and recordings unchanged). Then the server and the dev server
   stopped by their PIDs and `docker compose -p analyzr-s3 -f docker/compose.yaml down -v`.

Not run: the Docker image build, the holdout chain through the import check, the owner's `analyzr`
stack and the CI workflow itself, other browsers than Chromium, screen readers.

### M4 S4 (2026-10-09)

The placement eval, `analyzr seed --value-chains` and the German rule-tier texts
([M4-VALUE-CHAIN.md](M4-VALUE-CHAIN.md) §9 "S4 as delivered"), on macOS with Docker Desktop,
Node 24.15.0, pnpm 11.1.3 and Playwright's Chromium. The holdout was touched only through
aggregate gates and count-only checks.

1. A throwaway stack beside the owner's `analyzr` stack (7400/55432) and his `analyzr:local` image,
   which stayed untouched: PostgreSQL in the compose project `analyzr-s4`
   (`ANALYZR_DB_PORT=55510 docker compose -p analyzr-s4 -f docker/compose.yaml up -d --wait db`), the
   server from the checkout on port 7510 with its own `ANALYZR_OWNER_KEY_FILE`; the server and CLI
   tests used the same database (`ANALYZR_TEST_DATABASE_URL`). `pnpm seed --value-chains`: both
   projects and both chains created (r1); a second run: `unchanged r1` twice, `_sample` "no
   golden value chain"; `analyzr value-chain pull` printed r1 with the sha256 of the dev chain file
   (= `golden.contentHash`); a push of an edited name saved r2, and the next
   `pnpm seed nordwind-handel --value-chains` reported `exists r2, differs from the golden chain:
   left unchanged` (JSON `{"outcome":"differs","rev":2}`). Over REST the dev project's four rule
   proposals were listed, and its value chain findings and relation findings came back with the
   German details.
2. Playwright against it with the built UI (`ANALYZR_E2E_URL=http://127.0.0.1:7510`):
   `value-chain.spec.ts`, 15 tests passing (no test reads the changed texts).
3. The image as `analyzr:s4-check` (`docker build -f docker/Dockerfile -t analyzr:s4-check .`; never
   `analyzr:local`): BuildKit honours the dockerignore re-include. `docker run --rm --entrypoint sh
   analyzr:s4-check -c '<the CI guard>'` passed; `/app/eval` holds `corpus` and `value-chains` with
   exactly the two chain files, no `expected-placements.yaml` anywhere in the image and no
   `expected.yaml` under `/app`. A container stack from that image (compose project `analyzr-s4c`,
   an override file with `image: analyzr:s4-check` and `pull_policy: never`, `up --no-build`,
   `ANALYZR_HOST_PORT=7511 ANALYZR_DB_PORT=55511`): `analyzr seed`, then `analyzr seed --value-chains` in the
   container (created r1 twice; again: unchanged r1 twice) and the CI guard in the container.
4. The agent-sim recordings re-recorded (`pnpm --filter @analyzr/server exec vitest run
   test/integration/agent-sim.test.ts -u`); a count-only comparison with HEAD: both files keep
   their line count and differ only in `input.bytes` (`nordwind-handel` 10 of 31 lines, at most
   88,778 bytes; the holdout file likewise, below the test's ceiling).
5. Gates: `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` (dependency-cruiser clean),
   `CI=1 pnpm -r test` (server 1,115, web 205, cli 83 plus 7 live tests skipped, agent-sim 37,
   relations 84, bpmn-facts 134, contracts 54, procedures 22, client 4, eval/tools 71),
   `pnpm eval:candidates` (pass, report unchanged), `pnpm eval:replay` (reports unchanged),
   `pnpm eval:placements` (pass; a second run wrote identical reports),
   `node eval/value-chains/validate-value-chains.mjs` (both landscapes ok, cross-check 2 of 2),
   `pnpm --filter @analyzr/server db:generate` (no schema changes), `pnpm build`. Then the server
   stopped by its PID, `down -v` of `analyzr-s4` and `analyzr-s4c`, and `docker image rm
   analyzr:s4-check`.

Not run: the CI workflow itself (the `eval:placements` step and the docker job's guard run on the
next push; that confirms the M4a criterion "`eval:placements` is green in CI"), the holdout chain
through the import check (an owner action, `ANALYZR_E2E_VC_EXTRA`), the owner's `analyzr` stack, the
other Playwright suites (no S4 change reaches them), other browsers than Chromium.

### M4 S5 (2026-10-09)

The `placement` pipeline kind, `analyzr-placements@0.1.0`, the prompts, the skill, Import, the
simulation agent's placement policy, the recordings and `eval:replay`
([M4-VALUE-CHAIN.md](M4-VALUE-CHAIN.md) §9 "S5 as delivered"), on macOS with Docker Desktop,
Node 24.15.0, pnpm 11.1.3 and Playwright's Chromium. The sim policy and the procedure were
designed on `nordwind-handel` only; the holdout was touched only through aggregate numbers, digests
and counts (its placement recording is compared by sha256 and never opened).

1. A throwaway stack beside the owner's `analyzr` stack (7400/55432), which stayed untouched:
   PostgreSQL 17.11 in the compose project `analyzr-s5e3` on 127.0.0.1:56632 (tmpfs, its own
   compose file in the scratch directory; the implementation used `analyzr-s5test` and
   `analyzr-s5edge` the same way) and the server from the checkout on port 7632 with its own
   `ANALYZR_OWNER_KEY_FILE`, its own database and the freshly built UI (`vite build` into a scratch
   directory, `ANALYZR_WEB_DIST`); the server tests used the same PostgreSQL
   (`ANALYZR_TEST_DATABASE_URL`).
2. Playwright against it (`ANALYZR_E2E_URL=http://127.0.0.1:7632`): 39 passed, 1 skipped (the
   holdout chain of the import check, an owner action): `value-chain-draft.spec.ts` (2, new: an
   invented draft into a new chain saved r1 with exactly the layouter's waypoints, checked in the
   import harness; an import over the golden dev chain with the confirmation and the impact
   dialog, saved r2), `value-chain-agent.spec.ts` (2, new: the stage before and after the
   simulation agent's placement task, „Agent unsicher“ and „Platzieren“), `value-chain.spec.ts`
   (15), `value-chain-import.spec.ts` (3), `review.spec.ts` (8), `pipeline.spec.ts` (6, the
   simulation agent now claiming both kinds) and `smoke.spec.ts` (3); no CSP violation. The
   import over the golden chain first showed an impact dialog taller than the window (every golden
   step removed: title and buttons out of view, „Trotzdem speichern“ unreachable); the impact lists
   now scroll inside the dialog (`ImpactLists`, also in the result dialog).
3. The bundle guard: the entry chunk and its static imports 193.1 KB gzip (ceiling 200 KB); the
   chain-only code 37.0 KB gzip (budget 40 KB; the canvas chunk 11.9 KB, the shared schema-model
   and zod chunk 24.7 KB, the import's `check-document` 0.4 KB) beyond the shared diagram-js chunk
   of 76.0 KB.
4. The live path against the same server, as the owner's placement runs go (M3-LIVE-RUNS.md
   step 6a): `analyzr seed nordwind-handel --project s5-live --value-chains --issue-tokens` (31
   relations tasks and 1 placement task pending, counted apart by `pending?kinds=`),
   `analyzr-agent-sim --kinds placement` (one task of 32 processes: 29 placed, 3 unsure, nothing left
   due; its recording equals the committed dev recording but for the landscape and `input.bytes`,
   which is smaller without the relation proposals of a relations run), `pnpm eval:live
   --no-write` (the placement line rebuilt from the stored submission, scored next to
   `baseline-prefix/1`, the placement live gate FAIL as expected for this floor, exit 1), and the
   chain page showing „Wartet auf Prüfung“ and „Agent unsicher (3)“ with „Platzieren“.
5. `run-headless.sh --skill placements`: `bash -n` and a dry run against a fake pending endpoint
   and a fake `claude` (two batches of `/analyzr:placements`, every pending request with
   `&kinds=placement`, a refused `--skill`); shellcheck was not installed. `claude plugin validate
   --strict` passes for `plugins/analyzr` (0.3.0) and the marketplace (Claude Code 2.1.296; the
   marketplace check still notes that the root README has no install line).
6. Gates: `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` (dependency-cruiser clean),
   `CI=1 pnpm -r test` (server 1,192, web 222, cli 83 plus 7 live tests skipped, agent-sim 56,
   relations 85, bpmn-facts 134, contracts 62, procedures 37, client 4, eval/tools 85),
   `pnpm eval:candidates` (pass, report unchanged), `pnpm eval:replay` twice (identical bytes; the
   relations part of `replay.{md,json}` byte for byte as before, the placement sections appended),
   `pnpm eval:placements` (pass, report unchanged), `node eval/value-chains/validate-value-chains.mjs`
   (exit 0; its output not read, since it names holdout steps),
   `pnpm --filter @analyzr/server db:generate` (no schema changes). Then the server stopped by its
   PID and `docker compose -f <scratch>/testdb.compose.yaml down -v` of `analyzr-s5e3`.

Not run: the Docker image build (the image copies `packages/`, so the prompt text is in it), a run
with a model (the procedure has no LLM run yet; the owner's live runs follow), Claude Desktop
with `draft_value_chain`, the owner's `analyzr` stack, the CI workflow itself, other browsers than
Chromium.

### M4 S5 review fixes (2026-10-10)

The review findings on the uncommitted S5 work ([M4-VALUE-CHAIN.md](M4-VALUE-CHAIN.md) §9
"Review fixes"), on macOS with Docker Desktop, Node 24 and Playwright's Chromium; the holdout
again only through aggregates, digests and counts.

1. A throwaway PostgreSQL in the compose project `analyzr-s5fix` (127.0.0.1:56720, the `db` service
   of `docker/compose.yaml` alone) beside the owner's `analyzr` stack, which stayed untouched; the
   server and CLI tests used it (`ANALYZR_TEST_DATABASE_URL`), and a server from the checkout on
   port 7520 with its own database and `ANALYZR_OWNER_KEY_FILE` in the scratch directory served the
   built UI.
2. Playwright against it (`ANALYZR_E2E_URL=http://127.0.0.1:7520`): `value-chain-agent.spec.ts` (3,
   new: a reviewer's rejection leaves one process due without a task, „Aufgabe einplanen“ queues
   it), `value-chain-draft.spec.ts` (2), `value-chain.spec.ts` (15) and
   `value-chain-import.spec.ts` (3, the holdout chain skipped): 23 passed, 1 skipped.
3. The server start on the same stack: `analyzr seed nordwind-handel --project vc-start
   --value-chains`, its placement task deleted by SQL (the state migration 0008 leaves an M4a
   chain in: `task: null`, 32 due), the server restarted by its PID: the log says `queued the
   first placement task of 1 value chain(s)`, the chain waits for the agent, and `analyzr value-chain
   requeue -p vc-start` answers that a task is already queued.
4. `run-headless.sh`: `bash -n` and dry runs against a fake pending and value chain endpoint and
   a fake `claude` (placements: pending 1 → 1 while due falls 80 → 30 with a new task id counts as
   progress, then 1 → 0; a batch that moves nothing stops with exit 1; relations: 2 → 1 → 0 with a
   trailing slash in `ANALYZR_URL`; a refused `--skill`); shellcheck was not installed.
5. Gates: `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` (dependency-cruiser clean),
   `CI=1 pnpm -r test` (server 1,203, web 227, cli 86 plus 7 live tests skipped, agent-sim 57,
   relations 85, bpmn-facts 134, contracts 62, procedures 37, client 4, eval/tools 86),
   `pnpm eval:candidates` (pass), `pnpm eval:replay` twice (identical bytes, and identical to the
   report before the fixes: the simulation agent's decisions and scores did not change, only its
   rationale texts in the recordings), `pnpm eval:placements` (pass, report unchanged),
   `node eval/value-chains/validate-value-chains.mjs` (exit 0), `drizzle-kit generate` (no schema
   changes). Then the server stopped by its PID and `docker compose -p analyzr-s5fix -f
   docker/compose.yaml down -v`.

Not run: the Docker image build, a run with a model, Claude Desktop, the owner's `analyzr` stack,
the other Playwright suites (no fix reaches them), other browsers than Chromium.

### Auto-accept rules, owner decision 19 (2026-10-10)

The core and edge of decision 19, on macOS with Docker
Desktop, Node 24 and Playwright's Chromium; the holdout only through aggregate rows and exit
codes.

1. A throwaway compose project `analyzr-autoaccept` beside the owner's `analyzr` stack, which stayed
   untouched: its `db` (127.0.0.1:55442) for the server and CLI tests (`ANALYZR_TEST_DATABASE_URL`),
   then the whole stack (`ANALYZR_HOST_PORT=7410 ANALYZR_DB_PORT=55442 docker compose -p
   analyzr-autoaccept -f docker/compose.yaml -f <override> up -d --build --wait`, the override
   tagging the image `analyzr-autoaccept:local` so `analyzr:local` was never retagged).
2. Playwright against it (`ANALYZR_E2E_URL=http://127.0.0.1:7410`): `auto-accept.spec.ts` (4) and
   the suites the change touches, `smoke`, `review`, `pipeline`, `value-chain`,
   `value-chain-agent`, `value-chain-draft`, `value-chain-import`: 44 passed, 1 skipped (the
   holdout chain of `ANALYZR_E2E_VC_EXTRA`). The screenshots `d19-01` … `d19-09` come from
   `auto-accept.spec.ts` with `ANALYZR_SCREENSHOTS_DIR`.
3. On the core's run of the same stack with nordwind seeded and worked by the simulation agent: a
   relation rule (key, 0.95) accepted 31 relations during submissions; a placement apply accepted
   19 (dry run first), revoking them restored everything with nothing due; previews took 10–20 ms.
4. Gates: `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` (dependency-cruiser: no
   violations, 121 modules), `CI=1 pnpm -r test` (server 1,305 in 60 files, web 254 in 29 files,
   cli 110 plus 7 live tests skipped (the CLI e2e incl. `analyzr rules` against a real server),
   eval/tools 92, agent-sim 57, relations 85, bpmn-facts 134, contracts 62, procedures 37, client
   4), `pnpm eval:candidates` (pass, report unchanged), `pnpm eval:replay` twice (identical bytes;
   `replay.{md,json}` only gained the what-if sections), `pnpm eval:placements` (pass, report
   unchanged), `node eval/value-chains/validate-value-chains.mjs` (exit 0), `drizzle-kit
   generate` (no schema changes); `git status` shows no change under `eval/recordings`,
   `packages/procedures` and `plugins`; the MCP tool and prompt snapshots unchanged. The bundle
   guard: entry chunk 197.2 KB gzip (ceiling 200 KB), chain-only code 37.0 of 40 KB.
5. Then `docker compose -p analyzr-autoaccept -f docker/compose.yaml down -v` and the image removed.

Not run: a run with a model, Claude Desktop, the owner's `analyzr` stack, other browsers than
Chromium, `screenshots.spec.ts` (M1 screenshots).

### Auto-accept rules, review fixes (2026-10-10)

The fixes of the decision 19 review round (HANDOFF §7), on
macOS with Docker Desktop, Node 24 and Playwright's Chromium; the holdout only through aggregate
rows and exit codes.

1. A throwaway compose project `analyzr-aafix` beside the owner's `analyzr` stack, which stayed
   untouched: its `db` (127.0.0.1:55462) for the server and CLI tests (`ANALYZR_TEST_DATABASE_URL`),
   then the whole stack (`ANALYZR_HOST_PORT=7462 ANALYZR_DB_PORT=55462`, an override tagging the image
   `analyzr-aafix:local`), `analyzr seed nordwind-handel --value-chains` in its container.
2. Playwright against it (`ANALYZR_E2E_URL=http://127.0.0.1:7462`): `auto-accept.spec.ts` (5, with
   the new 412 reload and the per-agent revoke) and `smoke`, `review`, `pipeline`, `value-chain`,
   `value-chain-agent`, `value-chain-draft`, `value-chain-import`: 45 passed, 1 skipped (the holdout
   chain of `ANALYZR_E2E_VC_EXTRA`). `d19-01` … `d19-09` were written again with
   `ANALYZR_SCREENSHOTS_DIR`, and `03-relations.png` (`screenshots.spec.ts -g "relations: rule
   acceptances"`) for the preset „Durch Systemregel angenommen“.
3. Gates: `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` (dependency-cruiser: no
   violations, 121 modules), `CI=1 pnpm -r test` with `ANALYZR_TEST_DATABASE_URL` (server 1,311 in 60
   files, web 266 in 29 files, cli 116 plus 7 live tests skipped, eval/tools 95, agent-sim 57,
   relations 85, bpmn-facts 134, contracts 62, procedures 37, client 4), `pnpm eval:candidates`
   (pass), `pnpm eval:replay` twice (identical bytes; `replay.{md,json}` changed only in the
   what-if: the section texts, the holdout without the tier split and with `hidden` rows; the dev
   rows are unchanged), `pnpm eval:placements` (pass, report unchanged), `node
   eval/value-chains/validate-value-chains.mjs` (exit 0), `drizzle-kit generate` (no schema
   changes); `git status` shows no change under `eval/recordings`, `packages/procedures` and
   `plugins`; the MCP snapshots unchanged; the client regenerated (`ApplyAutoAcceptResult` gained
   `enabled` and `authorIsOwner`, the ledger route its description and
   `human-decision-required`). The bundle guard: entry chunk 197.6 KB gzip, chain-only code 37.0
   of 40 KB.
4. Then `docker compose -p analyzr-aafix … down -v` and the image removed.

Not run: a run with a model, Claude Desktop, the owner's `analyzr` stack, other browsers than
Chromium, the other M1 screenshots.

### Read-only demo, owner decision 20 (2026-10-10)

On macOS (arm64) with Docker Desktop (Compose v5.5.1), Node 24.15 and Playwright's Chromium; the
owner's `analyzr` stack (ports 7400, 55432) stayed untouched.

1. A throwaway compose project `analyzr-testdb` (PostgreSQL 17.11 on 127.0.0.1:55491) for the test
   suites (`ANALYZR_TEST_DATABASE_URL`) and the manual runs below.
2. The demo image as Fly would build it, under a tag of its own:
   `ANALYZR_DEMO_IMAGE=analyzr-demo:verify docker compose -p analyzr-demo-verify -f
   docker/compose.demo.yaml up -d --build --wait` (968 MB, arm64). The seed stage took about 5 s
   (the counts in [What it is](#what-it-is)); the server listened about 1 s after the container
   started.
   `pnpm --filter @analyzr/demo check --url http://127.0.0.1:7480`: 124 checks passed, 0 failed.
3. Holdout: in the container no `/app/eval`, `/app/apps/cli` or `/app/apps/agent-sim`,
   `/opt/analyzr-demo` holds `pgdata-template` and `seed.json` only, and `find / -xdev` finds no
   `expected*.yaml`, `expected-placements*`, `*.jsonl`, recordings, reports or even a
   `value-chain.vc.json`; a `pg_dump` of the demo database (3.5 MB) contains none of
   `must_link`, `must_not_link`, `may_link`, `expected.yaml` or `expected-placements`. `docker history` shows no `eval` copy into the
   runtime stage. As the role `analyzr_demo`, `default_transaction_read_only` is `on` and an UPDATE
   fails ("cannot execute UPDATE in a read-only transaction").
4. Reset: `docker compose … restart demo` was healthy again after 2 s with the same `lastSeq`
   (`s253`, `s227`) and relation ids, and PostgreSQL started from the template ("database system
   was shut down at" the build's time). Idle memory 156 MiB of the 1 GB limit, one CPU.
5. Playwright against the demo (`ANALYZR_E2E_URL=http://127.0.0.1:7480`): `demo.spec.ts` 10 passed
   (one earlier run hung once in the stadtwerke value chain test and passed on every rerun);
   the whole suite there: 13 passed (the demo walk and the Vite-served import harness), 49
   skipped (the writing flows skip on the demo). The screenshots `demo-0*.png` came from that run.
6. Local mode next to it: the server from the checkout on 127.0.0.1:7492 with the freshly built
   UI and its own owner key in a scratch directory, a database in `analyzr-testdb`: the whole
   Playwright suite 45 passed, 17 skipped (the demo walk, the screenshots, the holdout import
   check of `ANALYZR_E2E_VC_EXTRA`).
7. The server in demo mode from the checkout: refused to start as the superuser ("needs a
   read-only database role"), then as the read-only role without the visitor ("run
   demo-bootstrap.ts"), and started after `demo-bootstrap.ts`.
8. Gates: `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` (dependency-cruiser: no
   violations, 125 modules), `CI=1 pnpm -r test` with `ANALYZR_TEST_DATABASE_URL` (server 1,381 in 63
   files, web 283 in 30, cli 116 plus 7 live tests skipped, eval/tools 95, agent-sim 57, demo 23,
   relations 85, bpmn-facts 134, contracts 66, procedures 37, client 4), `pnpm eval:candidates`
   (pass), `pnpm eval:replay` and `pnpm eval:placements` (pass, no change under `eval/`),
   `drizzle-kit generate` (no schema changes); the client regenerated (the problem code
   `demo-readonly`, `Health.demo`, `demo-readonly` on the write routes); a second generation
   changes nothing. The bundle guard: entry chunk 198.9 KB gzip of the 200 KB ceiling (+1.3 KB
   for the banner, the notices and the permission hooks), chain-only code 37.0 of 40 KB.
   actionlint 1.7.12 (without shellcheck) finds nothing in `demo-deploy.yml` and `ci.yml`.
9. Then `docker compose -p analyzr-demo-verify … down -v`, `docker image rm analyzr-demo:verify`
   and `docker compose -p analyzr-testdb … down -v`.

Not run, because no Fly account was available: `flyctl deploy` and the remote builder (the seed
in a Fly build step, an amd64 build), `flyctl config validate` (it needs a login), suspend and
resume, `fly machine stop`/`start`, a custom domain, the workflow on GitHub (the skip without
the secret, `gh workflow run … --ref <branch>`, "Re-run all jobs") and the CI job `demo`.
`docker/fly.demo.toml` was checked against the Fly configuration reference (docs.fly.io) and the
flyctl v0.4.108 source (how `dockerfile` and `ignorefile` resolve), and parsed as TOML.

**First deploy (2026-10-10, under the earlier names of the note above).** The owner logged in;
the app was created in the Fly organization `miragon`, an app-scoped deploy token (expires
2027-10-10) became the secret `FLY_API_TOKEN` without being printed, and `gh workflow run
demo-deploy.yml … --ref <branch> -f action=deploy` deployed (dispatching from a branch other than
the default one works once the workflow has run there): the remote builder ran the seed in the
build step, the blue-green deploy passed `/health`, and the smoke check passed 126 checks against
the app's fly.dev URL with both legal links. `fly ips list`: a shared IPv4 and a dedicated IPv6 (no paid dedicated IPv4);
one machine, no volume. Afterwards `auto_stop_machines` went from `suspend` to `stop` (the owner:
an idle demo costs nothing).

**Review round (2026-10-10, same machine).** Nine findings were checked against the code; all
were real and are fixed: the session body cap (an anonymous chunked 700 MB `POST
/api/v1/session` had pushed the 1 GB container to SIGKILL), `analyzr-demo check` writing to a
local-mode server as the owner (it had deleted a value chain), the reset docs (the 30-day limit
and the repeated commit and inputs of "Re-run all jobs", GitHub's documented dispatch of a
branch workflow once it has run), the deploy token's expiry, the cached seed of a manual
`fly deploy`, the no-links missing from the review (decision 20(4); now the inbox tab „Kein
Zusammenhang“ with `GET …/no-links`), write entry points in empty states for non-writers, and
gaps in the demo walk and the role tests.

1. A throwaway compose project `analyzr-rvdb` (PostgreSQL 17.11 on 127.0.0.1:55493) for the
   suites (`ANALYZR_TEST_DATABASE_URL`) and the local server below.
2. Gates: `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` (dependency-cruiser: no
   violations, 125 modules), `CI=1 pnpm -r test` (server 1,387 in 63 files, web 295 in 30, cli
   116 plus 7 skipped, eval/tools 95, agent-sim 57, demo 25, relations 85, bpmn-facts 134,
   contracts 66, procedures 37, client 4), `pnpm eval:candidates`, `pnpm eval:replay` and
   `pnpm eval:placements` (pass, no change under `eval/`), `drizzle-kit generate` (no schema
   changes); the client regenerated (`listNoLinks`, `NoLink`, 413 on `createSession`), a second
   generation changes nothing. The bundle guard: entry chunk 199.6 KB gzip of the 200 KB ceiling
   (a lazy-loaded no-link list measured 204.7 KB, as the split chunks compress worse, so the list
   is a static import).
3. The demo image under its own tag with a fresh seed: `ANALYZR_DEMO_SEED=review2b-<time>
   ANALYZR_DEMO_IMAGE=analyzr-demo:review2 ANALYZR_DEMO_PORT=7483 docker compose -p analyzr-demo-review2 -f
   docker/compose.demo.yaml up -d --build --wait` (968 MB; seed stage 5.8 s, 18.8 s on the
   first, cold build; `seed.json` carried the passed id). `analyzr-demo check`: 124 passed, 0
   failed. Both projects as `viewer`; `nordwind-handel` 31 models, 48 agent proposals (12 with a
   question), 150 no-links, 29 agent placement proposals, its chain with 34 steps;
   `stadtwerke-auental` 26, 52 (15), 101, 25, 38 steps. All 28 write routes of the contracts 403
   `demo-readonly` with the visitor's cookie and anonymously; `/mcp` 404 for GET, POST and
   DELETE.
4. The attack of the finding against the container: `head -c 700000000 /dev/zero | tr '\0' ' ' |
   curl -X POST -T - -H 'content-type: application/json' …/api/v1/session` answered 413
   `payload-too-large` after about 115 KB had been sent; memory stayed at 184 MiB, no restart, a
   normal session opened afterwards.
5. Health only after the seed: polling `/health` every 50 ms across `docker restart` gave no
   answer at all until the server listened, which it does only after PostgreSQL has started
   from the copied template ("database system was shut down at" the build's time); first 200
   about 2 s after PostgreSQL was ready, 5.3 s after the restart. The `lastSeq` (`s253`) was the
   same before and after.
6. Holdout: the runtime image has no `/app/eval`, CLI or agent, `/opt/analyzr-demo` holds
   `pgdata-template` and `seed.json` only, `find / -xdev` finds no `expected*`, `*.jsonl`,
   `value-chain.vc.json` or `eval/` path (none in `node_modules` either); a `pg_dump` of the
   demo database (3.5 MB) contains none of `must_link`, `must_not_link`, `may_link`,
   `expected.yaml`, `expected-placements`; the only `eval` in `docker history` is the runtime
   stage's check. The build context, exported with `Dockerfile.demo.dockerignore` (file names
   listed, none opened), holds under `eval/corpus` only `*.bpmn` and `landscape.yaml`, under
   `eval/value-chains` only the two `value-chain.vc.json`, and no `eval/recordings` or
   `eval/reports`.
7. Playwright against the demo: `demo.spec.ts` 12 passed (with the no-link tests and the wider
   write-action list), the screenshots `demo-0*.png` retaken, `demo-06-no-links.png` new.
8. Local mode next to it: the server from the checkout on 127.0.0.1:7494 (its own owner key in a
   scratch directory, database `analyzr_e2e` in `analyzr-rvdb`, the freshly built UI), `analyzr seed
   nordwind-handel --value-chains`: `analyzr-demo check --url http://127.0.0.1:7494` failed with
   „not a read-only demo: no write route was tried“, the chain still answered 200 and `lastSeq`
   stayed 111. The whole Playwright suite: 45 passed, 19 skipped (the demo walk, the screenshots,
   the `ANALYZR_E2E_VC_EXTRA` check).
9. Then the server stopped by its PID, `docker compose -p analyzr-demo-review2 … down -v`,
   `docker image rm analyzr-demo:review2` and `docker compose -p analyzr-rvdb … down -v`; the owner's
   `analyzr` stack and `analyzr:local` untouched.

**Legal links and the entry ceiling (2026-10-10, decision 21, same machine).** The banner's
„Impressum“ and „Datenschutz“ ([Legal pages](#legal-pages)) and the entry ceiling raised to
240 KB.

1. Gates: `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` (dependency-cruiser: no
   violations, 125 modules), `CI=1 pnpm -r test` with `ANALYZR_TEST_DATABASE_URL` on a throwaway
   `analyzr-legaldb` (server 1,392 in 63 files, web 298 in 30, cli 116 plus 7 skipped, eval/tools
   95, agent-sim 57, demo 27, relations 85, bpmn-facts 134, contracts 67, procedures 37, client
   4), `pnpm eval:candidates`, `pnpm eval:replay` and `pnpm eval:placements` (pass, no change
   under `eval/`); the client regenerated (`Health.imprintUrl`, `Health.privacyUrl`), a second
   generation changes nothing. The bundle guard: entry chunk 199.8 KB gzip (ceiling now 240 KB),
   chain-only code 37.0 of 40 KB.
2. The banner measured in Chromium at 320, 360, 375, 390, 414, 600, 640, 768, 1024, 1280 and
   1440 px: 40 px high everywhere, both links whole and inside the viewport, nothing truncated,
   no sideways scroll (below 360 px the text is `text-xs`; the repository link from 480 px, the
   two sentences from 1024 and 1280 px).
3. The demo image under its own tag with a fresh seed: `ANALYZR_DEMO_SEED=legal-<time>
   ANALYZR_DEMO_IMAGE=analyzr-demo:legal ANALYZR_DEMO_PORT=7487 docker compose -p analyzr-demo-legal -f
   docker/compose.demo.yaml up -d --build --wait`. `/health` answered
   `{"status":"ok","version":"0.1.0-alpha.0","db":"ok","demo":"readonly","imprintUrl":"https://miragon.io/impressum","privacyUrl":"https://miragon.io/datenschutz/"}`,
   the start log named both links; `analyzr-demo check`: 126 passed, 0 failed (the two link checks
   new), and it printed both links. The runtime image still holds no eval file.
4. The same image with `ANALYZR_DEMO_IMPRINT_URL=http://miragon.io/impressum` and an empty
   `ANALYZR_DEMO_PRIVACY_URL` (`docker compose -p analyzr-demo-legalbad … run --rm`): the server
   refused to start and named both, the supervisor exited 1.
5. Playwright against the demo: `demo.spec.ts` 13 passed (the legal links at five widths new),
   the screenshots `demo-0*.png` retaken, `demo-07-phone.png` new.
6. Then `docker compose -p analyzr-demo-legal … down -v`, `docker image rm analyzr-demo:legal` and
   `docker compose -p analyzr-legaldb … down -v`; the owner's `analyzr` stack and `analyzr:local`
   untouched. Not checked: the links on Fly.io (nothing is deployed); Miragon's pages were not
   opened in this run (what they say is as the owner's request of 2026-10-10 describes).

**Review fixes for the legal links (2026-10-10, same machine).** Two findings, both fixed:
M4-VALUE-CHAIN.md §5 "Bundle guard" named the former 200 KB entry ceiling as current (now 240 KB,
pointing here and to `ENTRY_CEILING`), and the legal-links test was the first of the serial
`demo.spec.ts`, so a demo without the optional links skipped the whole read walk and the write
checks; it is now the file's last test.

1. Gates: `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` (dependency-cruiser: no
   violations, 125 modules), `CI=1 pnpm -r test` with `ANALYZR_TEST_DATABASE_URL` on a throwaway
   `analyzr-fixdb` (server 1,392 in 63 files, web 298 in 30, cli 116 plus 7 skipped, eval/tools 95,
   agent-sim 57, demo 27, relations 85, bpmn-facts 134, contracts 67, procedures 37, client 4),
   `pnpm eval:candidates` and `pnpm eval:replay` (pass, no change under `eval/`).
2. The demo image as `analyzr-demo:fix` with a fresh seed, compose project `analyzr-demo-fix` on
   7489: `analyzr-demo check` 126 passed, 0 failed, both links printed; `demo.spec.ts` 13 passed,
   the legal links last.
3. The same image without the two links (`analyzr-demo-fixnolinks` on 7490, a compose override
   with `environment: !override` keeping only `ANALYZR_PUBLIC_ORIGIN`; `/health` without
   `imprintUrl` and `privacyUrl`): `demo.spec.ts` 12 passed and 1 failed, the legal-links test
   alone (as the serial file's first test, its failure would have skipped the 12 others; that
   order was not rerun).
4. Then both demo projects `down -v`, `docker image rm analyzr-demo:fix`, `analyzr-fixdb` `down -v`;
   the owner's `analyzr` stack and `analyzr:local` untouched.

### M6 S3a and S3b (2026-10-15)

Same machine; S3a (`eval:descriptive`, the `get_landscape` size) and S3b (the plugin
`analyzr-integrate` v0, `tools/integrate`) together on `feat/integration-and-gaps`
([M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §8 "S3a as delivered", "S3b as
delivered").

1. Gates: `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` (dependency-cruiser: no
   violations, 124 modules), `pnpm -r test` with Testcontainers (server 1,393 in 65 files, web 315
   in 32, cli 147 plus 7 skipped, integrate 145, eval/tools 108, bpmn-facts 134, contracts 102,
   relations 85, agent-sim 57, procedures 37, demo 27, notices 9, client 4), `pnpm eval:candidates`
   and `pnpm eval:placements` (pass), `pnpm eval:replay`, and `pnpm eval:descriptive` (written,
   identical bytes on a second run); `git diff --stat eval/reports` empty, the only new files there
   `descriptive.{md,json}`.
2. `landscape-size.test.ts` alone with its output: `get_landscape` 43,220 bytes seeded (1,394 per
   model) and 73,136 bytes after the simulation agent (2,359 per model; 57 relations, 48 agent
   relations at 1,143 bytes and 273 rationale characters each), identical on every run.
3. By the implementing agent of S3b: the skill followed by hand on the synthetic Signavio-style
   export (6 models, 3 converted, a German report), a re-export with a moved folder (keys kept),
   both imported with the checkout CLI into its own compose project `analyzr-s3b` (database only,
   the server from source on a scratch owner key file; 6 created without a warning, then 5
   `unchanged`), the bundle dropped into „Hochladen“ in Chromium (Playwright, the folder picker:
   the same 6 keys, the manifest skipped); then the server stopped by its PID and `analyzr-s3b`
   removed with `down -v`, no image built. `claude plugin validate --strict` passes for the plugin
   and the marketplace (Claude Code 2.1.300).

Not checked: the skill invoked as `/analyzr-integrate:integrate-landscape` in a Claude Code
session or by Codex, the guard setup in a live session (`/permissions`, `/sandbox`), a real
export of any tool, and the CI run with the new `eval:descriptive` step (next push).

### M6 S4 (2026-10-16)

Same machine; S4 "Open questions" with a review round's fixes on `feat/integration-and-gaps`
([M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §8 "S4 as delivered").

1. Gates: `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` (dependency-cruiser: no
   violations, 131 modules), `pnpm -r test` with Testcontainers (server 1,422 in 67 files, web 340
   in 34, cli 156 plus 7 skipped, integrate 145, eval/tools 108, bpmn-facts 134, contracts 102,
   relations 85, agent-sim 57, procedures 37, demo 27, notices 9, client 4), `pnpm
   eval:candidates` and `pnpm eval:placements` (pass), `pnpm eval:replay` and `pnpm
   eval:descriptive`; `git diff --stat eval/reports` empty. The client's drift test passes (the
   generated client matches the contracts). The bundle guard: entry chunk 207.5 KB gzip
   (ceiling 240 KB; `bundle.test.ts` says why it grew by 6 KB), chain-only code 37.0 of 40 KB.
2. `open-questions.test.ts` (integration) with its output: 64 items seeded, 115 after the
   simulation agent, 119 after two holds, a model change and a probe agent (M6 §8).
3. Playwright in Chromium against a server run from source (port 7493, its own owner key file,
   the UI built into a scratch directory) on PostgreSQL in the compose project `analyzr-s4gate`
   (database only, port 55493): `open-questions.spec.ts` 6 passed, `smoke.spec.ts` 4 passed, the
   whole suite 52 passed and 21 skipped (the demo walk and the screenshots, which need their own
   servers). Then the demo image as `analyzr-s4gatedemo:dev` with a fresh seed (compose project
   `analyzr-s4gatedemo`, port 7494): `demo.spec.ts` 14 passed, the new nordwind-handel walk of the
   tab, its CSV export and the model view's section included; the demo serves 115 open questions
   on `nordwind-handel`. Then the server stopped by its PID, both compose projects `down -v` and
   the image removed; the owner's stacks untouched.

Not checked: other browsers than Chromium, screen readers, `analyzr-demo check` against the new
image, the CI run (next push).

### M6 S5a (2026-10-17)

Same machine; S5a "Answers recorded" with a review round's fixes and the owner's answer of
2026-10-16 on the chain findings' rank, on `feat/integration-and-gaps`
([M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §8 "S4 as delivered" and "S5a as
delivered").

1. Gates: `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` (dependency-cruiser: no
   violations, 132 modules), `pnpm -r test` with Testcontainers (server 1,446 in 69 files, web
   373 in 35, cli 174 plus 7 skipped, integrate 145, contracts 155, bpmn-facts 134, eval/tools
   108, relations 85, agent-sim 57, procedures 37, demo 27, notices 9, client 4), `pnpm
   eval:candidates` and `pnpm eval:placements` (pass), `pnpm eval:replay` and `pnpm
   eval:descriptive`; `git diff --stat eval/reports` empty. The client's drift test and the
   bundle guard pass; the MCP snapshots are unchanged.
2. `claim-golden.test.ts`: the claim inputs of a freshly seeded `nordwind-handel` match the
   snapshot taken on the code before S5a, also after a text answer on every subject that is
   neither a relation nor a placement.
3. Playwright in Chromium against a server run from source (port 7491, its own owner key file,
   the UI built into a scratch directory) on PostgreSQL in the compose project `analyzr-s5agate`
   (database only, port 55491): `open-questions.spec.ts` 11 passed (5 of them for S5a), the whole
   suite 57 passed and 21 skipped (the demo walk and the screenshots, which need their own
   servers). Then the server stopped by its PID and the compose project `down -v`; the owner's
   stacks untouched. Earlier the same day, before the review round, `demo.spec.ts` passed 14
   against a scratch demo image built from the tree (neither answer button on the demo).

Not checked: `demo.spec.ts` against an image with the review round's fixes, other browsers than
Chromium, screen readers, the CI run (next push).

### M6 S5c-1 (2026-10-17)

Same machine; S5c-1 "Actions" with a review round's fixes, on `feat/integration-and-gaps`
([M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §8
"S5c-1 as delivered"). Run twice: by the implementing agent after the review round, then again
as a separate gate pass on the final tree; the numbers below are the gate pass's.

1. Gates: `pnpm format:check`, `pnpm -r typecheck` (the gate pass found one type error in the
   CLI e2e test, whose local type of an action lacked `proposals`; fixed in the test only, the
   CLI tests rerun green), `pnpm -r lint` (dependency-cruiser: no violations, 133 modules),
   `pnpm -r test` with Testcontainers (server 1,473 in 71 files, web 408 in 37, cli 198 plus 7
   skipped (the live project), integrate 145, contracts 155, bpmn-facts 134, eval/tools 108,
   relations 85, agent-sim 57, procedures 37, demo 27, notices 9, client 4), `pnpm
   eval:candidates` and `pnpm eval:placements` (pass), `pnpm eval:replay` and `pnpm
   eval:descriptive`; `git diff --stat eval/reports` empty and `git status eval/` clean. The
   client's drift test and the bundle guard pass (the entry 208.0 KB gzip, ceiling 240 KB); the
   MCP snapshots are unchanged.
2. `claim-golden.test.ts`: the claim inputs of a freshly seeded `nordwind-handel` match the
   snapshot, also after a note and an outside mark on every subject that is neither a relation
   nor a placement.
3. Playwright in Chromium against a server run from source (port 7497, its own owner key file,
   the UI built into a scratch directory) on PostgreSQL in the compose project
   `analyzr-s5c1gate` (database only, port 55497): `open-questions.spec.ts` 21 passed (every
   action type in the tab, „Link korrigieren“ and the requeue included, and in the model view's
   section; a pool linked to a suggested process accepting the proposal the preview names), the
   whole suite 67 passed and 21 skipped (the demo walk and the screenshots, which need their own
   servers, and the extra chain of `ANALYZR_E2E_VC_EXTRA`); `demo.spec.ts` 14 passed against a
   scratch demo image built from the tree (`analyzr-s5c1vdemo:dev`, compose project
   `analyzr-s5c1vdemo`, port 7498; no action and no note button on the demo). Then the server
   stopped by its PID, both compose projects `down -v` and the image removed; the owner's stacks
   untouched. The implementing agent reported the same Playwright results for its run after the
   review round, on its own scratch projects (`analyzr-s5c1db`, `analyzr-s5c1demo`).

Not checked: other browsers than Chromium, screen readers, the CI run (next push), the
migrations 0013/0014 on a database holding S5a answers (the owner's stacks were not touched).

### M6 S5c-2 (2026-10-17)

Same machine; S5c-2 "Model amendments" with a review round's fixes, on `feat/integration-and-gaps`
([M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §8 "S5c-2 as delivered"). Run twice: by
the implementing agent after the review round, then again as a separate gate pass on the final
tree; the numbers below are the gate pass's, which changed no code.

1. Gates: `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` (dependency-cruiser: no
   violations, 142 modules, 725 dependencies), `pnpm -r test` with Testcontainers (server 1,526 in
   73 files, web 432 in 38, cli 232 plus 7 skipped (the live project), bpmn-facts 199 in 6,
   contracts 155, integrate 145, eval/tools 108, relations 85, agent-sim 57, procedures 37, demo
   27, notices 9, client 4), `pnpm eval:candidates` and `pnpm eval:placements` (pass), `pnpm
   eval:replay` and `pnpm eval:descriptive` (written, no threshold); `git diff --stat
   eval/reports` empty and `git status eval/` clean; the MCP snapshots
   (`apps/server/test/integration/__snapshots__/mcp-*.json`) unchanged, `claim-golden.test.ts`
   green, the seed JSON's keys pinned by the CLI e2e test; the client's drift test and the bundle
   guard pass (the entry 211.0 KB gzip, ceiling 240 KB; the chain-only code 37.0 KB, budget 40
   KB).
2. Playwright in Chromium against a server run from source (port 7513, its own owner key file,
   the UI built into a scratch directory) on PostgreSQL in the compose project
   `analyzr-s5c2gate` (database only, port 55513): `amendments.spec.ts` 5 passed (the call target
   set at its question after the dry run's summary; „Sammeln“ at two questions, one bar, one dry
   run, one save; the model view's „Ergänzen“ with history, overlay, badge, revisions, both
   downloads, the change list and „Zurücknehmen“; the models table's mark; the conflicts after
   the source tool renamed both events, both values side by side, its value taken after the
   withdrawal's cost, „Meine Ergänzung behalten“ not offered over a label), `open-questions.spec.ts`
   21 passed, the whole suite 72 passed and 21 skipped (the demo walk and the screenshots, which
   need their own servers, and the extra chain of `ANALYZR_E2E_VC_EXTRA`). This run includes the
   collection bar's last tweak (its list hidden while the summary shows), which came after the
   implementing agent's Playwright run (`analyzr-s5c2pw`, port 7512: the same two specs passed
   there, with three expectations updated to the review round's display of a call target by its
   process).
3. `demo.spec.ts` 14 passed against a scratch demo image built from the tree
   (`analyzr-s5c2demo:dev`, compose project `analyzr-s5c2demo`, port 7514; no write or amend
   control on the demo; its lists of write texts and test ids now name the amendment controls,
   `withdraw-confirm` included), and `pnpm
   --filter @analyzr/demo check --url http://127.0.0.1:7514`: 147 checks passed, 0 failed.

Then the server stopped by its PID, both compose projects `down -v` and the demo image removed;
the owner's stacks untouched.

Not checked: other browsers than Chromium, screen readers, the CI run (next push), a Camunda
Modeler save of the amendment fixtures (HANDOFF §8), a Camunda engine deploying amended files
(the tests check the BPMN XSD's child order only), the migrations 0015/0016 on a database that
already holds models and revisions (the owner's stacks were not touched).

### M6 S2a (2026-10-17)

Same machine; S2a "Provenance, manifest, stable identity" on `feat/integration-and-gaps`
([M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §8 "S2a as delivered"), server,
contracts, client and CLI (the web parts wait for the UI simplification).

1. Gates: `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` (dependency-cruiser: no
   violations, 144 modules, 734 dependencies), `pnpm -r test` with Testcontainers (server 1,564 in
   75 files, web 432 in 38, cli 243 plus 7 skipped (the live project), bpmn-facts 199, contracts
   156, integrate 145, eval/tools 108, relations 85, agent-sim 57, procedures 37, demo 27, notices
   9, client 4), `pnpm eval:candidates` and `pnpm eval:placements` (pass), `pnpm eval:replay` and
   `pnpm eval:descriptive` (written, no threshold); `git status eval/` clean; the MCP snapshots
   and `claim-golden.test.ts` unchanged; `pnpm --filter @analyzr/client generate` regenerated the
   client for the new route, part, header and fields.
2. No Docker stack of its own: the server tests and the CLI e2e tests ran against Testcontainers'
   PostgreSQL, the e2e tests with a server started from source.

Not checked: the web (no change beyond the new kind's label and hint), the CI run (next push),
migration 0017 on the owner's stacks (not touched; the test runs it on a database with a revision).

Review round (same day; M6 §8 "S2a as delivered": `provenance-kept`, the readers' fallback to the
newest declared revision, tidied informational fields and refused unstorable values, open loss
codes, the manifest checked before `--create`, bundles in subfolders refused, the `next:` lines,
tool ids on several keys, finer `extractor-loss` texts, plugin `analyzr-integrate` 0.1.1 with
its release hash): `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` (no dependency
violations, 144 modules, 734 dependencies), `pnpm -r test` with Testcontainers (server 1,572 in
75 files, web 432 in 38, cli 248 plus 7 skipped, bpmn-facts 199, contracts 156, integrate 145,
eval/tools 108, relations 85, agent-sim 57, procedures 37, demo 27, notices 9, client 4),
`pnpm eval:candidates`, `eval:replay`, `eval:placements` and `eval:descriptive` (exit 0), `git
status eval/` clean; the MCP snapshots unchanged (no `uploader`, `upstream`, `importWarnings`,
`extractor-loss` or `provenance-kept` in `mcp-tools.json`); the client regenerated.

Final gate pass (same day, a separate run on the final tree after the docs were completed; it
changed no code): `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` (no dependency
violations, 144 modules, 734 dependencies), `pnpm -r test` with Testcontainers (the review round's
counts: server 1,572 in 75 files, web 432 in 38, cli 248 plus 7 skipped, bpmn-facts 199, contracts
156, integrate 145, eval/tools 108, relations 85, agent-sim 57, procedures 37, demo 27, notices 9,
client 4), `pnpm eval:candidates` and `pnpm eval:placements` (pass), `pnpm eval:replay` and `pnpm
eval:descriptive` (exit 0, written); `git diff --stat eval/reports` empty, no diff against HEAD
under `eval/` or `apps/server/test/integration/__snapshots__/`, and `mcp-tools.json` names none of
the new fields.

### UX2a (2026-10-18)

Same machine; UX2a "Open questions: groups and totals" on `feat/integration-and-gaps`
([UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §7 "UX2a as delivered"), contracts, client,
server and CLI, plus the web's rendering of the new `detail` and its test fixtures.

1. Gates: `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` (no dependency violations,
   144 modules, 735 dependencies), `pnpm -r test` with Testcontainers (server 1,576 in 75 files,
   web 433 in 38, cli 249 plus 7 skipped (the live project), bpmn-facts 199, contracts 160,
   integrate 145, eval/tools 108, relations 85, agent-sim 57, procedures 37, demo 27, notices 9,
   client 4), `pnpm eval:candidates` and `pnpm eval:placements` (pass), `pnpm eval:replay` and
   `pnpm eval:descriptive` (exit 0); `git status eval/` clean; the MCP snapshots and
   `claim-golden.test.ts` unchanged; `pnpm --filter @analyzr/client generate` regenerated the
   client for `group`, `detail`, `totals`, `askByModel` and the filter.
2. No Docker stack of its own: the server tests and the CLI e2e tests ran against Testcontainers'
   PostgreSQL, the e2e tests with a server started from source. No Playwright run: the UI load
   guard comes with UX1; the specs whose labels changed (`open-questions.spec.ts`,
   `amendments.spec.ts`, `demo.spec.ts`' write labels) were updated, not run.

### UX1 (2026-10-18)

Same machine; UX1 "Shell and Übersicht" on `feat/integration-and-gaps` on top of UX2a
([UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §7 "UX1 as delivered"), web only.

1. Gates: `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` (no dependency violations,
   144 modules, 735 dependencies), `pnpm -r test` with Testcontainers (server 1,576 in 75 files,
   web 467 in 41, cli 249 plus 7 skipped (the live project), bpmn-facts 199, contracts 160,
   integrate 145, eval/tools 108, relations 85, agent-sim 57, procedures 37, demo 27, notices 9,
   client 4), `pnpm eval:candidates` and `pnpm eval:placements` (pass), `pnpm eval:replay` and
   `pnpm eval:descriptive` (exit 0); `git status eval/` clean; no contract, server, MCP snapshot,
   procedure or recording change (the client regenerates without drift).
2. A scratch stack of its own, compose project `analyzr-ux1` (image `analyzr-ux1:dev`, ports 7610
   and 55610): `analyzr seed nordwind-handel --value-chains` in the container, the simulation
   agent from the checkout with a read/propose token (32 tasks, 77 proposals, 22 questions, 150
   no-links), `analyzr import` of `tools/integrate/test/fixtures/signavio/bundle` as
   `signavio-beispiel` (6 created, keys pinned), the empty project `ui-load-leer` made by the
   guard. A second service of the same project served UX2a's web build from the same database
   on port 7611 for the before numbers.
3. Playwright in Chromium against it (`ANALYZR_E2E_URL=http://127.0.0.1:7610`): the whole suite,
   79 passed (amendments 5, run again after its change list moved to the hub, auto-accept 5,
   open-questions 21, pipeline 6, review 8, smoke 4, value-chain 15, value-chain-agent 3,
   value-chain-draft 2, value-chain-import 3 plus 1 skipped, ui-load 7 plus 4 `fixme`), no CSP
   violation; the screenshots `m2-*` and
   `d19-*` retaken from those runs, `01` … `07` from a freshly seeded stack of its own
   (`analyzr-ux1s`, both landscapes, removed afterwards). The read-only demo image as
   `analyzr-ux1d:dev` (compose project `analyzr-ux1d`, port 7680): `demo.spec.ts` 14 passed with
   every menu opened, the screenshots `demo-01` … `demo-07` retaken.
4. The UI load guard's numbers at 1440x900 / 390x844 (before: UX2a's build): the tab bar 9 tabs
   in 2 rows (85 px) / 4 rows (189 px) → 4 tabs in 1 row of 35 px with 3 badges; „Als Nächstes“
   on `nordwind-handel` 6 words and 2 controls, its primary at 224 px at both widths; „Übersicht“
   43 controls, 400 words, 62 badges → 75 controls (with the „Offene Punkte“ links), 317 / 252
   words, 31 badges; no id on „Übersicht“ or the projects list; „Gutschrift“ in 2 interactions at
   390 px („found“ means opened until UX3: on a phone the model view's panel still covers its
   canvas and header, the guard's `fixme` „Gutschrift on a phone shows its name and its
   diagram“); every badge, „Als Nächstes“ number and „Offene Punkte“ equal to its list;
   `einkauf/bestellanforderung` 9 open points (7 relations, 1 placement, 1 question). The entry
   chunk: 211.0 KB in 7 chunks → 209.2 KB in 1 (the `$initial` group).
5. The stacks and their images were removed with `down -v`; nothing of the owner's stacks was
   touched.

### UX2b (2026-10-18)

Same machine; UX2b "„Offene Fragen“ in the web" on `feat/integration-and-gaps` on top of UX1
([UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §7 "UX2b as delivered"), web only plus the
zod-free state label.

1. Gates: `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` (no dependency violations,
   144 modules, 735 dependencies), `pnpm -r test` with Testcontainers (server 1,576 in 75 files,
   web 477 in 41, cli 249 plus 7 skipped (the live project), bpmn-facts 199, contracts 160,
   integrate 145, eval/tools 108, relations 85, agent-sim 57, procedures 37, demo 27, notices 9,
   client 4), `pnpm eval:candidates` and `pnpm eval:placements` (pass), `pnpm eval:replay` and
   `pnpm eval:descriptive` (exit 0); `git status eval/` clean; no route, server, MCP snapshot,
   procedure or recording change (the client regenerates without drift).
2. A scratch stack of its own, compose project `analyzr-ux2b` (ports 7620 and 55620): first
   UX1's build as `analyzr-ux2b-before:dev`, on which the UI load guard seeded `nordwind-handel`
   with its chain and the simulation agent, imported `signavio-beispiel` from the bundle, made
   `ui-load-leer` and measured the before numbers; then UX2b's build as `analyzr-ux2b:dev` on the
   same database (a server started from source on port 7622 served the iterations). The guard's
   hold task made `ui-load-vormerkung`; `ux2b-shots` (`analyzr seed nordwind-handel --project
   ux2b-shots --value-chains` in the container) gave the screenshot 04.
3. Playwright in Chromium against `analyzr-ux2b:dev` (`ANALYZR_E2E_URL=http://127.0.0.1:7620`):
   the whole suite, 83 passed (amendments 5, auto-accept 5, open-questions 21, pipeline 6,
   review 8, smoke 4, ui-load 11 plus 2 `fixme`, value-chain 15, value-chain-agent 3,
   value-chain-draft 2, value-chain-import 3 plus 1 skipped), no CSP violation. The read-only
   demo image as `analyzr-ux2bd:dev` (compose project `analyzr-ux2bd`, port 7681): `demo.spec.ts`
   14 passed with every menu opened. Screenshots retaken: `04-model-view` (the section
   „Fragen“) and `m2-04-held` („Antwort geben“ instead of the answer field); the demo's screenshots
   show nothing UX2b changed and stay.
4. The UI load guard's numbers on „Offene Fragen“ of `nordwind-handel` (before: UX1's build):
   231 → 76 controls, 3,119 → 643 words (540 at 390 px), 50 → 21 badges, the first card at
   575 → 246 px (1,260 → 362 px at 390 px); the badge, the count line „21 zu klären“ and the 21
   cards agree with `group=ask&state=open`; at most 2 actions and 22.6 words per card on
   average; no id at either width or in the default export; a hold answered in 2 clicks from its
   card, its „Vorgemerkt“ row and the review screen; `signavio-beispiel` 45 → 34 controls,
   881 → 227 words; the model view of `vertrieb/order-handling` 35 → 26 controls, 555 → 308
   words. The entry chunk: 209.2 → 209.3 KB.
5. The stacks and their images were removed with `down -v`; nothing of the owner's stacks was
   touched.

### First wave review round (2026-10-18)

Same machine; the review round of UX2a, UX1 and UX2b on `feat/integration-and-gaps`
([UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §7 "First wave review round"): the server's read
model (coded no-links join the rule tier's items about the same gap) and export, the action
labels, the export route's description in the contracts (the client regenerated), the web.

1. Gates: `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` (no dependency violations,
   144 modules, 736 dependencies), `pnpm -r test` with Testcontainers (server 1,578 in 75 files,
   web 488 in 42, cli 249 plus 7 skipped (the live project), bpmn-facts 199, contracts 160,
   integrate 145, eval/tools 108, relations 85, agent-sim 57, procedures 37, demo 27, notices 9,
   client 4), `pnpm eval:candidates` and `pnpm eval:placements` (pass), `pnpm eval:replay` and
   `pnpm eval:descriptive` (exit 0); `git status eval/` clean; the MCP snapshots and
   `claim-golden.test.ts` unchanged; no change to facts, the rule tier, claim inputs,
   procedures or recordings.
2. A scratch stack of its own, compose project `analyzr-uxr` (image `analyzr-uxr:dev`, ports 7630
   and 55630), seeded by the UI load guard (`nordwind-handel` with its chain and the simulation
   agent, `signavio-beispiel` from the bundle, `ui-load-leer`, `ui-load-vormerkung`).
3. Playwright in Chromium against it (`ANALYZR_E2E_URL=http://127.0.0.1:7630`): ui-load 11 passed
   plus 3 `fixme` (the new one: „Gutschrift“ on a phone shows its name and its diagram, UX3),
   open-questions 21, value-chain 15, value-chain-agent 3, value-chain-draft 2,
   value-chain-import 3 plus 1 skipped, amendments 5, auto-accept 5, pipeline 6, review 8,
   smoke 4. Not run: `demo.spec.ts` (no demo image built; no write entry changed its gate) and
   `screenshots.spec.ts` (the screenshots stay; „Offene Punkte“ now shows as text).
4. The UI load guard's numbers at 1440x900 / 390x844: „Übersicht“ of `nordwind-handel` 75 → 44
   controls (the „Offene Punkte“ numbers are text now), 379 / 314 words; `signavio-beispiel`
   23 → 19 controls; „Offene Fragen“ unchanged (76 controls, 643 / 540 words, the first card at
   246 / 362 px); the model view of `vertrieb/order-handling` 26 → 27 controls, 308 → 317 words
   (the link to the agents' questions, „Zur Information“ closed). The entry chunk: 209.3 →
   209.8 KB.
5. The stack, its volumes and its image were removed with `down -v`; nothing of the owner's
   stacks was touched.

### UI simplification first wave (2026-10-18)

Same machine; a separate pass over the whole first wave (UX2a, UX1, UX2b and the first wave's
review round, [UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §7) on `feat/integration-and-gaps`
on top of `427aaf6`, after the review round.

1. Gates: `pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` (no dependency violations,
   144 modules, 736 dependencies), `pnpm -r test` with Testcontainers (server 1,578 in 75 files,
   web 488 in 42, cli 249 plus 7 skipped (the live project), bpmn-facts 199, contracts 160,
   integrate 145, eval/tools 108, relations 85, agent-sim 57, procedures 37, demo 27, notices 9,
   client 4), `pnpm eval:candidates` and `pnpm eval:placements` (pass), `pnpm eval:replay` and
   `pnpm eval:descriptive` (exit 0); `git diff --stat eval/reports` empty, `git status eval/`
   clean; the MCP snapshots (`apps/server/test/integration/__snapshots__/mcp-*.json`) unchanged.
   The bundle guard: the entry chunk 209.8 KB gzip (ceiling 240 KB), the chain-only code 37.0 KB
   (budget 40 KB).
2. Scratch stacks of its own: `analyzr-uxf` (image `analyzr-uxf:dev` built from the working tree,
   ports 7640 and 55640) on a fresh database, which the UI load guard seeded itself
   (`nordwind-handel` with its chain and the simulation agent, `signavio-beispiel` from the
   bundle, `ui-load-leer`, `ui-load-vormerkung`); `analyzr-uxs` (the same image, ports 7641 and
   55641, `analyzr seed --value-chains` of both landscapes) for the screenshots `01` … `07`; the
   read-only demo image `analyzr-uxdemo:dev` (compose project `analyzr-uxdemo`, port 7682).
3. Playwright in Chromium: against `analyzr-uxf` every spec but the screenshots, 83 passed and 18
   skipped (amendments 5, auto-accept 5, open-questions 21, pipeline 6, review 8, smoke 4,
   ui-load 11 plus 3 `fixme`, value-chain 15, value-chain-agent 3, value-chain-draft 2,
   value-chain-import 3 plus 1 skipped; `demo.spec.ts`' 14 skip themselves off the demo);
   `screenshots.spec.ts` 6 passed against `analyzr-uxs`; `demo.spec.ts` 14 passed against
   `analyzr-uxdemo` with every menu opened, and `analyzr-demo check` passed its 147 checks.
   Screenshots retaken: `01` … `07`, `m2-*`, `d19-*`, `m4-*` (the chain header names
   „Relationen“ since the review round) and `demo-*`. `screenshots.spec.ts` now waits for the
   badge „Offene Fragen“ before `02-models`: on a fresh stack the open questions answer last,
   and the first take showed the tab without its count and „Offene Punkte“ without the
   questions.
4. The UI load guard at 1440x900 and 390x844 on the three projects (the table "Measured load" in
   [Web UI](#web-ui)): „Übersicht“ of `nordwind-handel` 44 controls, 379 / 314 words, 31
   badges, the primary at 224 px at both widths; „Offene Fragen“ 76 / 74 controls, 643 / 540
   words, 21 badges, the first card at 246 / 362 px; `signavio-beispiel` 19 controls on
   „Übersicht“ and 34 on „Offene Fragen“; the empty project 9 controls, no badge; the other
   screens as measured for their slices („Relationen“ 64 controls, 828 words, the first row at
   440 px; the chain 60 controls, 482 words; the model view of `vertrieb/order-handling` 27
   controls, 317 words). The projects list read 12 controls and 66 words with the eleven projects
   the earlier specs had made by then, so it is not comparable with UX1's 5 and 33.
5. The three stacks, their volumes and their images were removed with `down -v`; nothing of the
   owner's stacks was touched, `analyzr-local` neither (rebuild it to the branch before the
   owner's walkthrough).

Not checked: other browsers than Chromium (the phone is Chromium's mobile emulation), a real
phone, a screen reader, CI (no e2e job), the owner's walkthrough.

### UX7 (2026-10-18)

Same machine; UX7 („Hochladen“ and „Agent verbinden“, [UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md)
§7 "UX7 as delivered") and the owner's walkthrough fix before it (`083c3c5`, a question card's
button into the diagram) on `feat/integration-and-gaps`.

1. Gates: every gate green (server 1,579, web 499, cli 249 plus 7 skipped, bpmn-facts 200, the
   rest as before); `eval:candidates` and `eval:placements` pass; `git diff --stat eval/reports` empty, the MCP snapshots unchanged. The web tests wait up
   to 4 s in `findBy…` and `waitFor` (15 s per test) since `083c3c5`: under `pnpm -r test`'s
   parallel load a file's first lazy route took longer than the default 1 s.
2. Scratch stacks of its own, removed with `down -v` and their images afterwards: `analyzr-ux7`
   (image `analyzr-ux7:dev` from the working tree, ports 7531 and 55531, a fresh database the UI
   load guard seeded), `analyzr-ux7s` (the same image, ports 7532 and 55532, `analyzr seed
   --value-chains`) for the screenshots, the demo image `analyzr-ux7demo:dev` (port 7582).
3. Playwright in Chromium against `analyzr-ux7`: every spec but the screenshots, 85 passed and 24
   skipped (the demo's 14 off the demo, the screenshots' 7 without `ANALYZR_SCREENSHOTS_DIR`, 3
   `fixme`); `screenshots.spec.ts` 6 passed against `analyzr-ux7s` (`02`, `05`, `06`, `07`
   changed); `demo.spec.ts` 14 passed and `analyzr-demo check` 147 against `analyzr-ux7demo`.
4. The UI load guard's UX7 checks: the raw Signavio export
   (`tools/integrate/test/fixtures/signavio/2026-10-14-signavio`) through the folder input into a
   project of its own reads „5 Modelle importiert · 1 Fehler · 1 übersprungen“, „Bonitätsprüfung.bpmn“
   one entry naming its 2 elements („2 Hinweise“), the UTF-16 file in German with its remedy, „Als
   Nächstes“ the 5 queued relations tasks `analyzr import` names; the dropzone 38 words; the token
   form 2 visible controls (`checkVisibility`: a closed `<details>` keeps its content's boxes in
   Chromium, so the guard's general count includes them).
5. `analyzr-local` was not touched by the checks; nothing of the owner's stacks either.

Not checked: other browsers than Chromium, a real phone, a screen reader, CI (no e2e job).

### UX8 (2026-10-18)

Same machine; UX8 (S2a's web parts, [UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §7 "UX8 as
delivered") on `feat/integration-and-gaps` on top of UX7.

1. Gates: every gate green; `git diff --stat eval/reports` empty, the MCP snapshots unchanged
   (`Model` is in no MCP output schema); the client regenerated with `Model.source` and
   `ModelSourceSummary`. The bundle guard pins `@analyzr/contracts/import-manifest` and the modules
   it imports (`api/common.ts`, `ids.ts`, `refs.ts`, `zod-utils.ts`) in a dynamic chunk; the entry
   holds `paths.ts` alone.
2. Scratch stacks of its own, removed with `down -v` and their images afterwards: `analyzr-ux8`
   (image `analyzr-ux8:dev`, ports 7533 and 55533), `analyzr-ux8s` (the same image, ports 7534 and
   55534, seeded) for the screenshots, the demo image `analyzr-ux8demo:dev` (port 7584).
3. Playwright in Chromium against `analyzr-ux8`: every spec, 84 passed, 24 skipped, 1 failed and
   1 not run in the first pass (the new bundle test's own request context had no session; fixed),
   then `smoke.spec.ts` 5 passed; `screenshots.spec.ts` 6 passed against `analyzr-ux8s` (`04` shows
   „Herkunft“ in the header); `demo.spec.ts` 14 passed and `analyzr-demo check` 147 against
   `analyzr-ux8demo`.
4. The new smoke test drops the integrate skill's golden bundle through the folder input into a
   project of its own: „6 Modelle importiert“, „Bundle erkannt: Signavio, exportiert am 14.10.2026 ·
   6 von 6 Dateien gelistet · Kurznamen aus dem Bundle“, nothing skipped, `GET …/external-ids`
   equal to the manifest's keys, tool ids and folders (as `analyzr import` stores them), „Übersicht“
   naming the one source, the model view's „Herkunft“ reading it back. The UI load guard's numbers
   as after UX7 (the model view 28 controls with „Herkunft“; `signavio-beispiel` 103 words on
   „Übersicht“ with its subtitle and chips). After the browser runs, the lint gate moved the model
   view's chip and loss line into components of their own (`DerivedChip`, `ImportLoss`; React
   Compiler kept `ModelView`'s memoization), the same markup, covered by
   `test/provenance-view.test.tsx`.

Not checked: other browsers than Chromium, a real phone, a screen reader, CI (no e2e job).

### UX3 (2026-10-18)

Same machine; UX3 (the model view, [UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §7 "UX3 as
delivered") on `feat/integration-and-gaps` on top of decision 27.

1. Gates: every gate green; web only, live-run neutral (`git diff --stat eval/reports` empty, the
   MCP snapshots unchanged, no contract change). New component tests `test/model-view.test.tsx`
   (the header's crumb, title and „Mehr“; the tabs' counts and default, the element filter with
   its label and „Alle zeigen“, „Fragen“ kept when its last question is settled, a collapsed
   subprocess opening „Fragen“; the relation card's two lines and accessible name, the confidence
   on a proposal only; the sheet below 1024 px through a `matchMedia` override: collapsed,
   `aria-expanded`, `inert`, the focus on expand, Escape); `amendments.test.tsx`,
   `open-questions.test.tsx` and `provenance-view.test.tsx` reach „Revisionen“, „Herkunft“ and the
   downloads through „Mehr“. jsdom's `matchMedia` stub matches `(min-width: 1024px)`, so the other
   tests render the desktop layout. The bundle guard: the entry 219.8 KB gzip (218.1 before),
   „Mehr“ with its dialogs in the amendments chunk.
2. Scratch stacks of its own, removed with `down -v` and their images afterwards: `analyzr-ux3`
   (image `analyzr-ux3:dev` from the working tree, ports 7611 and 55611; first a fresh database
   the UI load guard seeded, then again `down -v` and `analyzr seed` for the screenshots), the demo
   image `analyzr-ux3-demo:dev` (port 7612).
3. Playwright in Chromium against `analyzr-ux3`: every spec, 88 passed, 23 skipped and 1 failed in
   the first pass (a selected collapsed subprocess opened „Relationen“, hiding its „Verknüpfen mit
   …“; the tab rule now counts it, with a component test), then 89 passed and 23 skipped on a fresh
   database; `screenshots.spec.ts` 6 passed against the seeded stack (`04` retaken);
   `demo.spec.ts` 14 passed (after its model view check moved to the tab) and `analyzr-demo check`
   147 against `analyzr-ux3-demo` (`demo-02` retaken).
4. The UI load guard's UX3 checks on `nordwind-handel` after the simulation agent: on
   `vertrieb/order-handling` at 1440x900 the first question ends inside the panel, the panel holds
   10 visible controls and 75 words (≤ 25, ≤ 300), the header 1 chip and „Mehr“, no ids; `?element=`
   filters „Relationen“ to the landscape's relations of that element and „Alle zeigen“ lifts it;
   „Gutschrift“ found in two interactions at 390x844 shows its name in the top bar (it answers
   `elementFromPoint`), the sheet collapsed and the canvas at least 55 % of the screen (86 %
   measured); the bpmn.io watermark answers `elementFromPoint` at its corners and centre at 390
   (sheet collapsed and expanded), 800, 1024 and 1440 px. The review screen's watermark stays a
   `fixme` for UX5.
5. `analyzr-local` rebuilt to the commit afterwards; nothing of the owner's stacks was touched.

Not checked: other browsers than Chromium (the phone is Chromium's mobile emulation), a real
phone, a screen reader, CI (no e2e job).

### UX4 (2026-10-18)

Same machine; UX4 (question actions, [UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §7 "UX4 as
delivered") on `feat/integration-and-gaps` on top of UX3.

1. Gates: every gate green; web only, live-run neutral (`git diff --stat eval/reports` empty, the
   MCP snapshots unchanged, no contract change: the API's action labels stay, the web joins the
   link and the amendment). Component tests: `test/amendments.test.tsx` (the one entry „Ziel
   wählen …“ with „Im Modell eintragen“ checked: the dry run inline with `If-Match`, „Speichern“
   sends the amendment only, no link, the toast's „Agent starten“ opens the host; unchecked only
   the link with „+ Notiz“; a 412 on the dry run sends nothing; „Trotzdem speichern“ for a claimed
   task; „Partner wählen …“ with a partner's name or only the link for a whole process; the ghost
   button „Notiz“; the forms without „Sammeln“), `open-question-actions.test.tsx` (the order by
   name, „Passt vermutlich“, „+ Notiz“, the copies by path with „Technische Angaben“),
   `open-questions-lib.test.ts` (`cardActions` joins the entry), `open-question-pickers-lib.test.ts`
   („Forderung an Inkasso übergeben“, „Process_Inkasso“, „RuecklastschriftEingegangen“, „Gutschrift
   erstellen“), `open-question-answers-lib.test.ts` (each note text case, the amendment's entry).
   The bundle guard: the entry 220.7 KB gzip (+0.9: the root's host for „Agent starten“ and the
   rule that joins the entry), the pickers and the inline dry run in the lazy chunks.
2. Scratch stacks of its own, removed with `down -v` and their images afterwards: `analyzr-ux4`
   (image `analyzr-ux4:dev` from the working tree, ports 7613 and 55613, a fresh database the UI
   load guard seeded, and again fresh for the whole suite), the demo image `analyzr-ux4-demo:dev`
   (port 7614).
3. Playwright in Chromium: the UI load guard 18 passed, 1 skipped (the review screen's watermark,
   UX5); every spec 91 passed and 22 skipped on a fresh database; `demo.spec.ts` 14 passed and
   `analyzr-demo check` 147 against `analyzr-ux4-demo`. No screenshot changed in this slice's set.
4. The UI load guard's UX4 checks: `nordwind-handel` has no process „Inkasso“ („Process_Inkasso“
   names none), so the task runs in a project of its own per run, the corpus plus one model
   „Inkasso“ under another id; there „Forderung an Inkasso übergeben“ opens „Ziel wählen …“ (1),
   lists „Inkasso – finanzen/inkasso“ first under „Passt vermutlich“ (at most three), the pick (2)
   leaves „Verknüpfen“ ready (3); checked, „Im Modell eintragen“ shows „Danach: …“ and saves, and
   the toast's „Agent starten“ shows the commands. On `nordwind-handel` 1 of the 21 „Zu klären“
   cards shows the ghost button „Notiz“ (the audit's 22 note-only cards were counted before UX2a
   grouped the list), none a menu besides it, and no „Sammeln“ anywhere; „Offene Fragen“ 76
   controls and 709 words as before.
5. `analyzr-local` rebuilt to the commit afterwards; nothing of the owner's stacks was touched.

Not checked: other browsers than Chromium, a real phone, a screen reader, CI (no e2e job).

### UX5 step 1 (2026-10-18)

Same machine; UX5 step 1 („Relationen“ and its views, [UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md)
§7 "UX5 step 1 as delivered") on `feat/integration-and-gaps` on top of UX4.

1. Gates: every gate green; web only, live-run neutral (`git diff --stat eval/reports` empty, the
   MCP snapshots unchanged, no contract change). Component tests: `test/review-inbox.test.tsx` (the
   views with „Zu prüfen (n)“ current, the status line, „Vorschläge prüfen (n)“ at the first item,
   „n unauffällige annehmen …“ whose count the dialog selects, one link per row and a row click,
   „Grundlage“ instead of „Stufe“, the rows' names with the key only where they repeat,
   „Jetzt entscheiden“ and the sentence in „Vorgemerkt“), `bulk-accept-dialog.test.tsx` rewritten
   (the unremarkable pairs selected, the flagged ones under „Genauer ansehen“ with their flag line
   and „Vorschlag öffnen“, the owner's „Annahmeregel anlegen“ to `/rules?new=key`, only the key
   tier), `demo-mode.test.tsx` (the status line for a viewer, no callout, the no-links behind the
   foot link), `relation-table.test.tsx`, `rules-tab.test.tsx`, `auto-accept-marks.test.tsx`,
   `value-chain-page.test.tsx`, `held-list.test.tsx` and `auto-accept-lib.test.ts` for the views and
   the glossary. The bundle guard: the entry 221.3 KB gzip (+0.6).
2. Scratch stacks of its own, removed with `down -v` and their images afterwards: `analyzr-ux5`
   (image `analyzr-ux5:dev` from the working tree, ports 7615 and 55615, a fresh database the UI
   load guard seeded, again fresh for the whole suite), the demo image `analyzr-ux5-demo:dev`
   (port 7616): `demo.spec.ts` 14 passed and `analyzr-demo check` 147.
3. Playwright in Chromium: every spec 88 passed, 22 skipped and 2 failed in the first pass (the
   auto-accept spec still clicked the old preset; the bulk button counted before the facts had
   loaded, so its number fell from 28 to 11 when the flags arrived: it now waits for them), then 93
   passed and 22 skipped on a fresh database. The screenshots of this slice are retaken with step 2.
4. The UI load guard's UX5 checks on `nordwind-handel` after the simulation agent (48 rows): the
   first proposal at 297 px (≤ 360), one link and one control per row, 10 controls besides the rows
   (≤ 12, the shell apart), 496 words (the budget 450 at the audit's 42 rows scales with the rows:
   about 446 at 42), no name cut, „11 unauffällige annehmen …“ selecting 11, no ids; at 390x844
   390 px wide.
5. `analyzr-local` rebuilt to the commit afterwards; nothing of the owner's stacks was touched.

Not checked: other browsers than Chromium, a real phone, a screen reader, CI (no e2e job).

### UX5 step 2 (2026-10-18)

Same machine; UX5 step 2 (the review screen and the auto-accept mark,
[UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §7 "UX5 step 2 as delivered") on
`feat/integration-and-gaps` on top of step 1.

1. Gates: every gate green; web only, live-run neutral (`git diff --stat eval/reports` empty, the
   MCP snapshots unchanged, no contract change). Component tests: `test/review-screen.test.tsx`
   (both panes from 1024 px, stacked below 1280; the phone's sheet with „Von → Nach · Konfidenz“,
   the top bar without „Nebeneinander“, R expanding the sheet; the way back to „Offene Fragen“; a
   held relation answered from the decision bar), `review-details.test.tsx` (the header without
   the tier, the closed „Verlauf (n)“ with „Technische Angaben“, an entry shown above in brief, the
   hold box read-only), `auto-accept-marks.test.tsx` (one badge „Automatisch angenommen“ with the
   rule in its tooltip, „97 %“), `decision-panel.test.tsx` and `placement-decision-panel.test.tsx`
   („Frage oder Label ergänzen“), `open-questions.test.tsx` and `open-question-actions.test.tsx`
   (`from=open-questions` from the tab, not from the model view), `app.test.tsx`. The bundle guard:
   the entry 221.9 KB gzip (+0.6).
2. Scratch stacks of its own, removed with `down -v` and their images afterwards: `analyzr-ux5b`
   (image `analyzr-ux5b:dev` from the working tree, ports 7617 and 55617: the UI load guard, the
   whole suite on a fresh database, the review, pipeline and auto-accept flows' screenshots on
   another fresh one, `analyzr seed` for `screenshots.spec.ts`), the demo image `analyzr-ux5b-demo:dev`
   (port 7618).
3. Playwright in Chromium: every spec 87 passed, 21 skipped and 3 failed in the first pass (the
   new „Verlauf“ holds „Technische Angaben“, a second `summary`: the specs open it by
   `:scope > summary`; the pipeline spec looked for a raw ref that „Verlauf“ now keeps in brief),
   then 96 passed and 21 skipped on a fresh database; the UI load guard 23 passed; `demo.spec.ts`
   14 passed and `analyzr-demo check` 147 against `analyzr-ux5b-demo`. Screenshots retaken: `03`,
   `m2-01`–`07` and `m2-09`–`12`, `d19-02`, `d19-04`–`06`, `d19-08`, `d19-09`, `demo-03`, `demo-04`,
   `demo-06` (step 1's inbox included).
4. The UI load guard's UX5 checks on `nordwind-handel`: the review panel of the first agent
   proposal 93 words with „Verlauf“ closed (≤ 110), no ids; at 390x844 the sheet collapsed, the way
   back, ‹ and › answer `elementFromPoint`, 390 px wide; the bpmn.io watermark of every pane
   answers `elementFromPoint` at its corners and centre at 390 (collapsed and expanded), 800, 1024
   and 1440 px (the `fixme` gone).
5. `analyzr-local` rebuilt to the commit afterwards; nothing of the owner's stacks was touched.

Not checked: other browsers than Chromium (the phone is Chromium's mobile emulation), a real
phone, a screen reader, CI (no e2e job).

### UX6 step 1 (2026-10-19)

Same machine; UX6 step 1 (the chain's panel, header, cards, forms and texts,
[UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §7 "UX6 step 1 as delivered") on
`feat/integration-and-gaps` on top of UX5.

1. Gates: every gate green; web only, live-run neutral (`git diff --stat eval/reports` empty, the
   MCP snapshots unchanged, no contract change; the placements procedure's „Agent unsicher“ stays
   true: the reason line reads „Agent unsicher: …“). Component tests: `test/value-chain-page.test.tsx`
   (the status line, „Platzierungen prüfen (2)“ starting at the first open placement, „Zu prüfen“
   without markers, no gap rows, „Ohne Schritt“ with the agent's doubt first, the closed tree with
   collapsed rows and roll-ups and its keys, „nichts angenommen“ only where nothing waits, the
   header's way back, revision disclosure and „Exportieren“, the stage only when it asks for
   something, „Agent starten“ scheduling the task), `placement-card.test.tsx` (new: the model path,
   no status on a plain proposal, six controls, „Details“ with tier, proposer, evidence by name, the
   brief timeline and „Technische Angaben“; a hold answered through the note dialog),
   `value-chain-lib.test.ts` (`chainCoverage`, `pendingSteps`, `subtreeCounts`, `unplacedItems`,
   `correctionNote`), `placement-decision-panel.test.tsx` (the prefilled correction note),
   `step-view.test.tsx`, `link-editor.test.tsx`, `auto-accept-marks.test.tsx`, `app.test.tsx`. The
   bundle guard: the entry 222.1 KB gzip (+0.2), the chain-only code 13.4 KB (≤ 40).
2. Scratch stacks of its own, removed with `down -v` and their images afterwards: `analyzr-ux6`
   (image `analyzr-ux6:dev` from the working tree, ports 7619 and 55619, `analyzr seed`, the UI load
   guard with `ANALYZR_UI_LOAD_NORDWIND=nordwind-ux6`, so it seeded its own `nordwind-handel` state
   beside the seeded one), the demo image `analyzr-ux6-demo:dev` (port 7620).
3. Playwright in Chromium: the chain specs 22 passed and 1 failed in the first pass (two `summary`
   in a card's „Details“: the spec opens it by `:scope > summary`), then every spec 96 passed and 21
   skipped; the UI load guard 23 passed; `demo.spec.ts` 14 passed and `analyzr-demo check` 147
   against `analyzr-ux6-demo`. Screenshots retaken: `m4-01`–`08`, `m4-12`–`14`, `demo-05`, `d19-09`.
4. The UI load guard's UX6 checks on `nordwind-handel` after the simulation agent: „Platzierungen
   prüfen (29)“ at the panel's top and in view (nothing scrolled), the panel 75 words and 20
   controls with the disclosures' summaries (≤ 150, ≤ 40), the header 4 controls besides the chip,
   the first card 6 („Details“, „Im Modell“, the four decisions), „nichts angenommen“ on 4 steps,
   no ids in the panel or on the card. Counting needs `checkVisibility`: Chromium keeps a closed
   `details`' content laid out (`content-visibility: hidden`), so its rects are not zero.
5. `analyzr-local` rebuilt to the commit afterwards; nothing of the owner's stacks was touched.

Not checked: other browsers than Chromium, a real phone (the chain's phone layout is step 2), a
screen reader, CI (no e2e job).

### UX6 step 2 (2026-10-19)

Same machine; UX6 step 2 (the chain's phone sheet, canvas, edit inset, double-click and the way
back, [UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §7 "UX6 step 2 as delivered") on
`feat/integration-and-gaps` on top of step 1.

1. Gates: every gate green; web only, live-run neutral (`git diff --stat eval/reports` empty, the
   MCP snapshots unchanged, no contract change). Component tests: `test/value-chain-page.test.tsx`
   (a double-click zooms in place or opens the linked model, the panel's toggle, the phone's sheet
   collapsed to „2 offen“ and expanded by R, the way back to „Offene Fragen“ kept through J/K and
   taken after a decision; the phone stub as a data property over the setup's accessor, so
   restoring the descriptor restores the desktop), `open-question-actions.test.tsx` and
   `open-questions.test.tsx` (`from=open-questions` on the tab's chain links). The bundle guard: the
   entry 222.1 KB gzip (unchanged), the chain-only code 13.6 KB.
2. Scratch stacks of its own, removed with `down -v` and their images afterwards: `analyzr-ux6b`
   (image `analyzr-ux6b:dev`, ports 7621 and 55621, `analyzr seed`, the guard with
   `ANALYZR_UI_LOAD_NORDWIND=nordwind-ux6b`), the demo image `analyzr-ux6b-demo:dev` (port 7622).
3. Playwright in Chromium: the CSS check „the chain page is unchanged after the review screen“
   failed in the first pass (the new `ResizeObserver` called `resized()` at mount, after the fit,
   and the second visit drew the overlays differently: it now calls it only on a real size
   change), the fix-link spec expected the URL without `from` (it now checks „‹ Offene Fragen“
   too); then every spec 96 passed and 21 skipped and the open-questions spec 21 passed; the UI load
   guard 25 passed; `demo.spec.ts` 14 passed and `analyzr-demo check` 147 against
   `analyzr-ux6b-demo`. Screenshots retaken: `m4-01`–`06`, `m4-08`, `m4-12`–`14`, `demo-05`, `d19-09`.
4. The UI load guard's UX6 checks: the selected step's computed `stroke-width` 4px; „Details
   ausblenden“ gives the canvas more than 400 px and „Details zeigen“ brings the panel back; at
   390x844 the sheet collapsed to „29 offen“, the project link answers `elementFromPoint`, the
   canvas ends above the sheet over more than 55 % of the screen, the expanded sheet shows
   „Platzierungen prüfen“, 390 px wide.
5. `analyzr-local` rebuilt to the commit afterwards; nothing of the owner's stacks was touched.

Not checked: other browsers than Chromium (the phone is Chromium's mobile emulation), a real
phone, a screen reader, CI (no e2e job).

### UX9 (2026-10-19)

Same machine; UX9 („Relationen“ result views, „Annahmeregeln“, the projects summary,
[UX-SIMPLIFICATION.md](UX-SIMPLIFICATION.md) §7 "UX9 as delivered") on
`feat/integration-and-gaps` on top of UX6. Built by three agents in worktrees of their own (one per
part), each reviewed adversarially by another; the review's findings fixed and the parts merged by
the lead.

1. Gates: every gate green; one REST route added (`GET /projects/{p}/summary`, contracts first,
   the client regenerated, the MCP snapshot and `Project` unchanged), eval reports unchanged.
   Server: `test/integration/project-summary.test.ts` (the counts against the pinned
   `nordwind-handel` state 48/29/21, viewer read, non-members 404, the memo: a second call loads
   nothing, a write builds again) and the policy matrix. Web: `relation-table.test.tsx` (the
   filters, rows, „Entschieden von“, 57 controls on „Alle“ with 100 relations, the paging in the
   URL, no ref tooltip, the helpers), `review-screen.test.tsx` (J/K after a decision in a result
   view), `rules-tab.test.tsx` (a row's three controls, the switch's confirmations incl. an orphaned
   active rule and an unknown `/me`, focus back after every dialog from a menu, the hint's cached
   dry run, the phone's stats line, the dialog's four criteria and prefilled name, the flags line),
   `projects-page.test.tsx` and `demo-mode.test.tsx` (the columns, „–“ and „nicht geladen“, dates
   computed in the runner's zone), `auto-accept-*.test.ts(x)`, `value-chain-page.test.tsx`. Every
   web test also under `TZ=Pacific/Auckland` (two older ones made zone-proof). The bundle guard:
   the entry 223.4 KB gzip (+1.3).
2. Scratch stacks of its own, removed with `down -v` and their images afterwards: `analyzr-ux9`
   (image `analyzr-ux9:dev`, ports 7623 and 55623, `analyzr seed`, the guard with
   `ANALYZR_UI_LOAD_NORDWIND=nordwind-ux9`; a fresh database seeded again for `screenshots.spec.ts`,
   whose projects list needs the seeded two projects only), the demo image `analyzr-ux9-demo:dev`
   (port 7624).
3. Playwright in Chromium: every spec 101 passed and 21 skipped (the UI load guard's three UX9
   checks included); `demo.spec.ts` 14 passed and `analyzr-demo check` 147. Screenshots retaken:
   `01`, `03`, `d19-01`–`08`, `demo-01`.
4. The UI load guard's UX9 checks on `nordwind-handel` after the simulation agent: „Relationen ›
   Alle“ 56 controls (≤ 60), one per row, no ids, no ref tooltip; a rule row 3 controls and the
   dialog four criteria plus the prefilled name; the projects list's „Offen für dich“ equals the
   sum of the project's badges, „Zuletzt geändert“ a date.
5. `analyzr-local` rebuilt to the commit afterwards; nothing of the owner's stacks was touched.

Not checked: other browsers than Chromium, a real phone, a screen reader, the summary's cost on a
stack with many projects or a 300-model landscape (memoized per project event; the first visit after
a start builds each project once), CI (no e2e job).

### M6 S2c-1 (2026-10-19)

Same machine; M6 S2c-1 (the trust class and the rule tier, owner decisions 24.2, 25.2 and 28,
[M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §8 "S2c-1 as delivered",
[The trust rule](#the-trust-rule-m6-s2c-1)) on `feat/integration-and-gaps` on top of UX9. Built by
an implementing agent, reviewed adversarially from a server and a surface lens; the review's twelve
findings handled (the marker dropped with the rule's proposal, the totals past the cap in the contract, the
effect test against what the write changed, the pass-through branches, the timeline's badge, the
old proposal as „Begründung“, the card's count as text, the empty „Übersicht“, the CLI's reason
breakdown, the absent-keys sentence's test, the route descriptions, the UI load numbers).

1. Gates: every gate green (`pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` with
   dependency-cruiser, `pnpm -r test` with Testcontainers: server 1,636, web 598, CLI 250 plus 7
   skipped, contracts 163, bpmn-facts 200, relations 85, integrate 145, agent-sim 57, demo 27,
   procedures 37, client 4, notices 9; `pnpm eval:candidates`, `pnpm eval:replay`, `pnpm
   eval:placements`, `pnpm eval:descriptive`); contracts first, the client regenerated; no
   migration. `git diff --stat eval/reports` empty, and the recompute golden digest unchanged (the
   test drops `trust` from the `model.revised` payloads before hashing and checks each one
   modelled). The MCP snapshots, the procedures, the recordings and the claim inputs are unchanged,
   so it is live-run neutral; the one change outside the corpus is intended: a landscape without an
   engine or uploaded with an agent token gets its unique calls as proposals. The bundle guard: the
   entry 224.1 KB gzip (+0.7 after UX9's 223.4), the chain-only code 13.7 KB.
2. Scratch stacks of its own, both removed afterwards (no `analyzr-s2c` container, volume,
   network or image left): `analyzr-s2c` (image `analyzr-s2c:dev` from the working tree, ports
   7625 and 55625, `analyzr seed`: both landscapes with the counts [Load the test
   landscapes](#load-the-test-landscapes) names, so the trust rule changes nothing there; the UI
   load guard with `ANALYZR_UI_LOAD_NORDWIND=nordwind-s2c`) and the demo stack `analyzr-s2c-demo`
   (port 7626).
3. Playwright in Chromium against `analyzr-s2c` (`ANALYZR_E2E_URL=http://127.0.0.1:7625`): every
   spec 101 passed and 21 skipped, the UI load guard and `auto-accept.spec.ts` (the card's new
   text) included; `pnpm --filter @analyzr/demo check` 147 checks and `e2e/demo.spec.ts` 14 passed
   against `analyzr-s2c-demo`.
4. The UI load guard's numbers at 1440 / 390 ("Web UI", Measured load): `signavio-beispiel`
   „Übersicht“ 20 controls, 122 / 107 words, 9 badges, the primary at 224 px (19, 103 / 88, 9, 224
   before) and „Offene Fragen“ 34 controls, 254 words, 7 badges, the first card at 246 px (34,
   253, 7, 246): imported with a write token and naming no engine, its call „Rechnung stellen“ is
   now a proposal, so the tab reads „Relationen 1 zu prüfen“ and „Als Nächstes“ adds „Oder jetzt
   schon: Vorschläge prüfen (1) …“; the empty project's „Übersicht“ 9 controls, 42 / 41 words (9,
   37 / 36; the empty text names Camunda models). Unchanged: UX7's „Hochladen“ (13 controls, 49
   words) and „Vorschau“ (20 controls, 128 words, 6 badges), `nordwind-handel`'s „Übersicht“ (44
   controls, 379 / 314 words, 31 badges). That one extra proposal is what the trust rule costs a
   derived landscape's first analysis; S2c-2 turned it into one bulk accept ([M6
   S2c-2](#m6-s2c-2-2026-10-20)).

Not checked: a real tool export (only the synthetic Signavio fixture and the integrate plugin's
golden bundle), a landscape stored between S2a and S2c on an existing database (covered by the
integration test that strips `trust` by SQL), other browsers than Chromium, a real phone, a screen
reader, CI (no e2e job).

### M6 S2c-2 (2026-10-20)

Same machine; M6 S2c-2 (the fast path for derived calls, owner decision 24.2,
[M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §8 "S2c-2 as delivered", [The trust
rule](#the-trust-rule-m6-s2c-1)) on `feat/integration-and-gaps` on top of S2c-1. Built by an
implementing agent, reviewed adversarially from a web and from a CLI and server lens; all ten
findings fixed (the dialog kept open through the accept's refetches, so its toast shows and
`?bulk` goes; every count limited to the calls a bulk accept takes, `isBulkDerivedCall`; the focus
after closing; at most 500 selected; „Davon …“ under „Vorschläge prüfen“; the measurement taken
once the page settled; „Gesammelt annehmen“ among the demo's write labels; the CLI's `next:` line
counting the waiting calls with the web link instead of the derived models; plugin 0.1.2's stale
manifest passages; the CLI's missing tests and the notice naming the token's source).

1. Gates: every gate green (`pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` with
   dependency-cruiser, `pnpm -r test` with Testcontainers: server 1,640, web 618, CLI 255 plus 7
   skipped, contracts 165, integrate 145, bpmn-facts 200, relations 85, agent-sim 57, procedures
   37, demo 27, notices 9, client 4; `pnpm eval:candidates`, `pnpm eval:replay`, `pnpm
   eval:placements`, `pnpm eval:descriptive`); `git diff --stat eval/reports` empty. No route, no
   migration, the OpenAPI spec and the client unchanged (`isBulkDerivedCall` is a plain function).
   The MCP snapshots, the procedures and the recordings are unchanged, so it is live-run neutral
   (the integrate plugin is never loaded in live runs). The bundle guard: the entry 225.1 KB gzip
   (+1.0 after S2c-1's 224.1), the chain-only code 13.7 KB. `claude plugin validate --strict
   plugins/analyzr-integrate` passes for 0.1.2 (Claude Code 2.1.303, run during the docs review).
2. Scratch stacks of its own, both removed with their images afterwards: `analyzr-s2c2` (image
   `analyzr-s2c2:dev` from the working tree, ports 7627 and 55627, `analyzr seed` with the counts
   unchanged; the UI load guard with `ANALYZR_UI_LOAD_NORDWIND=nordwind-s2c2`) and the demo stack
   `analyzr-s2c2-demo` (port 7628).
3. Playwright in Chromium against `analyzr-s2c2` (`ANALYZR_E2E_URL=http://127.0.0.1:7627`): the
   first run 103 passed, 1 failed and 21 skipped. The failure was `value-chain.spec.ts` "CSS check:
   the chain page is unchanged after the review screen" (a canvas screenshot differed; the test
   took 5.2 min) while the gates ran in parallel on the same machine; `value-chain.spec.ts` alone
   then passed 15, and a second full run passed 104 with 21 skipped (`trust-calls.spec.ts`'s 2
   tests and the UI load guard's new S2c test included). Against `analyzr-s2c2-demo`: `pnpm
   --filter @analyzr/demo check` 147 checks and `e2e/demo.spec.ts` 14 passed.
4. The UI load guard's numbers at 1440 / 390 ("Web UI", Measured load): `signavio-beispiel`
   „Übersicht“ 20 controls, 113 / 98 words, 9 badges, the primary at 224 px (S2c-1: 20, 122 / 107,
   9, 224): its only open review item is „Rechnung stellen“, so „1 eindeutigen Aufruf zuerst
   bestätigen · Gesammelt annehmen“ replaces „Oder jetzt schon: Vorschläge prüfen (1) …“. New row:
   `signavio-beispiel` „Gesammelt annehmen“ (the dialog) at 1440, 22 controls, 112 words, 0 badges,
   the first row at 449 px (no budget). Unchanged: `nordwind-handel`'s „Übersicht“ (44 controls,
   379 / 314 words, 31 badges), the empty project's (9 controls, 42 / 41 words), `signavio-beispiel`'s
   „Offene Fragen“ (34 controls, 254 words, 7 badges), UX7's „Hochladen“ (13 controls, 49 words)
   and „Vorschau“ (20 controls, 128 words, 6 badges). For the first analysis of a derived
   landscape, S2c-1's extra review step is now one bulk accept (the link, then one click) before
   the agent runs, and the calls it accepts are settled, so the agent's claims judge only the pairs that are really open.

Not checked: a real tool export (only the synthetic Signavio fixture and the integrate plugin's
golden bundle), more than 500 derived calls in a browser (the cap is unit-tested), the integrate
plugin 0.1.2 in a live Claude Code session, other browsers than Chromium, a real phone, a screen
reader, CI (no e2e job).

### M6 S2c-3 (2026-10-20)

Same machine; M6 S2c-3 (owners' rules for derived calls: decision 24.2's extension of decision 19,
narrowed by decision 28 (1), [M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §8 "S2c-3 as
delivered", "Rules for derived calls" in [Auto-accept rules](#auto-accept-rules-owner-decision-19))
on `feat/integration-and-gaps` on top of S2c-2. Built by an implementing agent, reviewed
adversarially from a safety and server, a web and UX, and a CLI and contracts lens; of the
seventeen findings sixteen fixed (`agent-upload` for every rule, agent rules included, after an
agent's own proposal of an agent-uploaded caller's call was accepted by an agent rule; revocation
requeueing by the trigger again; the vacuous re-import check and the migration test naming the check; `trust-calls.spec.ts`'s
toast; the „Vorschau“ numbers with `ofProposed`; the neutral texts of the page lead, the revoke
dialog and the provenance; the converters' order; „Lädt …“ and the missing converter's error; no
offer where a rule already names the source, in the web and the CLI; suggested names within 100
characters; the e2e check waiting for the settled next steps; shell-quoted suggestions, the
value-chain `push` line too; the CLI's source from the waiting calls; the contract and help texts)
and one partly: writes made with an agent token now set off no rule for derived calls, while its
other half is kept on purpose: a proposal the rule tier makes again in a person's import (say, the
callee renamed) counts as new and is accepted ([HANDOFF.md](HANDOFF.md) §4, the S2c-3 readings).
The suggested `rules add` dropped `--enable`, so new rules start off as in the web.

1. Gates: every gate green (`pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` with
   dependency-cruiser, 146 modules, no violations, `pnpm -r test` with Testcontainers: server
   1,680, web 636, CLI 262 plus 7 skipped, contracts 165, integrate 145, bpmn-facts 200, relations
   85, agent-sim 57, procedures 37, demo 27, notices 9, client 4, eval/tools 108; `pnpm
   eval:candidates`, `pnpm eval:replay`, `pnpm eval:placements`, `pnpm eval:descriptive`); `git
   diff --stat eval/reports` empty. Contracts first, the client regenerated; migration 0018
   generated (`drizzle-kit generate` into a scratch copy reports no schema changes). The MCP
   snapshots, the procedures and the recordings are unchanged (no rule data reaches agents), so it
   is live-run neutral. The bundle guard: the entry 226.0 KB gzip (+0.9 after S2c-2's 225.1), the
   chain-only code 13.7 KB.
2. Scratch stacks of its own, both removed with their images afterwards: `analyzr-s2c3` (image
   `analyzr-s2c3:dev` from the working tree, ports 7629 and 55629, `analyzr seed` with the counts
   unchanged; the UI load guard with `ANALYZR_UI_LOAD_NORDWIND=nordwind-s2c3`) and the demo stack
   `analyzr-s2c3-demo` (port 7630).
3. Playwright in Chromium against `analyzr-s2c3` (`ANALYZR_E2E_URL=http://127.0.0.1:7629`), run
   after the gates had finished: 107 passed and 21 skipped (`derived-call-rules.spec.ts`'s 3 tests,
   `trust-calls.spec.ts`'s 2 and `auto-accept.spec.ts` included). Against `analyzr-s2c3-demo`: `pnpm
   --filter @analyzr/demo check` 147 checks and `e2e/demo.spec.ts` 14 passed.
4. The UI load guard's numbers at 1440 / 390 ("Web UI", Measured load): every screen as in
   S2c-2's run except „Annahmeregeln“, 13 controls and 82 words with one rule (80 before), from the
   page lead „analyzr nimmt neue Vorschläge, die eine aktive Regel trifft, selbst an – …“. So
   `nordwind-handel`'s „Übersicht“ 44 controls, 379 / 314 words, 31 badges; `signavio-beispiel`'s
   „Übersicht“ 20 controls, 113 / 98 words, 9 badges, the dialog behind „Gesammelt annehmen“ 22
   controls and 112 words, its „Offene Fragen“ 34 controls, 254 words; the empty project's
   „Übersicht“ 9 controls, 42 / 41 words; UX7's „Hochladen“ 13 controls, 49 words and „Vorschau“ 20
   controls, 128 words, 6 badges. No measured project has a rule for derived calls. For the first
   analysis of a derived landscape: after the first „Gesammelt annehmen“ the toast offers the rule
   for that source, and once it is on, the unique calls each later import of that source proposes
   are accepted in the import's own write, marked and revocable, without a click and before the
   agent runs, so the agent's claims skip those pairs.

Not checked: a real tool export (only the synthetic Signavio fixture and the integrate plugin's
golden bundle, whose caller declares `export`; `converted` and `none` are covered by the unit and
real-PostgreSQL tests), the owner-key `next:` suggestion against a running server (unit-tested
with a fake API; the e2e harness has no owner key file, so the e2e flow uses „Hochladen“, a human
upload like the owner key), other browsers than Chromium, a real phone, a screen reader, CI (no e2e
job).

### M6 S2c-4 (2026-10-20)

Same machine; M6 S2c-4 („Vor der Vertrauensregel angenommen“, owner decisions 24.2 (a) and 28 (3),
[M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §8 "S2c-4 as delivered", [The trust
rule](#the-trust-rule-m6-s2c-1)) on `feat/integration-and-gaps` on top of S2c-3. Built by an
implementing agent, reviewed adversarially from a server, safety and data lens and from a web, CLI
and UX lens; all eight findings fixed (the dry run refusing a revision that is not listed as the
write does, 409 `not-listed` with a message that says to list again, so a client never loops;
`ofProposed` counted among the calls accepted before in the dry run as in the write, through
`relationImpact`'s new fourth parameter; the dialog's note that „Behalten“ is final and its
description; the toast's and the CLI's advice without "before the agent starts"; the CLI's `--json`
in the review's shape when nothing is listed; the CLI's dry run of `--keep` worded as one; the web
and the CLI counting the calls a rule accepts again by `ofProposed`; the missing web tests). For
the first analysis: a landscape imported before the trust rule catches up without a re-import, one
list and one decision per model; „Zurück in die Prüfung“ sends the calls straight to „Gesammelt
annehmen“ (or an enabled rule for that source accepts them again in the same write), and
„Behalten“ ends the question for good.

1. Gates: every gate green (`pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` with
   dependency-cruiser, 147 modules, no violations, `pnpm -r test` with Testcontainers: server
   1,711, web 647, CLI 269 plus 7 skipped, contracts 165, integrate 145, bpmn-facts 200, relations
   85, agent-sim 57, procedures 37, demo 27, notices 9, client 4, eval/tools 108; `pnpm
   eval:candidates`, `pnpm eval:replay`, `pnpm eval:placements`, `pnpm eval:descriptive`); `git
   diff --stat eval/reports` empty. Contracts first, the client regenerated; migration 0019
   generated (`drizzle-kit generate` into a scratch copy reports no schema changes), 0020
   hand-written. The MCP snapshots, the procedures and the recordings are unchanged (both routes
   are owner-only, nothing reaches agents), so it is live-run neutral.
2. The bundle guard: the entry 226.1 KB gzip (+0.1 after S2c-3's 226.0), the chain-only code
   13.7 KB; the dialog and its texts load with the lazy rules page, and the dialog's body mounts
   only when it opens, so the rules page makes no new request.
3. Scratch stacks of its own, both removed with their images afterwards: `analyzr-s2c4` (image
   `analyzr-s2c4:dev` from the working tree, ports 7631 and 55631, `analyzr seed` with the counts
   unchanged; the UI load guard with `ANALYZR_UI_LOAD_NORDWIND=nordwind-s2c4`) and the demo stack
   `analyzr-s2c4-demo` (port 7632).
4. Playwright in Chromium against `analyzr-s2c4` (`ANALYZR_E2E_URL=http://127.0.0.1:7631`), run
   after the gates had finished: 109 passed and 21 skipped (`pre-trust.spec.ts`'s 2 tests,
   `derived-call-rules.spec.ts` and `trust-calls.spec.ts` included). Against `analyzr-s2c4-demo`:
   `pnpm --filter @analyzr/demo check` 152 checks (147 before: `GET …/pre-trust-calls` refused
   with 403 for each of the five projects) and `e2e/demo.spec.ts` 14 passed.
5. The UI load guard's numbers at 1440 / 390 ("Web UI", Measured load): every screen as in
   S2c-3's run; no measured project has acceptances from before S2c, so none shows the card's
   line.

Not checked: the whole flow in a browser against a real revision from before the trust rule (the
API cannot make one; the Testcontainers tests strip the class by SQL, and the e2e spec stubs the
list and the review in the browser), the owner's own stacks with landscapes imported before S2c
(not touched), other browsers than Chromium, a real phone, a screen reader, CI (no e2e job).

### M6 S2b follow-up step 1 (2026-10-20)

Same machine; step 1 of M6 S2b's follow-up (the agent work in the dry runs, relations side,
[M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §3.5 and §8 "S2b follow-up step 1 as
delivered", [The relations tasks](#provenance-and-the-import-manifest-m6-s2a)) on
`feat/integration-and-gaps` on top of S2c-4. Built by an implementing agent, reviewed
adversarially from a correctness lens and from a refactor-safety and contracts lens; all eight
findings fixed (the amendment cost counting the pairs the amendment itself settles, now counted
against the relations after the write; `pairs`' description promising the exact claims, now an
upper bound; the dry run's added time at or above the 2 s threshold, found by both lenses, cut by
the prepared candidate index; the merged lists breaking their sort order; every batch reading
every live no-link, now only the changing models'; the claimed-task case without a fact change
untested end to end; `impact-merge.ts` without a zod-free source check). For the first analysis:
the server knows before an import how much agent work it sets off (the tasks it queues, the pairs
agents then judge), repeats (the pairs judged again) or destroys (a claimed task it cancels); the
„Vorschau“, the CLI's lines and the plugin show it from steps 3 and 4, and the amendment form's
number no longer counts pairs the amendment itself settles.

1. Gates: every gate green (`pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` with
   dependency-cruiser, 148 modules, no violations, `pnpm -r test` with Testcontainers: server
   1,745, web 647, CLI 269 plus 7 skipped, contracts 175, integrate 145, bpmn-facts 200, relations
   88, agent-sim 57, procedures 37, demo 27, notices 9, client 4, eval/tools 108; `pnpm
   eval:candidates`, `pnpm eval:replay`, `pnpm eval:placements`, `pnpm eval:descriptive`); `git
   diff --stat eval/reports` empty. Contracts first, the client regenerated (a second run gives
   the same output); no migration, no route. The MCP snapshots, the procedures, the recordings
   and the claim inputs are unchanged (`ImportImpact` and `AmendmentCost` are REST only,
   `renderClaims` is untouched, `claim-golden.test.ts` and `recompute-golden.test.ts` stay green),
   so it is live-run neutral.
2. The bundle guard: the entry 226.3 KB gzip (+0.2 after S2c-4's 226.1, ceiling 240): the
   contracts' `impact-merge.ts` with the relations tasks' merge in place of the web's own. The
   measurements on 16 renamed copies of `nordwind-handel` (496 models, 6,128 facts, 19,417 live
   no-links) with a 50-file batch of renamed labels: the dry run adds 0.67 s of CPU (1.69–1.73 s
   before the prepared index; the 50 focus models' candidates 0.63–0.64 s, 1.66–1.71 s before);
   the whole REST dry run against a real database takes 1.13–1.17 s (0.64 s of it candidates); the
   no-link read 31–34 ms (5,503 no-links of the batch's models; 94–97 ms for all 19,417 before);
   the task and head-hash reads 1–2 ms; an unchanged 50-file re-import 234–258 ms. The pair counts
   are identical with and without the prepared index (3,004 pairs, 2,889 judged again).
3. Scratch stacks of its own, both removed with their images afterwards: `analyzr-s2bf1` (image
   `analyzr-s2bf1:dev` from the working tree, ports 7633 and 55633, `analyzr seed` with the counts
   unchanged; the UI load guard with `ANALYZR_UI_LOAD_NORDWIND=nordwind-s2bf1`) and the demo stack
   `analyzr-s2bf1-demo` (port 7634).
4. Playwright in Chromium against `analyzr-s2bf1` (`ANALYZR_E2E_URL=http://127.0.0.1:7633`), run
   after the gates had finished: 109 passed and 21 skipped. Against `analyzr-s2bf1-demo`: `pnpm
   --filter @analyzr/demo check` 152 checks; `e2e/demo.spec.ts`'s first run failed (4 passed in
   1.1 min; its output was not kept, so the cause is unknown; this step changes nothing the demo
   shows), and on a freshly built demo stack it passed three times in a row (14 passed each).
5. The UI load guard's numbers at 1440 / 390: every screen as in S2c-4's run (no user-visible
   text changed in this step).

Not checked: the new fields in a browser (no surface shows them before step 3), the measurements
on a container or CI host (a developer Mac only), other browsers than Chromium, CI (no e2e job).

### M6 S2b follow-up step 2 (2026-10-20)

Same machine; step 2 of M6 S2b's follow-up (placements in the dry runs,
[M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §3.5 and §8 "S2b follow-up step 2 as
delivered", [The placements in the dry runs](#provenance-and-the-import-manifest-m6-s2a)) on
`feat/integration-and-gaps` on top of step 1. Built by an implementing agent, reviewed
adversarially from a correctness lens (dry run equals write) and from a refactor-safety and
contracts lens; one major and five minor findings and a nit, all fixed (the write queuing a
placement task the dry run did not predict after a revoked auto-acceptance, now the rule tier
planned by `planRulePlacements`; the merged `due` called a lower bound, now approximate, the
largest batch's count; the fact order copied from the store and pinned only against itself, now
one comparator in `fact-order.ts` with an integration test; a re-placement under a held claim not
counted, now the held-claim rule; the deletion's due-ness and a multi-file import on a chain
project not checked against the write; an untyped outcome order, now a typed `Record`). For the
first analysis: before an import the server knows whether the placement agent must place
processes (again) and how many, and which accepted placements lose or change their process; the
„Vorschau“, the CLI's lines and the deletion listing show it from step 3. The e2e run found one
older web race, fixed in this step: an owner who clicked „Agent starten“ on the chain's line
before their agent tokens had loaded got the toast „Eingeplant“ and no popover, because
`RetryAgent` decided by the agent state of the click's render. It now opens the popover for
every owner (the plain button turns into its open trigger once the tokens are known) and shows
the toast only while they are not known when the requeue answers (`agent-start.test.tsx`, two
tests that fail on the old code).

1. Gates: every gate green (`pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` with
   dependency-cruiser, 150 modules, no violations, `pnpm -r test` with Testcontainers: server
   1,775, web 647 (649 with the `RetryAgent` fix, whose web gates ran again: format, typecheck,
   lint, test), CLI 269 plus 7 skipped, contracts 177, integrate 145, bpmn-facts 200, relations
   88, agent-sim 57, procedures 37, demo 27, notices 9, client 4, eval/tools 108; `pnpm
   eval:candidates`, `pnpm eval:replay`, `pnpm eval:placements`, `pnpm eval:descriptive`); `git
   diff --stat eval/reports` empty. Contracts first, the client regenerated; no migration, no
   route. The MCP snapshots, the procedures, the recordings and the claim inputs are unchanged
   (`ImportImpact` is REST only; `claim-golden.test.ts`, `recompute-golden.test.ts` and
   `value-chain-golden.test.ts` stay green unchanged after the `pipelineInputs` and
   `planRulePlacements` extractions and the shared fact order), so it is live-run neutral.
2. The bundle guard: the entry 226.6 KB gzip (+0.3 after step 1's 226.3, ceiling 240): the merge
   of the chain's part; the `RetryAgent` fix leaves it at 226.6. The measurements on 16 renamed
   copies of `nordwind-handel` (496 models, 6,128 facts, the golden chain, 512 processes judged
   over 31 claims, 64 rule proposals accepted) with a 50-file batch, on the final tree and a
   quiet machine: the chain reads take 6.4–10.5 ms (a held claim adds one query),
   `placementImpact` 9.5–10.7 ms of CPU (about 3 ms of it planning the rule tier), so a dry run
   gains about 20 ms per 50-file batch (25–30 ms on the busier machine of the review round); the
   whole REST dry run's medians of 7 runs, without a chain → with it: an unchanged batch 320 →
   327 ms, renamed processes 1,242 → 1,244 ms, changed end labels 1,159 → 1,193 ms (within the
   runs' spread).
3. The e2e run, after the gates, on scratch stacks built from the working tree (`analyzr-s2bf2`,
   the server on 7635 with `analyzr seed`: 26 models, 3 accepted and 36 proposed relations, 17
   findings; the demo `analyzr-s2bf2-demo` on 7636). The first full Playwright run had 108 passed,
   1 failed, 21 skipped: `value-chain-agent.spec.ts` „a reviewer's rejection makes a process due
   without a task; „Agent starten“ queues it“, where the popover did not open. The spec failed
   alone 3 times out of 3, and 2 times out of 2 on a stack built from step 1's commit `ce666a4`,
   so it was not step 2's server change; the trace showed the toast „Eingeplant“ in place of the
   popover (the race above). With the `RetryAgent` fix, on rebuilt stacks: the full Playwright
   suite 109 passed and 21 skipped (the spec green), the demo check 152 passed and 0 failed,
   `demo.spec.ts` 14 passed. The UI load numbers are unchanged against step 1 (24 rows). All
   logs in full in the session's scratchpad; the stacks and images are removed.

Not checked: the new fields in a browser (no surface shows them before step 3), the measurements
on a container or CI host (a developer Mac only), other browsers than Chromium, CI (no e2e
job).

### M6 S2b follow-up step 3 (2026-10-20)

Same machine; step 3 of M6 S2b's follow-up (the surfaces: the agent work of a dry run in the web
„Vorschau“, the CLI's `import --dry-run` lines and the `models delete` listing,
[M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §3.5 and §8 "S2b follow-up step 3 as
delivered", [The relations tasks](#provenance-and-the-import-manifest-m6-s2a), [Web UI](#web-ui)
„Hochladen“, [The `analyzr` CLI](#the-analyzr-cli)) on `feat/integration-and-gaps` on top of
step 2. Built by an implementing agent, reviewed adversarially from a surface-correctness lens and
from a UX-and-regression lens; 14 findings in all (one major), four of them found by both lenses; 12
fixed with tests, 2 rejected. The major one: on a first import previewed in several batches
„etwa“ / "about" hid a large undercount, since a pair between new models of different batches
counts in no batch. The web's batch note now names that gap when new models lie in two batches or
more („…, mögliche Relationen zwischen neuen Modellen verschiedener Teile fehlen in der Zahl.“),
the CLI's batch line always
(`…, and the pairs between new models of different batches are not counted`), and the code
comments now say that across batches the pairs are no bound either way (`lib/agent-cost.ts`, the
CLI's `agentWorkLine` and, comments only, the contracts' `impact-merge.ts`); the counts keep
„etwa“, and step 3b's backlog count is the full fix (delivered the same day,
[M6 S2b follow-up step 3b](#m6-s2b-follow-up-step-3b-2026-10-20)). Fixed as
well: „Was ändert sich?“ opening onto no list when the cost line was the only line, now shown only
when a list has items; the placement part missing the work of a task the import queues for
processes already due (after a deletion, which queues no task), now every process due for
`queued` (`max(due, newlyDue)`), in the web and the CLI alike; a double click going past the
claimed-task warning, now arming only, in all three places that ask a second time (the
„Vorschau“, the amend form, the action panel); counts formatted two ways in one line, now all
de-DE; the heaviest „Vorschau“ never measured, now the UI load guard's step „Vorschau (erneuter
Import)“; the fallback „Danach: keine Änderung an Relationen und Befunden.“ beside the warning,
now hidden while it shows; the `models delete` requeue hint repeated per model, now once after the
listing. Rejected: the cost line pushing the endpoints line into the list (the plan's order, the
cost line always the last of the three, kept) and a screen-reader live region when the button
arms (not a regression, the amend form has none either; left open for the owner, since it would
go into all three places). The readings taken on the open points are in [HANDOFF.md](HANDOFF.md)
§4 ("Taken during the M6 S2b follow-up step 3"). For the first analysis: before „Importieren“ the
consultant sees how much agent work an import sets off (the pairs to judge, the processes to place),
which agent work it repeats („davon erneut“) and whether it destroys an agent's running work (the
warning and the second click), so imports can be timed and batched without losing agent runs; on a
first import the line shows the agent work it sets off. The plugin follows in step 4 (delivered the
same day, [M6 S2b follow-up step 4](#m6-s2b-follow-up-step-4-2026-10-20)).

1. Gates: every gate green (`pnpm format:check`, `pnpm -r typecheck`, `pnpm -r lint` with
   dependency-cruiser, 150 modules, no violations, `pnpm -r test` with Testcontainers: server
   1,775, web 653, CLI 275 plus 7 skipped, contracts 177, integrate 145, bpmn-facts 200, relations
   88, agent-sim 57, procedures 37, demo 27, notices 9, client 4, eval/tools 108; `pnpm
   eval:candidates`, `pnpm eval:replay`, `pnpm eval:placements`, `pnpm eval:descriptive`); `git
   diff --exit-code eval/reports` clean. No migration, no route and no contract change (only
   comments in `packages/contracts/src/impact-merge.ts`), so no client regeneration. The MCP
   tools, the procedures, the plugin and the recordings are untouched (the step changes only the
   web and the CLI), so it is live-run neutral.
2. The bundle guard and the UI load numbers: the entry 227.6 KB gzip (+1.0 after step 2's 226.6,
   ceiling 240; 227.4 before the review fixes); `lib/agent-cost.ts` (the cost line, the warning,
   the second click) is in the entry, while `amendments.ts` stays lazy (it re-exports
   `CLAIMED_WARNING` and uses the shared second click). The UI load guard at 1440 / 390 ("Web UI",
   Measured load), from the fix round's run and again in the lead's run on the final tree: UX7's „Vorschau“ (the first import of the raw Signavio export) 20 controls, 133
   words, 6 badges (128 words before: the cost line adds „· 7 mögliche Relationen zu
   beurteilen“); the new step „Vorschau (erneuter Import)“ on the worked `nordwind-handel`
   (`finanzen/rechnungsstellung` re-exported with other documentation, a dry run only) 16
   controls, 95 words, 1 badge at 1440 and 16 controls, 93 words, 1 badge at 390, no horizontal
   scroll; no budget constant changed. Every other row as in step 2's run (26 rows in the lead's
   run against step 2's 24, „Projekte“ included).
3. The e2e run: the implementer and the fixer each built the scratch stack `analyzr-s2bf3i`
   (image `analyzr-s2bf3i:dev` from the working tree; ports 7641 and 55641 in the fix round) and
   removed it with its image afterwards. Before the review round the full Playwright suite in
   Chromium passed there (110 passed and 21 skipped, the same 21 as in step 2's run;
   `upload-preview.spec.ts` included). After the fixes: `smoke.spec.ts` 5 of 5 and
   `upload-preview.spec.ts` with `ui-load.spec.ts` 31 of 31; the first `ui-load` run failed UX1
   on the stack's own `nordwind-handel`, which `analyzr seed` makes without the chain and the
   agent's work, and the rerun with `ANALYZR_UI_LOAD_NORDWIND=nordwind-s2bf3f` passed (the
   guard's row in [Commands](#commands-repository-root) now says so). The lead's run on the final
   tree, after the gates, on scratch stacks built from the working tree (`analyzr-s2bf3`, the
   server on 7651 with `analyzr seed` and `ANALYZR_UI_LOAD_NORDWIND=nordwind-s2bf3`; the demo
   `analyzr-s2bf3-demo` on 7652): the full Playwright suite 111 passed and 21 skipped (step 2's 109
   and the two new tests, `upload-preview.spec.ts` and the guard's „Vorschau (erneuter Import)“;
   the same 21 skipped), the demo check 152 passed and 0 failed, `demo.spec.ts` 14 passed. All
   logs in full in the session's scratchpad; the stacks and images are removed.

Not checked: other browsers than Chromium, a real phone, a screen reader (arming announces nothing
new, left open above), the warning for several models and a first import in several batches in a
browser (unit tests only: the e2e spec has one claimed model and one batch), the amend form's own
button under a double click (the test covers the action panel, which shares `repeated`), CI (no
e2e job).

### M6 S2b follow-up step 3b (2026-10-20)

Same machine; step 3b of M6 S2b's follow-up (the size of the agents' next run,
[M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §3.5 and §8 "S2b follow-up step 3b as
delivered", [The agents' next run](#provenance-and-the-import-manifest-m6-s2a), [Web UI](#web-ui)
„Übersicht“ and „Hochladen“, [The `analyzr` CLI](#the-analyzr-cli)) on `feat/integration-and-gaps`
on top of step 3. `ProjectSummary.pairsToJudge` (REST only) counts the distinct typed pairs the
next claims of the relations tasks an agent may claim now will be assigned, over the stored head:
„Als Nächstes“ names it beside „Agent starten“ or „Agent verbinden“ and in the waiting line („5
Modelle warten auf den Agenten · etwa 7.300 mögliche Relationen“), so does the waiting text on
„Hochladen“ after an import, and the CLI's waiting line of `analyzr import` and the models line
of `analyzr status` (`about 7300 pairs to judge`). Built by an implementing agent, reviewed
adversarially from a count-correctness lens and from a surface-and-UX lens; 12 findings in all, 9
fixed, 3 not taken. Fixed from the count-correctness lens: the summary's second candidate-cache
lookup, which under concurrency could run the whole-project pass again (now
`loadOpenQuestionInput` returns the pass's own candidates, and a test with `CandidateCache(0)`
counts one pass per build); two helpers the count did not need (`waitingPairs` and
`CandidateCache.focusPairs`, removed: the count is the plain `pairsToJudge` over the claimable
models' own candidates with the held pairs as judged); an expired lease that held its pairs until
the next event (now the summary reads the clock: only a live lease holds, a claimed task whose
lease ran out with attempts left counts as `TaskRepo.claim` would take it, and the memo entry ends
with the earliest live lease); the benchmark's old side, which ran the new candidate code (now
measured against the real HEAD, with `emit` making no closures per call); a revision query per
claimed task (now only for live claims whose assignment names a claimable model revised since).
Fixed from the surface-and-UX lens: the batch notes did not say where the whole number shows (now
„…; die ganze Zahl steht nach dem Import unter „Als Nächstes“.“ and `… (after the import, the
waiting line and analyzr status count them)`); „Hochladen“ could show a number from before the
import after a failed summary read (in TanStack Query 5.104.1 `isFetchedAfterMount` is true after
a failed fetch too; now `isSuccess && isFetchedAfterMount`); the route's description contradicted
the UI (now the badge counts go to editors and owners, `pairsToJudge` to every member beside the
models waiting for an agent); the UI load guard's new check could pass silently (now it asserts a
count above 1 and the suffix before it measures). Not taken: „zu beurteilen“ in the suffix (the
plan's text; two more words), no „etwa“ in front of a count that is exact for the stored state
(„etwa“ stays from 2 on), and the docs' old lines (left to the docs pass, which this is). The
readings taken on the open points, the count's definition among them, are in
[HANDOFF.md](HANDOFF.md) §4 ("Taken during the M6 S2b follow-up step 3b"). For the first
analysis: right after a first import in parts, and on every „Übersicht“, the consultant sees how
big the agents' run will be, the one number a preview in batches cannot give (a pair between new
models of different batches counts in no batch), and can plan the agent run and its cost.

1. Gates, from the fix round's run: every gate green (`pnpm format:check`, `pnpm -r typecheck`,
   `pnpm -r lint` with dependency-cruiser, 150 modules, no violations, `pnpm -r test` with
   Testcontainers: server 1,783, web 659, CLI 278 plus 7 skipped, contracts 178, integrate 145,
   bpmn-facts 200, relations 91, agent-sim 57, procedures 37, demo 27, notices 9, client 4,
   eval/tools 108; `pnpm eval:candidates`, `pnpm eval:replay`, `pnpm eval:placements`, `pnpm
   eval:descriptive`); `git diff --exit-code eval/reports` clean. Contracts first
   (`ProjectSummary.pairsToJudge`, required, and the route's description), the client regenerated;
   no migration, no new route. The MCP tools and their snapshots (no MCP output carries
   `ProjectSummary`; `Project`, MCP `list_projects`, is unchanged), the procedures, the claim
   inputs, the plugin and the recordings are untouched, and `generateCandidates` returns what it
   did (`projectCandidates` shares its internals; `eval:candidates` unchanged), so it is live-run
   neutral.
2. The bundle guard, the UI load numbers and the measurements: the entry 227.9 KB gzip (+0.3 after
   step 3's 227.6, ceiling 240): `pairsToJudgeText` in `lib/agent-cost.ts` and the summary's query
   on „Übersicht“ and „Hochladen“. The UI load guard at 1440 / 390 ("Web UI", Measured load), from
   the implementer's and the fixer's runs: UX1's budget for „Als Nächstes“ is now checked on
   `signavio-beispiel` too, whose models wait: 22 words and 4 controls with „etwa N mögliche
   Relationen“ beside „Agent verbinden“ (budget 40 and 5); its „Übersicht“ 20 controls, 117 / 102
   words, 9 badges (113 / 98 words before: the suffix's four); `nordwind-handel`'s rows unchanged
   (its agent run is done, nothing waits); no budget constant changed. `getProjectSummary` on 496
   models (16 renamed copies of `nordwind-handel` on a real PostgreSQL), HEAD's code and the new
   code interleaved in one process on the same state, medians of 3, in three states: A, all 496
   waiting (19,417 pairs); B, 100 done, 5 held, 391 waiting (13,591); C, 50 of the done models
   re-imported (16,586). Cold, candidates computed: 5,429 → 5,662, 5,449 → 5,620 and 5,667 → 5,969
   ms, within the runs' spread (the candidate pass alone, medians of 9: HEAD's `generateCandidates`
   5,345 ms, the new one 5,356 ms, `projectCandidates` 5,335 ms); right after the open questions'
   read 212 → 227, 266 → 305 and 262 → 345 ms; with the candidates cached 199 → 242, 254 → 306 and
   264 → 302 ms; memoized 1–2 ms before and after. So a rebuild costs 15–83 ms more, and a
   memoized read (most rows of the projects list) nothing. In state C the 440 claims' assignments
   together are 16,586 pairs, equal to `pairsToJudge`.
3. The e2e run: the implementer and the fixer each built the scratch stack `analyzr-s2bf3bi`
   (image `analyzr-s2bf3bi:dev` from the working tree, ports 7661 and 55661, `analyzr seed`,
   `ANALYZR_UI_LOAD_NORDWIND=nordwind-s2bf3b`) and removed it with its image afterwards. There, in
   Chromium, in both rounds: `ui-load.spec.ts` 30 passed, `smoke.spec.ts` with
   `upload-preview.spec.ts` 6 passed; `analyzr status` on the freshly seeded `nordwind-handel`
   printed `  models     31 (31 waiting for agent), about 198 pairs to judge` (the union of what
   the 31 claims will be assigned, as the server test checks on the same landscape; the calls the
   rule tier accepted are settled and count not). The lead's run, after the gates, on scratch
   stacks built from the working tree (`analyzr-s2bf3b`, the server on 7671 with `analyzr seed`
   and `ANALYZR_UI_LOAD_NORDWIND=nordwind-s2bf3b`; the demo `analyzr-s2bf3b-demo` on 7672): the
   first full Playwright run had 110 passed, 1 failed, 21 skipped: `value-chain-agent.spec.ts`
   „a reviewer's rejection makes a process due without a task; „Agent starten“ queues it“, where
   the chain stayed `waiting_for_review`. The trace shows the click on `requeue-chain` done and no
   requeue request sent: the click landed as the owner's agent tokens arrived, when `RetryAgent`
   swapped its plain button for the popover's trigger (another element), so neither got the
   click; the spec alone passed 3 times out of 3. An older race, not step 3b's: `RetryAgent` now
   renders one button element before and after the tokens arrive (it opens the popover only once
   they are known); `agent-start.test.tsx` asserts the same element and fails on the old code; the
   web gates ran again (format, typecheck, lint, test: web 659). On rebuilt stacks: the full
   Playwright suite 111 passed and 21 skipped (the same tests as in step 3's run), the demo check
   152 passed and 0 failed, `demo.spec.ts` 14 passed. Its UI load numbers against step 3's run:
   only `signavio-beispiel`'s „Übersicht“ differs (117 / 102 words, 113 / 98 before). All logs in
   full in the session's scratchpad; the stacks and images are removed.

Not checked: other browsers than Chromium, a real phone, a screen reader, the measurements on a
container or CI host (a developer Mac only), a lease running out in a browser (the server test
covers the count and the memo), the suffix beside „Agent starten“ in an e2e spec (the e2e stacks'
owners have no token; a web unit test covers it), CI (no e2e job).

### M6 S2b follow-up step 4 (2026-10-20)

Same machine; step 4 of M6 S2b's follow-up (the integrate plugin 0.1.3,
[M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §3.7 and §8 "S2b follow-up step 4 as
delivered", [The integrate plugin and `tools/integrate`](#the-integrate-plugin-and-toolsintegrate-m6-s3b))
on `feat/integration-and-gaps` on top of step 3b. By owner decision 29 (2) the skill's
pre-approved way to analyzr is the plugin's own read-only script `analyzr-read.mjs` (`models`,
`external-ids` and `preview`: only `GET …/models`, `GET …/external-ids` and `POST …/imports` with
`dryRun=true` built in, loopback hosts only, no redirects, no proxy), pre-approved next to
`inspect.mjs`; `normalize-bpmn.mjs plan --from-analyzr` rebuilds a lost or stale `keymap.json`
from analyzr's identities (the pure `rebuildFromAnalyzr` and `inferRule`); the skill runs the
preview itself into an existing project and reports it in a section „Vorschau“ in the web's words,
the agent work in the „Kurzfassung“; `normalize-bpmn` declares `exporterVersion` tidied as
analyzr stores it, without a new `NORMALIZE_BPMN_VERSION`. Built by an implementing agent,
reviewed adversarially (its findings on security, the key-map rebuild, the skill and the release);
of the review round's findings 25 fixed, 1 fixed in part, 1 rejected and the docs item left to
this docs pass.
Fixed among them: a proxy bypass (Node 24.15 tunnels even a request to 127.0.0.1 through
`HTTP(S)_PROXY` with `NODE_USE_ENV_PROXY` or `--use-env-proxy` in any spelling; now `NO_PROXY=*`
before any request and the refusal catching every spelling); a dangling symbolic link and writes
outside `reports/` through `--json-out` (now only an existing `reports/` next to
`analyzr-workspace.json`, no symbolic link, `O_NOFOLLOW`, no folder created; the lead added: no hard
link); a malformed `ANALYZR_TOKEN` printed in an error (the token's pattern checked, the secret
stripped from every error); the skill not forbidding to extend a pre-approved command (now: nothing
in front of `node`, nothing after the command, no substitution in an argument, `--url` the
workspace's `analyzrUrl`; tested); a duplicate model from a tool path analyzr stored tidied (paths
compared in the stored form, `src/declared.ts`); „(älter)“ where the kept key was not the older one
(`keptBy`: `oldest`, `keymap`, `path` or `null`, a text each); a tool id lost when its oldest holder
had no tool path; `inferRule` proposing a strip folder the map refuses; no fallback where the script
cannot reach analyzr (the CLI's read commands, each approved once); ground rule 2 contradicting step
5; `external-id-moved` in a preview (now its own wording, no import recommended, back to step 3);
`ANALYZR_TOKEN` reaching the real import (the skill says to unset it); the `permissions.allow` offer
(removed until the owner's live check); a weak import test (every spelling of an import command
checked). In part: the refusal under Node's proxy support stays next to `NO_PROXY=*` as a second
guard, so a sandbox that sets `NODE_USE_ENV_PROXY` with a proxy falls back to the consultant's dry
run. Rejected: a health check before the credential is sent (decision 29 (2) allows exactly three
requests, and any local process can fake the answer; the skill instead requires `--url` to be the
workspace's `analyzrUrl`). The readings taken on the open points are in [HANDOFF.md](HANDOFF.md) §4
("Taken during the M6 S2b follow-up step 4"). For the first analysis: a consultant's first import of
a big export goes through without duplicate models (a lost key map is recovered from analyzr before
any key is derived afresh, and a tool id on two keys is named with the deletion for the consultant)
and with the agent work known up front (the skill previews the import itself, cannot import, and
reports the pairs to judge, the processes to place, the work repeated and an agent's running work
the import would cancel, before the consultant imports).

1. Gates, from the fix round's run: every gate green (`pnpm format:check`, `pnpm -r typecheck`,
   `pnpm -r lint` with dependency-cruiser, 150 modules, no violations, `pnpm -r test` with
   Testcontainers: server 1,783, web 659, CLI 281 (278 before: the three new e2e tests) plus 7
   skipped (the live project), contracts 178, integrate 205 (145 before), bpmn-facts 200,
   relations 91, agent-sim 57, procedures 37, demo 27, notices 9, client 4, eval/tools 108; `pnpm
   eval:candidates`, `pnpm eval:replay`, `pnpm eval:placements`, `pnpm eval:descriptive`); `git
   diff --exit-code eval/reports` clean. No contract, route or migration, no client regeneration;
   the server, the web, MCP and its snapshots, the procedures, the claim inputs, the pipeline plugin
   `analyzr` and the recordings are untouched, and the integrate plugin is never loaded in live
   runs, so it is live-run neutral.
2. The plugin: `pnpm --filter @analyzr/integrate generate` wrote the new `analyzr-read.mjs` and a
   new `normalize-bpmn.mjs`; `inspect.mjs` and the plugin's `THIRD-PARTY-NOTICES.md` stayed as they
   were (`analyzr-read.mjs` bundles no third-party code), and the drift test is green.
   `RELEASES['0.1.3']` = `c1915b05d18beea39d4436899be3edeff98ca4e7318aacfd2726d12333317f61` with a
   comment, rows 0.1.0 to 0.1.2 unchanged. `claude plugin validate --strict
   plugins/analyzr-integrate` (Claude Code 2.1.303, a local check without an LLM call):
   `✔ Validation passed`; it reports on the manifest only and says nothing about the skill's
   `allowed-tools`. `pnpm notices` left the root `THIRD-PARTY-NOTICES.md` unchanged (no new
   dependency). `.claude-plugin/marketplace.json`, the procedures' `RELEASED` and
   `PLUGIN_RELEASES` and `NORMALIZE_BPMN_VERSION` (0.1.0) are untouched; `ANALYZR_READ_VERSION`
   0.1.0 is new.
3. The e2e run: the CLI e2e runs the bundled scripts against the real server of its Testcontainers
   (the preview equal to `analyzr import --dry-run --json` on `m6-s2a` and `nordwind-handel` with
   `seq` and the models unchanged; `external-ids` into `plan --from-analyzr`: the strip rule, 6 of 6
   fitting, one duplicate, one skipped key). Before the review round the implementer's scratch stack
   `analyzr-s2b4i` (image `analyzr-s2b4i:dev` from the working tree, ports 7681 and 55681, `analyzr
   seed`) answered the bundled script with a read token: the golden bundle previewed into
   `nordwind-handel` (5 new, 1 revised, 6 relations tasks queued, 38 pairs, 1 task cancelled), and
   404 for a missing project; the stack, its volumes, the image, the token file and the scratch
   files are removed. The fix round used no stack; the docs pass rebuilt the same stack from the
   reviewed tree and got the same numbers and the 404 with the bundled script and a read token, and
   removed it again. The lead's run on the final tree: the scratch stack `analyzr-s2b4` (image
   `analyzr-s2b4:dev` from the final tree, ports 7690 and 55690, `analyzr seed`): the full
   Playwright suite 111 passed and 21 skipped, the test names and the UI load numbers as in step
   3b's run; the demo stack `analyzr-s2b4-demo` (port 7691): `pnpm --filter @analyzr/demo check` 152
   of 152 and `demo.spec.ts` 14 of 14; the bundled `analyzr-read.mjs` with a read token on
   `analyzr-s2b4`: the golden bundle previewed into `nordwind-handel` (5 new, 1 revised, 6 relations
   tasks queued, 38 pairs, 1 task cancelled), `lastSeq` unchanged, `models` and `external-ids`
   written into the workspace's `reports/`, 404 with exit 1 for a missing project, a hard-linked
   `--json-out` and the command `import` refused; the stacks, their volumes and images and the
   workspace removed.

Not checked: the skill invoked in a Claude Code or Codex session (no LLM call was made), and with
it the points the owner checks once in a live session ([HANDOFF.md](HANDOFF.md) §8): that the
two comma-separated `Bash(…)` rules of `allowed-tools` count as two rules; that
`${CLAUDE_SKILL_DIR}` expands inside `allowed-tools`; whether the pre-approval lasts only for the
invoking turn (then decide on a lasting `permissions.allow` rule with the expanded path, its
`/../../` form included); that compound commands are checked part by part (`;`, `&&`, `||`, `|`,
a newline), that a prefix such as `NODE_OPTIONS=…`, `HTTP_PROXY=…` or `ANALYZR_TOKEN=…`, a
redirect such as `> ~/x` and `$(…)` or backticks in an argument each make Claude Code ask; that
the guard sandbox lets the script reach loopback, still denies the owner key and passes
`ANALYZR_TOKEN` into sandboxed commands, and whether it sets `NODE_USE_ENV_PROXY` or
`--use-env-proxy` with `HTTP(S)_PROXY` (then `analyzr-read` refuses by design); what rule "don't
ask again" would write for the CLI's dry run. Not checked either: a real or sandbox export (M6
§10.4), CI (no e2e job).

### M6 S2b follow-up step 5 (2026-10-20)

Same machine; step 5 of M6 S2b's follow-up (the identity rows of owner decision 29 (1),
[M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §3.3, §3.4 and §8 "S2b follow-up step 5 as
delivered", [Provenance and the import manifest](#provenance-and-the-import-manifest-m6-s2a), [Web
UI](#web-ui) „Hochladen“ and the model view, [The `analyzr` CLI](#the-analyzr-cli)) on
`feat/integration-and-gaps` on top of step 4. An append-only identity row per import and model
(`model_identity`, migrations 0021/0022: system, tool id, tool folder, link) is written for every
stored file a manifest lists and for an unchanged one whose declaration differs from the model's
newest row (then with an internal event `model.identity_declared`); `external-ids`, the identity
warnings, the dry run's absent keys, the change list and „Herkunft“ (through the new
`Model.identity`) read the newest row, while the revision keeps its first provenance and trust
class; no re-analysis, `facts_hash` untouched, nothing re-queues.
`ImportFileOutcome.identityUpdated` marks such a file in the import and its dry run alike: the web
offers „Importieren“ for it with „Danach: Ort im Quellsystem für 6 Modelle aktualisiert“, the CLI's
manifest line counts it, and `provenance-kept` now says only that the revision keeps its derivation.
Built by two implementing agents (the server; the CLI and the web), reviewed adversarially
(semantics, data, surfaces); of the review round's 8 distinct findings 6 fixed and 2 rejected.
Fixed: `provenance-kept` was hidden whenever `trust-kept` fired, also when only the credential
differed (a model stored as an agent upload, the owner now declaring `export`), so the owner was
never told that the derivation stays „Ohne Angabe“, and a read-only token's dry run answered
differently from the owner's (now it is hidden only next to a `trust-kept` that names the
derivation, `trustKeptNamesDerivation` in `trust.ts`, and dropped as a file's fifth warning,
`withinWarningLimit` with `MAX_IMPORT_WARNINGS`); a stale route description of `external-id-changed`
(the client regenerated); a guard that let an `unchanged` row through whose event named another
system, tool id, principal or client, or that named another revision than the one the live model
keeps (now refused, and a `revision` row must carry its revision's principal); the CLI line not
saying that the identity is recorded (now `records`); an upload panel test that never reached the
branch it named; the bundle history's numbers and one test's placement. Rejected: the result
headline confirming the recorded places after „Importieren“ (the plan keeps `importHeadline` as it
is; for the owner, [HANDOFF.md](HANDOFF.md) §4) and the owners' rules named in the German
`provenance-kept` text (the plan's text, which says that the derivation stays). The readings taken
on the open points are in [HANDOFF.md](HANDOFF.md) §4 ("Taken during the M6 S2b follow-up step 5").
For the first analysis: a re-export after a folder reorganization, or a bundle imported over models
first uploaded without one, keeps analyzr's record of where each model lives current with the normal
import and without re-analysis, so the key-map rebuild plans those files as known, the absent-key
list of a scoped export names the right models, the change list points to where a model lives now,
and no stale folder lets a path-derived key create a duplicate model.

1. Gates, from the fix round's run: every gate green (`pnpm format:check`, `pnpm -r typecheck`,
   `pnpm -r lint` with dependency-cruiser, 150 modules, no violations, `pnpm -r test` with
   Testcontainers: server 1,804 (1,783 before), web 663 (659), CLI 286 (281) plus 7 skipped (the
   live project), contracts 178, integrate 205, bpmn-facts 200, relations 91, agent-sim 57,
   procedures 37, demo 27, notices 9, client 4, eval/tools 108; `pnpm eval:candidates`, `pnpm
   eval:replay`, `pnpm eval:placements`, `pnpm eval:descriptive`); `git diff --exit-code
   eval/reports` clean. Contracts first (`ModelIdentity`, `Model.identity`, required and nullable,
   `ImportFileOutcome.identityUpdated`, `MAX_IMPORT_WARNINGS`, the docs and route descriptions), the
   client regenerated; no new route, query parameter, warning code or dependency; a scratch
   `drizzle-kit generate` against a copy reports no schema changes. The integrate plugin stays 0.1.3
   (nothing under `plugins/analyzr-integrate` or `tools/integrate/src` changed; its drift and plugin
   tests green unchanged), and `packages/procedures`, the pipeline plugin, `impact-merge.ts`,
   `paths.ts`, `ImportImpact`, `ManifestSummary`'s JSON, MCP and its snapshots (no MCP output
   carries `Model` or an import outcome), the claim inputs, facts, `facts_hash`, the trust class and
   the recordings are untouched; no live-run project imports a manifest, so it is live-run neutral.
2. The bundle guard and the measurements: the entry 228.1 KB gzip (233,528 B, +99 B over the same
   build of step 3b's web sources, 233,429 B; ceiling 240): one condition and `identityUpdateText`
   in the upload panel, `Model.identity` read in `lib/provenance.ts` (both dialogs stay lazy). The
   reads on 496 models imported with a manifest, a scratch copy of HEAD against the working tree,
   medians of 7: `GET …/landscape` 232.4 → 230.5 ms (no measurable change),
   `models.list` of all 496 13.5 → 17.1 ms, `models.view` 12.7 → 14.2 ms, `uploadedSources` 2.5 →
   3.8 ms, `GET …/external-ids` 3.3 → 4.7 ms; the import itself 40.9 → 38.0 s. The UI load guard:
   every screen's numbers as after step 4 (the lead's run below).
3. The e2e run: the CLI e2e runs the new test against the real server of its Testcontainers (a copy
   of the golden bundle with its folders under `Verschoben/`: the line in the dry run, `lastSeq`
   unchanged, and in the import, `lastSeq` +6; the moved folders from `models external-ids --json`
   and from the bundled `analyzr-read.mjs external-ids`). Before the review round the implementer's
   scratch stack `analyzr-s2b5i` (image `analyzr-s2b5i:dev` from the working tree, ports 7685 and
   55685, `analyzr seed`) ran `smoke.spec.ts` with the extended UX8 bundle test, 5 of 5 passed; the
   stack, its volumes and the image are removed. The lead's run on the final tree, on the scratch
   stacks `analyzr-s2b5` (ports 7690 and 55690, `analyzr seed`) and `analyzr-s2b5-demo` (port 7691):
   the full Playwright suite 111 passed and 21 skipped, the same tests as after step 4
   (`ANALYZR_UI_LOAD_NORDWIND=nordwind-s2b5`), the UI load numbers equal to step 4's on every
   screen, the demo check 152 of 152, `demo.spec.ts` 14 of 14. The first two full runs failed one
   test, „CSS check: the chain page is unchanged after the review screen“ (`value-chain.spec.ts`:
   the chain canvas's screenshot after the review screen differed from the one before), while the
   machine's load average stood near 28 from processes outside analyzr; `value-chain.spec.ts` alone
   failed it once more then, passed nine times since (two of them against a stack built from
   57a109f, under the same load), and the third full run passed. Step 5 touches neither the chain
   page nor the review screen, so it reads as a timing flake of a pixel comparison under load;
   should it come back on a quiet machine, it needs a look. The stacks, their volumes and images are
   removed. `analyzr-local` rebuilt from the final tree (health ok, 23 migrations applied), its
   backfill checked: 0 rows, as none of its 63 revisions declares a system (its `external-ids` stay
   empty, as before); nothing of the owner's other stacks touched.

Not checked: a real or sandbox re-export of a customer tool (M6 §10.4), the integrate skill's report
of an identity-only re-export in a live session (plugin 0.1.3 reports „keine Änderung an Relationen
und Befunden.“ there and hands over the import command, which records the places;
[HANDOFF.md](HANDOFF.md) §4), other browsers than Chromium, a real phone, a screen reader, the
measurements on a container or CI host (a developer Mac only), CI (no e2e job).

### M6 S3c step 1 (2026-10-21)

Same machine; step 1 of M6 S3c (`analyzr-spec/1` and the deterministic renderer,
[M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §3.9 and §8 "S3" and "S3c step 1 as
delivered", owner decision 30, [The integrate plugin and
`tools/integrate`](#the-integrate-plugin-and-toolsintegrate-m6-s3b) "`analyzr-spec`") on
`feat/integration-and-gaps` on top of S2b's follow-up step 5. A strict format for one model per
file, `analyzr-spec/1` (YAML 1.2 core or JSON, no key and no name, a `source` id per element,
message and signal names only where the source names them), its validator, and a renderer that turns
it into BPMN 2.0 with DI and without an engine: ids `<Category>_<source id>` from one capped,
collision-checked id function, the eval layouter's algorithm made independent of the order of nodes,
flows and data stores (pools and lanes in list order), calls
as collapsed subprocesses with `link-unresolved` and never a `calledElement`, and a self-check on
every render; with `plan` (keys from the tool path, the flag `replaces-known-model`) and `bundle`
(an `analyzr-import/1` bundle declaring `reconstructed`), in `tools/integrate/src/spec/` and the
entry `src/cli/analyzr-spec.ts`, run from source until plugin 0.1.4. Built by an implementing agent,
reviewed adversarially (renderer, security, tests); of the review round's 25 distinct findings (3
major) 24 fixed, one of them with a sub-point rejected, and 1 in part, and the fixer found one bug
more. Fixed among them: an element id equal to another element's id plus `_label` or `_plane`, the
ids bpmn-js gives that element's label or drill-down plane, so the browser lost a label or failed a
plane (now reserved by the id function, refused by the self-check, recorded by the CI walker and
counted by the harness); a valid spec of 5,000 nodes with long flows that ran out of memory in the
layout (now at most 100,000 slots, `layout-too-large` in 0.2 s, the model listed as failed and the
others bundled); `render` writing into a workspace's `exports/` (every output now refused below the
`exports/` of the input's and the output's workspace, and `render` needs a new `.bpmn` file); flow
labels on shapes; nested loops leaving their pool; `validate` quadratic in processes (20,000
processes in 68 ms instead of 80 s, and a limit of 1,000 parts); the whole file read before its size
was checked (now a regular file only, at most 2 MB plus one byte read); a re-plan flagging its own
keys and `exists-in-analyzr` not flagged by `replaces-known-model`; `counts.flagged` without the new
flag; messages echoing input at any length; facts pins without ids and contents; the self-check
rules and the walker's refusals untested one by one. Rejected: a `moved` case for
`replaces-known-model`, which a spec without a tool id cannot reach. In part: the three fuzz loops
stay in their test files. The fixer's own find: after an element that failed validation, later
problems named the wrong list index. The readings taken on the open points are in
[HANDOFF.md](HANDOFF.md) §4 ("Taken during M6 S3c step 1"). For the first analysis: landscapes that
exist only as Visio, ARIS AML, PDFs or whiteboard pictures get one strict format and one renderer
whose BPMN extracts without a warning, imports into bpmn-js without a warning, draws in the model
view at once and carries no guessed call link, so steps 2–4 can bring them into analyzr in the same
first pass as the BPMN exports.

1. Gates, from the fix round's run: every gate green (`pnpm format:check`, `pnpm -r typecheck`,
   `pnpm -r lint` with dependency-cruiser, 150 modules, no violations, `pnpm -r test` with
   Testcontainers: integrate 332 (205 before), server 1,804, web 663, CLI 286 plus 7 skipped (the
   live project), contracts 178, bpmn-facts 200, relations 91, agent-sim 57, procedures 37, demo 27,
   notices 9, client 4, eval/tools 108; `pnpm eval:candidates`, `pnpm eval:replay`, `pnpm
   eval:placements`, `pnpm eval:descriptive`); `git diff --exit-code eval/reports` clean; `pnpm
   --filter @analyzr/integrate generate` followed by `git diff --exit-code
   plugins/analyzr-integrate` clean, so plugin 0.1.3 is byte-identical (the new modules are in no
   entry, and the type-only widenings of `src/bundle.ts` and `src/keymap.ts` leave no byte in a
   bundle). `yaml@2.9.1` (ISC, already in the workspace) is a new dependency of `tools/integrate`
   and `bpmn-js@18.31.0` (the bpmn.io license, already in `apps/web`) a new devDependency: importer
   entries only in the lockfile, and `pnpm notices` left `THIRD-PARTY-NOTICES.md` unchanged. No
   server, contract, client, CLI, web product, MCP, procedure, migration, facts or trust-rule
   change; the pipeline plugin and the recordings are untouched, so it is live-run neutral. The
   Testcontainers left no container behind.
2. What was checked, on the 9 synthetic goldens and 200 seeded random specs (1–4 processes, 1–40
   nodes, sources of 1–200 characters, sources like generated ids, `x_label` and `x_plane`, message
   names that come out alike, texts from a hostile alphabet with control characters, U+2028, U+FFFE,
   U+D800 and U+DFFF): D1, `extractFacts` with `warnings: []` and `engine: null`, every process
   `isExecutable="false"`, no Camunda, Zeebe or modeler namespace and no `exporterVersion`, and per
   golden the facts pinned with their element ids and contents; D2 (a), bpmn-moddle without a
   warning and bpmn-js's `BpmnTreeWalker` with a handler applying `BpmnImporter`'s refusals (an
   unknown DI, a parent or connection end not yet drawn, an end not specified, a missing
   `attachedToRef`, a shape on a connection, an edge on a node), every drawable element drawn
   exactly once and every id bpmn-js registers unique, with negative cases; D3 (a), `calledElement`
   an unknown field with a hint, `callActivity` an unknown type, `name` on a call refused; D3 (b),
   no `callActivity` element and no `calledElement` attribute in any parsed tree, which the runtime
   self-check also refuses; eval's DI rules and the readability checks; determinism: the same bytes
   twice, from YAML and JSON and with shuffled nodes, flows, message flows, data stores, reads and
   writes, reordered lanes and pools moving only DI, another key changing only the definitions and
   collaboration ids, refined node types keeping their ids; `RENDER_OUTPUTS['0.1.0']` =
   `f3ad4d7f248abb5145bb9d12f075dc459fcb6f5ae214dc817217862164477c20` (replaced once before any
   commit, after the review round's layout fixes changed four goldens; HANDOFF §4); the plugin
   byte-identical after `generate`. The renders were also looked at in bpmn-js on screenshots, which
   is where a join's exit along its entries and a message flow through an unrelated start event were
   found.
3. The e2e run: the Playwright harness spec `apps/web/e2e/spec-render-import.spec.ts` (D2 (b); no
   analyzr server, so no stack was built) ran once in the implementing agents' run, `pnpm --filter
   @analyzr/web e2e spec-render-import`: 2 of 2 passed (9 goldens, 50 random renders); the fix round
   ran it again with `--output` in the scratchpad, 2 of 2, after the stricter count of what is
   drawn, and imported 400 random renders in Chromium, all clean; `apps/web/test-results/` was
   removed. The lead's run on the final tree, on the scratch stacks `analyzr-s3c1` (ports 7690 and
   55690, `analyzr seed`) and `analyzr-s3c1-demo` (port 7691): the full Playwright suite 113 passed
   and 21 skipped, step 5's tests plus the harness spec's 2
   (`ANALYZR_UI_LOAD_NORDWIND=nordwind-s3c1`; the chain page's CSS check passed), the UI load
   numbers equal to step 4's on every screen, the demo check 152 of 152, `demo.spec.ts` 14 of 14;
   the stacks, their volumes and images are removed. `analyzr-local` is not rebuilt: neither the
   server nor the web product code changed.

Not checked: the spec path in a Claude Code or Codex session (the skill does not use `analyzr-spec`
before plugin 0.1.4, and no LLM call was made), a picture read into a spec by an agent, a rendered
bundle imported into a running analyzr (the scratch-stack run of D3 (d) and D4 belongs to step 4), a
real or sandbox Visio or ARIS export (M6 §10.4), other browsers than Chromium, CI (no e2e job). Seen
and not fixed (cosmetic, flagged by no check): a message flow from a node can cross shapes of its
own pool below that node, and a task name of nearly 200 characters overflows its fixed 100 × 80 box
in bpmn-js.

### M6 S3c step 2 (2026-10-21)

Same machine; step 2 of M6 S3c (the converter runner `analyzr-convert`,
[M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §3.9 "Converter runs" and §8 "S3" and "S3c
step 2 as delivered", owner decision 30 (A1) and (A4), [The integrate plugin and
`tools/integrate`](#the-integrate-plugin-and-toolsintegrate-m6-s3b) "`analyzr-convert`") on
`feat/integration-and-gaps` on top of S3c step 1. One script runs an ad-hoc converter, a script the
agent writes, on one export: exactly the bytes whose full sha256 the consultant approved
(`--sha256`), twice, each time in a `vm` context without host objects inside a child Node under the
permission model (one read grant, its own script; no write, child process, worker, addon, WASI or
inspector; no code generation from strings; three fixed environment variables; time, heap and output
limits; the child refuses to run outside that sandbox), on files the parent reads itself (no link
followed, zip guards, a file over 64 MB passed on unread). It writes one `analyzr-spec/1` file per
model, the write-once copy `converters/adhoc-<12 hex>.js` and the run record `analyzr-specs.json`,
which `analyzr-spec validate`, `plan` and `bundle` now check before they give those specs the run's
derivation (`--derived converted|reconstructed`, chosen per mapping, with `adhoc:<12 hex>`); in
`tools/integrate/src/spec/` and the entry `src/cli/analyzr-convert.ts`, run from source until
plugin 0.1.4, with synthetic Visio (VSDX) and ARIS AML exports and their example converters. Built
by an implementing agent, reviewed adversarially (escapes, correctness, release and tests): no
working escape, every finding that held up fixed, none rejected, several of them test gaps rather
than defects. The one major finding was a missing test of the bridge between the child and the
converter's context (the code was safe; the new test fails on the mutant that rethrows the bridge's
error). Fixed among the others: the two runs compared by their read counts only; a shared tool path
or tool id keeping its first holder; a run record that could outgrow the 16 MB `analyzr-spec` reads;
`helpers.xml` losing the order of mixed text; one file over 64 MB refusing the whole run (it told
the consultant to move the file out of the export, against the skill's ground rule 6); six bugs in
the example converters; zip entries in archive order; the record reader without the manifest's
limits; "run twice", the parent's timeout and its stdout cap untested end to end; the consent
wording; zip link entries not refused. The fixer's own find, not fixed: `--max-old-space-size` does
not bound typed-array memory. The readings taken are in [HANDOFF.md](HANDOFF.md) §4 ("Taken during
M6 S3c step 2"). For the first analysis: once plugin 0.1.4 ships, the integrate skill turns Visio
and ARIS AML exports into specs in the same first pass as the BPMN exports: the agent writes a small
converter, the consultant approves each version by its hash, and it runs boxed in.

1. Gates, from the fix round's run: every gate green (`pnpm format:check`, `pnpm -r typecheck`,
   `pnpm -r lint` with dependency-cruiser, 150 modules, no violations, `pnpm -r test` with
   Testcontainers: integrate 390 (332 before), server 1,804, web 663, CLI 286 plus 7 skipped (the
   live project), contracts 178, bpmn-facts 200, relations 91, agent-sim 57, procedures 37, demo 27,
   notices 9, client 4, eval/tools 108; `pnpm eval:candidates`, `pnpm eval:replay`,
   `pnpm eval:placements`, `pnpm eval:descriptive`); `git diff --exit-code eval/reports` clean; the
   integrate `generate` followed by `git diff --exit-code plugins/analyzr-integrate` clean, so
   plugin 0.1.3 is byte-identical (the new modules are in no entry, and `src/zip.ts`, which
   `inspect.mjs` and `normalize-bpmn.mjs` bundle, is unchanged; the runner reads zips with
   `src/spec/unzip.ts`). No new dependency, and `THIRD-PARTY-NOTICES.md` is unchanged. No server,
   contract, client, CLI, web, MCP, procedure, migration, facts or trust-rule change; the pipeline
   plugin and the recordings are untouched, so it is live-run neutral.
2. What was checked: the escapes named in the security critiques and reviews, each failing with an
   error of the context itself (`helpers.text.constructor('return process')()` and the same chain
   over every helper, a helper's error, the input, the XML tree, a `Uint8Array`, `this`,
   `globalThis` and the global's prototype; `this.constructor.constructor`; the async, generator and
   async-generator constructors, `eval`, indirect `eval` and `Function`: `EvalError`; `process`,
   `process.getBuiltinModule`, `require`, `Atomics.wait` on a `SharedArrayBuffer` and
   `WebAssembly.Memory`: `ReferenceError`; `Error.prepareStackTrace` frames reaching only the
   context; a replaced runner); endless loops at the top level and in `convert`, endless promise
   jobs and an endless `await` loop timing out, a job queued after `return` changing nothing, a huge
   output refused, the clock and randomness throwing, a dynamic `import` refused before the run; the
   child started by hand refusing in 7 cases (without the permission model, without the
   code-generation flag, with a write grant, with `--allow-fs-read=*`, with `NODE_OPTIONS`, with a
   token in its environment, with another `TZ`) and gaining nothing inside its exact sandbox; the
   parent run with `ANALYZR_TOKEN` set and a `NODE_OPTIONS` that grants reads and writes everywhere
   and child processes, of which the converter saw nothing; a local TCP listener counting 0
   connections after `fetch`, `require`, the helper, `this` and error chains, `WebSocket` and
   `XMLHttpRequest` (and, measured, `net.connect` itself working under `--permission`); a symbolic
   link in the export, `../` and absolute paths never read; a zip bomb passed on unopened, a damaged
   entry an error; D3 (a)–(c) on the fixtures. The two fixture runs: Visio `adhoc:dc5dcd69948a`, 2
   of 3 files and 12 entries read, 2 models, 2 skipped, `element-dropped` 4; ARIS
   `adhoc:c987bfc789d4`, `reconstructed`, 2 models, 1 skipped, `element-dropped` 2. Before the
   review round the implementing agent also bundled the entry in a scratch folder (335 KB, no
   dynamic `import(`; only rolldown's `createRequire` shim, through which `yaml` loads the built-ins
   `process` and `buffer`) and ran it from a copy away from `node_modules`, its child granted only
   its own file: the specs and the record were byte-identical to the source run's.
3. The lead's run, on the scratch stack `analyzr-s3c2` (ports 7690 and 55690, no seed): a workspace
   in the scratchpad with the fixtures' Visio export (the two `.vsdx` zipped from
   `test/fixtures/converters/visio/`, plus `Liesmich.txt`) and ARIS export; `analyzr-convert
   convert` from source with each fixture converter's full sha256: Visio `adhoc:dc5dcd69948a`,
   `converted`, 2 of 3 files and 12 entries read, 2 models, 2 skipped, `element-dropped` 4; ARIS
   `adhoc:c987bfc789d4`, `reconstructed` with `llmModel`, 1 of 1 file, 2 models, 1 skipped,
   `element-dropped` 2. `analyzr-spec validate`, `plan --write` and `bundle` passed for both (one
   call each, rendered as a collapsed subprocess with `link-unresolved`). The bundles, copied into
   the server container, imported with its `analyzr import --create`: 2 and 2 `created`,
   `extract_warnings` empty on every revision, every revision's trust class `derived` with its
   derivation and converter, no relation in either project (so no call proposed or accepted, D3
   (d)); a second import gave all four `unchanged`. The stack, its volume and image are removed. No
   Playwright run: neither the web nor the server changed; `analyzr-local` not rebuilt.

Not checked: a converter run in a Claude Code or Codex session (the skill does not use
`analyzr-convert` before plugin 0.1.4, and no LLM call was made), so neither the consent question
nor Claude Code's prompt before each run; a converter's bundle imported into a running analyzr
(D3 (d) and D4 belong to step 4); a real or sandbox Visio or ARIS export (M6 §10.4); heap exhaustion
(Node aborts, and macOS writes a crash report for every run; the parent reports `out-of-memory` from
stderr); CI (the gates ran on this machine). Seen and not fixed: `ArrayBuffer`s and typed arrays are
outside the heap limit (measured on Node 24.15: 2 GB of `Uint8Array`s under a 256 MB heap), so a
hostile approved converter can use up the machine's memory within its 120 s; and Node 24 has no
network permission, so the converter reaches no network only because its context holds no host
object ([HANDOFF.md](HANDOFF.md) §4 "Taken during M6 S3c step 2" (b), (c)).

### M6 S3c step 3 (2026-10-21)

Same machine; step 3 of M6 S3c (the CLI core,
[M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §3.7 "Reaching analyzr" and §8 "S3" and
"S3c step 3 as delivered", owner decision 30 (3) and (A5), [The `analyzr` CLI](#the-analyzr-cli))
on `feat/integration-and-gaps` on top of S3c step 2. The commands of `analyzr` move into a core both
CLIs share, `apps/cli/src/core-program.ts` (every command but `seed` and `mcp`, moved unchanged
except that `import` and `status` take the command name, `token create` the entry and `globals()`
the loopback flag), which the checkout's and the container's `src/program.ts` extends with `mcp` and
`seed`, and which `src/plugin-main.ts`, the entry of the integrate plugin's bundled CLI
`analyzr.mjs` from plugin 0.1.4, runs with four differences: its next steps and `status`'s hint name
`node <path of analyzr.mjs>` (with `--url` unless the default) instead of `analyzr`, it sends the
owner key only to analyzr on this machine (`127.0.0.1`, `[::1]`, `localhost`; an agent token
anywhere), its `token create` names no Claude Desktop entry it lacks, and its help's description
says to run it as `node <path of analyzr.mjs> <command>`. Both CLIs gain the parse guard: a word
that reads as a flag is never an option value, nor an argument after `--` (exit 2), so
`import b -p p --create --name --dry-run` no longer imports for real. Run from source until step 4
adds the entry to the bundles; plugin 0.1.3 stays byte for byte. Built by an implementing agent,
reviewed adversarially (behaviour, security, structure); of the review round's findings, counting
nits and the parts of findings, 16 fixed with tests, 3 in part and 2 rejected with a reason. The one
major finding was a bypass of the parse guard: it checked only an option's final value, so a
repeated option (`-p --dry-run -p p`, `--name --dry-run --name K`) or the `--` that ends the options
got a flag through (now every occurrence and every argument is checked). Fixed among the others: the
owner key reaching a proxy with `no_proxy=' * '` (now exactly `*`); no scheme check and an error
echoing the URL as given; `status` naming `analyzr seed` in the plugin; free text starting with `--`
refused; the plugin's printed steps without `--url`; nothing enforcing that `seed` and `mcp` stay
out of the core (now a static import-graph test); a spec-bundle case dropped for a wrong reason;
test gaps and hygiene. Rejected: exit 1 for the guard (the plan says 2, §5.3, R34) and
`analyzr-read.mjs`'s proxy refusal for the consultant's CLI. The readings taken are in
[HANDOFF.md](HANDOFF.md) §4 ("Taken during M6 S3c step 3"). For the first analysis: once plugin
0.1.4 ships, a consultant without a checkout imports a landscape with the plugin's CLI and gets
next steps that name a command they can run against the same analyzr, and a dry run whose project
name was forgotten can no longer turn into a real import.

1. Gates, from the fix round's run: every gate green (`pnpm format:check`, `pnpm -r typecheck`,
   `pnpm -r lint` with dependency-cruiser, 150 modules, no violations, `pnpm -r test` with
   Testcontainers: CLI 317 (286 before; 288 unit, 29 e2e) plus 7 skipped (the live project),
   server 1,804, web 663, integrate 390, contracts 178, bpmn-facts 200, relations 91, agent-sim 57,
   procedures 37, demo 27, notices 9, client 4, eval/tools 108; `pnpm eval:candidates`,
   `pnpm eval:replay`, `pnpm eval:placements`, `pnpm eval:descriptive`); `git diff --exit-code
   eval/reports` clean; the integrate `generate` followed by `git diff --exit-code
   plugins/analyzr-integrate` clean, so plugin 0.1.3 is byte-identical (`tools/integrate`'s
   `ENTRIES` are unchanged, and no bundle includes `apps/cli`). No new dependency, and
   `THIRD-PARTY-NOTICES.md` is unchanged. Only `apps/cli` changed: no server, contract, client,
   web, MCP, procedure, migration, facts or trust-rule change; `pnpm analyzr` and the container's
   `analyzr` behave as before except the parse guard (the help of all 43 command paths pinned by a
   snapshot taken before the split); the pipeline plugin and the recordings are untouched, so it is
   live-run neutral.
2. What was checked: the parity of the two entries from source (`node src/plugin-main.ts` against
   `node src/main.ts`, each a child process against its own HTTP fake on 127.0.0.1): the version,
   the help of one command per group, a dry run of the golden Signavio bundle (the same JSON, text,
   exit code and request log with multipart file names and `manifest` parts), 61 files in batches of
   50 and 11 in both, an import with `--create --name` that triggers every next step (the same 8
   requests and the same text except the command name, each step naming `node <path>` with the
   fake's `--url` and none `analyzr <cmd>`), `token create` without a `main.ts` path; the parse
   guard on 17 command lines in both CLIs and on `seed` (exit 2, the exact message, no request), and
   text with a space, a value with one dash and the defaults passing; the loopback rule on 23 URLs,
   every leaf command of the plugin with `--url http://192.0.2.1:7400` never sending the owner key,
   an agent token sent anywhere, the checkout sending the owner key to any host as before; Node's
   proxy support (`NODE_USE_ENV_PROXY=1` with `HTTP_PROXY`, alone or with a `no_proxy` Node does not
   read as "never") never seeing the plugin's owner key while the checkout's request goes into the
   proxy as before; and, measured on Node 24.15, that fetch drops `Authorization` on a redirect to
   another origin and keeps it on the same origin, and that Node reads `no_proxy` before `NO_PROXY`
   at every request. The scratch bundle of `plugin-main.ts` (rolldown 1.2.12 with `bundle.ts`'s
   settings, not in `ENTRIES`, measured again after the fix round): 652,994 bytes (150,641 gzip),
   one chunk, no warning, no dynamic import, Node built-ins only; copied away from `node_modules` it
   printed `0.1.0-alpha.0` for `--version` and a `--help` without `seed` and `mcp`, exited 2 for
   three forms of the guard, and refused the owner key for 10.0.0.1 and a `ws:` URL.
3. The lead's run: Every gate on the final tree, with the CLI e2e suite (29 tests on Testcontainers:
   the import lines with `analyzr` as before) and the parity tests of the plugin entry run from
   source; no stack, since neither the server nor the web changed (the bundle against a stack is D4,
   step 4).

Not checked: the bundled CLI itself (step 4 adds it to `ENTRIES`, its notices and the drift test),
a consultant's run of it in a terminal or from the skill (no LLM call was made, and SKILL.md does
not name it before 0.1.4), Claude Desktop with a token the plugin's CLI created, CI (the gates ran
on this machine). Seen and not fixed: the guard refuses a real value without a space that starts
with `--` (`--text "--siehe"`), and does not catch a value with one dash (`--name -n`), a flag
written without dashes or a value missing at the very end (commander's error, exit 1).

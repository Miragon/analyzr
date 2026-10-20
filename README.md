# analyzr

analyzr is a headless store for BPMN process landscapes. It holds BPMN models, the facts
extracted from them, the relations between processes and the placement of processes on a value
chain, each with its review state. Any MCP agent the operator chooses analyses the models and
**proposes** relations and value chain placements; **humans decide**. analyzr holds no LLM
credentials: whoever runs the agent brings model, credentials and compute.

**Status:** early, `0.1.0-alpha.0`. The repository is private for now, and no package or image is
published (every workspace package is `private: true`). What is decided and what comes next is in
[docs/HANDOFF.md](docs/HANDOFF.md).

## Features

- **BPMN in, facts out:** Camunda 7 and Camunda 8 models, one model per file with a stable key;
  revisions, hostile-XML protection, facts per call, message, signal, start and end event.
- **A rule tier without an LLM:** unambiguous calls in Camunda models uploaded with the owner key
  or the web are accepted at once, those from derived models (no engine, an agent token's upload,
  a declared conversion, reconstruction or interview) become proposals (the trust rule),
  identical message and signal names become proposals, findings name unresolved, dynamic and
  duplicate calls.
- **An analysis pipeline for agents:** models wait for analysis; agents claim tasks over MCP, judge
  candidate pairs with a versioned procedure (each pair once, also with several agents) and submit
  proposals or no-links with confidence, rationale and evidence.
- **Human review** in a German web UI: an inbox by stage, a review screen with both models in
  bpmn-js, accept, reject, hold („vormerken“) or correct, bulk decisions, and decisions that
  survive re-uploads.
- **Value chains:** a value chain per project (`@miragon/value-chain-*`), viewed and edited in the
  web UI, with agents placing processes on its steps and humans reviewing the placements.
- **Auto-accept rules** an owner sets per tier and confidence (for the unique calls of derived
  models per declared source, never for an agent token's upload), with a preview of their
  precision and a revoke.
- **Interfaces:** REST under `/api/v1` (OpenAPI 3.1), MCP under `/mcp` (Streamable HTTP, agent
  tokens), the `analyzr` CLI with a stdio bridge for Claude Desktop.
- **An eval corpus as the spec:** two synthetic landscapes with ground truth, LLM-free gates in CI
  (`eval:candidates`, `eval:replay`, `eval:placements`, `eval:descriptive`) and tooling for live
  runs (`eval:live`).
- **Reference agents:** a Claude Code plugin (`analyzr`, skills `/analyzr:relations` and
  `/analyzr:placements`), Claude Desktop and Codex setups in [examples/agents](examples/agents/README.md).
- **Integration toolkit (M6, in progress):** a second plugin `analyzr-integrate` with the skill
  `/analyzr-integrate:integrate-landscape`, which turns a customer's BPMN export (Signavio, ARIS,
  ADONIS, Bizagi, …) into an import bundle with stable model keys and a German report; the
  consultant runs the import ([docs/M6-INTEGRATION-AND-GAPS.md](docs/M6-INTEGRATION-AND-GAPS.md)).

## Quick start (Docker)

You need Docker with Compose and the ports 7400 and 55432 free on 127.0.0.1.

```sh
docker compose -p analyzr -f docker/compose.yaml up -d --build --wait   # http://127.0.0.1:7400
docker compose -p analyzr -f docker/compose.yaml exec server analyzr seed   # the two test landscapes
```

Open http://127.0.0.1:7400. Local mode has no login: the web UI on this machine is the owner.

**Connect an agent.** Create an agent token in the web UI (project → „Einstellungen › Agent verbinden“) or in the
container, then add the MCP server to Claude Code:

```sh
docker compose -p analyzr -f docker/compose.yaml exec server analyzr token create \
  --project nordwind-handel --name claude --scopes read,propose --expires 90d
export ANALYZR_TOKEN=analyzr_at_…
claude mcp add --transport http analyzr http://127.0.0.1:7400/mcp --header "Authorization: Bearer ${ANALYZR_TOKEN}"
```

**Install the plugin** from your checkout (from GitHub, `Miragon/analyzr` needs repository access
while it is private) and let the agent work the pipeline:

```sh
claude plugin marketplace add "$PWD"   # from the root of your checkout
claude plugin install analyzr@analyzr
# in a Claude Code session: /analyzr:relations nordwind-handel 5
```

Claude Desktop, Codex, tokens and troubleshooting: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Development

Node 24 and pnpm 11.1.3 (`packageManager` in `package.json`):

```sh
pnpm install
pnpm format:check && pnpm -r typecheck && pnpm -r lint && pnpm -r test   # server tests use Testcontainers (Docker)
pnpm eval:candidates && pnpm eval:replay && pnpm eval:placements && pnpm eval:descriptive
pnpm dev   # server on 127.0.0.1:7400, Vite on 127.0.0.1:7401 (PostgreSQL: pnpm db:up)
```

## Documentation

| Document | What it holds |
|---|---|
| [docs/HANDOFF.md](docs/HANDOFF.md) | Status, owner decisions, open questions, next steps |
| [docs/CONCEPT.md](docs/CONCEPT.md) | The spec: domain, pipeline, review, interfaces, auth, agents, eval, stack, repository and license |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | How to run, use, build and test analyzr |
| [docs/adr/0001-headless-landscape-store.md](docs/adr/0001-headless-landscape-store.md) | ADR-0001, the architecture decision |
| [docs/M1-SKELETON.md](docs/M1-SKELETON.md), [docs/M2-PIPELINE-REVIEW.md](docs/M2-PIPELINE-REVIEW.md), [docs/M3-RELATIONS-PROCEDURE.md](docs/M3-RELATIONS-PROCEDURE.md), [docs/M4-VALUE-CHAIN.md](docs/M4-VALUE-CHAIN.md) | The milestones |
| [docs/M3-LIVE-RUNS.md](docs/M3-LIVE-RUNS.md) | The guide to live LLM runs |
| [eval/README.md](eval/README.md) | The eval corpus, its gates and the recordings |
| [examples/agents/README.md](examples/agents/README.md) | The reference agent setups |

## Demo

A public read-only demo with both test landscapes, worked by the LLM-free simulation agent, runs
at https://analyzr-demo.fly.dev after its first deploy ([docs/DEVELOPMENT.md, "Demo deployment
(Fly.io)"](docs/DEVELOPMENT.md#demo-deployment-flyio)).

## License

analyzr is licensed under the [MIT License](LICENSE), Copyright (c) 2026 Miragon GmbH. The
licenses of the production dependencies, and of the build tools whose code the web bundle
contains, are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md); `pnpm notices` regenerates it,
and a test fails while it is stale.

**bpmn.io watermark.** The web UI uses [bpmn-js](https://github.com/bpmn-io/bpmn-js), which is
licensed under the bpmn.io license: its watermark must not be removed or changed and must stay
fully visible. analyzr keeps it visible and unobstructed; the CSP allows its image, the
Playwright smoke test fails on any CSP violation, and the value chain flow's CSS check guards the
watermark's position and stacking.

**Trademark.** The Miragon name and logo (the web UI's icon) are not licensed under the MIT
License.

**Origin.** analyzr started in 2026 as a rewrite inside Miragon/ProA; it shares no code with ProA 1.x.

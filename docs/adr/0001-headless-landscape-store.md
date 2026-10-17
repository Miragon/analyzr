# ADR-0001: analyzr is a headless landscape store; any agent analyses over MCP, humans decide

- Status: **proposed** (2026-10-05)
- Amended 2026-10-11 by owner decision 23 (own repository `Miragon/analyzr`, MIT)
- Amended 2026-10-17 by owner decision 25 (targeted model amendments as revisions computed from uploaded bytes; corrected BPMN and a change list as downloads; no write-back; `docs/M6-INTEGRATION-AND-GAPS.md` §4.8)
- Deciders: Dominik Horn
- Related: `docs/CONCEPT.md`

## Context

Linking processes by matching labels in uploaded BPMN has structural limits:

- **Relation detection:** an absolute Levenshtein threshold, stripped umlauts, ignored event definitions and `calledElement`, subprocess events treated as process-level; no confidence or rationale; decisions lost when a model is replaced. The eval measures label matching as `baseline-label/1`.
- **Ecosystem:** every AI-facing Miragon component is TypeScript, keeps the LLM in the host and exposes MCP tools.

The owner decided on a greenfield store in TypeScript with generic OIDC: headless first, intelligence in agents, a pipeline of models waiting for analysis. A later decision shapes this record: any agent the operator chooses must be able to drive analyzr over MCP, from a local Claude subscription (Claude Code, Claude Desktop) to deployed agents (Claude Agent SDK, Claude Managed Agents, other vendors).

## Decision

1. **Headless store, one deployable.** One Hono server serves REST at `/api/v1` (OpenAPI 3.1 from zod), MCP at `/mcp` and the web app, all calling the same domain use cases.
2. **PostgreSQL is the system of record.** Files are for exchange only: BPMN in, an OKF 0.2 bundle out (R1), no sync back.
3. **One model = one BPMN file with an immutable key.** Re-uploads create revisions; collaborations are never split; no project versions.
4. **Code computes facts, agents judge, humans decide.** Ingest extracts facts and computes candidates. Agents propose with provenance. Only humans accept, reject or hold ("vormerken"), except that `analyzr-rules/1.0.0` accepts an *unambiguous* call: a static `calledElement` (C7) or `zeebe:calledElement processId` (C8) that equals the id of exactly one process in the project's head revisions, outside the calling process (CONCEPT §2).
5. **Relations remember decisions.** Each relation has an append-only assertion log, and its status is a pure function of assertions and head facts. A rejection reopens only when an endpoint's fingerprint changes. A held relation stays open with a note and an optional question, outside the main review inbox.
6. **The pipeline is one table, `analysis_task`,** claimed with `FOR UPDATE SKIP LOCKED` under a 15-minute lease, queued only when a model's `facts_hash` changed; inbox stages are derived.
7. **Agents are external and freely chosen.** analyzr ships no runner and holds no LLM credentials; the agent's operator brings model, credentials and compute. One procedure text reaches any MCP client through server instructions, tool descriptions, MCP prompts (`work_pipeline`, `analyze_model`) and a `get_procedure` tool; the Claude Code plugin skill is generated from it. Reference agents (Claude Code, Claude Desktop, Codex) live in `examples/`, outside the product.
8. **Authorization lives in the domain.** Every use case starts with `policy.require(actor, permission, projectId)`; composite foreign keys keep rows within one project. Permission = scope ∩ project role ∩ principal rule. The review scope counts only for users on interactive clients (`analyzr-web`, `analyzr-cli`), so no agent can decide through its own MCP client or machine credential. An agent driving a user's browser or CLI remains a residual risk.
9. **v1 runs locally; server mode makes analyzr an OAuth resource server.** v1 (`ANALYZR_AUTH=local`) needs no IdP: the web UI on 127.0.0.1 is the local owner, and every MCP client uses an analyzr-issued agent token. Claude Code, Cursor, VS Code and Codex connect over HTTP on localhost; Claude Desktop through the `analyzr mcp` stdio bridge. Server mode (R1) never makes analyzr an authorization server or proxy: `jose` validates JWTs from one OIDC issuer (Keycloak, or WorkOS for Miragon-hosted instances; one deployment per tenant), with Protected Resource Metadata, 401/403 challenges and one exact audience, `https://<host>/mcp`. Interactive clients log users in through a pre-registered public client `analyzr-mcp`, optionally DCR, and CIMD where the IdP supports it stably. Deployed agents use **analyzr-issued agent tokens**: one project, scopes at most read/propose/write, mandatory expiry, revocable, created only by an owner. IdP client credentials remain an alternative.
10. **An eval corpus is the spec.** Golden landscapes with `must_link`/`must_not_link` pairs gate PRs without an LLM. For a procedure release, an agent works a seeded project and its stored submissions are scored, so any agent can be measured.
11. **Own repository, MIT.** analyzr lives in `Miragon/analyzr` with a fresh history (one initial commit) under the MIT license (owner decision 23). Workspace packages stay `private: true` until a release.

## Consequences

Positive:
- UI, REST and MCP share one code path; agents query indexed facts, not XML.
- Any MCP client can do the work, interactive or headless; model cost sits with whoever runs the agent.
- Decisions survive re-uploads, and every proposal names its principal, client, declared procedure and model.

Costs and risks:
- **This is a rewrite.** A usable v1 with UI takes about 5 weeks; no data is migrated.
- **Most links need an agent,** started by the operator; without one, analyzr shows identifier links only.
- **Provenance is partly self-declared.** analyzr authenticates principal and client but cannot verify the model or procedure version.
- **Cloud clients wait for server mode:** claude.ai, ChatGPT and Claude Code Routines call from the vendor's cloud and need a public URL (R1). Client auth there is uneven (Cursor drops headers when discovery answers, DCR clients accumulate); a spike in R1 settles it.
- **Agent tokens are long-lived secrets** (hashed, scannable prefix, expiring).
- **Changed element ids lose decision memory** until re-anchoring (R2); Git users get an import, not a sync.
- **License:** MIT (decision 23), with `THIRD-PARTY-NOTICES.md` for the dependencies.

## Alternatives considered

- **Git/OKF bundle as the store, or bidirectional sync.** Offline reading and diffs come from a deterministic export too; Git is worse for leases, indexed queries, project authorization and concurrent review.
- **A mandatory runner or an LLM judge inside analyzr.** Ties every deployment to one agent and one LLM key, and duplicates the host's agent loop.
- **IdP client credentials as the only machine credential.** Keycloak has no personal access tokens, Managed Agents vaults hold only a static bearer or a refresh token, and project owners are often not IdP admins.
- **analyzr as authorization server or OAuth proxy.** Security-critical code that no researched client needs.
- **Rebuilding inside an existing product repository.** Shared issues and image name, but an unrelated license and history; replaced by an own repository (decision 23).
- **Landscape tools in bpm-iq, or a separate MCP server calling REST.** bpm-iq keeps Git as its record; a second deployable needs token exchange.

# Agent instructions for this repository

analyzr is a headless TypeScript store for BPMN process landscapes (pnpm workspace in `apps/`,
`packages/`, `tools/`, `eval/`, `docker/`).

**Start here:** read `docs/HANDOFF.md` (current status, owner decisions, open questions, next
steps), then `docs/CONCEPT.md` and `docs/DEVELOPMENT.md`.

Rules that always apply:

- Talk to the owner in German; write code and repository docs in English. UI texts and texts
  agents see in German use "du" and „…“ quotes.
- Never use `pkill`, `killall` or `kill` by pattern; stop only processes you started.
- Docker: use only compose projects and image tags `analyzr-<x>` you create yourself, on free
  ports (`ANALYZR_HOST_PORT`, `ANALYZR_DB_PORT`, `ANALYZR_IMAGE`), and remove them afterwards
  (the server tests' Testcontainers clean up after themselves; `ANALYZR_TEST_DATABASE_URL` may
  point at such a project's database). Never touch the owner's compose projects `analyzr`, `analyzr-demo` and `analyzr-eval-engines`
  or the image tags `analyzr:local` and `analyzr-demo:local` (so no `pnpm docker:up`, `db:up`,
  `db:down` or `engines:up`), nor any other container: the owner runs others on this machine,
  including the stacks of the earlier repository (`docs/HANDOFF.md` §6 "Machine state").
- Exact dependency versions only (pnpm 11, Node 24). After a dependency change run `pnpm notices`
  (`THIRD-PARTY-NOTICES.md`).
- Follow the conventions in `docs/DEVELOPMENT.md`: contracts first for every route (then
  regenerate the client with `pnpm --filter @analyzr/client generate`), a pure domain layer
  enforced by dependency-cruiser, `policy.require` in every use case.
- Agents never decide relations or placements; humans do. analyzr holds no LLM credentials.
- Holdout hygiene: `stadtwerke-auental` is the holdout. Never open
  `eval/corpus/stadtwerke-auental/{expected.yaml,README.md,spec/}`,
  `eval/value-chains/stadtwerke-auental/expected-placements.yaml`,
  `eval/recordings/**/stadtwerke-auental.jsonl` or the stadtwerke sections of `eval/reports/*`;
  reports and messages keep the holdout aggregate only.
- Procedure releases are immutable: a change to a procedure text, its wrapper or the skill
  frontmatter needs a new version (bump it, run `pnpm --filter @analyzr/procedures generate`, add
  its hash to `RELEASED` in `packages/procedures/test/plugin.test.ts`).
- Run all gates before claiming something works: `pnpm format:check`, `pnpm -r typecheck`,
  `pnpm -r lint`, `pnpm -r test`, `pnpm eval:candidates`, `pnpm eval:replay`,
  `pnpm eval:placements`.
- Commits and merges (proposal until the owner decides, HANDOFF §8): work on feature branches;
  nothing lands on `main` without the owner's explicit OK.

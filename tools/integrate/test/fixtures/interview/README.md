# Interview guide fixtures (M6 S6 step 2)

Synthetic, written for the tests: the warehouse and shipping questions of an invented
`nordwind-handel`, no real customer, no names of people.

| File | |
|---|---|
| `2026-10-27.questions.json` | the open questions as `analyzr questions list --format json` writes them (every group and state); `test/interview-questions.test.ts` validates it against the contracts' `OpenQuestion` |
| `2026-10-27.questions.md` | the server's Markdown export (`renderOpenQuestionsMarkdown`) of its items in the groups `ask`, `agent` and `info`, with two „Betrifft“ names, as of 27.10.2026 |
| `2026-10-27.questions.csv` | the server's CSV export (`renderOpenQuestionsCsv`) of its open items in the groups `ask` and `agent` |
| `2026-10-27-organisationseinheit-lager.notes.yaml` | the agent's notes (`analyzr-guide-notes/1`) for the guide of the group `organisationseinheit-lager` |
| `guides/` | the golden guides and records of `analyzr-interview.mjs guide` (`GOLDEN_GUIDES` in `test/interview-support.ts`) |

The Markdown and CSV files are compared with what the server's renderer gives for the JSON
(`apps/server/src/domain/open-questions/export.ts`); `ANALYZR_UPDATE_GOLDEN=1 pnpm --filter
@analyzr/integrate test interview` rewrites them and the golden guides.

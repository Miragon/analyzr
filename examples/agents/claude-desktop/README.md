# Claude Desktop

Claude Desktop starts local MCP servers over stdio, so it runs analyzr's bridge `analyzr mcp`, which
relays every message to `/mcp` with the agent token
([DEVELOPMENT.md, "Connect Claude Desktop"](../../../docs/DEVELOPMENT.md#connect-claude-desktop)).
Claude Desktop has no plugin skill; the agent loads the procedure itself with `get_procedure`, as
the start prompt below tells it to (the procedure contains the whole loop).

| File | |
|---|---|
| [`docker-bridge.json`](docker-bridge.json) | entry for analyzr in Docker: the bridge runs in the container (`docker exec -i -e ANALYZR_TOKEN analyzr-server-1 analyzr mcp`) |
| [`checkout-bridge.json`](checkout-bridge.json) | entry for the bridge from the checkout (Node 24, `pnpm install`): `node apps/cli/src/main.ts mcp` with `ANALYZR_URL` |
| [`start-prompt.de.md`](start-prompt.de.md) | German start prompt with the placeholders `{{PROJEKT}}`, `{{MODELL_ID}}`, `{{ANZAHL}}` |
| [`start-prompt-placements.de.md`](start-prompt-placements.de.md) | the same for placement tasks (M4b): loads `analyzr-placements`, claims with `kinds: ["placement"]` |
| [`start-prompt-draft.de.md`](start-prompt-draft.de.md) | drafts a value chain (`.vc.json`) for a project; uses the MCP prompt `draft_value_chain` where Claude Desktop offers it, else its own short rules (`{{PROJEKT}}` only) |
| [`start-prompt-interview-guide.de.md`](start-prompt-interview-guide.de.md) | an interview guide from the open questions' Markdown export, with the read-only connector `analyzr-lesen` ([Interviews and pictures](#interviews-and-pictures); `{{PROJEKT}}` only); generated |
| [`start-prompt-integrate-landscape.de.md`](start-prompt-integrate-landscape.de.md) | `analyzr-spec/1` specs from attached pictures and PDFs, with `analyzr-lesen` (`{{PROJEKT}}`, `{{MODELL_ID}}`); generated |

## Set up

1. Create a **fresh project** for the run and an **agent token** for it (read + propose), named
   after the run's recording agent segment (`claude-desktop-1`, `claude-desktop-2`, …); never reuse
   a project across runs: `analyzr seed <landscape> --project <key> --issue-tokens --token-name
   <name>` creates both ([M3-LIVE-RUNS.md](../../../docs/M3-LIVE-RUNS.md), step 2).
2. Merge one entry into `~/Library/Application Support/Claude/claude_desktop_config.json`
   (Windows: `%APPDATA%\Claude\claude_desktop_config.json`; keep other entries) and put the token
   into `env`. `command` must be an absolute path, since Claude Desktop does not get your shell's
   `PATH`: `which docker` for the Docker entry, `node -p process.execPath` for the checkout entry
   (and the absolute path of `apps/cli/src/main.ts`). The **Einstellungen › Agent verbinden** page of the web UI (the project's gear menu)
   prints both entries with the real token; `analyzr token create` and `analyzr seed --issue-tokens`
   print the one for where they run (in the container the Docker entry, with `"command":
   "docker"` to make absolute; from the checkout the checkout entry).
3. Quit and restart Claude Desktop. `analyzr` appears under the connectors of a new chat; if it
   fails, see [Troubleshooting](../../../docs/DEVELOPMENT.md#troubleshooting).

## Run

1. Open a **new chat** per batch (a fresh context), pick the model, and paste
   [`start-prompt.de.md`](start-prompt.de.md) with the placeholders filled in:
   - `{{PROJEKT}}`: the run's project key from step 1, e.g. `nordwind-handel-cd-1` (the project
     the token was issued for; never the projects the Quickstart seeded, such as `nordwind-handel`);
   - `{{MODELL_ID}}`: the exact API model id of the model you picked, e.g. `claude-opus-5-5`
     (Claude Desktop shows a product name; the agent declares this id as `llmModel`);
   - `{{ANZAHL}}`: the batch size, e.g. `5`.
2. Claude Desktop asks before each tool call. Allowing the analyzr tools for the chat (or always)
   lets the loop run; the tools only read and propose, decisions stay with humans.
3. When the batch is done, start the next one in a new chat until `claim_analysis` returns no
   items.

For runs that count as evaluation, leave other connectors (file system, web) off in these
chats, so the agent works from analyzr's tools only.

**Placements** (M4b): seed the project with `--value-chains` (`analyzr seed nordwind-handel --project
nordwind-handel-cd-p1 --value-chains --issue-tokens --token-name claude-desktop-p1`), then paste
[`start-prompt-placements.de.md`](start-prompt-placements.de.md) with the same placeholders. One
task usually covers the whole chain. Afterwards `pnpm eval:live --project nordwind-handel-cd-p1
--landscape nordwind-handel` records and scores it.

**Drafting a chain:** paste [`start-prompt-draft.de.md`](start-prompt-draft.de.md) into a new chat
(project without a chain, or one to improve), copy the JSON block into a file `entwurf.vc.json`,
then on the project's value chain page choose „Importieren“ (on the empty page, or Bearbeiten →
Importieren), check the drawing and save. The owner rates such drafts by hand (M4 §6).

## Interviews and pictures

The two start prompts of the integrate plugin (`plugins/analyzr-integrate`) for a chat without a
shell are generated from the plugin's skill sources (`tools/integrate/skills/`, `pnpm --filter
@analyzr/integrate generate`; do not edit them here). They only read analyzr, so they run on a
connector of their own, **`analyzr-lesen`**, with a token that can only read: create it with
`analyzr token create -p <project> -n interviews -s analyzr:read`, add a second entry like the one
above under the name `analyzr-lesen` with that token, and keep the other connectors (file system,
web) off in these chats. The prompts start with „Nutze nur den Connector `analyzr-lesen`.“

- **Interview guide:** export the open questions in the web („Offene Fragen“ › „Für den Kunden
  exportieren …“ › „Zum Lesen (Markdown)“), paste
  [`start-prompt-interview-guide.de.md`](start-prompt-interview-guide.de.md) into a new chat with
  the file attached, name the group, and save the guide under `interviews/guides/` of the
  customer's workspace. The guide has the structure of the plugin's `analyzr-interview.mjs` (the
  same consent checklist, „du“ to the interviewee), but nothing checks a chat's ids: compare
  them with the export, or use the skill `/analyzr-integrate:interview-guide` in Claude Code,
  whose script copies every question and id from the file.
- **Pictures and PDFs:** paste
  [`start-prompt-integrate-landscape.de.md`](start-prompt-integrate-landscape.de.md) with the
  pictures attached and `{{MODELL_ID}}` filled in, save each spec under
  `specs/<YYYY-MM-DD>-images/` of the workspace, then validate, plan and bundle them in a
  terminal with the plugin's `analyzr-spec.mjs` as the skill `integrate-landscape` describes it
  (steps 2b to 4, starting with `node <plugin>/scripts/analyzr-spec.mjs validate "<spec
  folder>"`), and run the import yourself (`analyzr import … --dry-run` first, or „Hochladen“ in
  the web).

Not verified: Claude Desktop itself (no GUI session here). The two entries are the ones the
Docker job of CI starts the way Claude Desktop does (`apps/cli/test/live/stack.live.test.ts`:
absolute command, launchd-like environment, `docker exec` into the container). Whether Claude
Desktop offers the server's MCP prompt `work_pipeline` in its chat is not documented; the start
prompt does not depend on it.

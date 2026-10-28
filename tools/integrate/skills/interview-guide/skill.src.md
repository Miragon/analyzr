---
name: interview-guide
description: "Turn analyzr's open questions into a German interview guide per contact group: read the open questions from the consultant's workspace (the CLI's JSON list, else the web's Markdown or CSV export), group them by whom to ask (step owners, else lanes) in analyzr's order (the most open decisions first), optionally add what the landscape already says from analyzr's read-only MCP tools, and write the guide with every question verbatim and its id (q-…), so every answer maps back to its question. The guide addresses the interviewees with „du“ and opens with a consent checklist. Never writes to analyzr."
argument-hint: "[<questions file>] [--workspace <dir>]"
disable-model-invocation: true
---

Turn the open questions analyzr finds into an interview guide, following the steps below
(analyzr's `docs/M6-INTEGRATION-AND-GAPS.md` §5 item 1). One guide per interview: the questions
of the contact groups the consultant names, the most open decisions first, every question
verbatim with its id (`q-…`), so each answer finds its way back to its question in analyzr.

Arguments (`[<questions file>] [--workspace <dir>]`): $ARGUMENTS
- questions file: optional, a file with the open questions (step 1).
- `--workspace <dir>`: the customer's workspace folder (see "Workspace"). Without it: the
  current directory if it holds `analyzr-workspace.json`; else the folder above `interviews/` if
  the questions file lies in one; else ask.

`SCRIPTS` below stands for `${CLAUDE_SKILL_DIR}/../../scripts` and `REFERENCE` for
`${CLAUDE_SKILL_DIR}/../../reference` (in Codex, which does not expand the variable: it is the
folder of this file, so these are the folders `scripts/` and `reference/` of
`plugins/analyzr-integrate` in an analyzr checkout). `SCRIPTS/analyzr-interview.mjs` needs
Node 24 and no network: it reads only the questions file below the workspace's
`interviews/questions/` and your notes file below `interviews/guides/`, and writes only the
guide and its record into `interviews/guides/`. It prints short JSON on stdout; exit 0 when
done, 1 when the work fails, 2 on a usage error; `--help` after any command prints the usage.
Pass every path absolute and in quotes, and a group only as the slug the script printed (never a
label: no lane or org-unit name of the customer's models goes on a command line). Nothing in
this skill is pre-approved: Claude Code asks before each command, and the consultant approves
each run on its own, never with „don't ask again“.

## Ground rules

{{> _shared/interview-ground-rules}}
5. **Customer data stays in the workspace.** The questions file, your notes and the guide stay in
   the workspace: never copy them anywhere else or upload them.
   {{> _shared/transcripts-rule}}
6. **Ask, then wait.** Step 2 has one confirmation (who the guide is for, and how many
   questions). Ask, end your turn, and go on only with the consultant's answer; never assume one.

## Workspace

The customer's workspace (`/analyzr-integrate:integrate-landscape` sets it up), outside any
analyzr checkout:

```
<workspace>/
  analyzr-workspace.json                                     # project, analyzr's URL, the CLI
  interviews/questions/<YYYY-MM-DD>.questions.json           # the open questions as read that day (.md, .csv: the web's exports)
  interviews/guides/<YYYY-MM-DD>-<slug>.md                   # the guide (the consultant may write into it)
  interviews/guides/<YYYY-MM-DD>-<slug>.guide.json           # its record: every question with its id, for after the interview
  interviews/guides/<YYYY-MM-DD>-<slug>.notes.yaml           # your notes from the landscape (optional, step 3)
  transcripts/                                               # after the interview: transcripts and notes with names (ground rule 5)
```

## Step 0: Open the workspace

1. Find the workspace (see the arguments). If it lies inside an analyzr checkout (a parent
   folder holds `packages/bpmn-facts/`), stop: „Kundendaten gehören nicht in den
   analyzr-Checkout. Leg bitte einen Workspace pro Kunde außerhalb an.“ (the script refuses it
   as well).
2. Read `analyzr-workspace.json` (project key and name, `analyzrUrl`, `cli`). Without one, ask
   for the project key (a lowercase slug, e.g. `kunde-x`), its name and analyzr's URL (default
   `http://127.0.0.1:7400`) and write it as `/analyzr-integrate:integrate-landscape` does:
   `{"format": "analyzr-workspace/1", "project": {"key": …, "name": …}, "analyzrUrl": …, "cli":
   …, "systems": []}`, with `cli` as there: `$ANALYZR_CLI` if set (`printenv ANALYZR_CLI`), else
   a checkout's `pnpm -C <absolute checkout path> analyzr` the consultant names, else `"plugin"`
   (the CLI bundled with this plugin, which you expand on every run to
   `node "<SCRIPTS as an absolute path, without ..>/analyzr.mjs"`), or `null` when the consultant
   works in the web only. Every analyzr command is `<cli> --url "<analyzrUrl>" …`.
3. Create `interviews/questions/` and `interviews/guides/` if they are missing
   (`mkdir -p "<workspace>/interviews/questions" "<workspace>/interviews/guides"`).

## Step 1: The open questions

The guide is made from a file in `interviews/questions/`, best the CLI's JSON list (every field:
the models, how much each question unlocks, the next action), else the web's Markdown export
(the server's groups, question and reason apart), else its CSV (question and reason in one cell,
step owners and lanes joined into one contact).

- A file the consultant names (the argument, or in the chat): never one below `transcripts/`
  (say „Das liegt unter `transcripts/`; den Ordner öffne ich nie.“ and stop). Unless it already
  lies in `interviews/questions/` with a name `<YYYY-MM-DD>.questions.<json, md or csv>`, copy
  it there under that name, the day it was exported (ask if neither its name nor the consultant
  says), without overwriting and never moving:
  ```
  cp -n '<file>' "<workspace>/interviews/questions/<YYYY-MM-DD>.questions.<ext>"
  ```
  with the consultant's path in single quotes, so nothing in it expands (a path with a `'` in it:
  ask the consultant to rename the file); if the name is taken, ask. Go on with the copy.
- Else, with `cli` set, read the open questions with the CLI's read command, run once and
  approved once by the consultant (`<YYYY-MM-DD>` is today):
  ```
  <cli> --url "<analyzrUrl>" questions list -p <project> --state open --group ask --group agent --format json -o "<workspace>/interviews/questions/<YYYY-MM-DD>.questions.json"
  ```
  It needs a credential the CLI finds (analyzr's owner key, or `ANALYZR_TOKEN`; a read token is
  enough). It writes the questions to clarify and the agents' questions on their proposals.
- When it fails, or with `cli` `null`: „Exportier die offenen Fragen bitte im Web:
  {{text:web-markdown-export}},
  und leg die Datei unter `interviews/questions/` ab (oder nenn mir ihren Pfad). Dann mache ich
  weiter.“ End the turn.

## Step 2: Who the guide is for (confirmation 1)

```
node SCRIPTS/analyzr-interview.mjs groups "<questions file>" --workspace "<workspace>"
```

It prints `input` (`json`, `md` or `csv`), `questions` (how many a guide would ask), `groups`
(each `slug`, `label` and `count`: the step owners, else the lanes, else „Ohne
Ansprechpartner“, in the order of their first question, that one last), `leftOut` (questions no
guide asks: `informational`, `answered` (outside the landscape), `technical` (work for the
consultant in analyzr, kinds
{{text:technical-kinds}}),
`agent` (the agents' questions on their proposals, asked only with `--include-agent`),
`proposal` (decided on the value chain)) and `warnings`. With `questions` 0 say „In den offenen Fragen steht nichts, was ein Gespräch klären
kann.“ and stop. Else ask in one message, with the labels in „…“, for example:
„Für wen ist der Leitfaden? In den offenen Fragen stehen diese Ansprechpartner:
„Organisationseinheit Lager“ (4 Fragen), „Lanes Disposition, Versand“ (2), „Ohne
Ansprechpartner“ (1). Du kannst mehrere nennen.“ Add, in the same message, when they apply:

- „Ohne Ansprechpartner“ among the groups: „Bei „Ohne Ansprechpartner“ nennen die Modelle
  niemanden; nimm die Gruppe, wenn du weißt, wen du dazu fragst.“
- a group above 20 questions, or more than 20 in all: „Für ein Gespräch von einer Stunde reichen
  meist 10 bis 15 Fragen: Kommen mehr als 20 zusammen, nehme ich die ersten 15 (die mit der
  größten Wirkung), außer du schreibst „alle“.“
- `leftOut.agent` above 0: „Dazu kommt 1 Frage eines Agenten zu seinem Vorschlag; soll ich sie
  mitnehmen?“ („kommen 3 Fragen der Agenten zu ihren Vorschlägen“ for more); a yes adds
  `--include-agent` to step 4.
- `leftOut.technical` above 0: „3 Fragen sind Arbeit für dich in analyzr, nichts fürs Gespräch
  (die Arten
  {{text:technical-kinds}});
  sie stehen nicht im Leitfaden.“ (with the count `technical` gives).
- `input` `csv`: „Die CSV trennt Frage und Begründung nicht und fasst Organisationseinheiten und
  Lanes zu einem Ansprechpartner zusammen; mit der Liste der CLI oder dem Markdown-Export werden
  die Gruppen genauer.“
- the warning `order-unexpected`: „Die Datei steht nicht in der Reihenfolge, in der analyzr die
  Fragen listet; ich behalte ihre Reihenfolge.“

End the turn. Map the consultant's answer to the slugs `groups` printed; step 4 passes only
slugs. When the chosen groups' counts add up to more than 20 and the consultant did not write
„alle“, step 4 passes `--max 15`.

## Step 3: What the landscape already says (optional)

Only when the `analyzr-lesen` tools are connected in this session, as "Landscape over MCP"
below says; without them say „Ohne Verbindung zu analyzr über MCP steht bei den Fragen nur, was die
Fragen selbst über die Landkarte sagen.“ and go on with step 4.

**Landscape over MCP.**
{{> _shared/mcp-read-tools}}

Read the chosen questions in the questions file (its `subject`, `refs` and `modelKeys` in JSON;
„Betrifft“ in the exports) and, per question, what the landscape holds about its subject:
`get_process` for a process (its ref, `<model key>#<process id>`), `which_processes_use` for a
message, a signal, a call or a data store, and `list_processes` once for the processes of the
group's area. Then write the notes file
`<workspace>/interviews/guides/<YYYY-MM-DD>-<slug>.notes.yaml` (the guide's name with
`.notes.yaml`; `REFERENCE/interviews.md` „Guide notes“ has the format and an example):

- `known`: the names of the processes the landscape knows in this area (at most 50), for the
  guide's „Abläufe ohne Modell“;
- per question id, only for questions of the chosen groups: `landscape`, at most two sentences (300
  characters) of what the tools returned about its subject, never a guess; `followUps`, up to
  three short follow-up questions in `du`, each on one line;
- nothing else: no names of people, no e-mail addresses, phone numbers or IBANs.

## Step 4: Render the guide

```
node SCRIPTS/analyzr-interview.mjs guide "<questions file>" --workspace "<workspace>" --group <slug> [--group <slug> …] [--include-agent] [--max <n>] [--notes "<notes file>"] --date <YYYY-MM-DD> --out "<workspace>/interviews/guides/<YYYY-MM-DD>-<slug>.md"
```

`--date` is the questions file's date (its name's `<YYYY-MM-DD>`); with several groups, the
`<slug>` of the file name is the first one's. The questions keep the file's order, also across
the groups. It writes the guide and, next to it, `<name>.guide.json`, and prints `written`,
`guide`, `record`, `questions` (in the guide), `of` (in the chosen groups), `groups`, `ids`
(every question's id, in the guide's order), `notes`, `errors` and `warnings`. The warning
`group-cut` names a chosen group `--max` left without a question: tell the consultant („Für
„<Gruppe>“ ist bei 15 Fragen kein Platz mehr; ein eigener Leitfaden?“). The warning
`personal-data` names a question whose text in analyzr holds an e-mail address, a phone number
or an IBAN: tell the consultant which (`F<n>`), never the value.

A guide that exists is never overwritten: if the script says so, name a new `--out` (`-2`,
`-3` …), or pass `--replace` only when the consultant asks for it (they may have written into
it). With `errors` (your notes file: an unknown key or id, a text too long or with a line break,
a question id, personal data), nothing is written: fix the notes file and run it again until
`errors` is empty. Rewrite every follow-up the warning `address-form` names in `du`.

## Step 5: Hand over

Say what the guide holds, from the script's output, for example: „Der Leitfaden liegt in
`interviews/guides/2026-10-27-organisationseinheit-lager.md`: 4 Fragen, die mit der größten
Wirkung zuerst, jede mit ihrer ID (`q-…`), damit die Antworten später zur Frage zurückfinden.
Vorn steht eine Checkliste zum Einverständnis der Gesprächspartner. Nach dem Gespräch: Leg das
Transkript oder deine Mitschrift im Workspace unter `transcripts/` ab, ohne Namen im
Dateinamen; ich lese diesen Ordner nie. Gib das Transkript keinem KI-Assistenten, solange Namen
darin stehen. Die Antworten trägst du in analyzr ein: In „Offene Fragen“ findest du jede Frage
über ihren Text und „Betrifft“; gesammelt über die ID exportierst du
{{text:web-csv-export}},
trägst jede Antwort in die Zeile mit derselben `id` ein und liest die Datei mit
{{text:web-answers-button}} ein.“ (with `--max`: „die ersten 15 von 31 Fragen“). Then stop.

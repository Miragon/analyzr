# Interviews

Status: the three inputs are analyzr's own outputs (the CLI's JSON list, the web's Markdown and
CSV exports), read by `analyzr-interview.mjs` as analyzr writes them; the example below is checked
by `tools/integrate/test/plugin.test.ts`.

## Questions input

The guide is made from one file in the workspace's `interviews/questions/`, named
`<YYYY-MM-DD>.questions.<json, md or csv>` (the day it was read or exported). The script reads no
other folder, so a file elsewhere is copied there first.

- **JSON (preferred):** `<cli> --url "<analyzrUrl>" questions list -p <project> --state open
  --group ask --group agent --format json -o "<file>"`, every page. Each question carries its id,
  kind, group, subject, models, question, reason, a hold's note and label, the contact hint
  (`askWho`: lanes, step owners, folder), how many open decisions it unlocks, its notes and its
  actions. The guide shows the models and the actions („In „Offene Fragen“ danach“). Its
  „Betrifft“ is the subject's label alone (`„Eilzahlung angefordert“`), where the exports also
  name the process or pool around it.
- **Markdown (no CLI):** in the web „Offene Fragen“ › „Für den Kunden exportieren …“ › „Zum Lesen
  (Markdown)“. Its `## ` headings are the server's groups; every question has its id as a comment
  `<!-- q-… -->` right after its heading (a file without them is refused), the question and its
  reason as paragraphs, „Betrifft“ with names and pools. It has no models, counts or actions,
  and it lists the questions group by group, so a guide of several groups from it keeps that
  order (from the JSON and the CSV, the list's order across the groups).
- **CSV (last resort):** „Zum Ausfüllen (CSV)“. Its cell „Frage“ holds the question and its reason
  in one paragraph, so the guide's heading is that paragraph; its cell „Ansprechpartner“ joins
  step owners and lanes, so its groups differ from the others': a group of step owners can split
  by its lanes, and lanes and step owners of the same name fall into one group.

What a guide asks: the questions to clarify (group `ask`); with `--include-agent` also the agents'
questions on their proposals (`agent`; the exports name them by their kind „Frage eines
Agenten“). Never: informational items (a summary, a descriptive model), questions marked „Liegt
außerhalb der Landschaft“, the value chain's proposals (`proposal`), and the questions that are
work for the consultant in analyzr, not for an interview (`technical`: „Elemente beim Import
verloren“, „Paare ohne Urteil“, „Ergänzung nicht mehr anwendbar“). The order is the file's,
never re-sorted, also across several groups: analyzr lists the questions first, then the value
chain's findings, each by how many open decisions they unlock; `--max` keeps the first ones of
that order, and the warning `group-cut` names a chosen group it leaves without a question.

## The guide

`analyzr-interview.mjs groups` prints each contact group with its slug (its label as ASCII,
`organisationseinheit-lager`, `lanes-disposition-versand`, unique with `-2`, `-3` …);
`guide --group <slug>` takes only slugs. The guide
(`interviews/guides/<YYYY-MM-DD>-<slug>.md`) is German and addresses the interviewee with „du“:

- „Vor dem Gespräch“: the consent checklist (a recording or notes; the evaluation with an AI
  assistant after the names are replaced; the result in analyzr without names) and roles instead
  of names, then what holds without a consent (no recording: notes only; no AI evaluation:
  nothing under `transcripts/`, the answers entered by hand);
- „Einstieg“, then „Fragen“: per question `F<n>`, the question verbatim, its id `q-…`, kind and
  models, „Warum wir fragen“, „Betrifft“, a hold's note and label, „Was die Landkarte schon
  sagt“ (notes), „Bisher notiert“ (the latest note), „In „Offene Fragen“ danach“ (the actions
  to choose from by the answer, JSON only), „Nachfragen“ (notes) and room for „Notizen“;
- „Abläufe ohne Modell“, with the processes the landscape knows in the area when the notes name
  them (`known`), and „Abschluss“ with where the transcript goes afterwards (`transcripts/`, no
  names in the file name, to no AI assistant while names are in it).

Next to it `<name>.guide.json` (format `analyzr-guide/1`) lists the same questions with their
ids, the questions file and its sha256. An answer maps back to its question by the id: the web
shows no ids, so in „Offene Fragen“ a question is found by its text and „Betrifft“; by id, the
consultant exports „Offene Fragen“ › „Für den Kunden exportieren …“ › „Zum Ausfüllen (CSV)“,
writes each answer into the row with the same `id` and reads the file back with „Antworten aus
CSV übernehmen …“.

## Guide notes

`interviews/guides/<name>.notes.yaml`, written by you from analyzr's read-only MCP tools, passed
as `--notes`. Format `analyzr-guide-notes/1`, YAML read strictly (one document, no tags, anchors
or aliases):

- `known` (optional): the processes the landscape knows in the group's area, at most 50 names of
  at most 200 characters;
- `questions` (optional): per question id of the chosen groups, `landscape` (what the
  landscape already says, at most 300 characters) and `followUps` (at most 3 follow-up questions
  of at most 200 characters, in „du“); the notes of a question `--max` leaves out stay unused.

Every text is one line, without e-mail addresses, phone numbers, IBANs or question ids (the
guide shows each id once, at its question), and names no person. An unknown key, an id that is
none of the chosen groups' questions, a text too long or with a line break, a question id or
personal data is an error, and nothing is written; a follow-up with „Sie“, „Ihnen“ or, inside a
sentence, „Ihr…“ is the warning `address-form`.

## Example

```yaml
format: analyzr-guide-notes/1
known: [Wareneingang, Kommissionierung, Bestandsüberwachung, Inventur]
questions:
  q-3f2a9c41d07be815:
    landscape: Der Pool „Spedition“ schickt dem Wareneingang das Lieferavis; einen Prozess dafür hat die Landkarte nicht.
    followUps:
      - Wer im Lager bekommt das Lieferavis, und was passiert danach?
      - Kommt jede Lieferung mit einem Avis an?
  q-1e5f7a3c9d2b4086:
    followUps:
      - Womit beginnt der Wareneingang bei dir, und wann ist er abgeschlossen?
```

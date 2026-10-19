# analyzr – UI simplification ("Wirkt alles inzwischen etwas überladen")

Status: **decided** (owner decision 26, 2026-10-18: every "Ask now" question of §5.4 answered with
the recommended option; HANDOFF §4); proposal of 2026-10-17, revised the same day after a UX and a
feasibility critique · Branch: `feat/integration-and-gaps` (the first wave UX2a, UX1 and UX2b
delivered on it on 2026-10-18, §7; the owner's walkthrough the same day, §7 "Owner
walkthrough"; UX7, UX8, S2b's „Vorschau“, UX3, UX4 and UX5 delivered the same day, UX6 and
UX9 on 2026-10-19: every slice delivered) · Source: four user-need audits of the web UI on the agent-created scratch stack
`analyzr-uxaudit` (seeded `nordwind-handel` with its chain and a simulation agent run,
`signavio-beispiel` from the CLI bundle import, two projects made from the raw synthetic Signavio
export; 1440x900 and 390x844), torn down after the audit · Relates to: HANDOFF §4 decisions 8, 10,
17–21, 24 and 25 and §8's open rows "Demo: no-links in the review", "Shared-name flag" and
"Auto-accept: take-over"; [M6-INTEGRATION-AND-GAPS.md](M6-INTEGRATION-AND-GAPS.md) §1.1, §4.4,
§4.8 and §8 (S2a's web parts were left for this work, "S2a as delivered"; S2b's „Vorschau“ lands on
it); [M3-LIVE-RUNS.md](M3-LIVE-RUNS.md) §4 (the owner's run guide quotes today's „Prüfen“ tab) ·
Screenshots: `<UX>` =
`/private/tmp/claude-501/-Users-dominikhorn-Code-ai-plattform-analyzr/de5f97cf-3615-4bf5-a8d4-2aebcdc1e686/scratchpad/ux-audit`
(not committed; Appendix A lists them per finding).

The owner, 2026-10-17, after M6 S5c: „Denke aber bitte auch noch daran, die UI etwas zu
vereinfachen. Denke aus User Need Sicht. Wirkt alles inzwischen etwas überladen“. Earlier, with
decision 25: „Das soll für den User alles möglichst einfach sein, der user soll auch anpassungen am
bpmn modell machen können. also fehlende Keys setzen, modelle zur Verknüpfung auswählen usw.“

## At a glance

**What changes.** Four project tabs instead of nine, each an object with its open work as the
badge: „Übersicht“, „Relationen 42“, „Wertschöpfungskette 29“, „Offene Fragen 21“. The landing
page says the one next thing to do. Every piece of work is counted in exactly one badge and
decided in one place. Plain German without ids, tiers or queue jargon, also in the export that
goes to the customer. Canvas pages on a phone are for looking things up. Nothing agents see
changes; agents still only propose (decision 4); facts, rule tier, procedures, claim inputs, MCP,
recordings and reports stay as they are, so every slice is live-run neutral.

**„Übersicht“ (today „Modelle“), `nordwind-handel` at 1440 px**

```text
TODAY  44 controls · 418 words · 69 badges · no status, no next step
analyzr › Nordwind Handel GmbH                       nordwind-handel · Stand s277   Server verbunden · 0.1.0
Modelle 31 | Prüfen 42 | Wertschöpfungskette 29 | Relationen 58 | Befunde 7 | Offene Fragen 113 |
Hochladen | Agent verbinden |
Regeln                                                       <- the tab bar wraps
[Phase ▾]                                                    [Änderungsliste herunterladen]
Modell                      Engine  Revision  Phase               Offen  Aktualisiert
einkauf/bestellanforderung  C7      r1        Wartet auf Prüfung  6      17.10.2026, 22:32
… 30 more rows

TARGET  block above the table ≤ 40 words and ≤ 5 controls · primary button top ≤ 260 px
analyzr › Nordwind Handel GmbH                                               nordwind-handel
Übersicht | Relationen 42 | Wertschöpfungskette 29 | Offene Fragen 21        [⤒ Hochladen] [⚙]
Als Nächstes                                                                   [Exportieren ▾]
[ Vorschläge prüfen (42) ]
[Modell suchen …        ]   Modelle nach Phase: Alle 31 · Wartet auf Prüfung 25 · Klärung offen 2 · Eingearbeitet 4
Name                                   Phase                 Offene Punkte   Aktualisiert
Nordwind Handel – Einkauf              Wartet auf Prüfung    8               17.10., 22:32
einkauf/bestellanforderung
… 30 more rows
```

**„Offene Fragen“, `nordwind-handel` at 1440 px**

```text
TODAY  badge 113 · 232 controls · 3,120 words · first card at 639 px · page 14,250 px
Offene Fragen
Hier steht, wo der Landschaft Wissen fehlt … (127 words)
[Art ▾] [Quelle ▾] [Modell ▾] [Ansprechpartner-Hinweis ▾] [Status ▾]
[Als Markdown exportieren] [Als CSV exportieren] [Antworten aus CSV übernehmen]
114 Fragen
Frage eines Agenten · Frage von agent:agent-sim s252 · q-ef18acf5b85ccb6b · 14 offene Entscheidungen
  Does "Order handling" belong on "Auftragsabwicklung" …   Bezug: vertrieb/order-handling#Process_…
  [Entscheiden] [Weitere Aktionen ▾]
… 49 more cards on this page (agent questions, chain mirrors, 33 summaries)

TARGET  badge 21 · ≤ 80 controls · ≤ 1,000 words · first card ≤ 250 px
Offene Fragen                                     [Für den Kunden exportieren …] [Antworten aus CSV übernehmen …]
Was in der Landschaft noch fehlt. Zu jeder Frage gibt es eine Aktion, mit der du sie erledigst. ▸ So funktioniert es
[Art ▾] [Modell oder Ordner ▾] [Ansprechpartner ▾]                                      21 zu klären
Einordnung unsicher · „Gutschrift erstellen“ · Betrifft 5 offene Entscheidungen
  Auf welchen Schritt gehört „Gutschrift erstellen“?                                  ▸ Warum?
  [Schritt wählen …] [Weitere Aktionen ▾]
Prozess-ID mehrfach vergeben · „Bestellfreigabe“ · Betrifft 4 offene Entscheidungen
  Welche Kopie von „Bestellfreigabe“ gilt?                                             ▸ Warum?
  Ansprechpartner: Abteilungsleitung, Einkauf, Geschäftsführung
  [Gültige Kopie wählen …] [Notiz]
… 19 more cards
▸ Zur Information (33)
Erledigte zeigen (1) · Alle Befunde der Modelle als Liste (7)
```

**Ask now** (they shape the first wave): Q1 navigation (four object tabs, recommended, or five),
Q2 tab „Befunde“, Q3 „Offene Fragen“ by group, Q4 deciding where the diagrams are, Q5 one entry
for link or amendment, Q10 order and timing against the live runs, Q11 customer export without
the agents' questions by default, Q12 where the agents' no-links live. **Ask at the slice:** Q6
and Q7 (UX5), Q8 (UX9), Q9 (after the live runs).

**First wave, then a walkthrough.** UX2a (the open-questions read model's groups and totals,
server and CLI, 2 d) → UX1 (shell and „Übersicht“, 3 d) → UX2b („Offene Fragen“ in the web, 3 d),
about 8 agent days. Then the owner walks five tasks on a scratch stack (§7); that walk decides
whether UX3–UX9 (about 20 more days) are still needed and in which order.

## 0. What the audits measured

Counts from `page.evaluate` over visible elements (buttons, links, inputs, selects, tabs, menu
items, radios and checkboxes; words in `innerText`; `data-slot=badge`), shell included.

| Screen (`nordwind-handel` unless noted) | Controls | Words | Badges | What hurts |
|---|---|---|---|---|
| Project tab bar | 12 | 30 | 6 | 9 tabs, 6 overlapping counts; wraps at 1440 px („Regeln“ alone on row 2), 4–5 rows (~190–200 px) at 390 px |
| „Modelle“ (landing) | 44 | 418 | 69 | an inventory of 31 rows; no status, no next step |
| „Offene Fragen“ | 232 | 3,120 | 51 | badge 113, of which about 21 are gaps shown nowhere else; first card at 639 px (1,476 px on a phone); page 14,250 px |
| Model view | 37 | 515 | 33 | the model's 6 questions start 1,275–1,500 px into a 756 px panel titled „Relationen“; unusable on a phone |
| „Prüfen“ | 67 | 768 | 93 | first proposal at ~620 px; 42 identical „Prüfen“ buttons; sideways scroll on a phone (436 px wide) |
| „Kein Zusammenhang“ | 22 | 5,037 | 0 | 144 read-only cards, 21,648 px, inside the decision inbox |
| Review screen panel | 23 | 280 | 20 | facts repeated 2–4 times (~110 of 201 words); the phone hides back, next and both diagrams |
| „Relationen“ | 194 | 1,105 | 174 | the heaviest screen; presets repeat the inbox |
| Value chain | 95 | 483 | 54 | „Offene Prüfungen (29)“ starts ~1,120 px into an 868 px panel; 12 labels „nichts angenommen“; selection invisible |
| „Hochladen“, result | 24 | 276 | 11 | „Import abgeschlossen: 6 Dateien“ with 1 failure and 1 skip, no next step, 9 raw parser lines for 2 bad ids |

## 1. User, jobs and principles

### 1.1 The user

Today one person: a process consultant at Miragon, in local mode (decision 6), working a
customer's landscape over days or weeks. The consultant knows BPMN and the customer, not analyzr's
internals: no event sequence numbers, tiers, procedures, token ids or claim mechanics. Desktop at
the desk; a phone or tablet in a workshop to look a process up and show it, not to decide. Viewers
and the read-only demo (decision 20) see the same screens without write actions.

### 1.2 Core jobs, in priority order

Ordered by how often the job comes up per session times how much it blocks the next one.

1. **„Was ist als Nächstes dran?“** Every visit starts here: where the landscape stands and the one
   next step. Today spread over six tab badges and a phase bar on another tab (O1).
2. **„Vorschläge entscheiden.“** Accept, reject, hold or correct what the agents proposed:
   relations and placements. The core of „agents propose, humans decide“.
3. **„Lücken schließen.“** What the landscape lacks for more links: set a missing key, pick the
   model to link, mark a partner as outside, place a process, ask the customer and take the answers
   back (decisions 24.3 and 25).
4. **„Landschaft reinbringen und Agent starten.“** Import the customer's export (or the
   integrate skill's bundle), see that it worked, start the agent. The import is rare, but it is
   the first impression; starting the agent recurs after every import, amendment and requeue (O5).
5. **„Einen Prozess nachschlagen und zeigen.“** Find a model, open it in the model view or on the
   chain, at the desk and in a workshop, and fix one element in place.
6. **„Ergebnisse zurückgeben.“** Questions for the customer (Markdown, CSV), the change list for
   the source tool, the corrected BPMN, the chain; one place at the end of a workshop round.

Rare and set-and-forget: agent tokens and auto-accept rules (owner only).

### 1.3 Principles

- **P1 One primary action per screen and per card.** Everything else is secondary (outline,
  ghost or „Weitere Aktionen“/„Mehr“).
- **P2 Plain German, no engineering detail**, on screens and in exports. No `s<seq>`, „Ereignis
  280“, `q-…`, `rel_…`, `agt_…`, `sid-…`, procedure or LLM model ids, raw refs or tier jargon in
  visible text; they live behind „Technische Angaben“ or in machine columns (the CSV's `id`).
  Element and model names, never ids, title things.
- **P3 Progressive disclosure.** The first level answers „what and what now“; „why“ and „who“
  open on demand; technical detail is a second level below that. Information a decision needs is
  never only in a tooltip (§3.13).
- **P4 Sensible defaults instead of choices.** A field with a right default is not shown (token
  rights, rule narrowing, status filter); a name that can be derived is prefilled.
- **P5 One place per piece of work.** Each item is decided or answered in one place and counted in
  one badge; other screens link to it or open the same dialog. Same names for the same thing
  everywhere (§4).
- **P6 Short texts.** An intro is one line; how-it-works goes behind „So funktioniert es“; limits
  are explained when they bite, not upfront; a principle is said once.
- **P7 Counts mean work.** Badges count only what waits on the user, never inventory, never 0.
  Every number on a button, badge or line equals the length of the list it opens.
- **P8 Phone and tablet are for looking up.** Below 1024 px canvas pages are view-first (a
  collapsed sheet with name, status and navigation; decisions reachable, not optimized); tables
  become stacked rows; keyboard hints hide on touch.
- **P9 Same gates.** Role gating (decisions 19, 20) and the read-only demo stay exactly as they
  are when an entry point moves; a menu shows only when its viewer can use one of its items.

## 2. Target information architecture

### 2.1 Global

- **Header:** logo (version in its tooltip) and breadcrumb. „Server verbunden · 0.1.0-alpha.0“
  goes; on error a banner (`role=alert`: „Server nicht erreichbar“, „Datenbank nicht erreichbar“)
  replaces it (O19).
- **Projects list `/`:** project name with the key small below, „Offen für dich“, „Zuletzt
  geändert“; „Neues Projekt“ (O18, §3.12).
- **Canvas pages** (model view, review screen, chain) share one floating header (breadcrumb as
  the single way back, title, at most three chips, a „Mehr“ menu) and one floating panel
  component (aside from 1024 px, a view-first sheet below that never covers the bpmn.io
  watermark) (§3.13).
- **Failed writes** say what happened in German (§3.13 item 7); today all 64 `errorMessage` call
  sites show the English problem title („Conflict“, „Precondition failed“).

### 2.2 Project navigation

Four object tabs; each badge counts that object's open work and its results sit inside the same
tab (Q1, option B, recommended; option A, the five tabs of the first draft, in §5.4).

| Today (9 tabs, 6 counts) | Target | Why |
|---|---|---|
| „Modelle 31“ | **„Übersicht“** (no badge): next step, then the models table with search and phase chips (§2.3) | job 1, job 5; inventory counts are not work (P7) |
| „Prüfen 42“ and „Relationen 58“ | **„Relationen 42“**: opens on the view „Zu prüfen“ (today's inbox); views „Vorgemerkt“, „Gilt“, „Abgelehnt“ and „Automatisch angenommen“ (only above 0); at its foot „Kein Zusammenhang laut Agent (144)“ (Q12) | job 2; one tab per object; the presets that repeat the inbox go; no verb tab next to noun tabs |
| „Wertschöpfungskette 29“ | **„Wertschöpfungskette 29“** (open placements) | job 2, job 5 |
| „Befunde 7“ | **gone** as a tab: every finding is an „Offene Fragen“ item with an action; the page stays behind a link at the foot of „Offene Fragen“ (Q2) | P5 |
| „Offene Fragen 113“ | **„Offene Fragen 21“**: the badge counts „Zu klären“ only (§2.5) | job 3, P7 |
| „Hochladen“ | **button „Hochladen“**, pinned right of the tab row, outside its scrolling part (editors, owners) | an action, not an area |
| „Agent verbinden“ | **menu „Einstellungen“** (gear, owners only) › „Agent verbinden“; starting the agent is the popover of §2.6, offered where it is needed | rare to set up, frequent to start (Q1) |
| „Regeln“ | **menu „Einstellungen“** › „Annahmeregeln“ | rare; „Regel“ is overloaded (§4) (Q1) |

Tab order: „Übersicht“, „Relationen“, „Wertschöpfungskette“, „Offene Fragen“. The routes stay:
`/review` opens „Relationen › Zu prüfen“ (with `?stage=`, `?tier=`, `?model=` as today),
`/review?view=held` „Vorgemerkt“, `/relations` the result views; `/agents`, `/rules`, `/upload`
and `/findings` stay too, so links, bookmarks, `reviewUrl`s and the run guide's URLs keep working.
A project without models keeps the four tabs (a chain can be drawn before any model exists, and a
bar that changes shape confuses) but shows no zero badges (O20). On a phone the tabs are one
horizontally scrolling row of at most 48 px; „Hochladen“ (icon with `aria-label`) and the gear stay
pinned at its right end. The upload page has the crumb „<Projekt> › Hochladen“, since no tab is
active there.

### 2.3 The project landing „Übersicht“

From top to bottom, all on `/projects/{p}` (today's models tab, `routes/project-models.tsx`):

1. **„Als Nächstes“**: one primary button picked by state, first match wins, and at most two lines
   below it, each needing action. Viewers get the same text without buttons. Nothing repeats the
   tab badges.

   | State | Primary button | Goes to |
   |---|---|---|
   | no models | „Modelle hochladen“ | „Hochladen“ |
   | models wait for an agent (`waiting_for_agent`, `agent_failed`, or a lease expired) and the project has no active agent token (owners) | „Agent verbinden“ | „Einstellungen › Agent verbinden“ |
   | the same, with an active token (owners) | „Agent starten“ | the popover of §2.6 |
   | relation proposals open | „Vorschläge prüfen (42)“ | the review screen at the queue's first item |
   | placements open | „Platzierungen prüfen (29)“ | the chain page with the queue's first item selected |
   | „Zu klären“ > 0 | „Offene Fragen klären (21)“ | „Offene Fragen“ |
   | nothing open | none; the line „Alles geprüft.“ | – |

   The agent rows come first because the agent works while the consultant reviews; right after an
   import or an amendment, review is the second line: „Oder jetzt schon: Vorschläge prüfen (42).
   Was du entscheidest, sieht der Agent bei seiner nächsten Aufgabe.“ While an agent works and
   nothing waits, the agent rows give way and a non-button line says „Agent arbeitet – 3 Modelle
   offen“. The other lines, highest first, at most two shown: „1 Analyse gescheitert · Nochmal
   versuchen“ and „Bei 1 Modell ist die Reservierung abgelaufen · Nochmal versuchen“ (the requeues
   `StageModels` in „Prüfen“ offers today, permission `write`), the review line above, and „Noch
   keine Wertschöpfungskette · Anlegen oder importieren“ once relations exist. „Exportieren“ (§3.2)
   sits at the block's right.
2. **The models table** with its toolbar: „Modell suchen …“ (name and key, umlauts and case folded
   with `lib/generic-names.ts` `nameWords`, in the URL as `?q=`) and the phase chips „Modelle nach
   Phase: Alle 31 · Wartet auf Prüfung 25 · Klärung offen 2 · Eingearbeitet 4“ (only stages with
   models, `?stage=` as today; stages and labels unchanged, decision 8). They filter the table and
   count models, so they read as the table's filter, not as a second status block. With a stage
   chip active that has open proposals, one link „21 Vorschläge dieser Modelle prüfen“ opens
   `/review?stage=<stage>`; the queue keeps that filter and J/K walk it (today's `StageBar` in
   „Prüfen“). Four columns (§3.2).

On a phone: „Als Nächstes“, then „Modell suchen …“, then the chips as one scrolling row, then the
table as stacked rows.

All counts come from one hook, `src/lib/project-counts.ts` `useProjectCounts(project)`, which feeds
the tab badges, „Als Nächstes“ and „Offene Punkte“, so a number means the same on every screen (P5,
P7). The UI load guard checks that each number equals the length of the list it opens (§7).

### 2.4 One place per piece of work

| Work item | Decided or answered in | Elsewhere only |
|---|---|---|
| relation proposal (also with an agent question) | „Relationen › Zu prüfen“ (queue and review screen) | the agent's question on the review screen's box and as the queue's hint „Frage“; the model view card links; the customer export only with „Auch Fragen der Agenten“ (Q11). Not listed in „Offene Fragen“ |
| placement proposal (also with an agent question) | chain page | the question on the card („Frage“ box); the export option as above. Not listed in „Offene Fragen“ |
| held relation or placement: answer | „Offene Fragen › Zu klären“: the note dialog | the review screen (note and answers read-only, „Antwort ergänzen“), the „Vorgemerkt“ row and the chain's held card („Antwort geben“) open the same dialog; customer answers from the CSV land there too |
| held relation or placement: decide | review screen or chain („Jetzt entscheiden“ from the card or the „Vorgemerkt“ row) | – |
| process or step without anything proposed, finding, gap signal, unsure verdict | „Offene Fragen“ and the model view's „Fragen“ tab (same card, same action) | canvas markers; the chain's „Ohne Schritt (n)“ list (places too) |
| missing key or name in the model | the question's action, or „Ergänzen“ for an element no question covers | – |
| agent summary, descriptive model | read-only, closed group „Zur Information“ (decision 24.8) | – |
| no-link of an agent | the foot link of „Relationen“ (Q12) | review screen per relation |

Holds count only in the „Offene Fragen“ badge: the „Relationen“ badge counts `isReviewItem` and the
chain badge `isOpenPlacement`, neither counts holds; the view „Vorgemerkt“ carries no number.

To make this hold, the open-questions read model gains a **group** per item, computed on the server
so the tab, the badge, the export and `analyzr questions` agree (contracts first:
`OpenQuestion.group`, a repeatable `group` filter on `GET …/open-questions` and the export, and
`totals` on the page; the client regenerated). The map is a `Record<OpenQuestionKind, …>` with
source and state cases, and a unit test fails on an unmapped kind:

| `group` | German heading | Kinds |
|---|---|---|
| `ask` | „Zu klären“ | findings (`call-target-unknown`, `call-target-dynamic`, `duplicate-process-id`, `message-partner-missing`), gap signals (`black-box-partner`, `unlabelled-boundary`, `undocumented-process`, `isolated-process`, the reserved `message-without-name`), `held`, `placement-unsure`, `external-partner`, `unjudged`, `amendment-conflict`, `extractor-loss`, `unresolved-link`, and `process-without-step` / `step-without-process` with nothing proposed |
| `agent` | „Fragen der Agenten“ | `agent-question` |
| `proposal` | not shown in the tab | `process-without-step` with a proposed placement; `step-without-process` while a placement on the step **or below it** is proposed (the 8 top-level steps of `nordwind-handel` whose sub-steps carry proposals); their action „Auf der Kette prüfen“ opens the chain at `?step=` (today their frozen finding state `none` gives „Prozess zuordnen …“) |
| `info` | „Zur Information“ | `summary-note`, `descriptive-model` |

`group` is a label and a filter, not a sort key: the order stays `positionOf` (`rankGroup`, then
`unlocks`, …), so the owner's answer of 2026-10-16 (chain findings after the other questions)
holds in every filtered list and in the export. `OpenQuestionPage` gains `totals: Record<group,
number>` over the whole filtered set, so the badge and the tab's count line come from one
computation instead of one `limit=1` call per number, and `askByModel: Record<ModelKey, number>`,
the `ask` items per model whose subject is neither a relation nor a placement (for „Offene
Punkte“, §2.5). Both are REST only; MCP has no open-questions tool before S7, and S7 decides what
its output carries.

One rule of M6 §4.8 a extends: „one question per process“, which drops `process-without-step` for
held placements, also drops it when an `agent-question` on a placement of the same process or a
`placement-unsure` item for it exists (13 duplicates on `nordwind-handel`, e.g. „Order handling“ #1
and #38) (G2). Read model only: `visibleFindings`, the chain's findings, „Befunde“ and the claim
inputs stay as they are (frozen for the live runs, M6 §7).

### 2.5 Counts

| Badge | Counts | `nordwind-handel` today → target |
|---|---|---|
| „Relationen“ | open relation proposals and accepted relations with a changed endpoint (`isReviewItem`, unchanged) | „Prüfen“ 42 and „Relationen“ 58 → 42 |
| „Wertschöpfungskette“ | open placements (`openPlacementCount`, unchanged) | 29 → 29 |
| „Offene Fragen“ | `totals.ask` of `state=open` | 113 → about 21 (7 findings, 5 pools, 3 unsure, 4 empty steps, 2 holds; the exact number pinned in UX2a's test, as S5c-1 did) |
| „Übersicht“ | none | 31 → – |

The three badges never count the same item. Inside „Offene Fragen“ the count line reads „21 zu
klären“.

**„Offene Punkte“ per model** counts distinct subjects: today's `openItems` (relations touching the
model that are proposed, held, or accepted with a changed endpoint; `model_pipeline`), plus the open
placements of the model's processes (from the chain query the badge already loads, by the
placement's process ref; held placements too, since the first wave's review: their question's
subject is the placement, so `askByModel` does not name the model), plus `askByModel`. Agent
questions add nothing: they sit on proposals already counted. `einkauf/bestellanforderung`: 6
relations (the held call to `bestellfreigabe-2019` and the proposed call to `bestellfreigabe` with
the agent's question among them, each once) + 1 open placement + 1 pool question = 8; the first
draft's formula gave 9. Pinned in a unit test. **Decided in the first wave's review (P7 over the
link):** the number is text, not a link, since no one list holds a model's relations, placements
and questions together (UX1 linked it to `/review?model=`, which lists the relations only, so „9“
opened 7 rows); the model's name leads to the model. Its split by where to act („6 Relationen · 1
Platzierung · 1 Frage“) is repeated in a tooltip on the focusable number and shows in the model
view's panel tabs with UX3.

### 2.6 „Agent starten“

One popover, `components/agent-start.tsx`: the copyable `/analyzr:relations <p>` (Claude Code with
the analyzr plugin), `/analyzr:placements <p>` once a chain exists, a link to the Claude Desktop
start prompt, and one line „Die Vorschläge erscheinen unter „Relationen“. Entscheiden kannst nur
du.“ It opens from „Als Nächstes“, the warning line in „Relationen › Zu prüfen“, the chain's stage
line, the upload result's next-step box, the toast after an amendment save („Gespeichert. Die
Agenten beurteilen 15 mögliche Relationen neu, sobald du den Agenten startest. · Agent starten“),
and as step 3 of „Agent verbinden“. Two states, from `agentTokensQuery` (owners): no active token
→ „Agent verbinden“ (the settings page); otherwise „Agent starten“. „Nochmal versuchen“ (a failed
analysis or an expired reservation) requeues (permission `write`) and then opens the popover, since
a requeue alone runs nothing; the chain's „n Prozesse fällig“ offers „Agent starten“, which
schedules the placement task and opens the popover. Owners see the popover; editors see the status
lines without it.

## 3. Per-screen changes

Screens are ranked by user impact (how often and how much they block); within a screen, changes
are ranked the same way. Finding ids (O onboarding, G gaps, R review, C chain) resolve in
Appendix A.

### 3.1 Project shell (every project page)

1. **Tab bar** (`routes/project.tsx` `TabLink` list): the nine tabs → the four of §2.2, the
   button „Hochladen“ (`canWrite`) and the owner menu „Einstellungen“ (`isOwner`; items „Agent
   verbinden“, „Annahmeregeln“). The gear menu is a light disclosure (a button with
   `aria-expanded`, an absolutely positioned list, Escape and outside click), not Radix's dropdown,
   which would pull floating-ui into the entry chunk (§3.13 item 8). (O2, G7, R3, C10)
2. **Badges:** only „Relationen“, „Wertschöpfungskette“, „Offene Fragen“, never 0. (O2, O4, O20)
3. **Header:** „nordwind-handel · Stand s277“ → the key alone, small mono; „Stand s…“ goes here
   and in the projects list (the seq stays in the API). With S2a provenance, when every model comes
   from one system, a muted subtitle „Aus Signavio · exportiert am 14.10.2026“ (§6). (O18, G4, R24)
4. **Server status** (`components/page-shell.tsx` `ServerStatus`): hidden while ok; an error
   banner with `role=alert`. On a phone this frees the crumb that is cut to „Nordwi…“ today. (O19,
   R24)
5. **Phone:** the tabs scroll horizontally in one row (`overflow-x-auto`, no wrap); „Hochladen“
   (icon, `aria-label="Hochladen"`) and the gear stay pinned outside the scrolling part. (O2, G7,
   R17)
6. **Failed writes in German** (`lib/api.ts` `errorMessage`): §3.13 item 7. In UX1 because every
   screen uses it and it is web only.

### 3.2 „Übersicht“ and the models table

1. **„Als Nächstes“ block** as in §2.3 (`routes/project-models.tsx`); the phase bar is not moved
   here as a block: the stages become the table's chips, and the „Phase“ select goes. (O1, R3, R11)
2. **„Exportieren“**, the project's export hub at the block's right, shown whenever anything can be
   exported, each entry only when it has content: „Fragen für den Kunden (Markdown, CSV) …“ (the
   dialog of §3.3 item 4), „Änderungsliste fürs Quellsystem (Markdown, CSV)“ (decision 25.1; today
   „Änderungsliste herunterladen“ in the filter toolbar) and „Wertschöpfungskette (.vc.json, SVG)“.
   The menus on „Offene Fragen“, the chain and the model view stay as shortcuts with the same
   labels. (O23)
3. **Search and chips** as in §2.3: „Modell suchen …“ (`?q=`), the phase chips (`?stage=`). (job 5)
4. **Columns** (`components/models-table.tsx`): „Modell | Engine | Revision | Phase | Offen |
   Aktualisiert“ → „Name | Phase | Offene Punkte | Aktualisiert“. „Name“ is the model name as the
   link, the key small mono below; the mark „ergänzt“ and (S2a) the derived chip sit in this cell.
   „Offene Punkte“ as defined in §2.5, so `signavio-beispiel` no longer shows 0 on every row while
   19 questions are open. Engine and revision move to the model view's „Mehr“. While an agent holds
   a model, the phase cell shows a visible muted line, since the owner watches it during runs
   (M3-LIVE-RUNS §4): „agent-sim · reserviert bis 22:45“, „Reservierung abgelaufen am 17.10.,
   22:45 · Nochmal versuchen“, or for `agent_failed` „Nach 3 Versuchen gescheitert · Nochmal
   versuchen“ (today in „Prüfen“'s stage table). Phone: name and phase badge stacked, „Offene
   Punkte“ right, „Aktualisiert“ hidden. (O15)
5. **Stage hint** (`lib/labels.ts` `STAGES.incorporated`): „Analyse fertig, nichts mehr offen.“ →
   „Relationen fertig geprüft.“; the stage itself is unchanged (decision 8). (O15)
6. **Empty project:** unchanged (one primary „Modelle hochladen“, ghost „Agent verbinden“).

### 3.3 „Offene Fragen“ (`routes/project-open-questions-page.tsx`, `components/open-questions/`)

1. **Default view** (§2.4): „Zu klären (21)“ as cards in today's order (`positionOf`: questions by
   `unlocks`, then the chain's findings, the owner's answer of 2026-10-16), then the closed group
   „Zur Information (33)“ (decision 24.8: shown, read-only). The agents' questions are not listed:
   they show on their proposal (the review screen's box, the queue's hint „Frage“, the chain card)
   and in the export with „Auch Fragen der Agenten“; the „Art“ filter keeps the value „Frage eines
   Agenten“ as the web twin of `analyzr questions --group agent`. `proposal` items are not shown
   (the chain badge counts them); the summary row of the first draft goes. The count line reads
   „21 zu klären“; „19 Fragen der Agenten · 33 zur Information“ counted things that are not work
   (P7). The 50-card page becomes 21 cards and one closed group. (G1, O4, C4)
2. **Intro**: the 127-word paragraph („Hier steht, wo der Landschaft Wissen fehlt … (als
   Notizen).“) → „Was in der Landschaft noch fehlt. Zu jeder Frage gibt es eine Aktion, mit der du
   sie erledigst.“ and a closed „So funktioniert es“. (G4)
3. **Filters**: five selects → „Art“, „Modell oder Ordner“, „Ansprechpartner“ (lanes and step
   owners; the folder is already the model filter) in one row; on a phone one „Filter (n)“ button.
   „Quelle“ leaves the UI (its URL parameter and the API stay; an active one shows as a removable
   chip). „Status“ → open by default, foot link „Erledigte zeigen (1)“, so the count line no longer
   says „114 Fragen“ under a badge of 113. (G9)
4. **Export for the customer**: „Als Markdown exportieren“, „Als CSV exportieren“ → one button „Für
   den Kunden exportieren …“ opening a small dialog: „Zum Lesen (Markdown)“ or „Zum Ausfüllen
   (CSV)“, the checkbox „Auch Fragen der Agenten (19)“ (off), „Herunterladen“. The default exports
   `group=ask` only (Q11; M6 §1.1 step 8 sends the agents' questions to the customer today): a
   proposal the consultant cannot decide becomes a hold with a question, and so an `ask` item.
   „Antworten aus CSV übernehmen …“ stays a visible button (reviewers), not a menu entry, so the
   demo's write guard sees it (§7). The default file name stays `offene-fragen-<p>.csv` (other
   filters slug into it as today). The Markdown (`apps/server/src/domain/open-questions/export.ts`)
   applies P2: „Stand Ereignis 280“ → „Stand 17.10.2026“; per item „Betrifft: „Bestellung
   freigeben lassen“ in „Nordwind Handel – Einkauf““ instead of „Bezug: `einkauf/…#…`“; the contact
   hint without „Ordner: …“; no „Kennung“, „Quelle“ or „Offene Entscheidungen“ lines; the id as an
   HTML comment after each heading (`<!-- q-ef18acf5b85ccb6b -->`), invisible when rendered but
   still the way back to `analyzr questions answer`. The CSV keeps its five columns in their order
   and `id` (M6 §4.8 b); its header „Ansprechpartner-Hinweis“ → „Ansprechpartner“, and the importer
   accepts both (contracts first); „Frage“ holds the question and, as a second sentence, its
   reason (item 6), since the customer may need it to answer. CSV rows: 81 → about 21 by default.
   (G14)
5. **Card** (`question-item.tsx`): kind badge, subject (a link „Im Modell zeigen“), question,
   contact hint (lanes, step owner), at most three actions (primary, then a ghost button or
   „Weitere Aktionen“; disclosures such as „Warum?“ do not count). A muted meta line „Betrifft 6
   offene Entscheidungen“ where `unlocks` ≥ 2, so the order stays explained (the contract: it
   ranks, it predicts nothing, so no „hilft bei“). Removed from the card: the id `q-…` (menu entry
   „Kennung kopieren“), every `s…` (`RaisedBy`), „Erkannt von analyzr“, the source label
   („Befund“, „Lückensignal“, „Befund der Wertschöpfungskette“), „Keine offene Entscheidung“, the
   folder in the contact hint, and „Bezug“ when its refs are the subject's own (otherwise „Betrifft
   auch“). A principal's handle shows as text only when items come from more than one. (G3, O13)
6. **Question first, reason behind „Warum?“**: the read model splits its German text into the
   question (`text`) and an optional `detail` (contracts first). `detail` is code-generated
   (findings, signals, uncovered pairs); `context` stays the verbatim human or agent supporting text
   (a hold's note); the contract documents both. „Welchen Prozess ruft „Forderung an Inkasso
   übergeben“ in „Forderungsmanagement“ auf? calledElement „Process_Inkasso“ passt zu keiner
   Prozess-ID im Projekt.“ → question „Welchen Prozess ruft „Forderung an Inkasso übergeben“ auf?“,
   detail „Das eingetragene Ziel „Process_Inkasso“ gibt es in keinem Modell.“ For an unsure
   verdict the question comes from code („Auf welchen Schritt gehört „Gutschrift erstellen“?“) and
   the agent's verbatim reason is the detail. (G16)
7. **Pools by name**: „sid-D9C8E0F1-A2B3-4C4D-9E5F-7A8B9C0D1E09“ and „Participant_Customer“ → the
   label „Pool in „Nordwind Online Shop – Order handling““ with its messages („Externer Partner
   oder fehlendes Modell? Nachrichten: Auftrag, Auftragsbestätigung.“), set by the server's read
   model so the tab, the export and `analyzr questions` agree (P5); no „Bezug“. The pool's diagram
   name needs facts v2 (participant names are not in facts v1, frozen for the live runs); resolving
   it in the web would leave the export and the CLI on the raw id and fetch up to 5 MB of XML per
   model. (G15, O13)
8. **Informational items**: two or more `descriptive-model` items with the same text → one notice
   above the list („6 von 6 Modellen sind beschreibend (ohne Engine): Aufrufziele,
   Nachrichtennamen und Dokumentation helfen den Agenten, mögliche Relationen zu finden.“);
   summaries one line each, „Zusammenfassung des Agenten anzeigen“ (decision 24.8: still shown,
   read-only). „Die Regelebene findet hier wenig“ → „Die automatische Verknüpfung findet hier
   wenig“. (G12, O13)
9. **Answered items**: hidden by default; a done card is one line „Außerhalb der Landschaft ·
   <Notiz>“ with „Markierung zurücknehmen“; a withdrawn mark leaves the card for a closed
   „Verlauf“ (rows stay append-only; the export keeps them). (G19)
10. **Holds**: the „Zu klären“ card is the one place to answer a hold (relation or placement):
    primary „Antwort geben“ (the note dialog; customer answers from the CSV land on the same item),
    secondary „Jetzt entscheiden“, which opens the review screen or the chain with both diagrams and
    returns to the tab after the decision (`?from=open-questions`, built in UX5 and UX6). The
    embedded decision panels (`action-panels.tsx` `RelationDecision`, `PlacementDecision`) go
    (Q4). Without the owner's OK the fallback is G13: „Annehmen“ and „Ablehnen …“ directly in the
    row, „Vormerken“ and „Korrigieren“ in the menu. (R16, G13, R9)
11. **„Befunde“ page**: a foot link „Alle Befunde der Modelle als Liste (7)“ (the duplicate copy
    without open calls, R1b, is only there) (Q2). (O3, G7)

### 3.4 Question actions (pickers, amend form; `action-panels.tsx`, `amend-panel.tsx`, `components/amendments/`)

1. **One entry for link or amendment** (G5): today „Verknüpfen mit …“ and „Aufrufziel im Modell
   ändern …“ (calls), „Verknüpfen mit …“ and „Nachrichtennamen ändern/eintragen …“ (messages) open
   two pickers with different row formats. New: one button „Ziel wählen …“ (call) or „Partner
   wählen …“ (message), one picker with rows „Name – Modellname“ (the ref repeated in a focusable
   tooltip). After the pick, for editors and owners (`canWrite`; an amendment needs `write` on top
   of `review`), a checkbox **chooses** the outcome: „Im Modell eintragen (statt nur zu
   verknüpfen)“. Checked, only the amendment is sent; its re-derivation makes the link, and the
   cost line shows before „Speichern“. Unchecked, only `link` is sent. Never both: they are two
   transactions on two routes, a 412/428 or a claimed-task refusal on the amendment would leave the
   link written, and M6 §4.8 c would then retire that manual relation in the amendment's own
   transaction („Ersetzt durch den Aufruf aus der Ergänzung“), an accept and a rejection in the
   append-only history for nothing. Checked by default where decision 25 makes the amendment
   primary (no key or name), unchecked where a value exists. REST keeps `link` and `amend` as
   separate action types with distinct labels (`packages/contracts/src/open-question-labels.ts`:
   link „Nur verknüpfen …“, amend „Ziel im Modell eintragen …“ / „Nachrichtennamen im Modell
   eintragen …“), which the CLI prints; the combined button text lives in the web. The model
   view's „Ergänzen“ offers the same entry (Q5).
2. **Ranked candidates** (G10): „Vorgeschlagen“ stays first (M6 §4.8 a); then „Passt vermutlich“,
   the top 3 by name similarity to the unresolved value or the subject (`lib/generic-names.ts`
   `nameWords`): „Process_Inkasso“ → „Inkasso“, „RuecklastschriftEingegangen“ → „Rücklastschrift“,
   „Gutschrift erstellen“ → „Gutschrift“; then the rest, alphabetical by name, not by model key.
3. **„Sammeln“ goes** (G8): the button, the hint „Mehrere Ergänzungen an diesem Modell? …“, the
   sticky bar (`collect-bar.tsx`, whose `bg-accent` is see-through when it sticks), the mark
   „gesammelt“, the toast, the intro sentence and the leave-page guard. Its promise does not hold:
   `costOf` (`apps/server/src/domain/use-cases/amendments.ts`) counts only current judgements, so a
   second save before the agent's next run re-judges nothing; batching only saves revisions.
4. **Dry run inline** (G17): the dry run runs as soon as a value is picked or typed (debounced),
   „Danach: …“ stands above a single „Speichern“; the second confirmation stays only for „Ein
   Agent bearbeitet dieses Modell gerade; seine Arbeit geht verloren.“ The repeated field label
   goes; „Der nächste Import aus dem Quellsystem behält die Ergänzung, solange das Feld dort
   unverändert ist.“ moves behind an info disclosure; „15 Paare (mögliche Verbindungen zu anderen
   Modellen) werden von den Agenten neu beurteilt“ → „Die Agenten beurteilen 15 mögliche Relationen
   neu, sobald du den Agenten startest.“; after „Speichern“ the toast offers „Agent starten“ (§2.6).
   Clicks to set a call target: 4–5 → 3 (action, pick, „Speichern“). M6 §4.8 c's "cost before every
   save" holds.
5. **Note field**: „Notiz (optional)“ with its two-sentence hint in every link, place and
   choose-copy panel → a link „+ Notiz“. (G18)
6. **„Gültige Kopie wählen“**: rows titled by model path („einkauf/archiv/bestellfreigabe-2019“,
   „einkauf/bestellfreigabe“), the process id behind „Technische Angaben“; the CLI hint „Ein
   veraltetes Modell löschst du mit analyzr models delete …“ goes (DEVELOPMENT.md keeps it). (G18)
7. **A menu with one entry** (22 cards: only „Notiz hinzufügen“) renders as a ghost button
   „Notiz“. (G13)
8. **Note dialog** (`note-dialog.tsx`, `lib/open-question-answers.ts` `noteEffectText`): two cases
   change. An item with an `amend` action: „Fehlt ein Wert im Modell? Trag ihn mit „<Aktion>“ ein.“
   (today it still says „ergänze es im Quellwerkzeug und importiere das Modell erneut“, stale since
   S5c-2). An item about neither a relation nor a placement: „Die Notiz bleibt bei der Frage und
   geht mit in den Export.“ The relation and placement texts stay (where the note is stored, that
   agents see it, that the process becomes due for the placement agent); only their „Entscheiden“
   → „Jetzt entscheiden“. The personal-data warning stays; „Eine gespeicherte Notiz lässt sich
   nicht mehr ändern oder löschen.“ → the button „Notiz speichern (nicht änderbar)“. Each case is
   pinned in `open-question-answers-lib.test.ts`. (G11)

### 3.5 Model view (`routes/model-view.tsx`)

1. **Phone and tablet, view-first** (P8): below 1024 px the panel is a sheet collapsed to a handle
   („Fragen 2 · Relationen 11“) and the header a full-width top bar (back crumb, model name, stage
   badge); the canvas container ends above the sheet in both states, so the bpmn.io watermark stays
   visible (§3.13 item 1). Today the 380 px panel covers the canvas and the header (its
   `max-w-[min(480px,calc(100vw-440px))]` is negative at 390 px). (O9, G21)
2. **Panel** titled „Dieses Modell“ with two tabs, „Fragen (2)“ and „Relationen (11)“. „Fragen“
   holds the model's `ask` items only; an agent's question shows on its relation card. The panel
   opens on „Fragen“ when there are any, else on „Relationen“. The section „Befunde“ goes (Q2; the
   canvas marker „Befund“ stays). With an element selected, both tabs filter to it („Alle zeigen“
   resets): the element's own question with its action first, and „Ergänzen“ only for fields no
   open question covers, so a gap has one entry, not three (today „Ergänzen“ with „Ändern …“,
   „Aufruf ohne Ziel“ under „Befunde“ and „Aufrufziel unbekannt“ under the questions). The panel
   header shows the element's label, not its id. (O10, G6, O3, O14)
3. **Relation cards** (`RelationItem`): five marks → two lines: element name and status badge;
   „→ Kreditprüfung · finanzen/kreditpruefung“ (the arrow gives the direction, the icon the type;
   „Aufruf“, „ausgehend“ in its accessible name and a repeating tooltip); confidence only on
   proposals; the tier in „Verlauf“ on the review screen. (O11)
4. **Header** (the shared canvas header, §3.13): the breadcrumb „Nordwind Handel GmbH ›
   Übersicht“ is the only way back (today „← Relationen“ and „Modelle“); the title is the model
   name, the key small mono below; chips: stage, „In analyzr ergänzt (1)“ (with „aus r1“), and
   (S2a) one derived chip; a „Mehr“ menu holds „Herkunft“ (S2a, §6), „Revisionen (2)“, „BPMN
   herunterladen“, „Original herunterladen“, „Fürs Quellsystem: Änderungsliste (Markdown/CSV)“
   and an info line with engine and revision. (O12, G20)
5. **Question cards** as in §3.3 (compact), summaries one closed line. (O13)
6. **Selected element**: the chip shows „Run fraud check“, not „Call_FraudCheck“ (id behind
   „Technische Angaben“); „Dieses Element hat keine Relation.“ hides when an „Ergänzen“ or „Ziel
   wählen …“ card shows; „Verlauf (1)“ stays closed with one entry, „Zurücknehmen …“ sits next to
   „Ändern …“ (`components/amendments/model-amendments.tsx`). (O14, G20)
7. **Legend** „gewählter Endpunkt · hat Relationen · Klick auf ein Element filtert die Liste.“:
   shown until the first click on an element, then an info button next to the zoom controls. (O23)
8. **Import loss** (S2a's `extractor-loss`): a header line „Beim Import übersprungen: 2 Elemente –
   Details“, opening the question. (O21)

### 3.6 „Relationen › Zu prüfen“ (today's „Prüfen“; `routes/project-review.tsx`, `components/review/`)

1. **Phase bar and stage table leave** for the chips and rows of „Übersicht“ (§2.3, §3.2 item 4);
   the queue keeps its `?stage=` filter (reached from a chip's „n Vorschläge dieser Modelle
   prüfen“), and J/K walk the filtered queue. One warning line only when something needs action:
   „2 Modelle warten auf den Agenten · Agent starten“, „1 Analyse gescheitert · Nochmal versuchen“,
   „Bei 1 Modell ist die Reservierung abgelaufen · Nochmal versuchen“. The first proposal moves
   from ~620 px to under 360 px. (R3, R11, R24)
2. **Placements callout** „29 Platzierungen warten auf deine Prüfung …“ goes; the chain's badge
   says it. (R3)
3. **Queue** (`queue-table.tsx`): one primary „Vorschläge prüfen (42)“ opening the first item,
   and next to it the visible secondary „8 unauffällige annehmen …“ (item 5). Rows lead with the
   model names, in the width the dropped „Herkunft“ column frees: „Gutschrift erstellen →
   Reklamation“; below, the message or call name once (both only when they differ), the type icon
   and the confidence; the key only when two models share a name. 41 of 42 rows are message,
   signal or trigger pairs whose element names are often equal, and today the processes are cut
   to „finanzen/gutschrift · Gutschrift e…“. Each row keeps one focusable link (the „Von → Nach“
   cell) and a row click for the mouse; the 42 „Prüfen“ buttons go. The column „Herkunft“
   (`agent:agent-sim` in all 42 rows) → „Hinweise“ with only „Frage“, „Einwand“, „widerrufen“,
   „schließt 1 Modell ab“; the agent's name shows only when proposals come from more than one
   principal. The same row serves the phone cards and the bulk dialog. (R4)
4. **Views** of the tab „Relationen“: „Zu prüfen 42“, „Vorgemerkt“ (no number; holds count in
   „Offene Fragen“), „Gilt“, „Abgelehnt“, „Automatisch angenommen“ (only above 0; §3.10). „Kein
   Zusammenhang 144“ → a foot link „Kein Zusammenhang laut Agent (144)“ (`?view=no-links` stays,
   grouped by model, collapsed) (Q12, decided with decision 26), built in UX5; until then the view
   stays. (R10)
5. **Bulk accept** (`bulk-accept-dialog.tsx`): the primary blue „Schlüssel: 29 annehmen…“
   promised 29 and selected 8 (R6). It becomes the outline „8 unauffällige annehmen …“, the count
   equal to the default selection. The dialog lists the 8 (selected) and a closed „Genauer ansehen
   (21)“ (per row one flag line such as „Allgemeiner Name · in 4 Prozessen“ and a link „Vorschlag
   öffnen“); the 21 stay in the queue. The 40-word description → „Markierte mögliche Relationen
   wählst du bewusst selbst aus.“ After a bulk accept, owners get one line: „Gleicher Name ab
   100 % künftig automatisch annehmen? · Annahmeregel anlegen“, opening the rule dialog prefilled
   (rules match agent proposals only, decision 19; whether the flags block is Q8). The lexical bulk
   („Ähnlich: 13 annehmen…“, preselecting pairs at 65 % and 66 %) goes (Q7). (R6, R7)
6. **Filters** „Stufe“ and „Modell“ → „Grundlage“ and „Modell“ (§4); hidden while the list is
   empty. (R8, R24)
7. **„Vorgemerkt“** (`held-list.tsx`): rows without open text areas (today two large text areas
   per row, `<UX>/critic/04-held.png`): note, question, label and answers so far, read-only;
   „Antwort geben“ opens the note dialog of „Offene Fragen“ (§2.4), „Jetzt entscheiden“ the review
   screen. „Die Antwort ist eine Notiz an der Relation; entschieden wird, sobald sie feststeht.“
   once above the list. (R9)
8. **Phone**: the queue (`min-w-[960px]`) becomes cards with the row of item 3 (a tap opens the
   review screen); no sideways scroll. (R17)

### 3.7 Review screen (`routes/review.tsx`, `components/review/review-details.tsx`)

1. **Phone, view-first** (P8): the collapsed sheet shows Von → Nach and the confidence; the header
   bar (back, „32 von 42“, ‹ ›, „Nebeneinander / Von / Nach“) stays above it (today the panel covers
   it: `elementFromPoint` at „Prüfliste“ returns the aside); the four decisions are one tap away in
   the expanded sheet, reachable, not optimized; the canvas container ends above the sheet
   (watermark, §3.13 item 1). (R1)
2. **Panel**: visible are the header (type, status, Von, Nach, confidence), „Frage des Agenten“,
   „Begründung“, „Belege“ (as element names) and the decision bar. „Herkunft“ (`provenance.tsx`)
   and „Verlauf“ (`timeline.tsx`) merge into one closed „Verlauf (3)“: an entry already shown above
   shows only its title, who and when; the relation id and version move in; rows whose value is
   „–“ go; client id, procedure and LLM model sit behind „Technische Angaben“. 201 words → about 100.
   (R2)
3. **Held relation**: the box „Offene Frage (vorgemerkt)“ shows the note, question, label and the
   answers so far, read-only; „Antwort ergänzen“ replaces „Vormerken“ in the decision grid and
   opens the note dialog of „Offene Fragen“ (decision 10 unchanged; one place to answer, §2.4). (R9)
4. **Return**: opened from „Offene Fragen“ (`?from=open-questions`), the back link and the end of
   the queue lead back there (Q4; built here, in UX5, with the route's search validation).
5. **1024–1279 px**: the panes stack instead of switching; pane chips show „Von“ or „Nach“, the
   process name and „Im Modell“; engine, key and stage behind the chip's disclosure. (R18)
6. **Keyboard hints**: on the four buttons only; the footer keeps „J K weiter, zurück“; none on
   touch. (R19)
7. **„Vormerken“ form** (`decision-forms.tsx`): „Notiz“ and a link „Frage oder Label ergänzen“;
   `HOLD_HINT` goes (decision 10: both stay, folded). (R20)
8. **Auto-accept mark**: one status badge „Automatisch angenommen“ instead of „Angenommen“ plus
   the box; rule name and revision in „Verlauf“ (and repeated in the badge's tooltip); a revoked
   item shows one line „Automatische Annahme widerrufen“ (Q6); confidence always
   `formatConfidence` („100 %“, not „mit 1,00“). (R15, R22)

### 3.8 Wertschöpfungskette (`routes/value-chain-page.tsx`, `components/value-chain/`)

1. **Panel order** (`chain-overview.tsx`): one status line „0 von 31 Prozessen platziert · 29
   Vorschläge offen“ and the primary „Platzierungen prüfen (29)“ (= J); then „Zu prüfen (29)“
   without „Vorschlag“ on every row (a marker only for „erneut prüfen“); then „Ohne Schritt (3)“;
   then the step tree collapsed to its 12 top-level rows with roll-ups („5 offen“), closed by
   default (it stays the keyboard alternative to the canvas). The summary's five numbers and the
   agent stage line go; the stage shows only when actionable: „Agent arbeitet“, „Agent gescheitert
   · Nochmal versuchen“, „3 Prozesse fällig · Agent starten“ (§2.6). (C1, C12)
2. **„Agent unsicher (3)“ and „Prozesse ohne Schritt (3)“** (the same three processes) → one list
   „Ohne Schritt (3)“: name, the agent's reason as one muted line when there is one („Agent
   unsicher: …“), „Passt vielleicht zu:“, „Platzieren“; ref, handle and time behind „Technische
   Angaben“. The header chip „3 Prozesse ohne Schritt“ scrolls to it. (C2)
3. **„Befunde (44)“** → only „Link nicht auflösbar (n)“, shown when such a link exists; the 32
   process-gap and 12 step-gap rows go (the gaps stay answerable in „Offene Fragen“, decision
   24.3), and „44 Befunde“ leaves the summary. On the canvas, „nichts angenommen“ shows only on a
   step whose subtree has no open proposal or hold (`canvas/overlays.ts`, web only): 12 labels → 4.
   (C3)
4. **Placement card** (`placement-card.tsx`): the status badge only when it is not a plain
   proposal; the mono ref „einkauf/archiv/bestellfreigabe-2019#Process_Be…“ → the model path in
   plain text; „Herkunft“, „Belege“ and „Verlauf“ → one „Details“ with the tier inside,
   „Vorgeschlagen von Agent „agent-sim“ · 17.10.2026, 22:32“, evidence as names („Schritt
   „Auftragsabwicklung““), timeline entries already shown collapsed, no „maßgeblich“, and
   „Technische Angaben“ nested (client id, procedure, LLM model). The agent's question stays in its
   „Frage“ box on the card (it is not listed in „Offene Fragen“, §2.4). The auto-accept mark stays
   visible on the card (decision 19). 8 controls → 6. (C5, C6)
5. **Header**: „‹ Nordwind Handel GmbH“ only (the shared canvas header); „Modelle“ (a second link
   to the same page) and „Prüfen“ (the relation inbox) go; „.vc.json“ and „SVG“ → „Exportieren“
   („Datei (.vc.json)“, „Bild (SVG)“, the same labels as the hub of §3.2); „r1 · gespeichert von
   owner · …“ into the chain name's disclosure; the key hint „J K Platzierungen · A R H C
   entscheiden“ goes. 8 controls → 4. (C9)
6. **Canvas**: the selected step gets a visible outline (the `index.css` rule
   `.analyzr-vc-selected … stroke-width: 4px` loses to the renderer's inline `stroke-width: 2px`;
   fix with `!important` or a primary stroke); overlay labels scale down with the zoom (lower
   `scale.min` in `overlays.ts`) so step names stay the largest text; a toggle collapses the panel.
   (C8)
7. **Edit mode**: the overview shrinks to the chain's name and „Wähle einen Schritt, um ihn zu
   bearbeiten. Gespeichert wird erst mit „Speichern“.“; the review sections return with „Fertig“.
   The warning „Entfernte Schritte mit Platzierungen – Speicherst du so, bleiben ihre Platzierungen
   als offene Punkte“ goes (it contradicts the impact dialog's exact „3 Vorschläge werden
   zurückgezogen“). `INSET.left` becomes about 80 px in edit mode, so the palette no longer covers
   „Beschaffung“. (C7, C15)
8. **Double-click** on a step without a process link selects and zooms in place; a linked step
   still opens its model; `/value-chain/steps/…` stays as a deep link; „Schritt öffnen“ → a small
   „Als Liste öffnen“. The step view drops the tier badge, the mono ref and the per-row „Auf der
   Kette zeigen“ (the row links to the card) and hides empty „Verantwortlich –“ and „Link –“.
   (C10)
9. **Phone, view-first** (P8): the sheet collapsed to „29 offen“ with the header above it;
   deciding works in the expanded sheet, not optimized. (C11)
10. **Step panel** (`step-panel.tsx`): no element id in view mode; the kind badge only on
    top-level steps; the „Link“ section hidden when none is set; the counts line „0 angenommen · 3
    vorgeschlagen · 0 vorgemerkt“ goes. (C14)
11. **Labels** (`step-panel.tsx` `KIND_CHOICES`, `link-editor.tsx`): „Ohne Farbe (Kern oder
    Sonstige)“ → „Kern (Standard)“, without the description; „analyzr-Prozess“ → „Prozess“; the
    hint → „Beim Speichern wird „X“ als Vorschlag für diesen Schritt angelegt.“; URL hint
    „Webadressen öffnen sich in einem neuen Tab.“ (decision 18: kinds stay colour-based). (C13)
12. **Forms**: „Korrigieren“ prefills „Gehört auf „<Schritt>“.“ once a step is picked (the
    contract still requires a note); description „„X“ kommt auf den gewählten Schritt; der
    Vorschlag wird abgelehnt.“; „Die Platzierung gilt sofort (Stufe Manuell).“ → „Die Platzierung
    gilt sofort.“; the held card shows note and answers read-only with „Antwort geben“, which opens
    the note dialog of „Offene Fragen“ (§2.4); the hold form folds as in §3.7. (C16)
13. **Legend**: one line „„3 offen“ zu prüfen · „2 Prozesse“ platziert · lila Management · grün
    Unterstützung“; „Vorgänger-Kette = Kern“ and „Doppelklick öffnet den Schritt.“ go; the removed
    steps section drops the per-card hint. (C17)
14. **Empty chain** (`empty-chain.tsx`): „Wertschöpfungskette anlegen“ and „Importieren“ first,
    „Zeichne die Kette hier oder importiere eine .vc.json (etwa den Entwurf deines Agenten).“; the
    CLI command behind „Per CLI hochladen“. (C18)

### 3.9 „Hochladen“ (`components/upload-panel.tsx`, `lib/upload.ts`)

1. **Result headline**: „Import abgeschlossen: 6 Dateien“ → „5 Modelle importiert · 1 Fehler · 1
   übersprungen“. The page has the crumb „<Projekt> › Hochladen“ and, next to the result, „Zur
   Übersicht“. (O5)
2. **Next-step box**, the web twin of `formatNextSteps` (`apps/cli/src/commands/import.ts`): „5
   Modelle warten auf den Agenten · Agent starten“ (the popover of §2.6, or „Agent verbinden“
   without a token), „9 offene Fragen gibt es schon jetzt · Offene Fragen ansehen“. (O5, O16)
3. **Warnings grouped by element and cause** (O6): today „9 Hinweise“, each „Unbekannter oder
   fehlerhafter Inhalt“ plus bpmn-moddle English („unparsable content <task> detected … illegal ID
   <Aufgabe_Bonität_prüfen>“, „unresolved reference <4711>“). A warning carries only the code, that
   English message and at most an `elementId`; the element was never parsed, so its name is
   unknown. New: type and id parsed out of the pinned messages, „2 Elemente übersprungen, weil ihre
   ID ungültig ist: Aufgabe „Aufgabe_Bonität_prüfen“, Datenspeicher „4711“. Sie fehlen im Diagramm
   und in den Verbindungen.“ (the name only where facts know it); the `_gui` shape and reference
   lines fold into that entry; the raw messages sit behind „Technische Details“; the fix „Mit
   /analyzr-integrate:integrate-landscape bereinigen und erneut hochladen.“; `parse-warning`s about
   illegal or duplicate ids map to the existing labels „Ungültige ID: Element übersprungen“ and
   „Doppelte ID: zweites Element übersprungen“ (`WARNING_LABELS`). The link goes to the model, not
   to an element that is missing from the diagram. The file's disclosure keeps the word „Hinweise“
   („2 Hinweise“), so the release-pinned integrate skill's sentence („„N Hinweise“ in the web“,
   `plugins/analyzr-integrate/skills/integrate-landscape/SKILL.md`) stays true without a plugin
   release. The parsing is tested on the Signavio fixture's real messages. (O6, O21)
4. **Dropzone text**: „Der Pfad im Ordner wird zum Modellschlüssel: … Bis 50 Dateien pro Anfrage,
   je höchstens 5,0 MB; größere Mengen teilt analyzr selbst auf.“ → „BPMN-Dateien oder einen Ordner
   hierher ziehen. Der Ordnerpfad wird zum Kurznamen, z. B. finanzen/mahnwesen.“ and „Export aus
   Signavio, ARIS oder Visio? Wandle ihn zuerst mit /analyzr-integrate:integrate-landscape um und
   lege dann den Bundle-Ordner hier ab.“ (copy button); limits only in the error or skip text; on
   touch „BPMN-Dateien oder einen Ordner auswählen“. (O7)
5. **Errors and skips**: the UTF-16 error is `BpmnInputError('not-xml')`, the same code as invalid
   UTF-8 and non-XML, with only an English `detail`. bpmn-facts gains a structured `reason`
   (`utf16`, `not-utf8`, `not-xml`, …) on that error, carried in the problem (contracts first; no
   change to facts or `facts_hash`), and the web says per reason „Die Datei ist UTF-16-kodiert;
   analyzr liest nur UTF-8. Speichere sie als UTF-8 oder wandle den Export mit
   /analyzr-integrate:integrate-landscape um.“; „1 Dateien übersprungen (kein BPMN, größer als 5,0
   MB oder gleicher Modellschlüssel wie eine BPMN-Datei)“ → up to three inline, „1 Datei
   übersprungen: Prozesslandkarte.pdf (kein BPMN)“; „Datei“ and „Modell“ merge into one column (the
   model link, the file path small below). (O8)

### 3.10 „Relationen“: the result views (today's „Relationen“ tab; `routes/project-relations.tsx`, `components/relation-table.tsx`, `lib/relation-filters.ts`)

1. **Views instead of presets**: the views „Gilt“, „Abgelehnt“ and „Automatisch angenommen“ (only
   above 0) of the tab „Relationen“ (§3.6 item 4) replace the presets; „Vorgemerkt“ is the hold
   view of §3.6, „Schlüssel-Vorschläge“ and „Alle Vorschläge“ go (they repeat „Zu prüfen“). Result
   views carry no number (P7); the table shows its rows. (R5)
2. **Filters**: „Status“ (only in „Alle“) and „Modell“ visible; „Grundlage“, „Typ“, „Annahmeregel“
   behind „Weitere Filter“. (R5)
3. **Rows**: the expand chevron (refs, id, version, attributes) goes, the review screen holds the
   details; the row action is „Öffnen“; the column „Herkunft“ (`analyzr-rules/1.0.0`,
   `analyzr-relations@0.2.0 · sim-policy-1`) → „Entschieden von“ (who, no procedure or model ids);
   the endpoint columns get the freed width instead of „Mahnverfahren d…“. (R5)
4. **Auto-accept mark**: the status badge „Automatisch angenommen“ instead of „Angenommen“ plus a
   four-line badge (Q6). (R15)
5. **Empty text** by state: with models „Noch keine Relationen. Eindeutige Aufrufe verknüpft
   analyzr beim Hochladen; den Rest schlägt ein Agent vor.“ and „Agent starten“ (or „Agent
   verbinden“ without a token; today „Lade Modelle hoch: …“ although models exist); views and
   filters hidden while empty. (O20)

### 3.11 „Einstellungen“: „Agent verbinden“ and „Annahmeregeln“

„Agent verbinden“ (`components/connect-agent.tsx`):

1. **Step „3. Agent starten“** after the configuration: the content of the popover of §2.6
   inline. (O16)
2. **Token form**: name and „Token erstellen“; „Rechte“ and „Gültigkeit“ behind „Erweitert“ with
   today's defaults; the principle once, in the card description (not again as „Entscheiden dürfen
   Agent-Tokens nie; das bleibt Menschen vorbehalten.“); the six-sentence revoke text → two (what
   stops at once, that decisions stay) and „Was passiert genau?“; the „Präfix“ column into the
   name's disclosure. (O17)

„Annahmeregeln“ (`routes/project-rules-page.tsx`, `components/rules/`):

3. **Rule rows** (`rule-table.tsx`): six buttons → an „Aktiv“ switch (`role=switch`),
   „Bearbeiten“ and „Mehr“ („Verlauf“, „Widerrufen…“ only when something is in force). Enabling
   creates a rule revision, so the switch confirms first when proposals are open (the existing
   „offer to apply“ step) or when it would change the deciding principal: for a rule whose author
   lost the owner role, saving takes it over (HANDOFF §8 "Auto-accept: take-over", still open), and
   the confirmation says so. „Nach Agent widerrufen…“ (`agent-revoke.tsx`, today a permanent
   section) spans all rules, so it becomes a page-level action in the page header's „Mehr“, shown
   while acceptances exist, not a rule row entry. The separate „Vorschau“ goes (the dialog shows it
   live); „Anwenden“ only as an inline hint on an active rule whose dry run finds items („2 offene
   Vorschläge passen – ansehen…“); „Bisher“ lists non-zero counts; „r1 · owner, …“ moves into
   „Verlauf“. (R12, R23)
4. **Dialog** (`rule-dialog.tsx`, `rule-preview.tsx`): „Art“, „Grundlage“, „ab Konfidenz“ and
   „Typ“ visible; the name prefilled from the criteria („Gleicher Name ab 95 %“, editable, a suffix
   when taken); „Agent“, „LLM-Modell“, „Auch Ad-hoc-Vorschläge“ and „Notiz“ behind „Weiter
   einschränken“; one „Speichern“ with an „Aktiv“ switch instead of „Speichern (aus)“ and „Speichern
   und aktivieren“; the curve under „Nach Konfidenz aufschlüsseln“, only rows whose numbers change.
   The bulk accept's offer (§3.6 item 5) opens this dialog prefilled. (R13)
5. **Preview and apply** also say „davon N mit allgemeinem oder mehrfach genutztem Namen (in der
   Sammelannahme markiert)“ from the same `bulkFlags`; whether flags should block is Q8. (R14)
6. **Texts**: the safeguard sentence once on the page („analyzr nimmt neue Agentenvorschläge ab
   deiner Konfidenz selbst an – nie bei einer offenen Frage, einem Einwand oder wenn du schon
   entschieden hast.“), the dialogs only what is specific to them; the system rule card one line
   „Eindeutige Aufrufe nimmt analyzr beim Hochladen an · immer aktiv · 10 angenommen“ (no
   „calledElement“, no „Verfahren analyzr-rules/1.0.0“); no „Neue Regel“ next to „Erste Regel
   anlegen“. (R21)
7. **Apply and revoke lists** (`rules/subject.tsx`, `apply-dialog.tsx`): element labels and
   „100 %“ instead of raw refs and „mit 1,00 · sim-policy-1“; the whole list scrolls instead of
   stopping at 20. (R22)

### 3.12 Projects list and „Neues Projekt“ (`routes/index.tsx`)

1. **Columns** (UX9, with the route): „Projekt | Schlüssel | Rolle | Stand | Angelegt“ →
   „Projekt“ (the key small below), „Offen für dich“ (only for roles with `review`; „–“ for
   viewers and the demo visitor, who cannot decide anything), „Zuletzt geändert“. The numbers come
   from `GET /projects/{p}/summary`: a public, documented use case with `policy.require` (permission
   `read`), listed in CONCEPT §5's route table, optionally read by the CLI; it returns
   `lastEventAt` and cheap counts (review items, open placements, the `ask` total from the memoized
   read model). Nothing goes into `Project`, which is MCP `list_projects`'s output (the
   `mcp-tools.json` snapshot stays). (O18)
2. **„Rolle“** (UX1) hides only when every role is „Inhaber“ (local mode, decision 6); with any
   other role, and always in the demo, it stays, since „Leser“ tells the visitor why nothing can be
   changed. (O18)
3. **Developer hints** (UX1): the footer „Testlandschaften laden: pnpm seed“ and
   „Seed-Befehl kopieren“ only in the dev server (`import.meta.env.DEV`). „Stand s…“ goes. (O18)
4. **Dialog** (UX1): „Schlüssel“ field and its hint → a preview line „Kurzname:
   kunde-maschinenbau (ändern)“ that opens the field; „Du bist sein Inhaber.“ goes. (O22)

### 3.13 Cross-cutting

1. **One floating panel** `components/canvas-panel.tsx` for the model view, the review screen and
   the chain page, its API designed in UX3 against all three (the review: name and navigation in
   the collapsed state, the decisions in the expanded one; the chain: edit mode with `INSET`): an
   aside from 1024 px, a view-first sheet below; no new dependency (exact versions, `pnpm
   notices`). **The bpmn.io watermark** (README: it must not be removed or changed and must stay
   fully visible and unobstructed) sits at the canvas container's bottom right with z-index 100.
   Today it stays visible at 390 and 800 px only because it is painted over the review panel's
   corner (`<UX>/feas/review-390-watermark.png`); a sheet in its own stacking context would hide it,
   one without would put it over the sheet's buttons. So the canvas container ends above the sheet
   in both states: its bottom is inset by the collapsed sheet's height, and on expand the container
   shrinks (bpmn-js `canvas.resized()`) or the sheet is capped so the canvas edge stays above it;
   the sheet never overlays the canvas. The canvas pages stay inside the `h-app-viewport` container,
   so the demo banner's height still counts. The landmarks `<aside aria-label=…>` stay, or the CSS
   check's probes change with them (`e2e/value-chain.spec.ts` `probeReview` compares
   `aside[aria-label=Prüfung]` and `.bjs-powered-by` before and after a navigation; if the label
   disappears both return `{missing}` and the check passes without testing anything). Sheet
   accessibility: the handle is a `button` with `aria-expanded` and `aria-controls`, the collapsed
   content is `inert`, Escape collapses, focus moves into the content on expand, J/K/A/R/H/C still
   work while collapsed, `prefers-reduced-motion` is respected. (O9, G21, R1, C11)
2. **One canvas header** `components/canvas-header.tsx`: breadcrumb „<Projekt> › <Bereich>“ as
   the single way back, title, at most three chips, „Mehr“ (a light disclosure, item 8). Today each
   canvas page has its own, and the chain's reads „‹ Kunde Maschinenbau Zwei · Modelle · Prüfen“.
   (O12, C9)
3. **Keyboard hints** (`components/ui/kbd.tsx`) hide under `(hover: none)`. (R1, R19, C11)
4. **No ids in text** (P2): refs, ids, handles and seq numbers behind „Technische Angaben“ or a
   disclosure; titles by element or model name. (G3, O13, R2, C6)
5. **Confidence** always `formatConfidence`. (R15, R22)
6. **Tooltips only repeat.** The web has no tooltip component, only about 101 `title=`
   attributes, which neither touch (P8) nor keyboard users reach on non-focusable spans.
   Information a decision needs stays in text or a disclosure: the agent's name when more than one
   agent proposes (live runs use several tokens), holder and reservation (§3.2 item 4), the split of
   „Offene Punkte“ (§2.5). A tooltip repeats it on a focusable trigger with `aria-describedby`; a
   Radix Tooltip from `radix-ui` is no new dependency but costs entry bytes (item 8).
7. **Failed writes in German** (`lib/api.ts` `errorMessage`, 64 call sites; the titles in
   `packages/contracts/src/problem.ts` are English): a German text per `ProblemCode`, and per
   `reason` where one exists, e.g. 412 „Inzwischen hat sich etwas geändert. Lade neu und prüfe den
   neuen Stand.“, 409 `conflict` „Das passt nicht mehr zum aktuellen Stand.“; the original
   title and detail behind „Technische Details“. A test fails when a code has no German text. Web
   only, live-run neutral (UX1).
8. **Menus and the entry chunk.** The shell, the models tab and `model-view.tsx` are in the entry
   chunk; Radix's dropdown with floating-ui loads only with the open-questions and amendments
   chunks today (bundle guard comment, S5c-1). Menus in the shell and the canvas header therefore
   use a light disclosure without floating-ui (a button with `aria-expanded`, an absolutely
   positioned list, Escape and outside click), or render the Radix menu through `lazy()` on first
   open. No new lazy routes to pay for it: every new dynamic import that shares entry modules makes
   rolldown split the entry into more, separately gzipped chunks (+~6 KB with S4's lazy imports,
   the guard's comment); `codeSplitting` groups come first. Target: the entry stays under the 240 KB
   ceiling (decision 21), each slice within +3 KB of the last measurement, written into the guard's
   comment.

## 4. Glossary

| Old label | New label | Where |
|---|---|---|
| tab „Modelle“ | „Übersicht“ | project nav |
| tabs „Prüfen“ and „Relationen“ | „Relationen“ with the views „Zu prüfen“, „Vorgemerkt“, „Gilt“, „Abgelehnt“ (Q1) | project nav |
| tab „Regeln“ | „Annahmeregeln“ (in „Einstellungen“) | nav; „Regel“ means only the owner's rules from now on |
| „Stufe“ | „Grundlage“ | filters, rule dialog, review |
| tier „Regel“ | „Eindeutiger Aufruf“ | `lib/labels.ts` `TIERS` |
| tier „Schlüssel“ | „Gleicher Name“ | `TIERS`, bulk accept |
| tier „Ähnlich“ | „Ähnlicher Name“ | `TIERS` |
| tier „Bedeutung“ | „Gleiche Bedeutung“ | `TIERS` |
| tier „Manuell“ | „Von Hand“ („Grundlage: Von Hand“) | `TIERS`; „Von dir“ would be wrong for another reviewer's relation in server mode (R1) |
| „Schlüssel“, „Modellschlüssel“ (project and model key) | „Kurzname“ („Der Ordnerpfad wird zum Kurznamen, z. B. finanzen/mahnwesen“) | „Neues Projekt“, upload, bundle line (§6) |
| „zuordnen“, „zugeordnet“ (a process to a step) | „platzieren“, „platziert“ („Prozess platzieren …“, „Von Hand platziert.“) | chain, question actions; one verb, as the cards and badges already say „Platzierung“ |
| „fehlgeschlagen“ | „gescheitert“ (as `STAGES`) | „Als Nächstes“, warnings, `CHAIN_STAGES` |
| „Paar“, „Verbindung“ (a candidate pair) | „mögliche Relation“ | bulk dialog, amend cost, no-links |
| preset „Durch Systemregel angenommen“ | „Eindeutige Aufrufe“ | „Relationen“ |
| timeline „Vorgeschlagen · analyzr-rules“ / „Vorgeschlagen · agent:agent-sim“ | „Gleicher Name erkannt (analyzr)“ / „Vom Agenten vorgeschlagen“ | review „Verlauf“ |
| „Herkunft“ (relation, placement, queue column) | in „Verlauf“ / „Details“; queue column „Hinweise“; relations column „Entschieden von“ | „Herkunft“ is reserved for the model's source (S2a, §6) |
| „Befunde“ (tab, model view section) | the kind labels of the questions | – |
| chain „Befunde (44)“ | „Link nicht auflösbar (n)“ | chain panel |
| „Lückensignal“, „Befund der Wertschöpfungskette“ (source labels) | not shown | cards |
| „Bezug“ | gone, or „Betrifft auch“; in the export „Betrifft: „<Element>“ in „<Modell>““ | cards, Markdown |
| „N offene Entscheidungen“ | „Betrifft N offene Entscheidungen“ (from 2, in the meta line) | cards |
| „Stand Ereignis 280“ | „Stand 17.10.2026“ | Markdown export |
| „Aufrufziel erst zur Laufzeit bekannt“ | „Ziel wird erst beim Ausführen bestimmt“ | `open-question-labels.ts` (export and CLI too) |
| „Nachrichten- oder Signalpartner fehlt“ | „Partner der Nachricht fehlt“ | same |
| „Verknüpfen mit …“ + „Aufrufziel im Modell ändern …“ | web „Ziel wählen …“ with „Im Modell eintragen (statt nur zu verknüpfen)“; API labels „Nur verknüpfen …“ / „Ziel im Modell eintragen …“ | question actions (Q5) |
| „Verknüpfen mit …“ + „Nachrichtennamen ändern/eintragen …“ | web „Partner wählen …“ with the same checkbox; API „Nur verknüpfen …“ / „Nachrichtennamen im Modell eintragen …“ | question actions (Q5) |
| „Entscheiden“ (agent question, hold) | web „Vorschlag öffnen“; holds „Jetzt entscheiden“; API `decide` label „Vorschlag prüfen“ | question actions (Q4) |
| „Prüfung starten (42)“ | „Vorschläge prüfen (42)“ | everywhere |
| „Erneut einplanen“ / „Aufgabe einplanen“ | „Nochmal versuchen“ (requeue, then the popover) / „Agent starten“ | „Übersicht“, „Relationen“, chain |
| „Lease bis …“ / „Lease abgelaufen am …“ | „reserviert bis …“ / „Reservierung abgelaufen am …“ | models table, warning lines |
| „Ansprechpartner-Hinweis“ | „Ansprechpartner“ | filter, CSV header (the importer accepts both) |
| „Erledigt (außerhalb)“ | „Außerhalb der Landschaft“ | state |
| „Regelebene“ | „die automatische Verknüpfung“ | `descriptive-model` text |
| „Analyse-Pipeline“ | „die wartenden Modelle“ | „Zu prüfen“ empty text |
| „Offen“ (models table) | „Offene Punkte“ | models table |
| „Offene Prüfungen“ | „Zu prüfen“ | chain panel |
| „Agent unsicher“ + „Prozesse ohne Schritt“ | „Ohne Schritt“ | chain panel |
| „analyzr-Prozess“ | „Prozess“ | link editor |
| „Ohne Farbe (Kern oder Sonstige)“ | „Kern (Standard)“ | step kind |
| „Schlüssel: 29 annehmen…“ | „8 unauffällige annehmen …“ | „Zu prüfen“ |
| „Stand s277“, „s252“, `q-…`, `rel_… · Version 2`, `agt_…`, „sim-policy-1“, „maßgeblich“ | not shown (behind „Technische Angaben“) | everywhere |
| „mit 1,00“ | „100 %“ | rules dialogs |
| intro „Hier steht, wo der Landschaft Wissen fehlt …“ | „Was in der Landschaft noch fehlt. Zu jeder Frage gibt es eine Aktion, mit der du sie erledigst.“ | „Offene Fragen“ |

Labels shared through `@analyzr/contracts/open-question-labels` change once for the tab, the model
view, the export and `analyzr questions`. API values (tier `key`, kinds, sources) and the system
rule's name „Eindeutige Aufrufe“ (decision 19) stay.

## 5. Removed, hidden or moved; recorded decisions

### 5.1 Removed from the UI (data, REST, MCP and CLI stay)

The tabs „Befunde“ (Q2) and „Prüfen“ as a tab of its own (it is „Relationen › Zu prüfen“, Q1) and
the model view's „Befunde“ section; the „Phase“ select (replaced by the chips); the phase bar and
the stage table in „Prüfen“ (stages as the chips and the rows of „Übersicht“, the requeue cases in
the warning lines and rows; the queue's stage filter stays); the per-area count lines of the first
draft's landing; „Stand s…“; `s…`, `q-…` and the source label on cards; the agents' questions as a
list in „Offene Fragen“ (they stay on their proposals and in the export option); the placement
summary row and the „+ 29 Platzierungen“ callout; „Server verbunden“ while ok; the pnpm seed hints
outside dev; „Rolle“ while every role is „Inhaber“; the columns Engine, Revision, „Datei“
(merged), „Präfix“, „Angelegt“; the 42 row buttons „Prüfen“ and the handle column; „Sammeln“ with
its bar, hint, mark, toast and guard; the lexical bulk accept (Q7); the expand chevron in
„Relationen“; the presets „Schlüssel-Vorschläge“, „Alle Vorschläge“; the separate rule „Vorschau“;
the duplicate „Neue Regel“; the chain header's „Modelle“, „Prüfen“ and key hint; the chain's
step-gap and process-gap rows and „44 Befunde“; the „Agent unsicher“ section (merged); the
edit-mode warning „Entfernte Schritte mit Platzierungen“; the per-card removed-step hint; the
choose-copy CLI hint; keyboard hints on touch and the review footer's „A R H C entscheiden“; the
„Quelle“ filter (URL and API keep it); the open answer fields of the held list and the held chain
card (one dialog instead); the embedded decision panels for agent questions and holds (Q4).

### 5.2 Hidden or moved (one click away)

„Hochladen“ → button; „Agent verbinden“, „Regeln“ → „Einstellungen“ (Q1); starting the agent → the
popover of §2.6 wherever it is needed; the stages → the chips of „Übersicht“; „Kein Zusammenhang“ →
foot link of „Relationen“ (Q12); informational items → closed group; answered items → „Erledigte
zeigen“; withdrawn marks → „Verlauf“; engine, revision, „Revisionen“, downloads, „Herkunft“ → model
view „Mehr“; exports → also the hub „Exportieren“ on „Übersicht“; relation „Herkunft“ and
„Verlauf“ → one closed „Verlauf“; placement „Herkunft“, „Belege“, „Verlauf“ → „Details“; technical
provenance → „Technische Angaben“; token rights and expiry → „Erweitert“; rule narrowing → „Weiter
einschränken“; the confidence curve → „Nach Konfidenz aufschlüsseln“; per-agent revoke → the rules
page header's „Mehr“; „Frage“ and „Label“ of a hold → a link; note fields → „+ Notiz“; raw upload
warnings → „Technische Details“; the legend → info button after the first click; the empty chain's
CLI command → „Per CLI hochladen“; the step tree → collapsed, after the reviews; intros → „So
funktioniert es“; the „Befunde“ page → foot link (Q2).

### 5.3 Texts this plan amends (implementing agent; the owner may overrule)

| Text | Change | Slice |
|---|---|---|
| CONCEPT §3 review workflow (stages shown in the inbox, M2) and step 5 (tab „Regeln“) | stages on „Übersicht“ (decision 8 unchanged: stages, labels, REST, MCP); „Annahmeregeln“ in „Einstellungen“ | UX1 |
| CONCEPT §5 route table | `GET /projects/{p}/summary` | UX9 |
| M6 §4.4 (five filters; „Offene Fragen“ after „Befunde“; two export buttons) | three filters, open by default; the tab order of §2.2; the export dialog | UX2b |
| M6 §4.8 a (one question per process; primary action table) | the rule extends to agent questions on placements and unsure verdicts; `group` added; link and amend share one entry that chooses (with Q5) | UX2a, UX4 |
| M6 §4.8 b (CSV) | header „Ansprechpartner“ (both accepted), reason as the second sentence of „Frage“; five columns unchanged | UX2a |
| M6 §4.8 c „Web“ („Sammeln“, the collection bar) | removed (§3.4) | UX4 |
| M4 §4 (panel content and order without a selection; overlays for findings; double-click → step view) | order of §3.8; „nichts angenommen“ only on real gaps; double-click selects in place | UX6 |
| M3-LIVE-RUNS.md: step 4 (the **Prüfen** tab's stage counts, holder, attempt and lease end, „Erneut einplanen“; the table's „Lease bis …“ texts), line 65 (tab „Regeln“), step 6a (the chain's „Agent fehlgeschlagen“ with „Erneut einplanen“), step 7 (provenance on the review screen, bulk accept per tier) | the chips and rows of „Übersicht“, „Nochmal versuchen“, „reserviert bis …“, „Einstellungen › Annahmeregeln“; „Agent gescheitert · Nochmal versuchen“; „Verlauf“ and „8 unauffällige annehmen …“ | UX1 (step 4, line 65), UX5 (step 7), UX6 (step 6a) |
| README.md line 52 („project → „Agent verbinden““), `examples/agents/claude-desktop/README.md` („The Agent verbinden page“) | „Einstellungen › Agent verbinden“ | UX1 |
| HANDOFF §8 rows "Shared-name flag" (the bulk dialog's flags) | the dialog's new form; the question stays | UX5 |
| DEVELOPMENT.md "Web UI" route table, "Review in the web UI", "Value chain in the web UI" | rewritten per slice, with the measured screen numbers | every slice |

### 5.4 Questions for the owner

**Owner answers 2026-10-18 (decision 26), each the recommended option:** Q1 „4 Tabs (Empfohlen)“
(option B; with it Q2 yes, the tab „Befunde“ goes, and Q12 the foot link „Kein Zusammenhang laut
Agent“ in „Relationen“); Q3 and Q11 „Ja, nur „Zu klären““ (the badge counts „Zu klären“, the
customer export defaults to `ask`); Q4 and Q5 „Dort, wo die Diagramme sind“ (decide on the review
screen or the chain; one entry that chooses link or amendment); Q10 „Erste Welle, dann
Walkthrough“ (UX2a → UX1 → UX2b, then the owner's walkthrough of five tasks decides UX3–UX9;
UX7/UX8 before S2b and S2c). Q6–Q9 stay "ask at the slice". **At UX5 (2026-10-18)** the owner
answered Q6 and Q7 „Q6 und Q7 ja, mach weiter“, each the recommended option (HANDOFF decision 26
(5) and (6)); Q8 and Q9 stay open for UX9 and after the live runs.

Each touches a recorded owner decision or answer, or removes a visible area; each has a
recommendation.

**Ask now** (they shape UX2a, UX1 and UX2b):

- **Q1 Navigation** (decision 19 names the tab „Regeln“, owner-only; decision 20's notes make
  „Agent verbinden“ owner-only; CONCEPT §3 names the inbox). In both options „Hochladen“ is a
  button and „Agent verbinden“ and „Annahmeregeln“ sit in an owner menu „Einstellungen“; the gates
  stay exactly; the URLs stay. **A:** five tabs „Übersicht“, „Prüfen 42“, „Offene Fragen 21“,
  „Wertschöpfungskette 29“, „Relationen“ (opens on „Gilt“). **B:** four object tabs, each with its
  open work as the badge and its results inside: „Übersicht“, „Relationen 42“ (opens on „Zu
  prüfen“; views „Vorgemerkt“, „Gilt“, „Abgelehnt“; foot link „Kein Zusammenhang“),
  „Wertschöpfungskette 29“, „Offene Fragen 21“; `/review` and `/relations` stay as deep links into
  the views. B removes one tab and the presets that repeat the inbox, and ends the mix of one verb
  tab and four noun tabs (in A, job 2 is split across „Prüfen“ and „Wertschöpfungskette“ while
  „Relationen“ serves none of the six jobs). *Recommendation: B. The run guide's URLs keep working;
  UX1 updates its tab names.*
- **Q2 Drop the tab „Befunde“ and the model view's „Befunde“ section.** All 7 findings of
  `nordwind-handel` are open questions with actions under other names; the page stays behind a
  link (it alone shows a duplicate without open calls, R1b); REST, MCP and the claim inputs'
  findings are unchanged. *Recommendation: yes.*
- **Q3 „Offene Fragen“ shows „Zu klären“, and the badge counts it** (decision 24.8: summaries
  shown read-only, kept in a closed group; the owner's answer of 2026-10-16: chain findings after
  the other questions, kept, the order is unchanged). The agents' questions show on their proposals
  (review screen, queue hint, chain card) and in the export option instead of as a list; the
  placement-review items show only through the chain badge; the one-question-per-process rule
  extends to agent questions on placements and unsure verdicts; nothing leaves the API (`group` is
  a label and a filter; `analyzr questions --group agent` lists them). Badge 113 → about 21.
  *Recommendation: yes.*
- **Q4 Holds and agent questions are decided where the diagrams are** (decision 25: „decide“ as an
  inline panel in the tab). Today the same proposal can be decided in two places, the second
  without the visual check. Proposal: a hold's card answers in the note dialog and offers „Jetzt
  entscheiden“, which opens the review screen or the chain and returns to the tab; agent questions
  are decided on their proposals. *Recommendation: yes; alternative: keep inline but with
  „Annehmen“ and „Ablehnen …“ directly in the row (G13).*
- **Q5 One entry that chooses between linking and amending** (decision 25 and 25.1: both outcomes
  stay). „Ziel wählen …“ / „Partner wählen …“, then the checkbox „Im Modell eintragen (statt nur
  zu verknüpfen)“ (editors and owners), checked where the element lacks a key or name; checked
  sends only the amendment (its re-derivation makes the link), unchecked only the link.
  *Recommendation: yes.*
- **Q10 Order and timing** (M6 §8 "Order since decision 25": S2a → S2b → S2c …; the M3 live runs
  are next). Proposal: UX2a → UX1 → UX2b (about 8 d), then a walkthrough of five tasks on a
  scratch stack (§7) that decides whether and in which order UX3–UX9 follow, with UX7 and UX8 (S2a's
  web parts) before S2b. UX1 moves what the run guide watches (stage counts, holder, reservation,
  requeue) to „Übersicht“ and updates M3-LIVE-RUNS.md in the same slice. *Recommendation: yes; if
  the live runs start before UX1 lands, UX1 keeps „Prüfen“'s stage table until the runs are done.*
- **Q11 The customer export without the agents' questions by default** (M6 §1.1 step 8: „export
  „Offene Fragen“ with the agents' questions for the customer“). Today the default sends 19
  questions about proposals nobody has looked at yet; the consultant could settle many at a glance
  on the review screen. Proposal: default `group=ask`; „Auch Fragen der Agenten“ in the export
  dialog; a proposal the consultant cannot decide becomes a hold with a question, and so an `ask`
  item. *Recommendation: yes.*
- **Q12 Where the agents' no-links live** (HANDOFF §8 "Demo: no-links in the review", decision
  20(4), still open: keep the inbox tab „Kein Zusammenhang“, move it, e.g. per model into the model
  view, or add example disagreements). Proposal: a foot link „Kein Zusammenhang laut Agent (144)“
  in „Relationen“ (`?view=no-links` stays, grouped by model, collapsed); the other option is a
  section per model in the model view's „Relationen“ tab; example disagreements stay out (they
  conflict with decision 17). *Recommendation: the foot link.* **Answered 2026-10-18 (decision
  26): the foot link, built in UX5; until then the view „Kein Zusammenhang“ stays.**

**Ask at the slice:**

- **Q6 Shorter auto-accept mark** (UX5; decision 19 „accepted items are marked“; CONCEPT §3 step 5
  records the text „Automatisch angenommen – Regel „…““ in the table, review screen, history,
  queue, chain and step view). The status badge „Automatisch angenommen“ replaces „Angenommen“;
  the rule name moves to „Verlauf“; filters unchanged. *Recommendation: yes.*
- **Q7 Bulk accept only for „Gleicher Name“** (UX5; CONCEPT §3 step 2 names bulk accept for the
  key tier; the lexical bulk is an implementation extra that preselects pairs at 65 %).
  *Recommendation: yes; if kept, start it with nothing selected.*
- **Q8 Should the bulk flags (generic name, name in several processes) block an auto-accept rule?**
  (UX9; decision 19's safeguard list; HANDOFF §8 "Shared-name flag"). The plan only shows the count
  in the preview and apply. *Recommendation: show only; decide after the live runs with the
  what-if.* **Answered at UX9 (2026-10-19): „Nur anzeigen“** (decision 26 (7)).
- **Q9 German texts for the simulation agent** (after the live runs; decision 20: the demo runs
  it; M3: agents write German). Its English rationales („scores 3 in the lexical baseline …“, „no
  lexical evidence for any step“) show in the demo and on every scratch stack; changing them needs
  a new sim policy, recordings and digests. *Recommendation: not in the UX slices; a separate slice
  after the live runs.*

## 6. M6 S2a/S2b on the simplified design

S2a's server, contracts and CLI parts are done; its web parts wait for this plan (M6 §8 "S2a as
delivered"). They fit without a new column, tab or panel:

- **„Herkunft“ in the model view** (M6 §3.3): an entry in the header's „Mehr“ menu opening a small
  panel: „Aus Signavio 17.2 · exportiert am 14.10.2026 (angegeben)“, „Im Quellsystem:
  Finanzen/Forderungsmanagement“ with „Im Quellsystem öffnen“ (http(s) only, `rel="noopener
  noreferrer"`), „Hochgeladen über den Owner-Zugang“ or „… über ein Agenten-Token“, „Verluste bei
  der Konvertierung“ as a list; for an amended head it follows `source.upstream` and says „In
  analyzr ergänzt (aus r3)“. „Im Quellsystem öffnen“ is also a direct „Mehr“ entry. Only a
  `derived` kind other than `export` becomes a header chip („Konvertiert“, „KI-rekonstruiert“, „Aus
  Interview“), since it changes how far to trust the diagram; no chip for a plain export. The word
  „Herkunft“ is free for this because relations and placements no longer use it (§4).
- **Badges in the models table**: the same derived chip in the name cell (the system repeated in
  its tooltip), never a column; when every model has the same `system`, the muted header subtitle
  „Aus Signavio · exportiert am 14.10.2026“ instead (§3.1 item 3). Both need each model's
  `source.derived`, `system` and `exportedAt`, which `Model` does not carry and `GET …/external-ids`
  does not give: UX8 adds a REST-only provenance summary to `Model` (`source: {system, derived,
  exportedAt} | null`; `Model` is in no MCP output schema), contracts first, the client regenerated,
  with a server test. S2c's trust marker, if the owner enables it, reuses this chip.
- **`extractor-loss`**: an item in „Zu klären“ (already in the contracts), the model view's header
  line „Beim Import übersprungen: 2 Elemente – Details“ (§3.5), and the grouped upload warning
  (§3.9); no extra mark in the table (it counts in „Offene Punkte“).
- **`analyzr-import.json` from a dropped folder**: the upload reads it at the folder root before
  sending and validates it with the contracts' own schema (`packages/contracts/src/api/import-manifest.ts`:
  "the server, the CLI and the web validate it with these schemas alike"), through a new export
  `@analyzr/contracts/import-manifest` loaded with a dynamic import only when the folder has a
  manifest (zod already lives in lazy chunks only; no duplicated zod-free schema that could drift).
  The bundle guard's pinned list of contracts files and its "zod-free" comment change with it, and
  the entry stays free of zod. The upload sends each batch its subset as the CLI does, and says it
  in one line under the dropzone: „Bundle erkannt: Signavio, exportiert am 14.10.2026 · 6 von 6
  Dateien gelistet · Kurznamen aus dem Bundle“; files the manifest does not list: „2 Dateien stehen
  nicht im Bundle; sie bekommen ihren Pfad als Kurznamen.“; an invalid manifest stops before
  sending with a German reason. `external-id-moved` and `external-id-changed` show in German in the
  file's disclosure next to the extractor warnings („Im Quellsystem umbenannt? „<id>“ gehörte bisher
  zu „<Kurzname>“.“) and count in the headline („2 Hinweise zur Identität“). A `valueChain` in the
  bundle adds one next-step line „Das Bundle enthält eine Wertschöpfungskette · Auf der Kette
  importieren“.
- **„Vorschau“ before „Importieren“ (S2b)**: a drop shows the dry run in the result's own layout
  (UX7): headline „Vorschau: 5 Modelle neu · 1 Fehler · 1 übersprungen“, the outcome column „wird
  neu“, „neue Revision“, „unverändert“, „Fehler“, at most three impact lines („Danach: 3 Aufrufe
  automatisch verknüpft · 2 Relationen mit geändertem Endpunkt · 12 mögliche Relationen neu zu
  beurteilen“), the capped lists behind „Was ändert sich?“, one primary „Importieren“ and
  „Abbrechen“; after importing, the same panel turns into the result with the next-step box. When
  every key shares one top folder: „Alle Kurznamen beginnen mit „gemeinsame-dokumente/“ – lege den
  Unterordner ab, wenn das nicht Teil der Namen sein soll.“ (keys are fixed for good, M6 §3.4, so
  the preview shows on a first import too). Above 50 files: „Vorschau je 50 Dateien; Aufrufe
  zwischen den Teilen erscheinen hier als unaufgelöst.“ One click more, no new screen.
- **Deletion impact** (S2b): stays in `analyzr models delete`; the web has no model deletion. If
  the owner wants it, it goes into the model view's „Mehr“ as „Modell löschen …“ with the impact as
  the confirmation dialog, in the chain save's pattern (only non-zero lines, „Weiter bearbeiten“ /
  „Trotzdem löschen“).

## 7. Slices

Every slice runs all gates (AGENTS.md), updates DEVELOPMENT.md "Web UI" with the measured screen
numbers and the docs of §5.3 it owns, and regenerates the affected `docs/screenshots` through the
specs that make them: `e2e/screenshots.spec.ts` (01–07), `review.spec.ts` and `pipeline.spec.ts`
(m2-*), the value-chain specs (m4-*), `auto-accept.spec.ts` (d19-*) and `demo.spec.ts` (demo-*,
which needs the demo image: `ANALYZR_IMAGE=analyzr-<x>:dev`, never `analyzr-demo` or
`analyzr-demo:local`). Contracts first where a route or field changes, then `pnpm --filter
@analyzr/client generate`. Live-run neutral: no change to facts, the rule tier, claim inputs, MCP
output schemas (`mcp-tools.json` snapshot unchanged), procedures, recordings or reports.

**UI load guard.** UX1 adds `apps/web/e2e/ui-load.spec.ts`. No Playwright spec runs in CI
(`.github/workflows/ci.yml` has no e2e job) or in AGENTS.md's gates, and every spec skips without
a server, so each slice's done-when names an explicit run of the guard and its affected specs
against an agent-owned stack (compose project `analyzr-<x>` on free ports); pure budget checks
(controls and words per component, label tables, the `group` map, the error texts) move into
vitest/jsdom tests that run under `pnpm -r test`. The guard runs at 1440x900 and in a mobile
context (`isMobile: true, hasTouch: true`, 390x844, so `(hover: none)` matches) on three projects:
`nordwind-handel` seeded with its chain and the simulation agent run (as `e2e/pipeline.spec.ts`
does), `signavio-beispiel` from the CLI bundle import (descriptive models, no proposals, the M6 path
the owner uses next), and an empty project. It checks:

- **Load:** per screen the visible controls, words, `data-slot=badge`, the first item's top,
  `scrollWidth`; each slice lowers its screen's budget to the targets below.
- **Tasks:** from `/projects/nordwind-handel` to the first relation decision in at most 2 clicks;
  a hold answered in at most 3 clicks, in one dialog from each entry; after an amendment save
  „Agent starten“ is visible without navigating; „Gutschrift“ found in at most 2 interactions at
  390 px.
- **Consistency:** every badge, every „Als Nächstes“ number and every „Offene Punkte“ equals the
  length of the list it opens; no item counts in two badges.
- **No ids:** one regex over every screen's visible text and the export's rendered text (the
  Markdown without HTML comments, the CSV without its `id` column):
  `rel_|plc_|agt_|mam_|oqa_|q-[0-9a-f]{16}|sid-|Stand s\d|Ereignis \d`.
- **Watermark:** on the model view and the review screen at 390, 800 and 1024 px, sheet collapsed
  and expanded, `elementFromPoint` at the centre of `.bjs-powered-by` returns the watermark and no
  panel control intersects its box (also added to the CSS check in `e2e/value-chain.spec.ts`).

| Slice | Scope | Size |
|---|---|---|
| UX2a | open-questions server and CLI: `group` (a `Record` over the kinds), the repeatable `group` filter, `totals` and `askByModel`, the extended one-question-per-process rule, `text`/`detail`, the pool label, the `proposal` items' chain action, the export (date, „Betrifft“, contact hint, HTML-comment id, CSV header alias, default `ask`), the API action labels, `analyzr questions --group` | 2 d |
| UX1 | shell and „Übersicht“: four tabs (Q1), „Hochladen“, „Einstellungen“, badges, header, error banner, German error texts, „Als Nächstes“, the „Agent starten“ popover, search and phase chips, the models table with „Offene Punkte“ and the agent lines, the „Exportieren“ hub, `useProjectCounts`, the projects list's removals and the „Rolle“ rule, „Neues Projekt“, the UI load guard | 3 d |
| UX2b | „Offene Fragen“ in the web: the default view, count line, intro, filters, the export dialog, cards, holds' one answer place, pools, informational and answered items | 3 d |
| – | **owner walkthrough** on a scratch stack (the agent-created `analyzr-local`, rebuilt to the branch): what's next on `nordwind-handel`, decide the first relation, answer a hold, find „Gutschrift“ on a phone, export the questions for the customer; decides UX3–UX9 and their order (done 2026-10-18: one finding, the order kept) | – |
| UX3 | model view: canvas panel (API for all three pages) and canvas header, „Fragen“/„Relationen“ tabs, element filter, relation cards, „Mehr“, legend, view-first phone, watermark | 3 d |
| UX4 | question actions: one entry that chooses, ranked pickers, „Sammeln“ removed, inline dry run, „+ Notiz“, choose-copy, ghost button, note dialog; the tab side of Q4 | 2.5 d |
| UX5 | „Relationen“ (views) and the review screen: start button, queue rows by model names, „Hinweise“, the bulk dialog and its rule offer, labels (`TIERS`), „Vorgemerkt“ rows, panel „Verlauf“, held answer through the dialog, return to „Offene Fragen“, stacked panes, keyboard hints, hold form, auto-accept badge, view-first phone; Q6, Q7 | 4 d |
| UX6 | value chain: panel order, „Ohne Schritt“, „nichts angenommen“, placement card „Details“, header, canvas selection and scale, edit mode, double-click, step panel and view, labels, forms, legend, empty state, return to „Offene Fragen“, view-first phone | 4 d |
| UX7 | „Hochladen“ and „Agent verbinden“: headline, crumb, next-step box, grouped German warnings, the structured `reason` for errors, dropzone text, merged column, step 3, token form, revoke text | 2 d |
| UX8 | S2a's web parts on UX1/UX3/UX7: the `Model` provenance summary, the manifest from the dropped folder, identity warnings, „Herkunft“ in „Mehr“, derived chip, `extractor-loss` header line | 2 d |
| UX9 | result views of „Relationen“, „Annahmeregeln“, the projects summary: filters, rows, rule rows (switch, page-level revoke by agent) and dialog, flags in preview, texts, apply/revoke lists, `GET /projects/{p}/summary` and the projects list's columns; Q8 | 2.5 d |

About 28 agent days (the measured M6 slices: S4 took 5 d for a read model, a tab, an export and
the CLI). First wave UX2a → UX1 → UX2b (8 d), then the walkthrough; the proposed rest (Q10): UX7 →
UX8 → S2b → UX3 → UX4 → UX5 → UX6 → UX9, alongside S2c and S3c.

**UX2a "Open questions: groups and totals" (server, contracts, CLI).** Files:
`packages/contracts/src/api/open-questions.ts` (`group`, the repeatable filter, `totals`,
`askByModel`, `detail` documented against `context`, the CSV header alias),
`open-question-labels.ts` (group labels; action labels link „Nur verknüpfen …“, amend „Ziel im Modell
eintragen …“, decide „Vorschlag prüfen“); `apps/server/src/domain/open-questions/` `model.ts` (the
group map), `sources.ts` and `signals.ts` (the `text`/`detail` split, the pool label), `actions.ts`
(the `proposal` items' action), `export.ts`, `read-model.ts`; the CSV importer; the client;
`apps/cli/src/commands/questions*.ts` (`--group`). Tests: `apps/server/test/unit/open-questions.test.ts`
(a kind without a group fails), `open-question-actions.test.ts`,
`test/integration/open-questions.test.ts` (the seeded counts per group and `askByModel` pinned),
the contracts tests, `apps/cli/test/unit/questions.test.ts`, `questions-act.test.ts`,
`questions-answer.test.ts`, `apps/cli/test/e2e/cli.e2e.test.ts` (it pins 64 questions, the order
of the owner's answer of 2026-10-16 and the Markdown). Done when: every kind maps to a group; the
`ask` total on seeded `nordwind-handel` is pinned (about 21); the order is unchanged (the CLI e2e
order still passes); the default export holds `ask` only under the old file name; the Markdown has
a date, „Betrifft“, no folder, no refs and the id only in comments; the CSV header reads
„Ansprechpartner“ and the importer takes both headers; the id regex finds nothing in the rendered
export; `mcp-tools.json` and the claim inputs are unchanged.

**UX2a as delivered** (2026-10-18, on the branch, every gate green; DEVELOPMENT.md "UX2a").
Contracts first (`packages/contracts/src/api/open-questions.ts`: `OpenQuestionGroup`,
`OpenQuestion.group` and `detail`, the repeatable `group` filter, `OpenQuestionTotals`,
`OpenQuestionPage.totals` and `askByModel`, `DEFAULT_EXPORT_GROUPS` and `exportGroups`, the CSV
column `Ansprechpartner`; `open-question-csv.ts` `CONTACT_COLUMNS`; `open-question-labels.ts`
`OPEN_QUESTION_GROUP_LABELS`, the action and kind labels), the client regenerated, the server's
read model and export, `analyzr questions --group`. Pinned on seeded `nordwind-handel` with its
chain (`apps/server/test/integration/open-questions.test.ts`, `state=open`):

| State | `ask` „Zu klären“ | `agent` | `proposal` | `info` |
|---|---|---|---|---|
| as seeded, no agent yet | 58 (14 findings, 6 pools, 28 processes and 10 steps without a placement) | 0 | 6 (the rule tier's placement proposals: 4 processes, 2 steps) | 0 |
| after the simulation agent (the walkthrough's state) | **21**: 8 findings (2 unknown and 2 dynamic call targets, 1 duplicated id, 3 message partners), 6 pools, 3 unsure verdicts, 4 empty steps | 22 | 27 (19 processes, the 8 top-level steps whose sub-steps carry proposals) | 32 (31 model summaries, 1 chain summary) |
| after two holds, a model change and a probe agent | 26 (28 before the first wave's review: the probe's two coded no-links now join the fraud check's finding and the customer's pool) | 19 | 26 | 32 |

`askByModel` after the simulation agent gives `einkauf/bestellanforderung` 1 (its pool), so its
„Offene Punkte“ of §2.5 add up to 8 once UX1 adds the relations and the placement; the whole map
is pinned. The id regex of the UI load guard finds nothing in the rendered Markdown (without its
comments) and the CSV (without its `id` column) of that state and of the Signavio fixture's
bundle (`tools/integrate/test/fixtures/signavio/bundle`); the order is unchanged (the CLI e2e
order and the 64 questions of `vc-seed` pass); `mcp-tools.json` and the claim inputs are
unchanged. Where the plan left room:

- `totals` and `askByModel` count under every filter but `group`, so one call with `group=ask`
  gives the cards and every count line; `total` stays the count under all filters.
- `askByModel` counts distinct subjects (the finding and the coded no-link about one call are one
  point), an item under each model it touches (the `modelKey` filter's rule).
- The export holds `ask` without `group` unless `kind` or `source` names what to export (else
  `kind=agent-question` would be empty, and today's tab exports with its filters); the default
  keeps the old file name, other groups slug into it (`-ask-agent`).
- The `proposal` items' chain action is a `decide` labelled „Auf der Kette prüfen“ with the new
  meaning of `step` (the proposed step, or the step itself) and the proposals in `decides`: no new
  action type, so the web and the CLI need no new case; their secondary actions stay.
- „Nur verknüpfen …“ only where the link is the second action beside a primary `amend` (a call
  without a target, a nameless endpoint); a primary link always reads „Verknüpfen mit …“ (the
  first wave's review: „Nur …“ as the main verb read as the lesser option). The amend labels no
  longer tell the empty from the named case. The glossary's kind labels „Ziel
  wird erst beim Ausführen bestimmt“ and „Partner der Nachricht fehlt“ and „Prozess platzieren …“
  changed with them, since the export and the CLI show them; „Erledigt (außerhalb)“ waits for
  UX2b's done card.
- `detail` is the read model's own plain German, never the frozen findings' `detail` (it names
  `calledElement`, refs and step ids). Coded no-links follow the unsure verdicts: a question from
  code, the agents' reasons verbatim as `detail`. The actions' rationale quotes question and
  reason.
- The pool label is „Pool in „<the pool or process it talks to>““ (facts v1 name the partner's
  pool, not the box), the model's name when it talks to several, and „(Nachrichten mit „…“)“
  when one model has several such pools.
- „Stand“ is the date of the project's latest event in German time, so the same state exports
  the same file; notes and marks carry their own dates. „Betrifft“ follows every CSV question,
  since the questions no longer name the process. The contact hint lists step owners, then lanes;
  the Markdown groups by step owners, then lanes, then „Ohne Ansprechpartner“ (since the first
  wave's review no heading names a folder, so the done-when's „no folder“ holds for the headings
  too).
- `analyzr questions` lists every group without `--group` (the API list stays complete) and ends
  its summary with `; groups: ask 21, agent 22, …`.
- The web shows `detail` muted under the question, and for an unsure verdict or a coded no-link
  the question first and the agent's words in the attributed box, until UX2b puts the reason
  behind „Warum?“; the web's fixtures carry the new fields, and the Playwright specs whose labels
  changed were updated, not run (no spec runs in the gates; UX1 adds the load guard).

Verified: every gate (DEVELOPMENT.md "UX2a"); the counts per group and `askByModel` on real
PostgreSQL; the CLI e2e order and its 64 questions; the id regex over the rendered export of both
fixtures. The Playwright specs it changed ran green with UX1, UX2b and the first wave's final pass.
Not verified: the export opened in a spreadsheet program or read by a customer (the CSV's byte
order mark and header are checked as bytes); the `ask` total on a real customer landscape.

**UX1 "Shell and Übersicht".** Files: `apps/web/src/routes/project.tsx`, `project-models.tsx`,
`index.tsx`, `router.tsx` (no route removed, no new lazy route), `components/page-shell.tsx`,
`models-table.tsx`, new `components/agent-start.tsx`, `components/review/stage-bar.tsx` (into the
chips), `project-review.tsx` (stage bar and `StageModels` out; the `?stage=` filter stays), new
`lib/project-counts.ts`, `lib/api.ts` (`errorMessage`), `lib/labels.ts` (stage hint). Without Q1's
answer the five tabs of option A; without Q2's the „Befunde“ tab stays and UX2b removes it. Tests:
`test/app.test.tsx`, `demo-mode.test.tsx`, `review-inbox.test.tsx`, a new error-text test (every
`ProblemCode` has a German text); `e2e/smoke.spec.ts` (line 81 „Server verbunden“, line 86 the
engine „C7“ in `model-row`, the findings page), `review.spec.ts` (`stage-filter`,
`stage-model-row` move to „Übersicht“), `pipeline.spec.ts` (the stage bar equals the stages),
`demo.spec.ts` (tab names, „Leser“, the „Befunde“ link; `noWriteActions` extended, below),
`open-questions.spec.ts` (tab order), `auto-accept.spec.ts` (tab „Regeln“), `screenshots.spec.ts`
(01, 02, 05); the bundle guard. Docs: README line 52, `examples/agents/claude-desktop/README.md`,
M3-LIVE-RUNS step 4 and line 65, CONCEPT §3 step 5. Done when: four tabs and three badges, no wrap
at 1440 px, one row of at most 48 px at 390 px with „Hochladen“ visible without scrolling; the
block above the table has at most 40 words and at most 5 controls; the primary button's top is at
most 260 px at 1440x900 and at most 300 px at 390x844; the priority rules in component tests (no
models; waiting without a token; waiting with one, agent first; agent working with proposals open;
proposals; nothing open); the consistency checks pass; „Offene Punkte“ of
`einkauf/bestellanforderung` is 8; „Gutschrift“ is found in 2 interactions at 390x844; no id
matches on „Übersicht“; the demo shows no write entry with every menu opened; the entry chunk stays
under 240 KB, within +3 KB of the last measurement, written into the guard's comment.

**Demo write guard (UX1, then every slice).** `noWriteActions` in `e2e/demo.spec.ts` queries only
`button` and `link`; write actions in menus are `menuitem`s that exist only while the menu is open.
It opens every visible menu trigger and checks the `menuitem`s too, and `WRITE_ACTIONS` gains every
renamed write label („8 unauffällige annehmen …“, „Ziel wählen …“, „Partner wählen …“, „Antwort
ergänzen“, „Antwort geben“, „Jetzt entscheiden“, „+ Notiz“, „Notiz“, „Agent starten“, „Nochmal
versuchen“, „Antworten aus CSV übernehmen …“). A menu trigger renders only when the viewer can use
one of its items; write items are hidden for viewers. Each slice names its demo.spec changes: UX1
„Leser“ and the „Befunde“ link; UX2b the export dialog (file name unchanged) and the model view
heading; UX5 the queue row's link and the no-links (`agent:` moves out of the visible text); UX6
`chain-stage` (shown only when actionable) and the collapsed step tree (`step-tree-item`).

**UX1 as delivered** (2026-10-18, on the branch, every gate green; DEVELOPMENT.md "UX1"). Web
only: no route, contract, server, MCP, procedure or recording change. The shell
(`routes/project.tsx`: four object tabs, „Hochladen“ as a button, the owners' menu
„Einstellungen“ in `components/light-popover.tsx`, the key under the name, the crumb of pages
without a tab), `components/page-shell.tsx` (the server banner only on trouble, the version in
the logo's tooltip), the German problem texts (`lib/problem-texts.ts`, `errorMessage`,
`errorDetail`, `components/error-text.tsx`, the toast's „Technische Details“), „Übersicht“
(`routes/project-models.tsx`, `components/next-step-block.tsx` and `lib/next-step.ts`,
`components/agent-start.tsx`, `components/export-hub.tsx`, `components/models-table.tsx`, the
chips in `components/review/stage-bar.tsx`), `lib/project-counts.ts` `useProjectCounts`, the
projects list and „Neues Projekt“ (`routes/index.tsx`), the inbox without stage bar and stage
table (`routes/project-review.tsx`), the stage hint „Relationen fertig geprüft.“, the foot link
„Alle Befunde der Modelle als Liste (n)“; the UI load guard `e2e/ui-load.spec.ts` and the demo
write guard. Measured with the guard and the same counting on the scratch stack `analyzr-ux1`
(`nordwind-handel` seeded with its chain and worked by the simulation agent, nothing decided:
the walkthrough's state; `signavio-beispiel` from `analyzr import` of the Signavio fixture's
bundle; an empty project), before = UX2a's web build served from the same database:

| Budget (done when) | Before (UX2a) | After (UX1) |
|---|---|---|
| Tab bar at 1440 px | 9 tabs, 6 counts, 2 rows (85 px) | 4 tabs, 3 badges (Relationen 48, Wertschöpfungskette 29, Offene Fragen 21), 1 row (35 px) |
| Tab bar at 390 px | 4 rows, 189 px | 1 scrolling row, 35 px (≤ 48), „Hochladen“ and the gear in view |
| Block above the table, `nordwind-handel` | none (a „Phase“ select and „Änderungsliste herunterladen“) | „Als Nächstes“: 6 words, 2 controls (≤ 40, ≤ 5); freshly seeded without an agent (the screenshot 02) 27 words, 4 controls |
| Primary button's top | none | 224 px at 1440x900 (≤ 260) and at 390x844 (≤ 300); `signavio-beispiel` 224 px |
| „Übersicht“ `nordwind-handel`, whole page at 1440 / 390 px | 43 / 43 controls, 400 / 400 words, 62 / 62 badges | 75 / 75 controls (the plan's „Offene Punkte“ links, one per model with open work), 317 / 252 words, 31 / 31 badges |
| „Übersicht“ `signavio-beispiel`, 1440 px | 18 controls, 122 words, „Offen“ 0 on every row | 23 controls, 87 words, „Offene Punkte“ 1–3 on 4 of 6 rows |
| Empty project, 1440 px | 13 controls, 56 words, 5 zero counts | 9 controls, 37 words, no badge |
| Projects list, 1440 px | 5 controls, 49 words, 3 badges | 5 controls, 33 words, no badge (no „Rolle“ in local mode) |
| „Gutschrift“ at 390x844 | – | 2 interactions (type, open) |
| First relation decision from „Übersicht“ | 2 clicks (tab, „Prüfen“) | 1 click („Vorschläge prüfen (48)“) |
| Ids on „Übersicht“ and the projects list (§7 regex) | „Stand s…“ | none, all three projects, both widths |
| Entry chunk (gzip) | 211.0 KB in 7 chunks | 209.2 KB in 1 chunk |

The guard's consistency test passes: every badge equals its list (48 queue rows, 29 open
placements on the chain page, 21 items of `group=ask`), „Vorschläge prüfen (48)“ equals the
badge, the three badge lists share no item (holds only in „Offene Fragen“), every model's
„Offene Punkte“ equals its open relations (the lists `/review?model=` opens, queue and held) plus
its open placements plus `askByModel`. The other screens are measured for their slices
(`ANALYZR_UI_LOAD_REPORT`): „Relationen“ 64 controls, 828 words, first row at 440 px (and 429 px
wide at 390, the queue's sideways scroll, UX5); „Offene Fragen“ 231 controls, 3,119 words, first
card at 575 px (1,260 px at 390, UX2b); the chain 61 controls, 483 words, first open placement at
1,153 px (UX6); the model view of `vertrieb/order-handling` 35 controls, 555 words (UX3). Where
the plan left room:

- „Offene Punkte“ of `einkauf/bestellanforderung` is **9** in the walkthrough's state, not 8:
  its open relations are 7 (both copies of the called process, four messages, one trigger), plus
  1 open placement and 1 pool question; the plan's 8 came from the audit stack, where one of those
  relations had been decided. The formula is §2.5's (distinct subjects, the agent's questions add
  nothing); the guard pins 9 with the split „7 Relationen · 1 Platzierung · 1 Frage“, a unit test
  pins §2.5's example 6 + 1 + 1 = 8.
- The badge „Offene Fragen“ counts `totals.ask` from UX1 on (Q3, `openQuestionSummaryQuery`: one
  call with `group=ask`, `limit=1`, whose page also carries `askByModel`), while the tab lists
  every group until UX2b; the guard compares the badge with the API's `group=ask` list.
- „Als Nächstes“ for owners with a token when only failed analyses or expired reservations wait
  and no model waits: „Nochmal versuchen“ is the primary (a requeue alone runs nothing, so it
  requeues and opens „Agent starten“); editors and viewers see the agent rows as lines
  („n Modelle warten auf den Agenten“), editors with „Nochmal versuchen“, viewers as text; a
  navigation primary is a plain link for viewers. A tab badge never shows 0.
- The number in „Offene Punkte“ opened where the work is (`/review?model=`, else the chain, else
  `/open-questions?model=`), so a „9“ opened 7 rows; since the first wave's review it is text
  with its split in a focusable tooltip (§2.5). „–“ for none.
- „Exportieren“ offers the questions as two direct downloads („Zum Lesen (Markdown)“, „Zum
  Ausfüllen (CSV)“, the export route's `ask` default under the old file name) until UX2b's dialog;
  „Bild (SVG)“ opens the chain page with `?export=svg`, which downloads the drawing once it is
  shown (an SVG needs the renderer, which only the chain chunk carries); the downloads come from
  the modules that already own them (the open-questions page, the amendments module), loaded on
  first use; the model list's „Änderungsliste herunterladen“ went into the hub (no second place).
- „Relationen“ opens `/review` and is also the active tab on `/relations`; until UX5 builds the
  views, a link „Alle Relationen“ beside the inbox's tabs leads to the results and „← Zu prüfen“
  back. An active `?stage=` shows as the removable chip „Phase: …“ in the inbox's filters. The
  placements callout and the presets stay until UX5, and so does the view „Kein Zusammenhang“:
  the agents' no-links move behind the foot link „Kein Zusammenhang laut Agent (n)“ only with UX5
  (Q12 answered by decision 26).
- Failed writes: one sentence per `ProblemCode` and eight `reason`s (`rationale-required`,
  `unknown-step`, `unknown-process`, `unknown-ref`, `same-step`, `same-process`,
  `invalid-manifest`, `amendment-not-applicable`); toasts carry the error (`toast({ …, error })`)
  and alerts render `ErrorText`, both with a closed „Technische Details“; inline form errors (note,
  answer sheet, pickers) show the German sentence alone; a taken key in „Neues Projekt“ says „Den
  Kurznamen „…“ gibt es schon. Wähl einen anderen.“ and opens the field.
- The crumb „Projekte“ went (the logo leads there); the upload, agents, rules and findings pages
  name themselves in the crumb. The holder shows without `agent:` („agent-sim · reserviert bis
  22:45“, a time today, else `17.10., 22:45`); the attempts only for a failed analysis.
- The projects list keeps „Angelegt“ until UX9 brings „Zuletzt geändert“ with the summary route;
  the key moved under the name.
- The demo write guard checks the decide labels „Vorschlag prüfen“ and „Auf der Kette prüfen“ on
  buttons and menu items only: the viewer's read link to a placement on the chain has been called
  „Auf der Kette prüfen“ since S4, so UX2a's text check (not run then) failed on the demo.
- The entry chunk is one chunk: a `codeSplitting` group with `tags: ['$initial']` in
  `vite.config.ts` (§3.13 item 8's „groups come first“). UX1's own entry code is about 6 KB gzip
  (217.3 KB with the old splitting); the merge saves about 8 KB.
- Not in UX1: the provenance subtitle of §3.1 item 3 (needs `Model.source`, UX8), the watermark
  check and the model view (UX3), the phone's „Filter (n)“ and the tab's own rework (UX2b). The
  start prompt link points at the repository on GitHub, which answers 404 for others while the
  repository is private (HANDOFF §8 "Going public").

Verified: every gate, the UI load guard at both widths on the three projects and every Playwright
spec against `analyzr-ux1`, `demo.spec.ts` with every menu opened against the demo image
`analyzr-ux1d:dev`, the screenshots retaken (DEVELOPMENT.md "UX1"). Not verified: other browsers
than Chromium (the phone is Chromium's mobile emulation, not Safari on iOS), a screen reader on the
light menus and the tooltip, the owner's walkthrough.

**UX2b "Offene Fragen" (web).** Files: `apps/web/src/routes/project-open-questions-page.tsx`,
`components/open-questions/question-item.tsx`, `model-questions.tsx`, `note-dialog.tsx` (the one
answer place for holds), `lib/open-questions.ts`, `lib/queries.ts` (`openQuestionCountQuery` reads
`totals`); the „Befunde“ tab out (with Q2). Tests: `apps/web/test/open-questions.test.tsx`,
`open-questions-lib.test.ts`, `open-question-answers-lib.test.ts`; `e2e/open-questions.spec.ts`
(1,335 lines, much of it rewritten), `demo.spec.ts`. Done when: the badge equals `totals.ask`; tab
controls 232 → at most 80, words 3,120 → at most 1,000, the first card at most 250 px from the top
(450 px at 390 px); a card has at most 3 actions (disclosures not counted) and on average at most 35
words; no process has two items; a hold is answered in at most 3 clicks through the same dialog
from the card, the „Vorgemerkt“ row and the review screen.

**UX2b as delivered** (2026-10-18, on the branch, every gate green; DEVELOPMENT.md "UX2b"). Web
only, plus one zod-free label in the contracts (`OPEN_QUESTION_STATE_LABELS.answered` reads
„Außerhalb der Landschaft“, the glossary's, which UX2a left for the done card; the export's filter
line follows); no route, server, MCP, procedure or recording change, the client regenerates
without drift. The tab (`routes/project-open-questions-page.tsx`): one intro line with „So
funktioniert es“ closed, the three filters „Art“, „Modell oder Ordner“ and „Ansprechpartner“
(`?kind=&model=&askWho=`; on a phone behind „Filter (n)“; `?source=` a removable chip „Quelle: …“,
`?state=answered` opens „Erledigte zeigen“), the count line „21 zu klären“, „Für den Kunden
exportieren …“ (`components/open-questions/customer-export-dialog.tsx`) and „Antworten aus CSV
übernehmen …“; the cards „Zu klären“ (`question-item.tsx`, `question-actions.tsx`; the view, the
facets, the card's actions and links in `lib/open-questions.ts`), the closed groups „Zur
Information“ and „Erledigte zeigen“, the „Befunde“ link. A hold answers in the note dialog from its
card, its „Vorgemerkt“ row and the review screen (`components/open-questions/hold-answer.tsx`,
loaded lazily by `components/review/held-list.tsx` and `review-details.tsx`) and is decided with
„Jetzt entscheiden“; an agent's question opens its proposal („Vorschlag öffnen“); the inline
decision panels went (`action-panels.tsx`). „Exportieren“ on „Übersicht“ opens the same dialog
(„Fragen für den Kunden (Markdown, CSV) …“). The model view's section is „Fragen (n)“ with
`group=ask`, `state=open`. Measured with the UI load guard on the scratch stack `analyzr-ux2b`
(`nordwind-handel` seeded with its chain and worked by the simulation agent, nothing decided;
`signavio-beispiel` from the bundle import), before = UX1's build served from the same database:

| Budget (done when) | Before (UX1) | After (UX2b) |
|---|---|---|
| Badge „Offene Fragen“ = `totals.ask` | 21, the tab listing 102 items of every group | 21 = the count line „21 zu klären“ = the 21 cards, in the API's order |
| Controls, 1440 px | 231 | 76 (≤ 80): the shell 7, three filters, two buttons, the „Befunde“ link, per card the subject, the primary and „Weitere Aktionen“ |
| Words, 1440 / 390 px | 3,119 / 3,118 | 643 / 540 (≤ 1,000) |
| First card's top, 1440 / 390 px | 575 / 1,260 px | 246 / 362 px (≤ 250 / ≤ 450) |
| Badges (`data-slot=badge`) | 50 | 21 (one kind badge per card) |
| Actions per card | up to four buttons and links plus the refs' locators | at most 2 on `nordwind-handel` (≤ 3; a hold: „Antwort geben“, „Jetzt entscheiden“; an amendment conflict 3) |
| Words per card | – | 22.6 on average, 16 to 32 (≤ 35) |
| No process twice | – | the 21 subjects are distinct |
| A hold answered | a text area in „Vorgemerkt“, nothing on the review screen, „Notiz hinzufügen“ in the tab's menu | 2 clicks from each of the three entries, one dialog (≤ 3; the guard's task on `ui-load-vormerkung`) |
| Ids (§7 regex) | `q-…` and `s252` on every card | none at both widths; none in the default Markdown (without its comments) and CSV (without `id`) |
| `signavio-beispiel`, 1440 px | 45 controls, 881 words, first card at 503 px | 34, 227, 246 px (7 to clarify; 6 descriptive models one line in „Zur Information“) |
| Model view `vertrieb/order-handling`, 1440 px | 35 controls, 555 words | 26, 308 („Fragen“ lists „Zu klären“ only) |
| Customer export | `group=ask` by default (UX2a), two buttons | the dialog: 21 rows by default under `offene-fragen-<p>.csv`, 43 with „Auch Fragen der Agenten (22)“ |
| Entry chunk (gzip) | 209.2 KB | 209.3 KB (three lazy imports: the hold's answer twice, the dialog in the hub) |

Where the plan left room:

- „Warum?“, „So funktioniert es“, „Verlauf“ and the two closed groups are native `<details>`; the
  closed groups render their content only when open. Disclosures are not actions (the plan's card
  rule), and the guard counts nothing inside a closed one.
- The subject is the card's link (the model view at the element, the review screen, the chain at
  the step or placement); the separate „Im Modell zeigen“, „Prüfen“ and „Zur Wertschöpfungskette“
  buttons and the refs list went; in the model view a link to the model itself stays text. A card
  names the process an element lies in („in „Forderungsmanagement““), since UX2a's questions no
  longer name it; no model key on a card.
- „Kennung kopieren“ is the last entry of „Weitere Aktionen“, only where that menu exists anyway
  (no menu for the id alone; viewers have none; the id stays in the export and `analyzr
  questions`).
- A hold's card: „Antwort geben“ (the API's `note`, relabelled) and „Jetzt entscheiden“ (a link to
  the review screen at `?view=held`, so J/K walk the held list, or to the chain at `?placement=`;
  the return to the tab comes with UX5 and UX6). For a hold the dialog says „Antwort geben“,
  „Deine Antwort“, „Antwort speichern“, elsewhere „Notiz hinzufügen“; the note effect text says
  „Jetzt entscheiden“. `hold-answer.tsx` finds the hold's item with `kind=held&state=open`, so a
  note from the row, the review screen, the card and the customer's CSV land on the same item. The
  review screen's hold box shows for every held relation with the question, the hold's note and
  the label (R9); „Antwort ergänzen“ in the decision grid stays UX5, the chain's held card keeps
  its own field until UX6, the held row's „Prüfen“ until UX5.
- „Art“ lists the kinds of the open „Zu klären“ items and, last, „Frage eines Agenten“, which
  switches the cards to `group=agent` („22 Fragen der Agenten“, the primary „Vorschlag öffnen“) and
  the export to the agents' questions. The other filters count the cards the list shows.
- The export dialog starts from its defaults on every opening (Markdown, the server's default and
  the first option; the agents' questions off), shows „Auch Fragen der Agenten (n)“ only when
  there are any under the filters, and sends the list's filters with `group` explicitly (`ask`,
  `ask` and `agent`, or `agent`) and, since the first wave's review, `state=open`: the file holds
  what the list shows, and a marked item is not asked again (the server's file name leaves `open`
  out, since it says „offene“ already); `group=ask` keeps the old file name, the agents'
  questions add the server's `-ask-agent`.
- „Erledigte zeigen (n)“ counts the marked items of the card group under the filters; a link with
  `?state=answered` opens it, `?state=open` is the default.
- „Betrifft auch“ is not shown: on both stacks every ref beyond the subject is named by the
  question or its reason already (a pool's flow ends, the other copy, a relation's ends); the
  export and the API keep the refs.
- Two or more descriptive models with one reason are one line inside „Zur Information“ („6 von 6
  Modellen sind beschreibend (ohne Engine). …“), not above the list, so the first view stays
  short; summaries are one line with „Zusammenfassung des Agenten anzeigen“ closed.
- The latest note shows on the card („Notiz vom 18.10.2026: …“, a hold's „Antwort vom …“);
  „Verlauf (n)“ with every note and withdrawn mark only when there is more than that note.
- Two rows above the cards at 1440 px (the intro line of 20 px, then filters, count and both
  buttons in one row of 28 px), the page 10 px below the tab bar instead of the shell's 24 px
  (`-mt-3.5`): the first card at 246 px. On a phone the buttons wrap below „Filter (n)“.
- The guard's hold task runs on a fourth project, `ui-load-vormerkung` (the corpus without an agent
  and one held key-tier proposal), so `nordwind-handel` stays undecided for the other pins; it
  answers from the card, the „Vorgemerkt“ row and the review screen and checks the three notes on
  the one item.

Verified: every gate, the guard's UX2b budgets and hold task and every Playwright spec against
`analyzr-ux2b`, `demo.spec.ts` against `analyzr-ux2bd:dev` (DEVELOPMENT.md "UX2b"). Not verified:
a customer's round trip of the exported CSV through a spreadsheet program and back through
„Antworten aus CSV übernehmen …“ (only with sheets the tests write), other browsers than Chromium,
the owner's walkthrough.

**First wave review round** (2026-10-18, on the branch; DEVELOPMENT.md "First wave review
round"). A user-need, a correctness and a live-run-neutrality review of UX2a, UX1 and UX2b; each
finding verified, then fixed with the least UI that holds, or recorded here. Live-run neutral as
before: no change to facts, the rule tier, claim inputs, procedures, MCP or recordings.

- **One item per gap** (server read model, `mergeCodedNoLinks` in `read-model.ts`): an agent's
  coded no-link joins the rule tier's item that asks the same (a `call-target` no-link the
  finding on its call, a `collaboration` no-link the `black-box-partner` item whose flows end at
  its endpoint), its reasons attributed in the survivor's `detail` („Laut Agent: …“), the notes
  and withdrawn marks recorded under it shown among the survivor's answers; a no-link item with a
  live outside mark stays its own (answered) item. The badge no longer counts one gap twice
  (the integration pin after the probe agent: 28 → 26).
- **API labels:** a primary link always reads „Verknüpfen mit …“; „Nur verknüpfen …“ only beside a
  primary amendment.
- **The customer export:** the dialog sends `state=open` (the file holds what the list shows);
  the Markdown's headline counts open and settled items apart, its groups name step owners, then
  lanes, never the folder, answers carry dates without handles (a hold's notes as „Antwort“, its
  own note as „Notiz zur Vormerkung“), and an agent's verbatim reason is attributed („Laut Agent:
  …“, the contracts' `isVerbatimSource`, also in the CSV's „Frage“); the dialog's description
  lost „in einfachem Deutsch und ohne Kennungen“ and the Markdown hint.
- **Holds:** once a hold has its answer, „Jetzt entscheiden“ leads and „Antwort ergänzen“ sits
  beside it (the button keeps the focus the dialog gives back); the review screen's hold box
  shows the latest answer („Antwort vom …“); the dialog, the toast, the card and „Verlauf“ say
  „Antwort“ throughout, „mögliche Relation“ never „Paar“, and name the decision without a control
  („Die Vormerkung bleibt, bis du sie entscheidest.“); a held relation without an open item (an
  end missing) is answered on the relation itself; a hold card names both processes of its
  relation („in „Bestellanforderung“ → „Lieferantenanlage““).
- **„Offene Punkte“** is text with a tooltip (§2.5), counts held placements, and says „1 offener
  Punkt“; „Übersicht“ of `nordwind-handel` drops from 75 to 44 controls (379 / 314 words at 1440
  / 390 px), `signavio-beispiel` from 23 to 19.
- **The model view** loads `ask`, `agent` and `info` for the model: the cards stay „Zu klären“,
  one link „Fragen der Agenten zu Vorschlägen (n)“ leads to their list until UX3 shows them on the
  relation cards, the agent's summary sits closed under „Zur Information“ (decision 24.8); on
  `vertrieb/order-handling` 26 → 27 controls, 308 → 317 words.
- **Smaller fixes:** the phone's tab row scrolls the active tab into view and fades at its edge
  while more lies to the right; the light menus are as wide as their widest entry; the „Agent
  starten“ popover wraps its commands and names the chain when there is one; „Nochmal versuchen“
  closes its popover on a second click instead of requeueing again, and editors get a plain
  button; „Neues Projekt“ shows the key field when the name derives no key; both openings of the
  customer export give the focus back; a failed import batch keeps the server's reason behind
  „Technische Details“; „Alle Befunde der Modelle als Liste (n)“ also on an empty list; the amend
  summary and the chain header name „Relationen“ (the chain header's duplicate „Modelle“ went;
  UX6 folds the rest into the shared canvas header).
- **The guard** checks that the active tab lies inside the row on a phone, that every entry of
  „Exportieren“ fits its menu, the hold's answer on the review screen, and „Offene Punkte“ as the
  sum of its parts; „Gutschrift“ on a phone counts as opened, not found, until UX3 (a `fixme` with
  UX3's done-when: the model name answers `elementFromPoint`, the canvas covers ≥ 55 %).
- **Docs:** M3-LIVE-RUNS says to ignore „Als Nächstes“ in a run project (steps 4 and 6a); CONCEPT
  §5's row for the open questions names `group`, `totals`, `askByModel` and the export's default;
  M6 §1.1 steps 8 and 9 follow decision 26; DEVELOPMENT.md's demo, inbox, pipeline and plain-text
  passages follow UX1; HANDOFF's decision 26 amends 24.8 (not 24.9).

**First wave, final pass** (2026-10-18, on the branch; DEVELOPMENT.md "UI simplification first
wave (2026-10-18)"). A separate pass over the whole first wave after the review round: every gate
green, `git diff --stat eval/reports` empty, the MCP snapshots unchanged; the UI load guard (both
widths, the three projects, the hold task on `ui-load-vormerkung`) and every other spec against a
fresh scratch stack `analyzr-uxf` (83 passed; ui-load 11 plus 3 `fixme`), `screenshots.spec.ts`
against a freshly seeded `analyzr-uxs`, `demo.spec.ts` (14 passed, every menu opened) and
`analyzr-demo check` against the demo image `analyzr-uxdemo:dev`; every screenshot of §7's list
retaken (`01` … `07`, `m2-*`, `d19-*`, `m4-*`, `demo-*`). One fix: `screenshots.spec.ts` waits for
the badge „Offene Fragen“ before `02-models` (on a fresh stack the open questions answer last).
After the pass, the lead agent added a loading state: until relations, chain and open questions
have settled (also with an error, whose part then counts as 0), „Als Nächstes“ shows a placeholder
and „Offene Punkte“ a skeleton instead of lower numbers that jump (`ProjectWork.ready`,
`lib/project-counts.ts`; `overview.test.tsx`); the UI load guard passed again on a scratch stack
(15 passed, 3 `fixme`).
The first wave in numbers, before = the web before UX1:

| Screen, 1440x900 (390x844) | Before | After the first wave |
|---|---|---|
| Tab bar | 9 tabs, 6 counts, 2 rows (4 rows, 189 px) | 4 tabs, 3 badges, 1 row (1 scrolling row ≤ 48 px) |
| „Übersicht“ `nordwind-handel` | 43 controls, 400 words, 62 badges, no next step | 44 controls, 379 (314) words, 31 badges, the primary at 224 (224) px |
| „Übersicht“ `signavio-beispiel` | 18 controls, 122 words | 19 controls, 95 (80) words |
| „Übersicht“, empty project | 13 controls, 56 words, 5 zero counts | 9 controls, 37 words, no badge |
| „Offene Fragen“ `nordwind-handel` | 231 controls, 3,119 words, 50 badges, first card at 575 (1,260) px | 76 (74) controls, 643 (540) words, 21 badges, first card at 246 (362) px |
| „Offene Fragen“ `signavio-beispiel` | 45 controls, 881 words, first card at 503 px | 34 controls, 227 words, 246 px |
| Model view `vertrieb/order-handling` | 35 controls, 555 words | 27 controls, 317 words (UX3 next) |
| Chain | 61 controls, 483 words (UX1's build) | 60 controls, 482 words (UX6 next) |
| First relation decision from the project | 2 clicks | 1 click |
| A hold answered | no place on the review screen | 2 clicks from each of three entries, one dialog |
| Entry chunk (gzip) | 211.0 KB in 7 chunks | 209.8 KB in 1 |

Not verified: other browsers than Chromium and a real phone, a screen reader, the export in a
spreadsheet program, CI (no e2e job).

**Owner walkthrough** (2026-10-18, on `analyzr-local` rebuilt to the branch). The owner: „finde,
das geht in eine gute Richtung. bei den Fragen würde ich leichter ins Modell einsteigen wollen...
nicht ganz klar, dass man da auf den Namen klicken muss. Sonst kannst du weitermachen“. One
finding, fixed on the branch the same day: a „Zu klären“ card names its subject as text and opens
it with a labelled button at the header's end (`viewLink` in `lib/open-questions.ts`, `ViewButton`
in `question-item.tsx`): „Im Modell zeigen“ (an element of another model), „Im Diagramm zeigen“
(one of the model in view, in the model view's „Fragen“), „Modell öffnen“, „In der Kette zeigen“,
„Relation ansehen“. It is left out where it would lead nowhere new: the model in view without an
element, and the place a reviewer's visible link action opens already (a hold's „Jetzt
entscheiden“, an agent proposal's „Vorschlag öffnen“, „Auf der Kette prüfen“ on a step); viewers
keep it on every card. The one-line items (done, „Zur Information“) keep the name as a link, now
in link colour. One control per card as before, so „Offene Fragen“ stays within UX2b's budget.
The rest goes on in the proposed order (Q10): UX7 → UX8 → S2b → UX3 → UX4 → UX5 → UX6 → UX9,
alongside S2c and S3c.

**UX3 "Model view".** Files: new `components/canvas-panel.tsx`, `canvas-header.tsx`;
`routes/model-view.tsx`, `components/open-questions/model-questions.tsx`, `subprocess-link.tsx`,
`components/amendments/model-amendments.tsx`, `bpmn-canvas.tsx` (legend, `canvas.resized()`). Tests:
`test/amendments.test.tsx`, `open-questions.test.tsx`; `e2e/amendments.spec.ts`,
`open-questions.spec.ts`, `smoke.spec.ts` (model view), `demo.spec.ts`, `value-chain.spec.ts` (the
CSS check's probes stay meaningful), `screenshots.spec.ts` (04, demo-02, demo-07). Done when: on
`vertrieb/order-handling` at 1440x900 the first question is visible without scrolling the panel
(today 1,275 px down); panel controls 37 → at most 25, words 515 → at most 300; a selected element
filters both tabs; at 390x844, measured against job 5 (find, open, show), the model name is visible,
the canvas covers at least 55 % of the viewport and the sheet is collapsed; the header shows at most
three chips and „Mehr“; the watermark check passes (README's rule); the panel API covers the review
screen and the chain on paper.

**UX3 as delivered** (2026-10-18, on the branch, every gate green; DEVELOPMENT.md "UX3"). Web
only, live-run neutral. The canvas pages' shared parts: `components/canvas-panel.tsx`
(`CanvasPanel`: from 1024 px, `lib/media.ts` `CANVAS_WIDE`, the aside at the right; below it a
bottom sheet collapsed to its handle „Fragen 3 · Relationen 7“, expanded the handle names the
panel; the handle a button with `aria-expanded` and `aria-controls`, the collapsed content `inert`,
Escape collapses, expanding moves the focus into the content, the height change off under
`prefers-reduced-motion`; `PanelTabs` and `PanelTabPanel`, a light tablist with the arrow keys,
Home and End, no Radix in the entry), `lib/canvas-sheet.ts` (`useCanvasSheet`: the canvas
container's bottom inset, the handle's height collapsed and the sheet's 60dvh expanded, so the
sheet never overlays the canvas and the watermark moves up with the container; `bpmn-canvas.tsx`
calls bpmn-js `canvas.resized()` from a ResizeObserver) and `components/canvas-header.tsx`
(`CanvasHeader`: from 1024 px a card with the crumb „<Projekt> › Übersicht“, the title, a small
subtitle, at most three chips and „Mehr“; below it a top bar with „‹ Übersicht“, the title, „Mehr“
and the first chip). The model view (`routes/model-view.tsx`): the model's name as the title, its
key small below; the chips stage, „In analyzr ergänzt (n) · aus r1“ and the derived chip (the
badge „N Ergänzungen nicht mehr anwendbar“ went: its conflicts are questions under „Fragen“);
„Mehr“ (`ModelMore`, in the amendments chunk: „Herkunft …“ and „Revisionen (n) …“ as dialogs, „In
Signavio öffnen“, „BPMN herunterladen“, „Original herunterladen“, „Fürs Quellsystem“ with the change
list, the line „<Engine> · Kopfrevision rN“); the tabs „Fragen“ (the model's `ask` items, the
collection's bar, „Ergänzen“ only for fields no open question of the element covers, „Verknüpfen
mit …“ on a collapsed subprocess) and „Relationen“, both counted; the panel opens on „Fragen“ when
there are questions or the selected element offers „Ergänzen“ or „Verknüpfen mit …“, else (and for
a selected relation) on „Relationen“, settled once per selection, so answering the last question
does not flip the tab; a selected element filters both tabs, its label in the panel header with
„Alle zeigen“; the section „Befunde“ went (the canvas marker stays); the relation cards in two
lines (type icon, element, status; the arrow with the other end's name and key; the confidence on
a proposal only; „Aufruf, ausgehend: …“ as the accessible name; the tier left for the review
screen); the legend at the bottom left until the first click on an element, then behind an info
button next to the zoom controls (`LightPopover`). `collapsedSubprocess` moved to
`lib/collapsed-subprocess.ts` (the pickers re-export it), so the entry tells the tab without loading
the pickers. Entry chunk 219.8 KB gzip (218.1 before, within +3 KB). The panel API against the
other two pages, on paper: the review screen (UX5) passes the relation's name as `summary` and its
decisions as children; J/K/A/R/H/C stay window-level shortcuts, so they work while the sheet is
collapsed; its previous and next need a slot beside the handle, which as a button cannot hold
buttons (a prop for it comes with UX5). The chain page (UX6) passes its edit panel as children and
takes its `INSET` from `useCanvasSheet`'s inset. Measured with the UI load guard on the scratch
stack `analyzr-ux3` (`nordwind-handel` after the simulation agent):

| Done when | Before | After (UX3) |
|---|---|---|
| First question, `vertrieb/order-handling` at 1440x900 | 1,275 px down the panel | ends inside the panel, no scrolling |
| The panel's controls, words | 37, 515 | 10, 75 (≤ 25, ≤ 300) |
| The whole view | 35 controls, 555 words (28, 324 after UX8) | 18, 196 |
| A selected element | filters the relations | filters both tabs, „Alle zeigen“ |
| „Gutschrift“ at 390x844 | the panel covers the header and the canvas | the name in the top bar answers `elementFromPoint`, the sheet collapsed, the canvas 86 % of the screen (≥ 55 %) |
| Header | „← Relationen“ and „Modelle“; „Herunterladen“, „Revisionen“ and „Herkunft“ beside the chips | the crumb, at most three chips and „Mehr“ |
| bpmn.io watermark | visible only by painting over the panel's corner | answers `elementFromPoint` at 390 (sheet collapsed and expanded), 800, 1024 and 1440 px |

Not verified: other browsers than Chromium, a real phone, a screen reader.

**UX4 "Question actions".** Files: `components/open-questions/action-panels.tsx`, `amend-panel.tsx`,
`question-actions.tsx`, `note-dialog.tsx`, `use-note-dialog.ts`; `components/amendments/amend-form.tsx`,
`amend-summary.tsx`, `collect-bar.tsx` (deleted); `lib/open-question-pickers.ts`,
`open-question-answers.ts`, `amendments.ts`, `generic-names.ts`. Tests:
`test/open-question-actions.test.tsx`, `amendments.test.tsx`, `open-question-pickers-lib.test.ts`,
`open-question-answers-lib.test.ts` (each note text case), `decision-panel.test.tsx`;
`e2e/amendments.spec.ts`, `open-questions.spec.ts`, `demo.spec.ts` („Sammeln“, „Weitere Aktionen“);
the CLI's label tests if UX2a's labels move again; the bundle guard (it names „Sammeln“). Done when:
setting the call target of „Forderung an Inkasso übergeben“ takes 3 clicks and lists „Inkasso“
under „Passt vermutlich“; the checkbox sends exactly one action (only `amend` when checked, only
`link` when unchecked; a 412 on the amendment leaves no link); no „Sammeln“ in `src`; the 22
note-only cards show a ghost button instead of a menu; the note dialog's effect text matches the
item's actions. The return path from the review screen and the chain is built in UX5 and UX6; until
then a hold's „Jetzt entscheiden“ opens them without the return.

**UX4 as delivered** (2026-10-18, on the branch, every gate green; DEVELOPMENT.md "UX4"). Web
only, live-run neutral; the API keeps `link` and `amend` with their labels (the CLI prints them),
the web joins them. Item 1: `cardActions` (`lib/open-questions.ts`, `linkWithAmend`) makes a
call's single-target link and its `call-target` amendment, or an endpoint's link and its
`message-name` amendment, one entry „Ziel wählen …“ or „Partner wählen …“, primary when either
was; `LinkPanel` shows, after the pick and for editors and owners, „Im Modell eintragen (statt
nur zu verknüpfen)“, checked where the amendment led; checked it sends only the amendment (a
call target the landscape's processes offer; for an endpoint the partner's name with the
partner, which pairs both; a whole process or a nameless partner can only be linked, the box
disabled with the reason), unchecked only the link. Item 2: `processChoices` and
`endpointChoices` rank „Vorgeschlagen“, then up to three best fits under „Passt vermutlich“
(`bestFits`, `nameFit`, `fitWords` in `lib/generic-names.ts`: the hint words without stop,
generic and technical words, a whole word counting twice), then the rest by name, not by model
key; the hints are the subject's label, its unresolved value and its name (`subjectHints`); the
amend form's call target and the collapsed subprocess's „Verknüpfen mit …“ rank the same way;
rows „Name – Modell“, the ref in the tooltip. Item 3: „Sammeln“, its bar, the mark „gesammelt“,
the toast, the hint and the leave-page guard are gone (`collect-bar.tsx` deleted). Item 4:
`useAmendDraft` (`lib/amendments.ts`) runs the dry run by itself once the values have settled
for 400 ms; „Danach: …“ (`effectSentence`, the cost its own sentence, `rejudgeText`: „Die
Agenten beurteilen 15 mögliche Relationen neu, sobald du den Agenten startest.“, also after a
withdrawal) stands above the one „Speichern“, which asks again („Trotzdem speichern“) only when
an agent holds the model's task; a field names itself once (the legend keeps the element, a
call target its field); the import hint behind „Und beim nächsten Import?“; the toast after the
save offers the owner „Agent starten“, which the root's `AgentStartHost` shows (a toast cannot
anchor a popover), or „Agent verbinden“. Item 5: the note of link, place, choose-copy and the
subprocess link behind „+ Notiz“ (only an opened note is sent). Item 6: the copies by their
model's path, the shared process id behind „Technische Angaben“, the CLI hint gone. Item 7: a menu
of the note alone is the ghost button „Notiz“ (no „Kennung kopieren“ on those cards; `analyzr
questions` lists the ids). Item 8: an item about neither a relation nor a placement says „Die
Notiz bleibt bei der Frage und geht mit in den Export.“ with whether its action ends it, and with
an amendment „Fehlt ein Wert im Modell? Trag ihn mit „Ziel wählen …“ ein.“ (the entry as the card
names it); the save buttons read „Notiz speichern (nicht änderbar)“ and „Antwort speichern (nicht
änderbar)“ (also the hold's answer on the relation), the sentence about it went. Measured with the
UI load guard on the scratch stack `analyzr-ux4`:

| Done when | Before | After (UX4) |
|---|---|---|
| Call target of „Forderung an Inkasso übergeben“ | 4–5 clicks, two pickers | 3 clicks (entry, pick, „Verknüpfen“ or, checked, „Speichern“); `nordwind-handel` has no process „Inkasso“, so the guard adds one in a project of its own, listed first under „Passt vermutlich“ |
| Exactly one action sent | link and amendment side by side | only `amend` when checked, only `link` when unchecked; a 412 on the dry run sends nothing |
| „Sammeln“ in `src` | bar, mark, hint, guard | none |
| Note-only cards | a menu with one entry | the ghost button „Notiz“ (1 of the 21 „Zu klären“ cards on `nordwind-handel` today) |
| Note dialog | „ergänze es im Quellwerkzeug …“ | per case, pinned in `open-question-answers-lib.test.ts` |

The return path from the review screen and the chain stays with UX5 and UX6. Not verified: other
browsers than Chromium, a real phone, a screen reader.

**UX5 "Relationen and the review screen".** Files: `routes/project-review.tsx`,
`routes/project-relations.tsx` (the views), `routes/review.tsx` (search validation of `from`, the
return path), `components/review/` `queue-table.tsx`, `review-details.tsx`, `provenance.tsx`,
`timeline.tsx`, `held-list.tsx`, `decision-forms.tsx`, `bulk-accept-dialog.tsx`, `no-link-list.tsx`;
`components/auto-accept-mark.tsx`, `rules/auto-accept-provenance.tsx`; `lib/labels.ts` (`TIERS`),
`lib/review.ts`. Tests: `test/review-inbox.test.tsx`, `review-screen.test.tsx`,
`review-details.test.tsx`, `held-list.test.tsx`, `bulk-accept-dialog.test.tsx`,
`auto-accept-marks.test.tsx`, `relation-table.test.tsx`; `e2e/review.spec.ts`, `pipeline.spec.ts`,
`auto-accept.spec.ts`, `demo.spec.ts` („annehmen…“, „Kein Zusammenhang“, the row link),
`value-chain.spec.ts` (CSS check), `screenshots.spec.ts` (m2-*, d19-*, demo-03, demo-04, demo-06).
Docs: M3-LIVE-RUNS step 7; HANDOFF §8 "Shared-name flag". Done when: the first proposal is at most
360 px from the top (today ~620); at most 1 control per queue row and at most 12 outside the rows,
each row with one focusable link; no truncated model name in the queue at 1440 px on seeded
`nordwind-handel`; words 768 → at most 450; `scrollWidth` 390 at 390 px; the bulk action's count
equals its default selection; the review panel of `rel_01M55S1R592D1325Y852QD0EMD` has at most 110
words with „Verlauf“ closed; at 390 px the back link and ‹ › answer `elementFromPoint`; the
watermark check passes.

**UX5 step 1 as delivered** (2026-10-18, on the branch, every gate green; DEVELOPMENT.md "UX5 step
1"). „Relationen“ and its views, §3.6 and §3.10 item 1, with Q7 (owner decision 26 (6)); the review
screen, the auto-accept mark (Q6) and the screenshots are step 2. Web only, live-run neutral. The
views (`components/review/relation-views.tsx`): „Zu prüfen (n)“ and „Vorgemerkt“ on `/review`,
„Gilt“, „Abgelehnt“, „Automatisch angenommen“ (only above 0, with the ledger) and „Alle“ on
`/relations` (`RELATION_PRESETS` gone); the model filter stays across them. „Zu prüfen“
(`routes/project-review.tsx`): the placements callout went; a status line only when something
needs an action (`lib/pipeline-state.ts`, „Übersicht“ reads the same); one row with „Vorschläge
prüfen (n)“ at the first item, „n unauffällige annehmen …“ beside it and the filters „Grundlage“
and „Modell“ at the right (their labels for screen readers; shown while there is something to
filter or one to lift); the queue (`QueueList`, `sideName` and `elementsText` in `lib/review.ts`)
leads with the processes, names the element once (twice where the names differ beyond umlaut
spelling, `nameKey`), the type as the icon's label, the confidence, the hints at the right, the
agent only when several propose; one link per row and a row click, a card on a phone; the foot
link „Kein Zusammenhang laut Agent (n)“ to the no-links, grouped by model and closed, with „‹ Zu
prüfen“ back. Bulk accept (Q7): the key tier only (`bulkRows`), its button counts the unflagged
pairs once every model's facts are there (before, the count could shrink while the flags loaded),
the dialog selects exactly them and lists the flagged ones under the closed „Genauer ansehen (n)“
with one flag line (`GenericFlag.short`, `flagLine`) and „Vorschlag öffnen“; the lexical bulk is
gone; afterwards an owner's toast offers „Annahmeregel anlegen“ (`/rules?new=key`, the dialog
prefilled „Gleicher Name ab 100 %“, `RuleDraft`). „Vorgemerkt“: the sentence above the list and
„Jetzt entscheiden“. The glossary's tier names (`TIERS`: „Eindeutiger Aufruf“, „Gleicher Name“,
„Ähnlicher Name“, „Gleiche Bedeutung“, „Von Hand“; „Grundlage“ for „Stufe“ in the filters, the
rule dialog, the review panel and the rule history). Measured with the UI load guard on the scratch
stack `analyzr-ux5` (`nordwind-handel` after the simulation agent, 48 rows; the audit counted 42):

| Done when | Before | After (UX5 step 1) |
|---|---|---|
| First proposal from the top, 1440x900 | ~620 px (440 px after UX1) | 297 px |
| Controls per row, besides the rows | 2 per row („Prüfen“), the filters and three bulk buttons | 1 (its link); 10 besides (≤ 12) |
| Words | 768 at 42 rows | 496 at 48 rows, about 446 at 42 (≤ 450 at 42) |
| Truncated names at 1440 px | „finanzen/gutschrift · Gutschrift e…“ | none |
| 390x844 | 429 px wide (sideways scroll) | 390 px, the rows as cards |
| Bulk count | „Schlüssel: 29 annehmen…“ selecting 8 | „11 unauffällige annehmen …“ selecting 11 |

Not verified: other browsers than Chromium, a real phone, a screen reader.

**UX5 step 2 as delivered** (2026-10-18, on the branch, every gate green; DEVELOPMENT.md "UX5 step
2"). §3.7 and Q6 (owner decision 26 (5)); web only, live-run neutral. The review screen
(`routes/review.tsx`) uses the canvas pages' panel (`CanvasPanel`, now with a pinned `footer` for
the decisions and the `wide` size of 440 px, as UX3 designed it): below 1024 px a sheet collapsed to
„Von → Nach · Konfidenz“, the header a top bar above it with the way back, the position, ‹ › and
„Von“ / „Nach“, the canvas ending above the sheet, a decision's form (R, H, C) expanding it
(`DecisionPanel.onFormOpen`; J/K/A work while collapsed); from 1024 px both panes, stacked up to
1279 and side by side from 1280; the pane chip with „Von“ or „Nach“, the process name and „Im
Modell“, key, engine and stage behind its info button. The panel (`review-details.tsx`): type,
status, endpoint state, both ends, confidence (the tier went to „Verlauf“), the agent's question,
the no-links, the held relation's box read-only, „Begründung“, „Belege“ by element name, and one
closed „Verlauf (n)“ instead of „Herkunft“ and „Verlauf“: the timeline (`AssertionTimeline` with
`brief` for the entries shown above, `technical={false}`; „Gleicher Name erkannt (analyzr)“, „Vom
Agenten vorgeschlagen“, no „maßgeblich“), the auto-acceptance's details and its revoke, and
„Technische Angaben“ (id and version, client, procedure, model). On a held relation „Antwort geben“
or „Antwort ergänzen“ (the note dialog of „Offene Fragen“) takes the place of „Vormerken“ in the
decision grid; „Vormerken“ asks for the note, its question and label behind „Frage oder Label
ergänzen“ (`HOLD_HINT` gone). The way back: `?from=open-questions` (validated) from the tab's
„Jetzt entscheiden“ leads the back link and the end of the list to „Offene Fragen“ (the model view
keeps the list's way; the chain's return is UX6). Keyboard hints on the four buttons and „J K
weiter, zurück“ only, none on touch (`Kbd` hides under `(hover: none)`). Q6: `AutoAcceptMark` is the
status badge „Automatisch angenommen“ (its tooltip the rule, revision and agent) instead of
„Angenommen“ plus the box, in the relations table, the review screen, the chain's cards and the
step view; a revoked item one line „Automatische Annahme widerrufen“; confidences as
`formatConfidence` („97 %“, not „mit 0,97“). Measured with the UI load guard on the scratch stack
`analyzr-ux5b`:

| Done when | Before | After (UX5 step 2) |
|---|---|---|
| Review panel of an agent proposal, „Verlauf“ closed | 201 words | 93 words (≤ 110) |
| 390x844: the way back and ‹ › | covered by the panel (`elementFromPoint` hit the aside) | on top, each answers `elementFromPoint`; the sheet collapsed |
| bpmn.io watermark | visible only by painting over the panel's corner | every pane's answers `elementFromPoint` at 390 (both sheet states), 800, 1024 and 1440 px |
| 1024–1279 px | one pane at a time | both, stacked |
| Auto-accepted item | „Angenommen“ plus a four-line badge or box | one badge „Automatisch angenommen“, the rule in „Verlauf“ |

Not verified: other browsers than Chromium, a real phone, a screen reader.

**UX6 "Wertschöpfungskette".** Files: `routes/value-chain-page.tsx`, `routes/value-chain.tsx`
(search validation, the return path), `value-chain-step-page.tsx`; `components/value-chain/`
`chain-overview.tsx`, `step-panel.tsx`, `placement-card.tsx`, `placement-decision-panel.tsx`,
`unplaced-list.tsx`, `unsure-list.tsx` (merged), `link-editor.tsx`, `correct-step-dialog.tsx`,
`manual-placement-form.tsx`, `empty-chain.tsx`, `canvas/overlays.ts`, `canvas/chain-canvas.tsx`;
`index.css`; `lib/labels.ts` (`CHAIN_STAGES`). Tests: `test/value-chain-page.test.tsx`,
`placement-decision-panel.test.tsx`, `step-view.test.tsx`, `link-editor.test.tsx`,
`chain-canvas.test.tsx`, `chain-save.test.tsx`; `e2e/value-chain.spec.ts`,
`value-chain-agent.spec.ts` („Agent unsicher“), `value-chain-draft.spec.ts`,
`value-chain-import.spec.ts`, `demo.spec.ts` (`chain-stage`, `step-tree-item`), `screenshots.spec.ts`
(demo-05, d19-09) and the m4-* screenshots from the value-chain specs; the bundle guard's chain-only
budget (40 KB). Docs: M3-LIVE-RUNS step 6a. Done when: „Platzierungen prüfen (29)“ is visible at
1440x900 without scrolling; panel words at first view 319 → at most 150, controls 84 → at most 40;
header 8 → 4 controls; card 8 → 6; „nichts angenommen“ 12 → 4 on seeded `nordwind-handel`; the
selected step's computed stroke width is 4 px; at 390 px the project link answers
`elementFromPoint`.

**UX6 step 1 as delivered** (2026-10-19, on the branch, every gate green; DEVELOPMENT.md "UX6 step
1"). §3.8 items 1–5 and 10–14, the step view and „Als Liste öffnen“ of item 8 and the edit mode's
overview of item 7; web only, live-run neutral. The panel without a selection
(`chain-overview.tsx`): the status line „0 von 32 Prozessen platziert · 29 Vorschläge offen“
(`chainCoverage`: a process with an accepted or held placement on a live step or outside the chain
among every process the chain knows), „Platzierungen prüfen (29)“ (= J) at the top, the stage only
when it asks for something, „Zu prüfen (29)“ (the first 8 rows, „Alle 29 zeigen“; „erneut prüfen“
the only marker), „Ohne Schritt (3)“ (`unplacedItems`; `unsure-list.tsx` went), „Link nicht
auflösbar (n)“ only when such a link exists (the summary's numbers and the 44 gap rows went), the
step tree closed with its top-level rows collapsed and roll-ups (`subtreeCounts`; ArrowRight opens,
ArrowLeft closes, a chevron by pointer; it opens to give the focus back), then „Außerhalb der
Kette“, removed steps (without the per-card hint) and the owners' filter. In edit mode the overview
is the chain's name and the hint; the warning about removed steps went. On the canvas „nichts
angenommen“ shows only where the step's subtree holds no open proposal or hold (`pendingSteps`,
12 → 4), and the legend is one line. The card (`placement-card.tsx`): the model path, a status only
when it is not a plain proposal, one closed „Details“ (tier, „Vorgeschlagen von Agent „agent-sim“
· …“, the evidence by element and step name through the page's `resolve`, the timeline brief and
without „maßgeblich“, „Technische Angaben“ in the shared `components/technical-details.tsx`, which
the review panel uses too), „Im Modell“ and the four decisions; a held card shows its note and
answers read-only and answers through the note dialog of „Offene Fragen“ in place of „Vormerken“
(`HoldAnswer`, lazy; a hold without an open question takes a note on the placement). The header
(`chain-header.tsx` on `CanvasHeader`, which takes no `area` for it): „‹ Nordwind Handel GmbH“, the
name with the revision behind a disclosure, the chip „3 Prozesse ohne Schritt“ (it scrolls the
panel to the list), „Bearbeiten“, „Exportieren“; the edit toolbar below. Forms and labels as items
11 and 12 (the correction note prefilled by the pick, `correctionNote`); the step panel, the step
view and the empty chain as items 10, 8 and 14. Deviations: the logo stays off the chain's header
(item 5's „‹ Nordwind Handel GmbH“ only), so the count is 4 besides the chip, which item 2 keeps;
the agent's doubts lead „Ohne Schritt“ (they wait for a human, the others may not have been judged
yet); „Wartet auf den Agenten · Agent starten“ is a fourth actionable stage (a queued task waits
for someone to start the agent), and „fällig · Agent starten“ keeps one button whose popover stays
open while the line moves on (`RetryAgent` with `chain` and `requeue`). Measured with the UI load
guard on the scratch stack `analyzr-ux6` (`nordwind-handel` as the guard seeds it, after the
simulation agent; controls counted with the disclosures' `summary`):

| Done when | Before | After (UX6 step 1) |
|---|---|---|
| „Platzierungen prüfen (29)“ at 1440x900 | none; reviews below the fold | at the panel's top, in view, nothing scrolled |
| The panel at first view: words, controls | 319, 84 | 75, 20 (≤ 150, ≤ 40) |
| Header controls | 8 | 4 besides the chip „3 Prozesse ohne Schritt“ |
| Card controls | 8 | 6 („Details“, „Im Modell“, four decisions) |
| „nichts angenommen“ on the canvas | 12 | 4 |

Next (step 2): the phone sheet, the selected step's outline and the overlays' scale, the panel
toggle, `INSET.left` in edit mode, the double-click in place, the return to „Offene Fragen“, the
phone's checks. Not verified: other browsers than Chromium, a real phone, a screen reader.

**UX6 step 2 as delivered** (2026-10-19, on the branch, every gate green; DEVELOPMENT.md "UX6 step
2"). §3.8 items 6–9 and the return of §3.3; web only, live-run neutral. The panel is the canvas
pages' `CanvasPanel` (`wide`, 440 px) with `useCanvasSheet`: below 1024 px a sheet collapsed to „29
offen“ (a selected step's name) under the shared header's top bar, a decision's form expanding it
(`onFormOpen` through the cards), the queue's ‹ › its footer; from 1024 px an aside that „Details
ausblenden“ in the zoom group hides, the canvas taking its room. The canvas container ends above
the sheet and beside the aside; a `ResizeObserver` calls diagram-js' `resized()` on a real size
change. The selected step's outline is 4 px (`!important` over the renderer's inline 2 px), the
overlay labels scale with the zoom up to 100 % (`scale: { min: 0.4, max: 1 }`), and the fit leaves
80 px for the palette in edit mode. A double-click on a step without a process link selects it and
zooms in place (`focusElement`: at least 100 %, at most 150 %, centred); a linked step still opens
its model; the link editor says „Ohne Link zoomt der Doppelklick auf den Schritt.“ The way back:
the tab's chain links („Jetzt entscheiden“ on a held placement, „Auf der Kette prüfen“, „Link
korrigieren“) carry `?from=open-questions` (validated); the header's crumb then reads
„<Projekt> › Offene Fragen“ („‹ Offene Fragen“ on a phone), J/K keep it, and a decision leads back
to the tab. Deviation: on a phone the header offers no „Bearbeiten“ and „Exportieren“ as an icon
(view-first, P8; the modeler is not made for touch). Measured with the UI load guard on
`analyzr-ux6b`:

| Done when | Before | After (UX6 step 2) |
|---|---|---|
| The selected step's computed stroke width | 2 px (the class lost to the inline style) | 4 px |
| 390x844: the project link | covered by the panel | on top, answers `elementFromPoint`; the sheet collapsed to „29 offen“ |
| 390x844: the canvas | under the panel | above the sheet, more than 55 % of the screen |
| A step without a link, double-clicked | the step view (a page change) | selected and zoomed in place |

Not verified: other browsers than Chromium, a real phone, a screen reader.

**UX7 "Hochladen and Agent verbinden".** Files: `components/upload-panel.tsx`, `lib/upload.ts`,
`components/connect-agent.tsx`, `lib/agent-config.ts`; `packages/bpmn-facts/src/input.ts` and
`errors.ts` (the structured `reason`; facts unchanged), the problem's `reason` in contracts and the
server's mapping. Tests: `test/upload-panel.test.tsx` („Import abgeschlossen“), `test/lib.test.ts`
(`warningLabel`), `connect-agent.test.tsx`, `integrate-bundle.test.ts`, the bpmn-facts input tests,
the contracts problem test; `e2e/smoke.spec.ts` (upload), `screenshots.spec.ts` (06, 07). The
integrate plugin is untouched (its skill's „N Hinweise“ stays true). Done when: for the raw
Signavio fixture (`tools/integrate/test/fixtures/signavio/2026-10-14-signavio`) the headline reads
„5 Modelle importiert · 1 Fehler · 1 übersprungen“, „Bonitätsprüfung.bpmn“ shows one grouped entry
naming 2 elements (9 lines today), the UTF-16 error is German with its remedy, and the next-step box
names the same waiting tasks as `formatNextSteps`; upload words before an import 71 → at most 45;
the token form shows name and button only.

**UX7 as delivered** (2026-10-18, on the branch, every gate green; DEVELOPMENT.md "UX7"). One
structured cause below the web, the rest web only: `@analyzr/bpmn-facts`' `BpmnInputError` carries
`encoding` (`utf-16`, `not-utf-8`) on a `not-xml` whose cause is the encoding (facts and
`facts_hash` unchanged), the server puts it into the 422 `bpmn-invalid` problem next to `reason`
(`extractError`), and `ImportFileOutcome.problem`'s doc in the contracts names both members (no
schema change, the client regenerates without drift). „Hochladen“ (`components/upload-panel.tsx`,
`lib/upload.ts`): the dropzone in 38 words („BPMN-Dateien oder einen Ordner hierher ziehen.“, on
touch „… auswählen.“, „Der Ordnerpfad wird zum Kurznamen, z. B. finanzen/mahnwesen.“, the converter
with a copy button; the limits only in a skip or an error); the headline counts what happened
(`importHeadline`); „Als Nächstes“ below it names what waits for the agent as `formatNextSteps`
does (the models in `waiting_for_agent`, the chain's queued placement task) with „Agent starten“
or „Agent verbinden“, the questions there are already, and „Zur Übersicht“, a placeholder until
the project's queries have refreshed; one column „Modell“ with the file's path below; a failed
file in German by code, `reason` and `encoding` (`fileProblemText`; the local refusals carry their
own `reason`, `no-model-key` and `duplicate-key`), the server's words behind „Technische Details“;
the warnings grouped (`groupWarnings`: elements skipped for an invalid or a used id in one entry
per cause, typed in German, their shapes and the references to them folded in, „Sie fehlen im
Diagramm und in den Verbindungen. Mit /analyzr-integrate:integrate-landscape bereinigen und erneut
hochladen.“; every skipped element one „Hinweis“, so the integrate skill's „N Hinweise“ stays
true); the skipped files in one line, up to three with their reason („gleicher Kurzname wie …“,
„größer als 5,0 MB“). „Agent verbinden“ (`components/connect-agent.tsx`): the token form shows
the name and „Token erstellen“, „Erweitert: Rechte und Gültigkeit“ closed with today's defaults,
the principle once in step 1's description; step 3 „Agent starten“ inline (`StartCommands`, the
popover's content, `components/agent-start.tsx`); the token's prefix below its name instead of a
column; revoking says two sentences, the rest under „Was passiert genau?“. Measured with the UI
load guard on the scratch stack `analyzr-ux7` (the raw Signavio export imported into a project of
its own per run):

| Done when | Before | After (UX7) |
|---|---|---|
| Headline for the raw Signavio export | „Import abgeschlossen: 6 Dateien“ | „5 Modelle importiert · 1 Fehler · 1 übersprungen“ |
| „Bonitätsprüfung.bpmn“ | „9 Hinweise“, each „Unbekannter oder fehlerhafter Inhalt“ with bpmn-moddle's English | „2 Hinweise“, one entry: „2 Elemente übersprungen, weil ihre ID ungültig ist: Aufgabe „Aufgabe_Bonität_prüfen“, Datenspeicher „4711“.“, what it means and the fix |
| The UTF-16 file | „BPMN must be UTF-8 encoded; UTF-16 is not supported“ | „Die Datei ist UTF-16-kodiert; analyzr liest nur UTF-8. Speichere sie als UTF-8 oder wandle den Export mit /analyzr-integrate:integrate-landscape um.“ |
| Next step after the import | none | „5 Modelle warten auf den Agenten · Agent verbinden“ = the 5 queued relations tasks `analyzr import` names; „6 offene Fragen gibt es schon jetzt · Offene Fragen ansehen“ |
| Words before an import | 71 | 38 in the dropzone (≤ 45), 49 on the whole page, 13 controls |
| Token form | name, three rights, validity, button (6 controls, 2 hints) | name and button (2 visible controls) |

The walkthrough's question cards, measured on the same stack: „Offene Fragen“ 76 controls as
before, 710 words at 1440 px (643 before the button; ≤ 1,000). Not verified: other browsers than
Chromium, a real phone (the touch text is `pointer-coarse`), a screen reader.

**UX8 "S2a's web parts".** §6 without the „Vorschau“: `packages/contracts/src/api/models.ts`
(`Model.source`), the server's model read and a server test, the client; `components/upload-panel.tsx`,
`lib/upload.ts` (the manifest through `@analyzr/contracts/import-manifest`, loaded on demand),
`routes/model-view.tsx` and `canvas-header.tsx` („Herkunft“), `models-table.tsx` (chip). Tests:
`test/upload-panel.test.tsx`, `integrate-bundle.test.ts`, `app.test.tsx`; `e2e/smoke.spec.ts` (a
bundle folder with its manifest); the bundle guard (pinned contracts list, no zod in the entry).
Done when: a dropped bundle imports under its pinned keys with its provenance (equal to `analyzr
import` on the same folder), the identity warnings show in German, „Herkunft“ round trips through
the web, and no new column or tab appears.

**UX8 as delivered** (2026-10-18, on the branch, every gate green; DEVELOPMENT.md "UX8"). §6
without the „Vorschau“ (S2b). Contracts first: `Model.source`, the head's declared provenance in
short (`ModelSourceSummary`: `system`, `derived` = `derived.kind`, `exportedAt`; an amended head's
from its `upstream`, which the store joins; `null` without a declared system), REST only (no MCP
output schema holds `Model`; the MCP snapshots unchanged), the client regenerated, a real-PostgreSQL
test (`provenance.test.ts`: the golden bundle's summary per model, an amended head's, a plain
upload's `null`). The contracts export `@analyzr/contracts/import-manifest`, which the web loads
with a dynamic import only; ESLint allows it and the bundle guard pins it and its modules (zod
among them) in a dynamic chunk, the entry still holding `paths.ts` alone. „Hochladen“
(`lib/upload-manifest.ts`, `lib/upload.ts`, `components/upload-panel.tsx`): a folder with
`analyzr-import.json` at its root is read as `analyzr import` reads it (checked with the schema;
its pinned keys plan the upload through `planUpload`'s `keyOf`; each batch sends its subset as the
part `manifest`; the manifest, the chain and the inventory neither sent nor listed as skipped);
„Bundle erkannt: Signavio, exportiert am 14.10.2026 · 6 von 6 Dateien gelistet · Kurznamen aus dem
Bundle“ and the line for unlisted files; an invalid manifest, or one only in a subfolder, stops
before sending with a German reason; the identity warnings in German in the file's disclosure,
`external-id-moved` and `-changed` counted in the headline („1 Hinweis zur Identität“); a bundle's
chain adds „Das Bundle enthält eine Wertschöpfungskette · Auf der Kette importieren“. „Übersicht“:
the derived chip in the name cell („Konvertiert“, „KI-rekonstruiert“, „Aus Interview“; none for a
plain export, never a column) and, when every model declares one system, „Aus Signavio ·
exportiert am 14.10.2026“ after the project's key (`lib/provenance.ts`). The model view's header:
the derived chip, „Herkunft“ (`components/model-provenance.tsx`, a lazy module: source with
version and date „(angegeben)“, the place in the tool, how the file was derived, who uploaded it,
the losses of a conversion, „In Signavio öffnen“ for an http(s) link; an amended head through
`source.upstream`, „In analyzr ergänzt (aus r1)“) and „Beim Import übersprungen: 2 Elemente –
Details“ from the model's open `extractor-loss` question, whose „Details“ shows its card. Until
UX3 builds the header's „Mehr“, „Herkunft“ is a ghost button next to the chips and „In Signavio
öffnen“ sits inside it. Not verified: a real phone, a screen reader.

**S2b's „Vorschau“ as delivered** (2026-10-18, on the branch; M6 §8 "S2b step 3"): §6's last
bullet but one. A drop shows the dry run first in the result's layout: the headline „Vorschau: 5
Modelle neu · 1 Fehler · 1 übersprungen“, the outcome column „Wird neu“, „Neue Revision“,
„Unverändert“, „Fehler“, at most three impact lines („Danach: …“; the pairs to re-judge wait for
S2b's follow-up), „Was ändert sich?“ closed, the shared-top-folder hint, the batch note, „Importieren“
and „Abbrechen“; after importing the same panel is the result with „Als Nächstes“ (UX7). The
deletion impact stays in the CLI (the web has no model deletion).

**UX9 "Relationen results, Annahmeregeln, projects summary".** Files: `components/relation-table.tsx`,
`lib/relation-filters.ts`; `routes/project-rules-page.tsx`, `components/rules/` `rule-table.tsx`,
`rule-dialog.tsx`, `rule-preview.tsx`, `apply-dialog.tsx`, `revoke-dialog.tsx`, `subject.tsx`,
`system-rule-card.tsx`, `agent-revoke.tsx`; contracts, server use case and route for `GET
/projects/{p}/summary` (permission `read`, REST only), optionally a CLI reader, `routes/index.tsx`.
Tests: `test/relation-table.test.tsx`, `rules-tab.test.tsx`, `auto-accept-marks.test.tsx`; server
integration for the route (policy matrix); `e2e/auto-accept.spec.ts`, `smoke.spec.ts`,
`screenshots.spec.ts` (03, d19-*). Docs: CONCEPT §5 route table. Done when: the result views have
at most 60 controls (194 today); a rule row has 3 controls (6 today) and the dialog 4 visible fields
plus the prefilled name (10 today); enabling a rule with open proposals or another author confirms
first; the preview shows the flags count; the projects list shows „Offen für dich“ (or „–“) and
„Zuletzt geändert“, and `Project` is unchanged.

**UX9 as delivered** (2026-10-19, on the branch, every gate green; DEVELOPMENT.md "UX9"). §3.10
items 2, 3 and 5, §3.11 items 3–7, §3.12 item 1 and Q8 („Nur anzeigen“, decision 26 (7)); one
REST route, live-run neutral. Built by three agents in worktrees of their own, reviewed
adversarially part by part; the review's two major findings on the rules (an orphaned active
rule's switch, focus lost after a dialog from a menu) and one on the summary (a full read model
per row) fixed before the merge. „Relationen“ (`relation-table.tsx`, `lib/relation-filters.ts`):
„Status“ (only in „Alle“, offering what keeps the view: „Vorgeschlagen“, „Vorgemerkt“) and „Modell“
visible, „Grundlage“, „Typ“ and „Annahmeregel“ (not in „Abgelehnt“; choosing a rule in „Gilt“
moves to „Automatisch angenommen“) behind „Weitere Filter (n)“; rows without the chevron and its
details, one „Öffnen“, „Entschieden von“, the endpoints wrapped instead of cut and without the
ref tooltip; 40 rows a page in the URL (`?shown=`), which the review screen keeps: in its new
`?from=relations` mode J/K walk the result list (also after a decision moved the relation out),
a decision stays on the relation and the back link returns to the view and page; without any
relation the empty state with „Agent starten“, on `/relations` and on the tab's landing `/review`.
„Annahmeregeln“ (`project-rules-page.tsx`, `components/rules/`): the safeguard once, the system
rule in one line, rows of the „Aktiv“ switch, „Bearbeiten“ and „Mehr“ („Verlauf“, „Widerrufen…“),
„Bisher“ with non-zero counts, the inline hint „N offene Vorschläge passen – ansehen …“ instead of
„Anwenden“, „Nach Agent widerrufen…“ in the page's „Mehr“, „Vorschau“ gone; the switch asks before
enabling when proposals are open or the caller becomes the deciding person (an orphaned rule's
switch stands off; `GET /me` tells who decides); the dialog with four criteria and the name
prefilled from them, the rest behind „Weiter einschränken“, one „Speichern“ with „Aktiv“, the
curve behind „Nach Konfidenz aufschlüsseln“; preview and apply name the flagged count; apply and
revoke lists by element name and „100 %“, scrolling. Projects list (`routes/index.tsx`): „Projekt“
with the key, „Offen für dich“ (the shared focusable „Offene Punkte“ cell, now
`components/open-points-cell.tsx`) and „Zuletzt geändert“ from `GET /projects/{p}/summary`
(permission `read`, REST only: `lastEventAt`, `reviewItems`, `openPlacements`, `ask`, memoized per
project event in a 256-entry LRU, so an unchanged project costs the policy and one read; CONCEPT
§5). Deviations: the paging (the done-when cannot hold with every row and one „Öffnen“ each); the
review screen's `from=relations` mode and the empty state on `/review`, outside the slice's file
list; „–“ also for 0 open, „nicht geladen“ on a failed read; a new rule's „Aktiv“ starts off (the
keep list's „rules off by default“). Measured with the UI load guard on `analyzr-ux9`:

| Done when | Before | After (UX9) |
|---|---|---|
| The result view „Alle“ | 194 controls (58 rows) | 56 controls, 1 per row (≤ 60) |
| A rule row | 6 controls | 3 („Aktiv“, „Bearbeiten“, „Mehr“; „N in Kraft“ and the open hint when they apply) |
| The rule dialog | 10 fields | 4 criteria and the prefilled name, 4 more behind „Weiter einschränken“ |
| Enabling with open proposals or another author | no question | one confirmation naming both |
| Preview and apply | no flags | „davon N mit allgemeinem oder mehrfach genutztem Namen …“ |
| Projects list | „Stand“, „Angelegt“ | „Offen für dich“ (the sum of the badges) and „Zuletzt geändert“; `Project` unchanged |

Not verified: other browsers than Chromium, a real phone, a screen reader, the summary on a stack
with many projects.

## 8. Keep as is

From the audits' keep lists, merged:

- **Getting in:** „Projekt anlegen“ lands on „Hochladen“ with a toast, the key slugified from the
  name; the dropzone with „Dateien auswählen“ and „Ordner auswählen“, folder path → key, automatic
  batching; the per-file table with „Neu / Neue Revision / Unverändert / Fehler“, links into each
  model, warnings collapsed by default; the empty project's one primary action.
- **Agents:** „Agent verbinden“'s numbered steps, configs that already contain the new token, the
  secret shown once („kopiere ihn jetzt“), copy buttons, the client tabs Claude Code / Claude
  Desktop / Andere MCP-Clients, „entscheiden kannst nur du“ said plainly.
- **Model view:** the full-bleed canvas with dashed outlines, the highlighted endpoint,
  click-to-filter and „Zu <Modell> wechseln“; „Ergänzen“ with the current value, „im Quellsystem:
  …“, „Ändern …“ and „Zurücknehmen …“; the „ergänzt“ overlay and the canvas marker „Befund“; the
  download split into „BPMN herunterladen“, „Original herunterladen“, „Fürs Quellsystem:
  Änderungsliste“ (now inside „Mehr“); linking a collapsed Signavio subprocess from the model view
  (decision 25.4, now „Ziel wählen …“); stage badges with icons, colours, German labels and hints.
- **Open questions:** one filled primary action per card with a German verb, the rest under
  „Weitere Aktionen“ (decision 25); „Liegt außerhalb der Landschaft“ in one click with „Rückgängig“;
  the dry-run summary „Danach: 1 Aufruf angenommen, 1 Befund erledigt, …“ and the claimed-task
  warning; „Bisher: …“, „(im Quellsystem: …)“ and the conflict view side by side; the personal-data
  warning that names what it found and never blocks; „Vorgeschlagen“ first in the pickers; the
  inline panels built from the review components (for links and placements; for decisions only as
  the G13 fallback if Q4 is declined); the contact hint and the Markdown grouped by it;
  filters in the URL and „Im Tab zeigen“; focus to the next item after an action; „Gültige Kopie
  wählen“ with „Andere Kopien … auf „außerhalb“ setzen“ checked; the five-column CSV round trip with
  its preview and one transaction.
- **Review:** both models side by side with „Von“/„Nach“ and evidence that focuses the canvas; the
  four decisions with A/R/H/C, J/K over the filtered queue, auto-advance and „Liste abgearbeitet“;
  the highlighted „Frage des Agenten“; reject with a required reason and „Agenten sehen den Grund
  bei ihrer nächsten Analyse.“; „Korrigieren“ keeping one end, sorted by similarity, saying what it
  writes; bulk accept's safe default (flagged pairs unchecked) and its all-or-nothing 409;
  „Neuen Stand prüfen“ on conflicts; the held list with note, question, label and answers (its
  answer field becomes „Antwort geben“, one dialog, §2.4); the queue sorted by confidence.
- **Rules:** the live preview („Bisher: 3 von 6 … Trefferquote 100 %“, „Jetzt offen: N würden
  angenommen“, blocked reasons); apply and revoke as dry run plus explicit count with the outcome per
  item; the offer to apply after enabling; rules off by default with „Ohne Regeln entscheidest du
  jeden Vorschlag selbst.“; the read-only system rule with its link; immutable revisions in a
  dialog.
- **Value chain:** the queue flow (select the step, highlight the card, auto-advance, „1 von 29
  offen“, „Alles geprüft“); the four decisions on the card; the agent's „Begründung“ and the „Frage“
  box; „Im Modell“; the save flow (invisible dry run, the short impact dialog, the conflict dialog
  that downloads your version, drafts, „Ungespeichert“, Undo/Redo); manual placement with „Passt
  vielleicht zu:“ (its „Manuell zugeordnet.“ → „Von Hand platziert.“, §4); the searchable process
  picker of the link editor (a link
  becomes a proposal a human decides); text badges, never colour alone; the step tree as keyboard
  alternative (collapsed); „Nur automatisch angenommene“ and „Alle erneut bestätigen (n)“ only when
  relevant; „Wertschöpfungskette anlegen“ without an empty revision; import of a `.vc.json`.
- **Everywhere:** role gating for viewers and the read-only demo; agent texts as plain text; empty
  states that name the next action; no horizontal page scroll at 390 px except „Prüfen“ (fixed in
  UX5, as „Relationen › Zu prüfen“).

## Appendix A. Finding index

`<UX>` as in the header. Impact: H high, M medium, L low.

| Id | Screen | Finding | Imp. | Screenshot |
|---|---|---|---|---|
| O1 | Landing | inventory table, status over six badges, no next step | H | `<UX>/onboard/02-nordwind-models-desktop.png`, `18-fresh-import-models.png` |
| O2 | Nav | 9 tabs wrap at 1440 px, 4 rows on a phone | H | `<UX>/onboard/m02-models-mobile.png` |
| O3 | „Befunde“ | all 7 findings are also open questions; twice in the model view | H | `<UX>/onboard/26-findings-desktop.png`, `27-model-forderungsmanagement-tall.png` |
| O4 | Badge | „Offene Fragen 113“ counts summaries and proposal mirrors | H | `<UX>/oq-nordwind.json` |
| O5 | Upload result | headline hides the failure, no next step | H | `<UX>/onboard/15-upload-raw-signavio-result.png` |
| O6 | Upload warnings | 9 raw lines for 2 bad ids, consequence unsaid | H | `<UX>/onboard/17-upload-raw-signavio-warnings-open.png` |
| O7 | Dropzone | batch mechanics instead of the integrate hint | M | `<UX>/onboard/03-upload-empty-desktop.png` |
| O8 | Upload errors | English error, every skip reason, two near-equal columns | M | `<UX>/onboard/16-upload-raw-signavio-rerun-details-open.png` |
| O9 | Model view phone | panel covers canvas and name | H | `<UX>/onboard/m05-model-view-mobile.png` |
| O10 | Model view panel | four sections under „Relationen“, questions ~1,500 px down | H | `<UX>/onboard/08c-model-sidebar-questions.png` |
| O11 | Relation cards | five marks per card | M | `<UX>/onboard/05-model-order-handling-desktop.png` |
| O12 | Model view header | two back links, key as title, six chips | M | `<UX>/onboard/10-model-header-download-menu.png` |
| O13 | Question cards (model view) | `s…`, unlocks, expanded summaries, pool ids | M | `<UX>/onboard/21-model-signavio-subprocess-selected.png` |
| O14 | Element selected | raw id chip, stray „keine Relation“, „Verlauf (1)“ open | M | `<UX>/onboard/09-model-element-selected-call.png` |
| O15 | Models table | engine/revision noise; „Eingearbeitet“ with 19 open questions | M | `<UX>/onboard/06-signavio-models-desktop.png` |
| O16 | Agent verbinden | no „start the agent“ step | M | `<UX>/onboard/04-agents-desktop.png` |
| O17 | Token form | choices with right defaults, principle twice | M | `<UX>/onboard/m04-agents-mobile.png` |
| O18 | Projects list | key, role, `s277`, created; pnpm hint | M | `<UX>/onboard/01-projects-desktop.png` |
| O19 | Server status | always shown, 3 lines on a phone | M | `<UX>/onboard/m03-upload-mobile.png` |
| O20 | Empty states | zero badges, filters over 0 rows, stale text | M | `<UX>/onboard/14-empty-project-models.png`, `24-fresh-relations-empty.png` |
| O21 | Import loss | dropped elements invisible after the upload | M | `<UX>/onboard/19-fresh-model-view-no-agent.png` |
| O22 | „Neues Projekt“ | key field always shown | L | `<UX>/onboard/12-new-project-dialog.png` |
| O23 | Legend, toolbar | permanent legend; change list in the filter bar | L | `<UX>/onboard/05-model-order-handling-desktop.png` |
| G1 | „Offene Fragen“ | ~21 real gaps among 113 | H | `<UX>/gaps/crops/oq-nordwind-desktop-end.png` |
| G2 | „Offene Fragen“ | 13 processes listed twice | H | `<UX>/oq-nordwind.json` |
| G3 | Card | ids, seqs, source, unlocks, „Bezug“, folder | H | `<UX>/gaps/item-agent-question-desktop.png` |
| G4 | Tab chrome | 127-word intro, 5 selects; first card 639 / 1,476 px | H | `<UX>/gaps/crops/oq-nordwind-mobile-0.png` |
| G5 | Link vs amend | two pickers for one gap | H | `<UX>/gaps/panel-link-call-desktop.png`, `panel-amend-call-desktop.png` |
| G6 | Model view panel | questions buried, same gap three times | H | `<UX>/gaps/mv-forderung-inkasso-desktop.png` |
| G7 | „Befunde“, nav | duplicate tab; „Befunde“ means three things | M | `<UX>/gaps/findings-nordwind-desktop.png` |
| G8 | „Sammeln“ | heavy UI for a saving that does not exist; see-through bar | M | `<UX>/gaps/collect-bar-desktop.png` |
| G9 | Filters | „Quelle“ repeats „Art“; status „Alle“ | M | `<UX>/gaps/crops/oq-nordwind-desktop-0.png` |
| G10 | Pickers | unranked, mono refs | M | `<UX>/gaps/panel-link-message-desktop.png` |
| G11 | Note dialog | 130 words, stale effect text | M | `<UX>/gaps/dialog-note-desktop.png` |
| G12 | Signavio informational | 12 of 19 cards informational | M | `<UX>/gaps/crops/oq-signavio-desktop-3200.png` |
| G13 | Decide panels, menu | 2 clicks to accept; one-entry menus | M | `<UX>/gaps/menu-weitere-aktionen-desktop.png` |
| G14 | Export | 81 CSV rows, 1,177 Markdown lines | M | `<UX>/gaps/dialog-csv-desktop.png` |
| G15 | Pool cards | pools titled by id | M | `<UX>/gaps/item-black-box-signavio-desktop.png` |
| G16 | Texts, labels | technical reasons in the question; long labels | M | `<UX>/gaps/item-call-target-unknown-desktop.png` |
| G17 | Amend form | 4–5 clicks, repeated label, long cost | L | `<UX>/gaps/panel-amend-summary-desktop.png` |
| G18 | Panels | note field everywhere; choose-copy rows by ref, CLI hint | L | `<UX>/gaps/panel-choose-copy-desktop.png` |
| G19 | Answered card | said three times; withdrawn block forever | L | `<UX>/gaps/toast-outside-undone-desktop.png` |
| G20 | Model view header | four badges; „Verlauf“ repeats the value | L | `<UX>/gaps/mv-order-handling-fraudcheck-desktop.png` |
| G21 | Model view phone | panel cannot be collapsed | L | `<UX>/gaps/mv-forderung-inkasso-mobile.png` |
| R1 | Review screen phone | panel covers header and both diagrams | H | `<UX>/review/21-review-mobile.png` |
| R2 | Review panel | facts 2–4 times, ids | H | `<UX>/review/07b-review-question-tall.png` |
| R3 | Inbox | five blocks before the first proposal | H | `<UX>/review/01-inbox-desktop.png` |
| R4 | Queue | 42 „Prüfen“ buttons, handle column | H | `<UX>/review/01-inbox-desktop.png` |
| R5 | „Relationen“ | 194 controls, presets repeat the inbox | H | `<UX>/review/12-relations-desktop.png` |
| R6 | Bulk (key) | 29 promised, 8 selected, 4 flag lines per row | M | `<UX>/review/17-bulk-key-dialog.png` |
| R7 | Bulk (lexical) | preselects 65–73 % pairs | M | `<UX>/review/18-bulk-lexical-dialog.png` |
| R8 | Labels | „Stufe“ jargon; „Regel“ means five things | M | `<UX>/review/07b-review-question-tall.png` |
| R9 | Held | note missing on the review screen, no answer field | M | `<UX>/review/09b-review-held-tall-aside.png` |
| R10 | „Kein Zusammenhang“ | 144 read-only cards in the inbox | M | `<UX>/review/05-nolinks-top.png` |
| R11 | Stage filter | 25-row model table above the queue | M | `<UX>/review/02-stage-top.png` |
| R12 | Rule table | 6 buttons per row, dead actions | M | `<UX>/review/41-rules-after-apply.png` |
| R13 | Rule dialog | 10 fields, required name, 9 equal curve rows | M | `<UX>/review/30-rule-dialog-new.png` |
| R14 | Rule preview | silent about bulk flags | M | `<UX>/review/17-bulk-key-dialog.png` |
| R15 | Auto-accept marks | rule name three times, „mit 1,00“ | M | `<UX>/review/40-review-auto-accepted-aside.png` |
| R16 | „Offene Fragen“ vs „Prüfen“ | same proposal decided in two places | M | `<UX>/gaps/panel-decide-relation-desktop.png` |
| R17 | Inbox phone | sideways scroll, table cut | M | `<UX>/review/20-inbox-mobile.png` |
| R18 | Review 1024–1279 | one pane at a time | L | `<UX>/review/19b-review-1024.png` |
| R19 | Decision bar | shortcuts shown twice | L | `<UX>/review/07-review-key-call-question-desktop.png` |
| R20 | Hold form | three fields at once | L | `<UX>/review/15-review-hold-form.png` |
| R21 | Rules texts | safeguard sentence five times; system rule jargon | L | `<UX>/review/13-rules-desktop.png` |
| R22 | Apply/revoke | raw refs, „mit 1,00“, 20 items | L | `<UX>/review/37-rule-apply-dialog.png` |
| R23 | Agent revoke | permanent section | L | `<UX>/review/41-rules-after-apply.png` |
| R24 | Empty inbox, header | phase bar and filters over nothing; „Stand“ | L | `<UX>/review/50-signavio-inbox-empty.png` |
| C1 | Chain panel | reviews below the fold, no start button | H | `<UX>/chain/02-vc-overview-tall.png` |
| C2 | Chain panel | unsure and unplaced list the same 3 processes | H | `<UX>/chain/02-vc-overview-panel-05.png` |
| C3 | Chain „Befunde“ | 44 rows and 12 labels say „nothing decided yet“ | H | `<UX>/chain/02-vc-overview-panel-04.png` |
| C4 | Chain vs „Offene Fragen“ | 47 of 113 questions are the chain queue | H | `<UX>/oq-nordwind.json` |
| C5 | Placement card | 8 controls, 2 badges, mono ref | H | `<UX>/chain/03-vc-step-bestellwesen.png` |
| C6 | Card details | ids, procedure, rationale twice | M | `<UX>/chain/06-vc-placement-expanded-panel-01.png` |
| C7 | Edit mode | stale tree, contradicting warning | M | `<UX>/chain/09a-vc-edit-after-delete.png` |
| C8 | Canvas | selection invisible, labels outweigh names | M | `<UX>/chain/16-canvas-zoom-selected.png` |
| C9 | Chain header | 8 controls, duplicate links | M | `<UX>/chain/01-vc-desktop.png` |
| C10 | Step view | read-only duplicate of the panel | M | `<UX>/chain/04-stepview-beschaffung.png` |
| C11 | Chain phone | panel covers header and canvas | M | `<UX>/chain/10-vc-mobile.png` |
| C12 | Chain summary | five numbers, none says coverage | M | `<UX>/chain/02-vc-overview-panel-01.png` |
| C13 | Link editor | kind and link jargon | L | `<UX>/chain/08-vc-edit-step-panel-01.png` |
| C14 | Step panel | id, inherited kind, empty link, counts line | L | `<UX>/chain/03-vc-step-bestellwesen-panel-01.png` |
| C15 | Edit canvas | palette covers the first column | L | `<UX>/chain/07-vc-edit.png` |
| C16 | Placement forms | empty required note, long texts, open answer field | L | `<UX>/chain/03-vc-step-bestellwesen.png` |
| C17 | Legend, removed steps | two-line legend; hint twice | L | `<UX>/chain/01-vc-desktop.png` |
| C18 | Empty chain | CLI block before the primary button | L | `<UX>/chain/14-vc-empty.png` |
| C19 | Sim agent texts | English engineering rationales | L | `<UX>/chain/03-vc-step-bestellwesen-panel.txt` |

Evidence added with the critique (same `<UX>`):

| Topic | Screenshot or file |
|---|---|
| held list with two open answer fields per row (§3.6 item 7) | `<UX>/critic/04-held.png` |
| agent tokens are per project („Ein Agent-Token gilt nur für dieses Projekt“, §2.6) | `<UX>/critic/05-agents.png` |
| `signavio-beispiel`: models table with 0 open items while questions are open (§2.5) | `<UX>/critic/02-signavio-models.png`, `<UX>/critic/03-signavio-oq.png` |
| projects list (§3.12) | `<UX>/critic/01-projects.png` |
| the bpmn.io watermark painted over the review panel at 390 px (§3.13 item 1) | `<UX>/feas/review-390-watermark.png`, probe `<UX>/feas/watermark.mjs` |
| the customer export with event number, refs, folder and English agent questions (§3.3 item 4) | `<UX>/gaps/export.md`, `<UX>/gaps/export.csv` |

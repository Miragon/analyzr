# analyzr concept

Status: proposed (2026-10-05) · Owner: Dominik Horn · Decision record: ADR-0001

analyzr is a headless store for process landscapes. It holds BPMN models, the facts extracted from them, and the relations between processes together with their review state. Agents analyse the models and humans decide on the relations. Any MCP client can be the agent; the web UI is one client among several. analyzr lives in its own repository `Miragon/analyzr` (§9).

## 1. Principles

1. **Headless first.** Every capability is a domain use case, reachable through REST and, where agents need it, through MCP. The UI has no private endpoints.
2. **Code computes facts, agents judge, humans decide.**
3. **Postgres is the record; files are for exchange.** BPMN comes in, OKF goes out, and nothing flows both ways: analyzr never writes to a source tool. Since owner decision 25 analyzr also writes revisions of its own: *amended revisions*, computed from the uploaded bytes by byte-preserving splices of the fields open questions name, re-applied at every import of the key while the source tool leaves the field as it was, and offered as corrected BPMN and a change list that a human carries into the source tool by hand (M6 §4.8 c). The uploaded bytes always stay a revision of their own.
4. **One model is one BPMN file with a stable key.** Collaborations are never split.
5. **Append-only history, authorization in the domain.** Revisions, facts, assertions, submissions, no-links and events never change. Every use case checks access, and composite foreign keys back the checks up.
6. **The agent is the operator's choice.** analyzr ships no runner and holds no LLM credentials; whoever runs the agent brings model, credentials and compute.
7. **Every part earns its place:** one deployable, one queue table, one event table, five packages. The eval corpus is the spec for procedures.

## 2. Domain model

**Entities:**

| Entity | Identity |
|---|---|
| Project | `prj_` |
| Principal | `prn_`: a user `(iss, sub)` or a service `(iss, client_id)`; an agent token (`agt_`, §6) is a service with `iss = urn:analyzr:agent-token` |
| Membership | role `viewer`, `editor` or `owner` |
| Model | `mdl_` with an immutable `key` such as `billing/dunning` |
| Revision | `rev_`, holding immutable bytes: an *uploaded* revision (the bytes as they came, from an upload, an import or a seed) or, since owner decision 25, an *amended* revision (`source.kind = 'amendment'`), computed from an uploaded revision (`source.upstream`) by the live model amendments its plan marks applied; since M6 S2a an uploaded revision's `source` carries typed provenance (the credential kind `uploader`, and from an import bundle's manifest the declared system, tool id, tool folder, link, derivation and losses), never part of facts or `facts_hash`, and since M6 S2c-1 the trust class `trust` the server sets (§2 "Trust rule", M6 §3.10); for an amended head its readers follow `source.upstream` |
| Model amendment (owner decision 25, M6 S5c-2) | `mam_`, append-only: one field of one element (`call-target`, `message-name`, `event-name`, `process-documentation`) with the value before and after, set by a human; ends with a withdrawal row (`withdrawn` or `superseded`); at most one live per model, element and op |
| Fact | `(revision, kind, element_id)` |
| Relation | `rel_`, plus the natural key `(type, from_ref, to_ref)` |
| Assertion, submission, no-link | append-only; submissions stored verbatim; a no-link (`nlk_`, an agent's judgement that a typed pair is unrelated) ends with a withdrawal row |
| Analysis task | `ana_` |
| Value chain (M4) | `vch_` with an immutable `key` (`main`); revisions `vcr_` hold immutable canonical bytes; step generations `(chain, element_id, generation)` |
| Placement (M4) | `plc_`, natural key `(chain, element_id, generation, process_ref)`; assertions `pas_`, append-only |
| Auto-accept rule (owner decision 19) | `aar_`, an immutable head row plus append-only revisions `(rule, revision)`; never deleted, only disabled |
| Event | `(project, seq)`; both change feed and audit log |

**Refs** have the form `<model_key>#<element_id>`, or `<model_key>#<process_id>` for a process.

**Hashes.** `content_hash` makes identical uploads no-ops: an upload is `unchanged` when its bytes equal the head's, its uploaded revision's (`source.upstream.contentHash`) or any amended revision's of the model that holds analyzr's output (a corrected BPMN downloaded earlier; not a re-derivation that applied nothing, whose bytes are an earlier export the tool may bring back as a revert; M6 S5c-2); `facts_hash` ignores layout. Each fact's `fingerprint = sha256(kind|event_def|ref_name_norm|label_norm|scope)[:12]` tells "same id, same meaning" apart from "same id, changed meaning".

**Facts** come from `@analyzr/bpmn-facts` and are versioned by `FACTS_VERSION`:

| kind | Source | `key_raw` |
|---|---|---|
| `process` | `bpmn:process` (+ participant name) | process id |
| `call` | callActivity | `calledElement` / `zeebe:calledElement@processId` |
| `msg_throw`, `msg_catch` | message events (incl. boundary, event-subprocess start), send/receive tasks | message name, else label |
| `sig_throw`, `sig_catch` | signal events | signal name |
| `evt_start`, `evt_end` | none/timer/conditional starts, none/terminate ends | label |
| `data_store`, `message_flow`, `lane`, `task` | inside one file | name |

Each fact also carries `element_id`, `process_id`, `scope` (`process`, `subprocess` or `event_subprocess`), `event_def`, `label` and `key_norm` (NFKC, lowercase, ä/ö/ü/ß → ae/oe/ue/ss, punctuation → space). Rules match only on real refs, never on labels.

**Relation types (v1):**

| type | from → to | Rule (no LLM) |
|---|---|---|
| `call` | `call` → `process` | `calledElement` = exactly one process id → **accepted** by `analyzr-rules/1.0.0` when the calling model is modelled; from a derived one proposed, tier `key`, confidence 0.9 (the trust rule, below) |
| `message` | `msg_throw` → `msg_catch` | same message name → proposed, tier `key`, confidence 1.0 |
| `signal` | `sig_throw` → `sig_catch` | same signal name → proposed, tier `key` |
| `trigger` | labelled none end → labelled none start | none; agents only |
| `manual` | any → any | humans only, rationale required |

Endpoints lie in different processes; start and end events inside embedded subprocesses, and end events inside event subprocesses, are never endpoints; the typed start of an event subprocess is. Timer, conditional, error and escalation events are out of v1. Message flows within one file are facts without a lifecycle; data stores are grouped by `key_norm`. A `calledElement` matching only a key's last segment (bpm-iq file stems) is proposed, not accepted.

**Unambiguous call (auto-accept; accepted when the calling model is modelled, see "Trust rule" below).** A call is unambiguous when all three hold: (1) the target is a constant, i.e. C7 `calledElement="invoice-check"` or C8 `<zeebe:calledElement processId="invoice-check"/>`, not an expression such as C7 `${target}` or C8 `processId="=target"`; (2) exactly one process in the project's head revisions has that id; (3) that process is not the calling process. Version, binding and tenant attributes (C7 `calledElementBinding`, `calledElementVersion`, `calledElementTenantId`; C8 `bindingType`, `versionTag`) are kept as relation attributes and do not change the target. Everything else becomes a proposal or a finding: no match gives `unresolved-call`; two or more matches give proposals to every candidate plus `duplicate-process-id`; an expression gives `dynamic-call`, and agents may propose candidates; a match only by file stem or label is a proposal. Identical message or signal names are never auto-accepted, because names get reused and one throw may legitimately reach several catches; they arrive as `key`-tier proposals that a reviewer can accept in bulk per tier.

**Trust rule** (owner decisions 24.2, 25.2 and 28, M6 §3.10; since M6 S2c-1). The server stores a trust class on every uploaded revision (`source.trust`, never declared): **modelled** when the file targets Camunda 7 or 8 (`engine`), a human uploaded it (`uploader`: the owner key or the web session) and its manifest declares no derivation or `export`; otherwise **derived**, with its reasons (`no-engine`, `agent-upload`, `converted`, `reconstructed`, `as-told`). An amended revision has none: its readers follow `source.upstream`. The rule tier accepts an unambiguous call only from a modelled caller; from a derived caller the call becomes a rule proposal, tier `key`, confidence 0.9, with `attrs.match = 'derived-caller'` and a German rationale naming the reasons, and findings are unchanged. Only the caller's class counts, and a call element whose call target a human set by amendment (applied, or taken over by the source tool, `in-source`) counts as modelled whatever the class. Since M6 S2c-3 an owner's auto-accept rule for derived calls may accept these proposals by the source the caller declares (§3 review workflow step 5), never those of a revision uploaded with an agent token. Revisions stored before S2c carry no class and count as modelled, so their acceptances stay (option (a)). Since M6 S2c-4 the owner reviews, once per uploaded revision, the rule tier's acceptances from those that would classify as derived from what they carry (decision 28 (3), „Vor der Vertrauensregel angenommen“, §3 review workflow step 5): „Zurück in die Prüfung“ records `derived` (the reasons are read from what the revision carries), so its unique calls become rule proposals, and „Behalten“ records `modelled`, so they stay accepted. The review is stored apart (`revision_trust_review`), read only where a revision carries no class, and never overrules `source.trust`. Declared values can only lower trust; the class authenticates the credential kind, not the person.

**Assertions** record kind and verdict; `source_kind` (`human`, `agent`, `rule`) with the authenticated principal and client; the declared procedure version and LLM model; the server-computed tier (`key`, `lexical`, `semantic`, `manual`); confidence, rationale and evidence; both endpoint fingerprints; for a pipeline proposal also its basis, the `facts_hash` of both endpoint models as the agent saw them (§3, judge each pair once). **No-links** record the typed pair, the reason, the same provenance and basis, and the analysed model as origin.

**Auto-accept marker** (owner decision 19). An owner's auto-accept rule accepts an agent proposal (since M6 S2c-3 a rule for derived calls the rule tier's proposal of a unique call from a derived model, §3 review workflow step 5) as a `decision`/`accept` with `source_kind = 'human'` under the **author of the rule revision in force** (whoever created, edited or enabled it); agents still only propose, and the checks `agents_never_decide` and `placement_assertion_rules_never_decide` are unchanged. Three marker columns name the rule, its immutable revision and the proposal that triggered it (`auto_accept_rule_id`, `auto_accept_rule_revision`, `auto_accept_trigger_id`). A composite foreign key `(project_id, rule_id, revision, principal_id) → auto_accept_rule_revision` pins the decider to the revision's author, a second one makes the trigger an assertion of the same relation or placement, and a check allows a marker only on a human accept with a trigger and no tier, or on a human withdrawal without one: the **revocation**. Unmarked rows are untouched (the foreign keys are MATCH SIMPLE). Code that equates `human` with "reviewed by a person" must check the marker: the R1 OKF export (`verified: human:<handle>`) and `eval-export` treat a marked decision as machine-confirmed, never as ground truth (the rule preview already does).

**Status.** `recomputeStatus` is a pure function. The latest decision wins, except that a newer proposal whose fingerprints differ from those stored with a rejection reopens the relation as `proposed`. A revoked auto-acceptance is no decision in force: a marked decision ends when a later withdrawal of the same principal carries the same rule id (the revocation), without falling back to that principal's older decisions (the safeguards guarantee there are none). The revocation ends exactly that acceptance: when the principal has proposed or withdrawn since (say, the rule's author proposed the pair again after an endpoint change), that later stance stays. Every other decision behaves as before, so histories without markers compute exactly as they did (a golden digest over random histories pins it). Without a decision, a live proposal means `proposed`; otherwise the relation is `obsolete` and hidden. Human verdicts are `accept`, `reject` and `hold` ("vormerken": a note is required, a question and a label are optional). A held relation has status `held`: it is still open, leaves the review inbox for its own list, appears in agents' claim input, and a later accept or reject replaces the hold.

**Endpoint state** (`ok`, `changed`, `missing`) is recomputed on every ingest and delete; an accepted relation with an endpoint not `ok` is an open item (re-anchoring in R2). A task submission for model M withdraws the live agent judgements (pipeline proposals and no-links, any agent) touching M that were made on another version of M or under another procedure; current ones stay without repetition (§3), and ad-hoc proposals stay.

**PostgreSQL sketch** (Drizzle). Child rows carry `project_id`, with composite foreign keys `(project_id, x_id) → parent(project_id, id)`.

```sql
project(id, key unique, name, last_seq bigint default 0)
principal(id, kind, iss, subject, email, handle, unique(iss, kind, subject))
membership(project_id, principal_id, role)    invitation(id, project_id, email_norm, role, …)
agent_token(id, project_id, principal_id, name, prefix, secret_hash unique, scopes, expires_at,
         revoked_at, created_by, last_used_at)
model(id, project_id, key, name, head_revision_id, deleted_seq, unique(project_id, key))
model_revision(id, project_id, model_id, rev, xml, content_hash, facts_hash, facts_version, source jsonb,
         extract_warnings jsonb null, principal_id, seq,
         unique(project_id, model_id, id))   -- xml: the uploaded bytes, or bytes computed from an uploaded
                                             -- revision by amendments (M6 S5c-2); the unique since 0015;
                                             -- source: since M6 S2a the uploaded revision's typed provenance
                                             -- (uploader, manifestSha256, the manifest's declared fields;
                                             -- since M6 S2c-1 trust {class, reasons});
                                             -- extract_warnings: since M6 S2a (0017), null before
fact(revision_id, project_id, kind, element_id, process_id, scope, event_def, label, key_raw, key_norm,
     fingerprint, attrs jsonb, pk(revision_id, kind, element_id))
relation(id, project_id, type, from_ref, to_ref, status, endpoint_state, tier, confidence, version,
         unique(project_id, type, from_ref, to_ref))
relation_assertion(id, project_id, relation_id, seq, kind, verdict, source_kind, principal_id, client_id,
         declared jsonb, submission_id, tier, confidence, rationale, evidence jsonb, from_fp, to_fp,
         from_hash, to_hash, check(not (kind = 'decision' and source_kind = 'agent')))
analysis_task(id, project_id, model_id, revision_id, kind, facts_hash,
         state in ('queued','claimed','done','failed','cancelled'),
         lease_token_hash, claimed_by, lease_until, attempts, last_error, created_at,
         claimed_seq, assignment jsonb, requeue_after)
  unique (model_id, kind) where state in ('queued','claimed')
analysis_submission(id, project_id, task_id unique, principal_id, declared jsonb, payload jsonb, result jsonb, seq)
no_link(id, project_id, type, from_ref, to_ref, from_model, to_model, from_hash, to_hash, reason, source_kind,
         principal_id, client_id, declared jsonb, submission_id, model_id, seq)
no_link_withdrawal(no_link_id pk, project_id, seq, principal_id, reason)
event(project_id, seq, type, principal_id, client_id, subject_ref, payload jsonb, at, pk(project_id, seq))
-- M4 (value chain, M4-VALUE-CHAIN.md §2 has the columns and constraints):
value_chain(id, project_id, key, name, head_revision_id, deleted_seq, unique(project_id, key))
value_chain_revision(id, project_id, value_chain_id, rev, content, content_hash, structure_hash,
         schema_version, base_revision_id, principal_id, source_kind = 'human', seq)
value_chain_step(project_id, value_chain_id, element_id, generation, created_rev, deleted_rev, deleted_seq)
placement(id, project_id, value_chain_id, element_id, generation, process_ref, status, endpoint_state,
         tier, confidence, version, step_fp, process_fp)
placement_assertion(<relation_assertion columns>, placement_id, linked_placement_id, step_fp, process_fp,
         step_hash, process_hash)
-- Owner decision 19 (auto-accept rules; migrations 0009/0010):
auto_accept_rule(id, project_id, kind in ('relation','placement'), created_by, seq, unique(project_id, id, kind))
auto_accept_rule_revision(project_id, rule_id, kind, revision >= 1, name, enabled, tier, min_confidence
         between 0.5 and 1, note, relation_type, agent_principal_id, llm_model, include_ad_hoc,
         proposed_by in ('agent','rule') default 'agent', derived_kind, converter,  -- M6 S2c-3, 0018
         principal_id, client_id, source_kind = 'human', seq, pk(rule_id, revision),
         unique(project_id, rule_id, revision, principal_id),
         check((kind = 'relation' and tier in ('key','lexical','semantic'))
               or (kind = 'placement' and tier in ('lexical','semantic') and relation_type is null)),
         check((proposed_by = 'agent' and derived_kind is null and converter is null)
               or (proposed_by = 'rule' and kind = 'relation' and tier = 'key' and relation_type = 'call'
                   and min_confidence = 0.9 and agent_principal_id is null and llm_model is null
                   and not include_ad_hoc and derived_kind in ('export','converted','none')
                   and (derived_kind = 'converted') = (converter is not null)
                   and (converter is null or char_length(converter) between 1 and 120))))
-- marker columns on relation_assertion and placement_assertion:
  auto_accept_rule_id, auto_accept_rule_revision, auto_accept_trigger_id,
  fk (project_id, auto_accept_rule_id, auto_accept_rule_revision, principal_id)
     → auto_accept_rule_revision(project_id, rule_id, revision, principal_id),
  fk (project_id, relation_id | placement_id, auto_accept_trigger_id) → same table (same subject),
  check((rule_id is null) = (rule_revision is null) and (rule_id is not null or trigger_id is null)
        and (rule_id is null or (source_kind = 'human' and ((kind = 'decision' and verdict = 'accept'
             and trigger_id is not null and tier is null) or (kind = 'withdrawal' and trigger_id is null)))))
-- M6 S5a (answers to open questions; migrations 0011/0012, M6-INTEGRATION-AND-GAPS.md §4.5):
open_question_answer(id, project_id, question_id ~ '^q-[0-9a-f]{16}$', subject_type, subject_id,
         kind in ('answer','outside-landscape','will-be-modelled'), text (1–2000), note_assertion_id,
         relation_id, placement_id (generated from subject_type/subject_id), principal_id,
         source_kind = 'human', seq,
         check(exactly one of text and note_assertion_id; note_assertion_id iff subject_type in
               ('relation','placement')),
         fk (project_id, relation_id, note_assertion_id) → relation_assertion(project_id, relation_id, id),
         fk (project_id, placement_id, note_assertion_id) → placement_assertion(project_id, placement_id, id))
-- M6 S5c-1 (answering by action; migrations 0013/0014, M6-INTEGRATION-AND-GAPS.md §4.8 b): the check
-- open_question_answer_text_or_note relaxed (an outside mark may have neither text nor note:
-- kind = 'outside-landscape', text and note_assertion_id null, subject_type not in ('relation','placement')),
-- unique('open_question_answer_project_id_unique') on open_question_answer(project_id, id), and
open_question_answer_withdrawal(answer_id pk, project_id, principal_id, source_kind = 'human', seq, created_at,
         fk (project_id, answer_id) → open_question_answer(project_id, id))
-- M6 S5c-2 (model amendments; migrations 0015/0016, M6-INTEGRATION-AND-GAPS.md §4.8 c):
model_amendment(id 'mam_', project_id, model_id, element_id, via_element_id null,
         op in ('call-target','message-name','event-name','process-documentation'),
         before null, after, base_revision_id, supersedes_id null, principal_id, client_id,
         source_kind = 'human', seq, created_at, unique(project_id, id),
         fk (project_id, model_id) → model, fk (project_id, model_id, base_revision_id) → model_revision,
         fk (project_id, supersedes_id) → model_amendment(project_id, id))
model_amendment_withdrawal(amendment_id pk, project_id, reason in ('withdrawn','superseded'), principal_id,
         source_kind = 'human', seq, created_at, fk (project_id, amendment_id) → model_amendment(project_id, id))
-- M6 S2c-4 (the owner's review of revisions stored before the trust rule; migrations 0019/0020):
revision_trust_review(project_id, revision_id, model_id, class in ('modelled','derived'), principal_id,
         client_id, source_kind = 'human', seq, created_at, pk(project_id, revision_id),
         fk (project_id, model_id, revision_id) → model_revision(project_id, model_id, id))
         -- a trigger refuses a revision that carries source.trust or is amended
```

**Amended revisions** (owner decision 25, M6 §4.8 c). The uploaded bytes stay a revision of their own; an amended revision on top of it becomes the head, with `source = {kind: 'amendment', uploader, upstream: {revisionId, rev, contentHash}, amendments: [{id, elementId, op, outcome, reason?}]}`: every live amendment of the model with its outcome (`applied`, `in-source`, or `conflict` with `element-missing`, `value-changed` or `expression`); when nothing applies, the uploaded revision is the head and carries the plan. Every derivation (an amendment, a withdrawal, a re-import, a revival) computes the head from the uploaded revision's bytes with exactly the amendments the plan marks applied, through `applyAmendments` in `@analyzr/bpmn-facts` (byte-preserving splices, never a bpmn-moddle round trip; refused unless the extracted facts read exactly the intended change). A model's head is always its revision with the highest seq, and every revision has its own `model.revised` event. Values are stored in the extractor's sanitized form and never enter events.

`seq` comes from `UPDATE project SET last_seq = last_seq + 1 RETURNING last_seq` in the writing transaction, which serializes writes per project and keeps `seq` dense for cursors. Triggers block UPDATE and DELETE on `event` and the other append-only tables (since M4 also
`value_chain_revision` and `placement_assertion`; a `value_chain_step` row only takes its tombstone; since owner decision 19 both auto-accept rule tables; since M6 S5a `open_question_answer`, since M6 S5c-1 `open_question_answer_withdrawal`, since M6 S5c-2 `model_amendment` and `model_amendment_withdrawal`, since M6 S2c-4 `revision_trust_review`). An item is `answered` while an outside mark (`kind = 'outside-landscape'`, not on a relation or placement subject) without a withdrawal names its id; marking again records a new row, and every other row is a note. The policy limits rule decisions to `call` relations.

## 3. Analysis pipeline

**Ingest** is one transaction: reject DOCTYPE/ENTITY; parse the XML (422 on failure; limits 5 MB per file, 25 MB per import, 50k elements); extract the facts; run the rules; recompute `endpoint_state`; queue a task if needed; write the events.

A `relations` task is queued when the new head's `facts_hash` differs from the previous head's (a revert too, since partners may have judged against the other version meanwhile), and for a new or revived model. Candidates are computed in both directions, so a change to one model never re-queues the others: its re-analysis judges their shared pairs again.

```
 new head, facts_hash ≠ prev head ─┐          requeue (editor), lost judgement
                                   ▼               │
                   ┌──────────► queued ◄───────────┘
   release / lease │               │ claim (lease 15 min, attempts+1)
   expired, < 3    │               ▼
                   └────────── claimed ──── 3rd attempt lost ──► failed
                                   │ submit
                                   ▼
                                  done
 open task + new head with different facts_hash ──► cancelled (new task queued)

 Stage (view model_pipeline)          open_items = relations touching the model that are
   queued  → waiting_for_agent        proposed, held, or accepted with endpoint_state ≠ ok
   claimed → agent_working            (R1: + proposed descriptions; findings never block)
   failed  → agent_failed
   done    → waiting_for_review if any proposed item, waiting_for_clarification if only
             held items, else incorporated
```

The stage shows in `GET /projects/{p}/models?stage=` and MCP `list_processes`, and in the web UI on the project's „Übersicht“ (the phase chips that filter the models table, owner decision 26); humans can review at any stage.

**Review workflow** (UI first, REST for scripts):
1. **Rule tier:** unambiguous calls of modelled callers are accepted at ingest; a human can still reject them. From a derived caller (§2 "Trust rule", since M6 S2c-1) they arrive as rule proposals at 0.9 in the key tier, accepted in bulk with it (since M6 S2c-2 as their own group, which „Gesammelt annehmen“ opens with exactly them selected, so one click settles them before the agent runs) or one by one; the upload's „Vorschau“ and the dry runs name them (`callsProposed`). Since M6 S2c-3 an owner's rule for derived calls accepts those of the source it names in the import's own write, marked and revocable (step 5).
2. **Key tier:** identical message and signal names arrive as proposals with confidence 1.0; a reviewer checks them briefly and accepts them in bulk per tier.
3. **Agent proposals** (lexical, semantic, trigger) form the inbox, sorted by confidence and by how many open items a decision closes. Each card shows both endpoints in bpmn-js, the rationale, the evidence and the agent's optional question. Actions: **accept**; **reject** with a reason, which agents see in their next claim; **hold** with a note and an optional question or label (e.g. "mit Fachbereich Finanzen klären"); **correct**, i.e. accept a different endpoint as a `manual` relation linked to the proposal.
4. **Held items** have their own list. An answer is a note on the relation and reaches the next agent run; the decision is made when the answer is known.
5. **Auto-accept rules** (owner decision 19; in the web UI „Einstellungen › Annahmeregeln“, owners only, since owner decision 26): an owner may let agent proposals up to a chosen confidence accept themselves. A rule names the kind (relations or placements), the server-computed tier (relations `key`, `lexical`, `semantic`; placements `lexical`, `semantic`), an inclusive minimum confidence (at least 0.5) and optionally one relation type, one agent (its token's principal) and one declared LLM model; ad-hoc proposals count only with „Auch Ad-hoc-Vorschläge“. Rules are off by default (no project and no seed has any), never visible to agents, and never retroactive: they evaluate only agent proposals newly recorded by a write (`applied` or `reopened`), at the end of that write's transaction under the project lock, in all four write paths (relations and placement submissions, `propose_relation`, `propose_placement`); open proposals need the explicit **apply** (dry run, then the head revision and `expectedCount`). The first matching rule in creation order is recorded; its author must still be an owner. **Safeguards**, in this order (the first failing one is the reason the preview shows): not an agent proposal (for a rule for derived calls: not the rule tier's proposal of a unique call from a derived model); no matching rule; since M6 S2c-3 a `call` whose caller's revision was uploaded with an agent token (`agent-upload`, for every rule, agent rules included: decision 28 (1); a revision stored since S2c-1, since one stored before carries no class and counts as modelled, option (a), unless the owner reviewed it as derived with the reason `agent-upload`, M6 S2c-4) and, for a rule for derived calls, a call target set in analyzr that no longer applies (`amendment-conflict`, „Ergänzung nicht mehr anwendbar“ open); a pipeline proposal whose basis is no longer current; the item not `proposed`; an endpoint not `ok`; for placements `@outside`, a removed step, a home step already accepted or held (decision 18) and another live proposal of the process on another step (ambiguity, also the agent's own second step); for relations another proposed, held or accepted call from the same element, or (since M6 S5c-1, whose links from „Offene Fragen“ are often `manual` relations) an accepted or held `manual` relation from it to another target (a call has one target; a manual link to the same target agrees and is no second target); any human assertion on the pair or on any placement of the process (decisions, corrections, holds, notes, human proposals, an earlier auto-acceptance or its revocation); an agent question on any live agent proposal; a live no-link on the typed pair; another agent's current `unsure` verdict on the process. So a revoked or human-touched item is never auto-accepted again, and a rule never re-confirms after an endpoint change. An agent's ad-hoc placement proposal never replaces another agent's current `unsure` verdict on the process, so that doubt keeps blocking in later writes, in the preview and in apply alike. Submission and ad-hoc results (and the stored `analysis_submission.result`) report the state **before** the owner's rules ran, so recordings and replays stay independent of a project's rules and agents get no per-item feedback (the claim inputs of later tasks do reflect what a rule accepted). The **preview** replays the project's history (what the rule would have accepted at each agent proposal before the first human decision, with the safeguards as of that moment and what its own earlier firing would have blocked, and how humans then decided: accepted, rejected, corrected, held, giving an empirical precision; an item a human never decided but whose competitor, another target of the call element (a call or, since M6 S5c-1, a human's manual link to another target) or another step of the process, a human accepted counts as corrected; items only a rule decided are shown apart as „nicht geprüft“, never as ground truth), what it would accept now among open proposals with the blocked reasons, and a curve over minimum confidences. **Revoking** (per rule, revision, triggering agent, kind or ids; dry run, then `expectedCount`) records a marked human withdrawal under the decision's principal: an item returns to `proposed` while a live proposal remains, else it turns `obsolete`; while the kind of proposal that triggered the acceptance is still open (an agent's for an agent rule, the rule tier's for a rule for derived calls) the judgement stays current, so judge-once assigns nothing again, otherwise it is treated as a lost judgement and the pair's models are queued again (relations; a revoked placement queues the placement tasks that are due); an item a human decided since is never touched. **Marks:** every human reviewer (editors and owners) sees which acceptances a rule made: „Automatisch angenommen – Regel „…““ in the relation table, review screen, history, queue, chain page and step view, filterable; only the rules themselves, apply and revoke are the owners'. Edits, enables and disables are new immutable revisions; rules are never deleted, and saving a rule whose author is no longer an owner takes it over (also without a change). Decision 9, as amended by decision 24.2 (§2 "Trust rule"), appears on that page as the read-only system rule „Eindeutige Aufrufe“ with the count of its acceptances and, since M6 S2c-1, of its open proposals from derived models (since M6 S2c-2 only those a bulk accept takes as they stand, and the count links to that bulk accept). Since M6 S2c-4 the card adds, for owners and never in the demo, „N vor der Vertrauensregel angenommen – prüfen…“ while the rule tier's acceptances from before S2c wait whose revision would be derived today (decision 28 (3); calls whose target was set in analyzr, calls with a human's or an owner rule's decision in force and calls whose callee is gone are not listed). Its dialog lists those models, all selected, with their reasons and counts and the dry run in one line, and decides each model once: **„Zurück in die Prüfung“** turns the calls into the rule tier's proposals for „Gesammelt annehmen“ (an enabled rule for derived calls may accept them again in the same write; no analysis is queued), **„Behalten“** keeps them accepted, and the model is never listed again. Both send the listed count (`expectedCount`; 409 with the fresh count when the list changed). **Rules for derived calls** (decision 24.2's extension, narrowed by decision 28 (1); since M6 S2c-3): a third „Art“, „Eindeutige Aufrufe aus abgeleiteten Modellen“ (`proposedBy: 'rule'`; every other rule is an agent rule and accepts agent proposals only, so no existing rule starts accepting the rule tier's proposals), accepts the rule tier's proposals of unique calls from derived models whose caller declares the source it names: „Export ohne Camunda-Engine“ (`export`), „Konvertiert“ with exactly one converter (`converted`, `name@version` as stored) or „Ohne Angabe“ (`none`, no kind declared); never reconstructed or as-told. Kind, tier, type and minimum are fixed (relation, `key`, `call`, 0.9, no agent, model or ad hoc; checked by the contract and the database), and whose proposals a rule accepts never changes. The import declares the source and analyzr does not check it. Such rules run in a **fifth write path**: right after the recompute of every head change (imports, PUT, amendment writes and withdrawals), of a model's deletion and (since M6 S2c-4) of an owner's „Zurück in die Prüfung“, in the same transaction under the project lock, over only the derived-call proposals that write recorded (never retroactive; a proposal the rule tier records again on a relation it already proposed, say because the callee changed, counts as new), recorded under the rule's author and caused by the request's actor; a write made with an agent token sets none off. An owner's dry run of an import or a deletion names what they would accept (`autoAcceptedCalls`; nobody else's dry run carries rule data), and preview, apply, the ledger, marks and revocation work as for agent rules. So the unique calls each later import of a source the owner trusts proposes are accepted without a click, marked and revocable (calls already waiting need the rule applied).
6. **Learning loop (R1):** `GET /projects/{p}/eval-export` writes the project's models and decisions in the corpus format (§7), so real review work becomes eval cases.

**Claim and lease:**
- `claim_analysis({projectId?, modelKey?, kinds?, max ≤ 5})` is one `UPDATE … WHERE id IN (SELECT … ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT n)` over queued tasks and expired leases with fewer than 3 attempts, in projects where the caller is at least `editor`; `modelKey` narrows it to one model, `kinds` (default `["relations"]`, so a client written for relations never gets another kind; `GET /analyses/pending` counts the same default) to the task kinds the caller handles. It sets a hashed lease token, `lease_until = now() + 15 min` and `attempts + 1`; expired tasks with 3 attempts become `failed` in the same transaction, so no cron job is needed.
- The claim returns `{taskId, leaseToken, leaseUntil, procedure: {id, version}, input}`. The `input` (≤ ~100 KB) holds the head facts, candidates in both directions (key tier, top 5 lexical matches per endpoint, up to 30 more compatible endpoints) and existing relations, including human rejections, held items, their notes and answered questions. M3 added optional fields within `analyzr-claim/1`, so older inputs still parse: the ends (`from`, `to`) of message flows inside the file, the documentation of partner endpoints and of their processes (`partnerProcesses`), both cut to 300 characters like the model's own, the project's visible findings with a ref in the model (`findings`), and, with judge each pair once (below), `judged` and `skip`; a pair in either list is left out of the candidates. The largest corpus input grew from 68.7 to 80.1 KB with M3 and is 82.0 KB with every task claimed at once (92.9 KB with LLM-sized judgements in `judged`). The input is rendered in the claim transaction under the project lock. XML only comes through `get_model_xml`.
- No renew; `release_analysis` requeues. A late submit passes if token and principal match and the task was not re-claimed or cancelled (else 409 `lease-lost` or `task-cancelled`). A different second submission gets 409 `already-submitted`; replaying a `submissionId` returns the stored result.

```jsonc
{ "taskId": "ana_…", "leaseToken": "…", "submissionId": "<uuid>",
  "procedure": {"id": "analyzr-relations", "version": "0.2.0"}, "llmModel": "claude-sonnet-5-5",
  "relations": [{"type": "message", "from": "order/handle#Evt_shipped", "to": "billing/invoice#Start_shipped",
                 "confidence": 0.82, "rationale": "…", "evidence": ["order/handle#Evt_shipped"], "question": null}],
  "noLinks": [{"type": "message", "from": "…", "to": "…", "reason": "no-evidence: …"}], "summary": "≤500 chars", "costUsd": 0.12 }
```

**Validation.** Every ref must exist in the head facts (no hallucinated elements); one endpoint lies in the task's model; types fit endpoint kinds; confidence is in [0, 1]; rationales ≤ 1,000 and questions ≤ 500 characters; ≤ 200 relations and ≤ 500 no-links. Each item comes back as `applied`, `duplicate`, `suppressed` (a human accepted or rejected and the fingerprints are unchanged; an agent's confirmation of a held pair is recorded as its judgement instead, and the hold stays), `reopened` or `invalid:<reason>`; each no-link (typed: without a `type` the server takes the one type the ends fit) as `stored`, `duplicate` or `invalid:<reason>`. Payloads are stored verbatim for the eval, and reviewers can bulk-reject a whole submission.

**Judge each pair once** (procedure `analyzr-relations@0.2.0`; the owner's requirement of 2026-10-08: no work may happen twice, also with several agents):
- An agent judgement is a live pipeline proposal or a live no-link. Its basis is the `facts_hash` of both endpoint models as the agent saw them at its claim, plus the declared procedure; it is current while both models and the procedure are unchanged.
- The claim assigns each `rule`, `key` and `lexical` candidate pair and each relation (whatever its pair's basis; not one with a missing end) without a current judgement or a settling decision (accepted, or rejected with unchanged endpoints; held pairs are judged) to exactly one analysis: a partner's live claim that holds it, else the partner's queued task if its key sorts first and the pair is among its assigned pairs, else this claim, which stores it as its assignment. The input lists the current judgements on the model's pairs (`judged`, any agent, the claimant's own included) and the pairs a partner judges (`skip`). The other `compatible` candidates are nobody's assignment, only the search space for missing partners.
- A submission withdraws the judgements made on another version of its model or under another procedure; current ones stay without repetition, and a duplicate needs the same basis. A new judgement of the same principal in an analysis of the same model replaces its earlier one on the pair (a no-link also when it comes back `duplicate`); other judgements coexist, so disagreements stay visible: reviewers see current no-links on the relation (`Relation.noLinks`), in the review screen and as a flag in the bulk dialog, and every one, also on pairs without a relation, in the inbox tab „Kein Zusammenhang“ (`GET …/no-links`); the relation's version moves whenever they may change (a no-link stored or withdrawn, a new `facts_hash` of an endpoint model). `uncovered` reports assigned pairs left without a verdict, also on a late submit after the task failed; nothing is queued for them.
- A judgement lost outside an analysis (a revoked token, `withdraw_proposal`) queues both endpoint models again, or makes a claimed task queue a follow-up when it is submitted.
- Double work that remains: a `compatible` pair that two concurrent partner searches both examine, re-claims after a lease expired, and candidate-cap drift between two claims (the pair then stays unjudged until one of its models changes).

**Requeue.** A new revision with a changed `facts_hash` cancels the open task and queues a new one. Same facts, or another model's change, only update `endpoint_state`; a lost judgement queues its models (above). A deleted model turns partner relations `missing` (open items). An extractor change bumps `FACTS_VERSION`, which reaches revisions ingested afterwards (stored facts are not extracted again: there is no reindex yet; one with judgement carry-over is a later candidate, M6 §6), and a procedure upgrade uses `POST …/analyses/requeue {modelKeys | all}` (`analyzr models requeue`; `{valueChain: true}` for the placement task, `analyzr value-chain requeue`).

**Task kinds** (M4b, [M4-VALUE-CHAIN.md](M4-VALUE-CHAIN.md) §3.2): `relations` (subject: a model revision, procedure `analyzr-relations`) and `placement` (subject: the project's value chain, procedure `analyzr-placements`; the agent places processes on the chain's steps). The claim result carries `kind` and the input of that kind (`analyzr-claim/1` or `analyzr-claim-placement/1`); `submit_analysis` takes flat optional fields per kind (`relations`/`noLinks` or `placements`/`unsure`; a field of the other kind is 422 `wrong-task-kind`). The chain's stage (view `value_chain_pipeline`) maps like a model's. **Judge each process once** holds for placements as judge each pair once does for relations:
- A process's **input hash** (`analyzr-placement-input/1`) covers what a claim shows of it and nothing else: the expected procedure, the process ref, a digest of the process's own fields (name, lanes, start and end labels, documentation as cut), a digest of the chain's steps as the claim lists them (names normalized, kinds, parents, children, resolved links, the `sequence` connections) with its live step generations, the neighbours through accepted relations with their accepted steps, and the last non-agent placement assertion the claim shows (a human decision, a note, also on an open proposal, a rule-tier proposal or withdrawal). Agent proposals, withdrawals and relation proposals are left out, so agents never re-trigger the pipeline; org units, layout and the rest of the process's model are left out, so an organisational edit or a change to a sibling process re-offers nothing.
- A process is **open** without an accepted or held placement on a live step, and **due** while open and its input hash differs from its `placement_input` row (the memory of the last agent verdict: `proposed`, `unsure` with the reason, or `skipped`). At most one placement task per chain is open (a partial unique index), its claim is rendered under the project lock and lists up to 50 due processes within a 96 KB budget; follow-ups are queued only at submit (after a truncated claim that recorded a verdict, or when the chain or the models changed during the lease). `list_unplaced_processes` marks the processes of a claimed task (`inTask`, while its lease runs) as well as those with a current verdict (`judged`), so an agent working without a task skips them. So no two claims judge the same process, and an unsure or skipped process comes back only when its input changes. Double work that remains: a re-claim after a lease expired (the first agent's work is lost, a late submission can repeat verdicts given meanwhile), an ad-hoc agent that listed processes before a claim took them and proposes them afterwards, and two concurrent ad-hoc sessions (`place_processes`) on the same processes.
- A submission withdraws, for its input's processes, the live pipeline proposals of any agent made on another basis (the steps or the process as their claim showed them, the procedure) and the caller's own it does not repeat; other agents' current proposals stay. Ad-hoc agent proposals (`propose_placement`) count as the agent's verdict on those processes too. Saves of the chain never cancel a claimed task: items are checked against the head at submit time (`invalid:unknown-step`). Human decisions and notes make processes due but queue nothing; a reviewer queues the task on the value chain page or with `analyzr value-chain requeue`, and the server start queues the first task of a chain that never had one (chains from before the pipeline).

## 4. Where the truth lives: store vs Git/OKF

| Requirement | analyzr DB | Git/OKF as store |
|---|---|---|
| Agent claims and leases | `SKIP LOCKED` | commits race; a rejected push is not a lease |
| "Which processes throw message X" | indexed `fact` | re-parse files, or build an index (a DB) |
| Per-project authorization via OIDC | domain policy | git-host permissions |
| Concurrent review clicks | a transaction each | a commit each, with conflicts |
| Users without Git | upload | the server commits for them with git credentials |
| Offline reading, diffs, PR review | via export | native |
| Build cost | low | high (clone, merge, credentials, webhooks) |

Git only wins in rows a read-only export covers too. **Decision: hybrid, but asymmetric.** Postgres is canonical for everything computed or decided; BPMN bytes are canonical at their origin (the uploaded revision for uploads, kept as it came; a linked repo, later, mirrored with `source={repo,commit,path}` and closed to UI upload). Since owner decision 25 a model's head may be an amended revision computed from its uploaded revision by analyzr's amendments (M6 §4.8 c): its bytes are analyzr's, derived again from the uploaded bytes whenever the amendments or the upload change, and downloadable next to the original (`getRevisionContent` of either).

**Import.** Every adapter yields `{path, bytes, sha256, source}` for `ingest(projectId, files, actor)`; the model key is the slugified path (`modelKeyFromPath`, with the BPMN file rule `.bpmn`, `.bpmn2`, `.bpmn20.xml`, `.xml` in `@analyzr/contracts`, shared by the server, the CLI and the web since M6 S1). Upload/`PUT`, the web upload and `analyzr import <dir>` ship in v1 (the CLI derives every key before sending and refuses a key twice across its batches; extractor warnings come back in the results, and since M6 S2a each revision stores them), a one-shot bpmiq.yml import (vendored MIT `content.ts`) in R2, linked sync and OKF restore later. Since M6 S2a an import bundle's manifest `analyzr-import.json` (`analyzr-import/1`, the multipart part `manifest`, or the header `Analyzr-Manifest` of a PUT) pins keys and declares provenance, stored on the uploaded revision and never in facts; `GET …/external-ids` lists each live model's identity in its source system (M6 §3.2–§3.4).

**OKF projection (R1, minimal).** Each project head exports as one OKF 0.2 bundle. Leases, memberships and agent tokens are never exported.

```
<project-key>/
  index.md                                     # okf_version: "0.2"
  models/<model-key>.bpmn                      # head bytes, verbatim: uploaded or amended (decision 25)
  processes/<process-id>.md                    # type: Process; sources → /models/<key>.bpmn#<process_id>
  relations/<type>--<from>--<to>--<hash8>.md   # type: Process Relation; from/to → #element_id, analyzr: {state, tier, …}
```

| analyzr state | `status` | Trust fields |
|---|---|---|
| proposed | draft | `generated.by`: `analyzr-relations/0.1.0`, `analyzr-rules/1.0.0` or `human:<handle>` |
| accepted by a human | stable | `verified: [{by: human:<handle>, at}]` |
| accepted by a rule | stable | `verified: [{by: analyzr-rules/1.0.0, at}]` (machine-confirmed) |
| accepted by an owner's auto-accept rule (decision 19) | stable | `verified: [{by: auto-accept:<rule id>@r<revision>, at}]` (machine-confirmed under the owner's rule, never `human:<handle>`) |
| rejected | deprecated | `analyzr.decision`, no `verified` |

Rejected relations are exported on purpose, so offline agents do not propose them again. Freshness binds to fingerprints, not to `verified.at` versus `generated.at`. Handles are pseudonymous; no e-mail addresses or `sub` values. The export is deterministic (sorted keys, no timestamp; tested for byte-identical output and resolvable links). Compost compatibility is not a goal. One renderer feeds the zip, `GET …/okf/{path}` and MCP resources; analyzr never reads its `.md` files back.

## 5. Interfaces

**HTTP (`/api/v1`):** typed ULIDs; RFC 9457 problem+json; cursor pagination; OpenAPI 3.1 from zod, checked by `oasdiff breaking`; idempotent via `content_hash` and `submissionId`; optional `If-Match` on decisions; landscape ETag `"s<seq>"`.

| Resource | Methods |
|---|---|
| `/me`, `/me/invitations`, `/invitations/{inv}/accept` | GET, GET, POST |
| `/projects[/{p}]`, `…/members` (users, and services as `(iss, client_id)`), `…/invitations` | CRUD (create: any user; other writes: owner) |
| `/projects/{p}/summary` (UX9) | GET (permission `read`, REST only): `lastEventAt` and the open work as counts, `reviewItems` (relations to review), `openPlacements` (the chain's open placement items) and `ask` (the open questions „Zu klären“), the same rules as the project's tab badges; memoized per project event, so the projects list's rows stay cheap. `Project` (MCP `list_projects`) is unchanged |
| `/projects/{p}/agent-tokens[/{t}]` | GET, POST (secret shown once), DELETE |
| `/projects/{p}/models?stage=`, `…/models/{m}[/revisions/{r}/(content\|facts)]` | GET, DELETE |
| `/projects/{p}/models/by-key/{key}` | PUT raw BPMN → 201 new model, 200 new revision, 200 `unchanged`; a new model or revision carries the extractor's `warnings` (≤ 20) and `warningCount` when there are any; for a model with live amendments (M6 S5c-2) also `amendments: {applied, inSource, conflicts}` (counts and ≤ 20 ids) and, when an amended head was written on top, `uploadedRevisionId` (`revision` is the final head); since M6 S2a the optional header `Analyzr-Manifest` (base64url of a one-file `analyzr-import/1` manifest) declares the file's provenance, `importWarnings` (`manifest-sha-mismatch`, `external-id-moved`, `external-id-changed`, `provenance-kept`, since M6 S2c-1 `trust-kept`) come back when there are any, and an invalid manifest is 422 `validation-failed` (`invalid-manifest`) |
| `/projects/{p}/imports` | POST ≤ 50 files, outcome per file (with the extractor's warnings, the amendments and the import warnings, as PUT); since M6 S2a the optional part `manifest` (`analyzr-import.json`) pins the keys and declares the provenance of the files it lists |
| `/projects/{p}/external-ids?system=` (M6 S2a) | GET (permission `read`): each live model's identity in its source system (key, system, tool id, tool folder) as its uploaded revision declared it, to rebuild a lost key map (M6 §3.4) |
| `…/models/{m}/elements/{elementId}/amendable` (M6 S5c-2) | GET (permission `read`, `ETag: "r<headRev>"`): the fields of the element an amendment can set, their values, why not, suggestions and history (M6 §4.8 c) |
| `…/models/{m}/amendments?dryRun=` (M6 S5c-2) | POST (permissions `review` and `write`, humans only; `If-Match: "r<headRev>"` required, 428/412): up to 20 amendments of one model; an amended head computed from the uploaded revision, with the effect at the element and the cost (pairs to re-judge, a claimed task) |
| `…/amendments` (`?modelKey=&state=`), `…/amendments/export?format=markdown\|csv&since=` (M6 S5c-2) | GET (permission `read`): every amendment with its state; the change list for the source tool, grouped per model, what to carry over first |
| `…/amendments/{a}/withdrawal`, `…/models/{m}/amendments/withdrawal` (`?dryRun=`, optional `If-Match: "r<headRev>"`) (M6 S5c-2) | POST (permissions `review` and `write`, humans only): withdraws one, or every live amendment of a model, with one re-derivation (a new revision; none on a deleted model); the dry run answers the cost |
| `/projects/{p}/landscape`, `…/relations[/{rel}]` | GET; POST to propose or add a manual relation |
| `…/no-links` (`?modelKey=`) | GET: agents' live, current no-links, also on pairs without a relation |
| `…/open-questions` (`?modelKey=&kind=&source=&askWho=&state=&group=`, `group` repeatable, cursor pages), `…/open-questions/export?format=markdown\|csv` (same filters) (M6 S4, UX2a) | GET (permission `read`): the open-questions read model, computed on read and never stored (M6 §4.2); each item with its `group` (`ask` „Zu klären“, `agent`, `proposal`, `info`); a page also carries `totals` (per group, under every filter but `group`) and `askByModel` (the `ask` subjects per model that are neither a relation nor a placement). The export is an attachment named after the filters; without `group` it holds only the `ask` items (unless `kind` or `source` names what to export) and keeps the old file name for that default; it writes dates and „Betrifft“ in names instead of event numbers and refs, the id only as an HTML comment (Markdown) or in the `id` column (CSV) |
| `…/open-questions/{q}/answers`, `…/open-questions/answers?dryRun=` (M6 S5a, without answer kinds since S5c-1) | POST (permission `review`, humans only): one note, or the rows of a filled-in CSV sheet in one transaction; on a relation or placement the text is a human note through the note use cases, else it stays in `open_question_answer` (M6 §4.5, §4.8 b); a note never makes an item `answered` |
| `…/open-questions/{q}/actions` (M6 S5c-1) | POST (permission `review`, humans only): one of the item's actions, body discriminated by `type`: `link` (a live typed proposal accepted as the human's decision, else an accepted `manual` relation), `place` (`acceptManualPlacement`), `choose-copy` (the calls towards a duplicated process id's copies decided all or nothing, the other copies optionally on `@outside`), `outside` (the outside mark); one transaction under the project lock; 404 for an item whose source changed, 422 `action-not-offered` (M6 §4.8 a) |
| `…/open-questions/{q}/answers/{a}/withdrawal` (M6 S5c-1) | POST (permission `review`, humans only): withdraws an outside mark („Rückgängig“); a note is refused (422 `not-an-outside-mark`) |
| `…/relations/{rel}/decision` (`accept`, `reject`, `hold`), `…/decisions` | POST; bulk needs ids, versions and `expectedCount` |
| `/projects/{p}/value-chains[/{key}]`, `…/{key}/content` (`If-Match: "r<rev>"`, `If-None-Match: *`, `?dryRun=true`), `…/revisions[/{rev}/content]`, `…/steps/{id}`, `…/findings`, `…/unplaced-processes` (M4) | GET, POST, PUT, DELETE (writes: humans only) |
| `…/value-chains/{key}/placements[/{plc}]`, `…/{plc}/decision`, `…/placements/decisions`, `…/{plc}/notes`, `…/{plc}/assertions`, `…/{plc}/proposal` (M4) | GET; POST to propose or add a manual placement; decisions, bulk and notes by humans; DELETE own proposal |
| `/projects/{p}/auto-accept-rules[/{rule}]` (`ETag`/`If-Match: "r<rev>"` on the rule), `…/auto-accept-rules/preview`, `…/auto-accept-rules/{rule}/apply?dryRun=`, `/projects/{p}/auto-accept-revocations?dryRun=`, `/projects/{p}/auto-accepted?kind=&ruleId=&state=&agentPrincipalId=` (owner decision 19) | GET, POST (201 with `"r1"`), PUT (a new revision; 428 without `If-Match`, 412 `revision-conflict`); POST preview, apply and revocation (409 `conflict` with the fresh count); GET the ledger. Owners only, except the ledger (every human reviewer: permission `review`); no MCP counterpart |
| `/projects/{p}/pre-trust-calls`, `…/pre-trust-calls/review?dryRun=` (M6 S2c-4, decision 28 (3)) | GET „Vor der Vertrauensregel angenommen“ by model (the uploaded revision, reasons, count, up to 100 calls each); POST a review `{verdict: 'derived'\|'modelled', revisionIds, expectedCount}`, the dry run first; 409 `conflict` with the fresh `count` (`count-changed`, or `not-listed`, which the dry run answers too), 422 for a classified, amended or unknown revision or a missing `expectedCount`. Owners only; no MCP counterpart |
| `/projects/{p}/eval-export` | GET (R1) |
| `/analyses/claim`, `/analyses/{a}/submission\|release`, `/analyses/pending?wait=30` | POST, POST, GET |
| `/projects/{p}/analyses[/requeue]`, `…/events?after=&wait=30` | GET/POST, GET long-poll |

Problem types: 422 `validation-failed`, `bpmn-invalid`, `value-chain-invalid` (with per-element `violations`), `value-chain-unsupported-version`; 404 `not-found` (also for ids from other projects); 403 `insufficient-scope`, `human-decision-required`; 409 `lease-lost`, `task-cancelled`, `already-submitted`; 412 `precondition-failed`, `revision-conflict` (with `headRev`); 428 `precondition-required` (a value chain save without `If-Match`).

**MCP** is stateless Streamable HTTP on `/mcp`. In v1 (local mode, §6) every client sends an agent token as bearer, and the `analyzr mcp` command bridges stdio-only clients such as Claude Desktop to it. Server mode (R1) adds OAuth discovery on `/mcp` and `/mcp/bearer` without it. With the 2.x SDK it speaks 2026-07-28 and negotiates 2025-11-25 and older; the 1.32 fallback tops out at 2025-11-25. The lease travels in tool arguments, so no session state is needed. Every tool except `list_projects`, `get_procedure` and the pipeline tools requires `projectId`. `claim_analysis` takes it optionally, and `submit_analysis` and `release_analysis` identify the task by `taskId` and `leaseToken`. Read tools carry `readOnlyHint`.

| Tool | Scope | Ships |
|---|---|---|
| `list_projects`, `list_processes` (with `stage`), `get_process`, `get_model_xml`, `get_relations`, `which_processes_use`, `find_unlinked_events`, `get_procedure` | read | MVP |
| `claim_analysis`, `submit_analysis`, `release_analysis` | propose | MVP |
| `get_landscape`, `propose_relation`, `withdraw_proposal` | read, propose | v1 |
| `get_value_chain`, `get_value_chain_document`, `list_unplaced_processes`, `propose_placement`, `withdraw_placement_proposal` | read, propose | M4 (S2) |
| `put_model` (≤ 1 MB), `requeue_analysis`, `impact_of`, `trace_landscape_path`, `get_findings` | write, read | R1 |

There is no decide tool; an attempt returns `human-decision-required` with the review URL (the stubs `decide_relation` and `decide_placement` exist only to say so). Prompts and `instructions`: §7. Resources: `analyzr://projects/{p}/models/{key}.bpmn` and `…/landscape.json`.

**Events:** `model.revised|deleted`, `analysis.queued|claimed|done|failed`, `relation.proposed|decided|endpoint_changed`, `value_chain.created|revised|deleted`, `placement.proposed|withdrawn|decided|noted|endpoint_changed` (M4), `auto_accept_rule.created|revised|applied` and `auto_accept.revoked` (owner decision 19; ids, revision and counts, never criteria), `open_question.answered` (M6 S5a; question id, kind, subject, target and the note's id, never the text), `open_question.answer_withdrawn` (M6 S5c-1), `model.amended` and `model.amendment_withdrawn` (M6 S5c-2: the recorded and superseded amendment ids, element ids and ops, or the withdrawn id, op and reason, never a value; an amended revision has its own `model.revised` with `source.kind: 'amendment'`, after `model.amended` in the same transaction), `revision.trust_reviewed` (M6 S2c-4: the reviewed revision ids, the class and the count of listed calls), `member.changed`, `agent_token.created|revoked`. An auto-acceptance is a `relation.decided`/`placement.decided` event whose principal is the causer (the agent whose proposal triggered it, or the owner who applied the rule; for a rule for derived calls in its write path, the person whose write recorded the proposal) and whose payload names the deciding owner and `autoAccept: {ruleId, revision, triggerId}`; a revocation is a `*.withdrawn` event with the same marker. Unmarked events are unchanged. Long-polls wait on Postgres `LISTEN`; webhooks will read the same table.

## 6. Auth and authorization

**Local mode (v1, `ANALYZR_AUTH=local`).** analyzr runs on the user's machine (`docker compose up`, Postgres included) and needs no IdP. The server binds to 127.0.0.1 only and rejects requests whose `Host` or `Origin` is not localhost (DNS rebinding, CSRF). The web UI and REST calls with the local session act as the single owner, a human on an interactive client. Every MCP client uses an agent token from the "connect an agent" page, which also prints ready-made configurations:
- **Claude Code, Cursor, VS Code, Codex:** HTTP `http://localhost:<port>/mcp` with `Authorization: Bearer analyzr_at_…`, e.g. `claude mcp add --transport http analyzr http://localhost:<port>/mcp --header "Authorization: Bearer ${ANALYZR_TOKEN}"`.
- **Claude Desktop and other stdio-only clients:** an entry in `claude_desktop_config.json` that starts the bridge `analyzr mcp` (reads `ANALYZR_URL` and `ANALYZR_TOKEN`; from the repo checkout via `node`, or `docker exec -i` into the analyzr container) and forwards stdio to `/mcp`. Remote custom connectors are not used in v1: they connect from the vendor's cloud and cannot reach localhost. An npm package and a Desktop Extension follow with a first release (packages stay private until then, §9).

**Read-only demo (`ANALYZR_DEMO=readonly`, owner decision 20.** A variant of local mode for a public URL, not server mode: no login, nobody writes. The server answers every method other than GET, HEAD and OPTIONS with 403 `demo-readonly` before authentication (only `POST`/`DELETE /api/v1/session` pass; a session body over 4 KiB answers 413 before it is read), every session is the visitor (a user with `analyzr:read` only and the viewer role in every project, so the policy denies writes too), `/mcp` answers 404, any credential 401, and the server connects as a database role whose transactions are read-only. Host and Origin follow `ANALYZR_PUBLIC_ORIGIN` instead of localhost; `ANALYZR_PUBLIC_ORIGIN` without the demo is refused, so local mode cannot be opened by it. `/health` reports `demo: "readonly"` and, when the operator set them (`ANALYZR_DEMO_IMPRINT_URL`, `ANALYZR_DEMO_PRIVACY_URL`, demo only), its legal notice and privacy policy; the web UI shows a banner with those links and no write action. The demo image (`docker/Dockerfile.demo`) bakes the seed in at build time and starts from it on every start (DEVELOPMENT.md "Demo deployment (Fly.io)").

The domain policy is the same in both modes; local mode simply has one human principal. Server mode (R1) adds users, memberships, invitations and OIDC:

**Resource server (server mode, R1).** analyzr is never an authorization server or OAuth proxy; agent tokens are API keys for analyzr itself. `ANALYZR_PUBLIC_URL` defines the canonical resource `https://<host>/mcp`, the audience for REST and MCP alike; users enter exactly this URL. `/.well-known/oauth-protected-resource/mcp` (RFC 9728) returns it, exactly one authorization server (some clients may read only the first; spike) and `scopes_supported: analyzr:read analyzr:propose`. Unauthenticated calls to `/mcp` get 401 with `WWW-Authenticate: Bearer resource_metadata="…", scope="analyzr:read analyzr:propose"`; a missing scope gets 403 `insufficient_scope`. Every other `/.well-known/` path on analyzr's origin answers 404 and never the web app's fallback page, including the root `oauth-protected-resource`, `oauth-authorization-server` and `openid-configuration`. `/mcp/bearer` answers 401 without `resource_metadata`, for clients that drop configured headers once discovery answers (Cursor, some VS Code setups).

**Token validation** reads the header only, on REST and MCP. `Bearer analyzr_at_…` is looked up in `agent_token`; anything else is a JWT checked by `jose` against the issuer's JWKS: `iss` exact, `aud` in `ANALYZR_AUDIENCE` (default: the canonical resource), `exp`/`nbf` with 60 s skew, RS256, PS256 or ES256. Without an audience the server will not start, except with `ANALYZR_AUTH=dev`. Identity is `(iss, sub)`, never the e-mail; the client is `azp`, `client_id` or `agt_…`. analyzr never forwards a token.

**Clients in server mode.** Registration is IdP configuration, not analyzr code.

| Client | Credential | Notes |
|---|---|---|
| Claude Code (subscription or API key) | user OAuth | `claude mcp add --transport http … --client-id analyzr-mcp --callback-port <port>` (whether a public client works without `--client-secret`: spike) |
| Claude Desktop, claude.ai, Claude Code Routines (via claude.ai connectors), ChatGPT developer mode | user OAuth | `analyzr-mcp` as custom client (for ChatGPT documented only by third parties; auth spike), or DCR; public URL |
| VS Code, Cursor, Gemini CLI, Codex | user OAuth or agent token | `analyzr-mcp` or DCR; header-only setups use `/mcp/bearer` |
| Claude Code `-p`, Agent SDKs (Claude, OpenAI), TS MCP SDK, CI | agent token or IdP client-credentials token | operator's secret store |
| Claude Managed Agents (vault `static_bearer`), OpenAI Responses API, Claude API MCP connector | agent token or bearer minted per request | public URL |

"Public URL": the vendor's cloud calls analyzr (check the vendor's published egress ranges before allowlisting), so analyzr and the IdP must be reachable from there; local Compose suffices for clients that connect from the developer's machine (Claude Code, VS Code, Cursor, Gemini CLI, Codex); Claude Desktop's custom connectors connect from Anthropic's cloud.

**IdP setup (server mode).** Keycloak 26.8, realm export in a Compose profile:
- `analyzr-web` (PKCE), `analyzr-cli` (PKCE, device flow) and `analyzr-mcp` (public, PKCE S256, refresh-token rotation, redirect URIs of the known clients).
- An Audience mapper in a realm default client scope gives every token, DCR clients included, the canonical `aud`. Experimental resource indicators and CIMD stay off.
- Optional anonymous DCR, limited by Trusted Hosts, Allowed Client Scopes and Max Clients, plus cleanup, since claude.ai registers per connection and Gemini CLI per login.
- `analyzr-mcp` and DCR clients can never obtain `analyzr:review`.

WorkOS: CIMD, DCR and a resource indicator for the canonical resource. Tokens requested without `resource`, such as M2M tokens, carry the environment client id as `aud`, which `ANALYZR_AUDIENCE` may include only with the `org_id` gate.

**Agent tokens (MVP)** are the universal machine credential: every headless client accepts a static bearer, while Keycloak has no personal access tokens, Managed Agents cannot run client credentials, and project owners are often not IdP admins.
- `analyzr_at_<32 random bytes, base62><checksum>`, recognizable by secret scanners; stored as sha256 plus an 8-character prefix.
- One project; scopes from `analyzr:read`, `analyzr:propose`, `analyzr:write`, never review or owner actions; mandatory expiry (default 90 days, at most 365); revocation within 30 s; `last_used_at`.
- Created and revoked only by an owner on an interactive client; never advertised in the PRM.

**IdP client credentials** need no extra code: an owner registers `(iss, client_id)` as a service with a role of at most `editor`.

**Principals and provenance.** The system principal `analyzr-rules` may only accept `call` relations during ingest, and since M6 S2c-1 only those of a modelled caller (decision 24.2; from a derived caller it proposes, §2 "Trust rule"); it never records or withdraws a model amendment (carrying a value over from the source tool is computed, never written). A model amendment and its withdrawal (M6 S5c-2) are a human decision about content that writes a revision, so the use cases require both `review` and `write` (scopes do not nest that way; a review-only scope gets `insufficient-scope`, an agent `human-decision-required`). An amended revision's own `uploader` and `principal_id` are those of the request that caused it (the human for an amendment or a withdrawal; the importer at a re-import or a revival); readers of provenance and the trust class follow `source.upstream` to the uploaded revision, except that a call target a human set by amendment counts as modelled (decision 25.2, M6 §3.10). An owner's auto-accept rule (owner decision 19) decides as the human author of the rule revision in force, with `source_kind = 'human'` and the marker of §2; the event names the agent (or the owner applying the rule; for a rule for derived calls in its write path, the person whose write recorded the proposal) as causer. Agent tokens get 403 `forbidden` on every rule route and, since M6 S2c-4, on the review of the acceptances from before the trust rule (403 `human-decision-required` on the ledger of acceptances, which every human reviewer reads), and no MCP tool, resource or claim input carries rule data: claim inputs show an auto-accepted item as a plain human `accept`, and a revocation's rationale („Automatische Annahme widerrufen“) names no rule. Interactive clients are listed in `ANALYZR_INTERACTIVE_CLIENTS` (default `analyzr-web,analyzr-cli`), never `analyzr-mcp`, DCR or CIMD ids. `source_kind` is derived, never sent: `human` is a user on an interactive client, `rule` the system principal, `agent` everything else, including a person chatting in claude.ai or ChatGPT.

**Permission = scope ∩ role ∩ principal rule:**

| Capability | Scope | Min role | Principal |
|---|---|---|---|
| Read | `analyzr:read` | viewer | any |
| Propose, claim, submit, release, withdraw own | `analyzr:propose` | editor | any |
| Ingest, delete models, requeue | `analyzr:write` | editor | any |
| Decide, create an accepted manual relation | `analyzr:review` | editor | user on an interactive client |
| Members, invitations, services, agent tokens, delete project | `analyzr:write` | owner | user on an interactive client |
| Auto-accept rules: list, preview, create, edit, apply, revoke (owner decision 19; permission `admin`) | `analyzr:write` | owner | user on an interactive client |
| „Vor der Vertrauensregel angenommen“: list, review (owner decision 28 (3), M6 S2c-4; permission `admin`) | `analyzr:write` | owner | user on an interactive client |
| Auto-accept ledger: which acceptances a rule made, for the marks (owner decision 19; permission `review`) | `analyzr:review` | editor | user on an interactive client |

Scopes nest (review ⊇ propose ⊇ read, write ⊇ read); higher scopes come through a 403 challenge. An agent token acts as `editor` (`viewer` if read-only). Any user may create a project and owns it.

**Tenancy:** one deployment per tenant; an optional gate `ANALYZR_REQUIRED_CLAIM=org_id:<id>` fails closed. **Invitations** (14 days) need explicit acceptance with `email_verified`, a matching normalized e-mail and an interactive client. **Enforcement:** every use case starts with `policy.require(actor, perm, projectId)`, repositories only expose `findInProject`, foreign ids return 404, and a generated matrix tests use case × role × principal kind × credential type × foreign project.

| Agent threat | Mitigation |
|---|---|
| Prompt injection via labels, documentation, rationales | Agents cannot decide (policy and DB check); refs are validated; labels capped at 200 characters, documentation at 2,000, control and bidi characters stripped. |
| Data reaching an unwanted vendor | Agents send what they read to their model vendor. The IdP decides which clients connect; agent tokens read one project; tool pages hold ~100 KB; analyzr tools reach nothing outside; rationales render as plain text under a strict CSP. |
| Leaked credential | Agent tokens: one project, no review, expiry, revocation, hashed, scannable. JWTs: exact audience. |
| Flooding, careless bulk accept | ≤ 200 relations per submission, one open task per model, `expectedCount` on bulk accept; revoking a token or service withdraws its proposals. |
| An agent on a human channel | No agent setup holds a `analyzr-web` or `analyzr-cli` token. **Remaining risk:** an agent driving the user's browser or CLI. |
| Lease replay, spoofed provenance | 256-bit lease tokens, hashed, bound to principal and task. `source_kind` and client come from the credential; procedure and model are only declared. |
| Confidence gaming once auto-accept rules exist (owner decision 19) | Rules are invisible to agents (no MCP tool, no rule data in resources, results report the state before rules ran); procedure texts are unchanged; rules can be narrowed to one agent and one declared model; a 0.5 floor; the safeguards (stale basis, questions, no-links, competing calls and steps, any human involvement); the preview's empirical precision and the `eval:replay` what-if before choosing a threshold; bulk revoke per rule or agent. **Remaining risk:** an agent can still notice acceptances through `get_relations` and its timing. |
| Calls an LLM, a converter or an agent produced, accepted unseen (owner decision 24.2) | The trust rule (§2, M6 S2c-1): a unique call from a revision without a Camunda engine, uploaded with an agent token or declared converted, reconstructed or as-told is only proposed; the class is set by the server, declarations can only lower it, and unchanged bytes keep it (`trust-kept`). Since M6 S2c-3 only an owner's rule for one declared source accepts such calls without a click (marked, revocable, off until enabled), never reconstructed or as-told ones and never those of an agent token's upload (`agent-upload`, for agent rules too; for revisions stored since S2c-1 or, since M6 S2c-4, stored before and reviewed `derived` with the reason `agent-upload`; other older ones count as modelled), and no write made with an agent token sets such a rule off. Since M6 S2c-4 the owner reviews, once per revision, the rule tier's acceptances from revisions stored before S2c that would be derived today (one list, one decision per model). **Remaining risk:** a rule for derived calls trusts the source the import declares, which analyzr does not check; only the caller's class counts, so a call whose callee an agent token uploaded can still be accepted by such a rule in a human's later write or by apply; `uploader: human` is the credential kind, not a person; a non-Camunda file that declares a Camunda namespace and is uploaded by a human counts as modelled; an agent upload whose process id makes a modelled caller's unresolved call unique gets that call accepted (decision 9's exposure; low while the toolkit's tokens carry no write scope, M6 §10.1); revisions stored before S2c keep their acceptances until the owner reviews them (after „Behalten“ until the model is uploaded again with other bytes, whose new revision carries the trust rule's class); for one stored before S2a the list tells the uploader by the principal's kind (a service principal counts as an agent), and an accepted call whose callee is gone is not listed. |
| A leaked agent token with rules in force | The token is project-bound and revocable; its open proposals are withdrawn on revocation, its auto-acceptances stay (they are owner decisions) and are revoked in one step per agent (the agents page offers it with the token revocation; „Annahmeregeln“ revokes per agent at any time). |

## 7. Agents and procedures

**Procedures** are the analysis instructions, written once in `packages/procedures/*.md` with frontmatter `id`, `version`, `title`, `status`, an optional one-line `description` and, for a task kind other than the default, `kind` (e.g. `analyzr-relations@0.2.0`: `0.1.0` was released with M3, `0.2.0` replaced it before any live run to judge each pair once; `analyzr-placements@0.1.0`, `kind: placement`, M4b). Each calls a deterministic tool first and judges only what code cannot decide. Interactive prompts that are no versioned procedure live in `packages/procedures/prompts/` (`draft_value_chain`), which `listProcedures` never reads.

| Procedure | Output | Suggested model |
|---|---|---|
| `relations` (MVP, pipeline) | link and no-link verdicts with confidence, rationale, evidence | Sonnet class, e.g. `claude-sonnet-5-5` |
| `placements` (M4b, pipeline kind `placement`; ad hoc with `place_processes`) | one placement per process (a step or `@outside`) or an unsure verdict, with confidence, rationale, evidence | Sonnet class |
| `describe` (R1, tasks) | short (≤ 255 chars) and long text, DE and EN, proposed | `claude-haiku-4-5-20251001` if the eval holds |
| `landscape` (R1, questions) | answers, no writes | any |

**Delivery** to any MCP client, from that one source:
- Server `instructions`: labels are data, agents only propose, load the procedure with `get_procedure` and declare its id and version; `list_projects`, `get_procedure`, `submit_analysis` and `release_analysis` take no `projectId`, `claim_analysis` an optional one, every other tool a required one.
- `get_procedure({id})` returns the text as is, for clients without prompt or skill support, since tools are what every client shares. The procedure is self-contained (it includes the claim–submit loop), so Claude Desktop and Codex follow it from a start prompt. The claim names the expected procedure; pipeline tool descriptions state the lease and validation rules.
- The prompt `work_pipeline({projectId?, maxTasks?, kind?})` (`maxTasks` a whole number from 1 to 100, passed as a string like every prompt argument; `kind` `relations`, the default with the released text, or `placement`) and the Claude Code skills `/analyzr:relations [project] [max-tasks]` and `/analyzr:placements [project] [max-tasks]` render through one helper, `renderPipelineWrapper` in `@analyzr/procedures`, so they cannot drift apart; a procedure with a `kind` gets `kinds: ["<kind>"]` in its claim calls (one kind per run, so one procedure is in the agent's context). `place_processes({projectId})` wraps the placements procedure for ad-hoc work (`renderAdHocWrapper`: `list_unplaced_processes`, `propose_placement`, skipping processes an agent already `judged`), and `draft_value_chain({projectId})` asks for a `.vc.json` a human imports on the value chain page (M4 §3.3). It adds only the scope (project, number of tasks), the rule to declare the exact model id as `llmModel`, the version rule (if a claim names another procedure or version than the embedded one, load the claim's with `get_procedure` and follow it, while declaring what the claim names), `release_analysis` instead of an expiring lease and a reload with `get_procedure` after the context was summarized, then embeds the procedure verbatim. The prompts `analyze_model` (v1: one model) and `review_landscape` (R1, read-only) come later.
- The Claude Code plugin `plugins/analyzr/` holds one skill per released pipeline procedure (`skills/relations/SKILL.md`, `skills/placements/SKILL.md`). `pnpm --filter @analyzr/procedures generate` writes them and the plugin version, which since two skills ship is the plugin's own (`PLUGIN_VERSION`, 0.3.0, the first release of the plugin `analyzr`; in the earlier repository its 0.1.0 and 0.2.0 equalled the relations procedure's version, owner decision 23); a test in `pnpm test` (so in CI) fails while either lags behind, pins every skill's sha256 per plugin release (a changed skill needs a new plugin version), and generation refuses procedure text that Claude Code would expand in a skill (`$ARGUMENTS`, `$<digit>`, `${CLAUDE_…}`, `` !`command` ``). The skill sets `disable-model-invocation: true`, so only a user starts it. A released version's skill never changes (a test pins its sha256), because installs from a Git-hosted marketplace stay at their version until it changes and runs are recorded under `<id>@<version>`; `--plugin-dir` and a marketplace added from a local checkout load the current files. The plugin carries no MCP server: the connection is configured separately, so the tools keep the names `mcp__analyzr__*`. The repository is the plugin's marketplace (`.claude-plugin/marketplace.json`, `claude plugin install analyzr@analyzr`).
- **Language:** agents write `rationale`, `question`, the no-link `reason`, the unsure `reason` and `summary` in German, because the review UI is German; refs, element ids, message and signal names and quoted labels stay verbatim. A per-project language setting is deferred (R1).
- **Judge each pair once** (`analyzr-relations@0.2.0`, §3): an agent judges its pairs, exactly its stored assignment (the `rule`, `key` and `lexical` candidates and the relations in neither `judged` nor `skip`, except settled pairs and relations with a missing end; held pairs included, where a confirmation is recorded and the hold stays), and every other pair it examines, `compatible` candidates and partner-search hits included, each with a proposal or a typed no-link, so partner tasks skip them; it leaves `judged` and `skip` pairs alone and contradicts a `judged` verdict only with concrete evidence, by a judgement of its own. The `0.1.0` rule "repeat every pair you still support" is gone.

**Deterministic library (no LLM):** `@analyzr/bpmn-facts`; `@analyzr/relations` (normalization, compatibility matrix, rule tier, candidate scoring by token Jaccard plus a label-length-relative Levenshtein distance, German and English stopwords, a short synonym list); R1 lint rules such as `dangling-throw` and `unresolved-call`.

**Judge each process once** (`analyzr-placements@0.1.0`, §3 "Task kinds"): every process of a placement claim gets exactly one verdict (a placement, rarely two, or an unsure item with a German reason naming the candidate steps); a process left out counts as skipped. The procedure lists `baseline-prefix/1`'s failure modes (department folders taken for the value stream, hints copied as the answer, coarse parent steps, called processes put at their caller, archived copies on a step instead of `@outside`).

**Starting agents** is the operator's job: users invoke `/analyzr:relations` or `/analyzr:placements` (the model cannot), `work_pipeline` or a start prompt; deployed agents run on a schedule, long-poll `GET /analyses/pending?wait=30` or, from R2, react to webhooks.

**Reference setups** (`examples/agents/`) are runnable documentation: not workspace packages, imported by nothing in `apps/` or `packages/`, not in the image, and never run against a model by CI. Each starts in a directory outside the checkout, all but Codex with analyzr's MCP tools only, because `eval/` holds the ground truth:
- `claude-code/`: `mcp.json` (`${ANALYZR_URL:-http://127.0.0.1:7400}/mcp`, `Bearer ${ANALYZR_TOKEN}`, `alwaysLoad`) for an interactive session with `--strict-mcp-config --mcp-config --plugin-dir plugins/analyzr --tools "" --allowedTools "mcp__analyzr__*"`, and `run-headless.sh [--skill relations|placements] <project> <model> [batch-size] [max-batches]`, one fresh `claude -p "/analyzr:<skill> <project> <batch-size>"` with `--permission-mode dontAsk` per batch until `GET /api/v1/analyses/pending?projectId=` (with `&kinds=placement` for placements) reports none, or a batch fails or makes no progress (exit 1; for placements the chain's latest placement task changing or its due count falling counts as progress too, since a follow-up keeps the pending count at 1). `claude -p` bills `ANTHROPIC_API_KEY` ahead of the subscription login, so the script refuses to start with it set unless given `--allow-api-billing`.
- `claude-desktop/`: entries for the `analyzr mcp` bridge (in the container via `docker exec`, or from the checkout) and a German start prompt (project, exact model id, batch size) that loads the procedure with `get_procedure`; one new chat per batch.
- `codex/`: a `config.toml` entry (`url`, `bearer_token_env_var = "ANALYZR_TOKEN"`); Codex takes the same start prompt. It keeps its own shell and file tools, and its sandbox does not restrict reads, so a working directory does not keep it out of `eval/`: on the holdout it runs only in an environment without read access to the checkout (a container or VM without it, another OS user or machine).

For now, models are evaluated through MCP with these local agents only (owner decision 16, [HANDOFF.md](HANDOFF.md) §4): the Claude Agent SDK, Claude Managed Agents, the OpenAI Responses API and the OpenAI Agents SDK have no reference setup. That `claude -p` expands the plugin skill (as Anthropic's headless documentation says) and that analyzr's tools stay available with `--tools ""` and `alwaysLoad` is unverified until the owner's first runs.

**Cost** is the operator's: with Sonnet 5.5 on an API key ($2/$10 per million input/output tokens), about $0.10–0.20 per revision, $30–60 for 300 models.

**Eval:**

```
eval/corpus/<landscape>/{landscape.yaml, models/*.bpmn, expected.yaml}   # lang, split dev|holdout, closed_world
eval/recordings/<procedure>@<version>/<agent>/<llmModel>/<landscape>.jsonl
eval/tools/src/{candidates,replay,live,live-gate}.ts                    # eval:candidates, eval:replay, eval:live
eval/value-chains/<landscape>/{value-chain.vc.json, expected-placements.yaml}   # M4: golden chains and placements
eval/tools/src/{placements,placements-replay,placement-live-gate}.ts    # eval:placements, placement replay and gate
```

Each entry has `type`, `from`, `to`, `expect` (`must_link`, `must_not_link` or `may_link`) and tags. In a `closed_world` landscape, any unlisted pair counts as a false positive. Live runs are agent-agnostic: `analyzr seed <landscape> --project <key> --issue-tokens --token-name <run>` loads a landscape into a fresh project and issues a read+propose agent token, any agent works the pipeline with it, and `eval:live` reads the project's stored submissions over REST into a recording (the agent is the token name; no claim input, which the server does not keep) and scores it with the `eval:replay` scorer.

| Gate | When | Criterion |
|---|---|---|
| `eval:candidates` | every PR, no LLM | ≥ 98 % of `must_link` pairs among the candidates; rule-tier precision 1.0; reported against `baseline-label/1` (Levenshtein ≤ 4) |
| `eval:replay` | every PR, no LLM | precision, recall and F1 per type and tag, from recordings; the committed report must match a fresh run; it shows the live gate but enforces nothing |
| live | by the owner before a procedure release, with Claude Desktop or Claude Code on the owner's subscription (owner decision 13, [HANDOFF.md](HANDOFF.md) §4); one fresh project and agent token per run, the token name is the recording's agent; 3 runs per landscape on a pinned model (the declared `llmModel`); `eval:live` exits 1 on fail | per procedure version, landscape and declared `llmModel`, over its live runs (any agent but `agent-sim`): **fail** if a run proposes a `must_not_link` pair at confidence ≥ 0.8, or the mean recall is more than 5 points below the baseline (the mean recall of the live runs of the highest earlier x.y.z version on that landscape with the same `llmModel`, else the `agent-sim` recordings of the same version, whatever their model); else **incomplete** with fewer than 3 runs or no baseline; else **pass** |

Placement recordings (M4b) are scored by the same `eval:replay` (one more section) on the golden chain only (a run on an edited chain is not comparable), and their live gate is per procedure version, landscape and `llmModel` as well: **fail** if a run places a process on a `must_not` step at confidence ≥ 0.8 or the mean recall@1 is below the higher recall@1 of `baseline-prefix/1` with and without votes plus 20 points; **incomplete** below 3 runs; else **pass** ([M4-VALUE-CHAIN.md](M4-VALUE-CHAIN.md) §6).

Recall here is the proposals' (`overall`, without the rule tier's acceptances), averaged over the runs that have one; exactly 5 points below the baseline passes. Fail is checked first, so a single run can fail a version on its model. Runs with another model form a gate of their own and never mix into a model's means; runs of different clients with the same `llmModel` do. A project is never reused across runs: its claims list an earlier run's current judgements in `judged` and leave those pairs out of the candidates (§3), so a second agent would judge almost nothing, and earlier proposals would bias the claim input.

**Seed cases:** one per weakness of label matching (`baseline-label/1`: "Order received" ≠ "Order rejected", "prüfen" = "pruefen", timer end ≠ message start, subprocess events stay inside, DE/EN pairs); XXE tests; 5 describe cases (R1); an anonymized holdout landscape. Decision memory is covered by Postgres integration tests.

## 8. Stack and repository

| Area | Choice |
|---|---|
| Base | Node 24 LTS, strict TypeScript, pnpm workspaces, zod 4 |
| Server | Hono with `@hono/zod-openapi`; `@modelcontextprotocol/server` 2.x (2026-07-28 and 2025-11-25), with v1 `@modelcontextprotocol/sdk` 1.32 as fallback if the spike finds gaps |
| Data | PostgreSQL 17, Drizzle, `pg`. No Redis. |
| BPMN | `bpmn-moddle` 10 with zeebe and camunda extensions (`@bpmiq/notations/extract.ts` drops event definitions and refs) |
| Auth | v1: local mode, agent tokens only, no IdP. Server mode (R1): `jose`, Keycloak 26.8 in a separate Compose profile, WorkOS for hosted instances. |
| Web | React 19, Vite, TanStack, Tailwind v4, shadcn, a hey-api client; bpmn-js for review; diagram-js + elkjs for the map (R1); follows `miragon-brand:modeler-tool-design` |
| Tests | vitest against real Postgres (lease races need it); MCP contract tests with the plain SDK client (`tools/list` and `prompts/list` snapshots, scope/cross-project matrix, both credential types); Playwright |
| Delivery | One product image, built locally by Compose; none is published yet (later `ghcr.io/miragon/analyzr` from `main` and tags, deployable with `flyctl deploy --image` or Compose). No runner image. The public read-only demo (owner decision 20) is a separate image, `docker/Dockerfile.demo` (the product image with PostgreSQL and the seed baked in), deployed to Fly.io by `demo-deploy.yml` from source, not published to a registry. |

```
apps/server/src/{domain,db,http,mcp,auth}   # dependency-cruiser: domain imports none of the others
apps/web/  plugins/analyzr/  examples/agents/  eval/  docker/compose.yaml
packages/{contracts,client,bpmn-facts,relations,procedures}
```

## 9. Repository, license and releases

- **Repository:** `Miragon/analyzr`, private at first, default branch `main`, with a fresh history that starts with one initial commit (owner decision 23).
- **CI:** `.github/workflows/ci.yml` runs on every pull request and every push to `main`, without path filters: format, types, lint, tests against real PostgreSQL, the eval gates, plugin and client drift, the product image with a Compose live check, and the demo image. Its three jobs, "Typecheck, lint, test", "Docker image and compose stack" and "Read-only demo image", become the required status checks once the owner sets the ruleset for `main` (rulesets require checks by job name).
- **License:** MIT, `Copyright (c) 2026 Miragon GmbH` (`LICENSE`). `THIRD-PARTY-NOTICES.md` lists the production dependencies and the build tools whose code the web bundle contains (rolldown, tailwindcss, vite) with their licenses; `pnpm notices` regenerates it, and a test in `pnpm -r test` fails while it is stale. Both runtime images carry `LICENSE` and the notices. The Miragon name and logo are not licensed under MIT. bpmn-js keeps its own license, which requires the bpmn.io watermark to stay visible. analyzr's code, tests and test landscapes were written for analyzr; `baseline-label/1` reimplements label matching from its behaviour.
- **Releases:** every workspace package stays `private: true`, and the root version is `0.x.y-alpha.N` (now `0.1.0-alpha.0`) without git tags until a first release. No product image is published yet.
- **Demo:** `demo-deploy.yml` deploys the read-only demo (§6) to Fly.io from `main` (DEVELOPMENT.md "Demo deployment (Fly.io)").

## 10. MVP slice and roadmap

**MVP (about 3 weeks, headless, no UI):**
1. **Week 1:** scaffold, schema, `bpmn-facts`, ingest, rules, relation lifecycle; the test landscapes `nordwind-handel` (dev) and `stadtwerke-auental` (holdout) in `eval/corpus`, Camunda 7 and 8, deploy-checked against both engines; `eval:candidates` in CI.
2. **Week 2:** local mode (127.0.0.1 binding, Host/Origin checks, owner session), agent tokens and the `analyzr mcp` stdio bridge; policy matrix; pipeline, stages, review verdicts incl. `hold`, REST, events; MCP tools, `get_procedure`, `work_pipeline`; integration tests for decision memory and lease races.
3. **Week 3:** the `relations` procedure and plugin wrapper; the `claude-code`, `claude-desktop` and `codex` reference setups; live runs; `eval:replay`.

**Auth spike (R1, server mode, 1–2 days):** Keycloak loopback matching without fixed ports; Claude Code `--client-id` with a public client (no secret); claude.ai/Desktop connector registration (DCR vs. a user-supplied client id) and how it reads the PRM; ChatGPT with `analyzr-mcp` as user-defined OAuth client; Gemini CLI DCR re-registration; SDK negotiation with 2025-06-18 and 2025-11-25 clients; ChatGPT with a path-inserted-only PRM; Keycloak's DCR client limit and cleanup; `aud` after a Codex refresh; which clients use prompts.

**Done when:**
- uploading 3 models with curl shows the `call` links at once
- three local agents work the same pipeline over MCP: Claude Desktop through the `analyzr mcp` bridge, Claude Code on a subscription over HTTP, and a non-Claude client (Codex with `bearer_token_env_var`) that loads the procedure through `get_procedure`. Assertions show distinct principals, clients and declared models.
- an LLM-free contract test with the plain MCP SDK client runs claim, submit and release with both credential types
- decisions made in local mode (UI or REST with the owner session) survive a re-upload; held items stay held; deciding over MCP fails with `human-decision-required`
- the eval report shows precision and recall per agent against `baseline-label/1`
- no LLM credential exists in analyzr's configuration, image or database

| Step | Scope | Effort |
|---|---|---|
| v1 UI (local) | projects and agent tokens; a "connect an agent" page with ready-made configurations for Claude Desktop, Claude Code, Cursor, VS Code and Codex; upload; inbox by stage; review screen (evidence, bpmn-js highlight, accept/reject/hold/correct, bulk per tier, held list); `analyze_model`, `propose_relation`; Playwright; one `docker compose up` | 1.5–2 weeks |
| R1 | server mode: OIDC (Keycloak), users, memberships, invitations, PRM and OAuth for MCP, a public URL for claude.ai, ChatGPT and Claude Code Routines, the auth spike; landscape map with saved views; lint; `describe` and `landscape` procedures; `impact_of`, `trace_landscape_path`; minimal OKF export and `eval-export`; npm package and Desktop Extension for the bridge; `put_model` | 3–4 weeks |
| R2 | bpmiq.yml import; rename and re-anchoring; an MCP App widget; webhooks; a WorkOS deployment incl. M2M audience check; a review assistant, if approved | 2–3 weeks |

## 11. Deferred on purpose

- **Versioning:** project versions, branches, named tags and a diff view (later one `landscape_tag(project_id, name, seq)` table), the landscape "as of seq".
- **Pipeline:** neighbour rechecks, priorities, lease renewal, a judgment cache beyond judging each pair once per change of its models (§3), `agent_run` bookkeeping, minimum procedure versions, a runner shipped with analyzr.
- **Relations and content:** cross-project relations, external placeholders, error/escalation/link/compensation relations, DMN refs, fuzzy data-store matching, agent findings (owner decision 24 lifts this in part: gap reports bound to submissions, without a lifecycle, M6 S7), comments (decision 24 adds answers to open questions, M6 S5a; decision 25 turns them into actions with optional notes, M6 S5c), embeddings, runtime data.
- **Sync and export:** linked Git sync, OKF restore, foreign OKF, the Web Modeler (owner decision 25 lifts this in part: targeted amendments of the fields open questions name, set through forms as amended revisions computed from the uploaded bytes, re-applied at every import and exported as corrected BPMN and a change list for the source tool; no modeler and no write-back, M6 §4.8), `messages/`, `findings/` and `log.md` in the export.
- **Platform and auth:** stdio MCP, MCP subscriptions, an authorization server or OAuth proxy in analyzr, Keycloak CIMD while experimental, Enterprise-Managed Authorization (ID-JAG), token exchange, DPoP/mTLS, WorkOS API keys, personal user tokens (`analyzr-cli` uses device flow), row-level security, a shared multi-tenant instance.
- **Decisions:** deciding via MCP; beyond the owner's auto-accept rules (decision 19): a glossary, fixed mappings, rules that re-confirm after an endpoint change, narrowing a rule by procedure (decision 24 adds one narrowing: rule-tier call proposals of derived revisions by derived kind and converter, M6 §3.10; decision 28 limits it to „Export“, „Konvertiert“ and „Ohne Angabe“ and never an agent upload; delivered in M6 S2c-3).

## 12. Open questions for the owner

1. **Auto-accept.** Answered: decision 9 accepts only unambiguous calls built in, since decision 24.2 (M6 S2c-1) only those of modelled callers; decision 19 lets the owner add auto-accept rules for agent proposals of relations and placements and, since M6 S2c-3, for the rule tier's call proposals of derived models by declared source (§3 review workflow step 5). Identical message and signal names stay proposed, bulk-acceptable per tier, unless an owner's rule accepts them.
2. **First users.** Will they upload through the UI, or work from bpmiq.yml/Git repositories? The answer decides whether folder and bpmiq.yml import move into v1.
3. **Held items.** Is a note plus an optional question enough for "vormerken" in v1, or do you need routing to people (assignee, due date, notification)?
4. **License.** Answered: MIT, `Copyright (c) 2026 Miragon GmbH` (decision 23). Packages stay private until a first release, which can also publish the bridge as npm package or Desktop Extension. The test landscapes in `eval/corpus` are synthetic and written for analyzr.

/**
 * The open-questions read model (M6 §4.1–§4.4, slice S4): every place where
 * the landscape leaves a gap that blocks links or placements, as one list of
 * questions for the consultant and the customer. Computed on read from the
 * relation and value chain findings, holds, agents' questions, unsure
 * placement verdicts, coded no-links, submission summaries and uncovered
 * pairs, plus deterministic gap signals over the head facts. Never stored and
 * never a stage (decision 8): it ranks and asks, it decides nothing.
 */
import { z } from 'zod';

import { OpenQuestionAnswerId, RelationId } from '../ids.ts';
import { PERSONAL_DATA_KINDS } from '../personal-data.ts';
import { ModelKey, Ref } from '../refs.ts';
import { RelationType, SourceKind } from '../relations.ts';
import { orNull, plainName, plainText } from '../zod-utils.ts';
import { TypedPair } from './analyses.ts';
import { Cursor, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, Timestamp } from './common.ts';
import { Placement } from './placements.ts';
import { Relation } from './relations.ts';
import { MAX_BULK_DECISIONS, MAX_NOTE_CHARS } from './shared.ts';
import { MAX_VALUE_CHAIN_ID_CHARS } from './value-chains.ts';

/**
 * Kind of an open question. Its own enum, never `FindingKind`, which is part
 * of the claim input, the MCP `get_landscape` output and `eval:candidates`'
 * scoring (all frozen for the live runs). The mapped sources:
 * - `call-target-unknown`: finding `unresolved-call`, or no-link code `call-target`;
 * - `call-target-dynamic`: finding `dynamic-call`;
 * - `duplicate-process-id`: finding `duplicate-process-id`;
 * - `message-partner-missing`: findings `dangling-throw` and `unmatched-catch` (message and signal endpoints);
 * - `held`: a human hold on a relation or placement (note, question, label);
 * - `agent-question`: an agent's question on a live proposal of a relation or placement waiting for review;
 * - `placement-unsure`: an agent's current `unsure` verdict on an open process;
 * - `process-without-step`, `step-without-process`, `unresolved-link`: value chain findings;
 * - `external-partner`: no-link code `collaboration`;
 * - `summary-note`: the summary of a current submission (decision 24.9, read-only);
 * - `unjudged`: assigned pairs a current submission left without a judgement (`uncovered`).
 *
 * The gap signals, computed from the head facts (M6 §4.3):
 * - `black-box-partner`: a message flow ends outside every process of its file (a pool without a process, as far as facts v1 tell);
 * - `unlabelled-boundary`: a process with a none start or none end event without a label;
 * - `message-without-name`: a message endpoint without a message name and without a message flow, not already a `message-partner-missing` finding (off in S4: it duplicated that finding on every model checked; the kind stays reserved);
 * - `undocumented-process`: a process without documentation;
 * - `isolated-process`: a process without any relation, `rule`, `key` or `lexical` candidate or message flow to another process;
 * - `descriptive-model`: no engine and no executable process (informational).
 */
export const OpenQuestionKind = z
  .enum([
    'call-target-unknown',
    'call-target-dynamic',
    'duplicate-process-id',
    'message-partner-missing',
    'held',
    'agent-question',
    'placement-unsure',
    'process-without-step',
    'step-without-process',
    'unresolved-link',
    'external-partner',
    'summary-note',
    'unjudged',
    'black-box-partner',
    'unlabelled-boundary',
    'message-without-name',
    'undocumented-process',
    'isolated-process',
    'descriptive-model',
  ])
  .meta({ id: 'OpenQuestionKind', description: 'Kind of an open question.' });
export type OpenQuestionKind = z.infer<typeof OpenQuestionKind>;

/** Where an open question comes from (M6 §4.1; `signal` for the gap signals of §4.3). */
export const OpenQuestionSource = z
  .enum([
    'finding',
    'value-chain-finding',
    'hold',
    'agent-question',
    'unsure',
    'no-link',
    'summary',
    'unjudged',
    'signal',
  ])
  .meta({ id: 'OpenQuestionSource', description: 'Source of an open question.' });
export type OpenQuestionSource = z.infer<typeof OpenQuestionSource>;

/**
 * What a question is about: an element (`ref`), a process (its ref), a model
 * (its key), a relation or placement (their ids), a value chain step (its
 * element id in the chain `main`) or the value chain (its key, a placement
 * submission's summary).
 */
export const OpenQuestionSubjectType = z
  .enum(['ref', 'process', 'model', 'relation', 'placement', 'step', 'value-chain'])
  .meta({ id: 'OpenQuestionSubjectType', description: 'Type of the subject of an open question.' });
export type OpenQuestionSubjectType = z.infer<typeof OpenQuestionSubjectType>;

export const OpenQuestionSubject = z
  .object({ type: OpenQuestionSubjectType, id: z.string() })
  .meta({ id: 'OpenQuestionSubject', description: 'What an open question is about.' });
export type OpenQuestionSubject = z.infer<typeof OpenQuestionSubject>;

/**
 * Who might know the answer, as a hint and never an assignee (decision 10):
 * the lanes containing the subject (for a process its lanes; for an element
 * inside an embedded subprocess the lanes of the nearest enclosing
 * subprocess in a lane), the org units owning the top-level steps its
 * processes are accepted on (decision 18; each one, sorted), and the model
 * key's first folder.
 */
export const OpenQuestionAskWho = z
  .object({
    lanes: z.array(z.string()),
    stepOwners: z.array(z.string()),
    folder: z.string().nullable(),
  })
  .meta({ id: 'OpenQuestionAskWho', description: 'Hints at whom to ask; never an assignee.' });
export type OpenQuestionAskWho = z.infer<typeof OpenQuestionAskWho>;

/**
 * Who raised the question: the rule tier and the gap signals (`rule`, no
 * handle), an agent or a human (their pseudonymous handle), and the seq of
 * the event behind it (for rule items the head revision of the newest of
 * their models, or the chain head).
 */
export const OpenQuestionRaisedBy = z
  .object({
    sourceKind: SourceKind,
    handle: z.string().nullable(),
    seq: z.number().int().min(0),
  })
  .meta({ id: 'OpenQuestionRaisedBy', description: 'Who raised an open question, and when.' });
export type OpenQuestionRaisedBy = z.infer<typeof OpenQuestionRaisedBy>;

/**
 * `answered` while a live outside mark („Liegt außerhalb der Landschaft“, not
 * withdrawn) is recorded for the item's id, else `open` (M6 §4.8 b, since
 * S5c-1: a note informs and leaves the item `open`; every other item ends
 * through its action, which takes it off the list). The web calls the state
 * „Erledigt (außerhalb)“.
 */
export const OpenQuestionState = z
  .enum(['open', 'answered'])
  .meta({ id: 'OpenQuestionState', description: 'State of an open question.' });
export type OpenQuestionState = z.infer<typeof OpenQuestionState>;

/**
 * `q-` + the first 16 hex characters of `sha256(kind|subject|source
 * version)`: stable across reads, new when the source changes. Since M6
 * S5c-1 findings, signals, `process-without-step` and coded no-links are
 * versioned by what they ask about (§4.2): the refs, kinds and fingerprints
 * of the subject's and anchors' head facts, plus what the question reads
 * beyond them (a pool's flows, a process's documentation, the unnamed
 * events), so an amendment or re-import elsewhere in the model keeps the id;
 * `descriptive-model` keeps the model's `facts_hash`. Holds and questions:
 * the assertion id; unsure verdicts: the placement input hash; summaries and
 * uncovered pairs: the submission id; step findings: the step's fingerprint.
 */
export const OpenQuestionId = z
  .string()
  .regex(/^q-[0-9a-f]{16}$/, 'must be q- and 16 hex characters')
  .meta({
    id: 'OpenQuestionId',
    description: 'Id of an open question: `q-` + 16 hex characters.',
    example: 'q-3f2a9c41d07be815',
  });
export type OpenQuestionId = z.infer<typeof OpenQuestionId>;

/**
 * Kind of a stored answer row (M6 §4.5; German labels in
 * `@analyzr/contracts/open-question-labels`): `answer` (a note),
 * `outside-landscape` (the outside mark „Liegt außerhalb der Landschaft“; it
 * never dismisses a finding) and `will-be-modelled` (S5a's „Wird im Modell
 * ergänzt“, kept for stored rows and never written again since S5c-1). How a
 * row counts today is its {@link OpenQuestionAnswerRole}.
 */
export const OpenQuestionAnswerKind = z
  .enum(['answer', 'outside-landscape', 'will-be-modelled'])
  .meta({ id: 'OpenQuestionAnswerKind', description: 'Kind of an answer to an open question.' });
export type OpenQuestionAnswerKind = z.infer<typeof OpenQuestionAnswerKind>;

/**
 * How a stored answer counts since M6 S5c-1 (§4.8 b): an outside mark
 * (`outside-mark`: a row of kind `outside-landscape` on a subject that is
 * neither a relation nor a placement; it makes the item `answered` while it
 * is not withdrawn) or a note (`note`: every other row, also S5a's rows of
 * kind `answer` and `will-be-modelled` and its `outside-landscape` rows on
 * a relation or placement).
 */
export const OpenQuestionAnswerRole = z
  .enum(['note', 'outside-mark'])
  .meta({ id: 'OpenQuestionAnswerRole', description: 'How a stored answer counts.' });
export type OpenQuestionAnswerRole = z.infer<typeof OpenQuestionAnswerRole>;

/** Longest answer text: as long as a note, where answers on relations and placements land. */
export const MAX_ANSWER_CHARS = MAX_NOTE_CHARS;

/**
 * An answer text as the server compares and stores it: line breaks as LF (a
 * spreadsheet saves a cell's line breaks as LF, while Windows tools send
 * CRLF), Unicode composed (NFC: a decomposed „ä“ is the same answer),
 * surrounding white space trimmed. So a sheet read back again matches the
 * answer it shows.
 */
export function normalizeAnswerText(text: string): string {
  return text.replace(/\r\n?/g, '\n').normalize('NFC').trim();
}

/**
 * Where an answer's text is stored (M6 §4.5 "Where the text lands"): a human
 * note on the item's relation (`relation-note`, through the note use case:
 * the next claim of either model shows it; a hold stays until a human
 * decides) or placement (`placement-note`, through the placement note use
 * case: on an agent's question the process becomes due and nothing is
 * queued; a held placement keeps homing its process, so it is not due and
 * no agent gets it until a human decides the hold), else the answer itself
 * (`answer`: shown and exported; it reaches agents only with S7). A note
 * holds the text only, never the kind.
 */
export const OpenQuestionAnswerTarget = z
  .enum(['relation-note', 'placement-note', 'answer'])
  .meta({ id: 'OpenQuestionAnswerTarget', description: "Where an answer's text is stored." });
export type OpenQuestionAnswerTarget = z.infer<typeof OpenQuestionAnswerTarget>;

/** The note an answer on a relation or placement was recorded as. */
export const OpenQuestionAnswerNote = z
  .object({
    type: z.enum(['relation', 'placement']),
    /** The relation (`rel_…`) or placement (`plc_…`). */
    subjectId: z.string(),
    /** The note: a relation assertion (`asr_…`) or placement assertion (`pas_…`) of kind `note`. */
    assertionId: z.string(),
  })
  .meta({ id: 'OpenQuestionAnswerNote', description: 'The note an answer was recorded as.' });
export type OpenQuestionAnswerNote = z.infer<typeof OpenQuestionAnswerNote>;

/** The withdrawal of an outside mark („Rückgängig“, M6 S5c-1): who, and the event seq. */
export const OpenQuestionAnswerWithdrawal = z
  .object({
    /** Pseudonymous handle of the human who withdrew the mark. */
    by: z.string(),
    /** Seq of the `open_question.answer_withdrawn` event. */
    seq: z.number().int().min(1),
    at: Timestamp,
  })
  .meta({
    id: 'OpenQuestionAnswerWithdrawal',
    description: 'The withdrawal of an outside mark.',
  });
export type OpenQuestionAnswerWithdrawal = z.infer<typeof OpenQuestionAnswerWithdrawal>;

/**
 * One recorded answer (append-only, humans only): its stored kind and how it
 * counts (`role`), its text (for a note answer the note's text; an outside
 * mark's optional note, `null` without one) and the note it was recorded
 * as, who gave it, the event seq, and for an outside mark its withdrawal.
 */
export const OpenQuestionAnswer = z
  .object({
    id: OpenQuestionAnswerId,
    questionId: OpenQuestionId,
    kind: OpenQuestionAnswerKind,
    role: OpenQuestionAnswerRole,
    target: OpenQuestionAnswerTarget,
    /** The answer, verbatim (plain text, render it as such); `null` for an outside mark without a note. */
    text: z.string().nullable(),
    /** The note it was recorded as (`relation-note`, `placement-note`); `null` for `answer`. */
    note: orNull(OpenQuestionAnswerNote),
    /** Pseudonymous handle of the human who answered. */
    by: z.string(),
    sourceKind: z.literal('human'),
    /** Seq of the `open_question.answered` event. */
    seq: z.number().int().min(1),
    at: Timestamp,
    /** An outside mark's withdrawal; `null` while it counts, and always for a note. */
    withdrawal: orNull(OpenQuestionAnswerWithdrawal),
  })
  .meta({ id: 'OpenQuestionAnswer', description: 'An answer to an open question.' });
export type OpenQuestionAnswer = z.infer<typeof OpenQuestionAnswer>;

/**
 * Type of an action on an open question (M6 §4.8 a, S5c-1):
 * - `decide`: decide the relation or placement in {@link OpenQuestionAction.decides}
 *   (accept, reject, correct, also hold) through the existing decision routes;
 * - `link`: link the item's anchor to the picked targets through
 *   `POST …/open-questions/{q}/actions` (a live typed proposal between them is
 *   accepted, else an accepted `manual` relation is written);
 * - `place`: place the process on the picked step (or on
 *   {@link OpenQuestionAction.step}, `@outside`), or the picked process on the step;
 * - `choose-copy`: name the valid copy of a duplicated process id; the calls
 *   towards the copies are accepted or rejected all or nothing;
 * - `outside`: mark the item „Liegt außerhalb der Landschaft“ (revocable);
 * - `requeue`: queue the analysed model again (`requeueAnalyses`, permission `write`);
 * - `fix-link`: correct the step's link on the chain page;
 * - `note`: add a note (`POST …/open-questions/{q}/answers`).
 * Model amendments (`amend`, `withdraw-amendment`) come with S5c-2.
 */
export const OpenQuestionActionType = z
  .enum(['decide', 'link', 'place', 'choose-copy', 'outside', 'requeue', 'fix-link', 'note'])
  .meta({ id: 'OpenQuestionActionType', description: 'Type of an action on an open question.' });
export type OpenQuestionActionType = z.infer<typeof OpenQuestionActionType>;

/**
 * The picker an action needs: processes (`process`, shown as „Name (Modell)“),
 * message or signal endpoints of other processes (`endpoint`; the whole
 * process where no endpoint fits), steps of the live chain (`step`) or one
 * of the listed pairs (`pair`).
 */
export const OpenQuestionPick = z
  .enum(['process', 'endpoint', 'step', 'pair'])
  .meta({ id: 'OpenQuestionPick', description: 'The picker an action needs.' });
export type OpenQuestionPick = z.infer<typeof OpenQuestionPick>;

/** A relation or placement an action decides, with the version it was read at. */
export const OpenQuestionDecisionItem = z
  .object({
    type: z.enum(['relation', 'placement']),
    /** The relation (`rel_…`) or placement (`plc_…`). */
    id: z.string(),
    version: z.number().int().min(1),
  })
  .meta({
    id: 'OpenQuestionDecisionItem',
    description: 'A relation or placement an action decides.',
  });
export type OpenQuestionDecisionItem = z.infer<typeof OpenQuestionDecisionItem>;

/** Most targets of one `link` action (`call-target-dynamic`: at most 10 possible targets). */
export const MAX_LINK_TARGETS = 10;

/**
 * A live proposal a `link` to one of its suggested targets accepts as the
 * human's decision instead of writing a manual relation (M6 §4.8 a): a rule
 * tier's or an agent's proposed or held relation from the item's anchor (or
 * towards it), whose other end is the target or, for a process picker, lies
 * in the target process. The picker's preview names it before it is
 * accepted.
 */
export const OpenQuestionLinkProposal = z
  .object({
    /** The suggested target the proposal belongs to (a process for a process picker). */
    target: Ref,
    /** The proposal. */
    relation: RelationId,
    type: RelationType,
    from: Ref,
    to: Ref,
  })
  .meta({
    id: 'OpenQuestionLinkProposal',
    description: 'A live proposal a link to a suggested target accepts.',
  });
export type OpenQuestionLinkProposal = z.infer<typeof OpenQuestionLinkProposal>;

/**
 * One action an open question offers (M6 §4.8 a), computed by the read model
 * with the item: its type, whether it is the item's primary action (at most
 * one is), its German label from code (the tab, the model view and the CLI
 * say the same), and what the client needs for it. Fields that do not apply
 * are left out.
 */
export const OpenQuestionAction = z
  .object({
    type: OpenQuestionActionType,
    primary: z.boolean(),
    /** German, from code, e.g. „Verknüpfen mit …“. */
    label: z.string(),
    /** The picker (`link`, `place`, `choose-copy`). */
    pick: OpenQuestionPick.optional(),
    /** Whether several targets may be picked (`link` on `call-target-dynamic`, at most {@link MAX_LINK_TARGETS}). */
    multiple: z.boolean().optional(),
    /** Targets a live proposal already names: the picker lists them first, under „Vorgeschlagen“. */
    suggested: z.array(Ref).optional(),
    /** The live proposals a link to a suggested target accepts (`link`), per target. */
    proposals: z.array(OpenQuestionLinkProposal).optional(),
    /**
     * Processes the picker leaves out (`link` with a process picker): the
     * processes of the item's anchors, which a link would join to themselves
     * (refused as `same-process`).
     */
    exclude: z.array(Ref).optional(),
    /** The only targets the action takes (`choose-copy`: the copies). */
    choices: z.array(Ref).optional(),
    /** The pairs to pick from (`link` with `pick: 'pair'`). */
    pairs: z.array(TypedPair).optional(),
    /** The fixed step of a `place` action that needs no picker (`@outside`). */
    step: z.string().optional(),
    /** What `decide` decides, and the calls `choose-copy` accepts or rejects. */
    decides: z.array(OpenQuestionDecisionItem).optional(),
  })
  .meta({ id: 'OpenQuestionAction', description: 'An action an open question offers.' });
export type OpenQuestionAction = z.infer<typeof OpenQuestionAction>;

/** One open question (M6 §4.2). */
export const OpenQuestion = z
  .object({
    id: OpenQuestionId,
    kind: OpenQuestionKind,
    source: OpenQuestionSource,
    subject: OpenQuestionSubject,
    /** Display name of the subject (German), e.g. `„Kreditprüfung“` or `„A“ → „B“`. */
    subjectLabel: z.string(),
    /** The models the question touches, sorted (for filters); empty for steps and the chain. */
    modelKeys: z.array(ModelKey),
    /**
     * The question, German: from code for findings, signals and uncovered
     * pairs; verbatim (plain text, render it as such) for human and agent
     * texts: the hold's question (else its note), the agent's question,
     * unsure reason, no-link reasons or summary.
     */
    text: z.string(),
    /** Verbatim supporting text: a hold's note when it has a question; `null` otherwise. */
    context: z.string().nullable(),
    /** A hold's label, e.g. „mit Fachbereich Finanzen klären“; `null` otherwise. */
    label: z.string().nullable(),
    askWho: OpenQuestionAskWho,
    /**
     * Open decisions touching the subject (0 when none): the candidate pairs
     * of tiers `rule`, `key` and `lexical` without a current agent judgement
     * or a settling decision and the proposed or held relations at its refs
     * (a process: at its process ref and every element; a model: at every
     * element of the model), plus 1 per open process (no accepted placement),
     * plus a step's proposed and held placements (the value chain: every live
     * step's). It ranks, it predicts nothing: the list puts the questions
     * first, then the value chain findings, then informational items
     * (`summary-note`, `descriptive-model`), and orders each group by it.
     */
    unlocks: z.number().int().min(0),
    /** Refs for the reviewer to follow (elements, processes, both ends of a relation). */
    refs: z.array(Ref),
    raisedBy: OpenQuestionRaisedBy,
    state: OpenQuestionState,
    /**
     * The answers recorded for this id, oldest first: notes and outside
     * marks, withdrawn marks included. An answer belongs to the id: when
     * what the item asks about changes, so does its id, and the item is
     * `open` again.
     */
    answers: z.array(OpenQuestionAnswer),
    /** What can be done about it (M6 §4.8 a); empty for informational items. */
    actions: z.array(OpenQuestionAction),
  })
  .meta({ id: 'OpenQuestion', description: 'A gap in the landscape, as a question.' });
export type OpenQuestion = z.infer<typeof OpenQuestion>;

/** A page of open questions; `total` counts every item matching the filters. */
export const OpenQuestionPage = z
  .object({
    items: z.array(OpenQuestion),
    nextCursor: z.union([Cursor, z.null()]),
    total: z.number().int().min(0),
  })
  .meta({ id: 'OpenQuestionPage', description: 'A page of open questions.' });
export type OpenQuestionPage = z.infer<typeof OpenQuestionPage>;

/** Longest `askWho` filter value (lane and org unit names are labels of at most 200 characters). */
export const MAX_ASK_WHO_FILTER_CHARS = 200;

/** Filters of the list and the export (M6 §4.4). */
export const OpenQuestionFilter = z.object({
  /** Items touching this model, or every model below this folder (`finanzen` matches `finanzen/mahnwesen`). */
  modelKey: ModelKey.optional(),
  kind: OpenQuestionKind.optional(),
  source: OpenQuestionSource.optional(),
  /** Items whose `askWho` names exactly this lane, step owner (one of them) or folder. */
  askWho: plainName(MAX_ASK_WHO_FILTER_CHARS).optional(),
  state: OpenQuestionState.optional(),
});
export type OpenQuestionFilter = z.infer<typeof OpenQuestionFilter>;

/**
 * Query of `GET …/open-questions`: the filters and a cursor page; questions,
 * then the value chain findings, then informational items, each group
 * ordered by `unlocks` (descending).
 */
export const OpenQuestionQuery = OpenQuestionFilter.extend({
  cursor: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
});
export type OpenQuestionQuery = z.infer<typeof OpenQuestionQuery>;

/** Format of the export: Markdown for reading and interviews, CSV for the customer to fill in. */
export const OpenQuestionExportFormat = z
  .enum(['markdown', 'csv'])
  .meta({ id: 'OpenQuestionExportFormat', description: 'Format of the open-questions export.' });
export type OpenQuestionExportFormat = z.infer<typeof OpenQuestionExportFormat>;

/** Query of `GET …/open-questions/export`: the filters and the format (default `markdown`). */
export const OpenQuestionExportQuery = OpenQuestionFilter.extend({
  format: OpenQuestionExportFormat.default('markdown'),
});
export type OpenQuestionExportQuery = z.infer<typeof OpenQuestionExportQuery>;

/**
 * The CSV export's columns, in order (M6 §4.4, five since S5c-1): the
 * customer fills in `Antwort`, and every filled `Antwort` is recorded as a
 * note (§4.8 b).
 */
export const OPEN_QUESTION_CSV_COLUMNS = [
  'id',
  'Art',
  'Frage',
  'Ansprechpartner-Hinweis',
  'Antwort',
] as const;

/**
 * The values of S5a's sheet column `Antwortart` (dropped by S5c-1), which
 * the reader still accepts in sheets exported before: the labels of
 * {@link OpenQuestionAnswerKind}, in its order. „Liegt außerhalb der
 * Landschaft“ records an outside mark (a note on a relation or placement
 * item), the others a note.
 */
export const OPEN_QUESTION_ANSWER_KINDS = [
  'Antwort',
  'Liegt außerhalb der Landschaft',
  'Wird im Modell ergänzt',
] as const;

/**
 * Path of the tab „Offene Fragen“ of a project in the web UI. The answer
 * routes' `human-decision-required` problems carry it as `reviewUrl`
 * (absolute, on the server's origin).
 */
export function openQuestionsPath(projectKey: string): string {
  return `/projects/${encodeURIComponent(projectKey)}/open-questions`;
}

/** A finding of the personal-data check (`@analyzr/contracts/personal-data`): kind and UTF-16 offsets into the text, `end` exclusive. */
export const PersonalDataWarning = z
  .object({
    kind: z.enum(PERSONAL_DATA_KINDS),
    start: z.number().int().min(0),
    end: z.number().int().min(0),
  })
  .meta({
    id: 'PersonalDataWarning',
    description:
      'Probable personal data in a text (e-mail, phone, IBAN); a warning, never a block.',
  });
export type PersonalDataWarning = z.infer<typeof PersonalDataWarning>;

/** Params of the routes about one open question. */
export const OpenQuestionParam = z.object({ question: OpenQuestionId });

/**
 * A note on one open question („Notiz hinzufügen“, M6 §4.8 b; humans only):
 * the text (at most {@link MAX_ANSWER_CHARS} characters, no control
 * characters except tab and line breaks; stored as
 * {@link normalizeAnswerText} gives it). No other field: since S5c-1 the
 * answer kinds are gone, and a body that sends S5a's `kind` gets 422, so an
 * old client notices.
 */
export const AnswerOpenQuestionBody = z
  .strictObject({
    text: plainText(z.string().trim().min(1).max(MAX_ANSWER_CHARS)),
  })
  .meta({ id: 'AnswerOpenQuestionBody', description: 'A note on an open question.' });
export type AnswerOpenQuestionBody = z.infer<typeof AnswerOpenQuestionBody>;

/**
 * The recorded note (`recorded`), or the item's latest note when the new
 * one is identical to it (`unchanged`: nothing written; an earlier note
 * that a later one followed is recorded again, so it becomes the latest);
 * the item as the list now shows it (a note leaves its state as it was);
 * the personal-data check's warnings on the text.
 */
export const AnswerOpenQuestionResult = z
  .object({
    result: z.enum(['recorded', 'unchanged']),
    answer: OpenQuestionAnswer,
    question: OpenQuestion,
    warnings: z.array(PersonalDataWarning),
  })
  .meta({ id: 'AnswerOpenQuestionResult', description: 'The answer and the answered question.' });
export type AnswerOpenQuestionResult = z.infer<typeof AnswerOpenQuestionResult>;

/** Rows per call of the sheet route (a sheet with more is sent in parts). */
export const MAX_ANSWER_SHEET_ROWS = 5000;
/** Bytes of a sheet route body (413 `payload-too-large` above). */
export const MAX_ANSWER_SHEET_BODY_BYTES = 4 * 1024 * 1024;

/**
 * One row of a filled-in sheet, its cells as written (`readAnswerSheet` in
 * `@analyzr/contracts/open-question-csv` reads them from the CSV): `id`,
 * `text` (the column `Antwort`) and `kind` (S5a's column `Antwortart`,
 * empty for a five-column sheet: a label of
 * {@link OPEN_QUESTION_ANSWER_KINDS} or a value of
 * {@link OpenQuestionAnswerKind}, case and surrounding spaces ignored).
 * Every filled `Antwort` is a note, except that „Liegt außerhalb der
 * Landschaft“ (`outside-landscape`) records an outside mark with the text as
 * its note on an item that is neither a relation nor a placement. The
 * server checks each row and lists the ones it cannot store, so the cells
 * have no length limit here (the body has).
 */
export const AnswerSheetRowInput = z
  .object({
    id: z.string(),
    text: z.string(),
    kind: z.string().default(''),
  })
  .meta({ id: 'AnswerSheetRowInput', description: 'One row of a filled-in answer sheet.' });

/** The rows of a filled-in sheet (the CSV of `GET …/open-questions/export?format=csv`). */
export const AnswerSheetBody = z
  .object({ rows: z.array(AnswerSheetRowInput).max(MAX_ANSWER_SHEET_ROWS) })
  .meta({ id: 'AnswerSheetBody', description: 'The rows of a filled-in answer sheet.' });
export type AnswerSheetBody = z.infer<typeof AnswerSheetBody>;

/** Query of the sheet route: `dryRun=true` previews and stores nothing. */
export const AnswerSheetQuery = z.object({
  dryRun: z.enum(['true', 'false']).optional(),
});
export type AnswerSheetQuery = z.infer<typeof AnswerSheetQuery>;

/**
 * What became of a sheet row:
 * - `recorded`: stored (in a dry run: would be stored);
 * - `unchanged`: a note identical to the item's latest note, or an outside
 *   mark on an item a live mark already marks, so nothing is stored;
 * - `unknown`: the id names no current open question (also when its source
 *   changed since the export, which changes the id); never stored;
 * - `invalid`: the row cannot be stored (`reason`); never stored.
 */
export const AnswerSheetOutcome = z
  .enum(['recorded', 'unchanged', 'unknown', 'invalid'])
  .meta({ id: 'AnswerSheetOutcome', description: 'What became of a sheet row.' });
export type AnswerSheetOutcome = z.infer<typeof AnswerSheetOutcome>;

/**
 * Why a row is `invalid`: the answer is longer than {@link MAX_ANSWER_CHARS}
 * characters (`too-long`), has control characters other than tab and line
 * breaks (`control-characters`), its `Antwortart` is none of the kinds
 * (`unknown-kind`), or an earlier row of the call answers the same id
 * (`duplicate-id`).
 */
export const AnswerSheetReason = z
  .enum(['too-long', 'control-characters', 'unknown-kind', 'duplicate-id'])
  .meta({ id: 'AnswerSheetReason', description: 'Why a sheet row cannot be stored.' });
export type AnswerSheetReason = z.infer<typeof AnswerSheetReason>;

/** One row's outcome; rows with an empty answer are only counted (`ignored`). */
export const AnswerSheetRowResult = z
  .object({
    /** Position of the row in `rows`, from 1 (clients map it to the row of their sheet). */
    row: z.number().int().min(1),
    /** The `id` cell, as sent. */
    id: z.string(),
    outcome: AnswerSheetOutcome,
    /** Why an `invalid` row cannot be stored. */
    reason: AnswerSheetReason.optional(),
    /** The answer's kind (`recorded`, `unchanged`): `answer` for a note, `outside-landscape` for a mark. */
    kind: OpenQuestionAnswerKind.optional(),
    /** Where its text lands (`recorded`, `unchanged`). */
    target: OpenQuestionAnswerTarget.optional(),
    /** The stored answer (`recorded` without a dry run; `unchanged`: the item's latest note or live mark). */
    answer: OpenQuestionAnswer.optional(),
    /** The personal-data check's warnings on the answer text. */
    warnings: z.array(PersonalDataWarning),
  })
  .meta({ id: 'AnswerSheetRowResult', description: "One sheet row's outcome." });
export type AnswerSheetRowResult = z.infer<typeof AnswerSheetRowResult>;

/** The outcome of a sheet: counts and every row that is not `ignored`, in order. */
export const AnswerSheetResult = z
  .object({
    dryRun: z.boolean(),
    counts: z.object({
      recorded: z.number().int().min(0),
      unchanged: z.number().int().min(0),
      unknown: z.number().int().min(0),
      invalid: z.number().int().min(0),
      /** Rows with an empty answer. */
      ignored: z.number().int().min(0),
    }),
    rows: z.array(AnswerSheetRowResult),
  })
  .meta({ id: 'AnswerSheetResult', description: 'What a filled-in sheet stored or would store.' });
export type AnswerSheetResult = z.infer<typeof AnswerSheetResult>;

// ------------------------------------------------------------ actions (S5c-1)

/** An optional note with an action: plain text, at most {@link MAX_ANSWER_CHARS} characters. */
const actionNote = () => plainText(z.string().max(MAX_ANSWER_CHARS)).optional();

/**
 * `link`: link the item's anchor to the picked targets (1 to
 * {@link MAX_LINK_TARGETS} refs: processes, or endpoints where the action
 * picks endpoints), or, on `unjudged`, the picked `pair` (one of the
 * action's `pairs`; then no `targets`). For each pair of anchor and target,
 * a live typed relation between them (proposed or held) is accepted as the
 * human's decision, else an accepted `manual` relation is written; the
 * rationale is German and from code, plus the note.
 */
export const LinkActionBody = z
  .object({
    type: z.literal('link'),
    targets: z.array(Ref).max(MAX_LINK_TARGETS).default([]),
    pair: z.object({ from: Ref, to: Ref }).optional(),
    note: actionNote(),
  })
  .superRefine((b, ctx) => {
    if ((b.pair === undefined) === (b.targets.length === 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['targets'],
        message: 'name 1 to 10 targets, or a pair and no targets',
      });
    }
  })
  .meta({ id: 'LinkActionBody', description: 'Link the item to the picked targets.' });

/**
 * `place`: a manual placement, accepted at once: the item's process on
 * `step` (a step element id of the live chain, or `@outside`), or, on a step
 * item, the picked `process` on the item's step.
 */
export const PlaceActionBody = z
  .object({
    type: z.literal('place'),
    step: z.string().min(1).max(MAX_VALUE_CHAIN_ID_CHARS),
    process: Ref.optional(),
    note: actionNote(),
  })
  .meta({ id: 'PlaceActionBody', description: 'Place the process on a step.' });

/**
 * `choose-copy`: the valid copy (`process`, one of the action's `choices`);
 * `items` are the action's `decides` with the versions read, all or nothing
 * (409 `conflict` when the calls changed). Calls towards the valid copy are
 * accepted, the others rejected with a German reason from code; with
 * `placeOthersOutside` (needs the value chain) the other copies without a
 * home step go to `@outside`. The note is recorded as a note on the item.
 */
export const ChooseCopyActionBody = z
  .object({
    type: z.literal('choose-copy'),
    process: Ref,
    items: z
      .array(z.object({ id: RelationId, version: z.number().int().min(1) }))
      .min(1)
      .max(MAX_BULK_DECISIONS),
    placeOthersOutside: z.boolean(),
    note: actionNote(),
  })
  .meta({ id: 'ChooseCopyActionBody', description: 'Choose the valid copy of a process id.' });

/** `outside`: the outside mark „Liegt außerhalb der Landschaft“, with an optional note. */
export const OutsideActionBody = z
  .object({
    type: z.literal('outside'),
    note: actionNote(),
  })
  .meta({ id: 'OutsideActionBody', description: 'Mark the item as outside the landscape.' });

/** The body of `POST …/open-questions/{q}/actions`, by `type`. */
export const OpenQuestionActionBody = z
  .discriminatedUnion('type', [
    LinkActionBody,
    PlaceActionBody,
    ChooseCopyActionBody,
    OutsideActionBody,
  ])
  .meta({ id: 'OpenQuestionActionBody', description: 'An action on an open question.' });
export type OpenQuestionActionBody = z.infer<typeof OpenQuestionActionBody>;
export type OpenQuestionActionInput = z.input<typeof OpenQuestionActionBody>;

/**
 * How an action touched a relation or placement: it wrote a `manual` one
 * („Rückgängig“ rejects it) or decided an existing one (`decision`: an
 * accepted proposal, a rejected call, a proposed or held placement on the
 * same step and process accepted by `place`; no undo, a reviewer changes it
 * in the review or on the value chain page).
 */
export const OpenQuestionActionEffect = z
  .enum(['manual', 'decision'])
  .meta({ id: 'OpenQuestionActionEffect', description: 'How an action touched a subject.' });
export type OpenQuestionActionEffect = z.infer<typeof OpenQuestionActionEffect>;

/**
 * What an action did: `applied`, or `unchanged` when nothing was written
 * (an outside mark on an item a live mark marks); the item as the list now
 * shows it (`null` when the action took it off the list); the relations and
 * placements it wrote or decided; the answer it recorded (the outside mark,
 * or `choose-copy`'s note); the personal-data check's warnings on the note.
 */
export const OpenQuestionActionResult = z
  .object({
    result: z.enum(['applied', 'unchanged']),
    question: orNull(OpenQuestion),
    relations: z.array(z.object({ effect: OpenQuestionActionEffect, relation: Relation })),
    placements: z.array(z.object({ effect: OpenQuestionActionEffect, placement: Placement })),
    answer: orNull(OpenQuestionAnswer),
    warnings: z.array(PersonalDataWarning),
  })
  .meta({ id: 'OpenQuestionActionResult', description: 'What an action on an open question did.' });
export type OpenQuestionActionResult = z.infer<typeof OpenQuestionActionResult>;

/** Params of the withdrawal route: the question and the answer. */
export const OpenQuestionAnswerParam = OpenQuestionParam.extend({ answer: OpenQuestionAnswerId });

/**
 * The withdrawn outside mark („Rückgängig“): `withdrawn`, or `unchanged`
 * when it was withdrawn before; the item as the list now shows it.
 */
export const WithdrawOpenQuestionAnswerResult = z
  .object({
    result: z.enum(['withdrawn', 'unchanged']),
    answer: OpenQuestionAnswer,
    question: OpenQuestion,
  })
  .meta({
    id: 'WithdrawOpenQuestionAnswerResult',
    description: 'The withdrawn outside mark and its question.',
  });
export type WithdrawOpenQuestionAnswerResult = z.infer<typeof WithdrawOpenQuestionAnswerResult>;

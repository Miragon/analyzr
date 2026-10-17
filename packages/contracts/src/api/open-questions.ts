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

import { OpenQuestionAnswerId } from '../ids.ts';
import { PERSONAL_DATA_KINDS } from '../personal-data.ts';
import { ModelKey, Ref } from '../refs.ts';
import { SourceKind } from '../relations.ts';
import { orNull, plainName, plainText } from '../zod-utils.ts';
import { Cursor, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, Timestamp } from './common.ts';
import { MAX_NOTE_CHARS } from './shared.ts';

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

/** `answered` while at least one answer is recorded for the item's id (M6 S5a), else `open`. */
export const OpenQuestionState = z
  .enum(['open', 'answered'])
  .meta({ id: 'OpenQuestionState', description: 'State of an open question.' });
export type OpenQuestionState = z.infer<typeof OpenQuestionState>;

/**
 * `q-` + the first 16 hex characters of `sha256(kind|subject|source
 * version)`: stable across reads, new when the source changes (the head
 * `facts_hash` of the subject's models for findings and signals, the
 * assertion id for holds and questions, the placement input hash for unsure
 * verdicts, the submission id for summaries and uncovered pairs, the no-link
 * ids for coded no-links, the step's fingerprint for step findings).
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
 * Kind of an answer (M6 §4.5; the CSV column `Antwortart`, German labels in
 * `@analyzr/contracts/open-question-labels`): `answer` („Antwort“),
 * `outside-landscape` („Liegt außerhalb der Landschaft“; like every kind it
 * marks the item answered, it never dismisses a finding) and
 * `will-be-modelled` („Wird im Modell ergänzt“).
 */
export const OpenQuestionAnswerKind = z
  .enum(['answer', 'outside-landscape', 'will-be-modelled'])
  .meta({ id: 'OpenQuestionAnswerKind', description: 'Kind of an answer to an open question.' });
export type OpenQuestionAnswerKind = z.infer<typeof OpenQuestionAnswerKind>;

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

/**
 * One recorded answer (append-only, humans only): its kind, its text (for a
 * note answer the note's text) and the note it was recorded as, who gave it
 * and the event seq.
 */
export const OpenQuestionAnswer = z
  .object({
    id: OpenQuestionAnswerId,
    questionId: OpenQuestionId,
    kind: OpenQuestionAnswerKind,
    target: OpenQuestionAnswerTarget,
    /** The answer, verbatim (plain text, render it as such). */
    text: z.string(),
    /** The note it was recorded as (`relation-note`, `placement-note`); `null` for `answer`. */
    note: orNull(OpenQuestionAnswerNote),
    /** Pseudonymous handle of the human who answered. */
    by: z.string(),
    sourceKind: z.literal('human'),
    /** Seq of the `open_question.answered` event. */
    seq: z.number().int().min(1),
    at: Timestamp,
  })
  .meta({ id: 'OpenQuestionAnswer', description: 'An answer to an open question.' });
export type OpenQuestionAnswer = z.infer<typeof OpenQuestionAnswer>;

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
     * The answers recorded for this id, oldest first (empty while `open`).
     * An answer belongs to the id: when the item's source changes, so does
     * its id, and the item is `open` again.
     */
    answers: z.array(OpenQuestionAnswer),
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
 * The CSV export's columns, in order (M6 §4.4): the customer fills in the
 * last two; `Antwortart` takes one of {@link OPEN_QUESTION_ANSWER_KINDS}.
 */
export const OPEN_QUESTION_CSV_COLUMNS = [
  'id',
  'Art',
  'Frage',
  'Ansprechpartner-Hinweis',
  'Antwort',
  'Antwortart',
] as const;

/**
 * The answer kinds of the `Antwortart` column (M6 §4.4), as the sheet names
 * them: the labels of {@link OpenQuestionAnswerKind}, in its order.
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
 * An answer to one open question (M6 §4.5, humans only): the text (at most
 * {@link MAX_ANSWER_CHARS} characters, no control characters except tab and
 * line breaks; stored as {@link normalizeAnswerText} gives it) and the kind
 * (default `answer`).
 */
export const AnswerOpenQuestionBody = z
  .object({
    text: plainText(z.string().trim().min(1).max(MAX_ANSWER_CHARS)),
    kind: OpenQuestionAnswerKind.default('answer'),
  })
  .meta({ id: 'AnswerOpenQuestionBody', description: 'An answer to an open question.' });
export type AnswerOpenQuestionBody = z.infer<typeof AnswerOpenQuestionBody>;

/**
 * The recorded answer (`recorded`), or the item's latest answer when the
 * new one is identical to it (`unchanged`: same kind and text, nothing
 * written; an earlier answer that a later one followed is recorded again,
 * so it becomes the latest); the item as the list now shows it; the
 * personal-data check's warnings on the text.
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
 * `text` (the column `Antwort`) and `kind` (the column `Antwortart`: a
 * label of {@link OPEN_QUESTION_ANSWER_KINDS} or a value of
 * {@link OpenQuestionAnswerKind}, case and surrounding spaces ignored;
 * empty means `answer`). The server checks each row and lists the ones it
 * cannot store, so the cells have no length limit here (the body has).
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
 * - `unchanged`: the item's latest answer is identical (same kind and text;
 *   with an empty `Antwortart`, the same text whatever its kind), so
 *   nothing is stored;
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
    /** The answer's kind (`recorded`, `unchanged`). */
    kind: OpenQuestionAnswerKind.optional(),
    /** Where its text lands (`recorded`, `unchanged`). */
    target: OpenQuestionAnswerTarget.optional(),
    /** The stored answer (`recorded` without a dry run; `unchanged`: the item's latest one). */
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

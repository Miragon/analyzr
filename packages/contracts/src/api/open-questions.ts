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

import { ModelKey, Ref } from '../refs.ts';
import { SourceKind } from '../relations.ts';
import { plainName } from '../zod-utils.ts';
import { Cursor, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from './common.ts';

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

/** `open`; `answered` comes with answers (M6 S5a), so S4 lists every item as `open`. */
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
     * step's). It ranks, it predicts nothing: the list puts informational
     * items (`summary-note`, `descriptive-model`) last, then orders by it.
     */
    unlocks: z.number().int().min(0),
    /** Refs for the reviewer to follow (elements, processes, both ends of a relation). */
    refs: z.array(Ref),
    raisedBy: OpenQuestionRaisedBy,
    state: OpenQuestionState,
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
 * Query of `GET …/open-questions`: the filters and a cursor page, questions
 * before informational items, each ordered by `unlocks` (descending).
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

/** The answer kinds of the `Antwortart` column (M6 §4.4; recorded from S5a on). */
export const OPEN_QUESTION_ANSWER_KINDS = [
  'Antwort',
  'Liegt außerhalb der Landschaft',
  'Wird im Modell ergänzt',
] as const;

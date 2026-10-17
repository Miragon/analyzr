import { z } from 'zod';

import { MessageFlowInfo, Fact, ProcessInfo } from '../facts.ts';
import { ModelId, ProjectId, RevisionId } from '../ids.ts';
import { ApiProblem } from '../problem.ts';
import { ModelKey } from '../refs.ts';
import { orNull } from '../zod-utils.ts';
import { AmendmentCounts, AmendmentPlanEntry, RevisionUpstream } from './amendment-core.ts';
import { Sha256Hex, Timestamp, pageOf } from './common.ts';

/**
 * Pipeline stage of a model (CONCEPT §3, view `model_pipeline`):
 * queued → `waiting_for_agent`, claimed → `agent_working`, failed →
 * `agent_failed`; done → `waiting_for_review` if any proposed item,
 * `waiting_for_clarification` if only held items, else `incorporated`.
 */
export const ModelStage = z
  .enum([
    'waiting_for_agent',
    'agent_working',
    'agent_failed',
    'waiting_for_review',
    'waiting_for_clarification',
    'incorporated',
  ])
  .meta({ id: 'ModelStage', description: 'Pipeline stage of a model.' });
export type ModelStage = z.infer<typeof ModelStage>;

/**
 * Target engine of a BPMN file: Camunda 7 (`c7`) or Camunda 8 (`c8`), from
 * `modeler:executionPlatform`, else from the declared camunda or zeebe
 * namespace (`@analyzr/bpmn-facts`); `null` when the file names neither.
 */
export const Engine = z
  .enum(['c7', 'c8'])
  .meta({ id: 'Engine', description: 'Target engine: Camunda 7 (`c7`) or Camunda 8 (`c8`).' });
export type Engine = z.infer<typeof Engine>;

export const Model = z
  .object({
    id: ModelId,
    projectId: ProjectId,
    key: ModelKey,
    /** `bpmn:definitions` name or the first process name. */
    name: z.string().nullable(),
    headRevisionId: RevisionId,
    /** Revision number of the head, starting at 1. */
    headRev: z.number().int().min(1),
    /** Engine of the head revision; `null` if the file names none. */
    engine: orNull(Engine),
    stage: ModelStage,
    /** Relations touching the model that are proposed, held, or accepted with `endpointState` ≠ ok. */
    openItems: z.number().int().min(0),
    updatedAt: Timestamp,
  })
  .meta({ id: 'Model', description: 'A BPMN model (one file) with a stable key.' });
export type Model = z.infer<typeof Model>;

export const ModelPage = pageOf(Model, 'ModelPage');
export type ModelPage = z.infer<typeof ModelPage>;

/**
 * Where a revision's bytes came from: an upload, an import or a seed (the
 * *uploaded* bytes), or `amendment` (M6 S5c-2, decision 25): bytes analyzr
 * computed from the uploaded revision `upstream` by the amendments its plan
 * marks `applied` (an *amended* revision). A `looseObject` over the stored
 * jsonb: fields it does not declare pass through.
 */
export const RevisionSource = z
  .looseObject({
    kind: z.enum(['upload', 'import', 'seed', 'amendment']),
    /** Path of the file within the upload or import. */
    path: z.string().optional(),
    /**
     * The credential kind of the request that wrote the revision (M6 §3.3):
     * `human` for the owner key or the web session, `agent` for an agent
     * token; a credential kind, not a person. Set on amended revisions.
     */
    uploader: z.enum(['human', 'agent']).optional(),
    /** An amended revision: the uploaded revision it is computed from. */
    upstream: RevisionUpstream.optional(),
    /**
     * On a head with live amendments: every live amendment of the model with
     * its outcome against `upstream` (an amended head) or against the
     * revision itself (an uploaded head none applies to), in seq order.
     */
    amendments: z.array(AmendmentPlanEntry).optional(),
  })
  .meta({ id: 'RevisionSource', description: 'Origin of a revision.' });
export type RevisionSource = z.infer<typeof RevisionSource>;

export const Revision = z
  .object({
    id: RevisionId,
    modelId: ModelId,
    rev: z.number().int().min(1),
    /** SHA-256 of the raw bytes; identical uploads are no-ops. */
    contentHash: Sha256Hex,
    /** SHA-256 over the facts; ignores layout. */
    factsHash: Sha256Hex,
    factsVersion: z.string(),
    /** Engine the file targets; `null` if it names none (also for revisions stored before M2). */
    engine: orNull(Engine),
    source: RevisionSource,
    /** Event sequence number of the ingest. */
    seq: z.number().int().min(1),
    createdAt: Timestamp,
  })
  .meta({ id: 'Revision', description: 'An immutable revision of a model.' });
export type Revision = z.infer<typeof Revision>;

export const RevisionPage = pageOf(Revision, 'RevisionPage');
export type RevisionPage = z.infer<typeof RevisionPage>;

/** Facts of one revision. */
export const RevisionFacts = z
  .object({
    modelKey: ModelKey,
    revisionId: RevisionId,
    factsVersion: z.string(),
    processes: z.array(ProcessInfo),
    facts: z.array(Fact),
    messageFlows: z.array(MessageFlowInfo),
  })
  .meta({ id: 'RevisionFacts', description: 'Facts extracted from one revision.' });
export type RevisionFacts = z.infer<typeof RevisionFacts>;

/** At most this many extractor warnings are listed per file in an import or PUT result. */
export const MAX_RESULT_WARNINGS = 20;
/** A warning's message is cut to this many characters (ending in `…`) in a result. */
export const MAX_RESULT_WARNING_CHARS = 300;
/**
 * Most warnings the extractor returns per file (`warningCount`): 100 and its
 * own `too-many-warnings` entry ("N more warnings omitted").
 */
export const MAX_RESULT_WARNING_COUNT = 101;

/**
 * A non-fatal observation of the fact extractor (`@analyzr/bpmn-facts`):
 * `parse-warning` (unknown or unparsable content, unresolved references,
 * duplicate ids), `missing-id`, `invalid-id`, `duplicate-id` (element
 * skipped), `label-truncated`, `key-truncated`, `documentation-truncated`,
 * `call-without-target`, `multiple-event-definitions`,
 * `message-flow-unresolved`, `too-many-warnings`. Not stored (M6 S1).
 */
export const ExtractWarning = z
  .object({
    code: z.string().max(50),
    /** The extractor's English message, cut to 300 characters (ending in `…`). */
    message: z.string().max(MAX_RESULT_WARNING_CHARS),
    /** Element the warning is about, if any (not necessarily a valid element id). */
    elementId: z.string().max(255).optional(),
  })
  .meta({ id: 'ExtractWarning', description: 'A non-fatal observation of the fact extractor.' });
export type ExtractWarning = z.infer<typeof ExtractWarning>;

/**
 * The extractor's warnings of a `created` or `revised` file, present only
 * when there is at least one (`unchanged` files are not extracted, `failed`
 * ones carry the problem).
 */
const resultWarnings = {
  /**
   * At most {@link MAX_RESULT_WARNINGS}, in the extractor's order; when the
   * extractor ended with `too-many-warnings`, that entry is the last one
   * listed (after the first 19).
   */
  warnings: z.array(ExtractWarning).max(MAX_RESULT_WARNINGS).optional(),
  /**
   * Every warning the extractor returned (at most
   * {@link MAX_RESULT_WARNING_COUNT}: 100 and its own `too-many-warnings`
   * entry), also those beyond `warnings`.
   */
  warningCount: z.number().int().min(1).max(MAX_RESULT_WARNING_COUNT).optional(),
};

/**
 * The model's live amendments at an upload (M6 S5c-2), present only for a
 * model with live amendments, so the results of every other model keep
 * their shape.
 */
const resultAmendments = {
  /** Applied to the incoming bytes, taken over by the source tool, or in conflict. */
  amendments: AmendmentCounts.optional(),
};

/**
 * Outcome of `PUT …/models/by-key/{key}`: 201 `created`, 200 `revised` or
 * `unchanged`. `revision` is the model's head afterwards: for a model whose
 * live amendments apply to the new bytes the amended revision, whose
 * uploaded revision `uploadedRevisionId` names.
 */
export const PutModelResult = z
  .object({
    outcome: z.enum(['created', 'revised', 'unchanged']),
    model: Model,
    revision: Revision,
    /** The uploaded revision, when `revision` is an amended revision computed from it. */
    uploadedRevisionId: RevisionId.optional(),
    ...resultWarnings,
    ...resultAmendments,
  })
  .meta({ id: 'PutModelResult', description: 'Result of uploading one BPMN file.' });
export type PutModelResult = z.infer<typeof PutModelResult>;

export const MAX_IMPORT_FILES = 50;
/** Limits from CONCEPT §3. */
export const MAX_MODEL_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

export const ImportFileOutcome = z
  .object({
    path: z.string(),
    /** Derived from the path; `null` if the path cannot be slugified. */
    modelKey: orNull(ModelKey),
    outcome: z.enum(['created', 'revised', 'unchanged', 'failed']),
    /** Set when `outcome` is `failed`. */
    problem: orNull(ApiProblem),
    ...resultWarnings,
    ...resultAmendments,
  })
  .meta({ id: 'ImportFileOutcome', description: 'Outcome of one file of an import.' });
export type ImportFileOutcome = z.infer<typeof ImportFileOutcome>;

export const ImportResult = z
  .object({ files: z.array(ImportFileOutcome) })
  .meta({ id: 'ImportResult', description: 'Outcome per file of an import.' });
export type ImportResult = z.infer<typeof ImportResult>;

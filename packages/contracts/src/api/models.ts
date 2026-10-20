import { z } from 'zod';

import { MessageFlowInfo, Fact, ProcessInfo } from '../facts.ts';
import { Finding } from '../findings.ts';
import { AutoAcceptRuleId, ModelId, ProjectId, RevisionId } from '../ids.ts';
import { ApiProblem } from '../problem.ts';
import { ModelKey, Ref } from '../refs.ts';
import { RelationType } from '../relations.ts';
import { orNull } from '../zod-utils.ts';
import { AmendmentCounts, AmendmentPlanEntry, RevisionUpstream } from './amendment-core.ts';
import { Sha256Hex, Timestamp, pageOf } from './common.ts';
import {
  DerivedKind,
  ExportedAt,
  ImportWarning,
  ManifestDerived,
  ManifestImporter,
  ManifestLoss,
  SourceSystem,
} from './import-manifest.ts';

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

/**
 * A model's declared provenance in short (M6 §3.3; UX8, UX-SIMPLIFICATION.md
 * §6): the source system its head declares (for an amended head, its
 * uploaded revision `upstream`'s), how the file was derived and when the tool
 * exported it. REST only, for the models table's badge and the model view's
 * header; the whole provenance is the head revision's `source`.
 */
export const ModelSourceSummary = z
  .object({
    system: SourceSystem,
    /** `derived.kind` as declared; `null` when the manifest names none. */
    derived: orNull(DerivedKind),
    exportedAt: orNull(ExportedAt),
  })
  .meta({ id: 'ModelSourceSummary', description: "A model's declared provenance in short." });
export type ModelSourceSummary = z.infer<typeof ModelSourceSummary>;

/**
 * The trust class of an uploaded revision (M6 S2c, owner decisions 24.2 and
 * 25.2): `modelled` when the file targets Camunda 7 or 8, a human uploaded
 * it (the owner key or the web) and its manifest declares no derivation or
 * `export`; `derived` otherwise. The rule tier accepts a unique static call
 * only when the calling model is modelled; from a derived model it proposes
 * the call (tier `key`, {@link DERIVED_CALL_CONFIDENCE}).
 */
export const TrustClass = z
  .enum(['modelled', 'derived'])
  .meta({ id: 'TrustClass', description: 'Trust class of an uploaded revision.' });
export type TrustClass = z.infer<typeof TrustClass>;

/**
 * Why a revision is `derived`, in this order: no Camunda engine
 * (`no-engine`), uploaded with an agent token (`agent-upload`), declared
 * `converted`, `reconstructed` or `as-told`.
 */
export const TrustReason = z
  .enum(['no-engine', 'agent-upload', 'converted', 'reconstructed', 'as-told'])
  .meta({ id: 'TrustReason', description: 'Why an uploaded revision is derived.' });
export type TrustReason = z.infer<typeof TrustReason>;

/** The German label of each {@link TrustReason}, as the rationale and the web say it. */
export const TRUST_REASON_LABELS: Readonly<Record<TrustReason, string>> = {
  'no-engine': 'ohne Camunda-Engine',
  'agent-upload': 'über ein Agenten-Token hochgeladen',
  converted: 'als konvertiert angegeben',
  reconstructed: 'als KI-rekonstruiert angegeben',
  'as-told': 'als aus einem Interview angegeben',
};

/** Confidence of the rule tier's proposal of a unique call from a derived model (M6 S2c). */
export const DERIVED_CALL_CONFIDENCE = 0.9;

/** `attrs.match` of the rule tier's proposal of a unique call from a derived model (M6 S2c). */
export const DERIVED_CALLER_MATCH = 'derived-caller';

/**
 * The trust class the server stores on an uploaded revision (M6 S2c):
 * `reasons` empty for `modelled`, in {@link TrustReason}'s order for
 * `derived`.
 */
export const RevisionTrust = z
  .object({
    class: TrustClass,
    reasons: z.array(TrustReason),
  })
  .meta({ id: 'RevisionTrust', description: 'Trust class of an uploaded revision.' });
export type RevisionTrust = z.infer<typeof RevisionTrust>;

/**
 * A model's trust class in short (M6 S2c): its uploaded revision's (for an
 * amended head, `upstream`'s), with the declared derivation kind and
 * converter. REST only, for the model view's „Herkunft“.
 */
export const ModelTrustSummary = RevisionTrust.extend({
  /** `derived.kind` as declared; `null` when the manifest names none. */
  derivedKind: orNull(DerivedKind),
  /** `derived.converter` as stored; `null` when none is declared. */
  converter: orNull(z.string()),
}).meta({ id: 'ModelTrustSummary', description: "A model's trust class in short." });
export type ModelTrustSummary = z.infer<typeof ModelTrustSummary>;

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
    /**
     * The head's declared provenance in short (M6 S2a's web parts); `null`
     * when it declares no source system (a plain upload, a seed).
     */
    source: orNull(ModelSourceSummary),
    /**
     * The trust class of the head's uploaded revision (M6 S2c); `null` for a
     * revision stored before S2c, which counts as modelled (decision 24.2 (a)).
     */
    trust: orNull(ModelTrustSummary),
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
 * marks `applied` (an *amended* revision). Since M6 S2a an uploaded revision
 * also carries its typed provenance (§3.3): `uploader` and `manifestSha256`
 * set by the server, the rest declared by the import's manifest
 * (`analyzr-import/1`) and stored as declared. An amended revision keeps no
 * manifest fields of its own: readers follow `upstream` to the uploaded
 * revision. Provenance stays out of facts and `facts_hash`. A `looseObject`
 * over the stored jsonb: fields it does not declare pass through.
 */
export const RevisionSource = z
  .looseObject({
    kind: z.enum(['upload', 'import', 'seed', 'amendment']),
    /** Path of the file within the upload or import. */
    path: z.string().optional(),
    /**
     * The credential kind of the request that wrote the revision (M6 §3.3):
     * `human` for the owner key or the web session, `agent` for an agent
     * token; a credential kind, not a person. Set on every revision written
     * since M6 S2a (on amended revisions since S5c-2).
     */
    uploader: z.enum(['human', 'agent']).optional(),
    /** SHA-256 of the manifest the server received with the file (the batch's subset; server). */
    manifestSha256: Sha256Hex.optional(),
    /** The source system the manifest declares, e.g. `signavio`. */
    system: SourceSystem.optional(),
    systemVersion: orNull(z.string()).optional(),
    exportedAt: orNull(ExportedAt).optional(),
    importer: orNull(ManifestImporter).optional(),
    /** Tool folders the partial export covered (absent: the whole system). */
    scope: z.array(z.string()).optional(),
    /** The tool's model id (declared, opaque). */
    externalId: z.string().optional(),
    /** Folder and name in the tool (declared, not checked). */
    externalPath: z.string().optional(),
    /** A link into the source tool (declared, http(s) only). */
    url: z.string().optional(),
    /** How the file was derived (declared). */
    derived: ManifestDerived.optional(),
    /** What a conversion dropped (declared, counts only). */
    losses: z.array(ManifestLoss).optional(),
    /** An amended revision: the uploaded revision it is computed from. */
    upstream: RevisionUpstream.optional(),
    /**
     * On a head with live amendments: every live amendment of the model with
     * its outcome against `upstream` (an amended head) or against the
     * revision itself (an uploaded head none applies to), in seq order.
     */
    amendments: z.array(AmendmentPlanEntry).optional(),
    /**
     * The trust class (M6 S2c), set by the server, last, on every uploaded
     * revision stored since S2c; never declared. Absent on an amended
     * revision (readers follow `upstream`) and on revisions stored before
     * S2c, which count as modelled (decision 24.2 (a)).
     */
    trust: RevisionTrust.optional(),
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
 * `message-flow-unresolved`, `too-many-warnings`. Since M6 S2a every
 * revision stores its warnings (`model_revision.extract_warnings`, messages
 * cut as here; revisions stored before stay without), which the open
 * question `extractor-loss` reads.
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
 * Warnings about the file against its manifest or the landscape (M6 S2a,
 * §3.2, §3.4: `manifest-sha-mismatch`, `external-id-moved`,
 * `external-id-changed`), present only when there is one, so results
 * without a manifest keep their shape. The file was imported all the same.
 */
const resultImportWarnings = {
  importWarnings: z.array(ImportWarning).max(4).optional(),
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
    ...resultImportWarnings,
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
    /**
     * The key the manifest pins (M6 S2a), else derived from the path; `null`
     * if the path cannot be slugified.
     */
    modelKey: orNull(ModelKey),
    outcome: z.enum(['created', 'revised', 'unchanged', 'failed']),
    /**
     * Set when `outcome` is `failed`. A file `@analyzr/bpmn-facts` rejects is
     * 422 `bpmn-invalid` with the rejection's code as `reason` (`not-xml`,
     * `not-bpmn`, `doctype-forbidden`, `entity-forbidden`,
     * `too-many-elements`, `invalid-model-key`) and, for a `not-xml` whose
     * cause is the encoding, `encoding` (`utf-16`, `not-utf-8`); a file above
     * 5 MB is 413 `payload-too-large`. `PUT …/models/by-key/{key}` answers
     * the same problem.
     */
    problem: orNull(ApiProblem),
    ...resultWarnings,
    ...resultAmendments,
    ...resultImportWarnings,
    /**
     * The trust class of the model's uploaded revision after the import (M6
     * S2c): the one stored for a `created` or `revised` file, the one kept
     * for an `unchanged` one. Present only when it is `derived`, so other
     * results keep their shape.
     */
    trust: RevisionTrust.optional(),
  })
  .meta({ id: 'ImportFileOutcome', description: 'Outcome of one file of an import.' });
export type ImportFileOutcome = z.infer<typeof ImportFileOutcome>;

/** Most items an impact list carries (M6 §3.5); `count` says how many there are. */
export const MAX_IMPACT_ITEMS = 100;

const impactList = <T extends z.ZodType>(item: T) =>
  z.object({
    count: z.number().int().min(0),
    /** The first {@link MAX_IMPACT_ITEMS}. */
    items: z.array(item).max(MAX_IMPACT_ITEMS),
  });

/** A relation an impact names, by its type and both ends. */
export const ImpactRelation = z
  .object({ type: RelationType, from: Ref, to: Ref })
  .meta({ id: 'ImpactRelation', description: 'A relation by its type and both ends.' });
export type ImpactRelation = z.infer<typeof ImpactRelation>;

/** An accepted relation whose end would change or go missing. */
export const ImpactEndpoint = ImpactRelation.extend({
  endpointState: z.enum(['changed', 'missing']),
}).meta({ id: 'ImpactEndpoint', description: 'An accepted relation whose end changes.' });
export type ImpactEndpoint = z.infer<typeof ImpactEndpoint>;

/** A file whose head would change: whether its facts change, and its processes added or removed. */
export const ImpactFile = z
  .object({
    modelKey: ModelKey,
    factsChanged: z.boolean(),
    /** Process refs (`key#Process_…`) the new head adds, sorted. */
    processesAdded: z.array(Ref),
    /** Process refs the new head no longer has, sorted. */
    processesRemoved: z.array(Ref),
    /** The trust class the uploaded revision would get (M6 S2c), by the credential of the dry run. */
    trust: RevisionTrust,
  })
  .meta({ id: 'ImpactFile', description: 'How a file would change its model.' });
export type ImpactFile = z.infer<typeof ImpactFile>;

/**
 * A unique call from a derived model the rule tier would only propose (M6
 * S2c); `wasAccepted` when the relation is accepted now (the rule tier's
 * acceptance ends).
 */
export const ImpactProposedCall = ImpactRelation.extend({
  wasAccepted: z.boolean(),
}).meta({ id: 'ImpactProposedCall', description: 'A unique call from a derived model, proposed.' });
export type ImpactProposedCall = z.infer<typeof ImpactProposedCall>;

/**
 * The unique calls from derived models the rule tier would only propose (M6
 * S2c): the capped list, with totals over all `count` calls, past the cap.
 * `wasAccepted`: how many are accepted now (the rule tier's acceptance
 * ends). `byReason`: each call counted once, under its caller's first
 * {@link TrustReason}, in that order, so the counts add up to `count`;
 * reasons without a call are left out.
 */
export const ImpactProposedCalls = impactList(ImpactProposedCall)
  .extend({
    wasAccepted: z.number().int().min(0),
    byReason: z.array(z.object({ reason: TrustReason, count: z.number().int().min(1) })),
  })
  .meta({
    id: 'ImpactProposedCalls',
    description: 'Unique calls from derived models, proposed, with their totals.',
  });
export type ImpactProposedCalls = z.infer<typeof ImpactProposedCalls>;

/** A unique call from a derived model an owner's auto-accept rule would accept right away (M6 S2c-3). */
export const ImpactAutoAcceptedCall = ImpactRelation.extend({
  ruleId: AutoAcceptRuleId,
  /** The rule's name in its head revision. */
  ruleName: z.string(),
}).meta({
  id: 'ImpactAutoAcceptedCall',
  description: 'A unique call from a derived model an auto-accept rule would accept.',
});
export type ImpactAutoAcceptedCall = z.infer<typeof ImpactAutoAcceptedCall>;

/**
 * The unique calls from derived models the owner's enabled auto-accept rules
 * for derived calls would accept in the same write (M6 S2c-3): the capped
 * list, `ofProposed` of them `callsProposed` counts (the others were
 * proposals before the import already and the rule tier asserts them again,
 * say because the callee changed), and `byRule` over all `count` calls, by
 * the first matching rule in creation order.
 */
export const ImpactAutoAcceptedCalls = impactList(ImpactAutoAcceptedCall)
  .extend({
    /** How many of them `callsProposed` counts. */
    ofProposed: z.number().int().min(0),
    byRule: z.array(
      z.object({
        ruleId: AutoAcceptRuleId,
        ruleName: z.string(),
        count: z.number().int().min(1),
      }),
    ),
  })
  .meta({
    id: 'ImpactAutoAcceptedCalls',
    description: 'Unique calls from derived models auto-accept rules would accept, by rule.',
  });
export type ImpactAutoAcceptedCalls = z.infer<typeof ImpactAutoAcceptedCalls>;

/**
 * What an import or a model's deletion would change (M6 §3.5, slice S2b),
 * computed by the pure `importImpact` over the stored head and the would-be
 * head facts; nothing is written. `files`: the created and revised files.
 * `acceptedCalls`: rule-tier calls that would become accepted (decision 9).
 * `callsProposed`: unique calls from derived models that would become rule
 * proposals instead (M6 S2c, decision 24.2). `autoAcceptedCalls`: those of
 * them (or of the other rule proposals of such calls the write records) an
 * enabled auto-accept rule for derived calls would accept in the same write
 * (M6 S2c-3); only for a human on an interactive client who may maintain the
 * project's rules (an owner), absent for everyone else, agents included, so
 * no rule data reaches them. `proposalsAdded`,
 * `proposalsWithdrawn`: the other rule proposals of relations that would
 * appear, and rule stances that would be withdrawn. `endpointsChanged`:
 * accepted relations whose end would turn `changed` or `missing`.
 * `findingsAdded`, `findingsResolved`: the rule tier's findings. `absentKeys`:
 * live keys of the manifest's source system the import does not name, only
 * those whose tool folder lies in the manifest's `source.scope` (the whole
 * system without one); information only, nothing is deleted (decision 7).
 */
export const ImportImpact = z
  .object({
    files: z.array(ImpactFile),
    acceptedCalls: impactList(ImpactRelation),
    callsProposed: ImpactProposedCalls,
    autoAcceptedCalls: ImpactAutoAcceptedCalls.optional(),
    proposalsAdded: impactList(ImpactRelation),
    proposalsWithdrawn: impactList(ImpactRelation),
    endpointsChanged: impactList(ImpactEndpoint),
    findingsAdded: impactList(Finding),
    findingsResolved: impactList(Finding),
    absentKeys: impactList(ModelKey),
  })
  .meta({ id: 'ImportImpact', description: 'What an import or a deletion would change.' });
export type ImportImpact = z.infer<typeof ImportImpact>;

export const ImportResult = z
  .object({
    files: z.array(ImportFileOutcome),
    /** Only on a dry run (`?dryRun=true`): what the import would change; nothing was written. */
    impact: ImportImpact.optional(),
  })
  .meta({ id: 'ImportResult', description: 'Outcome per file of an import.' });
export type ImportResult = z.infer<typeof ImportResult>;

/** `?dryRun=true` of an import or a PUT (M6 S2b): the outcome and the impact, nothing written. */
export const ImportDryRunQuery = z.object({
  dryRun: z.enum(['true', 'false']).optional(),
});
export type ImportDryRunQuery = z.infer<typeof ImportDryRunQuery>;

/**
 * The dry run of `PUT …/models/by-key/{key}` (M6 S2b): the would-be outcome
 * with the warnings the upload would answer, and the impact; no model or
 * revision exists yet.
 */
export const PutModelDryRunResult = z
  .object({
    outcome: z.enum(['created', 'revised', 'unchanged']),
    modelKey: ModelKey,
    dryRun: z.literal(true),
    ...resultWarnings,
    ...resultAmendments,
    ...resultImportWarnings,
    impact: ImportImpact,
  })
  .meta({ id: 'PutModelDryRunResult', description: 'What uploading one BPMN file would change.' });
export type PutModelDryRunResult = z.infer<typeof PutModelDryRunResult>;

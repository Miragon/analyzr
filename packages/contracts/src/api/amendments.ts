/**
 * Model amendments („Ergänzungen“, M6 §4.8 c, decision 25, slice S5c-2):
 * targeted changes of the fields open questions name, written by a human
 * through a form at the element. The uploaded bytes stay a revision of their
 * own; analyzr computes an *amended* revision from them by byte-preserving
 * splices and makes it the head. The next import of the key re-applies every
 * live amendment whose field the source tool left as it was. The views,
 * bodies and results of the `amendments` routes.
 */
import { z } from 'zod';

import { FactKind } from '../facts.ts';
import { Finding } from '../findings.ts';
import { ModelAmendmentId, ModelId, RelationId, RevisionId } from '../ids.ts';
import { ModelKey, Ref } from '../refs.ts';
import { RelationType } from '../relations.ts';
import { orNull } from '../zod-utils.ts';
import { AmendmentConflictReason, AmendmentOp, MAX_AMENDMENT_ITEMS } from './amendment-core.ts';
import { Timestamp } from './common.ts';
import { Model, Revision } from './models.ts';
import { PersonalDataWarning } from './open-questions.ts';

/**
 * The state of an amendment: a live one's outcome on its model's head
 * (`applied`, `in-source`: „im Quellsystem übernommen“, `conflict`), or how
 * it ended (`withdrawn` by a human, `superseded` by a later amendment of the
 * same element and op). Carrying a value over from the source tool is
 * computed, never written.
 */
export const AmendmentState = z
  .enum(['applied', 'in-source', 'conflict', 'withdrawn', 'superseded'])
  .meta({ id: 'AmendmentState', description: 'State of a model amendment.' });
export type AmendmentState = z.infer<typeof AmendmentState>;

/** How an amendment ended: withdrawn by a human, or superseded by a later amendment. */
export const AmendmentWithdrawalReason = z
  .enum(['withdrawn', 'superseded'])
  .meta({ id: 'AmendmentWithdrawalReason', description: 'How an amendment ended.' });
export type AmendmentWithdrawalReason = z.infer<typeof AmendmentWithdrawalReason>;

/** The end of an amendment: why, who, and the seq of the event. */
export const ModelAmendmentWithdrawal = z
  .object({
    reason: AmendmentWithdrawalReason,
    /** Pseudonymous handle of the human who withdrew or superseded it. */
    by: z.string(),
    /** Seq of the `model.amendment_withdrawn` (or, superseded, the `model.amended`) event. */
    seq: z.number().int().min(1),
    at: Timestamp,
  })
  .meta({ id: 'ModelAmendmentWithdrawal', description: 'The end of a model amendment.' });
export type ModelAmendmentWithdrawal = z.infer<typeof ModelAmendmentWithdrawal>;

/**
 * One model amendment (append-only, humans only): the element whose field it
 * writes (for `message-name` the referenced message or signal, with the
 * endpoint the form was opened from in `viaElementId`), the value the
 * uploaded revision read (`before`: `''` for a call without a target, `null`
 * for no name or documentation) and the value set (`after`), both in the
 * extractor's sanitized form, who recorded it and its state. Values are model
 * content: plain text, render them as such.
 */
export const ModelAmendment = z
  .object({
    id: ModelAmendmentId,
    modelId: ModelId,
    modelKey: ModelKey,
    elementId: z.string(),
    /** The endpoint the form was opened from (`message-name` keyed by a message or signal). */
    viaElementId: z.string().nullable(),
    op: AmendmentOp,
    before: z.string().nullable(),
    after: z.string(),
    /** The uploaded revision `before` was read from. */
    baseRevisionId: RevisionId,
    /** The amendment of the same element and op this one superseded. */
    supersedesId: orNull(ModelAmendmentId),
    /** Pseudonymous handle of the human who recorded it. */
    by: z.string(),
    sourceKind: z.literal('human'),
    /** Seq of the `model.amended` event. */
    seq: z.number().int().min(1),
    at: Timestamp,
    state: AmendmentState,
    /** Why a live amendment is in conflict; `null` otherwise. */
    conflict: orNull(AmendmentConflictReason),
    /** Its model is deleted („Modell gelöscht“); the amendment stays live and comes back with it. */
    modelDeleted: z.boolean(),
    withdrawal: orNull(ModelAmendmentWithdrawal),
  })
  .meta({ id: 'ModelAmendment', description: 'A targeted amendment of a model field.' });
export type ModelAmendment = z.infer<typeof ModelAmendment>;

/** The amendments matching the filters, oldest first, and the seq the list reflects. */
export const ModelAmendmentList = z
  .object({
    items: z.array(ModelAmendment),
    /** The project's last event seq when the list was read („Stand: Ereignis …“). */
    seq: z.number().int().min(0),
  })
  .meta({ id: 'ModelAmendmentList', description: 'Model amendments.' });
export type ModelAmendmentList = z.infer<typeof ModelAmendmentList>;

/** Filters of the list and the change list: a model (or every model below a folder) and a state. */
export const AmendmentFilter = z.object({
  modelKey: ModelKey.optional(),
  state: AmendmentState.optional(),
});
export type AmendmentFilter = z.infer<typeof AmendmentFilter>;

/** Query of `GET …/amendments`. */
export const AmendmentListQuery = AmendmentFilter;
export type AmendmentListQuery = z.infer<typeof AmendmentListQuery>;

/** Format of the change list: Markdown to read, CSV for a spreadsheet. */
export const AmendmentExportFormat = z
  .enum(['markdown', 'csv'])
  .meta({ id: 'AmendmentExportFormat', description: 'Format of the change list.' });
export type AmendmentExportFormat = z.infer<typeof AmendmentExportFormat>;

/**
 * Query of `GET …/amendments/export`: the filters, the format (default
 * `markdown`) and `since` (only amendments recorded or ended after this
 * event seq: what is new since the last carry-over).
 */
export const AmendmentExportQuery = AmendmentFilter.extend({
  format: AmendmentExportFormat.default('markdown'),
  since: z.coerce.number().int().min(0).optional(),
});
export type AmendmentExportQuery = z.infer<typeof AmendmentExportQuery>;

// ------------------------------------------------------------- amendable

/** The kind of element an amendment writes. */
export const AmendableElementKind = z
  .enum(['call', 'start-event', 'end-event', 'process', 'message', 'signal', 'endpoint'])
  .meta({ id: 'AmendableElementKind', description: 'Kind of element an amendment writes.' });
export type AmendableElementKind = z.infer<typeof AmendableElementKind>;

/**
 * Why an amendment of a field cannot be recorded (`amendable`, a
 * `not-applicable` item):
 * - `only-open-questions`: no open question names the field, it is neither
 *   empty nor unresolved, and no live amendment set it („Nur für offene Fragen“);
 * - `invalid-value`: the value is empty, too long (never cut), an expression
 *   (call targets and names) or holds a character XML cannot carry;
 * - `expression`: the field holds an expression in either dialect;
 * - `cmmn-call`: the call activity calls a CMMN case (`camunda:caseRef`);
 * - `has-documentation`: the uploaded process has documentation (never replaced);
 * - `wrong-element`, `element-missing`, `duplicate-id`, `redeclared-prefix`,
 *   `unsupported-structure`, `check-failed`: the element cannot be written
 *   byte-preserving, or the result would not read exactly the intended change;
 * - `duplicate-amendment`: the request sets the field twice;
 * - `in-source`: the uploaded revision already has the value (withdraw the
 *   live amendment instead);
 * - `unknown-ref`, `not-a-process`, `same-process`: the call target is no
 *   process of the head, or one in the caller's own process;
 * - `partner-not-paired`: the partner is no complementary endpoint the name pairs with;
 * - `not-a-call-target`, `not-a-message-name`: `target` or `partner` on another op.
 */
export const AmendmentRefusal = z
  .enum([
    'only-open-questions',
    'invalid-value',
    'expression',
    'cmmn-call',
    'has-documentation',
    'wrong-element',
    'element-missing',
    'duplicate-id',
    'redeclared-prefix',
    'unsupported-structure',
    'check-failed',
    'duplicate-amendment',
    'in-source',
    'unknown-ref',
    'not-a-process',
    'same-process',
    'partner-not-paired',
    'not-a-call-target',
    'not-a-message-name',
  ])
  .meta({ id: 'AmendmentRefusal', description: 'Why a model amendment cannot be recorded.' });
export type AmendmentRefusal = z.infer<typeof AmendmentRefusal>;

/** A process a call target can name: a head process outside the caller's process. */
export const AmendProcessSuggestion = z
  .object({
    ref: Ref,
    processId: z.string(),
    /** The process's name, else its pool's, else its id. */
    name: z.string(),
    modelKey: ModelKey,
    modelName: z.string().nullable(),
    /** Several head processes have this id: the call stays ambiguous (proposals to every copy). */
    ambiguous: z.boolean(),
  })
  .meta({ id: 'AmendProcessSuggestion', description: 'A process a call target can name.' });
export type AmendProcessSuggestion = z.infer<typeof AmendProcessSuggestion>;

/** An endpoint of another process that throws or catches a name. */
export const AmendNameEndpoint = z
  .object({
    ref: Ref,
    kind: FactKind,
    /** The element's label, else its id. */
    name: z.string(),
    processName: z.string().nullable(),
    modelKey: ModelKey,
    /** Its kind complements the amended endpoint's: picking it sends it as `partner`. */
    partner: z.boolean(),
  })
  .meta({ id: 'AmendNameEndpoint', description: 'An endpoint that throws or catches a name.' });
export type AmendNameEndpoint = z.infer<typeof AmendNameEndpoint>;

/** A message or signal name of the landscape, with where it is thrown and caught. */
export const AmendNameSuggestion = z
  .object({
    name: z.string(),
    endpoints: z.array(AmendNameEndpoint),
  })
  .meta({ id: 'AmendNameSuggestion', description: 'A message or signal name of the landscape.' });
export type AmendNameSuggestion = z.infer<typeof AmendNameSuggestion>;

/**
 * What the form offers for a field: head processes (`call-target`), the
 * landscape's message or signal names (`message-name`), the labels of start
 * and end events elsewhere, the trigger partners (`event-name`).
 */
export const AmendSuggestions = z
  .object({
    processes: z.array(AmendProcessSuggestion).optional(),
    names: z.array(AmendNameSuggestion).optional(),
    labels: z.array(z.string()).optional(),
  })
  .meta({ id: 'AmendSuggestions', description: 'What the form offers for a field.' });
export type AmendSuggestions = z.infer<typeof AmendSuggestions>;

/**
 * One field the element allows (M6 §4.8 c "Where a field can be amended"):
 * the element whose field is written (for an endpoint that references a
 * message or signal, that message or signal), its current value on the head
 * and on the uploaded revision (sanitized like facts; `''` for a call without
 * a target, `null` for no name or documentation), whether it can be set and
 * why not, its live amendment, the elements reading a message name, and the
 * suggestions.
 */
export const AmendableField = z
  .object({
    op: AmendmentOp,
    elementId: z.string(),
    /** The endpoint asked about, when the field is keyed by the message or signal it references. */
    viaElementId: z.string().nullable(),
    element: AmendableElementKind,
    /** German type of the element, an endpoint by its BPMN type: „Nachrichten-Endereignis“, „Sendeaufgabe“. */
    typeLabel: z.string(),
    /** German name of the field, a name by its family: „Nachrichtenname“, „Signalname“. */
    fieldLabel: z.string(),
    value: z.string().nullable(),
    uploadedValue: z.string().nullable(),
    settable: z.boolean(),
    /** Why the field cannot be set; `null` when it can. */
    reason: orNull(AmendmentRefusal),
    /** The live amendment of the field (`replaces` it when set again). */
    live: orNull(ModelAmendment),
    /** `message-name`: the elements whose facts read the name, sorted. */
    readers: z.array(Ref),
    suggestions: AmendSuggestions,
  })
  .meta({ id: 'AmendableField', description: 'A field of an element a model amendment can set.' });
export type AmendableField = z.infer<typeof AmendableField>;

/**
 * The amendable fields of one element (`GET …/elements/{elementId}/amendable`):
 * the model's head (its `ETag` is `"r<headRev>"`, which the save sends as
 * `If-Match`), the uploaded revision the head is computed from, the fields,
 * and every amendment of the element, oldest first.
 */
export const AmendableElement = z
  .object({
    modelId: ModelId,
    modelKey: ModelKey,
    /** As asked (a pool resolves to its process). */
    elementId: z.string(),
    headRevisionId: RevisionId,
    headRev: z.number().int().min(1),
    uploadedRevisionId: RevisionId,
    fields: z.array(AmendableField),
    history: z.array(ModelAmendment),
  })
  .meta({ id: 'AmendableElement', description: 'The amendable fields of one element.' });
export type AmendableElement = z.infer<typeof AmendableElement>;

/** Longest raw value of an amendment item (the stored, sanitized value has its field's fact limit). */
export const MAX_AMENDMENT_RAW_CHARS = 8000;

/**
 * One amendment of a request: the element (a call, an event, a process, a
 * message or signal, or an endpoint, which the server resolves to the
 * message or signal it references), the op, and the value: `after` (free
 * text, normalized as the extractor sanitizes the field) or, for
 * `call-target`, `target` (a head process outside the caller's process,
 * written as its id); `partner` (`message-name`) names the endpoint whose
 * name was picked, so the key-tier proposal between them is accepted as the
 * human's decision; `replaces` names the live amendment it supersedes (409
 * `conflict` when another one is live).
 */
export const AmendModelItem = z
  .object({
    elementId: z.string().min(1).max(255),
    op: AmendmentOp,
    after: z.string().max(MAX_AMENDMENT_RAW_CHARS).optional(),
    target: Ref.optional(),
    partner: Ref.optional(),
    replaces: ModelAmendmentId.optional(),
  })
  .superRefine((item, ctx) => {
    if ((item.after === undefined) === (item.target === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['after'], message: 'send either after or target' });
    }
  })
  .meta({ id: 'AmendModelItem', description: 'One amendment of a request.' });
export type AmendModelItem = z.infer<typeof AmendModelItem>;

/**
 * The amendments of one model, saved in one request and one re-derivation
 * (1 to {@link MAX_AMENDMENT_ITEMS}, no two on one element and op).
 */
export const AmendModelBody = z
  .object({
    items: z.array(AmendModelItem).min(1).max(MAX_AMENDMENT_ITEMS),
  })
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    for (const [i, item] of body.items.entries()) {
      const key = `${item.op}\u0000${item.elementId}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', i],
          message: 'two items on the same element and op',
        });
      }
      seen.add(key);
    }
  })
  .meta({ id: 'AmendModelBody', description: 'The amendments of one model.' });
export type AmendModelBody = z.infer<typeof AmendModelBody>;

/** Query of the amendments route: `dryRun=true` previews the effect and the cost and writes nothing. */
export const AmendModelQuery = z.object({
  dryRun: z.enum(['true', 'false']).optional(),
});
export type AmendModelQuery = z.infer<typeof AmendModelQuery>;

/** Query of the withdrawal routes: `dryRun=true` computes the cost and writes nothing. */
export const WithdrawAmendmentsQuery = z.object({
  dryRun: z.enum(['true', 'false']).optional(),
});
export type WithdrawAmendmentsQuery = z.infer<typeof WithdrawAmendmentsQuery>;

/**
 * What became of one item: `recorded` (in a dry run: would be recorded),
 * `unchanged` (identical to the live amendment: nothing written) or
 * `not-applicable` (with the reason; a request with one is refused with 422
 * `validation-failed`, `reason: 'amendment-not-applicable'`, unless it is a
 * dry run).
 */
export const AmendModelItemResult = z
  .object({
    elementId: z.string(),
    op: AmendmentOp,
    outcome: z.enum(['recorded', 'unchanged', 'not-applicable']),
    reason: AmendmentRefusal.optional(),
    /** English detail of a `not-applicable` item. */
    message: z.string().optional(),
    /** The element whose field is written (a message or signal for an endpoint that references one). */
    amendmentElementId: z.string().optional(),
    /** The value as it is stored (sanitized like facts). */
    after: z.string().optional(),
    /** The value the uploaded revision reads. */
    before: z.string().nullable().optional(),
    /** The recorded amendment (not in a dry run), or the live one it is identical to. */
    amendment: ModelAmendment.optional(),
    /** The live amendment the item supersedes. */
    supersedes: ModelAmendmentId.optional(),
    /**
     * The personal-data check's warnings on a name or documentation (offsets
     * into `after`); a warning, never a block.
     */
    warnings: z.array(PersonalDataWarning).optional(),
  })
  .meta({ id: 'AmendModelItemResult', description: 'What became of one amendment.' });
export type AmendModelItemResult = z.infer<typeof AmendModelItemResult>;

/** A relation an amendment's effect names: the stored relation, if there is one. */
export const AmendmentEffectRelation = z
  .object({
    relation: orNull(RelationId),
    type: RelationType,
    from: Ref,
    to: Ref,
  })
  .meta({ id: 'AmendmentEffectRelation', description: 'A relation an amendment affects.' });
export type AmendmentEffectRelation = z.infer<typeof AmendmentEffectRelation>;

/**
 * The would-be effect of the amendments (the rule tier over the head facts
 * with the model's facts replaced): findings resolved and added, rule-tier
 * relations accepted (a unique call, decision 9), proposed (key-tier names,
 * ambiguous calls) or no longer derived, the key-tier proposals a `partner`
 * accepts, accepted relations whose endpoint changes (`changed`, waiting for
 * re-confirming) and the manual relations retired (a link from the call to
 * the target it now calls, a link to the accepted partner).
 */
export const AmendmentEffect = z
  .object({
    findingsResolved: z.array(Finding),
    findingsAdded: z.array(Finding),
    accepted: z.array(AmendmentEffectRelation),
    proposed: z.array(AmendmentEffectRelation),
    withdrawn: z.array(AmendmentEffectRelation),
    partnerAccepted: z.array(AmendmentEffectRelation),
    changed: z.array(AmendmentEffectRelation),
    retired: z.array(AmendmentEffectRelation),
  })
  .meta({ id: 'AmendmentEffect', description: 'The would-be effect of amendments.' });
export type AmendmentEffect = z.infer<typeof AmendmentEffect>;

/**
 * The cost of a new head (decision 17): the pairs whose current judgement it
 * makes non-current (they are judged again), and whether the model's
 * relations task is claimed (the new head cancels it, and the agent loses
 * its work).
 */
export const AmendmentCost = z
  .object({
    factsChange: z.boolean(),
    pairsToRejudge: z.number().int().min(0),
    taskClaimed: z.boolean(),
  })
  .meta({ id: 'AmendmentCost', description: 'The cost of a new head.' });
export type AmendmentCost = z.infer<typeof AmendmentCost>;

/**
 * The outcome of an amendment request: `recorded` (a new amended head; in a
 * dry run: would be recorded, every item applicable) or `unchanged` (nothing
 * to record: every item identical to its live amendment, or, in a dry run, an
 * item not applicable); each item, the model and its head afterwards (the
 * new head; `null` in a dry run and when `unchanged`), and the effect and
 * the cost, computed before writing.
 */
export const AmendModelResult = z
  .object({
    dryRun: z.boolean(),
    outcome: z.enum(['recorded', 'unchanged']),
    items: z.array(AmendModelItemResult),
    model: Model,
    /** The new head (amended revision); `null` in a dry run and when `unchanged`. */
    revision: orNull(Revision),
    effect: AmendmentEffect,
    cost: AmendmentCost,
  })
  .meta({ id: 'AmendModelResult', description: 'The outcome of an amendment request.' });
export type AmendModelResult = z.infer<typeof AmendModelResult>;

/**
 * The outcome of a withdrawal: `withdrawn` or `unchanged` (every amendment
 * had ended before); the amendments as they are now; the new head,
 * re-derived from the uploaded revision with the remaining live amendments
 * (`null` when nothing was withdrawn and for a deleted model, which gets no
 * revision).
 */
export const WithdrawAmendmentsResult = z
  .object({
    result: z.enum(['withdrawn', 'unchanged']),
    amendments: z.array(ModelAmendment),
    model: orNull(Model),
    revision: orNull(Revision),
    /** `true` for a dry run (`?dryRun=true`): nothing was written; absent otherwise. */
    dryRun: z.boolean().optional(),
    /**
     * A dry run's cost of the new head the withdrawal would write (the
     * current judgements it makes non-current, a claimed relations task);
     * absent outside a dry run and on a deleted model, which gets no
     * revision.
     */
    cost: AmendmentCost.optional(),
  })
  .meta({ id: 'WithdrawAmendmentsResult', description: 'The outcome of a withdrawal.' });
export type WithdrawAmendmentsResult = z.infer<typeof WithdrawAmendmentsResult>;

/** Params of the routes about one amendment. */
export const AmendmentParam = z.object({ amendment: ModelAmendmentId });

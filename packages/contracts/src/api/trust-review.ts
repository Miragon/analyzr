/**
 * „Vor der Vertrauensregel angenommen“ (M6 S2c-4; owner decisions 24.2 (a)
 * and 28 (3)): a one-time clean-up for landscapes imported before the trust
 * rule. A revision stored before S2c carries no trust class and counts as
 * modelled, so the rule tier's acceptances of its unique calls stay. The
 * owner reviews those whose revision would be derived today from what it
 * carries (no engine; uploaded with an agent token, or before S2a by a
 * service principal; a declared kind other than `export`): „Zurück in die
 * Prüfung“ records `derived` (the calls become the rule tier's proposals,
 * which a bulk accept or an owner's rule for derived calls may accept),
 * „Behalten“ records `modelled` (they stay accepted). One review per
 * uploaded revision, recorded once (append-only); a revision the trust rule
 * classified is never reviewed. Owners only, never for agents (no MCP).
 */
import { z } from 'zod';

import { ModelId, RelationId, RevisionId } from '../ids.ts';
import { ModelKey, Ref } from '../refs.ts';
import { orNull } from '../zod-utils.ts';
import { DerivedKind } from './import-manifest.ts';
import { ImpactAutoAcceptedCalls, TrustClass, TrustReason } from './models.ts';

/** Most revisions one review names (a project's models, in practice). */
export const MAX_PRE_TRUST_REVISIONS = 1000;
/** Most calls a model of the list names; `count` says how many there are. */
export const MAX_PRE_TRUST_CALLS = 100;

/** A unique call the rule tier accepted from a revision stored before the trust rule. */
export const PreTrustCall = z
  .object({
    relationId: RelationId,
    from: Ref,
    to: Ref,
  })
  .meta({
    id: 'PreTrustCall',
    description: 'A unique call accepted by the rule tier before the trust rule.',
  });
export type PreTrustCall = z.infer<typeof PreTrustCall>;

/**
 * A model whose uploaded revision was stored before the trust rule and would
 * be derived today, with the unique calls the rule tier accepted from it
 * (resting on the rule tier's decision alone; a call target set in analyzr
 * counts as modelled, decision 25.2, and is not listed).
 */
export const PreTrustModel = z
  .object({
    modelId: ModelId,
    modelKey: ModelKey,
    /** The model's name (`bpmn:definitions` name or first process name). */
    modelName: z.string().nullable(),
    /** The uploaded revision a review names (for an amended head, its `upstream`). */
    revisionId: RevisionId,
    rev: z.number().int().min(1),
    /** Why it would be derived today, in {@link TrustReason}'s order (at least one). */
    reasons: z.array(TrustReason).min(1),
    /** `derived.kind` as declared; `null` when none is declared. */
    derivedKind: orNull(DerivedKind),
    /** `derived.converter` as stored; `null` when none is declared. */
    converter: z.string().nullable(),
    /** The listed calls of this model. */
    count: z.number().int().min(1),
    /** The first {@link MAX_PRE_TRUST_CALLS}, by natural key. */
    calls: z.array(PreTrustCall).max(MAX_PRE_TRUST_CALLS),
  })
  .meta({
    id: 'PreTrustModel',
    description: 'A model with unique calls accepted before the trust rule.',
  });
export type PreTrustModel = z.infer<typeof PreTrustModel>;

export const PreTrustList = z
  .object({
    /** Every listed call. */
    count: z.number().int().min(0),
    /** By model key. */
    models: z.array(PreTrustModel),
  })
  .meta({
    id: 'PreTrustList',
    description: 'Unique calls accepted before the trust rule whose caller would be derived today.',
  });
export type PreTrustList = z.infer<typeof PreTrustList>;

/**
 * A review of listed revisions: `derived` („Zurück in die Prüfung“) or
 * `modelled` („Behalten“). A dry run first, then the real call with the dry
 * run's `count` as `expectedCount`.
 */
export const PreTrustReviewBody = z
  .object({
    verdict: TrustClass,
    revisionIds: z
      .array(RevisionId)
      .min(1)
      .max(MAX_PRE_TRUST_REVISIONS)
      .refine((ids) => new Set(ids).size === ids.length, 'every revision once'),
    /** The listed calls of these revisions the dry run counted (required for the real call). */
    expectedCount: z.number().int().min(0).optional(),
  })
  .meta({
    id: 'PreTrustReviewBody',
    description: 'A review of revisions stored before the trust rule.',
  });
export type PreTrustReviewBody = z.infer<typeof PreTrustReviewBody>;

export const PreTrustReviewResult = z
  .object({
    dryRun: z.boolean(),
    verdict: TrustClass,
    /** The revisions reviewed (or that would be). */
    revisions: z.number().int().min(0),
    /** Their listed calls: what `expectedCount` must equal. */
    count: z.number().int().min(0),
    /** Calls that turn from accepted into the rule tier's proposals (`derived` only). */
    toProposed: z.number().int().min(0),
    /**
     * Of the proposals the review records, those an enabled auto-accept rule
     * for derived calls accepts again in the same write (`derived` only, M6
     * S2c-3); `ofProposed` of them are among `toProposed` (the calls left
     * for „Gesammelt annehmen“ are `toProposed − ofProposed`), the others
     * are proposals the same recompute records besides.
     */
    autoAcceptedCalls: ImpactAutoAcceptedCalls,
  })
  .meta({
    id: 'PreTrustReviewResult',
    description: 'What a review of revisions stored before the trust rule did or would do.',
  });
export type PreTrustReviewResult = z.infer<typeof PreTrustReviewResult>;

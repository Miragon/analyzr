/**
 * „Vor der Vertrauensregel angenommen“ (M6 S2c-4; owner decisions 24.2 (a)
 * and 28 (3)): a one-time clean-up for landscapes imported before the trust
 * rule. A revision stored before S2c carries no class and counts as
 * modelled, so the rule tier's acceptances of its unique calls stay; the
 * owner lists those whose revision would be derived today
 * ({@link preTrustAcceptances}) and reviews them per revision, once:
 * `derived` („Zurück in die Prüfung“) makes the revision count as derived,
 * so the recompute turns those calls into the rule tier's proposals (and an
 * enabled rule for derived calls may accept them again in the same write,
 * M6 S2c-3); `modelled` („Behalten“) keeps them. The review is a row of the
 * append-only `revision_trust_review`, which the trust rule reads where a
 * revision carries no class (`trust.ts` `storedTrust`); a revision the trust
 * rule classified is never reviewed.
 *
 * Both use cases need `admin` (an owner on an interactive client): agent
 * tokens and editors get 403, and nothing here is reachable over MCP.
 */
import {
  MAX_IMPACT_ITEMS,
  MAX_PRE_TRUST_CALLS,
  type AutoAcceptRuleId,
  type ImpactAutoAcceptedCalls,
  type PreTrustList,
  type PreTrustReviewBody,
  type PreTrustReviewResult,
  type PrincipalId,
  type RevisionId,
} from '@analyzr/contracts';

import type { Actor } from '../actor.ts';
import { autoAcceptDerivedCalls, type AutoAcceptedCall } from '../auto-accept/apply.ts';
import { DomainError } from '../errors.ts';
import { relationImpact } from '../import-impact.ts';
import { derivedCallRulesFor, rulesPrincipalOf } from '../ingest.ts';
import { policy } from '../policy.ts';
import type { ProjectRecord, Tx } from '../ports.ts';
import { recomputeProject } from '../recompute.ts';
import { byRelation } from '../relation-state.ts';
import {
  isOpenDerivedCall,
  preTrustAcceptances,
  trustByModel,
  type PreTrustGroup,
} from '../trust.ts';
import type { UseCaseDeps } from './deps.ts';

/** What the trust review use cases get injected. */
export interface TrustReviewDeps extends UseCaseDeps {
  /** Id of the system principal `analyzr-rules` (created on first use). */
  rulesPrincipal(): Promise<PrincipalId>;
}

const NO_AUTO_ACCEPTED: ImpactAutoAcceptedCalls = {
  count: 0,
  items: [],
  ofProposed: 0,
  byRule: [],
};

/** What a review reads in one transaction: the models' trust rows, relations, histories, the list. */
async function readList(tx: Tx, project: ProjectRecord) {
  const rows = await tx.revisions.headTrustRows(project.id);
  const relations = await tx.relations.all(project.id);
  const history = await tx.assertions.listForProject(project.id);
  return {
    rows,
    relations,
    history,
    groups: preTrustAcceptances(rows, relations, byRelation(history)),
  };
}

/** `PreTrustList` from the pure list. */
function toList(groups: readonly PreTrustGroup[]): PreTrustList {
  return {
    count: groups.reduce((n, g) => n + g.calls.length, 0),
    models: groups.map((g) => ({
      modelId: g.modelId,
      modelKey: g.modelKey,
      modelName: g.modelName,
      revisionId: g.revisionId,
      rev: g.rev,
      reasons: g.reasons,
      derivedKind: g.derivedKind,
      converter: g.converter,
      count: g.calls.length,
      calls: g.calls
        .slice(0, MAX_PRE_TRUST_CALLS)
        .map((c) => ({ relationId: c.id, from: c.fromRef, to: c.toRef })),
    })),
  };
}

/**
 * The listed revisions a review names, and the ids it names that are not
 * listed now. An id that names no revision of the project, or one the trust
 * rule classified (or an amended one), is refused (422): a review never
 * changes a class the server assigned.
 *
 * @throws {DomainError} `validation-failed` with `reason` `unknown-revision` or `revision-classified`
 */
async function selection(
  tx: Tx,
  project: ProjectRecord,
  groups: readonly PreTrustGroup[],
  ids: readonly RevisionId[],
): Promise<{ selected: PreTrustGroup[]; notListed: RevisionId[] }> {
  const listed = new Set<string>(groups.map((g) => g.revisionId));
  const named = new Set<string>(ids);
  // In the list's order (model keys).
  const selected = groups.filter((g) => named.has(g.revisionId));
  const notListed = ids.filter((id) => !listed.has(id));
  if (notListed.length > 0) {
    const states = new Map(
      (await tx.revisions.trustStates(project.id, notListed)).map((s) => [s.id as string, s]),
    );
    for (const id of notListed) {
      const state = states.get(id);
      if (!state) {
        throw new DomainError('validation-failed', `${id} names no revision of this project`, {
          reason: 'unknown-revision',
        });
      }
      if (state.source.trust || state.source.kind === 'amendment') {
        throw new DomainError(
          'validation-failed',
          state.source.kind === 'amendment'
            ? `${id} is an amended revision; its uploaded revision carries the class`
            : `${id} carries the trust rule's class; a review never changes it`,
          { reason: 'revision-classified' },
        );
      }
    }
  }
  return { selected, notListed };
}

/** `autoAcceptedCalls` of a written review: what the fifth write path accepted, as the dry run counts it. */
function acceptedSummary(
  accepted: readonly AutoAcceptedCall[],
  toProposed: ReadonlySet<string>,
): ImpactAutoAcceptedCalls {
  const byRule = new Map<AutoAcceptRuleId, { ruleName: string; count: number; order: number }>();
  for (const { rule } of accepted) {
    const counted = byRule.get(rule.ruleId) ?? { ruleName: rule.name, count: 0, order: rule.order };
    counted.count++;
    byRule.set(rule.ruleId, counted);
  }
  return {
    count: accepted.length,
    items: accepted.slice(0, MAX_IMPACT_ITEMS).map(({ relation, rule }) => ({
      type: relation.type,
      from: relation.fromRef,
      to: relation.toRef,
      ruleId: rule.ruleId,
      ruleName: rule.name,
    })),
    ofProposed: accepted.filter((a) => toProposed.has(a.relation.id)).length,
    byRule: [...byRule]
      .sort(([, a], [, b]) => a.order - b.order)
      .map(([ruleId, { ruleName, count }]) => ({ ruleId, ruleName, count })),
  };
}

export function trustReviewUseCases(deps: TrustReviewDeps) {
  return {
    /**
     * „Vor der Vertrauensregel angenommen“: the rule tier's acceptances from
     * revisions stored before the trust rule that would be derived today, by
     * model ({@link preTrustAcceptances}).
     *
     * @throws {DomainError} policy errors (`admin`)
     */
    async listPreTrustCalls(actor: Actor, projectRef: string): Promise<PreTrustList> {
      return deps.store.read(async (tx) => {
        const { project } = await policy.require(tx, actor, 'admin', projectRef);
        return toList((await readList(tx, project)).groups);
      });
    },

    /**
     * Reviews listed revisions, once each: `derived` („Zurück in die
     * Prüfung“) or `modelled` („Behalten“). The real call runs under the
     * project lock: it checks `expectedCount` against the listed calls of
     * the revisions, records the reviews with one `revision.trust_reviewed`
     * event (revision ids, class and count), and for `derived` recomputes
     * (the calls turn into the rule tier's proposals) and runs the owner's
     * rules for derived calls over the proposals it recorded, caused by the
     * caller. The dry run plans the same over a snapshot (`planRecompute`
     * with the reviews in memory, the rules as the import's dry run
     * evaluates them) and writes nothing; its numbers equal the write's, and
     * it refuses a revision not listed now as the write does (409
     * `not-listed`), so a client that follows the refusal lists again.
     *
     * @throws {DomainError} policy errors; `validation-failed` (`unknown-revision`,
     *   `revision-classified`, `expected-count-required`); `conflict` with `count`
     *   (`not-listed`, `count-changed`)
     */
    async reviewPreTrustCalls(
      actor: Actor,
      projectRef: string,
      body: PreTrustReviewBody,
      options: { dryRun: boolean },
    ): Promise<PreTrustReviewResult> {
      const rulesPrincipalId = options.dryRun ? null : await deps.rulesPrincipal();
      const run = async (tx: Tx): Promise<PreTrustReviewResult> => {
        const { project } = await policy.require(tx, actor, 'admin', projectRef);
        if (!options.dryRun) await tx.projects.lockForWrite(project.id);
        const read = await readList(tx, project);
        const { selected, notListed } = await selection(tx, project, read.groups, body.revisionIds);
        const count = selected.reduce((n, g) => n + g.calls.length, 0);
        const result = (
          toProposed: number,
          autoAcceptedCalls: ImpactAutoAcceptedCalls,
        ): PreTrustReviewResult => ({
          dryRun: options.dryRun,
          verdict: body.verdict,
          revisions: selected.length,
          count,
          toProposed,
          autoAcceptedCalls,
        });
        const reviewed = new Set<string>(selected.map((g) => g.revisionId));
        if (!options.dryRun && body.expectedCount === undefined) {
          throw new DomainError('validation-failed', 'a review needs the count of the dry run', {
            reason: 'expected-count-required',
          });
        }
        // The dry run refuses what the write would refuse: a client that follows it lists again.
        if (notListed.length > 0) {
          throw new DomainError(
            'conflict',
            `${notListed.length} of the revisions are not listed now (already reviewed, uploaded again, or nothing of theirs to review); list them again`,
            { count, reason: 'not-listed' },
          );
        }

        if (options.dryRun) {
          if (body.verdict === 'modelled') return result(0, NO_AUTO_ACCEPTED);
          const projectFacts = await tx.facts.headProjectFacts(project.id);
          const auto = await derivedCallRulesFor(tx, actor, project);
          const impact = relationImpact(
            {
              projectId: project.id,
              rulesPrincipalId: rulesPrincipalOf(read.history),
              projectFacts,
              rules: deps.analysis.runRules(projectFacts),
              trust: trustByModel(
                read.rows.map((r) =>
                  reviewed.has(r.revisionId) ? { ...r, review: body.verdict } : r,
                ),
              ),
              relations: read.relations,
              history: read.history,
            },
            [],
            auto ?? undefined,
            // `ofProposed` among `toProposed`, as the write counts it.
            'was-accepted',
          );
          return result(
            impact.callsProposed.wasAccepted,
            impact.autoAcceptedCalls ?? NO_AUTO_ACCEPTED,
          );
        }

        if (body.expectedCount !== count) {
          throw new DomainError(
            'conflict',
            `${count} calls are listed for these revisions now; run the dry run again`,
            { count, reason: 'count-changed' },
          );
        }
        const seq = await tx.events.append(project.id, {
          type: 'revision.trust_reviewed',
          principalId: actor.principalId,
          clientId: actor.clientId,
          subjectRef: null,
          payload: {
            revisionIds: selected.map((g) => g.revisionId),
            class: body.verdict,
            count,
          },
        });
        await tx.trustReviews.insert(
          selected.map((g) => ({
            projectId: project.id,
            revisionId: g.revisionId,
            modelId: g.modelId,
            class: body.verdict,
            principalId: actor.principalId,
            clientId: actor.clientId,
            sourceKind: 'human' as const,
            seq,
          })),
        );
        // „Behalten“: the class reads `modelled`, as before the review; nothing to recompute.
        if (body.verdict === 'modelled' || rulesPrincipalId === null) {
          return result(0, NO_AUTO_ACCEPTED);
        }
        const before = new Map(read.relations.map((r) => [r.id as string, r.status]));
        const { derivedProposals } = await recomputeProject({
          tx,
          projectId: project.id,
          rulesPrincipalId,
          analysis: deps.analysis,
        });
        const toProposed = new Set(
          (await tx.relations.all(project.id))
            .filter((r) => before.get(r.id) === 'accepted' && isOpenDerivedCall(r))
            .map((r) => r.id as string),
        );
        // An enabled rule for derived calls may accept them again in this write (M6 S2c-3).
        const accepted = await autoAcceptDerivedCalls(
          tx,
          actor,
          project.id,
          derivedProposals,
          deps.expectedProcedure(),
        );
        return result(toProposed.size, acceptedSummary(accepted, toProposed));
      };
      return options.dryRun ? deps.store.read(run) : deps.store.write(run);
    },
  };
}

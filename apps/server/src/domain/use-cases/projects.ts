import {
  MAX_ATTEMPTS,
  newId,
  type CreateProjectBody,
  type PageQuery,
  type Project,
  type ProjectPage,
  type ProjectId,
  type ProjectSummary,
} from '@analyzr/contracts';

import type { Actor } from '../actor.ts';
import { decodeCursor, toPage } from '../cursor.ts';
import { DomainError } from '../errors.ts';
import { heldPairs, modelOf, pairsToJudge } from '../judgements.ts';
import {
  buildOpenQuestions,
  filterOpenQuestions,
  groupTotals,
} from '../open-questions/read-model.ts';
import { effectiveScopes, policy } from '../policy.ts';
import type { ModelTaskDetail, RelationRecord, Tx } from '../ports.ts';
import { toProject } from '../views.ts';
import { ALL, type UseCaseDeps } from './deps.ts';
import {
  CandidateCache,
  loadOpenQuestionInput,
  type LoadedOpenQuestionInput,
} from './open-questions.ts';

/**
 * An item waiting for a human decision, the rule of the project tabs'
 * badges (UX-SIMPLIFICATION §2.5; `model_pipeline.review_items`, the web's
 * `isReviewItem` and `isOpenPlacement`): a proposal, or an accepted relation
 * or placement whose endpoint changed or is missing. Held items wait for an
 * answer and count among the open questions.
 */
const waitsForDecision = (item: Pick<RelationRecord, 'status' | 'endpointState'>): boolean =>
  item.status === 'proposed' || (item.status === 'accepted' && item.endpointState !== 'ok');

/** The size of the agents' next run ({@link countPairsToJudge}) and how long it holds. */
interface NextRun {
  pairs: number;
  /**
   * When the earliest lease of a claimed relations task that has not run out
   * runs out: that claim then holds nothing, and its task is claimable again
   * (or fails at its last attempt), so the count changes without an event;
   * `null` without such a lease.
   */
  validUntil: Date | null;
}

const isModelTask = (t: { subjectKind: string }): t is ModelTaskDetail => t.subjectKind === 'model';

/**
 * `ProjectSummary.pairsToJudge` (M6 S2b follow-up step 3b): the pairs the
 * next claims of the claimable relations tasks will be assigned, the tasks
 * `claim_analysis` takes at `now` (`TaskRepo.claim`): the queued ones and the
 * claimed ones whose lease ran out with attempts left. A claim with a live
 * lease holds its pairs and its model counts not. {@link pairsToJudge} over
 * the claimable models' own candidates (`ownCandidates`, from the read
 * model's candidate pass: nothing generated, no second cache lookup), the
 * relations and current judgements the read model read, and the pairs live
 * claims hold for them ({@link heldPairs}, `planClaim`'s rule 1: a claim
 * saw a model as it is now when the model's head is not newer than the
 * claim's `claimed_seq`, or has the facts it had then, as the claim's own
 * `sawModel` decides). Rules 2 and 3 only decide which of these claims judges
 * a pair, so the union is exact for the stored state. Reads two task lists,
 * and one revision query per live claim whose assignment has a pair with a
 * claimable model revised since that claim. Placement tasks judge no pairs.
 */
async function countPairsToJudge(
  tx: Tx,
  projectId: ProjectId,
  input: LoadedOpenQuestionInput,
  now: Date,
): Promise<NextRun> {
  const tasks = async (state: 'queued' | 'claimed') =>
    (await tx.tasks.list(projectId, { state, kind: 'relations' }, { limit: ALL })).filter(
      isModelTask,
    );
  const queued = await tasks('queued');
  const claimed = await tasks('claimed');
  const live = claimed.filter((t) => t.leaseUntil !== null && t.leaseUntil > now);
  const ranOut = claimed.filter(
    (t) => t.leaseUntil !== null && t.leaseUntil < now && t.attempts < MAX_ATTEMPTS,
  );
  // A lease that runs out at `now` exactly counts in neither: the next read is past it.
  const validUntil = claimed.reduce<Date | null>(
    (min, t) =>
      t.leaseUntil !== null && t.leaseUntil >= now && (min === null || t.leaseUntil < min)
        ? t.leaseUntil
        : min,
    null,
  );
  const next = new Set(
    [...queued, ...ranOut].map((t) => t.modelKey).filter((key) => input.models.has(key)),
  );
  if (next.size === 0) return { pairs: 0, validUntil };
  // The claimable models a live claim's assignment names, at that claim, for those revised since.
  const at = new Map<string, ReadonlyMap<string, string>>();
  for (const t of live) {
    const since = t.claimedSeq;
    if (since === null) continue;
    const later = new Set<string>();
    for (const pair of t.assignment ?? []) {
      for (const end of [modelOf(pair.from), modelOf(pair.to)]) {
        if (end !== t.modelKey && next.has(end) && (input.models.get(end)?.seq ?? 0) > since) {
          later.add(end);
        }
      }
    }
    if (later.size > 0) at.set(t.id, await tx.revisions.hashesAt(projectId, [...later], since));
  }
  const held = heldPairs(live, next, (t, modelKey) => {
    const head = input.models.get(modelKey);
    if (t.claimedSeq === null || head === undefined) return false;
    return head.seq <= t.claimedSeq || at.get(t.id)?.get(modelKey) === head.factsHash;
  });
  const pairs = pairsToJudge({
    models: next,
    candidatesOf: (modelKey) => input.ownCandidates.get(modelKey) ?? [],
    relations: input.relations,
    judged: held.size === 0 ? input.judged : new Set([...input.judged, ...held]),
  });
  return { pairs: pairs.size, validUntil };
}

/** Projects whose summary a use-case instance keeps (least recently used first out). */
const SUMMARY_MEMO_PROJECTS = 256;

/**
 * The project summaries, memoized per project on its `lastSeq` and the
 * procedures claims name now: every write appends an event, whose `seq`
 * advances `lastSeq` in the writing transaction (CONCEPT §2; the landscape
 * ETag `"s<seq>"` rests on the same), and the summary reads one REPEATABLE
 * READ snapshot. The open questions' read model reads no clock; the pairs to
 * judge read it for the leases of claimed relations tasks only, so an entry
 * holds until the earliest of them runs out ({@link NextRun}), and a hit is
 * exact. An unchanged project then costs the policy and the project read;
 * the projects list builds a project's read model once per change, not once
 * per visit, so its rows no longer push the candidates of the project in
 * work out of {@link CandidateCache}.
 */
class SummaryMemo {
  private readonly entries = new Map<
    ProjectId,
    { key: string; summary: ProjectSummary; validUntil: Date | null }
  >();
  private readonly size: number;

  constructor(size = SUMMARY_MEMO_PROJECTS) {
    this.size = size;
  }

  get(projectId: ProjectId, key: string, now: Date): ProjectSummary | undefined {
    const hit = this.entries.get(projectId);
    if (hit?.key !== key || (hit.validUntil !== null && now >= hit.validUntil)) return undefined;
    this.entries.delete(projectId);
    this.entries.set(projectId, hit);
    return { ...hit.summary };
  }

  set(projectId: ProjectId, key: string, summary: ProjectSummary, validUntil: Date | null): void {
    this.entries.delete(projectId);
    this.entries.set(projectId, { key, summary: { ...summary }, validUntil });
    while (this.entries.size > this.size) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

/**
 * @param candidates the whole-project candidates, memoized; shared with the
 *   open questions' use cases, so the summary and the list pay them once
 */
export function projectUseCases(deps: UseCaseDeps, candidates = new CandidateCache()) {
  const summaries = new SummaryMemo();
  /** The memo key of a project state: its `lastSeq` and both procedures (tests play releases). */
  const summaryKey = (lastSeq: number): string => {
    const relations = deps.expectedProcedure();
    const placements = deps.expectedPlacementProcedure();
    return `${lastSeq} ${relations.id}@${relations.version} ${placements.id}@${placements.version}`;
  };
  return {
    /**
     * Any user may create a project and owns it (CONCEPT §6). Agent tokens
     * are bound to one project and cannot create others.
     *
     * @throws {DomainError} `forbidden`, `insufficient-scope`, `conflict` (key taken)
     */
    async createProject(actor: Actor, body: CreateProjectBody): Promise<Project> {
      if (actor.kind !== 'user' || !actor.interactive) {
        throw new DomainError('forbidden', 'only users on an interactive client create projects');
      }
      if (!effectiveScopes(actor.scopes).has('analyzr:write')) {
        throw new DomainError('insufficient-scope', 'requires scope analyzr:write');
      }
      return deps.store.write(async (tx) => {
        const id = newId('project');
        const inserted = await tx.projects.insert({ id, key: body.key, name: body.name });
        if (!inserted) throw new DomainError('conflict', `project key ${body.key} already exists`);
        await tx.memberships.insert(id, actor.principalId, 'owner');
        await tx.events.append(id, {
          type: 'project.created',
          principalId: actor.principalId,
          clientId: actor.clientId,
          subjectRef: id,
          payload: { projectId: id, key: body.key, name: body.name, owner: actor.principalId },
        });
        const project = await tx.projects.findByRef(id);
        if (!project) throw new Error('project vanished inside its transaction');
        return toProject(project, 'owner');
      });
    },

    /** Projects visible to the caller: memberships, or the token's one project. */
    async listProjects(actor: Actor, query: PageQuery): Promise<ProjectPage> {
      const afterKey = query.cursor ? decodeCursor(query.cursor, ['string'])[0] : undefined;
      if (!effectiveScopes(actor.scopes).has('analyzr:read')) {
        throw new DomainError('insufficient-scope', 'requires scope analyzr:read');
      }
      return deps.store.read(async (tx) => {
        if (actor.binding) {
          const { role } = actor.binding;
          const project = await tx.projects.findByRef(actor.binding.projectId);
          const visible = project && (afterKey === undefined || project.key > afterKey);
          return { items: visible ? [toProject(project, role)] : [], nextCursor: null };
        }
        const rows = await tx.projects.listForPrincipal(actor.principalId, {
          afterKey,
          limit: query.limit + 1,
        });
        const page = toPage(rows, query.limit, (p) => [p.key]);
        return { items: page.items.map((p) => toProject(p, p.role)), nextCursor: page.nextCursor };
      });
    },

    async getProject(actor: Actor, projectRef: string): Promise<Project> {
      return deps.store.read(async (tx) => {
        const { project, role } = await policy.require(tx, actor, 'read', projectRef);
        return toProject(project, role);
      });
    },

    /**
     * The project's open work and the time of its latest change, for the
     * projects list's „Offen für dich“ and „Zuletzt geändert“
     * (UX-SIMPLIFICATION §3.12 item 1; REST only, `Project` stays MCP
     * `list_projects`'s output). Every count comes from the open questions'
     * read model, whose whole-project candidates are memoized on the head
     * facts: the relations that are not obsolete and the value chain's
     * placements are its input, so the summary reads nothing the open
     * questions' list does not read as well, except the open relations tasks
     * for `pairsToJudge` ({@link countPairsToJudge}, with the clock for their
     * leases). The summary itself is memoized per project state
     * ({@link SummaryMemo}), after the policy check: an unchanged project
     * answers from the memo.
     *
     * @throws {DomainError} policy errors (`not-found` for an unknown or foreign project)
     */
    async getProjectSummary(actor: Actor, projectRef: string): Promise<ProjectSummary> {
      return deps.store.read(async (tx) => {
        const { project } = await policy.require(tx, actor, 'read', projectRef);
        const now = deps.clock.now();
        const key = summaryKey(project.lastSeq);
        const memoized = summaries.get(project.id, key, now);
        if (memoized) return memoized;
        const input = await loadOpenQuestionInput(tx, deps, project.id, candidates);
        const { items } = buildOpenQuestions(input);
        const next = await countPairsToJudge(tx, project.id, input, now);
        const [latest] = await tx.events.list(project.id, {
          afterSeq: Math.max(0, project.lastSeq - 1),
          limit: 1,
        });
        const summary: ProjectSummary = {
          lastEventAt: (latest?.at ?? project.createdAt).toISOString(),
          reviewItems: input.relations.filter(waitsForDecision).length,
          openPlacements: input.chain?.placements.filter(waitsForDecision).length ?? 0,
          ask: groupTotals(filterOpenQuestions(items, { state: 'open' })).ask,
          pairsToJudge: next.pairs,
        };
        summaries.set(project.id, key, summary, next.validUntil);
        return summary;
      });
    },
  };
}

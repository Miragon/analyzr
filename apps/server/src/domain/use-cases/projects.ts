import {
  newId,
  type CreateProjectBody,
  type PageQuery,
  type Project,
  type ProjectPage,
  type ProjectSummary,
} from '@analyzr/contracts';

import type { Actor } from '../actor.ts';
import { decodeCursor, toPage } from '../cursor.ts';
import { DomainError } from '../errors.ts';
import {
  buildOpenQuestions,
  filterOpenQuestions,
  groupTotals,
} from '../open-questions/read-model.ts';
import { effectiveScopes, policy } from '../policy.ts';
import type { RelationRecord } from '../ports.ts';
import { toProject } from '../views.ts';
import type { UseCaseDeps } from './deps.ts';
import { CandidateCache, loadOpenQuestionInput } from './open-questions.ts';

/**
 * An item waiting for a human decision, the rule of the project tabs'
 * badges (UX-SIMPLIFICATION §2.5; `model_pipeline.review_items`, the web's
 * `isReviewItem` and `isOpenPlacement`): a proposal, or an accepted relation
 * or placement whose endpoint changed or is missing. Held items wait for an
 * answer and count among the open questions.
 */
const waitsForDecision = (item: Pick<RelationRecord, 'status' | 'endpointState'>): boolean =>
  item.status === 'proposed' || (item.status === 'accepted' && item.endpointState !== 'ok');

/**
 * @param candidates the whole-project candidates, memoized; shared with the
 *   open questions' use cases, so the summary and the list pay them once
 */
export function projectUseCases(deps: UseCaseDeps, candidates = new CandidateCache()) {
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
     * questions' list does not read as well.
     *
     * @throws {DomainError} policy errors (`not-found` for an unknown or foreign project)
     */
    async getProjectSummary(actor: Actor, projectRef: string): Promise<ProjectSummary> {
      return deps.store.read(async (tx) => {
        const { project } = await policy.require(tx, actor, 'read', projectRef);
        const input = await loadOpenQuestionInput(tx, deps, project.id, candidates);
        const { items } = buildOpenQuestions(input);
        const [latest] = await tx.events.list(project.id, {
          afterSeq: Math.max(0, project.lastSeq - 1),
          limit: 1,
        });
        return {
          lastEventAt: (latest?.at ?? project.createdAt).toISOString(),
          reviewItems: input.relations.filter(waitsForDecision).length,
          openPlacements: input.chain?.placements.filter(waitsForDecision).length ?? 0,
          ask: groupTotals(filterOpenQuestions(items, { state: 'open' })).ask,
        };
      });
    },
  };
}

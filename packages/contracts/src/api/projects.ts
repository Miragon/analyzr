import { z } from 'zod';

import { ProjectId } from '../ids.ts';
import { plainName } from '../zod-utils.ts';
import { Role } from './auth.ts';
import { Timestamp, pageOf } from './common.ts';

/** Project key: one lowercase slug segment, e.g. `nordwind-handel`. */
export const ProjectKey = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase slug, e.g. nordwind-handel')
  .meta({
    id: 'ProjectKey',
    description: 'Unique project key (lowercase slug).',
    example: 'nordwind-handel',
  });
export type ProjectKey = z.infer<typeof ProjectKey>;

export const Project = z
  .object({
    id: ProjectId,
    key: ProjectKey,
    name: z.string().min(1).max(200),
    /** The caller's role in this project. */
    role: Role,
    /** Sequence number of the latest event; the landscape ETag is `"s<lastSeq>"`. */
    lastSeq: z.number().int().min(0),
    createdAt: Timestamp,
  })
  .meta({ id: 'Project', description: 'A project: one process landscape.' });
export type Project = z.infer<typeof Project>;

const count = () => z.number().int().min(0);

/**
 * A project's open work and its latest change, for the projects list (REST
 * only; UX-SIMPLIFICATION §3.12 item 1). The counts follow the project tabs'
 * badges (§2.5), so a number means the same on every screen: `reviewItems`
 * the relations waiting for a decision (proposed, or accepted with an
 * endpoint that changed or is missing), `openPlacements` the same rule for
 * the placements on the project's value chain (0 without one), `ask` the
 * open questions' `totals.ask` of `state=open`. Held items count only in
 * `ask`. `pairsToJudge` is the size of the agents' next run (M6 S2b
 * follow-up step 3b). Not part of {@link Project}, which is MCP
 * `list_projects`'s output.
 */
export const ProjectSummary = z
  .object({
    /** Time of the project's latest event (its creation at the earliest). */
    lastEventAt: Timestamp,
    /** Relations to review: proposed, or accepted with a changed or missing endpoint. */
    reviewItems: count(),
    /** Placements to review on the value chain: the same rule; 0 without a chain. */
    openPlacements: count(),
    /** Open questions to clarify (`totals.ask` of the open questions with `state=open`). */
    ask: count(),
    /**
     * About how many possible relations (typed pairs) the agents' next run
     * will judge, over the stored head: the union of what the next claims of
     * the relations tasks an agent may claim now are assigned (the queued
     * ones, the models „warten auf den Agenten“, and the claimed ones whose
     * lease ran out with attempts left), each pair once (a pair between two
     * such models counts once), without the pairs with a current agent
     * judgement and those a decision settles, as the dry runs count them. A
     * task an agent holds right now (its lease runs) counts not: its pairs
     * are its claim's, and so is a pair of its assignment with a model above
     * whose claim it saw as it is now, which that model's claim skips. Exact
     * for the stored state when read; "about", as decisions and imports
     * before the claims change it and agents may examine more pairs than they
     * are assigned. 0 when no such task waits.
     */
    pairsToJudge: count(),
  })
  .meta({
    id: 'ProjectSummary',
    description: "A project's open work and the time of its latest change.",
  });
export type ProjectSummary = z.infer<typeof ProjectSummary>;

export const CreateProjectBody = z
  .object({ key: ProjectKey, name: plainName(200) })
  .meta({ id: 'CreateProjectBody', description: 'Request body to create a project.' });
export type CreateProjectBody = z.infer<typeof CreateProjectBody>;

export const ProjectPage = pageOf(Project, 'ProjectPage');
export type ProjectPage = z.infer<typeof ProjectPage>;

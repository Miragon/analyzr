/**
 * Open questions (M6 §4.2–§4.4, S4): the list and its Markdown and CSV
 * export, computed on read from one snapshot. Permission `read`, so viewers
 * and the read-only demo see them. Nothing here writes.
 */
import {
  VALUE_CHAIN_KEY,
  type Candidate,
  type OpenQuestion,
  type OpenQuestionExportQuery,
  type OpenQuestionPage,
  type OpenQuestionQuery,
  type ProjectFacts,
  type ProjectId,
  type ValueChainId,
  type ValueChainRevisionId,
} from '@analyzr/contracts';

import type { Actor } from '../actor.ts';
import { decodeCursor } from '../cursor.ts';
import { visibleFindings } from '../findings.ts';
import { linkJudgements, pairKey } from '../judgements.ts';
import {
  exportFilename,
  renderOpenQuestionsCsv,
  renderOpenQuestionsMarkdown,
} from '../open-questions/export.ts';
import {
  POSITION_SHAPE,
  type ChainInput,
  type ModelHead,
  type OpenQuestionInput,
  type SubmissionNote,
  type UnsureVerdict,
} from '../open-questions/model.ts';
import {
  filterOpenQuestions,
  openQuestions,
  pageOpenQuestions,
} from '../open-questions/read-model.ts';
import { policy } from '../policy.ts';
import type {
  DoneChainTask,
  DoneModelTask,
  ProjectRecord,
  StoredAssertion,
  StoredSubmission,
  Tx,
} from '../ports.ts';
import { byRelation } from '../relation-state.ts';
import { sameProcedure } from '../status.ts';
import { loadChainState } from '../value-chain/chain-state.ts';
import { loadPipelineInputs } from '../value-chain/queue.ts';
import { ALL, type UseCaseDeps } from './deps.ts';
import { chainFindings } from './value-chains.ts';

/** The rendered export: what the HTTP layer sends as an attachment. */
export interface OpenQuestionExport {
  filename: string;
  contentType: string;
  body: string;
}

/** The live value chain `main` with its findings, open processes and current unsure verdicts. */
async function loadChain(
  tx: Tx,
  deps: UseCaseDeps,
  projectId: ProjectId,
): Promise<{ chain: ChainInput; id: ValueChainId; head: ValueChainRevisionId } | null> {
  const record = await tx.valueChains.findByKey(projectId, VALUE_CHAIN_KEY);
  if (!record || record.deletedSeq !== null || record.headRevisionId === null) return null;
  const state = await loadChainState(tx, record);
  const inputs = await loadPipelineInputs(tx, state, deps.expectedPlacementProcedure());
  const unsure: UnsureVerdict[] = [];
  for (const process of inputs.open) {
    const row = inputs.rows.get(process);
    if (row?.outcome !== 'unsure' || row.reason === null) continue;
    if (row.inputHash !== inputs.hashOf(process)) continue;
    unsure.push({
      process,
      reason: row.reason,
      inputHash: row.inputHash,
      handle: row.handle,
      seq: row.seq,
    });
  }
  return {
    id: record.id,
    head: record.headRevisionId,
    chain: {
      key: record.key,
      headSeq: state.head.seq,
      structure: state.structure,
      live: state.live,
      placements: inputs.placements,
      histories: inputs.histories,
      findings: await chainFindings(tx, state, inputs.placements),
      open: inputs.open,
      unsure,
    },
  };
}

/** The summary and uncovered pairs of a stored submission. */
function noteOf(
  kind: SubmissionNote['kind'],
  subject: string,
  s: StoredSubmission,
): SubmissionNote {
  const summary = s.payload['summary'];
  const result = s.result;
  const uncovered = 'kind' in result ? undefined : result.uncovered;
  return {
    kind,
    subject,
    submissionId: s.id,
    handle: s.handle,
    seq: s.seq,
    summary: typeof summary === 'string' ? summary : null,
    uncovered: uncovered ? { count: uncovered.count, pairs: uncovered.pairs } : null,
  };
}

/**
 * The placement batches whose summaries are current, newest first: a done
 * task shows its summary until newer done tasks on the same chain revision
 * claimed every process it claimed (a placement run comes in batches of at
 * most `MAX_CLAIM_PLACEMENT_PROCESSES`, each its own task).
 */
export function currentPlacementBatches(done: readonly DoneChainTask[]): DoneChainTask[] {
  const covered = new Set<string>();
  const out: DoneChainTask[] = [];
  for (const [i, t] of [...done].sort((a, b) => b.seq - a.seq).entries()) {
    const processes = t.processes ?? [];
    if (i === 0 || processes.some((p) => !covered.has(p))) out.push(t);
    for (const p of processes) covered.add(p);
  }
  return out;
}

/**
 * The current submissions: per live model the latest done relations task on
 * its head facts, and the chain's current placement batches on its head
 * revision ({@link currentPlacementBatches}), each under the procedure claims
 * name now.
 */
async function loadSubmissions(
  tx: Tx,
  deps: UseCaseDeps,
  projectId: ProjectId,
  heads: ReadonlyMap<string, ModelHead>,
  chain: { id: ValueChainId; head: ValueChainRevisionId } | null,
): Promise<SubmissionNote[]> {
  const models = new Map<string, DoneModelTask>();
  for (const t of await tx.tasks.latestDoneByModelHash(projectId)) {
    if (heads.get(t.modelKey)?.factsHash === t.factsHash && !models.has(t.modelKey)) {
      models.set(t.modelKey, t);
    }
  }
  const batches = chain
    ? currentPlacementBatches(await tx.tasks.doneOnChainRevision(projectId, chain.id, chain.head))
    : [];
  const byTask = new Map(
    (
      await tx.submissions.findByTasks(projectId, [
        ...[...models.values()].map((t) => t.id),
        ...batches.map((t) => t.id),
      ])
    ).map((s) => [s.taskId, s]),
  );
  const out: SubmissionNote[] = [];
  for (const t of models.values()) {
    const s = byTask.get(t.id);
    if (!s || !sameProcedure(s.declared.procedure, deps.expectedProcedure())) continue;
    out.push(noteOf('relations', t.modelKey, s));
  }
  for (const t of batches) {
    const s = byTask.get(t.id);
    if (!s || !sameProcedure(s.declared.procedure, deps.expectedPlacementProcedure())) continue;
    out.push(noteOf('placement', t.valueChainKey, s));
  }
  // By subject; a chain's batches stay newest first.
  return out.sort((a, b) => (a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0));
}

/** Projects whose candidates a use-case instance keeps (least recently used first out). */
const CANDIDATE_CACHE_PROJECTS = 8;

/**
 * Every model's candidates, memoized per project on the head facts: the key
 * is the sorted `modelKey=facts_hash` of the live models, and
 * `generateCandidates` is a pure function of the head facts, so a hit is
 * exact. Whole-project candidates grow quadratically with the landscape
 * (about 2.2 s at 310 models), while the read model itself takes
 * milliseconds; the list's pages, the tab's count, the model view's section
 * and the export then pay it once per ingest, not per request.
 */
export class CandidateCache {
  private readonly entries = new Map<ProjectId, { key: string; candidates: Candidate[] }>();
  private readonly size: number;

  constructor(size = CANDIDATE_CACHE_PROJECTS) {
    this.size = size;
  }

  get(
    projectId: ProjectId,
    projectFacts: ProjectFacts,
    hashes: ReadonlyMap<string, string>,
    compute: (facts: ProjectFacts) => Candidate[],
  ): Candidate[] {
    const parts = projectFacts.models.map((m) => [m.modelKey, hashes.get(m.modelKey)] as const);
    // A model without a known head hash: no exact key, so no cache.
    if (parts.some(([, hash]) => hash === undefined)) return compute(projectFacts);
    const key = parts
      .map(([k, hash]) => `${k}=${hash ?? ''}`)
      .sort()
      .join('\n');
    const hit = this.entries.get(projectId);
    if (hit?.key === key) {
      this.entries.delete(projectId);
      this.entries.set(projectId, hit);
      return hit.candidates;
    }
    const candidates = compute(projectFacts);
    this.entries.delete(projectId);
    this.entries.set(projectId, { key, candidates });
    while (this.entries.size > this.size) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return candidates;
  }
}

/** Everything the read model reads, in the caller's read snapshot. */
export async function loadOpenQuestionInput(
  tx: Tx,
  deps: UseCaseDeps,
  projectId: ProjectId,
  cache: CandidateCache = new CandidateCache(0),
): Promise<OpenQuestionInput> {
  const procedure = deps.expectedProcedure();
  const projectFacts = await tx.facts.headProjectFacts(projectId);
  const revisionHeads = await tx.revisions.heads(projectId);
  const models = new Map<string, ModelHead>();
  for (const m of await tx.models.list(projectId, { limit: ALL })) {
    const head = revisionHeads.get(m.key);
    if (!head) continue;
    models.set(m.key, { name: m.name, engine: m.engine, factsHash: head.factsHash, seq: head.seq });
  }
  const relations = (await tx.relations.all(projectId)).filter((r) => r.status !== 'obsolete');
  const histories = byRelation<StoredAssertion>(await tx.assertions.listForProject(projectId));
  const hashes = new Map([...models].map(([k, m]) => [k, m.factsHash]));
  const noLinks = (await tx.noLinks.listLive(projectId, {}, procedure)).filter((n) => n.current);
  const judged = new Set([
    ...linkJudgements(relations, histories, new Map(), hashes, procedure)
      .filter((j) => j.current)
      .map(pairKey),
    ...noLinks.map((n) => pairKey({ type: n.type, from: n.fromRef, to: n.toRef })),
  ]);
  const chain = await loadChain(tx, deps, projectId);
  return {
    projectFacts,
    models,
    findings: visibleFindings(await tx.findings.list(projectId), relations),
    relations,
    histories,
    judged,
    noLinks,
    candidates: cache.get(projectId, projectFacts, hashes, (facts) =>
      deps.analysis.candidates(facts),
    ),
    chain: chain?.chain ?? null,
    submissions: await loadSubmissions(tx, deps, projectId, models, chain),
  };
}

export function openQuestionUseCases(deps: UseCaseDeps) {
  const candidates = new CandidateCache();

  /** The project and every open question, in list order. */
  async function all(
    tx: Tx,
    actor: Actor,
    projectRef: string,
  ): Promise<{ project: ProjectRecord; items: OpenQuestion[] }> {
    const { project } = await policy.require(tx, actor, 'read', projectRef);
    return {
      project,
      items: openQuestions(await loadOpenQuestionInput(tx, deps, project.id, candidates)),
    };
  }

  return {
    /**
     * The open questions matching the filters (M6 §4.4), a cursor page in
     * list order (`unlocks` descending), with the total.
     */
    async listOpenQuestions(
      actor: Actor,
      projectRef: string,
      query: OpenQuestionQuery,
    ): Promise<OpenQuestionPage> {
      const after = query.cursor ? decodeCursor(query.cursor, POSITION_SHAPE) : undefined;
      return deps.store.read(async (tx) => {
        const { items } = await all(tx, actor, projectRef);
        return pageOpenQuestions(filterOpenQuestions(items, query), query.limit, after);
      });
    },

    /** Every open question matching the filters, as Markdown or CSV (M6 §4.4). */
    async exportOpenQuestions(
      actor: Actor,
      projectRef: string,
      query: OpenQuestionExportQuery,
    ): Promise<OpenQuestionExport> {
      return deps.store.read(async (tx) => {
        const { project, items } = await all(tx, actor, projectRef);
        const { format, ...filter } = query;
        const matching = filterOpenQuestions(items, filter);
        if (format === 'csv') {
          return {
            filename: exportFilename(project.key, filter, format),
            contentType: 'text/csv; charset=utf-8',
            body: renderOpenQuestionsCsv(matching),
          };
        }
        return {
          filename: exportFilename(project.key, filter, format),
          contentType: 'text/markdown; charset=utf-8',
          body: renderOpenQuestionsMarkdown(matching, {
            projectName: project.name,
            projectKey: project.key,
            seq: project.lastSeq,
            filter,
          }),
        };
      });
    },
  };
}

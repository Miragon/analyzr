/**
 * Open questions (M6 §4.2–§4.5): the list and its Markdown and CSV export,
 * computed on read from one snapshot (S4; permission `read`, so viewers and
 * the read-only demo see them), and the answers (S5a; permission `review`,
 * humans only): one at a time or from a filled-in sheet, each recorded in
 * the append-only `open_question_answer`. An answer on a relation or a
 * placement is a human note on it through the note use cases' own write
 * (`recordRelationNote`, `addPlacementNote`), so it reaches agents exactly
 * as a note does today; every other answer keeps its text. Answers change
 * no analysis rule: no judgement basis, no queueing, no stage.
 */
import {
  MAX_ANSWER_CHARS,
  VALUE_CHAIN_KEY,
  newId,
  normalizeAnswerText,
  openQuestionsPath,
  personalDataWarnings,
  type AnswerOpenQuestionBody,
  type AnswerOpenQuestionResult,
  type AnswerSheetBody,
  type AnswerSheetResult,
  type Candidate,
  type OpenQuestion,
  type OpenQuestionAnswer,
  type OpenQuestionExportQuery,
  type OpenQuestionPage,
  type OpenQuestionQuery,
  type PlacementId,
  type ProjectFacts,
  type ProjectId,
  type RelationId,
  type ValueChainId,
  type ValueChainRevisionId,
} from '@analyzr/contracts';

import { sourceKindOf, type Actor } from '../actor.ts';
import { decodeCursor } from '../cursor.ts';
import { DomainError } from '../errors.ts';
import { visibleFindings } from '../findings.ts';
import { linkJudgements, pairKey } from '../judgements.ts';
import {
  exportFilename,
  renderOpenQuestionsCsv,
  renderOpenQuestionsMarkdown,
} from '../open-questions/export.ts';
import {
  answerTarget,
  checkSheet,
  sameAnswer,
  toOpenQuestionAnswer,
  type AnswerDraft,
} from '../open-questions/answers.ts';
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
import { policy, type ProjectAccess } from '../policy.ts';
import type {
  DoneChainTask,
  DoneModelTask,
  OpenQuestionAnswerRecord,
  ProjectRecord,
  StoredAssertion,
  StoredSubmission,
  Tx,
} from '../ports.ts';
import { byRelation } from '../relation-state.ts';
import { sameProcedure } from '../status.ts';
import { loadChainState } from '../value-chain/chain-state.ts';
import { addPlacementNote } from '../value-chain/placements.ts';
import { loadPipelineInputs } from '../value-chain/queue.ts';
import { ALL, type UseCaseDeps } from './deps.ts';
import { recordRelationNote } from './review.ts';
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
    answers: await tx.openQuestionAnswers.list(projectId),
  };
}

/**
 * `policy.require(…, 'review', …)` for answers: a human on an interactive
 * client; an agent's attempt fails with `human-decision-required` carrying
 * `reviewUrl`, the tab „Offene Fragen“ (a path the HTTP layer makes
 * absolute).
 */
async function requireAnswering(tx: Tx, actor: Actor, projectRef: string): Promise<ProjectAccess> {
  try {
    return await policy.require(tx, actor, 'review', projectRef);
  } catch (err) {
    if (err instanceof DomainError && err.code === 'human-decision-required') {
      const project = await tx.projects.findByRef(projectRef);
      throw new DomainError(err.code, err.message, {
        reviewUrl: openQuestionsPath(project?.key ?? projectRef),
      });
    }
    throw err;
  }
}

/**
 * Records answers in the caller's write transaction (the project lock held),
 * in order, each with its `open_question.answered` event (no free text in
 * it): on a relation or placement a human note through the note use cases'
 * own write plus a row naming the note, else a row with the text.
 *
 * @returns the recorded answers as the API shows them, in order
 */
export async function recordAnswers(
  tx: Tx,
  projectId: ProjectId,
  actor: Actor,
  drafts: readonly AnswerDraft[],
): Promise<OpenQuestionAnswer[]> {
  if (sourceKindOf(actor) !== 'human') {
    throw new DomainError('human-decision-required', 'only a human answers open questions');
  }
  const ids: string[] = [];
  for (const { question, kind, text } of drafts) {
    const { subject } = question;
    let noteAssertionId: OpenQuestionAnswerRecord['noteAssertionId'] = null;
    if (subject.type === 'relation') {
      const relation = await tx.relations.findInProject(projectId, subject.id as RelationId);
      if (!relation) throw new Error(`relation ${subject.id} of a current open question vanished`);
      noteAssertionId = (await recordRelationNote(tx, projectId, actor, relation, text)).id;
    } else if (subject.type === 'placement') {
      const placement = await tx.placements.findInProject(projectId, subject.id as PlacementId);
      if (!placement) {
        throw new Error(`placement ${subject.id} of a current open question vanished`);
      }
      noteAssertionId = (await addPlacementNote(tx, projectId, actor, placement, text)).id;
    }
    const seq = await tx.events.append(projectId, {
      type: 'open_question.answered',
      principalId: actor.principalId,
      clientId: actor.clientId,
      subjectRef: subject.id,
      payload: {
        questionId: question.id,
        kind,
        subject: { type: subject.type, id: subject.id },
        target: answerTarget(subject),
        ...(noteAssertionId === null ? {} : { noteAssertionId }),
      },
    });
    const row: OpenQuestionAnswerRecord = {
      id: newId('openQuestionAnswer'),
      projectId,
      questionId: question.id,
      subjectType: subject.type,
      subjectId: subject.id,
      kind,
      text: noteAssertionId === null ? text : null,
      noteAssertionId,
      principalId: actor.principalId,
      sourceKind: 'human',
      seq,
    };
    await tx.openQuestionAnswers.insert(row);
    ids.push(row.id);
  }
  if (ids.length === 0) return [];
  const stored = new Map(
    (await tx.openQuestionAnswers.list(projectId)).map((a) => [a.id as string, a]),
  );
  return ids.map((id) => {
    const a = stored.get(id);
    if (!a) throw new Error('an answer vanished inside its transaction');
    return toOpenQuestionAnswer(a);
  });
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
    return { project, items: await itemsOf(tx, project.id) };
  }

  /** Every open question of the project, in list order. */
  async function itemsOf(tx: Tx, projectId: ProjectId): Promise<OpenQuestion[]> {
    return openQuestions(await loadOpenQuestionInput(tx, deps, projectId, candidates));
  }

  return {
    /**
     * The open questions matching the filters (M6 §4.4), a cursor page in
     * list order (questions, then the value chain's findings, then
     * informational items, each by `unlocks` descending), with the total.
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

    /**
     * Answers one open question (M6 §4.5 S5a): recorded as a note on its
     * relation or placement, else with its text; when the item's latest
     * answer is identical (kind and text) it is returned `unchanged` and
     * nothing is written. The text is normalized first (LF line breaks,
     * NFC), as for a sheet. The personal-data check warns and never blocks.
     *
     * @throws {DomainError} `not-found` for an id that names no current item; policy errors
     */
    async answerOpenQuestion(
      actor: Actor,
      projectRef: string,
      questionId: string,
      body: AnswerOpenQuestionBody,
    ): Promise<AnswerOpenQuestionResult> {
      return deps.store.write(async (tx) => {
        const { project } = await requireAnswering(tx, actor, projectRef);
        await tx.projects.lockForWrite(project.id);
        const question = (await itemsOf(tx, project.id)).find((q) => q.id === questionId);
        if (!question) {
          throw new DomainError(
            'not-found',
            'open question not found; its id changes when its source changes, so list the questions again',
          );
        }
        const text = normalizeAnswerText(body.text);
        // NFC can lengthen a few scripts' letters, so the limit holds for the stored text.
        if (text.length > MAX_ANSWER_CHARS) {
          throw new DomainError(
            'validation-failed',
            `text: at most ${MAX_ANSWER_CHARS} characters after normalization`,
          );
        }
        const draft: AnswerDraft = { question, kind: body.kind, text };
        const warnings = personalDataWarnings(text);
        const same = sameAnswer(draft);
        if (same) return { result: 'unchanged', answer: same, question, warnings };
        const [answer] = await recordAnswers(tx, project.id, actor, [draft]);
        if (!answer) throw new Error('the answer was not recorded');
        // A note changes neither the status nor the basis of its relation or placement,
        // so the item keeps its id and everything but its answers.
        return {
          result: 'recorded',
          answer,
          question: { ...question, state: 'answered', answers: [...question.answers, answer] },
          warnings,
        };
      });
    },

    /**
     * The answers of a filled-in sheet (M6 §4.5 "Bulk answers"), all in one
     * transaction, each row as {@link answerOpenQuestion} would record it:
     * empty answers ignored (counted), unknown ids and invalid rows listed and
     * never stored, answers identical to the item's latest `unchanged`. A dry
     * run reads one snapshot and writes nothing.
     */
    async answerOpenQuestions(
      actor: Actor,
      projectRef: string,
      body: AnswerSheetBody,
      options: { dryRun: boolean },
    ): Promise<AnswerSheetResult> {
      const run = async (tx: Tx): Promise<AnswerSheetResult> => {
        const { project } = await requireAnswering(tx, actor, projectRef);
        if (!options.dryRun) await tx.projects.lockForWrite(project.id);
        const items = new Map((await itemsOf(tx, project.id)).map((q) => [q.id, q]));
        const { counts, rows, record } = checkSheet(body.rows, items);
        if (!options.dryRun) {
          const recorded = await recordAnswers(
            tx,
            project.id,
            actor,
            record.map((r) => r.draft),
          );
          for (const [i, r] of record.entries()) {
            const answer = recorded[i];
            if (answer) r.result.answer = answer;
          }
        }
        return { dryRun: options.dryRun, counts, rows };
      };
      return options.dryRun ? deps.store.read(run) : deps.store.write(run);
    },
  };
}

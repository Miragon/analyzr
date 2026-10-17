/**
 * Open questions (M6 §4.2–§4.5, §4.8): the list and its Markdown and CSV
 * export, computed on read from one snapshot (S4; permission `read`, so
 * viewers and the read-only demo see them), the notes (S5a, simplified by
 * S5c-1), the actions and the outside mark with its withdrawal (S5c-1;
 * permission `review`, humans only). A note on a relation or a placement is
 * a human note on it through the note use cases' own write
 * (`recordRelationNote`, `addPlacementNote`), so it reaches agents exactly
 * as a note does today; every other note and every outside mark is a row
 * of the append-only `open_question_answer`. The actions delegate to the
 * use cases that exist (`recordDecision`, `acceptManual`,
 * `acceptManualPlacement`), in one transaction under the project lock.
 * Nothing here changes an analysis rule: no judgement basis, no queueing,
 * no stage.
 */
import {
  MAX_ANSWER_CHARS,
  OUTSIDE_STEP,
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
  type OpenQuestionActionBody,
  type OpenQuestionActionEffect,
  type OpenQuestionActionResult,
  type OpenQuestionAnswer,
  type OpenQuestionAnswerId,
  type OpenQuestionExportQuery,
  type OpenQuestionPage,
  type OpenQuestionQuery,
  type PersonalDataWarning,
  type PlacementId,
  type ProjectFacts,
  type ProjectId,
  type Ref,
  type RelationId,
  type ValueChainId,
  type ValueChainRevisionId,
  type WithdrawOpenQuestionAnswerResult,
} from '@analyzr/contracts';

import { sourceKindOf, type Actor } from '../actor.ts';
import { readModelAmendments } from '../amendments/state.ts';
import { decodeCursor } from '../cursor.ts';
import { DomainError } from '../errors.ts';
import { headFingerprints } from '../fingerprints.ts';
import { visibleFindings } from '../findings.ts';
import { linkJudgements, pairKey } from '../judgements.ts';
import { actionRationale, copyTexts, linkPlan, linkSteps } from '../open-questions/actions.ts';
import {
  exportFilename,
  renderOpenQuestionsCsv,
  renderOpenQuestionsMarkdown,
} from '../open-questions/export.ts';
import {
  answerTarget,
  checkSheet,
  isLiveMark,
  liveMark,
  markable,
  sameAnswer,
  toOpenQuestionAnswer,
  type AnswerDraft,
} from '../open-questions/answers.ts';
import {
  POSITION_SHAPE,
  type ChainInput,
  type ModelHead,
  type OpenQuestionIndex,
  type OpenQuestionInput,
  type SubmissionNote,
  type UnsureVerdict,
} from '../open-questions/model.ts';
import {
  buildOpenQuestions,
  filterOpenQuestions,
  pageOpenQuestions,
} from '../open-questions/read-model.ts';
import { policy, type ProjectAccess } from '../policy.ts';
import type {
  DoneChainTask,
  DoneModelTask,
  OpenQuestionAnswerRecord,
  PlacementRecord,
  ProjectRecord,
  RelationRecord,
  StoredAssertion,
  StoredSubmission,
  Tx,
} from '../ports.ts';
import { byRelation, relationViews } from '../relation-state.ts';
import { sameProcedure } from '../status.ts';
import { liveChain, loadChainState, type ChainState } from '../value-chain/chain-state.ts';
import { processHomes } from '../value-chain/findings.ts';
import { acceptManualPlacement, addPlacementNote } from '../value-chain/placements.ts';
import { loadPipelineInputs } from '../value-chain/queue.ts';
import { placementViews } from '../value-chain/views.ts';
import { ALL, type UseCaseDeps } from './deps.ts';
import { liveStep } from './placements.ts';
import { acceptManual, recordDecision, recordRelationNote } from './review.ts';
import { chainFindings, placementViewContext } from './value-chains.ts';

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
  const warnings = await tx.revisions.headWarnings(projectId);
  const models = new Map<string, ModelHead>();
  for (const m of await tx.models.list(projectId, { limit: ALL })) {
    const head = revisionHeads.get(m.key);
    if (!head) continue;
    const extractWarnings = warnings.get(m.key);
    models.set(m.key, {
      modelId: m.id,
      name: m.name,
      engine: m.engine,
      factsHash: head.factsHash,
      seq: head.seq,
      ...(extractWarnings === undefined ? {} : { extractWarnings }),
    });
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
  const amendments = await readModelAmendments(tx, projectId);
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
    ...(amendments.size > 0 ? { amendments } : {}),
  };
}

/**
 * `policy.require(…, 'review', …)` for notes, actions and withdrawals: a
 * human on an interactive client; an agent's attempt fails with
 * `human-decision-required` carrying `reviewUrl`, the tab „Offene Fragen“
 * (a path the HTTP layer makes absolute).
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
 * it): a note on a relation or placement through the note use cases' own
 * write plus a row naming the note, any other note as a row with the text,
 * an outside mark as a row of kind `outside-landscape` with its optional
 * note (never on a relation or placement).
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
  for (const draft of drafts) {
    const { question } = draft;
    const { subject } = question;
    let noteAssertionId: OpenQuestionAnswerRecord['noteAssertionId'] = null;
    if (draft.kind === 'outside-landscape') {
      if (!markable(subject)) throw new Error('an outside mark on a relation or placement');
    } else if (subject.type === 'relation') {
      const relation = await tx.relations.findInProject(projectId, subject.id as RelationId);
      if (!relation) throw new Error(`relation ${subject.id} of a current open question vanished`);
      noteAssertionId = (await recordRelationNote(tx, projectId, actor, relation, draft.text)).id;
    } else if (subject.type === 'placement') {
      const placement = await tx.placements.findInProject(projectId, subject.id as PlacementId);
      if (!placement) {
        throw new Error(`placement ${subject.id} of a current open question vanished`);
      }
      noteAssertionId = (await addPlacementNote(tx, projectId, actor, placement, draft.text)).id;
    }
    const seq = await tx.events.append(projectId, {
      type: 'open_question.answered',
      principalId: actor.principalId,
      clientId: actor.clientId,
      subjectRef: subject.id,
      payload: {
        questionId: question.id,
        kind: draft.kind,
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
      kind: draft.kind,
      text: noteAssertionId === null ? draft.text : null,
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

/**
 * The note sent with an action, normalized like an answer
 * ({@link normalizeAnswerText}); `null` when empty.
 *
 * @throws {DomainError} `validation-failed` when it is longer than {@link MAX_ANSWER_CHARS} after normalization
 */
function actionNote(note: string | undefined): string | null {
  const text = normalizeAnswerText(note ?? '');
  if (text === '') return null;
  if (text.length > MAX_ANSWER_CHARS) {
    throw new DomainError(
      'validation-failed',
      `note: at most ${MAX_ANSWER_CHARS} characters after normalization`,
    );
  }
  return text;
}

/** 422 `validation-failed` with a `reason` for an action that cannot run as sent. */
function refuse(reason: string, message: string): DomainError {
  return new DomainError('validation-failed', message, { reason });
}

/** What an action wrote or decided, before the views. */
interface ActionWrites {
  relations: { effect: OpenQuestionActionEffect; record: RelationRecord }[];
  placements: { effect: OpenQuestionActionEffect; record: PlacementRecord }[];
  answer: OpenQuestionAnswer | null;
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

  /** The read model's input, its index and every open question, in list order. */
  async function built(
    tx: Tx,
    projectId: ProjectId,
  ): Promise<{ input: OpenQuestionInput; index: OpenQuestionIndex; items: OpenQuestion[] }> {
    const input = await loadOpenQuestionInput(tx, deps, projectId, candidates);
    return { input, ...buildOpenQuestions(input) };
  }

  /** Every open question of the project, in list order. */
  async function itemsOf(tx: Tx, projectId: ProjectId): Promise<OpenQuestion[]> {
    return (await built(tx, projectId)).items;
  }

  /** The current item with this id, or 404 (its id changes when what it asks about changes). */
  function currentItem(items: readonly OpenQuestion[], questionId: string): OpenQuestion {
    const question = items.find((q) => q.id === questionId);
    if (!question) {
      throw new DomainError(
        'not-found',
        'open question not found; its id changes when its source changes, so list the questions again',
      );
    }
    return question;
  }

  /** The live value chain's state, or 404 without one. */
  async function chainState(tx: Tx, projectId: ProjectId): Promise<ChainState> {
    return loadChainState(tx, await liveChain(tx, projectId, VALUE_CHAIN_KEY));
  }

  /**
   * `link` (§4.8 a): per pair of the plan ({@link linkSteps}), the live
   * typed relations at the anchor that answer the item and end at the
   * target (for a process picker, anywhere in it: the proposals the picker
   * named) are accepted as the human's decision, so judge-once stops
   * assigning their pairs; where an accepted relation already answers the
   * item nothing is written; else an accepted `manual` relation. The
   * rationale is German and from code.
   */
  async function link(
    tx: Tx,
    projectId: ProjectId,
    actor: Actor,
    ctx: { input: OpenQuestionInput; index: OpenQuestionIndex; question: OpenQuestion },
    body: Extract<OpenQuestionActionBody, { type: 'link' }>,
    note: string | null,
  ): Promise<ActionWrites> {
    const { input, index, question } = ctx;
    const action = question.actions.find((a) => a.type === 'link');
    if (!action) throw new Error('link checked as offered');
    const plan = linkPlan(index, question, action, body);
    if (!plan.ok) throw refuse(plan.reason, plan.message);
    const fps = headFingerprints(input.projectFacts);
    const rationale = actionRationale(question, note);
    const writes: ActionWrites = { relations: [], placements: [], answer: null };
    for (const step of linkSteps(index, question, action, plan.pairs)) {
      if (step.kind === 'linked') continue;
      if (step.kind === 'accept') {
        const histories = byRelation<StoredAssertion>(
          await tx.assertions.listForRelations(
            projectId,
            step.relations.map((r) => r.id),
          ),
        );
        for (const typed of step.relations) {
          const record = await recordDecision(
            tx,
            projectId,
            actor,
            typed,
            histories.get(typed.id) ?? [],
            fps,
            {
              verdict: 'accept',
              rationale,
              question: null,
              label: null,
              linkedRelationId: null,
              tier: null,
              confidence: null,
            },
          );
          writes.relations.push({ effect: 'decision', record });
        }
        continue;
      }
      const { relation, recorded } = await acceptManual(
        tx,
        projectId,
        actor,
        fps,
        { from: step.pair.from, to: step.pair.to, rationale, confidence: null },
        null,
      );
      if (recorded) writes.relations.push({ effect: 'manual', record: relation });
    }
    return writes;
  }

  /**
   * `place` (§4.8 a): a manual placement through `acceptManualPlacement`,
   * accepted at once: the item's process on the sent step (a process item),
   * or the sent process on the item's step (a step item).
   */
  async function place(
    tx: Tx,
    projectId: ProjectId,
    actor: Actor,
    question: OpenQuestion,
    body: Extract<OpenQuestionActionBody, { type: 'place' }>,
    note: string | null,
  ): Promise<ActionWrites & { state: ChainState }> {
    const offered = question.actions.filter((a) => a.type === 'place');
    let processRef: Ref;
    if (question.subject.type === 'step') {
      if (body.step !== question.subject.id) {
        throw refuse('wrong-step', `this item places a process on ${question.subject.id}`);
      }
      if (body.process === undefined) {
        throw refuse('process-required', 'name the process to place on the step');
      }
      processRef = body.process;
    } else {
      if (body.process !== undefined && body.process !== question.subject.id) {
        throw refuse('wrong-process', `this item places ${question.subject.id}`);
      }
      const anyStep = offered.some((a) => a.pick === 'step');
      const fixed = offered.some((a) => a.step === body.step);
      if (!anyStep && !fixed) {
        throw refuse('action-not-offered', `this item does not place on ${body.step}`);
      }
      processRef = question.subject.id as Ref;
    }
    const state = await chainState(tx, projectId);
    const target = liveStep(state, body.step);
    const placed = await placeManually(tx, projectId, actor, state, {
      ...target,
      processRef,
      rationale: actionRationale(question, note),
    });
    return { relations: [], placements: placed ? [placed] : [], answer: null, state };
  }

  /**
   * One manual placement through `acceptManualPlacement` (accepted at once),
   * `null` when it was there already. `acceptManualPlacement` decides a
   * placement that waits on the same step and process (an agent's proposal,
   * a hold) instead of writing a new one: that is a decision of an existing
   * proposal (effect `decision`, no „Rückgängig“, §4.8 a), not a manual
   * placement a rejection could take back.
   */
  async function placeManually(
    tx: Tx,
    projectId: ProjectId,
    actor: Actor,
    state: ChainState,
    item: { elementId: string; generation: number; processRef: Ref; rationale: string },
  ): Promise<{ effect: OpenQuestionActionEffect; record: PlacementRecord } | null> {
    const before = await tx.placements.findByNaturalKey(
      projectId,
      state.chain.id,
      item.elementId,
      item.generation,
      item.processRef,
    );
    const waiting = before?.status === 'proposed' || before?.status === 'held';
    const { placement, recorded } = await acceptManualPlacement(
      tx,
      projectId,
      actor,
      state.chain.id,
      state.endpoints,
      { ...item, confidence: null },
      null,
    );
    if (!recorded) return null;
    return { effect: waiting ? 'decision' : 'manual', record: placement };
  }

  /**
   * `choose-copy` (§4.8 a): the calls towards the copies (the action's
   * `decides`, all or nothing with their versions, as `decideRelations`)
   * are accepted towards the valid copy and rejected towards the others;
   * with `placeOthersOutside` the other copies without a home step go to
   * `@outside`, the reason naming the valid copy (decision 18); the note
   * is a note on the item, no mark.
   */
  async function chooseCopy(
    tx: Tx,
    projectId: ProjectId,
    actor: Actor,
    ctx: { input: OpenQuestionInput; index: OpenQuestionIndex; question: OpenQuestion },
    body: Extract<OpenQuestionActionBody, { type: 'choose-copy' }>,
    note: string | null,
  ): Promise<ActionWrites & { state: ChainState | null }> {
    const { input, index, question } = ctx;
    const action = question.actions.find((a) => a.type === 'choose-copy');
    if (!action) throw new Error('choose-copy checked as offered');
    const copies = action.choices ?? [];
    if (!copies.includes(body.process)) {
      throw refuse('not-a-copy', `${body.process} is not one of the copies`);
    }
    if (body.placeOthersOutside && input.chain === null) {
      throw refuse('no-value-chain', 'the project has no value chain to place the copies in');
    }
    // All or nothing: exactly the calls waiting for a decision, at the versions read.
    const expected = new Map((action.decides ?? []).map((d) => [d.id, d.version]));
    const mismatches: { id: string; reason: string; version?: number }[] = [];
    const seen = new Set<string>();
    for (const item of body.items) {
      const version = expected.get(item.id);
      if (seen.has(item.id)) mismatches.push({ id: item.id, reason: 'duplicate' });
      else if (version === undefined) mismatches.push({ id: item.id, reason: 'not-found' });
      else if (version !== item.version)
        mismatches.push({ id: item.id, reason: 'version', version });
      seen.add(item.id);
    }
    for (const [id, version] of expected) {
      if (!seen.has(id)) mismatches.push({ id, reason: 'missing', version });
    }
    if (mismatches.length > 0) {
      throw new DomainError(
        'conflict',
        'the calls towards the copies changed; reload and choose again',
        {
          mismatches,
        },
      );
    }
    const texts = copyTexts(
      `${index.elementInProcess(body.process)} in ${index.modelOf(body.process)}`,
    );
    const fps = headFingerprints(input.projectFacts);
    const writes: ActionWrites = { relations: [], placements: [], answer: null };
    const histories = byRelation<StoredAssertion>(
      await tx.assertions.listForRelations(projectId, [...expected.keys()] as RelationId[]),
    );
    for (const id of expected.keys()) {
      const relation = input.relations.find((r) => r.id === id);
      if (!relation) throw new Error(`call ${id} of a current open question vanished`);
      const accept = relation.toRef === body.process;
      const record = await recordDecision(
        tx,
        projectId,
        actor,
        relation,
        histories.get(relation.id) ?? [],
        fps,
        {
          verdict: accept ? 'accept' : 'reject',
          rationale: accept ? texts.accept : texts.reject,
          question: null,
          label: null,
          linkedRelationId: null,
          tier: null,
          confidence: null,
        },
      );
      writes.relations.push({ effect: 'decision', record });
    }
    let state: ChainState | null = null;
    if (body.placeOthersOutside && input.chain !== null) {
      state = await chainState(tx, projectId);
      const homes = processHomes(input.chain.placements, input.chain.live);
      const outside = liveStep(state, OUTSIDE_STEP);
      for (const copy of copies) {
        if (copy === body.process || homes.accepted.has(copy) || homes.held.has(copy)) continue;
        const placed = await placeManually(tx, projectId, actor, state, {
          ...outside,
          processRef: copy,
          rationale: texts.outside,
        });
        if (placed) writes.placements.push(placed);
      }
    }
    if (note !== null) {
      [writes.answer = null] = await recordAnswers(tx, projectId, actor, [
        { question, kind: 'answer', text: note },
      ]);
    }
    return { ...writes, state };
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
     * A note on one open question („Notiz hinzufügen“, M6 §4.8 b): recorded
     * as a note on its relation or placement, else with its text; when the
     * item's latest note is identical it is returned `unchanged` and nothing
     * is written. The text is normalized first (LF line breaks, NFC), as for
     * a sheet. A note leaves the item's state as it is. The personal-data
     * check warns and never blocks.
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
        const question = currentItem(await itemsOf(tx, project.id), questionId);
        const text = normalizeAnswerText(body.text);
        // NFC can lengthen a few scripts' letters, so the limit holds for the stored text.
        if (text.length > MAX_ANSWER_CHARS) {
          throw new DomainError(
            'validation-failed',
            `text: at most ${MAX_ANSWER_CHARS} characters after normalization`,
          );
        }
        const draft: AnswerDraft = { question, kind: 'answer', text };
        const warnings = personalDataWarnings(text);
        const same = sameAnswer(draft);
        if (same) return { result: 'unchanged', answer: same, question, warnings };
        const [answer] = await recordAnswers(tx, project.id, actor, [draft]);
        if (!answer) throw new Error('the note was not recorded');
        // A note changes neither the status nor the basis of its relation or placement,
        // so the item keeps its id, its state and everything but its answers.
        return {
          result: 'recorded',
          answer,
          question: { ...question, answers: [...question.answers, answer] },
          warnings,
        };
      });
    },

    /**
     * The answers of a filled-in sheet (M6 §4.5 "Bulk answers", §4.8 b), all
     * in one transaction: every filled `Antwort` a note as
     * {@link answerOpenQuestion} records it, S5a's „Liegt außerhalb der
     * Landschaft“ an outside mark where the item can carry one; empty
     * answers ignored (counted), unknown ids and invalid rows listed and
     * never stored, notes identical to the item's latest and marks on a
     * marked item `unchanged`. A dry run reads one snapshot and writes
     * nothing.
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

    /**
     * Runs one of the item's actions (M6 §4.8 a): `link`, `place`,
     * `choose-copy` or `outside`, in one transaction under the project
     * lock, the items computed after taking it. `outside` is `unchanged`
     * while a live outside mark exists for the item.
     *
     * @throws {DomainError} `not-found` for an id that names no current
     *   item; `validation-failed` with `reason` (`action-not-offered`, the
     *   link's and the placement's refusals); `conflict` when `choose-copy`'s
     *   calls changed; policy errors
     */
    async actOnOpenQuestion(
      actor: Actor,
      projectRef: string,
      questionId: string,
      body: OpenQuestionActionBody,
    ): Promise<OpenQuestionActionResult> {
      return deps.store.write(async (tx) => {
        const { project } = await requireAnswering(tx, actor, projectRef);
        if (sourceKindOf(actor) !== 'human') {
          throw new DomainError('human-decision-required', 'only a human acts on open questions', {
            reviewUrl: openQuestionsPath(project.key),
          });
        }
        await tx.projects.lockForWrite(project.id);
        const { input, index, items } = await built(tx, project.id);
        const question = currentItem(items, questionId);
        if (!question.actions.some((a) => a.type === body.type)) {
          throw refuse('action-not-offered', `this open question does not offer ${body.type}`);
        }
        const note = actionNote(body.note);
        const warnings: PersonalDataWarning[] = note === null ? [] : personalDataWarnings(note);
        let writes: ActionWrites;
        let state: ChainState | null = null;
        switch (body.type) {
          case 'outside': {
            const live = liveMark(question);
            if (live) {
              return {
                result: 'unchanged',
                question,
                relations: [],
                placements: [],
                answer: live,
                warnings,
              };
            }
            const [answer] = await recordAnswers(tx, project.id, actor, [
              { question, kind: 'outside-landscape', text: note },
            ]);
            if (!answer) throw new Error('the outside mark was not recorded');
            // A mark changes no fact, so the item keeps its id: now `answered`.
            const answers = [...question.answers, answer];
            return {
              result: 'applied',
              question: {
                ...question,
                answers,
                state: answers.some(isLiveMark) ? 'answered' : 'open',
              },
              relations: [],
              placements: [],
              answer,
              warnings,
            };
          }
          case 'link':
            writes = await link(tx, project.id, actor, { input, index, question }, body, note);
            break;
          case 'place': {
            const placed = await place(tx, project.id, actor, question, body, note);
            ({ state } = placed);
            writes = placed;
            break;
          }
          case 'choose-copy': {
            const chosen = await chooseCopy(
              tx,
              project.id,
              actor,
              { input, index, question },
              body,
              note,
            );
            ({ state } = chosen);
            writes = chosen;
            break;
          }
        }
        const applied =
          writes.relations.length > 0 || writes.placements.length > 0 || writes.answer !== null;
        const relationRecords = writes.relations.map((w) => w.record);
        const relations = await relationViews(
          tx,
          project.id,
          relationRecords,
          deps.expectedProcedure(),
        );
        const placementRecords = writes.placements.map((w) => w.record);
        const placements =
          state === null || placementRecords.length === 0
            ? []
            : await placementViews(
                (ids) => tx.placementAssertions.listForPlacements(project.id, ids),
                placementRecords,
                placementViewContext(state),
              );
        const after = applied
          ? ((await itemsOf(tx, project.id)).find((q) => q.id === question.id) ?? null)
          : question;
        return {
          result: applied ? 'applied' : 'unchanged',
          question: after,
          relations: writes.relations.map((w, i) => {
            const relation = relations[i];
            if (!relation) throw new Error('relation view missing');
            return { effect: w.effect, relation };
          }),
          placements: writes.placements.map((w, i) => {
            const placement = placements[i];
            if (!placement) throw new Error('placement view missing');
            return { effect: w.effect, placement };
          }),
          answer: writes.answer,
          warnings,
        };
      });
    },

    /**
     * Withdraws an outside mark („Rückgängig“, M6 §4.8 b): one row in
     * `open_question_answer_withdrawal` and an
     * `open_question.answer_withdrawn` event naming the question and the
     * answer (no text). A withdrawn mark no longer counts; one withdrawn
     * before is `unchanged`.
     *
     * @throws {DomainError} `not-found` for an id that names no current
     *   item or an answer of another item; `validation-failed` (`reason:
     *   'not-an-outside-mark'`) for a note; policy errors
     */
    async withdrawOpenQuestionAnswer(
      actor: Actor,
      projectRef: string,
      questionId: string,
      answerId: OpenQuestionAnswerId,
    ): Promise<WithdrawOpenQuestionAnswerResult> {
      return deps.store.write(async (tx) => {
        const { project } = await requireAnswering(tx, actor, projectRef);
        if (sourceKindOf(actor) !== 'human') {
          throw new DomainError(
            'human-decision-required',
            'only a human withdraws an outside mark',
            {
              reviewUrl: openQuestionsPath(project.key),
            },
          );
        }
        await tx.projects.lockForWrite(project.id);
        const question = currentItem(await itemsOf(tx, project.id), questionId);
        const answer = question.answers.find((a) => a.id === answerId);
        if (!answer) throw new DomainError('not-found', 'answer not found on this open question');
        if (answer.role !== 'outside-mark') {
          throw refuse('not-an-outside-mark', 'only an outside mark is withdrawn; a note stays');
        }
        if (answer.withdrawal !== null) return { result: 'unchanged', answer, question };
        const seq = await tx.events.append(project.id, {
          type: 'open_question.answer_withdrawn',
          principalId: actor.principalId,
          clientId: actor.clientId,
          subjectRef: question.subject.id,
          payload: { questionId: question.id, answerId: answer.id },
        });
        await tx.openQuestionAnswers.withdraw({
          answerId: answer.id,
          projectId: project.id,
          principalId: actor.principalId,
          sourceKind: 'human',
          seq,
        });
        const stored = (await tx.openQuestionAnswers.list(project.id)).find(
          (a) => a.id === answer.id,
        );
        if (!stored) throw new Error('an answer vanished inside its transaction');
        const withdrawn = toOpenQuestionAnswer(stored);
        const answers = question.answers.map((a) => (a.id === answer.id ? withdrawn : a));
        return {
          result: 'withdrawn',
          answer: withdrawn,
          question: {
            ...question,
            answers,
            state: answers.some(isLiveMark) ? 'answered' : 'open',
          },
        };
      });
    },
  };
}

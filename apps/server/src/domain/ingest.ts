/**
 * Ingest (CONCEPT §3, §4): every adapter (PUT, import, seed) yields files
 * `{path, bytes, source}` for `ingest(project, files, actor)`. Facts are
 * extracted before the transaction (CPU only); everything else is ONE
 * transaction: store revisions and facts → run the rule tier over the head
 * facts → record relation assertions → recompute endpoint state → move the
 * version of relations whose no-links may change currency → refresh the
 * value chain's placements and its rule proposals (M4) → queue analysis
 * tasks (relations, then the chain's placement task, M4b) → append events.
 *
 * Model amendments (M6 §4.8 c, S5c-2): a file whose bytes equal the head's,
 * its uploaded revision's or any amended revision's of the model is
 * `unchanged`; for a model with live amendments the uploaded revision is
 * stored and the amendments the plan marks `applied` are spliced into an
 * amended head on top of it, planned and extracted before the transaction
 * and again inside it when the amendment set changed meanwhile (the
 * concurrency token). The tail every head change runs is
 * {@link afterHeadChange}, which amendment writes and withdrawals call too.
 */
import { createHash } from 'node:crypto';

import {
  newId,
  type AmendmentCounts,
  type DeclaredProcedure,
  type ExtractWarning,
  type ModelId,
  type PrincipalId,
  type ProjectId,
  type RevisionSource,
  type RevisionUpstream,
} from '@analyzr/contracts';

import { sourceKindOf, type Actor } from './actor.ts';
import { deriveHead, planOf, type Derivation } from './amendments/derive.ts';
import {
  amendmentToken,
  liveAmendments,
  planCounts,
  type LiveAmendment,
} from './amendments/plan.ts';
import { DomainError } from './errors.ts';
import { touchNoLinkRelations } from './no-links.ts';
import { policy } from './policy.ts';
import type {
  AnalysisPort,
  ExtractOutcome,
  Extracted,
  ModelRecord,
  ModelTaskRecord,
  ProjectRecord,
  RevisionRecord,
  Store,
  Tx,
} from './ports.ts';
import { recomputeProject } from './recompute.ts';
import { queuePlacementTasks } from './value-chain/queue.ts';
import { syncValueChainAfterModels } from './value-chain/sync.ts';

export interface IngestFile {
  /** Model key, already validated. */
  key: string;
  bytes: Uint8Array;
  source: RevisionSource;
}

export type IngestResult =
  | {
      outcome: 'created' | 'revised' | 'unchanged';
      model: ModelRecord;
      /** The model's head afterwards: the amended revision when amendments apply. */
      revision: RevisionRecord;
      /** The uploaded revision, when {@link revision} is an amended revision computed from it. */
      uploadedRevision?: RevisionRecord;
      /**
       * The extractor's warnings for `created` and `revised`, uncut (empty
       * for `unchanged`: identical bytes are not extracted). Not stored.
       */
      warnings: ExtractWarning[];
      /** The model's live amendments on the head (M6 S5c-2); absent for a model without any. */
      amendments?: AmendmentCounts;
    }
  | { outcome: 'failed'; error: DomainError };

export interface IngestDeps {
  store: Store;
  analysis: AnalysisPort;
  /** Id of the system principal `analyzr-rules` (created on first use). */
  rulesPrincipal(): Promise<PrincipalId>;
  /** The procedure relations claims name (listing live no-links needs it). */
  expectedProcedure: () => DeclaredProcedure;
  /** The procedure placement claims name (input hashes of the chain's processes, M4b). */
  expectedPlacementProcedure: () => DeclaredProcedure;
}

/** sha256 (hex) of the raw bytes: identical uploads are no-ops. */
export function contentHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Problem for a rejected file: 413 for oversize input, 422 `bpmn-invalid` otherwise. */
export function extractError(code: string, message: string): DomainError {
  return code === 'too-large'
    ? new DomainError('payload-too-large', message)
    : new DomainError('bpmn-invalid', message, { reason: code });
}

/** Model name: the first process's participant (pool) name, else its name. */
function modelName(outcome: ExtractOutcome): string | null {
  if (!outcome.ok) return null;
  const first = outcome.value.processes[0];
  return first?.participantName ?? first?.name ?? null;
}

interface Prepared extends IngestFile {
  contentHash: string;
  extract(): Promise<ExtractOutcome>;
  /**
   * The head derived from these bytes with the model's live amendments,
   * memoized per concurrency token: a changed amendment set derives again.
   */
  derive(live: readonly LiveAmendment[], token: string, extracted: Extracted): Promise<Derivation>;
}

/** What the read before the transaction saw of a file's model. */
interface Seen {
  /** Content hashes an upload of the model leaves `unchanged`; `null` for a new or deleted model. */
  known: ReadonlySet<string> | null;
  live: LiveAmendment[];
  token: string;
}

/**
 * Ingests `files` into the project. Files are processed in order; a file
 * whose bytes equal its model's head is `unchanged` (no revision, no event);
 * a file the extractor rejects is `failed` and does not affect the others.
 * The rule tier runs once for all changes.
 *
 * @throws {DomainError} from the policy (`write` on the project)
 */
export async function ingest(
  deps: IngestDeps,
  actor: Actor,
  projectRef: string,
  files: readonly IngestFile[],
): Promise<{ project: ProjectRecord; results: IngestResult[] }> {
  const prepared: Prepared[] = files.map((f) => {
    let memo: Promise<ExtractOutcome> | undefined;
    let derived: { token: string; result: Promise<Derivation> } | undefined;
    return {
      ...f,
      contentHash: contentHash(f.bytes),
      extract: () => (memo ??= deps.analysis.extract(f.bytes, f.key)),
      derive: (live, token, extracted) => {
        if (derived?.token !== token) {
          derived = { token, result: deriveHead(deps.analysis, f.bytes, f.key, live, extracted) };
        }
        return derived.result;
      },
    };
  });

  // Outside the transaction: authorize, then extract every file that differs
  // from its head, and derive the amended head of a model with live
  // amendments (CPU-bound; keeps the write transaction short).
  const seen = await deps.store.read(async (tx) => {
    const { project } = await policy.require(tx, actor, 'write', projectRef);
    // Sequential: one transaction is one connection (no concurrent queries).
    const out: Seen[] = [];
    for (const f of prepared) out.push(await seenOf(tx, project.id, f.key));
    return out;
  });
  for (const [i, f] of prepared.entries()) {
    const s = seen[i];
    if (s?.known?.has(f.contentHash)) continue;
    const extracted = await f.extract();
    if (extracted.ok && s && s.live.length > 0) await f.derive(s.live, s.token, extracted.value);
  }

  const rulesPrincipalId = await deps.rulesPrincipal();
  return deps.store.write(async (tx) => {
    const { project } = await policy.require(tx, actor, 'write', projectRef);
    await tx.projects.lockForWrite(project.id);

    const results: IngestResult[] = [];
    const changed: HeadChange[] = [];
    for (const f of prepared) {
      const { result, previousFactsHash } = await storeFile(tx, deps, actor, project.id, f);
      results.push(result);
      if (result.outcome === 'created' || result.outcome === 'revised') {
        changed.push({ model: result.model, revision: result.revision, previousFactsHash });
      }
    }
    await afterHeadChange(tx, deps, actor, project.id, rulesPrincipalId, changed);
    return { project, results };
  });
}

/** A model whose head changed, with the `facts_hash` of its previous live head (`null`: new or revived). */
export interface HeadChange {
  model: ModelRecord;
  revision: RevisionRecord;
  previousFactsHash: string | null;
}

/**
 * The tail every head change runs, once for all changed models (ingest,
 * amendment writes and withdrawals, M6 §4.8 c "Concurrency"): the rule tier
 * over the head facts with endpoint states and findings, the version of
 * relations whose no-links may change currency, the value chain's
 * placements, the models' relations tasks, and the chain's placement task
 * when facts changed. The caller holds the project lock.
 */
export async function afterHeadChange(
  tx: Tx,
  deps: Pick<IngestDeps, 'analysis' | 'expectedProcedure' | 'expectedPlacementProcedure'>,
  actor: Actor,
  projectId: ProjectId,
  rulesPrincipalId: PrincipalId,
  changed: readonly HeadChange[],
): Promise<void> {
  if (changed.length === 0) return;
  await recomputeProject({ tx, projectId, rulesPrincipalId, analysis: deps.analysis });
  // A new facts_hash can flip the currency of the model's no-links (a revert too).
  await touchNoLinkRelations(
    tx,
    projectId,
    changed.filter((c) => c.previousFactsHash !== c.revision.factsHash).map((c) => c.model.key),
    deps.expectedProcedure(),
  );
  // Placements follow the head processes (endpoint state, rule proposals).
  await syncValueChainAfterModels(tx, projectId, rulesPrincipalId);
  for (const c of changed) {
    await queueAnalysis(tx, actor, projectId, c.model, c.revision, c.previousFactsHash);
  }
  // New, revived or changed processes may be due on the value chain (after the relation
  // tasks, so their events keep their order); a layout-only change queues nothing.
  if (changed.some((c) => c.previousFactsHash !== c.revision.factsHash)) {
    await queuePlacementTasks(
      tx,
      actor,
      projectId,
      'models changed',
      deps.expectedPlacementProcedure(),
    );
  }
}

/**
 * Content hashes an upload of a live model leaves `unchanged` (M6 §4.8 c):
 * the head's own, its uploaded revision's (`source.upstream`) and every
 * amended revision's of the model that holds analyzr's output (such as a
 * corrected BPMN downloaded before later amendments; not a re-derivation
 * that applied nothing, whose bytes are an earlier export the tool may bring
 * back). A model without amended revisions compares with its head alone, as
 * before.
 */
async function knownHashes(
  tx: Tx,
  projectId: ProjectId,
  model: ModelRecord,
  head: RevisionRecord,
): Promise<Set<string>> {
  const known = new Set([head.contentHash]);
  const upstream = head.source.upstream;
  if (upstream) known.add(upstream.contentHash);
  for (const hash of await tx.revisions.amendedContentHashes(projectId, model.id)) known.add(hash);
  return known;
}

/** The known hashes and the live amendment set of a key's model, as the read before the write sees them. */
async function seenOf(tx: Tx, projectId: ProjectId, key: string): Promise<Seen> {
  const model = await tx.models.findByKey(projectId, key);
  if (!model) return { known: null, live: [], token: '' };
  const stored = await tx.amendments.list(projectId, { modelId: model.id });
  const head =
    model.deletedSeq === null && model.headRevisionId
      ? await tx.revisions.findInProject(projectId, model.id, model.headRevisionId)
      : null;
  return {
    known: head ? await knownHashes(tx, projectId, model, head) : null,
    live: liveAmendments(stored),
    token: amendmentToken(stored),
  };
}

/** One revision to store as a model's head. */
export interface NewHead {
  modelId: ModelId;
  modelKey: string;
  rev: number;
  /** The `outcome` of its `model.revised` event. */
  outcome: 'created' | 'revised' | 'amended';
  bytes: Uint8Array;
  contentHash: string;
  extracted: Extracted;
  source: RevisionSource;
  name: string | null;
}

/**
 * Stores a revision with its facts and its own `model.revised` event and
 * makes it the model's head (a head is always the model's revision with the
 * highest seq). Clears `deleted_seq`: never call it for a deleted model
 * except to revive it by upload.
 */
export async function storeHead(
  tx: Tx,
  analysis: Pick<AnalysisPort, 'factsHash'>,
  actor: Actor,
  projectId: ProjectId,
  head: NewHead,
): Promise<RevisionRecord> {
  const { facts, processes, messageFlows, factsVersion, engine } = head.extracted;
  const revisionId = newId('revision');
  const factsHash = analysis.factsHash(facts);
  const seq = await tx.events.append(projectId, {
    type: 'model.revised',
    principalId: actor.principalId,
    clientId: actor.clientId,
    subjectRef: head.modelKey,
    payload: {
      outcome: head.outcome,
      modelId: head.modelId,
      modelKey: head.modelKey,
      revisionId,
      rev: head.rev,
      contentHash: head.contentHash,
      factsHash,
      source: head.source,
    },
  });
  await tx.revisions.insert({
    id: revisionId,
    projectId,
    modelId: head.modelId,
    rev: head.rev,
    xml: head.bytes,
    contentHash: head.contentHash,
    factsHash,
    factsVersion,
    engine,
    processes,
    messageFlows,
    source: head.source,
    principalId: actor.principalId,
    seq,
  });
  await tx.facts.insertMany(projectId, revisionId, facts);
  await tx.models.update(projectId, head.modelId, {
    name: head.name,
    headRevisionId: revisionId,
    deletedSeq: null,
  });
  const revision = await tx.revisions.findInProject(projectId, head.modelId, revisionId);
  if (!revision) throw new Error(`revision of ${head.modelKey} vanished inside its transaction`);
  return revision;
}

/** The `source` of an amended revision (M6 §4.8 c "Revisions"): no manifest fields of its own. */
export function amendedSource(
  actor: Actor,
  upstream: RevisionUpstream,
  derivation: Pick<Derivation, 'plan'>,
): RevisionSource {
  return {
    kind: 'amendment',
    uploader: sourceKindOf(actor),
    upstream,
    amendments: derivation.plan,
  };
}

/**
 * Stores one file as the model's new head unless its bytes are known (the
 * head's, its uploaded revision's or an amended revision's). For a model
 * with live amendments the file is the uploaded revision, and the
 * amendments the plan marks `applied` make an amended head on top of it;
 * when none applies, the uploaded revision is the head and carries the plan.
 *
 * @returns the outcome and the `facts_hash` of the previous live head (`null`
 *   for a new or revived model)
 */
async function storeFile(
  tx: Tx,
  deps: IngestDeps,
  actor: Actor,
  projectId: ProjectId,
  f: Prepared,
): Promise<{ result: IngestResult; previousFactsHash: string | null }> {
  const existing = await tx.models.findByKey(projectId, f.key);
  const live = existing !== null && existing.deletedSeq === null;
  const previous =
    live && existing.headRevisionId
      ? await tx.revisions.findInProject(projectId, existing.id, existing.headRevisionId)
      : null;
  const previousFactsHash = previous?.factsHash ?? null;
  const stored = existing ? await tx.amendments.list(projectId, { modelId: existing.id }) : [];
  const amendments = liveAmendments(stored);
  if (
    live &&
    previous &&
    (await knownHashes(tx, projectId, existing, previous)).has(f.contentHash)
  ) {
    return {
      result: {
        outcome: 'unchanged',
        model: existing,
        revision: previous,
        warnings: [],
        ...(amendments.length > 0 ? { amendments: planCounts(planOf(previous)) } : {}),
      },
      previousFactsHash,
    };
  }

  const extracted = await f.extract();
  if (!extracted.ok) {
    return {
      result: {
        outcome: 'failed',
        error: extractError(extracted.error.code, extracted.error.message),
      },
      previousFactsHash,
    };
  }
  const outcome = live ? 'revised' : 'created';
  const name = modelName(extracted);
  // Planned outside the transaction; planned again here if the set changed meanwhile.
  const derivation =
    amendments.length > 0
      ? await f.derive(amendments, amendmentToken(stored), extracted.value)
      : null;

  const modelId: ModelId = existing?.id ?? newId('model');
  if (!existing) await tx.models.insert({ id: modelId, projectId, key: f.key, name });
  const rev = existing ? (await tx.revisions.maxRev(projectId, modelId)) + 1 : 1;
  const amended = derivation !== null && derivation.applied > 0;
  const uploaded = await storeHead(tx, deps.analysis, actor, projectId, {
    modelId,
    modelKey: f.key,
    rev,
    outcome,
    bytes: f.bytes,
    contentHash: f.contentHash,
    extracted: extracted.value,
    // Without an amended head, the uploaded head carries the plan.
    source: derivation && !amended ? { ...f.source, amendments: derivation.plan } : f.source,
    name,
  });
  const revision =
    derivation && amended
      ? await storeHead(tx, deps.analysis, actor, projectId, {
          modelId,
          modelKey: f.key,
          rev: rev + 1,
          outcome: 'amended',
          bytes: derivation.xml,
          contentHash: contentHash(derivation.xml),
          extracted: derivation.extracted,
          source: amendedSource(
            actor,
            { revisionId: uploaded.id, rev: uploaded.rev, contentHash: uploaded.contentHash },
            derivation,
          ),
          name,
        })
      : uploaded;

  const model = await tx.models.findByKey(projectId, f.key);
  if (!model) throw new Error(`ingest: ${f.key} vanished inside its transaction`);
  return {
    result: {
      outcome,
      model,
      revision,
      ...(revision.id === uploaded.id ? {} : { uploadedRevision: uploaded }),
      warnings: extracted.value.warnings,
      ...(derivation ? { amendments: planCounts(derivation.plan) } : {}),
    },
    previousFactsHash,
  };
}

/**
 * Queues a `relations` task for a new head (CONCEPT §3, judge each pair
 * once): always for a new or revived model (`previousFactsHash` null), and
 * when the head's `facts_hash` differs from the previous head's, so a
 * revert is judged again although an earlier task analysed the same facts;
 * judge-once keeps that cheap. A layout-only change queues nothing, unless
 * no task is open and none analysed these facts (a failed task). An open
 * task for different facts is cancelled first; one for the same facts
 * stays.
 */
export async function queueAnalysis(
  tx: Tx,
  actor: Actor,
  projectId: ProjectId,
  model: ModelRecord,
  revision: RevisionRecord,
  previousFactsHash: string | null,
): Promise<ModelTaskRecord | null> {
  const open = await tx.tasks.latest(projectId, model.id, ['queued', 'claimed']);
  if (open?.factsHash === revision.factsHash) return null;
  if (open) await cancelTask(tx, actor, projectId, model, open, 'new head with different facts');
  if (!open && previousFactsHash === revision.factsHash) {
    const done = await tx.tasks.latest(projectId, model.id, ['done']);
    if (done?.factsHash === revision.factsHash) return null;
  }
  return queueTask(tx, actor, projectId, model, revision, 'new head');
}

/**
 * After pipeline judgements were withdrawn outside an analysis (a revoked
 * token, `withdraw_proposal`), the live models among `modelKeys` judge
 * their pairs again: a model without an open task gets a queued one, a
 * claimed task gets `requeue_after` (its submit queues a follow-up, since
 * its claim may have skipped the lost pairs); a queued task's claim sees the
 * loss anyway.
 */
export async function requeueAfterLoss(
  tx: Tx,
  actor: Actor,
  projectId: ProjectId,
  modelKeys: Iterable<string>,
): Promise<void> {
  for (const key of [...new Set(modelKeys)].sort()) {
    const model = await tx.models.findByKey(projectId, key);
    if (!model?.headRevisionId || model.deletedSeq !== null) continue;
    const open = await tx.tasks.latest(projectId, model.id, ['queued', 'claimed']);
    if (open?.state === 'claimed') await tx.tasks.setRequeueAfter(projectId, open.id);
    if (open) continue;
    const head = await tx.revisions.findInProject(projectId, model.id, model.headRevisionId);
    if (head) await queueTask(tx, actor, projectId, model, head, 'judgement withdrawn');
  }
}

/** Inserts a queued `relations` task for `revision` and records `analysis.queued`. */
export async function queueTask(
  tx: Tx,
  actor: Actor,
  projectId: ProjectId,
  model: Pick<ModelRecord, 'id' | 'key'>,
  revision: Pick<RevisionRecord, 'id' | 'factsHash'>,
  reason: 'new head' | 'requeue' | 'judgement withdrawn',
): Promise<ModelTaskRecord> {
  const id = newId('analysisTask');
  const seq = await tx.events.append(projectId, {
    type: 'analysis.queued',
    principalId: actor.principalId,
    clientId: actor.clientId,
    subjectRef: model.key,
    payload: {
      taskId: id,
      kind: 'relations',
      modelId: model.id,
      modelKey: model.key,
      revisionId: revision.id,
      factsHash: revision.factsHash,
      reason,
    },
  });
  const task: ModelTaskRecord = {
    id,
    projectId,
    subjectKind: 'model',
    modelId: model.id,
    revisionId: revision.id,
    kind: 'relations',
    factsHash: revision.factsHash,
    state: 'queued',
    seq,
  };
  await tx.tasks.insert(task);
  return task;
}

/** Cancels an open task and records `analysis.cancelled`. */
export async function cancelTask(
  tx: Tx,
  actor: Actor,
  projectId: ProjectId,
  model: ModelRecord,
  task: ModelTaskRecord,
  reason: string,
): Promise<void> {
  await tx.tasks.setState(projectId, task.id, 'cancelled', reason);
  await tx.events.append(projectId, {
    type: 'analysis.cancelled',
    principalId: actor.principalId,
    clientId: actor.clientId,
    subjectRef: model.key,
    payload: { taskId: task.id, kind: task.kind, modelId: model.id, modelKey: model.key, reason },
  });
}

/**
 * Deletes a model (CONCEPT §3): marks it deleted, cancels its open task,
 * and recomputes rules and endpoint states, so partner relations turn
 * `missing`; the relations on the pairs of its live no-links move their
 * version. On the value chain, placements of its processes turn `missing`
 * and the rule tier's proposals of them are withdrawn (M4). Revisions and
 * facts stay (append-only history); uploading the key again revives the
 * model with a new revision.
 *
 * @throws {DomainError} `not-found` for unknown, deleted or foreign models
 */
export async function deleteModel(
  deps: IngestDeps,
  actor: Actor,
  projectRef: string,
  modelId: ModelId,
): Promise<void> {
  const rulesPrincipalId = await deps.rulesPrincipal();
  await deps.store.write(async (tx) => {
    const { project } = await policy.require(tx, actor, 'write', projectRef);
    await tx.projects.lockForWrite(project.id);
    const model = await tx.models.findInProject(project.id, modelId);
    if (!model) throw new DomainError('not-found', 'model not found');

    const seq = await tx.events.append(project.id, {
      type: 'model.deleted',
      principalId: actor.principalId,
      clientId: actor.clientId,
      subjectRef: model.key,
      payload: { modelId: model.id, modelKey: model.key },
    });
    await tx.models.update(project.id, model.id, { deletedSeq: seq });
    const open = await tx.tasks.latest(project.id, model.id, ['queued', 'claimed']);
    if (open) await cancelTask(tx, actor, project.id, model, open, 'model deleted');
    await recomputeProject({
      tx,
      projectId: project.id,
      rulesPrincipalId,
      analysis: deps.analysis,
    });
    // Its no-links are no longer current (the relations also turn `missing`).
    await touchNoLinkRelations(tx, project.id, [model.key], deps.expectedProcedure());
    await syncValueChainAfterModels(tx, project.id, rulesPrincipalId);
  });
}

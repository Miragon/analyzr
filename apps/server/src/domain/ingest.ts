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
 *
 * The trust rule (M6 S2c, decision 24.2): every uploaded revision gets its
 * trust class (`trust.ts` `trustOf`) as `source.trust`, written last by the
 * server; an amended revision gets none (readers follow `upstream`), and
 * unchanged bytes keep the class they have. Right after the recompute, the
 * owner's enabled rules for derived calls may accept the rule tier's
 * proposals of unique calls from derived models it recorded (M6 S2c-3, the
 * fifth auto-accept write path, `auto-accept/apply.ts`
 * `autoAcceptDerivedCalls`), caused by the request's actor.
 *
 * The identity rows (M6 S2b follow-up step 5, owner decision 29 (1)): a
 * file the manifest lists records where its model lives in the source tool
 * (`model_identity`, {@link recordIdentity}): with every uploaded revision it
 * stores, and for unchanged bytes when the declaration differs from the
 * model's newest row, with an event of its own; nothing else changes for
 * them (no revision, no facts, no recompute, no task).
 */
import { createHash } from 'node:crypto';

import {
  newId,
  type AmendmentCounts,
  type Candidate,
  type DeclaredProcedure,
  type ExtractWarning,
  type ImportImpact,
  type ModelId,
  type PrincipalId,
  type ProjectFacts,
  type ProjectId,
  type RevisionSource,
  type RevisionTrust,
  type RevisionUpstream,
} from '@analyzr/contracts';

import { sourceKindOf, type Actor } from './actor.ts';
import { deriveHead, planOf, type Derivation } from './amendments/derive.ts';
import { autoAcceptDerivedCalls, enabledDerivedCallRules } from './auto-accept/apply.ts';
import {
  amendmentToken,
  liveAmendments,
  planCounts,
  type LiveAmendment,
} from './amendments/plan.ts';
import { DomainError } from './errors.ts';
import {
  absentKeys,
  importImpact,
  type ChainInput,
  type DerivedCallRules,
  type FileHeads,
  type TaskInput,
} from './import-impact.ts';
import { linkJudgements, noLinkJudgement } from './judgements.ts';
import { touchNoLinkRelations } from './no-links.ts';
import { evaluate, policy, roleIn } from './policy.ts';
import { declaredIdentity, identityUpdate, isDeclared } from './provenance.ts';
import { needsDoneTask, planQueue } from './queue-plan.ts';
import { byRelation, naturalKey } from './relation-state.ts';
import type {
  AnalysisPort,
  ExtractFailure,
  ExtractOutcome,
  Extracted,
  ModelRecord,
  ModelTaskDetail,
  ModelTaskRecord,
  ProjectRecord,
  RevisionRecord,
  Store,
  StoredAssertion,
  StoredNoLink,
  Tx,
} from './ports.ts';
import { recomputeProject } from './recompute.ts';
import { callTargets, storedTrust, trustByModel, trustOf, type ModelTrust } from './trust.ts';
import { headRevision, revisionStructure } from './value-chain/chain-state.ts';
import type { ChainRead } from './value-chain/model-impact.ts';
import { byPlacement } from './value-chain/placement-state.ts';
import { queuePlacementTasks } from './value-chain/queue.ts';
import { liveGenerations } from './value-chain/steps.ts';
import { syncValueChainAfterModels } from './value-chain/sync.ts';
import { storedWarnings } from './warnings.ts';

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
       * for `unchanged`: identical bytes are not extracted). Each revision
       * stores them cut (M6 S2a, `storedWarnings`).
       */
      warnings: ExtractWarning[];
      /** The model's live amendments on the head (M6 S5c-2); absent for a model without any. */
      amendments?: AmendmentCounts;
      /** The trust of the model's uploaded revision afterwards, and what this request would give it. */
      trust: FileTrust;
      /**
       * Only for `unchanged`: the file's manifest entry recorded a new
       * identity of the model (M6 S2b follow-up step 5, {@link recordIdentity}).
       */
      identityUpdated?: true;
    }
  | { outcome: 'failed'; error: DomainError };

/**
 * The trust class of a file's model after an ingest or its dry run (M6
 * S2c): the class of its uploaded revision (stored, or kept for unchanged
 * bytes; `null` stored before S2c) and the class this request gives the file.
 */
export interface FileTrust {
  stored: RevisionTrust | null;
  incoming: RevisionTrust;
}

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

/** sha256 (hex) of the raw bytes: identical uploads store no revision. */
export function contentHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Problem for a rejected file: 413 for oversize input, 422 `bpmn-invalid`
 * otherwise, with the rejection's code as `reason` and, where the cause is
 * the encoding, `encoding` (`utf-16`, `not-utf-8`; UX-SIMPLIFICATION.md §3.9
 * item 5: the web names the remedy).
 */
export function extractError(failure: ExtractFailure): DomainError {
  const { code, message, encoding } = failure;
  return code === 'too-large'
    ? new DomainError('payload-too-large', message)
    : new DomainError('bpmn-invalid', message, {
        reason: code,
        ...(encoding === undefined ? {} : { encoding }),
      });
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
 * whose bytes equal its model's head is `unchanged` (no revision; an event
 * only for a new declared identity, {@link recordIdentity}); a file the
 * extractor rejects is `failed` and does not affect the others. The rule
 * tier runs once for all changes.
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
 * over the head facts with endpoint states and findings, the owner's rules
 * for derived calls over the proposals of unique calls from derived models
 * it recorded (M6 S2c-3, caused by `actor`), the version of relations whose
 * no-links may change currency, the value chain's placements, the models'
 * relations tasks, and the chain's placement task when facts changed. The
 * caller holds the project lock.
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
  const { derivedProposals } = await recomputeProject({
    tx,
    projectId,
    rulesPrincipalId,
    analysis: deps.analysis,
  });
  await autoAcceptDerivedCalls(tx, actor, projectId, derivedProposals, deps.expectedProcedure());
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

/**
 * The class an unchanged upload keeps (M6 S2c): the uploaded revision's
 * `source.trust`; for one stored before S2c the owner's review of it (M6
 * S2c-4), else `null` (one more query, only then).
 */
async function keptTrust(
  tx: Tx,
  projectId: ProjectId,
  uploaded: RevisionRecord,
): Promise<RevisionTrust | null> {
  if (uploaded.source.trust) return uploaded.source.trust;
  const [state] = await tx.revisions.trustStates(projectId, [uploaded.id]);
  return state ? storedTrust(state) : null;
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
    extractWarnings: storedWarnings(head.extracted.warnings),
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
 * Records the identity a file the manifest lists declares (M6 S2b follow-up
 * step 5, decision 29 (1)): with a new uploaded revision always, at its
 * `model.revised` seq; for unchanged bytes only when it differs from the
 * model's newest row, with a `model.identity_declared` event of its own
 * (model, key, revision, system, tool id and manifest checksum; the folder
 * and the link stay in the row). A file the manifest does not list declares
 * nothing and leaves the identity as it is.
 *
 * @returns true when it recorded the identity of unchanged bytes
 */
async function recordIdentity(
  tx: Tx,
  actor: Actor,
  projectId: ProjectId,
  file: Pick<IngestFile, 'key' | 'source'>,
  modelId: ModelId,
  revision: Pick<RevisionRecord, 'id' | 'seq'>,
  kind: 'revision' | 'unchanged',
): Promise<boolean> {
  if (!isDeclared(file.source)) return false;
  const declared =
    kind === 'revision'
      ? declaredIdentity(file.source)
      : identityUpdate(
          (await tx.identities.newest(projectId, [modelId])).get(modelId),
          file.source,
        );
  if (declared === null) return false;
  const seq =
    kind === 'revision'
      ? revision.seq
      : await tx.events.append(projectId, {
          type: 'model.identity_declared',
          principalId: actor.principalId,
          clientId: actor.clientId,
          subjectRef: file.key,
          payload: {
            modelId,
            modelKey: file.key,
            revisionId: revision.id,
            system: declared.system,
            externalId: declared.externalId,
            manifestSha256: file.source.manifestSha256 ?? null,
          },
        });
  await tx.identities.insert({
    projectId,
    modelId,
    seq,
    revisionId: revision.id,
    kind,
    ...declared,
    principalId: actor.principalId,
    clientId: actor.clientId,
  });
  return kind === 'unchanged';
}

/**
 * Stores one file as the model's new head unless its bytes are known (the
 * head's, its uploaded revision's or an amended revision's). For a model
 * with live amendments the file is the uploaded revision, and the
 * amendments the plan marks `applied` make an amended head on top of it;
 * when none applies, the uploaded revision is the head and carries the plan.
 * A file the manifest lists records its identity ({@link recordIdentity}).
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
    // Unchanged bytes keep their uploaded revision's class (identical bytes, identical engine).
    const upstream = previous.source.upstream;
    const uploaded = upstream
      ? await tx.revisions.findInProject(projectId, existing.id, upstream.revisionId)
      : previous;
    if (!uploaded) throw new Error(`uploaded revision of ${f.key} missing`);
    // Their identity goes by the manifest (M6 S2b follow-up step 5); everything else stays.
    const identityUpdated = await recordIdentity(
      tx,
      actor,
      projectId,
      f,
      existing.id,
      uploaded,
      'unchanged',
    );
    return {
      result: {
        outcome: 'unchanged',
        model: existing,
        revision: previous,
        warnings: [],
        ...(amendments.length > 0 ? { amendments: planCounts(planOf(previous)) } : {}),
        trust: {
          stored: await keptTrust(tx, projectId, uploaded),
          incoming: trustOf(uploaded.engine, f.source),
        },
        ...(identityUpdated ? { identityUpdated: true as const } : {}),
      },
      previousFactsHash,
    };
  }

  const extracted = await f.extract();
  if (!extracted.ok) {
    return {
      result: {
        outcome: 'failed',
        error: extractError(extracted.error),
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
  // Set last by the server, so no declared value reaches it (decision 24.2).
  const trust = trustOf(extracted.value.engine, f.source);
  const uploaded = await storeHead(tx, deps.analysis, actor, projectId, {
    modelId,
    modelKey: f.key,
    rev,
    outcome,
    bytes: f.bytes,
    contentHash: f.contentHash,
    extracted: extracted.value,
    // Without an amended head, the uploaded head carries the plan.
    source: {
      ...(derivation && !amended ? { ...f.source, amendments: derivation.plan } : f.source),
      trust,
    },
    name,
  });
  // The uploaded revision's identity row, before an amended head (which declares none).
  await recordIdentity(tx, actor, projectId, f, modelId, uploaded, 'revision');
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
      trust: { stored: trust, incoming: trust },
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
 * stays. Reads, then the pure `planQueue` the dry runs share, then writes.
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
  const heads = { previousFactsHash, factsHash: revision.factsHash, open };
  const done = needsDoneTask(heads) ? await tx.tasks.latest(projectId, model.id, ['done']) : null;
  const plan = planQueue({ ...heads, doneFactsHash: done?.factsHash ?? null });
  if (plan.cancel) {
    await cancelTask(tx, actor, projectId, model, plan.cancel, 'new head with different facts');
  }
  return plan.queue ? queueTask(tx, actor, projectId, model, revision, 'new head') : null;
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
 * `missing` (a call the deletion makes unique may meet an owner's rule for
 * derived calls, M6 S2c-3); the relations on the pairs of its live no-links move their
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
    const { derivedProposals } = await recomputeProject({
      tx,
      projectId: project.id,
      rulesPrincipalId,
      analysis: deps.analysis,
    });
    // A call the deletion makes unique (a duplicate id gone) may meet an owner's rule (M6 S2c-3).
    await autoAcceptDerivedCalls(tx, actor, project.id, derivedProposals, deps.expectedProcedure());
    // Its no-links are no longer current (the relations also turn `missing`).
    await touchNoLinkRelations(tx, project.id, [model.key], deps.expectedProcedure());
    await syncValueChainAfterModels(tx, project.id, rulesPrincipalId);
  });
}

// ------------------------------------------------------------- dry runs (M6 S2b)

/** Code-point order, as `headProjectFacts` sorts the models. */
const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A file of a dry run, as {@link ingest} would answer it, without the records it would store. */
export type PreviewResult =
  | {
      outcome: 'created' | 'revised' | 'unchanged';
      warnings: ExtractWarning[];
      amendments?: AmendmentCounts;
      trust: FileTrust;
      /** Only for `unchanged`: the ingest would record the file's declared identity (M6 S2b follow-up step 5). */
      identityUpdated?: true;
    }
  | { outcome: 'failed'; error: DomainError };

/**
 * The rules principal as the histories name it: a dry run never creates it
 * (`IngestDeps.rulesPrincipal` may). Without a rule assertion yet no stance
 * of it exists, and any id plans the same.
 */
export function rulesPrincipalOf(
  history: readonly { sourceKind: string; principalId: PrincipalId }[],
): PrincipalId {
  return history.find((a) => a.sourceKind === 'rule')?.principalId ?? 'prn_rules';
}

/**
 * What an owner's dry run needs of their rules for derived calls (M6
 * S2c-3): only for an actor who passes `admin` (an owner on an interactive
 * client), so an agent or read-only token, an editor or a viewer never gets
 * rule data (`null`); an owner without such an enabled rule gets no rules.
 */
export async function derivedCallRulesFor(
  tx: Tx,
  actor: Actor,
  project: ProjectRecord,
): Promise<DerivedCallRules | null> {
  if (evaluate(actor, 'admin', await roleIn(tx, actor, project)) !== null) return null;
  const rules = await enabledDerivedCallRules(tx, project.id);
  if (rules.length === 0) return { rules, liveNoLinks: new Map() };
  const liveNoLinks = new Map<string, number>();
  for (const n of await tx.noLinks.listHistory(project.id)) {
    if (n.withdrawnSeq !== null) continue;
    const key = naturalKey(n.type, n.fromRef, n.toRef);
    liveNoLinks.set(key, (liveNoLinks.get(key) ?? 0) + 1);
  }
  return { rules, liveNoLinks };
}

/** What a dry run reads in one transaction: the head, its trust, relations, histories and findings. */
async function readHead(tx: Tx, projectId: ProjectId) {
  const history = await tx.assertions.listForProject(projectId);
  return {
    projectFacts: await tx.facts.headProjectFacts(projectId),
    trust: trustByModel(await tx.revisions.headTrustRows(projectId)),
    relations: await tx.relations.all(projectId),
    history,
    findings: await tx.findings.list(projectId),
    rulesPrincipalId: rulesPrincipalOf(history),
  };
}

/** Upper bound of a listing that must return every row (as the claim's own read of open tasks). */
const ALL_TASKS = 100_000;

/** What the relations tasks of a dry run read ({@link readTasks}). */
interface TaskReads {
  /** The head `facts_hash` of every live model. */
  heads: Map<string, string>;
  /** The live no-links touching the models (current or stale: a revert makes one current again). */
  noLinks: StoredNoLink[];
  /** The open (queued or claimed) relations task of each of the models, by key. */
  open: Map<string, ModelTaskDetail>;
}

/**
 * What the relations tasks of a dry run read (S2b follow-up) for the models
 * it may change (`keys`), in its snapshot: the head hashes, the live
 * no-links touching those models and their open relations tasks (at most
 * one per model). Only pairs touching a changed model change their
 * judgement or are judged by a queued task, so without such a model (an
 * unchanged re-import) nothing is read (`null`).
 */
async function readTasks(
  tx: Tx,
  projectId: ProjectId,
  keys: readonly string[],
  procedure: DeclaredProcedure,
): Promise<TaskReads | null> {
  const wanted = new Set(keys);
  if (wanted.size === 0) return null;
  const open = new Map<string, ModelTaskDetail>();
  for (const state of ['queued', 'claimed'] as const) {
    for (const t of await tx.tasks.list(
      projectId,
      { state, kind: 'relations' },
      { limit: ALL_TASKS },
    )) {
      if (t.subjectKind === 'model' && wanted.has(t.modelKey)) open.set(t.modelKey, t);
    }
  }
  return {
    heads: await tx.revisions.headHashes(projectId),
    noLinks: await tx.noLinks.listLive(projectId, { touchingModelKeys: [...wanted] }, procedure),
    open,
  };
}

/**
 * What a dry run reads of the project's live value chain (S2b follow-up),
 * in its snapshot: the head's structure (cached per content hash), the live
 * step generations, the placements with their histories (and the rule
 * principal they name), the agent's last verdicts, the open placement task
 * and, while an agent holds it, the input hashes its claim showed. The
 * process facts come from the head facts the dry run already read. Without
 * a live chain (M4: only `main`) one query and `null`: the impact has no
 * chain fields.
 */
async function readChain(
  tx: Tx,
  projectId: ProjectId,
  procedure: DeclaredProcedure,
): Promise<ChainRead | null> {
  const chain = (await tx.valueChains.list(projectId)).find(
    (c) => c.deletedSeq === null && c.headRevisionId !== null,
  );
  if (!chain) return null;
  const structure = await revisionStructure(tx, await headRevision(tx, chain));
  const assertions = await tx.placementAssertions.listForChain(projectId, chain.id);
  const openTask = await tx.tasks.latestForChain(projectId, chain.id, ['queued', 'claimed']);
  const held =
    openTask?.state === 'claimed' ? await tx.tasks.findInProject(projectId, openTask.id) : null;
  const claim = held?.kind === 'placement' ? held.placementClaim : null;
  return {
    valueChainId: chain.id,
    structure,
    live: liveGenerations(await tx.valueChainSteps.list(projectId, chain.id)),
    placements: await tx.placements.forChain(projectId, chain.id),
    histories: byPlacement(assertions),
    rows: new Map(
      (await tx.placementInputs.forChain(projectId, chain.id)).map((r) => [r.processRef, r]),
    ),
    openTask,
    claimed: new Map((claim?.processes ?? []).map((p) => [p.process, p])),
    procedure,
    rulesPrincipalId: rulesPrincipalOf(assertions),
  };
}

/**
 * What the relations tasks of a dry run read (S2b follow-up): every live
 * agent judgement with its basis (the pipeline proposals of the relations
 * that are not obsolete, as a claim reads them, and the live no-links of
 * the models it may change), the head hashes, the open tasks, and the
 * candidates over the would-be head (the landscape indexed once, when a
 * task is queued).
 */
function taskInput(
  deps: Pick<IngestDeps, 'analysis' | 'expectedProcedure'>,
  head: Awaited<ReturnType<typeof readHead>>,
  tasks: TaskReads | null,
  projectFacts: ProjectFacts,
  done: ReadonlyMap<string, string>,
  deleted?: string,
): TaskInput {
  const procedure = deps.expectedProcedure();
  let around: ((modelKey: string) => Candidate[]) | undefined;
  return {
    judgements: tasks
      ? [
          ...linkJudgements(
            head.relations.filter((r) => r.status !== 'obsolete'),
            byRelation<StoredAssertion>(head.history),
            new Map(),
            tasks.heads,
            procedure,
          ),
          ...tasks.noLinks.map(noLinkJudgement),
        ]
      : [],
    before: tasks?.heads ?? new Map(),
    procedure,
    open: tasks?.open ?? new Map(),
    doneFactsHash: (key) => done.get(key) ?? null,
    candidatesOf: (key) => (around ??= deps.analysis.candidateSource(projectFacts))(key),
    ...(deleted === undefined ? {} : { deleted }),
  };
}

/** The value chain's part of a dry run's input, without a live chain none. */
function chainInput(
  chain: ChainRead | null,
  headFacts: ProjectFacts,
  effect: Pick<ChainInput, 'headChange' | 'triggered'>,
): ChainInput | undefined {
  return chain ? { ...chain, headFacts, ...effect } : undefined;
}

/** The trust a dry run gives a created or revised file's model (M6 S2c), as the ingest stores it. */
function incomingTrust(
  trust: RevisionTrust,
  source: RevisionSource,
  extracted: Pick<Extracted, 'engine'>,
  plan: Derivation['plan'] | undefined,
): ModelTrust {
  return {
    trust,
    ...callTargets(plan ?? []),
    derivedKind: source.derived?.kind ?? null,
    converter: source.derived?.converter ?? null,
    engine: extracted.engine,
    uploader: source.uploader ?? 'agent',
  };
}

/**
 * The dry run of {@link ingest} (M6 §3.5, slice S2b): every file's outcome
 * as the ingest would answer it (unchanged, failed with the same problem,
 * created or revised with the extractor's warnings and the plan of the
 * model's live amendments) and the impact of the would-be heads (an
 * amended head where amendments apply), computed by the pure
 * `importImpact`; nothing is written and no lock is taken. Permission
 * `read`, so a read-only token can preview a bundle; the trust rule
 * classifies the files by the credential of the dry run (M6 S2c), unchanged
 * files keep their stored class. For an owner on an interactive client the
 * impact also names the derived calls their rules would accept
 * (`autoAcceptedCalls`, M6 S2c-3); nobody else gets it. `manifest` names
 * the bundle's system, scope and listed keys for the absent keys. The
 * relations tasks (S2b follow-up) are planned from the open tasks, and for a
 * model without one from its latest done task, read in the same snapshot;
 * with a live value chain the impact also names the accepted placements
 * whose process changes and the placement task (`readChain`). An unchanged
 * file says whether the ingest would record its declared identity
 * (`identityUpdated`, M6 S2b follow-up step 5), compared with the same rows
 * by the same helper as the ingest.
 *
 * @throws {DomainError} from the policy (`read` on the project)
 */
export async function previewIngest(
  deps: Pick<IngestDeps, 'store' | 'analysis' | 'expectedProcedure' | 'expectedPlacementProcedure'>,
  actor: Actor,
  projectRef: string,
  files: readonly IngestFile[],
  manifest: {
    system: string;
    scope?: readonly string[] | undefined;
    keys: ReadonlySet<string>;
  } | null,
): Promise<{ project: ProjectRecord; results: PreviewResult[]; impact: ImportImpact }> {
  const hashes = files.map((f) => contentHash(f.bytes));
  const read = await deps.store.read(async (tx) => {
    const { project } = await policy.require(tx, actor, 'read', projectRef);
    const seen: (Seen & { model: ModelRecord | null; previous: RevisionRecord | null })[] = [];
    for (const f of files) {
      const model = await tx.models.findByKey(project.id, f.key);
      const live = model !== null && model.deletedSeq === null;
      const previous =
        live && model.headRevisionId
          ? await tx.revisions.findInProject(project.id, model.id, model.headRevisionId)
          : null;
      seen.push({ ...(await seenOf(tx, project.id, f.key)), model: live ? model : null, previous });
    }
    /** Whether a file is `unchanged`: bytes its live model knows. */
    const unchanged = (i: number) => !!seen[i]?.previous && !!seen[i]?.known?.has(hashes[i] ?? '');
    const tasks = await readTasks(
      tx,
      project.id,
      files.flatMap((f, i) => (unchanged(i) ? [] : [f.key])),
      deps.expectedProcedure(),
    );
    /** The facts of the latest done task of a changing file's model without an open task. */
    const done = new Map<string, string>();
    for (const [i, f] of files.entries()) {
      // `queueAnalysis` reads it for a layout-only change; whether the facts change is known
      // only after the extraction, outside this snapshot.
      const model = seen[i]?.model;
      if (model && seen[i]?.previous && !unchanged(i) && !tasks?.open.has(f.key)) {
        const task = await tx.tasks.latest(project.id, model.id, ['done']);
        if (task) done.set(f.key, task.factsHash);
      }
    }
    return {
      project,
      seen,
      done,
      head: await readHead(tx, project.id),
      tasks,
      sources: await tx.revisions.uploadedSources(project.id),
      // The newest identity rows an unchanged file compares with (M6 S2b follow-up step 5).
      identities: await tx.identities.newest(
        project.id,
        seen.flatMap((x) => (x.model ? [x.model.id] : [])),
      ),
      auto: await derivedCallRulesFor(tx, actor, project),
      chain: await readChain(tx, project.id, deps.expectedPlacementProcedure()),
    };
  });

  const results: PreviewResult[] = [];
  const heads: FileHeads[] = [];
  const wouldBe = new Map(read.head.projectFacts.models.map((m) => [m.modelKey, m]));
  const trust = new Map(read.head.trust);
  for (const [i, f] of files.entries()) {
    const s = read.seen[i];
    if (!s) throw new Error('previewIngest: a file without its read');
    if (s.previous && s.known?.has(hashes[i] ?? '')) {
      const kept = read.head.trust.get(f.key);
      const identity = s.model ? identityUpdate(read.identities.get(s.model.id), f.source) : null;
      results.push({
        outcome: 'unchanged',
        warnings: [],
        ...(s.live.length > 0 ? { amendments: planCounts(planOf(s.previous)) } : {}),
        trust: {
          stored: kept?.trust ?? null,
          incoming: trustOf(kept?.engine ?? s.previous.engine, f.source),
        },
        ...(identity === null ? {} : { identityUpdated: true as const }),
      });
      continue;
    }
    const extracted = await deps.analysis.extract(f.bytes, f.key);
    if (!extracted.ok) {
      results.push({ outcome: 'failed', error: extractError(extracted.error) });
      continue;
    }
    const derivation =
      s.live.length > 0
        ? await deriveHead(deps.analysis, f.bytes, f.key, s.live, extracted.value)
        : null;
    const head = derivation && derivation.applied > 0 ? derivation.extracted : extracted.value;
    const classOf = trustOf(extracted.value.engine, f.source);
    trust.set(f.key, incomingTrust(classOf, f.source, extracted.value, derivation?.plan));
    results.push({
      outcome: s.model ? 'revised' : 'created',
      warnings: extracted.value.warnings,
      ...(derivation ? { amendments: planCounts(derivation.plan) } : {}),
      trust: { stored: classOf, incoming: classOf },
    });
    wouldBe.set(f.key, {
      modelKey: f.key,
      factsVersion: head.factsVersion,
      processes: head.processes,
      facts: head.facts,
      messageFlows: head.messageFlows,
    });
    heads.push({
      modelKey: f.key,
      previousFactsHash: s.previous?.factsHash ?? null,
      factsHash: deps.analysis.factsHash(head.facts),
      previousProcesses:
        (s.previous &&
          read.head.projectFacts.models.find((m) => m.modelKey === f.key)?.processes) ??
        [],
      processes: head.processes,
      trust: classOf,
    });
  }

  const projectFacts = {
    models: [...wouldBe.values()].sort((a, b) => byCodePoint(a.modelKey, b.modelKey)),
  };
  const imported = new Set([...files.map((f) => f.key), ...(manifest?.keys ?? [])]);
  const impact = importImpact(
    {
      projectId: read.project.id,
      rulesPrincipalId: read.head.rulesPrincipalId,
      projectFacts,
      rules: deps.analysis.runRules(projectFacts),
      trust,
      relations: read.head.relations,
      history: read.head.history,
    },
    read.head.findings,
    heads,
    absentKeys(read.sources, manifest, imported),
    read.auto ?? undefined,
    taskInput(deps, read.head, read.tasks, projectFacts, read.done),
    chainInput(read.chain, read.head.projectFacts, {
      // `afterHeadChange` runs for a created or revised file (the chain's sync with it) and
      // queues the placement task when a file changes facts.
      headChange: heads.length > 0,
      triggered: heads.some((h) => h.previousFactsHash !== h.factsHash),
    }),
  );
  return { project: read.project, results, impact };
}

/**
 * What deleting a model would change (M6 §3.5, `GET …/deletion-impact`):
 * the impact with the model's facts removed from the head; `files` and
 * `absentKeys` are empty; for an owner the derived calls their rules would
 * accept (a duplicate process id gone, M6 S2c-3); the model's open
 * relations task cancelled, nothing queued (S2b follow-up); with a live
 * value chain the accepted placements of its processes turn `missing` and
 * the placement task is `not-triggered` (deletions never queue, M4 §3.2),
 * with the processes the deletion makes due. Permission `read`, nothing
 * written.
 *
 * @throws {DomainError} `not-found` for unknown, deleted or foreign models
 */
export async function deletionImpact(
  deps: Pick<IngestDeps, 'store' | 'analysis' | 'expectedProcedure' | 'expectedPlacementProcedure'>,
  actor: Actor,
  projectRef: string,
  modelId: ModelId,
): Promise<ImportImpact> {
  const read = await deps.store.read(async (tx) => {
    const { project } = await policy.require(tx, actor, 'read', projectRef);
    const model = await tx.models.findInProject(project.id, modelId);
    if (!model) throw new DomainError('not-found', 'model not found');
    return {
      project,
      model,
      head: await readHead(tx, project.id),
      tasks: await readTasks(tx, project.id, [model.key], deps.expectedProcedure()),
      auto: await derivedCallRulesFor(tx, actor, project),
      chain: await readChain(tx, project.id, deps.expectedPlacementProcedure()),
    };
  });
  const projectFacts = {
    models: read.head.projectFacts.models.filter((m) => m.modelKey !== read.model.key),
  };
  const trust = new Map(read.head.trust);
  trust.delete(read.model.key);
  return importImpact(
    {
      projectId: read.project.id,
      rulesPrincipalId: read.head.rulesPrincipalId,
      projectFacts,
      rules: deps.analysis.runRules(projectFacts),
      trust,
      relations: read.head.relations,
      history: read.head.history,
    },
    read.head.findings,
    [],
    [],
    read.auto ?? undefined,
    taskInput(deps, read.head, read.tasks, projectFacts, new Map(), read.model.key),
    // `deleteModel` syncs the chain, but never queues the placement task (M4 §3.2).
    chainInput(read.chain, read.head.projectFacts, { headChange: true, triggered: false }),
  );
}

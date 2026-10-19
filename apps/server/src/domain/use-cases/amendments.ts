/**
 * Model amendments (M6 §4.8 c, decision 25, S5c-2): the fields of an element
 * an amendment can set (`read`), amendment writes with a dry run, the cost
 * and `If-Match`, withdrawals (one, or all of a model), the list and the
 * change list. Writes are human decisions about content (`review`, humans
 * only) that write a revision (`write`): both permissions, so a review-only
 * scope gets `insufficient-scope`. Every write runs under the project lock:
 * the uploaded revision stays, and the head is derived from its bytes with
 * the live amendments the plan marks `applied` (byte-preserving splices
 * through `AnalysisPort.amend`, never a bpmn-moddle round trip), then the
 * tail every head change runs ({@link afterHeadChange}).
 */
import {
  AMENDABLE_ELEMENT_LABELS,
  amendmentFieldLabel,
  endpointTypeLabel,
  formatRef,
  newId,
  openQuestionsPath,
  parseRef,
  personalDataWarnings,
  type AmendModelBody,
  type AmendModelItemResult,
  type AmendModelResult,
  type AmendableElement,
  type AmendableField,
  type AmendmentCost,
  type AmendmentEffectRelation,
  type AmendmentExportQuery,
  type AmendmentFilter,
  type AmendmentListQuery,
  type AmendmentNameFamily,
  type Fact,
  type ModelAmendment,
  type ModelAmendmentId,
  type ModelAmendmentList,
  type ModelId,
  type PrincipalId,
  type ProcessInfo,
  type ProjectId,
  type RevisionUpstream,
  type WithdrawAmendmentsResult,
} from '@analyzr/contracts';
import { quoteDe } from '@analyzr/relations';

import { sourceKindOf, type Actor } from '../actor.ts';
import { deriveHead, planOf, uploadedOf, type Derivation } from '../amendments/derive.ts';
import { amendmentEffect, noEffect, type EffectCandidate } from '../amendments/effect.ts';
import {
  changeListFilename,
  renderChangeListCsv,
  originOf,
  renderChangeListMarkdown,
  type ChangeListEntry,
  type ChangeListOrigin,
  type ChangeListTarget,
} from '../amendments/export.ts';
import {
  ReplacesMismatch,
  amendability,
  checkItem,
  fieldKey,
  fieldsOfElement,
  namedFields,
  storedVia,
  suggestionsFor,
  type AmendContext,
  type ItemCheck,
  type ResolvedField,
} from '../amendments/fields.ts';
import { liveAmendments, type LiveAmendment } from '../amendments/plan.ts';
import { amendmentViews } from '../amendments/state.ts';
import { DomainError } from '../errors.ts';
import { headFingerprints } from '../fingerprints.ts';
import { afterHeadChange, amendedSource, contentHash, storeHead } from '../ingest.ts';
import { linkJudgements, pairKey } from '../judgements.ts';
import type { OpenQuestionInput } from '../open-questions/model.ts';
import { buildOpenQuestions } from '../open-questions/read-model.ts';
import { policy, type ProjectAccess } from '../policy.ts';
import type {
  AmendableDocument,
  ModelRecord,
  ProjectRecord,
  RelationRecord,
  RevisionRecord,
  StoredAssertion,
  StoredModelAmendment,
  Tx,
} from '../ports.ts';
import { byRelation } from '../relation-state.ts';
import { callTargets, trustByModel, type ModelTrust } from '../trust.ts';
import { toModel, toRevision } from '../views.ts';
import type { UseCaseDeps } from './deps.ts';
import { CandidateCache, loadOpenQuestionInput } from './open-questions.ts';
import { recordDecision } from './review.ts';

/** What the amendment use cases get injected. */
export interface AmendmentDeps extends UseCaseDeps {
  /** Id of the system principal `analyzr-rules` (created on first use). */
  rulesPrincipal(): Promise<PrincipalId>;
}

/** The rendered change list: what the HTTP layer sends as an attachment. */
export interface ChangeListExport {
  filename: string;
  contentType: string;
  body: string;
}

/** The rationale of a key-tier proposal a `partner` accepts (German, from code). */
export const PARTNER_RATIONALE = 'Aus „Ergänzen“: Beim Eintragen des Namens als Partner gewählt.';
/** The rationale of a manual link a call from an amendment replaces (M6 §4.8 c). */
export const RETIRED_BY_CALL = 'Ersetzt durch den Aufruf aus der Ergänzung';
/** The rationale of a manual link the accepted partner of an amendment replaces. */
export const RETIRED_BY_PARTNER = 'Ersetzt durch den angenommenen Partner aus der Ergänzung';

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `review` and `write` (M6 §4.8 c "Both permissions"): a human on an
 * interactive client whose scopes grant both; an agent fails with
 * `human-decision-required` carrying `reviewUrl` (the tab „Offene Fragen“).
 */
async function requireAmending(tx: Tx, actor: Actor, projectRef: string): Promise<ProjectAccess> {
  let access: ProjectAccess;
  try {
    access = await policy.require(tx, actor, 'review', projectRef);
  } catch (err) {
    if (err instanceof DomainError && err.code === 'human-decision-required') {
      const project = await tx.projects.findByRef(projectRef);
      throw new DomainError(err.code, err.message, {
        reviewUrl: openQuestionsPath(project?.key ?? projectRef),
      });
    }
    throw err;
  }
  await policy.require(tx, actor, 'write', projectRef);
  if (sourceKindOf(actor) !== 'human') {
    throw new DomainError('human-decision-required', 'only a human amends a model', {
      reviewUrl: openQuestionsPath(access.project.key),
    });
  }
  return access;
}

/** A model whose head and uploaded revision were read, with everything the checks need. */
interface Loaded {
  model: ModelRecord;
  head: RevisionRecord;
  headRev: number;
  upstream: RevisionUpstream;
  uploadedBytes: Uint8Array;
  stored: StoredModelAmendment[];
  live: LiveAmendment[];
  input: OpenQuestionInput;
  ctx: AmendContext;
}

/** `readAmendable` of stored bytes; they were extracted before, so a refusal is a bug. */
async function amendableOf(
  deps: UseCaseDeps,
  bytes: Uint8Array,
  modelKey: string,
): Promise<AmendableDocument> {
  const doc = await deps.analysis.readAmendable(bytes, modelKey);
  if (!doc.ok) throw new Error(`readAmendable of ${modelKey} failed: ${doc.error.message}`);
  return doc.value;
}

/** Inserts `live` supersessions and new amendments into the live set, in seq order. */
function nextLive(
  live: readonly LiveAmendment[],
  candidates: readonly {
    id: ModelAmendmentId;
    check: Extract<ItemCheck, { outcome: 'candidate' }>;
  }[],
): LiveAmendment[] {
  const superseded = new Set(
    candidates.flatMap((c) => (c.check.supersedes ? [c.check.supersedes.id] : [])),
  );
  // The new amendments share one seq (their `model.amended` event); every later derivation
  // orders them by id (`liveAmendments`), so this one does too: identical inputs, identical bytes.
  return [
    ...live.filter((a) => !superseded.has(a.id)),
    ...[...candidates]
      .sort((a, b) => byCodePoint(a.id, b.id))
      .map((c) => ({
        id: c.id,
        elementId: c.check.field.key,
        viaElementId: c.check.field.via,
        op: c.check.field.op,
        before: c.check.before,
        after: c.check.after,
        seq: Number.MAX_SAFE_INTEGER,
      })),
  ];
}

/**
 * The models' trust for an amendment's effect (M6 S2c): as stored, and with
 * the model's call targets from the derived head's plan, which count as
 * modelled (decision 25.2).
 */
async function effectTrust(
  tx: Tx,
  projectId: ProjectId,
  modelKey: string,
  derivation: Pick<Derivation, 'plan'>,
): Promise<{ before: Map<string, ModelTrust>; after: Map<string, ModelTrust> }> {
  const before = trustByModel(await tx.revisions.headTrustRows(projectId));
  const after = new Map(before);
  const own = before.get(modelKey);
  if (own) after.set(modelKey, { ...own, ...callTargets(derivation.plan) });
  return { before, after };
}

/** The endpoints whose name a `message-name` amendment sets: the one asked, else its readers. */
function endpointsOf(field: ResolvedField): string[] {
  if (field.op !== 'message-name') return [];
  return field.via === null ? field.readers : [field.via];
}

/** Whether a model key matches the `modelKey` filter: the model, or a model below that folder. */
function inModel(modelKey: string, filter: string | undefined): boolean {
  return filter === undefined || modelKey === filter || modelKey.startsWith(`${filter}/`);
}

function matches(a: ModelAmendment, filter: AmendmentFilter): boolean {
  return (
    inModel(a.modelKey, filter.modelKey) && (filter.state === undefined || a.state === filter.state)
  );
}

/** German type of an element by its facts. */
const ELEMENT_TYPES: Readonly<Record<string, string>> = {
  'bpmn:StartEvent': 'Startereignis',
  'bpmn:EndEvent': 'Endereignis',
  'bpmn:IntermediateThrowEvent': 'Auslösendes Zwischenereignis',
  'bpmn:IntermediateCatchEvent': 'Eintretendes Zwischenereignis',
  'bpmn:BoundaryEvent': 'Angeheftetes Ereignis',
  'bpmn:SendTask': 'Sendeaufgabe',
  'bpmn:ReceiveTask': 'Empfangsaufgabe',
  'bpmn:CallActivity': 'Aufrufaktivität',
  'bpmn:Process': 'Prozess',
  'bpmn:MessageFlow': 'Nachrichtenfluss',
};

export function amendmentUseCases(deps: AmendmentDeps) {
  const candidateCache = new CandidateCache();

  /** Reads a live model's head, uploaded revision, amendments and the checks' context. */
  async function load(tx: Tx, project: ProjectRecord, model: ModelRecord): Promise<Loaded> {
    if (!model.headRevisionId) throw new DomainError('not-found', 'model not found');
    const head = await tx.revisions.findInProject(project.id, model.id, model.headRevisionId);
    const view = await tx.models.view(project.id, model.id);
    if (!head || !view) throw new DomainError('not-found', 'model not found');
    const upstream = uploadedOf(head);
    const uploadedBytes = await tx.revisions.content(project.id, model.id, upstream.revisionId);
    const headBytes = await tx.revisions.content(project.id, model.id, head.id);
    if (!uploadedBytes || !headBytes) throw new Error(`revision bytes of ${model.key} missing`);
    const uploaded = await amendableOf(deps, uploadedBytes, model.key);
    const headDoc =
      head.id === upstream.revisionId ? uploaded : await amendableOf(deps, headBytes, model.key);
    const stored = await tx.amendments.list(project.id, { modelId: model.id });
    const live = liveAmendments(stored);
    const input = await loadOpenQuestionInput(tx, deps, project.id, candidateCache);
    const { items } = buildOpenQuestions(input);
    const base = {
      modelKey: model.key,
      uploaded,
      head: headDoc,
      projectFacts: input.projectFacts,
      findings: await tx.findings.list(project.id),
      live,
      applied: new Set(
        planOf(head)
          .filter((e) => e.outcome === 'applied')
          .map((e) => e.id as string),
      ),
      modelNames: new Map([...input.models].map(([k, m]) => [k, m.name])),
    };
    return {
      model,
      head,
      headRev: view.headRev,
      upstream,
      uploadedBytes,
      stored,
      live,
      input,
      ctx: { ...base, named: namedFields(base, items) },
    };
  }

  /** A live model by id, or 404 (a deleted model has no amendable head). */
  async function liveModelOf(tx: Tx, projectId: ProjectId, modelId: ModelId): Promise<ModelRecord> {
    const model = await tx.models.findInProject(projectId, modelId);
    if (!model) throw new DomainError('not-found', 'model not found');
    return model;
  }

  /** The cost of a new head (decision 17): judgements made non-current, a claimed task. */
  async function costOf(
    tx: Tx,
    projectId: ProjectId,
    l: Loaded,
    derivation: Derivation | null,
  ): Promise<AmendmentCost> {
    const open = await tx.tasks.latest(projectId, l.model.id, ['queued', 'claimed']);
    const taskClaimed = open?.state === 'claimed';
    if (!derivation) return { factsChange: false, pairsToRejudge: 0, taskClaimed };
    const factsChange = deps.analysis.factsHash(derivation.extracted.facts) !== l.head.factsHash;
    if (!factsChange) return { factsChange, pairsToRejudge: 0, taskClaimed };
    const { input } = l;
    const hashes = new Map([...input.models].map(([k, m]) => [k, m.factsHash]));
    const touches = (from: string, to: string) =>
      parseRef(from).modelKey === l.model.key || parseRef(to).modelKey === l.model.key;
    const pairs = new Set<string>();
    for (const j of linkJudgements(
      input.relations,
      input.histories,
      new Map(),
      hashes,
      deps.expectedProcedure(),
    )) {
      if (j.current && touches(j.from, j.to)) pairs.add(pairKey(j));
    }
    for (const n of input.noLinks) {
      if (n.current && touches(n.fromRef, n.toRef)) {
        pairs.add(pairKey({ type: n.type, from: n.fromRef, to: n.toRef }));
      }
    }
    return { factsChange, pairsToRejudge: pairs.size, taskClaimed };
  }

  /**
   * Re-derives a live model's head from its uploaded revision with the
   * remaining live amendments (a withdrawal): always a new revision, with
   * none left one whose bytes equal the uploaded revision's.
   */
  async function rederive(
    tx: Tx,
    actor: Actor,
    project: ProjectRecord,
    model: ModelRecord,
    rulesPrincipalId: PrincipalId,
  ): Promise<RevisionRecord> {
    if (!model.headRevisionId) throw new Error(`model ${model.key} has no head`);
    const head = await tx.revisions.findInProject(project.id, model.id, model.headRevisionId);
    if (!head) throw new Error(`head of ${model.key} missing`);
    const upstream = uploadedOf(head);
    const bytes = await tx.revisions.content(project.id, model.id, upstream.revisionId);
    if (!bytes) throw new Error(`uploaded revision of ${model.key} missing`);
    const live = liveAmendments(await tx.amendments.list(project.id, { modelId: model.id }));
    const derivation = await deriveHead(deps.analysis, bytes, model.key, live);
    const revision = await storeHead(tx, deps.analysis, actor, project.id, {
      modelId: model.id,
      modelKey: model.key,
      rev: (await tx.revisions.maxRev(project.id, model.id)) + 1,
      outcome: 'amended',
      bytes: derivation.xml,
      contentHash: contentHash(derivation.xml),
      extracted: derivation.extracted,
      source: amendedSource(actor, upstream, derivation),
      name: model.name,
    });
    await afterHeadChange(tx, deps, actor, project.id, rulesPrincipalId, [
      { model, revision, previousFactsHash: head.factsHash },
    ]);
    return revision;
  }

  /**
   * `If-Match` of a withdrawal (M6 §4.8 c "Concurrency"): optional; when
   * sent it must name the live model's head, checked under the project lock,
   * so an amendment recorded meanwhile is never withdrawn unseen. A deleted
   * model has no head a human could have seen; nothing is checked there.
   */
  async function checkWithdrawalHead(
    tx: Tx,
    project: ProjectRecord,
    model: ModelRecord,
    ifMatchRev: number | undefined,
  ): Promise<void> {
    if (ifMatchRev === undefined || model.deletedSeq !== null) return;
    const view = await tx.models.view(project.id, model.id);
    if (view && view.headRev !== ifMatchRev) {
      throw new DomainError(
        'revision-conflict',
        `the model is at r${view.headRev}; load its amendments again before withdrawing`,
        { headRev: view.headRev, etag: `"r${view.headRev}"` },
      );
    }
  }

  /**
   * A withdrawal's dry run: what would end and the cost of the new head
   * (none on a deleted model, which gets no revision); writes nothing.
   */
  async function withdrawalDryRun(
    tx: Tx,
    project: ProjectRecord,
    model: ModelRecord,
    amendments: readonly StoredModelAmendment[],
  ): Promise<WithdrawAmendmentsResult> {
    const live = amendments.filter((a) => a.withdrawal === null);
    const views = await amendmentViews(tx, project.id, amendments);
    if (model.deletedSeq !== null) {
      return {
        result: live.length > 0 ? 'withdrawn' : 'unchanged',
        amendments: views,
        model: null,
        revision: null,
        dryRun: true,
      };
    }
    const l = await load(tx, project, model);
    const ending = new Set(live.map((a) => a.id as string));
    const derivation =
      live.length > 0
        ? await deriveHead(
            deps.analysis,
            l.uploadedBytes,
            model.key,
            l.live.filter((a) => !ending.has(a.id)),
          )
        : null;
    const view = await tx.models.view(project.id, model.id);
    return {
      result: live.length > 0 ? 'withdrawn' : 'unchanged',
      amendments: views,
      model: view ? toModel(view) : null,
      revision: null,
      dryRun: true,
      cost: await costOf(tx, project.id, l, derivation),
    };
  }

  /** Records withdrawals (one `model.amendment_withdrawn` event each), re-deriving a live model once. */
  async function withdraw(
    tx: Tx,
    actor: Actor,
    project: ProjectRecord,
    model: ModelRecord,
    amendments: readonly StoredModelAmendment[],
    rulesPrincipalId: PrincipalId,
  ): Promise<WithdrawAmendmentsResult> {
    const live = amendments.filter((a) => a.withdrawal === null);
    if (live.length === 0) {
      const views = await amendmentViews(tx, project.id, amendments);
      const view = model.deletedSeq === null ? await tx.models.view(project.id, model.id) : null;
      return {
        result: 'unchanged',
        amendments: views,
        model: view ? toModel(view) : null,
        revision: null,
      };
    }
    for (const a of live) {
      const seq = await tx.events.append(project.id, {
        type: 'model.amendment_withdrawn',
        principalId: actor.principalId,
        clientId: actor.clientId,
        subjectRef: model.key,
        payload: {
          modelId: model.id,
          modelKey: model.key,
          amendmentId: a.id,
          elementId: a.elementId,
          op: a.op,
          reason: 'withdrawn',
        },
      });
      await tx.amendments.withdraw([
        {
          amendmentId: a.id,
          projectId: project.id,
          reason: 'withdrawn',
          principalId: actor.principalId,
          sourceKind: 'human',
          seq,
        },
      ]);
    }
    // A deleted model gets no revision: one after `model.deleted` would make `hashesAt` see it.
    const revision =
      model.deletedSeq === null
        ? await rederive(tx, actor, project, model, rulesPrincipalId)
        : null;
    const ids = new Set(amendments.map((a) => a.id as string));
    const stored = (await tx.amendments.list(project.id, { modelId: model.id })).filter((a) =>
      ids.has(a.id),
    );
    const view = model.deletedSeq === null ? await tx.models.view(project.id, model.id) : null;
    return {
      result: 'withdrawn',
      amendments: await amendmentViews(tx, project.id, stored),
      model: view ? toModel(view) : null,
      revision: revision ? toRevision(revision) : null,
    };
  }

  /**
   * After an amendment write (inside its transaction, after the tail): the
   * key-tier proposals a `partner` accepts, as the human's decision, and the
   * manual links the call or the accepted partner replaces, retired by a
   * human rejection (append-only).
   */
  async function settleLinks(
    tx: Tx,
    actor: Actor,
    projectId: ProjectId,
    modelKey: string,
    candidates: readonly EffectCandidate[],
  ): Promise<void> {
    const fps = headFingerprints(await tx.facts.headProjectFacts(projectId));
    const decide = async (
      relation: RelationRecord,
      verdict: 'accept' | 'reject',
      rationale: string,
    ) => {
      const histories = byRelation<StoredAssertion>(
        await tx.assertions.listForRelations(projectId, [relation.id]),
      );
      await recordDecision(tx, projectId, actor, relation, histories.get(relation.id) ?? [], fps, {
        verdict,
        rationale,
        question: null,
        label: null,
        linkedRelationId: null,
        tier: null,
        confidence: null,
      });
    };
    for (const c of candidates) {
      if (c.call !== null) {
        const callRef = `${modelKey}#${c.call}`;
        const all = await tx.relations.all(projectId);
        for (const call of all.filter(
          (r) => r.type === 'call' && r.fromRef === callRef && r.status === 'accepted',
        )) {
          const manual = all.find(
            (r) => r.type === 'manual' && r.fromRef === callRef && r.toRef === call.toRef,
          );
          if (manual?.status === 'accepted') await decide(manual, 'reject', RETIRED_BY_CALL);
        }
      }
      if (c.partner !== null) {
        const ends = new Set(c.endpoints.map((id) => `${modelKey}#${id}`));
        for (const r of await tx.relations.all(projectId)) {
          const pair =
            (ends.has(r.fromRef) && r.toRef === c.partner) ||
            (ends.has(r.toRef) && r.fromRef === c.partner);
          if (!pair) continue;
          if (
            (r.type === 'message' || r.type === 'signal') &&
            (r.status === 'proposed' || r.status === 'held')
          ) {
            await decide(r, 'accept', PARTNER_RATIONALE);
          } else if (r.type === 'manual' && r.status === 'accepted') {
            await decide(r, 'reject', RETIRED_BY_PARTNER);
          }
        }
      }
    }
  }

  /** The views of every amendment of a model touching an element (its history). */
  function historyOf(
    stored: readonly StoredModelAmendment[],
    views: ReadonlyMap<string, ModelAmendment>,
    ids: ReadonlySet<string>,
  ): ModelAmendment[] {
    return stored
      .filter((a) => ids.has(a.elementId) || (a.viaElementId !== null && ids.has(a.viaElementId)))
      .flatMap((a) => {
        const v = views.get(a.id);
        return v ? [v] : [];
      });
  }

  return {
    /**
     * The fields of an element an amendment can set (M6 §4.8 c), with the
     * head's values, the uploaded values, whether each can be set and why
     * not, its live amendment, the readers of a name, the suggestions and
     * the element's history; `headRev` for the `ETag`.
     *
     * @throws {DomainError} `not-found` for a deleted model or an unknown element; policy errors
     */
    async getAmendable(
      actor: Actor,
      projectRef: string,
      modelId: ModelId,
      elementId: string,
    ): Promise<AmendableElement> {
      return deps.store.read(async (tx) => {
        const { project } = await policy.require(tx, actor, 'read', projectRef);
        const model = await liveModelOf(tx, project.id, modelId);
        const l = await load(tx, project, model);
        const fields = fieldsOfElement(l.ctx, elementId);
        const known =
          fields.length > 0 ||
          l.input.projectFacts.models.some(
            (m) => m.modelKey === model.key && m.facts.some((f) => f.elementId === elementId),
          );
        if (!known) throw new DomainError('not-found', `no element ${elementId} in ${model.key}`);
        const views = new Map(
          (await amendmentViews(tx, project.id, l.stored)).map((v) => [v.id as string, v]),
        );
        const toField = (f: ResolvedField): AmendableField => {
          const blocked = amendability(l.ctx, f);
          const live = l.live.find((a) => a.op === f.op && a.elementId === f.key);
          const family: AmendmentNameFamily =
            f.op === 'message-name' ? (f.signal ? 'signal' : 'message') : null;
          const endpoint =
            f.element === 'endpoint'
              ? l.input.projectFacts.models
                  .find((m) => m.modelKey === model.key)
                  ?.facts.find((x) => x.elementId === f.key && /^(msg|sig)_/.test(x.kind))
              : undefined;
          return {
            op: f.op,
            elementId: f.key,
            viaElementId: f.via,
            element: f.element,
            typeLabel:
              f.element === 'endpoint'
                ? endpointTypeLabel(endpoint?.attrs.elementType, family)
                : AMENDABLE_ELEMENT_LABELS[f.element],
            fieldLabel: amendmentFieldLabel(f.op, family),
            value: f.value,
            uploadedValue: f.uploadedValue,
            settable: blocked === null,
            reason: blocked?.reason ?? null,
            live: live ? (views.get(live.id) ?? null) : null,
            readers: f.readers.map((id) => formatRef(model.key, id)),
            suggestions: suggestionsFor(l.ctx, f),
          };
        };
        const ids = new Set([elementId, ...fields.map((f) => f.key)]);
        return {
          modelId: model.id,
          modelKey: model.key,
          elementId,
          headRevisionId: l.head.id,
          headRev: l.headRev,
          uploadedRevisionId: l.upstream.revisionId,
          fields: fields.map(toField),
          history: historyOf(l.stored, views, ids),
        };
      });
    },

    /**
     * Records amendments of one model (M6 §4.8 c) in one transaction under
     * the project lock: `If-Match` names the head (428, 412), each item is
     * checked, the head is derived from the uploaded revision with the new
     * live set and every new amendment must apply; the uploaded revision
     * stays, the amended revision becomes the head with its own
     * `model.revised` event after `model.amended`, the tail runs, a
     * `partner`'s key-tier proposal is accepted and manual links the call or
     * the partner replaces are retired. A dry run checks the same in a
     * snapshot and writes nothing.
     *
     * @throws {DomainError} policy errors; `not-found`; `precondition-required`;
     *   `revision-conflict`; `conflict` (a stale `replaces`);
     *   `validation-failed` with `reason: 'amendment-not-applicable'` and the items
     */
    async amendModel(
      actor: Actor,
      projectRef: string,
      modelId: ModelId,
      body: AmendModelBody,
      ifMatchRev: number | undefined,
      options: { dryRun: boolean } = { dryRun: false },
    ): Promise<AmendModelResult> {
      const rulesPrincipalId = options.dryRun ? null : await deps.rulesPrincipal();
      const run = async (tx: Tx): Promise<AmendModelResult> => {
        const { project } = await requireAmending(tx, actor, projectRef);
        if (!options.dryRun) await tx.projects.lockForWrite(project.id);
        const model = await liveModelOf(tx, project.id, modelId);
        const view = await tx.models.view(project.id, model.id);
        if (!view) throw new DomainError('not-found', 'model not found');
        if (ifMatchRev === undefined) {
          throw new DomainError(
            'precondition-required',
            `send If-Match: "r<headRev>" with the head the form was read at (now r${view.headRev})`,
          );
        }
        if (ifMatchRev !== view.headRev) {
          throw new DomainError(
            'revision-conflict',
            `the model is at r${view.headRev}; load the element again and amend on top of it`,
            { headRev: view.headRev, etag: `"r${view.headRev}"` },
          );
        }
        const l = await load(tx, project, model);

        // Check each item; two items that resolve to one field are refused.
        const checks: ItemCheck[] = body.items.map((item) => {
          try {
            return checkItem(l.ctx, item, (op, raw) =>
              deps.analysis.normalizeAmendmentValue(op, raw),
            );
          } catch (err) {
            if (!(err instanceof ReplacesMismatch)) throw err;
            throw new DomainError(
              'conflict',
              `the live amendment of ${item.elementId} (${item.op}) is not the one replaces names; load it again`,
              { elementId: item.elementId, op: item.op, live: err.live?.id ?? null },
            );
          }
        });
        const seen = new Set<string>();
        for (const [i, c] of checks.entries()) {
          if (!c.field || c.outcome === 'not-applicable') continue;
          const key = fieldKey(c.field.op, c.field.key);
          if (seen.has(key)) {
            checks[i] = {
              outcome: 'not-applicable',
              reason: 'duplicate-amendment',
              message: `another item sets ${c.field.op} of ${c.field.key}`,
              field: c.field,
            };
          }
          seen.add(key);
        }
        const candidates = checks.flatMap((check, index) =>
          check.outcome === 'candidate' ? [{ index, check, id: newId('modelAmendment') }] : [],
        );
        const derivation =
          candidates.length > 0
            ? await deriveHead(
                deps.analysis,
                l.uploadedBytes,
                model.key,
                nextLive(l.live, candidates),
              )
            : null;
        // Every new amendment must apply to the uploaded revision.
        for (const c of candidates) {
          const entry = derivation?.plan.find((e) => e.id === c.id);
          if (entry?.outcome === 'applied') continue;
          const refusal = derivation?.refusals.get(c.id);
          checks[c.index] = {
            outcome: 'not-applicable',
            reason:
              refusal?.reason ??
              (entry?.outcome === 'in-source'
                ? 'in-source'
                : entry?.reason === 'expression'
                  ? 'expression'
                  : 'element-missing'),
            message: refusal?.message ?? 'the amendment does not apply to the uploaded revision',
            field: c.check.field,
            after: c.check.after,
          };
        }
        const effectCandidates: EffectCandidate[] = candidates.map((c) => ({
          op: c.check.field.op,
          key: c.check.field.key,
          endpoints: endpointsOf(c.check.field),
          call: c.check.field.op === 'call-target' ? c.check.field.key : null,
          partner: c.check.partner,
        }));
        const relations = l.input.relations;
        const computed = derivation
          ? amendmentEffect({
              modelKey: model.key,
              projectFacts: l.input.projectFacts,
              amended: derivation.extracted,
              relations,
              runRules: (facts) => deps.analysis.runRules(facts),
              trust: await effectTrust(tx, project.id, model.key, derivation),
              candidates: effectCandidates,
            })
          : { effect: noEffect(), partnerPairs: new Map<number, AmendmentEffectRelation[]>() };
        for (const [i, c] of candidates.entries()) {
          if (c.check.partner === null || checks[c.index]?.outcome !== 'candidate') continue;
          if ((computed.partnerPairs.get(i) ?? []).length === 0) {
            checks[c.index] = {
              outcome: 'not-applicable',
              reason: 'partner-not-paired',
              message: `the name does not pair ${c.check.partner} with the endpoint`,
              field: c.check.field,
              after: c.check.after,
            };
          }
        }
        const cost = await costOf(tx, project.id, l, derivation);
        const idOf = new Map(candidates.map((c) => [c.index, c.id]));
        const views = new Map(
          (await amendmentViews(tx, project.id, l.stored)).map((v) => [v.id as string, v]),
        );
        const itemResult = (check: ItemCheck, i: number): AmendModelItemResult => {
          const item = body.items[i];
          if (!item) throw new Error('item vanished');
          const base = {
            elementId: item.elementId,
            op: item.op,
            ...(check.field ? { amendmentElementId: check.field.key } : {}),
            ...('after' in check && check.after !== undefined ? { after: check.after } : {}),
            ...(check.field ? { before: check.field.uploadedValue } : {}),
          };
          const warnings =
            'after' in check && check.after !== undefined && item.op !== 'call-target'
              ? personalDataWarnings(check.after)
              : [];
          const withWarnings = warnings.length > 0 ? { warnings } : {};
          switch (check.outcome) {
            case 'not-applicable':
              return {
                ...base,
                outcome: 'not-applicable',
                reason: check.reason,
                message: check.message,
                ...withWarnings,
              };
            case 'unchanged': {
              const live = views.get(check.live.id);
              return {
                ...base,
                outcome: 'unchanged',
                ...(live ? { amendment: live } : {}),
                ...withWarnings,
              };
            }
            case 'candidate':
              return {
                ...base,
                outcome: 'recorded',
                ...(check.supersedes ? { supersedes: check.supersedes.id } : {}),
                ...withWarnings,
              };
          }
        };
        const items = checks.map(itemResult);
        const refused = checks.some((c) => c.outcome === 'not-applicable');
        const recordable = !refused && candidates.length > 0 && derivation !== null;
        if (options.dryRun || !recordable) {
          if (!options.dryRun && refused) {
            throw new DomainError(
              'validation-failed',
              'an amendment is not applicable; nothing was written',
              {
                reason: 'amendment-not-applicable',
                items,
              },
            );
          }
          return {
            dryRun: options.dryRun,
            outcome: recordable ? 'recorded' : 'unchanged',
            items,
            model: toModel(view),
            revision: null,
            effect: recordable ? computed.effect : noEffect(),
            cost: recordable ? cost : { ...cost, factsChange: false, pairsToRejudge: 0 },
          };
        }
        if (rulesPrincipalId === null) throw new Error('rules principal missing');

        // Write: the amendments and the supersessions (one `model.amended`), then the head.
        const superseded = candidates.flatMap((c) =>
          c.check.supersedes ? [c.check.supersedes] : [],
        );
        const seq = await tx.events.append(project.id, {
          type: 'model.amended',
          principalId: actor.principalId,
          clientId: actor.clientId,
          subjectRef: model.key,
          payload: {
            modelId: model.id,
            modelKey: model.key,
            recorded: candidates.map((c) => ({
              id: c.id,
              elementId: c.check.field.key,
              op: c.check.field.op,
            })),
            superseded: superseded.map((a) => ({ id: a.id, elementId: a.elementId, op: a.op })),
          },
        });
        await tx.amendments.insert(
          candidates.map((c) => ({
            id: c.id,
            projectId: project.id,
            modelId: model.id,
            elementId: c.check.field.key,
            viaElementId: storedVia(l.ctx, c.check.field),
            op: c.check.field.op,
            before: c.check.before,
            after: c.check.after,
            baseRevisionId: l.upstream.revisionId,
            supersedesId: c.check.supersedes?.id ?? null,
            principalId: actor.principalId,
            clientId: actor.clientId,
            sourceKind: 'human',
            seq,
          })),
        );
        await tx.amendments.withdraw(
          superseded.map((a) => ({
            amendmentId: a.id,
            projectId: project.id,
            reason: 'superseded',
            principalId: actor.principalId,
            sourceKind: 'human',
            seq,
          })),
        );
        const revision = await storeHead(tx, deps.analysis, actor, project.id, {
          modelId: model.id,
          modelKey: model.key,
          rev: (await tx.revisions.maxRev(project.id, model.id)) + 1,
          outcome: 'amended',
          bytes: derivation.xml,
          contentHash: contentHash(derivation.xml),
          extracted: derivation.extracted,
          source: amendedSource(actor, l.upstream, derivation),
          name: model.name,
        });
        await afterHeadChange(tx, deps, actor, project.id, rulesPrincipalId, [
          { model, revision, previousFactsHash: l.head.factsHash },
        ]);
        await settleLinks(tx, actor, project.id, model.key, effectCandidates);

        const after = await tx.models.view(project.id, model.id);
        if (!after) throw new Error(`model ${model.key} vanished inside its transaction`);
        const stored = await tx.amendments.list(project.id, { modelId: model.id });
        const recorded = new Map(
          (await amendmentViews(tx, project.id, stored)).map((v) => [v.id as string, v]),
        );
        return {
          dryRun: false,
          outcome: 'recorded',
          items: items.map((r, i) => {
            const id = idOf.get(i);
            const amendment = id === undefined ? undefined : recorded.get(id);
            return amendment ? { ...r, amendment } : r;
          }),
          model: toModel(after),
          revision: toRevision(revision),
          effect: computed.effect,
          cost,
        };
      };
      return options.dryRun ? deps.store.read(run) : deps.store.write(run);
    },

    /**
     * Withdraws one amendment („Ergänzung zurücknehmen“): its row and a
     * `model.amendment_withdrawn` event, then a new head re-derived from the
     * uploaded revision with the remaining live amendments; on a deleted
     * model only the row. One that ended before is `unchanged`. `If-Match`
     * (optional) is checked under the project lock; a dry run answers the
     * cost of the new head and writes nothing.
     *
     * @throws {DomainError} `not-found`; `revision-conflict`; policy errors
     */
    async withdrawAmendment(
      actor: Actor,
      projectRef: string,
      amendmentId: ModelAmendmentId,
      options: { dryRun?: boolean; ifMatchRev?: number | undefined } = {},
    ): Promise<WithdrawAmendmentsResult> {
      const dryRun = options.dryRun === true;
      const rulesPrincipalId = dryRun ? null : await deps.rulesPrincipal();
      const run = async (tx: Tx): Promise<WithdrawAmendmentsResult> => {
        const { project } = await requireAmending(tx, actor, projectRef);
        if (!dryRun) await tx.projects.lockForWrite(project.id);
        const stored = await tx.amendments.list(project.id);
        const amendment = stored.find((a) => a.id === amendmentId);
        if (!amendment) throw new DomainError('not-found', 'amendment not found');
        const model = await tx.models.findIncludingDeleted(project.id, amendment.modelId);
        if (!model) throw new Error(`model of ${amendmentId} missing`);
        await checkWithdrawalHead(tx, project, model, options.ifMatchRev);
        if (dryRun) return withdrawalDryRun(tx, project, model, [amendment]);
        if (rulesPrincipalId === null) throw new Error('rules principal missing');
        return withdraw(tx, actor, project, model, [amendment], rulesPrincipalId);
      };
      return dryRun ? deps.store.read(run) : deps.store.write(run);
    },

    /**
     * Withdraws every live amendment of a model in one transaction and one
     * re-derivation („Alle Ergänzungen dieses Modells zurücknehmen“); a
     * deleted model's amendments too, without a revision. `If-Match`
     * (optional) is checked under the project lock, so an amendment recorded
     * after the human looked is not withdrawn unseen; a dry run answers the
     * cost of the new head and writes nothing.
     *
     * @throws {DomainError} `not-found`; `revision-conflict`; policy errors
     */
    async withdrawModelAmendments(
      actor: Actor,
      projectRef: string,
      modelId: ModelId,
      options: { dryRun?: boolean; ifMatchRev?: number | undefined } = {},
    ): Promise<WithdrawAmendmentsResult> {
      const dryRun = options.dryRun === true;
      const rulesPrincipalId = dryRun ? null : await deps.rulesPrincipal();
      const run = async (tx: Tx): Promise<WithdrawAmendmentsResult> => {
        const { project } = await requireAmending(tx, actor, projectRef);
        if (!dryRun) await tx.projects.lockForWrite(project.id);
        const model = await tx.models.findIncludingDeleted(project.id, modelId);
        if (!model) throw new DomainError('not-found', 'model not found');
        await checkWithdrawalHead(tx, project, model, options.ifMatchRev);
        const stored = (await tx.amendments.list(project.id, { modelId: model.id })).filter(
          (a) => a.withdrawal === null,
        );
        if (dryRun) return withdrawalDryRun(tx, project, model, stored);
        if (rulesPrincipalId === null) throw new Error('rules principal missing');
        return withdraw(tx, actor, project, model, stored, rulesPrincipalId);
      };
      return dryRun ? deps.store.read(run) : deps.store.write(run);
    },

    /** Every amendment of the project matching the filters, oldest first, with the seq read. */
    async listAmendments(
      actor: Actor,
      projectRef: string,
      query: AmendmentListQuery,
    ): Promise<ModelAmendmentList> {
      return deps.store.read(async (tx) => {
        const { project } = await policy.require(tx, actor, 'read', projectRef);
        const views = await amendmentViews(tx, project.id, await tx.amendments.list(project.id));
        return { items: views.filter((a) => matches(a, query)), seq: project.lastSeq };
      });
    },

    /**
     * The change list (M6 §4.8 c "Exports") as Markdown or CSV: the
     * amendments matching the filters (and recorded or ended after `since`),
     * grouped per model, each with its element described from its model's
     * head (the last head of a deleted model).
     */
    async exportAmendments(
      actor: Actor,
      projectRef: string,
      query: AmendmentExportQuery,
    ): Promise<ChangeListExport> {
      return deps.store.read(async (tx) => {
        const { project } = await policy.require(tx, actor, 'read', projectRef);
        const stored = await tx.amendments.list(project.id);
        const since = query.since;
        const views = (await amendmentViews(tx, project.id, stored)).filter(
          (a) =>
            matches(a, query) &&
            (since === undefined || a.seq > since || (a.withdrawal?.seq ?? 0) > since),
        );
        const headFacts = await tx.facts.headProjectFacts(project.id);
        const processesById = new Map<string, { info: ProcessInfo; modelKey: string }[]>();
        for (const m of headFacts.models) {
          for (const p of m.processes) {
            processesById.set(p.processId, [
              ...(processesById.get(p.processId) ?? []),
              { info: p, modelKey: m.modelKey },
            ]);
          }
        }
        const modelNames = new Map<string, string | null>();
        for (const m of await tx.models.list(project.id, { limit: 100_000 })) {
          modelNames.set(m.key, m.name);
        }
        const target = (processId: string): ChangeListTarget => {
          const found = [...(processesById.get(processId) ?? [])].sort((a, b) =>
            byCodePoint(a.modelKey, b.modelKey),
          )[0];
          return {
            processId,
            process: found
              ? {
                  name: found.info.name ?? found.info.participantName ?? processId,
                  modelKey: found.modelKey,
                  modelName: modelNames.get(found.modelKey) ?? null,
                }
              : null,
          };
        };
        // Per model: the facts of the uploaded revision its head is computed from (the
        // element as the source tool knows it: its labels, not analyzr's), and, for names,
        // the head's `readAmendable` (who reads a message, which one an endpoint references).
        const perModel = new Map<
          string,
          {
            name: string | null;
            facts: Fact[];
            processes: ProcessInfo[];
            doc: AmendableDocument | null;
            origin: ChangeListOrigin | null;
          }
        >();
        // Where each live model lives in its source tool (M6 S2a, §3.3): its uploaded
        // revision's provenance, or the newest declared one (`uploadedSources`).
        const provenance = await tx.revisions.uploadedSources(project.id);
        for (const modelId of new Set(views.map((a) => a.modelId))) {
          const model = await tx.models.findIncludingDeleted(project.id, modelId);
          if (!model?.headRevisionId) continue;
          const head = await tx.revisions.findInProject(project.id, modelId, model.headRevisionId);
          const sourceId = head ? uploadedOf(head).revisionId : model.headRevisionId;
          const facts = await tx.revisions.facts(project.id, modelId, sourceId);
          // A deleted model is read from its own uploaded revision.
          const live = model.deletedSeq === null ? provenance.get(model.key) : undefined;
          const uploaded =
            live === undefined && head && sourceId !== head.id
              ? await tx.revisions.findInProject(project.id, modelId, sourceId)
              : head;
          const needsDoc = views.some((a) => a.modelId === modelId && a.op === 'message-name');
          const bytes = needsDoc
            ? await tx.revisions.content(project.id, modelId, model.headRevisionId)
            : null;
          perModel.set(modelId, {
            name: model.name,
            facts: facts?.facts ?? [],
            processes: facts?.processes ?? [],
            doc: bytes ? await amendableOf(deps, bytes, model.key) : null,
            origin: originOf(live ?? uploaded?.source),
          });
        }
        const entries = views.map((a): ChangeListEntry => {
          const m = perModel.get(a.modelId);
          const facts = m?.facts ?? [];
          /** „Endereignis „Name“ (ID End_1)“, „Endereignis ohne Namen (ID End_1)“. */
          const describe = (id: string, type?: string): string => {
            const f = facts.find((x) => x.elementId === id && x.kind !== 'lane');
            const shownType =
              type ?? (f ? (ELEMENT_TYPES[f.attrs.elementType ?? ''] ?? 'Element') : 'Element');
            const label =
              f?.kind === 'process'
                ? (m?.processes.find((p) => p.processId === id)?.name ?? '')
                : (f?.label ?? '');
            return `${shownType} ${label === '' ? 'ohne Namen' : quoteDe(label)} (ID ${id})`;
          };
          const shown = a.viaElementId ?? a.elementId;
          const fact = facts.find((x) => x.elementId === shown && x.kind !== 'lane');
          const process = fact?.processId
            ? m?.processes.find((p) => p.processId === fact.processId)
            : a.op === 'process-documentation'
              ? m?.processes.find((p) => p.processId === a.elementId)
              : undefined;
          const lanes = facts
            .filter(
              (x) =>
                x.kind === 'lane' && x.label !== '' && (x.attrs.flowNodeRefs ?? []).includes(shown),
            )
            .map((x) => x.label);
          const field =
            a.op === 'message-name'
              ? m?.doc?.fields.find((x) => x.op === 'message-name' && x.elementId === a.elementId)
              : undefined;
          /** The message or signal a name amendment writes: keyed by it, or the one the endpoint now references. */
          const messageOf = (): string | null => {
            if (a.op !== 'message-name') return null;
            const keyed = field?.element === 'message' || field?.element === 'signal';
            const id = keyed
              ? a.elementId
              : (m?.doc?.endpoints.find((e) => e.elementId === a.elementId)?.reference ?? null);
            if (id === null) return null;
            const element = m?.doc?.fields.find(
              (x) => x.op === 'message-name' && x.elementId === id,
            )?.element;
            const type =
              element === 'signal'
                ? AMENDABLE_ELEMENT_LABELS.signal
                : AMENDABLE_ELEMENT_LABELS.message;
            return keyed
              ? `${type} (ID ${id})`
              : `${element === 'signal' ? 'neues' : 'neue'} ${type} (ID ${id})`;
          };
          const message = messageOf();
          /** A name's family: the message or signal it is keyed by, else the endpoint's facts. */
          const familyOf = (): AmendmentNameFamily => {
            if (a.op !== 'message-name') return null;
            if (field?.element === 'signal' || field?.element === 'message') return field.element;
            const ep = facts.find((x) => x.elementId === shown && /^(msg|sig)_/.test(x.kind));
            return ep === undefined ? null : ep.kind.startsWith('sig_') ? 'signal' : 'message';
          };
          let element: string;
          switch (a.op) {
            case 'process-documentation':
              element = `${AMENDABLE_ELEMENT_LABELS.process} ${quoteDe(process?.name ?? process?.participantName ?? a.elementId)} (ID ${a.elementId})`;
              break;
            case 'call-target':
              element = describe(shown, AMENDABLE_ELEMENT_LABELS.call);
              break;
            case 'event-name':
              element = describe(shown);
              break;
            case 'message-name':
              // A message no endpoint references has no fact: it is named by itself.
              element =
                fact === undefined && message !== null
                  ? message
                  : message === null
                    ? describe(shown)
                    : `${describe(shown)}, ${message}`;
              break;
          }
          const readers =
            field?.readers && field.readers.length > 1
              ? field.readers.map((id) => describe(id))
              : [];
          return {
            amendment: a,
            modelName: m?.name ?? null,
            ...(m?.origin ? { origin: m.origin } : {}),
            place: process
              ? process.participantName
                ? `Pool ${quoteDe(process.participantName)}`
                : `Prozess ${quoteDe(process.name ?? process.processId)}`
              : null,
            lanes,
            element,
            field: amendmentFieldLabel(a.op, familyOf()),
            ...(a.op === 'call-target'
              ? {
                  targets: {
                    before: a.before === null || a.before === '' ? null : target(a.before),
                    after: target(a.after),
                  },
                }
              : {}),
            readers,
          };
        });
        const { format, since: _since, ...filter } = query;
        return {
          filename: changeListFilename(project.key, filter, since, format),
          contentType:
            format === 'csv' ? 'text/csv; charset=utf-8' : 'text/markdown; charset=utf-8',
          body:
            format === 'csv'
              ? renderChangeListCsv(entries)
              : renderChangeListMarkdown(entries, {
                  projectName: project.name,
                  projectKey: project.key,
                  seq: project.lastSeq,
                  filter,
                  since,
                }),
        };
      });
    },
  };
}

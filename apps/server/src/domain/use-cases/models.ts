import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_FILES,
  MAX_MODEL_BYTES,
  MAX_RESULT_WARNINGS,
  MAX_RESULT_WARNING_CHARS,
  createProblem,
  isModelKey,
  modelKeyFromPath,
  type ExtractWarning,
  type ImportFileOutcome,
  type ImportResult,
  type Model,
  type ModelId,
  type ModelPage,
  type ModelStage,
  type PageQuery,
  type PutModelResult,
  type RevisionFacts,
  type RevisionId,
  type RevisionPage,
  type RevisionSource,
} from '@analyzr/contracts';

import type { Actor } from '../actor.ts';
import { decodeCursor, toPage } from '../cursor.ts';
import { DomainError } from '../errors.ts';
import { deleteModel, ingest, type IngestDeps, type IngestFile } from '../ingest.ts';
import { policy } from '../policy.ts';
import type { Tx } from '../ports.ts';
import { toModel, toRevision } from '../views.ts';
import type { UseCaseDeps } from './deps.ts';

export interface UploadFile {
  /** Path below the import root, e.g. `finanzen/rechnungsstellung.bpmn`. */
  path: string;
  bytes: Uint8Array;
}

export interface ModelXml {
  modelKey: string;
  modelId: ModelId;
  revisionId: RevisionId;
  rev: number;
  /** The revision's bytes decoded as UTF-8. */
  xml: string;
}

/** `text` cut to `max` UTF-16 code units, ending in `…`, without splitting a surrogate pair. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max - 1;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--;
  return `${text.slice(0, end)}…`;
}

/**
 * The extractor's warnings as an import or PUT result carries them (M6 S1):
 * the first {@link MAX_RESULT_WARNINGS} in the extractor's order, each
 * message cut to {@link MAX_RESULT_WARNING_CHARS} characters (bpmn-moddle
 * messages embed line, column and nested errors), plus the full count.
 * When the extractor ended with its `too-many-warnings` entry ("N more
 * warnings omitted", after 100), that entry stays the last one listed (after
 * the first 19), so the result still tells how many the extractor dropped.
 * Nothing at all without warnings, so warning-free results keep their shape.
 */
export function resultWarnings(
  warnings: readonly ExtractWarning[],
): Pick<ImportFileOutcome, 'warnings' | 'warningCount'> {
  if (warnings.length === 0) return {};
  const last = warnings.at(-1);
  const listed =
    warnings.length > MAX_RESULT_WARNINGS && last?.code === 'too-many-warnings'
      ? [...warnings.slice(0, MAX_RESULT_WARNINGS - 1), last]
      : warnings.slice(0, MAX_RESULT_WARNINGS);
  return {
    warnings: listed.map((w) => ({
      code: w.code.slice(0, 50),
      message: cut(w.message, MAX_RESULT_WARNING_CHARS),
      ...(w.elementId === undefined ? {} : { elementId: w.elementId.slice(0, 255) }),
    })),
    warningCount: warnings.length,
  };
}

async function liveModel(
  tx: Tx,
  projectId: Parameters<Tx['models']['findInProject']>[0],
  id: ModelId,
) {
  const model = await tx.models.findInProject(projectId, id);
  if (!model) throw new DomainError('not-found', 'model not found');
  return model;
}

export function modelUseCases(deps: UseCaseDeps, ingestDeps: IngestDeps) {
  return {
    /**
     * `PUT …/models/by-key/{key}`: raw BPMN → `created` (new model),
     * `revised` (new revision, both with the extractor's warnings, see
     * {@link resultWarnings}) or `unchanged` (same bytes as the head).
     *
     * @throws {DomainError} `validation-failed`, `payload-too-large`, `bpmn-invalid`, policy errors
     */
    async putModel(
      actor: Actor,
      projectRef: string,
      key: string,
      bytes: Uint8Array,
      source: RevisionSource = { kind: 'upload' },
    ): Promise<PutModelResult> {
      if (!isModelKey(key)) {
        throw new DomainError('validation-failed', `invalid model key: ${JSON.stringify(key)}`);
      }
      if (bytes.byteLength > MAX_MODEL_BYTES) {
        throw new DomainError(
          'payload-too-large',
          `a model may have at most ${MAX_MODEL_BYTES} bytes`,
        );
      }
      const { project, results } = await ingest(ingestDeps, actor, projectRef, [
        { key, bytes, source },
      ]);
      const result = results[0];
      if (!result) throw new Error('ingest returned no result');
      if (result.outcome === 'failed') throw result.error;
      const view = await deps.store.read((tx) => tx.models.view(project.id, result.model.id));
      if (!view) throw new Error(`model ${key} not found after ingest`);
      return {
        outcome: result.outcome,
        model: toModel(view),
        revision: toRevision(result.revision),
        ...resultWarnings(result.warnings),
      };
    },

    /**
     * `POST …/imports`: up to 50 files, 25 MB in total; the model key is the
     * slugified path (`modelKeyFromPath`; any file name is accepted). One
     * outcome per file; failed files do not stop the others. `created` and
     * `revised` files carry the extractor's warnings ({@link resultWarnings}).
     *
     * @throws {DomainError} `validation-failed` (no or too many files), `payload-too-large`, policy errors
     */
    async importFiles(
      actor: Actor,
      projectRef: string,
      files: readonly UploadFile[],
      sourceKind: RevisionSource['kind'] = 'import',
    ): Promise<ImportResult> {
      if (files.length === 0) throw new DomainError('validation-failed', 'no files');
      if (files.length > MAX_IMPORT_FILES) {
        throw new DomainError('validation-failed', `at most ${MAX_IMPORT_FILES} files per import`);
      }
      const total = files.reduce((n, f) => n + f.bytes.byteLength, 0);
      if (total > MAX_IMPORT_BYTES) {
        throw new DomainError(
          'payload-too-large',
          `an import may have at most ${MAX_IMPORT_BYTES} bytes`,
        );
      }

      const outcomes: ImportFileOutcome[] = [];
      const accepted: { index: number; file: IngestFile }[] = [];
      const seen = new Set<string>();
      for (const [index, f] of files.entries()) {
        const key = modelKeyFromPath(f.path);
        const fail = (code: 'validation-failed' | 'payload-too-large', detail: string) =>
          outcomes.push({
            path: f.path,
            modelKey: key,
            outcome: 'failed',
            problem: createProblem(code, detail),
          });
        if (!key) fail('validation-failed', 'the path gives no valid model key');
        else if (seen.has(key))
          fail('validation-failed', `another file of this import has model key ${key}`);
        else if (f.bytes.byteLength > MAX_MODEL_BYTES) {
          fail('payload-too-large', `a model may have at most ${MAX_MODEL_BYTES} bytes`);
        } else {
          seen.add(key);
          outcomes.push({ path: f.path, modelKey: key, outcome: 'unchanged', problem: null });
          accepted.push({
            index,
            file: { key, bytes: f.bytes, source: { kind: sourceKind, path: f.path } },
          });
        }
      }

      const { results } = await ingest(
        ingestDeps,
        actor,
        projectRef,
        accepted.map((a) => a.file),
      );
      for (const [i, a] of accepted.entries()) {
        const r = results[i];
        const outcome = outcomes[a.index];
        if (!r || !outcome) continue;
        if (r.outcome === 'failed') {
          outcome.outcome = 'failed';
          outcome.problem = createProblem(r.error.code, r.error.message, { ...r.error.extras });
        } else {
          outcome.outcome = r.outcome;
          Object.assign(outcome, resultWarnings(r.warnings));
        }
      }
      return { files: outcomes };
    },

    /** @throws {DomainError} `not-found`, policy errors */
    async deleteModel(actor: Actor, projectRef: string, modelId: ModelId): Promise<void> {
      await deleteModel(ingestDeps, actor, projectRef, modelId);
    },

    async listModels(
      actor: Actor,
      projectRef: string,
      query: PageQuery & { stage?: ModelStage | undefined },
    ): Promise<ModelPage> {
      const afterKey = query.cursor ? decodeCursor(query.cursor, ['string'])[0] : undefined;
      return deps.store.read(async (tx) => {
        const { project } = await policy.require(tx, actor, 'read', projectRef);
        const rows = await tx.models.list(project.id, {
          stage: query.stage,
          afterKey,
          limit: query.limit + 1,
        });
        const page = toPage(rows, query.limit, (m) => [m.key]);
        return { items: page.items.map(toModel), nextCursor: page.nextCursor };
      });
    },

    async getModel(actor: Actor, projectRef: string, modelId: ModelId): Promise<Model> {
      return deps.store.read(async (tx) => {
        const { project } = await policy.require(tx, actor, 'read', projectRef);
        const view = await tx.models.view(project.id, modelId);
        if (!view) throw new DomainError('not-found', 'model not found');
        return toModel(view);
      });
    },

    async listRevisions(
      actor: Actor,
      projectRef: string,
      modelId: ModelId,
      query: PageQuery,
    ): Promise<RevisionPage> {
      const beforeRev = query.cursor ? decodeCursor(query.cursor, ['number'])[0] : undefined;
      return deps.store.read(async (tx) => {
        const { project } = await policy.require(tx, actor, 'read', projectRef);
        await liveModel(tx, project.id, modelId);
        const rows = await tx.revisions.listForModel(project.id, modelId, {
          beforeRev,
          limit: query.limit + 1,
        });
        const page = toPage(rows, query.limit, (r) => [r.rev]);
        return { items: page.items.map(toRevision), nextCursor: page.nextCursor };
      });
    },

    /** The verbatim bytes of a revision. */
    /** The verbatim bytes of a revision, with its model key (for the download file name). */
    async getRevisionContent(
      actor: Actor,
      projectRef: string,
      modelId: ModelId,
      revisionId: RevisionId,
    ): Promise<{ bytes: Uint8Array; modelKey: string }> {
      return deps.store.read(async (tx) => {
        const { project } = await policy.require(tx, actor, 'read', projectRef);
        const model = await liveModel(tx, project.id, modelId);
        const bytes = await tx.revisions.content(project.id, modelId, revisionId);
        if (!bytes) throw new DomainError('not-found', 'revision not found');
        return { bytes, modelKey: model.key };
      });
    },

    async getRevisionFacts(
      actor: Actor,
      projectRef: string,
      modelId: ModelId,
      revisionId: RevisionId,
    ): Promise<RevisionFacts> {
      return deps.store.read(async (tx) => {
        const { project } = await policy.require(tx, actor, 'read', projectRef);
        await liveModel(tx, project.id, modelId);
        const facts = await tx.revisions.facts(project.id, modelId, revisionId);
        if (!facts) throw new DomainError('not-found', 'revision not found');
        return { ...facts, revisionId };
      });
    },

    /** MCP `get_model_xml`: the head (or a given revision) of a model by key. */
    async getModelXml(
      actor: Actor,
      projectRef: string,
      modelKey: string,
      revisionId?: RevisionId,
    ): Promise<ModelXml> {
      return deps.store.read(async (tx) => {
        const { project } = await policy.require(tx, actor, 'read', projectRef);
        const model = await tx.models.findByKey(project.id, modelKey);
        if (!model || model.deletedSeq !== null || !model.headRevisionId) {
          throw new DomainError('not-found', `model ${modelKey} not found`);
        }
        const id = revisionId ?? model.headRevisionId;
        const revision = await tx.revisions.findInProject(project.id, model.id, id);
        const bytes = revision ? await tx.revisions.content(project.id, model.id, id) : null;
        if (!revision || !bytes) throw new DomainError('not-found', 'revision not found');
        return {
          modelKey,
          modelId: model.id,
          revisionId: revision.id,
          rev: revision.rev,
          xml: new TextDecoder('utf-8').decode(bytes),
        };
      });
    },
  };
}

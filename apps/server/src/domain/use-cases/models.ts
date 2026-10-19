import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_FILES,
  MAX_MODEL_BYTES,
  MAX_RESULT_WARNINGS,
  createProblem,
  isModelKey,
  modelKeyFromPath,
  type ExternalIdList,
  type ExtractWarning,
  type ImportFileOutcome,
  type ImportImpact,
  type ImportResult,
  type Model,
  type ModelId,
  type ModelPage,
  type ModelStage,
  type ManifestFile,
  type PageQuery,
  type PutModelDryRunResult,
  type PutModelResult,
  type RevisionFacts,
  type RevisionId,
  type RevisionPage,
  type RevisionSource,
} from '@analyzr/contracts';

import type { Actor } from '../actor.ts';
import { decodeCursor, toPage } from '../cursor.ts';
import { DomainError } from '../errors.ts';
import {
  contentHash,
  deleteModel,
  deletionImpact,
  ingest,
  previewIngest,
  type IngestDeps,
  type IngestFile,
} from '../ingest.ts';
import { policy } from '../policy.ts';
import {
  externalIdEntries,
  identityWarnings,
  parseManifest,
  shaMismatch,
  uploadedSource,
  type IdentityCandidate,
  type ReceivedManifest,
} from '../provenance.ts';
import type { Tx } from '../ports.ts';
import { trustKeptWarning } from '../trust.ts';
import { toModel, toRevision } from '../views.ts';
import { cutWarning } from '../warnings.ts';
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

/**
 * The extractor's warnings as an import or PUT result carries them (M6 S1):
 * the first {@link MAX_RESULT_WARNINGS} in the extractor's order, each
 * message cut to `MAX_RESULT_WARNING_CHARS` characters (bpmn-moddle
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
  return { warnings: listed.map(cutWarning), warningCount: warnings.length };
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

/**
 * The one file a PUT's manifest lists (M6 S2a): exactly one entry, whose
 * pinned key, if any, is the key of the PUT.
 *
 * @throws {DomainError} `validation-failed` with `reason: 'invalid-manifest'`
 */
function onlyEntry(received: ReceivedManifest, key: string): ManifestFile {
  const [entry, ...rest] = received.manifest.files;
  if (!entry || rest.length > 0) {
    throw new DomainError(
      'validation-failed',
      'invalid manifest: the manifest of a PUT lists exactly one file',
      { reason: 'invalid-manifest' },
    );
  }
  if (entry.key !== undefined && entry.key !== key) {
    throw new DomainError(
      'validation-failed',
      `invalid manifest: it pins the key ${entry.key}, not ${key}`,
      { reason: 'invalid-manifest' },
    );
  }
  return entry;
}

/**
 * The live models' provenance sources before an import (M6 §3.4,
 * `uploadedSources`), for the identity warnings and `provenance-kept`;
 * checks `write` as the import will (`read` for a dry run).
 */
async function uploadedHeads(
  deps: UseCaseDeps,
  actor: Actor,
  projectRef: string,
  permission: 'read' | 'write' = 'write',
): Promise<Map<string, RevisionSource>> {
  return deps.store.read(async (tx) => {
    const { project } = await policy.require(tx, actor, permission, projectRef);
    return tx.revisions.uploadedSources(project.id);
  });
}

/** What a dry run needs of a manifest for the absent keys (M6 §3.5): its system, scope and keys. */
function bundleOf(received: ReceivedManifest | undefined) {
  if (!received) return null;
  const { source, files } = received.manifest;
  return {
    system: source.system,
    scope: source.scope,
    keys: new Set(
      files.flatMap((f) => {
        const key = f.key ?? modelKeyFromPath(f.path);
        return key === null ? [] : [key];
      }),
    ),
  };
}

export function modelUseCases(deps: UseCaseDeps, ingestDeps: IngestDeps) {
  return {
    /**
     * `PUT …/models/by-key/{key}`: raw BPMN → `created` (new model),
     * `revised` (new revision, both with the extractor's warnings, see
     * {@link resultWarnings}) or `unchanged` (same bytes as the head, its
     * uploaded revision or an amended revision). For a model with live
     * amendments (M6 S5c-2) `revision` is the final head and the result
     * carries `amendments` (and `uploadedRevisionId` when the head is amended).
     * An optional one-file manifest (M6 S2a, the header `Analyzr-Manifest`)
     * declares the provenance of the uploaded revision; its warnings are
     * `importWarnings`.
     *
     * @throws {DomainError} `validation-failed` (also `invalid-manifest`), `payload-too-large`, `bpmn-invalid`, policy errors
     */
    async putModel(
      actor: Actor,
      projectRef: string,
      key: string,
      bytes: Uint8Array,
      options: { manifest?: Uint8Array; dryRun?: boolean } = {},
    ): Promise<PutModelResult | PutModelDryRunResult> {
      if (!isModelKey(key)) {
        throw new DomainError('validation-failed', `invalid model key: ${JSON.stringify(key)}`);
      }
      if (bytes.byteLength > MAX_MODEL_BYTES) {
        throw new DomainError(
          'payload-too-large',
          `a model may have at most ${MAX_MODEL_BYTES} bytes`,
        );
      }
      const received = options.manifest === undefined ? undefined : parseManifest(options.manifest);
      const entry = received ? onlyEntry(received, key) : undefined;
      const source = uploadedSource(
        actor,
        { kind: 'upload', ...(entry ? { path: entry.path } : {}) },
        received,
        entry,
      );
      // The live models' provenance before the PUT, only when the manifest lists the file.
      const heads = entry
        ? await uploadedHeads(deps, actor, projectRef, options.dryRun ? 'read' : 'write')
        : null;
      if (options.dryRun) {
        const preview = await previewIngest(
          ingestDeps,
          actor,
          projectRef,
          [{ key, bytes, source }],
          bundleOf(received),
        );
        const r = preview.results[0];
        if (!r) throw new Error('previewIngest returned no result');
        if (r.outcome === 'failed') throw r.error;
        const warned = [
          shaMismatch(entry, contentHash(bytes)),
          ...(heads
            ? (identityWarnings([{ key, source, stored: r.outcome !== 'unchanged' }], heads)[0] ??
              [])
            : []),
          r.outcome === 'unchanged' ? trustKeptWarning(r.trust.stored, r.trust.incoming) : null,
        ].filter((w) => w !== null);
        return {
          outcome: r.outcome,
          modelKey: key,
          dryRun: true,
          ...resultWarnings(r.warnings),
          ...(r.amendments ? { amendments: r.amendments } : {}),
          ...(warned.length > 0 ? { importWarnings: warned } : {}),
          impact: preview.impact,
        };
      }
      const { project, results } = await ingest(ingestDeps, actor, projectRef, [
        { key, bytes, source },
      ]);
      const result = results[0];
      if (!result) throw new Error('ingest returned no result');
      if (result.outcome === 'failed') throw result.error;
      const view = await deps.store.read((tx) => tx.models.view(project.id, result.model.id));
      if (!view) throw new Error(`model ${key} not found after ingest`);
      const stored = result.outcome !== 'unchanged';
      const warnings = [
        shaMismatch(entry, contentHash(bytes)),
        ...(heads ? (identityWarnings([{ key, source, stored }], heads)[0] ?? []) : []),
        stored ? null : trustKeptWarning(result.trust.stored, result.trust.incoming),
      ].filter((w) => w !== null);
      return {
        outcome: result.outcome,
        model: toModel(view),
        revision: toRevision(result.revision),
        ...(result.uploadedRevision ? { uploadedRevisionId: result.uploadedRevision.id } : {}),
        ...resultWarnings(result.warnings),
        ...(result.amendments ? { amendments: result.amendments } : {}),
        ...(warnings.length > 0 ? { importWarnings: warnings } : {}),
      };
    },

    /**
     * `POST …/imports`: up to 50 files, 25 MB in total; the model key is the
     * key the manifest pins (M6 S2a), else the slugified path
     * (`modelKeyFromPath`; any file name is accepted). One outcome per file;
     * failed files do not stop the others. `created` and `revised` files
     * carry the extractor's warnings ({@link resultWarnings}). A file the
     * manifest lists gets its declared provenance on its uploaded revision,
     * and its warnings against the manifest and the landscape as
     * `importWarnings` (a checksum mismatch also on a failed file).
     *
     * @throws {DomainError} `validation-failed` (no or too many files, `invalid-manifest`), `payload-too-large`, policy errors
     */
    async importFiles(
      actor: Actor,
      projectRef: string,
      files: readonly UploadFile[],
      options: { manifest?: Uint8Array; dryRun?: boolean } = {},
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
      const received = options.manifest === undefined ? undefined : parseManifest(options.manifest);

      const outcomes: ImportFileOutcome[] = [];
      const accepted: { index: number; entry: ManifestFile | undefined; file: IngestFile }[] = [];
      const seen = new Set<string>();
      for (const [index, f] of files.entries()) {
        const entry = received?.byPath.get(f.path);
        const key = entry?.key ?? modelKeyFromPath(f.path);
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
            entry,
            file: {
              key,
              bytes: f.bytes,
              source: uploadedSource(actor, { kind: 'import', path: f.path }, received, entry),
            },
          });
        }
      }

      // The live models' provenance before the import, only when the manifest lists a file.
      const heads = accepted.some((a) => a.entry !== undefined)
        ? await uploadedHeads(deps, actor, projectRef, options.dryRun ? 'read' : 'write')
        : null;
      // A dry run (M6 §3.5) answers the same outcomes and the impact, and writes nothing.
      const preview = options.dryRun
        ? await previewIngest(
            ingestDeps,
            actor,
            projectRef,
            accepted.map((a) => a.file),
            bundleOf(received),
          )
        : null;
      const { results } =
        preview ??
        (await ingest(
          ingestDeps,
          actor,
          projectRef,
          accepted.map((a) => a.file),
        ));
      const candidates: { at: number; candidate: IdentityCandidate }[] = [];
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
          // Only for a model with live amendments (M6 S5c-2): other results keep their shape.
          if (r.amendments) outcome.amendments = r.amendments;
          // Only for a derived model (M6 S2c), so a corpus result keeps its shape.
          if (r.trust.stored?.class === 'derived') outcome.trust = r.trust.stored;
          candidates.push({
            at: a.index,
            candidate: {
              key: a.file.key,
              source: a.file.source,
              stored: r.outcome !== 'unchanged',
            },
          });
        }
        const mismatch = shaMismatch(a.entry, contentHash(a.file.bytes));
        if (mismatch) outcome.importWarnings = [mismatch];
      }
      if (heads) {
        const warned = identityWarnings(
          candidates.map((c) => c.candidate),
          heads,
        );
        for (const [i, c] of candidates.entries()) {
          const outcome = outcomes[c.at];
          const list = warned[i] ?? [];
          if (outcome && list.length > 0) {
            outcome.importWarnings = [...(outcome.importWarnings ?? []), ...list];
          }
        }
      }
      // Unchanged bytes keep their class (M6 S2c); the warning comes last.
      for (const [i, a] of accepted.entries()) {
        const r = results[i];
        const outcome = outcomes[a.index];
        if (!r || !outcome || r.outcome !== 'unchanged') continue;
        const kept = trustKeptWarning(r.trust.stored, r.trust.incoming);
        if (kept) outcome.importWarnings = [...(outcome.importWarnings ?? []), kept];
      }
      return { files: outcomes, ...(preview ? { impact: preview.impact } : {}) };
    },

    /**
     * `GET …/models/{m}/deletion-impact` (M6 §3.5): what deleting the model
     * would change, nothing deleted; permission `read`.
     *
     * @throws {DomainError} `not-found`, policy errors
     */
    async getModelDeletionImpact(
      actor: Actor,
      projectRef: string,
      modelId: ModelId,
    ): Promise<ImportImpact> {
      return deletionImpact(ingestDeps, actor, projectRef, modelId);
    },

    /**
     * `GET …/external-ids?system=` (M6 §3.4): the source-system identity of
     * every live model whose uploaded head declares a system, for rebuilding
     * a key map.
     */
    async listExternalIds(
      actor: Actor,
      projectRef: string,
      query: { system?: string | undefined },
    ): Promise<ExternalIdList> {
      return deps.store.read(async (tx) => {
        const { project } = await policy.require(tx, actor, 'read', projectRef);
        return {
          items: externalIdEntries(await tx.revisions.uploadedSources(project.id), query.system),
        };
      });
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

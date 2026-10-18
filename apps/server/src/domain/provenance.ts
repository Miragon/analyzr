/**
 * Typed provenance on uploaded revisions and stable identity (M6 §3.2–§3.4,
 * slice S2a), pure: the manifest an import or PUT carries (`analyzr-import/1`)
 * parsed and checked, the `source` of an uploaded revision built from it
 * (server fields `uploader` and `manifestSha256`, the rest as declared, the
 * informational fields tidied), the warnings about a file against its
 * manifest (`manifest-sha-mismatch`) and the landscape (`external-id-moved`,
 * `external-id-changed`, `provenance-kept`), and the identities `GET
 * …/external-ids` lists. Readers take a model's provenance from
 * `RevisionRepo.uploadedSources`: its head's uploaded revision (an amended
 * head's `source.upstream`), or, when that was stored without a manifest, the
 * newest revision that had one, so an upload without a manifest never erases
 * a declared identity. Provenance never enters facts or `facts_hash`.
 */
import { createHash } from 'node:crypto';

import {
  ImportManifest,
  MAX_MANIFEST_BYTES,
  MAX_WARNING_OTHER_KEYS,
  tidyDeclared,
  type ExternalIdEntry,
  type ExternalIdentity,
  type ImportWarning,
  type ManifestDerived,
  type ManifestFile,
  type ModelSourceSummary,
  type RevisionSource,
} from '@analyzr/contracts';

import { sourceKindOf, type Actor } from './actor.ts';
import { DomainError } from './errors.ts';
import { cutText } from './warnings.ts';

/** A manifest as the server received it: parsed, its bytes' SHA-256, its files by path. */
export interface ReceivedManifest {
  manifest: ImportManifest;
  /** SHA-256 (hex) of the bytes received: `source.manifestSha256`. */
  sha256: string;
  byPath: ReadonlyMap<string, ManifestFile>;
}

function invalidManifest(detail: string): DomainError {
  return new DomainError('validation-failed', `invalid manifest: ${detail}`, {
    reason: 'invalid-manifest',
  });
}

/**
 * Parses the bytes of a manifest (UTF-8 JSON, a leading byte order mark
 * allowed) and checks it against `ImportManifest`.
 *
 * @throws {DomainError} `validation-failed` with `reason: 'invalid-manifest'`
 *   naming the first problems
 */
export function parseManifest(bytes: Uint8Array): ReceivedManifest {
  if (bytes.byteLength > MAX_MANIFEST_BYTES) {
    throw invalidManifest(`at most ${MAX_MANIFEST_BYTES} bytes`);
  }
  let value: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    value = JSON.parse(text);
  } catch {
    throw invalidManifest('not UTF-8 JSON');
  }
  const parsed = ImportManifest.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.length > 0 ? `${i.path.join('.')}: ` : ''}${i.message}`);
    throw invalidManifest(cutText(issues.join('; '), 500));
  }
  return {
    manifest: parsed.data,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byPath: new Map(parsed.data.files.map((f) => [f.path, f])),
  };
}

/** `derived` as stored: `converter` and `llmModel` tidied ({@link tidyDeclared}), present as declared. */
function tidyDerived(d: ManifestDerived): ManifestDerived {
  return {
    ...d,
    ...(d.converter === undefined ? {} : { converter: tidyDeclared(d.converter) }),
    ...(d.llmModel === undefined ? {} : { llmModel: tidyDeclared(d.llmModel) }),
  };
}

/**
 * The `source` of an uploaded revision (M6 §3.3): `kind` and `path` as
 * before, `uploader` from the credential (`sourceKindOf`), and for a file the
 * manifest lists `manifestSha256` plus the declared fields, nulls left out;
 * the informational ones (`systemVersion`, `externalPath`, `derived`'s
 * `converter` and `llmModel`) tidied, so an empty one is left out too. A file
 * the manifest does not list gets no declared fields.
 */
export function uploadedSource(
  actor: Actor,
  base: { kind: 'upload' | 'import'; path?: string },
  received?: ReceivedManifest,
  entry?: ManifestFile,
): RevisionSource {
  const source: RevisionSource = {
    kind: base.kind,
    ...(base.path === undefined ? {} : { path: base.path }),
    uploader: sourceKindOf(actor),
  };
  if (!received || !entry) return source;
  const declared = received.manifest.source;
  const systemVersion = tidyDeclared(declared.systemVersion);
  const externalPath = tidyDeclared(entry.externalPath);
  return {
    ...source,
    manifestSha256: received.sha256,
    system: declared.system,
    ...(systemVersion === null ? {} : { systemVersion }),
    ...(declared.exportedAt == null ? {} : { exportedAt: declared.exportedAt }),
    ...(declared.importer == null ? {} : { importer: declared.importer }),
    ...(declared.scope === undefined ? {} : { scope: declared.scope }),
    ...(entry.externalId == null ? {} : { externalId: entry.externalId }),
    ...(externalPath === null ? {} : { externalPath }),
    ...(entry.url == null ? {} : { url: entry.url }),
    ...(entry.derived === undefined ? {} : { derived: tidyDerived(entry.derived) }),
    ...(entry.losses === undefined || entry.losses.length === 0 ? {} : { losses: entry.losses }),
  };
}

/**
 * True if a manifest declared the source: only such a source has a `system`
 * (required in a manifest) and `manifestSha256`.
 */
export function isDeclared(source: RevisionSource | undefined): boolean {
  return source?.system !== undefined;
}

/**
 * A model's provenance in short (`Model.source`, UX8): the system, the
 * derivation and the export date its head declares. An amended head
 * declares none of its own (M6 S5c-2), so its uploaded revision `upstream`
 * speaks for it. `null` without a declared system.
 */
export function sourceSummary(
  head: RevisionSource,
  upstream: RevisionSource | null,
): ModelSourceSummary | null {
  const declared = head.kind === 'amendment' ? upstream : head;
  if (declared?.system === undefined) return null;
  return {
    system: declared.system,
    derived: declared.derived?.kind ?? null,
    exportedAt: declared.exportedAt ?? null,
  };
}

/** `(system, externalId)` of a source, or `null` when it lacks either (no manifest, an as-told draft). */
export function identityOf(source: RevisionSource | undefined): ExternalIdentity | null {
  if (source?.system === undefined || source.externalId === undefined) return null;
  return { system: source.system, externalId: source.externalId };
}

const identityKey = (id: ExternalIdentity): string => `${id.system}\0${id.externalId}`;
const sameIdentity = (a: ExternalIdentity, b: ExternalIdentity): boolean =>
  a.system === b.system && a.externalId === b.externalId;
const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `manifest-sha-mismatch` when the manifest declares a `sha256` the bytes do not have. */
export function shaMismatch(
  entry: ManifestFile | undefined,
  contentHash: string,
): ImportWarning | null {
  if (entry?.sha256 === undefined || entry.sha256 === contentHash) return null;
  return {
    code: 'manifest-sha-mismatch',
    message: `the file's sha256 ${contentHash.slice(0, 12)}… differs from the manifest's ${entry.sha256.slice(0, 12)}…; imported anyway`,
    manifestSha256: entry.sha256,
    fileSha256: contentHash,
  };
}

/** One file of a request as the identity check sees it, in request order. */
export interface IdentityCandidate {
  key: string;
  /** The `source` the file declares (and its new revision carries, when stored). */
  source: RevisionSource;
  /** True when the file became its model's head (`created` or `revised`). */
  stored: boolean;
}

/** The fields `provenance-kept` compares: where the model lives in its source tool. */
const KEPT_FIELDS = [
  ['system', 'system'],
  ['externalId', 'tool id'],
  ['externalPath', 'tool folder'],
  ['url', 'link'],
] as const;

/**
 * `provenance-kept` for an unchanged file whose manifest entry declares
 * another place in the source tool than the provenance analyzr keeps for the
 * model (`kept`), or when analyzr keeps none; `null` when they agree.
 */
function keptWarning(
  kept: RevisionSource | undefined,
  incoming: RevisionSource,
): ImportWarning | null {
  const id = identityOf(incoming);
  const fields = {
    ...(incoming.system === undefined ? {} : { system: incoming.system }),
    ...(id === null ? {} : { externalId: id.externalId }),
  };
  if (!isDeclared(kept)) {
    return {
      code: 'provenance-kept',
      message:
        'unchanged, so analyzr keeps what it has for this model: no declared provenance ' +
        '(stored without a manifest); a correction needs changed bytes',
      ...fields,
    };
  }
  const differences = KEPT_FIELDS.flatMap(([field, label]) => {
    const before = kept?.[field];
    const now = incoming[field];
    return before === now ? [] : [`${label} ${before ?? '-'} (this file: ${now ?? '-'})`];
  });
  if (differences.length === 0) return null;
  return {
    code: 'provenance-kept',
    message: cutText(
      `unchanged, so analyzr keeps its provenance: ${differences.join(', ')}; ` +
        'a correction needs changed bytes',
      500,
    ),
    ...fields,
  };
}

/**
 * The identity warnings of a request's files (M6 §3.4), in order; the files
 * of the request that failed are left out by the caller. `heads` are the
 * live models' provenance sources before the request (`uploadedSources`).
 *
 * - `external-id-moved`: the incoming `(system, externalId)` already belongs
 *   to another live key, before the request or through an earlier stored file
 *   of it (a likely rename or move in the tool);
 * - `external-id-changed`: the key's head carried another `(system,
 *   externalId)`, both present; a head without a tool id (an as-told draft)
 *   never triggers it;
 * - `provenance-kept`: an unchanged file the manifest lists declares another
 *   system, tool id, tool folder or link than analyzr keeps, or analyzr keeps
 *   none (§3.3: identical bytes keep their first provenance); not next to
 *   `external-id-changed`.
 *
 * A file without both a system and a tool id gets neither identity warning.
 * A stored file without a manifest leaves its key's identity as it was (the
 * readers fall back to the newest declared revision).
 */
export function identityWarnings(
  files: readonly IdentityCandidate[],
  heads: ReadonlyMap<string, RevisionSource>,
): ImportWarning[][] {
  const current = new Map<string, ExternalIdentity>();
  const holders = new Map<string, Set<string>>();
  for (const [key, source] of heads) {
    const id = identityOf(source);
    if (id === null) continue;
    current.set(key, id);
    const set = holders.get(identityKey(id)) ?? new Set<string>();
    set.add(key);
    holders.set(identityKey(id), set);
  }
  const before = new Map(current);
  return files.map((f) => {
    const incoming = identityOf(f.source);
    const warnings: ImportWarning[] = [];
    if (incoming !== null) {
      const others = [...(holders.get(identityKey(incoming)) ?? [])]
        .filter((k) => k !== f.key)
        .sort(byCodePoint);
      const [first] = others;
      if (first !== undefined) {
        const more = others.length > 1 ? ` and ${others.length - 1} more` : '';
        const consequence = f.stored
          ? 'two models now carry it'
          : 'this unchanged file declares it too';
        warnings.push({
          code: 'external-id-moved',
          message: cutText(
            `${incoming.system} id ${incoming.externalId} already belongs to ${first}${more}: ` +
              `${consequence} (moved or renamed in the tool?)`,
            500,
          ),
          system: incoming.system,
          externalId: incoming.externalId,
          otherKeys: others.slice(0, MAX_WARNING_OTHER_KEYS),
        });
      }
      const previous = before.get(f.key);
      if (previous !== undefined && !sameIdentity(previous, incoming)) {
        warnings.push({
          code: 'external-id-changed',
          message: cutText(
            f.stored
              ? `this file (${incoming.system} id ${incoming.externalId}) revised ${f.key}, ` +
                  `which held ${previous.system} id ${previous.externalId}`
              : `${f.key} holds ${previous.system} id ${previous.externalId}; this unchanged ` +
                  `file declares ${incoming.system} id ${incoming.externalId}`,
            500,
          ),
          system: incoming.system,
          externalId: incoming.externalId,
          previous,
        });
      }
    }
    const changed = warnings.some((w) => w.code === 'external-id-changed');
    if (!f.stored && isDeclared(f.source) && !changed) {
      const kept = keptWarning(heads.get(f.key), f.source);
      if (kept) warnings.push(kept);
    }
    if (f.stored && isDeclared(f.source)) {
      const old = current.get(f.key);
      if (old !== undefined) holders.get(identityKey(old))?.delete(f.key);
      if (incoming === null) current.delete(f.key);
      else {
        current.set(f.key, incoming);
        const set = holders.get(identityKey(incoming)) ?? new Set<string>();
        set.add(f.key);
        holders.set(identityKey(incoming), set);
      }
    }
    return warnings;
  });
}

/**
 * The identities of `GET …/external-ids` (M6 §3.4): every live model whose
 * provenance source (`uploadedSources`: the uploaded head, or the newest
 * revision with a manifest) declares a source system (`system` keeps one),
 * with its tool id and folder (`null` when not declared), sorted by key.
 */
export function externalIdEntries(
  sources: ReadonlyMap<string, RevisionSource>,
  system?: string,
): ExternalIdEntry[] {
  return [...sources]
    .filter(([, s]) => s.system !== undefined && (system === undefined || s.system === system))
    .sort(([a], [b]) => byCodePoint(a, b))
    .map(([key, s]) => ({
      key,
      system: s.system ?? '',
      externalId: s.externalId ?? null,
      externalPath: s.externalPath ?? null,
    }));
}

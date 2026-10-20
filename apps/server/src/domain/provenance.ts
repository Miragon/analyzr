/**
 * Typed provenance on uploaded revisions and stable identity (M6 §3.2–§3.4,
 * slice S2a), pure: the manifest an import or PUT carries (`analyzr-import/1`)
 * parsed and checked, the `source` of an uploaded revision built from it
 * (server fields `uploader` and `manifestSha256`, the rest as declared, the
 * informational fields tidied), the warnings about a file against its
 * manifest (`manifest-sha-mismatch`) and the landscape (`external-id-moved`,
 * `external-id-changed`, `provenance-kept`), and the identities `GET
 * …/external-ids` lists. Since M6 S2b follow-up step 5 (owner decision 29
 * (1)) where a model lives in its source tool (system, tool id, tool
 * folder, link) is its newest identity row (`model_identity`), written by
 * every import or PUT whose manifest lists the file, also for unchanged
 * bytes whose declaration differs ({@link identityUpdate}); an upload
 * without a manifest writes none, so it never erases a declared identity.
 * Readers take a model's provenance from `RevisionRepo.uploadedSources`: the
 * identity from the newest row ({@link withIdentity}), everything else from
 * its head's uploaded revision (an amended head's `source.upstream`), which
 * keeps its first provenance. Provenance never enters facts or `facts_hash`.
 */
import { createHash } from 'node:crypto';

import {
  ImportManifest,
  MAX_IMPORT_WARNINGS,
  MAX_MANIFEST_BYTES,
  MAX_WARNING_OTHER_KEYS,
  tidyDeclared,
  type ExternalIdEntry,
  type ExternalIdentity,
  type ImportWarning,
  type ManifestDerived,
  type ManifestFile,
  type ModelIdentity,
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

/** The identity a source declares (system, tool id, folder, link); `null` without a manifest entry. */
export function declaredIdentity(source: RevisionSource | undefined): ModelIdentity | null {
  if (source?.system === undefined) return null;
  return {
    system: source.system,
    externalId: source.externalId ?? null,
    externalPath: source.externalPath ?? null,
    url: source.url ?? null,
  };
}

/** Whether two identities are the same declaration (all four fields, `null` for undeclared). */
export function sameModelIdentity(a: ModelIdentity, b: ModelIdentity): boolean {
  return (
    a.system === b.system &&
    a.externalId === b.externalId &&
    a.externalPath === b.externalPath &&
    a.url === b.url
  );
}

/**
 * The identity an unchanged file records (M6 S2b follow-up step 5): what its
 * manifest entry declares when that differs from the model's newest row (or
 * the model has none); `null` when the file declares nothing or the same.
 * The ingest and its dry run share it. A declaration replaces the identity
 * whole: an entry without a tool id, folder or link sets them `null`.
 */
export function identityUpdate(
  newest: ModelIdentity | null | undefined,
  source: RevisionSource,
): ModelIdentity | null {
  const declared = declaredIdentity(source);
  if (declared === null) return null;
  return newest && sameModelIdentity(newest, declared) ? null : declared;
}

/**
 * A provenance source with the model's newest identity row in place of
 * `system`, `externalId`, `externalPath` and `url` (absent where the row has
 * `null`, and all four absent without a row: identity is read from rows
 * only); every other field stays the uploaded revision's.
 */
export function withIdentity(
  source: RevisionSource,
  identity: ModelIdentity | null | undefined,
): RevisionSource {
  const { system: _system, externalId: _id, externalPath: _path, url: _url, ...rest } = source;
  if (!identity) return rest;
  return {
    ...rest,
    system: identity.system,
    ...(identity.externalId === null ? {} : { externalId: identity.externalId }),
    ...(identity.externalPath === null ? {} : { externalPath: identity.externalPath }),
    ...(identity.url === null ? {} : { url: identity.url }),
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
  /**
   * True for an unchanged file whose `trust-kept` (it follows) names the
   * derivation (`trustKeptNamesDerivation`: the class change comes from
   * it): that warning speaks for the derivation, so `provenance-kept` stays
   * silent. Not for one where only the credential differs.
   */
  trustKeptNamesDerivation?: boolean;
}

/**
 * What `provenance-kept` compares: the derivation owners' rules for derived
 * calls match (`derived.kind`, absent counted as its own kind `none`, and
 * the converter of a conversion).
 */
function derivationOf(s: RevisionSource | undefined): { kind: string; converter: string | null } {
  const kind = s?.derived?.kind ?? 'none';
  return { kind, converter: kind === 'converted' ? (s?.derived?.converter ?? null) : null };
}

/** `converted with normalize-bpmn@0.1.0`, `converted`, `export`, `reconstructed`, `none declared`. */
function derivationText(s: RevisionSource | undefined): string {
  const { kind, converter } = derivationOf(s);
  if (kind === 'none') return 'none declared';
  return converter === null ? kind : `${kind} with ${converter}`;
}

/**
 * `provenance-kept` for an unchanged file whose manifest entry declares
 * another derivation than the uploaded revision analyzr keeps for the model
 * (`kept`; identical bytes keep their first revision's provenance, while
 * their tool id, folder and link are recorded); `null` when they agree.
 */
function keptWarning(
  kept: RevisionSource | undefined,
  incoming: RevisionSource,
): ImportWarning | null {
  const [a, b] = [derivationOf(kept), derivationOf(incoming)];
  if (a.kind === b.kind && a.converter === b.converter) return null;
  const id = identityOf(incoming);
  return {
    code: 'provenance-kept',
    message: cutText(
      `unchanged, so its revision keeps the derivation ${derivationText(kept)} ` +
        `(this file: ${derivationText(incoming)}); tool id, folder and link go by this file; ` +
        'a correction needs changed bytes',
      500,
    ),
    ...(incoming.system === undefined ? {} : { system: incoming.system }),
    ...(id === null ? {} : { externalId: id.externalId }),
  };
}

/**
 * The identity warnings of a request's files (M6 §3.4), in order; the files
 * of the request that failed are left out by the caller. `heads` are the
 * live models' provenance sources before the request (`uploadedSources`:
 * the identity from the newest identity row, the rest from the uploaded
 * head).
 *
 * - `external-id-moved`: the incoming `(system, externalId)` already belongs
 *   to another live key, before the request or through an earlier file of it
 *   the manifest lists (a likely rename or move in the tool): two models now
 *   carry it;
 * - `external-id-changed`: the key's identity carried another `(system,
 *   externalId)`, both present; an identity without a tool id (an as-told
 *   draft) never triggers it;
 * - `provenance-kept`: an unchanged file the manifest lists declares another
 *   derivation than its revision keeps (§3.3: identical bytes keep their
 *   first provenance; their identity is recorded, M6 S2b follow-up step 5);
 *   never for a file whose `trust-kept` names the derivation
 *   (`trustKeptNamesDerivation`: that warning speaks for it), and dropped
 *   as a file's fifth warning ({@link withinWarningLimit}).
 *
 * A file without both a system and a tool id gets neither identity warning.
 * Every file the manifest lists, stored or unchanged, takes its identity in
 * the request's sequence, as the ingest records it; a file without a
 * manifest entry leaves its key's identity as it was.
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
        warnings.push({
          code: 'external-id-moved',
          message: cutText(
            `${incoming.system} id ${incoming.externalId} already belongs to ${first}${more}: ` +
              'two models now carry it (moved or renamed in the tool?)',
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
              : `this unchanged file (${incoming.system} id ${incoming.externalId}) now ` +
                  `identifies ${f.key}, which held ${previous.system} id ${previous.externalId}`,
            500,
          ),
          system: incoming.system,
          externalId: incoming.externalId,
          previous,
        });
      }
    }
    if (!f.stored && isDeclared(f.source) && f.trustKeptNamesDerivation !== true) {
      const kept = keptWarning(heads.get(f.key), f.source);
      if (kept) warnings.push(kept);
    }
    if (isDeclared(f.source)) {
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
 * A file's import warnings within {@link MAX_IMPORT_WARNINGS} (M6 S2b
 * follow-up step 5): only an unchanged file with all five,
 * `manifest-sha-mismatch`, both identity warnings, `provenance-kept` and a
 * `trust-kept` for another credential, has one too many; `provenance-kept`
 * goes then, while `trust-kept` says that this request's classification is
 * not taken.
 */
export function withinWarningLimit(warnings: readonly ImportWarning[]): ImportWarning[] {
  if (warnings.length <= MAX_IMPORT_WARNINGS) return [...warnings];
  return warnings.filter((w) => w.code !== 'provenance-kept').slice(0, MAX_IMPORT_WARNINGS);
}

/**
 * The identities of `GET …/external-ids` (M6 §3.4): every live model with a
 * declared identity (`uploadedSources`: its newest identity row, M6 S2b
 * follow-up step 5; `system` keeps one system), with its tool id and folder
 * (`null` when not declared), sorted by key.
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

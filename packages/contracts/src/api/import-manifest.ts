/**
 * The import bundle's manifest `analyzr-import.json` (M6 §3.2, slice S2a):
 * format `analyzr-import/1`, the provenance a converter declares for a
 * bundle (the source system, its version, the export date, the importer,
 * the tool folders a partial export covers) and per file the pinned model
 * key, the tool's model id and folder, an optional link, how the file was
 * derived, what a conversion lost and an optional checksum. The CLI reads it
 * from the import root and sends each batch's subset as the multipart part
 * `manifest`; `PUT …/models/by-key/{key}` takes a one-file manifest in the
 * header `Analyzr-Manifest`. The server, the CLI and the web validate it
 * with these schemas alike. Unknown fields and loss codes are accepted
 * (fields dropped, codes stored as declared), so a newer converter's manifest
 * stays importable; declared values are stored as declared on the uploaded
 * revision (`RevisionSource`), never checked beyond their shape (§3.3), and
 * stay out of facts and `facts_hash`. Identity fields (path, key, tool id,
 * link, scope) must be clean; purely informational ones (`systemVersion`,
 * `externalPath`, `converter`, `llmModel`) are tidied instead
 * ({@link tidyDeclared}), so an export's empty or odd attribute never refuses
 * a bundle.
 */
import { z } from 'zod';

import { ModelKey } from '../refs.ts';
import { orNull } from '../zod-utils.ts';
import { Sha256Hex } from './common.ts';

/** The manifest's file name at the bundle root. */
export const IMPORT_MANIFEST_FILE = 'analyzr-import.json';
/** The manifest's `format`. */
export const IMPORT_MANIFEST_FORMAT = 'analyzr-import/1';
/** Most files one manifest lists. */
export const MAX_MANIFEST_FILES = 10_000;
/** Most bytes of the `manifest` part of an import (the subset of one batch is far smaller). */
export const MAX_MANIFEST_BYTES = 1024 * 1024;
/**
 * Most characters of the `Analyzr-Manifest` header of a PUT (base64url of a
 * one-file manifest's UTF-8 JSON; Node's limit for all headers is 16 KiB).
 */
export const MAX_MANIFEST_HEADER_CHARS = 8192;
/** Most entries of a file's `losses`. */
export const MAX_MANIFEST_LOSSES = 20;
/** Most tool folders of `source.scope`. */
export const MAX_MANIFEST_SCOPE = 100;
/** Most opaque source ids of `derived.from`. */
export const MAX_DERIVED_FROM = 100;

/** Regex source of a source system: a lowercase slug such as `signavio`, `aris`, `bizagi`. */
export const SOURCE_SYSTEM_PATTERN = '[a-z0-9]+(?:-[a-z0-9]+)*';

/**
 * Control characters and lone UTF-16 surrogates (`\p{Cs}` matches only an
 * unpaired one in a `u` regex): PostgreSQL's jsonb holds neither U+0000 nor a
 * lone surrogate, and a path, id or link has no line breaks.
 */
const UNSTORABLE = /[\p{Cc}\p{Cs}]/u;

/**
 * A declared value that identifies something (a path, a tool id, a tool
 * folder of the scope, the importer): 1 to `max` characters without control
 * characters or lone surrogates. Refused, never changed, since it is matched
 * exactly.
 */
function declared(max: number) {
  return z
    .string()
    .min(1)
    .max(max)
    .refine(
      (value) => !UNSTORABLE.test(value),
      'must not contain control characters or lone surrogates',
    );
}

/**
 * A purely informational declared value (`systemVersion`, `externalPath`,
 * `converter`, `llmModel`): at most `max` characters, anything else allowed.
 * The server stores it tidied ({@link tidyDeclared}): an export's empty
 * `exporterVersion=""` or a character reference in a tool folder never
 * refuses the bundle.
 */
function informational(max: number) {
  return z.string().max(max);
}

/**
 * An informational declared value as analyzr stores it: lone surrogates
 * become U+FFFD, control characters spaces, the ends trimmed; `null` for
 * nothing left (and for `null` or absent).
 */
export function tidyDeclared(value: string | null | undefined): string | null {
  if (value == null) return null;
  const tidy = value
    .replace(/\p{Cs}/gu, '\uFFFD')
    .replace(/\p{Cc}/gu, ' ')
    .trim();
  return tidy === '' ? null : tidy;
}

/** The source system a bundle comes from (the key map's system name). */
export const SourceSystem = z
  .string()
  .max(64)
  .regex(
    new RegExp(`^${SOURCE_SYSTEM_PATTERN}$`),
    'must be a lowercase slug such as signavio or aris',
  )
  .meta({
    id: 'SourceSystem',
    description: 'Source system of a bundle: a lowercase slug such as `signavio` or `aris`.',
    example: 'signavio',
  });
export type SourceSystem = z.infer<typeof SourceSystem>;

const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * When the customer exported: an ISO 8601 date-time with `Z` or an offset,
 * seconds optional, as the integrate skill writes it (`2026-10-14T09:12:00Z`;
 * a bare date becomes midnight UTC there).
 */
export const ExportedAt = z
  .string()
  .max(40)
  .regex(ISO_DATE_TIME, 'must be an ISO 8601 date-time such as 2026-10-14T09:12:00Z')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'must be a valid date-time')
  .meta({ id: 'ExportedAt', description: 'ISO 8601 date-time of the export (declared).' });

/** The program that wrote the bundle, e.g. `analyzr-integrate/normalize-bpmn` `0.1.0`. */
export const ManifestImporter = z
  .object({ name: declared(100), version: declared(50) })
  .meta({ id: 'ManifestImporter', description: 'The program that wrote a bundle (declared).' });
export type ManifestImporter = z.infer<typeof ManifestImporter>;

/**
 * How a file was derived (M6 §3.2): `export` (the tool's own BPMN 2.0,
 * bytes unchanged), `converted` (deterministic code transformed it;
 * `converter` names it, `name@version` or `adhoc:<12 hex>`), `reconstructed`
 * (an LLM or vision model derived it; `llmModel` required) or `as-told` (from
 * interviews; `from` lists opaque source ids, never names).
 */
export const DerivedKind = z
  .enum(['export', 'converted', 'reconstructed', 'as-told'])
  .meta({ id: 'DerivedKind', description: 'How a file was derived (declared).' });
export type DerivedKind = z.infer<typeof DerivedKind>;

/** An opaque source id of `derived.from` (`src-…`): never a name or an excerpt. */
const SourceId = z
  .string()
  .regex(/^[A-Za-z0-9._:-]{1,64}$/, 'must be an opaque id ([A-Za-z0-9._:-], at most 64)');

export const ManifestDerived = z
  .object({
    kind: DerivedKind,
    converter: orNull(informational(120)).optional(),
    llmModel: orNull(informational(120)).optional(),
    from: z.array(SourceId).max(MAX_DERIVED_FROM).optional(),
  })
  .refine(
    (d) => d.kind !== 'reconstructed' || tidyDeclared(d.llmModel) !== null,
    'a reconstructed file names its llmModel',
  )
  .meta({ id: 'ManifestDerived', description: 'How a file was derived (declared).' });
export type ManifestDerived = z.infer<typeof ManifestDerived>;

/**
 * The loss codes analyzr knows (M6 §3.2, S3b): elements, attributes, links
 * to models outside the export or calls the renderer did not write,
 * generated or missing layout, rewritten ids, truncated texts.
 */
export const KNOWN_LOSS_CODES = [
  'element-dropped',
  'attribute-dropped',
  'link-unresolved',
  'layout-generated',
  'layout-missing',
  'id-rewritten',
  'text-truncated',
] as const;

/**
 * What a conversion dropped (counts only): one of {@link KNOWN_LOSS_CODES}
 * or a newer converter's code, a lowercase slug stored and shown as declared,
 * so a newer plugin's manifest stays importable.
 */
export const LossCode = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,49}$/, 'must be a lowercase slug such as element-dropped')
  .meta({
    id: 'LossCode',
    description: `What a conversion dropped: ${KNOWN_LOSS_CODES.join(', ')}, or a newer converter's code (a lowercase slug, stored as declared).`,
  });
export type LossCode = z.infer<typeof LossCode>;

export const ManifestLoss = z
  .object({ code: LossCode, count: z.number().int().min(0).max(1_000_000_000) })
  .meta({ id: 'ManifestLoss', description: 'What a conversion dropped, counted (declared).' });
export type ManifestLoss = z.infer<typeof ManifestLoss>;

/** True unless `value` is a URL with a user name or password. */
function withoutCredentials(value: string): boolean {
  try {
    const url = new URL(value);
    return url.username === '' && url.password === '';
  } catch {
    return true;
  }
}

/**
 * An http(s) link into the source tool (declared, checked for its scheme
 * only), without control characters or lone surrogates, and without
 * credentials (`https://user:secret@…`): it is stored for good on the
 * append-only revision and shown in the change list.
 */
const HttpUrl = z
  .url({ protocol: /^https?$/ })
  .max(2048)
  .refine(
    (value) => !UNSTORABLE.test(value),
    'must not contain control characters or lone surrogates',
  )
  .refine(withoutCredentials, 'must not contain a user name or password');

/** The bundle's provenance (declared). */
export const ManifestSource = z.object({
  system: SourceSystem,
  /** The tool's version (informational; an empty export attribute is stored as absent). */
  systemVersion: orNull(informational(100)).optional(),
  exportedAt: orNull(ExportedAt).optional(),
  importer: orNull(ManifestImporter).optional(),
  /** Tool folders a partial export covers (absent: the whole system). */
  scope: z.array(declared(1024)).max(MAX_MANIFEST_SCOPE).optional(),
});
export type ManifestSource = z.infer<typeof ManifestSource>;

/** One model file of the bundle. */
export const ManifestFile = z.object({
  /** Below the bundle root, `/`-separated: the multipart file name. */
  path: declared(1024),
  /** The pinned model key; without it the path decides. */
  key: ModelKey.optional(),
  /** The tool's model id, opaque (`null`: none; the tool path identifies the model). */
  externalId: orNull(declared(255)).optional(),
  /** Folder and name in the tool (informational, stored tidied). */
  externalPath: orNull(informational(1024)).optional(),
  /** A link into the source tool, http(s) only. */
  url: orNull(HttpUrl).optional(),
  derived: ManifestDerived.optional(),
  losses: z.array(ManifestLoss).max(MAX_MANIFEST_LOSSES).optional(),
  /** SHA-256 of the file's bytes; a mismatch is the warning `manifest-sha-mismatch`, the file is imported. */
  sha256: Sha256Hex.optional(),
});
export type ManifestFile = z.infer<typeof ManifestFile>;

/**
 * `analyzr-import.json`: the bundle's provenance and its files. Paths and
 * pinned keys are unique. `valueChain` and `inventory` name the bundle's
 * process map and inventory, which are never sent with the models.
 */
export const ImportManifest = z
  .object({
    format: z.literal(IMPORT_MANIFEST_FORMAT),
    source: ManifestSource,
    files: z.array(ManifestFile).max(MAX_MANIFEST_FILES),
    valueChain: z.object({ path: declared(1024), derived: ManifestDerived.optional() }).optional(),
    inventory: z.object({ path: declared(1024) }).optional(),
  })
  .superRefine((m, ctx) => {
    const paths = new Set<string>();
    const keys = new Set<string>();
    for (const [i, f] of m.files.entries()) {
      if (paths.has(f.path)) {
        ctx.addIssue({
          code: 'custom',
          path: ['files', i, 'path'],
          message: `path ${f.path} twice`,
        });
      }
      paths.add(f.path);
      if (f.key === undefined) continue;
      if (keys.has(f.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['files', i, 'key'],
          message: `key ${f.key} pinned twice`,
        });
      }
      keys.add(f.key);
    }
  });
export type ImportManifest = z.infer<typeof ImportManifest>;

/**
 * A warning about one file of an import or PUT against its manifest or the
 * landscape (M6 §3.2, §3.4); the file is imported all the same:
 * - `manifest-sha-mismatch`: the file's SHA-256 differs from the manifest's
 *   `sha256` (`manifestSha256` declared, `fileSha256` received);
 * - `external-id-moved`: the same `(system, externalId)` already belongs to
 *   another live key (`otherKeys`): likely a rename in the tool;
 * - `external-id-changed`: the key's head (its uploaded revision) carries a
 *   different `(system, externalId)` (`previous`) than the incoming file,
 *   both present: two systems may export the same folder and name;
 * - `provenance-kept`: the file is `unchanged`, so analyzr keeps the
 *   provenance it has for the model (identical bytes keep their first
 *   revision's, §3.3), while the manifest declares another system, tool id,
 *   tool folder or link (a folder moved in the tool), or analyzr has none
 *   (stored without a manifest). Not raised next to `external-id-changed`;
 * - `trust-kept` (M6 S2c): the file is `unchanged`, so analyzr keeps the
 *   trust class of the model's uploaded revision, while this request would
 *   classify the file differently (another credential or derivation); a
 *   reclassification needs changed bytes.
 */
export const ImportWarningCode = z
  .enum([
    'manifest-sha-mismatch',
    'external-id-moved',
    'external-id-changed',
    'provenance-kept',
    'trust-kept',
  ])
  .meta({ id: 'ImportWarningCode', description: 'Kind of an import warning.' });
export type ImportWarningCode = z.infer<typeof ImportWarningCode>;

/** Most other keys an `external-id-moved` warning names. */
export const MAX_WARNING_OTHER_KEYS = 20;

export const ExternalIdentity = z
  .object({ system: SourceSystem, externalId: z.string() })
  .meta({ id: 'ExternalIdentity', description: "A model's identity in its source system." });
export type ExternalIdentity = z.infer<typeof ExternalIdentity>;

export const ImportWarning = z
  .object({
    code: ImportWarningCode,
    /** English, one line. */
    message: z.string().max(500),
    /** `external-id-moved`, `external-id-changed`, `provenance-kept`: the incoming file's identity, as far as declared. */
    system: SourceSystem.optional(),
    externalId: z.string().optional(),
    /** `external-id-moved`: the live keys whose head carries the same identity (sorted). */
    otherKeys: z.array(ModelKey).max(MAX_WARNING_OTHER_KEYS).optional(),
    /** `external-id-changed`: the identity the key's head carried. */
    previous: ExternalIdentity.optional(),
    /** `manifest-sha-mismatch`: the declared and the received SHA-256. */
    manifestSha256: Sha256Hex.optional(),
    fileSha256: Sha256Hex.optional(),
  })
  .meta({
    id: 'ImportWarning',
    description: 'A warning about a file against its manifest or the landscape; it was imported.',
  });
export type ImportWarning = z.infer<typeof ImportWarning>;

/** One live model's identity in its source system, from its head's uploaded revision. */
export const ExternalIdEntry = z
  .object({
    key: ModelKey,
    system: SourceSystem,
    /** `null`: the manifest named no tool id (the tool path identifies the model). */
    externalId: z.string().nullable(),
    externalPath: z.string().nullable(),
  })
  .meta({ id: 'ExternalIdEntry', description: "A live model's identity in its source system." });
export type ExternalIdEntry = z.infer<typeof ExternalIdEntry>;

export const ExternalIdList = z
  .object({ items: z.array(ExternalIdEntry) })
  .meta({ id: 'ExternalIdList', description: 'The live models with a declared source system.' });
export type ExternalIdList = z.infer<typeof ExternalIdList>;

export const ExternalIdQuery = z.object({ system: SourceSystem.optional() });
export type ExternalIdQuery = z.infer<typeof ExternalIdQuery>;

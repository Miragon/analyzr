/**
 * The import bundle `analyzr-import/1` (M6 §3.2) from a BPMN export: every
 * model normalized (`normalize.ts`) at its pinned key's path below the bundle
 * root, so `analyzr import <bundle>` and „Hochladen“ derive exactly those keys
 * today, plus the manifest `analyzr-import.json` (provenance, pinned keys,
 * losses, checksums), which analyzr reads from M6 S2a on, and optionally the
 * customer's process inventory (`inventory.json`, `analyzr-inventory/1`).
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { bpmnSuffixOf } from '@analyzr/contracts/paths';

import { isBpmnRoot } from './bpmn-scan.ts';
import { tidyDeclared } from './declared.ts';
import { decodeText, looksBinary } from './encoding.ts';
import { listExport } from './files.ts';
import { planKeys, type ExportModel, type Keymap, type KeyPlan } from './keymap.ts';
import {
  isExpression,
  normalizeBpmn,
  NormalizeError,
  type AmbiguousReference,
  type IdRewrite,
  type Loss,
  type NormalizeErrorCode,
} from './normalize.ts';
import { NORMALIZE_BPMN_CONVERTER, NORMALIZE_BPMN_VERSION } from './version.ts';
import { attribute, parseXml } from './xml.ts';
import { isZip } from './zip.ts';

export const MANIFEST_FILE = 'analyzr-import.json';
export const MANIFEST_FORMAT = 'analyzr-import/1';
export const INVENTORY_FILE = 'inventory.json';
export const INVENTORY_FORMAT = 'analyzr-inventory/1';

/** A BPMN model of the export with what planning and the report need. */
export interface ScannedModel extends ExportModel {
  absolute: string;
  /** The root's `exporterVersion`, tidied ({@link tidyDeclared}); `null` for none or blank. */
  exporterVersion: string | null;
}

export interface ScannedExport {
  models: ScannedModel[];
  /** Files that are no BPMN 2.0 document, with the reason. */
  skipped: { path: string; reason: 'not-bpmn' | 'not-xml' | 'binary' | 'zip' | 'encoding' }[];
  hidden: number;
  symlinks: number;
}

/** Most characters of the manifest's `source.systemVersion` (analyzr refuses a longer one). */
export const MAX_SYSTEM_VERSION_CHARS = 100;

/** The tool path of an export file: its path without a BPMN file ending. */
export function externalPathOf(filePath: string): string {
  const suffix = bpmnSuffixOf(filePath);
  return suffix === null ? filePath : filePath.slice(0, -suffix.length);
}

/** The BPMN 2.0 documents of an export (by content, whatever their file ending), sorted by path. */
export async function scanExport(exportPath: string): Promise<ScannedExport> {
  const listing = await listExport(exportPath);
  const models: ScannedModel[] = [];
  const skipped: ScannedExport['skipped'] = [];
  for (const f of listing.files) {
    const bytes = new Uint8Array(await readFile(f.absolute));
    if (isZip(bytes)) {
      skipped.push({ path: f.path, reason: 'zip' });
      continue;
    }
    if (looksBinary(bytes)) {
      skipped.push({ path: f.path, reason: 'binary' });
      continue;
    }
    let text: string;
    try {
      text = decodeText(bytes);
    } catch {
      skipped.push({ path: f.path, reason: 'encoding' });
      continue;
    }
    if (!/^\s*</.test(text)) {
      skipped.push({ path: f.path, reason: 'not-xml' });
      continue;
    }
    let root;
    try {
      root = parseXml(text, { rootOnly: true, lenient: true }).root;
    } catch {
      skipped.push({ path: f.path, reason: 'not-xml' });
      continue;
    }
    if (!isBpmnRoot(root)) {
      skipped.push({ path: f.path, reason: 'not-bpmn' });
      continue;
    }
    const id = attribute(root, 'id')?.trim() ?? '';
    models.push({
      path: f.path,
      absolute: f.absolute,
      externalId: id === '' ? null : id,
      externalPath: externalPathOf(f.path),
      // `exporterVersion=""` and a value of spaces declare nothing (M6 S2b follow-up step 4).
      exporterVersion: tidyDeclared(attribute(root, 'exporterVersion'), MAX_SYSTEM_VERSION_CHARS),
    });
  }
  return { models, skipped, hidden: listing.hidden, symlinks: listing.symlinks };
}

export interface ManifestFile {
  path: string;
  key: string;
  externalId?: string;
  externalPath: string;
  /** A link into the tool (a converter's output only, M6 S3c). */
  url?: string;
  derived: {
    /** normalize-bpmn: `export` or `converted`; analyzr-spec (M6 S3c): `converted` or `reconstructed`. */
    kind: 'export' | 'converted' | 'reconstructed' | 'as-told';
    converter: string | null;
    llmModel: string | null;
    from: string[];
  };
  losses?: { code: string; count: number }[];
  sha256: string;
}

export interface ImportManifest {
  format: typeof MANIFEST_FORMAT;
  source: {
    system: string;
    systemVersion: string | null;
    exportedAt: string | null;
    importer: {
      name: 'analyzr-integrate/normalize-bpmn' | 'analyzr-integrate/analyzr-spec';
      version: string;
    };
    scope?: string[];
  };
  files: ManifestFile[];
  inventory?: { path: typeof INVENTORY_FILE };
}

export interface InventoryItem {
  id: string;
  name: string;
  area?: string;
  externalId?: string;
}

export interface Inventory {
  format: typeof INVENTORY_FORMAT;
  items: InventoryItem[];
}

export interface Coverage {
  items: number;
  /** Items whose `externalId` is a bundled model's tool id. */
  matched: { id: string; name: string; key: string }[];
  /** „Zuordnung vorgeschlagen“: unmatched items whose name equals a bundled model's name. */
  proposed: { id: string; name: string; keys: string[] }[];
  /** „Bitte nachliefern“: items without a model. */
  missing: { id: string; name: string; area?: string }[];
}

/**
 * Where a call activity's `calledElement` points inside the bundle:
 * `one` (exactly one bundled process has that id: analyzr accepts the call on
 * import unless another model of the project has it too, owner decision 9),
 * `none` (no bundled process), `several`, `expression` (C7/C8 expression) or
 * `empty` (no `calledElement`).
 */
export type CallMatch = 'one' | 'none' | 'several' | 'expression' | 'empty';

export interface BundledCall {
  id: string;
  name: string | null;
  calledElement: string | null;
  match: CallMatch;
  /** `one`: the bundled model and process the call points at. */
  target: { key: string; processId: string } | null;
}

export interface BundledFile {
  /** Path below the export. */
  source: string;
  /** Path below the bundle. */
  path: string;
  key: string;
  kind: 'export' | 'converted';
  encoding: string;
  /** Rewritten and added ids of model elements (the DI's own ids are only counted). */
  idRewrites: IdRewrite[];
  /** Rewritten ids of DI shapes, edges and diagrams (meaningless to the consultant). */
  layoutIdRewrites: number;
  calledElementRewrites: { from: string; to: string }[];
  ambiguousReferences: AmbiguousReference[];
  compact: boolean;
  losses: Loss[];
  parseWarnings: string[];
  layoutMissing: string[];
  processes: { id: string; name: string | null }[];
  callActivities: BundledCall[];
  blackBoxParticipants: { id: string; name: string | null }[];
  collapsedSubprocesses: { id: string; name: string | null }[];
}

export interface BundleResult {
  bundle: string;
  manifest: ImportManifest;
  files: BundledFile[];
  /** Models normalize-bpmn could not turn into BPMN analyzr accepts (not in the bundle). */
  failed: { source: string; key: string; code: NormalizeErrorCode; message: string }[];
  skipped: ScannedExport['skipped'];
  /** Models below a folder `keymap.json` excludes for the system (not in the bundle). */
  excluded: string[];
  absent: KeyPlan['absent'];
  coverage: Coverage | null;
}

export type BundleErrorCode =
  | 'keys-unconfirmed'
  | 'bundle-not-empty'
  | 'invalid-exported-at'
  | 'invalid-inventory'
  | 'no-models';

export class BundleError extends Error {
  readonly code: BundleErrorCode;

  constructor(code: BundleErrorCode, message: string) {
    super(message);
    this.name = 'BundleError';
    this.code = code;
  }
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** True for an id rewrite of the DI (shapes, edges, planes, diagrams, labels). */
const isLayoutRewrite = (r: IdRewrite): boolean => /^(?:bpmndi|di|dc):/.test(r.type);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** An ISO 8601 date-time as the manifest stores it (a bare date becomes midnight UTC). */
export function normalizeExportedAt(value: string): string {
  if (ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    return `${value}T00:00:00Z`;
  }
  if (ISO_DATE_TIME.test(value) && !Number.isNaN(Date.parse(value))) return value;
  throw new BundleError(
    'invalid-exported-at',
    `invalid export date ${JSON.stringify(value)}: an ISO 8601 date or date-time such as 2026-10-14 or 2026-10-14T09:12:00Z`,
  );
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Checks an `analyzr-inventory/1` value. @throws {BundleError} `invalid-inventory` */
export function parseInventory(value: unknown): Inventory {
  if (!isObject(value) || value['format'] !== INVENTORY_FORMAT || !Array.isArray(value['items'])) {
    throw new BundleError(
      'invalid-inventory',
      `not an inventory: expected {"format": "${INVENTORY_FORMAT}", "items": [{id, name, area?, externalId?}]}`,
    );
  }
  const ids = new Set<string>();
  const items = (value['items'] as unknown[]).map((raw, i) => {
    if (!isObject(raw) || typeof raw['id'] !== 'string' || typeof raw['name'] !== 'string') {
      throw new BundleError('invalid-inventory', `item ${i + 1}: id and name are strings`);
    }
    const allowed = new Set(['id', 'name', 'area', 'externalId']);
    const extra = Object.keys(raw).filter((k) => !allowed.has(k));
    if (extra.length > 0) {
      throw new BundleError(
        'invalid-inventory',
        `item ${i + 1}: unknown fields ${extra.join(', ')} (columns that name people stay out)`,
      );
    }
    if (ids.has(raw['id']))
      throw new BundleError('invalid-inventory', `item id ${raw['id']} twice`);
    ids.add(raw['id']);
    const item: InventoryItem = { id: raw['id'], name: raw['name'] };
    if (typeof raw['area'] === 'string') item.area = raw['area'];
    if (typeof raw['externalId'] === 'string') item.externalId = raw['externalId'];
    return item;
  });
  return { format: INVENTORY_FORMAT, items };
}

/** A name for matching: lowercase, umlauts transliterated, marks and punctuation dropped. */
export function matchName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Matches inventory items to bundled models: by tool id, else proposals by name. */
export function coverageOf(
  inventory: Inventory,
  models: readonly { key: string; externalId: string | null; names: readonly string[] }[],
): Coverage {
  const byId = new Map(
    models.filter((m) => m.externalId !== null).map((m) => [m.externalId ?? '', m.key]),
  );
  const coverage: Coverage = {
    items: inventory.items.length,
    matched: [],
    proposed: [],
    missing: [],
  };
  for (const item of inventory.items) {
    const key = item.externalId === undefined ? undefined : byId.get(item.externalId);
    if (key !== undefined) {
      coverage.matched.push({ id: item.id, name: item.name, key });
      continue;
    }
    const wanted = matchName(item.name);
    const keys = models
      .filter((m) => wanted !== '' && m.names.some((n) => matchName(n) === wanted))
      .map((m) => m.key)
      .sort(compare);
    if (keys.length > 0) coverage.proposed.push({ id: item.id, name: item.name, keys });
    else {
      coverage.missing.push({
        id: item.id,
        name: item.name,
        ...(item.area === undefined ? {} : { area: item.area }),
      });
    }
  }
  return coverage;
}

export interface BundleOptions {
  exportPath: string;
  outDir: string;
  system: string;
  keymap: Keymap;
  /** When the customer exported (ISO 8601 date or date-time), or `null`. */
  exportedAt?: string | null;
  inventory?: Inventory | null;
}

async function assertEmpty(dir: string): Promise<void> {
  const entries = await readdir(dir).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return [];
    throw err;
  });
  if (entries.length > 0) {
    throw new BundleError(
      'bundle-not-empty',
      `${dir} is not empty: write every bundle into a new folder (bundles/<YYYY-MM-DD>-<system>/)`,
    );
  }
}

/** The manifest and the bundle's files as written (JSON with two-space indent and a final newline). */
export function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Writes the bundle for an export whose keys the consultant confirmed (every
 * model `known` in the key map, after `normalize-bpmn plan --write`).
 *
 * @throws {BundleError} for unconfirmed keys, a non-empty bundle folder, a bad date or inventory
 */
export async function writeBundle(options: BundleOptions): Promise<BundleResult> {
  const exportedAt =
    options.exportedAt === undefined || options.exportedAt === null
      ? null
      : normalizeExportedAt(options.exportedAt);
  const scanned = await scanExport(options.exportPath);
  if (scanned.models.length === 0) {
    throw new BundleError('no-models', `no BPMN 2.0 file below ${options.exportPath}`);
  }
  const plan = planKeys(options.keymap, scanned.models, { system: options.system });
  const unconfirmed = plan.files.filter((f) => f.status !== 'known');
  if (unconfirmed.length > 0) {
    throw new BundleError(
      'keys-unconfirmed',
      `${unconfirmed.length} models without a confirmed key (${unconfirmed
        .slice(0, 5)
        .map((f) => `${f.path}: ${f.status}`)
        .join(
          ', ',
        )}${unconfirmed.length > 5 ? ', …' : ''}): run plan, confirm it with the consultant, then plan --write`,
    );
  }
  await assertEmpty(options.outDir);

  const byPath = new Map(scanned.models.map((m) => [m.path, m]));
  const files: BundledFile[] = [];
  const manifestFiles: ManifestFile[] = [];
  const failed: BundleResult['failed'] = [];
  const names: { key: string; externalId: string | null; names: string[] }[] = [];
  for (const planned of plan.files) {
    const model = byPath.get(planned.path);
    if (model === undefined) continue;
    let result;
    try {
      result = await normalizeBpmn(new Uint8Array(await readFile(model.absolute)));
    } catch (err) {
      if (!(err instanceof NormalizeError)) throw err;
      failed.push({ source: planned.path, key: planned.key, code: err.code, message: err.message });
      continue;
    }
    const target = `${planned.key}.bpmn`;
    const absolute = path.join(options.outDir, ...target.split('/'));
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, result.bytes);
    files.push({
      source: planned.path,
      path: target,
      key: planned.key,
      kind: result.kind,
      encoding: result.encoding,
      idRewrites: result.idRewrites.filter((r) => !isLayoutRewrite(r)),
      layoutIdRewrites: result.idRewrites.filter(isLayoutRewrite).length,
      calledElementRewrites: result.calledElementRewrites,
      ambiguousReferences: result.ambiguousReferences,
      compact: result.compact,
      losses: result.losses,
      parseWarnings: result.parseWarnings,
      layoutMissing: result.layoutMissing,
      processes: result.summary.processes.map(({ id, name }) => ({ id, name })),
      callActivities: result.summary.callActivities.map((c) => ({
        ...c,
        match: 'none',
        target: null,
      })),
      blackBoxParticipants: result.summary.blackBoxParticipants,
      collapsedSubprocesses: result.summary.collapsedSubprocesses,
    });
    manifestFiles.push({
      path: target,
      key: planned.key,
      ...(planned.externalId === null ? {} : { externalId: planned.externalId }),
      externalPath: planned.externalPath,
      derived: {
        kind: result.kind,
        converter: result.kind === 'converted' ? NORMALIZE_BPMN_CONVERTER : null,
        llmModel: null,
        from: [],
      },
      ...(result.losses.length === 0 ? {} : { losses: result.losses.slice(0, 20) }),
      sha256: result.sha256,
    });
    names.push({
      key: planned.key,
      externalId: planned.externalId,
      names: [
        ...result.summary.processes.flatMap((p) => (p.name === null ? [] : [p.name])),
        planned.externalPath.slice(planned.externalPath.lastIndexOf('/') + 1),
      ],
    });
  }
  files.sort((a, b) => compare(a.path, b.path));
  manifestFiles.sort((a, b) => compare(a.path, b.path));
  resolveCalls(files);

  const versions = new Set(scanned.models.map((m) => m.exporterVersion));
  const [onlyVersion] = versions;
  const manifest: ImportManifest = {
    format: MANIFEST_FORMAT,
    source: {
      system: options.system,
      systemVersion: versions.size === 1 ? (onlyVersion ?? null) : null,
      exportedAt,
      importer: { name: 'analyzr-integrate/normalize-bpmn', version: NORMALIZE_BPMN_VERSION },
      ...(plan.scope === null ? {} : { scope: plan.scope }),
    },
    files: manifestFiles,
  };
  await mkdir(options.outDir, { recursive: true });
  let coverage: Coverage | null = null;
  if (options.inventory) {
    manifest.inventory = { path: INVENTORY_FILE };
    await writeFile(path.join(options.outDir, INVENTORY_FILE), formatJson(options.inventory));
    coverage = coverageOf(options.inventory, names);
  }
  await writeFile(path.join(options.outDir, MANIFEST_FILE), formatJson(manifest));
  return {
    bundle: options.outDir,
    manifest,
    files,
    failed,
    skipped: scanned.skipped,
    excluded: plan.excluded,
    absent: plan.absent,
    coverage,
  };
}

/** Sets each call activity's `match` and `target` against the bundled processes. */
export function resolveCalls(files: BundledFile[]): void {
  const processes = new Map<string, { key: string; processId: string }[]>();
  for (const f of files) {
    for (const p of f.processes) {
      const list = processes.get(p.id) ?? [];
      list.push({ key: f.key, processId: p.id });
      processes.set(p.id, list);
    }
  }
  for (const f of files) {
    for (const call of f.callActivities) {
      const value = call.calledElement?.trim() ?? '';
      const targets = processes.get(value) ?? [];
      call.match =
        value === ''
          ? 'empty'
          : isExpression(value)
            ? 'expression'
            : targets.length === 1
              ? 'one'
              : targets.length === 0
                ? 'none'
                : 'several';
      call.target = call.match === 'one' ? (targets[0] ?? null) : null;
    }
  }
}

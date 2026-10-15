/**
 * The workspace's key map `keymap.json` (M6 §3.4, §3.7): per source system the
 * key rule, the scope of a partial export, the tool folders left out and
 * `(externalId → key)` entries. Model keys are immutable in analyzr, so the
 * first import fixes them: a re-export reuses the key of every model the map
 * knows, by its tool id (also after a folder move in the tool), else by its
 * tool path. A tool id identifies a model only when it is unique in the export
 * and not generic (`Definitions_1`, a template's id). Planning is pure;
 * writing happens only after the consultant confirmed the plan.
 */
import { isModelKey, modelKeyFromPath } from '@analyzr/contracts/paths';

import { shortHash } from './ids.ts';

export const KEYMAP_FORMAT = 'analyzr-keymap/1';

/** How keys are derived from paths for a system (fixed after its first import). */
export interface KeyRule {
  /** A leading tool folder dropped from every path before slugifying (`Gemeinsame Dokumente`), or `null`. */
  strip: string | null;
  /** A key prefix such as `signavio` (a valid model key), or `null`. */
  prefix: string | null;
}

export interface KeymapEntry {
  key: string;
  /** The tool's model id, `null` when the export has none (then the path identifies the model). */
  externalId: string | null;
  /** Folder and model name in the tool: the path below the export without its file ending. */
  externalPath: string;
}

export interface SystemKeymap {
  rule: KeyRule;
  /** Tool folders a partial export covers; `null`: the whole system. */
  scope: string[] | null;
  /** Tool folders (or models' tool paths) left out of every bundle, e.g. `Archiv`. */
  exclude: string[];
  /** The export folder of the last written plan, e.g. `2026-10-14-signavio`. */
  lastExport: string | null;
  entries: KeymapEntry[];
}

export interface Keymap {
  format: typeof KEYMAP_FORMAT;
  systems: Record<string, SystemKeymap>;
}

/** A model of an export, as planning sees it. */
export interface ExportModel {
  /** Path below the export folder, with its file ending. */
  path: string;
  externalId: string | null;
  externalPath: string;
}

export type PlanStatus = 'known' | 'moved' | 'new';

/**
 * Notes on a planned file for the consultant's confirmation:
 * - `no-key`: the path gives no valid key (a fallback key is planned);
 * - `duplicate-external-id`: another file of the export has the same tool id,
 *   so the id identifies neither (the tool path does);
 * - `generic-external-id`: the tool id is generic (`Definitions_1`, a
 *   template's), so it identifies nothing (the tool path does);
 * - `renamed`: `moved` with another file name as well: check that it is the
 *   same model;
 * - `outside-scope`: the file lies outside the folders the partial export
 *   declares;
 * - `exists-in-analyzr`: a new key analyzr already has (`--existing`): the
 *   import would revise that model.
 */
export type PlanFlag =
  | 'no-key'
  | 'duplicate-external-id'
  | 'generic-external-id'
  | 'renamed'
  | 'outside-scope'
  | 'exists-in-analyzr';

export interface PlannedFile {
  path: string;
  /** The tool id the key map records for the file (`null`: the tool path identifies it). */
  externalId: string | null;
  externalPath: string;
  key: string;
  status: PlanStatus;
  /** `moved`: the tool path the map knew. */
  previousPath?: string;
  /** `new`: the derived key another model already has (the planned key carries a suffix). */
  collidesWith?: { key: string; holders: string[] };
  flags: PlanFlag[];
}

export interface KeyPlan {
  system: string;
  rule: KeyRule;
  scope: string[] | null;
  exclude: string[];
  /** No entries for the system yet (or `reset`): the consultant confirms the key scheme. */
  firstImport: boolean;
  /** The system's stored entries and rule are dropped (`--reset`, nothing imported yet). */
  reset: boolean;
  files: PlannedFile[];
  /** Paths of the export's models below an excluded folder (not planned, not bundled). */
  excluded: string[];
  /** Entries of the system inside the scope that the export lacks (or excludes). */
  absent: KeymapEntry[];
  /** Up to 10 planned keys spread over the export, for the confirmation. */
  examples: { path: string; key: string }[];
  counts: {
    known: number;
    moved: number;
    new: number;
    absent: number;
    collisions: number;
    excluded: number;
    flagged: number;
  };
}

/** Thrown for an invalid key map, system name, rule or scope. */
export class KeymapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeymapError';
  }
}

const SYSTEM_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Tool ids that identify nothing: the defaults of modelers and templates
 * (`Definitions_1`, `definitions`, `Defs_2`), written into many files.
 */
const GENERIC_EXTERNAL_ID = /^(?:definitions?|defs?)(?:[_-]?\d+)?$/i;

/** True if a tool id is generic, so it cannot identify a model. */
export function isGenericExternalId(id: string): boolean {
  return GENERIC_EXTERNAL_ID.test(id);
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function emptyKeymap(): Keymap {
  return { format: KEYMAP_FORMAT, systems: {} };
}

/** Checks a system name: a lowercase slug such as `signavio`, `aris`, `bizagi`. */
export function assertSystem(system: string): void {
  if (!SYSTEM_PATTERN.test(system)) {
    throw new KeymapError(
      `invalid system ${JSON.stringify(system)}: a lowercase slug such as signavio or aris`,
    );
  }
}

/** Checks tool folders (`--scope`, `--exclude`): relative, `/`-separated paths below the export. */
export function assertFolders(folders: readonly string[], option: string): void {
  for (const f of folders) {
    if (f === '' || /^\/|\/$|\\/.test(f)) {
      throw new KeymapError(
        `invalid ${option} folder ${JSON.stringify(f)}: a folder path below the export, / separated`,
      );
    }
  }
}

/** Checks a rule: `prefix` a valid model key, `strip` a relative tool path. */
export function assertRule(rule: KeyRule): void {
  if (rule.prefix !== null && !isModelKey(rule.prefix)) {
    throw new KeymapError(
      `invalid key prefix ${JSON.stringify(rule.prefix)}: a model key such as signavio`,
    );
  }
  if (rule.strip !== null && (rule.strip === '' || /^\/|\/$|\\/.test(rule.strip))) {
    throw new KeymapError(
      `invalid strip folder ${JSON.stringify(rule.strip)}: a folder path below the export, / separated`,
    );
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStringOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';

/**
 * Reads and checks a key map's JSON value: the format, the rules, valid and
 * unique keys over all systems, unique tool ids and paths per system.
 *
 * @throws {KeymapError} naming the first problem
 */
export function parseKeymap(value: unknown): Keymap {
  if (!isObject(value) || value['format'] !== KEYMAP_FORMAT || !isObject(value['systems'])) {
    throw new KeymapError(`not a key map: expected {"format": "${KEYMAP_FORMAT}", "systems": {…}}`);
  }
  const systems: Record<string, SystemKeymap> = {};
  const keys = new Map<string, string>();
  for (const [system, raw] of Object.entries(value['systems'])) {
    assertSystem(system);
    if (!isObject(raw) || !isObject(raw['rule']) || !Array.isArray(raw['entries'])) {
      throw new KeymapError(`system ${system}: expected rule and entries`);
    }
    const ruleRaw = raw['rule'];
    if (!isStringOrNull(ruleRaw['strip']) || !isStringOrNull(ruleRaw['prefix'])) {
      throw new KeymapError(`system ${system}: rule.strip and rule.prefix are strings or null`);
    }
    const rule: KeyRule = { strip: ruleRaw['strip'], prefix: ruleRaw['prefix'] };
    assertRule(rule);
    const scopeRaw = raw['scope'] ?? null;
    if (
      scopeRaw !== null &&
      (!Array.isArray(scopeRaw) || !scopeRaw.every((s) => typeof s === 'string'))
    ) {
      throw new KeymapError(`system ${system}: scope is a list of tool folders or null`);
    }
    if (scopeRaw !== null) assertFolders(scopeRaw, 'scope');
    const excludeRaw = raw['exclude'] ?? [];
    if (!Array.isArray(excludeRaw) || !excludeRaw.every((s) => typeof s === 'string')) {
      throw new KeymapError(`system ${system}: exclude is a list of tool folders`);
    }
    const exclude = excludeRaw;
    assertFolders(exclude, 'exclude');
    const lastExport = raw['lastExport'] ?? null;
    if (!isStringOrNull(lastExport))
      throw new KeymapError(`system ${system}: lastExport is a string or null`);
    const entries: KeymapEntry[] = [];
    const identities = new Set<string>();
    for (const e of raw['entries'] as unknown[]) {
      if (
        !isObject(e) ||
        typeof e['key'] !== 'string' ||
        !isStringOrNull(e['externalId']) ||
        typeof e['externalPath'] !== 'string'
      ) {
        throw new KeymapError(`system ${system}: every entry has key, externalId and externalPath`);
      }
      const entry: KeymapEntry = {
        key: e['key'],
        externalId: e['externalId'],
        externalPath: e['externalPath'],
      };
      if (!isModelKey(entry.key)) {
        throw new KeymapError(
          `system ${system}: ${JSON.stringify(entry.key)} is no valid model key`,
        );
      }
      const holder = keys.get(entry.key);
      if (holder !== undefined) {
        throw new KeymapError(
          `key ${entry.key} appears twice (${holder} and ${system}: ${entry.externalPath})`,
        );
      }
      keys.set(entry.key, `${system}: ${entry.externalPath}`);
      const identity = identityOf(entry);
      if (identities.has(identity)) {
        throw new KeymapError(`system ${system}: ${identity} appears twice`);
      }
      identities.add(identity);
      entries.push(entry);
    }
    systems[system] = { rule, scope: scopeRaw, exclude, lastExport, entries };
  }
  return { format: KEYMAP_FORMAT, systems };
}

/** An entry's identity in the map: its tool id, else its tool path (unique per system). */
function identityOf(m: { externalId: string | null; externalPath: string }): string {
  return m.externalId !== null ? `id:${m.externalId}` : `path:${m.externalPath}`;
}

/** True if `externalPath` is one of the folders or lies inside one. */
function inFolders(externalPath: string, folders: readonly string[]): boolean {
  return folders.some((s) => externalPath === s || externalPath.startsWith(`${s}/`));
}

/** True if `externalPath` lies inside one of the scope folders (`null`: everything). */
export function inScope(externalPath: string, scope: readonly string[] | null): boolean {
  return scope === null || inFolders(externalPath, scope);
}

/** True if a tool path (or an export path) lies inside an excluded folder or is an excluded model. */
export function isExcluded(externalPath: string, exclude: readonly string[]): boolean {
  return inFolders(externalPath, exclude);
}

/** The file name of a tool path. */
const nameOf = (externalPath: string): string =>
  externalPath.slice(externalPath.lastIndexOf('/') + 1);

/** The key the rule derives from a path, or `null` if nothing valid remains. */
export function deriveKey(path: string, rule: KeyRule): string | null {
  let p = path;
  if (rule.strip !== null && (p === rule.strip || p.startsWith(`${rule.strip}/`))) {
    p = p.slice(rule.strip.length + 1);
  }
  const key = modelKeyFromPath(p);
  if (key === null) return null;
  const full = rule.prefix === null ? key : `${rule.prefix}/${key}`;
  return isModelKey(full) ? full : null;
}

/** `key`, else `key-2`, `key-3`, … (shortened to fit 200 characters). */
function freeKey(key: string, taken: ReadonlySet<string>): string {
  if (!taken.has(key)) return key;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${key.slice(0, 200 - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!taken.has(candidate) && isModelKey(candidate)) return candidate;
  }
}

export interface PlanOptions {
  system: string;
  /** The rule for a first import; on a later import it must equal the stored one (unless `reset`). */
  rule?: KeyRule;
  /** Tool folders of a partial export; `undefined` keeps the stored scope, `null` sets the whole system. */
  scope?: string[] | null;
  /** Tool folders to leave out; `undefined` keeps the stored ones. */
  exclude?: string[];
  /**
   * Keys the analyzr project already has (`analyzr models list --json`): a
   * new key among them is flagged `exists-in-analyzr`.
   */
  existingKeys?: readonly string[];
  /**
   * Drops the system's stored rule and entries (other systems' keys stay
   * taken): for a key rule the consultant wants changed before anything of
   * the system reached analyzr.
   */
  reset?: boolean;
}

/** Plans the keys of an export's models against the key map (pure). */
export function planKeys(
  keymap: Keymap,
  models: readonly ExportModel[],
  options: PlanOptions,
): KeyPlan {
  const { system } = options;
  assertSystem(system);
  const reset = options.reset === true;
  const stored = reset ? undefined : keymap.systems[system];
  if (stored !== undefined && options.rule !== undefined && !sameRule(stored.rule, options.rule)) {
    throw new KeymapError(
      `the key rule of ${system} is fixed since its first plan --write (strip ${JSON.stringify(stored.rule.strip)}, prefix ${JSON.stringify(stored.rule.prefix)}): keys never change once analyzr has them; if nothing of ${system} is imported yet, plan again with --reset (skill step 3)`,
    );
  }
  const rule = stored?.rule ?? options.rule ?? { strip: null, prefix: null };
  assertRule(rule);
  const scope = options.scope !== undefined ? options.scope : (stored?.scope ?? null);
  if (scope !== null) assertFolders(scope, 'scope');
  const exclude = [...(options.exclude ?? stored?.exclude ?? [])].sort(compare);
  assertFolders(exclude, 'exclude');
  const entries = stored?.entries ?? [];

  const out = (m: ExportModel): boolean =>
    isExcluded(m.externalPath, exclude) || isExcluded(m.path, exclude);
  const included = models.filter((m) => !out(m));
  const excluded = models
    .filter(out)
    .map((m) => m.path)
    .sort(compare);
  const idCounts = new Map<string, number>();
  for (const m of included) {
    if (m.externalId !== null && !isGenericExternalId(m.externalId)) {
      idCounts.set(m.externalId, (idCounts.get(m.externalId) ?? 0) + 1);
    }
  }

  // The tool id that identifies a file: unique in the export and not generic.
  const files: PlannedFile[] = [];
  const rawIds = new Map<PlannedFile, string | null>();
  for (const m of [...included].sort((a, b) => compare(a.path, b.path))) {
    const flags: PlanFlag[] = [];
    let externalId = m.externalId;
    if (externalId !== null && isGenericExternalId(externalId)) {
      flags.push('generic-external-id');
      externalId = null;
    } else if (externalId !== null && (idCounts.get(externalId) ?? 0) > 1) {
      flags.push('duplicate-external-id');
      externalId = null;
    }
    if (!inScope(m.externalPath, scope)) flags.push('outside-scope');
    const file: PlannedFile = {
      path: m.path,
      externalId,
      externalPath: m.externalPath,
      key: '',
      status: 'new',
      flags,
    };
    rawIds.set(file, m.externalId);
    files.push(file);
  }

  const matched = new Map<PlannedFile, KeymapEntry>();
  const used = new Set<KeymapEntry>();
  // 1. By tool id: a folder move keeps the key (M6 §3.4 rule 1).
  const byId = new Map<string, KeymapEntry>();
  for (const e of entries) if (e.externalId !== null) byId.set(e.externalId, e);
  for (const f of files) {
    const entry = f.externalId === null ? undefined : byId.get(f.externalId);
    if (entry !== undefined && !used.has(entry)) {
      matched.set(f, entry);
      used.add(entry);
    }
  }
  // 2. By tool path, unless the file and the entry carry different tool ids: a
  // file whose id identifies nothing (none, generic, twice in the export) or
  // that the map knew without one keeps its key at the same place.
  for (const f of files) {
    if (matched.has(f)) continue;
    const raw = rawIds.get(f) ?? null;
    const candidates = entries
      .filter(
        (e) =>
          !used.has(e) &&
          e.externalPath === f.externalPath &&
          (e.externalId === null || raw === null || e.externalId === raw),
      )
      .sort(
        (a, b) =>
          Number(b.externalId === raw) - Number(a.externalId === raw) || compare(a.key, b.key),
      );
    const entry = candidates[0];
    if (entry !== undefined) {
      matched.set(f, entry);
      used.add(entry);
    }
  }
  for (const [f, entry] of matched) {
    f.key = entry.key;
    // The map keeps the identity it had when the file's own id identifies nothing now.
    f.externalId ??= entry.externalId;
    if (entry.externalPath === f.externalPath) {
      f.status = 'known';
    } else {
      f.status = 'moved';
      f.previousPath = entry.externalPath;
      if (nameOf(entry.externalPath) !== nameOf(f.externalPath)) f.flags.push('renamed');
    }
  }

  // Every key the map holds stays taken (analyzr never frees a key), then the planned ones.
  const holders = new Map<string, string[]>();
  for (const [s, sys] of Object.entries(keymap.systems)) {
    if (reset && s === system) continue;
    for (const e of sys.entries) holders.set(e.key, [`${s}: ${e.externalPath}`]);
  }
  const taken = new Set(holders.keys());
  for (const f of files) if (f.status !== 'new') taken.add(f.key);
  const existing = new Set(options.existingKeys ?? []);
  let collisions = 0;
  for (const f of files.filter((x) => x.status === 'new')) {
    const derived = deriveKey(f.path, rule);
    let key = derived;
    if (key === null) {
      f.flags.push('no-key');
      const fallback = `modell-${shortHash(rawIds.get(f) ?? f.externalPath)}`;
      key = rule.prefix === null ? fallback : `${rule.prefix}/${fallback}`;
    }
    const final = freeKey(key, taken);
    if (final !== key) {
      collisions++;
      f.collidesWith = { key, holders: [...(holders.get(key) ?? [])] };
    }
    f.key = final;
    if (existing.has(final)) f.flags.push('exists-in-analyzr');
    taken.add(final);
    holders.set(final, [`${system}: ${f.externalPath}`]);
  }

  const absent = entries
    .filter((e) => !used.has(e) && inScope(e.externalPath, scope))
    .sort((a, b) => compare(a.key, b.key));
  const n = files.length;
  const picks =
    n <= 10 ? files : Array.from({ length: 10 }, (_, i) => files[Math.round((i * (n - 1)) / 9)]);
  return {
    system,
    rule,
    scope,
    exclude,
    firstImport: stored === undefined,
    reset,
    files,
    excluded,
    absent,
    examples: picks.filter((f) => f !== undefined).map((f) => ({ path: f.path, key: f.key })),
    counts: {
      known: files.filter((f) => f.status === 'known').length,
      moved: files.filter((f) => f.status === 'moved').length,
      new: files.filter((f) => f.status === 'new').length,
      absent: absent.length,
      collisions,
      excluded: excluded.length,
      flagged: files.filter((f) => f.flags.length > 0).length,
    },
  };
}

function sameRule(a: KeyRule, b: KeyRule): boolean {
  return a.strip === b.strip && a.prefix === b.prefix;
}

/**
 * The key map after the consultant confirmed `plan`: new models added, moved
 * ones at their new tool path, identities brought up to date (a tool id that
 * now identifies the model), absent ones kept (their keys stay taken),
 * entries sorted by key. After a `reset` plan the system's old entries are
 * gone.
 */
export function applyPlan(keymap: Keymap, plan: KeyPlan, exportName: string | null): Keymap {
  const stored = keymap.systems[plan.system];
  const base = plan.reset ? [] : (stored?.entries ?? []);
  const entries = new Map(base.map((e) => [e.key, e]));
  for (const f of plan.files) {
    entries.set(f.key, { key: f.key, externalId: f.externalId, externalPath: f.externalPath });
  }
  const sorted = [...entries.values()].sort((a, b) => compare(a.key, b.key));
  const identities = new Set<string>();
  for (const e of sorted) {
    const identity = identityOf(e);
    if (identities.has(identity)) {
      throw new KeymapError(`the plan gives ${identity} two keys; plan again`);
    }
    identities.add(identity);
  }
  return {
    format: KEYMAP_FORMAT,
    systems: {
      ...keymap.systems,
      [plan.system]: {
        rule: plan.rule,
        scope: plan.scope,
        exclude: plan.exclude,
        lastExport: exportName ?? (plan.reset ? null : (stored?.lastExport ?? null)),
        entries: sorted,
      },
    },
  };
}

/** The key map as written to `keymap.json`: two-space JSON with a final newline. */
export function formatKeymap(keymap: Keymap): string {
  const systems = Object.fromEntries(
    Object.entries(keymap.systems).sort(([a], [b]) => compare(a, b)),
  );
  return `${JSON.stringify({ format: keymap.format, systems }, null, 2)}\n`;
}

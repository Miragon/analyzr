/**
 * The workspace's key map `keymap.json` (M6 §3.4, §3.7): per source system the
 * key rule, the scope of a partial export, the tool folders left out and
 * `(externalId → key)` entries. Model keys are immutable in analyzr, so the
 * first import fixes them: a re-export reuses the key of every model the map
 * knows, by its tool id (also after a folder move in the tool), else by its
 * tool path. A tool id identifies a model only when it is unique in the export
 * and not generic (`Definitions_1`, a template's id). A lost or stale map is
 * rebuilt from the identities analyzr keeps (`rebuildFromAnalyzr`, M6 S2b
 * follow-up step 4). Planning and rebuilding are pure; writing happens only
 * after the consultant confirmed the plan.
 */
import { isModelKey, modelKeyFromPath } from '@analyzr/contracts/paths';

import { storedPath } from './declared.ts';
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

/** True for a strip folder a rule can name: a relative, `/`-separated tool path. */
const isStripFolder = (strip: string): boolean => strip !== '' && !/^\/|\/$|\\/.test(strip);

/** Checks a rule: `prefix` a valid model key, `strip` a relative tool path. */
export function assertRule(rule: KeyRule): void {
  if (rule.prefix !== null && !isModelKey(rule.prefix)) {
    throw new KeymapError(
      `invalid key prefix ${JSON.stringify(rule.prefix)}: a model key such as signavio`,
    );
  }
  if (rule.strip !== null && !isStripFolder(rule.strip)) {
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

/** The identity as analyzr keeps it: a tool path in its stored, tidied form ({@link storedPath}). */
function storedIdentityOf(m: { externalId: string | null; externalPath: string }): string {
  return m.externalId !== null ? `id:${m.externalId}` : `path:${storedPath(m.externalPath)}`;
}

/**
 * True if two tool paths name one place: equal, or equal as analyzr stores
 * them (a key map rebuilt from analyzr holds `Ordner/Prozess` for the
 * export's `Ordner/Prozess .bpmn`).
 */
function samePlace(a: string, b: string): boolean {
  return a === b || storedPath(a) === storedPath(b);
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
  // that the map knew without one keeps its key at the same place. The same
  // path first, then the same path as analyzr stores it (a map rebuilt from
  // analyzr: ends trimmed, control characters spaces).
  for (const same of [
    (a: string, b: string) => a === b,
    (a: string, b: string) => storedPath(a) === storedPath(b),
  ]) {
    for (const f of files) {
      if (matched.has(f)) continue;
      const raw = rawIds.get(f) ?? null;
      const candidates = entries
        .filter(
          (e) =>
            !used.has(e) &&
            same(e.externalPath, f.externalPath) &&
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
  }
  for (const [f, entry] of matched) {
    f.key = entry.key;
    // The map keeps the identity it had when the file's own id identifies nothing now.
    f.externalId ??= entry.externalId;
    if (samePlace(entry.externalPath, f.externalPath)) {
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

// ------------------------------------------------------------ rebuilt from analyzr

/**
 * A live model's identity in its source system as analyzr lists it (`GET
 * …/external-ids`, `analyzr models external-ids --json`, `analyzr-read.mjs
 * external-ids`): from its head's uploaded revision, `externalId` `null`
 * when the manifest named none, `externalPath` `null` when it named no tool
 * folder.
 */
export interface AnalyzrIdentity {
  key: string;
  system: string;
  externalId: string | null;
  externalPath: string | null;
}

/** How many of a system's keys a key rule derives from their tool paths. */
export interface RuleFits {
  matching: number;
  of: number;
}

/**
 * Keys of analyzr that carry one identity of the system: a tool id (not
 * generic), or without one the same tool path. `kept` is the key that keeps
 * it in the map, or `null` when nobody can tell (no model ids): the others
 * are likely imported twice (`analyzr models delete`).
 */
export interface RebuildDuplicate {
  externalId: string | null;
  /** For a tool path without a tool id: the path. */
  externalPath: string | null;
  /** `kept` first, then the others, oldest model first (else by key). */
  keys: string[];
  kept: string | null;
  /**
   * Why `kept` keeps it: `oldest`, its model is the oldest (the smallest
   * model id); `keymap`, the map already gives it that key, though another
   * model is older or no age is known (an entry never changes); `path`, the
   * oldest key with a tool path (an older one has none, so no entry can hold
   * it); `null` with `kept` `null`.
   */
  keptBy: 'oldest' | 'keymap' | 'path' | null;
}

/** An identity of analyzr the rebuild did not take into the map, and why. */
export interface RebuildConflict {
  key: string;
  externalId: string | null;
  externalPath: string;
  /**
   * `key-of-other-system`: another system of the map has the key;
   * `identity-taken`: an entry of the system has that tool id or path under
   * another key (`holder`).
   */
  reason: 'key-of-other-system' | 'identity-taken';
  holder: string;
}

/** What {@link rebuildFromAnalyzr} took from analyzr, for the consultant's confirmation. */
export interface RebuildReport {
  system: string;
  /**
   * The system was missing from the map and is rebuilt (rule 1); `false`:
   * the map had it (entries were added, rule 3), or analyzr has none of its
   * models with a tool path (its first import; the map stays as it was).
   */
  restored: boolean;
  /** The entries added to the map, by key. */
  entries: KeymapEntry[];
  /** The system's rule: inferred or given when restored, else the stored one. */
  rule: KeyRule;
  /** How many of analyzr's keys of the system (with a tool path) the rule derives. */
  ruleFits: RuleFits;
  duplicates: RebuildDuplicate[];
  /** Keys analyzr has without a tool path: no entry can identify them. */
  skipped: { key: string; externalId: string | null }[];
  conflicts: RebuildConflict[];
}

export interface RebuildOptions {
  system: string;
  /**
   * Model key → model id (`mdl_` and a ULID, so the smaller id is the older
   * model; `analyzr models list --json`, `analyzr-read.mjs models`): decides
   * which of several keys keeps a tool id.
   */
  modelIds?: ReadonlyMap<string, string>;
  /** The rule of a system missing from the map, instead of the inferred one. */
  rule?: KeyRule;
}

/** True if `key` is `derived` or what {@link freeKey} makes of it for a collision (`-2`, `-3`, …). */
function derivesTo(key: string, derived: string): boolean {
  if (key === derived) return true;
  const suffix = /-(?:[2-9]|[1-9]\d+)$/.exec(key)?.[0];
  if (suffix === undefined) return false;
  return key.slice(0, -suffix.length) === derived.slice(0, 200 - suffix.length).replace(/-+$/, '');
}

/** True if `rule` derives `pair.key` from its tool path (the file ending is not part of it). */
export function ruleFits(pair: { key: string; externalPath: string }, rule: KeyRule): boolean {
  const derived = deriveKey(`${pair.externalPath}.bpmn`, rule);
  return derived !== null && derivesTo(pair.key, derived);
}

/** Folders and segments a rule names: the simpler rule wins a tie. */
const ruleWeight = (rule: KeyRule): [number, number] => [
  Number(rule.strip !== null) + Number(rule.prefix !== null),
  (rule.strip?.split('/').length ?? 0) + (rule.prefix?.split('/').length ?? 0),
];

/** Every leading folder of a tool path (`A`, `A/B` of `A/B/c`). */
function foldersOf(externalPath: string): string[] {
  const segments = externalPath.split('/').slice(0, -1);
  return segments.map((_, i) => segments.slice(0, i + 1).join('/'));
}

/**
 * The key rule that derives most of a system's keys from their tool paths
 * (M6 S2b follow-up step 4, a key map rebuilt from analyzr): `strip` none or
 * a leading folder of a path, `prefix` none or leading key segments every key
 * shares. A key fits when the rule derives it, also with the suffix of a
 * collision (`-2`). The best fit wins, a tie the simpler rule (fewer parts,
 * then fewer segments, then the first in code-point order).
 */
export function inferRule(pairs: readonly { key: string; externalPath: string }[]): {
  rule: KeyRule;
  ruleFits: RuleFits;
} {
  const none: KeyRule = { strip: null, prefix: null };
  if (pairs.length === 0) return { rule: none, ruleFits: { matching: 0, of: 0 } };
  const [first = [], ...rest] = pairs.map((p) => p.key.split('/'));
  let shared = first.length - 1;
  for (const segments of rest) {
    let n = 0;
    while (n < Math.min(shared, segments.length - 1) && segments[n] === first[n]) n++;
    shared = n;
  }
  const prefixes = [
    null,
    ...first
      .slice(0, shared)
      .map((_, i) => first.slice(0, i + 1).join('/'))
      .filter((p) => isModelKey(p)),
  ];
  // A rule's fits: those without its strip folder as with no strip, plus the change for the
  // keys below it, so each pair derives once per own folder and prefix (n × depth, not n²).
  const base = new Map<string | null, number>();
  const below = new Map<string, number>();
  for (const pair of pairs) {
    for (const prefix of prefixes) {
      const plain = Number(ruleFits(pair, { strip: null, prefix }));
      base.set(prefix, (base.get(prefix) ?? 0) + plain);
      // Only folders a rule can name (a hand-written manifest's `/Root/x` or `A\B/x` gives none).
      for (const strip of foldersOf(pair.externalPath).filter(isStripFolder)) {
        const id = `${prefix ?? ''}\u0000${strip}`;
        below.set(id, (below.get(id) ?? 0) + Number(ruleFits(pair, { strip, prefix })) - plain);
      }
    }
  }
  const candidates: { rule: KeyRule; matching: number }[] = prefixes.map((prefix) => ({
    rule: { strip: null, prefix },
    matching: base.get(prefix) ?? 0,
  }));
  for (const [id, change] of below) {
    const at = id.indexOf('\u0000');
    const prefix = id.slice(0, at) === '' ? null : id.slice(0, at);
    candidates.push({
      rule: { strip: id.slice(at + 1), prefix },
      matching: (base.get(prefix) ?? 0) + change,
    });
  }
  const best = candidates.sort((a, b) => {
    const [ap, as] = ruleWeight(a.rule);
    const [bp, bs] = ruleWeight(b.rule);
    return (
      b.matching - a.matching ||
      ap - bp ||
      as - bs ||
      compare(a.rule.strip ?? '', b.rule.strip ?? '') ||
      compare(a.rule.prefix ?? '', b.rule.prefix ?? '')
    );
  })[0] ?? { rule: none, matching: 0 };
  return { rule: best.rule, ruleFits: { matching: best.matching, of: pairs.length } };
}

/** The older of two models by id (a ULID after `mdl_`); a key without an id counts as unknown. */
function byAge(
  keys: readonly string[],
  modelIds: ReadonlyMap<string, string> | undefined,
): { sorted: string[]; known: boolean } {
  const known = modelIds !== undefined && keys.every((k) => modelIds.has(k));
  const sorted = [...keys].sort((a, b) =>
    known ? compare(modelIds.get(a) ?? '', modelIds.get(b) ?? '') || compare(a, b) : compare(a, b),
  );
  return { sorted, known };
}

/**
 * The key map with a system rebuilt from analyzr's identities (M6 S2b
 * follow-up step 4), for a workspace whose `keymap.json` is lost or stale;
 * pure, `plan --write` stays the only writer:
 *
 * 1. A system missing from the map gets analyzr's live identities of that
 *    system as its entries, the key rule inferred from them
 *    ({@link inferRule}) or `options.rule`, the whole system as its scope
 *    and nothing excluded. A key without a tool path is skipped and listed.
 * 2. A tool id (not generic: those identify nothing, as in a plan) that
 *    several keys carry stays with the key the map already gives it, else
 *    with the key of the oldest model (the smallest model id) that has a
 *    tool path; the others keep their tool path only and are listed as
 *    `duplicates` (`keptBy` says why). Without model ids nobody keeps it
 *    (the plan then matches by path). Keys left with the same tool path and
 *    no tool id are resolved alike, the others dropped from the map
 *    (listed; without model ids all of them).
 * 3. A system the map has gets the keys analyzr has and the map lacks,
 *    unless an entry of it has that tool id or path (`conflicts`; a path as
 *    analyzr stores it, tidied); its entries, rule, scope and folders left
 *    out are never changed.
 * 4. Keys of other systems stay as they are; one of them in analyzr's list
 *    of this system is a conflict.
 *
 * A plan against the result treats the system as known (`firstImport`
 * false), so every file of a re-export that analyzr has keeps its key.
 */
export function rebuildFromAnalyzr(
  keymap: Keymap,
  identities: readonly AnalyzrIdentity[],
  options: RebuildOptions,
): { keymap: Keymap; report: RebuildReport } {
  const { system, modelIds } = options;
  assertSystem(system);
  if (options.rule !== undefined) assertRule(options.rule);
  const stored = keymap.systems[system];
  const live = identities
    .filter((i) => i.system === system)
    .map((i) => ({
      ...i,
      externalId: i.externalId !== null && isGenericExternalId(i.externalId) ? null : i.externalId,
    }))
    .sort((a, b) => compare(a.key, b.key));

  // Rule 2: one key per tool id; the map's holder first, else the oldest model with a tool path.
  const duplicates: RebuildDuplicate[] = [];
  const holderOf = (identity: string): string | undefined =>
    stored?.entries.find((e) => storedIdentityOf(e) === identity)?.key;
  const withPath = new Set(live.filter((i) => i.externalPath !== null).map((i) => i.key));
  const settle = (
    keys: string[],
    identity: string,
    describe: { externalId: string | null; externalPath: string | null },
  ): string | null => {
    const held = holderOf(identity);
    const { sorted, known } = byAge(keys, modelIds);
    const [oldest = null] = sorted;
    const kept =
      held !== undefined && keys.includes(held)
        ? held
        : known
          ? (sorted.find((k) => withPath.has(k)) ?? oldest)
          : null;
    duplicates.push({
      ...describe,
      keys: kept === null ? sorted : [kept, ...sorted.filter((k) => k !== kept)],
      kept,
      keptBy:
        kept === null
          ? null
          : known && kept === oldest
            ? 'oldest'
            : kept === held
              ? 'keymap'
              : 'path',
    });
    return kept;
  };
  const byId = new Map<string, string[]>();
  for (const i of live) {
    if (i.externalId !== null) byId.set(i.externalId, [...(byId.get(i.externalId) ?? []), i.key]);
  }
  const keeps = new Map<string, string | null>();
  for (const [id, keys] of byId) {
    if (keys.length > 1) {
      keeps.set(id, settle(keys, `id:${id}`, { externalId: id, externalPath: null }));
    }
  }
  const skipped: RebuildReport['skipped'] = [];
  let entries: KeymapEntry[] = [];
  for (const i of live) {
    const kept = i.externalId === null ? undefined : keeps.get(i.externalId);
    const externalId = kept === undefined || kept === i.key ? i.externalId : null;
    if (i.externalPath === null) skipped.push({ key: i.key, externalId });
    else entries.push({ key: i.key, externalId, externalPath: i.externalPath });
  }
  // Without a tool id the path identifies a model: one key per path.
  const byPath = new Map<string, string[]>();
  for (const e of entries) {
    if (e.externalId === null) {
      byPath.set(e.externalPath, [...(byPath.get(e.externalPath) ?? []), e.key]);
    }
  }
  const dropped = new Set<string>();
  for (const [p, keys] of byPath) {
    if (keys.length < 2) continue;
    const kept = settle(keys, `path:${p}`, { externalId: null, externalPath: p });
    for (const k of keys) if (k !== kept) dropped.add(k);
  }
  entries = entries.filter((e) => !dropped.has(e.key));

  // Rules 3 and 4: what the map has stays as it is.
  const conflicts: RebuildConflict[] = [];
  const otherKeys = new Map<string, string>();
  for (const [s, sys] of Object.entries(keymap.systems)) {
    if (s !== system) for (const e of sys.entries) otherKeys.set(e.key, s);
  }
  const own = new Map((stored?.entries ?? []).map((e) => [e.key, e]));
  const taken = new Map((stored?.entries ?? []).map((e) => [storedIdentityOf(e), e.key]));
  const added: KeymapEntry[] = [];
  for (const e of entries) {
    if (own.has(e.key)) continue;
    const other = otherKeys.get(e.key);
    const holder = taken.get(storedIdentityOf(e));
    if (other !== undefined || holder !== undefined) {
      conflicts.push({
        ...e,
        reason: other !== undefined ? 'key-of-other-system' : 'identity-taken',
        holder: other ?? holder ?? '',
      });
      continue;
    }
    taken.set(storedIdentityOf(e), e.key);
    added.push(e);
  }

  const pairs = live.flatMap((i) =>
    i.externalPath === null ? [] : [{ key: i.key, externalPath: i.externalPath }],
  );
  const inferred = stored === undefined && options.rule === undefined ? inferRule(pairs) : null;
  const rule = stored?.rule ?? options.rule ?? inferred?.rule ?? { strip: null, prefix: null };
  const fits = inferred?.ruleFits ?? {
    matching: pairs.filter((p) => ruleFits(p, rule)).length,
    of: pairs.length,
  };
  // Nothing of a system missing from the map in analyzr: its first import, the map unchanged.
  const restored = stored === undefined && added.length > 0;
  const next: SystemKeymap | undefined = stored
    ? { ...stored, entries: [...stored.entries, ...added].sort((a, b) => compare(a.key, b.key)) }
    : restored
      ? { rule, scope: null, exclude: [], lastExport: null, entries: added }
      : undefined;
  return {
    // Checked as a read key map is: unique keys over all systems, unique identities per system.
    keymap:
      next === undefined
        ? keymap
        : parseKeymap({ format: KEYMAP_FORMAT, systems: { ...keymap.systems, [system]: next } }),
    report: {
      system,
      restored,
      entries: added,
      rule,
      ruleFits: fits,
      duplicates,
      skipped,
      conflicts,
    },
  };
}

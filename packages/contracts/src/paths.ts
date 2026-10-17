/**
 * The BPMN file rule and the model key of a path (CONCEPT §4, M6 §8 S1), shared
 * by the server, the CLI and the web upload. Zod-free on purpose: the web
 * imports it at runtime as `@analyzr/contracts/paths` without pulling the
 * schemas into its entry chunk.
 */

/**
 * Regex source of a model key: lowercase slug segments separated by `/`,
 * e.g. `finanzen/rechnungsstellung` (CONCEPT §2, eval/README.md). The key is
 * immutable and is the slugified file path below the import root.
 */
export const MODEL_KEY_PATTERN = '[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)*';

export const MODEL_KEY_MAX_LENGTH = 200;

const MODEL_KEY_RE = new RegExp(`^${MODEL_KEY_PATTERN}$`);

/** True if `value` is a well-formed model key. */
export function isModelKey(value: string): boolean {
  return value.length <= MODEL_KEY_MAX_LENGTH && MODEL_KEY_RE.test(value);
}

/**
 * File endings of BPMN files (longest first): an import picks up exactly
 * these, and the model key drops them.
 */
export const BPMN_FILE_SUFFIXES = ['.bpmn20.xml', '.bpmn2', '.bpmn', '.xml'] as const;

export type BpmnFileSuffix = (typeof BPMN_FILE_SUFFIXES)[number];

/** The BPMN suffix `path` ends with (case-insensitive), or `null`. */
export function bpmnSuffixOf(path: string): BpmnFileSuffix | null {
  const lower = path.toLowerCase();
  return BPMN_FILE_SUFFIXES.find((suffix) => lower.endsWith(suffix)) ?? null;
}

/**
 * True if a segment of `path` (separated by `/` or `\`) starts with `.`:
 * `.git/…`, `._x.bpmn` (macOS resource forks), `.DS_Store`.
 */
export function isHiddenPath(path: string): boolean {
  return path.split(/[/\\]/).some((segment) => segment.startsWith('.'));
}

/** True if an import picks up `path`: a BPMN suffix, and no hidden file or folder. */
export function isImportPath(path: string): boolean {
  return bpmnSuffixOf(path) !== null && !isHiddenPath(path);
}

const TRANSLITERATION: Readonly<Record<string, string>> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

function slugSegment(segment: string): string {
  return segment
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => TRANSLITERATION[c] ?? c)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Model key of an imported file (CONCEPT §4: "the model key is the slugified
 * path"): the path below the import root without its BPMN extension, each
 * segment lowercased, transliterated (ä → ae, …) and reduced to `[a-z0-9-]`.
 * `Finanzen/Rechnungsstellung.bpmn` → `finanzen/rechnungsstellung`.
 *
 * @returns the key, or `null` if nothing valid remains
 */
export function modelKeyFromPath(path: string): string | null {
  let p = path.replaceAll('\\', '/');
  const lower = p.toLowerCase();
  const ext = BPMN_FILE_SUFFIXES.find((e) => lower.endsWith(e));
  if (ext) p = p.slice(0, -ext.length);
  const segments = p
    .split('/')
    .filter((s) => s !== '' && s !== '.' && s !== '..')
    .map(slugSegment)
    .filter((s) => s !== '');
  const key = segments.join('/');
  return key !== '' && isModelKey(key) ? key : null;
}

/**
 * The order of an import's files: by UTF-16 code units, as `Array.prototype.sort`
 * without a comparator, so the CLI and the web sort alike whatever the locale
 * (`localeCompare` puts `a_b.bpmn` before `a-b.bpmn`, code units the other way).
 */
export function comparePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The file each model key of an import goes to: the first path in
 * {@link comparePaths} order with a `.bpmn`, `.bpmn2` or `.bpmn20.xml` suffix,
 * and only for a key none of those has, the first plain `.xml`. A plain `.xml`
 * may be any XML of an export folder that the server finds to be no BPMN, so it
 * never takes a key from a BPMN-suffixed file, whichever sorts first
 * (`Order.xml` before `order.bpmn`). The CLI and the web pass the paths that may
 * be sent (no hidden file, at most 5 MB); a path without a valid key is left out.
 * `keyOf` gives a path's key: by default {@link modelKeyFromPath}, with an
 * import manifest the key it pins (M6 S2a) and else the path's.
 *
 * @returns model key → path of the file that gets it
 */
export function modelKeyOwners(
  paths: Iterable<string>,
  keyOf: (path: string) => string | null = modelKeyFromPath,
): Map<string, string> {
  const sorted = [...paths].sort(comparePaths);
  const owners = new Map<string, string>();
  for (const plainXml of [false, true]) {
    for (const path of sorted) {
      if ((bpmnSuffixOf(path) === '.xml') !== plainXml) continue;
      const key = keyOf(path);
      if (key !== null && !owners.has(key)) owners.set(key, path);
    }
  }
  return owners;
}

/**
 * The `.bpmn`, `.bpmn2` or `.bpmn20.xml` file that got the key of `path`
 * ({@link modelKeyOwners}) when `path` is a plain `.xml`: a tool's sidecar
 * `Prozess.xml` next to `Prozess.bpmn`. The CLI and the web skip such a file
 * (`key-taken`, naming this file) and never send it. `null` for every other
 * path: a BPMN-suffixed file, a plain `.xml` that has its key, and one whose
 * key another plain `.xml` has (a duplicate, which stays failed). `keyOf` as
 * for {@link modelKeyOwners}.
 */
export function keyTakenBy(
  path: string,
  owners: ReadonlyMap<string, string>,
  keyOf: (path: string) => string | null = modelKeyFromPath,
): string | null {
  if (bpmnSuffixOf(path) !== '.xml') return null;
  const key = keyOf(path);
  const owner = key === null ? undefined : owners.get(key);
  return owner !== undefined && bpmnSuffixOf(owner) !== '.xml' ? owner : null;
}

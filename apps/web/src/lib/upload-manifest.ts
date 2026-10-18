import type { ImportManifest, ManifestFile } from '@analyzr/contracts/import-manifest';

import { formatDate } from './labels';
import { IMPORT_MANIFEST_FILE } from './limits';
import { systemLabel } from './provenance';

/**
 * A dropped bundle's manifest `analyzr-import.json` (M6 S2a's web parts,
 * UX8; UX-SIMPLIFICATION.md §6), read as `analyzr import` reads it: at the
 * folder root, checked with the contracts' own `ImportManifest` (loaded with
 * a dynamic import, so zod stays out of the entry), its pinned keys for the
 * plan, and each batch's subset as the multipart part `manifest`. An invalid
 * manifest stops the upload before anything is sent; a folder whose bundles
 * lie in subfolders too (every key would start with the folder's name).
 */

export interface LoadedManifest {
  manifest: ImportManifest;
  /** The manifest's files by path below the folder root. */
  byPath: ReadonlyMap<string, ManifestFile>;
}

export type ManifestRead =
  | { kind: 'none' }
  | { kind: 'ok'; loaded: LoadedManifest }
  /** Stop before sending: `reason` in German, `detail` the parser's words for „Technische Details“. */
  | { kind: 'refused'; reason: string; detail?: string };

interface Entry {
  path: string;
  file: File;
}

/** The folders below the root that hold a manifest, sorted (`x/analyzr-import.json` → `x`). */
function nestedBundles(entries: readonly Entry[]): string[] {
  const suffix = `/${IMPORT_MANIFEST_FILE}`;
  return entries
    .filter((e) => e.path.endsWith(suffix))
    .map((e) => e.path.slice(0, -suffix.length))
    .sort();
}

/** Reads and checks the manifest at the root of a drop or a picked folder. */
export async function readManifest(entries: readonly Entry[]): Promise<ManifestRead> {
  const root = entries.find((e) => e.path === IMPORT_MANIFEST_FILE);
  if (!root) {
    const [first] = nestedBundles(entries);
    return first === undefined
      ? { kind: 'none' }
      : {
          kind: 'refused',
          reason: `In „${first}/“ liegt ein Bundle mit eigener ${IMPORT_MANIFEST_FILE}. Leg diesen Ordner selbst ab; sonst beginnt jeder Kurzname mit „${first.toLowerCase()}/“. Nichts importiert.`,
        };
  }
  let value: unknown;
  try {
    value = JSON.parse((await root.file.text()).replace(/^\uFEFF/, ''));
  } catch (error) {
    return {
      kind: 'refused',
      reason: `Die ${IMPORT_MANIFEST_FILE} des Bundles ist kein gültiges JSON. Nichts importiert.`,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  const { ImportManifest } = await import('@analyzr/contracts/import-manifest');
  const parsed = ImportManifest.safeParse(value);
  if (!parsed.success) {
    return {
      kind: 'refused',
      reason: `Die ${IMPORT_MANIFEST_FILE} des Bundles passt nicht zum Format analyzr-import/1. Wandle den Export mit dem aktuellen Konverter erneut um. Nichts importiert.`,
      detail: parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.length > 0 ? `${i.path.join('.')}: ` : ''}${i.message}`)
        .join('; '),
    };
  }
  return {
    kind: 'ok',
    loaded: {
      manifest: parsed.data,
      byPath: new Map(parsed.data.files.map((f) => [f.path, f])),
    },
  };
}

/** The manifest's subset for one batch: its format, its source and the files of `paths`. */
export function manifestSubset(loaded: LoadedManifest, paths: readonly string[]): ImportManifest {
  const files = paths.flatMap((p) => {
    const f = loaded.byPath.get(p);
    return f === undefined ? [] : [f];
  });
  return { format: loaded.manifest.format, source: loaded.manifest.source, files };
}

/**
 * The bundle's files that are no model: the manifest, its value chain and
 * its inventory, never sent with the models (as `analyzr import`) and not
 * listed as skipped.
 */
export function bundleFiles(loaded: LoadedManifest): ReadonlySet<string> {
  const { valueChain, inventory } = loaded.manifest;
  return new Set(
    [IMPORT_MANIFEST_FILE, valueChain?.path, inventory?.path].filter(
      (p): p is string => p !== undefined,
    ),
  );
}

/** What the upload says about a recognized bundle, under the dropzone. */
export interface BundleSummary {
  /** „Bundle erkannt: Signavio, exportiert am 14.10.2026 · 6 von 6 Dateien gelistet · Kurznamen aus dem Bundle“. */
  line: string;
  /** „2 Dateien stehen nicht im Bundle; sie bekommen ihren Pfad als Kurznamen.“, or `null`. */
  unlisted: string | null;
  /** The value chain the bundle carries (`valueChain.path`), for the next step. */
  valueChain: string | null;
}

/** The summary of a bundle for the BPMN files of the drop (`bpmnPaths`). */
export function bundleSummary(loaded: LoadedManifest, bpmnPaths: readonly string[]): BundleSummary {
  const { source } = loaded.manifest;
  const listed = bpmnPaths.filter((p) => loaded.byPath.has(p)).length;
  const missing = bpmnPaths.length - listed;
  const from = `Bundle erkannt: ${systemLabel(source.system)}${source.exportedAt ? `, exportiert am ${formatDate(source.exportedAt)}` : ''}`;
  return {
    line: `${from} · ${listed} von ${bpmnPaths.length} ${bpmnPaths.length === 1 ? 'Datei' : 'Dateien'} gelistet · Kurznamen aus dem Bundle`,
    unlisted:
      missing === 0
        ? null
        : missing === 1
          ? '1 Datei steht nicht im Bundle; sie bekommt ihren Pfad als Kurznamen.'
          : `${missing} Dateien stehen nicht im Bundle; sie bekommen ihren Pfad als Kurznamen.`,
    valueChain: loaded.manifest.valueChain?.path ?? null,
  };
}

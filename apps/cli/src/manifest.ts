/**
 * The import bundle's manifest `analyzr-import.json` (M6 §3.2, slice S2a) as
 * `analyzr import` reads it from the import root: checked with the
 * contracts' `ImportManifest` (as the server and the web check it) before
 * anything is sent (also before `--create` creates the project), the keys it
 * pins for the plan, and the subset each batch sends as its multipart part
 * `manifest`; a folder whose bundles lie in subfolders is refused. The
 * bundle's `.vc.json` and inventory are never sent with the models.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  IMPORT_MANIFEST_FILE,
  ImportManifest,
  ManifestImporter,
  comparePaths,
  type ManifestFile,
} from '@analyzr/contracts';

import { CliError } from './errors.ts';
import { walkFiles } from './files.ts';

export interface LoadedManifest {
  manifest: ImportManifest;
  /** The manifest's files by path below the import root. */
  byPath: ReadonlyMap<string, ManifestFile>;
}

/**
 * Reads `analyzr-import.json` at the import root, or `null` when there is
 * none.
 *
 * @throws {CliError} for a manifest that is no JSON or not `analyzr-import/1`
 */
export async function readManifest(dir: string): Promise<LoadedManifest | null> {
  let text: string;
  try {
    text = await readFile(path.join(dir, IMPORT_MANIFEST_FILE), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new CliError(
      `cannot read ${IMPORT_MANIFEST_FILE}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (err) {
    throw new CliError(
      `${IMPORT_MANIFEST_FILE} is no JSON: ${err instanceof Error ? err.message : String(err)}; nothing imported`,
    );
  }
  const parsed = ImportManifest.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.length > 0 ? `${i.path.join('.')}: ` : ''}${i.message}`);
    throw new CliError(
      `${IMPORT_MANIFEST_FILE} is not a valid analyzr-import/1 manifest (${issues.join('; ')})${writtenBy(value)}; nothing imported`,
    );
  }
  return {
    manifest: parsed.data,
    byPath: new Map(parsed.data.files.map((f) => [f.path, f])),
  };
}

/**
 * `; written by analyzr-integrate/normalize-bpmn 0.2.0: if that is newer than
 * this analyzr, update analyzr` when a refused manifest names its importer
 * (a newer converter may write a kind this analyzr does not know yet); empty
 * otherwise.
 */
function writtenBy(value: unknown): string {
  const source = (value as { source?: { importer?: unknown } } | null)?.source;
  const importer = ManifestImporter.safeParse(source?.importer);
  if (!importer.success) return '';
  return `; written by ${importer.data.name} ${importer.data.version}: if that is newer than this analyzr, update analyzr`;
}

/**
 * The folders below `dir` (`/`-separated, not `dir` itself) that hold an
 * `analyzr-import.json`, sorted: bundles inside the folder to import.
 */
export async function nestedManifests(dir: string): Promise<string[]> {
  const found = await walkFiles(
    dir,
    (rel) => rel.endsWith(`/${IMPORT_MANIFEST_FILE}`) && rel !== IMPORT_MANIFEST_FILE,
  );
  return found.map((rel) => rel.slice(0, -IMPORT_MANIFEST_FILE.length - 1)).sort(comparePaths);
}

/** The manifest's subset for one batch: its format, its source and the files of `paths`. */
export function manifestSubset(loaded: LoadedManifest, paths: readonly string[]): ImportManifest {
  const files = paths.flatMap((p) => {
    const f = loaded.byPath.get(p);
    return f === undefined ? [] : [f];
  });
  return { format: loaded.manifest.format, source: loaded.manifest.source, files };
}

/**
 * The files of an export: every regular file below a folder (or one file),
 * with `/`-separated paths below it, sorted by UTF-16 code units as analyzr's
 * CLI and web sort an import (`comparePaths`). Hidden files and folders (a
 * segment starting with `.`, e.g. `.DS_Store`, `__MACOSX/._x`) and symbolic
 * links are left out and counted.
 */
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';

import { comparePaths, isHiddenPath } from '@analyzr/contracts/paths';

export interface ExportFile {
  /** Path below the export folder with `/` separators (the file name for a single file). */
  path: string;
  /** Absolute path on disk. */
  absolute: string;
  size: number;
}

export interface ExportListing {
  files: ExportFile[];
  /** Hidden files and folders left out (a folder counts once). */
  hidden: number;
  /** Symbolic links left out. */
  symlinks: number;
}

/** Thrown when the export path does not exist or is neither a file nor a folder. */
export class ExportPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportPathError';
  }
}

/** Lists the export at `target` (a folder, or a single file). */
export async function listExport(target: string): Promise<ExportListing> {
  const absolute = path.resolve(target);
  const info = await lstat(absolute).catch(() => null);
  if (info === null) throw new ExportPathError(`${target} does not exist`);
  if (info.isSymbolicLink()) throw new ExportPathError(`${target} is a symbolic link`);
  if (info.isFile()) {
    return {
      files: [{ path: path.basename(absolute).normalize('NFC'), absolute, size: info.size }],
      hidden: 0,
      symlinks: 0,
    };
  }
  if (!info.isDirectory()) throw new ExportPathError(`${target} is neither a file nor a folder`);

  const files: ExportFile[] = [];
  let hidden = 0;
  let symlinks = 0;
  async function walk(rel: string): Promise<void> {
    const entries = await readdir(path.join(absolute, rel), { withFileTypes: true });
    for (const e of entries) {
      const child = rel === '' ? e.name : `${rel}/${e.name}`;
      if (isHiddenPath(e.name) || e.name === '__MACOSX') {
        hidden++;
      } else if (e.isSymbolicLink()) {
        symlinks++;
      } else if (e.isDirectory()) {
        await walk(child);
      } else if (e.isFile()) {
        const abs = path.join(absolute, child);
        // NFC, so a path reads the same on macOS and Linux (keys, tool paths, the manifest).
        files.push({ path: child.normalize('NFC'), absolute: abs, size: (await lstat(abs)).size });
      }
    }
  }
  await walk('');
  files.sort((a, b) => comparePaths(a.path, b.path));
  return { files, hidden, symlinks };
}

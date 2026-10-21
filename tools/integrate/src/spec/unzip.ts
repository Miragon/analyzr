/**
 * Zip archives of an export for the converter runner (M6 S3c §4.3): VSDX
 * and other Office files are zips of XML parts. The parent reads an
 * archive's central directory under guards before any converter code runs;
 * the child inflates one entry when the converter asks for it, never beyond
 * the size the directory declares, and checks its CRC. A module of its own,
 * so `src/zip.ts`, which inspect and normalize-bpmn bundle, stays unchanged.
 *
 * Guards: no ZIP64, no split archive, no encryption, only stored and deflated
 * entries; entry names stay inside the archive (no absolute path, drive,
 * backslash, `.` or `..` segment, empty segment or control character) and
 * are unique; no entry is a symbolic link (nothing is ever extracted to
 * disk, but a link entry has no content a converter should read as a file);
 * at most 64 MB per entry and 256 MB per archive as declared, and an entry
 * over 1 MB at most 200 times its compressed size; every entry's data lies in
 * the archive, before the central directory, and overlaps no other entry (an
 * overlap repeats one compressed stream in many entries). The entries are
 * listed sorted by name, as the export's files are, so a converter that walks
 * them gives the same result for an archive zipped in another order.
 */
import { crc32, inflateRawSync } from 'node:zlib';

export interface ZipLimits {
  /** Largest entry, uncompressed. */
  entryBytes: number;
  /** Largest sum of an archive's entries, uncompressed. */
  archiveBytes: number;
  /** Largest uncompressed : compressed ratio of an entry over {@link RATIO_FREE_BYTES}. */
  ratio: number;
  /** Most entries. */
  entries: number;
}

export const ZIP_LIMITS: ZipLimits = {
  entryBytes: 64 * 1024 * 1024,
  archiveBytes: 256 * 1024 * 1024,
  ratio: 200,
  entries: 10_000,
};

/** Entries up to this size are not held to the ratio (a short run of spaces compresses well). */
export const RATIO_FREE_BYTES = 1024 * 1024;

/** One file of an archive, as its central directory and local header declare it. */
export interface ZipFileEntry {
  /** Path inside the archive, `/`-separated. */
  name: string;
  /** Uncompressed size. */
  size: number;
  compressedSize: number;
  /** 0 stored, 8 deflated. */
  method: 0 | 8;
  /** CRC-32 of the uncompressed bytes (unsigned). */
  crc32: number;
  /** Offset of the entry's data in the archive. */
  dataOffset: number;
}

/** An archive's files (directories left out), or why it was not opened. */
export type ZipDirectory =
  { entries: ZipFileEntry[]; error: null } | { entries: []; error: string };

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;

/** True if `bytes` start like a zip archive (a local file header or an empty archive). */
export function looksZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06))
  );
}

/** Why an entry name would leave the archive or is no file path, or `null`. */
export function entryNameProblem(name: string): string | null {
  if (name === '' || name.length > 1024) return 'an empty or overlong entry name';
  if (/[\p{Cc}\p{Cs}]/u.test(name)) return 'an entry name with control characters';
  if (name.includes('\\')) return 'an entry name with a backslash';
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return 'an absolute entry name';
  const segments = name.replace(/\/$/, '').split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    return 'an entry name with an empty, "." or ".." segment';
  }
  return null;
}

function refused(error: string): ZipDirectory {
  return { entries: [], error };
}

/** The file type bits of a Unix mode, and a symbolic link's. */
const UNIX_TYPE = 0o170000;
const UNIX_LINK = 0o120000;
/** The "version made by" host of Unix (the upper byte), whose external attributes hold a mode. */
const HOST_UNIX = 3;

/**
 * The files of the zip archive in `bytes`, or the guard it fails (see the
 * module comment). Directory entries are left out; the files are sorted by
 * name (code unit order, as `comparePaths` sorts an export's files).
 */
export function readZipDirectory(bytes: Uint8Array, limits: ZipLimits = ZIP_LIMITS): ZipDirectory {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return refused('no end of central directory record: not a readable zip archive');
  if (eocd >= 20 && view.getUint32(eocd - 20, true) === ZIP64_LOCATOR) {
    return refused('a ZIP64 archive');
  }
  const disk = view.getUint16(eocd + 4, true);
  const cdDisk = view.getUint16(eocd + 6, true);
  const onDisk = view.getUint16(eocd + 8, true);
  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    return refused('a ZIP64 archive');
  }
  if (disk !== 0 || cdDisk !== 0 || onDisk !== count) return refused('a split archive');
  if (count > limits.entries) return refused(`more than ${limits.entries} entries`);
  if (cdOffset + cdSize > eocd) return refused('the central directory lies outside the archive');

  const utf8 = new TextDecoder('utf-8', { fatal: true });
  const cp437 = new TextDecoder('windows-1252');
  const entries: ZipFileEntry[] = [];
  const names = new Set<string>();
  /** Every entry's local header and data, directories included, to check for overlaps. */
  const spans: { start: number; end: number }[] = [];
  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > cdOffset + cdSize || view.getUint32(p, true) !== CENTRAL) {
      return refused(`central directory entry ${n + 1} is malformed`);
    }
    const madeBy = view.getUint16(p + 4, true);
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const compressedSize = view.getUint32(p + 20, true);
    const size = view.getUint32(p + 24, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const externalAttrs = view.getUint32(p + 38, true);
    const localOffset = view.getUint32(p + 42, true);
    const end = p + 46 + nameLength + extraLength + commentLength;
    if (end > cdOffset + cdSize) return refused(`central directory entry ${n + 1} is malformed`);
    let name: string;
    try {
      // Bit 11: the name is UTF-8; otherwise CP437, read as windows-1252 (as src/zip.ts lists it).
      name = (flags & 0x0800 ? utf8 : cp437).decode(bytes.subarray(p + 46, p + 46 + nameLength));
    } catch {
      return refused(`entry ${n + 1} has a name that is not UTF-8`);
    }
    p = end;
    const shown = JSON.stringify(name.slice(0, 80));
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
      return refused('a ZIP64 archive');
    }
    const nameProblem = entryNameProblem(name);
    if (nameProblem !== null) return refused(`${nameProblem}: ${shown}`);
    if (flags & 0x0001) return refused(`an encrypted entry: ${shown}`);
    if (madeBy >>> 8 === HOST_UNIX && ((externalAttrs >>> 16) & UNIX_TYPE) === UNIX_LINK) {
      return refused(`the entry ${shown} is a symbolic link`);
    }
    if (names.has(name)) return refused(`the entry ${shown} appears twice`);
    names.add(name);

    if (localOffset + 30 > cdOffset || view.getUint32(localOffset, true) !== LOCAL) {
      return refused(`the local header of ${shown} is missing`);
    }
    const dataOffset =
      localOffset +
      30 +
      view.getUint16(localOffset + 26, true) +
      view.getUint16(localOffset + 28, true);
    if (dataOffset + compressedSize > cdOffset) {
      return refused(`the data of ${shown} lies outside the archive`);
    }
    spans.push({ start: localOffset, end: dataOffset + compressedSize });
    if (name.endsWith('/')) continue; // a directory
    if (method !== 0 && method !== 8) {
      return refused(
        `the entry ${shown} uses compression method ${method} (stored or deflated only)`,
      );
    }
    if (method === 0 && compressedSize !== size) {
      return refused(`the stored entry ${shown} declares two sizes`);
    }
    if (size > limits.entryBytes) {
      return refused(
        `the entry ${shown} has ${size} bytes; a converter reads entries of at most ${limits.entryBytes} bytes`,
      );
    }
    if (size > RATIO_FREE_BYTES && size > limits.ratio * compressedSize) {
      return refused(
        `the entry ${shown} would grow ${Math.round(size / Math.max(compressedSize, 1))} times (at most ${limits.ratio})`,
      );
    }
    total += size;
    if (total > limits.archiveBytes) {
      return refused(`its entries have more than ${limits.archiveBytes} bytes`);
    }
    entries.push({ name, size, compressedSize, method, crc32: crc, dataOffset });
  }
  spans.sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++) {
    const before = spans[i - 1];
    const span = spans[i];
    if (before !== undefined && span !== undefined && span.start < before.end) {
      return refused('two entries share their data');
    }
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { entries, error: null };
}

/** Thrown when an entry's data does not inflate to what the directory declares. */
export class ZipEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipEntryError';
  }
}

/**
 * The uncompressed bytes of `entry` of the archive in `bytes` (an entry
 * {@link readZipDirectory} returned): never more than its declared size, and
 * only when their length and CRC-32 match the directory.
 *
 * @throws {ZipEntryError} for damaged data
 */
export function inflateEntry(bytes: Uint8Array, entry: ZipFileEntry): Uint8Array {
  const data = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  let out: Uint8Array;
  if (entry.method === 0) {
    out = data;
  } else {
    try {
      out = inflateRawSync(data, { maxOutputLength: Math.max(entry.size, 1) });
    } catch {
      throw new ZipEntryError(
        `the entry ${JSON.stringify(entry.name)} is damaged: it does not inflate to its declared ${entry.size} bytes`,
      );
    }
  }
  if (out.length !== entry.size || crc32(out) !== entry.crc32) {
    throw new ZipEntryError(
      `the entry ${JSON.stringify(entry.name)} is damaged: its size or checksum differs from the archive's directory`,
    );
  }
  return out;
}

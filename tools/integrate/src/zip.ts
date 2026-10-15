/**
 * Lists a zip archive's entries from its central directory, without
 * decompressing anything (inspect: "zip contents"). Office formats (VSDX,
 * XLSX, DOCX, PPTX) are zips too and are recognized by their parts.
 */

export interface ZipEntry {
  name: string;
  /** Uncompressed size as declared (`null` for ZIP64 sizes). */
  size: number | null;
}

export interface ZipListing {
  /** Entries in central directory order, at most `limit`. */
  entries: ZipEntry[];
  /** Number of entries the central directory declares. */
  count: number;
  truncated: boolean;
  /** An Office Open XML package recognized by its parts, else `null`. */
  format: 'vsdx' | 'xlsx' | 'docx' | 'pptx' | null;
  /** Set when the archive could not be read; `entries` holds what was read before. */
  error?: string;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

/** True if `bytes` start like a zip archive (local file header or an empty archive). */
export function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06))
  );
}

/** Lists up to `limit` entries of the zip archive in `bytes`. */
export function listZip(bytes: Uint8Array, limit = 1000): ZipListing {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: ZipEntry[] = [];
  const result = (count: number, error?: string): ZipListing => {
    const names = entries.map((e) => e.name);
    const has = (prefix: string): boolean => names.some((n) => n.startsWith(prefix));
    const office = names.includes('[Content_Types].xml');
    const format = !office
      ? null
      : has('visio/')
        ? 'vsdx'
        : has('xl/')
          ? 'xlsx'
          : has('word/')
            ? 'docx'
            : has('ppt/')
              ? 'pptx'
              : null;
    return {
      entries,
      count,
      truncated: count > entries.length,
      format,
      ...(error === undefined ? {} : { error }),
    };
  };

  // The end of central directory record: 22 bytes plus a comment of up to 65,535 bytes.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return result(0, 'no end of central directory record');
  const count = view.getUint16(eocd + 10, true);
  const offset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || offset === 0xffffffff) return result(count, 'ZIP64 archive: not listed');
  let p = offset;
  const utf8 = new TextDecoder('utf-8');
  const cp437 = new TextDecoder('windows-1252');
  for (let n = 0; n < count && entries.length < limit; n++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== CENTRAL) {
      return result(count, `central directory entry ${n + 1} is malformed`);
    }
    const flags = view.getUint16(p + 8, true);
    const size = view.getUint32(p + 24, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameLength);
    // Bit 11: the name is UTF-8; otherwise CP437, read here as windows-1252.
    const name = (flags & 0x0800 ? utf8 : cp437).decode(nameBytes);
    entries.push({ name, size: size === 0xffffffff ? null : size });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return result(count);
}

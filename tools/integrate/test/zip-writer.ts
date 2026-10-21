// A small zip writer for the converter tests: the VSDX fixtures are built from their XML parts
// (test/fixtures/converters/visio/), and each zip guard gets an archive that breaks it.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipInput {
  name: string;
  data: Uint8Array;
  /** 0 stored, 8 deflated (default). */
  method?: number;
  /** Overrides of what the headers declare (for archives that break a guard). */
  declaredSize?: number;
  declaredCompressedSize?: number;
  flags?: number;
  /** The raw name bytes instead of the UTF-8 of `name`. */
  rawName?: Uint8Array;
  /** A Unix mode (e.g. `0o120777`, a symbolic link): "made by" Unix, the mode in the external attributes. */
  unixMode?: number;
}

export interface ZipOptions {
  /** Write a ZIP64 end of central directory locator before the end record. */
  zip64Locator?: boolean;
  /** Overrides the end record's entry count. */
  count?: number;
  /** Point every entry's local header at the first one (overlapping data). */
  overlap?: boolean;
}

/** A zip archive of `entries`, in their order. */
export function zipOf(entries: readonly ZipInput[], options: ZipOptions = {}): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const offsets: number[] = [];
  for (const e of entries) {
    const method = e.method ?? 8;
    const data = method === 8 ? deflateRawSync(e.data) : Buffer.from(e.data);
    const name = Buffer.from(e.rawName ?? new TextEncoder().encode(e.name));
    const flags = e.flags ?? 0x0800;
    const size = e.declaredSize ?? e.data.length;
    const compressed = e.declaredCompressedSize ?? data.length;
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    const at = options.overlap === true && offsets.length > 0 ? (offsets[0] ?? 0) : offset;
    offsets.push(at);
    if (!(options.overlap === true && locals.length > 0)) {
      locals.push(local, name, data);
      offset += local.length + name.length + data.length;
    }
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(e.unixMode === undefined ? 20 : 0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    if (e.unixMode !== undefined) central.writeUInt32LE((e.unixMode << 16) >>> 0, 38);
    central.writeUInt32LE(at, 42);
    centrals.push(central, name);
  }
  const cd = Buffer.concat(centrals);
  const tail: Buffer[] = [];
  if (options.zip64Locator === true) {
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    tail.push(locator);
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(options.count ?? entries.length, 8);
  eocd.writeUInt16LE(options.count ?? entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, ...tail, eocd]));
}

/**
 * Every file below `dir` (dot files included) as zip entries, sorted by path; `edits` change the
 * text of the named entries (for variants of a fixture).
 */
export async function zipFolder(
  dir: string,
  edits: Readonly<Record<string, (text: string) => string>> = {},
): Promise<Uint8Array> {
  const entries: ZipInput[] = [];
  async function walk(rel: string): Promise<void> {
    for (const e of await readdir(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel === '' ? e.name : `${rel}/${e.name}`;
      const edit = edits[child];
      if (e.isDirectory()) await walk(child);
      else if (edit === undefined) {
        entries.push({ name: child, data: await readFile(path.join(dir, child)) });
      } else {
        const text = await readFile(path.join(dir, child), 'utf8');
        const changed = edit(text);
        if (changed === text) throw new Error(`the edit of ${child} changed nothing`);
        entries.push({ name: child, data: new TextEncoder().encode(changed) });
      }
    }
  }
  await walk('');
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return zipOf(entries);
}

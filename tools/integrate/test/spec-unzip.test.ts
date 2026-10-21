// The zip reader of the converter runner (src/spec/unzip.ts, M6 S3c §4.3 step 3): the central
// directory with each entry's data, read under its guards (no ZIP64, split archive or encryption;
// names inside the archive; no link entries; sizes, ratio, overlaps), the files sorted by name, and
// an entry inflated only to its declared size and checksum.
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  entryNameProblem,
  inflateEntry,
  looksZip,
  readZipDirectory,
  ZIP_LIMITS,
  ZipEntryError,
} from '../src/spec/unzip.ts';
import { listZip } from '../src/zip.ts';

import { CONVERTER_FIXTURES } from './converter-support.ts';
import { zipFolder, zipOf, type ZipInput } from './zip-writer.ts';

const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const entry = (name: string, data = text('<a/>'), extra: Partial<ZipInput> = {}): ZipInput => ({
  name,
  data,
  ...extra,
});
const error = (bytes: Uint8Array, limits = ZIP_LIMITS): string | null =>
  readZipDirectory(bytes, limits).error;

/** The archive's first file entry (fails the test when there is none). */
function first(bytes: Uint8Array) {
  const read = readZipDirectory(bytes);
  expect(read.error).toBeNull();
  const found = read.entries[0];
  if (found === undefined) throw new Error('no entry');
  return found;
}

describe('readZipDirectory', () => {
  it('lists a VSDX as inspect does, with each entry inflated back to its bytes', async () => {
    const vsdx = await zipFolder(path.join(CONVERTER_FIXTURES, 'visio', 'prozesse'));
    expect(looksZip(vsdx)).toBe(true);
    const read = readZipDirectory(vsdx);
    expect(read.error).toBeNull();
    expect(read.entries.map((e) => e.name)).toEqual(listZip(vsdx).entries.map((e) => e.name));
    expect(listZip(vsdx).format).toBe('vsdx');
    const pages = read.entries.find((e) => e.name === 'visio/pages/pages.xml');
    expect(pages).toBeDefined();
    if (pages !== undefined) {
      expect(new TextDecoder().decode(inflateEntry(vsdx, pages))).toMatch(
        /^<\?xml[\s\S]*<Page ID="2" NameU="Legende"/,
      );
    }
  });

  it('lists the files sorted by name, whatever order the archive has them in', () => {
    const zip = zipOf([entry('b/z.xml'), entry('a.xml'), entry('b/a.xml'), entry('B.xml')]);
    expect(readZipDirectory(zip).entries.map((e) => e.name)).toEqual([
      'B.xml',
      'a.xml',
      'b/a.xml',
      'b/z.xml',
    ]);
  });

  it('refuses a symbolic link entry, and takes other Unix entries', () => {
    expect(
      error(
        zipOf([entry('a.xml'), entry('link.xml', text('/etc/passwd'), { unixMode: 0o120777 })]),
      ),
    ).toBe('the entry "link.xml" is a symbolic link');
    expect(error(zipOf([entry('a.xml', text('<a/>'), { unixMode: 0o100644 })]))).toBeNull();
  });

  it('leaves directories out and reads stored entries', () => {
    const zip = zipOf([
      entry('ordner/'),
      entry('ordner/a.bin', new Uint8Array([1, 2, 3]), { method: 0 }),
    ]);
    const read = readZipDirectory(zip);
    expect(read.entries.map((e) => [e.name, e.method, e.size])).toEqual([['ordner/a.bin', 0, 3]]);
    expect(Array.from(inflateEntry(zip, first(zip)))).toEqual([1, 2, 3]);
  });

  it('refuses names that leave the archive or are no file path', () => {
    for (const name of [
      '../boese.xml',
      'a/../../b.xml',
      '/etc/passwd',
      'C:/x.xml',
      'c:x',
      'a\\b.xml',
      'a//b.xml',
      './a.xml',
      'a/./b.xml',
      'a\u0000b',
      '',
    ]) {
      expect(error(zipOf([entry(name)])), JSON.stringify(name)).toMatch(/entry name/);
    }
    expect(entryNameProblem('visio/pages/page1.xml')).toBeNull();
    expect(entryNameProblem('[Content_Types].xml')).toBeNull();
    expect(error(zipOf([entry('a.xml'), entry('a.xml')]))).toBe('the entry "a.xml" appears twice');
    expect(
      error(
        zipOf([entry('x', text('<a/>'), { rawName: new Uint8Array([0xff, 0xfe]), flags: 0x0800 })]),
      ),
    ).toBe('entry 1 has a name that is not UTF-8');
    // without the UTF-8 flag a name is CP437, read as windows-1252 (as inspect lists it)
    expect(
      readZipDirectory(
        zipOf([
          entry('x', text('<a/>'), { rawName: new Uint8Array([0x84, 0x2e, 0x78]), flags: 0 }),
        ]),
      ).entries[0]?.name,
    ).toBe('„.x');
  });

  it('refuses ZIP64, split and encrypted archives, other compression methods and broken records', () => {
    expect(error(zipOf([entry('a.xml')], { zip64Locator: true }))).toBe('a ZIP64 archive');
    expect(error(zipOf([entry('a.xml', text('<a/>'), { declaredSize: 0xffffffff })]))).toBe(
      'a ZIP64 archive',
    );
    const split = zipOf([entry('a.xml')]);
    split[split.length - 22 + 4] = 1;
    expect(error(split)).toBe('a split archive');
    expect(error(zipOf([entry('a.xml', text('<a/>'), { flags: 0x0801 })]))).toBe(
      'an encrypted entry: "a.xml"',
    );
    expect(error(zipOf([entry('a.xml', text('<a/>'), { method: 12 })]))).toBe(
      'the entry "a.xml" uses compression method 12 (stored or deflated only)',
    );
    expect(
      error(zipOf([entry('a.xml', text('<a/>'), { method: 0, declaredCompressedSize: 3 })])),
    ).toBe('the stored entry "a.xml" declares two sizes');
    expect(error(text('PK\u0003\u0004 kein Archiv'))).toBe(
      'no end of central directory record: not a readable zip archive',
    );
    expect(error(zipOf([entry('a.xml')], { count: 2 }))).toBe(
      'central directory entry 2 is malformed',
    );
    const outside = zipOf([entry('a.xml', text('<a/>'), { declaredCompressedSize: 5000 })]);
    expect(error(outside)).toBe('the data of "a.xml" lies outside the archive');
  });

  it('refuses entries that share their data', () => {
    expect(error(zipOf([entry('a.xml'), entry('b.xml')], { overlap: true }))).toBe(
      'two entries share their data',
    );
  });

  it('holds the size limits and the ratio as declared', () => {
    const small = { ...ZIP_LIMITS, entryBytes: 100, archiveBytes: 150, entries: 2 };
    expect(error(zipOf([entry('a.xml', new Uint8Array(101))]), small)).toBe(
      'the entry "a.xml" has 101 bytes; a converter reads entries of at most 100 bytes',
    );
    expect(
      error(zipOf([entry('a.xml', new Uint8Array(80)), entry('b.xml', new Uint8Array(80))]), small),
    ).toBe('its entries have more than 150 bytes');
    expect(error(zipOf([entry('a'), entry('b'), entry('c')]), small)).toBe('more than 2 entries');
    // a megabyte of zeros is no bomb; four are
    expect(error(zipOf([entry('a.xml', new Uint8Array(1024 * 1024))]))).toBeNull();
    expect(error(zipOf([entry('a.xml', new Uint8Array(4 * 1024 * 1024))]))).toMatch(
      /^the entry "a\.xml" would grow \d+ times \(at most 200\)$/,
    );
    // a lying size is caught when the entry is inflated: never beyond the declared size
    const lying = zipOf([entry('a.xml', new Uint8Array(4096), { declaredSize: 100 })]);
    expect(() => inflateEntry(lying, first(lying))).toThrow(ZipEntryError);
    expect(() => inflateEntry(lying, first(lying))).toThrow(
      'the entry "a.xml" is damaged: it does not inflate to its declared 100 bytes',
    );
  });

  it('checks the size and checksum of every inflated entry', () => {
    const short = zipOf([entry('a.xml', text('<a/>'), { declaredSize: 10 })]);
    expect(() => inflateEntry(short, first(short))).toThrow(/its size or checksum differs/);
    const flipped = Buffer.from(zipOf([entry('a.xml', text('<a/>'), { method: 0 })]));
    flipped[30 + 'a.xml'.length] = 0x3e;
    expect(() => inflateEntry(flipped, first(flipped))).toThrow(/its size or checksum differs/);
  });
});

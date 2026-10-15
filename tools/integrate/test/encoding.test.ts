// Encoding detection and strict decoding (src/encoding.ts).
import { describe, expect, it } from 'vitest';

import {
  decodeText,
  declaredEncoding,
  detectEncoding,
  EncodingError,
  isAscii,
  looksBinary,
} from '../src/encoding.ts';

const utf16le = (text: string, bom = true): Uint8Array =>
  new Uint8Array([...(bom ? [0xff, 0xfe] : []), ...Buffer.from(text, 'utf16le')]);
const utf16be = (text: string): Uint8Array => {
  const le = Buffer.from(text, 'utf16le');
  const be = Buffer.alloc(le.length);
  for (let i = 0; i < le.length; i += 2) {
    be[i] = le[i + 1] ?? 0;
    be[i + 1] = le[i] ?? 0;
  }
  return new Uint8Array([0xfe, 0xff, ...be]);
};

describe('detectEncoding', () => {
  it('reads byte order marks and the declaration behind them', () => {
    expect(detectEncoding(utf16le('<?xml version="1.0" encoding="UTF-16"?><a/>'))).toEqual({
      encoding: 'utf-16le',
      bom: true,
      declared: 'UTF-16',
      source: 'bom',
    });
    expect(detectEncoding(utf16be('<?xml version="1.0"?><a/>'))).toMatchObject({
      encoding: 'utf-16be',
      bom: true,
      declared: null,
    });
    expect(
      detectEncoding(new Uint8Array([0xef, 0xbb, 0xbf, 0x3c, 0x61, 0x2f, 0x3e])),
    ).toMatchObject({
      encoding: 'utf-8',
      bom: true,
      source: 'bom',
    });
  });

  it('recognizes UTF-16 without a byte order mark by `<?`', () => {
    expect(detectEncoding(utf16le('<?xml version="1.0"?><a/>', false))).toMatchObject({
      encoding: 'utf-16le',
      bom: false,
      source: 'utf-16-pattern',
    });
  });

  it('follows the declaration of an ASCII-compatible encoding, else UTF-8', () => {
    const latin = Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><a>ü</a>', 'latin1');
    expect(detectEncoding(new Uint8Array(latin))).toEqual({
      encoding: 'windows-1252',
      bom: false,
      declared: 'ISO-8859-1',
      source: 'declaration',
    });
    expect(detectEncoding(new TextEncoder().encode('<a/>'))).toMatchObject({
      encoding: 'utf-8',
      declared: null,
      source: 'default',
    });
  });
});

describe('decodeText', () => {
  it('decodes UTF-16 and the declared Latin-1 without a byte order mark', () => {
    expect(decodeText(utf16le('<a>Prüfen</a>'))).toBe('<a>Prüfen</a>');
    const latin = Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><a>Prüfen</a>', 'latin1');
    expect(decodeText(new Uint8Array(latin))).toContain('<a>Prüfen</a>');
  });

  it('refuses invalid UTF-8 and unknown declared encodings', () => {
    const invalid = new Uint8Array([0x3c, 0x61, 0x3e, 0xfc, 0x3c, 0x2f, 0x61, 0x3e]);
    expect(() => decodeText(invalid)).toThrow(EncodingError);
    expect(() => decodeText(invalid)).toThrow(/not valid UTF-8 and no other encoding is declared/);
    const unknown = new TextEncoder().encode('<?xml version="1.0" encoding="X-UNKNOWN"?><a/>');
    expect(() => decodeText(unknown)).toThrow(/X-UNKNOWN.*not supported/);
  });
});

describe('helpers', () => {
  it('reads the declaration only at the start', () => {
    expect(declaredEncoding(`<?xml version='1.0' encoding='utf-8'?>`)).toBe('utf-8');
    expect(declaredEncoding('<a encoding="utf-8"/>')).toBeNull();
  });

  it('tells ASCII and binary bytes apart', () => {
    expect(isAscii(new TextEncoder().encode('<a/>'))).toBe(true);
    expect(isAscii(new TextEncoder().encode('<a>ü</a>'))).toBe(false);
    expect(looksBinary(new Uint8Array([0x50, 0x00, 0x01]))).toBe(true);
    expect(looksBinary(utf16le('<a/>'))).toBe(false);
  });
});

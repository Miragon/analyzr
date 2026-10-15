/**
 * Character encodings of export files (M6 §3.7): detected from a byte order
 * mark, the UTF-16 pattern of `<?` and the XML declaration, and decoded with
 * `TextDecoder` (strict: invalid bytes are an error, never replaced). analyzr
 * reads UTF-8 only (`packages/bpmn-facts/src/input.ts`), so normalize-bpmn
 * transcodes every other encoding to UTF-8.
 */

/** How {@link DetectedEncoding.encoding} was chosen. */
export type EncodingSource = 'bom' | 'utf-16-pattern' | 'declaration' | 'default';

export interface DetectedEncoding {
  /** The `TextDecoder` label the bytes decode with (lowercase), e.g. `utf-8`, `utf-16le`, `windows-1252`. */
  encoding: string;
  /** A byte order mark was present. */
  bom: boolean;
  /** The XML declaration's `encoding` as written, `null` without one. */
  declared: string | null;
  source: EncodingSource;
}

/** Thrown when bytes cannot be decoded: an unknown declared encoding or invalid bytes. */
export class EncodingError extends Error {
  readonly code: 'unsupported-encoding' | 'invalid-bytes';

  constructor(code: EncodingError['code'], message: string) {
    super(message);
    this.name = 'EncodingError';
    this.code = code;
  }
}

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);
}

/** The `encoding` pseudo-attribute of an XML declaration in `head`, or `null`. */
export function declaredEncoding(head: string): string | null {
  const decl = /^\s*<\?xml\s[^?]*\?>/.exec(head);
  if (!decl) return null;
  const match = /\sencoding\s*=\s*(["'])([A-Za-z][A-Za-z0-9._-]*)\1/.exec(decl[0]);
  return match?.[2] ?? null;
}

/** The `TextDecoder` label for an encoding name, or `null` if `TextDecoder` does not know it. */
export function decoderLabel(name: string): string | null {
  try {
    return new TextDecoder(name).encoding;
  } catch {
    return null;
  }
}

/** Detects the encoding of `bytes` (deterministic; nothing is decoded yet). */
export function detectEncoding(bytes: Uint8Array): DetectedEncoding {
  if (startsWith(bytes, UTF8_BOM)) {
    return withDeclared({ encoding: 'utf-8', bom: true, source: 'bom' }, bytes.subarray(3));
  }
  if (startsWith(bytes, [0xff, 0xfe])) {
    return withDeclared({ encoding: 'utf-16le', bom: true, source: 'bom' }, bytes.subarray(2));
  }
  if (startsWith(bytes, [0xfe, 0xff])) {
    return withDeclared({ encoding: 'utf-16be', bom: true, source: 'bom' }, bytes.subarray(2));
  }
  // `<?` without a byte order mark (XML 1.0 Appendix F).
  if (startsWith(bytes, [0x3c, 0x00, 0x3f, 0x00])) {
    return withDeclared({ encoding: 'utf-16le', bom: false, source: 'utf-16-pattern' }, bytes);
  }
  if (startsWith(bytes, [0x00, 0x3c, 0x00, 0x3f])) {
    return withDeclared({ encoding: 'utf-16be', bom: false, source: 'utf-16-pattern' }, bytes);
  }
  // ASCII-compatible: the declaration names the encoding.
  const declared = declaredEncoding(latin1(bytes.subarray(0, 512)));
  const label = declared === null ? null : decoderLabel(declared);
  if (declared !== null && label !== null && !label.startsWith('utf-16')) {
    return { encoding: label, bom: false, declared, source: 'declaration' };
  }
  return { encoding: 'utf-8', bom: false, declared, source: 'default' };
}

function latin1(bytes: Uint8Array): string {
  return new TextDecoder('windows-1252').decode(bytes);
}

function withDeclared(
  found: Omit<DetectedEncoding, 'declared'>,
  rest: Uint8Array,
): DetectedEncoding {
  let head: string;
  try {
    head = new TextDecoder(found.encoding).decode(rest.subarray(0, 1024));
  } catch {
    head = '';
  }
  return { ...found, declared: declaredEncoding(head) };
}

/**
 * Decodes `bytes` strictly (no replacement characters), without a byte order
 * mark.
 *
 * @throws {EncodingError} for a declared encoding `TextDecoder` does not know, or bytes invalid in it
 */
export function decodeText(bytes: Uint8Array, detected = detectEncoding(bytes)): string {
  if (detected.declared !== null && detected.source === 'default') {
    const label = decoderLabel(detected.declared);
    if (label === null) {
      throw new EncodingError(
        'unsupported-encoding',
        `the declared encoding ${JSON.stringify(detected.declared)} is not supported`,
      );
    }
  }
  try {
    // ignoreBOM false (the default) strips a byte order mark of the decoder's encoding.
    return new TextDecoder(detected.encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new EncodingError(
      'invalid-bytes',
      `the bytes are not valid ${detected.encoding.toUpperCase()}${
        detected.source === 'default' ? ' and no other encoding is declared' : ''
      }`,
    );
  }
}

/** True if every byte is below 0x80. */
export function isAscii(bytes: Uint8Array): boolean {
  return bytes.every((b) => b < 0x80);
}

/** True for bytes that look like a binary file: a NUL byte in the first 8 KiB and no UTF-16 marker. */
export function looksBinary(bytes: Uint8Array, detected = detectEncoding(bytes)): boolean {
  if (detected.encoding.startsWith('utf-16')) return false;
  return bytes.subarray(0, 8192).includes(0);
}

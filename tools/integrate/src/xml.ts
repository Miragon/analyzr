/**
 * A small, strict XML reader for export files: elements, attributes with
 * their source offsets, character data and namespaces. It keeps offsets so
 * normalize-bpmn can rewrite attribute values and reference texts in place
 * before bpmn-moddle reads the document (bpmn-moddle drops an element whose
 * id it finds illegal or duplicate, so ids are fixed first). No DTD support:
 * a DOCTYPE is reported and, unless allowed, refused; entities other than
 * the five predefined ones and character references are refused as well
 * (or, with `keepUnknownEntities`, left undecoded as bpmn-moddle's reader
 * leaves them), so nothing is ever expanded.
 */

export class XmlSyntaxError extends Error {
  /** Offset in the text where the problem was found. */
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(message);
    this.name = 'XmlSyntaxError';
    this.offset = offset;
  }
}

export interface XmlAttribute {
  /** Qualified name as written, e.g. `bpmnElement` or `xsi:type`. */
  name: string;
  /** Value with references decoded. */
  value: string;
  /** Offsets of the raw value between the quotes. */
  valueStart: number;
  valueEnd: number;
}

export interface XmlText {
  /** Character data with references decoded (CDATA as is). */
  value: string;
  /** Offsets of the raw text (for CDATA: of its content). */
  start: number;
  end: number;
  cdata: boolean;
}

export interface XmlElement {
  /** Qualified name as written. */
  name: string;
  prefix: string;
  local: string;
  /** Namespace URI, `null` when the name has no namespace. */
  ns: string | null;
  attributes: XmlAttribute[];
  /** Namespace bindings in scope: prefix (`''` for the default namespace) → URI. */
  scope: ReadonlyMap<string, string>;
  parent: XmlElement | null;
  children: XmlElement[];
  /** Character data directly inside this element, in document order. */
  texts: XmlText[];
  /** Offset of `<` of the start tag. */
  start: number;
}

export interface XmlDeclaration {
  version: string | null;
  encoding: string | null;
}

export interface XmlDocument {
  root: XmlElement;
  /** Number of elements read (only the root with `rootOnly`). */
  elements: number;
  /** The document has a DOCTYPE declaration. */
  doctype: boolean;
  declaration: XmlDeclaration | null;
}

export interface ParseXmlOptions {
  /** Stop after the root start tag (namespaces, attributes; no children). */
  rootOnly?: boolean;
  /** Read past a DOCTYPE and leave unknown entity references undecoded instead of refusing them. */
  lenient?: boolean;
  /**
   * Leave unknown entity references (`&nbsp;`) and a bare `&` undecoded, as
   * saxen, bpmn-moddle's reader, does; a DOCTYPE is still refused.
   */
  keepUnknownEntities?: boolean;
  /** Refuse documents with more elements (default: unlimited). */
  maxElements?: number;
}

export const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
export const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';

const PREDEFINED: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

function isSpace(c: number): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
}

function isNameChar(c: number): boolean {
  return !(isSpace(c) || c === 0x2f || c === 0x3e || c === 0x3d || c === 0x3c || Number.isNaN(c));
}

/** Decodes the predefined entities and character references in `raw`. */
export function decodeReferences(raw: string, offset: number, lenient = false): string {
  if (!raw.includes('&')) return raw;
  return raw.replace(/&([^;&\s]*);?/g, (match, body: string, at: number) => {
    if (!match.endsWith(';')) {
      if (lenient) return match;
      throw new XmlSyntaxError('unterminated entity reference', offset + at);
    }
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const cp = Number.parseInt(body.slice(2), 16);
      if (Number.isSafeInteger(cp) && cp >= 0 && cp <= 0x10ffff) return String.fromCodePoint(cp);
    } else if (body.startsWith('#')) {
      const cp = Number.parseInt(body.slice(1), 10);
      if (Number.isSafeInteger(cp) && cp >= 0 && cp <= 0x10ffff) return String.fromCodePoint(cp);
    } else if (Object.hasOwn(PREDEFINED, body)) {
      return PREDEFINED[body] ?? match;
    }
    if (lenient) return match;
    throw new XmlSyntaxError(`unknown entity reference ${match}`, offset + at);
  });
}

/** `value` escaped for a double-quoted attribute. */
export function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\n', '&#10;')
    .replaceAll('\r', '&#13;')
    .replaceAll('\t', '&#9;');
}

/** `value` escaped for character data. */
export function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** 1-based line and column of `offset` in `text`. */
export function position(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 0x0a) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

function splitName(name: string): { prefix: string; local: string } {
  const colon = name.indexOf(':');
  return colon < 0
    ? { prefix: '', local: name }
    : { prefix: name.slice(0, colon), local: name.slice(colon + 1) };
}

function parseDeclaration(body: string): XmlDeclaration {
  const pseudo = (key: string): string | null =>
    new RegExp(`\\s${key}\\s*=\\s*(["'])([^"']*)\\1`).exec(` ${body}`)?.[2] ?? null;
  return { version: pseudo('version'), encoding: pseudo('encoding') };
}

/**
 * Reads `text` (decoded, without a byte order mark).
 *
 * @throws {XmlSyntaxError} for malformed XML, a DOCTYPE or an unknown entity (unless `lenient`), or too many elements
 */
export function parseXml(text: string, options: ParseXmlOptions = {}): XmlDocument {
  const {
    rootOnly = false,
    lenient = false,
    keepUnknownEntities = false,
    maxElements = Number.POSITIVE_INFINITY,
  } = options;
  const entities = lenient || keepUnknownEntities;
  const len = text.length;
  let i = 0;
  let root: XmlElement | null = null;
  let declaration: XmlDeclaration | null = null;
  let doctype = false;
  let elements = 0;
  const stack: XmlElement[] = [];

  const expect = (s: string, at: number): void => {
    if (!text.startsWith(s, at)) throw new XmlSyntaxError(`expected ${s}`, at);
  };
  const skipPast = (terminator: string, from: number, what: string): number => {
    const end = text.indexOf(terminator, from);
    if (end < 0) throw new XmlSyntaxError(`unterminated ${what}`, from);
    return end + terminator.length;
  };
  const addText = (value: string, start: number, end: number, cdata: boolean): void => {
    const top = stack.at(-1);
    if (top) {
      top.texts.push({ value, start, end, cdata });
    } else if (value.trim() !== '') {
      throw new XmlSyntaxError('character data outside the root element', start);
    }
  };

  while (i < len) {
    const lt = text.indexOf('<', i);
    if (lt < 0) {
      addText(decodeReferences(text.slice(i), i, entities), i, len, false);
      break;
    }
    if (lt > i) addText(decodeReferences(text.slice(i, lt), i, entities), i, lt, false);
    if (text.startsWith('<?', lt)) {
      const end = skipPast('?>', lt + 2, 'processing instruction');
      const body = text.slice(lt + 2, end - 2);
      if (/^xml(\s|$)/.test(body)) {
        if (lt !== 0) throw new XmlSyntaxError('XML declaration not at the start', lt);
        declaration = parseDeclaration(body.slice(3));
      }
      i = end;
    } else if (text.startsWith('<!--', lt)) {
      i = skipPast('-->', lt + 4, 'comment');
    } else if (text.startsWith('<![CDATA[', lt)) {
      const end = skipPast(']]>', lt + 9, 'CDATA section');
      if (stack.length === 0) throw new XmlSyntaxError('CDATA outside the root element', lt);
      addText(text.slice(lt + 9, end - 3), lt + 9, end - 3, true);
      i = end;
    } else if (/^<!\s*DOCTYPE/i.test(text.slice(lt, lt + 16))) {
      if (!lenient) throw new XmlSyntaxError('DOCTYPE declarations are not allowed', lt);
      doctype = true;
      i = doctypeEnd(text, lt);
    } else if (text.startsWith('</', lt)) {
      let j = lt + 2;
      while (j < len && isNameChar(text.charCodeAt(j))) j++;
      const name = text.slice(lt + 2, j);
      while (j < len && isSpace(text.charCodeAt(j))) j++;
      expect('>', j);
      const open = stack.pop();
      if (!open || open.name !== name) {
        throw new XmlSyntaxError(`closing tag </${name}> does not match <${open?.name ?? ''}>`, lt);
      }
      i = j + 1;
      if (stack.length === 0) {
        // Only comments, processing instructions and whitespace may follow.
        trailer(text, i);
        break;
      }
    } else if (text.startsWith('<!', lt)) {
      throw new XmlSyntaxError('markup declarations are not allowed', lt);
    } else {
      if (root !== null && stack.length === 0) {
        throw new XmlSyntaxError('a second root element', lt);
      }
      const { element, end, selfClosing } = readStartTag(
        text,
        lt,
        stack.at(-1) ?? null,
        lenient,
        entities,
      );
      elements++;
      if (elements > maxElements) {
        throw new XmlSyntaxError(`more than ${maxElements} elements`, lt);
      }
      const parent = stack.at(-1);
      if (parent) parent.children.push(element);
      else root = element;
      i = end;
      if (rootOnly) break;
      if (selfClosing) {
        if (stack.length === 0) {
          trailer(text, i);
          break;
        }
      } else {
        stack.push(element);
      }
    }
  }
  if (root === null) throw new XmlSyntaxError('no root element', 0);
  if (!rootOnly && stack.length > 0) {
    throw new XmlSyntaxError(`unclosed element <${stack.at(-1)?.name ?? ''}>`, len);
  }
  return { root, elements, doctype, declaration };
}

/** Offset after the DOCTYPE starting at `lt` (an internal subset in brackets, quotes respected). */
function doctypeEnd(text: string, lt: number): number {
  let depth = 0;
  let quote = 0;
  for (let j = lt + 2; j < text.length; j++) {
    const c = text.charCodeAt(j);
    if (quote !== 0) {
      if (c === quote) quote = 0;
    } else if (c === 0x22 || c === 0x27) {
      quote = c;
    } else if (c === 0x5b) {
      depth++;
    } else if (c === 0x5d) {
      depth--;
    } else if (c === 0x3e && depth <= 0) {
      return j + 1;
    }
  }
  throw new XmlSyntaxError('unterminated DOCTYPE', lt);
}

/** Checks that only whitespace, comments and processing instructions follow the root. */
function trailer(text: string, from: number): void {
  let i = from;
  while (i < text.length) {
    if (isSpace(text.charCodeAt(i))) {
      i++;
    } else if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      if (end < 0) throw new XmlSyntaxError('unterminated comment', i);
      i = end + 3;
    } else if (text.startsWith('<?', i)) {
      const end = text.indexOf('?>', i + 2);
      if (end < 0) throw new XmlSyntaxError('unterminated processing instruction', i);
      i = end + 2;
    } else {
      throw new XmlSyntaxError('content after the root element', i);
    }
  }
}

function readStartTag(
  text: string,
  lt: number,
  parent: XmlElement | null,
  lenient: boolean,
  entities: boolean,
): { element: XmlElement; end: number; selfClosing: boolean } {
  const len = text.length;
  let j = lt + 1;
  while (j < len && isNameChar(text.charCodeAt(j))) j++;
  const name = text.slice(lt + 1, j);
  if (name === '') throw new XmlSyntaxError('element without a name', lt);
  const attributes: XmlAttribute[] = [];
  const seen = new Set<string>();
  let selfClosing = false;
  for (;;) {
    const before = j;
    while (j < len && isSpace(text.charCodeAt(j))) j++;
    if (j >= len) throw new XmlSyntaxError(`unterminated start tag <${name}>`, lt);
    if (text.startsWith('/>', j)) {
      selfClosing = true;
      j += 2;
      break;
    }
    if (text.charCodeAt(j) === 0x3e) {
      j += 1;
      break;
    }
    if (j === before) throw new XmlSyntaxError(`expected whitespace in <${name}>`, j);
    const nameStart = j;
    while (j < len && isNameChar(text.charCodeAt(j))) j++;
    const attrName = text.slice(nameStart, j);
    if (attrName === '') throw new XmlSyntaxError(`malformed attribute in <${name}>`, j);
    while (j < len && isSpace(text.charCodeAt(j))) j++;
    if (text.charCodeAt(j) !== 0x3d) {
      throw new XmlSyntaxError(`attribute ${attrName} without a value`, j);
    }
    j++;
    while (j < len && isSpace(text.charCodeAt(j))) j++;
    const quote = text.charCodeAt(j);
    if (quote !== 0x22 && quote !== 0x27) {
      throw new XmlSyntaxError(`attribute ${attrName} value not quoted`, j);
    }
    const valueStart = j + 1;
    const valueEnd = text.indexOf(String.fromCharCode(quote), valueStart);
    if (valueEnd < 0) throw new XmlSyntaxError(`unterminated value of ${attrName}`, j);
    const raw = text.slice(valueStart, valueEnd);
    if (raw.includes('<')) throw new XmlSyntaxError(`'<' in the value of ${attrName}`, valueStart);
    if (seen.has(attrName)) throw new XmlSyntaxError(`attribute ${attrName} repeated`, nameStart);
    seen.add(attrName);
    attributes.push({
      name: attrName,
      // Attribute value normalization: literal whitespace characters become spaces.
      value: decodeReferences(raw.replace(/[\t\n\r]/g, ' '), valueStart, entities),
      valueStart,
      valueEnd,
    });
    j = valueEnd + 1;
  }

  let scope: ReadonlyMap<string, string> = parent?.scope ?? new Map([['xml', XML_NAMESPACE]]);
  const declarations = attributes.filter((a) => a.name === 'xmlns' || a.name.startsWith('xmlns:'));
  if (declarations.length > 0) {
    const own = new Map(scope);
    for (const d of declarations) own.set(d.name === 'xmlns' ? '' : d.name.slice(6), d.value);
    scope = own;
  }
  const { prefix, local } = splitName(name);
  const ns = scope.get(prefix);
  if (prefix !== '' && ns === undefined && !lenient) {
    throw new XmlSyntaxError(`undeclared namespace prefix ${prefix}`, lt);
  }
  const element: XmlElement = {
    name,
    prefix,
    local,
    ns: ns === undefined || ns === '' ? null : ns,
    attributes,
    scope,
    parent,
    children: [],
    texts: [],
    start: lt,
  };
  return { element, end: j, selfClosing };
}

/** The value of the attribute written as `name`, if present. */
export function attribute(el: XmlElement, name: string): string | undefined {
  return el.attributes.find((a) => a.name === name)?.value;
}

/** The namespace URI of an attribute (`null` for unprefixed attributes, as XML Namespaces say). */
export function attributeNamespace(el: XmlElement, attr: XmlAttribute): string | null {
  const { prefix } = splitName(attr.name);
  if (prefix === '') return attr.name === 'xmlns' ? XMLNS_NAMESPACE : null;
  if (prefix === 'xmlns') return XMLNS_NAMESPACE;
  return el.scope.get(prefix) ?? null;
}

/** The value of the attribute `local` in namespace `ns` (`null`: unprefixed), if present. */
export function attributeNS(el: XmlElement, ns: string | null, local: string): string | undefined {
  return el.attributes.find(
    (a) => splitName(a.name).local === local && attributeNamespace(el, a) === ns,
  )?.value;
}

/** Every element below `el` (not `el` itself), in document order. */
export function* descendants(el: XmlElement): Generator<XmlElement> {
  const stack = [...el.children].reverse();
  for (;;) {
    const next = stack.pop();
    if (next === undefined) return;
    yield next;
    for (let k = next.children.length - 1; k >= 0; k--) {
      const c = next.children[k];
      if (c) stack.push(c);
    }
  }
}

/** The character data directly inside `el`. */
export function ownText(el: XmlElement): string {
  return el.texts.map((t) => t.value).join('');
}

/** The namespace declarations of the root element: prefix (`''` default) → URI, sorted by prefix. */
export function rootNamespaces(root: XmlElement): Record<string, string> {
  const out: Record<string, string> = {};
  const entries = [...root.scope.entries()].filter(([p]) => p !== 'xml');
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [prefix, uri] of entries) out[prefix] = uri;
  return out;
}

/** One text edit: replace `[start, end)` by `text`. */
export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

/**
 * Applies non-overlapping edits to `text`.
 *
 * @throws {Error} if two edits overlap
 */
export function applyEdits(text: string, edits: readonly TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let out = '';
  let at = 0;
  for (const e of sorted) {
    if (e.start < at) throw new Error(`overlapping edits at offset ${e.start}`);
    out += text.slice(at, e.start) + e.text;
    at = e.end;
  }
  return out + text.slice(at);
}

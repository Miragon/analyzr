// A positioned element scan for byte-preserving splices (model amendments,
// M6 §4.8 c): every element with the offsets of its start tag, attributes and
// end, its resolved namespace and its line indentation. It is no validating
// parser; bpmn-moddle reads the facts, and the amended result is extracted
// again. Run it on text that passed `assertSafeXml` and the element limit.
import { BpmnInputError } from './errors.ts';
import { decodeReferences, isNameStart, skipPast, tagEnd } from './xml-scan.ts';

const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';

export interface XmlAttribute {
  /** Qualified name as written. */
  name: string;
  /** Namespace URI of a prefixed attribute; `null` for an unprefixed one and for declarations. */
  ns: string | null;
  local: string;
  /** Offset of the opening quote + 1 and of the closing quote. */
  valueStart: number;
  valueEnd: number;
  quote: '"' | "'";
  /** The value with character references decoded. */
  value: string;
}

export interface XmlElement {
  index: number;
  /** Qualified name as written. */
  name: string;
  prefix: string | null;
  local: string;
  /** Resolved namespace URI, `null` when the prefix (or the default namespace) is unbound. */
  ns: string | null;
  /** Index of the parent element, `-1` for the root. */
  parent: number;
  children: number[];
  /** Offset of `<`. */
  start: number;
  /** Offset just past the last attribute (or the name when there is none). */
  attrsEnd: number;
  /** Offset just past the start tag's `>`. */
  startTagEnd: number;
  selfClosing: boolean;
  /** Offset of the end tag's `<`; `startTagEnd` for a self-closing element. */
  closeStart: number;
  /** Offset just past the element. */
  end: number;
  attributes: XmlAttribute[];
  /** Whitespace before the start tag when nothing else precedes it on its line, else `null`. */
  indent: string | null;
  /** The line break before that line (`\n` or `\r\n`); the document's at the start of the text. */
  nl: string;
  /** Declares a prefix or the default namespace that the enclosing scope binds to another URI. */
  rebinds: boolean;
}

export interface XmlDocument {
  text: string;
  elements: XmlElement[];
  root: XmlElement;
  /** Element indices by their unprefixed `id` attribute (decoded). */
  byId: ReadonlyMap<string, readonly number[]>;
  /** The document's first line break (`\n` or `\r\n`), `\n` if it has none. */
  newline: string;
}

const SLASH = '/'.charCodeAt(0);
const QUESTION = '?'.charCodeAt(0);
const BANG = '!'.charCodeAt(0);

const NAME = /[^\s/>]+/y;
const ATTRIBUTE = /\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
const TAG_TAIL = /^\s*\/?$/;
const WHITESPACE = /^[ \t\r\n]*$/;

function splitName(name: string): { prefix: string | null; local: string } {
  const colon = name.indexOf(':');
  return colon < 0
    ? { prefix: null, local: name }
    : { prefix: name.slice(0, colon), local: name.slice(colon + 1) };
}

function malformed(message: string, offset: number): BpmnInputError {
  return new BpmnInputError('not-xml', `${message} at offset ${offset}`);
}

/** Line indentation of markup starting at `lt` after the gap `[gapStart, lt)`. */
function indentation(
  text: string,
  gapStart: number,
  lt: number,
  newline: string,
): { indent: string | null; nl: string } {
  const gap = text.slice(gapStart, lt);
  if (!WHITESPACE.test(gap)) return { indent: null, nl: newline };
  const lf = gap.lastIndexOf('\n');
  if (lf < 0) return gapStart === 0 ? { indent: gap, nl: newline } : { indent: null, nl: newline };
  return { indent: gap.slice(lf + 1), nl: gap[lf - 1] === '\r' ? '\r\n' : '\n' };
}

/**
 * Scans every element of `text` with its offsets, attributes, resolved
 * namespace and indentation, in one linear pass without recursion (nesting
 * depth is unbounded). Namespace bindings are kept on a stack per prefix, so
 * a lookup costs O(1) however deep the document.
 *
 * @throws {BpmnInputError} `not-xml` for markup this scan cannot read: unmatched or unclosed tags, a duplicate attribute, a second root
 */
export function scanElements(text: string): XmlDocument {
  const firstLf = text.indexOf('\n');
  const newline = firstLf > 0 && text[firstLf - 1] === '\r' ? '\r\n' : '\n';
  const elements: XmlElement[] = [];
  const open: number[] = [];
  const bindings = new Map<string, string[]>([['xml', [XML_NAMESPACE]]]);
  const declared: string[][] = [];
  const byId = new Map<string, number[]>();
  let rootClosed = false;
  let gapStart = 0;
  let i = 0;

  const resolve = (prefix: string | null): string | null => {
    const stack = bindings.get(prefix ?? '');
    return stack?.[stack.length - 1] ?? null;
  };
  const close = (index: number): void => {
    for (const prefix of declared[index] ?? []) bindings.get(prefix)?.pop();
    if (open.length === 0) rootClosed = true;
  };

  for (;;) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    if (text.startsWith('<!--', lt)) {
      i = gapStart = skipPast(text, '-->', lt + 4, 'comment');
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      i = gapStart = skipPast(text, ']]>', lt + 9, 'CDATA section');
      continue;
    }
    const next = text.charCodeAt(lt + 1);
    if (next === QUESTION) {
      i = gapStart = skipPast(text, '?>', lt + 2, 'processing instruction');
      continue;
    }
    if (next === BANG) throw malformed('unexpected markup declaration', lt);
    if (next === SLASH) {
      const gt = text.indexOf('>', lt);
      if (gt < 0) throw malformed('unterminated end tag', lt);
      const name = text.slice(lt + 2, gt).trimEnd();
      const index = open.pop();
      const el = index === undefined ? undefined : elements[index];
      if (el === undefined || el.name !== name)
        throw malformed(`unexpected end tag </${name}>`, lt);
      el.closeStart = lt;
      el.end = gt + 1;
      close(el.index);
      i = gapStart = gt + 1;
      continue;
    }
    if (!isNameStart(next)) throw malformed('malformed markup', lt);
    if (rootClosed) throw malformed('a second root element', lt);

    const gt = tagEnd(text, lt);
    const selfClosing = text.charCodeAt(gt - 1) === SLASH;
    NAME.lastIndex = lt + 1;
    const name = NAME.exec(text)?.[0] ?? '';
    let attrsEnd = lt + 1 + name.length;
    const raw: Array<{ name: string; valueStart: number; valueEnd: number; quote: '"' | "'" }> = [];
    for (;;) {
      ATTRIBUTE.lastIndex = attrsEnd;
      const m = ATTRIBUTE.exec(text);
      if (m === null || ATTRIBUTE.lastIndex > gt) break;
      const value = m[2] ?? m[3] ?? '';
      const valueEnd = ATTRIBUTE.lastIndex - 1;
      raw.push({
        name: m[1] ?? '',
        valueStart: valueEnd - value.length,
        valueEnd,
        quote: m[2] !== undefined ? '"' : "'",
      });
      attrsEnd = ATTRIBUTE.lastIndex;
    }
    if (!TAG_TAIL.test(text.slice(attrsEnd, gt))) throw malformed('malformed start tag', lt);

    const index = elements.length;
    const parent = open[open.length - 1] ?? -1;
    const names = new Set<string>();
    const ownDeclarations: string[] = [];
    let rebinds = false;
    for (const a of raw) {
      if (names.has(a.name)) throw malformed(`duplicate attribute ${a.name}`, lt);
      names.add(a.name);
      if (a.name !== 'xmlns' && !a.name.startsWith('xmlns:')) continue;
      const prefix = a.name === 'xmlns' ? '' : a.name.slice('xmlns:'.length);
      const uri = decodeReferences(text.slice(a.valueStart, a.valueEnd));
      const stack = bindings.get(prefix) ?? [];
      const current = stack[stack.length - 1];
      if (current !== undefined && current !== uri) rebinds = true;
      stack.push(uri);
      bindings.set(prefix, stack);
      ownDeclarations.push(prefix);
    }
    declared[index] = ownDeclarations;
    const attributes: XmlAttribute[] = raw.map((a) => {
      const { prefix, local } = splitName(a.name);
      const isDeclaration = a.name === 'xmlns' || prefix === 'xmlns';
      return {
        name: a.name,
        ns: prefix === null || isDeclaration ? null : resolve(prefix),
        local,
        valueStart: a.valueStart,
        valueEnd: a.valueEnd,
        quote: a.quote,
        value: decodeReferences(text.slice(a.valueStart, a.valueEnd)),
      };
    });
    const { prefix, local } = splitName(name);
    const { indent, nl } = indentation(text, gapStart, lt, newline);
    const el: XmlElement = {
      index,
      name,
      prefix,
      local,
      ns: resolve(prefix),
      parent,
      children: [],
      start: lt,
      attrsEnd,
      startTagEnd: gt + 1,
      selfClosing,
      closeStart: gt + 1,
      end: gt + 1,
      attributes,
      indent,
      nl,
      rebinds,
    };
    elements.push(el);
    if (parent >= 0) elements[parent]?.children.push(index);
    const id = attributes.find((a) => a.name === 'id')?.value;
    if (id !== undefined) {
      const ids = byId.get(id);
      if (ids) ids.push(index);
      else byId.set(id, [index]);
    }
    if (selfClosing) close(index);
    else open.push(index);
    i = gapStart = gt + 1;
  }
  const [root] = elements;
  if (root === undefined) throw new BpmnInputError('not-xml', 'the document has no root element');
  if (open.length > 0) throw malformed(`unclosed element <${root.name}>`, root.start);
  return { text, elements, root, byId, newline };
}

// Model amendments (M6 §4.8 c, decision 25): targeted, byte-preserving
// changes of the fields open questions name, applied to the bytes of an
// uploaded revision. Pure and deterministic: the result is a function of the
// bytes and of the amendments in seq order only. Never a bpmn-moddle round
// trip for output: bpmn-moddle drops what it cannot read, an amendment must
// not. Every result is extracted again and refused unless the facts read
// exactly the intended change.
import { createHash } from 'node:crypto';

import type { Fact, FactAttrs, FactKind, MessageFlowInfo } from '@analyzr/contracts';

import { BpmnInputError } from './errors.ts';
import { BPMN_MODEL_NAMESPACE, extractFacts } from './extract.ts';
import type { Engine, ExtractOptions, ExtractResult } from './extract.ts';
import { canonicalJson, factFingerprint } from './fingerprint.ts';
import { assertSafeXml, resolveLimits } from './input.ts';
import { normalizeKey } from './normalize.ts';
import { compareStrings } from './order.ts';
import {
  MAX_DOCUMENTATION_LENGTH,
  MAX_KEY_LENGTH,
  MAX_LABEL_LENGTH,
  sanitizeBlock,
  sanitizeLine,
} from './sanitize.ts';
import { scanElements } from './xml-elements.ts';
import type { XmlAttribute, XmlDocument, XmlElement } from './xml-elements.ts';

const CAMUNDA_NAMESPACE = 'http://camunda.org/schema/1.0/bpmn';
const ZEEBE_NAMESPACE = 'http://camunda.org/schema/zeebe/1.0';
const BPMNDI_NAMESPACE = 'http://www.omg.org/spec/BPMN/20100524/DI';

/** The v1 operations (M6 §4.8 c "Operations"). */
export const AMENDMENT_OPS = [
  'call-target',
  'message-name',
  'event-name',
  'process-documentation',
] as const;
export type AmendmentOp = (typeof AMENDMENT_OPS)[number];

/** The fact limit of each operation's value (`MAX_KEY_LENGTH`, `MAX_LABEL_LENGTH`, `MAX_DOCUMENTATION_LENGTH`). */
export const AMENDMENT_VALUE_LIMITS: Readonly<Record<AmendmentOp, number>> = Object.freeze({
  'call-target': MAX_KEY_LENGTH,
  'message-name': MAX_KEY_LENGTH,
  'event-name': MAX_LABEL_LENGTH,
  'process-documentation': MAX_DOCUMENTATION_LENGTH,
});

/** One amendment as `applyAmendments` applies it. */
export interface Amendment {
  /** The amendment's id (`mam_…`); it seeds the id of a message or signal it creates. */
  id: string;
  /**
   * The element whose field is written: the call activity (`call-target`),
   * the start or end event (`event-name`), the process
   * (`process-documentation`), and for `message-name` the referenced
   * `bpmn:message` or `bpmn:signal`, or the endpoint itself when it
   * references none.
   */
  elementId: string;
  op: AmendmentOp;
  /** The value set, in the form {@link normalizeAmendmentValue} returns. */
  after: string;
}

/**
 * Why an amendment is not applied:
 * - `invalid-value`: the value is not what {@link normalizeAmendmentValue} returns for it
 * - `duplicate-amendment`: an earlier amendment of the list has the same element and op
 * - `element-missing`: no element has the id
 * - `duplicate-id`: several elements have the id
 * - `wrong-element`: the element is not of the op's kind (also an endpoint that
 *   references a message or signal: the amendment is keyed by that element)
 * - `expression`: the current call target or name is an expression in either dialect
 * - `cmmn-call`: the call activity calls a CMMN case (`camunda:caseRef`)
 * - `has-documentation`: the process has documentation (it is never replaced)
 * - `redeclared-prefix`: an element on the way rebinds a namespace prefix
 * - `unsupported-structure`: markup the splice does not handle (an unresolvable
 *   reference, `eventDefinitionRef`, a message and a signal definition without
 *   reference on one event, two `extensionElements`, unreadable markup)
 * - `check-failed`: the result would not read exactly the intended change
 */
export type AmendmentRefusalReason =
  | 'invalid-value'
  | 'duplicate-amendment'
  | 'element-missing'
  | 'duplicate-id'
  | 'wrong-element'
  | 'expression'
  | 'cmmn-call'
  | 'has-documentation'
  | 'redeclared-prefix'
  | 'unsupported-structure'
  | 'check-failed';

export interface AmendmentRefusal {
  reason: AmendmentRefusalReason;
  /** English, for logs and the server's error detail. */
  message: string;
}

export type AmendmentOutcome =
  | { id: string; elementId: string; op: AmendmentOp; status: 'applied' }
  | ({ id: string; elementId: string; op: AmendmentOp; status: 'refused' } & AmendmentRefusal);

export interface AmendResult {
  /**
   * The input bytes with the applied amendments spliced in; every other byte,
   * the BOM and the line endings included, stays. The input bytes when none
   * applies.
   */
  xml: Uint8Array;
  /** One outcome per amendment, in input order. */
  outcomes: AmendmentOutcome[];
  /** `extractFacts` of {@link xml} with the caller's options. */
  extraction: ExtractResult;
}

export type AmendmentValueProblem = 'empty' | 'too-long' | 'expression' | 'invalid-character';

export type NormalizedAmendmentValue =
  { ok: true; value: string } | { ok: false; problem: AmendmentValueProblem };

/**
 * A call target or name written as an expression in either dialect (FEEL
 * `=…`, JUEL `${…}` or `#{…}`), whatever the engine (M6 §4.8 a).
 */
export function isAmendmentExpression(value: string): boolean {
  return /^\s*=/.test(value) || value.includes('${') || value.includes('#{');
}

/** Not an XML 1.0 character (control characters are removed by the sanitizers). */
const NOT_XML_CHAR = /[￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

/**
 * The value an amendment stores and writes, in the extractor's sanitized form
 * with the field's fact limit: `sanitizeLine` for targets and names,
 * `sanitizeBlock` for documentation. Refused when nothing is left, when it is
 * longer than the limit (never cut), when a call target or message name is an
 * expression, or when it holds a character XML cannot carry.
 */
export function normalizeAmendmentValue(op: AmendmentOp, raw: string): NormalizedAmendmentValue {
  const max = AMENDMENT_VALUE_LIMITS[op];
  const { text, truncated } =
    op === 'process-documentation' ? sanitizeBlock(raw, max) : sanitizeLine(raw, max);
  if (NOT_XML_CHAR.test(text)) return { ok: false, problem: 'invalid-character' };
  if (truncated) return { ok: false, problem: 'too-long' };
  if (text === '') return { ok: false, problem: 'empty' };
  if ((op === 'call-target' || op === 'message-name') && isAmendmentExpression(text)) {
    return { ok: false, problem: 'expression' };
  }
  return { ok: true, value: text };
}

// ------------------------------------------------------------------ reading

export type AmendableElementKind =
  'call' | 'start-event' | 'end-event' | 'process' | 'message' | 'signal' | 'endpoint';

/** One field a v1 amendment can key (whether a question names it is the server's rule). */
export interface AmendableField {
  /** The element an amendment of this field is keyed by. */
  elementId: string;
  op: AmendmentOp;
  element: AmendableElementKind;
  /** The process the element lies in; `null` for a message or signal. */
  processId: string | null;
  /**
   * The current value as the facts read it: the call target (`''` for none),
   * the name (`null` for none), the documentation (`null` for none).
   */
  value: string | null;
  /** The value is an expression in either dialect ({@link isAmendmentExpression}). */
  expression: boolean;
  /** `call-target` only: the call activity has `camunda:caseRef`. */
  caseRef?: boolean;
  /**
   * `message-name` only: the endpoints and message flows whose facts read the
   * name (a message or signal), or the endpoint itself (an endpoint without a
   * reference); sorted.
   */
  readers?: string[];
  /** Why `applyAmendments` refuses an amendment of this field whatever its value, or `null`. */
  blocked: AmendmentRefusal | null;
}

/** A message or signal endpoint (`msg_*`, `sig_*` fact) and where its name comes from. */
export interface AmendableEndpoint {
  elementId: string;
  kind: Extract<FactKind, 'msg_throw' | 'msg_catch' | 'sig_throw' | 'sig_catch'>;
  processId: string | null;
  /** The referenced `bpmn:message` or `bpmn:signal`; `null` without a resolvable reference. */
  reference: string | null;
  /** The message or signal name as the fact reads it, `null` for none. */
  name: string | null;
  expression: boolean;
  /** The element a `message-name` amendment opened from this endpoint is keyed by. */
  amendmentElementId: string;
}

export interface AmendableDocument {
  engine: Engine | null;
  /** Sorted by element id, then op. */
  fields: AmendableField[];
  /** Sorted by element id, then kind. */
  endpoints: AmendableEndpoint[];
}

// ------------------------------------------------------------------ context

type RefKind = 'message' | 'signal';

const EVENTS: ReadonlySet<string> = new Set([
  'startEvent',
  'endEvent',
  'intermediateCatchEvent',
  'intermediateThrowEvent',
  'boundaryEvent',
  'implicitThrowEvent',
]);

/** The message or signal part of an endpoint. */
interface EndpointPart {
  kind: RefKind;
  fact: Fact;
  /** The resolved reference, `null` without one. */
  reference: string | null;
  /** The element that carries (or would carry) the reference attribute. */
  holder: XmlElement | null;
  /** Why the part's reference cannot be read or written. */
  unsupported: string | null;
}

interface Context {
  doc: XmlDocument;
  base: ExtractResult;
  /**
   * The XML declaration names an encoding other than UTF-8: every value is
   * written as ASCII, with character references above U+007E.
   */
  ascii: boolean;
  facts: ReadonlyMap<string, Fact>;
  /** The root's prefix for the Zeebe namespace. */
  zeebePrefix: string | null;
  /** The document's indentation step. */
  unit: string;
  /** Message or signal id → the facts that read its name. */
  readers: Map<string, Fact[]>;
}

const factId = (kind: string, elementId: string): string => `${kind}#${elementId}`;

function isBpmn(el: XmlElement | undefined, local: string): boolean {
  return el !== undefined && el.ns === BPMN_MODEL_NAMESPACE && el.local === local;
}

function plainAttr(el: XmlElement, name: string): XmlAttribute | undefined {
  return el.attributes.find((a) => a.ns === null && a.name === name);
}

function element(doc: XmlDocument, index: number): XmlElement | undefined {
  return doc.elements[index];
}

function childElements(doc: XmlDocument, el: XmlElement): XmlElement[] {
  return el.children.map((i) => element(doc, i)).filter((c): c is XmlElement => c !== undefined);
}

function bpmnChildren(doc: XmlDocument, el: XmlElement, local: string): XmlElement[] {
  return childElements(doc, el).filter((c) => isBpmn(c, local));
}

function unique(doc: XmlDocument, id: string): XmlElement | undefined {
  const hits = doc.byId.get(id);
  return hits?.length === 1 ? element(doc, hits[0] ?? -1) : undefined;
}

function documentUnit(doc: XmlDocument): string {
  for (const el of doc.elements) {
    const parent = element(doc, el.parent);
    if (el.indent === null || parent?.indent == null) continue;
    if (el.indent.length > parent.indent.length && el.indent.startsWith(parent.indent)) {
      return el.indent.slice(parent.indent.length);
    }
  }
  return '  ';
}

function rootReference(ctx: Pick<Context, 'doc'>, id: string, kind: RefKind): boolean {
  const el = unique(ctx.doc, id);
  return el !== undefined && isBpmn(el, kind) && el.parent === ctx.doc.root.index;
}

/** The message and signal parts of an endpoint element, mirroring how `Extraction` reads them. */
function endpointParts(
  ctx: Pick<Context, 'doc' | 'facts'>,
  el: XmlElement,
  id: string,
): EndpointPart[] {
  const parts: EndpointPart[] = [];
  for (const kind of ['message', 'signal'] as const) {
    const prefix = kind === 'message' ? 'msg' : 'sig';
    const fact =
      ctx.facts.get(factId(`${prefix}_throw`, id)) ?? ctx.facts.get(factId(`${prefix}_catch`, id));
    if (fact === undefined) continue;
    const refName = kind === 'message' ? 'messageRef' : 'signalRef';
    if (isBpmn(el, 'sendTask') || isBpmn(el, 'receiveTask')) {
      const ref = plainAttr(el, refName)?.value;
      if (kind === 'signal' || ref === undefined) {
        parts.push({ kind, fact, reference: null, holder: el, unsupported: null });
      } else if (rootReference(ctx, ref, kind)) {
        parts.push({ kind, fact, reference: ref, holder: el, unsupported: null });
      } else {
        const unsupported = `${refName} "${ref}" does not resolve to one ${kind}`;
        parts.push({ kind, fact, reference: null, holder: el, unsupported });
      }
      continue;
    }
    if (el.ns !== BPMN_MODEL_NAMESPACE || !EVENTS.has(el.local)) {
      const unsupported = `<${el.name}> is no event, send or receive task`;
      parts.push({ kind, fact, reference: null, holder: null, unsupported });
      continue;
    }
    const definitions = bpmnChildren(ctx.doc, el, `${kind}EventDefinition`);
    const refs = definitions.map((d) => plainAttr(d, refName)?.value);
    const reference = refs.find((r) => r !== undefined && rootReference(ctx, r, kind)) ?? null;
    let unsupported: string | null = null;
    if (reference === null) {
      if (bpmnChildren(ctx.doc, el, 'eventDefinitionRef').length > 0) {
        unsupported = 'the event references event definitions through eventDefinitionRef';
      } else if (definitions.length === 0) {
        unsupported = `the event has no inline ${kind}EventDefinition`;
      } else if (refs.some((r) => r !== undefined)) {
        unsupported = `a ${refName} of the event does not resolve to one ${kind}`;
      }
    }
    parts.push({ kind, fact, reference, holder: definitions[0] ?? null, unsupported });
  }
  return parts;
}

/** The encoding the XML declaration names, or `null` without one. */
function declaredEncoding(text: string): string | null {
  const match = /^\s*<\?xml[^>]*?\bencoding\s*=\s*(["'])([^"']+)\1/.exec(text);
  return match?.[2] ?? null;
}

/**
 * Whether spliced values must be pure ASCII: the declaration names an
 * encoding other than UTF-8 (`ISO-8859-1`, `windows-1252`, `US-ASCII`, …).
 * The bytes were read as UTF-8 (`assertSafeXml`), so such a file holds
 * ASCII only (or bytes every reader reads alike); a raw UTF-8 `ü` written
 * into it would read as `Ã¼` under Latin-1 or break a US-ASCII parser,
 * while `&#xFC;` reads as `ü` under every ASCII-compatible encoding.
 */
function needsAscii(text: string): boolean {
  const encoding = declaredEncoding(text);
  return encoding !== null && !/^utf-?8$/i.test(encoding.trim());
}

function createContext(text: string, base: ExtractResult): Context {
  const doc = scanElements(text);
  const facts = new Map(base.facts.map((f) => [factId(f.kind, f.elementId), f]));
  const zeebe = doc.root.attributes.find(
    (a) => a.name.startsWith('xmlns:') && a.value === ZEEBE_NAMESPACE,
  );
  const ctx: Context = {
    doc,
    base,
    ascii: needsAscii(text),
    facts,
    zeebePrefix: zeebe ? zeebe.name.slice('xmlns:'.length) : null,
    unit: documentUnit(doc),
    readers: new Map(),
  };
  const read = (id: string, fact: Fact): void => {
    const list = ctx.readers.get(id);
    if (list) list.push(fact);
    else ctx.readers.set(id, [fact]);
  };
  for (const fact of base.facts) {
    const el = unique(doc, fact.elementId);
    if (el === undefined) continue;
    if (fact.kind === 'message_flow') {
      const ref = plainAttr(el, 'messageRef')?.value;
      if (isBpmn(el, 'messageFlow') && ref !== undefined && rootReference(ctx, ref, 'message')) {
        read(ref, fact);
      }
    } else if (fact.kind === 'msg_throw' || fact.kind === 'msg_catch') {
      const part = endpointParts(ctx, el, fact.elementId).find((p) => p.kind === 'message');
      if (part?.reference != null) read(part.reference, fact);
    } else if (fact.kind === 'sig_throw' || fact.kind === 'sig_catch') {
      const part = endpointParts(ctx, el, fact.elementId).find((p) => p.kind === 'signal');
      if (part?.reference != null) read(part.reference, fact);
    }
  }
  return ctx;
}

// ----------------------------------------------------------------- locating

type CallWrite =
  | { kind: 'attribute' }
  | { kind: 'zeebe'; zeebe: XmlElement }
  | { kind: 'zeebe-insert'; extension: XmlElement | null };

type Located =
  | { op: 'call-target'; el: XmlElement; fact: Fact; write: CallWrite }
  | { op: 'event-name'; el: XmlElement; fact: Fact }
  | { op: 'process-documentation'; el: XmlElement; fact: Fact }
  | { op: 'message-name'; mode: 'rename'; el: XmlElement; kind: RefKind; readers: Fact[] }
  | {
      op: 'message-name';
      mode: 'create';
      el: XmlElement;
      kind: RefKind;
      fact: Fact;
      holder: XmlElement;
    };

const refuse = (reason: AmendmentRefusalReason, message: string): AmendmentRefusal => ({
  reason,
  message,
});

function isRefusal(value: Located | AmendmentRefusal): value is AmendmentRefusal {
  return 'reason' in value;
}

/** A redeclared prefix on the way from the root to each element (the root excluded). */
function redeclared(
  doc: XmlDocument,
  els: ReadonlyArray<XmlElement | null>,
): AmendmentRefusal | null {
  for (const start of els) {
    for (
      let el = start ?? undefined;
      el !== undefined && el.parent >= 0;
      el = element(doc, el.parent)
    ) {
      if (el.rebinds) {
        return refuse(
          'redeclared-prefix',
          `<${el.name}> rebinds a namespace prefix declared above it`,
        );
      }
    }
  }
  return null;
}

/** The Zeebe called-element extension `Extraction.call` reads: the typed one, else one matched by local name. */
function zeebeCalledElement(doc: XmlDocument, extension: XmlElement | null): XmlElement | null {
  if (extension === null) return null;
  const values = childElements(doc, extension);
  return (
    values.find((v) => v.ns === ZEEBE_NAMESPACE && v.local === 'calledElement') ??
    values.find((v) => v.local.toLowerCase() === 'calledelement') ??
    null
  );
}

function locate(ctx: Context, elementId: string, op: AmendmentOp): Located | AmendmentRefusal {
  const { doc } = ctx;
  const hits = doc.byId.get(elementId) ?? [];
  if (hits.length === 0) return refuse('element-missing', `no element has the id "${elementId}"`);
  if (hits.length > 1) {
    return refuse('duplicate-id', `${hits.length} elements have the id "${elementId}"`);
  }
  const el = element(doc, hits[0] ?? -1);
  if (el === undefined) return refuse('element-missing', `no element has the id "${elementId}"`);

  switch (op) {
    case 'call-target': {
      if (!isBpmn(el, 'callActivity')) {
        return refuse('wrong-element', `<${el.name}> is no call activity`);
      }
      const fact = ctx.facts.get(factId('call', elementId));
      if (fact === undefined) {
        return refuse('unsupported-structure', 'the call activity has no fact');
      }
      if (el.attributes.some((a) => a.ns === CAMUNDA_NAMESPACE && a.local === 'caseRef')) {
        return refuse('cmmn-call', 'the call activity calls a CMMN case (camunda:caseRef)');
      }
      if (isAmendmentExpression(fact.keyRaw)) {
        return refuse('expression', `the call target "${fact.keyRaw}" is an expression`);
      }
      const extensions = bpmnChildren(doc, el, 'extensionElements');
      if (extensions.length > 1) {
        return refuse('unsupported-structure', 'the call activity has two extensionElements');
      }
      const extension = extensions[0] ?? null;
      const zeebe = zeebeCalledElement(doc, extension);
      const engine = ctx.base.engine;
      const write: CallWrite =
        engine === 'c7' || (engine === null && zeebe === null)
          ? { kind: 'attribute' }
          : zeebe !== null
            ? { kind: 'zeebe', zeebe }
            : { kind: 'zeebe-insert', extension };
      return redeclared(doc, [el, extension, zeebe]) ?? { op, el, fact, write };
    }
    case 'event-name': {
      const kind = isBpmn(el, 'startEvent')
        ? 'evt_start'
        : isBpmn(el, 'endEvent')
          ? 'evt_end'
          : null;
      const fact = kind === null ? undefined : ctx.facts.get(factId(kind, elementId));
      if (fact === undefined) {
        return refuse(
          'wrong-element',
          `<${el.name}> is no none, timer or conditional start or none or terminate end event`,
        );
      }
      return redeclared(doc, [el]) ?? { op, el, fact };
    }
    case 'process-documentation': {
      if (!isBpmn(el, 'process') || el.parent !== doc.root.index) {
        return refuse('wrong-element', `<${el.name}> is no process`);
      }
      const fact = ctx.facts.get(factId('process', elementId));
      if (fact === undefined) return refuse('unsupported-structure', 'the process has no fact');
      if (fact.attrs.documentation !== undefined) {
        return refuse('has-documentation', 'the process has documentation; it is never replaced');
      }
      return redeclared(doc, [el]) ?? { op, el, fact };
    }
    case 'message-name': {
      if (isBpmn(el, 'message') || isBpmn(el, 'signal')) {
        const kind: RefKind = el.local === 'message' ? 'message' : 'signal';
        if (el.parent !== doc.root.index) {
          return refuse('unsupported-structure', `the ${kind} is no root element`);
        }
        const name = sanitizeLine(plainAttr(el, 'name')?.value ?? '', MAX_KEY_LENGTH).text;
        if (isAmendmentExpression(name)) {
          return refuse('expression', `the ${kind} name "${name}" is an expression`);
        }
        const readers = ctx.readers.get(elementId) ?? [];
        return redeclared(doc, [el]) ?? { op, mode: 'rename', el, kind, readers };
      }
      const parts = endpointParts(ctx, el, elementId);
      if (parts.length === 0) {
        return refuse('wrong-element', `<${el.name}> is no message or signal and no endpoint`);
      }
      const open = parts.filter((p) => p.reference === null);
      const [part] = open;
      if (part === undefined) {
        const refs = parts.map((p) => `${p.kind} "${p.reference ?? ''}"`).join(' and ');
        return refuse('wrong-element', `the endpoint references the ${refs}; amend that element`);
      }
      if (open.length > 1) {
        return refuse(
          'unsupported-structure',
          'the event has a message and a signal definition without a reference',
        );
      }
      if (part.unsupported !== null || part.holder === null) {
        return refuse(
          'unsupported-structure',
          part.unsupported ?? 'no element carries the reference',
        );
      }
      return (
        redeclared(doc, [el, part.holder]) ?? {
          op,
          mode: 'create',
          el,
          kind: part.kind,
          fact: part.fact,
          holder: part.holder,
        }
      );
    }
  }
}

// ---------------------------------------------------------------- splicing

interface Splice {
  start: number;
  end: number;
  text: string;
  owner: number;
}

/** A new element: a leaf (one string) or an element with children. */
type NewNode = string | { open: string; close: string; children: NewNode[] };

interface Layout {
  indent: string;
  unit: string;
  nl: string;
}

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
  '\t': '&#9;',
  '\n': '&#10;',
  '\r': '&#13;',
};

/**
 * Escapes `&`, `<`, `>`, `"`, tab and line breaks as references (`'` too
 * inside `'…'`); with `ascii`, also every code point above U+007E
 * (`&#xFC;`), for a file whose declaration names another encoding than
 * UTF-8.
 */
export function escapeXmlValue(value: string, quote: '"' | "'" = '"', ascii = false): string {
  const pattern = quote === "'" ? /[&<>"'\t\n\r]/g : /[&<>"\t\n\r]/g;
  const escaped = value.replace(pattern, (c) => ESCAPES[c] ?? c);
  return ascii
    ? escaped.replace(
        /[^ -~]/gu, // tab and line breaks are references already
        (c) => `&#x${(c.codePointAt(0) ?? 0).toString(16).toUpperCase()};`,
      )
    : escaped;
}

function render(node: NewNode, layout: Layout | null): string {
  if (typeof node === 'string') return node;
  if (layout === null) {
    return node.open + node.children.map((c) => render(c, null)).join('') + node.close;
  }
  const inner: Layout = { ...layout, indent: layout.indent + layout.unit };
  const children = node.children.map((c) => layout.nl + inner.indent + render(c, inner)).join('');
  return node.open + children + layout.nl + layout.indent + node.close;
}

/** The indentation step below `parent`. */
function unitBelow(ctx: Context, parent: XmlElement): string {
  const child = childElements(ctx.doc, parent).find((c) => c.indent !== null);
  const grand = element(ctx.doc, parent.parent);
  const step = (
    outer: string | null | undefined,
    inner: string | null | undefined,
  ): string | null =>
    outer != null && inner != null && inner.length > outer.length && inner.startsWith(outer)
      ? inner.slice(outer.length)
      : null;
  return step(parent.indent, child?.indent) ?? step(grand?.indent, parent.indent) ?? ctx.unit;
}

function prefixed(el: XmlElement, local: string): string {
  return el.prefix === null ? local : `${el.prefix}:${local}`;
}

/** `name="value"` set on a start tag: the value replaced, or the attribute added after the last one. */
function setAttribute(
  ctx: Pick<Context, 'ascii'>,
  el: XmlElement,
  name: string,
  value: string,
  owner: number,
): Splice {
  const attr = plainAttr(el, name);
  if (attr) {
    return {
      start: attr.valueStart,
      end: attr.valueEnd,
      text: escapeXmlValue(value, attr.quote, ctx.ascii),
      owner,
    };
  }
  return {
    start: el.attrsEnd,
    end: el.attrsEnd,
    text: ` ${name}="${escapeXmlValue(value, '"', ctx.ascii)}"`,
    owner,
  };
}

/** Expands `<x …/>` to `<x …>node</x>`. */
function expand(ctx: Context, el: XmlElement, node: NewNode, owner: number): Splice {
  let inner: string;
  if (el.indent === null) {
    inner = render(node, null);
  } else {
    const unit = unitBelow(ctx, el);
    const layout: Layout = { indent: el.indent + unit, unit, nl: el.nl };
    inner = el.nl + layout.indent + render(node, layout) + el.nl + el.indent;
  }
  return { start: el.attrsEnd, end: el.startTagEnd, text: `>${inner}</${el.name}>`, owner };
}

/** `node` into an element without element children, at its start or its end. */
function intoEmpty(
  ctx: Context,
  parent: XmlElement,
  node: NewNode,
  owner: number,
  at: 'start' | 'end',
): Splice {
  if (parent.selfClosing) return expand(ctx, parent, node, owner);
  const content = ctx.doc.text.slice(parent.startTagEnd, parent.closeStart);
  if (parent.indent !== null && /^[ \t\r\n]*$/.test(content)) {
    const unit = unitBelow(ctx, parent);
    const layout: Layout = { indent: parent.indent + unit, unit, nl: parent.nl };
    return {
      start: parent.startTagEnd,
      end: parent.closeStart,
      text: parent.nl + layout.indent + render(node, layout) + parent.nl + parent.indent,
      owner,
    };
  }
  const position = at === 'start' ? parent.startTagEnd : parent.closeStart;
  return { start: position, end: position, text: render(node, null), owner };
}

function insertAfter(ctx: Context, sibling: XmlElement, node: NewNode, owner: number): Splice {
  const parent = element(ctx.doc, sibling.parent);
  if (sibling.indent === null || parent === undefined) {
    return { start: sibling.end, end: sibling.end, text: render(node, null), owner };
  }
  const layout: Layout = { indent: sibling.indent, unit: unitBelow(ctx, sibling), nl: sibling.nl };
  return {
    start: sibling.end,
    end: sibling.end,
    text: sibling.nl + sibling.indent + render(node, layout),
    owner,
  };
}

function insertFirst(ctx: Context, parent: XmlElement, node: NewNode, owner: number): Splice {
  const [first] = childElements(ctx.doc, parent);
  if (first === undefined) return intoEmpty(ctx, parent, node, owner, 'start');
  if (first.indent === null) {
    return { start: parent.startTagEnd, end: parent.startTagEnd, text: render(node, null), owner };
  }
  const layout: Layout = { indent: first.indent, unit: unitBelow(ctx, first), nl: first.nl };
  return {
    start: parent.startTagEnd,
    end: parent.startTagEnd,
    text: first.nl + first.indent + render(node, layout),
    owner,
  };
}

function append(ctx: Context, parent: XmlElement, node: NewNode, owner: number): Splice {
  const children = childElements(ctx.doc, parent);
  const last = children[children.length - 1];
  return last === undefined
    ? intoEmpty(ctx, parent, node, owner, 'end')
    : insertAfter(ctx, last, node, owner);
}

/** Message or signal id: `Message_` / `Signal_` + 8 hex of sha256(amendment id), `_2`, `_3` … on a collision. */
function newReferenceId(kind: RefKind, amendmentId: string, taken: Set<string>): string {
  const stem = `${kind === 'message' ? 'Message' : 'Signal'}_${createHash('sha256').update(amendmentId, 'utf8').digest('hex').slice(0, 8)}`;
  let id = stem;
  for (let n = 2; taken.has(id); n++) id = `${stem}_${n}`;
  taken.add(id);
  return id;
}

// ------------------------------------------------------------ expectations

/** How the facts of the amended document must differ: per fact identity. */
interface Expectation {
  owner: number;
  apply: (fact: Fact) => Fact;
}

interface Built {
  splices: Splice[];
  facts: Map<string, Expectation[]>;
  /** Message flow element id → the message name its `MessageFlowInfo` must carry. */
  flows: Map<string, { owner: number; name: string }>;
}

function withKey(fact: Fact, keyRaw: string, refName: string | null, attrs: FactAttrs): Fact {
  return {
    ...fact,
    keyRaw,
    keyNorm: normalizeKey(keyRaw),
    fingerprint: factFingerprint({
      kind: fact.kind,
      eventDef: fact.eventDef,
      keyRaw,
      label: fact.label,
      scope: fact.scope,
      refName,
    }),
    attrs,
  };
}

/** An endpoint whose message or signal name becomes `name`. */
function renamedEndpoint(fact: Fact, kind: RefKind, name: string): Fact {
  const attr = kind === 'message' ? 'messageName' : 'signalName';
  return withKey(fact, name, name, { ...fact.attrs, [attr]: name, dynamic: false });
}

/** A message flow whose message's name becomes `name` (its own name, if any, stays its key). */
function renamedFlow(fact: Fact, name: string): Fact {
  const keyRaw = fact.label !== '' ? fact.keyRaw : name;
  return withKey(fact, keyRaw, name, { ...fact.attrs, messageName: name });
}

function build(
  ctx: Context,
  items: ReadonlyArray<{ index: number; amendment: Amendment; located: Located }>,
): Built {
  const built: Built = { splices: [], facts: new Map(), flows: new Map() };
  const taken = new Set(ctx.doc.byId.keys());
  const expect = (fact: Fact, owner: number, apply: (f: Fact) => Fact): void => {
    const id = factId(fact.kind, fact.elementId);
    const list = built.facts.get(id) ?? [];
    list.push({ owner, apply });
    built.facts.set(id, list);
  };
  for (const { index: owner, amendment, located } of items) {
    const value = amendment.after;
    switch (located.op) {
      case 'call-target': {
        const { el, write } = located;
        if (write.kind === 'attribute') {
          built.splices.push(setAttribute(ctx, el, 'calledElement', value, owner));
        } else if (write.kind === 'zeebe') {
          built.splices.push(setAttribute(ctx, write.zeebe, 'processId', value, owner));
        } else {
          const prefix = ctx.zeebePrefix ?? 'zeebe';
          const declaration = ctx.zeebePrefix === null ? ` xmlns:zeebe="${ZEEBE_NAMESPACE}"` : '';
          const called = `<${prefix}:calledElement${declaration} processId="${escapeXmlValue(value, '"', ctx.ascii)}" />`;
          if (write.extension !== null) {
            built.splices.push(append(ctx, write.extension, called, owner));
          } else {
            const ext = prefixed(el, 'extensionElements');
            const node: NewNode = { open: `<${ext}>`, close: `</${ext}>`, children: [called] };
            const docs = bpmnChildren(ctx.doc, el, 'documentation');
            const lastDoc = docs[docs.length - 1];
            built.splices.push(
              lastDoc === undefined
                ? insertFirst(ctx, el, node, owner)
                : insertAfter(ctx, lastDoc, node, owner),
            );
          }
        }
        expect(located.fact, owner, (f) =>
          withKey(f, value, value, { ...f.attrs, dynamic: false }),
        );
        break;
      }
      case 'event-name': {
        built.splices.push(setAttribute(ctx, located.el, 'name', value, owner));
        expect(located.fact, owner, (f) => withKey({ ...f, label: value }, value, null, f.attrs));
        break;
      }
      case 'process-documentation': {
        const doc = prefixed(located.el, 'documentation');
        const node = `<${doc}>${escapeXmlValue(value, '"', ctx.ascii)}</${doc}>`;
        built.splices.push(insertFirst(ctx, located.el, node, owner));
        expect(located.fact, owner, (f) => ({ ...f, attrs: { ...f.attrs, documentation: value } }));
        break;
      }
      case 'message-name': {
        const { kind } = located;
        if (located.mode === 'rename') {
          built.splices.push(setAttribute(ctx, located.el, 'name', value, owner));
          for (const reader of located.readers) {
            if (reader.kind === 'message_flow') {
              expect(reader, owner, (f) => renamedFlow(f, value));
              built.flows.set(reader.elementId, { owner, name: value });
            } else {
              expect(reader, owner, (f) => renamedEndpoint(f, kind, value));
            }
          }
        } else {
          const id = newReferenceId(kind, amendment.id, taken);
          const root = ctx.doc.root;
          const node = `<${prefixed(root, kind)} id="${escapeXmlValue(id)}" name="${escapeXmlValue(value, '"', ctx.ascii)}" />`;
          // The XSD's order: import*, extension*, rootElement*, BPMNDiagram*, relationship*;
          // a new root element goes after the last one before the first diagram or relationship.
          const children = childElements(ctx.doc, root);
          const stop = children.findIndex(
            (c) =>
              (c.ns === BPMNDI_NAMESPACE && c.local === 'BPMNDiagram') || isBpmn(c, 'relationship'),
          );
          const before = stop < 0 ? children[children.length - 1] : children[stop - 1];
          built.splices.push(
            before === undefined
              ? insertFirst(ctx, root, node, owner)
              : insertAfter(ctx, before, node, owner),
          );
          const refAttr = kind === 'message' ? 'messageRef' : 'signalRef';
          built.splices.push(setAttribute(ctx, located.holder, refAttr, id, owner));
          expect(located.fact, owner, (f) => renamedEndpoint(f, kind, value));
        }
        break;
      }
    }
  }
  return built;
}

/** The owner of the first splice that overlaps an earlier one, or `null`. */
function overlap(splices: readonly Splice[]): number | null {
  const sorted = sortSplices(splices);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev !== undefined && cur !== undefined && cur.start < prev.end) return cur.owner;
  }
  return null;
}

function sortSplices(splices: readonly Splice[]): Splice[] {
  return [...splices].sort((a, b) => a.start - b.start || a.end - b.end || a.owner - b.owner);
}

function splice(text: string, splices: readonly Splice[]): string {
  let out = '';
  let at = 0;
  for (const s of sortSplices(splices)) {
    out += text.slice(at, s.start) + s.text;
    at = s.end;
  }
  return out + text.slice(at);
}

// ------------------------------------------------------------------ checking

type Check =
  { ok: true; extraction: ExtractResult } | { ok: false; blame: number[] | null; message: string };

function countCodes(warnings: ExtractResult['warnings']): Map<string, number> {
  const counts = new Map<string, number>();
  for (const w of warnings) counts.set(w.code, (counts.get(w.code) ?? 0) + 1);
  return counts;
}

/**
 * The amended text passes `assertSafeXml` and the limits again, and its facts
 * are the base facts with exactly the expected changes: the same facts,
 * processes, engine and message flows otherwise, and no new warning.
 */
async function verify(
  text: string,
  ctx: Context,
  built: Built,
  opts: ExtractOptions,
): Promise<Check> {
  let next: ExtractResult;
  try {
    next = await extractFacts(text, opts);
  } catch (err) {
    if (err instanceof BpmnInputError) {
      return {
        ok: false,
        blame: null,
        message: `the amended document is rejected: ${err.message}`,
      };
    }
    throw err;
  }
  const { base } = ctx;
  const unattributed = (message: string): Check => ({ ok: false, blame: null, message });
  if (next.engine !== base.engine) return unattributed('the engine would change');
  if (canonicalJson(next.processes) !== canonicalJson(base.processes)) {
    return unattributed('the processes would change');
  }
  const after = new Map(next.facts.map((f) => [factId(f.kind, f.elementId), f]));
  if (after.size !== ctx.facts.size || [...ctx.facts.keys()].some((id) => !after.has(id))) {
    return unattributed('facts would be added or removed');
  }
  const blame = new Set<number>();
  let message = '';
  for (const [id, fact] of ctx.facts) {
    const expectations = built.facts.get(id) ?? [];
    const expected = expectations.reduce((f, e) => e.apply(f), fact);
    if (canonicalJson(after.get(id)) === canonicalJson(expected)) continue;
    if (expectations.length === 0) return unattributed(`the fact ${id} would change`);
    for (const e of expectations) blame.add(e.owner);
    message ||= `the fact ${id} would not read exactly the intended change`;
  }
  const flows = new Map(next.messageFlows.map((f) => [f.elementId, f]));
  if (flows.size !== base.messageFlows.length) {
    return unattributed('message flows would be added or removed');
  }
  for (const flow of base.messageFlows) {
    const change = built.flows.get(flow.elementId);
    const expected: MessageFlowInfo = change ? { ...flow, messageName: change.name } : flow;
    if (canonicalJson(flows.get(flow.elementId)) === canonicalJson(expected)) continue;
    if (change === undefined)
      return unattributed(`the message flow ${flow.elementId} would change`);
    blame.add(change.owner);
    message ||= `the message flow ${flow.elementId} would not read exactly the intended change`;
  }
  const before = countCodes(base.warnings);
  for (const [code, count] of countCodes(next.warnings)) {
    if (count > (before.get(code) ?? 0)) return unattributed(`a new warning ${code}`);
  }
  if (blame.size > 0) return { ok: false, blame: [...blame], message };
  return { ok: true, extraction: next };
}

// ------------------------------------------------------------------ the API

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;

function hasBom(xml: string | Uint8Array): boolean {
  return typeof xml === 'string'
    ? xml.charCodeAt(0) === 0xfeff
    : UTF8_BOM.every((b, i) => xml[i] === b);
}

function encode(text: string, bom: boolean): Uint8Array {
  const body = new TextEncoder().encode(text);
  if (!bom) return body;
  const out = new Uint8Array(body.length + UTF8_BOM.length);
  out.set(UTF8_BOM);
  out.set(body, UTF8_BOM.length);
  return out;
}

/**
 * Applies amendments to the bytes of an uploaded revision (M6 §4.8 c
 * "Applying"), byte-preserving: each amendment replaces or adds one attribute
 * or inserts one minimal element; every other byte stays, vendor extensions,
 * comments, whitespace, the BOM and line endings included. The target is
 * found by its `id` (exactly one element, of the op's BPMN type, in the BPMN
 * model namespace through a prefix or the default namespace, no prefix
 * rebound on the way). Values are escaped (`&`, `<`, `>`, `"`, tab and line
 * breaks as references).
 *
 * Where it writes: `call-target` the field `Extraction.call` reads (C7 the
 * `calledElement` attribute; C8 `processId` of `zeebe:calledElement`,
 * inserted into `extensionElements` when missing; without an engine the
 * attribute, or the Zeebe extension when the element has one);
 * `message-name` the referenced message's or signal's `name`, or a new
 * `<message>` (`<signal>`) after the last root element before the first
 * `BPMNDiagram` plus the `messageRef` (`signalRef`); `event-name` the
 * event's `name`; `process-documentation` a `<documentation>` as the
 * process's first child. Insertion keeps the BPMN child order: a self-closing
 * start tag is expanded, a new `extensionElements` goes right after the last
 * `documentation`, else first; new BPMN elements take the amended element's
 * prefix (the definitions' for a root element); `zeebe:calledElement` takes
 * the root's prefix for the Zeebe namespace or declares `xmlns:zeebe` on
 * itself. New lines follow the neighbouring indentation and line breaks.
 *
 * Checked: the result passes `assertSafeXml` and the limits; `extractFacts`
 * reads every amended field as `after` and every other fact, process and
 * message flow exactly as before (a shared message's other readers change
 * in their message name and what derives from it only); no new warning. An
 * amendment that fails a check is refused and nothing of it is written; the
 * others are applied. Deterministic: identical inputs give identical bytes.
 *
 * @param amendments in seq order
 * @throws {BpmnInputError} when the input itself is hostile, oversized or not BPMN (as `extractFacts`)
 */
export async function applyAmendments(
  xml: string | Uint8Array,
  amendments: readonly Amendment[],
  opts: ExtractOptions,
): Promise<AmendResult> {
  const limits = resolveLimits(opts.limits);
  const text = assertSafeXml(xml, limits);
  const base = await extractFacts(xml, opts);
  const outcomes: Array<AmendmentOutcome | undefined> = amendments.map(() => undefined);
  const refused = (index: number, refusal: AmendmentRefusal): void => {
    const a = amendments[index];
    if (a !== undefined) {
      outcomes[index] = {
        id: a.id,
        elementId: a.elementId,
        op: a.op,
        status: 'refused',
        ...refusal,
      };
    }
  };
  let ctx: Context | null = null;
  let unreadable: string | null = null;
  try {
    ctx = createContext(text, base);
  } catch (err) {
    if (!(err instanceof BpmnInputError)) throw err;
    unreadable = err.message;
  }

  let live: Array<{ index: number; amendment: Amendment; located: Located }> = [];
  const seen = new Set<string>();
  amendments.forEach((amendment, index) => {
    const { elementId, op, after } = amendment;
    if (!(AMENDMENT_OPS as readonly string[]).includes(op)) {
      refused(index, refuse('invalid-value', `unknown op ${JSON.stringify(op)}`));
      return;
    }
    const key = `${op}\u0000${elementId}`;
    if (seen.has(key)) {
      refused(
        index,
        refuse('duplicate-amendment', `an earlier amendment sets ${op} of "${elementId}"`),
      );
      return;
    }
    seen.add(key);
    const normalized = normalizeAmendmentValue(op, after);
    if (!normalized.ok || normalized.value !== after) {
      const problem = normalized.ok ? 'not in its normalized form' : normalized.problem;
      refused(index, refuse('invalid-value', `the value is ${problem}`));
      return;
    }
    if (ctx === null) {
      refused(
        index,
        refuse('unsupported-structure', `the markup cannot be spliced: ${unreadable ?? ''}`),
      );
      return;
    }
    if (ctx.ascii && /[\u{10000}-\u{10FFFF}]/u.test(after)) {
      // Written as `&#x1F600;`, which the extractor's parser (saxen) decodes with
      // `String.fromCharCode`, so the check could never read it back.
      refused(
        index,
        refuse(
          'unsupported-structure',
          'the file declares an encoding other than UTF-8, and a character outside the Basic Multilingual Plane cannot be written so the facts read it back',
        ),
      );
      return;
    }
    const located = locate(ctx, elementId, op);
    if (isRefusal(located)) refused(index, located);
    else live.push({ index, amendment, located });
  });

  while (ctx !== null && live.length > 0) {
    const built = build(ctx, live);
    const clash = overlap(built.splices);
    if (clash !== null) {
      refused(clash, refuse('unsupported-structure', 'its change overlaps an earlier amendment'));
      live = live.filter((l) => l.index !== clash);
      continue;
    }
    const amended = splice(text, built.splices);
    const check = await verify(amended, ctx, built, opts);
    if (check.ok) {
      for (const { index, amendment: a } of live) {
        outcomes[index] = { id: a.id, elementId: a.elementId, op: a.op, status: 'applied' };
      }
      return {
        xml: encode(amended, hasBom(xml)),
        outcomes: outcomes.filter((o): o is AmendmentOutcome => o !== undefined),
        extraction: check.extraction,
      };
    }
    // Unattributed: try each alone; if each passes alone, they fail together.
    let blame: Array<{ index: number; message: string }> =
      check.blame?.map((index) => ({ index, message: check.message })) ?? [];
    if (check.blame === null) {
      if (live.length === 1) {
        blame = live.map(({ index }) => ({ index, message: check.message }));
      } else {
        for (const one of live) {
          const alone = build(ctx, [one]);
          const result = await verify(splice(text, alone.splices), ctx, alone, opts);
          if (!result.ok) blame.push({ index: one.index, message: result.message });
        }
        if (blame.length === 0) {
          blame = live.map(({ index }) => ({
            index,
            message: `${check.message} (together with the other amendments)`,
          }));
        }
      }
    }
    for (const { index, message } of blame) refused(index, refuse('check-failed', message));
    const out = new Set(blame.map((b) => b.index));
    live = live.filter((l) => !out.has(l.index));
  }
  return {
    xml: typeof xml === 'string' ? encode(text, hasBom(xml)) : new Uint8Array(xml),
    outcomes: outcomes.filter((o): o is AmendmentOutcome => o !== undefined),
    extraction: base,
  };
}

function nameOrNull(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : value;
}

/**
 * Reads, per element a v1 amendment can key, its kind, its current value in
 * the facts' sanitized form, whether that value is an expression in either
 * dialect, whether a call has `camunda:caseRef`, the message or signal an
 * endpoint references and who reads a message's name, and why an amendment
 * would be refused whatever its value (`blocked`): what `planAmendments`,
 * `amendable` and the checks need beyond facts v1, which carry neither
 * message ids nor `caseRef`.
 *
 * @throws {BpmnInputError} when the input is hostile, oversized or not BPMN (as `extractFacts`)
 */
export async function readAmendable(
  xml: string | Uint8Array,
  opts: ExtractOptions,
): Promise<AmendableDocument> {
  const limits = resolveLimits(opts.limits);
  const text = assertSafeXml(xml, limits);
  const base = await extractFacts(xml, opts);
  let ctx: Context | null = null;
  let unreadable: AmendmentRefusal | null = null;
  try {
    ctx = createContext(text, base);
  } catch (err) {
    if (!(err instanceof BpmnInputError)) throw err;
    unreadable = refuse('unsupported-structure', `the markup cannot be spliced: ${err.message}`);
  }
  const blockedFor = (elementId: string, op: AmendmentOp): AmendmentRefusal | null => {
    if (ctx === null) return unreadable;
    const located = locate(ctx, elementId, op);
    return isRefusal(located) ? located : null;
  };

  const fields: AmendableField[] = [];
  const endpoints: AmendableEndpoint[] = [];
  const keyedEndpoints = new Set<string>();
  for (const fact of base.facts) {
    const { elementId, processId } = fact;
    switch (fact.kind) {
      case 'call': {
        const el = ctx === null ? undefined : unique(ctx.doc, elementId);
        fields.push({
          elementId,
          op: 'call-target',
          element: 'call',
          processId,
          value: fact.keyRaw,
          expression: isAmendmentExpression(fact.keyRaw),
          caseRef:
            el?.attributes.some((a) => a.ns === CAMUNDA_NAMESPACE && a.local === 'caseRef') ??
            false,
          blocked: blockedFor(elementId, 'call-target'),
        });
        break;
      }
      case 'evt_start':
      case 'evt_end': {
        const value = nameOrNull(fact.label);
        fields.push({
          elementId,
          op: 'event-name',
          element: fact.kind === 'evt_start' ? 'start-event' : 'end-event',
          processId,
          value,
          expression: isAmendmentExpression(value ?? ''),
          blocked: blockedFor(elementId, 'event-name'),
        });
        break;
      }
      case 'process': {
        const value = nameOrNull(fact.attrs.documentation);
        fields.push({
          elementId,
          op: 'process-documentation',
          element: 'process',
          processId,
          value,
          expression: false,
          blocked: blockedFor(elementId, 'process-documentation'),
        });
        break;
      }
      case 'msg_throw':
      case 'msg_catch':
      case 'sig_throw':
      case 'sig_catch': {
        const kind: RefKind = fact.kind.startsWith('msg') ? 'message' : 'signal';
        const el = ctx === null ? undefined : unique(ctx.doc, elementId);
        const part =
          ctx === null || el === undefined
            ? undefined
            : endpointParts(ctx, el, elementId).find((p) => p.kind === kind);
        const name = nameOrNull(
          kind === 'message' ? fact.attrs.messageName : fact.attrs.signalName,
        );
        const reference = part?.reference ?? null;
        endpoints.push({
          elementId,
          kind: fact.kind,
          processId,
          reference,
          name,
          expression: isAmendmentExpression(name ?? ''),
          amendmentElementId: reference ?? elementId,
        });
        if (reference === null && !keyedEndpoints.has(elementId)) {
          keyedEndpoints.add(elementId);
          fields.push({
            elementId,
            op: 'message-name',
            element: 'endpoint',
            processId,
            value: name,
            expression: isAmendmentExpression(name ?? ''),
            readers: [elementId],
            blocked: blockedFor(elementId, 'message-name'),
          });
        }
        break;
      }
      case 'task':
      case 'data_store':
      case 'message_flow':
      case 'lane':
        break;
    }
  }
  if (ctx !== null) {
    const listed = new Set<string>();
    for (const child of childElements(ctx.doc, ctx.doc.root)) {
      const id = plainAttr(child, 'id')?.value;
      if (id === undefined || !(isBpmn(child, 'message') || isBpmn(child, 'signal'))) continue;
      if (listed.has(id)) continue;
      listed.add(id);
      const value = nameOrNull(
        sanitizeLine(plainAttr(child, 'name')?.value ?? '', MAX_KEY_LENGTH).text,
      );
      fields.push({
        elementId: id,
        op: 'message-name',
        element: child.local === 'message' ? 'message' : 'signal',
        processId: null,
        value,
        expression: isAmendmentExpression(value ?? ''),
        readers: [...new Set((ctx.readers.get(id) ?? []).map((f) => f.elementId))].sort(
          compareStrings,
        ),
        blocked: blockedFor(id, 'message-name'),
      });
    }
  }
  fields.sort((a, b) => compareStrings(a.elementId, b.elementId) || compareStrings(a.op, b.op));
  endpoints.sort(
    (a, b) => compareStrings(a.elementId, b.elementId) || compareStrings(a.kind, b.kind),
  );
  return { engine: base.engine, fields, endpoints };
}

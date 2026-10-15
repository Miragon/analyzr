/**
 * `normalize-bpmn` for one file (M6 §3.7): makes a tool's BPMN 2.0 export
 * readable by analyzr without losing elements, and changes nothing else.
 *
 * - Bytes analyzr already reads completely (UTF-8, every id safe and unique)
 *   pass through unchanged: `derived.kind` `export`.
 * - Otherwise the file is converted (`converted`): ids analyzr or bpmn-moddle
 *   would refuse are rewritten by M6 §3.4 rule 2 (`<Type>_<source id>`, a
 *   suffix on collisions), duplicates get a deterministic suffix, an element
 *   analyzr or bpmn-js needs an id for but that has none gets one derived
 *   from its place (`<Type>_<hash of the nearest id above it, type, name and
 *   position>`), every reference to a rewritten id follows (attributes such
 *   as `sourceRef`, `targetRef`, `default`, `attachedToRef`, `messageRef`,
 *   `processRef`, the DI's `bpmnElement`, and reference texts such as
 *   `<incoming>`), a static `calledElement` that is no safe id is rewritten
 *   the way a process id would be; then bpmn-moddle reads and writes the
 *   document, as UTF-8, indented, or compact when indenting would exceed
 *   analyzr's 5 MB.
 *
 * Losses are counted (M6 §3.2): `id-rewritten` (rewritten and added ids),
 * `element-dropped` and `attribute-dropped` (content bpmn-moddle dropped
 * while converting) and `layout-missing` (elements without a DI shape or
 * edge, which the model view cannot draw). References to a duplicated id that
 * cannot be told apart are listed (`ambiguousReferences`). The written bytes
 * are reproducible: no timestamps, the same input gives the same output (M6
 * §3.4 rule 3).
 */
import { createHash } from 'node:crypto';

import { isBpmnRoot, summarizeBpmn, type BpmnSummary } from './bpmn-scan.ts';
import { decodeText, detectEncoding, EncodingError, isAscii } from './encoding.ts';
import { isSafeId, sanitizeId, shortHash, uniqueId } from './ids.ts';
import {
  extensionOf,
  parseBpmn,
  TypeResolver,
  moddleFor,
  writeBpmn,
  type ModdleExtension,
} from './moddle.ts';
import {
  applyEdits,
  attribute,
  escapeAttribute,
  escapeText,
  ownText,
  parseXml,
  XmlSyntaxError,
  type TextEdit,
  type XmlAttribute,
  type XmlElement,
} from './xml.ts';

/** analyzr's limits (`DEFAULT_PARSE_LIMITS` of `@analyzr/bpmn-facts`), checked on what normalize returns. */
export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_ELEMENTS = 50_000;

/** The largest input normalize reads: UTF-16 takes up to twice the bytes of its UTF-8 output. */
export const MAX_INPUT_BYTES = 2 * MAX_BYTES + 4;

/** Loss codes of the manifest (M6 §3.2) that normalize-bpmn reports. */
export type LossCode = 'id-rewritten' | 'element-dropped' | 'attribute-dropped' | 'layout-missing';

export interface Loss {
  code: LossCode;
  count: number;
}

export interface IdRewrite {
  /** The id as written (`''` for `missing`). */
  from: string;
  to: string;
  /**
   * `unsafe`: not an id analyzr and bpmn-moddle both accept; `duplicate`: a
   * second element with that id; `missing`: no id at all on an element
   * analyzr or bpmn-js needs one for.
   */
  reason: 'unsafe' | 'duplicate' | 'missing';
  /** The element's moddle type, e.g. `bpmn:Task`. */
  type: string;
}

/** A reference to a duplicated id that could not be told apart (the model should be checked). */
export interface AmbiguousReference {
  /** The (new) id of the element holding the reference, `''` if it has none. */
  element: string;
  /** The reference property, e.g. `targetRef`, `incoming`, `default`. */
  property: string;
  /** The duplicated id as written. */
  reference: string;
  /** The id normalize chose. */
  to: string;
}

export interface NormalizeResult {
  kind: 'export' | 'converted';
  /** The bytes to import (the input itself for `export`). */
  bytes: Uint8Array;
  sha256: string;
  /** The input's encoding, e.g. `utf-8` or `utf-16le`. */
  encoding: string;
  idRewrites: IdRewrite[];
  /** Static `calledElement` values rewritten like process ids. */
  calledElementRewrites: { from: string; to: string }[];
  /** References to duplicated ids normalize could only guess (at most 100). */
  ambiguousReferences: AmbiguousReference[];
  /** Written without indentation: indented, the document would exceed analyzr's 5 MB. */
  compact: boolean;
  /** Counted losses, codes in a fixed order, only codes with a count. */
  losses: Loss[];
  /**
   * bpmn-moddle's warnings for the written bytes, one line each (at most
   * 100): what analyzr's extractor reports as `parse-warning`
   * („Unbekannter oder fehlerhafter Inhalt“).
   */
  parseWarnings: string[];
  /** Ids of elements without a DI shape or edge (at most 100). */
  layoutMissing: string[];
  summary: BpmnSummary;
}

export type NormalizeErrorCode =
  | 'too-large'
  | 'unsupported-encoding'
  | 'not-xml'
  | 'doctype-forbidden'
  | 'not-bpmn'
  | 'too-many-elements';

/** A file normalize-bpmn cannot turn into BPMN analyzr accepts. */
export class NormalizeError extends Error {
  readonly code: NormalizeErrorCode;

  constructor(code: NormalizeErrorCode, message: string) {
    super(message);
    this.name = 'NormalizeError';
    this.code = code;
  }
}

const LOSS_ORDER: readonly LossCode[] = [
  'element-dropped',
  'attribute-dropped',
  'id-rewritten',
  'layout-missing',
];

const MAX_LISTED = 100;
const DOCTYPE = /<!\s*DOCTYPE/i;
const ENTITY = /<!\s*ENTITY/i;

/**
 * Types whose elements need an id: analyzr's extractor skips them without one
 * (`missing-id`), and bpmn-js cannot link them to a DI shape.
 */
const NEEDS_ID_TYPES = [
  'bpmn:FlowElement',
  'bpmn:Process',
  'bpmn:Collaboration',
  'bpmn:Participant',
  'bpmn:Lane',
  'bpmn:MessageFlow',
  'bpmn:Artifact',
];

/** Types bpmn-js draws: an element of one of them without DI is not shown in the model view. */
const DRAWN_TYPES = [
  'bpmn:FlowNode',
  'bpmn:SequenceFlow',
  'bpmn:MessageFlow',
  'bpmn:Participant',
  'bpmn:Lane',
  'bpmn:DataObjectReference',
  'bpmn:DataStoreReference',
  'bpmn:TextAnnotation',
  'bpmn:Association',
  'bpmn:Group',
];

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** An expression instead of a process id: C7 `${…}`/`#{…}`, C8 FEEL `=…`. */
export function isExpression(value: string): boolean {
  return value.startsWith('=') || value.includes('${') || value.includes('#{');
}

interface Occurrence {
  id: string;
  el: XmlElement;
  attr: XmlAttribute;
  /** Qualified moddle type, e.g. `bpmn:Task`. */
  type: string;
}

interface ReferenceSite {
  /** The element the reference belongs to (for a text reference: its parent). */
  owner: XmlElement;
  property: string;
  /** Attribute holding the reference, or `null` for a reference text in `textEl`. */
  attr: XmlAttribute | null;
  textEl: XmlElement | null;
  tokens: string[];
}

/** An element of a {@link NEEDS_ID_TYPES} type without an id (`attr`: an empty `id=""`). */
interface MissingId {
  el: XmlElement;
  attr: XmlAttribute | null;
  type: string;
}

/** What the document holds: id occurrences, references and call activities, with their types. */
interface Analysis {
  occurrences: Map<string, Occurrence[]>;
  /** Ids in order of their first occurrence. */
  order: string[];
  missing: MissingId[];
  references: ReferenceSite[];
  calledElements: { el: XmlElement; attr: XmlAttribute }[];
  types: Map<XmlElement, string | null>;
}

function analyze(root: XmlElement, resolver: TypeResolver): Analysis {
  const occurrences = new Map<string, Occurrence[]>();
  const order: string[] = [];
  const missing: MissingId[] = [];
  const references: ReferenceSite[] = [];
  const calledElements: Analysis['calledElements'] = [];
  const types = new Map<XmlElement, string | null>();

  const visit = (el: XmlElement, type: string | null): void => {
    types.set(el, type);
    if (type !== null) {
      const idAttr = el.attributes.find((a) => a.name === 'id');
      if (
        (idAttr === undefined || idAttr.value === '') &&
        NEEDS_ID_TYPES.some((t) => resolver.isA(type, t))
      ) {
        missing.push({ el, attr: idAttr ?? null, type });
      }
      for (const attr of el.attributes) {
        if (attr.name === 'id' && resolver.hasId(type) && attr.value !== '') {
          const occurrence = { id: attr.value, el, attr, type };
          const list = occurrences.get(attr.value);
          if (list) list.push(occurrence);
          else {
            occurrences.set(attr.value, [occurrence]);
            order.push(attr.value);
          }
          continue;
        }
        const ref = resolver.attributeReference(type, attr.name);
        if (ref !== null) {
          references.push({
            owner: el,
            property: ref.ns.localName,
            attr,
            textEl: null,
            // IDREFS split on whitespace; a single reference is the whole value (ids may hold spaces).
            tokens:
              ref.isMany === true
                ? attr.value.trim().split(/\s+/).filter(Boolean)
                : [attr.value.trim()],
          });
        }
        if (attr.name === 'calledElement' && resolver.isA(type, 'bpmn:CallActivity')) {
          calledElements.push({ el, attr });
        }
      }
    }
    for (const child of el.children) {
      const resolved = resolver.child(type, child);
      if (resolved.kind === 'reference') {
        types.set(child, null);
        references.push({
          owner: el,
          property: resolved.property,
          attr: null,
          textEl: child,
          // One reference per element (`<incoming>`, `<flowNodeRef>`, …).
          tokens: [ownText(child).trim()],
        });
      } else {
        visit(child, resolved.type);
      }
    }
  };
  visit(root, resolver.root(root));
  return { occurrences, order, missing, references, calledElements, types };
}

/** The original id of the nearest element above `el` that has one, `''` if none. */
function nearestId(el: XmlElement): string {
  for (let p = el.parent; p !== null; p = p.parent) {
    const id = attribute(p, 'id');
    if (id !== undefined && id !== '') return id;
  }
  return '';
}

/**
 * New ids: occurrence → id (unchanged ids included), and the ids of elements
 * without one. An added id depends only on the element's place in the
 * source (the nearest id above it, its type, name and position among such
 * elements), so a re-export of the unchanged model gets the same ids.
 */
function planIds(analysis: Analysis): {
  ids: Map<Occurrence, string>;
  added: Map<MissingId, string>;
  rewrites: IdRewrite[];
} {
  const taken = new Set(analysis.order);
  const ids = new Map<Occurrence, string>();
  const added = new Map<MissingId, string>();
  const rewrites: IdRewrite[] = [];
  for (const id of analysis.order) {
    const list = analysis.occurrences.get(id) ?? [];
    list.forEach((occ, k) => {
      if (k === 0 && isSafeId(id)) {
        ids.set(occ, id);
        return;
      }
      const base = isSafeId(id) ? id : sanitizeId(id, localType(occ.type));
      const next = uniqueId(base, (candidate) => taken.has(candidate));
      taken.add(next);
      ids.set(occ, next);
      rewrites.push({
        from: id,
        to: next,
        reason: isSafeId(id) ? 'duplicate' : 'unsafe',
        type: occ.type,
      });
    });
  }
  const seen = new Map<string, number>();
  for (const m of analysis.missing) {
    const place = JSON.stringify([nearestId(m.el), m.type, attribute(m.el, 'name') ?? '']);
    const k = seen.get(place) ?? 0;
    seen.set(place, k + 1);
    const id = uniqueId(`${localType(m.type)}_${shortHash(`${place}#${k}`)}`, (c) => taken.has(c));
    taken.add(id);
    added.set(m, id);
    rewrites.push({ from: '', to: id, reason: 'missing', type: m.type });
  }
  return { ids, added, rewrites };
}

/** `bpmn:Task` → `Task`. */
const localType = (type: string): string => type.slice(type.indexOf(':') + 1);

/** Where a flow ends or starts, as written (for telling duplicated flows apart). */
const FLOW_END: Readonly<Record<string, string>> = {
  incoming: 'targetRef',
  outgoing: 'sourceRef',
  default: 'sourceRef',
};

/**
 * Maps every reference token to the new id it points at. For a duplicated id:
 * - the DI's `bpmnElement` goes by order (the k-th shape of the id to its
 *   k-th element);
 * - a flow's `sourceRef`/`targetRef` to the occurrence that lists the flow as
 *   `outgoing`/`incoming`;
 * - a node's `incoming`/`outgoing` and a gateway's `default` to the flows of
 *   that id that end or start at the node, by order when several do;
 * - a repeated reference text in one element (`<flowNodeRef>`) by order;
 * - everything else to the first occurrence.
 * A choice that is still a guess is listed as ambiguous.
 */
function mapReferences(
  analysis: Analysis,
  ids: Map<Occurrence, string>,
): { mapped: Map<ReferenceSite, string[]>; ambiguous: AmbiguousReference[] } {
  const byElement = new Map<XmlElement, Occurrence>();
  for (const list of analysis.occurrences.values()) {
    for (const occ of list) byElement.set(occ.el, occ);
  }
  const newId = (occ: Occurrence | undefined, token: string): string =>
    occ ? (ids.get(occ) ?? token) : token;
  const ownerId = (el: XmlElement): string => {
    const occ = byElement.get(el);
    return occ ? newId(occ, occ.id) : (attribute(el, 'id') ?? '');
  };

  // The k-th reference of a property to a token within one element (DI: within the document).
  const ordinal = new Map<string, number>();
  const totals = new Map<string, number>();
  const ownerIndex = new Map<XmlElement, number>();
  const slot = (site: ReferenceSite, token: string): string => {
    if (site.property === 'bpmnElement') return `di|${token}`;
    let index = ownerIndex.get(site.owner);
    if (index === undefined) {
      index = ownerIndex.size;
      ownerIndex.set(site.owner, index);
    }
    return `${index}|${site.property}|${token}`;
  };
  for (const site of analysis.references) {
    for (const token of site.tokens) {
      const key = slot(site, token);
      totals.set(key, (totals.get(key) ?? 0) + 1);
    }
  }

  const mapped = new Map<ReferenceSite, string[]>();
  const ambiguous: AmbiguousReference[] = [];
  for (const site of analysis.references) {
    mapped.set(
      site,
      site.tokens.map((token) => {
        const list = analysis.occurrences.get(token);
        const first = list?.[0];
        const key = slot(site, token);
        const k = ordinal.get(key) ?? 0;
        ordinal.set(key, k + 1);
        if (list === undefined || first === undefined) return token;
        if (list.length === 1) return newId(first, token);

        let chosen: Occurrence = first;
        let guess = true;
        const end = FLOW_END[site.property];
        const ownId = attribute(site.owner, 'id');
        if (site.property === 'bpmnElement') {
          chosen = list[k] ?? first;
          guess = k >= list.length;
        } else if (
          (site.property === 'sourceRef' || site.property === 'targetRef') &&
          site.attr !== null
        ) {
          const listing = site.property === 'sourceRef' ? 'outgoing' : 'incoming';
          const holders = list.filter((occ) =>
            analysis.references.some(
              (r) =>
                r.owner === occ.el &&
                r.property === listing &&
                ownId !== undefined &&
                r.tokens.includes(ownId),
            ),
          );
          if (holders.length === 1 && holders[0] !== undefined) {
            chosen = holders[0];
            guess = false;
          }
        } else if (end !== undefined) {
          const ending = list.filter(
            (occ) => ownId !== undefined && attribute(occ.el, end) === ownId,
          );
          const candidates = ending.length > 0 ? ending : list;
          chosen = candidates[k] ?? candidates[0] ?? first;
          guess =
            ending.length === 0 ||
            k >= candidates.length ||
            (candidates.length > 1 &&
              (site.property === 'default' || (totals.get(key) ?? 0) !== candidates.length));
        } else if (site.attr === null && (totals.get(key) ?? 0) > 1) {
          chosen = list[k] ?? first;
          guess = k >= list.length || (totals.get(key) ?? 0) !== list.length;
        }
        const to = newId(chosen, token);
        if (guess) {
          ambiguous.push({
            element: ownerId(site.owner),
            property: site.property,
            reference: token,
            to,
          });
        }
        return to;
      }),
    );
  }
  return { mapped, ambiguous };
}

/** The text edits that apply the new ids, references and calls. */
function edits(
  analysis: Analysis,
  ids: Map<Occurrence, string>,
  added: Map<MissingId, string>,
): {
  edits: TextEdit[];
  calledElementRewrites: NormalizeResult['calledElementRewrites'];
  ambiguous: AmbiguousReference[];
} {
  const out: TextEdit[] = [];
  for (const [occ, id] of ids) {
    if (id !== occ.id) out.push({ start: occ.attr.valueStart, end: occ.attr.valueEnd, text: id });
  }
  for (const [m, id] of added) {
    if (m.attr !== null) {
      out.push({ start: m.attr.valueStart, end: m.attr.valueEnd, text: id });
    } else {
      // Right after the element name of the start tag.
      const at = m.el.start + 1 + m.el.name.length;
      out.push({ start: at, end: at, text: ` id="${id}"` });
    }
  }
  const { mapped: references, ambiguous } = mapReferences(analysis, ids);
  for (const site of analysis.references) {
    const mapped = references.get(site) ?? site.tokens;
    if (mapped.every((t, i) => t === site.tokens[i])) continue;
    if (site.attr !== null) {
      out.push({
        start: site.attr.valueStart,
        end: site.attr.valueEnd,
        text: escapeAttribute(mapped.join(' ')),
      });
    } else if (site.textEl !== null) {
      const [first, ...rest] = site.textEl.texts;
      if (first === undefined) continue;
      out.push({
        start: first.start,
        end: first.end,
        text: first.cdata ? mapped.join(' ') : escapeText(mapped.join(' ')),
      });
      for (const t of rest) out.push({ start: t.start, end: t.end, text: '' });
    }
  }
  const calledElementRewrites: NormalizeResult['calledElementRewrites'] = [];
  for (const { attr } of analysis.calledElements) {
    const value = attr.value.trim();
    if (value === '' || isExpression(value) || isSafeId(value)) continue;
    const local = analysis.occurrences.get(value)?.find((occ) => occ.type === 'bpmn:Process');
    const to = local
      ? (ids.get(local) ?? sanitizeId(value, 'Process'))
      : sanitizeId(value, 'Process');
    calledElementRewrites.push({ from: value, to });
    out.push({ start: attr.valueStart, end: attr.valueEnd, text: escapeAttribute(to) });
  }
  return { edits: out, calledElementRewrites, ambiguous };
}

/** Elements bpmn-js draws that have no DI shape or edge, in document order. */
function withoutLayout(analysis: Analysis, resolver: TypeResolver): string[] {
  const withDi = new Set(
    analysis.references.filter((r) => r.property === 'bpmnElement').flatMap((r) => r.tokens),
  );
  const missing: string[] = [];
  for (const id of analysis.order) {
    for (const occ of analysis.occurrences.get(id) ?? []) {
      const type = analysis.types.get(occ.el) ?? null;
      if (DRAWN_TYPES.some((t) => resolver.isA(type, t)) && !withDi.has(occ.id)) {
        missing.push(occ.id);
      }
    }
  }
  return missing;
}

function readDocument(text: string): XmlElement {
  if (DOCTYPE.test(text)) {
    throw new NormalizeError('doctype-forbidden', 'the file has a DOCTYPE, which analyzr refuses');
  }
  if (ENTITY.test(text)) {
    throw new NormalizeError(
      'doctype-forbidden',
      'the file declares an ENTITY, which analyzr refuses',
    );
  }
  let doc;
  try {
    doc = parseXml(text, { maxElements: MAX_ELEMENTS, keepUnknownEntities: true });
  } catch (err) {
    if (err instanceof XmlSyntaxError && err.message.startsWith('more than')) {
      throw new NormalizeError('too-many-elements', `more than ${MAX_ELEMENTS} elements`);
    }
    throw new NormalizeError(
      'not-xml',
      `not well-formed XML: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!isBpmnRoot(doc.root)) {
    throw new NormalizeError(
      'not-bpmn',
      `root element <${doc.root.name}> is not a BPMN 2.0 <definitions>`,
    );
  }
  return doc.root;
}

async function moddleWarnings(text: string, extension: ModdleExtension): Promise<string[]> {
  const { warnings } = await parseBpmn(text, extension);
  return warnings.map((w) => oneLine(w.message));
}

function tooLarge(bytes: number, what: string): NormalizeError {
  return new NormalizeError(
    'too-large',
    `${bytes} bytes${what}; analyzr takes at most ${MAX_BYTES} bytes per file`,
  );
}

/**
 * Normalizes one BPMN file.
 *
 * @throws {NormalizeError} for a file analyzr cannot take even after normalizing
 */
export async function normalizeBpmn(input: Uint8Array): Promise<NormalizeResult> {
  if (input.byteLength > MAX_INPUT_BYTES) throw tooLarge(input.byteLength, '');
  const detected = detectEncoding(input);
  let text: string;
  try {
    text = decodeText(input, detected);
  } catch (err) {
    throw new NormalizeError(
      'unsupported-encoding',
      err instanceof EncodingError ? err.message : String(err),
    );
  }
  const root = readDocument(text);
  const extension = extensionOf(root);
  const resolver = new TypeResolver(moddleFor(extension));
  const analysis = analyze(root, resolver);
  const { ids, added, rewrites } = planIds(analysis);
  const { edits: textEdits, calledElementRewrites, ambiguous } = edits(analysis, ids, added);

  // UTF-8 as analyzr reads it: with or without BOM; another declared encoding is fine for ASCII bytes.
  const readsAsUtf8 =
    detected.encoding === 'utf-8' || (!detected.encoding.startsWith('utf-16') && isAscii(input));
  if (readsAsUtf8 && textEdits.length === 0 && input.byteLength <= MAX_BYTES) {
    const missing = withoutLayout(analysis, resolver);
    return {
      kind: 'export',
      bytes: input,
      sha256: sha256(input),
      encoding: detected.encoding,
      idRewrites: [],
      calledElementRewrites: [],
      ambiguousReferences: [],
      compact: false,
      losses: losses([], missing.length, 0),
      parseWarnings: (await moddleWarnings(text, extension)).slice(0, MAX_LISTED),
      layoutMissing: missing.slice(0, MAX_LISTED),
      summary: summarizeBpmn(root),
    };
  }

  const edited = applyEdits(text, textEdits);
  const parsed = await parseBpmn(edited, extension);
  const conversionWarnings = parsed.warnings.map((w) => oneLine(w.message));
  // Indented like a modeler writes it, unless that exceeds analyzr's limit.
  let compact = false;
  let written = await writeBpmn(parsed, extension, { format: true });
  let bytes = new TextEncoder().encode(written);
  if (bytes.byteLength > MAX_BYTES) {
    compact = true;
    written = await writeBpmn(parsed, extension, { format: false });
    bytes = new TextEncoder().encode(written);
  }
  if (bytes.byteLength > MAX_BYTES) throw tooLarge(bytes.byteLength, ' after normalizing');

  // What analyzr will read: the written document.
  const outRoot = readDocument(written);
  const outAnalysis = analyze(outRoot, resolver);
  for (const [id, list] of outAnalysis.occurrences) {
    if (!isSafeId(id) || list.length > 1) {
      throw new Error(`normalize-bpmn wrote an unsafe or duplicate id ${JSON.stringify(id)}`);
    }
  }
  if (outAnalysis.missing.length > 0) {
    throw new Error(
      `normalize-bpmn wrote <${outAnalysis.missing[0]?.el.name ?? ''}> without an id`,
    );
  }
  const missing = withoutLayout(outAnalysis, resolver);
  return {
    kind: 'converted',
    bytes,
    sha256: sha256(bytes),
    encoding: detected.encoding,
    idRewrites: rewrites,
    calledElementRewrites,
    ambiguousReferences: ambiguous.slice(0, MAX_LISTED),
    compact,
    losses: losses(conversionWarnings, missing.length, rewrites.length),
    parseWarnings: (await moddleWarnings(written, extension)).slice(0, MAX_LISTED),
    layoutMissing: missing.slice(0, MAX_LISTED),
    summary: summarizeBpmn(outRoot),
  };
}

/** Losses from bpmn-moddle's warnings while converting, the elements without layout and the rewritten ids. */
function losses(
  conversionWarnings: readonly string[],
  layoutMissing: number,
  idRewrites: number,
): Loss[] {
  const counts: Record<LossCode, number> = {
    'element-dropped': conversionWarnings.filter((w) => w.startsWith('unparsable content')).length,
    'attribute-dropped': conversionWarnings.filter((w) => w.startsWith('unresolved reference'))
      .length,
    'id-rewritten': idRewrites,
    'layout-missing': layoutMissing,
  };
  return LOSS_ORDER.filter((code) => counts[code] > 0).map((code) => ({
    code,
    count: counts[code],
  }));
}

/**
 * `inspect`: a deterministic inventory of an export (M6 §3.7 step 1): per
 * file its size, sha256, kind (BPMN, other XML, zip, PDF, image, text,
 * binary), encoding, XML root and namespaces, a BPMN summary, a zip listing
 * and tool markers; totals and the tools the markers point at. It reads and
 * never writes; the same export gives the same JSON on every machine (no
 * absolute paths, no timestamps).
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { isBpmnRoot, summarizeBpmn, type BpmnSummary, ID_NAMESPACES } from './bpmn-scan.ts';
import { decodeText, detectEncoding, looksBinary } from './encoding.ts';
import { listExport } from './files.ts';
import { markersOf, TOOLS, type Marker, type Tool } from './markers.ts';
import { INSPECT_VERSION } from './version.ts';
import { attribute, descendants, parseXml, rootNamespaces, XmlSyntaxError } from './xml.ts';
import { isZip, listZip, type ZipListing } from './zip.ts';

/** analyzr's per-file limit (`DEFAULT_PARSE_LIMITS.maxBytes` of `@analyzr/bpmn-facts`). */
export const ANALYZR_MAX_BYTES = 5 * 1024 * 1024;

/** Files above this size are listed with size and kind only. */
export const MAX_INSPECT_BYTES = 64 * 1024 * 1024;

export const FILE_KINDS = [
  'bpmn',
  'xml',
  'zip',
  'ole2',
  'pdf',
  'image',
  'text',
  'binary',
  'empty',
] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export interface InspectedEncoding {
  encoding: string;
  bom: boolean;
  declared: string | null;
  /** The bytes decode without error in `encoding`. */
  valid: boolean;
}

export interface InspectedXml {
  /** Root element as written. */
  root: string;
  namespace: string | null;
  /** Namespace declarations of the root element (prefix `""` is the default namespace). */
  namespaces: Record<string, string>;
  doctype: boolean;
  /** Why the XML could not be read completely. */
  error?: string;
}

export interface InspectedFile {
  path: string;
  size: number;
  sha256: string;
  kind: FileKind;
  encoding?: InspectedEncoding;
  xml?: InspectedXml;
  bpmn?: BpmnSummary;
  zip?: ZipListing;
  markers: Marker[];
  /** Hints for the consultant, e.g. `DOCTYPE: analyzr refuses it`. */
  notes: string[];
}

export interface InspectReport {
  format: 'analyzr-inspect/1';
  inspector: { name: 'analyzr-integrate/inspect'; version: string };
  totals: {
    files: number;
    bytes: number;
    byKind: Partial<Record<FileKind, number>>;
    /** Hidden files and folders left out (`.DS_Store`, `__MACOSX`, …). */
    hidden: number;
    symlinks: number;
  };
  /** Tools the markers point at, most files first. */
  tools: { tool: Tool; files: number; markers: Record<string, number> }[];
  files: InspectedFile[];
}

const startsWith = (bytes: Uint8Array, prefix: readonly number[]): boolean =>
  bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);

function magicKind(bytes: Uint8Array): FileKind | null {
  if (bytes.length === 0) return 'empty';
  if (isZip(bytes)) return 'zip';
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole2';
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf';
  if (
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) ||
    startsWith(bytes, [0xff, 0xd8, 0xff]) ||
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38])
  ) {
    return 'image';
  }
  return null;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** A file above {@link MAX_INSPECT_BYTES}: size, hash and the kind its first bytes show. */
export function inspectLargeFile(
  path: string,
  size: number,
  head: Uint8Array,
  sha256: string,
): InspectedFile {
  return {
    path,
    size,
    sha256,
    kind: magicKind(head) ?? 'binary',
    markers: markersOf({ path }),
    notes: [`larger than ${MAX_INSPECT_BYTES / 1024 / 1024} MB: not read`],
  };
}

/** Inspects one file's bytes (pure; `path` is only reported and used for markers). */
export function inspectFile(path: string, bytes: Uint8Array): InspectedFile {
  const file: InspectedFile = {
    path,
    size: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    kind: 'binary',
    markers: [],
    notes: [],
  };
  const magic = magicKind(bytes);
  if (magic !== null) {
    file.kind = magic;
    if (magic === 'zip') {
      file.zip = listZip(bytes);
      const bpmnEntries = file.zip.entries.filter((e) => /\.(bpmn2?|bpmn20\.xml)$/i.test(e.name));
      if (bpmnEntries.length > 0) {
        file.notes.push(`zip with ${bpmnEntries.length} BPMN files: unpack it, then inspect again`);
      }
    }
    file.markers = markersOf({ path, zipEntries: file.zip?.entries.map((e) => e.name) });
    return file;
  }

  const detected = detectEncoding(bytes);
  if (looksBinary(bytes, detected)) {
    file.markers = markersOf({ path });
    return file;
  }
  let text: string | null = null;
  let valid = true;
  try {
    text = decodeText(bytes, detected);
  } catch {
    valid = false;
  }
  file.encoding = {
    encoding: detected.encoding,
    bom: detected.bom,
    declared: detected.declared,
    valid,
  };
  file.kind = 'text';
  if (text === null) {
    file.notes.push(`not valid ${detected.encoding.toUpperCase()}`);
  } else if (/^\s*</.test(text)) {
    file.kind = inspectXml(file, text);
  }
  if (file.kind === 'bpmn' && file.size > ANALYZR_MAX_BYTES) {
    file.notes.push(
      file.encoding?.encoding.startsWith('utf-16') === true
        ? 'larger than 5 MB as UTF-16: normalize-bpmn takes it if its UTF-8 fits into 5 MB'
        : 'larger than 5 MB: analyzr refuses it as is; normalize-bpmn takes it if it fits into 5 MB without indentation',
    );
  }
  if (
    file.kind === 'bpmn' &&
    file.encoding !== undefined &&
    !file.encoding.encoding.startsWith('utf-8')
  ) {
    file.notes.push(
      `${file.encoding.encoding.toUpperCase()}: normalize-bpmn transcodes it to UTF-8`,
    );
  }
  return file;
}

/** Adds the XML details to `file`; returns its kind, `bpmn` or `xml`. */
function inspectXml(file: InspectedFile, text: string): FileKind {
  let kind: FileKind = 'xml';
  let ids: string[] = [];
  try {
    const head = parseXml(text, { rootOnly: true, lenient: true });
    file.xml = {
      root: head.root.name,
      namespace: head.root.ns,
      namespaces: rootNamespaces(head.root),
      doctype: head.doctype,
    };
    if (isBpmnRoot(head.root)) {
      kind = 'bpmn';
      const doc = parseXml(text, { lenient: true });
      file.bpmn = summarizeBpmn(doc.root);
      ids = [doc.root, ...descendants(doc.root)]
        .filter((el) => el.ns !== null && ID_NAMESPACES.has(el.ns))
        .map((el) => attribute(el, 'id'))
        .filter((id): id is string => id !== undefined);
      if (file.bpmn.ids.unsafe + file.bpmn.ids.duplicate > 0) {
        file.notes.push(
          `${file.bpmn.ids.unsafe} unsafe and ${file.bpmn.ids.duplicate} duplicate ids: normalize-bpmn rewrites them`,
        );
      }
      if (doc.doctype) file.notes.push('DOCTYPE: analyzr refuses it');
    }
  } catch (err) {
    const where = err instanceof XmlSyntaxError ? ` (offset ${err.offset})` : '';
    file.xml = {
      ...(file.xml ?? { root: '', namespace: null, namespaces: {}, doctype: false }),
      error: `${message(err)}${where}`,
    };
  }
  file.markers = markersOf({
    path: file.path,
    xmlRoot: file.xml?.root,
    namespaces: file.xml?.namespaces,
    doctype: file.xml?.doctype,
    bpmn: file.bpmn,
    ids,
  });
  return kind;
}

/** Totals and tools of inspected files. */
export function summarize(
  files: readonly InspectedFile[],
  hidden: number,
  symlinks: number,
): Pick<InspectReport, 'totals' | 'tools'> {
  const byKind: Partial<Record<FileKind, number>> = {};
  for (const kind of FILE_KINDS) {
    const n = files.filter((f) => f.kind === kind).length;
    if (n > 0) byKind[kind] = n;
  }
  const tools: InspectReport['tools'] = [];
  for (const tool of TOOLS) {
    const withTool = files.filter((f) => f.markers.some((m) => m.tool === tool));
    if (withTool.length === 0) continue;
    const markers: Record<string, number> = {};
    for (const f of withTool) {
      for (const m of f.markers.filter((x) => x.tool === tool)) {
        markers[m.marker] = (markers[m.marker] ?? 0) + 1;
      }
    }
    tools.push({
      tool,
      files: withTool.length,
      markers: Object.fromEntries(Object.entries(markers).sort(([a], [b]) => (a < b ? -1 : 1))),
    });
  }
  tools.sort((a, b) => b.files - a.files || TOOLS.indexOf(a.tool) - TOOLS.indexOf(b.tool));
  return {
    totals: {
      files: files.length,
      bytes: files.reduce((sum, f) => sum + f.size, 0),
      byKind,
      hidden,
      symlinks,
    },
    tools,
  };
}

/** Inspects the export at `target` (a folder or one file). */
export async function inspectExport(target: string): Promise<InspectReport> {
  const listing = await listExport(target);
  const files: InspectedFile[] = [];
  for (const f of listing.files) {
    if (f.size > MAX_INSPECT_BYTES) {
      const hash = createHash('sha256');
      let head = new Uint8Array(0);
      for await (const chunk of createReadStream(f.absolute)) {
        const bytes = chunk as Buffer;
        if (head.length === 0) head = new Uint8Array(bytes.subarray(0, 16));
        hash.update(bytes);
      }
      files.push(inspectLargeFile(f.path, f.size, head, hash.digest('hex')));
    } else {
      files.push(inspectFile(f.path, new Uint8Array(await readFile(f.absolute))));
    }
  }
  return {
    format: 'analyzr-inspect/1',
    inspector: { name: 'analyzr-integrate/inspect', version: INSPECT_VERSION },
    ...summarize(files, listing.hidden, listing.symlinks),
    files,
  };
}

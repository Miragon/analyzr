/**
 * Reading and writing spec files (M6 S3c §3.1): YAML 1.2 with the core
 * schema, of which JSON is a subset. Read strictly, so a spec means exactly
 * what it shows: at most 2 MB of UTF-8; one document; every error and every
 * warning of the parser is fatal (an unknown tag is only a warning there);
 * no tags at all (`!!binary` would resolve to bytes under the core schema),
 * no anchors, aliases or merge keys, and only plain names as keys (a
 * collection as key would be stringified). Only then is the document turned
 * into plain values, with alias resolution off.
 */
import { isAlias, isScalar, LineCounter, parseDocument, stringify, visit, type Node } from 'yaml';

/** Largest spec file read (bytes). */
export const MAX_SPEC_BYTES = 2 * 1024 * 1024;

/** Most problems reported per file; one more line says how many were left out. */
export const MAX_PROBLEMS = 100;

/** A problem of a spec file: where (a field path or a line and column) and what. */
export interface SpecProblem {
  /** `processes[0].nodes[3].type`, `line 4, column 7`, or `''` for the whole file. */
  path: string;
  code: string;
  message: string;
}

export interface ParsedSpecText {
  /** The document's value, `undefined` when it could not be read. */
  value: unknown;
  errors: SpecProblem[];
}

const YAML_MESSAGES: Readonly<Record<string, string>> = {
  DUPLICATE_KEY: 'a key appears twice in one mapping',
  MULTIPLE_DOCS: 'more than one YAML document: write one spec per file',
  TAG_RESOLVE_FAILED: 'tags are not allowed; quote the value instead',
};

/** The problem of a spec over {@link MAX_SPEC_BYTES}. */
export function tooLargeProblem(bytes: number): SpecProblem {
  return {
    path: '',
    code: 'too-large',
    message: `${bytes} bytes; a spec holds one model in at most ${MAX_SPEC_BYTES} bytes`,
  };
}

function tooLarge(bytes: number): ParsedSpecText {
  return { value: undefined, errors: [tooLargeProblem(bytes)] };
}

/** Reads a spec file's bytes: UTF-8 (a byte order mark is dropped), at most {@link MAX_SPEC_BYTES}. */
export function parseSpecBytes(bytes: Uint8Array): ParsedSpecText {
  if (bytes.length > MAX_SPEC_BYTES) return tooLarge(bytes.length);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return {
      value: undefined,
      errors: [{ path: '', code: 'encoding', message: 'not UTF-8: save the spec as UTF-8' }],
    };
  }
  return parseSpecText(text);
}

/**
 * Reads a spec's text, at most {@link MAX_SPEC_BYTES} as UTF-8 (see the
 * module comment for what it refuses).
 */
export function parseSpecText(text: string): ParsedSpecText {
  const size = Buffer.byteLength(text, 'utf8');
  if (size > MAX_SPEC_BYTES) return tooLarge(size);
  const lines = new LineCounter();
  const doc = parseDocument(text, {
    version: '1.2',
    schema: 'core',
    uniqueKeys: true,
    merge: false,
    strict: true,
    prettyErrors: false,
    lineCounter: lines,
  });
  const errors: SpecProblem[] = [];
  let omitted = 0;
  const at = (offset: number | undefined): string => {
    if (offset === undefined) return '';
    const { line, col } = lines.linePos(offset);
    return `line ${line}, column ${col}`;
  };
  const add = (offset: number | undefined, code: string, message: string): void => {
    if (errors.length >= MAX_PROBLEMS) omitted++;
    else errors.push({ path: at(offset), code, message });
  };
  for (const e of [...doc.errors, ...doc.warnings]) {
    add(e.pos[0], 'yaml', YAML_MESSAGES[e.code] ?? `${e.message} (${e.code})`);
  }
  const refuseNode = (node: Node): void => {
    const offset = node.range?.[0];
    if (node.tag !== undefined) {
      add(offset, 'yaml-tag', `tags (${node.tag}) are not allowed; quote the value instead`);
    }
    if (node.anchor !== undefined) {
      add(offset, 'yaml-anchor', 'anchors (&name) are not allowed: write every value out');
    }
  };
  visit(doc, {
    Alias(_, node) {
      add(node.range?.[0], 'yaml-alias', 'aliases (*name) are not allowed: write every value out');
    },
    Scalar(_, node) {
      refuseNode(node);
    },
    Map(_, node) {
      refuseNode(node);
    },
    Seq(_, node) {
      refuseNode(node);
    },
    Pair(_, pair) {
      const key = pair.key;
      if (isAlias(key)) return;
      if (!isScalar(key) || typeof key.value !== 'string') {
        const offset = (key as Node | null)?.range?.[0];
        add(offset, 'yaml-key', 'keys are field names: write them as plain text');
      } else if (key.value === '<<') {
        add(key.range?.[0], 'yaml-merge', 'merge keys (<<) are not allowed: write every value out');
      }
    },
  });
  if (omitted > 0) {
    errors.push({ path: '', code: 'too-many-problems', message: `${omitted} more errors` });
  }
  if (errors.length > 0) return { value: undefined, errors };
  try {
    return { value: doc.toJS({ maxAliasCount: 0 }) as unknown, errors };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { value: undefined, errors: [{ path: '', code: 'yaml', message }] };
  }
}

/**
 * A spec as YAML (what a converter run writes): YAML 1.2, no folded lines,
 * never an anchor or alias (a value used twice is written twice), so
 * {@link parseSpecText} reads it back unchanged.
 */
export function formatSpec(value: unknown): string {
  return stringify(value, { version: '1.2', lineWidth: 0, aliasDuplicateObjects: false });
}

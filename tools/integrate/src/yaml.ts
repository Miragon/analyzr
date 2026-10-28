/**
 * The strict YAML reader the plugin's file formats share (M6 S3c §3.1, generalised in M6 S6 §3.9):
 * the specs (`spec/yaml.ts`), the interview guide's notes file (`interview/notes.ts`) and, from
 * M6 S6 step 3, the transcripts' role file. YAML 1.2 with the core schema, of which JSON is a
 * subset, read so a file means exactly what it shows: a size per caller; one document; every
 * error and every warning of the parser is fatal (an unknown tag is only a warning there); no
 * tags at all (`!!binary` would resolve to bytes under the core schema), no anchors, aliases or
 * merge keys, and only plain names as keys (a collection as key would be stringified). Only then
 * is the document turned into plain values, with alias resolution off.
 *
 * A caller whose file can hold personal data passes `parserMessages: false`: then a problem names
 * only its code, line and column, never a parser message, which may quote the file's text.
 */
import { isAlias, isScalar, LineCounter, parseDocument, visit, type Node } from 'yaml';

/** A problem of a YAML file: where (a field path or a line and column) and what. */
export interface YamlProblem {
  /** `processes[0].nodes[3].type`, `line 4, column 7`, or `''` for the whole file. */
  path: string;
  code: string;
  message: string;
}

export interface ParsedYaml {
  /** The document's value, `undefined` when it could not be read. */
  value: unknown;
  errors: YamlProblem[];
}

export interface StrictYamlOptions {
  /** Largest file read, as UTF-8 bytes. */
  maxBytes: number;
  /** The problem of a file over {@link maxBytes}. */
  tooLarge: (bytes: number) => YamlProblem;
  /** What one document more says (the caller's file kind: "write one spec per file"). */
  multipleDocs: string;
  /**
   * Whether a parser message without a text of this module may be shown (it may quote the
   * file); without, the problem says only its code and position.
   */
  parserMessages: boolean;
  /** Most problems reported; one more line says how many were left out (default 100). */
  maxProblems?: number;
}

/** Default of {@link StrictYamlOptions.maxProblems}. */
export const MAX_YAML_PROBLEMS = 100;

/** This module's texts for the parser's codes (they quote nothing of the file). */
const YAML_MESSAGES: Readonly<Record<string, string>> = {
  DUPLICATE_KEY: 'a key appears twice in one mapping',
  TAG_RESOLVE_FAILED: 'tags are not allowed; quote the value instead',
};

/**
 * Reads a YAML file's text strictly (see the module comment).
 */
export function parseStrictYaml(text: string, options: StrictYamlOptions): ParsedYaml {
  const size = Buffer.byteLength(text, 'utf8');
  if (size > options.maxBytes) return { value: undefined, errors: [options.tooLarge(size)] };
  const maxProblems = options.maxProblems ?? MAX_YAML_PROBLEMS;
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
  const errors: YamlProblem[] = [];
  let omitted = 0;
  const at = (offset: number | undefined): string => {
    if (offset === undefined) return '';
    const { line, col } = lines.linePos(offset);
    return `line ${line}, column ${col}`;
  };
  const add = (offset: number | undefined, code: string, message: string): void => {
    if (errors.length >= maxProblems) omitted++;
    else errors.push({ path: at(offset), code, message });
  };
  for (const e of [...doc.errors, ...doc.warnings]) {
    const own = e.code === 'MULTIPLE_DOCS' ? options.multipleDocs : YAML_MESSAGES[e.code];
    const message =
      own ?? (options.parserMessages ? `${e.message} (${e.code})` : `not valid YAML (${e.code})`);
    add(e.pos[0], 'yaml', message);
  }
  const refuseNode = (node: Node): void => {
    const offset = node.range?.[0];
    if (node.tag !== undefined) {
      const tag = options.parserMessages ? ` (${node.tag})` : '';
      add(offset, 'yaml-tag', `tags${tag} are not allowed; quote the value instead`);
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
    const message = options.parserMessages
      ? err instanceof Error
        ? err.message
        : String(err)
      : 'the document could not be read';
    return { value: undefined, errors: [{ path: '', code: 'yaml', message }] };
  }
}

/** Reads UTF-8 bytes (a byte order mark is dropped by the decoder), `null` if they are none. */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

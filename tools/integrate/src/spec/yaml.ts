/**
 * Reading and writing spec files (M6 S3c §3.1): YAML 1.2 with the core
 * schema, of which JSON is a subset, read strictly by the shared reader
 * (`../yaml.ts`, since M6 S6), so a spec means exactly what it shows: at most
 * 2 MB of UTF-8; one document; every error and every warning of the parser is
 * fatal; no tags, anchors, aliases or merge keys, and only plain names as
 * keys.
 */
import { stringify } from 'yaml';

import { decodeUtf8, MAX_YAML_PROBLEMS, parseStrictYaml, type YamlProblem } from '../yaml.ts';

/** Largest spec file read (bytes). */
export const MAX_SPEC_BYTES = 2 * 1024 * 1024;

/** Most problems reported per file; one more line says how many were left out. */
export const MAX_PROBLEMS = MAX_YAML_PROBLEMS;

/** A problem of a spec file: where (a field path or a line and column) and what. */
export type SpecProblem = YamlProblem;

export interface ParsedSpecText {
  /** The document's value, `undefined` when it could not be read. */
  value: unknown;
  errors: SpecProblem[];
}

/** The problem of a spec over {@link MAX_SPEC_BYTES}. */
export function tooLargeProblem(bytes: number): SpecProblem {
  return {
    path: '',
    code: 'too-large',
    message: `${bytes} bytes; a spec holds one model in at most ${MAX_SPEC_BYTES} bytes`,
  };
}

/** Reads a spec file's bytes: UTF-8 (a byte order mark is dropped), at most {@link MAX_SPEC_BYTES}. */
export function parseSpecBytes(bytes: Uint8Array): ParsedSpecText {
  if (bytes.length > MAX_SPEC_BYTES) {
    return { value: undefined, errors: [tooLargeProblem(bytes.length)] };
  }
  const text = decodeUtf8(bytes);
  if (text === null) {
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
  return parseStrictYaml(text, {
    maxBytes: MAX_SPEC_BYTES,
    tooLarge: tooLargeProblem,
    multipleDocs: 'more than one YAML document: write one spec per file',
    parserMessages: true,
  });
}

/**
 * A spec as YAML (what a converter run writes): YAML 1.2, no folded lines,
 * never an anchor or alias (a value used twice is written twice), so
 * {@link parseSpecText} reads it back unchanged.
 */
export function formatSpec(value: unknown): string {
  return stringify(value, { version: '1.2', lineWidth: 0, aliasDuplicateObjects: false });
}

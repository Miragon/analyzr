/**
 * Element ids (M6 §3.4 rule 2): ids come from the tool's ids and are never
 * regenerated. An id is kept when both readers accept it: analyzr wants an
 * XML NCName of at most 255 characters (`ELEMENT_ID_PATTERN` in
 * `packages/contracts/src/refs.ts`), and bpmn-moddle drops an element whose id
 * fails its ASCII check (`illegal ID <…>` in moddle-xml), so `Prüfen` (a valid
 * NCName) is dropped as well. Every other id becomes `<Type>_<safe source
 * id>`, with a deterministic suffix on collisions.
 */
import { createHash } from 'node:crypto';

/** An id analyzr and bpmn-moddle both accept (ASCII NCName). */
export const SAFE_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/** Longest element id analyzr accepts (`ELEMENT_ID_MAX_LENGTH`). */
export const MAX_ID_LENGTH = 255;

/** True if analyzr and bpmn-moddle both accept `id` unchanged. */
export function isSafeId(id: string): boolean {
  return id.length <= MAX_ID_LENGTH && SAFE_ID_PATTERN.test(id);
}

const TRANSLITERATION: Readonly<Record<string, string>> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  Ä: 'Ae',
  Ö: 'Oe',
  Ü: 'Ue',
  ß: 'ss',
};

/** The first 8 hex characters of the sha256 of `text`. */
export function shortHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 8);
}

/** `id` cut to {@link MAX_ID_LENGTH}, ending in a hash of `source` when cut. */
export function capped(id: string, source: string): string {
  return id.length <= MAX_ID_LENGTH ? id : `${id.slice(0, MAX_ID_LENGTH - 9)}_${shortHash(source)}`;
}

/**
 * The id that replaces an unsafe `sourceId` on an element of `type`:
 * `<Type>_<source id>` with umlauts transliterated, other marks dropped and
 * every other character outside `[A-Za-z0-9_.-]` replaced by `_` (the type
 * prefix also covers ids starting with a digit). Deterministic: the same
 * source id gives the same id in every file and on every run.
 */
export function sanitizeId(sourceId: string, type: string): string {
  const body = sourceId
    .replace(/[äöüÄÖÜß]/g, (c) => TRANSLITERATION[c] ?? c)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const prefix = type.replace(/[^A-Za-z0-9_]/g, '') || 'Element';
  return capped(body === '' ? `${prefix}_${shortHash(sourceId)}` : `${prefix}_${body}`, sourceId);
}

/**
 * `candidate` if `taken` says it is free, else the first free
 * `<candidate>_<n>` for n = `from`, `from` + 1, … (cut to fit 255 characters).
 */
export function uniqueId(candidate: string, taken: (id: string) => boolean, from = 2): string {
  if (!taken(candidate)) return candidate;
  for (let n = from; ; n++) {
    const suffix = `_${n}`;
    const id = `${candidate.slice(0, MAX_ID_LENGTH - suffix.length)}${suffix}`;
    if (!taken(id)) return id;
  }
}

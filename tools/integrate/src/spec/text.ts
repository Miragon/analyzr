/**
 * Every text the renderer emits, as analyzr's extractor will read it (M6 S3c
 * §2.6): copies of `sanitizeLine` and `sanitizeBlock` of
 * `packages/bpmn-facts/src/sanitize.ts` (the plugin's scripts bundle no
 * `@analyzr/bpmn-facts`, which would pull in the contracts with zod; a test
 * pins the copies to the originals), run after removing the noncharacters
 * U+FFFE and U+FFFF and lone surrogates, which `\p{Cc}` misses and XML 1.0
 * forbids. Labels and keys are cut at 200 and documentation at 2000 UTF-16
 * code units, so the extractor never has to cut (and never warns).
 */

/** Maximum label and key length in UTF-16 code units (CONCEPT §6). */
export const MAX_LABEL_LENGTH = 200;
/** Maximum documentation length in UTF-16 code units (CONCEPT §6). */
export const MAX_DOCUMENTATION_LENGTH = 2000;

/** Bidirectional formatting characters: LRM, RLM, ALM, U+202A–U+202E, U+2066–U+2069. */
const BIDI = /[؜‎‏‪-‮⁦-⁩]/gu;
const CONTROL = /\p{Cc}/gu;
const CONTROL_EXCEPT_NEWLINE = /[^\P{Cc}\n]/gu;
/** Characters XML 1.0 cannot carry that the sanitizers keep. */
const UNWRITABLE = /[￾￿]|\p{Cs}/gu;

export interface Sanitized {
  text: string;
  /** The text was longer than the limit and was cut. */
  truncated: boolean;
}

function truncate(text: string, max: number): Sanitized {
  if (text.length <= max) return { text, truncated: false };
  let cut = max;
  const last = text.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut--; // do not split a surrogate pair
  return { text: text.slice(0, cut).trimEnd(), truncated: true };
}

/** A copy of bpmn-facts' `sanitizeLine`: one line, no control or bidi characters, cut to `max`. */
export function sanitizeLine(raw: string, max: number): Sanitized {
  const text = raw
    .replace(/\s+/gu, ' ')
    .replace(CONTROL, '')
    .replace(BIDI, '')
    .replace(/ {2,}/g, ' ')
    .trim();
  return truncate(text, max);
}

/** A copy of bpmn-facts' `sanitizeBlock`: like {@link sanitizeLine}, line breaks kept. */
export function sanitizeBlock(raw: string, max: number): Sanitized {
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/gu, ' ')
    .replace(CONTROL_EXCEPT_NEWLINE, '')
    .replace(BIDI, '')
    .replace(/ {2,}/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return truncate(text, max);
}

/** A label or key as the renderer writes it (names, message and signal names, call targets). */
export function cleanLine(raw: string, max = MAX_LABEL_LENGTH): Sanitized {
  return sanitizeLine(raw.replace(UNWRITABLE, ''), max);
}

/** Documentation as the renderer writes it. */
export function cleanBlock(raw: string, max = MAX_DOCUMENTATION_LENGTH): Sanitized {
  return sanitizeBlock(raw.replace(UNWRITABLE, ''), max);
}

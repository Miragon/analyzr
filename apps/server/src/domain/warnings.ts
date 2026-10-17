/**
 * The extractor's warnings as analyzr keeps and shows them (M6 S1, S2a):
 * each entry cut to the contract's limits (code 50, message 300 ending in
 * `…`, element id 255 characters). bpmn-moddle messages embed line, column
 * and nested errors and the extractor allows 1,000 characters, so the cut
 * keeps results and the stored column small; the beginning, which names the
 * element and the error, stays. Pure.
 */
import { MAX_RESULT_WARNING_CHARS, type ExtractWarning } from '@analyzr/contracts';

/** `text` cut to `max` UTF-16 code units, ending in `…`, without splitting a surrogate pair. */
export function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max - 1;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end--;
  return `${text.slice(0, end)}…`;
}

/** One warning cut to the contract's limits. */
export function cutWarning(w: ExtractWarning): ExtractWarning {
  return {
    code: w.code.slice(0, 50),
    message: cutText(w.message, MAX_RESULT_WARNING_CHARS),
    ...(w.elementId === undefined ? {} : { elementId: w.elementId.slice(0, 255) }),
  };
}

/**
 * The warnings a revision stores (`model_revision.extract_warnings`, M6
 * S2a): every entry the extractor returned (at most 100 and its own
 * `too-many-warnings` entry), each cut; `[]` for none.
 */
export function storedWarnings(warnings: readonly ExtractWarning[]): ExtractWarning[] {
  return warnings.map(cutWarning);
}

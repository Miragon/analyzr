/**
 * `@analyzr/bpmn-facts`: deterministic fact extraction from Camunda 7 and
 * Camunda 8 BPMN (CONCEPT §2) with bpmn-moddle and the camunda/zeebe moddle
 * extensions. No I/O, no database, no LLM.
 *
 * - {@link extractFacts}: one BPMN file → processes, facts, message flows, warnings
 * - {@link assertSafeXml}: DOCTYPE/ENTITY rejection, UTF-8, size limit (run by `extractFacts`)
 * - {@link factFingerprint}, {@link factsHash}, {@link normalizeKey}: the hashing and
 *   normalization rules behind `fingerprint`, `facts_hash` and `key_norm`
 * - {@link applyAmendments}, {@link readAmendable}: byte-preserving model amendments (M6 §4.8 c)
 */
export { FACTS_VERSION } from './version.ts';
export {
  AMENDMENT_OPS,
  AMENDMENT_VALUE_LIMITS,
  applyAmendments,
  escapeXmlValue,
  isAmendmentExpression,
  normalizeAmendmentValue,
  readAmendable,
} from './amend.ts';
export type {
  AmendResult,
  AmendableDocument,
  AmendableElementKind,
  AmendableEndpoint,
  AmendableField,
  Amendment,
  AmendmentOp,
  AmendmentOutcome,
  AmendmentRefusal,
  AmendmentRefusalReason,
  AmendmentValueProblem,
  NormalizedAmendmentValue,
} from './amend.ts';
export { BpmnInputError } from './errors.ts';
export type { BpmnInputEncoding, BpmnInputErrorCode } from './errors.ts';
export { DEFAULT_PARSE_LIMITS, assertSafeXml } from './input.ts';
export type { ParseLimits } from './input.ts';
export { BPMN_MODEL_NAMESPACE, MAX_WARNINGS, extractFacts } from './extract.ts';
export type { Engine, ExtractOptions, ExtractResult, ExtractWarning } from './extract.ts';
export { factFingerprint, factsHash } from './fingerprint.ts';
export type { FingerprintInput } from './fingerprint.ts';
export { normalizeKey } from './normalize.ts';
export { compareFacts } from './order.ts';
export {
  MAX_DOCUMENTATION_LENGTH,
  MAX_KEY_LENGTH,
  MAX_LABEL_LENGTH,
  sanitizeBlock,
  sanitizeLine,
} from './sanitize.ts';
export type { Sanitized } from './sanitize.ts';

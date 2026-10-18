/** Why an input was rejected; the server answers 422 `bpmn-invalid` (413 for `too-large`). */
export type BpmnInputErrorCode =
  /** The document contains a DOCTYPE declaration (XXE, entity expansion). */
  | 'doctype-forbidden'
  /** The document declares or references an external/internal ENTITY. */
  | 'entity-forbidden'
  | 'too-large'
  | 'too-many-elements'
  /** Not well-formed XML, or not UTF-8. */
  | 'not-xml'
  /** Well-formed XML but not a BPMN 2.0 `definitions` document. */
  | 'not-bpmn'
  | 'invalid-model-key';

/**
 * The cause of a `not-xml` rejection where it is the encoding: `utf-16` (a
 * UTF-16 byte order mark), `not-utf-8` (bytes that are not UTF-8, often
 * ISO-8859-1 or windows-1252). Callers can name the remedy (save as UTF-8,
 * or convert the export) instead of "not XML".
 */
export type BpmnInputEncoding = 'utf-16' | 'not-utf-8';

/** Rejection of hostile, oversized or malformed input. Nothing was extracted. */
export class BpmnInputError extends Error {
  override readonly name = 'BpmnInputError';
  readonly code: BpmnInputErrorCode;
  /** Set on a `not-xml` rejection whose cause is the encoding. */
  readonly encoding: BpmnInputEncoding | undefined;

  constructor(code: BpmnInputErrorCode, message: string, encoding?: BpmnInputEncoding) {
    super(message);
    this.code = code;
    this.encoding = encoding;
  }
}

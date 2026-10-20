/**
 * Informational values as analyzr stores them from a manifest (M6 S2a,
 * `tidyDeclared` of `@analyzr/contracts/import-manifest`, mirrored here: the
 * plugin's scripts bundle only the zod-free contract modules; a test pins the
 * two together). normalize-bpmn declares `exporterVersion` in this form (M6
 * S2b follow-up step 4), and a key map rebuilt from analyzr holds the tool
 * paths in it, which the plan matches.
 */

/**
 * An informational value as the manifest declares it and analyzr stores it:
 * lone surrogates become U+FFFD, control characters spaces, the ends
 * trimmed; `null` for nothing left, for `null`, and for more than `max`
 * characters, which the manifest could not declare.
 */
export function tidyDeclared(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const tidy = value
    .replace(/\p{Cs}/gu, '�')
    .replace(/\p{Cc}/gu, ' ')
    .trim();
  return tidy === '' || tidy.length > max ? null : tidy;
}

/** A tool path as analyzr stores it (`externalPath`, tidied; `''` for a blank one). */
export function storedPath(externalPath: string): string {
  return tidyDeclared(externalPath, Number.POSITIVE_INFINITY) ?? '';
}

/**
 * Declared values a spec passes into the manifest, where analyzr matches or
 * stores them exactly (M6 S3c §2.3): a tool id (`externalId`) and a link into
 * the tool (`url`). A zod-free copy of the manifest's rules
 * (`UNSTORABLE`, `declared(255)` and `HttpUrl` in
 * `packages/contracts/src/api/import-manifest.ts`), so `validate` refuses
 * what analyzr would refuse; the plugin's scripts bundle no zod. A test pins
 * the copy against the contracts' schemas. Stricter in one point: a link is
 * taken as written, so one that analyzr would accept only after trimming it
 * or deleting a tab or line break is refused.
 */

/** Control characters and lone UTF-16 surrogates, which analyzr's store cannot hold. */
export const UNSTORABLE = /[\p{Cc}\p{Cs}]/u;

/** Longest tool id a manifest declares. */
export const MAX_EXTERNAL_ID_LENGTH = 255;
/** Longest link a manifest declares. */
export const MAX_URL_LENGTH = 2048;

/** Why `value` is no tool id analyzr accepts, or `null` when it is one. */
export function externalIdProblem(value: string): string | null {
  if (value.length === 0) return 'must not be empty';
  if (value.length > MAX_EXTERNAL_ID_LENGTH) {
    return `longer than ${MAX_EXTERNAL_ID_LENGTH} characters`;
  }
  if (UNSTORABLE.test(value)) return 'contains control characters or lone surrogates';
  return null;
}

/** Why `value` is no link analyzr stores as written, or `null` when it is one. */
export function urlProblem(value: string): string | null {
  if (UNSTORABLE.test(value)) return 'contains control characters or lone surrogates';
  if (value !== value.trim()) return 'starts or ends with spaces';
  if (value.length > MAX_URL_LENGTH) return `longer than ${MAX_URL_LENGTH} characters`;
  const url = /^https?:\/\//i.test(value) ? URL.parse(value) : null;
  if (url === null || !/^https?:$/.test(url.protocol)) {
    return 'not an http(s) link such as https://tool.example.com/model/4711';
  }
  if (url.username !== '' || url.password !== '') {
    return 'contains a user name or password';
  }
  return null;
}

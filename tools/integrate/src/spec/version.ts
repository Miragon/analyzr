/**
 * The version of `analyzr-spec` (M6 S3c §2.4): it moves whenever the bytes
 * rendered from the same spec change, which `RENDER_OUTPUTS` in
 * `test/spec-render.test.ts` pins over the golden fixtures, as
 * `CONVERTER_OUTPUTS` pins normalize-bpmn. A bundle names it in
 * `source.importer`, never in the model bytes, so a version bump alone
 * revises no model. It lives here until the plugin release that ships
 * `analyzr-spec.mjs` moves it next to `src/version.ts`, which every shipped
 * bundle includes.
 */
export const ANALYZR_SPEC_VERSION = '0.1.0';

/** The format of one spec file (M6 §3.9). */
export const SPEC_FORMAT = 'analyzr-spec/1';

/** The importer a spec bundle's manifest names. */
export const SPEC_IMPORTER = 'analyzr-integrate/analyzr-spec';

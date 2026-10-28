/**
 * Versions of the bundled scripts. A converter's version is part of what a
 * bundle declares (`derived.converter: "normalize-bpmn@<version>"`,
 * `source.importer`, M6 §3.2), so a change to the model bytes normalize-bpmn
 * writes or to the derivation it declares (`derived`, `losses`) needs a new
 * version here (owners' rules for derived calls match the converter exactly,
 * M6 S2c-3). A purely informational value (`source.systemVersion`, a field
 * more in a script's JSON) moves with the plugin version only: plugin 0.1.3
 * declares `exporterVersion` tidied as analyzr stores it, so models declaring
 * one version with and without spaces around it now give it (before: none),
 * and one over 100 characters gives none (before: analyzr refused the
 * bundle); plugin 0.1.4 moves `ANALYZR_READ_VERSION` to 0.1.1, since its
 * preview counts `identityUpdated` and `modelled` too. The plugin version
 * (`plugins/analyzr-integrate/.claude-plugin/plugin.json`) moves with every
 * change of the plugin.
 */
export const INSPECT_VERSION = '0.1.0';
export const ANALYZR_READ_VERSION = '0.1.1';
export const NORMALIZE_BPMN_VERSION = '0.1.0';

/** `name@version` of normalize-bpmn, as `derived.converter` names it. */
export const NORMALIZE_BPMN_CONVERTER = `normalize-bpmn@${NORMALIZE_BPMN_VERSION}`;

/**
 * The version of `analyzr-spec` (M6 S3c §2.4): it moves whenever the bytes
 * rendered from the same spec change, which `RENDER_OUTPUTS` in
 * `test/spec-render.test.ts` pins over the golden fixtures, as
 * `CONVERTER_OUTPUTS` pins normalize-bpmn. A bundle names it in
 * `source.importer`, never in the model bytes, so a version bump alone
 * revises no model.
 */
export const ANALYZR_SPEC_VERSION = '0.1.0';

/** The format of one spec file (M6 §3.9). */
export const SPEC_FORMAT = 'analyzr-spec/1';

/** The importer a spec bundle's manifest names. */
export const SPEC_IMPORTER = 'analyzr-integrate/analyzr-spec';

/**
 * The version of `analyzr-convert` (M6 S3c §4, R21), the converter runner: a
 * run record names it as `runner`.
 */
export const ANALYZR_CONVERT_VERSION = '0.1.0';

/**
 * The version of `analyzr-interview` (M6 S6 §2), the interview guide: it moves whenever the
 * guide or its record written from the same questions file changes, which `GUIDE_OUTPUTS` in
 * `test/interview-guide.test.ts` pins over the golden guides.
 */
export const ANALYZR_INTERVIEW_VERSION = '0.1.0';

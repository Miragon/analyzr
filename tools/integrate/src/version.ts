/**
 * Versions of the bundled scripts. A converter's version is part of what a
 * bundle declares (`derived.converter: "normalize-bpmn@<version>"`,
 * `source.importer`, M6 §3.2), so a change to the model bytes normalize-bpmn
 * writes or to the derivation it declares (`derived`, `losses`) needs a new
 * version here (owners' rules for derived calls match the converter exactly,
 * M6 S2c-3). A purely informational value (`source.systemVersion`) moves with
 * the plugin version only: plugin 0.1.3 declares `exporterVersion` tidied as
 * analyzr stores it, so models declaring one version with and without spaces
 * around it now give it (before: none), and one over 100 characters gives
 * none (before: analyzr refused the bundle). The plugin version
 * (`plugins/analyzr-integrate/.claude-plugin/plugin.json`) moves with every
 * change of the plugin.
 */
export const INSPECT_VERSION = '0.1.0';
export const ANALYZR_READ_VERSION = '0.1.0';
export const NORMALIZE_BPMN_VERSION = '0.1.0';

/** `name@version` of normalize-bpmn, as `derived.converter` names it. */
export const NORMALIZE_BPMN_CONVERTER = `normalize-bpmn@${NORMALIZE_BPMN_VERSION}`;

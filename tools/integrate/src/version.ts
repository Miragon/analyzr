/**
 * Versions of the bundled scripts. A converter's version is part of what a
 * bundle declares (`derived.converter: "normalize-bpmn@<version>"`,
 * `source.importer`, M6 §3.2), so a change to what normalize-bpmn writes
 * needs a new version here; the plugin version (`plugins/analyzr-integrate/
 * .claude-plugin/plugin.json`) moves with every change of the plugin.
 */
export const INSPECT_VERSION = '0.1.0';
export const NORMALIZE_BPMN_VERSION = '0.1.0';

/** `name@version` of normalize-bpmn, as `derived.converter` names it. */
export const NORMALIZE_BPMN_CONVERTER = `normalize-bpmn@${NORMALIZE_BPMN_VERSION}`;

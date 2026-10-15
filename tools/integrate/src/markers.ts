/**
 * Tool markers: what in a file hints at the tool that wrote it (M6 §3.8). Every
 * rule comes from general knowledge and public documentation and is to verify
 * with a real or sandbox export (`plugins/analyzr-integrate/reference/*.md`):
 * a marker is a hint the consultant confirms, never a fact.
 */
import type { BpmnSummary } from './bpmn-scan.ts';

export const TOOLS = ['signavio', 'aris', 'visio', 'adonis', 'bizagi', 'camunda'] as const;
export type Tool = (typeof TOOLS)[number];

export interface Marker {
  tool: Tool;
  /** What matched: `exporter`, `namespace`, `sid-ids`, `root-element`, `doctype`, `extension`, `zip-entry`. */
  marker: string;
}

/** What markers are computed from (one file). */
export interface MarkerInput {
  /** Path with its extension. */
  path: string;
  xmlRoot?: string | undefined;
  namespaces?: Readonly<Record<string, string>> | undefined;
  doctype?: boolean | undefined;
  bpmn?: BpmnSummary | undefined;
  /** Every element id (BPMN only), for the `sid-` share. */
  ids?: readonly string[] | undefined;
  zipEntries?: readonly string[] | undefined;
}

const EXPORTER: ReadonlyArray<readonly [Tool, RegExp]> = [
  ['signavio', /signavio/i],
  ['aris', /\baris\b/i],
  ['visio', /visio/i],
  ['adonis', /adonis|\bboc\b/i],
  ['bizagi', /bizagi/i],
  ['camunda', /camunda/i],
];

const NAMESPACE: ReadonlyArray<readonly [Tool, RegExp]> = [
  ['signavio', /signavio\.com/i],
  ['aris', /ids-scheer|softwareag|\baris\b/i],
  ['visio', /schemas\.microsoft\.com\/office\/visio/i],
  ['adonis', /boc-group|adonis/i],
  ['bizagi', /bizagi/i],
  ['camunda', /camunda\.org\/schema/i],
];

const EXTENSION: ReadonlyArray<readonly [Tool, RegExp]> = [
  ['visio', /\.(vsdx|vsd|vsdm)$/i],
  ['aris', /\.(aml|adb)$/i],
  ['adonis', /\.(adl|abl)$/i],
  ['bizagi', /\.bpm$/i],
];

const ROOT: ReadonlyArray<readonly [Tool, RegExp]> = [
  ['aris', /^AML$/],
  ['adonis', /^ADOXML$/],
];

/** The markers of one file, sorted by tool order and marker name, without duplicates. */
export function markersOf(input: MarkerInput): Marker[] {
  const out = new Map<string, Marker>();
  const add = (tool: Tool, marker: string): void => {
    out.set(`${tool} ${marker}`, { tool, marker });
  };
  const exporter = input.bpmn?.exporter ?? null;
  if (exporter !== null) {
    for (const [tool, re] of EXPORTER) if (re.test(exporter)) add(tool, 'exporter');
  }
  for (const uri of Object.values(input.namespaces ?? {})) {
    for (const [tool, re] of NAMESPACE) if (re.test(uri)) add(tool, 'namespace');
  }
  const ids = input.ids ?? [];
  if (ids.length > 0 && ids.filter((id) => id.startsWith('sid-')).length * 2 >= ids.length) {
    add('signavio', 'sid-ids');
  }
  if (input.xmlRoot !== undefined) {
    const local = input.xmlRoot.slice(input.xmlRoot.indexOf(':') + 1);
    for (const [tool, re] of ROOT) if (re.test(local)) add(tool, 'root-element');
    if (input.doctype === true && /^AML$/.test(local)) add('aris', 'doctype');
  }
  for (const [tool, re] of EXTENSION) if (re.test(input.path)) add(tool, 'extension');
  const entries = input.zipEntries ?? [];
  if (entries.some((e) => /^visio\//i.test(e))) add('visio', 'zip-entry');
  const order = (m: Marker): number => TOOLS.indexOf(m.tool);
  return [...out.values()].sort(
    (a, b) => order(a) - order(b) || (a.marker < b.marker ? -1 : a.marker > b.marker ? 1 : 0),
  );
}

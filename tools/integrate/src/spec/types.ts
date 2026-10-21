/**
 * `analyzr-spec/1` (M6 §3.9, S3c §2.2) as the validator returns it: one
 * model of a tool, written by an agent from a picture or PDF or by an
 * ad-hoc converter, which the renderer turns into BPMN 2.0 with DI. The
 * spec carries no model key, no model name and no BPMN id: keys come from
 * `keymap.json` through `plan`, ids derive from each element's `source`.
 * Texts are raw here; the renderer sanitizes and cuts them.
 */

/** Who wrote the spec: the session agent (`hand`) or a converter run (`converter`). */
export type SpecOrigin = 'hand' | 'converter';

export type NodeType = 'start' | 'end' | 'task' | 'subprocess' | 'call' | 'event' | 'gateway';

export const NODE_TYPES: readonly NodeType[] = [
  'start',
  'end',
  'task',
  'subprocess',
  'call',
  'event',
  'gateway',
];

/** The trigger of a start, end or intermediate event; `none` is a plain event. */
export type Trigger = 'none' | 'message' | 'signal' | 'timer' | 'terminate';

export type TaskKind = 'none' | 'user' | 'manual' | 'service' | 'send' | 'receive';

export type GatewayKind = 'exclusive' | 'parallel' | 'inclusive' | 'event-based';

export type DerivedKind = 'reconstructed' | 'as-told';

export interface SpecSource {
  /** The tool's id of this model (converter output only), or `null`. */
  externalId: string | null;
  /** Tool folder and model name, `/`-separated. */
  externalPath: string;
  /** An http(s) link into the tool (converter output only), or `null`. */
  url: string | null;
  /** The export file the model came from (report only), or `null`. */
  file: string | null;
}

/** How a spec the agent wrote was derived (absent in converter output). */
export interface SpecDerived {
  kind: DerivedKind;
  /** The model the agent runs as; required for `reconstructed`. */
  llmModel: string | null;
  /** `as-told`: opaque source ids. */
  from: string[];
}

export interface SpecNamed {
  source: string;
  name: string | null;
}

export interface SpecNode {
  source: string;
  type: NodeType;
  name: string | null;
  documentation: string | null;
  /** Source of a lane of the same process, or `null`. */
  lane: string | null;
  /** For the report only, never emitted. */
  note: string | null;
  /** start, end and event: the trigger (`none` when absent on a start or end). */
  trigger: Trigger | null;
  /** event: catching or throwing. */
  direction: 'catch' | 'throw' | null;
  /** task: its kind (`none` when absent). */
  taskKind: TaskKind | null;
  /** gateway: its kind. */
  gatewayKind: GatewayKind | null;
  /** call: the callee as the source names it. */
  target: string | null;
  /** The message's own name, only when the source names it. */
  message: string | null;
  /** The signal's own name, only when the source names it. */
  signal: string | null;
  /** Data store sources of the same process the node reads and writes. */
  reads: string[];
  writes: string[];
}

export interface SpecFlow {
  from: string;
  to: string;
  name: string | null;
  /** The flow's own id in the tool, or `null` (the id derives from its ends). */
  source: string | null;
}

export interface SpecProcess {
  source: string;
  name: string | null;
  documentation: string | null;
  /** The pool's name when a collaboration is drawn; default: the process name. */
  pool: string | null;
  /** Top to bottom. */
  lanes: SpecNamed[];
  dataStores: SpecNamed[];
  nodes: SpecNode[];
  flows: SpecFlow[];
}

export interface Spec {
  format: 'analyzr-spec/1';
  source: SpecSource;
  derived: SpecDerived | null;
  /** Black-box pools (no process), top to bottom below the processes' pools. */
  participants: SpecNamed[];
  /** Top to bottom. */
  processes: SpecProcess[];
  /** Ends are node, process or participant sources in different pools. */
  messageFlows: SpecFlow[];
  /** For the report only. */
  notes: string[];
}

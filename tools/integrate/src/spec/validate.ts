/**
 * The validator of `analyzr-spec/1` (M6 S3c §2.3): pure, collects every
 * problem of a spec (at most 100 errors and 100 warnings) instead of stopping
 * at the first, and returns the spec with its defaults only when it has no
 * error. Errors refuse the spec; warnings never do. A spec the session agent
 * wrote (`hand`) is held to more than a converter's output (`converter`):
 * it declares its derivation, carries no tool id or link (a picture shows
 * none), and draws starts, ends and lanes as BPMN wants them; a converter's
 * loose positions are rendered as given, with a warning, so nothing is
 * invented. Field names are looked up with `Object.hasOwn` against known
 * names; `__proto__`, `constructor` and `prototype` are refused by name.
 */
import { externalIdProblem, UNSTORABLE, urlProblem } from './declared.ts';
import { idFor, PREFIX } from './ids.ts';
import { cleanBlock, cleanLine, MAX_DOCUMENTATION_LENGTH, MAX_LABEL_LENGTH } from './text.ts';
import {
  NODE_TYPES,
  type DerivedKind,
  type GatewayKind,
  type NodeType,
  type Spec,
  type SpecDerived,
  type SpecFlow,
  type SpecNamed,
  type SpecNode,
  type SpecOrigin,
  type SpecProcess,
  type SpecSource,
  type TaskKind,
  type Trigger,
} from './types.ts';
import { SPEC_FORMAT } from '../version.ts';
import { MAX_PROBLEMS, type SpecProblem } from './yaml.ts';

export type { SpecProblem } from './yaml.ts';

/** Longest source id (UTF-16 code units). */
export const MAX_SOURCE_LENGTH = 200;
/** Longest tool path. */
export const MAX_PATH_LENGTH = 1024;
/** Longest `derived.llmModel` (as the manifest's). */
export const MAX_LLM_MODEL_LENGTH = 120;
/** Most `derived.from` ids (as the manifest's). */
export const MAX_FROM = 100;
/**
 * Most nodes of one spec; most flows, message flows and data associations
 * (`reads` and `writes`); most processes, participants, lanes and data
 * stores: a spec holds one model, and these bound the work of validating,
 * laying out and rendering it.
 */
export const MAX_NODES = 5000;
export const MAX_FLOWS = 10_000;
export const MAX_PARTS = 1000;
/** Longest note kept for the report. */
export const MAX_NOTE_LENGTH = 500;

const SOURCE_ID = /^[A-Za-z0-9._:-]{1,64}$/;
const REFUSED_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

export interface SpecValidation {
  /** The spec with its defaults; `null` when it has errors. */
  spec: Spec | null;
  errors: SpecProblem[];
  warnings: SpecProblem[];
}

export interface ValidateOptions {
  origin: SpecOrigin;
}

type Rec = Record<string, unknown>;

const isRecord = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

const quoted = (s: string): string => JSON.stringify(s);

/** Longest piece of a spec's own input a message repeats. */
const SHOWN_LENGTH = 80;

/** `s` cut to {@link SHOWN_LENGTH} code units, ending in an ellipsis when cut. */
function cut(s: string): string {
  return s.length <= SHOWN_LENGTH
    ? s
    : `${s.slice(0, SHOWN_LENGTH).replace(/[\ud800-\udbff]$/, '')}…`;
}

/** A value of the spec's input as a message shows it: quoted when a string, at most 80 characters. */
function shown(v: unknown): string {
  return typeof v === 'string' ? quoted(cut(v)) : cut(JSON.stringify(v) ?? String(v));
}

/** Hints for fields a spec never has. */
const FIELD_HINTS: Readonly<Record<string, string>> = {
  calledElement:
    'a call names its target with "target"; analyzr never writes calledElement from a spec',
  id: 'the BPMN id derives from "source"; a spec contains no BPMN id',
  key: 'model keys come from keymap.json through plan, never from a spec',
  x: 'analyzr lays the model out itself; a spec has no coordinates',
  y: 'analyzr lays the model out itself; a spec has no coordinates',
  condition: 'a spec carries nothing executable: put the condition into the flow name',
};

const ROOT_FIELDS = [
  'format',
  'source',
  'derived',
  'participants',
  'processes',
  'messageFlows',
  'notes',
];
const SOURCE_FIELDS = ['externalId', 'externalPath', 'url', 'file'];
const DERIVED_FIELDS = ['kind', 'llmModel', 'from'];
const NAMED_FIELDS = ['source', 'name'];
const PROCESS_FIELDS = [
  'source',
  'name',
  'documentation',
  'pool',
  'lanes',
  'dataStores',
  'nodes',
  'flows',
];
const FLOW_FIELDS = ['from', 'to', 'name', 'source'];
const COMMON_NODE_FIELDS = ['source', 'type', 'name', 'documentation', 'lane', 'note'];
const NODE_FIELDS: Readonly<Record<NodeType, readonly string[]>> = {
  start: [...COMMON_NODE_FIELDS, 'trigger', 'message', 'signal'],
  end: [...COMMON_NODE_FIELDS, 'trigger', 'message', 'signal'],
  event: [...COMMON_NODE_FIELDS, 'direction', 'trigger', 'message', 'signal'],
  task: [...COMMON_NODE_FIELDS, 'kind', 'message', 'reads', 'writes'],
  subprocess: [...COMMON_NODE_FIELDS, 'reads', 'writes'],
  call: ['source', 'type', 'target', 'documentation', 'lane', 'note'],
  gateway: [...COMMON_NODE_FIELDS, 'kind'],
};

const TRIGGERS = {
  start: ['none', 'message', 'signal', 'timer'],
  end: ['none', 'message', 'signal', 'terminate'],
  catch: ['message', 'signal', 'timer'],
  throw: ['none', 'message', 'signal'],
} as const satisfies Record<string, readonly Trigger[]>;
const TASK_KINDS: readonly TaskKind[] = ['none', 'user', 'manual', 'service', 'send', 'receive'];
const GATEWAY_KINDS: readonly GatewayKind[] = ['exclusive', 'parallel', 'inclusive', 'event-based'];

/** Collects problems, at most {@link MAX_PROBLEMS} of each kind. */
class Problems {
  readonly errors: SpecProblem[] = [];
  readonly warnings: SpecProblem[] = [];
  private omittedErrors = 0;
  private omittedWarnings = 0;

  error(path: string, code: string, message: string): void {
    if (this.errors.length >= MAX_PROBLEMS) this.omittedErrors++;
    else this.errors.push({ path, code, message });
  }

  warn(path: string, code: string, message: string): void {
    if (this.warnings.length >= MAX_PROBLEMS) this.omittedWarnings++;
    else this.warnings.push({ path, code, message });
  }

  finish(): void {
    if (this.omittedErrors > 0) {
      this.errors.push({
        path: '',
        code: 'too-many-problems',
        message: `${this.omittedErrors} more errors`,
      });
    }
    if (this.omittedWarnings > 0) {
      this.warnings.push({
        path: '',
        code: 'too-many-problems',
        message: `${this.omittedWarnings} more warnings`,
      });
    }
  }
}

const join = (path: string, key: string): string => (path === '' ? key : `${path}.${key}`);

/** Reads the fields of one mapping, reporting wrong types as it goes. */
class Reader {
  private readonly p: Problems;
  readonly path: string;
  private readonly o: Rec;

  constructor(p: Problems, path: string, o: Rec) {
    this.p = p;
    this.path = path;
    this.o = o;
  }

  has(key: string): boolean {
    return Object.hasOwn(this.o, key) && this.o[key] !== null && this.o[key] !== undefined;
  }

  raw(key: string): unknown {
    return Object.hasOwn(this.o, key) ? this.o[key] : undefined;
  }

  /** A string field; `null` when absent (or `null`) or of another type (reported). */
  string(key: string, options: { required?: string | true; idLike?: boolean } = {}): string | null {
    const path = join(this.path, key);
    const v = this.raw(key);
    if (v === undefined || v === null) {
      if (options.required !== undefined) {
        const hint = options.required === true ? '' : ` (${options.required})`;
        this.p.error(path, 'required', `required${hint}`);
      }
      return null;
    }
    if (typeof v !== 'string') {
      const got = Array.isArray(v)
        ? 'a list'
        : typeof v === 'object'
          ? 'a mapping'
          : `${typeof v} ${JSON.stringify(v)}`;
      const hint =
        typeof v === 'number' || typeof v === 'boolean'
          ? options.idLike === true
            ? ' (quote ids: an unquoted 0012 or 1.10 is a number in YAML)'
            : ' (quote it)'
          : '';
      this.p.error(path, 'type', `expected a string, got ${got}${hint}`);
      return null;
    }
    if (options.required !== undefined && v.trim() === '') {
      this.p.error(path, 'empty', 'must not be empty');
      return null;
    }
    return v;
  }

  /** A list field; `[]` when absent; `null` for another type (reported). */
  list(key: string, options: { required?: string } = {}): unknown[] | null {
    const path = join(this.path, key);
    const v = this.raw(key);
    if (v === undefined || v === null) {
      if (options.required !== undefined)
        this.p.error(path, 'required', `required (${options.required})`);
      return [];
    }
    if (!Array.isArray(v)) {
      this.p.error(path, 'type', 'expected a list');
      return null;
    }
    if (options.required !== undefined && v.length === 0) {
      this.p.error(path, 'empty', `must not be empty (${options.required})`);
    }
    return v as unknown[];
  }

  /** A list of strings (ids). */
  strings(key: string): string[] {
    const items = this.list(key);
    if (items === null) return [];
    const out: string[] = [];
    items.forEach((item, i) => {
      const path = `${join(this.path, key)}[${i}]`;
      if (typeof item !== 'string') {
        this.p.error(
          path,
          'type',
          `expected a string${typeof item === 'number' ? ' (quote ids: an unquoted 0012 or 1.10 is a number in YAML)' : ''}`,
        );
      } else {
        out.push(item);
      }
    });
    return out;
  }
}

/** Opens a mapping and reports its unknown fields; `null` for another type (reported). */
function open(
  p: Problems,
  path: string,
  value: unknown,
  allowed: readonly string[],
  /** A hint for an unknown field; `null` leaves the field unreported. */
  otherHint?: (key: string) => string | null | undefined,
): Reader | null {
  if (!isRecord(value)) {
    p.error(path, 'type', `expected a mapping${Array.isArray(value) ? ', got a list' : ''}`);
    return null;
  }
  for (const key of Object.keys(value)) {
    if (REFUSED_NAMES.has(key)) {
      p.error(join(path, key), 'refused-field', `${quoted(key)} is no field name`);
    } else if (!allowed.includes(key)) {
      const other = otherHint?.(key);
      if (other === null) continue;
      const hint = other ?? (Object.hasOwn(FIELD_HINTS, key) ? FIELD_HINTS[key] : undefined);
      p.error(
        join(path, cut(key)),
        'unknown-field',
        `unknown field${hint === undefined ? '' : ` (${hint})`}`,
      );
    }
  }
  return new Reader(p, path, value);
}

/** Why `source` is no source id, or `null`. */
function sourceProblem(source: string): string | null {
  if (source.length > MAX_SOURCE_LENGTH) return `longer than ${MAX_SOURCE_LENGTH} characters`;
  if (UNSTORABLE.test(source)) return 'contains control characters or lone surrogates';
  return null;
}

/** One element's place, for references and messages. */
interface Placed {
  path: string;
  kind: 'process' | 'participant' | 'lane' | 'dataStore' | 'node' | 'flow' | 'messageFlow';
  /** The process it lies in (`null` for a participant or a message flow). */
  process: string | null;
}

/** Validates one spec (see the module comment). */
export function validateSpec(value: unknown, options: ValidateOptions): SpecValidation {
  const p = new Problems();
  const spec = check(p, value, options.origin);
  p.finish();
  return { spec: p.errors.length === 0 ? spec : null, errors: p.errors, warnings: p.warnings };
}

function check(p: Problems, value: unknown, origin: SpecOrigin): Spec | null {
  const root = open(p, '', value, ROOT_FIELDS, (key) =>
    key === 'name'
      ? 'analyzr names a model after its first process: set the process name or its pool'
      : undefined,
  );
  if (root === null) return null;

  // format
  const format = root.raw('format');
  if (format === undefined || format === null) {
    p.error('format', 'required', `required (${quoted(SPEC_FORMAT)})`);
  } else if (format !== SPEC_FORMAT) {
    p.error('format', 'format', `expected ${quoted(SPEC_FORMAT)}, got ${shown(format)}`);
  }

  const source = readSource(p, root, origin);
  const derived = readDerived(p, root, origin);

  /** Where each read element stands in the spec (later checks name it there, also after one that failed). */
  const at = new Map<object, string>();
  // participants
  const places = new Map<string, Placed>();
  const placeSource = (r: Reader, kind: Placed['kind'], process: string | null): string | null => {
    const s = r.string('source', { required: true, idLike: true });
    if (s === null) return null;
    const path = join(r.path, 'source');
    const problem = sourceProblem(s);
    if (problem !== null) {
      p.error(path, 'source', problem);
      return null;
    }
    const other = places.get(s);
    if (other !== undefined) {
      p.error(path, 'duplicate-source', `${quoted(s)} is used twice (also ${other.path})`);
      return null;
    }
    places.set(s, { path: r.path, kind, process });
    return s;
  };
  const named = (r: Reader, kind: Placed['kind'], process: string | null): SpecNamed | null => {
    const s = placeSource(r, kind, process);
    const name = r.string('name');
    if (name !== null) truncation(p, join(r.path, 'name'), name);
    return s === null ? null : { source: s, name };
  };

  const participants: SpecNamed[] = [];
  (root.list('participants') ?? []).forEach((item, i) => {
    const r = open(p, `participants[${i}]`, item, NAMED_FIELDS);
    const n = r === null ? null : named(r, 'participant', null);
    if (n !== null) participants.push(n);
  });

  // processes
  const processes: SpecProcess[] = [];
  /** Processes whose node list could not be read: their flows are not checked against it. */
  const unreadable = new Set<string>();
  let nodeCount = 0;
  let flowCount = 0;
  const processItems = root.list('processes', { required: 'at least one process' }) ?? [];
  processItems.forEach((item, i) => {
    const path = `processes[${i}]`;
    const r = open(p, path, item, PROCESS_FIELDS);
    if (r === null) return;
    const s = placeSource(r, 'process', null);
    const name = r.string('name');
    if (name !== null) truncation(p, join(path, 'name'), name);
    const documentation = r.string('documentation');
    if (documentation !== null) truncation(p, join(path, 'documentation'), documentation, true);
    const pool = r.string('pool');
    if (pool !== null) truncation(p, join(path, 'pool'), pool);
    const owner = s ?? `#${i}`;
    const lanes: SpecNamed[] = [];
    (r.list('lanes') ?? []).forEach((l, j) => {
      const lr = open(p, `${path}.lanes[${j}]`, l, NAMED_FIELDS);
      const n = lr === null ? null : named(lr, 'lane', owner);
      if (n === null) return;
      lanes.push(n);
      at.set(n, `${path}.lanes[${j}]`);
    });
    const dataStores: SpecNamed[] = [];
    (r.list('dataStores') ?? []).forEach((d, j) => {
      const dr = open(p, `${path}.dataStores[${j}]`, d, NAMED_FIELDS);
      const n = dr === null ? null : named(dr, 'dataStore', owner);
      if (n !== null) dataStores.push(n);
    });
    const nodes: SpecNode[] = [];
    const nodeList = r.list('nodes', { required: 'at least one node' });
    if (nodeList === null && s !== null) unreadable.add(s);
    const nodeItems = nodeList ?? [];
    nodeCount += nodeItems.length;
    nodeItems.forEach((n, j) => {
      const node = readNode(p, `${path}.nodes[${j}]`, n, (nr) => placeSource(nr, 'node', owner));
      if (node === null) return;
      nodes.push(node);
      at.set(node, `${path}.nodes[${j}]`);
    });
    const flows: SpecFlow[] = [];
    const flowItems = r.list('flows') ?? [];
    flowCount += flowItems.length;
    flowItems.forEach((f, j) => {
      const flow = readFlow(p, `${path}.flows[${j}]`, f, (fr) => placeSource(fr, 'flow', owner));
      if (flow === null) return;
      flows.push(flow);
      at.set(flow, `${path}.flows[${j}]`);
    });
    if (s !== null) {
      processes.push({ source: s, name, documentation, pool, lanes, dataStores, nodes, flows });
    }
  });

  const messageFlows: SpecFlow[] = [];
  const messageFlowItems = root.list('messageFlows') ?? [];
  flowCount += messageFlowItems.length;
  messageFlowItems.forEach((f, j) => {
    const flow = readFlow(p, `messageFlows[${j}]`, f, (fr) => placeSource(fr, 'messageFlow', null));
    if (flow === null) return;
    messageFlows.push(flow);
    at.set(flow, `messageFlows[${j}]`);
  });

  const notes: string[] = [];
  root.strings('notes').forEach((note, i) => {
    if (cleanLine(note, MAX_NOTE_LENGTH).truncated) {
      p.warn(`notes[${i}]`, 'note-truncated', `cut to ${MAX_NOTE_LENGTH} characters in the report`);
    }
    notes.push(note);
  });

  for (const proc of processes) {
    for (const n of proc.nodes) flowCount += n.reads.length + n.writes.length;
  }
  const partCount =
    processItems.length +
    participants.length +
    processes.reduce((sum, proc) => sum + proc.lanes.length + proc.dataStores.length, 0);
  const tooLarge = [
    { count: nodeCount, max: MAX_NODES, code: 'too-many-nodes', what: 'nodes' },
    {
      count: flowCount,
      max: MAX_FLOWS,
      code: 'too-many-flows',
      what: 'flows, message flows and data associations (reads, writes)',
    },
    {
      count: partCount,
      max: MAX_PARTS,
      code: 'too-many-parts',
      what: 'processes, participants, lanes and data stores',
    },
  ].filter((limit) => limit.count > limit.max);
  for (const { count, max, code, what } of tooLarge) {
    p.error('processes', code, `${count} ${what}; a spec holds one model of at most ${max}`);
  }
  // a spec over a limit is refused for it alone: checking its references would cost the most
  if (tooLarge.length === 0) {
    const nodesByProcess = new Map<string, Set<string>>();
    for (const [s, at] of places) {
      if (at.kind !== 'node' || at.process === null) continue;
      const set = nodesByProcess.get(at.process);
      if (set === undefined) nodesByProcess.set(at.process, new Set([s]));
      else set.add(s);
    }
    for (const [i, proc] of processes.entries()) {
      if (unreadable.has(proc.source)) continue;
      const placed = nodesByProcess.get(proc.source) ?? new Set<string>();
      checkProcess(p, `processes[${i}]`, proc, { placed, places, at, origin });
    }
    checkMessageFlows(p, processes, participants, messageFlows, { places, at });
    modelName(p, processes);
  }

  if (source === null || p.errors.length > 0) return null;
  return {
    format: SPEC_FORMAT,
    source,
    derived,
    participants,
    processes,
    messageFlows,
    notes,
  };
}

/** Warns when a text will be cut (loss `text-truncated`). */
function truncation(p: Problems, path: string, text: string, block = false): void {
  if (block ? cleanBlock(text).truncated : cleanLine(text).truncated) {
    const max = block ? MAX_DOCUMENTATION_LENGTH : MAX_LABEL_LENGTH;
    p.warn(path, 'text-truncated', `cut to ${max} characters (loss text-truncated)`);
  }
}

function readSource(p: Problems, root: Reader, origin: SpecOrigin): SpecSource | null {
  if (!root.has('source')) {
    p.error('source', 'required', 'required (externalPath: where the model lives in the tool)');
    return null;
  }
  const r = open(p, 'source', root.raw('source'), SOURCE_FIELDS);
  if (r === null) return null;
  const handNote = 'a spec you write has no tool id or link: a picture shows none';
  let externalId = r.string('externalId', { idLike: true });
  if (externalId !== null) {
    const problem = origin === 'hand' ? handNote : externalIdProblem(externalId);
    if (problem !== null) {
      p.error('source.externalId', origin === 'hand' ? 'hand-tool-id' : 'external-id', problem);
      externalId = null;
    }
  }
  let url = r.string('url');
  if (url !== null) {
    const problem = origin === 'hand' ? handNote : urlProblem(url);
    if (problem !== null) {
      p.error('source.url', origin === 'hand' ? 'hand-tool-id' : 'url', problem);
      url = null;
    }
  }
  const externalPath = r.string('externalPath', {
    required: 'tool folder and model name, "/"-separated, e.g. Vertrieb/Prozesse/Auftrag',
  });
  if (externalPath !== null) {
    if (externalPath.length > MAX_PATH_LENGTH) {
      p.error('source.externalPath', 'too-long', `longer than ${MAX_PATH_LENGTH} characters`);
    } else if (UNSTORABLE.test(externalPath)) {
      p.error(
        'source.externalPath',
        'external-path',
        'contains control characters or lone surrogates',
      );
    } else if (externalPath.split('/').some((segment) => segment.trim() === '')) {
      p.error(
        'source.externalPath',
        'external-path',
        'tool folders and the model name, "/"-separated, without empty parts (e.g. Vertrieb/Prozesse/Auftrag)',
      );
    }
  }
  const file = r.string('file');
  if (file !== null && (file.length > MAX_PATH_LENGTH || UNSTORABLE.test(file))) {
    p.error(
      'source.file',
      'file',
      `a path below the export of at most ${MAX_PATH_LENGTH} characters without control characters`,
    );
  }
  if (externalPath === null) return null;
  return { externalId, externalPath, url, file };
}

function readDerived(p: Problems, root: Reader, origin: SpecOrigin): SpecDerived | null {
  if (!root.has('derived')) {
    if (origin === 'hand') {
      p.error(
        'derived',
        'derived-required',
        'required in a spec you write: reconstructed (from a picture or PDF, with llmModel)',
      );
    }
    return null;
  }
  if (origin === 'converter') {
    p.error(
      'derived',
      'converter-derived',
      'set by analyzr-convert --derived; a converter does not declare its derivation',
    );
    return null;
  }
  const r = open(p, 'derived', root.raw('derived'), DERIVED_FIELDS);
  if (r === null) return null;
  const kind = r.string('kind', { required: 'reconstructed (from a picture or PDF)' });
  let derivedKind: DerivedKind | null = null;
  if (kind === 'reconstructed' || kind === 'as-told') {
    derivedKind = kind;
  } else if (kind === 'converted') {
    p.error(
      'derived.kind',
      'derived-kind',
      '"converted" is set by analyzr-convert; a spec you write is "reconstructed"',
    );
  } else if (kind === 'export') {
    p.error(
      'derived.kind',
      'derived-kind',
      '"export" is a tool\'s own BPMN; a spec you write is "reconstructed"',
    );
  } else if (kind !== null) {
    p.error('derived.kind', 'derived-kind', `unknown kind ${shown(kind)} (reconstructed, as-told)`);
  }
  let llmModel = r.string('llmModel');
  if (llmModel !== null) {
    if (
      llmModel.trim() === '' ||
      llmModel.length > MAX_LLM_MODEL_LENGTH ||
      UNSTORABLE.test(llmModel)
    ) {
      p.error(
        'derived.llmModel',
        'llm-model',
        `the model id you run as: 1 to ${MAX_LLM_MODEL_LENGTH} characters without control characters`,
      );
      llmModel = null;
    }
  } else if (derivedKind === 'reconstructed') {
    p.error('derived.llmModel', 'required', 'required for reconstructed (the model you run as)');
  }
  const from = r.strings('from');
  if (from.length > 0 && derivedKind === 'reconstructed') {
    p.error('derived.from', 'derived-from', 'only for as-told (the interviews it comes from)');
  }
  if (from.length > MAX_FROM) {
    p.error('derived.from', 'derived-from', `at most ${MAX_FROM} source ids`);
  }
  from.forEach((id, i) => {
    if (!SOURCE_ID.test(id)) {
      p.error(
        `derived.from[${i}]`,
        'derived-from',
        'an opaque source id ([A-Za-z0-9._:-], at most 64), never a name',
      );
    }
  });
  if (derivedKind === null) return null;
  return { kind: derivedKind, llmModel, from };
}

/** One of `allowed`, or `null` (reported). */
function oneOf<T extends string>(
  p: Problems,
  path: string,
  value: string | null,
  allowed: readonly T[],
  what: (value: string) => string,
): T | null {
  if (value === null) return null;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  p.error(path, 'value', `${what(shown(value))} (${allowed.join(', ')})`);
  return null;
}

function readNode(
  p: Problems,
  path: string,
  value: unknown,
  placeSource: (r: Reader) => string | null,
): SpecNode | null {
  if (!isRecord(value)) {
    p.error(path, 'type', 'expected a mapping');
    return null;
  }
  const typeValue = Object.hasOwn(value, 'type') ? value['type'] : undefined;
  const type =
    typeof typeValue === 'string' && (NODE_TYPES as readonly string[]).includes(typeValue)
      ? (typeValue as NodeType)
      : null;
  const allowed = type === null ? COMMON_NODE_FIELDS : NODE_FIELDS[type];
  const r = open(p, path, value, allowed, (key) => {
    if (type === 'call' && key === 'name') {
      return 'a call is named after its target; put a differing label into documentation';
    }
    if (Object.hasOwn(FIELD_HINTS, key)) return undefined;
    const elsewhere = NODE_TYPES.filter((t) => NODE_FIELDS[t].includes(key));
    // of a node whose type is unknown, only the type is reported, not the fields of its kind
    if (type === null) return elsewhere.length > 0 ? null : undefined;
    return elsewhere.length > 0
      ? `not a field of a ${type} node; ${quoted(key)} belongs to ${elsewhere.join(', ')}`
      : undefined;
  });
  if (r === null) return null;
  if (type === null) {
    if (typeValue === undefined || typeValue === null) {
      p.error(join(path, 'type'), 'required', `required (${NODE_TYPES.join(', ')})`);
    } else {
      p.error(
        join(path, 'type'),
        'type',
        `unknown type ${shown(typeValue)} (${NODE_TYPES.join(', ')})`,
      );
    }
  }
  const source = placeSource(r);
  const name = type === 'call' ? null : r.string('name');
  if (name !== null) truncation(p, join(path, 'name'), name);
  const documentation = r.string('documentation');
  if (documentation !== null) truncation(p, join(path, 'documentation'), documentation, true);
  const lane = r.string('lane', { idLike: true });
  const note = r.string('note');
  if (note !== null && cleanLine(note, MAX_NOTE_LENGTH).truncated) {
    p.warn(
      join(path, 'note'),
      'note-truncated',
      `cut to ${MAX_NOTE_LENGTH} characters in the report`,
    );
  }
  if (type === null || source === null) return null;

  const node: SpecNode = {
    source,
    type,
    name,
    documentation,
    lane,
    note,
    trigger: null,
    direction: null,
    taskKind: null,
    gatewayKind: null,
    target: null,
    message: null,
    signal: null,
    reads: [],
    writes: [],
  };
  const has = (key: string): boolean => NODE_FIELDS[type].includes(key);
  if (type === 'event') {
    node.direction = oneOf(
      p,
      join(path, 'direction'),
      r.string('direction', { required: 'catch or throw' }),
      ['catch', 'throw'] as const,
      (v) => `unknown direction ${v}`,
    );
  }
  if (type === 'start' || type === 'end' || type === 'event') {
    const raw = r.string('trigger', type === 'event' ? { required: true } : {});
    const table: readonly Trigger[] | null =
      type !== 'event' ? TRIGGERS[type] : node.direction === null ? null : TRIGGERS[node.direction];
    if (raw === null) {
      if (type !== 'event') node.trigger = 'none';
    } else if (table !== null) {
      const where =
        type === 'event'
          ? `a ${node.direction ?? ''} event`
          : type === 'end'
            ? 'an end'
            : 'a start';
      node.trigger = oneOf(
        p,
        join(path, 'trigger'),
        raw,
        table,
        (v) => `${v} is no trigger of ${where}`,
      );
    }
  }
  if (type === 'task') {
    const kind = r.string('kind');
    node.taskKind =
      kind === null
        ? 'none'
        : oneOf(p, join(path, 'kind'), kind, TASK_KINDS, (v) => `unknown task kind ${v}`);
  }
  if (type === 'gateway') {
    node.gatewayKind = oneOf(
      p,
      join(path, 'kind'),
      r.string('kind', { required: GATEWAY_KINDS.join(', ') }),
      GATEWAY_KINDS,
      (v) => `unknown gateway kind ${v}`,
    );
  }
  if (type === 'call') {
    const target = r.string('target', { required: 'the callee as the source names it' });
    if (target !== null) {
      if (cleanLine(target).text === '') {
        p.error(join(path, 'target'), 'empty', 'must not be empty');
      } else {
        truncation(p, join(path, 'target'), target);
        node.target = target;
      }
    }
  }
  if (has('message')) {
    const message = r.string('message');
    if (message !== null) {
      const fits =
        node.trigger === 'message' || node.taskKind === 'send' || node.taskKind === 'receive';
      if (!fits) {
        p.error(
          join(path, 'message'),
          'message',
          'only on a message trigger or a send or receive task',
        );
      } else {
        truncation(p, join(path, 'message'), message);
        node.message = message;
      }
    }
  }
  if (has('signal')) {
    const signal = r.string('signal');
    if (signal !== null) {
      if (node.trigger !== 'signal') {
        p.error(join(path, 'signal'), 'signal', 'only on a signal trigger');
      } else {
        truncation(p, join(path, 'signal'), signal);
        node.signal = signal;
      }
    }
  }
  if (has('reads')) {
    node.reads = r.strings('reads');
    node.writes = r.strings('writes');
  }
  return node;
}

function readFlow(
  p: Problems,
  path: string,
  value: unknown,
  placeSource: (r: Reader) => string | null,
): SpecFlow | null {
  const r = open(p, path, value, FLOW_FIELDS);
  if (r === null) return null;
  const from = r.string('from', { required: 'the source of the element it leaves', idLike: true });
  const to = r.string('to', { required: 'the source of the element it enters', idLike: true });
  const name = r.string('name');
  if (name !== null) truncation(p, join(path, 'name'), name);
  let source: string | null = null;
  if (r.has('source')) {
    source = placeSource(r);
    if (source === null) return null;
  }
  if (from === null || to === null) return null;
  return { from, to, name, source };
}

function checkProcess(
  p: Problems,
  path: string,
  proc: SpecProcess,
  context: {
    /** Every node of the process with a usable source, also one with errors of its own (no follow-up errors). */
    placed: ReadonlySet<string>;
    places: ReadonlyMap<string, Placed>;
    /** Where each element stands in the spec. */
    at: ReadonlyMap<object, string>;
    origin: SpecOrigin;
  },
): void {
  const { placed, places, origin } = context;
  const pathOf = (element: object): string => context.at.get(element) ?? path;
  const where = `process ${quoted(proc.source)}`;
  const nodes = new Map(proc.nodes.map((n) => [n.source, n]));
  const lanes = new Set(proc.lanes.map((l) => l.source));
  const stores = new Set(proc.dataStores.map((d) => d.source));
  const elsewhere = (source: string): string => {
    const placed = places.get(source);
    return placed?.kind === 'node' && placed.process !== null
      ? ` (it lies in process ${quoted(placed.process)}; a flow stays inside its process, a message flow connects pools)`
      : '';
  };

  for (const n of proc.nodes) {
    const np = pathOf(n);
    if (n.lane !== null && !lanes.has(n.lane)) {
      p.error(`${np}.lane`, 'reference', `no lane ${shown(n.lane)} in ${where}`);
    } else if (n.lane === null && lanes.size > 0) {
      if (origin === 'hand') {
        p.error(`${np}.lane`, 'lane-required', 'required, since the process has lanes');
      } else {
        p.warn(
          `${np}.lane`,
          'no-lane',
          'none in a process with lanes: drawn below the lanes, no lane invented',
        );
      }
    }
    for (const key of ['reads', 'writes'] as const) {
      const seen = new Set<string>();
      n[key].forEach((ds, k) => {
        if (!stores.has(ds)) {
          p.error(`${np}.${key}[${k}]`, 'reference', `no data store ${shown(ds)} in ${where}`);
        } else if (seen.has(ds)) {
          p.error(`${np}.${key}[${k}]`, 'duplicate', `${shown(ds)} is listed twice`);
        }
        seen.add(ds);
      });
    }
  }

  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  const pairs = new Map<string, SpecFlow[]>();
  for (const f of proc.flows) {
    const fp = pathOf(f);
    let ok = true;
    for (const [key, end] of [
      ['from', f.from],
      ['to', f.to],
    ] as const) {
      if (!placed.has(end)) {
        p.error(`${fp}.${key}`, 'reference', `no node ${shown(end)} in ${where}${elsewhere(end)}`);
        ok = false;
      }
    }
    if (!ok) continue;
    outgoing.set(f.from, (outgoing.get(f.from) ?? 0) + 1);
    incoming.set(f.to, (incoming.get(f.to) ?? 0) + 1);
    const pair = `${f.from}\u0000${f.to}`;
    const group = pairs.get(pair);
    if (group === undefined) pairs.set(pair, [f]);
    else group.push(f);
    const loose = (code: string, message: string): void => {
      if (origin === 'hand') p.error(fp, code, message);
      else p.warn(fp, code, `${message} (rendered as given)`);
    };
    if (nodes.get(f.to)?.type === 'start') {
      loose('start-incoming', `flows into start ${quoted(f.to)}; a start has no incoming flow`);
    }
    if (nodes.get(f.from)?.type === 'end') {
      loose('end-outgoing', `flows out of end ${quoted(f.from)}; an end has no outgoing flow`);
    }
  }
  for (const group of pairs.values()) {
    if (group.length < 2 || group.every((f) => f.source !== null)) continue;
    for (const f of group.slice(1)) {
      p.error(
        pathOf(f),
        'duplicate-flow',
        `a second flow from ${quoted(f.from)} to ${quoted(f.to)}: give each flow between the same nodes its own source`,
      );
    }
  }

  for (const n of proc.nodes) {
    if (
      (incoming.get(n.source) ?? 0) + (outgoing.get(n.source) ?? 0) === 0 &&
      proc.nodes.length > 1
    ) {
      p.warn(pathOf(n), 'no-flow', 'no flow in or out');
    }
  }
  if (!proc.nodes.some((n) => n.type === 'start')) p.warn(path, 'no-start', 'no start');
  if (!proc.nodes.some((n) => n.type === 'end')) p.warn(path, 'no-end', 'no end');
  const laned = new Set(proc.nodes.map((n) => n.lane));
  for (const l of proc.lanes) {
    if (!laned.has(l.source)) p.warn(pathOf(l), 'empty-lane', 'no node in this lane');
  }
}

function checkMessageFlows(
  p: Problems,
  processes: readonly SpecProcess[],
  participants: readonly SpecNamed[],
  flows: readonly SpecFlow[],
  context: { places: ReadonlyMap<string, Placed>; at: ReadonlyMap<object, string> },
): void {
  const { places } = context;
  const pathOf = (f: SpecFlow): string => context.at.get(f) ?? 'messageFlows';
  const nodes = new Map<string, SpecNode>();
  for (const proc of processes) for (const n of proc.nodes) nodes.set(n.source, n);
  const black = new Set(participants.map((pt) => pt.source));
  const procs = new Set(processes.map((proc) => proc.source));
  /** The pool an end lies in: `process:<source>` or `participant:<source>`. */
  const poolOf = (source: string): string | null => {
    const placed = places.get(source);
    if (placed?.kind === 'node' && placed.process !== null) {
      return `process:${placed.process}`;
    }
    if (procs.has(source)) return `process:${source}`;
    if (black.has(source)) return `participant:${source}`;
    return null;
  };
  const pairs = new Map<string, SpecFlow[]>();
  for (const f of flows) {
    const fp = pathOf(f);
    const pools: (string | null)[] = [];
    for (const [key, end] of [
      ['from', f.from],
      ['to', f.to],
    ] as const) {
      const pool = poolOf(end);
      pools.push(pool);
      if (pool === null) {
        p.error(`${fp}.${key}`, 'reference', `no node, process or participant ${shown(end)}`);
      } else if (nodes.get(end)?.type === 'gateway') {
        p.error(
          `${fp}.${key}`,
          'message-flow-end',
          `gateway ${quoted(end)} sends and receives no messages: connect the task or event`,
        );
      }
    }
    const [a, b] = pools;
    if (a == null || b == null) continue;
    if (a === b) {
      const [kind, source] = [a.slice(0, a.indexOf(':')), a.slice(a.indexOf(':') + 1)];
      p.error(
        fp,
        'message-flow-pool',
        kind === 'process'
          ? `both ends lie in process ${quoted(source)}; a message flow connects two pools`
          : `both ends are participant ${quoted(source)}; a message flow connects two pools`,
      );
      continue;
    }
    const pair = `${f.from}\u0000${f.to}`;
    const group = pairs.get(pair);
    if (group === undefined) pairs.set(pair, [f]);
    else group.push(f);
  }
  for (const group of pairs.values()) {
    if (group.length < 2 || group.every((f) => f.source !== null)) continue;
    for (const f of group.slice(1)) {
      p.error(
        pathOf(f),
        'duplicate-flow',
        `a second message flow from ${quoted(f.from)} to ${quoted(f.to)}: give each message flow between the same ends its own source`,
      );
    }
  }
}

/**
 * The name analyzr will show for a spec with several processes (the model
 * name of `apps/server/src/domain/ingest.ts`): that of the first process by
 * its id (`Process_<source>`), its pool's name, else its own name.
 */
function modelName(p: Problems, processes: readonly SpecProcess[]): void {
  if (processes.length < 2) return;
  const byId = processes.map((proc) => ({ proc, id: idFor(PREFIX.process, proc.source) }));
  byId.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const first = byId[0]?.proc;
  if (first === undefined) return;
  const name = [first.pool, first.name]
    .map((t) => (t === null ? '' : cleanLine(t).text))
    .find((t) => t !== '');
  p.warn(
    'processes',
    'model-name',
    name === undefined
      ? `analyzr shows the model without a name: its first process by id (${quoted(first.source)}) has neither pool nor name`
      : `analyzr names the model ${quoted(name)} after its first process by id (${quoted(first.source)})`,
  );
}

/**
 * The open-questions read model (M6 §4.2): its input, the index over the
 * head facts it reads, and the step from a draft (one source's item) to an
 * {@link OpenQuestion}: the id, `askWho` and `unlocks`. Pure: the use case
 * loads the input in one read snapshot (`use-cases/open-questions.ts`).
 */
import { createHash } from 'node:crypto';

import {
  OpenQuestionKind,
  isInformationalKind,
  parseRef,
  type Candidate,
  type Engine,
  type Fact,
  type Finding,
  type OpenQuestion,
  type OpenQuestionRaisedBy,
  type OpenQuestionSource,
  type OpenQuestionSubject,
  type ProcessInfo,
  type ProjectFacts,
  type Ref,
  type TypedPair,
  type ValueChainFinding,
} from '@analyzr/contracts';
import { quoteDe } from '@analyzr/relations';

import { isAssigned, pairKey, settles } from '../judgements.ts';
import type {
  PlacementRecord,
  RelationRecord,
  StoredAssertion,
  StoredNoLink,
  StoredPlacementAssertion,
} from '../ports.ts';
import { processHomes } from '../value-chain/findings.ts';
import { OUTSIDE } from '../value-chain/steps.ts';
import type { ChainStructure } from '../value-chain/structure.ts';

// ------------------------------------------------------------------ input

/** A live model's head as the read model needs it. */
export interface ModelHead {
  /** `bpmn:definitions` name or the first process name. */
  name: string | null;
  engine: Engine | null;
  /** `facts_hash` of the head revision: the source version of findings and signals. */
  factsHash: string;
  /** Seq of the head revision's ingest. */
  seq: number;
}

/** An agent's current `unsure` verdict on an open process (its input unchanged since). */
export interface UnsureVerdict {
  process: string;
  reason: string;
  /** The process's placement input hash the verdict was given on (the source version). */
  inputHash: string;
  handle: string;
  seq: number;
}

/** The live value chain, as far as open questions read it. */
export interface ChainInput {
  key: string;
  /** Seq of the head revision. */
  headSeq: number;
  structure: ChainStructure;
  /** The live generation of each element id, `@outside` included. */
  live: ReadonlyMap<string, number>;
  /** Every placement of the chain, obsolete ones included. */
  placements: readonly PlacementRecord[];
  histories: ReadonlyMap<string, readonly StoredPlacementAssertion[]>;
  /** The chain's findings (`valueChainFindings`). */
  findings: readonly ValueChainFinding[];
  /** Processes without an accepted placement on a live step. */
  open: readonly string[];
  /** Current unsure verdicts of open processes. */
  unsure: readonly UnsureVerdict[];
}

/**
 * The summary and uncovered pairs of a current submission: the latest done
 * task of a live model on its head facts (relations), or of the chain
 * (placement), under the procedure claims name now.
 */
export interface SubmissionNote {
  kind: 'relations' | 'placement';
  /** The analysed model's key (relations) or the value chain's key (placement). */
  subject: string;
  submissionId: string;
  handle: string;
  seq: number;
  summary: string | null;
  /** `uncovered` of a relations result: the count and the first pairs listed. */
  uncovered: { count: number; pairs: readonly TypedPair[] } | null;
}

/** Everything the read model reads, from one snapshot. */
export interface OpenQuestionInput {
  /** Head facts of every live model (`headProjectFacts`). */
  projectFacts: ProjectFacts;
  /** Every live model's head, by model key. */
  models: ReadonlyMap<string, ModelHead>;
  /** The rule tier's findings as clients see them (`visibleFindings`). */
  findings: readonly Finding[];
  /** Every relation that is not obsolete. */
  relations: readonly RelationRecord[];
  /** Their histories, by relation id. */
  histories: ReadonlyMap<string, readonly StoredAssertion[]>;
  /** Pair keys (`pairKey`) with a current agent judgement, a link or a no-link. */
  judged: ReadonlySet<string>;
  /** Live, current no-links. */
  noLinks: readonly StoredNoLink[];
  /** Every model's candidates (`generateCandidates` without a focus model). */
  candidates: readonly Candidate[];
  /** The live value chain with a head, if any. */
  chain: ChainInput | null;
  submissions: readonly SubmissionNote[];
}

// ------------------------------------------------------------------ index

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort(byCodePoint);

/**
 * What a draft is anchored to: its `askWho` and `unlocks` come from these.
 * Informational drafts (summary notes, descriptive models) anchor to their
 * model or the chain, which only count (the list ranks them last anyway).
 */
export interface Anchors {
  refs?: readonly string[];
  processes?: readonly string[];
  /** Steps the question is about: their owners are hints, their open placements count. */
  steps?: readonly string[];
  /** The step a placement is on: its owners are hints, nothing more. */
  placedOn?: readonly string[];
  /** Models the item is about as a whole: the open decisions at every element and process count. */
  models?: readonly string[];
  /** The value chain as a whole: its open processes and every live step's open placements count. */
  chain?: boolean;
}

/** One source's item before the id, `askWho` and `unlocks` are computed. */
export interface Draft {
  kind: OpenQuestionKind;
  source: OpenQuestionSource;
  subject: OpenQuestionSubject;
  subjectLabel: string;
  /** The source version: the id changes with it. */
  version: string;
  modelKeys: readonly string[];
  text: string;
  context?: string | null;
  label?: string | null;
  refs: readonly string[];
  raisedBy: OpenQuestionRaisedBy;
  anchors: Anchors;
}

interface ProcessEntry {
  ref: string;
  modelKey: string;
  info: ProcessInfo;
  /** The process fact (documentation, participant), if extracted. */
  fact: Fact | undefined;
  /** The process ref and the ref of every fact of the process. */
  refs: Set<string>;
}

/** Lookups over the input, built once per read. */
export class OpenQuestionIndex {
  readonly input: OpenQuestionInput;
  readonly factsByRef = new Map<string, Fact[]>();
  readonly processes = new Map<string, ProcessEntry>();
  /**
   * The process (ref) of each flow node the facts know: every fact's ref,
   * and the ids facts v1 only name (lane members, enclosing subprocesses,
   * boundary hosts, data store readers and writers), so that a message flow
   * to a collapsed subprocess or an intermediate none event is placed in its
   * process.
   */
  readonly processOfRef = new Map<string, string>();
  /** The enclosing (event) subprocess of an element, by ref. */
  private readonly parentOf = new Map<string, string>();
  /** Every fact ref and process ref of a model, by model key. */
  private readonly refsOfModel = new Map<string, Set<string>>();
  private readonly lanesOfRef = new Map<string, Set<string>>();
  private readonly lanesOfProcess = new Map<string, Set<string>>();
  /** Open decisions (pair keys) at each ref. */
  private readonly openPairs = new Map<string, Set<string>>();
  readonly openProcesses: ReadonlySet<string>;
  /** Pair keys of relations a decision settles. */
  readonly settled: ReadonlySet<string>;
  /** Live step generations each process is accepted on. */
  private readonly homes: ReadonlyMap<string, readonly string[]>;
  private readonly orgUnitNames = new Map<string, string>();

  constructor(input: OpenQuestionInput) {
    this.input = input;
    for (const model of input.projectFacts.models) {
      const modelRefs = new Set<string>();
      this.refsOfModel.set(model.modelKey, modelRefs);
      for (const info of model.processes) {
        modelRefs.add(info.ref);
        this.processes.set(info.ref, {
          ref: info.ref,
          modelKey: model.modelKey,
          info,
          fact: undefined,
          refs: new Set([info.ref]),
        });
      }
      const at = (id: string) => `${model.modelKey}#${id}`;
      // Flow nodes facts v1 only name: placed after the facts, which win.
      const named: [string, string][] = [];
      for (const f of model.facts) {
        this.factsByRef.set(f.ref, [...(this.factsByRef.get(f.ref) ?? []), f]);
        if (f.kind === 'process') {
          const entry = this.processes.get(f.ref);
          if (entry) entry.fact = f;
          continue;
        }
        if (f.processId === null) continue;
        const process = at(f.processId);
        const entry = this.processes.get(process);
        if (!entry) continue;
        const subprocess = f.attrs.subprocessId;
        if (subprocess !== undefined) named.push([at(subprocess), process]);
        if (f.kind === 'lane') {
          const lanes = this.lanesOfProcess.get(process) ?? new Set<string>();
          if (f.label !== '') lanes.add(f.label);
          this.lanesOfProcess.set(process, lanes);
          for (const id of f.attrs.flowNodeRefs ?? []) {
            const ref = at(id);
            const of = this.lanesOfRef.get(ref) ?? new Set<string>();
            if (f.label !== '') of.add(f.label);
            this.lanesOfRef.set(ref, of);
            named.push([ref, process]);
            // A lane of a subprocess lists that subprocess's elements.
            if (subprocess !== undefined && ref !== at(subprocess)) {
              this.parentOf.set(ref, at(subprocess));
            }
          }
          continue;
        }
        modelRefs.add(f.ref);
        entry.refs.add(f.ref);
        this.processOfRef.set(f.ref, process);
        if (subprocess !== undefined && f.ref !== at(subprocess)) {
          this.parentOf.set(f.ref, at(subprocess));
        }
        if (f.attrs.attachedTo !== undefined) named.push([at(f.attrs.attachedTo), process]);
        for (const id of [...(f.attrs.readBy ?? []), ...(f.attrs.writtenBy ?? [])]) {
          named.push([at(id), process]);
        }
      }
      for (const [ref, process] of named) {
        if (!this.processOfRef.has(ref)) this.processOfRef.set(ref, process);
      }
    }

    this.settled = new Set(input.relations.filter(settles).map((r) => pairKey(relationPair(r))));
    const open = (ref: string, key: string) => {
      const keys = this.openPairs.get(ref) ?? new Set<string>();
      keys.add(key);
      this.openPairs.set(ref, keys);
    };
    for (const c of input.candidates) {
      const key = pairKey(c);
      if (!isAssigned(c) || input.judged.has(key) || this.settled.has(key)) continue;
      open(c.from, key);
      open(c.to, key);
    }
    for (const r of input.relations) {
      if (r.status !== 'proposed' && r.status !== 'held') continue;
      // An end in a deleted model: no decision reaches it until the model is back.
      if (r.endpointState === 'missing') continue;
      const key = pairKey(relationPair(r));
      open(r.fromRef, key);
      open(r.toRef, key);
    }

    const chain = input.chain;
    this.openProcesses = new Set(chain?.open ?? []);
    this.homes = chain ? processHomes(chain.placements, chain.live).accepted : new Map();
    for (const unit of chain?.structure.orgUnits ?? []) {
      this.orgUnitNames.set(unit.elementId, unit.name);
    }
  }

  /** The model key of a ref. */
  modelOf(ref: string): string {
    return parseRef(ref).modelKey;
  }

  /** The facts at a ref (several kinds may share one element). */
  factsAt(ref: string): readonly Fact[] {
    return this.factsByRef.get(ref) ?? [];
  }

  /** Display name of a process: its name, else its pool's, else its id. */
  processName(processRef: string): string {
    const entry = this.processes.get(processRef);
    if (!entry) return parseRef(processRef).elementId;
    return entry.info.name ?? entry.info.participantName ?? entry.info.processId;
  }

  /** Display name of an element: a process's name, else the first non-empty label, else its id. */
  elementName(ref: string): string {
    if (this.processes.has(ref)) return this.processName(ref);
    const labelled = this.factsAt(ref).find((f) => f.label !== '');
    return labelled?.label ?? parseRef(ref).elementId;
  }

  /** `„Element“ in „Prozess“`, or just the element when it is a process or has none. */
  elementInProcess(ref: string): string {
    const process = this.processOfRef.get(ref);
    return process === undefined || process === ref
      ? quoteDe(this.elementName(ref))
      : `${quoteDe(this.elementName(ref))} in ${quoteDe(this.processName(process))}`;
  }

  /** Display name of a model: `„Name“ (key)`, or the key. */
  modelName(modelKey: string): string {
    const name = this.input.models.get(modelKey)?.name ?? null;
    return name === null || name === '' ? modelKey : `${quoteDe(name)} (${modelKey})`;
  }

  /** The name of a chain step, `außerhalb der Kette` for `@outside`. */
  stepName(elementId: string): string {
    if (elementId === OUTSIDE) return 'außerhalb der Kette';
    return quoteDe(this.input.chain?.structure.byId.get(elementId)?.name ?? elementId);
  }

  /** Head `facts_hash` of these models, sorted by key: the source version of rule items. */
  factsVersion(modelKeys: Iterable<string>): string {
    return sorted(modelKeys)
      .map((k) => `${k}=${this.input.models.get(k)?.factsHash ?? '-'}`)
      .join(',');
  }

  /** The seq of the newest head revision among these models (0 without one). */
  headSeq(modelKeys: Iterable<string>): number {
    let seq = 0;
    for (const k of modelKeys) seq = Math.max(seq, this.input.models.get(k)?.seq ?? 0);
    return seq;
  }

  /** The processes a draft's anchors stand for (its processes and the processes of its refs). */
  private anchorProcesses(anchors: Anchors): Set<string> {
    const out = new Set<string>(anchors.processes ?? []);
    for (const ref of anchors.refs ?? []) {
      const process = this.processOfRef.get(ref) ?? (this.processes.has(ref) ? ref : undefined);
      if (process !== undefined) out.add(process);
    }
    return out;
  }

  /** The org units owning a step's top-level step (decision 18). */
  private stepOwners(elementId: string): string[] {
    const step = this.input.chain?.structure.byId.get(elementId);
    const top = step
      ? this.input.chain?.structure.byId.get(step.pathIds[0] ?? step.elementId)
      : undefined;
    return (top?.ownerIds ?? []).map((id) => this.orgUnitNames.get(id) ?? id);
  }

  /**
   * The lanes containing an element: its own, else those of the nearest
   * enclosing subprocess in a named lane (a lane lists a subprocess, not the
   * elements inside it).
   */
  private lanesAt(ref: string): ReadonlySet<string> {
    const seen = new Set<string>();
    for (let at: string | undefined = ref; at !== undefined && !seen.has(at);) {
      seen.add(at);
      const lanes = this.lanesOfRef.get(at);
      if (lanes !== undefined && lanes.size > 0) return lanes;
      at = this.parentOf.get(at);
    }
    return new Set();
  }

  /** The contact hints of a draft (M6 §4.2 `askWho`). */
  askWho(draft: Draft): OpenQuestion['askWho'] {
    const { anchors } = draft;
    const lanes = new Set<string>();
    for (const ref of anchors.refs ?? []) {
      for (const lane of this.lanesAt(ref)) lanes.add(lane);
    }
    for (const process of anchors.processes ?? []) {
      for (const lane of this.lanesOfProcess.get(process) ?? []) lanes.add(lane);
    }
    const owners = new Set<string>();
    for (const process of this.anchorProcesses(anchors)) {
      for (const elementId of this.homes.get(process) ?? []) {
        for (const owner of this.stepOwners(elementId)) owners.add(owner);
      }
    }
    for (const elementId of [...(anchors.steps ?? []), ...(anchors.placedOn ?? [])]) {
      for (const owner of this.stepOwners(elementId)) owners.add(owner);
    }
    const home =
      anchors.refs?.[0] !== undefined
        ? this.modelOf(anchors.refs[0])
        : anchors.processes?.[0] !== undefined
          ? this.modelOf(anchors.processes[0])
          : draft.modelKeys[0];
    const slash = home?.indexOf('/') ?? -1;
    return {
      lanes: sorted(lanes),
      stepOwners: sorted(owners),
      folder: home !== undefined && slash > 0 ? home.slice(0, slash) : null,
    };
  }

  /** Open decisions touching a draft's anchors, 0 when none (M6 §4.2 `unlocks`). */
  unlocks(anchors: Anchors): number {
    const refs = new Set<string>(anchors.refs ?? []);
    const processes = new Set<string>(anchors.processes ?? []);
    for (const model of anchors.models ?? []) {
      for (const ref of this.refsOfModel.get(model) ?? []) {
        if (this.processes.has(ref)) processes.add(ref);
        else refs.add(ref);
      }
    }
    for (const process of processes) {
      for (const ref of this.processes.get(process)?.refs ?? [process]) refs.add(ref);
    }
    const pairs = new Set<string>();
    for (const ref of refs) for (const key of this.openPairs.get(ref) ?? []) pairs.add(key);
    let count = pairs.size;
    if (anchors.chain === true) for (const process of this.openProcesses) processes.add(process);
    for (const process of processes) if (this.openProcesses.has(process)) count++;
    const chain = this.input.chain;
    if (chain) {
      const steps = new Set(anchors.steps ?? []);
      for (const p of chain.placements) {
        if (anchors.chain !== true && !steps.has(p.elementId)) continue;
        if (chain.live.get(p.elementId) !== p.generation || p.endpointState === 'missing') continue;
        if (p.status === 'proposed' || p.status === 'held') count++;
      }
    }
    return count;
  }
}

/** The typed pair of a relation (`manual` relations keep their own type). */
function relationPair(r: Pick<RelationRecord, 'type' | 'fromRef' | 'toRef'>) {
  return { type: r.type, from: r.fromRef, to: r.toRef };
}

// -------------------------------------------------------------- ids, order

/** `q-` + the first 16 hex characters of `sha256(kind|subject|source version)` (M6 §4.2). */
export function openQuestionId(
  kind: OpenQuestionKind,
  subject: OpenQuestionSubject,
  version: string,
): string {
  const digest = createHash('sha256')
    .update(`${kind}|${subject.type}:${subject.id}|${version}`)
    .digest('hex');
  return `q-${digest.slice(0, 16)}`;
}

/** A draft as an open question (state `open`: answers come with S5a). */
export function finish(index: OpenQuestionIndex, draft: Draft): OpenQuestion {
  return {
    id: openQuestionId(draft.kind, draft.subject, draft.version),
    kind: draft.kind,
    source: draft.source,
    subject: draft.subject,
    subjectLabel: draft.subjectLabel,
    modelKeys: sorted(draft.modelKeys),
    text: draft.text,
    context: draft.context ?? null,
    label: draft.label ?? null,
    askWho: index.askWho(draft),
    unlocks: index.unlocks(draft.anchors),
    refs: sorted(draft.refs) as Ref[],
    raisedBy: draft.raisedBy,
    state: 'open',
  };
}

const KIND_RANK = new Map(OpenQuestionKind.options.map((k, i) => [k, i]));

/**
 * The sort position of an item: questions (0) before informational items
 * (1), `unlocks` (descending), subject id, kind, id.
 */
export type OpenQuestionPosition = readonly [number, number, string, number, string];

/** The cursor shape of a position (`decodeCursor`). */
export const POSITION_SHAPE = ['int', 'int', 'string', 'int', 'string'] as const;

export function positionOf(q: OpenQuestion): OpenQuestionPosition {
  return [
    isInformationalKind(q.kind) ? 1 : 0,
    q.unlocks,
    q.subject.id,
    KIND_RANK.get(q.kind) ?? 0,
    q.id,
  ];
}

/** Orders positions: questions first, `unlocks` descending, then subject id, kind and id ascending. */
export function comparePositions(a: OpenQuestionPosition, b: OpenQuestionPosition): number {
  return (
    a[0] - b[0] || b[1] - a[1] || byCodePoint(a[2], b[2]) || a[3] - b[3] || byCodePoint(a[4], b[4])
  );
}

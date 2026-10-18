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
  type AmendmentOp,
  type AmendmentPlanEntry,
  type Candidate,
  type Engine,
  type ExtractWarning,
  type Fact,
  type Finding,
  type ModelAmendmentId,
  type ModelId,
  type OpenQuestion,
  type OpenQuestionAnswer,
  type OpenQuestionGroup,
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
  StoredOpenQuestionAnswer,
  StoredPlacementAssertion,
} from '../ports.ts';
import { processHomes } from '../value-chain/findings.ts';
import { OUTSIDE } from '../value-chain/steps.ts';
import type { ChainStructure } from '../value-chain/structure.ts';
import { isLiveMark, toOpenQuestionAnswer } from './answers.ts';

// ------------------------------------------------------------------ input

/** A live model's head as the read model needs it. */
export interface ModelHead {
  /** The model's id (the amendment actions name it, M6 S5c-2). */
  modelId: ModelId;
  /** `bpmn:definitions` name or the first process name. */
  name: string | null;
  engine: Engine | null;
  /** `facts_hash` of the head revision: the source version of findings and signals. */
  factsHash: string;
  /** Seq of the head revision's ingest. */
  seq: number;
  /**
   * The head revision's stored extractor warnings (M6 S2a), when it has
   * any; absent for none and for revisions stored before S2a.
   */
  extractWarnings?: readonly ExtractWarning[];
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

/** A live amendment as the read model reads it (M6 S5c-2). */
export interface AmendmentInfo {
  id: ModelAmendmentId;
  elementId: string;
  viaElementId: string | null;
  op: AmendmentOp;
  before: string | null;
  after: string;
}

/**
 * A live model's amendments (M6 S5c-2): the uploaded revision its head is
 * computed from (the head itself when it is the uploaded revision), the
 * head's plan and the live amendments in seq order.
 */
export interface ModelAmendments {
  uploadedRevisionId: string;
  plan: readonly AmendmentPlanEntry[];
  live: readonly AmendmentInfo[];
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
  /**
   * Every recorded answer of the project, oldest first, with withdrawals (M6
   * S5a, S5c-1); an item is `answered` while a live outside mark names its id.
   */
  answers: readonly StoredOpenQuestionAnswer[];
  /**
   * The live models with live amendments, by model key (M6 S5c-2): their
   * conflicts are questions, and an `amend` replaces a live amendment.
   * Absent: no model has any.
   */
  amendments?: ReadonlyMap<string, ModelAmendments>;
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

/** A message flow end outside every process (a black box) seen from inside its file. */
export interface BoxFlow {
  /** The flow's other end. */
  inside: string;
  /** The flow goes from the inside end to the box. */
  outgoing: boolean;
  /** The flow's name, else its message's name. */
  name: string | null;
  /** The relation anchor of the inside end ({@link OpenQuestionIndex.anchorOf}), if any. */
  anchor: string | undefined;
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
  /** The question, short (UX2a). */
  text: string;
  /** Why it is asked (UX2a): from code, or an agent's verbatim reason; absent for none. */
  detail?: string | null;
  context?: string | null;
  label?: string | null;
  refs: readonly string[];
  raisedBy: OpenQuestionRaisedBy;
  anchors: Anchors;
  /**
   * A value chain finding while a placement waits for review on the chain
   * (`process-without-step`: of the process; `step-without-process`: on the
   * step or below it): the item's group is `proposal` (UX2a).
   */
  proposed?: boolean;
  /**
   * The ids of the coded no-link items merged into this one (`mergeCodedNoLinks`):
   * their notes and withdrawn marks show among its answers.
   */
  merged?: readonly string[];
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
  /** Every relation that is not obsolete, at each of its two refs. */
  readonly relationsAt = new Map<string, RelationRecord[]>();
  /** The process (ref) of each pool a process fact names (`attrs.participantId`), by the pool's ref. */
  readonly poolProcess = new Map<string, string>();
  /** Live step generations each process is accepted on. */
  private readonly homes: ReadonlyMap<string, readonly string[]>;
  private readonly orgUnitNames = new Map<string, string>();
  /** The recorded answers by item id, oldest first. */
  private readonly answersById = new Map<string, OpenQuestionAnswer[]>();

  constructor(input: OpenQuestionInput) {
    this.input = input;
    for (const a of input.answers) {
      const list = this.answersById.get(a.questionId) ?? [];
      list.push(toOpenQuestionAnswer(a));
      this.answersById.set(a.questionId, list);
    }
    for (const r of input.relations) {
      for (const ref of new Set([r.fromRef, r.toRef])) {
        const list = this.relationsAt.get(ref);
        if (list) list.push(r);
        else this.relationsAt.set(ref, [r]);
      }
    }
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
          if (f.attrs.participantId !== undefined) {
            this.poolProcess.set(at(f.attrs.participantId), f.ref);
          }
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

  /** The answers recorded for an item id, oldest first. */
  answersOf(id: string): readonly OpenQuestionAnswer[] {
    return this.answersById.get(id) ?? [];
  }

  /**
   * The live amendment of an op at an element of a model (M6 S5c-2): keyed by
   * the element, or opened from it (`viaElementId`, a message endpoint).
   */
  liveAmendmentAt(ref: string, op: AmendmentOp): AmendmentInfo | undefined {
    const { modelKey, elementId } = parseRef(ref);
    return this.input.amendments
      ?.get(modelKey)
      ?.live.find(
        (a) => a.op === op && (a.elementId === elementId || a.viaElementId === elementId),
      );
  }

  /** The process (ref) a ref lies in: its own for a process ref; `undefined` when unknown. */
  processOf(ref: string): string | undefined {
    return this.processOfRef.get(ref) ?? (this.processes.has(ref) ? ref : undefined);
  }

  /**
   * The ref that can carry a relation for a message flow end (M6 §4.8 a
   * "Anchors of a pool's flows"): the end itself when it has a head fact,
   * else its process (a flow node the facts name, through
   * {@link processOfRef}; a pool, through the process fact naming it as its
   * participant); `undefined` for an end without either (a flow between
   * two boxes).
   */
  anchorOf(end: string): string | undefined {
    if (this.factsAt(end).length > 0) return end;
    return this.processOfRef.get(end) ?? this.poolProcess.get(end);
  }

  /** The message flows of a black box's file that end at it, as seen from their other end. */
  boxFlows(box: string): BoxFlow[] {
    const model = this.input.projectFacts.models.find((m) => m.modelKey === this.modelOf(box));
    const out: BoxFlow[] = [];
    for (const flow of model?.messageFlows ?? []) {
      for (const [end, other, outgoing] of [
        [flow.to, flow.from, true],
        [flow.from, flow.to, false],
      ] as const) {
        if (end !== box) continue;
        const anchor = other === box ? undefined : this.anchorOf(other);
        out.push({ inside: other, outgoing, name: flow.name ?? flow.messageName, anchor });
      }
    }
    return out;
  }

  /**
   * The source version of an item by what it asks about (M6 §4.2, S5c-1):
   * each ref with the kinds and fingerprints of its head facts (`-` without
   * one), sorted, then the extras (what the question reads beyond the
   * facts). A change elsewhere in the model keeps it; a change at these refs
   * changes it.
   */
  factVersion(refs: Iterable<string>, extras: readonly string[] = []): string {
    const facts = sorted(refs).map((ref) => {
      const fps = this.factsAt(ref)
        .map((f) => `${f.kind}:${f.fingerprint}`)
        .sort(byCodePoint);
      return `${ref}=${fps.length === 0 ? '-' : fps.join('+')}`;
    });
    return [facts.join(','), ...extras].join('|');
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

  /**
   * The title of a process as its diagram shows it (UX2a): its pool's name,
   * else its own name, else its id; „Nordwind Handel – Einkauf“ rather than
   * „Bestellanforderung“.
   */
  poolTitle(processRef: string): string {
    const entry = this.processes.get(processRef);
    if (!entry) return parseRef(processRef).elementId;
    return entry.info.participantName ?? entry.info.name ?? entry.info.processId;
  }

  /** The name of a model (`bpmn:definitions` or its first process), else its key. */
  modelTitle(modelKey: string): string {
    const name = this.input.models.get(modelKey)?.name ?? null;
    return name === null || name === '' ? modelKey : name;
  }

  /**
   * What an item is about, in names (UX2a, the export's „Betrifft“): an
   * element in its pool or process („„Bestellung freigeben lassen“ in
   * „Nordwind Handel – Einkauf““), a process with its pool when that is named
   * otherwise, a relation's two ends each in theirs, a step on the value
   * chain; the subject label for the rest (a pool without a process, a
   * model, a placement, the chain).
   */
  concerns(q: Pick<OpenQuestion, 'subject' | 'subjectLabel'>): string {
    const at = (ref: string): string => {
      const process = this.processOf(ref);
      if (process === undefined) return quoteDe(this.elementName(ref));
      const title = this.poolTitle(process);
      const name = this.elementName(ref);
      return name === title ? quoteDe(name) : `${quoteDe(name)} in ${quoteDe(title)}`;
    };
    switch (q.subject.type) {
      case 'ref':
        return this.factsAt(q.subject.id).length > 0 ? at(q.subject.id) : q.subjectLabel;
      case 'process':
        return this.processes.has(q.subject.id) ? at(q.subject.id) : q.subjectLabel;
      case 'relation': {
        const r = this.input.relations.find((x) => x.id === q.subject.id);
        return r ? `${at(r.fromRef)} → ${at(r.toRef)}` : q.subjectLabel;
      }
      case 'step':
        return `${q.subjectLabel} auf der Wertschöpfungskette`;
      default:
        return q.subjectLabel;
    }
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

// ------------------------------------------------------------------ groups

/** What a kind's group may depend on: the item's source and whether the chain has a proposal for it. */
export interface GroupFacts {
  source: OpenQuestionSource;
  /** {@link Draft.proposed}. */
  proposed: boolean;
}

/** A kind's group, or how to tell it from the item. */
export type GroupRule = OpenQuestionGroup | ((item: GroupFacts) => OpenQuestionGroup);

/** `proposal` while the chain has a proposal for the item, else `ask`. */
const byProposal = ({ proposed }: GroupFacts): OpenQuestionGroup => (proposed ? 'proposal' : 'ask');

/**
 * The group of each kind (UX2a, UX-SIMPLIFICATION §2.4): where the item is
 * worked. A `Record` over every kind, so a new kind does not compile without
 * a group (and the unit test fails on an unmapped one). The agents' questions
 * are answered on their proposals (`agent`), summaries and descriptive models
 * inform (`info`); the value chain's `process-without-step` and
 * `step-without-process` are decided on the chain while it has a proposal for
 * them (`proposal`), and asked otherwise; everything else needs a human or
 * the customer to say what the landscape lacks (`ask`), whatever its source.
 */
export const OPEN_QUESTION_GROUP_RULES: Readonly<Record<OpenQuestionKind, GroupRule>> = {
  'call-target-unknown': 'ask',
  'call-target-dynamic': 'ask',
  'duplicate-process-id': 'ask',
  'message-partner-missing': 'ask',
  held: 'ask',
  'agent-question': 'agent',
  'placement-unsure': 'ask',
  'process-without-step': byProposal,
  'step-without-process': byProposal,
  'unresolved-link': 'ask',
  'external-partner': 'ask',
  'summary-note': 'info',
  unjudged: 'ask',
  'black-box-partner': 'ask',
  'unlabelled-boundary': 'ask',
  'message-without-name': 'ask',
  'undocumented-process': 'ask',
  'isolated-process': 'ask',
  'descriptive-model': 'info',
  'amendment-conflict': 'ask',
  'extractor-loss': 'ask',
};

/** The group of an item of this kind ({@link OPEN_QUESTION_GROUP_RULES}). */
export function groupOf(kind: OpenQuestionKind, facts: GroupFacts): OpenQuestionGroup {
  const rule = OPEN_QUESTION_GROUP_RULES[kind];
  return typeof rule === 'function' ? rule(facts) : rule;
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

/**
 * A draft as an open question: `answered` while a live outside mark names
 * its id (M6 S5c-1), with its answers (and the notes and withdrawn marks of
 * the items merged into it, oldest first) and its actions (`actionsOf`, the
 * read model passes `actionsFor` of `actions.ts`).
 */
export function finish(
  index: OpenQuestionIndex,
  draft: Draft,
  actionsOf: (item: OpenQuestion, index: OpenQuestionIndex) => OpenQuestion['actions'] = () => [],
): OpenQuestion {
  const id = openQuestionId(draft.kind, draft.subject, draft.version);
  const merged = (draft.merged ?? []).flatMap((m) =>
    index.answersOf(m).filter((a) => !isLiveMark(a)),
  );
  const answers = [...index.answersOf(id), ...merged].sort((a, b) => a.seq - b.seq);
  const item: OpenQuestion = {
    id,
    kind: draft.kind,
    source: draft.source,
    group: groupOf(draft.kind, { source: draft.source, proposed: draft.proposed === true }),
    subject: draft.subject,
    subjectLabel: draft.subjectLabel,
    modelKeys: sorted(draft.modelKeys),
    text: draft.text,
    detail: draft.detail ?? null,
    context: draft.context ?? null,
    label: draft.label ?? null,
    askWho: index.askWho(draft),
    unlocks: index.unlocks(draft.anchors),
    refs: sorted(draft.refs) as Ref[],
    raisedBy: draft.raisedBy,
    state: answers.some(isLiveMark) ? 'answered' : 'open',
    answers,
    actions: [],
  };
  item.actions = actionsOf(item, index);
  return item;
}

const KIND_RANK = new Map(OpenQuestionKind.options.map((k, i) => [k, i]));

/**
 * The group an item ranks in: questions (0), then the value chain's
 * findings (1: `process-without-step`, `step-without-process`,
 * `unresolved-link`, which shrink as placements are accepted; owner answer
 * 2026-10-16), then informational items (2: `summary-note`,
 * `descriptive-model`).
 */
export function rankGroup(q: Pick<OpenQuestion, 'kind' | 'source'>): number {
  if (isInformationalKind(q.kind)) return 2;
  return q.source === 'value-chain-finding' ? 1 : 0;
}

/**
 * The sort position of an item: its group ({@link rankGroup}), `unlocks`
 * (descending), subject id, kind, id.
 */
export type OpenQuestionPosition = readonly [number, number, string, number, string];

/** The cursor shape of a position (`decodeCursor`). */
export const POSITION_SHAPE = ['int', 'int', 'string', 'int', 'string'] as const;

export function positionOf(q: OpenQuestion): OpenQuestionPosition {
  return [rankGroup(q), q.unlocks, q.subject.id, KIND_RANK.get(q.kind) ?? 0, q.id];
}

/**
 * Orders positions: questions, then the value chain's findings, then
 * informational items; each group by `unlocks` descending, then subject id,
 * kind and id ascending.
 */
export function comparePositions(a: OpenQuestionPosition, b: OpenQuestionPosition): number {
  return (
    a[0] - b[0] || b[1] - a[1] || byCodePoint(a[2], b[2]) || a[3] - b[3] || byCodePoint(a[4], b[4])
  );
}

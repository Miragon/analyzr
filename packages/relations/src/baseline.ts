// baseline-label/1: purely label-based relation matching, the comparison
// baseline of eval:candidates (baseline-prefix/1 is the placement baseline):
// - search label = lowercase, every character outside [a-zA-Z0-9] and ASCII
//   whitespace → space, trim, split on whitespace, sort the words, join
//   without separator ("Antrag prüfen" → "antragfenpr");
// - events: every end and intermediate throw event connects to every start
//   and intermediate catch event of the project whose search label is equal
//   or within Levenshtein 4, whatever the event definitions, scopes or
//   processes (boundary events and send/receive tasks are not events here);
// - call activities connect to every process model whose name equals the
//   activity's label or whose search label is within Levenshtein 4;
//   `calledElement` is never read.
import type { DerivedRelation, ModelFacts, ProjectFacts, Ref } from '@analyzr/contracts';

import { fileStem } from './endpoints.ts';
import { compareStrings, compareTriples, round4 } from './order.ts';
import { levenshtein } from './text.ts';

/** Id of the label baseline in eval reports. */
export const LABEL_BASELINE = 'baseline-label/1';

/** Maximum Levenshtein distance between two search labels that still match. */
export const LABEL_BASELINE_MAX_DISTANCE = 4;

export type BaselineEventPosition = 'start' | 'end' | 'intermediate_throw' | 'intermediate_catch';

/** An event as the label baseline sees it. */
export interface BaselineEvent {
  ref: Ref;
  /** Ref of the owning process. */
  process: Ref;
  position: BaselineEventPosition;
  /** Element name; empty for an unnamed event, which never matches (a `null` search label). */
  label: string;
}

export interface BaselineOptions {
  /** Maximum Levenshtein distance between search labels (default 4). */
  maxDistance?: number;
  /**
   * Events the facts do not carry but the baseline matches: timer, conditional and
   * link catches; none, link, escalation and compensation throws; error,
   * escalation and compensation starts and ends. Supplied by a caller that
   * parsed the BPMN itself (the eval); refs already covered by a fact are
   * ignored.
   */
  extraEvents?: readonly BaselineEvent[];
}

const ASCII_WHITESPACE = /[ \t\n\v\f\r]+/;

/**
 * The normalized search label: lowercase, non-alphanumerics (umlauts
 * included) → space, words sorted and joined. `null` for no label.
 */
export function searchLabel(label: string | null): string | null {
  if (label === null) return null;
  const cleaned = label
    .toLowerCase()
    .replace(/[^a-zA-Z0-9 \t\n\v\f\r]/g, ' ')
    .trim()
    .replace(/[ \t\n\v\f\r]+/g, ' ');
  return cleaned
    .split(ASCII_WHITESPACE)
    .sort((a, b) => compareStrings(a, b))
    .join('');
}

const POSITION_BY_ELEMENT: Readonly<Record<string, BaselineEventPosition>> = {
  'bpmn:StartEvent': 'start',
  'bpmn:EndEvent': 'end',
  'bpmn:IntermediateThrowEvent': 'intermediate_throw',
  'bpmn:IntermediateCatchEvent': 'intermediate_catch',
};

/** The events of the facts the baseline matches (boundary events and tasks excluded). */
export function baselineEventsFromFacts(projectFacts: ProjectFacts): BaselineEvent[] {
  const out = new Map<Ref, BaselineEvent>();
  for (const model of projectFacts.models) {
    for (const f of model.facts) {
      const position = POSITION_BY_ELEMENT[f.attrs.elementType ?? ''];
      if (position === undefined || f.processId === null || out.has(f.ref)) continue;
      out.set(f.ref, {
        ref: f.ref,
        process: `${f.modelKey}#${f.processId}`,
        position,
        label: f.label,
      });
    }
  }
  return [...out.values()];
}

/**
 * The names call activities are matched against: in a file with more than
 * one pool (a collaboration) each participant's process is named after the
 * process (else its pool, else the pool id); any other file names its
 * processes after the file. Pools without a process are recognized by the
 * message flows that touch them; such pools and the collaboration container
 * itself have no process ref and are left out.
 */
export function labelBaselineProcessNames(model: ModelFacts): Map<Ref, string> {
  const elementIds = new Set(model.facts.map((f) => f.elementId));
  const participantOf = new Map<string, string>();
  for (const f of model.facts) {
    const participantId = f.attrs.participantId;
    if (f.kind === 'process' && typeof participantId === 'string') {
      participantOf.set(f.elementId, participantId);
    }
  }
  const pools = new Set(participantOf.values());
  for (const flow of model.messageFlows) {
    for (const ref of [flow.from, flow.to]) {
      const id = ref.slice(ref.indexOf('#') + 1);
      if (!elementIds.has(id)) pools.add(id);
    }
  }
  const collaboration = pools.size > 1;
  const names = new Map<Ref, string>();
  for (const p of model.processes) {
    names.set(
      p.ref,
      collaboration
        ? (p.name ?? p.participantName ?? participantOf.get(p.processId) ?? p.processId)
        : fileStem(model.modelKey),
    );
  }
  return names;
}

function within(a: string | null, b: string | null, max: number): number | null {
  if (a === null || b === null) return null;
  const d = a === b ? 0 : levenshtein(a, b);
  return d <= max ? d : null;
}

function confidence(distance: number, max: number): number {
  return distance === 0 ? 1 : round4(1 - distance / (max + 1));
}

/**
 * The label baseline (see the file header) over a project's
 * facts, as the baseline of the `eval:candidates` report. Event pairs get
 * type `message` or `signal` if either end is a message or signal element,
 * else `trigger`; call pairs type `call`. Everything is `proposed`, tier
 * `lexical`, confidence 1 for equal search labels and
 * `1 − distance / (maxDistance + 1)` otherwise. It links events of the same
 * process too. Deterministic: sorted by `(type, from, to)`.
 */
export function labelBaseline(
  projectFacts: ProjectFacts,
  options?: BaselineOptions,
): DerivedRelation[] {
  const max = options?.maxDistance ?? LABEL_BASELINE_MAX_DISTANCE;
  const kinds = new Map<Ref, Set<string>>();
  for (const m of projectFacts.models) {
    for (const f of m.facts) {
      const set = kinds.get(f.ref) ?? new Set<string>();
      set.add(f.kind);
      kinds.set(f.ref, set);
    }
  }
  const events = new Map<Ref, BaselineEvent>();
  for (const e of baselineEventsFromFacts(projectFacts)) events.set(e.ref, e);
  for (const e of options?.extraEvents ?? []) if (!events.has(e.ref)) events.set(e.ref, e);
  const sorted = [...events.values()].sort((a, b) => compareStrings(a.ref, b.ref));
  const label = (e: BaselineEvent): string | null => searchLabel(e.label === '' ? null : e.label);
  const throws = sorted.filter((e) => e.position === 'end' || e.position === 'intermediate_throw');
  const catches = sorted.filter(
    (e) => e.position === 'start' || e.position === 'intermediate_catch',
  );

  const out = new Map<string, DerivedRelation>();
  const add = (r: DerivedRelation): void => {
    out.set(`${r.type}|${r.from}|${r.to}`, r);
  };
  for (const t of throws) {
    const a = label(t);
    for (const c of catches) {
      const b = label(c);
      const d = within(a, b, max);
      if (d === null) continue;
      const k = new Set([...(kinds.get(t.ref) ?? []), ...(kinds.get(c.ref) ?? [])]);
      const type =
        k.has('msg_throw') || k.has('msg_catch')
          ? 'message'
          : k.has('sig_throw') || k.has('sig_catch')
            ? 'signal'
            : 'trigger';
      add({
        type,
        from: t.ref,
        to: c.ref,
        status: 'proposed',
        tier: 'lexical',
        confidence: confidence(d, max),
        attrs: { algorithm: LABEL_BASELINE, distance: d, searchLabels: [a, b] },
      });
    }
  }

  const processes: Array<{ ref: Ref; name: string }> = [];
  for (const m of projectFacts.models) {
    for (const [ref, name] of labelBaselineProcessNames(m)) processes.push({ ref, name });
  }
  processes.sort((a, b) => compareStrings(a.ref, b.ref));
  for (const m of projectFacts.models) {
    for (const call of m.facts) {
      if (call.kind !== 'call' || call.label === '') continue;
      const a = searchLabel(call.label);
      for (const p of processes) {
        const d = p.name === call.label ? 0 : within(a, searchLabel(p.name), max);
        if (d === null) continue;
        add({
          type: 'call',
          from: call.ref,
          to: p.ref,
          status: 'proposed',
          tier: 'lexical',
          confidence: confidence(d, max),
          attrs: { algorithm: LABEL_BASELINE, distance: d, searchLabels: [a, searchLabel(p.name)] },
        });
      }
    }
  }
  return [...out.values()].sort(compareTriples);
}

/**
 * The sources that exist today (M6 §4.1), mapped to open questions: relation
 * findings, value chain findings, holds, agents' questions, unsure placement
 * verdicts, coded no-links, submission summaries and uncovered pairs. Texts
 * from code are German questions; human and agent texts stay verbatim.
 * Pure.
 */
import {
  parseRef,
  type FindingKind,
  type OpenQuestionKind,
  type SourceKind,
  type TypedPair,
  type ValueChainFinding,
} from '@analyzr/contracts';
import { quoteDe } from '@analyzr/relations';

import { pairKey } from '../judgements.ts';
import type {
  PlacementRecord,
  RelationRecord,
  StoredAssertion,
  StoredPlacementAssertion,
} from '../ports.ts';
import { currentStances, decisionsInForce } from '../status.ts';
import { placementBasisOf } from '../value-chain/placement-state.ts';
import { basisOf } from '../views.ts';
import type { Draft, OpenQuestionIndex } from './model.ts';

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort(byCodePoint);
const nonEmpty = (text: string | null | undefined): text is string =>
  text !== null && text !== undefined && text.trim() !== '';

const FINDING_KINDS: Readonly<Record<FindingKind, OpenQuestionKind>> = {
  'unresolved-call': 'call-target-unknown',
  'dynamic-call': 'call-target-dynamic',
  'duplicate-process-id': 'duplicate-process-id',
  'dangling-throw': 'message-partner-missing',
  'unmatched-catch': 'message-partner-missing',
};

/**
 * The rule tier's findings (`visibleFindings`): one question each, versioned
 * by what it asks about (M6 §4.2, S5c-1): the facts at its refs (the call,
 * the endpoint, the copies of a duplicated process id with their process
 * facts), so a change elsewhere in the model keeps the id.
 */
export function findingQuestions(ix: OpenQuestionIndex): Draft[] {
  return ix.input.findings.map((f): Draft => {
    const models = sorted(f.refs.map((r) => ix.modelOf(r)));
    const [first] = f.refs;
    if (first === undefined) throw new Error(`finding ${f.kind} without refs`);
    const raisedBy = { sourceKind: 'rule' as const, handle: null, seq: ix.headSeq(models) };
    const base = {
      kind: FINDING_KINDS[f.kind],
      source: 'finding' as const,
      version: ix.factVersion(f.refs),
      modelKeys: models,
      refs: f.refs,
      raisedBy,
    };
    switch (f.kind) {
      case 'duplicate-process-id': {
        const id = parseRef(first).elementId;
        return {
          ...base,
          subject: { type: 'process', id: first },
          subjectLabel: `Prozess-ID ${quoteDe(id)}`,
          text: `Welcher Prozess mit der ID ${quoteDe(id)} gilt, und sind die anderen Kopien, Varianten oder veraltet? ${f.detail}`,
          anchors: { processes: f.refs },
        };
      }
      case 'unresolved-call':
      case 'dynamic-call': {
        const runtime = f.kind === 'dynamic-call' ? ' zur Laufzeit' : '';
        return {
          ...base,
          subject: { type: 'ref', id: first },
          subjectLabel: quoteDe(ix.elementName(first)),
          text: `Welchen Prozess ruft ${ix.elementInProcess(first)}${runtime} auf? ${f.detail}`,
          anchors: { refs: [first] },
        };
      }
      case 'dangling-throw':
      case 'unmatched-catch': {
        const at = ix.elementInProcess(first);
        const throws = f.kind === 'dangling-throw';
        const question = isSignalFinding(ix, first, f.detail)
          ? throws
            ? `Wer fängt das Signal, das ${at} wirft?`
            : `Wer wirft das Signal, das ${at} fängt?`
          : throws
            ? `Wer empfängt, was ${at} sendet?`
            : `Wer sendet, was ${at} empfängt?`;
        return {
          ...base,
          subject: { type: 'ref', id: first },
          subjectLabel: quoteDe(ix.elementName(first)),
          text: `${question} ${f.detail}`,
          anchors: { refs: [first] },
        };
      }
    }
  });
}

/**
 * Whether a `dangling-throw` or `unmatched-catch` finding is about a signal
 * (the rule tier raises both for messages and signals): the element has only
 * signal facts, or, with both kinds (several event definitions), the detail
 * names a signal.
 */
function isSignalFinding(ix: OpenQuestionIndex, ref: string, detail: string): boolean {
  const kinds = new Set(ix.factsAt(ref).map((f) => f.kind));
  const signal = kinds.has('sig_throw') || kinds.has('sig_catch');
  const message = kinds.has('msg_throw') || kinds.has('msg_catch');
  if (signal !== message) return signal;
  return /^(?:Ein )?Signal\b/.test(detail);
}

/**
 * The value chain's findings (M4 §3.4): one question each, versioned by what
 * it asks about (`process-without-step`: the process fact, since S5c-1; a
 * step finding: the step's fingerprint, with the link). A process whose
 * placement is held asks nothing here (M6 §4.8 a): the hold's own item asks
 * it, one question per process.
 */
export function chainFindingQuestions(ix: OpenQuestionIndex): Draft[] {
  const chain = ix.input.chain;
  if (!chain) return [];
  return chain.findings.flatMap((f: ValueChainFinding): Draft[] => {
    if (f.kind === 'process-without-step') {
      if (f.process === null || f.state === 'held') return [];
      const model = ix.modelOf(f.process);
      return [
        {
          kind: 'process-without-step',
          source: 'value-chain-finding',
          subject: { type: 'process', id: f.process },
          subjectLabel: quoteDe(ix.processName(f.process)),
          version: ix.factVersion([f.process]),
          modelKeys: [model],
          text: `Zu welchem Schritt der Wertschöpfungskette gehört ${quoteDe(ix.processName(f.process))}? ${f.detail}`,
          refs: [f.process],
          raisedBy: {
            sourceKind: 'rule',
            handle: null,
            seq: Math.max(chain.headSeq, ix.headSeq([model])),
          },
          anchors: { processes: [f.process] },
        },
      ];
    }
    if (f.elementId === null) return [];
    const step = chain.structure.byId.get(f.elementId);
    const fingerprint = step?.fingerprint ?? '-';
    const stepName = ix.stepName(f.elementId);
    const common = {
      source: 'value-chain-finding' as const,
      subject: { type: 'step' as const, id: f.elementId },
      subjectLabel: stepName,
      modelKeys: [],
      refs: [],
      raisedBy: { sourceKind: 'rule' as const, handle: null, seq: chain.headSeq },
      anchors: { steps: [f.elementId] },
    };
    return f.kind === 'step-without-process'
      ? [
          {
            ...common,
            kind: 'step-without-process',
            version: fingerprint,
            text: `Welche Prozesse gehören zu ${stepName}? ${f.detail}`,
          },
        ]
      : [
          {
            ...common,
            kind: 'unresolved-link',
            version: `${fingerprint}|${f.link ?? ''}`,
            text: `Auf welchen Prozess soll der Link von ${stepName} zeigen? ${f.detail}`,
          },
        ];
  });
}

/** The raiser of a human or agent assertion. */
function raiser(a: { sourceKind: SourceKind; handle: string; seq: number }) {
  return { sourceKind: a.sourceKind, handle: a.handle, seq: a.seq };
}

/**
 * A relation a decision can still settle: both ends in the head facts (a
 * relation with a deleted model waits for that model, CONCEPT §2).
 */
const decidable = (r: RelationRecord): boolean => r.endpointState !== 'missing';

/**
 * Placements of the live chain that can still progress: on the live
 * generation of their step (a step a later revision removed or replaced
 * keeps its placements, which no decision reaches any more).
 */
function livePlacements(ix: OpenQuestionIndex): readonly PlacementRecord[] {
  const chain = ix.input.chain;
  if (!chain) return [];
  return chain.placements.filter(
    (p) => chain.live.get(p.elementId) === p.generation && p.endpointState !== 'missing',
  );
}

/**
 * Holds (decision 10): a held relation or placement, with the hold's
 * question as the text (else its note), the note as context when there is a
 * question, and the label.
 */
export function holdQuestions(ix: OpenQuestionIndex): Draft[] {
  const out: Draft[] = [];
  const hold = (
    basis: StoredAssertion | StoredPlacementAssertion | null,
  ): { text: string; context: string | null; label: string | null } | null => {
    if (basis?.verdict !== 'hold') return null;
    const note = basis.rationale ?? '';
    return nonEmpty(basis.question)
      ? { text: basis.question, context: nonEmpty(note) ? note : null, label: basis.label }
      : { text: note, context: null, label: basis.label };
  };
  for (const r of ix.input.relations) {
    if (r.status !== 'held' || !decidable(r)) continue;
    const basis = basisOf(ix.input.histories.get(r.id) ?? []);
    const texts = hold(basis);
    if (!basis || !texts) continue;
    out.push({
      kind: 'held',
      source: 'hold',
      subject: { type: 'relation', id: r.id },
      subjectLabel: `${quoteDe(ix.elementName(r.fromRef))} → ${quoteDe(ix.elementName(r.toRef))}`,
      version: basis.id,
      modelKeys: [ix.modelOf(r.fromRef), ix.modelOf(r.toRef)],
      ...texts,
      refs: [r.fromRef, r.toRef],
      raisedBy: raiser(basis),
      anchors: { refs: [r.fromRef, r.toRef] },
    });
  }
  const chain = ix.input.chain;
  for (const p of livePlacements(ix)) {
    if (p.status !== 'held') continue;
    const basis = placementBasisOf(chain?.histories.get(p.id) ?? []);
    const texts = hold(basis);
    if (!basis || !texts) continue;
    out.push({
      kind: 'held',
      source: 'hold',
      subject: { type: 'placement', id: p.id },
      subjectLabel: placementLabel(ix, p.processRef, p.elementId),
      version: basis.id,
      modelKeys: [ix.modelOf(p.processRef)],
      ...texts,
      refs: [p.processRef],
      raisedBy: raiser(basis),
      anchors: { processes: [p.processRef], placedOn: [p.elementId] },
    });
  }
  return out;
}

function placementLabel(ix: OpenQuestionIndex, processRef: string, elementId: string): string {
  const step = ix.stepName(elementId);
  return `${quoteDe(ix.processName(processRef))} ${step.startsWith('außerhalb') ? step : `auf ${step}`}`;
}

/**
 * Agents' questions (procedures §9): the question of each live agent
 * proposal on a relation or placement waiting for review, made after the
 * latest decision in force (a proposal from before a rejection that another
 * proposal reopened is answered by that rejection).
 */
export function agentQuestions(ix: OpenQuestionIndex): Draft[] {
  const out: Draft[] = [];
  const asked = <T extends StoredAssertion | StoredPlacementAssertion>(history: readonly T[]) => {
    const decided = decisionsInForce(history).at(-1)?.seq ?? -1;
    return currentStances(history).filter(
      (a): a is T & { question: string } =>
        a.kind === 'proposal' &&
        a.sourceKind === 'agent' &&
        a.seq > decided &&
        nonEmpty(a.question),
    );
  };
  for (const r of ix.input.relations) {
    if (r.status !== 'proposed' || !decidable(r)) continue;
    for (const a of asked(ix.input.histories.get(r.id) ?? [])) {
      out.push({
        kind: 'agent-question',
        source: 'agent-question',
        subject: { type: 'relation', id: r.id },
        subjectLabel: `${quoteDe(ix.elementName(r.fromRef))} → ${quoteDe(ix.elementName(r.toRef))}`,
        version: a.id,
        modelKeys: [ix.modelOf(r.fromRef), ix.modelOf(r.toRef)],
        text: a.question,
        refs: [r.fromRef, r.toRef],
        raisedBy: raiser(a),
        anchors: { refs: [r.fromRef, r.toRef] },
      });
    }
  }
  const chain = ix.input.chain;
  for (const p of livePlacements(ix)) {
    if (p.status !== 'proposed') continue;
    for (const a of asked(chain?.histories.get(p.id) ?? [])) {
      out.push({
        kind: 'agent-question',
        source: 'agent-question',
        subject: { type: 'placement', id: p.id },
        subjectLabel: placementLabel(ix, p.processRef, p.elementId),
        version: a.id,
        modelKeys: [ix.modelOf(p.processRef)],
        text: a.question,
        refs: [p.processRef],
        raisedBy: raiser(a),
        anchors: { processes: [p.processRef], placedOn: [p.elementId] },
      });
    }
  }
  return out;
}

/** The agent's current unsure verdicts on open processes (M4 §3.2). */
export function unsureQuestions(ix: OpenQuestionIndex): Draft[] {
  return (ix.input.chain?.unsure ?? []).map((u) => ({
    kind: 'placement-unsure',
    source: 'unsure',
    subject: { type: 'process', id: u.process },
    subjectLabel: quoteDe(ix.processName(u.process)),
    version: u.inputHash,
    modelKeys: [ix.modelOf(u.process)],
    text: u.reason,
    refs: [u.process],
    raisedBy: { sourceKind: 'agent', handle: u.handle, seq: u.seq },
    anchors: { processes: [u.process] },
  }));
}

/**
 * The no-link codes that carry gap information (relations procedure §11),
 * and their kinds. A `Map`: the code is agent text, so a lookup must never
 * reach an inherited property (`constructor:`).
 */
export const GAP_NO_LINK_CODES: ReadonlyMap<string, OpenQuestionKind> = new Map([
  ['call-target', 'call-target-unknown'],
  ['collaboration', 'external-partner'],
]);

/** The code of a no-link reason (`<code>: <sentence>`), lowercased; `null` without one. */
export function noLinkCode(reason: string): string | null {
  const m = /^\s*([A-Za-z][A-Za-z-]*)\s*:/.exec(reason);
  return m?.[1] ? m[1].toLowerCase() : null;
}

/**
 * No-links coded `call-target` or `collaboration` (`no-evidence` mixes
 * "nothing connects" and "information missing", so it stays out), one
 * question per kind and subject: the call of a `call-target` no-link, and
 * for `collaboration` the end with a message flow in its own file (else the
 * `from` end). The text lists the distinct reasons verbatim. Versioned by
 * the subject's facts, not the no-link ids (M6 §4.2, S5c-1), so a
 * re-judgement that stores new no-links with the same code keeps the item
 * (and its outside mark); the prefix keeps a no-link `call-target-unknown`
 * apart from the finding on the same call.
 */
export function noLinkQuestions(ix: OpenQuestionIndex): Draft[] {
  const flowEnds = new Set<string>();
  for (const m of ix.input.projectFacts.models) {
    for (const f of m.messageFlows) {
      flowEnds.add(f.from);
      flowEnds.add(f.to);
    }
  }
  const groups = new Map<
    string,
    { kind: OpenQuestionKind; subject: string; items: (typeof ix.input.noLinks)[number][] }
  >();
  for (const n of ix.input.noLinks) {
    const code = noLinkCode(n.reason);
    const kind = code === null ? undefined : GAP_NO_LINK_CODES.get(code);
    if (kind === undefined) continue;
    const subject =
      kind === 'external-partner' && !flowEnds.has(n.fromRef) && flowEnds.has(n.toRef)
        ? n.toRef
        : n.fromRef;
    const key = `${kind}\u0000${subject}`;
    const group = groups.get(key) ?? { kind, subject, items: [] };
    group.items.push(n);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ kind, subject, items }): Draft => {
    const refs = sorted(items.flatMap((n) => [n.fromRef, n.toRef]));
    return {
      kind,
      source: 'no-link',
      subject: { type: 'ref', id: subject },
      subjectLabel: quoteDe(ix.elementName(subject)),
      version: `no-link|${ix.factVersion([subject])}`,
      modelKeys: refs.map((r) => ix.modelOf(r)),
      text: sorted(items.map((n) => n.reason.trim())).join('\n'),
      refs,
      raisedBy: {
        sourceKind: 'agent',
        handle: sorted(items.map((n) => n.handle)).join(', '),
        seq: Math.max(...items.map((n) => n.seq)),
      },
      anchors: { refs: [subject] },
    };
  });
}

/** Pairs listed in a question's text; the refs carry them all. */
const LISTED_PAIRS = 5;

/**
 * Whether an accepted relation of any type joins the pair's two refs, in
 * either direction: a human's link (a `manual` relation from „Paar
 * verknüpfen …“, M6 S5c-1) answers the pair, although it settles only its
 * own pair key and judge-once still assigns the typed pair. Read model only.
 */
function linkedPair(ix: OpenQuestionIndex, p: TypedPair): boolean {
  return (ix.relationsAt.get(p.from) ?? []).some(
    (r) =>
      r.status === 'accepted' &&
      ((r.fromRef === p.from && r.toRef === p.to) || (r.fromRef === p.to && r.toRef === p.from)),
  );
}

/**
 * The pairs a current relations submission left unjudged that still have no
 * current judgement, settling decision or accepted relation between their
 * refs, with both ends in the head facts.
 */
function stillUncovered(ix: OpenQuestionIndex, pairs: readonly TypedPair[]): TypedPair[] {
  return pairs.filter((p) => {
    const key = pairKey(p);
    return (
      !ix.input.judged.has(key) &&
      !ix.settled.has(key) &&
      !linkedPair(ix, p) &&
      ix.factsAt(p.from).length > 0 &&
      ix.factsAt(p.to).length > 0
    );
  });
}

/** The still uncovered pairs of the current relations submission of a model (the `unjudged` item's pairs). */
export function openUncoveredPairs(ix: OpenQuestionIndex, modelKey: string): TypedPair[] {
  const s = ix.input.submissions.find((x) => x.kind === 'relations' && x.subject === modelKey);
  return s?.uncovered ? stillUncovered(ix, s.uncovered.pairs) : [];
}

/**
 * The summaries of current submissions (decision 24.9: shown read-only) and
 * the assigned pairs a current relations submission left unjudged that still
 * have no current judgement or settling decision.
 */
export function submissionQuestions(ix: OpenQuestionIndex): Draft[] {
  const out: Draft[] = [];
  for (const s of ix.input.submissions) {
    const raisedBy = { sourceKind: 'agent' as const, handle: s.handle, seq: s.seq };
    const relations = s.kind === 'relations';
    if (nonEmpty(s.summary)) {
      out.push({
        kind: 'summary-note',
        source: 'summary',
        subject: relations
          ? { type: 'model', id: s.subject }
          : { type: 'value-chain', id: s.subject },
        subjectLabel: relations
          ? ix.modelName(s.subject)
          : `Wertschöpfungskette ${quoteDe(ix.input.chain?.structure.name ?? s.subject)}`,
        version: s.submissionId,
        modelKeys: relations ? [s.subject] : [],
        text: s.summary.trim(),
        refs: [],
        raisedBy,
        // Informational: read-only (decision 24.9), it asks nothing itself and ranks last;
        // it counts the open decisions of the model or the chain it sums up.
        anchors: relations ? { models: [s.subject] } : { chain: true },
      });
    }
    if (!relations || !s.uncovered) continue;
    // Still unjudged, unsettled and with both ends in the head facts.
    const open = stillUncovered(ix, s.uncovered.pairs);
    if (open.length === 0) continue;
    const listed = open
      .slice(0, LISTED_PAIRS)
      .map((p) => `${ix.elementInProcess(p.from)} → ${ix.elementInProcess(p.to)}`);
    const more = open.length > LISTED_PAIRS ? `, und ${open.length - LISTED_PAIRS} weitere` : '';
    const unlisted = s.uncovered.count - s.uncovered.pairs.length;
    const refs = sorted(open.flatMap((p) => [p.from, p.to]));
    out.push({
      kind: 'unjudged',
      source: 'unjudged',
      subject: { type: 'model', id: s.subject },
      subjectLabel: ix.modelName(s.subject),
      version: s.submissionId,
      modelKeys: refs.map((r) => ix.modelOf(r)).concat(s.subject),
      text:
        `Gehören diese Paare zusammen? Die Analyse von ${ix.modelName(s.subject)} hat ` +
        `${open.length === 1 ? 'ein zugewiesenes Paar' : `${open.length} zugewiesene Paare`} ` +
        `ohne Urteil gelassen, und noch kein Agent hat ${open.length === 1 ? 'es' : 'sie'} bewertet: ` +
        `${listed.join('; ')}${more}.` +
        (unlisted > 0 ? ` ${unlisted} weitere hat die Analyse nicht aufgeführt.` : ''),
      refs,
      raisedBy,
      // The analysed model's ends: its lanes and folder are whom to ask.
      anchors: { refs: refs.filter((r) => ix.modelOf(r) === s.subject) },
    });
  }
  return out;
}

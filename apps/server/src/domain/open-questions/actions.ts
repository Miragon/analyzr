/**
 * Answering by action (M6 §4.8 a, S5c-1), the pure part: the actions each
 * open question offers ({@link actionsFor}), the read model's rules R1
 * (an item whose anchors a human, an owner's rule or the rule tier linked
 * by an accepted relation to another process, in the direction a link
 * takes, leaves the list) and R1b (a duplicated process id leaves it while
 * no call towards its copies waits for a decision), what a `link` writes or
 * accepts ({@link linkPlan}, {@link linkSteps}, the same rule as the
 * pickers' suggestions), and the German rationales from code. The use case (`use-cases/open-questions.ts`) runs
 * the actions through the use cases that exist.
 *
 * Model amendments (S5c-2, §4.8 a): `amend` is the primary action of a call
 * without a target, a nameless message or signal endpoint, unnamed start or
 * end events and an undocumented process, and a secondary one on a call
 * whose target names no process and on a named endpoint (never over an
 * expression in either dialect); an `amendment-conflict` offers
 * `withdraw-amendment` first and, where the incoming value does not resolve
 * (a call target naming no process, a name pairing with nothing), „Meine
 * Ergänzung behalten“.
 */
import {
  AMENDABLE_ELEMENT_LABELS,
  AMENDED_HINT,
  MAX_AMENDMENT_ITEMS,
  OPEN_QUESTION_ACTION_LABELS as LABEL,
  OPEN_QUESTION_KIND_LABELS,
  OUTSIDE_STEP,
  amendmentFieldLabel,
  endpointTypeLabel,
  formatRef,
  isInformationalKind,
  parseRef,
  type AmendableElementKind,
  type Fact,
  type ModelAmendmentId,
  type OpenQuestion,
  type OpenQuestionAction,
  type OpenQuestionAmendTarget,
  type OpenQuestionDecisionItem,
  type OpenQuestionKind,
  type OpenQuestionLinkProposal,
  type OpenQuestionPick,
  type OpenQuestionSubject,
  type OpenQuestionWithdrawCompare,
  type Ref,
} from '@analyzr/contracts';
import { quoteDe } from '@analyzr/relations';

import type { RelationRecord } from '../ports.ts';
import { incomingValue } from './amendment-questions.ts';
import { openQuestionId, type AmendmentInfo, type OpenQuestionIndex } from './model.ts';
import { openUncoveredPairs } from './sources.ts';

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort(byCodePoint);

/**
 * A call target or message name written as an expression in either dialect
 * (FEEL `=…`, JUEL `${…}` or `#{…}`), whatever the engine: facts v1 treat
 * only JUEL as dynamic without an engine, so an engine-null
 * `calledElement="=x"` arrives as an unresolved static call. S5c-2 never
 * offers an amendment over such a value (§4.8 a).
 */
export function isExpression(value: string): boolean {
  return /^\s*=/.test(value) || value.includes('${') || value.includes('#{');
}

/** A proposed or held relation of a rule tier or an agent (not `manual`) that a decision can reach. */
const liveTyped = (r: RelationRecord): boolean =>
  r.type !== 'manual' &&
  (r.status === 'proposed' || r.status === 'held') &&
  r.endpointState !== 'missing';

/** The process of a ref, or the ref itself when it lies in none. */
function processKey(ix: OpenQuestionIndex, ref: string): string {
  return ix.processOf(ref) ?? ref;
}

/**
 * An anchor of an item (§4.8 a "Anchors of a pool's flows") with the
 * direction a link at it takes: from the anchor (`outgoing`), or towards it
 * (an endpoint that only catches; the inside end of a flow from a pool).
 */
export interface DirectedAnchor {
  ref: string;
  outgoing: boolean;
}

/**
 * Kinds that ask about a message or signal partner: a `call` relation never
 * answers them (a call into a pool's process, or from a call activity with a
 * message flow, says nothing about the flow's partner).
 */
const PARTNER_KINDS: ReadonlySet<OpenQuestionKind> = new Set([
  'black-box-partner',
  'external-partner',
  'message-partner-missing',
  'message-without-name',
]);

/**
 * Whether a relation answers the item at this anchor: it leaves an
 * outgoing anchor or arrives at an incoming one (the direction `link`
 * writes in), and it is no `call` for a partner question. R1, the
 * suggestions and `link` all go by it.
 */
function answersAt(kind: OpenQuestionKind, anchor: DirectedAnchor, r: RelationRecord): boolean {
  if (PARTNER_KINDS.has(kind) && r.type === 'call') return false;
  if (r.fromRef === r.toRef) return false;
  return anchor.outgoing ? r.fromRef === anchor.ref : r.toRef === anchor.ref;
}

/** The end of a relation away from the anchor. */
const otherEnd = (anchor: DirectedAnchor, r: RelationRecord): string =>
  anchor.outgoing ? r.toRef : r.fromRef;

const THROWS = new Set(['msg_throw', 'sig_throw']);
const CATCHES = new Set(['msg_catch', 'sig_catch']);

/** Whether a link at this endpoint points towards it (it only catches). */
function incoming(ix: OpenQuestionIndex, ref: string): boolean {
  const kinds = ix.factsAt(ref).map((f) => f.kind);
  return !kinds.some((k) => THROWS.has(k)) && kinds.some((k) => CATCHES.has(k));
}

/**
 * The anchors a `link` on the item writes from, with their direction
 * (§4.8 a): one per anchor and direction of a pool's flows
 * (`black-box-partner`, directed like the flow; ends without an anchor left
 * out); the endpoint for `message-partner-missing`, `message-without-name`
 * and `external-partner` (towards it when it only catches, else from it);
 * the subject otherwise (the call, the process), outgoing.
 */
export function directedAnchors(
  ix: OpenQuestionIndex,
  kind: OpenQuestionKind,
  subject: OpenQuestionSubject,
): DirectedAnchor[] {
  switch (kind) {
    case 'black-box-partner': {
      const out = new Map<string, DirectedAnchor>();
      for (const f of ix.boxFlows(subject.id)) {
        if (f.anchor !== undefined) {
          out.set(`${f.anchor}\u0000${f.outgoing}`, { ref: f.anchor, outgoing: f.outgoing });
        }
      }
      return [...out.values()].sort(
        (a, b) => byCodePoint(a.ref, b.ref) || Number(b.outgoing) - Number(a.outgoing),
      );
    }
    case 'message-partner-missing':
    case 'message-without-name':
    case 'external-partner':
      return [{ ref: subject.id, outgoing: !incoming(ix, subject.id) }];
    default:
      return [{ ref: subject.id, outgoing: true }];
  }
}

/**
 * The directed anchors R1 checks (§4.8 a): the call (`call-target-*`), the
 * coded end (`external-partner`), the anchors of a pool's flows
 * (`black-box-partner`); `null` for kinds R1 does not apply to.
 */
export function linkAnchors(
  ix: OpenQuestionIndex,
  kind: OpenQuestionKind,
  subject: OpenQuestionSubject,
): DirectedAnchor[] | null {
  switch (kind) {
    case 'call-target-unknown':
    case 'call-target-dynamic':
    case 'external-partner':
    case 'black-box-partner':
      return directedAnchors(ix, kind, subject);
    default:
      return null;
  }
}

/**
 * Whether a relation's other end matches a link target: the target itself,
 * or for a process picker any ref inside the target process (the picker is
 * coarse; the preview names each proposal it accepts).
 */
function matchesTarget(
  ix: OpenQuestionIndex,
  pick: OpenQuestionPick | undefined,
  target: string,
  other: string,
): boolean {
  return other === target || (pick === 'process' && processKey(ix, other) === target);
}

/**
 * The live typed relations a `link` accepts at an anchor for a target
 * (proposed or held, a rule tier's or an agent's, answering the item at the
 * anchor, §4.8 a), in natural key order.
 */
function liveAnswering(
  ix: OpenQuestionIndex,
  kind: OpenQuestionKind,
  pick: OpenQuestionPick | undefined,
  anchor: DirectedAnchor,
  target: string,
): RelationRecord[] {
  return (ix.relationsAt.get(anchor.ref) ?? [])
    .filter(
      (r) =>
        liveTyped(r) &&
        answersAt(kind, anchor, r) &&
        matchesTarget(ix, pick, target, otherEnd(anchor, r)),
    )
    .sort(
      (a, b) =>
        byCodePoint(a.type, b.type) ||
        byCodePoint(a.fromRef, b.fromRef) ||
        byCodePoint(a.toRef, b.toRef),
    );
}

/**
 * The targets live typed relations at the anchors already name (the
 * pickers' „Vorgeschlagen“), each with the proposals a `link` to it
 * accepts: the other end of each relation that answers the item (for a
 * process picker, its process), outside the anchor's own process.
 */
function suggestions(
  ix: OpenQuestionIndex,
  kind: OpenQuestionKind,
  anchors: readonly DirectedAnchor[],
  pick: OpenQuestionPick,
): { suggested: Ref[]; proposals: OpenQuestionLinkProposal[] } {
  const byTarget = new Map<string, Map<string, RelationRecord>>();
  for (const anchor of anchors) {
    for (const r of ix.relationsAt.get(anchor.ref) ?? []) {
      if (!liveTyped(r) || !answersAt(kind, anchor, r)) continue;
      const other = otherEnd(anchor, r);
      const target = pick === 'process' ? processKey(ix, other) : other;
      if (processKey(ix, target) === processKey(ix, anchor.ref)) continue;
      const of = byTarget.get(target) ?? new Map<string, RelationRecord>();
      of.set(r.id, r);
      byTarget.set(target, of);
    }
  }
  const suggested = sorted(byTarget.keys()) as Ref[];
  const proposals = suggested.flatMap((target) =>
    [...(byTarget.get(target)?.values() ?? [])]
      .sort((a, b) => byCodePoint(a.fromRef, b.fromRef) || byCodePoint(a.toRef, b.toRef))
      .map((r): OpenQuestionLinkProposal => ({
        target,
        relation: r.id,
        type: r.type,
        from: r.fromRef,
        to: r.toRef,
      })),
  );
  return { suggested, proposals };
}

/**
 * A `link` action with its picker's suggestions and the processes it
 * leaves out (the processes of the item's anchors).
 */
function linkAction(
  ix: OpenQuestionIndex,
  item: OpenQuestion,
  action: Omit<OpenQuestionAction, 'type' | 'suggested' | 'proposals' | 'exclude'> & {
    pick: 'process' | 'endpoint';
  },
): OpenQuestionAction {
  const anchors = directedAnchors(ix, item.kind, item.subject);
  const { suggested, proposals } = suggestions(ix, item.kind, anchors, action.pick);
  return {
    type: 'link',
    ...action,
    suggested,
    ...(proposals.length > 0 ? { proposals } : {}),
    ...(action.pick === 'process'
      ? { exclude: sorted(anchors.map((a) => processKey(ix, a.ref))) as Ref[] }
      : {}),
  };
}

/**
 * R1 (§4.8 a): an item of kind `call-target-unknown`, `call-target-dynamic`,
 * `external-partner` or `black-box-partner` is resolved once each of its
 * anchors has an accepted relation to a ref in another process: leaving
 * the anchor in the direction a link takes (from the call, from the coded
 * end unless it only catches, along each of the pool's flows), of any type
 * but `call` for a partner question; decided by a human, an owner's rule or
 * the rule tier (an agent's proposal never is accepted without one), with
 * both ends live. An item without an anchor is never resolved this way.
 * Read model only: `visibleFindings` and „Befunde“ stay as they are.
 */
export function resolvedByLink(
  ix: OpenQuestionIndex,
  item: { kind: OpenQuestionKind; subject: OpenQuestionSubject },
): boolean {
  const anchors = linkAnchors(ix, item.kind, item.subject);
  if (anchors === null || anchors.length === 0) return false;
  return anchors.every((anchor) =>
    (ix.relationsAt.get(anchor.ref) ?? []).some(
      (r) =>
        r.status === 'accepted' &&
        r.endpointState !== 'missing' &&
        answersAt(item.kind, anchor, r) &&
        processKey(ix, otherEnd(anchor, r)) !== processKey(ix, anchor.ref),
    ),
  );
}

/**
 * The calls towards the copies of a duplicated process id that wait for a
 * decision (proposed or held, both ends live), in natural key order: what
 * `choose-copy` decides, and what keeps the item listed (R1b).
 */
export function openCopyCalls(ix: OpenQuestionIndex, copies: readonly string[]): RelationRecord[] {
  const set = new Set(copies);
  return ix.input.relations
    .filter((r) => r.type === 'call' && set.has(r.toRef) && liveTyped(r))
    .sort((a, b) => byCodePoint(a.fromRef, b.fromRef) || byCodePoint(a.toRef, b.toRef));
}

/**
 * R1b (§4.8 a): a `duplicate-process-id` item is resolved while no call
 * towards any of its copies is proposed or held; a new caller's proposal
 * brings it back. Read model only, like R1.
 */
export function resolvedCopies(ix: OpenQuestionIndex, copies: readonly string[]): boolean {
  return openCopyCalls(ix, copies).length === 0;
}

/** The decision item of a relation or placement of the input, if it is there. */
function decisionItem(
  ix: OpenQuestionIndex,
  subject: OpenQuestionSubject,
): OpenQuestionDecisionItem | undefined {
  if (subject.type === 'relation') {
    const r = ix.input.relations.find((x) => x.id === subject.id);
    return r && { type: 'relation', id: r.id, version: r.version };
  }
  if (subject.type === 'placement') {
    const p = ix.input.chain?.placements.find((x) => x.id === subject.id);
    return p && { type: 'placement', id: p.id, version: p.version };
  }
  return undefined;
}

/**
 * The proposed placements a `decide` on a chain finding decides: of the
 * process (`process-without-step`) or on the step (`step-without-process`),
 * on a live step generation and with a live process.
 */
function proposedPlacements(
  ix: OpenQuestionIndex,
  match: { process?: string; step?: string },
): OpenQuestionDecisionItem[] {
  const chain = ix.input.chain;
  if (!chain) return [];
  return chain.placements
    .filter(
      (p) =>
        p.status === 'proposed' &&
        p.endpointState !== 'missing' &&
        chain.live.get(p.elementId) === p.generation &&
        (match.process === undefined || p.processRef === match.process) &&
        (match.step === undefined || p.elementId === match.step),
    )
    .sort(
      (a, b) => byCodePoint(a.elementId, b.elementId) || byCodePoint(a.processRef, b.processRef),
    )
    .map((p) => ({ type: 'placement' as const, id: p.id, version: p.version }));
}

const outside = (primary: boolean): OpenQuestionAction => ({
  type: 'outside',
  primary,
  label: LABEL.outside,
});

const placeOnOutside = (): OpenQuestionAction => ({
  type: 'place',
  primary: false,
  label: LABEL.placeOutside,
  step: OUTSIDE_STEP,
});

// ------------------------------------------------------------ amendments

/** One form field of an `amend` action, labelled „Aufrufaktivität „Rechnung stellen““. */
/** The German type of an amend target; a message or signal endpoint by its BPMN type and family. */
export function targetTypeLabel(
  ix: OpenQuestionIndex,
  ref: string,
  element: AmendableElementKind,
): string {
  if (element !== 'endpoint') return AMENDABLE_ELEMENT_LABELS[element];
  const ep = ix.factsAt(ref).find((x) => /^(msg|sig)_/.test(x.kind));
  return endpointTypeLabel(
    ep?.attrs.elementType,
    ep === undefined ? null : ep.kind.startsWith('sig_') ? 'signal' : 'message',
  );
}

function amendTarget(
  ix: OpenQuestionIndex,
  f: Pick<Fact, 'ref' | 'elementId'>,
  op: OpenQuestionAmendTarget['op'],
  element: AmendableElementKind,
  prefill?: string,
): OpenQuestionAmendTarget {
  return {
    elementId: f.elementId,
    op,
    label: `${targetTypeLabel(ix, f.ref, element)} ${quoteDe(ix.elementName(f.ref))}`,
    ...(prefill === undefined ? {} : { prefill }),
  };
}

/**
 * An `amend` action on the model of `ref` (M6 §4.8 a), its targets capped at
 * {@link MAX_AMENDMENT_ITEMS}; `undefined` without a target or a model head.
 */
function amendAction(
  ix: OpenQuestionIndex,
  ref: string,
  action: { primary: boolean; label: string; replaces?: ModelAmendmentId; hint?: string },
  targets: readonly OpenQuestionAmendTarget[],
): OpenQuestionAction[] {
  const modelKey = ix.modelOf(ref);
  const head = ix.input.models.get(modelKey);
  if (!head || targets.length === 0) return [];
  return [
    {
      type: 'amend',
      primary: action.primary,
      label: action.label,
      amend: {
        modelId: head.modelId,
        modelKey,
        targets: targets.slice(0, MAX_AMENDMENT_ITEMS),
        ...(action.replaces === undefined ? {} : { replaces: action.replaces }),
      },
      ...(action.hint === undefined ? {} : { hint: action.hint }),
    },
  ];
}

/** A `withdraw-amendment` action: one amendment, or every live one of the model. */
function withdrawAction(
  ix: OpenQuestionIndex,
  modelKey: string,
  primary: boolean,
  label: string,
  amendment?: ModelAmendmentId,
  compare?: OpenQuestionWithdrawCompare,
): OpenQuestionAction[] {
  const head = ix.input.models.get(modelKey);
  if (!head) return [];
  return [
    {
      type: 'withdraw-amendment',
      primary,
      label,
      withdraw: {
        modelId: head.modelId,
        modelKey,
        ...(amendment === undefined ? {} : { amendment }),
        ...(compare === undefined ? {} : { compare }),
      },
    },
  ];
}

/** The live amendment an `amend` at the element replaces, and whether the value comes from it. */
function replacing(
  live: AmendmentInfo | undefined,
  value: string | null | undefined,
): { replaces?: ModelAmendmentId; hint?: string } {
  if (live === undefined) return {};
  return { replaces: live.id, ...(live.after === value ? { hint: AMENDED_HINT } : {}) };
}

/**
 * The actions of a `call-target-unknown` item (§4.8 a): without a
 * `calledElement`, `amend` „Aufrufziel eintragen …“ first and `link` „Nur
 * verknüpfen …“; with a target naming no process (or a no-link coded
 * `call-target`), `link` first and `amend` „Aufrufziel im Modell ändern …“;
 * never `amend` over an expression in either dialect.
 */
function callTargetActions(ix: OpenQuestionIndex, item: OpenQuestion): OpenQuestionAction[] {
  const call = ix.factsAt(item.subject.id).find((f) => f.kind === 'call');
  const amendable = call !== undefined && !isExpression(call.keyRaw);
  const target = call && amendTarget(ix, call, 'call-target', 'call');
  const live = ix.liveAmendmentAt(item.subject.id, 'call-target');
  if (item.source === 'finding' && amendable && call.keyRaw === '' && target) {
    return [
      ...amendAction(
        ix,
        call.ref,
        { primary: true, label: LABEL.amendCallTarget, ...replacing(live, call.keyRaw) },
        [target],
      ),
      linkAction(ix, item, { primary: false, label: LABEL.linkOnly, pick: 'process' }),
      outside(false),
    ];
  }
  return [
    linkAction(ix, item, { primary: true, label: LABEL.link, pick: 'process' }),
    ...(amendable && target
      ? amendAction(
          ix,
          call.ref,
          { primary: false, label: LABEL.amendCallTargetChange, ...replacing(live, call.keyRaw) },
          [target],
        )
      : []),
    outside(false),
  ];
}

/**
 * The actions of a partner question at a message or signal endpoint
 * (§4.8 a): nameless, `amend` „Nachrichtennamen eintragen …“ first; named,
 * `link` first and `amend` „Nachrichtennamen ändern …“ („Signalnamen …“ for
 * a signal); never `amend` over an expression.
 */
function endpointActions(ix: OpenQuestionIndex, item: OpenQuestion): OpenQuestionAction[] {
  const facts = ix.factsAt(item.subject.id);
  const ep =
    facts.find((f) => f.kind === 'msg_throw' || f.kind === 'msg_catch') ??
    facts.find((f) => f.kind === 'sig_throw' || f.kind === 'sig_catch');
  const signal = ep !== undefined && ep.kind.startsWith('sig_');
  const name = ep === undefined ? undefined : signal ? ep.attrs.signalName : ep.attrs.messageName;
  const amendable = ep !== undefined && ep.attrs.dynamic !== true && !isExpression(name ?? '');
  const live = ix.liveAmendmentAt(item.subject.id, 'message-name');
  const amend = (primary: boolean, label: string) =>
    amendable
      ? amendAction(ix, ep.ref, { primary, label, ...replacing(live, name ?? null) }, [
          amendTarget(ix, ep, 'message-name', 'endpoint'),
        ])
      : [];
  const link = (primary: boolean) =>
    linkAction(ix, item, { primary, label: LABEL.link, pick: 'endpoint' });
  if (amendable && name === undefined) {
    return [
      ...amend(true, signal ? LABEL.amendSignalName : LABEL.amendMessageName),
      link(false),
      outside(false),
    ];
  }
  return [
    link(true),
    ...amend(false, signal ? LABEL.amendSignalNameChange : LABEL.amendMessageNameChange),
    outside(false),
  ];
}

/**
 * Whether a `value-changed` conflict may keep analyzr's value over the
 * incoming one (§4.8 a „only where the op may write over the incoming value
 * (c)“): only where the incoming value does not resolve, since replacing a
 * value that resolves is not in v1 (§4.8 c, decision 25.3 „Nicht
 * überschreiben“). A call target that names no head process and is no
 * expression; a message or signal name the endpoint asked about pairs with
 * nothing (its rule-tier finding `dangling-throw` or `unmatched-catch`
 * stands, or it has no name); never a start or end name (a changed one is
 * always a label) and never documentation (the tool's text always wins).
 */
function keepAllowed(ix: OpenQuestionIndex, modelKey: string, a: AmendmentInfo): boolean {
  const incoming = incomingValue(ix, modelKey, a);
  switch (a.op) {
    case 'call-target': {
      const value = incoming ?? '';
      if (value === '') return true;
      if (isExpression(value)) return false;
      return !ix.input.projectFacts.models.some((m) =>
        m.processes.some((p) => p.processId === value),
      );
    }
    case 'message-name': {
      if (incoming === undefined) return false;
      if (incoming === null || incoming === '') return true;
      const anchor = formatRef(modelKey, a.viaElementId ?? a.elementId);
      return ix.input.findings.some(
        (f) =>
          (f.kind === 'dangling-throw' || f.kind === 'unmatched-catch') && f.refs.includes(anchor),
      );
    }
    case 'event-name':
    case 'process-documentation':
      return false;
  }
}

/**
 * The actions of an `amendment-conflict` item (§4.8 a): `value-changed`
 * takes the tool's value (a withdrawal) or, where the incoming value does
 * not resolve ({@link keepAllowed}), keeps the amendment over it (a new
 * amendment that replaces it, its `before` the incoming value);
 * `element-missing` withdraws it, or every live amendment of the model;
 * `expression` only withdraws it.
 */
function conflictActions(ix: OpenQuestionIndex, item: OpenQuestion): OpenQuestionAction[] {
  const { modelKey } = parseRef(item.subject.id);
  const m = ix.input.amendments?.get(modelKey);
  if (!m) return [];
  for (const entry of m.plan) {
    if (entry.outcome !== 'conflict') continue;
    const id = openQuestionId(
      'amendment-conflict',
      item.subject,
      `${entry.id}|${m.uploadedRevisionId}`,
    );
    if (id !== item.id) continue;
    const a = m.live.find((x) => x.id === entry.id);
    if (!a) return [];
    if (entry.reason === 'value-changed') {
      const at = formatRef(modelKey, a.viaElementId ?? a.elementId);
      // Only a call target or a message or signal name is ever kept (keepAllowed).
      const kind: AmendableElementKind = a.op === 'call-target' ? 'call' : 'endpoint';
      const family = ix.factsAt(at).some((f) => f.kind.startsWith('sig_'))
        ? 'signal'
        : ix.factsAt(at).some((f) => f.kind.startsWith('msg_'))
          ? 'message'
          : null;
      const compare: OpenQuestionWithdrawCompare = {
        field: amendmentFieldLabel(a.op, a.op === 'message-name' ? family : null),
        incoming: incomingValue(ix, modelKey, a) ?? null,
        after: a.after,
        before: a.before,
      };
      return [
        ...withdrawAction(ix, modelKey, true, LABEL.takeSourceValue, a.id, compare),
        ...(!keepAllowed(ix, modelKey, a)
          ? []
          : amendAction(ix, at, { primary: false, label: LABEL.keepAmendment, replaces: a.id }, [
              amendTarget(
                ix,
                { ref: at, elementId: a.viaElementId ?? a.elementId },
                a.op,
                kind,
                a.after,
              ),
            ])),
      ];
    }
    if (entry.reason === 'element-missing') {
      return [
        ...withdrawAction(ix, modelKey, true, LABEL.withdrawAmendment, a.id),
        ...withdrawAction(ix, modelKey, false, LABEL.withdrawAllAmendments),
      ];
    }
    return withdrawAction(ix, modelKey, true, LABEL.withdrawAmendment, a.id);
  }
  return [];
}

/** The actions of a non-informational kind, without the note. */
function kindActions(item: OpenQuestion, ix: OpenQuestionIndex): OpenQuestionAction[] {
  const { subject } = item;
  switch (item.kind) {
    case 'call-target-unknown':
      return callTargetActions(ix, item);
    case 'call-target-dynamic':
      return [
        linkAction(ix, item, {
          primary: true,
          label: LABEL.linkTargets,
          pick: 'process',
          multiple: true,
        }),
        outside(false),
      ];
    case 'duplicate-process-id':
      return [
        {
          type: 'choose-copy',
          primary: true,
          label: LABEL.chooseCopy,
          pick: 'process',
          choices: [...item.refs],
          decides: openCopyCalls(ix, item.refs).map((r) => ({
            type: 'relation' as const,
            id: r.id,
            version: r.version,
          })),
        },
      ];
    case 'message-partner-missing':
    case 'message-without-name':
      return endpointActions(ix, item);
    case 'held':
    case 'agent-question': {
      const decides = decisionItem(ix, subject);
      return decides
        ? [{ type: 'decide', primary: true, label: LABEL.decide, decides: [decides] }]
        : [];
    }
    case 'placement-unsure':
      return [{ type: 'place', primary: true, label: LABEL.place, pick: 'step' }, placeOnOutside()];
    case 'process-without-step': {
      const proposed = proposedPlacements(ix, { process: subject.id });
      return proposed.length > 0
        ? [
            { type: 'decide', primary: true, label: LABEL.decideProposal, decides: proposed },
            { type: 'place', primary: false, label: LABEL.placeOther, pick: 'step' },
            placeOnOutside(),
          ]
        : [{ type: 'place', primary: true, label: LABEL.place, pick: 'step' }, placeOnOutside()];
    }
    case 'step-without-process': {
      const proposed = proposedPlacements(ix, { step: subject.id });
      const place = (primary: boolean): OpenQuestionAction => ({
        type: 'place',
        primary,
        label: LABEL.placeProcess,
        pick: 'process',
      });
      return proposed.length > 0
        ? [
            { type: 'decide', primary: true, label: LABEL.decideProposal, decides: proposed },
            place(false),
            outside(false),
          ]
        : [place(true), outside(false)];
    }
    case 'unresolved-link':
      return [{ type: 'fix-link', primary: true, label: LABEL.fixLink }];
    case 'external-partner':
      return [
        outside(true),
        linkAction(ix, item, { primary: false, label: LABEL.link, pick: 'process' }),
      ];
    case 'unjudged': {
      const pairs = openUncoveredPairs(ix, subject.id);
      return [
        { type: 'requeue', primary: true, label: LABEL.requeue },
        ...(pairs.length > 0
          ? [
              {
                type: 'link' as const,
                primary: false,
                label: LABEL.linkPair,
                pick: 'pair' as const,
                pairs: [...pairs],
              },
            ]
          : []),
      ];
    }
    case 'black-box-partner':
      return [
        outside(true),
        ...(directedAnchors(ix, item.kind, subject).length > 0
          ? [linkAction(ix, item, { primary: false, label: LABEL.link, pick: 'process' })]
          : []),
      ];
    case 'isolated-process':
      return [
        linkAction(ix, item, { primary: true, label: LABEL.link, pick: 'process' }),
        outside(false),
      ];
    case 'unlabelled-boundary': {
      // One form field per unnamed none start or end event of the process: the starts first,
      // then the ends, each by id, as the question asks („Was startet …, und womit endet er?“).
      const events = item.refs.flatMap((ref) => {
        const f = ix
          .factsAt(ref)
          .find((x) => (x.kind === 'evt_start' || x.kind === 'evt_end') && x.label === '');
        return f ? [f] : [];
      });
      const targets = [
        ...events.filter((f) => f.kind === 'evt_start'),
        ...events.filter((f) => f.kind === 'evt_end'),
      ].map((f) =>
        amendTarget(ix, f, 'event-name', f.kind === 'evt_start' ? 'start-event' : 'end-event'),
      );
      return amendAction(ix, subject.id, { primary: true, label: LABEL.amendEventName }, targets);
    }
    case 'undocumented-process': {
      const { elementId } = parseRef(subject.id);
      return amendAction(ix, subject.id, { primary: true, label: LABEL.amendDocumentation }, [
        amendTarget(ix, { ref: subject.id as Ref, elementId }, 'process-documentation', 'process'),
      ]);
    }
    case 'amendment-conflict':
      return conflictActions(ix, item);
    case 'summary-note':
    case 'descriptive-model':
      return [];
    // The fix is a new export: the note (primary) keeps what the customer says.
    case 'extractor-loss':
      return [];
  }
}

/**
 * The actions an item offers (§4.8 a), in display order, at most one of
 * them primary: none for informational items; every other item also gets
 * `note` („Notiz hinzufügen“), primary when no other action is.
 */
export function actionsFor(item: OpenQuestion, ix: OpenQuestionIndex): OpenQuestionAction[] {
  if (isInformationalKind(item.kind)) return [];
  const actions = kindActions(item, ix);
  return [
    ...actions,
    { type: 'note', primary: !actions.some((a) => a.primary), label: LABEL.note },
  ];
}

// --------------------------------------------------------------------- link

/** Why a `link` cannot run (422 `validation-failed` with this `reason`). */
export type LinkRefusal =
  | 'unknown-ref'
  | 'not-a-process'
  | 'same-process'
  | 'too-many-targets'
  | 'not-a-pair'
  | 'no-anchor';

/** One relation a `link` writes or accepts: from → to, at one of the item's anchors, for a target. */
export interface LinkPair {
  from: Ref;
  to: Ref;
  /** The anchor it is written at, with its direction. */
  anchor: DirectedAnchor;
  /** The picked target (a process for a process picker; the pair's `to` for a pair). */
  target: Ref;
}

/**
 * The relations a `link` on the item writes (§4.8 a), checked against the
 * offered action: per target and anchor ({@link directedAnchors}: from the
 * call or the process; towards an endpoint that only catches, else from
 * it; one per anchor of a pool's flows, directed like its flow), or the
 * picked pair (`unjudged`). Every target must be a ref of the head facts (a
 * process where the action picks processes) in another process than the
 * anchor.
 */
export function linkPlan(
  ix: OpenQuestionIndex,
  item: OpenQuestion,
  action: OpenQuestionAction,
  body: { targets: readonly string[]; pair?: { from: string; to: string } | undefined },
): { ok: true; pairs: LinkPair[] } | { ok: false; reason: LinkRefusal; message: string } {
  const refuse = (reason: LinkRefusal, message: string) => ({
    ok: false as const,
    reason,
    message,
  });
  if (action.pick === 'pair') {
    const pair = body.pair;
    const listed = action.pairs ?? [];
    if (!pair || !listed.some((p) => p.from === pair.from && p.to === pair.to)) {
      return refuse('not-a-pair', 'pick one of the pairs the item lists');
    }
    const from = pair.from as Ref;
    const to = pair.to as Ref;
    return { ok: true, pairs: [{ from, to, anchor: { ref: from, outgoing: true }, target: to }] };
  }
  if (body.pair !== undefined) return refuse('not-a-pair', 'this item links targets, not a pair');
  if (action.multiple !== true && body.targets.length > 1) {
    return refuse('too-many-targets', 'this item links one target');
  }
  const anchors = directedAnchors(ix, item.kind, item.subject);
  if (anchors.length === 0) return refuse('no-anchor', 'no flow of the pool can carry a relation');
  const out = new Map<string, LinkPair>();
  for (const target of body.targets as Ref[]) {
    if (ix.factsAt(target).length === 0) {
      return refuse('unknown-ref', `${target} is not an element of the head revisions`);
    }
    if (action.pick === 'process' && !ix.processes.has(target)) {
      return refuse('not-a-process', `${target} is not a process`);
    }
    for (const anchor of anchors) {
      if (processKey(ix, target) === processKey(ix, anchor.ref)) {
        return refuse('same-process', `${target} lies in the process of ${anchor.ref}`);
      }
      const ref = anchor.ref as Ref;
      const pair = anchor.outgoing
        ? { from: ref, to: target, anchor, target }
        : { from: target, to: ref, anchor, target };
      out.set(`${pair.from}\u0000${pair.to}`, pair);
    }
  }
  return { ok: true, pairs: [...out.values()] };
}

/** What a `link` does for one pair of its plan. */
export type LinkStep =
  /** Accept these live typed relations as the human's decision (§4.8 a). */
  | { kind: 'accept'; relations: RelationRecord[] }
  /** An accepted relation already answers the item there: nothing to write. */
  | { kind: 'linked' }
  /** Write an accepted `manual` relation. */
  | { kind: 'manual'; pair: LinkPair };

/**
 * What a `link` does for each pair of its plan (§4.8 a), the same rule the
 * picker's suggestions follow: the live typed relations (proposed or held, a
 * rule tier's or an agent's) at the anchor that answer the item and end at
 * the target (for a process picker: anywhere in the target process) are
 * accepted as the human's decision, so the typed pairs are settled and
 * judge-once stops assigning them; else, when an accepted relation already
 * answers the item there, nothing; else a `manual` relation. A relation two
 * pairs share is accepted once.
 */
export function linkSteps(
  ix: OpenQuestionIndex,
  item: Pick<OpenQuestion, 'kind'>,
  action: Pick<OpenQuestionAction, 'pick'>,
  pairs: readonly LinkPair[],
): LinkStep[] {
  const taken = new Set<string>();
  return pairs.map((pair): LinkStep => {
    const live = liveAnswering(ix, item.kind, action.pick, pair.anchor, pair.target).filter(
      (r) => !taken.has(r.id),
    );
    if (live.length > 0) {
      for (const r of live) taken.add(r.id);
      return { kind: 'accept', relations: live };
    }
    const linked = (ix.relationsAt.get(pair.anchor.ref) ?? []).some(
      (r) =>
        (r.status === 'accepted' || taken.has(r.id)) &&
        answersAt(item.kind, pair.anchor, r) &&
        matchesTarget(ix, action.pick, pair.target, otherEnd(pair.anchor, r)),
    );
    return linked ? { kind: 'linked' } : { kind: 'manual', pair };
  });
}

// --------------------------------------------------------------- rationales

/** Longest question excerpt in a rationale. */
const RATIONALE_QUESTION_CHARS = 200;

/** `text`, its white space collapsed, cut to `max` characters with „…“. */
function excerpt(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/**
 * The rationale of a relation or placement an action writes or accepts
 * (German, from code): „Aus „Offene Fragen“: <Art> – <Frage, gekürzt>“, then
 * the note.
 */
export function actionRationale(item: OpenQuestion, note: string | null): string {
  const base = `Aus „Offene Fragen“: ${OPEN_QUESTION_KIND_LABELS[item.kind]} – ${excerpt(item.text, RATIONALE_QUESTION_CHARS)}`;
  return note === null ? base : `${base}\n\n${note}`;
}

/** The texts `choose-copy` decides with (German, from code), naming the valid copy. */
export function copyTexts(valid: string): { accept: string; reject: string; outside: string } {
  return {
    accept: `Aus „Offene Fragen“: Gültige Kopie gewählt, ${valid}.`,
    reject: `Aus „Offene Fragen“: Gültig ist ${valid}; diese Kopie ist veraltet oder eine Variante.`,
    outside: `Aus „Offene Fragen“: Veraltete Kopie; gültig ist ${valid}.`,
  };
}

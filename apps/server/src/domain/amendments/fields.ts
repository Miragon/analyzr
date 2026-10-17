/**
 * Which fields of a model an amendment can set, and with which value (M6
 * §4.8 c "Operations", "Where a field can be amended"), pure over what
 * `readAmendable` reads from the uploaded revision (where the splices go)
 * and from the head (the current values), the head facts, the rule tier's
 * findings, the model's live amendments and the fields the current open
 * questions name. A field is amendable only where an open question names
 * it, where it is empty or unresolved (a call without a target or with one
 * naming no process and no expression, an endpoint without a name or whose
 * name pairs with nothing, an unnamed start or end event, a process without
 * documentation), or where a live amendment the head applies set it;
 * elsewhere `only-open-questions` („Nur für offene Fragen“).
 */
import {
  isRef,
  parseRef,
  type AmendModelItem,
  type AmendSuggestions,
  type AmendableElementKind,
  type AmendmentOp,
  type AmendmentRefusal,
  type Fact,
  type Finding,
  type OpenQuestion,
  type ProjectFacts,
  type Ref,
} from '@analyzr/contracts';

import { isExpression } from '../open-questions/actions.ts';
import type { AmendableDocument, AnalysisPort } from '../ports.ts';
import { sameValue, type LiveAmendment } from './plan.ts';

type LibraryField = AmendableDocument['fields'][number];

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The key of a field: its op and the element whose field is written. */
export const fieldKey = (op: AmendmentOp, elementId: string): string => `${op}\u0000${elementId}`;

/** Most names and labels a field suggests. */
const MAX_SUGGESTIONS = 500;

/** What the checks read about one model. */
export interface AmendContext {
  modelKey: string;
  /** `readAmendable` of the uploaded revision the head is computed from. */
  uploaded: AmendableDocument;
  /** `readAmendable` of the head. */
  head: AmendableDocument;
  /** Head facts of every live model. */
  projectFacts: ProjectFacts;
  /** The rule tier's findings (stored, not filtered by relations). */
  findings: readonly Finding[];
  /** The model's live amendments, in seq order. */
  live: readonly LiveAmendment[];
  /**
   * The ids of the live amendments the head's plan marks `applied`: only
   * these set the head's value („where a live amendment set it“); one in
   * conflict or carried over by the tool did not.
   */
  applied: ReadonlySet<string>;
  /** The fields the current open questions' `amend` actions name ({@link fieldKey}). */
  named: ReadonlySet<string>;
  /** Model names by key (suggestions). */
  modelNames: ReadonlyMap<string, string | null>;
}

/** A field resolved on the uploaded revision. */
export interface ResolvedField {
  /** The element whose field is written. */
  key: string;
  /** The endpoint asked about, when the field is keyed by the message or signal it references. */
  via: string | null;
  op: AmendmentOp;
  element: AmendableElementKind;
  processId: string | null;
  /** The uploaded revision's field. */
  field: LibraryField;
  /** On the head (`''` for no call target, `null` for no name or documentation). */
  value: string | null;
  uploadedValue: string | null;
  /** `message-name`: the elements whose facts read the name (else the element). */
  readers: string[];
  /** `message-name` of a signal (or a signal endpoint). */
  signal: boolean;
}

export type Resolution =
  | { ok: true; field: ResolvedField }
  | {
      ok: false;
      reason: Extract<AmendmentRefusal, 'element-missing' | 'wrong-element'>;
      message: string;
    };

/** The facts of one model of the head. */
function modelFacts(ctx: AmendContext): readonly Fact[] {
  return ctx.projectFacts.models.find((m) => m.modelKey === ctx.modelKey)?.facts ?? [];
}

/** The head value of a field. */
function headValue(ctx: AmendContext, key: string, op: AmendmentOp): string | null {
  if (op === 'message-name') {
    const ep = ctx.head.endpoints.find((e) => e.elementId === key);
    if (ep) return ep.name;
  }
  const f = ctx.head.fields.find((x) => x.op === op && x.elementId === key);
  if (f) return f.value;
  return op === 'call-target' ? '' : null;
}

/**
 * The field of `op` an element keys (on the uploaded revision): an endpoint
 * that references a message or signal resolves to it (`via` the endpoint),
 * a pool to its process (`process-documentation`).
 */
export function resolveField(ctx: AmendContext, elementId: string, op: AmendmentOp): Resolution {
  const facts = modelFacts(ctx);
  let id = elementId;
  let via: string | null = null;
  if (op === 'message-name') {
    const ep = ctx.uploaded.endpoints.find((e) => e.elementId === elementId);
    if (ep && ep.amendmentElementId !== elementId) {
      id = ep.amendmentElementId;
      via = elementId;
    }
  }
  if (op === 'process-documentation') {
    const pool = facts.find((f) => f.kind === 'process' && f.attrs.participantId === elementId);
    if (pool) id = pool.elementId;
  }
  const field = ctx.uploaded.fields.find((f) => f.op === op && f.elementId === id);
  if (!field) {
    const exists =
      facts.some((f) => f.elementId === elementId) ||
      ctx.uploaded.fields.some((f) => f.elementId === elementId) ||
      ctx.uploaded.endpoints.some((e) => e.elementId === elementId);
    return exists
      ? { ok: false, reason: 'wrong-element', message: `${elementId} has no field ${op}` }
      : { ok: false, reason: 'element-missing', message: `no element ${elementId}` };
  }
  const endpoint = ctx.uploaded.endpoints.find(
    (e) => e.elementId === (via ?? id) || e.amendmentElementId === id,
  );
  return {
    ok: true,
    field: {
      key: id,
      via,
      op,
      element: field.element,
      processId: field.processId ?? endpoint?.processId ?? null,
      field,
      value: headValue(ctx, id, op),
      uploadedValue: field.value,
      readers: field.readers ?? [id],
      signal:
        field.element === 'signal' ||
        (field.element === 'endpoint' && endpoint !== undefined && endpoint.kind.startsWith('sig')),
    },
  };
}

/**
 * The endpoint an amendment is shown at and stored with (`via_element_id`):
 * the one asked about, else, for a name keyed by a message or signal itself,
 * the first endpoint (by id) that references it, so the conflict question
 * and the change list read the incoming value and the element at an
 * endpoint; `null` for a message no endpoint references and for the other
 * ops.
 */
export function storedVia(ctx: AmendContext, r: ResolvedField): string | null {
  if (r.via !== null || r.op !== 'message-name' || r.field.element === 'endpoint') return r.via;
  const endpoints = ctx.uploaded.endpoints
    .filter((e) => e.amendmentElementId === r.key && e.elementId !== r.key)
    .map((e) => e.elementId)
    .sort(byCodePoint);
  return endpoints[0] ?? null;
}

/**
 * The fields an element allows (`GET …/amendable`): every op it keys, an
 * endpoint's message or signal, a pool's process documentation.
 */
export function fieldsOfElement(ctx: AmendContext, elementId: string): ResolvedField[] {
  const out: ResolvedField[] = [];
  for (const op of [
    'call-target',
    'message-name',
    'event-name',
    'process-documentation',
  ] as const) {
    const r = resolveField(ctx, elementId, op);
    if (r.ok) out.push(r.field);
  }
  return out;
}

/** The head process ids of the landscape. */
function processIds(ctx: AmendContext): Set<string> {
  return new Set(ctx.projectFacts.models.flatMap((m) => m.processes.map((p) => p.processId)));
}

/** Whether a field is empty or unresolved on the head (M6 §4.8 c). */
function emptyOrUnresolved(ctx: AmendContext, r: ResolvedField): boolean {
  switch (r.op) {
    case 'call-target': {
      const v = r.value ?? '';
      if (v === '') return true;
      return !isExpression(v) && !processIds(ctx).has(v);
    }
    case 'event-name':
    case 'process-documentation':
      return r.value === null;
    case 'message-name': {
      const unpaired = new Set(
        ctx.findings
          .filter((f) => f.kind === 'dangling-throw' || f.kind === 'unmatched-catch')
          .flatMap((f) => f.refs),
      );
      return r.readers.some((id) => {
        const ep = ctx.head.endpoints.find((e) => e.elementId === id);
        return (ep !== undefined && ep.name === null) || unpaired.has(`${ctx.modelKey}#${id}`);
      });
    }
  }
}

/**
 * Why a field cannot be set whatever the value (`null`: it can): the
 * library's refusal on the uploaded revision (`expression`, `cmmn-call`,
 * `has-documentation`, …), else `only-open-questions` unless a live
 * amendment the head applies set it, an open question names it or it is
 * empty or unresolved. A live amendment in conflict or carried over by the
 * tool set nothing: its field follows the other rules, so „Meine Ergänzung
 * behalten“ never writes over a value that resolves (§4.8 a, c).
 */
export function amendability(
  ctx: AmendContext,
  r: ResolvedField,
): { reason: AmendmentRefusal; message: string } | null {
  if (r.field.blocked) return { reason: r.field.blocked.reason, message: r.field.blocked.message };
  if (ctx.live.some((a) => a.op === r.op && a.elementId === r.key && ctx.applied.has(a.id))) {
    return null;
  }
  if (ctx.named.has(fieldKey(r.op, r.key))) return null;
  if (emptyOrUnresolved(ctx, r)) return null;
  return {
    reason: 'only-open-questions',
    message:
      'no open question names this field, it is neither empty nor unresolved, and no live amendment set it',
  };
}

/**
 * The fields the current open questions' `amend` actions name on this model,
 * resolved like a request item ({@link fieldKey}).
 */
export function namedFields(
  ctx: Omit<AmendContext, 'named'>,
  items: readonly OpenQuestion[],
): Set<string> {
  const out = new Set<string>();
  const resolving: AmendContext = { ...ctx, named: new Set() };
  for (const q of items) {
    for (const action of q.actions) {
      if (action.type !== 'amend' || action.amend?.modelKey !== ctx.modelKey) continue;
      for (const t of action.amend.targets) {
        const r = resolveField(resolving, t.elementId, t.op);
        if (r.ok) out.add(fieldKey(r.field.op, r.field.key));
      }
    }
  }
  return out;
}

/** The suggestions of a field (M6 §4.8 c "The value comes from"). */
export function suggestionsFor(ctx: AmendContext, r: ResolvedField): AmendSuggestions {
  const processName = new Map<string, string>();
  const processCount = new Map<string, number>();
  for (const m of ctx.projectFacts.models) {
    for (const p of m.processes) {
      processName.set(p.ref, p.name ?? p.participantName ?? p.processId);
      processCount.set(p.processId, (processCount.get(p.processId) ?? 0) + 1);
    }
  }
  const ownProcesses = new Set<string>();
  for (const id of [r.key, ...r.readers, ...(r.via === null ? [] : [r.via])]) {
    const f = modelFacts(ctx).find((x) => x.elementId === id && x.processId !== null);
    if (f?.processId) ownProcesses.add(`${ctx.modelKey}#${f.processId}`);
  }
  if (r.processId !== null) ownProcesses.add(`${ctx.modelKey}#${r.processId}`);
  const facts = ctx.projectFacts.models.flatMap((m) => m.facts);
  const elsewhere = (f: Fact) =>
    f.processId !== null && !ownProcesses.has(`${f.modelKey}#${f.processId}`);
  switch (r.op) {
    case 'call-target':
      return {
        processes: ctx.projectFacts.models
          .flatMap((m) => m.processes.map((p) => ({ m, p })))
          .filter(({ p }) => !ownProcesses.has(p.ref))
          .sort(
            (a, b) =>
              byCodePoint(a.m.modelKey, b.m.modelKey) || byCodePoint(a.p.processId, b.p.processId),
          )
          .map(({ m, p }) => ({
            ref: p.ref,
            processId: p.processId,
            name: processName.get(p.ref) ?? p.processId,
            modelKey: m.modelKey,
            modelName: ctx.modelNames.get(m.modelKey) ?? null,
            ambiguous: (processCount.get(p.processId) ?? 0) > 1,
          })),
      };
    case 'message-name': {
      const kinds = r.signal ? ['sig_throw', 'sig_catch'] : ['msg_throw', 'msg_catch'];
      const asked = modelFacts(ctx).filter(
        (f) => r.readers.includes(f.elementId) && kinds.includes(f.kind),
      );
      const throws = asked.some((f) => f.kind.endsWith('_throw'));
      const catches = asked.some((f) => f.kind.endsWith('_catch'));
      const known = new Set<string>();
      for (const f of facts) {
        if (!kinds.includes(f.kind) || !elsewhere(f) || f.attrs.dynamic === true) continue;
        const name = r.signal ? f.attrs.signalName : f.attrs.messageName;
        if (name === undefined || name === '' || isExpression(name)) continue;
        known.add(name);
      }
      const names = [...known]
        .sort(byCodePoint)
        .slice(0, MAX_SUGGESTIONS)
        .map((name) => ({
          name,
          endpoints: facts
            .filter(
              (f) =>
                kinds.includes(f.kind) &&
                elsewhere(f) &&
                (r.signal ? f.attrs.signalName : f.attrs.messageName) === name,
            )
            .sort((a, b) => byCodePoint(a.ref, b.ref) || byCodePoint(a.kind, b.kind))
            .map((f) => ({
              ref: f.ref,
              kind: f.kind,
              name: f.label === '' ? f.elementId : f.label,
              processName:
                f.processId === null
                  ? null
                  : (processName.get(`${f.modelKey}#${f.processId}`) ?? null),
              modelKey: f.modelKey,
              partner: f.kind.endsWith('_catch') ? throws : catches,
            })),
        }));
      return { names };
    }
    case 'event-name': {
      // Trigger partners: a labelled none end elsewhere for a start, a labelled none start for an end.
      const partnerKind = r.element === 'start-event' ? 'evt_end' : 'evt_start';
      const labels = [
        ...new Set(
          facts
            .filter(
              (f) =>
                f.kind === partnerKind && f.eventDef === 'none' && f.label !== '' && elsewhere(f),
            )
            .map((f) => f.label),
        ),
      ]
        .sort(byCodePoint)
        .slice(0, MAX_SUGGESTIONS);
      return { labels };
    }
    case 'process-documentation':
      return {};
  }
}

/** One request item, checked: refused, identical to its live amendment, or to record. */
export type ItemCheck =
  | {
      outcome: 'not-applicable';
      reason: AmendmentRefusal;
      message: string;
      field?: ResolvedField;
      after?: string;
    }
  | { outcome: 'unchanged'; field: ResolvedField; after: string; live: LiveAmendment }
  | {
      outcome: 'candidate';
      field: ResolvedField;
      after: string;
      before: string | null;
      partner: Ref | null;
      supersedes: LiveAmendment | null;
    };

/** A `replaces` that names another amendment than the field's live one (409 `conflict`). */
export class ReplacesMismatch extends Error {
  readonly live: LiveAmendment | null;
  constructor(live: LiveAmendment | null) {
    super('replaces names another amendment than the live one');
    this.live = live;
  }
}

/**
 * Checks one request item (M6 §4.8 c): the element resolves on the uploaded
 * revision, the field is amendable, the value normalizes (a `target` is a
 * head process outside the caller's process, written as its id), and the
 * live amendment of the field is the one `replaces` names.
 *
 * @throws {ReplacesMismatch} when `replaces` names another amendment
 */
export function checkItem(
  ctx: AmendContext,
  item: AmendModelItem,
  normalize: AnalysisPort['normalizeAmendmentValue'],
): ItemCheck {
  const refuse = (reason: AmendmentRefusal, message: string, field?: ResolvedField): ItemCheck => ({
    outcome: 'not-applicable',
    reason,
    message,
    ...(field ? { field } : {}),
  });
  if (item.target !== undefined && item.op !== 'call-target') {
    return refuse('not-a-call-target', 'target is only for call-target');
  }
  if (item.partner !== undefined && item.op !== 'message-name') {
    return refuse('not-a-message-name', 'partner is only for message-name');
  }
  const resolved = resolveField(ctx, item.elementId, item.op);
  if (!resolved.ok) return refuse(resolved.reason, resolved.message);
  const field = resolved.field;
  const blocked = amendability(ctx, field);
  if (blocked) return refuse(blocked.reason, blocked.message, field);

  let raw: string;
  if (item.target !== undefined) {
    const target = item.target;
    const processes = new Set(
      ctx.projectFacts.models.flatMap((m) => m.processes.map((p) => p.ref as string)),
    );
    if (!isRef(target)) return refuse('unknown-ref', `${String(item.target)} is not a ref`, field);
    if (!processes.has(target)) {
      const known = ctx.projectFacts.models.some((m) => m.facts.some((f) => f.ref === target));
      return known
        ? refuse('not-a-process', `${target} is not a process`, field)
        : refuse('unknown-ref', `${target} is not an element of the head revisions`, field);
    }
    if (field.processId !== null && target === `${ctx.modelKey}#${field.processId}`) {
      return refuse('same-process', `${target} is the caller's own process`, field);
    }
    raw = parseRef(target).elementId;
  } else {
    raw = item.after ?? '';
  }
  const normalized = normalize(item.op, raw);
  if (!normalized.ok) {
    return refuse('invalid-value', `the value is ${normalized.problem}`, field);
  }
  const after = normalized.value;
  if (
    item.op === 'call-target' &&
    item.target === undefined &&
    field.processId !== null &&
    after === field.processId
  ) {
    return refuse('same-process', "the target is the caller's own process", field);
  }
  if (item.partner !== undefined) {
    const kinds = field.signal ? ['sig_throw', 'sig_catch'] : ['msg_throw', 'msg_catch'];
    const partner = ctx.projectFacts.models
      .flatMap((m) => m.facts)
      .find((f) => f.ref === item.partner && kinds.includes(f.kind));
    if (!partner) {
      return refuse(
        'partner-not-paired',
        `${item.partner} is no ${field.signal ? 'signal' : 'message'} endpoint of the head`,
        field,
      );
    }
  }
  // The live amendment of the field; `replaces` must name it. It may also name the live
  // amendment of the asked element under its old key (a name keyed by an endpoint that now
  // references a message: „Meine Ergänzung behalten“ keys the new one by the message).
  const byKey = ctx.live.find((a) => a.op === field.op && a.elementId === field.key) ?? null;
  let live = byKey;
  if (item.replaces !== undefined) {
    const named = ctx.live.find((a) => a.id === item.replaces) ?? null;
    const fits =
      named !== null &&
      named.op === field.op &&
      (named.elementId === field.key ||
        named.elementId === item.elementId ||
        named.viaElementId === item.elementId);
    if (!fits || (byKey !== null && byKey.id !== named.id)) throw new ReplacesMismatch(byKey);
    live = named;
  }
  // Identical to the live amendment: the same value over the same uploaded value. A live
  // amendment in conflict over a value the tool changed is recorded again („Meine Ergänzung
  // behalten“), with the new `before`.
  if (live && live.after === after && sameValue(live.before, field.uploadedValue)) {
    return { outcome: 'unchanged', field, after, live };
  }
  if (sameValue(field.uploadedValue, after)) {
    return {
      ...(refuse(
        'in-source',
        'the uploaded revision has this value already; withdraw the live amendment instead',
        field,
      ) as Extract<ItemCheck, { outcome: 'not-applicable' }>),
      after,
    };
  }
  return {
    outcome: 'candidate',
    field,
    after,
    before: field.uploadedValue,
    partner: item.partner ?? null,
    supersedes: live,
  };
}

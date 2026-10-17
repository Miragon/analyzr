/**
 * `analyzr models amend` and `analyzr questions amend` (M6 S5c-2, §4.8 c,
 * decision 25): targeted amendments of the fields open questions name, as
 * a human. The uploaded bytes stay a revision of their own; the server
 * computes an amended revision from them by byte-preserving splices and
 * makes it the head, and the next import of the key applies the amendment
 * again while the source tool leaves the field as it was.
 *
 * - **models amend:** `analyzr models amend <key> -p <project> --element
 *   <id> (--call-target <target> | --message-name <name> | --name <label> |
 *   --documentation <text>) [--partner <ref>] [--dry-run] [--yes]` sets one
 *   field of one element: the target of a call activity (a ref, the key of a
 *   model with one process, or a unique process name, as `questions link`
 *   takes it), the name of the message or signal an endpoint references
 *   (`--partner`: the endpoint whose name it is, so the key-tier proposal
 *   between them is accepted as the human's decision), the name of a start
 *   or end event, or the documentation of a process that has none.
 * - **questions amend:** `analyzr questions amend <id> -p <project> [--element
 *   <id>] (--call-target … | --message-name … | --name … | --documentation …)`
 *   runs an item's `amend` action (§4.8 a): the model, the element and the
 *   live amendment it replaces come from the action; `--element` picks one
 *   of several targets (start and end events without a name). Without a
 *   value it records the action's prefilled value: „Meine Ergänzung
 *   behalten“ on an `amendment-conflict`.
 *
 * Both take the owner key only and refuse an agent token before any request
 * (amendments are human decisions about content: `review` and `write`).
 * Every flag is checked first; then the command reads the element's
 * amendable fields (`GET …/elements/{elementId}/amendable`, whose ETag
 * `"r<headRev>"` it sends as `If-Match`), resolves a call target by name
 * through `GET …/landscape` when it is no ref, and dry-runs the amendment
 * (`POST …/amendments?dryRun=true`). It stops there, printing the dry run,
 * with `--dry-run`, for an item that is not applicable (exit 1), when
 * nothing changes, and when an agent holds the model's relations task (the
 * new head cancels it and the agent's work is lost; `--yes` saves anyway).
 * Otherwise it saves with the same `If-Match`, so a head that moved since
 * the read is refused (412) instead of amended unseen, and prints the
 * recorded amendment, the new head, the effect at the element and the cost
 * (the pairs judged again).
 */
import {
  amendModel,
  getAmendable,
  type AmendModelItemResult,
  type AmendModelResult,
  type AmendableElement,
  type AmendableField,
  type AmendmentCost,
  type AmendmentEffect,
  type AmendmentEffectRelation,
  type OpenQuestion,
  type OpenQuestionAction,
  type OpenQuestionAmendTarget,
} from '@analyzr/client';
import {
  MAX_AMENDMENT_RAW_CHARS,
  isModelKey,
  isRef,
  type AmendableElementKind,
  type AmendmentOp,
} from '@analyzr/contracts';

import { callWithResponse, createApi, type Api } from '../api.ts';
import { agentToken, ownerCredential, type CredentialOptions } from '../credentials.ts';
import { ApiError, CliError } from '../errors.ts';
import type { CliIo } from '../io.ts';
import { AMEND_VALUE_FLAGS } from './amend-flags.ts';
import { allModels } from './models.ts';
import { describeActions, resolveTarget } from './questions-act.ts';
import { describePersonalData, parseQuestionId } from './questions-answer.ts';
import { findQuestion, landscapeProcesses, oneLine } from './questions.ts';

/** The value flags of an amendment: one per op. */
export interface ValueFlags {
  /** `call-target`: a ref, the key of a model with one process, or a unique process name. */
  callTarget?: string;
  /** `message-name`: the name of the message or signal. */
  messageName?: string;
  /** `event-name`: the name of a start or end event. */
  name?: string;
  /** `process-documentation`: the documentation of a process without one. */
  documentation?: string;
}

export interface AmendOptions extends CredentialOptions, ValueFlags {
  url: string;
  project: string;
  /** The element whose field is set. */
  element?: string;
  /** `message-name`: the endpoint whose name it is (its key-tier proposal is accepted). */
  partner?: string;
  /** Only print the dry run. */
  dryRun?: boolean;
  /** Save even when an agent holds the model's relations task. */
  yes?: boolean;
  json?: boolean;
}

/** The value flags with their option keys, in the order the messages name them. */
const VALUE_FLAGS: readonly { flag: string; key: keyof ValueFlags; op: AmendmentOp }[] = (
  [
    ['callTarget', 'call-target'],
    ['messageName', 'message-name'],
    ['name', 'event-name'],
    ['documentation', 'process-documentation'],
  ] as const
).map(([key, op]) => ({ flag: AMEND_VALUE_FLAGS[op].flag, key, op }));

/** The flag that sets an op. */
export function flagOf(op: AmendmentOp): string {
  return AMEND_VALUE_FLAGS[op].flag;
}

/** The field each op writes, as the CLI names it. */
const FIELD_NAMES: Readonly<Record<AmendmentOp, string>> = {
  'call-target': 'call target',
  'message-name': 'message or signal name',
  'event-name': 'name',
  'process-documentation': 'documentation',
};

/** Each element kind an amendment writes, as the CLI names it. */
const ELEMENT_NAMES: Readonly<Record<AmendableElementKind, string>> = {
  call: 'call activity',
  'start-event': 'start event',
  'end-event': 'end event',
  process: 'process',
  message: 'message',
  signal: 'signal',
  endpoint: 'message or signal element',
};

/** What to remember about every warned value, printed once. */
export const AMENDMENT_PERSONAL_DATA_NOTE =
  "amendments take no names of people or other personal data: the value stays in the model's revisions and in the change list, and cannot be deleted";

/** Most entries one effect group lists; beyond that only counted. */
const EFFECT_LISTED = 10;

/** The longest value a line shows; longer ones (documentation) are cut with `…`. */
const VALUE_SHOWN = 80;

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The amendment flags as one op and its raw value; `undefined` without one. */
export interface ParsedValue {
  op: AmendmentOp;
  raw: string;
}

/**
 * The value flags → one op and its value, checked before any request: at
 * most one flag, not empty, at most {@link MAX_AMENDMENT_RAW_CHARS}
 * characters (the server normalizes it as the extractor sanitizes the field
 * and refuses what does not fit; it never cuts).
 */
export function parseValue(flags: ValueFlags): ParsedValue | undefined {
  const given = VALUE_FLAGS.filter((f) => flags[f.key] !== undefined);
  if (given.length > 1) {
    throw new CliError(
      `give one value: ${given.map((f) => f.flag).join(' or ')}, not ${given.length === 2 ? 'both' : 'several'}`,
    );
  }
  const [only] = given;
  if (only === undefined) return undefined;
  const raw = flags[only.key] ?? '';
  if (raw.trim() === '') throw new CliError(`${only.flag} needs a value, not an empty text`);
  if (raw.length > MAX_AMENDMENT_RAW_CHARS) {
    throw new CliError(
      `the value of ${only.flag} has ${raw.length} characters; at most ${MAX_AMENDMENT_RAW_CHARS}`,
    );
  }
  return { op: only.op, raw };
}

/** `--partner` → a ref, refused before any request; only with `--message-name`. */
function parsePartner(
  partner: string | undefined,
  op: AmendmentOp | undefined,
): string | undefined {
  if (partner === undefined) return undefined;
  const ref = partner.trim();
  if (op !== undefined && op !== 'message-name') {
    throw new CliError('--partner goes with --message-name: the endpoint whose name it is');
  }
  if (!isRef(ref)) {
    throw new CliError(
      `--partner takes the ref of the partner endpoint (<model key>#<element id>); got ${JSON.stringify(partner)}`,
    );
  }
  return ref;
}

/** `--element` → an element id, refused before any request. */
function parseElement(element: string | undefined): string | undefined {
  if (element === undefined) return undefined;
  const id = element.trim();
  if (id === '' || id.length > 255 || /\s/.test(id)) {
    throw new CliError(
      `not an element id: ${JSON.stringify(element)} (the id of the call activity, event, process or message element in the BPMN file)`,
    );
  }
  return id;
}

/** Agents never amend models: refused before any request. */
function refuseAgent(io: CliIo, opts: CredentialOptions, command: string): void {
  if (agentToken(io, opts) !== undefined) {
    throw new CliError(
      `only humans amend models: ${command} uses the owner key (drop --token and unset ANALYZR_TOKEN)`,
    );
  }
}

/** A value as a line shows it: `(none)` for none, else quoted on one line, long ones cut. */
export function shownValue(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '(none)';
  const line = oneLine(value);
  return `„${line.length > VALUE_SHOWN ? `${line.slice(0, VALUE_SHOWN - 1)}…` : line}“`;
}

/** `message name` for a message, `signal name` for a signal, else the op's field. */
function fieldName(op: AmendmentOp, element?: AmendableElementKind): string {
  if (op === 'message-name' && element === 'message') return 'message name';
  if (op === 'message-name' && element === 'signal') return 'signal name';
  return FIELD_NAMES[op];
}

/** `call target of Call_Rechnung`, `message name of Message_Zahlung (asked at Task_Zahlung)`. */
function fieldOf(
  r: Pick<AmendModelItemResult, 'op' | 'elementId' | 'amendmentElementId'>,
  element?: AmendableElementKind,
): string {
  const key = r.amendmentElementId ?? r.elementId;
  const where = key === r.elementId ? key : `${key} (asked at ${r.elementId})`;
  return `${fieldName(r.op, element)} of ${where}`;
}

/** One item of a result as lines: what became of it, and its personal-data warning. */
export function itemLines(
  r: AmendModelItemResult,
  dryRun: boolean,
  element?: AmendableElementKind,
): string[] {
  const field = fieldOf(r, element);
  const lines: string[] = [];
  switch (r.outcome) {
    case 'recorded': {
      const id = r.amendment ? ` (${r.amendment.id})` : '';
      const replacing = r.supersedes ? `, replacing ${r.supersedes}` : '';
      lines.push(
        `  ${dryRun ? 'would record' : 'recorded'}  ${field}: ${shownValue(r.before)} → ${shownValue(r.after)}${id}${replacing}`,
      );
      break;
    }
    case 'unchanged':
      lines.push(
        `  unchanged  ${field}: ${shownValue(r.after)} is set by its live amendment${r.amendment ? ` ${r.amendment.id}` : ''} already`,
      );
      break;
    case 'not-applicable':
      lines.push(
        `  not applicable  ${field}: ${r.reason ?? 'refused'}${r.message ? ` (${r.message})` : ''}`,
      );
      break;
  }
  if (r.warnings && r.warnings.length > 0) {
    lines.push(
      `  warning: the value probably contains ${describePersonalData(r.warnings)}`,
      `  ${AMENDMENT_PERSONAL_DATA_NOTE}`,
    );
  }
  return lines;
}

function relationText(r: AmendmentEffectRelation): string {
  return `${r.type} ${r.from} → ${r.to}${r.relation === null ? '' : ` (${r.relation})`}`;
}

/** The effect at the element as lines, each group listing at most {@link EFFECT_LISTED}. */
export function effectLines(e: AmendmentEffect): string[] {
  const groups: [string, string[]][] = [
    ['finding resolved', e.findingsResolved.map((f) => `${f.kind} ${f.refs.join(', ')}`)],
    ['new finding', e.findingsAdded.map((f) => `${f.kind} ${f.refs.join(', ')}`)],
    ['accepted by the rule tier', e.accepted.map(relationText)],
    ['proposed', e.proposed.map(relationText)],
    ['accepted as your decision', e.partnerAccepted.map(relationText)],
    ['no longer derived', e.withdrawn.map(relationText)],
    ['turns changed, to re-confirm in the review', e.changed.map(relationText)],
    ['manual link retired', e.retired.map(relationText)],
  ];
  const lines = groups.flatMap(([what, items]) => [
    ...items.slice(0, EFFECT_LISTED).map((t) => `    ${what}: ${t}`),
    ...(items.length > EFFECT_LISTED
      ? [`    … ${items.length - EFFECT_LISTED} more: ${what}`]
      : []),
  ]);
  return lines.length === 0
    ? ['  effect at the element: none']
    : ['  effect at the element:', ...lines];
}

/** The cost of the new head (decision 17), and the warning for a claimed task. */
export function costLines(c: AmendmentCost): string[] {
  const lines = [
    c.factsChange
      ? `  cost: ${plural(c.pairsToRejudge, 'pair')} judged again; the model's relations task is queued`
      : '  cost: none, the facts stay as they are',
  ];
  if (c.taskClaimed) {
    lines.push(
      "  warning: an agent is working on this model's relations task right now; the new head cancels the task and the agent's work is lost",
    );
  }
  return lines;
}

/** What a result's text says about the element, read with the amendable fields. */
interface Context {
  project: string;
  modelKey: string;
  headRev: number;
  field?: AmendableField;
  /** The open question the amendment answers (`questions amend`). */
  question?: Pick<OpenQuestion, 'id' | 'subjectLabel' | 'text'>;
}

/** The elements whose facts read a shared message's name, all renamed with it. */
function readerLines(ctx: Context): string[] {
  const readers = ctx.field?.op === 'message-name' ? ctx.field.readers : [];
  return readers.length > 1
    ? [
        `  every element referencing ${ctx.field?.elementId ?? '?'} reads the new name: ${readers.join(', ')}`,
      ]
    : [];
}

function questionLines(ctx: Context): string[] {
  return ctx.question
    ? [`  ${ctx.question.id}: ${oneLine(ctx.question.subjectLabel)}: ${oneLine(ctx.question.text)}`]
    : [];
}

/** A dry run, or a request that records nothing, as text. */
export function formatDryRun(ctx: Context, r: AmendModelResult): string {
  const refused = r.items.some((i) => i.outcome === 'not-applicable');
  const head = `${ctx.project}: ${ctx.modelKey} (r${ctx.headRev})`;
  const title = refused
    ? `${head}: not applicable, nothing recorded`
    : r.outcome === 'unchanged'
      ? `${head} unchanged: nothing to record`
      : `${head}: dry run, nothing recorded yet`;
  const lines = [
    title,
    ...questionLines(ctx),
    ...r.items.flatMap((i) => itemLines(i, r.dryRun, ctx.field?.element)),
  ];
  if (!refused && r.outcome === 'recorded') {
    lines.push(...readerLines(ctx), ...effectLines(r.effect), ...costLines(r.cost));
  }
  return `${lines.join('\n')}\n`;
}

/** A saved amendment as text: the new head, the items, the effect, the cost, how to withdraw. */
export function formatAmended(ctx: Context, r: AmendModelResult): string {
  const rev = r.revision?.rev ?? r.model.headRev;
  const upstream = r.revision?.source.upstream?.rev;
  const recorded = r.items.flatMap((i) =>
    i.outcome === 'recorded' && i.amendment ? [i.amendment.id] : [],
  );
  const lines = [
    `${ctx.project}: amended ${ctx.modelKey}: new head r${rev}${upstream === undefined ? '' : `, computed from the uploaded r${upstream}`}`,
    ...questionLines(ctx),
    ...r.items.flatMap((i) => itemLines(i, false, ctx.field?.element)),
    ...readerLines(ctx),
    ...effectLines(r.effect),
    ...costLines(r.cost),
    ...recorded.map(
      (id) => `  withdraw it with: analyzr amendments withdraw ${id} -p ${ctx.project}`,
    ),
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * Turns the save problems into messages: 412 (the head moved since it was
 * read), 422 with the items (not applicable), 409 (the live amendment of
 * the field changed).
 */
function explain(err: unknown, ctx: Context): never {
  if (!(err instanceof ApiError)) throw err;
  const problem = (err.problem ?? {}) as Record<string, unknown>;
  if (err.status === 412 && problem['code'] === 'revision-conflict') {
    const now = typeof problem['headRev'] === 'number' ? ` (now r${problem['headRev']})` : '';
    throw new CliError(
      `${ctx.modelKey} changed after it was read at r${ctx.headRev}${now}; nothing recorded: run the command again to amend the new head`,
    );
  }
  if (err.status === 422 && problem['reason'] === 'amendment-not-applicable') {
    const items = Array.isArray(problem['items'])
      ? (problem['items'] as AmendModelItemResult[])
      : [];
    throw new CliError(
      [
        'the amendment is not applicable; nothing recorded:',
        ...items.flatMap((i) => itemLines(i, false, ctx.field?.element)),
      ].join('\n'),
    );
  }
  if (err.status === 409 && problem['code'] === 'conflict') {
    throw new CliError(
      `the live amendment of the field changed after it was read; nothing recorded: run the command again${typeof problem['detail'] === 'string' ? ` (${problem['detail']})` : ''}`,
    );
  }
  throw err;
}

/** The live amendment a new value replaces: the field's, else the one live at the asked element. */
function replacedBy(
  amendable: AmendableElement,
  field: AmendableField,
  elementId: string,
): string | undefined {
  if (field.live) return field.live.id;
  // A name keyed by an endpoint that references a message since a re-import: the field is
  // now the message's, and the live amendment still sits at the endpoint (§4.8 c).
  const atElement = amendable.history.filter(
    (a) =>
      a.op === field.op &&
      a.withdrawal === null &&
      (a.elementId === elementId || a.viaElementId === elementId),
  );
  const [only] = atElement;
  return atElement.length === 1 && only !== undefined ? only.id : undefined;
}

/** One amendment to make: the model, the element, the value, and what the action knows. */
interface AmendRequest {
  project: string;
  model: { id: string; key: string };
  elementId: string;
  op: AmendmentOp;
  /** The value as typed; a call target is resolved to a ref unless `literal`. */
  raw: string;
  /** Send `raw` as `after` (a prefilled value), never resolve it as a target. */
  literal?: boolean;
  partner?: string;
  /** The live amendment the action replaces (`questions amend`). */
  replaces?: string;
  question?: Pick<OpenQuestion, 'id' | 'subjectLabel' | 'text'>;
}

/** `GET …/amendable`, its `ETag` as the head revision. */
async function readAmendable(
  api: Api,
  req: AmendRequest,
): Promise<{ amendable: AmendableElement; headRev: number }> {
  const { data, response } = await callWithResponse(
    api,
    `read the amendable fields of ${req.model.key}#${req.elementId} in ${req.project}`,
    getAmendable({
      client: api.client,
      path: { project: req.project, model: req.model.id, elementId: req.elementId },
    }),
  );
  const m = /^\s*(?:W\/)?"r([1-9]\d{0,8})"\s*$/.exec(response.headers.get('etag') ?? '');
  return { amendable: data, headRev: m?.[1] ? Number(m[1]) : data.headRev };
}

/** The field of the op, or why the element has none. */
function fieldFor(amendable: AmendableElement, req: AmendRequest): AmendableField {
  const field = amendable.fields.find((f) => f.op === req.op);
  if (field) return field;
  const at = `${req.model.key}#${req.elementId}`;
  if (amendable.fields.length === 0) {
    throw new CliError(`${at} has no field an amendment can set`);
  }
  throw new CliError(
    `${at} has no ${FIELD_NAMES[req.op]}; it takes ${amendable.fields.map((f) => `${flagOf(f.op)} (${ELEMENT_NAMES[f.element]} ${f.elementId})`).join(' or ')}`,
  );
}

/**
 * Reads the field, dry-runs the amendment and saves it unless the dry run
 * says to stop (see the module comment); prints the outcome.
 *
 * @throws {CliError} for a refused or stopped amendment, and the server's problems
 */
async function amend(
  io: CliIo,
  api: Api,
  req: AmendRequest,
  opts: Pick<AmendOptions, 'dryRun' | 'yes' | 'json'>,
): Promise<void> {
  const { amendable, headRev } = await readAmendable(api, req);
  const field = fieldFor(amendable, req);
  const ctx: Context = {
    project: req.project,
    modelKey: req.model.key,
    headRev,
    field,
    ...(req.question ? { question: req.question } : {}),
  };
  let value: { after: string } | { target: string };
  if (req.op === 'call-target' && req.literal !== true) {
    const target = req.raw.trim();
    const landscape = isRef(target)
      ? { processes: [], modelKeys: new Set<string>() }
      : await landscapeProcesses(api, req.project);
    const r = resolveTarget(target, landscape);
    if (!r.ok) throw new CliError(`${r.message}\nnothing was sent`);
    value = { target: r.ref };
  } else {
    value = { after: req.raw };
  }
  const replaces = req.replaces ?? replacedBy(amendable, field, req.elementId);
  const body = {
    items: [
      {
        elementId: req.elementId,
        op: req.op,
        ...value,
        ...(req.partner === undefined ? {} : { partner: req.partner }),
        ...(replaces === undefined ? {} : { replaces }),
      },
    ],
  };
  const post = async (dryRun: boolean): Promise<AmendModelResult> => {
    try {
      const { data } = await callWithResponse(
        api,
        `${dryRun ? 'dry-run the amendment of' : 'amend'} ${req.model.key} in ${req.project}`,
        amendModel({
          client: api.client,
          path: { project: req.project, model: req.model.id },
          query: dryRun ? { dryRun: 'true' } : {},
          headers: { 'if-match': `"r${headRev}"` },
          body,
        }),
      );
      return data;
    } catch (err) {
      return explain(err, ctx);
    }
  };
  const print = (r: AmendModelResult, text: () => string) =>
    io.stdout(opts.json ? `${JSON.stringify(r, null, 2)}\n` : text());

  const dry = await post(true);
  const refused = dry.items.some((i) => i.outcome === 'not-applicable');
  const stop = !refused && dry.outcome === 'recorded' && dry.cost.taskClaimed && opts.yes !== true;
  if (opts.dryRun || refused || dry.outcome === 'unchanged' || stop) {
    print(dry, () => formatDryRun(ctx, dry));
    if (refused) throw new CliError('the amendment is not applicable; nothing recorded');
    if (stop && opts.dryRun !== true) {
      throw new CliError(
        `an agent holds the relations task of ${req.model.key}; saving cancels it and the agent's work is lost: run again with --yes to save anyway`,
      );
    }
    return;
  }
  const saved = await post(false);
  print(saved, () => formatAmended(ctx, saved));
}

/** `analyzr models amend <key> -p <project> --element <id> (--call-target … | …) [--partner] [--dry-run] [--yes] [--json]`. */
export async function modelsAmendCommand(
  io: CliIo,
  key: string,
  opts: AmendOptions,
): Promise<void> {
  refuseAgent(io, opts, 'analyzr models amend');
  if (!isModelKey(key)) {
    throw new CliError(
      `not a model key: ${JSON.stringify(key)} (lowercase slug segments separated by /, e.g. finanzen/mahnwesen)`,
    );
  }
  const elementId = parseElement(opts.element);
  if (elementId === undefined) {
    throw new CliError('give the element with --element <id> (its id in the BPMN file)');
  }
  const value = parseValue(opts);
  if (value === undefined) {
    throw new CliError(
      `give the value with ${VALUE_FLAGS.map((f) => f.flag)
        .join(', ')
        .replace(/, ([^,]*)$/, ' or $1')}`,
    );
  }
  const partner = parsePartner(opts.partner, value.op);
  const api = createApi(io, opts.url, await ownerCredential(io, opts));
  const model = (await allModels(api, opts.project)).find((m) => m.key === key);
  if (!model) throw new CliError(`no live model ${key} in ${opts.project}`);
  await amend(
    io,
    api,
    {
      project: opts.project,
      model: { id: model.id, key: model.key },
      elementId,
      op: value.op,
      raw: value.raw,
      ...(partner === undefined ? {} : { partner }),
    },
    opts,
  );
}

/** The targets of an item's `amend` actions, each with its action. */
function amendTargets(
  q: OpenQuestion,
): { action: OpenQuestionAction; target: OpenQuestionAmendTarget }[] {
  return q.actions.flatMap((action) =>
    action.type === 'amend' && action.amend
      ? action.amend.targets.map((target) => ({ action, target }))
      : [],
  );
}

/** `Startereignis „…“ (Start_1, --name)`. */
function targetText(t: OpenQuestionAmendTarget): string {
  return `${oneLine(t.label)} (--element ${t.elementId}, ${flagOf(t.op)})`;
}

/** `analyzr questions amend <id> -p <project> [--element <id>] [--call-target … | …] [--partner] [--dry-run] [--yes] [--json]`. */
export async function questionsAmendCommand(
  io: CliIo,
  id: string,
  opts: AmendOptions,
): Promise<void> {
  refuseAgent(io, opts, 'analyzr questions amend');
  const question = parseQuestionId(id);
  const elementId = parseElement(opts.element);
  const value = parseValue(opts);
  const partner = parsePartner(opts.partner, value?.op);
  const api = createApi(io, opts.url, await ownerCredential(io, opts));
  const item = await findQuestion(api, opts.project, question);
  const all = amendTargets(item);
  if (all.length === 0) {
    throw new CliError(
      `${item.id} (${item.kind}) offers no amend; its actions: ${describeActions(item)}`,
    );
  }
  const listed = () => all.map((t) => `  ${targetText(t.target)}`).join('\n');
  const byElement =
    elementId === undefined ? all : all.filter((t) => t.target.elementId === elementId);
  if (byElement.length === 0) {
    throw new CliError(
      `${item.id} amends no element ${elementId ?? ''}; its targets:\n${listed()}`,
    );
  }
  const byOp = value === undefined ? byElement : byElement.filter((t) => t.target.op === value.op);
  const [chosen] = byOp;
  if (chosen === undefined) {
    const [t] = byElement;
    throw new CliError(
      byElement.length === 1 && t
        ? `${item.id} sets the ${FIELD_NAMES[t.target.op]} of ${t.target.elementId}: give it with ${flagOf(t.target.op)}`
        : `${item.id} sets no ${FIELD_NAMES[value?.op ?? 'call-target']}; its targets:\n${listed()}`,
    );
  }
  if (byOp.length > 1) {
    throw new CliError(
      `${item.id} amends ${byOp.length} elements: pick one with --element <id>:\n${listed()}`,
    );
  }
  const { action, target } = chosen;
  const raw = value?.raw ?? target.prefill;
  if (raw === undefined) {
    throw new CliError(
      `give the ${FIELD_NAMES[target.op]} of ${target.elementId} with ${flagOf(target.op)}`,
    );
  }
  if (partner !== undefined && target.op !== 'message-name') {
    throw new CliError('--partner goes with a message or signal name');
  }
  const amendment = action.amend;
  if (!amendment) throw new Error('amendTargets() keeps actions with targets only');
  await amend(
    io,
    api,
    {
      project: opts.project,
      model: { id: amendment.modelId, key: amendment.modelKey },
      elementId: target.elementId,
      op: target.op,
      raw,
      // The prefilled value is the live amendment's own (a process id for a call target).
      literal: value === undefined,
      ...(partner === undefined ? {} : { partner }),
      ...(amendment.replaces === undefined ? {} : { replaces: amendment.replaces }),
      question: item,
    },
    opts,
  );
}

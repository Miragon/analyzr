/**
 * `analyzr questions outside|link|place` (M6 S5c-1, §4.8 a): answering an
 * open question by an action that changes the landscape. Every action is a
 * human act (permission `review`), so the commands take the owner key only
 * and refuse an agent token before any request; decisions on proposals and
 * holds, choosing the valid copy and fixing a step's link stay in the web,
 * which has the review components.
 *
 * - **outside:** `analyzr questions outside <id> -p <project> [--note]`
 *   records the outside mark „Liegt außerhalb der Landschaft“ (the item
 *   turns `answered`; a second mark is `unchanged`); `--undo <answer id>`
 *   withdraws a mark, and the item is open again.
 * - **link:** `analyzr questions link <id> -p <project> --to <target>…
 *   [--note]` links the item's anchor to each target: a live typed proposal
 *   between them is accepted as the human's decision, else an accepted
 *   manual relation is written (the server decides). A target is a ref, a
 *   model key whose model has one process, or a unique process name; one
 *   that names no process or several is listed with the candidates, and
 *   nothing is sent. An item that links one of its listed pairs (`unjudged`)
 *   takes `--pair <from> <to>` instead.
 * - **place:** `analyzr questions place <id> -p <project> --step <element
 *   id>|@outside [--note]` places the item's process on the step (accepted
 *   at once); a step item (`step-without-process`) takes the process to
 *   place on its step with `--process <target>`.
 *
 * Every flag is checked before any request; then the command reads the item
 * (`GET …/open-questions`, so it can say which actions the item offers and
 * fill in a step item's step), resolves names through `GET …/landscape` when
 * a target is no ref, and posts `POST …/open-questions/{id}/actions` (the
 * withdrawal: `POST …/answers/{answer}/withdrawal`). The note's personal-data
 * warnings are printed with one hint; they never block.
 */
import {
  actOnOpenQuestion,
  withdrawOpenQuestionAnswer,
  type OpenQuestion,
  type OpenQuestionAction,
  type OpenQuestionActionResult,
  type Placement,
  type Relation,
  type WithdrawOpenQuestionAnswerResult,
} from '@analyzr/client';
import {
  MAX_LINK_TARGETS,
  MAX_VALUE_CHAIN_ID_CHARS,
  OUTSIDE_STEP,
  OpenQuestionAnswerId,
  isModelKey,
  isRef,
  reviewPath,
  valueChainPath,
} from '@analyzr/contracts';

import { call, createApi, type Api } from '../api.ts';
import { agentToken, ownerCredential, type CredentialOptions } from '../credentials.ts';
import { CliError } from '../errors.ts';
import type { CliIo } from '../io.ts';
import {
  PERSONAL_DATA_NOTE,
  describePersonalData,
  parseNoteText,
  parseQuestionId,
} from './questions-answer.ts';
import {
  findQuestion,
  landscapeProcesses,
  oneLine,
  type LandscapeProcesses,
  type ProcessEntry,
} from './questions.ts';

/** The actions the CLI runs; the others (decide, choose-copy, fix-link) are in the web. */
export type CliActionType = 'outside' | 'link' | 'place';

export interface ActOptions extends CredentialOptions {
  url: string;
  project: string;
  /** An optional note: an outside mark's text, else part of the rationale. */
  note?: string;
  json?: boolean;
}

export interface OutsideOptions extends ActOptions {
  /** Withdraw this outside mark (`oqa_…`) instead of marking. */
  undo?: string;
}

export interface LinkOptions extends ActOptions {
  /** Targets: refs, model keys whose model has one process, or unique process names. */
  to?: string[];
  /** The two refs of a listed pair (`unjudged`). */
  pair?: string[];
}

export interface PlaceOptions extends ActOptions {
  /** A step element id, or `@outside`. */
  step?: string;
  /** The process to place on a step item's step: a ref, a model key or a process name. */
  process?: string;
}

/** Collects a repeatable option (`--to a --to b`). */
export function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

/** Agents never act on open questions: refused before any request. */
function refuseAgent(io: CliIo, opts: CredentialOptions, command: CliActionType): void {
  if (agentToken(io, opts) !== undefined) {
    throw new CliError(
      `only humans act on open questions: analyzr questions ${command} uses the owner key (drop --token and unset ANALYZR_TOKEN)`,
    );
  }
}

/** `--note` → the note as the server stores it, or `undefined` without one. */
function parseNote(value: string | undefined): string | undefined {
  return value === undefined ? undefined : parseNoteText(value, '--note');
}

/** Where an action the CLI does not run is done. */
function elsewhere(a: OpenQuestionAction): string {
  switch (a.type) {
    case 'decide':
    case 'choose-copy':
    case 'fix-link':
      return ', in the web UI';
    case 'requeue':
      return ', analyzr models requeue';
    case 'note':
      return ', analyzr questions answer';
    default:
      return '';
  }
}

/** `Entscheiden (decide, in the web UI), Notiz hinzufügen (note, analyzr questions answer)`. */
export function describeActions(q: Pick<OpenQuestion, 'actions'>): string {
  if (q.actions.length === 0) return 'none: it is informational and asks nothing';
  return q.actions.map((a) => `${oneLine(a.label)} (${a.type}${elsewhere(a)})`).join(', ');
}

/** The item's actions of this type; refused with the actions it does offer when there is none. */
function offered(q: OpenQuestion, type: CliActionType): OpenQuestionAction[] {
  const actions = q.actions.filter((a) => a.type === type);
  if (actions.length === 0) {
    throw new CliError(`${q.id} (${q.kind}) offers no ${type}; its actions: ${describeActions(q)}`);
  }
  return actions;
}

/** A name compared as a person types it: composed, white space collapsed, case ignored. */
function folded(name: string): string {
  return name.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('de');
}

/** `„Name“ (ref)`. */
function candidate(p: ProcessEntry): string {
  return `„${oneLine(p.name)}“ (${p.ref})`;
}

/** A target resolved to a ref, or why it cannot be. */
export type TargetResolution = { ok: true; ref: string } | { ok: false; message: string };

/**
 * A target as the server takes it (M6 §4.8 a "CLI"): a ref as it is (the
 * server checks it), else the processes it names: the one process of the
 * live model with this key, and every process with this name (as the server
 * names processes: the name, else the pool's name, else the id; case and
 * white space ignored). Exactly one is the target; none or several are
 * refused, several with the candidates.
 */
export function resolveTarget(target: string, landscape: LandscapeProcesses): TargetResolution {
  const value = target.trim();
  if (isRef(value)) return { ok: true, ref: value };
  const name = folded(value);
  const byKey = isModelKey(value) ? landscape.processes.filter((p) => p.modelKey === value) : [];
  const byName = landscape.processes.filter((p) => folded(p.name) === name);
  const matches = [...new Map([...byKey, ...byName].map((p) => [p.ref, p])).values()].sort(
    (a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0),
  );
  const [only] = matches;
  if (matches.length === 1 && only !== undefined) return { ok: true, ref: only.ref };
  if (matches.length === 0) {
    const empty = isModelKey(value) && landscape.modelKeys.has(value);
    return {
      ok: false,
      message: empty
        ? `model ${value} has no process`
        : `no process matches ${JSON.stringify(target)}: give a ref (<model key>#<process id>), the key of a model with one process or a process name`,
    };
  }
  const what =
    byKey.length > 1 && byName.length === 0
      ? `model ${value} has ${matches.length} processes`
      : `${JSON.stringify(target)} matches ${matches.length} processes`;
  return {
    ok: false,
    message: `${what}; name one by its ref:\n${matches.map((p) => `  ${candidate(p)}`).join('\n')}`,
  };
}

/**
 * The targets as refs, in the order given, each once; the landscape is read
 * only when a target is no ref.
 *
 * @throws {CliError} listing every target that names no process or several; nothing is sent
 */
async function resolveTargets(api: Api, project: string, targets: readonly string[]) {
  let landscape: LandscapeProcesses | undefined;
  const refs: string[] = [];
  const problems: string[] = [];
  for (const target of targets) {
    if (!isRef(target.trim())) landscape ??= await landscapeProcesses(api, project);
    const r = resolveTarget(target, landscape ?? { processes: [], modelKeys: new Set() });
    if (r.ok) {
      if (!refs.includes(r.ref)) refs.push(r.ref);
    } else problems.push(r.message);
  }
  if (problems.length > 0) throw new CliError(`${problems.join('\n')}\nnothing was sent`);
  return refs;
}

/** The question as one line: subject and text. */
function questionLine(q: Pick<OpenQuestion, 'subjectLabel' | 'text'>): string {
  return `  ${oneLine(q.subjectLabel)}: ${oneLine(q.text)}`;
}

/** The personal-data warning on the note, with its hint. */
function warningLines(r: Pick<OpenQuestionActionResult, 'warnings'>): string[] {
  return r.warnings.length === 0
    ? []
    : [
        `  warning: the note probably contains ${describePersonalData(r.warnings)}`,
        `  ${PERSONAL_DATA_NOTE}`,
      ];
}

/** What became of the item after the action. */
function itemLine(r: OpenQuestionActionResult): string {
  if (r.question === null) return '  the question is resolved and leaves the list';
  return r.question.state === 'answered'
    ? '  the question is answered (outside the landscape)'
    : '  the question is still open';
}

/** A relation an action wrote or decided: `wrote the accepted manual relation a → b (rel_…)`. */
function relationLine(effect: 'manual' | 'decision', r: Relation): string {
  return effect === 'manual'
    ? `  wrote the accepted manual relation ${r.from} → ${r.to} (${r.id})`
    : `  accepted the ${r.type} proposal ${r.from} → ${r.to} (${r.id})`;
}

/** `„Kommissionierung“ on step „Lager“ (step-lager)`, or on no step (`@outside`). */
function placementText(p: Placement): string {
  const process = p.processName === null ? p.process : `„${oneLine(p.processName)}“`;
  if (p.elementId === OUTSIDE_STEP) return `${process} on no step (${OUTSIDE_STEP})`;
  const step = p.stepName === null ? p.elementId : `„${oneLine(p.stepName)}“ (${p.elementId})`;
  return `${process} on step ${step}`;
}

/**
 * Where to undo or change what an action did, in the web UI on the
 * server's origin: each manual relation and each decided proposal in the
 * review screen (`/projects/<p>/review/<relation>`), a placement on the
 * value chain page (`/projects/<p>/value-chain?placement=<placement>`).
 */
function undoLines(url: string, project: string, r: OpenQuestionActionResult): string[] {
  const manual = r.relations.filter((x) => x.effect === 'manual');
  const decided = r.relations.filter((x) => x.effect === 'decision');
  const lines: string[] = [];
  const review = (id: string) => `    ${url}${reviewPath(project, id)}`;
  if (manual.length > 0) {
    lines.push(
      manual.length === 1
        ? '  to undo, reject the manual relation in the review screen of the web UI:'
        : `  to undo, reject the ${manual.length} manual relations in the review screen of the web UI:`,
      ...manual.map((x) => review(x.relation.id)),
    );
  }
  if (decided.length > 0) {
    lines.push(
      decided.length === 1
        ? '  the proposal is decided (no undo); change the decision in the review screen:'
        : `  the ${decided.length} proposals are decided (no undo); change a decision in the review screen:`,
      ...decided.map((x) => review(x.relation.id)),
    );
  }
  for (const p of r.placements) {
    const at = `    ${url}${valueChainPath(project, { placementId: p.placement.id })}`;
    lines.push(
      p.effect === 'manual'
        ? '  to undo, reject the placement on the value chain page of the web UI:'
        : "  this accepted the agent's proposal on that step (no undo); change it on the value chain page:",
      at,
    );
  }
  return lines;
}

/** A link's result as text: the relations it wrote or accepted, the item, how to undo. */
export function formatLink(
  project: string,
  q: OpenQuestion,
  r: OpenQuestionActionResult,
  url: string,
): string {
  if (r.result === 'unchanged') {
    return `${project}: ${q.id} unchanged: every target is linked already\n${questionLine(q)}\n`;
  }
  const lines = [
    `${project}: ${q.id} linked`,
    questionLine(q),
    ...r.relations.map((x) => relationLine(x.effect, x.relation)),
    itemLine(r),
    ...undoLines(url, project, r),
  ];
  return `${[...lines, ...warningLines(r)].join('\n')}\n`;
}

/** A placement's result as text: where the process is placed now, the item, how to undo. */
export function formatPlace(
  project: string,
  q: OpenQuestion,
  r: OpenQuestionActionResult,
  url: string,
): string {
  const [placed] = r.placements;
  if (r.result === 'unchanged' || placed === undefined) {
    return `${project}: ${q.id} unchanged: the process is placed there already\n${questionLine(q)}\n`;
  }
  const lines = [
    `${project}: ${q.id}: placed ${placementText(placed.placement)} (${placed.placement.id})`,
    questionLine(q),
    itemLine(r),
    ...undoLines(url, project, r),
  ];
  return `${[...lines, ...warningLines(r)].join('\n')}\n`;
}

/** An outside mark's result as text: the mark, the item and how to withdraw it. */
export function formatOutside(
  project: string,
  q: OpenQuestion,
  r: OpenQuestionActionResult,
): string {
  const mark = r.answer?.id ?? '?';
  const lines = [
    r.result === 'applied'
      ? `${project}: ${q.id} marked outside the landscape (${mark})`
      : `${project}: ${q.id} unchanged: marked outside the landscape already (${mark})`,
    questionLine(q),
    `  undo with: analyzr questions outside ${q.id} -p ${project} --undo ${mark}`,
  ];
  return `${[...lines, ...warningLines(r)].join('\n')}\n`;
}

/** A withdrawal's result as text. */
export function formatWithdrawal(project: string, r: WithdrawOpenQuestionAnswerResult): string {
  const { answer, question } = r;
  const head = `${project}: outside mark ${answer.id} on ${question.id}`;
  const lines = [
    r.result === 'unchanged'
      ? `${head} unchanged: withdrawn before`
      : question.state === 'answered'
        ? `${head} withdrawn; another outside mark still answers the question`
        : `${head} withdrawn; the question is open again`,
    questionLine(question),
  ];
  return `${lines.join('\n')}\n`;
}

/** Prints the result: JSON, or the text. */
function print(io: CliIo, opts: ActOptions, result: unknown, text: () => string): void {
  io.stdout(opts.json ? `${JSON.stringify(result, null, 2)}\n` : text());
}

/** `POST …/open-questions/{id}/actions`. */
async function act(
  api: Api,
  project: string,
  question: string,
  body: Parameters<typeof actOnOpenQuestion>[0]['body'],
): Promise<OpenQuestionActionResult> {
  return call(
    api,
    `${body.type} ${question} in ${project}`,
    actOnOpenQuestion({ client: api.client, path: { project, question }, body }),
  );
}

/**
 * `analyzr questions outside <id> -p <project> [--note <text>] [--json]`, or
 * `--undo <answer id>` to withdraw a mark.
 */
export async function questionsOutsideCommand(
  io: CliIo,
  id: string,
  opts: OutsideOptions,
): Promise<void> {
  refuseAgent(io, opts, 'outside');
  const question = parseQuestionId(id);
  if (opts.undo !== undefined) {
    if (opts.note !== undefined) {
      throw new CliError('--undo withdraws a mark and takes no --note: drop one of them');
    }
    const answer = opts.undo.trim();
    if (!OpenQuestionAnswerId.safeParse(answer).success) {
      throw new CliError(
        `not an answer id: ${JSON.stringify(opts.undo)} (oqa_ and 26 characters, as analyzr questions outside printed it)`,
      );
    }
    const api = createApi(io, opts.url, await ownerCredential(io, opts));
    const result = await call(
      api,
      `withdraw the outside mark ${answer} of ${question} in ${opts.project}`,
      withdrawOpenQuestionAnswer({
        client: api.client,
        path: { project: opts.project, question, answer },
      }),
    );
    print(io, opts, result, () => formatWithdrawal(opts.project, result));
    return;
  }
  const note = parseNote(opts.note);
  const api = createApi(io, opts.url, await ownerCredential(io, opts));
  const item = await findQuestion(api, opts.project, question);
  offered(item, 'outside');
  const result = await act(api, opts.project, question, {
    type: 'outside',
    ...(note === undefined ? {} : { note }),
  });
  print(io, opts, result, () => formatOutside(opts.project, item, result));
}

/**
 * The pair of `--pair <from> <to>` as the item lists it (either way round).
 *
 * @throws {CliError} without a pair, or for one the item does not list, with the listed pairs
 */
function listedPair(
  q: OpenQuestion,
  action: OpenQuestionAction,
  refs: readonly string[] | undefined,
): { from: string; to: string } {
  const pairs = action.pairs ?? [];
  const [a, b] = refs ?? [];
  const found = pairs.find((p) => (p.from === a && p.to === b) || (p.from === b && p.to === a));
  if (found) return { from: found.from, to: found.to };
  const list = pairs.map((p) => `  ${p.type} ${p.from} → ${p.to}`).join('\n');
  throw new CliError(
    `${refs === undefined ? `${q.id} links one of the pairs it lists: give --pair <from> <to>` : `${refs.join(' ')} is none of the pairs ${q.id} lists`}; the pairs:\n${list}`,
  );
}

/** `analyzr questions link <id> -p <project> --to <target>… | --pair <from> <to> [--note] [--json]`. */
export async function questionsLinkCommand(
  io: CliIo,
  id: string,
  opts: LinkOptions,
): Promise<void> {
  refuseAgent(io, opts, 'link');
  const question = parseQuestionId(id);
  const targets = (opts.to ?? []).map((t) => t.trim());
  const pair = opts.pair?.map((r) => r.trim());
  if (pair !== undefined) {
    if (targets.length > 0)
      throw new CliError('give --to <target> or --pair <from> <to>, not both');
    if (pair.length !== 2 || !pair.every(isRef)) {
      throw new CliError(
        `--pair takes two refs (<model key>#<element id>), as the question lists them; got ${pair.map((r) => JSON.stringify(r)).join(' ')}`,
      );
    }
  } else if (targets.length === 0) {
    throw new CliError(
      'give the target with --to <target> (a ref, the key of a model with one process or a process name; repeat --to for several), or one of the pairs the question lists with --pair <from> <to>',
    );
  }
  if (targets.some((t) => t === '')) throw new CliError('--to needs a target, not an empty text');
  if (targets.length > MAX_LINK_TARGETS) {
    throw new CliError(`${targets.length} targets; at most ${MAX_LINK_TARGETS} per link`);
  }
  const note = parseNote(opts.note);
  const api = createApi(io, opts.url, await ownerCredential(io, opts));
  const item = await findQuestion(api, opts.project, question);
  const [action] = offered(item, 'link');
  if (!action) throw new Error('offered() returns at least one action');
  const extra = note === undefined ? {} : { note };
  let result: OpenQuestionActionResult;
  if (action.pick === 'pair') {
    const listed = listedPair(item, action, pair);
    result = await act(api, opts.project, question, { type: 'link', pair: listed, ...extra });
  } else {
    if (pair !== undefined) {
      throw new CliError(`${question} links targets, not a pair: give --to <target>`);
    }
    if (action.multiple !== true && targets.length > 1) {
      throw new CliError(
        `${question} links one target („${oneLine(action.label)}“): give one --to`,
      );
    }
    const refs = await resolveTargets(api, opts.project, targets);
    result = await act(api, opts.project, question, { type: 'link', targets: refs, ...extra });
  }
  print(io, opts, result, () => formatLink(opts.project, item, result, opts.url));
}

/** `analyzr questions place <id> -p <project> --step <step>|@outside | --process <target> [--note] [--json]`. */
export async function questionsPlaceCommand(
  io: CliIo,
  id: string,
  opts: PlaceOptions,
): Promise<void> {
  refuseAgent(io, opts, 'place');
  const question = parseQuestionId(id);
  const step = opts.step?.trim();
  if (step !== undefined && (step === '' || step.length > MAX_VALUE_CHAIN_ID_CHARS)) {
    throw new CliError(
      `not a step: ${JSON.stringify(opts.step)} (a step element id of the value chain, or ${OUTSIDE_STEP})`,
    );
  }
  const process = opts.process?.trim();
  if (process === '') throw new CliError('--process needs a process, not an empty text');
  if (step === undefined && process === undefined) {
    throw new CliError(
      `give the step with --step <step element id> or --step ${OUTSIDE_STEP} (a step question: the process with --process <target>)`,
    );
  }
  const note = parseNote(opts.note);
  const api = createApi(io, opts.url, await ownerCredential(io, opts));
  const item = await findQuestion(api, opts.project, question);
  offered(item, 'place');
  const extra = note === undefined ? {} : { note };
  let body: Parameters<typeof act>[3];
  if (item.subject.type === 'step') {
    if (step !== undefined && step !== item.subject.id) {
      throw new CliError(
        `${question} places a process on its step ${item.subject.id}: drop --step and give the process with --process <target>`,
      );
    }
    if (process === undefined) {
      throw new CliError(
        `${question} places a process on its step ${item.subject.id}: give it with --process <target> (a ref, the key of a model with one process or a process name)`,
      );
    }
    const [ref] = await resolveTargets(api, opts.project, [process]);
    if (ref === undefined) throw new Error('resolveTargets() resolves every target');
    body = { type: 'place', step: item.subject.id, process: ref, ...extra };
  } else {
    if (process !== undefined) {
      throw new CliError(
        `${question} places its own process ${item.subject.id}: drop --process and give the step with --step`,
      );
    }
    if (step === undefined) {
      throw new CliError(`give the step with --step <step element id> or --step ${OUTSIDE_STEP}`);
    }
    body = { type: 'place', step, ...extra };
  }
  const result = await act(api, opts.project, question, body);
  print(io, opts, result, () => formatPlace(opts.project, item, result, opts.url));
}

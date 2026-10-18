/**
 * The open-questions read model (M6 §4.2): every source of §4.1 and the gap
 * signals of §4.3 as one deterministic list, then filtered and paged. Never
 * stored and never a stage: open questions change no model's or chain's
 * stage (decision 8). Pure.
 */
import {
  AGENT_WORDS,
  type OpenQuestion,
  type OpenQuestionFilter,
  type OpenQuestionKind,
  type OpenQuestionPage,
  type OpenQuestionTotals,
} from '@analyzr/contracts';

import { encodeCursor } from '../cursor.ts';
import { actionsFor, resolvedByLink, resolvedCopies } from './actions.ts';
import { amendmentQuestions } from './amendment-questions.ts';
import { isLiveMark } from './answers.ts';
import {
  OpenQuestionIndex,
  comparePositions,
  finish,
  openQuestionId,
  positionOf,
  type Draft,
  type OpenQuestionInput,
  type OpenQuestionPosition,
} from './model.ts';
import { GAP_SIGNALS, SHIPPED_SIGNALS, signalQuestions, type GapSignal } from './signals.ts';
import {
  agentQuestions,
  chainFindingQuestions,
  findingQuestions,
  holdQuestions,
  noLinkQuestions,
  submissionQuestions,
  unsureQuestions,
} from './sources.ts';

export interface OpenQuestionOptions {
  /** The gap signals to compute (default: the shipped ones). */
  signals?: readonly GapSignal[];
}

/**
 * Every open question of the input, in list order: questions, then the
 * value chain's findings, then informational items, each group by
 * `unlocks` descending, then subject id, kind (enum order) and id. An id
 * occurs once (the first draft wins, which only matters for drafts
 * identical in kind, subject and source version). Items an accepted link
 * resolved (R1), duplicated process ids without a call waiting for a
 * decision (R1b) and a second question about one process
 * ({@link oneQuestionPerProcess}) are left out (M6 §4.8 a); an agent's
 * coded no-link about a gap a rule-tier item asks already joins that item
 * ({@link mergeCodedNoLinks}).
 */
export function openQuestions(
  input: OpenQuestionInput,
  options: OpenQuestionOptions = {},
): OpenQuestion[] {
  return buildOpenQuestions(input, options).items;
}

/** {@link openQuestions} with the index it was computed over (the action use case reads both). */
export function buildOpenQuestions(
  input: OpenQuestionInput,
  options: OpenQuestionOptions = {},
): { index: OpenQuestionIndex; items: OpenQuestion[] } {
  const ix = new OpenQuestionIndex(input);
  const drafts = mergeCodedNoLinks(
    ix,
    oneQuestionPerProcess([
      ...findingQuestions(ix),
      ...chainFindingQuestions(ix),
      ...holdQuestions(ix),
      ...agentQuestions(ix),
      ...unsureQuestions(ix),
      ...noLinkQuestions(ix),
      ...submissionQuestions(ix),
      ...signalQuestions(ix, options.signals ?? SHIPPED_SIGNALS),
      ...amendmentQuestions(ix),
    ]),
  );
  const byId = new Map<string, OpenQuestion>();
  for (const d of drafts) {
    if (resolvedByLink(ix, d)) continue;
    if (d.kind === 'duplicate-process-id' && resolvedCopies(ix, d.refs)) continue;
    const q = finish(ix, d, actionsFor);
    if (!byId.has(q.id)) byId.set(q.id, q);
  }
  return {
    index: ix,
    items: [...byId.values()].sort((a, b) => comparePositions(positionOf(a), positionOf(b))),
  };
}

/**
 * One question per process (M6 §4.8 a, extended by UX2a): a process's
 * `process-without-step` item is left out while an agent's question on a
 * placement of the process or an unsure verdict about it asks already (a
 * held placement leaves it out at its source, `chainFindingQuestions`).
 * Read model only: the chain's findings, „Befunde“ and the claim inputs stay
 * as they are.
 */
export function oneQuestionPerProcess(drafts: readonly Draft[]): Draft[] {
  const asked = new Set<string>();
  for (const d of drafts) {
    if (d.kind === 'placement-unsure') asked.add(d.subject.id);
    if (d.kind === 'agent-question' && d.subject.type === 'placement') {
      for (const process of d.anchors.processes ?? []) asked.add(process);
    }
  }
  return drafts.filter((d) => d.kind !== 'process-without-step' || !asked.has(d.subject.id));
}

/** The draft's id, to look up what was recorded under it. */
const draftId = (d: Draft): string => openQuestionId(d.kind, d.subject, d.version);

/**
 * One item per gap (UX2b review): an agent's coded no-link that asks what a
 * rule-tier item asks already joins that item. A `call-target-unknown`
 * no-link joins the finding on the same call (`call-target-unknown` or
 * `call-target-dynamic`, which the procedure says comes with it); an
 * `external-partner` no-link joins the `black-box-partner` item whose flows
 * end at its endpoint (`collaboration`: the endpoint talks to a pool of its
 * own file). The survivor's reason gains the agents' reasons verbatim
 * („Laut Agent: …“), and its answers show the notes and withdrawn marks
 * recorded under the merged item. A merged item that carries a live outside
 * mark stays an item of its own (answered, so not in „Zu klären“), so the
 * mark keeps its place. Read model only: the no-links, the findings and the
 * claim inputs stay as they are.
 */
export function mergeCodedNoLinks(ix: OpenQuestionIndex, drafts: readonly Draft[]): Draft[] {
  const calls = new Map<string, Draft>();
  const boxes = new Map<string, Draft>();
  for (const d of drafts) {
    if (
      d.source === 'finding' &&
      (d.kind === 'call-target-unknown' || d.kind === 'call-target-dynamic') &&
      !calls.has(d.subject.id)
    )
      calls.set(d.subject.id, d);
    if (d.kind === 'black-box-partner') {
      for (const ref of d.anchors.refs ?? []) {
        for (const at of [ref, ix.anchorOf(ref)]) {
          if (at !== undefined && !boxes.has(at)) boxes.set(at, d);
        }
      }
    }
  }
  const into = new Map<Draft, Draft[]>();
  const kept: Draft[] = [];
  for (const d of drafts) {
    const survivor =
      d.source !== 'no-link'
        ? undefined
        : d.kind === 'call-target-unknown'
          ? calls.get(d.subject.id)
          : d.kind === 'external-partner'
            ? boxes.get(d.subject.id)
            : undefined;
    if (survivor === undefined || ix.answersOf(draftId(d)).some(isLiveMark)) {
      kept.push(d);
      continue;
    }
    into.set(survivor, [...(into.get(survivor) ?? []), d]);
  }
  return kept.map((d) => {
    const merged = into.get(d);
    if (merged === undefined) return d;
    const reasons = [
      ...new Set(merged.flatMap((m) => (m.detail ?? '').split('\n')).filter((r) => r !== '')),
    ];
    return {
      ...d,
      detail: [d.detail ?? null, ...reasons.map((r) => `${AGENT_WORDS}: ${r}`)]
        .filter((p) => p !== null)
        .join('\n'),
      merged: merged.map(draftId),
    };
  });
}

/** How many items each gap signal yields on the input (every signal, shipped or not). */
export function signalCounts(input: OpenQuestionInput): Record<GapSignal, number> {
  const items = openQuestions(input, { signals: GAP_SIGNALS });
  const out = Object.fromEntries(GAP_SIGNALS.map((s) => [s, 0])) as Record<GapSignal, number>;
  for (const q of items) if (q.source === 'signal') out[q.kind as GapSignal]++;
  return out;
}

/** How many items there are per kind. */
export function kindCounts(
  items: readonly OpenQuestion[],
): Partial<Record<OpenQuestionKind, number>> {
  const out: Partial<Record<OpenQuestionKind, number>> = {};
  for (const q of items) out[q.kind] = (out[q.kind] ?? 0) + 1;
  return out;
}

/** Does a model key match the `modelKey` filter: the model itself, or a model below that folder? */
function inModel(modelKeys: readonly string[], filter: string): boolean {
  return modelKeys.some((k) => k === filter || k.startsWith(`${filter}/`));
}

/** The items matching every given filter (M6 §4.4; `group` since UX2a), in their order. */
export function filterOpenQuestions(
  items: readonly OpenQuestion[],
  filter: OpenQuestionFilter,
): OpenQuestion[] {
  const groups = filter.group === undefined ? undefined : new Set(filter.group);
  return items.filter(
    (q) =>
      (filter.modelKey === undefined || inModel(q.modelKeys, filter.modelKey)) &&
      (filter.kind === undefined || q.kind === filter.kind) &&
      (filter.source === undefined || q.source === filter.source) &&
      (filter.state === undefined || q.state === filter.state) &&
      (groups === undefined || groups.has(q.group)) &&
      (filter.askWho === undefined ||
        q.askWho.lanes.includes(filter.askWho) ||
        q.askWho.stepOwners.includes(filter.askWho) ||
        q.askWho.folder === filter.askWho),
  );
}

/** The items per group (UX2a), every group present. */
export function groupTotals(items: readonly OpenQuestion[]): OpenQuestionTotals {
  const out: OpenQuestionTotals = { ask: 0, agent: 0, proposal: 0, info: 0 };
  for (const q of items) out[q.group]++;
  return out;
}

/**
 * Per model, the distinct subjects of the `ask` items that are neither a
 * relation nor a placement (UX2a: the models table's „Offene Punkte“ counts
 * relations and placements where they are decided), an item under each
 * model it touches; only models with one or more, by key.
 */
export function askByModel(items: readonly OpenQuestion[]): Record<string, number> {
  const subjects = new Map<string, Set<string>>();
  for (const q of items) {
    if (q.group !== 'ask' || q.subject.type === 'relation' || q.subject.type === 'placement') {
      continue;
    }
    for (const key of q.modelKeys) {
      const of = subjects.get(key) ?? new Set<string>();
      of.add(`${q.subject.type}:${q.subject.id}`);
      subjects.set(key, of);
    }
  }
  return Object.fromEntries(
    [...subjects]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, of]) => [key, of.size]),
  );
}

/**
 * A page of `items` (in list order) after the cursor position: the cursor
 * holds the position of the last item of the previous page, so a page
 * starts after it even when items came or went since.
 */
export function pageOpenQuestions(
  items: readonly OpenQuestion[],
  limit: number,
  after?: OpenQuestionPosition,
): Pick<OpenQuestionPage, 'items' | 'nextCursor' | 'total'> {
  const start =
    after === undefined
      ? 0
      : ((i) => (i < 0 ? items.length : i))(
          items.findIndex((q) => comparePositions(positionOf(q), after) > 0),
        );
  const page = items.slice(start, start + limit);
  const last = page.at(-1);
  return {
    items: page,
    nextCursor:
      start + limit < items.length && last !== undefined ? encodeCursor(positionOf(last)) : null,
    total: items.length,
  };
}

/**
 * The list route's page (UX2a): the items matching every filter, paged;
 * `totals` and `askByModel` over the items matching every filter but
 * `group`, so the tab's badge and count lines come from one computation.
 */
export function openQuestionPage(
  items: readonly OpenQuestion[],
  filter: OpenQuestionFilter,
  limit: number,
  after?: OpenQuestionPosition,
): OpenQuestionPage {
  const { group, ...rest } = filter;
  const base = filterOpenQuestions(items, rest);
  const matching = group === undefined ? base : filterOpenQuestions(base, { group });
  return {
    ...pageOpenQuestions(matching, limit, after),
    totals: groupTotals(base),
    askByModel: askByModel(base),
  };
}

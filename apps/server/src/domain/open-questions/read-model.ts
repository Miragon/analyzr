/**
 * The open-questions read model (M6 §4.2): every source of §4.1 and the gap
 * signals of §4.3 as one deterministic list, then filtered and paged. Never
 * stored and never a stage: open questions change no model's or chain's
 * stage (decision 8). Pure.
 */
import type {
  OpenQuestion,
  OpenQuestionFilter,
  OpenQuestionKind,
  OpenQuestionPage,
} from '@analyzr/contracts';

import { encodeCursor } from '../cursor.ts';
import { actionsFor, resolvedByLink, resolvedCopies } from './actions.ts';
import {
  OpenQuestionIndex,
  comparePositions,
  finish,
  positionOf,
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
 * resolved (R1) and duplicated process ids without a call waiting for a
 * decision (R1b) are left out (M6 §4.8 a).
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
  const drafts = [
    ...findingQuestions(ix),
    ...chainFindingQuestions(ix),
    ...holdQuestions(ix),
    ...agentQuestions(ix),
    ...unsureQuestions(ix),
    ...noLinkQuestions(ix),
    ...submissionQuestions(ix),
    ...signalQuestions(ix, options.signals ?? SHIPPED_SIGNALS),
  ];
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

/** The items matching every given filter (M6 §4.4), in their order. */
export function filterOpenQuestions(
  items: readonly OpenQuestion[],
  filter: OpenQuestionFilter,
): OpenQuestion[] {
  return items.filter(
    (q) =>
      (filter.modelKey === undefined || inModel(q.modelKeys, filter.modelKey)) &&
      (filter.kind === undefined || q.kind === filter.kind) &&
      (filter.source === undefined || q.source === filter.source) &&
      (filter.state === undefined || q.state === filter.state) &&
      (filter.askWho === undefined ||
        q.askWho.lanes.includes(filter.askWho) ||
        q.askWho.stepOwners.includes(filter.askWho) ||
        q.askWho.folder === filter.askWho),
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
): OpenQuestionPage {
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

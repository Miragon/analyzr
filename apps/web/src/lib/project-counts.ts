import type {
  Model,
  PlacementSummary,
  ProjectSummary,
  Relation,
  ValueChainDetail,
} from '@analyzr/client';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { ApiError } from './api';
import {
  landscapeQuery,
  modelsQuery,
  openQuestionSummaryQuery,
  valueChainQuery,
  type OpenQuestionSummary,
} from './queries';
import { splitRef } from './refs';
import { isReviewItem } from './review';
import { isOpenPlacement } from './value-chain';

/**
 * Every count of a project's open work in one place (UX-SIMPLIFICATION.md
 * §2.3, §2.5, P5 and P7): the tab badges, „Als Nächstes“ and the models
 * table's „Offene Punkte“ read the same numbers, so a number means the same
 * on every screen. The three badges never count the same item: „Relationen“
 * the relations waiting for a decision (`isReviewItem`), „Wertschöpfungskette“
 * the open placements (`isOpenPlacement`), „Offene Fragen“ `totals.ask`; holds
 * count only in „Offene Fragen“.
 */

/** A model's open points, split by where to act. */
export interface OpenPoints {
  total: number;
  /** Relations touching the model: proposed, held, or accepted with a changed endpoint. */
  relations: number;
  /** Open placements of the model's processes, and its held ones (their answer is open work). */
  placements: number;
  /** „Zu klären“ whose subject is neither a relation nor a placement. */
  questions: number;
}

export interface ProjectWork {
  /** Badge „Relationen“; `undefined` while loading. */
  reviewItems: number | undefined;
  /** Badge „Wertschöpfungskette“: 0 without a chain; `undefined` while loading. */
  openPlacements: number | undefined;
  /** Badge „Offene Fragen“ (`totals.ask` of the open questions); `undefined` while loading. */
  ask: number | undefined;
  /** The agents' open questions (`totals.agent`; no badge, the export's option); `undefined` while loading. */
  agent: number | undefined;
  /**
   * Every count has loaded (relations, chain, open questions). Until then
   * „Als Nächstes“ and „Offene Punkte“ show a placeholder instead of numbers
   * that would jump once the rest arrives.
   */
  ready: boolean;
  /**
   * The open points of one model (from `Model.openItems`, the chain and
   * `askByModel`); `null` until {@link ProjectWork.ready}.
   */
  openPoints: (model: Pick<Model, 'key' | 'openItems'>) => OpenPoints | null;
}

export interface WorkInput {
  relations: readonly Pick<Relation, 'status' | 'endpointState'>[] | undefined;
  /** `null`: the project has no chain (404). */
  chain: Pick<ValueChainDetail, 'placements'> | null | undefined;
  summary: OpenQuestionSummary | undefined;
  /**
   * Every query behind the counts has settled, also with an error (then its
   * part counts as 0). Without it, ready means every input is present.
   */
  settled?: boolean;
}

/**
 * A held placement that still waits for its answer and decision: on a live
 * step, both ends there (the read model asks its question then, `held` in
 * „Zu klären“). Not in the chain's badge (holds count in „Offene Fragen“),
 * but open work of its model.
 */
const isLiveHold = (p: Pick<PlacementSummary, 'status' | 'stepLive' | 'endpointState'>): boolean =>
  p.status === 'held' && p.stepLive && p.endpointState !== 'missing';

/**
 * The placements per model key that are open work of the model (by the
 * placement's process ref): the open ones (`isOpenPlacement`) and the live
 * holds, whose question names no model in `askByModel` (its subject is the
 * placement).
 */
export function openPlacementsByModel(
  chain: Pick<ValueChainDetail, 'placements'> | null | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of chain?.placements ?? []) {
    if (!isOpenPlacement(p) && !isLiveHold(p)) continue;
    const { modelKey } = splitRef(p.process);
    out.set(modelKey, (out.get(modelKey) ?? 0) + 1);
  }
  return out;
}

/** The counts from what the shell loads anyway (pure; {@link useProjectCounts} feeds it). */
export function projectWork({ relations, chain, summary, settled }: WorkInput): ProjectWork {
  const byModel = openPlacementsByModel(chain);
  const ready =
    settled ?? (relations !== undefined && chain !== undefined && summary !== undefined);
  return {
    reviewItems: relations?.filter(isReviewItem).length,
    openPlacements:
      chain === undefined
        ? undefined
        : chain === null
          ? 0
          : chain.placements.filter(isOpenPlacement).length,
    ask: summary?.totals.ask,
    agent: summary?.totals.agent,
    ready,
    openPoints: (model) => {
      if (!ready) return null;
      const placements = byModel.get(model.key) ?? 0;
      const questions = summary?.askByModel[model.key] ?? 0;
      return {
        total: model.openItems + placements + questions,
        relations: model.openItems,
        placements,
        questions,
      };
    },
  };
}

/**
 * A project's open points for the projects list's „Offen für dich“ (UX9,
 * UX-SIMPLIFICATION.md §3.12 item 1): its three badges from the server's
 * summary, the same rules as {@link projectWork}, so the number equals the
 * sum of the project's tab badges.
 */
export function summaryPoints(
  summary: Pick<ProjectSummary, 'reviewItems' | 'openPlacements' | 'ask'>,
): OpenPoints {
  return {
    total: summary.reviewItems + summary.openPlacements + summary.ask,
    relations: summary.reviewItems,
    placements: summary.openPlacements,
    questions: summary.ask,
  };
}

/** „6 Relationen · 1 Platzierung · 1 Frage“ (only the non-zero parts). */
export function openPointsText(points: OpenPoints): string {
  const part = (n: number, one: string, many: string) =>
    n === 0 ? null : `${n} ${n === 1 ? one : many}`;
  return [
    part(points.relations, 'Relation', 'Relationen'),
    part(points.placements, 'Platzierung', 'Platzierungen'),
    part(points.questions, 'Frage', 'Fragen'),
  ]
    .filter((p) => p !== null)
    .join(' · ');
}

const isNotFound = (error: unknown) => error instanceof ApiError && error.status === 404;

/**
 * {@link projectWork} over the project's queries (the models, the landscape,
 * the chain and the open questions' summary, all cached for the shell).
 */
export function useProjectCounts(project: string): ProjectWork & {
  models: readonly Model[] | undefined;
  chain: ValueChainDetail | null | undefined;
} {
  const models = useQuery(modelsQuery(project));
  const landscape = useQuery(landscapeQuery(project));
  const chain = useQuery(valueChainQuery(project));
  const summary = useQuery(openQuestionSummaryQuery(project));
  const chainState = chain.data ?? (isNotFound(chain.error) ? null : undefined);
  const settled = !landscape.isPending && !chain.isPending && !summary.isPending;
  const work = useMemo(
    () =>
      projectWork({
        relations: landscape.data?.relations,
        chain: chainState,
        summary: summary.data,
        settled,
      }),
    [landscape.data, chainState, summary.data, settled],
  );
  return { ...work, models: models.data, chain: chainState };
}

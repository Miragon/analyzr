/**
 * The impacts of a dry run's batches as one (M6 §3.5, S2b follow-up), shared
 * by `analyzr import --dry-run`, the web's „Vorschau“ and the integrate
 * plugin's script. Zod-free on purpose: the web imports it at runtime as
 * `@analyzr/contracts/impact-merge` without pulling the schemas into its
 * entry chunk; it takes only types from `api/models.ts`.
 *
 * A batch is previewed against the head, so the merge adds up what the
 * batches count and concatenates their items up to the server's cap; a pair
 * between models of two batches counts in both (the surfaces say „etwa“).
 * The placement task's counts (a project with a value chain) are
 * approximate across batches too: each batch counts the processes due after
 * its own files against the head.
 */
import type { ImportImpact } from './api/models.ts';

/** Most items an impact list carries (M6 §3.5); `count` says how many there are. */
export const MAX_IMPACT_ITEMS = 100;

/** The trust rule's reasons (M6 S2c, decision 24.2) in their order: `TrustReason` is this enum. */
export const TRUST_REASON_ORDER = [
  'no-engine',
  'agent-upload',
  'converted',
  'reconstructed',
  'as-told',
] as const;

/** `T` with every string type widened to `string`, so the client's generated types fit too. */
type Loose<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? Loose<U>[]
    : T extends object
      ? { [K in keyof T]: Loose<T[K]> }
      : T;

/** An impact as the contracts or the generated client type it. */
export type MergeableImpact = Loose<ImportImpact>;

interface Counted<T> {
  count: number;
  items: T[];
}

const sum = (values: readonly number[]): number => values.reduce((n, v) => n + v, 0);
const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** One list of several impacts: counts added up, items concatenated up to the cap. */
function mergeList<T>(lists: readonly Counted<T>[]): Counted<T> {
  return {
    count: sum(lists.map((l) => l.count)),
    items: lists.flatMap((l) => l.items).slice(0, MAX_IMPACT_ITEMS),
  };
}

/** The calls only proposed (M6 S2c): totals added up, reasons in their order. */
function mergeProposedCalls(impacts: readonly MergeableImpact[]): MergeableImpact['callsProposed'] {
  const lists = impacts.map((i) => i.callsProposed);
  const byReason = new Map<string, number>();
  for (const { reason, count } of lists.flatMap((l) => l.byReason)) {
    byReason.set(reason, (byReason.get(reason) ?? 0) + count);
  }
  return {
    ...mergeList(lists),
    wasAccepted: sum(lists.map((l) => l.wasAccepted)),
    byReason: TRUST_REASON_ORDER.filter((reason) => byReason.has(reason)).map((reason) => ({
      reason,
      count: byReason.get(reason) ?? 0,
    })),
  };
}

/**
 * The calls an owner's rules for derived calls would accept (M6 S2c-3):
 * totals added up per rule, in first-seen order; absent when no batch has
 * them (only an owner's dry run has them).
 */
function mergeAutoAccepted(
  impacts: readonly MergeableImpact[],
): Pick<MergeableImpact, 'autoAcceptedCalls'> {
  const lists = impacts.flatMap((i) => (i.autoAcceptedCalls ? [i.autoAcceptedCalls] : []));
  if (lists.length === 0) return {};
  const byRule = new Map<string, { ruleId: string; ruleName: string; count: number }>();
  for (const r of lists.flatMap((l) => l.byRule)) {
    const seen = byRule.get(r.ruleId);
    byRule.set(r.ruleId, seen ? { ...seen, count: seen.count + r.count } : { ...r });
  }
  return {
    autoAcceptedCalls: {
      ...mergeList(lists),
      ofProposed: sum(lists.map((l) => l.ofProposed)),
      byRule: [...byRule.values()],
    },
  };
}

const pairKey = (r: { type: string; from: string; to: string }): string =>
  `${r.type}\u0000${r.from}\u0000${r.to}`;

/**
 * The relations tasks (S2b follow-up): the queued and cancelled tasks
 * concatenated (models never repeat across batches) and sorted again as the
 * server sorts them, the queued by key, the cancelled claimed first, then
 * by key (batches follow the paths, pinned keys need not), so a claimed one
 * stays listed past the cap; `claimed` and `pairs` added up; the pairs
 * judged again deduplicated by item (a pair between models of two batches
 * is listed by both), their count lowered by the duplicates found. Each
 * batch lists its first items, so the first of all are among them.
 */
function mergeRelationsTasks(
  impacts: readonly MergeableImpact[],
): MergeableImpact['relationsTasks'] {
  const tasks = impacts.map((i) => i.relationsTasks);
  const claimedFirst = (a: { state: string }) => (a.state === 'claimed' ? 0 : 1);
  const cancelled = tasks
    .flatMap((t) => t.cancelled.items)
    .sort((a, b) => claimedFirst(a) - claimedFirst(b) || byCodePoint(a.modelKey, b.modelKey));
  const seen = new Set<string>();
  const rejudged: MergeableImpact['relationsTasks']['rejudged']['items'] = [];
  for (const r of tasks.flatMap((t) => t.rejudged.items)) {
    const key = pairKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    rejudged.push(r);
  }
  const listed = sum(tasks.map((t) => t.rejudged.items.length));
  return {
    queued: {
      count: sum(tasks.map((t) => t.queued.count)),
      items: tasks
        .flatMap((t) => t.queued.items)
        .sort(byCodePoint)
        .slice(0, MAX_IMPACT_ITEMS),
    },
    cancelled: {
      count: sum(tasks.map((t) => t.cancelled.count)),
      items: cancelled.slice(0, MAX_IMPACT_ITEMS),
    },
    claimed: sum(tasks.map((t) => t.claimed)),
    pairs: sum(tasks.map((t) => t.pairs)),
    rejudged: {
      count: sum(tasks.map((t) => t.rejudged.count)) - (listed - rejudged.length),
      items: rejudged
        .sort(
          (a, b) =>
            byCodePoint(a.type, b.type) || byCodePoint(a.from, b.from) || byCodePoint(a.to, b.to),
        )
        .slice(0, MAX_IMPACT_ITEMS),
    },
  };
}

type PlacementOutcome = NonNullable<ImportImpact['placementTask']>['outcome'];

/**
 * The rank of each placement task outcome, weakest first: the merge keeps
 * the strongest of the batches. Every outcome of the contract has one (the
 * record's type checks it).
 */
const PLACEMENT_OUTCOME_RANK: Readonly<Record<PlacementOutcome, number>> = {
  'not-triggered': 0,
  'nothing-due': 1,
  queued: 2,
  open: 3,
  deferred: 4,
};

const outcomeRanks: ReadonlyMap<string, number> = new Map(Object.entries(PLACEMENT_OUTCOME_RANK));

/** The rank of an outcome as the client types it (a string). */
const outcomeRank = (outcome: string): number => outcomeRanks.get(outcome) ?? -1;

/**
 * The value chain's part (S2b follow-up), absent when no batch has it (a
 * project without a live chain): the accepted placements whose process
 * changes concatenated and sorted again as the server sorts them, by
 * process, then step (a process belongs to one batch, so the count is
 * exact); the placement task with the strongest outcome (deferred, open,
 * queued, nothing-due, not-triggered: the write that queues tells), the
 * most processes due of a batch (approximate, the largest batch's count:
 * each batch counts against the head, so another batch's revert or removed
 * process is not seen) and the newly due and placed-again ones added up
 * (approximate: a process two batches make due counts in both).
 */
function mergePlacements(
  impacts: readonly MergeableImpact[],
): Pick<MergeableImpact, 'placementsChanged' | 'placementTask'> {
  const changed = impacts.flatMap((i) => (i.placementsChanged ? [i.placementsChanged] : []));
  const tasks = impacts.flatMap((i) => (i.placementTask ? [i.placementTask] : []));
  const [first, ...rest] = tasks;
  return {
    ...(changed.length > 0
      ? {
          placementsChanged: {
            count: sum(changed.map((l) => l.count)),
            items: changed
              .flatMap((l) => l.items)
              .sort((a, b) => byCodePoint(a.process, b.process) || byCodePoint(a.step, b.step))
              .slice(0, MAX_IMPACT_ITEMS),
          },
        }
      : {}),
    ...(first
      ? {
          placementTask: {
            outcome: rest.reduce(
              (best, t) => (outcomeRank(t.outcome) > outcomeRank(best) ? t.outcome : best),
              first.outcome,
            ),
            due: Math.max(...tasks.map((t) => t.due)),
            newlyDue: sum(tasks.map((t) => t.newlyDue)),
            again: sum(tasks.map((t) => t.again)),
          },
        }
      : {}),
  };
}

/**
 * The impacts of a dry run's batches as one: the files concatenated, the
 * counts added up, the items concatenated up to the cap; the absent keys are
 * the first batch's (every batch sends the whole manifest, so all name the
 * same). Returns the type it gets (the contracts' or the client's).
 */
export function mergeImpacts<T extends MergeableImpact>(impacts: readonly T[]): T {
  const merged: MergeableImpact = {
    files: impacts.flatMap((i) => i.files),
    acceptedCalls: mergeList(impacts.map((i) => i.acceptedCalls)),
    callsProposed: mergeProposedCalls(impacts),
    ...mergeAutoAccepted(impacts),
    proposalsAdded: mergeList(impacts.map((i) => i.proposalsAdded)),
    proposalsWithdrawn: mergeList(impacts.map((i) => i.proposalsWithdrawn)),
    endpointsChanged: mergeList(impacts.map((i) => i.endpointsChanged)),
    findingsAdded: mergeList(impacts.map((i) => i.findingsAdded)),
    findingsResolved: mergeList(impacts.map((i) => i.findingsResolved)),
    absentKeys: impacts[0]?.absentKeys ?? { count: 0, items: [] },
    relationsTasks: mergeRelationsTasks(impacts),
    ...mergePlacements(impacts),
  };
  return merged as T;
}

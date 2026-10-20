/**
 * What a new head does to its model's `relations` task (CONCEPT §3
 * "Requeue"), pure: the write's `queueAnalysis` and the dry runs (M6 S2b
 * follow-up: the tasks an import queues and cancels, the amendment cost's
 * claimed task) plan with the same function, so a dry run names what the
 * write then does. Its own module: `ingest.ts` imports `import-impact.ts`,
 * which needs it too.
 */

/** The open task (queued or claimed) of a model, as the plan reads it: the facts it analyses. */
export interface OpenTask {
  factsHash: string;
}

/** What the write does: queue a new task, and cancel the open one first (`null`: none). */
export interface QueuePlan<T extends OpenTask> {
  queue: boolean;
  cancel: T | null;
}

/**
 * The plan for a model's new head (`queueAnalysis`), branch for branch:
 * - the open task has the head's facts: nothing (it stays);
 * - an open task with other facts: cancel it, then queue;
 * - no open task and a layout-only change (`previousFactsHash` equals
 *   `factsHash`): nothing when the latest done task has these facts, else
 *   queue (no task analysed them, say a failed one);
 * - otherwise (a new or revived model, `previousFactsHash` null, or changed
 *   facts, a revert too): queue.
 *
 * @param doneFactsHash the facts of the model's latest done task; read only
 *   when there is no open task and the change is layout-only (else ignored)
 */
export function planQueue<T extends OpenTask>(src: {
  previousFactsHash: string | null;
  factsHash: string;
  open: T | null;
  doneFactsHash: string | null;
}): QueuePlan<T> {
  const { open, factsHash } = src;
  if (open?.factsHash === factsHash) return { queue: false, cancel: null };
  if (open) return { queue: true, cancel: open };
  if (src.previousFactsHash === factsHash && src.doneFactsHash === factsHash) {
    return { queue: false, cancel: null };
  }
  return { queue: true, cancel: null };
}

/** Whether `queueAnalysis` reads the latest done task: no open task and a layout-only change. */
export const needsDoneTask = (src: {
  previousFactsHash: string | null;
  factsHash: string;
  open: OpenTask | null;
}): boolean => src.open === null && src.previousFactsHash === src.factsHash;

/**
 * The plan for a model's relations task at a new head (CONCEPT §3
 * "Requeue"), pure, one row per branch of `queueAnalysis`, which writes it
 * (M6 S2b follow-up: the dry runs and the amendment cost plan with it too).
 * The write's event order stays pinned by `recompute-golden.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { needsDoneTask, planQueue } from '../../src/domain/queue-plan.ts';

const queued = (factsHash: string) => ({ id: 'q', state: 'queued' as const, factsHash });
const claimed = (factsHash: string) => ({ id: 'c', state: 'claimed' as const, factsHash });

describe('planQueue', () => {
  it.each([
    {
      row: 'a new or revived model',
      previousFactsHash: null,
      factsHash: 'h1',
      open: null,
      doneFactsHash: null,
      queue: true,
      cancel: null,
    },
    {
      row: 'facts changed, no open task',
      previousFactsHash: 'h0',
      factsHash: 'h1',
      open: null,
      doneFactsHash: 'h0',
      queue: true,
      cancel: null,
    },
    {
      row: 'facts changed, a queued task',
      previousFactsHash: 'h0',
      factsHash: 'h1',
      open: queued('h0'),
      doneFactsHash: null,
      queue: true,
      cancel: queued('h0'),
    },
    {
      row: 'facts changed, a claimed task',
      previousFactsHash: 'h0',
      factsHash: 'h1',
      open: claimed('h0'),
      doneFactsHash: null,
      queue: true,
      cancel: claimed('h0'),
    },
    {
      row: 'the open task has these facts',
      previousFactsHash: 'h1',
      factsHash: 'h1',
      open: claimed('h1'),
      doneFactsHash: null,
      queue: false,
      cancel: null,
    },
    {
      row: 'layout only after a done task on these facts',
      previousFactsHash: 'h1',
      factsHash: 'h1',
      open: null,
      doneFactsHash: 'h1',
      queue: false,
      cancel: null,
    },
    {
      row: 'layout only after a failed task (the latest done one analysed other facts)',
      previousFactsHash: 'h1',
      factsHash: 'h1',
      open: null,
      doneFactsHash: 'h0',
      queue: true,
      cancel: null,
    },
    {
      row: 'layout only, never analysed',
      previousFactsHash: 'h1',
      factsHash: 'h1',
      open: null,
      doneFactsHash: null,
      queue: true,
      cancel: null,
    },
    {
      row: 'a revert with an open task on other facts',
      previousFactsHash: 'h1',
      factsHash: 'h0',
      open: queued('h1'),
      doneFactsHash: 'h0',
      queue: true,
      cancel: queued('h1'),
    },
    {
      row: 'a revert to facts a done task analysed: queued again (partners judged the other version)',
      previousFactsHash: 'h1',
      factsHash: 'h0',
      open: null,
      doneFactsHash: 'h0',
      queue: true,
      cancel: null,
    },
  ])('$row', ({ previousFactsHash, factsHash, open, doneFactsHash, queue, cancel }) => {
    expect(planQueue({ previousFactsHash, factsHash, open, doneFactsHash })).toEqual({
      queue,
      cancel,
    });
  });

  it('reads the done task only without an open task and for a layout-only change', () => {
    expect(needsDoneTask({ previousFactsHash: 'h1', factsHash: 'h1', open: null })).toBe(true);
    expect(needsDoneTask({ previousFactsHash: 'h0', factsHash: 'h1', open: null })).toBe(false);
    expect(needsDoneTask({ previousFactsHash: null, factsHash: 'h1', open: null })).toBe(false);
    expect(needsDoneTask({ previousFactsHash: 'h1', factsHash: 'h1', open: queued('h0') })).toBe(
      false,
    );
  });

  it('hands back the open task it cancels, so a caller sees whether an agent holds it', () => {
    const open = claimed('h0');
    const plan = planQueue({ previousFactsHash: 'h0', factsHash: 'h1', open, doneFactsHash: null });
    expect(plan.cancel).toBe(open);
    expect(plan.cancel?.state).toBe('claimed');
  });
});

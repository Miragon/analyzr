/**
 * The batches' merge of a dry run (M6 §3.5, S2b follow-up), zod-free and
 * shared by the CLI, the web and the plugin: files concatenated, counts
 * added up, items concatenated up to the cap, the absent keys of the first
 * batch; the calls only proposed by reason in their order, an owner's rules
 * by rule; the relations tasks concatenated and sorted as the server sorts
 * them (the queued by key, the cancelled claimed first, then by key),
 * `claimed` and `pairs` added up, the pairs judged again deduplicated; the
 * value chain's part only when a batch has it: the accepted placements
 * concatenated and sorted by process, then step, the placement task's
 * strongest outcome, the most processes due, the newly due and placed-again
 * ones added up.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { ImportImpact } from '../src/api/models.ts';
import { MAX_IMPACT_ITEMS, TrustReason } from '../src/index.ts';
import { TRUST_REASON_ORDER, mergeImpacts } from '../src/impact-merge.ts';

const list = <T>(count: number, items: T[] = []) => ({ count, items });

const empty: ImportImpact = {
  files: [],
  acceptedCalls: list(0),
  callsProposed: { ...list(0), wasAccepted: 0, byReason: [] },
  proposalsAdded: list(0),
  proposalsWithdrawn: list(0),
  endpointsChanged: list(0),
  findingsAdded: list(0),
  findingsResolved: list(0),
  absentKeys: list(0),
  relationsTasks: { queued: list(0), cancelled: list(0), claimed: 0, pairs: 0, rejudged: list(0) },
};

const pair = (type: 'call' | 'message', from: string, to: string) => ({
  type,
  from: from as `${string}#${string}`,
  to: to as `${string}#${string}`,
});

describe('mergeImpacts', () => {
  it('keeps the trust reasons in the enum’s order and the cap of the contract', () => {
    expect(TrustReason.options).toEqual([...TRUST_REASON_ORDER]);
    expect(MAX_IMPACT_ITEMS).toBe(100);
  });

  it('is zod-free, so the web, the CLI and the plugin script load it without the schemas', () => {
    const source = readFileSync(new URL('../src/impact-merge.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^import (?!type )/m);
  });

  it('concatenates the files, adds the counts up and keeps the first batch’s absent keys', () => {
    const file = (modelKey: string) => ({
      modelKey,
      factsChanged: true,
      processesAdded: [],
      processesRemoved: [],
      trust: { class: 'modelled' as const, reasons: [] },
    });
    const merged = mergeImpacts([
      { ...empty, files: [file('a')], proposalsAdded: list(4), absentKeys: list(1, ['x']) },
      { ...empty, files: [file('b')], proposalsAdded: list(4), absentKeys: list(1, ['x']) },
    ]);
    expect(merged.files.map((f) => f.modelKey)).toEqual(['a', 'b']);
    expect(merged.proposalsAdded.count).toBe(8);
    expect(merged.absentKeys).toEqual(list(1, ['x']));
    expect(Object.keys(merged)).toEqual(Object.keys(empty));
    expect(mergeImpacts([])).toEqual(empty);
  });

  it('caps the concatenated items at the server’s cap, the count past it', () => {
    const items = Array.from({ length: 80 }, (_, i) => pair('message', `a#E${i}`, `b#S${i}`));
    const merged = mergeImpacts([
      {
        ...empty,
        endpointsChanged: list(
          90,
          items.map((r) => ({ ...r, endpointState: 'changed' as const })),
        ),
      },
      {
        ...empty,
        endpointsChanged: list(
          80,
          items.map((r) => ({ ...r, endpointState: 'missing' as const })),
        ),
      },
    ]);
    expect(merged.endpointsChanged.count).toBe(170);
    expect(merged.endpointsChanged.items).toHaveLength(MAX_IMPACT_ITEMS);
  });

  it('adds the calls only proposed up by their totals, reasons in their order', () => {
    const calls = (count: number, wasAccepted: number, ...byReason: [TrustReason, number][]) => ({
      count,
      items: [],
      wasAccepted,
      byReason: byReason.map(([reason, n]) => ({ reason, count: n })),
    });
    expect(
      mergeImpacts([
        {
          ...empty,
          callsProposed: calls(12, 5, ['no-engine', 2], ['agent-upload', 7], ['converted', 3]),
        },
        { ...empty, callsProposed: calls(3, 2, ['no-engine', 3]) },
      ]).callsProposed,
    ).toEqual({
      count: 15,
      items: [],
      wasAccepted: 7,
      byReason: [
        { reason: 'no-engine', count: 5 },
        { reason: 'agent-upload', count: 7 },
        { reason: 'converted', count: 3 },
      ],
    });
  });

  it('adds an owner’s rules up by rule, in first-seen order; none without them', () => {
    const rule = (name: string) => `aar_${name}` as const;
    const auto = (...byRule: [string, number][]) => ({
      count: byRule.reduce((n, [, c]) => n + c, 0),
      ofProposed: byRule.reduce((n, [, c]) => n + c, 0),
      items: [],
      byRule: byRule.map(([name, count]) => ({ ruleId: rule(name), ruleName: name, count })),
    });
    expect(
      mergeImpacts([
        { ...empty, autoAcceptedCalls: auto(['A', 2]) },
        { ...empty, autoAcceptedCalls: auto(['A', 1], ['B', 1]) },
      ]).autoAcceptedCalls,
    ).toEqual({
      count: 4,
      ofProposed: 4,
      items: [],
      byRule: [
        { ruleId: rule('A'), ruleName: 'A', count: 3 },
        { ruleId: rule('B'), ruleName: 'B', count: 1 },
      ],
    });
    expect('autoAcceptedCalls' in mergeImpacts([empty, empty])).toBe(false);
  });

  it('concatenates the relations tasks with the claimed ones first and adds claimed and pairs up', () => {
    const queued = (modelKey: string) => ({
      modelKey,
      state: 'queued' as const,
      claimedBy: null,
      assigned: null,
    });
    const claimed = (modelKey: string, assigned: number) => ({
      modelKey,
      state: 'claimed' as const,
      claimedBy: 'agent:claude',
      assigned,
    });
    const merged = mergeImpacts([
      {
        ...empty,
        relationsTasks: {
          queued: list(2, ['a/eins', 'a/zwei']),
          cancelled: list(2, [claimed('a/zwei', 7), queued('a/eins')]),
          claimed: 1,
          pairs: 30,
          rejudged: list(0),
        },
      },
      {
        ...empty,
        relationsTasks: {
          queued: list(1, ['b/drei']),
          cancelled: list(2, [claimed('b/drei', 3), queued('b/vier')]),
          claimed: 1,
          pairs: 12,
          rejudged: list(0),
        },
      },
    ]).relationsTasks;
    expect(merged.queued).toEqual(list(3, ['a/eins', 'a/zwei', 'b/drei']));
    expect(merged.cancelled).toEqual(
      list(4, [claimed('a/zwei', 7), claimed('b/drei', 3), queued('a/eins'), queued('b/vier')]),
    );
    expect(merged.claimed).toBe(2);
    expect(merged.pairs).toBe(42);
  });

  it('sorts the merged tasks as the server does when the batches’ keys do not follow their order', () => {
    // A manifest pins keys: the batches go by path, their keys need not.
    const task = (modelKey: string, state: 'queued' | 'claimed') => ({
      modelKey,
      state,
      claimedBy: state === 'claimed' ? 'agent:a' : null,
      assigned: state === 'claimed' ? 2 : null,
    });
    const merged = mergeImpacts([
      {
        ...empty,
        relationsTasks: {
          ...empty.relationsTasks,
          queued: list(2, ['z/eins', 'z/zwei']),
          cancelled: list(2, [task('z/zwei', 'claimed'), task('z/eins', 'queued')]),
          claimed: 1,
        },
      },
      {
        ...empty,
        relationsTasks: {
          ...empty.relationsTasks,
          queued: list(2, ['a/drei', 'm/vier']),
          cancelled: list(2, [task('m/vier', 'claimed'), task('a/drei', 'queued')]),
          claimed: 1,
        },
      },
    ]).relationsTasks;
    expect(merged.queued).toEqual(list(4, ['a/drei', 'm/vier', 'z/eins', 'z/zwei']));
    expect(merged.cancelled).toEqual(
      list(4, [
        task('m/vier', 'claimed'),
        task('z/zwei', 'claimed'),
        task('a/drei', 'queued'),
        task('z/eins', 'queued'),
      ]),
    );
    // Past the cap: the first keys of all batches.
    const keys = (prefix: string) =>
      Array.from(
        { length: MAX_IMPACT_ITEMS },
        (_, i) => `${prefix}/m${String(i).padStart(3, '0')}`,
      );
    const capped = mergeImpacts([
      { ...empty, relationsTasks: { ...empty.relationsTasks, queued: list(150, keys('z')) } },
      { ...empty, relationsTasks: { ...empty.relationsTasks, queued: list(120, keys('a')) } },
    ]).relationsTasks.queued;
    expect(capped).toEqual(list(270, keys('a')));
  });

  it('keeps a claimed task listed past the cap of the first batch', () => {
    const many = Array.from({ length: MAX_IMPACT_ITEMS }, (_, i) => ({
      modelKey: `a/m${String(i).padStart(3, '0')}`,
      state: 'queued' as const,
      claimedBy: null,
      assigned: null,
    }));
    const held = { modelKey: 'b/x', state: 'claimed' as const, claimedBy: 'agent:a', assigned: 1 };
    const merged = mergeImpacts([
      { ...empty, relationsTasks: { ...empty.relationsTasks, cancelled: list(120, many) } },
      {
        ...empty,
        relationsTasks: { ...empty.relationsTasks, cancelled: list(1, [held]), claimed: 1 },
      },
    ]).relationsTasks;
    expect(merged.cancelled.count).toBe(121);
    expect(merged.cancelled.items[0]).toEqual(held);
    expect(merged.cancelled.items).toHaveLength(MAX_IMPACT_ITEMS);
    expect(merged.claimed).toBe(1);
  });

  it('deduplicates the pairs judged again by item and sorts them by type, from and to', () => {
    const ab = pair('message', 'a#E', 'b#S');
    const ba = pair('message', 'b#E', 'a#S');
    const call = pair('call', 'b#C', 'a#P');
    const merged = mergeImpacts([
      { ...empty, relationsTasks: { ...empty.relationsTasks, rejudged: list(2, [ab, ba]) } },
      { ...empty, relationsTasks: { ...empty.relationsTasks, rejudged: list(3, [call, ab, ba]) } },
    ]).relationsTasks.rejudged;
    // the pairs between the two batches' models are listed by both: counted once
    expect(merged).toEqual(list(3, [call, ab, ba]));
    // past a batch's cap, duplicates can hide: the count stays an upper bound
    expect(
      mergeImpacts([
        { ...empty, relationsTasks: { ...empty.relationsTasks, rejudged: list(150, [ab]) } },
        { ...empty, relationsTasks: { ...empty.relationsTasks, rejudged: list(1, [ab]) } },
      ]).relationsTasks.rejudged,
    ).toEqual(list(150, [ab]));
  });

  it('merges the value chain’s part only when a batch has it, the placements sorted and capped', () => {
    expect(Object.keys(mergeImpacts([empty, empty]))).toEqual(Object.keys(empty));
    const changed = (process: string, step: string, endpointState: 'changed' | 'missing') => ({
      step,
      stepName: step === '@outside' ? null : `Schritt ${step}`,
      process: process as `${string}#${string}`,
      endpointState,
    });
    const task = { outcome: 'queued' as const, due: 4, newlyDue: 2, again: 1 };
    const merged = mergeImpacts([
      {
        ...empty,
        placementsChanged: list(2, [
          changed('z/m#P', 's1', 'changed'),
          changed('z/m#P', 's2', 'missing'),
        ]),
        placementTask: task,
      },
      {
        ...empty,
        placementsChanged: list(1, [changed('a/m#P', '@outside', 'missing')]),
        placementTask: task,
      },
    ]);
    expect(merged.placementsChanged).toEqual(
      list(3, [
        changed('a/m#P', '@outside', 'missing'),
        changed('z/m#P', 's1', 'changed'),
        changed('z/m#P', 's2', 'missing'),
      ]),
    );
    const many = (prefix: string) =>
      Array.from({ length: MAX_IMPACT_ITEMS }, (_, i) =>
        changed(`${prefix}/m${String(i).padStart(3, '0')}#P`, 's', 'changed'),
      );
    const capped = mergeImpacts([
      { ...empty, placementsChanged: list(130, many('z')) },
      { ...empty, placementsChanged: list(110, many('a')) },
    ]).placementsChanged;
    expect(capped).toEqual(list(240, many('a')));
  });

  it('keeps the placement task’s strongest outcome, the most processes due, and adds the rest up', () => {
    type Outcome = 'queued' | 'open' | 'deferred' | 'nothing-due' | 'not-triggered';
    const task = (outcome: Outcome, due = 0, newlyDue = 0, again = 0): ImportImpact => ({
      ...empty,
      placementTask: { outcome, due, newlyDue, again },
    });
    const outcome = (...outcomes: Outcome[]) =>
      mergeImpacts(outcomes.map((o) => task(o))).placementTask?.outcome;
    expect(outcome('not-triggered', 'nothing-due')).toBe('nothing-due');
    expect(outcome('nothing-due', 'queued', 'not-triggered')).toBe('queued');
    expect(outcome('queued', 'open')).toBe('open');
    expect(outcome('open', 'deferred', 'queued')).toBe('deferred');
    expect(outcome('not-triggered')).toBe('not-triggered');
    // Each batch counts against the head: the most due (the largest batch's count) and the sums
    // are approximate.
    expect(
      mergeImpacts([
        task('queued', 7, 3, 1),
        task('not-triggered', 5, 0, 0),
        task('queued', 6, 2, 2),
      ]).placementTask,
    ).toEqual({ outcome: 'queued', due: 7, newlyDue: 5, again: 3 });
  });
});

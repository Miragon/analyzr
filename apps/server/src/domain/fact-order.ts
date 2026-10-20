/**
 * The order the store lists stored facts in (`facts.head`, a revision's
 * facts): by model key, then kind and element id, each in code point order.
 * An extracted model lists its kinds in the enum's order instead
 * (`compareFacts` of `@analyzr/bpmn-facts`). A process's first start and end
 * labels (`processOwnFields`) follow this order, so the write path's input
 * hashes (over `facts.head`) and a dry run's (over the would-be facts,
 * `headFactOrder`) rest on this one comparator. Pure.
 */
import type { Fact } from '@analyzr/contracts';

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Stored fact order: model key, then kind, then element id, in code point order. */
export function compareStoredFacts(
  a: Pick<Fact, 'modelKey' | 'kind' | 'elementId'>,
  b: Pick<Fact, 'modelKey' | 'kind' | 'elementId'>,
): number {
  return (
    byCodePoint(a.modelKey, b.modelKey) ||
    byCodePoint(a.kind, b.kind) ||
    byCodePoint(a.elementId, b.elementId)
  );
}

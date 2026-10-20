import type { AutoAcceptItem, Relation } from '@analyzr/client';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { genericFlags, nameUsage, type NameUsage } from './generic-names';
import { landscapeQuery, modelsQuery } from './queries';
import type { RefResolver } from './refs';
import { useProjectFacts } from './use-project-facts';

/**
 * The bulk accept's name flags in a rule's preview and apply
 * (UX-SIMPLIFICATION.md §3.11 item 5, UX9; Q8: shown, never blocking): „davon
 * N mit allgemeinem oder mehrfach genutztem Namen“. Only the rules page
 * loads this (the revoke dialog, which the review screen carries, does not).
 */

/**
 * How many relation items carry a bulk accept name flag (`genericFlags`: a
 * generic name, or a name more than two processes use), judged on the
 * relation as the landscape has it (its declared message or signal name),
 * else on the item's ends. A unique call from a derived model names its
 * target by id and carries none (M6 S2c-3, as `bulkFlags`).
 */
export function countNameFlags(
  items: readonly (Pick<AutoAcceptItem, 'id' | 'kind' | 'type' | 'from' | 'to'> & {
    proposedBy?: AutoAcceptItem['proposedBy'];
  })[],
  relations: ReadonlyMap<string, Relation>,
  resolve: RefResolver,
  usage: NameUsage,
): number {
  let count = 0;
  for (const item of items) {
    if (item.kind !== 'relation' || !item.type || !item.from || !item.to) continue;
    if (item.proposedBy === 'rule') continue;
    const relation = relations.get(item.id) ?? {
      type: item.type,
      from: item.from,
      to: item.to,
      attrs: {},
    };
    if (genericFlags(relation, (ref) => resolve(ref).label, usage).length > 0) count += 1;
  }
  return count;
}

/**
 * {@link countNameFlags} over the project's landscape and facts; `null`
 * until every model's facts are there (a count before would only shrink, as
 * the bulk accept's button knows).
 */
export function useNameFlags(
  project: string,
): ((items: readonly AutoAcceptItem[]) => number) | null {
  const models = useQuery(modelsQuery(project));
  const landscape = useQuery(landscapeQuery(project));
  const { resolve, byModel, loading } = useProjectFacts(project, models.data);
  const relations = landscape.data?.relations;
  return useMemo(() => {
    if (loading || !relations) return null;
    const usage = nameUsage([...byModel.values()].flatMap((f) => f.facts));
    const byId = new Map(relations.map((r) => [r.id, r]));
    return (items) => countNameFlags(items, byId, resolve, usage);
  }, [loading, relations, byModel, resolve]);
}

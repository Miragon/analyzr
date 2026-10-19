import type { AutoAcceptItem, AutoAcceptLedgerEntry } from '@analyzr/client';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { OUTSIDE_LABEL, RELATION_TYPES } from './labels';
import { OUTSIDE_STEP } from './limits';
import { modelsQuery, valueChainQuery } from './queries';
import type { RefResolver } from './refs';
import { elementsText, sideName } from './review';
import { useProjectFacts } from './use-project-facts';

/**
 * Names for what auto-accept rules accept (UX-SIMPLIFICATION.md §3.11 item
 * 7, UX9): the apply and revoke lists name processes, elements and steps,
 * never refs (P2). The bulk flags count is in `auto-accept-flags.ts`.
 */

/** The subject of an auto-acceptance (an item of a preview, dry run or the ledger). */
export type Subject = Pick<
  AutoAcceptItem | AutoAcceptLedgerEntry,
  'kind' | 'type' | 'from' | 'to' | 'process' | 'step'
>;

/** How a list names a subject: the pair or placement, and the type with the element's name. */
export interface SubjectLabel {
  /** „Auftragsabwicklung → Rechnungsstellung“, „Inkasso → Forderungsmanagement“. */
  title: string;
  /** „Nachricht · Ware versandbereit“, „Platzierung“. */
  meta: string;
}

/** Resolves step element ids of the value chain to their names. */
export type StepNamer = (elementId: string) => string;

/**
 * A subject by name: a relation's processes, then its type and the element
 * named once (as the review queue shows a pair); a placement's process and
 * step („Außerhalb der Kette“ for `@outside`). Unknown refs fall back to
 * their element id, as the queue does while the facts load.
 */
export function subjectLabel(s: Subject, resolve: RefResolver, stepName: StepNamer): SubjectLabel {
  if (s.kind === 'relation') {
    const from = resolve(s.from ?? '');
    const to = resolve(s.to ?? '');
    const elements = elementsText(from, to);
    const type = s.type ? RELATION_TYPES[s.type].label : 'Relation';
    return {
      title: `${sideName(from)} → ${sideName(to)}`,
      meta: elements ? `${type} · ${elements}` : type,
    };
  }
  const step = s.step === null ? '' : s.step === OUTSIDE_STEP ? OUTSIDE_LABEL : stepName(s.step);
  return { title: `${sideName(resolve(s.process ?? ''))} → ${step}`, meta: 'Platzierung' };
}

export interface SubjectNames {
  resolve: RefResolver;
  stepName: StepNamer;
}

/**
 * The names a list of subjects needs: the project's facts (every model's
 * head revision, cached per revision) and, for placements only, the value
 * chain's steps.
 */
export function useSubjectNames(project: string, subjects: readonly Subject[]): SubjectNames {
  const models = useQuery(modelsQuery(project));
  const { resolve } = useProjectFacts(project, models.data);
  const placements = subjects.some((s) => s.kind === 'placement');
  const chain = useQuery({ ...valueChainQuery(project), enabled: placements });
  const stepName = useMemo<StepNamer>(() => {
    const names = new Map((chain.data?.steps ?? []).map((s) => [s.elementId, s.name]));
    return (elementId) => names.get(elementId) ?? elementId;
  }, [chain.data]);
  return { resolve, stepName };
}

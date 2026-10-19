import type {
  AutoAcceptLedgerEntry,
  Relation,
  RelationStatus,
  RelationType,
  Tier,
} from '@analyzr/client';

import {
  EMPTY_AUTO_ACCEPT_INDEX,
  matchesAuto,
  parseAutoFilter,
  type AutoAcceptIndex,
  type AutoFilter,
} from './auto-accept';
import { STATUS_ORDER, TIER_ORDER, TYPE_ORDER } from './labels';
import { splitRef } from './refs';

/** Filters of the relation table; kept in the URL search params. */
export interface RelationFilters {
  status?: RelationStatus;
  tier?: Tier;
  type?: RelationType;
  /** Model key: relations with an endpoint in this model. */
  model?: string;
  /**
   * Accepted by an owner's auto-accept rule (owner decision 19), still in
   * force: `any`, or the rule `aar_…`. Needs the ledger (every reviewer).
   */
  auto?: AutoFilter;
}

function oneOf<T extends string>(values: readonly T[], value: unknown): T | undefined {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** Validates untrusted search params (TanStack Router `validateSearch`). */
export function parseRelationFilters(search: Record<string, unknown>): RelationFilters {
  const filters: RelationFilters = {};
  const status = oneOf(STATUS_ORDER, search['status']);
  const tier = oneOf(TIER_ORDER, search['tier']);
  const type = oneOf(TYPE_ORDER, search['type']);
  const model =
    typeof search['model'] === 'string' && search['model'] !== '' ? search['model'] : undefined;
  const auto = parseAutoFilter(search['auto']);
  if (status) filters.status = status;
  if (tier) filters.tier = tier;
  if (type) filters.type = type;
  if (model) filters.model = model;
  if (auto) filters.auto = auto;
  return filters;
}

export function touchesModel(relation: Pick<Relation, 'from' | 'to'>, modelKey: string): boolean {
  return (
    splitRef(relation.from).modelKey === modelKey || splitRef(relation.to).modelKey === modelKey
  );
}

/** `auto` (the auto-accept ledger, joined by relation id) is needed for the `auto` filter. */
export function matchesFilters(
  relation: Relation,
  filters: RelationFilters,
  auto: AutoAcceptIndex = EMPTY_AUTO_ACCEPT_INDEX,
): boolean {
  return (
    (filters.status === undefined || relation.status === filters.status) &&
    (filters.tier === undefined || relation.tier === filters.tier) &&
    (filters.type === undefined || relation.type === filters.type) &&
    (filters.model === undefined || touchesModel(relation, filters.model)) &&
    (filters.auto === undefined || matchesAuto(auto, relation.id, filters.auto))
  );
}

const rank = <T>(order: readonly T[], value: T) => order.indexOf(value);

/**
 * Display order: accepted before proposed (status order), then by tier
 * (rule before key before …), type, and the refs.
 */
export function compareRelations(a: Relation, b: Relation): number {
  return (
    rank(STATUS_ORDER, a.status) - rank(STATUS_ORDER, b.status) ||
    rank(TIER_ORDER, a.tier) - rank(TIER_ORDER, b.tier) ||
    rank(TYPE_ORDER, a.type) - rank(TYPE_ORDER, b.type) ||
    a.from.localeCompare(b.from) ||
    a.to.localeCompare(b.to)
  );
}

export function filterRelations(
  relations: readonly Relation[],
  filters: RelationFilters,
  auto: AutoAcceptIndex = EMPTY_AUTO_ACCEPT_INDEX,
): Relation[] {
  return relations.filter((r) => matchesFilters(r, filters, auto)).sort(compareRelations);
}

export function sameFilters(a: RelationFilters, b: RelationFilters): boolean {
  return (
    a.status === b.status &&
    a.tier === b.tier &&
    a.type === b.type &&
    a.model === b.model &&
    a.auto === b.auto
  );
}

// ------------------------------------------------------------ the result views (UX5, UX9)

/**
 * The views of the tab „Relationen“ (UX-SIMPLIFICATION.md §3.6 item 4, §3.10
 * item 1): „Zu prüfen“ and „Vorgemerkt“ on `/review`, the results „Gilt“,
 * „Abgelehnt“, „Automatisch angenommen“ and „Alle“ on `/relations`.
 */
export type RelationView = 'review' | 'held' | 'accepted' | 'rejected' | 'auto' | 'all';

/** A result view on `/relations`: which one its filters are. */
export type ResultView = Extract<RelationView, 'accepted' | 'rejected' | 'auto' | 'all'>;

/**
 * The result view a filter set is: „Automatisch angenommen“ (any rule or one
 * of them) without a status, „Gilt“ and „Abgelehnt“ by their status, else
 * „Alle“.
 */
export function resultViewOf(filters: RelationFilters): ResultView {
  if (filters.auto !== undefined) return filters.status === undefined ? 'auto' : 'all';
  if (filters.status === 'accepted') return 'accepted';
  if (filters.status === 'rejected') return 'rejected';
  return 'all';
}

/** The filters a result view sets itself: „Filter zurücksetzen“ goes back to them. */
export function viewFilters(view: ResultView): RelationFilters {
  switch (view) {
    case 'accepted':
      return { status: 'accepted' };
    case 'rejected':
      return { status: 'rejected' };
    case 'auto':
      return { auto: 'any' };
    case 'all':
      return {};
  }
}

/**
 * Rows a result view shows at first and adds per „Weitere anzeigen“ (UX9):
 * with one „Öffnen“ per row, the shell, the views and the filters, a page
 * stays within the 60 controls of UX-SIMPLIFICATION.md §7 "UX9".
 */
export const RELATION_PAGE = 40;

/** The way back to a result view from the review screen (UX9). */
export const RESULT_VIEW_LABELS: Record<ResultView, string> = {
  accepted: 'Gilt',
  rejected: 'Abgelehnt',
  auto: 'Automatisch angenommen',
  all: 'Alle Relationen',
};

/**
 * The statuses the filter „Status“ of „Alle“ offers (UX-SIMPLIFICATION.md
 * §3.10 item 2): those without a result view of their own, since „Angenommen“
 * would be „Gilt“ and „Abgelehnt“ its view (the filter would vanish under the
 * pointer), plus the one set, if another.
 */
export function statusOptions(current: RelationStatus | undefined): RelationStatus[] {
  return STATUS_ORDER.filter((s) => s === current || s === 'proposed' || s === 'held');
}

/**
 * How many of the filters behind „Weitere Filter“ (Grundlage, Typ,
 * Annahmeregel) are set; the view „Automatisch angenommen“ sets the rule
 * filter itself, so `auto=any` counts there only as the view.
 */
export function moreFilterCount(filters: RelationFilters): number {
  const auto =
    filters.auto !== undefined && !(filters.auto === 'any' && filters.status === undefined);
  return [filters.tier !== undefined, filters.type !== undefined, auto].filter(Boolean).length;
}

/** The name the rule tier decides under (its handle is `analyzr-rules`). */
const RULES_NAME = 'analyzr';

/** Who decided a relation's status, for the column „Entschieden von“. */
export interface DecidedBy {
  /** `auto`: an owner's auto-accept rule (the ledger); `rule`: analyzr's rule tier. */
  source: 'auto' | 'rule' | 'human';
  text: string;
}

/**
 * „Entschieden von“ (UX-SIMPLIFICATION.md §3.10 item 3, P2): the rule's name
 * for an auto-acceptance in force (`auto`, from the ledger, which reviewers
 * have; viewers see the owner it is recorded under), „analyzr“ for the rule
 * tier, the human's handle for a decision; never a procedure or an LLM model.
 * `null` while nobody decided (a proposal, an obsolete relation).
 */
export function decidedBy(
  relation: Pick<Relation, 'status' | 'tier' | 'provenance'>,
  auto?: AutoAcceptLedgerEntry,
): DecidedBy | null {
  if (relation.status === 'proposed' || relation.status === 'obsolete') return null;
  if (auto) return { source: 'auto', text: `Regel „${auto.ruleName}“` };
  const p = relation.provenance;
  // Relations from before M2 carry no provenance: the rule tier's calls are analyzr's, a
  // manual relation a human's (its handle unknown), as `provenanceOf` falls back.
  if (p === null) {
    if (relation.tier === 'rule') return { source: 'rule', text: RULES_NAME };
    return relation.tier === 'manual' ? { source: 'human', text: 'Mensch' } : null;
  }
  if (p.kind !== 'decision') return null;
  if (p.sourceKind === 'rule') return { source: 'rule', text: RULES_NAME };
  return p.sourceKind === 'human' ? { source: 'human', text: p.handle } : null;
}

import type { Model, ModelStage, Relation, RelationAssertion, Tier } from '@analyzr/client';

import { ApiError } from './api';
import { bulkFlags, nameKey, type GenericFlag, type NameUsage } from './generic-names';
import { STAGE_ORDER, TIER_ORDER } from './labels';
import { DERIVED_CALLER_MATCH, DERIVED_CALL_CONFIDENCE, MAX_BULK_DECISIONS } from './limits';
import { splitRef, type RefLabel, type RefResolver } from './refs';
import { touchesModel } from './relation-filters';

/**
 * The review inbox (CONCEPT §3 "Review workflow"): open proposals sorted by
 * confidence and by how many models a decision finishes, held items in their
 * own list, model counts per pipeline stage. Pure functions, shared by the
 * inbox and the review screen, so "next" on the review screen follows the
 * same order as the inbox.
 */

/** Narrows the queue; kept in the URL so the review screen walks the same list. */
export interface QueueFilters {
  /** Only relations touching a model in this pipeline stage. */
  stage?: ModelStage;
  tier?: Tier;
  /** Only relations with an endpoint in this model. */
  model?: string;
}

function oneOf<T extends string>(values: readonly T[], value: unknown): T | undefined {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** Validates untrusted search params (TanStack Router `validateSearch`). */
export function parseQueueFilters(search: Record<string, unknown>): QueueFilters {
  const out: QueueFilters = {};
  const stage = oneOf(STAGE_ORDER, search['stage']);
  const tier = oneOf(TIER_ORDER, search['tier']);
  const model = search['model'];
  if (stage) out.stage = stage;
  if (tier) out.tier = tier;
  if (typeof model === 'string' && model !== '') out.model = model;
  return out;
}

type ModelInfo = Pick<Model, 'key' | 'stage' | 'openItems'>;

/** Model keys at both ends of a relation (one key when both ends lie in one file). */
export function modelKeysOf(relation: Pick<Relation, 'from' | 'to'>): string[] {
  const from = splitRef(relation.from).modelKey;
  const to = splitRef(relation.to).modelKey;
  return from === to ? [from] : [from, to];
}

/**
 * How many models a decision on this proposal finishes: models whose only
 * open item it is (CONCEPT §3: the inbox is sorted "by how many open items a
 * decision closes").
 */
export function finishesModels(
  relation: Pick<Relation, 'from' | 'to'>,
  openItems: ReadonlyMap<string, number>,
): number {
  return modelKeysOf(relation).filter((key) => openItems.get(key) === 1).length;
}

function matchesQueue(
  relation: Relation,
  filters: QueueFilters,
  stageOf: ReadonlyMap<string, ModelStage>,
): boolean {
  if (filters.tier !== undefined && relation.tier !== filters.tier) return false;
  if (filters.model !== undefined && !touchesModel(relation, filters.model)) return false;
  if (filters.stage !== undefined) {
    return modelKeysOf(relation).some((key) => stageOf.get(key) === filters.stage);
  }
  return true;
}

export interface QueueItem {
  relation: Relation;
  /** Models this decision finishes (0–2). */
  finishes: number;
}

/**
 * Whether a relation waits for a review decision (CONCEPT §2, §3, the
 * `review_items` of the stage): a proposal, or an accepted relation whose
 * endpoint changed or is missing since the decision. Held relations have
 * their own list.
 */
export function isReviewItem(relation: Pick<Relation, 'status' | 'endpointState'>): boolean {
  return (
    relation.status === 'proposed' ||
    (relation.status === 'accepted' && relation.endpointState !== 'ok')
  );
}

/**
 * The review queue in review order: open proposals and accepted relations
 * whose endpoint changed ({@link isReviewItem}), highest confidence first,
 * then those that finish the most models, then by refs (stable).
 */
export function reviewQueue(
  relations: readonly Relation[],
  models: readonly ModelInfo[],
  filters: QueueFilters = {},
): QueueItem[] {
  const stageOf = new Map(models.map((m) => [m.key, m.stage]));
  const openItems = new Map(models.map((m) => [m.key, m.openItems]));
  return relations
    .filter((r) => isReviewItem(r) && matchesQueue(r, filters, stageOf))
    .map((relation) => ({ relation, finishes: finishesModels(relation, openItems) }))
    .sort(
      (a, b) =>
        (b.relation.confidence ?? 0) - (a.relation.confidence ?? 0) ||
        b.finishes - a.finishes ||
        a.relation.from.localeCompare(b.relation.from) ||
        a.relation.to.localeCompare(b.relation.to) ||
        a.relation.type.localeCompare(b.relation.type),
    );
}

/** Held relations ("vorgemerkt"), the oldest hold first. */
export function heldList(
  relations: readonly Relation[],
  models: readonly ModelInfo[],
  filters: QueueFilters = {},
): Relation[] {
  const stageOf = new Map(models.map((m) => [m.key, m.stage]));
  return relations
    .filter((r) => r.status === 'held' && matchesQueue(r, filters, stageOf))
    .sort(
      (a, b) =>
        (a.provenance?.at ?? a.updatedAt).localeCompare(b.provenance?.at ?? b.updatedAt) ||
        a.id.localeCompare(b.id),
    );
}

/**
 * Agents' no-links for the inbox tab „Kein Zusammenhang“, with the model and
 * stage filters of the proposals (a no-link has no tier), in the server's
 * order (oldest first).
 */
export function noLinkList<T extends Pick<Relation, 'from' | 'to'>>(
  noLinks: readonly T[],
  models: readonly ModelInfo[],
  filters: QueueFilters = {},
): T[] {
  const stageOf = new Map(models.map((m) => [m.key, m.stage]));
  return noLinks.filter((n) => {
    const keys = modelKeysOf(n);
    if (filters.model !== undefined && !keys.includes(filters.model)) return false;
    return filters.stage === undefined || keys.some((k) => stageOf.get(k) === filters.stage);
  });
}

/** Number of models per pipeline stage (every stage present, zero included). */
export function stageCounts(models: readonly Pick<Model, 'stage'>[]): Record<ModelStage, number> {
  const counts = Object.fromEntries(STAGE_ORDER.map((s) => [s, 0])) as Record<ModelStage, number>;
  for (const m of models) counts[m.stage] += 1;
  return counts;
}

/** Inbox order of the stages: the pipeline from left to right. */
export const PIPELINE_ORDER: readonly ModelStage[] = [
  'waiting_for_agent',
  'agent_working',
  'agent_failed',
  'waiting_for_review',
  'waiting_for_clarification',
  'incorporated',
];

/**
 * Proposals per tier, for the bulk actions (only tiers that occur, in tier
 * order). Accepted relations whose endpoint changed are re-confirmed one by
 * one.
 */
export function proposalsByTier(queue: readonly QueueItem[]): { tier: Tier; items: Relation[] }[] {
  return TIER_ORDER.map((tier) => ({
    tier,
    items: queue
      .filter((q) => q.relation.tier === tier && q.relation.status === 'proposed')
      .map((q) => q.relation),
  })).filter((g) => g.items.length > 0);
}

/** Position of `id` in the queue and its neighbours; outside the queue, "next" is the first item. */
export function neighbours(
  queue: readonly QueueItem[],
  id: string,
): { index: number; previous: Relation | null; next: Relation | null } {
  const index = queue.findIndex((q) => q.relation.id === id);
  if (index < 0) return { index, previous: null, next: queue[0]?.relation ?? null };
  return {
    index,
    previous: queue[index - 1]?.relation ?? null,
    next: queue[index + 1]?.relation ?? null,
  };
}

/** An entry of an evidence list: a ref into a known model (clickable) or plain text. */
export type EvidenceItem =
  | { kind: 'ref'; text: string; modelKey: string; elementId: string }
  | { kind: 'text'; text: string };

const REF_PATTERN = /^[^\s#]+#[^\s#]+$/;

/** Splits evidence into refs of known models and plain text (agents may cite anything). */
export function evidenceItems(
  evidence: readonly string[],
  modelKeys: ReadonlySet<string>,
): EvidenceItem[] {
  return evidence.map((text) => {
    const trimmed = text.trim();
    if (REF_PATTERN.test(trimmed)) {
      const { modelKey, elementId } = splitRef(trimmed);
      if (modelKeys.has(modelKey)) return { kind: 'ref', text: trimmed, modelKey, elementId };
    }
    return { kind: 'text', text };
  });
}

/**
 * An open unique call from a derived model (M6 S2c, the trust rule): a call
 * the rule tier only proposed (tier `key`, marked `attrs.match`
 * `derived-caller`), waiting for a human. The bulk dialog lists these first,
 * under „Eindeutige Aufrufe aus abgeleiteten Modellen (n)“, flagged ones
 * included; the numbers behind „Gesammelt annehmen“ count {@link isBulkCall}.
 */
export function isDerivedCall(
  relation: Pick<Relation, 'type' | 'tier' | 'status' | 'attrs'>,
): boolean {
  return (
    relation.type === 'call' &&
    relation.tier === 'key' &&
    relation.status === 'proposed' &&
    relation.attrs['match'] === DERIVED_CALLER_MATCH
  );
}

/**
 * Such a call that the bulk accept takes as it stands (M6 S2c-2): no flag of
 * the bulk dialog, so no agent's question and no current no-link (no name
 * flag applies to it, {@link bulkFlags}; it needs no facts). Every number
 * behind „Gesammelt annehmen“ counts these („Übersicht“, „Hochladen“ › „Als
 * Nächstes“, and the dialog's selection when `?bulk=calls` opens it), as do
 * the server's system rule card and `analyzr import` (`isBulkDerivedCall` of
 * the contracts), so each number equals the selection its link opens.
 */
export function isBulkCall(
  relation: Pick<Relation, 'type' | 'tier' | 'status' | 'attrs' | 'provenance' | 'noLinks'>,
): boolean {
  return (
    isDerivedCall(relation) &&
    !relation.provenance?.question?.trim() &&
    relation.noLinks.length === 0
  );
}

/** A source a rule for derived calls can name (M6 S2c-3; `AutoAcceptDerivedKind` and converter). */
export interface DerivedCallSource {
  derivedKind: 'export' | 'converted' | 'none';
  converter: string | null;
}

/**
 * Declared derivations no auto-accept rule accepts anything on (owner
 * decision 30 (2)): the contracts' `UNSEEN_DERIVATIONS`, copied so the web
 * stays zod-free (a parity test keeps them equal).
 */
export const UNSEEN_DERIVATIONS: readonly string[] = ['reconstructed', 'as-told'];

/**
 * The keys of the models whose uploaded revision declares `reconstructed`
 * or `as-told` (`Model.source.derived`; an amended head: its upstream's):
 * no auto-accept rule accepts a relation with an end in one of them (owner
 * decision 30 (2), `reconstructed-endpoint`).
 */
export function unseenModelKeys(
  models: readonly Pick<Model, 'key' | 'source'>[],
): ReadonlySet<string> {
  return new Set(
    models.filter((m) => UNSEEN_DERIVATIONS.includes(m.source?.derived ?? '')).map((m) => m.key),
  );
}

/**
 * Whether an auto-accept rule could accept one of `relations` at all by
 * their ends: one has neither end in a model {@link unseenModelKeys} names.
 * True while the models are not loaded (`models` empty).
 */
export function someOutsideUnseenModels(
  relations: readonly Pick<Relation, 'from' | 'to'>[],
  models: readonly Pick<Model, 'key' | 'source'>[],
): boolean {
  const unseen = unseenModelKeys(models);
  return relations.some(
    (r) => !unseen.has(splitRef(r.from).modelKey) && !unseen.has(splitRef(r.to).modelKey),
  );
}

/**
 * The source most of these calls' callers declare that a rule for derived
 * calls can name (M6 S2c-3), by the caller models' `Model.trust`: `export`,
 * `converted` with its converter, or `none` (no kind declared). A caller
 * uploaded with an agent token counts for nothing (no rule accepts its
 * calls), nor a reconstructed or as-told one or a conversion without
 * converter, nor a call into a callee declared reconstructed or as-told
 * ({@link unseenModelKeys}, owner decision 30 (2): no auto-accept rule
 * accepts it); ties go to the first call. `null` when no call is left: then
 * no rule could accept them, and nothing is offered.
 */
export function derivedCallSource(
  calls: readonly Pick<Relation, 'from' | 'to'>[],
  models: readonly Pick<Model, 'key' | 'trust' | 'source'>[],
): DerivedCallSource | null {
  const byKey = new Map(models.map((m) => [m.key, m.trust]));
  const unseen = unseenModelKeys(models);
  const counted = new Map<string, { source: DerivedCallSource; n: number }>();
  for (const call of calls) {
    if (unseen.has(splitRef(call.to).modelKey)) continue;
    const trust = byKey.get(splitRef(call.from).modelKey);
    if (!trust || trust.class !== 'derived' || trust.reasons.includes('agent-upload')) continue;
    const kind = trust.derivedKind ?? 'none';
    let source: DerivedCallSource;
    if (kind === 'export' || kind === 'none') source = { derivedKind: kind, converter: null };
    else if (kind === 'converted' && trust.converter) {
      source = { derivedKind: kind, converter: trust.converter };
    } else continue;
    const key = `${source.derivedKind}\u0000${source.converter ?? ''}`;
    const entry = counted.get(key) ?? { source, n: 0 };
    entry.n += 1;
    counted.set(key, entry);
  }
  let best: { source: DerivedCallSource; n: number } | null = null;
  for (const entry of counted.values()) if (!best || entry.n > best.n) best = entry;
  return best?.source ?? null;
}

/**
 * Whether one of the project's rules (on or off) already names `source`
 * (M6 S2c-3): then the toast after a bulk accept offers no new one (the
 * calls it did not take were proposed before it, or it is off).
 */
export function ruleNamesSource(
  rules: readonly { proposedBy: string; derivedKind: string | null; converter: string | null }[],
  source: DerivedCallSource,
): boolean {
  return rules.some(
    (r) =>
      r.proposedBy === 'rule' &&
      r.derivedKind === source.derivedKind &&
      (source.derivedKind !== 'converted' || r.converter === source.converter),
  );
}

/**
 * The rule tier's proposal of a unique call from a derived model (M6 S2c,
 * the trust rule), told by the assertion itself: tier `key` at
 * {@link DERIVED_CALL_CONFIDENCE} with a rationale, which no other rule
 * assertion carries. The relation's marker would not do: it goes when the
 * caller turns modelled and the rule tier accepts the call.
 */
export function isTrustRuleProposal(a: {
  sourceKind: string;
  kind: string;
  tier: string | null;
  confidence: number | null;
  rationale: string | null;
}): boolean {
  return (
    a.sourceKind === 'rule' &&
    a.kind === 'proposal' &&
    a.tier === 'key' &&
    a.confidence === DERIVED_CALL_CONFIDENCE &&
    a.rationale !== null
  );
}

/**
 * The proposal a relation's status rests on (its provenance), else the
 * latest proposal: its evidence and question are shown on the review screen.
 * A trust-rule proposal never explains an acceptance of the rule tier (its
 * caller turned modelled; the rationale says the call was only proposed).
 */
export function currentProposal(
  relation: Pick<Relation, 'provenance'>,
  assertions: readonly RelationAssertion[],
): RelationAssertion | null {
  const basis = assertions.find((a) => a.id === relation.provenance?.assertionId);
  if (basis?.kind === 'proposal') return basis;
  const ruleAccepted = basis?.kind === 'decision' && basis.sourceKind === 'rule';
  return (
    assertions.findLast(
      (a) => a.kind === 'proposal' && !(ruleAccepted && isTrustRuleProposal(a)),
    ) ?? null
  );
}

/** Notes (answers) given after the relation's current hold, oldest first. */
export function answersSinceHold(
  relation: Pick<Relation, 'provenance'>,
  assertions: readonly RelationAssertion[],
): RelationAssertion[] {
  const holdAt = assertions.findIndex((a) => a.id === relation.provenance?.assertionId);
  return assertions.slice(holdAt < 0 ? 0 : holdAt + 1).filter((a) => a.kind === 'note');
}

/** A version conflict (optimistic concurrency) in words the reviewer can act on. */
export interface Conflict {
  title: string;
  description: string;
}

/** What a conflict is about: relations (M2) or placements (M4). */
export type ConflictNoun = 'relation' | 'placement';

const NOUNS: Record<ConflictNoun, { one: string; many: string; the: string }> = {
  relation: { one: 'Eine Relation hat', many: 'Relationen haben', the: 'Die Relation' },
  placement: { one: 'Eine Platzierung hat', many: 'Platzierungen haben', the: 'Die Platzierung' },
};

/**
 * Turns a 409 `conflict` or 412 `precondition-failed` into a message: the
 * relation (or placement) changed after it was loaded (another decision, a
 * new proposal, a re-upload or a chain save), it became obsolete, or a bulk
 * list no longer matches.
 */
export function conflictOf(
  error: unknown,
  seenVersion?: number,
  noun: ConflictNoun = 'relation',
): Conflict | null {
  if (!(error instanceof ApiError)) return null;
  const { code } = error.problem;
  if (code !== 'conflict' && code !== 'precondition-failed') return null;
  const words = NOUNS[noun];
  const extras = error.problem as Record<string, unknown>;
  const mismatches = Array.isArray(extras['mismatches']) ? extras['mismatches'] : null;
  if (mismatches) {
    const n = mismatches.length;
    return {
      title: 'Die Liste hat sich geändert',
      description: `${n === 1 ? words.one : `${n} ${words.many}`} sich seit dem Laden geändert. Es wurde nichts entschieden. Die Liste ist neu geladen; prüfe sie und bestätige noch einmal.`,
    };
  }
  if (typeof extras['expectedCount'] === 'number') {
    return {
      title: 'Die Liste hat sich geändert',
      description: `Die Anzahl der ${noun === 'relation' ? 'Relationen' : 'Platzierungen'} stimmt nicht mehr. Es wurde nichts entschieden. Die Liste ist neu geladen; prüfe sie und bestätige noch einmal.`,
    };
  }
  const now = typeof extras['version'] === 'number' ? extras['version'] : null;
  if (now !== null) {
    const seen = seenVersion === undefined ? '' : ` (du hast Version ${seenVersion} gesehen)`;
    return {
      title: `${words.the} wurde inzwischen geändert`,
      description: `Sie steht jetzt auf Version ${now}${seen}: Ein Agent oder eine andere Prüfung hat etwas ergänzt. Deine Entscheidung wurde nicht gespeichert. Der neue Stand ist geladen; prüfe ihn und entscheide noch einmal.`,
    };
  }
  return {
    title: `${words.the} kann so nicht entschieden werden`,
    description: `${error.problem.detail ?? error.problem.title}. Der neue Stand ist geladen; prüfe ihn noch einmal.`,
  };
}

/** Short German summary of a relation for toasts and dialogs: "a → b". */
export function pairText(
  relation: Pick<Relation, 'from' | 'to'>,
  labelOf: (ref: string) => string,
): string {
  return `${labelOf(relation.from)} → ${labelOf(relation.to)}`;
}

// ------------------------------------------------------------- queue rows (UX5)

/** The process a ref lies in (or is), else its model's key. */
export function sideName(label: RefLabel): string {
  if (label.kind === 'process') return label.label ?? label.elementId;
  return label.processName ?? label.modelKey;
}

/** The element's own name, for an element inside a process; `null` for a process. */
function elementName(label: RefLabel): string | null {
  if (label.kind === 'process') return null;
  return label.label ?? label.elementId;
}

/** „Rechnung“, or „Rechnung senden → Rechnung empfangen“ where both ends name themselves differently. */
export function elementsText(from: RefLabel, to: RefLabel): string | null {
  const a = elementName(from);
  const b = elementName(to);
  // „benötigt“ and „benoetigt“ are one name (the key tier compares them so)
  if (a !== null && b !== null) return nameKey(a) === nameKey(b) ? a : `${a} → ${b}`;
  return a ?? b;
}

/** A key-tier proposal with what makes it need more than a glance before a bulk accept. */
export interface BulkRow {
  relation: Relation;
  flags: GenericFlag[];
}

/**
 * The bulk accept's rows (UX5, owner decision 26 (6): „Gleicher Name“ only):
 * the key tier's open proposals with their flags; the unflagged ones are the
 * default selection, and their number is the button's („8 unauffällige
 * annehmen …“). The unique calls from derived models (M6 S2c,
 * {@link isDerivedCall}) are key-tier proposals too, so they are among them.
 */
export function bulkRows(
  relations: readonly Relation[],
  resolve: RefResolver,
  usage: NameUsage,
): BulkRow[] {
  return relations
    .filter((r) => r.tier === 'key' && r.status === 'proposed')
    .map((relation) => ({
      relation,
      flags: bulkFlags(relation, (ref) => resolve(ref).label, usage),
    }));
}

/**
 * What the bulk accept selects when it opens: every unflagged pair
 * (`unflagged`, its button), or (`calls`, from a „Gesammelt annehmen“ link,
 * `?bulk=calls`) the unflagged unique calls from derived models only, at
 * most {@link MAX_BULK_DECISIONS} (one request takes no more; the rest
 * follow in the next).
 */
export type BulkPreselect = 'unflagged' | 'calls';

/** The ids {@link BulkPreselect} selects among `rows`, in their order. */
export function bulkPreselection(rows: readonly BulkRow[], preselect: BulkPreselect): Set<string> {
  const plain = rows.filter((r) => r.flags.length === 0);
  if (preselect === 'unflagged') return new Set(plain.map((r) => r.relation.id));
  return new Set(
    plain
      .filter((r) => isDerivedCall(r.relation))
      .slice(0, MAX_BULK_DECISIONS)
      .map((r) => r.relation.id),
  );
}

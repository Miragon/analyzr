/**
 * „Als Nächstes“ on the project's „Übersicht“ (UX-SIMPLIFICATION.md §2.3):
 * one primary step picked by state, first match wins, and at most two lines
 * below it, each needing action (or saying why nothing does). Pure, so the
 * priority rules are tested without a server.
 */

export type NextPrimary =
  /**
   * Models wait for an agent and the project has no active agent token
   * (owners); `pairs` as for `start-agent`.
   */
  | { kind: 'connect-agent'; pairs: number }
  /**
   * Models wait for an agent, a token is active (owners): the popover „Agent
   * starten“, with the pairs the waiting tasks will judge beside it
   * ({@link NextStepInput.pairsToJudge}).
   */
  | { kind: 'start-agent'; waiting: number; pairs: number }
  /**
   * Only failed analyses or expired reservations wait (owners with a token):
   * a requeue alone runs nothing, so „Nochmal versuchen“ requeues and opens the popover.
   */
  | { kind: 'retry'; modelKeys: string[] }
  /** Relation proposals open: the review screen at the queue's first item. */
  | { kind: 'review'; count: number; relationId: string }
  /** Placements open: the chain with the queue's first item selected. */
  | { kind: 'placements'; count: number; placementId: string }
  /** „Zu klären“ > 0. */
  | { kind: 'questions'; count: number };

export type NextLine =
  /** An agent holds models and nothing else waits for it (a status, no action). */
  | { kind: 'working'; count: number }
  /** Models wait for an agent; this viewer cannot start one (editors, viewers). */
  | { kind: 'waiting'; count: number; pairs: number }
  | { kind: 'failed'; modelKeys: string[] }
  | { kind: 'expired'; modelKeys: string[] }
  /**
   * Unique calls from derived models wait (M6 S2c, `isBulkCall`): „Gesammelt
   * annehmen“ before the agent judges their pairs. While an agent row leads
   * (`first`: „… zuerst bestätigen“), after the failed and expired lines;
   * under „Vorschläge prüfen“ the first line („Davon …“).
   */
  | { kind: 'calls'; count: number; first: boolean }
  /**
   * The review offered while the agent rows lead; not when every open review
   * item is such a call (the `calls` line offers those).
   */
  | { kind: 'review-too'; count: number; relationId: string }
  /** Relations exist, the chain does not. */
  | { kind: 'no-chain' };

export interface NextStepInput {
  /** Keys of the models in `waiting_for_agent`. */
  waiting: readonly string[];
  /** Keys of the models in `agent_failed`. */
  failed: readonly string[];
  /** Keys of the models in `agent_working` whose reservation expired. */
  expired: readonly string[];
  /** Models in `agent_working` with a running reservation. */
  working: number;
  reviewItems: number;
  /**
   * The open unique calls from derived models a bulk accept takes (M6 S2c,
   * `isBulkCall` over the landscape's relations), part of `reviewItems`: the
   * selection of the bulk dialog the `calls` line opens.
   */
  derivedCalls: number;
  /** The review queue's first relation. */
  firstRelation: string | null;
  openPlacements: number;
  /** The placement queue's first item. */
  firstPlacement: string | null;
  ask: number;
  hasChain: boolean;
  hasRelations: boolean;
  isOwner: boolean;
  canReview: boolean;
  /** The project has an active agent token (owners only; else ignored). */
  activeToken: boolean;
  /**
   * The pairs the waiting relations tasks will judge
   * (`ProjectSummary.pairsToJudge`, M6 S2b follow-up step 3b), named beside
   * the agent row; 0 (the default) while unknown or when none waits.
   */
  pairsToJudge?: number;
}

export interface NextStep {
  /** `null`: nothing is open („Alles geprüft.“) or only status lines remain. */
  primary: NextPrimary | null;
  /** At most two, highest first. */
  lines: NextLine[];
}

const MAX_LINES = 2;

/** The rules of §2.3, first match wins. */
export function nextStep(input: NextStepInput): NextStep {
  const stuck = [...input.failed, ...input.expired];
  const agentPending = input.waiting.length + stuck.length > 0;
  const pairs = input.waiting.length > 0 ? (input.pairsToJudge ?? 0) : 0;
  const status: NextLine[] = [];
  let primary: NextPrimary | null = null;

  if (agentPending && input.isOwner) {
    if (!input.activeToken) primary = { kind: 'connect-agent', pairs };
    else if (input.waiting.length > 0)
      primary = { kind: 'start-agent', waiting: input.waiting.length, pairs };
    else primary = { kind: 'retry', modelKeys: stuck };
  } else if (input.waiting.length > 0) {
    status.push({ kind: 'waiting', count: input.waiting.length, pairs });
  } else if (!agentPending && input.working > 0) {
    // The agent works and nothing waits: the agent rows give way.
    status.push({ kind: 'working', count: input.working });
  }

  const agentRow = primary !== null;
  const calls: NextLine | null =
    input.derivedCalls > 0 ? { kind: 'calls', count: input.derivedCalls, first: agentRow } : null;
  // Under „Vorschläge prüfen“ the bulk shortcut for those calls comes first.
  const lines: NextLine[] = calls !== null && !agentRow ? [calls, ...status] : status;
  if (primary === null && input.reviewItems > 0 && input.firstRelation !== null) {
    primary = { kind: 'review', count: input.reviewItems, relationId: input.firstRelation };
  } else if (primary === null && input.openPlacements > 0 && input.firstPlacement !== null) {
    primary = {
      kind: 'placements',
      count: input.openPlacements,
      placementId: input.firstPlacement,
    };
  } else if (primary === null && input.ask > 0) {
    primary = { kind: 'questions', count: input.ask };
  }

  if (primary?.kind !== 'retry') {
    if (input.failed.length > 0) lines.push({ kind: 'failed', modelKeys: [...input.failed] });
    if (input.expired.length > 0) lines.push({ kind: 'expired', modelKeys: [...input.expired] });
  }
  if (agentRow && calls !== null) lines.push(calls);
  // No second line for the same rows: when every open item is such a call, `calls` offers them.
  if (agentRow && input.reviewItems > input.derivedCalls && input.firstRelation !== null) {
    lines.push({ kind: 'review-too', count: input.reviewItems, relationId: input.firstRelation });
  }
  if (input.hasRelations && !input.hasChain && input.canReview) lines.push({ kind: 'no-chain' });

  return { primary, lines: lines.slice(0, MAX_LINES) };
}

/** `1 Modell`, `3 Modelle`. */
export function modelCount(n: number): string {
  return n === 1 ? '1 Modell' : `${n} Modelle`;
}

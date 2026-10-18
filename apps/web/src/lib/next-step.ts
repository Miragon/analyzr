/**
 * „Als Nächstes“ on the project's „Übersicht“ (UX-SIMPLIFICATION.md §2.3):
 * one primary step picked by state, first match wins, and at most two lines
 * below it, each needing action (or saying why nothing does). Pure, so the
 * priority rules are tested without a server.
 */

export type NextPrimary =
  /** Models wait for an agent and the project has no active agent token (owners). */
  | { kind: 'connect-agent' }
  /** Models wait for an agent, a token is active (owners): the popover „Agent starten“. */
  | { kind: 'start-agent'; waiting: number }
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
  | { kind: 'waiting'; count: number }
  | { kind: 'failed'; modelKeys: string[] }
  | { kind: 'expired'; modelKeys: string[] }
  /** The review offered while the agent rows lead. */
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
  const lines: NextLine[] = [];
  let primary: NextPrimary | null = null;

  if (agentPending && input.isOwner) {
    if (!input.activeToken) primary = { kind: 'connect-agent' };
    else if (input.waiting.length > 0)
      primary = { kind: 'start-agent', waiting: input.waiting.length };
    else primary = { kind: 'retry', modelKeys: stuck };
  } else if (input.waiting.length > 0) {
    lines.push({ kind: 'waiting', count: input.waiting.length });
  } else if (!agentPending && input.working > 0) {
    // The agent works and nothing waits: the agent rows give way.
    lines.push({ kind: 'working', count: input.working });
  }

  const agentRow = primary !== null;
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
  if (agentRow && input.reviewItems > 0 && input.firstRelation !== null) {
    lines.push({ kind: 'review-too', count: input.reviewItems, relationId: input.firstRelation });
  }
  if (input.hasRelations && !input.hasChain && input.canReview) lines.push({ kind: 'no-chain' });

  return { primary, lines: lines.slice(0, MAX_LINES) };
}

/** `1 Modell`, `3 Modelle`. */
export function modelCount(n: number): string {
  return n === 1 ? '1 Modell' : `${n} Modelle`;
}

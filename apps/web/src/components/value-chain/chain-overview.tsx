import type { Placement, UnplacedProcess, ValueChainDetail, ValueChainStep } from '@analyzr/client';
import { cn } from 'cn';
import { ArrowRightIcon, CheckCheckIcon, ChevronRightIcon, WandSparklesIcon } from 'lucide-react';
import { forwardRef, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { RetryAgent } from '@/components/agent-start';
import { PlainText } from '@/components/review/plain-text';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import type { AutoAcceptIndex } from '@/lib/auto-accept';
import { STEP_KINDS } from '@/lib/labels';
import { MAX_VALUE_CHAIN_NAME_CHARS, OUTSIDE_STEP } from '@/lib/limits';
import type { RefResolver } from '@/lib/refs';
import {
  chainCoverage,
  isPlainProposal,
  placementQueue,
  placementStepLabel,
  processCount,
  reconfirmCandidates,
  stepTree,
  subtreeCounts,
  unplacedItems,
  type StepNode,
  type StepOption,
} from '@/lib/value-chain';

import { BulkReconfirmDialog } from './bulk-reconfirm-dialog';
import { CommitField } from './commit-field';
import { PlacementCard } from './placement-card';
import type { PlacementOutcome } from './placement-decision-panel';
import { UnplacedList } from './unplaced-list';

/** Rows of „Zu prüfen“ before „Alle n zeigen“ (J/K and the primary walk all of them). */
const FIRST_OPEN = 8;

const Section = forwardRef<
  HTMLElement,
  { title: string; count?: number; children: ReactNode; action?: ReactNode }
>(function Section({ title, count, children, action }, ref) {
  return (
    <section ref={ref} aria-label={title} className="flex scroll-mt-4 flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {title}
          {count === undefined ? null : <span className="ml-1 tabular-nums">({count})</span>}
        </h3>
        {action ? <div className="ml-auto">{action}</div> : null}
      </div>
      {children}
    </section>
  );
});

/** The visible tree's ids in display order (depth first, expanded nodes only). */
function treeOrder(nodes: readonly StepNode[], expanded: ReadonlySet<string>): string[] {
  return nodes.flatMap((n) => [
    n.step.elementId,
    ...(expanded.has(n.step.elementId) ? treeOrder(n.children, expanded) : []),
  ]);
}

/** The ids from the top level down to `id` (excluded). */
function ancestorIds(id: string, steps: readonly ValueChainStep[]): string[] {
  const byId = new Map(steps.map((s) => [s.elementId, s]));
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let parent = byId.get(id)?.parentId ?? null;
  while (parent !== null && !seen.has(parent)) {
    seen.add(parent);
    out.unshift(parent);
    parent = byId.get(parent)?.parentId ?? null;
  }
  return out;
}

function TreeItems({
  nodes,
  level,
  tabStop,
  expanded,
  counts,
  onSelect,
  onToggle,
  onFocusItem,
  onKey,
}: {
  nodes: readonly StepNode[];
  level: number;
  /** The one item in the tab order (roving tabindex). */
  tabStop: string | null;
  expanded: ReadonlySet<string>;
  /** Roll-ups per step: processes homed and open items in its subtree. */
  counts: ReadonlyMap<string, { placed: number; open: number }>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  onFocusItem: (id: string) => void;
  onKey: (event: KeyboardEvent<HTMLElement>, node: StepNode) => void;
}) {
  return nodes.map((node) => {
    const { step, children } = node;
    const open = expanded.has(step.elementId);
    const c = counts.get(step.elementId) ?? { placed: 0, open: 0 };
    return (
      <li key={step.elementId} role="none" className="flex flex-col">
        <div
          role="treeitem"
          aria-level={level}
          aria-expanded={children.length > 0 ? open : undefined}
          tabIndex={step.elementId === tabStop ? 0 : -1}
          data-testid="step-tree-item"
          data-element-id={step.elementId}
          onClick={() => onSelect(step.elementId)}
          onFocus={() => onFocusItem(step.elementId)}
          onKeyDown={(e) => onKey(e, node)}
          className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          style={{ paddingLeft: `${4 + (level - 1) * 16}px` }}
        >
          {children.length > 0 ? (
            // A pointer shortcut for ArrowRight/ArrowLeft; the row itself selects the step.
            <span
              aria-hidden
              className="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-accent"
              onClick={(e) => {
                e.stopPropagation();
                onToggle(step.elementId);
              }}
              data-testid="step-tree-toggle"
            >
              <ChevronRightIcon
                className={cn('size-3.5 transition-transform', open ? 'rotate-90' : '')}
              />
            </span>
          ) : (
            <span aria-hidden className="size-4 shrink-0" />
          )}
          <PlainText
            as="span"
            className="min-w-0 flex-1 truncate"
            text={step.name || step.elementId}
          />
          {level === 1 && step.kind !== 'core' ? (
            <span className="text-xs text-muted-foreground">{STEP_KINDS[step.kind].label}</span>
          ) : null}
          {c.placed > 0 ? (
            <span className="text-xs tabular-nums text-muted-foreground">
              {processCount(c.placed)}
            </span>
          ) : null}
          {c.open > 0 ? (
            <span className="text-xs tabular-nums text-warning">{c.open} offen</span>
          ) : null}
        </div>
        {children.length > 0 && open ? (
          <ul role="group" className="flex flex-col">
            <TreeItems
              nodes={children}
              level={level + 1}
              tabStop={tabStop}
              expanded={expanded}
              counts={counts}
              onSelect={onSelect}
              onToggle={onToggle}
              onFocusItem={onFocusItem}
              onKey={onKey}
            />
          </ul>
        ) : null}
      </li>
    );
  });
}

/**
 * The step tree (WAI-ARIA tree; UX6: its top-level rows, collapsed, with
 * roll-ups): one tab stop (roving tabindex); ArrowDown/ArrowUp move,
 * Home/End jump to the first and last visible step, ArrowRight opens a
 * closed step or goes to its first sub-step, ArrowLeft closes an open one or
 * goes to the parent; Enter or Space selects. `focusStepId` takes the focus
 * when the tree mounts (back from a step's panel), its ancestors opened.
 */
function StepTree({
  steps,
  counts,
  focusStepId,
  onSelect,
}: {
  steps: readonly ValueChainStep[];
  counts: ReadonlyMap<string, { placed: number; open: number }>;
  focusStepId: string | null;
  onSelect: (id: string) => void;
}) {
  const tree = stepTree(steps);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(focusStepId === null ? [] : ancestorIds(focusStepId, steps)),
  );
  const order = treeOrder(tree, expanded);
  const [current, setCurrent] = useState<string | null>(focusStepId);
  const tabStop = current !== null && order.includes(current) ? current : (order[0] ?? null);
  const root = useRef<HTMLUListElement>(null);

  const focusItem = (id: string | undefined) => {
    if (id === undefined) return;
    const items = root.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [];
    for (const item of items) {
      if (item.dataset['elementId'] === id) {
        item.focus();
        return;
      }
    }
  };
  const toggle = (id: string, open?: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open ?? !next.has(id)) next.add(id);
      else next.delete(id);
      return next;
    });

  useEffect(() => {
    if (focusStepId !== null) focusItem(focusStepId);
    // Once, when the tree mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onKey(event: KeyboardEvent<HTMLElement>, { step, children }: StepNode) {
    const at = order.indexOf(step.elementId);
    const open = expanded.has(step.elementId);
    let target: string | undefined;
    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        onSelect(step.elementId);
        return;
      case 'ArrowDown':
        target = order[Math.min(at + 1, order.length - 1)];
        break;
      case 'ArrowUp':
        target = order[Math.max(at - 1, 0)];
        break;
      case 'Home':
        target = order[0];
        break;
      case 'End':
        target = order.at(-1);
        break;
      case 'ArrowRight':
        if (children.length > 0 && !open) {
          event.preventDefault();
          toggle(step.elementId, true);
          return;
        }
        target = children[0]?.step.elementId;
        break;
      case 'ArrowLeft':
        if (children.length > 0 && open) {
          event.preventDefault();
          toggle(step.elementId, false);
          return;
        }
        target = step.parentId ?? undefined;
        break;
      default:
        return;
    }
    event.preventDefault();
    focusItem(target);
  }

  return (
    <ul ref={root} role="tree" aria-label="Schritte der Kette" className="flex flex-col">
      <TreeItems
        nodes={tree}
        level={1}
        tabStop={tabStop}
        expanded={expanded}
        counts={counts}
        onSelect={onSelect}
        onToggle={toggle}
        onFocusItem={setCurrent}
        onKey={onKey}
      />
    </ul>
  );
}

export interface ChainOverviewProps {
  project: string;
  detail: ValueChainDetail | undefined;
  placements: readonly Placement[];
  unplaced: readonly UnplacedProcess[] | undefined;
  modelKeys: ReadonlySet<string>;
  stepOptions: readonly StepOption[];
  canReview: boolean;
  mode: 'view' | 'edit';
  activePlacementId: string | null;
  shortcuts: boolean;
  onSelectStep: (elementId: string) => void;
  onSelectPlacement: (placementId: string) => void;
  onDecided: (placementId: string, outcome: PlacementOutcome) => void;
  onReload: () => void;
  /** Edit mode: the chain's name on the canvas and how to change it. */
  chainName?: string;
  onChainName?: (name: string) => void;
  /** The tree item to focus when the overview opens (back from that step's panel). */
  focusStepId?: string | null;
  /** Scroll „Ohne Schritt“ into view (the header's chip), then report it done. */
  revealUnplaced?: boolean;
  onRevealed?: () => void;
  /**
   * The auto-accept ledger (owner decision 19, owners only): marks on the
   * cards and the filter „Nur automatisch angenommene“.
   */
  autoIndex?: AutoAcceptIndex;
  /** Element names for the cards' evidence. */
  resolve?: RefResolver;
  /** A card's decision form opened: the phone's sheet expands (UX6). */
  onFormOpen?: () => void;
}

/**
 * The stage of the chain's placement pipeline (M4 §3.5), only when there is
 * something to do or wait for (UX6, UX-SIMPLIFICATION.md §3.8 item 1, §2.6):
 * „Agent arbeitet“; „Agent gescheitert · Nochmal versuchen“ (requeues the
 * task, then „Agent starten“ for owners); „Wartet auf den Agenten · Agent
 * starten“ while a task is queued; „3 Prozesse fällig · Agent starten“ when
 * processes are due without a queued or claimed task (reviewers' decisions
 * and notes make processes due but queue nothing; chains from before the
 * pipeline), which schedules the task first. Editors see the lines with a
 * plain button and no popover, viewers the text only.
 */
function StageLine({
  project,
  pipeline,
}: {
  project: string;
  pipeline: ValueChainDetail['pipeline'];
}) {
  const failed = pipeline.stage === 'agent_failed';
  const claimed = pipeline.task?.state === 'claimed';
  const queued = pipeline.task?.state === 'queued';
  const due = !failed && !claimed && !queued && pipeline.due > 0;
  if (!failed && !claimed && !queued && !due) return null;
  const text = claimed
    ? 'Agent arbeitet'
    : failed
      ? 'Agent gescheitert'
      : queued
        ? 'Wartet auf den Agenten'
        : pipeline.due === 1
          ? '1 Prozess fällig'
          : `${pipeline.due} Prozesse fällig`;
  return (
    <p
      className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground"
      data-testid="chain-stage"
      data-stage={pipeline.stage}
    >
      {claimed ? <Spinner className="size-3.5" /> : null}
      <span
        className={cn(failed ? 'text-danger' : '', due ? 'tabular-nums' : '')}
        data-testid={due ? 'chain-due' : undefined}
      >
        {text}
      </span>
      {/* One button through „fällig“ → „Wartet auf den Agenten“: its popover stays open. */}
      {claimed ? null : (
        <RetryAgent
          project={project}
          chain
          requeue={!queued}
          hasChain
          start={!failed}
          label={failed ? 'Nochmal versuchen' : 'Agent starten'}
          variant="link"
          size="sm"
          className="h-auto px-0"
          testId={queued ? 'chain-agent-start' : 'requeue-chain'}
        />
      )}
    </p>
  );
}

/**
 * The side panel without a selection (M4 §4; UX6, UX-SIMPLIFICATION.md §3.8
 * items 1–3): one status line („0 von 31 Prozessen platziert · 29 Vorschläge
 * offen“) and „Platzierungen prüfen (29)“ (= J), the pipeline's stage when
 * there is something to do, „Zu prüfen“ (a marker only on what to re-check),
 * „Ohne Schritt“ (unplaced processes and the agent's doubts in one list),
 * „Link nicht auflösbar“ when a step has such a link, the step tree closed
 * (its top-level rows collapsed, with roll-ups; one tab stop, arrows,
 * Home/End, Enter), placements outside the chain and on removed steps (that
 * section first while it holds the active card), and the owners' filter of
 * auto-accepted placements. In edit mode it shrinks to the chain's name and
 * a hint; the review sections return with „Fertig“.
 */
export function ChainOverview(props: ChainOverviewProps) {
  const {
    project,
    detail,
    placements,
    unplaced,
    modelKeys,
    stepOptions,
    canReview,
    mode,
    activePlacementId,
    shortcuts,
    onSelectStep,
    onSelectPlacement,
    onDecided,
    onReload,
    autoIndex,
    resolve,
    onFormOpen,
  } = props;
  const [bulkOpen, setBulkOpen] = useState(false);
  const [onlyAuto, setOnlyAuto] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const unplacedSection = useRef<HTMLElement>(null);
  const { revealUnplaced = false, onRevealed } = props;
  useEffect(() => {
    if (!revealUnplaced) return;
    unplacedSection.current?.scrollIntoView({ block: 'start' });
    onRevealed?.();
  }, [revealUnplaced, onRevealed]);

  if (mode === 'edit') {
    return (
      <div className="flex flex-col gap-4" data-testid="chain-overview">
        {props.onChainName ? (
          <CommitField
            id="vc-chain-name"
            label="Name der Kette"
            value={props.chainName ?? ''}
            maxLength={MAX_VALUE_CHAIN_NAME_CHARS}
            required
            onCommit={props.onChainName}
          />
        ) : null}
        <p className="text-sm text-muted-foreground" data-testid="edit-hint">
          {detail
            ? 'Wähle einen Schritt, um ihn zu bearbeiten. Gespeichert wird erst mit „Speichern“.'
            : 'Neue Kette: Ziehe Schritte aus der Palette links oder importiere eine .vc.json. Gespeichert wird erst mit „Speichern“.'}
        </p>
      </div>
    );
  }

  const autoAccepted = autoIndex ? placements.filter((p) => autoIndex.inForce.has(p.id)) : [];
  const steps = detail?.steps ?? [];
  const queue = placementQueue(placements, steps);
  const reconfirm = reconfirmCandidates(placements);
  const outside = placements.filter((p) => p.elementId === OUTSIDE_STEP);
  const removed = placements.filter((p) => p.elementId !== OUTSIDE_STEP && !p.stepLive);
  const unresolved = (detail?.findings ?? []).filter((f) => f.kind === 'unresolved-link');
  const withoutStep = unplaced ? unplacedItems(unplaced, detail?.unsure ?? []) : undefined;
  const stepName = (id: string | null) => steps.find((s) => s.elementId === id)?.name ?? id ?? '';

  // The active card's section leads when it holds the active card (a `reviewUrl` or J/K into
  // `@outside` or a removed step): the card is in view at once, and the sections above it that
  // load later („Ohne Schritt“) cannot push it away.
  const activeGroup = outside.some((p) => p.id === activePlacementId)
    ? 'outside'
    : removed.some((p) => p.id === activePlacementId)
      ? 'removed'
      : null;

  const card = (p: Placement) => (
    <PlacementCard
      key={p.id}
      project={project}
      placement={p}
      modelKeys={modelKeys}
      stepOptions={stepOptions}
      showStep
      active={p.id === activePlacementId}
      canReview={canReview}
      shortcuts={shortcuts}
      onActivate={() => onSelectPlacement(p.id)}
      onSelectStep={onSelectStep}
      onDecided={(outcome) => onDecided(p.id, outcome)}
      onReload={onReload}
      autoIndex={autoIndex}
      resolve={resolve}
      {...(onFormOpen ? { onFormOpen } : {})}
    />
  );

  // Owner decision 19: the panel filter shows only what auto-accept rules accepted (in force).
  const autoFilter =
    autoIndex && (autoAccepted.length > 0 || onlyAuto) ? (
      <div className="flex items-center gap-2">
        <Button
          size="xs"
          variant={onlyAuto ? 'default' : 'outline'}
          aria-pressed={onlyAuto}
          onClick={() => setOnlyAuto((on) => !on)}
          data-testid="filter-auto"
        >
          <WandSparklesIcon data-icon="inline-start" />
          Nur automatisch angenommene
          <span className="tabular-nums opacity-80">{autoAccepted.length}</span>
        </Button>
      </div>
    ) : null;
  if (onlyAuto && autoIndex) {
    return (
      <div className="flex flex-col gap-5" data-testid="chain-overview">
        {autoFilter}
        <Section title="Automatisch angenommen" count={autoAccepted.length}>
          {autoAccepted.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Keine Platzierung ist automatisch angenommen.
            </p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="auto-accepted-list">
              {autoAccepted.map(card)}
            </ul>
          )}
        </Section>
      </div>
    );
  }

  const outsideSection =
    outside.length > 0 ? (
      <Section title="Außerhalb der Kette" count={outside.length}>
        <ul className="flex flex-col gap-2">{outside.map(card)}</ul>
      </Section>
    ) : null;
  const removedSection =
    removed.length > 0 ? (
      <Section title="Auf entfernten Schritten" count={removed.length}>
        <p className="text-xs text-muted-foreground">
          Diese Schritte gibt es nicht mehr. Lehne die Platzierungen ab oder korrigiere sie auf
          einen anderen Schritt.
        </p>
        <ul className="flex flex-col gap-2">{removed.map(card)}</ul>
      </Section>
    ) : null;

  const coverage = withoutStep ? chainCoverage(placements, unplaced ?? []) : null;
  const shownQueue = allOpen ? queue : queue.slice(0, FIRST_OPEN);

  return (
    <div className="flex flex-col gap-5" data-testid="chain-overview">
      {activeGroup === 'outside' ? outsideSection : null}
      {activeGroup === 'removed' ? removedSection : null}

      {detail ? (
        <div className="flex flex-col items-start gap-2.5">
          {coverage ? (
            <p className="text-sm" data-testid="chain-summary">
              {coverage.placed} von {coverage.total}{' '}
              {coverage.total === 1 ? 'Prozess' : 'Prozessen'} platziert
              {queue.length > 0
                ? ` · ${queue.length === 1 ? '1 Vorschlag' : `${queue.length} Vorschläge`} offen`
                : ''}
            </p>
          ) : (
            <Skeleton className="h-5 w-64" />
          )}
          {queue[0] ? (
            <Button onClick={() => onSelectPlacement(queue[0]!.id)} data-testid="review-placements">
              Platzierungen prüfen ({queue.length})
              <ArrowRightIcon data-icon="inline-end" />
              <Kbd className="ml-1 border-transparent bg-white/20 text-current">J</Kbd>
            </Button>
          ) : null}
          <StageLine project={project} pipeline={detail.pipeline} />
        </div>
      ) : (
        <Skeleton className="h-5 w-full" />
      )}

      {detail && queue.length > 0 ? (
        <Section
          title="Zu prüfen"
          count={queue.length}
          action={
            canReview && reconfirm.selectable.length > 0 ? (
              <Button
                size="xs"
                variant="outline"
                onClick={() => setBulkOpen(true)}
                data-testid="open-bulk-reconfirm"
              >
                <CheckCheckIcon data-icon="inline-start" />
                Alle erneut bestätigen ({reconfirm.selectable.length})
              </Button>
            ) : null
          }
        >
          <ul className="flex flex-col gap-0.5" aria-label="Offene Platzierungen">
            {shownQueue.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  data-testid="open-placement"
                  data-placement-id={p.id}
                  onClick={() => onSelectPlacement(p.id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <PlainText
                      as="span"
                      className="truncate font-medium"
                      text={p.processName ?? p.process}
                    />
                    <span className="truncate text-xs text-muted-foreground">
                      <PlainText as="span" text={placementStepLabel(p)} />
                    </span>
                  </span>
                  {isPlainProposal(p) ? null : (
                    <span className="text-xs text-warning">erneut prüfen</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {queue.length > FIRST_OPEN ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAllOpen((a) => !a)}
              data-testid="open-placements-all"
            >
              {allOpen ? 'Weniger zeigen' : `Alle ${queue.length} zeigen`}
            </Button>
          ) : null}
        </Section>
      ) : null}

      {detail && (withoutStep === undefined || withoutStep.length > 0) ? (
        <Section ref={unplacedSection} title="Ohne Schritt" count={withoutStep?.length}>
          {withoutStep ? (
            <UnplacedList
              project={project}
              items={withoutStep}
              steps={stepOptions}
              canReview={canReview}
              onSelectStep={onSelectStep}
            />
          ) : (
            <Skeleton className="h-16 w-full" />
          )}
        </Section>
      ) : null}

      {unresolved.length > 0 ? (
        <Section title="Link nicht auflösbar" count={unresolved.length}>
          <ul className="flex flex-col gap-1.5" aria-label="Links, die analyzr nicht auflöst">
            {unresolved.map((f) => (
              <li
                key={`${f.kind}:${f.elementId}`}
                className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm"
                data-testid="chain-finding"
                data-kind={f.kind}
              >
                <button
                  type="button"
                  className="text-link hover:underline"
                  onClick={() => f.elementId && onSelectStep(f.elementId)}
                >
                  <PlainText as="span" text={stepName(f.elementId)} />
                </button>
                {f.link ? (
                  <PlainText
                    as="span"
                    className="min-w-0 truncate font-mono text-xs text-muted-foreground"
                    text={f.link}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {steps.length > 0 ? (
        <details
          className="group flex flex-col gap-2"
          data-testid="step-tree"
          open={props.focusStepId ? true : undefined}
        >
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground">
            <ChevronRightIcon
              className="size-4 transition-transform group-open:rotate-90"
              aria-hidden
            />
            Schritte <span className="tabular-nums">({steps.length})</span>
          </summary>
          <div className="pt-2">
            <StepTree
              steps={steps}
              counts={subtreeCounts(steps, placements)}
              focusStepId={props.focusStepId ?? null}
              onSelect={onSelectStep}
            />
          </div>
        </details>
      ) : null}

      {activeGroup === 'outside' ? null : outsideSection}
      {activeGroup === 'removed' ? null : removedSection}

      {autoFilter}

      {canReview ? (
        <BulkReconfirmDialog
          project={project}
          placements={placements}
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          onShowPlacement={onSelectPlacement}
        />
      ) : null}
    </div>
  );
}

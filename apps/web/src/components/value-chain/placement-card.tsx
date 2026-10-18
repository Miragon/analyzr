import type { Placement, PlacementAssertion } from '@analyzr/client';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import {
  ChevronRightIcon,
  CircleHelpIcon,
  CrosshairIcon,
  ExternalLinkIcon,
  LocateIcon,
  SearchCheckIcon,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';

import { AutoAcceptMark } from '@/components/auto-accept-mark';
import { EndpointStateBadge, StatusBadge } from '@/components/badges';
import { PlainText } from '@/components/review/plain-text';
import { AutoAcceptProvenance } from '@/components/rules/auto-accept-provenance';
import { AssertionTimeline } from '@/components/review/timeline';
import { TechnicalDetails } from '@/components/technical-details';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { AutoAcceptIndex } from '@/lib/auto-accept';
import { useIsOwner } from '@/lib/auto-accept-actions';
import {
  TIERS,
  TIER_FIELD_LABEL,
  formatConfidence,
  formatDateTime,
  handleName,
  procedureText,
} from '@/lib/labels';
import { placementAssertionsQuery } from '@/lib/queries';
import { bareResolver, splitRef, type RefResolver } from '@/lib/refs';
import {
  isPlainProposal,
  placementEvidenceItems,
  placementStepLabel,
  type StepOption,
} from '@/lib/value-chain';

import { PlacementDecisionPanel, type PlacementOutcome } from './placement-decision-panel';

/**
 * „Antwort geben“ of a held placement (UX6): the note dialog of „Offene
 * Fragen“, from the open-questions chunk on first use, as on the review
 * screen.
 */
const HoldAnswer = lazy(() => import('@/components/open-questions/hold-answer'));

export interface PlacementCardProps {
  project: string;
  placement: Placement;
  /** Model keys of the project: evidence refs into them link to the model view. */
  modelKeys: ReadonlySet<string>;
  /** Steps to correct to (`@outside` included); also the names of cited steps. */
  stepOptions: readonly StepOption[];
  /** `analyzr:process/` link of the placement's step points at this process (rule basis). */
  linkedByStep?: boolean;
  /** Name the step on the card (overview lists). */
  showStep?: boolean;
  active: boolean;
  canReview: boolean;
  /** A, R, H, C act on the active card when shortcuts are on. */
  shortcuts: boolean;
  onActivate: () => void;
  onSelectStep: (elementId: string) => void;
  onDecided: (outcome: PlacementOutcome) => void;
  onReload: () => void;
  /**
   * The auto-accept ledger (owner decision 19, every reviewer): marks a
   * placement an auto-accept rule accepted, with a single-item revoke for
   * owners.
   */
  autoIndex?: AutoAcceptIndex;
  /** Element names for the evidence; the bare element id until the facts are loaded. */
  resolve?: RefResolver;
}

/** The current proposal of a placement: the one its status rests on, else the latest. */
function currentProposal(
  placement: Placement,
  assertions: readonly PlacementAssertion[],
): PlacementAssertion | null {
  const basis = assertions.find((a) => a.id === placement.provenance?.assertionId);
  if (basis?.kind === 'proposal') return basis;
  return assertions.findLast((a) => a.kind === 'proposal') ?? null;
}

/** Notes after the current hold (answers). */
function answersSinceHold(placement: Placement, assertions: readonly PlacementAssertion[]) {
  const at = assertions.findIndex((a) => a.id === placement.provenance?.assertionId);
  return assertions.slice(at < 0 ? 0 : at + 1).filter((a) => a.kind === 'note');
}

/** „Vorgeschlagen von Agent „agent-sim“ · 17.10.2026, 22:32“ (UX6, the glossary's words). */
function proposedByText(a: Pick<PlacementAssertion, 'sourceKind' | 'handle' | 'at'>): string {
  const when = formatDateTime(a.at);
  switch (a.sourceKind) {
    case 'agent':
      return `Vorgeschlagen von Agent „${handleName(a.handle)}“ · ${when}`;
    case 'rule':
      return `Von analyzr erkannt · ${when}`;
    case 'human':
      return `Manuell platziert von „${a.handle}“ · ${when}`;
  }
}

function PlacementLink({
  project,
  assertion: a,
}: {
  project: string;
  assertion: PlacementAssertion;
}) {
  if (!a.linkedPlacementId) return null;
  return (
    <Link
      to="/projects/$project/value-chain"
      params={{ project }}
      search={{ placement: a.linkedPlacementId }}
      className="text-sm text-link hover:underline"
      title={a.linkedPlacementId}
    >
      {a.kind === 'decision' && a.verdict === 'reject'
        ? 'Korrigiert durch die manuelle Platzierung'
        : 'Korrektur dieses Vorschlags'}
    </Link>
  );
}

/**
 * One placement as the reviewer reads it (M4 §4; UX6, UX-SIMPLIFICATION.md
 * §3.8 item 4): process, its model path and the confidence; a status only
 * when it is not a plain proposal (the auto-accept mark stays, decision 19);
 * the rationale, the agent's question in its box, a hold's note and its
 * answers read-only, all as plain text; one closed „Details“ with the tier,
 * who proposed it and when, the evidence by name, the history (entries shown
 * above only by title, who and when) and „Technische Angaben“; „Im Modell“;
 * and the decision at the foot, where a held placement is answered through
 * the note dialog of „Offene Fragen“ in place of „Vormerken“. The active card
 * (from `?placement=`, else the first open one) takes the A/R/H/C shortcuts
 * and scrolls into view when it becomes active (J/K, a `reviewUrl` to a card
 * far down the overview); its key hints show only while the keys work. A
 * click on the card focuses it, so in edit mode the panel (and with it the
 * keys) takes over from the canvas.
 */
export function PlacementCard({
  project,
  placement: p,
  modelKeys,
  stepOptions,
  linkedByStep = false,
  showStep = false,
  active,
  canReview,
  shortcuts,
  onActivate,
  onSelectStep,
  onDecided,
  onReload,
  autoIndex,
  resolve = bareResolver,
}: PlacementCardProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Revoking an auto-acceptance is the owners' (the marks are every reviewer's).
  const owner = useIsOwner(project);
  const self = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (active) self.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  const held = p.status === 'held';
  const assertions = useQuery({
    ...placementAssertionsQuery(project, p.id),
    enabled: detailsOpen || held,
  });
  const { modelKey, elementId: processId } = splitRef(p.process);
  const name = p.processName ?? processId;
  const prov = p.provenance;
  const auto = autoIndex?.inForce.get(p.id);
  const autoEntries = autoIndex?.bySubject.get(p.id) ?? [];
  const proposal = assertions.data ? currentProposal(p, assertions.data) : null;
  const proposer = proposal ?? (prov?.kind === 'proposal' ? prov : null);
  const evidence = proposal ? placementEvidenceItems(proposal.evidence, modelKeys) : [];
  const answers = held && assertions.data ? answersSinceHold(p, assertions.data) : [];
  const stepName = (id: string) => stepOptions.find((s) => s.elementId === id)?.name || id;
  const textLabel =
    prov?.kind === 'decision'
      ? prov.verdict === 'reject'
        ? 'Grund der Ablehnung'
        : prov.verdict === 'hold'
          ? 'Notiz'
          : 'Notiz zur Entscheidung'
      : 'Begründung';
  // The texts above keep only their title, who and when in the history.
  const shownAbove = new Set(
    [prov?.assertionId, ...answers.map((a) => a.id)].filter((id): id is string => !!id),
  );
  const badges = [
    auto ? <AutoAcceptMark key="auto" entry={auto} /> : null,
    !auto && !isPlainProposal(p) ? <StatusBadge key="status" status={p.status} /> : null,
    <EndpointStateBadge key="endpoint" state={p.endpointState} />,
    p.endpoints.process === 'missing' ? (
      <Badge key="gone" variant="outline">
        Prozess fehlt
      </Badge>
    ) : !p.stepLive ? (
      <Badge key="gone" variant="outline">
        Schritt entfernt
      </Badge>
    ) : null,
  ];
  const showBadges =
    auto || !isPlainProposal(p) || p.endpoints.process === 'missing' || !p.stepLive;

  return (
    <li
      ref={self}
      tabIndex={-1}
      data-testid="placement-card"
      data-placement-id={p.id}
      data-status={p.status}
      data-active={active ? 'true' : 'false'}
      data-auto={auto ? 'true' : undefined}
      aria-current={active ? 'true' : undefined}
      onClick={() => {
        if (!active) onActivate();
      }}
      className={cn(
        'flex scroll-my-2 flex-col gap-2.5 rounded-xl border bg-card p-3 text-sm transition-colors outline-none',
        active ? 'border-primary ring-2 ring-primary/20' : 'hover:border-contour',
      )}
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <PlainText as="span" className="font-semibold" text={name} />
          <span className="truncate text-xs text-muted-foreground" data-testid="placement-model">
            {modelKey}
          </span>
          {showStep ? (
            <span className="text-xs text-muted-foreground">
              auf <PlainText as="span" text={placementStepLabel(p)} />
            </span>
          ) : null}
        </div>
        <span className="text-xs tabular-nums text-muted-foreground" title="Konfidenz">
          {formatConfidence(p.confidence)}
        </span>
      </div>
      {showBadges ? <div className="flex flex-wrap items-center gap-1.5">{badges}</div> : null}

      {prov?.rationale ? (
        <div>
          <p className="text-xs font-medium text-muted-foreground">{textLabel}</p>
          <PlainText text={prov.rationale} />
        </div>
      ) : null}
      {prov?.question ? (
        <div
          className="flex gap-2 rounded-lg border border-warning/40 bg-warning-soft px-2.5 py-1.5"
          data-testid="placement-question"
        >
          <CircleHelpIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium">{held ? 'Offene Frage' : 'Frage'}</p>
            <PlainText text={prov.question} />
          </div>
        </div>
      ) : null}
      {prov?.label ? (
        <span>
          <Badge variant="outline">
            <PlainText as="span" text={prov.label} />
          </Badge>
        </span>
      ) : null}
      {held && answers.length > 0 ? (
        <ol aria-label="Antworten" className="flex flex-col gap-1.5">
          {answers.map((a) => (
            <li
              key={a.id}
              data-testid="placement-answer"
              className="border-l-2 border-success pl-2.5"
            >
              <span className="text-xs text-muted-foreground">Antwort: </span>
              {a.rationale ? <PlainText as="span" text={a.rationale} /> : null}
            </li>
          ))}
        </ol>
      ) : null}

      <div className="flex items-start gap-2">
        <details
          className="group min-w-0 flex-1 text-xs"
          data-testid="placement-details"
          onToggle={(e) => setDetailsOpen(e.currentTarget.open)}
        >
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 py-0.5 text-muted-foreground select-none hover:text-foreground">
            <ChevronRightIcon
              className="size-3.5 transition-transform group-open:rotate-90"
              aria-hidden
            />
            Details
          </summary>
          <div className="flex flex-col gap-3 pt-2">
            <div className="flex flex-col gap-0.5 text-muted-foreground">
              <p data-testid="placement-tier">
                {TIER_FIELD_LABEL}: {TIERS[p.tier].label}
                {prov?.sourceKind === 'rule' && linkedByStep ? ' (über den Link des Schritts)' : ''}
              </p>
              {proposer ? <p data-testid="placement-proposer">{proposedByText(proposer)}</p> : null}
            </div>
            {assertions.isPending ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <>
                {evidence.length > 0 ? (
                  <ul className="flex flex-col gap-1" aria-label="Belege">
                    {evidence.map((item, i) => (
                      <li key={i} className="min-w-0">
                        {item.kind === 'ref' ? (
                          <Link
                            to="/projects/$project/models/$"
                            params={{ project, _splat: item.modelKey }}
                            search={{ element: item.elementId }}
                            className="inline-flex max-w-full items-center gap-1.5 text-link hover:underline"
                            title={`Im Modell ${item.modelKey} öffnen`}
                            data-testid="evidence-link"
                          >
                            <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden />
                            <PlainText
                              as="span"
                              className="truncate"
                              text={resolve(item.text).label ?? item.elementId}
                            />
                          </Link>
                        ) : item.kind === 'relation' ? (
                          <Link
                            to="/projects/$project/review/$relation"
                            params={{ project, relation: item.relationId }}
                            className="inline-flex max-w-full items-center gap-1.5 text-link hover:underline"
                            title={item.relationId}
                            data-testid="evidence-relation"
                          >
                            <SearchCheckIcon className="size-3.5 shrink-0" aria-hidden />
                            Relation ansehen
                          </Link>
                        ) : item.kind === 'step' ? (
                          <button
                            type="button"
                            onClick={() => onSelectStep(item.elementId)}
                            className="inline-flex max-w-full items-center gap-1.5 text-left text-link hover:underline"
                            data-testid="evidence-step"
                          >
                            <CrosshairIcon className="size-3.5 shrink-0" aria-hidden />
                            <PlainText
                              as="span"
                              className="truncate"
                              text={`Schritt „${stepName(item.elementId)}“`}
                            />
                          </button>
                        ) : (
                          <PlainText as="span" className="text-muted-foreground" text={item.text} />
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {autoEntries.length > 0 ? (
                  <AutoAcceptProvenance project={project} entries={autoEntries} canRevoke={owner} />
                ) : null}
                {assertions.data ? (
                  <AssertionTimeline
                    assertions={assertions.data}
                    renderLink={(a) => <PlacementLink project={project} assertion={a} />}
                    marks={autoIndex?.byAssertion}
                    brief={shownAbove}
                    technical={false}
                  />
                ) : null}
              </>
            )}
            <TechnicalDetails
              testId="placement-technical"
              rows={[
                ['Platzierung', `${p.id} · Version ${p.version}`],
                ['Prozess', p.process],
                ['Client', proposal?.clientId ?? prov?.clientId],
                ['Verfahren', procedureText((proposal ?? prov)?.procedure ?? null)],
                ['LLM-Modell', proposal?.llmModel ?? prov?.llmModel],
              ]}
            />
          </div>
        </details>
        {modelKeys.has(modelKey) ? (
          <Button variant="ghost" size="xs" asChild className="shrink-0">
            <Link
              to="/projects/$project/models/$"
              params={{ project, _splat: modelKey }}
              search={{ element: processId }}
            >
              <LocateIcon data-icon="inline-start" />
              Im Modell
            </Link>
          </Button>
        ) : null}
      </div>

      {canReview ? (
        <PlacementDecisionPanel
          project={project}
          placement={p}
          processName={name}
          stepOptions={stepOptions}
          shortcuts={active && shortcuts}
          showKeys={active && shortcuts}
          onDecided={(outcome) => onDecided(outcome)}
          onReload={onReload}
          holdAnswer={
            <Suspense fallback={null}>
              <HoldAnswer
                project={project}
                subject={{ type: 'placement', id: p.id }}
                className="justify-start"
              />
            </Suspense>
          }
        />
      ) : null}
    </li>
  );
}

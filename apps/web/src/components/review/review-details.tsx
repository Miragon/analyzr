import type { AutoAcceptLedgerEntry, Relation, RelationAssertion } from '@analyzr/client';
import { Link } from '@tanstack/react-router';
import {
  ChevronRightIcon,
  CircleHelpIcon,
  CrosshairIcon,
  ExternalLinkIcon,
  Undo2Icon,
  UnlinkIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { AutoAcceptMark } from '@/components/auto-accept-mark';
import { EndpointStateBadge, StatusBadge, TypeLabel } from '@/components/badges';
import { AutoAcceptProvenance } from '@/components/rules/auto-accept-provenance';
import { TechnicalDetails } from '@/components/technical-details';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  formatConfidence,
  formatDate,
  formatDateTime,
  procedureText,
  provenanceOf,
} from '@/lib/labels';
import type { TimelineMark } from '@/lib/auto-accept';
import type { RefResolver } from '@/lib/refs';
import { answersSinceHold, currentProposal, evidenceItems, type EvidenceItem } from '@/lib/review';

import { Endpoint } from '../relation-table';
import { PlainText } from './plain-text';
import { Principal } from './provenance';
import { AssertionTimeline, RelationLink } from './timeline';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

export interface ReviewDetailsProps {
  project: string;
  relation: Relation;
  /** The relation's history; `undefined` while loading. */
  assertions: readonly RelationAssertion[] | undefined;
  resolve: RefResolver;
  /** Model keys of the project: evidence refs into them are links. */
  modelKeys: ReadonlySet<string>;
  /**
   * The endpoints' models, shown on the review screen: evidence refs into
   * them go to `onEvidence`, refs into other models open the model view.
   * Without it, every ref into a project model goes to `onEvidence`.
   */
  paneModels?: ReadonlySet<string>;
  /** Shows a cited element in its canvas. */
  onEvidence?: (item: Extract<EvidenceItem, { kind: 'ref' }>) => void;
  /**
   * Owner decision 19, from the ledger (every reviewer): the relation's
   * auto-acceptances (oldest first), the marks of their assertions, and
   * whether the caller may revoke (owners).
   */
  autoAccept?: {
    entries: readonly AutoAcceptLedgerEntry[];
    marks: ReadonlyMap<string, TimelineMark>;
    canRevoke: boolean;
  };
}

/** „Technische Angaben“: the relation's id and version, the proposal's client, procedure and model (P2). */
function RelationTechnical({
  relation,
  proposal,
}: {
  relation: Relation;
  proposal: RelationAssertion | null;
}) {
  return (
    <TechnicalDetails
      testId="review-technical"
      rows={[
        ['Relation', `${relation.id} · Version ${relation.version}`],
        ['Client', proposal?.clientId],
        ['Verfahren', proposal ? procedureText(proposal.procedure) : null],
        ['LLM-Modell', proposal?.llmModel],
      ]}
    />
  );
}

/**
 * Everything a reviewer reads before deciding (CONCEPT §3; since UX5,
 * UX-SIMPLIFICATION.md §3.7 item 2): the header (type, status, both ends,
 * the confidence; „Automatisch angenommen“ as the status of an item a rule
 * accepted, owner decision 26 (5)), the agent's question, the agents'
 * current no-links on the pair, a held relation's note, question, label and
 * latest answer (read-only; answered from the decision bar), the rationale
 * and the evidence by element name. Who decided what, the tier, the rule and
 * its revision are in one closed „Verlauf (n)“, where an entry shown above
 * keeps only its title, who and when; the relation id, version, client,
 * procedure and model behind „Technische Angaben“. All agent text is plain
 * text.
 */
export function ReviewDetails({
  project,
  relation,
  assertions,
  resolve,
  modelKeys,
  paneModels,
  onEvidence,
  autoAccept,
}: ReviewDetailsProps) {
  const proposal = assertions ? currentProposal(relation, assertions) : null;
  const evidence = proposal ? evidenceItems(proposal.evidence, modelKeys) : [];
  const fallback = provenanceOf(relation);
  const question = proposal?.question ?? null;
  const held = relation.status === 'held';
  const holdQuestion = held && relation.provenance?.question ? relation.provenance.question : null;
  const holdNote = held && relation.provenance?.rationale ? relation.provenance.rationale : null;
  // The latest answer to the hold, where the decision is made (§3.7 item 3), read-only.
  const holdAnswer = held && assertions ? answersSinceHold(relation, assertions).at(-1) : undefined;
  const auto = autoAccept?.entries.at(-1);
  const inForce = auto?.state === 'in-force' && relation.status === 'accepted';
  // Entries the panel shows above keep only their title, who and when in „Verlauf“.
  const shownAbove = new Set(
    [proposal?.id, held ? relation.provenance?.assertionId : undefined].filter(
      (id): id is string => id !== undefined,
    ),
  );

  return (
    <div className="flex flex-col gap-5" data-testid="review-details">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <TypeLabel type={relation.type} />
          {inForce && auto ? (
            <AutoAcceptMark entry={auto} />
          ) : (
            <StatusBadge status={relation.status} />
          )}
          <EndpointStateBadge state={relation.endpointState} />
          <span className="ml-auto text-sm tabular-nums" title="Konfidenz">
            {formatConfidence(relation.confidence)}
          </span>
        </div>
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
          <dt className="pt-0.5 text-muted-foreground">Von</dt>
          <dd>
            <Endpoint label={resolve(relation.from)} />
          </dd>
          <dt className="pt-0.5 text-muted-foreground">Nach</dt>
          <dd>
            <Endpoint label={resolve(relation.to)} />
          </dd>
        </dl>
        {auto?.state === 'revoked' ? (
          <p
            className="flex items-center gap-1.5 text-sm text-muted-foreground"
            data-testid="auto-accept-revoked"
          >
            <Undo2Icon className="size-4 shrink-0" aria-hidden />
            Automatische Annahme widerrufen
          </p>
        ) : null}
      </div>

      {question ? (
        <div
          className="flex gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm"
          data-testid="agent-question"
        >
          <CircleHelpIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium">Frage des Agenten</p>
            <PlainText text={question} />
          </div>
        </div>
      ) : null}
      {relation.noLinks.length > 0 ? (
        <div
          className="flex gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm"
          data-testid="agent-no-links"
        >
          <UnlinkIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <p className="font-medium">Kein Zusammenhang laut Agent</p>
            <ul className="flex flex-col gap-2">
              {relation.noLinks.map((n) => (
                <li
                  key={n.id}
                  data-testid="agent-no-link"
                  data-no-link-id={n.id}
                  className="flex min-w-0 flex-col gap-0.5"
                >
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <Principal sourceKind="agent" handle={n.handle} />
                    <span>{formatDateTime(n.at)}</span>
                    <span className="min-w-0 truncate" title={n.origin}>
                      Analyse von <span className="font-mono">{n.origin}</span>
                    </span>
                  </span>
                  {n.reason.trim() ? (
                    <PlainText text={n.reason} />
                  ) : (
                    <p className="text-muted-foreground">Ohne Begründung.</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      {held ? (
        <div
          className="flex gap-2 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm"
          data-testid="hold-box"
        >
          <CircleHelpIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="font-medium">
              {holdQuestion && holdQuestion !== question
                ? 'Offene Frage (vorgemerkt)'
                : 'Vorgemerkt'}
            </p>
            {holdQuestion && holdQuestion !== question ? <PlainText text={holdQuestion} /> : null}
            {holdNote ? (
              <p className="text-muted-foreground">
                <span className="text-xs">Notiz zur Vormerkung: </span>
                <PlainText as="span" text={holdNote} />
              </p>
            ) : null}
            {relation.provenance?.label ? (
              <Badge variant="outline" className="bg-card">
                <PlainText as="span" text={relation.provenance.label} />
              </Badge>
            ) : null}
            {holdAnswer?.rationale ? (
              <p className="border-l-2 border-success pl-2" data-testid="hold-answer-latest">
                <span className="text-xs text-muted-foreground">
                  Antwort vom {formatDate(holdAnswer.at)}:{' '}
                </span>
                <PlainText as="span" text={holdAnswer.rationale} />
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <Section title="Begründung">
        {assertions === undefined ? (
          <Skeleton className="h-10 w-full" />
        ) : proposal?.rationale ? (
          <PlainText className="text-sm" text={proposal.rationale} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Keine Begründung angegeben
            {fallback.source === 'rule' ? ` (${fallback.detail})` : ''}.
          </p>
        )}
      </Section>

      {evidence.length > 0 ? (
        <Section title="Belege">
          <ul className="flex flex-col gap-1">
            {evidence.map((item, i) => (
              <li key={i} className="min-w-0 text-sm">
                {item.kind === 'ref' && paneModels && !paneModels.has(item.modelKey) ? (
                  <Link
                    to="/projects/$project/models/$"
                    params={{ project, _splat: item.modelKey }}
                    search={{ element: item.elementId }}
                    data-testid="evidence-link"
                    className="inline-flex max-w-full items-center gap-1.5 rounded-sm text-link hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    title={`Im Modell ${item.modelKey} öffnen`}
                  >
                    <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{resolve(item.text).label ?? item.elementId}</span>
                  </Link>
                ) : item.kind === 'ref' && onEvidence ? (
                  <button
                    type="button"
                    data-testid="evidence-ref"
                    onClick={() => onEvidence(item)}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-sm text-left text-link hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    title={`Im Diagramm zeigen (${item.modelKey})`}
                  >
                    <CrosshairIcon className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{resolve(item.text).label ?? item.elementId}</span>
                  </button>
                ) : (
                  <PlainText as="span" className="text-muted-foreground" text={item.text} />
                )}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <details className="group flex flex-col gap-3 border-t pt-3" data-testid="review-history">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground">
          <ChevronRightIcon
            className="size-4 transition-transform group-open:rotate-90"
            aria-hidden
          />
          Verlauf{assertions ? ` (${assertions.length})` : ''}
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          {autoAccept && autoAccept.entries.length > 0 ? (
            <AutoAcceptProvenance
              project={project}
              entries={autoAccept.entries}
              canRevoke={autoAccept.canRevoke}
            />
          ) : null}
          {assertions === undefined ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <AssertionTimeline
              assertions={assertions}
              renderLink={(a) => <RelationLink project={project} assertion={a} />}
              marks={autoAccept?.marks}
              brief={shownAbove}
              technical={false}
            />
          )}
          <RelationTechnical relation={relation} proposal={proposal} />
        </div>
      </details>
    </div>
  );
}

import { Link } from '@tanstack/react-router';
import { ArrowRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { AgentStart, RetryAgent } from '@/components/agent-start';
import { Button } from '@/components/ui/button';
import { modelCount, type NextLine, type NextPrimary, type NextStep } from '@/lib/next-step';

/**
 * „Als Nächstes“ (UX-SIMPLIFICATION.md §2.3): the one primary step of
 * {@link nextStep} and at most two lines below it; „Exportieren“ sits at the
 * block's right. Reviewers get buttons; viewers (and the read-only demo) the
 * same text as plain links or text, never a write. Nothing repeats the tab
 * badges.
 */
export function NextStepBlock({
  project,
  step,
  canReview,
  canWrite,
  hasChain,
  aside,
}: {
  project: string;
  step: NextStep;
  canReview: boolean;
  /** „Nochmal versuchen“ (permission `write`). */
  canWrite: boolean;
  hasChain: boolean;
  /** At the block's right: the export hub. */
  aside?: ReactNode;
}) {
  const status = step.lines.some((l) =>
    ['working', 'waiting', 'failed', 'expired'].includes(l.kind),
  );
  return (
    <section
      aria-labelledby="next-step-title"
      data-testid="next-step"
      className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2"
    >
      <div className="flex min-w-0 flex-col items-start gap-2">
        <h2 id="next-step-title" className="text-sm font-semibold text-muted-foreground">
          Als Nächstes
        </h2>
        {step.primary ? (
          <Primary
            project={project}
            primary={step.primary}
            canReview={canReview}
            hasChain={hasChain}
          />
        ) : status ? null : (
          <p data-testid="next-step-done">Alles geprüft.</p>
        )}
        {step.lines.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
            {step.lines.map((line) => (
              <li key={line.kind} data-testid="next-step-line" data-kind={line.kind}>
                <Line project={project} line={line} hasChain={hasChain} canWrite={canWrite} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {aside}
    </section>
  );
}

/** A navigation as the filled button for reviewers, a plain link for viewers. */
function Go({
  canReview,
  children,
  ...to
}: { canReview: boolean; children: ReactNode } & (
  | { to: '/projects/$project/review/$relation'; params: { project: string; relation: string } }
  | {
      to: '/projects/$project/value-chain';
      params: { project: string };
      search: { placement: string };
    }
  | { to: '/projects/$project/open-questions'; params: { project: string } }
)) {
  const link = (
    <Link {...to} data-testid="next-step-primary">
      {children}
      {canReview ? <ArrowRightIcon data-icon="inline-end" /> : null}
    </Link>
  );
  if (!canReview)
    return <span className="text-link underline-offset-4 hover:underline">{link}</span>;
  return (
    <Button asChild size="lg">
      {link}
    </Button>
  );
}

function Primary({
  project,
  primary,
  canReview,
  hasChain,
}: {
  project: string;
  primary: NextPrimary;
  canReview: boolean;
  hasChain: boolean;
}) {
  switch (primary.kind) {
    case 'connect-agent':
    case 'start-agent':
      return (
        <AgentStart project={project} hasChain={hasChain} size="lg" testId="next-step-primary" />
      );
    case 'retry':
      return (
        <RetryAgent
          project={project}
          modelKeys={primary.modelKeys}
          hasChain={hasChain}
          size="lg"
          testId="next-step-primary"
        />
      );
    case 'review':
      return (
        <Go
          canReview={canReview}
          to="/projects/$project/review/$relation"
          params={{ project, relation: primary.relationId }}
        >
          Vorschläge prüfen ({primary.count})
        </Go>
      );
    case 'placements':
      return (
        <Go
          canReview={canReview}
          to="/projects/$project/value-chain"
          params={{ project }}
          search={{ placement: primary.placementId }}
        >
          Platzierungen prüfen ({primary.count})
        </Go>
      );
    case 'questions':
      return (
        <Go canReview={canReview} to="/projects/$project/open-questions" params={{ project }}>
          Offene Fragen klären ({primary.count})
        </Go>
      );
  }
}

const inline = 'text-link underline-offset-4 hover:underline';

function Line({
  project,
  line,
  hasChain,
  canWrite,
}: {
  project: string;
  line: NextLine;
  hasChain: boolean;
  canWrite: boolean;
}) {
  switch (line.kind) {
    case 'working':
      return <>Agent arbeitet – {modelCount(line.count)} offen</>;
    case 'waiting':
      return (
        <>{line.count === 1 ? '1 Modell wartet' : `${line.count} Modelle warten`} auf den Agenten</>
      );
    case 'failed':
    case 'expired':
      return (
        <span className="inline-flex flex-wrap items-center gap-x-1">
          {line.kind === 'failed'
            ? `${line.modelKeys.length === 1 ? '1 Analyse' : `${line.modelKeys.length} Analysen`} gescheitert`
            : `Bei ${line.modelKeys.length === 1 ? '1 Modell' : `${line.modelKeys.length} Modellen`} ist die Reservierung abgelaufen`}
          {canWrite ? (
            <>
              <span aria-hidden>·</span>
              <RetryAgent
                project={project}
                modelKeys={line.modelKeys}
                hasChain={hasChain}
                variant="link"
                size="sm"
              />
            </>
          ) : null}
        </span>
      );
    case 'review-too':
      return (
        <>
          Oder jetzt schon:{' '}
          <Link
            to="/projects/$project/review/$relation"
            params={{ project, relation: line.relationId }}
            className={inline}
          >
            Vorschläge prüfen ({line.count})
          </Link>
          . Was du entscheidest, sieht der Agent bei seiner nächsten Aufgabe.
        </>
      );
    case 'no-chain':
      return (
        <>
          Noch keine Wertschöpfungskette ·{' '}
          <Link to="/projects/$project/value-chain" params={{ project }} className={inline}>
            Anlegen oder importieren
          </Link>
        </>
      );
  }
}

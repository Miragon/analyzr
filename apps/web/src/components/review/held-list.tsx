import type { Relation } from '@analyzr/client';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRightIcon, ArrowUpRightIcon, BookmarkIcon } from 'lucide-react';
import { lazy, Suspense } from 'react';

import { TypeLabel } from '@/components/badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/labels';
import { assertionsQuery } from '@/lib/queries';
import type { RefResolver } from '@/lib/refs';
import { answersSinceHold, type QueueFilters } from '@/lib/review';

import { Endpoint } from '../relation-table';
import { PlainText } from './plain-text';
import { Principal } from './provenance';

/**
 * „Antwort geben“ (UX2b): the note dialog of „Offene Fragen“ for the hold's
 * question, one place to answer a hold (UX-SIMPLIFICATION.md §2.4), loaded
 * with the open-questions modules on first render, never with the entry.
 */
const HoldAnswer = lazy(() => import('@/components/open-questions/hold-answer'));

function HeldItem({
  project,
  relation,
  resolve,
  filters,
  canAnswer,
}: {
  project: string;
  relation: Relation;
  resolve: RefResolver;
  filters: QueueFilters;
  canAnswer: boolean;
}) {
  const assertions = useQuery(assertionsQuery(project, relation.id));
  const answers = assertions.data ? answersSinceHold(relation, assertions.data) : [];
  const hold = relation.provenance;
  return (
    <li
      data-testid="held-item"
      data-relation-id={relation.id}
      className="flex flex-col gap-3 rounded-xl border bg-card p-4"
    >
      <div className="flex flex-wrap items-start gap-3">
        <TypeLabel type={relation.type} />
        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <Endpoint label={resolve(relation.from)} />
          <ArrowRightIcon className="size-4 text-muted-foreground" aria-hidden />
          <Endpoint label={resolve(relation.to)} />
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link
            to="/projects/$project/review/$relation"
            params={{ project, relation: relation.id }}
            search={{ ...filters, view: 'held' }}
            data-testid="held-decide"
          >
            <ArrowUpRightIcon data-icon="inline-start" />
            Jetzt entscheiden
          </Link>
        </Button>
      </div>

      {hold ? (
        <div className="flex flex-col gap-1.5 rounded-lg bg-warning-soft px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <BookmarkIcon className="size-3.5 text-warning" aria-hidden />
            <span>Vorgemerkt von</span>
            <Principal sourceKind={hold.sourceKind} handle={hold.handle} />
            <time dateTime={hold.at}>{formatDateTime(hold.at)}</time>
            {hold.label ? (
              <Badge variant="outline" className="bg-card">
                <PlainText as="span" text={hold.label} />
              </Badge>
            ) : null}
          </div>
          {hold.rationale ? <PlainText text={hold.rationale} /> : null}
          {hold.question ? (
            <p>
              <span className="font-medium">Frage: </span>
              <PlainText as="span" text={hold.question} />
            </p>
          ) : null}
        </div>
      ) : null}

      {assertions.isPending ? (
        <Skeleton className="h-5 w-48" />
      ) : answers.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {answers.length === 1 ? 'Antwort' : `Antworten (${answers.length})`}
          </h4>
          <ol aria-label="Antworten" className="flex flex-col gap-2">
            {answers.map((a) => (
              <li key={a.id} data-testid="held-answer" className="border-l-2 border-border pl-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Principal sourceKind={a.sourceKind} handle={a.handle} />
                  <time dateTime={a.at}>{formatDateTime(a.at)}</time>
                </div>
                {a.rationale ? <PlainText className="text-sm" text={a.rationale} /> : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {canAnswer ? (
        <Suspense fallback={null}>
          <HoldAnswer
            project={project}
            subject={{ type: 'relation', id: relation.id }}
            className="self-start"
          />
        </Suspense>
      ) : null}
    </li>
  );
}

/**
 * Held relations ("vorgemerkt", CONCEPT §3), the view „Vorgemerkt“: read-only
 * rows with the hold note, the question and label and the answers so far;
 * for reviewers „Antwort geben“ (since UX2b the note dialog of „Offene
 * Fragen“, the one place to answer a hold) and „Jetzt entscheiden“ (the
 * review screen, UX5). One sentence above the list says what an answer is.
 * Viewers (and the read-only demo) read the list without the answer.
 */
export function HeldList({
  project,
  relations,
  resolve,
  filters = {},
  canAnswer = true,
}: {
  project: string;
  relations: readonly Relation[];
  resolve: RefResolver;
  filters?: QueueFilters;
  /** Offer „Antwort geben“ (editors and owners). */
  canAnswer?: boolean;
}) {
  if (relations.length === 0) {
    return (
      <Empty className="border bg-card py-10">
        <EmptyHeader>
          <EmptyMedia>
            <BookmarkIcon className="size-6 text-muted-foreground" aria-hidden />
          </EmptyMedia>
          <EmptyTitle className="text-base font-semibold">Nichts vorgemerkt</EmptyTitle>
          <EmptyDescription>
            {canAnswer
              ? 'Merke eine Relation mit „Vormerken“ (H) vor, wenn eine Frage offen ist. Sie erscheint dann hier; mit „Antwort geben“ hältst du fest, was die Klärung ergeben hat.'
              : 'Vorgemerkte Relationen mit offener Frage erscheinen hier.'}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground" data-testid="held-intro">
        Die Antwort ist eine Notiz an der Relation; entschieden wird, sobald sie feststeht.
      </p>
      <ul aria-label="Vorgemerkte Relationen" className="flex flex-col gap-3">
        {relations.map((r) => (
          <HeldItem
            key={r.id}
            project={project}
            relation={r}
            resolve={resolve}
            filters={filters}
            canAnswer={canAnswer}
          />
        ))}
      </ul>
    </div>
  );
}

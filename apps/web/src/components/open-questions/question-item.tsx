import type { OpenQuestion } from '@analyzr/client';
import { answerRoleLabel } from '@analyzr/contracts/open-question-labels';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import {
  ChevronRightIcon,
  CircleHelpIcon,
  EarthIcon,
  EyeIcon,
  InfoIcon,
  TagIcon,
  Undo2Icon,
  UsersIcon,
} from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { ToneBadge } from '@/components/badges';
import { PlainText } from '@/components/review/plain-text';
import { Principal } from '@/components/review/provenance';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { formatDate, formatDateTime } from '@/lib/labels';
import { ANSWER_TARGET_LABELS, answersSummaryText } from '@/lib/open-question-answers';
import {
  OPEN_QUESTION_KINDS,
  OPEN_QUESTION_STATES,
  askWhoText,
  handleName,
  isVerbatim,
  latestNote,
  relationProcessesText,
  subjectLink,
  unlocksText,
  viewLink,
  type QuestionLink,
} from '@/lib/open-questions';
import type { RefResolver } from '@/lib/refs';

import { withdrawMark } from './action-feedback';
import { QuestionActions, type QuestionActor } from './question-actions';

/** A link to where a {@link QuestionLink} leads: the review screen, the chain or the model view. */
function PlaceLink({
  link,
  project,
  children,
  ...props
}: {
  link: QuestionLink;
  project: string;
  children: ReactNode;
  id?: string;
  className?: string;
  'aria-describedby'?: string;
  'data-testid': string;
}) {
  const data = { ...props, 'data-link': link.to };
  return link.to === 'review' ? (
    <Link
      to="/projects/$project/review/$relation"
      params={{ project, relation: link.relation }}
      {...data}
    >
      {children}
    </Link>
  ) : link.to === 'chain' ? (
    <Link
      to="/projects/$project/value-chain"
      params={{ project }}
      search={{
        ...(link.step ? { step: link.step } : {}),
        ...(link.placement ? { placement: link.placement } : {}),
      }}
      {...data}
    >
      {children}
    </Link>
  ) : (
    <Link
      to="/projects/$project/models/$"
      params={{ project, _splat: link.modelKey }}
      search={link.element ? { element: link.element } : {}}
      {...data}
    >
      {children}
    </Link>
  );
}

/**
 * The subject's name as a link on a one-line item (done, informational;
 * UX-SIMPLIFICATION.md §3.3 items 8 and 9): to the model view at the
 * element, the review screen, or the chain page at the step or placement.
 * In the model view a link to the model itself leads nowhere new, so it
 * stays text there.
 */
function SubjectLink({
  q,
  project,
  id,
  currentModel,
}: {
  q: OpenQuestion;
  project: string;
  id: string;
  currentModel: string | undefined;
}) {
  const link = subjectLink(q);
  if (link.to === 'model' && link.modelKey === currentModel && link.element === undefined)
    return (
      <span id={id} className="min-w-0 font-medium break-words">
        {q.subjectLabel}
      </span>
    );
  return (
    <PlaceLink
      link={link}
      project={project}
      id={id}
      className="min-w-0 font-medium break-words text-link underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      data-testid="question-subject"
    >
      {q.subjectLabel}
    </PlaceLink>
  );
}

/**
 * The card's way into the diagram ({@link viewLink}): a labelled button at
 * the header's end, „Im Modell zeigen“, „In der Kette zeigen“ or „Relation
 * ansehen“, so nobody has to guess that the name leads there.
 */
function ViewButton({
  view,
  project,
  describedBy,
}: {
  view: { link: QuestionLink; label: string };
  project: string;
  describedBy: string;
}) {
  return (
    <Button variant="outline" size="sm" asChild>
      <PlaceLink
        link={view.link}
        project={project}
        aria-describedby={describedBy}
        data-testid="question-open"
      >
        <EyeIcon data-icon="inline-start" />
        {view.label}
      </PlaceLink>
    </Button>
  );
}

/**
 * „Warum?“ (UX-SIMPLIFICATION.md §3.3 item 6): the reason behind the
 * question, closed. A native disclosure, so it is no action of the card:
 * `detail` (from code, or an agent's verbatim reason for an unsure verdict
 * or a coded no-link) and a hold's note (`context`), all as plain text.
 */
function Why({ q, showRaiser }: { q: OpenQuestion; showRaiser: boolean }) {
  if (q.detail === null && q.context === null) return null;
  const agentWords = isVerbatim(q) && q.detail !== null;
  return (
    <details className="group/why min-w-0 text-sm open:basis-full" data-testid="question-why">
      <summary className="inline-flex cursor-pointer list-none items-center gap-0.5 rounded-sm text-xs text-muted-foreground select-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          className="size-3.5 transition-transform group-open/why:rotate-90 motion-reduce:transition-none"
          aria-hidden
        />
        Warum?
      </summary>
      <div className="mt-1 flex flex-col gap-1 border-l-2 pl-3 text-muted-foreground">
        {q.detail !== null ? (
          <div data-testid="question-detail">
            {agentWords ? (
              <span className="text-xs">
                Laut Agent
                {showRaiser ? ` „${handleName(q.raisedBy.handle)}“` : ''}:{' '}
              </span>
            ) : null}
            <PlainText as={agentWords ? 'span' : 'p'} text={q.detail} />
          </div>
        ) : null}
        {q.context !== null ? (
          <div data-testid="question-context">
            <span className="text-xs">Notiz zur Vormerkung: </span>
            <PlainText as="span" text={q.context} />
          </div>
        ) : null}
      </div>
    </details>
  );
}

/**
 * Every note and outside mark of an item, oldest first, closed under
 * „Verlauf (n)“ (UX2b: a withdrawn mark leaves the card for it): who, when,
 * where a note is stored, its text as plain text.
 */
function History({ q, compact }: { q: OpenQuestion; compact: boolean }) {
  return (
    <details className="group/history min-w-0 text-xs" data-testid="question-answers">
      <summary className="inline-flex cursor-pointer list-none items-center gap-0.5 rounded-sm text-muted-foreground select-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          className="size-3.5 transition-transform group-open/history:rotate-90 motion-reduce:transition-none"
          aria-hidden
        />
        Verlauf ({q.answers.length})
      </summary>
      <div className="mt-1 flex flex-col gap-1.5 border-l-2 pl-3">
        <span className="text-muted-foreground">
          {answersSummaryText(q.answers, q.kind === 'held')}
        </span>
        <ul className="flex flex-col gap-2" aria-label="Notizen und Markierungen">
          {q.answers.map((a) => (
            <li
              key={a.id}
              className={cn('flex min-w-0 flex-col gap-0.5', a.withdrawal && 'opacity-70')}
              data-testid="question-answer"
              data-answer-kind={a.kind}
              data-role={a.role}
              data-target={a.target}
              data-withdrawn={a.withdrawal !== null}
            >
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
                <span
                  className={cn('font-medium text-foreground', a.withdrawal && 'line-through')}
                  data-testid="question-answer-kind"
                >
                  {answerRoleLabel(q.kind, a.role)}
                </span>
                <Principal sourceKind={a.sourceKind} handle={a.by} />
                <time dateTime={a.at} className="tabular-nums" data-testid="question-answer-at">
                  {formatDateTime(a.at)}
                </time>
                {/* A hold's notes are its answers: no „als Notiz …“ beside them. */}
                {a.role === 'note' && q.kind !== 'held' ? (
                  <span>{ANSWER_TARGET_LABELS[a.target]}</span>
                ) : null}
                {a.withdrawal ? (
                  <span data-testid="question-answer-withdrawn">
                    zurückgenommen von {a.withdrawal.by},{' '}
                    <time dateTime={a.withdrawal.at}>{formatDateTime(a.withdrawal.at)}</time>
                  </span>
                ) : null}
              </span>
              {a.text !== null ? (
                <div data-testid="question-answer-text">
                  <PlainText text={a.text} className={cn(compact ? 'text-xs' : 'text-sm')} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

/**
 * One open question as a card (UX-SIMPLIFICATION.md §3.3 items 5, 6 and 10;
 * UX2b): the kind, the subject's name (with the process it lies in), from
 * two on „Betrifft N offene Entscheidungen“, and a button into the diagram
 * ({@link ViewButton}); the question, „Warum?“
 * closed; a hold's label; whom to ask (step owners, lanes); the latest note,
 * and everything recorded under „Verlauf“; for reviewers (`actor`) at most
 * three actions (the primary, one beside it or „Weitere Aktionen“). No ids,
 * no event numbers, no source label. Human and agent texts are plain text.
 * `compact` is the model view's „Fragen“.
 */
export function QuestionItem({
  q,
  project,
  resolve,
  compact = false,
  currentModel,
  actor,
  showRaiser = false,
}: {
  q: OpenQuestion;
  project: string;
  resolve: RefResolver;
  compact?: boolean;
  /** The model in view: a way to it without an element leads nowhere new and is left out. */
  currentModel?: string;
  /** The actions' handlers; without it (viewers, the read-only demo) no action is shown. */
  actor?: QuestionActor;
  /** Name the agent behind verbatim words (only when items come from more than one). */
  showRaiser?: boolean;
}) {
  const subjectId = useId();
  const kind = OPEN_QUESTION_KINDS[q.kind];
  const hint = askWhoText(q.askWho);
  const meta = unlocksText(q);
  const note = latestNote(q);
  // The process an element lies in, where the subject is an element of a process; for a
  // relation (a hold) the processes of both ends, whose element names are often the same.
  const inProcess =
    !compact && q.subject.type === 'ref' && q.kind !== 'black-box-partner'
      ? resolve(q.subject.id).processName
      : null;
  const relationIn = compact ? null : relationProcessesText(q, resolve);
  const history = q.answers.length > (note ? 1 : 0);
  const agentQuestion = q.kind === 'agent-question' && showRaiser;
  const view = viewLink(q, {
    currentModel,
    withActions: actor !== undefined && q.actions.length > 0,
  });

  return (
    <li
      data-testid="open-question"
      data-question-id={q.id}
      data-kind={q.kind}
      data-source={q.source}
      data-subject={q.subject.type}
      data-group={q.group}
      data-unlocks={q.unlocks}
      data-state={q.state}
      tabIndex={-1}
      className={cn(
        'flex min-w-0 flex-col outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        compact ? 'gap-1.5 rounded-lg border p-2.5' : 'gap-2 rounded-xl border bg-card px-4 py-3',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <ToneBadge tone={kind.tone} icon={CircleHelpIcon} title={kind.hint}>
          {kind.label}
        </ToneBadge>
        <span
          id={subjectId}
          className={cn('min-w-0 font-medium break-words', compact && 'text-sm')}
          data-testid="question-subject"
        >
          {q.subjectLabel}
        </span>
        {inProcess && `„${inProcess}“` !== q.subjectLabel ? (
          <span className="text-sm text-muted-foreground" data-testid="question-process">
            in „{inProcess}“
          </span>
        ) : relationIn ? (
          <span className="text-sm text-muted-foreground" data-testid="question-process">
            {relationIn}
          </span>
        ) : null}
        {meta || view ? (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:ml-auto">
            {meta ? (
              <span className="text-xs text-muted-foreground" data-testid="question-unlocks">
                {meta}
              </span>
            ) : null}
            {view ? <ViewButton view={view} project={project} describedBy={subjectId} /> : null}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1 basis-64" data-testid="question-text">
          {agentQuestion ? (
            <span className="text-xs text-muted-foreground">
              Frage von „{handleName(q.raisedBy.handle)}“:{' '}
            </span>
          ) : null}
          <PlainText
            as={agentQuestion ? 'span' : 'p'}
            text={q.text}
            className={cn(compact ? 'text-xs' : 'text-sm')}
          />
        </div>
        <Why q={q} showRaiser={showRaiser} />
      </div>

      {q.label !== null || hint ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {q.label !== null ? (
            <span className="inline-flex items-center gap-1.5" data-testid="question-label">
              <TagIcon className="size-3.5 shrink-0" aria-hidden />
              <PlainText as="span" text={q.label} />
            </span>
          ) : null}
          {hint ? (
            <span
              className="inline-flex min-w-0 items-center gap-1.5"
              data-testid="question-ask-who"
            >
              <UsersIcon className="size-3.5 shrink-0" aria-hidden />
              <span className="break-words">Ansprechpartner: {hint}</span>
            </span>
          ) : null}
        </div>
      ) : null}

      {note ? (
        <p
          className="border-l-2 border-success pl-3 text-xs text-muted-foreground"
          data-testid="question-note"
        >
          {q.kind === 'held' ? 'Antwort' : 'Notiz'} vom {formatDate(note.at)}:{' '}
          <PlainText as="span" text={note.text ?? ''} className="text-foreground" />
        </p>
      ) : null}
      {history ? <History q={q} compact={compact} /> : null}

      {actor && q.actions.length > 0 ? (
        <QuestionActions
          q={q}
          project={project}
          resolve={resolve}
          describedBy={subjectId}
          actor={actor}
        />
      ) : null}
    </li>
  );
}

/**
 * A done item (UX-SIMPLIFICATION.md §3.3 item 9): one line „Außerhalb der
 * Landschaft · <Notiz>“ with the subject, and „Markierung zurücknehmen“ for
 * reviewers. Shown under „Erledigte zeigen“.
 */
export function DoneItem({
  q,
  project,
  canWithdraw,
  currentModel,
}: {
  q: OpenQuestion;
  project: string;
  canWithdraw: boolean;
  currentModel?: string;
}) {
  const subjectId = useId();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const mark = q.answers.find((a) => a.role === 'outside-mark' && a.withdrawal === null);
  return (
    <li
      data-testid="open-question"
      data-question-id={q.id}
      data-kind={q.kind}
      data-group={q.group}
      data-state={q.state}
      tabIndex={-1}
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <EarthIcon className="size-4 shrink-0 text-success" aria-hidden />
      <span className="text-muted-foreground" data-testid="question-state">
        {OPEN_QUESTION_STATES.answered}
      </span>
      <span aria-hidden className="text-muted-foreground">
        ·
      </span>
      <SubjectLink q={q} project={project} id={subjectId} currentModel={currentModel} />
      {mark?.text ? (
        <>
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          <PlainText as="span" text={mark.text} className="min-w-0 text-muted-foreground" />
        </>
      ) : null}
      {canWithdraw && mark ? (
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          disabled={busy}
          aria-describedby={subjectId}
          data-testid="question-withdraw-mark"
          onClick={() => {
            setBusy(true);
            void withdrawMark(queryClient, project, q.id, mark.id).finally(() => setBusy(false));
          }}
        >
          {busy ? <Spinner data-icon="inline-start" /> : <Undo2Icon data-icon="inline-start" />}
          Markierung zurücknehmen
        </Button>
      ) : null}
    </li>
  );
}

/**
 * An informational item in „Zur Information“ (decision 24.8: shown,
 * read-only; UX2b): one line with the subject and, for an agent's summary,
 * „Zusammenfassung des Agenten anzeigen“ closed, the text as plain text.
 */
export function InfoItem({
  q,
  project,
  currentModel,
}: {
  q: OpenQuestion;
  project: string;
  currentModel?: string;
}) {
  const subjectId = useId();
  return (
    <li
      data-testid="open-question"
      data-question-id={q.id}
      data-kind={q.kind}
      data-group={q.group}
      data-state={q.state}
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-sm"
    >
      <InfoIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <SubjectLink q={q} project={project} id={subjectId} currentModel={currentModel} />
      {q.kind === 'summary-note' ? (
        <details className="group/summary min-w-0 open:basis-full">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-0.5 rounded-sm text-xs text-muted-foreground select-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon
              className="size-3.5 transition-transform group-open/summary:rotate-90 motion-reduce:transition-none"
              aria-hidden
            />
            Zusammenfassung des Agenten anzeigen
          </summary>
          <div className="mt-1 ml-1 border-l-2 pl-3" data-testid="question-text">
            <PlainText text={q.text} />
          </div>
        </details>
      ) : (
        <PlainText as="span" text={q.text} className="text-muted-foreground" />
      )}
    </li>
  );
}

/** A closed group of the tab: „Zur Information (33)“, „Erledigte zeigen (1)“. */
export function ClosedGroup({
  title,
  count,
  testId,
  defaultOpen = false,
  children,
}: {
  title: string;
  count: number;
  testId: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  // The content is rendered only while open: a closed group holds no controls.
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className="group/closed min-w-0"
      data-testid={testId}
      open={defaultOpen}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-sm text-muted-foreground select-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          className="size-4 transition-transform group-open/closed:rotate-90 motion-reduce:transition-none"
          aria-hidden
        />
        {title} ({count})
      </summary>
      {open ? <div className="mt-2">{children}</div> : null}
    </details>
  );
}

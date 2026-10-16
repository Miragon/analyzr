import type { OpenQuestion } from '@analyzr/client';
import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import {
  CircleHelpIcon,
  FileSearchIcon,
  InfoIcon,
  LocateIcon,
  MapIcon,
  SearchCheckIcon,
  TagIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react';
import { useId } from 'react';

import { ToneBadge } from '@/components/badges';
import { Endpoint } from '@/components/relation-table';
import { PlainText } from '@/components/review/plain-text';
import { Principal } from '@/components/review/provenance';
import { Button } from '@/components/ui/button';
import {
  OPEN_QUESTION_KINDS,
  OPEN_QUESTION_SOURCES,
  VERBATIM_INTRO,
  askWhoText,
  extraRefs,
  isVerbatim,
  questionLinks,
  unlocksText,
  type QuestionLink,
} from '@/lib/open-questions';
import { splitRef, type RefResolver } from '@/lib/refs';

/** Refs listed per item; the export and the API have them all. */
const LISTED_REFS = 6;

const LINK_ICONS: Record<QuestionLink['to'], LucideIcon> = {
  model: LocateIcon,
  review: SearchCheckIcon,
  chain: MapIcon,
};

/**
 * A link of an item. `describedBy` names the item's subject, so a screen
 * reader's link list tells the many „Im Modell zeigen“ and „Prüfen“ apart.
 */
function QuestionLinkButton({
  project,
  link,
  variant,
  describedBy,
}: {
  project: string;
  link: QuestionLink;
  variant: 'outline' | 'ghost';
  describedBy: string;
}) {
  const Icon = LINK_ICONS[link.to];
  const content = (
    <>
      <Icon data-icon="inline-start" />
      {link.label}
    </>
  );
  return (
    <Button variant={variant} size="sm" asChild>
      {link.to === 'review' ? (
        <Link
          to="/projects/$project/review/$relation"
          params={{ project, relation: link.relation }}
          aria-describedby={describedBy}
          data-testid="question-link"
          data-link="review"
        >
          {content}
        </Link>
      ) : link.to === 'chain' ? (
        <Link
          to="/projects/$project/value-chain"
          params={{ project }}
          search={{
            ...(link.step ? { step: link.step } : {}),
            ...(link.placement ? { placement: link.placement } : {}),
          }}
          aria-describedby={describedBy}
          data-testid="question-link"
          data-link="chain"
        >
          {content}
        </Link>
      ) : (
        <Link
          to="/projects/$project/models/$"
          params={{ project, _splat: link.modelKey }}
          search={link.element ? { element: link.element } : {}}
          aria-describedby={describedBy}
          data-testid="question-link"
          data-link="model"
          title={link.element ? `${link.element} in ${link.modelKey}` : link.modelKey}
        >
          {content}
        </Link>
      )}
    </Button>
  );
}

/** Who raised the item and at which project state. */
function RaisedBy({ q }: { q: OpenQuestion }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {q.raisedBy.sourceKind === 'rule' || q.raisedBy.handle === null ? (
        <span>analyzr</span>
      ) : (
        <Principal sourceKind={q.raisedBy.sourceKind} handle={q.raisedBy.handle} />
      )}
      <span className="tabular-nums" title="Projektstand, auf dem die Frage beruht">
        s{q.raisedBy.seq}
      </span>
    </span>
  );
}

/**
 * One open question (M6 §4.4): kind, subject and the question; human and
 * agent texts verbatim as plain text with who said them; the contact hint;
 * the links to the model view, the review screen or the value chain page;
 * the refs. `compact` (the model view's panel) leaves out the refs list.
 */
export function QuestionItem({
  q,
  project,
  resolve,
  compact = false,
  currentModel,
}: {
  q: OpenQuestion;
  project: string;
  resolve: RefResolver;
  compact?: boolean;
  /** The model in view: a link to it without an element leads nowhere new and is left out. */
  currentModel?: string;
}) {
  const subjectId = useId();
  const kind = OPEN_QUESTION_KINDS[q.kind];
  const source = OPEN_QUESTION_SOURCES[q.source];
  const verbatim = isVerbatim(q);
  const hint = askWhoText(q.askWho);
  const links = questionLinks(q).filter(
    (l) => !(l.to === 'model' && l.modelKey === currentModel && l.element === undefined),
  );
  const refs = compact ? [] : extraRefs(q);
  const shown = refs.slice(0, LISTED_REFS);
  const subjectModel =
    q.subject.type === 'ref' || q.subject.type === 'process'
      ? splitRef(q.subject.id).modelKey
      : null;

  return (
    <li
      data-testid="open-question"
      data-question-id={q.id}
      data-kind={q.kind}
      data-source={q.source}
      data-unlocks={q.unlocks}
      className={cn(
        'flex min-w-0 flex-col gap-2',
        compact ? 'rounded-lg border p-2.5' : 'rounded-xl border bg-card p-4',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <ToneBadge
          tone={kind.tone}
          icon={kind.informational ? InfoIcon : CircleHelpIcon}
          title={kind.hint}
        >
          {kind.label}
        </ToneBadge>
        {/* The source only where the badge and the verbatim intro do not say it already
            (a finding, a chain finding or a gap signal: what the „Quelle“ filter names). */}
        {compact || verbatim || q.source === 'unjudged' ? null : (
          <span
            className="text-xs text-muted-foreground"
            title={source.hint}
            data-testid="question-source"
          >
            {source.label}
          </span>
        )}
        <span
          className="ml-auto text-xs text-muted-foreground tabular-nums"
          title="Offene Entscheidungen, die diese Frage betrifft: danach ist die Liste geordnet"
          data-testid="question-unlocks"
        >
          {unlocksText(q)}
        </span>
      </div>
      <div className="flex min-w-0 flex-col">
        <span id={subjectId} className={cn('font-medium break-words', compact && 'text-sm')}>
          {q.subjectLabel}
        </span>
        {subjectModel && subjectModel !== currentModel ? (
          <span className="truncate font-mono text-xs text-muted-foreground">{subjectModel}</span>
        ) : null}
      </div>

      {verbatim ? (
        <div
          className="flex flex-col gap-1 rounded-lg bg-muted px-3 py-2 text-sm"
          data-testid="question-verbatim"
        >
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span>{VERBATIM_INTRO[q.source]}</span>
            <RaisedBy q={q} />
          </span>
          {q.text.trim() ? (
            <div data-testid="question-text">
              <PlainText text={q.text} />
            </div>
          ) : (
            <p className="text-muted-foreground">Ohne Text.</p>
          )}
          {q.context !== null ? (
            <div className="flex flex-col gap-0.5 border-t pt-1" data-testid="question-context">
              <span className="text-xs text-muted-foreground">Notiz</span>
              <PlainText text={q.context} />
            </div>
          ) : null}
          {q.label !== null ? (
            <span className="inline-flex items-center gap-1.5 text-xs" data-testid="question-label">
              <TagIcon className="size-3.5 text-muted-foreground" aria-hidden />
              <PlainText as="span" text={q.label} />
            </span>
          ) : null}
        </div>
      ) : (
        <div data-testid="question-text">
          <PlainText text={q.text} className={cn(compact ? 'text-xs' : 'text-sm')} />
        </div>
      )}

      {shown.length > 0 ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Bezug</span>
          <ul className="flex flex-wrap items-start gap-x-6 gap-y-2" aria-label="Bezug">
            {shown.map((ref) => {
              const { modelKey, elementId } = splitRef(ref);
              return (
                <li key={ref} className="flex min-w-0 items-center gap-2">
                  <Endpoint label={resolve(ref)} />
                  <Button variant="ghost" size="icon-sm" asChild>
                    <Link
                      to="/projects/$project/models/$"
                      params={{ project, _splat: modelKey }}
                      search={elementId ? { element: elementId } : {}}
                      aria-label={`${elementId || modelKey} im Modell ${modelKey} zeigen`}
                      title="Im Modell zeigen"
                    >
                      <LocateIcon />
                    </Link>
                  </Button>
                </li>
              );
            })}
          </ul>
          {refs.length > shown.length ? (
            <span className="text-xs text-muted-foreground">
              und {refs.length - shown.length} weitere
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {hint ? (
          <span
            className="inline-flex min-w-0 items-center gap-1.5"
            title="Wer die Antwort kennen könnte: ein Hinweis, keine Zuständigkeit"
            data-testid="question-ask-who"
          >
            <UsersIcon className="size-3.5 shrink-0" aria-hidden />
            <span className="sr-only">Ansprechpartner-Hinweis:</span>
            <span className="break-words">{hint}</span>
          </span>
        ) : null}
        {verbatim ? null : (
          <span className="inline-flex items-center gap-1.5">
            <FileSearchIcon className="size-3.5" aria-hidden />
            <span>Erkannt von</span>
            <RaisedBy q={q} />
          </span>
        )}
        {compact ? null : (
          <span className="font-mono" title="Kennung (auch im Export)">
            {q.id}
          </span>
        )}
      </div>

      {links.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {links.map((link, i) => (
            <QuestionLinkButton
              key={`${link.to}:${i}`}
              project={project}
              link={link}
              variant={i === 0 ? 'outline' : 'ghost'}
              describedBy={subjectId}
            />
          ))}
        </div>
      ) : null}
    </li>
  );
}

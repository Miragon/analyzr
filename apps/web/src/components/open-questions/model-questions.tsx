import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRightIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { infoGroup, questionsOfModel } from '@/lib/open-questions';
import { useProjectPermissions } from '@/lib/permissions';
import { modelOpenQuestionsQuery } from '@/lib/queries';
import type { RefResolver } from '@/lib/refs';

import { NoteDialog } from './note-dialog';
import type { QuestionActor } from './question-actions';
import { ClosedGroup, InfoItem, QuestionItem } from './question-item';
import { useActionFocus } from './use-action-focus';
import { useNoteDialog } from './use-note-dialog';

export { default as SubprocessLink } from './subprocess-link';

/**
 * The section „Fragen“ of the model view (M6 §4.4; UX2b: the open questions
 * „Zu klären“ as cards, UX-SIMPLIFICATION.md §3.5 items 2 and 5): the
 * questions touching this model, in list order, compact cards as in the tab
 * and, for reviewers, their actions (M6 §4.8 a), and a link to the tab
 * filtered by the model; below them one link to the agents' questions about
 * its proposals (until UX3 shows each on its relation card) and the closed
 * „Zur Information“ with the agent's summary (decision 24.8: read-only in the
 * model view too). Loaded lazily with the model view's panel, so the entry
 * chunk carries none of it; the model view takes `SubprocessLink` from this
 * module too, so both share one lazy chunk.
 */
export default function ModelQuestions({
  project,
  modelKey,
  resolve,
  element,
  onCount,
}: {
  project: string;
  modelKey: string;
  resolve: RefResolver;
  /** The selected element (UX3): only its questions, by subject or ref. */
  element?: string | undefined;
  /** The number of cards shown, for the panel's tab and handle. */
  onCount?: (count: number) => void;
}) {
  const query = useQuery(modelOpenQuestionsQuery(project, modelKey));
  const own = useMemo(
    () => questionsOfModel(query.data ?? [], modelKey).filter((q) => q.state === 'open'),
    [query.data, modelKey],
  );
  const items = useMemo(() => {
    const ask = own.filter((q) => q.group === 'ask');
    if (!element) return ask;
    const ref = `${modelKey}#${element}`;
    return ask.filter((q) => q.subject.id === ref || q.refs.includes(ref));
  }, [own, element, modelKey]);
  const shown = query.data ? items.length : undefined;
  useEffect(() => {
    if (shown !== undefined) onCount?.(shown);
  }, [shown, onCount]);
  const agentCount = own.filter((q) => q.group === 'agent').length;
  const info = useMemo(
    () =>
      infoGroup(
        own.filter((q) => q.group === 'info'),
        1,
      ),
    [own],
  );
  const infoCount = (info.descriptive?.items.length ?? 0) + info.rest.length;
  const { canReview } = useProjectPermissions(project);
  const noting = useNoteDialog();
  const list = useRef<HTMLUListElement>(null);
  const ids = useMemo(() => items.map((q) => q.id), [items]);
  const acted = useActionFocus(
    ids,
    list,
    useCallback(() => document.getElementById('model-open-questions'), []),
  );
  const actor = useMemo<QuestionActor>(() => ({ note: noting.open, acted }), [noting.open, acted]);

  return (
    <section aria-labelledby="model-open-questions" data-testid="model-open-questions">
      <div className="flex items-center gap-2 px-2 pb-1">
        {/* The panel's tab names the section (UX3); the heading stays for focus and landmarks. */}
        <h3 id="model-open-questions" tabIndex={-1} className="sr-only outline-none">
          Fragen{query.data ? ` (${items.length})` : ''}
        </h3>
        {items.length > 0 ? (
          <Link
            to="/projects/$project/open-questions"
            params={{ project }}
            search={{ model: modelKey }}
            className="ml-auto inline-flex items-center gap-1 text-xs text-link hover:underline"
          >
            Im Tab zeigen
            <ArrowRightIcon className="size-3.5" aria-hidden />
          </Link>
        ) : null}
      </div>
      {query.isPending ? (
        <Skeleton className="mx-2 h-16" />
      ) : query.isError ? (
        <p className="px-2 text-sm text-destructive">
          Fragen konnten nicht geladen werden: {errorMessage(query.error)}
        </p>
      ) : items.length === 0 ? (
        <p className="px-2 text-sm text-muted-foreground">
          {element
            ? 'Zu diesem Element ist nichts zu klären.'
            : 'Zu diesem Modell ist nichts zu klären.'}
        </p>
      ) : (
        <ul ref={list} className="flex flex-col gap-1.5" aria-label="Fragen zu diesem Modell">
          {items.map((q) => (
            <QuestionItem
              key={q.id}
              q={q}
              project={project}
              resolve={resolve}
              compact
              currentModel={modelKey}
              {...(canReview ? { actor } : {})}
            />
          ))}
        </ul>
      )}
      {agentCount > 0 || infoCount > 0 ? (
        <div className="mt-2 flex flex-col gap-2 px-2">
          {agentCount > 0 ? (
            // The agents' questions sit on their proposals (owner decision 26); one link to them.
            <Link
              to="/projects/$project/open-questions"
              params={{ project }}
              search={{ model: modelKey, kind: 'agent-question' }}
              className="self-start text-xs text-link hover:underline"
              data-testid="model-agent-questions"
            >
              Fragen der Agenten zu Vorschlägen ({agentCount})
            </Link>
          ) : null}
          {infoCount > 0 ? (
            <ClosedGroup title="Zur Information" count={infoCount} testId="model-questions-info">
              <ul className="flex flex-col divide-y" aria-label="Zur Information">
                {info.descriptive ? (
                  <li className="py-1.5 text-sm text-muted-foreground">{info.descriptive.text}</li>
                ) : null}
                {info.rest.map((q) => (
                  <InfoItem key={q.id} q={q} project={project} currentModel={modelKey} />
                ))}
              </ul>
            </ClosedGroup>
          ) : null}
        </div>
      ) : null}
      {canReview ? (
        <NoteDialog
          project={project}
          state={noting.state}
          onClose={noting.close}
          fallbackFocusId="model-open-questions"
        />
      ) : null}
    </section>
  );
}

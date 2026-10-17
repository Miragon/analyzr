import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRightIcon } from 'lucide-react';
import { useCallback, useMemo, useRef } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { questionsOfModel } from '@/lib/open-questions';
import { useProjectPermissions } from '@/lib/permissions';
import { modelOpenQuestionsQuery } from '@/lib/queries';
import type { RefResolver } from '@/lib/refs';

import { NoteDialog } from './note-dialog';
import type { QuestionActor } from './question-actions';
import { QuestionItem } from './question-item';
import { useActionFocus } from './use-action-focus';
import { useNoteDialog } from './use-note-dialog';

export { default as SubprocessLink } from './subprocess-link';

/**
 * The section „Offene Fragen“ of the model view (M6 §4.4): the questions
 * touching this model, in list order, compact, with their notes and marks
 * and, for reviewers, their actions (M6 §4.8 a, S5c-1: the primary action,
 * „Weitere Aktionen“, the panels, „Notiz hinzufügen“), and a link to the tab
 * filtered by the model. Loaded lazily with the model view's panel, so the
 * entry chunk carries none of it; the model view takes `SubprocessLink`
 * from this module too, so both share one lazy chunk.
 */
export default function ModelQuestions({
  project,
  modelKey,
  resolve,
}: {
  project: string;
  modelKey: string;
  resolve: RefResolver;
}) {
  const query = useQuery(modelOpenQuestionsQuery(project, modelKey));
  const items = useMemo(() => questionsOfModel(query.data ?? [], modelKey), [query.data, modelKey]);
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
        <h3 id="model-open-questions" tabIndex={-1} className="text-sm font-semibold outline-none">
          Offene Fragen{query.data ? ` (${items.length})` : ''}
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
          Offene Fragen konnten nicht geladen werden: {errorMessage(query.error)}
        </p>
      ) : items.length === 0 ? (
        <p className="px-2 text-sm text-muted-foreground">
          Zu diesem Modell ist keine Frage offen.
        </p>
      ) : (
        <ul ref={list} className="flex flex-col gap-1.5" aria-label="Offene Fragen dieses Modells">
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

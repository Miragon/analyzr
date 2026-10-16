import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRightIcon } from 'lucide-react';
import { useMemo } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { questionsOfModel } from '@/lib/open-questions';
import { modelOpenQuestionsQuery } from '@/lib/queries';
import type { RefResolver } from '@/lib/refs';

import { QuestionItem } from './question-item';

/**
 * The section „Offene Fragen“ of the model view (M6 §4.4): the questions
 * touching this model, in list order, compact, and a link to the tab
 * filtered by the model. Loaded lazily with the model view's panel, so the
 * entry chunk carries none of it.
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

  return (
    <section aria-labelledby="model-open-questions" data-testid="model-open-questions">
      <div className="flex items-center gap-2 px-2 pb-1">
        <h3 id="model-open-questions" className="text-sm font-semibold">
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
        <ul className="flex flex-col gap-1.5" aria-label="Offene Fragen dieses Modells">
          {items.map((q) => (
            <QuestionItem
              key={q.id}
              q={q}
              project={project}
              resolve={resolve}
              compact
              currentModel={modelKey}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

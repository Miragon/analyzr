import {
  answerOpenQuestion,
  answerOpenQuestions,
  type AnswerOpenQuestionResult,
  type AnswerSheetResult,
  type OpenQuestion,
  type OpenQuestionAnswerKind,
} from '@analyzr/client';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api, unwrap } from './api';
import type { SheetRow } from './open-question-answers';
import { keys } from './queries';

/**
 * Answer writes (M6 §4.5, S5a): one answer through „Beantworten“, a
 * filled-in sheet through „Antworten aus CSV übernehmen“ (a dry run first).
 * Permission `review`, humans only; the read-only demo refuses them
 * (`demo-readonly`). Each write refreshes everything of the project
 * afterwards, also after a failure (an unknown id means the list is stale):
 * a note answer is a note on the relation or placement as well.
 */

function useInvalidateProject(project: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: keys.project(project) });
}

export interface AnswerInput {
  questionId: string;
  kind: OpenQuestionAnswerKind;
  text: string;
}

export function useAnswerOpenQuestion(project: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateProject(project);
  return useMutation({
    mutationFn: ({ questionId, kind, text }: AnswerInput): Promise<AnswerOpenQuestionResult> =>
      unwrap(
        answerOpenQuestion({
          client: api,
          path: { project, question: questionId },
          body: { kind, text },
        }),
      ),
    onSuccess: (result) => {
      // The answered item at once in the tab and the model view's section; the refetch follows.
      queryClient.setQueriesData<unknown>(
        { queryKey: [...keys.project(project), 'open-questions'] },
        (old: unknown) =>
          Array.isArray(old)
            ? (old as OpenQuestion[]).map((q) =>
                q.id === result.question.id ? result.question : q,
              )
            : old,
      );
    },
    onSettled: invalidate,
  });
}

export interface SheetInput {
  rows: readonly SheetRow[];
  dryRun: boolean;
}

/** The sheet route: `dryRun` previews and stores nothing (and refreshes nothing). */
export function useAnswerSheet(project: string) {
  const invalidate = useInvalidateProject(project);
  return useMutation({
    mutationFn: ({ rows, dryRun }: SheetInput): Promise<AnswerSheetResult> =>
      unwrap(
        answerOpenQuestions({
          client: api,
          path: { project },
          query: { dryRun: dryRun ? 'true' : 'false' },
          body: { rows: [...rows] },
        }),
      ),
    onSettled: (_data, _error, input) => (input.dryRun ? undefined : invalidate()),
  });
}

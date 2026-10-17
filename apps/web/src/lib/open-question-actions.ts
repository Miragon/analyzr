import {
  actOnOpenQuestion,
  answerOpenQuestion,
  answerOpenQuestions,
  proposeRelation,
  type AnswerOpenQuestionResult,
  type AnswerSheetResult,
  type OpenQuestion,
  type OpenQuestionActionBody,
  type OpenQuestionActionResult,
  type ProposeRelationResult,
} from '@analyzr/client';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { api, unwrap } from './api';
import type { SheetRow } from './open-question-answers';
import { keys } from './queries';

/**
 * Writes on open questions: a note through „Notiz hinzufügen“ (M6 §4.8 b), a
 * filled-in sheet through „Antworten aus CSV übernehmen“ (a dry run first;
 * S5a), the actions (link, place, choose the copy, mark outside; M6 §4.8 a,
 * S5c-1) and the manual relation from a collapsed subprocess in the model
 * view; the withdrawal of an outside mark and „Rückgängig“ run from the
 * toast (`components/open-questions/action-feedback.ts`). Permission `review`, humans only;
 * the read-only demo refuses them (`demo-readonly`). Each write refreshes
 * everything of the project afterwards, also after a failure (an unknown id
 * means the list is stale): an action writes relations and placements too.
 */

function useInvalidateProject(project: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: keys.project(project) });
}

/**
 * The item as the list now shows it, at once in the tab and the model
 * view's section (the refetch follows): replaced, or taken off when
 * `question` is `null` (the action ended it).
 */
function showQuestion(
  queryClient: QueryClient,
  project: string,
  questionId: string,
  question: OpenQuestion | null,
) {
  queryClient.setQueriesData<unknown>(
    { queryKey: [...keys.project(project), 'open-questions'] },
    (old: unknown) =>
      Array.isArray(old)
        ? (old as OpenQuestion[]).flatMap((q) =>
            q.id !== questionId ? [q] : question === null ? [] : [question],
          )
        : old,
  );
}

export interface NoteInput {
  questionId: string;
  text: string;
}

/** „Notiz hinzufügen“: `POST …/open-questions/{q}/answers` with the text only (no kind since S5c-1). */
export function useAddQuestionNote(project: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateProject(project);
  return useMutation({
    mutationFn: ({ questionId, text }: NoteInput): Promise<AnswerOpenQuestionResult> =>
      unwrap(
        answerOpenQuestion({
          client: api,
          path: { project, question: questionId },
          body: { text },
        }),
      ),
    onSuccess: (result, input) =>
      showQuestion(queryClient, project, input.questionId, result.question),
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

export interface ActionInput {
  questionId: string;
  body: OpenQuestionActionBody;
}

/** One of an item's actions: `POST …/open-questions/{q}/actions` (link, place, choose-copy, outside). */
export function useQuestionAction(project: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateProject(project);
  return useMutation({
    mutationFn: ({ questionId, body }: ActionInput): Promise<OpenQuestionActionResult> =>
      unwrap(
        actOnOpenQuestion({
          client: api,
          path: { project, question: questionId },
          body,
        }),
      ),
    onSuccess: (result, input) =>
      showQuestion(queryClient, project, input.questionId, result.question),
    onSettled: invalidate,
  });
}

export interface ManualRelationInput {
  from: string;
  to: string;
  rationale: string;
}

/**
 * An accepted manual relation through `POST …/relations` (kind `manual`,
 * humans only): „Verknüpfen mit …“ on a collapsed subprocess in the model
 * view, from its process to the picked one, without a question.
 */
export function useManualRelation(project: string) {
  const invalidate = useInvalidateProject(project);
  return useMutation({
    mutationFn: ({ from, to, rationale }: ManualRelationInput): Promise<ProposeRelationResult> =>
      unwrap(
        proposeRelation({
          client: api,
          path: { project },
          body: { type: 'manual', from, to, confidence: 1, rationale },
        }),
      ),
    onSettled: invalidate,
  });
}

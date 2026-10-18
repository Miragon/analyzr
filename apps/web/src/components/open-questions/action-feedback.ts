import {
  decidePlacement,
  decideRelations,
  withdrawOpenQuestionAnswer,
  type OpenQuestion,
  type OpenQuestionAction,
  type OpenQuestionActionResult,
} from '@analyzr/client';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';

import { api, errorMessage, unwrap } from '@/lib/api';
import { VALUE_CHAIN_KEY } from '@/lib/limits';
import {
  UNDO_REASON,
  actionToast,
  decidedPlacements,
  decidedRelations,
  storedNoteWarning,
  undoPlan,
  undoable,
  type UndoPlan,
} from '@/lib/open-question-pickers';
import { keys } from '@/lib/queries';
import type { RefResolver } from '@/lib/refs';
import { toast } from '@/lib/toast';

/**
 * What the reviewer hears after an action on an open question (M6 §4.8 a):
 * a toast naming what it did, with „Rückgängig“ when it wrote manual
 * relations or placements (they are rejected through the decision routes,
 * the reason „Rückgängig gemacht“) or an outside mark (it is withdrawn), and
 * with the way to the decision when it decided existing proposals (no undo:
 * a reviewer changes it in the review, a placement on the value chain
 * page). The personal-data check's findings in the note come with the
 * toast. The undo runs outside the item's component, which has usually
 * left the list by then.
 */

/**
 * Rejects what an action wrote (`manual`), at the versions it left: the
 * relations in one bulk decision, all or nothing with their versions (a
 * pool's link or a dynamic call's targets wrote several in one
 * transaction), then the placement (`place` writes at most one).
 */
async function runUndo(project: string, plan: UndoPlan): Promise<void> {
  if (plan.relations.length > 0) {
    await unwrap(
      decideRelations({
        client: api,
        path: { project },
        body: {
          verdict: 'reject',
          reason: UNDO_REASON,
          expectedCount: plan.relations.length,
          items: plan.relations,
        },
      }),
    );
  }
  for (const p of plan.placements) {
    await unwrap(
      decidePlacement({
        client: api,
        path: { project, key: VALUE_CHAIN_KEY, placement: p.id },
        body: { verdict: 'reject', reason: UNDO_REASON, version: p.version },
      }),
    );
  }
}

const refresh = (queryClient: QueryClient, project: string) =>
  queryClient.invalidateQueries({ queryKey: keys.project(project) });

/** „Rückgängig“ for written relations and placements, with its own toast. */
export async function undoWrites(
  queryClient: QueryClient,
  project: string,
  plan: UndoPlan,
): Promise<void> {
  try {
    await runUndo(project, plan);
    toast({
      tone: 'success',
      title: 'Rückgängig gemacht',
      description:
        plan.placements.length > 0
          ? 'Die Platzierung ist abgelehnt; die Frage ist wieder offen.'
          : plan.relations.length === 1
            ? 'Die Relation ist abgelehnt; die Frage ist wieder offen.'
            : 'Die Relationen sind abgelehnt; die Frage ist wieder offen.',
    });
  } catch (error) {
    toast({
      tone: 'danger',
      title: 'Nicht rückgängig gemacht',
      description: errorMessage(error),
      error,
    });
  } finally {
    await refresh(queryClient, project);
  }
}

/** Withdraws an outside mark (its „Rückgängig“, or „Markierung zurücknehmen“), with its own toast. */
export async function withdrawMark(
  queryClient: QueryClient,
  project: string,
  questionId: string,
  answerId: string,
): Promise<void> {
  try {
    const result = await unwrap(
      withdrawOpenQuestionAnswer({
        client: api,
        path: { project, question: questionId, answer: answerId },
      }),
    );
    toast(
      result.result === 'withdrawn'
        ? {
            tone: 'success',
            title: 'Markierung zurückgenommen',
            description:
              result.question.state === 'open'
                ? 'Die Frage ist wieder offen.'
                : 'Eine andere Markierung gilt noch.',
          }
        : {
            tone: 'info',
            title: 'Schon zurückgenommen',
            description: 'Die Markierung war schon zurückgenommen; nichts geändert.',
          },
    );
  } catch (error) {
    toast({
      tone: 'danger',
      title: 'Markierung nicht zurückgenommen',
      description: errorMessage(error),
      error,
    });
  } finally {
    await refresh(queryClient, project);
  }
}

export function useActionFeedback(project: string, resolve: RefResolver) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMemo(
    () => ({
      /** The toast after an action that ran. */
      done(q: OpenQuestion, type: OpenQuestionAction['type'], result: OpenQuestionActionResult) {
        const told = actionToast(type, result, resolve);
        const warning = storedNoteWarning(result.warnings);
        const text =
          warning === null ? told : { ...told, description: `${told.description} ${warning}` };
        const plan = undoPlan(result);
        const decided = decidedRelations(result);
        const placed = decidedPlacements(result);
        if (type === 'outside' && result.result === 'applied' && result.answer) {
          const answerId = result.answer.id;
          toast({
            ...text,
            action: {
              label: 'Rückgängig',
              altText: 'Markierung „außerhalb der Landschaft“ zurücknehmen',
              onAction: () => void withdrawMark(queryClient, project, q.id, answerId),
            },
          });
        } else if (type !== 'choose-copy' && undoable(plan)) {
          toast({
            ...text,
            action: {
              label: 'Rückgängig',
              altText: 'Was die Aktion angelegt hat, wieder ablehnen',
              onAction: () => void undoWrites(queryClient, project, plan),
            },
          });
        } else if (decided.length === 1) {
          const relation = decided[0]!;
          toast({
            ...text,
            action: {
              label: 'Entscheidung ansehen',
              altText: 'Die Entscheidung im Prüfbildschirm ansehen und dort ändern',
              onAction: () =>
                void navigate({
                  to: '/projects/$project/review/$relation',
                  params: { project, relation },
                }),
            },
          });
        } else if (placed.length > 0) {
          const placement = placed[0]!;
          toast({
            ...text,
            action: {
              label: 'In der Kette ansehen',
              altText: 'Die Entscheidung in der Wertschöpfungskette ansehen und dort ändern',
              onAction: () =>
                void navigate({
                  to: '/projects/$project/value-chain',
                  params: { project },
                  search: { placement },
                }),
            },
          });
        } else if (decided.length > 1) {
          toast({
            ...text,
            action: {
              label: 'In „Relationen“ ansehen',
              altText: 'Die Entscheidungen unter „Relationen“ ansehen und dort ändern',
              onAction: () =>
                void navigate({ to: '/projects/$project/relations', params: { project } }),
            },
          });
        } else {
          toast(text);
        }
      },
      /** The item changed meanwhile (its id with it) or is done: the list reloads. */
      gone() {
        toast({
          tone: 'warning',
          title: 'Frage gibt es so nicht mehr',
          description:
            'Die Quelle der Frage hat sich inzwischen geändert (dann hat die Frage eine neue Kennung), oder die Frage ist erledigt. Die Liste ist neu geladen.',
        });
      },
    }),
    [queryClient, navigate, project, resolve],
  );
}

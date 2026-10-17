import { OPEN_QUESTION_ACTION_LABELS } from '@analyzr/contracts/open-question-labels';
import { useQuery } from '@tanstack/react-query';

import { AmendForm } from '@/components/amendments/amend-form';
import { WithdrawConfirm } from '@/components/amendments/withdraw-confirm';
import { withdrawnToast } from '@/lib/amendments';
import { modelsQuery } from '@/lib/queries';
import { toast } from '@/lib/toast';

import type { PanelProps } from './action-panels';

/**
 * The amendment actions of an open question (M6 §4.8 a, S5c-2): `amend`
 * opens the form for its targets (a call target's process picker lists the
 * processes the question's `link` suggests first, „Meine Ergänzung
 * behalten“ starts with the conflicting value); a withdrawal, of one
 * amendment or of every amendment of the model, says its cost first (the
 * withdrawal's dry run) and sends `If-Match` with the head it showed.
 */

export function AmendPanel({ q, action, project, resolve, onDone, onCancel }: PanelProps) {
  const models = useQuery(modelsQuery(project));
  const amend = action.amend;
  if (!amend) return null;
  const model = models.data?.find((m) => m.id === amend.modelId);
  const suggested = q.actions.find((a) => a.type === 'link')?.suggested ?? [];
  return (
    <AmendForm
      project={project}
      modelId={amend.modelId}
      modelKey={amend.modelKey}
      modelName={model?.name ?? null}
      targets={amend.targets}
      {...(amend.replaces ? { replaces: amend.replaces } : {})}
      suggested={suggested}
      questionId={q.id}
      resolve={resolve}
      onDone={onDone}
      onCancel={onCancel}
    />
  );
}

export function WithdrawAllPanel({ action, project, onDone, onCancel }: PanelProps) {
  const target = action.withdraw;
  if (!target) return null;
  return (
    <WithdrawConfirm
      project={project}
      target={{ modelId: target.modelId }}
      intro={`Nimmt jede Ergänzung von „${target.modelKey}“ zurück: Das Modell entspricht danach wieder der Datei aus dem Quellsystem, und die Fragen, die die Ergänzungen beantwortet haben, kommen zurück.`}
      confirmLabel="Alle zurücknehmen"
      onCancel={onCancel}
      onDone={(result) => {
        toast(
          result.result === 'unchanged'
            ? withdrawnToast(result)
            : {
                tone: 'success',
                title: 'Alle Ergänzungen zurückgenommen',
                description: result.revision
                  ? `„${target.modelKey}“ ist jetzt r${result.revision.rev}, wieder so, wie das Quellsystem es geliefert hat.`
                  : `Die Ergänzungen von „${target.modelKey}“ sind zurückgenommen.`,
              },
        );
        onDone();
      }}
    />
  );
}

/**
 * One amendment: „Wert aus dem Quellsystem übernehmen“ or „Ergänzung
 * zurücknehmen“, after its cost (the withdrawal's dry run).
 */
export function WithdrawOnePanel({ action, project, onDone, onCancel }: PanelProps) {
  const amendment = action.withdraw?.amendment;
  if (!amendment) return null;
  const takes = action.label === OPEN_QUESTION_ACTION_LABELS.takeSourceValue;
  return (
    <WithdrawConfirm
      project={project}
      target={{ amendment }}
      {...(takes
        ? { intro: 'Der Wert aus dem Quellsystem gilt; analyzr nimmt seine Ergänzung zurück.' }
        : {})}
      confirmLabel={action.label}
      onCancel={onCancel}
      onDone={(result) => {
        toast(
          withdrawnToast(
            result,
            takes ? 'Wert aus dem Quellsystem übernommen' : 'Ergänzung zurückgenommen',
          ),
        );
        onDone();
      }}
    />
  );
}

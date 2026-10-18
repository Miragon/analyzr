import type { AmendModelItemResult } from '@analyzr/client';
import { Link } from '@tanstack/react-router';
import { InfoIcon, TriangleAlertIcon } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import {
  CLAIMED_WARNING,
  effectSentence,
  fieldLabel,
  itemWarning,
  refusalLabel,
  type AmendCheck,
  type PendingAmendment,
} from '@/lib/amendments';

/**
 * The inline dry run above „Speichern“ (M6 §4.8 c "Web", UX4,
 * UX-SIMPLIFICATION.md §3.4 item 4): while the values settle „Wirkung wird
 * geprüft …“; then the sentence naming the effect and the cost („Danach: 1
 * Aufruf angenommen. Die Agenten beurteilen 15 mögliche Relationen neu, …“),
 * the personal-data check's findings per value, the warning when an agent
 * holds the model's task (its save asks a second time), or why it would not
 * go through (not applicable, changed meanwhile, refused).
 */

/** The pending amendment a result item belongs to (by element and op). */
function pendingOf(
  item: Pick<AmendModelItemResult, 'elementId' | 'op'>,
  pending: readonly PendingAmendment[],
): PendingAmendment | undefined {
  return pending.find((p) => p.item.elementId === item.elementId && p.item.op === item.op);
}

/** The label a result item belongs to: the pending amendment with its element and op. */
function labelOf(
  item: Pick<AmendModelItemResult, 'elementId' | 'op'>,
  pending: readonly PendingAmendment[],
): string {
  return pendingOf(item, pending)?.label ?? item.elementId;
}

/** The field's German name: the pending amendment's („Nachrichtenname“), else by its op. */
function fieldOf(
  item: Pick<AmendModelItemResult, 'elementId' | 'op'>,
  pending: readonly PendingAmendment[],
): string {
  return pendingOf(item, pending)?.field ?? fieldLabel(item.op);
}

export function AmendEffect({
  project,
  check,
  pending,
  effectId,
  claimedId,
}: {
  project: string;
  check: AmendCheck;
  pending: readonly PendingAmendment[];
  /** The effect sentence's id, which „Speichern“ is described by. */
  effectId: string;
  /** The claimed warning's id. */
  claimedId: string;
}) {
  if (check.phase === 'idle') return null;
  if (check.phase === 'checking')
    return (
      <p
        role="status"
        className="flex items-center gap-2 text-sm text-muted-foreground"
        data-testid="amend-checking"
      >
        <Spinner className="size-4" />
        Wirkung wird geprüft …
      </p>
    );
  if (check.phase === 'unchanged')
    return (
      <p
        role="status"
        className="flex items-start gap-2 text-sm text-muted-foreground"
        data-testid="amend-unchanged"
      >
        <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        Steht schon so im Modell; nichts zu speichern.
      </p>
    );
  if (check.phase !== 'ready') return <AmendSaveProblem check={check} pending={pending} />;
  const { dry } = check;
  const warnings = dry.items.flatMap((item) => {
    const warning = itemWarning(item);
    return warning ? [{ item, warning }] : [];
  });
  return (
    <div className="flex flex-col gap-2" role="status" data-testid="amend-check">
      {warnings.map(({ item, warning }) => (
        <p
          key={`${item.op}:${item.elementId}`}
          className="flex items-start gap-1.5 text-sm text-warning"
          data-testid="amend-warning"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {pending.length > 1 ? `${labelOf(item, pending)} · ${fieldOf(item, pending)}: ` : ''}
            {warning}
          </span>
        </p>
      ))}
      <p className="flex items-start gap-2 text-sm" id={effectId} data-testid="amend-effect">
        <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span>
          {effectSentence(dry)}
          {dry.effect.proposed.length > 0 ? (
            <>
              {' '}
              Neue Vorschläge entscheidest du unter{' '}
              <Link
                to="/projects/$project/review"
                params={{ project }}
                className="text-link underline"
              >
                „Relationen“
              </Link>
              .
            </>
          ) : null}
        </span>
      </p>
      {dry.cost.taskClaimed ? (
        <Alert variant="destructive" id={claimedId} data-testid="amend-claimed">
          <TriangleAlertIcon />
          <AlertTitle>{CLAIMED_WARNING}</AlertTitle>
          <AlertDescription>
            Die neue Revision bricht seine Analyse ab; sie wird danach neu eingeplant.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

/** Why the dry run or the save refused, changed meanwhile, or failed. */
export function AmendSaveProblem({
  check,
  pending,
}: {
  check: Extract<AmendCheck, { phase: 'refused' | 'conflict' | 'error' }>;
  pending: readonly PendingAmendment[];
}) {
  if (check.phase === 'refused') {
    const refused = check.items.filter((i) => i.outcome === 'not-applicable');
    return (
      <Alert variant="destructive" data-testid="amend-refused">
        <AlertTitle>
          {refused.length === 1
            ? 'Diese Ergänzung geht so nicht'
            : `${refused.length} Ergänzungen gehen so nicht`}
        </AlertTitle>
        <AlertDescription>
          <ul className="flex flex-col gap-1">
            {refused.map((item) => (
              <li key={`${item.op}:${item.elementId}`} data-reason={item.reason}>
                {labelOf(item, pending)} · {fieldOf(item, pending)}: {refusalLabel(item.reason)}.
              </li>
            ))}
          </ul>
          <span>Nichts gespeichert.</span>
        </AlertDescription>
      </Alert>
    );
  }
  if (check.phase === 'conflict') {
    return (
      <Alert variant="destructive" data-testid="amend-conflict">
        <AlertTitle>Das Modell hat sich inzwischen geändert</AlertTitle>
        <AlertDescription>
          {check.headRev !== null ? `Es ist jetzt r${check.headRev}. ` : ''}
          Die Werte werden neu geladen; prüf sie, bevor du speicherst. Nichts gespeichert.
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert variant="destructive" data-testid="amend-error">
      <AlertTitle>Nicht gespeichert</AlertTitle>
      <AlertDescription>{check.message}</AlertDescription>
    </Alert>
  );
}

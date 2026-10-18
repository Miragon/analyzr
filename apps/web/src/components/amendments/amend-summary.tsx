import type { AmendModelItemResult } from '@analyzr/client';
import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import { ArrowRightIcon, InfoIcon, SaveIcon, TriangleAlertIcon } from 'lucide-react';
import { useId, type KeyboardEvent } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  CLAIMED_WARNING,
  effectSentence,
  fieldLabel,
  itemWarning,
  refusalLabel,
  valueText,
  type AmendSaveState,
  type PendingAmendment,
} from '@/lib/amendments';

/**
 * The dry run's summary before a save (M6 §4.8 c "Web"): each amendment
 * with the value as it will be stored (before → after), the personal-data
 * check's findings, the sentence naming the effect and the cost („Danach: …
 * 214 Paare werden neu beurteilt.“), the warning when an agent holds the
 * model's task, and the confirmation (described by the effect sentence and
 * the warning; Escape goes back); and the states a save can end in (not
 * applicable, changed meanwhile, refused). A call target shows the process
 * the human picked by its name. Shared by the amend form and the
 * collection's bar.
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

export function AmendSummary({
  project,
  state,
  pending,
  onConfirm,
  onBack,
  compact = false,
}: {
  project: string;
  state: Extract<AmendSaveState, { phase: 'confirm' | 'saving' }>;
  pending: readonly PendingAmendment[];
  onConfirm: () => void;
  onBack: () => void;
  /** In the collection's bar: the list scrolls, so „Zurück“ and „Jetzt speichern“ stay in view. */
  compact?: boolean;
}) {
  const { dry } = state;
  const saving = state.phase === 'saving';
  const claimed = dry.cost.taskClaimed;
  const effectId = useId();
  const claimedId = useId();
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && !saving) {
      event.preventDefault();
      event.stopPropagation();
      onBack();
    }
  }
  return (
    <div className="flex flex-col gap-3" onKeyDown={keyDown} data-testid="amend-summary">
      <ul
        className={cn('flex flex-col gap-2 text-sm', compact && 'max-h-[40vh] overflow-y-auto')}
        aria-label="Was gespeichert wird"
      >
        {dry.items.map((item) => {
          const warning = itemWarning(item);
          // A call target as the human picked it: the process by its name, its id small.
          const picked = item.op === 'call-target' ? pendingOf(item, pending)?.display : undefined;
          return (
            <li
              key={`${item.op}:${item.elementId}`}
              className="flex flex-col gap-0.5"
              data-testid="amend-summary-item"
              data-outcome={item.outcome}
            >
              <span className="font-medium">
                {labelOf(item, pending)}{' '}
                <span className="font-normal text-muted-foreground">
                  · {fieldOf(item, pending)}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5 break-words">
                <span className="text-muted-foreground">{valueText(item.before)}</span>
                <ArrowRightIcon className="size-3.5 shrink-0" aria-label="wird zu" />
                <span data-testid="amend-summary-after">
                  {picked && item.after && picked !== item.after ? (
                    <>
                      Prozess „{picked}“{' '}
                      <span className="font-mono text-xs text-muted-foreground">{item.after}</span>
                    </>
                  ) : (
                    valueText(item.after)
                  )}
                </span>
                {item.outcome === 'unchanged' ? (
                  <span className="text-xs text-muted-foreground">(schon so ergänzt)</span>
                ) : null}
              </span>
              {warning ? (
                <span className="flex items-start gap-1.5 text-warning">
                  <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {warning}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
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
      {claimed ? (
        <Alert variant="destructive" id={claimedId} data-testid="amend-claimed">
          <TriangleAlertIcon />
          <AlertTitle>{CLAIMED_WARNING}</AlertTitle>
          <AlertDescription>
            Die neue Revision bricht seine Analyse ab; sie wird danach neu eingeplant.
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onBack} disabled={saving}>
          Zurück
        </Button>
        <Button
          type="button"
          size="sm"
          variant={claimed ? 'destructive' : 'default'}
          onClick={onConfirm}
          disabled={saving}
          autoFocus
          aria-describedby={claimed ? `${effectId} ${claimedId}` : effectId}
          data-testid="amend-confirm"
        >
          {saving ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
          {claimed ? 'Trotzdem speichern' : 'Jetzt speichern'}
        </Button>
      </div>
    </div>
  );
}

/** Why the dry run or the save refused, changed meanwhile, or failed; `null` otherwise. */
export function AmendSaveProblem({
  state,
  pending,
  conflictText = 'Die Werte sind neu geladen; prüf sie und speichere noch einmal.',
}: {
  state: AmendSaveState;
  pending: readonly PendingAmendment[];
  /** What to do after a 412 (the form reloads its fields; the bar checks again). */
  conflictText?: string;
}) {
  if (state.phase === 'refused') {
    const refused = state.items.filter((i) => i.outcome === 'not-applicable');
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
  if (state.phase === 'conflict') {
    return (
      <Alert variant="destructive" data-testid="amend-conflict">
        <AlertTitle>Das Modell hat sich inzwischen geändert</AlertTitle>
        <AlertDescription>
          {state.headRev !== null ? `Es ist jetzt r${state.headRev}. ` : ''}
          {conflictText} Nichts gespeichert.
        </AlertDescription>
      </Alert>
    );
  }
  if (state.phase === 'error') {
    return (
      <Alert variant="destructive" data-testid="amend-error">
        <AlertTitle>Nicht gespeichert</AlertTitle>
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }
  return null;
}

import type { WithdrawAmendmentsResult } from '@analyzr/client';
import { useQuery } from '@tanstack/react-query';
import { TriangleAlertIcon, Undo2Icon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import {
  CLAIMED_WARNING,
  conflictHeadRev,
  postWithdrawal,
  useWithdraw,
  withdrawEffectSentence,
  type WithdrawTarget,
} from '@/lib/amendments';
import { errorMessage } from '@/lib/api';

/**
 * The confirmation before a withdrawal (M6 §4.8 c): a withdrawal writes a new
 * head like a save, so it says the same before it runs, from the
 * withdrawal's dry run: the new revision without the amendment, the pairs
 * the agents judge again and the warning when an agent holds the model's
 * relations task. The confirmation sends `If-Match` with the head the dry
 * run read, so an amendment recorded meanwhile is never withdrawn unseen; a
 * 412 offers to check again. Escape or „Abbrechen“ closes it.
 */
export function WithdrawConfirm({
  project,
  target,
  intro,
  confirmLabel,
  onDone,
  onCancel,
}: {
  project: string;
  target: WithdrawTarget;
  /** What the withdrawal does, in German, before the effect sentence. */
  intro?: string;
  /** The confirming button's label („Zurücknehmen“, „Wert aus dem Quellsystem übernehmen“). */
  confirmLabel: string;
  onDone: (result: WithdrawAmendmentsResult) => void;
  onCancel: () => void;
}) {
  const effectId = useId();
  const claimedId = useId();
  const targetKey = 'amendment' in target ? target.amendment : target.modelId;
  const dry = useQuery({
    // Not under the project's key: the withdrawal refreshes the project, not its own check.
    queryKey: ['withdraw-dry-run', project, targetKey] as const,
    queryFn: () => postWithdrawal(project, target, { dryRun: true }),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const withdraw = useWithdraw(project);
  const [stale, setStale] = useState<number | null | undefined>(undefined);
  const busy = withdraw.isPending;
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // The panel takes the focus at once (Escape works while the dry run loads), the
  // confirming button once the effect is known.
  useEffect(() => {
    panel.current?.focus();
  }, []);
  const ready = dry.data !== undefined;
  useEffect(() => {
    if (ready) button.current?.focus();
  }, [ready]);

  async function confirm() {
    if (!dry.data) return;
    const rev = dry.data.model?.headRev;
    try {
      const result = await withdraw.mutateAsync({
        target,
        ...(rev === undefined ? {} : { rev }),
      });
      onDone(result);
    } catch (error) {
      const head = conflictHeadRev(error);
      if (head !== undefined) {
        setStale(head);
        void dry.refetch();
      } else {
        setStale(undefined);
      }
    }
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  }

  const live = dry.data?.amendments.filter((a) => a.withdrawal === null).length ?? 0;
  const claimed = dry.data?.cost?.taskClaimed === true;
  return (
    <div
      ref={panel}
      tabIndex={-1}
      className="flex flex-col gap-3 outline-none"
      onKeyDown={keyDown}
      data-testid="withdraw-confirm"
    >
      {dry.isPending ? (
        <Skeleton className="h-10" />
      ) : dry.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Nicht geprüft</AlertTitle>
          <AlertDescription>{errorMessage(dry.error)}</AlertDescription>
        </Alert>
      ) : (
        <>
          <p className="text-sm" id={effectId} data-testid="withdraw-effect">
            {intro ? `${intro} ` : ''}
            {dry.data.result === 'unchanged'
              ? 'Die Ergänzung gilt schon nicht mehr; es ändert sich nichts.'
              : withdrawEffectSentence(dry.data, live)}
          </p>
          {claimed ? (
            <Alert variant="destructive" id={claimedId} data-testid="withdraw-claimed">
              <TriangleAlertIcon />
              <AlertTitle>{CLAIMED_WARNING}</AlertTitle>
              <AlertDescription>
                Die neue Revision bricht seine Analyse ab; sie wird danach neu eingeplant.
              </AlertDescription>
            </Alert>
          ) : null}
        </>
      )}
      {stale !== undefined ? (
        <Alert variant="destructive" data-testid="withdraw-stale">
          <AlertTitle>Das Modell hat sich inzwischen geändert</AlertTitle>
          <AlertDescription>
            {stale !== null ? `Es ist jetzt r${stale}. ` : ''}
            Prüf die Ergänzungen oben noch einmal; nichts zurückgenommen.
          </AlertDescription>
        </Alert>
      ) : withdraw.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Nicht zurückgenommen</AlertTitle>
          <AlertDescription>{errorMessage(withdraw.error)}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
          Abbrechen
        </Button>
        <Button
          variant={claimed ? 'destructive' : 'default'}
          size="sm"
          onClick={() => void confirm()}
          disabled={busy || !dry.data || dry.data.result === 'unchanged' || dry.isFetching}
          ref={button}
          aria-describedby={claimed ? `${effectId} ${claimedId}` : effectId}
          data-testid="withdraw-confirm-button"
        >
          {busy ? <Spinner data-icon="inline-start" /> : <Undo2Icon data-icon="inline-start" />}
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}

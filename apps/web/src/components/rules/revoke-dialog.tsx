import type { AutoAcceptRevocationBody, AutoAcceptRevocationResult } from '@analyzr/client';
import { useQuery } from '@tanstack/react-query';
import { Undo2Icon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { ErrorText } from '@/components/error-text';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { revocationSummary } from '@/lib/auto-accept';
import { useRevokeAutoAccepted } from '@/lib/auto-accept-actions';
import { useSubjectNames } from '@/lib/auto-accept-names';
import { formatConfidence, handleName } from '@/lib/labels';
import { MAX_AUTO_ACCEPT_REASON_CHARS } from '@/lib/limits';
import { autoAcceptRevokeDryRunQuery } from '@/lib/queries';
import { toast } from '@/lib/toast';

import { SubjectText } from './subject';

export type RevocationSelection = Omit<AutoAcceptRevocationBody, 'expectedCount' | 'reason'>;

export interface RevokeDialogProps {
  project: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What to revoke: a rule (and revision), an agent, a kind, ids. */
  selection: RevocationSelection;
  /** Dialog title, e.g. „Annahmen der Regel „…“ widerrufen“. */
  title: string;
  /** Above the dry run: what narrows the selection (the agent of „Nach Agent widerrufen…“). */
  picker?: ReactNode;
  onDone?: (result: AutoAcceptRevocationResult) => void;
  /**
   * The control that opened the dialog (or stands for it): the focus goes back there when it
   * closes (opened from a menu that closed as it opened, Radix has nothing to return to).
   */
  returnFocus?: () => HTMLElement | null | undefined;
}

function RevokeBody({
  project,
  onOpenChange,
  selection,
  title,
  picker,
  onDone,
}: Omit<RevokeDialogProps, 'open' | 'returnFocus'>) {
  const id = useId();
  const dry = useQuery(autoAcceptRevokeDryRunQuery(project, selection));
  const real = useRevokeAutoAccepted(project);
  const [reason, setReason] = useState('');
  const [changed, setChanged] = useState(false);
  const result = dry.data;
  const names = useSubjectNames(project, result?.items ?? []);
  // one rule's acceptances need no rule name per entry; an agent's or a list of ids may span rules
  const byRule = selection.ruleId !== undefined;

  function confirm() {
    if (!result || result.count === 0) return;
    const text = reason.trim();
    real.mutate(
      {
        body: { ...selection, expectedCount: result.count, ...(text ? { reason: text } : {}) },
        dryRun: false,
      },
      {
        onSuccess: (done) => {
          toast({
            tone: 'success',
            title:
              done.count === 1
                ? 'Automatische Annahme widerrufen'
                : `${done.count} automatische Annahmen widerrufen`,
            description: revocationSummary({ ...done, alreadyRevoked: 0 }),
          });
          onDone?.(done);
          onOpenChange(false);
        },
        onError: (error) => {
          // The selection changed since the dry run: nothing was revoked; show the fresh one.
          if (error instanceof ApiError && error.status === 409) {
            setChanged(true);
            void dry.refetch();
          }
        },
      },
    );
  }

  const failed = real.error && !(real.error instanceof ApiError && real.error.status === 409);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          Ist noch ein Agentenvorschlag offen, steht das Element wieder in der Prüfung; sonst wird
          es veraltet und die Agenten beurteilen es neu. Was ein Mensch seither entschieden hat,
          bleibt, wie es ist.
        </DialogDescription>
      </DialogHeader>
      {picker}
      {changed ? (
        <Alert>
          <AlertTitle>Die Auswahl hat sich geändert</AlertTitle>
          <AlertDescription>
            Es wurde nichts widerrufen. Die Vorschau ist neu geladen; prüfe sie und bestätige noch
            einmal.
          </AlertDescription>
        </Alert>
      ) : null}
      {dry.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Vorschau fehlgeschlagen</AlertTitle>
          <AlertDescription>
            <ErrorText error={dry.error} />
          </AlertDescription>
        </Alert>
      ) : !result ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          <p data-testid="revoke-summary">{revocationSummary(result)}</p>
          {result.items.length > 0 ? (
            // the whole list, scrolling (UX-SIMPLIFICATION.md §3.11 item 7)
            <ul
              aria-label="Automatische Annahmen"
              className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-lg border p-2"
            >
              {result.items.map((i) => (
                <li key={i.decisionId} className="flex min-w-0 flex-col" data-testid="revoke-item">
                  <SubjectText
                    subject={i}
                    names={names}
                    details={[
                      ...(byRule ? [] : [`Regel „${i.ruleName}“`]),
                      handleName(i.agent.handle),
                      ...(i.confidence === null ? [] : [formatConfidence(i.confidence)]),
                      i.outcome === 'obsolete' ? 'wird veraltet' : 'zurück in die Prüfung',
                    ]}
                  />
                </li>
              ))}
              {result.truncated ? (
                <li className="text-xs text-muted-foreground">
                  … und {result.count - result.items.length} weitere
                </li>
              ) : null}
            </ul>
          ) : null}
          {result.count > 0 ? (
            <Field>
              <FieldLabel htmlFor={`${id}-reason`}>Grund (optional)</FieldLabel>
              <Textarea
                id={`${id}-reason`}
                value={reason}
                maxLength={MAX_AUTO_ACCEPT_REASON_CHARS}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Warum widerrufst du?"
                className="min-h-12"
              />
              <FieldDescription>Steht im Verlauf der widerrufenen Vorschläge.</FieldDescription>
            </Field>
          ) : null}
        </div>
      )}
      {failed ? (
        <Alert variant="destructive">
          <AlertTitle>Widerruf fehlgeschlagen</AlertTitle>
          <AlertDescription>
            <ErrorText error={real.error} />
          </AlertDescription>
        </Alert>
      ) : null}
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Abbrechen
        </Button>
        <Button
          variant="destructive"
          disabled={!result || result.count === 0 || real.isPending || dry.isFetching}
          onClick={confirm}
          data-testid="revoke-confirm"
        >
          <Undo2Icon data-icon="inline-start" />
          {result ? `${result.count} widerrufen` : 'Widerrufen'}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Revokes auto-acceptances (owner decision 19): the dry run when the dialog
 * opens, listing every acceptance by name with its agent, confidence and
 * what becomes of it (UX9), then „N widerrufen“ with the dry run's count;
 * when the selection changed in between (409) the dialog shows the fresh dry
 * run. A human decision taken since an acceptance is never touched.
 */
export function RevokeDialog({ open, onOpenChange, returnFocus, ...props }: RevokeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-xl"
        data-testid="revoke-dialog"
        onCloseAutoFocus={(event) => {
          // Radix returns the focus only to a DialogTrigger; this dialog has none.
          const target = returnFocus?.();
          if (!target) return;
          event.preventDefault();
          target.focus();
        }}
      >
        {open ? <RevokeBody onOpenChange={onOpenChange} {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

import type { ApplyAutoAcceptResult, AutoAcceptRule } from '@analyzr/client';
import { useQuery } from '@tanstack/react-query';
import { CheckCheckIcon } from 'lucide-react';
import { useState } from 'react';

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
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { proposerName } from '@/lib/auto-accept';
import { useNameFlags } from '@/lib/auto-accept-flags';
import { useSubjectNames } from '@/lib/auto-accept-names';
import { AUTO_ACCEPT_BLOCK_LABELS, nameFlagsText } from '@/lib/auto-accept-rules';
import { useApplyRule } from '@/lib/auto-accept-rule-actions';
import { autoAcceptApplyDryRunQuery } from '@/lib/auto-accept-queries';
import { formatConfidence } from '@/lib/labels';
import { toast } from '@/lib/toast';

import { SubjectText } from './subject';

/** The blocked-reason histogram as a list (preview, dry runs). */
export function BlockedList({ blocked }: { blocked: ApplyAutoAcceptResult['blocked'] }) {
  if (blocked.length === 0) return null;
  return (
    <div className="flex flex-col gap-1" data-testid="blocked-reasons">
      <p className="text-xs font-medium text-muted-foreground">
        Erfüllen die Regel, aber eine Schutzregel hält sie zurück:
      </p>
      <ul className="flex flex-col gap-0.5 text-xs">
        {blocked.map((b) => (
          <li key={b.reason} className="flex justify-between gap-3">
            <span>{AUTO_ACCEPT_BLOCK_LABELS[b.reason]}</span>
            <span className="tabular-nums">{b.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface ApplyDialogProps {
  project: string;
  rule: AutoAcceptRule;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The control that opened the dialog (or stands for it): the focus goes back there when it
   * closes (opened from a menu that closed as it opened, Radix has nothing to return to).
   */
  returnFocus?: () => HTMLElement | null | undefined;
}

const proposals = (n: number) => (n === 1 ? '1 Vorschlag' : `${n} Vorschläge`);

function ApplyBody({
  project,
  rule,
  onOpenChange,
}: Omit<ApplyDialogProps, 'open' | 'returnFocus'>) {
  const dry = useQuery(autoAcceptApplyDryRunQuery(project, rule.id, rule.revision));
  const real = useApplyRule(project);
  const [changed, setChanged] = useState(false);
  // Only a dry run of this opening: the row's hint may have cached an older one.
  const result = dry.isFetchedAfterMount ? dry.data : undefined;
  const names = useSubjectNames(project, result?.items ?? []);
  const flags = useNameFlags(project);
  const flagged = result && flags ? flags(result.items) : 0;
  // The dry run's view of the head wins over the (possibly older) table row.
  const enabled = result?.enabled ?? rule.enabled;
  const authorIsOwner = result?.authorIsOwner ?? rule.authorIsOwner;
  const blockedByRule = !enabled
    ? 'Die Regel ist aus. Aktiviere sie, um offene Vorschläge anzunehmen.'
    : !authorIsOwner
      ? 'Der Urheber der Regel ist kein Inhaber mehr. Speichere die Regel neu (Bearbeiten, Speichern), um sie zu übernehmen.'
      : null;

  function confirm() {
    if (!result || result.count === 0 || blockedByRule) return;
    real.mutate(
      { ruleId: rule.id, dryRun: false, revision: result.revision, expectedCount: result.count },
      {
        onSuccess: (done) => {
          toast({
            tone: 'success',
            title: `${proposals(done.count)} automatisch angenommen`,
            description: `Regel „${rule.name}“. Du kannst die Annahmen jederzeit widerrufen.`,
          });
          onOpenChange(false);
        },
        onError: (error) => {
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
        <DialogTitle>Regel „{rule.name}“ auf offene Vorschläge anwenden</DialogTitle>
        <DialogDescription>
          Jede Annahme wird als deine Entscheidung durch diese Regel vermerkt.
        </DialogDescription>
      </DialogHeader>
      {changed ? (
        <Alert>
          <AlertTitle>Die offenen Vorschläge haben sich geändert</AlertTitle>
          <AlertDescription>
            Es wurde nichts angenommen. Die Vorschau ist neu geladen; prüfe sie und bestätige noch
            einmal.
          </AlertDescription>
        </Alert>
      ) : null}
      {blockedByRule ? (
        <Alert>
          <AlertDescription>{blockedByRule}</AlertDescription>
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
          <div className="flex flex-col gap-0.5">
            <p data-testid="apply-summary">
              {result.count === 0
                ? 'Kein offener Vorschlag erfüllt die Regel.'
                : result.count === 1
                  ? '1 offener Vorschlag erfüllt die Regel.'
                  : `${result.count} offene Vorschläge erfüllen die Regel.`}
            </p>
            {flagged > 0 ? (
              <p className="text-xs text-muted-foreground" data-testid="apply-flags">
                {nameFlagsText(flagged, result.truncated)}
              </p>
            ) : null}
          </div>
          {result.items.length > 0 ? (
            // the whole list, scrolling (UX-SIMPLIFICATION.md §3.11 item 7)
            <ul
              aria-label="Offene Vorschläge, die die Regel erfüllt"
              className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-lg border p-2"
            >
              {result.items.map((i) => (
                <li key={i.triggerId} className="flex min-w-0 flex-col" data-testid="apply-item">
                  <SubjectText
                    subject={i}
                    names={names}
                    details={[proposerName(i), formatConfidence(i.confidence)]}
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
          <BlockedList blocked={result.blocked} />
        </div>
      )}
      {failed ? (
        <Alert variant="destructive">
          <AlertTitle>Anwenden fehlgeschlagen</AlertTitle>
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
          disabled={
            !result ||
            result.count === 0 ||
            blockedByRule !== null ||
            real.isPending ||
            dry.isFetching
          }
          onClick={confirm}
          data-testid="apply-confirm"
        >
          <CheckCheckIcon data-icon="inline-start" />
          {`${proposals(result?.count ?? 0)} annehmen`}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Applies a rule to the open proposals (rules are never retroactive
 * otherwise): the dry run when the dialog opens, listing every proposal by
 * name with its agent and confidence (UX9) and how many carry a bulk accept
 * name flag (Q8: shown, never blocking), then „N Vorschläge annehmen“ with
 * the head revision and the dry run's count; a 409 (the open proposals or
 * the rule changed) shows the fresh dry run. Opened without a Radix trigger,
 * so `returnFocus` names where the focus goes when it closes.
 */
export function ApplyDialog({ open, onOpenChange, returnFocus, ...props }: ApplyDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-xl"
        data-testid="apply-dialog"
        onCloseAutoFocus={(event) => {
          // Radix returns the focus only to a DialogTrigger; this dialog has none.
          const target = returnFocus?.();
          if (!target) return;
          event.preventDefault();
          target.focus();
        }}
      >
        {open ? <ApplyBody onOpenChange={onOpenChange} {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

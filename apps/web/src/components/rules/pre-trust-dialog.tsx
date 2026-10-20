import {
  listPreTrustCalls,
  reviewPreTrustCalls,
  type PreTrustList,
  type PreTrustReviewBody,
  type PreTrustReviewResult,
} from '@analyzr/client';
import { queryOptions, useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Undo2Icon } from 'lucide-react';
import { useId, useState } from 'react';

import { ErrorText } from '@/components/error-text';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, api, unwrap } from '@/lib/api';
import { useInvalidateProject } from '@/lib/auto-accept-actions';
import {
  PRE_TRUST_KEEP_NOTE,
  preTrustDoneToast,
  preTrustDryRunText,
  preTrustModelDetail,
} from '@/lib/pre-trust';
import { keys } from '@/lib/queries';
import { toast } from '@/lib/toast';

/** The list „Vor der Vertrauensregel angenommen“ (under the project's auto-accept keys). */
const preTrustQuery = (project: string) =>
  queryOptions({
    queryKey: [...keys.autoAcceptRules(project), 'pre-trust'] as const,
    queryFn: (): Promise<PreTrustList> =>
      unwrap(listPreTrustCalls({ client: api, path: { project } })),
    staleTime: 0,
  });

/**
 * The dry run of „Zurück in die Prüfung“ for the selected revisions (never
 * cached); `onError` hears its failure first (a 409 reloads the list).
 */
const reviewDryRunQuery = (
  project: string,
  revisionIds: readonly string[],
  onError: (error: unknown) => void,
) =>
  queryOptions({
    queryKey: [...keys.autoAcceptRules(project), 'pre-trust-dry-run', revisionIds] as const,
    queryFn: async (): Promise<PreTrustReviewResult> => {
      try {
        return await unwrap(
          reviewPreTrustCalls({
            client: api,
            path: { project },
            query: { dryRun: 'true' },
            body: {
              verdict: 'derived',
              revisionIds: revisionIds as PreTrustReviewBody['revisionIds'],
            },
          }),
        );
      } catch (error) {
        onError(error);
        throw error;
      }
    },
    staleTime: 0,
    gcTime: 0,
  });

export interface PreTrustDialogProps {
  project: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The control that opened the dialog: the focus goes back there when it closes. */
  returnFocus?: () => HTMLElement | null | undefined;
}

function PreTrustBody({ project, onOpenChange }: Omit<PreTrustDialogProps, 'open'>) {
  const id = useId();
  const navigate = useNavigate();
  const invalidate = useInvalidateProject(project);
  const list = useQuery(preTrustQuery(project));
  // Every listed model starts selected; the owner unticks what to leave for later.
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const [changed, setChanged] = useState(false);
  const models = list.data?.models ?? [];
  const selected = models.filter((m) => !unticked.has(m.revisionId));
  const revisionIds = selected.map((m) => m.revisionId);
  const count = selected.reduce((n, m) => n + m.count, 0);
  // Reviewed or uploaded again meanwhile (409, the dry run's or the review's): nothing was
  // written; show the fresh list.
  const reloadOnConflict = (error: unknown) => {
    if (!(error instanceof ApiError && error.status === 409)) return;
    setChanged(true);
    setUnticked(new Set());
    void list.refetch();
  };
  const dry = useQuery({
    ...reviewDryRunQuery(project, revisionIds, reloadOnConflict),
    enabled: revisionIds.length > 0,
  });
  const real = useMutation({
    mutationFn: (verdict: PreTrustReviewBody['verdict']): Promise<PreTrustReviewResult> =>
      unwrap(
        reviewPreTrustCalls({
          client: api,
          path: { project },
          body: { verdict, revisionIds, expectedCount: count },
        }),
      ),
    onSettled: () => invalidate(),
  });

  function decide(verdict: PreTrustReviewBody['verdict']) {
    if (revisionIds.length === 0) return;
    real.mutate(verdict, {
      onSuccess: (done) => {
        const { title, description, open } = preTrustDoneToast(done);
        toast({
          tone: 'success',
          title,
          description,
          ...(open > 0
            ? {
                action: {
                  label: 'Gesammelt annehmen',
                  altText: 'Die eindeutigen Aufrufe aus abgeleiteten Modellen gesammelt annehmen',
                  onAction: () =>
                    void navigate({
                      to: '/projects/$project/review',
                      params: { project },
                      search: { bulk: 'calls' },
                    }),
                },
              }
            : {}),
        });
        onOpenChange(false);
      },
      onError: reloadOnConflict,
    });
  }

  const toggle = (revisionId: string, on: boolean) =>
    setUnticked((current) => {
      const next = new Set(current);
      if (on) next.delete(revisionId);
      else next.add(revisionId);
      return next;
    });
  const failed = real.error && !(real.error instanceof ApiError && real.error.status === 409);
  const busy = real.isPending || list.isFetching;
  return (
    <>
      <DialogHeader>
        <DialogTitle>Vor der Vertrauensregel angenommen</DialogTitle>
        <DialogDescription>
          In diesen Modellen hat analyzr eindeutige Aufrufe angenommen, bevor es die Vertrauensregel
          gab. Heute würde es sie nur vorschlagen, weil das aufrufende Modell als abgeleitet gilt.
        </DialogDescription>
      </DialogHeader>
      {changed ? (
        <Alert>
          <AlertTitle>Die Liste hat sich geändert</AlertTitle>
          <AlertDescription>
            Es wurde nichts geändert. Die Liste ist neu geladen; prüfe sie und entscheide noch
            einmal.
          </AlertDescription>
        </Alert>
      ) : null}
      {list.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Liste konnte nicht geladen werden</AlertTitle>
          <AlertDescription>
            <ErrorText error={list.error} />
          </AlertDescription>
        </Alert>
      ) : !list.data ? (
        <Skeleton className="h-16 w-full" />
      ) : models.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="pre-trust-empty">
          Nichts mehr zu prüfen.
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          <ul
            aria-label="Modelle"
            className="flex max-h-72 flex-col gap-2 overflow-y-auto rounded-lg border p-2"
          >
            {models.map((m) => {
              const checkbox = `${id}-${m.revisionId}`;
              return (
                <li key={m.revisionId} className="flex min-w-0 gap-3" data-testid="pre-trust-model">
                  <Checkbox
                    id={checkbox}
                    className="mt-1"
                    checked={!unticked.has(m.revisionId)}
                    onCheckedChange={(on) => toggle(m.revisionId, on === true)}
                  />
                  <label htmlFor={checkbox} className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{m.modelName ?? m.modelKey}</span>
                    <span className="text-xs text-muted-foreground">{preTrustModelDetail(m)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="text-sm" data-testid="pre-trust-summary">
            {selected.length === 0 ? (
              'Wähle mindestens ein Modell.'
            ) : dry.isError ? (
              <ErrorText error={dry.error} />
            ) : dry.data ? (
              preTrustDryRunText(dry.data)
            ) : (
              <Skeleton className="h-4 w-48" />
            )}
          </div>
          {selected.length > 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="pre-trust-keep-note">
              {PRE_TRUST_KEEP_NOTE}
            </p>
          ) : null}
        </div>
      )}
      {failed ? (
        <Alert variant="destructive">
          <AlertTitle>Das hat nicht geklappt</AlertTitle>
          <AlertDescription>
            <ErrorText error={real.error} />
          </AlertDescription>
        </Alert>
      ) : null}
      {models.length > 0 ? (
        <DialogFooter>
          <Button
            variant="outline"
            disabled={selected.length === 0 || busy}
            onClick={() => decide('modelled')}
            data-testid="pre-trust-keep"
          >
            Behalten
          </Button>
          <Button
            disabled={selected.length === 0 || busy || !dry.data || dry.isFetching}
            onClick={() => decide('derived')}
            data-testid="pre-trust-revoke"
          >
            <Undo2Icon data-icon="inline-start" />
            Zurück in die Prüfung
          </Button>
        </DialogFooter>
      ) : null}
    </>
  );
}

/**
 * „Vor der Vertrauensregel angenommen“ (M6 S2c-4, owner decisions 24.2 (a)
 * and 28 (3)), in the revoke dialog's pattern: the models whose unique calls
 * analyzr accepted before the trust rule and would only propose today, each
 * with a checkbox, its reasons and count (all selected), the dry run in one
 * line, then „Zurück in die Prüfung“ (the calls become proposals that
 * „Gesammelt annehmen“ takes; an owner's rule for derived calls may accept
 * them again at once) or „Behalten“ (they stay accepted, never listed
 * again, which a note under the dry run says). Each model is decided once; a
 * 409 of the dry run or the review (reviewed or uploaded again meanwhile)
 * reloads the list. Owners only.
 */
export function PreTrustDialog({ open, onOpenChange, returnFocus, ...props }: PreTrustDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-xl"
        data-testid="pre-trust-dialog"
        onCloseAutoFocus={(event) => {
          const target = returnFocus?.();
          if (!target) return;
          event.preventDefault();
          target.focus();
        }}
      >
        {open ? <PreTrustBody onOpenChange={onOpenChange} {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

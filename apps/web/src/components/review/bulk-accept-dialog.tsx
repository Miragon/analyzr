import type { Relation } from '@analyzr/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { CheckCheckIcon, ChevronRightIcon, TriangleAlertIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { TYPE_ICONS } from '@/components/badges';
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
import { errorMessage } from '@/lib/api';
import { flagLine } from '@/lib/generic-names';
import { RELATION_TYPES, formatConfidence } from '@/lib/labels';
import { MAX_BULK_DECISIONS } from '@/lib/limits';
import { autoAcceptRulesQuery, modelsQuery } from '@/lib/queries';
import type { RefResolver } from '@/lib/refs';
import {
  bulkPreselection,
  conflictOf,
  derivedCallSource,
  elementsText,
  isDerivedCall,
  ruleNamesSource,
  sideName,
  someOutsideUnseenModels,
  type BulkPreselect,
  type BulkRow,
  type Conflict,
} from '@/lib/review';
import { useBulkDecide } from '@/lib/review-actions';
import { toast } from '@/lib/toast';

import { PlainText } from './plain-text';

/**
 * The bulk accept of „Gleicher Name“ (CONCEPT §3 step 2: "a reviewer checks
 * [key-tier proposals] briefly and accepts them in bulk"; UX5, owner decision
 * 26 (6): the key tier only). Its button names the unflagged pairs, „8
 * unauffällige annehmen …“, and the dialog selects exactly those; the
 * flagged ones (a generic name, a name more than two processes share, an
 * open agent question, an agent's no-link, an ambiguous call target) sit in
 * a closed „Genauer ansehen (n)“, each with its flags and „Vorschlag öffnen“:
 * they are decided one by one and stay in the queue. The unique calls from
 * derived models (M6 S2c, `isDerivedCall`) come first, under „Eindeutige
 * Aufrufe aus abgeleiteten Modellen (n)“ (a flagged one stays in that group,
 * flagged); opened from a „Gesammelt annehmen“ link (`?bulk=calls`), the
 * dialog selects exactly the unflagged ones (`bulkPreselection`: at most
 * 500, the rest follow), the others stay listed unselected. The
 * request carries ids, versions, the tier and the count, so a list that
 * changed meanwhile fails as a whole (409). After the accept, an owner is
 * offered the rule that would have accepted them („Gleicher Name ab 100 %
 * künftig automatisch annehmen?“), unless each of them has an end in a
 * model declared reconstructed or as-told (owner decision 30 (2):
 * `someOutsideUnseenModels`); after accepting only such calls, a rule
 * for derived calls of the source most of their callers declare
 * („Eindeutige Aufrufe aus abgeleiteten Modellen künftig automatisch
 * annehmen?“, M6 S2c-3, `derivedCallSource`), and nothing when no rule could
 * accept them (callers uploaded with an agent token, say) or a rule already
 * names that source (`ruleNamesSource`).
 */

type Row = BulkRow;

function PairText({ relation: r, resolve }: { relation: Relation; resolve: RefResolver }) {
  const from = resolve(r.from);
  const to = resolve(r.to);
  const Icon = TYPE_ICONS[r.type];
  const elements = elementsText(from, to);
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <PlainText
        as="span"
        className="font-medium break-words"
        text={`${sideName(from)} → ${sideName(to)}`}
      />
      <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span title={RELATION_TYPES[r.type].label}>
          <Icon className="size-3.5" aria-hidden />
          <span className="sr-only">{RELATION_TYPES[r.type].label}</span>
        </span>
        {elements ? <PlainText as="span" className="break-words" text={elements} /> : null}
        <span className="tabular-nums">{formatConfidence(r.confidence)}</span>
      </span>
    </span>
  );
}

/** An unflagged pair: a checkbox and the pair. */
function PlainRow({
  relation: r,
  resolve,
  checked,
  onCheckedChange,
}: {
  relation: Relation;
  resolve: RefResolver;
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
}) {
  return (
    <li
      data-testid="bulk-row"
      data-relation-id={r.id}
      data-flagged={false}
      className="flex gap-3 border-b py-2 last:border-b-0"
    >
      <Checkbox
        className="mt-1"
        checked={checked}
        onCheckedChange={(on) => onCheckedChange(on === true)}
        aria-label={`${sideName(resolve(r.from))} nach ${sideName(resolve(r.to))} annehmen`}
      />
      <PairText relation={r} resolve={resolve} />
    </li>
  );
}

/** A flagged pair: the pair, its flags in one line and „Vorschlag öffnen“; no checkbox. */
function FlaggedRow({
  project,
  row: { relation: r, flags },
  resolve,
  onClose,
  className,
}: {
  project: string;
  row: Row;
  resolve: RefResolver;
  onClose: () => void;
  className: string;
}) {
  return (
    <li
      data-testid="bulk-row"
      data-relation-id={r.id}
      data-flagged
      className={`flex flex-col gap-1 py-2 ${className}`}
    >
      <PairText relation={r} resolve={resolve} />
      <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
        <span
          className="inline-flex items-center gap-1 text-warning"
          data-testid="generic-flag"
          data-flag={flags.map((f) => f.kind).join(' ')}
        >
          <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden />
          {flagLine(flags)}
        </span>
        <Link
          to="/projects/$project/review/$relation"
          params={{ project, relation: r.id }}
          className="text-link hover:underline"
          onClick={onClose}
        >
          Vorschlag öffnen
        </Link>
      </span>
    </li>
  );
}

function BulkList({
  project,
  rows,
  resolve,
  canOwn,
  preselect,
  onClose,
}: {
  project: string;
  rows: readonly Row[];
  resolve: RefResolver;
  canOwn: boolean;
  preselect: BulkPreselect;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  // The callers' declared sources and the rules, for the rule the toast offers after derived
  // calls (M6 S2c-3; none when one already names the source), and the models declared
  // reconstructed or as-told, on which no rule accepts anything (owner decision 30 (2)).
  const queryClient = useQueryClient();
  useQuery({ ...modelsQuery(project), enabled: canOwn });
  useQuery({ ...autoAcceptRulesQuery(project), enabled: canOwn });
  const plain = rows.filter((r) => r.flags.length === 0);
  const calls = rows.filter((r) => isDerivedCall(r.relation));
  const others = plain.filter((r) => !isDerivedCall(r.relation));
  const flagged = rows.filter((r) => r.flags.length > 0 && !isDerivedCall(r.relation));
  // The rows whose box differs from what the dialog selects when it opens.
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const bulk = useBulkDecide(project);
  const initial = bulkPreselection(rows, preselect);
  const preselected = (r: Relation) => initial.has(r.id);
  const checked = (r: Relation) => preselected(r) !== toggled.has(r.id);
  // `calls` selects at most MAX_BULK_DECISIONS of them: the rest follow in the next request.
  const rest =
    preselect === 'calls' ? calls.filter((r) => r.flags.length === 0).length - initial.size : 0;
  const chosen = plain.filter((r) => checked(r.relation)).map((r) => r.relation);
  const tooMany = chosen.length > MAX_BULK_DECISIONS;

  const setChecked = (r: Relation, on: boolean) =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (on === preselected(r)) next.delete(r.id);
      else next.add(r.id);
      return next;
    });

  function confirm() {
    if (chosen.length === 0 || tooMany) return;
    setConflict(null);
    // Only unique calls from derived models: no agent rule would have accepted them (M6 S2c);
    // a rule for derived calls of their source would (M6 S2c-3), unless none can be named.
    const onlyCalls = chosen.every(isDerivedCall);
    bulk.mutate(
      {
        verdict: 'accept',
        tier: 'key',
        items: chosen.map((r) => ({ id: r.id, version: r.version })),
        expectedCount: chosen.length,
      },
      {
        onSuccess: (result) => {
          // The models' `trust` and `source` as loaded now (the review page has the models).
          const models = queryClient.getQueryData(modelsQuery(project).queryKey) ?? [];
          const found = canOwn && onlyCalls ? derivedCallSource(chosen, models) : null;
          // The „Gleicher Name“ rule, unless every other pair has an end in a reconstructed or
          // as-told model: no auto-accept rule accepts those (owner decision 30 (2)).
          const offer =
            canOwn &&
            !onlyCalls &&
            someOutsideUnseenModels(
              chosen.filter((r) => !isDerivedCall(r)),
              models,
            );
          const rules = queryClient.getQueryData(autoAcceptRulesQuery(project).queryKey)?.items;
          const source = found && !ruleNamesSource(rules ?? [], found) ? found : null;
          toast({
            tone: 'success',
            title:
              result.items.length === 1
                ? '1 Relation angenommen'
                : `${result.items.length} Relationen angenommen`,
            description: source
              ? 'Eindeutige Aufrufe aus abgeleiteten Modellen künftig automatisch annehmen?'
              : onlyCalls
                ? 'Eindeutige Aufrufe aus abgeleiteten Modellen.'
                : offer
                  ? 'Gleicher Name ab 100 % künftig automatisch annehmen?'
                  : 'Grundlage „Gleicher Name“.',
            ...(source
              ? {
                  action: {
                    label: 'Annahmeregel anlegen',
                    altText:
                      'Eine Annahmeregel für eindeutige Aufrufe aus abgeleiteten Modellen dieser Herkunft anlegen',
                    onAction: () =>
                      void navigate({
                        to: '/projects/$project/rules',
                        params: { project },
                        search: {
                          new: 'calls',
                          derivedKind: source.derivedKind,
                          ...(source.converter ? { converter: source.converter } : {}),
                        },
                      }),
                  },
                }
              : offer
                ? {
                    action: {
                      label: 'Annahmeregel anlegen',
                      altText: 'Eine Annahmeregel für „Gleicher Name“ ab 100 % anlegen',
                      onAction: () =>
                        void navigate({
                          to: '/projects/$project/rules',
                          params: { project },
                          search: { new: 'key' },
                        }),
                    },
                  }
                : {}),
          });
          onClose();
        },
        onError: (error) => {
          const c = conflictOf(error);
          if (c) setConflict(c);
          else
            toast({
              tone: 'danger',
              title: 'Nichts angenommen',
              description: errorMessage(error),
              error,
            });
        },
      },
    );
  }

  const plainRow = ({ relation: r }: Row) => (
    <PlainRow
      key={r.id}
      relation={r}
      resolve={resolve}
      checked={checked(r)}
      onCheckedChange={(on) => setChecked(r, on)}
    />
  );

  return (
    <>
      {conflict ? (
        <Alert data-testid="bulk-conflict" className="border-warning bg-warning-soft">
          <TriangleAlertIcon className="text-warning" />
          <AlertTitle>{conflict.title}</AlertTitle>
          <AlertDescription className="text-foreground">{conflict.description}</AlertDescription>
        </Alert>
      ) : null}

      <p className="text-sm text-muted-foreground" aria-live="polite" data-testid="bulk-summary">
        {chosen.length} von {plain.length} ausgewählt
      </p>
      {rest > 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="bulk-rest">
          Höchstens {MAX_BULK_DECISIONS} auf einmal; die übrigen {rest} danach.
        </p>
      ) : null}
      <div className="-mx-1 flex max-h-[min(44vh,440px)] flex-col gap-3 overflow-y-auto px-1">
        {calls.length > 0 ? (
          <section aria-labelledby="bulk-calls-title" data-testid="bulk-calls">
            <h3 id="bulk-calls-title" className="text-sm font-medium">
              Eindeutige Aufrufe aus abgeleiteten Modellen ({calls.length})
            </h3>
            <ul aria-labelledby="bulk-calls-title" className="flex flex-col">
              {calls.map((row) =>
                row.flags.length === 0 ? (
                  plainRow(row)
                ) : (
                  <FlaggedRow
                    key={row.relation.id}
                    project={project}
                    row={row}
                    resolve={resolve}
                    onClose={onClose}
                    className="border-b last:border-b-0"
                  />
                ),
              )}
            </ul>
          </section>
        ) : null}
        {others.length > 0 ? (
          <section aria-labelledby={calls.length > 0 ? 'bulk-key-title' : undefined}>
            {calls.length > 0 ? (
              <h3 id="bulk-key-title" className="text-sm font-medium">
                Gleicher Name ({others.length})
              </h3>
            ) : null}
            <ul aria-label="Unauffällige Paare" className="flex flex-col">
              {others.map(plainRow)}
            </ul>
          </section>
        ) : null}
      </div>

      {flagged.length > 0 ? (
        <details className="group rounded-lg border" data-testid="bulk-flagged">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-sm font-medium">
            <ChevronRightIcon
              className="size-4 transition-transform group-open:rotate-90"
              aria-hidden
            />
            Genauer ansehen ({flagged.length})
          </summary>
          <ul aria-label="Markierte Paare" className="flex max-h-60 flex-col overflow-y-auto px-3">
            {flagged.map((row) => (
              <FlaggedRow
                key={row.relation.id}
                project={project}
                row={row}
                resolve={resolve}
                onClose={onClose}
                className="border-t"
              />
            ))}
          </ul>
        </details>
      ) : null}

      {tooMany ? (
        <p className="text-sm text-danger">
          Höchstens {MAX_BULK_DECISIONS} Relationen auf einmal; wähle weniger aus.
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Abbrechen
        </Button>
        <Button
          onClick={confirm}
          disabled={chosen.length === 0 || tooMany || bulk.isPending}
          data-testid="bulk-confirm"
        >
          <CheckCheckIcon data-icon="inline-start" />
          {chosen.length === 1 ? '1 annehmen' : `${chosen.length} annehmen`}
        </Button>
      </DialogFooter>
    </>
  );
}

export interface BulkAcceptDialogProps {
  project: string;
  /** The queue's key-tier proposals with their flags (`bulkRows`). */
  rows: readonly Row[];
  resolve: RefResolver;
  /** The owner is offered the rule afterwards. */
  canOwn: boolean;
  /** What it selects when it opens (default: every unflagged pair). */
  preselect?: BulkPreselect;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where the focus goes when it closes (Radix: back to what had it before it opened). */
  onCloseAutoFocus?: (event: Event) => void;
}

/** The title: what the dialog selects when it opens. */
function titleOf(selected: number, preselect: BulkPreselect): string {
  if (preselect === 'calls')
    return selected === 1
      ? '1 eindeutigen Aufruf annehmen?'
      : `${selected} eindeutige Aufrufe annehmen?`;
  return selected === 1
    ? '1 unauffälligen Vorschlag annehmen?'
    : `${selected} unauffällige Vorschläge annehmen?`;
}

export function BulkAcceptDialog({
  project,
  rows,
  resolve,
  canOwn,
  preselect = 'unflagged',
  open,
  onOpenChange,
  onCloseAutoFocus,
}: BulkAcceptDialogProps) {
  const { selected, calls } = useMemo(
    () => ({
      selected: bulkPreselection(rows, preselect).size,
      calls: rows.some((r) => isDerivedCall(r.relation)),
    }),
    [rows, preselect],
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-2xl"
        data-testid="bulk-dialog"
        {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
      >
        <DialogHeader>
          <DialogTitle>{titleOf(selected, preselect)}</DialogTitle>
          <DialogDescription>
            {calls ? 'Gleicher Name und eindeutige Aufrufe.' : 'Gleicher Name.'} Markierte mögliche
            Relationen wählst du bewusst selbst aus.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <BulkList
            project={project}
            rows={rows}
            resolve={resolve}
            canOwn={canOwn}
            preselect={preselect}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

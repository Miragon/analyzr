import type { Relation } from '@analyzr/client';
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
import type { RefResolver } from '@/lib/refs';
import { conflictOf, elementsText, sideName, type BulkRow, type Conflict } from '@/lib/review';
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
 * they are decided one by one and stay in the queue. The request carries
 * ids, versions, the tier and the count, so a list that changed meanwhile
 * fails as a whole (409). After the accept, an owner is offered the rule
 * that would have accepted them („Gleicher Name ab 100 % künftig automatisch
 * annehmen?“).
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

function BulkList({
  project,
  rows,
  resolve,
  canOwn,
  onClose,
}: {
  project: string;
  rows: readonly Row[];
  resolve: RefResolver;
  canOwn: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const plain = rows.filter((r) => r.flags.length === 0);
  const flagged = rows.filter((r) => r.flags.length > 0);
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const bulk = useBulkDecide(project);
  const chosen = plain.filter((r) => !unchecked.has(r.relation.id)).map((r) => r.relation);
  const tooMany = chosen.length > MAX_BULK_DECISIONS;

  const toggle = (id: string, on: boolean) =>
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (on) next.delete(id);
      else next.add(id);
      return next;
    });

  function confirm() {
    if (chosen.length === 0 || tooMany) return;
    setConflict(null);
    bulk.mutate(
      {
        verdict: 'accept',
        tier: 'key',
        items: chosen.map((r) => ({ id: r.id, version: r.version })),
        expectedCount: chosen.length,
      },
      {
        onSuccess: (result) => {
          toast({
            tone: 'success',
            title:
              result.items.length === 1
                ? '1 Relation angenommen'
                : `${result.items.length} Relationen angenommen`,
            description: canOwn
              ? 'Gleicher Name ab 100 % künftig automatisch annehmen?'
              : 'Grundlage „Gleicher Name“.',
            ...(canOwn
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
      <ul
        aria-label="Unauffällige Paare"
        className="-mx-1 flex max-h-[min(44vh,440px)] flex-col overflow-y-auto px-1"
      >
        {plain.map(({ relation: r }) => (
          <li
            key={r.id}
            data-testid="bulk-row"
            data-relation-id={r.id}
            data-flagged={false}
            className="flex gap-3 border-b py-2 last:border-b-0"
          >
            <Checkbox
              className="mt-1"
              checked={!unchecked.has(r.id)}
              onCheckedChange={(on) => toggle(r.id, on === true)}
              aria-label={`${sideName(resolve(r.from))} nach ${sideName(resolve(r.to))} annehmen`}
            />
            <PairText relation={r} resolve={resolve} />
          </li>
        ))}
      </ul>

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
            {flagged.map(({ relation: r, flags }) => (
              <li
                key={r.id}
                data-testid="bulk-row"
                data-relation-id={r.id}
                data-flagged
                className="flex flex-col gap-1 border-t py-2"
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
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BulkAcceptDialog({
  project,
  rows,
  resolve,
  canOwn,
  open,
  onOpenChange,
}: BulkAcceptDialogProps) {
  const plain = useMemo(() => rows.filter((r) => r.flags.length === 0).length, [rows]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-testid="bulk-dialog">
        <DialogHeader>
          <DialogTitle>
            {plain === 1
              ? '1 unauffälligen Vorschlag annehmen?'
              : `${plain} unauffällige Vorschläge annehmen?`}
          </DialogTitle>
          <DialogDescription>
            Gleicher Name. Markierte mögliche Relationen wählst du bewusst selbst aus.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <BulkList
            project={project}
            rows={rows}
            resolve={resolve}
            canOwn={canOwn}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

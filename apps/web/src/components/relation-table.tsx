import type { Relation } from '@analyzr/client';
import { cn } from 'cn';
import { ArrowRightIcon, FilterIcon, FilterXIcon } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { AutoAcceptMark } from '@/components/auto-accept-mark';
import { EndpointStateBadge, StatusBadge, TierBadge, TypeLabel } from '@/components/badges';
import { LightPopover } from '@/components/light-popover';
import { PlainText } from '@/components/review/plain-text';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { Field, FieldLabel } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { AutoAcceptIndex, AutoFilter } from '@/lib/auto-accept';
import {
  RELATION_STATUSES,
  RELATION_TYPES,
  TIERS,
  TIER_ORDER,
  TYPE_ORDER,
  formatConfidence,
} from '@/lib/labels';
import {
  RELATION_PAGE,
  decidedBy,
  filterRelations,
  moreFilterCount,
  narrowsView,
  resultViewOf,
  statusOptions,
  viewFilters,
  type RelationFilters,
  type ResultView,
} from '@/lib/relation-filters';
import type { RefLabel, RefResolver } from '@/lib/refs';

/**
 * One end of a relation: element label (or id), model key and process. Cut
 * to one line each (the ref in the tooltip), or with `wrap` (the relations
 * table, UX9) wrapped, so a name shows in full where its column allows, and
 * without the ref (no ids, P2).
 */
export function Endpoint({ label, wrap = false }: { label: RefLabel; wrap?: boolean }) {
  const line = wrap ? 'break-words' : 'truncate';
  return (
    <div className="flex min-w-0 flex-col" title={wrap ? undefined : label.ref}>
      {wrap && label.label !== null ? (
        <PlainText as="span" text={label.label} className="font-medium" />
      ) : (
        <span className={cn('font-medium', line)}>
          {label.label ?? <span className="font-mono text-[13px]">{label.elementId}</span>}
        </span>
      )}
      <span className={cn('text-xs text-muted-foreground', line)}>
        <span className="font-mono">{label.modelKey}</span>
        {label.processName && label.kind !== 'process' ? ` · ${label.processName}` : null}
      </span>
    </div>
  );
}

export interface RelationTableProps {
  relations: readonly Relation[];
  resolve: RefResolver;
  /** The row's action: „Öffnen“, the review screen with the list's filters. */
  renderActions?: (relation: Relation) => ReactNode;
  /** The auto-accept ledger (reviewers): marks relations an auto-accept rule accepted. */
  autoIndex?: AutoAcceptIndex;
}

/**
 * The badges of „Grundlage“ and „Status“ break at their spaces instead of
 * widening the column (UX9): „Eindeutiger Aufruf“ or „Automatisch
 * angenommen“ take two lines, the endpoints keep the width.
 */
const BADGE_CELL =
  'whitespace-normal [&_[data-slot=badge]]:h-auto [&_[data-slot=badge]]:w-min [&_[data-slot=badge]]:whitespace-normal [&_[data-slot=badge]>span]:whitespace-normal';

/**
 * The relation rows (UX-SIMPLIFICATION.md §3.10 item 3, UX9): type, both
 * endpoints in the width the dropped details chevron and the narrower
 * columns free (wrapped, not cut), tier, status, confidence, „Entschieden
 * von“ (who: a handle, „analyzr“ or the auto-accept rule, never a procedure
 * or a model) and one action; refs, id, version and attributes are the
 * review screen's. „Grundlage“ and „Status“ keep their widths from before
 * UX9, their badges wrap.
 */
export function RelationTable({
  relations,
  resolve,
  renderActions,
  autoIndex,
}: RelationTableProps) {
  return (
    <Table aria-label="Relationen" className="min-w-[1056px] table-fixed">
      <colgroup>
        <col className="w-28" />
        <col />
        <col className="w-6" />
        <col />
        <col className="w-28" />
        <col className="w-36" />
        <col className="w-20" />
        <col className="w-36" />
        <col className="w-24" />
      </colgroup>
      <TableHeader>
        <TableRow>
          <TableHead>Typ</TableHead>
          <TableHead>Von</TableHead>
          <TableHead>
            <span className="sr-only">nach</span>
          </TableHead>
          <TableHead>Nach</TableHead>
          <TableHead>Grundlage</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Konfidenz</TableHead>
          <TableHead>Entschieden von</TableHead>
          <TableHead>
            <span className="sr-only">Aktion</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {relations.map((r) => {
          const auto = autoIndex?.inForce.get(r.id);
          const by = decidedBy(r, auto);
          return (
            <TableRow
              key={r.id}
              data-testid="relation-row"
              data-relation-id={r.id}
              data-status={r.status}
              data-tier={r.tier}
              data-auto={auto ? 'true' : undefined}
              className={cn(r.status === 'accepted' && r.tier === 'rule' && 'bg-success-soft/40')}
            >
              <TableCell>
                <TypeLabel type={r.type} />
              </TableCell>
              <TableCell className="whitespace-normal">
                <Endpoint label={resolve(r.from)} wrap />
              </TableCell>
              <TableCell className="px-0 text-muted-foreground">
                <ArrowRightIcon className="size-4" aria-hidden />
              </TableCell>
              <TableCell className="whitespace-normal">
                <Endpoint label={resolve(r.to)} wrap />
              </TableCell>
              <TableCell className={BADGE_CELL}>
                <TierBadge tier={r.tier} />
              </TableCell>
              <TableCell className={BADGE_CELL}>
                <div className="flex min-w-0 flex-col items-start gap-1">
                  {auto ? <AutoAcceptMark entry={auto} /> : <StatusBadge status={r.status} />}
                  <EndpointStateBadge state={r.endpointState} />
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatConfidence(r.confidence)}
              </TableCell>
              <TableCell
                className="whitespace-normal"
                data-testid="decided-by"
                data-source={by?.source}
              >
                {by ? (
                  <PlainText as="span" text={by.text} />
                ) : (
                  <span className="text-muted-foreground">
                    –<span className="sr-only"> noch nicht entschieden</span>
                  </span>
                )}
              </TableCell>
              <TableCell>{renderActions?.(r)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export interface RelationsViewProps extends RelationTableProps {
  /** Model keys offered in the model filter. */
  modelKeys: readonly string[];
  filters: RelationFilters;
  /** A filter change starts the rows over: the route drops `shown`. */
  onFiltersChange: (filters: RelationFilters) => void;
  /** Rows shown (`shown` in the URL), {@link RELATION_PAGE} without. */
  shown?: number | undefined;
  /** „Weitere 40 anzeigen“: the rows to show next. */
  onShownChange: (shown: number) => void;
  /**
   * The relation auto-accept rules (reviewers; owners get every rule, editors
   * the ones the ledger names): with them the filter „Annahmeregel“ appears
   * behind „Weitere Filter“ (`autoIndex` joins).
   */
  autoRules?: readonly { id: string; name: string }[];
}

const ALL = '';

/** A result view without a row, before any filter of its own. */
const EMPTY_VIEW: Record<ResultView, string> = {
  accepted: 'Noch gilt keine Relation',
  rejected: 'Keine Relation abgelehnt',
  auto: 'Keine Relation automatisch angenommen',
  all: 'Keine Relation',
};

/**
 * A result view of „Relationen“ (UX-SIMPLIFICATION.md §3.10 items 2 and 3,
 * UX9), filtered on the client: „Status“ (in „Alle“ only, the other views
 * are a status) and „Modell“ in the row, „Grundlage“, „Typ“ and
 * „Annahmeregel“ behind „Weitere Filter“ (a light disclosure saying how many
 * of them are set; „Annahmeregel“ not in „Abgelehnt“, where no acceptance
 * is in force); „Filter zurücksetzen“ returns to the view's own filters.
 * The first 40 rows, then „Weitere 40 anzeigen“, kept in the URL so the way
 * back from the review screen shows the same rows. The tab's routes show
 * `RelationsEmpty` instead while the project has no relation at all.
 */
export function RelationsView({
  relations,
  modelKeys,
  filters,
  onFiltersChange,
  shown,
  onShownChange,
  autoRules,
  ...table
}: RelationsViewProps) {
  const { autoIndex } = table;
  const visible = useMemo(
    () => filterRelations(relations, filters, autoIndex),
    [relations, filters, autoIndex],
  );
  const view = resultViewOf(filters);
  const own = viewFilters(view);
  const filtered = narrowsView(filters);
  const more = moreFilterCount(filters);
  const [moreOpen, setMoreOpen] = useState(false);
  const limit = shown ?? RELATION_PAGE;
  const rest = visible.length - limit;

  const set = (patch: Partial<RelationFilters>) => {
    const next: RelationFilters = { ...filters, ...patch };
    for (const k of Object.keys(next) as (keyof RelationFilters)[]) {
      if (next[k] === undefined) delete next[k];
    }
    onFiltersChange(next);
  };
  const reset = () => {
    onFiltersChange(own);
    // The reset button leaves with the filters: keep the keyboard focus in the filter row.
    requestAnimationFrame(() => document.getElementById('filter-model')?.focus());
  };

  if (relations.length === 0)
    return (
      <Empty className="border bg-card">
        <EmptyHeader>
          <EmptyTitle>Noch keine Relationen</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );

  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex flex-wrap items-center gap-2"
        role="search"
        aria-label="Relationen filtern"
      >
        {view === 'all' ? (
          <Field className="w-auto gap-0">
            <FieldLabel htmlFor="filter-status" className="sr-only">
              Status
            </FieldLabel>
            <NativeSelect
              id="filter-status"
              value={filters.status ?? ALL}
              onChange={(e) =>
                set({
                  status:
                    e.target.value === ALL ? undefined : (e.target.value as Relation['status']),
                })
              }
            >
              <NativeSelectOption value={ALL}>Alle Status</NativeSelectOption>
              {statusOptions(filters.status).map((s) => (
                <NativeSelectOption key={s} value={s}>
                  {RELATION_STATUSES[s].label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
        <Field className="w-auto min-w-56 gap-0">
          <FieldLabel htmlFor="filter-model" className="sr-only">
            Modell
          </FieldLabel>
          <NativeSelect
            id="filter-model"
            className="w-full"
            value={filters.model ?? ALL}
            onChange={(e) => set({ model: e.target.value === ALL ? undefined : e.target.value })}
          >
            <NativeSelectOption value={ALL}>Alle Modelle</NativeSelectOption>
            {modelKeys.map((k) => (
              <NativeSelectOption key={k} value={k}>
                {k}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <LightPopover
          open={moreOpen}
          onOpenChange={setMoreOpen}
          label="Weitere Filter"
          align="start"
          testId="more-filters"
          trigger={(props) => (
            <Button variant="outline" {...props} data-testid="more-filters-toggle">
              <FilterIcon data-icon="inline-start" />
              {`Weitere Filter${more > 0 ? ` (${more})` : ''}`}
            </Button>
          )}
        >
          <div className="flex w-64 flex-col gap-3 p-2">
            <Field>
              <FieldLabel htmlFor="filter-tier">Grundlage</FieldLabel>
              <NativeSelect
                id="filter-tier"
                className="w-full"
                value={filters.tier ?? ALL}
                onChange={(e) =>
                  set({
                    tier: e.target.value === ALL ? undefined : (e.target.value as Relation['tier']),
                  })
                }
              >
                <NativeSelectOption value={ALL}>Alle Grundlagen</NativeSelectOption>
                {TIER_ORDER.map((t) => (
                  <NativeSelectOption key={t} value={t}>
                    {TIERS[t].label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="filter-type">Typ</FieldLabel>
              <NativeSelect
                id="filter-type"
                className="w-full"
                value={filters.type ?? ALL}
                onChange={(e) =>
                  set({
                    type: e.target.value === ALL ? undefined : (e.target.value as Relation['type']),
                  })
                }
              >
                <NativeSelectOption value={ALL}>Alle Typen</NativeSelectOption>
                {TYPE_ORDER.map((t) => (
                  <NativeSelectOption key={t} value={t}>
                    {RELATION_TYPES[t].label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            {autoRules !== undefined && autoRules.length > 0 && view !== 'rejected' ? (
              <Field>
                <FieldLabel htmlFor="filter-auto">Annahmeregel</FieldLabel>
                <NativeSelect
                  id="filter-auto"
                  className="w-full"
                  value={filters.auto ?? ALL}
                  onChange={(e) =>
                    set({
                      auto: e.target.value === ALL ? undefined : (e.target.value as AutoFilter),
                    })
                  }
                >
                  <NativeSelectOption value={ALL}>Alle Relationen</NativeSelectOption>
                  <NativeSelectOption value="any">
                    Automatisch angenommen (alle Regeln)
                  </NativeSelectOption>
                  {autoRules.map((rule) => (
                    <NativeSelectOption key={rule.id} value={rule.id}>
                      Regel „{rule.name}“
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
          </div>
        </LightPopover>
        {filtered ? (
          <Button variant="ghost" onClick={reset}>
            <FilterXIcon data-icon="inline-start" />
            Filter zurücksetzen
          </Button>
        ) : null}
        <p className="ml-auto text-sm text-muted-foreground" aria-live="polite">
          {visible.length === 1 ? '1 Relation' : `${visible.length} Relationen`}
        </p>
      </div>

      {visible.length > 0 ? (
        <>
          <div className="rounded-xl border bg-card">
            <RelationTable relations={visible.slice(0, limit)} {...table} />
          </div>
          {rest > 0 ? (
            <Button
              variant="outline"
              className="self-center"
              onClick={() => onShownChange(limit + RELATION_PAGE)}
              data-testid="relations-more"
            >
              {`Weitere ${Math.min(RELATION_PAGE, rest)} anzeigen (${rest} übrig)`}
            </Button>
          ) : null}
        </>
      ) : (
        <Empty className="border bg-card">
          <EmptyHeader>
            <EmptyTitle>
              {filtered ? 'Keine Relation passt zu den Filtern' : EMPTY_VIEW[view]}
            </EmptyTitle>
            {filtered ? (
              <EmptyDescription>Lockere die Filter oder setze sie zurück.</EmptyDescription>
            ) : null}
          </EmptyHeader>
          {filtered ? (
            <EmptyContent>
              <Button variant="outline" onClick={reset}>
                <FilterXIcon data-icon="inline-start" />
                Filter zurücksetzen
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      )}
    </div>
  );
}

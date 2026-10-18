import type { Relation } from '@analyzr/client';
import { Link, useNavigate } from '@tanstack/react-router';
import { CircleHelpIcon, FlagIcon, TriangleAlertIcon, Undo2Icon, UnlinkIcon } from 'lucide-react';
import { useMemo, type MouseEvent } from 'react';

import { TYPE_ICONS } from '@/components/badges';
import { ENDPOINT_STATES, RELATION_TYPES, formatConfidence } from '@/lib/labels';
import type { RefLabel, RefResolver } from '@/lib/refs';
import { elementsText, sideName, type QueueFilters, type QueueItem } from '@/lib/review';

import { PlainText } from './plain-text';

/**
 * The review queue (CONCEPT §3; UX-SIMPLIFICATION.md §3.6 items 3 and 8,
 * UX5): open proposals, and accepted relations whose endpoint changed (to
 * confirm again), highest confidence first, then those that finish a model.
 * A row leads with the processes („Gutschrift erstellen → Reklamation“), the
 * key only where two models share a name; below, the message or call name
 * once (both where they differ), the type icon and the confidence; at its
 * right the hints („Frage“, „Einwand“, „widerrufen“, „schließt 1 Modell ab“,
 * the agent only when more than one proposes). One focusable link per row
 * (the pair), a click anywhere on the row for the mouse; on a phone the same
 * row as a card, no sideways scroll. The review screen walks the same queue
 * with J/K.
 */

/** The names two or more models share: their rows show the key too. */
function sharedNames(labels: readonly RefLabel[]): ReadonlySet<string> {
  const models = new Map<string, Set<string>>();
  for (const l of labels) {
    const name = sideName(l);
    const set = models.get(name) ?? new Set<string>();
    set.add(l.modelKey);
    models.set(name, set);
  }
  return new Set([...models].filter(([, keys]) => keys.size > 1).map(([name]) => name));
}

/** The agent that proposed a relation (its handle); `null` for the rule tier and humans. */
function principalOf(r: Relation): string | null {
  return r.provenance?.sourceKind === 'agent' ? r.provenance.handle : null;
}

function Hints({
  relation: r,
  finishes,
  revoked,
  principal,
}: {
  relation: Relation;
  finishes: number;
  revoked: boolean;
  principal: string | null;
}) {
  const question = r.provenance?.question ?? null;
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
      {r.status === 'accepted' ? (
        <span
          className="inline-flex items-center gap-1 text-warning"
          data-testid="queue-reconfirm"
          title={ENDPOINT_STATES[r.endpointState].hint}
        >
          <TriangleAlertIcon className="size-3.5" aria-hidden />
          Angenommen, {ENDPOINT_STATES[r.endpointState].label}
        </span>
      ) : null}
      {revoked ? (
        <span
          className="inline-flex items-center gap-1"
          data-testid="queue-revoked"
          title="Eine automatische Annahme wurde widerrufen; der Vorschlag ist wieder zu prüfen."
        >
          <Undo2Icon className="size-3.5" aria-hidden />
          widerrufen
        </span>
      ) : null}
      {question ? (
        <span className="inline-flex items-center gap-1 text-warning" data-testid="queue-question">
          <CircleHelpIcon className="size-3.5" aria-hidden />
          Frage
        </span>
      ) : null}
      {r.noLinks.length > 0 ? (
        <span
          className="inline-flex items-center gap-1 text-warning"
          data-testid="queue-no-link"
          title={
            r.noLinks.length === 1
              ? 'Kein Zusammenhang laut Agent'
              : `Kein Zusammenhang laut Agent (${r.noLinks.length} Einwände)`
          }
        >
          <UnlinkIcon className="size-3.5" aria-hidden />
          Einwand
        </span>
      ) : null}
      {finishes > 0 ? (
        <span
          className="inline-flex items-center gap-1"
          title="Letzter offener Punkt dieser Modelle"
        >
          <FlagIcon className="size-3.5" aria-hidden />
          {finishes === 1 ? 'schließt 1 Modell ab' : `schließt ${finishes} Modelle ab`}
        </span>
      ) : null}
      {principal ? <span data-testid="queue-principal">{principal}</span> : null}
    </span>
  );
}

export function QueueList({
  project,
  items,
  resolve,
  filters,
  revoked,
}: {
  project: string;
  items: readonly QueueItem[];
  resolve: RefResolver;
  filters: QueueFilters;
  /** Relations whose auto-acceptance an owner revoked (owner decision 19): marked „widerrufen“. */
  revoked?: ReadonlySet<string>;
}) {
  const navigate = useNavigate();
  const shared = useMemo(
    () => sharedNames(items.flatMap((q) => [resolve(q.relation.from), resolve(q.relation.to)])),
    [items, resolve],
  );
  const several = useMemo(
    () => new Set(items.map((q) => principalOf(q.relation)).filter((p) => p !== null)).size > 1,
    [items],
  );
  const named = (label: RefLabel) => {
    const name = sideName(label);
    return shared.has(name) ? `${name} (${label.modelKey})` : name;
  };
  return (
    <ol aria-label="Vorschläge" className="flex flex-col divide-y rounded-xl border bg-card">
      {items.map(({ relation: r, finishes }) => {
        const from = resolve(r.from);
        const to = resolve(r.to);
        const pair = `${named(from)} → ${named(to)}`;
        const elements = elementsText(from, to);
        const Icon = TYPE_ICONS[r.type];
        const open = (event: MouseEvent<HTMLLIElement>) => {
          // the link handles its own click (and keyboard); a click elsewhere in the row opens too
          if ((event.target as HTMLElement).closest('a')) return;
          if (window.getSelection()?.toString()) return;
          void navigate({
            to: '/projects/$project/review/$relation',
            params: { project, relation: r.id },
            search: filters,
          });
        };
        return (
          <li
            key={r.id}
            onClick={open}
            className="grid cursor-pointer gap-x-4 gap-y-1 px-4 py-3 hover:bg-muted/50 md:grid-cols-[minmax(0,1fr)_16rem]"
            data-testid="queue-row"
            data-relation-id={r.id}
            data-tier={r.tier}
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <Link
                to="/projects/$project/review/$relation"
                params={{ project, relation: r.id }}
                search={filters}
                className="font-medium break-words text-foreground hover:underline focus-visible:underline focus-visible:outline-none"
                data-testid="queue-link"
              >
                <PlainText as="span" text={pair} />
              </Link>
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                <span
                  role="img"
                  aria-label={RELATION_TYPES[r.type].label}
                  title={RELATION_TYPES[r.type].label}
                  className="inline-flex items-center"
                >
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                </span>
                {elements ? (
                  <PlainText as="span" className="min-w-0 break-words" text={elements} />
                ) : null}
                <span className="tabular-nums">{formatConfidence(r.confidence)}</span>
              </span>
            </div>
            <Hints
              relation={r}
              finishes={finishes}
              revoked={revoked?.has(r.id) ?? false}
              principal={several ? principalOf(r) : null}
            />
          </li>
        );
      })}
    </ol>
  );
}

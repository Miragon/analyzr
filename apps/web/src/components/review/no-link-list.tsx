import type { NoLink } from '@analyzr/client';
import { ArrowRightIcon, ChevronRightIcon, UnlinkIcon } from 'lucide-react';

import { TypeLabel } from '@/components/badges';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { formatDateTime } from '@/lib/labels';
import type { RefResolver } from '@/lib/refs';

import { Endpoint } from '../relation-table';
import { PlainText } from './plain-text';
import { Principal } from './provenance';

/**
 * „Kein Zusammenhang laut Agent“ (CONCEPT §3 "judge each pair once"; since
 * UX5 behind the foot link of „Zu prüfen“, owner decision 26 Q12): every
 * live, current no-link of an agent, also on pairs without a relation (on a
 * pair with one it shows as „Einwand“ in the queue as well), grouped by the
 * model of its first end, each group closed. Read-only for every role: a
 * no-link needs no decision.
 */
export function NoLinkList({
  items,
  resolve,
  filtered,
}: {
  items: readonly NoLink[];
  resolve: RefResolver;
  /** A filter is set (the empty text says so). */
  filtered: boolean;
}) {
  if (items.length === 0) {
    return (
      <Empty className="border bg-card py-10">
        <EmptyHeader>
          <EmptyMedia>
            <UnlinkIcon className="size-6 text-muted-foreground" aria-hidden />
          </EmptyMedia>
          <EmptyTitle className="text-base font-semibold">
            {filtered ? 'Kein Paar passt zu den Filtern' : 'Kein Paar ohne Zusammenhang'}
          </EmptyTitle>
          <EmptyDescription>
            Hier stehen Paare, zwischen denen ein Agent keinen Zusammenhang sieht, mit seiner
            Begründung.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  const groups = new Map<string, NoLink[]>();
  for (const n of items) {
    const key = resolve(n.from).modelKey;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Paare, zwischen denen ein Agent keinen Zusammenhang sieht, nach Modell. Zu entscheiden gibt
        es hier nichts; hat ein Paar auch einen Vorschlag, steht der Einwand zusätzlich dort.
      </p>
      <div className="flex flex-col gap-2" aria-label="Kein Zusammenhang laut Agent" role="list">
        {[...groups].map(([modelKey, list]) => (
          <details
            key={modelKey}
            role="listitem"
            className="group rounded-xl border bg-card"
            data-testid="no-link-group"
            data-model-key={modelKey}
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-medium">
              <ChevronRightIcon
                className="size-4 transition-transform group-open:rotate-90"
                aria-hidden
              />
              <span className="font-mono">{modelKey}</span>
              <span className="rounded-sm bg-muted px-1.5 text-xs tabular-nums">{list.length}</span>
            </summary>
            <ul className="flex flex-col gap-3 px-4 pb-4">
              {list.map((n) => (
                <NoLinkItem key={n.id} n={n} resolve={resolve} />
              ))}
            </ul>
          </details>
        ))}
      </div>
    </div>
  );
}

function NoLinkItem({ n, resolve }: { n: NoLink; resolve: RefResolver }) {
  return (
    <li
      data-testid="no-link-item"
      data-no-link-id={n.id}
      className="flex flex-col gap-2 rounded-lg border p-3"
    >
      <div className="flex flex-wrap items-start gap-3">
        <TypeLabel type={n.type} />
        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <Endpoint label={resolve(n.from)} />
          <ArrowRightIcon className="size-4 text-muted-foreground" aria-hidden />
          <Endpoint label={resolve(n.to)} />
        </div>
      </div>
      <div className="flex flex-col gap-1 rounded-lg bg-muted px-3 py-2 text-sm">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <UnlinkIcon className="size-3.5" aria-hidden />
          <span>Kein Zusammenhang laut</span>
          <Principal sourceKind="agent" handle={n.handle} />
          <time dateTime={n.at}>{formatDateTime(n.at)}</time>
          <span className="min-w-0 truncate" title={n.origin}>
            Analyse von <span className="font-mono">{n.origin}</span>
          </span>
        </span>
        {n.reason.trim() ? (
          <PlainText text={n.reason} />
        ) : (
          <p className="text-muted-foreground">Ohne Begründung.</p>
        )}
      </div>
    </li>
  );
}

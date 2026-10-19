import { Link } from '@tanstack/react-router';
import { cn } from 'cn';

import type { RelationView } from '@/lib/relation-filters';

const item =
  'relative -mb-px inline-flex items-center gap-1.5 rounded-md px-1 pt-2 pb-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none aria-[current=page]:text-foreground aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-0 aria-[current=page]:after:-bottom-px aria-[current=page]:after:h-0.5 aria-[current=page]:after:bg-primary';

/**
 * The views of the tab „Relationen“ (UX-SIMPLIFICATION.md §3.6 item 4,
 * §3.10 item 1; UX5): „Zu prüfen 42“ and „Vorgemerkt“ on `/review`, the
 * results „Gilt“, „Abgelehnt“, „Automatisch angenommen“ (only above 0) and
 * „Alle“ on `/relations`. Only „Zu prüfen“ carries a number (P7: holds count
 * in „Offene Fragen“, a result view shows its rows); the model filter stays
 * across views. Hidden while the project has no relation at all (UX9).
 */
export function RelationViews({
  project,
  current,
  reviewCount,
  autoCount,
  model,
}: {
  project: string;
  current: RelationView;
  /** The queue's length (the tab's badge). */
  reviewCount: number;
  /** Auto-accepted relations, `null` without the ledger (viewers): the view shows above 0. */
  autoCount: number | null;
  model?: string | undefined;
}) {
  const m = model ? { model } : {};
  const at = (view: RelationView) => ({
    'aria-current': current === view ? ('page' as const) : undefined,
    className: item,
    'data-testid': 'relation-view',
    'data-view': view,
  });
  return (
    <nav
      aria-label="Ansichten"
      className={cn('-mx-1 flex gap-4 overflow-x-auto border-b px-1')}
      data-testid="relation-views"
    >
      <Link to="/projects/$project/review" params={{ project }} search={m} {...at('review')}>
        Zu prüfen
        <span className="rounded-sm bg-muted px-1.5 text-xs tabular-nums">{reviewCount}</span>
      </Link>
      <Link
        to="/projects/$project/review"
        params={{ project }}
        search={{ ...m, view: 'held' as const }}
        {...at('held')}
      >
        Vorgemerkt
      </Link>
      <Link
        to="/projects/$project/relations"
        params={{ project }}
        search={{ ...m, status: 'accepted' as const }}
        {...at('accepted')}
      >
        Gilt
      </Link>
      <Link
        to="/projects/$project/relations"
        params={{ project }}
        search={{ ...m, status: 'rejected' as const }}
        {...at('rejected')}
      >
        Abgelehnt
      </Link>
      {autoCount !== null && autoCount > 0 ? (
        <Link
          to="/projects/$project/relations"
          params={{ project }}
          search={{ ...m, auto: 'any' as const }}
          {...at('auto')}
        >
          Automatisch angenommen
        </Link>
      ) : null}
      <Link to="/projects/$project/relations" params={{ project }} search={m} {...at('all')}>
        Alle
      </Link>
    </nav>
  );
}

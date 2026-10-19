import { useId } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { openPointsText, type OpenPoints } from '@/lib/project-counts';

/**
 * Open points as a number (UX-SIMPLIFICATION.md §2.5): a model's „Offene
 * Punkte“ in the models table, a project's „Offen für dich“ in the projects
 * list (UX9). Text, not a link, since no one list holds all of them (P7: a
 * number that opens a list equals it). Its split by where to act („6
 * Relationen · 1 Platzierung · 1 Frage“) is repeated in a tooltip on a
 * focusable trigger (§3.13 item 6). „–“ for none, a placeholder for `null`.
 */
export function OpenPointsCell({ points }: { points: OpenPoints | null }) {
  const id = useId();
  if (points === null)
    return (
      <Skeleton className="h-4 w-6" aria-label="Wird geladen" data-testid="open-points-loading" />
    );
  if (points.total === 0) return <span className="text-muted-foreground">–</span>;
  return (
    <span className="group/points relative inline-flex">
      <span
        tabIndex={0}
        aria-describedby={id}
        className="cursor-default rounded-sm tabular-nums underline decoration-dotted underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span data-testid="open-points">{points.total}</span>
        <span className="sr-only"> {points.total === 1 ? 'offener Punkt' : 'offene Punkte'}</span>
      </span>
      <span
        role="tooltip"
        id={id}
        className="pointer-events-none absolute top-1/2 right-full z-20 mr-2 hidden -translate-y-1/2 rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-popover-foreground shadow-md group-focus-within/points:block group-hover/points:block"
        data-testid="open-points-split"
      >
        {openPointsText(points)}
      </span>
    </span>
  );
}

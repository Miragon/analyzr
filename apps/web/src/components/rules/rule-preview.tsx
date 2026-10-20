import type { AutoAcceptPreview } from '@analyzr/client';
import { cn } from 'cn';
import { ChevronRightIcon } from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  changingCurve,
  formatPercent,
  formatThreshold,
  historyText,
  nameFlagsText,
} from '@/lib/auto-accept-rules';

import { BlockedList } from './apply-dialog';

const ratio = (v: number | null) => (v === null ? '–' : formatPercent(v));

/**
 * The live preview of a rule in its dialog (owner decision 19; UX9): what
 * it would have accepted in this project's history (with the precision of
 * the human decisions; items only a rule decided are no ground truth), what
 * it would accept now and how many of those carry a bulk accept name flag
 * (Q8: shown, never blocking), why open proposals are held back, and under
 * the closed „Nach Konfidenz aufschlüsseln“ the curve over minimum
 * confidences, only the rows whose numbers change. A rule for derived calls
 * (`calls`, M6 S2c-3) speaks of such calls and has no curve (its minimum is
 * fixed).
 */
export function RulePreview({
  preview,
  minConfidence,
  flagged,
  stale = false,
  calls = false,
}: {
  preview: AutoAcceptPreview;
  /** The rule's minimum confidence: its row of the curve is marked. */
  minConfidence: number | null;
  /** Open items with a generic or shared name; `null` while the facts load. */
  flagged: number | null;
  /** The criteria changed since this preview (a newer one is loading). */
  stale?: boolean;
  /** A rule for derived calls (M6 S2c-3). */
  calls?: boolean;
}) {
  const h = preview.history;
  const unreviewed = [
    ...(h.autoUnreviewed > 0 ? [`Automatisch angenommen, nicht geprüft: ${h.autoUnreviewed}`] : []),
    ...(h.undecided > 0 ? [`noch nicht entschieden: ${h.undecided}`] : []),
  ];
  const curve = changingCurve(preview.curve, minConfidence);
  return (
    <div
      className={cn('flex flex-col gap-3 text-sm', stale && 'opacity-60')}
      data-testid="rule-preview"
      aria-busy={stale}
    >
      <p data-testid="preview-history">{historyText(h, calls)}.</p>
      {unreviewed.length > 0 ? (
        <p className="text-muted-foreground" data-testid="preview-unreviewed">
          {unreviewed.join(' · ')}
        </p>
      ) : null}
      <div className="flex flex-col gap-0.5">
        <p className="font-medium" data-testid="preview-open">
          Jetzt offen: {preview.open.count}
          {calls ? (preview.open.count === 1 ? ' Aufruf' : ' Aufrufe') : ''}{' '}
          {preview.open.count === 1 ? 'würde angenommen' : 'würden angenommen'}
        </p>
        {flagged !== null && flagged > 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="preview-flags">
            {nameFlagsText(flagged, preview.open.items.length < preview.open.count)}
          </p>
        ) : null}
      </div>
      <BlockedList blocked={preview.open.blocked} />
      {calls ? null : (
        <details className="group/curve" data-testid="preview-curve">
          <summary className="inline-flex cursor-pointer list-none items-center gap-0.5 rounded-sm text-xs text-muted-foreground select-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon
              className="size-3.5 transition-transform group-open/curve:rotate-90 motion-reduce:transition-none"
              aria-hidden
            />
            Nach Konfidenz aufschlüsseln
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            <Table aria-label="Verlauf nach Konfidenz" className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>ab Konfidenz</TableHead>
                  <TableHead className="text-right">würde annehmen</TableHead>
                  <TableHead className="text-right">richtig</TableHead>
                  <TableHead className="text-right">falsch</TableHead>
                  <TableHead className="text-right">Quote</TableHead>
                  <TableHead className="text-right">offen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {curve.map((c) => {
                  const current =
                    minConfidence !== null && Math.abs(c.minConfidence - minConfidence) < 1e-9;
                  return (
                    <TableRow
                      key={c.minConfidence}
                      data-testid="curve-row"
                      data-current={current ? 'true' : undefined}
                      className={cn(current && 'bg-primary/10 font-semibold')}
                    >
                      <TableCell>{formatThreshold(c.minConfidence)}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.wouldAccept}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.accepted}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.rejected + c.corrected}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {ratio(c.precision)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{c.open}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground">
              „richtig“: später von einem Menschen angenommen; „falsch“: abgelehnt oder korrigiert;
              „Quote“: die Trefferquote. Vorschläge, die nur eine Regel entschieden hat, zählen
              nicht als Prüfung.
            </p>
          </div>
        </details>
      )}
    </div>
  );
}

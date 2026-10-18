import type { Model } from '@analyzr/client';
import { PenLineIcon, SparklesIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { StageBadge, ToneBadge } from '@/components/badges';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatShortDateTime } from '@/lib/labels';
import { derivedChip } from '@/lib/provenance';

/** A model's derived chip (UX8): only for a file that is no plain export. */
const chipOf = (m: Model) => derivedChip(m.source);

/**
 * Models of a project on „Übersicht“ (UX-SIMPLIFICATION.md §3.2 item 4):
 * „Name | Phase | Offene Punkte | Aktualisiert“. The name is the model's name
 * (its key when it has none) with the key small below and the mark „ergänzt“
 * when amendments from analyzr wrote the head (M6 S5c-2), and for a file that
 * is no plain export its derived chip („Konvertiert“, „KI-rekonstruiert“, „Aus
 * Interview“; UX8, the system in its tooltip), never a column; while an agent holds
 * or failed a model, the phase cell says so in a muted line. On a phone name
 * and phase stack, „Aktualisiert“ hides. Engine and revision live in the
 * model view.
 */
export function ModelsTable({
  models,
  renderName,
  renderOpenPoints,
  renderStageNote,
  amended,
}: {
  models: readonly Model[];
  /** The name cell's link, e.g. into the model view. */
  renderName: (model: Model) => ReactNode;
  /** The „Offene Punkte“ cell. */
  renderOpenPoints: (model: Model) => ReactNode;
  /** A muted line under the phase (holder and reservation, a failure), if any. */
  renderStageNote?: (model: Model) => ReactNode;
  /** Applied amendments per model id (only models with at least one). */
  amended?: ReadonlyMap<string, number>;
}) {
  return (
    <Table aria-label="Modelle">
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead className="hidden sm:table-cell">Phase</TableHead>
          <TableHead className="text-right">Offene Punkte</TableHead>
          <TableHead className="hidden sm:table-cell">Aktualisiert</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {models.map((m) => {
          const note = renderStageNote?.(m);
          const count = amended?.get(m.id) ?? 0;
          return (
            <TableRow key={m.id} data-testid="model-row" data-model-key={m.key}>
              <TableCell className="whitespace-normal">
                <div className="flex min-w-0 flex-col items-start gap-0.5">
                  <span className="font-medium">{renderName(m)}</span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {m.name ? (
                      <span className="font-mono text-xs text-muted-foreground">{m.key}</span>
                    ) : null}
                    {chipOf(m) ? (
                      <span data-testid="model-derived">
                        <ToneBadge tone="warning" icon={SparklesIcon} title={chipOf(m)?.hint}>
                          {chipOf(m)?.label}
                        </ToneBadge>
                      </span>
                    ) : null}
                    {count > 0 ? (
                      <span data-testid="model-amended">
                        <ToneBadge
                          tone="info"
                          icon={PenLineIcon}
                          title={`${count === 1 ? 'Eine Ergänzung' : `${count} Ergänzungen`} aus analyzr im Kopf; das Original aus dem Quellsystem bleibt erhalten`}
                        >
                          ergänzt
                        </ToneBadge>
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 flex flex-col gap-0.5 sm:hidden">
                    <StageBadge stage={m.stage} />
                    {note}
                  </span>
                </div>
              </TableCell>
              <TableCell className="hidden whitespace-normal sm:table-cell">
                <div className="flex flex-col items-start gap-0.5">
                  <StageBadge stage={m.stage} />
                  {note}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">{renderOpenPoints(m)}</TableCell>
              <TableCell className="hidden text-muted-foreground sm:table-cell">
                {formatShortDateTime(m.updatedAt)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

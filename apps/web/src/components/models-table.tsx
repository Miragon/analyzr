import type { Model } from '@analyzr/client';
import { PenLineIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { EngineBadge, StageBadge, ToneBadge } from '@/components/badges';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime } from '@/lib/labels';

/**
 * Models of a project: key, engine, head revision (marked „ergänzt“ when
 * amendments from analyzr wrote the head, M6 S5c-2), pipeline stage, open
 * items.
 */
export function ModelsTable({
  models,
  renderKey,
  amended,
}: {
  models: readonly Model[];
  /** The key cell, e.g. a link into the model view. */
  renderKey?: (model: Model) => ReactNode;
  /** Applied amendments per model id (only models with at least one). */
  amended?: ReadonlyMap<string, number>;
}) {
  return (
    <Table aria-label="Modelle">
      <TableHeader>
        <TableRow>
          <TableHead>Modell</TableHead>
          <TableHead>Engine</TableHead>
          <TableHead className="text-right">Revision</TableHead>
          <TableHead>Phase</TableHead>
          <TableHead className="text-right">Offen</TableHead>
          <TableHead>Aktualisiert</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {models.map((m) => (
          <TableRow key={m.id} data-testid="model-row">
            <TableCell className="whitespace-normal">
              <div className="flex min-w-0 flex-col">
                <span className="font-mono text-[13px]">{renderKey?.(m) ?? m.key}</span>
                {m.name ? <span className="text-xs text-muted-foreground">{m.name}</span> : null}
              </div>
            </TableCell>
            <TableCell>
              <EngineBadge engine={m.engine} />
            </TableCell>
            <TableCell className="text-right tabular-nums">
              <span className="inline-flex items-center justify-end gap-1.5">
                {amended?.get(m.id) ? (
                  <span data-testid="model-amended">
                    <ToneBadge
                      tone="info"
                      icon={PenLineIcon}
                      title={`${amended.get(m.id) === 1 ? 'Eine Ergänzung' : `${amended.get(m.id)} Ergänzungen`} aus analyzr im Kopf; das Original aus dem Quellsystem bleibt erhalten`}
                    >
                      ergänzt
                    </ToneBadge>
                  </span>
                ) : null}
                r{m.headRev}
              </span>
            </TableCell>
            <TableCell>
              <StageBadge stage={m.stage} />
            </TableCell>
            <TableCell
              className="text-right tabular-nums"
              title="Relationen, die vorgeschlagen, vorgemerkt oder mit geändertem Endpunkt angenommen sind"
            >
              {m.openItems}
            </TableCell>
            <TableCell className="text-muted-foreground">{formatDateTime(m.updatedAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

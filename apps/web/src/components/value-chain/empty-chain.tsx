import { ChevronRightIcon, FileUpIcon, PlusIcon } from 'lucide-react';

import { CodeBlock } from '@/components/copy-button';
import { MiragonMark } from '@/components/page-shell';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { pushCommand } from '@/lib/value-chain';

/**
 * The value chain page of a project without a chain (M4 §4; UX6,
 * UX-SIMPLIFICATION.md §3.8 item 14): editors draw one here (nothing is
 * stored before the first save) or import a `.vc.json` (for example one an
 * agent drafted with `draft_value_chain`, M4 §3.3) into the editor, both
 * first; the CLI command waits behind „Per CLI hochladen“. Viewers only read
 * that there is none yet.
 */
export function EmptyChain({
  project,
  canReview,
  onCreate,
  onImport,
}: {
  project: string;
  canReview: boolean;
  onCreate: () => void;
  /** Opens the file picker of the import. */
  onImport: () => void;
}) {
  return (
    <Empty className="border bg-card" data-testid="empty-chain">
      <EmptyHeader>
        <EmptyMedia>
          <MiragonMark className="size-10" />
        </EmptyMedia>
        <EmptyTitle>Noch keine Wertschöpfungskette</EmptyTitle>
        <EmptyDescription>
          {canReview
            ? 'Zeichne die Kette hier oder importiere eine .vc.json (etwa den Entwurf deines Agenten).'
            : 'Für dieses Projekt hat noch niemand eine Wertschöpfungskette angelegt.'}
        </EmptyDescription>
      </EmptyHeader>
      {canReview ? (
        <EmptyContent className="max-w-lg">
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={onCreate} data-testid="create-chain">
              <PlusIcon data-icon="inline-start" />
              Wertschöpfungskette anlegen
            </Button>
            <Button variant="outline" onClick={onImport} data-testid="import-chain">
              <FileUpIcon data-icon="inline-start" />
              Importieren
            </Button>
          </div>
          <details className="group w-full text-left text-sm" data-testid="push-command">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-muted-foreground hover:text-foreground">
              <ChevronRightIcon
                className="size-4 transition-transform group-open:rotate-90"
                aria-hidden
              />
              Per CLI hochladen
            </summary>
            <div className="mt-2">
              <CodeBlock
                code={pushCommand(project)}
                label="Befehl für die CLI"
                copyLabel="Befehl kopieren"
              />
            </div>
          </details>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

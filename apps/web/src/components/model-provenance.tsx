import type { Model } from '@analyzr/client';
import { useQuery } from '@tanstack/react-query';
import { ExternalLinkIcon, FileClockIcon } from 'lucide-react';
import { useState } from 'react';

import { ErrorText } from '@/components/error-text';
import { LightPopover } from '@/components/light-popover';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { modelRevisionsQuery } from '@/lib/amendments';
import { lossText, provenanceLines, systemLabel, toolUrl } from '@/lib/provenance';

/**
 * „Herkunft“ in the model view's header (M6 S2a's web parts, UX8;
 * UX-SIMPLIFICATION.md §6; UX3 moves it into the header's „Mehr“): where
 * the head's bytes came from, as declared and stored on the uploaded
 * revision (an amended head follows `source.upstream`): the source system
 * with version and export date, the place in the tool with „In Signavio
 * öffnen“ (the system by name; http(s) only, `noopener noreferrer`), how the file was derived,
 * who uploaded it and what a conversion lost. A lazy module; the newest
 * revisions are the query the header's amendments read too.
 */
export default function ModelProvenance({ project, model }: { project: string; model: Model }) {
  const [open, setOpen] = useState(false);
  const revisions = useQuery(modelRevisionsQuery(project, model.id));
  const head = revisions.data?.find((r) => r.id === model.headRevisionId);
  const upstream = head?.source.upstream;
  const declared = upstream
    ? (revisions.data?.find((r) => r.id === upstream.revisionId) ?? null)
    : (head ?? null);
  const source = declared?.source;
  const url = toolUrl(source?.url);
  return (
    <LightPopover
      open={open}
      onOpenChange={setOpen}
      label="Herkunft"
      align="start"
      testId="model-provenance"
      trigger={(props) => (
        <Button variant="ghost" size="xs" data-testid="model-provenance-open" {...props}>
          <FileClockIcon data-icon="inline-start" />
          Herkunft
        </Button>
      )}
    >
      <div className="flex w-[22rem] max-w-full flex-col gap-2 p-2 text-sm">
        <p className="font-semibold">Herkunft</p>
        {revisions.isPending ? (
          <Spinner />
        ) : revisions.isError ? (
          <ErrorText error={revisions.error} />
        ) : head ? (
          <>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
              {provenanceLines(head, declared).map((line) => (
                <div key={line.label} className="contents" data-testid="provenance-line">
                  <dt className="text-muted-foreground">{line.label}</dt>
                  <dd className="min-w-0 break-words">{line.text}</dd>
                </div>
              ))}
            </dl>
            {source?.losses && source.losses.length > 0 ? (
              <div data-testid="provenance-losses">
                <p className="text-muted-foreground">Verluste bei der Konvertierung</p>
                <ul className="list-disc pl-5">
                  {source.losses.map((loss) => (
                    <li key={loss.code}>{lossText(loss)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {url && source?.system ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 self-start text-link hover:underline"
                data-testid="provenance-tool-link"
              >
                In {systemLabel(source.system)} öffnen
                <ExternalLinkIcon className="size-3.5" aria-hidden />
              </a>
            ) : null}
          </>
        ) : (
          <p className="text-muted-foreground">Die Kopfrevision ist nicht unter den neuesten.</p>
        )}
      </div>
    </LightPopover>
  );
}

import type { Model, Revision } from '@analyzr/client';
import { ExternalLinkIcon } from 'lucide-react';

import { lossText, provenanceLines, systemLabel, toolLinkOf } from '@/lib/provenance';

/**
 * The head's provenance (M6 S2a's web parts, UX8; UX-SIMPLIFICATION.md §6),
 * „Herkunft“ in the model view's „Mehr“ (UX3): where the head's bytes came
 * from, as declared and stored on the uploaded revision (an amended head
 * follows `source.upstream`): the source system with version and export
 * date, how the file was derived, who uploaded it and what a conversion
 * lost; the place in the tool and the link as the newest import declared
 * them (`Model.identity`, M6 S2b follow-up step 5). `revisions` are the
 * model's newest (the query the header's amendments read).
 */
export function ProvenanceDetails({
  model,
  revisions,
}: {
  model: Pick<Model, 'headRevisionId' | 'identity'>;
  revisions: readonly Revision[];
}) {
  const head = revisions.find((r) => r.id === model.headRevisionId);
  if (!head) {
    return <p className="text-muted-foreground">Die Kopfrevision ist nicht unter den neuesten.</p>;
  }
  const upstream = head.source.upstream;
  const declared = upstream ? (revisions.find((r) => r.id === upstream.revisionId) ?? null) : head;
  const source = declared?.source;
  const tool = toolLinkOf(model);
  return (
    <div className="flex flex-col gap-2 text-sm" data-testid="model-provenance">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
        {provenanceLines(head, declared, model.identity).map((line) => (
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
      {tool ? (
        <a
          href={tool.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 self-start text-link hover:underline"
          data-testid="provenance-tool-link"
        >
          In {systemLabel(tool.system)} öffnen
          <ExternalLinkIcon className="size-3.5" aria-hidden />
        </a>
      ) : null}
    </div>
  );
}

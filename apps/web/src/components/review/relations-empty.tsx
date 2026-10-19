import { AgentStart } from '@/components/agent-start';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';

/**
 * The tab „Relationen“ while the project has no relation at all
 * (UX-SIMPLIFICATION.md §3.10 item 5, O20), in place of its views, filters
 * and lists: with models, what analyzr links by itself and that an agent
 * proposes the rest, with „Agent starten“ (owners; „Agent verbinden“ without
 * an active token, nothing for others); without models, the upload hint.
 * `agentStart` off leaves the button to a status line that offers it already.
 */
export function RelationsEmpty({
  project,
  hasModels,
  hasChain,
  agentStart = true,
}: {
  project: string;
  hasModels: boolean;
  hasChain: boolean;
  agentStart?: boolean;
}) {
  return (
    <Empty className="border bg-card py-10" data-testid="relations-empty">
      <EmptyHeader>
        <EmptyTitle className="text-base font-semibold">Noch keine Relationen</EmptyTitle>
        <EmptyDescription>
          {hasModels
            ? 'Eindeutige Aufrufe aus Camunda-Modellen verknüpft analyzr beim Hochladen; den Rest schlägt ein Agent vor.'
            : 'Lade Modelle hoch: Eindeutige Aufrufe aus Camunda-Modellen nimmt die Regel sofort an, aus anderen schlägt sie sie vor; gleiche Nachrichten- und Signalnamen erscheinen als Vorschläge.'}
        </EmptyDescription>
      </EmptyHeader>
      {hasModels && agentStart ? (
        <EmptyContent>
          <AgentStart project={project} hasChain={hasChain} testId="relations-agent-start" />
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

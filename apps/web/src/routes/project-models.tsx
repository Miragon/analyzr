import type { ModelStage } from '@analyzr/client';
import { useQuery } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
import { PlugIcon, SearchIcon, SearchXIcon, UploadIcon } from 'lucide-react';
import { useMemo } from 'react';

import { RetryAgent } from '@/components/agent-start';
import { ErrorText } from '@/components/error-text';
import { ExportHub } from '@/components/export-hub';
import { ModelsTable } from '@/components/models-table';
import { NextStepBlock } from '@/components/next-step-block';
import { OpenPointsCell } from '@/components/open-points-cell';
import { MiragonMark } from '@/components/page-shell';
import { StageChips } from '@/components/review/stage-bar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAgentState } from '@/lib/agent-state';
import { matchesName } from '@/lib/generic-names';
import { STAGE_ORDER, formatTimeOrDay } from '@/lib/labels';
import { nextStep } from '@/lib/next-step';
import { useProjectPermissions } from '@/lib/permissions';
import { useProjectCounts } from '@/lib/project-counts';
import { usePipelineState } from '@/lib/pipeline-state';
import { amendmentsQuery, landscapeQuery, modelsQuery } from '@/lib/queries';
import { reviewQueue, stageCounts } from '@/lib/review';
import { placementQueue } from '@/lib/value-chain';

import { projectRoute } from './project';

interface ModelsSearch {
  stage?: ModelStage;
  /** „Modell suchen …“: words of the model's name or key. */
  q?: string;
}

export const projectModelsRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: '/',
  validateSearch: (search: Record<string, unknown>): ModelsSearch => {
    const stage = search['stage'];
    const q = search['q'];
    return {
      ...(typeof stage === 'string' && (STAGE_ORDER as readonly string[]).includes(stage)
        ? { stage: stage as ModelStage }
        : {}),
      ...(typeof q === 'string' && q.trim() !== '' ? { q } : {}),
    };
  },
  component: OverviewTab,
});

/** The holder's handle without its `agent:` prefix. */
const holderName = (claimedBy: string | null) => (claimedBy ?? 'Agent').replace(/^agent:/, '');

/**
 * „Übersicht“, the project's landing (UX-SIMPLIFICATION.md §2.3, §3.2):
 * „Als Nächstes“ with the export hub at its right, then the models table with
 * „Modell suchen …“ (`?q=`) and the phase chips (`?stage=`). An empty project
 * keeps its one primary action.
 */
function OverviewTab() {
  const { project } = projectModelsRoute.useParams();
  const { stage, q } = projectModelsRoute.useSearch();
  const navigate = projectModelsRoute.useNavigate();
  const models = useQuery(modelsQuery(project));
  const counts = useProjectCounts(project);
  const can = useProjectPermissions(project);
  const agentState = useAgentState(project);
  const landscape = useQuery(landscapeQuery(project));
  const amendments = useQuery(amendmentsQuery(project));
  const list = useMemo(() => counts.models ?? [], [counts.models]);
  const chain = counts.chain;
  const pipeline = usePipelineState(project, list);
  const { taskOf } = pipeline;

  // Models whose head carries amendments from analyzr (applied ones; a deleted model has none in view).
  const amended = useMemo(() => {
    const out = new Map<string, number>();
    for (const a of amendments.data ?? [])
      if (a.state === 'applied' && !a.modelDeleted)
        out.set(a.modelId, (out.get(a.modelId) ?? 0) + 1);
    return out;
  }, [amendments.data]);

  const relations = useMemo(() => landscape.data?.relations ?? [], [landscape.data]);

  const step = useMemo(() => {
    const queue = reviewQueue(relations, list);
    const placements = chain ? placementQueue(chain.placements, chain.steps) : [];
    return nextStep({
      waiting: pipeline.waiting,
      failed: pipeline.failed,
      expired: pipeline.expired,
      working: pipeline.working,
      reviewItems: counts.reviewItems ?? 0,
      firstRelation: queue[0]?.relation.id ?? null,
      openPlacements: counts.openPlacements ?? 0,
      firstPlacement: placements[0]?.id ?? null,
      ask: counts.ask ?? 0,
      hasChain: chain !== null && chain !== undefined,
      hasRelations: relations.length > 0,
      isOwner: can.isOwner,
      canReview: can.canReview,
      activeToken: agentState === 'start',
    });
  }, [list, relations, chain, pipeline, counts, can, agentState]);

  if (models.isPending) return <Skeleton className="h-40 w-full" />;
  if (models.isError)
    return (
      <Alert variant="destructive">
        <AlertTitle>Modelle konnten nicht geladen werden</AlertTitle>
        <AlertDescription>
          <ErrorText error={models.error} />
        </AlertDescription>
      </Alert>
    );
  if (list.length === 0) return <EmptyProject project={project} />;

  const stages = stageCounts(list);
  const visible = list
    .filter(
      (m) =>
        (stage ? m.stage === stage : true) &&
        (q ? matchesName(`${m.name ?? ''} ${m.key}`, q) : true),
    )
    .sort(
      (a, b) =>
        (a.name ?? a.key).localeCompare(b.name ?? b.key, 'de') || a.key.localeCompare(b.key),
    );
  const stageProposals = stage ? reviewQueue(relations, list, { stage }).length : 0;
  const hasChain = chain !== null && chain !== undefined;
  const setSearch = (patch: ModelsSearch) =>
    void navigate({
      search: (prev) => {
        const next: ModelsSearch = { ...prev, ...patch };
        if (next.stage === undefined) delete next.stage;
        if (next.q === undefined || next.q.trim() === '') delete next.q;
        return next;
      },
      replace: true,
    });

  return (
    <div className="flex flex-col gap-6">
      <NextStepBlock
        project={project}
        step={counts.ready ? step : null}
        canReview={can.canReview}
        canWrite={can.canWrite}
        hasChain={hasChain}
        aside={
          <ExportHub
            project={project}
            questions={(counts.ask ?? 0) + (counts.agent ?? 0) > 0}
            agentQuestions={counts.agent ?? 0}
            changeList={(amendments.data ?? []).length > 0}
            chain={hasChain}
          />
        }
      />
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <div className="relative w-full sm:w-64 sm:shrink-0">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              type="search"
              value={q ?? ''}
              onChange={(e) => setSearch({ q: e.target.value })}
              placeholder="Modell suchen …"
              aria-label="Modell suchen"
              className="pl-8"
              data-testid="model-search"
            />
          </div>
          <StageChips
            counts={stages}
            total={list.length}
            selected={stage}
            onSelect={(s) => setSearch({ stage: s })}
          />
        </div>
        {stage && stageProposals > 0 ? (
          <Link
            to="/projects/$project/review"
            params={{ project }}
            search={{ stage }}
            className="self-start text-sm text-link underline-offset-4 hover:underline"
            data-testid="stage-proposals"
          >
            {stageProposals === 1
              ? '1 Vorschlag dieser Modelle prüfen'
              : `${stageProposals} Vorschläge dieser Modelle prüfen`}
          </Link>
        ) : null}
        {visible.length === 0 ? (
          <Empty className="border bg-card py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchXIcon />
              </EmptyMedia>
              <EmptyTitle className="text-base font-semibold">Kein Modell passt</EmptyTitle>
            </EmptyHeader>
            <EmptyContent>
              <Button
                variant="outline"
                onClick={() => setSearch({ q: undefined, stage: undefined })}
              >
                Alle Modelle zeigen
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="rounded-xl border bg-card">
            <ModelsTable
              models={visible}
              amended={amended}
              renderName={(m) => (
                <Link
                  to="/projects/$project/models/$"
                  params={{ project, _splat: m.key }}
                  className="text-link hover:underline"
                >
                  {m.name ?? m.key}
                </Link>
              )}
              renderOpenPoints={(m) => <OpenPointsCell points={counts.openPoints(m)} />}
              renderStageNote={(m) => {
                const task = taskOf.get(m.key);
                if (m.stage === 'agent_working' && task) {
                  if (pipeline.expired.includes(m.key))
                    return (
                      <span className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
                        <span data-testid="lease-expired">
                          Reservierung abgelaufen am{' '}
                          {task.leaseUntil ? formatTimeOrDay(task.leaseUntil) : '–'}
                        </span>
                        <RetryAgent
                          project={project}
                          modelKeys={[m.key]}
                          hasChain={hasChain}
                          variant="link"
                          size="xs"
                        />
                      </span>
                    );
                  return (
                    <span className="text-xs text-muted-foreground" data-testid="stage-note">
                      {holderName(task.claimedBy)}
                      {task.leaseUntil
                        ? ` · reserviert bis ${formatTimeOrDay(task.leaseUntil)}`
                        : ''}
                    </span>
                  );
                }
                if (m.stage === 'agent_failed')
                  return (
                    <span className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
                      <span data-testid="stage-note">
                        {task ? `Nach ${task.attempts} Versuchen gescheitert` : 'Gescheitert'}
                      </span>
                      <RetryAgent
                        project={project}
                        modelKeys={[m.key]}
                        hasChain={hasChain}
                        variant="link"
                        size="xs"
                      />
                    </span>
                  );
                return null;
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** An empty project: one primary „Modelle hochladen“, the ghost „Agent verbinden“ (owners). */
function EmptyProject({ project }: { project: string }) {
  const can = useProjectPermissions(project);
  return (
    <Empty className="border bg-card py-12">
      <EmptyHeader>
        <EmptyMedia>
          <MiragonMark className="size-12" />
        </EmptyMedia>
        <EmptyTitle className="text-base font-semibold">Noch keine Modelle</EmptyTitle>
        <EmptyDescription>
          {can.canWrite
            ? 'Lade BPMN-Dateien hoch. analyzr liest die Fakten, verknüpft eindeutige Aufrufe sofort und schlägt gleiche Nachrichtennamen als Relationen vor.'
            : 'Dieses Projekt hat noch keine Modelle.'}
        </EmptyDescription>
      </EmptyHeader>
      {/* Write actions only for whoever may use them (never on the read-only demo). */}
      {can.canWrite ? (
        <EmptyContent className="flex-row justify-center">
          <Button asChild>
            <Link to="/projects/$project/upload" params={{ project }}>
              <UploadIcon data-icon="inline-start" />
              Modelle hochladen
            </Link>
          </Button>
          {can.isOwner ? (
            <Button variant="ghost" asChild>
              <Link to="/projects/$project/agents" params={{ project }}>
                <PlugIcon data-icon="inline-start" />
                Agent verbinden
              </Link>
            </Button>
          ) : null}
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

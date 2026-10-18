import type { Fact, Tier } from '@analyzr/client';
import { useQuery } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeftIcon, CheckCheckIcon, FilterXIcon, SearchCheckIcon, XIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { AgentStart, RetryAgent } from '@/components/agent-start';
import { ErrorText } from '@/components/error-text';
import { BulkAcceptDialog } from '@/components/review/bulk-accept-dialog';
import { HeldList } from '@/components/review/held-list';
import { NoLinkList } from '@/components/review/no-link-list';
import { QueueList } from '@/components/review/queue-table';
import { RelationViews } from '@/components/review/relation-views';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldLabel } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';

import { useAutoAcceptIndex } from '@/lib/auto-accept-actions';
import { nameUsage } from '@/lib/generic-names';
import { STAGES, TIERS, TIER_FIELD_LABEL, TIER_ORDER } from '@/lib/labels';
import { useProjectPermissions } from '@/lib/permissions';
import { usePipelineState, type PipelineState } from '@/lib/pipeline-state';
import { landscapeQuery, modelsQuery, noLinksQuery, valueChainQuery } from '@/lib/queries';
import { matchesFilters } from '@/lib/relation-filters';
import {
  bulkRows,
  heldList,
  noLinkList,
  parseQueueFilters,
  reviewQueue,
  type QueueFilters,
} from '@/lib/review';
import { useProjectFacts } from '@/lib/use-project-facts';

import { projectRoute } from './project';

interface ReviewSearch extends QueueFilters {
  /**
   * `held`: the view „Vorgemerkt“; `no-links`: the agents' no-links behind
   * the foot link (read-only).
   */
  view?: 'held' | 'no-links';
}

export const projectReviewRoute = createRoute({
  getParentRoute: () => projectRoute,
  path: 'review',
  validateSearch: (search: Record<string, unknown>): ReviewSearch => ({
    ...parseQueueFilters(search),
    ...(search['view'] === 'held' || search['view'] === 'no-links' ? { view: search['view'] } : {}),
  }),
  component: ReviewInbox,
});

const ALL = '';

const inline = 'text-link underline-offset-4 hover:underline';

/**
 * The status line above the queue (UX-SIMPLIFICATION.md §3.6 item 1), only
 * when something needs an action: models waiting for the agent (owners
 * start it), failed analyses and expired reservations (editors and owners
 * try again). `null` otherwise.
 */
function StatusLine({
  project,
  pipeline,
  hasChain,
}: {
  project: string;
  pipeline: PipelineState;
  hasChain: boolean;
}) {
  const { failed, expired, waiting } = pipeline;
  if (failed.length + expired.length + waiting.length === 0) return null;
  return (
    <div
      className="flex flex-col gap-1 text-sm text-muted-foreground"
      data-testid="review-status"
      role="status"
    >
      {failed.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-1">
          {failed.length === 1 ? '1 Analyse' : `${failed.length} Analysen`} gescheitert
          <span aria-hidden>·</span>
          <RetryAgent
            project={project}
            modelKeys={failed}
            hasChain={hasChain}
            variant="link"
            size="sm"
          />
        </p>
      ) : null}
      {expired.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-1">
          Bei {expired.length === 1 ? '1 Modell' : `${expired.length} Modellen`} ist die
          Reservierung abgelaufen
          <span aria-hidden>·</span>
          <RetryAgent
            project={project}
            modelKeys={expired}
            hasChain={hasChain}
            variant="link"
            size="sm"
          />
        </p>
      ) : null}
      {waiting.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-1">
          {waiting.length === 1 ? '1 Modell wartet' : `${waiting.length} Modelle warten`} auf den
          Agenten
          <AgentStart
            project={project}
            hasChain={hasChain}
            variant="link"
            size="sm"
            testId="review-agent-start"
          />
        </p>
      ) : null}
    </div>
  );
}

/**
 * „Relationen“ (UX1 and UX5; UX-SIMPLIFICATION.md §3.6): the views „Zu
 * prüfen“ and „Vorgemerkt“ here, the results on `/relations`. „Zu prüfen“:
 * a status line only when something needs an action, „Vorschläge prüfen
 * (n)“ at the queue's first item with „n unauffällige annehmen …“ beside it
 * (the key tier's bulk accept, its count the default selection), the
 * filters „Grundlage“ and „Modell“ while there is something to filter, the
 * queue, and the foot link „Kein Zusammenhang laut Agent (n)“ to the
 * agents' no-links (`?view=no-links`, grouped by model). Placements are
 * reviewed on the chain; its badge says how many.
 */
function ReviewInbox() {
  const { project } = projectReviewRoute.useParams();
  const search = projectReviewRoute.useSearch();
  const navigate = projectReviewRoute.useNavigate();
  const landscape = useQuery(landscapeQuery(project));
  const models = useQuery(modelsQuery(project));
  const chain = useQuery(valueChainQuery(project));
  const noLinks = useQuery(noLinksQuery(project));
  const { resolve, byModel, loading: factsLoading } = useProjectFacts(project, models.data);
  const autoIndex = useAutoAcceptIndex(project);
  const can = useProjectPermissions(project);
  const [bulkOpen, setBulkOpen] = useState(false);

  const { stage, tier, model } = search;
  const filters = useMemo<QueueFilters>(
    () => ({
      ...(stage ? { stage } : {}),
      ...(tier ? { tier } : {}),
      ...(model ? { model } : {}),
    }),
    [stage, tier, model],
  );
  const modelList = useMemo(() => models.data ?? [], [models.data]);
  const pipeline = usePipelineState(project, modelList);
  const relations = useMemo(() => landscape.data?.relations ?? [], [landscape.data]);
  const queue = useMemo(
    () => reviewQueue(relations, modelList, filters),
    [relations, modelList, filters],
  );
  const all = useMemo(() => reviewQueue(relations, modelList), [relations, modelList]);
  const held = useMemo(
    () => heldList(relations, modelList, filters),
    [relations, modelList, filters],
  );
  const unlinked = useMemo(
    () => noLinkList(noLinks.data ?? [], modelList, filters),
    [noLinks.data, modelList, filters],
  );
  const facts = useMemo<Fact[]>(() => [...byModel.values()].flatMap((f) => f.facts), [byModel]);
  const usage = useMemo(() => nameUsage(facts), [facts]);
  const bulk = useMemo(
    () =>
      bulkRows(
        queue.map((q) => q.relation),
        resolve,
        usage,
      ),
    [queue, resolve, usage],
  );
  // the flags need every model's facts: no count before they are there (it would only shrink)
  const unremarkable = factsLoading ? 0 : bulk.filter((r) => r.flags.length === 0).length;
  const autoCount = can.canReview
    ? relations.filter((r) => matchesFilters(r, { auto: 'any' }, autoIndex)).length
    : null;

  const set = (patch: Partial<ReviewSearch>) => {
    const next: ReviewSearch = { ...search, ...patch };
    for (const key of Object.keys(next) as (keyof ReviewSearch)[]) {
      if (next[key] === undefined) delete next[key];
    }
    void navigate({ search: next, replace: true });
  };

  if (landscape.isPending || models.isPending) return <Skeleton className="h-60 w-full" />;
  if (landscape.isError || models.isError)
    return (
      <Alert variant="destructive">
        <AlertTitle>Prüfliste konnte nicht geladen werden</AlertTitle>
        <AlertDescription>
          <ErrorText error={landscape.error ?? models.error} />
        </AlertDescription>
      </Alert>
    );

  const filtered =
    filters.tier !== undefined || filters.model !== undefined || filters.stage !== undefined;
  const modelKeys = modelList.map((m) => m.key).sort();
  const view = search.view;
  const hasChain = chain.data !== undefined;
  // the filters while there is something to filter, or one to lift
  const list = view === 'held' ? held : view === 'no-links' ? unlinked : queue;
  const showFilters = list.length > 0 || filtered;

  return (
    <div className="flex flex-col gap-4">
      <RelationViews
        project={project}
        current={view === 'held' ? 'held' : 'review'}
        reviewCount={all.length}
        autoCount={autoCount}
        model={model}
      />

      {view === 'no-links' ? (
        <Link
          to="/projects/$project/review"
          params={{ project }}
          search={model ? { model } : {}}
          className={`inline-flex items-center gap-1 self-start text-sm ${inline}`}
          data-testid="no-links-back"
        >
          <ArrowLeftIcon className="size-3.5" aria-hidden />
          Zu prüfen
        </Link>
      ) : null}

      {view === undefined ? (
        <StatusLine project={project} pipeline={pipeline} hasChain={hasChain} />
      ) : null}

      {/* One row: the decisions to start on the left, the filters on the right (UX5: the first
          proposal high up). The filters show while there is something to filter or one to lift. */}
      {(view === undefined && can.canReview && queue.length > 0) || showFilters ? (
        <div className="flex flex-wrap items-center gap-2">
          {view === undefined && can.canReview && queue.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2" data-testid="review-actions">
              <Button asChild>
                <Link
                  to="/projects/$project/review/$relation"
                  params={{ project, relation: queue[0]!.relation.id }}
                  search={filters}
                  data-testid="review-start"
                >
                  <SearchCheckIcon data-icon="inline-start" />
                  Vorschläge prüfen ({queue.length})
                </Link>
              </Button>
              {unremarkable > 0 ? (
                <Button variant="outline" onClick={() => setBulkOpen(true)} data-testid="bulk-open">
                  <CheckCheckIcon data-icon="inline-start" />
                  {unremarkable} unauffällige annehmen …
                </Button>
              ) : null}
            </div>
          ) : null}
          {showFilters ? (
            <div
              className="ml-auto flex flex-wrap items-center gap-2"
              role="search"
              aria-label="Liste filtern"
            >
              {/* A no-link has no tier: that list filters by model and stage only. */}
              {view !== 'no-links' ? (
                <Field className="w-auto gap-0">
                  <FieldLabel htmlFor="review-tier" className="sr-only">
                    {TIER_FIELD_LABEL}
                  </FieldLabel>
                  <NativeSelect
                    id="review-tier"
                    value={search.tier ?? ALL}
                    onChange={(e) =>
                      set({ tier: e.target.value === ALL ? undefined : (e.target.value as Tier) })
                    }
                  >
                    <NativeSelectOption value={ALL}>Alle Grundlagen</NativeSelectOption>
                    {TIER_ORDER.map((t) => (
                      <NativeSelectOption key={t} value={t}>
                        {TIERS[t].label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              ) : null}
              <Field className="w-auto min-w-56 gap-0">
                <FieldLabel htmlFor="review-model" className="sr-only">
                  Modell
                </FieldLabel>
                <NativeSelect
                  id="review-model"
                  className="w-full"
                  value={search.model ?? ALL}
                  onChange={(e) =>
                    set({ model: e.target.value === ALL ? undefined : e.target.value })
                  }
                >
                  <NativeSelectOption value={ALL}>Alle Modelle</NativeSelectOption>
                  {modelKeys.map((key) => (
                    <NativeSelectOption key={key} value={key}>
                      {key}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              {search.stage ? (
                // The phase chips of „Übersicht“ link here with `?stage=`: the filter stays visible.
                <Button
                  variant="outline"
                  onClick={() => set({ stage: undefined })}
                  aria-label={`Filter „Phase: ${STAGES[search.stage].label}“ entfernen`}
                  data-testid="stage-chip"
                >
                  Phase: {STAGES[search.stage].label}
                  <XIcon data-icon="inline-end" />
                </Button>
              ) : null}
              {filtered ? (
                <Button
                  variant="ghost"
                  onClick={() => set({ tier: undefined, model: undefined, stage: undefined })}
                >
                  <FilterXIcon data-icon="inline-start" />
                  Filter zurücksetzen
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {view === 'held' ? (
        <HeldList
          project={project}
          relations={held}
          resolve={resolve}
          filters={filters}
          canAnswer={can.canReview}
        />
      ) : view === 'no-links' ? (
        noLinks.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Einschätzungen konnten nicht geladen werden</AlertTitle>
            <AlertDescription>
              <ErrorText error={noLinks.error} />
            </AlertDescription>
          </Alert>
        ) : noLinks.data ? (
          <NoLinkList
            items={unlinked}
            resolve={resolve}
            filtered={filters.model !== undefined || filters.stage !== undefined}
          />
        ) : (
          <Skeleton className="h-40 w-full" />
        )
      ) : queue.length > 0 ? (
        <QueueList
          project={project}
          items={queue}
          resolve={resolve}
          filters={filters}
          revoked={autoIndex.revoked}
        />
      ) : (
        <Empty className="border bg-card py-10">
          <EmptyHeader>
            <EmptyTitle className="text-base font-semibold">
              {filtered
                ? 'Kein offener Vorschlag passt zu den Filtern'
                : 'Keine offenen Vorschläge'}
            </EmptyTitle>
            <EmptyDescription>
              Neue Vorschläge erscheinen hier, sobald ein Agent oder eine Regel sie macht.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {view === undefined && noLinks.data && noLinks.data.length > 0 ? (
        <Link
          to="/projects/$project/review"
          params={{ project }}
          search={{ ...(model ? { model } : {}), view: 'no-links' as const }}
          className={`self-start text-sm ${inline}`}
          data-testid="no-links-link"
        >
          Kein Zusammenhang laut Agent ({noLinks.data.length})
        </Link>
      ) : null}

      {bulkOpen && can.canReview ? (
        <BulkAcceptDialog
          project={project}
          rows={bulk}
          resolve={resolve}
          canOwn={can.isOwner}
          open={bulkOpen}
          onOpenChange={setBulkOpen}
        />
      ) : null}
    </div>
  );
}

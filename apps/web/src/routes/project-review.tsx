import type { Fact, Tier } from '@analyzr/client';
import { useQuery } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
import { CheckCheckIcon, FilterXIcon, MapIcon, XIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { AgentStart } from '@/components/agent-start';
import { ErrorText } from '@/components/error-text';
import { BulkAcceptDialog } from '@/components/review/bulk-accept-dialog';
import { HeldList } from '@/components/review/held-list';
import { NoLinkList } from '@/components/review/no-link-list';
import { QueueTable } from '@/components/review/queue-table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { Field, FieldLabel } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { useAutoAcceptIndex } from '@/lib/auto-accept-actions';
import { nameUsage } from '@/lib/generic-names';
import { STAGES, TIERS, TIER_ORDER } from '@/lib/labels';
import { useProjectPermissions } from '@/lib/permissions';
import { landscapeQuery, modelsQuery, noLinksQuery, valueChainQuery } from '@/lib/queries';
import {
  heldList,
  noLinkList,
  parseQueueFilters,
  proposalsByTier,
  reviewQueue,
  stageCounts,
  type QueueFilters,
} from '@/lib/review';
import { useProjectFacts } from '@/lib/use-project-facts';
import { openPlacementCount } from '@/lib/value-chain';

import { projectRoute } from './project';

interface ReviewSearch extends QueueFilters {
  /**
   * `held`: the list of held relations instead of the proposals; `no-links`:
   * the agents' no-links (read-only).
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

function ReviewInbox() {
  const { project } = projectReviewRoute.useParams();
  const search = projectReviewRoute.useSearch();
  const navigate = projectReviewRoute.useNavigate();
  const landscape = useQuery(landscapeQuery(project));
  const models = useQuery(modelsQuery(project));
  // Placements are reviewed on the value chain page; the inbox only points there (404: no chain).
  const chain = useQuery(valueChainQuery(project));
  const openPlacements = chain.data ? openPlacementCount(chain.data) : 0;
  const noLinks = useQuery(noLinksQuery(project));
  const { resolve, byModel } = useProjectFacts(project, models.data);
  const autoIndex = useAutoAcceptIndex(project);
  const can = useProjectPermissions(project);
  const [bulkTier, setBulkTier] = useState<Tier | null>(null);

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
  const relations = useMemo(() => landscape.data?.relations ?? [], [landscape.data]);
  const queue = useMemo(
    () => reviewQueue(relations, modelList, filters),
    [relations, modelList, filters],
  );
  const held = useMemo(
    () => heldList(relations, modelList, filters),
    [relations, modelList, filters],
  );
  const unlinked = useMemo(
    () => noLinkList(noLinks.data ?? [], modelList, filters),
    [noLinks.data, modelList, filters],
  );
  const counts = useMemo(() => stageCounts(modelList), [modelList]);
  const facts = useMemo<Fact[]>(() => [...byModel.values()].flatMap((f) => f.facts), [byModel]);
  const usage = useMemo(() => nameUsage(facts), [facts]);
  const groups = proposalsByTier(queue);
  const bulkItems = groups.find((g) => g.tier === bulkTier)?.items ?? [];

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

  const filtered = filters.tier !== undefined || filters.model !== undefined;
  const modelKeys = modelList.map((m) => m.key).sort();

  return (
    <div className="flex flex-col gap-5">
      {openPlacements > 0 ? (
        <Alert data-testid="placements-callout">
          <MapIcon />
          <AlertTitle>
            {openPlacements === 1
              ? `1 Platzierung wartet auf ${can.canReview ? 'deine ' : ''}Prüfung`
              : `${openPlacements} Platzierungen warten auf ${can.canReview ? 'deine ' : ''}Prüfung`}
          </AlertTitle>
          <AlertDescription>
            {can.canReview
              ? 'Platzierungen (Prozess auf Schritt) prüfst du auf der Wertschöpfungskette.'
              : 'Platzierungen (Prozess auf Schritt) stehen auf der Wertschöpfungskette.'}{' '}
            <Link
              to="/projects/$project/value-chain"
              params={{ project }}
              className="text-link underline"
            >
              Zur Wertschöpfungskette
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs
        value={search.view ?? 'proposals'}
        onValueChange={(value) =>
          set({ view: value === 'held' || value === 'no-links' ? value : undefined })
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <TabsList variant="line" aria-label="Prüfliste">
            <TabsTrigger value="proposals">
              Vorschläge <span className="tabular-nums">{queue.length}</span>
            </TabsTrigger>
            <TabsTrigger value="held">
              Vorgemerkt <span className="tabular-nums">{held.length}</span>
            </TabsTrigger>
            <TabsTrigger
              value="no-links"
              title="Paare, zwischen denen ein Agent keinen Zusammenhang sieht"
            >
              Kein Zusammenhang{' '}
              <span className="tabular-nums">{noLinks.data ? unlinked.length : '…'}</span>
            </TabsTrigger>
          </TabsList>
          {/* „Relationen“ holds both: the decisions to make here, the results one link away (UX1). */}
          <Link
            to="/projects/$project/relations"
            params={{ project }}
            className="text-sm text-link underline-offset-4 hover:underline"
            data-testid="all-relations"
          >
            Alle Relationen
          </Link>
        </div>

        <div
          className="flex flex-wrap items-end gap-3 pt-2"
          role="search"
          aria-label="Prüfliste filtern"
        >
          {/* A no-link has no tier: that tab filters by model and stage only. */}
          {search.view !== 'no-links' ? (
            <Field className="w-auto">
              <FieldLabel htmlFor="review-tier">Stufe</FieldLabel>
              <NativeSelect
                id="review-tier"
                value={search.tier ?? ALL}
                onChange={(e) =>
                  set({ tier: e.target.value === ALL ? undefined : (e.target.value as Tier) })
                }
              >
                <NativeSelectOption value={ALL}>Alle Stufen</NativeSelectOption>
                {TIER_ORDER.map((t) => (
                  <NativeSelectOption key={t} value={t}>
                    {TIERS[t].label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          <Field className="w-auto min-w-56">
            <FieldLabel htmlFor="review-model">Modell</FieldLabel>
            <NativeSelect
              id="review-model"
              className="w-full"
              value={search.model ?? ALL}
              onChange={(e) => set({ model: e.target.value === ALL ? undefined : e.target.value })}
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
          {filtered || search.stage ? (
            <Button
              variant="ghost"
              onClick={() => set({ tier: undefined, model: undefined, stage: undefined })}
            >
              <FilterXIcon data-icon="inline-start" />
              Filter zurücksetzen
            </Button>
          ) : null}
          {can.canReview && search.view === undefined && groups.length > 0 ? (
            <div
              className="ml-auto flex flex-wrap items-center gap-2"
              role="group"
              aria-label="Sammelannahme je Stufe"
            >
              {groups.map((g) => (
                <Button
                  key={g.tier}
                  variant={g.tier === 'key' ? 'default' : 'outline'}
                  onClick={() => setBulkTier(g.tier)}
                  data-testid="bulk-open"
                  data-tier={g.tier}
                >
                  <CheckCheckIcon data-icon="inline-start" />
                  {TIERS[g.tier].label}: {g.items.length} annehmen…
                </Button>
              ))}
            </div>
          ) : null}
        </div>

        <TabsContent value="proposals" className="pt-2">
          {queue.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <QueueTable
                project={project}
                items={queue}
                resolve={resolve}
                filters={filters}
                revoked={autoIndex.revoked}
              />
            </div>
          ) : (
            <Empty className="border bg-card py-10">
              <EmptyHeader>
                <EmptyTitle className="text-base font-semibold">
                  {filtered || search.stage
                    ? 'Kein offener Vorschlag passt zu den Filtern'
                    : 'Keine offenen Vorschläge'}
                </EmptyTitle>
                <EmptyDescription>
                  {counts.waiting_for_agent > 0
                    ? `${counts.waiting_for_agent} ${counts.waiting_for_agent === 1 ? 'Modell wartet' : 'Modelle warten'} auf einen Agenten. ${
                        can.isOwner
                          ? 'Verbinde einen Agenten, der die Analyse-Pipeline abarbeitet; seine Vorschläge erscheinen hier.'
                          : 'Sobald ein Agent die Analyse-Pipeline abarbeitet, erscheinen seine Vorschläge hier.'
                      }`
                    : 'Alles geprüft. Neue Vorschläge erscheinen hier, sobald ein Agent oder eine Regel sie macht.'}
                </EmptyDescription>
              </EmptyHeader>
              {can.isOwner && counts.waiting_for_agent > 0 ? (
                <EmptyContent>
                  <AgentStart
                    project={project}
                    hasChain={chain.data !== undefined}
                    variant="outline"
                    align="start"
                  />
                </EmptyContent>
              ) : null}
            </Empty>
          )}
        </TabsContent>
        <TabsContent value="held" className="pt-2">
          <HeldList
            project={project}
            relations={held}
            resolve={resolve}
            filters={filters}
            canAnswer={can.canReview}
          />
        </TabsContent>
        <TabsContent value="no-links" className="pt-2">
          {noLinks.isError ? (
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
          )}
        </TabsContent>
      </Tabs>

      {bulkTier && can.canReview ? (
        <BulkAcceptDialog
          project={project}
          tier={bulkTier}
          relations={bulkItems}
          resolve={resolve}
          usage={usage}
          open={bulkTier !== null}
          onOpenChange={(open) => {
            if (!open) setBulkTier(null);
          }}
        />
      ) : null}
    </div>
  );
}

import type { Fact, Model } from '@analyzr/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
import { cn } from 'cn';
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  InfoIcon,
  LocateIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { lazy, Suspense, useMemo, useState } from 'react';

import { EngineBadge, StageBadge } from '@/components/badges';
import { CanvasPanel } from '@/components/canvas-panel';
import { ErrorText } from '@/components/error-text';
import { LightPopover } from '@/components/light-popover';
import { MiragonMark } from '@/components/page-shell';
import { DecisionPanel, type DecisionOutcome } from '@/components/review/decision-panel';
import { ReviewDetails } from '@/components/review/review-details';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ApiError } from '@/lib/api';
import { useAutoAcceptIndex } from '@/lib/auto-accept-actions';
import type { CanvasHighlight } from '@/lib/bpmn-elements';
import { useCanvasSheet } from '@/lib/canvas-sheet';
import { formatConfidence } from '@/lib/labels';
import { useMediaQuery } from '@/lib/media';
import { useProjectPermissions } from '@/lib/permissions';
import {
  assertionsQuery,
  contentQuery,
  keys,
  landscapeQuery,
  modelsQuery,
  relationQuery,
} from '@/lib/queries';
import { splitRef } from '@/lib/refs';
import {
  RESULT_VIEW_LABELS,
  filterRelations,
  parseRelationFilters,
  resultViewOf,
  type RelationFilters,
} from '@/lib/relation-filters';
import {
  heldList,
  neighbours,
  parseQueueFilters,
  reviewQueue,
  sideName,
  type QueueFilters,
} from '@/lib/review';
import { toast } from '@/lib/toast';
import { useProjectFacts } from '@/lib/use-project-facts';
import { useShortcuts } from '@/lib/use-shortcuts';

import { rootRoute } from './root';

const BpmnCanvas = lazy(() => import('@/components/bpmn-canvas'));
/**
 * A held relation's answer in the decision grid (UX2b, UX5): the note dialog
 * of „Offene Fragen“, loaded with the open-questions modules on first render.
 */
const HoldAnswer = lazy(() => import('@/components/open-questions/hold-answer'));

type PaneMode = 'both' | 'from' | 'to';

interface ReviewScreenSearch extends QueueFilters, Omit<RelationFilters, 'tier' | 'model'> {
  /** Only one endpoint's model (narrow screens start with `from`). */
  pane?: 'from' | 'to';
  /** `held`: opened from the held list; J/K walk it and „Vorgemerkt“ returns to it. */
  view?: 'held';
  /**
   * Opened from „Offene Fragen“ (a hold's „Jetzt entscheiden“, owner decision 26 Q4): the back
   * link and the end of the list lead back there (UX5). Opened from a result view of
   * „Relationen“ (a row's „Öffnen“, UX9) with its filters (`status`, `tier`, `type`, `model`,
   * `auto`): J/K walk that list, the back link returns to it, a decision stays on the relation.
   */
  from?: 'open-questions' | 'relations';
}

/**
 * The review screen of one relation (M2 item 7, `reviewUrl` of
 * `human-decision-required`): both endpoint models in bpmn-js side by side
 * (or one at a time), the details and history in the panel, the decision at
 * its foot. J/K (or the arrow keys) walk the inbox queue with its filters.
 */
export const reviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$project/review/$relation',
  validateSearch: (search: Record<string, unknown>): ReviewScreenSearch => ({
    ...(search['from'] === 'relations'
      ? { ...parseRelationFilters(search), from: 'relations' as const }
      : {
          ...parseQueueFilters(search),
          ...(search['view'] === 'held' ? { view: 'held' as const } : {}),
          ...(search['from'] === 'open-questions' ? { from: 'open-questions' as const } : {}),
        }),
    ...(search['pane'] === 'from' || search['pane'] === 'to' ? { pane: search['pane'] } : {}),
  }),
  component: ReviewScreen,
});

/** Side by side needs room; from 1024 px to 1279 px the panes stack instead (UX5). */
const SIDE_BY_SIDE = '(min-width: 1280px)';

interface FocusTarget {
  modelKey: string;
  elementId: string;
}

/** A pane's chip (UX5): „Von“ or „Nach“, the process name and „Im Modell“; key, engine and stage behind the info. */
function PaneChip({
  project,
  relationId,
  title,
  name,
  model,
}: {
  project: string;
  relationId: string;
  title: string;
  name: string;
  model: Model;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="absolute bottom-4 left-4 z-30 flex max-w-[calc(100%-96px)] items-center gap-2 rounded-xl border bg-card/90 px-3 py-1.5 text-sm shadow-sm backdrop-blur-sm"
      data-testid="pane-chip"
    >
      <span className="font-semibold">{title}</span>
      <span className="min-w-0 truncate" title={name}>
        {name}
      </span>
      <LightPopover
        open={open}
        onOpenChange={setOpen}
        label={`Angaben zu ${model.key}`}
        align="start"
        className="bottom-full top-auto mt-0 mb-1 p-2"
        trigger={(props) => (
          <Button
            {...props}
            variant="ghost"
            size="icon-xs"
            aria-label={`Angaben zum Modell von „${title}“`}
          >
            <InfoIcon />
          </Button>
        )}
      >
        <div className="flex flex-col gap-1.5" data-testid="pane-chip-details">
          <span className="font-mono text-[13px]">{model.key}</span>
          <span className="flex flex-wrap gap-1.5">
            <EngineBadge engine={model.engine} />
            <StageBadge stage={model.stage} />
          </span>
        </div>
      </LightPopover>
      <Button variant="ghost" size="xs" asChild>
        <Link
          to="/projects/$project/models/$"
          params={{ project, _splat: model.key }}
          search={{ relation: relationId }}
        >
          <LocateIcon data-icon="inline-start" />
          Im Modell
        </Link>
      </Button>
    </div>
  );
}

function Pane({
  project,
  relationId,
  side,
  modelKey,
  model,
  name,
  highlights,
  focus,
}: {
  project: string;
  relationId: string;
  side: 'from' | 'to' | 'both';
  /** Key of the endpoint's model, from the ref (the model may be deleted). */
  modelKey: string;
  model: Model | undefined;
  /** The endpoint's process, for the chip. */
  name: string;
  highlights: CanvasHighlight[];
  focus: string | null;
}) {
  const content = useQuery({
    ...contentQuery({
      project,
      modelId: model?.id ?? '',
      revisionId: model?.headRevisionId ?? '',
    }),
    enabled: model !== undefined,
  });
  const title = side === 'from' ? 'Von' : side === 'to' ? 'Nach' : 'Von und Nach';
  return (
    <section
      aria-label={`${title}: ${modelKey}`}
      data-testid="review-pane"
      data-side={side}
      className="relative min-h-0 min-w-0 flex-1 border-border not-last:border-b xl:not-last:border-r xl:not-last:border-b-0"
    >
      {content.data ? (
        <Suspense
          fallback={
            <div className="absolute inset-0 grid place-items-center">
              <Spinner />
            </div>
          }
        >
          <BpmnCanvas
            xml={content.data.xml}
            highlights={highlights}
            focus={focus}
            onImportError={(message) =>
              toast({
                tone: 'danger',
                title: 'Diagramm konnte nicht angezeigt werden',
                description: message,
              })
            }
          />
        </Suspense>
      ) : content.isError ? (
        <div className="absolute inset-x-4 top-1/3 z-20">
          <Alert variant="destructive">
            <AlertTitle>Modell konnte nicht geladen werden</AlertTitle>
            <AlertDescription>
              <ErrorText error={content.error} />
            </AlertDescription>
          </Alert>
        </div>
      ) : !model ? (
        <div className="absolute inset-x-4 top-1/3 z-20" data-testid="pane-missing-model">
          <Alert>
            <TriangleAlertIcon />
            <AlertTitle>
              {title}: Modell „{modelKey}“ gibt es nicht mehr
            </AlertTitle>
            <AlertDescription>
              Das Modell wurde gelöscht, der Endpunkt fehlt. Lehne die Relation ab oder korrigiere
              sie.
            </AlertDescription>
          </Alert>
        </div>
      ) : (
        <div className="absolute inset-0 grid place-items-center">
          <Spinner className="size-6" />
        </div>
      )}
      {model ? (
        <PaneChip
          project={project}
          relationId={relationId}
          title={title}
          name={name}
          model={model}
        />
      ) : null}
    </section>
  );
}

function ReviewScreen() {
  const { project, relation: relationId } = reviewRoute.useParams();
  const search = reviewRoute.useSearch();
  const navigate = reviewRoute.useNavigate();
  const queryClient = useQueryClient();
  const sheet = useCanvasSheet();
  const sideBySide = useMediaQuery(SIDE_BY_SIDE);
  // A cited element belongs to one relation: another relation (J/K, a link,
  // the browser history) starts without it.
  const [cited, setCited] = useState<(FocusTarget & { relationId: string }) | null>(null);
  const evidence = cited?.relationId === relationId ? cited : null;

  const relationQ = useQuery(relationQuery(project, relationId));
  const assertions = useQuery(assertionsQuery(project, relationId));
  const landscape = useQuery(landscapeQuery(project));
  const models = useQuery(modelsQuery(project));
  const { resolve, byModel } = useProjectFacts(project, models.data);
  const can = useProjectPermissions(project);
  const owner = can.isOwner;
  const reviewer = can.canReview;
  const autoIndex = useAutoAcceptIndex(project);
  const facts = useMemo<Fact[]>(() => [...byModel.values()].flatMap((f) => f.facts), [byModel]);
  const modelKeys = useMemo(() => new Set((models.data ?? []).map((m) => m.key)), [models.data]);

  const { stage, tier, model: modelFilter, status, type, auto } = search;
  const filters = useMemo<QueueFilters>(
    () => ({
      ...(stage ? { stage } : {}),
      ...(tier ? { tier } : {}),
      ...(modelFilter ? { model: modelFilter } : {}),
    }),
    [stage, tier, modelFilter],
  );
  const held = search.view === 'held';
  const fromQuestions = search.from === 'open-questions';
  // A result view's filters (UX9): its rows in its order, and its way back.
  const results = useMemo<RelationFilters | null>(
    () =>
      search.from === 'relations'
        ? {
            ...(status ? { status } : {}),
            ...(tier ? { tier } : {}),
            ...(type ? { type } : {}),
            ...(modelFilter ? { model: modelFilter } : {}),
            ...(auto ? { auto } : {}),
          }
        : null,
    [search.from, status, tier, type, modelFilter, auto],
  );
  const queue = useMemo(
    () =>
      results
        ? filterRelations(landscape.data?.relations ?? [], results, autoIndex).map((relation) => ({
            relation,
            finishes: 0,
          }))
        : held
          ? heldList(landscape.data?.relations ?? [], models.data ?? [], filters).map(
              (relation) => ({ relation, finishes: 0 }),
            )
          : reviewQueue(landscape.data?.relations ?? [], models.data ?? [], filters),
    [results, autoIndex, held, landscape.data, models.data, filters],
  );
  const queueSearch = useMemo(
    () => ({ ...filters, ...(held ? { view: 'held' as const } : {}) }),
    [filters, held],
  );
  const listSearch = results ?? queueSearch;
  const nav = neighbours(queue, relationId);

  const relation = relationQ.data;
  const from = relation ? splitRef(relation.from) : null;
  const to = relation ? splitRef(relation.to) : null;
  const sameModel = from !== null && to !== null && from.modelKey === to.modelKey;
  // Both panes from 1024 px (side by side from 1280, stacked below); on a phone one at a time.
  const mode: PaneMode = sameModel ? 'both' : (search.pane ?? (sheet.wide ? 'both' : 'from'));
  const modelOf = (key: string | undefined) => models.data?.find((m) => m.key === key);
  /** Models with a pane on this screen: evidence into them is shown there. */
  const paneModels = new Set(from && to ? [from.modelKey, to.modelKey] : []);
  const origin = results
    ? { from: 'relations' as const }
    : fromQuestions
      ? { from: 'open-questions' as const }
      : {};
  const keep = { ...(search.pane ? { pane: search.pane } : {}), ...origin };

  const goTo = (id: string) => {
    void navigate({
      to: '/projects/$project/review/$relation',
      params: { project, relation: id },
      search: { ...listSearch, ...keep },
    });
  };
  const toList = () =>
    fromQuestions
      ? void navigate({ to: '/projects/$project/open-questions', params: { project } })
      : void navigate({
          to: '/projects/$project/review',
          params: { project },
          search: queueSearch,
        });

  /** Shows a cited element; switches to its pane when only the other one is shown. */
  const showEvidence = (target: FocusTarget) => {
    setCited({ ...target, relationId });
    if (!from || !to || sameModel || mode === 'both') return;
    const side = target.modelKey === from.modelKey ? 'from' : 'to';
    if (side !== mode) {
      void navigate({ search: { ...listSearch, ...keep, pane: side }, replace: true });
    }
  };

  useShortcuts({
    j: () => nav.next && goTo(nav.next.id),
    ArrowRight: () => nav.next && goTo(nav.next.id),
    k: () => nav.previous && goTo(nav.previous.id),
    ArrowLeft: () => nav.previous && goTo(nav.previous.id),
  });

  function onDecided(outcome: DecisionOutcome) {
    // not from the queue (held, decided) or from a result view: stay and show the result
    if (nav.index < 0 || results) return;
    if (nav.next) goTo(nav.next.id);
    else {
      toast({
        tone: 'info',
        title: 'Liste abgearbeitet',
        description: fromQuestions
          ? 'Zurück zu „Offene Fragen“.'
          : held
            ? 'In dieser Liste ist nichts mehr vorgemerkt.'
            : outcome === 'hold'
              ? 'Vorgemerkte Relationen findest du unter „Vorgemerkt“.'
              : 'In dieser Liste ist kein Vorschlag mehr offen.',
      });
      toList();
    }
  }

  const highlightsFor = (modelKey: string): CanvasHighlight[] => {
    if (!from || !to) return [];
    const out: CanvasHighlight[] = [];
    if (from.modelKey === modelKey)
      out.push({ elementId: from.elementId, label: 'Von', tone: 'endpoint' });
    if (to.modelKey === modelKey)
      out.push({ elementId: to.elementId, label: 'Nach', tone: 'endpoint' });
    if (
      evidence &&
      evidence.modelKey === modelKey &&
      !out.some((h) => h.elementId === evidence.elementId)
    ) {
      out.push({ elementId: evidence.elementId, label: 'Beleg', tone: 'evidence' });
    }
    return out;
  };
  const focusFor = (modelKey: string, own: string | null): string | null =>
    evidence?.modelKey === modelKey ? evidence.elementId : own;

  const notFound = relationQ.error instanceof ApiError && relationQ.error.status === 404;
  const loadError = relationQ.error ?? models.error ?? landscape.error;
  const fromName = relation ? sideName(resolve(relation.from)) : '';
  const toName = relation ? sideName(resolve(relation.to)) : '';
  const back = results
    ? RESULT_VIEW_LABELS[resultViewOf(results)]
    : fromQuestions
      ? 'Offene Fragen'
      : held
        ? 'Vorgemerkt'
        : 'Zu prüfen';
  // J/K walk proposals in the queue, relations in a result view.
  const [previousLabel, nextLabel] = results
    ? ['Vorherige Relation (K)', 'Nächste Relation (J)']
    : ['Vorheriger Vorschlag (K)', 'Nächster Vorschlag (J)'];

  const header = (
    <>
      {sheet.wide ? (
        <Link to="/" aria-label="Zu den Projekten" className="px-1">
          <MiragonMark className="size-5" />
        </Link>
      ) : null}
      <Button variant="ghost" size="sm" asChild>
        {results ? (
          <Link
            to="/projects/$project/relations"
            params={{ project }}
            search={results}
            data-testid="review-back"
          >
            <ArrowLeftIcon data-icon="inline-start" />
            {back}
          </Link>
        ) : fromQuestions ? (
          <Link
            to="/projects/$project/open-questions"
            params={{ project }}
            data-testid="review-back"
          >
            <ArrowLeftIcon data-icon="inline-start" />
            {back}
          </Link>
        ) : (
          <Link
            to="/projects/$project/review"
            params={{ project }}
            search={queueSearch}
            data-testid="review-back"
          >
            <ArrowLeftIcon data-icon="inline-start" />
            {back}
          </Link>
        )}
      </Button>
      <span className="text-muted-foreground tabular-nums" data-testid="queue-position">
        {nav.index >= 0
          ? `${nav.index + 1} von ${queue.length}`
          : results
            ? 'nicht in der Liste'
            : queue.length > 0
              ? `nicht in der Liste (${queue.length} offen)`
              : held
                ? 'nichts vorgemerkt'
                : 'keine offenen Vorschläge'}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={previousLabel}
          title={previousLabel}
          disabled={!nav.previous}
          onClick={() => nav.previous && goTo(nav.previous.id)}
          data-testid="review-previous"
        >
          <ChevronLeftIcon />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={nextLabel}
          title={nextLabel}
          disabled={!nav.next}
          onClick={() => nav.next && goTo(nav.next.id)}
          data-testid="review-next"
        >
          <ChevronRightIcon />
        </Button>
      </div>
      {relation && !sameModel ? (
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          value={mode}
          aria-label="Diagramme"
          onValueChange={(value) => {
            if (value !== 'both' && value !== 'from' && value !== 'to') return;
            void navigate({
              search: {
                ...listSearch,
                ...origin,
                ...(value === 'both' ? {} : { pane: value }),
              },
              replace: true,
            });
          }}
        >
          {sheet.wide ? (
            <ToggleGroupItem value="both">{sideBySide ? 'Nebeneinander' : 'Beide'}</ToggleGroupItem>
          ) : null}
          <ToggleGroupItem value="from">Von</ToggleGroupItem>
          <ToggleGroupItem value="to">Nach</ToggleGroupItem>
        </ToggleGroup>
      ) : null}
    </>
  );

  return (
    <div
      className="relative h-app-viewport w-full overflow-hidden bg-paper bg-[radial-gradient(var(--cd-linie)_1px,transparent_1px)] [background-size:16px_16px]"
      data-testid="review-screen"
    >
      {relation && from && to && models.data ? (
        <div
          className={cn(
            'absolute inset-x-0 top-0 flex',
            sheet.wide ? 'right-[468px]' : 'top-14',
            sideBySide ? 'flex-row' : 'flex-col',
          )}
          style={{ bottom: sheet.inset }}
          data-testid="review-canvas"
        >
          {mode === 'both' && sameModel ? (
            <Pane
              project={project}
              relationId={relation.id}
              side="both"
              modelKey={from.modelKey}
              model={modelOf(from.modelKey)}
              name={fromName === toName ? fromName : `${fromName} · ${toName}`}
              highlights={highlightsFor(from.modelKey)}
              focus={focusFor(from.modelKey, from.elementId)}
            />
          ) : null}
          {!sameModel && (mode === 'both' || mode === 'from') ? (
            <Pane
              key={`from:${from.modelKey}`}
              project={project}
              relationId={relation.id}
              side="from"
              modelKey={from.modelKey}
              model={modelOf(from.modelKey)}
              name={fromName}
              highlights={highlightsFor(from.modelKey)}
              focus={focusFor(from.modelKey, from.elementId)}
            />
          ) : null}
          {!sameModel && (mode === 'both' || mode === 'to') ? (
            <Pane
              key={`to:${to.modelKey}`}
              project={project}
              relationId={relation.id}
              side="to"
              modelKey={to.modelKey}
              model={modelOf(to.modelKey)}
              name={toName}
              highlights={highlightsFor(to.modelKey)}
              focus={focusFor(to.modelKey, to.elementId)}
            />
          ) : null}
        </div>
      ) : null}

      {/* where am I, the queue position, the panes: a floating card, on a phone a top bar */}
      <header
        className={cn(
          'absolute z-30 flex flex-wrap items-center gap-2 text-sm',
          sheet.wide
            ? 'top-4 left-4 max-w-[calc(100vw-516px)] rounded-xl border bg-card/90 p-2 shadow-md backdrop-blur-sm'
            : 'inset-x-0 top-0 min-h-14 border-b bg-card/95 px-2 py-2 shadow-sm backdrop-blur-sm',
        )}
        data-testid="review-header"
      >
        {header}
      </header>

      <CanvasPanel
        sheet={sheet}
        label="Prüfung"
        size="wide"
        summary={
          relation
            ? `${fromName} → ${toName} · ${formatConfidence(relation.confidence)}`
            : 'Prüfung'
        }
        testId="review-panel"
        footer={
          relation ? (
            <div className="flex flex-col gap-2 border-t bg-card p-4">
              {reviewer ? (
                <DecisionPanel
                  project={project}
                  relation={relation}
                  resolve={resolve}
                  facts={facts}
                  onDecided={onDecided}
                  onFormOpen={() => sheet.setExpanded(true)}
                  onReload={() =>
                    void queryClient.invalidateQueries({ queryKey: keys.project(project) })
                  }
                  holdAnswer={
                    <Suspense fallback={null}>
                      <HoldAnswer
                        project={project}
                        subject={{ type: 'relation', id: relation.id }}
                        size="default"
                        className="justify-start"
                      />
                    </Suspense>
                  }
                />
              ) : can.known ? (
                // Viewers and the read-only demo: no decision panel, so A/R/H/C do nothing.
                <p
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                  data-testid="read-only-review"
                >
                  <EyeIcon className="size-4 shrink-0" aria-hidden />
                  {can.demo
                    ? 'Nur lesen – in der Demo entscheidest du nicht.'
                    : 'Nur lesen – entscheiden dürfen Bearbeiter und Inhaber.'}
                </p>
              ) : null}
              <p className="flex items-center gap-1 text-xs text-muted-foreground [@media(hover:none)]:hidden">
                <Kbd>J</Kbd>
                <Kbd>K</Kbd> weiter, zurück
              </p>
            </div>
          ) : null
        }
      >
        {relation ? (
          <ReviewDetails
            project={project}
            relation={relation}
            assertions={assertions.data}
            resolve={resolve}
            modelKeys={modelKeys}
            paneModels={paneModels}
            onEvidence={(item) =>
              showEvidence({ modelKey: item.modelKey, elementId: item.elementId })
            }
            autoAccept={
              reviewer
                ? {
                    entries: autoIndex.bySubject.get(relation.id) ?? [],
                    marks: autoIndex.byAssertion,
                    canRevoke: owner,
                  }
                : undefined
            }
          />
        ) : notFound ? (
          <Alert>
            <AlertTitle>Relation nicht gefunden</AlertTitle>
            <AlertDescription>
              Es gibt sie in „{project}“ nicht, oder du hast keinen Zugriff.{' '}
              <Link
                to="/projects/$project/review"
                params={{ project }}
                className="text-link underline"
              >
                Zu prüfen
              </Link>
            </AlertDescription>
          </Alert>
        ) : loadError ? (
          <Alert variant="destructive">
            <AlertTitle>Prüfung konnte nicht geladen werden</AlertTitle>
            <AlertDescription>
              <ErrorText error={loadError} />
            </AlertDescription>
          </Alert>
        ) : (
          <div className="grid h-full place-items-center">
            <Spinner className="size-6" />
          </div>
        )}
      </CanvasPanel>
    </div>
  );
}

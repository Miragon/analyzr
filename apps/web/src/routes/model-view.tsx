import type { Fact, Model, OpenQuestion, Relation } from '@analyzr/client';
import { useQuery } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
import { cn } from 'cn';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowRightLeftIcon,
  InfoIcon,
  SearchCheckIcon,
  SparklesIcon,
  XIcon,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useId, useMemo, useState, type ReactNode } from 'react';

import { StageBadge, StatusBadge, ToneBadge, TYPE_ICONS } from '@/components/badges';
import { CanvasHeader } from '@/components/canvas-header';
import { CanvasPanel, PanelTabPanel, PanelTabs } from '@/components/canvas-panel';
import { ErrorText } from '@/components/error-text';
import { LightPopover } from '@/components/light-popover';
import { toast } from '@/lib/toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';

import type { CanvasHighlight } from '@/lib/bpmn-elements';
import { useCanvasSheet } from '@/lib/canvas-sheet';
import { collapsedSubprocess } from '@/lib/collapsed-subprocess';
import { RELATION_TYPES, formatConfidence } from '@/lib/labels';
import { derivedChip, importLossOf } from '@/lib/provenance';
import {
  contentQuery,
  landscapeQuery,
  modelOpenQuestionsQuery,
  modelsQuery,
  projectQuery,
} from '@/lib/queries';
import { splitRef, type RefLabel, type RefResolver } from '@/lib/refs';
import { useProjectPermissions } from '@/lib/permissions';
import { touchesModel } from '@/lib/relation-filters';
import { useProjectFacts } from '@/lib/use-project-facts';

import { rootRoute } from './root';

const BpmnCanvas = lazy(() => import('@/components/bpmn-canvas'));
/** The section „Fragen“ (M6 S4; UX2b: „Zu klären“ only), loaded with the panel, never with the entry. */
const ModelQuestions = lazy(() => import('@/components/open-questions/model-questions'));
/**
 * „Verknüpfen mit …“ on a selected collapsed subprocess (M6 S5c-1), from the
 * same lazy module as the section, so it adds no chunk of its own.
 */
const SubprocessLink = lazy(() =>
  import('@/components/open-questions/model-questions').then((m) => ({
    default: m.SubprocessLink,
  })),
);
/**
 * Model amendments (M6 S5c-2): the section „Ergänzen“ for the selected
 * element and the header's badge and „Mehr“, all from one lazy module (one
 * chunk), never with the entry.
 */
const AmendSection = lazy(() => import('@/components/amendments/model-amendments'));
const ModelAmendBadge = lazy(() =>
  import('@/components/amendments/model-amendments').then((m) => ({
    default: m.ModelAmendBadge,
  })),
);
/** „Mehr“ (UX3): „Herkunft“, „Revisionen“, the downloads, from the amendments' lazy module. */
const ModelMore = lazy(() =>
  import('@/components/amendments/model-amendments').then((m) => ({ default: m.ModelMore })),
);

/** Fact kinds an amendment can write a field of (M6 §4.8 c); other elements never ask the server. */
const AMENDABLE_KINDS: ReadonlySet<Fact['kind']> = new Set([
  'process',
  'call',
  'msg_throw',
  'msg_catch',
  'sig_throw',
  'sig_catch',
  'evt_start',
  'evt_end',
]);

interface ModelViewSearch {
  /** Selected relation (`rel_…`): its endpoints are highlighted. */
  relation?: string;
  /** Selected element id, e.g. from a finding or a click on the canvas. */
  element?: string;
}

export const modelViewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$project/models/$',
  validateSearch: (search: Record<string, unknown>): ModelViewSearch => {
    const out: ModelViewSearch = {};
    if (typeof search['relation'] === 'string' && search['relation'] !== '')
      out.relation = search['relation'];
    if (typeof search['element'] === 'string' && search['element'] !== '')
      out.element = search['element'];
    return out;
  },
  component: ModelView,
});

function shortLabel(label: RefLabel): string {
  return label.label ?? label.elementId;
}

/** The relation as seen from the model in view: local end, remote end, direction. */
function perspective(relation: Relation, modelKey: string, resolve: RefResolver) {
  const outgoing = splitRef(relation.from).modelKey === modelKey;
  const local = resolve(outgoing ? relation.from : relation.to);
  const remote = resolve(outgoing ? relation.to : relation.from);
  return { outgoing, local, remote };
}

/**
 * A relation card (UX-SIMPLIFICATION.md §3.5 item 3): the element in this
 * model and the status; below the arrow (its direction) to the other end,
 * „→ Kreditprüfung · finanzen/kreditpruefung“, the type by its icon and in
 * the accessible name; the confidence only on a proposal. Selected: the
 * switch to the other model and „Prüfen“.
 */
function RelationItem({
  relation,
  modelKey,
  resolve,
  selected,
  project,
}: {
  relation: Relation;
  modelKey: string;
  resolve: RefResolver;
  selected: boolean;
  project: string;
}) {
  const { outgoing, local, remote } = perspective(relation, modelKey, resolve);
  const TypeIcon = TYPE_ICONS[relation.type];
  const type = RELATION_TYPES[relation.type].label;
  const direction = outgoing ? 'ausgehend' : 'eingehend';
  const sameModel = remote.modelKey === modelKey;
  return (
    <li
      data-testid="model-relation"
      data-relation-id={relation.id}
      data-selected={selected}
      className={cn(
        'rounded-lg border transition-colors',
        selected ? 'border-primary bg-accent' : 'border-transparent hover:bg-muted',
      )}
    >
      <Link
        from={modelViewRoute.fullPath}
        to="."
        search={selected ? {} : { relation: relation.id }}
        replace
        aria-current={selected ? 'true' : undefined}
        aria-label={`${type}, ${direction}: ${shortLabel(local)} ${outgoing ? 'nach' : 'von'} ${shortLabel(remote)} (${remote.modelKey})`}
        title={`${type}, ${direction}`}
        className="flex flex-col gap-0.5 rounded-lg p-2.5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <TypeIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-medium">{shortLabel(local)}</span>
          <StatusBadge status={relation.status} />
        </span>
        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          {outgoing ? (
            <ArrowRightIcon className="size-3.5 shrink-0" aria-hidden />
          ) : (
            <ArrowLeftIcon className="size-3.5 shrink-0" aria-hidden />
          )}
          <span className="min-w-0 truncate">
            {shortLabel(remote)} · <span className="font-mono">{remote.modelKey}</span>
          </span>
          {relation.status === 'proposed' && relation.confidence !== null ? (
            <span className="ml-auto shrink-0 tabular-nums">
              {formatConfidence(relation.confidence)}
            </span>
          ) : null}
        </span>
      </Link>
      {selected && local.kind === 'process' ? (
        <p className="px-2.5 pb-2 text-xs text-muted-foreground">
          Endpunkt in diesem Modell ist der Prozess „{shortLabel(local)}“ als Ganzes.
        </p>
      ) : null}
      {selected ? (
        <div className="flex gap-2 px-2.5 pb-2.5">
          {!sameModel ? (
            <Button size="sm" asChild className="min-w-0 flex-1">
              <Link
                to="/projects/$project/models/$"
                params={{ project, _splat: remote.modelKey }}
                search={{ relation: relation.id }}
                data-testid="switch-model"
              >
                <ArrowRightLeftIcon data-icon="inline-start" />
                <span className="truncate">Zu {remote.modelKey} wechseln</span>
              </Link>
            </Button>
          ) : null}
          <Button size="sm" variant="outline" asChild>
            <Link
              to="/projects/$project/review/$relation"
              params={{ project, relation: relation.id }}
              data-testid="review-relation"
            >
              <SearchCheckIcon data-icon="inline-start" />
              Prüfen
            </Link>
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/** The legend of the canvas marks (§3.5 item 7). */
function Legend() {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-3 w-4 rounded-sm border-2 border-primary" />
        gewählter Endpunkt
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden
          className="inline-block h-3 w-4 rounded-sm border-2 border-dashed border-link"
        />
        hat Relationen
      </span>
      <span>Klick auf ein Element filtert die Liste.</span>
    </span>
  );
}

/** After the first click on an element the legend moves behind this button at the zoom controls. */
function LegendButton() {
  const [open, setOpen] = useState(false);
  return (
    <LightPopover
      open={open}
      onOpenChange={setOpen}
      label="Legende"
      align="end"
      testId="legend-popover"
      trigger={(props) => (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Legende"
          title="Legende"
          data-testid="legend-button"
          {...props}
        >
          <InfoIcon />
        </Button>
      )}
    >
      <div className="w-60 p-2">
        <Legend />
      </div>
    </LightPopover>
  );
}

/** The amendment fields an open question of the element offers (`op:elementId`), for „Ergänzen“. */
function coveredFields(questions: readonly OpenQuestion[], elementId: string): Set<string> {
  const out = new Set<string>();
  for (const q of questions) {
    if (q.state !== 'open' || q.group !== 'ask') continue;
    for (const a of q.actions) {
      for (const t of a.amend?.targets ?? []) {
        if (t.elementId === elementId) out.add(`${t.op}:${t.elementId}`);
      }
    }
  }
  return out;
}

/** Shows a question's card in the panel's „Fragen“ and moves the focus there. */
function showQuestion(id: string) {
  const card = document.querySelector<HTMLElement>(
    `[data-testid=open-question][data-question-id="${CSS.escape(id)}"]`,
  );
  card?.scrollIntoView({ block: 'center' });
  card?.focus();
}

/** S2a's derived chip in the header (UX8): only for a file that is no plain export. */
function DerivedChip({ source }: { source: Model['source'] }) {
  const chip = derivedChip(source);
  if (!chip) return null;
  return (
    <span data-testid="model-derived">
      <ToneBadge tone="warning" icon={SparklesIcon} title={chip.hint}>
        {chip.label}
      </ToneBadge>
    </span>
  );
}

/**
 * „Beim Import übersprungen: 2 Elemente – Details“ (UX8, §3.5 item 8): from
 * the model's open question „Elemente beim Import verloren“; „Details“ shows
 * its card in „Fragen“ (the same query as the section).
 */
function ImportLoss({ project, modelKey }: { project: string; modelKey: string }) {
  const questions = useQuery(modelOpenQuestionsQuery(project, modelKey));
  const loss = importLossOf(questions.data ?? [], modelKey);
  if (!loss) return null;
  return (
    <p className="text-xs text-warning" data-testid="model-import-loss">
      {loss.text} –{' '}
      <button
        type="button"
        className="text-link underline-offset-4 hover:underline"
        onClick={() => showQuestion(loss.questionId)}
      >
        Details
      </button>
    </p>
  );
}

type PanelTab = 'questions' | 'relations';

function ModelView() {
  const { project, _splat } = modelViewRoute.useParams();
  const modelKey = (_splat ?? '').replace(/\/+$/, '');
  const search = modelViewRoute.useSearch();
  const navigate = modelViewRoute.useNavigate();
  const sheet = useCanvasSheet();
  const tabsId = useId();

  const info = useQuery(projectQuery(project));
  const models = useQuery(modelsQuery(project));
  const landscape = useQuery(landscapeQuery(project));
  const model = models.data?.find((m) => m.key === modelKey);
  const content = useQuery({
    ...contentQuery({
      project,
      modelId: model?.id ?? '',
      revisionId: model?.headRevisionId ?? '',
    }),
    enabled: model !== undefined,
  });
  const questions = useQuery({ ...modelOpenQuestionsQuery(project, modelKey), enabled: !!model });
  const { resolve, byModel } = useProjectFacts(project, models.data);
  const amendableSelected =
    search.element !== undefined &&
    (byModel
      .get(modelKey)
      ?.facts.some((f) => f.elementId === search.element && AMENDABLE_KINDS.has(f.kind)) ??
      false);
  // A selected collapsed subprocess offers „Verknüpfen mit …“ under „Fragen“ (M6 S5c-1).
  const permissions = useProjectPermissions(project);
  const xml = content.data?.xml;
  const linkableSelected = useMemo(
    () =>
      permissions.canReview &&
      search.element !== undefined &&
      xml !== undefined &&
      collapsedSubprocess(xml, search.element) !== null,
    [permissions.canReview, search.element, xml],
  );
  // The elements the head's applied amendments wrote (the overlay „ergänzt“), as the header reports them.
  const [amendedOf, setAmendedOf] = useState<{ modelId: string; ids: readonly string[] } | null>(
    null,
  );
  const modelId = model?.id;
  const onAmended = useCallback(
    (ids: readonly string[]) => {
      if (modelId) setAmendedOf({ modelId, ids });
    },
    [modelId],
  );
  const amended = useMemo(
    () => (amendedOf && amendedOf.modelId === modelId ? amendedOf.ids : []),
    [amendedOf, modelId],
  );
  /** The questions „Fragen“ shows (from its lazy module), for the tab and the handle, per selected element. */
  const counting = `${modelKey}#${search.element ?? ''}`;
  const [counted, setCounted] = useState<{ counting: string; count: number } | null>(null);
  const onCount = useCallback((count: number) => setCounted({ counting, count }), [counting]);
  const questionCount = counted?.counting === counting ? counted.count : undefined;
  const [chosenTab, setChosenTab] = useState<PanelTab | null>(null);
  /** The default tab, settled once per selection: answering the last question does not flip it. */
  const [settled, setSettled] = useState<{ selection: string; tab: PanelTab } | null>(null);
  /** The legend shows until the first click on an element, then behind a button. */
  const [clicked, setClicked] = useState(false);

  const relations = useMemo(
    () => (landscape.data?.relations ?? []).filter((r) => touchesModel(r, modelKey)),
    [landscape.data, modelKey],
  );
  // The canvas marker „Befund“ stays (the section „Befunde“ went, Q2): elements with a finding.
  const findingElements = useMemo(
    () =>
      new Set(
        (landscape.data?.findings ?? []).flatMap((f) =>
          f.refs
            .filter((ref) => splitRef(ref).modelKey === modelKey)
            .map((ref) => splitRef(ref).elementId),
        ),
      ),
    [landscape.data, modelKey],
  );
  const selected = relations.find((r) => r.id === search.relation);
  const listed = search.element
    ? relations.filter((r) => {
        const { from, to } = { from: splitRef(r.from), to: splitRef(r.to) };
        return (
          (from.modelKey === modelKey && from.elementId === search.element) ||
          (to.modelKey === modelKey && to.elementId === search.element)
        );
      })
    : relations;

  const highlights = useMemo<CanvasHighlight[]>(() => {
    if (selected) {
      const out: CanvasHighlight[] = [];
      const from = splitRef(selected.from);
      const to = splitRef(selected.to);
      if (from.modelKey === modelKey)
        out.push({ elementId: from.elementId, label: 'Von', tone: 'endpoint' });
      if (to.modelKey === modelKey)
        out.push({ elementId: to.elementId, label: 'Nach', tone: 'endpoint' });
      return out;
    }
    if (search.element) {
      const hasFinding = findingElements.has(search.element);
      return [
        {
          elementId: search.element,
          label: hasFinding ? 'Befund' : 'Auswahl',
          tone: hasFinding ? 'finding' : 'endpoint',
        },
      ];
    }
    // Overview: every endpoint in this model, dashed, without labels.
    const ids = new Set<string>();
    for (const r of relations) {
      for (const ref of [r.from, r.to]) {
        const { modelKey: key, elementId } = splitRef(ref);
        if (key === modelKey) ids.add(elementId);
      }
    }
    return [...ids].map((elementId) => ({ elementId, label: '', tone: 'related' as const }));
  }, [selected, search.element, relations, findingElements, modelKey]);

  const focus = selected ? (highlights[0]?.elementId ?? null) : (search.element ?? null);
  const loadError = models.error ?? landscape.error ?? content.error;
  const covered = useMemo(
    () =>
      search.element ? coveredFields(questions.data ?? [], search.element) : new Set<string>(),
    [questions.data, search.element],
  );

  // „Fragen“ when there are any (or a selected element offers „Ergänzen“ or „Verknüpfen mit …“
  // there), else „Relationen“; a selected relation opens „Relationen“. Settled once the count
  // (and a selected element's facts, file and the role) are known, so the tab stays while the
  // user works through it.
  const rule: PanelTab = search.relation
    ? 'relations'
    : questionCount === 0 && !amendableSelected && !linkableSelected
      ? 'relations'
      : 'questions';
  const selection = `${counting}#${search.relation ?? ''}`;
  if (
    questionCount !== undefined &&
    (search.element === undefined ||
      (byModel.has(modelKey) && xml !== undefined && permissions.known)) &&
    settled?.selection !== selection
  ) {
    setSettled({ selection, tab: rule });
  }
  const tab: PanelTab = chosenTab ?? (settled?.selection === selection ? settled.tab : rule);
  const elementLabel = search.element ? shortLabel(resolve(`${modelKey}#${search.element}`)) : null;
  const summary = [
    questionCount === undefined ? 'Fragen' : `Fragen ${questionCount}`,
    `Relationen ${listed.length}`,
  ].join(' · ');
  const title = model?.name ?? modelKey;

  const chips: ReactNode[] = model
    ? [
        <StageBadge key="stage" stage={model.stage} />,
        <Suspense key="amended" fallback={null}>
          <ModelAmendBadge project={project} model={model} onAmended={onAmended} />
        </Suspense>,
        <DerivedChip key="derived" source={model.source} />,
      ]
    : [];

  return (
    <div
      className="relative h-app-viewport w-full overflow-hidden bg-paper bg-[radial-gradient(var(--cd-linie)_1px,transparent_1px)] [background-size:16px_16px]"
      data-testid="model-view"
    >
      {content.data ? (
        <div
          className={cn('absolute inset-x-0 top-0', sheet.wide && 'right-[400px]')}
          style={{ bottom: sheet.inset }}
          data-testid="model-canvas"
        >
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
              amended={amended}
              controls={clicked ? <LegendButton /> : null}
              onElementClick={(elementId) => {
                setClicked(true);
                if (elementId === search.element) return;
                void navigate({ search: { element: elementId }, replace: true });
              }}
              onImportError={(message) =>
                toast({
                  tone: 'danger',
                  title: 'Diagramm konnte nicht angezeigt werden',
                  description: message,
                })
              }
            />
          </Suspense>
        </div>
      ) : null}

      <CanvasHeader
        wide={sheet.wide}
        project={project}
        projectName={info.data?.name ?? project}
        area={{ label: 'Übersicht', to: '/projects/$project' }}
        title={title}
        subtitle={model?.name ? <span className="font-mono">{modelKey}</span> : null}
        chips={chips}
        more={
          model ? (
            <Suspense
              fallback={
                <Button variant="outline" size="xs" disabled>
                  Mehr
                </Button>
              }
            >
              <ModelMore project={project} model={model} />
            </Suspense>
          ) : null
        }
        below={model ? <ImportLoss project={project} modelKey={modelKey} /> : null}
        testId="model-header"
      />

      <CanvasPanel
        sheet={sheet}
        label="Dieses Modell"
        summary={summary}
        testId="model-panel"
        header={
          <div className="flex flex-col border-b">
            {elementLabel ? (
              <div className="flex items-center gap-2 px-3 pt-2.5" data-testid="panel-element">
                <span
                  className="min-w-0 flex-1 truncate text-sm font-medium"
                  title={search.element}
                >
                  {elementLabel}
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => void navigate({ search: {}, replace: true })}
                  data-testid="panel-show-all"
                >
                  <XIcon data-icon="inline-start" />
                  Alle zeigen
                </Button>
              </div>
            ) : (
              <h2 className="sr-only">Dieses Modell</h2>
            )}
            <PanelTabs
              tabs={[
                { id: 'questions', label: 'Fragen', count: questionCount },
                { id: 'relations', label: 'Relationen', count: listed.length },
              ]}
              value={tab}
              onChange={setChosenTab}
              label="Dieses Modell"
              idBase={tabsId}
            />
          </div>
        }
      >
        <PanelTabPanel id="questions" value={tab} idBase={tabsId}>
          {model ? (
            <Suspense fallback={<Skeleton className="mx-2 h-16" />}>
              <ModelQuestions
                project={project}
                modelKey={modelKey}
                resolve={resolve}
                element={search.element}
                onCount={onCount}
              />
            </Suspense>
          ) : null}
          {search.element && model && amendableSelected ? (
            <Suspense fallback={<Skeleton className="mt-2 h-12" />}>
              <div className="mt-2">
                <AmendSection
                  key={`${model.id}:${search.element}`}
                  project={project}
                  model={model}
                  elementId={search.element}
                  resolve={resolve}
                  covered={covered}
                />
              </div>
            </Suspense>
          ) : null}
          {search.element && content.data && model ? (
            <Suspense fallback={null}>
              <SubprocessLink
                key={search.element}
                project={project}
                modelKey={modelKey}
                xml={content.data.xml}
                elementId={search.element}
                resolve={resolve}
              />
            </Suspense>
          ) : null}
        </PanelTabPanel>
        <PanelTabPanel id="relations" value={tab} idBase={tabsId}>
          {landscape.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : listed.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">
              {search.element
                ? 'Dieses Element hat keine Relation.'
                : 'Dieses Modell hat noch keine Relation zu anderen Modellen.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {listed.map((r) => (
                <RelationItem
                  key={r.id}
                  relation={r}
                  modelKey={modelKey}
                  resolve={resolve}
                  selected={r.id === selected?.id}
                  project={project}
                />
              ))}
            </ul>
          )}
        </PanelTabPanel>
      </CanvasPanel>

      {/* the legend until the first click on an element, then behind its button */}
      {!clicked && sheet.wide ? (
        <p
          className="absolute bottom-4 left-4 z-30 rounded-lg border bg-card/90 px-3 py-1.5 shadow-sm backdrop-blur-sm"
          data-testid="model-legend"
        >
          <Legend />
        </p>
      ) : null}

      {loadError ? (
        <div className="absolute inset-x-0 top-1/3 z-40 mx-auto w-[min(480px,calc(100vw-32px))]">
          <Alert variant="destructive" className="shadow-md">
            <AlertTitle>Modell konnte nicht geladen werden</AlertTitle>
            <AlertDescription>
              <ErrorText error={loadError} />
            </AlertDescription>
          </Alert>
        </div>
      ) : models.data && !model ? (
        <div className="absolute inset-x-0 top-1/3 z-40 mx-auto w-[min(480px,calc(100vw-32px))]">
          <Alert className="shadow-md">
            <AlertTitle>Modell „{modelKey}“ gibt es nicht</AlertTitle>
            <AlertDescription>
              Es wurde gelöscht oder nie hochgeladen.{' '}
              <Link to="/projects/$project" params={{ project }} className="text-link underline">
                Zur Modellliste
              </Link>
            </AlertDescription>
          </Alert>
        </div>
      ) : !content.data ? (
        <div className="absolute inset-0 grid place-items-center">
          <Spinner className="size-6" />
        </div>
      ) : null}
    </div>
  );
}

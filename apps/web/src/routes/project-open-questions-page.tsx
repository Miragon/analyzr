import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import {
  ChevronRightIcon,
  CircleCheckIcon,
  FileDownIcon,
  FilterIcon,
  FilterXIcon,
  InfoIcon,
  SearchXIcon,
  XIcon,
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { ErrorText } from '@/components/error-text';
import { AnswerSheetDialog } from '@/components/open-questions/answer-sheet-dialog';
import CustomerExportDialog from '@/components/open-questions/customer-export-dialog';
import { NoteDialog } from '@/components/open-questions/note-dialog';
import type { QuestionActor } from '@/components/open-questions/question-actions';
import {
  ClosedGroup,
  DoneItem,
  InfoItem,
  QuestionItem,
} from '@/components/open-questions/question-item';
import { useActionFocus } from '@/components/open-questions/use-action-focus';
import { useNoteDialog } from '@/components/open-questions/use-note-dialog';
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
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  OPEN_QUESTION_SOURCES,
  activeFilterCount,
  agentQuestionCount,
  countText,
  infoGroup,
  openQuestionFacets,
  parseOpenQuestionFilters,
  questionView,
} from '@/lib/open-questions';
import { useProjectPermissions } from '@/lib/permissions';
import { landscapeQuery, modelsQuery, openQuestionsQuery } from '@/lib/queries';
import { useProjectFacts } from '@/lib/use-project-facts';

import { projectOpenQuestionsRoute, type OpenQuestionsSearch } from './project-open-questions';

/** Cards shown at first and added per „Weitere anzeigen“. */
const PAGE = 50;
const ALL = '';

/** „So funktioniert es“ (UX-SIMPLIFICATION.md §3.3 item 2, P6): closed, below the intro line. */
function HowItWorks({ canReview }: { canReview: boolean }) {
  return (
    <details
      className="group/how min-w-0 text-sm leading-5 open:basis-full"
      data-testid="open-questions-how"
    >
      <summary className="flex w-fit cursor-pointer list-none items-center gap-0.5 rounded-sm leading-5 text-link select-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          className="size-4 transition-transform group-open/how:rotate-90 motion-reduce:transition-none"
          aria-hidden
        />
        So funktioniert es
      </summary>
      <div className="mt-1 flex max-w-prose flex-col gap-1 border-l-2 pl-3 text-sm text-muted-foreground">
        <p>
          Oben stehen die Fragen, an denen die meisten offenen Entscheidungen hängen, danach die
          Lücken der Wertschöpfungskette. „Ansprechpartner“ nennt Organisationseinheiten und Lanes:
          ein Hinweis, keine Zuständigkeit.
        </p>
        <p>
          Fragen der Agenten zu ihren Vorschlägen stehen bei den Vorschlägen, unter „Art“ auch hier;
          den Kunden fragst du mit „Für den Kunden exportieren …“.
        </p>
        {canReview ? (
          <p>
            Was eine Aktion angelegt hat, nimmst du mit „Rückgängig“ zurück. Eine Notiz hält fest,
            was du weißt; die Antworten des Kunden liest „Antworten aus CSV übernehmen …“ als
            Notizen ein.
          </p>
        ) : null}
      </div>
    </details>
  );
}

/**
 * The tab „Offene Fragen“ (M6 §4.4; UX2b, UX-SIMPLIFICATION.md §2.4 and
 * §3.3): one intro line with „So funktioniert es“ closed; three filters
 * („Art“, „Modell oder Ordner“, „Ansprechpartner“; on a phone behind
 * „Filter (n)“), the count line „21 zu klären“ (the badge's number), „Für
 * den Kunden exportieren …“ and, for reviewers, „Antworten aus CSV
 * übernehmen …“; then the open questions „Zu klären“ as lean cards in the
 * server's order (questions by the open decisions they touch, then the
 * value chain's findings), the closed group „Zur Information“, „Erledigte
 * zeigen“ and the list „Befunde“ behind a link. The agents' questions show
 * on their proposals, here only under „Art“ („Frage eines Agenten“); the
 * chain's proposals are never listed (its badge counts them). Filters live
 * in the URL (`?kind=&model=&askWho=`; `?source=` shows as a removable chip,
 * `?state=answered` opens „Erledigte zeigen“). Every role reads it;
 * reviewers act on each card (M6 §4.8 a), and after an action the focus
 * moves to the next card.
 */
export function OpenQuestionsPage() {
  const { project } = projectOpenQuestionsRoute.useParams();
  const search = projectOpenQuestionsRoute.useSearch();
  const navigate = projectOpenQuestionsRoute.useNavigate();
  const questions = useQuery(openQuestionsQuery(project));
  const models = useQuery(modelsQuery(project));
  const landscape = useQuery(landscapeQuery(project));
  const findings = landscape.data?.findings.length ?? 0;
  const { resolve } = useProjectFacts(project, models.data);
  const { canReview } = useProjectPermissions(project);
  const noting = useNoteDialog();
  const [shown, setShown] = useState(PAGE);
  const [exporting, setExporting] = useState(false);
  const exportButton = useRef<HTMLButtonElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const list = useRef<HTMLUListElement>(null);

  const filters = useMemo(() => parseOpenQuestionFilters({ ...search }), [search]);
  const all = useMemo(() => questions.data ?? [], [questions.data]);
  const view = useMemo(() => questionView(all, filters), [all, filters]);
  const facets = useMemo(() => openQuestionFacets(all, filters), [all, filters]);
  const info = useMemo(
    () => infoGroup(view.info, models.data?.length ?? 0),
    [view.info, models.data],
  );
  const active = activeFilterCount(filters);
  const visibleIds = useMemo(() => view.cards.slice(0, shown).map((q) => q.id), [view, shown]);
  const acted = useActionFocus(
    visibleIds,
    list,
    useCallback(() => document.getElementById('oq-count'), []),
  );
  const actor = useMemo<QuestionActor>(() => ({ note: noting.open, acted }), [noting.open, acted]);
  // An agent's name only when the cards' agent texts come from more than one (UX2b).
  const showRaiser =
    new Set(
      view.cards.filter((q) => q.raisedBy.sourceKind === 'agent').map((q) => q.raisedBy.handle),
    ).size > 1;

  const set = (patch: Partial<OpenQuestionsSearch>) => {
    const next: OpenQuestionsSearch = { ...search, ...patch };
    for (const key of Object.keys(next) as (keyof OpenQuestionsSearch)[]) {
      if (next[key] === undefined) delete next[key];
    }
    setShown(PAGE);
    void navigate({ search: next, replace: true });
  };
  const reset = () => {
    set({ kind: undefined, source: undefined, model: undefined, askWho: undefined });
    // The reset buttons leave with the filters: keep the keyboard focus in the filters.
    requestAnimationFrame(() => document.getElementById('oq-kind')?.focus());
  };

  if (questions.isPending) return <Skeleton className="h-60 w-full" />;
  if (questions.isError)
    return (
      <Alert variant="destructive">
        <AlertTitle>Offene Fragen konnten nicht geladen werden</AlertTitle>
        <AlertDescription>
          <ErrorText error={questions.error} />
        </AlertDescription>
      </Alert>
    );

  const intro = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <p className="text-sm leading-5 text-muted-foreground" data-testid="open-questions-intro">
        Was in der Landschaft noch fehlt.
        {canReview ? ' Zu jeder Frage gibt es eine Aktion, mit der du sie erledigst.' : ''}
      </p>
      <HowItWorks canReview={canReview} />
    </div>
  );

  // The tab „Befunde“ is gone (owner decision 26, Q2): its list stays one link away, also
  // when no finding is an open question (R1, R1b) and nothing else is open.
  const findingsLink =
    findings > 0 ? (
      <Link
        to="/projects/$project/findings"
        params={{ project }}
        className="self-start text-sm text-link underline-offset-4 hover:underline"
        data-testid="findings-link"
      >
        Alle Befunde der Modelle als Liste ({findings})
      </Link>
    ) : null;

  if (all.length === 0)
    return (
      <div className="-mt-3.5 flex flex-col gap-2">
        {intro}
        <Empty className="border bg-card py-10" data-testid="open-questions-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CircleCheckIcon />
            </EmptyMedia>
            <EmptyTitle>Keine offenen Fragen</EmptyTitle>
            <EmptyDescription>
              Gerade fehlt der Landschaft nichts, was jemand klären muss.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
        {findingsLink}
      </div>
    );

  const cards = view.cards.slice(0, shown);
  const agentQuestions = agentQuestionCount(all, filters);

  return (
    <div className="-mt-3.5 flex flex-col gap-2">
      {intro}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="sm:hidden"
          aria-expanded={filtersOpen}
          aria-controls="oq-filters"
          onClick={() => setFiltersOpen((v) => !v)}
          data-testid="open-questions-filter-toggle"
        >
          <FilterIcon data-icon="inline-start" />
          Filter{active > 0 ? ` (${active})` : ''}
        </Button>
        <div
          id="oq-filters"
          role="search"
          aria-label="Offene Fragen filtern"
          className={cn(
            'flex-wrap items-center gap-2 sm:flex sm:w-auto',
            filtersOpen ? 'flex w-full' : 'hidden',
          )}
        >
          <NativeSelect
            id="oq-kind"
            size="sm"
            aria-label="Art"
            className="w-full sm:w-40"
            value={filters.kind ?? ALL}
            onChange={(e) => set({ kind: e.target.value === ALL ? undefined : e.target.value })}
          >
            <NativeSelectOption value={ALL}>Alle Arten</NativeSelectOption>
            {facets.kinds.map((o) => (
              <NativeSelectOption key={o.value} value={o.value}>
                {o.label} ({o.count})
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <NativeSelect
            id="oq-model"
            size="sm"
            aria-label="Modell oder Ordner"
            className="w-full sm:w-44"
            value={filters.model ?? ALL}
            onChange={(e) => set({ model: e.target.value === ALL ? undefined : e.target.value })}
          >
            <NativeSelectOption value={ALL}>Alle Modelle</NativeSelectOption>
            {facets.folders.length > 0 ? (
              <NativeSelectOptGroup label="Ordner">
                {facets.folders.map((o) => (
                  <NativeSelectOption key={`folder:${o.value}`} value={o.value}>
                    {o.label} ({o.count})
                  </NativeSelectOption>
                ))}
              </NativeSelectOptGroup>
            ) : null}
            {facets.models.length > 0 ? (
              <NativeSelectOptGroup label="Modelle">
                {facets.models.map((o) => (
                  <NativeSelectOption key={`model:${o.value}`} value={o.value}>
                    {o.label} ({o.count})
                  </NativeSelectOption>
                ))}
              </NativeSelectOptGroup>
            ) : null}
          </NativeSelect>
          <NativeSelect
            id="oq-ask-who"
            size="sm"
            aria-label="Ansprechpartner"
            className="w-full sm:w-44"
            value={filters.askWho ?? ALL}
            onChange={(e) => set({ askWho: e.target.value === ALL ? undefined : e.target.value })}
          >
            <NativeSelectOption value={ALL}>Alle Ansprechpartner</NativeSelectOption>
            {facets.askWho.map((o) => (
              <NativeSelectOption key={o.value} value={o.value}>
                {o.label} ({o.count})
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {filters.source ? (
            // „Quelle“ left the UI (G9); a link or bookmark with it still filters, removably.
            <Button
              variant="secondary"
              size="sm"
              onClick={() => set({ source: undefined })}
              aria-label={`Filter „Quelle: ${OPEN_QUESTION_SOURCES[filters.source]}“ entfernen`}
              data-testid="open-questions-source-chip"
            >
              Quelle: {OPEN_QUESTION_SOURCES[filters.source]}
              <XIcon data-icon="inline-end" />
            </Button>
          ) : null}
          {active > 0 ? (
            <Button variant="ghost" size="sm" onClick={reset}>
              <FilterXIcon data-icon="inline-start" />
              Filter zurücksetzen
            </Button>
          ) : null}
        </div>
        <p
          id="oq-count"
          tabIndex={-1}
          className="text-sm text-muted-foreground tabular-nums outline-none"
          aria-live="polite"
          data-testid="open-questions-count"
        >
          {countText(view)}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            ref={exportButton}
            variant="outline"
            size="sm"
            onClick={() => setExporting(true)}
            data-testid="open-questions-export"
          >
            <FileDownIcon data-icon="inline-start" />
            Für den Kunden exportieren …
          </Button>
          {canReview ? <AnswerSheetDialog project={project} items={all} /> : null}
        </div>
      </div>

      {view.cards.length === 0 ? (
        <Empty className="border bg-card py-8" data-testid="open-questions-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              {active > 0 ? <SearchXIcon /> : <CircleCheckIcon />}
            </EmptyMedia>
            <EmptyTitle>
              {active > 0 ? 'Keine Frage passt zu den Filtern' : 'Nichts zu klären'}
            </EmptyTitle>
            <EmptyDescription>
              {active > 0
                ? `Die Filter schließen jede der ${view.total} Fragen aus.`
                : 'Was die Agenten zu ihren Vorschlägen fragen, steht bei den Vorschlägen.'}
            </EmptyDescription>
          </EmptyHeader>
          {active > 0 ? (
            <EmptyContent>
              <Button variant="outline" onClick={reset}>
                <FilterXIcon data-icon="inline-start" />
                Filter zurücksetzen
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <ul ref={list} className="flex flex-col gap-2" aria-label="Offene Fragen">
          {cards.map((q) => (
            <QuestionItem
              key={q.id}
              q={q}
              project={project}
              resolve={resolve}
              showRaiser={showRaiser}
              {...(canReview ? { actor } : {})}
            />
          ))}
        </ul>
      )}
      {view.cards.length > cards.length ? (
        <Button
          variant="outline"
          className="self-center"
          onClick={() => setShown((n) => n + PAGE)}
          data-testid="open-questions-more"
        >
          {`Weitere ${Math.min(PAGE, view.cards.length - cards.length)} anzeigen (${view.cards.length - cards.length} übrig)`}
        </Button>
      ) : null}

      <div className="mt-2 flex flex-col gap-3">
        {view.info.length > 0 ? (
          <ClosedGroup
            title="Zur Information"
            count={view.info.length}
            testId="open-questions-info"
          >
            <ul className="flex flex-col divide-y" aria-label="Zur Information">
              {info.descriptive ? (
                <li
                  className="flex items-start gap-2 py-1.5 text-sm text-muted-foreground"
                  data-testid="open-questions-descriptive"
                >
                  <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>{info.descriptive.text}</span>
                </li>
              ) : null}
              {info.rest.map((q) => (
                <InfoItem key={q.id} q={q} project={project} />
              ))}
            </ul>
          </ClosedGroup>
        ) : null}
        {view.done.length > 0 ? (
          <ClosedGroup
            title="Erledigte zeigen"
            count={view.done.length}
            testId="open-questions-done"
            defaultOpen={filters.state === 'answered'}
          >
            <ul className="flex flex-col gap-1.5" aria-label="Erledigt">
              {view.done.map((q) => (
                <DoneItem key={q.id} q={q} project={project} canWithdraw={canReview} />
              ))}
            </ul>
          </ClosedGroup>
        ) : null}
        {findingsLink}
      </div>

      {canReview ? (
        <NoteDialog
          project={project}
          state={noting.state}
          onClose={noting.close}
          fallbackFocusId="oq-count"
        />
      ) : null}
      <CustomerExportDialog
        project={project}
        open={exporting}
        onOpenChange={setExporting}
        filters={filters}
        agentQuestions={agentQuestions}
        returnFocus={() => exportButton.current}
      />
    </div>
  );
}

import { exportOpenQuestions, type OpenQuestionExportFormat } from '@analyzr/client';
import { useQuery } from '@tanstack/react-query';
import { CircleCheckIcon, FileDownIcon, FilterXIcon, SearchXIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { AnswerDialog } from '@/components/open-questions/answer-dialog';
import { AnswerSheetDialog } from '@/components/open-questions/answer-sheet-dialog';
import { QuestionItem } from '@/components/open-questions/question-item';
import { useAnswerDialog } from '@/components/open-questions/use-answer-dialog';
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
import { Field, FieldLabel } from '@/components/ui/field';
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage, unwrapWithResponse } from '@/lib/api';
import { downloadBlob } from '@/lib/download';
import {
  attachmentName,
  exportQuery,
  filterOpenQuestions,
  hasFilters,
  openQuestionFacets,
  parseOpenQuestionFilters,
  type FacetOption,
  type OpenQuestionFilters,
} from '@/lib/open-questions';
import { useProjectPermissions } from '@/lib/permissions';
import { modelsQuery, openQuestionsQuery } from '@/lib/queries';
import { toast } from '@/lib/toast';
import { useProjectFacts } from '@/lib/use-project-facts';

import { projectOpenQuestionsRoute, type OpenQuestionsSearch } from './project-open-questions';

/** Items shown at first and added per „Weitere anzeigen“. */
const PAGE = 50;
const ALL = '';

const FORMATS: Record<OpenQuestionExportFormat, { label: string; ext: string }> = {
  markdown: { label: 'Als Markdown exportieren', ext: 'md' },
  csv: { label: 'Als CSV exportieren', ext: 'csv' },
};

/**
 * Downloads the export route's file for the filters, byte for byte (the CSV
 * keeps its byte order mark), under the name the server gives it.
 */
async function downloadExport(
  project: string,
  format: OpenQuestionExportFormat,
  filters: OpenQuestionFilters,
): Promise<void> {
  const { data, response } = await unwrapWithResponse(
    exportOpenQuestions({
      client: api,
      path: { project },
      query: { ...exportQuery(filters), format },
      parseAs: 'blob',
    }),
  );
  // `parseAs: 'blob'` hands over the bytes; the generated type says string (the schema's).
  const body: unknown = data;
  const blob =
    body instanceof Blob
      ? body
      : new Blob([String(body)], { type: response.headers.get('content-type') ?? 'text/plain' });
  downloadBlob(
    attachmentName(
      response.headers.get('content-disposition'),
      `offene-fragen-${project}.${FORMATS[format].ext}`,
    ),
    blob,
  );
}

function ExportButtons({ project, filters }: { project: string; filters: OpenQuestionFilters }) {
  const [busy, setBusy] = useState<OpenQuestionExportFormat | null>(null);
  const run = (format: OpenQuestionExportFormat) => {
    setBusy(format);
    downloadExport(project, format, filters)
      .catch((error: unknown) =>
        toast({
          tone: 'danger',
          title: 'Export fehlgeschlagen',
          description: errorMessage(error),
        }),
      )
      .finally(() => setBusy(null));
  };
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Exportieren">
      {(['markdown', 'csv'] as const).map((format) => (
        <Button
          key={format}
          variant="outline"
          disabled={busy !== null}
          onClick={() => run(format)}
          data-testid="open-questions-export"
          data-format={format}
          title={
            format === 'csv'
              ? 'Die Fragen mit den Spalten „Antwort“ und „Antwortart“ zum Ausfüllen (bei beantworteten Fragen steht die letzte Antwort darin), ohne die Hinweise zur Information'
              : 'Nach Ansprechpartner-Hinweis gruppiert, zum Lesen und für Gespräche'
          }
        >
          {busy === format ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <FileDownIcon data-icon="inline-start" />
          )}
          {FORMATS[format].label}
        </Button>
      ))}
    </div>
  );
}

function FacetSelect({
  id,
  label,
  allLabel,
  value,
  options,
  onChange,
  className,
}: {
  id: string;
  label: string;
  allLabel: string;
  value: string | undefined;
  options: readonly FacetOption[];
  onChange: (value: string | undefined) => void;
  className?: string;
}) {
  return (
    <Field className={className ?? 'w-auto'}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NativeSelect
        id={id}
        className="w-full"
        value={value ?? ALL}
        onChange={(e) => onChange(e.target.value === ALL ? undefined : e.target.value)}
      >
        <NativeSelectOption value={ALL}>{allLabel}</NativeSelectOption>
        {options.map((o) => (
          <NativeSelectOption key={o.value} value={o.value}>
            {o.label} ({o.count})
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );
}

/**
 * The tab „Offene Fragen“ (M6 §4.4): every open question of the project in
 * the server's order (questions, then the value chain findings, then the
 * informational items, each by the open decisions it touches), filtered by
 * kind, model or folder, contact hint, source and state (in the URL), and the
 * export of exactly the filtered list as Markdown or CSV. Every role reads
 * it; reviewers (editors and owners, never on the read-only demo) answer
 * each item with „Beantworten“ and take a filled-in CSV back with „Antworten
 * aus CSV übernehmen“ (M6 §4.5, S5a).
 */
export function OpenQuestionsPage() {
  const { project } = projectOpenQuestionsRoute.useParams();
  const search = projectOpenQuestionsRoute.useSearch();
  const navigate = projectOpenQuestionsRoute.useNavigate();
  const questions = useQuery(openQuestionsQuery(project));
  const models = useQuery(modelsQuery(project));
  const { resolve } = useProjectFacts(project, models.data);
  const { canReview } = useProjectPermissions(project);
  const answering = useAnswerDialog();
  const [shown, setShown] = useState(PAGE);

  const filters = useMemo(() => parseOpenQuestionFilters({ ...search }), [search]);
  const all = useMemo(() => questions.data ?? [], [questions.data]);
  const items = useMemo(() => filterOpenQuestions(all, filters), [all, filters]);
  const facets = useMemo(() => openQuestionFacets(all, filters), [all, filters]);
  const filtered = hasFilters(filters);

  const set = (patch: Partial<OpenQuestionsSearch>) => {
    const next: OpenQuestionsSearch = { ...search, ...patch };
    for (const key of Object.keys(next) as (keyof OpenQuestionsSearch)[]) {
      if (next[key] === undefined) delete next[key];
    }
    setShown(PAGE);
    void navigate({ search: next, replace: true });
  };
  const reset = () => {
    set({
      kind: undefined,
      source: undefined,
      model: undefined,
      askWho: undefined,
      state: undefined,
    });
    // Both reset buttons leave with the filters: keep the keyboard focus in the filters.
    requestAnimationFrame(() => document.getElementById('oq-kind')?.focus());
  };

  if (questions.isPending) return <Skeleton className="h-60 w-full" />;
  if (questions.isError)
    return (
      <Alert variant="destructive">
        <AlertTitle>Offene Fragen konnten nicht geladen werden</AlertTitle>
        <AlertDescription>{errorMessage(questions.error)}</AlertDescription>
      </Alert>
    );

  const intro = (
    <p className="text-muted-foreground">
      Hier steht, wo der Landschaft Wissen fehlt, um Relationen oder Platzierungen zu entscheiden:
      Befunde, Vormerkungen, Fragen und Einschätzungen der Agenten und Lückensignale aus den
      Modellen. Ganz oben stehen die Fragen, an denen die meisten offenen Entscheidungen hängen,
      danach die Befunde der Wertschöpfungskette; Hinweise zur Information stehen zuletzt. Der
      Ansprechpartner-Hinweis nennt Lanes, Organisationseinheiten und Ordner: ein Hinweis, keine
      Zuständigkeit.
      {canReview
        ? ' Mit „Beantworten“ hältst du eine Antwort fest, mit „Antworten aus CSV übernehmen“ die Antworten aus der ausgefüllten CSV.'
        : null}
    </p>
  );

  if (all.length === 0)
    return (
      <div className="flex flex-col gap-4">
        {intro}
        <Empty className="border bg-card py-10" data-testid="open-questions-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CircleCheckIcon />
            </EmptyMedia>
            <EmptyTitle>Keine offenen Fragen</EmptyTitle>
            <EmptyDescription>
              Weder die Befunde noch die Vormerkungen, die Agenten oder die Lückensignale lassen
              gerade eine Frage offen.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );

  const visible = items.slice(0, shown);

  return (
    <div className="flex flex-col gap-4">
      {intro}
      <div
        className="flex flex-wrap items-end gap-3"
        role="search"
        aria-label="Offene Fragen filtern"
      >
        <FacetSelect
          id="oq-kind"
          label="Art"
          allLabel="Alle Arten"
          value={filters.kind}
          options={facets.kinds}
          onChange={(kind) => set({ kind })}
        />
        <Field className="w-auto min-w-56">
          <FieldLabel htmlFor="oq-model">Modell oder Ordner</FieldLabel>
          <NativeSelect
            id="oq-model"
            className="w-full"
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
        </Field>
        <Field className="w-auto min-w-48">
          <FieldLabel htmlFor="oq-ask-who">Ansprechpartner-Hinweis</FieldLabel>
          <NativeSelect
            id="oq-ask-who"
            className="w-full"
            value={filters.askWho ?? ALL}
            onChange={(e) => set({ askWho: e.target.value === ALL ? undefined : e.target.value })}
          >
            <NativeSelectOption value={ALL}>Alle Hinweise</NativeSelectOption>
            {facets.askWho.map((group) => (
              <NativeSelectOptGroup key={group.label} label={group.label}>
                {group.options.map((o) => (
                  <NativeSelectOption key={o.value} value={o.value}>
                    {o.label} ({o.count})
                  </NativeSelectOption>
                ))}
              </NativeSelectOptGroup>
            ))}
          </NativeSelect>
        </Field>
        <FacetSelect
          id="oq-source"
          label="Quelle"
          allLabel="Alle Quellen"
          value={filters.source}
          options={facets.sources}
          onChange={(source) => set({ source })}
        />
        <FacetSelect
          id="oq-state"
          label="Status"
          allLabel="Alle"
          value={filters.state}
          options={facets.states}
          onChange={(state) => set({ state })}
        />
        {filtered ? (
          <Button variant="ghost" onClick={reset}>
            <FilterXIcon data-icon="inline-start" />
            Filter zurücksetzen
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p
          id="oq-count"
          tabIndex={-1}
          className="text-sm text-muted-foreground outline-none"
          aria-live="polite"
          data-testid="open-questions-count"
        >
          {filtered
            ? `${items.length} von ${all.length} ${all.length === 1 ? 'Frage' : 'Fragen'}`
            : `${all.length} ${all.length === 1 ? 'Frage' : 'Fragen'}`}
          , geordnet nach offenen Entscheidungen
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ExportButtons project={project} filters={filters} />
          {canReview ? <AnswerSheetDialog project={project} items={all} /> : null}
        </div>
      </div>

      {items.length === 0 ? (
        <Empty className="border bg-card py-10" data-testid="open-questions-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon />
            </EmptyMedia>
            <EmptyTitle>Keine Frage passt zu den Filtern</EmptyTitle>
            <EmptyDescription>
              Die Filter schließen jede der {all.length}{' '}
              {all.length === 1 ? 'offenen Frage' : 'offenen Fragen'} aus.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={reset}>
              <FilterXIcon data-icon="inline-start" />
              Filter zurücksetzen
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Offene Fragen">
          {visible.map((q) => (
            <QuestionItem
              key={q.id}
              q={q}
              project={project}
              resolve={resolve}
              {...(canReview ? { onAnswer: answering.open } : {})}
            />
          ))}
        </ul>
      )}
      {items.length > visible.length ? (
        <Button
          variant="outline"
          className="self-center"
          onClick={() => setShown((n) => n + PAGE)}
          data-testid="open-questions-more"
        >
          {`Weitere ${Math.min(PAGE, items.length - visible.length)} anzeigen (${items.length - visible.length} übrig)`}
        </Button>
      ) : null}
      {canReview ? (
        <AnswerDialog
          project={project}
          state={answering.state}
          onClose={answering.close}
          fallbackFocusId="oq-count"
        />
      ) : null}
    </div>
  );
}

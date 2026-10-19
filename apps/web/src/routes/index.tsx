import { createProject, type Project } from '@analyzr/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { PlusIcon, TerminalIcon } from 'lucide-react';
import { useId, useState, type FormEvent, type ReactNode } from 'react';

import { CopyButton } from '@/components/copy-button';
import { ErrorText } from '@/components/error-text';
import { MiragonMark, PageShell } from '@/components/page-shell';
import { toast } from '@/lib/toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiError, api, errorMessage, unwrap } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/labels';
import { openPointsText, summaryPoints } from '@/lib/project-counts';
import { keys, projectSummaryQuery, projectsQuery } from '@/lib/queries';
import { useServerMode } from '@/lib/server-mode';
import { isProjectKey, slugify } from '@/lib/slug';

import { rootRoute } from './root';

const SEED_COMMAND = 'pnpm seed';
const ROLE_LABELS = { owner: 'Inhaber', editor: 'Bearbeiter', viewer: 'Leser' } as const;

function NewProjectDialog({ trigger }: { trigger: ReactNode }) {
  const id = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  // The key follows the name, shown as one line; „(ändern)“ opens the field (UX1, §3.12 item 4).
  const [editKey, setEditKey] = useState(false);
  const effectiveKey = keyTouched ? key : slugify(name);
  const keyValid = isProjectKey(effectiveKey);
  // A name without Latin letters or digits („数据平台“, „—“) derives no key: the field shows
  // at once, so „Projekt anlegen“ is never disabled without a way on.
  const showKey = editKey || (name.trim() !== '' && effectiveKey === '');

  const create = useMutation({
    mutationFn: () =>
      unwrap(createProject({ client: api, body: { key: effectiveKey, name: name.trim() } })),
    onSuccess: async (project) => {
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: keys.projects });
      toast({ tone: 'success', title: `Projekt „${project.name}“ angelegt` });
      await navigate({ to: '/projects/$project/upload', params: { project: project.key } });
    },
    // A taken key: show the field to change it.
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) setEditKey(true);
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() !== '' && keyValid) create.mutate();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          create.reset();
          setEditKey(false);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Neues Projekt</DialogTitle>
            <DialogDescription>Ein Projekt ist eine Prozesslandschaft.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
              <Input
                id={`${id}-name`}
                value={name}
                maxLength={200}
                autoFocus
                required
                placeholder="Nordwind Handel"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            {showKey ? (
              <Field data-invalid={effectiveKey !== '' && !keyValid}>
                <FieldLabel htmlFor={`${id}-key`}>Kurzname</FieldLabel>
                <Input
                  id={`${id}-key`}
                  value={effectiveKey}
                  className="font-mono"
                  aria-invalid={effectiveKey !== '' && !keyValid}
                  placeholder="nordwind-handel"
                  // Only when asked for: shown for a name without a key, it must not take the
                  // focus from the name being typed.
                  autoFocus={editKey}
                  onChange={(e) => {
                    setKeyTouched(true);
                    setKey(e.target.value);
                    setEditKey(true);
                  }}
                />
                <FieldDescription>
                  Kleinbuchstaben, Ziffern und Bindestriche; steht in Adressen und Befehlen und
                  bleibt fest.
                </FieldDescription>
              </Field>
            ) : effectiveKey !== '' ? (
              <p className="text-sm text-muted-foreground" data-testid="key-preview">
                Kurzname: <span className="font-mono text-foreground">{effectiveKey}</span>{' '}
                <button
                  type="button"
                  className="text-link underline-offset-4 hover:underline"
                  onClick={() => setEditKey(true)}
                >
                  (ändern)
                </button>
              </p>
            ) : null}
            {create.isError ? (
              <FieldError>
                {create.error instanceof ApiError && create.error.status === 409
                  ? `Den Kurznamen „${effectiveKey}“ gibt es schon. Wähl einen anderen.`
                  : errorMessage(create.error)}
              </FieldError>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || name.trim() === '' || !keyValid}>
              {create.isPending ? <Spinner data-icon="inline-start" /> : null}
              Projekt anlegen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const dash = <span className="text-muted-foreground">–</span>;

/**
 * One row of the projects list (UX-SIMPLIFICATION.md §3.12 item 1, UX9): the
 * name with the key small below, „Rolle“ when the list shows it, then
 * „Offen für dich“ and „Zuletzt geändert“ from the project's summary (one
 * query per row, under the project's keys, so its writes refresh it).
 * „Offen für dich“ is the sum of the project's three tab badges (relations to
 * review, open placements, questions to clarify; §2.5), its split in the
 * title; text, not a link, since no one list holds all three (P7). It shows
 * only to roles that may decide (editor, owner): „–“ for viewers and the demo
 * visitor, who cannot decide anything, and for none. „Zuletzt geändert“ is
 * the day of the project's latest event, the time in its title. A failed
 * summary leaves both at „–“.
 */
function ProjectRow({
  project,
  showRole,
  demo,
}: {
  project: Project;
  showRole: boolean;
  demo: boolean;
}) {
  const summary = useQuery(projectSummaryQuery(project.key));
  const mayDecide = !demo && (project.role === 'owner' || project.role === 'editor');
  const points = summary.data ? summaryPoints(summary.data) : null;
  return (
    <TableRow data-testid="project-row">
      <TableCell className="whitespace-normal">
        <div className="flex min-w-0 flex-col">
          <Link
            to="/projects/$project"
            params={{ project: project.key }}
            className="font-medium text-link hover:underline"
          >
            {project.name}
          </Link>
          <span className="font-mono text-xs text-muted-foreground">{project.key}</span>
        </div>
      </TableCell>
      {showRole ? (
        <TableCell>
          <Badge variant="outline">{ROLE_LABELS[project.role]}</Badge>
        </TableCell>
      ) : null}
      <TableCell className="text-right tabular-nums" data-testid="open-for-you">
        {!mayDecide ? (
          dash
        ) : summary.isPending ? (
          <Skeleton className="ml-auto h-4 w-6" aria-label="Wird geladen" />
        ) : points === null || points.total === 0 ? (
          dash
        ) : (
          <span title={openPointsText(points)}>
            {points.total}
            <span className="sr-only">
              {` ${points.total === 1 ? 'offener Punkt' : 'offene Punkte'}: ${openPointsText(points)}`}
            </span>
          </span>
        )}
      </TableCell>
      <TableCell className="hidden text-muted-foreground sm:table-cell" data-testid="last-changed">
        {summary.isPending ? (
          <Skeleton className="h-4 w-20" aria-label="Wird geladen" />
        ) : summary.data ? (
          <span title={formatDateTime(summary.data.lastEventAt)}>
            {formatDate(summary.data.lastEventAt)}
          </span>
        ) : (
          dash
        )}
      </TableCell>
    </TableRow>
  );
}

function ProjectsPage() {
  const projects = useQuery(projectsQuery);
  const mode = useServerMode();
  // Creating projects and seeding are for an analyzr of your own: hidden until the
  // server's mode is known, and never on the read-only demo.
  const writable = mode.known && !mode.demo;
  // „Rolle“ tells a reader why nothing can be changed; in local mode every role is „Inhaber“.
  const showRole = mode.demo || (projects.data ?? []).some((p) => p.role !== 'owner');

  return (
    <PageShell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[28px] leading-tight font-bold">Projekte</h1>
          <p className="text-muted-foreground">
            Jedes Projekt ist eine Prozesslandschaft: BPMN-Modelle, ihre Fakten und die Relationen
            zwischen den Prozessen.
          </p>
        </div>
        {writable && projects.data && projects.data.length > 0 ? (
          <NewProjectDialog
            trigger={
              <Button>
                <PlusIcon data-icon="inline-start" />
                Neues Projekt
              </Button>
            }
          />
        ) : null}
      </div>

      {projects.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : projects.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Projekte konnten nicht geladen werden</AlertTitle>
          <AlertDescription>
            <ErrorText error={projects.error} />
          </AlertDescription>
        </Alert>
      ) : projects.data.length === 0 ? (
        <Empty className="border bg-card py-12">
          <EmptyHeader>
            <EmptyMedia>
              <MiragonMark className="size-12" />
            </EmptyMedia>
            <EmptyTitle className="text-base font-semibold">Noch kein Projekt</EmptyTitle>
            <EmptyDescription>
              {mode.demo ? (
                'Diese Demo zeigt gerade kein Projekt.'
              ) : (
                <>
                  Leg ein Projekt an und lade BPMN-Modelle hoch.
                  {import.meta.env.DEV ? (
                    <>
                      {' '}
                      Die Testlandschaften lädst du im Repo mit{' '}
                      <code className="font-mono">{SEED_COMMAND}</code>.
                    </>
                  ) : null}
                </>
              )}
            </EmptyDescription>
          </EmptyHeader>
          {writable ? (
            <EmptyContent className="flex-row justify-center">
              <NewProjectDialog
                trigger={
                  <Button>
                    <PlusIcon data-icon="inline-start" />
                    Neues Projekt
                  </Button>
                }
              />
              {import.meta.env.DEV ? (
                <CopyButton
                  value={SEED_COMMAND}
                  label="Seed-Befehl kopieren"
                  copiedMessage="Befehl kopiert"
                  variant="ghost"
                  size="default"
                />
              ) : null}
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <div className="rounded-xl border bg-card">
          <Table aria-label="Projekte">
            <TableHeader>
              <TableRow>
                <TableHead>Projekt</TableHead>
                {showRole ? <TableHead>Rolle</TableHead> : null}
                <TableHead className="text-right">Offen für dich</TableHead>
                <TableHead className="hidden sm:table-cell">Zuletzt geändert</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.data.map((p) => (
                <ProjectRow key={p.id} project={p} showRole={showRole} demo={mode.demo} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {/* The seed is a developer's tool: only in the dev server (UX1, §3.12 item 3). */}
      {projects.data?.length === 0 || !writable || !import.meta.env.DEV ? null : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <TerminalIcon className="size-4" aria-hidden />
          Testlandschaften laden: <code className="font-mono">{SEED_COMMAND}</code>
        </p>
      )}
    </PageShell>
  );
}

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: ProjectsPage,
});

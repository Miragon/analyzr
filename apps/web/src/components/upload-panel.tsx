import { importModels } from '@analyzr/client';
import type { ExtractWarning, ImportFileOutcome } from '@analyzr/client';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  FilePlusIcon,
  FileUpIcon,
  FolderUpIcon,
  RefreshCwIcon,
  type LucideIcon,
} from 'lucide-react';
import { useRef, useState, type DragEvent, type ReactNode } from 'react';

import { ToneBadge } from '@/components/badges';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api, errorMessage, unwrap } from '@/lib/api';
import type { Tone } from '@/lib/labels';
import { MAX_IMPORT_FILES, MAX_MODEL_BYTES } from '@/lib/limits';
import { formatBytes } from '@/lib/labels';
import { keys } from '@/lib/queries';
import {
  BPMN_ACCEPT,
  BPMN_SUFFIX_TEXT,
  amendmentCountsText,
  entriesFromDataTransfer,
  entriesFromFileList,
  filesOf,
  isSkippedXml,
  planUpload,
  skippedReasonText,
  warningCountText,
  warningDisplay,
  warningLabel,
  type SkippedFile,
  type UploadEntry,
  type UploadPlan,
} from '@/lib/upload';

const OUTCOMES: Record<
  ImportFileOutcome['outcome'],
  { label: string; tone: Tone; icon: LucideIcon }
> = {
  created: { label: 'Neu', tone: 'success', icon: FilePlusIcon },
  revised: { label: 'Neue Revision', tone: 'info', icon: RefreshCwIcon },
  unchanged: { label: 'Unverändert', tone: 'neutral', icon: CircleDashedIcon },
  failed: { label: 'Fehler', tone: 'danger', icon: CircleXIcon },
};

interface UploadRun {
  outcomes: ImportFileOutcome[];
  skipped: SkippedFile[];
  done: boolean;
}

interface ImportProgress {
  outcomes: ImportFileOutcome[];
  skipped: SkippedFile[];
}

/**
 * Sends the files batch by batch; a failing batch marks its files as failed and the rest go on.
 * Files that failed or were skipped before sending come first; a plain `.xml` that is no BPMN
 * joins the skipped files.
 */
async function runImport(
  project: string,
  plan: UploadPlan,
  onProgress: (progress: ImportProgress) => void,
): Promise<ImportProgress> {
  const outcomes: ImportFileOutcome[] = [...plan.failed];
  const skipped: SkippedFile[] = [...plan.skipped];
  for (const batch of plan.batches) {
    try {
      const result = await unwrap(
        importModels({ client: api, path: { project }, body: { files: filesOf(batch) } }),
      );
      for (const file of result.files) {
        if (isSkippedXml(file)) skipped.push({ path: file.path, reason: 'not-bpmn' });
        else outcomes.push(file);
      }
    } catch (error) {
      const detail = errorMessage(error);
      outcomes.push(
        ...batch.map((entry): ImportFileOutcome => ({
          path: entry.path,
          modelKey: null,
          outcome: 'failed',
          problem: {
            type: 'urn:analyzr:problem:internal',
            title: detail,
            status: 0,
            code: 'internal',
          },
        })),
      );
    }
    onProgress({ outcomes: [...outcomes], skipped: [...skipped] });
  }
  return { outcomes, skipped };
}

/**
 * The extractor's warnings of one file: „3 Hinweise“, the entries in a disclosure (M6 S1).
 * Beyond the extractor's 100, its own entry („Weitere Hinweise ausgelassen“) comes last.
 */
function WarningsDisclosure({
  warnings,
  count,
}: {
  warnings: readonly ExtractWarning[];
  count: number;
}) {
  const shown = warningDisplay(warnings, count);
  const entry = (w: ExtractWarning, key: number) => (
    <li key={key} data-testid="import-warning" data-code={w.code}>
      <span className="font-medium text-foreground">{warningLabel(w.code)}</span>
      {w.elementId ? (
        <>
          {' '}
          <code className="font-mono">{w.elementId}</code>
        </>
      ) : null}
      <span lang="en" className="block break-words">
        {w.message}
      </span>
    </li>
  );
  return (
    <details data-testid="import-warnings" className="text-sm">
      <summary className="cursor-pointer text-warning">{warningCountText(shown.count)}</summary>
      <ul className="mt-2 flex flex-col gap-2 text-xs">
        {shown.listed.map(entry)}
        {shown.unlisted > 0 ? <li>… und {shown.unlisted} weitere</li> : null}
        {shown.omitted ? entry(shown.omitted, shown.listed.length) : null}
      </ul>
    </details>
  );
}

/**
 * Drag & drop or pick `.bpmn` files or a whole folder; uploads through
 * `POST …/imports` (≤ 50 files, ≤ 25 MB per request) and shows the outcome
 * per file. A dropped folder is the import root, so `models/vertrieb/a.bpmn`
 * becomes the model key `vertrieb/a`.
 */
export function UploadPanel({
  project,
  renderModelLink,
}: {
  project: string;
  /** Link to an imported model, e.g. into the model view. */
  renderModelLink?: (modelKey: string) => ReactNode;
}) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [run, setRun] = useState<UploadRun | null>(null);
  const busy = run !== null && !run.done;

  async function upload(entries: UploadEntry[]) {
    if (busy) return;
    const plan = planUpload(entries);
    const total = plan.batches.reduce((n, b) => n + b.length, 0) + plan.failed.length;
    if (total === 0) {
      toast({
        tone: 'warning',
        title: 'Keine BPMN-Dateien gefunden',
        description: `Erlaubt sind ${BPMN_SUFFIX_TEXT}, je höchstens 5 MB.`,
      });
      setRun({ outcomes: [], skipped: plan.skipped, done: true });
      return;
    }
    setRun({ outcomes: plan.failed, skipped: plan.skipped, done: false });
    const { outcomes, skipped } = await runImport(project, plan, (partial) =>
      setRun({ ...partial, done: false }),
    );
    setRun({ outcomes, skipped, done: true });
    // Models, landscape and the project list refresh in the background.
    void queryClient.invalidateQueries({ queryKey: keys.project(project) });
    void queryClient.invalidateQueries({ queryKey: keys.projects });
    const failed = outcomes.filter((o) => o.outcome === 'failed').length;
    if (outcomes.length === 0) {
      // Every file was a plain .xml that the server found to be no BPMN: nothing was imported.
      toast({
        tone: 'warning',
        title: 'Keine BPMN-Dateien gefunden',
        description:
          'Die XML-Dateien enthalten kein BPMN-Modell; sie stehen unten als übersprungen.',
      });
    } else if (failed > 0) {
      toast({
        tone: 'danger',
        title: `${failed} von ${outcomes.length} Dateien nicht importiert`,
        description: 'Details stehen in der Tabelle.',
      });
    } else {
      toast({ tone: 'success', title: `${outcomes.length} Dateien importiert` });
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    void entriesFromDataTransfer(event.dataTransfer)
      .then(upload)
      .catch((error: unknown) =>
        toast({
          tone: 'danger',
          title: 'Ablegen fehlgeschlagen',
          description: errorMessage(error),
        }),
      );
  }

  const processed = run?.outcomes.length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div
        data-testid="dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed bg-card px-6 py-12 text-center transition-colors',
          dragging ? 'border-primary bg-accent' : 'border-contour',
        )}
      >
        <FileUpIcon className="size-6 text-muted-foreground" aria-hidden />
        <div className="flex flex-col gap-1">
          <p className="text-base font-semibold">
            {dragging ? 'Dateien hier ablegen' : 'BPMN-Dateien oder einen Ordner hierher ziehen'}
          </p>
          <p className="max-w-2xl text-muted-foreground">
            Der Pfad im Ordner wird zum Modellschlüssel:{' '}
            <code className="font-mono">vertrieb/Auftrag.bpmn</code> →{' '}
            <code className="font-mono">vertrieb/auftrag</code>. Bis {MAX_IMPORT_FILES} Dateien pro
            Anfrage, je höchstens {formatBytes(MAX_MODEL_BYTES)}; größere Mengen teilt analyzr
            selbst auf.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => fileInput.current?.click()} disabled={busy}>
            <FileUpIcon data-icon="inline-start" />
            Dateien auswählen
          </Button>
          <Button variant="outline" onClick={() => folderInput.current?.click()} disabled={busy}>
            <FolderUpIcon data-icon="inline-start" />
            Ordner auswählen
          </Button>
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={BPMN_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label="BPMN-Dateien auswählen"
          data-testid="file-input"
          onChange={(e) => {
            const files = e.target.files ? [...e.target.files] : [];
            e.target.value = '';
            void upload(entriesFromFileList(files));
          }}
        />
        <input
          ref={folderInput}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-label="Ordner auswählen"
          data-testid="folder-input"
          {...{ webkitdirectory: '' }}
          onChange={(e) => {
            const files = e.target.files ? [...e.target.files] : [];
            e.target.value = '';
            void upload(entriesFromFileList(files));
          }}
        />
      </div>

      {run ? (
        <section aria-label="Ergebnis des Imports" className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-base font-semibold" aria-live="polite">
            {run.done ? (
              <CircleCheckIcon className="size-4 text-success" aria-hidden />
            ) : (
              <Spinner />
            )}
            {run.done
              ? `Import abgeschlossen: ${processed} Dateien`
              : `Importiere … ${processed} Dateien fertig`}
          </h2>
          {run.outcomes.length > 0 ? (
            <div className="rounded-xl border bg-card">
              <Table aria-label="Import je Datei">
                <TableHeader>
                  <TableRow>
                    <TableHead>Datei</TableHead>
                    <TableHead>Modell</TableHead>
                    <TableHead>Ergebnis</TableHead>
                    <TableHead>Hinweis</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {run.outcomes.map((o) => {
                    const p = OUTCOMES[o.outcome];
                    return (
                      <TableRow key={o.path} data-testid="import-outcome" data-outcome={o.outcome}>
                        <TableCell className="font-mono text-xs">{o.path}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {o.modelKey ? (renderModelLink?.(o.modelKey) ?? o.modelKey) : '–'}
                        </TableCell>
                        <TableCell>
                          <ToneBadge tone={p.tone} icon={p.icon}>
                            {p.label}
                          </ToneBadge>
                        </TableCell>
                        <TableCell className="whitespace-normal text-muted-foreground">
                          {o.problem ? (o.problem.detail ?? o.problem.title) : null}
                          {amendmentCountsText(o.amendments) ? (
                            <span
                              className={cn(
                                'block',
                                (o.amendments?.conflicts.count ?? 0) > 0 && 'text-warning',
                              )}
                              data-testid="import-amendments"
                            >
                              {amendmentCountsText(o.amendments)}
                              {(o.amendments?.conflicts.count ?? 0) > 0 && o.modelKey ? (
                                <>
                                  {' – '}
                                  <Link
                                    to="/projects/$project/open-questions"
                                    params={{ project }}
                                    search={{ kind: 'amendment-conflict', model: o.modelKey }}
                                    className="text-link underline"
                                    data-testid="import-amendment-conflicts"
                                  >
                                    in „Offene Fragen“ entscheiden
                                  </Link>
                                </>
                              ) : null}
                            </span>
                          ) : null}
                          {o.warningCount ? (
                            <WarningsDisclosure
                              warnings={o.warnings ?? []}
                              count={o.warningCount}
                            />
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : null}
          {run.skipped.length > 0 ? (
            <details className="text-sm text-muted-foreground">
              <summary className="cursor-pointer">
                {run.skipped.length} Dateien übersprungen (kein BPMN, größer als{' '}
                {formatBytes(MAX_MODEL_BYTES)} oder gleicher Modellschlüssel wie eine BPMN-Datei)
              </summary>
              <ul className="mt-2 flex flex-col gap-1 font-mono text-xs">
                {run.skipped.map((s) => (
                  <li key={s.path}>
                    {s.path} – {skippedReasonText(s)}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

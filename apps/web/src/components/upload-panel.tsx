import { importModels } from '@analyzr/client';
import type {
  ExtractWarning,
  ImportFileOutcome,
  ImportImpact,
  ImportWarning,
} from '@analyzr/client';
import { bpmnSuffixOf, isHiddenPath, modelKeyFromPath } from '@analyzr/contracts/paths';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { cn } from 'cn';
import {
  ArrowRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  EyeIcon,
  FilePlusIcon,
  FileUpIcon,
  FolderUpIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from 'lucide-react';
import { useId, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';

import { AgentStart } from '@/components/agent-start';
import { ToneBadge } from '@/components/badges';
import { CopyButton } from '@/components/copy-button';
import { TechnicalDetails } from '@/components/error-text';
import { toast } from '@/lib/toast';
import { claimedImportWarning, useSecondClick } from '@/lib/agent-cost';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
import { api, errorDetail, errorMessage, unwrap } from '@/lib/api';
import type { Tone } from '@/lib/labels';
import { importWarningText } from '@/lib/provenance';
import { useProjectPermissions } from '@/lib/permissions';
import {
  keys,
  landscapeQuery,
  modelsQuery,
  openQuestionSummaryQuery,
  projectSummaryQuery,
  valueChainQuery,
} from '@/lib/queries';
import { isBulkCall } from '@/lib/review';
import {
  BPMN_ACCEPT,
  BPMN_SUFFIX_TEXT,
  INTEGRATE_SKILL,
  amendmentCountsText,
  askNowText,
  batchNoteText,
  callsWaitingText,
  entriesFromDataTransfer,
  entriesFromFileList,
  fileProblemText,
  filesOf,
  groupWarnings,
  identityUpdateText,
  importHeadline,
  impactLines,
  isSkippedXml,
  mergeImpacts,
  placementChangeText,
  planUpload,
  previewHeadline,
  problemDetail,
  rejudgedText,
  sharedTopFolder,
  skippedGroupText,
  skippedReasonText,
  skippedText,
  waitingText,
  warningCountText,
  warningDisplay,
  warningGroupCount,
  warningLabel,
  type SkippedFile,
  type UploadEntry,
  type UploadPlan,
  type WarningGroup,
} from '@/lib/upload';
import {
  bundleFiles,
  bundleSummary,
  manifestSubset,
  readManifest,
  type BundleSummary,
  type LoadedManifest,
  type ManifestRead,
} from '@/lib/upload-manifest';

const OUTCOMES: Record<
  ImportFileOutcome['outcome'],
  { label: string; tone: Tone; icon: LucideIcon }
> = {
  created: { label: 'Neu', tone: 'success', icon: FilePlusIcon },
  revised: { label: 'Neue Revision', tone: 'info', icon: RefreshCwIcon },
  unchanged: { label: 'Unverändert', tone: 'neutral', icon: CircleDashedIcon },
  failed: { label: 'Fehler', tone: 'danger', icon: CircleXIcon },
};

/** The outcome column of a preview (M6 S2b): what the file would become. */
const PREVIEW_OUTCOMES: typeof OUTCOMES = {
  created: { label: 'Wird neu', tone: 'success', icon: FilePlusIcon },
  revised: { label: 'Neue Revision', tone: 'info', icon: RefreshCwIcon },
  unchanged: { label: 'Unverändert', tone: 'neutral', icon: CircleDashedIcon },
  failed: { label: 'Fehler', tone: 'danger', icon: CircleXIcon },
};

/**
 * A file's outcome as its row shows it; a file of a batch that failed as a
 * whole carries the server's own words for „Technische Details“.
 */
type RowOutcome = ImportFileOutcome & { technical?: string | undefined };

interface UploadRun {
  outcomes: RowOutcome[];
  skipped: SkippedFile[];
  done: boolean;
  /** The files that are sent or failed before sending (the progress' whole). */
  total: number;
  /** The recognized bundle (UX8), `null` for plain files. */
  bundle: BundleSummary | null;
  /** M6 S2b: the dry run before „Importieren“ (with its impact once done), or the import. */
  mode: 'preview' | 'import';
  impact?: ImportImpact | null;
}

/** A previewed drop, waiting for „Importieren“: what to send, as the preview sent it. */
interface Pending {
  plan: UploadPlan;
  manifest: LoadedManifest | null;
  bundle: BundleSummary | null;
  total: number;
}

interface ImportProgress {
  outcomes: RowOutcome[];
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
  manifest: LoadedManifest | null,
  dryRun = false,
): Promise<ImportProgress & { impact: ImportImpact | null }> {
  const outcomes: RowOutcome[] = [...plan.failed];
  const skipped: SkippedFile[] = [...plan.skipped];
  const impacts: ImportImpact[] = [];
  for (const batch of plan.batches) {
    // With a bundle each batch sends its subset of the manifest, as `analyzr import` does; a
    // preview sends the whole manifest, so every batch knows which keys the bundle names.
    const subset =
      manifest === null
        ? null
        : dryRun
          ? manifest.manifest
          : manifestSubset(
              manifest,
              batch.map((e) => e.path),
            );
    try {
      const result = await unwrap(
        importModels({
          client: api,
          path: { project },
          ...(dryRun ? { query: { dryRun: 'true' as const } } : {}),
          body: {
            files: filesOf(batch),
            ...(subset !== null && subset.files.length > 0
              ? { manifest: JSON.stringify(subset) }
              : {}),
          },
        }),
      );
      for (const file of result.files) {
        if (isSkippedXml(file)) skipped.push({ path: file.path, reason: 'not-bpmn' });
        else outcomes.push(file);
      }
      if (result.impact) impacts.push(result.impact);
    } catch (error) {
      // The German sentence in the row, the server's reason (which file, which path) behind
      // „Technische Details“.
      const detail = errorMessage(error);
      const technical = errorDetail(error);
      outcomes.push(
        ...batch.map((entry): RowOutcome => ({
          path: entry.path,
          modelKey: null,
          outcome: 'failed',
          problem: {
            type: 'urn:analyzr:problem:internal',
            title: detail,
            status: 0,
            code: 'internal',
          },
          technical,
        })),
      );
    }
    onProgress({ outcomes: [...outcomes], skipped: [...skipped] });
  }
  return { outcomes, skipped, impact: dryRun ? mergeImpacts(impacts) : null };
}

/** One entry of a file's warnings: a group of skipped elements, or a single warning. */
function WarningEntry({ group }: { group: WarningGroup }) {
  if (group.kind === 'skipped') {
    const { what, effect } = skippedGroupText(group);
    return (
      <li data-testid="import-warning" data-code={group.cause} className="flex flex-col gap-0.5">
        <span className="font-medium text-foreground">{what}</span>
        <span>
          {effect} Mit <code className="font-mono">{INTEGRATE_SKILL}</code> bereinigen und erneut
          hochladen.
        </span>
        <TechnicalDetails detail={group.raw.map((w) => w.message).join('\n')} />
      </li>
    );
  }
  const w = group.warning;
  return (
    <li data-testid="import-warning" data-code={w.code} className="flex flex-col gap-0.5">
      <span>
        <span className="font-medium text-foreground">{warningLabel(w.code)}</span>
        {w.elementId ? (
          <>
            {' '}
            <code className="font-mono">{w.elementId}</code>
          </>
        ) : null}
      </span>
      <TechnicalDetails detail={w.message} />
    </li>
  );
}

/**
 * The extractor's warnings of one file (M6 S1; grouped in UX7,
 * UX-SIMPLIFICATION.md §3.9 item 3): „2 Hinweise“, the entries in a
 * disclosure, skipped elements by cause in one entry with what that means and
 * the fix, bpmn-moddle's English behind „Technische Details“. Beyond the
 * extractor's 100, its own entry („Weitere Hinweise ausgelassen“) comes last.
 */
function WarningsDisclosure({
  warnings,
  count,
  identity = [],
}: {
  warnings: readonly ExtractWarning[];
  count: number;
  /** The file's identity warnings against its manifest or the landscape (UX8), listed first. */
  identity?: readonly ImportWarning[];
}) {
  const shown = warningDisplay(warnings, count);
  const groups = groupWarnings(shown.listed);
  return (
    <details data-testid="import-warnings" className="text-sm">
      <summary className="cursor-pointer text-warning">
        {warningCountText(warningGroupCount(groups, shown.unlisted) + identity.length)}
      </summary>
      <ul className="mt-2 flex flex-col gap-2 text-xs">
        {identity.map((w, i) => (
          <li
            key={`identity-${i}`}
            data-testid="import-identity-warning"
            data-code={w.code}
            className="flex flex-col gap-0.5"
          >
            <span className="text-foreground">{importWarningText(w)}</span>
            <TechnicalDetails detail={w.message} />
          </li>
        ))}
        {groups.map((g, i) => (
          <WarningEntry key={i} group={g} />
        ))}
        {shown.unlisted > 0 ? <li>… und {shown.unlisted} weitere</li> : null}
        {shown.omitted ? <WarningEntry group={{ kind: 'single', warning: shown.omitted }} /> : null}
      </ul>
    </details>
  );
}

/** Why a file failed, in German, the server's words behind „Technische Details“. */
function FailedText({ outcome }: { outcome: RowOutcome }) {
  if (!outcome.problem) return null;
  // A file of a batch that failed as a whole: the German sentence is the problem's title.
  if (outcome.technical !== undefined)
    return (
      <>
        <span className="block">{outcome.problem.title}</span>
        <TechnicalDetails detail={outcome.technical} />
      </>
    );
  return (
    <>
      <span className="block" data-testid="import-problem">
        {fileProblemText(outcome.problem)}
      </span>
      <TechnicalDetails detail={problemDetail(outcome.problem)} />
    </>
  );
}

/**
 * What comes after an import (§3.9 item 2, the web twin of `analyzr
 * import`'s `formatNextSteps`): first the unique calls from derived models
 * waiting for a human (M6 S2c, `isBulkCall` over the landscape, so the
 * number equals the selection of the bulk dialog „Gesammelt annehmen“
 * opens; reviewers only), then what waits for the agent with „Agent starten“
 * (owners; „Agent verbinden“ without a token), the questions there are
 * already, and „Zur Übersicht“. The counts are the shell's queries, fresh
 * once the import's refresh is done (`fresh`).
 */
function NextSteps({
  project,
  fresh,
  valueChain,
}: {
  project: string;
  fresh: boolean;
  /** The bundle carries a value chain (UX8): the chain page imports it. */
  valueChain: boolean;
}) {
  const models = useQuery(modelsQuery(project));
  const chain = useQuery(valueChainQuery(project));
  const summary = useQuery(openQuestionSummaryQuery(project));
  const landscape = useQuery(landscapeQuery(project));
  const can = useProjectPermissions(project);
  const calls = can.canReview
    ? callsWaitingText(landscape.data?.relations.filter(isBulkCall).length ?? 0)
    : null;
  const waitingModels = models.data?.filter((m) => m.stage === 'waiting_for_agent').length ?? 0;
  // The agents' next run (S2b follow-up step 3b), from a summary fetched after the import only
  // (a failed fetch counts as fetched after mount too, with the data from before it); an older
  // server's summary without the field leaves `waitingText`'s default, no pairs.
  const next = useQuery({ ...projectSummaryQuery(project), enabled: fresh && waitingModels > 0 });
  const waiting = waitingText(
    waitingModels,
    chain.data?.pipeline.task?.state === 'queued',
    next.isSuccess && next.isFetchedAfterMount ? next.data.pairsToJudge : 0,
  );
  const ask = askNowText(summary.data?.totals.ask ?? 0);
  return (
    <section
      aria-labelledby="upload-next-title"
      aria-busy={!fresh || undefined}
      className="flex flex-col items-start gap-2 rounded-xl border bg-card px-4 py-3"
      data-testid="upload-next"
    >
      <h3 id="upload-next-title" className="text-sm font-semibold text-muted-foreground">
        Als Nächstes
      </h3>
      {!fresh ? (
        <Skeleton className="h-8 w-72" data-testid="upload-next-loading" />
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {calls ? (
            <li
              className="flex flex-wrap items-center gap-x-2 gap-y-1"
              data-testid="upload-next-calls"
            >
              <span>{calls}</span>
              <span aria-hidden>·</span>
              <Link
                to="/projects/$project/review"
                params={{ project }}
                search={{ bulk: 'calls' }}
                className="text-link underline-offset-4 hover:underline"
              >
                Gesammelt annehmen
              </Link>
            </li>
          ) : null}
          {waiting ? (
            <li
              className="flex flex-wrap items-center gap-x-2 gap-y-1"
              data-testid="upload-next-agent"
            >
              <span>{waiting}</span>
              <AgentStart project={project} hasChain={chain.data != null} size="sm" />
            </li>
          ) : null}
          {valueChain ? (
            <li
              className="flex flex-wrap items-center gap-x-2 gap-y-1"
              data-testid="upload-next-chain"
            >
              <span>Das Bundle enthält eine Wertschöpfungskette</span>
              <span aria-hidden>·</span>
              <Link
                to="/projects/$project/value-chain"
                params={{ project }}
                className="text-link underline-offset-4 hover:underline"
              >
                Auf der Kette importieren
              </Link>
            </li>
          ) : null}
          {ask ? (
            <li
              className="flex flex-wrap items-center gap-x-2 gap-y-1"
              data-testid="upload-next-questions"
            >
              <span>{ask}</span>
              <span aria-hidden>·</span>
              <Link
                to="/projects/$project/open-questions"
                params={{ project }}
                className="text-link underline-offset-4 hover:underline"
              >
                Offene Fragen ansehen
              </Link>
            </li>
          ) : null}
        </ul>
      )}
      <Button asChild variant="outline" size="sm">
        <Link to="/projects/$project" params={{ project }} data-testid="upload-overview">
          Zur Übersicht
          <ArrowRightIcon data-icon="inline-end" />
        </Link>
      </Button>
    </section>
  );
}

/** `a#Call_X → b#Process_Y`. */
const arrow = (r: { from: string; to: string }) => `${r.from} → ${r.to}`;

/** One capped list of „Was ändert sich?“, with its count. */
function ImpactList({ title, list }: { title: string; list: { count: number; items: string[] } }) {
  return (
    <div data-testid="preview-list">
      <p className="text-muted-foreground">
        {title} ({list.count})
      </p>
      <ul className="mt-0.5 flex flex-col gap-0.5 font-mono text-xs break-all">
        {list.items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
        {list.count > list.items.length ? (
          <li>… und {list.count - list.items.length} weitere</li>
        ) : null}
      </ul>
    </div>
  );
}

/** The capped lists of „Was ändert sich?“ in their order, empty ones included. */
function impactLists(impact: ImportImpact): { title: string; count: number; items: string[] }[] {
  return [
    {
      title: 'Automatisch verknüpfte Aufrufe',
      count: impact.acceptedCalls.count,
      items: impact.acceptedCalls.items.map(arrow),
    },
    {
      title: 'Aufrufe als Vorschlag',
      count: impact.callsProposed.count,
      items: impact.callsProposed.items.map(
        (r) => `${arrow(r)}${r.wasAccepted ? ' (bisher angenommen)' : ''}`,
      ),
    },
    {
      title: 'Angenommene Relationen mit geändertem oder fehlendem Endpunkt',
      count: impact.endpointsChanged.count,
      items: impact.endpointsChanged.items.map(
        (r) => `${arrow(r)} (${r.endpointState === 'missing' ? 'fehlt' : 'geändert'})`,
      ),
    },
    {
      title: 'Angenommene Platzierungen mit geändertem oder fehlendem Prozess',
      count: impact.placementsChanged?.count ?? 0,
      items: (impact.placementsChanged?.items ?? []).map(placementChangeText),
    },
    {
      title: 'Neue Vorschläge der Regeln',
      count: impact.proposalsAdded.count,
      items: impact.proposalsAdded.items.map(arrow),
    },
    {
      title: 'Zurückgezogene Vorschläge der Regeln',
      count: impact.proposalsWithdrawn.count,
      items: impact.proposalsWithdrawn.items.map(arrow),
    },
    {
      title: 'Modelle des Quellsystems, die nicht im Bundle sind (bleiben erhalten)',
      ...impact.absentKeys,
    },
    {
      title: 'Neue Befunde',
      count: impact.findingsAdded.count,
      items: impact.findingsAdded.items.map((f) => f.detail),
    },
    {
      title: 'Mögliche Relationen, die erneut beurteilt werden',
      count: impact.relationsTasks.rejudged.count,
      items: impact.relationsTasks.rejudged.items.map(rejudgedText),
    },
  ];
}

/**
 * The preview's box (UX-SIMPLIFICATION.md §6, M6 S2b): at most three lines of
 * what the import would change (since S2b's follow-up the last one the agent
 * work it sets off; when no file would be new or revised, since its step 5
 * the unchanged files whose bundle records a new place in the tool), the
 * capped lists behind „Was ändert sich?“ (only when one has items: the cost
 * line's pairs have none), the hint when every key starts with one folder
 * (keys are fixed for good), the note for a preview of several batches, the
 * warning when the import cancels relations tasks an agent holds (then
 * without the „keine Änderung“ fallback), then „Importieren“ (while that
 * warning shows, `armed` after the first click: „Trotzdem importieren“) and
 * „Abbrechen“.
 */
function PreviewBox({
  run,
  batches,
  batchNote,
  canImport,
  armed,
  onImport,
  onCancel,
}: {
  run: UploadRun;
  batches: number;
  batchNote: string | null;
  canImport: boolean;
  armed: boolean;
  onImport: (event: MouseEvent<HTMLButtonElement>) => void;
  onCancel: () => void;
}) {
  const claimedId = useId();
  const impact = run.impact;
  // Beside a new or revised file the recorded places go along unnamed, as stored provenance does.
  const stored = run.outcomes.some((o) => o.outcome === 'created' || o.outcome === 'revised');
  const identities = stored ? 0 : run.outcomes.filter((o) => o.identityUpdated).length;
  const lines = impact
    ? [...impactLines(impact, batches), ...(identities > 0 ? [identityUpdateText(identities)] : [])]
    : [];
  const lists = impact ? impactLists(impact).filter((l) => l.count > 0) : [];
  const warning = impact ? claimedImportWarning(impact.relationsTasks) : null;
  const keys = run.outcomes.flatMap((o) =>
    o.outcome !== 'failed' && o.modelKey ? [o.modelKey] : [],
  );
  const folder = sharedTopFolder(keys);
  return (
    <section
      aria-label="Vorschau des Imports"
      className="flex flex-col items-start gap-2 rounded-xl border bg-card px-4 py-3 text-sm"
      data-testid="upload-preview"
    >
      {impact ? (
        lines.length > 0 ? (
          <p data-testid="preview-impact">Danach: {lines.join(' · ')}</p>
        ) : warning ? null : (
          <p data-testid="preview-impact">Danach: keine Änderung an Relationen und Befunden.</p>
        )
      ) : null}
      {folder ? (
        <p className="text-warning" data-testid="preview-folder">
          Alle Kurznamen beginnen mit „{folder}/“ – leg den Unterordner ab, wenn das nicht Teil der
          Namen sein soll.
        </p>
      ) : null}
      {batchNote ? (
        <p className="text-muted-foreground" data-testid="preview-batches">
          {batchNote}
        </p>
      ) : null}
      {lists.length > 0 ? (
        <details className="w-full" data-testid="preview-details">
          <summary className="cursor-pointer text-muted-foreground">Was ändert sich?</summary>
          <div className="mt-2 flex flex-col gap-2">
            {lists.map((l) => (
              <ImpactList key={l.title} title={l.title} list={l} />
            ))}
          </div>
        </details>
      ) : null}
      {warning ? (
        <Alert variant="destructive" id={claimedId} data-testid="preview-claimed">
          <TriangleAlertIcon />
          <AlertTitle>{warning.title}</AlertTitle>
          <AlertDescription>{warning.description}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canImport ? (
          <Button
            variant={armed ? 'destructive' : 'default'}
            onClick={onImport}
            aria-describedby={warning ? claimedId : undefined}
            data-testid="preview-import"
          >
            <FileUpIcon data-icon="inline-start" />
            {armed ? 'Trotzdem importieren' : 'Importieren'}
          </Button>
        ) : null}
        <Button variant="outline" onClick={onCancel} data-testid="preview-cancel">
          {canImport ? 'Abbrechen' : 'Schließen'}
        </Button>
      </div>
    </section>
  );
}

/** The skipped files in one line, all of them behind „und N weitere“. */
function SkippedLine({ skipped }: { skipped: readonly SkippedFile[] }) {
  const { text, more } = skippedText(skipped);
  return (
    <div className="text-sm text-muted-foreground" data-testid="import-skipped">
      <p>{text}</p>
      {more > 0 ? (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs">Alle übersprungenen Dateien</summary>
          <ul className="mt-1 flex flex-col gap-1 font-mono text-xs">
            {skipped.map((s) => (
              <li key={s.path}>
                {s.path} – {skippedReasonText(s)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/**
 * Drag & drop or pick `.bpmn` files or a whole folder; uploads through
 * `POST …/imports` (≤ 50 files, ≤ 25 MB per request) and shows the outcome
 * per file (UX-SIMPLIFICATION.md §3.9): the headline, one row per model
 * with its file below, the German reason of a failure, the grouped
 * warnings, the skipped files in one line, and what comes next. A dropped
 * folder is the import root, so `models/vertrieb/a.bpmn` becomes the model
 * key `vertrieb/a`.
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
  /** The project's queries have refreshed after the import („Als Nächstes“ counts). */
  const [fresh, setFresh] = useState(false);
  /** The previewed drop „Importieren“ sends (M6 S2b); `null` while nothing waits. */
  const [pending, setPending] = useState<Pending | null>(null);
  /** A bundle whose manifest stopped the upload before anything was sent. */
  const [refused, setRefused] = useState<Extract<ManifestRead, { kind: 'refused' }> | null>(null);
  const busy = run !== null && !run.done;
  // S2b follow-up: an import that cancels relations tasks an agent holds asks a second time; a
  // new preview (a new `pending`) disarms.
  const second = useSecondClick((run?.impact?.relationsTasks.claimed ?? 0) > 0, pending);

  async function upload(entries: UploadEntry[]) {
    if (busy) return;
    setFresh(false);
    // A bundle's manifest at the folder root pins the keys and declares the provenance (UX8).
    const read = await readManifest(entries);
    if (read.kind === 'refused') {
      setRun(null);
      setRefused(read);
      toast({ tone: 'danger', title: 'Bundle nicht importiert', description: read.reason });
      return;
    }
    setRefused(null);
    const manifest = read.kind === 'ok' ? read.loaded : null;
    const plan = planUpload(
      entries,
      undefined,
      manifest
        ? {
            keyOf: (p) => manifest.byPath.get(p)?.key ?? modelKeyFromPath(p),
            own: bundleFiles(manifest),
          }
        : {},
    );
    const bundle = manifest
      ? bundleSummary(
          manifest,
          entries
            .filter((e) => !isHiddenPath(e.path) && bpmnSuffixOf(e.path) !== null)
            .map((e) => e.path),
        )
      : null;
    const total = plan.batches.reduce((n, b) => n + b.length, 0) + plan.failed.length;
    setPending(null);
    if (total === 0) {
      toast({
        tone: 'warning',
        title: 'Keine BPMN-Dateien gefunden',
        description: `Erlaubt sind ${BPMN_SUFFIX_TEXT}, je höchstens 5 MB.`,
      });
      setRun({ outcomes: [], skipped: plan.skipped, done: true, total, bundle, mode: 'import' });
      return;
    }
    // M6 S2b: the dry run first, in the result's own layout; „Importieren“ sends the same.
    const base = { total, bundle, mode: 'preview' as const };
    setRun({ outcomes: plan.failed, skipped: plan.skipped, done: false, ...base });
    const preview = await runImport(
      project,
      plan,
      (partial) => setRun({ ...partial, done: false, ...base }),
      manifest,
      true,
    );
    setRun({
      outcomes: preview.outcomes,
      skipped: preview.skipped,
      done: true,
      impact: preview.impact,
      ...base,
    });
    // Also for unchanged files whose bundle records a new place in the tool (S2b follow-up step 5).
    if (
      preview.outcomes.some(
        (o) => o.outcome === 'created' || o.outcome === 'revised' || o.identityUpdated,
      )
    )
      setPending({ plan, manifest, bundle, total });
    else if (preview.outcomes.length === 0) {
      // Every file was a plain .xml that the server found to be no BPMN: nothing to import.
      toast({
        tone: 'warning',
        title: 'Keine BPMN-Dateien gefunden',
        description:
          'Die XML-Dateien enthalten kein BPMN-Modell; sie stehen unten als übersprungen.',
      });
    }
  }

  /** „Importieren“: the previewed drop, for real. */
  async function confirm() {
    if (!pending) return;
    const { plan, manifest, bundle, total } = pending;
    setPending(null);
    setRun({
      outcomes: plan.failed,
      skipped: plan.skipped,
      done: false,
      total,
      bundle,
      mode: 'import',
    });
    const { outcomes, skipped } = await runImport(
      project,
      plan,
      (partial) => setRun({ ...partial, done: false, total, bundle, mode: 'import' }),
      manifest,
    );
    setRun({ outcomes, skipped, done: true, total, bundle, mode: 'import' });
    // Models, landscape, chain and questions refresh; „Als Nächstes“ waits for them.
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.project(project) }),
      queryClient.invalidateQueries({ queryKey: keys.projects }),
    ]).finally(() => setFresh(true));
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
          error,
        }),
      );
  }

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
          'flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed bg-card px-6 py-10 text-center transition-colors',
          dragging ? 'border-primary bg-accent' : 'border-contour',
        )}
      >
        <FileUpIcon className="size-6 text-muted-foreground" aria-hidden />
        <div className="flex flex-col gap-1">
          <p className="text-base font-semibold">
            {dragging ? (
              'Dateien hier ablegen'
            ) : (
              <>
                <span className="pointer-coarse:hidden">
                  BPMN-Dateien oder einen Ordner hierher ziehen.
                </span>
                <span className="hidden pointer-coarse:inline">
                  BPMN-Dateien oder einen Ordner auswählen.
                </span>
              </>
            )}
          </p>
          <p className="max-w-2xl text-muted-foreground">
            Der Ordnerpfad wird zum Kurznamen, z. B.{' '}
            <code className="font-mono">finanzen/mahnwesen</code>.
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
        <p
          className="flex max-w-2xl flex-wrap items-center justify-center gap-x-1 gap-y-1 text-sm text-muted-foreground"
          data-testid="dropzone-convert"
        >
          <span>Export aus Signavio, ARIS oder Visio? Wandle ihn zuerst mit</span>
          <code className="font-mono text-foreground">{INTEGRATE_SKILL}</code>
          <CopyButton
            value={INTEGRATE_SKILL}
            label="Kopieren"
            aria-label="Befehl zum Umwandeln kopieren"
            copiedMessage="Befehl kopiert"
          />
          <span>um und leg dann den Bundle-Ordner hier ab.</span>
        </p>
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

      {refused ? (
        <Alert variant="destructive" data-testid="upload-refused">
          <AlertTitle>Bundle nicht importiert</AlertTitle>
          <AlertDescription>
            <p>{refused.reason}</p>
            <TechnicalDetails detail={refused.detail} />
          </AlertDescription>
        </Alert>
      ) : null}

      {run ? (
        <section aria-label="Ergebnis des Imports" className="flex flex-col gap-3">
          {run.bundle ? (
            <div className="text-sm text-muted-foreground" data-testid="upload-bundle">
              <p>{run.bundle.line}</p>
              {run.bundle.unlisted ? <p>{run.bundle.unlisted}</p> : null}
            </div>
          ) : null}
          <h2
            className="flex items-center gap-2 text-base font-semibold"
            aria-live="polite"
            data-testid="import-headline"
          >
            {!run.done ? (
              <Spinner />
            ) : run.mode === 'preview' ? (
              <EyeIcon className="size-4 text-muted-foreground" aria-hidden />
            ) : (
              <CircleCheckIcon className="size-4 text-success" aria-hidden />
            )}
            {run.mode === 'preview'
              ? run.done
                ? previewHeadline(run.outcomes, run.skipped.length)
                : `Vorschau … ${run.outcomes.length} von ${run.total} ${run.total === 1 ? 'Datei' : 'Dateien'}`
              : importHeadline(
                  run.outcomes,
                  run.skipped.length,
                  run.done ? undefined : { total: run.total },
                )}
          </h2>
          {run.mode === 'preview' && run.done ? (
            <PreviewBox
              run={run}
              batches={pending?.plan.batches.length ?? 1}
              batchNote={pending ? batchNoteText(pending.plan.batches, run.outcomes) : null}
              canImport={pending !== null}
              armed={second.armed}
              onImport={(event) => {
                if (!second.repeated(event) && second.confirm()) void confirm();
              }}
              onCancel={() => {
                setPending(null);
                setRun(null);
              }}
            />
          ) : null}
          {run.mode === 'import' && run.done && run.outcomes.length > 0 ? (
            <NextSteps
              project={project}
              fresh={fresh}
              valueChain={run.bundle?.valueChain != null}
            />
          ) : null}
          {run.outcomes.length > 0 ? (
            <div className="rounded-xl border bg-card">
              <Table aria-label="Import je Datei">
                <TableHeader>
                  <TableRow>
                    <TableHead>Modell</TableHead>
                    <TableHead>Ergebnis</TableHead>
                    <TableHead>Hinweis</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {run.outcomes.map((o) => {
                    const p = (run.mode === 'preview' ? PREVIEW_OUTCOMES : OUTCOMES)[o.outcome];
                    return (
                      <TableRow key={o.path} data-testid="import-outcome" data-outcome={o.outcome}>
                        <TableCell className="align-top">
                          <span className="flex flex-col gap-0.5">
                            {o.modelKey && o.outcome !== 'failed' ? (
                              <span className="font-mono text-xs">
                                {renderModelLink?.(o.modelKey) ?? o.modelKey}
                              </span>
                            ) : null}
                            <span
                              className="font-mono text-xs break-all text-muted-foreground"
                              data-testid="import-path"
                            >
                              {o.path}
                            </span>
                          </span>
                        </TableCell>
                        <TableCell className="align-top">
                          <ToneBadge tone={p.tone} icon={p.icon}>
                            {p.label}
                          </ToneBadge>
                        </TableCell>
                        <TableCell className="align-top whitespace-normal text-muted-foreground">
                          <FailedText outcome={o} />
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
                          {o.warningCount || o.importWarnings?.length ? (
                            <WarningsDisclosure
                              warnings={o.warnings ?? []}
                              count={o.warningCount ?? 0}
                              identity={o.importWarnings ?? []}
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
          {run.skipped.length > 0 ? <SkippedLine skipped={run.skipped} /> : null}
        </section>
      ) : null}
    </div>
  );
}

import type {
  AmendProcessSuggestion,
  AmendableField,
  AmendmentExportFormat,
  Model,
  ModelAmendment,
} from '@analyzr/client';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRightIcon,
  ChevronDownIcon,
  FileDownIcon,
  HistoryIcon,
  PenLineIcon,
  TriangleAlertIcon,
  Undo2Icon,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { ToneBadge } from '@/components/badges';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import {
  amendableQuery,
  amendedElements,
  bpmnFileName,
  downloadChangeList,
  downloadRevision,
  fieldLabel,
  isLive,
  isNotFound,
  modelRevisionsQuery,
  planCounts,
  refusalLabel,
  revisionOrigin,
  ONLY_OPEN_QUESTIONS_TEXT,
  stateText,
  stateTone,
  valueText,
  withdrawnToast,
} from '@/lib/amendments';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/labels';
import { useProjectPermissions } from '@/lib/permissions';
import type { RefResolver } from '@/lib/refs';
import { toast } from '@/lib/toast';

import { AmendForm } from './amend-form';
import { WithdrawConfirm } from './withdraw-confirm';

export { default as CollectBar } from './collect-bar';
/** The change list for the project's export hub on „Übersicht“ (UX1), loaded with this module. */
// eslint-disable-next-line react-refresh/only-export-components -- a lazy module's helper
export { downloadChangeList } from '@/lib/amendments';

/**
 * Model amendments in the model view (M6 §4.8 c "Web", S5c-2), one lazy
 * module the view imports several times (so it adds one chunk): the section
 * „Ergänzen“ for the selected element (its amendable fields with the form,
 * its history with „Zurücknehmen“), the header's badge „In analyzr ergänzt
 * (n)“ naming the uploaded revision with the downloads and the revisions,
 * the collection's bar, and the change list for the models tab.
 */

// ------------------------------------------------------------------ the section

/** The element's name for the form's label: the message's name, else the facts' label, else its id. */
function elementName(field: AmendableField, modelKey: string, resolve: RefResolver): string {
  if (field.element === 'message' || field.element === 'signal')
    return field.value ?? field.elementId;
  const id = field.viaElementId ?? field.elementId;
  return resolve(`${modelKey}#${id}`).label ?? id;
}

/** A call target as the human picked it: the process's name and model, its id small. */
function TargetValue({
  value,
  processes,
}: {
  value: string | null;
  processes: readonly AmendProcessSuggestion[];
}) {
  const p = value ? processes.find((x) => x.processId === value) : undefined;
  if (!p) return <span>{valueText(value)}</span>;
  return (
    <span>
      Prozess „{p.name}“{' '}
      <span className="text-muted-foreground">({p.modelName ?? p.modelKey})</span>{' '}
      <span className="font-mono text-xs text-muted-foreground">{p.processId}</span>
    </span>
  );
}

function HistoryItem({
  a,
  canAmend,
  project,
  field,
  processes,
  onWithdrawn,
}: {
  a: ModelAmendment;
  canAmend: boolean;
  project: string;
  /** The field's German name („Nachrichtenname“), else by its op. */
  field: string;
  /** A call target's processes, to show a target by its name. */
  processes: readonly AmendProcessSuggestion[];
  onWithdrawn: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const confirmId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const value = (v: string | null) =>
    a.op === 'call-target' ? <TargetValue value={v} processes={processes} /> : valueText(v);
  return (
    <li
      className="flex flex-col gap-1 rounded-lg border p-2 text-sm"
      data-testid="amend-history-item"
      data-state={a.state}
      data-amendment-id={a.id}
    >
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">{field}</span>
        <ToneBadge tone={stateTone(a)}>{stateText(a)}</ToneBadge>
      </span>
      <span className="flex flex-wrap items-center gap-1.5 break-words">
        <span className="text-muted-foreground">{value(a.before)}</span>
        <ArrowRightIcon className="size-3.5 shrink-0" aria-label="wurde zu" />
        <span>{value(a.after)}</span>
      </span>
      <span className="text-xs text-muted-foreground">
        {a.by} · {formatDateTime(a.at)}
        {a.withdrawal ? ` · beendet ${formatDateTime(a.withdrawal.at)} von ${a.withdrawal.by}` : ''}
      </span>
      {canAmend && isLive(a) && !a.modelDeleted ? (
        <div>
          <Button
            ref={button}
            variant="outline"
            size="xs"
            onClick={() => setConfirming((c) => !c)}
            aria-expanded={confirming}
            aria-controls={confirmId}
            data-testid="amend-withdraw"
          >
            <Undo2Icon data-icon="inline-start" />
            Zurücknehmen …
          </Button>
        </div>
      ) : null}
      {confirming ? (
        <div id={confirmId} className="rounded-lg border bg-muted/40 p-2.5">
          <WithdrawConfirm
            project={project}
            target={{ amendment: a.id }}
            confirmLabel="Zurücknehmen"
            onCancel={() => {
              setConfirming(false);
              requestAnimationFrame(() => button.current?.focus());
            }}
            onDone={(result) => {
              setConfirming(false);
              toast(withdrawnToast(result));
              onWithdrawn();
            }}
          />
        </div>
      ) : null}
    </li>
  );
}

/**
 * „Ergänzen“ for the selected element (M6 §4.8 c "Web"): each field it
 * allows with its value (and the source tool's, where an amendment changed
 * it), the form where it can be set and what to do elsewhere, and its
 * amendment history (who, when, before → after, state, „Zurücknehmen …“
 * with the withdrawal's cost). Shown only where this user can set a field or
 * the element has a history; the heading says „Ergänzungen“ when nothing can
 * be set here (a viewer, the read-only demo, history only). The edit buttons
 * stay mounted (`aria-expanded`), so the focus returns to them when the form
 * closes or saves; after a withdrawal it moves to the heading.
 */
export default function AmendSection({
  project,
  model,
  elementId,
  resolve,
}: {
  project: string;
  model: Pick<Model, 'id' | 'key' | 'name'>;
  elementId: string;
  resolve: RefResolver;
}) {
  const query = useQuery(amendableQuery(project, model.id, elementId));
  const can = useProjectPermissions(project);
  const canAmend = can.canReview && can.canWrite;
  const [editing, setEditing] = useState<string | null>(null);
  const formId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());

  if (query.isPending) return <Skeleton className="mb-2 h-12" />;
  if (query.isError) {
    if (isNotFound(query.error)) return null;
    return (
      <p className="px-2 pb-2 text-sm text-destructive">
        Ergänzbare Felder konnten nicht geladen werden: {errorMessage(query.error)}
      </p>
    );
  }
  const { fields, history } = query.data;
  const keyOf = (f: AmendableField) => `${f.op}:${f.elementId}`;
  const settable = canAmend && fields.some((f) => f.settable);
  if (!settable && history.length === 0) return null;
  // Nothing to set here: only the fields an amendment touched, for context.
  const shown = settable ? fields : fields.filter((f) => f.live !== null);
  const processes = fields.flatMap((f) => f.suggestions.processes ?? []);
  const fieldOf = (a: ModelAmendment) =>
    fields.find((f) => f.op === a.op && f.elementId === a.elementId)?.fieldLabel ??
    fieldLabel(a.op);

  function close(key: string) {
    setEditing(null);
    requestAnimationFrame(() => buttons.current.get(key)?.focus());
  }

  return (
    <section
      aria-labelledby="model-amend"
      className="mb-2 flex flex-col gap-2 rounded-lg border bg-card p-2.5"
      data-testid="amend-section"
    >
      <h3
        id="model-amend"
        ref={heading}
        tabIndex={-1}
        className="flex items-center gap-1.5 text-sm font-semibold outline-none"
      >
        <PenLineIcon className="size-3.5" aria-hidden />
        {settable ? 'Ergänzen' : 'Ergänzungen'}
      </h3>
      {shown.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {shown.map((f) => {
            const key = keyOf(f);
            const label = `${f.typeLabel} „${elementName(f, model.key, resolve)}“`;
            const open = editing === key;
            const differs = (f.value ?? '') !== (f.uploadedValue ?? '');
            const value = (v: string | null) =>
              f.op === 'call-target' ? (
                <TargetValue value={v} processes={f.suggestions.processes ?? []} />
              ) : (
                valueText(v)
              );
            return (
              <li
                key={key}
                className="flex flex-col gap-1.5"
                data-testid="amend-section-field"
                data-op={f.op}
              >
                <span className="flex flex-wrap items-center gap-1.5 text-sm">
                  <span className="font-medium">{f.fieldLabel}</span>
                  <span className="text-muted-foreground">{f.typeLabel}</span>
                  {f.live ? (
                    <ToneBadge tone={stateTone(f.live)}>{stateText(f.live)}</ToneBadge>
                  ) : null}
                </span>
                <span className="text-sm break-words" data-testid="amend-section-value">
                  {value(f.value)}
                  {differs ? (
                    <span className="text-xs text-muted-foreground">
                      {' '}
                      (im Quellsystem: {valueText(f.uploadedValue)})
                    </span>
                  ) : null}
                </span>
                {!f.settable ? (
                  canAmend ? (
                    <span
                      className="text-xs text-muted-foreground"
                      data-testid="amend-section-reason"
                    >
                      {f.reason === 'only-open-questions'
                        ? ONLY_OPEN_QUESTIONS_TEXT
                        : `${refusalLabel(f.reason)}.`}
                    </span>
                  ) : null
                ) : canAmend ? (
                  <div>
                    <Button
                      ref={(el) => {
                        if (el) buttons.current.set(key, el);
                        else buttons.current.delete(key);
                      }}
                      variant={f.live ? 'outline' : 'default'}
                      size="sm"
                      onClick={() => setEditing(open ? null : key)}
                      aria-expanded={open}
                      aria-controls={`${formId}-${key}`}
                      data-testid="amend-section-edit"
                    >
                      <PenLineIcon data-icon="inline-start" />
                      {(f.value ?? '') === '' ? 'Eintragen …' : 'Ändern …'}
                    </Button>
                  </div>
                ) : null}
                {open ? (
                  <div id={`${formId}-${key}`} className="rounded-lg border bg-muted/40 p-2.5">
                    <AmendForm
                      project={project}
                      modelId={model.id}
                      modelKey={model.key}
                      modelName={model.name}
                      targets={[{ elementId: f.viaElementId ?? f.elementId, op: f.op, label }]}
                      {...(f.live ? { replaces: f.live.id } : {})}
                      resolve={resolve}
                      onDone={() => close(key)}
                      onCancel={() => close(key)}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : settable ? (
        <p className="text-sm text-muted-foreground">
          Dieses Element hat kein ergänzbares Feld mehr.
        </p>
      ) : null}
      {history.length > 0 ? (
        <>
          <h4 className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <HistoryIcon className="size-3.5" aria-hidden />
            Verlauf ({history.length})
          </h4>
          <ul className="flex flex-col gap-1.5" aria-label="Verlauf der Ergänzungen">
            {[...history].reverse().map((a) => (
              <HistoryItem
                key={a.id}
                a={a}
                canAmend={canAmend}
                project={project}
                field={fieldOf(a)}
                processes={processes}
                onWithdrawn={() => requestAnimationFrame(() => heading.current?.focus())}
              />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

// ------------------------------------------------------------------ the header

const FORMATS: Record<AmendmentExportFormat, string> = {
  markdown: 'Änderungsliste (Markdown)',
  csv: 'Änderungsliste (CSV)',
};

/** Runs a download, with a toast when it fails. */
function useDownload() {
  const [busy, setBusy] = useState(false);
  const run = (task: () => Promise<void>) => {
    setBusy(true);
    task()
      .catch((error: unknown) =>
        toast({
          tone: 'danger',
          title: 'Download fehlgeschlagen',
          description: errorMessage(error),
          error,
        }),
      )
      .finally(() => setBusy(false));
  };
  return { busy, run };
}

/**
 * The header's amendment parts (M6 §4.8 c "Web"): the badge „In analyzr
 * ergänzt (n)“ naming the uploaded revision the head is computed from, the
 * conflicts, „Herunterladen“ (the amended BPMN, the original, the change
 * list) and the revisions (uploaded and amended). Reports the elements the
 * head's applied amendments wrote, for the canvas's overlay „ergänzt“.
 */
export function ModelAmendHeader({
  project,
  model,
  onAmended,
}: {
  project: string;
  model: Pick<Model, 'id' | 'key' | 'headRevisionId' | 'headRev'>;
  onAmended: (elementIds: readonly string[]) => void;
}) {
  const revisions = useQuery(modelRevisionsQuery(project, model.id));
  const head = revisions.data?.find((r) => r.id === model.headRevisionId);
  const counts = planCounts(head?.source);
  const upstream = head?.source.kind === 'amendment' ? head.source.upstream : undefined;
  const live = (head?.source.amendments ?? []).length > 0;
  const download = useDownload();
  const ids = amendedElements(head?.source).join('\n');
  useEffect(() => {
    onAmended(ids === '' ? [] : ids.split('\n'));
  }, [ids, onAmended]);

  return (
    <>
      {upstream && counts.applied > 0 ? (
        <span data-testid="amended-badge">
          <ToneBadge
            tone="info"
            icon={PenLineIcon}
            title={`r${model.headRev} ist aus der hochgeladenen Revision r${upstream.rev} berechnet; ${counts.applied === 1 ? 'eine Ergänzung' : `${counts.applied} Ergänzungen`} aus analyzr angewendet`}
          >
            In analyzr ergänzt ({counts.applied}) · aus r{upstream.rev}
          </ToneBadge>
        </span>
      ) : null}
      {counts.conflicts > 0 ? (
        <span data-testid="amended-conflicts">
          <ToneBadge tone="warning" icon={TriangleAlertIcon}>
            {counts.conflicts === 1
              ? '1 Ergänzung nicht mehr anwendbar'
              : `${counts.conflicts} Ergänzungen nicht mehr anwendbar`}
          </ToneBadge>
        </span>
      ) : null}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="xs"
            disabled={download.busy}
            data-testid="model-downloads"
          >
            {download.busy ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <FileDownIcon data-icon="inline-start" />
            )}
            Herunterladen
            <ChevronDownIcon data-icon="inline-end" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onSelect={() =>
              download.run(() =>
                downloadRevision(project, model.id, model.headRevisionId, bpmnFileName(model.key)),
              )
            }
            data-testid="download-bpmn"
          >
            <FileDownIcon />
            BPMN herunterladen
          </DropdownMenuItem>
          {upstream ? (
            <DropdownMenuItem
              onSelect={() =>
                download.run(() =>
                  downloadRevision(
                    project,
                    model.id,
                    upstream.revisionId,
                    bpmnFileName(model.key, { rev: upstream.rev }),
                  ),
                )
              }
              data-testid="download-original"
            >
              <FileDownIcon />
              Original herunterladen
            </DropdownMenuItem>
          ) : null}
          {live || upstream ? (
            <>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Fürs Quellsystem
              </DropdownMenuLabel>
              {(['markdown', 'csv'] as const).map((format) => (
                <DropdownMenuItem
                  key={format}
                  onSelect={() =>
                    download.run(() => downloadChangeList(project, format, model.key))
                  }
                  data-testid="download-change-list"
                  data-format={format}
                >
                  <FileDownIcon />
                  {FORMATS[format]}
                </DropdownMenuItem>
              ))}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {revisions.data && revisions.data.length > 1 ? (
        <details className="w-full text-xs" data-testid="model-revisions">
          <summary className="cursor-pointer text-muted-foreground">
            Revisionen ({revisions.data.length === 20 ? 'die letzten 20' : revisions.data.length})
          </summary>
          <ol className="mt-1 flex flex-col gap-0.5">
            {revisions.data.map((r) => (
              <li key={r.id} data-testid="model-revision" data-kind={r.source.kind}>
                <span className="font-mono">r{r.rev}</span> · {revisionOrigin(r)} ·{' '}
                {formatDateTime(r.createdAt)}
                {r.id === model.headRevisionId ? ' · Kopf' : ''}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </>
  );
}

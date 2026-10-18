import { exportOpenQuestions, type OpenQuestionExportFormat } from '@analyzr/client';
import { FileDownIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage, unwrapWithResponse } from '@/lib/api';
import { downloadBlob } from '@/lib/download';
import {
  attachmentName,
  cardGroup,
  exportGroups,
  exportQuery,
  type OpenQuestionFilters,
} from '@/lib/open-questions';
import { toast } from '@/lib/toast';

const EXTENSIONS: Record<OpenQuestionExportFormat, string> = { markdown: 'md', csv: 'csv' };

const FORMATS: { value: OpenQuestionExportFormat; label: string; hint?: string }[] = [
  { value: 'markdown', label: 'Zum Lesen (Markdown)' },
  {
    value: 'csv',
    label: 'Zum Ausfüllen (CSV)',
    hint: 'Mit der Spalte „Antwort“; die ausgefüllte Datei liest „Antworten aus CSV übernehmen …“ wieder ein.',
  },
];

/**
 * Downloads the export route's file (the CSV with its byte order mark), byte
 * for byte, under the name the server gives it: the open items under the
 * filters of the list and the groups of {@link exportGroups}, so the file
 * holds what the list shows (an item marked „Außerhalb der Landschaft“ is
 * settled and not asked again).
 */
async function downloadExport(
  project: string,
  format: OpenQuestionExportFormat,
  filters: OpenQuestionFilters,
  withAgents: boolean,
): Promise<void> {
  const { data, response } = await unwrapWithResponse(
    exportOpenQuestions({
      client: api,
      path: { project },
      query: {
        ...exportQuery(filters),
        group: exportGroups(filters, withAgents),
        state: 'open',
        format,
      },
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
      `offene-fragen-${project}.${EXTENSIONS[format]}`,
    ),
    blob,
  );
}

/**
 * „Für den Kunden exportieren …“ (UX-SIMPLIFICATION.md §3.3 item 4, owner
 * decision 26, Q11): „Zum Lesen (Markdown)“ or „Zum Ausfüllen (CSV)“, the
 * questions „Zu klären“ under the list's filters, and „Auch Fragen der
 * Agenten (n)“ off by default (shown only when there are any); while „Art“
 * shows the agents' questions, those; only open items, as the list shows
 * them. The file name is the server's (`offene-fragen-<p>.csv` by default).
 * Opened from the tab and from „Exportieren“ on „Übersicht“ (lazily, as
 * this module); every role may export. Opened without a Radix trigger, so
 * `returnFocus` names where the focus goes when it closes.
 */
export default function CustomerExportDialog({
  project,
  open,
  onOpenChange,
  filters = {},
  agentQuestions,
  returnFocus,
}: {
  project: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters?: OpenQuestionFilters;
  /** The agents' open questions under the filters: the checkbox's number, hidden at 0. */
  agentQuestions: number;
  /** The control that opened the dialog (or stands for it): the focus goes back there. */
  returnFocus?: () => HTMLElement | null | undefined;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="customer-export-dialog"
        onCloseAutoFocus={(event) => {
          // Radix returns the focus only to a DialogTrigger; this dialog has none.
          const target = returnFocus?.();
          if (!target) return;
          event.preventDefault();
          target.focus();
        }}
      >
        {/* The form unmounts with the content: every opening starts from the defaults. */}
        <ExportForm
          project={project}
          filters={filters}
          agentQuestions={agentQuestions}
          busy={busy}
          setBusy={setBusy}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ExportForm({
  project,
  filters,
  agentQuestions,
  busy,
  setBusy,
  onClose,
}: {
  project: string;
  filters: OpenQuestionFilters;
  agentQuestions: number;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [format, setFormat] = useState<OpenQuestionExportFormat>('markdown');
  const [withAgents, setWithAgents] = useState(false);
  const agents = cardGroup(filters) === 'agent';

  function download() {
    setBusy(true);
    downloadExport(project, format, filters, withAgents && agentQuestions > 0)
      .then(onClose)
      .catch((error: unknown) =>
        toast({
          tone: 'danger',
          title: 'Export fehlgeschlagen',
          description: errorMessage(error),
          error,
        }),
      )
      .finally(() => setBusy(false));
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Für den Kunden exportieren</DialogTitle>
        <DialogDescription>
          {agents ? 'Die Fragen der Agenten' : 'Die Fragen „Zu klären“'}
          {Object.keys(exportQuery(filters)).length > (agents ? 1 : 0)
            ? ' mit den Filtern der Liste'
            : ''}
          .
        </DialogDescription>
      </DialogHeader>
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Format</legend>
        {FORMATS.map((f) => (
          <label key={f.value} className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input
              type="radio"
              name={`${id}-format`}
              value={f.value}
              checked={format === f.value}
              onChange={() => setFormat(f.value)}
              className="mt-0.5 size-4 accent-primary"
              data-testid="customer-export-format"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{f.label}</span>
              {f.hint ? <span className="text-xs text-muted-foreground">{f.hint}</span> : null}
            </span>
          </label>
        ))}
      </fieldset>
      {!agents && agentQuestions > 0 ? (
        <div className="flex items-center gap-2.5">
          <Checkbox
            id={`${id}-agents`}
            checked={withAgents}
            onCheckedChange={(checked) => setWithAgents(checked === true)}
            data-testid="customer-export-agents"
          />
          <Label htmlFor={`${id}-agents`} className="font-normal">
            Auch Fragen der Agenten ({agentQuestions})
          </Label>
        </div>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
          Abbrechen
        </Button>
        <Button
          type="button"
          disabled={busy}
          onClick={download}
          data-testid="customer-export-download"
        >
          {busy ? <Spinner data-icon="inline-start" /> : <FileDownIcon data-icon="inline-start" />}
          Herunterladen
        </Button>
      </DialogFooter>
    </>
  );
}

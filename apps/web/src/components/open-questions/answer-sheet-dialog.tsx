import type { AnswerSheetResult, AnswerSheetRowResult, OpenQuestion } from '@analyzr/client';
import { cn } from 'cn';
import { CircleCheckIcon, FileSpreadsheetIcon, FileUpIcon, TriangleAlertIcon } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';

import { PlainText } from '@/components/review/plain-text';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { ApiError, errorMessage } from '@/lib/api';
import { useAnswerSheet } from '@/lib/open-question-actions';
import {
  ANSWER_PERMANENT,
  ANSWER_TARGET_LABELS,
  MAX_SHEET_FILE_BYTES,
  SHEET_ACCEPT,
  SHEET_KIND_LABELS,
  SHEET_REASON_TEXTS,
  notesBeforeText,
  emptySheetResult,
  readSheetBytes,
  sheetGroups,
  sheetPersonalDataText,
  sheetResult,
  sheetSummaryText,
  type FilledSheetRow,
} from '@/lib/open-question-answers';
import { toast } from '@/lib/toast';

/**
 * A sheet read and previewed by the dry run, or (`result.dryRun` false)
 * stored with rows left out: the filled rows (the only ones sent), the rows
 * without an answer, and the result under the sheet's rows.
 */
interface Preview {
  fileName: string;
  filled: FilledSheetRow[];
  ignored: number;
  result: AnswerSheetResult;
}

const tooLarge = (error: unknown) => error instanceof ApiError && error.status === 413;

/**
 * „Antworten aus CSV übernehmen“ (M6 §4.5 "Bulk answers"; since S5c-1 every
 * filled `Antwort` is a note, §4.8 b): the reviewer picks the CSV the export
 * wrote, filled in by the customer (UTF-8 only, as the CLI reads it); a
 * sheet exported before S5c-1 with its column `Antwortart` still reads. The
 * dry run of `POST …/open-questions/answers` with the filled rows previews
 * what would be stored (each row as a note, or an old sheet's outside mark,
 * and where it lands,
 * ids that name no current question, rows that cannot be stored, the
 * personal-data hint once), each under its row in the spreadsheet, and only
 * „… speichern“ stores the sheet, in one transaction. When rows were left
 * out, the dialog stays open after storing and lists them with their texts.
 */
export function AnswerSheetDialog({
  project,
  items,
}: {
  project: string;
  /** The current items, for the subjects and earlier answers in the preview. */
  items: readonly OpenQuestion[];
}) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [open, onOpenChange] = useState(false);
  const sheet = useAnswerSheet(project);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  // Each pick and each opening counts up: a file read or dry run that an
  // earlier one started never fills in the preview of a later one.
  const round = useRef(0);
  const busy = reading || sheet.isPending;

  function reset() {
    round.current++;
    setFileName(null);
    setPreview(null);
    setError(null);
    setReading(false);
  }

  function close(next: boolean) {
    if (!next && sheet.isPending) return;
    // Each opening starts afresh.
    reset();
    onOpenChange(next);
  }

  function finish() {
    reset();
    onOpenChange(false);
  }

  async function pick(file: File) {
    reset();
    const mine = round.current;
    setFileName(file.name);
    if (file.size > MAX_SHEET_FILE_BYTES) {
      setError(`„${file.name}“ ist größer als 16 MB. Nimm die CSV aus „Als CSV exportieren“.`);
      return;
    }
    setReading(true);
    try {
      // The bytes, not `file.text()`: that would turn an ANSI sheet's umlauts into „�“ silently.
      const read = readSheetBytes(file.name, await file.arrayBuffer());
      if (mine !== round.current) return;
      if (!read.ok) {
        setError(read.message);
        return;
      }
      // Without a filled row there is nothing to check, so nothing is sent.
      const result =
        read.filled.length === 0
          ? emptySheetResult(read.ignored)
          : sheetResult(
              await sheet.mutateAsync({ rows: read.filled.map((f) => f.cells), dryRun: true }),
              read,
            );
      if (mine !== round.current) return;
      setPreview({ fileName: file.name, filled: read.filled, ignored: read.ignored, result });
    } catch (e) {
      if (mine !== round.current) return;
      setError(
        tooLarge(e)
          ? `Die Antworten in „${file.name}“ sind zusammen zu groß für einen Aufruf. Teil die Datei auf.`
          : errorMessage(e),
      );
    } finally {
      if (mine === round.current) setReading(false);
    }
  }

  function store() {
    if (!preview) return;
    const planned = preview.result.counts;
    sheet.mutate(
      { rows: preview.filled.map((f) => f.cells), dryRun: false },
      {
        onSuccess: (stored) => {
          const result = sheetResult(stored, preview);
          // Rows left out stay listed with their texts, so they can be entered again.
          if (result.counts.unknown + result.counts.invalid > 0) setPreview({ ...preview, result });
          else finish();
          const changed =
            result.counts.recorded !== planned.recorded ||
            result.counts.unknown !== planned.unknown ||
            result.counts.invalid !== planned.invalid;
          toast({
            tone: changed ? 'warning' : 'success',
            title:
              result.counts.recorded === 1
                ? '1 Antwort gespeichert'
                : `${result.counts.recorded} Antworten gespeichert`,
            description: changed
              ? `Seit der Vorschau hat sich die Liste geändert: ${sheetSummaryText(result)}`
              : sheetSummaryText(result),
          });
        },
        onError: (e) => setError(errorMessage(e)),
      },
    );
  }

  const byId = new Map(items.map((q) => [q.id, q]));
  const stored = preview !== null && !preview.result.dryRun;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          data-testid="open-questions-import"
          title="Die ausgefüllte CSV aus „Als CSV exportieren“ einlesen: erst eine Vorschau, dann speichern"
        >
          <FileUpIcon data-icon="inline-start" />
          Antworten aus CSV übernehmen
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl"
        data-testid="answer-sheet-dialog"
      >
        <DialogHeader>
          <DialogTitle>Antworten aus CSV übernehmen</DialogTitle>
          <DialogDescription>
            Nimm die Datei aus „Als CSV exportieren“, in der die Spalte „Antwort“ ausgefüllt ist.
            Jede Antwort wird als Notiz an ihrer Frage gespeichert; erledigt wird eine Frage durch
            ihre Aktion. Zuerst siehst du, was gespeichert würde; gespeichert wird erst nach deiner
            Bestätigung. Zeilen ohne Antwort bleiben unberührt. {ANSWER_PERMANENT}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          <Field>
            <FieldLabel htmlFor={`${id}-file`}>CSV-Datei</FieldLabel>
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInput.current?.click()}
                disabled={busy}
                aria-describedby={`${id}-chosen`}
                data-testid="answer-sheet-pick"
              >
                <FileSpreadsheetIcon data-icon="inline-start" />
                {fileName ? 'Andere Datei auswählen' : 'Datei auswählen'}
              </Button>
              <span
                id={`${id}-chosen`}
                className="min-w-0 text-sm break-all text-muted-foreground"
                data-testid="answer-sheet-file-name"
              >
                {fileName ? `„${fileName}“` : 'Keine Datei ausgewählt'}
              </span>
            </div>
            {/* The native picker's own texts follow the browser's language; the button above speaks German. */}
            <input
              ref={fileInput}
              id={`${id}-file`}
              type="file"
              accept={SHEET_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              disabled={busy}
              data-testid="answer-sheet-file"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                // The same file can be chosen again after a change in the spreadsheet.
                e.currentTarget.value = '';
                if (file) void pick(file);
              }}
            />
            <FieldDescription>
              Die Spalten „id“ und „Antwort“ des Exports. Eine ältere Datei mit der Spalte
              „Antwortart“ geht auch: „Liegt außerhalb der Landschaft“ markiert die Frage dann als
              außerhalb, alles andere wird eine Notiz.
            </FieldDescription>
          </Field>

          {/*
            One status region, there from the start, so screen readers announce what it says:
            „Prüfe die Antworten …“ while reading, then the summary (visible below).
          */}
          <p
            className={cn(
              'flex items-center gap-2 text-sm text-muted-foreground',
              !reading && 'sr-only',
            )}
            role="status"
            data-testid="answer-sheet-status"
          >
            {reading ? (
              <>
                <Spinner /> Prüfe die Antworten …
              </>
            ) : preview ? (
              `„${preview.fileName}“: ${sheetSummaryText(preview.result)}`
            ) : null}
          </p>

          {error ? (
            <Alert variant="destructive" data-testid="answer-sheet-error">
              <AlertTitle>Nicht übernommen</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {preview ? <SheetPreview preview={preview} items={byId} /> : null}
        </div>

        <DialogFooter>
          {stored ? (
            <Button type="button" onClick={() => close(false)} data-testid="answer-sheet-close">
              Schließen
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => close(false)}
                disabled={sheet.isPending}
              >
                Abbrechen
              </Button>
              <Button
                type="button"
                onClick={store}
                disabled={busy || !preview || preview.result.counts.recorded === 0}
                data-testid="answer-sheet-confirm"
              >
                {sheet.isPending && !reading ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <FileUpIcon data-icon="inline-start" />
                )}
                {preview && preview.result.counts.recorded > 0
                  ? preview.result.counts.recorded === 1
                    ? '1 Antwort speichern'
                    : `${preview.result.counts.recorded} Antworten speichern`
                  : 'Antworten speichern'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SheetPreview({
  preview,
  items,
}: {
  preview: Preview;
  items: ReadonlyMap<string, OpenQuestion>;
}) {
  const { dryRun } = preview.result;
  const groups = sheetGroups(preview.result);
  // The hint counts what would be stored, the rows it marks.
  const personal = dryRun ? sheetPersonalDataText(groups.recorded) : null;
  const cells = new Map(preview.filled.map((f) => [f.line, f.cells]));
  const textOf = (row: AnswerSheetRowResult) => cells.get(row.row)?.text.trim() ?? '';
  const subjectOf = (row: AnswerSheetRowResult) => items.get(row.id.trim())?.subjectLabel;
  // Earlier notes of a question: a new one joins them (in the preview, before storing).
  const answersOf = (row: AnswerSheetRowResult) =>
    dryRun ? (items.get(row.id.trim())?.answers.filter((a) => a.role === 'note').length ?? 0) : 0;
  return (
    <div className="flex flex-col gap-3" data-testid="answer-sheet-preview">
      <p className="text-sm" data-testid="answer-sheet-summary">
        <span className="font-medium">„{preview.fileName}“: </span>
        {sheetSummaryText(preview.result)}
      </p>
      {dryRun ? null : (
        <p className="text-sm text-muted-foreground" data-testid="answer-sheet-left-out">
          Nicht jede Zeile ist gespeichert. Die übrigen stehen unten mit ihrem Text, damit du sie
          übertragen kannst.
        </p>
      )}
      {personal ? (
        <Alert className="border-warning bg-warning-soft" data-testid="answer-sheet-personal-data">
          <TriangleAlertIcon className="text-warning" />
          <AlertTitle>Vermutlich personenbezogene Daten</AlertTitle>
          <AlertDescription className="text-foreground">{personal}</AlertDescription>
        </Alert>
      ) : null}
      {dryRun && preview.result.counts.recorded === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="answer-sheet-nothing">
          Nichts zu speichern: Keine Zeile bringt eine neue Antwort auf eine aktuelle Frage.
        </p>
      ) : null}
      <RowGroup
        title={dryRun ? 'Wird gespeichert' : 'Gespeichert'}
        outcome="recorded"
        rows={groups.recorded}
        render={(row) => (
          <AnswerRow
            row={row}
            subject={subjectOf(row)}
            text={textOf(row)}
            answersBefore={answersOf(row)}
          />
        )}
      />
      <RowGroup
        title="Schon gespeichert, bleibt unverändert"
        outcome="unchanged"
        rows={groups.unchanged}
        render={(row) => <AnswerRow row={row} subject={subjectOf(row)} text={textOf(row)} />}
      />
      <RowGroup
        title="Unbekannte Kennungen, nicht gespeichert"
        outcome="unknown"
        rows={groups.unknown}
        intro="Diese Fragen gibt es nicht mehr, oder ihre Quelle hat sich seit dem Export geändert; dann hat die Frage eine neue Kennung. Exportiere die Liste neu und übertrag die Antworten."
        render={(row) => (
          <>
            <RowHead row={row} />
            <PlainText text={textOf(row)} className="line-clamp-2 text-sm text-muted-foreground" />
          </>
        )}
      />
      <RowGroup
        title="Ungültig, nicht gespeichert"
        outcome="invalid"
        rows={groups.invalid}
        render={(row) => (
          <>
            <RowHead row={row} subject={subjectOf(row)} />
            <span className="text-sm text-destructive" data-testid="answer-sheet-reason">
              {row.reason ? SHEET_REASON_TEXTS[row.reason] : 'Nicht speicherbar.'}
            </span>
            <PlainText text={textOf(row)} className="line-clamp-2 text-sm text-muted-foreground" />
          </>
        )}
      />
    </div>
  );
}

function RowGroup({
  title,
  outcome,
  rows,
  intro,
  render,
}: {
  title: string;
  outcome: AnswerSheetRowResult['outcome'];
  rows: readonly AnswerSheetRowResult[];
  intro?: string;
  render: (row: AnswerSheetRowResult) => ReactNode;
}) {
  const id = useId();
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1.5" data-outcome={outcome}>
      <h3 id={id} className="text-sm font-semibold">
        {title} ({rows.length})
      </h3>
      {intro ? <p className="text-sm text-muted-foreground">{intro}</p> : null}
      <ul className="flex flex-col gap-1.5" aria-labelledby={id}>
        {rows.map((row) => (
          <li
            key={row.row}
            className="flex min-w-0 flex-col gap-1 rounded-lg border p-2.5"
            data-testid="answer-sheet-row"
            data-outcome={row.outcome}
            data-question-id={row.id.trim()}
          >
            {render(row)}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The row's place in the sheet (as the spreadsheet numbers it), its id and subject. */
function RowHead({ row, subject }: { row: AnswerSheetRowResult; subject?: string | undefined }) {
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
      <span className="tabular-nums" title="Zeile im Tabellenprogramm">
        Zeile {row.row}
      </span>
      <span className="font-mono break-all">{row.id.trim() || '(ohne Kennung)'}</span>
      {subject ? (
        <span className="text-sm font-medium break-words text-foreground">{subject}</span>
      ) : null}
    </span>
  );
}

function AnswerRow({
  row,
  subject,
  text,
  answersBefore = 0,
}: {
  row: AnswerSheetRowResult;
  subject: string | undefined;
  text: string;
  /** Notes the question has already: the new one joins them (append-only). */
  answersBefore?: number;
}) {
  const before = row.kind === 'outside-landscape' ? null : notesBeforeText(answersBefore, 'Diese');
  return (
    <>
      <RowHead row={row} subject={subject} />
      <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        {row.outcome === 'unchanged' ? (
          <CircleCheckIcon className="size-3.5 text-success" aria-hidden />
        ) : null}
        {row.kind ? (
          <span className="font-medium text-foreground" data-testid="answer-sheet-row-kind">
            {SHEET_KIND_LABELS[row.kind]}
          </span>
        ) : null}
        {row.target && row.kind !== 'outside-landscape' ? (
          <span>{ANSWER_TARGET_LABELS[row.target]}</span>
        ) : null}
        {row.warnings.length > 0 ? (
          <span
            className="inline-flex items-center gap-1 text-warning"
            data-testid="answer-sheet-row-warning"
          >
            <TriangleAlertIcon className="size-3.5" aria-hidden />
            vermutlich personenbezogene Daten
          </span>
        ) : null}
      </span>
      <PlainText text={text} className="line-clamp-3 text-sm" />
      {before ? (
        <span className="text-xs text-muted-foreground" data-testid="answer-sheet-row-before">
          {before}
        </span>
      ) : null}
    </>
  );
}

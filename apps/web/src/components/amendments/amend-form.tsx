import type {
  AmendModelItem,
  AmendNameEndpoint,
  AmendProcessSuggestion,
  AmendableElement,
  AmendableField,
  AmendmentOp,
} from '@analyzr/client';
import { personalDataHint, personalDataWarnings } from '@analyzr/contracts/personal-data';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { ChevronRightIcon, InfoIcon, SaveIcon, TriangleAlertIcon } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';

import { ErrorText } from '@/components/error-text';
import { PickerList } from '@/components/picker-list';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import {
  AMEND_HINT,
  AMEND_PERSONAL_DATA_HINT,
  AMENDMENT_VALUE_LIMITS,
  amendableQuery,
  fieldLabel,
  isNotFound,
  normalizeAmendmentValue,
  refusalLabel,
  useAmendDraft,
  useClaimedConfirm,
  useSavedToast,
  valueProblemText,
  valueText,
  type PendingAmendment,
} from '@/lib/amendments';
import { bestFits, nameWords } from '@/lib/generic-names';
import type { RefResolver } from '@/lib/refs';

import { AmendEffect } from './amend-summary';

/**
 * The amend form (M6 §4.8 c "Web", decision 25; UX4): one field per target,
 * as the question's `amend` action or the model view's „Ergänzen“ names
 * them; a process picker for a call target („Vorgeschlagen“ first, then
 * „Passt vermutlich“), text with the landscape's names (a picked partner is
 * accepted with the name) or the labels elsewhere, documentation; the
 * personal-data warning, the value as it will be stored. The dry run runs by
 * itself once the values settle, so the effect and the cost stand above the
 * one „Speichern“ (a second confirmation only when an agent holds the
 * model's task); the hint that the next import keeps the amendment sits
 * behind a disclosure. After the save the toast offers „Agent starten“.
 */

export interface AmendTarget {
  elementId: string;
  op: AmendmentOp;
  /** German, e.g. „Aufrufaktivität „Rechnung stellen““. */
  label: string;
  /** The value the form starts with („Meine Ergänzung behalten“). */
  prefill?: string;
}

export interface AmendFormProps {
  project: string;
  modelId: string;
  modelKey: string;
  /** The model's name for the bar and the toast (else its key). */
  modelName?: string | null;
  targets: readonly AmendTarget[];
  /** The live amendment a single target replaces (the action's `replaces`). */
  replaces?: string;
  /** Process refs a live proposal already names (the question's `link` suggestions): listed first. */
  suggested?: readonly string[];
  resolve?: RefResolver;
  /** Saved: the form closes. */
  onDone: () => void;
  onCancel: () => void;
}

interface FieldValue {
  text: string;
  /** `call-target`: the picked process ref. */
  target: string | null;
  /** `message-name`: the endpoint whose name was picked. */
  partner: string | null;
}

const keyOf = (t: Pick<AmendTarget, 'op' | 'elementId'>) => `${t.op}\u0000${t.elementId}`;

/** The field of a target in its element's answer. */
function fieldOf(
  element: AmendableElement | undefined,
  op: AmendmentOp,
): AmendableField | undefined {
  return element?.fields.find((f) => f.op === op);
}

/** The value a field starts with: the prefill (a process picked by its id), else empty. */
function initialValue(t: AmendTarget, field: AmendableField | undefined): FieldValue {
  if (t.op === 'call-target') {
    const processes = field?.suggestions.processes ?? [];
    const match =
      t.prefill === undefined
        ? undefined
        : (processes.find((p) => p.processId === t.prefill && !p.ambiguous) ??
          processes.find((p) => p.processId === t.prefill));
    return { text: '', target: match?.ref ?? null, partner: null };
  }
  return { text: t.prefill ?? '', target: null, partner: null };
}

type Built =
  | { kind: 'skip' }
  | { kind: 'problem'; text: string }
  | { kind: 'item'; pending: PendingAmendment; stored: string };

/** The request item of one field, or why it cannot be sent yet. */
function build(
  t: AmendTarget,
  field: AmendableField | undefined,
  value: FieldValue,
  replaces: string | undefined,
): Built {
  if (!field || !field.settable) return { kind: 'skip' };
  const base = { elementId: t.elementId, op: t.op, ...(replaces ? { replaces } : {}) };
  if (t.op === 'call-target') {
    if (value.target === null) return { kind: 'skip' };
    const process = field.suggestions.processes?.find((p) => p.ref === value.target);
    const item: AmendModelItem = { ...base, target: value.target };
    return {
      kind: 'item',
      pending: {
        item,
        label: t.label,
        display: process ? process.name : value.target,
        field: field.fieldLabel,
      },
      stored: process?.processId ?? value.target,
    };
  }
  if (value.text.trim() === '') return { kind: 'skip' };
  const normalized = normalizeAmendmentValue(t.op, value.text);
  if (!normalized.ok) return { kind: 'problem', text: valueProblemText(t.op, normalized.problem) };
  const item: AmendModelItem = {
    ...base,
    after: value.text,
    ...(value.partner ? { partner: value.partner } : {}),
  };
  return {
    kind: 'item',
    pending: { item, label: t.label, display: normalized.value, field: field.fieldLabel },
    stored: normalized.value,
  };
}

// ------------------------------------------------------------------ fields

/** Bisher: „…“ (· in analyzr ergänzt; im Quellsystem: „…“). */
function CurrentValue({ field }: { field: AmendableField }) {
  const differs = (field.value ?? '') !== (field.uploadedValue ?? '');
  return (
    <p className="text-xs text-muted-foreground" data-testid="amend-current">
      Bisher: {valueText(field.value)}
      {field.live ? ' · in analyzr ergänzt' : ''}
      {differs ? ` (im Quellsystem: ${valueText(field.uploadedValue)})` : ''}
    </p>
  );
}

/** The value as it will be stored, when normalizing changes what was typed. */
function StoredAs({ typed, stored }: { typed: string; stored: string | null }) {
  if (stored === null || stored === typed) return null;
  return (
    <p className="text-xs text-muted-foreground" data-testid="amend-stored-as">
      Gespeichert wird: {valueText(stored)}
    </p>
  );
}

/** The live personal-data warning of a name or documentation (warns, never blocks). */
function PersonalData({ id, text }: { id: string; text: string }) {
  const hint = personalDataHint(useMemo(() => personalDataWarnings(text), [text]));
  return (
    <p
      id={id}
      role="status"
      className={cn(hint && 'flex items-start gap-1.5 text-sm text-warning')}
      data-testid="amend-personal-data"
    >
      {hint ? (
        <>
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{hint}</span>
        </>
      ) : null}
    </p>
  );
}

const processSearch = (p: ChoiceProcess) =>
  `${p.name} ${p.modelName ?? ''} ${p.modelKey} ${p.processId}`;

interface ChoiceProcess extends AmendProcessSuggestion {
  suggested: boolean;
  /** „Vorgeschlagen“, „Passt vermutlich“, or none (the rest, by name). */
  section: 'Vorgeschlagen' | 'Passt vermutlich' | null;
}

/**
 * A call target's processes (UX-SIMPLIFICATION.md §3.4 item 2): the ones a
 * live proposal names first, then the three best fits by name, then the
 * rest by name and model.
 */
function rankedProcesses(
  field: AmendableField,
  suggested: readonly string[],
  hints: readonly string[],
): ChoiceProcess[] {
  const all = [...(field.suggestions.processes ?? [])].sort(
    (a, b) =>
      a.name.localeCompare(b.name, 'de') ||
      (a.modelName ?? a.modelKey).localeCompare(b.modelName ?? b.modelKey, 'de'),
  );
  const first = suggested.flatMap((ref) => {
    const p = all.find((x) => x.ref === ref);
    return p ? [{ ...p, suggested: true, section: 'Vorgeschlagen' as const }] : [];
  });
  const taken = new Set(first.map((p) => p.ref));
  const likely = bestFits(
    all.filter((p) => !taken.has(p.ref)),
    (p) => p.name,
    hints,
  ).map((p) => ({ ...p, suggested: false, section: 'Passt vermutlich' as const }));
  for (const p of likely) taken.add(p.ref);
  return [
    ...first,
    ...likely,
    ...all.filter((p) => !taken.has(p.ref)).map((p) => ({ ...p, suggested: false, section: null })),
  ];
}

function ProcessOption({ p }: { p: ChoiceProcess }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate font-medium">
        {p.name}{' '}
        <span className="font-normal text-muted-foreground">– {p.modelName ?? p.modelKey}</span>
        {p.section ? <span className="sr-only">, {p.section.toLowerCase()}</span> : null}
      </span>
      <span className="truncate font-mono text-xs text-muted-foreground">
        {p.processId}
        {p.ambiguous ? ' · ID mehrfach vergeben' : ''}
      </span>
    </span>
  );
}

/** `call-target`: the head processes outside the caller's process, „Vorgeschlagen“ first. */
function CallTargetField({
  field,
  value,
  onChange,
  suggested,
  hints,
  autoFocus,
}: {
  field: AmendableField;
  value: FieldValue;
  onChange: (next: FieldValue) => void;
  suggested: readonly string[];
  /** What the call names (its label, its value): the best fits come next, „Passt vermutlich“. */
  hints: readonly string[];
  autoFocus: boolean;
}) {
  const [search, setSearch] = useState('');
  const items = useMemo(() => rankedProcesses(field, suggested, hints), [field, suggested, hints]);
  const sectioned = items.some((p) => p.section !== null);
  const picked = items.find((p) => p.ref === value.target);
  return (
    <div className="flex flex-col gap-2">
      <PickerList
        items={items}
        valueOf={(p) => p.ref}
        searchText={processSearch}
        render={(p) => <ProcessOption p={p} />}
        value={value.target}
        onChange={(ref) => onChange({ ...value, target: ref })}
        search={search}
        onSearch={setSearch}
        searchLabel="Aufgerufenen Prozess suchen"
        placeholder="Name, Modell oder Prozess-ID"
        label="Prozesse"
        emptyText="Die Landschaft hat keinen anderen Prozess."
        testId="amend-option"
        valueAttribute="ref"
        autoFocus={autoFocus}
        {...(sectioned ? { sectionOf: (p: ChoiceProcess) => p.section ?? 'Alle Prozesse' } : {})}
      />
      {picked?.ambiguous ? (
        <p className="flex items-start gap-1.5 text-sm text-warning" data-testid="amend-ambiguous">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          Die Prozess-ID „{picked.processId}“ gibt es in mehreren Modellen; der Aufruf bleibt
          mehrdeutig (Vorschläge zu jeder Kopie).
        </p>
      ) : null}
    </div>
  );
}

interface NameOption {
  value: string;
  name: string;
  partner: AmendNameEndpoint | null;
  count: number;
}

/** `message-name`: free text, or a name of the landscape (a partner's name accepts the pair). */
function MessageNameField({
  field,
  value,
  onChange,
  resolve,
  autoFocus,
  problem,
  stored,
}: {
  field: AmendableField;
  value: FieldValue;
  onChange: (next: FieldValue) => void;
  resolve: RefResolver | undefined;
  autoFocus: boolean;
  problem: string | null;
  stored: string | null;
}) {
  const id = useId();
  const names = field.suggestions.names ?? [];
  const family =
    field.element === 'signal' || field.element === 'message'
      ? field.element
      : names.some((n) => n.endpoints.some((e) => e.kind.startsWith('sig_')))
        ? 'signal'
        : names.length > 0
          ? 'message'
          : null;
  const readerName = (ref: string) => {
    const label = resolve?.(ref);
    return label?.label ?? label?.elementId ?? ref.slice(ref.indexOf('#') + 1);
  };
  const options = useMemo(() => {
    const out: NameOption[] = [];
    for (const s of field.suggestions.names ?? []) {
      const partners = s.endpoints.filter((e) => e.partner);
      if (partners.length === 0)
        out.push({ value: `${s.name}\n`, name: s.name, partner: null, count: s.endpoints.length });
      for (const p of partners)
        out.push({
          value: `${s.name}\n${p.ref}`,
          name: s.name,
          partner: p,
          count: s.endpoints.length,
        });
    }
    return out;
  }, [field.suggestions.names]);
  const words = nameWords(value.text);
  const visible =
    words.length === 0
      ? options
      : options.filter((o) => {
          const hay = nameWords(o.name).join(' ');
          return words.every((w) => hay.includes(w));
        });
  const selected = `${value.text}\n${value.partner ?? ''}`;
  const readers = field.readers.length > 1 ? field.readers : [];
  return (
    <div className="flex flex-col gap-2">
      <Field>
        <FieldLabel htmlFor={`${id}-name`}>
          {family === 'signal'
            ? 'Signalname'
            : family === 'message'
              ? 'Nachrichtenname'
              : 'Nachrichten- oder Signalname'}
        </FieldLabel>
        <Input
          id={`${id}-name`}
          value={value.text}
          onChange={(e) => onChange({ ...value, text: e.target.value, partner: null })}
          maxLength={AMENDMENT_VALUE_LIMITS['message-name'] + 200}
          autoComplete="off"
          autoFocus={autoFocus}
          aria-invalid={problem !== null}
          aria-describedby={`${id}-desc ${id}-personal`}
          data-testid="amend-text"
        />
        <FieldDescription id={`${id}-desc`}>
          Ein Name, den ein anderer Prozess fängt oder wirft, verbindet beide.{' '}
          {AMEND_PERSONAL_DATA_HINT}.
        </FieldDescription>
        {problem ? <p className="text-sm text-destructive">{problem}</p> : null}
        <StoredAs typed={value.text} stored={stored} />
        <PersonalData id={`${id}-personal`} text={value.text} />
      </Field>
      {readers.length > 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="amend-readers">
          Gilt für jedes Element mit dieser Nachricht: {readers.map(readerName).join(', ')}
        </p>
      ) : null}
      {visible.length > 0 ? (
        <PickerList
          items={visible}
          valueOf={(o) => o.value}
          searchText={(o) => o.name}
          render={(o) => (
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{o.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {o.partner
                  ? `Partner: ${o.partner.name} in ${o.partner.processName ?? o.partner.modelKey} (${o.partner.modelKey})`
                  : o.count === 1
                    ? '1 Element mit diesem Namen'
                    : `${o.count} Elemente mit diesem Namen`}
              </span>
            </span>
          )}
          value={visible.some((o) => o.value === selected) ? selected : null}
          onChange={(v) => {
            const o = options.find((x) => x.value === v);
            if (o) onChange({ ...value, text: o.name, partner: o.partner?.ref ?? null });
          }}
          search=""
          onSearch={() => undefined}
          searchLabel=""
          placeholder=""
          label="Namen der Landschaft"
          emptyText=""
          searchable={false}
          testId="amend-name-option"
          valueAttribute="name"
        />
      ) : null}
      {value.partner ? (
        <p
          className="flex items-start gap-1.5 text-xs text-muted-foreground"
          data-testid="amend-partner"
        >
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Mit dem Speichern nimmst du den Vorschlag zwischen beiden an.
        </p>
      ) : null}
    </div>
  );
}

/** `event-name` (labels elsewhere as suggestions) and `process-documentation`. */
function TextField({
  op,
  value,
  onChange,
  labels,
  autoFocus,
  problem,
  stored,
}: {
  op: AmendmentOp;
  value: FieldValue;
  onChange: (next: FieldValue) => void;
  labels: readonly string[];
  autoFocus: boolean;
  problem: string | null;
  stored: string | null;
}) {
  const id = useId();
  const documentation = op === 'process-documentation';
  return (
    <Field>
      <FieldLabel htmlFor={`${id}-text`}>{fieldLabel(op)}</FieldLabel>
      {documentation ? (
        <Textarea
          id={`${id}-text`}
          value={value.text}
          onChange={(e) => onChange({ ...value, text: e.target.value })}
          maxLength={AMENDMENT_VALUE_LIMITS[op] + 500}
          className="min-h-20"
          autoFocus={autoFocus}
          aria-invalid={problem !== null}
          aria-describedby={`${id}-desc ${id}-personal`}
          data-testid="amend-text"
        />
      ) : (
        <>
          <Input
            id={`${id}-text`}
            value={value.text}
            onChange={(e) => onChange({ ...value, text: e.target.value })}
            maxLength={AMENDMENT_VALUE_LIMITS[op] + 200}
            list={labels.length > 0 ? `${id}-labels` : undefined}
            autoComplete="off"
            autoFocus={autoFocus}
            aria-invalid={problem !== null}
            aria-describedby={`${id}-desc ${id}-personal`}
            data-testid="amend-text"
          />
          {labels.length > 0 ? (
            <datalist id={`${id}-labels`}>
              {labels.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          ) : null}
        </>
      )}
      <FieldDescription id={`${id}-desc`}>
        {documentation
          ? `Höchstens ${AMENDMENT_VALUE_LIMITS[op].toLocaleString('de-DE')} Zeichen; steht als erste Dokumentation am Prozess.`
          : labels.length > 0
            ? 'Namen von Start- und Endereignissen anderer Prozesse stehen zur Auswahl.'
            : `Höchstens ${AMENDMENT_VALUE_LIMITS[op]} Zeichen, eine Zeile.`}{' '}
        {AMEND_PERSONAL_DATA_HINT}.
      </FieldDescription>
      {problem ? <p className="text-sm text-destructive">{problem}</p> : null}
      <StoredAs typed={value.text} stored={stored} />
      <PersonalData id={`${id}-personal`} text={value.text} />
    </Field>
  );
}

// ------------------------------------------------------------------ the form

/** „Und beim nächsten Import?“: that the next import keeps the amendment (M6 §4.8 c), behind a disclosure. */
export function ImportHint() {
  return (
    <details className="group text-xs text-muted-foreground" data-testid="amend-hint">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
        <InfoIcon className="size-3.5" aria-hidden />
        Und beim nächsten Import?
        <ChevronRightIcon
          className="size-3.5 transition-transform group-open:rotate-90"
          aria-hidden
        />
      </summary>
      <p className="mt-1">{AMEND_HINT}</p>
    </details>
  );
}

export function AmendForm({
  project,
  modelId,
  modelKey,
  modelName,
  targets,
  replaces,
  suggested = [],
  resolve,
  onDone,
  onCancel,
}: AmendFormProps) {
  const queryClient = useQueryClient();
  const effectId = useId();
  const claimedId = useId();
  const elementIds = useMemo(() => [...new Set(targets.map((t) => t.elementId))], [targets]);
  const results = useQueries({
    queries: elementIds.map((elementId) => amendableQuery(project, modelId, elementId)),
  });
  const elements = new Map<string, AmendableElement>();
  for (const [i, r] of results.entries()) {
    const id = elementIds[i];
    if (id !== undefined && r.data) elements.set(id, r.data);
  }
  const loading = results.some((r) => r.isPending);
  const failed = results.find((r) => r.isError && !isNotFound(r.error));
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const name = modelName ?? modelKey;
  const savedToastOf = useSavedToast(project);

  const rows = targets.map((t) => {
    const element = elements.get(t.elementId);
    const field = fieldOf(element, t.op);
    const value = values[keyOf(t)] ?? initialValue(t, field);
    const replacing = field?.live?.id ?? (targets.length === 1 ? replaces : undefined);
    return { t, element, field, value, built: build(t, field, value, replacing) };
  });
  const pending = rows.flatMap((r) => (r.built.kind === 'item' ? [r.built.pending] : []));
  const problems = rows.some((r) => r.built.kind === 'problem');
  const revs = [...elements.values()].map((e) => e.headRev);
  const rev = revs.length > 0 ? Math.min(...revs) : null;
  const settable = rows.some((r) => r.field?.settable);
  const items = !loading && !problems && pending.length > 0 ? pending.map((p) => p.item) : null;
  const request = items !== null && rev !== null ? JSON.stringify({ items, rev }) : null;

  const draft = useAmendDraft({
    project,
    modelId,
    items,
    rev,
    onSaved: (result) => {
      savedToastOf(result, name);
      onDone();
    },
  });
  const { check } = draft;
  const confirm = useClaimedConfirm(check, request);

  // A conflict loads the fields again, so the next dry run starts from the new head.
  const conflict = check.phase === 'conflict';
  useEffect(() => {
    if (!conflict) return;
    for (const elementId of elementIds)
      void queryClient.invalidateQueries({
        queryKey: amendableQuery(project, modelId, elementId).queryKey,
      });
  }, [conflict, elementIds, modelId, project, queryClient]);

  const canSave = check.phase === 'ready' && !draft.saving;

  const set = (t: AmendTarget, next: FieldValue) => {
    setValues((now) => ({ ...now, [keyOf(t)]: next }));
  };

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSave) return;
    if (confirm.confirm()) draft.save();
  }

  function keys(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  }

  let first = true;
  const autoFocus = () => {
    const now = first;
    first = false;
    return now;
  };

  return (
    <form
      aria-label="Ergänzen"
      onSubmit={submit}
      onKeyDown={keys}
      className="flex min-w-0 flex-col gap-4"
      data-testid="amend-form"
    >
      {loading ? (
        <Skeleton className="h-24" />
      ) : failed ? (
        <Alert variant="destructive">
          <AlertTitle>Felder konnten nicht geladen werden</AlertTitle>
          <AlertDescription>
            <ErrorText error={failed.error} />
          </AlertDescription>
        </Alert>
      ) : (
        rows.map(({ t, field, value, built }) => {
          const problem = built.kind === 'problem' ? built.text : null;
          const stored = built.kind === 'item' && t.op !== 'call-target' ? built.stored : null;
          return (
            <fieldset
              key={keyOf(t)}
              className="flex min-w-0 flex-col gap-2"
              data-testid="amend-field"
              data-op={t.op}
              data-element={t.elementId}
            >
              {/* A text field names its field itself; a call target's picker does not. */}
              <legend className="mb-1 text-sm font-medium">
                {t.label}
                {t.op === 'call-target' || !field?.settable ? (
                  <span className="font-normal text-muted-foreground">
                    {' '}
                    · {field?.fieldLabel ?? fieldLabel(t.op)}
                  </span>
                ) : null}
              </legend>
              {!field ? (
                <p className="text-sm text-muted-foreground">
                  Dieses Feld gibt es im aktuellen Stand des Modells nicht mehr.
                </p>
              ) : (
                <>
                  <CurrentValue field={field} />
                  {!field.settable ? (
                    <p className="text-sm text-muted-foreground" data-testid="amend-not-settable">
                      {refusalLabel(field.reason)}.
                    </p>
                  ) : t.op === 'call-target' ? (
                    <CallTargetField
                      field={field}
                      value={value}
                      onChange={(next) => set(t, next)}
                      suggested={suggested}
                      hints={[t.label, field.value ?? '', field.uploadedValue ?? '']}
                      autoFocus={autoFocus()}
                    />
                  ) : t.op === 'message-name' ? (
                    <MessageNameField
                      field={field}
                      value={value}
                      onChange={(next) => set(t, next)}
                      resolve={resolve}
                      autoFocus={autoFocus()}
                      problem={problem}
                      stored={stored}
                    />
                  ) : (
                    <TextField
                      op={t.op}
                      value={value}
                      onChange={(next) => set(t, next)}
                      labels={field.suggestions.labels ?? []}
                      autoFocus={autoFocus()}
                      problem={problem}
                      stored={stored}
                    />
                  )}
                </>
              )}
            </fieldset>
          );
        })
      )}
      {settable ? (
        <AmendEffect
          project={project}
          check={check}
          pending={pending}
          effectId={effectId}
          claimedId={claimedId}
        />
      ) : null}
      {settable ? <ImportHint /> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={draft.saving}
        >
          Abbrechen
        </Button>
        {settable ? (
          <Button
            type="submit"
            size="sm"
            variant={confirm.armed ? 'destructive' : 'default'}
            disabled={!canSave}
            onClick={confirm.repeated}
            aria-describedby={
              check.phase === 'ready'
                ? confirm.claimed
                  ? `${effectId} ${claimedId}`
                  : effectId
                : undefined
            }
            data-testid="amend-submit"
          >
            {draft.saving || check.phase === 'checking' ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <SaveIcon data-icon="inline-start" />
            )}
            {confirm.armed ? 'Trotzdem speichern' : 'Speichern'}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

import type {
  AgentToken,
  AutoAcceptCriteria,
  AutoAcceptKind,
  AutoAcceptRelationType,
  AutoAcceptRule,
  AutoAcceptRuleDraft,
  AutoAcceptTier,
} from '@analyzr/client';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRightIcon, InfoIcon, SaveIcon } from 'lucide-react';
import { useId, useMemo, useState, type FormEvent } from 'react';

import { ErrorText } from '@/components/error-text';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, errorMessage } from '@/lib/api';
import { useNameFlags } from '@/lib/auto-accept-flags';
import {
  AUTO_ACCEPT_KINDS,
  AUTO_ACCEPT_RELATION_TYPES,
  formatThreshold,
  parsePercent,
  percentInput,
  relationTypeLabel,
  revisionChanges,
  suggestedRuleName,
  tierLabel,
  tiersOf,
} from '@/lib/auto-accept-rules';
import { useCreateRule, useReviseRule } from '@/lib/auto-accept-rule-actions';
import { handleName } from '@/lib/labels';
import {
  MAX_AUTO_ACCEPT_MODEL_CHARS,
  MAX_AUTO_ACCEPT_NAME_CHARS,
  MAX_AUTO_ACCEPT_NOTE_CHARS,
} from '@/lib/limits';
import { autoAcceptPreviewQuery, autoAcceptRuleQuery, meQuery } from '@/lib/auto-accept-queries';
import { toast } from '@/lib/toast';
import { useDebounced } from '@/lib/use-debounced';

import { RulePreview } from './rule-preview';

/**
 * German texts of the server's `validation-failed` reasons for a rule (the
 * ones the domain sends; what the schema refuses comes back as `errors`,
 * which the form prevents anyway).
 */
const SAVE_PROBLEMS: Record<string, string> = {
  'name-taken': 'Eine andere Annahmeregel dieses Projekts heißt schon so.',
  'unknown-agent': 'Dieser Agent gehört nicht zu diesem Projekt.',
  'kind-changed': 'Die Art einer Regel ändert sich nie; lege eine neue Regel an.',
};

function saveProblem(error: unknown): string {
  if (error instanceof ApiError) {
    const reason = (error.problem as Record<string, unknown>)['reason'];
    if (typeof reason === 'string' && SAVE_PROBLEMS[reason]) return SAVE_PROBLEMS[reason];
  }
  return errorMessage(error);
}

const ANY = '';

/** What the preview query is keyed on while the form is invalid (it does not run then). */
const NO_CRITERIA: AutoAcceptCriteria = {
  kind: 'relation',
  tier: 'key',
  minConfidence: 1,
  relationType: null,
  agentPrincipalId: null,
  llmModel: null,
  includeAdHoc: false,
};

interface FormState {
  name: string;
  /** The owner typed the name: it stays theirs; until then it follows the criteria. */
  nameEdited: boolean;
  enabled: boolean;
  kind: AutoAcceptKind;
  tier: AutoAcceptTier;
  percent: string;
  relationType: AutoAcceptRelationType | typeof ANY;
  agentPrincipalId: string;
  llmModel: string;
  includeAdHoc: boolean;
  note: string;
}

/** A new rule's prefill (UX5: after a bulk accept, „Gleicher Name ab 100 %“). */
export interface RuleDraft {
  tier: AutoAcceptTier;
  /** The minimum confidence as the field shows it, e.g. „100“. */
  percent: string;
  /** A name of its own; without one the name follows the criteria. */
  name?: string;
}

function initialState(rule: AutoAcceptRule | null, draft?: RuleDraft): FormState {
  if (!rule) {
    return {
      name: draft?.name ?? '',
      nameEdited: draft?.name !== undefined,
      enabled: false,
      kind: 'relation',
      tier: draft?.tier ?? 'key',
      percent: draft?.percent ?? '95',
      relationType: ANY,
      agentPrincipalId: ANY,
      llmModel: '',
      includeAdHoc: false,
      note: '',
    };
  }
  return {
    name: rule.name,
    nameEdited: true,
    enabled: rule.enabled,
    kind: rule.kind,
    tier: rule.tier,
    percent: percentInput(rule.minConfidence),
    relationType: rule.relationType ?? ANY,
    agentPrincipalId: rule.agentPrincipalId ?? ANY,
    llmModel: rule.llmModel ?? '',
    includeAdHoc: rule.includeAdHoc,
    note: rule.note ?? '',
  };
}

/** „Weiter einschränken“ opens by itself when the rule narrows by agent, model, ad hoc or a note. */
function narrows(f: FormState): boolean {
  return (
    f.agentPrincipalId !== ANY || f.llmModel.trim() !== '' || f.includeAdHoc || f.note.trim() !== ''
  );
}

/**
 * The minimum confidence of the form: the rule's own value while the field
 * still shows it (never re-read from the rounded text), else what was typed.
 */
function minConfidenceOf(f: FormState, base: AutoAcceptRule | null): number | null {
  if (base && f.percent === percentInput(base.minConfidence)) return base.minConfidence;
  return parsePercent(f.percent);
}

/** The criteria of a valid form (the preview's body), else `null`. */
function criteriaOfForm(f: FormState, base: AutoAcceptRule | null): AutoAcceptCriteria | null {
  const minConfidence = minConfidenceOf(f, base);
  if (minConfidence === null || !tiersOf(f.kind).includes(f.tier)) return null;
  const model = f.llmModel.trim();
  if (model.length > MAX_AUTO_ACCEPT_MODEL_CHARS) return null;
  return {
    kind: f.kind,
    tier: f.tier,
    minConfidence,
    relationType: f.kind === 'relation' && f.relationType !== ANY ? f.relationType : null,
    agentPrincipalId: f.agentPrincipalId === ANY ? null : f.agentPrincipalId,
    llmModel: model === '' ? null : model,
    includeAdHoc: f.includeAdHoc,
  };
}

/** The name the form shows: the owner's, else the one its criteria suggest. */
function nameOfForm(f: FormState, base: AutoAcceptRule | null, taken: readonly string[]): string {
  if (f.nameEdited) return f.name;
  const min = minConfidenceOf(f, base);
  return suggestedRuleName(
    {
      kind: f.kind,
      tier: f.tier,
      relationType: f.kind === 'relation' && f.relationType !== ANY ? f.relationType : null,
      threshold: min === null ? `${f.percent.replace(/%/g, '').trim()} %` : formatThreshold(min),
    },
    taken,
  );
}

/**
 * Why saving makes the caller the rule's deciding person (its acceptances are
 * recorded under the head revision's author, owner decision 19), as the
 * table's switch says it: always while the author is no longer an owner
 * (saving takes the rule over, even unchanged); for another owner's rule
 * while it is or will be active (a save with changes is authored by the
 * caller). While the caller is unknown (`GET /me` loading or failed) the
 * author may be the caller, and the text says so.
 */
function takeOverText(
  base: AutoAcceptRule | null,
  enabled: boolean,
  me: string | null,
): string | null {
  if (!base) return null;
  const author = handleName(base.author.handle);
  const records = 'Ihre Annahmen werden dann als deine Entscheidungen vermerkt.';
  if (!base.authorIsOwner) {
    return `${author} ist kein Inhaber mehr; bis jemand die Regel neu speichert, nimmt sie nichts an. Speicherst du sie, übernimmst du sie: ${records}`;
  }
  if (base.author.principalId === me || !(base.enabled || enabled)) return null;
  return `Bisher entscheidet ${author}. ${me === null ? 'Bist du das nicht und speicherst' : 'Speicherst'} du eine Änderung, wirst du die entscheidende Person dieser Regel: ${records}`;
}

export interface RuleDialogProps {
  project: string;
  /** The rule to edit (its head revision); `null` creates a new rule. */
  rule: AutoAcceptRule | null;
  /** A new rule's prefill. */
  draft?: RuleDraft | undefined;
  /** The names of the project's rules: a suggested name avoids them. */
  ruleNames?: readonly string[];
  /** The project's agent tokens (revoked ones marked). */
  tokens: readonly AgentToken[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After a save that wrote a revision. */
  onSaved?: (rule: AutoAcceptRule) => void;
}

function RuleForm({
  project,
  rule,
  draft,
  ruleNames = [],
  tokens,
  onOpenChange,
  onSaved,
}: Omit<RuleDialogProps, 'open'>) {
  const id = useId();
  const queryClient = useQueryClient();
  /** The revision the form edits: the rule as opened, or the newer one loaded after a 412. */
  const [base, setBase] = useState<AutoAcceptRule | null>(rule);
  const [form, setForm] = useState<FormState>(() => initialState(rule, draft));
  const [narrowOpen, setNarrowOpen] = useState(() => narrows(form));
  const [conflict, setConflict] = useState<number | null>(null);
  /** After loading a newer revision: what the other owner changed. */
  const [reloaded, setReloaded] = useState<{ revision: number; changes: string[] } | null>(null);
  const [touched, setTouched] = useState(false);
  const create = useCreateRule(project);
  const revise = useReviseRule(project);
  const saving = create.isPending || revise.isPending;
  const saveError = create.error ?? revise.error;

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
  const criteria = useMemo(() => criteriaOfForm(form, base), [form, base]);
  const debounced = useDebounced(criteria, 300);
  const preview = useQuery({
    ...autoAcceptPreviewQuery(project, debounced ?? NO_CRITERIA),
    enabled: debounced !== null,
    placeholderData: keepPreviousData,
  });
  const flags = useNameFlags(project);
  const me = useQuery(meQuery);

  const shownName = nameOfForm(form, base, ruleNames);
  const name = shownName.trim();
  const nameError =
    name === ''
      ? 'Gib der Regel einen Namen.'
      : name.length > MAX_AUTO_ACCEPT_NAME_CHARS
        ? `Höchstens ${MAX_AUTO_ACCEPT_NAME_CHARS} Zeichen.`
        : null;
  const percentError =
    minConfidenceOf(form, base) === null ? 'Gib einen Wert zwischen 50 und 100 % an.' : null;
  const valid = criteria !== null && nameError === null;

  // Agents to narrow to: the project's tokens, plus agents seen in proposals (R1 services).
  const agentOptions = useMemo(() => {
    const out = tokens.map((t) => ({
      principalId: t.principalId,
      label: `${t.name}${t.revokedAt ? ' (widerrufen)' : ''}`,
    }));
    const known = new Set(out.map((o) => o.principalId));
    for (const a of preview.data?.agents ?? []) {
      if (!known.has(a.principalId)) {
        known.add(a.principalId);
        out.push({ principalId: a.principalId, label: handleName(a.handle) });
      }
    }
    if (base?.agentPrincipalId && !known.has(base.agentPrincipalId)) {
      out.push({
        principalId: base.agentPrincipalId,
        label: handleName(base.agent?.handle ?? base.agentPrincipalId),
      });
    }
    return out;
  }, [tokens, preview.data?.agents, base]);

  function save() {
    setTouched(true);
    if (!valid || saving) return;
    const draft: AutoAcceptRuleDraft = {
      ...criteria,
      name,
      enabled: form.enabled,
      note: form.note.trim() === '' ? null : form.note.trim(),
    };
    const done = (outcome: string, saved: AutoAcceptRule) => {
      toast({
        tone: 'success',
        title:
          outcome === 'created'
            ? `Regel „${saved.name}“ angelegt${saved.enabled ? ' und aktiviert' : ''}`
            : outcome === 'unchanged'
              ? 'Nichts geändert'
              : `Regel „${saved.name}“ gespeichert`,
      });
      onOpenChange(false);
      if (outcome !== 'unchanged') onSaved?.(saved);
    };
    if (!base) {
      create.mutate(draft, { onSuccess: (r) => done(r.outcome, r.rule) });
      return;
    }
    setConflict(null);
    setReloaded(null);
    revise.mutate(
      { ruleId: base.id, revision: base.revision, draft },
      {
        onSuccess: (r) => done(r.outcome, r.rule),
        onError: (error) => {
          if (error instanceof ApiError && error.status === 412) {
            const head = (error.problem as Record<string, unknown>)['headRev'];
            setConflict(typeof head === 'number' ? head : base.revision + 1);
          }
        },
      },
    );
  }

  /**
   * After a 412: loads the head and puts it into the form, so the next save
   * builds on what the other owner saved, never silently over it. Own edits
   * are dropped; the alert lists what changed.
   */
  async function loadNewer() {
    if (!base) return;
    const fresh = await queryClient.fetchQuery({
      ...autoAcceptRuleQuery(project, base.id),
      staleTime: 0,
    });
    const next = initialState(fresh);
    setReloaded({ revision: fresh.revision, changes: revisionChanges(base, fresh) });
    setBase(fresh);
    setForm(next);
    if (narrows(next)) setNarrowOpen(true);
    setConflict(null);
    revise.reset();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    save();
  }

  const takeOver = takeOverText(base, form.enabled, me.data?.principalId ?? null);
  const show412 = conflict !== null;
  const showSaveError = saveError && !(saveError instanceof ApiError && saveError.status === 412);
  const tiers = tiersOf(form.kind);

  return (
    <form onSubmit={submit} aria-label="Annahmeregel" className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{base ? `Regel „${base.name}“ bearbeiten` : 'Neue Annahmeregel'}</DialogTitle>
        <DialogDescription>
          Die Vorschau zeigt, was die Regel bisher angenommen hätte und jetzt annähme.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-5 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div className="flex flex-col gap-3" data-testid="rule-fields">
          <Field data-invalid={touched && nameError ? true : undefined}>
            <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
            <Input
              id={`${id}-name`}
              value={shownName}
              maxLength={MAX_AUTO_ACCEPT_NAME_CHARS}
              onChange={(e) => set({ name: e.target.value, nameEdited: true })}
              aria-invalid={touched && nameError ? true : undefined}
            />
            {touched && nameError ? <FieldError>{nameError}</FieldError> : null}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor={`${id}-kind`}>Art</FieldLabel>
              <NativeSelect
                id={`${id}-kind`}
                className="w-full"
                value={form.kind}
                disabled={base !== null}
                onChange={(e) => {
                  const kind = e.target.value as AutoAcceptKind;
                  const allowed = tiersOf(kind);
                  set({
                    kind,
                    tier: allowed.includes(form.tier) ? form.tier : (allowed[0] ?? 'lexical'),
                    relationType: kind === 'relation' ? form.relationType : ANY,
                  });
                }}
              >
                {(Object.keys(AUTO_ACCEPT_KINDS) as AutoAcceptKind[]).map((k) => (
                  <NativeSelectOption key={k} value={k}>
                    {AUTO_ACCEPT_KINDS[k].label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-tier`}>Grundlage</FieldLabel>
              <NativeSelect
                id={`${id}-tier`}
                className="w-full"
                value={form.tier}
                onChange={(e) => set({ tier: e.target.value as AutoAcceptTier })}
              >
                {tiers.map((t) => (
                  <NativeSelectOption key={t} value={t}>
                    {tierLabel(t)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field data-invalid={percentError ? true : undefined}>
              <FieldLabel htmlFor={`${id}-min`}>ab Konfidenz (%)</FieldLabel>
              <Input
                id={`${id}-min`}
                inputMode="decimal"
                value={form.percent}
                onChange={(e) => set({ percent: e.target.value })}
                aria-invalid={percentError ? true : undefined}
              />
              {percentError ? <FieldError>{percentError}</FieldError> : null}
            </Field>
            {form.kind === 'relation' ? (
              <Field>
                <FieldLabel htmlFor={`${id}-type`}>Typ</FieldLabel>
                <NativeSelect
                  id={`${id}-type`}
                  className="w-full"
                  value={form.relationType}
                  onChange={(e) =>
                    set({ relationType: e.target.value as AutoAcceptRelationType | typeof ANY })
                  }
                >
                  <NativeSelectOption value={ANY}>Alle Typen</NativeSelectOption>
                  {AUTO_ACCEPT_RELATION_TYPES.map((t) => (
                    <NativeSelectOption key={t} value={t}>
                      {relationTypeLabel(t)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
          </div>
          {form.kind === 'placement' ? (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              @outside wird nie automatisch angenommen, und ein Prozess mit Heimatschritt oder
              mehreren vorgeschlagenen Schritten auch nicht.
            </p>
          ) : null}
          <details
            className="group/narrow text-sm"
            open={narrowOpen}
            onToggle={(event) => setNarrowOpen(event.currentTarget.open)}
            data-testid="rule-narrow"
          >
            <summary className="inline-flex cursor-pointer list-none items-center gap-0.5 rounded-sm text-muted-foreground select-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
              <ChevronRightIcon
                className="size-3.5 transition-transform group-open/narrow:rotate-90 motion-reduce:transition-none"
                aria-hidden
              />
              Weiter einschränken
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              <Field>
                <FieldLabel htmlFor={`${id}-agent`}>Agent</FieldLabel>
                <NativeSelect
                  id={`${id}-agent`}
                  className="w-full"
                  value={form.agentPrincipalId}
                  onChange={(e) => set({ agentPrincipalId: e.target.value })}
                >
                  <NativeSelectOption value={ANY}>Alle Agenten</NativeSelectOption>
                  {agentOptions.map((a) => (
                    <NativeSelectOption key={a.principalId} value={a.principalId}>
                      {a.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-model`}>LLM-Modell</FieldLabel>
                <Input
                  id={`${id}-model`}
                  list={`${id}-models`}
                  value={form.llmModel}
                  maxLength={MAX_AUTO_ACCEPT_MODEL_CHARS}
                  onChange={(e) => set({ llmModel: e.target.value })}
                  placeholder="Alle Modelle, genau so, wie die Agenten es angeben"
                />
                <datalist id={`${id}-models`}>
                  {(preview.data?.llmModels ?? []).map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id={`${id}-adhoc`}
                  checked={form.includeAdHoc}
                  onCheckedChange={(checked) => set({ includeAdHoc: checked === true })}
                />
                <FieldLabel htmlFor={`${id}-adhoc`}>Auch Ad-hoc-Vorschläge</FieldLabel>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-note`}>Notiz</FieldLabel>
                <Textarea
                  id={`${id}-note`}
                  value={form.note}
                  maxLength={MAX_AUTO_ACCEPT_NOTE_CHARS}
                  onChange={(e) => set({ note: e.target.value })}
                  className="min-h-12"
                />
              </Field>
            </div>
          </details>
        </div>
        <section aria-label="Vorschau" className="flex min-w-0 flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Vorschau
          </h3>
          {criteria === null ? (
            <p className="text-sm text-muted-foreground">
              Vervollständige die Kriterien, dann siehst du hier, was die Regel angenommen hätte.
            </p>
          ) : preview.isError ? (
            <Alert variant="destructive">
              <AlertTitle>Vorschau fehlgeschlagen</AlertTitle>
              <AlertDescription>
                <ErrorText error={preview.error} />
              </AlertDescription>
            </Alert>
          ) : preview.data ? (
            <RulePreview
              preview={preview.data}
              minConfidence={criteria.minConfidence}
              flagged={flags ? flags(preview.data.open.items) : null}
              stale={preview.isPlaceholderData || debounced !== criteria}
            />
          ) : (
            <Skeleton className="h-48 w-full" />
          )}
        </section>
      </div>
      {takeOver ? (
        <Alert data-testid="take-over-hint">
          <AlertDescription>{takeOver}</AlertDescription>
        </Alert>
      ) : null}
      {show412 ? (
        <Alert>
          <AlertTitle>Die Regel wurde inzwischen geändert (Revision {conflict})</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            Es wurde nichts gespeichert.
            <Button size="xs" variant="outline" type="button" onClick={() => void loadNewer()}>
              Neuere Revision laden
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {reloaded ? (
        <Alert data-testid="reloaded">
          <AlertTitle>Revision {reloaded.revision} geladen</AlertTitle>
          <AlertDescription className="flex flex-col gap-1">
            {reloaded.changes.length === 0 ? (
              <span>Die Kriterien sind gleich geblieben.</span>
            ) : (
              <>
                <span>Geändert:</span>
                <ul className="list-disc pl-4">
                  {reloaded.changes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </>
            )}
            <span>
              Das Formular zeigt jetzt diese Revision; deine Änderungen sind verworfen. Trage sie
              bei Bedarf neu ein.
            </span>
          </AlertDescription>
        </Alert>
      ) : null}
      {showSaveError ? (
        <Alert variant="destructive">
          <AlertTitle>Nicht gespeichert</AlertTitle>
          <AlertDescription>{saveProblem(saveError)}</AlertDescription>
        </Alert>
      ) : null}
      <DialogFooter className="sm:items-center">
        {/* last in the phone's reversed column (on top), first in the row (at the left) */}
        <div className="order-last flex items-center gap-2 sm:order-first sm:mr-auto">
          <Switch
            id={`${id}-enabled`}
            checked={form.enabled}
            onCheckedChange={(enabled) => set({ enabled })}
            data-testid="rule-enabled"
          />
          <Label htmlFor={`${id}-enabled`}>Aktiv</Label>
        </div>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
          Abbrechen
        </Button>
        <Button type="submit" disabled={saving || show412} data-testid="rule-save">
          <SaveIcon data-icon="inline-start" />
          Speichern
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * Create or edit an auto-accept rule (owner decision 19; UX-SIMPLIFICATION.md
 * §3.11 item 4): „Art“, „Grundlage“, „ab Konfidenz“ and „Typ“ in view, the
 * name prefilled from them („Gleicher Name ab 95 %“, „(2)“ while another
 * rule has it) until the owner types one; agent, LLM model, ad hoc and a
 * note under „Weiter einschränken“ (open when the rule uses one); beside
 * them the live preview (debounced). One „Speichern“ with the „Aktiv“ switch
 * writes a new immutable revision; an edit sends `If-Match` and, on 412,
 * loads the newer revision into the form (listing what changed) before
 * anything can be saved on top of it. A threshold the field still shows
 * unchanged is saved as it was (never re-read from its text).
 */
export function RuleDialog({ open, onOpenChange, ...props }: RuleDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-5xl"
        data-testid="rule-dialog"
      >
        {open ? <RuleForm onOpenChange={onOpenChange} {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

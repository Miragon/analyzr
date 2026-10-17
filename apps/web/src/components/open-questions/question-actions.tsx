import type {
  OpenQuestion,
  OpenQuestionAction,
  OpenQuestionWithdrawCompare,
} from '@analyzr/client';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  CheckCheckIcon,
  ChevronDownIcon,
  CopyCheckIcon,
  EarthIcon,
  InboxIcon,
  LinkIcon,
  MapPinIcon,
  MessageSquarePlusIcon,
  PenLineIcon,
  RefreshCwIcon,
  Undo2Icon,
  type LucideIcon,
} from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { useCollected } from '@/lib/amendments';
import { ApiError, errorMessage } from '@/lib/api';
import { useQuestionAction } from '@/lib/open-question-actions';
import type { RefResolver } from '@/lib/refs';
import { useRequeue } from '@/lib/review-actions';
import { toast } from '@/lib/toast';

import { useActionFeedback, withdrawMark } from './action-feedback';
import {
  ChooseCopyPanel,
  DecidePanel,
  LinkPanel,
  PlacePanel,
  type PanelProps,
} from './action-panels';
import { AmendPanel, WithdrawAllPanel, WithdrawOnePanel } from './amend-panel';

/**
 * The action row of an open question (M6 §4.8 a, S5c-1), for reviewers
 * only: the primary action as the visible button, the others under
 * „Weitere Aktionen“, the item's links next to them; a panel below for the
 * actions that pick something or decide (link, place, choose the copy,
 * decide), one click for the rest (the outside mark, „Gehört zu keinem
 * Schritt“, requeue), the chain page for a step's link, the note dialog for
 * „Notiz hinzufügen“. An item marked „außerhalb“ offers to take the mark
 * back instead. Model amendments (S5c-2): `amend` opens the amend form
 * below the item (with „Sammeln“); `withdraw-amendment` opens a
 * confirmation with the withdrawal's cost (its dry run), for one amendment
 * („Wert aus dem Quellsystem übernehmen“) or every amendment of the model;
 * a `value-changed` conflict shows both values side by side, with „Meine
 * Ergänzung behalten“ as a visible second button where it is offered.
 */

/** What the row needs from the list it sits in. */
export interface QuestionActor {
  /** Opens the note dialog from its button (one dialog per list). */
  note: (q: OpenQuestion, trigger: HTMLElement) => void;
  /** An action ran: the item left the list or changed, the focus moves on. */
  acted: (q: OpenQuestion) => void;
}

const ICONS: Record<OpenQuestionAction['type'], LucideIcon> = {
  decide: CheckCheckIcon,
  link: LinkIcon,
  place: MapPinIcon,
  'choose-copy': CopyCheckIcon,
  outside: EarthIcon,
  requeue: RefreshCwIcon,
  'fix-link': PenLineIcon,
  amend: PenLineIcon,
  'withdraw-amendment': Undo2Icon,
  note: MessageSquarePlusIcon,
};

function MenuIcon({ type }: { type: OpenQuestionAction['type'] }) {
  const Icon = ICONS[type];
  return <Icon />;
}

/** Whether an action opens a panel below the item (it picks something or decides). */
function hasPanel(action: OpenQuestionAction): boolean {
  switch (action.type) {
    case 'decide':
    case 'link':
    case 'choose-copy':
      return true;
    case 'place':
      return action.step === undefined;
    case 'amend':
      return true;
    case 'withdraw-amendment':
      // A withdrawal writes a new head: its cost first, from the dry run (M6 §4.8 c).
      return true;
    default:
      return false;
  }
}

/** The panel of an action that has one. */
function ActionPanel(props: PanelProps) {
  switch (props.action.type) {
    case 'decide':
      return <DecidePanel {...props} />;
    case 'link':
      return <LinkPanel {...props} />;
    case 'choose-copy':
      return <ChooseCopyPanel {...props} />;
    case 'place':
      return <PlacePanel {...props} />;
    case 'amend':
      return <AmendPanel {...props} />;
    case 'withdraw-amendment':
      return props.action.withdraw?.amendment === undefined ? (
        <WithdrawAllPanel {...props} />
      ) : (
        <WithdrawOnePanel {...props} />
      );
    default:
      return null;
  }
}

/** The chain page at the item's step, where its link editor corrects the link. */
function FixLinkButton({
  action,
  project,
  step,
  variant,
  describedBy,
}: {
  action: OpenQuestionAction;
  project: string;
  step: string;
  variant: 'default' | 'outline';
  describedBy: string;
}) {
  return (
    <Button variant={variant} size="sm" asChild>
      <Link
        to="/projects/$project/value-chain"
        params={{ project }}
        search={{ step }}
        aria-describedby={describedBy}
        data-testid="question-action"
        data-action={action.type}
        data-primary={action.primary}
      >
        <PenLineIcon data-icon="inline-start" />
        {action.label}
      </Link>
    </Button>
  );
}

/** One action as a button: the primary one in the row. */
function ActionButton({
  action,
  variant,
  busy,
  running,
  expanded,
  panelId,
  describedBy,
  onChoose,
}: {
  action: OpenQuestionAction;
  variant: 'default' | 'outline';
  /** Another action of the item runs: wait for it. */
  busy: boolean;
  /** This one runs (a one-click action): a spinner instead of its icon. */
  running: boolean;
  expanded: boolean;
  panelId: string;
  describedBy: string;
  onChoose: (action: OpenQuestionAction, trigger: HTMLElement) => void;
}) {
  const Icon = ICONS[action.type];
  const expands = hasPanel(action);
  return (
    <Button
      variant={variant}
      size="sm"
      disabled={busy}
      onClick={(event) => onChoose(action, event.currentTarget)}
      aria-describedby={describedBy}
      {...(expands ? { 'aria-expanded': expanded, 'aria-controls': panelId } : {})}
      data-testid="question-action"
      data-action={action.type}
      data-primary={action.primary}
    >
      {running ? <Spinner data-icon="inline-start" /> : <Icon data-icon="inline-start" />}
      {action.label}
    </Button>
  );
}

/** The hint next to an action, e.g. „in analyzr ergänzt“ on an `amend` whose value comes from an amendment. */
function ActionHint({ action }: { action: OpenQuestionAction | undefined }) {
  if (!action?.hint) return null;
  return (
    <span className="text-xs text-muted-foreground" data-testid="question-action-hint">
      {action.hint}
    </span>
  );
}

/** „(leer)“ for no value, else the value in German quotes. */
const shownValue = (value: string | null) =>
  value === null || value === '' ? '(leer)' : `„${value}“`;

/** The two values of a `value-changed` conflict, side by side, above its actions. */
function ConflictValues({ compare }: { compare: OpenQuestionWithdrawCompare }) {
  return (
    <dl
      className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border bg-muted/40 p-2.5 text-sm"
      aria-label={`${compare.field}: die beiden Werte`}
      data-testid="conflict-values"
    >
      <dt className="text-muted-foreground">Im Quellsystem</dt>
      <dd className="min-w-0 font-medium break-words" data-testid="conflict-incoming">
        {shownValue(compare.incoming)}
      </dd>
      <dt className="text-muted-foreground">In analyzr ergänzt</dt>
      <dd className="min-w-0 font-medium break-words" data-testid="conflict-after">
        {shownValue(compare.after)}
      </dd>
      <dt className="text-muted-foreground">Vorher</dt>
      <dd className="min-w-0 break-words text-muted-foreground">{shownValue(compare.before)}</dd>
    </dl>
  );
}

const isGone = (error: unknown) =>
  error instanceof ApiError && error.status === 404 && error.problem.code === 'not-found';

/**
 * A stable key of an action within its item (types repeat: `place` on a step
 * and on `@outside`, `withdraw-amendment` of one amendment and of all).
 */
const keyOf = (a: OpenQuestionAction) =>
  `${a.type}:${a.pick ?? ''}:${a.step ?? ''}:${a.withdraw?.amendment ?? ''}:${a.amend?.targets[0]?.op ?? ''}`;

export function QuestionActions({
  q,
  project,
  resolve,
  describedBy,
  links,
  actor,
}: {
  q: OpenQuestion;
  project: string;
  resolve: RefResolver;
  /** The id of the item's subject: every button names it for screen readers. */
  describedBy: string;
  /** The item's links („Im Modell zeigen“, „Prüfen“ …), shown after the actions. */
  links: ReactNode;
  actor: QuestionActor;
}) {
  const panelId = useId();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const act = useQuestionAction(project);
  const requeue = useRequeue(project);
  const feedback = useActionFeedback(project, resolve);
  // An amendment collected at this item waits in the collection's bar („Sammeln“).
  const collected = useCollected().some((c) => c.questionId === q.id);
  const [withdrawing, setWithdrawing] = useState(false);
  /** The one-click action that runs (its button shows a spinner). */
  const [running, setRunning] = useState<string | null>(null);

  // A live outside mark: the item is done; the row offers to take the mark back.
  const mark = q.answers.find((a) => a.role === 'outside-mark' && a.withdrawal === null);
  const actions = q.actions.filter((a) => !(mark && a.type === 'outside'));
  const primary = mark ? undefined : actions.find((a) => a.primary);
  // A conflict between the source tool's value and analyzr's (M6 §4.8 a): both values side
  // by side, and keeping analyzr's value as a visible second button where it is offered.
  const compare = primary?.type === 'withdraw-amendment' ? primary.withdraw?.compare : undefined;
  const keep = compare
    ? actions.find((a) => a.type === 'amend' && a.amend?.replaces === primary?.withdraw?.amendment)
    : undefined;
  const others = actions.filter((a) => a !== primary && a !== keep);
  const current = actions.find((a) => keyOf(a) === open && hasPanel(a));
  const busy = act.isPending || requeue.isPending || withdrawing;

  function closePanel() {
    setOpen(null);
    const el = opener.current;
    requestAnimationFrame(() => {
      if (el?.isConnected) el.focus();
    });
  }

  async function runNow(action: OpenQuestionAction) {
    setRunning(keyOf(action));
    try {
      await runOneClick(action);
    } finally {
      setRunning(null);
    }
  }

  async function runOneClick(action: OpenQuestionAction) {
    if (action.type === 'requeue') {
      try {
        const result = await requeue.mutateAsync([q.subject.id]);
        const outcome = result.items[0]?.outcome;
        toast(
          outcome === 'queued'
            ? {
                tone: 'success',
                title: 'Erneut eingeplant',
                description: 'Die Analyse des Modells ist eingeplant; ein Agent holt sie ab.',
              }
            : outcome === 'open'
              ? {
                  tone: 'info',
                  title: 'Schon eingeplant',
                  description: 'Für das Modell wartet schon eine Analyse auf einen Agenten.',
                }
              : {
                  tone: 'warning',
                  title: 'Nicht eingeplant',
                  description: 'Das Modell gibt es nicht mehr.',
                },
        );
      } catch (error) {
        toast({ tone: 'danger', title: 'Nicht eingeplant', description: errorMessage(error) });
      }
      return;
    }
    const body =
      action.type === 'outside'
        ? ({ type: 'outside' } as const)
        : ({ type: 'place', step: action.step ?? '' } as const);
    try {
      const result = await act.mutateAsync({ questionId: q.id, body });
      feedback.done(q, action.type, result);
      actor.acted(q);
    } catch (error) {
      if (isGone(error)) feedback.gone();
      else toast({ tone: 'danger', title: 'Nicht ausgeführt', description: errorMessage(error) });
    }
  }

  function choose(action: OpenQuestionAction, trigger: HTMLElement | null) {
    if (action.type === 'note') {
      if (trigger) actor.note(q, trigger);
      return;
    }
    if (hasPanel(action)) {
      opener.current = trigger;
      setOpen((now) => (now === keyOf(action) ? null : keyOf(action)));
      return;
    }
    void runNow(action);
  }

  async function takeBack() {
    if (!mark) return;
    setWithdrawing(true);
    try {
      await withdrawMark(queryClient, project, q.id, mark.id);
    } finally {
      setWithdrawing(false);
    }
  }

  const menuTrigger = useRef<HTMLButtonElement>(null);
  // A menu item that opens the note dialog or a panel runs once the menu has closed, so the
  // dialog's field or the panel's search keeps the focus (not the menu's trigger).
  const deferred = useRef<OpenQuestionAction | null>(null);

  return (
    <>
      {compare ? <ConflictValues compare={compare} /> : null}
      <div className="flex flex-wrap items-center gap-2" data-testid="question-actions">
        {mark ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void takeBack()}
            aria-describedby={describedBy}
            data-testid="question-withdraw-mark"
          >
            {withdrawing ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <Undo2Icon data-icon="inline-start" />
            )}
            Markierung zurücknehmen
          </Button>
        ) : null}
        {primary?.type === 'fix-link' ? (
          <FixLinkButton
            action={primary}
            project={project}
            step={q.subject.id}
            variant="default"
            describedBy={describedBy}
          />
        ) : primary ? (
          <ActionButton
            action={primary}
            variant="default"
            busy={busy}
            running={running === keyOf(primary)}
            expanded={open === keyOf(primary)}
            panelId={panelId}
            describedBy={describedBy}
            onChoose={choose}
          />
        ) : null}
        {keep ? (
          <ActionButton
            action={keep}
            variant="outline"
            busy={busy}
            running={false}
            expanded={open === keyOf(keep)}
            panelId={panelId}
            describedBy={describedBy}
            onChoose={choose}
          />
        ) : null}
        <ActionHint action={primary} />
        {collected ? (
          <span
            className="inline-flex items-center gap-1 text-xs text-primary"
            data-testid="question-collected"
          >
            <InboxIcon className="size-3.5" aria-hidden />
            gesammelt
          </span>
        ) : null}
        {others.length > 0 ? (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                ref={menuTrigger}
                variant="outline"
                size="sm"
                disabled={busy}
                aria-describedby={describedBy}
                data-testid="question-more-actions"
              >
                Weitere Aktionen
                <ChevronDownIcon data-icon="inline-end" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              onCloseAutoFocus={(event) => {
                const action = deferred.current;
                deferred.current = null;
                if (action) {
                  event.preventDefault();
                  choose(action, menuTrigger.current);
                }
              }}
            >
              {others.map((action) =>
                action.type === 'fix-link' ? (
                  <DropdownMenuItem key={keyOf(action)} asChild>
                    <Link
                      to="/projects/$project/value-chain"
                      params={{ project }}
                      search={{ step: q.subject.id }}
                      data-testid="question-action"
                      data-action={action.type}
                    >
                      <PenLineIcon />
                      {action.label}
                    </Link>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    key={keyOf(action)}
                    onSelect={() => {
                      if (action.type === 'note' || hasPanel(action)) deferred.current = action;
                      else choose(action, menuTrigger.current);
                    }}
                    data-testid="question-action"
                    data-action={action.type}
                    data-primary={false}
                  >
                    <MenuIcon type={action.type} />
                    {action.label}
                    {action.hint ? (
                      <span className="ml-auto pl-2 text-xs text-muted-foreground">
                        {action.hint}
                      </span>
                    ) : null}
                  </DropdownMenuItem>
                ),
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <div className="flex flex-1 flex-wrap justify-end gap-2">{links}</div>
      </div>
      {current ? (
        <div
          id={panelId}
          role="region"
          aria-label={current.label}
          className="rounded-lg border bg-muted/40 p-3"
          data-testid="question-action-panel"
          data-action={current.type}
        >
          <ActionPanel
            q={q}
            action={current}
            project={project}
            resolve={resolve}
            onCancel={closePanel}
            onDone={() => {
              setOpen(null);
              actor.acted(q);
            }}
          />
        </div>
      ) : null}
    </>
  );
}

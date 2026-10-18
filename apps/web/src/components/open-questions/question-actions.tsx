import type {
  OpenQuestion,
  OpenQuestionAction,
  OpenQuestionWithdrawCompare,
} from '@analyzr/client';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  ArrowUpRightIcon,
  ChevronDownIcon,
  CopyCheckIcon,
  CopyIcon,
  EarthIcon,
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
import { ApiError, errorMessage } from '@/lib/api';
import { useQuestionAction } from '@/lib/open-question-actions';
import { CARD_ACTION_LABELS, actionLink, cardActions, type CardAction } from '@/lib/open-questions';
import type { RefResolver } from '@/lib/refs';
import { useRequeue } from '@/lib/review-actions';
import { toast } from '@/lib/toast';

import { useActionFeedback } from './action-feedback';
import { ChooseCopyPanel, LinkPanel, PlacePanel, type PanelProps } from './action-panels';
import { AmendPanel, WithdrawAllPanel, WithdrawOnePanel } from './amend-panel';

/**
 * The action row of an open question (M6 §4.8 a, S5c-1; UX2b), for
 * reviewers only, at most three actions (UX-SIMPLIFICATION.md §3.3 item 5):
 * the primary one, one beside it where the card needs two (a hold's
 * „Jetzt entscheiden“, an amendment conflict's „Meine Ergänzung behalten“),
 * the rest under „Weitere Aktionen“ with „Kennung kopieren“ last, or, when
 * the note is the only one left, the ghost button „Notiz“ (UX4). A link and
 * the amendment of the same gap share one entry („Ziel wählen …“, UX4). A panel
 * opens below the item for the actions that pick something (link, place,
 * choose the copy, amend, a withdrawal's cost); one click runs the rest (the
 * outside mark, „Gehört zu keinem Schritt“, requeue); „Link korrigieren“
 * opens the chain page at the step; a note opens the note dialog, for a
 * hold as „Antwort geben“ (its one answer place, §2.4). A `decide` is
 * decided where the diagrams are (owner decision 26, Q4): a hold's
 * „Jetzt entscheiden“ and an agent's question's „Vorschlag öffnen“ open the
 * review screen or the chain, the `proposal` items' „Auf der Kette prüfen“
 * the chain at the step.
 */

/** What the row needs from the list it sits in. */
export interface QuestionActor {
  /** Opens the note dialog from its button (one dialog per list; a hold's answer, M6 §2.4). */
  note: (q: OpenQuestion, trigger: HTMLElement) => void;
  /** An action ran: the item left the list or changed, the focus moves on. */
  acted: (q: OpenQuestion) => void;
}

const ICONS: Record<OpenQuestionAction['type'], LucideIcon> = {
  decide: ArrowUpRightIcon,
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

/** Whether an action opens a panel below the item (it picks something). */
function hasPanel(action: OpenQuestionAction): boolean {
  switch (action.type) {
    case 'link':
    case 'choose-copy':
    case 'amend':
      return true;
    case 'place':
      return action.step === undefined;
    case 'withdraw-amendment':
      // A withdrawal writes a new head: its cost first, from the dry run (M6 §4.8 c).
      return true;
    default:
      return false;
  }
}

/** Whether an action is a link to another page (decided or corrected there). */
const isLink = (action: OpenQuestionAction) =>
  action.type === 'decide' || action.type === 'fix-link';

/** The panel of an action that has one. */
function ActionPanel(props: PanelProps) {
  switch (props.action.type) {
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

/** A link action as a button or a menu entry: the review screen or the chain page. */
function ActionLink({
  q,
  card,
  project,
  className,
  describedBy,
  primary,
  children,
}: {
  q: OpenQuestion;
  card: CardAction;
  project: string;
  className?: string;
  describedBy?: string;
  primary: boolean;
  children: ReactNode;
}) {
  const link = actionLink(q, card.action);
  // From the tab, the review screen leads back to it (UX5, Q4); the model view keeps the list's way.
  const inTab = useRouterState({
    select: (state) => state.location.pathname.endsWith('/open-questions'),
  });
  const common = {
    className,
    'aria-describedby': describedBy,
    'data-testid': 'question-action',
    'data-action': card.action.type,
    'data-primary': primary,
  };
  if (link?.to === 'review')
    return (
      <Link
        to="/projects/$project/review/$relation"
        params={{ project, relation: link.relation }}
        search={{
          ...(link.held ? { view: 'held' as const } : {}),
          ...(inTab ? { from: 'open-questions' as const } : {}),
        }}
        {...common}
      >
        {children}
      </Link>
    );
  return (
    <Link
      to="/projects/$project/value-chain"
      params={{ project }}
      search={{
        ...(link?.to === 'chain' && link.step ? { step: link.step } : {}),
        ...(link?.to === 'chain' && link.placement ? { placement: link.placement } : {}),
      }}
      {...common}
    >
      {children}
    </Link>
  );
}

/** One action as a button: the primary one, or the one beside it. */
function ActionButton({
  q,
  card,
  project,
  variant,
  primary,
  busy,
  running,
  expanded,
  panelId,
  describedBy,
  onChoose,
}: {
  q: OpenQuestion;
  card: CardAction;
  project: string;
  variant: 'default' | 'outline';
  primary: boolean;
  /** Another action of the item runs: wait for it. */
  busy: boolean;
  /** This one runs (a one-click action): a spinner instead of its icon. */
  running: boolean;
  expanded: boolean;
  panelId: string;
  describedBy: string;
  onChoose: (card: CardAction, trigger: HTMLElement) => void;
}) {
  const { action } = card;
  const Icon = ICONS[action.type];
  if (isLink(action))
    return (
      <Button variant={variant} size="sm" asChild>
        <ActionLink q={q} card={card} project={project} describedBy={describedBy} primary={primary}>
          <Icon data-icon="inline-start" />
          {card.label}
        </ActionLink>
      </Button>
    );
  const expands = hasPanel(action);
  return (
    <Button
      variant={variant}
      size="sm"
      disabled={busy}
      onClick={(event) => onChoose(card, event.currentTarget)}
      aria-describedby={describedBy}
      {...(expands ? { 'aria-expanded': expanded, 'aria-controls': panelId } : {})}
      data-testid="question-action"
      data-action={action.type}
      data-primary={primary}
    >
      {running ? <Spinner data-icon="inline-start" /> : <Icon data-icon="inline-start" />}
      {card.label}
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

/** „Kennung kopieren“: the id for `analyzr questions …`, never shown on the card (P2). */
async function copyId(id: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(id);
    toast({ tone: 'success', title: 'Kennung kopiert', description: id });
  } catch {
    toast({
      tone: 'danger',
      title: 'Kopieren hat nicht geklappt',
      description: `Der Browser erlaubt keinen Zugriff auf die Zwischenablage. Die Kennung ist ${id}.`,
    });
  }
}

export function QuestionActions({
  q,
  project,
  resolve,
  describedBy,
  actor,
}: {
  q: OpenQuestion;
  project: string;
  resolve: RefResolver;
  /** The id of the item's subject: every button names it for screen readers. */
  describedBy: string;
  actor: QuestionActor;
}) {
  const panelId = useId();
  const [open, setOpen] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const act = useQuestionAction(project);
  const requeue = useRequeue(project);
  const feedback = useActionFeedback(project, resolve);
  /** The one-click action that runs (its button shows a spinner). */
  const [running, setRunning] = useState<string | null>(null);

  const { primary, secondary, menu } = cardActions(q);
  // A conflict between the source tool's value and analyzr's (M6 §4.8 a): both values side by side.
  const compare =
    primary?.action.type === 'withdraw-amendment' ? primary.action.withdraw?.compare : undefined;
  const all = [primary, secondary, ...menu].filter((c): c is CardAction => c !== undefined);
  const current = all.find((c) => keyOf(c.action) === open && hasPanel(c.action));
  const busy = act.isPending || requeue.isPending;
  const menuTrigger = useRef<HTMLButtonElement>(null);
  // A menu item that opens the note dialog or a panel runs once the menu has closed, so the
  // dialog's field or the panel's search keeps the focus (not the menu's trigger).
  const deferred = useRef<CardAction | null>(null);

  if (all.length === 0) return null;

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
        toast({
          tone: 'danger',
          title: 'Nicht eingeplant',
          description: errorMessage(error),
          error,
        });
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
      else
        toast({
          tone: 'danger',
          title: 'Nicht ausgeführt',
          description: errorMessage(error),
          error,
        });
    }
  }

  function choose(card: CardAction, trigger: HTMLElement | null) {
    const { action } = card;
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

  const button = (card: CardAction, isPrimary: boolean) => (
    <ActionButton
      key={keyOf(card.action)}
      q={q}
      card={card}
      project={project}
      variant={isPrimary ? 'default' : 'outline'}
      primary={isPrimary}
      busy={busy}
      running={running === keyOf(card.action)}
      expanded={open === keyOf(card.action)}
      panelId={panelId}
      describedBy={describedBy}
      onChoose={choose}
    />
  );

  return (
    <>
      {compare ? <ConflictValues compare={compare} /> : null}
      <div className="flex flex-wrap items-center gap-2" data-testid="question-actions">
        {/* Keyed, so a button that changes places (a hold's „Antwort geben“ once answered)
            stays the same element and keeps the focus the note dialog gives back. */}
        {[primary ? button(primary, true) : null, secondary ? button(secondary, false) : null]}
        {/* The joined entry's hint is its amendment's („in analyzr ergänzt“). */}
        <ActionHint action={primary?.amend?.action.hint ? primary.amend.action : primary?.action} />
        {menu.length === 1 && menu[0]?.action.type === 'note' ? (
          // One entry, the note: a ghost button instead of a menu (UX-SIMPLIFICATION.md §3.4 item 7).
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={(event) => choose(menu[0]!, event.currentTarget)}
            aria-describedby={describedBy}
            data-testid="question-action"
            data-action="note"
            data-primary={false}
          >
            <MessageSquarePlusIcon data-icon="inline-start" />
            {CARD_ACTION_LABELS.note}
          </Button>
        ) : menu.length > 0 ? (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                ref={menuTrigger}
                variant="ghost"
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
                const card = deferred.current;
                deferred.current = null;
                if (card) {
                  event.preventDefault();
                  choose(card, menuTrigger.current);
                }
              }}
            >
              {menu.map((card) => {
                const Icon = ICONS[card.action.type];
                return isLink(card.action) ? (
                  <DropdownMenuItem key={keyOf(card.action)} asChild>
                    <ActionLink q={q} card={card} project={project} primary={false}>
                      <Icon />
                      {card.label}
                    </ActionLink>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    key={keyOf(card.action)}
                    onSelect={() => {
                      if (card.action.type === 'note' || hasPanel(card.action))
                        deferred.current = card;
                      else choose(card, menuTrigger.current);
                    }}
                    data-testid="question-action"
                    data-action={card.action.type}
                    data-primary={false}
                  >
                    <Icon />
                    {card.label}
                    {card.action.hint ? (
                      <span className="ml-auto pl-2 text-xs text-muted-foreground">
                        {card.action.hint}
                      </span>
                    ) : null}
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuItem onSelect={() => void copyId(q.id)} data-testid="question-copy-id">
                <CopyIcon />
                {CARD_ACTION_LABELS.copyId}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {current ? (
        <div
          id={panelId}
          role="region"
          aria-label={current.label}
          className="rounded-lg border bg-muted/40 p-3"
          data-testid="question-action-panel"
          data-action={current.action.type}
        >
          <ActionPanel
            q={q}
            action={current.action}
            amend={current.amend}
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

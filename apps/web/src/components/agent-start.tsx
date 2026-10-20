import { Link } from '@tanstack/react-router';
import { ExternalLinkIcon, PlayIcon, PlugIcon, RotateCcwIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentProps } from 'react';

import { CopyButton } from '@/components/copy-button';
import { LightPopover } from '@/components/light-popover';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api';
import { useAgentState } from '@/lib/agent-state';
import { useProjectPermissions } from '@/lib/permissions';
import { useRequeue, useRequeueChain } from '@/lib/review-actions';
import { ANALYZR_REPOSITORY_URL } from '@/lib/server-mode';
import { toast } from '@/lib/toast';

/**
 * „Agent starten“ (UX-SIMPLIFICATION.md §2.6): one popover with the copyable
 * skill commands of the analyzr plugin for Claude Code, the Claude Desktop
 * start prompt and the one sentence that agents only propose. Two states from
 * the project's agent tokens (owners): without an active token the entry is
 * „Agent verbinden“ (the settings page), otherwise „Agent starten“. Owners see
 * it; editors see the status lines without it.
 */

/** The Claude Desktop start prompt (German, with its placeholders), in the repository. */
const DESKTOP_PROMPT_URL = `${ANALYZR_REPOSITORY_URL}/blob/main/examples/agents/claude-desktop/start-prompt.de.md`;

/** A command to copy, wrapped rather than cut, so it can be read and checked first. */
function Command({ text, label }: { text: string; label: string }) {
  return (
    <div className="flex items-start gap-2">
      <code className="min-w-0 flex-1 rounded-md bg-muted px-2 py-1 font-mono text-[13px] break-all">
        {text}
      </code>
      <CopyButton value={text} label="Kopieren" aria-label={label} copiedMessage="Befehl kopiert" />
    </div>
  );
}

/**
 * How to start the agent: the skill commands to copy, the Claude Desktop
 * start prompt, and that only humans decide. The popover's content, and step
 * 3 of „Agent verbinden“ inline.
 */
export function StartCommands({ project, hasChain }: { project: string; hasChain: boolean }) {
  return (
    <>
      <p className="text-muted-foreground">In Claude Code mit dem analyzr-Plugin:</p>
      <Command text={`/analyzr:relations ${project}`} label="Befehl für die Relationen kopieren" />
      {hasChain ? (
        <Command
          text={`/analyzr:placements ${project}`}
          label="Befehl für die Platzierungen kopieren"
        />
      ) : null}
      <a
        href={DESKTOP_PROMPT_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 self-start text-link hover:underline"
      >
        Startprompt für Claude Desktop
        <ExternalLinkIcon className="size-3.5" aria-hidden />
      </a>
      <p className="text-muted-foreground">
        {hasChain
          ? 'Die Vorschläge erscheinen unter „Relationen“ und auf der „Wertschöpfungskette“.'
          : 'Die Vorschläge erscheinen unter „Relationen“.'}{' '}
        Entscheiden kannst nur du.
      </p>
    </>
  );
}

/** The popover's content: the commands, or the way to a token first. */
export function AgentStartPanel({
  project,
  state,
  hasChain,
}: {
  project: string;
  state: 'connect' | 'start';
  hasChain: boolean;
}) {
  if (state === 'connect') {
    return (
      <div className="flex w-80 flex-col gap-2 p-2" data-testid="agent-start">
        <p>Noch ist kein Agent mit diesem Projekt verbunden.</p>
        <Button asChild size="sm" className="self-start">
          <Link to="/projects/$project/agents" params={{ project }}>
            <PlugIcon data-icon="inline-start" />
            Agent verbinden
          </Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="flex w-[22rem] max-w-full flex-col gap-2 p-2" data-testid="agent-start">
      <p className="font-semibold">Agent starten</p>
      <StartCommands project={project} hasChain={hasChain} />
    </div>
  );
}

type ButtonLook = Pick<ComponentProps<typeof Button>, 'variant' | 'size' | 'className'>;

/**
 * The entry of „Als Nächstes“ and the other places that start the agent:
 * „Agent verbinden“ (a link to the settings page) without an active token,
 * else „Agent starten“ with the popover. Nothing for non-owners.
 */
export function AgentStart({
  project,
  hasChain,
  align = 'start',
  testId,
  ...look
}: {
  project: string;
  hasChain: boolean;
  align?: 'start' | 'end';
  testId?: string;
} & ButtonLook) {
  const state = useAgentState(project);
  const [open, setOpen] = useState(false);
  if (state === null) return null;
  if (state === 'connect') {
    return (
      <Button asChild {...look}>
        <Link to="/projects/$project/agents" params={{ project }} data-testid={testId}>
          <PlugIcon data-icon="inline-start" />
          Agent verbinden
        </Link>
      </Button>
    );
  }
  return (
    <LightPopover
      open={open}
      onOpenChange={setOpen}
      label="Agent starten"
      align={align}
      trigger={(props) => (
        <Button {...look} {...props} data-testid={testId}>
          <PlayIcon data-icon="inline-start" />
          Agent starten
        </Button>
      )}
    >
      <AgentStartPanel project={project} state="start" hasChain={hasChain} />
    </LightPopover>
  );
}

/**
 * „Nochmal versuchen“: requeues the models' analyses, or with `chain` the
 * chain's placement task (permission `write`), and, since a requeue alone
 * runs nothing, opens the popover for owners (clicked again while it is
 * open, it closes it and requeues nothing; when the owner's agent tokens
 * are not known yet as the requeue answers, a toast, and the popover once
 * they are); editors get a toast and a plain button without a popup. With
 * `chain` and the label „Agent starten“ it is the chain's „3 Prozesse
 * fällig · Agent starten“ (§2.6); with `requeue` off it only opens the
 * popover (a task is queued already), so the chain's line keeps one button,
 * and its open popover, while a requeue moves the line from „fällig“ to
 * „Wartet auf den Agenten“.
 */
export function RetryAgent({
  project,
  modelKeys = [],
  chain = false,
  requeue: requeueFirst = true,
  hasChain,
  label = 'Nochmal versuchen',
  start = false,
  align = 'start',
  testId,
  ...look
}: {
  project: string;
  modelKeys?: readonly string[];
  /** The play icon of „Agent starten“ instead of the retry arrow. */
  start?: boolean;
  /** Requeue the value chain's placement task instead of the models' analyses. */
  chain?: boolean;
  /** Off: only the popover (owners); nothing for editors. */
  requeue?: boolean;
  hasChain: boolean;
  label?: string;
  align?: 'start' | 'end';
  testId?: string;
} & ButtonLook) {
  const { canWrite, isOwner } = useProjectPermissions(project);
  const state = useAgentState(project);
  const requeue = useRequeue(project);
  const requeueChain = useRequeueChain(project);
  const [open, setOpen] = useState(false);
  // The agent state when the requeue answers, not when it was clicked.
  const known = useRef(state);
  useEffect(() => {
    known.current = state;
  }, [state]);
  if (!canWrite || (!requeueFirst && state === null)) return null;
  const failed = (error: unknown) =>
    toast({
      tone: 'danger',
      title: 'Nicht eingeplant',
      description: errorMessage(error),
      error,
    });
  // An owner gets the popover also when their agent tokens arrive after the click (the plain
  // button turns into its open trigger); a toast while they are not known, and for editors.
  const queued = (title: string, description: string) => {
    if (isOwner) setOpen(true);
    if (known.current === null) toast({ tone: 'success', title, description });
  };
  const run = () =>
    !requeueFirst
      ? setOpen(true)
      : chain
        ? requeueChain.mutate(undefined, {
            onSuccess: (result) => {
              const outcome = result.valueChain?.outcome;
              if (outcome === 'queued' || outcome === 'open')
                queued('Eingeplant', 'Die Platzierungsaufgabe wartet auf den Agenten.');
              else if (outcome === 'nothing-due')
                toast({
                  tone: 'info',
                  title: 'Nichts fällig',
                  description:
                    'Jeder offene Prozess hat ein Urteil des Agenten auf seinem jetzigen Stand.',
                });
              else
                toast({
                  tone: 'danger',
                  title: 'Nicht eingeplant',
                  description: 'Das Projekt hat keine Wertschöpfungskette.',
                });
            },
            onError: failed,
          })
        : requeue.mutate([...modelKeys], {
            onSuccess: () =>
              queued(
                'Nochmal eingeplant',
                `${modelKeys.length === 1 ? '1 Modell wartet' : `${modelKeys.length} Modelle warten`} wieder auf den Agenten.`,
              ),
            onError: failed,
          });
  const pending = requeue.isPending || requeueChain.isPending;
  const content = (
    <>
      {start ? <PlayIcon data-icon="inline-start" /> : <RotateCcwIcon data-icon="inline-start" />}
      {label}
    </>
  );
  if (state === null)
    return (
      <Button {...look} disabled={pending} onClick={run} data-testid={testId}>
        {content}
      </Button>
    );
  return (
    <LightPopover
      open={open}
      onOpenChange={setOpen}
      label="Agent starten"
      align={align}
      trigger={(props) => (
        <Button
          {...look}
          {...props}
          disabled={pending}
          onClick={() => (open ? setOpen(false) : run())}
          data-testid={testId}
        >
          {content}
        </Button>
      )}
    >
      <AgentStartPanel project={project} state={state} hasChain={hasChain} />
    </LightPopover>
  );
}

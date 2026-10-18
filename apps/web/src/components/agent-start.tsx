import { Link } from '@tanstack/react-router';
import { ExternalLinkIcon, PlayIcon, PlugIcon, RotateCcwIcon } from 'lucide-react';
import { useState, type ComponentProps } from 'react';

import { CopyButton } from '@/components/copy-button';
import { LightPopover } from '@/components/light-popover';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api';
import { useAgentState } from '@/lib/agent-state';
import { useProjectPermissions } from '@/lib/permissions';
import { useRequeue } from '@/lib/review-actions';
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
    <div className="flex w-[22rem] flex-col gap-2 p-2" data-testid="agent-start">
      <p className="font-semibold">Agent starten</p>
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
    </div>
  );
}

type ButtonLook = Pick<ComponentProps<typeof Button>, 'variant' | 'size'>;

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
 * „Nochmal versuchen“: requeues the models' analyses (permission `write`)
 * and, since a requeue alone runs nothing, opens the popover for owners
 * (clicked again while it is open, it closes it and requeues nothing);
 * editors get a toast and a plain button without a popup.
 */
export function RetryAgent({
  project,
  modelKeys,
  hasChain,
  label = 'Nochmal versuchen',
  align = 'start',
  testId,
  ...look
}: {
  project: string;
  modelKeys: readonly string[];
  hasChain: boolean;
  label?: string;
  align?: 'start' | 'end';
  testId?: string;
} & ButtonLook) {
  const { canWrite } = useProjectPermissions(project);
  const state = useAgentState(project);
  const requeue = useRequeue(project);
  const [open, setOpen] = useState(false);
  if (!canWrite) return null;
  const run = () =>
    requeue.mutate([...modelKeys], {
      onSuccess: () => {
        if (state !== null) setOpen(true);
        else
          toast({
            tone: 'success',
            title: 'Nochmal eingeplant',
            description: `${modelKeys.length === 1 ? '1 Modell wartet' : `${modelKeys.length} Modelle warten`} wieder auf den Agenten.`,
          });
      },
      onError: (error) =>
        toast({
          tone: 'danger',
          title: 'Nicht eingeplant',
          description: errorMessage(error),
          error,
        }),
    });
  const content = (
    <>
      <RotateCcwIcon data-icon="inline-start" />
      {label}
    </>
  );
  if (state === null)
    return (
      <Button {...look} disabled={requeue.isPending} onClick={run} data-testid={testId}>
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
          disabled={requeue.isPending}
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

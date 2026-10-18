import { useQuery } from '@tanstack/react-query';
import { XIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { AgentStartPanel } from '@/components/agent-start';
import { Button } from '@/components/ui/button';
import { closeAgentStart, useAgentStartRequest } from '@/lib/agent-start-request';
import { valueChainQuery } from '@/lib/queries';

/**
 * „Agent starten“ asked for by a toast's action (`requestAgentStart`): the
 * popover's content as a floating panel at the bottom right, above the
 * toasts; Escape, an outside click and „Schließen“ close it, and the focus
 * moves into it.
 */
export function AgentStartHost() {
  const project = useAgentStartRequest();
  return project ? <Host key={project} project={project} /> : null;
}

function Host({ project }: { project: string }) {
  const panel = useRef<HTMLDivElement>(null);
  const chain = useQuery({ ...valueChainQuery(project), retry: false });
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('button, a[href]')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeAgentStart();
    };
    const onPointer = (event: PointerEvent) => {
      if (panel.current && !panel.current.contains(event.target as Node)) closeAgentStart();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, []);
  return (
    <div
      ref={panel}
      role="dialog"
      aria-label="Agent starten"
      className="fixed right-4 bottom-4 z-[60] max-w-[calc(100vw-2rem)] rounded-lg border bg-card p-1 text-sm shadow-lg"
      data-testid="agent-start-host"
    >
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Schließen"
        onClick={closeAgentStart}
        className="absolute top-2 right-2"
      >
        <XIcon />
      </Button>
      <AgentStartPanel project={project} state="start" hasChain={chain.data != null} />
    </div>
  );
}

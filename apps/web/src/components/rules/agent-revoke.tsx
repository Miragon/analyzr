import { useId, useState } from 'react';

import { Field, FieldLabel } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import type { InForceAgent } from '@/lib/auto-accept';
import { handleName } from '@/lib/labels';

import { RevokeDialog } from './revoke-dialog';

/**
 * „Nach Agent widerrufen…“ (owner decision 19; UX-SIMPLIFICATION.md §3.11
 * item 3: a page action of „Annahmeregeln“, in its header's „Mehr“, shown
 * while acceptances are in force): revokes the auto-acceptances one agent's
 * proposals triggered, across every rule. The agents come from the ledger
 * (acceptances still in force), revoked tokens included, so this is where a
 * failed revoke of the agents page is finished. With several agents the
 * dialog asks which one above its dry run; with one, its title names it.
 */
export function AgentRevokeDialog({
  project,
  agents,
  open,
  onOpenChange,
  returnFocus,
}: {
  project: string;
  /** `inForceAgents` of the ledger: at least one. */
  agents: readonly InForceAgent[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where the focus goes when it closes (the header's „Mehr“ closed as it opened). */
  returnFocus?: () => HTMLElement | null | undefined;
}) {
  const id = useId();
  const [picked, setPicked] = useState('');
  const agent = agents.find((a) => a.principalId === picked) ?? agents[0];
  if (!agent) return null;
  return (
    <RevokeDialog
      project={project}
      open={open}
      onOpenChange={onOpenChange}
      returnFocus={returnFocus}
      selection={{ agentPrincipalId: agent.principalId }}
      title={
        agents.length === 1
          ? `Annahmen von ${handleName(agent.handle)} widerrufen`
          : 'Annahmen nach Agent widerrufen'
      }
      picker={
        agents.length > 1 ? (
          <Field>
            <FieldLabel htmlFor={`${id}-agent`}>Agent</FieldLabel>
            <NativeSelect
              id={`${id}-agent`}
              className="w-full"
              value={agent.principalId}
              onChange={(e) => setPicked(e.target.value)}
              data-testid="agent-revoke-agent"
            >
              {agents.map((a) => (
                <NativeSelectOption key={a.principalId} value={a.principalId}>
                  {handleName(a.handle)} ({a.count} in Kraft)
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        ) : null
      }
    />
  );
}

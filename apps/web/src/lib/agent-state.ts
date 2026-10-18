import { useQuery } from '@tanstack/react-query';

import { useProjectPermissions } from './permissions';
import { agentTokensQuery } from './queries';

/**
 * Whether the owner's project can start an agent (UX-SIMPLIFICATION.md §2.6):
 * `connect` without an active agent token, `start` with one; `null` for
 * editors and viewers (agent tokens are the owners') and while loading.
 */
export function useAgentState(project: string): 'connect' | 'start' | null {
  const { isOwner } = useProjectPermissions(project);
  const tokens = useQuery({ ...agentTokensQuery(project), enabled: isOwner });
  if (!isOwner || !tokens.data) return null;
  // Expiry as of the list's answer (render stays pure).
  const at = tokens.dataUpdatedAt;
  return tokens.data.some((t) => t.revokedAt === null && Date.parse(t.expiresAt) > at)
    ? 'start'
    : 'connect';
}

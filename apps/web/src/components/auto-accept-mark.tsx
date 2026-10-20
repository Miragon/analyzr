import type { AutoAcceptLedgerEntry } from '@analyzr/client';
import { WandSparklesIcon } from 'lucide-react';

import { ToneBadge } from '@/components/badges';
import { DERIVED_CALL_PROPOSAL } from '@/lib/auto-accept';
import { formatConfidence } from '@/lib/labels';

/**
 * The status of an item an owner's auto-accept rule accepted (owner
 * decision 19; one badge since UX5, owner decision 26 (5)): „Automatisch
 * angenommen“ instead of „Angenommen“; the rule, its revision and the agent
 * repeat in the tooltip and stand in „Verlauf“.
 */
export function AutoAcceptMark({ entry }: { entry: AutoAcceptLedgerEntry }) {
  return (
    <ToneBadge
      tone="success"
      icon={WandSparklesIcon}
      className="max-w-full"
      title={`Regel „${entry.ruleName}“ (Revision ${entry.revision}), entschieden unter ${entry.decidedBy.handle}; ausgelöst ${entry.proposedBy === 'rule' ? `vom ${DERIVED_CALL_PROPOSAL}` : `von ${entry.agent.handle}`}${entry.confidence === null ? '' : ` mit ${formatConfidence(entry.confidence)}`}`}
    >
      <span className="truncate" data-testid="auto-accept-mark">
        Automatisch angenommen
      </span>
    </ToneBadge>
  );
}
